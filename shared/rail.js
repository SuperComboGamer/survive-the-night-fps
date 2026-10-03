// The railway: a single track across the valley from rim to rim, Whitlock Depot on it, a freight train stalled on
// it, and a tunnel mouth in the hillside at either end.
//
// layout.js plans the course of the line (and where the depot and the train stand on it); planRail() gives it
// its heights and world.js calls the result at the points of world generation where the line matters:
//   pinRoad / cost    a road or trail crosses the line on the level, and the road router pays to run along it
//                     (it is never a wall: a crossing costs a cell or two)
//   grade             the heightfield is cut and filled to the formation (cuttings, embankments, the tunnel
//                     bores, the loading bank beside the train), and the bed is entered in the road grids so that
//                     nothing grows or is built on it
//   build             what stands on it: the depot, the train, the tunnel mouths, plank crossings
//   settle            after the mine has had its say about the ground over its roofs
// Rails and sleepers are only drawn (client/render/railway.js draws rail.tracks): the line is open ground to
// everything that walks, and to the nav grid. What can be stood on above the ground - the floors of the open
// boxcars, the loading dock, the platform - are thin slabs (decks to nav.js), listed in rail.decks so that
// world.floorAt knows them too.
import { MAP_HALF, GRID_N, GRID_STEP, WATER_LEVEL, STEP_HEIGHT } from './constants.js';
import { ZONE, CONT } from './defs.js';
import { mulberry32, smoothstep, clamp } from './rng.js';
import { makeBox } from './collision.js';
import { ROAD, DEPOT_TRACK } from './layout.js';
import { MINE_H } from './mine.js';

const PI = Math.PI;
const NC = { collide: false };

export const RAIL = {
  GAUGE: 1.435,
  BED: 3.8, // half the width of the formation: the ground is dead level this far either side of the centre line
  SLOPE: 0.8, // the sides of a cutting or an embankment beyond it
  GRADE: 0.03, // the steepest the line runs
  DROP: 0.9, // the line lies this far below the depot's yard and the loading bank...
  FLOOR: 1.1, // ...and the floor of a car, level with the platform and the dock, this far above the bed
  COVER: 7, // the hill stands this high over the line where a tunnel mouth is set into it
  BORE: 7, // a tunnel runs this far in to its cave-in
  BORE_R: 2.3, // half the width of the bore
  BORE_H: 5.2,
  SIDING: 4.4, // the siding at the depot runs this far from the main line
  CAR: 12.2, // a freight car, over its ends
  LOCO: 15,
  GAP: 1, // between two cars (their couplers)
};
const BORE_BED = RAIL.BORE_R + GRID_STEP; // the ground is cut level this wide in a bore, so none of it shows inside
const BORE_SLOPE = 3; // ...and comes back up under the stone of the portal
const PIN = 38; // the line is level this far either side of the middle of the depot
const HALF_TRAIN = 47; // ...and under the train

// plan: what layout.js planned ({ line, depot, train, bank }, or null). depot: the depot's place (or undefined).
// rawH(x, z): the heightfield before roads. edgeRise(x, z): how much of that is the rim of the valley.
// -> the railway (see the return at the end), or null on a map without one
export function planRail(plan, { seed, depot, rawH, edgeRise }) {
  if (!plan) return null;
  const full = resample(plan.line);
  const nearest = ([px, pz]) => {
    let b = 0;
    for (let i = 1; i < full.n; i++) if (Math.hypot(full.x[i] - px, full.z[i] - pz) < Math.hypot(full.x[b] - px, full.z[b] - pz)) b = i;
    return b;
  };
  let iT = nearest(plan.line[plan.train]);

  // ---------------------------------------------------------------- the profile
  // The line follows the lie of the land, smoothed over a train's length and held to GRADE: what is left over is
  // cut or filled. It takes no notice of the rim (it goes into that by tunnel), runs level through the depot at
  // DROP below its yard, and level under the stalled train.
  const G = RAIL.GRADE;
  const fy = new Float64Array(full.n);
  for (let i = 0; i < full.n; i++) fy[i] = rawH(full.x[i], full.z[i]) - edgeRise(full.x[i], full.z[i]);
  for (let pass = 0; pass < 3; pass++) {
    const src = fy.slice();
    for (let i = 0; i < full.n; i++) {
      let s = 0;
      let c = 0;
      for (let k = Math.max(0, i - 24); k <= Math.min(full.n - 1, i + 24); k++, c++) s += src[k];
      fy[i] = s / c;
    }
  }
  for (let i = 0; i < full.n; i++) fy[i] = Math.max(fy[i], WATER_LEVEL + 1.8);
  const pins = []; // [first point, last point, level]
  if (depot) {
    const c = Math.cos(depot.ry);
    const s = Math.sin(depot.ry);
    let i0 = -1;
    let i1 = -1;
    for (let i = 0; i < full.n; i++) {
      const lx = c * (full.x[i] - depot.x) - s * (full.z[i] - depot.z);
      const lz = s * (full.x[i] - depot.x) + c * (full.z[i] - depot.z);
      if (Math.abs(lx) > PIN || Math.abs(lz - DEPOT_TRACK) > 1.5) continue;
      if (i0 < 0) i0 = i;
      i1 = i;
    }
    if (i0 >= 0) pins.push([i0, i1, depot.h - RAIL.DROP]);
  }
  {
    const i0 = Math.max(0, iT - HALF_TRAIN);
    const i1 = Math.min(full.n - 1, iT + HALF_TRAIN);
    let level = 0;
    for (let i = i0; i <= i1; i++) level += fy[i] / (i1 - i0 + 1);
    if (pins.length) {
      const d = Math.max(0, i0 - pins[0][1], pins[0][0] - i1);
      level = clamp(level, pins[0][2] - G * d, pins[0][2] + G * d);
    }
    pins.push([i0, i1, level]);
  }
  {
    // (the points are a metre apart: G is the most one may differ from the next)
    const fwd = fy.slice();
    const back = fy.slice();
    for (let i = 1; i < full.n; i++) fwd[i] = clamp(fwd[i], fwd[i - 1] - G, fwd[i - 1] + G);
    for (let i = full.n - 2; i >= 0; i--) back[i] = clamp(back[i], back[i + 1] - G, back[i + 1] + G);
    for (let i = 0; i < full.n; i++) {
      let v = (fwd[i] + back[i]) / 2;
      for (const [a, b, level] of pins) {
        const d = i < a ? a - i : i > b ? i - b : 0;
        v = clamp(v, level - G * d, level + G * d);
      }
      fy[i] = v;
    }
  }

  // ---------------------------------------------------------------- the tunnel mouths
  // out from the train to either rim: the mouth is where the hill has come COVER over the line, the bore runs on
  // BORE m behind it and the line ends there
  const edgeOf = (i) => Math.max(Math.abs(full.x[i]), Math.abs(full.z[i]));
  const mouthAt = (dir) => {
    let i = iT;
    while (i + dir > 0 && i + dir < full.n - 1 && edgeOf(i) < MAP_HALF - 13 && !(edgeOf(i) > MAP_HALF - 46 && rawH(full.x[i], full.z[i]) - fy[i] >= RAIL.COVER)) i += dir;
    return i;
  };
  const mouths = [mouthAt(-1), mouthAt(1)];
  const first = Math.max(0, mouths[0] - RAIL.BORE);
  const last = Math.min(full.n - 1, mouths[1] + RAIL.BORE);
  const main = { x: full.x.slice(first, last + 1), z: full.z.slice(first, last + 1), y: fy.slice(first, last + 1), n: last - first + 1 };
  iT -= first;
  mouths[0] -= first;
  mouths[1] -= first;
  main.from = mouths[0] - 2; // (drawn this far: a little way into each bore)
  main.to = mouths[1] + 2;
  const portals = mouths.map((m, k) => {
    const dir = k ? 1 : -1;
    const e = clamp(m + dir * 3, 0, main.n - 1);
    const l = Math.hypot(main.x[e] - main.x[m], main.z[e] - main.z[m]) || 1;
    return { i: m, x: main.x[m], y: main.y[m], z: main.z[m], dx: (main.x[e] - main.x[m]) / l, dz: (main.z[e] - main.z[m]) / l, nat: null };
  });
  const inBore = (i) => i < mouths[0] || i >= mouths[1];

  // ---------------------------------------------------------------- the siding at the depot
  // leaves the main line at one end of the yard, runs beside it on the far side from the station house and stops
  // at a buffer (in the depot's own frame: the main line along X at z = DEPOT_TRACK)
  const level = depot ? depot.h - RAIL.DROP : 0;
  const dwx = (lx, lz) => depot.x + Math.cos(depot.ry) * lx + Math.sin(depot.ry) * lz;
  const dwz = (lx, lz) => depot.z - Math.sin(depot.ry) * lx + Math.cos(depot.ry) * lz;
  let siding = null;
  if (depot && pins.length > 1) {
    const n = 54;
    siding = { x: new Float64Array(n), z: new Float64Array(n), y: new Float64Array(n).fill(level), n, from: 0, to: n - 1 };
    for (let i = 0; i < n; i++) {
      const lx = -32 + i;
      const lz = DEPOT_TRACK + RAIL.SIDING * smoothstep(-32, -10, lx);
      siding.x[i] = dwx(lx, lz);
      siding.z[i] = dwz(lx, lz);
    }
  }
  const tracks = siding ? [main, siding] : [main];

  // ---------------------------------------------------------------- where is the line?
  // the points of every track by 16 m cell: near(x, z) -> the nearest of them within a cell or so
  const CELL = 16;
  const cells = new Map();
  tracks.forEach((t, ti) => {
    for (let i = 0; i < t.n; i++) {
      const key = Math.floor(t.x[i] / CELL) * 4096 + Math.floor(t.z[i] / CELL);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(ti, i);
    }
  });
  const _near = { d: Infinity, y: 0, track: 0, i: 0 };
  // (only: the index of the one track to look at)
  const near = (x, z, only = -1) => {
    _near.d = Infinity;
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    for (let a = ci - 1; a <= ci + 1; a++) {
      for (let b = cj - 1; b <= cj + 1; b++) {
        const list = cells.get(a * 4096 + b);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          if (only >= 0 && list[k] !== only) continue;
          const t = tracks[list[k]];
          const i = list[k + 1];
          const d = Math.hypot(t.x[i] - x, t.z[i] - z);
          if (d >= _near.d) continue;
          _near.d = d;
          _near.y = t.y[i];
          _near.track = list[k];
          _near.i = i;
        }
      }
    }
    return _near;
  };
  // distance from (x,z) to the nearest track (Infinity beyond 16 m or so)
  const dist = (x, z) => near(x, z).d;
  // is (x,z) ground the railway keeps to itself? The bed and its verges, the loading bank, the tunnel mouths:
  // no roadside site, pole or sign goes there
  const keep = (x, z) => dist(x, z) < 10 || Math.hypot(x - bank.x, z - bank.z) < bank.half + 16 || portals.some((p) => Math.hypot(x - p.x, z - p.z) < 18);

  // ---------------------------------------------------------------- the stalled train
  // From the head: the locomotive, a tank car, two boxcars standing open at the loading dock, a flat of lumber
  // and a closed boxcar. Each stands on the chord between its ends.
  const CONSIST = ['loco', 'tank', 'open', 'open', 'flat', 'closed'];
  const cars = [];
  {
    const lens = CONSIST.map((kind) => (kind === 'loco' ? RAIL.LOCO : RAIL.CAR));
    let a = iT - (lens.reduce((s, l) => s + l, 0) + RAIL.GAP * (lens.length - 1)) / 2;
    CONSIST.forEach((kind, k) => {
      cars.push({ kind, ...frame(main, a + lens[k] / 2, lens[k] / 2) });
      a += lens[k] + RAIL.GAP;
    });
  }
  const open = cars.filter((c) => c.kind === 'open');
  // the loading bank: level ground at DROP over the bed along both open cars, on the side layout.js picked
  const bank = {
    x: (open[0].x + open[1].x) / 2,
    z: (open[0].z + open[1].z) / 2,
    y: main.y[iT] + RAIL.DROP,
    side: plan.bank,
    half: RAIL.CAR + RAIL.GAP / 2 + 3.5,
  };
  {
    const l = Math.hypot(open[1].x - open[0].x, open[1].z - open[0].z);
    bank.tx = (open[1].x - open[0].x) / l;
    bank.tz = (open[1].z - open[0].z) / l;
  }

  const decks = []; // { x, z, c, s, hx, hz, top }: what stands above the ground to be walked on
  const bed = []; // [vertex, level] of the formation, for settle()
  const crossings = []; // { x, y, z, kind, width, i }: where a road or a trail crosses the main line

  // ================================================================ world generation
  // a road meets the line at the height of its bed: the heights along a road (buildRoad) are drawn to it
  const pinRoad = (pts, hs) => {
    for (let i = 0; i < hs.length; i++) {
      const p = near(pts[i * 2], pts[i * 2 + 1]);
      if (p.d < 10) hs[i] += (p.y - hs[i]) * (1 - smoothstep(3.5, 10, p.d));
    }
  };

  // the road router's cost grid (cells of `size` m, `n` to a side): a road pays to run along the bed, so it crosses
  const cost = (aBase, size, n) => {
    const done = new Set();
    for (const t of tracks) {
      for (let i = 0; i < t.n; i++) {
        const ci = Math.floor((t.x[i] + MAP_HALF) / size);
        const cj = Math.floor((t.z[i] + MAP_HALF) / size);
        if (ci < 0 || cj < 0 || ci >= n || cj >= n || done.has(cj * n + ci)) continue;
        done.add(cj * n + ci);
        aBase[cj * n + ci] += 7;
      }
    }
    // ...and under the stalled train and its loading bank a road would run into the cars: there it is as dear as
    // water, so the road crosses the line somewhere else (two cells either side take in the bank)
    const under = new Set();
    for (let i = Math.max(0, iT - HALF_TRAIN); i <= Math.min(main.n - 1, iT + HALF_TRAIN); i++) {
      const ci = Math.floor((main.x[i] + MAP_HALF) / size);
      const cj = Math.floor((main.z[i] + MAP_HALF) / size);
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const k = (cj + dj) * n + ci + di;
          if (ci + di < 0 || cj + dj < 0 || ci + di >= n || cj + dj >= n || under.has(k)) continue;
          under.add(k);
          aBase[k] += 500;
        }
    }
  };

  // Cuts and fills the heightfield to the formation and enters the bed in the road grids.
  let terrain = null; // (the world's heightAt, from here on)
  const grade = ({ heights, roadDist, roadKind, roadDir, heightAt }) => {
    terrain = heightAt;
    const N = GRID_N;
    const vx = (i) => -MAP_HALF + i * GRID_STEP;
    // the hill as it stands over each tunnel, before any of it is cut away (the rock of the portal is built up to it)
    for (const p of portals) {
      p.nat = [];
      for (let s = 0; s <= 10; s += 2.5) {
        let h = -Infinity;
        for (let lat = -8; lat <= 8; lat += 4) h = Math.max(h, heightAt(p.x + p.dx * s - p.dz * lat, p.z + p.dz * s + p.dx * lat));
        p.nat.push(h);
      }
    }
    // ---- the loading bank: the ground brought to its level, easing back into the hillside around it
    {
      const R = bank.half + 40;
      for (let j = Math.max(0, Math.floor((bank.z - R + MAP_HALF) / GRID_STEP)); j <= Math.min(N - 1, Math.ceil((bank.z + R + MAP_HALF) / GRID_STEP)); j++) {
        for (let i = Math.max(0, Math.floor((bank.x - R + MAP_HALF) / GRID_STEP)); i <= Math.min(N - 1, Math.ceil((bank.x + R + MAP_HALF) / GRID_STEP)); i++) {
          const ex = vx(i) - bank.x;
          const ez = vx(j) - bank.z;
          const along = ex * bank.tx + ez * bank.tz;
          const lat = (ex * bank.tz - ez * bank.tx) * bank.side;
          const out = Math.hypot(Math.max(0, Math.abs(along) - bank.half), Math.max(0, 1 - lat, lat - 13));
          const k = j * N + i;
          heights[k] = clamp(heights[k], bank.y - 0.33 * out, bank.y + 0.6 * out);
        }
      }
    }
    // ---- the formation, a track at a time (the siding's lies in the main line's where they part)
    tracks.forEach((t, ti) => form(t, ti, heights, false, roadDist, roadKind, roadDir));
  };

  // The formation of track t (index ti): every vertex within reach of it knows its nearest point of it, the bed is
  // levelled and the ground beyond is clamped to the slopes of a cutting or an embankment, and the bed is entered in
  // the road grids. raise: only ever bring the ground up to the track (where the line rides over a hump, see settle)
  const REACH = 30;
  let dNear, lvl, tan, what; // (scratch, a value per vertex: made the first time)
  const form = (t, ti, heights, raise, roadDist, roadKind, roadDir) => {
    const N = GRID_N;
    const vx = (i) => -MAP_HALF + i * GRID_STEP;
    if (!dNear) {
      dNear = new Float32Array(N * N);
      lvl = new Float32Array(N * N);
      tan = new Float32Array(N * N * 2);
      what = new Uint8Array(N * N); // 1 open line, 2 a bore, 3 beyond the end of the track (nothing is done there)
    }
    {
      dNear.fill(1e9);
      what.fill(0);
      for (let s = 0; s < t.n - 1; s++) {
        const ax = t.x[s];
        const az = t.z[s];
        const ex = t.x[s + 1] - ax;
        const ez = t.z[s + 1] - az;
        const el2 = ex * ex + ez * ez || 1;
        const el = Math.sqrt(el2);
        const i0 = Math.max(0, Math.floor((Math.min(ax, ax + ex) - REACH + MAP_HALF) / GRID_STEP));
        const i1 = Math.min(N - 1, Math.ceil((Math.max(ax, ax + ex) + REACH + MAP_HALF) / GRID_STEP));
        const j0 = Math.max(0, Math.floor((Math.min(az, az + ez) - REACH + MAP_HALF) / GRID_STEP));
        const j1 = Math.min(N - 1, Math.ceil((Math.max(az, az + ez) + REACH + MAP_HALF) / GRID_STEP));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const raw = ((vx(i) - ax) * ex + (vx(j) - az) * ez) / el2;
            const u = raw < 0 ? 0 : raw > 1 ? 1 : raw;
            const d = Math.hypot(vx(i) - ax - ex * u, vx(j) - az - ez * u);
            const k = j * N + i;
            if (d >= dNear[k]) continue;
            dNear[k] = d;
            lvl[k] = t.y[s] + (t.y[s + 1] - t.y[s]) * u;
            tan[k * 2] = ex / el;
            tan[k * 2 + 1] = ez / el;
            what[k] = (s === 0 && raw < 0) || (s === t.n - 2 && raw > 1) ? 3 : ti === 0 && inBore(raw > 0.5 ? s + 1 : s) ? 2 : 1;
          }
        }
      }
      for (let k = 0; k < N * N; k++) {
        if (what[k] !== 1 && what[k] !== 2) continue;
        const d = dNear[k];
        const flat = what[k] === 2 ? BORE_BED : RAIL.BED;
        const give = Math.max(0, d - flat) * (what[k] === 2 ? BORE_SLOPE : RAIL.SLOPE);
        if (raise) heights[k] = Math.max(heights[k], lvl[k] - give);
        else if (d <= flat) {
          heights[k] = lvl[k];
          bed.push(k, lvl[k]);
        } else heights[k] = clamp(heights[k], lvl[k] - give, lvl[k] + give);
        // the bed in the road grids (their distances are measured to an edge at 2.6): the ground there is drawn and
        // walked on as a dirt road, trees keep 5.5 m off it and nothing is built on it
        if (!raise && d - 0.6 < roadDist[k] && d < 12) {
          roadDist[k] = d - 0.6;
          roadKind[k] = ROAD.RAIL;
          roadDir[k * 2] = tan[k * 2];
          roadDir[k * 2 + 1] = tan[k * 2 + 1];
        }
      }
    }
  };

  // After the mine is cut: its portals level an apron and it heaps ground over a roof that has too little, which
  // may have moved the edge of the formation. The bed goes back to its level - unless a roof of the mine is under
  // it there and needs that ground over it. Then the line rides over the hump, up to it and down again at its
  // ruling grade. -> how many vertices of the bed were kept up
  const settle = ({ heights, heightAt, mine }) => {
    let humps = 0;
    for (let b = 0; b < bed.length; b += 2) {
      const k = bed[b];
      const level = bed[b + 1];
      if (heights[k] === level) continue;
      const x = -MAP_HALF + (k % GRID_N) * GRID_STEP;
      const z = -MAP_HALF + Math.floor(k / GRID_N) * GRID_STEP;
      const roof = mine && mine.sdf(x, z) < 2.5 && !mine.outside(x, z, level + 0.1) ? mine.floorOf(x, z) + MINE_H + 0.9 : -Infinity;
      if (heights[k] > level && level < roof) humps++;
      else heights[k] = level;
    }
    if (!humps) return 0;
    tracks.forEach((t, ti) => {
      const y = t.y.slice();
      for (let i = 0; i < t.n; i++) y[i] = Math.max(y[i], heightAt(t.x[i], t.z[i]));
      for (let i = 1; i < t.n; i++) y[i] = Math.max(y[i], y[i - 1] - RAIL.GRADE);
      for (let i = t.n - 2; i >= 0; i--) y[i] = Math.max(y[i], y[i + 1] - RAIL.GRADE);
      if (y.every((v, i) => v === t.y[i])) return;
      t.y.set(y);
      form(t, ti, heights, true);
    });
    return humps;
  };

  // ================================================================ what stands on it
  const rng = mulberry32(seed ^ 0x7a12); // its own stream: nothing else in the valley moves for it
  const sd = () => rng.int(0, 9999);
  const P = (b, type, lx, lz, ry = 0, o = {}) => b.prop(type, lx, lz, ry, { seed: sd(), ...o });
  const C = (b, ctype, lx, lz, o = {}) => b.cont(ctype, lx, lz, { seed: sd(), ...(ctype === CONT.FREIGHT ? { h: 0.6 } : null), ...o });
  let grid = null; // (the world's collider grid, from build())
  // a collider with nothing drawn for it (the round side of a tank, the frame of a locomotive)
  const solid = (b, lx, lz, y0, y1, sx, sz) => grid.add(makeBox(b.wx(lx, lz), b.wz(lx, lz), b.y0 + y0, b.y0 + y1, sx, sz, b.ry));
  // a slab to walk on at ly (its top) over the builder's base
  const deck = (b, lx, lz, sx, sz, top, mat, thick = 0.2) => {
    b.box(lx, top - thick, lz, sx, thick, sz, mat);
    decks.push({ x: b.wx(lx, lz), z: b.wz(lx, lz), c: b.c, s: b.s, hx: sx / 2, hz: sz / 2, top: b.y0 + top });
  };

  // ---- rolling stock, each in its own frame: +Z along the track, the top of the bed at 0
  const F = RAIL.FLOOR;
  const L = RAIL.CAR;
  const W = 2.9;
  const truck = (b, zt) => {
    b.box(0, 0.36, zt, 2.1, 0.3, 2.3, 'rust', NC);
    for (const wz of [-0.85, 0.85]) {
      b.box(0, 0.56, zt + wz, 1.6, 0.14, 0.14, 'metal', NC);
      for (const wx of [-0.72, 0.72]) b.cyl(wx, 0.58, zt + wz, 0.38, 0.1, 'metal', { rz: PI / 2, sides: 12, collide: false });
    }
  };
  const underframe = (b, len) => {
    b.box(0, 0.76, 0, 2.4, 0.18, len - 0.2, 'metal', NC);
    truck(b, -(len / 2 - 2.2));
    truck(b, len / 2 - 2.2);
    for (const s of [-1, 1]) b.box(0, 0.62, s * (len / 2 + 0.2), 0.22, 0.22, 0.8, 'rust', NC);
  };
  // (no collider, like a gable roof: what is built on the floor of an open car is not under anything solid)
  const carRoof = (b, mat = 'tin_rust') => {
    b.box(0, F + 2.5, 0, W + 0.2, 0.1, L + 0.2, mat, NC);
    b.box(0, F + 2.6, 0, 1.5, 0.07, L + 0.2, mat, NC);
    b.roofSpan(0, 0, W / 2 + 0.1, L / 2 + 0.1, F + 2.5, 0.17);
  };
  // a boxcar standing open: a floor to walk on, one doorway (on side `ds` of it: 1 = local +X; as wide as door
  // boards come) that takes door boards, freight left in it
  const boxcarOpen = (b, ds, k, K) => {
    underframe(b, L);
    // (the floor runs out under the walls to their outer faces, where the dock takes over: no cell of the nav
    // grid finds its middle in a crack between the two and takes the doorway for a drop)
    deck(b, 0, 0, W + 0.12, L, F, 'planks', 0.17);
    b.wall(ds * (W / 2), -L / 2, ds * (W / 2), L / 2, 2.5, 0.12, 'barn', [K.door(L / 2, 1.75)], F);
    b.wall(-ds * (W / 2), L / 2, -ds * (W / 2), -L / 2, 2.5, 0.12, 'barn', [], F);
    b.wall(-W / 2, -L / 2, W / 2, -L / 2, 2.5, 0.12, 'barn', [], F);
    b.wall(W / 2, L / 2, -W / 2, L / 2, 2.5, 0.12, 'barn', [], F);
    carRoof(b);
    // the door, run back along the side on its rail, and the frame it closed against (the doorway reads as one
    // from outside: the inside of a boxcar is as dark as its side in the shade)
    b.box(ds * (W / 2 + 0.12), F + 0.05, 1.8, 0.06, 2.3, 1.75, 'tin_rust', NC);
    b.box(ds * (W / 2 + 0.12), F + 2.36, 0.9, 0.05, 0.07, 3.6, 'rust', NC);
    for (const s of [-1, 1]) b.box(ds * (W / 2 + 0.07), F, s * 0.95, 0.07, 2.28, 0.12, 'trim', NC);
    b.box(ds * (W / 2 + 0.07), F + 2.2, 0, 0.07, 0.12, 2.02, 'trim', NC);
    b.clear(0, 0, 7.5);
    // what was in it
    const far = -ds * 0.82;
    C(b, CONT.FREIGHT, far, -4.9, { prop: 'crate', ly: F, ry: 0.1 });
    P(b, 'crate_small', far + ds * 0.15, -3.75, 0.5, { ly: F });
    P(b, 'pallet', far * 0.8, 4.9, 0.2, { ly: F }); // (turned, it is wider than a crate: in from the wall a little more)
    if (k % 2) {
      C(b, CONT.FREIGHT, far * 0.8, 4.9, { prop: 'crate', ly: F + 0.15, ry: -0.2 });
      C(b, CONT.TOOLBOX, ds * 0.7, 5.2, { prop: 'toolbox', ly: F, ry: 0.9, nocollide: true });
      P(b, 'bones', far + ds * 0.3, 2.3, 1.2, { ly: F, nocollide: true });
    } else {
      C(b, CONT.CRATE, far, 4.9, { prop: 'crate', ly: F + 0.15, ry: 0.3 });
      C(b, CONT.DUFFEL, ds * 0.6, -5.1, { prop: 'duffel_bag', ly: F, ry: 1.9, nocollide: true });
      P(b, 'corpse', far + ds * 0.5, 2.2, 0.3, { ly: F, nocollide: true });
    }
    b.loot(far + ds * 0.9, -2.4, F + 0.02);
  };
  const boxcarClosed = (b, mat = 'barn') => {
    underframe(b, L);
    b.box(0, 0.93, 0, W, 2.67, L, mat);
    carRoof(b);
    for (const s of [-1, 1]) {
      b.box(s * (W / 2 + 0.04), F + 0.05, 0, 0.06, 2.3, 1.9, 'tin_rust', NC);
      b.box(s * (W / 2 + 0.06), F + 1.1, 0.75, 0.05, 0.5, 0.08, 'rust', NC);
    }
    b.clear(0, 0, 7.5);
  };
  // a flat of sawn lumber: the stacks are what there is to walk into (its deck is no place to stand)
  const flatcar = (b) => {
    underframe(b, L);
    b.box(0, 0.93, 0, 2.8, 0.17, L, 'planks', NC);
    solid(b, 0, 0, 0.45, F, 2.8, L);
    for (const zs of [-3.9, 0, 3.9]) {
      b.box(0, F, zs, 2.3, zs ? 1.3 : 1.0, 3.6, 'planks');
      b.box(0, F + (zs ? 1.3 : 1.0), zs, 2.34, 0.04, 0.12, 'rust', NC);
    }
    for (const s of [-1, 1]) for (const zs of [-5.6, -2, 2, 5.6]) b.box(s * 1.3, F, zs, 0.1, 1.5, 0.1, 'trim', NC);
    b.clear(0, 0, 7.5);
  };
  const tankcar = (b) => {
    underframe(b, L);
    b.cyl(0, 2.2 - 5.3, 0, 1.25, 10.6, 'tin_rust', { ry: PI / 2, rz: PI / 2, sides: 14, collide: false });
    solid(b, 0, 0, 0.93, 3.45, 2.5, 10.6);
    b.cyl(0, 3.35, 0, 0.42, 0.45, 'rust', { sides: 10, collide: false });
    for (const zs of [-3.6, 3.6]) b.box(0, 0.93, zs, 2.2, 0.5, 0.5, 'rust', NC);
    b.box(0, 0.93, 0, 2.8, 0.1, L, 'metal', NC);
    for (const s of [-1, 1]) b.box(s * 1.36, 1.03, 0, 0.05, 0.05, L - 0.4, 'rust', NC);
    b.clear(0, 0, 7.5);
  };
  // a road switcher, long hood forward (-Z): the frame and what stands on it are solid, the walkway round the
  // hood is something to climb onto
  const locomotive = (b) => {
    const len = RAIL.LOCO;
    truck(b, -4.7);
    truck(b, 4.7);
    b.box(0, 0.95, 0, W, 0.3, len, 'metal', NC);
    solid(b, 0, 0, 0.5, 1.25, W, len);
    b.box(0, 1.25, -2.5, 1.9, 2.25, 8.6, 'olive');
    b.box(0, 1.25, 3.5, W, 2.7, 3.0, 'olive');
    b.box(0, 3.95, 3.5, W + 0.24, 0.12, 3.3, 'tin_rust', NC);
    b.box(0, 1.25, 6.1, 1.9, 1.5, 2.0, 'olive');
    for (const s of [-1, 1]) {
      b.box(s * (W / 2 + 0.01), 2.85, 3.5, 1.7, 0.75, 0.1, 'glass', { ry: PI / 2, collide: false });
      b.box(s * 0.97, 1.9, -5.2, 0.05, 1.3, 2.4, 'rust', NC);
      b.box(s * 1.38, 2.2, -2.5, 0.04, 0.04, 8.6, 'rust', NC);
      for (const zs of [-6.6, -4.4, -2.2, 0, 1.7]) b.box(s * 1.38, 1.25, zs, 0.04, 0.95, 0.04, 'rust', NC);
      b.box(s * 0.62, 3.1, 1.98, 0.55, 0.5, 0.1, 'glass', NC);
      b.box(s * 0.62, 3.1, 5.02, 0.55, 0.5, 0.1, 'glass', NC);
      b.box(0, 0.3, s * (len / 2 - 0.1), 2.6, 0.7, 0.25, 'metal', NC);
      b.box(0, 0.62, s * (len / 2 + 0.25), 0.22, 0.22, 0.7, 'rust', NC);
    }
    for (const zs of [-4.6, -3.4]) b.cyl(0.4, 3.5, zs, 0.13, 0.4, 'rust', { sides: 8, collide: false });
    b.cyl(0, 0.75 - 1.7, 0, 0.5, 3.4, 'rust', { ry: PI / 2, rz: PI / 2, sides: 10, collide: false });
    b.box(0, 3.25, -6.83, 0.5, 0.3, 0.08, 'glass', NC);
    b.clear(0, 0, 9);
  };

  // WHITLOCK DEPOT: the station house (waiting room, ticket office) and its platform on the line, a freight shed,
  // the water tower and a signal; the siding with a couple of cars on it beyond the main line.
  // b: a builder in the depot's frame, its base the yard. K: { door, win, gap } of world.js
  const buildDepot = (b, zn, K) => {
    const TZ = DEPOT_TRACK;
    const T = -RAIL.DROP; // the bed, from the yard
    const PY = F - RAIL.DROP; // the platform, from the yard
    // the platform: from the edge of the yard out over the cut to the side of a standing car
    // (the stone of its face has no collider: the drop off the edge is the nav grid's to know, as a deck's)
    deck(b, 0, TZ - 3.875, 32, 4.65, PY, 'concrete');
    b.box(0, T, TZ - 1.65, 32, RAIL.DROP, 0.2, 'stone', NC);
    for (const px of [-15.9, 15.9]) b.box(px, T, TZ - 3.875, 0.2, RAIL.DROP, 4.65, 'stone', NC);
    // its canopy, off the back of the station house
    for (const px of [-6.6, -2.2, 2.2, 6.6]) b.cyl(px, PY, TZ - 4.4, 0.09, 2.9, 'trim', { sides: 6 });
    b.box(0, 3.1, 4.9, 15, 0.12, 5.6, 'tin', NC);
    b.roofSpan(0, 4.9, 7.5, 2.8, 3.1, 0.12);
    // the station house
    b.room(0, -1.2, 14, 7, 3.2, 'clapboard', { n: [K.door(4, 1.4), K.win(1.5), K.win(7), K.win(11.5)], s: [K.door(10, 1.3), K.win(2.5), K.win(6.2)], e: [K.win(3.5)], w: [K.win(3.5)] }, { roof: 'gableZ', roofH: 2.4, roofMat: 'shingles' });
    b.wall(2, -4.7, 2, 2.3, 3.2, 0.18, 'planks', [K.win(2.2, 1.4, 1.0, 1.9), K.door(5.3, 1.1)]);
    // waiting room
    P(b, 'pew', -5.4, 1.85, 0);
    P(b, 'pew', -0.2, 1.85, 0);
    P(b, 'pew', -6.5, -1.4, -PI / 2);
    b.box(-6.2, 0.12, -3.9, 0.7, 1.0, 0.7, 'metal');
    b.cyl(-6.2, 1.12, -3.9, 0.09, 2.1, 'rust', { sides: 6, collide: false });
    C(b, CONT.DUFFEL, -3.2, 0.5, { prop: 'duffel_bag', ry: 0.6, nocollide: true });
    P(b, 'corpse', -1.2, -2.6, 2.3, { nocollide: true });
    b.loot(-4, -2.2);
    // ticket office
    b.box(2.55, 0.12, -2.5, 0.7, 0.93, 1.8, 'planks');
    b.loot(2.55, -2.5, 1.07);
    C(b, CONT.LOCKER, 6.55, 1.2, { prop: 'locker', ry: -PI / 2 });
    C(b, CONT.CABINET, 5.6, -4.25, { prop: 'cabinet', ry: PI });
    P(b, 'chair', 4.6, -1.4, -PI / 2);
    b.partSpot(6.2, -2.4);
    // on the platform
    P(b, 'pew', -11.5, TZ - 5.5, PI, { ly: PY });
    P(b, 'lantern_post', -12.8, TZ - 4.5, 0, { ly: PY });
    P(b, 'lantern_post', 12.8, TZ - 4.5, 0, { ly: PY });
    C(b, CONT.DUFFEL, 10.4, TZ - 4.6, { prop: 'duffel_bag', ly: PY, ry: 2.4, nocollide: true });
    P(b, 'crate_small', 11.6, TZ - 5.5, 0.3, { ly: PY });
    for (const px of [-9.6, -7]) b.cyl(px, PY, TZ - 5.9, 0.07, 2.5, 'trim', { sides: 6 });
    b.box(-8.3, PY + 1.9, TZ - 5.9, 3.2, 0.55, 0.08, 'planks', NC);
    b.loot(4.5, TZ - 3.4, PY + 0.02);
    // freight shed
    b.room(20, -1, 9, 8, 3.6, 'barn', { n: [K.gap(4.5, 3.2, 3)], s: [K.gap(4.5, 3.2, 3)], w: [K.door(4, 1.2)] }, { roof: 'gable', roofH: 2.2, roofMat: 'tin', floorMat: 'planks' });
    C(b, CONT.FREIGHT, 23.5, -3.8, { prop: 'crate', ry: 0.1 });
    P(b, 'crate', 23.5, -3.8, 0.4, { ly: 1.0 });
    C(b, CONT.FREIGHT, 23.5, 1.7, { prop: 'crate', ry: -0.2 });
    P(b, 'pallet', 21.8, 1.8, 0.1);
    P(b, 'crate_small', 21.8, 1.8, 0.6, { ly: 0.15 });
    C(b, CONT.SHELF, 16.2, -3.9, { prop: 'shelf', ry: PI / 2 });
    C(b, CONT.TOOLBOX, 16.6, 2.2, { prop: 'toolbox', ry: 0.4, nocollide: true });
    P(b, 'barrel', 17.3, -2.1);
    b.partSpot(22.4, 0.2);
    b.loot(19, 1.6);
    // water tower, signal, what is left in the yard
    P(b, 'water_tower', -21, -1.5, 0.15);
    b.partSpot(-21, -1.5);
    b.cyl(-25, T, TZ - 3, 0.1, 6.6, 'rust', { sides: 8 });
    b.box(-25.85, T + 5.3, TZ - 3, 1.8, 0.28, 0.07, 'barn', { rz: -0.6, collide: false });
    b.box(-25, T + 6.2, TZ - 3, 0.3, 0.4, 0.3, 'emissive_red', NC);
    b.wreck('pickup_truck', -9.5, -13, 1.9, { seed: sd() });
    C(b, CONT.DUMPSTER, 11, -7.4, { prop: 'dumpster', ry: PI });
    P(b, 'cart', 12.8, -1.5, 0.3);
    P(b, 'barrel', -9.6, -5.6);
    P(b, 'barrel', -10.5, -5.1);
    P(b, 'streetlight', -5.5, -19, PI);
    P(b, 'streetlight', 6, -9.5, PI);
    P(b, 'corpse', 3.5, -8.6, 0.9, { nocollide: true });
    P(b, 'bones', -15, -8, 0, { nocollide: true });
    b.loot(-13, -3.4);
    // beyond the tracks: a stack of sleepers, coal for a boiler nobody fires
    C(b, CONT.LOGPILE, -6, 24.5, { prop: 'log_pile', ry: 0.05 });
    P(b, 'gravel_pile', 8.5, 25, 0.4);
    P(b, 'barrel', 2.4, 23.6);
    b.loot(0.5, 24.6);
    // the siding: a flat of lumber and a boxcar, a buffer where it ends
    flatcar(b.sub(-1.5, TZ + RAIL.SIDING, PI / 2, T));
    boxcarClosed(b.sub(11.7, TZ + RAIL.SIDING, PI / 2, T), 'tin_rust');
    b.box(21.6, T, TZ + RAIL.SIDING, 0.5, 1.1, 2.2, 'trim');
    for (const s of [-1, 1]) b.box(21.1, T, TZ + RAIL.SIDING + s * 0.72, 1.4, 0.7, 0.16, 'rust', NC);
    for (const [tx, tz, v, sc] of [[-27, -9, 1, 1.1], [-24, -17, 0, 1], [26, -11, 2, 1.1], [22, -18, 0, 0.95], [-17, -22, 1, 1], [14, -24, 2, 1.05]]) b.tree(tx, tz, v, sc);
  };

  // the mouth of a tunnel (b: at the middle of the mouth on the bed, +Z on into the hill): stone either side of
  // the bore and over it, built up to the hill it is cut into, and the roof down a few metres in
  const buildPortal = (b, p) => {
    const R = RAIL.BORE_R;
    const H = RAIL.BORE_H;
    const top = H + 1;
    for (const s of [-1, 1]) {
      b.box(s * (R + 3.1), -1.5, 4.25, 6.2, top + 1.5, 9, 'stone');
      b.box(s * (R + 0.45), 0, -0.4, 0.9, H + 0.2, 0.5, 'concrete');
      b.box(s * 10.4, -1, -0.1, 4.6, 5.2, 1, 'stone', { ry: -s * 0.3 });
      b.box(s * (R - 0.03), 0, 5, 0.06, H, 7.4, 'dark', NC);
    }
    b.box(0, H, 4.25, R * 2, 1, 9, 'stone');
    b.box(0, H, -0.4, R * 2 + 1.8, 0.9, 0.5, 'concrete', NC);
    b.box(0, H + 0.15, -0.6, 0.7, 1.0, 0.3, 'stone', NC);
    b.box(0, top, -0.2, 17.4, 0.45, 0.8, 'concrete', NC);
    b.box(0, H - 0.06, 5, R * 2, 0.06, 7.4, 'dark', NC);
    b.box(0, 0.26, 5.2, R * 2, 0.05, 6.8, 'dark', NC);
    // the rock over it, in steps up the hill
    for (let j = 0; j < 4; j++) {
      const h = Math.max(p.nat[j], p.nat[j + 1]) + 0.5 - b.y0;
      if (h > top + 0.4) b.box(rng.range(-0.5, 0.5), top, 1.2 + j * 2.6, 17 + j * 0.8, h - top, 2.9, 'stone', { ry: rng.range(-0.05, 0.05) });
    }
    // the cave-in
    b.box(-0.8, 0, 4.3, 2.6, 1.3, 1.6, 'stone', { ry: 0.5 });
    b.box(1, 0, 5, 2.4, 2.3, 1.8, 'stone', { ry: -0.3 });
    b.box(-0.5, 1.2, 5.9, 3.6, 2.6, 1.6, 'stone', { ry: 0.15 });
    b.box(0, 0, 7.1, R * 2, H, 1.6, 'stone');
    b.box(0.3, 2.6, 3.8, 4.4, 0.26, 0.26, 'trim', { rz: 0.35, collide: false });
    b.box(-1.3, 0.2, 3.3, 0.26, 3.4, 0.26, 'trim', { rz: -0.3, collide: false });
    b.box(1.5, 0.3, 2.9, 0.22, 2.4, 0.22, 'trim', { rz: 1.2, ry: 0.5, collide: false });
    b.roofSpan(0, 4.25, R + 6.2, 4.5, top, 0.3);
    b.clear(0, -3, 9);
    b.clear(0, 5, 10);
  };

  // Builds the railway into the world. place(id, build): world.js builds a place if the map has it; builder(x, z,
  // ry, y) makes one of its builders anywhere; roads: the world's roads; staticGrid: its colliders. K: the
  // openings of a wall, { door, win, gap }
  const build = ({ place, builder, roads, staticGrid, K }) => {
    grid = staticGrid;
    place(ZONE.STATION, (b, zn) => buildDepot(b, zn, K));
    const at = (f, zone = ZONE.STATION) => {
      const b = builder(f.x, f.z, f.ry, f.y);
      b.zone = zone;
      return b;
    };
    // ---- the train
    let k = 0;
    for (const car of cars) {
      const b = at(car);
      if (car.kind === 'loco') locomotive(b);
      else if (car.kind === 'tank') tankcar(b);
      else if (car.kind === 'flat') flatcar(b);
      else if (car.kind === 'closed') boxcarClosed(b);
      else boxcarOpen(b, bank.side, k++, K);
    }
    // the loading dock along both open cars, on the bank, level with their floors (the line is straight there). What
    // is drawn under it has no collider: the drop off its ends is the nav grid's to know, as a deck's
    {
      const b = at({ x: bank.x, z: bank.z, y: bank.y - RAIL.DROP, ry: Math.atan2(bank.tx, bank.tz) });
      const s = bank.side;
      const len = 2 * L + RAIL.GAP - 2.6;
      deck(b, s * (W / 2 + 0.03 + 2.35), 0, 4.7, len, F - 0.003, 'dockwood');
      for (let zs = -len / 2 + 0.4; zs < len / 2; zs += 2.8) b.cyl(s * 1.85, 0, zs, 0.12, F - 0.2, 'dockwood', { sides: 6, collide: false });
      for (const e of [-1, 1]) b.box(s * 3.3, 0, e * (len / 2 - 0.08), 3.4, F - 0.2, 0.1, 'dockwood', NC);
      b.box(s * 1.62, 0.25, 0, 0.1, 0.6, len, 'dockwood', NC);
      b.clear(s * 5, 0, 12);
    }
    // on the bank: what was being loaded when it all stopped
    {
      const b = at({ x: bank.x, z: bank.z, y: bank.y, ry: Math.atan2(bank.tx, bank.tz) });
      b.ground = true;
      const s = bank.side;
      P(b, 'pallet', s * 8.4, -6.5, 0.3);
      P(b, 'crate', s * 9.8, -7.6, 0.5);
      C(b, CONT.FREIGHT, s * 9.2, 3.2, { prop: 'crate', ry: 0.2 });
      P(b, 'crate_small', s * 9.3, 4.4, 1.1);
      P(b, 'barrel', s * 8, 9.5);
      P(b, 'barrel', s * 8.8, 10.1);
      P(b, 'cart', s * 10.5, -1.5, 0.6);
      P(b, 'lantern_post', s * 6.9, 0, 0);
      P(b, 'corpse', s * 8.2, 6.6, 2.1, { nocollide: true });
      b.loot(s * 7.6, -2.8);
      b.clear(s * 8, 0, 14);
    }
    // ---- the tunnel mouths
    for (const p of portals) buildPortal(at({ x: p.x, z: p.z, y: p.y, ry: Math.atan2(p.dx, p.dz) }, ZONE.FOREST), p);
    // ---- plank crossings: wherever a road or a trail crosses the main line (a road's centre line changes sides)
    const m = main;
    for (const road of roads) {
      const pts = road.pts;
      let prev = 0;
      for (let i = 0; i < pts.length / 2; i++) {
        const p = near(pts[i * 2], pts[i * 2 + 1], 0);
        let side = 0;
        if (p.d < 8 && p.i > mouths[0] && p.i < mouths[1]) {
          const a = Math.max(0, p.i - 1);
          const c = Math.min(m.n - 1, p.i + 1);
          side = Math.sign((m.x[c] - m.x[a]) * (pts[i * 2 + 1] - m.z[p.i]) - (m.z[c] - m.z[a]) * (pts[i * 2] - m.x[p.i]));
          if (prev && side && side !== prev && !crossings.some((o) => Math.abs(o.i - p.i) < 7)) crossings.push({ i: p.i, x: m.x[p.i], y: m.y[p.i], z: m.z[p.i], kind: road.kind, width: road.width });
        }
        prev = side;
      }
    }
    for (const o of crossings) {
      const b = at(frame(m, o.i, 2), ZONE.FOREST);
      const len = Math.min(9, o.width * 2 + 2.4);
      const g = RAIL.GAUGE / 2;
      b.box(0, 0.19, 0, g * 2 - 0.24, 0.07, len, 'planks', NC);
      for (const s of [-1, 1]) b.box(s * (g + 0.6), 0.19, 0, 0.96, 0.07, len, 'planks', NC);
      if (o.kind !== ROAD.ASPHALT) continue;
      // Route 9: a crossbuck either side of the line
      for (const s of [-1, 1]) P(b, 'road_sign', s * 4.6, s * (len / 2 + 1.2), s > 0 ? PI / 2 : -PI / 2, { ground: true });
    }
  };

  // ================================================================ queries
  // feet at height y over (x,z) that are on a deck -> its top (NaN: they are on the ground). The same rule a
  // collider's top is stood on by (groundAt), for what asks the world for the floor and nothing else. Where a deck
  // lies within a step of the ground (the platform over the yard, the dock over the bank) the ground is the floor,
  // as it is under the floor of a house.
  const reach = [];
  if (depot) reach.push([depot.x, depot.z, depot.flat + 6]);
  reach.push([bank.x, bank.z, RAIL.CAR + 12]);
  const floorFor = (x, z, y) => {
    let here = false;
    for (const [rx, rz, r] of reach) here = here || ((x - rx) * (x - rx) + (z - rz) * (z - rz) < r * r);
    if (!here) return NaN;
    let top = NaN;
    for (const d of decks) {
      if (d.top > y + STEP_HEIGHT + 0.02 || d.top <= top) continue;
      const dx = x - d.x;
      const dz = z - d.z;
      if (Math.abs(d.c * dx - d.s * dz) <= d.hx && Math.abs(d.s * dx + d.c * dz) <= d.hz) top = d.top;
    }
    return top - terrain(x, z) > STEP_HEIGHT ? top : NaN;
  };

  return {
    main, // { x, y, z, n, from, to }: the centre line a metre apart, y the top of the bed; drawn from..to
    siding, // the same for the siding at the depot (null without a depot)
    tracks,
    portals, // [{ i, x, y, z, dx, dz }]: the middle of each mouth on the bed, the unit vector on into the hill
    depot: depot || null,
    train: { i: iT, cars }, // cars: [{ kind, x, y, z, ry, tx, tz }], the head of the train first
    bank, // the loading bank beside the two open cars: { x, y, z, tx, tz, side, half }
    // somewhere to stand and look at it ([x, z]): in front of the station house, on the bank beside the train
    spots: { depot: depot ? [dwx(-3, -10), dwz(-3, -10)] : null, train: [bank.x + bank.tz * bank.side * 9.5, bank.z - bank.tx * bank.side * 9.5] },
    crossings,
    decks,
    near,
    dist,
    keep,
    pinRoad,
    cost,
    grade,
    settle,
    build,
    floorFor,
  };
}

// a car (or anything) `half` m either way from point a of a track, standing on the chord between its ends:
// the middle of it, and the yaw that puts a builder's +Z along the track
function frame(t, a, half) {
  const at = (v) => {
    const f = clamp(v, 0, t.n - 1.001);
    const i = Math.floor(f);
    return [t.x[i] + (t.x[i + 1] - t.x[i]) * (f - i), t.z[i] + (t.z[i + 1] - t.z[i]) * (f - i), t.y[i] + (t.y[i + 1] - t.y[i]) * (f - i)];
  };
  const p0 = at(a - half);
  const p1 = at(a + half);
  const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  const tx = (p1[0] - p0[0]) / l;
  const tz = (p1[1] - p0[1]) / l;
  return { x: (p0[0] + p1[0]) / 2, z: (p0[1] + p1[1]) / 2, y: at(a)[2], ry: Math.atan2(tx, tz), tx, tz };
}

// a polyline as points a metre apart (the last gap as near that as the length allows): { x, z, n }
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
  return { x, z, n };
}
