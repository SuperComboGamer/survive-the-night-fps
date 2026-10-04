// The mainland: the second map of a run (act 2, shared/acts.js), built from the same seed as the island the team
// escaped from and with the same kit (worldkit.js), so it is drawn, walked and fought on by the code that runs the
// island. It is twice as far across (MAINLAND_SIZE: 1280 m, four times the area) and laid out west to east the way
// the run goes:
//
//   the sea | the bridge comes ashore at the Bridgehead, on a bluff | Route 9 runs east over the coastal plain |
//   Port Calder, a ruined city of streets and blocks | the Mile 9 truck stop | Calder Field: a runway, hangars, a
//   terminal with its tower, a fuel depot, and the plane
//
// with Kessler Ironworks on a spur north or south of the city and the houses of Eastgate on the other side. What a
// seed changes: where the bridge lands, where the city, the ironworks and the airfield sit, what stands on every
// lot of every block, the course of the roads between them, and everything that is scattered.
//
// A world made here has every field createWorld's has (world.js); what the island has and this map does not (the
// mine, the railway, the fair, the clinic, the cemetery) is null. On top of those:
//   bridge   where the bridge is (bridge.js): the cutscene drives the car along it, and the client draws it
//   runway   the runway and what stands on it: { x, z0, z1, half (its half width), y, truck: { x, y, z, ry } }
//   car      is the plane: the thing this act's supplies go into and its final stand is fought at (plane: true)
//   partSpots[i].supply   which of the plane's parts lies there (an index into PLANE_PARTS): they are at set places
import { GRID_STEP, WATER_LEVEL } from './constants.js';
import { ZONE, CONT } from './defs.js';
import { PROPS } from './props.js';
import { mulberry32, createNoise2D, fbm, smoothstep, lerp, clamp } from './rng.js';
import { makeCyl, COL } from './collision.js';
import { ROAD } from './layout.js';
import { createKit } from './worldkit.js';
import { WORLD, MAINLAND_SIZE } from './acts.js';
import { POS_SCALE_WIDE } from './protocol.js';
import { planBridge } from './bridge.js';

const PI = Math.PI;
const SIZE = MAINLAND_SIZE;
const HALF = SIZE / 2;
const N = SIZE / GRID_STEP + 1;
const FLOOR = WATER_LEVEL + 1.2; // soft floor of the land (only the sea and the ponds hold water)
const COAST = -HALF + 78; // x of the shoreline: west of it is the sea
const BLUFF = 9; // the bridge comes ashore on a bluff this high (m over the water line it is BLUFF - WATER_LEVEL)

// The city's grid: streets PITCH apart, each STREET wide between the kerbs, GRID blocks each way.
const PITCH = 56;
const STREET = 12;
const GRID = 4;
const BLOCK = PITCH - STREET; // a block is this far across
const CITY_R = (GRID * PITCH) / 2 + 18; // the levelled ground reaches this far from the middle of the city

// The airfield (local frame of the runway: it runs north-south, the plane at its south end facing north)
const RUNWAY_LEN = 380;
const RUNWAY_HALF = 12;

// vegetation: the island's variants (TREE_TYPES / ROCK_TYPES in world.js, by index)
const TREE_R = [0.42, 0.4, 0.38, 0.3, 0.3, 0.24, 0.34];
const ROCK_R = [0.9, 1.2, 0.7];

export function createMainland(seed) {
  const rng = mulberry32((seed ^ 0x3a17d) >>> 0); // (streams of its own: the island of the same seed draws from others)
  const nA = createNoise2D(seed + 11);
  const nB = createNoise2D(seed + 12);
  const nD = createNoise2D(seed + 14);
  const nE = createNoise2D(seed + 15);

  // ---------------------------------------------------------------- the plan
  const prng = mulberry32((seed ^ 0x9e1b3) >>> 0);
  const zb = prng.range(-80, 80); // where the bridge comes ashore
  const city = { x: prng.range(-215, -175), z: clamp(zb + prng.range(-70, 70), -150, 150) };
  const side = prng.chance(0.5) ? 1 : -1; // the ironworks is north (-1) or south (1) of the city; Eastgate the other way
  const field = { x: HALF - 132, z: prng.range(-70, 70) }; // the middle of the runway
  const works = { x: city.x + prng.range(60, 130), z: city.z + side * prng.range(290, 330) };
  const suburb = { x: city.x + prng.range(150, 200), z: city.z - side * prng.range(215, 245) };
  const stop = { x: prng.range(140, 190), z: lerp(city.z, field.z + 60, 0.5) + prng.range(-30, 30) };
  // the airfield's places hang off the runway: the apron is west of its south half, with the hangars on it, the
  // terminal north of them and the fuel depot north of that, set back from everything
  const plane = { x: field.x, z: field.z + RUNWAY_LEN / 2 - 26 };
  const apron = { x: field.x - 44, z: field.z + 112, hx: 30, hz: 76 }; // (a rectangle of concrete)
  const hangars = { x: field.x - 96, z: field.z + 128 };
  const terminal = { x: field.x - 96, z: field.z + 22 };
  const depot = { x: field.x - 104, z: field.z - 96 };
  const head = { x: COAST + 46, z: zb };

  const zones = [];
  const put = (id, x, z, ry, spec) => zones.push({ id, x, z, ry, h: 0, blend: 26, ...spec });
  put(ZONE.BRIDGEHEAD, head.x, head.z, -PI / 2, { flat: 26, clear: 30, dirt: 0.35, blend: 22 }); // (its front faces east: inland)
  put(ZONE.CITY, city.x, city.z, 0, { flat: CITY_R, clear: CITY_R + 6, blend: 34 });
  put(ZONE.INDUSTRIAL, works.x, works.z, side > 0 ? 0 : PI, { flat: 52, clear: 58, dirt: 0.8 }); // (its front to the city)
  put(ZONE.SUBURB, suburb.x, suburb.z, side > 0 ? PI : 0, { flat: 50, clear: 40, dirt: 0.15 });
  put(ZONE.TRUCKSTOP, stop.x, stop.z, 0, { flat: 30, clear: 34, dirt: 0.3 });
  put(ZONE.TERMINAL, terminal.x, terminal.z, PI / 2, { flat: 30, clear: 36 }); // (its front faces west: the road in)
  put(ZONE.HANGARS, hangars.x, hangars.z, -PI / 2, { flat: 40, clear: 46 }); // (their doors face east: the apron)
  put(ZONE.FUEL_DEPOT, depot.x, depot.z, PI / 2, { flat: 28, clear: 32, dirt: 0.5 });
  const zoneById = {};
  for (const z of zones) zoneById[z.id] = z;

  // ---------------------------------------------------------------- terrain
  // A coastal plain: low rolling ground that climbs to hills at the north, south and east edges and falls into the
  // sea at the west one. The bluff the bridge lands on stands out of the shore.
  const relief = (x, z) => fbm(nA, x * 0.003, z * 0.003, 4) * 11 + fbm(nB, x * 0.013, z * 0.013, 3) * 2.6 + 2.5;
  // (the shore wanders, but not where the bridge lands: the abutment stands on the line)
  const atBridge = (z) => 1 - smoothstep(34, 70, Math.abs(z - zb));
  const shoreX = (z) => COAST + (nE(z * 0.011, 3.7) * 16 + nE(z * 0.045, 9.1) * 4) * (1 - atBridge(z));
  const H0 = (x, z) => {
    const micro = fbm(nD, x * 0.09, z * 0.09, 2) * 0.22;
    const a = (relief(x, z) - FLOOR) * 0.8;
    return FLOOR + 0.5 * (a + Math.sqrt(a * a + 9)) + micro;
  };
  const edgeRise = (x, z) => smoothstep(HALF - 60, HALF - 2, Math.max(Math.abs(z), x)) * 26;
  // the ground of the built-up places is one level each: the city's, the airfield's
  const cityH = Math.max(FLOOR + 1.4, H0(city.x, city.z) * 0.5 + 1);
  const fieldH = Math.max(FLOOR + 1.4, H0(field.x - 40, field.z) * 0.5 + 1);
  for (const zn of zones) {
    if (zn.id === ZONE.BRIDGEHEAD) zn.h = BLUFF;
    else if (zn.id === ZONE.CITY) zn.h = cityH;
    else if (zn.id === ZONE.TERMINAL || zn.id === ZONE.HANGARS || zn.id === ZONE.FUEL_DEPOT) zn.h = fieldH;
    else zn.h = Math.max(FLOOR + 1, H0(zn.x, zn.z) * 0.55 + 0.8);
  }
  // rectangles of level ground [x, z, half x, half z, height, blend]: the runway with its apron, the city
  const flats = [
    [field.x - 6, field.z, RUNWAY_HALF + 18, RUNWAY_LEN / 2 + 16, fieldH, 30],
    [apron.x, apron.z, apron.hx + 6, apron.hz + 6, fieldH, 24],
    [COAST + 26, zb, 22, 9, BLUFF, 9], // the bluff out to the abutment: the road off the bridge
  ];
  const H1 = (x, z) => {
    let h = H0(x, z);
    for (const zn of zones) {
      const d = Math.hypot(x - zn.x, z - zn.z);
      const lim = zn.flat + zn.blend;
      if (d < lim) h = lerp(h, zn.h, 1 - smoothstep(zn.flat, lim, d));
    }
    for (const [fx, fz, hx, hz, fh, blend] of flats) {
      const d = Math.hypot(Math.max(0, Math.abs(x - fx) - hx), Math.max(0, Math.abs(z - fz) - hz));
      if (d < blend) h = lerp(h, fh, 1 - smoothstep(0, blend, d));
    }
    // the sea: the land goes down to the beach and on under the water. The bluff at the bridge falls straight in.
    const s = x - shoreX(z);
    const bluff = atBridge(z);
    const beach = 1 - smoothstep(-6, lerp(60, 14, bluff), s);
    h = lerp(h, WATER_LEVEL + 0.6, beach * (1 - bluff * smoothstep(-2, 10, s)));
    h = lerp(h, WATER_LEVEL - 7, 1 - smoothstep(-34, lerp(-2, 4, bluff), s));
    return h + edgeRise(x, z);
  };

  const heights = new Float32Array(N * N);
  const roadDist = new Float32Array(N * N).fill(1e4);
  const roadKind = new Uint8Array(N * N);
  const roadH = new Float32Array(N * N);
  const roadDir = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = H1(-HALF + i * GRID_STEP, -HALF + j * GRID_STEP);
  const grid = (v) => clamp((v + HALF) / GRID_STEP, 0, N - 1.001);
  const rawH = (x, z) => {
    const fx = grid(x);
    const fz = grid(z);
    const i = fx | 0;
    const j = fz | 0;
    const k = j * N + i;
    const a = heights[k] + (heights[k + 1] - heights[k]) * (fx - i);
    const b = heights[k + N] + (heights[k + N + 1] - heights[k + N]) * (fx - i);
    return a + (b - a) * (fz - j);
  };

  // ---------------------------------------------------------------- roads
  // No router here: the plain is open ground, so a road is its ends and a few points between them that wander off
  // the straight line. (The island's roads thread a valley: world.js routes those with A*.)
  const roads = [];
  const catmull = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  // level: a road of a place keeps to the place's ground (a street, the runway); otherwise its heights are the
  // ground's, smoothed along it
  const buildRoad = (ctrl, kind, width, name = '', level = null) => {
    const pts = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)];
      const p1 = ctrl[i];
      const p2 = ctrl[i + 1];
      const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2));
      for (let s = 0; s < steps; s++) pts.push(catmull(p0[0], p1[0], p2[0], p3[0], s / steps), catmull(p0[1], p1[1], p2[1], p3[1], s / steps));
    }
    pts.push(ctrl[ctrl.length - 1][0], ctrl[ctrl.length - 1][1]);
    const n = pts.length / 2;
    const hs = new Float32Array(n);
    for (let i = 0; i < n; i++) hs[i] = level ?? rawH(pts[i * 2], pts[i * 2 + 1]);
    if (level === null) {
      for (let pass = 0; pass < 3; pass++) {
        const src = hs.slice();
        for (let i = 0; i < n; i++) {
          let s = 0;
          let c = 0;
          for (let k = Math.max(0, i - 8); k <= Math.min(n - 1, i + 8); k++) {
            s += src[k];
            c++;
          }
          hs[i] = s / c;
        }
      }
      // ...and it meets a place at the level of its ground
      for (let i = 0; i < n; i++) {
        for (const zn of zones) {
          const d = Math.hypot(pts[i * 2] - zn.x, pts[i * 2 + 1] - zn.z);
          if (d < zn.flat + 12) hs[i] = lerp(hs[i], zn.h, 1 - smoothstep(zn.flat * 0.75, zn.flat + 12, d));
        }
      }
    }
    let length = 0;
    for (let i = 1; i < n; i++) length += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const road = { pts: new Float32Array(pts), hs, kind, width, name, length };
    roads.push(road);
    return road;
  };
  // a to b by way of `n` points that wander up to `amp` of the leg off the straight line
  const wander = (a, b, n, amp) => {
    const out = [a];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    let s = rng.chance(0.5) ? 1 : -1;
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      const o = s * rng.range(0.35, 1) * amp * len;
      s = -s;
      out.push([a[0] + dx * t - (dz / len) * o, a[1] + dz * t + (dx / len) * o]);
    }
    out.push(b);
    return out;
  };
  const cityW = [city.x - (GRID * PITCH) / 2, city.z];
  const cityE = [city.x + (GRID * PITCH) / 2, city.z];
  const gate = [field.x - 150, field.z + 22]; // where the road in meets the airfield
  // Route 9 carries on from the bridge: over the plain, down Main Street, past the truck stop and out to the airfield
  const highway = buildRoad(
    [[head.x - 30, head.z], [head.x + 20, head.z], ...wander([head.x + 60, head.z], [cityW[0] - 40, city.z], 2, 0.07).slice(1), cityW, cityE, ...wander([cityE[0] + 40, city.z], [stop.x - 34, stop.z - 14], 1, 0.06), [stop.x + 34, stop.z - 14], ...wander([stop.x + 70, stop.z - 12], gate, 1, 0.05).slice(1), [terminal.x - 26, terminal.z]],
    ROAD.ASPHALT,
    3.8,
    'Route 9',
  );
  // the city's streets (Main Street is Route 9 itself)
  const G2 = (GRID * PITCH) / 2;
  for (let i = 0; i <= GRID; i++) {
    const o = -G2 + i * PITCH;
    buildRoad([[city.x + o, city.z - G2 - 8], [city.x + o, city.z + G2 + 8]], ROAD.ASPHALT, 3.4, '', cityH);
    if (i !== GRID / 2) buildRoad([[city.x - G2 - 8, city.z + o], [city.x + G2 + 8, city.z + o]], ROAD.ASPHALT, 3.4, '', cityH);
  }
  // the spur to the ironworks and the lane out to Eastgate, off the city's edge streets
  buildRoad(wander([city.x + PITCH, city.z + side * (G2 + 8)], [works.x, works.z - side * 44], 2, 0.08), ROAD.ASPHALT, 3, 'Kessler Road');
  buildRoad(wander([city.x + G2, city.z - side * PITCH], [suburb.x - 40, suburb.z + side * 20], 1, 0.1), ROAD.DIRT, 2.6);
  buildRoad([[suburb.x - 42, suburb.z], [suburb.x + 42, suburb.z]], ROAD.DIRT, 2.6);
  // the airfield: the runway, the taxi lane along the apron, the road on to the depot
  const runwayRoad = buildRoad([[field.x, field.z - RUNWAY_LEN / 2], [field.x, field.z + RUNWAY_LEN / 2]], ROAD.ASPHALT, RUNWAY_HALF, 'Runway 36', fieldH);
  buildRoad([[terminal.x - 26, terminal.z], [terminal.x - 28, hangars.z - 30], [hangars.x - 34, hangars.z + 4]], ROAD.ASPHALT, 2.8, '', fieldH);
  buildRoad([[terminal.x - 26, terminal.z], [depot.x - 30, depot.z + 40], [depot.x - 24, depot.z]], ROAD.DIRT, 2.6);
  // forest tracks over the plain: from the bridgehead along the shore, and round the back of the city
  buildRoad(wander([head.x + 10, head.z + 30], [city.x - 60, city.z + side * (G2 + 60)], 3, 0.12), ROAD.TRAIL, 1.5);
  buildRoad(wander([works.x + 40, works.z], [stop.x, stop.z + side * 40], 3, 0.12), ROAD.TRAIL, 1.5);

  // roads into the heightfield (as world.js does it)
  const ROAD_BLEND = 7.5;
  for (const road of roads) {
    const p = road.pts;
    const reach = road.width + ROAD_BLEND;
    for (let s = 0; s < p.length / 2 - 1; s++) {
      const ax = p[s * 2];
      const az = p[s * 2 + 1];
      const ex = p[s * 2 + 2] - ax;
      const ez = p[s * 2 + 3] - az;
      const el2 = ex * ex + ez * ez || 1;
      const el = Math.sqrt(el2);
      const i0 = Math.max(0, Math.floor((Math.min(ax, ax + ex) - reach + HALF) / GRID_STEP));
      const i1 = Math.min(N - 1, Math.ceil((Math.max(ax, ax + ex) + reach + HALF) / GRID_STEP));
      const j0 = Math.max(0, Math.floor((Math.min(az, az + ez) - reach + HALF) / GRID_STEP));
      const j1 = Math.min(N - 1, Math.ceil((Math.max(az, az + ez) + reach + HALF) / GRID_STEP));
      for (let j = j0; j <= j1; j++) {
        const z = -HALF + j * GRID_STEP;
        for (let i = i0; i <= i1; i++) {
          const x = -HALF + i * GRID_STEP;
          const t = clamp(((x - ax) * ex + (z - az) * ez) / el2, 0, 1);
          const d = Math.hypot(x - ax - ex * t, z - az - ez * t) - (road.width - 2.6);
          const k = j * N + i;
          if (d < roadDist[k]) {
            roadDist[k] = d;
            roadKind[k] = road.kind;
            roadH[k] = road.hs[s] + (road.hs[s + 1] - road.hs[s]) * t;
            roadDir[k * 2] = ex / el;
            roadDir[k * 2 + 1] = ez / el;
          }
        }
      }
    }
  }
  for (let k = 0; k < N * N; k++) {
    const d = roadDist[k];
    if (d < 2.6 + ROAD_BLEND) heights[k] = lerp(heights[k], roadH[k] - 0.05, 1 - smoothstep(3, 2.6 + ROAD_BLEND, d));
  }

  const heightAt = (x, z) => {
    const fx = grid(x);
    const fz = grid(z);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * N + i;
    // (triangle-consistent, as the mesh is split: world.js)
    if (tx + tz <= 1) return heights[k] + (heights[k + 1] - heights[k]) * tx + (heights[k + N] - heights[k]) * tz;
    return heights[k + N + 1] + (heights[k + N] - heights[k + N + 1]) * (1 - tx) + (heights[k + 1] - heights[k + N + 1]) * (1 - tz);
  };
  const sampleGrid = (arr, x, z) => arr[clamp(Math.round((z + HALF) / GRID_STEP), 0, N - 1) * N + clamp(Math.round((x + HALF) / GRID_STEP), 0, N - 1)];
  const roadDistAt = (x, z) => sampleGrid(roadDist, x, z);
  const roadKindAt = (x, z) => sampleGrid(roadKind, x, z);
  const inWater = (x, z) => heightAt(x, z) < WATER_LEVEL + 0.35;
  const nearZone = (x, z, pad) => zones.find((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.flat + pad) || null;
  const onField = (x, z, pad) => Math.abs(x - (field.x - 30)) < 80 + pad && Math.abs(z - field.z) < RUNWAY_LEN / 2 + 30 + pad;

  // ---------------------------------------------------------------- what it is built with
  const kit = createKit({ rng, heightAt, half: HALF });
  const { staticGrid, structGrid, parts, props, lootSpawns, containers, partSpots, openings, extraTrees, lights, roofs, clears, addPropColliders, seatY, propBlocked, Builder, door, win, gap } = kit;
  const place = (id, build) => {
    const zn = zoneById[id];
    const b = new Builder(zn.x, zn.z, zn.ry, zn.h);
    b.zone = id;
    b.yard = zn;
    build(b, zn);
  };
  // a hiding place of the plane's part `supply` (PLANE_PARTS[supply]) in the builder's frame
  const part = (b, supply, lx, lz, ly = 0.02) => {
    b.partSpot(lx, lz, ly);
    partSpots[partSpots.length - 1].supply = supply;
  };
  const spawnPoints = [];

  // THE BRIDGEHEAD: the bluff the bridge comes ashore on. The car is where it stopped, the span behind it in the
  // water; a checkpoint somebody held here once, and gave up.
  const bridge = planBridge({ seed, z: zb, shore: COAST, deckY: BLUFF });
  place(ZONE.BRIDGEHEAD, (b) => {
    // (local frame: -Z is east, inland; +Z is back out along the bridge; +X is north)
    b.prop('car', 1.6, 15, PI + 0.12, { seed: 7 });
    for (let i = 0; i < 8; i++) spawnPoints.push({ x: b.wx(-5 + (i % 4) * 3.2, -2 - Math.floor(i / 4) * 3), z: b.wz(-5 + (i % 4) * 3.2, -2 - Math.floor(i / 4) * 3) });
    // what is left of the last span's end: the edge of the abutment, shut off
    for (const lx of [-3.3, 0, 3.3]) b.prop('jersey_barrier', lx, 37.4, 0, { seed: 1 });
    b.prop('road_sign', -6.4, 30, PI, { seed: 3 });
    // the checkpoint
    b.prop('military_tent', 13, -6, PI / 2, { seed: 1 });
    b.prop('sandbags', -7, -9, 0.1, { seed: 0 });
    b.prop('sandbags', -9.4, -7, PI / 2 - 0.2, { seed: 1 });
    b.prop('sandbags', 7.4, 4, PI / 2, { seed: 0 });
    b.cont(CONT.AMMO_BOX, 9.4, -9.6, { prop: 'military_crate', ry: 0.3 });
    b.cont(CONT.DUFFEL, 8.6, -1.2, { prop: 'duffel_bag', ry: 0.7, nocollide: true });
    b.cont(CONT.CRATE, -11, 3, { prop: 'crate', ry: 0.2 });
    b.prop('barrel', -8.6, -11.4, 0, { seed: 2 });
    b.light(-8.6, 1.0, -11.4, 'embers');
    b.wreck('pickup_truck', -5.5, -19, 0.2, { seed: 1 });
    b.wreck('car_wreck', 5.4, -14, PI - 0.3, { seed: 2 });
    b.prop('jersey_barrier', 3.4, -20.5, 0.5, { seed: 2 });
    b.prop('streetlight', -6.5, -4, PI / 2, { seed: 0 });
    b.prop('body_bag', 15.5, 1.5, 0.3, { nocollide: true, seed: 0 });
    b.prop('body_bag', 16.6, 2.2, 0.2, { nocollide: true, seed: 1 });
    b.loot(-10, -4);
    b.loot(11, -3);
    b.loot(2, -8);
    b.clear(0, 6, 14);
  });

  // PORT CALDER -----------------------------------------------------------------------------------------------
  // GRID x GRID blocks. Every block is paved and split into lots; what stands on a lot is drawn from the seed, with
  // the places the run needs (the plane's magneto is in a parts shop) dealt out first.
  const lots = [];
  {
    const H = cityH;
    for (let bi = 0; bi < GRID; bi++) {
      for (let bj = 0; bj < GRID; bj++) {
        const bx = city.x - G2 + (bi + 0.5) * PITCH;
        const bz = city.z - G2 + (bj + 0.5) * PITCH;
        const b = new Builder(bx, bz, 0, H);
        b.zone = ZONE.CITY;
        b.box(0, 0, 0, BLOCK, 0.1, BLOCK, 'concrete'); // the pavement
        b.clear(0, 0, BLOCK * 0.72);
        const r = rng();
        // which way a lot faces: out of the block, onto the street it stands on. face: the world direction [dx, dz]
        const lot = (lx, lz, w, d, face) => lots.push({ x: bx + lx, z: bz + lz, w, d, ry: Math.atan2(-face[0], -face[1]), bi, bj });
        if (r < 0.5) {
          // four lots, an alley between them
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) lot(sx * 11.25, sz * 11.25, 19.5, 19.5, rng.chance(0.5) ? [sx, 0] : [0, sz]);
        } else if (r < 0.8) {
          // two long lots, back to back
          if (rng.chance(0.5)) for (const sx of [-1, 1]) lot(sx * 11.25, 0, 42, 19.5, [sx, 0]);
          else for (const sz of [-1, 1]) lot(0, sz * 11.25, 42, 19.5, [0, sz]);
        } else {
          const f = [[1, 0], [-1, 0], [0, 1], [0, -1]][rng.int(0, 3)];
          lot(0, 0, 42, 42, f);
        }
      }
    }
  }
  // the buildings. Each is given a builder at the middle of its lot, front (-Z) on the street, and the lot's size.
  // The front wall stands SETBACK in from the lot's edge (the pavement in front of it).
  const SETBACK = 1.2;
  const bands = (b, cz, w, d, y0, floors, fh, mat = 'dark') => {
    // rows of windows up a solid block: a dark band a floor, proud of each face (no collider: the block has one)
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * fh + 1.0;
      b.box(0, y, cz - d / 2 - 0.03, w - 1.6, 1.3, 0.06, mat, { collide: false });
      b.box(0, y, cz + d / 2 + 0.03, w - 1.6, 1.3, 0.06, mat, { collide: false });
      b.box(-w / 2 - 0.03, y, cz, 0.06, 1.3, d - 1.6, mat, { collide: false });
      b.box(w / 2 + 0.03, y, cz, 0.06, 1.3, d - 1.6, mat, { collide: false });
    }
  };
  const BUILD = {
    // a shop: one room behind a glass front, a counter, shelves along the back, a yard door
    shop(b, L, o = {}) {
      const w = Math.min(L.w - 2, 17);
      const d = Math.min(L.d - SETBACK - 5, 11);
      const cz = -L.d / 2 + SETBACK + d / 2;
      const mat = o.mat || (rng.chance(0.6) ? 'brick' : 'concrete');
      b.room(0, cz, w, d, 3.8, mat, { n: [door(w / 2, 1.6), win(w * 0.2, 3, 0.8, 2.8), win(w * 0.8, 3, 0.8, 2.8)], s: [door(w - 2.4, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      b.box(-w / 4, 0.12, cz - 0.6, 3.4, 1.0, 0.7, 'planks'); // counter
      b.loot(-w / 4, cz - 0.6, 1.14);
      const back = cz + d / 2 - 0.75;
      b.cont(CONT.SHELF, -w / 2 + 2.2, back, { prop: 'shelf', ry: PI, ly: 0.12 });
      b.cont(CONT.SHELF, -w / 2 + 4.6, back, { prop: 'shelf', ry: PI, ly: 0.12 });
      b.cont(o.fridge === false ? CONT.CABINET : CONT.FRIDGE, w / 2 - 0.8, cz + 0.5, { prop: o.fridge === false ? 'cabinet' : 'fridge', ry: -PI / 2, ly: 0.12 });
      b.loot(w / 4, cz + 1.2, 0.14);
      b.cont(CONT.DUMPSTER, -w / 2 + 2, cz + d / 2 + 2.2, { prop: 'dumpster', ry: PI });
      return { cz, w, d };
    },
    // flats over a ground floor that can be walked into: a hall, two rooms, what the people who lived there left
    flats(b, L) {
      const w = Math.min(L.w - 2, 17);
      const d = Math.min(L.d - SETBACK - 3, 13);
      const cz = -L.d / 2 + SETBACK + d / 2;
      const mat = rng.chance(0.5) ? 'brick' : 'concrete';
      const floors = rng.int(2, 4);
      b.room(0, cz, w, d, 3.2, mat, { n: [door(w / 2, 1.4), win(w * 0.2, 1.6), win(w * 0.8, 1.6)], s: [door(2.2, 1.1), win(w * 0.7, 1.4)], e: [win(d / 2, 1.4)], w: [win(d / 2, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks' });
      b.wall(1.4, cz - d / 2, 1.4, cz + d / 2, 3.2, 0.18, 'concrete', [door(d * 0.3, 1.2)]);
      b.box(0, 3.5, cz, w, floors * 3, d, mat); // the floors above: shut, and solid
      bands(b, cz, w, d, 3.5, floors, 3);
      b.box(0, 3.5 + floors * 3, cz, w + 0.4, 0.5, d + 0.4, 'concrete', { collide: false }); // parapet
      b.prop('bed', -w / 2 + 1.4, cz + d / 2 - 1.5, 0, { ly: 0.12 });
      b.cont(CONT.CABINET, -w / 2 + 3.6, cz + d / 2 - 0.6, { prop: 'cabinet', ry: PI, ly: 0.12 });
      b.prop('table', w / 2 - 3, cz + 1, 0.1, { ly: 0.12 });
      b.loot(w / 2 - 3, cz + 1, 0.94);
      b.cont(CONT.FRIDGE, w / 2 - 0.8, cz + d / 2 - 2.4, { prop: 'fridge', ry: -PI / 2, ly: 0.12 });
      b.loot(-w / 4, cz - d / 4, 0.14);
      return { cz, w, d };
    },
    // an office tower: a lobby at street level and a shaft of floors over it, the tallest thing for a mile
    tower(b, L) {
      const w = Math.min(L.w - 4, 26);
      const d = Math.min(L.d - SETBACK - 4, 24);
      const cz = -L.d / 2 + SETBACK + d / 2;
      const floors = rng.int(7, 12);
      b.room(0, cz, w, d, 4.4, 'concrete', { n: [door(w / 2, 1.7), win(w * 0.22, 4.4, 0.6, 3.6), win(w * 0.78, 4.4, 0.6, 3.6)], s: [door(w - 3, 1.2)], e: [win(d / 2, 4, 0.6, 3.6)], w: [win(d / 2, 4, 0.6, 3.6)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      // the core, with the lifts nobody will ride again
      b.box(0, 0.12, cz + 2, 5, 4.28, 5, 'concrete');
      b.box(-w / 4, 0.12, cz - d / 4, 4.2, 1.05, 0.9, 'planks'); // the front desk
      b.loot(-w / 4, cz - d / 4, 1.19);
      b.cont(CONT.CABINET, w / 2 - 0.8, cz + d / 4, { prop: 'cabinet', ry: -PI / 2, ly: 0.12 });
      b.cont(CONT.LOCKER, -w / 2 + 0.7, cz + d / 2 - 2, { prop: 'locker', ry: PI / 2, ly: 0.12 });
      b.loot(w / 4, cz + d / 2 - 2, 0.14);
      const top = 4.7 + floors * 3.3;
      b.box(0, 4.7, cz, w - 1, floors * 3.3, d - 1, 'concrete');
      bands(b, cz, w - 1, d - 1, 4.7, floors, 3.3);
      // what the fire left of its top: a broken storey, steel standing out of it
      b.box(-w / 6, top, cz + d / 8, w * 0.55, 2.4, d * 0.6, 'charred', { collide: false });
      for (const [sx, sz, h] of [[-0.3, -0.3, 5.5], [0.25, -0.2, 3.8], [-0.1, 0.3, 6.6], [0.34, 0.28, 2.8]]) b.box(sx * w, top, cz + sz * d, 0.3, h, 0.3, 'rust', { collide: false });
      return { cz, w, d };
    },
    // a block that came down: the corner of its ground floor still stands, the rest is a heap of slabs
    ruin(b, L) {
      const w = Math.min(L.w - 3, 16);
      const d = Math.min(L.d - 4, 14);
      b.box(-w / 2, 0.12, 0, 0.4, 3.4, d, 'brick');
      b.box(-w / 4, 0.12, d / 2, w / 2, 2.2, 0.4, 'brick');
      b.box(w / 2 - 1.5, 0.12, -d / 2, 3, 1.3, 0.4, 'brick');
      b.box(0.6, 0.12, 0.6, w * 0.62, 1.5, d * 0.6, 'concrete'); // the heap: a block to climb round, not through
      b.box(1.2, 1.5, 0.2, w * 0.5, 0.35, d * 0.5, 'concrete', { rz: 0.28, collide: false });
      b.box(-1.5, 1.2, 1.4, w * 0.4, 0.3, d * 0.42, 'concrete', { rx: -0.3, collide: false });
      b.box(2.2, 1.9, -1.2, 5, 0.22, 0.22, 'rust', { rz: 0.5, ry: 0.4, collide: false });
      b.box(-0.6, 1.6, 2.2, 4.4, 0.2, 0.2, 'rust', { rz: -0.34, ry: -0.7, collide: false });
      b.cont(CONT.DUFFEL, -w / 2 + 1.6, -d / 2 + 1.6, { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: 0.12 });
      b.loot(w / 2 - 1.2, d / 2 - 1.2, 0.14);
      b.prop('corpse', -w / 2 + 2.6, d / 2 - 2, 1.1, { nocollide: true, ly: 0.12 });
    },
    // burnt out: the walls, black, with the sky over them
    burnt(b, L) {
      const w = Math.min(L.w - 2, 15);
      const d = Math.min(L.d - SETBACK - 4, 11);
      const cz = -L.d / 2 + SETBACK + d / 2;
      b.room(0, cz, w, d, 3.4, 'charred', { n: [gap(w / 2, 2.2, 2.6), gap(w * 0.2, 2.4, 2.4)], s: [gap(w * 0.7, 3, 3)], e: [gap(d / 2, 1.6, 2.2)] }, { floorMat: 'ash' });
      b.box(1, 0.6, cz, w * 0.7, 0.22, 0.22, 'charred', { rz: 0.22, ry: 0.5, collide: false });
      b.box(-2, 0.3, cz + 1.4, w * 0.5, 0.2, 0.2, 'charred', { rz: -0.1, ry: -0.8, collide: false });
      b.cont(CONT.CABINET, -w / 2 + 1, cz + d / 2 - 0.7, { prop: 'cabinet', ry: PI, ly: 0.12 });
      b.prop('bones', w / 4, cz + 1, 0.4, { nocollide: true, ly: 0.12 });
      b.loot(0, cz, 0.14);
    },
    // a car park nobody drove out of
    parking(b, L) {
      const rows = Math.max(1, Math.floor((L.d - 6) / 7));
      const cols = Math.max(2, Math.floor((L.w - 3) / 3.4));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!rng.chance(0.42)) continue;
          const t = rng();
          b.wreck(t < 0.72 ? 'car_wreck' : 'pickup_truck', -L.w / 2 + 2.6 + c * 3.4 + rng.range(-0.2, 0.2), -L.d / 2 + 5 + r * 7, (rng.chance(0.5) ? 0 : PI) + rng.range(-0.1, 0.1), { trunk: rng.chance(0.45), ly: 0.12 });
        }
      }
      b.prop('streetlight', L.w / 2 - 1, L.d / 2 - 1, PI, { ly: 0.12 });
      b.loot(0, L.d / 2 - 2, 0.14);
    },
  };
  // the set places first, on lots drawn at random, then whatever the seed deals for the rest
  {
    const order = lots.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const big = order.filter((i) => lots[i].w > 40 && lots[i].d > 40);
    const small = order.filter((i) => !big.includes(i));
    const plan = new Map();
    // Calder Aero Supply: the parts shop the plane's magneto is in (two of them, so two hiding places)
    for (const i of small.splice(0, 2)) plan.set(i, 'aero');
    for (const i of big.splice(0, 2)) plan.set(i, 'tower');
    for (const i of small.splice(0, 2)) plan.set(i, 'tower');
    const W = [['shop', 3], ['flats', 3.2], ['ruin', 1.6], ['burnt', 1.3], ['parking', 1.2]];
    const pick = () => {
      let r = rng() * W.reduce((s, e) => s + e[1], 0);
      for (const [t, wt] of W) if ((r -= wt) <= 0) return t;
      return 'shop';
    };
    lots.forEach((L, i) => {
      const b = new Builder(L.x, L.z, L.ry, cityH);
      b.zone = ZONE.CITY;
      const what = plan.get(i) || (L.w > 40 && L.d > 40 ? 'parking' : pick());
      L.what = what;
      if (what === 'aero') {
        const s = BUILD.shop(b, L, { mat: 'tin', fridge: false });
        b.cont(CONT.TOOLBOX, s.w / 4, s.cz - 1.4, { prop: 'toolbox', ry: 0.4, nocollide: true, ly: 0.12 });
        part(b, 1, s.w / 2 - 1.6, s.cz + s.d / 2 - 1.4, 0.14);
      } else BUILD[what](b, L);
    });
  }
  // the streets: wrecks where they stopped, a bus across a junction, lamps along the kerbs, the odd barricade
  {
    const H = cityH;
    const b = new Builder(city.x, city.z, 0, H);
    b.zone = ZONE.CITY;
    for (let i = 0; i <= GRID; i++) {
      for (let k = 0; k < GRID; k++) {
        for (const ns of [true, false]) {
          // (the stretch of street i between crossings k and k + 1, north-south or east-west)
          const o = -G2 + i * PITCH;
          const m = -G2 + (k + 0.5) * PITCH;
          const at = (along, across) => (ns ? [o + across, m + along] : [m + along, o + across]);
          const yaw = ns ? 0 : PI / 2;
          for (const sgn of [-1, 1]) {
            if (!rng.chance(0.55)) continue;
            const [x, z] = at(rng.range(-16, 16), sgn * rng.range(1.6, 2.6));
            const t = rng();
            b.wreck(t < 0.7 ? 'car_wreck' : t < 0.9 ? 'pickup_truck' : 'ambulance', x, z, yaw + (sgn > 0 ? PI : 0) + rng.range(-0.25, 0.25), { trunk: rng.chance(0.4), zone: ZONE.ROADSIDE });
          }
          const [lx, lz] = at(-20, 5.1);
          b.prop('streetlight', lx, lz, ns ? -PI / 2 : 0);
          if (rng.chance(0.2)) {
            const [cx, cz] = at(rng.range(-10, 10), 0);
            b.prop('corpse', cx, cz, rng.range(0, 6), { nocollide: true });
          }
        }
      }
    }
    for (const [jx, jz] of [[rng.int(1, GRID - 1), rng.int(1, GRID - 1)]]) b.wreck('school_bus', -G2 + jx * PITCH + 1, -G2 + jz * PITCH - 0.5, 0.9, { trunk: false });
  }

  // KESSLER IRONWORKS: a fenced yard - the casting shed, a machine shop, stacks of steel, a gantry crane.
  place(ZONE.INDUSTRIAL, (b) => {
    const FX = 44;
    const FZ = 40;
    for (let x = -FX + 1.5; x < FX; x += 3) {
      if (Math.abs(x) > 5) b.prop('fence_chain', x, -FZ, 0);
      b.prop('fence_chain', x, FZ, 0);
    }
    for (let z = -FZ + 1.5; z < FZ; z += 3) {
      b.prop('fence_chain', -FX, z, PI / 2);
      b.prop('fence_chain', FX, z, PI / 2);
    }
    b.prop('boom_gate', -0.4, -FZ, 0);
    // the casting shed: one long hall, open at both ends
    b.room(-18, 6, 22, 38, 8, 'tin_rust', { n: [gap(11, 7, 5.5)], s: [gap(11, 7, 5.5)], e: [door(12, 1.4), door(28, 1.4)] }, { roof: 'gable', roofH: 3.4, roofMat: 'tin', floorMat: 'concrete' });
    for (const lz of [-6, 6, 18]) b.box(-24.5, 0.12, lz, 5, 2.6, 5, 'rust'); // furnaces along the west wall
    b.box(-13, 0.12, 0, 3.4, 1.1, 8, 'metal'); // the casting bed
    b.cont(CONT.TOOLBOX, -11, 8, { prop: 'toolbox', ry: 0.4, nocollide: true, ly: 0.12 });
    b.cont(CONT.CRATE, -11.5, 14, { prop: 'crate', ry: 0.2, ly: 0.12 });
    b.cont(CONT.LOCKER, -8, 23.2, { prop: 'locker', ry: PI, ly: 0.12 });
    b.loot(-14, -8, 0.14);
    b.loot(-18, 20, 0.14);
    part(b, 2, -22.5, 22, 0.14);
    part(b, 4, -9, -10, 0.14);
    // the machine shop
    b.room(20, -18, 20, 14, 4.6, 'brick', { w: [door(7, 1.4)], n: [gap(10, 4.6, 3.6), win(16.5, 1.6)], e: [win(7, 1.6)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.box(22, 0.12, -13.2, 9, 0.95, 1.1, 'planks'); // the benches
    b.box(27.6, 0.12, -19, 1.1, 0.95, 6, 'planks');
    b.loot(22, -13.2, 1.09);
    b.cont(CONT.SHELF, 13.6, -12.4, { prop: 'shelf', ry: PI, ly: 0.12 });
    b.cont(CONT.TOOLBOX, 26, -22.5, { prop: 'toolbox', ry: 1.1, nocollide: true, ly: 0.12 });
    b.cont(CONT.LOCKER, 29.3, -23.6, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
    part(b, 2, 15, -23.2, 0.14);
    // the yard: stacks of billets, a gantry over them, what the last shift left standing
    for (const [sx, sz, h] of [[14, 10, 1.6], [14, 16, 2.4], [22, 10, 0.8], [22, 16, 1.6], [30, 13, 2.4]]) b.box(sx, 0, sz, 6, h, 2.2, 'rust');
    for (const gx of [9, 35]) for (const gz of [6, 20]) b.box(gx, 0, gz, 0.5, 8, 0.5, 'rust');
    for (const gz of [6, 20]) b.box(22, 8, gz, 26.5, 0.6, 0.6, 'rust', { collide: false });
    b.box(22, 7.2, 13, 1.6, 1.2, 14.6, 'metal', { collide: false });
    b.wreck('dump_truck', 6, -26, 1.2, { trunk: false });
    b.wreck('pickup_truck', -4, -30, 0.3);
    b.prop('fuel_tank', 36, 30, 0);
    b.prop('generator', 8, 30, 0.3);
    b.cont(CONT.DUMPSTER, 30, -30, { prop: 'dumpster', ry: PI });
    b.cont(CONT.CRATE, 2, 26, { prop: 'crate', ry: 0.4 });
    b.prop('barrel', 3.6, 28, 0);
    b.light(3.6, 1.0, 28, 'embers');
    b.prop('streetlight', -6, -36, PI);
    b.prop('corpse', 2, -12, 0.7, { nocollide: true });
    b.loot(10, -30);
    b.loot(30, 26);
  });

  // EASTGATE: a street of houses on the far side of the city.
  place(ZONE.SUBURB, (b) => {
    const house = (hx, hz, front, k) => {
      const s = b.sub(hx, hz, front);
      s.room(0, 0, 10, 8, 3, k % 2 ? 'clapboard' : 'brick', { n: [door(5, 1.2), win(2, 1.4), win(8, 1.4)], s: [door(8, 1.1), win(3.4)], e: [win(4)], w: [win(4)] }, { roof: 'gableZ', roofH: 2.6, roofMat: 'shingles' });
      s.wall(-1, -4, -1, 4, 3, 0.18, 'clapboard', [door(5.4, 1.1)]);
      s.prop('bed', -3.4, 2.2, 0);
      s.cont(k % 2 ? CONT.CABINET : CONT.FRIDGE, 4.2, 3.3, { prop: k % 2 ? 'cabinet' : 'fridge', ry: PI });
      s.prop('table', 2, -1.6, 0.1);
      s.loot(2, -1.6, 0.82);
      s.loot(-3, -2);
      if (k % 3 === 0) s.wreck('car_wreck', 7.6, -7.5, 0.1, { seed: k });
      if (k % 2 === 0) s.cont(CONT.DUMPSTER, -7.2, 2, { prop: 'dumpster', ry: PI / 2, seed: k });
    };
    for (let k = 0; k < 4; k++) {
      house(-33 + k * 22, -14, 0, k); // (north of the lane, doors on it)
      house(-33 + k * 22, 14, PI, k + 4);
    }
    for (const [mx, mz] of [[-22, -5.2], [0, -5.2], [22, 5.2], [-12, 5.2]]) b.prop('mailbox', mx, mz, 0);
    b.prop('streetlight', -44, -4.6, PI / 2);
    b.prop('streetlight', 44, 4.6, -PI / 2);
    b.wreck('school_bus', 12, 1.6, PI / 2 + 0.2, { trunk: false });
    b.prop('corpse', -6, 1, 1.4, { nocollide: true });
    b.loot(-30, 2);
    b.loot(34, -2);
  });

  // MILE 9 TRUCK STOP: a canopy over the pumps, a diner, rigs that never left.
  place(ZONE.TRUCKSTOP, (b) => {
    b.box(0, -0.05, -4, 36, 0.1, 24, 'concrete', { collide: true });
    b.room(-4, 12, 14, 9, 3.6, 'brick', { n: [door(7, 1.6), win(2.6, 3, 0.9, 2.5), win(11.4, 3, 0.9, 2.5)], e: [win(4.5)], s: [door(2.4, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.box(-6, 0.12, 10, 5, 1.0, 0.7, 'planks');
    b.loot(-6, 10, 1.14);
    b.cont(CONT.FRIDGE, 2.2, 15.5, { prop: 'fridge', ry: PI, ly: 0.12 });
    b.cont(CONT.SHELF, -8, 15.5, { prop: 'shelf', ry: PI, ly: 0.12 });
    b.cont(CONT.SHELF, -4, 15.5, { prop: 'shelf', ry: PI, ly: 0.12 });
    b.prop('table', 0.5, 10.5, 0, { ly: 0.12 });
    for (const [px, pz] of [[-6, -2], [6, -2], [-6, -10], [6, -10]]) b.cyl(px, 0, pz, 0.2, 5, 'metal');
    b.box(0, 5, -6, 15, 0.55, 11, 'metal', { collide: false });
    b.roofSpan(0, -6, 7.5, 5.5, 5, 0.55);
    b.prop('gas_pump', -2, -6, 0);
    b.prop('gas_pump', 2, -6, 0);
    b.wreck('dump_truck', 13, 10, 0.1, { trunk: false });
    b.wreck('pickup_truck', -14, -8, 1.3);
    b.wreck('car_wreck', 12, -12, 2.4);
    b.cont(CONT.DUMPSTER, -14, 14, { prop: 'dumpster', ry: PI / 2 });
    b.prop('motel_sign', -17, -20, 0.2);
    b.prop('streetlight', 14, -19, PI);
    b.prop('barrel', 9, 4, 0);
    b.prop('corpse', 3, -2, 0.9, { nocollide: true });
    b.loot(-12, 4);
    b.loot(10, 2);
  });

  // CALDER FIELD ----------------------------------------------------------------------------------------------
  // the apron: a rectangle of concrete between the hangars and the runway
  {
    const b = new Builder(apron.x, apron.z, 0, fieldH);
    b.zone = ZONE.HANGARS;
    b.box(0, -0.05, 0, apron.hx * 2, 0.1, apron.hz * 2, 'concrete', { collide: true });
    b.clear(0, -40, 44);
    b.clear(0, 40, 44);
  }
  // the plane, at the south end of the runway, its nose to the north; the fuel truck beside it on the apron's edge
  const planeY = fieldH;
  const car = { x: plane.x, y: planeY, z: plane.z, ry: 0, plane: true };
  props.push({ type: 'plane_wreck', x: car.x, y: car.y, z: car.z, ry: car.ry, seed: 7 });
  addPropColliders('plane_wreck', car.x, car.y, car.z, car.ry);
  const truck = { x: plane.x - 17, y: fieldH, z: plane.z - 6, ry: 0.35 };
  props.push({ type: 'fuel_truck', x: truck.x, y: truck.y, z: truck.z, ry: truck.ry, seed: 3 });
  addPropColliders('fuel_truck', truck.x, truck.y, truck.z, truck.ry);
  clears.push([car.x, car.z, 12], [truck.x, truck.z, 7]);
  const runway = { x: field.x, z0: field.z - RUNWAY_LEN / 2, z1: field.z + RUNWAY_LEN / 2, half: RUNWAY_HALF, y: fieldH, truck };
  void runwayRoad;
  {
    // what is on the runway: wrecks the plane will have to clear on its run (well off its line), a light plane that
    // did not make it, the cones somebody set out
    const b = new Builder(field.x, field.z, 0, fieldH);
    b.zone = ZONE.HANGARS;
    b.wreck('pickup_truck', RUNWAY_HALF - 2.5, -40, 0.4, { trunk: false });
    b.wreck('car_wreck', -RUNWAY_HALF + 2, -110, 1.2);
    b.prop('jersey_barrier', RUNWAY_HALF - 1.5, 60, PI / 2, { seed: 1 });
    b.prop('jersey_barrier', -RUNWAY_HALF + 1.5, 20, PI / 2, { seed: 2 });
    b.prop('corpse', 3, 90, 0.4, { nocollide: true });
  }
  place(ZONE.HANGARS, (b) => {
    // two hangars, their doors (local -Z: east) open on the apron
    const hangar = (lx, k) => {
      const s = b.sub(lx, 6, 0);
      s.room(0, 0, 26, 24, 8, 'tin', { n: [gap(13, 16, 6.4)], s: [door(22, 1.3)], e: [win(12, 2)], w: [win(12, 2)] }, { roof: 'gableZ', roofH: 3.6, roofMat: 'tin', floorMat: 'concrete' });
      s.cont(CONT.SHELF, -9, 11, { prop: 'shelf', ry: PI, ly: 0.12, seed: k });
      s.cont(CONT.TOOLBOX, -5.5, 9.4, { prop: 'toolbox', ry: 0.5, nocollide: true, ly: 0.12, seed: k });
      s.cont(CONT.LOCKER, 12.1, 4, { prop: 'locker', ry: -PI / 2, ly: 0.12, seed: k });
      s.cont(CONT.CRATE, 9, 9.6, { prop: 'crate', ry: 0.2, ly: 0.12, seed: k });
      s.prop('barrel', -11.6, 3, 0, { ly: 0.12, seed: k });
      s.loot(0, 6, 0.14);
      s.loot(-8, -4, 0.14);
      part(s, 0, -11.2, 9.6, 0.14); // the propeller, off the rack on the back wall
      if (k) part(s, 4, 10.6, -6, 0.14);
      return s;
    };
    hangar(-16, 0);
    hangar(16, 1).wreck('pickup_truck', -4, 2, 0.3, { ly: 0.12, trunk: false });
    b.prop('generator', 0, 20.5, 0.2);
    b.cont(CONT.DUMPSTER, 31, 20, { prop: 'dumpster', ry: PI });
    b.wreck('car_wreck', -32, 14, 0.4);
    b.prop('streetlight', 0, -8.5, 0);
    b.prop('corpse', 3, -12, 2, { nocollide: true });
    b.loot(-30, -6);
  });
  place(ZONE.TERMINAL, (b) => {
    // the terminal: a hall with a counter, a back office, and the tower over its north end
    b.room(0, 2, 26, 14, 4.4, 'concrete', { n: [door(13, 1.8), win(5, 5, 0.7, 3.4), win(21, 5, 0.7, 3.4)], s: [door(20, 1.3), win(8, 4, 0.9, 3)], w: [win(7, 3, 0.9, 3)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.wall(6, -5, 6, 9, 4.4, 0.2, 'concrete', [door(9, 1.3)]);
    b.box(-4, 0.12, 0, 7, 1.05, 0.8, 'planks'); // the check-in desk
    b.loot(-4, 0, 1.19);
    for (const lx of [-9, -5, -1]) b.prop('pew', lx, 5.4, 0, { ly: 0.12 });
    b.cont(CONT.LOCKER, 12.1, 6, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
    b.cont(CONT.CABINET, 9.6, 8.2, { prop: 'cabinet', ry: PI, ly: 0.12 });
    b.cont(CONT.FRIDGE, -12.1, 6.4, { prop: 'fridge', ry: PI / 2, ly: 0.12 });
    b.prop('table', 9.4, 0, 0, { ly: 0.12 });
    b.loot(9.4, 0, 0.94);
    part(b, 3, 11.4, -3.6, 0.14); // the flight radio, in the back office...
    // the tower: a shaft with the cab on top (shut: what was in it is down in the office)
    b.box(9.5, 4.7, 5.5, 5, 9, 5, 'concrete');
    b.box(9.5, 13.7, 5.5, 7, 0.3, 7, 'concrete', { collide: false });
    b.box(9.5, 14, 5.5, 6.4, 2.4, 6.4, 'dark', { collide: false });
    b.box(9.5, 16.4, 5.5, 7.2, 0.3, 7.2, 'concrete', { collide: false });
    b.box(9.5, 16.7, 5.5, 0.12, 4, 0.12, 'metal', { collide: false });
    // out front: the forecourt, what the last flight out left behind
    b.box(0, -0.05, -13, 30, 0.1, 14, 'concrete', { collide: true });
    b.wreck('ambulance', -8, -13, 1.4, { ly: 0.05 });
    b.wreck('car_wreck', 6, -15, 0.2, { ly: 0.05 });
    b.wreck('school_bus', 15, 22, 1.5, { trunk: false });
    b.cont(CONT.DUFFEL, -2, -8, { prop: 'duffel_bag', ry: 0.6, nocollide: true, ly: 0.05 });
    b.cont(CONT.DUFFEL, 3.4, -10.5, { prop: 'duffel_bag', ry: 2.1, nocollide: true, ly: 0.05, seed: 1 });
    part(b, 3, -11, 5.2, 0.14); // ...or behind the desk
    b.prop('streetlight', -13, -19, PI);
    b.prop('streetlight', 13, -19, PI);
    b.prop('corpse', 0, -16, 0.4, { nocollide: true, ly: 0.05 });
    b.loot(-10, -9, 0.07);
  });
  place(ZONE.FUEL_DEPOT, (b) => {
    const FX = 22;
    const FZ = 20;
    for (let x = -FX + 1.5; x < FX; x += 3) {
      if (Math.abs(x) > 4) b.prop('fence_chain', x, -FZ, 0);
      b.prop('fence_chain', x, FZ, 0);
    }
    for (let z = -FZ + 1.5; z < FZ; z += 3) {
      b.prop('fence_chain', -FX, z, PI / 2);
      b.prop('fence_chain', FX, z, PI / 2);
    }
    // the tank farm: three tanks in a bund
    for (const lx of [-12, 0, 12]) {
      b.cyl(lx, 0, 9, 4.4, 7.5, 'tin_rust', { sides: 16 });
      b.cone(lx, 7.5, 9, 4.5, 1, 'tin', 16, { ry: 0 });
    }
    b.box(0, 0, 2.6, 36, 0.7, 0.4, 'concrete');
    // the pump house
    b.room(-12, -10, 8, 6, 3, 'concrete', { e: [door(3, 1.2)], n: [win(4, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.cont(CONT.LOCKER, -15.3, -9, { prop: 'locker', ry: PI / 2, ly: 0.12 });
    b.cont(CONT.TOOLBOX, -11, -8, { prop: 'toolbox', ry: 0.2, nocollide: true, ly: 0.12 });
    part(b, 4, -14, -11.6, 0.14);
    // the drum store, under a roof on posts
    b.shelter(10, -10, 10, 7, 3.2, 'tin', 'metal');
    for (const [dx, dz] of [[7, -11.4], [8, -11.4], [7.5, -10.5], [12.5, -8.4]]) b.prop('barrel', dx, dz, 0);
    part(b, 4, 10, -11.6);
    part(b, 4, 12.6, -10.4);
    part(b, 4, 9.4, -8.4);
    b.prop('fuel_tank', 14, -15.6, PI / 2);
    b.cont(CONT.CRATE, 4, -15, { prop: 'crate', ry: 0.3 });
    b.wreck('pickup_truck', -2, -14.6, 1.5);
    b.prop('streetlight', -5.5, -18.6, PI);
    b.prop('corpse', 2, -6, 2.4, { nocollide: true });
    b.loot(0, -4);
    b.loot(16, -4);
  });

  // ---------------------------------------------------------------- roadside & countryside sites
  // What stands along the roads and out on the plain between the places, as on the island: a wreck, a camp, a
  // stash, a shed.
  const sites = [];
  const siteOk = (x, z) => Math.abs(x) < HALF - 60 && Math.abs(z) < HALF - 60 && !inWater(x, z) && !nearZone(x, z, 18) && !onField(x, z, 14) && x > COAST + 30;
  const siteFree = (x, z, gapTo) => sites.every((s) => Math.hypot(s.x - x, s.z - z) >= gapTo);
  for (const road of roads) {
    if (road.length < 90) continue;
    const p = road.pts;
    let acc = rng.range(20, 50);
    let sideOf = rng.chance(0.5) ? 1 : -1;
    for (let i = 2; i < p.length / 2 - 2; i++) {
      acc += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      if (acc < (road.kind === ROAD.TRAIL ? 70 : 52)) continue;
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const type = ['wreck', 'wreck', 'camp', 'stash', 'shed', 'wreck'][rng.int(0, 5)];
      const off = road.width + (type === 'wreck' ? rng.range(2.5, 4) : rng.range(7, 10));
      const sx = p[i * 2] + (-tz / tl) * sideOf * off;
      const sz = p[i * 2 + 1] + (tx / tl) * sideOf * off;
      sideOf = -sideOf;
      if (!siteOk(sx, sz) || !siteFree(sx, sz, 30) || roadDistAt(sx, sz) < off - road.width - 1) continue;
      sites.push({ x: sx, z: sz, ry: Math.atan2((-tz / tl) * -sideOf, (tx / tl) * -sideOf), type, road: road.kind });
      acc = rng.range(-10, 10);
    }
  }
  for (let a = 0; a < 3000 && sites.length < 150; a++) {
    const x = rng.range(-HALF + 70, HALF - 70);
    const z = rng.range(-HALF + 70, HALF - 70);
    if (!siteOk(x, z) || roadDistAt(x, z) < 22 || !siteFree(x, z, 46)) continue;
    sites.push({ x, z, ry: rng.range(0, PI * 2), type: ['camp', 'stash', 'shed', 'camp'][rng.int(0, 3)], road: 0 });
  }
  for (const st of sites) {
    const b = new Builder(st.x, st.z, st.ry, heightAt(st.x, st.z));
    b.zone = ZONE.FOREST;
    b.ground = true;
    if (st.type === 'wreck') {
      b.wreck(rng.chance(0.7) ? 'car_wreck' : 'pickup_truck', 0, 0, PI / 2 + rng.range(-0.5, 0.5), { zone: ZONE.ROADSIDE });
      if (rng.chance(0.4)) b.prop('corpse', rng.range(-2.5, 2.5), -2.4, rng.range(0, 6), { nocollide: true });
      if (rng.chance(0.3)) b.loot(rng.range(-2, 2), 2.6);
    } else if (st.type === 'camp') {
      b.prop('tent', 0, 1.5, rng.range(-0.3, 0.3));
      b.prop('campfire', 0.3, -2.2, 0, { nocollide: true, seed: 1 });
      b.prop('log_bench', 2.65, -2.2, PI / 2 + 0.2);
      b.cont(CONT.DUFFEL, -1.9, -1.4, { prop: 'duffel_bag', ry: rng.range(0, 6), nocollide: true });
      b.loot(1.2, -3.8);
      b.clear(0, 0, 5);
    } else if (st.type === 'stash') {
      b.cont(CONT.AMMO_BOX, 0, 0, { prop: 'military_crate', ry: 0.2 });
      b.prop('sandbags', 0.2, 1.4, 0.1);
      b.prop('sandbags', -2, 0, PI / 2 - 0.2, { seed: 1 });
      b.prop('barrel', 1.8, -0.4, 0);
      b.clear(0, 0, 4);
    } else {
      b.ground = false;
      b.room(0, 0, 3.6, 3.2, 2.5, rng.chance(0.5) ? 'planks' : 'tin', { n: [door(1.8, 1.2)] }, { roof: 'flat', roofMat: 'tin' });
      b.cont(CONT.TOOLBOX, 0.9, 0.9, { prop: 'toolbox', ry: 0.3, nocollide: true });
      b.cont(CONT.SHELF, -1.15, 0.4, { prop: 'crate', ry: 0, h: 0.6 });
      b.prop('woodpile', 2.8, 0, PI / 2);
    }
  }
  // power poles along Route 9, where nothing stands in their way
  {
    const p = highway.pts;
    for (let i = 12; i < p.length / 2 - 12; i += 18) {
      const x = p[i * 2];
      const z = p[i * 2 + 1];
      if (nearZone(x, z, 10) || onField(x, z, 0)) continue;
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const px = x + (-tz / tl) * (highway.width + 3);
      const pz = z + (tx / tl) * (highway.width + 3);
      const dir = Math.atan2(-tx, -tz);
      if (propBlocked('power_pole', px, pz, dir) || sites.some((s) => Math.hypot(s.x - px, s.z - pz) < 8)) continue;
      const py = seatY('power_pole', px, pz, dir);
      props.push({ type: 'power_pole', x: px, y: py, z: pz, ry: dir, seed: i });
      addPropColliders('power_pole', px, py, pz, dir);
    }
  }

  // ---------------------------------------------------------------- vegetation
  // Open country: copses and hedgerows on the plain, thick woods only on the rim. Nothing grows on the city's
  // paving but what has broken through it (the dead trees the blocks plant with Builder.tree).
  const occ = new Map();
  const OCC = 3;
  const okey = (i, j) => i * 8192 + j;
  const occupied = (x, z, r) => {
    const ci = Math.floor(x / OCC);
    const cj = Math.floor(z / OCC);
    for (let j = cj - 2; j <= cj + 2; j++) {
      for (let i = ci - 2; i <= ci + 2; i++) {
        const arr = occ.get(okey(i, j));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 3) if ((arr[k] - x) ** 2 + (arr[k + 1] - z) ** 2 < (arr[k + 2] + r) ** 2) return true;
      }
    }
    return false;
  };
  const occupy = (x, z, r) => {
    const key = okey(Math.floor(x / OCC), Math.floor(z / OCC));
    if (!occ.has(key)) occ.set(key, []);
    occ.get(key).push(x, z, r);
  };
  for (const p of props) occupy(p.x, p.z, Math.max(2.5, Math.hypot(...(PROPS[p.type]?.size || [2, 0, 2]).filter((_, i) => i !== 1)) / 2 + 0.6));
  for (const [x, z, r] of clears) occupy(x, z, Math.min(r, 6));
  const clearHit = (x, z, pad) => clears.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 < (r + pad) ** 2);
  const zoneClear = (x, z) => zones.some((zn) => (x - zn.x) ** 2 + (z - zn.z) ** 2 < zn.clear * zn.clear) || onField(x, z, 6);
  const onRoad = (x, z, r) => roadDistAt(x, z) < (roadKindAt(x, z) === ROAD.TRAIL ? 2.2 : 5.5) + r;
  const trees = [];
  const pushTree = (x, z, v, scale) => {
    const y = heightAt(x, z);
    const rot = rng.range(0, PI * 2);
    occupy(x, z, 1.4 * scale);
    const c = makeCyl(x, z, y - 1, y + 14 * scale, TREE_R[v] * scale, COL.STATIC | COL.TREE);
    c.tv = v;
    c.ti = trees.length / 6;
    trees.push(x, y, z, scale, rot, v);
    staticGrid.add(c);
  };
  for (const [x, z, v, s] of extraTrees) if (!occupied(x, z, 1.2) && !inWater(x, z)) pushTree(x, z, v, s);
  const LIM = HALF - 4;
  for (let a = 0; a < 42000; a++) {
    const x = rng.range(-LIM, LIM);
    const z = rng.range(-LIM, LIM);
    // woods on the rim, copses over the plain
    const rim = smoothstep(HALF - 150, HALF - 40, Math.max(Math.abs(z), x));
    const dens = fbm(nE, x * 0.009, z * 0.009, 3);
    if (rng() > Math.max(rim, smoothstep(0.12, 0.42, dens) * 0.85)) continue;
    if (zoneClear(x, z) || onRoad(x, z, 0.6) || inWater(x, z) || x < shoreX(z) + 8 || clearHit(x, z, 0.8)) continue;
    const scale = rng.range(0.75, 1.3);
    if (occupied(x, z, 1.5 * scale)) continue;
    const r = rng();
    pushTree(x, z, r < 0.2 ? 0 : r < 0.38 ? 1 : r < 0.52 ? 2 : r < 0.78 ? 5 : r < 0.86 ? 6 : r < 0.94 ? 3 : 4, scale);
  }
  const rocks = [];
  for (let a = 0; a < 1600 && rocks.length < 520 * 6; a++) {
    const x = rng.range(-LIM, LIM);
    const z = rng.range(-LIM, LIM);
    if (zoneClear(x, z) || onRoad(x, z, 1.2) || inWater(x, z) || clearHit(x, z, 1)) continue;
    const v = rng.int(0, ROCK_R.length - 1);
    const scale = rng.range(0.6, 1.8);
    const r = ROCK_R[v] * scale;
    if (occupied(x, z, r + 0.5)) continue;
    const y = heightAt(x, z) - 0.25 * scale;
    occupy(x, z, r);
    rocks.push(x, y, z, scale, rng.range(0, PI * 2), v);
    staticGrid.add(makeCyl(x, z, y - 1, y + r * 0.9, r * 0.85, COL.STATIC));
  }
  const bushes = [];
  for (let a = 0; a < 26000; a++) {
    const x = rng.range(-LIM, LIM);
    const z = rng.range(-LIM, LIM);
    if (roadDistAt(x, z) < 4 || inWater(x, z) || onField(x, z, 0)) continue;
    const zn = nearZone(x, z, -8);
    if (zn && rng() < (zn.id === ZONE.CITY ? 0.93 : 0.85)) continue; // (the city is overgrown, but it is still paving)
    if (clearHit(x, z, 0) || occupied(x, z, 0.4)) continue;
    bushes.push(x, heightAt(x, z), z, rng.range(0.7, 1.5), rng.range(0, PI * 2), rng.int(0, 2));
  }

  // ---------------------------------------------------------------- spawns
  const resourceSpawns = [];
  for (let a = 0; a < 8000 && resourceSpawns.length < 300; a++) {
    const x = rng.range(-LIM + 20, LIM - 20);
    const z = rng.range(-LIM + 20, LIM - 20);
    if (zoneClear(x, z) || inWater(x, z) || occupied(x, z, 0.8)) continue;
    resourceSpawns.push({ x, y: heightAt(x, z) + 0.02, z, zone: ZONE.FOREST });
  }
  // fallback horde spawns (the horde normally appears round wherever the survivors are): a ring round the city
  const hordeSpawns = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * PI * 2;
    for (let tries = 0; tries < 8; tries++) {
      const r = rng.range(260, 420);
      const x = city.x * 0.5 + Math.sin(a) * r * 1.3;
      const z = Math.cos(a) * r;
      if (Math.abs(x) > LIM - 10 || Math.abs(z) > LIM - 10 || inWater(x, z)) continue;
      hordeSpawns.push({ x, z });
      break;
    }
  }

  // ---------------------------------------------------------------- queries
  const rayTerrain = (ox, oy, oz, dx, dy, dz, maxT) => {
    const step = 0.75;
    let prevT = 0;
    if (oy - heightAt(ox, oz) < 0) return 0;
    for (let t = step; t <= maxT + step; t += step) {
      const tt = t > maxT ? maxT : t;
      const y = oy + dy * tt;
      if (y > 70 && dy >= 0) return -1;
      if (y - heightAt(ox + dx * tt, oz + dz * tt) < 0) {
        let lo = prevT;
        let hi = tt;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          if (oy + dy * m - heightAt(ox + dx * m, oz + dz * m) < 0) hi = m;
          else lo = m;
        }
        return (lo + hi) / 2;
      }
      prevT = tt;
      if (tt >= maxT) break;
    }
    return -1;
  };
  const zoneAt = (x, z) => {
    for (const zn of zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.flat + 8) return zn.id;
    return ZONE.FOREST;
  };
  const openingNear = (x, z, maxD = 1.2) => {
    let best = null;
    let bd = maxD;
    for (const o of openings) {
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  };
  const start = { x: head.x, z: head.z };

  return {
    seed,
    kind: WORLD.MAINLAND,
    size: SIZE,
    half: HALF,
    gridN: N,
    posScale: POS_SCALE_WIDE,
    heights,
    roadDist,
    roadKind,
    roadDir,
    heightAt,
    floorAt: (x, z) => heightAt(x, z),
    mine: null,
    clinic: null,
    darks: [],
    darkAt: () => 0,
    fair: null,
    rail: null,
    roadDistAt,
    roadKindAt,
    rayTerrain,
    isDeepWater: (x, z) => heightAt(x, z) < WATER_LEVEL - 0.95,
    zoneAt,
    zones,
    zoneById,
    roads,
    highway,
    lake: null,
    ponds: [],
    sea: { x: COAST, shoreX }, // everything west of the shore, out past the edge of the map (the client lays water there)
    trees: new Float32Array(trees),
    rocks: new Float32Array(rocks),
    bushes: new Float32Array(bushes),
    parts,
    props,
    lights,
    roofs,
    staticGrid,
    structGrid,
    colliderGrids: [staticGrid, structGrid],
    lootSpawns,
    containers,
    partSpots,
    openings,
    openingNear,
    sites,
    resourceSpawns,
    hordeSpawns,
    spawnPoints,
    start,
    car,
    cemetery: null,
    bridge,
    runway,
    city: { x: city.x, z: city.z, pitch: PITCH, grid: GRID, lots },
  };
}
