// Server entry: uWebSockets.js transport (binary WebSocket at /ws), static file serving of the
// built client (dist/), a /status JSON endpoint, and a drift-corrected fixed-rate tick loop.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import uWS from 'uWebSockets.js';
import { Rooms } from './rooms.js';
import { Lobbies } from './lobby.js';
import { SERVER_TICK_RATE, DEFAULT_PORT, MAX_PLAYERS } from '../shared/constants.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = +(process.env.PORT || DEFAULT_PORT);
const MAX = +(process.env.MAX_PLAYERS || MAX_PLAYERS);
const SEED = process.env.SEED ? +process.env.SEED : undefined;
const DIST = resolve(__dirname, '../dist');

// The games: a main room that always exists plus any opened on request (server/rooms.js).
const rooms = new Rooms({
  seed: SEED,
  dayLength: process.env.DAY_SECONDS ? +process.env.DAY_SECONDS : undefined,
  nightLength: process.env.NIGHT_SECONDS ? +process.env.NIGHT_SECONDS : undefined,
  startDay: process.env.START_DAY ? +process.env.START_DAY : undefined,
  godMode: process.env.GODMODE === '1',
  debugCommands: process.env.DEBUG_COMMANDS === '1',
}, MAX);
const game = rooms.main.game; // (what /status and the stats line speak of)

// ---------------------------------------------------------------- static files (prod build)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
};
const files = new Map();
function loadDir(dir, prefix = '') {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) loadDir(full, `${prefix}/${name}`);
    else files.set(`${prefix}/${name}`, { body: readFileSync(full), type: MIME[extname(name)] || 'application/octet-stream' });
  }
}
loadDir(DIST);
if (files.size) console.log(`[server] serving ${files.size} static files from dist/`);
else console.log('[server] no dist/ build found - run `npm run build` (or use `npm run dev` for the Vite dev server)');

// ---------------------------------------------------------------- who is connecting
// The game counts joins per address (Game.admitJoin). Behind a reverse proxy - Railway's edge in production -
// the socket's peer is the proxy, the same for every player, and the client is named in X-Forwarded-For (first
// entry) or X-Real-IP. Those headers are only believed from a peer on a private network, i.e. a proxy of ours:
// a client connecting directly could write anything into them. TRUST_PROXY=1 / 0 settles it either way.
const TRUST_PROXY = process.env.TRUST_PROXY;
// a header's address without its port, '' if it does not look like one
const address = (text) => {
  const a = text.trim().replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1');
  return /^[0-9a-f:.]{2,45}$/i.test(a) ? a.toLowerCase() : '';
};
function clientAddress(res, req) {
  // uWS spells the peer out as eight hex groups, an IPv4 one as 0000:0000:0000:0000:0000:ffff:hhhh:hhhh
  let peer = Buffer.from(res.getRemoteAddressAsText()).toString();
  const v4 = /^(?:0000:){5}ffff:(..)(..):(..)(..)$/i.exec(peer);
  if (v4) peer = v4.slice(1).map((h) => parseInt(h, 16)).join('.');
  // loopback, 10/8, 172.16/12, 192.168/16, 100.64/10 (carrier-grade NAT), link-local, IPv6 unique-local
  const ours = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|(0000:){7}0001$|f[cd]|fe[89ab])/i.test(peer);
  if (TRUST_PROXY === '0' || !(ours || TRUST_PROXY === '1')) return peer;
  return address(req.getHeader('x-forwarded-for').split(',')[0]) || address(req.getHeader('x-real-ip')) || peer;
}

const app = uWS.App();

app.ws('/ws', {
  compression: uWS.DISABLED, // payloads are already tightly packed binary (measured: deflate only takes ~10% more off)
  maxPayloadLength: 64 * 1024,
  maxBackpressure: 512 * 1024,
  idleTimeout: 60,
  sendPingsAutomatically: true,
  upgrade: (res, req, context) => {
    const ip = clientAddress(res, req);
    const room = new URLSearchParams(req.getQuery() || '').get('room') || 'main';
    res.upgrade({ ip, room }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
  },
  open: (ws) => {
    const conn = {
      ip: ws.getUserData().ip,
      closed: false,
      send(bytes) {
        if (this.closed) return;
        // drop messages for badly backed-up clients rather than letting memory grow unbounded
        if (ws.getBufferedAmount() > 256 * 1024) return;
        ws.send(bytes, true, false);
      },
      // ...and tell the game, which holds that client's snapshots back instead (a dropped one would break its delta chain)
      congested() {
        return !this.closed && ws.getBufferedAmount() > 256 * 1024;
      },
      // batches every send inside fn into one syscall / TCP segment
      cork(fn) {
        if (!this.closed) ws.cork(fn);
      },
    };
    const g = rooms.get(ws.getUserData().room).game;
    ws.getUserData().game = g;
    ws.getUserData().session = g.onOpen(conn);
    ws.getUserData().conn = conn;
  },
  message: (ws, message, isBinary) => {
    if (!isBinary) return;
    // message buffer is only valid during this callback: copy it
    ws.getUserData().game.onMessage(ws.getUserData().session, new Uint8Array(message.slice(0)));
  },
  close: (ws) => {
    const d = ws.getUserData();
    d.conn.closed = true;
    d.game.onClose(d.session);
  },
});

// DEAD RIDE's lobbies (server/lobby.js): JSON text frames for the lobby, binary frames relayed between the players of a game
const lobbies = new Lobbies();
app.ws('/dr', {
  compression: uWS.DISABLED,
  maxPayloadLength: 1024 * 1024, // (a late joiner's state of play is one frame from the host)
  maxBackpressure: 2 * 1024 * 1024,
  idleTimeout: 60,
  sendPingsAutomatically: true,
  upgrade: (res, req, context) => {
    res.upgrade({ ip: clientAddress(res, req) }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
  },
  open: (ws) => {
    const conn = {
      closed: false,
      sendText(s) {
        if (!this.closed) ws.send(s, false, false);
      },
      sendBinary(b) {
        if (!this.closed && ws.getBufferedAmount() < 1024 * 1024) ws.send(b, true, false);
      },
    };
    ws.getUserData().conn = conn;
    ws.getUserData().client = lobbies.open(conn);
  },
  message: (ws, message, isBinary) => {
    const c = ws.getUserData().client;
    if (isBinary) lobbies.binary(c, new Uint8Array(message.slice(0)));
    else lobbies.text(c, Buffer.from(message).toString('utf8'));
  },
  close: (ws) => {
    const d = ws.getUserData();
    d.conn.closed = true;
    lobbies.close(d.client);
  },
});
app.get('/dr/status', (res) => json(res, lobbies.status()));

app.get('/status', (res) => {
  // tick: the last 10 s window, the totals since boot and the last slow tick (timings only: this endpoint is public)
  const body = JSON.stringify({ players: game.players.size, max: game.maxPlayers, phase: game.phase, day: game.day, seed: game.seed >>> 0, mode: game.mode, tick: game.tickStats.status(performance.now()) });
  res.writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store').writeHeader('Access-Control-Allow-Origin', '*').end(body);
});

// the list of games, and opening a new one: /rooms/new?mode=0|1&name=...  (answers { id } or { error })
const json = (res, body) => res.writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store').writeHeader('Access-Control-Allow-Origin', '*').end(JSON.stringify(body));
app.get('/rooms', (res) => json(res, rooms.list()));
app.get('/rooms/new', (res, req) => {
  const q = new URLSearchParams(req.getQuery() || '');
  const room = rooms.open(+q.get('mode'), q.get('name'));
  json(res, room ? { id: room.id, name: room.name } : { error: 'Too many games open: join one' });
});

app.get('/*', (res, req) => {
  let url = req.getUrl();
  if (url.endsWith('/') && files.has(url + 'index.html')) url += 'index.html'; // (/deadride/ and the like)
  else if (url === '/deadride') url = '/deadride/index.html';
  if (url === '/' || !files.has(url)) url = files.has(url) ? url : '/index.html';
  const f = files.get(url);
  if (!f) {
    res.writeStatus('404 Not Found').end('Not found - build the client with `npm run build`');
    return;
  }
  res.writeHeader('Content-Type', f.type);
  if (url.startsWith('/assets/')) res.writeHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(f.body);
});

app.listen(PORT, (token) => {
  if (!token) {
    console.error(`[server] failed to listen on port ${PORT}`);
    process.exit(1);
  }
  console.log(`[server] listening on http://localhost:${PORT} (ws /ws) max players ${MAX}`);
});

// ---------------------------------------------------------------- fixed-rate tick loop
const TICK_MS = 1000 / SERVER_TICK_RATE;
let next = performance.now();
let due = next; // when the timer that wakes the loop was due
function loop() {
  const now = performance.now();
  // a wake with a tick to run: how long after its timer was due did it come? That is the event loop or the host
  // holding the server up, not the cost of a tick (after a slow tick the timer is armed late, so it is not counted)
  if (now >= next) game.tickStats.late(now - due);
  let steps = 0;
  while (now >= next && steps < 4) {
    try {
      rooms.update();
    } catch (err) {
      console.error('[server] tick error', err);
    }
    next += TICK_MS;
    steps++;
  }
  if (now - next > 1000) next = now; // way behind (debugger / sleep): resync
  const armed = performance.now();
  const wait = Math.max(0, next - armed);
  due = armed + wait;
  setTimeout(loop, wait > 2 ? wait - 1 : 0);
}
loop();

// periodic stats
setInterval(() => rooms.sweep(), 5000);
setInterval(() => {
  const s = game.stats;
  const t = game.tickStats.roll(); // the ticks since the last line (closed with nobody on too: /status reads it)
  if (game.players.size) {
    const perClient = s.bytesOut / Math.max(1, game.players.size) / 10;
    // tick: mean, 99th percentile and worst; over: ticks past the budget / ticks; late: how late the loop woke, mean and worst
    const tick = `tick ${t.meanMs.toFixed(2)}ms p99 ${t.p99Ms.toFixed(2)}ms max ${t.maxMs.toFixed(2)}ms over ${t.over}/${t.ticks} late ${t.lateMeanMs.toFixed(2)}ms latemax ${t.lateMaxMs.toFixed(2)}ms`;
    console.log(`[stats] players ${game.players.size} zombies ${game.zombies.length} ents ${game.all.length} ${tick} out ${(perClient / 1024).toFixed(1)} KB/s/client`);
  }
  s.bytesOut = 0;
  s.msgsOut = 0;
}, 10000);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
