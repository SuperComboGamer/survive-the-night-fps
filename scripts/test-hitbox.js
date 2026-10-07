// The colliders follow what is drawn (docs/hitboxes.md), held in node with no browser:
//   - every prop's collision volume against its model, every variant (scripts/hitbox/lib.js): the solid air and the
//     holes stay inside the bounds below, or the prop is on the short list of exceptions, each with its reason;
//   - the rules a prop's colliders keep for the rest of the game: nothing thin enough to be taken for a deck, nothing
//     hung where a jump reaches, a wreck's units told apart on the wire, a variant's colliders for a variant there is;
//   - the report this started from: a shot across the bonnet of the car at camp goes on, one into its cabin stops,
//     nobody walks through the bonnet, and a survivor gets up onto it and from there onto the roof;
//   - a wreck of several boxes is still one thing to strip (two for a lorry), and is found again by its name on the wire;
//   - the whole of both maps swept (scripts/hitbox/sweep.js): no more invisible walls than there are today.
// usage: node scripts/test-hitbox.js [--only car_wreck,tent] [--no-sweep]
import { PROPS, measureType, variantsOf } from './hitbox/lib.js';
import { drawnWorld, sweep, summary } from './hitbox/sweep.js';
import { collidersOf, planOf, unitOf, SALVAGE_PROPS } from '../shared/props.js';
import { worldFor } from '../shared/worlds.js';
import { raycastWorld, groundAt, COL } from '../shared/collision.js';
import { simulatePlayer, createPlayerState } from '../shared/playersim.js';
import { BTN, CMD_RATE, PLAYER_RADIUS, STEP_HEIGHT, JUMP_VELOCITY, GRAVITY } from '../shared/constants.js';
import { qpos, usePos } from '../shared/protocol.js';
import { wreckUnit, wreckColAt, wreckOf } from '../shared/wrecks.js';

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '  ' + detail}`);
};
const t0 = Date.now();

// ---------------------------------------------------------------- every prop against its model
// The bounds (metres). A prop over one of them fails this test: give it colliders that follow its model
// (scripts/hitbox/fit.js, sil.js and overlay.js help), or, if it is meant to be as it is, an entry below with why.
//   sightAirMax    between a crouching and a standing eye: how far the worst spot where a shot or a look is stopped
//                  is from anything drawn (the car fault: the air over a bonnet was 0.76)
//   shotAirMax     the same anywhere on it (the room under a truck's tail, over a roof)
//   shotHoleThick  how thick the thickest part of the model is that nothing stops a shot at
//   moveAirMax     seen from above: how far into the open a collider that stops a body reaches
//   moveHoleMax    ...and how wide the widest thing is that stands in a body's way with no collider at all
export const BOUNDS = { sightAirMax: 0.7, shotAirMax: 1.2, shotHoleThick: 0.5, moveAirMax: 0.6, moveHoleMax: 0.55 };
// The exceptions: for each, its own looser bound and the reason. Keep it short.
export const ALLOW = {
  fence_chain: { sightAirMax: 1.0, why: 'chain link stops a shot and a look as it always has: making it NOBULLET would also let the dead claw through it and survivors loot through it (docs/hitboxes.md, "Left as it is")' },
  airliner_wreck: { sightAirMax: 2.1, shotAirMax: 2.5, moveAirMax: 1.9, moveHoleMax: 0.9, why: 'a wreck 26 m across, lying aslant, in 22 boxes that turn only with the prop: its swept wings and slewed tail are steps' },
  plane_wreck: { sightAirMax: 1.3, shotAirMax: 1.8, moveAirMax: 1.0, why: 'the quest plane: the ground under its wings and round its engines is shut on purpose (the cowling, the drums, the steps: nobody is to be wedged under it while it is mended)' },
  light_plane: { sightAirMax: 0.85, moveAirMax: 0.75, why: 'its wing struts and the legs of its wheels are blocks: nobody walks between a strut and the cabin' },
  heli_wreck: { sightAirMax: 1.15, shotAirMax: 1.4, shotHoleThick: 0.6, why: 'it lies over on its side: the cabin leans out over the low side of its boxes, and its blades lie on the ground with no collider' },
  semi_truck: { sightAirMax: 0.85, moveAirMax: 0.7, why: 'the burnt one: the door frame at the back of its trailer is a block, the tractor is slewed across its boxes' },
  rubble_slope: { sightAirMax: 0.9, why: 'the mound is slabs at all angles with room between them: the inside of it reads as air' },
  subway_entrance: { sightAirMax: 0.85, why: 'the rubble behind its gate is a heap under one block' },
  triage_tent: { shotHoleThick: 0.75, why: 'its roof has no collider: it is over a walkway, and a collider a jump can reach throws the jumper out sideways' },
  church_bell: { moveHoleMax: 0.65, why: 'it hangs in a belfry nobody reaches, and has no collider' },
  windsock: { shotHoleThick: 0.6, why: 'the sock on its pole stops nothing' },
};
{
  const types = (only || Object.keys(PROPS)).filter((t) => PROPS[t]);
  const over = [];
  const unused = new Set(Object.keys(ALLOW));
  let worst = { sightAirMax: 0, shotAirMax: 0, shotHoleThick: 0, moveAirMax: 0, moveHoleMax: 0 };
  const sums = { shotAir: 0, shotHole: 0, moveAir: 0, moveHole: 0 };
  for (const type of types) {
    const r = measureType(type);
    for (const k of Object.keys(sums)) sums[k] += r[k];
    for (const [k, lim] of Object.entries(BOUNDS)) {
      const mine = ALLOW[type]?.[k];
      if (r[k] > lim) unused.delete(type);
      if (r[k] > (mine ?? lim) + 1e-9) over.push(`${type}: ${k} ${r[k].toFixed(2)} m (bound ${(mine ?? lim).toFixed(2)})`);
      if (!ALLOW[type]) worst[k] = Math.max(worst[k], r[k]);
    }
  }
  check(`every prop's colliders are within the bounds of its model, all variants (${types.length} props)`, !over.length, `${over.length} over:\n      ${over.join('\n      ')}\n      (node scripts/hitbox/measure.js --only <type> --where, node scripts/hitbox/overlay.js <type>: docs/hitboxes.md)`);
  if (!only) check('every exception on the list is still one', !unused.size, `no longer over any bound, take them off ALLOW: ${[...unused].join(', ')}`);
  console.log(`      worst outside the list: ${Object.entries(worst).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}; totals: solid air ${sums.shotAir.toFixed(0)} m3, holes ${sums.shotHole.toFixed(0)} m3`);
}

// ---------------------------------------------------------------- the rules a prop's colliders keep
{
  const thin = [], hung = [], twins = [], vary = [];
  // (as they were before this test: the quest plane's tailplane, fin and radio mast. A jump under its tailplane
  // does throw the jumper out sideways: docs/hitboxes.md, "Left as it is")
  const AS_IT_WAS = /^plane_wreck#0 (box 13|collider 1[01]):/;
  const reach = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY) + 1.8; // how high a head gets in a jump off the ground
  for (const type of Object.keys(PROPS)) {
    const def = PROPS[type];
    const n = def.vary ? def.vary.n : 1;
    if (def.vary) {
      const drawn = variantsOf(type).length;
      if (drawn !== n) vary.push(`${type}: vary.n ${n}, the model has ${drawn} variants`);
      for (const k of Object.keys(def.vary)) if (k !== 'n' && !(+k < n)) vary.push(`${type}: vary[${k}] of ${n}`);
    }
    for (let v = 0; v < n; v++) {
      const c = collidersOf(type, v);
      const cols = [...(c.boxes || []).map((b) => ({ x: b[0], z: b[2], y0: b[1] - b[4] / 2, y1: b[1] + b[4] / 2 })), ...(c.cyls || []).map((q) => ({ x: q[0], z: q[1], y0: q[4] || 0, y1: (q[4] || 0) + q[3] }))];
      cols.forEach((b, k) => {
        // server/nav.js takes a box thinner than 0.45 m with its top over half a metre for a deck the dead walk under or on
        if (k < (c.boxes || []).length && b.y1 - b.y0 < 0.45 - 1e-9 && b.y1 > 0.5) thin.push(`${type}#${v} box ${k}: ${(b.y1 - b.y0).toFixed(2)} m thick, top at ${b.y1.toFixed(2)}`);
        // a collider with its underside where a jumping head comes pushes the jumper out sideways (resolveBody)
        if (b.y0 >= 1.8 && b.y0 < reach) hung.push(`${type}#${v} collider ${k}: underside at ${b.y0.toFixed(2)} m`);
      });
      if (def.salvage) {
        const first = new Map();
        cols.forEach((b, k) => {
          const u = unitOf(type, k);
          if (!first.has(u)) first.set(u, k);
        });
        for (const [u, k] of first) cols.forEach((b, j) => {
          if (j !== k && Math.abs(b.y0 - cols[k].y0) < 0.05 && Math.hypot(b.x - cols[k].x, b.z - cols[k].z) < 0.1) twins.push(`${type}#${v}: collider ${j} has the centre and the base of ${k}, which names unit ${u}`);
        });
      }
    }
  }
  const left = (list) => list.filter((t) => !AS_IT_WAS.test(t));
  check('no box of a prop is thin enough to be taken for a deck (0.45 m), unless it lies on the ground', !left(thin).length, left(thin).join('; '));
  check('no collider of a prop hangs where a jump reaches (underside between 1.8 and 2.71 m)', !left(hung).length, left(hung).join('; '));
  check("a wreck's units are told apart by where the collider that names each stands (centre and base)", !twins.length, twins.join('; '));
  check('a prop with colliders by variant has as many variants as its model', !vary.length, vary.join('; '));
}

// ---------------------------------------------------------------- the report: the sedan
const island = worldFor(1, 1);
{
  const w = island;
  const car = w.car;
  const c = Math.cos(car.ry), s = Math.sin(car.ry);
  const at = (lx, lz) => [car.x + c * lx + s * lz, car.z - s * lx + c * lz];
  const ray = { t: -1, col: null, terrain: false };
  // a level ray across the car, from its left side to its right, lz along it and h over its base
  const across = (lz, h, from = -1.6) => {
    const [x, z] = at(from, lz);
    const [dx, dz] = [c, -s];
    raycastWorld(w, x, car.y + h, z, dx, 0, dz, 3.2, ray);
    return ray.t >= 0 && ray.col?.tag?.type === 'car' ? ray.t : -1;
  };
  check('the car at camp is there to be shot at', across(0.3, 0.6) > 0.5 && across(0.3, 0.6) < 0.8, `${across(0.3, 0.6).toFixed(2)}`);
  check('a shot across the bonnet of the car, at chest height, goes on', across(-1.7, 1.25) < 0, `stopped ${across(-1.7, 1.25).toFixed(2)} m on`);
  check('...and across its boot', across(1.75, 1.25) < 0, `stopped ${across(1.75, 1.25).toFixed(2)} m on`);
  check('...and over its roof', across(0.3, 1.62) < 0);
  const cab = across(0.3, 1.25);
  check('a shot into its cabin stops on it (glass and pillars alike)', cab > 0.5 && cab < 0.95, `${cab.toFixed(2)}`);
  check('a shot at the bonnet itself stops on the bonnet', across(-1.7, 0.6) > 0.5 && across(-1.7, 0.6) < 0.8, `${across(-1.7, 0.6).toFixed(2)}`);
  // (what it was: one box to the roof, the whole length - the plan it is still laid out by)
  const plan = planOf('car').boxes[0];
  check('(the one box it had stood 0.4 m over the bonnet)', plan[1] + plan[4] / 2 > 1.3 && collidersOf('car').boxes.length >= 3);
  // a survivor walks at the bonnet from the side: stopped at it
  const walk = (lx, lz, buttons, ticks, face) => {
    const st = createPlayerState();
    [st.x, st.z] = at(lx, lz);
    st.y = groundAt(w, st.x, st.z, car.y + 0.3, PLAYER_RADIUS * 0.7);
    st.onGround = 1;
    for (let i = 0; i < ticks; i++) {
      const [tx, tz] = face(st);
      simulatePlayer(st, { seq: i, buttons: typeof buttons === 'function' ? buttons(i, st) : buttons, yaw: Math.atan2(st.x - tx, st.z - tz), pitch: 0, slot: 255 }, w, null);
    }
    const dx = st.x - car.x, dz = st.z - car.z;
    return { lx: c * dx - s * dz, lz: s * dx + c * dz, y: st.y - car.y };
  };
  const stopped = walk(-2.2, -1.7, BTN.FWD, CMD_RATE * 2, () => at(0, -1.7));
  check('nobody walks through the bonnet', stopped.lx < -0.95 - PLAYER_RADIUS + 0.03 && Math.abs(stopped.y) < 0.1, `at ${stopped.lx.toFixed(2)} across, ${stopped.y.toFixed(2)} up`);
  // ...jumps at it: up on the bonnet
  const up = walk(-2.0, -1.7, (i) => BTN.FWD | (i > 4 && i < 30 ? BTN.JUMP : 0), CMD_RATE * 2, () => at(0, -1.7));
  check('a survivor jumps up onto the bonnet and stands on it', Math.abs(up.lx) < 0.95 && Math.abs(up.y - 0.95) < 0.03, `at ${up.lx.toFixed(2)} across, ${up.y.toFixed(2)} up`);
  // ...and from the bonnet walks back up the scuttle onto the roof (two steps under STEP_HEIGHT)
  const roof = (() => {
    const st = createPlayerState();
    [st.x, st.z] = at(0, -1.7);
    st.y = car.y + 0.95;
    st.onGround = 1;
    for (let i = 0; i < CMD_RATE * 2; i++) {
      const [tx, tz] = at(0, 0.4);
      if (Math.hypot(st.x - tx, st.z - tz) < 0.15) break;
      simulatePlayer(st, { seq: i, buttons: BTN.FWD, yaw: Math.atan2(st.x - tx, st.z - tz), pitch: 0, slot: 255 }, w, null);
    }
    return st.y - car.y;
  })();
  check('...and walks from the bonnet up onto the roof', Math.abs(roof - 1.5) < 0.03 && 1.22 - 0.95 <= STEP_HEIGHT && 1.5 - 1.22 <= STEP_HEIGHT, `${roof.toFixed(2)} up`);
}

// ---------------------------------------------------------------- a wreck of several boxes is one wreck
for (const [name, w] of [['island', island], ['mainland', worldFor(1, 2)]]) {
  usePos(w);
  const of = new Map(); // prop -> its colliders
  const seen = new Set();
  for (const cell of w.staticGrid.cells) for (const col of cell) {
    if (seen.has(col) || !(col.flags & COL.SALVAGE)) continue;
    seen.add(col);
    if (!of.has(col.tag)) of.set(col.tag, []);
    of.get(col.tag).push(col);
  }
  const bad = [];
  let wrecks = 0, boxes = 0;
  for (const [prop, cols] of of) {
    if (!prop || prop.bare) continue;
    wrecks++;
    boxes += cols.length;
    const units = new Set(cols.map((col) => wreckUnit(col)));
    const def = PROPS[prop.type];
    const want = def.units === 'each' ? cols.length : new Set(cols.map((_, k) => unitOf(prop.type, k))).size;
    if (units.size !== want) bad.push(`${prop.type}: ${units.size} units of ${cols.length} colliders, ${want} meant`);
    for (const u of units) {
      if (wreckUnit(u) !== u || u.tag !== prop) bad.push(`${prop.type}: a unit that is not its own`);
      if (!prop.live && wreckOf(u) !== prop) bad.push(`${prop.type}: wreckOf`);
      if (wreckColAt(w, qpos(u.x), qpos(u.y0), qpos(u.z)) !== u) bad.push(`${prop.type} at /tp ${prop.x.toFixed(1)} ${prop.z.toFixed(1)}: not found again by the name it goes by on the wire`);
    }
  }
  check(`${name}: every wreck is one thing to strip whichever of its boxes is struck (a lorry two), and is found by its name on the wire (${wrecks} wrecks, ${boxes} boxes)`, wrecks > 20 && !bad.length, `${bad.length}: ${bad.slice(0, 4).join('; ')}`);
}
check('the props that give scrap are the ones they were', SALVAGE_PROPS.length >= 20 && SALVAGE_PROPS.every((t) => PROPS[t].salvage));

// ---------------------------------------------------------------- both maps, swept
// Faults that are not by design (sweep.js designOf), by the cubic metre, on seed 1337 of each map, as they stand
// today with a fifth to spare: a new place or prop that brings an invisible wall with it goes over. What the pass
// found, before it: island 704 / 859, mainland 3123 / 5014 (shots / bodies stopped in the open).
const SWEPT = {
  island: { airShot: 130, airWalk: 180, holeShot: 265, holeWalk: 172 },
  mainland: { airShot: 1085, airWalk: 1115, holeShot: 550, holeWalk: 380 },
};
if (!only && !argv.includes('--no-sweep')) {
  for (const [name, act] of [['island', 1], ['mainland', 2]]) {
    const w = worldFor(1337, act);
    const D = await drawnWorld(w);
    const res = sweep(w, D, {});
    const s = summary(res.runs[0]);
    const got = { airShot: s.open.air.shot, airWalk: s.open.air.walk, holeShot: s.open.hole.shot, holeWalk: s.open.hole.walk };
    const lim = SWEPT[name];
    const top = s.by.slice(0, 6).map((e) => `${e.n} ${e.kind} ${e.mode} ${e.owner} (/tp ${e.at[0].toFixed(0)} ${e.at[2].toFixed(0)})`).join('; ');
    check(`${name} 1337 swept from ${res.spots} standing spots (${res.rays} rays): shots stopped in the open ${got.airShot}, bodies ${got.airWalk}; shots through something drawn ${got.holeShot}, bodies ${got.holeWalk}`, Object.keys(lim).every((k) => got[k] <= lim[k]), `bounds ${JSON.stringify(lim)}; the commonest: ${top}\n      (node scripts/hitbox/sweep.js --world ${name}: docs/hitboxes.md)`);
  }
}

console.log(`\n${failed ? `hitboxes FAILED (${failed})` : 'hitboxes OK'}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
