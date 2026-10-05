// The bestiary (shared/bestiary.js, server/bestiary.js, server/userbestiary.js, client/net/bestiary.js):
//   - the book: every kind of the dead once, each with a vague line that does not name it and a tip
//   - a running Game: a kind is seen within SEEN_RANGE with a clear line to it, once; not out of range, not dead, not
//     through the ground; kinds already seen cost no line of sight; a rejoin is told the record again
//   - an account in a game: nothing looked for until its record has come, then each new kind told and posted once
//   - the browser's record: a guest's kept in localStorage, the toast only for what is new, an account's not stored
//   - the store on PGlite: one read as a player joins, one row per new kind, retried when a write fails
//   - a real server: an account sees a runner, and after a restart its next game says so
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BESTIARY, BESTIARY_ALL, BESTF, SEEN_RANGE, bit, cleanSeen, seenCount } from '../shared/bestiary.js';
import { C2S, S2C, PROTOCOL_VERSION, SNAP, Writer, Reader } from '../shared/protocol.js';
import { ZTYPE, ZOMBIE_DEFS, EVT } from '../shared/defs.js';
import { readEvents, readSnapshot } from '../client/net/decode.js';
import { Game } from '../server/game.js';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { BestiaryStore } from '../server/userbestiary.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the book
{
  const kinds = Object.values(ZTYPE);
  const ts = BESTIARY.map((e) => e.t);
  check(`every one of the ${kinds.length} kinds of the dead is in the book, once`, ts.length === kinds.length && new Set(ts).size === ts.length && kinds.every((t) => ts.includes(t)), ts.join());
  check('every entry has a name, a group, a vague line and a tip', BESTIARY.every((e) => e.name === ZOMBIE_DEFS[e.t].name && e.group && e.vague?.length > 10 && e.tip?.length > 20));
  const leaks = BESTIARY.filter((e) => e.vague.toLowerCase().includes(e.name.replace(/^The /, '').toLowerCase()));
  check("no vague line gives away the monster's name", !leaks.length, leaks.map((e) => e.name).join());
  check('a record fits the u16 on the wire', BESTIARY_ALL < 1 << 16 && seenCount(BESTIARY_ALL) === BESTIARY.length);
  check('a mask from anywhere keeps only kinds the book has', cleanSeen(1 << 20 | bit(ZTYPE.RUNNER)) === bit(ZTYPE.RUNNER) && cleanSeen('3') === 0 && cleanSeen(-1) === BESTIARY_ALL);
}

// ---------------------------------------------------------------- in a game
// What each player was sent: EVT.BESTIARY events, decoded by the client's own reader
function watch(game) {
  const got = new Map(); // player id -> [{ flags, mask }]
  const emit = game.emit.bind(game);
  game.emit = (fn, opts = {}) => {
    emit(fn, opts);
    const ev = game.events[game.events.length - 1];
    if (ev.bytes[0] !== EVT.BESTIARY) return;
    const buf = new Uint8Array(ev.bytes.length + 1);
    buf[0] = 1;
    buf.set(ev.bytes, 1);
    const r = new Reader(buf);
    readEvents(r, { bestiary: (flags, mask) => (got.get(ev.to) || got.set(ev.to, []).get(ev.to)).push({ flags, mask }) }, SNAP.EVENTS, new Map());
    if (r.left) throw new Error(`${r.left} bytes left after an EVT.BESTIARY`);
  };
  got.of = (p) => got.get(p.id) || [];
  got.clear = () => got.forEach((l) => (l.length = 0));
  return got;
}
function enter(game, name, opts = {}) {
  const c = {};
  c.conn = { user: opts.user || null, send() {}, congested: () => false, cork: (fn) => fn() };
  c.session = game.onOpen(c.conn);
  const w = new Writer(96);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(opts.pid ?? randomUUID());
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.session.player?.id);
  return c;
}
const wait = (game, secs) => {
  for (let i = 0; i < secs * 20; i++) game.update();
};
// Only the dead a test puts down count: the rest (the day's, the waves) are dead the moment they come
function quiet(game) {
  const spawn = game.zm.spawn.bind(game.zm);
  game.zm.spawn = (...a) => {
    const z = spawn(...a);
    if (z && !game.zm.ours) z.dead = true;
    return z;
  };
}
function own(game, type, x, z) {
  game.zm.ours = true;
  const e = game.zm.spawn(type, x, z);
  game.zm.ours = false;
  return e;
}
// one of the dead `d` m off to the side of p, standing on the ground
function put(game, p, type, d) {
  const z = own(game, type, p.state.x + d, p.state.z);
  if (z) z.y = game.world.heightAt(z.x, z.z);
  return z;
}
const masks = (list) => list.map((e) => `${e.flags}:${e.mask}`).join(' ');

{
  const game = new Game({ seed: 4242, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  quiet(game);
  const got = watch(game);
  const pid = randomUUID();
  const Ann = enter(game, 'Ann', { pid });
  const ann = Ann.p();
  wait(game, 0.5);
  check('a guest who joins is told whose record it is: the whole of it, nothing yet, not an account', masks(got.of(ann)) === `${BESTF.ALL}:0`, masks(got.of(ann)));
  got.clear();

  put(game, ann, ZTYPE.WALKER, 8);
  wait(game, 0.5);
  check('a walker 8 m away in plain sight: seen, and the client told', masks(got.of(ann)) === `0:${bit(ZTYPE.WALKER)}` && ann.bst.seen === bit(ZTYPE.WALKER), masks(got.of(ann)));
  got.clear();
  put(game, ann, ZTYPE.WALKER, -6);
  wait(game, 1);
  check('...another walker is no news', !got.of(ann).length);

  const far = put(game, ann, ZTYPE.RUNNER, SEEN_RANGE + 15);
  if (far) far.speed = 0;
  wait(game, 0.5);
  const runnerFar = got.of(ann).length;
  const dead = put(game, ann, ZTYPE.SPITTER, 5);
  dead.dead = true;
  dead.hp = 0;
  wait(game, 0.5);
  check(`a runner ${SEEN_RANGE + 15} m off is not seen, nor a spitter already dead at 5 m`, !runnerFar && !got.of(ann).length, masks(got.of(ann)));

  // under the ground: the line to it goes through the terrain
  const deep = own(game, ZTYPE.BOOMER, ann.state.x + 10, ann.state.z);
  deep.y = game.world.heightAt(deep.x, deep.z) - 25;
  game.zm.rebuildHash();
  const st = game.bestiary.of(ann);
  game.bestiary.look(ann, st);
  check('a boomer 25 m under the ground, inside the range: no clear line, not seen', !(st.seen & bit(ZTYPE.BOOMER)) && !st.fresh);
  deep.y += 25;
  game.bestiary.look(ann, st);
  check('...brought up to the surface: seen', !!(st.seen & bit(ZTYPE.BOOMER)));
  wait(game, 0.3);
  got.clear();

  // what it costs: kinds already seen are not looked at; unseen ones are, a few lines a look at most
  for (const z of game.zombies) z.dead = true;
  wait(game, 2); // (the corpses swept)
  const clear = game.zm.clearLine.bind(game.zm);
  let rays = 0;
  // (the zombies look along lines of their own: only the ones from Ann's eye are the bestiary's)
  game.zm.clearLine = (...a) => (a[0] === ann.state.x && a[2] === ann.state.z && rays++, clear(...a));
  for (let i = 0; i < 40; i++) put(game, ann, ZTYPE.WALKER, 4 + (i % 10) * 2.5);
  wait(game, 2);
  check('40 walkers about a survivor who has seen walkers: not one line of sight in 2 s', rays === 0, String(rays));
  const z0 = ann.state;
  for (let i = 0; i < 20; i++) {
    const z = own(game, ZTYPE.LEAPER, z0.x + 6 + i, z0.z + 6);
    z.y = game.world.heightAt(z.x, z.z) - 30; // (out of sight, under the ground: tried every look, never seen)
  }
  rays = 0;
  game.zm.rebuildHash();
  game.bestiary.look(ann, st);
  check('20 unseen leapers out of sight: at most 6 lines of sight a look', rays > 0 && rays <= 6, String(rays));
  game.zm.clearLine = clear;
  for (const z of game.zombies) z.dead = true;
  wait(game, 2);

  // a drop and a rejoin: the new client is told the record again
  got.clear();
  game.onClose(Ann.session, 1006);
  const Ann2 = enter(game, 'Ann', { pid });
  wait(game, 0.3);
  const want = bit(ZTYPE.WALKER) | bit(ZTYPE.BOOMER);
  check('back after a drop: the same body, and the whole record sent again', Ann2.p() === ann && masks(got.of(ann)) === `${BESTF.ALL}:${want}`, masks(got.of(ann)));

  // a held player sees nothing; a backed-up socket is told later, not never
  const Bob = enter(game, 'Bob');
  const bob = Bob.p();
  for (const z of game.zombies) z.dead = true;
  wait(game, 2);
  got.clear();
  let backed = true;
  Bob.conn.congested = () => backed;
  put(game, bob, ZTYPE.ROPER, 6);
  wait(game, 0.5);
  const whileBacked = got.of(bob).length;
  backed = false;
  wait(game, 0.2);
  check('a client whose socket is backed up hears of it once the socket clears', !whileBacked && masks(got.of(bob)) === `0:${bit(ZTYPE.ROPER)}`, masks(got.of(bob)));
}

// an account: nothing until its record has come; then each new kind is told (BESTF.ACCOUNT) and posted, once
{
  const posted = [];
  const game = new Game({ seed: 4242, godMode: true, dayLength: 3600, themes: false, bestiary: (m) => posted.push(m), log: () => {} });
  quiet(game);
  const got = watch(game);
  const user = { id: '7c9e6679-7425-40de-944b-000000000001', name: 'Acct' };
  const Acc = enter(game, 'Acct', { user });
  const acc = Acc.p();
  acc.rec ||= {};
  acc.rec.tok = 77;
  put(game, acc, ZTYPE.WALKER, 6);
  put(game, acc, ZTYPE.DOG, -7);
  wait(game, 1);
  check("an account's record not in yet: nothing looked for, nothing sent, nothing posted", !got.of(acc).length && !posted.length && !acc.bst.seen, masks(got.of(acc)));
  game.onBestiary(77, bit(ZTYPE.WALKER) | bit(ZTYPE.TANK) | (1 << 22));
  wait(game, 1);
  const first = got.of(acc);
  check("its record comes: the whole of it to the client as the account's, then the dog it can see now", masks(first) === `${BESTF.ALL | BESTF.ACCOUNT}:${bit(ZTYPE.WALKER) | bit(ZTYPE.TANK)} ${BESTF.ACCOUNT}:${bit(ZTYPE.DOG)}`, masks(first));
  check('...and the dog posted to the network thread to be written; the walker it had already is not', posted.length === 1 && posted[0].user === user.id && posted[0].mask === bit(ZTYPE.DOG), JSON.stringify(posted));
  wait(game, 3);
  check('...once: three more seconds with the dog in sight post nothing more', posted.length === 1, JSON.stringify(posted));
}

// ---------------------------------------------------------------- the browser's record
{
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const b = await import('../client/net/bestiary.js');
  const shown = [];
  b.onSeen((list) => shown.push(...list.map((e) => e.name)));
  b.joinedBestiary();
  b.bestiaryEvent(BESTF.ALL, 0);
  b.bestiaryEvent(0, bit(ZTYPE.RUNNER) | bit(ZTYPE.BOSS_BRUTE));
  check("a guest: what they saw is kept in this browser, and toasted", b.bestiaryView().mask === (bit(ZTYPE.RUNNER) | bit(ZTYPE.BOSS_BRUTE)) && !b.bestiaryView().account && shown.join() === 'Runner,The Brute' && JSON.parse(mem.get('stn.bestiary')).seen === b.bestiaryView().mask, shown.join());
  b.bestiaryEvent(0, bit(ZTYPE.RUNNER));
  b.bestiaryEvent(BESTF.ALL, bit(ZTYPE.WALKER));
  check('...a kind it has is no news, and the whole record on a rejoin is added without a toast', shown.length === 2 && !!(b.bestiaryView().mask & bit(ZTYPE.WALKER)), shown.join());
  b.joinedBestiary();
  b.bestiaryEvent(BESTF.ALL | BESTF.ACCOUNT, bit(ZTYPE.TANK));
  b.bestiaryEvent(BESTF.ACCOUNT, bit(ZTYPE.SHADE));
  const v = b.bestiaryView();
  check("an account's: shown from what the game sent, toasted, and never put in the browser's record", v.account && v.mask === (bit(ZTYPE.TANK) | bit(ZTYPE.SHADE)) && shown.at(-1) === 'Shade' && !(JSON.parse(mem.get('stn.bestiary')).seen & bit(ZTYPE.SHADE)), JSON.stringify(v));
  b.joinedBestiary();
  check("...the next game, as a guest: the browser's own record again", !b.bestiaryView().account && b.bestiaryView().mask & bit(ZTYPE.RUNNER));
  mem.set('stn.bestiary', '{"v":1,"seen":"everything"}');
  check('a stored record that is junk reads as nothing seen', b.bestiaryView().mask === 0);
}

// ---------------------------------------------------------------- the accounts' store
{
  const db = await openDb('pglite:memory');
  await migrate(db);
  const user = async (name) => (await db.query(`INSERT INTO users (email, username, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [`${name}@x.io`, name])).rows[0].id;
  const [A, B] = [await user('a'), await user('b')];
  const store = new BestiaryStore({ db });
  const query = db.query.bind(db);
  const sql = [];
  db.query = (q, p) => (sql.push(q.trim().split(/\s+/)[0]), query(q, p));
  const rows = async (u) => (await query('SELECT ztype, seen_at FROM user_bestiary WHERE user_id = $1 ORDER BY ztype', [u])).rows;

  check('an account that has seen nothing', (await store.load(A)) === 0);
  sql.length = 0;
  // a game: it saw a walker, then a runner and a walker again (posted by two games at once), then nothing new
  store.add(A, bit(ZTYPE.WALKER));
  store.add(A, bit(ZTYPE.RUNNER) | bit(ZTYPE.WALKER));
  check('...what is not written yet is in its record already', (await store.load(A)) === (bit(ZTYPE.WALKER) | bit(ZTYPE.RUNNER)));
  sql.length = 0;
  await sleep(400);
  check('written within a moment, in one statement: no reads in between', sql.join() === 'INSERT', sql.join());
  const r1 = await rows(A);
  check('one row per kind seen', r1.map((r) => r.ztype).join() === `${ZTYPE.WALKER},${ZTYPE.RUNNER}`, JSON.stringify(r1));
  store.add(A, bit(ZTYPE.WALKER));
  await store.flush();
  const r2 = await rows(A);
  check('a kind it has already stays as it was (when it was first seen)', r2.length === 2 && +r2[0].seen_at === +r1[0].seen_at);
  check('read back as the record a game is given', (await store.load(A)) === (bit(ZTYPE.WALKER) | bit(ZTYPE.RUNNER)));

  sql.length = 0;
  store.add('not-an-id', 1);
  store.add(A, 1 << 22);
  await store.flush();
  check('junk is never written', !sql.length, sql.join());
  store.add('7c9e6679-7425-40de-944b-00000000dead', bit(ZTYPE.BAT));
  store.add(B, bit(ZTYPE.BAT));
  await store.flush();
  check('an account that is gone does not hold up the rest', (await store.load(B)) === bit(ZTYPE.BAT));

  db.query = async () => {
    throw new Error('down');
  };
  store.add(B, bit(ZTYPE.SHADE));
  await store.flush();
  db.query = query;
  check('a write that fails keeps what it had...', store.q.get(B) === bit(ZTYPE.SHADE));
  await store.flush();
  check('...and the next one writes it', (await store.load(B)) === (bit(ZTYPE.BAT) | bit(ZTYPE.SHADE)) && !store.q.size);
  await store.close();
  await db.close();
}

// ---------------------------------------------------------------- a real server
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const dir = mkdtempSync(join(tmpdir(), 'stn-bestiary-'));
async function startServer(env) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: '', HANDOFF: '0', GAME_IDLE_SECONDS: '2', LOBBY_LIMITS: '0', NODE_ENV: 'test', DEV_ADMIN: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  proc.log = () => log;
  proc.done = new Promise((r) => proc.once('exit', r));
  for (let i = 0; i < 200 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  return { port, proc, base: `http://localhost:${port}` };
}
function play(port, cookie, name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, { headers: cookie ? { cookie } : {} });
    ws.binaryType = 'arraybuffer';
    const c = { ws, seen: [], net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} } };
    const nop = () => {};
    c.handler = new Proxy({ bestiary: (flags, mask) => c.seen.push({ flags, mask }) }, { get: (t, k) => t[k] || nop });
    ws.onopen = () => {
      const w = new Writer(128);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str(randomUUID());
      ws.send(w.bytes());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      const t = r.u8();
      if (t === S2C.WELCOME) resolve(c);
      else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
    };
    c.say = (text) => {
      const w = new Writer(128);
      w.u8(C2S.CHAT);
      w.str(text);
      ws.send(w.bytes());
    };
    c.close = () => new Promise((done) => ((ws.onclose = done), ws.close(4001)));
  });
}
const heard = async (fn, ms = 6000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (fn()) return true;
  return false;
};
try {
  const env = { DATABASE_URL: `pglite:${join(dir, 'db')}` };
  let srv = await startServer(env);
  const res = await fetch(srv.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ann@x.io', username: 'Ann', password: 'ann-password' }) });
  const cookie = /^stn_session=[^;]*/.exec(res.headers.getSetCookie().find((c) => c.startsWith('stn_session=')) || '')?.[0] || '';
  check('an account to play on', res.ok && !!cookie, String(res.status));
  let a = await play(srv.port, cookie, 'Ann');
  check('in a game, signed in: the record comes from the database, as the account\'s, with nothing in it', await heard(() => a.seen.some((e) => e.flags === (BESTF.ALL | BESTF.ACCOUNT) && e.mask === 0)), JSON.stringify(a.seen));
  a.say('/spawn runner');
  check('a runner spawned in front of them: seen, and told as new on the account', await heard(() => a.seen.some((e) => e.flags === BESTF.ACCOUNT && e.mask & bit(ZTYPE.RUNNER))), JSON.stringify(a.seen));
  await a.close();
  srv.proc.kill('SIGTERM');
  await srv.proc.done;
  const said = srv.proc.log();
  srv = await startServer(env);
  a = await play(srv.port, cookie, 'Ann');
  check('the server restarted, a new game: the runner is on the record it starts from', await heard(() => a.seen.some((e) => e.flags === (BESTF.ALL | BESTF.ACCOUNT) && e.mask & bit(ZTYPE.RUNNER))), JSON.stringify(a.seen));
  const g = await play(srv.port, '', 'Guest');
  check("a guest in the same server is told it is the browser's to keep", await heard(() => g.seen.some((e) => e.flags === BESTF.ALL)), JSON.stringify(g.seen));
  await Promise.all([a.close(), g.close()]);
  const all = said + srv.proc.log();
  const wrong = /bestiary(:| of)|failed|Error|error:/;
  check('the server logged nothing that went wrong', !wrong.test(all), all.split('\n').filter((l) => wrong.test(l)).join('\n'));
  srv.proc.kill('SIGTERM');
  await srv.proc.done;
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
