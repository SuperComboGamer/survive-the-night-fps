// Accounts, friends and direct messages (server/auth.js, server/social.js, server/dbstats.js), against a real server
// process on a PGlite database of its own: registering and what it refuses, signing in by email or name and with
// the wrong password, signing out; a friend request by name, accepting it, the /social socket hearing of it; messages
// between friends and not to anyone else, read and unread; a signed-in player playing under their account's name,
// told to the others in the game; a friend's presence and the game to join them in, an invite-only one's code going to
// friends and nobody else; requests from another site turned away. In-process: a guest's stats moving onto their
// account, and the database board.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEFT_CODE, C2S, S2C, PROTOCOL_VERSION, Writer, Reader, readBoard } from '../shared/protocol.js';
import { openDb } from '../server/db/index.js';
import { migrate, pendingMigrations } from '../server/db/migrate.js';
import { DbStats } from '../server/dbstats.js';
import { idKey } from '../server/stats.js';
import { hashPassword, verifyPassword } from '../server/auth.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(25);
  }
  return false;
};
const dir = mkdtempSync(join(tmpdir(), 'stn-accounts-'));
const procs = [];

// ---------------------------------------------------------------- in-process: migrations, passwords, stats
{
  const db = await openDb('pglite:memory');
  check('a new database has every migration pending', (await pendingMigrations(db)).length >= 2);
  const first = await migrate(db);
  const again = await migrate(db);
  check('migrations apply once, and a second run finds nothing to do', first.applied.length >= 2 && again.applied.length === 0, JSON.stringify([first, again]));
  check('...and nothing is pending after', (await pendingMigrations(db)).length === 0);

  const h = await hashPassword('correct horse');
  check('a password checks against its hash, and a wrong one does not', (await verifyPassword('correct horse', h)) && !(await verifyPassword('correct hors', h)) && !h.includes('correct'));

  const stats = new DbStats({ db });
  const browser = randomUUID();
  const g = stats.enter(browser, 'Guesty');
  stats.bump(g, 'kills', 7);
  stats.bump(g, 'nights', 2);
  stats.leave(g);
  await stats.flush();
  const row = (await db.query('SELECT * FROM player_stats WHERE key = $1', [`g:${idKey(browser)}`])).rows[0];
  check("a guest's stats are kept under their browser id's hash, not the id", row?.kills === 7 && row.nights === 2 && !JSON.stringify(row).includes(browser), JSON.stringify(row));
  const uid = (await db.query(`INSERT INTO users (email, username, password_hash) VALUES ('g@x.io', 'Guesty', 'x') RETURNING id`)).rows[0].id;
  const u = stats.enter('', 'Guesty', uid);
  stats.bump(u, 'kills', 3);
  stats.leave(u);
  await stats.claimGuest(uid, 'Guesty', browser);
  const mine = await stats.forUser(uid);
  check("signing up from that browser adds the guest's stats to the account's", mine?.kills === 10 && mine.nights === 2 && mine.ranks.kills === 1, JSON.stringify(mine));
  check("...and the guest's record is gone", !(await db.query('SELECT 1 FROM player_stats WHERE key LIKE $1', ['g:%'])).rowCount);
  await stats.addStint({ userId: uid, name: 'Guesty', firstStint: true, deaths: 2, downs: 3, headshots: 4, bossKills: 1, leftDay: 5, seconds: 600 });
  await stats.addStint({ userId: uid, name: 'Guesty', firstStint: false, deaths: 1, downs: 0, headshots: 0, bossKills: 0, leftDay: 3, seconds: 60 });
  const after = await stats.forUser(uid);
  check('a match stint adds games, deaths, downs and time, and the furthest day', after.games === 1 && after.deaths === 3 && after.downs === 3 && after.bestDay === 5 && after.playSeconds === 660 && after.bossKills === 1, JSON.stringify(after));
  const other = stats.enter(randomUUID(), 'Other');
  stats.bump(other, 'kills', 50);
  const board = await stats.board(u, new Set([u]));
  const me = board.rows.find((r) => r.name === 'Guesty');
  check('the board ranks me second in kills behind a bigger killer, first in nights', board.total === 2 && me?.ranks?.[0] === 2 && me.ranks[1] === 1 && board.rows.some((r) => r.name === 'Other' && r.kills === 50), JSON.stringify(board));
  await stats.close();
  await db.close();
}

// ---------------------------------------------------------------- a real server
// a port nothing is listening on (uWS shares a port with whatever already has it, so a guessed one could be split
// with a leftover server)
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
// stops a server, and kills it if it has not gone in 8 s
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
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: '', GAME_IDLE_SECONDS: '2', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc);
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  proc.log = () => log;
  for (let i = 0; i < 200 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  return { port, proc, base: `http://localhost:${port}` };
}

try {
  // (LOBBY_LIMITS=0: this makes more games from one address than the lobby lets anybody make in a minute)
  const { port, proc, base } = await startServer({ DATABASE_URL: `pglite:${join(dir, 'db')}`, LOBBY_LIMITS: '0' });
  // a browser: its cookie jar, and the API with it
  const browser = () => {
    const b = { cookie: '', guestId: randomUUID() };
    b.req = async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(15000), method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(b.cookie ? { cookie: b.cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const set = res.headers.getSetCookie?.() || [];
      for (const c of set) {
        const m = /^stn_session=([^;]*)/.exec(c);
        if (m) b.cookie = m[1] ? `stn_session=${m[1]}` : '';
      }
      return { status: res.status, body: await res.json().catch(() => null), setCookie: set };
    };
    b.get = (p) => b.req('GET', p);
    b.post = (p, body = {}, h) => b.req('POST', p, body, h);
    b.heard = [];
    b.social = () =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}/social`, { headers: b.cookie ? { cookie: b.cookie } : {} });
        b.ws = ws;
        ws.onmessage = (m) => b.heard.push(JSON.parse(m.data));
        ws.onopen = () => resolve(true);
        ws.onerror = () => resolve(false);
        ws.onclose = (e) => {
          b.closedWith = e.code;
          resolve(false);
        };
      });
    b.hear = (fn, ms) => until(() => b.heard.some(fn), ms);
    return b;
  };
  // a game socket, as connection.js opens one
  const play = (b, code, name) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`, { headers: b?.cookie ? { cookie: b.cookie } : {} });
      ws.binaryType = 'arraybuffer';
      const c = { ws, id: 0, room: null, accounts: new Map(), names: new Map(), board: null };
      ws.onopen = () => {
        const w = new Writer(128);
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str(name);
        w.str(b?.guestId || '');
        ws.send(w.bytes());
      };
      ws.onmessage = (m) => {
        const r = new Reader(m.data);
        const t = r.u8();
        if (t === S2C.ROOM) c.room = { code: r.str(), name: r.str() };
        else if (t === S2C.WELCOME) {
          c.id = r.u16();
          resolve(c);
        } else if (t === S2C.FRIENDS) for (let n = r.u8(); n > 0; n--) c.accounts.set(r.u16(), r.str());
        else if (t === S2C.BOARD) c.board = readBoard(r);
        else if (t === S2C.REJECT) resolve(c);
      };
      ws.onclose = () => resolve(c);
      c.close = () => new Promise((done) => ((ws.onclose = done), ws.close(LEFT_CODE))); // ("Leave game": a plain close would be a drop the game holds them through)
    });

  const ann = browser();
  const ben = browser();
  const cal = browser();

  // ---- registering
  {
    const me0 = await ann.get('/api/auth/me');
    check('a server with a database has accounts, and nobody is signed in yet', me0.status === 200 && me0.body.accounts === true && me0.body.user === null, JSON.stringify(me0.body));
    const bad = await Promise.all([
      ann.post('/api/auth/register', { email: 'not-an-email', username: 'Ann', password: 'longenough' }),
      ann.post('/api/auth/register', { email: 'ann@example.com', username: 'Ann', password: 'short' }),
      ann.post('/api/auth/register', { email: 'ann@example.com', username: 'a', password: 'longenough' }),
      ann.post('/api/auth/register', { email: 'ann@example.com', username: 'Ann#1', password: 'longenough' }),
    ]);
    check('register turns down a bad email, a short password, a short name and a name with #, saying which field', bad.every((r) => r.status === 400) && bad.map((r) => r.body.field).join() === 'email,password,username,username', JSON.stringify(bad.map((r) => r.body)));
    const ok = await ann.post('/api/auth/register', { email: 'Ann@Example.com', username: 'Ann', password: 'ann-password', guestId: ann.guestId });
    check('register makes the account and signs it in (an HttpOnly cookie)', ok.status === 201 && ok.body.user?.username === 'Ann' && ann.cookie && ok.setCookie.some((c) => /HttpOnly/.test(c) && /SameSite=Lax/.test(c)), JSON.stringify(ok));
    check('...without the password or its hash in what comes back', !JSON.stringify(ok.body).includes('ann-password') && !JSON.stringify(ok.body).includes('scrypt'));
    const dupEmail = await cal.post('/api/auth/register', { email: 'ann@EXAMPLE.com', username: 'Annie', password: 'whatever12' });
    const dupName = await cal.post('/api/auth/register', { email: 'cal@example.com', username: 'aNN', password: 'whatever12' });
    check('an email or a name already taken, whatever its case, is a 409', dupEmail.status === 409 && dupEmail.body.field === 'email' && dupName.status === 409 && dupName.body.field === 'username', JSON.stringify([dupEmail.body, dupName.body]));
    const me = await ann.get('/api/auth/me');
    check('the cookie signs them in', me.body.user?.username === 'Ann' && me.body.user.email === 'Ann@Example.com', JSON.stringify(me.body));
    await ben.post('/api/auth/register', { email: 'ben@example.com', username: 'Ben', password: 'ben-password' });
    await cal.post('/api/auth/register', { email: 'cal@example.com', username: 'Cal', password: 'cal-password' });
  }

  // ---- signing out and in
  {
    const old = ann.cookie;
    await ann.post('/api/auth/logout');
    const out = await ann.get('/api/auth/me');
    const stale = await fetch(base + '/api/auth/me', { headers: { cookie: old } }).then((r) => r.json());
    check('signing out signs that browser out, and its old cookie no longer works', out.body.user === null && !ann.cookie && stale.user === null, JSON.stringify([out.body, stale]));
    const wrong = await ann.post('/api/auth/login', { login: 'ann@example.com', password: 'nope-nope' });
    const nobody = await ann.post('/api/auth/login', { login: 'nobody@example.com', password: 'nope-nope' });
    check('a wrong password and an unknown account are both a 401, said the same way', wrong.status === 401 && nobody.status === 401 && wrong.body.error === nobody.body.error, JSON.stringify([wrong.body, nobody.body]));
    const byName = await ann.post('/api/auth/login', { login: 'ANN', password: 'ann-password' });
    check('signing in by name, whatever its case', byName.status === 200 && byName.body.user?.username === 'Ann' && ann.cookie, JSON.stringify(byName.body));
    await ben.post('/api/auth/logout');
    const byEmail = await ben.post('/api/auth/login', { login: ' BEN@example.com ', password: 'ben-password' });
    check('signing in by email', byEmail.status === 200 && byEmail.body.user?.username === 'Ben', JSON.stringify(byEmail.body));
  }

  // ---- another site
  {
    const evil = await ann.post('/api/friends/request', { username: 'Ben' }, { Origin: 'http://evil.example' });
    check('a POST from a page on another site is turned away', evil.status === 403, JSON.stringify(evil));
    const form = await fetch(base + '/api/friends/request', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: ann.cookie }, body: 'username=Ben' });
    check('...and so is a form post', form.status === 415);
    const ws = new WebSocket(`ws://localhost:${port}/social`, { headers: { cookie: ann.cookie, origin: 'http://evil.example' } });
    const opened = await new Promise((r) => {
      ws.onopen = () => r(true);
      ws.onerror = () => r(false);
    });
    check("...and so is another site's page opening the social socket with the cookie", !opened);
    const anon = await browser().social();
    check('the social socket is refused without a session', !anon);
  }

  // ---- friends
  const ids = {};
  {
    check('a signed-in page opens its social socket', (await ann.social()) && (await ben.social()) && (await cal.social()));
    check('...and is told who it is', await ann.hear((m) => m.t === 'hello' && m.user.username === 'Ann'));
    ids.ann = (await ann.get('/api/auth/me')).body.user.id;
    ids.ben = (await ben.get('/api/auth/me')).body.user.id;
    ids.cal = (await cal.get('/api/auth/me')).body.user.id;
    const self = await ann.post('/api/friends/request', { username: 'ann' });
    const none = await ann.post('/api/friends/request', { username: 'Zed' });
    check('a request to yourself is a 400, to nobody a 404', self.status === 400 && none.status === 404);
    const sent = await ann.post('/api/friends/request', { username: '@ben' });
    check('a request goes to the account by name', sent.status === 200 && sent.body.result === 'sent' && sent.body.friend.id === ids.ben, JSON.stringify(sent.body));
    check("...and they hear of it on their socket, with who asked", await ben.hear((m) => m.t === 'friends' && m.why === 'request' && m.who.username === 'Ann'));
    const benList = await ben.get('/api/friends');
    const annList = await ann.get('/api/friends');
    check("it is in their incoming and in my outgoing", benList.body.incoming[0]?.id === ids.ann && annList.body.outgoing[0]?.id === ids.ben && !benList.body.friends.length, JSON.stringify([benList.body, annList.body]));
    const again = await ann.post('/api/friends/request', { username: 'Ben' });
    check('asking again while it waits is pending, not another', again.body.result === 'pending');
    const dmEarly = await ann.post('/api/messages', { to: ids.ben, body: 'hi?' });
    check('no messages before they are friends', dmEarly.status === 403);
    const acc = await ben.post('/api/friends/accept', { id: ids.ann });
    check('accepting it makes them friends, both ways round', acc.status === 200 && (await ann.get('/api/friends')).body.friends[0]?.username === 'Ben' && (await ben.get('/api/friends')).body.friends[0]?.username === 'Ann');
    check('...and the asker hears of it', await ann.hear((m) => m.t === 'friends' && m.why === 'accepted' && m.who.id === ids.ben));
    const already = await ben.post('/api/friends/request', { username: 'Ann' });
    check('a request to a friend says so', already.body.result === 'already');
    // Cal asks Ben, Ben asks Cal back: that is accepting it
    await cal.post('/api/friends/request', { username: 'Ben' });
    const back = await ben.post('/api/friends/request', { username: 'Cal' });
    check('asking someone who asked you is accepting them', back.body.result === 'accepted' && (await cal.get('/api/friends')).body.friends.some((f) => f.id === ids.ben), JSON.stringify(back.body));
    // Ann asks Cal, then takes it back
    await ann.post('/api/friends/request', { username: 'Cal' });
    await ann.post('/api/friends/decline', { id: ids.cal });
    check('a request taken back is gone from both sides', !(await cal.get('/api/friends')).body.incoming.length && !(await ann.get('/api/friends')).body.outgoing.length);
  }

  // ---- messages
  {
    ben.heard.length = 0;
    ann.heard.length = 0;
    const sent = await ann.post('/api/messages', { to: ids.ben, body: '  meet at the gas station  ' });
    check('a message to a friend is kept, trimmed', sent.status === 201 && sent.body.message.body === 'meet at the gas station' && sent.body.message.from === ids.ann, JSON.stringify(sent.body));
    check('...comes to them at once on their socket, with who sent it', await ben.hear((m) => m.t === 'dm' && m.message.body === 'meet at the gas station' && m.message.fromName === 'Ann'));
    check("...and to the sender's other pages", await ann.hear((m) => m.t === 'dm' && m.message.to === ids.ben));
    const list = await ben.get('/api/friends');
    check('...and counts as unread for them', list.body.friends.find((f) => f.id === ids.ann)?.unread === 1, JSON.stringify(list.body.friends));
    await ben.post('/api/messages', { to: ids.ann, body: 'on my way' });
    const hist = await ben.get(`/api/messages/${ids.ann}`);
    check('the conversation, oldest first, from either side', hist.body.messages.map((m) => m.body).join('|') === 'meet at the gas station|on my way' && (await ann.get(`/api/messages/${ids.ben}`)).body.messages.length === 2, JSON.stringify(hist.body));
    await ben.post('/api/messages/read', { friendId: ids.ann });
    check('reading it clears the unread count', (await ben.get('/api/friends')).body.friends.find((f) => f.id === ids.ann)?.unread === 0);
    const long = await ann.post('/api/messages', { to: ids.ben, body: 'x'.repeat(501) });
    const empty = await ann.post('/api/messages', { to: ids.ben, body: '   ' });
    const stranger = await cal.post('/api/messages', { to: ids.ann, body: 'hey' });
    const peek = await cal.get(`/api/messages/${ids.ann}`);
    check('too long, empty, to a stranger, or reading a stranger\'s: refused', long.status === 400 && empty.status === 400 && stranger.status === 403 && peek.status === 403, JSON.stringify([long.status, empty.status, stranger.status, peek.status]));
    let n = 0;
    for (let i = 0; i < 30; i++) if ((await ann.post('/api/messages', { to: ids.ben, body: `spam ${i}` })).status === 429) n++;
    check('a flood of messages is slowed down', n > 0, String(n));
  }

  // ---- playing as the account, and joining a friend
  {
    ann.heard.length = 0;
    const pub = await fetch(base + '/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ben and co' }) }).then((r) => r.json());
    const b = await play(ben, pub.code, 'Imposter');
    const g = await play(null, pub.code, 'Guest');
    await sleep(300);
    check('a signed-in player plays under their account name, whatever the JOIN says', b.accounts.get(b.id) === 'Ben' && g.accounts.get(b.id) === 'Ben', JSON.stringify([...g.accounts]));
    check("...and a guest has no account to send a request to", b.accounts.get(g.id) === '', JSON.stringify([...b.accounts]));
    check('a friend hears that they started playing', await ann.hear((m) => m.t === 'friends' && m.why === 'presence' && m.who.id === ids.ben && m.status === 'playing'));
    const fl = (await ann.get('/api/friends')).body.friends.find((f) => f.id === ids.ben);
    check("the friends list has them playing, with the game's code to join by", fl?.status === 'playing' && fl.game?.code === pub.code && fl.game.name === 'Ben and co', JSON.stringify(fl));
    const cl = (await cal.get('/api/friends')).body.friends.find((f) => f.id === ids.ben);
    check('...for every friend', cl?.status === 'playing');
    const where = await ann.get(`/api/friends/${ids.ben}/game`);
    check('a friend can look up the game to join them', where.status === 200 && where.body.code === pub.code);
    const a = await play(ann, pub.code, 'Ann');
    await sleep(300);
    check('...and join it', a.id > 0 && a.accounts.get(b.id) === 'Ben' && a.accounts.get(a.id) === 'Ann');
    // the board from the database, through a game
    a.ws.send(Uint8Array.of(C2S.BOARD));
    check('the leaderboard comes from the database through the game, with everyone here on it', await until(() => a.board && a.board.rows.some((r) => r.me && r.name === 'Ann') && a.board.rows.some((r) => r.here && r.name === 'Ben')), JSON.stringify(a.board));
    await Promise.all([a.close(), b.close(), g.close()]);
    check('a friend hears that they stopped playing', await ann.hear((m) => m.why === 'presence' && m.who.id === ids.ben && m.status === 'online'));

    // invite only: the code goes to friends, and nobody else
    const inv = await fetch(base + '/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteOnly: true }) }).then((r) => r.json());
    const b2 = await play(ben, inv.code, 'Ben');
    await until(async () => (await ann.get('/api/friends')).body.friends.find((f) => f.id === ids.ben)?.status === 'playing');
    const fl2 = (await ann.get('/api/friends')).body.friends.find((f) => f.id === ids.ben);
    check("a friend in an invite-only game: their friends get its code", fl2?.game?.code === inv.code && fl2.game.inviteOnly === true, JSON.stringify(fl2));
    await ann.post('/api/friends/remove', { id: ids.ben });
    const gone = await ann.get(`/api/friends/${ids.ben}/game`);
    const list = (await ann.get('/api/friends')).body;
    check('removing a friend: off both lists, and no more joining them or messages', gone.status === 403 && !list.friends.some((f) => f.id === ids.ben) && !(await ben.get('/api/friends')).body.friends.some((f) => f.id === ids.ann) && (await ann.post('/api/messages', { to: ids.ben, body: 'hi' })).status === 403, JSON.stringify([gone, list]));
    await b2.close();
  }

  // ---- signing out closes the social socket
  {
    await cal.post('/api/auth/logout');
    check('signing out closes that browser\'s social socket', await until(() => cal.closedWith === 4001), String(cal.closedWith));
  }

  // ---- the matches played, in the database
  {
    const guest = browser();
    const pub = await fetch(base + '/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Recorded' }) }).then((r) => r.json());
    const a = await play(ann, pub.code, 'Ann');
    const g = await play(guest, pub.code, 'Visitor');
    await sleep(1200);
    await Promise.all([a.close(), g.close()]);
    await sleep(1600); // (the match ends as the last one leaves; the store writes once a second)
    const mine = await ann.get('/api/me/stats');
    check("an account's stats and its last matches", mine.status === 200 && mine.body.stats?.games >= 1 && mine.body.recent.length >= 1 && mine.body.recent[0].outcome === 'abandoned', JSON.stringify(mine.body));
    // one more being played when the server goes down
    const inv = await fetch(base + '/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Cut short', inviteOnly: true }) }).then((r) => r.json());
    const b = await play(ben, inv.code, 'Ben');
    await sleep(800);
    check('the server logged nothing that went wrong', !/failed|Error|error:/.test(proc.log()), proc.log().split('\n').filter((l) => /failed|Error|error:/.test(l)).join('\n'));
    for (const x of [ann, ben]) x.ws?.close();
    await stop(proc);
    b.ws.close();
    const db = await openDb(`pglite:${join(dir, 'db')}`);
    const q = async (sql, params) => (await db.query(sql, params)).rows;
    const recorded = (await q(`SELECT * FROM matches WHERE room_code = $1`, [pub.code]))[0];
    check('a match is recorded: where, how it ended, how far, how many', recorded?.outcome === 'abandoned' && recorded.peak_players === 2 && recorded.unique_players === 2 && recorded.last_day === 1 && recorded.ended_at && recorded.quick === false && recorded.invite_only === false, JSON.stringify(recorded));
    const stints = await q(`SELECT * FROM match_players WHERE match_id = $1 ORDER BY name`, [recorded?.id]);
    check('a stint for each player: the account by its id, the guest by its hash and not its id', stints.length === 2 && stints[0].user_id === ids.ann && stints[1].guest_key && stints[1].user_id === null && !JSON.stringify(stints).includes(guest.guestId) && stints.every((x) => x.seconds > 0 && x.left_reason), JSON.stringify(stints.map((x) => [x.name, x.user_id, x.guest_key, x.seconds, x.left_reason, x.outcome])));
    const evs = (await q(`SELECT type FROM match_events WHERE match_id = $1 ORDER BY id`, [recorded?.id])).map((e) => e.type);
    check('...and its events', evs.filter((t) => t === 'join').length === 2 && evs.includes('leave') && evs.includes('abandoned'), evs.join());
    const cut = (await q(`SELECT * FROM matches WHERE room_code = $1`, [inv.code]))[0];
    const cutStint = (await q(`SELECT * FROM match_players WHERE match_id = $1`, [cut?.id]))[0];
    check('a match being played when the server went down is ended as interrupted, with its player in it', cut?.outcome === 'interrupted' && cut.invite_only === true && cutStint?.user_id === ids.ben && cutStint.left_reason === 'match_end', JSON.stringify([cut, cutStint]));
    const report = await q(`SELECT * FROM analytics_overview()`);
    check('the analytics functions see them', report[0].matches >= 3 && report[0].accounts >= 2 && report[0].abandoned >= 1 && report[0].interrupted >= 1, JSON.stringify(report[0]));
    await db.close();
  }
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

// ---------------------------------------------------------------- no database: as before, without accounts
try {
  const { base } = await startServer({ DATABASE_URL: '' });
  const me = await fetch(base + '/api/auth/me').then((r) => r.json());
  const reg = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.cd', username: 'Abc', password: 'abcdefgh' }) });
  const fr = await fetch(base + '/api/friends');
  check('without a database: no accounts, and their API says so with a 503', me.accounts === false && reg.status === 503 && fr.status === 503);
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

await Promise.all(procs.map(stop));
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
