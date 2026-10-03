// The lobby and its games (server/rooms.js, server/room-worker.js, the /ws and /api/games routes of server/index.js)
// against a real server process: quick joins sharing a game, games made public or invite-only, joining by code, a
// full game and a missing one turning a socket away, the leaderboard answered across the thread, a seat handed to a
// new socket only once the old one's traffic is done, empty games shutting down, and the per-address allowances.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { C2S, S2C, ROOMF, REJECT_REASON, PROTOCOL_VERSION, BOARDF, Writer, Reader, readBoard } from '../shared/protocol.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'stn-rooms-'));
const servers = [];

async function server(env) {
  const port = 39100 + Math.floor(Math.random() * 800);
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: join(dir, `stats-${port}.json`), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { port, proc, log: '' };
  proc.stdout.on('data', (d) => (s.log += d));
  proc.stderr.on('data', (d) => (s.log += d));
  servers.push(s);
  for (let i = 0; i < 100 && !s.log.includes('listening'); i++) await sleep(50);
  if (!s.log.includes('listening')) throw new Error(`server did not start:\n${s.log}`);
  const base = `http://localhost:${port}`;
  s.get = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  s.post = async (body, type = 'application/json') => {
    const res = await fetch(base + '/api/games', { method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  // a client: joins (game code, or none for a quick join) and keeps what it is sent. Resolves once it is in or out
  s.client = (code = '', name = 'bot', pid = '') =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`);
      ws.binaryType = 'arraybuffer';
      const c = { ws, order: [], room: null, id: 0, reject: 0, board: null, snaps: 0, closed: false };
      c.send = (w) => ws.readyState === 1 && ws.send(w.bytes());
      c.close = () => new Promise((done) => (c.closed ? done() : ((ws.onclose = () => ((c.closed = true), done())), ws.close())));
      ws.onopen = () => {
        const w = new Writer(128);
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str(name);
        w.str(pid);
        c.send(w);
      };
      ws.onmessage = (m) => {
        const r = new Reader(m.data);
        const t = r.u8();
        c.order.push(t);
        if (t === S2C.ROOM) c.room = { code: r.str(), name: r.str(), inviteOnly: !!(r.u8() & ROOMF.INVITE_ONLY) };
        else if (t === S2C.WELCOME) {
          c.id = r.u16();
          resolve(c);
        } else if (t === S2C.REJECT) {
          c.reject = r.u8();
          resolve(c);
        } else if (t === S2C.BOARD) c.board = readBoard(r);
        else if (t === S2C.SNAPSHOT) c.snaps++;
      };
      ws.onclose = () => {
        c.closed = true;
        resolve(c);
      };
    });
  return s;
}

try {
  const S = await server({ GAME_IDLE_SECONDS: '2', JOIN_WAIT_SECONDS: '1' });

  // ---- the lobby, empty
  {
    const { status, body } = await S.get('/api/games');
    check('an empty lobby lists nothing and can make games', status === 200 && body.list.length === 0 && body.canCreate && body.games === 0, JSON.stringify(body));
  }

  // ---- quick joins share a public game
  const q1 = await S.client('', 'Ann');
  const q2 = await S.client('', 'Ben');
  check('two quick joins land in the same public game', q1.id && q2.id && q1.room?.code === q2.room?.code && /^[A-Z2-9]{6}$/.test(q1.room.code) && !q1.room.inviteOnly, JSON.stringify([q1.room, q2.room]));
  check('a socket is told its game before anything else', q1.order[0] === S2C.ROOM && q1.order[1] === S2C.WELCOME, q1.order.join());
  await sleep(1200);
  check('...and is sent snapshots', q1.snaps > 5, String(q1.snaps));
  {
    const { body } = await S.get('/api/games');
    const g = body.list.find((x) => x.code === q1.room.code);
    check('the quick game is listed with its players, named after the first in', g && g.players === 2 && g.max === 8 && g.name === "Ann's game", JSON.stringify(body.list));
  }

  // ---- an invite-only game
  const made = await S.post({ name: 'The <b>Crypt</b>', host: 'Cat', inviteOnly: true, maxPlayers: 2 });
  const code = made.body?.code;
  check('an invite-only game gets a long code', made.status === 201 && /^[A-Z2-9]{10}$/.test(code) && made.body.inviteOnly && made.body.max === 2, JSON.stringify(made));
  check('...and a clean name', made.body?.name === 'The bCryptb', made.body?.name);
  {
    const { body } = await S.get('/api/games');
    check('...is not listed', !body.list.some((g) => g.code === code) && body.games === 2, JSON.stringify(body.list));
    const one = await S.get(`/api/games/${code}`);
    check('...but its link finds it', one.status === 200 && one.body.code === code && one.body.inviteOnly, JSON.stringify(one));
    const lower = await S.get(`/api/games/${code.toLowerCase()}`);
    check('...whatever the case of the code', lower.status === 200 && lower.body.code === code);
  }
  const i1 = await S.client(code, 'Cat');
  const i2 = await S.client(code.toLowerCase(), 'Dee');
  check('two join it by its code', i1.id && i2.id && i1.room.code === code && i2.room.code === code && i1.room.inviteOnly, JSON.stringify([i1.room, i2.room, i1.reject, i2.reject]));
  const i3 = await S.client(code, 'Eve');
  check('a third is turned away: the game is full', i3.reject === REJECT_REASON.FULL && !i3.id && i3.order.join() === String(S2C.REJECT), `${i3.reject} ${i3.order}`);
  {
    const one = await S.get(`/api/games/${code}`);
    check('...and the lobby says it is full', one.body.full === true && one.body.seats === 2, JSON.stringify(one.body));
  }
  {
    // a socket that takes a seat and never joins does not keep it
    await i2.close();
    const idle = new WebSocket(`ws://localhost:${S.port}/ws?game=${code}`);
    let shut = false;
    let opened = false;
    idle.onopen = () => (opened = true);
    idle.onclose = () => (shut = true);
    await sleep(300);
    const blocked = await S.client(code, 'Eve');
    for (let i = 0; i < 80 && !shut; i++) await sleep(50);
    const back = await S.client(code, 'Dee');
    check('a socket that never joins holds a seat a while, then loses it', opened && blocked.reject === REJECT_REASON.FULL && shut && back.id > 0, `${opened} ${blocked.reject} ${shut} ${back.reject}`);
    i2.close = back.close;
  }
  const nope = await S.client('ZZZZZZ', 'Fay');
  check('a code nobody has: turned away as no game', nope.reject === REJECT_REASON.NO_GAME, String(nope.reject));
  check('...and the lobby has no game by it', (await S.get('/api/games/ZZZZZZ')).status === 404);

  // ---- the leaderboard, kept on the network thread, answers a game's player
  {
    const pid = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const lb = await S.client(q1.room.code, 'Gus', pid);
    await sleep(100);
    const w = new Writer(4);
    w.u8(C2S.BOARD);
    lb.send(w);
    for (let i = 0; i < 40 && !lb.board; i++) await sleep(25);
    const me = lb.board?.rows.find((r) => r.me);
    check('a player asking for the board gets it, with their own row in this game', !!me && me.name === 'Gus' && me.here, JSON.stringify(lb.board));
    await lb.close();
  }

  // ---- making games: what is asked for, and what is refused
  {
    const big = await S.post({ name: 'Big', maxPlayers: 99 });
    check('a game asked for with too many seats gets the most there may be', big.status === 201 && big.body.max === 16 && !big.body.inviteOnly && /^[A-Z2-9]{6}$/.test(big.body.code), JSON.stringify(big));
    check('a form post is refused', (await S.post('name=x', 'application/x-www-form-urlencoded')).status === 415);
    check('so is bad JSON', (await S.post('{nope')).status === 400);
    // a seat comes free for a new socket only once the old one's traffic is done with: nothing meant for the old
    // socket reaches the new one, so every newcomer hears of its game, then is welcomed, then gets snapshots
    const keep = await S.client(big.body.code, 'Hal');
    let clean = 0;
    let order = '';
    for (let i = 0; i < 10; i++) {
      const c = await S.client(big.body.code, `R${i}`);
      for (let k = 0; k < 40 && !c.snaps; k++) await sleep(25);
      await sleep((i % 3) * 30);
      const ok = c.id && c.order[0] === S2C.ROOM && c.order[1] === S2C.WELCOME && c.order.indexOf(S2C.SNAPSHOT) > 1;
      if (ok) clean++;
      else order = `${c.reject} ${c.order.join()}`;
      await c.close();
    }
    check('ten sockets in a row through the seats of one game each start clean', clean === 10, `${clean}/10 ${order}`);
    await keep.close();
    const third = await S.post({ name: 'Third' });
    const fourth = await S.post({ name: 'One too many' });
    check('an address making game after game is told to wait', third.status === 201 && fourth.status === 429, JSON.stringify([third.status, fourth]));
  }

  // ---- empty games shut down
  for (const c of [q1, q2, i1, i2]) await c.close();
  let left = -1;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    left = (await S.get('/api/games')).body.games;
    if (!left) break;
  }
  check('every game shuts down once it has been empty a while', left === 0, String(left));
  {
    // (a game builds a valley when it starts and then only for someone who joins it: not the moment it empties)
    const built = {};
    for (const m of S.log.matchAll(/\[game ([A-Z2-9]+)\] world seed/g)) built[m[1]] = (built[m[1]] || 0) + 1;
    check('a game that empties builds no new valley for nobody', Object.keys(built).length >= 4 && Object.values(built).every((n) => n === 1), JSON.stringify(built));
  }
  check('...and its worker is gone', /game [A-Z2-9]+ closed: empty/.test(S.log) && !/crashed|stopped \(exit/.test(S.log), S.log.split('\n').filter((l) => /closed|crash|stopped/.test(l)).join(' | '));

  // ---- guessing codes gets nowhere
  {
    const T = await server({}); // (a fresh allowance: this address used up the first server's making games above)
    const h = await T.post({ name: 'Hidden', inviteOnly: true });
    let misses = 0;
    for (let i = 0; i < 25; i++) if ((await T.get(`/api/games/ZZZZZ${'23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[i]}`)).status === 404) misses++;
    const real = await T.get(`/api/games/${h.body.code}`);
    check('an address that keeps asking for codes that are not there is told the real ones are not there either', misses === 25 && real.status === 404, `${misses} ${real.status}`);
  }

  // ---- a box at capacity
  {
    const U = await server({ LOBBY_LIMITS: '0', MAX_GAMES: '2' });
    const a = await U.post({ name: 'A' });
    const b = await U.post({ name: 'B' });
    const c = await U.post({ name: 'C' });
    check('a box running its most games makes no more', a.status === 201 && b.status === 201 && c.status === 503 && !!c.body?.error, JSON.stringify(c));
    const qa = await U.client(a.body.code, 'In');
    const qq = await U.client('', 'Quick');
    check('...but a quick join still finds a seat in a running game', qq.id && [a.body.code, b.body.code].includes(qq.room?.code), JSON.stringify(qq.room));
    await qa.close();
    await qq.close();
  }
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
} finally {
  for (const s of servers) s.proc.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
