// The mainland (shared/mainland.js): the second map of a run, twice the island across. This generates it for a
// handful of seeds and checks what the server and the client count on:
//   - it is the same world every time for a seed, another for another seed, 1280 m across at 1/32 m on the wire
//   - every field the game reads is there: the places, the plane and its runway, the bridge, the parts' set places
//   - positions at its far corners go through the snapshot's quantisation and come back within half a step
//   - nothing solid stands in anything else, and every prop stands on something (the ground, a floor, another prop)
//   - every doorway can be walked through; every container, loot point and part spot of a place can be used on foot
//     (scripts/worldcheck.js: the checks test-world.js makes of the island)
//   - every part spot, container and loot point, and the plane, can be walked to from the bridgehead on the nav grid
//     the dead are steered by (server/nav.js)
//   - the plane's take-off run is clear, and the city has its skyline
//   - the line the car takes over the bridge stays on the deck, clear of every hole and wreck, on the side of the
//     broken span that still stands
// usage: node scripts/test-mainland.js [--seeds a-b | a,b,c]
import { createHash } from 'node:crypto';
import { createMainland } from '../shared/mainland.js';
import { worldFor } from '../shared/worlds.js';
import { WORLD, MAINLAND_SIZE } from '../shared/acts.js';
import { ZONE, ZONE_NAMES, PLANE_PARTS, PLANE_NEED } from '../shared/defs.js';
import { PROPS } from '../shared/props.js';
import { BRIDGE } from '../shared/bridge.js';
import { usePos, qpos, dqpos, POS_SCALE_WIDE } from '../shared/protocol.js';
import { COL, footprintContains } from '../shared/collision.js';
import { GRID_STEP, WATER_LEVEL } from '../shared/constants.js';
import { Nav } from '../server/nav.js';
import { checkWorld, walksThrough, solidsOf } from './worldcheck.js';

const arg = process.argv.indexOf('--seeds');
const spec = arg > 0 ? process.argv[arg + 1] : '1-6';
const SEEDS = spec.includes('-') ? Array.from({ length: +spec.split('-')[1] - +spec.split('-')[0] + 1 }, (_, i) => +spec.split('-')[0] + i) : spec.split(',').map(Number);

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}
// a check made on every seed: one line, naming the seeds it failed on
const perSeed = new Map();
function each(name, seed, ok, detail = '') {
  if (!perSeed.has(name)) perSeed.set(name, []);
  if (!ok) perSeed.get(name).push(`seed ${seed}${detail ? `: ${detail}` : ''}`);
}

// everything a world is, as one number: two worlds are the same world when these are
function fingerprint(w) {
  const h = createHash('sha256');
  for (const a of [w.heights, w.roadDist, w.roadKind, w.trees, w.rocks, w.bushes]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  for (const list of [w.parts, w.props, w.containers, w.lootSpawns, w.partSpots, w.openings, w.roofs, w.lights, w.resourceSpawns, w.hordeSpawns, w.spawnPoints, w.zones, w.sites, w.car, w.runway, w.bridge.spans, w.bridge.holes, w.bridge.wrecks]) h.update(JSON.stringify(list));
  const cols = [];
  const seen = new Set();
  for (const cell of w.staticGrid.cells) {
    for (const c of cell) {
      if (seen.has(c)) continue;
      seen.add(c);
      cols.push([c.x, c.z, c.y0, c.y1, c.hx, c.hz, c.flags]);
    }
  }
  h.update(JSON.stringify(cols.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])));
  return { hash: h.digest('hex').slice(0, 16), colliders: cols.length };
}

const NDI = [1, -1, 0, 0, 1, 1, -1, -1]; // (the nav grid's neighbours, in its order: server/nav.js)
const NDJ = [0, 0, 1, -1, 1, -1, 1, -1];
// every cell of the nav grid the dead can walk to from (x, z)
function reachable(nav, x, z) {
  const S = nav.size;
  const seen = new Uint8Array(S * S);
  const queue = new Int32Array(S * S);
  let tail = 0;
  const start = nav._cellIndex(x, z);
  seen[start] = 1;
  queue[tail++] = start;
  for (let head = 0; head < tail; head++) {
    const k = queue[head];
    const i = k % S;
    const j = (k - i) / S;
    for (let n = 0; n < 8; n++) {
      const ni = i + NDI[n];
      const nj = j + NDJ[n];
      if (ni < 0 || nj < 0 || ni >= S || nj >= S) continue;
      const nk = nj * S + ni;
      if (seen[nk] || nav.blocked[nk] || nav.edge[k] & (1 << n)) continue;
      if (n >= 4 && (nav.blocked[k + NDI[n]] || nav.blocked[k + NDJ[n] * S])) continue;
      seen[nk] = 1;
      queue[tail++] = nk;
    }
  }
  // is a cell within r of (px, pz) one of them?
  return (px, pz, r) => {
    for (let dj = -Math.ceil(r); dj <= Math.ceil(r); dj++) {
      for (let di = -Math.ceil(r); di <= Math.ceil(r); di++) {
        const i = Math.floor(px + nav.half) + di;
        const j = Math.floor(pz + nav.half) + dj;
        if (i < 0 || j < 0 || i >= S || j >= S || !seen[j * S + i]) continue;
        if (Math.hypot(i - nav.half + 0.5 - px, j - nav.half + 0.5 - pz) <= r) return true;
      }
    }
    return false;
  };
}

// two boxes seen from above (centre, half sizes, yaw): do they meet? By separating axes.
function boxesMeet(a, b) {
  for (const o of [a, b]) {
    const c = Math.cos(o.ry);
    const s = Math.sin(o.ry);
    for (const [ax, az] of [[c, -s], [s, c]]) {
      const ext = (q) => q.hx * Math.abs(Math.cos(q.ry) * ax - Math.sin(q.ry) * az) + q.hz * Math.abs(Math.sin(q.ry) * ax + Math.cos(q.ry) * az);
      if (Math.abs((a.x - b.x) * ax + (a.z - b.z) * az) >= ext(a) + ext(b)) return false;
    }
  }
  return true;
}

const t0 = performance.now();
const stats = [];
const found = new Map();
const mapsWith = {};
const counts = { door: 0, reach: 0, solid: 0, road: 0, props: 0 };
const prints = new Map();
const REACH = 2.5; // m from a thing to a cell the dead can stand in (a container is inside its own prop's cells)

for (const seed of SEEDS) {
  const tg = performance.now();
  const w = createMainland(seed);
  const genMs = performance.now() - tg;
  const fp = fingerprint(w);
  prints.set(seed, fp.hash);
  if (seed === SEEDS[0]) {
    check('the same seed builds the same mainland twice', fingerprint(createMainland(seed)).hash === fp.hash, fp.hash);
    const viaActs = worldFor(seed, WORLD.MAINLAND);
    check('...and worldFor(seed, the mainland) is it', fingerprint(viaActs).hash === fp.hash && viaActs.kind === WORLD.MAINLAND);
    check('...and the island of that seed is another world, half as far across', worldFor(seed, WORLD.ISLAND).size * 2 === w.size);
  }

  // ---- what it is
  each('it is 1280 m across, at 1/32 m on the wire', seed, w.kind === WORLD.MAINLAND && w.size === MAINLAND_SIZE && w.half === MAINLAND_SIZE / 2 && w.gridN === MAINLAND_SIZE / GRID_STEP + 1 && w.posScale === POS_SCALE_WIDE && w.heights.length === w.gridN ** 2);
  const need = [ZONE.BRIDGEHEAD, ZONE.CITY, ZONE.INDUSTRIAL, ZONE.SUBURB, ZONE.TRUCKSTOP, ZONE.TERMINAL, ZONE.HANGARS, ZONE.FUEL_DEPOT];
  const zoneOk = (zn) => zn && [zn.x, zn.z, zn.ry, zn.h, zn.flat, zn.blend, zn.clear].every(Number.isFinite) && Math.max(Math.abs(zn.x), Math.abs(zn.z)) + zn.flat < w.half - 20 && w.heightAt(zn.x, zn.z) > WATER_LEVEL + 0.5;
  each('every place is on it, inside the map and dry', seed, need.every((id) => zoneOk(w.zoneById[id])) && w.zones.length === need.length, need.filter((id) => !zoneOk(w.zoneById[id])).map((id) => ZONE_NAMES[id]).join(', '));
  const fields = ['heightAt', 'floorAt', 'rayTerrain', 'isDeepWater', 'zoneAt', 'roadDistAt', 'roadKindAt', 'openingNear', 'darkAt', 'roads', 'highway', 'sea', 'trees', 'rocks', 'bushes', 'parts', 'props', 'lights', 'roofs', 'staticGrid', 'structGrid', 'colliderGrids', 'lootSpawns', 'containers', 'partSpots', 'openings', 'sites', 'resourceSpawns', 'hordeSpawns', 'spawnPoints', 'start', 'car', 'bridge', 'runway', 'city'];
  each('every field the game reads of a world is there', seed, fields.every((k) => w[k] !== undefined && w[k] !== null) && w.mine === null && w.rail === null && w.fair === null && w.clinic === null && w.cemetery === null && w.darkAt(0, 0, 0) === 0, fields.filter((k) => w[k] === undefined || w[k] === null).join(', '));
  // the parts, at their set places
  const at = PLANE_PARTS.map((_, i) => w.partSpots.filter((sp) => sp.supply === i));
  const where = [[ZONE.HANGARS], [ZONE.CITY], [ZONE.INDUSTRIAL], [ZONE.TERMINAL], [ZONE.FUEL_DEPOT, ZONE.HANGARS, ZONE.INDUSTRIAL]];
  each('every part of the plane has its set places: two or more each, four or more for the fuel', seed, at.every((list, i) => list.length >= (PLANE_NEED[i] > 1 ? 4 : 2) && list.every((sp) => where[i].includes(sp.zone))) && w.partSpots.every((sp) => sp.supply >= 0 && sp.supply < PLANE_PARTS.length), at.map((l) => l.length).join(' '));
  // the bridgehead
  const sp = w.spawnPoints;
  const solidAt = (x, y, z) => w.staticGrid.query(x, z, 0.5, []).some((c) => !(c.flags & COL.NOBLOCK) && y + 0.5 < c.y1 && y + 1.7 > c.y0 && footprintContains(c, x, z, 0.36));
  each('eight spawn points at the bridgehead, each with room to stand', seed, sp.length === 8 && sp.every((p) => Math.hypot(p.x - w.start.x, p.z - w.start.z) < 14 && !solidAt(p.x, w.heightAt(p.x, p.z), p.z)) && w.zoneAt(w.start.x, w.start.z) === ZONE.BRIDGEHEAD);
  const car = w.props.find((p) => p.type === 'car');
  const b = w.bridge;
  each('the car they came in stands at the bridgehead, nose inland, 20 m of clear road behind it', seed, !!car && car.live === true && Math.abs(car.z - b.z) < 1 && car.x - b.x1 >= 20 && Math.abs(Math.sin(car.ry) + 1) < 0.02 && !w.props.some((p) => p !== car && PROPS[p.type] && (PROPS[p.type].boxes || PROPS[p.type].cyls) && p.x > b.x1 - 1 && p.x < car.x - 3 && Math.abs(p.z - b.z) < 1.6), car ? `x ${car.x.toFixed(1)}, abutment ${b.x1.toFixed(1)}` : 'no car');
  // the plane and its runway
  const r = w.runway;
  const plane = w.props.find((p) => p.type === 'plane_wreck');
  each('the plane stands at the south end of the runway, nose to the north, the fuel truck beside it', seed, w.car.plane === true && w.car.ry === 0 && w.car.x === r.x && w.car.z > r.z1 - 40 && w.car.z < r.z1 && !!plane && plane.live === true && plane.x === w.car.x && plane.z === w.car.z && Math.abs(plane.y - w.heightAt(plane.x, plane.z)) < 0.12 && w.props.some((p) => p.type === 'fuel_truck' && p.x === r.truck.x && p.z === r.truck.z) && Math.hypot(r.truck.x - w.car.x, r.truck.z - w.car.z) < 30);
  let inWay = '';
  for (let z = w.car.z - 14; z >= r.z0 && !inWay; z -= 1.5) { // (from ahead of the plane's own nose and engines)
    for (const c of w.staticGrid.query(r.x, z, 9, [])) if (!(c.flags & COL.NOBLOCK) && c.y1 > r.y + 0.3 && footprintContains(c, r.x, z, 7)) inWay = `something solid at ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`;
    if (Math.abs(w.heightAt(r.x, z) - r.y) > 0.25) inWay = `the runway is not level at z ${z.toFixed(0)}`;
  }
  each('the take-off run is level and clear, 7 m either side of its line', seed, !inWay, inWay);
  // the skyline
  const cityH = w.zoneById[ZONE.CITY].h;
  const tall = w.parts.filter((p) => p.shape === 'box' && p.mat === 'concrete' && !p.rx && !p.rz && p.sx > 8 && p.sz > 8 && p.y + p.sy / 2 - cityH >= 20).map((p) => p.y + p.sy / 2 - cityH);
  each('the city has its skyline: three to five towers, 20 to 42 m', seed, tall.length >= 3 && tall.length <= 5 && Math.max(...tall) <= 42 && Math.max(...tall) >= 30, tall.map((h) => h.toFixed(0)).join(' '));
  const kinds = new Set(w.city.lots.map((l) => l.what));
  each('...and what the run needs of it: two parts shops, a police station, a pharmacy, a hardware store', seed, w.city.lots.filter((l) => l.what === 'aero').length === 2 && ['police', 'pharmacy', 'hardware', 'tower', 'office'].every((k) => kinds.has(k)), [...kinds].join(' '));

  // ---- quantisation: the far corners, and a walk across
  usePos(w);
  const lim = w.half - 3;
  let worst = 0;
  let clamped = false;
  const probe = [-lim, lim, -w.half, w.half, 0, 0.015, -0.015, lim - 1 / 3, -lim + 1 / 7];
  for (let k = 0; k < 400; k++) probe.push(-w.half + (k * 3.2000001 + 0.0137 * k));
  for (const v of probe) {
    const q = qpos(v);
    if (q <= -32768 || q >= 32767) clamped = true;
    worst = Math.max(worst, Math.abs(dqpos(q) - v));
  }
  each('positions out to its corners go through the wire and come back within half a step of 1/32 m', seed, !clamped && worst <= 0.5 / POS_SCALE_WIDE + 1e-9, `worst ${(worst * 1000).toFixed(1)} mm${clamped ? ', clamped' : ''}`);

  // ---- the layout: doors, reach, solids in solids, roads through walls (as test-world.js checks the island)
  checkWorld(w, seed, { found, mapsWith, counts });
  // (...and the doorways of what is no named place: the farms, the sheds)
  const stuck = w.openings.filter((o) => !w.zones.some((zn) => Math.hypot(o.x - zn.x, o.z - zn.z) < zn.flat + 6) && ![1, -1].every((dir) => walksThrough(w, o, dir)));
  each('the doorways out in the country can be walked through too', seed, !stuck.length, stuck.slice(0, 3).map((o) => `/tp ${o.x.toFixed(1)} ${o.z.toFixed(1)}`).join('; '));

  // ---- nothing floats, nothing is sunk: every solid prop stands on the ground, a floor or another prop
  const solids = solidsOf(w);
  const slabs = w.parts.filter((p) => p.shape === 'box' && !p.rx && !p.rz);
  const adrift = [];
  for (const p of w.props) {
    const def = PROPS[p.type];
    if (!def || !(def.boxes || def.cyls)) continue;
    let under = w.heightAt(p.x, p.z);
    for (const q of slabs) {
      const top = q.y + q.sy / 2;
      if (top > p.y + 0.3 || top <= under) continue;
      const c = Math.cos(q.ry);
      const s = Math.sin(q.ry);
      if (Math.abs(c * (p.x - q.x) - s * (p.z - q.z)) <= q.sx / 2 && Math.abs(s * (p.x - q.x) + c * (p.z - q.z)) <= q.sz / 2) under = top;
    }
    for (const o of solids) if (o.id !== p && o.id !== 'wall' && typeof o.id === 'object' && o.y1 <= p.y + 0.3 && o.y1 > under && Math.hypot(o.x - p.x, o.z - p.z) < Math.max(o.hx, o.hz, o.r)) under = o.y1;
    // (on a slope a prop is seated on the ground under its lowest corner: its middle may be that much in)
    const span = Math.hypot(def.size[0], def.size[2]) / 2;
    if (p.y - under > 0.08 || under - p.y > 0.12 + span * 0.35) adrift.push(`${p.type} ${(p.y - under).toFixed(2)} m off what is under it (/tp ${p.x.toFixed(1)} ${p.z.toFixed(1)})`);
  }
  each('every prop stands on the ground, a floor or another prop', seed, !adrift.length, `${adrift.length}: ${adrift.slice(0, 3).join('; ')}`);

  // ---- the nav grid: everything worth walking to can be walked to from the bridgehead
  const tn = performance.now();
  const nav = new Nav(w);
  const near = reachable(nav, sp[0].x, sp[0].z);
  const navMs = performance.now() - tn;
  const lost = [];
  for (const [list, name] of [[w.partSpots, 'part spot'], [w.containers, 'container'], [w.lootSpawns, 'loot'], [w.resourceSpawns, 'woodland loot'], [w.spawnPoints, 'spawn point'], [[w.car, r.truck], 'plane / fuel truck']]) {
    for (const o of list) if (!near(o.x, o.z, name === 'plane / fuel truck' ? 9 : REACH)) lost.push(`${name} at /tp ${o.x.toFixed(1)} ${o.z.toFixed(1)}`);
  }
  each('every part spot, container and loot point, and the plane, is walked to from the bridgehead on the nav grid', seed, !lost.length, `${lost.length}: ${lost.slice(0, 4).join('; ')}`);
  for (const zn of w.zones) if (!near(zn.x, zn.z, 12)) lost.push(ZONE_NAMES[zn.id]);

  // ---- the bridge
  const half = BRIDGE.DECK / 2;
  const CAR = { hx: 0.95, hz: 2.3 }; // (the car prop: 1.9 x 4.6)
  let off = '';
  const p = {};
  for (let s = 0; s <= b.len && !off; s += 0.5) {
    b.carAt(s, p);
    const lz = p.z - b.z;
    const me = { x: p.x, z: p.z, hx: CAR.hx + 0.2, hz: CAR.hz + 0.2, ry: p.yaw };
    if (Math.abs(lz) + CAR.hx > half - 0.3) off = `off the deck at ${s} m`;
    const span = b.spans.find((q) => p.x >= q.x0 && p.x <= q.x1);
    if (span && span.state === 'broken' && p.x > span.x0 + 4 && p.x < span.x1 - 4 && lz * span.lost > -(CAR.hx + 0.3)) off = `on the lost half of the broken span at ${s} m`;
    for (const h of b.holes) if (boxesMeet(me, { x: h.x, z: b.z + h.lz, hx: h.len / 2, hz: h.w / 2, ry: 0 })) off = `in a hole at ${s} m`;
    for (const wr of b.wrecks) if (boxesMeet(me, { x: wr.x, z: b.z + wr.lz, hx: PROPS[wr.type].size[0] / 2, hz: PROPS[wr.type].size[2] / 2, ry: wr.ry })) off = `through a ${wr.type} at ${s} m`;
    if (Math.abs(p.y - b.deckY) > 1.2 || Math.abs(Math.sin(p.yaw) + 1) > 0.2) off = `not on the roadway, or not headed across, at ${s} m`;
  }
  const ends = b.carAt(b.len, {});
  each('the line the car takes over the bridge keeps to the deck, clear of every hole and wreck, and ends on the abutment', seed, !off && Math.abs(ends.x - b.x1) < 1e-6 && Math.abs(ends.z - b.z) < 0.05 && b.spans.length === BRIDGE.SPANS && b.spans[0].state === 'fallen' && b.spans.filter((q) => q.state === 'broken').length === 1 && b.wrecks.every((wr) => Math.abs(wr.lz) + PROPS[wr.type].size[0] / 2 < half) && Math.abs(b.x1 - b.x0 - b.len) < 1e-6, off);
  each('...which is where the land begins: the bluff is at the height of the deck there', seed, Math.abs(w.heightAt(b.x1 + 3, b.z) - b.deckY) < 0.3 && w.heightAt(b.x1 - 30, b.z) < WATER_LEVEL, `${w.heightAt(b.x1 + 3, b.z).toFixed(2)} against ${b.deckY}`);

  stats.push({ seed, gen: genMs, nav: navMs, parts: w.parts.length, props: w.props.length, colliders: fp.colliders, trees: w.trees.length / 6, containers: w.containers.length, loot: w.lootSpawns.length });
}

check(`${SEEDS.length} seeds build ${SEEDS.length} different mainlands`, new Set(prints.values()).size === SEEDS.length);
for (const [name, bad] of perSeed) check(name, !bad.length, bad.length ? `(${bad.length} of ${SEEDS.length} seeds) ${bad.slice(0, 3).join(' | ')}` : '');
const round = (v) => Math.round(v * 10) / 10 + 0;
for (const [key, what] of [
  ['door', 'doorways of its places can be walked through both ways'],
  ['reach', 'containers, floor-loot points and part spots can be reached on foot from the front of their place'],
  ['solid', 'of them are clear of anything solid'],
  ['road', 'walls and posts stand clear of the middle of every road'],
  ['props', 'pairs of solids that could meet (props, trees, boulders, walls) stand clear of each other'],
]) {
  const bad = [...found.values()].filter((f) => f.check === key);
  check(`${counts[key]} ${what}`, !bad.length);
  for (const f of bad.slice(0, 12)) console.log(`        ${ZONE_NAMES[f.place]}: ${f.text}, at (${round(f.at[0])}, ${round(f.at[1])}) in the place's frame, on ${f.seeds.length} of ${SEEDS.length} maps (${f.where})`);
}
console.log('');
for (const s of stats) console.log(`seed ${s.seed}: generated in ${s.gen.toFixed(0)} ms (nav grid ${s.nav.toFixed(0)} ms), ${s.parts} parts, ${s.props} props, ${s.colliders} colliders, ${s.trees} trees, ${s.containers} containers, ${s.loot} loot points`);
console.log(`${failed ? `mainland FAILED (${failed})` : 'mainland OK'}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
