// Valley layout planner. For a seed it decides *where* everything is - the course of Route 9, the lake and
// the ponds, which named places exist and where they sit, and which of them the county roads and forest
// trails join - so no two playthroughs share a map. world.js then builds whatever this plans.
import { MAP_HALF } from './constants.js';
import { ZONE } from './defs.js';

const PI = Math.PI;

// Road kinds (roadKind grid): 1 dirt county road, 2 asphalt highway, 3 forest trail
export const ROAD = { DIRT: 1, ASPHALT: 2, TRAIL: 3 };

// The named places. flat / blend: radius of the levelled ground and of its blend into the hills.
// clear: radius kept free of trees. raise / pit: built up on / dug into the terrain. dirt: trampled yard.
// site: where the place may sit -
//   start     on Route 9 in the middle of the valley (the breakdown)
//   highway   on Route 9, the road runs straight through it
//   roadside  beside Route 9, its front on the road
//   shore     on the lake shore, back to the water
//   lakeside  a short walk from the lake
//   hill      on high ground
//   (none)    anywhere in the woods
// gates: the sides a road may arrive at (f front, b back, l left, r right; default all four). The front
// faces the road the place hangs off.
// core: on every map. The rest are drawn at random, PLACE_COUNT places to a map.
// (the buildings of each are in world.js, its name and loot table in defs.js)
export const PLACES = {
  [ZONE.CAMP]: { site: 'start', flat: 18, blend: 24, clear: 22, dirt: 0.25, core: true },
  [ZONE.GAS]: { site: 'roadside', flat: 28, blend: 24, clear: 34, dirt: 0.2, gates: 'b', core: true },
  [ZONE.CHURCH]: { flat: 40, blend: 24, clear: 46, gates: 'flr', core: true }, // (the cemetery lies behind it: cemetery.js)
  [ZONE.DOCK]: { site: 'shore', flat: 20, blend: 20, clear: 30, gates: 'f', core: true },
  [ZONE.VILLAGE]: { flat: 46, blend: 26, clear: 52, dirt: 0.15, core: true },
  [ZONE.CLINIC]: { flat: 30, blend: 24, clear: 34, dirt: 0.2, gates: 'flr' },
  [ZONE.MOTEL]: { site: 'roadside', flat: 32, blend: 24, clear: 36, dirt: 0.2, gates: 'b' },
  [ZONE.DRIVEIN]: { site: 'roadside', flat: 34, blend: 24, clear: 38, dirt: 0.5, gates: 'lr' },
  [ZONE.FAIR]: { flat: 38, blend: 24, clear: 42, dirt: 0.45, gates: 'flr', core: true },
  [ZONE.CHECKPOINT]: { site: 'highway', flat: 24, blend: 22, clear: 26, dirt: 0.3 },
  [ZONE.CAMPGROUND]: { site: 'lakeside', flat: 30, blend: 24, clear: 30, dirt: 0.35 },
  [ZONE.RELAY]: { site: 'hill', flat: 22, blend: 30, clear: 26, raise: 9, dirt: 0.35, gates: 'f' },
  [ZONE.RANGER]: { site: 'hill', flat: 24, blend: 30, clear: 28, raise: 7 },
  [ZONE.MINE]: { site: 'hill', flat: 30, blend: 28, clear: 34, raise: 4, dirt: 0.9, gates: 'flr', core: true },
  [ZONE.BARN]: { flat: 46, blend: 30, clear: 52, dirt: 0.45, gates: 'fbr' },
  [ZONE.SAWMILL]: { flat: 36, blend: 26, clear: 40, dirt: 0.85 },
  [ZONE.MILITARY]: { flat: 30, blend: 24, clear: 32, dirt: 0.5, gates: 'fb' },
  [ZONE.QUARRY]: { flat: 38, blend: 22, clear: 42, pit: 6, dirt: 1 },
  [ZONE.TRAILERS]: { flat: 32, blend: 24, clear: 36, dirt: 0.6 },
  [ZONE.CABINS]: { flat: 26, blend: 24, clear: 22 },
  [ZONE.SCRAPYARD]: { flat: 32, blend: 24, clear: 36, dirt: 0.9, gates: 'f' },
  [ZONE.SUMMERCAMP]: { flat: 34, blend: 26, clear: 26, dirt: 0.3, gates: 'flr' },
  [ZONE.LODGE]: { flat: 28, blend: 26, clear: 30, dirt: 0.25, gates: 'flr' },
};
export const PLACE_COUNT = 16; // named places on a map besides the breakdown

const RIM = 46; // places keep this far inside the map edge, where the ground climbs out of the valley
const MIN_GAP = 26; // woods left between two places
const GATE = 0.88; // a gate sits this far out from the middle of its place (x flat)
const SHORE = 50; // the lake's shore reaches this far past its waterline: nothing is built on it
const LOOPS = 6; // links added on top of the spanning tree; the first RING_ROADS are county roads, the rest trails
const RING_ROADS = 2;
const LOOP_DETOUR = 1.7; // a loop is only worth cutting where the roads take this many times the direct line
const LOOP_REACH = 210; // ...and the two ends are this close

// world position of a place's gate (f / b / l / r)
export function gatePoint(zn, g) {
  const d = zn.flat * GATE;
  const [lx, lz] = g === 'f' ? [0, -d] : g === 'b' ? [0, d] : g === 'l' ? [-d, 0] : [d, 0];
  return [zn.x + Math.cos(zn.ry) * lx + Math.sin(zn.ry) * lz, zn.z - Math.sin(zn.ry) * lx + Math.cos(zn.ry) * lz];
}

// facing (ry) that points the front (local -Z) of something at (x,z) towards (tx,tz)
const facing = (x, z, tx, tz) => Math.atan2(x - tx, z - tz);

// rng: seeded stream. relief(x, z): height of the raw hills, for places that want high ground.
// Returns { valley, zones, lake, ponds, highway, links }:
//   zones    the places: their PLACES entry plus { id, x, z, ry, h, hwy }
//   highway  [x, z] points Route 9 passes through, from one edge of the map to the other
//   links    [a, b, kind] roads to route; an end is { zone, gate } or { x, z } (a junction on Route 9 near there)
export function planLayout(rng, relief) {
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const inside = (x, z, r) => Math.max(Math.abs(x), Math.abs(z)) + r <= MAP_HALF - RIM;

  const zones = [];
  const put = (id, x, z, ry, fixed) => {
    const site = PLACES[id].site;
    zones.push({ ...PLACES[id], id, x, z, ry: ry ?? 0, h: 0, hwy: site === 'start' || site === 'highway', fixed });
    return true;
  };
  // woods between (x,z) and the nearest place already down
  const gap = (x, z, flat) => {
    let g = Infinity;
    for (const zn of zones) g = Math.min(g, Math.hypot(x - zn.x, z - zn.z) - zn.flat - flat);
    return g;
  };

  // ---------------------------------------------------------------- Route 9
  // Two arms run out of the valley from the breakdown, each with its own heading and belly, so the highway
  // may come through dead straight, on a bend or in an S, from any side of the map.
  const camp = [rng.range(-35, 35), rng.range(-35, 35)];
  const heading = rng.range(0, PI * 2);
  const arms = [0, PI].map((turn) => {
    const a = heading + turn + rng.range(-0.4, 0.4);
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const len = Math.min((MAP_HALF - Math.sign(dx) * camp[0]) / Math.abs(dx), (MAP_HALF - Math.sign(dz) * camp[1]) / Math.abs(dz));
    return { dx, dz, len, belly: rng.range(-0.14, 0.14) * len };
  });
  // the point s metres along Route 9 from the breakdown (s < 0: down the other arm)
  const hwyAt = (s) => {
    const a = arms[s < 0 ? 1 : 0];
    const d = Math.abs(s);
    const o = a.belly * Math.sin(PI * Math.min(1, d / a.len));
    return [camp[0] + a.dx * d - a.dz * o, camp[1] + a.dz * d + a.dx * o];
  };
  const hwy = []; // [x, z, s] every 6 m
  for (let s = -arms[1].len; s <= arms[0].len; s += 6) hwy.push([...hwyAt(s), s]);
  const hwyDist = (x, z) => {
    let d = Infinity;
    for (const p of hwy) d = Math.min(d, Math.hypot(x - p[0], z - p[1]));
    return d;
  };
  put(ZONE.CAMP, camp[0], camp[1]);
  // places on Route 9 take turns either side of the breakdown, two stops to an arm
  const stops = [0];
  const slots = [];
  {
    const near = [rng.range(105, 130), rng.range(105, 130)];
    const far = near.map((d) => d + rng.range(98, 115));
    const first = rng.chance(0.5) ? 1 : -1;
    slots.push(first * near[0], -first * near[1], first * far[0], -first * far[1]);
  }
  const station = (id, spec) => {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const [x, z] = hwyAt(s);
      let ok = false;
      if (spec.site === 'highway') ok = inside(x, z, spec.flat) && gap(x, z, spec.flat) > MIN_GAP && put(id, x, z);
      else {
        // beside the road on either side, the front gate on the road
        const [ax, az] = hwyAt(s - 4);
        const [bx, bz] = hwyAt(s + 4);
        const l = Math.hypot(bx - ax, bz - az);
        const side = rng.chance(0.5) ? 1 : -1;
        for (const sd of [side, -side]) {
          const cx = x - ((bz - az) / l) * sd * spec.flat * GATE;
          const cz = z + ((bx - ax) / l) * sd * spec.flat * GATE;
          if (ok || !inside(cx, cz, spec.flat) || gap(cx, cz, spec.flat) < MIN_GAP) continue;
          ok = put(id, cx, cz, facing(cx, cz, x, z), true);
        }
      }
      if (!ok) continue;
      stops.push(s);
      slots.splice(i, 1);
      return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- the lake
  // out towards the rim, its shore well clear of Route 9 and whatever stands beside it
  let lake = null;
  for (let tries = 0, far = -Infinity; tries < 80; tries++) {
    const r = rng.range(54, 66);
    const rim = MAP_HALF - rng.range(62, 105);
    const t = rng.range(-rim, rim);
    const [x, z] = [[t, rim], [t, -rim], [rim, t], [-rim, t]][rng.int(0, 3)];
    const d = hwyDist(x, z) - r;
    if (d > far) {
      far = d;
      lake = { x, z, r };
    }
    if (d > SHORE + 70) break;
  }
  const lakeDist = (x, z) => Math.hypot(x - lake.x, z - lake.z) - lake.r; // to the waterline

  // ---------------------------------------------------------------- places
  const fits = (x, z, spec) => inside(x, z, spec.flat) && hwyDist(x, z) > spec.flat + 22 && lakeDist(x, z) > spec.flat + SHORE && gap(x, z, spec.flat) > MIN_GAP;
  // what a site is after, on top of elbow room
  const WANTS = {
    hill: (x, z) => relief(x, z) / 12,
    lakeside: (x, z) => -lakeDist(x, z) / 60,
  };
  const place = (id) => {
    const spec = PLACES[id];
    if (spec.site === 'highway' || spec.site === 'roadside') return station(id, spec);
    if (spec.site === 'shore') {
      // on the shore nearest the valley, the pier (local +Z) running out over the water
      const inland = Math.atan2(camp[0] - lake.x, camp[1] - lake.z);
      for (let tries = 0; tries < 16; tries++) {
        const a = inland + rng.range(-0.7, 0.7);
        const x = lake.x + Math.sin(a) * (lake.r + 11.5);
        const z = lake.z + Math.cos(a) * (lake.r + 11.5);
        if (inside(x, z, spec.flat) && gap(x, z, spec.flat) > MIN_GAP) return put(id, x, z, Math.atan2(lake.x - x, lake.z - z), true);
      }
      return false;
    }
    // best of a handful of random spots: the roomiest, weighted by what the site wants
    const lim = MAP_HALF - RIM - spec.flat;
    let best = null;
    let bs = -Infinity;
    for (let i = 0; i < 70; i++) {
      const x = rng.range(-lim, lim);
      const z = rng.range(-lim, lim);
      if (!fits(x, z, spec)) continue;
      const s = Math.min(gap(x, z, spec.flat), 70) / 70 + (WANTS[spec.site]?.(x, z) ?? 0) + rng() * 0.3;
      if (s > bs) {
        bs = s;
        best = [x, z];
      }
    }
    return !!best && put(id, best[0], best[1]);
  };
  // every core place, then a random draw of the rest; whatever will not fit gives its turn to the next in line.
  // Sited in order of how picky they are: Route 9 first, then the lake, then the biggest.
  {
    const ids = Object.keys(PLACES).map(Number).filter((id) => id !== ZONE.CAMP);
    const pool = [...ids.filter((id) => PLACES[id].core), ...shuffle(ids.filter((id) => !PLACES[id].core))];
    const rank = { highway: 0, roadside: 0, shore: 1, lakeside: 2 };
    const picky = (id) => rank[PLACES[id].site] ?? 3;
    const picked = pool.splice(0, PLACE_COUNT).sort((a, b) => picky(a) - picky(b) || !!PLACES[b].core - !!PLACES[a].core || PLACES[b].flat - PLACES[a].flat);
    for (const id of picked) {
      let next = id;
      while (next !== undefined && !place(next)) next = pool.shift();
    }
  }

  // ---------------------------------------------------------------- ponds
  const ponds = [];
  for (let tries = 0, want = rng.int(4, 6); tries < 400 && ponds.length < want; tries++) {
    const r = rng.range(13, 20);
    const x = rng.range(-MAP_HALF + 60, MAP_HALF - 60);
    const z = rng.range(-MAP_HALF + 60, MAP_HALF - 60);
    if (hwyDist(x, z) < r + 30 || lakeDist(x, z) < r + 70 || gap(x, z, r) < 28) continue;
    if (ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r + 60)) continue;
    ponds.push({ x, z, r, depth: 0.9 + r * 0.115 });
  }

  // ---------------------------------------------------------------- roads
  // County roads are a spanning tree grown out from Route 9: every place hangs off the nearest thing that
  // already has a road, and turns its front to it. Then the worst detours that leaves are cut with loops:
  // a couple more county roads, and forest trails.
  const nodes = zones.filter((zn) => !zn.hwy); // (the places on Route 9 itself need no road)
  const N = nodes.length;
  // node N + i: the junction on Route 9 nearest place i (kept out of the places along the highway)
  const along = zones.filter((zn) => zn.hwy || zn.site === 'roadside');
  const open = hwy.filter(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) < MAP_HALF - 30 && !along.some((o) => Math.hypot(x - o.x, z - o.z) < o.flat + 12));
  const junctions = nodes.map((zn) => {
    let best = open[0];
    for (const p of open) if (Math.hypot(p[0] - zn.x, p[1] - zn.z) < Math.hypot(best[0] - zn.x, best[1] - zn.z)) best = p;
    return best;
  });
  const spot = (k) => (k < N ? [nodes[k].x, nodes[k].z] : junctions[k - N]);
  // does the straight line a -> b touch the lake?
  const wet = ([ax, az], [bx, bz]) => {
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(0, Math.min(1, ((lake.x - ax) * ex + (lake.z - az) * ez) / (ex * ex + ez * ez || 1)));
    return lakeDist(ax + ex * t, az + ez * t) < 8;
  };
  // travel over the roads laid so far; Route 9 already joins every junction
  const travel = Array.from({ length: 2 * N }, () => new Float32Array(2 * N).fill(Infinity));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) travel[N + i][N + j] = Math.abs(junctions[i][2] - junctions[j][2]);
  }
  // every link there could be: place to place, and place to its junction
  const options = [];
  for (let i = 0; i < N; i++) {
    for (const j of [N + i, ...nodes.keys()].filter((j) => j > i)) {
      const len = Math.hypot(spot(i)[0] - spot(j)[0], spot(i)[1] - spot(j)[1]);
      const woods = len - nodes[i].flat - (j < N ? nodes[j].flat : 0);
      options.push({ i, j, len, wet: wet(spot(i), spot(j)), cost: woods });
    }
  }
  for (const o of options) if (o.wet) o.cost *= 3;
  const links = [];
  // nearest gate of a place to (tx,tz)
  const gateTo = (zn, [tx, tz]) => {
    let best = 'f';
    let bd = Infinity;
    for (const g of zn.gates ?? 'fblr') {
      const [x, z] = gatePoint(zn, g);
      const d = Math.hypot(x - tx, z - tz);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  };
  const end = (k, other) => (k < N ? { zone: nodes[k], gate: gateTo(nodes[k], spot(other)) } : { x: spot(k)[0], z: spot(k)[1] });
  const lay = (o, kind) => {
    o.used = true;
    travel[o.i][o.j] = travel[o.j][o.i] = o.len;
    links.push([end(o.i, o.j), end(o.j, o.i), kind]);
  };
  // the places beside Route 9 are on the road from the start; a place with a single gate is a dead end
  const linked = nodes.map((zn) => zn.site === 'roadside');
  linked.forEach((on, i) => on && (travel[i][N + i] = travel[N + i][i] = 0));
  const hosts = (k) => k >= N || nodes[k].gates !== 'f';
  for (;;) {
    let best = null;
    for (const o of options) {
      const li = linked[o.i];
      const lj = o.j >= N || linked[o.j];
      if (li === lj || !hosts(li ? o.i : o.j)) continue;
      if (!best || o.cost < best.cost) best = o;
    }
    if (!best) break;
    const k = linked[best.i] ? best.j : best.i;
    const zn = nodes[k];
    const [tx, tz] = spot(k === best.i ? best.j : best.i);
    if (!zn.fixed) zn.ry = facing(zn.x, zn.z, tx, tz) + rng.range(-0.12, 0.12);
    linked[k] = true;
    lay(best, ROAD.DIRT);
  }
  for (let n = 0; n < LOOPS; n++) {
    // (Floyd-Warshall: a few dozen nodes)
    for (let k = 0; k < 2 * N; k++) {
      for (let i = 0; i < 2 * N; i++) {
        for (let j = 0; j < 2 * N; j++) travel[i][j] = Math.min(travel[i][j], travel[i][k] + travel[k][j]);
      }
    }
    let best = null;
    let worst = LOOP_DETOUR;
    for (const o of options) {
      if (o.used || o.wet || o.len > LOOP_REACH) continue;
      const detour = travel[o.i][o.j] / o.len;
      if (detour > worst) {
        worst = detour;
        best = o;
      }
    }
    if (!best) break;
    lay(best, n < RING_ROADS ? ROAD.DIRT : ROAD.TRAIL);
  }

  // Route 9 passes through its stops, with a point between any two that are far apart to carry the belly
  stops.push(-arms[1].len - 14, arms[0].len + 14);
  stops.sort((a, b) => a - b);
  const highway = [];
  for (let i = 0; i < stops.length; i++) {
    if (i) for (let k = 1, n = Math.ceil((stops[i] - stops[i - 1]) / 150); k < n; k++) highway.push(hwyAt(stops[i - 1] + ((stops[i] - stops[i - 1]) * k) / n));
    highway.push(hwyAt(stops[i]));
  }

  return { valley: { x: camp[0], z: camp[1] }, zones, lake, ponds, highway, links };
}
