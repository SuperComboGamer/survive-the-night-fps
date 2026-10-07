// Can the mainland be driven, and how long do its trips take? For a seed: the ground a car, a moped and a bicycle
// can each stand on (clear of everything solid by its own width, dry, not a doorway), the way from the bridgehead to
// every place by that ground (A* on a half-metre grid), and the time the trip takes - on foot (sprinting as stamina
// allows, by the walker's own simulation) and at the wheel (the vehicle's own physics, steered along the way found).
//   node scripts/vehicle-routes.js [seed] [--all] [--json]
// Exports routesFor(world) for scripts/test-vehicles.js.
import { worldFor } from '../shared/worlds.js';
import { ZONE_NAMES } from '../shared/defs.js';
import { BTN, CMD_DT, WATER_LEVEL } from '../shared/constants.js';
import { COL, footprintContains, groundAt } from '../shared/collision.js';
import { VEH, VEHICLES, VEH_NAMES, stepVehicle, vehicleGrid, questCar, surfaceKind } from '../shared/vehicles.js';

const SURF_TOP = [1, 0.86, 0.76, 0.66, 0.42]; // (shared/vehicles.js: the share of its top speed each ground leaves)
import { createPlayerState, simulatePlayer } from '../shared/playersim.js';

const CELL = 0.5;

// The grid of a world: for every half-metre cell, how far (cells, capped) it is from anything a vehicle cannot pass.
export function clearance(world) {
  const n = Math.ceil((world.half * 2) / CELL);
  const half = world.half;
  const blocked = new Uint8Array(n * n);
  const grid = vehicleGrid(world);
  questCar(world);
  const mark = (c, isDoor) => {
    const r = c.r + CELL;
    const i0 = Math.max(0, Math.floor((c.x - r + half) / CELL)), i1 = Math.min(n - 1, Math.floor((c.x + r + half) / CELL));
    const j0 = Math.max(0, Math.floor((c.z - r + half) / CELL)), j1 = Math.min(n - 1, Math.floor((c.z + r + half) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * CELL - half, z = (j + 0.5) * CELL - half;
        if (!footprintContains(c, x, z, CELL * 0.5)) continue;
        if (!isDoor) {
          // (what stands lower than a wheel rides up onto is no wall, nor is what hangs over its roof)
          const gy = world.heightAt(x, z);
          if (c.y1 <= gy + 0.3 || c.y0 >= gy + 1.5) continue;
        }
        blocked[j * n + i] = 1;
      }
    }
  };
  const seen = new Set();
  for (const cell of world.staticGrid.cells) for (const c of cell) if (!seen.has(c) && !(c.flags & COL.NOBLOCK)) (seen.add(c), mark(c, false));
  for (const cell of grid.doors.cells) for (const c of cell) if (!seen.has(c)) (seen.add(c), mark(c, true));
  // water, the edge of the map
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * CELL - half, z = (j + 0.5) * CELL - half;
      if (Math.abs(x) > half - 6 || Math.abs(z) > half - 6) blocked[j * n + i] = 1;
      else if ((i & 1) === 0 && (j & 1) === 0) {
        if (world.heightAt(x, z) < WATER_LEVEL - 0.12 && groundAt(world, x, z, WATER_LEVEL + 3, 0.2, false) < WATER_LEVEL - 0.12) {
          for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (i + a < n && j + b < n) blocked[(j + b) * n + i + a] = 1;
        }
      }
    }
  }
  // distance to the nearest blocked cell (chamfer, capped at 8 cells)
  const d = new Uint8Array(n * n).fill(16);
  for (let k = 0; k < n * n; k++) if (blocked[k]) d[k] = 0;
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let jj = 0; jj < n; jj++) {
      const j = fwd ? jj : n - 1 - jj;
      for (let ii = 0; ii < n; ii++) {
        const i = fwd ? ii : n - 1 - ii;
        const k = j * n + i;
        let v = d[k];
        if (!v) continue;
        const s = fwd ? -1 : 1;
        if (i + s >= 0 && i + s < n) v = Math.min(v, d[k + s] + 2);
        if (j + s >= 0 && j + s < n) {
          v = Math.min(v, d[k + s * n] + 2);
          if (i + s >= 0 && i + s < n) v = Math.min(v, d[k + s * n + s] + 3);
          if (i - s >= 0 && i - s < n) v = Math.min(v, d[k + s * n - s] + 3);
        }
        d[k] = v;
      }
    }
  }
  return { n, half, d }; // d: half-cells to the nearest thing in the way (2 = one cell = 0.5 m)
}

// Every cell a vehicle of this radius can get to from (x, z): its cost-to-come by Dijkstra over the cells that are
// clear by r (m), preferring the road. Returns { reach(x, z) -> metres or Infinity, path(x, z) -> [[x, z], ...] }
export function flood(world, cl, x0, z0, r, kind = 0) {
  const { n, half, d } = cl;
  const need = Math.ceil((r / CELL) * 2); // in half-cells
  const cost = new Float32Array(n * n).fill(Infinity);
  const from = new Int32Array(n * n).fill(-1);
  const idx = (x, z) => Math.min(n - 1, Math.max(0, Math.floor((z + half) / CELL))) * n + Math.min(n - 1, Math.max(0, Math.floor((x + half) / CELL)));
  // (the nearest clear cell to the start)
  let s = idx(x0, z0);
  if (d[s] < need) {
    let best = -1, bd = 1e9;
    const ci = s % n, cj = (s / n) | 0;
    for (let j = cj - 12; j <= cj + 12; j++) for (let i = ci - 12; i <= ci + 12; i++) if (i >= 0 && j >= 0 && i < n && j < n && d[j * n + i] >= need && (i - ci) ** 2 + (j - cj) ** 2 < bd) (bd = (i - ci) ** 2 + (j - cj) ** 2), (best = j * n + i);
    s = best;
  }
  if (s < 0) return { reach: () => Infinity, path: () => null };
  // a binary heap of (cost, cell), in typed arrays (a cell may be in it more than once: the stale ones are skipped)
  let cap = 1 << 20;
  let hk = new Float32Array(cap);
  let hv = new Int32Array(cap);
  let hn = 0;
  const push = (k, c) => {
    if (hn === cap) {
      cap *= 2;
      const a = new Float32Array(cap), b2 = new Int32Array(cap);
      a.set(hk);
      b2.set(hv);
      hk = a;
      hv = b2;
    }
    let i = hn++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= c) break;
      hk[i] = hk[p];
      hv[i] = hv[p];
      i = p;
    }
    hk[i] = c;
    hv[i] = k;
  };
  const pop = () => {
    const top = hv[0];
    const c = hk[--hn], v = hv[hn];
    let i = 0;
    for (;;) {
      let ch = i * 2 + 1;
      if (ch >= hn) break;
      if (ch + 1 < hn && hk[ch + 1] < hk[ch]) ch++;
      if (hk[ch] >= c) break;
      hk[i] = hk[ch];
      hv[i] = hv[ch];
      i = ch;
    }
    hk[i] = c;
    hv[i] = v;
    return top;
  };
  cost[s] = 0;
  push(s, 0);
  const rk = new Uint8Array(n * n); // the road factor of a cell, x 20 (0: not asked yet)
  const road = (k) => {
    if (rk[k]) return rk[k] / 20;
    const x = ((k % n) + 0.5) * CELL - half, z = (((k / n) | 0) + 0.5) * CELL - half;
    // how much longer a metre of it takes than a metre of open road: by the ground, and by how little room there is
    const P = VEHICLES[kind];
    const sk = surfaceKind(world, x, z, world.heightAt(x, z));
    let f = P ? 1 / (1 - (1 - SURF_TOP[sk]) * P.offTop) : sk === 0 ? 1 : 1.15;
    if (P) {
      const room = d[k] * CELL * 0.5 - (P.halfW + 0.2);
      const v = room < 0.15 ? 5 : room < 0.5 ? 10 : room < 1.0 ? 16 : room < 1.8 ? 21 : 99;
      f = Math.max(f, P.top / v);
    }
    f = Math.min(12, f);
    rk[k] = Math.max(1, Math.round(f * 20));
    return rk[k] / 20;
  };
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  while (hn > 0) {
    const kc = hk[0];
    const k = pop();
    if (kc > cost[k] + 1e-3) continue;
    const i = k % n, j = (k / n) | 0;
    for (let q = 0; q < 8; q++) {
      const a = i + NB[q][0], c = j + NB[q][1];
      if (a < 0 || c < 0 || a >= n || c >= n) continue;
      const m = c * n + a;
      if (d[m] < need) continue;
      // (a little shy of what it only just clears)
      const nc = cost[k] + NB[q][2] * CELL * road(m);
      if (nc < cost[m] - 1e-4) {
        cost[m] = nc;
        from[m] = k;
        push(m, nc);
      }
    }
  }
  const near = (x, z) => {
    let k = idx(x, z);
    if (cost[k] < Infinity) return k;
    const ci = k % n, cj = (k / n) | 0;
    let best = -1, bc = Infinity;
    for (let j = cj - 24; j <= cj + 24; j++) for (let i = ci - 24; i <= ci + 24; i++) if (i >= 0 && j >= 0 && i < n && j < n && cost[j * n + i] < bc) (bc = cost[j * n + i]), (best = j * n + i);
    return best;
  };
  return {
    reach: (x, z) => {
      const k = near(x, z);
      return k < 0 ? Infinity : cost[k];
    },
    path: (x, z) => {
      let k = near(x, z);
      if (k < 0) return null;
      const out = [];
      for (; k >= 0; k = from[k]) out.push([((k % n) + 0.5) * CELL - half, (((k / n) | 0) + 0.5) * CELL - half]);
      return out.reverse();
    },
  };
}

const lengthOf = (path) => path.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0);

// A survivor on foot along the path, sprinting whenever they have the breath: seconds, or -1 (held up for good)
export function walk(world, path, limit = 900) {
  const s = createPlayerState();
  s.x = path[0][0];
  s.z = path[0][1];
  s.y = groundAt(world, s.x, s.z, 200, 0.3);
  let k = 1, t = 0, seq = 0;
  const cmd = { seq: 0, buttons: 0, yaw: 0, pitch: 0, slot: 255 };
  while (k < path.length && t < limit) {
    // (a point a few metres on along the way)
    while (k < path.length - 1 && Math.hypot(path[k][0] - s.x, path[k][1] - s.z) < 2.5) k++;
    const dx = path[k][0] - s.x, dz = path[k][1] - s.z;
    if (k === path.length - 1 && Math.hypot(dx, dz) < 1.5) break;
    cmd.seq = ++seq & 0xffff;
    cmd.yaw = Math.atan2(-dx, -dz);
    cmd.buttons = BTN.FWD | (s.exhausted ? 0 : BTN.SPRINT);
    simulatePlayer(s, cmd, world, null);
    t += CMD_DT;
  }
  return t >= limit ? -1 : t;
}

// A vehicle driven along the path by somebody who knows the road: seconds, the fuel burnt, the hardest it struck
// anything; -1 when it does not get there.
// Somebody who knows the road, at the wheel of a vehicle of this kind along a way found by flood(): pilot.step(v)
// says what they hold this moment - { thr: -1 / 0 / 1, turn: -1 / 0 / 1, done } - for a vehicle that is at v (x, z,
// yaw, vx, vz, steer). The way has the grid's corners taken out of it; every point of it has the speed it can be
// passed at (by how sharply the way turns there and how much room it has, and no faster than can be braked from for
// what comes after).
export function makePilot(world, kind, raw, cl = null, bold = 1) {
  const P = VEHICLES[kind];
  const need = P.halfW + 0.2;
  const N = raw.length;
  const roomAt = (x, z) => {
    if (!cl) return 9;
    const ci = Math.floor((x + cl.half) / CELL), cj = Math.floor((z + cl.half) / CELL);
    return cl.d[cj * cl.n + ci] * CELL * 0.5;
  };
  const path = raw.map((p) => [p[0], p[1]]);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < N - 1; i++) {
      const w = Math.min(i, N - 1 - i, 7);
      let x = 0, z = 0;
      for (let k = -w; k <= w; k++) (x += path[i + k][0]), (z += path[i + k][1]);
      x /= w * 2 + 1;
      z /= w * 2 + 1;
      if (roomAt(x, z) >= Math.min(roomAt(raw[i][0], raw[i][1]), need + 1.2)) (path[i][0] = x), (path[i][1] = z);
    }
  }
  const vmax = new Float32Array(N).fill(P.hardTop || P.top);
  const span = Math.max(4, Math.round((P.wb * 2.4) / CELL));
  for (let i = 0; i < N; i++) {
    const a = path[Math.max(0, i - span)], m = path[i], c = path[Math.min(N - 1, i + span)];
    let turn = Math.atan2(c[0] - m[0], c[1] - m[1]) - Math.atan2(m[0] - a[0], m[1] - a[1]);
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const len = Math.hypot(c[0] - m[0], c[1] - m[1]) + 1e-3;
    const curv = Math.abs(turn) / len;
    let v = curv > 1e-4 ? Math.sqrt((P.grip * 0.55 * bold) / curv) : 99;
    const room = roomAt(m[0], m[1]) - need;
    // (little room, less speed - two wheels, half as wide, need less of it)
    const slim = P.two ? 1.5 : 1;
    v = Math.min(v, room < 0.15 ? 5 * slim : room < 0.5 ? 10 * slim : room < 1.0 ? 16 : room < 1.8 ? 21 : 99);
    vmax[i] = Math.max(3, Math.min(vmax[i], v));
  }
  const dec = P.brake * 0.55;
  for (let i = N - 2; i >= 0; i--) {
    const ds = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] * vmax[i + 1] + 2 * dec * ds));
  }
  let k = 1, at = 0, key = 0;
  return {
    path,
    vmax,
    get at() {
      return at;
    },
    // the heading to set out on
    yaw0: Math.atan2(-(path[Math.min(N - 1, 8)][0] - path[0][0]), -(path[Math.min(N - 1, 8)][1] - path[0][1])),
    step(v) {
      const sp = Math.hypot(v.vx, v.vz);
      while (at < N - 1 && Math.hypot(path[at + 1][0] - v.x, path[at + 1][1] - v.z) <= Math.hypot(path[at][0] - v.x, path[at][1] - v.z)) at++;
      // (how far up the way they look: less where there is little room - round the end of a fence the far side of
      // it is not where to point yet)
      const ahead = (roomAt(v.x, v.z) - need < 0.7 ? 0.8 : 1.8) + sp * 0.32;
      if (k < at) k = at;
      while (k < N - 1 && Math.hypot(path[k][0] - v.x, path[k][1] - v.z) < ahead) k++;
      const dx = path[k][0] - v.x, dz = path[k][1] - v.z;
      if (k === N - 1 && Math.hypot(dx, dz) < 3) return { thr: -1, turn: 0, done: true, err: 0, want: 0 };
      let err = Math.atan2(-dx, -dz) - v.yaw;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      // (a right turn takes the yaw down). The wheel is turned as far as the turn asks, not always to the lock
      const lock = P.lock + (P.lockTop - P.lock) * Math.sqrt(Math.min(1, sp / P.top));
      const wantSteer = Math.max(-1, Math.min(1, (-err * 1.3) / lock));
      // a key is pressed when the wheel is well short of where it should be, and held until it gets there (not let go
      // and pressed again every command: a hand on a keyboard does not, and the wheel would saw back and forth)
      const off = wantSteer - v.steer / lock;
      if (key > 0 ? off <= 0 : key < 0 ? off >= 0 : true) key = off > 0.18 ? 1 : off < -0.18 ? -1 : 0;
      const turn = key;
      const want = Math.abs(err) > 1.2 ? 3 : vmax[Math.min(N - 1, at + 1)];
      return { thr: sp < want - 0.3 ? 1 : sp > want + 1 ? -1 : 0, turn, done: false, err, want };
    },
  };
}

// A vehicle driven along the path by that pilot: seconds, the fuel burnt, the hardest it struck anything; -1 when
// it does not get there.
export function drive(world, kind, raw, limit = 600, cl = null, trace = null) {
  const P = VEHICLES[kind];
  const pilot = makePilot(world, kind, raw, cl);
  const path = pilot.path;
  const v = { vk: kind, id: 1, x: path[0][0], y: 0, z: path[0][1], vx: 0, vz: 0, yaw: pilot.yaw0, steer: 0, fuel: P.tank || 1, run: true };
  v.y = groundAt(world, v.x, v.z, 200, 0.25, false);
  let t = 0, burnt = 0, worst = 0, stuck = 0, top = 0, wedged = 0;
  // (a bicycle: stood on the pedals while the breath lasts, as a survivor sprints - constants.js STAMINA_*)
  let stamina = 100, tired = false, rest = 0, hard = false;
  while (t < limit) {
    if (P.pedal) {
      hard = !tired && stamina > 0;
      if (hard) {
        stamina -= 14 * CMD_DT;
        rest = 0.9;
        if (stamina <= 0) tired = true;
      } else if ((rest -= CMD_DT) <= 0) {
        stamina = Math.min(100, stamina + 19 * CMD_DT);
        if (stamina >= 30) tired = false;
      }
    }
    const sp = Math.hypot(v.vx, v.vz);
    const c = pilot.step(v);
    if (c.done) break;
    if (trace) trace.push([pilot.at, sp, c.want, c.err, v.x, v.z]);
    const f0 = v.fuel;
    const hit = stepVehicle(v, c.thr, c.turn, false, hard, world, CMD_DT, null);
    burnt += f0 - v.fuel;
    if (P.tank) v.fuel = P.tank;
    worst = Math.max(worst, hit);
    top = Math.max(top, sp);
    stuck = sp < 0.4 ? stuck + CMD_DT : 0;
    if (stuck > 2.5) {
      // wedged: back off a little and go again (what a driver does)
      for (let i = 0; i < 80; i++) stepVehicle(v, -1, -c.turn, false, false, world, CMD_DT, null);
      t += 80 * CMD_DT;
      stuck = 0;
      if (++wedged > 12) return { t: -1, burnt, worst, top, at: [v.x, v.z], wedged };
    }
    t += CMD_DT;
  }
  return { t: t >= limit ? -1 : t, burnt, worst, top, at: [v.x, v.z], wedged };
}

// The trips of a world from the bridgehead: [{ name, x, z, far (m as the crow flies), foot: { m, t }, car, moped, bike: { m, t, burnt, worst } }]
export function routesFor(world, { places = null } = {}) {
  const cl = clearance(world);
  const start = world.start;
  const kinds = [[VEH.CAR, 1.1], [VEH.MOPED, 0.75], [VEH.BIKE, 0.75]];
  const foot = flood(world, cl, start.x, start.z, 0.75);
  const floods = kinds.map(([k, r]) => [k, flood(world, cl, start.x, start.z, r, k)]);
  const out = [];
  for (const z of world.zones) {
    if (places && !places.includes(z.id)) continue;
    const far = Math.hypot(z.x - start.x, z.z - start.z);
    if (far < 40) continue;
    const row = { id: z.id, name: ZONE_NAMES[z.id], x: z.x, z: z.z, far };
    const fp = foot.path(z.x, z.z);
    row.foot = fp ? { m: lengthOf(fp), t: walk(world, fp), short: Math.hypot(fp[fp.length - 1][0] - z.x, fp[fp.length - 1][1] - z.z) } : null;
    for (const [k, fl] of floods) {
      const p = fl.path(z.x, z.z);
      const short = p ? Math.hypot(p[p.length - 1][0] - z.x, p[p.length - 1][1] - z.z) : Infinity;
      row[VEH_NAMES[k]] = p ? { m: lengthOf(p), short, ...drive(world, k, p, 600, cl) } : null;
    }
    out.push(row);
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('vehicle-routes.js')) {
  const seed = +(process.argv[2] || 1337);
  const all = process.argv.includes('--all');
  const t0 = Date.now();
  const world = worldFor(seed, 2);
  const MAIN = ['Port Calder', 'Mile 9 Truck Stop', 'Calder Field Hangars', 'Kessler Ironworks', 'Eastgate', 'Calder Fuel Depot', 'Lake Morrow Marina', "Benny's Auto Salvage"];
  const rows = routesFor(world).filter((r) => all || MAIN.includes(r.name));
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
  else {
    const f = (v) => (v == null ? '   -' : String(Math.round(v)).padStart(4));
    console.log(`seed ${seed} (${Date.now() - t0} ms): from the bridgehead`);
    console.log('place                      crow   foot m    s | car m    s  fuel hit short | moped m    s fuel hit | bike m    s');
    for (const r of rows) {
      const c = r.car, m = r.moped, b = r.bicycle;
      console.log(`${r.name.padEnd(26)} ${f(r.far)}   ${f(r.foot?.m)} ${f(r.foot?.t)} |  ${f(c?.m)} ${f(c?.t)}  ${f(c?.burnt)} ${f(c?.worst)} ${f(c?.short)}  |   ${f(m?.m)} ${f(m?.t)} ${f(m?.burnt)} ${f(m?.worst)} |  ${f(b?.m)} ${f(b?.t)}`);
    }
  }
}
