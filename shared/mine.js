// The workings under Blackrock Mine: a drift that runs down from the adit in the mine yard, under the valley, and up
// again to a second portal at the edge of another place, with a junction chamber and a few dead-end galleries off it.
//
// The valley is a heightfield, so the workings are a second level under it: planMine() lays them out for a seed and
// bakes two small grids over them - the distance to the rock (negative inside a drift) and the height of the floor -
// which is all that movement, rays and the renderer need:
//   floorFor(x, z, y)   the floor under feet at height y that are down in the workings (NaN: they are on the surface)
//   voidFloor(x, z, y)  the same for a point in the air of a drift: what a ray may pass through
//   confine(pos, r)     keeps a body of radius r off the rock
// world.js makes them part of the world (world.floorAt, world.rayTerrain, resolveBody), so nothing that walks, falls,
// shoots or looks needs to know the mine is there. The terrain is only changed at the two portals: a levelled apron,
// a mound over the decline, and enough ground left over every roof.
import { MAP_HALF, GRID_N, GRID_STEP, WATER_LEVEL } from './constants.js';
import { ZONE } from './defs.js';
import { mulberry32, smoothstep, clamp } from './rng.js';

export const MINE_R = 1.9; // half the width of a drift (m)
export const MINE_H = 3; // floor to roof: nothing that jumps reaches it (a survivor's head gets to 2.7)
export const MINE_PAD = 0.1; // a body keeps this much further from the rock than its own radius
// the built portal: stone piers either side of the first metres of the decline and a slab over them, where the
// drift is not yet under the ground. The terrain is not drawn (HOLE) or walked on inside it.
export const PORTAL = { LEN: 8, HOLE: 7.2, LINER: 0.3, PIER: 3.2, TOP: 4.4, SLAB: 3.4 };

const CELL = 0.5; // resolution of the baked fields
const FAR = 3.5; // the distance field is only kept this far out from the rock face...
const NEAR = 2; // ...and only trusted this far: further than anything gets into the rock in one step
const DECLINE = 0.42; // the grade of the declines behind the portals
const GRADE = 0.2; // the steepest the drift runs anywhere else
const COVER = 4; // rock kept between a roof and the ground above it
const COVER_MIN = 1.5; // ...and what is always there, by raising the ground if it has to be (over the declines)
const RUN = 22; // a decline runs straight this far before the drift turns
const STUB = 6; // the distance field runs on this far out of a portal, so a body walks out of it unhindered
const APRON = 7; // levelled ground in front of a portal
// the hillock a portal is set into: height, how far behind the mouth, radii. It starts FRONT m behind the mouth: the
// heightfield has a point every 2 m, and a raised one any nearer would lift the ground in front of the mouth with it
const MOUND = { H: 4.2, AT: 14, LONG: 11, WIDE: 11 };
const FRONT = 3;
const REACH = [80, 250, 340]; // length of the main drift (m): the least, the most, and the most where nothing nearer can be reached
const RING = 7; // the far portal stands this far outside the levelled yard of its place

// heights: the heightfield (changed in place around the portals). heightAt / roadDistAt: the world's queries, read
// live. taken(x, z, r): is anything built, lying or due to be built within r of (x,z)? (the places stand by now)
// Returns null where no drift can be cut (no mine on the map, or nowhere to come up).
export function planMine({ seed, zones, heights, heightAt, roadDistAt, taken }) {
  const home = zones.find((z) => z.id === ZONE.MINE);
  if (!home) return null;
  const rng = mulberry32(seed ^ 0x3a1e5);
  const dry = (x, z) => heightAt(x, z) > WATER_LEVEL + 0.8;
  const inMap = (x, z, pad) => Math.max(Math.abs(x), Math.abs(z)) < MAP_HALF - pad;

  // ---------------------------------------------------------------- portals
  // the adit: at the back of the mine yard (local (0, 22)), the drift running on into the hill behind it
  const A = { x: home.x + Math.sin(home.ry) * 22, z: home.z + Math.cos(home.ry) * 22, y: home.h, dx: Math.sin(home.ry), dz: Math.cos(home.ry), zone: ZONE.MINE };

  // is the ground a portal at (x,z) facing (dx,dz) takes up free, from `from` m along its axis (the apron in front
  // of it is negative) to the back of its mound?
  const free = (x, z, dx, dz, from) => {
    for (let s = from; s <= MOUND.AT + MOUND.LONG; s += 2.5) {
      for (let lat = -10; lat <= 10; lat += 2.5) {
        const built = s <= PORTAL.LEN + 1 && Math.abs(lat) <= 7.5;
        if (!built && ((s - MOUND.AT) / MOUND.LONG) ** 2 + (lat / MOUND.WIDE) ** 2 >= 1) continue;
        if (taken(x + dx * s - dz * lat, z + dz * s + dx * lat, 1.8)) return false;
      }
    }
    return true;
  };
  // (the adit stands where the yard has it, behind the yard's own rails and tubs: only what it is built on counts)
  if (!free(A.x, A.z, A.dx, A.dz, 1.5)) return null;
  // can a portal stand at (x,z) facing (dx,dz)? Dry, off the roads, clear of every other place and of anything
  // built, on ground that is near enough level to cut an apron into
  const siteOk = (x, z, dx, dz, own) => {
    if (!inMap(x, z, 60) || !free(x, z, dx, dz, -APRON - 2)) return false;
    const h0 = heightAt(x, z);
    for (let s = -APRON - 1; s <= 30; s += 2) {
      for (const lat of [-11, -5.5, 0, 5.5, 11]) {
        const px = x + dx * s - dz * lat;
        const pz = z + dz * s + dx * lat;
        if (!dry(px, pz) || !inMap(px, pz, 40)) return false;
        if (s <= 26 && roadDistAt(px, pz) < 5) return false;
        if (s <= 9 && Math.abs(lat) < 6 && Math.abs(heightAt(px, pz) - h0) > 3) return false;
        for (const o of zones) if (o !== own && Math.hypot(px - o.x, pz - o.z) < o.flat + 4) return false;
      }
    }
    return true;
  };

  // ---------------------------------------------------------------- the main drift
  // From the foot of one decline to the foot of the other by way of a dog-leg (the junction), every corner rounded.
  // -> { x, z, n, len, jx }: a point every metre or so, and the one nearest the junction
  const route = (B) => {
    const P1 = [A.x + A.dx * RUN, A.z + A.dz * RUN];
    const Q1 = [B.x + B.dx * RUN, B.z + B.dz * RUN];
    const vx = Q1[0] - P1[0];
    const vz = Q1[1] - P1[1];
    const L = Math.hypot(vx, vz) || 1;
    const t = rng.range(0.42, 0.58);
    const off = (L > 36 ? clamp(rng.range(0.12, 0.22) * L, 8, 24) : 0) * (rng.chance(0.5) ? 1 : -1);
    const J = [P1[0] + vx * t - (vz / L) * off, P1[1] + vz * t + (vx / L) * off];
    // a drift does not double straight back on itself: a turn sharper than ~105 degrees is taken in two
    const elbow = (P, d) => {
      const ox = J[0] - P[0];
      const oz = J[1] - P[1];
      const ol = Math.hypot(ox, oz) || 1;
      if ((d.dx * ox + d.dz * oz) / ol > -0.27) return null;
      const side = -d.dz * ox + d.dx * oz >= 0 ? 1 : -1;
      return [P[0] - d.dz * side * 14, P[1] + d.dx * side * 14];
    };
    const ea = elbow(P1, A);
    const eb = elbow(Q1, B);
    const ctrl = [[A.x, A.z], P1, ...(ea ? [ea] : []), J, ...(eb ? [eb] : []), Q1, [B.x, B.z]];
    // corners: a quadratic curve between the points a tangent length either side of each
    const dense = [ctrl[0]];
    for (let i = 1; i < ctrl.length - 1; i++) {
      const [px, pz] = ctrl[i - 1];
      const [cx, cz] = ctrl[i];
      const [nx, nz] = ctrl[i + 1];
      const la = Math.hypot(cx - px, cz - pz) || 1;
      const lb = Math.hypot(nx - cx, nz - cz) || 1;
      const ux = (cx - px) / la;
      const uz = (cz - pz) / la;
      const wx = (nx - cx) / lb;
      const wz = (nz - cz) / lb;
      const turn = Math.acos(clamp(ux * wx + uz * wz, -1, 1));
      if (turn < 0.05) {
        dense.push(ctrl[i]);
        continue;
      }
      const tl = Math.min(9 * Math.tan(turn / 2), la * 0.45, lb * 0.45);
      const steps = Math.ceil(turn * 8) + 2;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const a = (1 - u) * (1 - u);
        const b = 2 * u * (1 - u);
        const c = u * u;
        dense.push([a * (cx - ux * tl) + b * cx + c * (cx + wx * tl), a * (cz - uz * tl) + b * cz + c * (cz + wz * tl)]);
      }
    }
    dense.push(ctrl[ctrl.length - 1]);
    const line = resample(dense);
    let jx = 0;
    for (let i = 1; i < line.n; i++) if (Math.hypot(line.x[i] - J[0], line.z[i] - J[1]) < Math.hypot(line.x[jx] - J[0], line.z[jx] - J[1])) jx = i;
    line.jx = jx;
    return line;
  };

  // lowest ground over the drift at point i of a line (its full width and a little more)
  const groundOver = (line, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(line.n - 1, i + 1);
    const tx = line.x[b] - line.x[a];
    const tz = line.z[b] - line.z[a];
    const tl = Math.hypot(tx, tz) || 1;
    let lo = Infinity;
    for (const lat of [-5, -2.5, 0, 2.5, 5]) lo = Math.min(lo, heightAt(line.x[i] - (tz / tl) * lat, line.z[i] + (tx / tl) * lat));
    return lo;
  };

  // The floor along the main drift: down each decline at DECLINE, then as near under the ground as COVER allows,
  // never steeper than GRADE, dropping to a sump around the junction. `flat` marks the stretches (the junction,
  // the bays the galleries leave from) that are level: tau is the distance along the drift with those left out.
  // -> null where the drift would come too near the surface away from its portals
  const profile = (line, B, bays) => {
    const n = line.n;
    const tau = new Float64Array(n);
    const flat = (i) => bays.some(([c, w]) => Math.abs(i - c) <= w && Math.abs(i - 1 - c) <= w);
    for (let i = 1; i < n; i++) tau[i] = tau[i - 1] + (flat(i) ? 0 : Math.hypot(line.x[i] - line.x[i - 1], line.z[i] - line.z[i - 1]));
    const over = new Float64Array(n);
    for (let i = 0; i < n; i++) over[i] = groundOver(line, i);
    const sump = rng.range(3, 6);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let lo = Infinity;
      for (let k = Math.max(0, i - 6); k <= Math.min(n - 1, i + 6); k++) lo = Math.min(lo, over[k]);
      y[i] = lo - MINE_H - COVER - sump * (1 - smoothstep(8, 40, Math.abs(i - line.jx)));
    }
    y[0] = A.y;
    y[n - 1] = B.y;
    for (let i = 1; i < n; i++) y[i] = Math.min(y[i], y[i - 1] + GRADE * (tau[i] - tau[i - 1]));
    for (let i = n - 2; i >= 0; i--) y[i] = Math.min(y[i], y[i + 1] + GRADE * (tau[i + 1] - tau[i]));
    const T = tau[n - 1];
    for (let i = 0; i < n; i++) y[i] = Math.max(y[i], A.y - DECLINE * tau[i], B.y - DECLINE * (T - tau[i]));
    for (let i = 0; i < n; i++) {
      const cover = over[i] - y[i] - MINE_H;
      const end = Math.min(i, n - 1 - i);
      // (over a decline the mound makes up what is missing, but it is no embankment)
      if (end >= 30 ? cover < 2 : end >= PORTAL.LEN && cover < COVER_MIN - 3.5) return null;
    }
    return y;
  };

  // the best way up: every other place in turn, at a handful of spots round the side of it that faces the mine
  // (a mine out on its own at the rim of the valley gets a longer drift rather than none)
  let best = null;
  const foot = [A.x + A.dx * RUN, A.z + A.dz * RUN];
  for (const reach of [REACH[1], REACH[2]]) {
    if (best) break;
    for (const zn of zones) {
    if (zn === home || zn.id === ZONE.CAMP) continue;
    const a0 = Math.atan2(foot[0] - zn.x, foot[1] - zn.z);
    for (const da of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2]) {
      const dx = Math.sin(a0 + da);
      const dz = Math.cos(a0 + da);
      const x = zn.x + dx * (zn.flat + RING);
      const z = zn.z + dz * (zn.flat + RING);
      const far = Math.hypot(x - A.x, z - A.z);
      if (far < 60 || far > reach || !siteOk(x, z, dx, dz, zn)) continue;
      const B = { x, z, y: heightAt(x, z), dx, dz, zone: zn.id };
      const line = route(B);
      if (line.len < REACH[0] || line.len > reach) continue;
      // under dry ground all the way, inside the map (a drift may run on under the rim of the valley, where nothing
      // on the surface goes), and never back under itself or its own portals
      let ok = true;
      for (let i = 0; i < line.n && ok; i++) {
        ok = inMap(line.x[i], line.z[i], 14) && dry(line.x[i], line.z[i]) && dry(line.x[i] + 4, line.z[i]) && dry(line.x[i] - 4, line.z[i]) && dry(line.x[i], line.z[i] + 4) && dry(line.x[i], line.z[i] - 4);
        for (let k = i + 26; k < line.n && ok; k += 2) ok = Math.hypot(line.x[i] - line.x[k], line.z[i] - line.z[k]) > MINE_R * 2 + 4;
        if (i > 26) for (const p of [A, B]) ok = ok && !(i < line.n - 27 && Math.hypot(line.x[i] - (p.x - p.dx * 3), line.z[i] - (p.z - p.dz * 3)) < MINE_R + 8);
      }
      if (!ok) continue;
      const score = Math.abs(line.len - 150) + Math.abs(da) * 12;
      if (best && score >= best.score) continue;
      const bays = bayPlan(line, rng);
      const y = profile(line, B, bays);
      if (!y) continue;
      line.y = y;
      best = { B, line, bays, score };
    }
    }
  }
  if (!best) return null;
  const { B, line: main, bays } = best;
  const portals = [A, B];
  for (const p of portals) p.ry = Math.atan2(p.dx, p.dz); // (a Builder at the mouth with this yaw has the drift along its +Z)

  // ---------------------------------------------------------------- galleries
  // dead ends off the junction and the bays, each ending in a room. They leave from level floor and run down a little.
  const rooms = [{ x: main.x[main.jx], z: main.z[main.jx], y: main.y[main.jx], r: bays[0][1] - 2, kind: 'junction', dx: 0, dz: 1 }];
  const galleries = [];
  const clearOf = (x, z, r, from) => {
    for (let i = 0; i < main.n; i++) if (Math.abs(i - from) > 7 && Math.hypot(x - main.x[i], z - main.z[i]) < r + MINE_R + 3.5) return false;
    for (const g of galleries) for (let i = 0; i < g.n; i++) if (Math.hypot(x - g.x[i], z - g.z[i]) < r + MINE_R + 3.5) return false;
    for (let k = 1; k < rooms.length; k++) if (Math.hypot(x - rooms[k].x, z - rooms[k].z) < r + rooms[k].r + 3.5) return false;
    for (const p of portals) if (Math.hypot(x - p.x, z - p.z) < 30) return false;
    return inMap(x, z, 20);
  };
  const roofed = (x, z, y, r) => {
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (!dry(x + ox, z + oz) || heightAt(x + ox, z + oz) < y + MINE_H + 2.5) return false;
    return true;
  };
  bays.forEach(([c], bi) => {
    const sides = bi === 0 ? [1, -1] : [rng.chance(0.5) ? 1 : -1];
    for (const side of sides) {
      for (let tries = 0; tries < 14; tries++) {
        const a = Math.max(0, c - 1);
        const b = Math.min(main.n - 1, c + 1);
        const tl = Math.hypot(main.x[b] - main.x[a], main.z[b] - main.z[a]) || 1;
        const base = Math.atan2(-((main.z[b] - main.z[a]) / tl) * side, ((main.x[b] - main.x[a]) / tl) * side);
        const a1 = base + rng.range(-0.5, 0.5);
        const a2 = a1 + rng.range(-0.6, 0.6);
        const len = rng.range(16, 30);
        const r = rng.range(3.6, 5.2);
        const mid = [main.x[c] + Math.sin(a1) * len * 0.55, main.z[c] + Math.cos(a1) * len * 0.55];
        const end = [mid[0] + Math.sin(a2) * len * 0.45, mid[1] + Math.cos(a2) * len * 0.45];
        const g = resample([[main.x[c], main.z[c]], mid, end]);
        g.y = new Float64Array(g.n);
        let ok = true;
        for (let i = 0; i < g.n && ok; i++) {
          g.y[i] = main.y[c] - 0.07 * Math.max(0, i - 6);
          ok = i < 7 || (clearOf(g.x[i], g.z[i], 0, c) && roofed(g.x[i], g.z[i], g.y[i], 2.5));
        }
        const ey = g.y[g.n - 1];
        if (!ok || !clearOf(end[0], end[1], r, c) || !roofed(end[0], end[1], ey, r + 1)) continue;
        galleries.push(g);
        rooms.push({ x: end[0], z: end[1], y: ey, r, kind: 'end', dx: Math.sin(a2), dz: Math.cos(a2) });
        break;
      }
    }
  });

  // ---------------------------------------------------------------- the baked fields
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  const grow = (x, z, r) => {
    x0 = Math.min(x0, x - r);
    x1 = Math.max(x1, x + r);
    z0 = Math.min(z0, z - r);
    z1 = Math.max(z1, z + r);
  };
  for (const l of [main, ...galleries]) for (let i = 0; i < l.n; i++) grow(l.x[i], l.z[i], MINE_R + FAR + 1);
  for (const rm of rooms) grow(rm.x, rm.z, rm.r + FAR + 1);
  for (const p of portals) grow(p.x - p.dx * STUB, p.z - p.dz * STUB, MINE_R + FAR + 1);
  const ox = Math.floor(x0);
  const oz = Math.floor(z0);
  const nx = Math.ceil((x1 - ox) / CELL) + 2;
  const nz = Math.ceil((z1 - oz) / CELL) + 2;
  const sd = new Float32Array(nx * nz).fill(FAR);
  const fl = new Float32Array(nx * nz);
  // a capsule from a to b (floor ya..yb), or a disc when the two are the same point
  const stamp = (ax, az, ya, bx, bz, yb, r) => {
    const reach = r + FAR;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - ox) / CELL));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + reach - ox) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - oz) / CELL));
    const j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + reach - oz) / CELL));
    const ex = bx - ax;
    const ez = bz - az;
    const el2 = ex * ex + ez * ez;
    for (let j = j0; j <= j1; j++) {
      const z = oz + j * CELL;
      for (let i = i0; i <= i1; i++) {
        const x = ox + i * CELL;
        const t = el2 > 0 ? clamp(((x - ax) * ex + (z - az) * ez) / el2, 0, 1) : 0;
        const d = Math.hypot(x - ax - ex * t, z - az - ez * t) - r;
        const k = j * nx + i;
        if (d >= sd[k]) continue;
        sd[k] = d;
        fl[k] = ya + (yb - ya) * t;
      }
    }
  };
  for (const l of [main, ...galleries]) for (let i = 0; i < l.n - 1; i++) stamp(l.x[i], l.z[i], l.y[i], l.x[i + 1], l.z[i + 1], l.y[i + 1], MINE_R);
  for (const rm of rooms) stamp(rm.x, rm.z, rm.y, rm.x, rm.z, rm.y, rm.r);
  for (const p of portals) stamp(p.x - p.dx * STUB, p.z - p.dz * STUB, p.y, p.x, p.z, p.y, MINE_R);

  // ---------------------------------------------------------------- the ground at the portals
  const N = GRID_N;
  const eachVertex = (cx, cz, r, fn) => {
    const i0 = Math.max(0, Math.floor((cx - r + MAP_HALF) / GRID_STEP));
    const i1 = Math.min(N - 1, Math.ceil((cx + r + MAP_HALF) / GRID_STEP));
    const j0 = Math.max(0, Math.floor((cz - r + MAP_HALF) / GRID_STEP));
    const j1 = Math.min(N - 1, Math.ceil((cz + r + MAP_HALF) / GRID_STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * N + i, -MAP_HALF + i * GRID_STEP, -MAP_HALF + j * GRID_STEP);
  };
  for (const p of portals) {
    // the apron, level with the mouth
    eachVertex(p.x - p.dx * 3, p.z - p.dz * 3, APRON + 12, (k, x, z) => {
      const s = (x - p.x) * p.dx + (z - p.z) * p.dz;
      const lat = Math.abs(-(x - p.x) * p.dz + (z - p.z) * p.dx);
      const out = Math.hypot(Math.max(0, -APRON - s, s - 1.5), Math.max(0, lat - 6.5));
      heights[k] += (p.y - heights[k]) * (1 - smoothstep(0, 4, out));
    });
    // the mound the portal is set into
    eachVertex(p.x + p.dx * MOUND.AT, p.z + p.dz * MOUND.AT, MOUND.LONG + MOUND.WIDE, (k, x, z) => {
      const s = (x - p.x) * p.dx + (z - p.z) * p.dz;
      const lat = -(x - p.x) * p.dz + (z - p.z) * p.dx;
      const e = ((s - MOUND.AT) / MOUND.LONG) ** 2 + (lat / MOUND.WIDE) ** 2;
      // (a road that runs round the back of the yard keeps its bed: the mound stops short of it)
      if (s >= FRONT && e < 1) heights[k] += MOUND.H * (1 - e) * (1 - e) * smoothstep(3, 8, roadDistAt(x, z));
    });
  }
  // ...and COVER_MIN of ground over every roof that is not inside a portal
  const inFront = (x, z) => portals.some((p) => (x - p.x) * p.dx + (z - p.z) * p.dz < FRONT && Math.hypot(x - p.x, z - p.z) < APRON + 14);
  const cover = (x, z, y, r) => {
    eachVertex(x, z, r + 5.5, (k, vx, vz) => {
      const need = y + MINE_H + COVER_MIN;
      if (heights[k] >= need || inFront(vx, vz)) return;
      heights[k] += (need - heights[k]) * (1 - smoothstep(r + 1.5, r + 5.5, Math.hypot(vx - x, vz - z)));
    });
  };
  for (let i = PORTAL.LEN - 1; i <= main.n - PORTAL.LEN; i++) cover(main.x[i], main.z[i], main.y[i], MINE_R);
  for (const g of galleries) for (let i = 0; i < g.n; i++) cover(g.x[i], g.z[i], g.y[i], MINE_R);
  for (const rm of rooms) cover(rm.x, rm.z, rm.y, rm.r);

  // ---------------------------------------------------------------- queries
  // bilinear reads of the baked fields (FAR / 0 outside them)
  const sdf = (x, z) => {
    const fx = (x - ox) / CELL;
    const fz = (z - oz) / CELL;
    if (!(fx >= 0 && fz >= 0 && fx < nx - 1 && fz < nz - 1)) return FAR;
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const v = fz - j;
    const k = j * nx + i;
    const a = sd[k] + (sd[k + 1] - sd[k]) * u;
    const b = sd[k + nx] + (sd[k + nx + 1] - sd[k + nx]) * u;
    return a + (b - a) * v;
  };
  const floorOf = (x, z) => {
    const fx = clamp((x - ox) / CELL, 0, nx - 1.001);
    const fz = clamp((z - oz) / CELL, 0, nz - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const v = fz - j;
    const k = j * nx + i;
    const a = fl[k] + (fl[k + 1] - fl[k]) * u;
    const b = fl[k + nx] + (fl[k + nx + 1] - fl[k + nx]) * u;
    return a + (b - a) * v;
  };
  // on the daylight side of a portal: the stub of the distance field in front of its mouth is open ground
  const outside = (x, z, y) => {
    for (let k = 0; k < 2; k++) {
      const p = portals[k];
      const s = (x - p.x) * p.dx + (z - p.z) * p.dz;
      if (s < 0 && s > -STUB - 4 && y > p.y - 2 && Math.abs(-(x - p.x) * p.dz + (z - p.z) * p.dx) < MINE_R + FAR) return true;
    }
    return false;
  };
  // Feet at height y over (x,z): the floor of the drift they are in, or NaN when they are on the surface. Whatever is
  // below the ground beside a drift (a step into the rock, before confine has put it back) is still down there.
  const floorFor = (x, z, y) => {
    const d = sdf(x, z);
    if (d >= NEAR) return NaN;
    const f = floorOf(x, z);
    if (y >= f + MINE_H || outside(x, z, y)) return NaN;
    return d < 0 || y < heightAt(x, z) - 0.5 ? f : NaN;
  };
  // a point in the air of a drift -> its floor (what a ray flies through); NaN in the rock and above the ground
  const voidFloor = (x, z, y) => {
    if (sdf(x, z) >= 0) return NaN;
    const f = floorOf(x, z);
    return y >= f + MINE_H || outside(x, z, y) ? NaN : f;
  };
  // Keeps a body (pos {x,y,z}, radius r) that is down in the workings off the rock. The portals' own walls take over
  // where the drift comes up to the ground. Returns true if it was moved.
  const confine = (pos, r) => {
    let d = sdf(pos.x, pos.z);
    const lim = -(r + MINE_PAD);
    if (d >= NEAR || d <= lim) return false;
    if (pos.y >= floorOf(pos.x, pos.z) + MINE_H || pos.y >= heightAt(pos.x, pos.z) - 0.5 || outside(pos.x, pos.z, pos.y)) return false;
    for (let it = 0; it < 4 && d > lim + 1e-3; it++) {
      const gx = sdf(pos.x + 0.25, pos.z) - sdf(pos.x - 0.25, pos.z);
      const gz = sdf(pos.x, pos.z + 0.25) - sdf(pos.x, pos.z - 0.25);
      const gl = Math.hypot(gx, gz);
      if (gl < 1e-6) break;
      pos.x -= (gx / gl) * (d - lim);
      pos.z -= (gz / gl) * (d - lim);
      d = sdf(pos.x, pos.z);
    }
    return true;
  };
  // inside a portal, where the terrain is neither drawn nor stood on
  const inHole = (x, z) => {
    if (sdf(x, z) > 0.3) return false;
    for (const p of portals) {
      const s = (x - p.x) * p.dx + (z - p.z) * p.dz;
      if (s > 0.6 && s < PORTAL.LEN + 0.5 && Math.abs(-(x - p.x) * p.dz + (z - p.z) * p.dx) < MINE_R + 0.5) return true;
    }
    return false;
  };
  // how far down the workings (x,z) is from daylight: metres from the nearer mouth
  const depth = (x, z) => Math.min(Math.hypot(x - A.x, z - A.z), Math.hypot(x - B.x, z - B.z));
  // (the plan keeps its lines as plain arrays of points)
  const lines = [main, ...galleries].map((l) => ({ x: Array.from(l.x), y: Array.from(l.y), z: Array.from(l.z), n: l.n }));

  return {
    portals, // [{ x, y, z, dx, dz, ry, zone }]: the middle of the mouth on the floor, the unit vector into the drift
    main: lines[0], // { x, y, z, n }: the floor along the centre line, a point every metre
    galleries: lines.slice(1),
    rooms, // [{ x, y, z, r, kind, dx, dz }]: the junction, then the room at the end of each gallery (dx,dz: the way in)
    jx: main.jx,
    length: main.len,
    grid: { ox, oz, nx, nz, cell: CELL, sd, fl },
    sdf,
    floorOf,
    floorFor,
    voidFloor,
    confine,
    outside,
    inHole,
    depth,
    under: (x, y, z) => floorFor(x, z, y) === floorFor(x, z, y),
  };
}

// the level stretches of the main drift, [point, half width]: the junction first, then a bay either side of it
// where there is drift enough between it and the declines
function bayPlan(line, rng) {
  const bays = [[line.jx, Math.round(rng.range(5, 6)) + 2]];
  for (const dir of [-1, 1]) {
    const c = line.jx + dir * Math.round(rng.range(24, 36));
    if (c > 42 && c < line.n - 43) bays.push([c, 4]);
  }
  return bays;
}

// a polyline as points a metre apart (the last gap as near that as the length allows): { x, z, n, len }
function resample(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const n = Math.max(2, Math.round(len) + 1);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const step = len / (n - 1);
  let seg = 1;
  let done = 0; // length of the segments before `seg`
  for (let i = 0; i < n; i++) {
    const at = i * step;
    while (seg < pts.length - 1 && done + Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]) < at) {
      done += Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]);
      seg++;
    }
    const sl = Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]) || 1;
    const t = clamp((at - done) / sl, 0, 1);
    x[i] = pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * t;
    z[i] = pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * t;
  }
  x[n - 1] = pts[pts.length - 1][0];
  z[n - 1] = pts[pts.length - 1][1];
  return { x, z, n, len };
}
