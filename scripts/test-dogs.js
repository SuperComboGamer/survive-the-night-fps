// The zombie dog's hunt (server/zombies.js: DOG_*, breakOff, startRam, ram, lungeClear), against the real server
// in-process with a survivor who stands still. Dogs are put down on open ground of a few valleys, and round closed
// pens of four pieces built the way a survivor builds them:
//   - one dog on open ground bites, breaks off and comes back: a gap of seconds between bites, and it spends little
//     of its time beside the survivor
//   - a pack of four does not bite in unison: hardly a bite comes within 0.3 s of a packmate's
//   - a dog shut in a pen of wood barricades or survivor gates, the survivor outside, rams its way out in a few
//     charges; a pen of metal walls holds, and the dog hurts itself on it
//   - a dog outside a pen with the survivor in it never lunges over the barricades into it: it rams its way in
// usage: node scripts/test-dogs.js [seed ...]   (VERBOSE=1 prints each scenario's numbers)
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { SERVER_TICK_RATE } from '../shared/constants.js';
import { ZTYPE, STRUCT, STRUCT_DEFS, ITEM, SCHEM_BIT } from '../shared/defs.js';
import { groundAt, raycastWorld } from '../shared/collision.js';

const seeds = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!seeds.length) seeds.push(1, 2, 3);
const DT = 1 / SERVER_TICK_RATE;
const NEAR = 1.8; // m between dog and survivor that counts as standing beside them
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
const mulberry = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};

function setup(seed) {
  const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const c = { id: 0, seq: 0, yaw: 0 };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('Prey');
  game.onMessage(c.session, w.bytes().slice());
  c.input = (buttons) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(c.yaw), qpitch: qpitch(0), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  for (let i = 0; i < 5; i++) {
    c.input(0);
    game.update();
  }
  // every bite a dog lands, by which dog (its position is the one it bit from) and when
  const bites = [];
  game.damagePlayer = (p, amount, src) => {
    if (src?.ztype !== ZTYPE.DOG) return;
    const z = game.zombies.find((q) => q.x === src.x && q.z === src.z);
    bites.push({ t: game.time, id: z ? z.id : -1 });
  };
  game.unlocked = ~0;
  return { game, c, p: game.players.get(c.id), bites };
}

// open ground: nothing standing within R m at knee or head height, no water, the ground within 0.6 m of level
const _ray = { t: -1, col: null, terrain: false };
function findSpot(game, R = 17) {
  const w = game.world;
  const car = w.car;
  for (let r = 60; r < 280; r += 7) {
    for (let a = 0; a < 6.28; a += 0.21) {
      const x = car.x + Math.sin(a) * r;
      const z = car.z + Math.cos(a) * r;
      if (Math.abs(x) > 290 || Math.abs(z) > 290 || w.isDeepWater(x, z) || game.nav.isBlocked(x, z)) continue;
      let mn = Infinity;
      let mx = -Infinity;
      let ok = true;
      for (let k = 0; k < 16 && ok; k++) {
        const b = (k / 16) * 6.28;
        for (const rr of [4, 9, 14, R]) {
          const h = w.heightAt(x + Math.sin(b) * rr, z + Math.cos(b) * rr);
          mn = Math.min(mn, h);
          mx = Math.max(mx, h);
          if (w.isDeepWater(x + Math.sin(b) * rr, z + Math.cos(b) * rr)) ok = false;
        }
        const y0 = w.heightAt(x, z);
        for (const hh of [0.5, 1.4]) {
          raycastWorld(w, x, y0 + hh, z, Math.sin(b), 0, Math.cos(b), R, _ray);
          if (_ray.t >= 0 && !_ray.terrain) ok = false;
        }
      }
      if (ok && mx - mn <= 0.6) return { x, z };
    }
  }
  return null;
}

function clear(env) {
  const { game } = env;
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
  for (const s of [...game.structures]) game.destroyStructure(s, false);
  game.zm.herds.reset();
  game.zm.maintainT = game.zm.herds.spawnT = 1e9;
  env.bites.length = 0;
}

function place(env, x, z) {
  const s = env.p.state;
  s.x = x;
  s.z = z;
  s.y = groundAt(env.game.world, x, z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  s.pinned = s.pulled = 0;
  s.stunT = 0;
}

// a closed pen of four pieces of type round (x, z), 3 m across inside, built by the survivor from its middle
function pen(env, x, z, type) {
  const { game, p, c } = env;
  place(env, x, z);
  game.giveItem(p, ITEM.WOOD, 40);
  game.giveItem(p, ITEM.NAILS, 30);
  game.giveItem(p, ITEM.SCRAP, 30);
  game.giveItem(p, ITEM.TAPE, 10);
  p.state.slot = 4;
  const o = 1.52 + STRUCT_DEFS[type].sz / 2;
  for (const [ox, oz, rot] of [[0, o, 0], [0, -o, 0], [-o, 0, 64], [o, 0, 64]]) {
    p.actionT = -1;
    game.build(p, type, x + ox, z + oz, rot);
    for (let k = 0; k < 6; k++) {
      c.input(0);
      game.update();
    }
  }
  p.state.slot = 0;
  return game.structures.filter((e) => e.stype === type && !e.removed);
}

// run for T s with the survivor standing still and facing the first dog; each(t) per tick
function run(env, T, dogs, each) {
  const { game, c, p } = env;
  const s = p.state;
  for (let i = 0; i < T / DT; i++) {
    const d = dogs.find((q) => !q.dead);
    if (!d) return;
    c.yaw = yawTo(s.x, s.z, d.x, d.z);
    c.input(0);
    game.update();
    if (each && each(i * DT) === false) return;
  }
}

// one dog on open ground, put down 12-16 m off: bites, the gaps between them, the time it spends beside the survivor
function single(env, spot, rng) {
  clear(env);
  place(env, spot.x, spot.z);
  const s = env.p.state;
  const a = rng() * Math.PI * 2;
  const d = 12 + rng() * 4;
  const z = env.game.zm.spawn(ZTYPE.DOG, spot.x + Math.sin(a) * d, spot.z + Math.cos(a) * d, { horde: true });
  let near = 0;
  let stretch = 0;
  let longest = 0;
  let t0 = -1;
  let time = 0;
  run(env, 20, [z], (t) => {
    const close = Math.hypot(z.x - s.x, z.z - s.z) < NEAR;
    if (t0 < 0 && close) t0 = t;
    if (t0 < 0) return;
    time += DT;
    if (close) {
      near += DT;
      stretch += DT;
      longest = Math.max(longest, stretch);
    } else stretch = 0;
  });
  const times = env.bites.map((b) => b.t);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  return { bites: times.length, gaps, near: time ? near / time : 0, longest };
}

// a pack of four put down together 14 m off: how many bites come within 0.3 s of a packmate's
function pack(env, spot, rng) {
  clear(env);
  place(env, spot.x, spot.z);
  const zm = env.game.zm;
  const id = zm.newPack();
  const a = rng() * Math.PI * 2;
  const dogs = [];
  for (let i = 0; i < 4; i++) {
    const b = a + (i - 1.5) * 0.25;
    const d = zm.spawn(ZTYPE.DOG, spot.x + Math.sin(b) * 14, spot.z + Math.cos(b) * 14, { horde: true, pack: id });
    d.flank = (i / 3 - 0.5) * 1.5;
    dogs.push(d);
  }
  run(env, 30, dogs);
  const b = env.bites;
  let together = 0;
  for (let i = 0; i < b.length; i++) if (b.some((o, j) => j !== i && o.id !== b[i].id && Math.abs(o.t - b[i].t) < 0.3)) together++;
  return { bites: b.length, together };
}

// a dog shut in a pen of type, the survivor 7 m outside it: when it is out (a piece broken), how many rams it took
function penned(env, spot, type, T) {
  clear(env);
  const pieces = pen(env, spot.x, spot.z, type);
  if (pieces.length !== 4) return null;
  place(env, spot.x + 7, spot.z + 0.5);
  const z = env.game.zm.spawn(ZTYPE.DOG, spot.x, spot.z, { horde: true });
  const hp = z.hp;
  let rams = 0;
  let was = z.state;
  let out = -1;
  run(env, T, [z], (t) => {
    if (z.state === 9 && was !== 9) rams++;
    was = z.state;
    if (out < 0 && pieces.some((e) => e.removed)) {
      out = t;
      return false;
    }
  });
  return { out, rams, hurt: hp - Math.max(0, z.hp), dead: z.dead };
}

// the survivor in a pen of barricades, a dog put down 4-6 m outside it, in sight: inside the pen before a piece is
// broken is a lunge over it
function ringed(env, spot, rng) {
  clear(env);
  const pieces = pen(env, spot.x, spot.z, STRUCT.BARRICADE);
  if (pieces.length !== 4) return null;
  const a = rng() * Math.PI * 2;
  const d = 4 + rng() * 2;
  const z = env.game.zm.spawn(ZTYPE.DOG, spot.x + Math.sin(a) * d, spot.z + Math.cos(a) * d, { horde: true });
  let over = false;
  let broke = -1;
  run(env, 30, [z], (t) => {
    const standing = pieces.every((e) => !e.removed);
    if (standing && Math.abs(z.x - spot.x) < 1.5 && Math.abs(z.z - spot.z) < 1.5) over = true;
    if (broke < 0 && !standing) broke = t;
  });
  return { over, broke };
}

const R = { single: [], pack: [], pen: { [STRUCT.BARRICADE]: [], [STRUCT.GATE]: [], [STRUCT.METAL_WALL]: [] }, ring: [] };
let spots = 0;
for (const seed of seeds) {
  const env = setup(seed);
  const spot = findSpot(env.game);
  if (!spot) continue;
  spots++;
  const rng = mulberry(seed * 131);
  for (let k = 0; k < 6; k++) R.single.push(single(env, spot, rng));
  for (let k = 0; k < 3; k++) R.pack.push(pack(env, spot, rng));
  for (const type of [STRUCT.BARRICADE, STRUCT.GATE]) for (let k = 0; k < 2; k++) R.pen[type].push(penned(env, spot, type, 40));
  for (let k = 0; k < 2; k++) R.pen[STRUCT.METAL_WALL].push(penned(env, spot, STRUCT.METAL_WALL, 30));
  for (let k = 0; k < 3; k++) R.ring.push(ringed(env, spot, rng));
}

const ones = R.single;
const gaps = ones.flatMap((r) => r.gaps);
const bites = ones.reduce((a, r) => a + r.bites, 0);
const near = median(ones.map((r) => r.near));
const longest = Math.max(0, ...ones.map((r) => r.longest));
const packBites = R.pack.reduce((a, r) => a + r.bites, 0);
const together = R.pack.reduce((a, r) => a + r.together, 0);
const pens = (type) => R.pen[type].filter(Boolean);
const outs = (type) => pens(type).filter((r) => r.out >= 0);
const desc = (type) => {
  const rows = pens(type);
  const o = outs(type);
  const when = o.length ? `, after ${median(o.map((r) => r.out)).toFixed(1)} s and ${median(o.map((r) => r.rams))} rams (median)` : `, ${median(rows.map((r) => r.rams))} rams (median)`;
  return `${o.length} of ${rows.length} out${when}; the dog lost ${median(rows.map((r) => r.hurt)).toFixed(0)} hp${rows.some((r) => r.dead) ? `, ${rows.filter((r) => r.dead).length} died` : ''}`;
};
const ring = R.ring.filter(Boolean);
if (process.env.VERBOSE) {
  for (const r of ones) console.log(`      single: ${r.bites} bites, gaps ${r.gaps.map((g) => g.toFixed(1)).join(' ')}, ${Math.round(r.near * 100)}% of the time beside, longest ${r.longest.toFixed(1)} s`);
  for (const r of R.pack) console.log(`      pack: ${r.bites} bites, ${r.together} within 0.3 s of a packmate's`);
  for (const [type, rows] of Object.entries(R.pen)) for (const r of rows) console.log(`      pen ${STRUCT_DEFS[type].name}: ${r ? `out after ${r.out.toFixed(1)} s, ${r.rams} rams, lost ${r.hurt.toFixed(0)} hp${r.dead ? ', dead' : ''}` : 'not built'}`);
  for (const r of ring) console.log(`      ring: over the barricades ${r.over}, a piece broken after ${r.broke.toFixed(1)} s`);
}

check('open ground to test on', spots === seeds.length, `${spots} of ${seeds.length} valleys`);
check('one dog bites, breaks off and comes back: 2 s or more between bites (median), none within 1 s of the last', bites >= ones.length * 2 && median(gaps) >= 2 && Math.min(...gaps) >= 1, `${bites} bites in ${ones.length} runs, ${median(gaps).toFixed(1)} s between them (median), ${Math.min(...gaps).toFixed(1)} s the least`);
check('...and is beside the survivor a small part of the time, never for long', near <= 0.25 && longest <= 1.5, `${Math.round(near * 100)}% of the time (median), ${longest.toFixed(1)} s at most`);
check('a pack of four does not bite in unison', packBites >= R.pack.length * 6 && together <= packBites * 0.1, `${together} of ${packBites} bites within 0.3 s of a packmate's`);
check('a dog shut in a pen of wood barricades rams its way out in a few charges', outs(STRUCT.BARRICADE).length === pens(STRUCT.BARRICADE).length && pens(STRUCT.BARRICADE).length > 0 && outs(STRUCT.BARRICADE).every((r) => r.rams <= 4), desc(STRUCT.BARRICADE));
check('...and of survivor gates too, in more of them', outs(STRUCT.GATE).length === pens(STRUCT.GATE).length && pens(STRUCT.GATE).length > 0 && median(outs(STRUCT.GATE).map((r) => r.rams)) >= median(outs(STRUCT.BARRICADE).map((r) => r.rams)), desc(STRUCT.GATE));
check('a pen of metal walls holds, and the dog hurts itself on it', pens(STRUCT.METAL_WALL).length > 0 && outs(STRUCT.METAL_WALL).length === 0 && pens(STRUCT.METAL_WALL).every((r) => r.hurt > 0), desc(STRUCT.METAL_WALL));
check('a dog never lunges over the barricades round a survivor: it rams its way in', ring.length > 0 && ring.every((r) => !r.over) && ring.every((r) => r.broke >= 0), `${ring.filter((r) => r.over).length} of ${ring.length} got over, ${ring.filter((r) => r.broke >= 0).length} broke a piece`);

if (fails.length) {
  console.log(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);
