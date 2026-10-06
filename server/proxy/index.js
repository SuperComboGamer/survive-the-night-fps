// The proxy in front of several game servers (npm run proxy). Browsers reach only this; it sends each request to the
// game server that has what it asks for, as the servers tell it in Postgres (router.js, server/cluster.js):
//
//   /ws?game=CODE, GET /api/games/:code   the server the game is on (a game moving between servers on a deploy:
//                                         the one it is moving to)
//   /ws (a quick join)                    the server with the public game a quick join would pick, else the least busy
//   POST /api/games                       the least busy server of the newest deployment
//   GET /api/games, GET /status           answered here, for every server at once
//   everything else                       any server of the newest deployment, in turn (the page, the API, /social)
//
// A WebSocket's bytes go through as they are (tunnel.js). Going down (SIGTERM: a deploy of the proxy), it ends every
// game socket with MOVED_CODE, between two frames: the client comes straight back in through the next proxy, to the
// same server, which held its player for it.
//
// Not needed with one game server: that one serves everything itself. The env: DATABASE_URL (Postgres, the game
// servers'), PORT, TRUST_PROXY (netaddr.js).
import http from 'node:http';
import { hostname } from 'node:os';
import { openDb, describeUrl } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { clientOf } from '../netaddr.js';
import { ServerSettings } from '../serversettings.js';
import { Router } from './router.js';
import { tunnel } from './tunnel.js';
import { MOVED_CODE } from '../../shared/protocol.js';

const PORT = +(process.env.PORT || 8080);
const ID = process.env.RAILWAY_REPLICA_ID || `${hostname()}:${PORT}`;
const log = (...a) => console.log('[proxy]', ...a);

const db = await openDb(process.env.DATABASE_URL, { log }).catch((err) => {
  console.error('[proxy] database could not be opened:', err.message);
  process.exit(1);
});
if (!db || db.kind !== 'postgres') {
  console.error('[proxy] needs DATABASE_URL: the Postgres database the game servers share (CLUSTER=1)');
  process.exit(1);
}
log(`database: ${describeUrl(process.env.DATABASE_URL)}`);
// (the tables it reads are the servers' to make, but a proxy up first makes them too: under the same lock, never twice)
await migrate(db, { log }).catch((err) => log(`migrations: ${err.message}`));
const settings = new ServerSettings({ db, log });
await settings.start();
const router = new Router({ db, settings, log });
await router.start().catch((err) => log(`router: ${err.message}`));

// HTTP/1.1 hop-by-hop headers stay on this hop
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate']);
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const tunnels = new Set();
let stopping = false;

// What the server is to be told of a request: the browser's own headers (Host and Origin as they came: the server checks
// them against each other, http.js sameOrigin), and who the browser is
function headersFor(req, { upgrade = false } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) out[k] = v;
  const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  out['x-forwarded-for'] = clientOf(peer, req.headers['x-forwarded-for'], req.headers['x-real-ip']);
  delete out['x-real-ip'];
  if (!out['x-forwarded-proto']) out['x-forwarded-proto'] = 'http';
  if (upgrade) {
    out.connection = 'Upgrade';
    out.upgrade = req.headers.upgrade;
  }
  return out;
}

function send(res, status, body) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
const noServer = (res) => send(res, 503, { error: 'No game server is up right now. Try again in a moment.' });

function forward(req, res, to) {
  if (!to) return noServer(res);
  const up = http.request({ hostname: to.addr, port: to.port, method: req.method, path: req.url, headers: headersFor(req), agent }, (ur) => {
    const headers = { 'x-stn-server': to.id };
    for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k)) headers[k] = v;
    res.writeHead(ur.statusCode, ur.statusMessage, headers);
    ur.pipe(res);
  });
  up.setTimeout(30_000, () => up.destroy(new Error('timed out')));
  up.on('error', (err) => {
    log(`${req.method} ${req.url.split('?')[0]} to ${to.id}: ${err.message}`);
    send(res, 502, { error: 'The game server did not answer. Try again.' });
  });
  req.pipe(up);
}

// every server's /status, merged: what the lobby shows, and per server how it is doing
async function status(res) {
  const servers = await Promise.all(
    router.servers.map(async (s) => {
      try {
        const r = await fetch(`http://${s.addr.includes(':') ? `[${s.addr}]` : s.addr}:${s.port}/status`, { signal: AbortSignal.timeout(1500) });
        return { id: s.id, deployment: s.deployment, draining: s.draining, ...(await r.json()) };
      } catch (err) {
        return { id: s.id, deployment: s.deployment, draining: s.draining, error: err.message };
      }
    })
  );
  const lobby = await router.lobby().catch(() => ({}));
  const { list: _, ...info } = lobby;
  send(res, 200, { ...info, db: 'postgres', proxy: { id: ID, sockets: tunnels.size }, servers: servers.map(({ list, ...s }) => s), list: servers.flatMap((s) => s.list || []) });
}

const route = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    log(`${req.method} ${req.url.split('?')[0]}: ${err.message}`);
    send(res, 503, { error: 'The lobby cannot be reached right now. Try again in a moment.' });
  });

const server = http.createServer(
  route(async (req, res) => {
    const url = new URL(req.url, 'http://proxy');
    const path = url.pathname;
    if (path === '/proxy/health') return send(res, stopping ? 503 : 200, { ok: !stopping, servers: router.servers.length, db: !router.failing });
    if (req.method === 'GET' && path === '/api/games') return send(res, 200, await router.lobby());
    if (req.method === 'GET' && path === '/status') return status(res);
    const card = req.method === 'GET' && /^\/api\/games\/([^/]+)$/.exec(path);
    if (card) return forward(req, res, (await router.gameServer(decodeURIComponent(card[1]))) || router.any());
    if (req.method === 'POST' && path === '/api/games') return forward(req, res, router.leastLoaded({ made: true }));
    forward(req, res, router.any(req.headers['x-stn-via']));
  })
);

server.on('upgrade', async (req, socket, head) => {
  socket.on('error', () => {});
  const refuse = (status) => socket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
  if (stopping) return refuse('503 Service Unavailable');
  const url = new URL(req.url, 'http://proxy');
  let to = null;
  try {
    if (url.pathname === '/ws') {
      const code = url.searchParams.get('game');
      to = code ? (await router.gameServer(code)) || router.any() : await router.quickServer();
    } else if (url.pathname === '/social') to = router.any(req.headers['x-stn-via']);
    else return refuse('404 Not Found');
  } catch (err) {
    log(`${url.pathname}: ${err.message}`);
  }
  if (!to) return refuse('503 Service Unavailable');
  if (socket.destroyed) return;
  const t = tunnel(socket, head, req, to, headersFor(req, { upgrade: true }), () => tunnels.delete(t));
  t.game = url.pathname === '/ws';
  tunnels.add(t);
});

server.keepAliveTimeout = 65_000;
server.listen(PORT, '::', () => log(`${ID} listening on :${PORT}, ${router.servers.length} game server(s) up`));

// Going down: no new sockets, and every one there is ended between two frames - a game socket with MOVED_CODE, which
// the client comes straight back in from (through the next proxy, which is up by now), the /social one as a restart
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: closing ${tunnels.size} socket(s)`);
  server.close();
  server.closeIdleConnections();
  for (const t of tunnels) t.close(t.game ? MOVED_CODE : 1012, t.game ? 'Server updating' : 'Restarting');
  const until = Date.now() + 5000;
  while (tunnels.size && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  router.stop();
  await db.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
