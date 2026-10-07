// A signed-in player's game socket (server/index.js, /ws), against a real server process on a PGlite database of its
// own. A handshake that carries a session cookie has its session looked up in the database before the socket gets its
// seat, and that wait once cost the socket: the upgrade was done from res.cork() when the lookup came back, which in
// uWebSockets.js v20.52 closes most such sockets straight after they open (close code 1006, 0 ms: its cork() reads the
// flags of the HTTP response the socket no longer is, out of memory the upgrade gave back -
// uNetworking/uWebSockets#1929). Only when the lookup takes a turn of the event loop, as a database over a network
// does and PGlite in this process does not: so the lookup is made slow here. And only on Linux; Windows happens to
// keep the sockets, so this also holds the server to what fixes it: the handshake is answered at once, and the seat
// is what waits.
//
// Here: raw handshakes with no cookie, a made-up one and a real session all stay open, and a signed-in player gets in
// and plays under their account's name; then with the lookup slow: the handshake does not wait for it, the sockets
// are still open once it is done, what a socket sends meanwhile (its JOIN) is kept, a socket that goes meanwhile takes
// no seat, one that floods meanwhile is closed, a cookie from another site's page is ignored, and a game that is not
// there is still turned away properly.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { C2S, S2C, PROTOCOL_VERSION, REJECT_REASON, LEFT_CODE, Writer, Reader } from '../shared/protocol.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(25);
  }
  return false;
};
const dir = mkdtempSync(join(tmpdir(), 'stn-session-socket-'));
const procs = [];
const LOOKUP_MS = 1000; // how long the slow server's session lookup takes

// a port nothing is listening on (uWS shares a port with whatever already has it)
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
async function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const gone = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGTERM');
  const t = setTimeout(() => proc.kill('SIGKILL'), 8000);
  await gone;
  clearTimeout(t);
}
// slow: the session lookup of a game socket takes LOOKUP_MS longer, as a database far away would make it
async function startServer(name, { slow = false } = {}) {
  const port = await freePort();
  const preload = `import { Auth } from ${JSON.stringify(new URL('../server/auth.js', import.meta.url).href)};
const real = Auth.prototype.userForToken;
Auth.prototype.userForToken = async function (token, fresh) {
  const user = await real.call(this, token, fresh);
  if (fresh) await new Promise((r) => setTimeout(r, ${LOOKUP_MS}));
  return user;
};`;
  const args = slow ? ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'server/index.js'] : ['server/index.js'];
  const env = { ...process.env, PORT: String(port), STATS_FILE: '', NODE_ENV: 'test', DATABASE_URL: `pglite:${join(dir, name)}`, LOBBY_LIMITS: '0', CONN_PER_IP: '0', HANDOFF: '0' };
  const proc = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc);
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 400 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body) => fetch(base + path, { signal: AbortSignal.timeout(15000), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // an account, signed in: its cookie
  const reg = await post('/api/auth/register', { email: 'ann@example.com', username: 'Ann', password: 'ann-password' });
  const session = /^stn_session=([^;]+)/.exec((reg.headers.getSetCookie?.() || []).join('\n'))?.[1] || '';
  if (!session) throw new Error(`could not register (${reg.status})`);
  const seats = (code) =>
    fetch(`${base}/api/games/${code}`)
      .then((r) => r.json())
      .then((g) => g.seats);
  // a game, its valley made
  const game = async () => {
    const made = await post('/api/games', { name: 'Session socket', maxPlayers: 16 }).then((r) => r.json());
    const ready = await until(() => fetch(`${base}/api/games/${made.code}`).then((r) => r.json()).then((g) => g.ready), 20000);
    if (!ready) throw new Error(`game ${made.code} never got ready:\n${log}`);
    return made.code;
  };
  return { port, base, session, game, seats, log: () => log };
}

// A handshake by hand, as the production report made it: what the server answered, how long that took, and whether
// the socket was still open `hold` ms later (how: 'open'), or how it went ('FIN', 'closed', an error) and when.
function shake(port, { code, cookie, origin, hold = 300 }) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    const t0 = performance.now();
    let buf = Buffer.alloc(0);
    let at = 0;
    let done = false;
    const fin = (how) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve({ status: buf.toString('latin1').slice(9, 12), how, answeredMs: at ? Math.round(at - t0) : -1, ms: at ? Math.round(performance.now() - at) : -1 });
    };
    s.on('connect', () => {
      const lines = [`GET /ws?game=${code} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Version: 13'];
      if (origin) lines.push(`Origin: ${origin}`);
      if (cookie) lines.push(`Cookie: stn_session=${cookie}`);
      s.write(lines.join('\r\n') + '\r\n\r\n');
    });
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!at && buf.includes('\r\n\r\n')) {
        at = performance.now();
        setTimeout(() => fin('open'), hold);
      }
    });
    s.on('end', () => fin('FIN'));
    s.on('close', () => fin('closed'));
    s.on('error', (e) => fin(`error ${e.code}`));
    setTimeout(() => fin('no answer'), 10000);
  });
}
// `n` of them, a few at a time -> what happened to them, counted: { '101 open': 40 }
async function shakes(srv, code, n, opts) {
  const kinds = {};
  for (let i = 0; i < n; i += 8) {
    const batch = await Promise.all(Array.from({ length: Math.min(8, n - i) }, () => shake(srv.port, { code, origin: srv.base, ...opts })));
    for (const r of batch) {
      const k = `${r.status} ${r.how}${r.how === 'open' ? '' : ` after ${r.ms} ms`}`;
      kinds[k] = (kinds[k] || 0) + 1;
    }
    await until(async () => (await srv.seats(code)) === 0); // (their seats are free again)
  }
  return kinds;
}
const allOpen = (kinds, n) => kinds['101 open'] === n && Object.keys(kinds).length === 1;

// A game socket, as connection.js opens one: its JOIN goes the moment it is open. joins: how many JOINs it sends then.
// -> { id (0: never welcomed), accounts: id -> account name, reject, closed (the close code), welcomedMs, openedMs }
function play(srv, code, name, { cookie = '', origin = '', joins = 1 } = {}) {
  return new Promise((resolve) => {
    const headers = {};
    if (cookie) headers.cookie = `stn_session=${cookie}`;
    if (origin) headers.origin = origin;
    const t0 = performance.now();
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?game=${code}`, { headers });
    ws.binaryType = 'arraybuffer';
    const c = { ws, id: 0, accounts: new Map(), reject: 0, closed: 0, openedMs: -1, welcomedMs: -1 };
    ws.onopen = () => {
      c.openedMs = Math.round(performance.now() - t0);
      const w = new Writer(128);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str(randomUUID());
      for (let i = 0; i < joins; i++) ws.send(w.bytes());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      const t = r.u8();
      if (t === S2C.WELCOME) {
        c.id = r.u16();
        c.welcomedMs = Math.round(performance.now() - t0);
        setTimeout(() => resolve(c), 300); // (who is signed in comes right after)
      } else if (t === S2C.FRIENDS) for (let n = r.u8(); n > 0; n--) c.accounts.set(r.u16(), r.str());
      else if (t === S2C.REJECT) c.reject = r.u8();
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      c.closed = e.code;
      resolve(c);
    };
    c.close = () => new Promise((done) => (c.closed ? done() : ((ws.onclose = done), ws.close(LEFT_CODE))));
    setTimeout(() => resolve(c), 15000);
  });
}

// ---------------------------------------------------------------- the session lookup as quick as it is here
try {
  const srv = await startServer('quick');
  const code = await srv.game();
  const N = 16;
  const none = await shakes(srv, code, N, {});
  check('a handshake with no cookie is answered 101 and the socket stays open', allOpen(none, N), JSON.stringify(none));
  const madeUp = await shakes(srv, code, N, { cookie: 'made-up-token' });
  check('...and so does one with a made-up session cookie', allOpen(madeUp, N), JSON.stringify(madeUp));
  const real = await shakes(srv, code, N, { cookie: srv.session });
  check('...and one with the cookie of a real session', allOpen(real, N), JSON.stringify(real));
  await sleep(200);
  const dropped = srv.log().split('\n').filter((l) => /closed before it joined \(code 1006, \d{1,2} ms\)/.test(l));
  check('the server dropped none of them as they opened', dropped.length === 0, `${dropped.length}, e.g. ${dropped[0]}`);

  const ann = await play(srv, code, 'Imposter', { cookie: srv.session });
  check('a signed-in player gets into the game, under their account name', ann.id > 0 && ann.accounts.get(ann.id) === 'Ann', JSON.stringify({ id: ann.id, closed: ann.closed, accounts: [...ann.accounts] }));
  await ann.close();
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

// ---------------------------------------------------------------- the session lookup slow
try {
  const srv = await startServer('slow', { slow: true });
  const code = await srv.game();

  const first = await shake(srv.port, { code, cookie: srv.session, origin: srv.base, hold: 100 });
  check('the handshake is answered at once: it does not wait for the session lookup', first.status === '101' && first.how === 'open' && first.answeredMs < LOOKUP_MS / 2, JSON.stringify(first));
  // (that socket went while it waited)
  await sleep(LOOKUP_MS + 400);
  check('a socket that goes before its session is known takes no seat', (await srv.seats(code)) === 0 && !/closed before it joined/.test(srv.log()) && !/Error|Unhandled/.test(srv.log()), srv.log().split('\n').slice(-3).join(' | '));

  // (the production bug, as it was reported: 101, and dropped by the server before the JOIN)
  for (const [who, cookie] of [['a made-up session cookie', 'made-up-token'], ['the cookie of a real session', srv.session]]) {
    const kinds = await shakes(srv, code, 16, { cookie, hold: LOOKUP_MS + 400 });
    check(`sockets with ${who} are still open after the lookup`, allOpen(kinds, 16), JSON.stringify(kinds));
  }
  await sleep(200);
  const dropped = srv.log().split('\n').filter((l) => /closed before it joined \(code 1006, \d{1,2} ms\)/.test(l));
  check('...the server dropped none of them as they got their seats', dropped.length === 0, `${dropped.length}, e.g. ${dropped[0]}`);

  const ann = await play(srv, code, 'Imposter', { cookie: srv.session });
  check('a JOIN sent before the session is known is kept, and answered once it is', ann.id > 0 && ann.openedMs < LOOKUP_MS / 2 && ann.welcomedMs >= LOOKUP_MS - 50, JSON.stringify({ id: ann.id, closed: ann.closed, openedMs: ann.openedMs, welcomedMs: ann.welcomedMs }));
  check('...as the account, never as a guest in the meantime', ann.accounts.get(ann.id) === 'Ann', JSON.stringify([...ann.accounts]));

  const other = await play(srv, code, 'Visitor', { cookie: srv.session, origin: 'http://evil.example' });
  check("a cookie sent by another site's page is ignored: no lookup, and a guest", other.id > 0 && other.welcomedMs < LOOKUP_MS / 2 && other.accounts.get(other.id) === '' && other.accounts.get(ann.id) === 'Ann', JSON.stringify({ id: other.id, welcomedMs: other.welcomedMs, accounts: [...other.accounts] }));
  await Promise.all([ann.close(), other.close()]);

  const flood = await play(srv, code, 'Flood', { cookie: srv.session, joins: 40 });
  check('a socket that sends a flood before its session is known is closed', flood.id === 0 && flood.closed === 1008, JSON.stringify({ id: flood.id, closed: flood.closed }));

  const lost = await play(srv, 'ZZZZZZ', 'Lost', { cookie: srv.session });
  check('a game that is not there is still turned away: told why, and closed', lost.id === 0 && lost.reject === REJECT_REASON.NO_GAME && lost.closed === 1000, JSON.stringify({ reject: lost.reject, closed: lost.closed }));

  const pong = await fetch(`${srv.base}/status`).then((r) => r.status).catch(() => 0);
  check('...and the server is still up', pong === 200 && (await srv.seats(code)) === 0, String(pong));
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

await Promise.all(procs.map(stop));
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
