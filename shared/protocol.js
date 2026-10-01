// Binary wire protocol. Everything is little-endian, tightly packed.
// Positions are quantized to 1/64 m in int16 (range +-512 m).

export const PROTOCOL_VERSION = 8;

// client -> server
export const C2S = {
  JOIN: 1, // u8 version, str name
  INPUT: 2, // u16 renderTick, u8 renderFrac, u8 count, cmds...
  ACTION: 3, // u8 action, ...
  CHAT: 4, // str
  VOICE: 5, // u16 targetId, str payload(json)
  PING: 6, // f64 clientTime
};

// server -> client
export const S2C = {
  WELCOME: 1,
  SNAPSHOT: 2,
  INVENTORY: 3,
  CHAT: 4,
  PLAYERS: 5,
  VOICE: 6,
  REJECT: 7,
  PONG: 8,
  WORLD_RESET: 9,
};

// discrete, non-predicted actions
export const ACT = {
  INTERACT: 1, // u16 entityId (0 = look target resolved server-side)
  DROP_SLOT: 2, // u8 inventory index, u8 count (0 = all)
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
};

// special interaction targets that are not entities
export const CAR_ID = 0xfffe;
export const PING_KIND = { GO: 0, DANGER: 1, LOOT: 2 };
// hold-to-interact kinds (sent back in the self state for the progress ring)
export const HOLD = { NONE: 0, SEARCH: 1, REVIVE: 2, ENGINE: 3 };

export const REJECT_REASON = { FULL: 1, VERSION: 2, BAD_NAME: 3 };

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
  str() {
    const n = this.u16();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.o, n);
    this.o += n;
    return decoder.decode(bytes);
  }
}

// ---------------------------------------------------------------- entity field layouts
// Each entity kind has up to 8 delta-tracked fields; bit i of the change mask = field i.
// Field 0 is always position (x,y,z). Mask bit 7 (POS_DELTA) signals the position is
// encoded as 3 x int8 deltas from the previously sent quantized position.
export const POS_DELTA_BIT = 0x80;

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
// ZOMBIE fields
export const ZF = { POS: 0, YAW: 1, ANIM: 2, HP: 3, LINK: 4 };
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
