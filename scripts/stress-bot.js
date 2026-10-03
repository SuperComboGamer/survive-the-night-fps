// A worker thread of load-test bots for scripts/stress.js. Each bot is a protocol-level client like scripts/bot.js:
// it joins a game by its code, predicts its own movement with the shared player simulation (so the server sees
// matching state fingerprints and sends it what a real client gets), sends 20 input packets a second, and decodes
// every snapshot. By day it wanders, turning back for the car past WANDER_MAX metres; at night it hunts the nearest
// zombie and shoots. The bots of a thread share one world per seed (a world each costs ~15 MB and hundreds of ms).
//
// From stress.js:  { t: 'spawn', bots: [{ id, url, name }] }   { t: 'sample' } -> { t: 'sample', ... }   { t: 'stop' }
import { parentPort } from 'node:worker_threads';
import { C2S, S2C, SNAP, ACT, ENT, PROTOCOL_VERSION, Writer, Reader, qangle16, dqangle16, qpitch, dqpitch, writeInput } from '../shared/protocol.js';
import { BTN, CMD_DT, CMDS_PER_PACKET, PHASE } from '../shared/constants.js';
import { createWorld } from '../shared/world.js';
import { createPlayerState, simulatePlayer, copyPlayerState, hashPlayerState } from '../shared/playersim.js';
import { readHeader, readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { makeBox, COL } from '../shared/collision.js';
import { STRUCT_DEFS } from '../shared/defs.js';

const WANDER_MAX = 60; // m from the car before a wandering bot turns back
const GAP_SLOW = 150; // ms between two snapshots that counts as a hitch (they are due every 50)

// seed -> { world, structs: id -> { col, refs } }: one world per seed for every bot of this thread
const worlds = new Map();
function worldFor(seed) {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = { world: createWorld(seed), structs: new Map() }));
  return w;
}

const bots = new Map(); // id -> bot
const noop = () => {};
// a line of chat (the admin commands: /admin, /give)
function say(ws, text) {
  const c = new Writer(64);
  c.u8(C2S.CHAT);
  c.str(text);
  ws.send(c.bytes());
}

function makeBot({ id, url, name }) {
  const b = {
    id,
    ws: null,
    joined: false,
    closed: false,
    err: '',
    pid: 0,
    w: null, // worldFor entry
    net: { tick: 0, ack: 0 },
    global: null,
    self: {},
    ents: new Map(),
    pred: createPlayerState(),
    pending: [],
    seq: 0,
    yaw: Math.random() * Math.PI * 2,
    synced: false,
    lastTick: 0,
    interval: 0,
    giveAt: 0,
    // the window's counters (sample resets them)
    bytes: 0,
    up: 0,
    snaps: 0,
    lastSnap: 0,
    maxGap: 0,
    slow: 0,
    syncs: 0,
    entErr: 0,
  };
  const store = {
    ents: b.ents,
    onCreate(e) {
      if (e.kind !== ENT.STRUCTURE || !b.w) return;
      let s = b.w.structs.get(e.id);
      if (s) return void s.refs++;
      const def = STRUCT_DEFS[e.stype];
      const x = e.q[0] / 64;
      const y = e.q[1] / 64;
      const z = e.q[2] / 64;
      let flags = COL.STRUCT;
      if (!def.block) flags |= COL.NOBLOCK;
      if (def.humanPass) flags |= COL.HUMANPASS;
      const col = makeBox(x, z, y - 0.3, y + def.sy, def.sx, def.sz, (e.rot8 / 256) * Math.PI * 2, flags, e.id);
      b.w.world.structGrid.add(col);
      b.w.structs.set(e.id, { col, refs: 1 });
    },
    onRemove(e) {
      if (e.kind !== ENT.STRUCTURE || !b.w) return;
      const s = b.w.structs.get(e.id);
      if (s && --s.refs <= 0) {
        b.w.world.structGrid.remove(s.col);
        b.w.structs.delete(e.id);
      }
    },
    onUpdate: noop,
  };
  const handler = new Proxy({}, { get: () => noop }); // every event is decoded and dropped

  const ws = (b.ws = new WebSocket(url));
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    ws.send(w.bytes());
  };
  ws.onmessage = (m) => {
    const buf = m.data;
    b.bytes += buf.byteLength;
    const r = new Reader(buf);
    const type = r.u8();
    if (type === S2C.WELCOME) {
      b.pid = r.u16();
      b.w = worldFor(r.u32());
      b.joined = true;
      if (process.env.ADMIN_SECRET) say(ws, `/admin ${process.env.ADMIN_SECRET}`); // (for /give: tick)
      b.interval = setInterval(() => tick(b), CMD_DT * 1000 * CMDS_PER_PACKET);
    } else if (type === S2C.REJECT) {
      b.err = `rejected ${r.u8()}`;
    } else if (type === S2C.WORLD_RESET) {
      b.w = worldFor(r.u32());
    } else if (type === S2C.SNAPSHOT) {
      const now = performance.now();
      if (b.lastSnap) {
        const gap = now - b.lastSnap;
        if (gap > b.maxGap) b.maxGap = gap;
        if (gap > GAP_SLOW) b.slow++;
      }
      b.lastSnap = now;
      b.snaps++;
      const flags = readHeader(r, b.net);
      b.lastTick = b.net.tick;
      const ack = b.net.ack;
      if (flags & SNAP.GLOBAL) b.global = readGlobal(r, b.global);
      const sync = readSelf(r, b.self, flags);
      try {
        readEntities(r, store, b.net.tick, flags);
        readEvents(r, handler, flags, b.ents);
      } catch (err) {
        b.entErr++;
        return;
      }
      while (b.pending.length && ((ack - b.pending[0].seq) & 0xffff) < 0x8000) b.pending.shift();
      if (sync) {
        b.syncs++;
        b.synced = true;
        copyPlayerState(b.pred, b.self);
        if (b.w) for (const p of b.pending) simulatePlayer(b.pred, p.cmd, b.w.world, null);
      }
    }
  };
  ws.onerror = () => {
    if (!b.err) b.err = 'socket error';
  };
  ws.onclose = () => {
    b.closed = true;
    clearInterval(b.interval);
  };
  return b;
}

function tick(b) {
  const ws = b.ws;
  if (!b.w || ws.readyState !== 1 || !b.synced) return;
  const pred = b.pred;
  const world = b.w.world;
  const night = b.global?.phase === PHASE.NIGHT;
  // at night: the nearest zombie standing (q[4] 7: a dead one)
  let target = null;
  if (night) {
    let bd = 1e9;
    for (const e of b.ents.values()) {
      if (e.kind !== ENT.ZOMBIE || e.q[4] === 7) continue;
      const d = Math.hypot(e.q[0] / 64 - pred.x, e.q[2] / 64 - pred.z);
      if (d < bd) {
        bd = d;
        target = { x: e.q[0] / 64, y: e.q[1] / 64, z: e.q[2] / 64, d };
      }
    }
    // ammo for the night (an admin command: stress.js gives the server an ADMIN_SECRET): a real team at night fires a
    // lot more than a starting kit holds
    const now = performance.now();
    if (now > b.giveAt) {
      b.giveAt = now + 30000;
      say(ws, '/give 70 250');
    }
  }
  const car = world.car;
  const w = new Writer(64);
  w.u8(C2S.INPUT);
  w.u16((b.lastTick - 2) & 0xffff);
  w.u8(128);
  const cmds = [];
  for (let k = 0; k < CMDS_PER_PACKET; k++) {
    let buttons = 0;
    let pitch = -0.05;
    let slot = 255;
    if (target) {
      b.yaw = Math.atan2(-(target.x - pred.x), -(target.z - pred.z));
      pitch = Math.atan2(target.y + 1.2 - (pred.y + 1.62), target.d);
      if (target.d > 18) buttons |= BTN.FWD;
      if (target.d < 25 && Math.random() < 0.5) buttons |= BTN.ATTACK;
      if (Math.random() < 0.01) buttons |= BTN.RELOAD;
      if (pred.slot !== 1 && pred.weapons?.[1]) slot = 1;
    } else {
      if (car && Math.hypot(pred.x - car.x, pred.z - car.z) > WANDER_MAX) b.yaw = Math.atan2(-(car.x - pred.x), -(car.z - pred.z)) + (Math.random() - 0.5) * 0.6;
      else if (Math.random() < 0.02) b.yaw += (Math.random() - 0.5) * 2;
      buttons = BTN.FWD;
      if (Math.random() < 0.3) buttons |= BTN.SPRINT;
      if (Math.random() < 0.02) buttons |= BTN.JUMP;
      if (Math.random() < 0.05) buttons |= BTN.ATTACK;
      if (Math.random() < 0.005) buttons |= BTN.RELOAD;
      slot = Math.random() < 0.005 ? (Math.random() < 0.5 ? 1 : 2) : 255;
    }
    b.seq = (b.seq + 1) & 0xffff;
    const qy = qangle16(b.yaw);
    const qp = qpitch(pitch);
    const cmd = { seq: b.seq, buttons, yaw: dqangle16(qy), pitch: dqpitch(qp), slot };
    simulatePlayer(pred, cmd, world, null);
    b.pending.push({ seq: b.seq, cmd });
    if (b.pending.length > 120) b.pending.shift();
    cmds.push({ seq: b.seq, buttons, qyaw: qy, qpitch: qp, slot });
  }
  writeInput(w, cmds, hashPlayerState(pred));
  b.up += w.o;
  ws.send(w.bytes());
  // now and then a barricade where it stands (what a team does at night: structures the horde then attacks)
  if (Math.random() < (night ? 0.004 : 0.001)) {
    const a = new Writer(16);
    a.u8(C2S.ACTION);
    a.u8(ACT.BUILD);
    a.u8(1);
    a.i16(Math.round((pred.x - Math.sin(pred.yaw) * 3) * 64));
    a.i16(Math.round((pred.z - Math.cos(pred.yaw) * 3) * 64));
    a.u8(Math.floor(Math.random() * 256));
    b.up += a.o;
    ws.send(a.bytes());
  }
}

// ---------------------------------------------------------------- what this thread costs
let cpuAt = process.threadCpuUsage();
let eluAt = performance.eventLoopUtilization();
let sampleAt = performance.now();

parentPort.on('message', (m) => {
  if (m.t === 'spawn') {
    // a little apart, so a step's joins do not all land in one tick
    m.bots.forEach((spec, i) => setTimeout(() => bots.set(spec.id, makeBot(spec)), i * 25));
  } else if (m.t === 'sample') {
    const now = performance.now();
    const secs = (now - sampleAt) / 1000;
    const cpu = process.threadCpuUsage(cpuAt);
    const elu = performance.eventLoopUtilization(eluAt);
    cpuAt = process.threadCpuUsage();
    eluAt = performance.eventLoopUtilization();
    sampleAt = now;
    const out = [];
    for (const b of bots.values()) {
      out.push({ id: b.id, joined: b.joined, closed: b.closed, err: b.err, bytesPerS: b.bytes / secs, upPerS: b.up / secs, snapsPerS: b.snaps / secs, maxGapMs: b.maxGap, slow: b.slow, syncs: b.syncs, entErr: b.entErr, phase: b.global?.phase ?? -1, day: b.global?.day ?? 0, zombiesSeen: [...b.ents.values()].filter((e) => e.kind === ENT.ZOMBIE).length });
      b.bytes = b.up = b.snaps = b.maxGap = b.slow = b.syncs = 0;
    }
    parentPort.postMessage({ t: 'sample', secs, cpuMs: (cpu.user + cpu.system) / 1000 / secs, elu: elu.utilization, bots: out });
  } else if (m.t === 'stop') {
    for (const b of bots.values()) {
      clearInterval(b.interval);
      try {
        b.ws.close();
      } catch {}
    }
    bots.clear();
    worlds.clear();
    parentPort.postMessage({ t: 'stopped' });
  }
});
