// Headless test bots: node scripts/bot.js [bots=2] [seconds=20] [url=ws://localhost:3000/ws]
// Each bot joins, runs the shared player simulation for prediction, wanders + shoots, decodes every
// snapshot, and reports bandwidth and prediction error (validates client/server determinism): the server only
// sends a bot its own state when the two disagree, so "rebased" counts the corrections and "pred err" their size.
import { C2S, S2C, SNAP, ACT, PROTOCOL_VERSION, Writer, Reader, qangle16, dqangle16, qpitch, dqpitch, writeInput, usePos } from '../shared/protocol.js';
import { BTN, CMD_DT, CMDS_PER_PACKET } from '../shared/constants.js';
import { worldFor } from '../shared/worlds.js';
import { createPlayerState, simulatePlayer, copyPlayerState, hashPlayerState } from '../shared/playersim.js';
import { readHeader, readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { ENT } from '../shared/protocol.js';
import { makeBox, COL } from '../shared/collision.js';
import { STRUCT_DEFS } from '../shared/defs.js';

const N = +(process.argv[2] || 2);
const SECONDS = +(process.argv[3] || 20);
const URL = process.argv[4] || 'ws://localhost:3000/ws';
// BOT_NAMES=a,b,c: what the bots are called (else bot0, bot1, ...). BOT_PING=1: each measures its round trip every 2 s
// (C2S.PING) and reports it with its commands as a client does, so the server knows a ping for it (the admin panel's shots)
const NAMES = (process.env.BOT_NAMES || '').split(',').filter(Boolean);
const PING = process.env.BOT_PING === '1';

function runBot(idx) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    ws.binaryType = 'arraybuffer';
    const st = { id: 0, world: null, bytes: 0, msgs: 0, up: 0, upMsgs: 0, snaps: 0, syncs: 0, net: { tick: 0, ack: 0 }, maxErr: 0, sumErr: 0, errN: 0, bigErr: 0, events: 0, ents: new Map(), zombies: 0, items: 0, structs: 0, global: null, self: {}, kills: 0, hitmarks: 0, entErrors: 0 };
    const pred = createPlayerState();
    const pending = [];
    let seq = 0;
    let yaw = Math.random() * 6.28;
    let t = 0;
    let lastTick = 0;
    let synced = false; // got the first server state
    const store = {
      ents: st.ents,
      onCreate(e) {
        if (e.kind === ENT.STRUCTURE && st.world) {
          const def = STRUCT_DEFS[e.stype];
          const x = e.q[0] / 64;
          const y = e.q[1] / 64;
          const z = e.q[2] / 64;
          let flags = COL.STRUCT;
          if (!def.block) flags |= COL.NOBLOCK;
          if (def.humanPass) flags |= COL.HUMANPASS;
          e.col = makeBox(x, z, y - 0.3, y + def.sy, def.sx, def.sz, (e.rot8 / 256) * Math.PI * 2, flags, e.id);
          st.world.structGrid.add(e.col);
        }
      },
      onRemove(e) {
        if (e.col) st.world.structGrid.remove(e.col);
      },
      onUpdate() {},
    };
    const handler = {
      sound() {
        st.events++;
      },
      shot() {
        st.events++;
      },
      impact() {
        st.events++;
      },
      hitmark(f) {
        st.hitmarks++;
        if (f & 2) st.kills++;
      },
      damage() {},
      killfeed() {},
      notify() {},
      explosion() {},
      pickup() {},
      zombieDie() {},
      structBreak() {},
    };
    ws.onopen = () => {
      const w = new Writer(64);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(NAMES[idx] || `bot${idx}`);
      ws.send(w.bytes());
    };
    let interval;
    let rtt = 0; // the last round trip measured (BOT_PING), and whether it has been reported yet
    let rttDue = false;
    if (PING)
      setInterval(() => {
        if (ws.readyState !== 1) return;
        const w = new Writer(16);
        w.u8(C2S.PING);
        w.f64(performance.now());
        ws.send(w.bytes());
      }, 2000).unref();
    ws.onmessage = (m) => {
      const buf = m.data;
      st.bytes += buf.byteLength;
      st.msgs++;
      const r = new Reader(buf);
      const type = r.u8();
      if (type === S2C.PONG) {
        rtt = Math.max(1, performance.now() - r.f64());
        rttDue = true;
      } else if (type === S2C.WELCOME) {
        st.id = r.u16();
        const seed = r.u32();
        r.u32(); // (the tick)
        r.u8();
        r.u8();
        if (r.left) r.u8(); // (WELCOMEF)
        // (which of the run's two maps the seed is to be built as: shared/acts.js. A server from before the mainland says none)
        st.world = worldFor(seed, r.left ? r.u8() : 1); // own copy (structure grid is per client)
        usePos(st.world);
        interval = setInterval(tick, CMD_DT * 1000 * CMDS_PER_PACKET);
      } else if (type === S2C.WORLD_RESET) {
        // a new playthrough on a new map, or the crossing to the mainland (the act says which is to be built)
        const seed = r.u32();
        st.world = worldFor(seed, r.left ? r.u8() : 1);
        usePos(st.world);
      } else if (type === S2C.SNAPSHOT) {
        if (st.world) usePos(st.world); // (positions in it are in its world's units: protocol.js)
        st.snaps++;
        const flags = readHeader(r, st.net);
        const tick = st.net.tick;
        const ack = st.net.ack;
        lastTick = tick;
        if (flags & SNAP.GLOBAL) st.global = readGlobal(r, st.global);
        const sync = readSelf(r, st.self, flags);
        try {
          readEntities(r, store, tick, flags);
        } catch (err) {
          st.entErrors++;
          console.log('entity decode error', err.message);
          return;
        }
        readEvents(r, handler, flags, st.ents);
        if (r.left !== 0) console.log(`bot${idx}: ${r.left} trailing bytes in snapshot!`);
        const idxAck = pending.findIndex((p) => p.seq === ack);
        if (sync) {
          // the server sent its state: how far off was our prediction of the acked command?
          st.syncs++;
          if (idxAck >= 0 && synced) {
            const pp = pending[idxAck].state;
            const err = Math.hypot(pp.x - st.self.x, pp.y - st.self.y, pp.z - st.self.z);
            st.maxErr = Math.max(st.maxErr, err);
            st.sumErr += err;
            st.errN++;
            if (err > 0.05) st.bigErr++;
          }
        }
        // drop everything the server has already consumed (seq <= ack, wrap-aware)
        while (pending.length && ((ack - pending[0].seq) & 0xffff) < 0x8000) pending.shift();
        if (sync) {
          // rebase: reset to the server state and replay what it hasn't seen
          synced = true;
          copyPlayerState(pred, st.self);
          for (const p of pending) simulatePlayer(pred, p.cmd, st.world, null);
        }
        st.zombies = 0;
        st.items = 0;
        st.structs = 0;
        for (const e of st.ents.values()) {
          if (e.kind === ENT.ZOMBIE) st.zombies++;
          else if (e.kind === ENT.ITEM) st.items++;
          else if (e.kind === ENT.STRUCTURE) st.structs++;
        }
      }
    };
    function tick() {
      if (!st.world || ws.readyState !== 1 || !synced) return;
      const w = new Writer(64);
      w.u8(C2S.INPUT);
      w.u16(lastTick - 2);
      w.u8(128);
      const cmds = [];
      // hunter mode: aim at the nearest zombie (interpolated ~2 ticks back like a real client)
      let target = null;
      if (process.env.HUNT) {
        let bd = 1e9;
        for (const e of st.ents.values()) {
          if (e.kind !== ENT.ZOMBIE || e.q[4] === 7) continue;
          const d = Math.hypot(e.q[0] / 64 - pred.x, e.q[2] / 64 - pred.z);
          if (d < bd) {
            bd = d;
            target = { x: e.q[0] / 64, y: e.q[1] / 64, z: e.q[2] / 64, d };
          }
        }
      }
      for (let k = 0; k < CMDS_PER_PACKET; k++) {
        t += CMD_DT;
        let buttons = 0;
        let pitch = -0.05;
        let slot = 255;
        if (target) {
          yaw = Math.atan2(-(target.x - pred.x), -(target.z - pred.z));
          pitch = Math.atan2(target.y + 1.2 - (pred.y + 1.62), target.d);
          if (target.d > 18) buttons |= BTN.FWD;
          if (target.d < 25 && Math.random() < 0.5) buttons |= BTN.ATTACK;
          if (pred.slot !== 1 && pred.weapons[1]) slot = 1;
        } else {
          if (Math.random() < 0.02) yaw += (Math.random() - 0.5) * 2;
          buttons = BTN.FWD;
          if (Math.random() < 0.3) buttons |= BTN.SPRINT;
          if (Math.random() < 0.02) buttons |= BTN.JUMP;
          if (Math.random() < 0.1) buttons |= BTN.ATTACK;
          if (Math.random() < 0.005) buttons |= BTN.RELOAD;
          slot = Math.random() < 0.005 ? (Math.random() < 0.5 ? 1 : 2) : 255;
        }
        seq = (seq + 1) & 0xffff;
        const qy = qangle16(yaw);
        const qp = qpitch(pitch);
        const cmd = { seq, buttons, yaw: dqangle16(qy), pitch: dqpitch(qp), slot };
        simulatePlayer(pred, cmd, st.world, null);
        const snap = createPlayerState();
        copyPlayerState(snap, pred);
        pending.push({ seq, cmd, state: snap });
        if (pending.length > 120) pending.shift();
        cmds.push({ seq, buttons, qyaw: qy, qpitch: qp, slot });
      }
      writeInput(w, cmds, hashPlayerState(pred), rttDue, rtt);
      rttDue = false;
      st.up += w.o;
      st.upMsgs++;
      ws.send(w.bytes());
      // occasionally try building a barricade near camp
      if (Math.random() < 0.01) {
        const a = new Writer(16);
        a.u8(C2S.ACTION);
        a.u8(ACT.BUILD);
        a.u8(1);
        a.i16(Math.round((pred.x - Math.sin(pred.yaw) * 3) * 64));
        a.i16(Math.round((pred.z - Math.cos(pred.yaw) * 3) * 64));
        a.u8(Math.floor(Math.random() * 256));
        st.up += a.o;
        st.upMsgs++;
        ws.send(a.bytes());
      }
    }
    setTimeout(() => {
      clearInterval(interval);
      ws.close();
      const secs = SECONDS;
      console.log(
        `bot${idx}: id=${st.id} snaps=${st.snaps} down ${(st.bytes / secs / 1024).toFixed(2)} KB/s ${(st.msgs / secs).toFixed(1)} msg/s avg ${(st.bytes / Math.max(1, st.msgs)).toFixed(0)} B/msg, up ${(st.up / secs / 1024).toFixed(2)} KB/s ${(st.upMsgs / secs).toFixed(1)} msg/s | rebased ${st.syncs}/${st.snaps} | pred err avg ${(st.sumErr / Math.max(1, st.errN) * 100).toFixed(2)}cm max ${(st.maxErr * 100).toFixed(1)}cm big=${st.bigErr}/${st.errN} | ents z=${st.zombies} items=${st.items} structs=${st.structs} | hits=${st.hitmarks} kills=${st.kills} entErr=${st.entErrors} | phase=${st.global?.phase} day=${st.global?.day} t=${st.global?.timeLeft}`,
      );
      resolve(st);
    }, SECONDS * 1000);
  });
}

const results = await Promise.all(Array.from({ length: N }, (_, i) => runBot(i)));
process.exit(results.some((r) => r.entErrors > 0) ? 1 : 0);
