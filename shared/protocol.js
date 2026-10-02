// Binary wire protocol. Everything is little-endian, tightly packed.
// Positions are quantized to 1/64 m in int16 (range +-512 m).

export const PROTOCOL_VERSION = 22;

// client -> server
export const C2S = {
  JOIN: 1, // u8 version, str name, str player id (the browser's own, see client/net/identity.js; '' or absent: nothing is kept for them)
  INPUT: 2, // u16 renderTick, u8 renderFrac, u8 head, u16 seq, [u8 hash], cmds... (see writeInput)
  ACTION: 3, // u8 action, ...
  CHAT: 4, // str
  VOICE: 5, // u16 targetId, str payload(json)
  PING: 6, // f64 clientTime (answered at once with S2C.PONG; the game client pings inside its INPUT packets instead)
  BOARD: 7, // (nothing): asks for the leaderboard, answered with S2C.BOARD
};

// server -> client
export const S2C = {
  WELCOME: 1,
  SNAPSHOT: 2, // u8 flags (SNAP), [u32 tick, u16 ack], [varu ack step], [global], [self], [entities], [events]
  INVENTORY: 3,
  CHAT: 4,
  PLAYERS: 5,
  VOICE: 6,
  REJECT: 7,
  PONG: 8,
  WORLD_RESET: 9, // u32 seed: a new playthrough on a new map - rebuild the world from this seed
  BOARD: 10, // the leaderboard, as asked for (see writeBoard)
};

// S2C.SNAPSHOT flags: a section is only on the wire when its bit is set. WebSocket delivery is reliable and ordered,
// so the tick is the previous snapshot's + 1 and the acked command is the previous one + CMDS_PER_PACKET unless said
// otherwise (TICK: u32 tick and u16 ack follow, as in a client's first snapshot; ACK: a varu step from the previous
// ack follows).
export const SNAP = { GLOBAL: 1, SELF: 2, REMOVES: 4, CREATES: 8, UPDATES: 16, EVENTS: 32, TICK: 64, ACK: 128 };
// self section: u8 mask, bits 0-4 = the simulated state in 5 chunks (only ever sent with SYNC), STATUS = the
// server-driven status (hp, armor, battery, ...; its own u8 field mask follows), SYNC = "this is the authoritative
// state after the acked command: rebase the prediction on it". Without SYNC the client's own prediction stands.
export const SELF = { SIM: 0x1f, STATUS: 0x20, SYNC: 0x80 };

// discrete, non-predicted actions
export const ACT = {
  INTERACT: 1, // u16 entityId (0 = look target resolved server-side)
  DROP_SLOT: 2, // u8 inventory index, u16 count (0 = all)
  DROP_WEAPON: 3, // u8 weapon slot
  CRAFT: 4, // u8 recipe id
  USE_ITEM: 5, // u8 inventory index
  BUILD: 6, // u8 struct type, i16 x, i16 z, u8 rot
  DEMOLISH: 7, // u16 entity id
  REPAIR: 8, // u16 entity id
  FLASHLIGHT: 9, // u8 on
  EQUIP_ARMOR: 10, // u8 inventory index
  SWAP_INV: 11, // u8 a, u8 b
  SELECT_THROWABLE: 12, // u8 item
  FUEL_CAMPFIRE: 13,
  INSTALL_PART: 14,
  RESPAWN_CHOICE: 15,
  HOLD_BEGIN: 16, // u16 target (container / downed teammate / CAR_ID): hold-to-interact starts
  HOLD_END: 17, // released [E]
  PING: 18, // u8 kind, i16 x, i16 y, i16 z (1/64 m)
  SPLIT_INV: 19, // u8 inventory index, u16 count: that many leave the stack for a free slot of their own
};

// special interaction targets that are not entities
export const CAR_ID = 0xfffe;
export const PING_KIND = { GO: 0, DANGER: 1, LOOT: 2 };
// hold-to-interact kinds (sent back in the self state for the progress ring)
export const HOLD = { NONE: 0, SEARCH: 1, REVIVE: 2, ENGINE: 3, DRIVE: 4 };

export const REJECT_REASON = { FULL: 1, VERSION: 2, BAD_NAME: 3 };

// S2C.CHAT: u16 speaker id (0 = the server), u8 flags, str text. Chat only reaches the players in earshot of the
// speaker (TALK_RANGE), or anywhere over a walkie-talkie link, so the flags differ per recipient.
export const CHATF = {
  SYSTEM: 1,
  ZOMBIE: 2, // the speaker is a player-zombie
  RADIO: 4, // out of earshot: it came over the walkie-talkie
  FAINT: 8, // only just in earshot
  UNHEARD: 16, // (to the speaker) nobody was close enough to hear it
};
// S2C.PLAYERS: u8 count, then per player u16 id, str name, u8 status, u8 flags (PLF), u16 kills, u16 ping
export const PLF = { WALKIE: 1 }; // carries a walkie-talkie

export const ENT = {
  PLAYER: 1,
  ZOMBIE: 2,
  ITEM: 3,
  STRUCTURE: 4,
  PROJECTILE: 5,
  CRATE: 6,
  AREA: 7,
  CACHE: 8, // searchable container (static position from world gen, state = searched)
  CAT: 9, // the stray cat (ambient, can't be hurt)
};

// ---------------------------------------------------------------- quantization
export const POS_SCALE = 64;
export const qpos = (v) => {
  const q = Math.round(v * POS_SCALE);
  return q < -32768 ? -32768 : q > 32767 ? 32767 : q;
};
export const dqpos = (q) => q / POS_SCALE;
const TAU = Math.PI * 2;
export const qangle16 = (a) => {
  let n = a % TAU;
  if (n < 0) n += TAU;
  return Math.round((n / TAU) * 65536) & 0xffff;
};
export const dqangle16 = (q) => (q / 65536) * TAU;
export const qangle8 = (a) => {
  let n = a % TAU;
  if (n < 0) n += TAU;
  return Math.round((n / TAU) * 256) & 0xff;
};
export const dqangle8 = (q) => (q / 256) * TAU;
export const qpitch = (p) => Math.max(-32767, Math.min(32767, Math.round(p * 20000)));
export const dqpitch = (q) => q / 20000;
// Other players' view angles only pose their model and aim their torch, so they replicate coarser than the
// commands do: yaw in 9 bits (0.7 deg), pitch in 7 (1.4 deg), one u16 on the wire. Both are kept in the units of
// qangle16 / qpitch so entity records look the same on both ends.
export const LOOK_PITCH_Q = 492; // qpitch units per pitch step: 63 steps reach 1.55 rad
export const qlookYaw = (yaw) => (qangle16(yaw) + 64) & 0xff80;
export const qlookPitch = (pitch) => Math.max(-63, Math.min(63, Math.round(qpitch(pitch) / LOOK_PITCH_Q))) * LOOK_PITCH_Q;
export const packLook = (qyaw, qp) => qyaw | (qp / LOOK_PITCH_Q + 64);
export const unpackLookYaw = (v) => v & 0xff80;
export const unpackLookPitch = (v) => ((v & 127) - 64) * LOOK_PITCH_Q;

// ---------------------------------------------------------------- writer / reader
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Writer {
  constructor(size = 4096) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
    this.u8a = new Uint8Array(this.buf);
    this.o = 0;
  }
  reset() {
    this.o = 0;
    return this;
  }
  ensure(n) {
    if (this.o + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.o + n) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(this.u8a.subarray(0, this.o));
    this.buf = nb;
    this.view = new DataView(nb);
    this.u8a = new Uint8Array(nb);
  }
  u8(v) {
    this.ensure(1);
    this.view.setUint8(this.o, v);
    this.o += 1;
  }
  i8(v) {
    this.ensure(1);
    this.view.setInt8(this.o, v);
    this.o += 1;
  }
  u16(v) {
    this.ensure(2);
    this.view.setUint16(this.o, v, true);
    this.o += 2;
  }
  i16(v) {
    this.ensure(2);
    this.view.setInt16(this.o, v, true);
    this.o += 2;
  }
  u32(v) {
    this.ensure(4);
    this.view.setUint32(this.o, v, true);
    this.o += 4;
  }
  f32(v) {
    this.ensure(4);
    this.view.setFloat32(this.o, v, true);
    this.o += 4;
  }
  f64(v) {
    this.ensure(8);
    this.view.setFloat64(this.o, v, true);
    this.o += 8;
  }
  // unsigned LEB128: 1 byte below 128, 2 below 16384, ...
  varu(v) {
    this.ensure(5);
    while (v > 127) {
      this.view.setUint8(this.o++, (v & 127) | 128);
      v >>>= 7;
    }
    this.view.setUint8(this.o++, v);
  }
  str(s) {
    const bytes = encoder.encode(s);
    const n = Math.min(bytes.length, 65535);
    this.u16(n);
    this.ensure(n);
    this.u8a.set(bytes.subarray(0, n), this.o);
    this.o += n;
  }
  // reserve a u16 slot, returns offset to patch later
  reserve16() {
    this.ensure(2);
    const at = this.o;
    this.o += 2;
    return at;
  }
  patch16(at, v) {
    this.view.setUint16(at, v, true);
  }
  reserve8() {
    this.ensure(1);
    const at = this.o;
    this.o += 1;
    return at;
  }
  patch8(at, v) {
    this.view.setUint8(at, v);
  }
  // view of written bytes (shares memory - send before next reset)
  bytes() {
    return this.u8a.subarray(0, this.o);
  }
  // copy of written bytes
  copy() {
    return this.buf.slice(0, this.o);
  }
}

export class Reader {
  constructor(buffer) {
    this.set(buffer);
  }
  set(buffer) {
    if (buffer instanceof ArrayBuffer) {
      this.view = new DataView(buffer);
    } else {
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
    this.o = 0;
    return this;
  }
  get left() {
    return this.view.byteLength - this.o;
  }
  u8() {
    const v = this.view.getUint8(this.o);
    this.o += 1;
    return v;
  }
  i8() {
    const v = this.view.getInt8(this.o);
    this.o += 1;
    return v;
  }
  u16() {
    const v = this.view.getUint16(this.o, true);
    this.o += 2;
    return v;
  }
  i16() {
    const v = this.view.getInt16(this.o, true);
    this.o += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.o, true);
    this.o += 4;
    return v;
  }
  f64() {
    const v = this.view.getFloat64(this.o, true);
    this.o += 8;
    return v;
  }
  varu() {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = this.view.getUint8(this.o++);
      v |= (b & 127) << shift;
      if (b < 128) return v >>> 0;
      shift += 7;
    }
  }
  str() {
    const n = this.u16();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.o, n);
    this.o += n;
    return decoder.decode(bytes);
  }
}

// ---------------------------------------------------------------- input commands
// C2S.INPUT body after the render time: u8 head (bits 0-3 command count, IN_SAME, IN_SLOT, IN_NOHASH, IN_PING), u16
// seq of the first command (the rest follow on), u8 hash of the client's predicted state after the last command
// (hashPlayerState; absent with IN_NOHASH), the first command in full (u16 buttons, u16 yaw, i16 pitch, [u8 slot]
// with IN_SLOT) and, unless IN_SAME says the rest repeat it, per further command a u8 of CMDF bits and the fields
// they announce. Every packet stands alone. IN_PING asks for an EVT.PONG in the next snapshot (round-trip time
// without a packet of its own in either direction).
export const IN_SAME = 0x10;
export const IN_SLOT = 0x20;
export const IN_NOHASH = 0x40;
export const IN_PING = 0x80;
export const MAX_CMDS = 15; // per packet
const CMDF = { BUTTONS: 1, YAW8: 2, YAW16: 4, PITCH8: 8, PITCH16: 16, SLOT: 32 };

// cmds: [{seq, buttons, qyaw, qpitch, slot}] (1..MAX_CMDS of them, consecutive seqs); hash -1 = none
export function writeInput(w, cmds, hash = -1, ping = false) {
  const c0 = cmds[0];
  let same = true;
  for (let i = 1; i < cmds.length; i++) {
    const c = cmds[i];
    if (c.buttons !== c0.buttons || c.qyaw !== c0.qyaw || c.qpitch !== c0.qpitch || c.slot !== 255) same = false;
  }
  w.u8(cmds.length | (same ? IN_SAME : 0) | (c0.slot !== 255 ? IN_SLOT : 0) | (hash < 0 ? IN_NOHASH : 0) | (ping ? IN_PING : 0));
  w.u16(c0.seq);
  if (hash >= 0) w.u8(hash);
  w.u16(c0.buttons);
  w.u16(c0.qyaw);
  w.i16(c0.qpitch);
  if (c0.slot !== 255) w.u8(c0.slot);
  if (same) return;
  for (let i = 1; i < cmds.length; i++) {
    const p = cmds[i - 1];
    const c = cmds[i];
    const dy = ((c.qyaw - p.qyaw + 0x8000) & 0xffff) - 0x8000; // shortest way round
    const dp = c.qpitch - p.qpitch;
    let f = 0;
    if (c.buttons !== p.buttons) f |= CMDF.BUTTONS;
    if (dy) f |= dy >= -128 && dy <= 127 ? CMDF.YAW8 : CMDF.YAW16;
    if (dp) f |= dp >= -128 && dp <= 127 ? CMDF.PITCH8 : CMDF.PITCH16;
    if (c.slot !== 255) f |= CMDF.SLOT;
    w.u8(f);
    if (f & CMDF.BUTTONS) w.u16(c.buttons);
    if (f & CMDF.YAW8) w.i8(dy);
    else if (f & CMDF.YAW16) w.u16(c.qyaw);
    if (f & CMDF.PITCH8) w.i8(dp);
    else if (f & CMDF.PITCH16) w.i16(c.qpitch);
    if (f & CMDF.SLOT) w.u8(c.slot);
  }
}

// Reads what writeInput wrote: { cmds: [{seq, buttons, qyaw, qpitch, slot}], hash (-1 = none), ping }.
export function readInput(r) {
  const head = r.u8();
  const n = head & 15;
  const seq = r.u16();
  const hash = head & IN_NOHASH ? -1 : r.u8();
  const cmds = [];
  const ping = !!(head & IN_PING);
  if (!n) return { cmds, hash, ping };
  let c = { seq, buttons: r.u16(), qyaw: r.u16(), qpitch: r.i16(), slot: head & IN_SLOT ? r.u8() : 255 };
  cmds.push(c);
  for (let i = 1; i < n; i++) {
    const d = { seq: (seq + i) & 0xffff, buttons: c.buttons, qyaw: c.qyaw, qpitch: c.qpitch, slot: 255 };
    if (!(head & IN_SAME)) {
      const f = r.u8();
      if (f & CMDF.BUTTONS) d.buttons = r.u16();
      if (f & CMDF.YAW8) d.qyaw = (c.qyaw + r.i8()) & 0xffff;
      else if (f & CMDF.YAW16) d.qyaw = r.u16();
      if (f & CMDF.PITCH8) d.qpitch = c.qpitch + r.i8();
      else if (f & CMDF.PITCH16) d.qpitch = r.i16();
      if (f & CMDF.SLOT) d.slot = r.u8();
    }
    cmds.push(d);
    c = d;
  }
  return { cmds, hash, ping };
}

// ---------------------------------------------------------------- leaderboard
// S2C.BOARD: varu players on record, varu row count, then per row str name, u8 flags (BOARDF), one varu per
// BOARD_STATS entry and, on the recipient's own row (BOARDF.ME), their place in each of those stats (varu; 0: none,
// nothing scored there yet). The rows are the best BOARD_TOP by each stat, everybody in the game and the recipient,
// in no order: the client sorts them. A row names nobody but by the name they play under - the id a player joins
// with is what proves who they are, and no message carries it back out.
export const BOARD_STATS = ['kills', 'nights', 'wins', 'revives'];
export const BOARDF = { ME: 1, HERE: 2 }; // the recipient's own row; in this game right now
export const BOARD_TOP = 20;

// rows: [{ name, flags, kills, nights, wins, revives, ranks: [n per stat] (the ME row only) }]
export function writeBoard(w, total, rows) {
  w.varu(total);
  w.varu(rows.length);
  for (const row of rows) {
    w.str(row.name);
    w.u8(row.flags);
    for (const k of BOARD_STATS) w.varu(row[k]);
    if (row.flags & BOARDF.ME) for (const rank of row.ranks) w.varu(rank);
  }
}

// Reads what writeBoard wrote: { total, rows: [{ name, me, here, kills, nights, wins, revives, ranks | null }] }.
export function readBoard(r) {
  const total = r.varu();
  const rows = [];
  for (let n = r.varu(); n > 0; n--) {
    const row = { name: r.str(), me: false, here: false, ranks: null };
    const flags = r.u8();
    row.me = !!(flags & BOARDF.ME);
    row.here = !!(flags & BOARDF.HERE);
    for (const k of BOARD_STATS) row[k] = r.varu();
    if (row.me) row.ranks = BOARD_STATS.map(() => r.varu());
    rows.push(row);
  }
  return { total, rows };
}

// ---------------------------------------------------------------- entity field layouts
// Each entity kind has up to 10 delta-tracked fields; bit i of the change mask = field i. Field 0 is always the
// position (x,y,z). On the wire the updates of a snapshot are sorted by id and each one starts with a head byte:
//   bits 0-1  id step from the previous update (1-3; 0 = a varu step follows)
//   bits 2-3  position: UPOS.NONE, NIB (1 byte: dx,dz in 4 bits each, dy 0), PACK (2 bytes: dx,dz 6 bits, dy 4 bits),
//             WIDE (3 x int8, or 3 x int16 absolute when the ext byte says UEXT_ABS)
//   bits 4-6  fields 1-3 changed
//   bit 7     an ext byte follows: bits 0-5 = fields 4-9 changed, UEXT_ABS
export const UPOS = { NONE: 0, NIB: 1, PACK: 2, WIDE: 3 };
export const UEXT = 0x80;
export const UEXT_ABS = 0x40;

// PLAYER fields
export const PF = { POS: 0, ANG: 1, FLAGS: 2, WEAPON: 3, HP: 4, ACTION: 5, LINK: 6 };
// player flag bits (u16 on the wire)
export const PFLAG = {
  FLASHLIGHT: 1,
  CROUCH: 2,
  ZOMBIE: 4,
  DEAD: 8,
  SPRINT: 16,
  RELOADING: 32,
  ROPED: 64,
  PINNED: 128,
  DOWNED: 256,
  REVIVING: 512, // being revived by a teammate
};
// ZOMBIE fields (LEGS: legs blown off, bit 0 left, bit 1 right)
export const ZF = { POS: 0, YAW: 1, ANIM: 2, HP: 3, LINK: 4, LEGS: 5, STATUS: 6 };
// zombie status bits (ZF.STATUS)
export const ZSTATUS = { BURNING: 1 };
// ITEM fields
export const IF = { POS: 0, COUNT: 1 };
// STRUCTURE fields
export const SF = { POS: 0, HP: 1, STATE: 2 };
// PROJECTILE fields
export const JF = { POS: 0 };
// CRATE fields
export const CF = { POS: 0, STATE: 1 };
// AREA fields
export const AF = { POS: 0 };
// CACHE fields
export const KF = { POS: 0, STATE: 1 };
// CAT fields
export const TF = { POS: 0, YAW: 1, ANIM: 2 };
