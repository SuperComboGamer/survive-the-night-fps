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
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
import { CardService, PgCardStore, MemoryCardStore } from './usercards.js';
import { LoadoutService, PgLoadoutStore, MemoryLoadoutStore, ownerKey as loadoutOwnerKey } from './userloadout.js';
import { LobbyCards } from './lobbycards.js';
import { PublicStats, RANGES } from './publicstats.js';
import { idKey } from './stats.js';
import { api, HttpError, parseCookies, sameOrigin } from './http.js';
import { FileStore, PgStore, BUILD } from './handoff.js';
import { Builds } from './builds.js';
import { compatOf } from './compat.js';
import { Cluster } from './cluster.js';
import { AdminPanel } from './adminpanel.js';
import { clientOf } from './netaddr.js';
import { REJECT_REASON, PROTOCOL_VERSION } from '../shared/protocol.js';
import { DEFAULT_PORT, MAX_PLAYERS } from '../shared/constants.js';
import { LOADOUT_CATALOG, LOADOUT_SLOTS, cleanLoadoutSlots } from '../shared/loadout.js';
import { AUCTION, SKULLS, SKULL_EARN } from '../shared/economy.js';

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
// Dead Hand's collections, accounts' and guests' alike (usercards.js): in the database, or without one in this
// process's memory - kept for as long as it runs. What changes here, the other servers of a cluster read again.
const cards = new CardService({ store: db ? new PgCardStore(db) : new MemoryCardStore(), log, changed: (owners) => lobby.cluster?.publish({ t: 'cards', owners }) });
if (!db) log('cards: no database - the card collections found are kept only as long as this server runs');
const loadouts = new LoadoutService({ store: db ? new PgLoadoutStore(db) : new MemoryLoadoutStore(), log, changed: (owners) => lobby.cluster?.publish({ t: 'loadout', owners }) });
if (!db) log('loadout: no database - loadout items found are kept only as long as this server runs');

// Where a game waits between the server going down and the next one (handoff.js): Postgres when there is one (it is
// what both servers of a deploy can reach), else files in HANDOFF_DIR or on the Railway volume (a restart on the
// same disk: `npm run dev`, the tests). Neither: a deploy ends every game, as it does with HANDOFF=0.
const HANDOFF_MAX_AGE = +(process.env.HANDOFF_MAX_AGE_SECONDS || 300); // a save nobody claimed in this long is dropped
const HANDOFF_DIR = process.env.HANDOFF_DIR || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'handoff') : '');
const store = process.env.HANDOFF === '0' ? null : db?.kind === 'postgres' ? new PgStore(db, { log }) : HANDOFF_DIR ? new FileStore(resolve(HANDOFF_DIR)) : null;
if (store) log(`handoff: games are handed to the next server through ${store instanceof PgStore ? 'Postgres' : store.dir}`);
else log(process.env.HANDOFF === '0' ? 'handoff: off (HANDOFF=0): a deploy ends every game' : 'handoff: no store to hand games over through (a Postgres DATABASE_URL, HANDOFF_DIR or a volume): a deploy ends every game. docs/deploys.md says what to set.');

// the settings changed in the database without a deploy (serversettings.js): the most games at once
const settings = db ? new ServerSettings({ db, log }) : null;
await settings?.start();

const lobby = new Lobby({
  settings,
  store,
  handoffMaxAge: HANDOFF_MAX_AGE,
  // how long a server going down waits for the next one to build its games' valleys before saving them (0: it does not)
  prepareMs: +(process.env.HANDOFF_PREPARE_MS ?? 3000),
  stats,
  matches,
  achievements,
  bestiary,
  cards,
  loadouts,
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
cluster?.on('cards', (m) => cards.reload(m.owners));
cluster?.on('loadout', (m) => loadouts.reload(m.owners));
// bets left in escrow by games that never settled them (usercards.js ESCROW_MAX_AGE) go back, now and every hour
if (db) {
  cards.sweep();
  loadouts.sweep();
  setInterval(() => cards.sweep(), 3600_000).unref();
  setInterval(() => loadouts.sweep(), 3600_000).unref();
}

let stopping = false;

// accounts, friends and messages: only with a database
const auth = db ? new Auth({ db, stats, cards, loadouts, log }) : null;
const lobbyCards = new LobbyCards({ service: cards, loadouts, log });
const social = db ? new Social({ db, auth, lobby, cluster, log }) : null;
const feedback = db ? new Feedback({ db, matches, log }) : null; // what players think of the game: the end screen's poll
const userSettings = db ? new UserSettings({ db }) : null; // a player's own settings on their account: their keybinds, their survivors
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
// A file the build also wrote compressed (vite.config.js precompress: name.gz, name.br beside it) is sent that way to a
// browser that takes it: those are not read now, only noted (gzFile, brFile), and read the first time one is asked for
// (sendStatic). Nothing is compressed here.
function loadDir(dir, prefix = '') {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  const names = new Set(entries.map((e) => e.name));
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) loadDir(full, `${prefix}/${e.name}`);
    else if (/\.(gz|br)$/.test(e.name) && names.has(e.name.slice(0, -3))) continue; // (noted with the file it is of)
    else {
      const f = { body: readFileSync(full), type: MIME[extname(e.name)] || 'application/octet-stream' };
      if (names.has(`${e.name}.gz`)) f.gzFile = `${full}.gz`;
      if (names.has(`${e.name}.br`)) f.brFile = `${full}.br`;
      files.set(`${prefix}/${e.name}`, f);
    }
  }
}
loadDir(DIST);
if (files.size) console.log(`[server] serving ${files.size} static files from dist/`);
else console.log('[server] no dist/ build found - run `npm run build` (or use `npm run dev` for the Vite dev server)');

// What is deployed, as a page knows it (/api/version, and written into the page itself):
//   build   the client: a hash of the page, which names its bundles by their content, so it changes when the client does
//           and only then. (CLIENT_BUILD: a build of another name, for the tests)
//   compat  the code the client and the server both run - shared/, and the protocol. A page of another compat cannot
//           play a game here: it would build another valley, predict other moves (client/net/moveback.js).
//           (CLIENT_COMPAT: another, for the tests)
const CLIENT_BUILD = process.env.CLIENT_BUILD || (files.get('/index.html') ? createHash('sha256').update(files.get('/index.html').body).digest('hex').slice(0, 12) : BUILD);
//           (compat.js: shared/, the protocol, and the wire codec outside shared/)
const COMPAT = process.env.CLIENT_COMPAT || compatOf(resolve(__dirname, '..'), PROTOCOL_VERSION);
// The page carries what it was built as (client/net/moveback.js pageBuild): read from the page, not asked of the server
// later, when a deploy may already have put another build behind the same address.
const stamp = (html, { build, compat, protocol }) => {
  const meta = `<meta name="stn-build" content="${build} ${compat} ${protocol}">`;
  const s = html.toString('utf8');
  const at = s.search(/<head[^>]*>/i);
  return Buffer.from(at < 0 ? meta + s : s.replace(/<head[^>]*>/i, (h) => h + meta));
};
if (files.get('/index.html')) {
  const f = files.get('/index.html');
  f.raw = f.body; // (as built: what is kept for a server after this one to serve, builds.js)
  f.body = stamp(f.body, { build: CLIENT_BUILD, compat: COMPAT, protocol: PROTOCOL_VERSION });
  // (the page built compressed is the page before its stamp: this one is compressed here, the first time it is asked
  // for - 3 KB, a few ms)
  f.gzFile = f.brFile = '';
  f.stamped = f.body.length >= 1024;
}

// A game whose save this build cannot read is carried on by the build that saved it (builds.js, docs/deploys.md): this
// build's code goes into the store for the servers after it, and a save names the build its game runs on. Only signed
// builds are started (HANDOFF_BUILD_KEY, the deploy's secret): without the key, none is kept or started, and a game a
// later build cannot read ends at that deploy. HANDOFF_PIN=0: none of it. HANDOFF_PIN=unsigned: the store is trusted
// to hand this server code (a development server, the tests).
const PIN = process.env.HANDOFF_PIN ?? '1';
const BUILD_KEY = process.env.HANDOFF_BUILD_KEY || '';
const builds = store && PIN !== '0' && (BUILD_KEY || PIN === 'unsigned') ? new Builds({ store, root: resolve(__dirname, '..'), client: { build: CLIENT_BUILD, compat: COMPAT, protocol: PROTOCOL_VERSION }, dist: files, key: BUILD_KEY, unsigned: !BUILD_KEY && PIN === 'unsigned', log }) : null;
lobby.builds = builds;
if (store && PIN !== '0' && !builds) log('handoff: HANDOFF_BUILD_KEY is not set, so no build is kept for the servers after this one or started from the store: a game a later build cannot read (another map, save format or enums) will end at that deploy, its players told why. docs/deploys.md says what to set.');
else if (builds && builds.unsigned) log('handoff: HANDOFF_PIN=unsigned - builds in the store are started here unsigned: anyone who can write to the store can run code on this server');
const PACK_AFTER_MS = +(process.env.HANDOFF_PACK_AFTER_MS ?? 0); // (see app.listen; the tests put it off)

// The games the last server handed over: whatever is waiting already (a server that started after the last one went),
// and each one as it is saved - this server is up before the old one is told to stop. (Not while this one is
// stopping itself: it hears its own saves too.)
if (store) {
  await store.sweep(HANDOFF_MAX_AGE).catch((err) => log(`handoff: could not sweep old saves (${err.message})`));
  store.listen((code) => stopping || lobby.restore(code));
  // (and the games a server going down is about to hand over: their valleys are built here while it still plays them)
  store.listenComing?.((code, info) => stopping || lobby.prepare(code, info));
  for (const code of await store.pending().catch(() => [])) lobby.restore(code);
  setInterval(() => store.sweep(HANDOFF_MAX_AGE).catch(() => {}), 60_000).unref();
}


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
const EARLY_MAX = 8; // messages kept for a socket that is still waiting for its seat (/ws open)

// A game socket's seat in its game (d.code), or in whichever a quick join picks - or it is told why not, and closed
function seat(ws) {
  const d = ws.getUserData();
  let reason = 0;
  let room = null;
  if (stopping) reason = REJECT_REASON.FULL; // (going down: new sockets belong on the next server)
  else if (CONN_PER_IP && (perIp.get(d.ip) || 0) >= CONN_PER_IP) reason = REJECT_REASON.FULL;
  else {
    room = d.code ? lobby.find(d.code, d.ip) : lobby.quick();
    const slot = room ? room.attach(ws) : -1;
    if (slot >= 0) {
      d.room = room;
      d.slot = slot;
    } else reason = room || !d.code ? REJECT_REASON.FULL : lobby.wasLost(d.code) || REJECT_REASON.NO_GAME; // (wasLost: a deploy ended it, and why)
  }
  if (reason) {
    // told why, the way the game tells a join it turns away (the client closes on it; this closes it anyway) - in the
    // codec of the game's own client, for one an older build carries on (or carried on, when a deploy ended it)
    ws.send(rejectBytes(reason, room?.proto || (d.code ? lobby.lostProto(d.code) : undefined)), true, false);
    ws.end(1000, 'rejected');
    return;
  }
  perIp.set(d.ip, (perIp.get(d.ip) || 0) + 1);
  d.counted = true;
  d.at = Date.now();
}
// a message from a game socket, for its game
function hear(ws, bytes) {
  const d = ws.getUserData();
  if (!d.room) return;
  d.room.deliver(d.slot, bytes, !d.heard);
  d.heard = true;
}

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
    // (a game the last server handed over that is still in the store: brought back first, so the socket finds it. A
    // quick join with no game to go to, in a cluster: one is made first, as the other servers have to be asked)
    // (one whose save this build could not read, being carried on by an older build instead: waited for too - settle)
    const pending = code && store && (!lobby.rooms.has(code) || (lobby.rooms.get(code).from && !lobby.rooms.get(code).ready));
    const restoring = pending ? (builds ? lobby.settle(code) : lobby.restore(code)).catch((err) => log(`game ${code} not restored (${err.message})`)) : !code && lobby.cluster && !lobby.quickPick() ? lobby.make({ quick: true }) : null;
    // Always re-read a game connection: admin role changes and revoked sessions must not come from the minute cache.
    const user = token
      ? auth.userForToken(token, true).catch((err) => {
          log(`session lookup failed (${err.message}): joining as a guest`);
          return null;
        })
      : null;
    // The handshake is answered here and now, whatever has to be waited for: the socket gets its seat once that is
    // known (open). Upgrading later, from res.cork() once the promise settles, is what uWebSockets documents, and in
    // v20.52 it drops sockets (seen on Linux: most of them): after the callback, cork() still takes the socket for the
    // HTTP response it was, and reads that response's flags from where they used to be, which the upgrade has given
    // up; when what is there reads as "Connection: close, all sent" it closes the socket, straight after open (close
    // code 1006, 0 ms). Fixed upstream in uNetworking/uWebSockets#1929. (scripts/test-session-socket.js)
    const wait = user || restoring ? Promise.all([user, restoring]).then(([u]) => u, () => null) : null;
    res.upgrade({ ip, code, user: null, wait, early: null, room: null, slot: -1, counted: false, heard: false, at: 0 }, key, proto, ext, context);
  },
  open: (ws) => {
    const d = ws.getUserData();
    if (!d.wait) return seat(ws);
    // who they are, or the game being brought back, is not known yet: what they send meanwhile (their JOIN) is kept
    d.early = [];
    d.wait.then((user) => {
      const early = d.early;
      d.wait = d.early = null;
      if (!early) return; // (closed while it waited)
      d.user = user;
      seat(ws);
      for (const bytes of early) if (d.room) hear(ws, bytes); // (no room: turned away, and closed by now)
    });
  },
  message: (ws, message, isBinary) => {
    if (!isBinary) return;
    const d = ws.getUserData();
    if (!d.early) return hear(ws, new Uint8Array(message)); // (copied in the room: the buffer is only valid during this callback)
    // (a client sends its JOIN and then waits for the answer: more than a few messages before it is not one of ours)
    if (d.early.length >= EARLY_MAX) return ws.end(1008, 'Too much before joining');
    d.early.push(new Uint8Array(message.slice(0)));
  },
  drain: (ws) => {
    const d = ws.getUserData();
    d.room?.drained(d.slot);
  },
  close: (ws, closeCode) => {
    const d = ws.getUserData();
    d.early = null;
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

app.ws('/cards', {
  compression: uWS.DISABLED,
  maxPayloadLength: 16 * 1024,
  maxBackpressure: 256 * 1024,
  idleTimeout: 120,
  sendPingsAutomatically: true,
  upgrade: (res, req, context) => {
    const token = sessionToken(req);
    const key = req.getHeader('sec-websocket-key');
    const proto = req.getHeader('sec-websocket-protocol');
    const ext = req.getHeader('sec-websocket-extensions');
    const wait = token
      ? auth.userForToken(token, true).catch((err) => {
          log(`session lookup failed (${err.message}): playing lobby cards as a guest`);
          return null;
        })
      : null;
    res.upgrade({ ip: clientAddress(res, req), user: null, wait, early: null, cardsJoined: false }, key, proto, ext, context);
  },
  open: (ws) => {
    const d = ws.getUserData();
    if (!d.wait) return lobbyCards.open(ws);
    d.early = [];
    d.wait.then((user) => {
      const early = d.early;
      d.wait = d.early = null;
      if (!early) return;
      d.user = user;
      lobbyCards.open(ws);
      for (const bytes of early) lobbyCards.message(ws, bytes);
    });
  },
  message: (ws, message, isBinary) => {
    if (!isBinary) return;
    const d = ws.getUserData();
    const bytes = new Uint8Array(message.slice(0));
    if (!d.early) return lobbyCards.message(ws, bytes);
    if (d.early.length >= EARLY_MAX) return ws.end(1008, 'Too much before joining');
    d.early.push(bytes);
  },
  close: (ws) => {
    ws.getUserData().early = null;
    lobbyCards.close(ws);
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

// What runs here: { protocol, build, compat } (see CLIENT_BUILD above). A client moved by a deploy (handoff.js) asks
// before going back in, with its game's code (?game=CODE): whether it can go back in as it is, or has to be loaded
// again first, is client/net/moveback.js's to decide. (A page from before compat compares the build alone.)
// A server going down answers 503: its answer is not what the page will be playing on (the edge may send the page's
// next request to the new server, or this one, until this one is gone), so the page asks again. (The body is the same,
// for a page from before this, which reads it whatever the status and joins, and is turned away here as before.)
// With ?game=CODE it is what runs that game: an older build's client for a game that build carries on here (builds.js),
// once it is known what became of the game's restore.
const ownVersion = { protocol: PROTOCOL_VERSION, build: CLIENT_BUILD, compat: COMPAT };
const versionOf = (room) => (room?.pin ? { protocol: room.pin.client.protocol, build: room.pin.client.build, compat: room.pin.client.compat, pinned: true } : ownVersion);
app.get('/api/version', (res, req) => {
  if (stopping) return json(res, 503, { ...ownVersion, stopping: true });
  const code = String(req.getQuery('game') || '')
    .trim()
    .toUpperCase();
  const room = code ? lobby.rooms.get(code) : null;
  if (!code || !builds || (room && room.ready && !room.closed)) return json(res, 200, versionOf(room));
  let aborted = false;
  res.onAborted(() => (aborted = true));
  lobby
    .settle(code)
    .catch(() => null)
    .then((r) => aborted || json(res, stopping ? 503 : 200, versionOf(r)));
});

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

const loadoutOwner = async (ctx, body = null) => {
  const u = auth ? await auth.me(ctx) : null;
  if (u) return `a:${u.id}`;
  const key = loadoutOwnerKey('', body?.guestId || ctx.query.get('guestId') || '');
  if (!key) throw new HttpError(400, 'This browser has no player id yet.');
  return key;
};
route('get', '/api/loadout', async (ctx) => {
  const owner = await loadoutOwner(ctx);
  return { body: { catalog: LOADOUT_CATALOG, slotCount: LOADOUT_SLOTS, currency: SKULLS, ...(await loadouts.profile(owner)) } };
});
const saveLoadout = async (ctx, b) => {
  const owner = await loadoutOwner(ctx, b);
  const got = await loadouts.equip(owner, cleanLoadoutSlots(b.slots));
  return { body: { catalog: LOADOUT_CATALOG, slotCount: LOADOUT_SLOTS, currency: SKULLS, balance: await loadouts.balance(owner), ...got } };
};
route('put', '/api/loadout', saveLoadout, { body: true, max: 4096 });
route('post', '/api/loadout', saveLoadout, { body: true, max: 4096 });

const marketError = (err) => {
  if (err instanceof HttpError) throw err;
  const msg = err?.message || 'That auction action did not work.';
  const code = err?.code || '';
  if (code === 'guest_market') throw new HttpError(401, msg);
  if (code === 'bad_listing' || code === 'bad_price') throw new HttpError(400, msg);
  if (code === 'insufficient_skulls' || code === 'not_owned' || code === 'listed' || code === 'not_listing_owner' || code === 'sold' || code === 'expired' || code === 'own_listing') throw new HttpError(409, msg);
  throw err;
};
const loadoutAccountOwner = async (ctx) => {
  const u = auth ? await auth.need(ctx) : noAccounts();
  return `a:${u.id}`;
};
route('get', '/api/loadout/auction', async (ctx) => {
  const owner = await loadoutOwner(ctx);
  return { body: { catalog: LOADOUT_CATALOG, currency: SKULLS, auction: AUCTION, earn: SKULL_EARN, ...(await loadouts.auction(owner)) } };
});
route(
  'post',
  '/api/loadout/auction/list',
  async (ctx, b) => {
    try {
      const owner = await loadoutAccountOwner(ctx);
      return { status: 201, body: { listing: await loadouts.listItem(owner, b.itemId, b.price), ...(await loadouts.auction(owner)) } };
    } catch (err) {
      marketError(err);
    }
  },
  { body: true, max: 2048 }
);
route(
  'post',
  '/api/loadout/auction/buy',
  async (ctx, b) => {
    try {
      const owner = await loadoutAccountOwner(ctx);
      return { body: { result: await loadouts.buyListing(owner, b.listingId), ...(await loadouts.auction(owner)) } };
    } catch (err) {
      marketError(err);
    }
  },
  { body: true, max: 2048 }
);
route(
  'post',
  '/api/loadout/auction/cancel',
  async (ctx, b) => {
    try {
      const owner = await loadoutAccountOwner(ctx);
      return { body: { listing: await loadouts.cancelListing(owner, b.listingId), ...(await loadouts.auction(owner)) } };
    } catch (err) {
      marketError(err);
    }
  },
  { body: true, max: 2048 }
);

// The stats page (/stats, publicstats.js): the whole game's numbers for anyone, ?range=7d|30d|90d|all. Without a
// database: { enabled: false, live } - only what is being played now.
const liveNow = async () => {
  if (cluster) {
    const list = await db
      .query(`SELECT info FROM cluster_games WHERE NOT invite_only AND server_id IN (SELECT id FROM cluster_servers WHERE seen_at > now() - interval '30 seconds')`)
      .then((r) => r.rows.map((x) => x.info))
      .catch(() => []);
    return { games: cluster.servers.reduce((n, s) => n + s.games, 0), players: cluster.servers.reduce((n, s) => n + s.players, 0), list: liveList(list) };
  }
  return { games: lobby.rooms.size, players: lobby.players(), list: liveList(lobby.list()) };
};
const liveList = (list) => list.slice(0, 20).map((g) => ({ code: g.code, name: g.name, players: g.players, max: g.max, day: g.day, phase: g.phase, difficulty: g.difficulty }));
const publicStats = db ? new PublicStats({ db, live: liveNow, log }) : null;
const statsRange = (ctx) => (ctx.query.get('range') in RANGES ? ctx.query.get('range') : '30d');
route('get', '/api/stats', async (ctx) => ({ body: publicStats ? await publicStats.publicView(statsRange(ctx)) : { enabled: false, live: await liveNow() } }));
// ...and what only an admin sees: who comes back, how long they stay, the server's health, each deploy's matches
route('get', '/api/stats/admin', async (ctx) => {
  const me = await signedIn(ctx);
  if (!me.isAdmin) throw new HttpError(403, 'Only an admin can see this.');
  return { body: await publicStats.adminView(statsRange(ctx)) };
});

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

// your own survivors (the character creator), as your account keeps them: { customs: { v: 2, list, gone } | null }
// (shared/customs.js). Without accounts on this server: { accounts: false } and none - the browser keeps its own.
route('get', '/api/me/customs', async (ctx) => {
  if (!auth) return { body: { accounts: false, customs: null } };
  return { body: await userSettings.customs((await signedIn(ctx)).id) };
});
// { customs } -> what the account keeps afterwards: yours merged with what it had, survivor by survivor
// (usersettings.js). Junk - not a list, too many, a survivor without a good id - is a 400; at most 32 KB.
const saveCustoms = async (ctx, b) => {
  const me = await signedIn(ctx);
  return { body: await userSettings.saveCustoms(me.id, b) };
};
route('put', '/api/me/customs', saveCustoms, { body: true, max: 32768 });
route('post', '/api/me/customs', saveCustoms, { body: true, max: 32768 });

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

// ---------------------------------------------------------------- the admin panel
// /admin (client/admin.html) and its API, /api/admin/* (adminpanel.js): an admin account only, checked on every request.
// Registered without a database too, where every route says there are no accounts.
new AdminPanel({
  auth,
  db,
  lobby,
  cluster,
  settings,
  social,
  store,
  info: { build: BUILD, clientBuild: CLIENT_BUILD, port: PORT },
  net: () => ({ ...mainLoad, sockets: [...perIp.values()].reduce((a, b) => a + b, 0) }),
  stopping: () => stopping,
  restart: (code) => shutdown('admin restart', code),
  log,
}).routes(route);

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

const ADMIN_PAGE_HEADERS = [
  ['X-Frame-Options', 'DENY'],
  ['Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"],
  ['Referrer-Policy', 'same-origin'],
  ['X-Content-Type-Options', 'nosniff'],
];
// copy: which of the file goes ('br', 'gz' - in memory by now - or '' for the file as it is)
function sendFile(res, url, f, copy = '') {
  res.cork(() => {
    res.writeHeader('Content-Type', f.type);
    // (the admin panel is never shown inside another site's page, where a click could be steered onto its buttons, and
    // runs no script and sends nothing anywhere but here)
    if (url === '/admin.html') for (const [k, v] of ADMIN_PAGE_HEADERS) res.writeHeader(k, v);
    // (the page itself is asked for again every time: after a deploy a reload has to get the new build's)
    res.writeHeader('Cache-Control', url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    const body = (copy && f[copy]) || f.body;
    if (f.gzFile || f.brFile || f.gz || f.br || f.stamped) res.writeHeader('Vary', 'Accept-Encoding');
    if (body !== f.body) res.writeHeader('Content-Encoding', copy === 'br' ? 'br' : 'gzip');
    res.end(body);
  });
}
// The copy of a file for a browser that takes `accepts` (its Accept-Encoding): 'br' or 'gz' when there is one (written
// by the build; the stamped page's made here, once), else ''
function encodingFor(f, accepts) {
  const br = /\bbr\b/.test(accepts);
  const gz = /\bgzip\b/.test(accepts);
  if (f.stamped && (br || gz) && !f.gz) {
    f.gz = gzipSync(f.body, { level: 9 });
    f.br = brotliCompressSync(f.body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: f.body.length } });
  }
  return br && (f.br || f.brFile) ? 'br' : gz && (f.gz || f.gzFile) ? 'gz' : '';
}
// (a copy the build wrote is read from disk the first time it is wanted, and kept: only the encodings browsers ask for
// are held. One that cannot be read is not tried again - the file goes as it is)
const readCopy = (f, k) =>
  (f[`${k}Read`] ||= readFile(f[`${k}File`]).then(
    (body) => (f[k] = body),
    (err) => {
      log(`${f[`${k}File`]} could not be read (${err.message}): sent as it is`);
      f[`${k}File`] = '';
    }
  ));
// A client file, as the browser takes it. aborted: () => whether the request is gone, for one already waited on (else
// it is watched here, if the copy has to be read first)
function sendStatic(res, url, f, accepts, aborted = null) {
  const k = encodingFor(f, accepts);
  if (!k || f[k]) return sendFile(res, url, f, k);
  if (!aborted) {
    let gone = false;
    res.onAborted(() => (gone = true));
    aborted = () => gone;
  }
  readCopy(f, k).then(() => aborted() || sendFile(res, url, f, f[k] ? k : ''));
}
// The page, and the client's files. A game an older build carries on here (builds.js) is played with that build's
// client: the page asked for with its code (/?game=CODE: where its players' pages are, and its invite link) is that
// build's, once it is known what became of the game's restore; and that build's files are served under their own names,
// which no file of this build has (they are named by their content) - for those players, and for any page of an older
// client still playing after a deploy that only changed the client.
const NOT_FOUND = (res) => res.cork(() => res.writeStatus('404 Not Found').end('Not found'));
// A page that cannot be served just now - this server is going down (the next one has it), or the page of the older
// build that runs this game could not be had from the store: 503, and a page that asks again by itself a few times
// (client/main.js forgets the count once a page is up), then says so. Never the page of another build in its place: a
// page of this build for a game an older build runs would be sent to that game's page again, and again.
const retryPage = (why) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Survive the Night</title></head><body style="background:#0b0d12;color:#ddd;font:16px system-ui,sans-serif;padding:2em"><p id="why">${why}</p><script>(function(){var k='stn.retry.'+location.pathname+location.search,n=0;try{n=+sessionStorage.getItem(k)||0;sessionStorage.setItem(k,n+1)}catch(e){}if(n<5)setTimeout(function(){location.reload()},1000*(n+1));else{try{sessionStorage.removeItem(k)}catch(e){}document.getElementById('why').innerHTML='${why} It still is: try again in a minute, or <a href="/" style="color:#9cf">start or join another game</a>.'}})()</script></body></html>`;
const UNAVAILABLE = (res, why) =>
  res.cork(() => res.writeStatus('503 Service Unavailable').writeHeader('Retry-After', '2').writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', MIME['.html']).end(retryPage(why)));
app.get('/*', (res, req) => {
  let url = req.getUrl();
  if (url === '/stats' || url === '/stats/') url = '/stats.html';
  if (url === '/admin' || url === '/admin/') url = '/admin.html';
  const accepts = req.getHeader('accept-encoding');
  if (!files.has(url) && url.startsWith('/assets/')) {
    if (!builds?.has(url)) return NOT_FOUND(res);
    let aborted = false;
    res.onAborted(() => (aborted = true));
    builds.asset(url).then((body) => aborted || (body ? sendFile(res, url, { body, type: MIME[extname(url)] || 'application/octet-stream' }) : NOT_FOUND(res)));
    return;
  }
  if (url === '/' || !files.has(url)) url = files.has(url) ? url : '/index.html';
  const f = files.get(url);
  if (!f) {
    res.writeStatus('404 Not Found').end('Not found - build the client with `npm run build`');
    return;
  }
  // (a server going down: its pages are the next server's to give - as /api/version, it answers 503 for them)
  if (stopping && f.type === MIME['.html']) return UNAVAILABLE(res, 'The game is being updated. One moment...');
  const code = url === '/index.html' && builds ? String(req.getQuery('game') || '').trim().toUpperCase() : '';
  if (!code) return sendStatic(res, url, f, accepts);
  let aborted = false;
  res.onAborted(() => (aborted = true));
  lobby
    .settle(code)
    .catch(() => null)
    .then(async (room) => {
      if (!room?.pin) return aborted || sendStatic(res, url, f, accepts, () => aborted);
      const page = await builds.asset('/index.html', room.pin.id);
      if (aborted) return;
      if (page) sendFile(res, url, { body: stamp(page, room.pin.client), type: MIME['.html'] });
      else UNAVAILABLE(res, "This game is played on an older version of the game, whose page could not be loaded just now. Trying again...");
    });
});

app.listen(PORT, (token) => {
  if (!token) {
    console.error(`[server] failed to listen on port ${PORT}`);
    process.exit(1);
  }
  // (this build into the store for the servers after it - only where it can be used (builds: a key, or
  // HANDOFF_PIN=unsigned), and not on the way up: once it listens, off the event loop but for a few ms at a time (about
  // 75 ms in all), so it is ready long before this server can be told to stop. Its games' saves name it, so a server
  // told to stop before it is done waits for it: Lobby.handoffAll)
  if (builds) setTimeout(() => stopping || builds.pack(), PACK_AFTER_MS).unref();
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
// exitCode: 0 for a signal; an admin's restart (adminpanel.js) exits with another, for a host that starts the server
// again only after a failure
async function shutdown(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(exitCode), HARD_EXIT_MS).unref();
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
      await lobbyCards.closeAll();
      await cards.close([...lobby.rooms.values()]); // (the bets of the games not handed over go back; the finds are written)
      await loadouts.close();
      await store?.close();
      await cluster?.stop().catch((err) => log(`cluster: rows of this server left for the others to sweep (${err.message})`));
      settings?.stop();
      await db.close();
    } catch (err) {
      console.error('[server] shutting down:', err.message);
    }
  } else await store?.close();
  process.exit(exitCode);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// A Windows process cannot be sent SIGTERM (it is killed outright), so a process manager there - pm2 - asks a server
// with an IPC channel to stop with the message 'shutdown' instead; the tests stop a server that way on Windows too.
// (Only a parent that spawned this server with an IPC channel can send it.)
process.on('message', (m) => (m === 'shutdown' || m?.t === 'shutdown') && shutdown('shutdown message'));
