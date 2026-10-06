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
//   city     { x, z, pitch, grid, lots: [{ x, z, w, d, ry, what }] }: what was built on every lot of Port Calder; and
//            what its buildings are drawn from (buildings, rooms, shells, heaps, fallen, pancakes, signs: see
//            "What the city is drawn from" below, and client/render/citykit.js)
//   parts[i].hidden   a solid that is not drawn as the box it is (the kit draws that building, wall or heap)
//   farms    [{ x, z, ry }]: the farms out on the plain (no place names them: their loot is a farm's)
//   river    { pts, hw, bridges: [{ x, y, z, ry, len, w }] }: its middle line, half its width, and where roads cross it
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
const ROADBLOCKS = 5; // stretches of street the army barricaded, and died at
const JAMS = 6; // ...and stretches where the traffic stopped for good, bumper to bumper
const SINKHOLES = 2; // ...and where the street fell in
const SMOKES = 9; // columns of smoke standing over the city (world.lights 'smoke'), and FIRES still burning under them
const FIRES = 3;
const PLACE_GAP = 62; // open country left between two places out on the plain (m, yard to yard)
const PONDS = 4;
const RIVER_HW = 8; // the river: this far from its middle to either bank,
const RIVER_BANK = 28; // ...its valley this much wider again,
const RIVER_DEPTH = 1.7; // ...and this deep (deep water: it is swum, or crossed by a bridge)
const BRIDGE_UP = 1.8; // a bridge's deck over the water
const JAM_EVERY = 120; // a pile-up on Route 9 about this often (m)
// what is drawn for a lot nothing was dealt to, by weight: [kind, weight]
const SMALL_LOTS = [['grocery', 0.9], ['diner', 0.7], ['pharmacy', 0.4], ['hardware', 0.5], ['liquor', 0.4], ['pawn', 0.3], ['laundry', 0.3], ['bakery', 0.3], ['bar', 0.4], ['books', 0.3], ['flats', 3.6], ['office', 0.9], ['ruin', 2.0], ['burnt', 1.6], ['gas', 0.4], ['green', 0.5]];
const LONG_LOTS = [['terrace', 3], ['block', 3], ['carpark', 1], ['parking', 0.5], ['cinema', 0.3], ['warehouse', 1.2]];
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
  const suburb = { x: city.x + prng.range(120, 170), z: city.z - side * (G2 + prng.range(165, 185)) }; // (across the river)
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
  // The river. It comes down out of the hills of the rim on the bay's side (the side Eastgate is on), runs along the
  // city's edge there and into the bay, which is its mouth. A line through a few points that the seed moves;
  // riverD: how far every vertex of the heightfield is from that line (out to 110 m: further is 1e4).
  const bside = -side;
  const riverZ = city.z + bside * (G2 + 62); // (where it passes the city)
  const bayZ = riverZ + bside * prng.range(0, 26);
  const riverPts = [];
  {
    const ctrl = [
      [cityE[0] + prng.range(330, 470), bside * (HALF - 24)],
      [cityE[0] + prng.range(150, 210), riverZ + bside * prng.range(120, 170)],
      [cityE[0] + prng.range(46, 70), riverZ + bside * prng.range(8, 30)],
      [city.x + prng.range(-30, 30), riverZ + bside * prng.range(-6, 8)],
      [cityW[0] - 36, riverZ + bside * prng.range(-4, 10)],
      [COAST + 64, bayZ],
      [COAST - 40, bayZ],
    ];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const [p0, p1, p2, p3] = [ctrl[Math.max(0, i - 1)], ctrl[i], ctrl[i + 1], ctrl[Math.min(ctrl.length - 1, i + 2)]];
      const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 4));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
        riverPts.push(f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]));
      }
    }
    riverPts.push(ctrl[ctrl.length - 1][0], ctrl[ctrl.length - 1][1]);
  }
  const riverD = new Float32Array(N * N).fill(1e4);
  for (let s = 0; s < riverPts.length / 2 - 1; s++) {
    const [ax, az, bx, bz] = [riverPts[s * 2], riverPts[s * 2 + 1], riverPts[s * 2 + 2], riverPts[s * 2 + 3]];
    const el2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - 110 + HALF) / GRID_STEP));
    const i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + 110 + HALF) / GRID_STEP));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - 110 + HALF) / GRID_STEP));
    const j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + 110 + HALF) / GRID_STEP));
    for (let j = j0; j <= j1; j++) {
      const z = -HALF + j * GRID_STEP;
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * GRID_STEP;
        const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / el2, 0, 1);
        const d = Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t);
        if (d < 110 && d < riverD[j * N + i]) riverD[j * N + i] = d;
      }
    }
  }
  const riverAt = (x, z) => riverD[clamp(Math.round((z + HALF) / GRID_STEP), 0, N - 1) * N + clamp(Math.round((x + HALF) / GRID_STEP), 0, N - 1)];
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
    riverAt(x, z) > flat + 42 &&
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
  // the boat works: on the river's far bank across from the city, its slip (+Z) down to the water
  // (beside where Ferry Street comes over: the second or third of the city's streets from the west)
  const ferry = prng.int(1, 2);
  spot(ZONE.BOATWORKS, city.x - G2 + ferry * PITCH + 40, riverZ + bside * 52, OUTLYING[ZONE.BOATWORKS].flat, bside > 0 ? PI : 0, { fixed: true });
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
    if (!room(x, z, FARM_R + 58, lerp(PLACE_GAP, 2, ease))) continue; // (its field lies west of the yard: room for both, and for the ground levelled round them)
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
      crosses = inCity(px, pz, 40) || onField(px, pz, 16) || lakeDist(px, pz) < 20 || riverAt(px, pz) < 24 || trackDist(px, pz) < 12 || spots.some((o) => Math.hypot(o.x - px, o.z - pz) < o.flat + 26);
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
    if (!room(x, z, FARM_R + 58, 2)) continue;
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
    // (the first nine keep PLACE_GAP of open country round them; the rest - the third pass's - go where there is
    // room between those, nearer each other and nearer the roads)
    const FIRST = [ZONE.SCHOOL, ZONE.CONTAINERS, ZONE.TRAILERPARK, ZONE.SALVAGE, ZONE.SUBSTATION, ZONE.WATERWORKS, ZONE.GRAVEYARD, ZONE.LOGGING, ZONE.MAST];
    const MORE = [ZONE.EVAC, ZONE.MOTORPOOL, ZONE.DRIVEIN_M, ZONE.AGGREGATES, ZONE.GRAIN, ZONE.STORAGE, ZONE.FIREHOUSE, ZONE.CARLOT, ZONE.NURSERY, ZONE.HELIPAD, ZONE.DINER_M];
    Object.assign(WANT, {
      [ZONE.EVAC]: (x, z) => -lineDist(x, z) / 500,
      [ZONE.DINER_M]: (x, z) => -lineDist(x, z) / 300,
      [ZONE.CARLOT]: (x, z) => -lineDist(x, z) / 400,
      [ZONE.FIREHOUSE]: (x, z) => -Math.hypot(x - city.x, z - city.z) / 900,
      [ZONE.STORAGE]: (x, z) => -Math.hypot(x - city.x, z - city.z) / 900,
      [ZONE.HELIPAD]: (x, z) => -Math.hypot(x - field.x, z - field.z) / 900,
    });
    for (const id of [...FIRST, ...MORE]) {
      const flat = OUTLYING[id].flat;
      const more = MORE.includes(id);
      let best = null;
      let bs = -Infinity;
      // (where there is no room for it with open country all round, with less of that: every place is on every map)
      for (let i = 0; i < 520 && (best === null || i < (more ? 160 : 70)); i++) {
        const x = prng.range(COAST + 150, HALF - 120);
        const z = prng.range(-HALF + 110, HALF - 110);
        const jit = prng() * 0.25;
        if (!room(x, z, flat, i < 160 ? (more ? 30 : PLACE_GAP) : i < 340 ? 22 : 6)) continue;
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
    // the river: a valley let down to the water's edge, the bed cut below it (its banks wander a little)
    const dRiver = riverAt(x, z);
    if (dRiver < RIVER_HW + RIVER_BANK + 4) {
      const dn = dRiver + nE(x * 0.04, z * 0.04) * 2.4;
      h = lerp(h, Math.min(h, WATER_LEVEL + 0.9), 1 - smoothstep(RIVER_HW + 1.5, RIVER_HW + RIVER_BANK, dn));
      h = lerp(h, WATER_LEVEL - RIVER_DEPTH, 1 - smoothstep(RIVER_HW * 0.72, RIVER_HW, dn)); // (the bed falls away steeply from the bank: no shallows under a bridge that a walker would rather take)
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
    // (over the river it is a bridge: the deck is this far over the water, whatever the bed does under it)
    const wet = (i) => riverAt(pts[i * 2], pts[i * 2 + 1]);
    if (level === null) for (let i = 0; i < n; i++) if (wet(i) < RIVER_HW + 12) hs[i] = Math.max(hs[i], WATER_LEVEL + BRIDGE_UP);
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
    // spans: [first, last] points of each stretch of it that is over the river
    const spans = [];
    for (let i = 0; i < n; i++) {
      if (level !== null || wet(i) >= RIVER_HW + 1) continue;
      if (spans.length && spans[spans.length - 1][1] === i - 1) spans[spans.length - 1][1] = i;
      else spans.push([i, i]);
    }
    // (its deck is level from bank to bank - one height, so it is one thing to walk on - and the road comes up to
    // that over a few metres either side)
    for (const [i0, i1] of spans) {
      const [a, e] = [Math.max(0, i0 - 3), Math.min(n - 1, i1 + 3)];
      let top = WATER_LEVEL + BRIDGE_UP;
      for (let i = a; i <= e; i++) top = Math.max(top, hs[i]);
      for (let i = a; i <= e; i++) hs[i] = top;
      for (let k = 1; k <= 6; k++) {
        if (a - k >= 0) hs[a - k] = lerp(top, hs[a - k], k / 7);
        if (e + k < n) hs[e + k] = lerp(top, hs[e + k], k / 7);
      }
    }
    const road = { pts: new Float32Array(pts), hs, kind, width, name, length, spans };
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
  // ...and two of them run on over the river on the city's far side, to the bank beyond: Eastgate's road and the
  // boat works' start from there
  for (const i of [ferry, GRID - 1]) {
    const sx = city.x - G2 + i * PITCH;
    buildRoad([[sx, city.z + bside * (G2 + 8)], [sx + (i === ferry ? 3 : -4), riverZ + bside * 4], [sx, riverZ + bside * 48]], ROAD.ASPHALT, 3, i === ferry ? 'Ferry Street' : 'Eastgate Road');
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
    const clear = (a, b, self, pad = 22) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let inRiver = 0;
      for (let d = 6; d < len - 4; d += 6) {
        const x = a[0] + ((b[0] - a[0]) * d) / len;
        const z = a[1] + ((b[1] - a[1]) * d) / len;
        if (inCity(x, z, 6) || onField(x, z, 4) || lakeDist(x, z) < 14 || pondDist(x, z) < 10) return false;
        if (riverAt(x, z) < RIVER_HW + 6 && ++inRiver > 6) return false; // (it may cross the river, squarely: not run down it)
        for (const zn of zones) {
          // (not back through the yard it left by its gate, either)
          // (...and a farm's field lies out past its yard)
          const keep = zn.flat + (zn.id === ZONE.FARM_A || zn.id === ZONE.FARM_B ? 44 : pad);
          if (zn === self ? d > 9 && Math.hypot(x - zn.x, z - zn.z) < zn.flat * 0.86 : zn.id !== ZONE.CITY && Math.hypot(x - zn.x, z - zn.z) < keep) return false;
        }
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
        search: for (let k = 0; k < Math.min(byDist.length, 400); k += 4) {
          const p = byDist[k];
          if (!far(p)) continue;
          for (const r of [40, 70, 130, 210, 300]) {
            for (let a = 0; a < 16; a++) {
              const v = [zn.x + Math.sin((a * PI) / 8) * (zn.flat + r), zn.z + Math.cos((a * PI) / 8) * (zn.flat + r)];
              if (Math.max(Math.abs(v[0]), Math.abs(v[1])) > HALF - 70 || v[0] < COAST + 60 || !clear(gateOf(v), v, zn) || !clear(v, p, null)) continue;
              to = p;
              via = v;
              break search;
            }
          }
        }
      }
      if (!to) {
        // (...or nearer the places it passes than a road likes to go)
        to = byDist.slice(0, 200).find((p) => far(p) && clear(gateOf(p), p, zn, 7));
        search2: for (let k = 0; !to && k < Math.min(byDist.length, 400); k += 4) {
          const p = byDist[k];
          if (!far(p)) continue;
          for (const r of [40, 70, 130, 210, 300]) {
            for (let a = 0; a < 16; a++) {
              const v = [zn.x + Math.sin((a * PI) / 8) * (zn.flat + r), zn.z + Math.cos((a * PI) / 8) * (zn.flat + r)];
              if (Math.max(Math.abs(v[0]), Math.abs(v[1])) > HALF - 70 || v[0] < COAST + 60 || !clear(gateOf(v), v, zn, 7) || !clear(v, p, null, 7)) continue;
              to = p;
              via = v;
              break search2;
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
          if (riverD[k] < RIVER_HW + 0.6) continue; // (the river runs on under its bridge)
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
    b.yard = { x: zn.x, z: zn.z, flat: zn.flat - 2.5 }; // (what stands nearer the edge of the levelled ground than a cell of the heightfield stands on the ground as it is)
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
  // (What stands against a wall faces the room: a prop's front is its -Z, which a Builder's ry turns to (-sin ry,
  // -cos ry) - so 0 against the back wall, PI against the front, -PI / 2 against the left, PI / 2 against the right.)
  const backZ = (F, depth) => F.back - WALL - depth / 2;
  const leftX = (F, depth) => F.L + WALL + depth / 2;
  const rightX = (F, depth) => F.R - WALL - depth / 2;
  const inside = { ly: FLOOR_Y };
  const cont = (b, ctype, prop, x, z, ry, o = {}) => b.cont(ctype, x, z, { prop, ry, ly: FLOOR_Y, ...o });

  // ---- What the city is drawn from. The storeys over a ground floor, the walls of a shell, a heap of rubble and
  // the length of a tower lying in the street are solid here (boxes, hidden: nothing draws them as boxes) and are
  // said here for the client's building kit (client/render/citykit.js), which builds what is seen of each: walls
  // with their windows, cornices, fire escapes, storeys cut open on their rooms, rubble that looks like rubble.
  const buildings = []; // a block of storeys: { x, z, ry, y, w, d, floors, fh, style, mat, seed, cut, wear, burnt, blank, ground, top }
  const rooms = []; // a room that is walked into: its walls are parts; the kit lines them, ceils them, hangs its sign
  const shells = []; // walls with the sky behind them: { x0, z0, x1, z1, y, t, mat, fh, heights, seed, soot, inner }
  const heaps = []; // { x, y, z, ry, rx, rz, h, seed, brick }
  const fallenBits = []; // a length of tower lying where it fell: { x, y, z, ry, len, w, h, fh, style, mat, seed }
  const pancakes = []; // floors come down one on another: { x, y, z, ry, w, d, n, seed }
  const signs = []; // a board or a mark from the city's atlas, anywhere: { x, y, z, ry, w, h, cell, ... }
  const hide = () => (parts[parts.length - 1].hidden = true);
  // a solid nothing draws as it is
  const solid = (b, lx, ly, lz, sx, sy, sz, mat, o = {}) => {
    b.box(lx, ly, lz, sx, sy, sz, mat, o);
    hide();
    return parts[parts.length - 1];
  };
  // A block of storeys on (cx, cz) of a builder's frame, w by d, its foot at y0, `floors` of them fh high, in a
  // style of the kit's (walkup, shopflat, slab, office, glass, warehouse, stone) and a wall material. o:
  //   lost   how many of its top storeys are broken: each stands on less of the footprint than the one under it
  //   open   a whole end of it fallen away from storey `from` up (-1 / 1: its -x / +x end), further with every storey
  //   burnt  it burnt out: no glass, soot over every opening
  //   blank  bits: which of its faces (front, right, back, left) are blind walls
  //   top    'slab': its roof is gone, what is left on the slab is under the sky
  // Returns the height of what still stands whole.
  const block = (b, cx, cz, w, d, y0, floors, fh, style, mat, o = {}) => {
    const seed = rng.int(1, 99999);
    const lost = Math.min(o.lost ?? 0, floors - 1);
    const sx = rng.chance(0.5) ? 1 : -1;
    const sz = rng.chance(0.5) ? 1 : -1;
    const open = o.open || 0;
    const from = o.from ?? 1;
    const hw = w / 2;
    const hd = d / 2;
    const cut = [];
    let gone = 0; // how much of the open end is gone at this storey
    for (let f = 0; f < floors; f++) {
      let R = [-hw, hw, -hd, hd];
      const step = rng.range(2, 6.5);
      const bite = rng.chance(0.5);
      if (open && f >= from) {
        if (bite || f === from) gone = Math.min(w * 0.62, gone + step); // (in bites: a storey or two stand on the same line, then more is gone)
        R = open > 0 ? [-hw, hw - gone, -hd, hd] : [-hw + gone, hw, -hd, hd];
      }
      const k = f - (floors - lost);
      if (k >= 0) {
        const left = 1 - (k + 1) / (lost + 1.3); // the share of the floor still there
        const pw = w * (0.42 + 0.5 * left);
        const pd = d * (0.48 + 0.45 * left);
        const S = [sx > 0 ? hw - pw : -hw, sx > 0 ? hw : -hw + pw, sz > 0 ? hd - pd : -hd, sz > 0 ? hd : -hd + pd];
        R = [Math.max(R[0], S[0]), Math.min(R[1], S[1]), Math.max(R[2], S[2]), Math.min(R[3], S[3])];
        if (R[1] - R[0] < 2.5 || R[3] - R[2] < 2.5) {
          floors = f; // (nothing worth the name left of it: the building ends here)
          break;
        }
      }
      cut.push(R[0] === -hw && R[1] === hw && R[2] === -hd && R[3] === hd ? null : R.map((v) => Math.round(v * 100) / 100));
    }
    // (solid: one box for every run of storeys that stand on the same footprint)
    for (let f = 0; f < floors; ) {
      let g = f + 1;
      while (g < floors && JSON.stringify(cut[g]) === JSON.stringify(cut[f])) g++;
      const R = cut[f] || [-hw, hw, -hd, hd];
      solid(b, cx + (R[0] + R[1]) / 2, y0 + f * fh, cz + (R[2] + R[3]) / 2, R[1] - R[0], (g - f) * fh, R[3] - R[2], mat);
      f = g;
    }
    const whole = cut.findIndex((R) => R);
    buildings.push({ x: b.wx(cx, cz), z: b.wz(cx, cz), ry: b.ry, y: b.y0 + y0, w, d, floors, fh, style, mat, seed, cut: cut.some((R) => R) ? cut : undefined, wear: o.wear ?? rng.range(0.35, 0.9), burnt: o.burnt ? 1 : 0, blank: o.blank || 0, ground: y0 - PAVE, top: o.top });
    if ((lost > 1 || open) && rng.chance(0.4)) smoke(b, cx, y0 + floors * fh, cz);
    return y0 + (whole < 0 ? floors : whole) * fh;
  };
  // A room that is walked into, as Builder.room builds it, said for the kit as well: what its openings are, how it
  // is lined. o (besides Builder.room's): tint (which of the kit's paints its walls have), lino (tile on its floor)
  // or boards (floorboards), ceiling ('plaster': a home's, not an office's tiles), ceil (how high it hangs, if lower
  // than the slab), homely (a home: pictures on its walls), burnt (burnt out: sooted, no ceiling), sign (the board
  // over its front: a cell of the city's atlas), plain (a shed: no lining). Returns what it said, for partition(),
  // zone() and lino() to add to: the room's inner walls, the rooms they make of it, what is laid on its floor.
  const groundRoom = (b, cx, cz, w, d, h, mat, sides, o = {}) => {
    b.room(cx, cz, w, d, h, mat, sides, o);
    const R = { x: b.wx(cx, cz), z: b.wz(cx, cz), ry: b.ry, y: b.y0, w, d, h, t: o.t || 0.25, mat, sides, tint: o.tint ?? rng.int(0, 5), floor: o.lino ? 'lino' : o.boards ? 'boards' : undefined, ceiling: o.burnt ? undefined : o.ceiling || (o.roof === 'flat' ? 'ceiling' : undefined), ceil: o.ceil, homely: o.homely ? 1 : undefined, burnt: o.burnt ? 1 : undefined, sign: o.sign, seed: rng.int(1, 99999), walls: [], zones: [], patches: [], cx, cz };
    if (!o.plain) rooms.push(R);
    return R;
  };
  // an inner wall of such a room (as Builder.wall), lined on both faces
  const partition = (b, R, x0, z0, x1, z1, h, mat, ops = []) => {
    b.wall(x0, z0, x1, z1, h, 0.18, mat, ops);
    R.walls.push([x0 - R.cx, z0 - R.cz, x1 - R.cx, z1 - R.cz, h, ops]);
  };
  // one of the rooms the partitions make of it, x0..x1 by z0..z1 of the builder's frame: painted its own colour
  // (tint: one of the kit's paints)
  const r2 = (v) => Math.round(v * 100) / 100;
  const zone = (R, x0, z0, x1, z1, tint) => R.zones.push([r2(Math.min(x0, x1) - R.cx), r2(Math.min(z0, z1) - R.cz), r2(Math.max(x0, x1) - R.cx), r2(Math.max(z0, z1) - R.cz), tint]);
  // ...and tile laid on that room's floor (a kitchen's, a bathroom's), a hand's width in from its walls
  const lino = (R, x0, z0, x1, z1, tint) => R.patches.push([r2(Math.min(x0, x1) - R.cx + 0.13), r2(Math.min(z0, z1) - R.cz + 0.13), r2(Math.max(x0, x1) - R.cx - 0.13), r2(Math.max(z0, z1) - R.cz - 0.13), tint]);
  // is (x, z) of the builder's frame within pad of one of the room's partitions? (What is scattered on a floor does
  // not lie through a wall.)
  const atPartition = (R, x, z, pad) => {
    if (!R) return false;
    for (const [x0, z0, x1, z1] of R.walls) {
      const ax = x0 + R.cx, az = z0 + R.cz, dx = x1 - x0, dz = z1 - z0;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < pad) return true;
    }
    return false;
  };
  // a fire somebody keeps in a drum, in a room: the one light in it that is not the day's
  const drumFire = (b, lx, lz) => {
    b.prop('barrel', lx, lz, 0, { ly: FLOOR_Y, seed: 2 });
    b.light(lx, FLOOR_Y + 1.0, lz, 'embers');
  };
  // What is left of a wall, from (x0, z0) to (x1, z1) along one axis of the builder's frame: lengths of it, each
  // broken off at its own height (up to H), its window openings holes with the sky in them. soot: it burnt.
  // inner: what its other face is made of (the plaster of the rooms that stood against it).
  const jagged = (b, x0, z0, x1, z1, y0, H, mat, collide = true, o = {}) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 2.6));
    const seg = len / n;
    const heights = [];
    let h = H * rng.range(0.6, 1);
    for (let k = 0; k < n; k++) {
      h = clamp(h + rng.range(-0.4, 0.3) * H, H * 0.14, H);
      const t = (k + 0.5) / n;
      const [cx, cz] = [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
      solid(b, cx, y0, cz, alongX ? seg + 0.02 : 0.4, h, alongX ? 0.4 : seg + 0.02, mat, { collide });
      heights.push(Math.round(h * 100) / 100);
    }
    shells.push({ x0: b.wx(x0, z0), z0: b.wz(x0, z0), x1: b.wx(x1, z1), z1: b.wz(x1, z1), y: b.y0 + y0, t: 0.4, mat, fh: 3, heights, seed: rng.int(1, 99999), soot: o.soot ? 1 : 0, inner: o.inner });
  };
  // A heap of what a building came down as, rx by rz across and h high: solid in steps a survivor climbs (0.4 m
  // each: under STEP_HEIGHT), drawn by the kit as rubble. across: it lies in a road (worldcheck.js lets it).
  const heap = (b, lx, lz, rx, rz, h, o = {}) => {
    const ry = o.ry ?? 0;
    const ly = o.ly ?? PAVE;
    const n = Math.max(1, Math.round(h / 0.4));
    for (let k = 0; k < n; k++) {
      // (the mound's own width at the top of this step: the kit's profile is h * (1 - t^2)^0.85)
      const e = Math.sqrt(Math.max(0, 1 - Math.pow(((k + 1) * 0.4) / (h + 0.05), 1 / 0.85)));
      if (e * Math.min(rx, rz) < 0.35) break;
      solid(b, lx, ly, lz, rx * 2 * e * 0.86, (k + 1) * 0.4, rz * 2 * e * 0.86, 'concrete', { ry });
      if (o.across) parts[parts.length - 1].across = true;
    }
    heaps.push({ x: b.wx(lx, lz), y: b.y0 + ly, z: b.wz(lx, lz), ry: b.ry + ry, rx, rz, h, seed: rng.int(1, 99999), brick: o.brick ?? 0.3, ash: o.ash ? 1 : undefined });
    clears.push([b.wx(lx, lz), b.wz(lx, lz), Math.max(rx, rz) + 0.5]);
  };
  // a board or a mark of the city's atlas: its middle at (lx, ly, lz) of the builder's frame, facing the builder's
  // -Z turned by ry
  const signAt = (b, lx, ly, lz, ry, w, h, cell, o = {}) => signs.push({ x: b.wx(lx, lz), y: b.y0 + ly, z: b.wz(lx, lz), ry: b.ry + ry, w, h, cell, ...o });
  // Does a prop of this type fit at (lx, lz) of a builder's frame: clear of every solid prop, of the walls and posts
  // built so far, and of the doorways (a metre and a half of each is kept open), with room left to reach what is
  // searched or picked up beside it? For what is added to a place after what it needs has been put down.
  // (two long vehicles end to end can meet further apart than propBlocked looks - a bus, an articulated truck:
  // none is put down in that band of another)
  const LONG = { semi_truck: 1, school_bus: 1, city_bus: 1 };
  const longClear = (type, x, z) => !LONG[type] || props.every((p) => !LONG[p.type] || Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= 12 || Math.hypot(p.x - x, p.z - z) > 13.8);
  const fits = (b, type, lx, lz, ry = 0, ly = 0) => {
    if (!PROPS[type]) return false;
    const x = b.wx(lx, lz);
    const z = b.wz(lx, lz);
    const wry = b.ry + ry;
    if (propBlocked(type, x, z, wry) || !longClear(type, x, z)) return false;
    const mine = kit.solidsOf(type, x, z, wry);
    if (!mine.length) return true;
    const y0 = b.y0 + ly;
    const y1 = y0 + (PROPS[type]?.size[1] ?? 1);
    const reach = Math.hypot(PROPS[type].size[0], PROPS[type].size[2]) / 2;
    for (const o of openings) if (Math.hypot(o.x - x, o.z - z) < reach + 1.15) return false;
    for (const o of containers) if (Math.hypot(o.x - x, o.z - z) < reach + 0.85) return false;
    for (const o of lootSpawns) if (Math.hypot(o.x - x, o.z - z) < reach + 0.75) return false;
    for (const o of partSpots) if (Math.hypot(o.x - x, o.z - z) < reach + 0.9) return false;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (Math.abs(p.x - x) > 30 || Math.abs(p.z - z) > 30 || p.rx || p.rz || (p.shape !== 'box' && p.shape !== 'cyl')) continue;
      if (p.y + p.sy / 2 < y0 + 0.2 || p.y - p.sy / 2 > y1 - 0.05) continue;
      const q = { x: p.x, z: p.z, hx: p.shape === 'box' ? p.sx / 2 : 0, hz: p.shape === 'box' ? p.sz / 2 : 0, c: Math.cos(p.ry), s: Math.sin(p.ry), r: p.shape === 'box' ? 0 : p.sx / 2 };
      for (const a of mine) if (kit.solidsMeet({ ...a, hx: a.hx + 0.02, hz: a.hz + 0.02 }, q)) return false;
    }
    return true;
  };
  // ...put there if it does (after its draws: what is left out moves nothing else)
  const extra = (b, type, lx, lz, ry = 0, o = {}) => {
    const sd = rng.int(0, 99);
    if (PROPS[type] && (PROPS[type].boxes || PROPS[type].cyls) && !fits(b, type, lx, lz, ry, o.ly ?? 0)) return false;
    if (PROPS[type] && o.ly === undefined && b.open(b.wx(lx, lz), b.wz(lx, lz))) {
      // (out on the ground: not across a bank or a ditch - it would hang in the air at one end)
      const r = Math.hypot(PROPS[type].size[0], PROPS[type].size[2]) / 2;
      const [x, z] = [b.wx(lx, lz), b.wz(lx, lz)];
      const h0 = heightAt(x, z);
      if (Math.abs(h0 - b.y0) > 0.07) return false; // (nor where the ground has left the place's own level)
      if (r > 0.6 && [[r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dz]) => Math.abs(heightAt(x + dx, z + dz) - h0) > (r > 2 ? 0.3 : 0.14))) return false;
    }
    b.prop(type, lx, lz, ry, { seed: sd, ...o, nocollide: !(PROPS[type]?.boxes || PROPS[type]?.cyls) });
    return true;
  };

  // soot up a wall from the windows a fire came out of, and what has grown up it since (ivy needs a wall 5 m high)
  const ivyOn = (b, cx, cz, w, d, y0, h) => {
    const here = rng.chance(0.45);
    const face = rng.int(0, 2); // (never the front: the door is in it)
    const at = rng.range(-0.3, 0.3);
    const sd = rng.int(0, 2);
    if (!here || y0 + h < 5) return;
    if (face === 0) b.prop('ivy', cx + at * (w - 4), cz + d / 2 + 0.04, PI, { nocollide: true, seed: sd, ly: PAVE });
    else b.prop('ivy', cx + (face === 1 ? 1 : -1) * (w / 2 + 0.04), cz + at * (d - 4), face === 1 ? -PI / 2 : PI / 2, { nocollide: true, seed: sd, ly: PAVE });
  };
  // what fell out of a wall, at its foot: lumps and slabs on the pavement (nothing solid: it is walked over)
  const skirt = (b, x, z, ly = PAVE) => {
    b.prop('debris', x, z, rng.range(0, 6), { nocollide: true, ly, seed: rng.int(0, 2) });
    for (let k = rng.int(1, 2); k > 0; k--) b.box(x + rng.range(-1.6, 1.6), ly + rng.range(0, 0.25), z + rng.range(-1, 1), rng.range(1.1, 2.4), 0.2, rng.range(0.9, 1.7), 'concrete', { ry: rng.range(0, 3), rz: rng.range(-0.55, 0.55), rx: rng.range(-0.2, 0.2), collide: false });
  };
  // the stairs up, in a corner of a ground floor: gone under what fell down them
  const stairBlock = (b, x, z) => {
    b.box(x, FLOOR_Y, z, 2.2, 1.5, 1.4, 'concrete');
    b.box(x + 0.2, FLOOR_Y + 1.3, z - 0.1, 2.4, 0.25, 1.6, 'concrete', { rz: 0.3, collide: false });
    b.box(x - 0.5, FLOOR_Y + 1.5, z + 0.2, 0.12, 1.4, 0.12, 'rust', { rz: -0.3, collide: false });
    b.prop('debris', x, z - 1.5, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y });
  };
  // what came down off a lot into the street in front of it: a heap at the kerb (not where the tower's top lies:
  // that stretch has rubble of its own)
  let fallenAt = null; // [x, z] of the middle of the stretch of street the tower fell across
  const streetPile = (b, L, lx) => {
    const [x, z] = [b.wx(lx, -L.d / 2 - 1.3), b.wz(lx, -L.d / 2 - 1.3)];
    const [rx, h] = [rng.range(1.6, 2.4), rng.range(0.8, 1.3)];
    if (fallenAt && Math.abs(x - fallenAt[0]) < 26 && Math.abs(z - fallenAt[1]) < 26) return;
    heap(b, lx, -L.d / 2 - 1.3, rx, 1.2, h, { across: true, brick: 0.5 });
  };
  // what lies along the front of a lot, on the pavement: rubbish, what fell off the building, weeds at the wall's foot
  const frontage = (b, L, F, shop = false) => {
    const z = -L.d / 2 + 0.55;
    for (let k = rng.int(2, 4); k > 0; k--) {
      const r = rng();
      const x = rng.range(-L.w / 2 + 2, L.w / 2 - 2);
      b.prop(r < 0.4 ? 'litter' : r < 0.6 ? 'debris' : r < 0.72 ? 'suitcases' : r < 0.82 ? 'glass_shards' : r < 0.9 ? 'paper_scatter' : 'shopping_cart', x, z + rng.range(-0.2, 0.5), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: (r * 97) | 0 });
    }
    for (let k = rng.int(2, 5); k > 0; k--) weed(b, rng.range(-L.w / 2 + 0.6, L.w / 2 - 0.6), z + rng.range(-0.3, 0.4), rng.range(0.5, 0.9));
    const sign = rng.chance(0.3);
    const sx = rng.range(-3, 3);
    if (shop && sign) b.prop('fallen_sign', sx, z + 0.1, rng.range(-0.3, 0.3), { nocollide: true, ly: PAVE });
    if (shop && F) {
      // (a window boarded up, as often as not)
      const board = rng.chance(0.5);
      const side = rng.chance(0.5) ? 0.3 : -0.3;
      for (let k = 0; k < 4; k++) {
        const tilt = rng.range(-0.12, 0.12);
        if (board) b.box(F.w * side, 0.9 + k * 0.5, F.front - 0.17, Math.min(3.4, F.w * 0.24), 0.2, 0.04, 'planks', { rz: tilt, collide: false });
      }
    }
    if (shop && F && rng.chance(0.6)) b.prop('awning', F.w * (rng.chance(0.5) ? 0.2 : -0.2), F.front - 0.14, 0, { nocollide: true, ly: 2.75, seed: rng.int(0, 1) });
    if (F && rng.chance(0.3)) b.prop('skeleton', rng.range(-L.w / 2 + 2, L.w / 2 - 2), F.front - 0.75, PI, { nocollide: true, ly: PAVE, seed: 1 }); // (sat down against the wall, and stayed)
  };

  // what is behind a building: bins, a pallet, rubbish, and what has come up through the paving
  const yard = (b, F, L) => {
    if (rng.chance(0.6)) b.cont(CONT.DUMPSTER, F.L + 2.2, F.back + 1.6, { prop: 'dumpster', ry: PI, ly: PAVE });
    if (rng.chance(0.5)) b.prop('pallet', F.L + 5.2, F.back + 1.4, rng.range(0, 3), { ly: PAVE });
    const deep = L.d / 2 - F.back;
    if (deep > 4.5 && rng.chance(0.75)) b.tree(rng.range(-L.w / 2 + 2.5, L.w / 2 - 2.5), L.d / 2 - 2.2, [3, 4, 5, 5][rng.int(0, 3)], rng.range(0.6, 1.15));
    if (rng.chance(0.3)) b.prop(rng.chance(0.5) ? 'corpse' : 'skeleton', rng.range(-3, 3), F.back + 3.2, rng.range(0, 6), { nocollide: true, ly: PAVE, seed: rng.int(0, 2) });
    for (let k = rng.int(2, 3); k > 0; k--) b.prop(['litter', 'debris', 'glass_shards', 'bicycle', 'paper_scatter'][rng.int(0, 4)], rng.range(-L.w / 2 + 2, L.w / 2 - 2), F.back + rng.range(1.5, Math.max(1.6, deep - 1.5)), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: rng.int(0, 2) });
    extra(b, 'trash_bin', F.R - 1.2, F.back + 1.1, 0, { ly: PAVE });
    for (let k = rng.int(4, 8); k > 0; k--) weed(b, rng.range(-L.w / 2 + 0.5, L.w / 2 - 0.5), rng.range(F.back + 0.6, L.d / 2 - 0.4), rng.range(0.6, 1.3));
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) weed(b, sx * (L.w / 2 - 0.5), rng.range(F.front, F.back), rng.range(0.6, 1.1)); // (down the alleys)
    frontage(b, L, F, true);
  };
  // The mess a room was left in: rubbish, luggage, chairs kicked over, bones, what came down through the ceiling,
  // blood. None of it solid (it is walked over, and it blocks no door: kinds with no collider); none of it standing
  // in furniture. h: the room's ceiling (lamps hang from it).
  const MESS = ['litter', 'debris', 'paper_scatter', 'suitcases', 'ceiling_debris', 'stock_spill', 'bones', 'litter', 'body_bag', 'blood_pool', 'glass_shards', 'corpse', 'office_chair', 'skeleton', 'rug', 'paper_scatter'];
  // R: the room, if it has partitions (nothing lies through one, no lamp hangs in one)
  const mess = (b, F, n, h = 0, R = null) => {
    for (let k = 0; k < n; k++) {
      const type = MESS[rng.int(0, MESS.length - 1)];
      const x = rng.range(F.L + 1, F.R - 1);
      const z = rng.range(F.front + 1, F.back - 1);
      const ry = rng.range(0, 6);
      const sd = rng.int(0, 3);
      if (propBlocked('table', b.wx(x, z), b.wz(x, z), b.ry + ry) || atPartition(R, x, z, 1.5)) continue;
      b.prop(type, x, z, ry, { nocollide: true, ly: FLOOR_Y, seed: sd });
    }
    for (let k = Math.max(1, Math.round(n / 4)); k > 0; k--) {
      const x = rng.range(F.L + 1.6, F.R - 1.6);
      const z = rng.range(F.front + 1.6, F.back - 1.6);
      const [sx, sz, ry, rz] = [rng.range(1.2, 2.4), rng.range(0.9, 1.6), rng.range(0, 3), rng.range(-0.16, 0.16)];
      const [cx, cz, ch, crz, crx] = [x + rng.range(-1, 1), z + rng.range(-1, 1), rng.range(1.2, 2.2), rng.range(-0.5, 0.5), rng.range(-0.3, 0.3)];
      if (atPartition(R, x, z, 1.5)) continue;
      b.box(x, FLOOR_Y + 0.04, z, sx, 0.12, sz, 'concrete', { ry, rz, collide: false });
      if (!atPartition(R, cx, cz, 0.7)) b.box(cx, FLOOR_Y + 1.2, cz, 0.08, ch, 0.08, 'rust', { rz: crz, rx: crx, collide: false }); // (a conduit hanging out of the ceiling)
    }
    if (h) for (let x = F.L + 3; x < F.R - 2; x += 5.5) for (const z of F.d > 10 ? [F.cz - F.d * 0.22, F.cz + F.d * 0.22] : [F.cz]) {
      const [ry, sd] = [rng.chance(0.5) ? 0 : PI / 2, rng.int(0, 2)];
      if (!atPartition(R, x, z, 0.9)) b.prop('ceiling_lamp', x, z, ry, { nocollide: true, ly: h, seed: sd });
    }
  };
  // ...the same in one room of a partitioned floor, x0..x1 by z0..z1: a few things, clear of its walls
  const HOME_MESS = ['litter', 'paper_scatter', 'suitcases', 'litter', 'glass_shards', 'bones', 'ceiling_debris', 'paper_scatter', 'blood_pool', 'debris'];
  const messIn = (b, x0, z0, x1, z1, n, lampAt = 0) => {
    const [xa, xb, za, zb] = [Math.min(x0, x1) + 0.9, Math.max(x0, x1) - 0.9, Math.min(z0, z1) + 0.9, Math.max(z0, z1) - 0.9];
    for (let k = 0; k < n; k++) {
      const type = HOME_MESS[rng.int(0, HOME_MESS.length - 1)];
      const [x, z, ry, sd] = [rng.range(xa, Math.max(xa, xb)), rng.range(za, Math.max(za, zb)), rng.range(0, 6), rng.int(0, 3)];
      if (xb - xa < 0.6 || zb - za < 0.6 || type === 'ceiling_debris' && Math.min(xb - xa, zb - za) < 1.4) continue;
      b.prop(type, x, z, ry, { nocollide: true, ly: FLOOR_Y, seed: sd });
    }
    if (lampAt) b.prop('ceiling_lamp', (x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 0 : PI / 2, { nocollide: true, ly: lampAt, seed: rng.int(0, 2) });
  };
  // ---- A flat. The ground floor of a block of flats is homes: off the common hall, between its wall (x = xh) and
  // the wall the flat shares with next door or with the street's side (x = xo), two rows of rooms, front to back -
  // by the far wall a living room on the street, the kitchen behind it and a bedroom at the back; by the hall a
  // small room on the street, the flat's own passage, which every door of it opens off, and the bathroom. Each is
  // painted its own way and has what was in it. o.stairs: the small front room is the block's stair well, open to
  // the hall, under what came down it. o.keep: what is searched in it ('fridge', 'cabinet', 'locker', 'duffel').
  const FLAT_CEIL = 2.7; // a home's ceiling (the slab is over it)
  const flatUnit = (b, R, F, xh, xo, o = {}) => {
    const sg = xo > xh ? 1 : -1;
    const W = Math.abs(xo - xh);
    const X = (u) => xh + sg * u;
    const Z = (v) => F.front + v;
    const C = 3.5; // (the wall between the two rows)
    const H = R.h;
    const rO = sg > 0 ? PI / 2 : -PI / 2; // (turned to stand against a wall on the far side of it, facing the room; rH: on the hall's)
    const rH = -rO;
    // its walls
    if (o.stairs) {
      partition(b, R, X(0), Z(3.5), X(0), F.back, H, 'concrete', [door(3.7, 1.3)]);
      partition(b, R, X(0), Z(3.5), X(C), Z(3.5), H, 'concrete');
      stairBlock(b, X(1.95), Z(2.6));
    } else {
      partition(b, R, X(0), F.front, X(0), F.back, H, 'concrete', [door(7.2, 1.3)]);
      partition(b, R, X(0), Z(3.5), X(C), Z(3.5), H, 'concrete', [door(1.75, 1.2)]);
    }
    partition(b, R, X(C), F.front, X(C), F.back, H, 'concrete', [door(4.35, 1.2), door(7.2, 1.2), door(10.05, 1.2)]);
    partition(b, R, X(C), Z(5.2), xo, Z(5.2), H, 'concrete');
    partition(b, R, X(C), Z(9.2), xo, Z(9.2), H, 'concrete');
    partition(b, R, X(0), Z(10.9), X(C), Z(10.9), H, 'concrete', [door(1.75, 1.2)]);
    // its rooms: each its own paint; tile in the kitchen and the bathroom
    const paint = () => rng.int(0, 5);
    if (!o.stairs) zone(R, X(0), Z(0), X(C), Z(3.5), paint());
    zone(R, X(0), Z(3.5), X(C), Z(10.9), paint());
    zone(R, X(0), Z(10.9), X(C), Z(14), paint());
    zone(R, X(C), Z(0), xo, Z(5.2), paint());
    zone(R, X(C), Z(5.2), xo, Z(9.2), paint());
    zone(R, X(C), Z(9.2), xo, Z(14), paint());
    lino(R, X(C), Z(5.2), xo, Z(9.2), rng.int(0, 5));
    lino(R, X(0), Z(10.9), X(C), Z(14), rng.int(0, 5));
    const keep = o.keep || '';
    // the living room: a sofa and the set it faced, an armchair, shelves
    b.prop('sofa', X(5.75), Z(4.5), 0, { ly: FLOOR_Y, seed: rng.int(0, 2) });
    extra(b, 'tv_set', X(5.9), Z(0.46), PI, inside);
    extra(b, 'armchair', X(W - 0.72), Z(2.3), rO, inside);
    extra(b, 'bookshelf', X(C + 0.62), Z(1.3), rH, inside);
    b.prop('rug', X(5.8), Z(2.5), rng.range(-0.2, 0.2), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    // the kitchen: units and the stove along the far wall, the table they ate at, the fridge
    extra(b, 'kitchen_counter', X(W - 0.52), Z(6.6), rO, inside);
    extra(b, 'stove', X(W - 0.54), Z(8.2), rO, inside);
    b.prop('kitchen_table', X(5.4), Z(7.3), rng.range(-0.15, 0.15), inside);
    b.loot(X(5.4), Z(7.3), FLOOR_Y + 0.87);
    for (const [du, dv, r] of [[0, -0.75, 0], [0.1, 0.8, PI]]) b.prop('chair', X(5.4 + du), Z(7.3 + dv), r + rng.range(-0.5, 0.5), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    if (keep.includes('fridge')) cont(b, CONT.FRIDGE, 'fridge', X(4.3), Z(8.68), 0);
    // the bedroom: a bed made up for two, a wardrobe, a chest of drawers
    b.prop('double_bed', X(W - 1.25), Z(12.78), 0, inside);
    extra(b, 'wardrobe', X(5.9), Z(9.68), PI, inside);
    extra(b, 'dresser', X(C + 0.62), Z(12.6), rH, inside);
    if (keep.includes('cabinet')) cont(b, CONT.CABINET, 'cabinet', X(5.0), Z(13.52), 0);
    b.prop('rug', X(5.2), Z(11.4), PI / 2 + rng.range(-0.2, 0.2), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    // the small room on the street: somebody's - a bed, a table under the window
    if (!o.stairs) {
      b.prop('bed', X(0.68), Z(1.42), 0, { ly: FLOOR_Y, seed: rng.int(0, 1) });
      extra(b, 'table', X(C - 0.62), Z(1.25), rO, inside);
      b.prop('chair', X(2.0), Z(1.3), rO + rng.range(-0.4, 0.4), { nocollide: true, ly: FLOOR_Y });
      b.loot(X(1.75), Z(2.55), FLOOR_Y + 0.02);
    } else b.loot(X(W - 2.9), Z(11.2), FLOOR_Y + 0.02);
    // the passage: a chest against the hall's wall, what was dropped on the way out
    extra(b, 'dresser', X(0.62), Z(5.3), rH, inside);
    if (keep.includes('locker')) cont(b, CONT.LOCKER, 'locker', X(0.42), Z(9.3), rH);
    if (keep.includes('duffel')) b.cont(CONT.DUFFEL, X(2.3), Z(8.9), { prop: 'duffel_bag', ry: 0.8, nocollide: true, ly: FLOOR_Y });
    b.prop('rug', X(1.75), Z(7.2), PI / 2, { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    // the bathroom
    extra(b, 'bathtub', X(0.58), Z(12.95), 0, inside);
    extra(b, 'toilet', X(2.6), Z(13.45), 0, inside);
    // what the years left on its floors; a lamp over each of the rooms that were lived in
    messIn(b, X(C), Z(0), xo, Z(5.2), 2, FLAT_CEIL);
    messIn(b, X(C), Z(5.2), xo, Z(9.2), 1, FLAT_CEIL);
    messIn(b, X(C), Z(9.2), xo, Z(14), 2, FLAT_CEIL);
    messIn(b, X(0), Z(3.5), X(C), Z(10.9), 2);
  };
  // rows of shelving down the middle of a shop's floor, what they held swept off them, clear of its counter and doors
  const aisles = (b, F) => {
    for (const dx of [4.2, 7.4, 10.6, 13.6]) {
      if (F.L + dx > F.R - 4.4) continue;
      extra(b, 'shop_gondola', F.L + dx, F.cz + 1.2, PI / 2, inside);
      extra(b, 'shop_gondola', F.L + dx, F.cz - 2.2, PI / 2, { ly: FLOOR_Y, seed: 1 });
      b.prop('stock_spill', F.L + dx + rng.range(-0.3, 1.4), F.cz + rng.range(-1.6, 2.2), rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    }
  };
  // a shop's counter: the till on it, what is searched for on its top
  const counter = (b, x, z, ry = 0) => {
    b.prop('checkout_counter', x, z, ry, inside);
    b.loot(x, z, FLOOR_Y + 0.98);
  };
  // what is in a shop, by what it sold. Each fills a room of any width from 12 m up, clear of its two doors.
  const FILL = {
    grocery(b, F) {
      counter(b, F.L + 3, F.front + 3.2);
      for (const dx of [1.6, 3.9, 6.2]) cont(b, CONT.SHELF, 'shelf', F.L + dx, backZ(F, 0.5), 0);
      cont(b, CONT.SHELF, 'shelf', F.R - 4.6, F.cz + 0.4, PI / 2);
      cont(b, CONT.FRIDGE, 'fridge', rightX(F, 0.72), F.cz - 0.2, PI / 2);
      b.loot(F.R - 3, F.cz - 2.4, FLOOR_Y + 0.02);
      aisles(b, F);
      extra(b, 'display_fridge', rightX(F, 0.75), F.cz + 2.2, PI / 2, inside);
      extra(b, 'display_fridge', rightX(F, 0.75), F.cz - 2.4, PI / 2, { ly: FLOOR_Y, seed: 1 });
      extra(b, 'vending_machine', leftX(F, 0.86), F.cz - 0.4, -PI / 2, inside);
      b.prop('shopping_cart', F.R - 2.6, F.front + 2, 0.7, { nocollide: true, ly: FLOOR_Y });
    },
    pharmacy(b, F) {
      counter(b, F.L + 4.2, F.cz + 0.4);
      for (const dx of [1.2, 2.3]) cont(b, CONT.MEDICINE, 'medicine_cabinet', F.L + dx, backZ(F, 0.45), 0);
      cont(b, CONT.CABINET, 'cabinet', F.L + 4.2, backZ(F, 0.55), 0);
      cont(b, CONT.SHELF, 'shelf', rightX(F, 0.5), F.cz - 1.4, PI / 2);
      b.prop('wheelchair', F.L + 1.6, F.front + 2.2, 0.6, { nocollide: true, ly: FLOOR_Y });
      b.loot(F.R - 2.4, F.cz + 1.6, FLOOR_Y + 0.02);
      extra(b, 'shop_gondola', F.R - 5.4, F.cz - 2.4, 0, inside);
      extra(b, 'waiting_chairs', F.R - 2.2, F.front + WALL + 0.4, PI, inside);
      b.prop('stock_spill', F.R - 4.4, F.cz - 0.6, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    },
    hardware(b, F) {
      counter(b, F.L + 3, F.front + 3.4);
      b.cont(CONT.TOOLBOX, F.L + 3.6, F.front + 3.4, { prop: 'toolbox', ry: 0.3, nocollide: true, ly: FLOOR_Y + 0.96 });
      for (const dx of [1.6, 3.9]) cont(b, CONT.SHELF, 'shelf', F.L + dx, backZ(F, 0.5), 0);
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
      b.box(F.L + 1.2 + len / 2, FLOOR_Y + 1.05, F.cz + 2.2, len + 0.1, 0.05, 0.86, 'metal', { collide: false });
      b.loot(F.L + 2.4, F.cz + 2.2, FLOOR_Y + 1.12);
      cont(b, CONT.FRIDGE, 'fridge', F.L + 1.1, backZ(F, 0.72), 0);
      cont(b, CONT.CABINET, 'cabinet', F.L + 2.8, backZ(F, 0.55), 0);
      extra(b, 'stove', F.L + 4.4, backZ(F, 0.66), 0, inside);
      extra(b, 'kitchen_counter', F.L + 6.2, backZ(F, 0.63), 0, inside);
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
      extra(b, 'vending_machine', rightX(F, 0.86), F.cz + 1.2, PI / 2, inside);
    },
    // Calder Aero Supply: where the plane's magneto is
    aero(b, F) {
      FILL.hardware(b, F);
      part(b, 1, F.R - 1.4, F.cz - 0.6, FLOOR_Y + 0.02);
    },
  };
  // the shops of a street: [what it sells (a FILL), its wall, the board over its door]
  const SHOP = {
    grocery: ['grocery', 'brick', 'shop_grocery'],
    pharmacy: ['pharmacy', 'plaster', 'shop_pharmacy'],
    hardware: ['hardware', 'brick', 'shop_hardware'],
    diner: ['diner', 'plaster', 'shop_diner'],
    aero: ['aero', 'brick', 'shop_aero'],
    liquor: ['grocery', 'brick', 'shop_liquor'],
    pawn: ['hardware', 'plaster', 'shop_pawn'],
    laundry: ['pharmacy', 'plaster', 'shop_laundry'],
    bakery: ['diner', 'brick', 'shop_bakery'],
    bar: ['diner', 'brick', 'shop_bar'],
    books: ['hardware', 'plaster', 'shop_books'],
  };
  const TERRACE = ['grocery', 'liquor', 'laundry', 'bakery', 'bar', 'books', 'pawn', 'diner', 'hardware'];
  // A shop's room: a glass front with the door in the middle of it, a yard door at the back's right-hand end. x0:
  // where its middle is along the lot (a terrace has three). Returns its builder, its frame and what was said of it.
  const shopRoom = (b, L, w, d, kind, x0 = 0, alone = true) => {
    const [, mat, sign] = SHOP[kind];
    const s = b.sub(x0, 0);
    const F = frame(L, w, d);
    const ww = Math.min(3, w * 0.22);
    // (a shop on a lot of its own may have had a wall blown in: one more way through it)
    const breach = alone && rng.chance(0.4);
    const R = groundRoom(s, 0, F.cz, w, d, 3.8, mat === 'plaster' ? 'concrete' : mat, { n: [door(w / 2, 1.6), cw(w * 0.2, ww, 0.8, 2.8), cw(w * 0.8, ww, 0.8, 2.8)], s: [door(2.4, 1.1)], w: breach ? [gap(d * 0.72, 2.6, 2.9)] : [] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, sign });
    // (the stock room behind: a door into it, and the wall down at its other end - the way to the yard door)
    partition(s, R, F.L, F.cz + 4.2, F.R, F.cz + 4.2, 3.8, 'concrete', [door(w * 0.3, 1.3), gap(w - 2.6, 2.2, 2.7)]);
    // (...and between the two, behind a door off the stock room: the office of a shop on a lot of its own, a
    // closet where three share a roof)
    const [ox0, ox1] = [F.L + 7.7, F.R - 3.9];
    partition(s, R, ox0, F.cz + 4.2, ox0, F.back, 3.8, 'concrete', [door(1.27, 1.2)]);
    partition(s, R, ox1, F.cz + 4.2, ox1, F.back, 3.8, 'concrete');
    zone(R, F.L, F.cz + 4.2, ox0, F.back, 5);
    zone(R, ox0, F.cz + 4.2, ox1, F.back, rng.int(0, 4));
    if (alone) {
      extra(s, 'office_desk', (ox0 + ox1) / 2 + 0.6, backZ(F, 0.8), 0, inside);
      s.prop('office_chair', (ox0 + ox1) / 2 + 0.5, F.back - 1.5, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 1) });
      extra(s, 'filing_cabinet', ox1 - 0.09 - 0.06 - 0.3, F.back - WALL - 0.62, 0, inside);
      s.prop('paper_scatter', (ox0 + ox1) / 2, F.cz + 5.4, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    } else extra(s, 'toilet', ox1 - 0.09 - 0.06 - 0.26, F.back - WALL - 0.36, 0, inside);
    if (breach) {
      s.prop('debris', F.L + 1.2, F.cz + d * 0.22, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y });
      skirt(s, F.L - 1.2, F.cz + d * 0.22);
    }
    s.prop('glass_shards', -w * 0.3, F.front + 0.9, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    s.prop('litter', rng.range(-2, 2), F.cz - 1.5, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    // (after what the shop is furnished with: what was left lies round that - and here and there somebody has kept a
    // fire in a drum on the shop floor since)
    s.mess = () => {
      const fire = alone && rng.chance(0.3);
      if (fire && fits(s, 'barrel', F.R - 3.2, F.front + 4.6, 0, FLOOR_Y)) drumFire(s, F.R - 3.2, F.front + 4.6);
      // (more shelving down the side wall - not across a wall that was blown in)
      if (!breach) extra(s, 'shelf', leftX(F, 0.5), F.cz - 3.6, -PI / 2, inside);
      if (!breach) extra(s, 'shelf', leftX(F, 0.5), F.cz + 1.9, -PI / 2, { ly: FLOOR_Y, seed: 1 });
      mess(s, { ...F, back: F.cz + 4.2 }, alone ? 9 : 6, 3.8, R);
    };
    return [s, F, mat];
  };
  // how a building has come through it: [lost, open] for block() - most have lost a storey or two off the top, one
  // in four has an end fallen away
  const ruinOf = (floors) => {
    const r = rng();
    const lost = r < 0.3 ? 0 : rng.int(1, Math.min(3, floors - 1));
    const open = rng.chance(0.24) && floors > 2 ? (rng.chance(0.5) ? 1 : -1) : 0;
    return { lost, open, from: rng.int(0, 1), top: !lost && rng.chance(0.25) ? 'slab' : undefined };
  };
  const BUILD = {
    shop(b, L, kind) {
      const [s, F, mat] = shopRoom(b, L, 18.4, 13.5, kind);
      FILL[SHOP[kind][0]](s, F);
      s.mess();
      const floors = rng.int(1, 4);
      block(b, 0, F.cz, F.w, F.d, 4.1, floors, 3, 'shopflat', mat, { ...ruinOf(floors), blank: rng.chance(0.5) ? 2 : rng.chance(0.5) ? 8 : 0 }); // (flats over the shop: shut, as every upper floor is)
      ivyOn(b, 0, F.cz, F.w, F.d, 0, 4.1 + floors * 3);
      yard(b, F, L);
    },
    // a row of three shops under one roof
    terrace(b, L) {
      const F = frame(L, 41.1, 13.5);
      const U = F.w / 3;
      const k0 = rng.int(0, TERRACE.length - 1);
      const floors = rng.int(1, 3);
      const mat = rng.chance(0.5) ? 'brick' : 'plaster';
      block(b, 0, F.cz, F.w, F.d, 4.1, floors, 3, 'shopflat', mat, ruinOf(floors));
      for (let k = 0; k < 3; k++) {
        const kind = TERRACE[(k0 + k * 2) % TERRACE.length];
        const [s, Fu] = shopRoom(b, L, U, 13.5, kind, (k - 1) * U, false);
        FILL[SHOP[kind][0]](s, Fu);
        s.mess();
      }
      yard(b, F, L);
      b.wreck(rng.chance(0.5) ? 'car_wreck' : 'car_burnt', F.R - 6, F.back + 3.4, PI / 2 + rng.range(-0.2, 0.2), { ly: PAVE, trunk: rng.chance(0.5) });
    },
    // the police station: a front office, the cells, and behind a door the armoury
    police(b, L) {
      const F = frame(L, 18.4, 13.5);
      block(b, 0, F.cz, F.w, F.d, 3.9, rng.int(1, 2), 3, 'walkup', 'brick', { lost: 0, wear: 0.5 });
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 3.6, 'brick', { n: [door(F.w / 2, 1.5), win(F.w * 0.2, 1.6), win(F.w * 0.8, 1.6)], s: [door(2.4, 1.1)], w: [win(F.d * 0.7, 1.2, 1.5, 2.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, sign: 'police', tint: 2 });
      partition(b, R, F.L, F.cz + 1.5, F.R, F.cz + 1.5, 3.6, 'brick', [door(4, 1.2)]);
      // (behind it: the cells' own room, the armoury behind a door of its own, the back office by the yard door)
      partition(b, R, -2.6, F.cz + 1.5, -2.6, F.back, 3.6, 'brick', [door(1.5, 1.2)]);
      partition(b, R, 4, F.cz + 1.5, 4, F.back, 3.6, 'brick', [door(1.5, 1.2)]);
      zone(R, F.L, F.cz + 1.5, -2.6, F.back, 5);
      zone(R, -2.6, F.cz + 1.5, 4, F.back, 0);
      zone(R, 4, F.cz + 1.5, F.R, F.back, 3);
      extra(b, 'locker', 0.3, F.cz + 1.5 + 0.09 + 0.06 + 0.26, PI, inside);
      extra(b, 'locker', 1.4, F.cz + 1.5 + 0.09 + 0.06 + 0.26, PI, { ly: FLOOR_Y, seed: 1 });
      extra(b, 'office_desk', rightX(F, 0.8) - 0.05, F.cz + 3.7, PI / 2, inside);
      b.prop('office_chair', F.R - 1.9, F.cz + 3.6, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 1) });
      b.prop('paper_scatter', 6.4, F.cz + 4.4, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
      drumFire(b, F.L + 0.9, F.cz - 1.3);
      b.prop('reception_desk', 3.4, F.cz - 1.4, 0, { ly: FLOOR_Y, seed: 1 }); // the front desk
      b.loot(3.4, F.cz - 1.4, FLOOR_Y + 1.14);
      cont(b, CONT.CABINET, 'cabinet', rightX(F, 0.55), F.cz - 3.4, PI / 2);
      for (const dz of [2.25, 3.25]) cont(b, CONT.LOCKER, 'locker', leftX(F, 0.5), F.cz + dz, -PI / 2, { seed: dz | 0 });
      cont(b, CONT.AMMO_BOX, 'military_crate', -1, backZ(F, 0.8), 0);
      cont(b, CONT.AMMO_BOX, 'military_crate', 1.6, backZ(F, 0.8), 0, { seed: 1 });
      b.loot(-4.4, F.cz + 3.2, FLOOR_Y + 0.02);
      b.prop('sandbags', -4.5, F.front - 0.55, 0, { ly: PAVE });
      b.prop('table', -5, F.cz - 3.6, 0.1, inside);
      b.prop('chair', -5, F.cz - 2.6, 3, { nocollide: true, ly: FLOOR_Y });
      // the cell, in the back room's corner: its door standing open, whoever was in it still there
      b.prop('cell_bars', F.L + 0.125 + 1.5, F.cz + 4.2, 0, inside);
      partition(b, R, F.L + 3.2, F.cz + 4.2, F.L + 3.2, F.back, 3.6, 'brick');
      b.prop('cell_bunk', F.L + 0.125 + 0.42, F.back - WALL - 1.0, 0, inside);
      b.prop('skeleton', F.L + 2.3, F.back - 0.9, PI, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      extra(b, 'waiting_chairs', -6.6, F.front + WALL + 0.34, PI, inside);
      extra(b, 'filing_cabinet', F.R - 1.6, F.cz + 1.5 - 0.09 - WALL - 0.6, PI, inside);
      extra(b, 'office_desk', 6.4, F.cz - 3.8, PI, inside);
      mess(b, F, 9, 3.6, R);
      yard(b, F, L);
      signAt(b, F.L + 0.9, 3.0, F.front - 0.5, PI / 2, 1.0, 0.25, 'police', { back: 0.1, two: true });
    },
    // flats over a ground floor that can be walked into: the common hall from the street door to the yard door, the
    // stairs up off it, and a flat either side of it (flatUnit: six rooms each, a home's size and a home's ceiling)
    flats(b, L) {
      const F = frame(L, 18.4, 14);
      const mat = rng.chance(0.55) ? 'brick' : rng.chance(0.5) ? 'concrete' : 'plaster';
      const HW = 1.2; // (half the hall)
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 3.2, mat === 'plaster' ? 'concrete' : mat, { n: [door(F.w / 2, 1.4), cw(2.1, 1.6), cw(6.25, 1.2), cw(12.15, 1.2), cw(16.3, 1.6)], s: [door(F.w / 2, 1.1), cw(2.1, 1.4), cw(16.3, 1.4), hole(6.25, 0.8, 1.5, 2.1), hole(12.15, 0.8, 1.5, 2.1)], e: [cw(7.2, 1.4)], w: [cw(F.d - 7.2, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks', boards: true, ceiling: 'plaster', ceil: FLAT_CEIL, homely: true });
      zone(R, -HW, F.front, HW, F.back, 5);
      const duffel = rng.chance(0.4);
      flatUnit(b, R, F, -HW, F.L, { keep: 'fridge' });
      flatUnit(b, R, F, HW, F.R, { stairs: true, keep: duffel ? 'cabinet duffel' : 'cabinet' });
      const floors = rng.int(3, 6);
      block(b, 0, F.cz, F.w, F.d, 3.5, floors, 3, mat === 'concrete' ? 'slab' : mat === 'plaster' ? 'shopflat' : 'walkup', mat, { ...ruinOf(floors), blank: rng.chance(0.4) ? (rng.chance(0.5) ? 2 : 8) : 0 });
      ivyOn(b, 0, F.cz, F.w, F.d, 0, 3.5 + floors * 3);
      // the hall: what was left in it on the way out, the post nobody collected
      for (const [lz, type] of [[2.2, 'paper_scatter'], [6.4, 'litter'], [10.6, 'suitcases']]) b.prop(type, rng.range(-0.4, 0.4), F.front + lz, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
      yard(b, F, L);
    },
    // a long block of flats: two halls, each with its stairs, and four flats on the ground floor
    block(b, L) {
      const F = frame(L, 41, 14);
      const mat = rng.chance(0.5) ? 'brick' : 'concrete';
      const HW = 1.2;
      const HX = F.w / 4; // (a hall's middle, either side of the block's)
      const at = (x) => x + F.w / 2; // (along the front wall; the back wall runs the other way)
      const back = (x) => F.w / 2 - x;
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 3.2, mat, {
        n: [door(at(-HX), 1.4), door(at(HX), 1.4), ...[-HX - HW - 5.9, -HX + HW + 5.9, HX - HW - 5.9, HX + HW + 5.9].map((x) => cw(at(x), 1.6)), ...[-HX - HW - 1.75, -HX + HW + 1.75, HX - HW - 1.75, HX + HW + 1.75].map((x) => cw(at(x), 1.2))],
        s: [door(back(-HX), 1.1), door(back(HX), 1.1), ...[-HX - HW - 5.9, -HX + HW + 5.9, HX - HW - 5.9, HX + HW + 5.9].map((x) => cw(back(x), 1.4)), ...[-HX - HW - 1.75, -HX + HW + 1.75, HX - HW - 1.75, HX + HW + 1.75].map((x) => hole(back(x), 0.8, 1.5, 2.1))],
        e: [cw(7.2, 1.4)],
        w: [cw(F.d - 7.2, 1.4)],
      }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks', boards: true, ceiling: 'plaster', ceil: FLAT_CEIL, homely: true });
      partition(b, R, 0, F.front, 0, F.back, 3.2, 'concrete'); // (the wall between the two stairs' flats)
      for (const sx of [-1, 1]) zone(R, sx * HX - HW, F.front, sx * HX + HW, F.back, 5);
      flatUnit(b, R, F, -HX - HW, F.L, { keep: 'cabinet' });
      flatUnit(b, R, F, -HX + HW, 0, { stairs: true, keep: 'fridge' });
      flatUnit(b, R, F, HX - HW, 0, { stairs: true, keep: 'locker' });
      flatUnit(b, R, F, HX + HW, F.R, { keep: 'fridge duffel' });
      const floors = rng.int(3, 6);
      block(b, 0, F.cz, F.w, F.d, 3.5, floors, 3, mat === 'concrete' ? 'slab' : 'walkup', mat, ruinOf(floors));
      ivyOn(b, 0, F.cz, F.w, F.d, 0, 3.5 + floors * 3);
      for (const sx of [-1, 1]) for (const [lz, type] of [[2.4, 'litter'], [9.6, 'paper_scatter']]) b.prop(type, sx * HX + rng.range(-0.4, 0.4), F.front + lz, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
      yard(b, F, L);
    },
    // an office tower. big: on a lot of its own, the tallest thing for a mile; otherwise a small one on a street lot.
    // fell: its shaft came down across the street (the streets put it there): what stands is its podium, and a stump
    tower(b, L, big) {
      const F = big ? frame(L, 34, 30) : frame(L, 18.4, 15);
      const h = big ? 4.4 : 3.8;
      const fh = big ? 3.3 : 3.2;
      const floors = big ? rng.int(8, 12) : rng.int(5, 7);
      const glassy = rng.chance(big ? 0.5 : 0.35);
      const R = groundRoom(b, 0, F.cz, F.w, F.d, h, 'concrete', { n: [door(F.w / 2, 1.7), win(F.w * 0.22, F.w * 0.17, 0.6, h - 0.8), win(F.w * 0.78, F.w * 0.17, 0.6, h - 0.8)], s: [door(3, 1.2)], e: [win(F.d / 2, F.d * 0.3, 0.6, h - 0.8)], w: [win(F.d / 2, F.d * 0.3, 0.6, h - 0.8)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, tint: 3 });
      // the core, with the lifts nobody will ride again, and the front desk
      const core = big ? 5 : 3;
      b.box(-F.w / 6, FLOOR_Y, F.cz + F.d / 6, core, h - FLOOR_Y, core, 'concrete');
      // Behind the lobby the floor is offices: a wall across it beside the core, the rooms behind that - the open
      // office with its desks, the one behind it, and at the back of the core the post room - each through a door.
      const [cl, cr, cb] = [-F.w / 6 - core / 2, -F.w / 6 + core / 2, F.cz + F.d / 6 + core / 2]; // (the core's left, right and back)
      if (big) {
        const [wx, wz, wz2] = [1.2, F.cz + 1.2, F.cz + 8.3];
        partition(b, R, wx, wz, F.R, wz, h, 'concrete', [door(3, 1.3), door(12, 1.3)]);
        partition(b, R, wx, wz, wx, F.back, h, 'concrete', [door(9.5, 1.3)]);
        partition(b, R, wx, wz2, F.R, wz2, h, 'concrete', [door(11, 1.3)]);
        partition(b, R, F.L, cb, cl, cb, h, 'concrete', [door(4, 1.3)]);
        partition(b, R, cr, cb, wx, cb, h, 'concrete', [door(2.2, 1.3)]);
        zone(R, wx, wz, F.R, wz2, 2);
        zone(R, wx, wz2, F.R, F.back, 4);
        zone(R, F.L, cb, wx, F.back, 1);
        for (const [dx, dz, r] of [[12.6, 3.4, PI], [12.6, 6.4, 0], [4.2, 3.4, PI], [11.4, 11.2, PI], [13.6, 13.6, 0]]) {
          extra(b, 'office_desk', dx, F.cz + dz, r, inside);
          b.prop('office_chair', dx + rng.range(-0.5, 0.5), F.cz + dz + (r ? -1 : 1) * 1.05, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 1) });
        }
        extra(b, 'filing_cabinet', wx + 0.09 + 0.06 + 0.62, F.cz + 4.4, -PI / 2, inside);
        extra(b, 'filing_cabinet', wx + 0.09 + 0.06 + 0.62, F.cz + 12.6, -PI / 2, { ly: FLOOR_Y, seed: 1 });
        extra(b, 'bookshelf', -9.4, backZ(F, 0.9), 0, inside);
        extra(b, 'office_desk', -5, F.cz + 11.4, 0, inside);
        drumFire(b, 4.4, F.cz - 9.6); // (in the lobby, where somebody waited out a night)
      } else {
        const [wx, wz] = [1.6, F.cz - 0.9];
        partition(b, R, wx, wz, F.R, wz, h, 'concrete', [door(2.5, 1.3)]);
        partition(b, R, wx, wz, wx, F.back, h, 'concrete', [door(6.9, 1.3)]);
        partition(b, R, F.L, cb, cl, cb, h, 'concrete', [door(2.3, 1.3)]);
        partition(b, R, cr, cb, wx, cb, h, 'concrete');
        zone(R, wx, wz, F.R, F.back, 2);
        zone(R, F.L, cb, wx, F.back, 1);
        extra(b, 'filing_cabinet', -0.4, F.back - WALL - 0.62, 0, inside);
      }
      b.prop('reception_desk', F.w / 4, F.cz - F.d / 5, 0, inside);
      b.loot(F.w / 4, F.cz - F.d / 5, FLOOR_Y + 1.14);
      cont(b, CONT.CABINET, 'cabinet', rightX(F, 0.55), F.cz + F.d / 5, PI / 2);
      cont(b, CONT.LOCKER, 'locker', leftX(F, 0.5), F.cz + F.d / 2 - 2.4, -PI / 2);
      b.loot(F.L + 2, F.cz - F.d / 4, FLOOR_Y + 0.02);
      if (big) {
        cont(b, CONT.CABINET, 'cabinet', F.L + 6, backZ(F, 0.55), 0, { seed: 1 });
        b.cont(CONT.DUFFEL, 3, F.cz + 6, { prop: 'duffel_bag', ry: 0.4, nocollide: true, ly: FLOOR_Y });
        b.loot(6, F.cz + 8, FLOOR_Y + 0.02);
      }
      // the lobby: seats along the front, desks behind the lifts, what was in the drawers all over the floor
      extra(b, 'waiting_chairs', F.L + 3.2, F.front + WALL + 0.34, PI, inside);
      extra(b, 'waiting_chairs', F.L + 5.4, F.front + WALL + 0.34, PI, inside);
      extra(b, 'vending_machine', leftX(F, 0.86), F.cz - 1, -PI / 2, inside);
      for (const [dx, dz] of big ? [[6, 6], [9.4, 6], [6, 10], [-10, -4]] : [[4.4, 3.4], [6.4, 0.4]]) {
        extra(b, 'office_desk', dx, F.cz + dz, rng.chance(0.5) ? 0 : PI, inside);
        b.prop('office_chair', dx + rng.range(-0.6, 0.6), F.cz + dz + 1.1, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 1) });
      }
      extra(b, 'filing_cabinet', rightX(F, 0.66), F.cz - F.d / 4, PI / 2, inside);
      extra(b, 'filing_cabinet', rightX(F, 0.66), F.cz - F.d / 4 - 0.7, PI / 2, inside);
      for (let k = big ? 5 : 2; k > 0; k--) b.prop('paper_scatter', rng.range(F.L + 2, F.R - 2), rng.range(F.front + 2, F.back - 2), rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
      mess(b, F, big ? 22 : 9, h, R);
      if (L.fell) {
        // the podium, its top storeys open to the sky; on it the stump of the shaft that went
        const top = block(b, 0, F.cz, F.w, F.d, h + 0.3, 4, fh, glassy ? 'glass' : 'office', 'concrete', { top: 'slab', wear: 0.9 });
        block(b, 0, F.cz, 16, 14, top, 3, fh, glassy ? 'glass' : 'office', 'concrete', { lost: 2, wear: 1 });
        L.shaft = { style: glassy ? 'glass' : 'office', fh };
      } else block(b, 0, F.cz, F.w, F.d, h + 0.3, floors, fh, glassy ? 'glass' : 'office', 'concrete', { lost: rng.int(big ? 1 : 0, 3), open: rng.chance(0.3) ? (rng.chance(0.5) ? 1 : -1) : 0, from: rng.int(2, 4) });
      stairBlock(b, -F.w / 6 + core / 2 + 1.4, F.cz + F.d / 6);
      if (big) landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: ['Calder Trust Tower', 'Harbour House', 'Meridian Assurance', 'Dockside Exchange', 'Pacific & Northern', 'Customs House'][towers++ % 6] });
      if (!big) return yard(b, F, L);
      // the plaza behind it: planters gone to dead wood, a shelter, the cars of people who never came down
      for (const tx of [-14, -5, 5, 14]) b.tree(tx, L.d / 2 - 3.4, rng.chance(0.5) ? 3 : 4, rng.range(0.9, 1.2));
      b.prop('bus_shelter', -15.5, F.back + 5, PI / 2, { ly: PAVE });
      b.wreck('car_wreck', 8, F.back + 5.5, PI / 2 + 0.2, { ly: PAVE });
      // (not down the flanks of the one whose shaft fell: it lies there)
      if (!L.fell) b.wreck('car_burnt', F.R + 2.2, F.cz + 3, 0.1, { ly: PAVE, trunk: false });
      if (!L.fell) b.cont(CONT.DUMPSTER, F.L - 1.8, F.cz - 4, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      b.loot(0, F.back + 4, PAVE + 0.02);
      for (const [bx, bz] of [[-9, F.back + 2.2], [2, F.back + 2.2]]) extra(b, 'street_bench', bx, bz, PI, { ly: PAVE });
      extra(b, 'trash_bin', -4, F.back + 2.0, 0, { ly: PAVE });
      for (let k = 0; k < 9; k++) weed(b, rng.range(-19, 19), rng.range(F.back + 0.5, L.d / 2 - 0.5), rng.range(0.6, 1.3));
      for (let k = 0; k < 4; k++) b.prop(['litter', 'paper_scatter', 'glass_shards', 'debris'][k], rng.range(-16, 16), F.front - rng.range(0.4, 1), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: k });
    },
    // a block that came down: the walls of two sides of it stand, storeys high with the sky in their windows; the
    // rest is heaps, one of them at the kerb
    ruin(b, L) {
      const w = Math.min(L.w - 3, 16);
      const d = 13;
      const cz = -L.d / 2 + SETBACK + d / 2;
      b.prop('debris', -3.5, cz - 1, 2, { nocollide: true, ly: PAVE });
      b.prop('debris', 5, cz + 5.5, 0.5, { nocollide: true, ly: PAVE, seed: 1 });
      b.tree(-4.6, cz + 3.4, 5, rng.range(0.5, 0.8));
      for (let k = 0; k < 9; k++) weed(b, rng.range(-9, 9), rng.range(-8, 9), rng.range(0.7, 1.4));
      frontage(b, L, null);
      // (its shell: the back wall and one side of it stand, storeys high and broken off; stumps of the rest)
      const mat = rng.chance(0.6) ? 'brick' : 'concrete';
      const H = rng.range(7, 13);
      jagged(b, -w / 2, cz - d / 2, -w / 2, cz + d / 2, PAVE, H, mat, true, { inner: 'plaster' });
      jagged(b, -w / 2 + 0.4, cz + d / 2, w / 2, cz + d / 2, PAVE, H, mat, true, { inner: 'plaster' });
      jagged(b, w / 2, cz + d / 2 - 0.4, w / 2, cz + d / 2 - 5.2, PAVE, H * 0.6, mat, true, { inner: 'plaster' });
      jagged(b, w / 2 - 5.2, cz - d / 2, w / 2, cz - d / 2, PAVE, 2.4, mat);
      // (what it came down as: a long heap where its floors landed, smaller ones round it)
      heap(b, 1.8, cz + 1.2, 4.6, 3.6, rng.range(1.7, 2.3), { brick: 0.45, ry: rng.range(-0.3, 0.3) });
      heap(b, -5.0, cz - 3.4, 2.2, 1.9, 1.1, { brick: 0.5 });
      skirt(b, -w / 2 - 1.4, cz + 1);
      skirt(b, 2, cz + d / 2 + 1.5);
      streetPile(b, L, rng.range(-3, 3));
      // (a floor of it still hanging from the back wall, the steel of another across the heap)
      b.box(-2.4, 3.2, cz + d / 2 - 2.3, w * 0.5, 0.26, 4, 'concrete', { rx: -0.34, collide: false });
      b.box(4.4, 1.9, cz + 3.4, 5.4, 0.2, 0.2, 'rust', { rz: -0.34, ry: -0.7, collide: false });
      b.box(-1.4, 2.4, cz + 2.4, 0.2, 0.2, 6.4, 'rust', { rx: 0.3, ry: 0.2, collide: false });
      b.cont(CONT.DUFFEL, -w / 2 + 1.6, cz - d / 2 + 1.6, { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
      b.loot(w / 2 - 1.2, cz + d / 2 - 1.6, PAVE + 0.02);
      b.prop('skeleton', -w / 2 + 2.6, cz + d / 2 - 1.4, 1.1, { nocollide: true, ly: PAVE, seed: 2 });
      b.tree(L.w / 2 - 2.4, L.d / 2 - 2.4, 4, 1);
    },
    // burnt out: the walls, black, with the sky over them and soot up them from every opening
    burnt(b, L) {
      const F = frame(L, 18, 13);
      if (rng.chance(0.4)) fire(b, 1, 1.2, F.cz);
      else if (rng.chance(0.5)) smoke(b, 0, 3, F.cz);
      b.prop('debris', -3, F.cz - 2, 1, { nocollide: true, ly: FLOOR_Y });
      for (let k = 0; k < 7; k++) weed(b, rng.range(-9, 9), rng.range(F.back + 0.6, L.d / 2 - 0.5), rng.range(0.7, 1.3));
      frontage(b, L, F);
      // (its walls are what they were built of, brick or concrete, under the soot: the kit lays that over every
      // opening the fire came out of, inside and out, and smokes what is left of the plaster)
      const wall = rng.chance(0.65) ? 'brick' : 'concrete';
      groundRoom(b, 0, F.cz, F.w, F.d, 3.4, wall, { n: [gap(F.w / 2, 2.2, 2.6), gap(F.w * 0.2, 2.4, 2.4)], s: [gap(F.w * 0.7, 3, 3)], e: [gap(F.d / 2, 1.6, 2.2)] }, { floorMat: 'ash', burnt: true });
      const up = rng.range(4.5, 9);
      // (each wall is laid so that its outer face looks out of the lot)
      jagged(b, F.L, F.back, F.R, F.back, 3.4, up, wall, false, { soot: true, inner: 'charred' });
      jagged(b, F.L, F.front + 0.4, F.L, F.back - 0.4, 3.4, up, wall, false, { soot: true, inner: 'charred' });
      jagged(b, F.R, F.front, F.L + 0.4, F.front, 3.4, up * 0.6, wall, false, { soot: true, inner: 'charred' });
      jagged(b, F.R, F.back - 0.4, F.R, F.front + 0.4, 3.4, up * 0.4, wall, false, { soot: true, inner: 'charred' });
      skirt(b, F.R + 1.4, F.cz);
      // what the roof and the floors were hung on, down in the room: joists and rafters burnt through, some still
      // leaning where one end held, the rest lying on one another in the ash
      b.box(1, 0.6, F.cz, F.w * 0.7, 0.22, 0.22, 'charred', { rz: 0.22, ry: 0.5, collide: false });
      b.box(-2, 0.3, F.cz + 1.4, F.w * 0.5, 0.2, 0.2, 'charred', { rz: -0.1, ry: -0.8, collide: false });
      b.box(3, 1.5, F.cz - 2, 0.2, 0.2, F.d * 0.8, 'charred', { rx: 0.36, ry: 0.3, collide: false });
      b.box(-5, 1.9, F.cz + 2, 0.18, 0.18, F.d * 0.6, 'charred', { rx: -0.5, ry: -0.2, collide: false });
      for (let k = 0; k < 5; k++) {
        // (a rafter with its head still on the back wall or the left one, its foot in the room)
        const len = rng.range(4.6, 6.4);
        const tip = rng.range(0.48, 0.66);
        const at = rng.range(-0.38, 0.38);
        const onBack = k % 2 === 0;
        const mid = (Math.cos(tip) * len) / 2;
        if (onBack) b.box(at * (F.w - 3), (Math.sin(tip) * len) / 2 + 0.1, F.back - 0.3 - mid, 0.2, 0.2, len, 'charred', { rx: -tip, ry: rng.range(-0.2, 0.2), collide: false });
        else b.box(F.L + 0.3 + mid, (Math.sin(tip) * len) / 2 + 0.1, F.cz + at * (F.d - 3), len, 0.2, 0.2, 'charred', { rz: tip, ry: rng.range(-0.2, 0.2), collide: false });
      }
      for (let k = 0; k < 6; k++) b.box(rng.range(F.L + 2, F.R - 2), 0.22 + rng.range(0, 0.25), rng.range(F.front + 2, F.back - 2), rng.range(2.2, 4.4), 0.16, 0.18, 'charred', { ry: rng.range(0, 3), rz: rng.range(-0.12, 0.12), collide: false });
      heap(b, F.L + 2.6, F.cz + 0.8, 1.5, 1.2, 0.42, { ash: true, ly: FLOOR_Y });
      heap(b, 5.4, F.cz + 3.3, 1.7, 1.3, 0.45, { ash: true, ly: FLOOR_Y });
      cont(b, CONT.CABINET, 'cabinet', F.L + 1.2, backZ(F, 0.55), 0);
      b.prop('bones', F.w / 4, F.cz + 1, 0.4, { nocollide: true, ly: FLOOR_Y });
      b.prop('skeleton', -F.w / 4, F.cz - 2, 2.2, { nocollide: true, ly: FLOOR_Y, seed: 0 });
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
      extra(b, 'street_bench', 4, -L.d / 2 + 1.6, 0, { ly: PAVE });
      extra(b, 'street_bench', -7, 0, PI / 2, { ly: PAVE });
      extra(b, 'trash_bin', 2.2, -L.d / 2 + 1.3, 0, { ly: PAVE });
      b.prop('stroller', -1, 5, rng.range(0, 6), { nocollide: true, ly: PAVE });
      b.prop('bicycle', 7, -5, rng.range(0, 6), { nocollide: true, ly: PAVE, seed: rng.int(0, 1) });
      for (let k = 0; k < 16; k++) weed(b, rng.range(-9, 9), rng.range(-9, 9), rng.range(0.6, 1.4));
      signAt(b, -3, 1.5, -L.d / 2 + 2.06, 0, 0.8, 1.2, 'poster_b', {});
    },
    // a multi-storey car park: two decks on columns over a ground floor of cars, a wall to each deck, the stair tower
    carpark(b, L) {
      const F = frame(L, 38, 15);
      for (const cx of [-18.7, -9.4, 0, 9.4, 18.7]) for (const dz of [-7.2, 0, 7.2]) b.box(cx, PAVE, F.cz + dz, 0.5, CARPARK_DECK * 2 + 0.3, 0.5, 'concrete');
      for (const k of [1, 2]) {
        b.box(0, CARPARK_DECK * k, F.cz, F.w, 0.3, F.d, 'concrete');
        for (const z of [F.front + 0.1, F.back - 0.1]) b.box(0, CARPARK_DECK * k + 0.3, z, F.w, 0.95, 0.2, 'concrete');
        for (const x of [F.L + 0.1, F.R - 0.1]) b.box(x, CARPARK_DECK * k + 0.3, F.cz, 0.2, 0.95, F.d - 0.4, 'concrete');
        // rust down from every joint of it, the level's number on the wall
        for (let x = -15; x <= 15; x += 7.5) signAt(b, x + rng.range(-1, 1), CARPARK_DECK * k + 0.62, F.front - 0.02, 0, 0.7, 1.25, rng.chance(0.5) ? 'rust_a' : 'rust_b', { grime: true });
      }
      b.roofSpan(0, F.cz, F.w / 2, F.d / 2, CARPARK_DECK, 0.3);
      b.box(15.4, 0.2, F.cz - 3.4, 6, 0.3, 3.2, 'concrete', { rz: 0.32, collide: false }); // what is left of the ramp
      // the stair tower at its end, the sign on it
      b.box(F.R + 1.7, PAVE, F.cz + 4, 3, CARPARK_DECK * 2 + 3.2, 4.4, 'concrete');
      signAt(b, F.R + 1.7, CARPARK_DECK * 2 + 2.1, F.cz + 1.76, 0, 2.8, 0.7, 'parking', { far: true });
      for (let k = 0; k < 6; k++) {
        if (!rng.chance(0.55)) continue;
        const t = rng();
        b.wreck(t < 0.4 ? 'car_wreck' : t < 0.65 ? 'car_burnt' : t < 0.85 ? 'car_open' : 'pickup_truck', -16.2 + k * 4.7, F.cz + (k % 2 ? 3.6 : -3.6), rng.range(-0.12, 0.12), { ly: PAVE, trunk: rng.chance(0.5) });
      }
      // (...and those left on the decks: nobody is getting up to them)
      for (const k of [1, 2]) {
        for (let n = 0; n < 6; n++) {
          const t = rng();
          const here = rng.chance(0.5);
          const ry = rng.range(-0.1, 0.1) + (n % 2 ? PI : 0);
          if (here) b.prop(t < 0.5 ? 'car_wreck' : t < 0.8 ? 'car_burnt' : 'van_wreck', -15 + n * 5.8, F.cz + (n % 2 ? 3.4 : -3.4), ry, { ly: CARPARK_DECK * k + 0.3 });
        }
      }
      b.cont(CONT.DUFFEL, -4.7, F.cz, { prop: 'duffel_bag', ry: 0.9, nocollide: true, ly: PAVE });
      b.loot(4.7, F.cz, PAVE + 0.02);
      b.loot(-14, F.cz, PAVE + 0.02);
      yard(b, F, L);
    },
    // a whole block down: its floors lie one on another where it stood, a corner of it still stands seven floors
    // high and open on every room, over a field of rubble
    collapse(b, L) {
      const floors = rng.int(5, 8);
      block(b, -13, -12, 13, 12, PAVE, floors, 3, 'slab', 'concrete', { lost: rng.int(2, 3), open: 1, from: 1, wear: 1 });
      // its floors, pancaked: slabs one on another where the rest of it stood (solid: a heap to be climbed)
      for (let k = 0; k < 4; k++) solid(b, 6 + k * 0.5, PAVE + k * 0.42, -10 + k * 0.4, 18 - k * 2.2, 0.4, 12 - k * 1.6, 'concrete', { ry: 0.04 * (k - 1.5) });
      pancakes.push({ x: b.wx(6, -10), y: b.y0 + PAVE, z: b.wz(6, -10), ry: b.ry, w: 18, d: 12, n: 4, seed: rng.int(1, 99999) });
      heap(b, 7, 1.5, 4.4, 3.4, 2.0, { ry: rng.range(-0.4, 0.4) });
      heap(b, -13, 10.5, 3.8, 3.2, 1.8);
      heap(b, -3, 7, 3.0, 2.6, 1.4);
      heap(b, 14.5, 9.5, 3.2, 3.6, 1.5);
      // (what is left of its walls: lengths of the back and one side, storeys high and broken off)
      jagged(b, -20.4, 20.4, -6, 20.4, PAVE, 11, 'concrete', true, { inner: 'plaster' });
      jagged(b, 11, 20.4, 20, 20.4, PAVE, 8, 'concrete', true, { inner: 'plaster' });
      jagged(b, 20.4, 20.4, 20.4, 5.5, PAVE, 12, 'concrete', true, { inner: 'plaster' });
      jagged(b, -20.4, 0.5, -20.4, 6, PAVE, 6, 'concrete');
      // (floors of it lying where they came down, tipped every way)
      for (let k = 0; k < 7; k++) b.box(rng.range(-16, 16), PAVE + rng.range(0.3, 1.2), rng.range(0, 17), rng.range(4, 7), 0.32, rng.range(3, 6), 'concrete', { rz: rng.range(-0.34, 0.34), rx: rng.range(-0.22, 0.22), ry: rng.range(0, 3), collide: false });
      for (let k = 0; k < 7; k++) skirt(b, rng.range(-18, 18), rng.range(-3, 18));
      for (const [px, pz] of [[12, 0], [-14, 4], [4, 12], [17, -4], [-4, -3]]) b.prop('debris', px, pz, rng.range(0, 6), { nocollide: true, ly: PAVE, seed: px & 3 });
      smoke(b, 4, 3, -8);
      for (let k = 0; k < 14; k++) weed(b, rng.range(-19, 19), rng.range(-4, 19), rng.range(0.7, 1.4));
      for (const [tx, tz] of [[10.5, 15], [-8, 15.5]]) b.tree(tx, tz, 5, rng.range(0.5, 0.8));
      streetPile(b, L, rng.range(-6, 6));
      b.cont(CONT.DUFFEL, 16.4, 3, { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
      b.cont(CONT.CRATE, 6, 16.6, { prop: 'crate', ry: 0.2, ly: PAVE });
      b.cont(CONT.AMMO_BOX, -17, 2, { prop: 'military_crate', ry: 0.4, ly: PAVE });
      b.prop('corpse', 3, -2.2, 2, { nocollide: true, ly: PAVE });
      b.prop('skeleton', -8, 3, 0.4, { nocollide: true, ly: PAVE });
      b.loot(12.5, 5.5, PAVE + 0.02);
      b.loot(-17.5, 6, PAVE + 0.02);
      for (const [tx, tz] of [[17, -17], [-17, 17]]) b.tree(tx, tz, 4, rng.range(0.9, 1.2));
    },
    // the bus depot: a roof on posts over the buses that never went out, and the dispatcher's office
    depot(b, L) {
      b.shelter(-4, -4, 30, 16, 5.4, 'tin', 'metal');
      for (const px of [-9.5, -2, 6]) for (const pz of [-11.8, 3.8]) b.cyl(px, PAVE, pz, 0.14, 5.4 - PAVE, 'metal', { sides: 6 });
      // (the roof's edge beam, the board on it)
      b.box(-4, 4.9, -12.1, 30.4, 0.6, 0.2, 'rust', { collide: false });
      signAt(b, -4, 5.2, -12.24, 0, 7.2, 1.8, 'depot', { far: true });
      b.wreck('city_bus', -13, -4, 0.04, { ly: PAVE, trunk: false });
      b.wreck('city_bus', -8.6, -4.4, PI - 0.03, { ly: PAVE, trunk: false, seed: 1 });
      b.wreck('school_bus', -3.4, -4.6, 0.1, { ly: PAVE, trunk: false });
      b.wreck('ambulance', 3.4, -3, 0.1, { ly: PAVE, trunk: false });
      const R = groundRoom(b, 14, 12, 10, 8, 3.2, 'brick', { n: [door(5, 1.3), win(2, 1.4), win(8, 1.4)], w: [win(4, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true });
      void R;
      b.cont(CONT.LOCKER, 18.56, 13, { prop: 'locker', ry: -PI / 2, ly: FLOOR_Y });
      b.cont(CONT.CABINET, 11, 15.5, { prop: 'cabinet', ry: PI, ly: FLOOR_Y });
      b.cont(CONT.TOOLBOX, 15.5, 14.6, { prop: 'toolbox', ry: 0.6, nocollide: true, ly: FLOOR_Y });
      extra(b, 'office_desk', 14, 10.4, PI, inside);
      b.loot(14, 9.2, FLOOR_Y + 0.02);
      b.prop('office_chair', 14.4, 11.6, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('paper_scatter', 12.6, 12.6, 2, { nocollide: true, ly: FLOOR_Y });
      b.prop('gas_pump', 9, -15, 0, { ly: PAVE });
      b.prop('tire_pile', -17, 12, 0, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -10, 16, { prop: 'dumpster', ry: PI, ly: PAVE });
      b.cont(CONT.CRATE, 2, 12, { prop: 'crate', ry: 0.2, ly: PAVE });
      b.prop('corpse', 6, 6, 1.2, { nocollide: true, ly: PAVE });
      b.loot(-2, 10, PAVE + 0.02);
      b.loot(10, -8, PAVE + 0.02);
      extra(b, 'street_bench', -16, 16.5, PI, { ly: PAVE });
      for (let k = 0; k < 5; k++) b.prop(['litter', 'suitcases', 'paper_scatter', 'glass_shards', 'traffic_cones'][k], rng.range(-18, 18), rng.range(6, 18), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: k });
      for (let k = 0; k < 12; k++) weed(b, rng.range(-20, 20), rng.range(5, 20), rng.range(0.6, 1.3));
    },
    // CALDER GENERAL: at the back of its block, four floors over an emergency room that can be walked into - the
    // wards behind it, the pharmacy between them. Out front: the canopy with its sign, the ambulances that came in
    // last, and the tents the wards overflowed into, cots and the dead in rows between them.
    hospital(b, L) {
      const F = { w: 34, d: 14, cz: 12, front: 5, back: 19, L: -17, R: 17 };
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 4, 'concrete', { n: [gap(17, 4, 3), cw(5, 3, 0.8, 3), cw(29, 3, 0.8, 3), cw(10.5, 2.2, 0.8, 3), cw(23.5, 2.2, 0.8, 3)], s: [door(4, 1.2), door(30, 1.2)], e: [cw(4, 1.6)], w: [door(12.4, 1.3)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, tint: 2 });
      partition(b, R, F.L, 13.5, F.R, 13.5, 4, 'concrete', [door(5, 1.3), door(17, 1.6), door(29, 1.3)]);
      for (const wx of [-6, 6]) partition(b, R, wx, 13.5, wx, F.back, 4, 'concrete');
      // (the hall is three rooms: triage on the left of the way in, where the beds were wheeled, the waiting room
      // on its right - each behind a wall that stops short of the corridor along the wards' doors - and between
      // them the desk)
      for (const wx of [-7.6, 10.6]) partition(b, R, wx, F.front, wx, 11.3, 4, 'concrete');
      zone(R, F.L, F.front, -7.6, 13.5, 4);
      zone(R, 10.6, F.front, F.R, 13.5, 1);
      zone(R, F.L, 13.5, -6, F.back, 0);
      zone(R, -6, 13.5, 6, F.back, 5);
      zone(R, 6, 13.5, F.R, F.back, 0);
      // the hall: the desk, the rows of seats, beds wheeled in wherever there was floor
      b.prop('reception_desk', 6.6, 9.4, 0, inside);
      b.loot(6.6, 9.4, FLOOR_Y + 1.14);
      for (const sx of [-13.6, -11.6, 12.6]) extra(b, 'waiting_chairs', sx, F.front + WALL + 0.34, PI, inside);
      extra(b, 'waiting_chairs', 10.6 + 0.09 + 0.06 + 0.32, 8.4, -PI / 2, inside);
      extra(b, 'waiting_chairs', rightX(F, 0.6), 10.6, PI / 2, { ly: FLOOR_Y, seed: 1 });
      drumFire(b, 3.2, 6.4); // (the one light in the place: a drum somebody kept burning by the way in)
      b.prop('hospital_bed', -14.6, 9.2, PI / 2, { ly: FLOOR_Y, seed: 1 });
      b.prop('hospital_bed', -14.6, 11.8, PI / 2, { ly: FLOOR_Y, seed: 2 });
      extra(b, 'hospital_bed', -9.6, 11.4, PI / 2 + 0.3, { ly: FLOOR_Y, seed: 0 });
      b.prop('privacy_curtain', -13.6, 10.5, 0, { nocollide: true, ly: FLOOR_Y });
      extra(b, 'gurney', -3.4, 8.2, 0.5, inside);
      extra(b, 'gurney', 2.6, 11.4, -1.2, { ly: FLOOR_Y, seed: 1 });
      extra(b, 'medical_cart', -11.2, 7.2, 0.4, inside);
      b.prop('iv_stand', -12.6, 11.9, 0, { nocollide: true, ly: FLOOR_Y });
      b.prop('iv_stand', -1.4, 9.6, 1, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.prop('wheelchair', -6, 7, 0.8, { nocollide: true, ly: FLOOR_Y });
      b.prop('wheelchair', 12.6, 11.6, 2.6, { nocollide: true, ly: FLOOR_Y });
      b.prop('barricade', 6.2, 12.6, 0.05, inside); // (between the doors of the wards and the pharmacy)
      b.prop('blood_pool', -2, 7.4, 1, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.prop('blood_pool', 9, 11.4, 2, { nocollide: true, ly: FLOOR_Y, seed: 2 });
      stairBlock(b, F.R - 1.5, F.front + 1.1);
      // the wards: beds along the back wall, screens between them
      for (const sx of [-1, 1]) {
        b.prop('hospital_bed', sx * 15, F.back - WALL - 1.1, 0, { ly: FLOOR_Y, seed: 2 });
        b.prop('hospital_bed', sx * 11.4, F.back - WALL - 1.1, 0, { ly: FLOOR_Y, seed: sx > 0 ? 1 : 0 });
        extra(b, 'hospital_bed', sx * 7.8, F.back - WALL - 1.1, 0, { ly: FLOOR_Y, seed: 0 });
        b.prop('privacy_curtain', sx * 13.2, F.back - 1.6, PI / 2, { nocollide: true, ly: FLOOR_Y, seed: sx > 0 ? 1 : 0 });
        b.prop('body_bag', sx * 9.6, 14.6, PI / 2, { nocollide: true, ly: FLOOR_Y });
        b.prop('iv_stand', sx * 16.2, 16, 0, { nocollide: true, ly: FLOOR_Y, seed: 1 });
        b.loot(sx * 7, 15.2, FLOOR_Y + 0.02);
      }
      cont(b, CONT.MEDICINE, 'medicine_cabinet', leftX(F, 0.45), 15.4, -PI / 2);
      cont(b, CONT.LOCKER, 'locker', rightX(F, 0.5), 15.4, PI / 2);
      // the pharmacy
      for (const dx of [-4.2, -3.0]) cont(b, CONT.MEDICINE, 'medicine_cabinet', dx, backZ(F, 0.45), 0, { seed: dx | 0 });
      cont(b, CONT.DRUG_LOCKER, 'drug_locker', 4, backZ(F, 0.6), 0);
      cont(b, CONT.CABINET, 'cabinet', 0.6, backZ(F, 0.55), 0);
      b.prop('stock_spill', 1.6, 15.8, 1, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.loot(-1.4, 15.4, FLOOR_Y + 0.02);
      mess(b, F, 20, 4, R);
      const floors = 4;
      block(b, 0, F.cz, F.w, F.d, 4.3, floors, 3.2, 'office', 'concrete', { lost: rng.int(0, 1), open: rng.chance(0.5) ? 1 : 0, from: 2, wear: 0.7 });
      // its name across the front, over the ground floor; a cross at either end of it
      signAt(b, 0, 5.3, F.front - 0.36, 0, 14.4, 1.8, 'hospital', { far: true, back: 0.1 });
      for (const sx of [-10, 10]) signAt(b, sx, 5.3, F.front - 0.34, 0, 1.7, 1.7, 'redcross', { far: true });
      // the canopy over the door: a slab on four posts out over the drive, EMERGENCY on its edge
      for (const px of [-4.6, 4.6]) for (const pz of [-1.6, 2.4]) b.cyl(px, PAVE, pz, 0.18, 3.5, 'metal', { sides: 8 });
      b.box(0, 3.6, 1.4, 10.4, 0.34, 7.2, 'concrete', { collide: false });
      b.box(0, 3.4, -2.2, 10.4, 1.3, 0.3, 'metal', { collide: false });
      b.roofSpan(0, 1.4, 5.2, 3.6, 3.6, 0.34);
      signAt(b, 0, 4.05, -2.37, 0, 5.2, 1.3, 'emergency', { far: true });
      b.wreck('ambulance', -7.6, 1.2, 0.12, { ly: PAVE, trunk: false });
      b.wreck('ambulance', 7.8, -0.4, PI + 0.3, { ly: PAVE, trunk: false, seed: 1 });
      b.prop('gurney', 3.2, 0.6, 0.3, { ly: PAVE, seed: 1 });
      // the forecourt: tents either side of the way in, the dead laid out by the kerb, the army's lamp over it all
      for (const [tx, sd] of [[-15.4, 0], [-9.4, 1], [10, 0], [15.6, 1]]) {
        b.prop('triage_tent', tx, -11.4, 0, { ly: PAVE, seed: sd });
        b.prop('field_cot', tx - 1.2, -12.6, 0, { ly: PAVE, seed: (tx & 1) + 1 });
        b.prop('field_cot', tx + 1.2, -10, PI, { ly: PAVE, seed: sd });
        b.prop('iv_stand', tx + 0.3, -12.4, 0, { nocollide: true, ly: PAVE, seed: sd });
      }
      for (let i = 0; i < 7; i++) b.prop('body_bag', -5.4 + i * 1.3, -18.6, PI / 2 + 0.1 * Math.sin(i * 2.1), { nocollide: true, ly: PAVE, seed: i });
      for (let i = 0; i < 4; i++) b.prop('body_bag', -3.8 + i * 1.3, -16.4, PI / 2 - 0.06 * i, { nocollide: true, ly: PAVE, seed: i + 2 });
      b.prop('floodlight_tower', 19, -18.6, 0.6, { ly: PAVE });
      b.prop('checkpoint_sign', 3.4, -19.6, 0, { ly: PAVE });
      b.prop('sandbags', -4.4, -4.6, 0, { ly: PAVE });
      b.prop('sandbags', 4.6, -4.8, 0.1, { ly: PAVE, seed: 1 });
      b.prop('suitcases', 2.4, -7, 0.4, { nocollide: true, ly: PAVE });
      b.prop('wheelchair', -2.4, -6.2, 2, { nocollide: true, ly: PAVE });
      b.prop('stroller', 5.4, -14.4, 1, { nocollide: true, ly: PAVE });
      for (let k = 0; k < 6; k++) b.prop(['litter', 'paper_scatter', 'blood_pool', 'skeleton', 'litter', 'glass_shards'][k], rng.range(-18, 18), rng.range(-19, -4), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: k });
      // down its sides: the generator, what was thrown out
      b.prop('generator', 19.3, 10, PI / 2, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -19.5, 14, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      b.cont(CONT.DUFFEL, -12.4, -8.4, { prop: 'duffel_bag', ry: 0.4, nocollide: true, ly: PAVE });
      b.cont(CONT.CRATE, 13.6, -5.4, { prop: 'crate', ry: 0.3, ly: PAVE });
      b.prop('barrel', -18.6, -4, 0, { ly: PAVE });
      b.light(-18.6, PAVE + 1.0, -4, 'embers');
      for (const [tx, tz] of [[-19.4, 3], [19.6, 2]]) b.tree(tx, tz, 3, rng.range(0.7, 1.1));
      for (let k = 0; k < 14; k++) weed(b, rng.range(-20, 20), rng.range(-20, 4), rng.range(0.6, 1.3));
      b.loot(8, -6, PAVE + 0.02);
      landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: 'Calder General' });
    },
    // ST. BRENDAN'S: a stone church on a corner lot - a nave under a steep roof, a tower at its door with a spire,
    // coloured glass in what is left of its windows, its yard gone to weed
    church(b, L) {
      const F = frame(L, 9.6, 14);
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 5.4, 'stone', { n: [door(4.8, 1.6)], s: [door(7.6, 1.1)] }, { roof: 'gable', roofH: 3.9, roofMat: 'shingles', floorMat: 'planks', tint: 3 });
      R.ceiling = 'plaster'; // (a plastered ceiling over the nave: the roof's own inside is nothing to look up into)
      // the tower: over the door, a belfry with its louvres, a spire, a cross
      b.box(0, 5.4, F.front + 1.5, 3.3, 6.6, 3.3, 'stone', { collide: false });
      b.box(0, 12, F.front + 1.5, 3.7, 0.3, 3.7, 'stone', { collide: false });
      for (const [dx, dz, w, d] of [[0, -1.66, 1.2, 0.04], [0, 1.66, 1.2, 0.04], [-1.66, 0, 0.04, 1.2], [1.66, 0, 0.04, 1.2]]) b.box(dx, 9.4, F.front + 1.5 + dz, w, 1.9, d, 'dark', { collide: false });
      b.cone(0, 12.3, F.front + 1.5, 2.45, 7.2, 'shingles', 4);
      b.box(0, 19.4, F.front + 1.5, 0.12, 1.6, 0.12, 'trim', { collide: false });
      b.box(0, 20.3, F.front + 1.5, 0.84, 0.12, 0.12, 'trim', { collide: false });
      // buttresses down both sides, and between them the windows: lead and coloured glass, panes of it gone
      for (const sx of [-1, 1]) {
        for (const dz of [-6.6, -2.2, 2.2, 6.6]) b.box(sx * (F.w / 2 + 0.3), 0, F.cz + dz, 0.6, 3.6, 0.7, 'stone');
        for (const [dz, c] of [[-4.4, 'stained_a'], [0, 'stained_b'], [4.4, 'stained_a']]) {
          signAt(b, sx * (F.w / 2 + 0.14), 2.9, F.cz + dz, sx > 0 ? -PI / 2 : PI / 2, 1.25, 2.5, c, { far: true });
          signAt(b, sx * (F.w / 2 - 0.14), 2.9, F.cz + dz, sx > 0 ? PI / 2 : -PI / 2, 1.25, 2.5, c, {});
          b.box(sx * (F.w / 2 + 0.16), 1.5, F.cz + dz, 0.12, 0.14, 1.6, 'stone', { collide: false });
        }
      }
      signAt(b, 0, 8.0, F.front - 0.17, 0, 1.3, 2.6, 'stained_b', { far: true });
      for (let r = 0; r < 3; r++) {
        b.prop('pew', -2.3, F.cz - 3.2 + r * 2.2, r === 1 ? 0.2 : 0, inside);
        b.prop('pew', 2.3, F.cz - 3.2 + r * 2.2, 0, inside);
      }
      b.prop('altar', -0.4, F.back - 1.6, 0, inside);
      b.loot(-0.4, F.back - 1.6, FLOOR_Y + 1.02);
      cont(b, CONT.CABINET, 'cabinet', F.L + 4.2, backZ(F, 0.55), 0); // (clear of the vestry door)
      b.cont(CONT.DUFFEL, 3.4, F.cz - 5, { prop: 'duffel_bag', ry: 1.1, nocollide: true, ly: FLOOR_Y });
      // those who came here at the end: in the pews, on the floor before the altar
      b.prop('skeleton', -2.3, F.cz - 3.0, PI, { nocollide: true, ly: FLOOR_Y + 0.42, seed: 1 });
      b.prop('skeleton', 2.6, F.cz + 1.3, PI, { nocollide: true, ly: FLOOR_Y + 0.42, seed: 1 });
      b.prop('skeleton', 0.6, F.back - 3.4, 0.5, { nocollide: true, ly: FLOOR_Y, seed: 2 });
      b.prop('blood_pool', 0, F.cz - 1, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('ceiling_debris', 1.5, F.cz + 3.6, 2, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      for (const [gx, gz, sd] of [[7.4, -5, 0], [8.6, -1.6, 1], [7.2, 2, 2], [-7.6, -3, 1], [-8.4, 1.4, 0], [7.8, 5.4, 1], [-7.4, 5, 2]]) b.prop('grave_cross', gx, gz, rng.range(-0.3, 0.3), { ly: PAVE, seed: sd });
      b.tree(-7.4, 7.6, 3, 1.1);
      b.tree(7.8, 8.2, 4, 0.9);
      b.prop('ivy', F.R + 0.04, F.cz + 2.2, -PI / 2, { nocollide: true, ly: PAVE });
      for (let k = 0; k < 14; k++) weed(b, rng.range(-9, 9) < 0 ? rng.range(-9.2, -5.8) : rng.range(5.8, 9.2), rng.range(-8, 9), rng.range(0.7, 1.3));
      frontage(b, L, F);
      // its board by the gate
      b.cyl(-7, PAVE, -L.d / 2 + 1.2, 0.07, 1.9, 'rust', { sides: 6 });
      signAt(b, -6.2, 1.5, -L.d / 2 + 1.14, 0, 1.9, 0.48, 'church', { back: 0.05 });
      landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: "St. Brendan's" });
    },
    // a filling station: pumps under a canopy on the street with the name on its edge, the kiosk behind them, the
    // board of prices on its pole at the corner
    gas(b, L) {
      const R = groundRoom(b, 0, 5.5, 10, 6, 3.2, 'brick', { n: [door(5, 1.4), cw(2, 2.4, 0.9, 2.4), cw(8, 2.4, 0.9, 2.4)], e: [door(3, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true });
      void R;
      b.prop('checkout_counter', -2.6, 4.6, 0, inside);
      b.loot(-2.6, 4.6, FLOOR_Y + 0.98);
      b.cont(CONT.SHELF, -2.8, 8.065, { prop: 'shelf', ry: PI, ly: FLOOR_Y });
      b.cont(CONT.SHELF, 0.2, 8.065, { prop: 'shelf', ry: PI, ly: FLOOR_Y, seed: 1 });
      b.cont(CONT.FRIDGE, 3, 7.955, { prop: 'fridge', ry: PI, ly: FLOOR_Y });
      b.prop('stock_spill', 1.4, 5.4, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('ceiling_lamp', 0, 5.5, 0, { nocollide: true, ly: 3.2, seed: 1 });
      for (const px of [-4.2, 4.2]) for (const pz of [-2.4, -6.6]) b.cyl(px, PAVE, pz, 0.18, 4.3, 'metal', { sides: 8 });
      b.box(0, 4.3, -4.5, 10.8, 0.95, 6.8, 'metal', { collide: false });
      b.roofSpan(0, -4.5, 5.4, 3.4, 4.3, 0.95);
      signAt(b, 0, 4.78, -7.92, 0, 3.6, 0.9, 'gas', { far: true });
      signAt(b, -5.42, 4.78, -4.5, PI / 2, 3.6, 0.9, 'gas', { far: true });
      signAt(b, 5.42, 4.78, -4.5, -PI / 2, 3.6, 0.9, 'gas', { far: true });
      b.box(0, PAVE, -4.5, 5.2, 0.16, 1.3, 'concrete'); // the island the pumps stand on
      b.prop('gas_pump', -1.7, -4.5, 0, { ly: PAVE + 0.16 });
      b.prop('gas_pump', 1.7, -4.5, 0, { ly: PAVE + 0.16, seed: 1 });
      b.wreck('car_burnt', 7.2, -4.2, 0.1, { ly: PAVE, trunk: false });
      b.wreck('car_open', -7.4, -3.6, PI - 0.15, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -7.4, 6.6, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      b.prop('tire_pile', 8, 5, 0, { ly: PAVE });
      b.prop('litter', 0, -1, 1, { nocollide: true, ly: PAVE });
      b.prop('traffic_cones', 3.6, -7.2, 1, { nocollide: true, ly: PAVE });
      // the prices, on a pole
      b.cyl(-8.6, PAVE, -8.6, 0.13, 3.4, 'rust', { sides: 6 });
      signAt(b, -8.6, 4.8, -8.72, 0.25, 1.4, 2.8, 'gasprice', { far: true, back: 0.2, two: true });
      for (let k = 0; k < 8; k++) weed(b, rng.range(-9, 9), rng.range(8.9, 9.4), rng.range(0.7, 1.2));
      frontage(b, L, null, true);
    },
    // THE RIALTO: a picture house - the lobby on the street under its marquee, the hall behind it, the screen still up
    cinema(b, L) {
      const F = frame(L, 30, 15);
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 7, 'brick', { n: [gap(15, 5, 3)], s: [door(3, 1.2), door(27, 1.2)], w: [door(11, 1.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks', tint: 4 });
      partition(b, R, F.L, F.front + 4.6, F.R, F.front + 4.6, 7, 'brick', [door(8, 1.6), door(22, 1.6)]);
      R.ceiling = 'plaster';
      // its front: piers the height of it, a stepped head over the middle, a course under the parapet
      for (const px of [-14.6, -9.4, -4.2, 4.2, 9.4, 14.6]) b.box(px, PAVE, F.front - 0.2, 0.7, 7.5, 0.3, 'brick', { collide: false });
      b.box(0, 7.3, F.front + 0.1, 11, 1.5, 0.5, 'brick', { collide: false });
      b.box(0, 8.8, F.front + 0.1, 5.4, 0.9, 0.5, 'brick', { collide: false });
      b.box(0, 6.7, F.front - 0.24, 30.4, 0.3, 0.3, 'concrete', { collide: false });
      // the marquee: a box out over the pavement, the letters that are left on it; the name down a blade above it
      b.box(0, 3.3, F.front - 1.45, 6.6, 1.7, 2.6, 'metal', { collide: false });
      signAt(b, 0, 4.15, F.front - 2.77, 0, 6.2, 1.55, 'marquee', { far: true });
      signAt(b, -3.32, 4.15, F.front - 1.45, PI / 2, 2.4, 0.6, 'marquee', {});
      signAt(b, 3.32, 4.15, F.front - 1.45, -PI / 2, 2.4, 0.6, 'marquee', {});
      signAt(b, 0, 7.6, F.front - 0.9, PI / 2, 1.25, 5.0, 'rialto', { far: true, back: 0.3, two: true });
      // what was showing, in its cases either side of the doors
      for (const [px, c] of [[-6.8, 'poster_a'], [-5.2, 'poster_c'], [5.2, 'poster_b'], [6.8, 'poster_d']]) signAt(b, px, 1.75, F.front - 0.14, 0, 1.0, 1.5, c, {});
      b.prop('checkout_counter', -9, F.front + 2.6, 0, inside); // the box office
      b.loot(-9, F.front + 2.6, FLOOR_Y + 0.98);
      cont(b, CONT.FRIDGE, 'fridge', rightX(F, 0.72), F.front + 2.2, PI / 2);
      cont(b, CONT.CABINET, 'cabinet', leftX(F, 0.55), F.front + 2, -PI / 2);
      extra(b, 'vending_machine', 9.4, F.front + 4.6 - 0.09 - WALL - 0.4, 0, inside);
      extra(b, 'vending_machine', 10.6, F.front + 4.6 - 0.09 - WALL - 0.4, 0, { ly: FLOOR_Y, seed: 1 });
      b.prop('litter', 3, F.front + 2.4, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('stock_spill', -5, F.front + 2.2, 2, { nocollide: true, ly: FLOOR_Y });
      // the hall: rows of seats facing the screen
      for (let r = 0; r < 3; r++) for (const px of [-11, -8.6, -6.2, -3.8, 3.8, 6.2, 8.6, 11]) if ((r * 7 + ((px * 10) | 0)) % 5) b.prop('cinema_seats', px, F.front + 6.9 + r * 2.1, PI + rng.range(-0.03, 0.03), { ly: FLOOR_Y, seed: r });
      b.box(-2, 1.6, F.back - 0.5, 16, 4.6, 0.12, 'clapboard', { collide: false }); // the screen, a corner of it torn down
      b.box(7.4, 2.2, F.back - 0.6, 3.4, 3.4, 0.1, 'clapboard', { rz: -0.5, collide: false });
      b.cont(CONT.DUFFEL, 0, F.front + 8.2, { prop: 'duffel_bag', ry: 0.6, nocollide: true, ly: FLOOR_Y });
      b.cont(CONT.DUFFEL, -12.6, F.back - 1.6, { prop: 'duffel_bag', ry: 2, nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.prop('corpse', 0.4, F.front + 11.4, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('skeleton', -8.6, F.front + 8.9, 0, { nocollide: true, ly: FLOOR_Y + 0.4, seed: 1 });
      b.loot(12.6, F.back - 1.6, FLOOR_Y + 0.02);
      b.loot(0, F.back - 2, FLOOR_Y + 0.02);
      mess(b, F, 14);
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
      // the station's name over the head of the stairs, on two posts
      for (const px of [-1.9, 1.9]) b.cyl(px, PAVE, -6.6, 0.07, 3.1, 'rust', { sides: 6 });
      signAt(b, 0, 2.95, -6.66, 0, 3.6, 0.9, 'subway', { far: true, back: 0.08, two: true });
      const R = groundRoom(b, 5.8, 5.4, 5, 4, 2.8, 'tin', { w: [door(2, 1.1)], n: [cw(2.5, 2, 1, 2)] }, { roof: 'flat', roofMat: 'tin', plain: true });
      void R;
      b.cont(CONT.CABINET, 7.4, 6.4, { prop: 'cabinet', ry: -PI / 2, ly: FLOOR_Y });
      b.loot(5.4, 4.6, FLOOR_Y + 0.02);
      extra(b, 'turnstiles', -5.6, 1.6, PI / 2, { ly: PAVE });
      extra(b, 'street_bench', -6.6, 6.4, PI / 2, { ly: PAVE });
      extra(b, 'street_bench', 0.4, 8.2, PI, { ly: PAVE, seed: 1 });
      extra(b, 'trash_bin', 2.6, 8.1, 0, { ly: PAVE });
      extra(b, 'newspaper_box', 7.6, -7.6, 0, { ly: PAVE });
      extra(b, 'phone_booth', -8.2, -3.4, PI / 2, { ly: PAVE });
      for (const [tx, tz] of [[-7.4, 8.6], [-3.4, 3.8], [7.6, -4.6]]) b.tree(tx, tz, rng.chance(0.5) ? 3 : 5, rng.range(0.7, 1.1));
      b.prop('suitcases', 3.4, -6.4, 0.8, { nocollide: true, ly: PAVE });
      b.prop('litter', -3, -6.5, 2, { nocollide: true, ly: PAVE });
      b.prop('litter', 2, 2, 0.3, { nocollide: true, ly: PAVE, seed: 1 });
      b.prop('paper_scatter', -1, 4.4, 1, { nocollide: true, ly: PAVE });
      b.prop('stroller', 4.6, 2.4, 2.2, { nocollide: true, ly: PAVE });
      b.cont(CONT.DUFFEL, -3.2, 0.6, { prop: 'duffel_bag', ry: 0.3, nocollide: true, ly: PAVE });
      b.prop('streetlight', 8.6, -8.6, PI, { ly: PAVE });
      b.prop('corpse', 4.4, 0, 2, { nocollide: true, ly: PAVE });
      b.prop('skeleton', -2.4, -8.4, 1, { nocollide: true, ly: PAVE, seed: 2 });
      for (let k = 0; k < 10; k++) weed(b, rng.range(-9, 9), rng.range(-9, 9), rng.range(0.6, 1.2));
      landmarks.push({ x: b.wx(0, -3), z: b.wz(0, -3), name: 'Harbour Street Station' });
    },
    // a car park nobody drove out of
    parking(b, L) {
      const rows = Math.max(1, Math.floor((L.d - 6) / 7));
      const cols = Math.max(2, Math.floor((L.w - 3) / 3.4));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!rng.chance(0.5)) continue;
          const t = rng();
          b.wreck(t < 0.4 ? 'car_wreck' : t < 0.62 ? 'car_burnt' : t < 0.8 ? 'car_open' : t < 0.9 ? 'van_wreck' : 'pickup_truck', -L.w / 2 + 2.6 + c * 3.4 + rng.range(-0.2, 0.2), -L.d / 2 + 5 + r * 7, (rng.chance(0.5) ? 0 : PI) + rng.range(-0.1, 0.1), { trunk: t < 0.4 && rng.chance(0.45), ly: PAVE });
        }
      }
      b.prop('streetlight', L.w / 2 - 1, L.d / 2 - 1, PI, { ly: PAVE });
      b.loot(0, L.d / 2 - 2, PAVE + 0.02);
      for (let k = 0; k < 12; k++) weed(b, rng.range(-L.w / 2 + 1, L.w / 2 - 1), (k % 2 ? 1 : -1) * (L.d / 2 - 0.6), rng.range(0.6, 1.2));
      for (let k = 0; k < 5; k++) b.prop(['litter', 'shopping_cart', 'glass_shards', 'suitcases', 'skeleton'][k], rng.range(-L.w / 2 + 2, L.w / 2 - 2), 1.5 + rng.range(-0.4, 0.4), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: k });
      // the board at its way in
      b.cyl(-L.w / 2 + 1, PAVE, -L.d / 2 + 0.8, 0.07, 2.7, 'rust', { sides: 6 });
      signAt(b, -L.w / 2 + 2.1, 2.5, -L.d / 2 + 0.74, 0, 2.2, 0.55, 'parking', { back: 0.05 });
    },
    // a warehouse: one tall hall behind two loading doors, a loft of windows over it, the office in its corner
    warehouse(b, L) {
      const F = frame(L, 38, 15);
      const hi = (at) => ({ at, w: 2.6, y0: 3.3, y1: 5.3, glass: rng.chance(0.4) });
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 6.2, 'brick', { n: [gap(8, 4.2, 4.4), door(19, 1.4), gap(30, 4.2, 4.4), hi(14), hi(24)], s: [door(3, 1.2), hi(12), hi(19), hi(26)], e: [hi(7.5)], w: [hi(7.5)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', plain: true });
      partition(b, R, F.R - 7, F.back - 5.4, F.R, F.back - 5.4, 3, 'concrete', [door(2, 1.2)]);
      partition(b, R, F.R - 7, F.back - 5.4, F.R - 7, F.back, 3, 'concrete');
      block(b, 0, F.cz, F.w, F.d, 6.5, 1, 3.6, 'warehouse', 'brick', { top: rng.chance(0.4) ? 'slab' : undefined, wear: 0.9 });
      // the doors, run up and stuck there
      for (const dx of [-11, 11]) b.box(dx, 3.7, F.front - 0.05, 4.2, 0.9, 0.1, 'tin_rust', { collide: false });
      // the hall: racks down one side, what was on them, a container nobody came back for
      for (const dx of [2.2, 4.6, 7.0]) cont(b, CONT.SHELF, 'shelf', F.L + dx, backZ(F, 0.5), 0, { seed: dx | 0 });
      cont(b, CONT.CRATE, 'crate', F.L + 2, F.cz - 2, 0.3);
      b.cont(CONT.FREIGHT, 4, F.cz + 3.4, { prop: 'crate', ry: 0.5, ly: FLOOR_Y, seed: 1 });
      b.prop('shipping_container', -3, F.cz + 2.4, PI / 2 + 0.06, { ly: FLOOR_Y, seed: rng.int(0, 2) });
      for (const [px, pz] of [[-13, F.cz - 3], [-12.4, F.cz + 0.6], [8, F.cz - 3.4], [10.4, F.cz + 3.8]]) b.prop('pallet', px, pz, rng.range(0, 3), inside);
      b.prop('pallet', -13, F.cz - 3, 0.3, { ly: FLOOR_Y + 0.15 });
      b.prop('barrel', 12.4, F.cz - 4.6, 0, inside);
      b.prop('barrel', 13.4, F.cz - 4.4, 0, { ly: FLOOR_Y, seed: 1 });
      b.prop('tire_pile', 6.4, backZ(F, 1.5), 0, inside);
      b.loot(-8, F.cz - 3, FLOOR_Y + 0.02);
      b.loot(2, F.cz - 4, FLOOR_Y + 0.02);
      // the office
      cont(b, CONT.LOCKER, 'locker', rightX(F, 0.5), F.back - 3, PI / 2);
      extra(b, 'office_desk', F.R - 3.6, F.back - 1.2, PI, inside);
      extra(b, 'filing_cabinet', F.R - 6.2, F.back - WALL - 0.6, 0, inside);
      b.prop('office_chair', F.R - 3.4, F.back - 2.4, 2, { nocollide: true, ly: FLOOR_Y });
      b.loot(F.R - 2, F.back - 4, FLOOR_Y + 0.02);
      mess(b, F, 12);
      // out front: a truck that was backing in
      yard(b, F, L);
      signAt(b, 0, 5.4, F.front - 0.14, 0, 9, 6.5, 'ghost', { far: true });
    },
    // What the tower's shaft fell on: the buildings that stood here are under it (the streets lay the shaft's
    // lengths, and their rubble; inFall: where). What it missed of them: stumps of walls, heaps, what burnt after.
    crushed(b, L, inFall) {
      const pts = [];
      for (let k = 0; k < 26; k++) pts.push([rng.range(-L.w / 2 + 2.6, L.w / 2 - 2.6), rng.range(-L.d / 2 + 2.6, L.d / 2 - 2.6), rng(), rng()]);
      const clear = (lx, lz, r) => !inFall(b.wx(lx, lz), b.wz(lx, lz), r);
      // walls along the lot's edges where the shaft did not land
      for (const [x0, z0, x1, z1] of [[-L.w / 2 + 1.2, L.d / 2 - 1.2, L.w / 2 - 1.2, L.d / 2 - 1.2], [-L.w / 2 + 1.2, -L.d / 2 + 1.2, -L.w / 2 + 1.2, L.d / 2 - 1.6], [L.w / 2 - 1.2, -L.d / 2 + 1.2, L.w / 2 - 1.2, L.d / 2 - 1.6], [-L.w / 2 + 1.6, -L.d / 2 + 1.2, L.w / 2 - 1.6, -L.d / 2 + 1.2]]) {
        const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 7));
        for (let k = 0; k < n; k++) {
          const [a0, a1] = [k / n, (k + 0.86) / n];
          const p = [x0 + (x1 - x0) * a0, z0 + (z1 - z0) * a0, x0 + (x1 - x0) * a1, z0 + (z1 - z0) * a1];
          const H = rng.range(2.5, 8);
          const keep = rng.chance(0.75);
          if (!keep || !clear((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, 4.5)) continue;
          jagged(b, ...p, PAVE, H, 'brick', true, { inner: 'plaster', soot: rng.chance(0.4) });
        }
      }
      let n = 0;
      for (const [lx, lz, r1, r2] of pts) {
        if (!clear(lx, lz, 3.4)) continue;
        if (n < 3 && heaps.every((h) => Math.hypot(h.x - b.wx(lx, lz), h.z - b.wz(lx, lz)) > 7)) {
          heap(b, lx, lz, 2 + r1 * 1.6, 1.8 + r2 * 1.4, 0.9 + r1 * 0.9, { brick: 0.6, ry: r2 * 3 });
          n++;
        } else b.prop(['debris', 'litter', 'glass_shards', 'skeleton', 'debris', 'bones'][(r1 * 6) | 0], lx, lz, r2 * 6, { nocollide: true, ly: PAVE, seed: (r2 * 3) | 0 });
        weed(b, lx + 1, lz - 1, 0.7 + r1 * 0.6);
      }
      // (a bag somebody left, in whichever corner of it nothing came down on)
      const corner = [[1, 1], [-1, 1], [1, -1], [-1, -1]].find(([sx, sz]) => clear(sx * (L.w / 2 - 2.6), sz * (L.d / 2 - 2.6), 1.5) && heaps.every((h) => Math.hypot(h.x - b.wx(sx * (L.w / 2 - 2.6), sz * (L.d / 2 - 2.6)), h.z - b.wz(sx * (L.w / 2 - 2.6), sz * (L.d / 2 - 2.6))) > Math.max(h.rx, h.rz) + 1.6));
      if (corner) {
        b.cont(CONT.DUFFEL, corner[0] * (L.w / 2 - 2.6), corner[1] * (L.d / 2 - 2.6), { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
        b.loot(corner[0] * (L.w / 2 - 3.4), corner[1] * (L.d / 2 - 2.6), PAVE + 0.02);
      }
      smoke(b, 0, 2, 0);
    },
  };
  // the set places first, on lots drawn at random, then whatever the seed deals for the rest
  let fall = null; // the tower that fell: { dir, xs, zc, lot, inFall(x, z, pad) }
  {
    const order = lots.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const plan = new Map();
    // (the tower whose shaft came down: the first big lot. It fell across the street beside its block - east, or
    // west from the city's last column - onto what stood on the far side: those lots are under it.)
    const fi = order.find((i) => lots[i].w > 40 && lots[i].d > 40);
    if (fi !== undefined) {
      const T = lots[fi];
      const dir = T.bi < GRID - 1 ? 1 : -1;
      const xs = city.x - G2 + (T.bi + (dir > 0 ? 1 : 0)) * PITCH;
      if (Math.abs(Math.sin(T.ry)) > 0.5) T.ry = 0; // (it faces north or south: the shaft fell along its flank, clear of its doors)
      // (the shaft stood in the middle of the tower: SETBACK and the tower's depth put that 4.8 m toward the lot's front)
      const zc = T.z + Math.cos(T.ry) * -4.8;
      T.fell = true;
      plan.set(fi, 'tower');
      fall = { dir, xs, zc, lot: T, bi: T.bi + (dir > 0 ? 1 : 0), bj: T.bj, inFall: (x, z, pad = 0) => (x - xs) * dir > 5 - pad && (x - xs) * dir < 28.5 + pad && Math.abs(z - zc) < 10.5 + pad };
      fallenAt = [xs, city.z - G2 + (T.bj + 0.5) * PITCH];
      lots.forEach((L, i) => {
        if (L.bi !== T.bi + dir || L.bj !== T.bj) return;
        // (does the lot reach into where the shaft lies?)
        const [hx, hz] = Math.abs(Math.sin(L.ry)) > 0.5 ? [L.d / 2, L.w / 2] : [L.w / 2, L.d / 2];
        const near = dir > 0 ? L.x - hx : L.x + hx;
        if ((near - xs) * dir < 27 && L.z - hz < zc + 10.5 && L.z + hz > zc - 10.5) plan.set(i, 'crushed');
      });
    }
    const left = order.filter((i) => !plan.has(i));
    const big = left.filter((i) => lots[i].w > 40 && lots[i].d > 40);
    const long = left.filter((i) => lots[i].w > 40 && lots[i].d < 40);
    const small = left.filter((i) => lots[i].w < 40);
    const deal = (from, list) => list.forEach((what) => from.length && plan.set(from.shift(), what));
    // (two of each: the towers, and the parts shops the plane's magneto may be in)
    deal(big, ['hospital', 'collapse', 'depot', 'tower', 'tower']);
    deal(small, ['aero', 'aero', 'office', 'office', 'office', 'police', 'pharmacy', 'hardware', 'church', 'gas', 'subway']);
    deal(long, ['carpark', 'cinema', 'terrace', 'block', 'warehouse', 'terrace', 'block']);
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
      if (SHOP[what]) BUILD.shop(b, L, what);
      else if (what === 'office') BUILD.tower(b, L, false);
      else if (what === 'tower') BUILD.tower(b, L, true);
      else if (what === 'crushed') BUILD.crushed(b, L, fall.inFall);
      else BUILD[what](b, L);
    });
  }
  // The streets. Every few metres of them: the traffic that stopped for good - wrecks nose to tail, doors standing
  // open, burnt-out shells, one run up onto the pavement or into a shop front - lamps, hydrants, meters, bins,
  // benches, letter boxes and booths along the kerbs, rubbish, paper and broken glass, what people carried and
  // dropped, the dead where they fell, slabs of the roadway heaved up, weeds along every kerb and saplings in the
  // cracks. A few stretches are worse: a roadblock the army held to the last (wire, sandbags, a knocked-out
  // carrier, its dead), a jam that never moved, a hole the street fell into, and the shaft of a tower lying across
  // the road and the block beyond - climbed through where it broke, or gone round. Whatever would stand in
  // something already there is left out, after its draws.
  {
    const b = new Builder(city.x, city.z, 0, cityH);
    b.zone = ZONE.CITY;
    b.ground = true; // (the roadway lies a little under the city's level: what is on it stands on the ground)
    const free = (type, lx, lz, ry) => !propBlocked(type, b.wx(lx, lz), b.wz(lx, lz), ry);
    // which stretch is which: i, the street; k, the block along it; ns, which way it runs
    const key = (i, k, ns) => `${i}:${k}:${ns ? 1 : 0}`;
    const kinds = new Map();
    // (where a hole would be dug in a stretch: nothing that came down off a lot lies on its lip)
    const holeAt = (i, k, ns) => (ns ? [city.x - G2 + i * PITCH, city.z - G2 + (k + 0.5) * PITCH + 6] : [city.x - G2 + (k + 0.5) * PITCH + 6, city.z - G2 + i * PITCH]);
    const heaped = (i, k, ns) => heaps.some((q) => Math.hypot(q.x - holeAt(i, k, ns)[0], q.z - holeAt(i, k, ns)[1]) < 14);
    const mark = (kind, n) => {
      for (let tries = 0; n > 0 && tries < 80; tries++) {
        const ns = rng.chance(0.5);
        const i = rng.int(0, GRID);
        const k = rng.int(0, GRID - 1);
        if (kinds.has(key(i, k, ns)) || (kind === 'hole' && ((!ns && i === GRID / 2) || heaped(i, k, ns)))) continue; // (no hole in Main Street: Route 9 is the way through)
        kinds.set(key(i, k, ns), kind);
        n--;
      }
    };
    if (fall) kinds.set(key(fall.bi, fall.bj, true), 'fallen');
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
    const pickW = (W) => {
      let r = rng() * W.reduce((s, e) => s + e[1], 0);
      for (const [t, wt] of W) if ((r -= wt) <= 0) return t;
      return W[0][0];
    };
    const TRAFFIC = [['car_wreck', 3], ['car_burnt', 2.4], ['car_open', 2.8], ['pickup_truck', 1.1], ['van_wreck', 1.1], ['ambulance', 0.3], ['box_truck', 0.45]];
    const LITTER = ['litter', 'litter', 'paper_scatter', 'paper_scatter', 'glass_shards', 'glass_shards', 'debris', 'suitcases', 'bicycle', 'stroller', 'skeleton', 'corpse', 'bones', 'traffic_cones', 'shopping_cart', 'blood_pool', 'litter', 'debris'];
    const hasTrunk = (type) => type === 'car_wreck' || type === 'car_open';
    for (let i = 0; i <= GRID; i++) {
      for (let k = 0; k < GRID; k++) {
        for (const ns of [true, false]) {
          // (the stretch of street i between crossings k and k + 1, north-south or east-west)
          const o = -G2 + i * PITCH;
          const m = -G2 + (k + 0.5) * PITCH;
          const at = (along, across) => (ns ? [o + across, m + along] : [m + along, o + across]);
          const yaw = ns ? 0 : PI / 2;
          // which way a thing is turned for its front (-Z) to look down the street (sign of along), or across it
          // toward its middle (from the side `sgn` of it)
          const faceAlong = (sign) => (ns ? (sign > 0 ? PI : 0) : sign > 0 ? -PI / 2 : PI / 2);
          const faceIn = (sgn) => (ns ? (sgn * PI) / 2 : sgn > 0 ? 0 : PI);
          const kind = kinds.get(key(i, k, ns));
          // (the paving of a block stands PAVE over the city's level from 3.7 m off a street's middle - where there is
          // a block: the outer side of an edge street is a verge. What is put on it stands on it.)
          const onPave = (across) => (Math.abs(across) > 3.75 && (across > 0 ? i < GRID : i > 0) ? { ly: PAVE } : {});
          const litter = (type, along, across, o2 = {}) => b.prop(type, ...at(along, across), rng.range(0, 6), { nocollide: true, seed: rng.int(0, 2), ...onPave(across), ...o2 });
          const put = (type, along, across, ry, o2 = {}) => extra(b, type, ...at(along, across), ry, { ...onPave(across), ...o2 });
          const car = (type, along, across, ry, trunk = false) => {
            const [x, z] = at(along, across);
            if (!PROPS[type] || !fits(b, type, x, z, ry, onPave(across).ly ?? 0)) return false;
            b.wreck(type, x, z, ry, { trunk: trunk && hasTrunk(type), zone: ZONE.ROADSIDE, ...onPave(across) });
            return true;
          };
          // weeds along both kerbs and up the middle of the road, whatever else is here
          for (let n = rng.int(7, 11); n > 0; n--) weed(b, ...at(rng.range(-21, 21), (rng.chance(0.5) ? 1 : -1) * rng.range(3.5, 3.95)), rng.range(0.5, 1.1));
          for (let n = rng.int(2, 4); n > 0; n--) weed(b, ...at(rng.range(-21, 21), rng.range(-0.5, 0.5)), rng.range(0.25, 0.45));
          if (kind === 'fallen') continue; // (laid after the rest: below)
          // the kerbs: a lamp at either end, meters down one side, and what a city sets along its pavements
          {
            const [lx, lz] = at(-20, 4.5);
            if (free('streetlight', lx, lz, 0)) b.prop('streetlight', lx, lz, ns ? PI / 2 : 0, onPave(4.5)); // (its arm out over the roadway)
            const [rx, rz] = at(14, -4.5);
            const there = rng.chance(0.7);
            if (there && free('streetlight', rx, rz, 0)) b.prop('streetlight', rx, rz, ns ? -PI / 2 : PI, onPave(-4.5));
            const side = rng.chance(0.5) ? 1 : -1;
            for (let a = -15; a <= 15; a += 6) {
              const here = rng.chance(0.6);
              if (here) put('parking_meter', a + rng.range(-0.4, 0.4), side * 4.15, faceIn(side) + rng.range(-0.2, 0.2));
            }
            for (const sgn of [-1, 1]) {
              const row = [['fire_hydrant', 0.55], ['trash_bin', 0.8], ['street_bench', 0.5], ['mail_dropbox', 0.35], ['newspaper_box', 0.45], ['trash_bin', 0.35], ['phone_booth', 0.22], ['pole_leaning', 0.14]];
              for (const [type, p] of row) {
                const here = rng.chance(p);
                const along = rng.range(-18, 18);
                const across = sgn * (type === 'street_bench' || type === 'phone_booth' ? 5.2 : rng.range(4.3, 4.7));
                const turn = rng.range(-0.15, 0.15);
                if (here) put(type, along, across, (type === 'phone_booth' ? faceIn(-sgn) : faceIn(sgn)) + turn);
              }
            }
          }
          if (kind === 'block') {
            // A roadblock, and the last stand made at it. d: which way it faced (what came, came from -d).
            const s0 = rng.range(-5, 5);
            const d = rng.chance(0.5) ? 1 : -1;
            for (const across of [-2.1, 1.5]) put('jersey_barrier', s0, across, yaw);
            for (const across of [-5.3, 5.3]) put('tank_trap', s0 - d * 0.4, across, rng.range(0, 3));
            put('concertina', s0 - d * 3.4, 0.2, yaw + rng.range(-0.06, 0.06));
            put('concertina', s0 - d * 6.6, -0.6, yaw + rng.range(-0.2, 0.2));
            put('sandbag_nest', s0 + d * 3.3, -1.5, faceAlong(-d));
            b.prop('mg_tripod', ...at(s0 + d * 3.6, -1.5), faceAlong(-d), { nocollide: true });
            put('sandbags', s0 + d * 2.4, 2.4, yaw);
            const carrier = rng.chance(0.6);
            if (carrier) put('apc_wreck', s0 + d * 9.4, 0.3, yaw + PI / 2 + rng.range(-0.35, 0.35));
            else put('army_truck', s0 + d * 10, -1.8, faceAlong(-d) + rng.range(-0.2, 0.2));
            const second = rng.chance(0.6);
            if (second) put('army_truck', s0 + d * 17, 1.8, faceAlong(d) + rng.range(-0.15, 0.15), { seed: 1 });
            put('floodlight_tower', s0 + d * 5.4, -5.0, faceAlong(-d));
            put('checkpoint_sign', s0 - d * 9, 2.2, faceAlong(-d) + rng.range(-0.2, 0.2));
            // the order on its posts, facing what came
            {
              const [qx, qz] = at(s0 - d * 1.2, 5.6);
              const posts = [-0.8, 0.8].map((dq) => (ns ? [qx + dq, qz] : [qx, qz + dq]));
              if (posts.every(([px, pz]) => fits(b, 'parking_meter', px, pz, 0, PAVE))) {
                for (const [px, pz] of posts) b.cyl(px, onPave(5.6).ly ?? 0, pz, 0.06, 2.9, 'rust', { sides: 6 });
                signAt(b, qx, 2.3 + (onPave(5.6).ly ?? 0), qz, faceAlong(-d), 2.0, 1.0, 'quarantine', { far: true, back: 0.05 });
              }
            }
            const [cx, cz] = at(s0 + d * 4.6, 3.6);
            if (fits(b, 'military_crate', cx, cz, yaw)) b.cont(CONT.AMMO_BOX, cx, cz, { prop: 'military_crate', ry: yaw, zone: ZONE.ROADBLOCK });
            put('field_cot', s0 + d * 7, 5.4, yaw + PI / 2);
            put('barrel', s0 + d * 6.2, -3.2, 0);
            // those who held it, and those who came at it
            for (let n = 0; n < 9; n++) {
              const behind = n < 4;
              litter(['corpse', 'skeleton', 'body_bag', 'skeleton', 'corpse', 'bones'][rng.int(0, 5)], s0 + d * (behind ? rng.range(1, 8) : -rng.range(1, 14)), rng.range(-6, 6));
            }
            for (let n = 0; n < 4; n++) litter('blood_pool', s0 + rng.range(-9, 9), rng.range(-5, 5));
            for (let n = 0; n < 3; n++) litter(['glass_shards', 'litter', 'suitcases'][n], s0 - d * rng.range(6, 16), rng.range(-5, 5));
            // the last cars that tried it
            for (const [dd, across, turn] of [[11, -1.8, 0.2], [13.4, 1.9, -0.5], [18, -1.6, 0.1]]) {
              const type = pickW(TRAFFIC.slice(0, 4));
              const ry = faceAlong(d) + turn * rng.range(0.4, 1.4);
              car(type, s0 - d * dd, across, ry, rng.chance(0.5));
            }
            continue;
          }
          if (kind === 'jam') {
            // bumper to bumper, both lanes, doors open where their people got out and ran: the last traffic the
            // street ever had. A bus in the middle of it.
            const busAt = rng.int(1, 4);
            const busLane = rng.chance(0.5) ? 1 : -1;
            for (let n = 0; n < 7; n++) {
              for (const sgn of [-1, 1]) {
                const type = pickW(TRAFFIC);
                const ry = yaw + (sgn > 0 ? PI : 0) + rng.range(-0.12, 0.12);
                const gone = rng.chance(0.1);
                const along = -19.5 + n * 6.2 + rng.range(-0.4, 0.4);
                const across = sgn * rng.range(1.75, 2.05);
                const trunk = rng.chance(0.5);
                if (sgn === busLane && n === busAt) car('city_bus', along + 3, sgn * 1.95, yaw + (sgn > 0 ? PI : 0) + rng.range(-0.04, 0.04));
                else if (!gone) car(type, along, across, ry, trunk);
              }
            }
            for (let n = rng.int(10, 14); n > 0; n--) litter(['suitcases', 'litter', 'suitcases', 'paper_scatter', 'corpse', 'skeleton', 'stroller', 'glass_shards', 'bicycle'][rng.int(0, 8)], rng.range(-20, 20), rng.range(-6.4, 6.4));
            continue;
          }
          const hole = kind === 'hole';
          // the roadway: what was driving down it
          const nv = hole ? 2 : rng.int(3, 6);
          for (let n = 0; n < nv; n++) {
            const sgn = n % 2 ? 1 : -1;
            const along = hole ? rng.range(-20, -7) : -19 + (n + rng.range(0.15, 0.85)) * (38 / nv); // (a hole is at +6: clear of it)
            const type = pickW(TRAFFIC);
            const crash = rng.chance(0.2);
            const ry = yaw + (sgn > 0 ? PI : 0) + (crash ? rng.range(-0.9, 0.9) : rng.range(-0.22, 0.22));
            const across = sgn * rng.range(1.5, 2.3);
            const trunk = rng.chance(0.4);
            const here = rng.chance(0.9);
            if (here) car(type, along, across, ry, trunk);
          }
          // (...one more that ran up onto the pavement, or into the front of a shop: its glass all round it)
          {
            const up = rng.chance(0.6);
            const sgn = rng.chance(0.5) ? 1 : -1;
            const into = rng.chance(0.45);
            const along = hole ? rng.range(-20, -7) : rng.range(-17, 17);
            const type = pickW(TRAFFIC.slice(0, 5));
            const ry = into ? faceIn(-sgn) + rng.range(-0.45, 0.45) : yaw + rng.range(-0.5, 0.5);
            const ok = up && car(type, along, sgn * (into ? 5.5 : rng.range(4.75, 4.95)), ry);
            if (ok && into) {
              litter('glass_shards', along + rng.range(-1, 1), sgn * 6.6);
              litter('debris', along + rng.range(-1.5, 1.5), sgn * 6.4);
            }
          }
          // what came down off the buildings either side: slabs and lumps along the kerbs
          for (let n = rng.int(2, 5); n > 0; n--) {
            const across = (rng.chance(0.5) ? 1 : -1) * rng.range(4.2, 6.2);
            const [x, z] = at(rng.range(-20, 20), across);
            skirt(b, x, z, onPave(across).ly ?? 0.02);
          }
          // what lies about: every few metres of it
          for (let n = rng.int(11, 16); n > 0; n--) litter(LITTER[rng.int(0, LITTER.length - 1)], rng.range(-21, 21), rng.range(-6.6, 6.6));
          {
            const r = rng();
            const pa = rng.range(-18, 18);
            const rim = hole && Math.abs(pa - 6) < 9; // (nothing solid on the lip of a hole)
            const across = (rng.chance(0.5) ? 1 : -1) * rng.range(4.6, 5.2);
            const pr = rng.range(0, 6);
            const [px, pz] = at(pa, across);
            if (r < 0.3) litter('pole_down', rng.range(-8, 8), rng.range(-1, 1), { ry: undefined });
            else if (r < 0.5 && !rim && fits(b, 'dumpster_tipped', px, pz, pr, PAVE)) b.cont(CONT.DUMPSTER, px, pz, { prop: 'dumpster_tipped', ry: pr, ...onPave(across) });
            else if (r < 0.62 && !rim) put('barricade', pa, across, yaw + PI / 2);
          }
          // the roadway, heaved: slabs of it tipped up out of the street (round a hole, all of its rim)
          for (let n = hole ? 7 : rng.int(1, 3); n > 0; n--) {
            const [hx, hz] = hole ? at(6 + Math.sin(n * 0.9) * rng.range(4.4, 6.2), Math.cos(n * 0.9) * rng.range(3.6, 5.2)) : at(rng.range(-20, 20), rng.range(-3.4, 3.4));
            b.box(hx, -0.1, hz, rng.range(1.4, 2.6), 0.2, rng.range(1.2, 2.2), 'concrete', { ry: rng.range(0, 3), rz: rng.range(-0.34, 0.34), rx: rng.range(-0.2, 0.2), collide: false });
          }
          for (let n = rng.int(0, 2); n > 0; n--) b.tree(...at(rng.range(-20, 20), (rng.chance(0.5) ? 1 : -1) * rng.range(4.9, 5.6)), 5, rng.range(0.45, 0.75)); // (a birch, out of a crack)
        }
      }
    }
    // The shaft of the tower that fell, where it lies: three lengths of it end to end from the foot of what still
    // stands - the first against the podium, the second across the far pavement and into the block beyond, the
    // third on what it crushed there - broken apart over the roadway, where the rubble between them is the way
    // through. (across: they are the one thing built in a road.)
    if (fall) {
      const { dir, xs, zc, lot } = fall;
      const lx = xs - city.x;
      const lz = zc - city.z;
      const st = lot.shaft || { style: 'office', fh: 3.3 };
      // (each a little askew of the last, and none of them level: tilt - its far end up)
      const length = (x0, x1, w, h, tilt, skew) => {
        const cx = lx + (dir * (x0 + x1)) / 2;
        solid(b, cx, 0.02, lz, Math.abs(x1 - x0), h, w, 'concrete', { ry: skew }).across = true;
        fallenBits.push({ x: b.wx(cx, lz), y: b.y0 + 0.02, z: b.wz(cx, lz), ry: (dir > 0 ? 0 : PI) + skew, len: Math.abs(x1 - x0), w, h, fh: st.fh, style: st.style, mat: 'concrete', seed: rng.int(1, 99999), tilt });
      };
      length((lot.x + dir * 17 - xs) * dir + 0.5, -1.9, 15, 7.6, -0.14, 0.02); // (from the podium's flank, its end there up on what it broke off: it is 34 m across)
      length(1.9, 12.4, 15, 6.4, 0.05, -0.05);
      length(14.4, 22.6, 14, 4.6, -0.08, 0.07);
      // the break over the roadway: rubble to the height of a man, and at either mouth of it
      heap(b, lx, lz, 1.7, 6.6, 1.6, { across: true, ly: 0.02 });
      for (const sz of [-1, 1]) heap(b, lx + rng.range(-0.6, 0.6), lz + sz * 9.6, 3.2, 2.6, 1.3, { across: true, ly: 0.02, ry: rng.range(-0.3, 0.3) });
      // (...between the second length and the third, and the last of it beyond)
      heap(b, lx + dir * 13.4, lz + rng.range(-3, 3), 1.2, 4.6, 2.2, { ly: PAVE });
      heap(b, lx + dir * 25.4, lz + rng.range(-2, 2), 2.6, 5.0, 2.2, { ly: PAVE });
      for (const [dx, dz] of [[7, -9.6], [8, 9.8], [18.6, -9.2], [19.4, 9.4], [11.6, -9.9], [12.4, 10], [22.6, 9.8], [23, -9.7]]) heap(b, lx + dir * dx, lz + dz, rng.range(2.2, 3), rng.range(1.7, 2.3), rng.range(0.9, 1.5), { ly: PAVE, ry: rng.range(-0.4, 0.4) });
      // (slabs of its skin against it, where they slid off)
      for (let n = 0; n < 10; n++) {
        const sd = n % 2 ? 1 : -1;
        b.box(lx + dir * rng.range(2, 22), PAVE + rng.range(0.5, 1.6), lz + sd * rng.range(7.9, 8.6), rng.range(2.4, 4.4), 0.28, rng.range(2, 3.4), 'concrete', { rx: sd * rng.range(0.7, 1.15), ry: rng.range(-0.3, 0.3), collide: false });
      }
      for (const [dx, dz] of [[-5, -9.4], [-5.4, 9.6], [-1, -13], [2, 13.4], [10, -12.4], [11, 12.6]]) skirt(b, lx + dir * dx, lz + dz, Math.abs(dx) < 3.7 ? 0.02 : PAVE);
      // what it landed on, under its second length
      b.prop('car_burnt', lx + dir * 4.6, lz + 10.6, 0.1, { nocollide: true, seed: 1 });
      b.prop('pole_down', lx - dir * 3, lz - 11.6, 1.2, { nocollide: true });
      for (let n = 0; n < 8; n++) b.prop(['debris', 'glass_shards', 'paper_scatter', 'litter'][n & 3], lx + rng.range(-6, 6), lz + (n % 2 ? 1 : -1) * rng.range(8.6, 16), rng.range(0, 6), { nocollide: true, seed: n & 1 });
      smoke(b, lx + dir * 7, 5, lz);
    }
    // the crossings: lights dead over them (one in three down), here and there the two that met in the middle
    for (let i = 1; i < GRID; i++) {
      for (let j = 1; j < GRID; j++) {
        const x = -G2 + i * PITCH;
        const z = -G2 + j * PITCH;
        const main = j === GRID / 2;
        const r = rng();
        const crash = rng.chance(0.3);
        const [t1, t2] = [rng.range(0, 6), rng.range(0, 6)];
        if (main || r < 0.5) {
          if ((i + j) % 3 === 1) b.prop('pole_down', x + 4.4, z - 4.6, 0.7, { nocollide: true, seed: 1 });
          else if (fits(b, 'traffic_light', x + 5.2, z - 5.2, PI, PAVE)) b.prop('traffic_light', x + 5.2, z - 5.2, PI, { ly: PAVE }); // (their arms out over the cross street)
          if (fits(b, 'traffic_light', x - 5.2, z + 5.2, 0, PAVE)) b.prop('traffic_light', x - 5.2, z + 5.2, 0, { ly: PAVE });
        }
        if (crash && !(fall && Math.hypot(x - (fall.xs - city.x), z - (fall.zc - city.z)) < 34)) {
          const a = pickW(TRAFFIC.slice(0, 5));
          const c2 = pickW(TRAFFIC.slice(0, 5));
          if (fits(b, a, x - 1.4, z + 0.6, t1)) b.wreck(a, x - 1.4, z + 0.6, t1, { trunk: false, zone: ZONE.ROADSIDE });
          if (fits(b, c2, x + 2.4, z - 1.6, t2)) b.wreck(c2, x + 2.4, z - 1.6, t2, { trunk: false, zone: ZONE.ROADSIDE });
          b.prop('glass_shards', x + 0.4, z - 0.4, t1, { nocollide: true });
        }
        for (let n = rng.int(2, 4); n > 0; n--) b.prop(LITTER[rng.int(0, LITTER.length - 1)], x + rng.range(-5, 5), z + rng.range(-5, 5), rng.range(0, 6), { nocollide: true, seed: rng.int(0, 2) });
      }
    }
    // a bus slewed across one of the crossings, an articulated truck jack-knifed across another
    const jx = -G2 + rng.int(1, GRID - 1) * PITCH;
    const jz = -G2 + [1, 2, 4, 5][rng.int(0, 3)] * PITCH;
    if (fits(b, 'city_bus', jx + 1, jz - 0.5, 0.9)) b.wreck('city_bus', jx + 1, jz - 0.5, 0.9, { trunk: false });
    const tx = -G2 + rng.int(1, GRID - 1) * PITCH;
    const tz = -G2 + [1, 2, 4, 5][rng.int(0, 3)] * PITCH;
    if (fits(b, 'semi_truck', tx - 1, tz + 0.5, 2.2)) b.wreck('semi_truck', tx - 1, tz + 0.5, 2.2, { trunk: false, seed: 1 });
  }

  // THE BRIDGES: wherever a road crosses the river. A concrete deck on piers a little over the water, rusted
  // girders down its sides, what is left of its railings. (A deck is thin: the dead walk over it - server/nav.js.)
  const bridges = [];
  {
    const b = new Builder(0, 0, 0, 0);
    b.zone = ZONE.FOREST;
    for (const road of roads) {
      for (const [i0, i1] of road.spans) {
        const p = road.pts;
        const [a, e] = [Math.max(0, i0 - 3), Math.min(p.length / 2 - 1, i1 + 3)];
        // (only where it is over the water in fact: a footpath that keeps to the bank has none)
        let over = false;
        for (let i = i0; i <= i1; i++) over ||= heightAt(p[i * 2], p[i * 2 + 1]) < WATER_LEVEL - 0.95;
        if (!over) continue;
        const w = Math.max(5, road.width * 2 + 1.4);
        for (let i = a; i < e; i++) {
          const [x0, z0, x1, z1] = [p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3]];
          const len = Math.hypot(x1 - x0, z1 - z0);
          const ry = Math.atan2(-(z1 - z0), x1 - x0);
          const top = road.hs[i] + 0.02;
          const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
          b.box(cx, top - 0.4, cz, len + 0.3, 0.4, w, 'concrete', { ry });
          const [nx, nz] = [-(z1 - z0) / len, (x1 - x0) / len];
          for (const sd of [-1, 1]) {
            // the girder, and the railing over it: posts and a rail, lengths of it gone
            b.box(cx + nx * sd * (w / 2 - 0.15), top - 1.0, cz + nz * sd * (w / 2 - 0.15), len + 0.3, 1.25, 0.3, 'rust', { ry, collide: false });
            const gone = rng.chance(0.22);
            if (gone) continue;
            b.box(cx + nx * sd * (w / 2 - 0.15), top + 0.25, cz + nz * sd * (w / 2 - 0.15), 0.09, 0.9, 0.09, 'rust', { ry, collide: false });
            b.box(cx + nx * sd * (w / 2 - 0.15), top + 1.08, cz + nz * sd * (w / 2 - 0.15), len + 0.3, 0.08, 0.08, 'rust', { ry, rz: rng.range(-0.05, 0.05), collide: false });
            b.box(cx + nx * sd * (w / 2 - 0.15), top + 0.66, cz + nz * sd * (w / 2 - 0.15), len + 0.3, 0.05, 0.05, 'rust', { ry, collide: false });
          }
          // a pier under every fourth length of it that stands in the water
          const bed = heightAt(cx, cz);
          // (not solid: it stands in the water under the deck, and a solid there is a wall across the deck to the dead)
          if ((i - a) % 4 === 2 && bed < WATER_LEVEL - 0.3) b.box(cx, bed - 0.3, cz, 0.9, top - 0.4 - bed + 0.3, w - 1.2, 'concrete', { ry, collide: false });
        }
        const m = (i0 + i1) >> 1;
        const [dx, dz] = [p[e * 2] - p[a * 2], p[e * 2 + 1] - p[a * 2 + 1]];
        bridges.push({ x: p[m * 2], y: road.hs[m], z: p[m * 2 + 1], ry: Math.atan2(-dz, dx), len: Math.hypot(dx, dz), w });
        clears.push([p[m * 2], p[m * 2 + 1], Math.hypot(dx, dz) / 2 + 3]);
      }
    }
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

  Object.assign(K, { block, groundRoom, partition, signAt, heap, extra, jagged, weed }); // (what the third pass's places are built with)
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
  addPropColliders('fuel_truck', truck.x, truck.y, truck.z, truck.ry, props[props.length - 1]);
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
    // The runway's paint, white once (roadpaint: faded, worn through to the asphalt): the bars of both thresholds,
    // each end's number beyond them - 36 for whoever lands heading north, as the plane will leave, 18 from the other
    // end - the dashed centre line between the two, the aiming marks, the edge lines.
    const paint = (lx, lz, sx, sz) => b.box(lx, -0.045, lz, sx, 0.03, sz, 'roadpaint', { collide: false });
    for (let z = -RUNWAY_LEN / 2 + 62; z < RUNWAY_LEN / 2 - 56; z += 24) if (rng.chance(0.8)) paint(0, z, 0.6, 11);
    for (const end of [-1, 1]) for (let k = -4; k <= 4; k++) if (k) paint(k * 2.3 + (k > 0 ? 0.5 : -0.5), end * (RUNWAY_LEN / 2 - 12), 1.3, 14);
    {
      // the numbers, in strokes: [x, z, across, along] of a digit 3 m wide and 7 m tall, its foot towards the
      // threshold (z = 0) and its head 7 m up the runway
      const T = 0.75;
      const NUMBERS = 37; // (from the runway's end to the foot of its number: past the nose of the plane that stands on the south one)
      const SEG = { a: [0, 7 - T / 2, 3, T], g: [0, 3.5, 3, T], d: [0, T / 2, 3, T], f: [-1.5 + T / 2, 5.25, T, 3.5], b: [1.5 - T / 2, 5.25, T, 3.5], e: [-1.5 + T / 2, 1.75, T, 3.5], c: [1.5 - T / 2, 1.75, T, 3.5] };
      const DIGIT = { 1: 'bc', 3: 'abgcd', 6: 'afgedc', 8: 'abcdefg' };
      for (const [end, digits] of [[1, [3, 6]], [-1, [1, 8]]]) {
        // (read from the approach: heading north at the south end, left is west; the other way at the north end)
        digits.forEach((n, i) => {
          const cx = (i ? 1 : -1) * 2.4 * end;
          for (const s of DIGIT[n]) {
            const [x, z, sx, sz] = SEG[s];
            paint(cx + x * end, end * (RUNWAY_LEN / 2 - NUMBERS - z), sx, sz);
          }
        });
      }
    }
    // ...its edge lights, most of them dark for good, and a windsock at either end
    for (let z = -RUNWAY_LEN / 2 + 6; z <= RUNWAY_LEN / 2 - 6; z += 28) for (const sx of [-1, 1]) b.prop('runway_light', sx * (RUNWAY_HALF + 0.9), z, 0, { nocollide: true, ground: true, seed: (z + sx) & 1 });
    for (const sx of [-1, 1]) for (let z = -RUNWAY_LEN / 2 + 4; z < RUNWAY_LEN / 2 - 20; z += 22) if (rng.chance(0.82)) paint(sx * (RUNWAY_HALF - 0.9), z + 10, 0.4, rng.range(14, 21));
    for (const end of [-1, 1]) for (const dz of [56, 74, 92]) for (const sx of [-1, 1]) if (rng.chance(0.8)) paint(sx * 4.6, end * (RUNWAY_LEN / 2 - dz), 2.2, 9);
    // (...and beyond either end, what brought them in at night: bars of lamps on the grass)
    for (const end of [-1, 1]) for (const dz of [10, 24, 38]) for (let k = -2; k <= 2; k++) b.prop('runway_light', k * 2.4, end * (RUNWAY_LEN / 2 + dz), 0, { nocollide: true, ground: true, seed: (k + dz) & 1 });
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
    // (where the last flights were loaded: the army's trucks, tents for those who waited, the lamps over them)
    b.prop('army_truck', 16, -34, 0.3, { ...on, seed: 0 });
    b.prop('army_truck', 19.6, -46, -0.15, { ...on, seed: 1 });
    b.prop('triage_tent', -18, 22, 0.05, { ...on, seed: 0 });
    b.prop('triage_tent', -11.6, 23, -0.04, { ...on, seed: 1 });
    for (const [cx, cz, r] of [[-19, 20, 0], [-16.8, 24, PI], [-12.6, 21, 0], [-10.4, 25, PI]]) extra(b, 'field_cot', cx, cz, r, { ...on, seed: (cx * 2) & 3 });
    for (const [fx, fz, r] of [[22, 40, 2.4], [-24, -34, 0.6], [22, -64, 3.6]]) extra(b, 'floodlight_tower', fx, fz, r, on);
    for (let i = 0; i < 6; i++) b.prop('body_bag', -6 + i * 1.3, 32.5, PI / 2 + 0.07 * i, { nocollide: true, ly: 0.05, seed: i });
    for (const [lx, lz] of [[-4, 12], [6, -6], [12, 44], [-16, -8], [18, 14], [0, 60], [-10, -52], [8, -62]]) b.prop(['suitcases', 'paper_scatter', 'skeleton', 'litter', 'suitcases', 'traffic_cones', 'stroller', 'glass_shards'][(lx + 16) & 7], lx, lz, lx, { nocollide: true, ly: 0.05, seed: lz & 1 });
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
    // (...and held it: a nest either side of the road, a carrier knocked out in front of it, their order on its posts)
    extra(b, 'sandbag_nest', -5.4, 12.4, PI / 2);
    extra(b, 'sandbag_nest', -5.4, 33, PI / 2, { seed: 1 });
    extra(b, 'apc_wreck', -15, 26.4, 0.5);
    extra(b, 'concertina', -9.4, 16.4, PI / 2 + 0.1);
    extra(b, 'tank_trap', -9, 30, 0.4);
    extra(b, 'tank_trap', -11.4, 11, 1.2);
    extra(b, 'floodlight_tower', 4.6, 30.4, 1.2);
    for (const [lx, lz] of [[-12, 20], [-18, 24], [-8, 23.6], [-21, 18], [-6.6, 27], [3, 24]]) b.prop(['corpse', 'skeleton', 'blood_pool', 'skeleton', 'body_bag', 'suitcases'][(lz * 2) % 6 | 0], lx, lz, lx, { nocollide: true, seed: lz & 1 });
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
    // (each: the frame showing down its flanks, rust run down its front from the door's rail, an engine hoist)
    for (const lx of [-30, 0, 30]) {
      for (const dz of [-6, 0, 6, 12, 18]) for (const sx of [-1, 1]) b.box(lx + sx * 12.24, 0, dz, 0.2, 8, 0.3, 'rust', { collide: false });
      b.box(lx, 6.5, -6.4, 24.4, 0.3, 0.3, 'rust', { collide: false });
      for (const dx of [-9, -3, 4, 9.5]) signAt(b, lx + dx, 6.4 - 1.4, -6.16, 0, 0.9, 2.8, dx > 0 ? 'rust_a' : 'rust_b', { grime: true, far: true });
      signAt(b, lx + 8.6, 2.2, -6.16, 0, 1.4, 1.4, lx ? 'xcode_a' : 'xcode_b', {});
    }
    hangar(-30, 0).prop('light_plane', 1.5, 0, 0.35, { ly: FLOOR_Y, seed: 1 });
    hangar(0, 1).wreck('pickup_truck', -4, 2, 0.3, { ly: FLOOR_Y, trunk: false });
    const h3 = hangar(30, 2);
    h3.prop('pallet', 3, 2, 0.3, { ly: FLOOR_Y });
    h3.cont(CONT.AMMO_BOX, -6, 4, { prop: 'military_crate', ry: 0.4, ly: FLOOR_Y });
    b.prop('generator', 0, 20.5, 0.2);
    b.cont(CONT.DUMPSTER, 45, 2, { prop: 'dumpster', ry: PI / 2 });
    for (const [lx, lz, r] of [[-44, -8, 0.3], [44, -10, 2.2]]) extra(b, 'floodlight_tower', lx, lz, r);
    extra(b, 'box_truck', -47, -14, 0.2);
    extra(b, 'van_wreck', 46, 14, 2.9);
    for (const [lx, lz] of [[-14, -9], [16, -11], [34, -9.4], [-36, -10]]) b.prop(['barrel', 'tire_pile', 'pallet', 'barrel'][(lx + 36) & 3], lx, lz, lx, { seed: lz & 1 });
    for (const [lx, lz] of [[-6, -10], [22, -12], [-24, -11.4], [8, -13], [38, -13]]) b.prop(['litter', 'paper_scatter', 'skeleton', 'suitcases', 'debris'][(lx + 24) % 5 | 0], lx, lz, lx, { nocollide: true, seed: lz & 1 });
    b.wreck('car_wreck', -46.5, 10, 0.4);
    b.prop('streetlight', 15, -9, 0);
    b.prop('streetlight', -15, -9, 0);
    b.prop('corpse', 3, -12, 2, { nocollide: true });
    b.loot(-15, -11);
  });
  place(ZONE.TERMINAL, (b) => {
    // The terminal: a hall with its desk and its rows of seats, a back office, a lounge of glass over half of it,
    // a canopy the length of its front, CALDER FIELD on its roof - and the tower at its north end, the cab on top.
    const R = groundRoom(b, 0, 2, 26, 14, 4.4, 'concrete', { n: [door(13, 1.8), win(5, 5, 0.7, 3.4), win(21, 5, 0.7, 3.4)], s: [door(20, 1.3), win(8, 4, 0.9, 3)], w: [win(7, 3, 0.9, 3)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, tint: 2 });
    partition(b, R, 6, -5, 6, 9, 4.4, 'concrete', [door(9, 1.3)]);
    // (the back of it is two rooms: the office, and through a door of that the radio room; and the hall has a wall
    // between check-in and the baggage belt, open at its end)
    partition(b, R, 6, 2, 13, 2, 4.4, 'concrete', [door(1.6, 1.2)]);
    partition(b, R, -13, -1.7, -5, -1.7, 4.4, 'concrete');
    zone(R, 6, 2, 13, 9, 4);
    zone(R, 6, -5, 13, 2, 0);
    zone(R, -13, -5, -5, -1.7, 5);
    drumFire(b, 2.6, 0.9);
    b.prop('reception_desk', -4, 0, 0, { ly: 0.12 }); // the check-in desk
    b.loot(-4, 0, 1.26);
    for (const lx of [-9.6, -7.4, -3.6, -1.4]) b.prop('waiting_chairs', lx, 5.6, 0, { ly: 0.12, seed: lx & 1 });
    b.cont(CONT.LOCKER, 12.1, 6, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
    b.cont(CONT.CABINET, 9.6, 8.2, { prop: 'cabinet', ry: PI, ly: 0.12 });
    b.cont(CONT.FRIDGE, -12.1, 6.4, { prop: 'fridge', ry: PI / 2, ly: 0.12 });
    b.prop('table', 9.4, 0, 0, { ly: 0.12 });
    b.loot(9.4, 0, 0.94);
    part(b, 3, 11.4, -3.6, 0.14); // the flight radio, in the back office...
    extra(b, 'office_desk', 10.6, 4.2, -PI / 2, { ly: 0.12 });
    extra(b, 'filing_cabinet', 7.2, 8.2, PI, { ly: 0.12 });
    extra(b, 'vending_machine', -12.2, 1.6, PI / 2, { ly: 0.12 });
    extra(b, 'vending_machine', -12.2, 0.4, PI / 2, { ly: 0.12, seed: 1 });
    for (const [lx, lz] of [[-6, 3], [2, -2], [-10, -3], [3, 6.5]]) b.prop(['paper_scatter', 'ceiling_debris', 'blood_pool', 'office_chair'][(lx + 10) & 3], lx, lz, lx, { nocollide: true, ly: 0.12, seed: lz & 1 });
    for (const lx of [-8, 0]) b.prop('ceiling_lamp', lx, 2, 0, { nocollide: true, ly: 4.4, seed: lx & 1 });
    // the baggage hall: the belt, what never got claimed
    b.box(-8, 0.12, -3.2, 8, 0.6, 1.2, 'rust');
    for (const [lx, lz, r] of [[-9.4, -0.4, 0.3], [-4, -4.6, 1.2], [1.6, 3, 2], [-11, -4.2, 2.6], [3.6, -3.4, 0.7]]) b.prop('suitcases', lx, lz, r, { nocollide: true, ly: 0.12, seed: lz & 1 });
    b.prop('litter', 0, -2, 1, { nocollide: true, ly: 0.12 });
    b.prop('barricade', 2.6, -2.9, PI / 2, { ly: 0.12 });
    part(b, 3, -11, 5.2, 0.14); // ...or behind the desk
    // the lounge over the hall, its glass mostly gone; the name on the roof's edge
    block(b, -5, 3, 14, 9, 4.7, 1, 3.4, 'glass', 'concrete', { wear: 0.95 });
    for (const px of [-5.4, 0, 5.4]) b.box(px, 4.7, -5.1, 0.14, 1.9, 0.14, 'rust', { collide: false });
    signAt(b, 0, 5.75, -5.28, 0, 12.4, 1.55, 'terminal', { far: true, back: 0.1 });
    // the canopy over the kerb, on its posts
    for (const px of [-10, -3.4, 3.4, 10]) b.cyl(px, 0, -8.6, 0.13, 3.3, 'metal', { sides: 8 });
    b.box(0, 3.3, -7.1, 23, 0.26, 4.2, 'concrete', { collide: false });
    b.roofSpan(0, -7.1, 11.5, 2.1, 3.3, 0.26);
    // the tower: a shaft of four floors over the hall's north end, a walkway round its head, the cab on that - its
    // glass leaning out, half its panes gone - and on the cab's roof the aerials and the beacon
    const top = block(b, 9.5, 5.5, 5, 5, 4.7, 3, 3.1, 'office', 'concrete', { wear: 0.6 });
    b.box(9.5, top, 5.5, 7.4, 0.3, 7.4, 'concrete', { collide: false });
    for (const [dx, dz, w, d] of [[0, -3.6, 7.3, 0.06], [0, 3.6, 7.3, 0.06], [-3.6, 0, 0.06, 7.3], [3.6, 0, 0.06, 7.3]]) {
      b.box(9.5 + dx, top + 1.25, 5.5 + dz, w, 0.06, d, 'rust', { collide: false });
      b.box(9.5 + dx, top + 0.8, 5.5 + dz, w, 0.04, d, 'rust', { collide: false });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(9.5 + sx * 3.6, top + 0.3, 5.5 + sz * 3.6, 0.07, 1.0, 0.07, 'rust', { collide: false });
    b.box(9.5, top + 0.3, 5.5, 4.6, 0.9, 4.6, 'metal', { collide: false });
    for (const [nx, nz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      for (let k = -1; k <= 1; k++) {
        const here = rng.chance(0.62);
        const [px, pz] = [9.5 + nx * 2.45 + (nz ? k * 1.55 : 0), 5.5 + nz * 2.45 + (nx ? k * 1.55 : 0)];
        if (here) b.box(px, top + 1.2, pz, 1.45, 1.9, 0.04, 'glass', { collide: false, ry: nx ? PI / 2 : 0 });
        b.box(9.5 + nx * 2.5 + (nz ? (k + 0.5) * 1.55 : 0), top + 1.2, 5.5 + nz * 2.5 + (nx ? (k + 0.5) * 1.55 : 0), 0.08, 1.95, 0.08, 'metal', { collide: false });
      }
    }
    b.box(9.5, top + 1.2, 5.5, 2.6, 1.0, 2.6, 'dark', { collide: false }); // (the desks, in the dark of it)
    b.box(9.5, top + 3.1, 5.5, 6.6, 0.3, 6.6, 'concrete', { collide: false });
    b.box(9.5, top + 3.4, 5.5, 0.12, 4.4, 0.12, 'metal', { collide: false });
    b.box(8, top + 3.4, 4.4, 0.06, 2.6, 0.06, 'rust', { collide: false, rz: 0.12 });
    b.box(11, top + 3.4, 6.8, 0.06, 1.8, 0.06, 'rust', { collide: false });
    b.box(10.6, top + 3.7, 4.2, 1.5, 0.5, 0.2, 'metal', { collide: false, ry: 0.6 }); // (the radar's bar, where it stopped)
    b.cyl(10.6, top + 3.4, 4.2, 0.1, 0.3, 'rust', { sides: 6, collide: false });
    b.prop('baggage_cart', -18, 2, 0.1);
    b.prop('ivy', -13.16, 4, PI / 2, { nocollide: true });
    // out front: the forecourt, what the last flight out left behind, and the army's last order on its posts
    b.box(0, -0.05, -13, 30, 0.1, 14, 'concrete', { collide: true });
    b.wreck('ambulance', -8, -13.6, 1.4, { ly: 0.05, trunk: false });
    b.wreck('car_open', 6, -15, 0.2, { ly: 0.05, seed: 1 });
    b.wreck('school_bus', 15, 22, 1.5, { trunk: false });
    b.cont(CONT.DUFFEL, -2, -8, { prop: 'duffel_bag', ry: 0.6, nocollide: true, ly: 0.05 });
    b.cont(CONT.DUFFEL, 3.4, -10.5, { prop: 'duffel_bag', ry: 2.1, nocollide: true, ly: 0.05, seed: 1 });
    b.prop('streetlight', -13, -19, PI);
    b.prop('streetlight', 13, -19, PI);
    b.prop('corpse', 0, -16, 0.4, { nocollide: true, ly: 0.05 });
    b.loot(-10, -9, 0.07);
    for (const [lx, lz] of [[-12, -9.6], [-4, -11], [9, -9.2], [12.6, -12], [1, -18], [-9, -18.4]]) b.prop(['suitcases', 'suitcases', 'paper_scatter', 'skeleton', 'stroller', 'litter'][(lx + 12) % 6 | 0], lx, lz, lx * 0.7, { nocollide: true, ly: 0.05, seed: (lz * 3) & 1 });
    extra(b, 'street_bench', -6, -9.1, PI, { ly: 0.05 });
    extra(b, 'street_bench', 6, -9.1, PI, { ly: 0.05, seed: 1 });
    extra(b, 'trash_bin', 11.2, -9.2, 0, { ly: 0.05 });
    extra(b, 'checkpoint_sign', 2.4, -19, 0, { ly: 0.05 });
    extra(b, 'floodlight_tower', -13.4, -14.6, 0.4, { ly: 0.05 });
    for (const dq of [-1.1, 1.1]) b.cyl(12.6 + dq, 0, -19.6, 0.06, 3.2, 'rust', { sides: 6 });
    signAt(b, 12.6, 2.5, -19.68, 0, 2.6, 1.3, 'evac', { far: true, back: 0.05 });
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
    for (const lx of [-12, 0, 12]) {
      for (const dx of [-0.25, 0.25]) b.box(lx + dx, 0, 4.5, 0.05, 8.2, 0.05, 'rust', { collide: false });
      for (let y = 0.5; y < 8; y += 0.5) b.box(lx, y, 4.5, 0.5, 0.04, 0.04, 'rust', { collide: false });
      b.box(lx, 7.6, 9, 9.2, 0.08, 0.08, 'rust', { collide: false }); // (the rail round its roof, seen as a line)
      b.cyl(lx + 2.2, 0, 3.6, 0.14, 0.9, 'rust', { sides: 6, collide: false });
    }
    b.box(0, 0.35, 1.4, 30, 0.22, 0.22, 'rust', { collide: false }); // the main, along the bund
    b.box(-12, 0.35, -3, 0.22, 0.22, 9, 'rust', { collide: false });
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
  const siteOk = (x, z) => !atFence(x, z, SITE_FLAT + 12) && Math.hypot(x - gate[0], z - gate[1]) > 40 && lakeDist(x, z) > 16 && riverAt(x, z) > 18 && pondDist(x, z) > 10 && !inCity(x, z, 26) && farms.every((f) => Math.hypot(f.x - x, f.z - z) > FARM_R + 54) && Math.abs(x) < HALF - 60 && Math.abs(z) < HALF - 60 && !inWater(x, z) && !nearZone(x, z, 26) && !onField(x, z, 14) && x > COAST + 30;
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
      if (truck && !propBlocked('semi_truck', b.wx(tx0, 0), b.wz(tx0, 0), b.ry + tr) && longClear('semi_truck', b.wx(tx0, 0), b.wz(tx0, 0)) && !otherRoad(highway, x, z, 18)) b.wreck('semi_truck', tx0, 0, tr, { trunk: false, seed: ts, zone: ZONE.ROADSIDE });
      // (both lanes, nose to tail: n lengths of it, a gap here and there where one got out)
      for (let n = rng.int(6, 9) * 2, k = 0; k < n; k++) {
        const along = ((k >> 1) - n / 4) * 6.3 + rng.range(-0.7, 0.7);
        const lane = (k % 2 ? 1 : -1) * rng.range(1.7, 2.3) + (rng.chance(0.14) ? (k % 2 ? 3 : -3) : 0); // (a few took to the verge)
        const t = rng();
        const ry = (k % 2 ? PI : 0) + rng.range(-0.35, 0.35);
        const trunk = rng.chance(0.5);
        const type = t < 0.4 ? 'car_wreck' : t < 0.68 ? 'car_burnt' : t < 0.86 ? 'pickup_truck' : t < 0.95 ? 'ambulance' : 'school_bus';
        if (propBlocked(type, b.wx(lane, along), b.wz(lane, along), b.ry + ry) || !longClear(type, b.wx(lane, along), b.wz(lane, along)) || otherRoad(highway, b.wx(lane, along), b.wz(lane, along), 13)) continue;
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
      if (acc < (road.kind === ROAD.TRAIL ? 60 : 36)) continue;
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const type = ['wreck', 'wreck', 'camp', 'stash', 'shed', 'wreck', 'crash', 'post', 'stop', 'graves'][rng.int(0, 9)];
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
  for (let a = 0; a < 6000 && sites.length < 300; a++) {
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
    } else if (st.type === 'crash') {
      // two that met, off the road: one burnt, their people still by them
      b.wreck(rng.chance(0.5) ? 'car_open' : 'van_wreck', -1.2, 0.4, PI / 2 + rng.range(-0.4, 0.4), { zone: ZONE.ROADSIDE, trunk: false, seed: rng.int(0, 3) });
      extra(b, 'car_burnt', 2.4, -1.6, rng.range(0, 6));
      b.prop('glass_shards', 0.6, -0.6, rng.range(0, 6), { nocollide: true });
      b.prop(rng.chance(0.5) ? 'skeleton' : 'corpse', rng.range(-3, 3), 2.6, rng.range(0, 6), { nocollide: true, seed: rng.int(0, 2) });
      b.prop('suitcases', rng.range(-3, 3), -3.2, rng.range(0, 6), { nocollide: true });
      if (rng.chance(0.5)) b.cont(CONT.DUFFEL, 3.6, 2.4, { prop: 'duffel_bag', ry: rng.range(0, 6), nocollide: true, zone: ZONE.ROADSIDE });
    } else if (st.type === 'post') {
      // a post the army held on the road: a nest, wire, their order on a trestle, what is left of them
      extra(b, 'sandbag_nest', 0, 0.6, PI);
      b.prop('mg_tripod', 0, 0.8, PI, { nocollide: true });
      extra(b, 'concertina', 0.4, -3.6, rng.range(-0.1, 0.1));
      extra(b, 'checkpoint_sign', -3.6, -2, PI + rng.range(-0.3, 0.3));
      b.cont(CONT.AMMO_BOX, 3.4, 1.2, { prop: 'military_crate', ry: 0.3, zone: ZONE.ROADBLOCK });
      for (let k = 0; k < 3; k++) b.prop(['skeleton', 'corpse', 'blood_pool'][k], rng.range(-3.6, 3.6), rng.range(-2.6, 3.4), rng.range(0, 6), { nocollide: true, seed: k });
      b.clear(0, 0, 5);
    } else if (st.type === 'stop') {
      // a bus stop out in the country: its shelter, a bench, what was left waiting
      b.prop('bus_shelter', 0, 0.8, PI);
      extra(b, 'trash_bin', 2.8, 0.4, 0);
      extra(b, 'street_bench', -3.4, 0.6, PI);
      for (let k = 0; k < 3; k++) b.prop(['suitcases', 'litter', 'skeleton'][k], rng.range(-3, 3), -1.6 - k * 0.6, rng.range(0, 6), { nocollide: true, seed: k });
      if (rng.chance(0.4)) b.loot(1.2, -1.4);
    } else if (st.type === 'graves') {
      // somebody buried theirs by the road
      for (let k = 0; k < 4; k++) {
        const gx = -2.7 + k * 1.8;
        b.prop('grave_cross', gx, 1.4 + rng.range(-0.2, 0.2), rng.range(-0.3, 0.3), { seed: k });
        b.box(gx, 0, 0.2, 0.8, 0.06, 1.9, 'earth', { collide: false });
      }
      b.prop('bones', 3.6, -1.2, 0, { nocollide: true });
      if (rng.chance(0.5)) b.cont(CONT.DUFFEL, -3.6, -1, { prop: 'duffel_bag', ry: 1, nocollide: true, zone: ZONE.ROADSIDE });
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
  // hoardings along Route 9 east of the city, on the side its power line is not: the army's, and what was being sold
  {
    const p = highway.pts;
    const CELLS = ['evac', 'billboard_a', 'quarantine', 'billboard_b', 'evac'];
    let acc = 60;
    let n = 0;
    for (let i = 12; i < p.length / 2 - 12; i++) {
      acc += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      const x = p[i * 2];
      const z = p[i * 2 + 1];
      if (acc < 96 || nearZone(x, z, 16) || inCity(x, z, 30) || onField(x, z, 10) || riverAt(x, z) < 30) continue;
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const px = x - (-tz / tl) * (highway.width + 5.4);
      const pz = z - (tx / tl) * (highway.width + 5.4);
      const dir = Math.atan2(tx, tz) + 0.25; // (its face to what comes out of the city)
      if (propBlocked('billboard', px, pz, dir) || sites.some((s) => Math.hypot(s.x - px, s.z - pz) < 9)) continue;
      acc = 0;
      const py = seatY('billboard', px, pz, dir);
      props.push({ type: 'billboard', x: px, y: py, z: pz, ry: dir, seed: i });
      addPropColliders('billboard', px, py, pz, dir, props[props.length - 1]);
      const cell = CELLS[n++ % CELLS.length];
      signs.push({ x: px - Math.sin(dir) * 0.3, y: py + 4.9, z: pz - Math.cos(dir) * 0.3, ry: dir, w: 5.4, h: 2.6, cell, far: true });
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
      addPropColliders('power_pole', px, py, pz, dir, props[props.length - 1]);
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
    if (zoneClear(x, z) || inCity(x, z, 12) || inWater(x, z) || occupied(x, z, 0.8)) continue;
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
    river: { pts: new Float32Array(riverPts), hw: RIVER_HW, bridges },
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
    city: { x: city.x, z: city.z, pitch: PITCH, grid: GRID, lots, buildings, rooms, shells, heaps, fallen: fallenBits, pancakes, signs },
    farms: farms.map((f) => ({ x: f.x, z: f.z, ry: f.ry })),
  };
}
