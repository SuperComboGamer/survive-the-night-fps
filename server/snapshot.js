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
const FIELD_COUNT = { [ENT.PLAYER]: 9, [ENT.ZOMBIE]: 9, [ENT.ITEM]: 4, [ENT.STRUCTURE]: 5, [ENT.PROJECTILE]: 3, [ENT.CRATE]: 4, [ENT.AREA]: 3, [ENT.CACHE]: 4, [ENT.CAT]: 5 };
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
      q[3] = qangle8(e.yaw);
      q[4] = e.anim;
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
      w.u8(e.variant);
      break;
  }
  writeFields(w, e.kind, q, 0, 0, FIELD_COUNT[e.kind]);
}

// rough relevance radius per kind
function relevant(e, vx, vz, viewer) {
  switch (e.kind) {
    case ENT.PLAYER:
      return true;
    case ENT.CRATE:
      return true;
    case ENT.ZOMBIE:
      if (e.boss) return true;
      return inRange(e, vx, vz, AOI_RADIUS);
    case ENT.ITEM:
      return inRange(e, vx, vz, AOI_ITEM_RADIUS);
    case ENT.STRUCTURE:
      return inRange(e, vx, vz, AOI_STRUCTURE_RADIUS);
    case ENT.CACHE:
      return inRange(e, vx, vz, AOI_CACHE_RADIUS);
    default:
      return inRange(e, vx, vz, AOI_RADIUS);
  }
}
function inRange(e, x, z, r) {
  const dx = e.x - x;
  const dz = e.z - z;
  return dx * dx + dz * dz <= r * r;
}

let seenStamp = 1;
const _cre = [];
const _upd = [];
const _rem = [];
// this snapshot's updates: entity, changed-field mask and quantized state, in id order
let _uq = new Int32Array(256 * SLOTS);
const _ue = [];
const _um = [];
const _uo = [];
const byId = (a, b) => _ue[a].id - _ue[b].id;
const numeric = (a, b) => a - b;

// Writes the entity sections for one client: removes, creates (full), updates (changed fields only), each only
// if it has entries. Returns the SNAP bits of the sections written.
// candidates: array of live entities to consider (the viewer's own player is skipped).
export function writeEntities(w, view, viewer, candidates, tick) {
  const stamp = ++seenStamp;
  const vx = viewer.state.x;
  const vz = viewer.state.z;
  const base = view.base;
  const known = view.known;
  let sections = 0;
  _cre.length = 0;
  _upd.length = 0;
  _rem.length = 0;
  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    if (e === viewer || e.removed) continue;
    if (!relevant(e, vx, vz, viewer)) continue;
    const kg = known[e.id];
    if (kg !== e.gen) {
      _cre.push(e);
      continue; // not marked seen: a stale generation gets removed below before the create
    }
    view.seen[e.id] = stamp;
    const dx = e.x - vx;
    const dz = e.z - vz;
    // LOD: far entities update every other tick
    if (dx * dx + dz * dz > LOD_NEAR * LOD_NEAR && ((tick + e.id) & 1) === 1 && e.kind !== ENT.PLAYER) continue;
    _upd.push(e);
  }
  // removes first (so a reused id is removed before its new create): ascending ids, each as a step from the last
  const ids = view.knownIds;
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    if (view.seen[id] !== stamp) _rem.push(id);
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
  if (_cre.length) {
    sections |= SNAP.CREATES;
    w.varu(_cre.length);
    for (let i = 0; i < _cre.length; i++) {
      const e = _cre[i];
      quant(e);
      writeCreate(w, e);
      const b = e.id * SLOTS;
      const n = FIELD_COUNT[e.kind];
      for (let s = 0; s < n; s++) base[b + s] = q[s];
      known[e.id] = e.gen;
      view.seen[e.id] = stamp;
      view._addKnown(e.id);
    }
  }
  // updates: find what changed...
  if (_upd.length * SLOTS > _uq.length) _uq = new Int32Array(_upd.length * SLOTS * 2);
  let n = 0;
  for (let i = 0; i < _upd.length; i++) {
    const e = _upd[i];
    quant(e);
    const b = e.id * SLOTS;
    const bits = BIT_SLOTS[e.kind];
    let mask = 0;
    for (let bi = 0; bi < bits.length; bi++) {
      const r = bits[bi];
      for (let s = r[0]; s < r[1]; s++) {
        if (q[s] !== base[b + s]) {
          mask |= 1 << bi;
          break;
        }
      }
    }
    if (!mask) continue;
    _ue[n] = e;
    _um[n] = mask;
    _uo[n] = n;
    const o = n * SLOTS;
    for (let s = 0; s < SLOTS; s++) _uq[o + s] = q[s];
    n++;
  }
  if (!n) return sections;
  // ...and write it in id order
  _uo.length = n;
  _uo.sort(byId);
  w.varu(n);
  let prevId = 0;
  for (let i = 0; i < n; i++) {
    const k = _uo[i];
    const e = _ue[k];
    const mask = _um[k];
    const o = k * SLOTS;
    const b = e.id * SLOTS;
    const bits = BIT_SLOTS[e.kind];
    const step = e.id - prevId;
    prevId = e.id;
    let head = step <= 3 ? step : 0;
    let ext = mask >> 4;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let pos = UPOS.NONE;
    if (mask & 1) {
      dx = _uq[o] - base[b];
      dy = _uq[o + 1] - base[b + 1];
      dz = _uq[o + 2] - base[b + 2];
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
    else if (ext & UEXT_ABS) writeFields(w, e.kind, _uq, o, 0, 3);
    else if (pos === UPOS.WIDE) {
      w.i8(dx);
      w.i8(dy);
      w.i8(dz);
    }
    for (let bi = 1; bi < bits.length; bi++) {
      if (mask & (1 << bi)) writeFields(w, e.kind, _uq, o, bits[bi][0], bits[bi][1]);
    }
    for (let bi = 0; bi < bits.length; bi++) {
      if (!(mask & (1 << bi))) continue;
      const r = bits[bi];
      for (let s = r[0]; s < r[1]; s++) base[b + s] = _uq[o + s];
    }
    _ue[k] = null;
  }
  return sections | SNAP.UPDATES;
}

export { ZOMBIE_DEFS };
