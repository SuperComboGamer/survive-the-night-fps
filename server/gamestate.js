// A game as plain data, and back (Game.save / Game.load): what a server going down for a deploy hands to the next
// one (handoff.js). The valley is not in it - createWorld(seed) makes the same one again - only what play changed:
// the clock, the run's progress, the players, what was built, searched, dropped, felled and stripped, the dead
// walking about (zombies and their herds), the mounted gun, the fair, the handcars, the bell, the cemetery, crates,
// what each player has earned towards their achievements.
// Bullets and rockets in flight, burning ground, the deer and the cat are not: they are started afresh (the deer and
// the cat walk the valley as at a new run).
//
// Entities keep their ids (the registry is saved with them): everything refers to everything else by id - a
// zombie's target, a structure's builder, an item's dropper, the boss - so those links hold. An entity is saved as
// its own plain fields (plain), less what is derived or only there for the connection; it is loaded by making a
// fresh one the way its kind is made and copying the saved fields over it, so a field a later build adds keeps its
// default for a save made without it. Fields that hold other objects are saved as ids or indices and linked again.
//
// The players come back held (Game.hold): their body waits where it was, nothing hurts it, the dead pass it by, and
// a JOIN from the same account or browser puts the player back in it (Game.resume). Who has not come back after
// HANDOFF_RESERVE seconds has left, as anyone who does not come back after a drop does.
import { ZOMBIE_DEFS, LOOT_TABLES, ZONE } from '../shared/defs.js';
import { ENT, qpos } from '../shared/protocol.js';
import { COL } from '../shared/collision.js';
import { createPlayerState, copyPlayerState } from '../shared/playersim.js';
import { fellTree, treeAt } from '../shared/felling.js';
import { mulberry32 } from '../shared/rng.js';

export const HANDOFF_RESERVE = +(process.env.HANDOFF_RESERVE_SECONDS || 180); // s a restored player's place is kept

// the run's own numbers (Game constructor and startGame), as they are
const GAME_FIELDS = ['seed', 'worldPlayed', 'tick', 'time', 'phase', 'day', 'timeLeft', 'restartT', 'supplies', 'supplyHints', 'supplyFound', 'unlocked', 'schemHints', 'wave', 'bossPending', 'bossId', 'warned', 'shadeWarned', 'escape', 'supplyAt', 'nightStats', 'dropSeq', 'hordeHpMul'];
// what of a player is the connection's or the leaderboard's, or is worked out again (resume starts a client afresh)
const PLAYER_SKIP = new Set(['session', 'rec', 'view', 'shadow', 'cmdQueue', 'cmdBudget', 'lastSeq', 'hasSeq', 'recvSeq', 'renderTick', 'renderFrac', 'hx', 'hy', 'hz', 'selfSync', 'snapTick', 'ackSent', 'pingAt', 'ping', 'chatT', 'chatCount', 'onAir', 'pingT', 'boardT', 'ts', 'admin', 'adminT', 'adminFails', 'greeted', 'selfCache', 'globalCache', 'listVer', 'away', 'useItem', 'hold', 'invDirty', 'invSort', 'splitKeep', 'lastDrop', 'state']);
const ZOMBIE_SKIP = new Set(['def', 'hx', 'hy', 'hz', 'hitStruct']);
const KINDS = new Set(Object.values(ENT));

// An object's own fields as plain data: numbers, strings, booleans, null, arrays, Sets, Maps and plain objects of
// those (a Set or a Map as a marked object, made one again by over). What is not data - a typed array, a class
// instance, a function, an entity (it is somebody else's to save: refer to it by id) - is left out, and so are
// getters (a player's x / y / z read its state) and the keys in `skip`.
const SET = '\u0000set';
const MAP = '\u0000map';
export function plain(obj, skip = null) {
  const out = {};
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(obj))) {
    if (!('value' in d) || skip?.has(k)) continue;
    const v = data(d.value, 0);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
function data(v, depth) {
  if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v !== 'object' || depth > 6 || ArrayBuffer.isView(v)) return undefined;
  if (Array.isArray(v)) return v.map((x) => data(x, depth + 1) ?? null);
  if (v instanceof Set) return { [SET]: [...v].map((x) => data(x, depth + 1)).filter((x) => x !== undefined) };
  if (v instanceof Map) return { [MAP]: [...v].map(([k, x]) => [data(k, depth + 1), data(x, depth + 1)]).filter(([k, x]) => k !== undefined && x !== undefined) };
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return undefined; // (Map, Set, a class instance)
  if (KINDS.has(v.kind) && typeof v.id === 'number') return undefined; // (an entity held by another)
  const out = {};
  for (const k of Object.keys(v)) {
    const x = data(v[k], depth + 1);
    if (x !== undefined) out[k] = x;
  }
  return out;
}
// the saved fields over a fresh one (never onto a getter), the Sets and Maps among them made again
function over(e, saved) {
  for (const k of Object.keys(saved)) {
    const d = Object.getOwnPropertyDescriptor(e, k);
    if (d && !('value' in d)) continue;
    e[k] = revive(saved[k]);
  }
  return e;
}
function revive(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(revive);
  if (SET in v) return new Set(v[SET].map(revive));
  if (MAP in v) return new Map(v[MAP].map(([k, x]) => [revive(k), revive(x)]));
  const out = {};
  for (const k of Object.keys(v)) out[k] = revive(v[k]);
  return out;
}

// a tree or a wreck of the static world, by where it stands (as EVT.STRIPPED names them): [tree, qx, qy0, qz]
const colKey = (c) => [c.flags & COL.TREE ? 1 : 0, qpos(c.x), qpos(c.y0), qpos(c.z)];
const _near = [];
function colAt(world, [tree, qx, qy, qz]) {
  if (tree) return treeAt(world, qx, qy, qz);
  for (const c of world.staticGrid.query(qx / 64, qz / 64, 0.5, _near)) if (c.flags & COL.SALVAGE && qpos(c.x) === qx && qpos(c.y0) === qy && qpos(c.z) === qz) return c;
  return null;
}

// ---------------------------------------------------------------- saving
export function saveGame(g) {
  const s = {};
  for (const k of GAME_FIELDS) s[k] = data(g[k], 0) ?? null;
  s.waves = g.waves.map((wv) => data(wv, 0));
  s.fallen = [...g.fallen];
  s.leftKits = [...g.leftKits]; // (oldest first: the cap lets the oldest go)
  s.gather = [...g.gather].map(([col, v]) => [colKey(col), data(v, 0)]);
  s.felled = (g.world.felled || []).map((c) => colKey(c).slice(1));
  s.supplySpots = (g.supplySpots || []).map((sp) => g.world.partSpots.indexOf(sp));
  s.lootPoints = g.lootPoints.map((lp) => lp.respawnAt);
  s.registry = { gens: Array.from(g.gens.subarray(0, g.nextId)), freeIds: [...g.freeIds], quarantine: [...g.quarantine], nextId: g.nextId };
  s.players = [...g.players.values()].map((p) => ({ ...plain(p, PLAYER_SKIP), state: plain(p.state), splitKeep: [...p.splitKeep] }));
  s.structures = g.structures.map((e) => plain(e, new Set(['collider'])));
  s.caches = g.caches.map((e) => plain(e));
  s.items = g.items.map((e) => ({ ...plain(e, new Set(['point'])), point: e.point ? g.lootPoints.indexOf(e.point) : -1 }));
  s.crates = g.crates.map((e) => plain(e));
  s.flyovers = g.flyovers.map((f) => data(f, 0));
  s.zombies = g.zombies.map((z) => plain(z, ZOMBIE_SKIP));
  s.zm = g.zm.save();
  s.fixtures = g.fixtures.save();
  s.cemetery = g.cemetery.save();
  s.gun = g.gun.save();
  s.fair = g.fair.save();
  s.handcars = g.handcars.save();
  s.ach = g.ach.save();
  return s;
}

// ---------------------------------------------------------------- loading
// Into a Game whose constructor has made the save's valley (setWorld(s.seed)) and nothing else.
export function loadGame(g, s) {
  for (const k of GAME_FIELDS) {
    if (s[k] === undefined) continue;
    const now = g[k]; // (an object of the run's - escape, nightStats - keeps the defaults of fields the save lacks)
    g[k] = now && s[k] && typeof now === 'object' && !Array.isArray(now) ? { ...now, ...s[k] } : s[k];
  }
  g.waves = s.waves;
  g.fallen = new Set(s.fallen);
  g.leftKits = new Map(s.leftKits);
  // every random stream starts again, somewhere new: none can be read back (shared/rng.js), and the server decides
  // everything anyway, so nothing hangs on the sequence
  const salt = (k) => (g.seed ^ g.tick ^ k) >>> 0;
  g.rng = mulberry32(salt(0xabcdef));
  g.power.rng = mulberry32(salt(0x6e5e7));
  const w = g.world;
  // the valley as play left it: the trees cut down, what is used up of the trees and wrecks
  for (const [qx, qy, qz] of s.felled) {
    const col = treeAt(w, qx, qy, qz);
    if (col) fellTree(w, col);
  }
  for (const [key, v] of s.gather) {
    const col = colAt(w, key);
    if (col) g.gather.set(col, v);
  }
  g.supplySpots = s.supplySpots.map((i) => w.partSpots[i]).filter(Boolean);
  // the loot points as startGame lays them out, with when each comes back (the item on one is linked below)
  g.lootPoints = [];
  for (const sp of w.lootSpawns) g.lootPoints.push({ ...sp, ent: null, respawnAt: 0, table: LOOT_TABLES[sp.zone] || LOOT_TABLES[ZONE.FOREST] });
  for (const sp of w.resourceSpawns) g.lootPoints.push({ ...sp, ent: null, respawnAt: 0, table: LOOT_TABLES[ZONE.FOREST] });
  s.lootPoints.forEach((at, i) => g.lootPoints[i] && (g.lootPoints[i].respawnAt = at));

  // the registry: every id as it was, so each entity can take its own back
  const r = s.registry;
  g.gens.fill(0);
  g.gens.set(r.gens);
  g.nextId = r.nextId;
  g.freeIds = r.freeIds;
  g.quarantine = r.quarantine;

  for (const sp of s.players) {
    const p = g.createPlayer(null, sp.name, sp.id);
    if (!p) continue;
    const { state, splitKeep, ...rest } = sp;
    over(p, rest);
    p.state = over(createPlayerState(), state);
    copyPlayerState(p.shadow, p.state);
    p.splitKeep = new Map(splitKeep);
    p.invDirty = true;
    g.fillHistory(p);
    g.hold(p, { grace: HANDOFF_RESERVE, quiet: true, handoff: true });
  }
  for (const se of s.structures) {
    const e = g.spawnEntityAt({ ...se, collider: null }, se.id);
    if (!e) continue;
    e.collider = g.structCollider(e.stype, e.x, e.y, e.z, e.rot8, e.id);
    w.structGrid.add(e.collider);
    g.nav.addStructure(e.collider);
    g.structures.push(e);
  }
  for (const se of s.caches) if (g.spawnEntityAt({ ...se }, se.id)) g.caches.push(g.ents[se.id]);
  for (const se of s.items) {
    const { point, ...rest } = se;
    const e = g.spawnEntityAt({ ...rest, point: g.lootPoints[point] || null }, se.id);
    if (!e) continue;
    if (e.point) e.point.ent = e;
    if (e.drop) g.drops++;
    g.items.push(e);
  }
  for (const se of s.crates) if (g.spawnEntityAt({ ...se }, se.id)) g.crates.push(g.ents[se.id]);
  g.flyovers = s.flyovers;
  for (const sz of s.zombies) {
    if (!ZOMBIE_DEFS[sz.ztype]) continue;
    const z = over(g.zm.make(sz.ztype, sz.x, sz.y, sz.z), sz);
    if (!g.spawnEntityAt(z, sz.id)) continue;
    g.fillHistory(z);
    g.zombies.push(z);
  }
  g.zm.load(s.zm);
  g.fixtures.load(s.fixtures);
  g.cemetery.load(s.cemetery);
  g.gun.load(s.gun);
  g.fair.load(s.fair);
  g.handcars.load(s.handcars);
  if (s.ach) g.ach.load(s.ach);

  // what was alive and is not coming back (a bullet in flight, a deer) gives its id back
  const taken = new Set(g.freeIds);
  for (let i = 0; i < g.quarantine.length; i += 2) taken.add(g.quarantine[i]);
  for (let id = 1; id < g.nextId; id++) if (!g.ents[id] && !taken.has(id)) g.freeIds.push(id);

  // nobody is held by a leaper or a roper any more, and nobody is at the gun: its gunner is away
  for (const p of g.players.values()) g.releaseHolds(p);
  if (g.gun.ent && g.gun.ent.gunner) g.gun.ent.gunner = 0;
  g.zm.rebuildHash();
  // the deer and the cat, as at a new run
  g.dm.spawnInitial();
  g.cm.spawnInitial();
  g.globalDirty = true;
  g.playersDirty = true;
  g.log(`restored day ${g.day} (phase ${g.phase}, ${Math.round(g.timeLeft)} s left): ${g.players.size} players, ${g.zombies.length} zombies, ${g.structures.length} structures, ${g.items.length} items`);
}
