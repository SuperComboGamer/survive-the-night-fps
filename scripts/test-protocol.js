// Fuzz test: server delta encoder vs client decoder for every entity kind, including removals,
// id reuse with new generations, LOD skipping and large/small position deltas; then the varints and the
// command packets (writeInput / readInput).
import { Writer, Reader, ENT, MAX_CMDS, qpos, qangle8, qlookYaw, qlookPitch, writeInput, readInput } from '../shared/protocol.js';
import { ClientView, writeEntities, playerFlags } from '../server/snapshot.js';
import { readEntities } from '../client/net/decode.js';
import { createPlayerState } from '../shared/playersim.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));
let gen = 1;
const ents = new Map();
const freeIds = [];
let nextId = 2;

function makeViewer() {
  const p = { kind: ENT.PLAYER, id: 1, gen: gen++, state: createPlayerState(), hp: 100, maxHp: 100, alive: true, zombie: false, flashlight: false, removed: false };
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
      e.anim = irnd(0, 9);
      e.hp = 100;
      e.maxHp = 100;
      e.link = 0;
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
      e.ptype = irnd(1, 6);
      e.owner = irnd(0, 500);
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
      q.push(qangle8(e.yaw), e.anim);
      break;
  }
  return q;
}

const viewer = makeViewer();
ents.set(viewer.id, viewer);
const view = new ClientView();
const store = { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} };
const w = new Writer(1024);
let bytes = 0;
const kinds = [ENT.PLAYER, ENT.ZOMBIE, ENT.ITEM, ENT.STRUCTURE, ENT.PROJECTILE, ENT.CRATE, ENT.AREA, ENT.CACHE, ENT.CAT];
for (let i = 0; i < 80; i++) spawn(kinds[irnd(0, kinds.length - 1)]);
let checks = 0;
const TICKS = 3000;
for (let tick = 1; tick <= TICKS; tick++) {
  // mutate
  for (const e of ents.values()) {
    if (e === viewer) continue;
    if (Math.random() < 0.3) {
      // every position encoding: a few cm on the flat (1 byte), a step (2 bytes), a leap (3) and a teleport (absolute)
      const big = Math.random() < 0.05;
      const tiny = Math.random() < 0.3;
      const step = tiny ? 0.1 : Math.random() < 0.5 ? 0.45 : 1.9;
      e.x += big ? rnd(-30, 30) : rnd(-step, step);
      e.z += big ? rnd(-30, 30) : rnd(-step, step);
      if (!tiny) e.y += rnd(-0.3, 0.3);
    }
    if (e.kind === ENT.ZOMBIE && Math.random() < 0.2) {
      e.anim = irnd(0, 9);
      e.yaw = rnd(0, 6.28);
      e.hp = Math.max(0, e.hp - rnd(0, 10));
      e.link = Math.random() < 0.1 ? irnd(1, 60000) : 0;
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
  }
  // viewer moves around (relevance changes)
  viewer.state.x += rnd(-3, 3);
  viewer.state.z += rnd(-3, 3);
  // removals / spawns
  for (const e of [...ents.values()]) {
    if (e !== viewer && Math.random() < 0.01) {
      e.removed = true;
      ents.delete(e.id);
      freeIds.push(e.id);
    }
  }
  while (ents.size < 90) spawn(kinds[irnd(0, kinds.length - 1)]);
  // encode + decode
  w.reset();
  const flags = writeEntities(w, view, viewer, [...ents.values()], tick);
  bytes += w.o;
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
    // LOD-skipped entities may lag; compare against the server baseline instead
    for (let s = 0; s < exp.length; s++) {
      if (c.q[s] !== view.base[id * 9 + s]) throw new Error(`tick ${tick}: entity ${id} kind ${e.kind} slot ${s}: client ${c.q[s]} != baseline ${view.base[id * 9 + s]}`);
    }
    checks++;
  }
  if (store.ents.size !== view.knownIds.length) throw new Error(`tick ${tick}: client has ${store.ents.size} entities, server thinks ${view.knownIds.length}`);
}
// whatever the client was told this tick must be the server's current state, exactly (players' view angles to the
// precision they replicate at): compare everything not LOD-skipped on the last tick
for (const id of view.knownIds) {
  const e = ents.get(id);
  const c = store.ents.get(id);
  const exp = expectQ(e);
  const lagging = exp.some((v, s) => c.q[s] !== v);
  if (lagging && (e.kind === ENT.PLAYER || Math.hypot(e.x - viewer.state.x, e.z - viewer.state.z) < 40)) throw new Error(`entity ${id} kind ${e.kind} is near the viewer but out of date: ${[...c.q]} vs ${exp}`);
}
console.log(`protocol fuzz OK: ${TICKS} ticks, ${checks} entity checks, avg ${(bytes / TICKS).toFixed(0)} B/tick for ~90 entities`);

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
