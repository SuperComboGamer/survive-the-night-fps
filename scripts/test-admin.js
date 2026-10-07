// The admin panel's API (server/adminpanel.js, server/gameadmin.js, server/admin.js), against a real server process
// on a PGlite database of its own, seeded with two admins, a plain account and an admin who is about to be revoked.
//
// Who may: every route refuses a guest, a signed-in account that is no admin, an admin whose flag was taken away, a
// request from another site and one without the panel's header - and none of those leaves a trace or changes a thing.
// What it does: making a game, a message to its players, the commands, removing a player, a reset (same code, same
// players, day 1), closing it with a reason the players are given, stopping and resuming new games, a message to
// everyone, closing every game, the settings and what they refuse, the admin flag (never your own), ending an
// account's sign-ins - each one written to the audit log, the refused ones too, and looking at things not.
// What it survives: junk in every field, without a game or the server going down. A restart hands the games over and
// exits with a code a supervisor restarts on; the next server has the game. Without a database: nothing but a 503.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { C2S, S2C, LEFT_CODE, MOVED_CODE, ENDED_CODE, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { PHASE } from '../shared/constants.js';
import { openDb } from '../server/db/index.js';
import { migrate, MIGRATIONS_DIR } from '../server/db/migrate.js';
import { Auth, hashPassword } from '../server/auth.js';
import { setAdmin, setAdminById } from '../server/admin.js';
import { RESTART_EXIT_CODE } from '../server/adminpanel.js';

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
    await sleep(40);
  }
  return false;
};
const dir = mkdtempSync(join(tmpdir(), 'stn-admin-'));
const dbUrl = `pglite:${join(dir, 'db')}`;
const procs = [];
const J = (v) => JSON.stringify(v);

// ---------------------------------------------------------------- in-process: the migration, and the admin flag's rules
{
  // a database from before the panel (every migration but the audit log's) takes the new one and nothing else
  const old = join(dir, 'old-migrations/');
  mkdirSync(old);
  for (const f of readdirSync(MIGRATIONS_DIR)) if (!/admin_audit/.test(f)) copyFileSync(MIGRATIONS_DIR + f, old + f);
  const db = await openDb('pglite:memory');
  await migrate(db, { dir: old });
  await db.query(`INSERT INTO users (email, username, password_hash) VALUES ('a@x.io', 'Ada', 'x'), ('b@x.io', 'Bo', 'x'), ('c@x.io', 'Cy', 'x')`);
  const up = await migrate(db);
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_audit'`)).rows.map((r) => r.column_name);
  check('an older database migrates: only the audit log is added, and the accounts are still there', up.applied.join() === '014_admin_audit.sql' && cols.includes('admin_name') && cols.includes('result') && (await db.query('SELECT 1 FROM users')).rowCount === 3, J([up, cols]));

  const id = async (n) => (await db.query('SELECT id FROM users WHERE username = $1', [n])).rows[0].id;
  const [ada, bo, cy] = [await id('Ada'), await id('Bo'), await id('Cy')];
  await setAdmin(db, 'Ada', true);
  const rule = (p) => p.then(() => 'done', (e) => e.rule || `threw ${e.message}`);
  check('nobody who is not an admin changes a flag', (await rule(setAdminById(db, bo, cy, true))) === 'actor');
  check('an admin cannot take their own flag away (so the only admin cannot be removed)', (await rule(setAdminById(db, ada, ada, false))) === 'self');
  check('an account that is not there is said so', (await rule(setAdminById(db, ada, randomUUID(), true))) === 'gone');
  const auth = new Auth({ db });
  const boToken = await auth.newSession({ id: bo }, { ip: '', ua: '' });
  const granted = await setAdminById(db, ada, bo, true);
  check('granting sets the flag and ends the sign-ins the account had', granted.changed && granted.is_admin && (await auth.userForToken(boToken, true)) === null, J(granted));
  check('...and asking again changes nothing', (await setAdminById(db, ada, bo, true)).changed === false);
  // two admins taking each other's flag at the same moment: one of them stays
  const both = await Promise.all([rule(setAdminById(db, ada, bo, false)), rule(setAdminById(db, bo, ada, false))]);
  const left = (await db.query('SELECT username FROM users WHERE is_admin')).rows.map((r) => r.username);
  check('two admins revoking each other at once: one succeeds, the other is refused, an admin is left', both.filter((r) => r === 'done').length === 1 && both.includes('actor') && left.length === 1, J([both, left]));
  await db.close();
}

// ---------------------------------------------------------------- the database the server starts on
// (seeded before the server has it: a PGlite folder is one process's at a time. Admins are made as `npm run admin` does)
const PASS = { Root: 'root-password', Mod: 'mod-password', Pat: 'pat-password', Rev: 'rev-password' };
const cookies = {};
const ids = {};
{
  const db = await openDb(dbUrl);
  await migrate(db);
  const auth = new Auth({ db });
  for (const name of Object.keys(PASS)) {
    ids[name] = (await db.query('INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id', [`${name.toLowerCase()}@example.com`, name, await hashPassword(PASS[name])])).rows[0].id;
  }
  for (const name of ['Root', 'Mod', 'Rev']) await setAdmin(db, name, true);
  for (const name of Object.keys(PASS)) cookies[name] = `stn_session=${await auth.newSession({ id: ids[name] }, { ip: '', ua: 'test' })}`;
  await db.close();
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
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
async function startServer(env) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: '', NODE_ENV: 'test', DEV_ADMIN: '', CLUSTER: '', ADMIN_RESTART: '', HANDOFF_DIR: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc);
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  proc.log = () => log;
  for (let i = 0; i < 400 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  return { port, proc, base: `http://localhost:${port}` };
}

// a browser on `base`: its cookie, and the panel's API with the panel's header (headers: null takes one away)
const browserOn = (base, cookie = '') => {
  const b = { cookie };
  b.req = async (method, path, body, headers = {}) => {
    const h = { 'X-STN-Admin': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(b.cookie ? { cookie: b.cookie } : {}), ...headers };
    for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
    const res = await fetch(base + path, { signal: AbortSignal.timeout(20000), method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) {
      const m = /^stn_session=([^;]*)/.exec(c);
      if (m) b.cookie = m[1] ? `stn_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json, text, headers: res.headers };
  };
  b.get = (p, h) => b.req('GET', p, undefined, h);
  b.post = (p, body = {}, h) => b.req('POST', p, body, h);
  b.put = (p, body = {}, h) => b.req('PUT', p, body, h);
  return b;
};
// a game socket, as connection.js opens one; what it is told is kept
const playOn = (port, { code = '', name = 'Guest', cookie = '', guestId = randomUUID() } = {}) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`, { headers: cookie ? { cookie } : {} });
    ws.binaryType = 'arraybuffer';
    const c = { ws, id: 0, room: null, chat: [], resets: 0, closed: null, rejected: 0 };
    ws.onopen = () => {
      const w = new Writer(128);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str(guestId);
      ws.send(w.bytes());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      const t = r.u8();
      if (t === S2C.ROOM) c.room = { code: r.str(), name: r.str() };
      else if (t === S2C.WELCOME) {
        c.id = r.u16();
        resolve(c);
      } else if (t === S2C.CHAT) {
        r.u16();
        r.u8();
        c.chat.push(r.str());
      } else if (t === S2C.WORLD_RESET) c.resets++;
      else if (t === S2C.REJECT) {
        c.rejected = r.u8();
        resolve(c);
      }
    };
    ws.onclose = (e) => {
      c.closed = { code: e.code, reason: e.reason };
      resolve(c);
    };
    c.heard = (re, ms) => until(() => c.chat.some((t) => re.test(t)), ms);
    c.gone = (ms) => until(() => c.closed, ms);
    c.leave = () => (c.closed ? null : new Promise((done) => ((ws.onclose = done), ws.close(LEFT_CODE))));
  });

// every route of the panel: [method, path, body]. :code and :id are filled in with a real game and a real account
const ROUTES = (code, id) => [
  ['GET', '/api/admin/state'],
  ['GET', '/api/admin/catalog'],
  ['GET', `/api/admin/games/${code}`],
  ['GET', '/api/admin/settings'],
  ['GET', '/api/admin/accounts?q=pa'],
  ['GET', '/api/admin/audit'],
  ['POST', '/api/admin/games', { name: 'Sneaked in' }],
  ['POST', `/api/admin/games/${code}/message`, { text: 'boo' }],
  ['POST', `/api/admin/games/${code}/reset`, { confirm: code }],
  ['POST', `/api/admin/games/${code}/close`, { confirm: code }],
  ['POST', `/api/admin/games/${code}/kick`, { player: 1 }],
  ['POST', `/api/admin/games/${code}/command`, { cmd: 'night' }],
  ['POST', '/api/admin/server/broadcast', { text: 'boo' }],
  ['POST', '/api/admin/server/drain', { on: true }],
  ['POST', '/api/admin/server/close-all', { confirm: 'CLOSE ALL' }],
  ['POST', '/api/admin/server/restart', { confirm: 'RESTART' }],
  ['PUT', '/api/admin/settings/max_total_games', { value: 0 }],
  ['POST', `/api/admin/accounts/${id}/admin`, { on: true }],
  ['POST', `/api/admin/accounts/${id}/sessions/end`, {}],
];

let handoffDir = join(dir, 'handoff');
mkdirSync(handoffDir);
try {
  // (LOBBY_LIMITS=0: more games and joins from one address than the lobby lets anybody have. A long day and godmode:
  // nothing ends by itself while the test looks at it)
  const { port, proc, base } = await startServer({ DATABASE_URL: dbUrl, LOBBY_LIMITS: '0', GODMODE: '1', DAY_SECONDS: '3000', NIGHT_SECONDS: '3000', GAME_IDLE_SECONDS: '600', HANDOFF_DIR: handoffDir, ADMIN_RESTART: '1' });
  const browser = (who) => browserOn(base, who ? cookies[who] : '');
  const play = (o) => playOn(port, o);
  const root = browser('Root');
  const mod = browser('Mod');
  const pat = browser('Pat');
  const rev = browser('Rev');
  const guest = browser();
  const auditRows = async () => (await root.get('/api/admin/audit')).body.rows;

  // ---- a game to aim at, with two guests and a signed-in player
  const made = await root.post('/api/admin/games', { name: 'Night Shift', maxPlayers: 6, difficulty: 'ember' });
  const code = made.body?.game?.code;
  check('an admin makes a game: public, with the seats and difficulty asked for', made.status === 200 && /^[A-Z2-9]{6}$/.test(code || '') && made.body.game.max === 6 && made.body.game.difficulty === 'ember' && made.body.audited === true, J(made.body));
  const g1 = await play({ code, name: 'Gus' });
  const g2 = await play({ code, name: 'Hal' });
  const p1 = await play({ code, name: 'ignored', cookie: cookies.Pat });
  check('players join it', g1.id && g2.id && p1.id && g1.room?.code === code, J([g1.id, g2.id, p1.id, g1.closed]));
  const detail = async (c = code) => (await root.get(`/api/admin/games/${c}`)).body;
  await until(async () => (await detail()).players?.length === 3);

  // ---- who may
  {
    const state0 = (await root.get('/api/admin/state')).body;
    const audit0 = (await auditRows()).length;
    const routes = ROUTES(code, ids.Pat);
    const tried = { guest: [], plain: [], evil: [], fetchSite: [], noHeader: [] };
    for (const [method, path, body] of routes) {
      tried.guest.push((await guest.req(method, path, body)).status);
      tried.plain.push((await pat.req(method, path, body)).status);
      tried.evil.push((await root.req(method, path, body, { Origin: 'http://evil.example' })).status);
      tried.fetchSite.push((await root.req(method, path, body, { 'Sec-Fetch-Site': 'cross-site' })).status);
      tried.noHeader.push((await root.req(method, path, body, { 'X-STN-Admin': null })).status);
    }
    const all = (list, status) => list.every((s) => s === status);
    check(`every route (${routes.length}) refuses a guest with a 401`, all(tried.guest, 401), J(tried.guest));
    check('...a signed-in account that is not an admin with a 403', all(tried.plain, 403), J(tried.plain));
    check("...an admin's browser sent from another site (Origin) with a 403", all(tried.evil, 403), J(tried.evil));
    check('...or said by the browser to be cross-site (Sec-Fetch-Site) with a 403', all(tried.fetchSite, 403), J(tried.fetchSite));
    check("...and one without the panel's header (what a page elsewhere cannot add) with a 403", all(tried.noHeader, 403), J(tried.noHeader));
    const form = await fetch(base + `/api/admin/games/${code}/close`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-STN-Admin': '1', cookie: root.cookie }, body: `confirm=${code}` });
    const getClose = await root.get(`/api/admin/games/${code}/close`);
    check('a form post is turned away, and a state-changing route does nothing on a GET', form.status === 415 && !getClose.body?.ok && (await root.get('/api/admin/games/' + code)).status === 200, J([form.status, getClose.status]));

    // the revoked admin: an admin now...
    const before = await rev.get('/api/admin/state');
    const cached = await rev.get('/api/stats/admin'); // (the stats page's admin part, which goes by the minute's cache)
    const revoke = await root.post(`/api/admin/accounts/${ids.Rev}/admin`, { on: false });
    const revoked = [];
    for (const [method, path, body] of routes) revoked.push((await rev.req(method, path, body)).status);
    const cachedAfter = await rev.get('/api/stats/admin');
    check('an admin whose flag is taken away is refused by every route at once, with the cookie that worked a moment ago', before.status === 200 && revoke.status === 200 && all(revoked, 401), J([before.status, revoke.body, revoked]));
    check("...and by the stats page's admin part, whose cached sign-in went too", cached.status === 200 && cachedAfter.status === 401, J([cached.status, cachedAfter.status]));
    const again = await rev.post('/api/auth/login', { login: 'Rev', password: PASS.Rev });
    const asPlain = [];
    for (const [method, path, body] of routes) asPlain.push((await rev.req(method, path, body)).status);
    check('...and signed in again they are an account like any other: a 403 everywhere', again.status === 200 && all(asPlain, 403), J([again.status, asPlain]));

    const state1 = (await root.get('/api/admin/state')).body;
    const audit1 = await auditRows();
    check('none of that changed a thing: the same games and players, new games still allowed, the setting unset', state1.games.length === state0.games.length && state1.games[0].players === 3 && state1.server.draining === false && state1.server.maxTotal === null && !g1.closed && !p1.closed, J(state1.server));
    check('...and the audit log has only what an admin did (the revoke)', audit1.length === audit0 + 1 && audit1[0].action === 'account.admin' && audit1[0].admin === 'Root' && audit1[0].target === 'Rev' && audit1[0].ok === true, J(audit1.slice(0, 2)));
    const page = await fetch(base + '/admin');
    if (existsSync('dist/admin.html')) {
      const html = await page.text();
      check('the page itself is served to anyone, says nothing of the server, and may not be framed', page.status === 200 && !html.includes(code) && page.headers.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(page.headers.get('content-security-policy') || ''), J([page.status, [...page.headers]]));
    } else console.log('SKIP  the page itself (no dist/admin.html: npm run build)');
  }

  // ---- seeing
  {
    const state = (await root.get('/api/admin/state')).body;
    const g = state.games.find((x) => x.code === code);
    check('the overview has this server: its build, uptime, memory, database, games and players against the caps', state.me.name === 'Root' && state.server.uptimeS >= 0 && state.server.rssMb > 0 && state.server.db.kind === 'pglite' && state.server.db.ok === true && state.server.games === 1 && state.server.players === 3 && state.server.maxGames >= 1 && state.server.stopping === false && state.server.clustered === false && state.servers === null, J(state.server));
    check('...and the game: its code, name, players, phase, day, tick times', g?.name === 'Night Shift' && g.players === 3 && g.sockets === 3 && g.max === 6 && g.phase === PHASE.DAY && g.day >= 1 && g.health === 'ok' && g.errs === 0, J(g));
    const priv = await root.post('/api/admin/games', { name: 'Back Room', inviteOnly: true });
    const pcode = priv.body.game.code;
    const listed = (await root.get('/api/admin/state')).body.games.map((x) => x.code);
    const pub = (await guest.get('/api/games')).body.list.map((x) => x.code);
    check('an invite-only game is in the panel, and still not in the public list', pcode.length === 10 && listed.includes(pcode) && !pub.includes(pcode) && pub.includes(code), J([listed, pub]));
    const d = await detail();
    const names = d.players.map((p) => p.name).sort();
    const patRow = d.players.find((p) => p.name === 'Pat');
    const gus = d.players.find((p) => p.name === 'Gus');
    check("a game's detail: who is in it, account or guest, admin or not, alive, with a ping", J(names) === J(['Gus', 'Hal', 'Pat']) && patRow.account === 'Pat' && patRow.guest === false && patRow.accountId === ids.Pat && patRow.admin === false && gus.guest === true && gus.account === '' && gus.state === 'alive' && gus.held === null && typeof gus.ping === 'number' && d.detail.day >= 1 && d.detail.seed > 0, J(d));
    const everything = J([state, d, (await root.get('/api/admin/accounts?q=')).body, (await root.get('/api/admin/catalog')).body]);
    check('nothing in what the panel is sent is an address, an email, a password hash or a session', !/127\.0\.0\.1|::1|0000:0000|@example\.com|scrypt|token|password/i.test(everything) && /^[0-9a-f]{6}$/.test(gus.addr) && gus.addr === patRow.addr, everything.match(/.{0,40}(127\.0\.0\.1|::1|0000:0000|@example\.com|scrypt|token|password).{0,40}/i)?.[0]);
    await root.post(`/api/admin/games/${pcode}/close`, { confirm: pcode });
  }

  // ---- a message, the commands
  {
    const say = await root.post(`/api/admin/games/${code}/message`, { text: '  Server restarts\tin five minutes  ' });
    check('a message reaches every player in the game as a line from the server', say.status === 200 && (await g1.heard(/^\[Admin\] Server restarts in five minutes$/)) && (await p1.heard(/^\[Admin\] Server restarts/)), J([say.body, g1.chat]));
    const z0 = (await detail()).detail.zombies;
    const spawn = await root.post(`/api/admin/games/${code}/command`, { cmd: 'spawn', type: 'walker', count: 5, player: g1.id });
    await until(async () => (await detail()).detail.zombies >= z0 + 5);
    const z1 = (await detail()).detail.zombies;
    const clear = await root.post(`/api/admin/games/${code}/command`, { cmd: 'clear' });
    await until(async () => (await detail()).detail.zombies === 0);
    check('spawn puts that many zombies in the game, clear leaves none', spawn.status === 200 && z1 >= z0 + 5 && clear.status === 200 && (await detail()).detail.zombies === 0, J([spawn.body, z0, z1, clear.body]));
    const give = await root.post(`/api/admin/games/${code}/command`, { cmd: 'give', item: 'medkit', count: 2, player: g2.id });
    check('give puts an item in a player\'s backpack, and they are told', give.status === 200 && (await g2.heard(/^gave 2 x /)), J([give.body, g2.chat]));
    const dayNow = await root.post(`/api/admin/games/${code}/command`, { cmd: 'day' });
    const night = await root.post(`/api/admin/games/${code}/command`, { cmd: 'night' });
    const isNight = await until(async () => (await detail()).detail.phase === PHASE.NIGHT);
    check('skip to night works by day, and skip to day is refused then', dayNow.status === 409 && night.status === 200 && isNight, J([dayNow.body, night.body]));
    const junk = await Promise.all([
      root.post(`/api/admin/games/${code}/command`, { cmd: 'kill' }),
      root.post(`/api/admin/games/${code}/command`, { cmd: '__proto__' }),
      root.post(`/api/admin/games/${code}/command`, { cmd: 'spawn', type: 'walker', count: 999, player: g1.id }),
      root.post(`/api/admin/games/${code}/command`, { cmd: 'spawn', type: 'constructor', count: 1, player: g1.id }),
      root.post(`/api/admin/games/${code}/command`, { cmd: 'spawn', type: 'walker', count: 1.5, player: g1.id }),
      root.post(`/api/admin/games/${code}/command`, { cmd: 'spawn', type: 'walker', count: 1, player: '1; drop' }),
      root.post(`/api/admin/games/${code}/command`, { cmd: 'give', item: ['medkit'], count: 1, player: g1.id }),
      root.post(`/api/admin/games/${code}/command`, { cmd: 'give', item: 'medkit', count: -1, player: g1.id }),
    ]);
    const nobody = await root.post(`/api/admin/games/${code}/command`, { cmd: 'spawn', type: 'walker', count: 1, player: 4242 });
    check('a command that is not on the list, a type that is not one, a count out of range: each a 400', junk.every((r) => r.status === 400), J(junk.map((r) => [r.status, r.body?.error])));
    check('...and a player who is not in the game a 409 from the game itself', nobody.status === 409 && /not in the game/.test(nobody.body.error), J(nobody.body));
  }

  // ---- removing a player
  {
    const kick = await root.post(`/api/admin/games/${code}/kick`, { player: g2.id, reason: 'Team killing' });
    await g2.gone();
    const d = await detail();
    check('a removed player is out at once, told why, and no place is held for them', kick.status === 200 && g2.closed?.code === ENDED_CODE && /An admin removed you from the game: Team killing/.test(g2.closed.reason) && d.players.length === 2 && !d.players.some((p) => p.name === 'Hal') && (await root.get('/api/admin/state')).body.games[0].held === 0, J([kick.body, g2.closed, d.players.map((p) => p.name)]));
    check('...and the others are told', await g1.heard(/^Hal was removed from the game by an admin\.$/), J(g1.chat));
    const back = await play({ code, name: 'Hal' });
    check('(it is no ban: they can come back in)', back.id > 0, J(back.closed));
    // a player who dropped and is held for a rejoin can be removed too
    back.ws.close();
    await until(async () => (await detail()).players.some((p) => p.name === 'Hal' && p.held));
    const held = (await detail()).players.find((p) => p.name === 'Hal');
    const kickHeld = await root.post(`/api/admin/games/${code}/kick`, { player: held.id });
    check('a held place (a player who dropped) can be removed as well', held.held.leftS > 0 && kickHeld.status === 200 && !(await detail()).players.some((p) => p.name === 'Hal'), J([held, kickHeld.body]));
  }

  // ---- reset
  {
    const before = await detail();
    const noConfirm = await root.post(`/api/admin/games/${code}/reset`, {});
    const wrong = await root.post(`/api/admin/games/${code}/reset`, { confirm: 'ABCDEF' });
    check('a reset without the game named again in its body does nothing', noConfirm.status === 400 && wrong.status === 400 && (await detail()).detail.phase === PHASE.NIGHT, J([noConfirm.body, wrong.body]));
    const resets0 = g1.resets;
    const reset = await root.post(`/api/admin/games/${code}/reset`, { confirm: code });
    const after = await detail();
    check('a reset is a new run in the same game: the same code and name, everyone still in it, day 1 again, a new valley', reset.status === 200 && after.game.code === code && after.game.name === 'Night Shift' && after.detail.phase === PHASE.DAY && after.detail.day === 1 && after.detail.zombies >= 0 && after.players.length === before.players.length && !g1.closed && !p1.closed && after.detail.seed !== before.detail.seed && g1.resets === resets0 + 1, J([reset.body, after.detail, before.detail.seed, g1.closed]));
    check('...and the players are told', await g1.heard(/^An admin restarted this game: a new run, from day 1\.$/), J(g1.chat));
    const empty = await root.post('/api/admin/games', { name: 'Empty' });
    const er = await root.post(`/api/admin/games/${empty.body.game.code}/reset`, { confirm: empty.body.game.code });
    check('resetting a game nobody is in is said to be nothing to do', er.status === 200 && /Nobody is in it/.test(er.body.result), J(er.body));
    await root.post(`/api/admin/games/${empty.body.game.code}/close`, { confirm: empty.body.game.code });
  }

  // ---- stopping and resuming new games, a message to everyone, closing
  {
    const other = await root.post('/api/admin/games', { name: 'Second' });
    const ocode = other.body.game.code;
    const o1 = await play({ code: ocode, name: 'Ivy' });
    const drain = await root.post('/api/admin/server/drain', { on: true });
    const refused = await guest.post('/api/games', { name: 'Nope' });
    const adminToo = await root.post('/api/admin/games', { name: 'Nope' });
    const late = await play({ code, name: 'Jo' });
    const st = (await root.get('/api/admin/state')).body.server;
    check('with new games stopped: nobody makes one, the games running carry on and can still be joined', drain.status === 200 && refused.status === 503 && adminToo.status === 409 && late.id > 0 && st.draining === true && st.canCreate === false && !g1.closed, J([drain.body, refused.status, adminToo.status, late.closed, st.draining]));
    const resume = await root.post('/api/admin/server/drain', { on: false });
    const okNow = await guest.post('/api/games', { name: 'Third' });
    check('...and resumed, they are made again', resume.status === 200 && okNow.status === 201 && (await root.get('/api/admin/state')).body.server.draining === false, J([resume.body, okNow.status]));
    await late.leave();

    const all = await root.post('/api/admin/server/broadcast', { text: 'Thanks for playing tonight' });
    check('a broadcast reaches the players of every game', all.status === 200 && (await g1.heard(/^\[Admin\] Thanks for playing tonight$/)) && (await o1.heard(/^\[Admin\] Thanks for playing tonight$/)), J([all.body, o1.chat]));

    const noConfirm = await root.post(`/api/admin/games/${ocode}/close`, { reason: 'x', confirm: code });
    const close = await root.post(`/api/admin/games/${ocode}/close`, { reason: 'Making room for the tournament', confirm: ocode });
    await o1.gone();
    const gone = await guest.get(`/api/games/${ocode}`);
    check('closing a game needs that game named again; then it ends, its players are told why, and its code is gone', noConfirm.status === 400 && close.status === 200 && o1.closed?.code === ENDED_CODE && o1.closed.reason === 'An admin closed this game: Making room for the tournament' && gone.status === 404 && (await root.get(`/api/admin/games/${ocode}`)).status === 404 && !g1.closed, J([noConfirm.status, close.body, o1.closed, gone.status]));
    const longReason = await root.post(`/api/admin/games/${code}/close`, { reason: 'x'.repeat(101), confirm: code });
    check('a reason too long for a player to be shown is refused, and the game is still there', longReason.status === 400 && (await detail()).game.code === code, J(longReason.body));
  }

  // ---- the settings
  {
    const view = (await root.get('/api/admin/settings')).body;
    const s = view.settings.find((x) => x.key === 'max_total_games');
    check('the settings kept in the database are listed with what they mean and what is in force', s && s.stored === null && s.inForce === null && /most games/.test(s.about) && view.fixed.maxGames >= 1, J(view));
    const bads = [];
    for (const value of ['12', -1, 1.5, 1e9, true, {}, [3], '']) bads.push((await mod.put('/api/admin/settings/max_total_games', { value })).status);
    const noValue = await mod.put('/api/admin/settings/max_total_games', {});
    const noKey = await mod.put('/api/admin/settings/nothing_like_it', { value: 1 });
    const proto = await mod.put('/api/admin/settings/__proto__', { value: 1 });
    check('a value that is not a whole number in range is refused, and so is a setting that does not exist', bads.every((x) => x === 400) && noValue.status === 400 && noKey.status === 404 && proto.status === 404 && (await root.get('/api/admin/settings')).body.settings[0].stored === null, J([bads, noValue.status, noKey.status, proto.status]));
    const games = (await root.get('/api/admin/state')).body.games.length;
    const set = await mod.put('/api/admin/settings/max_total_games', { value: games });
    const full = await guest.post('/api/games', { name: 'One too many' });
    const st = (await root.get('/api/admin/state')).body.server;
    check('a setting changed is in force at once: at the total, no more games', set.status === 200 && set.body.settings[0].stored === games && full.status === 503 && st.maxTotal === games && st.canCreate === false, J([set.body, full.status, st.maxTotal]));
    const unset = await mod.put('/api/admin/settings/max_total_games', { value: null });
    const free = await guest.post('/api/games', { name: 'Room again' });
    check('...and unset, it is its default again', unset.status === 200 && free.status === 201 && (await root.get('/api/admin/state')).body.server.maxTotal === null, J([unset.body, free.status]));
  }

  // ---- accounts
  {
    const found = (await root.get('/api/admin/accounts?q=pa')).body;
    const row = found.accounts.find((a) => a.username === 'Pat');
    check('an account is found by part of its name: admin or not, its sign-ins, the game it is in', found.accounts.length === 1 && row.id === ids.Pat && row.isAdmin === false && row.sessions === 1 && row.game === code && found.admins === 2, J(found));
    const badQ = await root.get(`/api/admin/accounts?q=${encodeURIComponent("' OR 1=1 --")}`);
    const wild = (await root.get('/api/admin/accounts?q=_')).body;
    check('a search that is not part of a name is refused, and _ and % mean themselves', badQ.status === 400 && wild.accounts.length === 0 && (await root.get('/api/admin/accounts?q=%25')).status === 400, J([badQ.status, wild]));
    const first = (await root.get('/api/admin/accounts')).body;
    check('with nothing to search for: the admins first', first.accounts.length === 4 && first.accounts.slice(0, 2).every((a) => a.isAdmin), J(first.accounts.map((a) => [a.username, a.isAdmin])));

    const mine = await root.post(`/api/admin/accounts/${ids.Root}/admin`, { on: false });
    check('an admin cannot take their own admin flag away', mine.status === 409 && mine.body.rule === 'self' && (await root.get('/api/admin/state')).status === 200, J(mine.body));
    const grant = await root.post(`/api/admin/accounts/${ids.Pat}/admin`, { on: true });
    const patOld = await pat.get('/api/admin/state');
    await pat.post('/api/auth/login', { login: 'pat@example.com', password: PASS.Pat });
    const patNew = await pat.get('/api/admin/state');
    check('granting makes an admin of them from their next sign-in (the old one is ended)', grant.status === 200 && patOld.status === 401 && patNew.status === 200 && patNew.body.me.name === 'Pat', J([grant.body, patOld.status, patNew.status]));
    check('...and the game they are playing in knows at once', (await detail()).players.find((p) => p.name === 'Pat').admin === true);
    const take = await root.post(`/api/admin/accounts/${ids.Pat}/admin`, { on: false });
    check('...and taking it away again does too', take.status === 200 && (await pat.get('/api/admin/state')).status === 401 && (await detail()).players.find((p) => p.name === 'Pat').admin === false, J(take.body));
    const noOne = await root.post(`/api/admin/accounts/${randomUUID()}/admin`, { on: true });
    const notId = await root.post(`/api/admin/accounts/Pat/admin`, { on: true });
    const notBool = await root.post(`/api/admin/accounts/${ids.Pat}/admin`, { on: 'yes' });
    check('an account that is not there is a 404, and "on" is true or false', noOne.status === 404 && notId.status === 404 && notBool.status === 400, J([noOne.status, notId.status, notBool.status]));

    await pat.post('/api/auth/login', { login: 'Pat', password: PASS.Pat });
    const in1 = await pat.get('/api/auth/me');
    const end = await root.post(`/api/admin/accounts/${ids.Pat}/sessions/end`, {});
    const in2 = await pat.get('/api/auth/me');
    check("ending an account's sign-ins signs its browsers out; the game it is playing goes on", in1.body.user?.username === 'Pat' && end.status === 200 && /1 sign-in of Pat ended/.test(end.body.result) && in2.body.user === null && !p1.closed, J([end.body, in2.body]));
  }

  // ---- the audit log
  {
    const rows = [];
    for (let page = await root.get('/api/admin/audit'); ; page = await root.get('/api/admin/audit?before=' + rows[rows.length - 1].id)) {
      rows.push(...page.body.rows);
      if (!page.body.more) break;
    }
    const by = (action) => rows.filter((r) => r.action === action);
    const kinds = ['game.create', 'game.message', 'game.command', 'game.kick', 'game.reset', 'game.close', 'server.broadcast', 'server.drain', 'setting.set', 'account.admin', 'account.sessions_end'];
    check('every kind of action is in the audit log', kinds.every((k) => by(k).length), J(kinds.filter((k) => !by(k).length)));
    const close = by('game.close').find((r) => r.detail.reason === 'Making room for the tournament');
    const kick = by('game.kick').find((r) => r.detail.reason === 'Team killing');
    check('...with who did it, when, to what, and how it went', close?.admin === 'Root' && close.ok === true && /^[A-Z2-9]{6}$/.test(close.target) && /closed with 1 connected/.test(close.result) && Date.now() - new Date(close.at).getTime() < 120_000 && kick?.target === code && /Hal removed/.test(kick.result) && by('setting.set').some((r) => r.admin === 'Mod' && r.target === 'max_total_games' && r.ok), J([close, kick]));
    check('...and what was refused is there too, as refused', by('game.reset').some((r) => !r.ok && /confirm/.test(r.result)) && by('account.admin').some((r) => !r.ok && /your own admin access/.test(r.result)) && by('setting.set').some((r) => !r.ok) && by('game.command').some((r) => !r.ok && /not in the game/.test(r.result)), J(rows.filter((r) => !r.ok).map((r) => [r.action, r.result])));
    const n0 = rows.length;
    await Promise.all([root.get('/api/admin/state'), root.get(`/api/admin/games/${code}`), root.get('/api/admin/accounts?q=ro'), root.get('/api/admin/settings'), root.get('/api/admin/audit'), root.get('/api/admin/catalog')]);
    const page2 = await root.get(`/api/admin/audit?before=${rows[rows.length - 1].id}`);
    check('looking at things is not recorded; the log pages back by id, 50 at a time', (await auditRows())[0].id === rows[0].id && n0 > 50 && new Set(rows.map((r) => r.id)).size === n0 && page2.status === 200 && page2.body.rows.length === 0 && (await root.get('/api/admin/audit?before=abc')).status === 400, J([n0, page2.body]));
    check('no address is kept in it', !/127\.0\.0\.1|::1/.test(J(rows)));
  }

  // ---- junk, and the server and the game still standing
  {
    const tick0 = (await detail()).game.tickFull.sinceBoot.ticks;
    const P = `/api/admin/games/${code}`;
    const junk = [
      await mod.req('POST', `${P}/message`, '{"text": '),
      await mod.req('POST', `${P}/message`, '[1,2,3]'),
      await mod.req('POST', `${P}/message`, 'null'),
      await mod.post(`${P}/message`, { text: 'x'.repeat(5000) }),
      await mod.post(`${P}/message`, { text: 'x'.repeat(201) }),
      await mod.post(`${P}/message`, { text: { toString: 1 } }),
      await mod.post(`${P}/message`, { text: '\u0000\u0007 \n\t' }),
      await mod.post(`${P}/kick`, { player: -1 }),
      await mod.post(`${P}/kick`, { player: 1e99 }),
      await mod.post(`${P}/kick`, { player: null }),
      await mod.post(`${P}/kick`, { player: g1.id, reason: 12 }),
      await mod.post(`${P}/close`, { confirm: [code] }),
      await mod.post(`${P}/reset`, { confirm: { code } }),
      await mod.post('/api/admin/games', { maxPlayers: 9999 }),
      await mod.post('/api/admin/games', { maxPlayers: '4' }),
      await mod.post('/api/admin/games', { difficulty: 'impossible' }),
      await mod.post('/api/admin/games', { inviteOnly: 'yes' }),
      await mod.post('/api/admin/server/drain', { on: 1 }),
      await mod.post('/api/admin/server/broadcast', {}),
      await mod.post('/api/admin/server/close-all', { confirm: 'close all' }),
      await mod.post('/api/admin/server/restart', { confirm: 'restart' }),
    ];
    const codes = [];
    for (const c of ['abc', 'ABCDEF', '..%2F..%2Fetc', code.toLowerCase() + '0', '%00', 'A'.repeat(300), '__proto__']) codes.push((await mod.post(`/api/admin/games/${c}/message`, { text: 'hi' })).status);
    check('junk in a body is a 400 (too much of it a 413), never a 500', junk.every((r) => r.status === 400 || r.status === 413), J(junk.map((r) => r.status)));
    check('a code that is not a game is a 404', codes.every((s) => s === 404), J(codes));
    const lower = await mod.post(`/api/admin/games/${code.toLowerCase()}/message`, { text: 'still here' });
    const after = await detail();
    check('...and the game and the server are still up: the game ticks on, its players are in it', lower.status === 200 && (await g1.heard(/still here/)) && after.detail && after.game.errs === 0 && (await until(async () => (await detail()).game.tickFull.sinceBoot.ticks > tick0, 15000)) && !g1.closed && proc.exitCode === null && !/Something went wrong|tick error|crashed/.test(proc.log()), proc.log().split('\n').filter((l) => /wrong|error|crash/i.test(l)).join('\n'));
  }

  // ---- too fast
  {
    let got = 0;
    let n = 0;
    for (; n < 80 && got !== 429; n++) got = (await mod.post('/api/admin/games/ABCDEF/message', { text: 'x' })).status;
    check('an admin changing things faster than anyone clicks is slowed down (429), and can still look', got === 429 && n > 10 && (await mod.get('/api/admin/state')).status === 200 && (await root.post(`/api/admin/games/${code}/message`, { text: 'unaffected' })).status === 200, J([got, n]));
  }

  // ---- closing every game
  {
    const wrong = await root.post('/api/admin/server/close-all', { confirm: code });
    const n = (await root.get('/api/admin/state')).body.games.length;
    const all = await root.post('/api/admin/server/close-all', { reason: 'Maintenance', confirm: 'CLOSE ALL' });
    await g1.gone();
    await p1.gone();
    check('closing every game needs its own words; then every game ends with the reason', wrong.status === 400 && n >= 2 && all.status === 200 && new RegExp(`^${n} games closed`).test(all.body.result) && g1.closed?.code === ENDED_CODE && /Maintenance/.test(g1.closed.reason) && p1.closed?.code === ENDED_CODE && (await root.get('/api/admin/state')).body.games.length === 0, J([wrong.status, n, all.body, g1.closed]));
  }

  // ---- restart: the games are handed over and the process exits for its supervisor to start it again
  {
    const info = (await root.get('/api/admin/state')).body.server;
    const game = (await root.post('/api/admin/games', { name: 'Carried Over' })).body.game;
    const s1 = await play({ code: game.code, name: 'Kit' });
    await until(async () => (await detail(game.code)).players?.length === 1);
    const wrong = await root.post('/api/admin/server/restart', {});
    const exited = new Promise((r) => proc.once('exit', (c) => r(c)));
    const restart = await root.post('/api/admin/server/restart', { confirm: 'RESTART' });
    const exitCode = await Promise.race([exited, sleep(25000).then(() => 'still running')]);
    await s1.gone(3000);
    check('a restart needs its own word; then the game is handed over, its player told the server is updating, and the process exits for its supervisor', info.restart.available === true && info.handoff === 'files' && wrong.status === 400 && restart.status === 200 && exitCode === RESTART_EXIT_CODE && s1.closed?.code === MOVED_CODE && /1 game\(s\) handed over/.test(proc.log()), J([info.restart, wrong.status, restart.body, exitCode, s1.closed, proc.log().split('\n').slice(-8)]));
    // (this test is the supervisor)
    const next = await startServer({ DATABASE_URL: dbUrl, LOBBY_LIMITS: '0', HANDOFF_DIR: handoffDir });
    const root2 = browserOn(next.base, cookies.Root);
    const there = await until(async () => (await root2.get(`/api/admin/games/${game.code}`)).status === 200, 8000);
    const d = (await root2.get(`/api/admin/games/${game.code}`)).body;
    const audit = (await root2.get('/api/admin/audit')).body.rows;
    check('...and the next server has the game under the same code, its player held for them to come back', there && d.players?.[0]?.name === 'Kit' && !!d.players[0].held, J(d));
    check('...and the restart is in the audit log', audit[0]?.action === 'server.restart' && audit[0].ok && audit[0].admin === 'Root', J(audit[0]));
    const off = (await root2.get('/api/admin/state')).body.server.restart;
    const refused = await root2.post('/api/admin/server/restart', { confirm: 'RESTART' });
    check('a server whose host has not said it restarts it (ADMIN_RESTART=1) does not offer a restart, and refuses one', off.available === false && /ADMIN_RESTART/.test(off.why) && refused.status === 409 && next.proc.exitCode === null, J([off, refused.status]));
    await stop(next.proc);
  }
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
  for (const p of procs) console.log(p.log().split('\n').slice(-25).join('\n'));
}

// ---------------------------------------------------------------- no database: no accounts, no admins, no panel
try {
  const { base, proc } = await startServer({ DATABASE_URL: '' });
  const b = browserOn(base, cookies.Root);
  const got = [];
  for (const [method, path, body] of ROUTES('ABCDEF', randomUUID())) got.push(await b.req(method, path, body));
  check('without a database every route of the panel is a 503 that says there are no accounts', got.every((r) => r.status === 503 && r.body.accounts === false && /no database/.test(r.body.error)), J(got.map((r) => r.status)));
  const games = await fetch(base + '/api/games').then((r) => r.json());
  check('...and the game itself runs as before', games.canCreate === true && proc.exitCode === null, J(games));
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

await Promise.all(procs.map(stop));
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
