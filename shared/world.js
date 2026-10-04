// Deterministic world generation. The server and every client call createWorld(seed) and get
// bit-identical terrain, places, roads, vegetation, buildings, containers and colliders, so the map
// never has to be sent over the network - only its seed, and a new playthrough means a new seed.
//
// layout.js plans the valley for the seed (the course of Route 9, where your car broke down; the lake;
// which named places there are and where; which of them the roads join) and this file builds it: the
// terrain, a road network routed over it with A* (roads follow valleys and share corridors), forest
// trails, and dozens of small roadside / woodland sites (wrecks, camps, sheds, stashes...) so every walk
// passes something worth searching.
import { MAP_HALF, MAP_SIZE, GRID_N, GRID_STEP, WATER_LEVEL } from './constants.js';
import { ZONE, CONT } from './defs.js';
import { PROPS } from './props.js';
import { mulberry32, createNoise2D, fbm, smoothstep, lerp, clamp } from './rng.js';
import { makeBox, makeCyl, footprintContains, COL } from './collision.js';
import { ROAD, planLayout, gatePoint } from './layout.js';
import { planMine, MINE_R, MINE_H, PORTAL } from './mine.js';
import { buildClinic, darkAt } from './clinic.js';
import { buildCemetery } from './cemetery.js';
import { buildFair } from './fair.js';
import { planRail } from './rail.js';
import { createKit } from './worldkit.js';

export { ROAD };

const PI = Math.PI;
const SITE_ROOM = 5; // (m) how far a roadside or woodland site keeps from the nearest solid prop a place has built

// Tree variants (must match client vegetation variants by index): collision radius at scale 1
export const TREE_TYPES = [
  { name: 'pine_tall', r: 0.42 },
  { name: 'pine_dense', r: 0.4 },
  { name: 'spruce', r: 0.38 },
  { name: 'dead_twisted', r: 0.3 },
  { name: 'dead_bare', r: 0.3 },
  { name: 'birch', r: 0.24 },
  { name: 'snag', r: 0.34 },
];
export const ROCK_TYPES = [{ r: 0.9 }, { r: 1.2 }, { r: 0.7 }];

const FLOOR = WATER_LEVEL + 1.2; // soft floor of the terrain outside lakes/ponds

// streets inside places (local coords): [[lx,lz]...], kind, width
const STREETS = {
  [ZONE.VILLAGE]: [
    [[[0, -40], [1.5, -14], [0, 0], [-1.5, 16], [0, 40]], ROAD.DIRT, 3],
    [[[-40, 0], [-14, -1.2], [0, 0], [14, 1.2], [40, 0]], ROAD.DIRT, 2.8],
  ],
  [ZONE.TRAILERS]: [[[[0, -28], [0, -12], [2.5, 4], [0, 28]], ROAD.DIRT, 2.4]],
  [ZONE.CAMPGROUND]: [[[[0, -26], [5, -9], [4, 8], [0, 26]], ROAD.DIRT, 2.2]],
  [ZONE.DRIVEIN]: [[[[0, -30], [0, -20], [-1.5, -11]], ROAD.DIRT, 2.6]],
  [ZONE.FAIR]: [[[[0, -33], [0, -20], [0, -4], [0, 9]], ROAD.DIRT, 2.6]],
};

export function createWorld(seed) {
  const rng = mulberry32(seed ^ 0x5eed);
  const nA = createNoise2D(seed + 1);
  const nB = createNoise2D(seed + 2);
  const nC = createNoise2D(seed + 3);
  const nD = createNoise2D(seed + 4);
  const nE = createNoise2D(seed + 5);

  // ---------------------------------------------------------------- layout
  // the raw hills, before the valley floor is pressed into them
  const relief = (x, z) => {
    const n1 = fbm(nA, x * 0.0042, z * 0.0042, 4);
    const n2 = fbm(nB, x * 0.017, z * 0.017, 3);
    const rd = 1 - Math.abs(nC(x * 0.0075, z * 0.0075));
    return n1 * 24 + n2 * 4.5 + rd * rd * 9 - 5;
  };
  // own rng stream: the plan only depends on the seed
  const { valley, zones, lake, ponds, highway: hwyAnchors, links, rail: railPlan } = planLayout(mulberry32(seed ^ 0x1a707), relief, mulberry32(seed ^ 0x7a11));
  const zoneById = {};
  for (const z of zones) zoneById[z.id] = z;
  const nearZone = (x, z, pad) => {
    for (const zn of zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.flat + pad) return zn;
    return null;
  };

  // the hills flatten out around the breakdown; valleys are softly floored above the water line (only the
  // lake and ponds hold water)
  const H0 = (x, z) => {
    const d = Math.hypot(x - valley.x, z - valley.z);
    const hill = 0.35 + 0.65 * smoothstep(30, 160, d);
    const micro = fbm(nD, x * 0.09, z * 0.09, 2) * 0.28;
    const h = relief(x, z) * (0.1 + 0.9 * hill);
    const a = (h - FLOOR) * 0.8;
    return FLOOR + 0.5 * (a + Math.sqrt(a * a + 9)) + micro;
  };
  for (const z of zones) {
    if (z.id === ZONE.DOCK) z.h = WATER_LEVEL + 1.5;
    else z.h = Math.max(FLOOR + 0.8, H0(z.x, z.z) * 0.55 + (z.raise || 0) - (z.pit || 0));
  }
  const edgeRise = (x, z) => smoothstep(MAP_HALF - 45, MAP_HALF - 2, Math.max(Math.abs(x), Math.abs(z))) * 22;

  const H1 = (x, z) => {
    let h = H0(x, z);
    for (let i = 0; i < zones.length; i++) {
      const zn = zones[i];
      const dx = x - zn.x;
      const dz = z - zn.z;
      const d2 = dx * dx + dz * dz;
      const lim = zn.flat + zn.blend;
      if (d2 > lim * lim) continue;
      const t = 1 - smoothstep(zn.flat, lim, Math.sqrt(d2));
      h = lerp(h, zn.h, t);
    }
    // lake
    const dLraw = Math.hypot(x - lake.x, z - lake.z);
    if (dLraw < lake.r + 60) {
      const dL = dLraw + nE(x * 0.03, z * 0.03) * 9;
      const shore = 1 - smoothstep(lake.r - 6, lake.r + 45, dL);
      h = lerp(h, Math.min(h, WATER_LEVEL + 1.2), shore * 0.9);
      const bowl = 1 - smoothstep(lake.r * 0.25, lake.r - 2, dL);
      h = lerp(h, WATER_LEVEL - 5.5, bowl);
    }
    for (let i = 0; i < ponds.length; i++) {
      const pd = ponds[i];
      const dr = Math.hypot(x - pd.x, z - pd.z);
      if (dr > pd.r + 30) continue;
      const dp = dr + nE(x * 0.05 + i * 7, z * 0.05) * pd.r * 0.22;
      const shore = 1 - smoothstep(pd.r - 3, pd.r + 22, dp);
      h = lerp(h, Math.min(h, WATER_LEVEL + 1.0), shore * 0.85);
      const bowl = 1 - smoothstep(pd.r * 0.2, pd.r - 1, dp);
      h = lerp(h, WATER_LEVEL - pd.depth, bowl);
    }
    return h + edgeRise(x, z);
  };

  // raw heightfield (before roads): sampled by the road router and road grading instead of re-evaluating noise
  const N = GRID_N;
  const heights = new Float32Array(N * N);
  const roadDist = new Float32Array(N * N).fill(1e4);
  const roadKind = new Uint8Array(N * N);
  const roadH = new Float32Array(N * N);
  const roadDir = new Float32Array(N * N * 2); // unit tangent of the nearest road (road textures follow it)
  for (let j = 0; j < N; j++) {
    const z = -MAP_HALF + j * GRID_STEP;
    for (let i = 0; i < N; i++) {
      const x = -MAP_HALF + i * GRID_STEP;
      heights[j * N + i] = H1(x, z);
    }
  }
  const rawH = (x, z) => {
    const fx = clamp((x + MAP_HALF) / GRID_STEP, 0, N - 1.001);
    const fz = clamp((z + MAP_HALF) / GRID_STEP, 0, N - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * N + i;
    const a = heights[k] + (heights[k + 1] - heights[k]) * tx;
    const b = heights[k + N] + (heights[k + N + 1] - heights[k + N]) * tx;
    return a + (b - a) * tz;
  };

  // local <-> world for a place
  const zwx = (zn, lx, lz) => zn.x + Math.cos(zn.ry) * lx + Math.sin(zn.ry) * lz;
  const zwz = (zn, lx, lz) => zn.z - Math.sin(zn.ry) * lx + Math.cos(zn.ry) * lz;

  // the railway (rail.js; null on a map without one): the line gets its heights before any road does, since every
  // road that crosses it meets it on the level
  const rail = planRail(railPlan, { seed, depot: zoneById[ZONE.STATION], rawH, edgeRise });

  // ---------------------------------------------------------------- roads
  const roads = [];
  const catmull = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const buildRoad = (ctrl, kind, width, name = '') => {
    // ctrl: [[x,z],...] ; densify with catmull-rom at ~2 m spacing
    const pts = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)];
      const p1 = ctrl[i];
      const p2 = ctrl[i + 1];
      const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(2, Math.ceil(len / 2));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        pts.push(catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t));
      }
    }
    const last = ctrl[ctrl.length - 1];
    pts.push(last[0], last[1]);
    const n = pts.length / 2;
    const hs = new Float32Array(n);
    for (let i = 0; i < n; i++) hs[i] = rawH(pts[i * 2], pts[i * 2 + 1]);
    // smooth heights along the road (gentle grades)
    const win = kind === ROAD.TRAIL ? 4 : 8;
    for (let pass = 0; pass < 3; pass++) {
      const src = hs.slice();
      for (let i = 0; i < n; i++) {
        let s = 0;
        let c = 0;
        for (let k = -win; k <= win; k++) {
          const j = i + k;
          if (j < 0 || j >= n) continue;
          s += src[j];
          c++;
        }
        hs[i] = s / c;
      }
    }
    // ...but a road meets a place at the level of its yard, it does not cut a ramp into it
    for (let i = 0; i < n; i++) {
      for (const zn of zones) {
        const d = Math.hypot(pts[i * 2] - zn.x, pts[i * 2 + 1] - zn.z);
        if (d < zn.flat + 12) hs[i] = lerp(hs[i], zn.h, 1 - smoothstep(zn.flat * 0.75, zn.flat + 12, d));
      }
    }
    if (rail) rail.pinRoad(pts, hs); // (...and the railway at the level of its bed)
    let length = 0;
    for (let i = 1; i < n; i++) length += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const road = { pts: new Float32Array(pts), hs, kind, width, name, length };
    roads.push(road);
    return road;
  };

  // Route 9: winding asphalt highway across the whole valley, past your broken-down car and the front of
  // every place that stands on it. Meander points between the anchors keep it from ever running straight.
  let highway;
  {
    const anchors = hwyAnchors;
    const ctrl = [anchors[0]];
    for (let i = 0; i < anchors.length - 1; i++) {
      const [ax, az] = anchors[i];
      const [bx, bz] = anchors[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      const px = -dz / len;
      const pz = dx / len;
      const edgeSeg = i === 0 || i === anchors.length - 2;
      const amp = edgeSeg ? 6 : Math.min(16, len * 0.11);
      const s = rng.chance(0.5) ? 1 : -1;
      const o1 = s * rng.range(0.45, 1) * amp;
      const o2 = -s * rng.range(0.3, 1) * amp;
      ctrl.push([ax + dx * 0.34 + px * o1, az + dz * 0.34 + pz * o1]);
      ctrl.push([ax + dx * 0.68 + px * o2, az + dz * 0.68 + pz * o2]);
      ctrl.push([bx, bz]);
    }
    highway = buildRoad(ctrl, ROAD.ASPHALT, 3.6, 'Route 9');
  }
  // nearest point of Route 9 to (x,z): [x, z, index]
  const hwyPoint = (x, z) => {
    const p = highway.pts;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < p.length / 2; i++) {
      const d = Math.hypot(p[i * 2] - x, p[i * 2 + 1] - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return [p[best * 2], p[best * 2 + 1], best];
  };
  // places Route 9 runs through face along the road
  for (const zn of zones) {
    if (!zn.hwy) continue;
    const [hx, hz, i] = hwyPoint(zn.x, zn.z);
    const p = highway.pts;
    const a = Math.max(0, i - 3);
    const b = Math.min(p.length / 2 - 1, i + 3);
    const dx = p[b * 2] - p[a * 2];
    const dz = p[b * 2 + 1] - p[a * 2 + 1];
    zn.ry = Math.atan2(-dx, -dz); // front (-Z local) faces along the road
    zn.x = hx;
    zn.z = hz;
  }

  // A* road router over a 4 m cost grid (slope, water, map edge, other places; existing roads are cheap
  // so later roads merge into shared corridors, and a noise term adds natural meander).
  const AG = 4;
  const AN = Math.round(MAP_SIZE / AG);
  const AN1 = AN + 1;
  const aH = new Float32Array(AN1 * AN1);
  const AS = AG / GRID_STEP;
  for (let j = 0; j <= AN; j++) for (let i = 0; i <= AN; i++) aH[j * AN1 + i] = heights[Math.min(N - 1, j * AS) * N + Math.min(N - 1, i * AS)];
  const aBase = new Float32Array(AN * AN);
  const aZone = new Int8Array(AN * AN).fill(-1);
  const aRoad = new Uint8Array(AN * AN);
  for (let j = 0; j < AN; j++) {
    for (let i = 0; i < AN; i++) {
      const h00 = aH[j * AN1 + i];
      const h10 = aH[j * AN1 + i + 1];
      const h01 = aH[(j + 1) * AN1 + i];
      const h11 = aH[(j + 1) * AN1 + i + 1];
      const sx = (h10 + h11 - h00 - h01) / (2 * AG);
      const sz = (h01 + h11 - h00 - h10) / (2 * AG);
      const s = Math.hypot(sx, sz);
      let c = 1 + s * s * 42 + (s > 0.28 ? (s - 0.28) * 70 : 0);
      if (Math.min(h00, h10, h01, h11) < WATER_LEVEL + 0.9) c += 500;
      const cx = -MAP_HALF + (i + 0.5) * AG;
      const cz = -MAP_HALF + (j + 0.5) * AG;
      if (Math.max(Math.abs(cx), Math.abs(cz)) > MAP_HALF - 44) c += 80;
      c += (nD(cx * 0.009 + 3.1, cz * 0.009 - 7.7) + 1) * 2.4 + (nB(cx * 0.03 - 5.3, cz * 0.03 + 1.7) + 1) * 0.8;
      const k = j * AN + i;
      aBase[k] = c;
      for (let zi = 0; zi < zones.length; zi++) {
        const zn = zones[zi];
        if (Math.hypot(cx - zn.x, cz - zn.z) < (zn.reach || zn.flat) + 3) aZone[k] = zi;
      }
    }
  }
  if (rail) rail.cost(aBase, AG, AN); // (a road crosses the railway, it does not run along its bed)
  const markRoadCells = (road) => {
    const p = road.pts;
    for (let i = 0; i < p.length / 2; i++) {
      const ci = Math.floor((p[i * 2] + MAP_HALF) / AG);
      const cj = Math.floor((p[i * 2 + 1] + MAP_HALF) / AG);
      if (ci >= 0 && cj >= 0 && ci < AN && cj < AN) aRoad[cj * AN + ci] = 1;
    }
  };
  markRoadCells(highway);
  const aG = new Float32Array(AN * AN);
  const aFrom = new Int32Array(AN * AN);
  const aClosed = new Uint8Array(AN * AN);
  const heapK = new Int32Array(AN * AN * 8);
  const heapF = new Float32Array(AN * AN * 8);
  const route = (ax, az, bx, bz) => {
    const cell = (v) => clamp(Math.floor((v + MAP_HALF) / AG), 0, AN - 1);
    const s = cell(az) * AN + cell(ax);
    const t = cell(bz) * AN + cell(bx);
    const ti = t % AN;
    const tj = (t / AN) | 0;
    aG.fill(Infinity);
    aFrom.fill(-1);
    aClosed.fill(0);
    let hn = 0;
    const push = (k, f) => {
      let i = hn++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= f) break;
        heapF[i] = heapF[p];
        heapK[i] = heapK[p];
        i = p;
      }
      heapF[i] = f;
      heapK[i] = k;
    };
    const pop = () => {
      const top = heapK[0];
      const lk = heapK[--hn];
      const lf = heapF[hn];
      let i = 0;
      for (;;) {
        let l = i * 2 + 1;
        if (l >= hn) break;
        if (l + 1 < hn && heapF[l + 1] < heapF[l]) l++;
        if (heapF[l] >= lf) break;
        heapF[i] = heapF[l];
        heapK[i] = heapK[l];
        i = l;
      }
      heapF[i] = lf;
      heapK[i] = lk;
      return top;
    };
    const cost = (k) => aBase[k] * (aRoad[k] ? 0.42 : 1) + (aZone[k] >= 0 ? 30 : 0);
    aG[s] = 0;
    push(s, 0);
    while (hn > 0) {
      const k = pop();
      if (aClosed[k]) continue;
      aClosed[k] = 1;
      if (k === t) break;
      const ki = k % AN;
      const kj = (k / AN) | 0;
      const ck = cost(k);
      for (let n = 0; n < 8; n++) {
        const ni = ki + NDI[n];
        const nj = kj + NDJ[n];
        if (ni < 0 || nj < 0 || ni >= AN || nj >= AN) continue;
        const nk = nj * AN + ni;
        if (aClosed[nk]) continue;
        const g = aG[k] + (ck + cost(nk)) * 0.5 * (n >= 4 ? 1.4142 : 1);
        if (g < aG[nk]) {
          aG[nk] = g;
          aFrom[nk] = k;
          push(nk, g + Math.hypot(ni - ti, nj - tj) * 0.95);
        }
      }
    }
    const cells = [];
    for (let k = t; k >= 0; k = aFrom[k]) {
      cells.push(k);
      if (k === s) break;
    }
    cells.reverse();
    let pts = cells.map((k) => [-MAP_HALF + ((k % AN) + 0.5) * AG, -MAP_HALF + (((k / AN) | 0) + 0.5) * AG]);
    pts[0] = [ax, az];
    pts[pts.length - 1] = [bx, bz];
    // Chaikin smoothing + Douglas-Peucker simplification -> catmull control points
    for (let it = 0; it < 2; it++) {
      const o = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i];
        const [x1, z1] = pts[i + 1];
        o.push([x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25], [x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75]);
      }
      o.push(pts[pts.length - 1]);
      pts = o;
    }
    return simplify(pts, 1.6);
  };
  const endpoint = (e) => {
    if (!e.zone) {
      const [x, z] = hwyPoint(e.x, e.z);
      return { x, z };
    }
    const zn = e.zone;
    const [x, z] = gatePoint(zn, e.gate);
    // driveway: the road runs on in from the gate - half way to the middle at the front, a little way into the
    // yard at the sides and back (unless one of the place's own streets meets it there)
    const street = (STREETS[zn.id] || []).some(([pts]) => [pts[0], pts[pts.length - 1]].some(([lx, lz]) => Math.hypot(zwx(zn, lx, lz) - x, zwz(zn, lx, lz) - z) < 6));
    const t = e.gate === 'f' ? 0.5 : 0.75;
    const inner = street ? null : [zn.x + (x - zn.x) * t, zn.z + (z - zn.z) * t];
    return { x, z, inner };
  };
  for (const [a, b, kind] of links) {
    const A = endpoint(a);
    const B = endpoint(b);
    // a bend waypoint keeps long roads from running dead straight across flat ground
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    let ctrl;
    if (L > 70) {
      const t = rng.range(0.38, 0.62);
      const off = rng.range(0.1, 0.2) * L * (rng.chance(0.5) ? 1 : -1);
      let wx = A.x + (B.x - A.x) * t + (-(B.z - A.z) / L) * off;
      let wz = A.z + (B.z - A.z) * t + ((B.x - A.x) / L) * off;
      wx = clamp(wx, -MAP_HALF + 50, MAP_HALF - 50);
      wz = clamp(wz, -MAP_HALF + 50, MAP_HALF - 50);
      // (not if the bend would drag the road through a place or the water)
      if (rawH(wx, wz) > WATER_LEVEL + 1.5 && !nearZone(wx, wz, 14)) {
        const a1 = route(A.x, A.z, wx, wz);
        const a2 = route(wx, wz, B.x, B.z);
        ctrl = simplify([...a1, ...a2.slice(1)], 1.6);
      }
    }
    if (!ctrl) ctrl = route(A.x, A.z, B.x, B.z);
    if (A.inner && kind !== ROAD.TRAIL) ctrl = [A.inner, ...ctrl];
    if (B.inner && kind !== ROAD.TRAIL) ctrl = [...ctrl, B.inner];
    const r = buildRoad(ctrl, kind, kind === ROAD.TRAIL ? 1.5 : 2.6);
    if (kind !== ROAD.TRAIL) markRoadCells(r);
  }
  for (const zid in STREETS) {
    const zn = zoneById[zid];
    if (!zn) continue;
    for (const [pts, kind, width] of STREETS[zid]) buildRoad(pts.map(([lx, lz]) => [zwx(zn, lx, lz), zwz(zn, lx, lz)]), kind, width);
  }

  // ---------------------------------------------------------------- heightfield (roads flattened in below)
  const ROAD_BLEND = 7.5;
  for (const road of roads) {
    const p = road.pts;
    const n = p.length / 2;
    const reach = road.width + ROAD_BLEND;
    for (let s = 0; s < n - 1; s++) {
      const ax = p[s * 2];
      const az = p[s * 2 + 1];
      const bx = p[s * 2 + 2];
      const bz = p[s * 2 + 3];
      const minx = Math.min(ax, bx) - reach;
      const maxx = Math.max(ax, bx) + reach;
      const minz = Math.min(az, bz) - reach;
      const maxz = Math.max(az, bz) + reach;
      const i0 = Math.max(0, Math.floor((minx + MAP_HALF) / GRID_STEP));
      const i1 = Math.min(N - 1, Math.ceil((maxx + MAP_HALF) / GRID_STEP));
      const j0 = Math.max(0, Math.floor((minz + MAP_HALF) / GRID_STEP));
      const j1 = Math.min(N - 1, Math.ceil((maxz + MAP_HALF) / GRID_STEP));
      const ex = bx - ax;
      const ez = bz - az;
      const el2 = ex * ex + ez * ez || 1;
      const el = Math.sqrt(el2);
      for (let j = j0; j <= j1; j++) {
        const z = -MAP_HALF + j * GRID_STEP;
        for (let i = i0; i <= i1; i++) {
          const x = -MAP_HALF + i * GRID_STEP;
          let t = ((x - ax) * ex + (z - az) * ez) / el2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = ax + ex * t;
          const cz = az + ez * t;
          const d = Math.hypot(x - cx, z - cz) - (road.width - 2.6);
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
    if (d < 2.6 + ROAD_BLEND) {
      const t = 1 - smoothstep(2.6 + 0.4, 2.6 + ROAD_BLEND, d);
      heights[k] = lerp(heights[k], roadH[k] - 0.05, t);
    }
  }

  const heightAt = (x, z) => {
    let fx = (x + MAP_HALF) / GRID_STEP;
    let fz = (z + MAP_HALF) / GRID_STEP;
    if (fx < 0) fx = 0;
    if (fz < 0) fz = 0;
    if (fx > N - 1.001) fx = N - 1.001;
    if (fz > N - 1.001) fz = N - 1.001;
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * N + i;
    // triangle-consistent interpolation (matches the rendered mesh split along the i+j diagonal)
    const h00 = heights[k];
    const h10 = heights[k + 1];
    const h01 = heights[k + N];
    const h11 = heights[k + N + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  };
  const sampleGrid = (arr, x, z) => {
    const i = clamp(Math.round((x + MAP_HALF) / GRID_STEP), 0, N - 1);
    const j = clamp(Math.round((z + MAP_HALF) / GRID_STEP), 0, N - 1);
    return arr[j * N + i];
  };
  const roadDistAt = (x, z) => sampleGrid(roadDist, x, z);
  const roadKindAt = (x, z) => sampleGrid(roadKind, x, z);
  const inLakeRaw = (x, z) => heightAt(x, z) < WATER_LEVEL + 0.35;
  // the railway's cuttings and embankments, and its bed entered in the road grids
  if (rail) rail.grade({ heights, roadDist, roadKind, roadDir, heightAt });

  // ---------------------------------------------------------------- roadside & woodland sites
  // Chosen now (before anything is built) so the ground under sheds / camps can be levelled.
  const sites = []; // {x, z, ry, type, road}
  const siteFree = (x, z, minGap) => {
    for (const s of sites) if (Math.hypot(s.x - x, s.z - z) < minGap) return false;
    return true;
  };
  const DRY = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]; // a site wants dry ground under all of it
  // the ground behind the adit of Blackrock Mine (the back of its yard, local (0, 22)) is kept for the mound the
  // adit is set into (mine.js)
  const behindAdit = (x, z) => {
    const zn = zoneById[ZONE.MINE];
    if (!zn) return false;
    const s = (x - zn.x) * Math.sin(zn.ry) + (z - zn.z) * Math.cos(zn.ry);
    return s > 20 && s < 58 && Math.abs((x - zn.x) * Math.cos(zn.ry) - (z - zn.z) * Math.sin(zn.ry)) < 21;
  };
  const siteOk = (x, z) => Math.abs(x) < MAP_HALF - 50 && Math.abs(z) < MAP_HALF - 50 && !DRY.some(([dx, dz]) => inLakeRaw(x + dx, z + dz)) && !nearZone(x, z, 16) && Math.hypot(x - lake.x, z - lake.z) > lake.r + 8 && !behindAdit(x, z) && !rail?.keep(x, z);
  const ROADSIDE_W = [['wreck', 5], ['camp', 2.5], ['logpile', 1.5], ['shed', 1.4], ['stash', 1], ['ruin', 1], ['grave', 0.8], ['roadblock', 1.2], ['bus', 0.5]];
  const TRAIL_W = [['camp', 3], ['hunter', 2.5], ['stash', 1.5], ['logpile', 1], ['grave', 1.2], ['shed', 1]];
  const WOODS_W = [['camp', 2.5], ['hunter', 2.5], ['stash', 2], ['shed', 1.5], ['ruin', 1.5], ['grave', 1.2], ['logpile', 0.8]];
  const pickW = (list) => {
    let tot = 0;
    for (const [, w] of list) tot += w;
    let r = rng() * tot;
    for (const [t, w] of list) {
      r -= w;
      if (r <= 0) return t;
    }
    return list[0][0];
  };
  for (const road of roads) {
    if (road.length < 60) continue;
    const p = road.pts;
    const n = p.length / 2;
    let acc = rng.range(10, 30);
    let side = rng.chance(0.5) ? 1 : -1;
    const spacing = road.kind === ROAD.TRAIL ? 58 : 40;
    for (let i = 2; i < n - 2; i++) {
      acc += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      if (acc < spacing) continue;
      const x = p[i * 2];
      const z = p[i * 2 + 1];
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      const type = pickW(road.kind === ROAD.TRAIL ? TRAIL_W : ROADSIDE_W);
      const onRoad = type === 'roadblock';
      const off = onRoad ? 0 : type === 'wreck' || type === 'bus' ? rng.range(5.5, 7.5) : rng.range(9.5, 13);
      let placed = false;
      for (let attempt = 0; attempt < 2 && !placed; attempt++, side = -side) {
        const sx = x + nx * side * off;
        const sz = z + nz * side * off;
        if (!siteOk(sx, sz) || !siteFree(sx, sz, onRoad ? 70 : 26)) continue;
        if (!onRoad && roadDistAt(sx, sz) < off - 1.5) continue; // too close to another road
        // front (-Z local) faces the road (for road blocks: along the road)
        const ry = onRoad ? Math.atan2(-tx, -tz) : Math.atan2(nx * side, nz * side);
        sites.push({ x: sx, z: sz, ry, type, road: road.kind, tx: tx / tl, tz: tz / tl });
        placed = true;
      }
      if (!placed) continue;
      acc = rng.range(-8, 8);
    }
  }
  for (let a = 0; a < 2000 && sites.length < 130; a++) {
    const x = rng.range(-MAP_HALF + 52, MAP_HALF - 52);
    const z = rng.range(-MAP_HALF + 52, MAP_HALF - 52);
    if (!siteOk(x, z) || roadDistAt(x, z) < 20 || !siteFree(x, z, 40)) continue;
    sites.push({ x, z, ry: rng.range(0, PI * 2), type: pickW(WOODS_W), road: 0 });
  }
  // level the ground under built sites
  const FLAT_SITES = { shed: 5.5, ruin: 6.5, camp: 5, stash: 4, logpile: 4.5, hunter: 3.5, grave: 3.5, wreck: 4.5, bus: 7 };
  for (const s of sites) {
    const r = FLAT_SITES[s.type];
    if (!r) continue;
    const h0 = heightAt(s.x, s.z);
    const R = r + 5;
    const i0 = Math.max(0, Math.floor((s.x - R + MAP_HALF) / GRID_STEP));
    const i1 = Math.min(N - 1, Math.ceil((s.x + R + MAP_HALF) / GRID_STEP));
    const j0 = Math.max(0, Math.floor((s.z - R + MAP_HALF) / GRID_STEP));
    const j1 = Math.min(N - 1, Math.ceil((s.z + R + MAP_HALF) / GRID_STEP));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        if (roadDist[k] < 3.5) continue;
        const d = Math.hypot(-MAP_HALF + i * GRID_STEP - s.x, -MAP_HALF + j * GRID_STEP - s.z);
        const t = 1 - smoothstep(r, R, d);
        heights[k] = lerp(heights[k], h0, t);
      }
    }
    s.h = h0;
  }

  // ---------------------------------------------------------------- colliders + building parts
  // (worldkit.js: the grids, the lists the world hands on and the Builder that fills them)
  const kit = createKit({ rng, heightAt, half: MAP_HALF });
  const { staticGrid, structGrid, parts, props, lootSpawns, containers, partSpots, openings, extraTrees, lights, roofs, clears, addPropColliders, seatY, propBlocked, Builder, door, win, gap } = kit;

  // ---------------------------------------------------------------- places
  // builds a place if this map has it: build(builder in the place's frame, the place)
  const place = (id, build) => {
    const zone = zoneById[id];
    if (!zone) return;
    const b = new Builder(zone.x, zone.z, zone.ry, zone.h);
    b.zone = id;
    b.yard = zone;
    build(b, zone);
  };
  let car;
  let cemetery = null; // (the chapel's builder fills it in)
  const spawnPoints = [];

  // THE BREAKDOWN (start): your car died on the shoulder of Route 9 next to a little rest area.
  place(ZONE.CAMP, (b, z) => {
    const pc = b.prop('car', 5.4, 1.5, 0.04, { seed: 7 });
    car = { x: pc.x, y: pc.y, z: pc.z, ry: pc.ry };
    b.clear(5.4, 1.5, 4);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2;
      spawnPoints.push({ x: b.wx(9 + Math.sin(a) * 2.5, 1 + Math.cos(a) * 3.5), z: b.wz(9 + Math.sin(a) * 2.5, 1 + Math.cos(a) * 3.5) });
    }
    b.cont(CONT.DUFFEL, 3.6, 4.6, { prop: 'duffel_bag', ry: 0.8, nocollide: true, seed: 1 });
    b.prop('road_sign', 3.2, -9, PI, { seed: 2 });
    b.prop('road_sign', -4.4, 14, 0, { seed: 5 });
    b.wreck('car_wreck', 6.2, -13, 0.28);
    b.wreck('pickup_truck', -7.5, 17, 2.9);
    b.prop('billboard', -13, 3, -PI / 2);
    // rest area
    b.shelter(14, 2, 7, 5.5, 2.7, 'tin');
    b.prop('picnic_table', 13, 0.6, PI / 2);
    b.prop('picnic_table', 15.4, 3.6, PI / 2 + 0.2);
    b.cont(CONT.TOOLBOX, 13, 0.8, { prop: 'toolbox', ly: 0.8, nocollide: true, h: 0.2 });
    b.cont(CONT.DUMPSTER, 19.5, -5, { prop: 'dumpster', ry: -PI / 2 });
    b.prop('outhouse', 20, 7, -PI / 2);
    b.prop('barrel', 17.5, -7.2, 0);
    b.prop('lantern_post', 10.5, -2.5, 0);
    b.prop('mailbox', 9.5, 8.5, -PI / 2);
    b.loot(12, 5.5);
    b.loot(16.5, -1.2, 0.82);
    b.loot(7.5, 5.2);
  });

  // PINEWOOD MOTEL: a row of rooms under a long roof facing Route 9, office, parking lot.
  place(ZONE.MOTEL, (b) => {
    b.box(-3, -0.05, -9, 46, 0.1, 17, 'concrete', { collide: true }); // parking lot
    const RW = 6;
    const n = 6;
    const x0 = -26;
    const zf = 4;
    const D = 8;
    const H = 3;
    const fops = [];
    const bops = [];
    for (let i = 0; i < n; i++) {
      fops.push(door(i * RW + 1.4, 1.3));
      fops.push(win(i * RW + 4.2, 1.5));
      bops.push(win((n - 1 - i) * RW + 3, 0.8, 1.6, 2.2));
    }
    b.wall(x0, zf, x0 + n * RW, zf, H, 0.25, 'clapboard', fops);
    b.wall(x0 + n * RW, zf + D, x0, zf + D, H, 0.25, 'clapboard', bops);
    b.wall(x0, zf + D, x0, zf, H, 0.25, 'clapboard', [win(4, 1.2)]);
    b.wall(x0 + n * RW, zf, x0 + n * RW, zf + D, H, 0.25, 'clapboard');
    for (let i = 1; i < n; i++) b.wall(x0 + i * RW, zf, x0 + i * RW, zf + D, H, 0.2, 'planks');
    b.box(x0 + (n * RW) / 2, 0, zf + D / 2, n * RW, 0.12, D, 'planks', { collide: true });
    b.box(x0 + (n * RW) / 2, H, zf + D / 2 - 1.8, n * RW + 0.8, 0.28, D + 4.2, 'tin', { collide: true });
    for (let i = 0; i <= n; i++) b.cyl(x0 + i * RW, 0, zf - 3.4, 0.1, H, 'trim', { sides: 6 });
    b.clear(x0 + (n * RW) / 2, zf + D / 2, 20);
    for (let i = 0; i < n; i++) {
      const cx = x0 + i * RW;
      b.prop('bed', cx + 3.8, zf + D - 1.3, PI);
      if (i % 2 === 0) b.cont(CONT.CABINET, cx + 1.2, zf + D - 0.45, { prop: 'cabinet', ry: 0 });
      else b.cont(CONT.FRIDGE, cx + 0.6, zf + D - 0.5, { prop: 'fridge', ry: 0, zone: ZONE.MOTEL });
      if (i === 2 || i === 5) b.cont(CONT.DUFFEL, cx + 2.4, zf + 2.2, { prop: 'duffel_bag', ry: 1.2, nocollide: true });
      b.loot(cx + 4.6, zf + 1.4);
    }
    b.partSpot(x0 + 3 * RW + 1.2, zf + D - 1.2);
    // office
    b.room(17, 2, 10, 9, 3.4, 'brick', { n: [door(2.4, 1.5), win(6.6, 3, 0.9, 2.4)], e: [win(4.5)], s: [door(2, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks' });
    b.box(15, 0, 0.2, 4, 1.05, 0.7, 'planks', { collide: true }); // counter
    b.cont(CONT.LOCKER, 20.8, 5.6, { prop: 'locker', ry: -PI / 2 });
    b.cont(CONT.SHELF, 14, 5.9, { prop: 'shelf', ry: PI });
    b.partSpot(19.5, 5.2);
    b.loot(15, 0.2, 1.07);
    b.prop('motel_sign', -20, -21, 0.3);
    b.box(10, 0, -0.6, 1.1, 1.9, 0.8, 'paint', { collide: true }); // vending machines
    b.box(11.4, 0, -0.6, 1.1, 1.9, 0.8, 'rust', { collide: true });
    b.cont(CONT.DUMPSTER, -12, 16.5, { prop: 'dumpster', ry: PI });
    b.wreck('car_wreck', -16, -8, 1.62);
    b.wreck('car_wreck', 2, -9, 1.5);
    b.wreck('pickup_truck', -4, -14, 1.7, { trunk: false });
    b.prop('corpse', -8, -3, 0.4, { nocollide: true });
    b.prop('barrel', 22, -4, 0);
    b.prop('streetlight', -8, -17, PI);
    b.prop('streetlight', 12, -17, PI);
    b.loot(-10, -6);
    b.loot(8, 10.5, 0.62); // on the bed of the last room
  });

  // MILLER FARM ---------------------------------------------------
  place(ZONE.BARN, (b) => {
    // barn: 14 wide (x), 20 deep (z), ridge along z
    b.room(10, 8, 14, 20, 6, 'barn', { n: [gap(7, 5, 4.6)], e: [door(12, 1.6)], s: [gap(7, 3, 3.2)] }, { roof: 'gable', roofH: 4.6, roofMat: 'tin', floorMat: 'planks' });
    b.box(10, 6, 8, 14, 0.2, 20, 'planks', { collide: false }); // hayloft ceiling
    b.prop('hay_square', 5, 14, 0);
    b.prop('hay_square', 5, 14, 0, { ly: 0.6 });
    b.prop('hay_square', 6.3, 15, 0.1);
    b.prop('hay_square', 14.5, 3, 1.57);
    b.prop('hay_square', 14.5, 4.3, 1.57);
    b.prop('hay_round', 15, 13, 0.3);
    b.prop('cart', 6, 5, 0.4);
    b.cont(CONT.SHELF, 16.5, 15, { prop: 'shelf', ry: -PI / 2 });
    b.cont(CONT.TOOLBOX, 4.2, 9.5, { prop: 'toolbox', ry: 0.4, nocollide: true });
    b.loot(6, 3);
    b.loot(14, 9);
    b.loot(12, 16);
    b.partSpot(15.8, 16.8);
    b.prop('tire_pile', 16, 16.8, 0, { nocollide: true });
    // farmhouse
    b.room(-16, 4, 10, 8, 3, 'clapboard', { n: [door(5, 1.2), win(2.2), win(7.8)], e: [win(4)], w: [win(4)], s: [win(3), door(7.5, 1.1)] }, { roof: 'gableZ', roofH: 2.6, roofMat: 'shingles' });
    b.wall(-17.2, 0, -17.2, 8, 3, 0.18, 'clapboard', [door(4, 1.1)]); // inner wall, clear of the front door (x -16)
    b.box(-16, 0, -1.2, 10, 0.3, 2.2, 'planks', { collide: true }); // porch
    b.prop('bed', -19.5, 6, 0);
    b.prop('table', -13, 2, 0.1);
    b.prop('chair', -12.5, 3, 2.5);
    b.cont(CONT.CABINET, -12.4, 7.35, { prop: 'cabinet', ry: PI });
    b.cont(CONT.FRIDGE, -19.9, 1.1, { prop: 'fridge', ry: PI / 2 });
    b.partSpot(-18.5, 7);
    b.loot(-13, 2, 0.82);
    // silo, water tower
    b.cyl(24, 0, 16, 3, 13, 'metal');
    b.cone(24, 13, 16, 3.2, 2.5, 'tin', 14, { ry: 0 });
    b.prop('water_tower', -27, 18, 0.3);
    // field with fences
    for (let i = 0; i < 10; i++) {
      if (i === 4) continue;
      b.prop('fence', -44 + i * 3, -12, 0);
      b.prop('fence', -44 + i * 3, -42, 0);
    }
    for (let i = 0; i < 10; i++) {
      if (i === 6) continue;
      b.prop('fence', -45.5, -40.5 + i * 3, PI / 2);
      b.prop('fence', -15.5, -40.5 + i * 3, PI / 2);
    }
    b.prop('scarecrow', -30, -27, 0.4);
    b.prop('scarecrow', -22, -35, 2.1);
    b.prop('hay_round', -36, -20, 1.1);
    b.prop('hay_round', -22, -18, 0.2);
    b.prop('hay_round', -38, -33, 2.4);
    for (let i = 0; i < 12; i++) b.prop('pumpkin', rng.range(-42, -18), rng.range(-40, -14), rng.range(0, 6), { nocollide: true });
    b.wreck('tractor', 3, -14, 0.5, { trunk: false });
    b.wreck('pickup_truck', -6, -8, 1.7);
    b.prop('well', -4, 13, 0);
    b.prop('outhouse', -27, 3, 1.57);
    b.cont(CONT.LOGPILE, -9, 14, { prop: 'woodpile', ry: 0.2 });
    b.prop('corpse', 1, -9, 2.2, { nocollide: true });
    b.loot(-30, -26);
    b.loot(3, -11);
  });

  // BLACKWATER DOCK -------------------------------------------------
  place(ZONE.DOCK, (b, z) => {
    const deckY = WATER_LEVEL + 1.1 - z.h; // relative to zone base
    // pier: runs +Z (toward the lake) in 4 m spans from z 9; a ninth, short one carries the deck the last 2 m to the
    // T end (z 43-47), so there is no hole to stop a survivor short of the crate out there
    for (let i = 0; i < 9; i++) {
      const len = i < 8 ? 4 : 2;
      b.box(0, deckY - 0.22, 9 + i * 4 + len / 2, 3, 0.22, len + 0.05, 'dockwood', { collide: true });
      b.cyl(-1.4, deckY - 3.5, 9.2 + i * 4, 0.14, 3.6, 'dockwood', { collide: false });
      b.cyl(1.4, deckY - 3.5, 9.2 + i * 4, 0.14, 3.6, 'dockwood', { collide: false });
    }
    b.box(0, deckY - 0.22, 45, 9, 0.22, 4, 'dockwood', { collide: true }); // T end
    b.prop('dock_post', -4.2, 46.5, 0, { ly: deckY - 0.1 });
    b.prop('dock_post', 4.2, 46.5, 0, { ly: deckY - 0.1 });
    b.prop('boat', 3.4, 38, 0.15, { y: WATER_LEVEL - 0.15, nocollide: true });
    b.prop('boat', -3.6, 30, -0.3, { y: WATER_LEVEL - 0.15, nocollide: true });
    b.cont(CONT.CRATE, -0.6, 44.5, { prop: 'crate', ly: deckY, ry: 0.3 });
    b.prop('barrel', 3.2, 45.2, 0, { ly: deckY });
    b.loot(-3.5, 45.5, deckY + 0.02);
    // boathouse
    b.room(-9, 6, 8, 10, 3.2, 'planks', { n: [door(4, 1.3)], s: [gap(4, 4, 2.8)], e: [win(5)], w: [win(5)] }, { roof: 'gable', roofH: 2.2, roofMat: 'tin' });
    b.cont(CONT.SHELF, -12.4, 6, { prop: 'shelf', ry: PI / 2 });
    b.prop('boat', -8, 7.5, 0.05, { ly: 0.12, nocollide: true });
    b.cont(CONT.TOOLBOX, -6, 2.5, { prop: 'crate_small', ry: 0.4, h: 0.62 });
    b.loot(-11.6, 3);
    b.partSpot(-6, 9.8);
    // shed
    b.room(9, -1, 4, 4, 2.6, 'tin', { n: [door(2, 1.2)] }, { roof: 'flat', roofMat: 'tin' });
    b.cont(CONT.CABINET, 9.6, 0.5, { prop: 'cabinet', ry: PI });
    b.partSpot(8, 0.2);
    b.prop('fuel_tank', 12, 9, 0.2);
    b.prop('barrel', 7, 5, 0);
    b.prop('barrel', 7.8, 5.6, 0);
    b.prop('pallet', 5, 2, 0.4);
    b.prop('crate', 5.2, 2.1, 0.1, { ly: 0.15 });
    b.wreck('car_wreck', 1, -11, 1.3);
    b.prop('dock_post', -2.5, 8.5, 0);
    b.prop('dock_post', 2.5, 8.5, 0);
    b.prop('bones', 4, 12, 0, { nocollide: true, ground: true });
    b.loot(3.5, -3);
  });

  // ROUTE 9 GAS STATION ---------------------------------------------
  place(ZONE.GAS, (b) => {
    b.box(0, -0.05, -6, 30, 0.1, 22, 'concrete', { collide: true }); // forecourt
    // store
    b.room(-3, 10, 12, 8, 3.4, 'brick', { n: [door(6, 1.6), win(2.5, 3, 0.9, 2.5), win(9.5, 3, 0.9, 2.5)], w: [win(4)], s: [door(2, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.cont(CONT.SHELF, -6, 11, { prop: 'shelf', ry: 0 });
    b.cont(CONT.SHELF, -1, 11, { prop: 'shelf', ry: 0 });
    b.cont(CONT.SHELF, -3.5, 13.3, { prop: 'shelf', ry: PI });
    b.cont(CONT.FRIDGE, 2.3, 13.4, { prop: 'fridge', ry: PI });
    b.prop('table', 1.5, 8, 0.0);
    b.loot(1.5, 8, 0.82);
    b.partSpot(-8, 13);
    // garage
    b.room(8, 10, 7, 8, 4, 'tin', { n: [gap(3.5, 5, 3.6)], e: [win(4)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete' });
    b.prop('car_wreck', 8, 10.5, 0.05);
    b.cont(CONT.SHELF, 10.9, 11, { prop: 'shelf', ry: -PI / 2 });
    b.cont(CONT.TOOLBOX, 5.3, 7.2, { prop: 'toolbox', ry: 0.3, nocollide: true });
    b.prop('tire_pile', 5.4, 13, 0);
    b.partSpot(10.5, 13.2);
    // canopy + pumps
    for (const [px, pz] of [[-5, -6], [5, -6], [-5, -12], [5, -12]]) b.cyl(px, 0, pz, 0.18, 4.6, 'metal');
    b.box(0, 4.6, -9, 13, 0.55, 8.5, 'metal', { collide: false });
    b.prop('gas_pump', -2, -9, 0);
    b.prop('gas_pump', 2, -9, 0);
    b.cont(CONT.DUMPSTER, -11, 12, { prop: 'dumpster', ry: 1.57 });
    b.wreck('car_wreck', -12, -5, 0.8);
    b.wreck('car_wreck', 9, -17, 2.2);
    b.prop('road_sign', -14, -18, 0.3);
    b.prop('streetlight', 12.5, -18.5, 0); // (clear of the wreck's tail, which reaches 10.8, -18.3)
    b.prop('streetlight', -10, -18, 0);
    b.prop('barrel', 12, 4, 0);
    b.prop('corpse', 3, -4, 0.8, { nocollide: true });
    b.loot(-11.5, 9.6);
    b.loot(12.5, 3);
  });

  // ARMY CHECKPOINT: Route 9 roadblock - barriers, tents, a traffic jam nobody drove out of.
  place(ZONE.CHECKPOINT, (b) => {
    b.prop('jersey_barrier', -2, -5, 0);
    b.prop('jersey_barrier', 2.2, 3, 0);
    b.prop('jersey_barrier', -6, -5, 0, { seed: 2 });
    b.prop('jersey_barrier', 6.2, 3, 0, { seed: 3 });
    b.prop('boom_gate', 1.8, -11, 0);
    b.prop('military_tent', -12, -2, PI / 2);
    b.prop('military_tent', 12.5, 8, -PI / 2);
    b.cont(CONT.LOCKER, -9.2, 3.6, { prop: 'locker', ry: -PI / 2 });
    b.cont(CONT.LOCKER, 9.6, 2.2, { prop: 'locker', ry: PI / 2, seed: 1 });
    b.cont(CONT.AMMO_BOX, -9.5, -7, { prop: 'military_crate', ry: 0.2 });
    b.cont(CONT.AMMO_BOX, 10, 13.5, { prop: 'military_crate', ry: -0.3 });
    b.prop('military_crate', 10.3, 13.4, -0.3, { ly: 0.7 });
    b.cont(CONT.DUFFEL, -13, -8, { prop: 'duffel_bag', ry: 2.2, nocollide: true });
    for (let i = 0; i < 6; i++) {
      const a = PI * 0.25 + (i / 5) * PI * 0.5;
      b.prop('sandbags', -10 + Math.cos(a) * 4, 14 + Math.sin(a) * 4, -a + PI / 2);
    }
    b.prop('hunting_stand', 10, -12, PI / 2);
    b.prop('generator', -15, 6, 0.3);
    b.prop('streetlight', -5.5, 10, PI / 2);
    b.prop('streetlight', 5.5, -14, -PI / 2);
    b.prop('barrel', -7.5, 9, 0);
    b.light(-7.5, 1.0, 9, 'embers');
    b.prop('barrel', 7.8, -8, 0);
    b.light(7.8, 1.0, -8, 'embers');
    b.prop('body_bag', 14, -3, 0.2, { nocollide: true });
    b.prop('body_bag', 15, -2.2, 0.3, { nocollide: true });
    b.wreck('pickup_truck', -9, 21.8, 0.1, { seed: 1 }); // (its nose clear of the sandbag nest's curve, which reaches z = 18)
    // abandoned traffic queue in both directions
    for (let i = 0; i < 4; i++) {
      b.wreck('car_wreck', -1.9 + (i % 2) * 0.4, -22 - i * 7.5, 0.05 * (i - 1.5), { trunk: i % 2 === 0 });
      b.wreck('car_wreck', 1.9 - (i % 2) * 0.4, 18 + i * 7.5, PI + 0.06 * (i - 1.5), { trunk: i % 2 === 1 });
    }
    b.partSpot(-12, 3.5);
    b.partSpot(12.8, 13);
    b.loot(-8, -9);
    b.loot(8.5, 12);
    // The machine-gun nest on the verge beside the boom gate, covering the lane out of the checkpoint: the tripod
    // (the gun on it is an entity, shared/mountedgun.js finds the nest by this prop) in a horseshoe of sandbags,
    // open at the back - the way in for the gunner, and for whatever comes for them. Every seed is given: the
    // nest draws nothing from the valley's random stream.
    {
      const n = b.sub(4.2, -7.8);
      n.prop('mg_tripod', 0, 0, 0, { seed: 0 });
      n.prop('sandbags', -1.05, -1.45, 0.2, { seed: 0 });
      n.prop('sandbags', 1.05, -1.45, -0.2, { seed: 1 });
      n.prop('sandbags', -2.2, 0, PI / 2 - 0.12, { seed: 1 });
      n.prop('sandbags', 2.2, 0, PI / 2 + 0.12, { seed: 0 });
    }
  });

  // WHITLOCK DEPOT and the rest of the railway (rail.js): the freight train stalled on the line, the tunnel mouths,
  // the plank crossings. Built on a stream of its own, like the mine: no other place moves for it.
  if (rail) rail.build({ place, builder: (x, z, ry, y) => new Builder(x, z, ry, y), roads, staticGrid, K: { door, win, gap } });

  // HARLAN SAWMILL: an open mill shed, log yard, office and workshop.
  place(ZONE.SAWMILL, (b) => {
    for (const px of [-12, -6, 0, 6, 12]) for (const pz of [-6, 6]) b.cyl(px, 0, pz, 0.2, 5.2, 'metal', { sides: 8 });
    b.box(0, 5.2, 0, 26, 0.2, 14, 'tin_rust', { collide: false });
    b.wall(-13, 6.3, 13, 6.3, 5.2, 0.25, 'barn');
    b.prop('saw_table', 0, 0, 0);
    b.cont(CONT.LOGPILE, -7.5, 1, { prop: 'log_pile', ry: 0 });
    b.box(7.8, 0, -1.4, 3.6, 0.9, 1.3, 'planks', { collide: true });
    b.box(7.8, 0, 1.2, 3.6, 1.3, 1.3, 'planks', { collide: true });
    b.cont(CONT.LOGPILE, 9.8, -3.6, { prop: 'pallet', ry: 0.2, h: 0.4 });
    b.cont(CONT.LOGPILE, -20, -12, { prop: 'log_pile', ry: 0.4 });
    b.prop('log_pile', -20, 9, -0.3);
    b.cont(CONT.LOGPILE, 20, -13, { prop: 'log_pile', ry: -0.2, seed: 2 });
    b.prop('log_pile', 21, 10, 0.5, { seed: 3 });
    // office
    b.room(-15, 19, 7, 6, 3, 'logwall', { n: [door(3.5), win(1.5), win(5.6)], e: [win(3)] }, { roof: 'gable', roofH: 2, roofMat: 'shingles' });
    b.cont(CONT.CABINET, -17.6, 21.4, { prop: 'cabinet', ry: PI });
    b.cont(CONT.LOCKER, -12.4, 21.1, { prop: 'locker', ry: -PI / 2 });
    b.prop('table', -15, 20, 0);
    b.loot(-15, 20, 0.82);
    b.partSpot(-17, 18.6);
    // workshop
    b.room(15, 19, 7, 6, 3.2, 'tin', { n: [gap(3.5, 3.2, 2.8)] }, { roof: 'flat', roofMat: 'tin' });
    b.cont(CONT.TOOLBOX, 13, 21, { prop: 'toolbox', ry: 0.2, nocollide: true });
    b.cont(CONT.SHELF, 17.9, 20, { prop: 'shelf', ry: -PI / 2 });
    b.partSpot(16.6, 21.2);
    b.wreck('pickup_truck', 5, -20, 0.2);
    b.wreck('tractor', -6, -21, -0.3, { trunk: false });
    b.prop('woodpile', -24, -1, PI / 2);
    b.prop('woodpile', 25, 1, PI / 2);
    b.prop('barrel', 3, 12, 0);
    b.prop('generator', -3, 11.5, 0);
    b.prop('corpse', 2, -9, 1.4, { nocollide: true });
    b.loot(-4, -10);
    b.loot(11, 12);
  });

  // RANGER LOOKOUT ---------------------------------------------------
  place(ZONE.RANGER, (b) => {
    b.prop('watchtower', 7, 7, 0.2);
    b.room(-6, 2, 8, 6, 3, 'logwall', { n: [door(4, 1.2), win(1.8), win(6.2)], e: [win(3)], w: [win(3)] }, { roof: 'gable', roofH: 2.2, roofMat: 'shingles' });
    b.prop('bed', -8.5, 3.05, 0); // (its foot clear of the cabinet against the back wall)
    b.prop('table', -4, 3.6, 0);
    b.cont(CONT.LOCKER, -2.6, 1, { prop: 'locker', ry: -PI / 2 });
    b.cont(CONT.CABINET, -8.8, 4.35, { prop: 'cabinet', ry: PI });
    b.loot(-4, 3.6, 0.82);
    b.partSpot(-8.6, 0.5);
    // shed
    b.room(-6, 14, 6, 6, 2.8, 'planks', { n: [gap(3, 3, 2.4)] }, { roof: 'flat', roofMat: 'tin' });
    b.partSpot(-7.8, 15.8);
    b.cont(CONT.TOOLBOX, -4.3, 15.5, { prop: 'toolbox', ry: 1, nocollide: true });
    b.prop('radio_mast', 13, -6, 0);
    b.prop('generator', 9.5, -4, 0.4);
    b.prop('outhouse', -15, 9, 1.57);
    b.prop('picnic_table', 2, -8, 0.3);
    b.prop('picnic_table', -3, -11, 1.9);
    b.wreck('pickup_truck', 9, -13, 0.5);
    b.prop('lantern_post', 1, -3, 0);
    b.cont(CONT.LOGPILE, -11.5, -1, { prop: 'woodpile', ry: 1.57 });
    b.cont(CONT.DUFFEL, 7, 7, { prop: 'duffel_bag', ry: 0.4, nocollide: true });
    b.loot(2, -8, 0.82);
  });

  // HUNTING CABINS ---------------------------------------------------
  place(ZONE.CABINS, (b, z) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + 0.5;
      const cx = Math.sin(a) * 15;
      const cz = Math.cos(a) * 15;
      const sub = new Builder(b.wx(cx, cz), b.wz(cx, cz), b.ry + a, z.h);
      sub.zone = z.id;
      // sub's -Z side faces the clearing center -> door on the north wall
      sub.room(0, 0, 6, 5, 2.7, 'logwall', { n: [door(3, 1.1)], e: [win(2.5)], w: [win(2.5)] }, { roof: 'gable', roofH: 2, roofMat: 'shingles' });
      sub.prop('bed', -1.8, 0.8, 0); // (clear of the cabinet against the back wall)
      sub.prop('table', 1.6, 1.3, 0);
      sub.loot(1.6, 1.3, 0.82);
      if (i % 2 === 0) sub.cont(CONT.CABINET, -2.2, 2.1, { prop: 'cabinet', ry: PI });
      else sub.cont(CONT.DUFFEL, 0.4, 0.6, { prop: 'duffel_bag', ry: 0.3, nocollide: true });
      if (i < 2) sub.partSpot(-1.8, -1.2);
      if (i % 2 === 0) sub.cont(CONT.LOGPILE, 4.1, 0, { prop: 'woodpile', ry: PI / 2 });
    }
    b.prop('well', 0, 0, 0);
    b.prop('picnic_table', 5, 4, 0.4);
    b.prop('outhouse', -8, 22, 0);
    b.prop('corpse', -4, -5, 1.3, { nocollide: true });
    b.prop('bones', 6, -6, 0, { nocollide: true });
    b.prop('lantern_post', 3, -3, 0);
    b.loot(0, 5.5);
    for (let i = 0; i < 10; i++) {
      const a = rng.range(0, PI * 2);
      const r = rng.range(8, 22);
      b.tree(Math.sin(a) * r, Math.cos(a) * r, rng.int(0, 2), rng.range(0.8, 1.1));
    }
  });

  // MILITARY CRASH SITE ----------------------------------------------
  place(ZONE.MILITARY, (b) => {
    b.wreck('heli_wreck', 0, 7, 0.6, { trunk: false });
    b.prop('military_tent', -14, -3, 0.2);
    b.prop('military_tent', -12, 12, 1.4);
    b.prop('military_tent', 14, -5, -0.3);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * PI * 2;
      if (i === 0 || i === 7) continue; // entrances
      b.prop('sandbags', Math.sin(a) * 23, Math.cos(a) * 23, a + PI / 2);
    }
    b.cont(CONT.AMMO_BOX, 4, -3, { prop: 'military_crate', ry: 0.2 });
    b.prop('military_crate', 4.2, -3.1, 0.25, { ly: 0.7 });
    b.cont(CONT.AMMO_BOX, 5.8, -2.4, { prop: 'military_crate', ry: 1.3 });
    b.cont(CONT.AMMO_BOX, -6, 16, { prop: 'military_crate', ry: 0.7 });
    b.cont(CONT.LOCKER, -10.9, -4.5, { prop: 'locker', ry: -PI / 2 + 0.2 });
    b.cont(CONT.DUFFEL, 13, -2, { prop: 'duffel_bag', ry: 0.6, nocollide: true });
    b.prop('barrel', 8, 14, 0);
    b.prop('barrel', 8.8, 14.6, 0);
    b.wreck('generator', -9, 6, 0.9, { trunk: false });
    b.prop('body_bag', -5, -9, 0.2, { nocollide: true });
    b.prop('body_bag', -3.8, -9.4, 0.25, { nocollide: true });
    b.prop('body_bag', -2.6, -9.2, 0.1, { nocollide: true });
    b.prop('radio_mast', 16, 10, 0);
    b.prop('fuel_tank', -17.5, 5, 0); // (between the west tents, both ends inside the sandbag ring 23 m out)
    // (a tent is one solid box: what belongs to it lies in front of its open flap, where it can be seen)
    b.loot(-14.3, -6.6);
    b.loot(14.6, -8.6);
    b.loot(2, 3);
    b.partSpot(15.6, -8.3);
    b.partSpot(-15.5, 10.9);
    b.light(0, 0.5, 7, 'embers');
  });

  // ST. AGNES CHAPEL + GRAVEYARD -----------------------------------------------
  place(ZONE.CHURCH, (b) => {
    const tall = (at) => ({ at, w: 1.1, y0: 1.3, y1: 3.6, glass: true });
    b.room(0, 6, 9, 18, 5, 'clapboard', { n: [door(4.5, 1.6)], e: [tall(3), tall(7.5), tall(12), tall(16)], w: [tall(2), tall(6.5), tall(11), tall(15)] }, { roof: 'gable', roofH: 4.2, roofMat: 'shingles' });
    // steeple on the front of the ridge, with an open belfry under the spire: the bell hangs in it and its rope
    // comes down through the ceiling just inside the door (BELL_AT / BELL_ROPE in shared/fixtures.js)
    b.box(0, 5, -1.3, 2.6, 4.3, 2.6, 'clapboard', { collide: false });
    b.box(0, 9.3, -1.3, 3.0, 0.14, 3.0, 'trim', { collide: false });
    for (const [px, pz] of [[-1.15, -2.45], [1.15, -2.45], [-1.15, -0.15], [1.15, -0.15]]) b.box(px, 9.44, pz, 0.3, 1.66, 0.3, 'clapboard', { collide: false });
    b.prop('church_bell', 0, -1.3, 0, { ly: 9.56, seed: 0, nocollide: true }); // (a given seed: no draw from the world's stream)
    b.box(0, 11.1, -1.3, 3.0, 0.3, 3.0, 'trim', { collide: false });
    b.cone(0, 11.4, -1.3, 2.0, 6.5, 'shingles', 4);
    b.box(0, 17.8, -1.3, 0.12, 1.5, 0.12, 'trim', { collide: false });
    b.box(0, 18.6, -1.3, 0.8, 0.12, 0.12, 'trim', { collide: false });
    b.cyl(-1.05, 1.1, -1.3, 0.025, 3.9, 'rope', { collide: false, sides: 6 });
    b.cyl(-1.05, 1.2, -1.3, 0.05, 0.5, 'taillight', { collide: false, sides: 8 }); // the sally: where a hand takes the rope
    for (let r = 0; r < 6; r++) {
      b.prop('pew', -2.2, 1 + r * 1.8, 0);
      b.prop('pew', 2.2, 1 + r * 1.8, 0);
    }
    b.prop('altar', 0, 13.2, 0);
    b.prop('grave_cross', 0, 14.6, 0);
    b.loot(0, 13.2, 1.02);
    b.cont(CONT.CABINET, -3.4, 14.4, { prop: 'cabinet', ry: PI });
    b.cont(CONT.DUFFEL, 3.2, 3.5, { prop: 'duffel_bag', ry: 1.1, nocollide: true });
    b.partSpot(3.6, 14.3);
    // shed
    b.room(-9, 18, 4, 4, 2.6, 'planks', { e: [door(2, 1.2)] }, { roof: 'flat', roofMat: 'tin' });
    b.cont(CONT.TOOLBOX, -9.5, 18.8, { prop: 'toolbox', ry: 0.4, nocollide: true });
    b.partSpot(-10, 17);
    // the graves: St. Agnes Cemetery behind the chapel, the old churchyard beside it (cemetery.js)
    cemetery = buildCemetery(b, { seed, heightAt, staticGrid });
    b.prop('lantern_post', -3, -5, 0);
    b.prop('lantern_post', 3, -5, 0);
    b.prop('corpse', 14, 2, 0.5, { nocollide: true });
    b.loot(20.5, 6.2);
    for (let i = 0; i < 12; i++) b.tree(rng.range(-30, 40), rng.range(-30, 36), rng.chance(0.5) ? 3 : 4, rng.range(0.8, 1.2));
  });

  // RELAY STATION: fenced hilltop compound with a mast, dishes and an equipment hut.
  place(ZONE.RELAY, (b) => {
    const FX = 15;
    const FZ = 12;
    for (let x = -FX + 1.5; x < FX; x += 3) {
      if (Math.abs(x) > 3) b.prop('fence_chain', x, -FZ, 0);
      b.prop('fence_chain', x, FZ, 0);
    }
    for (let zz = -FZ + 1.5; zz < FZ; zz += 3) {
      b.prop('fence_chain', -FX, zz, PI / 2);
      b.prop('fence_chain', FX, zz, PI / 2);
    }
    b.prop('radio_mast', 8, 5, 0);
    b.prop('satellite_dish', -9, 6, 0.4);
    b.prop('satellite_dish', -10, -5, -0.3, { seed: 1 });
    b.room(1, 4, 6, 5, 2.8, 'concrete', { n: [door(3, 1.3), win(5, 0.9)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.cont(CONT.LOCKER, 3.4, 5.9, { prop: 'locker', ry: PI });
    b.cont(CONT.CABINET, -1.1, 5.9, { prop: 'cabinet', ry: PI });
    b.cont(CONT.TOOLBOX, 0.4, 2.6, { prop: 'toolbox', ry: 0.2, nocollide: true });
    b.partSpot(-1.2, 3);
    b.wreck('generator', 10, -6, 0.3, { trunk: false });
    b.prop('generator', 11.8, -4, -0.2);
    b.prop('fuel_tank', 5, -7.5, PI / 2);
    b.partSpot(-8, 9);
    b.wreck('pickup_truck', -4, -18, 0.3);
    b.prop('barrel', 12.5, 9.5, 0);
    b.loot(6, -3);
    // the radio set, on its cabinet beside the foot of the mast and under open sky: the crate a survivor calls down with
    // it lands where they stand (RADIO_AT in shared/fixtures.js; a given seed: no draw from the world's stream)
    b.prop('radio_set', 9.4, 4.3, 0, { seed: 0 });
  });

  // GRANITE QUARRY: a sunken pit with gravel piles, a dump truck, an office and a blasting bunker.
  place(ZONE.QUARRY, (b) => {
    b.prop('gravel_pile', 10, -16, 0);
    b.prop('gravel_pile', 17, 6, 1.2, { seed: 1 });
    b.prop('gravel_pile', -2, 22, 2.1, { seed: 2 });
    b.wreck('dump_truck', -4, -6, 0.5, { trunk: false });
    b.wreck('dump_truck', 12, 16, -2.3, { trunk: false, seed: 1 });
    // conveyor
    b.box(16, 1.4, -2, 12, 0.3, 1.2, 'rust', { rz: 0.22, collide: false });
    for (const lx of [11, 15, 19]) b.box(lx, 0, -2, 0.25, 0.9 + (lx - 11) * 0.22, 0.25, 'rust', { collide: true });
    // office
    b.room(-24, 10, 6, 5, 2.8, 'tin', { n: [door(3, 1.2)], e: [win(2.5)] }, { roof: 'flat', roofMat: 'tin' });
    b.cont(CONT.CABINET, -26.1, 11.9, { prop: 'cabinet', ry: PI });
    b.cont(CONT.LOCKER, -21.6, 11.4, { prop: 'locker', ry: -PI / 2 });
    b.partSpot(-24, 11.5);
    // blasting bunker
    b.room(-24, -14, 4.5, 4, 2.4, 'concrete', { n: [door(2.25, 1.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.cont(CONT.AMMO_BOX, -24, -12.9, { prop: 'military_crate', ry: 0, zone: ZONE.QUARRY });
    b.partSpot(-25.5, -15);
    b.cont(CONT.TOOLBOX, 3, 10, { prop: 'toolbox', ry: 0.5, nocollide: true });
    b.prop('generator', 6, 9, 0.3);
    b.prop('streetlight', -14, -2, PI / 2);
    b.prop('barrel', -18, 3, 0);
    b.prop('barrel', -18.7, 3.8, 0);
    b.prop('corpse', 4, -12, 2.1, { nocollide: true });
    b.loot(-8, 6);
    b.loot(20, -8);
  });

  // HOLLOW CREEK: the village crossroads - diner, general store, police station, garage, houses.
  place(ZONE.VILLAGE, (b) => {
    // diner (NW)
    b.room(-15, -14, 12, 8, 3.2, 'clapboard', { e: [door(4, 1.4), win(1.5, 1.6), win(6.5, 1.6)], n: [win(3), win(9)], s: [door(10, 1.1)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'planks' });
    b.box(-17, 0, -14, 0.8, 1.05, 5, 'planks', { collide: true }); // counter
    b.cont(CONT.FRIDGE, -20.5, -16.5, { prop: 'fridge', ry: PI / 2 });
    b.cont(CONT.CABINET, -20.2, -10.4, { prop: 'cabinet', ry: 0 }); // in the corner beside the back door (x -19), facing the kitchen
    b.prop('table', -11.5, -16, 0);
    b.prop('table', -11.5, -12, 0);
    b.prop('chair', -12.2, -15.2, 0.3);
    b.loot(-11.5, -12, 0.82);
    // general store (NE)
    b.room(15, -15, 12, 10, 3.4, 'brick', { w: [door(5, 1.6), win(1.8, 2.4, 0.9, 2.4), win(8.2, 2.4, 0.9, 2.4)], s: [door(9, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.cont(CONT.SHELF, 13, -17, { prop: 'shelf', ry: PI / 2 });
    b.cont(CONT.SHELF, 17, -17, { prop: 'shelf', ry: -PI / 2 });
    b.cont(CONT.SHELF, 15, -12, { prop: 'shelf', ry: 0 });
    b.cont(CONT.FRIDGE, 20.5, -12, { prop: 'fridge', ry: -PI / 2 });
    b.cont(CONT.CABINET, 11, -19.4, { prop: 'cabinet', ry: 0 });
    b.partSpot(19.5, -19);
    b.loot(12, -12);
    // police station (SE)
    b.room(15, 14, 11, 9, 3.3, 'brick', { w: [door(4.5, 1.5), win(1.6), win(7.4)], e: [win(4.5)], n: [win(5.5)] }, { roof: 'flat', roofMat: 'concrete' });
    b.cont(CONT.LOCKER, 20, 17.5, { prop: 'locker', ry: -PI / 2 });
    b.cont(CONT.LOCKER, 20, 15.5, { prop: 'locker', ry: -PI / 2, seed: 1 });
    b.cont(CONT.AMMO_BOX, 12, 17.9, { prop: 'military_crate', ry: PI, zone: ZONE.VILLAGE });
    b.prop('table', 14, 12, 0);
    b.loot(14, 12, 0.82);
    b.wreck('car_wreck', 8, 24, 0.1, { seed: 3 });
    // auto shop (E)
    b.room(31, 12, 9, 10, 4, 'tin', { w: [gap(5, 5, 3.6)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete' });
    b.prop('car_wreck', 31.5, 12, PI / 2 + 0.05, { seed: 5 });
    b.cont(CONT.TOOLBOX, 33.8, 8.2, { prop: 'toolbox', ry: 0, nocollide: true });
    b.cont(CONT.SHELF, 34.8, 15.5, { prop: 'shelf', ry: -PI / 2 });
    b.prop('tire_pile', 28.4, 16, 0);
    b.partSpot(34, 16.2);
    b.partSpot(28.6, 8);
    // houses (SW + S)
    const house = (hx, hz, doorSide, seed) => {
      const sides = { n: [win(2.5), win(6.5)], s: [win(4.5)], w: [win(4)], e: [win(4)] };
      sides[doorSide] = [door(doorSide === 'e' || doorSide === 'w' ? 4 : 4.5)];
      b.room(hx, hz, 9, 8, 3, seed % 2 ? 'clapboard' : 'logwall', sides, { roof: 'gable', roofH: 2.6, roofMat: 'shingles' });
      b.prop('bed', hx - 2.8, hz + 2.2, 0);
      b.cont(seed % 2 ? CONT.CABINET : CONT.FRIDGE, hx + 3.6, hz + 3.35, { prop: seed % 2 ? 'cabinet' : 'fridge', ry: PI });
      b.prop('table', hx + 1, hz - 1, 0.1);
      b.loot(hx + 1, hz - 1, 0.82);
    };
    house(-15, 13, 'e', 1);
    house(-15, 29, 'e', 2);
    house(15, 32, 'w', 3);
    house(-28, 9, 'n', 4); // south of the east-west street, its door on it
    b.prop('water_tower', -30, -30, 0.2);
    b.cont(CONT.DUMPSTER, 23, -23, { prop: 'dumpster', ry: 0 });
    b.cont(CONT.DUMPSTER, -22, -21, { prop: 'dumpster', ry: PI, seed: 1 });
    b.wreck('school_bus', -5.5, 36, 0.35, { trunk: false });
    b.cont(CONT.DUFFEL, -3, 30.4, { prop: 'duffel_bag', ry: 0.8, nocollide: true });
    b.wreck('car_wreck', 5.5, -28, PI + 0.1);
    b.wreck('car_wreck', -5.8, 6, 0.08, { seed: 2 });
    b.wreck('pickup_truck', 24, 2, PI / 2 + 0.1, { trunk: false });
    for (const [mx, mz] of [[-6, -24], [6, 20], [-6, 20]]) b.prop('mailbox', mx, mz, 0);
    for (const [sx, sz] of [[-6, -6], [6, 6], [6, -33.5], [-6, 30]]) b.prop('streetlight', sx, sz, PI / 2); // (6, -33.5: past the wreck parked at 5.5, -28)
    b.prop('corpse', 2.5, -6, 0.7, { nocollide: true });
    b.prop('corpse', -2, 12, 2.3, { nocollide: true });
    b.loot(-4, -34);
    b.loot(26, -4);
  });

  // MERCY CLINIC (clinic.js): reception and a pharmacy in the daylight, and behind them a ward wing with its windows
  // boarded over. darks: the interiors no daylight gets into (world.darkAt), of which its wards are the only ones
  const darks = [];
  let clinic = null;
  place(ZONE.CLINIC, (b) => {
    clinic = buildClinic(b, { seed, parts, darks });
  });

  // SHADY PINES TRAILERS: mobile homes along a gravel lane, a burnt-out trailer, a bus someone lived in.
  place(ZONE.TRAILERS, (b) => {
    const trailer = (cx, cz, flip, burnt, i) => {
      const s = b.sub(cx, cz, flip ? PI : 0);
      const mat = burnt ? 'charred' : i % 3 === 0 ? 'tin' : i % 3 === 1 ? 'tin_rust' : 'clapboard';
      s.room(0, 0, 10, 3.6, 2.6, mat, { n: burnt ? [gap(2.4, 1.4, 2.2), gap(6, 2, 2.4)] : [door(2.4, 1.1), win(5.4, 1.5), win(8.3, 1.1)], s: [win(3), win(7)], w: [win(1.8, 0.8)] }, { roof: burnt ? undefined : 'flat', roofMat: 'tin', floorMat: 'planks' });
      s.box(0, 0, -1.95, 10, 0.12, 0.8, 'planks', { collide: false }); // step
      if (!burnt) {
        s.cont(i % 2 ? CONT.CABINET : CONT.FRIDGE, 4.1, 1.2, { prop: i % 2 ? 'cabinet' : 'fridge', ry: PI });
        s.prop('bed', -3.3, 0.7, PI / 2);
        s.loot(1, 0);
      } else {
        s.loot(0, 0);
        s.prop('bones', 2, 0.4, 0, { nocollide: true });
      }
      return s;
    };
    const t0 = trailer(-10, -16, false, false, 0);
    trailer(-10, -2, false, false, 1);
    const t2 = trailer(-10, 12, false, true, 2);
    trailer(10.5, -12, true, false, 3);
    const t4 = trailer(10.5, 2, true, false, 4);
    trailer(10.5, 16, true, false, 5);
    t0.partSpot(-1.5, 0.5);
    t4.partSpot(-1.5, -0.4);
    void t2;
    b.wreck('school_bus', -22, 22, PI / 2 + 0.2, { trunk: false });
    b.cont(CONT.DUFFEL, -18.5, 19.2, { prop: 'duffel_bag', ry: 0.3, nocollide: true }); // beside the bus (it is one solid box)
    b.wreck('car_wreck', -4.5, -22, 0.3);
    b.wreck('car_wreck', 5.5, 8, PI + 0.4, { seed: 1 });
    b.wreck('pickup_truck', 5, -24, -0.5);
    b.cont(CONT.DUMPSTER, 19, -22, { prop: 'dumpster', ry: -PI / 2 });
    b.prop('tire_pile', -18, -8, 0);
    b.prop('barrel', 18, 22, 0);
    b.light(18, 1.0, 22, 'embers');
    b.prop('picnic_table', -18, 4, 0.5);
    b.prop('satellite_dish', 18, -4, 1.2);
    b.prop('corpse', 3, 20, 1.8, { nocollide: true });
    b.loot(-18, 4, 0.82);
    b.loot(3.5, -8);
  });

  // LAKESIDE CAMPGROUND: campsites along a loop lane, RVs, a ranger station by the water.
  place(ZONE.CAMPGROUND, (b) => {
    const site = (sx, sz, ry, withRv) => {
      const s = b.sub(sx, sz, ry);
      s.prop('tent', 0, 0, 0);
      s.prop('campfire', 0, -3.4, 0, { nocollide: true, seed: 1 });
      s.prop('log_bench', 2.05, -3.4, PI / 2); // (its end clear of the fire's ring of stones)
      s.prop('picnic_table', -3, -1.2, 0.2);
      s.cont(CONT.DUFFEL, 1.6, -1.2, { prop: 'duffel_bag', ry: 0.4, nocollide: true });
      if (withRv) s.wreck('camper', -5.5, 3, 0.15, { zone: ZONE.CAMPGROUND });
      s.loot(-3, -1.2, 0.82);
    };
    site(-12, -14, PI / 2, false);
    site(-13, 2, PI / 2, true);
    site(-11, 17, PI / 2 - 0.2, false);
    site(14, -16, -PI / 2, true);
    site(16, 0, -PI / 2 + 0.2, false);
    // ranger station
    b.room(17, 16, 8, 6, 3, 'logwall', { w: [door(3, 1.2), win(5)], s: [win(4)] }, { roof: 'gable', roofH: 2, roofMat: 'shingles' });
    b.cont(CONT.LOCKER, 20.5, 14, { prop: 'locker', ry: -PI / 2 });
    b.cont(CONT.CABINET, 17.5, 18.4, { prop: 'cabinet', ry: PI });
    b.partSpot(19.5, 17.5);
    b.partSpot(-17, 5);
    b.prop('outhouse', 4, 24, PI);
    b.prop('outhouse', 6, 24, PI);
    b.prop('boat', 8, 27, 1.2, { nocollide: true });
    b.prop('lantern_post', -4, -6, 0);
    b.prop('lantern_post', 7, 7, 0);
    b.cont(CONT.DUMPSTER, -4, 22, { prop: 'dumpster', ry: PI / 2 });
    b.prop('corpse', 6, -20, 0.2, { nocollide: true });
    b.loot(3, 12);
  });

  // DUTCH'S SALVAGE: a fenced scrapyard - rows of stacked wrecks, a car crusher and crane, the office and a parts shed.
  place(ZONE.SCRAPYARD, (b) => {
    const FX = 24;
    const FZ = 21;
    for (let x = -FX + 1.5; x < FX; x += 3) {
      if (Math.abs(x) > 4) b.prop('fence_chain', x, -FZ, 0);
      b.prop('fence_chain', x, FZ, 0);
    }
    for (let zz = -FZ + 1.5; zz < FZ; zz += 3) {
      b.prop('fence_chain', -FX, zz, PI / 2);
      b.prop('fence_chain', FX, zz, PI / 2);
    }
    b.prop('boom_gate', -0.4, -FZ, 0);
    b.prop('billboard', -10, -25, 0);
    // office
    b.room(-16, -13, 8, 6, 2.9, 'tin_rust', { e: [door(3, 1.2)], n: [win(4, 1.6)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'planks' });
    b.cont(CONT.LOCKER, -19.5, -12, { prop: 'locker', ry: -PI / 2 });
    b.cont(CONT.CABINET, -16.5, -10.45, { prop: 'cabinet', ry: 0 });
    b.prop('table', -15.5, -14.2, 0);
    b.loot(-15.5, -14.2, 0.82);
    b.partSpot(-19.2, -15.2);
    // parts shed
    b.room(15, -13, 7, 7, 3.4, 'tin', { w: [gap(3.5, 3.4, 2.9)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete' });
    b.cont(CONT.SHELF, 18.1, -13, { prop: 'shelf', ry: PI / 2 });
    b.cont(CONT.SHELF, 15, -9.9, { prop: 'shelf', ry: 0, seed: 1 });
    b.cont(CONT.TOOLBOX, 13, -15.6, { prop: 'toolbox', ry: 0.4, nocollide: true });
    b.prop('tire_pile', 17.5, -15.5, 0);
    b.partSpot(17.4, -10.6);
    b.prop('generator', 9.6, -15.5, 0.2);
    // the rows: wrecks parked nose to tail, some stacked two high
    for (const [rz, xs] of [[-1, [-19.5, -16, -12.5]], [7, [-19.5, -16, -12.5, -9]], [15, [-19.5, -16, -12.5]]]) {
      for (const x of xs) {
        const ry = (rng.chance(0.5) ? 0 : PI) + rng.range(-0.08, 0.08);
        const type = rng.chance(0.8) ? 'car_wreck' : 'pickup_truck';
        b.wreck(type, x, rz, ry, { trunk: rng.chance(0.4) });
        if (type === 'car_wreck' && rng.chance(0.45)) b.prop('car_wreck', x + rng.range(-0.15, 0.15), rz + rng.range(-0.2, 0.2), ry + rng.range(-0.12, 0.12), { ly: 1.5 });
      }
    }
    // crusher, with what comes out of it
    b.box(12, 0, 6, 4.2, 0.5, 6.5, 'rust');
    b.box(10.1, 0.5, 6, 0.4, 2.6, 6.5, 'rust');
    b.box(13.9, 0.5, 6, 0.4, 2.6, 6.5, 'rust');
    b.box(12, 3.1, 6, 4.2, 0.5, 6.5, 'metal');
    b.box(12, 0.5, 6, 1.7, 0.9, 2.4, 'rust');
    b.box(17.2, 0, 2.2, 1.7, 0.9, 2.4, 'rust', { ry: 0.1 });
    b.box(17.3, 0.9, 2.3, 1.7, 0.9, 2.4, 'tin_rust', { ry: -0.15 });
    b.box(19.6, 0, 2, 1.7, 0.9, 2.4, 'tin_rust', { ry: 0.3 });
    b.cont(CONT.TOOLBOX, 9.2, 9.8, { prop: 'toolbox', ry: 1.2, nocollide: true });
    // crane
    b.box(4, 0, 15.5, 3, 1.5, 4, 'rust');
    b.cyl(4, 1.5, 15.5, 0.3, 6, 'rust', { sides: 8 });
    b.box(4, 7.3, 11.5, 0.5, 0.5, 9.5, 'rust', { collide: false });
    b.box(4, 4.6, 7.2, 0.06, 2.7, 0.06, 'dark', { collide: false });
    b.cyl(4, 4.2, 7.2, 0.9, 0.4, 'metal', { collide: false });
    b.partSpot(5.9, 17.6);
    b.wreck('school_bus', 20.3, 12.5, 0.03, { trunk: false });
    b.wreck('dump_truck', -3, 16.5, 1.45, { trunk: false });
    b.wreck('tractor', 1.5, 3, 0.6, { trunk: false });
    b.cont(CONT.DUMPSTER, -6, -18.6, { prop: 'dumpster', ry: PI });
    b.cont(CONT.DUMPSTER, 8, 18.8, { prop: 'dumpster', ry: 0, seed: 1 });
    b.cont(CONT.CRATE, -6.5, -4, { prop: 'crate', ry: 0.3 });
    for (const [tx, tz] of [[-21.6, 19], [-19.9, 18.5], [8.5, -5], [1, 19]]) b.prop('tire_pile', tx, tz, 0);
    b.prop('barrel', 0.5, -3, 0);
    b.light(0.5, 1.0, -3, 'embers');
    b.prop('barrel', 9.5, -8, 0);
    b.prop('streetlight', -6, -19.6, PI);
    b.prop('streetlight', 6, -19.6, PI);
    b.prop('corpse', 2.5, -9, 0.9, { nocollide: true });
    b.prop('corpse', -9.5, 11.5, 2.4, { nocollide: true });
    b.loot(0, -7);
    b.loot(14.5, 11.5);
    b.loot(-5.5, 9.5);
  });

  // CAMP TAMARACK: a summer camp among the pines - bunk cabins either side of the fire circle, the mess hall behind it.
  place(ZONE.SUMMERCAMP, (b) => {
    // mess hall
    b.room(0, 17, 14, 8, 3.4, 'logwall', { n: [door(7, 1.6), win(2.6, 1.6), win(11.4, 1.6)], e: [win(4)], w: [win(4)], s: [door(11.5, 1.1)] }, { roof: 'gableZ', roofH: 2.8, roofMat: 'shingles' });
    b.prop('picnic_table', -3.6, 16, 0);
    b.prop('picnic_table', 0.4, 16, 0);
    b.loot(0.4, 16, 0.82);
    b.cont(CONT.FRIDGE, 6.4, 19.4, { prop: 'fridge', ry: PI / 2 });
    b.cont(CONT.CABINET, 3.6, 20.5, { prop: 'cabinet', ry: 0 });
    b.cont(CONT.SHELF, 0.6, 20.6, { prop: 'shelf', ry: 0 });
    b.partSpot(6.2, 14.2);
    b.cont(CONT.LOGPILE, 8.7, 16, { prop: 'woodpile', ry: PI / 2 });
    b.cont(CONT.DUMPSTER, 2, 23.2, { prop: 'dumpster', ry: 0 });
    // bunk cabins, doors on the fire circle
    const bunk = (cx, cz, ry, i) => {
      const s = b.sub(cx, cz, ry);
      s.room(0, 0, 6, 5, 2.7, 'planks', { n: [door(3, 1.1)], e: [win(2.5)], w: [win(2.5)] }, { roof: 'gable', roofH: 1.9, roofMat: 'shingles' });
      s.prop('bed', -2.3, 0.9, 0);
      s.prop('bed', 2.3, 0.9, 0);
      if (i % 2) s.cont(CONT.LOCKER, 0, 2.1, { prop: 'locker', ry: 0 });
      else s.cont(CONT.DUFFEL, 0, 1.5, { prop: 'duffel_bag', ry: 0.6, nocollide: true });
      s.loot(0, -0.6);
      return s;
    };
    bunk(-19, -10, -PI / 2, 0).partSpot(2.4, -1.8);
    bunk(-19, 3, -PI / 2, 1);
    bunk(19, -10, PI / 2, 2);
    bunk(19, 3, PI / 2, 3).partSpot(-2.4, -1.8);
    // fire circle + flagpole
    b.prop('campfire', 0, -3, 0, { nocollide: true, seed: 1 });
    b.prop('log_bench', 3, -3, 0);
    b.prop('log_bench', -3, -3, 0);
    b.prop('log_bench', 0, 0, PI / 2);
    b.prop('log_bench', 0, -6, PI / 2);
    b.cyl(6, 0, -12, 0.06, 7.5, 'metal', { sides: 6 });
    b.box(6.6, 6.5, -12, 1.1, 0.7, 0.03, 'paint', { collide: false });
    // archery range
    for (const hx of [-22, -18.5, -15]) b.prop('hay_round', hx, 21, PI / 2);
    for (const fx of [-21.5, -18.5, -15.5]) b.prop('fence', fx, 11, 0);
    b.cont(CONT.CRATE, -12.3, 12.6, { prop: 'crate', ry: 0.3 });
    b.loot(-18.5, 16);
    // canoes
    b.prop('boat', 16, 18.5, 0.1, { nocollide: true });
    b.prop('boat', 18, 19, -0.06, { nocollide: true });
    b.prop('dock_post', 15, 15.6, 0);
    b.prop('dock_post', 19, 15.6, 0);
    b.prop('outhouse', 11, 26, 0);
    b.prop('outhouse', 13, 26, 0);
    b.prop('well', -9, -15, 0);
    b.prop('picnic_table', 8, 8, 0.3);
    b.prop('picnic_table', -8, 8.5, -0.2);
    b.prop('lantern_post', -3, -10, 0);
    b.prop('lantern_post', 3.4, 10.5, 0);
    b.prop('lantern_post', -13, -3, 0);
    // the bus that brought them
    b.wreck('school_bus', 9.5, -22, 1.3, { trunk: false });
    b.cont(CONT.DUFFEL, 5.6, -18.6, { prop: 'duffel_bag', ry: 0.4, nocollide: true });
    b.prop('corpse', -2, -8.5, 0.6, { nocollide: true });
    b.prop('corpse', 5, 10.5, 2.2, { nocollide: true });
    b.prop('bones', -16, 17, 0, { nocollide: true });
    b.loot(1.2, -5.2);
    b.loot(15.5, -3.5);
    for (let i = 0; i < 16; i++) b.tree(rng.range(-31, 31), rng.range(-31, 31), rng.int(0, 2), rng.range(0.9, 1.25));
  });

  // BLACKROCK MINE: a worked-out pit on the hillside - the boarded-up adit, a headframe over the shaft, the tipple
  // at the end of the rails, the dry house and the powder store.
  place(ZONE.MINE, (b) => {
    // the adit, in the face of blasted rock at the back of the yard (local 0, 22), is built with the workings
    // behind it, once every place stands: see the mine below
    b.prop('lantern_post', -3, 20, 0);
    b.prop('lantern_post', 3, 20, 0);
    // rails down to the tipple
    for (const rx of [-0.45, 0.45]) b.box(rx, 0, 11.5, 0.08, 0.1, 19, 'rust', { collide: false });
    for (let tz = 2.6; tz < 21; tz += 1.7) b.box(0, 0, tz, 1.5, 0.06, 0.22, 'planks', { collide: false });
    b.prop('cart', 0, 15, 0);
    b.prop('cart', 0.15, 7, 0.04, { seed: 1 });
    for (const px of [-2.2, 2.2]) for (const pz of [-2.2, 2.2]) b.cyl(px, 0, pz, 0.16, 4.2, 'trim', { sides: 6 });
    b.box(0, 4.2, 0, 5, 2.2, 5, 'barn', { collide: false });
    b.box(0, 2.9, -3.8, 1.4, 0.2, 4.4, 'rust', { rx: -0.5 });
    b.prop('gravel_pile', 0, -7.5, 0);
    b.prop('gravel_pile', 6.5, -4.5, 1.1, { seed: 1 });
    // headframe over the shaft
    b.box(-14, -0.3, 8, 3.2, 0.36, 3.2, 'dark', { collide: false });
    for (const cz of [6.2, 9.8]) b.box(-14, 0, cz, 4, 0.5, 0.4, 'concrete');
    for (const cx of [-15.8, -12.2]) b.box(cx, 0, 8, 0.4, 0.5, 3.2, 'concrete');
    b.box(-14, 0.07, 8, 3.6, 0.08, 0.5, 'planks', { ry: 0.5, collide: false });
    for (const px of [-2.4, 2.4]) for (const pz of [-2.4, 2.4]) b.cyl(-14 + px, 0, 8 + pz, 0.16, 9, 'rust', { sides: 6 });
    for (const pz of [-2.4, 2.4]) b.box(-14, 4.5, 8 + pz, 4.8, 0.2, 0.2, 'rust', { collide: false });
    for (const px of [-2.4, 2.4]) b.box(-14 + px, 4.5, 8, 0.2, 0.2, 4.8, 'rust', { collide: false });
    b.box(-14, 9, 8, 5.6, 0.25, 5.6, 'rust', { collide: false });
    b.cyl(-14, 10, 8, 1.2, 0.25, 'metal', { rz: PI / 2 });
    // hoist house
    b.room(-22, 8, 5, 5, 2.8, 'tin_rust', { e: [gap(2.5, 2.4, 2.4)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete' });
    b.prop('generator', -22.6, 9.2, PI / 2);
    b.cont(CONT.TOOLBOX, -21, 6.6, { prop: 'toolbox', ry: 0.5, nocollide: true });
    b.partSpot(-23.6, 6.4);
    // dry house
    b.room(-15, -12, 8, 6, 2.9, 'planks', { e: [door(3, 1.2)], n: [win(2.5), win(5.5)], s: [win(4)] }, { roof: 'gable', roofH: 2.2, roofMat: 'tin' });
    b.cont(CONT.LOCKER, -18.5, -13.5, { prop: 'locker', ry: -PI / 2 });
    b.cont(CONT.LOCKER, -18.5, -11.5, { prop: 'locker', ry: -PI / 2, seed: 1 });
    b.cont(CONT.CABINET, -14, -9.45, { prop: 'cabinet', ry: 0 });
    b.prop('table', -14, -13.2, 0);
    b.loot(-14, -13.2, 0.82);
    b.partSpot(-12, -14.2);
    // powder store
    b.room(18, 6, 4.5, 4, 2.4, 'concrete', { w: [door(2, 1.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.cont(CONT.AMMO_BOX, 19.2, 6.9, { prop: 'military_crate', ry: PI / 2 });
    b.partSpot(19.4, 4.7);
    b.prop('sandbags', 14, 3.4, PI / 2);
    b.prop('sandbags', 14, 8.6, PI / 2, { seed: 1 });
    b.wreck('dump_truck', 10, -15, -0.4, { trunk: false });
    b.wreck('pickup_truck', -4, -17, 0.3);
    b.prop('fuel_tank', 22, -6, 0.2);
    b.prop('barrel', 12, 10.5, 0);
    b.prop('barrel', 12.8, 11.2, 0);
    b.cont(CONT.CRATE, 5, 9, { prop: 'crate', ry: 0.2 });
    b.cont(CONT.TOOLBOX, 3, -2.8, { prop: 'toolbox', ry: 0.9, nocollide: true });
    b.cont(CONT.LOGPILE, 8, 18.5, { prop: 'log_pile', ry: 0.1 });
    b.prop('lantern_post', -9, -8, 0);
    b.prop('corpse', 2.2, 12, 1.1, { nocollide: true });
    b.prop('bones', -9.5, 14, 0, { nocollide: true });
    b.loot(3.6, 19.6);
    b.loot(-14, 3.4);
    b.loot(10, -6.5);
  });

  // ELK RIDGE LODGE: a hunting lodge - one big log hall with a bunk room, a porch, the game shed and stands out back.
  place(ZONE.LODGE, (b) => {
    b.room(0, 6, 16, 10, 3.6, 'logwall', { n: [door(8, 1.6), win(3, 1.6), win(13, 1.6)], e: [win(3), win(7.5)], w: [win(5)], s: [door(13.5, 1.1), win(5)] }, { roof: 'gableZ', roofH: 3.2, roofMat: 'shingles' });
    b.wall(3, 1, 3, 11, 3.6, 0.2, 'logwall', [door(6, 1.2)]);
    // bunk room
    b.prop('bed', 7.2, 2.6, 0);
    b.prop('bed', 7.2, 5.6, 0);
    b.cont(CONT.LOCKER, 5, 10.5, { prop: 'locker', ry: 0 });
    b.cont(CONT.LOCKER, 6.3, 10.5, { prop: 'locker', ry: 0, seed: 1 });
    b.partSpot(4, 9.6);
    b.loot(4.6, 2.2);
    // the hall: fireplace, tables, kitchen corner
    b.box(-7.3, 0, 8.5, 1.1, 3.6, 2.2, 'stone');
    b.box(-7.3, 3.6, 8.5, 1.0, 4.4, 1.2, 'stone', { collide: false });
    b.prop('table', -3, 4.5, 0);
    b.prop('chair', -3.9, 5.5, 2.6);
    b.prop('chair', -2, 3.5, 0.4);
    b.prop('table', -2.6, 8.4, 0.1);
    b.loot(-2.6, 8.4, 0.82);
    b.cont(CONT.CABINET, -1.5, 10.5, { prop: 'cabinet', ry: 0 });
    b.cont(CONT.FRIDGE, 1.3, 10.4, { prop: 'fridge', ry: 0 });
    b.cont(CONT.DUFFEL, 0.6, 2.3, { prop: 'duffel_bag', ry: 0.9, nocollide: true });
    // porch
    b.box(0, 0, -0.5, 16, 0.25, 2.6, 'planks');
    for (const px of [-7.6, -2.6, 2.6, 7.6]) b.cyl(px, 0.25, -1.55, 0.1, 2.9, 'trim', { sides: 6 });
    b.box(0, 3.15, -0.6, 16.6, 0.14, 3, 'shingles', { collide: false });
    b.roofSpan(0, -0.6, 8.3, 1.5, 3.15, 0.14);
    b.prop('lantern_post', -3.2, -3, 0);
    b.prop('lantern_post', 3.2, -3, 0);
    // game shed
    b.room(14, -10, 4.5, 4.5, 2.6, 'planks', { w: [door(2.25, 1.2)] }, { roof: 'flat', roofMat: 'tin' });
    b.cont(CONT.CRATE, 15.3, -8.7, { prop: 'crate', ry: 0.1 });
    b.cont(CONT.TOOLBOX, 12.7, -11.4, { prop: 'toolbox', ry: 0.6, nocollide: true });
    b.partSpot(15.4, -11.4);
    // skinning rack
    b.cyl(-14, 0, -6, 0.09, 2.4, 'trim', { sides: 6 });
    b.cyl(-11, 0, -6, 0.09, 2.4, 'trim', { sides: 6 });
    b.box(-12.5, 2.3, -6, 3.3, 0.12, 0.12, 'trim', { collide: false });
    b.prop('bones', -12.5, -5.4, 0, { nocollide: true });
    b.cont(CONT.LOGPILE, -10.2, 6.2, { prop: 'woodpile', ry: PI / 2 });
    b.prop('woodpile', -10.2, 3.4, PI / 2, { seed: 1 });
    b.prop('hunting_stand', -20, 14, 0.8);
    b.prop('hunting_stand', 19, 16, -0.6);
    b.cont(CONT.DUFFEL, 17.4, 14.6, { prop: 'duffel_bag', ry: 0.2, nocollide: true });
    b.prop('well', 11, 15, 0);
    b.prop('outhouse', -17, -1, -PI / 2);
    b.prop('picnic_table', 7, -7.5, 0.2);
    b.prop('campfire', 0, -9.5, 0, { nocollide: true, seed: 1 });
    b.prop('log_bench', 2.7, -9.5, 0);
    b.prop('log_bench', -2.7, -9.5, 0);
    b.wreck('pickup_truck', -7, -17, 0.4);
    b.wreck('pickup_truck', 6.5, -18, -0.3, { seed: 1 });
    b.prop('corpse', 2.4, -5.5, 1.9, { nocollide: true });
    b.prop('corpse', -13, 12.5, 0.3, { nocollide: true });
    b.loot(0.4, -11.6);
    b.loot(15, 3);
    for (let i = 0; i < 9; i++) b.tree(rng.range(-26, 26), rng.range(-26, 26), rng.int(0, 2), rng.range(0.9, 1.2));
  });

  // STARLITE DRIVE-IN: the big screen at the back of a field of cars that never left, the snack bar and projection
  // booth in the middle of it, a ticket booth on the lane in from Route 9.
  place(ZONE.DRIVEIN, (b) => {
    // the screen
    for (const px of [-9, -3, 3, 9]) b.cyl(px, 0, 26, 0.22, 11.4, 'metal', { sides: 8 });
    b.box(0, 3.4, 25.6, 22, 8, 0.4, 'clapboard', { collide: false });
    b.box(0, 3.1, 25.6, 22.6, 0.3, 0.6, 'metal', { collide: false });
    // snack bar, the projector in its back room
    b.room(0, 2, 11, 7, 3.2, 'brick', { n: [door(2.5, 1.3), win(7.5, 3, 1.0, 2.3)], s: [win(5.5, 1.2, 1.5, 2.1)], e: [door(3.5, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.box(2, 0, 0.6, 5, 1.05, 0.7, 'planks');
    b.loot(2, 0.6, 1.07);
    b.box(0, 0, 4.7, 0.7, 1.4, 0.9, 'metal');
    b.cont(CONT.FRIDGE, 4.9, 4.6, { prop: 'fridge', ry: PI / 2 });
    b.cont(CONT.CABINET, 3, 5.05, { prop: 'cabinet', ry: 0 });
    b.cont(CONT.SHELF, -3.4, 5.1, { prop: 'shelf', ry: 0 });
    b.cont(CONT.LOCKER, -5, 2.6, { prop: 'locker', ry: -PI / 2 });
    b.partSpot(-4.7, 4.7);
    // the field: every car still facing the screen, a speaker post at each space
    for (const [rz, xs] of [[11, [-17, -12, -7, 7, 12, 17]], [17, [-15, -10, -4, 4, 10, 15]], [-7, [-18, -13, -8, 8, 13, 18]], [-13, [-15, -10, 10, 15]]]) {
      for (const x of xs) {
        b.cyl(x + 1.7, 0, rz + 1, 0.05, 1.3, 'metal', { sides: 5, collide: false });
        b.box(x + 1.7, 1.3, rz + 1, 0.2, 0.25, 0.15, 'rust', { collide: false });
        if (!rng.chance(0.62)) continue;
        const r = rng();
        // (a camper reaches into the space in front of it: only where no row of cars stands 6 m ahead)
        b.wreck(r < 0.7 ? 'car_wreck' : r < 0.9 || rz === 11 || rz === -13 ? 'pickup_truck' : 'camper', x + rng.range(-0.3, 0.3), rz, PI + rng.range(-0.12, 0.12), { trunk: rng.chance(0.35) });
      }
    }
    // ticket booth
    b.room(3.3, -21, 3, 3, 2.6, 'clapboard', { w: [win(1.5, 1.4, 1.0, 2.0)], s: [door(1.5, 1.0)] }, { roof: 'flat', roofMat: 'tin' });
    b.cont(CONT.CABINET, 3.7, -21.9, { prop: 'cabinet', ry: PI });
    b.partSpot(2.4, -20.3);
    b.prop('boom_gate', -0.6, -21, 0);
    b.prop('billboard', -11, -27, 0);
    for (let zz = -15; zz <= 21; zz += 3) {
      if (Math.abs(zz) < 4) continue; // side gates
      b.prop('fence', -26, zz, PI / 2);
      b.prop('fence', 26, zz, PI / 2);
    }
    b.prop('picnic_table', 8.6, -2.4, 0.2); // (clear of a camper parked in the row behind it)
    b.prop('picnic_table', -8.6, -2.6, -0.3);
    b.cont(CONT.DUFFEL, -8.6, -1.1, { prop: 'duffel_bag', ry: 0.5, nocollide: true });
    b.cont(CONT.DUMPSTER, 7.6, 4.6, { prop: 'dumpster', ry: -PI / 2 });
    b.cont(CONT.DUMPSTER, -20, -20, { prop: 'dumpster', ry: 0.3, seed: 1 });
    b.prop('streetlight', -6, -24, PI);
    b.prop('streetlight', 9, -24, PI);
    b.prop('barrel', 10.5, 0.6, 0);
    b.light(10.5, 1.0, 0.6, 'embers');
    b.prop('corpse', -2, -9.5, 0.4, { nocollide: true });
    b.prop('corpse', 6, 13.5, 2.5, { nocollide: true });
    b.prop('bones', -12, 20.5, 0, { nocollide: true });
    b.loot(0, 8.5);
    b.loot(-14, -3);
    b.loot(12, 20.5);
  });

  // TRI-COUNTY FAIR: the midway, the carousel and the Ferris wheel, and the generator that runs them (fair.js).
  let fair = null;
  place(ZONE.FAIR, (b, z) => {
    fair = buildFair(b, z, seed, { door, win });
  });

  // ---------------------------------------------------------------- the mine: its portals, and what is down there
  // The workings under Blackrock Mine (mine.js) are planned now that every place stands and every roadside site has
  // its spot, so the far portal comes up clear of them all: it levels an apron and heaps a mound behind itself.
  // null on a map without the mine, or with nowhere to come up - the adit is boarded up then.
  let mine = null;
  {
    // is anything built, lying or due to be built within r of (x,z)?
    const things = new Map(); // what has no collider, by 4 m cell
    for (const list of [props, lootSpawns, containers, partSpots]) {
      for (const t of list) {
        const key = Math.floor(t.x / 4) * 4096 + Math.floor(t.z / 4);
        if (!things.has(key)) things.set(key, []);
        things.get(key).push(t);
      }
    }
    const q = [];
    const taken = (x, z, r) => {
      for (const c of staticGrid.query(x, z, r, q)) if (footprintContains(c, x, z, r)) return true;
      for (let i = Math.floor((x - r - 1) / 4); i <= Math.floor((x + r + 1) / 4); i++) {
        for (let j = Math.floor((z - r - 1) / 4); j <= Math.floor((z + r + 1) / 4); j++) {
          for (const t of things.get(i * 4096 + j) || []) if (Math.hypot(t.x - x, t.z - z) < r + 1) return true;
        }
      }
      for (const st of sites) if (Math.hypot(st.x - x, st.z - z) < r + 8) return true;
      return false;
    };
    mine = planMine({ seed, zones, heights, heightAt, roadDistAt, taken });
  }
  if (!mine) {
    place(ZONE.MINE, (b) => {
      b.box(0, 0, 24.5, 9, 4.4, 5, 'stone');
      b.box(-6.5, 0, 24, 6, 3.4, 4.5, 'stone', { ry: 0.25 });
      b.box(6.5, 0, 24.2, 6, 3.8, 4.5, 'stone', { ry: -0.2 });
      b.box(0.4, 4.2, 25, 6, 1.2, 3.5, 'stone', { ry: 0.1, collide: false });
      b.box(0, 0, 21.9, 2.6, 2.5, 0.25, 'dark', { collide: false });
      b.box(-1.45, 0, 21.7, 0.3, 2.7, 0.3, 'trim');
      b.box(1.45, 0, 21.7, 0.3, 2.7, 0.3, 'trim');
      b.box(0, 2.7, 21.7, 3.4, 0.3, 0.3, 'trim', { collide: false });
      b.box(0, 0.7, 21.6, 3.1, 0.2, 0.06, 'planks', { rz: 0.12 });
      b.box(0, 1.5, 21.6, 3.1, 0.2, 0.06, 'planks', { rz: -0.1 });
    });
  } else {
    const mrng = mulberry32(seed ^ 0x51ab5); // its own stream: nothing else in the valley moves for it
    const sd = () => mrng.int(0, 9999);
    const inner = MINE_R + PORTAL.LINER;
    const L = PORTAL.LEN;
    mine.portals.forEach((p, pi) => {
      const b = new Builder(p.x, p.z, p.ry, p.y); // (its +Z runs on into the drift)
      b.zone = p.zone;
      // stone piers either side of the decline and a slab over them, proud of the mound behind. The rock lining of
      // the drift is drawn just inside the piers: a collider flush with it keeps bodies off it
      for (const sx of [-1, 1]) {
        b.box(sx * (inner + PORTAL.PIER / 2), -4.5, L / 2, PORTAL.PIER, 4.5 + PORTAL.TOP, L, 'stone');
        const lx = sx * (MINE_R + PORTAL.LINER / 2);
        staticGrid.add(makeBox(b.wx(lx, L / 2), b.wz(lx, L / 2), p.y - 4.5, p.y + PORTAL.SLAB, PORTAL.LINER, L, b.ry));
      }
      b.box(0, PORTAL.SLAB, L / 2, inner * 2, PORTAL.TOP - PORTAL.SLAB, L, 'stone');
      b.box(-inner - PORTAL.PIER - 1.6, -1.5, 2.2, 5, 4.9, 5, 'stone', { ry: 0.25 });
      b.box(inner + PORTAL.PIER + 1.6, -1.5, 2.4, 5, 5.3, 5, 'stone', { ry: -0.2 });
      b.box(0.4, PORTAL.TOP - 0.2, 3, 6, 1.2, 4.5, 'stone', { ry: 0.1, collide: false });
      // a timber set in the mouth, and what is left of the boards that shut it
      for (const sx of [-1, 1]) b.box(sx * (MINE_R + 0.1), 0, -0.05, 0.45, 2.95, 0.4, 'trim');
      b.box(0, 2.95, -0.05, MINE_R * 2 + 1.1, 0.5, 0.4, 'trim', { collide: false });
      b.box(-1.25, 0.1, -0.32, 0.2, 2.6, 0.06, 'planks', { rz: 0.42, collide: false });
      b.box(1.3, 2.2, -0.3, 1.5, 0.2, 0.06, 'planks', { rz: -0.14, collide: false });
      b.box(0.9, 0.03, -1.6, 2.6, 0.06, 0.2, 'planks', { ry: 0.5, collide: false });
      b.box(-0.6, 0.03, -2.3, 2.2, 0.06, 0.2, 'planks', { ry: -0.9, collide: false });
      b.roofSpan(0, L / 2, inner + PORTAL.PIER, L / 2, PORTAL.TOP, 0.2);
      b.clear(0, 3, 10);
      b.clear(0, -4, 7);
      if (pi) {
        // the far portal: the rails run out onto the apron, where the last shift left a tub and their tools
        for (const rx of [-0.45, 0.45]) b.box(rx, 0, -3.2, 0.08, 0.1, 6.4, 'rust', { collide: false });
        for (let tz = -6; tz < 0; tz += 1.2) b.box(0, 0, tz, 1.5, 0.06, 0.22, 'planks', { collide: false });
        b.prop('lantern_post', -3, -2, 0, { seed: sd() });
        b.prop('lantern_post', 3, -2, 0, { seed: sd() });
        b.prop('cart', 3.4, -5.2, 0.5, { seed: sd() });
        b.cont(CONT.TOOLBOX, -3.5, -4.4, { prop: 'toolbox', ry: 0.7, nocollide: true, seed: sd() });
        b.prop('barrel', -4.4, -1.6, 0, { seed: sd() });
        b.loot(-2.6, -3.2);
      } else for (const rx of [-0.45, 0.45]) b.box(rx, 0, -0.5, 0.08, 0.1, 1, 'rust', { collide: false });
    });
    // unit vector along a line at its point i
    const along = (l, i) => {
      const a = Math.max(0, i - 1);
      const c = Math.min(l.n - 1, i + 1);
      const tl = Math.hypot(l.x[c] - l.x[a], l.z[c] - l.z[a]) || 1;
      return [(l.x[c] - l.x[a]) / tl, (l.z[c] - l.z[a]) / tl];
    };
    const inRoom = (x, z, pad) => mine.rooms.some((rm) => Math.hypot(x - rm.x, z - rm.z) < rm.r + pad);
    // The timbering and the track are not parts of the static world: they are drawn with the rock (client/render/
    // mine.js), which knows that no daylight gets down there. mine.frames: boxes [x, y, z (middle), sx, sy, sz, ry, rz
    // (turned about its own Z, then about Y), kind: 0 timber, 1 rail, 2 sleeper]. None of them has a collider.
    mine.frames = [];
    const piece = (x, y, z, sx, sy, sz, ry, rz, kind) => mine.frames.push([x, y, z, sx, sy, sz, ry, rz, kind]);
    // a timber set: two posts and a cap across the drift
    const timber = (l, i) => {
      if (inRoom(l.x[i], l.z[i], 0.6)) return;
      const [tx, tz] = along(l, i);
      const ry = Math.atan2(tx, tz);
      for (const side of [-1, 1]) piece(l.x[i] + tz * side * (MINE_R - 0.1), l.y[i] + (MINE_H - 0.2) / 2, l.z[i] - tx * side * (MINE_R - 0.1), 0.24, MINE_H - 0.2, 0.24, ry, 0, 0);
      piece(l.x[i], l.y[i] + MINE_H - 0.32, l.z[i], MINE_R * 2 + 0.3, 0.24, 0.28, ry, 0, 0);
    };
    const m = mine.main;
    for (let i = 2; i < m.n - 2; i += 4) timber(m, i);
    for (const g of mine.galleries) for (let i = 5; i < g.n; i += 4) timber(g, i);
    // rails and sleepers the length of the main drift
    for (let i = 0; i < m.n - 1; i++) {
      const ex = m.x[i + 1] - m.x[i];
      const ez = m.z[i + 1] - m.z[i];
      const ey = m.y[i + 1] - m.y[i];
      const len = Math.hypot(ex, ez) || 1;
      for (const side of [-0.45, 0.45]) piece((m.x[i] + m.x[i + 1]) / 2 + (ez / len) * side, (m.y[i] + m.y[i + 1]) / 2 + 0.11, (m.z[i] + m.z[i + 1]) / 2 - (ex / len) * side, Math.hypot(len, ey) + 0.04, 0.1, 0.08, Math.atan2(-ez, ex), Math.atan2(ey, len), 1);
      const [tx, tz] = along(m, i);
      piece(m.x[i], m.y[i] + 0.03, m.z[i], 1.5, 0.06, 0.22, Math.atan2(tx, tz), 0, 2);
    }
    // the junction, where the galleries leave: a tub on the rails, a drum somebody has kept burning
    {
      const rm = mine.rooms[0];
      const [tx, tz] = along(m, mine.jx);
      const b = new Builder(rm.x, rm.z, Math.atan2(tx, tz), rm.y); // (+Z: along the drift)
      b.zone = ZONE.MINE;
      const k = (rm.r * 0.8 - 0.6) * Math.SQRT1_2; // out towards the corners, clear of the drift and the galleries
      b.prop('cart', 0.05, 1.8, 0.02, { seed: sd() });
      b.prop('barrel', k, k, 0, { seed: sd() });
      b.light(k, 1.0, k, 'embers');
      b.cont(CONT.CRATE, -k, k, { prop: 'crate', ry: 0.4, seed: sd() });
      b.prop('pallet', -k, -k, 0.3, { seed: sd() });
      b.prop('crate_small', -k + 0.1, -k, 0.5, { ly: 0.15, seed: sd() });
      b.prop('bones', k, -k, 1, { nocollide: true, seed: sd() });
      b.loot(k - 0.9, -k + 0.4);
      // (a mine with no gallery keeps its strongbox here)
      if (mine.rooms.length === 1) b.cont(CONT.STRONGBOX, k + 0.3, -k - 0.3, { prop: 'strongbox', ry: -0.8, seed: 0 });
    }
    // the rooms at the ends of the galleries: what the miners left, and what nobody has come back for
    const ends = mine.rooms.slice(1);
    // the strongbox: what makes the trip worth it (CONT.STRONGBOX), against the wall of the deepest room
    const deepest = ends.reduce((a, rm) => (!a || rm.y < a.y ? rm : a), null);
    ends.forEach((rm, k) => {
      const b = new Builder(rm.x, rm.z, Math.atan2(rm.dx, rm.dz), rm.y); // (+Z: on in from the gallery, to the back wall)
      b.zone = ZONE.MINE;
      const back = rm.r - 1.05;
      if (k % 3 === 0) b.cont(CONT.AMMO_BOX, -0.3, back, { prop: 'military_crate', ry: mrng.range(-0.2, 0.2), seed: sd() });
      else b.cont(CONT.CRATE, 0.2, back, { prop: 'crate', ry: mrng.range(-0.4, 0.4), seed: sd() });
      if (k % 2 === 0) b.cont(CONT.TOOLBOX, -back * 0.7, back * 0.45, { prop: 'toolbox', ry: mrng.range(0, 3), nocollide: true, seed: sd() });
      else b.cont(CONT.CRATE, back * 0.72, back * 0.4, { prop: 'crate', ry: mrng.range(0, 1.5), seed: sd() });
      b.prop('barrel', back * 0.75, -back * 0.3, 0, { seed: sd() });
      b.prop('pallet', -back * 0.6, -back * 0.45, mrng.range(0, 3), { seed: sd() });
      b.prop(k % 2 ? 'corpse' : 'bones', mrng.range(-1, 1), mrng.range(-0.5, 1), mrng.range(0, 6), { nocollide: true, seed: sd() });
      b.loot(mrng.range(-1.5, 1.5), back - 1.3);
      b.loot(-back * 0.6, -back * 0.45, 0.17);
      if (k === ends.length - 1) b.partSpot(1.3, back - 0.4);
      if (rm === deepest) b.cont(CONT.STRONGBOX, -back * 0.62, back * 0.72, { prop: 'strongbox', ry: -0.7, seed: 0 });
    });
    // where the dead stand about down there: the rooms, and the drift between the bays
    mine.dens = [];
    for (const rm of mine.rooms) {
      for (let i = rm.kind === 'junction' ? 3 : 2; i > 0; i--) {
        const a = mrng.range(0, PI * 2);
        const r = mrng.range(0, Math.max(0.5, rm.r - 2));
        mine.dens.push({ x: rm.x + Math.sin(a) * r, y: rm.y, z: rm.z + Math.cos(a) * r });
      }
    }
    for (let i = 30 + mrng.int(0, 10); i < m.n - 30; i += mrng.int(16, 26)) {
      const [tx, tz] = along(m, i);
      const lat = mrng.range(-1, 1);
      if (!inRoom(m.x[i], m.z[i], 3)) mine.dens.push({ x: m.x[i] + tz * lat, y: m.y[i], z: m.z[i] - tx * lat });
    }
  }
  // (the mine may have moved the ground at the edge of the railway's bed: rail.js puts it back)
  if (rail) rail.humps = rail.settle({ heights, heightAt, mine });

  // ---------------------------------------------------------------- roadside & woodland sites
  const TRUNK_ZONE = ZONE.ROADSIDE;
  const placeProps = props.length; // (what the places built, before any site)
  let sitesSkipped = 0;
  for (const st of sites) {
    // a site is kept clear of the places' own solid props: a traffic queue or a farm's fence can reach past the 16 m
    // the site was kept from the place's middle, and its wreck or log pile then stood in theirs
    let crowded = false;
    for (let i = 0; i < placeProps && !crowded; i++) {
      const p = props[i];
      const def = PROPS[p.type];
      if (def && (def.boxes || def.cyls) && Math.hypot(p.x - st.x, p.z - st.z) < SITE_ROOM) crowded = true;
    }
    if (crowded) {
      sitesSkipped++;
      continue;
    }
    const b = new Builder(st.x, st.z, st.ry, st.h ?? heightAt(st.x, st.z));
    b.zone = ZONE.FOREST;
    b.ground = true;
    const t = st.type;
    if (t === 'wreck') {
      const type = rng.chance(0.72) ? 'car_wreck' : 'pickup_truck';
      const ry = PI / 2 + rng.range(-0.5, 0.5) + (rng.chance(0.5) ? PI : 0);
      b.wreck(type, 0, 0, ry, { zone: TRUNK_ZONE });
      if (rng.chance(0.4)) b.prop('corpse', rng.range(-2.5, 2.5), -2.4, rng.range(0, 6), { nocollide: true });
      if (rng.chance(0.3)) b.loot(rng.range(-2, 2), 2.6);
      if (rng.chance(0.25)) b.prop('road_sign', 3.5, -3, 0);
    } else if (t === 'bus') {
      b.wreck('school_bus', 0, 0, PI / 2 + rng.range(-0.3, 0.3), { trunk: false });
      b.cont(CONT.DUFFEL, 0.5, -2.2, { prop: 'duffel_bag', ry: 0.3, nocollide: true, zone: TRUNK_ZONE });
      b.loot(-3, -2.4);
    } else if (t === 'roadblock') {
      // across the road: staggered barriers, a wreck, sandbags and a crate
      const b2 = new Builder(st.x, st.z, st.ry, heightAt(st.x, st.z));
      b2.ground = true;
      b2.zone = ZONE.FOREST;
      b2.prop('jersey_barrier', -1.8, -2, PI / 2 + PI / 2);
      b2.prop('jersey_barrier', 1.8, 2.5, PI / 2 + PI / 2, { seed: 1 });
      b2.prop('sandbags', -5.5, 3, 0.3);
      b2.wreck('car_wreck', 4.8, -5, 0.35, { zone: TRUNK_ZONE });
      b2.cont(CONT.CRATE, -5.8, -3.5, { prop: 'crate', ry: 0.4, zone: ZONE.CHECKPOINT });
      if (rng.chance(0.5)) b2.prop('body_bag', -4, 5.5, 1, { nocollide: true });
    } else if (t === 'camp') {
      b.prop('tent', 0, 1.5, rng.range(-0.3, 0.3));
      b.prop('campfire', 0.3, -2.2, 0, { nocollide: true, seed: 1 });
      b.prop('log_bench', 2.65, -2.2, PI / 2 + 0.2); // (its end clear of the fire's ring of stones)
      b.cont(CONT.DUFFEL, -1.9, -1.4, { prop: 'duffel_bag', ry: rng.range(0, 6), nocollide: true });
      if (rng.chance(0.5)) b.prop('lantern_post', -2.6, 1.8, 0);
      if (rng.chance(0.35)) b.prop('corpse', 2.5, 0.5, rng.range(0, 6), { nocollide: true });
      b.loot(1.2, -3.8);
      b.clear(0, 0, 5);
    } else if (t === 'stash') {
      b.cont(CONT.AMMO_BOX, 0, 0, { prop: 'military_crate', ry: 0.2 });
      b.prop('sandbags', 0.2, 1.4, 0.1);
      b.prop('sandbags', -2, 0, PI / 2 - 0.2, { seed: 1 });
      b.prop('barrel', 1.8, -0.4, 0);
      if (rng.chance(0.5)) b.prop('body_bag', -0.8, -2.2, 0.4, { nocollide: true });
      b.clear(0, 0, 4);
    } else if (t === 'shed') {
      b.ground = false;
      b.room(0, 0, 3.6, 3.2, 2.5, rng.chance(0.5) ? 'planks' : 'tin', { n: [door(1.8, 1.2)] }, { roof: 'flat', roofMat: 'tin' });
      b.cont(CONT.TOOLBOX, 0.9, 0.9, { prop: 'toolbox', ry: 0.3, nocollide: true });
      b.cont(CONT.SHELF, -1.15, 0.4, { prop: 'crate', ry: 0, h: 0.6 }); // (in off the wall: a crate is a metre square)
      b.prop('woodpile', 2.8, 0, PI / 2);
    } else if (t === 'hunter') {
      b.prop('hunting_stand', 0, 0, rng.range(0, 6));
      b.cont(CONT.DUFFEL, 1.3, -1.4, { prop: 'duffel_bag', ry: 0.5, nocollide: true });
      b.prop('bones', -1.8, 1.6, 0, { nocollide: true });
      if (rng.chance(0.5)) b.cont(CONT.CRATE, -1.6, -1.2, { prop: 'crate_small', ry: 0.3, h: 0.35, zone: ZONE.RANGER });
      b.clear(0, 0, 3.5);
    } else if (t === 'logpile') {
      b.cont(CONT.LOGPILE, 0, 0, { prop: 'log_pile', ry: rng.range(-0.3, 0.3) });
      b.prop('woodpile', 3.8, 2.2, 0.4);
      if (rng.chance(0.4)) b.wreck('tractor', -4.5, 3, 1.2, { trunk: false });
      b.clear(0, 0, 5);
    } else if (t === 'ruin') {
      b.ground = false;
      // burnt-out homestead: broken stone walls, chimney, charred beams
      const hw = 3.6;
      const hd = 3;
      b.box(0, 0, -hd, 2 * hw, 1.1, 0.35, 'stone', {});
      b.box(-hw, 0, 0, 0.35, 0.8, 2 * hd, 'stone', {});
      b.box(hw, 0, 1.2, 0.35, 1.3, 3.6, 'stone', {});
      b.box(-1.5, 0, hd, 4.2, 0.6, 0.35, 'stone', {});
      b.box(-hw + 0.6, 0, hd - 0.6, 1.1, 5.2, 1.1, 'stone', {});
      b.box(0.5, 1.3, 0.2, 6, 0.22, 0.22, 'charred', { rz: 0.25, collide: false });
      b.box(-0.8, 0.4, -1, 4.5, 0.2, 0.2, 'charred', { ry: 0.6, rz: -0.12, collide: false });
      b.box(0, 0, 0, 6.8, 0.06, 5.4, 'ash', { collide: false });
      b.cont(CONT.CABINET, 1.6, 2.3, { prop: 'cabinet', ry: PI });
      b.loot(-1.2, -1);
      b.clear(0, 0, 6);
    } else if (t === 'grave') {
      b.prop('grave_cross', 0, 1.4, rng.range(-0.2, 0.2));
      b.prop('grave_cross', 1.3, 1.5, rng.range(-0.2, 0.2));
      if (rng.chance(0.5)) b.prop('grave_cross', -1.3, 1.3, rng.range(-0.2, 0.2));
      b.prop('corpse', 0.6, -1.2, rng.range(0, 6), { nocollide: true });
      b.cont(CONT.DUFFEL, -1.2, -1.6, { prop: 'duffel_bag', ry: 0.9, nocollide: true });
      b.clear(0, 0, 3.5);
    }
  }

  // Route 9 dressing: power poles along the highway, the odd sign / mailbox along county roads
  for (const road of roads) {
    if (road.kind === ROAD.TRAIL) continue;
    const p = road.pts;
    const n = p.length / 2;
    for (let i = 10; i < n - 10; i++) {
      const x = p[i * 2];
      const z = p[i * 2 + 1];
      if (Math.abs(x) > MAP_HALF - 8 || Math.abs(z) > MAP_HALF - 8) continue;
      if (nearZone(x, z, 10)) continue;
      if (rail && rail.dist(x, z) < 14) continue; // (nothing stands in a level crossing)
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      const dir = Math.atan2(-tx, -tz);
      let tooClose = false;
      for (const s of sites) if (Math.hypot(s.x - x, s.z - z) < 12) tooClose = true;
      if (tooClose) continue;
      if (road.kind === ROAD.ASPHALT && i % 18 === 0) {
        const side = road.width + 3;
        const px = x + nx * side;
        const pz = z + nz * side;
        if (!propBlocked('power_pole', px, pz, dir)) {
          const py = seatY('power_pole', px, pz, dir);
          props.push({ type: 'power_pole', x: px, y: py, z: pz, ry: dir, seed: i });
          addPropColliders('power_pole', px, py, pz, dir);
        }
      } else if (i % 53 === 26) {
        const r = rng();
        const px = x + nx * (road.width + 2.2);
        const pz = z + nz * (road.width + 2.2);
        const type = r < 0.45 ? 'road_sign' : r < 0.7 ? 'mailbox' : null;
        const seed = type ? rng.int(0, 99) : 0; // (drawn for a sign whether or not it is placed: the stream stays as it was)
        if (type && !propBlocked(type, px, pz, dir)) {
          const py = seatY(type, px, pz, dir);
          props.push({ type, x: px, y: py, z: pz, ry: dir, seed });
          addPropColliders(type, px, py, pz, dir);
        }
      }
    }
  }

  // ---------------------------------------------------------------- vegetation
  const zoneClear = (x, z) => {
    for (const zn of zones) {
      const dx = x - zn.x;
      const dz = z - zn.z;
      if (dx * dx + dz * dz < zn.clear * zn.clear) return true;
    }
    return false;
  };
  const inLake = (x, z) => heightAt(x, z) < WATER_LEVEL + 0.35;
  const occ = new Map();
  const occKey = (i, j) => i * 4096 + j;
  const OCC_CELL = 3;
  const occupied = (x, z, r) => {
    const ci = Math.floor(x / OCC_CELL);
    const cj = Math.floor(z / OCC_CELL);
    for (let j = cj - 2; j <= cj + 2; j++) {
      for (let i = ci - 2; i <= ci + 2; i++) {
        const arr = occ.get(occKey(i, j));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 3) {
          const dx = arr[k] - x;
          const dz = arr[k + 1] - z;
          const rr = arr[k + 2] + r;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  };
  const occupy = (x, z, r) => {
    const key = occKey(Math.floor(x / OCC_CELL), Math.floor(z / OCC_CELL));
    let arr = occ.get(key);
    if (!arr) occ.set(key, (arr = []));
    arr.push(x, z, r);
  };
  // reserve prop / building footprints and site clearings
  for (const p of props) occupy(p.x, p.z, p.type === 'school_bus' || p.type === 'camper' || p.type === 'dump_truck' || p.type === 'heli_wreck' || p.type === 'fuel_tank' ? 5 : 2.5);
  for (const [x, z, r] of clears) occupy(x, z, Math.min(r, 6));
  const roadClear = (x, z, extra) => {
    const d = roadDistAt(x, z);
    return d < (roadKindAt(x, z) === ROAD.TRAIL ? 1.2 : 5.5) + extra - (roadKindAt(x, z) === ROAD.TRAIL ? 0 : 0);
  };
  const clearHit = (x, z, pad) => {
    for (const [cx, cz, r] of clears) {
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < (r + pad) * (r + pad)) return true;
    }
    return false;
  };

  // Does a trunk / boulder of radius r at (x,z) stand on a road or trail? roadClear cannot promise that it does not:
  // the roadDist grid has 2 m cells and stores the distance less the road's extra width, so its test for a trail
  // (1.5 m to the edge) only reaches 0.1 m from the centre line. This one measures against the centre lines.
  const onRoadway = (x, z, r) => {
    if (roadDistAt(x, z) > r + 4.1) return false; // nowhere near one (the grid is good for that: a road's edge is 2.6 on it, read up to 1.5 m off)
    for (const road of roads) {
      const p = road.pts;
      const lim = (road.width + r) * (road.width + r);
      for (let i = 0; i < p.length - 2; i += 2) {
        const ex = p[i + 2] - p[i];
        const ez = p[i + 3] - p[i + 1];
        const t = clamp(((x - p[i]) * ex + (z - p[i + 1]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
        const dx = x - p[i] - ex * t;
        const dz = z - p[i + 1] - ez * t;
        if (dx * dx + dz * dz < lim) return true;
      }
    }
    return false;
  };

  // Does a trunk / boulder of radius r at (x, z) stand in an upright piece a place built (a wall, a post, a machine)?
  // (its grid is built on the first call: every place is up by then)
  let partCells = null;
  function partBlocked(x, z, r) {
    if (!partCells) {
      partCells = new Map();
      for (const p of parts) {
        if (p.rx || p.rz || p.sy < 1 || (p.shape !== 'box' && p.shape !== 'cyl')) continue;
        const e = Math.hypot(p.sx, p.sz) / 2;
        for (let i = Math.floor((p.x - e) / 8); i <= Math.floor((p.x + e) / 8); i++)
          for (let j = Math.floor((p.z - e) / 8); j <= Math.floor((p.z + e) / 8); j++) {
            const k = i * 65536 + j;
            if (!partCells.has(k)) partCells.set(k, []);
            partCells.get(k).push(p);
          }
      }
    }
    for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++)
      for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++) {
        for (const p of partCells.get(i * 65536 + j) || []) {
          if (p.shape === 'cyl') {
            if (Math.hypot(p.x - x, p.z - z) < r + p.sx / 2) return true;
          } else {
            const c = Math.cos(p.ry), s = Math.sin(p.ry), dx = x - p.x, dz = z - p.z;
            const lx = c * dx - s * dz, lz = s * dx + c * dz;
            if (Math.hypot(Math.max(0, Math.abs(lx) - p.sx / 2), Math.max(0, Math.abs(lz) - p.sz / 2)) < r) return true;
          }
        }
      }
    return false;
  }
  const trees = [];
  const pushTree = (x, z, v, scale) => {
    const y = heightAt(x, z);
    const rot = rng.range(0, PI * 2);
    occupy(x, z, 1.4 * scale);
    // a tree on a road is drawn and given its room like any other, then left out: the random stream and the occupancy
    // map stay as they were, so not one other tree, rock, bush or pick-up spot of the seed moves
    if (onRoadway(x, z, TREE_TYPES[v].r * scale) || partBlocked(x, z, TREE_TYPES[v].r * scale)) return; // (nor up through a wall, a fence or a post)
    const c = makeCyl(x, z, y - 1, y + 14 * scale, TREE_TYPES[v].r * scale, COL.STATIC | COL.TREE);
    c.tv = v;
    c.ti = trees.length / 6; // (its record in world.trees: the one a client draws, and hides while it is felled)
    trees.push(x, y, z, scale, rot, v);
    staticGrid.add(c);
  };
  for (const [x, z, v, s] of extraTrees) {
    if (occupied(x, z, 1.2) || roadClear(x, z, 0) || inLake(x, z) || clearHit(x, z, 0.5)) continue;
    pushTree(x, z, v, s);
  }
  const TREE_ATTEMPTS = 16000;
  const LIM = MAP_HALF - 4;
  const church = zoneById[ZONE.CHURCH];
  for (let a = 0; a < TREE_ATTEMPTS; a++) {
    const x = rng.range(-LIM, LIM);
    const z = rng.range(-LIM, LIM);
    const dens = fbm(nE, x * 0.012, z * 0.012, 3);
    if (rng() > 0.25 + 0.75 * smoothstep(-0.35, 0.3, dens)) continue;
    if (zoneClear(x, z)) continue;
    if (roadClear(x, z, 0)) continue;
    if (inLake(x, z)) continue;
    if (clearHit(x, z, 0.8)) continue;
    const scale = rng.range(0.75, 1.3);
    if (occupied(x, z, 1.5 * scale)) continue;
    // variant: mostly conifers; dead trees near the chapel & in dark patches
    const nearChurch = church && Math.hypot(x - church.x, z - church.z) < 90;
    const r = rng();
    let v;
    if (nearChurch && r < 0.45) v = rng.chance(0.5) ? 3 : 4;
    else if (r < 0.26) v = 0;
    else if (r < 0.5) v = 1;
    else if (r < 0.7) v = 2;
    else if (r < 0.8) v = 5;
    else if (r < 0.87) v = 6;
    else if (r < 0.94) v = 3;
    else v = 4;
    pushTree(x, z, v, scale);
  }

  const rocks = [];
  const pushRock = (x, z, v, scale, r) => {
    const y = heightAt(x, z) - 0.25 * scale;
    const rot = rng.range(0, PI * 2);
    occupy(x, z, r);
    if (onRoadway(x, z, r * 0.85) || partBlocked(x, z, r * 0.85)) return; // (left out the way a tree is, above)
    rocks.push(x, y, z, scale, rot, v);
    staticGrid.add(makeCyl(x, z, y - 1, y + r * 0.9, r * 0.85, COL.STATIC));
  };
  for (let a = 0; a < 900 && rocks.length < 380 * 6; a++) {
    const x = rng.range(-LIM, LIM);
    const z = rng.range(-LIM, LIM);
    if (zoneClear(x, z) || roadClear(x, z, 0.5) || inLake(x, z) || clearHit(x, z, 1)) continue;
    const v = rng.int(0, ROCK_TYPES.length - 1);
    const scale = rng.range(0.6, 1.8);
    const r = ROCK_TYPES[v].r * scale;
    if (occupied(x, z, r + 0.5)) continue;
    pushRock(x, z, v, scale, r);
  }
  // boulders around the quarry and the mine
  for (const id of [ZONE.QUARRY, ZONE.MINE]) {
    const q = zoneById[id];
    if (!q) continue;
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, PI * 2);
      const d = rng.range(q.flat * 0.75, q.flat + 8);
      const x = q.x + Math.sin(a) * d;
      const z = q.z + Math.cos(a) * d;
      if (occupied(x, z, 1.2) || roadClear(x, z, 0)) continue;
      const v = rng.int(0, ROCK_TYPES.length - 1);
      const scale = rng.range(1.2, 2.4);
      pushRock(x, z, v, scale, ROCK_TYPES[v].r * scale);
    }
  }

  const bushes = [];
  for (let a = 0; a < 9000; a++) {
    const x = rng.range(-LIM, LIM);
    const z = rng.range(-LIM, LIM);
    if (roadDistAt(x, z) < 4 || inLake(x, z)) continue;
    let inZone = false;
    for (const zn of zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.flat * 0.8) inZone = true;
    if (inZone && rng() < 0.85) continue;
    if (clearHit(x, z, 0)) continue;
    if (occupied(x, z, 0.4)) continue;
    bushes.push(x, heightAt(x, z), z, rng.range(0.7, 1.5), rng.range(0, PI * 2), rng.int(0, 2));
  }

  // ---------------------------------------------------------------- spawns
  const resourceSpawns = [];
  for (let a = 0; a < 3000 && resourceSpawns.length < 130; a++) {
    const x = rng.range(-LIM + 20, LIM - 20);
    const z = rng.range(-LIM + 20, LIM - 20);
    if (zoneClear(x, z)) continue;
    if (inLake(x, z)) continue;
    if (occupied(x, z, 0.8)) continue;
    resourceSpawns.push({ x, y: heightAt(x, z) + 0.02, z, zone: ZONE.FOREST });
  }
  // day-one scavenging: floor loot (the breakdown's cloth / sticks / planks table) spread evenly by
  // angle around the car, so whichever way a survivor heads out there is torch cloth before the first
  // night. Own rng stream so the rest of the valley stays identical.
  const ringRng = mulberry32(seed ^ 0x70c4);
  const RING_SPOTS = 48;
  for (let i = 0; i < RING_SPOTS; i++) {
    for (let tries = 0; tries < 12; tries++) {
      const a = ((i + ringRng()) / RING_SPOTS) * PI * 2;
      const r = ringRng.range(30, 140);
      const x = car.x + Math.sin(a) * r;
      const z = car.z + Math.cos(a) * r;
      if (Math.abs(x) > LIM - 20 || Math.abs(z) > LIM - 20) continue;
      if (zoneClear(x, z) || inLake(x, z) || occupied(x, z, 0.8)) continue;
      lootSpawns.push({ x, y: heightAt(x, z) + 0.02, z, zone: ZONE.CAMP });
      break;
    }
  }
  // fallback horde spawn ring (the night horde normally spawns around wherever the survivors are)
  const hordeSpawns = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * PI * 2;
    for (let tries = 0; tries < 8; tries++) {
      const r = rng.range(215, 270);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (Math.abs(x) > LIM - 10 || Math.abs(z) > LIM - 10) continue;
      if (inLake(x, z)) continue;
      hordeSpawns.push({ x, z });
      break;
    }
  }

  // ---------------------------------------------------------------- queries
  // The ground under feet at height y over (x,z): the terrain, or the floor of the drift they are down in.
  // (heightAt is the terrain alone: what grows, what is built and what the map shows stand on that)
  const floorAt = (x, z, y) => {
    if (mine) {
      const f = mine.floorFor(x, z, y);
      if (f === f) return f;
    }
    // (...or what the railway has to stand on above the ground: a platform, the floor of an open boxcar)
    if (rail) {
      const f = rail.floorFor(x, z, y);
      if (f === f) return f;
    }
    return heightAt(x, z);
  };
  // how far (x,y,z) is above the solid ground: the terrain, or in the air of a drift its floor (the rock around a
  // drift is under the terrain, so its walls and roof stop a ray like any hillside)
  const above = (x, y, z) => {
    if (mine) {
      const f = mine.voidFloor(x, z, y);
      if (f === f) return y - f;
    }
    return y - heightAt(x, z);
  };
  const rayTerrain = (ox, oy, oz, dx, dy, dz, maxT) => {
    const step = 0.75;
    let prevT = 0;
    let prevD = above(ox, oy, oz);
    if (prevD < 0) return 0;
    for (let t = step; t <= maxT + step; t += step) {
      const tt = t > maxT ? maxT : t;
      const y = oy + dy * tt;
      if (y > 70 && dy >= 0) return -1;
      const d = above(ox + dx * tt, y, oz + dz * tt);
      if (d < 0) {
        let lo = prevT;
        let hi = tt;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          const dm = above(ox + dx * m, oy + dy * m, oz + dz * m);
          if (dm < 0) hi = m;
          else lo = m;
        }
        return (lo + hi) / 2;
      }
      prevT = tt;
      prevD = d;
      if (tt >= maxT) break;
    }
    return -1;
  };

  const zoneAt = (x, z) => {
    for (const zn of zones) {
      if (Math.hypot(x - zn.x, z - zn.z) < zn.flat + 8) return zn.id;
    }
    return ZONE.FOREST;
  };

  const isDeepWater = (x, z) => heightAt(x, z) < WATER_LEVEL - 0.95;

  // nearest doorway to (x,z) within maxD (for door boards)
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

  return {
    seed,
    heights,
    roadDist,
    roadKind,
    roadDir,
    heightAt,
    floorAt,
    mine,
    clinic, // Mercy Clinic (clinic.js), or null on a map without it
    darks,
    darkAt: (x, y, z) => darkAt(darks, x, y, z), // how dark it is there at noon: 0 in daylight .. 1 (clinic.js)
    fair,
    rail,
    roadDistAt,
    roadKindAt,
    rayTerrain,
    isDeepWater,
    zoneAt,
    zones,
    zoneById,
    roads,
    highway,
    lake,
    ponds,
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
    car,
    cemetery,
  };
}


// Douglas-Peucker polyline simplification
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax;
    const dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    let md = 0;
    let mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > eps && mi > 0) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const NDI = [1, -1, 0, 0, 1, 1, -1, -1];
const NDJ = [0, 0, 1, -1, 1, -1, 1, -1];
