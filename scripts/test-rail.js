// Railway test: the line across the valley (shared/layout.js plans it, shared/rail.js builds it), as the world and
// a survivor meet it. For a number of valleys this checks that
//   - there is a line from rim to rim and a depot on it, on every one of them
//   - it crosses Route 9 once, keeps off the water and off every other place's levelled ground, bends gently and
//     is nowhere steeper than its ruling grade
//   - its bed is level and nothing solid stands on it: a survivor walks it from either tunnel mouth to the train
//   - every road and trail that crosses it does so on the level, over planks
//   - each tunnel is shut a few metres in, and nobody gets out of the map through one
//   - the open boxcars of the stalled train can be walked into from the loading bank, what is in them can be
//     searched, their doorway takes door boards, and the dead find their way in
// and, with a game running on one of them, that a boxcar holds as a shelter: boards in its doorway, a torch on
// its floor, a zombie that comes in after a survivor and one that has to break the boards down.
// usage: node scripts/test-rail.js [seed ...]     the full test on those valleys
//        node scripts/test-rail.js --sweep 300    the plan alone on seeds 1..300 (line, depot, crossing, grades)
import { createWorld } from '../shared/world.js';
import { RAIL } from '../shared/rail.js';
import { DEPOT_TRACK } from '../shared/layout.js';
import { ZONE, ZONE_NAMES, ZTYPE, ITEM, STRUCT, CONT, CONT_DEFS, CONT_TABLES } from '../shared/defs.js';
import { COL, groundAt, resolveBody, canReach, footprintContains } from '../shared/collision.js';
import { simulatePlayer, createPlayerState } from '../shared/playersim.js';
import { BTN, CMD_RATE, MAP_HALF, PLAYER_RADIUS, PLAYER_HEIGHT, EYE_HEIGHT, STEP_HEIGHT, WATER_LEVEL, SERVER_TICK_RATE, SLOT_BUILD } from '../shared/constants.js';
import { Nav } from '../server/nav.js';
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';

const sweep = process.argv[2] === '--sweep' ? +(process.argv[3] || 300) : 0;
const SEEDS = sweep ? Array.from({ length: sweep }, (_, i) => i + 1) : process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 2, 3, 5, 8, 13];
const fails = [];
// (a pass is only printed with VERBOSE=1: there are a few dozen checks to a valley)
const check = (name, ok, info = '') => {
  if (!ok) fails.push(name);
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  return ok;
};
const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // (yaw 0 faces -Z)

// walks a survivor along a line of points by the real simulation; -> { ok, s, lost: the point they stopped short of }
function walk(world, pts, secs, y0) {
  const s = createPlayerState();
  s.x = pts[0][0];
  s.z = pts[0][1];
  s.y = groundAt(world, s.x, s.z, y0 ?? 200, PLAYER_RADIUS * 0.7);
  s.onGround = 1;
  let k = 1;
  let seq = 0;
  for (let t = 0; t < secs * CMD_RATE && k < pts.length; t++) {
    const dx = pts[k][0] - s.x;
    const dz = pts[k][1] - s.z;
    if (Math.hypot(dx, dz) < 0.6) {
      k++;
      continue;
    }
    simulatePlayer(s, { seq: ++seq, buttons: BTN.FWD | BTN.SPRINT, yaw: yawTo(dx, dz), pitch: 0, slot: 255 }, world, null);
  }
  return { ok: k >= pts.length, s, lost: k };
}

// does segment a-b cross segment c-d?
function crosses(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Something on foot that follows the nav grid's flow field to survivor `id`, the way Zombies.updateOne steers one
// that has no clear line to them: along the field, straight at them where the field has nothing to say, and a few
// steps aside when it has stopped getting anywhere (a zombie's detour). -> whether the field reaches where it
// started, how near it got (m), how far off its feet were from the survivor's (m), and where it was held up
const _dir = { x: 0, z: 0, cost: 0 };
function follow(world, nav, id, from, to, steps = 1200) {
  const pos = { x: from[0], y: groundAt(world, from[0], from[1], 200, 0.2, false), z: from[1] };
  const reached = nav.flowDir(id, pos.x, pos.z, _dir, pos.y);
  let stuck = null;
  let still = 0;
  let detour = 0;
  let side = 1;
  for (let n = 0; n < steps; n++) {
    const d = Math.hypot(pos.x - to.x, pos.z - to.z);
    if (d < 1.3 && Math.abs(pos.y - to.y) < 0.5) return { reached, near: d, dy: Math.abs(pos.y - to.y), steps: n, stuck };
    if (detour > 0) detour--;
    else if (!nav.flowDir(id, pos.x, pos.z, _dir, pos.y)) {
      _dir.x = (to.x - pos.x) / (d || 1);
      _dir.z = (to.z - pos.z) / (d || 1);
    }
    const ox = pos.x;
    const oz = pos.z;
    pos.x += _dir.x * 0.25;
    pos.z += _dir.z * 0.25;
    resolveBody(world, pos, 0.35, 1.75, false);
    pos.y = groundAt(world, pos.x, pos.z, pos.y, 0.2, false);
    still = Math.hypot(pos.x - ox, pos.z - oz) < 0.05 ? still + 1 : 0;
    if (still > 3 && !detour) {
      stuck ||= [pos.x, pos.z];
      [_dir.x, _dir.z] = [-_dir.z * side + _dir.x * 0.2, _dir.x * side + _dir.z * 0.2];
      side = -side;
      detour = 5;
      still = 0;
    }
  }
  return { reached, near: Math.hypot(pos.x - to.x, pos.z - to.z), dy: Math.abs(pos.y - to.y), steps, stuck };
}

const t0 = performance.now();
let lines = 0;
let depots = 0;
let worstGrade = 0;
let tightest = Infinity;
let humps = 0;
for (const seed of SEEDS) {
  const world = createWorld(seed);
  const rail = world.rail;
  const tag = `[${seed}]`;
  if (!check(`${tag} the valley has a railway`, !!rail)) continue;
  lines++;
  const m = rail.main;
  const [A, B] = rail.portals;
  const depot = world.zoneById[ZONE.STATION];
  if (check(`${tag} Whitlock Depot stands on it`, !!depot && !!rail.depot && !!rail.siding)) depots++;
  humps += rail.humps;
  // the unit vector along the line at point i, and to its right
  const along = (i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(m.n - 1, i + 1);
    const l = Math.hypot(m.x[b] - m.x[a], m.z[b] - m.z[a]) || 1;
    return [(m.x[b] - m.x[a]) / l, (m.z[b] - m.z[a]) / l];
  };
  const beside = (i, lat) => {
    const [tx, tz] = along(i);
    return [m.x[i] + tz * lat, m.z[i] - tx * lat];
  };

  // ---- the plan
  const rim = (p) => MAP_HALF - Math.max(Math.abs(p.x), Math.abs(p.z));
  check(`${tag} the line runs from one rim of the valley to another`, rim(A) < 50 && rim(B) < 50 && rim(A) > 8 && rim(B) > 8 && Math.hypot(A.x - B.x, A.z - B.z) > 380, `mouths ${rim(A).toFixed(0)} and ${rim(B).toFixed(0)} m in from the edge, ${Math.hypot(A.x - B.x, A.z - B.z).toFixed(0)} m apart`);
  let grade = 0;
  for (let i = 1; i < m.n; i++) grade = Math.max(grade, Math.abs(m.y[i] - m.y[i - 1]) / Math.hypot(m.x[i] - m.x[i - 1], m.z[i] - m.z[i - 1]));
  worstGrade = Math.max(worstGrade, grade);
  check(`${tag} it is nowhere steeper than its ruling grade`, grade <= RAIL.GRADE * 1.03 || rail.humps > 0, `${(grade * 100).toFixed(2)}%`);
  // bends: the radius of the circle through three points 15 m apart
  let radius = Infinity;
  for (let i = 15; i < m.n - 15; i++) {
    const [ax, az] = along(i - 15);
    const [bx, bz] = along(i + 15);
    const turn = Math.acos(Math.min(1, ax * bx + az * bz));
    if (turn > 1e-6) radius = Math.min(radius, 30 / turn);
  }
  tightest = Math.min(tightest, radius);
  check(`${tag} it bends gently`, radius > 110, `tightest curve ${radius.toFixed(0)} m`);
  // Route 9
  const hw = world.highway.pts;
  let over = 0;
  for (let i = A.i; i < B.i; i++) for (let k = 0; k < hw.length / 2 - 1; k++) if (crosses(m.x[i], m.z[i], m.x[i + 1], m.z[i + 1], hw[k * 2], hw[k * 2 + 1], hw[k * 2 + 2], hw[k * 2 + 3])) over++;
  check(`${tag} it crosses Route 9 once`, over === 1, `${over} times`);
  // water and places
  let wet = 0;
  let trespass = '';
  for (let i = A.i; i <= B.i; i++) {
    for (const lat of [-6, 0, 6]) {
      const [x, z] = beside(i, lat);
      if (world.heightAt(x, z) < WATER_LEVEL + 0.6) wet++;
    }
    if (Math.hypot(m.x[i] - world.lake.x, m.z[i] - world.lake.z) < world.lake.r + 30) wet++;
    for (const pd of world.ponds) if (Math.hypot(m.x[i] - pd.x, m.z[i] - pd.z) < pd.r + 10) wet++;
    for (const zn of world.zones) if (zn.id !== ZONE.STATION && Math.hypot(m.x[i] - zn.x, m.z[i] - zn.z) < zn.flat + 8) trespass ||= ZONE_NAMES[zn.id];
  }
  check(`${tag} it keeps off the lake and the ponds`, wet === 0, `${wet} points`);
  check(`${tag} it runs through no other place's ground`, !trespass, trespass);
  if (depot) {
    const c = Math.cos(depot.ry);
    const s = Math.sin(depot.ry);
    let off = 0;
    let sunk = 0;
    let through = 0;
    for (let i = 0; i < m.n; i++) {
      const lx = c * (m.x[i] - depot.x) - s * (m.z[i] - depot.z);
      const lz = s * (m.x[i] - depot.x) + c * (m.z[i] - depot.z);
      if (Math.abs(lx) > 32 || Math.abs(lz) > 40) continue;
      through++;
      off = Math.max(off, Math.abs(lz - DEPOT_TRACK));
      sunk = Math.max(sunk, Math.abs(m.y[i] - (depot.h - RAIL.DROP)));
    }
    check(`${tag} the line runs straight through the depot, along its platform`, through > 60 && off < 0.05, `${through} m of it, ${off.toFixed(3)} m off`);
    check(`${tag} ...level, a platform's height below the yard`, sunk < 1e-6 && rail.decks.some((d) => Math.abs(d.top - (depot.h - RAIL.DROP + RAIL.FLOOR)) < 1e-6), `${sunk.toFixed(3)} m off`);
  }
  // the train
  const cars = rail.train.cars;
  const open = cars.filter((c) => c.kind === 'open');
  const hx = rail.crossings.find((o) => o.kind === 2);
  let stray = 0;
  for (const c of cars) {
    if (rail.dist(c.x, c.z) > 0.6) stray++;
    if (depot && Math.hypot(c.x - depot.x, c.z - depot.z) < depot.flat + 20) stray++;
    if (hx && Math.hypot(c.x - hx.x, c.z - hx.z) < 40) stray++;
    for (const zn of world.zones) if (zn.id !== ZONE.STATION && Math.hypot(c.x - zn.x, c.z - zn.z) < zn.flat + 6) stray++;
  }
  check(`${tag} a train stands on it away from the depot: a locomotive and five cars, two of them open`, cars.length === 6 && cars[0].kind === 'loco' && open.length === 2 && stray === 0, `${cars.length} cars, ${open.length} open, ${stray} out of place`);
  // the tunnel mouths
  for (const p of rail.portals) {
    const cover = world.heightAt(p.x + p.dx * 12, p.z + p.dz * 12) - p.y;
    check(`${tag} the ${p === A ? 'first' : 'second'} tunnel mouth is set into a hill`, cover > 5 && Math.max(Math.abs(p.x + p.dx * RAIL.BORE), Math.abs(p.z + p.dz * RAIL.BORE)) < MAP_HALF - 4, `${cover.toFixed(1)} m of hill behind it`);
  }
  // roads: every crossing of the main line has its planks
  let bare = 0;
  let found = 0;
  for (const road of world.roads) {
    const p = road.pts;
    for (let k = 0; k < p.length / 2 - 1; k++) {
      for (let i = A.i; i < B.i; i++) {
        if (Math.abs(p[k * 2] - m.x[i]) > 4 || Math.abs(p[k * 2 + 1] - m.z[i]) > 4) continue;
        if (!crosses(m.x[i], m.z[i], m.x[i + 1], m.z[i + 1], p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3])) continue;
        found++;
        if (!rail.crossings.some((o) => Math.abs(o.i - i) < 9)) bare++;
      }
    }
  }
  check(`${tag} every road and trail that crosses it has a plank crossing`, bare === 0 && rail.crossings.length >= 1, `${found} crossings of the centre lines, ${rail.crossings.length} sets of planks, ${bare} without`);
  if (sweep) continue;

  // ---- the bed
  let rough = 0;
  let info = '';
  for (let i = A.i + 1; i < B.i; i++) {
    // (under the sleepers: further out the heightfield, a point every 2 m, is already on its way up a cutting)
    for (const lat of [-1.5, -0.75, 0, 0.75, 1.5]) {
      const [x, z] = beside(i, lat);
      const d = Math.abs(world.heightAt(x, z) - m.y[i]);
      if (d < 0.035) continue;
      rough++;
      info ||= `${d.toFixed(2)} m off at point ${i} (/tp ${x.toFixed(0)} ${z.toFixed(0)})`;
    }
  }
  check(`${tag} the bed is level from side to side`, rough === 0 || rail.humps > 0, info);
  let steep = 0;
  let worst = 0;
  for (const o of rail.crossings) {
    // a road comes to its planks on the level: the ground under it at the planks is the bed, and no more than a
    // gentle ramp away from it 3 to 6 m out along the road
    if (Math.abs(world.heightAt(o.x, o.z) - o.y) > 0.035) steep++;
    for (const road of world.roads) {
      const p = road.pts;
      for (let k = 0; k < p.length; k += 2) {
        const d = Math.hypot(p[k] - o.x, p[k + 1] - o.z);
        if (d < 3 || d > 6 || rail.dist(p[k], p[k + 1]) < 2.5) continue;
        const rise = Math.abs(world.heightAt(p[k], p[k + 1]) - o.y) / d;
        worst = Math.max(worst, rise);
        if (rise > 0.15) steep++;
      }
    }
  }
  check(`${tag} a road meets the line on the level`, steep === 0, `${steep} points of ${rail.crossings.length} crossings off, steepest ramp ${(worst * 100).toFixed(0)}%`);
  // nothing solid on it, outside the train: a survivor walks it from each mouth to the end of the train
  const head = rail.train.i - 45;
  const tail = rail.train.i + 45;
  const stretch = (a, b) => {
    const pts = [];
    for (let i = a; a < b ? i <= b : i >= b; i += a < b ? 4 : -4) pts.push([m.x[i], m.z[i]]);
    return pts;
  };
  for (const [name, pts] of [['first', stretch(A.i + 2, head)], ['second', stretch(B.i - 2, tail)]]) {
    const w = walk(world, pts, 200);
    check(`${tag} a survivor walks the line from the ${name} tunnel mouth to the train`, w.ok, w.ok ? '' : `stopped at /tp ${w.s.x.toFixed(1)} ${w.s.z.toFixed(1)}, ${pts.length - w.lost} points short`);
  }
  // the nav grid: the line is open ground
  const nav = new Nav(world);
  let shut = 0;
  for (let i = A.i + 3; i < B.i - 3; i++) if ((i < head - 6 || i > tail + 6) && nav.isBlocked(m.x[i], m.z[i])) shut++;
  check(`${tag} the nav grid has the line as open ground`, shut === 0, `${shut} blocked cells on it`);

  // ---- the tunnels: shut a few metres in
  for (const p of rail.portals) {
    const far = [p.x + p.dx * 60, p.z + p.dz * 60];
    const w = walk(world, [[p.x - p.dx * 6, p.z - p.dz * 6], far], 12);
    const depth = (w.s.x - p.x) * p.dx + (w.s.z - p.z) * p.dz;
    check(`${tag} the ${p === A ? 'first' : 'second'} tunnel is blocked by its cave-in`, depth > 1.5 && depth < RAIL.BORE, `a survivor gets ${depth.toFixed(1)} m in`);
    // ...and it is a tunnel: stone overhead in the bore
    const roof = world.staticGrid.query(p.x + p.dx * 2.5, p.z + p.dz * 2.5, 0.5, []).some((c) => c.y0 > p.y + 3 && footprintContains(c, p.x + p.dx * 2.5, p.z + p.dz * 2.5));
    check(`${tag} ...with stone over it`, roof);
  }

  // ---- the open boxcars
  const floor = cars[0].y + RAIL.FLOOR;
  const side = (c, s, lat) => [c.x + c.tx * s + c.tz * rail.bank.side * lat, c.z + c.tz * s - c.tx * rail.bank.side * lat];
  const mine = world.containers.filter((c) => c.zone === ZONE.STATION && Math.hypot(c.x - rail.bank.x, c.z - rail.bank.z) < 30);
  check(`${tag} the train's freight is there to search`, mine.filter((c) => c.ctype === CONT.FREIGHT).length >= 3, `${mine.length} containers, ${mine.filter((c) => c.ctype === CONT.FREIGHT).length} of them freight crates`);
  open.forEach((car, k) => {
    const name = k ? 'second' : 'first';
    // in from the bank, over the dock and through the doorway to the far end
    const w = walk(world, [rail.spots.train, side(car, 0, 4), side(car, 0, 0.4), side(car, -3.5, 0.3)], 20);
    const inside = Math.abs((w.s.x - car.x) * car.tz - (w.s.z - car.z) * car.tx) < 1.4;
    check(`${tag} a survivor walks from the bank into the ${name} open boxcar`, w.ok && inside && Math.abs(w.s.y - floor) < 0.02, `ended at ${w.s.x.toFixed(1)}, ${w.s.y.toFixed(2)}, ${w.s.z.toFixed(1)} (floor ${floor.toFixed(2)})`);
    check(`${tag} ...whose floor is the floor there`, world.floorAt(car.x, car.z, floor + 0.1) === floor && world.floorAt(car.x, car.z, cars[0].y + 0.1) < floor - 1);
    // what is in it
    const held = world.containers.filter((c) => Math.abs((c.x - car.x) * car.tz - (c.z - car.z) * car.tx) < 1.45 && Math.abs((c.x - car.x) * car.tx + (c.z - car.z) * car.tz) < 6.1);
    let out = 0;
    for (const c of held) {
      let ok = false;
      for (let s = -5.2; s <= 5.2 && !ok; s += 0.4) {
        for (const lat of [-0.6, 0, 0.6]) {
          const [x, z] = side(car, s, lat);
          const pos = { x, y: floor, z };
          if (resolveBody(world, pos, PLAYER_RADIUS, PLAYER_HEIGHT) || Math.hypot(c.x - x, c.z - z) > 2.8) continue;
          ok = ok || canReach(world, x, floor + EYE_HEIGHT, z, c.x, c.y, c.z, floor + EYE_HEIGHT);
        }
      }
      if (!ok) out++;
    }
    check(`${tag} ...and what it holds can be searched from inside it`, held.length >= 2 && out === 0, `${held.length} containers, ${out} out of reach`);
    // its doorway
    const [dx, dz] = side(car, 0, 1.45);
    const o = world.openingNear(dx, dz, 0.5);
    check(`${tag} ...its doorway takes door boards at the level of its floor`, !!o && Math.abs(o.y - floor) < 1e-6 && o.w <= 1.75, o ? `opening at ${o.y.toFixed(2)}, ${o.w} m wide` : 'no opening there');
    const back = walk(world, [side(car, -3.5, 0.3), side(car, 0, 0.4), side(car, 0, 5), rail.spots.train], 20, floor + 0.1);
    check(`${tag} ...and lets them out again`, back.ok && Math.abs(back.s.y - rail.bank.y) < 0.3);
    // The dead: the flow field of a survivor at the far end of the car leads there from the bank, and from the far
    // side of the train (round an end of it or through a gap between two cars) up onto the bank to the doorway.
    // (From the far side it may bring one along the side of the car to the doorway's jamb, where a body cannot cut
    // the corner the field cuts: a zombie there sidesteps until it is free, or stays. Only the field is held to it.)
    const at = side(car, -3.5, 0.3);
    nav.computeField(7, at[0], at[1]);
    const to = { x: at[0], y: floor, z: at[1] };
    for (const [from, where, strict] of [[side(car, 9, 12), 'the bank', true], [side(car, -4, -16), 'the far side of the train', false]]) {
      const f = follow(world, nav, 7, from, to);
      check(`${tag} the dead find their way into the ${name} open boxcar from ${where}`, f.reached && (strict ? f.near < 2.2 && f.dy < 0.5 : f.near < 4 && f.dy < 0.5), `${f.reached ? '' : 'the field does not reach there, '}nearest ${f.near.toFixed(1)} m, feet ${f.dy.toFixed(2)} m off${f.stuck ? `, held up at /tp ${f.stuck[0].toFixed(1)} ${f.stuck[1].toFixed(1)}` : ''}`);
    }
    nav.removeField(7);
  });
  // the rest of the train is solid: nobody walks through a car
  for (const car of cars) {
    const w = walk(world, [[car.x + car.tz * 6, car.z - car.tx * 6], [car.x - car.tz * 6, car.z + car.tx * 6]], 6);
    const through = (w.s.x - car.x) * car.tz - (w.s.z - car.z) * car.tx < -1.6 && w.s.y < car.y + 0.5;
    if (car.kind !== 'open') check(`${tag} nobody walks through the ${car.kind} car`, !through);
  }

  // ---- the depot: the dead come up onto the platform after a survivor on it
  if (depot) {
    const dw = (lx, lz) => [depot.x + Math.cos(depot.ry) * lx + Math.sin(depot.ry) * lz, depot.z - Math.sin(depot.ry) * lx + Math.cos(depot.ry) * lz];
    const top = depot.h - RAIL.DROP + RAIL.FLOOR;
    const at = dw(9, DEPOT_TRACK - 2.6);
    const w = walk(world, [rail.spots.depot, dw(-9.5, -2), dw(-9.5, 5.5), at], 20);
    check(`${tag} a survivor walks from the front of the station house round onto the platform`, w.ok && Math.abs(w.s.y - top) < 0.02, `ended at ${w.s.y.toFixed(2)}, platform ${top.toFixed(2)}`);
    nav.computeField(8, at[0], at[1]);
    for (const [from, where] of [[rail.spots.depot, 'the yard'], [dw(4, DEPOT_TRACK + 14), 'beyond the tracks']]) {
      const f = follow(world, nav, 8, from, { x: at[0], y: top, z: at[1] });
      check(`${tag} the dead come up onto the platform from ${where}`, f.reached && f.near < 2.2 && f.dy < 0.5, `${f.reached ? '' : 'the field does not reach there, '}nearest ${f.near.toFixed(1)} m, feet ${f.dy.toFixed(2)} m off${f.stuck ? `, held up at /tp ${f.stuck[0].toFixed(1)} ${f.stuck[1].toFixed(1)}` : ''}`);
    }
    nav.removeField(8);
    // the siding: two cars on it, and its end
    const sd = rail.siding;
    const end = dw(21, DEPOT_TRACK);
    check(`${tag} the siding runs beside the main line to its buffer`, Math.abs(Math.hypot(sd.x[sd.n - 1] - end[0], sd.z[sd.n - 1] - end[1]) - RAIL.SIDING) < 0.01 && Math.hypot(sd.x[0] - dw(-32, DEPOT_TRACK)[0], sd.z[0] - dw(-32, DEPOT_TRACK)[1]) < 0.01);
  }
}

if (sweep) {
  console.log(`railway plan: ${lines} of ${SEEDS.length} valleys have the line, ${depots} the depot; steepest ${(worstGrade * 100).toFixed(2)}%, tightest curve ${tightest.toFixed(0)} m, ${humps} beds moved by the mine  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
}

// ---------------------------------------------------------------- a game on the first of them
{
  const seed = SEEDS[0];
  const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
  const tag = `[game ${seed}]`;
  const c = { id: 0 };
  c.session = game.onOpen({
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  });
  {
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str('Ada');
    game.onMessage(c.session, w.bytes().slice());
  }
  const p = game.players.get(c.id);
  const put = (x, y, z) => {
    const s = p.state;
    [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.onGround] = [x, y, z, 0, 0, 0, 1];
  };
  const run = (secs, until) => {
    for (let t = 0; t < secs * SERVER_TICK_RATE; t++) {
      game.update();
      if (until?.()) return t / SERVER_TICK_RATE;
    }
    return -1;
  };
  const clear = () => {
    for (const z of [...game.zombies]) if (!z.dead) game.combat.killZombie(z, null, {});
    run(2);
  };
  run(0.5);
  const world = game.world;
  const rail = world.rail;
  const car = rail.train.cars.find((k) => k.kind === 'open');
  const floor = car.y + RAIL.FLOOR;
  const side = (s, lat) => [car.x + car.tx * s + car.tz * rail.bank.side * lat, car.z + car.tz * s - car.tx * rail.bank.side * lat];

  // ---- the debug commands
  game.debugCommand(p, ['train']);
  check(`${tag} /train puts a survivor on the loading bank beside the train`, Math.hypot(p.state.x - rail.spots.train[0], p.state.z - rail.spots.train[1]) < 0.01 && Math.abs(p.state.y - rail.bank.y) < 0.3);
  game.debugCommand(p, ['depot']);
  check(`${tag} /depot puts them in front of the station house`, world.zoneAt(p.state.x, p.state.z) === ZONE.STATION);

  // ---- the freight: a crate gives what its table holds
  {
    const crate = game.caches.find((k) => k.ctype === CONT.FREIGHT);
    const rows = new Set(CONT_TABLES[CONT_DEFS[CONT.FREIGHT].table].map((row) => row[0]));
    put(crate.x, crate.y, crate.z);
    p.inv.fill(null);
    const before = game.items.length;
    game.searchCache(p, crate);
    const got = [...p.inv.filter(Boolean).map((it) => it.item), ...game.items.slice(before).map((e) => e.item)];
    check(`${tag} a freight crate gives freight`, crate.state === 1 && got.length >= 2 && got.every((it) => rows.has(it)), `items ${got.join(' ')}`);
  }

  // ---- the dead come into the boxcar after a survivor
  clear();
  {
    const at = side(-3.5, 0.3);
    put(at[0], floor, at[1]);
    const from = side(8, 14);
    const z = game.zm.spawn(ZTYPE.RUNNER, from[0], from[1]);
    z.aggroId = p.id;
    z.aggroT = 600;
    const t = run(30, () => Math.hypot(z.x - at[0], z.z - at[1]) < 2 && Math.abs(z.y - floor) < 0.3);
    check(`${tag} a zombie on the bank comes into the boxcar after a survivor in it`, t >= 0, t >= 0 ? `in ${t.toFixed(1)} s` : `it is at ${z.x.toFixed(1)}, ${z.y.toFixed(2)}, ${z.z.toFixed(1)}, ${Math.hypot(z.x - at[0], z.z - at[1]).toFixed(1)} m off`);
  }

  // ---- boarded up: door boards in the doorway, a torch on the floor, and a zombie that has to break in
  clear();
  {
    const at = side(-3.5, 0.3);
    put(at[0], floor, at[1]);
    p.inv.fill(null);
    p.inv[0] = { item: ITEM.WOOD, count: 20 };
    p.inv[1] = { item: ITEM.NAILS, count: 20 };
    p.inv[2] = { item: ITEM.TORCH, count: 2 };
    p.inv[3] = { item: ITEM.STICK, count: 20 };
    p.inv[4] = { item: ITEM.CLOTH, count: 20 };
    p.state.slot = SLOT_BUILD;
    p.actionT = -1;
    const before = game.structures.length;
    const [dx, dz] = side(0, 1.45);
    game.build(p, STRUCT.DOOR, dx, dz, 0);
    const door = game.structures[game.structures.length - 1];
    const built = game.structures.length === before + 1;
    check(`${tag} door boards go up in the doorway of a boxcar, on its floor`, built && door.stype === STRUCT.DOOR && Math.abs(door.y - floor) < 1e-6, built ? `at ${door.y.toFixed(2)}, floor ${floor.toFixed(2)}` : 'refused');
    p.actionT = -1;
    const [tx, tz] = side(-1.5, 0.3);
    game.build(p, STRUCT.TORCH, tx, tz, 0);
    const torch = game.structures[game.structures.length - 1];
    check(`${tag} ...and a torch stands on that floor`, game.structures.length === before + 2 && torch.stype === STRUCT.TORCH && Math.abs(torch.y - floor) < 1e-6, game.structures.length === before + 2 ? `at ${torch.y.toFixed(2)}` : 'refused');
    // what is dropped in there lies on the floor
    game.dropItem(ITEM.SCRAP, 1, at[0], floor + 1, at[1]);
    const it = game.items[game.items.length - 1];
    check(`${tag} ...and what is dropped in the car lies on it`, !!it && Math.abs(it.y - floor) < 0.3, it ? `at ${it.y.toFixed(2)}` : '');
    if (built) {
      const from = side(8, 14);
      const z = game.zm.spawn(ZTYPE.WALKER, from[0], from[1]);
      z.aggroId = p.id;
      z.aggroT = 600;
      const hp = door.hp;
      const t = run(60, () => door.hp < hp || door.dead);
      const inside = Math.abs((z.x - car.x) * car.tz - (z.z - car.z) * car.tx) < 1.4 && Math.abs((z.x - car.x) * car.tx + (z.z - car.z) * car.tz) < 6;
      check(`${tag} a zombie after them has to break the boards down`, t >= 0 && !inside, t >= 0 ? `first blow after ${t.toFixed(1)} s` : `it is at ${z.x.toFixed(1)}, ${z.y.toFixed(2)}, ${z.z.toFixed(1)}${inside ? ' (inside)' : ''}`);
    }
  }
}
console.log(`railway: ${lines} lines and ${depots} depots in ${SEEDS.length} valleys (seeds ${SEEDS.join(', ')}); steepest ${(worstGrade * 100).toFixed(2)}%, tightest curve ${tightest.toFixed(0)} m  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
