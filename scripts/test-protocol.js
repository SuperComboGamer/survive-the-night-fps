// Fuzz test: server delta encoder vs client decoder for every entity kind, including removals,
// id reuse with new generations, LOD skipping and large/small position deltas, for several clients a tick off
// one staging of the entities (each must get what quantizing for it alone would give; one that is skipped for a
// tick catches up); then the varints and the command packets (writeInput / readInput).
import { Writer, Reader, ENT, MAX_CMDS, POS_SCALE, qpos, qangle8, qlookYaw, qlookPitch, writeInput, readInput } from '../shared/protocol.js';
import { ClientView, writeEntities, stageEntities, playerFlags } from '../server/snapshot.js';
import { readEntities } from '../client/net/decode.js';
import { createPlayerState, snapPlayerState } from '../shared/playersim.js';
import { LOD_NEAR } from '../shared/constants.js';
import { PROJ } from '../shared/defs.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));
let gen = 1;
const ents = new Map();
const freeIds = [];
const VIEWERS = 3;
let nextId = VIEWERS + 1;

function makeViewer(id) {
  const p = { kind: ENT.PLAYER, id, gen: gen++, state: createPlayerState(), hp: 100, maxHp: 100, alive: true, zombie: false, flashlight: false, removed: false, viewer: true };
  p.state.x = 0;
  p.state.z = 0;
  Object.defineProperty(p, 'x', { get: () => p.state.x });
  Object.defineProperty(p, 'y', { get: () => p.state.y });
  Object.defineProperty(p, 'z', { get: () => p.state.z });
  return p;
}

function spawn(kind) {
  const id = freeIds.length && Math.random() < 0.5 ? freeIds.pop() : nextId++;
  const e = { kind, id, gen: gen++, removed: false, x: rnd(-100, 100), y: rnd(-5, 20), z: rnd(-100, 100) };
  switch (kind) {
    case ENT.PLAYER:
      e.state = createPlayerState();
      e.state.yaw = rnd(0, 6.28);
      e.hp = 100;
      e.maxHp = 100;
      e.alive = true;
      e.zombie = false;
      e.flashlight = false;
      Object.defineProperty(e, 'x', { get: () => e.state.x, set: (v) => (e.state.x = v) });
      Object.defineProperty(e, 'y', { get: () => e.state.y, set: (v) => (e.state.y = v) });
      Object.defineProperty(e, 'z', { get: () => e.state.z, set: (v) => (e.state.z = v) });
      e.state.x = rnd(-50, 50);
      e.state.z = rnd(-50, 50);
      break;
    case ENT.ZOMBIE:
      e.ztype = irnd(0, 11);
      e.variant = irnd(0, 255);
      e.yaw = rnd(0, 6.28);
      e.anim = irnd(0, 10);
      e.hp = 100;
      e.maxHp = 100;
      e.link = 0;
      e.legs = 0;
      e.burnT = 0;
      break;
    case ENT.ITEM:
      e.item = irnd(1, 84);
      e.count = irnd(1, 60);
      break;
    case ENT.STRUCTURE:
      e.stype = irnd(1, 10);
      e.rot8 = irnd(0, 255);
      e.hp = 500;
      e.maxHp = 500;
      e.state = 1;
      break;
    case ENT.PROJECTILE:
      e.ptype = irnd(1, 9);
      e.owner = irnd(0, 500);
      if (e.ptype === PROJ.SKYFLARE) {
        e.t = rnd(0, 60);
        e.flare = { tOpen: rnd(1, 4.3) };
      }
      break;
    case ENT.CRATE:
      e.state = 0;
      break;
    case ENT.AREA:
      e.atype = irnd(1, 2);
      e.radius = rnd(1, 6);
      break;
    case ENT.CACHE:
      e.ctype = irnd(1, 11);
      e.state = 0;
      break;
    case ENT.CAT:
      e.variant = irnd(0, 4);
      e.yaw = rnd(0, 6.28);
      e.anim = irnd(0, 3);
      break;
    case ENT.DEER:
      e.variant = irnd(0, 255);
      e.yaw = rnd(0, 6.28);
      e.anim = irnd(0, 8);
      break;
    case ENT.FAIR:
      e.running = 0;
      e.clock = irnd(0, 0xffffff);
      e.fuel = irnd(0, 0xffff);
      break;
  }
  ents.set(e.id, e);
  return e;
}

function expectQ(e) {
  const q = [qpos(e.x), qpos(e.y), qpos(e.z)];
  switch (e.kind) {
    case ENT.PLAYER:
      q.push(qlookYaw(e.state.yaw), qlookPitch(e.state.pitch), playerFlags(e), e.zombie ? 0 : e.state.weapons[e.state.slot] || 0, Math.max(0, Math.min(255, Math.ceil((e.hp / e.maxHp) * 255))), e.state.fireCount & 255);
      break;
    case ENT.ZOMBIE:
      q.push(qangle8(e.yaw), e.anim, Math.max(0, Math.min(255, Math.ceil((e.hp / e.maxHp) * 255))), e.link, e.legs | 0, e.burnT > 0 ? 1 : 0);
      break;
    case ENT.ITEM:
      q.push(e.count);
      break;
    case ENT.STRUCTURE:
      q.push(Math.max(0, Math.min(255, Math.ceil((e.hp / e.maxHp) * 255))), e.state);
      break;
    case ENT.CRATE:
    case ENT.CACHE:
      q.push(e.state);
      break;
    case ENT.CAT:
    case ENT.DEER:
      q.push(qangle8(e.yaw), e.anim);
      break;
    case ENT.FAIR:
      q.push(e.running, e.clock & 255, (e.clock >> 8) & 255, e.clock >> 16, e.fuel & 255, e.fuel >> 8);
      break;
  }
  return q;
}

// the clients: each a player the others see, with its own baseline and its own decoder
const viewers = [];
for (let i = 0; i < VIEWERS; i++) {
  const p = makeViewer(i + 1);
  ents.set(p.id, p);
  viewers.push({ p, view: new ClientView(), store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} } });
}
const w = new Writer(1024);
let bytes = 0;
let snaps = 0;
let skips = 0;
let rounded = 0;
const kinds = [ENT.PLAYER, ENT.ZOMBIE, ENT.ITEM, ENT.STRUCTURE, ENT.PROJECTILE, ENT.CRATE, ENT.AREA, ENT.CACHE, ENT.CAT, ENT.DEER, ENT.FAIR];
for (let i = 0; i < 80; i++) spawn(kinds[irnd(0, kinds.length - 1)]);
let checks = 0;
const TICKS = 3000;
for (let tick = 1; tick <= TICKS; tick++) {
  // mutate
  for (const e of ents.values()) {
    if (!e.viewer && Math.random() < 0.3) {
      // every position encoding: a few cm on the flat (1 byte), a step (2 bytes), a leap (3) and a teleport (absolute)
      const big = Math.random() < 0.05;
      const tiny = Math.random() < 0.3;
      const step = tiny ? 0.1 : Math.random() < 0.5 ? 0.45 : 1.9;
      e.x += big ? rnd(-30, 30) : rnd(-step, step);
      e.z += big ? rnd(-30, 30) : rnd(-step, step);
      if (!tiny) e.y += rnd(-0.3, 0.3);
    }
    if (e.kind === ENT.ZOMBIE && Math.random() < 0.2) {
      e.anim = irnd(0, 10);
      e.yaw = rnd(0, 6.28);
      e.hp = Math.max(0, e.hp - rnd(0, 10));
      e.link = Math.random() < 0.1 ? irnd(1, 60000) : 0;
      if (Math.random() < 0.15) e.legs |= irnd(1, 2); // a leg shot off: it does not grow back
      e.burnT = Math.random() < 0.3 ? 3 : 0; // set alight / gone out
    }
    if (e.kind === ENT.PLAYER && Math.random() < 0.3) {
      e.state.yaw = rnd(0, 6.28);
      e.state.pitch = rnd(-1.5, 1.5);
      e.state.fireCount = (e.state.fireCount + 1) & 255;
      e.flashlight = Math.random() < 0.5;
      e.downed = Math.random() < 0.2;
      e.revivedBy = Math.random() < 0.1 ? 5 : 0;
      e.state.slot = irnd(0, 2);
      e.state.ride = Math.random() < 0.3 ? irnd(1, 16) : 0; // onto a ride at the fair, off it
    }
    if (e.kind === ENT.ITEM && Math.random() < 0.05) e.count = irnd(1, 900);
    if (e.kind === ENT.STRUCTURE && Math.random() < 0.1) {
      e.hp = rnd(0, 500);
      e.state = irnd(0, 1);
    }
    if (e.kind === ENT.CRATE && Math.random() < 0.05) e.state = irnd(0, 3);
    if (e.kind === ENT.CACHE && Math.random() < 0.05) e.state = irnd(0, 1);
    if (e.kind === ENT.CAT && Math.random() < 0.2) {
      e.yaw = rnd(0, 6.28);
      e.anim = irnd(0, 3);
    }
    if (e.kind === ENT.DEER && Math.random() < 0.2) {
      e.yaw = rnd(0, 6.28);
      e.anim = irnd(0, 8);
    }
    if (e.kind === ENT.FAIR && Math.random() < 0.1) {
      e.running = irnd(0, 1);
      e.clock = irnd(0, 0xffffff);
      if (Math.random() < 0.5) e.fuel = irnd(0, 0xffff);
    }
  }
  // viewers move around (relevance changes)
  for (const { p } of viewers) {
    p.state.x += rnd(-3, 3);
    p.state.z += rnd(-3, 3);
    // ...now and then onto a spot a hair short of half a position step, which float32 rounding takes into the next
    if (Math.random() < 0.3) p.state.x = (qpos(p.state.x) + 0.5) / POS_SCALE - 1e-9;
  }
  // removals / spawns
  for (const e of [...ents.values()]) {
    if (!e.viewer && Math.random() < 0.01) {
      e.removed = true;
      ents.delete(e.id);
      freeIds.push(e.id);
    }
  }
  while (ents.size < 90) spawn(kinds[irnd(0, kinds.length - 1)]);
  // encode + decode: staged once, then one client after the other, as Game.sendSnapshots does
  const all = [...ents.values()];
  stageEntities(all);
  for (const { p: viewer, view, store } of viewers) {
    // a client that is not draining its socket gets nothing this tick; its next snapshot has to cover the gap
    if (Math.random() < 0.1) {
      skips++;
      continue;
    }
    // Game.writeSelf rounds a client's own state to float32 when it syncs it, right before its entities are written:
    // the clients after it in the tick must be sent the rounded position
    if (Math.random() < 0.5) {
      const was = qpos(viewer.x);
      snapPlayerState(viewer.state);
      if (qpos(viewer.x) !== was) rounded++;
    }
    w.reset();
    const flags = writeEntities(w, view, viewer, all, tick);
    bytes += w.o;
    snaps++;
    const r = new Reader(w.copy());
    readEntities(r, store, tick, flags);
    if (r.left !== 0) throw new Error(`tick ${tick}: ${r.left} trailing bytes`);
    // verify: every entity the server thinks the client knows matches exactly
    for (const id of view.knownIds) {
      const e = ents.get(id);
      const c = store.ents.get(id);
      if (!c) throw new Error(`tick ${tick}: client missing entity ${id}`);
      if (!e) throw new Error(`tick ${tick}: server knows removed entity ${id}`);
      if (c.kind !== e.kind) throw new Error(`tick ${tick}: kind mismatch for ${id}`);
      const exp = expectQ(e);
      // an entity whose update LOD held back this tick may lag (compare against the server baseline); anything
      // else must be the server's state as it is right now, exactly (players' view angles to the precision they
      // replicate at): what quantizing it for this client alone gives
      const dx = e.x - viewer.state.x;
      const dz = e.z - viewer.state.z;
      const held = e.kind !== ENT.PLAYER && dx * dx + dz * dz > LOD_NEAR * LOD_NEAR && ((tick + id) & 1) === 1;
      for (let s = 0; s < exp.length; s++) {
        if (c.q[s] !== view.base[id * 9 + s]) throw new Error(`tick ${tick}: entity ${id} kind ${e.kind} slot ${s}: client ${c.q[s]} != baseline ${view.base[id * 9 + s]}`);
        if (!held && c.q[s] !== exp[s]) throw new Error(`tick ${tick}: client ${viewer.id} has entity ${id} kind ${e.kind} slot ${s} at ${c.q[s]}, the server has ${exp[s]}`);
      }
      checks++;
    }
    if (store.ents.size !== view.knownIds.length) throw new Error(`tick ${tick}: client has ${store.ents.size} entities, server thinks ${view.knownIds.length}`);
  }
}
if (!rounded || !skips) throw new Error(`the fuzz never moved a viewer by rounding it mid-tick (${rounded}) or never skipped a client (${skips})`);
console.log(`protocol fuzz OK: ${TICKS} ticks, ${VIEWERS} clients off one staging (${skips} snapshots skipped, ${rounded} viewers moved a step by rounding mid-tick), ${checks} entity checks, avg ${(bytes / snaps).toFixed(0)} B/snapshot for ~90 entities`);

// varints
{
  const vw = new Writer(64);
  const vals = [0, 1, 127, 128, 255, 16383, 16384, 65535, 2097151, 2097152, 0x7fffffff, 0xffffffff];
  for (let i = 0; i < 2000; i++) vals.push(Math.floor(Math.random() * 2 ** irnd(1, 32)));
  for (const v of vals) vw.varu(v);
  const vr = new Reader(vw.copy());
  for (const v of vals) {
    const got = vr.varu();
    if (got !== v) throw new Error(`varu ${v} came back as ${got}`);
  }
  if (vr.left !== 0) throw new Error('varu trailing bytes');
}

// command packets: every mix of repeated / slightly changed / jumping commands, with and without a fingerprint
{
  const iw = new Writer(256);
  let seq = irnd(0, 65535);
  let inBytes = 0;
  const PACKETS = 20000;
  for (let k = 0; k < PACKETS; k++) {
    const n = irnd(1, MAX_CMDS);
    const style = irnd(0, 3);
    const cmds = [];
    let buttons = irnd(0, 1023);
    let qyaw = irnd(0, 65535);
    let qp = irnd(-31000, 31000);
    for (let i = 0; i < n; i++) {
      seq = (seq + 1) & 0xffff;
      if (style === 1) {
        qyaw = (qyaw + irnd(-150, 150)) & 0xffff;
        qp = Math.max(-32767, Math.min(32767, qp + irnd(-150, 150)));
      } else if (style >= 2) {
        if (Math.random() < 0.5) buttons = irnd(0, 1023);
        if (Math.random() < 0.5) qyaw = irnd(0, 65535);
        if (Math.random() < 0.5) qp = irnd(-32767, 32767);
      }
      cmds.push({ seq, buttons, qyaw, qpitch: qp, slot: style === 3 && Math.random() < 0.3 ? irnd(0, 4) : 255 });
    }
    const hash = Math.random() < 0.1 ? -1 : irnd(0, 255);
    const ping = Math.random() < 0.1;
    iw.reset();
    writeInput(iw, cmds, hash, ping);
    inBytes += iw.o;
    const ir = new Reader(iw.copy());
    const got = readInput(ir);
    if (ir.left !== 0) throw new Error(`input packet ${k}: ${ir.left} trailing bytes`);
    if (got.hash !== hash || got.ping !== ping) throw new Error(`input packet ${k}: hash ${got.hash} != ${hash} or ping ${got.ping} != ${ping}`);
    if (got.cmds.length !== n) throw new Error(`input packet ${k}: ${got.cmds.length} commands, sent ${n}`);
    for (let i = 0; i < n; i++) {
      const a = cmds[i];
      const b = got.cmds[i];
      if (a.seq !== b.seq || a.buttons !== b.buttons || a.qyaw !== b.qyaw || a.qpitch !== b.qpitch || a.slot !== b.slot) throw new Error(`input packet ${k} cmd ${i}: ${JSON.stringify(b)} != ${JSON.stringify(a)}`);
    }
  }
  console.log(`input codec OK: ${PACKETS} packets, avg ${(inBytes / PACKETS).toFixed(1)} B`);
}
