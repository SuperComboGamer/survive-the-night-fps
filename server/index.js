// Server entry: uWebSockets.js transport (binary WebSocket at /ws), static file serving of the
// built client (dist/), a /status JSON endpoint, and a drift-corrected fixed-rate tick loop.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import uWS from 'uWebSockets.js';
import { Game } from './game.js';
import { SERVER_TICK_RATE, DEFAULT_PORT, MAX_PLAYERS } from '../shared/constants.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = +(process.env.PORT || DEFAULT_PORT);
const MAX = +(process.env.MAX_PLAYERS || MAX_PLAYERS);
const SEED = process.env.SEED ? +process.env.SEED : undefined;
const DIST = resolve(__dirname, '../dist');

const game = new Game({
  seed: SEED,
  maxPlayers: MAX,
  dayLength: process.env.DAY_SECONDS ? +process.env.DAY_SECONDS : undefined,
  nightLength: process.env.NIGHT_SECONDS ? +process.env.NIGHT_SECONDS : undefined,
  startDay: process.env.START_DAY ? +process.env.START_DAY : undefined,
  godMode: process.env.GODMODE === '1',
  debugCommands: process.env.DEBUG_COMMANDS === '1',
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

const app = uWS.App();

app.ws('/ws', {
  compression: uWS.DISABLED, // payloads are already tightly packed binary
  maxPayloadLength: 64 * 1024,
  maxBackpressure: 512 * 1024,
  idleTimeout: 60,
  sendPingsAutomatically: true,
  upgrade: (res, req, context) => {
    const ip = Buffer.from(res.getRemoteAddressAsText()).toString();
    res.upgrade({ ip }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'), req.getHeader('sec-websocket-extensions'), context);
  },
  open: (ws) => {
    const conn = {
      ip: ws.getUserData().ip,
      closed: false,
      send(bytes) {
        if (this.closed) return;
        // drop state for badly backed-up clients rather than letting memory grow unbounded
        if (ws.getBufferedAmount() > 256 * 1024) return;
        ws.send(bytes, true, false);
      },
    };
    ws.getUserData().session = game.onOpen(conn);
    ws.getUserData().conn = conn;
  },
  message: (ws, message, isBinary) => {
    if (!isBinary) return;
    // message buffer is only valid during this callback: copy it
    game.onMessage(ws.getUserData().session, new Uint8Array(message.slice(0)));
  },
  close: (ws) => {
    const d = ws.getUserData();
    d.conn.closed = true;
    game.onClose(d.session);
  },
});

app.get('/status', (res) => {
  const body = JSON.stringify({ players: game.players.size, max: game.maxPlayers, phase: game.phase, day: game.day, seed: game.seed >>> 0 });
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
  console.log(`[server] listening on http://localhost:${PORT} (ws /ws) max players ${MAX}`);
});

// ---------------------------------------------------------------- fixed-rate tick loop
const TICK_MS = 1000 / SERVER_TICK_RATE;
let next = performance.now();
function loop() {
  const now = performance.now();
  let steps = 0;
  while (now >= next && steps < 4) {
    try {
      game.update();
    } catch (err) {
      console.error('[server] tick error', err);
    }
    next += TICK_MS;
    steps++;
  }
  if (now - next > 1000) next = now; // way behind (debugger / sleep): resync
  const wait = Math.max(0, next - performance.now());
  setTimeout(loop, wait > 2 ? wait - 1 : 0);
}
loop();

// periodic stats
setInterval(() => {
  const s = game.stats;
  if (game.players.size) {
    const perClient = s.bytesOut / Math.max(1, game.players.size) / 10;
    console.log(`[stats] players ${game.players.size} zombies ${game.zombies.length} ents ${game.all.length} tick ${s.tickMs.toFixed(2)}ms out ${(perClient / 1024).toFixed(1)} KB/s/client`);
  }
  s.bytesOut = 0;
  s.msgsOut = 0;
}, 10000);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
