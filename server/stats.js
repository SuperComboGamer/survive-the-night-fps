// The leaderboard: what every player has done over all the games they have played, kept by the server.
//
// A player is known by the id their browser made up on its first launch and sends in its JOIN
// (client/net/identity.js). That id is the one thing that proves who they are - whoever knows it plays as them -
// so it goes no further than enter(): a record is filed under the id's SHA-256, which is all the stats file
// holds, and what a client is sent (board) names a player by the name they play under and nothing else.
//
// The file (STATS_FILE, see server/index.js), JSON:
//   { v: 1, players: { <sha-256 of the id, hex>: { name, kills, nights, wins, revives, seen, xp, perks, respecs, best } } }
//   name    the name they last joined under          kills    the dead they put down (zombies, turned players)
//   nights  nights they were alive at the end of     wins     runs their team escaped from, with them in the game
//   revives teammates they got back on their feet    seen     when they were last in a game (ms since 1970)
//   xp      experience earned (shared/progress.js)   perks    the perk ids they picked, in order (absent: none)
//   respecs times they started their picks over      best     the furthest day they saw dawn on (absent: none)
// Without a file the records last as long as the process does (tests, sims).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BOARD_STATS, BOARDF, BOARD_TOP } from '../shared/protocol.js';
import { levelOf, fitPerks } from '../shared/progress.js';

// what a browser sends: a UUID, as crypto.randomUUID writes one. Anything else is nobody (bots, tests, junk)
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[0-9a-f]{64}$/;
const STAT_MAX = 0xffffffff; // (what a varu carries)
// Records kept. Past it the ones not seen for the longest go, whoever is in a game right now excepted. A record
// only exists once it has something on it, so this is 20000 players who scored, not 20000 joins.
const MAX_RECORDS = 20000;

// The key a browser's id is filed under: its SHA-256, hex. '' for anything that is not an id
export const idKey = (id) => (typeof id === 'string' && ID.test((id = id.toLowerCase())) ? createHash('sha256').update(id).digest('hex') : '');

const whole = (v) => (typeof v === 'number' && v > 0 ? Math.min(Math.floor(v), STAT_MAX) : 0);
// a stored name, as handleJoin would have let it through
const cleanName = (v) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _\-.#]/gu, '').trim().slice(0, 16) : '') || 'Survivor';
const scored = (rec) => rec.xp > 0 || BOARD_STATS.some((k) => rec[k] > 0);

// Stored picks as a player with this much XP may have them: the curve or the tree may have changed since, so what
// they could not have now (past their points, missing what it needs, junk) is left out and the rest kept
export const cleanPerks = (perks, xp) => fitPerks(perks, xp);

export class PlayerStats {
  constructor(opts = {}) {
    this.file = opts.file || '';
    this.log = opts.log ?? (() => {});
    this.max = opts.max ?? MAX_RECORDS;
    this.recs = new Map(); // sha-256 of the id -> record. A record also counts the sessions playing on it (`on`)
    this.dirty = false;
    this.saving = false;
    if (this.file) this.load();
  }

  // ---------------------------------------------------------------- the file
  load() {
    let raw;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (err) {
      // nothing there yet is how every server starts. Anything else is said out loud: the next save writes over it
      if (err.code !== 'ENOENT') this.log(`stats: ${this.file} could not be read (${err.message}): starting empty`);
      return;
    }
    const players = raw && typeof raw === 'object' && raw.v === 1 && raw.players && typeof raw.players === 'object' ? raw.players : {};
    for (const [key, r] of Object.entries(players)) {
      if (!KEY.test(key) || !r || typeof r !== 'object') continue;
      const rec = { key, name: cleanName(r.name), seen: Number.isFinite(r.seen) && r.seen > 0 ? Math.floor(r.seen) : 0, on: 0 };
      for (const k of BOARD_STATS) rec[k] = whole(r[k]);
      rec.xp = whole(r.xp);
      rec.perks = cleanPerks(r.perks, rec.xp);
      rec.respecs = whole(r.respecs);
      rec.best = whole(r.best);
      if (scored(rec)) this.recs.set(key, rec);
    }
    this.log(`stats: ${this.recs.size} players on record (${this.file})`);
  }

  // what goes into the file: the records with something on them, and never more than `max`
  serialize() {
    if (this.recs.size > this.max) {
      const idle = [...this.recs.values()].filter((r) => !r.on).sort((a, b) => a.seen - b.seen);
      for (const r of idle.slice(0, this.recs.size - this.max)) this.recs.delete(r.key);
    }
    const players = {};
    for (const rec of this.recs.values()) {
      if (!scored(rec)) continue;
      const out = (players[rec.key] = { name: rec.name });
      for (const k of BOARD_STATS) out[k] = rec[k];
      out.seen = rec.seen;
      out.xp = rec.xp;
      if (rec.perks.length) out.perks = rec.perks;
      if (rec.respecs) out.respecs = rec.respecs;
      if (rec.best) out.best = rec.best;
    }
    return JSON.stringify({ v: 1, players });
  }

  // Writes the file if anything changed since the last time: beside it first, then moved over it, so a crash
  // half-way through leaves the old file whole. The server calls this every so often...
  async save() {
    if (!this.file || !this.dirty || this.saving) return;
    this.saving = true;
    this.dirty = false;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      await writeFile(this.file + '.tmp', this.serialize());
      await rename(this.file + '.tmp', this.file);
    } catch (err) {
      this.dirty = true;
      this.log(`stats: could not save ${this.file} (${err.message})`);
    }
    this.saving = false;
  }
  // ...and this on its way out, where nothing may be left to a later turn of the event loop
  saveSync() {
    if (!this.file || !this.dirty) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', this.serialize());
      renameSync(this.file + '.tmp', this.file);
      this.dirty = false;
    } catch (err) {
      this.log(`stats: could not save ${this.file} (${err.message})`);
    }
  }

  // ---------------------------------------------------------------- players
  // The record of the player joining with `id` under `name`: their own from before, or a new one. null for an id
  // that is not one - nothing is kept for that player and they are on no board.
  enter(id, name) {
    const key = idKey(id);
    if (!key) return null;
    let rec = this.recs.get(key);
    if (!rec) {
      rec = { key, name, seen: 0, on: 0, xp: 0, perks: [], respecs: 0, best: 0 };
      for (const k of BOARD_STATS) rec[k] = 0;
      this.recs.set(key, rec);
    }
    if (rec.name !== name && scored(rec)) this.dirty = true;
    rec.name = name;
    rec.seen = Date.now();
    rec.on++;
    return rec;
  }

  // They left. A record with nothing on it goes with them: a join costs the server nothing it has to keep
  leave(rec) {
    if (!rec) return;
    rec.seen = Date.now();
    if (--rec.on <= 0 && !scored(rec)) this.recs.delete(rec.key);
  }

  // stat: one of BOARD_STATS, or 'xp'
  bump(rec, stat, n = 1) {
    if (!rec || !(stat === 'xp' || BOARD_STATS.includes(stat))) return;
    rec[stat] = Math.min(STAT_MAX, rec[stat] + n);
    this.dirty = true;
  }

  // they saw dawn on this day: the furthest they ever have, if it is
  best(rec, day) {
    if (!rec || !(day > rec.best)) return;
    rec.best = whole(day);
    this.dirty = true;
  }

  // ---------------------------------------------------------------- progress (shared/progress.js)
  // What a game needs to know of a player as they join: { xp, perks, best }
  progress(rec) {
    return rec ? { xp: rec.xp, perks: rec.perks.slice(), best: rec.best } : null;
  }

  // A player's progress for the API, by who asks: { key, xp, perks, respecs } (a guest with nothing on record: all
  // nothing). There are no accounts without a database: only a browser's id. null for nobody
  progressOf({ guestId }) {
    const key = idKey(guestId);
    if (!key) return null;
    const rec = this.recs.get(key);
    return { key, xp: rec?.xp || 0, perks: rec ? rec.perks.slice() : [], respecs: rec?.respecs || 0 };
  }

  // Their picks are these now (checked by the caller: server/progress.js). false if the record is not there
  setPerks(prog, perks, respecs) {
    const rec = this.recs.get(prog.key);
    if (!rec) return false;
    rec.perks = perks.slice();
    rec.respecs = whole(respecs);
    this.dirty = true;
    return true;
  }

  // The leaderboard as one player gets it: the best BOARD_TOP by each stat, everybody playing right now (`here`:
  // their records) and `me`, each row once, with my place in each stat on my own row. One pass over the records.
  board(me, here) {
    const tops = BOARD_STATS.map(() => []); // per stat: the best so far, highest first
    const ahead = BOARD_STATS.map(() => 0); // per stat: how many have more than me
    let total = 0;
    for (const rec of this.recs.values()) {
      if (!BOARD_STATS.some((k) => rec[k] > 0)) continue;
      total++;
      BOARD_STATS.forEach((k, i) => {
        const v = rec[k];
        if (!v) return;
        if (me && v > me[k]) ahead[i]++;
        const top = tops[i];
        if (top.length === BOARD_TOP && v <= top[BOARD_TOP - 1][k]) return;
        let at = top.length;
        while (at > 0 && top[at - 1][k] < v) at--;
        top.splice(at, 0, rec);
        if (top.length > BOARD_TOP) top.pop();
      });
    }
    const picked = new Set(tops.flat());
    for (const rec of here) picked.add(rec);
    if (me) picked.add(me);
    const rows = [];
    for (const rec of picked) {
      const row = { name: rec.name, flags: (rec === me ? BOARDF.ME : 0) | (here.has(rec) ? BOARDF.HERE : 0), level: levelOf(rec.xp) };
      for (const k of BOARD_STATS) row[k] = rec[k];
      if (rec === me) row.ranks = BOARD_STATS.map((k, i) => (me[k] ? ahead[i] + 1 : 0));
      rows.push(row);
    }
    return { total, rows };
  }
}
