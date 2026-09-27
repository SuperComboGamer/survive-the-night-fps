// WebSocket connection + binary message framing.
import { C2S, S2C, ACT, PROTOCOL_VERSION, REJECT_REASON, Writer, Reader } from '../../shared/protocol.js';

export class Connection {
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.open = false;
    this.rtt = 80;
    this.w = new Writer(512);
    this.r = new Reader(new ArrayBuffer(0));
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.pingTimer = 0;
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  connect(name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url());
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        this.open = true;
        const w = this.w.reset();
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str(name);
        ws.send(w.copy());
        this.pingTimer = setInterval(() => this.ping(), 2000);
      };
      ws.onmessage = (m) => {
        const buf = m.data;
        this.bytesIn += buf.byteLength;
        const r = this.r.set(buf);
        const type = r.u8();
        switch (type) {
          case S2C.WELCOME: {
            const info = { id: r.u16(), seed: r.u32(), tick: r.u32(), tickRate: r.u8(), maxPlayers: r.u8() };
            settled = true;
            resolve(info);
            break;
          }
          case S2C.REJECT: {
            const reason = r.u8();
            settled = true;
            reject(new Error(reason === REJECT_REASON.FULL ? 'Server is full' : reason === REJECT_REASON.VERSION ? 'Version mismatch - refresh the page' : 'Rejected'));
            break;
          }
          case S2C.SNAPSHOT:
            this.h.snapshot?.(r);
            break;
          case S2C.INVENTORY:
            this.h.inventory?.(r);
            break;
          case S2C.CHAT:
            this.h.chat?.(r.u16(), r.u8(), r.str());
            break;
          case S2C.PLAYERS:
            this.h.players?.(r);
            break;
          case S2C.VOICE:
            this.h.voice?.(r.u16(), r.str());
            break;
          case S2C.PONG: {
            const t = r.f64();
            const rtt = performance.now() - t;
            this.rtt = this.rtt * 0.7 + rtt * 0.3;
            break;
          }
        }
      };
      ws.onclose = () => {
        this.open = false;
        clearInterval(this.pingTimer);
        if (!settled) reject(new Error('Could not connect to server'));
        else this.h.close?.();
      };
      ws.onerror = () => {};
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }

  sendRaw(w) {
    if (!this.open || this.ws.readyState !== 1) return;
    this.bytesOut += w.o;
    this.ws.send(w.bytes());
  }

  ping() {
    const w = this.w.reset();
    w.u8(C2S.PING);
    w.f64(performance.now());
    this.sendRaw(w);
  }

  // cmds: [{seq, buttons, qyaw, qpitch, slot}]
  sendInput(renderTick, renderFrac, cmds) {
    const w = this.w.reset();
    w.u8(C2S.INPUT);
    w.u16(renderTick & 0xffff);
    w.u8(Math.max(0, Math.min(255, Math.round(renderFrac * 255))));
    w.u8(cmds.length);
    for (const c of cmds) {
      w.u16(c.seq);
      w.u16(c.buttons);
      w.u16(c.qyaw);
      w.i16(c.qpitch);
      w.u8(c.slot);
    }
    this.sendRaw(w);
  }

  action(act, ...args) {
    const w = this.w.reset();
    w.u8(C2S.ACTION);
    w.u8(act);
    switch (act) {
      case ACT.INTERACT:
      case ACT.DEMOLISH:
      case ACT.REPAIR:
      case ACT.HOLD_BEGIN:
        w.u16(args[0]);
        break;
      case ACT.PING:
        w.u8(args[0]);
        w.i16(Math.max(-32768, Math.min(32767, Math.round(args[1] * 64))));
        w.i16(Math.max(-32768, Math.min(32767, Math.round(args[2] * 64))));
        w.i16(Math.max(-32768, Math.min(32767, Math.round(args[3] * 64))));
        break;
      case ACT.DROP_SLOT:
      case ACT.SWAP_INV:
        w.u8(args[0]);
        w.u8(args[1]);
        break;
      case ACT.BUILD:
        w.u8(args[0]);
        w.i16(Math.round(args[1] * 64));
        w.i16(Math.round(args[2] * 64));
        w.u8(args[3]);
        break;
      default:
        if (args.length) w.u8(args[0]);
    }
    this.sendRaw(w);
  }

  chat(text) {
    const w = this.w.reset();
    w.u8(C2S.CHAT);
    w.str(text);
    this.sendRaw(w);
  }

  voice(target, payload) {
    const w = new Writer(payload.length * 3 + 8);
    w.u8(C2S.VOICE);
    w.u16(target);
    w.str(payload);
    this.sendRaw(w);
  }
}
