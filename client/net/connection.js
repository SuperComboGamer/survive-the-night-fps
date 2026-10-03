// WebSocket connection + binary message framing.
import { C2S, S2C, ACT, ROOMF, PROTOCOL_VERSION, REJECT_REASON, Writer, Reader, writeInput, readBoard } from '../../shared/protocol.js';

// A join whose socket closes before the server has answered it (no WELCOME, no REJECT) is tried again after these
// waits (ms) before it fails. Seen in production (Oct 2026): now and then the socket is gone ~20 ms after the server
// upgraded it, before it ever opened here, so the JOIN never went - and the same click again got straight in.
const RETRY_MS = [250, 1000];

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
    this.room = null; // the game we are in: { code, name, inviteOnly } (S2C.ROOM)
    this.accounts = new Map(); // player id -> the account they are signed in to, for friend requests and the friend star (S2C.FRIENDS; '' = a guest)
  }

  // code: the game to join; none for a quick join (the server picks a public game, or makes one)
  url(code = '') {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws${code ? `?game=${encodeURIComponent(code)}` : ''}`;
  }

  // pid: who this browser is to the leaderboard (identity.js). code: as for url. -> the WELCOME's info; throws the
  // REJECT's reason, or 'Could not connect to server' once the retries (RETRY_MS) are spent
  async connect(name, pid = '', code = '') {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(name, pid, code);
      } catch (err) {
        if (!err.unanswered || attempt >= RETRY_MS.length) throw err;
        await new Promise((done) => setTimeout(done, RETRY_MS[attempt]));
      }
    }
  }

  // one socket's try at it
  attempt(name, pid, code) {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.room = null;
      this.accounts = new Map();
      const t0 = performance.now();
      const ws = new WebSocket(this.url(code));
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        this.open = true;
        const w = this.w.reset();
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str(name);
        w.str(pid);
        ws.send(w.copy());
      };
      ws.onmessage = (m) => {
        const buf = m.data;
        this.bytesIn += buf.byteLength;
        const r = this.r.set(buf);
        const type = r.u8();
        switch (type) {
          case S2C.ROOM:
            this.room = { code: r.str(), name: r.str(), inviteOnly: !!(r.u8() & ROOMF.INVITE_ONLY) };
            break;
          case S2C.WELCOME: {
            const info = { id: r.u16(), seed: r.u32(), tick: r.u32(), tickRate: r.u8(), maxPlayers: r.u8(), room: this.room };
            settled = true;
            resolve(info);
            break;
          }
          case S2C.REJECT: {
            const reason = r.u8();
            settled = true;
            const text =
              reason === REJECT_REASON.FULL
                ? code
                  ? 'That game is full.'
                  : 'Every game is full right now. Try again in a minute.'
                : reason === REJECT_REASON.NO_GAME
                  ? 'That game has ended, or the link is wrong.'
                  : reason === REJECT_REASON.VERSION
                    ? 'Version mismatch - refresh the page'
                    : 'Rejected';
            const err = new Error(text);
            err.reason = reason;
            reject(err);
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
          case S2C.BOARD:
            this.h.board?.(readBoard(r));
            break;
          case S2C.FRIENDS:
            for (let n = r.u8(); n > 0; n--) this.accounts.set(r.u16(), r.str());
            break;
        }
      };
      ws.onclose = (e) => {
        const opened = this.open;
        this.open = false;
        if (settled) return this.h.close?.();
        // (1006 without having opened: the handshake or the connection failed, here or on the way)
        const err = new Error('Could not connect to server');
        err.unanswered = true;
        console.warn(`[net] socket closed before the server answered (code ${e.code}${e.reason ? ` ${e.reason}` : ''}, ${opened ? 'after it opened' : 'never opened'}, ${Math.round(performance.now() - t0)} ms)`);
        reject(err);
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
      case ACT.GEN_SWITCH:
        w.u16(args[0]);
        break;
      case ACT.PING:
        w.u8(args[0]);
        w.i16(Math.max(-32768, Math.min(32767, Math.round(args[1] * 64))));
        w.i16(Math.max(-32768, Math.min(32767, Math.round(args[2] * 64))));
        w.i16(Math.max(-32768, Math.min(32767, Math.round(args[3] * 64))));
        break;
      case ACT.DROP_SLOT:
      case ACT.SPLIT_INV:
      case ACT.SALVAGE:
      case ACT.DROP_AMMO:
        w.u8(args[0]);
        w.u16(args[1]);
        break;
      case ACT.SWAP_INV:
      case ACT.UNEQUIP:
        w.u8(args[0]);
        w.u8(args[1]);
        break;
      case ACT.BUILD:
        w.u8(args[0]);
        w.i16(Math.round(args[1] * 64));
        w.i16(Math.round(args[2] * 64));
        w.u8(args[3]);
        break;
      case ACT.WAYPOINT: {
        // ({ x, z, zone } or null to clear it)
        const at = args[0];
        w.u8(at ? 1 : 0);
        if (at) {
          w.i16(Math.max(-32768, Math.min(32767, Math.round(at.x * 64))));
          w.i16(Math.max(-32768, Math.min(32767, Math.round(at.z * 64))));
          w.u8(at.zone >= 0 ? at.zone : 255);
        }
        break;
      }
      default:
        if (args.length) w.u8(args[0]);
    }
    this.sendRaw(w);
  }

  // asks for the leaderboard: it comes back as S2C.BOARD (the server answers once a second at most)
  board() {
    const w = this.w.reset();
    w.u8(C2S.BOARD);
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
