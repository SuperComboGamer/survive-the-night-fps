// Server entry, the network thread: uWebSockets.js transport (binary WebSocket at /ws), the lobby's HTTP API
// (/api/games), static file serving of the built client (dist/) and a /status JSON endpoint. The games themselves
// run in worker threads, one game server each (rooms.js, room-worker.js); this thread routes every socket to its
// game by the code in its URL (/ws?game=CODE), or with no code to whichever public game a quick join picks.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import uWS from 'uWebSockets.js';
import { Lobby, rejectBytes, defaultMaxGames } from './rooms.js';
import { PlayerStats } from './stats.js';
import { REJECT_REASON } from '../shared/protocol.js';
import { DEFAULT_PORT, MAX_PLAYERS } from '../shared/constants.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = +(process.env.PORT || DEFAULT_PORT);
const MAX = +(process.env.MAX_PLAYERS || MAX_PLAYERS); // seats in a game unless its maker picks: a quick join's
// the most seats a game can be made with. The server carries far more (scripts/stress.js: 48 in one game is ~7% of
// a core), but the game is balanced for 8 and the night's 120 zombies spread thin past about 16
const ROOM_MAX = +(process.env.ROOM_MAX_PLAYERS || Math.max(MAX, 16));
const MAX_GAMES = +(process.env.MAX_GAMES || defaultMaxGames()); // games at once on this box
// sockets one address may have open over all the games (a household, a LAN party). 0: no limit (load tests)
const CONN_PER_IP = +(process.env.CONN_PER_IP ?? 24);
const SEED = process.env.SEED ? +process.env.SEED : undefined;
const DIST = resolve(__dirname, '../dist');
// The leaderboard's records (stats.js): STATS_FILE, or stats.json on the Railway volume if the service has one, or in
// data/ here. They are only as lasting as the disk that is on - a deploy without a volume starts from a fresh one.
// STATS_FILE= (empty) keeps nothing past this process.
const STATS_FILE = process.env.STATS_FILE ?? join(process.env.RAILWAY_VOLUME_MOUNT_PATH || resolve(__dirname, '../data'), 'stats.json');
const stats = new PlayerStats({ file: STATS_FILE, log: (...a) => console.log('[server]', ...a) });

const lobby = new Lobby({
  stats,
  maxGames: MAX_GAMES,
  maxPlayers: MAX,
  roomMaxPlayers: ROOM_MAX,
  limits: process.env.LOBBY_LIMITS !== '0', // 0: no per-address allowance on making games or asking for codes (load tests)
  idleMs: process.env.GAME_IDLE_SECONDS ? +process.env.GAME_IDLE_SECONDS * 1000 : undefined, // an empty game lasts this long (tests)
  log: (...a) => console.log('[server]', ...a),
  // every game is made with these (all but the seed are for testing)
  gameOpts: {
    seed: SEED,
    dayLength: process.env.DAY_SECONDS ? +process.env.DAY_SECONDS : undefined,
    nightLength: process.env.NIGHT_SECONDS ? +process.env.NIGHT_SECONDS : undefined,
    startDay: process.env.START_DAY ? +process.env.START_DAY : undefined,
    godMode: process.env.GODMODE === '1',
    debugCommands: process.env.DEBUG_COMMANDS === '1',
  },
});

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
const perIp = new Map(); // address -> sockets it has open

app.ws('/ws', {
  compression: uWS.DISABLED, // payloads are already tightly packed binary (measured: deflate only takes ~10% more off)
  maxPayloadLength: 64 * 1024,
  maxBackpressure: 512 * 1024,
  idleTimeout: 60,
  sendPingsAutomatically: true,
  upgrade: (res, req, context) => {
    const ip = clientAddress(res, req);
    const code = String(req.getQuery('game') || '').trim().toUpperCase(); // none: a quick join
    res.upgrade({ ip, code, room: null, slot: -1, counted: false, heard: false }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
  },
  open: (ws) => {
    const d = ws.getUserData();
    let reason = 0;
    if (CONN_PER_IP && (perIp.get(d.ip) || 0) >= CONN_PER_IP) reason = REJECT_REASON.FULL;
    else {
      const room = d.code ? lobby.find(d.code, d.ip) : lobby.quick();
      const slot = room ? room.attach(ws) : -1;
      if (slot >= 0) {
        d.room = room;
        d.slot = slot;
      } else reason = room || !d.code ? REJECT_REASON.FULL : REJECT_REASON.NO_GAME;
    }
    if (reason) {
      // told why, the way the game tells a join it turns away (the client closes on it; this closes it anyway)
      ws.send(rejectBytes(reason), true, false);
      ws.end(1000, 'rejected');
      return;
    }
    perIp.set(d.ip, (perIp.get(d.ip) || 0) + 1);
    d.counted = true;
  },
  message: (ws, message, isBinary) => {
    if (!isBinary) return;
    const d = ws.getUserData();
    if (!d.room) return;
    d.room.deliver(d.slot, new Uint8Array(message), !d.heard); // (copied there: the buffer is only valid during this callback)
    d.heard = true;
  },
  drain: (ws) => {
    const d = ws.getUserData();
    d.room?.drained(d.slot);
  },
  close: (ws) => {
    const d = ws.getUserData();
    if (d.counted) {
      const n = (perIp.get(d.ip) || 1) - 1;
      if (n > 0) perIp.set(d.ip, n);
      else perIp.delete(d.ip);
      d.counted = false;
    }
    const room = d.room;
    d.room = null;
    room?.detach(d.slot);
  },
});

// ---------------------------------------------------------------- the lobby
const STATUS_TEXT = { 200: '200 OK', 201: '201 Created', 400: '400 Bad Request', 404: '404 Not Found', 413: '413 Payload Too Large', 415: '415 Unsupported Media Type', 429: '429 Too Many Requests', 503: '503 Service Unavailable' };
function json(res, status, obj) {
  res.cork(() => {
    res.writeStatus(STATUS_TEXT[status] || String(status)).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store').end(JSON.stringify(obj));
  });
}
const lobbyInfo = () => ({ games: lobby.rooms.size, maxGames: lobby.maxGames, canCreate: lobby.rooms.size < lobby.maxGames, players: lobby.players(), defaultPlayers: lobby.maxPlayers, maxPlayers: lobby.roomMaxPlayers });

// the public games, and what a new one can be
app.get('/api/games', (res) => json(res, 200, { ...lobbyInfo(), list: lobby.list() }));

// one game by its code (an invite link asks before joining: who is in it, is there a seat)
app.get('/api/games/:code', (res, req) => {
  const room = lobby.find(req.getParameter(0), clientAddress(res, req));
  if (room) json(res, 200, room.info());
  else json(res, 404, { error: 'No game goes by that code. It may have ended.' });
});

// makes a game: { name, host, inviteOnly, maxPlayers } -> its info, code included
app.post('/api/games', (res, req) => {
  const ip = clientAddress(res, req);
  // (JSON only: a form on another site cannot post that without the browser asking this server first)
  if (!/^application\/json\b/i.test(req.getHeader('content-type'))) return json(res, 415, { error: 'Send JSON' });
  let body = Buffer.alloc(0);
  let done = false;
  res.onAborted(() => {
    done = true;
  });
  res.onData((chunk, last) => {
    if (done) return;
    body = Buffer.concat([body, Buffer.from(chunk)]); // (copies it: chunk is only valid during this callback)
    if (body.length > 2048) {
      done = true;
      return json(res, 413, { error: 'Too much' });
    }
    if (!last) return;
    done = true;
    let o;
    try {
      o = JSON.parse(body.toString('utf8') || '{}');
    } catch {
      return json(res, 400, { error: 'Bad request' });
    }
    if (!o || typeof o !== 'object') return json(res, 400, { error: 'Bad request' });
    const made = lobby.create({ name: o.name, host: o.host, inviteOnly: o.inviteOnly === true, maxPlayers: o.maxPlayers }, ip);
    if (made.error) return json(res, made.status, { error: made.error });
    json(res, 201, made.room.info());
  });
});

// ---------------------------------------------------------------- how the box is doing
let mainCpuAt = process.threadCpuUsage();
let mainElu = performance.eventLoopUtilization();
let mainLoad = { cpuMs: 0, elu: 0 }; // this thread over the last second: CPU ms per second, share of time busy
setInterval(() => {
  const cpu = process.threadCpuUsage(mainCpuAt);
  mainCpuAt = process.threadCpuUsage();
  const e = performance.eventLoopUtilization(mainElu);
  mainElu = performance.eventLoopUtilization();
  mainLoad = { cpuMs: Math.round((cpu.user + cpu.system) / 10) / 100, elu: Math.round(e.utilization * 1000) / 1000 };
}, 1000).unref();

app.get('/status', (res) => {
  // timings and counts only, no codes (this endpoint is public, and an invite-only game's code is its key).
  // tick: per game, the last 10 s window, the totals since it started and its last slow tick
  const mem = process.memoryUsage();
  const games = [...lobby.rooms.values()].map((r) => ({ players: r.st.players, max: r.maxPlayers, public: !r.inviteOnly, phase: r.st.phase, day: r.st.day, load: r.st.load, heapMb: r.st.heapMb, tick: r.st.tick }));
  const body = JSON.stringify({ ...lobbyInfo(), net: { ...mainLoad, sockets: [...perIp.values()].reduce((a, b) => a + b, 0) }, rssMb: Math.round(mem.rss / 1e6), list: games });
  res.writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store').writeHeader('Access-Control-Allow-Origin', '*').end(body);
});

app.get('/*', (res, req) => {
  let url = req.getUrl();
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
  console.log(`[server] listening on http://localhost:${PORT} (ws /ws) up to ${MAX_GAMES} games of ${MAX} players (${ROOM_MAX} at most)`);
});

// the leaderboard goes to disk every half minute if it changed, and once more on the way out
setInterval(() => stats.save(), 30000);
process.on('exit', () => stats.saveSync());
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
