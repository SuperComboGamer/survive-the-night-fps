// Several game servers behind the proxy (server/cluster.js, server/proxy/), end to end: two real game servers (A, B)
// with CLUSTER=1 and the proxy in front, on a real Postgres. Games made through the proxy are spread over both servers
// and joined by code through it every time; quick joins all land in one game; the lobby lists every server's games;
// two accounts with their /social sockets on different servers become friends, message each other and see each
// other playing. Then a deploy: C (a newer deployment) starts, A is told to stop, its game is handed to C and its
// player is back in their own body through the proxy. Then the proxy itself is restarted: its sockets are ended as
// moved, and the player is back again through the new one.
//
// Needs a Postgres it may wipe: CLUSTER_TEST_DATABASE_URL, on this machine (docker run -d --rm -p 55432:5432
// -e POSTGRES_PASSWORD=stn -e POSTGRES_DB=stn postgres:17-alpine, then postgres://postgres:stn@localhost:55432/stn).
// Not part of npm test, which has no Postgres: `npm run test:cluster`.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { C2S, S2C, ROOMF, PROTOCOL_VERSION, MOVED_CODE, REJECT_REASON, Writer, Reader } from '../shared/protocol.js';
import { PHASE } from '../shared/constants.js';
import { openDb } from '../server/db/index.js';

const URL_ = process.env.CLUSTER_TEST_DATABASE_URL;
if (!URL_) {
  console.log('SKIP  test-cluster: set CLUSTER_TEST_DATABASE_URL to a Postgres on this machine that may be wiped');
  process.exit(0);
}
if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(URL_)) {
  console.log('FAIL  test-cluster wipes its database: CLUSTER_TEST_DATABASE_URL has to be on localhost');
  process.exit(1);
}

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = 42000 + Math.floor(Math.random() * 800);
const procs = [];

// a fresh database
{
  const db = await openDb(URL_);
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.close();
}

function spawnIt(name, script, port, env = {}) {
  const proc = spawn(process.execPath, [script], {
    env: { ...process.env, DATABASE_URL: URL_, PORT: String(port), NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const s = { name, port, proc, log: '', exit: null };
  proc.stdout.on('data', (d) => (s.log += d));
  proc.stderr.on('data', (d) => (s.log += d));
  proc.on('exit', (code, signal) => (s.exit = { code, signal }));
  procs.push(s);
  return s;
}
const gameServer = (name, port, deployment) =>
  spawnIt(name, 'server/index.js', port, { CLUSTER: '1', CLUSTER_ID: name, CLUSTER_ADDR: '127.0.0.1', CLUSTER_DEPLOYMENT: deployment, GODMODE: '1', GAME_IDLE_SECONDS: '60', HANDOFF_RESERVE_SECONDS: '30' });
// (a player of their own for each game made: one game at a time each. The servers and the proxy believe X-Forwarded-For
// from this machine, as from a proxy of ours)
let players = 0;
const someone = () => `198.51.100.${++players}`;
const proxy = (port) => spawnIt('proxy', 'server/proxy/index.js', port);
const until = async (fn, ms = 15000) => {
  const t = Date.now() + ms;
  while (Date.now() < t) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};

const api = async (port, path, { method = 'GET', body, cookie, ip = method === 'POST' && path === '/api/games' ? someone() : '' } = {}) => {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (ip) headers['x-forwarded-for'] = ip;
  const r = await fetch(`http://localhost:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const set = r.headers.getSetCookie?.() || [];
  return { status: r.status, body: await r.json().catch(() => null), cookie: set.map((c) => c.split(';')[0]).join('; ') };
};

// a player: joins (a code, or none for a quick join), and says which game it was put in and how its socket closed
const client = (port, code = '', { name = 'Bot', pid = '', cookie = '' } = {}) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`, cookie ? { headers: { cookie } } : undefined);
    ws.binaryType = 'arraybuffer';
    const c = { ws, id: 0, room: null, reject: 0, closed: null };
    c.gone = new Promise((done) => (c.onGone = done));
    c.leave = () => new Promise((done) => (c.closed ? done() : ((ws.onclose = () => done()), ws.close(4000))));
    ws.onopen = () => {
      const w = new Writer(128);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str(pid);
      ws.send(w.bytes());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      const t = r.u8();
      if (t === S2C.ROOM) c.room = { code: r.str(), name: r.str(), inviteOnly: !!(r.u8() & ROOMF.INVITE_ONLY) };
      else if (t === S2C.WELCOME) {
        c.id = r.u16();
        c.seed = r.u32();
        resolve(c);
      } else if (t === S2C.REJECT) {
        c.reject = r.u8();
        resolve(c);
      }
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      c.closed = { code: e.code, reason: e.reason };
      c.onGone(c.closed);
      resolve(c);
    };
  });
// as the client does after MOVED_CODE (main.js moveBack): the same code again, a few times, giving up on 3 NO_GAMEs
async function moveBack(port, code, opts) {
  let noGame = 0;
  for (let i = 0; i < 40 && noGame < 3; i++) {
    const c = await client(port, code, opts);
    if (c.id) return { c, noGame };
    if (c.reject === REJECT_REASON.NO_GAME) noGame++;
    await sleep(250);
  }
  return { c: null, noGame };
}
// a /social socket, keeping what it hears
const social = (port, cookie) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/social`, { headers: { cookie } });
    const s = { ws, heard: [] };
    s.hear = (pred, ms = 8000) => until(() => s.heard.some(pred), ms);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      s.heard.push(msg);
      if (msg.t === 'hello') resolve(s);
    };
    ws.onerror = () => resolve(s);
  });
const db = await openDb(URL_);
const serverOf = async (code) => (await db.query('SELECT server_id FROM cluster_games WHERE code = $1', [code])).rows[0]?.server_id;

try {
  // ---------------------------------------------------------------- two servers and the proxy
  const A = gameServer('A', base, 'd1');
  const B = gameServer('B', base + 1, 'd1');
  check('A and B are up and in the cluster', await until(() => /cluster: A at/.test(A.log) && /cluster: B at/.test(B.log), 30000), A.log + B.log);
  let P = proxy(base + 2);
  check('the proxy is up and sees both', await until(async () => (await api(P.port, '/proxy/health').catch(() => null))?.body?.servers === 2), P.log);

  // ---------------------------------------------------------------- games by code
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const r = await api(P.port, '/api/games', { method: 'POST', body: { name: `Game ${i}`, inviteOnly: true } });
    if (r.status === 201) codes.push(r.body.code);
  }
  check('six invite-only games made through the proxy', codes.length === 6, JSON.stringify(codes));
  const where = await Promise.all(codes.map(serverOf));
  check('...spread over both servers', where.includes('A') && where.includes('B'), JSON.stringify(where));
  let joined = 0;
  let cards = 0;
  for (const code of codes) {
    for (let k = 0; k < 3; k++) {
      const c = await client(P.port, code, { name: `P${k}`, pid: randomUUID() });
      if (c.id && c.room?.code === code) joined++;
      c.ws.close();
    }
    if ((await api(P.port, `/api/games/${code}`)).status === 200) cards++;
  }
  check('every join by code through the proxy reaches its game (18 of 18)', joined === 18, `${joined}/18`);
  check("...and every game's invite card is found", cards === 6, `${cards}/6`);
  const nope = await client(P.port, 'ZZZZZZZZZZ');
  check('a code nobody has is still no game', nope.reject === REJECT_REASON.NO_GAME, JSON.stringify({ reject: nope.reject }));

  // ---------------------------------------------------------------- quick joins and the lobby
  const q = [];
  for (let i = 0; i < 4; i++) q.push(await client(P.port, '', { name: `Q${i}`, pid: randomUUID() }));
  const qCodes = new Set(q.map((c) => c.room?.code));
  check('four quick joins through the proxy share one game', q.every((c) => c.id) && qCodes.size === 1, JSON.stringify([...qCodes]));
  const pubA = await api(P.port, '/api/games', { method: 'POST', body: { name: 'Public one' } });
  const pubB = await api(P.port, '/api/games', { method: 'POST', body: { name: 'Public two' } });
  await sleep(2500); // (each server's row brought up to date)
  const lobby = await api(P.port, '/api/games');
  const listed = new Set((lobby.body?.list || []).map((g) => g.code));
  const pubWhere = new Set([await serverOf(pubA.body?.code), await serverOf(pubB.body?.code), await serverOf([...qCodes][0])]);
  check("the lobby lists every server's public games", listed.has(pubA.body?.code) && listed.has(pubB.body?.code) && listed.has([...qCodes][0]) && pubWhere.size === 2, JSON.stringify({ list: [...listed], pubWhere: [...pubWhere] }));
  check('...and counts the games of both', lobby.body?.games >= 9 && lobby.body?.canCreate === true, JSON.stringify({ games: lobby.body?.games, canCreate: lobby.body?.canCreate }));
  for (const c of q) c.ws.close();
  const st = await api(P.port, '/status');
  check('/status through the proxy has both servers', st.body?.servers?.length === 2 && st.body.servers.every((s) => s.server?.id), JSON.stringify(st.body?.servers?.map((s) => s.id)));

  // ---------------------------------------------------------------- one game each, and the most at once, over both
  {
    const ip = someone();
    const first = await api(A.port, '/api/games', { method: 'POST', body: { name: 'Mine', inviteOnly: true }, ip });
    const second = await api(B.port, '/api/games', { method: 'POST', body: { name: 'Mine too', inviteOnly: true }, ip });
    check('a player with a game on A cannot make another on B, and is told its code', first.status === 201 && second.status === 409 && second.body?.code === first.body?.code, JSON.stringify([first.status, second]));
    const n = (await db.query('SELECT count(*)::int AS n FROM cluster_games')).rows[0].n;
    await db.query(`INSERT INTO server_settings (key, value) VALUES ('max_total_games', $1::jsonb)`, [JSON.stringify(n)]);
    await sleep(6000); // (the servers and the proxy read the settings every 5 s)
    const over = await api(P.port, '/api/games', { method: 'POST', body: { name: 'Over' } });
    const lobbyFull = await api(P.port, '/api/games');
    check(`max_total_games set in the database to the ${n} running: no more, on any server, without a restart`, over.status === 503 && lobbyFull.body?.canCreate === false && lobbyFull.body?.maxGames === n, JSON.stringify([over, lobbyFull.body?.canCreate, lobbyFull.body?.maxGames]));
    await db.query(`DELETE FROM server_settings WHERE key = 'max_total_games'`);
    await sleep(6000);
    const free = await api(P.port, '/api/games', { method: 'POST', body: { name: 'Free again', inviteOnly: true } });
    check('...and unset, games are made again', free.status === 201, JSON.stringify(free));
  }

  // ---------------------------------------------------------------- friends on two servers
  const reg = async (n) => api(P.port, '/api/auth/register', { method: 'POST', body: { email: `${n}@test.example`, username: n, password: 'password123' } });
  const ann = await reg('Ann');
  const ben = await reg('Ben');
  check('two accounts made through the proxy', ann.status === 201 && ben.status === 201, JSON.stringify([ann.status, ben.status, ann.body, ben.body]));
  const annId = ann.body?.user?.id;
  const benId = ben.body?.user?.id;
  // (straight to a server each: one's /social socket is on A, the other's on B)
  const annSoc = await social(A.port, ann.cookie);
  const benSoc = await social(B.port, ben.cookie);
  check('their /social sockets are on A and on B', annSoc.heard[0]?.t === 'hello' && benSoc.heard[0]?.t === 'hello');
  await api(A.port, '/api/friends/request', { method: 'POST', body: { username: 'Ben' }, cookie: ann.cookie });
  check("Ben, on B, hears Ann's request made on A", await benSoc.hear((m) => m.t === 'friends' && m.why === 'request' && m.who?.id === annId));
  await api(B.port, '/api/friends/accept', { method: 'POST', body: { id: annId }, cookie: ben.cookie });
  check('Ann, on A, hears Ben accept on B', await annSoc.hear((m) => m.t === 'friends' && m.why === 'accepted' && m.who?.id === benId));
  const dm = await api(A.port, '/api/messages', { method: 'POST', body: { to: benId, body: 'over here' }, cookie: ann.cookie });
  check("a message from A (friendship cached on A before B's accept) is let through", dm.status === 201, JSON.stringify(dm));
  check('...and reaches Ben on B', await benSoc.hear((m) => m.t === 'dm' && m.message?.body === 'over here'));
  const onlineB = await api(B.port, '/api/friends', { cookie: ben.cookie });
  check('B sees Ann online on A', onlineB.body?.friends?.[0]?.status === 'online', JSON.stringify(onlineB.body?.friends));
  // Ben plays in a game on A, through the proxy
  const onA = codes[where.indexOf('A')];
  const benPlay = await client(P.port, onA, { name: 'Ben', pid: randomUUID(), cookie: ben.cookie });
  check('Ben, signed in, joins a game on A through the proxy', benPlay.id > 0, JSON.stringify({ reject: benPlay.reject, closed: benPlay.closed }));
  check('Ann hears he is playing', await annSoc.hear((m) => m.why === 'presence' && m.who?.id === benId && m.status === 'playing'));
  const fromB = await api(B.port, '/api/friends', { cookie: ann.cookie });
  const benRow = fromB.body?.friends?.find((f) => f.id === benId);
  check('B, which has none of it, says Ben is playing, and where', benRow?.status === 'playing' && benRow.game?.code === onA, JSON.stringify(benRow));
  const join = await api(B.port, `/api/friends/${benId}/game`, { cookie: ann.cookie });
  check("...and gives Ann that game's code to join him", join.status === 200 && join.body?.code === onA, JSON.stringify(join));
  benPlay.ws.close();
  check('Ann hears he stopped', await annSoc.hear((m) => m.why === 'presence' && m.who?.id === benId && m.status === 'online'));
  await api(B.port, '/api/auth/logout', { method: 'POST', body: {}, cookie: ann.cookie });
  check('signing out on B closes her /social socket on A', await until(() => annSoc.ws.readyState === 3, 5000));
  benSoc.ws.close();

  // ---------------------------------------------------------------- a deploy: C comes, A goes
  const pid = randomUUID();
  const onA2 = (await api(P.port, '/api/games', { method: 'POST', body: { name: 'Moving', inviteOnly: true } })).body?.code;
  // (made on the least busy server: whichever it is, that one is the one to stop)
  const from = await serverOf(onA2);
  const S = from === 'A' ? A : B;
  const stays = from === 'A' ? 'B' : 'A';
  const player = await client(P.port, onA2, { name: 'Mover', pid });
  await until(async () => [PHASE.DAY, PHASE.NIGHT].includes((await api(P.port, `/api/games/${onA2}`)).body?.phase));
  check(`a player in a game on ${from}`, player.id > 0, JSON.stringify(player));
  const C = gameServer('C', base + 3, 'd2');
  check('C, of a newer deployment, is up', await until(async () => (await api(P.port, '/proxy/health')).body?.servers === 3, 30000), C.log);
  await sleep(2500); // (A's view of the servers has C in it)
  S.proc.kill('SIGTERM');
  const gone = await Promise.race([player.gone, sleep(15000).then(() => null)]);
  check(`${from} going down ends the socket as moved`, gone?.code === MOVED_CODE, JSON.stringify(gone));
  const back = await moveBack(P.port, onA2, { name: 'Mover', pid });
  check('the player is back through the proxy, in their own body, with no NO_GAME on the way', back.c?.id === player.id && back.c.seed === player.seed && back.noGame === 0, JSON.stringify({ id: back.c?.id, was: player.id, noGame: back.noGame }));
  check('...on C, the newer deployment, not on the old one still up', (await serverOf(onA2)) === 'C' && /restored from the last server/.test(C.log) && !new RegExp(`game ${onA2} restored`).test(stays === 'A' ? A.log : B.log), JSON.stringify({ on: await serverOf(onA2) }));
  const maker = (await db.query('SELECT maker FROM cluster_games WHERE code = $1', [onA2])).rows[0]?.maker;
  check("...still its maker's one game there", /^ip:198\.51\.100\.\d+$/.test(maker || ''), JSON.stringify(maker));
  check(`${from} exits cleanly`, await until(() => S.exit?.code === 0, 25000), JSON.stringify(S.exit));
  check(`...and leaves no rows behind`, (await db.query('SELECT count(*)::int AS n FROM cluster_servers WHERE id = $1', [from])).rows[0].n === 0);

  // ---------------------------------------------------------------- the proxy restarted
  const t0 = Date.now();
  P.proc.kill('SIGTERM');
  const moved = await Promise.race([back.c.gone, sleep(8000).then(() => null)]);
  check('the proxy going down ends its game sockets as moved, between two frames', moved?.code === MOVED_CODE, JSON.stringify(moved));
  check('...and exits cleanly', await until(() => P.exit?.code === 0, 8000), JSON.stringify(P.exit));
  P = proxy(base + 2);
  await until(async () => (await api(P.port, '/proxy/health').catch(() => null))?.body?.servers >= 2);
  const again = await moveBack(P.port, onA2, { name: 'Mover', pid });
  check(`the player is back through the new proxy, in their own body (${Date.now() - t0} ms)`, again.c?.id === player.id, JSON.stringify({ id: again.c?.id }));
  again.c?.ws.close();
} catch (err) {
  failed++;
  console.log('FAIL  threw:', err.stack);
} finally {
  for (const p of procs) if (!p.exit) p.proc.kill('SIGKILL');
  await db.close().catch(() => {});
  if (failed) for (const p of procs) console.log(`\n---- ${p.name} :${p.port}\n${p.log.split('\n').slice(-25).join('\n')}`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
