// The mainland: the second map of a run (act 2, shared/acts.js), built from the same seed as the island the team
// escaped from and with the same kit (worldkit.js), so it is drawn, walked and fought on by the code that runs the
// island. It is twice as far across (MAINLAND_SIZE: 1280 m, four times the area) and laid out west to east the way
// the run goes:
//
//   the sea | the bridge comes ashore at the Bridgehead, on a bluff | Route 9 runs east over the coastal plain |
//   Port Calder, a ruined city of streets and blocks | the Mile 9 truck stop | Calder Field: a runway, hangars, a
//   terminal with its tower, a fuel depot, and the plane
//
// with Kessler Ironworks on a spur north or south of the city, the houses of Eastgate on the other side and two farms
// out on the plain. What a
// seed changes: where the bridge lands, where the city, the ironworks and the airfield sit, what stands on every
// lot of every block, the course of the roads between them, and everything that is scattered.
//
// A world made here has every field createWorld's has (world.js); what the island has and this map does not (the
// mine, the railway, the fair, the clinic, the cemetery) is null. On top of those:
//   bridge   where the bridge is (bridge.js): the cutscene drives the car along it, and the client draws it
//   runway   the runway and what stands on it: { x, z0, z1, half (its half width), y, truck: { x, y, z, ry } }
//   car      is the plane: the thing this act's supplies go into and its final stand is fought at (plane: true)
//   partSpots[i].supply   which of the plane's parts lies there (an index into PLANE_PARTS): they are at set places
//   props[i].live   set on the car at the bridgehead and on the plane: the client draws those two itself, because its
//            cutscenes move them (the car drives to that very spot; the plane is swapped for the one that flies)
//   city     { x, z, pitch, grid, lots: [{ x, z, w, d, ry, what }] }: what was built on every lot of Port Calder
//   farms    [{ x, z, ry }]: the farms out on the plain (no place names them: their loot is a farm's)
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
const BIG_BLOCKS = 2; // blocks that are one lot each, whatever the seed (the two tallest towers stand on them)...
const QUAD_BLOCKS = 5; // ...and blocks of four small lots (the shops and stations the run needs go on those)
const PAVE = 0.1; // a block's paving stands this far over the city's level (the roadway lies a little under it)
const FLOOR_Y = 0.12; // ...and a room's floor this far (Builder.room's slab)
const SETBACK = 1.2; // a building's front wall stands this far in from the edge of its lot
const CARPARK_DECK = 3.2; // from one deck of the multi-storey car park to the next
const FARMS = 2; // farms out on the plain, each FARM_R across its levelled yard
const FARM_R = 30;
const SITE_FLAT = 5.5; // the ground is levelled this far round a roadside site
const ROADBLOCKS = 3; // stretches of street somebody barricaded
// what is drawn for a lot nothing was dealt to, by weight: [kind, weight]
const SMALL_LOTS = [['grocery', 2], ['diner', 1.2], ['pharmacy', 0.6], ['hardware', 0.8], ['flats', 3.4], ['ruin', 1.6], ['burnt', 1.3], ['green', 1]];
const LONG_LOTS = [['terrace', 3], ['block', 2.5], ['carpark', 1.2], ['parking', 0.8]];
const BIG_LOTS = [['collapse', 1], ['depot', 1], ['parking', 1]];

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
  const G2 = (GRID * PITCH) / 2; // from the middle of the city to its edge streets
  const gate = [field.x - 150, field.z + 22]; // where the road in meets the airfield
  // Farms, out on the plain: a walk off Route 9, clear of every place and of every road and track planned below.
  // Each faces the highway, and a dirt track joins it there.
  const mainLine = [[head.x, head.z], [city.x - G2, city.z], [city.x + G2, city.z], [stop.x, stop.z], gate];
  const lanes = [
    [[city.x + PITCH, city.z + side * G2], [works.x, works.z]],
    [[city.x + G2, city.z - side * G2], [suburb.x, suburb.z]],
    [[head.x, head.z + 30], [city.x - G2 - 80, city.z + side * (G2 + 70)]],
    [[works.x + 40, works.z], [stop.x, stop.z + side * 40]],
  ];
  // the point of the leg a -> b nearest (x, z)
  const nearOn = ([ax, az], [bx, bz], x, z) => {
    const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2 || 1), 0, 1);
    return [ax + (bx - ax) * t, az + (bz - az) * t];
  };
  const farms = [];
  for (let tries = 0; tries < 600 && farms.length < FARMS; tries++) {
    const x = prng.range(COAST + 150, field.x - 260);
    const z = prng.range(-HALF + 170, HALF - 170);
    if (Math.abs(x - city.x) < G2 + 90 && Math.abs(z - city.z) < G2 + 90) continue;
    if ([works, suburb, stop].some((p) => Math.hypot(p.x - x, p.z - z) < 150) || farms.some((f) => Math.hypot(f.x - x, f.z - z) < 260)) continue;
    if (lanes.some(([a, b]) => Math.hypot(nearOn(a, b, x, z)[0] - x, nearOn(a, b, x, z)[1] - z) < 95)) continue;
    // where its track meets the highway: the nearest point of an open stretch (not in the city, not at a place)
    let to = null;
    for (const k of [0, 2, 3]) {
      const [a, b] = [mainLine[k], mainLine[k + 1]];
      const p = nearOn([a[0] + (b[0] - a[0]) * 0.2, a[1] + (b[1] - a[1]) * 0.2], [a[0] + (b[0] - a[0]) * 0.8, a[1] + (b[1] - a[1]) * 0.8], x, z);
      if (!to || Math.hypot(p[0] - x, p[1] - z) < Math.hypot(to[0] - x, to[1] - z)) to = p;
    }
    const d = Math.hypot(to[0] - x, to[1] - z);
    if (d < 120 || d > 300) continue;
    // ...by a line that crosses no place
    let crosses = false;
    for (let t = 0; t <= 1 && !crosses; t += 0.05) {
      const [px, pz] = [x + (to[0] - x) * t, z + (to[1] - z) * t];
      crosses = (Math.abs(px - city.x) < G2 + 40 && Math.abs(pz - city.z) < G2 + 40) || [works, suburb, stop].some((p) => Math.hypot(p.x - px, p.z - pz) < 90);
    }
    if (crosses) continue;
    // (its front, local -Z, to the highway, a quarter turn at a time: the yard is levelled as a square)
    farms.push({ x, z, to, ry: Math.round(Math.atan2(-(to[0] - x), -(to[1] - z)) / (PI / 2)) * (PI / 2) });
  }

  const zones = [];
  const put = (id, x, z, ry, spec) => zones.push({ id, x, z, ry, h: 0, blend: 26, ...spec });
  put(ZONE.BRIDGEHEAD, head.x, head.z, -PI / 2, { flat: 26, clear: 30, dirt: 0.35, blend: 22 }); // (its front faces east: inland)
  put(ZONE.CITY, city.x, city.z, 0, { flat: CITY_R, clear: CITY_R + 6, blend: 34 });
  put(ZONE.INDUSTRIAL, works.x, works.z, side > 0 ? 0 : PI, { flat: 52, clear: 58, dirt: 0.8 }); // (its front to the city)
  put(ZONE.SUBURB, suburb.x, suburb.z, side > 0 ? PI : 0, { flat: 50, clear: 40, dirt: 0.15 });
  put(ZONE.TRUCKSTOP, stop.x, stop.z, 0, { flat: 30, clear: 34, dirt: 0.3 });
  put(ZONE.TERMINAL, terminal.x, terminal.z, PI / 2, { flat: 30, clear: 36 }); // (its front faces west: the road in)
  put(ZONE.HANGARS, hangars.x, hangars.z, -PI / 2, { flat: 50, clear: 54 }); // (their doors face east: the apron)
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
    [city.x, city.z, G2 + 16, G2 + 16, cityH, 30], // the city, to its corners (they lie outside the circle of its zone)
  ];
  for (const f of farms) {
    f.h = Math.max(FLOOR + 1, H0(f.x, f.z) * 0.6 + 0.6);
    flats.push([f.x, f.z, FARM_R, FARM_R, f.h, 18]);
  }
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
          if (d < zn.flat + 12) hs[i] = lerp(hs[i], zn.h, 1 - smoothstep(zn.flat, zn.flat + 12, d));
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
  // Route 9 carries on from the bridge: over the plain, down Main Street, past the truck stop and out to the airfield
  const highway = buildRoad(
    [[head.x - 30, head.z], [head.x + 20, head.z], ...wander([head.x + 60, head.z], [cityW[0] - 40, city.z], 2, 0.07).slice(1), cityW, cityE, ...wander([cityE[0] + 40, city.z], [stop.x - 34, stop.z - 26], 1, 0.06), [stop.x + 34, stop.z - 26], ...wander([stop.x + 70, stop.z - 24], gate, 1, 0.05).slice(1), [terminal.x - 26, terminal.z]],
    ROAD.ASPHALT,
    3.8,
    'Route 9',
  );
  // the city's streets (Main Street is Route 9 itself)
  for (let i = 0; i <= GRID; i++) {
    const o = -G2 + i * PITCH;
    buildRoad([[city.x + o, city.z - G2 - 8], [city.x + o, city.z + G2 + 8]], ROAD.ASPHALT, 3.4, '', cityH);
    if (i !== GRID / 2) buildRoad([[city.x - G2 - 8, city.z + o], [city.x + G2 + 8, city.z + o]], ROAD.ASPHALT, 3.4, '', cityH);
  }
  // the spur to the ironworks and the lane out to Eastgate, off the city's edge streets
  buildRoad(wander([city.x + PITCH, city.z + side * (G2 + 8)], [works.x, works.z - side * 44], 2, 0.08), ROAD.ASPHALT, 3, 'Kessler Road');
  buildRoad(wander([city.x + G2, city.z - side * (G2 + 8)], [suburb.x - 46, suburb.z], 1, 0.06), ROAD.DIRT, 2.6);
  buildRoad([[suburb.x - 42, suburb.z], [suburb.x + 42, suburb.z]], ROAD.DIRT, 2.6);
  // the airfield: the runway, the taxi lane along the apron, the road on to the depot
  const runwayRoad = buildRoad([[field.x, field.z - RUNWAY_LEN / 2], [field.x, field.z + RUNWAY_LEN / 2]], ROAD.ASPHALT, RUNWAY_HALF, 'Runway 36', fieldH);
  buildRoad([[terminal.x - 26, terminal.z], [terminal.x - 28, hangars.z - 30], [hangars.x - 34, hangars.z + 4]], ROAD.ASPHALT, 2.8, '', fieldH);
  buildRoad([[terminal.x - 26, terminal.z], [depot.x - 30, depot.z + 40], [depot.x - 24, depot.z]], ROAD.DIRT, 2.6);
  // a track from each farm down to the highway
  for (const f of farms) {
    const p = highway.pts;
    let best = 0;
    for (let i = 0; i < p.length / 2; i++) if (Math.hypot(p[i * 2] - f.to[0], p[i * 2 + 1] - f.to[1]) < Math.hypot(p[best * 2] - f.to[0], p[best * 2 + 1] - f.to[1])) best = i;
    buildRoad(wander([f.x - Math.sin(f.ry) * (FARM_R - 4), f.z - Math.cos(f.ry) * (FARM_R - 4)], [p[best * 2], p[best * 2 + 1]], 1, 0.05), ROAD.DIRT, 2.4);
  }
  // forest tracks over the plain: from the bridgehead along the shore, and round the back of the city
  buildRoad(wander([head.x + 10, head.z + 30], [city.x - G2 - 80, city.z + side * (G2 + 70)], 3, 0.06), ROAD.TRAIL, 1.5);
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
    // (live: the client draws these two itself - the crossing's cutscene drives the car to this very spot)
    b.prop('car', 0, 16, 0.08, { seed: 7 });
    props[props.length - 1].live = true;
    for (let i = 0; i < 8; i++) spawnPoints.push({ x: b.wx(-5 + (i % 4) * 3.2, -2 - Math.floor(i / 4) * 3), z: b.wz(-5 + (i % 4) * 3.2, -2 - Math.floor(i / 4) * 3) });
    // what is left of the last span's end: the edge of the abutment, shut off
    for (const lx of [-3.6, 3.6]) b.prop('jersey_barrier', lx, 37.4, 0, { seed: 1 }); // (the car came through between them)
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
  // GRID x GRID blocks. Every block is paved and split into lots - four small ones round a cross of alleys, two long
  // ones back to back, or one big one - and what stands on a lot is drawn from the seed, after the places the run
  // needs have been dealt out (the plane's magneto is in a parts shop; two blocks are big, for the towers).
  const lots = [];
  {
    const order = [];
    for (let k = 0; k < GRID * GRID; k++) order.push(k);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    // (the first BIG_BLOCKS of the shuffle are one lot each, the next QUAD_BLOCKS four: the rest as the seed has it)
    const layoutOf = new Map(order.map((k, n) => [k, n < BIG_BLOCKS ? 'big' : n < BIG_BLOCKS + QUAD_BLOCKS ? 'quad' : null]));
    for (let bi = 0; bi < GRID; bi++) {
      for (let bj = 0; bj < GRID; bj++) {
        const bx = city.x - G2 + (bi + 0.5) * PITCH;
        const bz = city.z - G2 + (bj + 0.5) * PITCH;
        const b = new Builder(bx, bz, 0, cityH);
        b.zone = ZONE.CITY;
        b.box(0, 0, 0, BLOCK, PAVE, BLOCK, 'concrete'); // the pavement
        b.clear(0, 0, BLOCK * 0.72);
        const r = rng();
        const layout = layoutOf.get(bi * GRID + bj) || (r < 0.45 ? 'quad' : r < 0.9 ? 'long' : 'big');
        // which way a lot faces: out of the block, onto the street it stands on. face: the world direction [dx, dz]
        const lot = (lx, lz, w, d, face) => lots.push({ x: bx + lx, z: bz + lz, w, d, ry: Math.atan2(-face[0], -face[1]), bi, bj, what: '' });
        if (layout === 'quad') {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) lot(sx * 11.25, sz * 11.25, 19.5, 19.5, rng.chance(0.5) ? [sx, 0] : [0, sz]);
        } else if (layout === 'long') {
          if (rng.chance(0.5)) for (const sx of [-1, 1]) lot(sx * 11.25, 0, 42, 19.5, [sx, 0]);
          else for (const sz of [-1, 1]) lot(0, sz * 11.25, 42, 19.5, [0, sz]);
        } else lot(0, 0, 42, 42, [[1, 0], [-1, 0], [0, 1], [0, -1]][rng.int(0, 3)]);
      }
    }
  }
  // The buildings. Each is given a builder at the middle of its lot, front (-Z) on the street, and the lot's size.
  // A building's front wall stands SETBACK in from the lot's edge; a room's floor is FLOOR_Y over the pavement.
  // F, the frame of a room: { w, d, cz, front, back, L, R } - its size, the middle of it, and where its walls are.
  const frame = (L, w, d) => {
    const cz = -L.d / 2 + SETBACK + d / 2;
    return { w, d, cz, front: cz - d / 2, back: cz + d / 2, L: -w / 2, R: w / 2 };
  };
  const WALL = 0.125 + 0.06; // from a wall's line to the face of what stands against it (half the wall, and a gap)
  const backZ = (F, depth) => F.back - WALL - depth / 2;
  const leftX = (F, depth) => F.L + WALL + depth / 2;
  const rightX = (F, depth) => F.R - WALL - depth / 2;
  const inside = { ly: FLOOR_Y };
  const cont = (b, ctype, prop, x, z, ry, o = {}) => b.cont(ctype, x, z, { prop, ry, ly: FLOOR_Y, ...o });
  // rows of windows up a solid block: a dark band a floor, proud of each face (no collider: the block has one)
  const bands = (b, cx, cz, w, d, y0, floors, fh) => {
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * fh + 1.0;
      b.box(cx, y, cz - d / 2 - 0.03, w - 1.6, 1.3, 0.06, 'dark', { collide: false });
      b.box(cx, y, cz + d / 2 + 0.03, w - 1.6, 1.3, 0.06, 'dark', { collide: false });
      b.box(cx - w / 2 - 0.03, y, cz, 0.06, 1.3, d - 1.6, 'dark', { collide: false });
      b.box(cx + w / 2 + 0.03, y, cz, 0.06, 1.3, d - 1.6, 'dark', { collide: false });
    }
  };
  // the floors over a walk-in ground floor: shut, and solid. Returns the height of the roof
  const storeys = (b, F, y0, floors, fh, mat) => {
    b.box(0, y0, F.cz, F.w, floors * fh, F.d, mat);
    bands(b, 0, F.cz, F.w, F.d, y0, floors, fh);
    b.box(0, y0 + floors * fh, F.cz, F.w + 0.4, 0.5, F.d + 0.4, 'concrete', { collide: false }); // parapet
    return y0 + floors * fh;
  };
  // what is behind a building: bins, a pallet, a dead tree come up through the paving
  const yard = (b, F, L) => {
    if (rng.chance(0.6)) b.cont(CONT.DUMPSTER, F.L + 2.2, F.back + 1.6, { prop: 'dumpster', ry: PI, ly: PAVE });
    if (rng.chance(0.5)) b.prop('pallet', F.L + 5.2, F.back + 1.4, rng.range(0, 3), { ly: PAVE });
    if (L.d / 2 - F.back > 4.5 && rng.chance(0.6)) b.tree(rng.range(-L.w / 2 + 2.5, L.w / 2 - 2.5), L.d / 2 - 2.2, rng.chance(0.5) ? 3 : 4, rng.range(0.8, 1.15));
    if (rng.chance(0.3)) b.prop('corpse', rng.range(-3, 3), F.back + 3.2, rng.range(0, 6), { nocollide: true, ly: PAVE });
  };
  // A shop's room: a glass front with the door in the middle of it, a yard door at the back's right-hand end. x0:
  // where its middle is along the lot (a terrace has three). Returns its frame, in a builder of its own.
  const shopRoom = (b, L, w, d, mat, x0 = 0) => {
    const s = b.sub(x0, 0);
    const F = frame(L, w, d);
    s.room(0, F.cz, w, d, 3.8, mat, { n: [door(w / 2, 1.6), win(w * 0.2, Math.min(3, w * 0.22), 0.8, 2.8), win(w * 0.8, Math.min(3, w * 0.22), 0.8, 2.8)], s: [door(2.4, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    return [s, F];
  };
  // what is in a shop, by what it sold. Each fills a room of any width from 12 m up, clear of its two doors.
  const FILL = {
    grocery(b, F) {
      b.box(F.L + 3, FLOOR_Y, F.front + 3.2, 3.4, 1.0, 0.7, 'planks'); // counter
      b.loot(F.L + 3, F.front + 3.2, FLOOR_Y + 1.02);
      for (const dx of [1.6, 3.9, 6.2]) cont(b, CONT.SHELF, 'shelf', F.L + dx, backZ(F, 0.5), PI);
      cont(b, CONT.SHELF, 'shelf', F.R - 4.6, F.cz + 0.4, PI / 2);
      cont(b, CONT.FRIDGE, 'fridge', rightX(F, 0.72), F.cz - 0.2, -PI / 2);
      b.loot(F.R - 3, F.cz - 2.4, FLOOR_Y + 0.02);
    },
    pharmacy(b, F) {
      b.box(F.L + 4.2, FLOOR_Y, F.cz + 0.4, 5, 1.0, 0.7, 'planks');
      b.loot(F.L + 4.2, F.cz + 0.4, FLOOR_Y + 1.02);
      for (const dx of [1.2, 2.3]) cont(b, CONT.MEDICINE, 'medicine_cabinet', F.L + dx, backZ(F, 0.45), PI);
      cont(b, CONT.CABINET, 'cabinet', F.L + 4.2, backZ(F, 0.55), PI);
      cont(b, CONT.SHELF, 'shelf', rightX(F, 0.5), F.cz - 1.4, -PI / 2);
      b.prop('wheelchair', F.L + 1.6, F.front + 2.2, 0.6, { nocollide: true, ly: FLOOR_Y });
      b.loot(F.R - 2.4, F.cz + 1.6, FLOOR_Y + 0.02);
    },
    hardware(b, F) {
      b.box(F.L + 3, FLOOR_Y, F.front + 3.4, 3.6, 1.0, 0.7, 'planks');
      b.cont(CONT.TOOLBOX, F.L + 3, F.front + 3.4, { prop: 'toolbox', ry: 0.3, nocollide: true, ly: FLOOR_Y + 1.0 });
      for (const dx of [1.6, 3.9]) cont(b, CONT.SHELF, 'shelf', F.L + dx, backZ(F, 0.5), PI);
      cont(b, CONT.CRATE, 'crate', F.L + 6.6, backZ(F, 1), 0.1);
      cont(b, CONT.SHELF, 'shelf', F.R - 4.6, F.cz, PI / 2);
      b.prop('tire_pile', rightX(F, 1.4), F.cz - 2.6, 0, inside);
      b.loot(F.R - 3, F.cz + 2, FLOOR_Y + 0.02);
      b.loot(F.L + 1.4, F.cz - 1, FLOOR_Y + 0.02);
    },
    diner(b, F) {
      const len = F.w - 8;
      b.box(F.L + 1.2 + len / 2, FLOOR_Y, F.cz + 2.2, len, 1.05, 0.7, 'planks'); // the counter
      b.loot(F.L + 2.4, F.cz + 2.2, FLOOR_Y + 1.07);
      cont(b, CONT.FRIDGE, 'fridge', F.L + 1.1, backZ(F, 0.72), PI);
      cont(b, CONT.CABINET, 'cabinet', F.L + 2.8, backZ(F, 0.55), PI);
      for (const tx of [F.L + 2.2, F.R - 2.2]) {
        b.prop('table', tx, F.front + 2.4, 0.05, inside);
        b.prop('chair', tx - 1.2, F.front + 2.5, PI / 2, inside);
        b.prop('chair', tx + 1.2, F.front + 2.3, -PI / 2, inside);
      }
      b.loot(F.R - 2.2, F.front + 2.4, FLOOR_Y + 0.82);
    },
    // Calder Aero Supply: where the plane's magneto is
    aero(b, F) {
      FILL.hardware(b, F);
      part(b, 1, F.R - 1.4, F.cz - 0.6, FLOOR_Y + 0.02);
    },
  };
  const SHOPS = [['grocery', 'brick'], ['pharmacy', 'concrete'], ['hardware', 'tin'], ['diner', 'clapboard'], ['grocery', 'concrete'], ['hardware', 'brick']];
  const BUILD = {
    shop(b, L, kind, mat) {
      const [s, F] = shopRoom(b, L, 16, 11, mat);
      FILL[kind](s, F);
      yard(b, F, L);
    },
    // a row of three shops under one roof
    terrace(b, L) {
      const F = frame(L, 38.4, 11);
      const U = F.w / 3;
      const k0 = rng.int(0, SHOPS.length - 1);
      for (let k = 0; k < 3; k++) {
        const kind = SHOPS[(k0 + k * 2) % SHOPS.length][0];
        const mat = SHOPS[k0][1]; // (one row, one wall)
        const [s, Fu] = shopRoom(b, L, U, 11, mat, (k - 1) * U);
        FILL[kind](s, Fu);
      }
      yard(b, F, L);
      b.wreck(rng.chance(0.5) ? 'car_wreck' : 'car_burnt', F.R - 6, F.back + 3.4, PI / 2 + rng.range(-0.2, 0.2), { ly: PAVE, trunk: rng.chance(0.5) });
    },
    // the police station: a front office, and behind a door the armoury
    police(b, L) {
      const F = frame(L, 16, 12);
      b.room(0, F.cz, F.w, F.d, 3.6, 'brick', { n: [door(F.w / 2, 1.5), win(F.w * 0.2, 1.6), win(F.w * 0.8, 1.6)], s: [door(2.4, 1.1)], w: [win(F.d * 0.7, 1.2, 1.5, 2.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      b.wall(F.L, F.cz + 1.5, F.R, F.cz + 1.5, 3.6, 0.2, 'brick', [door(4, 1.2)]);
      b.box(3, FLOOR_Y, F.cz - 1.4, 4, 1.05, 0.8, 'planks'); // the front desk
      b.loot(3, F.cz - 1.4, FLOOR_Y + 1.07);
      cont(b, CONT.CABINET, 'cabinet', rightX(F, 0.55), F.cz - 3.4, -PI / 2);
      for (const dz of [3, 4.3]) cont(b, CONT.LOCKER, 'locker', leftX(F, 0.5), F.cz + dz, PI / 2, { seed: dz | 0 });
      cont(b, CONT.AMMO_BOX, 'military_crate', -1, backZ(F, 0.8), PI);
      cont(b, CONT.AMMO_BOX, 'military_crate', 1.6, backZ(F, 0.8), PI, { seed: 1 });
      b.loot(-3, F.cz + 3.6, FLOOR_Y + 0.02);
      b.prop('sandbags', -4.5, F.front - 0.55, 0, { ly: PAVE });
      yard(b, F, L);
    },
    // flats over a ground floor that can be walked into: a hall, two rooms, what the people who lived there left
    flats(b, L) {
      const F = frame(L, 16, 12);
      const mat = rng.chance(0.5) ? 'brick' : 'concrete';
      b.room(0, F.cz, F.w, F.d, 3.2, mat, { n: [door(F.w / 2, 1.4), win(F.w * 0.2, 1.6), win(F.w * 0.8, 1.6)], s: [door(2.2, 1.1), win(F.w * 0.7, 1.4)], e: [win(F.d / 2, 1.4)], w: [win(F.d / 2, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks' });
      b.wall(1.4, F.front, 1.4, F.back, 3.2, 0.18, 'concrete', [door(F.d * 0.6, 1.2)]);
      storeys(b, F, 3.5, rng.int(2, 4), 3, mat);
      b.prop('bed', F.L + 1.1, F.back - 1.4, 0, inside);
      cont(b, CONT.CABINET, 'cabinet', F.L + 3.2, backZ(F, 0.55), PI);
      b.prop('table', F.R - 4, F.cz - 2.4, 0.1, inside);
      b.prop('chair', F.R - 4, F.cz - 1.5, PI, inside);
      b.loot(F.R - 4, F.cz - 2.4, FLOOR_Y + 0.82);
      cont(b, CONT.FRIDGE, 'fridge', rightX(F, 0.72), F.cz + 0.4, -PI / 2);
      b.loot(F.L + 3, F.cz - 2.5, FLOOR_Y + 0.02);
      if (rng.chance(0.4)) b.cont(CONT.DUFFEL, F.L + 4.6, F.cz + 1.4, { prop: 'duffel_bag', ry: 0.8, nocollide: true, ly: FLOOR_Y });
      yard(b, F, L);
    },
    // a long block of flats: two halls, four rooms on the ground floor
    block(b, L) {
      const F = frame(L, 38, 12);
      const mat = rng.chance(0.5) ? 'brick' : 'concrete';
      b.room(0, F.cz, F.w, F.d, 3.2, mat, { n: [door(F.w * 0.25, 1.4), door(F.w * 0.75, 1.4), win(4, 1.6), win(15, 1.6), win(23, 1.6), win(34, 1.6)], s: [door(2.2, 1.1), door(F.w - 2.2, 1.1), win(12, 1.4), win(26, 1.4)], e: [win(F.d / 2, 1.4)], w: [win(F.d / 2, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks' });
      for (const [wx, at] of [[-12.5, 0.65], [0, 0.3], [12.5, 0.65]]) b.wall(wx, F.front, wx, F.back, 3.2, 0.18, 'concrete', [door(F.d * at, 1.2)]);
      storeys(b, F, 3.5, rng.int(3, 5), 3, mat);
      for (const sx of [-1, 1]) {
        b.prop('bed', sx * 14, F.back - 1.4, 0, inside);
        cont(b, sx < 0 ? CONT.CABINET : CONT.FRIDGE, sx < 0 ? 'cabinet' : 'fridge', sx * (F.R - WALL - 0.36), F.cz - 1, sx < 0 ? PI / 2 : -PI / 2);
        b.prop('table', sx * 4.5, F.cz + 2.6, 0.1, inside);
        b.loot(sx * 4.5, F.cz + 2.6, FLOOR_Y + 0.82);
        b.prop('bed', sx * 1.5, F.back - 1.4, 0, inside);
        b.loot(sx * 16, F.cz - 2.6, FLOOR_Y + 0.02);
      }
      cont(b, CONT.LOCKER, 'locker', -7, backZ(F, 0.5), PI);
      b.cont(CONT.DUFFEL, 7, F.cz + 3.4, { prop: 'duffel_bag', ry: 1.9, nocollide: true, ly: FLOOR_Y });
      yard(b, F, L);
    },
    // an office tower. big: on a lot of its own, the tallest thing for a mile; otherwise a small one on a street lot
    tower(b, L, big) {
      const F = big ? frame(L, 26, 24) : frame(L, 15.5, 13);
      const h = big ? 4.4 : 3.8;
      const fh = big ? 3.3 : 3.2;
      const floors = big ? rng.int(8, 11) : rng.int(5, 7);
      b.room(0, F.cz, F.w, F.d, h, 'concrete', { n: [door(F.w / 2, 1.7), win(F.w * 0.22, F.w * 0.17, 0.6, h - 0.8), win(F.w * 0.78, F.w * 0.17, 0.6, h - 0.8)], s: [door(3, 1.2)], e: [win(F.d / 2, F.d * 0.3, 0.6, h - 0.8)], w: [win(F.d / 2, F.d * 0.3, 0.6, h - 0.8)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      // the core, with the lifts nobody will ride again, and the front desk
      const core = big ? 5 : 3;
      b.box(-F.w / 6, FLOOR_Y, F.cz + F.d / 6, core, h - FLOOR_Y, core, 'concrete');
      b.box(F.w / 4, FLOOR_Y, F.cz - F.d / 5, 3.6, 1.05, 0.9, 'planks');
      b.loot(F.w / 4, F.cz - F.d / 5, FLOOR_Y + 1.07);
      cont(b, CONT.CABINET, 'cabinet', rightX(F, 0.55), F.cz + F.d / 5, -PI / 2);
      cont(b, CONT.LOCKER, 'locker', leftX(F, 0.5), F.cz + F.d / 2 - 2.4, PI / 2);
      b.loot(F.L + 2, F.cz - F.d / 4, FLOOR_Y + 0.02);
      if (big) {
        cont(b, CONT.CABINET, 'cabinet', F.L + 6, backZ(F, 0.55), PI, { seed: 1 });
        b.cont(CONT.DUFFEL, 3, F.cz + 6, { prop: 'duffel_bag', ry: 0.4, nocollide: true, ly: FLOOR_Y });
        b.loot(6, F.cz + 8, FLOOR_Y + 0.02);
      }
      const shaft = { ...F, w: F.w - 1, d: F.d - 1 };
      const top = h + 0.3 + floors * fh;
      b.box(0, h + 0.3, F.cz, shaft.w, floors * fh, shaft.d, 'concrete');
      bands(b, 0, F.cz, shaft.w, shaft.d, h + 0.3, floors, fh);
      // what the fire left of its top: a broken storey, steel standing out of it
      b.box(-F.w / 6, top, F.cz + F.d / 8, F.w * 0.55, 2.4, F.d * 0.6, 'charred', { collide: false });
      for (const [sx, sz, sh] of [[-0.3, -0.3, 5.5], [0.25, -0.2, 3.8], [-0.1, 0.3, 6.6], [0.34, 0.28, 2.8]]) b.box(sx * F.w, top, F.cz + sz * F.d, 0.3, sh, 0.3, 'rust', { collide: false });
      if (!big) return yard(b, F, L);
      // the plaza behind it: planters gone to dead wood, a shelter, the cars of people who never came down
      for (const tx of [-14, -5, 5, 14]) b.tree(tx, L.d / 2 - 3.4, rng.chance(0.5) ? 3 : 4, rng.range(0.9, 1.2));
      b.prop('bus_shelter', -15.5, F.back + 5, PI / 2, { ly: PAVE });
      b.wreck('car_wreck', 8, F.back + 5.5, PI / 2 + 0.2, { ly: PAVE });
      b.wreck('car_burnt', 16.5, F.cz + 3, 0.1, { ly: PAVE, trunk: false });
      b.cont(CONT.DUMPSTER, -17, F.cz - 4, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      b.loot(0, F.back + 4, PAVE + 0.02);
    },
    // a block that came down: a corner of its ground floor still stands, the rest is heaps, one of them out in the street
    ruin(b, L) {
      const w = Math.min(L.w - 3, 16);
      const d = 13;
      const cz = -L.d / 2 + SETBACK + d / 2;
      b.box(-w / 2, PAVE, cz, 0.4, 3.4, d, 'brick');
      b.box(-w / 4, PAVE, cz + d / 2, w / 2, 2.2, 0.4, 'brick');
      b.box(w / 2 - 1.5, PAVE, cz - d / 2, 3, 1.3, 0.4, 'brick');
      b.prop('rubble_pile', 1.6, cz + 0.8, rng.range(0, 6), { ly: PAVE });
      b.prop('rubble_pile', rng.range(-3, 3), -L.d / 2 - 3.1, rng.range(0, 6), { ground: true });
      b.box(-2.4, 1.3, cz - 2.6, w * 0.4, 0.3, 4, 'concrete', { rz: 0.3, collide: false });
      b.box(4.4, 0.9, cz + 4.4, 4.4, 0.2, 0.2, 'rust', { rz: -0.34, ry: -0.7, collide: false });
      b.cont(CONT.DUFFEL, -w / 2 + 1.6, cz - d / 2 + 1.6, { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
      b.loot(w / 2 - 1.2, cz + d / 2 - 1.2, PAVE + 0.02);
      b.prop('corpse', -w / 2 + 2.6, cz + d / 2 - 2, 1.1, { nocollide: true, ly: PAVE });
      b.tree(L.w / 2 - 2.4, L.d / 2 - 2.4, 4, 1);
    },
    // burnt out: the walls, black, with the sky over them
    burnt(b, L) {
      const F = frame(L, 15, 11);
      b.room(0, F.cz, F.w, F.d, 3.4, 'charred', { n: [gap(F.w / 2, 2.2, 2.6), gap(F.w * 0.2, 2.4, 2.4)], s: [gap(F.w * 0.7, 3, 3)], e: [gap(F.d / 2, 1.6, 2.2)] }, { floorMat: 'ash' });
      b.box(1, 0.6, F.cz, F.w * 0.7, 0.22, 0.22, 'charred', { rz: 0.22, ry: 0.5, collide: false });
      b.box(-2, 0.3, F.cz + 1.4, F.w * 0.5, 0.2, 0.2, 'charred', { rz: -0.1, ry: -0.8, collide: false });
      cont(b, CONT.CABINET, 'cabinet', F.L + 1.2, backZ(F, 0.55), PI);
      b.prop('bones', F.w / 4, F.cz + 1, 0.4, { nocollide: true, ly: FLOOR_Y });
      b.loot(0, F.cz, FLOOR_Y + 0.02);
      b.wreck('car_burnt', F.R - 2, F.back + 4, 0.2, { ly: PAVE, trunk: false });
    },
    // a lot nobody built on: a bus shelter on the street, dead trees, what was dumped there
    green(b, L) {
      b.prop('bus_shelter', -3, -L.d / 2 + 1.4, 0, { ly: PAVE });
      for (const [tx, tz] of [[-6, 2], [5, -3], [2, 6], [-4, 7]]) b.tree(tx + rng.range(-1, 1), tz + rng.range(-1, 1), rng.chance(0.5) ? 3 : 4, rng.range(0.8, 1.2));
      b.wreck(rng.chance(0.5) ? 'car_burnt' : 'car_wreck', 5.5, 3.5, rng.range(0, 6), { ly: PAVE, trunk: rng.chance(0.5) });
      b.cont(CONT.DUFFEL, -2.4, 3.4, { prop: 'duffel_bag', ry: 0.3, nocollide: true, ly: PAVE });
      b.prop('bones', 0.6, -1.4, 1, { nocollide: true, ly: PAVE });
      b.cont(CONT.CRATE, -6.5, -3.5, { prop: 'crate', ry: 0.3, ly: PAVE });
      b.loot(1.5, 0.5, PAVE + 0.02);
    },
    // a multi-storey car park, or the frame of one: two decks on columns over a ground floor of cars
    carpark(b, L) {
      const F = frame(L, 38, 15);
      for (const cx of [-18.7, -9.4, 0, 9.4, 18.7]) for (const dz of [-7.2, 0, 7.2]) b.box(cx, PAVE, F.cz + dz, 0.5, CARPARK_DECK * 2, 0.5, 'concrete');
      for (const k of [1, 2]) {
        b.box(0, CARPARK_DECK * k, F.cz, F.w, 0.3, F.d, 'concrete');
        b.box(0, CARPARK_DECK * k + 0.3, F.front + 0.1, F.w, 0.9, 0.2, 'concrete', { collide: false });
        b.box(0, CARPARK_DECK * k + 0.3, F.back - 0.1, F.w, 0.9, 0.2, 'concrete', { collide: false });
      }
      b.roofSpan(0, F.cz, F.w / 2, F.d / 2, CARPARK_DECK, 0.3);
      b.box(15.4, 0.2, F.cz - 3.4, 6, 0.3, 3.2, 'concrete', { rz: 0.32, collide: false }); // what is left of the ramp
      for (let k = 0; k < 6; k++) {
        if (!rng.chance(0.55)) continue;
        const t = rng();
        b.wreck(t < 0.5 ? 'car_wreck' : t < 0.8 ? 'car_burnt' : 'pickup_truck', -16.2 + k * 4.7, F.cz + (k % 2 ? 3.6 : -3.6), rng.range(-0.12, 0.12), { ly: PAVE, trunk: rng.chance(0.5) });
      }
      b.cont(CONT.DUFFEL, -4.7, F.cz, { prop: 'duffel_bag', ry: 0.9, nocollide: true, ly: PAVE });
      b.loot(4.7, F.cz, PAVE + 0.02);
      b.loot(-14, F.cz, PAVE + 0.02);
      yard(b, F, L);
    },
    // a whole block down: one corner of it still stands seven floors high, over a field of rubble
    collapse(b, L) {
      const floors = rng.int(4, 6);
      b.box(-13, PAVE, -12, 11, floors * 3, 10, 'concrete');
      bands(b, -13, -12, 11, 10, PAVE, floors, 3);
      b.box(-12, PAVE + floors * 3, -11, 7, 2, 6, 'charred', { collide: false });
      for (const [sx, sz, sh] of [[-17, -15.5, 4.4], [-9.5, -8.6, 3], [-15, -8.4, 5.2]]) b.box(sx, PAVE + floors * 3, sz, 0.3, sh, 0.3, 'rust', { collide: false });
      for (const [px, pz] of [[-2, -10], [8, -4], [-8, 4], [2, 9], [13, 10], [12, -14]]) b.prop('rubble_pile', px + rng.range(-1, 1), pz + rng.range(-1, 1), rng.range(0, 6), { ly: PAVE });
      b.prop('rubble_pile', rng.range(-6, 6), -L.d / 2 - 3.1, rng.range(0, 6), { ground: true });
      b.box(3, 1.4, 1, 9, 0.35, 6, 'concrete', { rz: 0.24, ry: 0.4, collide: false });
      b.box(-6, 1.0, 12, 7, 0.3, 5, 'concrete', { rx: -0.2, ry: -0.3, collide: false });
      b.box(15, PAVE, 0, 0.4, 3, 9, 'brick');
      b.box(4, PAVE, 18.6, 12, 2.2, 0.4, 'brick');
      b.cont(CONT.DUFFEL, 16.4, 3, { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
      b.cont(CONT.CRATE, 6, 16.6, { prop: 'crate', ry: 0.2, ly: PAVE });
      b.cont(CONT.AMMO_BOX, -17, 2, { prop: 'military_crate', ry: 0.4, ly: PAVE });
      b.prop('corpse', 3, -4, 2, { nocollide: true, ly: PAVE });
      b.prop('bones', -3, 8, 0.4, { nocollide: true, ly: PAVE });
      b.loot(8, 3, PAVE + 0.02);
      b.loot(-12, 10, PAVE + 0.02);
      for (const [tx, tz] of [[17, -17], [-17, 16]]) b.tree(tx, tz, 4, rng.range(0.9, 1.2));
    },
    // the bus depot: a roof on posts over the buses that never went out, and the dispatcher's office
    depot(b, L) {
      b.shelter(-4, -4, 30, 16, 5.4, 'tin', 'metal');
      for (const px of [-9.5, -2, 6]) for (const pz of [-11.8, 3.8]) b.cyl(px, PAVE, pz, 0.14, 5.4 - PAVE, 'metal', { sides: 6 });
      b.wreck('school_bus', -13, -4, 0.04, { ly: PAVE, trunk: false });
      b.wreck('school_bus', -6, -4.4, PI - 0.03, { ly: PAVE, trunk: false, seed: 1 });
      b.wreck('ambulance', 2, -3, 0.1, { ly: PAVE, trunk: false });
      b.room(14, 12, 10, 8, 3.2, 'brick', { n: [door(5, 1.3), win(2, 1.4), win(8, 1.4)], w: [win(4, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      b.cont(CONT.LOCKER, 18.56, 13, { prop: 'locker', ry: -PI / 2, ly: FLOOR_Y });
      b.cont(CONT.CABINET, 11, 15.5, { prop: 'cabinet', ry: PI, ly: FLOOR_Y });
      b.cont(CONT.TOOLBOX, 15.5, 14.6, { prop: 'toolbox', ry: 0.6, nocollide: true, ly: FLOOR_Y });
      b.prop('table', 14, 10.4, 0, inside);
      b.loot(14, 10.4, FLOOR_Y + 0.82);
      b.prop('gas_pump', 9, -15, 0, { ly: PAVE });
      b.prop('tire_pile', -17, 12, 0, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -10, 16, { prop: 'dumpster', ry: PI, ly: PAVE });
      b.cont(CONT.CRATE, 2, 12, { prop: 'crate', ry: 0.2, ly: PAVE });
      b.prop('corpse', 6, 6, 1.2, { nocollide: true, ly: PAVE });
      b.loot(-2, 10, PAVE + 0.02);
      b.loot(10, -8, PAVE + 0.02);
    },
    // a car park nobody drove out of
    parking(b, L) {
      const rows = Math.max(1, Math.floor((L.d - 6) / 7));
      const cols = Math.max(2, Math.floor((L.w - 3) / 3.4));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!rng.chance(0.42)) continue;
          const t = rng();
          b.wreck(t < 0.55 ? 'car_wreck' : t < 0.8 ? 'car_burnt' : 'pickup_truck', -L.w / 2 + 2.6 + c * 3.4 + rng.range(-0.2, 0.2), -L.d / 2 + 5 + r * 7, (rng.chance(0.5) ? 0 : PI) + rng.range(-0.1, 0.1), { trunk: rng.chance(0.45), ly: PAVE });
        }
      }
      b.prop('streetlight', L.w / 2 - 1, L.d / 2 - 1, PI, { ly: PAVE });
      b.loot(0, L.d / 2 - 2, PAVE + 0.02);
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
    const long = order.filter((i) => lots[i].w > 40 && lots[i].d < 40);
    const small = order.filter((i) => lots[i].w < 40);
    const plan = new Map();
    const deal = (from, list) => list.forEach((what) => from.length && plan.set(from.shift(), what));
    // (two of each: the towers, and the parts shops the plane's magneto may be in)
    deal(big, ['tower', 'tower', 'collapse', 'depot']);
    deal(small, ['aero', 'aero', 'office', 'office', 'police', 'pharmacy', 'hardware']);
    deal(long, ['terrace', 'block', 'carpark']);
    const pick = (W) => {
      let r = rng() * W.reduce((s, e) => s + e[1], 0);
      for (const [t, wt] of W) if ((r -= wt) <= 0) return t;
      return W[0][0];
    };
    lots.forEach((L, i) => {
      const b = new Builder(L.x, L.z, L.ry, cityH);
      b.zone = ZONE.CITY;
      const what = plan.get(i) || (L.w < 40 ? pick(SMALL_LOTS) : L.d < 40 ? pick(LONG_LOTS) : pick(BIG_LOTS));
      L.what = what;
      if (what === 'aero') BUILD.shop(b, L, 'aero', 'tin');
      else if (FILL[what]) BUILD.shop(b, L, what, SHOPS.find((s) => s[0] === what)[1]);
      else if (what === 'office') BUILD.tower(b, L, false);
      else if (what === 'tower') BUILD.tower(b, L, true);
      else BUILD[what](b, L);
    });
  }
  // The streets: wrecks where they stopped, lamps along the kerbs, lights dead at the crossings, a bus across one of
  // them, and a few roadblocks somebody held - barriers a car cannot pass and a survivor can. Whatever would stand
  // in something already there (a heap of rubble out of a fallen block) is left out, after its draws.
  {
    const b = new Builder(city.x, city.z, 0, cityH);
    b.zone = ZONE.CITY;
    b.ground = true; // (the roadway lies a little under the city's level: what is on it stands on the ground)
    const free = (type, lx, lz, ry) => !propBlocked(type, b.wx(lx, lz), b.wz(lx, lz), ry);
    const blocks = new Set();
    for (let n = 0; n < ROADBLOCKS; n++) blocks.add(`${rng.int(0, GRID)}:${rng.int(0, GRID - 1)}:${rng.chance(0.5) ? 1 : 0}`);
    for (let i = 0; i <= GRID; i++) {
      for (let k = 0; k < GRID; k++) {
        for (const ns of [true, false]) {
          // (the stretch of street i between crossings k and k + 1, north-south or east-west)
          const o = -G2 + i * PITCH;
          const m = -G2 + (k + 0.5) * PITCH;
          const at = (along, across) => (ns ? [o + across, m + along] : [m + along, o + across]);
          const yaw = ns ? 0 : PI / 2;
          if (blocks.has(`${i}:${k}:${ns ? 1 : 0}`)) {
            // a roadblock: three barriers with a gap a body gets through, sandbags and a crate behind them
            const s0 = rng.range(-8, 8);
            for (const across of [-4.4, -1.3, 4.4]) {
              const [x, z] = at(s0, across);
              if (free('jersey_barrier', x, z, yaw)) b.prop('jersey_barrier', x, z, yaw);
            }
            const [sx, sz] = at(s0 + 2.2, -3.2);
            if (free('sandbags', sx, sz, yaw)) b.prop('sandbags', sx, sz, yaw);
            const [cx, cz] = at(s0 + 2.4, 3.8);
            if (free('military_crate', cx, cz, yaw)) b.cont(CONT.AMMO_BOX, cx, cz, { prop: 'military_crate', ry: yaw, zone: ZONE.CHECKPOINT });
            continue;
          }
          for (const sgn of [-1, 1]) {
            const here = rng.chance(0.5);
            const [x, z] = at(rng.range(-15, 15), sgn * rng.range(1.7, 2.6));
            const t = rng();
            const ry = yaw + (sgn > 0 ? PI : 0) + rng.range(-0.25, 0.25);
            const trunk = rng.chance(0.4);
            const type = t < 0.5 ? 'car_wreck' : t < 0.75 ? 'car_burnt' : t < 0.92 ? 'pickup_truck' : 'ambulance';
            if (here && free(type, x, z, ry)) b.wreck(type, x, z, ry, { trunk: trunk && type !== 'car_burnt' && type !== 'ambulance', zone: ZONE.ROADSIDE });
          }
          const [lx, lz] = at(-20, 5.1);
          if (free('streetlight', lx, lz, 0)) b.prop('streetlight', lx, lz, ns ? PI / 2 : 0); // (its arm out over the roadway)
          const body = rng.chance(0.2);
          const [cx, cz] = at(rng.range(-10, 10), rng.range(-1, 1));
          if (body) b.prop('corpse', cx, cz, rng.range(0, 6), { nocollide: true });
        }
      }
    }
    // traffic lights on the crossings of Main Street, a bus slewed across one of the others
    for (let i = 1; i < GRID; i++) {
      const x = -G2 + i * PITCH;
      if (free('traffic_light', x + 5.2, -5.2, PI)) b.prop('traffic_light', x + 5.2, -5.2, PI); // (their arms out over Main Street)
      if (free('traffic_light', x - 5.2, 5.2, 0)) b.prop('traffic_light', x - 5.2, 5.2, 0);
    }
    const jx = -G2 + rng.int(1, GRID - 1) * PITCH;
    const jz = -G2 + [1, 3][rng.int(0, 1)] * PITCH;
    if (free('school_bus', jx + 1, jz - 0.5, 0.9)) b.wreck('school_bus', jx + 1, jz - 0.5, 0.9, { trunk: false });
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
      s.prop('bed', -4.3, -2.2, 0); // (clear of the back door)
      s.cont(k % 2 ? CONT.CABINET : CONT.FRIDGE, 4.2, 3.3, { prop: k % 2 ? 'cabinet' : 'fridge', ry: PI });
      s.prop('table', 2, -1.6, 0.1);
      s.loot(2, -1.6, 0.82);
      s.loot(-2.4, 2);
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
  props.push({ type: 'plane_wreck', x: car.x, y: car.y, z: car.z, ry: car.ry, seed: 7, live: true }); // (live: as the car at the bridgehead - the take-off swaps it for the one that flies)
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
    b.wreck('pickup_truck', RUNWAY_HALF - 1.4, -40, 0.12, { trunk: false });
    b.wreck('car_wreck', -RUNWAY_HALF + 1.4, -110, 0.2);
    b.prop('jersey_barrier', RUNWAY_HALF - 1.5, 60, PI / 2, { seed: 1 });
    b.prop('jersey_barrier', -RUNWAY_HALF + 1.5, 20, PI / 2, { seed: 2 });
    b.prop('corpse', 3, 90, 0.4, { nocollide: true });
    // light aircraft that never got off: one ran off the side, one stands on the grass by the apron
    b.prop('light_plane', RUNWAY_HALF + 15, -70, 0.8, { ground: true, seed: 0 });
    b.prop('light_plane', -RUNWAY_HALF - 9, -20, -2.2, { ground: true, seed: 1 });
    b.clear(RUNWAY_HALF + 15, -70, 8);
    b.clear(-RUNWAY_HALF - 9, -20, 8);
  }
  place(ZONE.HANGARS, (b) => {
    // three hangars in a row, their doors (local -Z: east) open on the apron
    const hangar = (lx, k) => {
      const s = b.sub(lx, 6, 0);
      s.room(0, 0, 24, 24, 8, 'tin', { n: [gap(12, 16, 6.4)], s: [door(20, 1.3)], e: [win(12, 2)], w: [win(12, 2)] }, { roof: 'gableZ', roofH: 3.6, roofMat: 'tin', floorMat: 'concrete' });
      s.cont(CONT.SHELF, -4.6, 11.3, { prop: 'shelf', ry: PI, ly: FLOOR_Y, seed: k }); // (clear of the back door at x -8)
      s.cont(CONT.TOOLBOX, -2.4, 9.4, { prop: 'toolbox', ry: 0.5, nocollide: true, ly: FLOOR_Y, seed: k });
      s.cont(CONT.LOCKER, 11.56, 4, { prop: 'locker', ry: -PI / 2, ly: FLOOR_Y, seed: k });
      s.cont(CONT.CRATE, 8.6, 10.4, { prop: 'crate', ry: 0.2, ly: FLOOR_Y, seed: k });
      s.prop('barrel', -10.9, 3, 0, { ly: FLOOR_Y, seed: k });
      s.loot(0, 8, FLOOR_Y + 0.02);
      s.loot(-8, -4, FLOOR_Y + 0.02);
      part(s, 0, -10.6, 9.6, FLOOR_Y + 0.02); // the propeller, off the rack on the back wall
      if (k) part(s, 4, 10, -6, FLOOR_Y + 0.02);
      return s;
    };
    hangar(-30, 0).prop('light_plane', 1.5, 0, 0.35, { ly: FLOOR_Y, seed: 1 });
    hangar(0, 1).wreck('pickup_truck', -4, 2, 0.3, { ly: FLOOR_Y, trunk: false });
    const h3 = hangar(30, 2);
    h3.prop('pallet', 3, 2, 0.3, { ly: FLOOR_Y });
    h3.cont(CONT.AMMO_BOX, -6, 4, { prop: 'military_crate', ry: 0.4, ly: FLOOR_Y });
    b.prop('generator', 0, 20.5, 0.2);
    b.cont(CONT.DUMPSTER, 45, 2, { prop: 'dumpster', ry: PI / 2 });
    b.wreck('car_wreck', -46.5, 10, 0.4);
    b.prop('streetlight', 15, -9, 0);
    b.prop('streetlight', -15, -9, 0);
    b.prop('corpse', 3, -12, 2, { nocollide: true });
    b.loot(-15, -11);
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
    b.wreck('ambulance', -8, -13, 1.4, { ly: 0.05, trunk: false });
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

  // FARMS: a barn, the house, a silo, a fenced field gone to weed. They are not places of the map (nothing names
  // them): what lies about them comes off a farm's table (the island's Miller Farm).
  for (const f of farms) {
    const b = new Builder(f.x, f.z, f.ry, f.h);
    b.zone = ZONE.BARN;
    b.yard = { x: f.x, z: f.z, flat: FARM_R - 2 };
    b.clear(0, 0, FARM_R + 8);
    b.clear(-46, 0, 26);
    b.room(13, 8, 12, 18, 5.6, 'barn', { n: [gap(6, 4.4, 4.2)], w: [door(13, 1.4)] }, { roof: 'gable', roofH: 4, roofMat: 'tin', floorMat: 'planks' });
    b.prop('hay_square', 17.5, 14.5, 0);
    b.prop('hay_square', 17.5, 14.5, 0, { ly: 0.6 });
    b.prop('hay_square', 17.5, 13.2, 0.1);
    b.prop('hay_round', 9.6, 14, 0.3);
    b.prop('cart', 16, 4, 0.4);
    b.cont(CONT.SHELF, 18.5, 9, { prop: 'shelf', ry: -PI / 2 });
    b.cont(CONT.TOOLBOX, 9, 9, { prop: 'toolbox', ry: 0.4, nocollide: true });
    b.loot(12, 3);
    b.loot(14, 10);
    b.room(-14, 6, 10, 8, 3, 'clapboard', { n: [door(5, 1.2), win(2.2), win(7.8)], e: [win(4)], w: [win(4)], s: [win(3), door(8, 1.1)] }, { roof: 'gableZ', roofH: 2.6, roofMat: 'shingles' });
    b.wall(-15.2, 2, -15.2, 10, 3, 0.18, 'clapboard', [door(5.4, 1.1)]);
    b.box(-14, 0, 0.8, 10, 0.3, 2.2, 'planks'); // porch
    b.prop('bed', -17.6, 4, 0);
    b.prop('table', -11.6, 4, 0.1);
    b.prop('chair', -11.2, 5.1, 2.5);
    b.cont(CONT.CABINET, -10.4, 9.35, { prop: 'cabinet', ry: PI });
    b.cont(CONT.FRIDGE, -17.9, 8.6, { prop: 'fridge', ry: PI / 2 });
    b.loot(-11.6, 4, 0.82);
    b.cyl(23, 0, -8, 2.6, 11, 'metal');
    b.cone(23, 11, -8, 2.8, 2.2, 'tin', 14, { ry: 0 });
    b.wreck('tractor', 2, -12, 0.5, { trunk: false });
    b.wreck('pickup_truck', -7, -19, 1.7);
    b.prop('well', -3, 16, 0);
    b.prop('outhouse', -24, 14, PI / 2);
    b.cont(CONT.LOGPILE, 2, 22, { prop: 'woodpile', ry: 0.2 });
    b.prop('corpse', 4, -4, 2.2, { nocollide: true });
    // the field, west of the yard: fenced, with a gap in each side
    for (let i = 0; i < 8; i++) {
      if (i !== 3) b.prop('fence', -58.5 + i * 3, -18, 0);
      if (i !== 5) b.prop('fence', -58.5 + i * 3, 18, 0);
    }
    for (let i = 0; i < 12; i++) {
      if (i !== 6) b.prop('fence', -60, -16.5 + i * 3, PI / 2);
      if (i !== 2) b.prop('fence', -36, -16.5 + i * 3, PI / 2);
    }
    b.prop('scarecrow', -48, 2, 0.4);
    b.prop('hay_round', -41, -12, 1.1);
    b.prop('hay_round', -54, 10, 0.2);
    for (let i = 0; i < 8; i++) b.prop('pumpkin', rng.range(-57, -39), rng.range(-15, 15), rng.range(0, 6), { nocollide: true });
    b.loot(-48, -6);
    f.hedge = [[-62, -20, -62, 20], [-62, -20, -34, -20], [-62, 20, -34, 20]].map(([x0, z0, x1, z1]) => [b.wx(x0, z0), b.wz(x0, z0), b.wx(x1, z1), b.wz(x1, z1)]);
  }

  // ---------------------------------------------------------------- roadside & countryside sites
  // What stands along the roads and out on the plain between the places, as on the island: a wreck, a camp, a
  // stash, a shed.
  const sites = [];
  const inCity = (x, z, pad) => Math.abs(x - city.x) < G2 + pad && Math.abs(z - city.z) < G2 + pad;
  const siteOk = (x, z) => !inCity(x, z, 26) && farms.every((f) => Math.hypot(f.x - x, f.z - z) > FARM_R + 40) && Math.abs(x) < HALF - 60 && Math.abs(z) < HALF - 60 && !inWater(x, z) && !nearZone(x, z, 18) && !onField(x, z, 14) && x > COAST + 30;
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
  // level the ground under each (not the roads beside them), so a shed's walls and what stands by them sit true
  for (const st of sites) {
    const h0 = heightAt(st.x, st.z);
    const R = SITE_FLAT + 5;
    for (let j = Math.max(0, Math.floor((st.z - R + HALF) / GRID_STEP)); j <= Math.min(N - 1, Math.ceil((st.z + R + HALF) / GRID_STEP)); j++) {
      for (let i = Math.max(0, Math.floor((st.x - R + HALF) / GRID_STEP)); i <= Math.min(N - 1, Math.ceil((st.x + R + HALF) / GRID_STEP)); i++) {
        const k = j * N + i;
        if (roadDist[k] < 3.5) continue;
        heights[k] = lerp(heights[k], h0, 1 - smoothstep(SITE_FLAT, R, Math.hypot(-HALF + i * GRID_STEP - st.x, -HALF + j * GRID_STEP - st.z)));
      }
    }
    st.h = h0;
  }
  for (const st of sites) {
    const b = new Builder(st.x, st.z, st.ry, st.h);
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
  // does a trunk or a boulder of radius r at (x, z) stand in an upright piece somebody built (a wall, a post)?
  let partCells = null;
  const partBlocked = (x, z, r) => {
    if (!partCells) {
      partCells = new Map();
      for (const p of parts) {
        if (p.rx || p.rz || p.sy < 1 || (p.shape !== 'box' && p.shape !== 'cyl')) continue;
        const e = Math.hypot(p.sx, p.sz) / 2;
        for (let i = Math.floor((p.x - e) / 8); i <= Math.floor((p.x + e) / 8); i++) {
          for (let j = Math.floor((p.z - e) / 8); j <= Math.floor((p.z + e) / 8); j++) {
            const k = i * 65536 + j;
            if (!partCells.has(k)) partCells.set(k, []);
            partCells.get(k).push(p);
          }
        }
      }
    }
    for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++) {
      for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++) {
        for (const p of partCells.get(i * 65536 + j) || []) {
          if (p.shape === 'cyl') {
            if (Math.hypot(p.x - x, p.z - z) < r + p.sx / 2) return true;
          } else {
            const c = Math.cos(p.ry);
            const s = Math.sin(p.ry);
            const lx = c * (x - p.x) - s * (z - p.z);
            const lz = s * (x - p.x) + c * (z - p.z);
            if (Math.hypot(Math.max(0, Math.abs(lx) - p.sx / 2), Math.max(0, Math.abs(lz) - p.sz / 2)) < r) return true;
          }
        }
      }
    }
    return false;
  };
  const trees = [];
  const pushTree = (x, z, v, scale) => {
    const y = heightAt(x, z);
    const rot = rng.range(0, PI * 2);
    occupy(x, z, 1.4 * scale);
    if (partBlocked(x, z, TREE_R[v] * scale + 0.15)) return; // (left out after its draws, as on the island)
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

  // hedgerows round the fields of the farms: a line of bushes, grown out
  for (const f of farms) {
    for (const [x0, z0, x1, z1] of f.hedge) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 0; d <= len; d += 1.1) {
        const x = x0 + ((x1 - x0) * d) / len + rng.range(-0.3, 0.3);
        const z = z0 + ((z1 - z0) * d) / len + rng.range(-0.3, 0.3);
        bushes.push(x, heightAt(x, z), z, rng.range(1.1, 1.7), rng.range(0, PI * 2), rng.int(0, 2));
      }
    }
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
    farms: farms.map((f) => ({ x: f.x, z: f.z, ry: f.ry })),
  };
}
