// Per-client delta-compressed snapshot encoding.
// WebSocket delivery is reliable + ordered, so each client's baseline is simply "what we last sent it":
// creates carry full state, updates carry only the changed fields behind a one-byte head (ids as steps from the
// previous update, positions as 1-3 byte deltas when small; layout in shared/protocol.js), far entities update at
// half rate, and irrelevant/destroyed entities get a remove. Sections with nothing in them are not written at all.
import { MAX_ENTITIES, LOD_NEAR, AOI_RADIUS, AOI_ITEM_RADIUS, AOI_STRUCTURE_RADIUS, AOI_CACHE_RADIUS } from '../shared/constants.js';
import { ENT, SNAP, UPOS, UEXT, UEXT_ABS, qpos, qangle8, qlookYaw, qlookPitch, packLook, PFLAG, ZSTATUS } from '../shared/protocol.js';
import { ZOMBIE_DEFS } from '../shared/defs.js';

export const SLOTS = 9;

export class ClientView {
  constructor() {
    this.known = new Uint32Array(MAX_ENTITIES); // generation known by client, 0 = unknown
    this.base = new Int32Array(MAX_ENTITIES * SLOTS);
    this.knownIds = [];
    this.knownIndex = new Int32Array(MAX_ENTITIES).fill(-1);
    this.seen = new Uint32Array(MAX_ENTITIES);
  }
  reset() {
    this.known.fill(0);
    this.knownIds.length = 0;
    this.knownIndex.fill(-1);
  }
  _addKnown(id) {
    this.knownIndex[id] = this.knownIds.length;
    this.knownIds.push(id);
  }
  _removeKnown(id) {
    const k = this.knownIndex[id];
    if (k < 0) return;
    const last = this.knownIds.pop();
    if (last !== id) {
      this.knownIds[k] = last;
      this.knownIndex[last] = k;
    }
    this.knownIndex[id] = -1;
    this.known[id] = 0;
  }
}

const q = new Int32Array(SLOTS);
const FIELD_COUNT = { [ENT.PLAYER]: 9, [ENT.ZOMBIE]: 9, [ENT.ITEM]: 4, [ENT.STRUCTURE]: 5, [ENT.PROJECTILE]: 3, [ENT.CRATE]: 4, [ENT.AREA]: 3, [ENT.CACHE]: 4, [ENT.CAT]: 5, [ENT.DEER]: 5, [ENT.GUN]: 6 };
// mask bit -> slot ranges (first bit is always pos = slots 0..2)
const BIT_SLOTS = {
  [ENT.PLAYER]: [[0, 3], [3, 5], [5, 6], [6, 7], [7, 8], [8, 9]],
  [ENT.ZOMBIE]: [[0, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]],
  [ENT.ITEM]: [[0, 3], [3, 4]],
  [ENT.STRUCTURE]: [[0, 3], [3, 4], [4, 5]],
  [ENT.PROJECTILE]: [[0, 3]],
  [ENT.CRATE]: [[0, 3], [3, 4]],
  [ENT.AREA]: [[0, 3]],
  [ENT.CACHE]: [[0, 3], [3, 4]],
  [ENT.CAT]: [[0, 3], [3, 4], [4, 5]],
  [ENT.GUN]: [[0, 3], [3, 4], [4, 5], [5, 6]],
  [ENT.DEER]: [[0, 3], [3, 4], [4, 5]],
};

export function playerFlags(p) {
  const s = p.state;
  let f = 0;
  if (p.flashlight) f |= PFLAG.FLASHLIGHT;
  if (s.crouch) f |= PFLAG.CROUCH;
  if (p.zombie) f |= PFLAG.ZOMBIE;
  if (!p.alive) f |= PFLAG.DEAD;
  if (s.sprinting) f |= PFLAG.SPRINT;
  if (s.reloadT > 0) f |= PFLAG.RELOADING;
  if (s.pulled) f |= PFLAG.ROPED;
  if (s.pinned) f |= PFLAG.PINNED;
  if (p.downed) f |= PFLAG.DOWNED;
  if (p.revivedBy) f |= PFLAG.REVIVING;
  return f;
}

function quant(e) {
  q[0] = qpos(e.x);
  q[1] = qpos(e.y);
  q[2] = qpos(e.z);
  switch (e.kind) {
    case ENT.PLAYER: {
      const s = e.state;
      q[3] = qlookYaw(s.yaw);
      q[4] = qlookPitch(s.pitch);
      q[5] = playerFlags(e);
      q[6] = e.zombie ? 0 : s.weapons[s.slot] || 0;
      q[7] = Math.max(0, Math.min(255, Math.ceil((e.hp / e.maxHp) * 255)));
      q[8] = s.fireCount & 255;
      break;
    }
    case ENT.ZOMBIE:
      q[3] = qangle8(e.yaw);
      q[4] = e.anim;
      q[5] = Math.max(0, Math.min(255, Math.ceil((e.hp / e.maxHp) * 255)));
      q[6] = e.link || 0;
      q[7] = e.legs;
      q[8] = e.onFire || e.burnT > 0 ? ZSTATUS.BURNING : 0;
      break;
    case ENT.ITEM:
      q[3] = e.count;
      break;
    case ENT.STRUCTURE:
      q[3] = Math.max(0, Math.min(255, Math.ceil((e.hp / e.maxHp) * 255)));
      q[4] = e.state | 0;
      break;
    case ENT.CRATE:
    case ENT.CACHE:
      q[3] = e.state | 0;
      break;
    case ENT.CAT:
    case ENT.DEER:
      q[3] = qangle8(e.yaw);
      q[4] = e.anim;
      break;
    case ENT.GUN:
      q[3] = e.belt;
      q[4] = e.gunner;
      q[5] = packLook(qlookYaw(e.yaw), qlookPitch(e.pitch));
      break;
  }
}

function writeFields(w, kind, q, o, fromSlot, toSlot) {
  // writes q[o + fromSlot .. o + toSlot) with kind-specific widths
  for (let s = fromSlot; s < toSlot; s++) {
    const v = q[o + s];
    if (s < 3) {
      w.i16(v);
      continue;
    }
    switch (kind) {
      case ENT.PLAYER:
        if (s === 3) w.u16(packLook(v, q[o + 4])); // the view angles share a u16 (pitch = slot 4)
        else if (s === 5) w.u16(v);
        else if (s > 5) w.u8(v);
        break;
      case ENT.ZOMBIE:
        if (s === 6) w.u16(v);
        else w.u8(v);
        break;
      case ENT.ITEM:
      case ENT.GUN:
        w.u16(v);
        break;
      default:
        w.u8(v);
    }
  }
}

function writeCreate(w, e) {
  w.u16(e.id);
  w.u8(e.kind);
  switch (e.kind) {
    case ENT.ZOMBIE:
      w.u8(e.ztype);
      w.u8(e.variant & 255);
      break;
    case ENT.ITEM:
      w.u8(e.item);
      break;
    case ENT.STRUCTURE:
      w.u8(e.stype);
      w.u8(e.rot8);
      break;
    case ENT.PROJECTILE:
      w.u8(e.ptype);
      w.u16(e.owner || 0);
      break;
    case ENT.AREA:
      w.u8(e.atype);
      w.u8(Math.min(255, Math.round(e.radius * 10)));
      break;
    case ENT.CACHE:
      w.u8(e.ctype);
      break;
    case ENT.CAT:
    case ENT.DEER:
      w.u8(e.variant);
      break;
  }
  writeFields(w, e.kind, SQ, e.id * SLOTS, 0, FIELD_COUNT[e.kind]);
}

// Per-tick staging, shared by every client's snapshot: what an entity looks like on the wire does not depend on who
// is looking, so it is read off the entity once a tick, not once per client. stageEntities (once a tick, before the
// first writeEntities) copies every position into typed arrays for the area-of-interest and LOD tests; staged()
// quantizes an entity the first time a client needs it that tick, so the many that nobody is near are never
// quantized at all. The per-client loop then compares typed arrays against that client's baseline: it no longer
// reads e.x / e.z off nine object shapes (a load V8 can only do by boxing the double, which was half of the
// server's garbage). All of it is allocated once, here.
const SX = new Float64Array(MAX_ENTITIES);
const SZ = new Float64Array(MAX_ENTITIES);
const SQ = new Int32Array(MAX_ENTITIES * SLOTS); // quantized state by id (same offsets as ClientView.base)
const SQT = new Uint32Array(MAX_ENTITIES); // the stageStamp SQ was filled at, per id
let stageStamp = 0;
// all: the live entities, as writeEntities then gets them
export function stageEntities(all) {
  stageStamp = (stageStamp + 1) >>> 0 || 1; // never 0: that is "not staged"
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    SX[e.id] = e.x;
    SZ[e.id] = e.z;
  }
}
// offset of e's quantized state in SQ (and of its baseline in ClientView.base)
function staged(e) {
  const id = e.id;
  const o = id * SLOTS;
  if (SQT[id] !== stageStamp) {
    SQT[id] = stageStamp;
    quant(e);
    for (let s = 0; s < SLOTS; s++) SQ[o + s] = q[s];
  }
  return o;
}

// relevance radius per kind, squared; 0 = relevant everywhere
const AOI2 = new Float64Array(256).fill(AOI_RADIUS * AOI_RADIUS);
AOI2[ENT.PLAYER] = 0;
AOI2[ENT.CRATE] = 0;
AOI2[ENT.ITEM] = AOI_ITEM_RADIUS * AOI_ITEM_RADIUS;
AOI2[ENT.STRUCTURE] = AOI_STRUCTURE_RADIUS * AOI_STRUCTURE_RADIUS;
AOI2[ENT.CACHE] = AOI_CACHE_RADIUS * AOI_CACHE_RADIUS;

let seenStamp = 1;
const _cre = [];
const _rem = [];
// this snapshot's updates: their ids (sorted before writing) and, per id, the kind and the changed-field mask
const _uid = new Uint16Array(MAX_ENTITIES);
const _uk = new Uint8Array(MAX_ENTITIES);
const _um = new Uint16Array(MAX_ENTITIES); // up to 10 mask bits: the position and fields 1-9
const numeric = (a, b) => a - b;

// Writes the entity sections for one client: removes, creates (full), updates (changed fields only), each only
// if it has entries. Returns the SNAP bits of the sections written.
// candidates: array of live entities to consider (the viewer's own player is skipped); stageEntities must have
// run on them this tick.
export function writeEntities(w, view, viewer, candidates, tick) {
  const stamp = ++seenStamp;
  const vx = viewer.state.x;
  const vz = viewer.state.z;
  const base = view.base;
  const known = view.known;
  const seen = view.seen;
  // The one state that changes between two clients' snapshots of a tick is the viewer's own: Game.writeSelf, just
  // before this, rounds it to what went on the wire when it syncs the client. The clients before this one were
  // sent the unrounded position and the ones after it get the rounded one, so stage the viewer afresh.
  SX[viewer.id] = vx;
  SZ[viewer.id] = vz;
  SQT[viewer.id] = 0;
  let sections = 0;
  let nc = 0;
  let n = 0;
  _rem.length = 0;
  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    if (e === viewer || e.removed) continue;
    const id = e.id;
    const kind = e.kind;
    const dx = SX[id] - vx;
    const dz = SZ[id] - vz;
    const d2 = dx * dx + dz * dz;
    // area of interest: a rough radius per kind (bosses are seen from anywhere)
    const r2 = AOI2[kind];
    if (r2 !== 0 && !(d2 <= r2) && !(kind === ENT.ZOMBIE && e.boss)) continue;
    if (known[id] !== e.gen) {
      _cre[nc++] = e;
      continue; // not marked seen: a stale generation gets removed below before the create
    }
    seen[id] = stamp;
    // LOD: far entities update every other tick
    if (d2 > LOD_NEAR * LOD_NEAR && ((tick + id) & 1) === 1 && kind !== ENT.PLAYER) continue;
    // an update if anything differs from what this client has
    const b = staged(e);
    const bits = BIT_SLOTS[kind];
    let mask = 0;
    for (let bi = 0; bi < bits.length; bi++) {
      const r = bits[bi];
      for (let s = r[0]; s < r[1]; s++) {
        if (SQ[b + s] !== base[b + s]) {
          mask |= 1 << bi;
          break;
        }
      }
    }
    if (!mask) continue;
    _uid[n++] = id;
    _uk[id] = kind;
    _um[id] = mask;
  }
  // removes first (so a reused id is removed before its new create): ascending ids, each as a step from the last
  const ids = view.knownIds;
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    if (seen[id] !== stamp) _rem.push(id);
  }
  if (_rem.length) {
    sections |= SNAP.REMOVES;
    _rem.sort(numeric);
    w.varu(_rem.length);
    let prev = 0;
    for (let i = 0; i < _rem.length; i++) {
      w.varu(_rem[i] - prev);
      prev = _rem[i];
      view._removeKnown(_rem[i]);
    }
  }
  // creates
  if (nc) {
    sections |= SNAP.CREATES;
    w.varu(nc);
    for (let i = 0; i < nc; i++) {
      const e = _cre[i];
      _cre[i] = null;
      const b = staged(e);
      writeCreate(w, e);
      const fc = FIELD_COUNT[e.kind];
      for (let s = 0; s < fc; s++) base[b + s] = SQ[b + s];
      known[e.id] = e.gen;
      seen[e.id] = stamp;
      view._addKnown(e.id);
    }
  }
  if (!n) return sections;
  // updates, in id order
  const order = _uid.subarray(0, n).sort();
  w.varu(n);
  let prevId = 0;
  for (let i = 0; i < n; i++) {
    const id = order[i];
    const kind = _uk[id];
    const mask = _um[id];
    const b = id * SLOTS;
    const bits = BIT_SLOTS[kind];
    const step = id - prevId;
    prevId = id;
    let head = step <= 3 ? step : 0;
    let ext = mask >> 4;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let pos = UPOS.NONE;
    if (mask & 1) {
      dx = SQ[b] - base[b];
      dy = SQ[b + 1] - base[b + 1];
      dz = SQ[b + 2] - base[b + 2];
      if (dy === 0 && dx >= -8 && dx <= 7 && dz >= -8 && dz <= 7) pos = UPOS.NIB;
      else if (dx >= -32 && dx <= 31 && dz >= -32 && dz <= 31 && dy >= -8 && dy <= 7) pos = UPOS.PACK;
      else {
        pos = UPOS.WIDE;
        if (dx < -128 || dx > 127 || dy < -128 || dy > 127 || dz < -128 || dz > 127) ext |= UEXT_ABS;
      }
    }
    head |= (pos << 2) | ((mask & 0b1110) << 3);
    if (ext) head |= UEXT;
    w.u8(head);
    if (step > 3) w.varu(step);
    if (ext) w.u8(ext);
    if (pos === UPOS.NIB) w.u8(((dx & 15) << 4) | (dz & 15));
    else if (pos === UPOS.PACK) w.u16(((dx & 63) << 10) | ((dz & 63) << 4) | (dy & 15));
    else if (ext & UEXT_ABS) writeFields(w, kind, SQ, b, 0, 3);
    else if (pos === UPOS.WIDE) {
      w.i8(dx);
      w.i8(dy);
      w.i8(dz);
    }
    for (let bi = 1; bi < bits.length; bi++) {
      if (mask & (1 << bi)) writeFields(w, kind, SQ, b, bits[bi][0], bits[bi][1]);
    }
    for (let bi = 0; bi < bits.length; bi++) {
      if (!(mask & (1 << bi))) continue;
      const r = bits[bi];
      for (let s = r[0]; s < r[1]; s++) base[b + s] = SQ[b + s];
    }
  }
  return sections | SNAP.UPDATES;
}

export { ZOMBIE_DEFS };
