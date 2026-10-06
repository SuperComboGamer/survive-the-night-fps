// WebSocket connection + binary message framing.
import { C2S, S2C, ACT, ROOMF, WELCOMEF, PROTOCOL_VERSION, REJECT_REASON, Writer, Reader, writeInput, readBoard, qpos } from '../../shared/protocol.js';
import { NIGHTFALL } from '../../shared/difficulty.js';
import { CHARACTER_NONE } from '../../shared/characters.js';

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
    this.room = null; // the game we are in: { code, name, inviteOnly, difficulty } (S2C.ROOM)
    this.accounts = new Map(); // player id -> the account they are signed in to, for friend requests and the friend star (S2C.FRIENDS; '' = a guest)
    this.held = null; // messages waiting for release() (hold)
  }

  // code: the game to join; none for a quick join (the server picks a public game, or makes one)
  url(code = '') {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws${code ? `?game=${encodeURIComponent(code)}` : ''}`;
  }

  // pid: who this browser is to the leaderboard (identity.js). code: as for url. character: the survivor chosen (shared/
  // characters.js; CHARACTER_NONE: the server picks). -> the WELCOME's info; throws the
  // REJECT's reason, or 'Could not connect to server' once the retries (RETRY_MS) are spent
  async connect(name, pid = '', code = '', character = CHARACTER_NONE) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(name, pid, code, character);
      } catch (err) {
        if (!err.unanswered || attempt >= RETRY_MS.length) throw err;
        await new Promise((done) => setTimeout(done, RETRY_MS[attempt]));
      }
    }
  }

  // one socket's try at it
  attempt(name, pid, code, character = CHARACTER_NONE) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let joined = false; // (WELCOME: this socket is the game's; one that was turned away goes without a word)
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
        w.u8(character); // (the survivor chosen on the splash: shared/characters.js)
        ws.send(w.copy());
      };
      ws.onmessage = (m) => {
        this.bytesIn += m.data.byteLength;
        if (this.held) this.held.push(() => handle(m.data));
        else handle(m.data);
      };
      const handle = (buf) => {
        const r = this.r.set(buf);
        const type = r.u8();
        switch (type) {
          case S2C.ROOM: {
            // the difficulty id was added on the end. A server from before it sends a packet that ends at the flags.
            const room = { code: r.str(), name: r.str(), inviteOnly: !!(r.u8() & ROOMF.INVITE_ONLY), difficulty: NIGHTFALL.id };
            if (r.left) room.difficulty = r.str();
            this.room = room;
            break;
          }
          case S2C.WELCOME: {
            const info = { id: r.u16(), seed: r.u32(), tick: r.u32(), tickRate: r.u8(), maxPlayers: r.u8(), room: this.room };
            info.admin = r.left > 0 && !!(r.u8() & WELCOMEF.ADMIN);
            info.act = r.left > 0 ? r.u8() : 1; // (which of the run's two maps: after the flags, which main's servers send too)
            settled = joined = true;
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
            this.h.world?.(r.u32(), r.left ? r.u8() : 1);
            break;
          case S2C.BOARD:
            this.h.board?.(readBoard(r));
            break;
          case S2C.FRIENDS:
            for (let n = r.u8(); n > 0; n--) this.accounts.set(r.u16(), r.str());
            break;
          case S2C.PROGRESS:
            this.h.progress?.(r);
            break;
        }
      };
      ws.onclose = (e) => {
        const opened = this.open;
        if (this.ws === ws) this.open = false;
        // (a join turned away - REJECT - is the caller's error already; the game only hears of the one it is in)
        if (settled) return joined && this.ws === ws && this.h.close?.(e.code);
        // (1006 without having opened: the handshake or the connection failed, here or on the way)
        const err = new Error('Could not connect to server');
        err.unanswered = true;
        console.warn(`[net] socket closed before the server answered (code ${e.code}${e.reason ? ` ${e.reason}` : ''}, ${opened ? 'after it opened' : 'never opened'}, ${Math.round(performance.now() - t0)} ms)`);
        reject(err);
      };
      ws.onerror = () => {};
    });
  }

  // What the server sends from now on waits, in order, until release() (Game.onWorld: the loading card is drawn
  // before the world swap holds the thread, and what follows the swap is in the new world's units)
  hold() {
    this.held ||= [];
  }
  release() {
    const q = this.held;
    if (!q) return;
    this.held = null;
    while (q.length) {
      // (a message played back can hold again: the rest waits behind it)
      if (this.held) return void (this.held = q.concat(this.held));
      q.shift()();
    }
  }

  // code: LEFT_CODE when the player chose to leave (the server lets their place go at once; any other close it holds)
  close(code = 1000) {
    if (this.ws) this.ws.close(code);
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
    writeInput(w, cmds, hash, ping, ping ? this.rtt : 0);
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
        w.i16(qpos(args[1]));
        w.i16(qpos(args[2]));
        w.i16(qpos(args[3]));
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
      case ACT.WORN:
        w.u8(args[0]);
        w.u8(args[1]);
        break;
      case ACT.BUILD:
        w.u8(args[0]);
        w.i16(qpos(args[1]));
        w.i16(qpos(args[2]));
        w.u8(args[3]);
        break;
      case ACT.WAYPOINT: {
        // ({ x, z, zone } or null to clear it)
        const at = args[0];
        w.u8(at ? 1 : 0);
        if (at) {
          w.i16(qpos(at.x));
          w.i16(qpos(at.z));
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
