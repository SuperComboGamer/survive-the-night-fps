// Messages between the network thread and a game's worker (rooms.js, room-worker.js). The bytes of many socket
// messages, each for one connection slot of the room, are packed into one ArrayBuffer that is transferred to the
// other thread instead of copied: one postMessage per batch rather than one per message. A frame is
// [u16 slot][u32 length][bytes], little-endian.
export class FramePacker {
  constructor(size = 1 << 14) {
    this.buf = new Uint8Array(size);
    this.dv = new DataView(this.buf.buffer);
    this.o = 0;
    this.frames = 0;
  }

  // copies bytes in (a caller may reuse its buffer right after)
  push(slot, bytes) {
    const end = this.o + 6 + bytes.length;
    if (end > this.buf.length) this.grow(end);
    this.dv.setUint16(this.o, slot, true);
    this.dv.setUint32(this.o + 2, bytes.length, true);
    this.buf.set(bytes, this.o + 6);
    this.o = end;
    this.frames++;
  }

  grow(need) {
    let n = this.buf.length * 2;
    while (n < need) n *= 2;
    const b = new Uint8Array(n);
    b.set(this.buf.subarray(0, this.o));
    this.buf = b;
    this.dv = new DataView(b.buffer);
  }

  get empty() {
    return this.o === 0;
  }

  // the frames packed so far, in an ArrayBuffer of their own (to transfer); the packer starts over
  take() {
    const out = this.buf.buffer.slice(0, this.o);
    this.o = 0;
    this.frames = 0;
    return out;
  }
}

// calls fn(slot, bytes) for each frame of a packed buffer, in order (bytes: a view into it)
export function eachFrame(ab, fn) {
  const dv = new DataView(ab);
  const u8 = new Uint8Array(ab);
  for (let o = 0; o + 6 <= ab.byteLength; ) {
    const slot = dv.getUint16(o, true);
    const len = dv.getUint32(o + 2, true);
    fn(slot, u8.subarray(o + 6, o + 6 + len));
    o += 6 + len;
  }
}
