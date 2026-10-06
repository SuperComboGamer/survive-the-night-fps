// Server entry, the network thread: uWebSockets.js transport (binary WebSocket at /ws), the lobby's HTTP API
// (/api/games), static file serving of the built client (dist/) and a /status JSON endpoint. The games themselves
// run in worker threads, one game server each (rooms.js, room-worker.js); this thread routes every socket to its
// game by the code in its URL (/ws?game=CODE), or with no code to whichever public game a quick join picks.
//
// With a database (DATABASE_URL, db/index.js) it also has accounts (/api/auth, auth.js), friends and direct
// messages (/api/friends, /api/messages and the /social socket, social.js), the leaderboard in Postgres
// (dbstats.js) and a record of every match played (matchstore.js). Without one it runs as before: the leaderboard in
// a file (stats.js), nobody signed in.
//
// A deploy does not end the games (handoff.js): on SIGTERM each is saved into the store and its players are sent
// HANDOFF_CLOSE, and the new server - up by then - restores it under the same code for them to reconnect to.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import uWS from 'uWebSockets.js';
import { Lobby, rejectBytes, defaultMaxGames } from './rooms.js';
import { chosenDifficulty } from '../shared/difficulty.js';
import { PlayerStats } from './stats.js';
import { openDb, describeUrl } from './db/index.js';
import { migrate } from './db/migrate.js';
import { DbStats } from './dbstats.js';
import { MatchStore } from './matchstore.js';
import { Auth, COOKIE, publicUser } from './auth.js';
import { Social } from './social.js';
import { Feedback } from './feedback.js';
import { UserSettings } from './usersettings.js';
import { ServerSettings } from './serversettings.js';
import { Progress } from './progress.js';
import { AchievementStore } from './userachievements.js';
import { BestiaryStore } from './userbestiary.js';
import { idKey } from './stats.js';
import { api, HttpError, parseCookies, sameOrigin } from './http.js';
import { FileStore, PgStore, BUILD } from './handoff.js';
import { Cluster } from './cluster.js';
import { clientOf } from './netaddr.js';
import { REJECT_REASON, PROTOCOL_VERSION } from '../shared/protocol.js';
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
// ...and their bestiaries (the same: a guest's is their browser's)
const bestiary = db ? new BestiaryStore({ db, log }) : null;

// Where a game waits between the server going down and the next one (handoff.js): Postgres when there is one (it is
// what both servers of a deploy can reach), else files in HANDOFF_DIR or on the Railway volume (a restart on the
// same disk: `npm run dev`, the tests). Neither: a deploy ends every game, as it does with HANDOFF=0.
const HANDOFF_MAX_AGE = +(process.env.HANDOFF_MAX_AGE_SECONDS || 300); // a save nobody claimed in this long is dropped
const HANDOFF_DIR = process.env.HANDOFF_DIR || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'handoff') : '');
const store = process.env.HANDOFF === '0' ? null : db?.kind === 'postgres' ? new PgStore(db, { log }) : HANDOFF_DIR ? new FileStore(resolve(HANDOFF_DIR)) : null;
if (store) log(`handoff: games are handed to the next server through ${store instanceof PgStore ? 'Postgres' : store.dir}`);

// the settings changed in the database without a deploy (serversettings.js): the most games at once
const settings = db ? new ServerSettings({ db, log }) : null;
await settings?.start();

const lobby = new Lobby({
  settings,
  store,
  handoffMaxAge: HANDOFF_MAX_AGE,
  stats,
  matches,
  achievements,
  bestiary,
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
    // Test and look-dev servers can authorize every player without accounts. Other environments ignore it.
    devAdmin: ['development', 'test'].includes(process.env.NODE_ENV) && process.env.DEV_ADMIN === '1',
  },
});

// Several game servers behind the proxy (cluster.js, server/proxy/): CLUSTER=1, with Postgres for them to share.
// Without it this server is the whole game, as it always was.
const cluster = process.env.CLUSTER === '1' && db?.kind === 'postgres' ? new Cluster({ db, lobby, port: PORT, deployment: BUILD, log }) : null;
if (process.env.CLUSTER === '1' && !cluster) log('CLUSTER=1 needs a Postgres DATABASE_URL: running as a server on its own');
lobby.cluster = cluster;

// The games the last server handed over: whatever is waiting already (a server that started after the last one went),
// and each one as it is saved - this server is up before the old one is told to stop. (Not while this one is
// stopping itself: it hears its own saves too.)
let stopping = false;
if (store) {
  await store.sweep(HANDOFF_MAX_AGE).catch((err) => log(`handoff: could not sweep old saves (${err.message})`));
  store.listen((code) => stopping || lobby.restore(code));
  for (const code of await store.pending().catch(() => [])) lobby.restore(code);
  setInterval(() => store.sweep(HANDOFF_MAX_AGE).catch(() => {}), 60_000).unref();
}

// accounts, friends and messages: only with a database
const auth = db ? new Auth({ db, stats, log }) : null;
const social = db ? new Social({ db, auth, lobby, cluster, log }) : null;
const feedback = db ? new Feedback({ db, matches, log }) : null; // what players think of the game: the end screen's poll
const userSettings = db ? new UserSettings({ db }) : null; // a player's own settings on their account: their keybinds
if (auth) setInterval(() => auth.sweep().catch(() => {}), 3600_000).unref();
// levels and perks: kept with the stats, database or file (a pick reaches the games the player is in at once)
const progress = new Progress({
  stats,
  changed: (key, perks) => {
    lobby.progressChanged(key, perks);
    cluster?.publish({ t: 'progress', key, perks });
  },
});
cluster?.on('progress', (m) => lobby.progressChanged(m.key, m.perks));

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
// The game counts joins per address (Game.admitJoin): the client's, not a proxy's in front (netaddr.js)
function clientAddress(res, req) {
  // uWS spells the peer out as eight hex groups, an IPv4 one as 0000:0000:0000:0000:0000:ffff:hhhh:hhhh
  let peer = Buffer.from(res.getRemoteAddressAsText()).toString();
  const v4 = /^(?:0000:){5}ffff:(..)(..):(..)(..)$/i.exec(peer);
  if (v4) peer = v4.slice(1).map((h) => parseInt(h, 16)).join('.');
  return clientOf(peer, req.getHeader('x-forwarded-for'), req.getHeader('x-real-ip'));
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
    // (a game the last server handed over that is still in the store: brought back first, so the socket finds it. A
    // quick join with no game to go to, in a cluster: one is made first, as the other servers have to be asked)
    const restoring = code && store && !lobby.rooms.has(code) ? lobby.restore(code).catch((err) => log(`game ${code} not restored (${err.message})`)) : !code && lobby.cluster && !lobby.quickPick() ? lobby.make({ quick: true }) : null;
    if (!token && !restoring) return go(null);
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    // Always re-read a game connection: admin role changes and revoked sessions must not come from the minute cache.
    const user = token
      ? auth.userForToken(token, true).catch((err) => {
          log(`session lookup failed (${err.message}): joining as a guest`);
          return null;
        })
      : null;
    Promise.all([user, restoring]).then(([u]) => aborted || go(u));
  },
  open: (ws) => {
    const d = ws.getUserData();
    let reason = 0;
    if (stopping) reason = REJECT_REASON.FULL; // (going down: new sockets belong on the next server)
    else if (CONN_PER_IP && (perIp.get(d.ip) || 0) >= CONN_PER_IP) reason = REJECT_REASON.FULL;
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
const STATUS_TEXT = { 200: '200 OK', 201: '201 Created', 400: '400 Bad Request', 404: '404 Not Found', 409: '409 Conflict', 413: '413 Payload Too Large', 415: '415 Unsupported Media Type', 429: '429 Too Many Requests', 503: '503 Service Unavailable' };
function json(res, status, obj) {
  res.cork(() => {
    res.writeStatus(STATUS_TEXT[status] || String(status)).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store').end(JSON.stringify(obj));
  });
}
const lobbyInfo = () => ({ games: lobby.rooms.size, maxGames: lobby.cluster || lobby.maxTotal === null ? lobby.maxGames : Math.min(lobby.maxGames, lobby.maxTotal), canCreate: lobby.canCreate, players: lobby.players(), defaultPlayers: lobby.maxPlayers, maxPlayers: lobby.roomMaxPlayers });

// the public games, and what a new one can be
app.get('/api/games', (res) => json(res, 200, { ...lobbyInfo(), list: lobby.list() }));

// one game by its code (an invite link asks before joining: who is in it, is there a seat)
app.get('/api/games/:code', (res, req) => {
  const code = req.getParameter(0);
  const ip = clientAddress(res, req);
  const answer = () => {
    const room = lobby.find(code, ip);
    if (room) json(res, 200, room.info());
    else json(res, 404, { error: 'No game goes by that code. It may have ended.' });
  };
  if (!store || lobby.rooms.has(String(code).toUpperCase())) return answer();
  // (one the last server handed over and nobody has asked for yet)
  let aborted = false;
  res.onAborted(() => {
    aborted = true;
  });
  lobby
    .restore(code)
    .catch(() => null)
    .then(() => aborted || answer());
});

// What is deployed: the protocol and the client's build. A client dropped by a deploy (handoff.js) asks before
// reconnecting: another build means the page has to be loaded again first (client/main.js). The build is the page
// itself, which names the bundles by their content: it changes when the client does, not on every commit.
// (CLIENT_BUILD: a build of another name, for the tests)
const CLIENT_BUILD = process.env.CLIENT_BUILD || (files.get('/index.html') ? createHash('sha256').update(files.get('/index.html').body).digest('hex').slice(0, 12) : BUILD);
app.get('/api/version', (res) => json(res, 200, { protocol: PROTOCOL_VERSION, build: CLIENT_BUILD }));

// makes a game: { name, host, inviteOnly, maxPlayers, difficulty } -> its info, code included.
// difficulty is ember, nightfall or blackout (shared/difficulty.js). Left off, it is Nightfall, which plays as the valley always has.
app.post('/api/games', (res, req) => {
  const ip = clientAddress(res, req);
  const token = sessionToken(req);
  // (JSON only: a form on another site cannot post that without the browser asking this server first)
  if (!/^application\/json\b/i.test(req.getHeader('content-type'))) return json(res, 415, { error: 'Send JSON' });
  let body = Buffer.alloc(0);
  let done = false;
  let aborted = false;
  res.onAborted(() => {
    done = aborted = true;
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
    const difficulty = chosenDifficulty(o.difficulty);
    if (!difficulty) return json(res, 400, { error: 'Pick easy, standard, or hard.' });
    // who it is made by, for their one game at a time: the account signed in, else the address
    const user = token ? auth.userForToken(token).catch(() => null) : null;
    Promise.resolve(user)
      .then((u) => lobby.make({ name: o.name, host: o.host, inviteOnly: o.inviteOnly === true, maxPlayers: o.maxPlayers, difficulty }, { ip, maker: u ? `u:${u.id}` : `ip:${ip}` }))
      .then(async (made) => {
        if (made.error) return aborted || json(res, made.status, made.code ? { error: made.error, code: made.code } : { error: made.error });
        // (behind the proxy: listed before its maker hears the code, so the proxy can send them to it)
        await made.room.up;
        aborted || json(res, 201, made.room.info());
      })
      .catch((err) => {
        log(`game not made (${err.message})`);
        aborted || json(res, 503, { error: 'The game could not be made. Try again in a moment.' });
      });
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

// The splash has no game socket yet, so it reads the public, all-time board here. Once in a game the binary board
// message is still used: that version also includes the requesting player and everyone currently in their game.
route('get', '/api/leaderboard', async () => {
  const { total, rows } = await stats.board(null, new Set());
  return {
    body: {
      total,
      rows: rows.map((r) => ({
        name: r.name,
        me: false,
        here: false,
        kills: r.kills,
        nights: r.nights,
        wins: r.wins,
        revives: r.revives,
        ranks: null,
      })),
    },
  };
});

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

// Your level and perks (server/progress.js). Signed in, they are the account's; else guestId, the browser's leaderboard
// id, says whose (posted, never in a URL: it is what proves who a guest is).
// { guestId? } -> { xp, level, into, need, frac, perks, picks, points, pending, nextPick, respecs }
const progressWho = async (ctx, b) => {
  const user = auth ? await auth.userForToken(ctx.cookies[COOKIE]) : null;
  return user ? { userId: user.id } : { guestId: typeof b?.guestId === 'string' ? b.guestId : '' };
};
route('post', '/api/progress', async (ctx, b) => ({ body: await progress.view(await progressWho(ctx, b)) }), { body: true });
// { perk, guestId? }: a point on a perk of the tree that is open to you -> the same as /api/progress afterwards
route('post', '/api/progress/pick', async (ctx, b) => ({ body: await progress.pick(await progressWho(ctx, b), b.perk) }), { body: true });
// { perk, guestId? }: the point on a perk back, when nothing else you have needs it -> the same afterwards
route('post', '/api/progress/unpick', async (ctx, b) => ({ body: await progress.unpick(await progressWho(ctx, b), b.perk) }), { body: true });
// { guestId? }: every point back, to be spent again -> the same as /api/progress afterwards
route('post', '/api/progress/respec', async (ctx, b) => ({ body: await progress.respec(await progressWho(ctx, b)) }), { body: true });

// An account's profile by the name it plays under, for the player list's profile card: { username, since, xp, level,
// perks, stats: { kills, nights, wins, revives, games, deaths, downs, headshots, bossKills, bestDay, playSeconds } }.
// What the leaderboard shows anyway, and their perks; nothing that says who they are beyond the name.
route('get', '/api/players/:name', async (ctx) => {
  if (!auth) noAccounts();
  const p = await stats.profile(ctx.params[0]);
  if (!p) throw new HttpError(404, 'Nobody plays under that name.');
  return { body: p };
});

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
  const body = JSON.stringify({ ...lobbyInfo(), db: db ? db.kind : null, server: cluster ? { id: cluster.id, deployment: cluster.deployment, draining: cluster.draining } : undefined, net: { ...mainLoad, sockets: [...perIp.values()].reduce((a, b) => a + b, 0) }, rssMb: Math.round(mem.rss / 1e6), list: games });
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
  // (the page itself is asked for again every time: after a deploy a reload has to get the new build's)
  res.writeHeader('Cache-Control', url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.end(f.body);
});

app.listen(PORT, (token) => {
  if (!token) {
    console.error(`[server] failed to listen on port ${PORT}`);
    process.exit(1);
  }
  console.log(`[server] listening on http://localhost:${PORT} (ws /ws) up to ${MAX_GAMES} games of ${MAX} players (${ROOM_MAX} at most)`);
  // (only once it can be reached: then the proxy may send it players)
  if (cluster) {
    const join = () =>
      stopping ||
      cluster.start({ build: CLIENT_BUILD }).catch((err) => {
        log(`cluster: could not join the other servers (${err.message}): trying again`);
        setTimeout(join, 2000).unref();
      });
    join();
  }
});

// a file-kept leaderboard goes to disk every half minute if it changed, and once more on the way out
if (stats.save) setInterval(() => stats.save(), 30000);
process.on('exit', () => stats.saveSync?.());

// Going down (a deploy sends SIGTERM; the next server is already taking the new connections): every game with players
// in it is handed over to the next server (Lobby.handoffAll). Every match left - a game that could not be handed over,
// one with nobody in it - is ended as it stands and written, with what was still on its way to the database, before
// the process goes. All within HARD_EXIT_MS, whatever happens, which has to stay under the time Railway gives a
// deployment to stop before it kills it (drainingSeconds in railway.json).
const HARD_EXIT_MS = 20_000;
const HANDOFF_WAIT_MS = 8000; // the most a game's worker may take to save it
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(0), HARD_EXIT_MS).unref();
  // (behind the proxy: nothing new is sent here now, and the servers the games go to are known)
  if (cluster) await Promise.race([cluster.drain(), new Promise((r) => setTimeout(r, 2000))]).catch((err) => log(`cluster: could not say this server is going (${err.message})`));
  if (store) {
    log(`${signal}: handing the games over to the next server`);
    const t0 = Date.now();
    try {
      const n = await lobby.handoffAll(store, HANDOFF_WAIT_MS);
      log(`${signal}: ${n} game(s) handed over in ${Date.now() - t0} ms`);
    } catch (err) {
      console.error('[server] handing over:', err.message);
    }
  }
  if (db) {
    log(`${signal}: writing the matches being played`);
    try {
      await lobby.finishAll(1500);
      await matches.close();
      for (const room of lobby.rooms.values()) if (room.match) await matches.interrupt(room.match);
      await stats.close();
      await achievements.close();
      await bestiary.close();
      await store?.close();
      await cluster?.stop().catch((err) => log(`cluster: rows of this server left for the others to sweep (${err.message})`));
      settings?.stop();
      await db.close();
    } catch (err) {
      console.error('[server] shutting down:', err.message);
    }
  } else await store?.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
