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
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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

// A fingerprint of what world generation made of a seed and what a save points into by index or position: the
// colliders (to the centimetre), loot and resource spots, containers, supply spots, spawn points, places. Taken as
// the world is made (Game.setWorld), before anything is felled; about 5 ms. A save made on a valley this build
// generates differently is not restored: its positions could be inside a wall now, its indices name other spots.
export function worldHash(world) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    v = Math.round(v * 100) | 0;
    for (let i = 0; i < 4; i++) {
      h ^= (v >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
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
    for (const p of list) for (const v of [p.x, p.y ?? 0, p.z, p.zone ?? 0, p.ctype ?? 0]) mix(v);
  }
  for (const z of world.zones) for (const v of [z.id, z.x, z.z]) mix(v);
  for (const v of [world.mine ? 1 : 0, world.rail ? world.rail.main.n : 0, world.fair ? 1 : 0]) mix(v);
  return (h >>> 0).toString(16);
}

// Why a save cannot be used here (the Game constructor given one throws it): the save is dropped, and the game it
// held ends as it would have without any of this.
export class HandoffError extends Error {}

// The envelope round a game's save: what is checked before any of it is believed (checkEnvelope)
export function envelope(game) {
  return { format: FORMAT, stateVersion: STATE_VERSION, protocol: PROTOCOL_VERSION, build: BUILD, savedAt: Date.now(), enums: enums(), worldHash: game.worldHash, game: game.save() };
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

// Files in a folder: CODE.json, written as CODE.json.tmp and renamed (there whole or not at all). Claimed by renaming
// it to a name of this process's: of two servers claiming at once, one rename fails.
export class FileStore {
  constructor(dir, { pollMs = 500 } = {}) {
    this.dir = dir;
    this.pollMs = pollMs;
    this.timer = null;
    mkdirSync(dir, { recursive: true });
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
  }
}

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
  async close() {
    await this.unlisten?.();
  }
}
