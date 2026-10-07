// A game the new build cannot carry on is carried on by the build that saved it (docs/deploys.md).
//
// A deploy hands every game to the next server (handoff.js), which makes its Game from the save - if its code still
// reads that save: the same state version, the same enums, the same map of the game's seed. A build that changed any
// of those could only drop the game. Instead every server keeps its own code in the handoff store (a "build": server/
// and shared/, and the client it serves, filed under a hash of all of it), every save names the build its game runs on
// (Room.meta: build), and a server that cannot restore a save with its own code starts that game's worker from the build
// that made it (Lobby.afterFailed, Room's `pin`). The game then runs on exactly as it was - the old simulation, the old
// map - inside the new server; its players keep that build's client (index.js serves its page for the game's code, and
// its files by their content-hashed names), so they are never reloaded for it.
//
// What has to hold for a build to be started here (fetch says why not, and the game ends with its players told why):
//   - it is signed: the store is not trusted to hand this server code. A build carries an HMAC of its name made with
//     HANDOFF_BUILD_KEY, a secret only the deploy has; without the key nothing is started from the store (unless
//     HANDOFF_PIN=unsigned says to trust the store, as a development server may)
//   - it is what its name says: the name is a hash of every file in it, and the signature is of that whole hash
//     (checked on every fetch). It is unpacked into a folder of this process's own that only this server's user can
//     write (made fresh by this process: mkdtemp, mode 0700 - checked), with no links in it but the one to this
//     server's node_modules, and checked against the build every time a worker is started from it
//   - it speaks this server's WORKER_API: what the network thread and a game's worker say to each other
//   - it is not from before a security fix: SECURITY_EPOCH is bumped by a change that must reach every game at once,
//     and a build of a lower epoch is not started - its games end at that deploy, saying an update ended them
//   - the packages its game code imports (node_modules) are the versions installed here: an older build's code runs
//     against this server's node_modules, so a dependency it uses that changed would be other code under it
// A game carried on this way is kept to it for HANDOFF_PIN_MAX_HOURS at most (Room.pinCap): at the first dawn after
// that, or when its run ends, it closes and its players are told why.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync, gzip, gunzip } from 'node:zlib';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { tmpdir, hostname } from 'node:os';

export const WORKER_API = 1; // bump when a message between the network thread and a worker changes meaning or is newly required (room-worker.js)
export const SECURITY_EPOCH = 1; // bump in a change that must reach every running game at once: older builds are not carried on
export const BUILD_KEEP_DAYS = 3;
const CODE_ROOTS = ['server', 'shared'];
const ID_RE = /^[0-9a-f]{24}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const PATH_RE = /^(server|shared)(\/[A-Za-z0-9._@+-]+)+$/; // (no "..", nothing absolute, nothing outside the two)
const URL_RE = /^(\/[A-Za-z0-9._@+-]+)+$/;
const DOTS = /(^|\/)\.\.?(\/|$)/; // (a '.' or '..' step: never in a build)
const goodPath = (path) => PATH_RE.test(path) && !DOTS.test(path);
const goodUrl = (url) => URL_RE.test(url) && !DOTS.test(url);
const MAX_CODE_BYTES = 32 * 1024 * 1024;
const ASSET_CACHE_BYTES = 96 * 1024 * 1024; // the old builds' files kept in memory to serve
const KEEP_EVERY_MS = 12 * 3600e3; // a server marks its own build as in use this often (and puts it back if it was swept)
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const breathe = () => new Promise((r) => setImmediate(r));

// The build's hash: of everything that makes it what it is (64 hex). Its name (id) is the first 24 of it; its signature
// is of the whole hash.
function hashOf({ api, epoch, client, deps, files, dist }) {
  const h = createHash('sha256').update(`stn-build api ${api} epoch ${epoch}\nclient ${client.build} ${client.compat} ${client.protocol}\n`);
  for (const [name, v] of Object.entries(deps).sort()) h.update(`dep ${name} ${v}\n`);
  for (const path of Object.keys(files).sort()) h.update(`file ${path} ${sha256(files[path])}\n`);
  for (const url of Object.keys(dist).sort()) h.update(`dist ${url} ${dist[url]}\n`);
  return h.digest('hex');
}
export const buildHash = (b) => hashOf(b); // (the tests make builds of their own)
export const buildId = (b) => hashOf(b).slice(0, 24);
// hash: the build's whole hash (buildHash), not its name
export const signOf = (hash, key) => createHmac('sha256', key).update(`stn-build ${hash}`).digest('hex');
function signedBy(hash, sig, key) {
  if (typeof sig !== 'string' || !HASH_RE.test(sig)) return false;
  return timingSafeEqual(Buffer.from(signOf(hash, key), 'hex'), Buffer.from(sig, 'hex'));
}

// The packages a game's worker imports, at the versions installed: { name: version }. The worker's module graph is
// walked from server/room-worker.js; a bare import (not ./, not node:) is a package from node_modules.
// (files: the code's files by their paths from the root, already read - packBuild's)
export function workerDeps(root, files = null) {
  const seen = new Set();
  const deps = {};
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const had = files?.[relative(root, file).split(sep).join('/')];
    if (!had && !existsSync(file)) return;
    const src = had ? had.toString('utf8') : readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:^|[\n;])\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g)) {
      const s = m[1] || m[2] || m[3];
      if (s.startsWith('.')) walk(resolve(dirname(file), s));
      else if (!s.startsWith('node:')) {
        const name = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
        let version = 'missing';
        try {
          version = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version || 'unknown';
        } catch {}
        deps[name] = version;
      }
    }
  };
  walk(join(root, 'server', 'room-worker.js'));
  return deps;
}

// The build in `root` (the repository as deployed), with its client `dist` (url -> { body }, as index.js serves it) and
// what that client is ({ build, compat, protocol }). -> { id, sig, body, assets: Map(hash -> Buffer), bytes, files }
// (null when it is too big: something else than code is in server/ or shared/)
export function packBuild(root, opts) {
  const files = {};
  for (const path of codePaths(root)) files[path] = readFileSync(join(root, path));
  return assemble(root, files, opts, gzipSync);
}
// ...the same, the way a running server does it (Builds.pack): the files read and the build gzipped off the event loop,
// which is let go between the client's files as they are hashed (no stretch of it longer than a few ms)
export async function packBuildAsync(root, opts) {
  const paths = codePaths(root);
  const bufs = await Promise.all(paths.map((path) => readFileAsync(join(root, path))));
  const files = Object.fromEntries(paths.map((path, i) => [path, bufs[i]]));
  return assemble(root, files, opts, gzipAsync, true);
}
// (the code's files: the .js files under server/ and shared/, by their paths from the root - nothing else that may lie
// there, such as a .env, and nothing in a folder or of a name that starts with a dot)
function codePaths(root) {
  const paths = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = `${rel}/${e.name}`;
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(path);
      else if (e.isFile() && e.name.endsWith('.js') && goodPath(path)) paths.push(path);
    }
  };
  for (const r of CODE_ROOTS) if (existsSync(join(root, r))) walk(r);
  return paths;
}
function assemble(root, files, { client, dist = new Map(), key = '' }, gz, yields = false) {
  let bytes = 0;
  for (const buf of Object.values(files)) bytes += buf.length;
  if (bytes > MAX_CODE_BYTES) return null;
  const assets = new Map();
  const manifest = {};
  const hashAll = function* () {
    let since = 0;
    for (const [url, f] of dist) {
      if (!goodUrl(url)) continue;
      const body = f.raw || f.body;
      const hash = sha256(body);
      manifest[url] = hash;
      assets.set(hash, body);
      if ((since += body.length) > 4 * 1024 * 1024) (since = 0), yield;
    }
  };
  const rest = () => {
    const b = { api: WORKER_API, epoch: SECURITY_EPOCH, client: { build: String(client.build), compat: String(client.compat), protocol: +client.protocol }, deps: workerDeps(root, files), files, dist: manifest };
    const hash = hashOf(b);
    const id = hash.slice(0, 24);
    const packed = {};
    for (const [path, buf] of Object.entries(files)) packed[path] = buf.toString('base64');
    const done = (body) => ({ id, sig: key ? signOf(hash, key) : '', bytes, files: Object.keys(files).length, assets, body });
    const body = gz(JSON.stringify({ ...b, files: packed }));
    return body instanceof Promise ? body.then(done) : done(body);
  };
  if (!yields) {
    for (const _ of hashAll());
    return rest();
  }
  return (async () => {
    for (const _ of hashAll()) await new Promise((r) => setImmediate(r));
    return rest();
  })();
}

// ...and back: the build `id` names, or why not ({ error }). Its name is checked against its contents; its signature,
// of its whole hash, against the key (key: '' with requireSig false: not checked).
export function openBuild(id, body, sig, opts = {}) {
  const no = refuse(id, sig, opts);
  if (no) return no;
  let raw;
  try {
    raw = gunzipSync(body);
  } catch {
    return { error: 'not a build' };
  }
  return opened(id, raw, sig, opts);
}
// ...the same off the event loop, as a running server does it (fetch, know): the gunzip in the thread pool, and the
// thread let go between parsing it, decoding its files and hashing them (a few ms each)
export async function openBuildAsync(id, body, sig, opts = {}) {
  const no = refuse(id, sig, opts);
  if (no) return no;
  let raw;
  try {
    raw = await gunzipAsync(body);
  } catch {
    return { error: 'not a build' };
  }
  return opened(id, raw, sig, opts, true);
}
function refuse(id, sig, { key = '', requireSig = true }) {
  if (!ID_RE.test(String(id))) return { error: 'not a build name' };
  if (requireSig && !key) return { error: 'no key to check its signature with (HANDOFF_BUILD_KEY)' };
  if (requireSig && (typeof sig !== 'string' || !HASH_RE.test(sig))) return { error: 'its signature is not this deploy key' };
  return null;
}
function opened(id, raw, sig, { key = '', requireSig = true }, yields = false) {
  const steps = (function* () {
    let m;
    try {
      m = JSON.parse(raw.toString('utf8'));
    } catch {
      return { error: 'not a build' };
    }
    yield;
    const b = parsed(m);
    if (b.error) return b;
    yield;
    const hash = hashOf(b);
    if (hash.slice(0, 24) !== id) return { error: 'it is not what its name says' };
    if (key && !signedBy(hash, sig, key)) return { error: requireSig ? 'its signature is not this deploy key' : 'its signature does not match the key' };
    return b;
  })();
  if (!yields) {
    for (;;) {
      const r = steps.next();
      if (r.done) return r.value;
    }
  }
  return (async () => {
    for (;;) {
      const r = steps.next();
      if (r.done) return r.value;
      await breathe();
    }
  })();
}
function parsed(m) {
  if (!m || typeof m !== 'object') return { error: 'not a build' };
  const files = {};
  for (const [path, b64] of Object.entries(m.files || {})) {
    if (!goodPath(path) || typeof b64 !== 'string') return { error: `a file outside its folders: ${String(path).slice(0, 60)}` };
    files[path] = Buffer.from(b64, 'base64');
  }
  const dist = {};
  for (const [url, hash] of Object.entries(m.dist || {})) {
    if (!goodUrl(url) || !HASH_RE.test(hash)) return { error: 'a client file of no proper name' };
    dist[url] = hash;
  }
  return { api: m.api, epoch: m.epoch, client: { build: String(m.client?.build || ''), compat: String(m.client?.compat || ''), protocol: +m.client?.protocol || 0 }, deps: m.deps && typeof m.deps === 'object' ? m.deps : {}, files, dist };
}

// The messages a build's own client reads, from that build's shared/protocol.js (Writer, Reader, S2C, C2S, ROOMF,
// REJECT_REASON, writeBoard...): what the network thread writes to the players of a game an older build carries on
// (rooms.js Room proto). Loaded from the build in memory, not from disk. null when it cannot be used here: it imports
// another file of its build, it lacks any of what the thread uses (usable), or it does not load within ms (a module
// that never finishes loading).
export const PROTOCOL_LOAD_MS = 2000;
export async function protocolOf(files, ms = PROTOCOL_LOAD_MS) {
  const src = files?.['shared/protocol.js'];
  if (!src) return null;
  let timer;
  try {
    const late = new Promise((done) => (timer = setTimeout(() => done(null), ms)));
    const mod = await Promise.race([import(`data:text/javascript;base64,${src.toString('base64')}`), late]);
    return mod && usable(mod) ? mod : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
// (everything the network thread writes with: rooms.js greet, board, rejectBytes, shut)
const num = (v) => Number.isInteger(v) && v >= 0;
function usable(m) {
  try {
    if (typeof m.Writer !== 'function' || typeof m.Reader !== 'function' || typeof m.writeBoard !== 'function') return false;
    if (!m.S2C || !num(m.S2C.ROOM) || !num(m.S2C.BOARD) || !num(m.S2C.REJECT) || !m.C2S || !num(m.C2S.JOIN)) return false;
    if (!m.ROOMF || !num(m.ROOMF.INVITE_ONLY) || !m.REJECT_REASON || typeof m.REJECT_REASON !== 'object') return false;
    if (!Object.values(m.REJECT_REASON).every(num)) return false;
    if (m.ENDED_CODE !== undefined && !num(m.ENDED_CODE)) return false;
    if (m.MOVED_CODE !== undefined && !num(m.MOVED_CODE)) return false;
    const w = new m.Writer(16);
    w.u8(1);
    w.str('x');
    return typeof w.bytes === 'function' && w.bytes() instanceof Uint8Array;
  } catch {
    return false;
  }
}

// A folder and everything in it, a link never followed: a link (node_modules' to this server's packages, a junction
// on Windows) is taken away itself, what it points to left as it is
export function removeTree(path) {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) {
    try {
      unlinkSync(path);
    } catch {
      rmdirSync(path); // (a junction on Windows)
    }
    return;
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) removeTree(join(path, name));
    rmdirSync(path);
    return;
  }
  unlinkSync(path);
}
// A folder only this user can write: a folder (not a link), this user's, and nobody else's to write in. (Windows: its
// temp folder is the user's own already; owner and mode bits say nothing there)
function isPrivate(dir) {
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) return false;
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return true;
  return st.uid === process.getuid() && (st.mode & 0o077) === 0;
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};
// Whose an unpack folder is: stn-builds-<host>-<boot>-<pid>-<start>-XXXXXX. The host keeps servers of other machines
// (or containers: another hostname, another PID namespace) sharing a temp folder from sweeping each other's; the boot
// and the process's start tell a folder of a process that is gone from one of a live process of the same PID - a
// restarted container's PID 1, say. (boot: Linux's boot id; elsewhere none)
// (worked out the first time a build is unpacked, not as the server starts: asking the host's name costs a megabyte of
// memory on Windows)
const tag = (s) => String(s).replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || 'x';
let me = null;
function owner() {
  if (me) return me;
  let boot = 'x';
  try {
    boot = tag(readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()).slice(0, 12);
  } catch {}
  return (me = { host: tag(hostname()), boot, started: tag(Math.round(Date.now() - process.uptime() * 1000).toString(36)) });
}
const DIR_RE = /^stn-builds-([A-Za-z0-9]+)-([A-Za-z0-9]+)-(\d+)-([A-Za-z0-9]+)-/;
// (a folder of this user's left by a process that is gone: one of this host, of another boot, or of a process not
// running, or of this PID started at another time; the one folder all servers shared before this)
function leftBehind(name) {
  if (name === 'stn-builds') return true;
  const m = DIR_RE.exec(name);
  const { host, boot, started } = owner();
  if (!m || m[1] !== host) return false;
  if (m[2] !== boot) return true;
  if (+m[3] === process.pid) return m[4] !== started;
  return !alive(+m[3]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ABSENT = Symbol('not in the store'); // (_fetch: a build not there, which fetch does not remember)
const OPEN_KEEP_MS = 60_000; // a build opened from the store is kept this long for whichever asks next (know, fetch)
export const BUILD_WAIT_MS = 5000; // a build a save names that is not in the store yet is asked for again this long

export class Builds {
  // store: the handoff store (putBuild / getBuild / getAsset / touchBuild / sweepBuilds). root: this build's files.
  // client: what this build's client is ({ build, compat, protocol }), dist: its files (index.js's). key:
  // HANDOFF_BUILD_KEY ('' for none). unsigned: builds without a signature may be started (HANDOFF_PIN=unsigned)
  // tmp: where this process makes its own folder to unpack builds in (stn-builds-<host>-<boot>-<pid>-<start>-XXXXXX:
  // made fresh, mode 0700, taken away when the process exits; those of processes that are gone are swept when it is
  // made). waitMs: how long a build a save names is waited for when it is not in the store yet (BUILD_WAIT_MS: the old
  // server may still be putting it there - its handover waits for that 2 s at most). protocolMs: PROTOCOL_LOAD_MS
  constructor({ store, root, client, dist = new Map(), key = '', unsigned = false, log = () => {}, tmp = tmpdir(), waitMs = BUILD_WAIT_MS, protocolMs = PROTOCOL_LOAD_MS }) {
    this.store = store;
    this.root = root;
    this.client = client;
    this.dist = dist;
    this.key = key;
    this.unsigned = unsigned;
    this.log = log;
    this.tmpBase = tmp;
    this.waitMs = waitMs;
    this.protocolMs = protocolMs;
    this.opens = new Map(); // id -> { p, at }: the build being read from the store and opened, or opened lately (openOnce)
    this.dir = null; // (this process's own folder for unpacked builds: privateDir)
    this.id = ''; // this build's own ('' until packed: nothing can name it yet)
    this.packed = null;
    this.packing = null;
    this.kept = null;
    this.swept = false;
    this.deps = null;
    this.got = new Map(); // id -> { id, dir, client, dist: { url: hash } } | null: the builds fetched (fetch; null: refused here)
    this.fetching = new Map();
    this.knowing = new Map(); // id -> the store being asked for a build's client files (know), once at a time
    this.keepTimer = null;
    this.cache = new Map(); // hash -> Buffer: old builds' client files, the last asked for kept (asset)
    this.cacheBytes = 0;
  }
  // can a build be started here at all
  get canStart() {
    return !!this.key || this.unsigned;
  }

  // Packs this build and puts it in the store for the servers after it, and sweeps the builds nobody uses. Not as the
  // server starts (index.js: a moment after it listens), and never twice. Never throws.
  async pack() {
    await this.keep();
    if (this.packed && !this.swept) {
      this.swept = true;
      const n = await this.store.sweepBuilds(BUILD_KEEP_DAYS * 86400).catch(() => 0);
      if (n) this.log(`handoff: ${n} build(s) nobody used for ${BUILD_KEEP_DAYS} days dropped from the store`);
      // (a server that runs for days without a deploy: its build is marked as in use twice a day, so the next server's
      // sweep does not take it while its games still name it)
      this.keepTimer ||= setInterval(() => this.ensure(), KEEP_EVERY_MS);
      this.keepTimer.unref?.();
    }
  }
  // This build in the store as it goes down (Lobby.handoffAll), or twice a day: marked as in use, and put back if it is
  // not there any more (swept by another server). Never throws.
  // (packed again from disk: if its files changed since the server started, that is another build - not the code its
  // games run - and it is not put there in this one's name: this one stays what its saves name, missing from the store)
  async ensure() {
    await this.keep();
    if (!this.id || !this.kept) return;
    const there = await this.store.touchBuild(this.id).catch(() => true);
    if (there !== false) return;
    const was = this.packed;
    const id = this.id;
    this.packing = null;
    this.packed = null;
    await this.packOnce();
    if (this.id !== id) {
      this.log(`handoff: build ${id} was not in the store any more, and cannot be put back: this server's files changed since it started (they are build ${this.id || 'none'} now). Its games' saves still name ${id}`);
      this.id = id;
      this.packed = was;
      this.packing = Promise.resolve();
      return;
    }
    this.log(`handoff: build ${this.id} was not in the store any more: put back`);
    this.kept = null;
    await this.keep();
  }
  // This build packed: its name (id) known from then on - the saves of its games carry it. Once; never throws.
  packOnce() {
    return (this.packing ||= (async () => {
      try {
        const t0 = Date.now();
        const b = await packBuildAsync(this.root, { client: this.client, dist: this.dist, key: this.key });
        if (!b) return void this.log('handoff: this build is too big to keep for the next server (is anything but code in server/ and shared/?)');
        this.id = b.id;
        this.packed = b;
        this.log(`handoff: this build is ${b.id} (${b.files} files of code, ${b.assets.size} client files; ${(b.body.length / 1024).toFixed(0)} KB packed in ${Date.now() - t0} ms${b.sig ? ', signed' : ', not signed: HANDOFF_BUILD_KEY is not set'})`);
      } catch (err) {
        this.log(`handoff: this build could not be packed for the next server (${err.message})`);
      }
    })());
  }
  // This build in the store, packed first if it is not yet (a server told to stop before it got to it: Lobby.handoffAll
  // waits for this before its games are saved) - once. Never throws.
  async keep() {
    await this.packOnce();
    if (!this.packed) return;
    const b = this.packed;
    if (!this.kept) {
      const p = this.store
        .putBuild(b.id, b.body, b.sig, b.assets)
        // (in the store: what was put there is not needed here again - only its name)
        .then(() => ((this.packed = { id: b.id, sig: b.sig }), this.log(`handoff: build ${b.id} is in the store`)))
        .catch((err) => (this.kept === p && (this.kept = null), this.log(`handoff: this build could not be kept in the store (${err.message})`)));
      this.kept = p;
    }
    return this.kept;
  }
  // a build a game here runs on (pinned) is in use: marked so, so it is not swept while that game lasts
  touch(id) {
    if (ID_RE.test(String(id))) this.store.touchBuild(id).catch(() => {});
  }

  // The build `id`, unpacked where a worker can be started from it: { id, dir, client, dist, files }, or null (logged
  // why). What it is (refused: not signed, of another worker API...) is remembered; a build not in the store is waited
  // for a few seconds (waitMs: the server that saved its game may still be putting it there) and not remembered as
  // missing, nor is a store that failed, or an unpacking that did: tried again the next time.
  fetch(id) {
    if (!ID_RE.test(String(id))) return Promise.resolve(null);
    const had = this.got.get(id);
    if (had && !had.filesOnly) return this.verified(had);
    if (this.got.has(id) && !had) return Promise.resolve(null);
    let p = this.fetching.get(id);
    if (!p) {
      p = this._fetch(id)
        .then(
          (b) => (b === ABSENT ? null : (this.got.set(id, b), b)),
          (err) => (this.log(`handoff: build ${id} could not be fetched (${err.message})`), null)
        )
        .finally(() => this.fetching.delete(id));
      this.fetching.set(id, p);
    }
    return p;
  }
  why(id, text) {
    this.log(`handoff: build ${id} is not started here: ${text}`);
    return null;
  }
  // The build `id` read from the store and opened (checked: its name, its signature): the build, { error } (refused),
  // or null (not in the store). Once at a time for an id, and a build opened is kept a minute for whichever asks next -
  // know and fetch both want it as a deploy brings its games back. A store that fails throws.
  openOnce(id) {
    const had = this.opens.get(id);
    if (had && (!had.at || Date.now() - had.at < OPEN_KEEP_MS)) return had.p;
    const entry = { p: null, at: 0 };
    entry.p = (async () => {
      const row = await this.store.getBuild(id);
      return row ? openBuildAsync(id, row.body, row.sig, { key: this.key, requireSig: !this.unsigned }) : null;
    })().then(
      (b) => {
        if (b && !b.error) {
          entry.at = Date.now();
          setTimeout(() => this.opens.get(id) === entry && this.opens.delete(id), OPEN_KEEP_MS).unref?.();
        } else if (this.opens.get(id) === entry) this.opens.delete(id);
        return b;
      },
      (err) => {
        if (this.opens.get(id) === entry) this.opens.delete(id);
        throw err;
      }
    );
    this.opens.set(id, entry);
    return entry.p;
  }
  async _fetch(id) {
    if (!this.canStart) return this.why(id, 'HANDOFF_BUILD_KEY is not set, so nothing from the store is trusted to run here');
    let b = await this.openOnce(id);
    for (const until = Date.now() + this.waitMs; b === null && Date.now() < until; ) {
      await sleep(Math.min(250, Math.max(10, until - Date.now())));
      b = await this.openOnce(id);
    }
    if (b === null) {
      this.why(id, `it is not in the store (asked for ${this.waitMs / 1000} s)`);
      return ABSENT; // (not remembered: it may be there the next time)
    }
    if (b.error) return this.why(id, b.error);
    if (b.api !== WORKER_API) return this.why(id, `it speaks worker API ${b.api} (this server: ${WORKER_API})`);
    if (!(b.epoch >= SECURITY_EPOCH)) return this.why(id, `it is from before a security fix (epoch ${b.epoch}; this server: ${SECURITY_EPOCH})`);
    this.deps ||= workerDeps(this.root);
    for (const name of new Set([...Object.keys(b.deps), ...Object.keys(this.deps)])) {
      if (b.deps[name] !== this.deps[name] && name in b.deps) return this.why(id, `its game code uses ${name} ${b.deps[name]}, and this server has ${this.deps[name] || 'none'}`);
    }
    if (!b.files['server/room-worker.js']) return this.why(id, 'it has no game worker');
    const got = { id, dir: join(this.privateDir(), id), client: b.client, dist: b.dist, files: b.files, deps: Object.keys(b.deps).length > 0 };
    const ok = await this.verified(got);
    if (!ok) throw new Error('it could not be unpacked'); // (not remembered: tried again)
    return ok;
  }
  // This process's own folder for unpacked builds (see the constructor). Throws when it cannot be made private.
  privateDir() {
    if (this.dir) return this.dir;
    mkdirSync(this.tmpBase, { recursive: true });
    // (the folders of processes that are gone, this user's: a crash leaves its builds behind; and the one folder all
    // servers shared before)
    for (const name of readdirSync(this.tmpBase)) {
      if (!leftBehind(name)) continue;
      try {
        const full = join(this.tmpBase, name);
        if (isPrivate(full)) removeTree(full);
      } catch {}
    }
    const { host, boot, started } = owner();
    const dir = mkdtempSync(join(this.tmpBase, `stn-builds-${host}-${boot}-${process.pid}-${started}-`));
    if (!isPrivate(dir)) throw new Error(`${dir} is not this server's alone (its owner or mode): nothing is unpacked there`);
    process.once('exit', () => {
      try {
        removeTree(dir);
      } catch {}
    });
    return (this.dir = dir);
  }
  // The build on disk, as it is: every file the same as the build that was checked, nothing else there, no link but the
  // one to this server's node_modules, in this process's own folder. A copy that is not (a crash halfway) is written
  // again. Checked each time a worker is to be started from it (Lobby.afterFailed starts it at once). -> got, or null
  // (written in place: the folder is this process's own, so nobody else sees it half written, and a copy left half
  // written by a crash is not believed - sameOnDisk. Windows may hold a file just written for a moment - its indexer,
  // its virus scan - so taking the old copy away is tried a few times)
  async verified(got) {
    try {
      if (!isPrivate(dirname(got.dir))) throw new Error(`${dirname(got.dir)} is not this server's alone`);
      if (!this.sameOnDisk(got)) {
        for (let i = 0; ; i++) {
          try {
            removeTree(got.dir);
            break;
          } catch (err) {
            if (i >= 20 || !['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(err.code)) throw err;
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        mkdirSync(got.dir, { mode: 0o700 });
        for (const [path, buf] of Object.entries(got.files)) {
          mkdirSync(dirname(join(got.dir, path)), { recursive: true, mode: 0o700 });
          writeFileSync(join(got.dir, path), buf, { mode: 0o600, flag: 'wx' });
        }
        writeFileSync(join(got.dir, 'package.json'), '{ "type": "module" }\n', { mode: 0o600, flag: 'wx' });
        // (its packages are this server's, checked to be the same versions: found from its folder through a link)
        if (got.deps) symlinkSync(join(this.root, 'node_modules'), join(got.dir, 'node_modules'), 'junction');
        if (!this.sameOnDisk(got)) throw new Error('what was written is not what was checked');
      }
      return got;
    } catch (err) {
      this.log(`handoff: build ${got.id} could not be unpacked (${err.message})`);
      return null;
    }
  }
  sameOnDisk(got) {
    const want = new Set(Object.keys(got.files));
    let ok = true;
    let modules = false;
    const walk = (rel) => {
      for (const name of readdirSync(join(got.dir, rel))) {
        const path = rel ? `${rel}/${name}` : name;
        const full = join(got.dir, path);
        const st = lstatSync(full);
        if (!rel && name === 'node_modules') {
          // (the link to this server's packages, and only that, and only for a build whose code imports any)
          modules = true;
          if (!got.deps || !st.isSymbolicLink() || realpathSync(full) !== realpathSync(join(this.root, 'node_modules'))) ok = false;
        } else if (st.isSymbolicLink()) ok = false;
        else if (!rel && name === 'package.json') ok &&= st.isFile() && readFileSync(full, 'utf8') === '{ "type": "module" }\n';
        else if (st.isDirectory()) walk(path);
        else if (!st.isFile() || !want.delete(path) || !readFileSync(full).equals(got.files[path])) ok = false;
        if (!ok) return;
      }
    };
    try {
      const top = lstatSync(got.dir);
      if (!top.isDirectory() || top.isSymbolicLink() || !existsSync(join(got.dir, 'package.json'))) return false;
      walk('');
    } catch {
      return false;
    }
    if (!this.dir || relative(this.dir, got.dir).includes('..')) return false;
    return ok && !want.size && modules === !!got.deps;
  }
  // The messages the players of a game build `got` carries on read (protocolOf), loaded once
  protocol(got) {
    return (got.proto ||= protocolOf(got.files, this.protocolMs));
  }

  // Learns a build's client files without starting anything (a save named a build this server does not run: a page of
  // that client may still ask for its files, which this build does not have). Files served from here are script on this
  // site, so they are held to the same signature as code started here.
  // (once at a time for a build, however many of its games come back at once; opened off the event loop. Nothing is
  // asked of the store without the key - or HANDOFF_PIN=unsigned: nothing from it could be served)
  know(id) {
    if (!this.canStart || !ID_RE.test(String(id)) || id === this.id || this.got.get(id)) return Promise.resolve();
    let p = this.knowing.get(id);
    if (!p) {
      p = (async () => {
        try {
          const b = await this.openOnce(id);
          if (b && !b.error && !this.got.get(id)) this.got.set(id, { id, dir: '', client: b.client, dist: b.dist, files: null, filesOnly: true });
        } catch {}
      })().finally(() => this.knowing.delete(id));
      this.knowing.set(id, p);
    }
    return p;
  }
  // A file of an older build's client by its address ('/assets/index-abc.js', named by its content: whichever build has
  // it), or of build `id` only (its page, '/index.html'), from the store, checked against its hash; or null
  async asset(url, id = '') {
    for (const b of id ? [this.got.get(id)] : this.got.values()) {
      const hash = b?.dist[url];
      if (!hash) continue;
      let body = this.cache.get(hash);
      if (!body) {
        const got = await this.store.getAsset(hash).catch(() => null);
        if (!got || sha256(got) !== hash) continue;
        body = got;
        this.cache.set(hash, body);
        this.cacheBytes += body.length;
        for (const [h, buf] of this.cache) {
          if (this.cacheBytes <= ASSET_CACHE_BYTES) break;
          this.cache.delete(h);
          this.cacheBytes -= buf.length;
        }
      }
      return body;
    }
    return null;
  }
  has(url) {
    for (const b of this.got.values()) if (b?.dist[url]) return true;
    return false;
  }
}
