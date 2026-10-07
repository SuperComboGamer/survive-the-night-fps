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
//   - it is what its name says: the name is a hash of every file in it (checked on every fetch, and the copy unpacked on
//     disk is checked against it every time it is used)
//   - it speaks this server's WORKER_API: what the network thread and a game's worker say to each other
//   - it is not from before a security fix: SECURITY_EPOCH is bumped by a change that must reach every game at once,
//     and a build of a lower epoch is not started - its games end at that deploy, saying an update ended them
//   - the packages its game code imports (node_modules) are the versions installed here: an older build's code runs
//     against this server's node_modules, so a dependency it uses that changed would be other code under it
// A game carried on this way is kept to it for HANDOFF_PIN_MAX_HOURS at most (Room.pinCap): at the first dawn after
// that, or when its run ends, it closes and its players are told why.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync, gzip } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

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
export const buildId = (b) => idOf(b); // (the tests make builds of their own)
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const gzipAsync = promisify(gzip);

// the build's name: a hash of everything that makes it what it is
function idOf({ api, epoch, client, deps, files, dist }) {
  const h = createHash('sha256').update(`stn-build api ${api} epoch ${epoch}\nclient ${client.build} ${client.compat} ${client.protocol}\n`);
  for (const [name, v] of Object.entries(deps).sort()) h.update(`dep ${name} ${v}\n`);
  for (const path of Object.keys(files).sort()) h.update(`file ${path} ${sha256(files[path])}\n`);
  for (const url of Object.keys(dist).sort()) h.update(`dist ${url} ${dist[url]}\n`);
  return h.digest('hex').slice(0, 24);
}
export const signOf = (id, key) => createHmac('sha256', key).update(`stn-build ${id}`).digest('hex');
function signedBy(id, sig, key) {
  if (typeof sig !== 'string' || !HASH_RE.test(sig)) return false;
  return timingSafeEqual(Buffer.from(signOf(id, key), 'hex'), Buffer.from(sig, 'hex'));
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
// (the code's files: every file under server/ and shared/, by its path from the root)
function codePaths(root) {
  const paths = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path);
      else if (goodPath(path)) paths.push(path);
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
    const id = idOf(b);
    const packed = {};
    for (const [path, buf] of Object.entries(files)) packed[path] = buf.toString('base64');
    const done = (body) => ({ id, sig: key ? signOf(id, key) : '', bytes, files: Object.keys(files).length, assets, body });
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

// ...and back: the build `id` names, or why not ({ error }). Its name is checked against its contents; its signature
// against the key (key: '' with requireSig false: not checked).
export function openBuild(id, body, sig, { key = '', requireSig = true } = {}) {
  if (!ID_RE.test(String(id))) return { error: 'not a build name' };
  if (requireSig && !key) return { error: 'no key to check its signature with (HANDOFF_BUILD_KEY)' };
  if (key && !signedBy(id, sig, key)) return { error: requireSig ? 'its signature is not this deploy key' : 'its signature does not match the key' };
  let m;
  try {
    m = JSON.parse(gunzipSync(body).toString('utf8'));
  } catch {
    return { error: 'not a build' };
  }
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
  const b = { api: m.api, epoch: m.epoch, client: { build: String(m.client?.build || ''), compat: String(m.client?.compat || ''), protocol: +m.client?.protocol || 0 }, deps: m.deps && typeof m.deps === 'object' ? m.deps : {}, files, dist };
  if (idOf(b) !== id) return { error: 'it is not what its name says' };
  return b;
}

export class Builds {
  // store: the handoff store (putBuild / getBuild / getAsset / touchBuild / sweepBuilds). root: this build's files.
  // client: what this build's client is ({ build, compat, protocol }), dist: its files (index.js's). key:
  // HANDOFF_BUILD_KEY ('' for none). unsigned: builds without a signature may be started (HANDOFF_PIN=unsigned)
  constructor({ store, root, client, dist = new Map(), key = '', unsigned = false, log = () => {}, tmp = join(tmpdir(), 'stn-builds') }) {
    this.store = store;
    this.root = root;
    this.client = client;
    this.dist = dist;
    this.key = key;
    this.unsigned = unsigned;
    this.log = log;
    this.tmp = tmp;
    this.id = ''; // this build's own ('' until packed: nothing can name it yet)
    this.packed = null;
    this.packing = null;
    this.kept = null;
    this.swept = false;
    this.deps = null;
    this.got = new Map(); // id -> { id, dir, client, dist: { url: hash } } | null: the builds fetched (fetch)
    this.fetching = new Map();
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
    }
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
    return (this.kept ||= this.store
      .putBuild(b.id, b.body, b.sig, b.assets)
      // (in the store: what was put there is not needed here again - only its name)
      .then(() => ((this.packed = { id: b.id, sig: b.sig }), this.log(`handoff: build ${b.id} is in the store`)))
      .catch((err) => ((this.kept = null), this.log(`handoff: this build could not be kept in the store (${err.message})`))));
  }
  // a build a game here runs on (pinned) is in use: marked so, so it is not swept while that game lasts
  touch(id) {
    if (ID_RE.test(String(id))) this.store.touchBuild(id).catch(() => {});
  }

  // The build `id`, unpacked where a worker can be started from it: { id, dir, client, dist }, or null (logged why)
  fetch(id) {
    if (!ID_RE.test(String(id))) return Promise.resolve(null);
    const had = this.got.get(id);
    if (had && !had.filesOnly) return this.verified(had);
    if (this.got.has(id) && !had) return Promise.resolve(null);
    let p = this.fetching.get(id);
    if (!p) {
      p = this._fetch(id)
        .catch((err) => (this.log(`handoff: build ${id} could not be fetched (${err.message})`), null))
        .then((b) => (this.got.set(id, b), this.fetching.delete(id), b));
      this.fetching.set(id, p);
    }
    return p;
  }
  why(id, text) {
    this.log(`handoff: build ${id} is not started here: ${text}`);
    return null;
  }
  async _fetch(id) {
    if (!this.canStart) return this.why(id, 'HANDOFF_BUILD_KEY is not set, so nothing from the store is trusted to run here');
    const row = await this.store.getBuild(id);
    if (!row) return this.why(id, 'it is not in the store');
    const b = openBuild(id, row.body, row.sig, { key: this.key, requireSig: !this.unsigned });
    if (b.error) return this.why(id, b.error);
    if (b.api !== WORKER_API) return this.why(id, `it speaks worker API ${b.api} (this server: ${WORKER_API})`);
    if (!(b.epoch >= SECURITY_EPOCH)) return this.why(id, `it is from before a security fix (epoch ${b.epoch}; this server: ${SECURITY_EPOCH})`);
    this.deps ||= workerDeps(this.root);
    for (const name of new Set([...Object.keys(b.deps), ...Object.keys(this.deps)])) {
      if (b.deps[name] !== this.deps[name] && name in b.deps) return this.why(id, `its game code uses ${name} ${b.deps[name]}, and this server has ${this.deps[name] || 'none'}`);
    }
    if (!b.files['server/room-worker.js']) return this.why(id, 'it has no game worker');
    const got = { id, dir: join(this.tmp, id), client: b.client, dist: b.dist, files: b.files, deps: Object.keys(b.deps).length > 0 };
    return this.verified(got);
  }
  // The build on disk, as it is: every file the same as the build that was checked, nothing else there. A copy that is
  // not (a crash halfway, anyone else who can write the temp folder) is written again. -> got, or null
  async verified(got) {
    try {
      if (!this.sameOnDisk(got)) {
        const part = `${got.dir}.${process.pid}.${Date.now()}.part`;
        rmSync(part, { recursive: true, force: true });
        mkdirSync(part, { recursive: true, mode: 0o700 });
        for (const [path, buf] of Object.entries(got.files)) {
          mkdirSync(dirname(join(part, path)), { recursive: true, mode: 0o700 });
          writeFileSync(join(part, path), buf, { mode: 0o600 });
        }
        writeFileSync(join(part, 'package.json'), '{ "type": "module" }\n', { mode: 0o600 });
        // (its packages are this server's, checked to be the same versions: found from its folder through a link)
        if (got.deps) symlinkSync(join(this.root, 'node_modules'), join(part, 'node_modules'), 'junction');
        rmSync(got.dir, { recursive: true, force: true });
        renameSync(part, got.dir);
        if (!this.sameOnDisk(got)) throw new Error('what was written is not what was checked');
      }
      return got;
    } catch (err) {
      this.log(`handoff: build ${got.id} could not be unpacked (${err.message})`);
      return null;
    }
  }
  sameOnDisk(got) {
    if (!existsSync(join(got.dir, 'package.json'))) return false;
    const want = new Set(Object.keys(got.files));
    let ok = true;
    const walk = (rel) => {
      for (const name of readdirSync(join(got.dir, rel))) {
        const path = rel ? `${rel}/${name}` : name;
        if (!rel && (name === 'package.json' || name === 'node_modules')) continue;
        const full = join(got.dir, path);
        if (statSync(full).isDirectory()) walk(path);
        else if (!want.delete(path) || !readFileSync(full).equals(got.files[path])) ok = false;
      }
    };
    try {
      walk('');
    } catch {
      return false;
    }
    if (relative(this.tmp, got.dir).includes(`..${sep}`)) return false;
    return ok && !want.size && readFileSync(join(got.dir, 'package.json'), 'utf8') === '{ "type": "module" }\n';
  }

  // Learns a build's client files without starting anything (a save named a build this server does not run: a page of
  // that client may still ask for its files, which this build does not have). Files served from here are script on this
  // site, so they are held to the same signature as code started here.
  async know(id) {
    if (!this.canStart || !ID_RE.test(String(id)) || id === this.id || this.got.get(id)) return;
    try {
      const row = await this.store.getBuild(id);
      const b = row && openBuild(id, row.body, row.sig, { key: this.key, requireSig: !this.unsigned });
      if (b && !b.error && !this.got.get(id)) this.got.set(id, { id, dir: '', client: b.client, dist: b.dist, files: null, filesOnly: true });
    } catch {}
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
