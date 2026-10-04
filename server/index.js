// Server entry, the network thread: uWebSockets.js transport (binary WebSocket at /ws), the lobby's HTTP API
// (/api/games), static file serving of the built client (dist/) and a /status JSON endpoint. The games themselves
// run in worker threads, one game server each (rooms.js, room-worker.js); this thread routes every socket to its
// game by the code in its URL (/ws?game=CODE), or with no code to whichever public game a quick join picks.
//
// With a database (DATABASE_URL, db/index.js) it also has accounts (/api/auth, auth.js), friends and direct
// messages (/api/friends, /api/messages and the /social socket, social.js), the leaderboard in Postgres
// (dbstats.js) and a record of every match played (matchstore.js). Without one it runs as before: the leaderboard in
// a file (stats.js), nobody signed in.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import uWS from 'uWebSockets.js';
import { Lobby, rejectBytes, defaultMaxGames } from './rooms.js';
import { PlayerStats } from './stats.js';
import { openDb, describeUrl } from './db/index.js';
import { migrate } from './db/migrate.js';
import { DbStats } from './dbstats.js';
import { MatchStore } from './matchstore.js';
import { Auth, COOKIE, publicUser } from './auth.js';
import { Social } from './social.js';
import { Feedback } from './feedback.js';
import { UserSettings } from './usersettings.js';
import { AchievementStore } from './userachievements.js';
import { idKey } from './stats.js';
import { api, HttpError, parseCookies, sameOrigin } from './http.js';
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
const log = (...a) => console.log('[server]', ...a);

// ---------------------------------------------------------------- the database
// Migrated on the way up (MIGRATE_ON_START=0: not); if a pre-deploy step did it already (npm run migrate,
// railway.json) this finds nothing to do. A migration that fails stops a production server here: the deploy then fails
// its health check and Railway keeps the one that is running, on the schema it knows. A database that cannot be
// reached leaves the games running and the accounts failing until it can be.
const db = await openDb(process.env.DATABASE_URL, { log }).catch((err) => {
  console.error('[server] database could not be opened:', err.message);
  return null;
});
if (db) {
  log(`database: ${describeUrl(process.env.DATABASE_URL)} (${db.kind})`);
  if (process.env.MIGRATE_ON_START !== '0') {
    try {
      const { applied } = await migrate(db, { log });
      if (applied.length) log(`database: applied ${applied.join(', ')}`);
    } catch (err) {
      console.error('[server] database migrations failed:', err.message);
      // (an SQL error carries its SQLSTATE: the migration is wrong, not the network)
      if (process.env.NODE_ENV === 'production' && /^[0-9A-Z]{5}$/.test(err.code || '')) process.exit(1);
    }
  }
}

// The leaderboard's records: in the database if there is one (dbstats.js), else in a file (stats.js): STATS_FILE, or
// stats.json on the Railway volume if the service has one, or in data/ here. A file is only as lasting as the disk it
// is on - a deploy without a volume starts from a fresh one. STATS_FILE= (empty) keeps nothing past this process.
const STATS_FILE = process.env.STATS_FILE ?? join(process.env.RAILWAY_VOLUME_MOUNT_PATH || resolve(__dirname, '../data'), 'stats.json');
const stats = db ? new DbStats({ db, log }) : new PlayerStats({ file: STATS_FILE, log });
const matches = db ? new MatchStore({ db, stats, build: process.env.RAILWAY_GIT_COMMIT_SHA || '', log }) : null;
await matches?.closeStale().catch((err) => log(`matches: could not close the last run's (${err.message})`));
// the accounts' achievements (a guest's are kept by their browser, database or not)
const achievements = db ? new AchievementStore({ db, log }) : null;

const lobby = new Lobby({
  stats,
  matches,
  achievements,
  maxGames: MAX_GAMES,
  maxPlayers: MAX,
  roomMaxPlayers: ROOM_MAX,
  limits: process.env.LOBBY_LIMITS !== '0', // 0: no per-address allowance on making games or asking for codes (load tests)
  idleMs: process.env.GAME_IDLE_SECONDS ? +process.env.GAME_IDLE_SECONDS * 1000 : undefined, // an empty game lasts this long (tests)
  log: (...a) => console.log('[server]', ...a),
  // every game is made with these (all but the seed and the admin secret are for testing)
  gameOpts: {
    seed: SEED,
    dayLength: process.env.DAY_SECONDS ? +process.env.DAY_SECONDS : undefined,
    nightLength: process.env.NIGHT_SECONDS ? +process.env.NIGHT_SECONDS : undefined,
    startDay: process.env.START_DAY ? +process.env.START_DAY : undefined,
    godMode: process.env.GODMODE === '1',
    adminSecret: process.env.ADMIN_SECRET || '', // `/admin <it>` in chat lets that player run the admin commands
  },
});

if (process.env.ADMIN_SECRET) log('admin commands: on for whoever says /admin <ADMIN_SECRET> in chat');

// accounts, friends and messages: only with a database
const auth = db ? new Auth({ db, stats, log }) : null;
const social = db ? new Social({ db, auth, lobby, log }) : null;
const feedback = db ? new Feedback({ db, matches, log }) : null; // what players think of the game: the end screen's poll
const userSettings = db ? new UserSettings({ db }) : null; // a player's own settings on their account: their keybinds
if (auth) setInterval(() => auth.sweep().catch(() => {}), 3600_000).unref();

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

// The session token a socket's handshake carries (auth.js), '' for none - or for one sent by a page on another site,
// which could otherwise have a signed-in player's browser play, or listen to their messages, as them
function sessionToken(req) {
  if (!auth || !sameOrigin(req.getHeader('origin'), req.getHeader('host'))) return '';
  return parseCookies(req.getHeader('cookie'))[COOKIE] || '';
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
    // signed in (the session cookie, from a page of ours): they play as their account (Game.handleJoin)
    const token = sessionToken(req);
    const key = req.getHeader('sec-websocket-key');
    const proto = req.getHeader('sec-websocket-protocol');
    const ext = req.getHeader('sec-websocket-extensions');
    const go = (user) => res.cork(() => res.upgrade({ ip, code, user, room: null, slot: -1, counted: false, heard: false, at: 0 }, key, proto, ext, context));
    if (!token) return go(null);
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    auth.userForToken(token).then(
      (user) => aborted || go(user),
      (err) => {
        log(`session lookup failed (${err.message}): joining as a guest`);
        if (!aborted) go(null);
      }
    );
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
    d.at = Date.now();
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
  close: (ws, closeCode) => {
    const d = ws.getUserData();
    // a seat taken by a socket that went before its JOIN came: how, and how soon (a browser that gave up on the
    // handshake shows as 1006 a round trip in; the client tries again, connection.js)
    if (d.room && !d.heard) log(`socket in game ${d.room.code} closed before it joined (code ${closeCode}, ${Date.now() - d.at} ms)`);
    if (d.counted) {
      const n = (perIp.get(d.ip) || 1) - 1;
      if (n > 0) perIp.set(d.ip, n);
      else perIp.delete(d.ip);
      d.counted = false;
    }
    const room = d.room;
    d.room = null;
    room?.detach(d.slot, closeCode);
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

// ---------------------------------------------------------------- accounts, friends, messages
// All JSON; an error is { error } with its status (and a `field` it is about, for a form). Signed in is the
// stn_session cookie. Without a database: /api/auth/me says { accounts: false } and the rest are 503s.
const route = (method, path, fn, opts = {}) => api(app, method, path, fn, { address: clientAddress, ...opts });
const noAccounts = () => {
  throw new HttpError(503, 'Accounts are not set up on this server.');
};
const signedIn = (ctx) => (auth ? auth.need(ctx) : noAccounts());
const S = () => social || noAccounts(); // (before anything else in a handler is looked at)

// who this browser is signed in as: { accounts, user: { id, username, email, createdAt } | null }
route('get', '/api/auth/me', async (ctx) => {
  if (!auth) return { body: { accounts: false, user: null } };
  const u = await auth.me(ctx);
  return { body: { accounts: true, user: u ? publicUser(u) : null } };
});
// { email, username, password, guestId? } -> 201 { user }, signed in. guestId: the browser's leaderboard id, whose
// stats move onto the account
route(
  'post',
  '/api/auth/register',
  async (ctx, b) => {
    if (!auth) noAccounts();
    const { user, cookie } = await auth.register(b, ctx);
    return { status: 201, body: { user: publicUser(user) }, cookies: [cookie] };
  },
  { body: true }
);
// { login (email or name), password, guestId? } -> { user }, signed in
route(
  'post',
  '/api/auth/login',
  async (ctx, b) => {
    if (!auth) noAccounts();
    const { user, cookie } = await auth.login(b, ctx);
    return { body: { user: publicUser(user) }, cookies: [cookie] };
  },
  { body: true }
);
route(
  'post',
  '/api/auth/logout',
  async (ctx) => {
    if (auth) await auth.logout(ctx);
    return { body: { ok: true }, cookies: auth ? [auth.clearCookie(Auth.secure(ctx))] : [] };
  },
  { body: true }
);

// your lifetime stats and your last matches: { stats: { kills, ..., ranks } | null, recent: [match] }
route('get', '/api/me/stats', async (ctx) => {
  const me = await signedIn(ctx);
  const [mine, recent] = await Promise.all([stats.forUser(me.id), matches.recentFor(me.id)]);
  return { body: { stats: mine, recent } };
});

// your achievements (shared/achievements.js): { stats: { kills, nights, ... }, unlocked: [{ id, at (ms), source }] }.
// Without accounts on this server: { accounts: false } - the browser keeps its own
route('get', '/api/achievements', async (ctx) => {
  if (!auth) return { body: { accounts: false, stats: null, unlocked: [] } };
  return { body: await achievements.forUser((await signedIn(ctx)).id) };
});
// a friend's, the same shape (anyone else's is a 403)
route('get', '/api/achievements/:id', async (ctx) => {
  const me = await signedIn(ctx);
  const id = ctx.params[0].toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new HttpError(404, 'No such player.');
  if (id !== me.id && !(await S().areFriends(me.id, id))) throw new HttpError(403, "Only your friends' achievements can be seen.");
  return { body: await achievements.forUser(id) };
});
// What this browser earned as a guest, { stats, unlocked: { id: ms } }, merged into your account (the greater of each
// count, every unlock of either) -> your achievements, as GET. Taken on trust: it never touches the leaderboard
route('post', '/api/achievements/merge', async (ctx, b) => ({ body: await achievements.merge((await signedIn(ctx)).id, b) }), { body: true, max: 16384 });

// your keybinds, as your account keeps them: { binds: { action: [primary, secondary] } | null, updatedAt: ms (0: never
// saved) }. Only what differs from the defaults (shared/binds.js). Without accounts on this server: { accounts: false }
// and no binds - the browser keeps its own.
route('get', '/api/me/binds', async (ctx) => {
  if (!auth) return { body: { accounts: false, binds: null, updatedAt: 0 } };
  return { body: await userSettings.binds((await signedIn(ctx)).id) };
});
// { binds, updatedAt } -> what the account keeps afterwards, the same shape: yours, unless it already had newer ones
// (usersettings.js). Junk - an action that isn't one, a key that isn't one - is a 400.
const saveBinds = async (ctx, b) => {
  const me = await signedIn(ctx);
  return { body: await userSettings.saveBinds(me.id, b) };
};
route('put', '/api/me/binds', saveBinds, { body: true });
route('post', '/api/me/binds', saveBinds, { body: true });

// How hard the run that just ended was, from its end screen: { rating: 1 too easy .. 5 too hard, guestId? } ->
// { mine, counts: [votes for 1..5], total }. Signed in, the vote is the account's; else guestId, the browser's
// leaderboard id, says whose it is (as it does in a JOIN). A 404 when they have no run that just ended.
route(
  'post',
  '/api/feedback/difficulty',
  async (ctx, b) => {
    if (!feedback) throw new HttpError(503, 'Votes are not kept on this server.');
    const user = await auth.userForToken(ctx.cookies[COOKIE]);
    return { body: await feedback.voteDifficulty(user ? { userId: user.id } : { guestKey: idKey(b.guestId) }, b.rating) };
  },
  { body: true }
);

// { friends: [{ id, username, status: offline|online|playing, game, unread, lastSeen, since }], incoming, outgoing }
route('get', '/api/friends', async (ctx) => ({ body: await S().list(await signedIn(ctx)) }));
// { username } -> { result: sent|accepted|pending|already, friend }
route('post', '/api/friends/request', async (ctx, b) => ({ body: await S().request(await signedIn(ctx), b.username) }), { body: true });
// { id }: their request
route('post', '/api/friends/accept', async (ctx, b) => ({ body: await S().accept(await signedIn(ctx), b.id) }), { body: true });
// { id }: turns their request down, or takes yours back
route('post', '/api/friends/decline', async (ctx, b) => ({ body: await S().decline(await signedIn(ctx), b.id) }), { body: true });
route('post', '/api/friends/remove', async (ctx, b) => ({ body: await S().remove(await signedIn(ctx), b.id) }), { body: true });
// the game a friend is in, to join them: its info, code included
route('get', '/api/friends/:id/game', async (ctx) => ({ body: await S().findFriend(await signedIn(ctx), ctx.params[0]) }));
// the conversation with a friend: ?before=<message id> for older -> { messages: [{ id, from, to, body, at, read }], more }
route('get', '/api/messages/:id', async (ctx) => ({ body: await S().history(await signedIn(ctx), ctx.params[0], ctx.query.get('before')) }));
// { to, body } -> 201 { message }
route('post', '/api/messages', async (ctx, b) => ({ status: 201, body: await S().send(await signedIn(ctx), b.to, b.body) }), { body: true });
// { friendId }: everything they sent you is read
route('post', '/api/messages/read', async (ctx, b) => ({ body: await S().markRead(await signedIn(ctx), b.friendId) }), { body: true });

// A signed-in page's line for what happens while it is open (social.js): text frames of JSON, server to page
app.ws('/social', {
  compression: uWS.DISABLED,
  maxPayloadLength: 1024, // (it says nothing that matters: everything it does goes by the HTTP API)
  idleTimeout: 120,
  sendPingsAutomatically: true,
  upgrade: (res, req, context) => {
    const token = sessionToken(req);
    const key = req.getHeader('sec-websocket-key');
    const proto = req.getHeader('sec-websocket-protocol');
    const ext = req.getHeader('sec-websocket-extensions');
    const refuse = () => res.cork(() => res.writeStatus('401 Unauthorized').end('Sign in first'));
    if (!token) return refuse();
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    auth.userForToken(token).then(
      (user) => aborted || (user ? res.cork(() => res.upgrade({ user }, key, proto, ext, context)) : refuse()),
      () => aborted || res.cork(() => res.writeStatus('503 Service Unavailable').end())
    );
  },
  open: (ws) => social.socketOpened(ws),
  message: () => {},
  close: (ws) => social.socketClosed(ws),
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
  const body = JSON.stringify({ ...lobbyInfo(), db: db ? db.kind : null, net: { ...mainLoad, sockets: [...perIp.values()].reduce((a, b) => a + b, 0) }, rssMb: Math.round(mem.rss / 1e6), list: games });
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

// a file-kept leaderboard goes to disk every half minute if it changed, and once more on the way out
if (stats.save) setInterval(() => stats.save(), 30000);
process.on('exit', () => stats.saveSync?.());

// Going down (a deploy sends SIGTERM): every match being played is ended as it stands and written, with what was
// still on its way to the database, before the process goes - within a few seconds, whatever happens.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(0), 5000).unref();
  if (db) {
    log(`${signal}: writing the matches being played`);
    try {
      await lobby.finishAll(1500);
      await matches.close();
      for (const room of lobby.rooms.values()) if (room.match) await matches.interrupt(room.match);
      await stats.close();
      await achievements.close();
      await db.close();
    } catch (err) {
      console.error('[server] shutting down:', err.message);
    }
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
