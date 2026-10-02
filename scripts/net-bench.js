// Network traffic benchmark: node scripts/net-bench.js [--players 4] [--seed 4242] [--day 3] [--json out.json] [--deflate] [--root dir]
// Runs the real server in-process against simulated clients that use the real client encoder (Connection), the real
// prediction (Prediction) and the real snapshot decoder, through a scripted session: join, standing around by day,
// roaming by day, then a night of fighting the horde. Everything is seeded and the bots steer from server truth, so
// two runs produce the same simulation and the byte counts can be compared exactly between protocol versions.
// Reports, per phase and per client: messages, packets and payload bytes per second in both directions, where the
// snapshot bytes go (header / global / self / entity removes, creates, updates / events) and an on-the-wire estimate
// (payload + WebSocket frame header + 40 B of TCP/IPv4 per packet; sends corked together count as one packet).
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? def : argv[i + 1];
};
const ROOT = resolve(arg('root', join(dirname(fileURLToPath(import.meta.url)), '..')));
const SEED = +arg('seed', 4242);
const PLAYERS = +arg('players', 4);
const JSON_OUT = arg('json', '');
const DAY = +arg('day', 3); // the night that gets fought (later nights bring a bigger horde)
const DEFLATE = argv.includes('--deflate');
const MORTAL = argv.includes('--mortal'); // survivors take damage (they get knocked about, go down, die and turn)
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const { Game } = await imp('server/game.js');
const { C2S, S2C, SNAP, ACT, ENT, PROTOCOL_VERSION, Writer, Reader } = await imp('shared/protocol.js');
const { BTN, PHASE, SERVER_TICK_RATE, INTERP_DELAY } = await imp('shared/constants.js');
const { ITEM, WEAPONS, AMMO_ITEMS, AMMO_MAX, STRUCT_DEFS } = await imp('shared/defs.js');
const decode = await imp('client/net/decode.js');
const { Connection } = await imp('client/net/connection.js');
const { Prediction } = await imp('client/game/prediction.js');
const { createWorld } = await imp('shared/world.js');
const { makeBox, COL } = await imp('shared/collision.js');

const TR = SERVER_TICK_RATE;
const FRAMES_PER_TICK = 60 / TR;
const DT = 1 / 60;
// [name, seconds]
const PHASES = [
  ['join', 2],
  ['day-idle', 30],
  ['day-roam', 90],
  ['night-fight', 150],
];

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// (themes off: the night fought is the plain blend whatever the seed, so runs stay comparable)
const game = new Game({ seed: SEED, godMode: !MORTAL, startDay: DAY, maxPlayers: Math.max(8, PLAYERS), themes: false, log: () => {} });
let phaseName = 'join';

const KIND_NAME = {};
for (const k in ENT) KIND_NAME[ENT[k]] = k.toLowerCase();
const newStats = () => ({
  s2c: { msgs: 0, packets: 0, bytes: 0, frame: 0, sec: {}, snaps: 0, snapBytes: 0, snapMax: 0, sizes: [] },
  c2s: { msgs: 0, bytes: 0, frame: 0, type: {} },
  sync: { snaps: 0, rebases: 0, checks: 0, off: 0, maxErr: 0 },
  upd: {}, // kind -> {n, bytes}
  cre: {},
  events: {}, // name -> {n, bytes}
  zmask: {}, // zombie update masks
  zband: { near: 0, mid: 0, far: 0 },
});
const add = (o, k, v) => (o[k] = (o[k] || 0) + v);
const addNB = (o, k, bytes) => {
  const t = o[k] || (o[k] = { n: 0, bytes: 0 });
  t.n++;
  t.bytes += bytes;
};

function makeClient(idx) {
  const c = {
    idx,
    name: `bot${idx}`,
    id: 0,
    rng: mulberry(SEED * 31 + idx * 977 + 5),
    self: {},
    global: null,
    world: null,
    pred: null,
    latestTick: 0,
    net: { tick: 0, ack: 0 },
    yaw: 0,
    pitch: 0,
    wp: null,
    wpT: 0,
    stuckT: 0,
    stuckX: 0,
    stuckZ: 0,
    evadeT: 0,
    evadeYaw: 0,
    frames: 0,
    stats: {},
    cork: 0,
    corkSent: false,
    log: [], // every S2C message (for the deflate what-if)
  };
  const st = () => c.stats[phaseName] || (c.stats[phaseName] = newStats());
  const ents = new Map();
  let rd = null; // reader of the snapshot being decoded
  let lastO = 0;
  const take = () => {
    const n = rd.o - lastO;
    lastO = rd.o;
    return n;
  };
  c.store = {
    ents,
    onCreate(e) {
      const n = take();
      add(st().s2c.sec, 'ent.creates', n);
      addNB(st().cre, KIND_NAME[e.kind], n);
      if (e.kind === ENT.STRUCTURE && c.world) {
        const def = STRUCT_DEFS[e.stype];
        const x = e.q[0] / 64;
        const y = e.q[1] / 64;
        const z = e.q[2] / 64;
        let flags = COL.STRUCT;
        if (!def.block) flags |= COL.NOBLOCK;
        if (def.humanPass) flags |= COL.HUMANPASS;
        e.col = makeBox(x, z, y - 0.3, y + def.sy, def.sx, def.sz, (e.rot8 / 256) * Math.PI * 2, flags, e.id);
        c.world.structGrid.add(e.col);
      }
    },
    onRemove(e) {
      add(st().s2c.sec, 'ent.removes', take());
      if (e.col) c.world.structGrid.remove(e.col);
    },
    onUpdate(e, mask) {
      const n = take();
      add(st().s2c.sec, 'ent.updates', n);
      addNB(st().upd, KIND_NAME[e.kind], n);
      if (e.kind === ENT.ZOMBIE) {
        add(st().zmask, mask, 1);
        const d = Math.hypot(e.q[0] / 64 - c.self.x, e.q[2] / 64 - c.self.z);
        st().zband[d < 45 ? 'near' : d < 80 ? 'mid' : 'far']++;
      }
    },
  };
  const evHandler = new Proxy(
    {},
    {
      get: (_, name) => () => {
        const n = take();
        addNB(st().events, name, n);
        add(st().s2c.sec, 'events', n);
      },
    },
  );

  function onSnapshot(r, len) {
    const s = st().s2c;
    const sec = s.sec;
    s.snaps++;
    s.snapBytes += len;
    s.sizes.push(len);
    if (len > s.snapMax) s.snapMax = len;
    rd = r;
    lastO = 0;
    let tick;
    let ack;
    let flags = 0;
    let sync = true;
    if (decode.readHeader) {
      flags = decode.readHeader(r, c.net);
      tick = c.net.tick;
      ack = c.net.ack;
      add(sec, 'header', take());
      if (flags & SNAP.GLOBAL) {
        c.global = decode.readGlobal(r, c.global);
        add(sec, 'global', take());
      }
      sync = decode.readSelf(r, c.self, flags);
    } else {
      // the protocol before the header got flags: every section always present
      tick = r.u32();
      ack = r.u16();
      const g = r.u8();
      add(sec, 'header', take());
      if (g) {
        c.global = decode.readGlobal(r);
        add(sec, 'global', take());
      }
      decode.readSelf(r, c.self);
    }
    add(sec, 'self', take());
    decode.readEntities(r, c.store, tick, flags);
    add(sec, 'ent.counts', take());
    c.latestTick = tick;
    if (sync) c.pred.reconcile(ack, c.self);
    else c.pred.confirm(ack);
    decode.readEvents(r, evHandler, flags, ents);
    add(sec, 'events', take());
    if (r.left !== 0) throw new Error(`${c.name}: ${r.left} trailing bytes in snapshot (tick ${tick})`);
    // is the client where the server is? (only comparable once every command it issued has been acked)
    const y = st().sync;
    y.snaps++;
    if (sync) y.rebases++;
    const p = game.players.get(c.id);
    if (p && p.alive && c.pred.pending.length === 0) {
      const a = c.pred.state;
      const b = p.state;
      const err = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z), Math.abs(a.vx - b.vx), Math.abs(a.vz - b.vz), Math.abs(a.stamina - b.stamina), Math.abs(a.cooldown - b.cooldown), a.mags[0] !== b.mags[0] || a.mags[1] !== b.mags[1] || a.slot !== b.slot ? 1 : 0);
      y.checks++;
      if (err > 1e-3) y.off++;
      if (err > y.maxErr) y.maxErr = err;
    }
  }

  // server side of the socket
  const sconn = {
    ip: 'bench',
    send(bytes) {
      const buf = bytes.slice();
      const len = buf.byteLength;
      const s = st().s2c;
      s.msgs++;
      s.bytes += len;
      s.frame += len < 126 ? 2 : 4;
      if (c.cork) c.corkSent = true;
      else s.packets++;
      if (DEFLATE) c.log.push([phaseName, buf]);
      const r = new Reader(buf);
      const t = r.u8();
      if (t === S2C.WELCOME) {
        c.id = r.u16();
        const seed = r.u32();
        c.world = createWorld(seed);
        c.pred = new Prediction(c.world);
        add(s.sec, 'welcome', len);
      } else if (t === S2C.SNAPSHOT) onSnapshot(r, len);
      else if (t === S2C.WORLD_RESET) {
        // a new playthrough on a new map
        c.world = createWorld(r.u32());
        c.pred.setWorld(c.world);
        add(s.sec, 'msg.other', len);
      }
      else if (t === S2C.INVENTORY) add(s.sec, 'msg.inventory', len);
      else if (t === S2C.PLAYERS) add(s.sec, 'msg.players', len);
      else if (t === S2C.CHAT) add(s.sec, 'msg.chat', len);
      else if (t === S2C.PONG) add(s.sec, 'msg.pong', len);
      else add(s.sec, 'msg.other', len);
    },
    cork(fn) {
      c.cork++;
      try {
        fn();
      } finally {
        if (--c.cork === 0 && c.corkSent) {
          c.corkSent = false;
          st().s2c.packets++;
        }
      }
    },
  };
  c.session = game.onOpen(sconn);

  // client side of the socket: the real Connection with a fake WebSocket
  const TYPE_NAME = {};
  for (const k in C2S) TYPE_NAME[C2S[k]] = k.toLowerCase();
  c.conn = new Connection({});
  c.conn.open = true;
  c.conn.ws = {
    readyState: 1,
    send(bytes) {
      const buf = bytes.slice();
      const s = st().c2s;
      s.msgs++;
      s.bytes += buf.byteLength;
      s.frame += buf.byteLength < 126 ? 6 : 8;
      addNB(s.type, TYPE_NAME[buf[0]] || 'other', buf.byteLength);
      game.onMessage(c.session, buf);
    },
    close() {},
  };
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(c.name);
  c.conn.ws.send(w.bytes());
  return c;
}

// ---------------------------------------------------------------- bot brains (steer from server truth, seeded)
const zones = game.world.zones;
const car = game.world.car;
const GUNS = [ITEM.AK47, ITEM.M4A1, ITEM.SHOTGUN, ITEM.MP5];

function steer(c, tx, tz, rate) {
  const s = game.players.get(c.id).state;
  const want = Math.atan2(-(tx - s.x), -(tz - s.z));
  const d = wrapPi(want - c.yaw);
  c.yaw += clamp(d, -rate * DT, rate * DT);
  return Math.abs(d);
}

function think(c, frameNo) {
  const p = game.players.get(c.id);
  const s = p.state;
  const t = frameNo * DT;
  let buttons = 0;
  if (phaseName === 'join' || phaseName === 'day-idle') return 0; // hands off the keyboard
  if (phaseName === 'day-roam') {
    // two groups wander between places, looking around as they go
    const grp = c.idx % 2;
    if (!c.wp || Math.hypot(c.wp.x - s.x, c.wp.z - s.z) < 8 || t > c.wpT) {
      let best = null;
      let bd = 1e9;
      for (const zn of zones) {
        if (zn === c.wp || (c.seen && c.seen.has(zn))) continue;
        const d = Math.hypot(zn.x - s.x, zn.z - s.z) + ((zn.id * 37 + grp * 101) % 60);
        if (d < bd) {
          bd = d;
          best = zn;
        }
      }
      c.seen = c.seen || new Set();
      if (best) c.seen.add(best);
      else c.seen.clear();
      c.wp = best || zones[(c.idx * 5) % zones.length];
      c.wpT = t + 45;
    }
    if (c.evadeT > t) {
      c.yaw += wrapPi(c.evadeYaw - c.yaw) * 0.1;
      buttons |= BTN.FWD;
      if (((frameNo / 30) | 0) % 2 === 0) buttons |= BTN.JUMP;
    } else {
      const off = Math.sin(t * 1.3 + c.idx) * 0.35; // head on a swivel
      const want = Math.atan2(-(c.wp.x - s.x), -(c.wp.z - s.z)) + off;
      c.yaw += clamp(wrapPi(want - c.yaw), -3 * DT, 3 * DT) + (c.rng() - 0.5) * 0.003;
      c.pitch = clamp(c.pitch + (Math.sin(t * 0.7 + c.idx * 2) * 0.12 - c.pitch) * 0.05, -1, 1);
      buttons |= BTN.FWD;
      if ((((t + c.idx * 3) / 6) | 0) % 2 === 0) buttons |= BTN.SPRINT;
      if (c.rng() < 1 / 500) buttons |= BTN.JUMP;
      // every so often they stop and take a look around
      if ((((t + c.idx * 7) / 20) | 0) % 4 === 3) buttons = 0;
    }
    // walked into something: turn away for a moment
    if (frameNo % 120 === 0) {
      if (Math.hypot(s.x - c.stuckX, s.z - c.stuckZ) < 0.8 && buttons & BTN.FWD) {
        c.evadeT = t + 1.5;
        c.evadeYaw = c.yaw + (c.rng() < 0.5 ? 1.6 : -1.6);
      }
      c.stuckX = s.x;
      c.stuckZ = s.z;
    }
    return buttons;
  }
  // night: fall back to the car and fight what comes
  let tgt = null;
  let bd = 45 * 45;
  for (const z of game.zombies) {
    if (z.dead || z.removed) continue;
    const dx = z.x - s.x;
    const dz = z.z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) {
      bd = d2;
      tgt = z;
    }
  }
  const dCar = Math.hypot(car.x - s.x, car.z - s.z);
  const home = { x: car.x + Math.sin(c.idx * 1.7) * 7, z: car.z + Math.cos(c.idx * 1.7) * 7 };
  if (tgt) {
    const d = Math.sqrt(bd);
    const err = steer(c, tgt.x, tgt.z, 5);
    c.yaw += (c.rng() - 0.5) * 0.004;
    const wantPitch = Math.atan2(tgt.y + 1.1 - (s.y + 1.62), Math.max(0.5, d));
    c.pitch += clamp(wantPitch - c.pitch, -3 * DT, 3 * DT);
    const w = WEAPONS[s.weapons[s.slot]];
    const mag = s.slot === 0 ? s.mags[0] : s.slot === 1 ? s.mags[1] : 1;
    if (w && !w.melee && mag === 0) {
      if (frameNo % 6 < 3) buttons |= BTN.RELOAD;
    } else if (err < 0.06 && d < (w?.range || 2) * 0.6) {
      if (w?.auto || frameNo % 8 < 4) buttons |= BTN.ATTACK;
    }
    if (d < 5) buttons |= BTN.BACK;
    else if (dCar > 30) buttons |= BTN.FWD;
    buttons |= (((t + c.idx) / 1.5) | 0) % 2 ? BTN.LEFT : BTN.RIGHT;
  } else if (dCar > 12) {
    steer(c, home.x, home.z, 4);
    c.pitch *= 0.95;
    buttons |= BTN.FWD | BTN.SPRINT;
  } else {
    c.yaw += Math.sin(t * 0.5 + c.idx) * 0.01; // scanning the dark
  }
  return buttons;
}

function frame(c, frameNo, tickFrac) {
  if (!c.pred) return;
  const p = game.players.get(c.id);
  if (!p) return;
  const buttons = think(c, frameNo);
  c.pred.step(DT, c.self.alive ? buttons : 0, c.yaw, c.pitch, () => {});
  const rt = c.latestTick + tickFrac - INTERP_DELAY * TR;
  const rti = Math.floor(rt);
  // the client pings every 2 s: of simulated time here, so the wall-clock timer is driven by hand
  if (frameNo % 120 === 60 + c.idx) c.pingDue = true;
  if (decode.readHeader) {
    for (let out; (out = c.pred.takeOutbox(DT)); ) {
      c.conn.pingNext = c.pingDue ? 0 : Infinity;
      c.pingDue = false;
      c.conn.sendInput(rti, rt - rti, out, c.pred.hash(out));
    }
  } else {
    // the protocol before: 2 commands per packet, a ping message of its own
    const out = c.pred.takeOutbox();
    if (out) c.conn.sendInput(rti, rt - rti, out);
    if (c.pingDue) c.conn.ping();
    c.pingDue = false;
  }
}

// ---------------------------------------------------------------- run
const clients = [];
for (let i = 0; i < PLAYERS; i++) clients.push(makeClient(i));
for (const c of clients) {
  const p = game.players.get(c.id);
  c.yaw = p.state.yaw;
}

const checksums = {};
const checksum = () => {
  let h = 0;
  for (const p of game.players.values()) h = (Math.imul(h, 31) + Math.round(p.state.x * 1000) + Math.round(p.state.z * 1000) * 7 + p.lastSeq) | 0;
  for (const z of game.zombies) h = (Math.imul(h, 31) + Math.round(z.x * 1000) + Math.round(z.z * 1000) * 7 + z.id) | 0;
  return `${(h >>> 0).toString(16)}/z${game.zombies.length}/e${game.all.length}`;
};

let frameNo = 0;
const t0 = performance.now();
for (const [name, secs] of PHASES) {
  phaseName = name;
  if (name === 'night-fight') {
    if (game.phase === PHASE.DAY) game.timeLeft = 0.05;
    clients.forEach((c, i) => {
      const p = game.players.get(c.id);
      const gun = GUNS[i % GUNS.length];
      game.giveItem(p, gun, 1);
      c.pred.requestSlot(0);
      c.conn.action(ACT.FLASHLIGHT, 1);
    });
  }
  for (let k = 0; k < secs * TR; k++) {
    if (name === 'night-fight' && k % (20 * TR) === 0) {
      for (const c of clients) {
        const p = game.players.get(c.id);
        AMMO_ITEMS.forEach((it, cal) => game.giveItem(p, it, AMMO_MAX[cal] - p.state.ammo[cal])); // (a full stack of each)
      }
    }
    for (let f = 0; f < FRAMES_PER_TICK; f++) {
      for (const c of clients) frame(c, frameNo, f / FRAMES_PER_TICK);
      frameNo++;
    }
    game.update();
  }
  checksums[name] = checksum();
}
const wallMs = performance.now() - t0;

// ---------------------------------------------------------------- report
const IP_TCP = 40;
const result = { root: ROOT, seed: SEED, players: PLAYERS, day: DAY, mortal: MORTAL, protocol: PROTOCOL_VERSION, checksums, corrections: clients.map((c) => c.pred.corrections), phases: {} };
const fmt = (v, d = 0) => v.toFixed(d).padStart(8);
console.log(`net-bench  root=${ROOT}\n  protocol v${PROTOCOL_VERSION}, seed ${SEED}, ${PLAYERS} players, night ${DAY}${MORTAL ? ', mortal' : ''}, ${frameNo / 60 | 0} s simulated in ${(wallMs / 1000).toFixed(1)} s, server tick avg ${game.stats.tickMs.toFixed(2)} ms`);
console.log(`  sim checksums: ${Object.entries(checksums).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log(`  prediction corrections per client: ${result.corrections.join(', ')}`);
for (const [name, secs] of PHASES) {
  const agg = newStats();
  const merge = (dst, src) => {
    for (const k in src) {
      const v = src[k];
      if (Array.isArray(v)) (dst[k] = dst[k] || []).push(...v);
      else if (typeof v === 'number') dst[k] = k === 'snapMax' ? Math.max(dst[k] || 0, v) : (dst[k] || 0) + v;
      else merge(dst[k] || (dst[k] = {}), v);
    }
  };
  for (const c of clients) if (c.stats[name]) merge(agg, c.stats[name]);
  const per = 1 / (secs * PLAYERS); // -> per client per second
  const s = agg.s2c;
  const u = agg.c2s;
  const sizes = s.sizes.sort((a, b) => a - b);
  const p95 = sizes[Math.floor(sizes.length * 0.95)] || 0;
  const down = { msgs: s.msgs * per, packets: s.packets * per, payload: s.bytes * per, wire: (s.bytes + s.frame + s.packets * IP_TCP) * per, snapAvg: s.snapBytes / Math.max(1, s.snaps), snapP95: p95, snapMax: s.snapMax };
  const up = { msgs: u.msgs * per, packets: u.msgs * per, payload: u.bytes * per, wire: (u.bytes + u.frame + u.msgs * IP_TCP) * per };
  const sec = {};
  for (const k of Object.keys(s.sec).sort()) sec[k] = s.sec[k] * per;
  const upd = {};
  for (const k in agg.upd) upd[k] = { perSec: agg.upd[k].n * per, bytesPerSec: agg.upd[k].bytes * per, avg: agg.upd[k].bytes / agg.upd[k].n };
  const cre = {};
  for (const k in agg.cre) cre[k] = { perSec: agg.cre[k].n * per, bytesPerSec: agg.cre[k].bytes * per };
  const events = {};
  for (const k in agg.events) events[k] = { perSec: agg.events[k].n * per, bytesPerSec: agg.events[k].bytes * per };
  const c2sType = {};
  for (const k in u.type) c2sType[k] = { perSec: u.type[k].n * per, bytesPerSec: u.type[k].bytes * per };
  const y = agg.sync;
  result.phases[name] = { secs, down, up, sec, upd, cre, events, c2sType, zband: agg.zband, zmask: agg.zmask, sync: y };
  if (name === 'join') {
    console.log(`\n== ${name} (${secs} s): ${fmt((s.bytes / PLAYERS) | 0)} B down per client in total (world state burst), ${fmt((u.bytes / PLAYERS) | 0)} B up`);
    continue;
  }
  console.log(`\n== ${name} (${secs} s)   per client, per second`);
  console.log(`  down: ${fmt(down.msgs, 1)} msgs ${fmt(down.packets, 1)} pkts ${fmt(down.payload)} B payload ${fmt(down.wire)} B wire   snapshot avg ${down.snapAvg.toFixed(0)} B, p95 ${p95}, max ${s.snapMax}`);
  console.log(`  up:   ${fmt(up.msgs, 1)} msgs ${fmt(up.packets, 1)} pkts ${fmt(up.payload)} B payload ${fmt(up.wire)} B wire`);
  console.log(`  total wire ${fmt(down.wire + up.wire)} B/s, ${fmt(down.packets + up.packets, 1)} pkts/s`);
  console.log(`  down payload by section (B/s): ${Object.entries(sec).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}`);
  console.log(`  entity updates: ${Object.entries(upd).map(([k, v]) => `${k} ${v.perSec.toFixed(1)}/s ${v.bytesPerSec.toFixed(0)} B/s (${v.avg.toFixed(1)} B each)`).join(', ') || '-'}`);
  console.log(`  entity creates: ${Object.entries(cre).map(([k, v]) => `${k} ${v.perSec.toFixed(2)}/s ${v.bytesPerSec.toFixed(0)} B/s`).join(', ') || '-'}`);
  console.log(`  events: ${Object.entries(events).map(([k, v]) => `${k} ${v.perSec.toFixed(1)}/s ${v.bytesPerSec.toFixed(0)} B/s`).join(', ') || '-'}`);
  console.log(`  up by type: ${Object.entries(c2sType).map(([k, v]) => `${k} ${v.perSec.toFixed(1)}/s ${v.bytesPerSec.toFixed(0)} B/s`).join(', ')}`);
  console.log(`  own state: rebased in ${y.rebases} of ${y.snaps} snapshots (${((y.rebases / Math.max(1, y.snaps)) * 100).toFixed(1)}%); prediction vs server at ${y.checks} fully-acked snapshots: max error ${y.maxErr.toExponential(1)}, off by > 1 mm: ${y.off}`);
  const zb = agg.zband;
  const zt = zb.near + zb.mid + zb.far;
  if (zt) console.log(`  zombie updates by distance: <45 m ${((zb.near / zt) * 100).toFixed(0)}%, 45-80 m ${((zb.mid / zt) * 100).toFixed(0)}%, >80 m ${((zb.far / zt) * 100).toFixed(0)}%`);
}

// what permessage-deflate would do to the downstream (one compressor per client, context kept between messages)
if (DEFLATE) {
  const run = (c, opts) =>
    new Promise((res) => {
      const z = zlib.createDeflateRaw(opts);
      const out = {};
      let cur = '';
      z.on('data', (d) => (out[cur] = (out[cur] || 0) + d.length));
      let i = 0;
      const next = () => {
        if (i >= c.log.length) return res(out);
        const [ph, buf] = c.log[i++];
        cur = ph;
        z.write(buf);
        z.flush(zlib.constants.Z_SYNC_FLUSH, () => {
          out[ph] -= 4; // permessage-deflate strips the 00 00 ff ff tail
          next();
        });
      };
      next();
    });
  for (const [label, opts] of [
    ['deflate 4 KB window', { windowBits: 12, memLevel: 5, level: 6 }],
    ['deflate 32 KB window', { windowBits: 15, memLevel: 8, level: 6 }],
  ]) {
    const tot = {};
    for (const c of clients) {
      const o = await run(c, opts);
      for (const k in o) tot[k] = (tot[k] || 0) + o[k];
    }
    result[label] = {};
    console.log(`\n  what-if ${label}: ${PHASES.filter(([n]) => n !== 'join').map(([n, secs]) => {
      const v = tot[n] / (secs * PLAYERS);
      result[label][n] = v;
      return `${n} ${v.toFixed(0)} B/s payload (${((v / result.phases[n].down.payload) * 100).toFixed(0)}% of raw)`;
    }).join(', ')}`);
  }
}

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 1));
