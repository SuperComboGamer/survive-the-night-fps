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
import { OUTLYING, SUBURB } from './mainland-places.js';

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
const GRID = 6;
const BLOCK = PITCH - STREET; // a block is this far across
const PAVED = PITCH - 7.4; // ...and its paving this far: the lots, and a pavement round them out to the kerb of the roadway
const CITY_R = (GRID * PITCH) / 2 + 18; // the levelled ground reaches this far from the middle of the city
const BIG_BLOCKS = 6; // blocks that are one lot each, whatever the seed (the two tallest towers stand on them)...
const QUAD_BLOCKS = 13; // ...and blocks of four small lots (the shops and stations the run needs go on those)
const PAVE = 0.1; // a block's paving stands this far over the city's level (the roadway lies a little under it)
const FLOOR_Y = 0.12; // ...and a room's floor this far (Builder.room's slab)
const SETBACK = 1.2; // a building's front wall stands this far in from the edge of its lot
const CARPARK_DECK = 3.2; // from one deck of the multi-storey car park to the next
const FARMS = 2; // farms out on the plain, each FARM_R across its levelled yard
const FARM_R = 30;
const SITE_FLAT = 5.5; // the ground is levelled this far round a roadside site
const ROADBLOCKS = 5; // stretches of street somebody barricaded
const JAMS = 3; // ...and stretches where the traffic stopped for good, bumper to bumper
const SINKHOLES = 2; // ...and where the street fell in
const SMOKES = 9; // columns of smoke standing over the city (world.lights 'smoke'), and FIRES still burning under them
const FIRES = 3;
const PLACE_GAP = 62; // open country left between two places out on the plain (m, yard to yard)
const PONDS = 4;
const JAM_EVERY = 120; // a pile-up on Route 9 about this often (m)
// what is drawn for a lot nothing was dealt to, by weight: [kind, weight]
const SMALL_LOTS = [['grocery', 1.6], ['diner', 1.2], ['pharmacy', 0.5], ['hardware', 0.8], ['flats', 3.6], ['office', 0.9], ['ruin', 2.2], ['burnt', 1.8], ['gas', 0.5], ['green', 0.5]];
const LONG_LOTS = [['terrace', 3], ['block', 3], ['carpark', 1], ['parking', 0.5], ['cinema', 0.3]];
const BIG_LOTS = [['collapse', 1.4], ['tower', 1], ['depot', 0.5], ['parking', 0.5]];

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
  const G2 = (GRID * PITCH) / 2; // from the middle of the city to its edge streets
  const zb = prng.range(-80, 80); // where the bridge comes ashore
  const city = { x: prng.range(-205, -175), z: clamp(zb + prng.range(-60, 60), -100, 100) };
  const side = prng.chance(0.5) ? 1 : -1; // the ironworks is north (-1) or south (1) of the city; Eastgate the other way
  const field = { x: HALF - 132, z: prng.range(-70, 70) }; // the middle of the runway
  const works = { x: city.x + prng.range(40, 110), z: city.z + side * (G2 + prng.range(150, 180)) };
  const suburb = { x: city.x + prng.range(120, 170), z: city.z - side * (G2 + prng.range(100, 125)) };
  const stop = { x: prng.range(170, 215), z: lerp(city.z, field.z + 60, 0.5) + prng.range(-30, 30) };
  // the airfield's places hang off the runway: the apron is west of its south half, with the hangars on it, the
  // terminal north of them and the fuel depot north of that, set back from everything
  const plane = { x: field.x, z: field.z + RUNWAY_LEN / 2 - 26 };
  const apron = { x: field.x - 44, z: field.z + 112, hx: 30, hz: 76 }; // (a rectangle of concrete)
  const hangars = { x: field.x - 96, z: field.z + 128 };
  const terminal = { x: field.x - 96, z: field.z + 22 };
  const depot = { x: field.x - 104, z: field.z - 96 };
  const head = { x: COAST + 46, z: zb };
  const gate = [field.x - 150, field.z + 22]; // where the road in meets the airfield
  const cityW = [city.x - G2, city.z];
  const cityE = [city.x + G2, city.z];
  // Route 9's line: the bridge, the army's checkpoint half way to the city, Main Street, the truck stop, the airfield
  const hwA = [head.x + 60, head.z];
  const hwB = [cityW[0] - 40, city.z];
  const hwL = Math.hypot(hwB[0] - hwA[0], hwB[1] - hwA[1]);
  const hwD = [(hwB[0] - hwA[0]) / hwL, (hwB[1] - hwA[1]) / hwL];
  const block9 = { x: (hwA[0] + hwB[0]) / 2, z: (hwA[1] + hwB[1]) / 2 };
  const mainLine = [[head.x, head.z], [block9.x, block9.z], cityW, cityE, [stop.x, stop.z], gate];
  // the point of the leg a -> b nearest (x, z)
  const nearOn = ([ax, az], [bx, bz], x, z) => {
    const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2 || 1), 0, 1);
    return [ax + (bx - ax) * t, az + (bz - az) * t];
  };
  const lineDist = (x, z) => {
    let d = Infinity;
    for (let k = 0; k < mainLine.length - 1; k++) {
      const p = nearOn(mainLine[k], mainLine[k + 1], x, z);
      d = Math.min(d, Math.hypot(p[0] - x, p[1] - z));
    }
    return d;
  };
  const inCity = (x, z, pad) => Math.abs(x - city.x) < G2 + pad && Math.abs(z - city.z) < G2 + pad;
  const onField = (x, z, pad) => Math.abs(x - (field.x - 30)) < 80 + pad && Math.abs(z - field.z) < RUNWAY_LEN / 2 + 30 + pad;

  // ---- what lies about: the places out on the plain (mainland-places.js), each on ground of its own
  // spots: every place put down so far { id, x, z, flat, ry }. A new one keeps PLACE_GAP of open country from each,
  // and stands clear of the city, the airfield, Route 9 and the lake.
  const spots = [];
  const spot = (id, x, z, flat, ry = 0, more = {}) => {
    const sp = { id, x, z, flat, ry, ...more };
    spots.push(sp);
    return sp;
  };
  spot(ZONE.BRIDGEHEAD, head.x, head.z, 26, -PI / 2);
  spot(ZONE.INDUSTRIAL, works.x, works.z, 52);
  spot(ZONE.SUBURB, suburb.x, suburb.z, 50);
  spot(ZONE.TRUCKSTOP, stop.x, stop.z, 30);
  spot(ZONE.TERMINAL, terminal.x, terminal.z, 30, PI / 2);
  spot(ZONE.HANGARS, hangars.x, hangars.z, 50, -PI / 2);
  spot(ZONE.FUEL_DEPOT, depot.x, depot.z, 31, PI / 2); // (to the corners of its fence)
  let lake = null;
  const tracks = []; // [x0, z0, x1, z1]: the line of a farm's track down to the highway, which nothing later stands on
  const trackDist = (x, z) => tracks.reduce((d, [x0, z0, x1, z1]) => { const p = nearOn([x0, z0], [x1, z1], x, z); return Math.min(d, Math.hypot(p[0] - x, p[1] - z)); }, Infinity);
  const lakeDist = (x, z) => (lake ? Math.hypot(x - lake.x, z - lake.z) - lake.r : Infinity);
  const room = (x, z, flat, gapTo = PLACE_GAP) =>
    x > COAST + 130 + flat &&
    Math.max(Math.abs(x), Math.abs(z)) + flat < HALF - 86 &&
    !inCity(x, z, flat + 46) &&
    !onField(x, z, flat + 40) &&
    lineDist(x, z) > flat + 36 &&
    lakeDist(x, z) > flat + 46 &&
    trackDist(x, z) > flat + 30 &&
    spots.every((o) => Math.hypot(o.x - x, o.z - z) - o.flat - flat > gapTo);
  // (places with a spot of their own: on Route 9, beside the city, at the end of the runway)
  spot(ZONE.ROADBLOCK, block9.x, block9.z, OUTLYING[ZONE.ROADBLOCK].flat, Math.atan2(-hwD[0], -hwD[1]));
  spot(ZONE.WESTGATE, city.x - G2 - 30, city.z + side * (G2 + 108), OUTLYING[ZONE.WESTGATE].flat);
  spot(ZONE.QUARANTINE, cityE[0] + 104, city.z - side * 96, OUTLYING[ZONE.QUARANTINE].flat);
  {
    const t = 0.56;
    spot(ZONE.MALL, lerp(cityE[0], stop.x, t), lerp(city.z, stop.z, t) + side * 92, OUTLYING[ZONE.MALL].flat);
    spot(ZONE.MOTORINN, lerp(stop.x, gate[0], 0.5), lerp(stop.z, gate[1], 0.5) - side * 76, OUTLYING[ZONE.MOTORINN].flat);
    spot(ZONE.CRASH, field.x + 8, field.z - RUNWAY_LEN / 2 - 96, OUTLYING[ZONE.CRASH].flat);
  }
  // the lake: the roomiest of a handful of spots, and the marina on its shore nearest the city
  {
    let best = -Infinity;
    for (let i = 0; i < 90; i++) {
      const r = prng.range(46, 60);
      const x = prng.range(COAST + 250, field.x - 250);
      const z = prng.range(-HALF + 190, HALF - 190);
      if (!room(x, z, r + 30, 40)) continue;
      let open = lineDist(x, z);
      for (const o of spots) open = Math.min(open, Math.hypot(o.x - x, o.z - z) - o.flat);
      if (open > best) {
        best = open;
        lake = { x, z, r };
      }
    }
  }
  if (lake) {
    const a = Math.atan2(city.x - lake.x, city.z - lake.z) + prng.range(-0.5, 0.5);
    const x = lake.x + Math.sin(a) * (lake.r + 11.5);
    const z = lake.z + Math.cos(a) * (lake.r + 11.5);
    spot(ZONE.MARINA, x, z, OUTLYING[ZONE.MARINA].flat, Math.atan2(lake.x - x, lake.z - z), { fixed: true }); // (its pier, +Z, out over the water)
  }
  // Farms: a walk off Route 9, each facing it (a quarter turn at a time: its yard is levelled as a square) with a
  // dirt track down to it
  const farms = [];
  for (let tries = 0; tries < 9000 && farms.length < FARMS; tries++) {
    const x = prng.range(COAST + 170, tries < 1200 ? field.x - 200 : HALF - 160);
    const z = prng.range(-HALF + 150, HALF - 150);
    // (the longer it takes, the less open country a farm asks for round it: there are always two)
    const ease = Math.min(1, tries / 2400);
    if (!room(x, z, FARM_R + 34, lerp(PLACE_GAP, 2, ease))) continue; // (its field lies west of the yard: room for both)
    // where its track meets the highway: the nearest point of an open stretch (not in the city, not at a place)
    let to = null;
    for (const k of [0, 1, 3, 4]) {
      const [a, b] = [mainLine[k], mainLine[k + 1]];
      const p = nearOn([a[0] + (b[0] - a[0]) * 0.2, a[1] + (b[1] - a[1]) * 0.2], [a[0] + (b[0] - a[0]) * 0.8, a[1] + (b[1] - a[1]) * 0.8], x, z);
      if (!to || Math.hypot(p[0] - x, p[1] - z) < Math.hypot(to[0] - x, to[1] - z)) to = p;
    }
    const d = Math.hypot(to[0] - x, to[1] - z);
    if (d < 120 || d > lerp(330, 900, ease)) continue;
    // ...by a line that crosses no place
    let crosses = false;
    for (let s = FARM_R + 4; s <= d && !crosses; s += 6) {
      const [px, pz] = [x + ((to[0] - x) * s) / d, z + ((to[1] - z) * s) / d];
      crosses = inCity(px, pz, 40) || onField(px, pz, 16) || lakeDist(px, pz) < 20 || trackDist(px, pz) < 12 || spots.some((o) => Math.hypot(o.x - px, o.z - pz) < o.flat + 26);
    }
    if (crosses) continue;
    const ry = Math.round(Math.atan2(-(to[0] - x), -(to[1] - z)) / (PI / 2)) * (PI / 2);
    farms.push({ x, z, to, ry });
    tracks.push([x, z, to[0], to[1]]);
    spot(farms.length === 1 ? ZONE.FARM_A : ZONE.FARM_B, x, z, FARM_R, ry, { fixed: true, farm: true });
  }
  // (a farm no straight track reaches the highway from: wherever there is room for it, and the county roads find it)
  for (let tries = 0; tries < 6000 && farms.length < FARMS; tries++) {
    const x = prng.range(COAST + 170, HALF - 160);
    const z = prng.range(-HALF + 150, HALF - 150);
    if (!room(x, z, FARM_R + 34, 2)) continue;
    const ry = Math.round(Math.atan2(-(city.x - x), -(city.z - z)) / (PI / 2)) * (PI / 2);
    farms.push({ x, z, to: null, ry });
    spot(farms.length === 1 ? ZONE.FARM_A : ZONE.FARM_B, x, z, FARM_R, ry, { fixed: true, road: ROAD.DIRT });
  }
  // ...and the rest, each on the best of a handful of spots: the roomiest, weighted by what the place wants (the
  // mast high ground, the loggers the woods of the rim, the school the edge of town)
  {
    const reliefAt = (x, z) => fbm(nA, x * 0.003, z * 0.003, 4);
    const WANT = {
      [ZONE.MAST]: (x, z) => reliefAt(x, z) * 2.2,
      [ZONE.LOGGING]: (x, z) => Math.max(Math.abs(z), x) / HALF,
      [ZONE.SCHOOL]: (x, z) => -Math.abs(Math.hypot(x - city.x, z - city.z) - (G2 + 150)) / 260,
      [ZONE.CONTAINERS]: (x, z) => -Math.hypot(x - works.x, z - works.z) / 500,
      [ZONE.TRAILERPARK]: (x, z) => -lineDist(x, z) / 700,
    };
    for (const id of [ZONE.SCHOOL, ZONE.CONTAINERS, ZONE.TRAILERPARK, ZONE.SALVAGE, ZONE.SUBSTATION, ZONE.WATERWORKS, ZONE.GRAVEYARD, ZONE.LOGGING, ZONE.MAST]) {
      const flat = OUTLYING[id].flat;
      let best = null;
      let bs = -Infinity;
      for (let i = 0; i < 70; i++) {
        const x = prng.range(COAST + 150, HALF - 120);
        const z = prng.range(-HALF + 110, HALF - 110);
        const jit = prng() * 0.25;
        if (!room(x, z, flat)) continue;
        let open = 160;
        for (const o of spots) open = Math.min(open, Math.hypot(o.x - x, o.z - z) - o.flat - flat);
        const sc = open / 160 + (WANT[id]?.(x, z) ?? 0) + jit;
        if (sc > bs) {
          bs = sc;
          best = [x, z];
        }
      }
      if (best) spot(id, best[0], best[1], flat);
    }
  }
  // ponds, out where nothing else is
  const ponds = [];
  for (let tries = 0; tries < 500 && ponds.length < PONDS; tries++) {
    const r = prng.range(12, 19);
    const x = prng.range(COAST + 160, HALF - 150);
    const z = prng.range(-HALF + 140, HALF - 140);
    if (!room(x, z, r + 6, 34) || ponds.some((p) => Math.hypot(p.x - x, p.z - z) < 150)) continue;
    ponds.push({ x, z, r, depth: 0.9 + r * 0.115 });
  }
  const pondDist = (x, z) => ponds.reduce((d, p) => Math.min(d, Math.hypot(p.x - x, p.z - z) - p.r), Infinity);

  const zones = [];
  const put = (id, x, z, ry, spec) => zones.push({ id, x, z, ry, h: 0, blend: 26, ...spec });
  put(ZONE.CITY, city.x, city.z, 0, { flat: CITY_R, clear: CITY_R + 6, blend: 34, dirt: 1 });
  const SPECS = {
    [ZONE.BRIDGEHEAD]: { clear: 30, dirt: 0.35, blend: 22 }, // (its front faces east: inland)
    [ZONE.INDUSTRIAL]: { clear: 58, dirt: 0.8, road: ROAD.ASPHALT, name: 'Kessler Road' },
    [ZONE.SUBURB]: { clear: 40, dirt: 0.15, road: ROAD.DIRT, inner: true, street: true },
    [ZONE.TRUCKSTOP]: { clear: 34, dirt: 0.3 },
    [ZONE.TERMINAL]: { clear: 36 }, // (its front faces west: the road in)
    [ZONE.HANGARS]: { clear: 54 }, // (their doors face east: the apron)
    [ZONE.FUEL_DEPOT]: { clear: 32, dirt: 0.5 },
    [ZONE.FARM_A]: { clear: 0, dirt: 0.4 },
    [ZONE.FARM_B]: { clear: 0, dirt: 0.4 },
  };
  for (const sp of spots) {
    const o = OUTLYING[sp.id];
    put(sp.id, sp.x, sp.z, sp.ry, { flat: sp.flat, fixed: sp.fixed, farm: sp.farm, road: sp.road, ...(o ? { clear: o.clear, dirt: o.dirt, raise: o.raise, road: o.road, inner: o.inner, street: o.street } : SPECS[sp.id]) });
  }
  const zoneById = {};
  for (const z of zones) zoneById[z.id] = z;

  // ---------------------------------------------------------------- terrain
  // A coastal plain: low rolling ground that climbs to hills at the north, south and east edges and falls into the
  // sea at the west one. The bluff the bridge lands on stands out of the shore.
  const relief = (x, z) => fbm(nA, x * 0.003, z * 0.003, 4) * 17 + fbm(nB, x * 0.013, z * 0.013, 3) * 3.4 + (1 - Math.abs(nE(x * 0.006 + 5.1, z * 0.006 - 2.3))) ** 2 * 5 + 1;
  // (the shore wanders, but not where the bridge lands: the abutment stands on the line)
  const atBridge = (z) => 1 - smoothstep(34, 70, Math.abs(z - zb));
  // (...and it is no straight edge: a bay bites into it on one side of the bridge, a headland stands out on the other)
  const bayZ = zb - side * prng.range(210, 300);
  const capZ = zb + side * prng.range(330, 430);
  const bump = (z, at, w) => Math.exp(-(((z - at) / w) ** 2));
  const shoreX = (z) => COAST + (nE(z * 0.011, 3.7) * 22 + nE(z * 0.045, 9.1) * 6 + bump(z, bayZ, 70) * 58 - bump(z, capZ, 46) * 30) * (1 - atBridge(z));
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
    else if (zn.id === ZONE.MARINA) zn.h = WATER_LEVEL + 1.5;
    else zn.h = Math.max(FLOOR + 1, H0(zn.x, zn.z) * 0.55 + 0.8 + (zn.raise || 0));
  }
  // rectangles of level ground [x, z, half x, half z, height, blend]: the runway with its apron, the city
  const flats = [
    [field.x - 6, field.z, RUNWAY_HALF + 18, RUNWAY_LEN / 2 + 16, fieldH, 30],
    [apron.x, apron.z, apron.hx + 6, apron.hz + 6, fieldH, 24],
    [COAST + 26, zb, 22, 9, BLUFF, 9], // the bluff out to the abutment: the road off the bridge
    [city.x, city.z, G2 + 16, G2 + 16, cityH, 30], // the city, to its corners (they lie outside the circle of its zone)
  ];
  farms.forEach((f, k) => {
    f.h = zoneById[k ? ZONE.FARM_B : ZONE.FARM_A].h;
    flats.push([f.x, f.z, FARM_R, FARM_R, f.h, 18]);
    // (...and its field, west of the yard in the farm's own frame: ry is a quarter turn)
    const c = Math.cos(f.ry);
    const s = Math.sin(f.ry);
    flats.push([f.x - 48 * c, f.z + 48 * s, Math.abs(c) > 0.5 ? 16 : 22, Math.abs(c) > 0.5 ? 22 : 16, f.h, 16]);
  });
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
    // the lake and the ponds (as the island's are dug: a shore, then a bowl)
    if (lake) {
      const dLraw = Math.hypot(x - lake.x, z - lake.z);
      if (dLraw < lake.r + 60) {
        const dL = dLraw + nE(x * 0.03, z * 0.03) * 8;
        h = lerp(h, Math.min(h, WATER_LEVEL + 1.2), (1 - smoothstep(lake.r - 6, lake.r + 45, dL)) * 0.9);
        h = lerp(h, WATER_LEVEL - 5.5, 1 - smoothstep(lake.r * 0.25, lake.r - 2, dL));
      }
    }
    // (the marina's yard stays as it was levelled, up to where its pier starts: the lake's shore wanders, the yard's does not)
    const mz = zoneById[ZONE.MARINA];
    if (mz) {
      const d = Math.hypot(x - mz.x, z - mz.z);
      if (d < mz.flat + mz.blend) h = lerp(h, mz.h, (1 - smoothstep(mz.flat, mz.flat + mz.blend, d)) * (1 - smoothstep(9.5, 13.5, (x - mz.x) * Math.sin(mz.ry) + (z - mz.z) * Math.cos(mz.ry))));
    }
    for (let i = 0; i < ponds.length; i++) {
      const pd = ponds[i];
      const dr = Math.hypot(x - pd.x, z - pd.z);
      if (dr > pd.r + 30) continue;
      const dp = dr + nE(x * 0.05 + i * 7, z * 0.05) * pd.r * 0.22;
      h = lerp(h, Math.min(h, WATER_LEVEL + 1.0), (1 - smoothstep(pd.r - 3, pd.r + 22, dp)) * 0.85);
      h = lerp(h, WATER_LEVEL - pd.depth, 1 - smoothstep(pd.r * 0.2, pd.r - 1, dp));
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
  // level: a road of a place keeps to the place's ground (a street, the runway); otherwise its heights are the
  // ground's, smoothed along it
  // endH: the height of the road it ends on, which it comes down (or up) to over its last stretch
  const buildRoad = (ctrl, kind, width, name = '', level = null, endH = null) => {
    const pts = [];
    // (a Catmull-Rom curve through its points, with each leg's two tangents held to the leg's own length: a short
    // leg after a long one would otherwise be overshot, and the road double back on itself)
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)];
      const p1 = ctrl[i];
      const p2 = ctrl[i + 1];
      const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const held = (ax, az) => {
        const l = Math.hypot(ax, az);
        return l > len ? [(ax * len) / l, (az * len) / l] : [ax, az];
      };
      const m1 = held((p2[0] - p0[0]) / 2, (p2[1] - p0[1]) / 2);
      const m2 = held((p3[0] - p1[0]) / 2, (p3[1] - p1[1]) / 2);
      const steps = Math.max(2, Math.ceil(len / 2));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const [a, b2, c, d] = [2 * t * t * t - 3 * t * t + 1, t * t * t - 2 * t * t + t, -2 * t * t * t + 3 * t * t, t * t * t - t * t];
        pts.push(a * p1[0] + b2 * m1[0] + c * p2[0] + d * m2[0], a * p1[1] + b2 * m1[1] + c * p2[1] + d * m2[1]);
      }
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
    if (endH !== null) {
      let d = 0;
      for (let i = n - 1; i >= 0 && d < 30; i--) {
        hs[i] = lerp(endH, hs[i], smoothstep(0, 30, d));
        if (i) d += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
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
  // Route 9 carries on from the bridge: over the plain, through the army's checkpoint (dead straight there), down
  // Main Street, past the truck stop and out to the airfield
  const RB = clamp(hwL / 2 - 14, 8, 46);
  zoneById[ZONE.ROADBLOCK].queue = RB < 22 ? 0 : Math.min(4, Math.floor((RB - 22) / 7.5) + 1); // (the cars queued either side of it stand on the straight) // (how far either side of the checkpoint it is dead straight: less where the city is near the shore)
  const highway = buildRoad(
    [[head.x - 30, head.z], [head.x + 20, head.z], hwA, ...wander(hwA, [block9.x - hwD[0] * RB, block9.z - hwD[1] * RB], 1, 0.05).slice(1), [block9.x + hwD[0] * RB, block9.z + hwD[1] * RB], ...wander([block9.x + hwD[0] * RB, block9.z + hwD[1] * RB], hwB, 1, 0.05).slice(1), cityW, cityE, ...wander([cityE[0] + 40, city.z], [stop.x - 34, stop.z - 26], 1, 0.06), [stop.x + 34, stop.z - 26], ...wander([stop.x + 70, stop.z - 24], gate, 1, 0.05).slice(1), [terminal.x - 26, terminal.z]],
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
  // the airfield: the runway, the taxi lane along the apron, the road on to the depot
  const runwayRoad = buildRoad([[field.x, field.z - RUNWAY_LEN / 2], [field.x, field.z + RUNWAY_LEN / 2]], ROAD.ASPHALT, RUNWAY_HALF, 'Runway 36', fieldH);
  buildRoad([[terminal.x - 26, terminal.z], [terminal.x - 28, hangars.z - 30], [hangars.x - 34, hangars.z + 4]], ROAD.ASPHALT, 2.8, '', fieldH);
  buildRoad([[terminal.x - 26, terminal.z], [depot.x - 30, depot.z + 40], [depot.x - 24, depot.z]], ROAD.DIRT, 2.6);
  // a track from each farm down to the highway
  for (const f of farms) {
    if (!f.to) continue;
    const p = highway.pts;
    let best = 0;
    for (let i = 0; i < p.length / 2; i++) if (Math.hypot(p[i * 2] - f.to[0], p[i * 2 + 1] - f.to[1]) < Math.hypot(p[best * 2] - f.to[0], p[best * 2 + 1] - f.to[1])) best = i;
    buildRoad(wander([f.x - Math.sin(f.ry) * (FARM_R - 4), f.z - Math.cos(f.ry) * (FARM_R - 4)], [p[best * 2], p[best * 2 + 1]], 1, 0.05), ROAD.DIRT, 2.4, '', null, highway.hs[best]);
  }
  // The county roads: every other place is joined to the nearest road that is already there by a line that crosses
  // no place, no water and neither the city nor the airfield - the nearest place first, so the far ones hang off
  // the roads of the near ones - and turns its front to the road it got (unless something else fixes which way it
  // faces: the marina its lake, a farm its field).
  {
    const net = []; // [x, z, height]: points of the roads so far that another may leave from
    const onNet = (x, z) => !inCity(x, z, 5) && !onField(x, z, -6) && !zones.some((zn) => zn.id !== ZONE.CITY && Math.hypot(x - zn.x, z - zn.z) < zn.flat + 10);
    const feed = (road, skip = 0) => {
      const p = road.pts;
      const n = p.length / 2;
      for (let i = skip; i < n - skip; i += 6) if (onNet(p[i * 2], p[i * 2 + 1])) net.push([p[i * 2], p[i * 2 + 1], road.hs[i]]);
      if (!skip && onNet(p[n * 2 - 2], p[n * 2 - 1])) net.push([p[n * 2 - 2], p[n * 2 - 1], road.hs[n - 1]]); // (its far end: a street of the city runs out to there)
    };
    for (const road of roads) if (road !== runwayRoad) feed(road);
    const clear = (a, b, self) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 6; d < len - 4; d += 6) {
        const x = a[0] + ((b[0] - a[0]) * d) / len;
        const z = a[1] + ((b[1] - a[1]) * d) / len;
        if (inCity(x, z, 6) || onField(x, z, 4) || lakeDist(x, z) < 14 || pondDist(x, z) < 10) return false;
        for (const zn of zones) if (zn !== self && zn.id !== ZONE.CITY && Math.hypot(x - zn.x, z - zn.z) < zn.flat + 22) return false;
      }
      return true;
    };
    const todo = zones.filter((zn) => zn.road && !zn.farm);
    while (todo.length) {
      // the place nearest the roads so far
      let zi = 0;
      let zd = Infinity;
      todo.forEach((zn, i) => {
        for (const p of net) {
          const d = Math.hypot(p[0] - zn.x, p[1] - zn.z);
          if (d < zd) {
            zd = d;
            zi = i;
          }
        }
      });
      const zn = todo.splice(zi, 1)[0];
      // (which way it turns to face a point: a quarter turn at a time - its walls lie along the nav grid's cells,
      // and a doorway a metre wide is a cell wide whichever way the road came)
      const facing = (to) => (zn.fixed ? zn.ry : Math.round(Math.atan2(zn.x - to[0], zn.z - to[1]) / (PI / 2)) * (PI / 2));
      const gateOf = (to) => [zn.x - Math.sin(facing(to)) * zn.flat * 0.9, zn.z - Math.cos(facing(to)) * zn.flat * 0.9];
      const far = (p) => Math.hypot(p[0] - zn.x, p[1] - zn.z) > zn.flat + 24;
      const byDist = net.slice().sort((p, q) => Math.hypot(p[0] - zn.x, p[1] - zn.z) - Math.hypot(q[0] - zn.x, q[1] - zn.z));
      let to = byDist.slice(0, 160).find((p) => far(p) && clear(gateOf(p), p, zn));
      let via = null;
      let kind = zn.road;
      if (!to) {
        // (no straight line reaches it: round a corner, then - out of the gate to a point of open country, and on)
        search: for (let k = 0; k < Math.min(byDist.length, 240); k += 4) {
          const p = byDist[k];
          if (!far(p)) continue;
          for (const r of [70, 130, 210]) {
            for (let a = 0; a < 12; a++) {
              const v = [zn.x + Math.sin((a * PI) / 6) * (zn.flat + r), zn.z + Math.cos((a * PI) / 6) * (zn.flat + r)];
              if (Math.max(Math.abs(v[0]), Math.abs(v[1])) > HALF - 70 || v[0] < COAST + 60 || !clear(gateOf(v), v, zn) || !clear(v, p, null)) continue;
              to = p;
              via = v;
              break search;
            }
          }
        }
      }
      if (!to) {
        // (nothing reaches it cleanly: a footpath by the nearest way, whatever is in it)
        to = byDist.find(far) || byDist[0];
        kind = ROAD.TRAIL;
      }
      const g = gateOf(via || to);
      zn.ry = facing(via || to);
      const len = Math.hypot(to[0] - g[0], to[1] - g[1]);
      const ctrl = via ? [g, via, to] : wander(g, to, len > 240 ? 2 : len > 110 ? 1 : 0, 0.035);
      // (straight out of the gate for a few metres, whichever way it turns after: clear of what stands either side)
      ctrl.splice(1, 0, [g[0] - Math.sin(zn.ry) * 9, g[1] - Math.cos(zn.ry) * 9]);
      if (zn.inner) ctrl.unshift([zn.x, zn.z]);
      const w = kind === ROAD.TRAIL ? 1.5 : kind === ROAD.ASPHALT ? 3 : 2.6;
      feed(buildRoad(ctrl, kind, w, zn.name || '', null, to[2] ?? null), 8);
      // (a street of houses: the lane the doors are on, across the road in)
      if (zn.street) buildRoad([[-42, 0], [42, 0]].map(([lx, lz]) => [zn.x + Math.cos(zn.ry) * lx + Math.sin(zn.ry) * lz, zn.z - Math.sin(zn.ry) * lx + Math.cos(zn.ry) * lz]), kind, 2.6, '', zn.h);
    }
  }

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
  // a window with the glass gone (a way in, over the sill), and a city window: as often broken as not
  const hole = (at, w = 1.2, y0 = 1.05, y1 = 2.0) => ({ at, w, y0, y1 });
  const cw = (...a) => (rng.chance(0.55) ? hole(...a) : win(...a));
  // what has grown since: a clump of weeds or brush at a spot of a builder's frame (they go in with the bushes)
  const weeds = [];
  const weed = (b, lx, lz, scale = 1) => weeds.push([b.wx(lx, lz), b.wz(lx, lz), scale]);
  // what the field map names inside a place (the city's hospital, its station...): { x, z, name }
  const landmarks = [];
  // columns of smoke and fires still burning (world.lights: the client's effects draw them, and they are what the
  // skyline is known by from the bridge): so many to a map, the first that ask
  let towers = 0; // (how many big towers have a name so far)
  let smokes = 0;
  let fires = 0;
  const smoke = (b, lx, ly, lz) => smokes++ < SMOKES && b.light(lx, ly, lz, 'smoke');
  const fire = (b, lx, ly, lz) => fires++ < FIRES && b.light(lx, ly, lz, 'fire');
  const afloat = (p) => {
    props[props.length - 1].afloat = true; // (a boat on the water: nothing is under it, and nothing should be)
    return p;
  };
  const K = { rng, door, win, gap, hole, afloat }; // (what a place of mainland-places.js is built with)

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
        b.box(0, 0, 0, PAVED, PAVE, PAVED, 'concrete'); // the pavement, out to the kerb
        b.clear(0, 0, PITCH * 0.72);
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
  // The floors over a walk-in ground floor: shut, and solid - their stairs are under what came down (the rubble in
  // the stairwell: stairBlock). The top ones are broken: each stands on less of the footprint than the one under
  // it, the floor slab it lost hangs out of it, steel stands out of the edge. lost: how many are (default: drawn).
  // Returns the height of what still stands whole.
  const sheared = (b, cx, cz, w, d, y0, floors, fh, mat, lost = rng.int(0, Math.min(3, floors - 1))) => {
    const keep = floors - lost;
    b.box(cx, y0, cz, w, keep * fh, d, mat);
    bands(b, cx, cz, w, d, y0, keep, fh);
    const sx = rng.chance(0.5) ? 1 : -1;
    const sz = rng.chance(0.5) ? 1 : -1;
    let top = y0 + keep * fh;
    for (let k = 0; k < lost; k++) {
      const left = 1 - (k + 1) / (lost + 1.3); // the share of the floor still there
      const pw = w * (0.42 + 0.5 * left);
      const pd = d * (0.48 + 0.45 * left);
      const px = cx + (sx * (w - pw)) / 2;
      const pz = cz + (sz * (d - pd)) / 2;
      b.box(px, top, pz, pw, fh, pd, mat, { collide: false });
      b.box(px, top + 1, pz + sz * (pd / 2 + 0.03), pw - 1.6, 1.3, 0.06, 'dark', { collide: false });
      b.box(px + sx * (pw / 2 + 0.03), top + 1, pz, 0.06, 1.3, pd - 1.6, 'dark', { collide: false });
      b.box(cx - sx * w * 0.2, top + 0.2, cz - sz * d * 0.16, w * 0.46, 0.28, d * 0.5, 'concrete', { rz: sx * rng.range(0.14, 0.34), ry: rng.range(-0.2, 0.2), collide: false });
      for (let j = 0; j < 3; j++) b.box(cx - sx * rng.range(0.04, 0.46) * w, top, cz - sz * rng.range(0.04, 0.46) * d, 0.2, rng.range(1.4, fh + 1.6), 0.2, 'rust', { collide: false });
      top += fh;
    }
    if (lost) {
      b.box(cx + (sx * w) / 6, top, cz + (sz * d) / 6, w * 0.5, 0.5, d * 0.5, 'charred', { collide: false });
      // (the walls of the floors that went, still standing here and there along two sides of it)
      const yk = y0 + keep * fh;
      jagged(b, cx - sx * (w / 2 - 0.2), cz - d / 2, cx - sx * (w / 2 - 0.2), cz + d / 2, yk, fh * Math.min(2, lost), mat, false);
      jagged(b, cx - w / 2, cz - sz * (d / 2 - 0.2), cx + w / 2, cz - sz * (d / 2 - 0.2), yk, fh * Math.min(2, lost), mat, false);
    }
    else b.box(cx, top, cz, w + 0.4, 0.5, d + 0.4, 'concrete', { collide: false }); // parapet
    scars(b, cx, cz, w, d, y0, keep * fh);
    if (lost > 1 && rng.chance(0.5)) smoke(b, cx, top, cz);
    return y0 + keep * fh;
  };
  // soot up a wall from the windows a fire came out of, and what has grown up it since (ivy needs a wall 5 m high)
  const scars = (b, cx, cz, w, d, y0, h) => {
    for (let k = rng.int(2, 4); k > 0; k--) {
      const face = rng.int(0, 3);
      const sw = rng.range(2.4, 5);
      const sh = Math.min(h, rng.range(2.5, 6));
      // (not low on the front: the door and the shop's glass are there)
      const sy = y0 + (face === 0 ? Math.min(Math.max(0, h - sh), 4.2 + rng.range(0, 3)) : rng.range(0, Math.max(0, h - sh)));
      if (face === 0 && y0 + h < 6) continue;
      if (face < 2) wound(b, cx + rng.range(-0.4, 0.4) * (w - sw), cz + (face ? 1 : -1) * (d / 2), 0, face ? 1 : -1, sy, sw, sh);
      else wound(b, cx + (face === 2 ? 1 : -1) * (w / 2), cz + rng.range(-0.4, 0.4) * (d - sw), face === 2 ? 1 : -1, 0, sy, sw, sh);
    }
    const here = rng.chance(0.6);
    const face = rng.int(0, 2); // (never the front: the door is in it)
    const at = rng.range(-0.3, 0.3);
    const sd = rng.int(0, 2);
    if (!here || y0 + h < 5) return;
    if (face === 0) b.prop('ivy', cx + at * (w - 4), cz + d / 2 + 0.04, PI, { nocollide: true, seed: sd, ly: PAVE });
    else b.prop('ivy', cx + (face === 1 ? 1 : -1) * (w / 2 + 0.04), cz + at * (d - 4), face === 1 ? -PI / 2 : PI / 2, { nocollide: true, seed: sd, ly: PAVE });
  };
  const storeys = (b, F, y0, floors, fh, mat) => sheared(b, 0, F.cz, F.w, F.d, y0, floors, fh, mat);
  // What is left of a wall, from (x0, z0) to (x1, z1) along one axis of the builder's frame: lengths of it, each
  // broken off at its own height (up to H), the window holes of each floor dark in what still stands.
  const jagged = (b, x0, z0, x1, z1, y0, H, mat, collide = true) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 2.6));
    const seg = len / n;
    let h = H * rng.range(0.6, 1);
    for (let k = 0; k < n; k++) {
      h = clamp(h + rng.range(-0.4, 0.3) * H, H * 0.14, H);
      const t = (k + 0.5) / n;
      const [cx, cz] = [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
      b.box(cx, y0, cz, alongX ? seg + 0.02 : 0.4, h, alongX ? 0.4 : seg + 0.02, mat, { collide });
      for (let f = 0; f * 3 + 2.6 < h; f++) {
        for (const sd of [-1, 1]) {
          if (alongX) b.box(cx, y0 + f * 3 + 1.1, cz + sd * 0.22, seg - 1, 1.3, 0.04, 'dark', { collide: false });
          else b.box(cx + sd * 0.22, y0 + f * 3 + 1.1, cz, 0.04, 1.3, seg - 1, 'dark', { collide: false });
        }
      }
      if (rng.chance(0.3)) b.box(cx, y0 + h, cz, 0.14, rng.range(0.6, 1.8), 0.14, 'rust', { rz: rng.range(-0.4, 0.4), collide: false });
    }
  };
  // what fell out of a wall, at its foot: lumps and slabs on the pavement (nothing solid: it is walked over)
  const skirt = (b, x, z, ly = PAVE) => {
    b.prop('debris', x, z, rng.range(0, 6), { nocollide: true, ly, seed: rng.int(0, 2) });
    for (let k = rng.int(2, 3); k > 0; k--) b.box(x + rng.range(-1.6, 1.6), ly + rng.range(0, 0.25), z + rng.range(-1, 1), rng.range(1.1, 2.4), 0.2, rng.range(0.9, 1.7), 'concrete', { ry: rng.range(0, 3), rz: rng.range(-0.55, 0.55), rx: rng.range(-0.2, 0.2), collide: false });
  };
  // a hole blown or burnt in a face of a building: a ragged dark patch sw wide and sh high, its middle at (fx, fz)
  // on the face whose outward normal is (nx, nz), its foot at y; a slab of the floor hanging out of it, and under a
  // low one what came out
  const wound = (b, fx, fz, nx, nz, y, sw, sh) => {
    for (let k = 0; k < 6; k++) {
      const o = rng.range(-0.5, 0.5) * sw;
      const bw = rng.range(0.3, 0.62) * sw;
      const bh = rng.range(0.3, 0.6) * sh;
      const by = y + rng.range(0, sh - bh);
      const tilt = rng.range(-0.5, 0.5);
      const mat = k % 3 ? 'dark' : 'charred';
      if (nz) b.box(fx + o, by, fz + nz * (0.05 + k * 0.004), bw, bh, 0.05, mat, { rz: tilt, collide: false });
      else b.box(fx + nx * (0.05 + k * 0.004), by, fz + o, bw, bh, 0.05, mat, { ry: PI / 2, rz: tilt, collide: false });
    }
    const hang = rng.range(-0.3, 0.3) * sw;
    b.box(fx + (nz ? hang : nx * 0.7), y + rng.range(0, sh * 0.4), fz + (nz ? nz * 0.7 : hang), nz ? 2.2 : 1.5, 0.22, nz ? 1.5 : 2.2, 'concrete', { rx: nz ? nz * 0.6 : 0, rz: nz ? 0 : -nx * 0.6, collide: false });
    b.box(fx + (nz ? -hang : nx * 0.4), y + sh * 0.5, fz + (nz ? nz * 0.4 : -hang), 0.1, rng.range(1, 2), 0.1, 'rust', { rx: nz ? nz * 1.1 : 0, rz: nz ? 0 : -nx * 1.1, collide: false });
    if (y < 7.5) skirt(b, fx + nx * 1.5, fz + nz * 1.5);
  };
  // the stairs up, in a corner of a ground floor: gone under what fell down them
  const stairBlock = (b, x, z) => {
    b.box(x, FLOOR_Y, z, 2.2, 1.5, 1.4, 'concrete');
    b.box(x + 0.2, FLOOR_Y + 1.3, z - 0.1, 2.4, 0.25, 1.6, 'concrete', { rz: 0.3, collide: false });
    b.box(x - 0.5, FLOOR_Y + 1.5, z + 0.2, 0.12, 1.4, 0.12, 'rust', { rz: -0.3, collide: false });
    b.prop('debris', x, z - 1.5, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y });
  };
  // what came down off a lot into the street in front of it: a heap in the roadway (not where the tower's top lies:
  // that stretch has rubble of its own)
  let fallenAt = null; // [x, z] of the middle of the stretch of street the tower fell across
  const streetPile = (b, L, lx, ry) => {
    const [x, z] = [b.wx(lx, -L.d / 2 - 3.1), b.wz(lx, -L.d / 2 - 3.1)];
    if (fallenAt && Math.abs(x - fallenAt[0]) < 9 && Math.abs(z - fallenAt[1]) < 18) return;
    b.prop('rubble_pile', lx, -L.d / 2 - 3.1, ry, { ground: true });
  };
  // what lies along the front of a lot, on the pavement: rubbish, what fell off the building, weeds at the wall's foot
  const frontage = (b, L, F, shop = false) => {
    const z = -L.d / 2 + 0.55;
    const r = rng();
    const x = rng.range(-L.w / 2 + 2, L.w / 2 - 2);
    const ry = rng.range(0, 6);
    b.prop(r < 0.45 ? 'litter' : r < 0.75 ? 'debris' : r < 0.9 ? 'suitcases' : 'shopping_cart', x, z, ry, { nocollide: true, ly: PAVE, seed: (r * 97) | 0 });
    for (let k = rng.int(1, 3); k > 0; k--) weed(b, rng.range(-L.w / 2 + 0.6, L.w / 2 - 0.6), z + rng.range(-0.3, 0.4), rng.range(0.5, 0.9));
    const sign = rng.chance(0.35);
    const sx = rng.range(-3, 3);
    if (shop && sign) b.prop('fallen_sign', sx, z + 0.1, rng.range(-0.3, 0.3), { nocollide: true, ly: PAVE });
    if (shop && F) {
      // (a window boarded up, as often as not)
      const board = rng.chance(0.55);
      const side = rng.chance(0.5) ? 0.3 : -0.3;
      for (let k = 0; k < 3; k++) {
        const tilt = rng.range(-0.12, 0.12);
        if (board) b.box(F.w * side, 1.0 + k * 0.62, F.front - 0.17, Math.min(3.4, F.w * 0.24), 0.2, 0.04, 'planks', { rz: tilt, collide: false });
      }
    }
    if (shop && F && rng.chance(0.6)) b.prop('awning', F.w * (rng.chance(0.5) ? 0.2 : -0.2), F.front - 0.14, 0, { nocollide: true, ly: 2.75, seed: rng.int(0, 1) });
  };

  // what is behind a building: bins, a pallet, rubbish, and what has come up through the paving
  const yard = (b, F, L) => {
    if (rng.chance(0.6)) b.cont(CONT.DUMPSTER, F.L + 2.2, F.back + 1.6, { prop: 'dumpster', ry: PI, ly: PAVE });
    if (rng.chance(0.5)) b.prop('pallet', F.L + 5.2, F.back + 1.4, rng.range(0, 3), { ly: PAVE });
    const deep = L.d / 2 - F.back;
    if (deep > 4.5 && rng.chance(0.75)) b.tree(rng.range(-L.w / 2 + 2.5, L.w / 2 - 2.5), L.d / 2 - 2.2, [3, 4, 5, 5][rng.int(0, 3)], rng.range(0.6, 1.15));
    if (rng.chance(0.3)) b.prop('corpse', rng.range(-3, 3), F.back + 3.2, rng.range(0, 6), { nocollide: true, ly: PAVE });
    b.prop(rng.chance(0.5) ? 'litter' : 'debris', rng.range(0, L.w / 2 - 2), F.back + rng.range(1.5, Math.max(1.6, deep - 1.5)), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: rng.int(0, 2) });
    for (let k = rng.int(3, 6); k > 0; k--) weed(b, rng.range(-L.w / 2 + 0.5, L.w / 2 - 0.5), rng.range(F.back + 0.6, L.d / 2 - 0.4), rng.range(0.6, 1.3));
    for (const sx of [-1, 1]) weed(b, sx * (L.w / 2 - 0.5), rng.range(F.front, F.back), rng.range(0.6, 1.1)); // (down the alleys)
    frontage(b, L, F, true);
  };
  // A shop's room: a glass front with the door in the middle of it, a yard door at the back's right-hand end. x0:
  // where its middle is along the lot (a terrace has three). Returns its frame, in a builder of its own.
  const shopRoom = (b, L, w, d, mat, x0 = 0, alone = true) => {
    const s = b.sub(x0, 0);
    const F = frame(L, w, d);
    const ww = Math.min(3, w * 0.22);
    // (a shop on a lot of its own may have had a wall blown in: one more way through it)
    const breach = alone && rng.chance(0.4);
    s.room(0, F.cz, w, d, 3.8, mat, { n: [door(w / 2, 1.6), cw(w * 0.2, ww, 0.8, 2.8), cw(w * 0.8, ww, 0.8, 2.8)], s: [door(2.4, 1.1)], w: breach ? [gap(d * 0.72, 2.6, 2.9)] : [] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    // (the stock room behind: a door into it, and the wall down at its other end - the way to the yard door)
    s.wall(F.L, F.cz + 4.2, F.R, F.cz + 4.2, 3.8, 0.18, 'concrete', [door(w * 0.3, 1.3), gap(w - 2.6, 2.2, 2.7)]);
    if (breach) s.prop('debris', F.L + 1.2, F.cz + d * 0.22, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y });
    scars(s, 0, F.cz, w, d, 0, 3.8);
    s.prop('litter', rng.range(-2, 2), F.cz - 1.5, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    s.mess = () => mess(s, F, alone ? 9 : 6); // (after what the shop is furnished with: it lies round that)
    return [s, F];
  };
  // The mess a room was left in: rubbish, luggage, chairs kicked over, a pallet, bones, what came down through the
  // ceiling. None of it solid (it is walked over, and it blocks no door: kinds with no collider); none of it standing in furniture.
  const MESS = ['litter', 'debris', 'litter', 'suitcases', 'wheelchair', 'shopping_cart', 'bones', 'litter', 'body_bag', 'suitcases', 'debris', 'corpse'];
  const mess = (b, F, n) => {
    for (let k = 0; k < n; k++) {
      const type = MESS[rng.int(0, MESS.length - 1)];
      const x = rng.range(F.L + 1, F.R - 1);
      const z = rng.range(F.front + 1, F.back - 1);
      const ry = rng.range(0, 6);
      const sd = rng.int(0, 3);
      if (propBlocked('table', b.wx(x, z), b.wz(x, z), b.ry + ry)) continue;
      b.prop(type, x, z, ry, { nocollide: true, ly: FLOOR_Y, seed: sd });
    }
    for (let k = Math.max(1, Math.round(n / 4)); k > 0; k--) {
      const x = rng.range(F.L + 1.6, F.R - 1.6);
      const z = rng.range(F.front + 1.6, F.back - 1.6);
      b.box(x, FLOOR_Y + 0.04, z, rng.range(1.2, 2.4), 0.12, rng.range(0.9, 1.6), 'concrete', { ry: rng.range(0, 3), rz: rng.range(-0.16, 0.16), collide: false });
      b.box(x + rng.range(-1, 1), FLOOR_Y + 1.2, z + rng.range(-1, 1), 0.08, rng.range(1.2, 2.2), 0.08, 'rust', { rz: rng.range(-0.5, 0.5), rx: rng.range(-0.3, 0.3), collide: false }); // (a conduit hanging out of the ceiling)
    }
  };
  // rows of shelving down the middle of a shop's floor (bare: what they held is gone), clear of its counter and doors
  const aisles = (b, F) => {
    for (const dx of [3.6, 6.2]) {
      if (F.L + dx > F.R - 6.6) continue;
      for (const dz of [0.6, 2.6]) b.prop('shelf', F.L + dx, F.cz + dz, PI / 2, { ly: FLOOR_Y, seed: (dx + dz) | 0 });
    }
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
      aisles(b, F);
      b.prop('shopping_cart', F.R - 2.6, F.front + 2, 0.7, { nocollide: true, ly: FLOOR_Y });
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
      aisles(b, F);
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
      // (more tables down the front, where there is the width for them)
      for (const tx of F.w > 16 ? [-3.6, 3.6] : []) {
        b.prop('table', tx, F.front + 2.4, 0.05, inside);
        b.prop('chair', tx, F.front + 3.5, 0.3, { nocollide: true, ly: FLOOR_Y });
      }
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
      const [s, F] = shopRoom(b, L, 18.4, 13.5, mat);
      FILL[kind](s, F);
      s.mess();
      sheared(b, 0, F.cz, F.w, F.d, 4.1, rng.int(1, 4), 3, mat); // (flats over the shop: shut, as every upper floor is)
      yard(b, F, L);
    },
    // a row of three shops under one roof
    terrace(b, L) {
      const F = frame(L, 41.1, 13.5);
      const U = F.w / 3;
      const k0 = rng.int(0, SHOPS.length - 1);
      sheared(b, 0, F.cz, F.w, F.d, 4.1, rng.int(1, 3), 3, SHOPS[k0][1]);
      for (let k = 0; k < 3; k++) {
        const kind = SHOPS[(k0 + k * 2) % SHOPS.length][0];
        const mat = SHOPS[k0][1]; // (one row, one wall)
        const [s, Fu] = shopRoom(b, L, U, 13.5, mat, (k - 1) * U, false);
        FILL[kind](s, Fu);
        s.mess();
      }
      yard(b, F, L);
      b.wreck(rng.chance(0.5) ? 'car_wreck' : 'car_burnt', F.R - 6, F.back + 3.4, PI / 2 + rng.range(-0.2, 0.2), { ly: PAVE, trunk: rng.chance(0.5) });
    },
    // the police station: a front office, and behind a door the armoury
    police(b, L) {
      const F = frame(L, 18.4, 13.5);
      sheared(b, 0, F.cz, F.w, F.d, 3.9, rng.int(1, 2), 3, 'brick');
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
      b.prop('table', -5, F.cz - 3.6, 0.1, inside);
      b.prop('chair', -5, F.cz - 2.6, 3, { nocollide: true, ly: FLOOR_Y });
      mess(b, F, 9);
      yard(b, F, L);
    },
    // flats over a ground floor that can be walked into: a hall, two rooms, what the people who lived there left
    flats(b, L) {
      const F = frame(L, 18.4, 14);
      const mat = rng.chance(0.5) ? 'brick' : 'concrete';
      b.room(0, F.cz, F.w, F.d, 3.2, mat, { n: [door(F.w / 2, 1.4), cw(F.w * 0.2, 1.6), cw(F.w * 0.8, 1.6)], s: [door(2.2, 1.1), cw(F.w * 0.7, 1.4)], e: [cw(F.d / 2, 1.4)], w: [cw(F.d / 2, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks' });
      b.wall(1.4, F.front, 1.4, F.back, 3.2, 0.18, 'concrete', [door(F.d * 0.6, 1.2)]);
      stairBlock(b, 1.4 + 0.09 + 1.2, F.back - WALL - 0.75); // (against the hall's wall, clear of the yard door)
      storeys(b, F, 3.5, rng.int(3, 6), 3, mat);
      b.prop('bed', F.L + 1.1, F.back - 1.4, 0, inside);
      cont(b, CONT.CABINET, 'cabinet', F.L + 3.2, backZ(F, 0.55), PI);
      b.prop('table', F.R - 4, F.cz - 2.4, 0.1, inside);
      b.prop('chair', F.R - 4, F.cz - 1.5, PI, inside);
      b.loot(F.R - 4, F.cz - 2.4, FLOOR_Y + 0.82);
      cont(b, CONT.FRIDGE, 'fridge', rightX(F, 0.72), F.cz + 0.4, -PI / 2);
      b.loot(F.L + 3, F.cz - 2.5, FLOOR_Y + 0.02);
      if (rng.chance(0.4)) b.cont(CONT.DUFFEL, F.L + 4.6, F.cz + 1.4, { prop: 'duffel_bag', ry: 0.8, nocollide: true, ly: FLOOR_Y });
      b.prop('bed', F.L + 1.1, F.front + 2.6, 0, { ly: FLOOR_Y, seed: 1 });
      b.prop('table', F.L + 5.4, F.front + 1.4, 0, inside);
      b.prop('chair', F.L + 5.4, F.front + 2.4, 2.8, { nocollide: true, ly: FLOOR_Y });
      mess(b, F, 11);
      yard(b, F, L);
    },
    // a long block of flats: two halls, four rooms on the ground floor
    block(b, L) {
      const F = frame(L, 41, 14);
      const mat = rng.chance(0.5) ? 'brick' : 'concrete';
      b.room(0, F.cz, F.w, F.d, 3.2, mat, { n: [door(F.w * 0.25, 1.4), door(F.w * 0.75, 1.4), cw(4, 1.6), cw(15, 1.6), cw(23, 1.6), cw(34, 1.6)], s: [door(2.2, 1.1), door(F.w - 2.2, 1.1), cw(12, 1.4), cw(26, 1.4)], e: [cw(F.d / 2, 1.4)], w: [cw(F.d / 2, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks' });
      for (const [wx, at] of [[-12.5, 0.65], [0, 0.3], [12.5, 0.65]]) b.wall(wx, F.front, wx, F.back, 3.2, 0.18, 'concrete', [door(F.d * at, 1.2)]);
      storeys(b, F, 3.5, rng.int(3, 6), 3, mat);
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
      mess(b, F, 20);
      yard(b, F, L);
    },
    // an office tower. big: on a lot of its own, the tallest thing for a mile; otherwise a small one on a street lot
    tower(b, L, big) {
      const F = big ? frame(L, 34, 30) : frame(L, 18.4, 15);
      const h = big ? 4.4 : 3.8;
      const fh = big ? 3.3 : 3.2;
      const floors = big ? rng.int(8, 12) : rng.int(5, 7);
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
      // the shaft: its top floors gone, or going
      mess(b, F, big ? 22 : 9);
      sheared(b, 0, F.cz, F.w - 1, F.d - 1, h + 0.3, floors, fh, 'concrete', rng.int(1, 3));
      stairBlock(b, -F.w / 6 + core / 2 + 1.4, F.cz + F.d / 6);
      if (big) landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: ['Calder Trust Tower', 'Harbour House', 'Meridian Assurance', 'Dockside Exchange', 'Pacific & Northern', 'Customs House'][towers++ % 6] });
      if (!big) return yard(b, F, L);
      // the plaza behind it: planters gone to dead wood, a shelter, the cars of people who never came down
      for (const tx of [-14, -5, 5, 14]) b.tree(tx, L.d / 2 - 3.4, rng.chance(0.5) ? 3 : 4, rng.range(0.9, 1.2));
      b.prop('bus_shelter', -15.5, F.back + 5, PI / 2, { ly: PAVE });
      b.wreck('car_wreck', 8, F.back + 5.5, PI / 2 + 0.2, { ly: PAVE });
      b.wreck('car_burnt', F.R + 2.2, F.cz + 3, 0.1, { ly: PAVE, trunk: false });
      b.cont(CONT.DUMPSTER, F.L - 1.8, F.cz - 4, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      b.loot(0, F.back + 4, PAVE + 0.02);
    },
    // a block that came down: a corner of its ground floor still stands, the rest is heaps, one of them out in the street
    ruin(b, L) {
      const w = Math.min(L.w - 3, 16);
      const d = 13;
      const cz = -L.d / 2 + SETBACK + d / 2;
      b.prop('debris', -3.5, cz - 1, 2, { nocollide: true, ly: PAVE });
      b.prop('debris', 5, cz + 5.5, 0.5, { nocollide: true, ly: PAVE, seed: 1 });
      b.tree(-4.6, cz + 3.4, 5, rng.range(0.5, 0.8));
      for (let k = 0; k < 6; k++) weed(b, rng.range(-9, 9), rng.range(-8, 9), rng.range(0.7, 1.4));
      frontage(b, L, null);
      // (its shell: the back wall and one side of it stand, storeys high and broken off; stumps of the rest)
      const mat = rng.chance(0.5) ? 'brick' : 'concrete';
      const H = rng.range(7, 13);
      jagged(b, -w / 2, cz - d / 2, -w / 2, cz + d / 2, PAVE, H, mat);
      jagged(b, -w / 2, cz + d / 2, w / 2, cz + d / 2, PAVE, H, mat);
      jagged(b, w / 2, cz + d / 2 - 5, w / 2, cz + d / 2, PAVE, H * 0.6, mat);
      b.box(w / 2 - 1.5, PAVE, cz - d / 2, 3, 1.3, 0.4, mat);
      // (its floors, where they landed)
      for (let k = 0; k < 3; k++) b.box(rng.range(-3, 2), PAVE + 0.5 + k * 0.9, cz + rng.range(-1, 2.5), w * rng.range(0.5, 0.75), 0.3, d * rng.range(0.4, 0.6), 'concrete', { rz: rng.range(0.12, 0.42) * (k % 2 ? -1 : 1), rx: rng.range(-0.2, 0.2), ry: rng.range(-0.3, 0.3), collide: false });
      skirt(b, -w / 2 - 1.4, cz + 1);
      skirt(b, 2, cz + d / 2 + 1.5);
      b.prop('rubble_slope', 1.6, cz + 0.8, rng.range(0, 6), { ly: PAVE });
      streetPile(b, L, rng.range(-3, 3), rng.range(0, 6));
      b.box(-2.4, 1.3, cz - 2.6, w * 0.4, 0.3, 4, 'concrete', { rz: 0.3, collide: false });
      b.box(4.4, 0.9, cz + 4.4, 4.4, 0.2, 0.2, 'rust', { rz: -0.34, ry: -0.7, collide: false });
      b.cont(CONT.DUFFEL, -w / 2 + 1.6, cz - d / 2 + 1.6, { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
      b.loot(w / 2 - 1.2, cz + d / 2 - 1.2, PAVE + 0.02);
      b.prop('corpse', -w / 2 + 2.6, cz + d / 2 - 2, 1.1, { nocollide: true, ly: PAVE });
      b.tree(L.w / 2 - 2.4, L.d / 2 - 2.4, 4, 1);
    },
    // burnt out: the walls, black, with the sky over them
    burnt(b, L) {
      const F = frame(L, 18, 13);
      if (rng.chance(0.4)) fire(b, 1, 1.2, F.cz);
      else if (rng.chance(0.5)) smoke(b, 0, 3, F.cz);
      b.prop('debris', -3, F.cz - 2, 1, { nocollide: true, ly: FLOOR_Y });
      for (let k = 0; k < 5; k++) weed(b, rng.range(-9, 9), rng.range(F.back + 0.6, L.d / 2 - 0.5), rng.range(0.7, 1.3));
      frontage(b, L, F);
      b.room(0, F.cz, F.w, F.d, 3.4, 'charred', { n: [gap(F.w / 2, 2.2, 2.6), gap(F.w * 0.2, 2.4, 2.4)], s: [gap(F.w * 0.7, 3, 3)], e: [gap(F.d / 2, 1.6, 2.2)] }, { floorMat: 'ash' });
      jagged(b, F.L, F.back, F.R, F.back, 3.4, 4.5, 'charred', false);
      jagged(b, F.L, F.front, F.L, F.back, 3.4, 4.5, 'charred', false);
      jagged(b, F.L, F.front, F.R, F.front, 3.4, 2.6, 'charred', false);
      skirt(b, F.R + 1.4, F.cz);
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
      const floors = rng.int(5, 8);
      sheared(b, -13, -12, 11, 10, PAVE, floors, 3, 'concrete', rng.int(2, 3));
      // its floors, pancaked: slabs one on another where the rest of it stood, a heap to be climbed at either end
      for (let k = 0; k < 4; k++) b.box(4 + k * 0.5, PAVE + k * 0.42, -11 + k * 0.4, 20 - k * 2.2, 0.4, 12 - k * 1.6, 'concrete', { ry: 0.04 * (k - 1.5) });
      b.box(6, PAVE + 1.7, -10, 14, 0.4, 9, 'concrete', { rz: 0.16, ry: 0.1, collide: false });
      for (const [rx, rz] of [[1, -13], [9, -8], [13, -12]]) b.box(rx, PAVE + 1.6, rz, 0.16, rng.range(1.2, 2.6), 0.16, 'rust', { rz: rng.range(-0.4, 0.4), collide: false });
      b.prop('rubble_slope', 5, 2, rng.range(0, 6), { ly: PAVE });
      b.prop('rubble_slope', -13, 11.5, rng.range(0, 6), { ly: PAVE, seed: 1 });
      // (what is left of its walls: lengths of the back and one side, storeys high and broken off)
      jagged(b, -20.4, 20.4, -6, 20.4, PAVE, 11, 'concrete');
      jagged(b, 11, 20.4, 20.4, 20.4, PAVE, 8, 'concrete');
      jagged(b, 20.4, 5.5, 20.4, 20.4, PAVE, 12, 'concrete');
      jagged(b, -20.4, 0, -20.4, 6, PAVE, 6, 'concrete');
      // (floors of it lying where they came down, one on another, tipped every way)
      for (let k = 0; k < 9; k++) b.box(rng.range(-16, 16), PAVE + rng.range(0.3, 1.6), rng.range(-2, 17), rng.range(5, 9), 0.32, rng.range(4, 7), 'concrete', { rz: rng.range(-0.34, 0.34), rx: rng.range(-0.22, 0.22), ry: rng.range(0, 3), collide: false });
      for (let k = 0; k < 7; k++) skirt(b, rng.range(-18, 18), rng.range(-3, 18));
      for (const [px, pz] of [[-8, 5], [15, 10], [-3, 15]]) b.prop('rubble_pile', px + rng.range(-1, 1), pz + rng.range(-1, 1), rng.range(0, 6), { ly: PAVE });
      for (const [px, pz] of [[12, 0], [-14, 8], [4, 12], [17, -4], [-4, -3]]) b.prop('debris', px, pz, rng.range(0, 6), { nocollide: true, ly: PAVE, seed: px & 3 });
      smoke(b, 4, 3, -8);
      for (let k = 0; k < 8; k++) weed(b, rng.range(-19, 19), rng.range(-4, 19), rng.range(0.7, 1.4));
      for (const [tx, tz] of [[10, 5], [-10, 12]]) b.tree(tx, tz, 5, rng.range(0.5, 0.8));
      streetPile(b, L, rng.range(-6, 6), rng.range(0, 6));
      b.box(3, 1.4, 1, 9, 0.35, 6, 'concrete', { rz: 0.24, ry: 0.4, collide: false });
      b.box(-6, 1.0, 12, 7, 0.3, 5, 'concrete', { rx: -0.2, ry: -0.3, collide: false });
      b.box(15, PAVE, 0, 0.4, 3, 9, 'brick');
      b.box(4, PAVE, 18.6, 12, 2.2, 0.4, 'brick');
      b.cont(CONT.DUFFEL, 16.4, 3, { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
      b.cont(CONT.CRATE, 6, 16.6, { prop: 'crate', ry: 0.2, ly: PAVE });
      b.cont(CONT.AMMO_BOX, -17, 2, { prop: 'military_crate', ry: 0.4, ly: PAVE });
      b.prop('corpse', 3, -4, 2, { nocollide: true, ly: PAVE });
      b.prop('bones', -3, 8, 0.4, { nocollide: true, ly: PAVE });
      b.loot(12.5, 5.5, PAVE + 0.02);
      b.loot(-13.5, 5, PAVE + 0.02);
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
    // CALDER GENERAL: an emergency room that can be walked into - the wards behind it, the pharmacy between them -
    // under four floors that cannot. Ambulances under the canopy, a triage tent in the yard, the dead in rows.
    hospital(b, L) {
      const F = { w: 30, d: 16, cz: -4, front: -12, back: 4, L: -15, R: 15 };
      b.room(0, F.cz, F.w, F.d, 4, 'concrete', { n: [gap(15, 4, 3), cw(5, 3, 0.8, 3), cw(25, 3, 0.8, 3)], s: [door(4, 1.2), door(26, 1.2)], e: [cw(4, 1.6), cw(12, 1.6)], w: [door(4, 1.3), cw(12, 1.6)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      b.wall(F.L, F.cz + 2, F.R, F.cz + 2, 4, 0.2, 'concrete', [door(5, 1.3), door(15, 1.6), door(25, 1.3)]);
      for (const wx of [-5, 5]) b.wall(wx, F.cz + 2, wx, F.back, 4, 0.18, 'concrete');
      b.box(5, FLOOR_Y, F.cz - 3, 5, 1.05, 0.8, 'planks'); // reception
      b.loot(5, F.cz - 3, FLOOR_Y + 1.07);
      b.prop('bed', -11, F.cz - 0.6, PI / 2, inside);
      b.prop('bed', -11, F.cz - 3.6, PI / 2, { ly: FLOOR_Y, seed: 1 });
      b.prop('wheelchair', -6, F.cz - 5, 0.8, { nocollide: true, ly: FLOOR_Y });
      b.prop('wheelchair', 11, F.cz - 1, 2.6, { nocollide: true, ly: FLOOR_Y });
      b.prop('barricade', 5.2, F.cz + 1.1, 0.05, inside); // (between the doors of the wards and the pharmacy)
      b.prop('litter', 0, F.cz - 4, 1, { nocollide: true, ly: FLOOR_Y });
      stairBlock(b, F.R - 1.5, F.front + 1.1);
      // the wards
      for (const sx of [-1, 1]) {
        b.prop('bed', sx * 12.5, F.back - 1.4, 0, { ly: FLOOR_Y, seed: 2 });
        b.prop('bed', sx * 8, F.back - 1.4, 0, { ly: FLOOR_Y, seed: 3 });
        b.prop('body_bag', sx * 10.2, F.cz + 3.2, PI / 2, { nocollide: true, ly: FLOOR_Y });
        b.loot(sx * 6.4, F.cz + 3.4, FLOOR_Y + 0.02);
      }
      cont(b, CONT.MEDICINE, 'medicine_cabinet', leftX(F, 0.45), F.cz + 4.6, PI / 2);
      cont(b, CONT.LOCKER, 'locker', rightX(F, 0.5), F.cz + 4.6, -PI / 2);
      // the pharmacy
      for (const dx of [-3.6, -2.4]) cont(b, CONT.MEDICINE, 'medicine_cabinet', dx, backZ(F, 0.45), PI, { seed: dx | 0 });
      cont(b, CONT.DRUG_LOCKER, 'drug_locker', 3.4, backZ(F, 0.6), PI);
      cont(b, CONT.CABINET, 'cabinet', 0.6, backZ(F, 0.55), PI);
      b.loot(-1, F.cz + 3.6, FLOOR_Y + 0.02);
      mess(b, F, 24);
      sheared(b, 0, F.cz, F.w, F.d, 4.3, 4, 3.2, 'concrete', rng.int(1, 2));
      // the forecourt
      for (const px of [-3.4, 3.4]) for (const pz of [-13.4, -17.6]) b.cyl(px, PAVE, pz, 0.16, 3.4, 'metal', { sides: 8 });
      b.box(0, 3.5, -15.5, 8.4, 0.3, 5.6, 'concrete', { collide: false });
      b.roofSpan(0, -15.5, 4.2, 2.8, 3.5, 0.3);
      b.wreck('ambulance', -9.4, -16.4, PI / 2, { ly: PAVE, trunk: false });
      b.wreck('ambulance', 10, -16.2, PI / 2 + 0.25, { ly: PAVE, trunk: false, seed: 1 });
      for (let i = 0; i < 5; i++) b.prop('body_bag', -19 + i * 1.25, -13.4, 0.08 * i, { nocollide: true, ly: PAVE, seed: i });
      b.prop('suitcases', 5.4, -18.6, 0.4, { nocollide: true, ly: PAVE });
      // the yard: a triage tent, the generator, what was thrown out
      b.prop('military_tent', -11, 12, PI / 2, { ly: PAVE });
      b.cont(CONT.DUFFEL, -6.6, 11.4, { prop: 'duffel_bag', ry: 0.4, nocollide: true, ly: PAVE });
      b.prop('generator', 9, 8, 0.2, { ly: PAVE });
      b.cont(CONT.DUMPSTER, 17.5, 9, { prop: 'dumpster', ry: -PI / 2, ly: PAVE });
      b.cont(CONT.CRATE, 2, 15.5, { prop: 'crate', ry: 0.3, ly: PAVE });
      b.prop('barrel', 14, 15, 0, { ly: PAVE });
      b.light(14, PAVE + 1.0, 15, 'embers');
      for (const [tx, tz] of [[-18, 18], [0, 19], [18, 17.5]]) b.tree(tx, tz, [3, 5, 4][(tx + 18) / 18], rng.range(0.7, 1.1));
      for (let k = 0; k < 9; k++) weed(b, rng.range(-20, 20), rng.range(5, 20), rng.range(0.7, 1.4));
      b.loot(6, 12, PAVE + 0.02);
      landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: 'Calder General' });
    },
    // ST. BRENDAN'S: a stone church on a corner lot, its yard gone to weed
    church(b, L) {
      const F = frame(L, 9, 14);
      const tall = (at) => ({ at, w: 1.1, y0: 1.3, y1: 3.8, glass: rng.chance(0.5) });
      b.room(0, F.cz, F.w, F.d, 5.2, 'stone', { n: [door(4.5, 1.6)], e: [tall(3.5), tall(9.5)], w: [tall(3.5), tall(9.5)], s: [door(7.2, 1.1)] }, { roof: 'gable', roofH: 3.6, roofMat: 'shingles', floorMat: 'planks' });
      b.box(0, 5.2, F.front + 1.4, 2.8, 4.2, 2.8, 'stone', { collide: false });
      b.cone(0, 9.4, F.front + 1.4, 2, 5.2, 'shingles', 4);
      b.box(0, 14.6, F.front + 1.4, 0.12, 1.4, 0.12, 'trim', { collide: false });
      b.box(0, 15.3, F.front + 1.4, 0.8, 0.12, 0.12, 'trim', { collide: false });
      for (let r = 0; r < 3; r++) {
        b.prop('pew', -2.2, F.cz - 3.2 + r * 2.2, r === 1 ? 0.2 : 0, inside);
        b.prop('pew', 2.2, F.cz - 3.2 + r * 2.2, 0, inside);
      }
      b.prop('altar', -0.4, F.back - 1.6, 0, inside);
      b.loot(-0.4, F.back - 1.6, FLOOR_Y + 1.02);
      cont(b, CONT.CABINET, 'cabinet', F.L + 4.2, backZ(F, 0.55), PI); // (clear of the vestry door)
      b.cont(CONT.DUFFEL, 3.2, F.cz - 5, { prop: 'duffel_bag', ry: 1.1, nocollide: true, ly: FLOOR_Y });
      for (const [gx, gz, sd] of [[7, -5, 0], [8.4, -1.6, 1], [6.8, 2, 2], [-7.4, -3, 1], [-8.2, 1.4, 0]]) b.prop('grave_cross', gx, gz, rng.range(-0.3, 0.3), { ly: PAVE, seed: sd });
      b.tree(-7, 7, 3, 1.1);
      b.tree(7.6, 7.4, 4, 0.9);
      b.prop('ivy', F.R + 0.04, F.cz + 2.6, -PI / 2, { nocollide: true, ly: PAVE });
      for (let k = 0; k < 7; k++) weed(b, rng.range(-9, 9) < 0 ? rng.range(-9.2, -5.4) : rng.range(5.4, 9.2), rng.range(-8, 9), rng.range(0.7, 1.3));
      frontage(b, L, F);
      landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: "St. Brendan's" });
    },
    // a filling station: pumps under a canopy on the street, the kiosk behind them
    gas(b, L) {
      b.room(0, 5.5, 10, 6, 3.2, 'brick', { n: [door(5, 1.4), cw(2, 2.4, 0.9, 2.4), cw(8, 2.4, 0.9, 2.4)], e: [door(3, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      b.box(-2.6, FLOOR_Y, 4.6, 3.4, 1.0, 0.7, 'planks');
      b.loot(-2.6, 4.6, FLOOR_Y + 1.02);
      b.cont(CONT.SHELF, -2.8, 8.065, { prop: 'shelf', ry: PI, ly: FLOOR_Y });
      b.cont(CONT.SHELF, 0.2, 8.065, { prop: 'shelf', ry: PI, ly: FLOOR_Y, seed: 1 });
      b.cont(CONT.FRIDGE, 3, 7.955, { prop: 'fridge', ry: PI, ly: FLOOR_Y });
      for (const px of [-4.2, 4.2]) for (const pz of [-2.4, -6.6]) b.cyl(px, PAVE, pz, 0.18, 4.4, 'metal', { sides: 8 });
      b.box(0, 4.5, -4.5, 10.6, 0.5, 6.6, 'metal', { collide: false });
      b.roofSpan(0, -4.5, 5.3, 3.3, 4.5, 0.5);
      b.prop('gas_pump', -1.7, -4.5, 0, { ly: PAVE });
      b.prop('gas_pump', 1.7, -4.5, 0, { ly: PAVE, seed: 1 });
      b.wreck('car_burnt', 7.2, -4.2, 0.1, { ly: PAVE, trunk: false });
      b.wreck('car_wreck', -7.2, -3.6, PI - 0.15, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -7.4, 6.6, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      b.prop('tire_pile', 8, 5, 0, { ly: PAVE });
      b.prop('litter', 0, -1, 1, { nocollide: true, ly: PAVE });
      for (let k = 0; k < 4; k++) weed(b, rng.range(-9, 9), rng.range(8.9, 9.4), rng.range(0.7, 1.2));
      frontage(b, L, null, true);
    },
    // THE RIALTO: a picture house - the lobby on the street, the hall behind it, the screen still up
    cinema(b, L) {
      const F = frame(L, 30, 15);
      b.room(0, F.cz, F.w, F.d, 7, 'brick', { n: [gap(15, 5, 3)], s: [door(3, 1.2), door(27, 1.2)], w: [door(11, 1.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks' });
      b.wall(F.L, F.front + 4.6, F.R, F.front + 4.6, 7, 0.2, 'brick', [door(8, 1.6), door(22, 1.6)]);
      b.box(0, 3.4, F.front - 0.95, 14, 1.5, 1.6, 'paint', { collide: false }); // the marquee
      b.box(0, 4.9, F.front - 0.2, 5, 3.4, 0.3, 'paint', { collide: false });
      b.box(-9, FLOOR_Y, F.front + 2.6, 5, 1.05, 0.8, 'planks');
      b.loot(-9, F.front + 2.6, FLOOR_Y + 1.07);
      cont(b, CONT.FRIDGE, 'fridge', rightX(F, 0.72), F.front + 2.2, -PI / 2);
      cont(b, CONT.CABINET, 'cabinet', leftX(F, 0.55), F.front + 2, PI / 2);
      b.prop('litter', 3, F.front + 2.4, 1, { nocollide: true, ly: FLOOR_Y });
      for (let r = 0; r < 3; r++) for (const px of [-10.2, -7, -3.8, 3.8, 7, 10.2]) if ((r * 7 + px) % 5) b.prop('pew', px, F.front + 7 + r * 2.1, rng.range(-0.06, 0.06), { ly: FLOOR_Y, seed: r });
      b.box(0, 1.6, F.back - 0.5, 20, 4.6, 0.12, 'clapboard', { collide: false }); // the screen
      b.cont(CONT.DUFFEL, 0, F.front + 8.2, { prop: 'duffel_bag', ry: 0.6, nocollide: true, ly: FLOOR_Y });
      b.cont(CONT.DUFFEL, -12.6, F.back - 1.6, { prop: 'duffel_bag', ry: 2, nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.prop('corpse', 0.4, F.front + 11.4, 1, { nocollide: true, ly: FLOOR_Y });
      b.loot(12.6, F.back - 1.6, FLOOR_Y + 0.02);
      b.loot(0, F.back - 2, FLOOR_Y + 0.02);
      mess(b, F, 14);
      scars(b, 0, F.cz, F.w, F.d, 0, 7);
      b.prop('fallen_sign', 4, F.front - 0.9, 0.2, { nocollide: true, ly: PAVE });
      b.wreck('car_wreck', 18.4, F.cz + 1, 0.05, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -18.2, F.cz + 3, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      yard(b, F, L);
      landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: landmarks.some((m) => m.name === 'The Rialto') ? 'The Orpheum' : 'The Rialto' });
    },
    // HARBOUR STREET STATION: the way down to the trains, shut and fallen in, on a square of its own
    subway(b, L) {
      b.prop('subway_entrance', 0, -3, 0, { ly: PAVE });
      b.prop('bus_shelter', -6.2, -L.d / 2 + 1.4, 0, { ly: PAVE });
      b.room(5.8, 5.4, 5, 4, 2.8, 'tin', { w: [door(2, 1.1)], n: [cw(2.5, 2, 1, 2)] }, { roof: 'flat', roofMat: 'tin' });
      b.cont(CONT.CABINET, 7.4, 6.4, { prop: 'cabinet', ry: -PI / 2, ly: FLOOR_Y });
      b.loot(5.4, 4.6, FLOOR_Y + 0.02);
      b.prop('pew', -6.4, 4, PI / 2, { ly: PAVE });
      b.prop('pew', 0.4, 7.8, 0, { ly: PAVE, seed: 1 });
      for (const [tx, tz] of [[-7.4, 8], [-3.4, 3.4], [7.6, -4.6]]) b.tree(tx, tz, rng.chance(0.5) ? 3 : 5, rng.range(0.7, 1.1));
      b.prop('suitcases', 3.4, -6.4, 0.8, { nocollide: true, ly: PAVE });
      b.prop('litter', -3, -6.5, 2, { nocollide: true, ly: PAVE });
      b.prop('litter', 2, 2, 0.3, { nocollide: true, ly: PAVE, seed: 1 });
      b.cont(CONT.DUFFEL, -3.2, 0.6, { prop: 'duffel_bag', ry: 0.3, nocollide: true, ly: PAVE });
      b.prop('streetlight', 8.6, -8.6, PI, { ly: PAVE });
      b.prop('corpse', 4.4, 0, 2, { nocollide: true, ly: PAVE });
      for (let k = 0; k < 6; k++) weed(b, rng.range(-9, 9), rng.range(-9, 9), rng.range(0.6, 1.2));
      landmarks.push({ x: b.wx(0, -3), z: b.wz(0, -3), name: 'Harbour Street Station' });
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
      for (let k = 0; k < 6; k++) weed(b, rng.range(-L.w / 2 + 1, L.w / 2 - 1), rng.range(-L.d / 2 + 1, L.d / 2 - 1) * 0 + (k % 2 ? 1 : -1) * (L.d / 2 - 0.6), rng.range(0.6, 1.2));
      b.prop('litter', -L.w / 4, 1.4, 1, { nocollide: true, ly: PAVE });
      b.prop('shopping_cart', L.w / 4, 1.6, 2, { nocollide: true, ly: PAVE });
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
    deal(big, ['tower', 'tower', 'hospital', 'collapse', 'tower', 'depot']);
    deal(small, ['aero', 'aero', 'office', 'office', 'office', 'police', 'pharmacy', 'hardware', 'church', 'gas', 'subway']);
    deal(long, ['terrace', 'block', 'carpark', 'cinema', 'terrace', 'block']);
    // (the tower whose top came down: the first dealt. It lies across the street east of its block.)
    const fallenLot = lots[Math.min(...[...plan].filter(([, what]) => what === 'tower').map(([i]) => i))] || null;
    if (fallenLot) {
      fallenLot.fell = true;
      fallenAt = [city.x - G2 + (fallenLot.bi + 1) * PITCH, city.z - G2 + (fallenLot.bj + 0.5) * PITCH];
    }
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
      if (what === 'aero') landmarks.push({ x: L.x, z: L.z, name: 'Calder Aero Supply' });
      if (what === 'police') landmarks.push({ x: L.x, z: L.z, name: 'Port Calder Police' });
      if (what === 'aero') BUILD.shop(b, L, 'aero', 'tin');
      else if (FILL[what]) BUILD.shop(b, L, what, SHOPS.find((s) => s[0] === what)[1]);
      else if (what === 'office') BUILD.tower(b, L, false);
      else if (what === 'tower') BUILD.tower(b, L, true);
      else BUILD[what](b, L);
    });
  }
  // The streets. Wrecks where they stopped, burnt out as often as not; lamps along the kerbs; rubbish, luggage and
  // what fell off the buildings; slabs of the roadway heaved up; weeds along every kerb and saplings in the cracks.
  // A few stretches are worse: a roadblock somebody held (barriers a car cannot pass and a survivor can), a jam
  // that never moved, a hole the street fell into, and the top of a tower lying across the road from kerb to
  // kerb - climbed over by its rubble, or gone round. Whatever would stand in something already there is left out,
  // after its draws.
  {
    const b = new Builder(city.x, city.z, 0, cityH);
    b.zone = ZONE.CITY;
    b.ground = true; // (the roadway lies a little under the city's level: what is on it stands on the ground)
    const free = (type, lx, lz, ry) => !propBlocked(type, b.wx(lx, lz), b.wz(lx, lz), ry);
    const litter = (type, lx, lz, o = {}) => b.prop(type, lx, lz, rng.range(0, 6), { nocollide: true, seed: rng.int(0, 2), ...o });
    // which stretch is which: i, the street; k, the block along it; ns, which way it runs
    const key = (i, k, ns) => `${i}:${k}:${ns ? 1 : 0}`;
    const kinds = new Map();
    // (where a hole would be dug in a stretch: nothing that came down off a lot lies on its lip)
    const holeAt = (i, k, ns) => (ns ? [city.x - G2 + i * PITCH, city.z - G2 + (k + 0.5) * PITCH + 6] : [city.x - G2 + (k + 0.5) * PITCH + 6, city.z - G2 + i * PITCH]);
    const heaped = (i, k, ns) => props.some((q) => q.type === 'rubble_pile' && Math.hypot(q.x - holeAt(i, k, ns)[0], q.z - holeAt(i, k, ns)[1]) < 12);
    const mark = (kind, n) => {
      for (let tries = 0; n > 0 && tries < 60; tries++) {
        const ns = rng.chance(0.5);
        const i = rng.int(0, GRID);
        const k = rng.int(0, GRID - 1);
        if (kinds.has(key(i, k, ns)) || (kind === 'hole' && ((!ns && i === GRID / 2) || heaped(i, k, ns)))) continue; // (no hole in Main Street: Route 9 is the way through)
        kinds.set(key(i, k, ns), kind);
        n--;
      }
    };
    // the tower whose top came down: the street east of the first big tower's block
    const tower = lots.find((L) => L.fell);
    if (tower) kinds.set(key(tower.bi + 1, tower.bj, true), 'fallen');
    mark('block', ROADBLOCKS);
    mark('jam', JAMS);
    mark('hole', SINKHOLES);
    // the holes are dug first: what is put down after stands in them
    for (const [id, kind] of kinds) {
      if (kind !== 'hole') continue;
      const [i, k, ns] = id.split(':').map(Number);
      const o = -G2 + i * PITCH;
      const m = -G2 + (k + 0.5) * PITCH + 6;
      const [hx, hz] = ns ? [city.x + o, city.z + m] : [city.x + m, city.z + o];
      for (let j = Math.floor((hz - 7 + HALF) / GRID_STEP); j <= Math.ceil((hz + 7 + HALF) / GRID_STEP); j++) {
        for (let ii = Math.floor((hx - 7 + HALF) / GRID_STEP); ii <= Math.ceil((hx + 7 + HALF) / GRID_STEP); ii++) {
          const d = Math.hypot(-HALF + ii * GRID_STEP - hx, -HALF + j * GRID_STEP - hz);
          heights[j * N + ii] -= 1.7 * (1 - smoothstep(1.5, 5.6, d));
        }
      }
    }
    for (let i = 0; i <= GRID; i++) {
      for (let k = 0; k < GRID; k++) {
        for (const ns of [true, false]) {
          // (the stretch of street i between crossings k and k + 1, north-south or east-west)
          const o = -G2 + i * PITCH;
          const m = -G2 + (k + 0.5) * PITCH;
          const at = (along, across) => (ns ? [o + across, m + along] : [m + along, o + across]);
          const yaw = ns ? 0 : PI / 2;
          const kind = kinds.get(key(i, k, ns));
          // weeds along both kerbs, whatever else is here
          for (let n = rng.int(4, 7); n > 0; n--) weed(b, ...at(rng.range(-21, 21), (rng.chance(0.5) ? 1 : -1) * rng.range(5.2, 5.9)), rng.range(0.5, 1.1));
          const [lx, lz] = at(-20, 5.1);
          if (free('streetlight', lx, lz, 0) && kind !== 'fallen') b.prop('streetlight', lx, lz, ns ? PI / 2 : 0); // (its arm out over the roadway)
          if (kind === 'block') {
            // a roadblock: three barriers with a gap a body gets through, wire, sandbags and a crate behind them
            const s0 = rng.range(-8, 8);
            for (const across of [-4.4, -1.3, 4.4]) {
              const [x, z] = at(s0, across);
              if (free('jersey_barrier', x, z, yaw)) b.prop('jersey_barrier', x, z, yaw);
            }
            const [sx, sz] = at(s0 + 2.2, -3.2);
            if (free('sandbags', sx, sz, yaw)) b.prop('sandbags', sx, sz, yaw);
            const [wx, wz] = at(s0 - 2.4, 3.6);
            if (free('razor_wire', wx, wz, yaw)) b.prop('razor_wire', wx, wz, yaw);
            const [cx, cz] = at(s0 + 2.4, 3.8);
            if (free('military_crate', cx, cz, yaw)) b.cont(CONT.AMMO_BOX, cx, cz, { prop: 'military_crate', ry: yaw, zone: ZONE.ROADBLOCK });
            const [bx, bz] = at(s0 + 5, 0.4);
            b.prop('body_bag', bx, bz, yaw + 0.3, { nocollide: true });
            continue;
          }
          if (kind === 'fallen') {
            // The top of the tower: three lumps of it from kerb to kerb, the middle one low enough to be climbed
            // onto from the rubble heaped against it on either side. (across: they are the one thing built in a road)
            for (const [across, w, h, len, turn] of [[-3.5, 4.4, 4.4, 9.5, 0.1], [0.8, 3.8, 2.4, 8.4, -0.06], [4.3, 2.9, 3.4, 7, 0.16]]) {
              const [x, z] = at(0, across);
              b.box(x, 0, z, ns ? w : len, h, ns ? len : w, 'concrete', { ry: turn });
              parts[parts.length - 1].across = true;
              for (const sd of [-1, 1]) for (let f = 0; (f + 1) * 1.5 < h; f++) b.box(...[x + (ns ? 0 : sd * (len / 2 + 0.03)), 0.5 + f * 1.5, z + (ns ? sd * (len / 2 + 0.03) : 0)], ns ? w - 0.8 : 0.05, 0.8, ns ? 0.05 : w - 0.8, 'dark', { ry: turn, collide: false });
              // (its windows, looking at the sky)
              for (const dl of [-2.4, 0, 2.4]) b.box(...[x + (ns ? 0 : dl), h, z + (ns ? dl : 0)], ns ? w - 1 : 1.3, 0.05, ns ? 1.3 : w - 1, 'dark', { ry: turn, collide: false });
              for (let n = 0; n < 2; n++) {
                const [rx, rz] = at(rng.range(-4, 4), across + rng.range(-1.2, 1.2));
                b.box(rx, h, rz, 0.16, rng.range(0.8, 2.2), 0.16, 'rust', { rz: rng.range(-0.5, 0.5), collide: false });
              }
            }
            // (a wall of it leaning on what it fell with, its windows up; what broke off all round)
            {
              const [x, z] = at(-1.5, -6.6);
              b.box(x, 1.5, z, ns ? 3.4 : 12, 0.4, ns ? 12 : 3.4, 'concrete', { rz: ns ? -0.5 : 0, rx: ns ? 0 : 0.5, collide: false });
              const [x2, z2] = at(2.5, 6.6);
              b.box(x2, 0.9, z2, ns ? 3 : 9, 0.4, ns ? 9 : 3, 'concrete', { rz: ns ? 0.42 : 0, rx: ns ? 0 : -0.42, ry: 0.2, collide: false });
              for (const [al, ac] of [[-5, -5], [5, 5.4], [-6, 3], [6, -3], [0, -7], [0, 7.2]]) skirt(b, ...at(al, ac), 0.02);
            }
            for (const along of [-8.4, 8.4]) {
              const [x, z] = at(along, 0.8);
              b.prop('rubble_slope', x, z, along > 0 ? 0 : PI, { seed: along > 0 ? 1 : 0 });
            }
            for (const [along, across] of [[-14, -3], [13, 3.4], [-12, 4], [15, -2]]) litter('debris', ...at(along, across));
            const [sx, sz] = at(0, 0.8);
            smoke(b, sx, 3, sz);
            continue;
          }
          if (kind === 'jam') {
            // bumper to bumper, both lanes: the last traffic the street ever had
            for (let n = 0; n < 7; n++) {
              for (const sgn of [-1, 1]) {
                const t = rng();
                const ry = yaw + (sgn > 0 ? PI : 0) + rng.range(-0.14, 0.14);
                const gone = rng.chance(0.14);
                const [x, z] = at(-19.5 + n * 6.4 + rng.range(-0.5, 0.5), sgn * rng.range(1.7, 2.3));
                const type = t < 0.42 ? 'car_wreck' : t < 0.72 ? 'car_burnt' : t < 0.9 ? 'pickup_truck' : 'ambulance';
                if (!gone && free(type, x, z, ry)) b.wreck(type, x, z, ry, { trunk: type === 'car_wreck' && rng.chance(0.5), zone: ZONE.ROADSIDE });
              }
            }
            litter('suitcases', ...at(rng.range(-12, 12), rng.range(-0.6, 0.6)));
            litter('litter', ...at(rng.range(-12, 12), 4.4));
            b.prop('corpse', ...at(rng.range(-10, 10), -4.4), rng.range(0, 6), { nocollide: true });
            continue;
          }
          const hole = kind === 'hole';
          for (const sgn of [-1, 1]) {
            const here = rng.chance(0.85);
            const [x, z] = at(hole ? rng.range(-20, -7) : rng.range(-15, 15), sgn * rng.range(1.7, 2.6)); // (a hole is at +6: clear of it)
            const t = rng();
            const ry = yaw + (sgn > 0 ? PI : 0) + rng.range(-0.3, 0.3);
            const trunk = rng.chance(0.4);
            const type = t < 0.4 ? 'car_wreck' : t < 0.72 ? 'car_burnt' : t < 0.9 ? 'pickup_truck' : 'ambulance';
            if (here && free(type, x, z, ry)) b.wreck(type, x, z, ry, { trunk: trunk && type === 'car_wreck', zone: ZONE.ROADSIDE });
          }
          // (...and one more that ran up onto the pavement, as often as not)
          {
            const up = rng.chance(0.5);
            const sgn = rng.chance(0.5) ? 1 : -1;
            const [x, z] = at(hole ? rng.range(-20, -7) : rng.range(-18, 18), sgn * rng.range(4.6, 5)); // (short of the walls: they stand 7.2 m from the middle of the street)
            const ry = yaw + rng.range(-0.6, 0.6);
            const type = rng.chance(0.5) ? 'car_burnt' : 'car_wreck';
            if (up && free(type, x, z, ry)) b.wreck(type, x, z, ry, { trunk: false, zone: ZONE.ROADSIDE });
          }
          // what came down off the buildings either side: slabs and lumps along the kerbs
          for (let n = rng.int(2, 5); n > 0; n--) {
            const [x, z] = at(rng.range(-20, 20), (rng.chance(0.5) ? 1 : -1) * rng.range(3.2, 5.6));
            skirt(b, x, z, 0.02);
          }
          // what lies about
          litter(rng.chance(0.6) ? 'litter' : 'debris', ...at(rng.range(-20, 20), rng.range(-4.6, 4.6)));
          if (rng.chance(0.55)) litter('litter', ...at(rng.range(-20, 20), rng.range(-4.6, 4.6)));
          litter(rng.chance(0.5) ? 'litter' : 'debris', ...at(rng.range(-20, 20), rng.range(-3, 3)));
          if (rng.chance(0.5)) litter('suitcases', ...at(rng.range(-20, 20), rng.range(-4.6, 4.6)));
          const r = rng();
          const pa = rng.range(-18, 18);
          const rim = hole && Math.abs(pa - 6) < 9; // (nothing solid on the lip of a hole)
          const [px, pz] = at(pa, (rng.chance(0.5) ? 1 : -1) * rng.range(3.4, 4.8));
          const pr = rng.range(0, 6);
          if (r < 0.14) litter('shopping_cart', px, pz);
          else if (r < 0.28) litter('suitcases', px, pz);
          else if (r < 0.4) litter('pole_down', ...at(rng.range(-8, 8), rng.range(-1, 1)), { ry: undefined });
          else if (r < 0.5 && !rim && free('dumpster_tipped', px, pz, pr)) b.cont(CONT.DUMPSTER, px, pz, { prop: 'dumpster_tipped', ry: pr });
          else if (r < 0.58 && !rim && free('barricade', px, pz, yaw + PI / 2)) b.prop('barricade', px, pz, yaw + PI / 2);
          // the roadway, heaved: slabs of it tipped up out of the street (round a hole, all of its rim)
          for (let n = hole ? 7 : rng.int(0, 2); n > 0; n--) {
            const [hx, hz] = hole ? at(6 + Math.sin(n * 0.9) * rng.range(4.4, 6.2), Math.cos(n * 0.9) * rng.range(3.6, 5.2)) : at(rng.range(-20, 20), rng.range(-4, 4));
            b.box(hx, -0.1, hz, rng.range(1.4, 2.6), 0.2, rng.range(1.2, 2.2), 'concrete', { ry: rng.range(0, 3), rz: rng.range(-0.34, 0.34), rx: rng.range(-0.2, 0.2), collide: false });
          }
          if (rng.chance(0.28)) b.tree(...at(rng.range(-20, 20), (rng.chance(0.5) ? 1 : -1) * rng.range(4.2, 5)), 5, rng.range(0.45, 0.7)); // (a birch, out of a crack)
          const body = rng.chance(0.25);
          const [cx, cz] = at(rng.range(-10, 10), rng.range(-1, 1));
          if (body) b.prop('corpse', cx, cz, rng.range(0, 6), { nocollide: true });
        }
      }
    }
    // traffic lights on the crossings of Main Street (one in three down), a bus slewed across one of the others,
    // an articulated truck jack-knifed across another
    for (let i = 1; i < GRID; i++) {
      const x = -G2 + i * PITCH;
      const down = i % 3 === 1;
      if (down) b.prop('pole_down', x + 4.4, -4.6, 0.7, { nocollide: true, seed: 1 });
      else if (free('traffic_light', x + 5.2, -5.2, PI)) b.prop('traffic_light', x + 5.2, -5.2, PI); // (their arms out over Main Street)
      if (free('traffic_light', x - 5.2, 5.2, 0)) b.prop('traffic_light', x - 5.2, 5.2, 0);
    }
    const jx = -G2 + rng.int(1, GRID - 1) * PITCH;
    const jz = -G2 + [1, 2, 4, 5][rng.int(0, 3)] * PITCH;
    if (free('school_bus', jx + 1, jz - 0.5, 0.9)) b.wreck('school_bus', jx + 1, jz - 0.5, 0.9, { trunk: false });
    const tx = -G2 + rng.int(1, GRID - 1) * PITCH;
    const tz = -G2 + [1, 2, 4, 5][rng.int(0, 3)] * PITCH;
    if (free('semi_truck', tx - 1, tz + 0.5, 2.2)) b.wreck('semi_truck', tx - 1, tz + 0.5, 2.2, { trunk: false, seed: 1 });
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
    // the stack, cold; containers of what was to be shipped; what the years added
    b.cyl(-36, 0, -22, 1.6, 24, 'brick', { sides: 12 });
    b.cyl(-36, 24, -22, 1.75, 0.6, 'charred', { sides: 12, collide: false });
    b.prop('shipping_container', -36, 6, 0.04, { seed: 1 });
    b.prop('shipping_container', -36, 13, -0.03, { seed: 2 });
    b.prop('shipping_container', -36, 13, 0.02, { seed: 0, ly: 2.6 });
    b.cont(CONT.FREIGHT, -32.6, 20, { prop: 'crate', ry: 0.3 });
    b.prop('ivy', -6.96, 12, -PI / 2, { nocollide: true });
    b.prop('ivy', 9.96, -18, PI / 2, { nocollide: true, seed: 1 });
    b.prop('debris', 0, 0, 1, { nocollide: true });
    b.prop('litter', 12, -32, 2, { nocollide: true });
    smoke(b, -18, 9, 6);
  });

  // EASTGATE: a street of houses on the far side of the city.
  place(ZONE.SUBURB, (b) => SUBURB.build(b, K));
  // ...and what lies about the plain (mainland-places.js)
  for (const zn of zones) if (OUTLYING[zn.id]) place(zn.id, (b) => OUTLYING[zn.id].build(b, K, zn));

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
    b.wreck('semi_truck', 22, 9, 0.05, { trunk: false });
    b.prop('litter', 4, 0, 1, { nocollide: true });
    b.prop('suitcases', -9, 2, 0.3, { nocollide: true });
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
    b.prop('light_plane', -RUNWAY_HALF - 11, -20, -2.2, { ground: true, seed: 1 });
    b.clear(RUNWAY_HALF + 15, -70, 8);
    b.clear(-RUNWAY_HALF - 11, -20, 8);
    // the runway's paint: a dashed centre line, the bars of both thresholds, what is left of them
    for (let z = -RUNWAY_LEN / 2 + 34; z < RUNWAY_LEN / 2 - 30; z += 24) if (rng.chance(0.8)) b.box(0, -0.045, z, 0.6, 0.03, 11, 'trim', { collide: false });
    for (const end of [-1, 1]) for (let k = -3; k <= 3; k++) if (k) b.box(k * 2.6, -0.045, end * (RUNWAY_LEN / 2 - 14), 1.3, 0.03, 16, 'trim', { collide: false });
    // ...its edge lights, most of them dark for good, and a windsock at either end
    for (let z = -RUNWAY_LEN / 2 + 6; z <= RUNWAY_LEN / 2 - 6; z += 28) for (const sx of [-1, 1]) b.prop('runway_light', sx * (RUNWAY_HALF + 0.9), z, 0, { nocollide: true, ground: true, seed: (z + sx) & 1 });
    b.prop('windsock', RUNWAY_HALF + 9, RUNWAY_LEN / 2 - 40, 0.4, { ground: true });
    b.prop('windsock', -RUNWAY_HALF - 8, -RUNWAY_LEN / 2 + 30, 2, { ground: true });
  }
  {
    // the apron: what was parked on it the day the flights stopped
    const b = new Builder(apron.x, apron.z, 0, fieldH);
    b.zone = ZONE.HANGARS;
    const on = { ly: 0.05 };
    b.prop('light_plane', -12, -22, 1.2, { ...on, seed: 1 });
    b.prop('light_plane', 9, 6, -0.6, { ...on, seed: 0 });
    b.prop('light_plane', -13, 44, 2.8, { ...on, seed: 1 });
    b.wreck('fire_truck', -19, -60, 0.2, { ...on, trunk: false });
    for (const [cx, cz, r] of [[-5, -42, 0.3], [-5.4, -38.6, 0.34], [14, 30, 1.9], [-2, 58, 0.1]]) b.prop('baggage_cart', cx, cz, r, on);
    b.prop('shipping_container', -24, 64, 0.02, { ...on, seed: 1 });
    b.prop('shipping_container', -24, 71, -0.04, { ...on, seed: 2 });
    b.cont(CONT.FREIGHT, -20.4, 67.4, { prop: 'crate', ry: 0.2, ly: 0.05 });
    b.cont(CONT.DUFFEL, 4, -30, { prop: 'duffel_bag', ry: 1, nocollide: true, ly: 0.05 });
    for (const [lx, lz] of [[2, -36], [12, 22], [-8, 50], [20, -8]]) b.prop('suitcases', lx, lz, lx, { nocollide: true, ly: 0.05, seed: lz & 1 });
    b.prop('litter', 0, 0, 1, { nocollide: true, ly: 0.05 });
    b.prop('corpse', 6, -18, 2, { nocollide: true, ly: 0.05 });
    b.loot(-16, 10, 0.07);
    b.loot(16, -50, 0.07);
  }
  {
    // the perimeter: chain link down the airfield's landward side, down in places, and the gate Route 9 came in by
    const b = new Builder(field.x - 142, field.z, 0, fieldH);
    b.zone = ZONE.TERMINAL;
    b.ground = true;
    for (let z = -168; z <= 196; z += 3) {
      const down = rng.chance(0.14);
      if (down || Math.abs(z - 22) < 6.5 || propBlocked('fence_chain', b.wx(0, z), b.wz(0, z), PI / 2) || roadDistAt(b.wx(0, z), b.wz(0, z)) < 3.4) continue;
      b.prop('fence_chain', 0, z, PI / 2, { seed: z & 1 });
    }
    // (the boom stands on the road it is across, not on the verges either side of it)
    b.prop('boom_gate', 0.4, 16.5, PI / 2, { ground: false, ly: heightAt(b.wx(0.4, 16.5), b.wz(0.4, 16.5)) - fieldH });
    b.prop('jersey_barrier', -3.4, 26, PI / 2, { seed: 1 });
    b.prop('razor_wire', -3.6, 31, PI / 2);
    b.prop('road_sign', -4.4, 12, PI / 2, { seed: 2 });
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
      // its doors, run half shut on their rails, rusted where they stand
      s.box(-5.7, 0, -12.32, 4.6, 6.3, 0.14, 'tin_rust');
      s.box(6.5, 0, -12.32, 3, 6.3, 0.14, 'tin_rust');
      s.prop('ivy', 12.16, 3, -PI / 2, { nocollide: true, seed: k });
      s.prop('litter', 2, -6, k, { nocollide: true, ly: FLOOR_Y, seed: k });
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
    b.box(9.5, 14, 5.5, 6.4, 2.4, 6.4, 'glass', { collide: false });
    b.box(9.5, 14, 5.5, 3, 2.4, 3, 'dark', { collide: false });
    for (const [cx, cz] of [[-3.1, -3.1], [3.1, -3.1], [-3.1, 3.1], [3.1, 3.1]]) b.box(9.5 + cx, 14, 5.5 + cz, 0.2, 2.4, 0.2, 'metal', { collide: false });
    // the baggage hall: the belt, what never got claimed
    b.box(-8, 0.12, -3.2, 8, 0.6, 1.2, 'rust');
    for (const [lx, lz, r] of [[-9, -1.6, 0.3], [-4, -4.6, 1.2], [1.6, 3, 2]]) b.prop('suitcases', lx, lz, r, { nocollide: true, ly: 0.12, seed: lz & 1 });
    b.prop('litter', 0, -2, 1, { nocollide: true, ly: 0.12 });
    b.prop('barricade', 2.6, -2.9, PI / 2, { ly: 0.12 });
    b.prop('baggage_cart', -18, 2, 0.1);
    b.prop('ivy', -13.16, 4, PI / 2, { nocollide: true });
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

  // FARMS: a barn, the house, a silo, a fenced field gone to weed.
  for (const f of farms) {
    const b = new Builder(f.x, f.z, f.ry, f.h);
    b.zone = f === farms[0] ? ZONE.FARM_A : ZONE.FARM_B;
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
  const atFence = (x, z, pad) => Math.abs(x - (field.x - 142)) < pad && z > field.z - 168 - pad && z < field.z + 196 + pad; // (the airfield's perimeter)
  const siteOk = (x, z) => !atFence(x, z, SITE_FLAT + 12) && lakeDist(x, z) > 16 && pondDist(x, z) > 10 && !inCity(x, z, 26) && farms.every((f) => Math.hypot(f.x - x, f.z - z) > FARM_R + 54) && Math.abs(x) < HALF - 60 && Math.abs(z) < HALF - 60 && !inWater(x, z) && !nearZone(x, z, 26) && !onField(x, z, 14) && x > COAST + 30;
  // is a road other than `road` within d of (x, z)? (At a junction the ground is two roads': nothing is seated there.)
  const otherRoad = (road, x, z, d) => roads.some((r) => r !== road && r.pts.some((v, k) => !(k & 1) && Math.abs(v - x) < d && Math.abs(r.pts[k + 1] - z) < d));
  const siteFree = (x, z, gapTo) => sites.every((s) => Math.hypot(s.x - x, s.z - z) >= (s.type === 'jam' ? Math.max(gapTo, 48) : gapTo)); // (a jam is 60 m of road)
  // Route 9 first: every so often the traffic out of the city stopped for good - a dozen wrecks across both lanes,
  // a truck jack-knifed among them, what their people dropped as they ran
  {
    const p = highway.pts;
    let acc = JAM_EVERY; // (the first where there is first room for one)
    for (let i = 6; i < p.length / 2 - 6; i++) {
      acc += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      const x = p[i * 2];
      const z = p[i * 2 + 1];
      if (acc < JAM_EVERY || nearZone(x, z, 46) || Math.hypot(x - block9.x, z - block9.z) < 26 + 64 || inCity(x, z, 30) || onField(x, z, 30) || x < head.x + 60) continue;
      acc = rng.range(-30, 30);
      const tx = p[i * 2 + 4] - p[i * 2 - 4];
      const tz = p[i * 2 + 5] - p[i * 2 - 3];
      const b = new Builder(x, z, Math.atan2(-tx, -tz), heightAt(x, z));
      b.zone = ZONE.FOREST;
      b.ground = true;
      sites.push({ x, z, ry: b.ry, type: 'jam', road: ROAD.ASPHALT });
      const truck = rng.chance(0.5);
      const tx0 = rng.range(-0.6, 0.6);
      const tr = rng.chance(0.5) ? 0.5 : PI - 0.4;
      const ts = rng.int(0, 1);
      if (truck && !propBlocked('semi_truck', b.wx(tx0, 0), b.wz(tx0, 0), b.ry + tr) && !otherRoad(highway, x, z, 18)) b.wreck('semi_truck', tx0, 0, tr, { trunk: false, seed: ts, zone: ZONE.ROADSIDE });
      // (both lanes, nose to tail: n lengths of it, a gap here and there where one got out)
      for (let n = rng.int(6, 9) * 2, k = 0; k < n; k++) {
        const along = ((k >> 1) - n / 4) * 6.3 + rng.range(-0.7, 0.7);
        const lane = (k % 2 ? 1 : -1) * rng.range(1.7, 2.3) + (rng.chance(0.14) ? (k % 2 ? 3 : -3) : 0); // (a few took to the verge)
        const t = rng();
        const ry = (k % 2 ? PI : 0) + rng.range(-0.35, 0.35);
        const trunk = rng.chance(0.5);
        const type = t < 0.4 ? 'car_wreck' : t < 0.68 ? 'car_burnt' : t < 0.86 ? 'pickup_truck' : t < 0.95 ? 'ambulance' : 'school_bus';
        if (propBlocked(type, b.wx(lane, along), b.wz(lane, along), b.ry + ry) || otherRoad(highway, b.wx(lane, along), b.wz(lane, along), 13)) continue;
        b.wreck(type, lane, along, ry, { trunk: trunk && type !== 'car_burnt' && type !== 'ambulance' && type !== 'school_bus', zone: ZONE.ROADSIDE });
      }
      b.prop('suitcases', rng.range(-5, 5), rng.range(-12, 12), rng.range(0, 6), { nocollide: true });
      b.prop('litter', rng.range(-4, 4), rng.range(-12, 12), rng.range(0, 6), { nocollide: true, seed: 1 });
      b.prop('corpse', rng.range(-6, 6), rng.range(-14, 14), rng.range(0, 6), { nocollide: true });
      b.cont(CONT.DUFFEL, 6.4, rng.range(-8, 8), { prop: 'duffel_bag', ry: rng.range(0, 6), nocollide: true, zone: ZONE.ROADSIDE });
    }
  }
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
      // (not where a second road comes by: by a junction the ground is the roads', not the site's)
      if (!siteOk(sx, sz) || !siteFree(sx, sz, 30) || roadDistAt(sx, sz) < off - road.width - 1 || (type !== 'wreck' && roadDistAt(sx, sz) < 8.5) || otherRoad(road, sx, sz, 16)) continue;
      // (rh: the road's height by a wreck. It stands on a shoulder of the road, level with it - not on a shelf up the
      // bank of a cutting.)
      sites.push({ x: sx, z: sz, ry: Math.atan2((-tz / tl) * -sideOf, (tx / tl) * -sideOf), type, road: road.kind, rh: type === 'wreck' ? road.hs[i] : undefined });
      acc = rng.range(-10, 10);
    }
  }
  for (let a = 0; a < 5000 && sites.length < 240; a++) {
    const x = rng.range(-HALF + 70, HALF - 70);
    const z = rng.range(-HALF + 70, HALF - 70);
    if (!siteOk(x, z) || roadDistAt(x, z) < 22 || !siteFree(x, z, 38)) continue;
    sites.push({ x, z, ry: rng.range(0, PI * 2), type: ['camp', 'stash', 'shed', 'camp'][rng.int(0, 3)], road: 0 });
  }
  // level the ground under each (not the roads beside them), so a shed's walls and what stands by them sit true
  for (const st of sites) {
    if (st.type === 'jam') continue; // (it stands on the road)
    const h0 = st.rh ?? heightAt(st.x, st.z);
    const R = SITE_FLAT + 5;
    for (let j = Math.max(0, Math.floor((st.z - R + HALF) / GRID_STEP)); j <= Math.min(N - 1, Math.ceil((st.z + R + HALF) / GRID_STEP)); j++) {
      for (let i = Math.max(0, Math.floor((st.x - R + HALF) / GRID_STEP)); i <= Math.min(N - 1, Math.ceil((st.x + R + HALF) / GRID_STEP)); i++) {
        const k = j * N + i;
        if (roadDist[k] < 5 && st.rh === undefined) continue; // (clear of it: what stands on the road was seated on it as it is)
        // (a site by a road is a shoulder of it: by the road it follows the road's own fall, a cell at a time)
        heights[k] = lerp(heights[k], st.rh !== undefined && roadDist[k] < 9.5 ? roadH[k] - 0.05 : h0, 1 - smoothstep(SITE_FLAT, R, Math.hypot(-HALF + i * GRID_STEP - st.x, -HALF + j * GRID_STEP - st.z)));
      }
    }
    st.h = h0;
  }
  for (const st of sites) {
    if (st.type === 'jam') continue;
    const b = new Builder(st.x, st.z, st.ry, st.h);
    b.zone = ZONE.FOREST;
    b.ground = true;
    if (st.type === 'wreck') {
      const t = rng();
      b.wreck(t < 0.45 ? 'car_wreck' : t < 0.75 ? 'car_burnt' : 'pickup_truck', 0, 0, PI / 2 + rng.range(-0.5, 0.5), { zone: ZONE.ROADSIDE, trunk: t < 0.45 || t >= 0.75 });
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

  // what came up through the city's paving, down its kerbs and in its yards
  for (const [x, z, scale] of weeds) if (!partBlocked(x, z, 0.3)) bushes.push(x, heightAt(x, z), z, scale, rng.range(0, PI * 2), rng.int(0, 2));

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
    lake,
    ponds,
    landmarks, // what the field map names inside a place: { x, z, name }
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
