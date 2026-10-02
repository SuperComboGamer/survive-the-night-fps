// Collision primitives + uniform grid broadphase shared by server and client.
// Colliders are yaw-rotated boxes (OBB in XZ with a Y range) or vertical cylinders.
import { STEP_HEIGHT } from './constants.js';

export const COL = {
  STATIC: 1,
  STRUCT: 2, // player built structure (id = entity id)
  HUMANPASS: 4, // survivors walk through (gate), zombies do not
  NOBLOCK: 8, // does not block movement (traps) - only for queries
  TREE: 16,
  NOBULLET: 32, // bullets pass through (e.g. wire, fences)
  SALVAGE: 64, // wreck: melee hits yield scrap
};

export const BOX = 0;
export const CYL = 1;

let stampCounter = 1;

export function makeBox(x, z, y0, y1, sx, sz, yaw, flags = COL.STATIC, id = 0) {
  const hx = sx / 2;
  const hz = sz / 2;
  return {
    type: BOX,
    x,
    z,
    y0,
    y1,
    hx,
    hz,
    c: Math.cos(yaw),
    s: Math.sin(yaw),
    yaw,
    r: Math.sqrt(hx * hx + hz * hz),
    flags,
    id,
    stamp: 0,
    cells: null,
  };
}

export function makeCyl(x, z, y0, y1, r, flags = COL.STATIC, id = 0) {
  return { type: CYL, x, z, y0, y1, hx: r, hz: r, c: 1, s: 0, yaw: 0, r, flags, id, stamp: 0, cells: null };
}

export class ColliderGrid {
  constructor(half, cellSize = 8) {
    this.half = half;
    this.cell = cellSize;
    this.n = Math.ceil((half * 2) / cellSize);
    this.cells = new Array(this.n * this.n);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this.count = 0;
  }
  _range(x, z, r) {
    const n = this.n;
    const inv = 1 / this.cell;
    let x0 = Math.floor((x - r + this.half) * inv);
    let x1 = Math.floor((x + r + this.half) * inv);
    let z0 = Math.floor((z - r + this.half) * inv);
    let z1 = Math.floor((z + r + this.half) * inv);
    if (x0 < 0) x0 = 0;
    if (z0 < 0) z0 = 0;
    if (x1 >= n) x1 = n - 1;
    if (z1 >= n) z1 = n - 1;
    return [x0, x1, z0, z1];
  }
  add(c) {
    const [x0, x1, z0, z1] = this._range(c.x, c.z, c.r);
    c.cells = [];
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const idx = j * this.n + i;
        this.cells[idx].push(c);
        c.cells.push(idx);
      }
    }
    this.count++;
    return c;
  }
  remove(c) {
    if (!c.cells) return;
    for (const idx of c.cells) {
      const arr = this.cells[idx];
      const k = arr.indexOf(c);
      if (k >= 0) {
        arr[k] = arr[arr.length - 1];
        arr.pop();
      }
    }
    c.cells = null;
    this.count--;
  }
  // collects unique colliders whose bounding circle may overlap (x,z,r) into out (cleared first)
  query(x, z, r, out) {
    out.length = 0;
    const stamp = ++stampCounter;
    const [x0, x1, z0, z1] = this._range(x, z, r);
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const arr = this.cells[j * this.n + i];
        for (let k = 0; k < arr.length; k++) {
          const c = arr[k];
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          const dx = c.x - x;
          const dz = c.z - z;
          const rr = c.r + r;
          if (dx * dx + dz * dz <= rr * rr) out.push(c);
        }
      }
    }
    return out;
  }
  cellAt(x, z) {
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return null;
    return this.cells[j * this.n + i];
  }
}

// ---------------------------------------------------------------- point / circle tests
// is point (x,z) inside collider footprint expanded by r
export function footprintContains(c, x, z, r = 0) {
  const dx = x - c.x;
  const dz = z - c.z;
  if (c.type === CYL) {
    const rr = c.r + r;
    return dx * dx + dz * dz <= rr * rr;
  }
  const lx = c.c * dx - c.s * dz;
  const lz = c.s * dx + c.c * dz;
  return Math.abs(lx) <= c.hx + r && Math.abs(lz) <= c.hz + r;
}

// Push circle (x,z,r) out of collider horizontally. Returns true if pushed; writes result into out {x,z,nx,nz}
export function pushCircle(c, x, z, r, out) {
  const dx = x - c.x;
  const dz = z - c.z;
  if (c.type === CYL) {
    const d2 = dx * dx + dz * dz;
    const rr = c.r + r;
    if (d2 >= rr * rr) return false;
    const d = Math.sqrt(d2);
    let nx, nz;
    if (d < 1e-5) {
      nx = 1;
      nz = 0;
    } else {
      nx = dx / d;
      nz = dz / d;
    }
    out.x = c.x + nx * rr;
    out.z = c.z + nz * rr;
    out.nx = nx;
    out.nz = nz;
    return true;
  }
  // box: local space
  const lx = c.c * dx - c.s * dz;
  const lz = c.s * dx + c.c * dz;
  const hx = c.hx;
  const hz = c.hz;
  let px = lx < -hx ? -hx : lx > hx ? hx : lx;
  let pz = lz < -hz ? -hz : lz > hz ? hz : lz;
  let ox = lx - px;
  let oz = lz - pz;
  let d2 = ox * ox + oz * oz;
  let nlx, nlz, nlocX, nlocZ;
  if (d2 > 1e-10) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    nlx = ox / d;
    nlz = oz / d;
    nlocX = px + nlx * r;
    nlocZ = pz + nlz * r;
  } else {
    // center inside box: push out along axis of least penetration
    const penX = hx - Math.abs(lx);
    const penZ = hz - Math.abs(lz);
    if (penX < penZ) {
      nlx = lx >= 0 ? 1 : -1;
      nlz = 0;
      nlocX = nlx * (hx + r);
      nlocZ = lz;
    } else {
      nlx = 0;
      nlz = lz >= 0 ? 1 : -1;
      nlocX = lx;
      nlocZ = nlz * (hz + r);
    }
  }
  // back to world: w = R * l  (wx = c*lx + s*lz ; wz = -s*lx + c*lz)
  out.x = c.x + c.c * nlocX + c.s * nlocZ;
  out.z = c.z - c.s * nlocX + c.c * nlocZ;
  out.nx = c.c * nlx + c.s * nlz;
  out.nz = -c.s * nlx + c.c * nlz;
  return true;
}

// ---------------------------------------------------------------- rays
// Ray vs collider. Returns hit distance or -1. Direction must be normalized.
export function rayCollider(c, ox, oy, oz, dx, dy, dz, maxT) {
  let tmin = 0;
  let tmax = maxT;
  // Y slab
  if (Math.abs(dy) < 1e-9) {
    if (oy < c.y0 || oy > c.y1) return -1;
  } else {
    let t1 = (c.y0 - oy) / dy;
    let t2 = (c.y1 - oy) / dy;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  const rx = ox - c.x;
  const rz = oz - c.z;
  if (c.type === CYL) {
    const a = dx * dx + dz * dz;
    if (a < 1e-12) {
      return rx * rx + rz * rz <= c.r * c.r ? tmin : -1;
    }
    const b = 2 * (rx * dx + rz * dz);
    const cc = rx * rx + rz * rz - c.r * c.r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    let t1 = (-b - sq) / (2 * a);
    let t2 = (-b + sq) / (2 * a);
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
    return tmin;
  }
  // box in local xz
  const lox = c.c * rx - c.s * rz;
  const loz = c.s * rx + c.c * rz;
  const ldx = c.c * dx - c.s * dz;
  const ldz = c.s * dx + c.c * dz;
  if (Math.abs(ldx) < 1e-9) {
    if (lox < -c.hx || lox > c.hx) return -1;
  } else {
    let t1 = (-c.hx - lox) / ldx;
    let t2 = (c.hx - lox) / ldx;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(ldz) < 1e-9) {
    if (loz < -c.hz || loz > c.hz) return -1;
  } else {
    let t1 = (-c.hz - loz) / ldz;
    let t2 = (c.hz - loz) / ldz;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Ray vs vertical capsule-ish cylinder (for entity hitboxes). Returns t or -1.
export function rayCylinder(cx, cz, y0, y1, r, ox, oy, oz, dx, dy, dz, maxT) {
  const rx = ox - cx;
  const rz = oz - cz;
  const a = dx * dx + dz * dz;
  let tmin = 0;
  let tmax = maxT;
  if (a > 1e-12) {
    const b = 2 * (rx * dx + rz * dz);
    const cc = rx * rx + rz * rz - r * r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  } else if (rx * rx + rz * rz > r * r) return -1;
  if (Math.abs(dy) < 1e-9) {
    if (oy < y0 || oy > y1) return -1;
  } else {
    let t1 = (y0 - oy) / dy;
    let t2 = (y1 - oy) / dy;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export function raySphere(cx, cy, cz, r, ox, oy, oz, dx, dy, dz, maxT) {
  const rx = ox - cx;
  const ry = oy - cy;
  const rz = oz - cz;
  const b = rx * dx + ry * dy + rz * dz;
  const c = rx * rx + ry * ry + rz * rz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;
  return t <= maxT ? t : -1;
}

// ---------------------------------------------------------------- world-level helpers (world = createWorld() result, optionally with structure grid)
const _q = [];
const _q2 = [];
const _push = { x: 0, z: 0, nx: 0, nz: 0 };

// Highest walkable surface under (x,z) that is at or below y + STEP_HEIGHT
// (the lowest of them is the terrain, or for feet down in the mine the floor of the drift: world.floorAt)
export function groundAt(world, x, z, y, r = 0.2, human = true) {
  let h = world.floorAt ? world.floorAt(x, z, y) : world.heightAt(x, z);
  const grids = world.colliderGrids;
  for (let g = 0; g < grids.length; g++) {
    const list = grids[g].query(x, z, r, _q);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.flags & (COL.NOBLOCK | COL.TREE)) continue;
      if (human && c.flags & COL.HUMANPASS) continue;
      const top = c.y1;
      if (top > h && top <= y + STEP_HEIGHT + 0.02 && footprintContains(c, x, z, r)) h = top;
    }
  }
  return h;
}

// Deep water at (x,z) with nothing over it that feet at height y could stand on: where nothing on foot,
// living or dead, may step. A pier deck over the lake is walkable; the lake beside and beneath it is not.
export function deepWaterAt(world, x, z, y, r = 0.2, human = true) {
  return world.isDeepWater(x, z) && groundAt(world, x, z, y, r, human) <= world.heightAt(x, z) + 0.01;
}

// Resolve horizontal overlap of a vertical cylinder body. Mutates pos {x,y,z}.
// Returns the last blocking collider (or null).
export function resolveBody(world, pos, r, height, human = true) {
  let hit = null;
  const grids = world.colliderGrids;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (let g = 0; g < grids.length; g++) {
      const list = grids[g].query(pos.x, pos.z, r + 0.1, _q2);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.flags & COL.NOBLOCK) continue;
        if (human && c.flags & COL.HUMANPASS) continue;
        if (c.y1 <= pos.y + STEP_HEIGHT || c.y0 >= pos.y + height) continue;
        if (pushCircle(c, pos.x, pos.z, r, _push)) {
          pos.x = _push.x;
          pos.z = _push.z;
          hit = c;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  // down in the mine the rock around the drift is a wall too (mine.js)
  if (world.mine && world.mine.confine(pos, r) && !hit) hit = ROCK;
  return hit;
}
// what resolveBody says it hit when the rock of the mine stopped a body: not a collider of any grid
const ROCK = makeCyl(0, 0, 0, 0, 0);

// Ray against static + structure colliders and terrain. Returns {t, col} with t = -1 if nothing within maxT.
const _rq = [];
export function raycastWorld(world, ox, oy, oz, dx, dy, dz, maxT, out = { t: -1, col: null, terrain: false }, skipFlags = COL.NOBULLET | COL.NOBLOCK) {
  let best = maxT;
  let bestCol = null;
  let terrain = false;
  // colliders: sample along the ray in cell-sized steps and query small circles
  const grids = world.colliderGrids;
  const step = 4;
  const stamp = ++stampCounter;
  for (let g = 0; g < grids.length; g++) {
    const grid = grids[g];
    for (let s = 0; s <= best + step; s += step) {
      const px = ox + dx * s;
      const pz = oz + dz * s;
      const list = grid.query(px, pz, step * 0.75, _rq);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c._rs === stamp) continue;
        c._rs = stamp;
        if (c.flags & skipFlags) continue;
        const t = rayCollider(c, ox, oy, oz, dx, dy, dz, best);
        if (t >= 0 && t < best) {
          best = t;
          bestCol = c;
        }
      }
    }
  }
  // terrain march
  const tt = world.rayTerrain(ox, oy, oz, dx, dy, dz, best);
  if (tt >= 0 && tt < best) {
    best = tt;
    bestCol = null;
    terrain = true;
  }
  out.t = bestCol || terrain ? best : -1;
  out.col = bestCol;
  out.terrain = terrain;
  return out;
}

// Can an eye reach an interaction point without going through a wall? Only full-height colliders (top above reachTop)
// block - sills, furniture and barricades can be reached over, and survivors pass gates/door boards anyway. The
// target's own collider (one containing the point, e.g. a fridge) and hits within `pad` of the point are ignored.
const _lq = [];
export function canReach(world, ox, oy, oz, tx, ty, tz, reachTop, pad = 0.2) {
  let dx = tx - ox;
  let dy = ty - oy;
  let dz = tz - oz;
  const len = Math.hypot(dx, dy, dz);
  const maxT = len - pad;
  if (maxT <= 0) return true;
  dx /= len;
  dy /= len;
  dz /= len;
  const skip = COL.NOBLOCK | COL.NOBULLET | COL.HUMANPASS;
  const mx = (ox + tx) / 2;
  const mz = (oz + tz) / 2;
  const r = Math.hypot(tx - ox, tz - oz) / 2;
  const grids = world.colliderGrids;
  for (let g = 0; g < grids.length; g++) {
    const list = grids[g].query(mx, mz, r, _lq);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.flags & skip || c.y1 <= reachTop) continue;
      if (ty >= c.y0 && ty <= c.y1 && footprintContains(c, tx, tz)) continue;
      if (rayCollider(c, ox, oy, oz, dx, dy, dz, maxT) >= 0) return false;
    }
  }
  return true;
}

// OBB overlap test in XZ (separating axis) with optional margin
export function overlapBoxes(a, b, margin = 0) {
  const ax = [a.c, -a.s];
  const az = [a.s, a.c];
  const bx = b.type === 0 ? [b.c, -b.s] : [1, 0];
  const bz = b.type === 0 ? [b.s, b.c] : [0, 1];
  const ahx = a.hx + margin;
  const ahz = a.hz + margin;
  const bhx = b.hx + margin;
  const bhz = b.hz + margin;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const axes = [ax, az, bx, bz];
  for (const ax2 of axes) {
    const proj = (h1, u, h2, v) => Math.abs(h1 * (u[0] * ax2[0] + u[1] * ax2[1])) + Math.abs(h2 * (v[0] * ax2[0] + v[1] * ax2[1]));
    const ra = proj(ahx, ax, ahz, az);
    const rb = proj(bhx, bx, bhz, bz);
    const dist = Math.abs(dx * ax2[0] + dz * ax2[1]);
    if (dist > ra + rb) return false;
  }
  return true;
}
