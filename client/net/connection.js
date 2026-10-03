// WebSocket connection + binary message framing.
import { C2S, S2C, ACT, PROTOCOL_VERSION, REJECT_REASON, Writer, Reader, writeInput } from '../../shared/protocol.js';

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
    this.pingAt = 0; // when the ping that is still out was sent
    this.pingNext = 0; // when the next one is due
  }

  // room: which of the server's games to join (server/rooms.js); 'main' is the one that always exists
  url(room = 'main') {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws` + (room && room !== 'main' ? `?room=${encodeURIComponent(room)}` : '');
  }

  connect(name, room = 'main') {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url(room));
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        this.open = true;
        const w = this.w.reset();
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str(name);
        ws.send(w.copy());
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
          case S2C.WORLD_RESET:
            this.h.world?.(r.u32());
            break;
        }
      };
      ws.onclose = () => {
        this.open = false;
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

  // cmds: [{seq, buttons, qyaw, qpitch, slot}], hash: fingerprint of the predicted state after the last of them.
  // Every 2 s one of these packets doubles as a ping; the answer comes back inside a snapshot (pong).
  sendInput(renderTick, renderFrac, cmds, hash) {
    const now = performance.now();
    const ping = now >= this.pingNext;
    if (ping) {
      this.pingAt = now;
      this.pingNext = now + 2000;
    }
    const w = this.w.reset();
    w.u8(C2S.INPUT);
    w.u16(renderTick & 0xffff);
    w.u8(Math.max(0, Math.min(255, Math.round(renderFrac * 255))));
    writeInput(w, cmds, hash, ping);
    this.sendRaw(w);
  }

  // held: ms the server kept the ping before the snapshot with the answer left
  pong(held) {
    if (!this.pingAt) return;
    const rtt = Math.max(0, performance.now() - this.pingAt - held);
    this.pingAt = 0;
    this.rtt = this.rtt * 0.7 + rtt * 0.3;
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
