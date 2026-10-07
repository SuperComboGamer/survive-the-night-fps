// Deploys without ending the games: the old server saves every game being played when Railway tells it to stop
// (SIGTERM), and the new one, already up, brings each back under the same code. Players are dropped for a moment
// (close code HANDOFF_CLOSE, "Server updating"), reconnect on their own (client/main.js rejoin) and are given back
// their own body, which waited for them where it was (Game.hold / resume).
//
// This file holds what the two servers have to agree on - the shape of a save and the checks that it still means
// the same to this build - and the store a save waits in between them:
//   Postgres (production): one row per game in game_handoff (migration 008), a NOTIFY when one is written, so the
//     new server restores it at once. A server only ever claims a row (DELETE ... RETURNING): one of them gets it.
//   files (development, the tests, a server without Postgres): one file per game in HANDOFF_DIR, claimed by a rename.
// What a game saves, and how it is put back, is server/gamestate.js (Game.save / Game.load).
//
// STATE_VERSION: bump it when a saved field is renamed or removed, or changes meaning or units. A field that is only
// added needs no bump, as long as loading a save without it leaves the default (every entity is restored by building
// a fresh one and copying what was saved over it). A save whose version differs is dropped: that game ends as before.
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { ITEM, ZTYPE, STRUCT, CONT, ZONE, AMMO, PROJ, AREA, KILLER } from '../shared/defs.js';
import { PHASE } from '../shared/constants.js';
import { ENT, PROTOCOL_VERSION, MOVED_CODE } from '../shared/protocol.js';
import { DEAD_S } from './cluster.js';

export const FORMAT = 1; // the envelope's own shape
export const STATE_VERSION = +(process.env.HANDOFF_STATE_VERSION || 1); // (the env: the tests' mismatching build)
export const HANDOFF_CLOSE = MOVED_CODE; // the close code a socket gets when its game moves to the next server
export const BUILD = process.env.RAILWAY_GIT_COMMIT_SHA || '';

// ---------------------------------------------------------------- the codec
// JSON, but Infinity survives it (an item that never despawns) and typed arrays come out as arrays
const INF = '\u0000Infinity';
const NINF = '\u0000-Infinity';
const replacer = (key, v) => {
  if (typeof v === 'number') return v === Infinity ? INF : v === -Infinity ? NINF : Number.isNaN(v) ? null : v;
  if (ArrayBuffer.isView(v)) return Array.from(v, (x) => (x === Infinity ? INF : x === -Infinity ? NINF : x));
  return v;
};
const reviver = (key, v) => (v === INF ? Infinity : v === NINF ? -Infinity : v);
export const encode = (obj) => gzipSync(JSON.stringify(obj, replacer));
export const decode = (buf) => JSON.parse(gunzipSync(buf).toString('utf8'), reviver);

// ---------------------------------------------------------------- what a save's numbers mean
// Items, zombie types, structures... are saved as numbers into tables that a later build may renumber. Every name ->
// number pair the save was made with has to mean the same here: a new entry appended is fine, one renumbered or gone
// is not (a saved shotgun would come back as something else).
const ENUMS = { ITEM, ZTYPE, STRUCT, CONT, ZONE, AMMO, PROJ, AREA, KILLER, PHASE, ENT };
export function enums() {
  const out = {};
  for (const [name, table] of Object.entries(ENUMS)) out[name] = { ...table };
  return out;
}
// the first pair that no longer holds ('ITEM.SHOTGUN 12 -> 13'), or '' when they all do
export function enumMismatch(saved) {
  for (const [name, table] of Object.entries(saved || {})) {
    const now = ENUMS[name];
    if (!now) return `${name}: gone`;
    for (const [key, v] of Object.entries(table)) if (now[key] !== v) return `${name}.${key} ${v} -> ${now[key]}`;
  }
  return '';
}

// Two fingerprints of what world generation made of a seed, taken as the world is made (Game.setWorld), before
// anything is felled; about 5 ms.
//   shape: what a save points into by position or index - the colliders (to the centimetre), the loot and resource
//     spots, the containers (where, and of what kind), the supply spots, the spawn points, the places. A save made on
//     a valley whose shape this build makes differently is not restored: its positions could be inside a wall now,
//     its indices name other spots.
//   hash: all of that and the place each spot is filed under (its zone). A save does not point into those: a searched
//     or unsearched container is saved with its own zone, a hidden schematic or supply with the place it is rumoured
//     in, and a loot spot only rolls its next find from its zone's table. A build that files a spot under another
//     place (as when the stalled train's toolbox stopped counting as Whitlock Depot) makes the same ground, so a game
//     is carried over it. This is the fingerprint builds from before `shape` wrote (envelope.worldHash) and the only
//     one they read, so it is still written, and still what a save without a shape is checked against.
//   ground: the lie of the land - the terrain's height on a grid of 33 x 33 points across the map, to the centimetre. A
//     build that only raised or lowered the ground would make the same shape, and a save's positions would be in the
//     hills or over them. Saves carry it from this build on (worldGround); one from before is not checked against it.
export function worldPrint(world) {
  let hash = 0x811c9dc5;
  let shape = 0x811c9dc5;
  let ground = 0x811c9dc5;
  // label: a spot's zone, which only `hash` takes in
  const mix = (v, label = false) => {
    v = Math.round(v * 100) | 0;
    for (let i = 0; i < 4; i++) {
      const b = (v >>> (i * 8)) & 0xff;
      hash = Math.imul(hash ^ b, 0x01000193);
      if (!label) shape = Math.imul(shape ^ b, 0x01000193);
    }
  };
  const seen = new Set();
  for (const cell of world.staticGrid.cells) {
    for (const c of cell) {
      if (seen.has(c)) continue;
      seen.add(c);
      for (const v of [c.x, c.z, c.y0, c.y1, c.hx, c.hz, c.flags]) mix(v);
    }
  }
  mix(seen.size);
  for (const list of [world.lootSpawns, world.resourceSpawns, world.containers, world.partSpots, world.spawnPoints]) {
    mix(list.length);
    for (const p of list) {
      mix(p.x);
      mix(p.y ?? 0);
      mix(p.z);
      mix(p.zone ?? 0, true);
      mix(p.ctype ?? 0);
    }
  }
  for (const z of world.zones) for (const v of [z.id, z.x, z.z]) mix(v);
  for (const v of [world.mine ? 1 : 0, world.rail ? world.rail.main.n : 0, world.fair ? 1 : 0]) mix(v);
  const half = world.half || 0;
  for (let j = 0; j <= 32; j++) {
    for (let i = 0; i <= 32; i++) {
      const v = Math.round(world.heightAt(-half + (i * 2 * half) / 32, -half + (j * 2 * half) / 32) * 100) | 0;
      for (let k = 0; k < 4; k++) ground = Math.imul(ground ^ ((v >>> (k * 8)) & 0xff), 0x01000193);
    }
  }
  return { hash: (hash >>> 0).toString(16), shape: (shape >>> 0).toString(16), ground: (ground >>> 0).toString(16) };
}
export const worldHash = (world) => worldPrint(world).hash;

// Why a save cannot be used here (the Game constructor given one throws it): the save is dropped, and the game it
// held ends as it would have without any of this. world: because this build makes another valley of its seed (what
// its players are then told: REJECT_REASON.ENDED_MAP).
export class HandoffError extends Error {
  constructor(message, { world = false } = {}) {
    super(message);
    this.world = world;
  }
}
// Whether a save's valley is the one this build made of its seed (prints: worldPrint of it). A save from before
// `worldShape` has only the stricter fingerprint to go by.
// (a save's ground is checked when it carries one: builds from before it did not write it)
export const sameWorld = (env, prints) => (typeof env.worldShape === 'string' ? env.worldShape === prints.shape : env.worldHash === prints.hash) && (typeof env.worldGround !== 'string' || env.worldGround === prints.ground);

// The envelope round a game's save: what is checked before any of it is believed (checkEnvelope)
export function envelope(game) {
  return { format: FORMAT, stateVersion: STATE_VERSION, protocol: PROTOCOL_VERSION, build: BUILD, savedAt: Date.now(), enums: enums(), worldHash: game.worldHash, worldShape: game.worldShape, worldGround: game.worldGround, game: game.save() };
}
export function checkEnvelope(env) {
  if (!env || env.format !== FORMAT) throw new HandoffError(`envelope format ${env?.format} (this build reads ${FORMAT})`);
  if (env.stateVersion !== STATE_VERSION) throw new HandoffError(`state version ${env.stateVersion} (this build reads ${STATE_VERSION})`);
  const bad = enumMismatch(env.enums);
  if (bad) throw new HandoffError(`renumbered since the save: ${bad}`);
}

// ---------------------------------------------------------------- the store
// Both stores have one face:
//   put(code, meta, body)  the game `code` saved: meta is the room's (rooms.js), body the gzipped envelope. Upserts.
//   claim(code, me)        -> { meta, body, savedAt }, gone from the store, or null (none, taken already, or saved for
//                             another server than `me`, behind the proxy: PgStore only)
//   pending()              -> the codes waiting
//   listen(fn)             fn(code) whenever a save is put (by any server, this one too)
//   sweep(maxAgeS)         drops saves older than that: nobody came for them
//   close()
// ...and the word between the two servers before the saves are made, so the next one can build each game's valley
// while the last one is still playing it (Lobby.announce / prepare):
//   announceAndWait(list, ms)  list: [{ code, info: { seed, act, shape, target } }], the games about to be saved ->
//                          the Set of codes the next server said it is ready for, within ms
//   listenComing(fn)       fn(code, info) for each game a server going down announces (that server hears its own too)
//   ready(code)            this server has built the valley of `code` and is waiting for its save
// ...and the builds that games are carried on by when the next build cannot read their save (builds.js):
//   putBuild(id, body, sig, assets)  the build `id` (gzipped), its signature, and its client's files (Map hash -> bytes):
//                          kept (written over whatever is there under that name), and marked as in use
//   getBuild(id)           -> { body, sig }, or null; marks it (and its files) as in use
//   touchBuild(id)         marks it as in use
//   getAsset(hash)         -> a client file, or null
//   sweepBuilds(maxAgeS)   drops the builds nobody has used in that long, and the files no build kept names
const COMING_RE = /^([A-Z2-9]+)\.coming$/;
const BUILD_FILE_RE = /^([0-9a-f]{24})\.json$/;
const HASH_RE = /^[0-9a-f]{64}$/;
// (a file's, read through a small buffer: a server checking the client files it keeps does not hold them all at once)
const fileHash = (file) =>
  new Promise((done, fail) => {
    const h = createHash('sha256');
    createReadStream(file).on('error', fail).on('data', (d) => h.update(d)).on('end', () => done(h.digest('hex')));
  });

// Files in a folder: CODE.json, written as CODE.json.tmp and renamed (there whole or not at all). Claimed by renaming
// it to a name of this process's: of two servers claiming at once, one rename fails. A game announced is CODE.coming,
// and the next server's answer CODE.ready.
export class FileStore {
  constructor(dir, { pollMs = 500, comingMs = 100 } = {}) {
    this.dir = dir;
    this.pollMs = pollMs;
    this.comingMs = comingMs;
    this.timer = null;
    this.comingTimer = null;
    mkdirSync(dir, { recursive: true });
  }
  async announceAndWait(list, ms) {
    const file = (code, ext) => join(this.dir, `${code}.${ext}`);
    for (const { code, info } of list) {
      try {
        unlinkSync(file(code, 'ready'));
      } catch {}
      writeFileSync(file(code, 'coming.tmp'), JSON.stringify(info));
      renameSync(file(code, 'coming.tmp'), file(code, 'coming'));
    }
    const got = new Set();
    for (const until = Date.now() + ms; got.size < list.length && Date.now() < until; await new Promise((r) => setTimeout(r, 25))) {
      for (const { code } of list) if (!got.has(code) && existsSync(file(code, 'ready'))) got.add(code);
    }
    for (const { code } of list) {
      for (const ext of ['coming', 'ready']) {
        try {
          unlinkSync(file(code, ext));
        } catch {}
      }
    }
    return got;
  }
  listenComing(fn) {
    const seen = new Map(); // code -> the announcement's mtime: each heard once
    this.comingTimer = setInterval(() => {
      let names;
      try {
        names = readdirSync(this.dir);
      } catch {
        return;
      }
      for (const name of names) {
        const code = COMING_RE.exec(name)?.[1];
        if (!code) continue;
        try {
          const full = join(this.dir, name);
          const t = statSync(full).mtimeMs;
          if (seen.get(code) === t) continue;
          seen.set(code, t);
          fn(code, JSON.parse(readFileSync(full, 'utf8')));
        } catch {}
      }
      if (seen.size > 1000) seen.clear();
    }, this.comingMs);
    this.comingTimer.unref?.();
  }
  async ready(code) {
    writeFileSync(join(this.dir, `${code}.ready`), '1');
  }
  async put(code, meta, body) {
    const file = join(this.dir, `${code}.json`);
    writeFileSync(file + '.tmp', JSON.stringify({ meta, savedAt: Date.now(), body: Buffer.from(body).toString('base64') }));
    renameSync(file + '.tmp', file);
  }
  async claim(code) {
    const mine = join(this.dir, `${code}.claimed.${process.pid}`);
    try {
      renameSync(join(this.dir, `${code}.json`), mine);
    } catch {
      return null;
    }
    try {
      const o = JSON.parse(readFileSync(mine, 'utf8'));
      return { meta: o.meta, body: Buffer.from(o.body, 'base64'), savedAt: o.savedAt };
    } finally {
      try {
        unlinkSync(mine);
      } catch {}
    }
  }
  async pending() {
    return readdirSync(this.dir)
      .map((f) => /^([A-Z2-9]+)\.json$/.exec(f)?.[1])
      .filter(Boolean);
  }
  listen(fn) {
    let known = new Set();
    this.timer = setInterval(async () => {
      const now = new Set(await this.pending());
      for (const code of now) if (!known.has(code)) fn(code);
      known = now;
    }, this.pollMs);
    this.timer.unref?.();
  }
  async sweep(maxAgeS) {
    const cut = Date.now() - maxAgeS * 1000;
    let n = 0;
    for (const f of readdirSync(this.dir)) {
      const full = join(this.dir, f);
      try {
        if (statSync(full).mtimeMs < cut) {
          unlinkSync(full);
          n++;
        }
      } catch {}
    }
    return n;
  }
  async close() {
    clearInterval(this.timer);
    clearInterval(this.comingTimer);
  }
  // (the builds and their files: in folders beside the saves', which sweep leaves alone)
  get buildDir() {
    const dir = `${this.dir}-builds`;
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  get assetDir() {
    const dir = `${this.dir}-assets`;
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  // (read and written off the event loop: a running server puts its build here - 24 MB of client files the first time)
  async putBuild(id, body, sig, assets = new Map()) {
    const assetDir = this.assetDir;
    for (const [hash, buf] of assets) {
      if (!HASH_RE.test(hash)) continue;
      const file = join(assetDir, hash);
      try {
        if ((await fileHash(file)) === hash) {
          touch(file);
          continue;
        }
      } catch {}
      await fsp.writeFile(`${file}.${process.pid}.tmp`, buf);
      await fsp.rename(`${file}.${process.pid}.tmp`, file);
    }
    const file = join(this.buildDir, `${id}.json`);
    await fsp.writeFile(`${file}.${process.pid}.tmp`, JSON.stringify({ sig: sig || '', assets: [...assets.keys()], body: Buffer.from(body).toString('base64') }));
    await fsp.rename(`${file}.${process.pid}.tmp`, file);
  }
  readBuild(id) {
    try {
      return JSON.parse(readFileSync(join(this.buildDir, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }
  async getBuild(id) {
    const o = this.readBuild(id);
    if (!o) return null;
    await this.touchBuild(id);
    return { body: Buffer.from(o.body, 'base64'), sig: o.sig || '' };
  }
  async touchBuild(id) {
    const o = this.readBuild(id);
    if (!o) return;
    touch(join(this.buildDir, `${id}.json`));
    for (const hash of o.assets || []) if (HASH_RE.test(hash)) touch(join(this.assetDir, hash));
  }
  async getAsset(hash) {
    if (!HASH_RE.test(hash)) return null;
    try {
      return readFileSync(join(this.assetDir, hash));
    } catch {
      return null;
    }
  }
  async sweepBuilds(maxAgeS) {
    const cut = Date.now() - maxAgeS * 1000;
    let n = 0;
    const named = new Set();
    for (const f of readdirSync(this.buildDir)) {
      const full = join(this.buildDir, f);
      try {
        if (statSync(full).mtimeMs < cut) {
          unlinkSync(full);
          if (BUILD_FILE_RE.test(f)) n++;
        } else for (const hash of this.readBuild(BUILD_FILE_RE.exec(f)?.[1])?.assets || []) named.add(hash);
      } catch {}
    }
    for (const f of readdirSync(this.assetDir)) {
      const full = join(this.assetDir, f);
      try {
        if (!named.has(f) && statSync(full).mtimeMs < cut) unlinkSync(full);
      } catch {}
    }
    return n;
  }
}
const touch = (file) => {
  try {
    const now = new Date();
    utimesSync(file, now, now);
  } catch {}
};

// Rows of game_handoff in Postgres (migration 008): the body as bytea, the room's meta as jsonb
export class PgStore {
  constructor(db, { log = () => {} } = {}) {
    this.db = db;
    this.log = log;
    this.unlisten = null;
  }
  async put(code, meta, body) {
    await this.db.query(
      `INSERT INTO game_handoff (code, build, format, state_ver, bytes, meta, body) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET saved_at = now(), build = EXCLUDED.build, format = EXCLUDED.format, state_ver = EXCLUDED.state_ver,
         bytes = EXCLUDED.bytes, meta = EXCLUDED.meta, body = EXCLUDED.body`,
      [code, BUILD, FORMAT, STATE_VERSION, body.byteLength, JSON.stringify(meta), Buffer.from(body)]
    );
    await this.db.query(`SELECT pg_notify('game_handoff', $1)`, [code]);
  }
  // me: this server's id behind the proxy (cluster.js). A save made for another server (its meta's target) is that
  // one's, unless it is gone or going down
  async claim(code, me = null) {
    const r = me
      ? await this.db.query(
          `DELETE FROM game_handoff h WHERE code = $1
             AND (meta->>'target' IS NULL OR meta->>'target' = $2 OR NOT EXISTS (SELECT 1 FROM cluster_servers s
                   WHERE s.id = h.meta->>'target' AND NOT s.draining AND s.seen_at > now() - make_interval(secs => $3)))
           RETURNING meta, body, saved_at`,
          [code, me, DEAD_S]
        )
      : await this.db.query(`DELETE FROM game_handoff WHERE code = $1 RETURNING meta, body, saved_at`, [code]);
    const row = r.rows[0];
    return row ? { meta: row.meta, body: row.body, savedAt: +new Date(row.saved_at) } : null;
  }
  async pending() {
    return (await this.db.query(`SELECT code FROM game_handoff`)).rows.map((r) => r.code);
  }
  listen(fn) {
    if (!this.db.listen) return;
    this.db
      .listen('game_handoff', fn)
      .then((stop) => (this.unlisten = stop))
      .catch((err) => this.log(`handoff: cannot listen for saves (${err.message}): they are restored when a player asks for one`));
  }
  async sweep(maxAgeS) {
    return (await this.db.query(`DELETE FROM game_handoff WHERE saved_at < now() - make_interval(secs => $1)`, [maxAgeS])).rowCount;
  }
  // (the word before the saves: notifications only, nothing stored - game_handoff_coming carries { code, ...info },
  // game_handoff_ready the code)
  async announceAndWait(list, ms) {
    if (!this.db.listen) return new Set();
    const want = new Set(list.map((x) => x.code));
    const got = new Set();
    let wake = null;
    const stop = await this.db.listen('game_handoff_ready', (code) => {
      if (!want.has(code)) return;
      got.add(code);
      if (got.size >= want.size) wake?.();
    });
    try {
      for (const { code, info } of list) await this.db.query(`SELECT pg_notify('game_handoff_coming', $1)`, [JSON.stringify({ ...info, code })]);
      if (got.size < want.size) await new Promise((done) => ((wake = done), setTimeout(done, ms)));
    } finally {
      await stop?.();
    }
    return got;
  }
  listenComing(fn) {
    if (!this.db.listen) return;
    this.db
      .listen('game_handoff_coming', (payload) => {
        try {
          const m = JSON.parse(payload);
          if (typeof m?.code === 'string') fn(m.code, m);
        } catch {}
      })
      .then((stop) => (this.unlistenComing = stop))
      .catch((err) => this.log(`handoff: cannot listen for games coming (${err.message}): their valleys are built when their saves come`));
  }
  async ready(code) {
    await this.db.query(`SELECT pg_notify('game_handoff_ready', $1)`, [code]);
  }
  async close() {
    await this.unlisten?.();
    await this.unlistenComing?.();
  }
  // (the builds: handoff_build and handoff_asset, migration 014. What is there under a name is written over: a row put
  // there by anyone else is replaced by this server's own, which it knows to be right)
  async putBuild(id, body, sig, assets = new Map()) {
    const hashes = [...assets.keys()].filter((h) => HASH_RE.test(h));
    const good = new Set((await this.db.query(`SELECT hash FROM handoff_asset WHERE hash = ANY($1) AND encode(sha256(body), 'hex') = hash`, [hashes])).rows.map((r) => r.hash));
    for (const hash of hashes) {
      if (good.has(hash)) continue;
      const buf = assets.get(hash);
      await this.db.query(`INSERT INTO handoff_asset (hash, bytes, body) VALUES ($1, $2, $3) ON CONFLICT (hash) DO UPDATE SET body = EXCLUDED.body, bytes = EXCLUDED.bytes, used_at = now()`, [hash, buf.length, Buffer.from(buf)]);
    }
    if (good.size) await this.db.query(`UPDATE handoff_asset SET used_at = now() WHERE hash = ANY($1)`, [[...good]]);
    await this.db.query(
      `INSERT INTO handoff_build (id, bytes, sig, assets, body) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, bytes = EXCLUDED.bytes, sig = EXCLUDED.sig, assets = EXCLUDED.assets, used_at = now()`,
      [id, body.byteLength, sig || '', hashes, Buffer.from(body)]
    );
  }
  async getBuild(id) {
    const r = await this.db.query(`UPDATE handoff_build SET used_at = now() WHERE id = $1 RETURNING body, sig, assets`, [id]);
    const row = r.rows[0];
    if (!row) return null;
    await this.db.query(`UPDATE handoff_asset SET used_at = now() WHERE hash = ANY($1)`, [row.assets || []]);
    return { body: Buffer.from(row.body), sig: row.sig || '' };
  }
  async touchBuild(id) {
    const r = await this.db.query(`UPDATE handoff_build SET used_at = now() WHERE id = $1 RETURNING assets`, [id]);
    if (r.rows[0]) await this.db.query(`UPDATE handoff_asset SET used_at = now() WHERE hash = ANY($1)`, [r.rows[0].assets || []]);
  }
  async getAsset(hash) {
    const r = await this.db.query(`SELECT body FROM handoff_asset WHERE hash = $1`, [hash]);
    return r.rows[0] ? Buffer.from(r.rows[0].body) : null;
  }
  async sweepBuilds(maxAgeS) {
    const n = (await this.db.query(`DELETE FROM handoff_build WHERE used_at < now() - make_interval(secs => $1)`, [maxAgeS])).rowCount;
    await this.db.query(`DELETE FROM handoff_asset a WHERE used_at < now() - make_interval(secs => $1) AND NOT EXISTS (SELECT 1 FROM handoff_build b WHERE a.hash = ANY(b.assets))`, [maxAgeS]);
    return n;
  }
}
