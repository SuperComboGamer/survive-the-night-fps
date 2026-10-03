// Mesh building for the Shaft Nine stops: a small vertex-colour mesher and the static geometry of a stop (rock walls,
// ceiling, floor, pools, props) built from the same grid the colliders came from (shared/mine.js). A stop ends up as
// three meshes - lit, glowing solids, additive halos - so a whole stop costs a handful of draw calls.
import * as THREE from 'three';
import { STOP_NX, STOP_NZ, STOP_X0, STOP_Z0, CELL, VOID, POOL_DEPTH, mergeCells } from '../../shared/mine.js';

const _c = new THREE.Color();
export const col = (hex) => _c.set(hex).clone();

// deterministic noise
export const hash2 = (a, b, s = 0) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Mesher {
  constructor() {
    this.p = [];
    this.n = [];
    this.u = [];
    this.c = [];
  }
  v(x, y, z, nx, ny, nz, u, vv, r, g, b) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.u.push(u, vv);
    this.c.push(r, g, b);
  }
  // a quad a-b-c-d (counter-clockwise seen from the normal's side); the colour is multiplied per corner by shade[0..3]
  quad(a, b, c, d, nx, ny, nz, color, uvs, shade = null) {
    const s = shade || [1, 1, 1, 1];
    const pts = [a, b, c, d];
    const order = [0, 1, 2, 0, 2, 3];
    for (const k of order) {
      const p = pts[k];
      const u = uvs ? uvs[k * 2] : k === 1 || k === 2 ? 1 : 0;
      const w = uvs ? uvs[k * 2 + 1] : k >= 2 ? 1 : 0;
      this.v(p[0], p[1], p[2], nx, ny, nz, u, w, color.r * s[k], color.g * s[k], color.b * s[k]);
    }
  }
  // an axis-aligned (then yawed about its centre) box; faces carry a fixed shade so it reads without much light
  box(cx, cy, cz, sx, sy, sz, color, yaw = 0, faces = 63, tile = 2) {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const P = (x, y, z) => [cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs];
    const N = (x, z) => [x * cs + z * sn, 0, -x * sn + z * cs];
    const f = (a, b, c, d, n, shade) => {
      const k = shade;
      this.quad(a, b, c, d, n[0], n[1], n[2], color, null, [k, k, k, k]);
    };
    if (faces & 1) f(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), [0, 1, 0], 1);
    if (faces & 2) f(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), [0, -1, 0], 0.45);
    if (faces & 4) f(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 1), 0.82);
    if (faces & 8) f(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), N(0, -1), 0.7);
    if (faces & 16) f(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), N(1, 0), 0.9);
    if (faces & 32) f(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), N(-1, 0), 0.6);
  }
  // a vertical prism / cone / cylinder (sides only plus an optional cap): r0 at the bottom, r1 at the top
  cyl(cx, y0, cz, r0, r1, h, seg, color, cap = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const am = (a0 + a1) / 2;
      const sh = 0.7 + 0.3 * Math.cos(am - 0.8);
      const slope = (r0 - r1) / Math.max(h, 1e-3);
      const nl = Math.hypot(1, slope);
      this.quad([cx + c0 * r0, y0, cz + s0 * r0], [cx + c1 * r0, y0, cz + s1 * r0], [cx + c1 * r1, y0 + h, cz + s1 * r1], [cx + c0 * r1, y0 + h, cz + s0 * r1], Math.cos(am) / nl, slope / nl, Math.sin(am) / nl, color, null, [sh, sh, sh, sh]);
      if (cap && r1 > 0.01) {
        this.v(cx, y0 + h, cz, 0, 1, 0, 0.5, 0.5, color.r, color.g, color.b);
        this.v(cx + c1 * r1, y0 + h, cz + s1 * r1, 0, 1, 0, 1, 0, color.r, color.g, color.b);
        this.v(cx + c0 * r1, y0 + h, cz + s0 * r1, 0, 1, 0, 0, 1, color.r, color.g, color.b);
      }
    }
  }
  // a prism between two points (a beam, a pipe): square or round section
  beam(a, b, w, color, seg = 4) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / L;
    const uy = dy / L;
    const uz = dz / L;
    // any perpendicular
    let px = -uz;
    let pz = ux;
    let py = 0;
    if (Math.abs(ux) + Math.abs(uz) < 1e-3) {
      px = 1;
      pz = 0;
    }
    const pl = Math.hypot(px, pz) || 1;
    px /= pl;
    pz /= pl;
    const qx = uy * pz - uz * py;
    const qy = uz * px - ux * pz;
    const qz = ux * py - uy * px;
    const h = w / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = ((i + 0.5) / seg) * Math.PI * 2 + (seg === 4 ? 0 : 0);
      const a1 = ((i + 1.5) / seg) * Math.PI * 2;
      const o0 = [Math.cos(a0) * h * (seg === 4 ? 1.414 : 1), Math.sin(a0) * h * (seg === 4 ? 1.414 : 1)];
      const o1 = [Math.cos(a1) * h * (seg === 4 ? 1.414 : 1), Math.sin(a1) * h * (seg === 4 ? 1.414 : 1)];
      const P = (p, o) => [p[0] + px * o[0] + qx * o[1], p[1] + qy * o[1], p[2] + pz * o[0] + qz * o[1]];
      const am = (a0 + a1) / 2;
      const nx = px * Math.cos(am) + qx * Math.sin(am);
      const ny = qy * Math.sin(am);
      const nz = pz * Math.cos(am) + qz * Math.sin(am);
      const sh = 0.65 + 0.35 * (ny * 0.5 + 0.5);
      this.quad(P(a, o0), P(a, o1), P(b, o1), P(b, o0), nx, ny, nz, color, null, [sh, sh, sh, sh]);
    }
  }
  // a stretched octahedron (a crystal): base centre, up vector length, radius
  crystal(cx, cy, cz, r, h, tilt, yaw, color, tipColor = null) {
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const cy2 = Math.cos(yaw);
    const sy2 = Math.sin(yaw);
    const T = (x, y, z) => {
      // tilt about x then yaw about y
      const y1 = y * ct - z * st;
      const z1 = y * st + z * ct;
      return [cx + x * cy2 + z1 * sy2, cy + y1, cz - x * sy2 + z1 * cy2];
    };
    const top = T(0, h, 0);
    const mid = T(0, h * 0.28, 0);
    const bot = T(0, 0, 0);
    const ring = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ring.push(T(Math.cos(a) * r, h * 0.28, Math.sin(a) * r));
    }
    const tc = tipColor || color;
    for (let i = 0; i < 6; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % 6];
      const n1 = norm3(cross(sub(b, a), sub(top, a)));
      this.tri(a, b, top, n1, color, color, tc);
      const n2 = norm3(cross(sub(bot, a), sub(b, a)));
      this.tri(a, bot, b, n2, color, color, color);
    }
    void mid;
  }
  tri(a, b, c, n, ca, cb, cc) {
    const d = (n[1] * 0.5 + 0.5) * 0.5 + 0.5;
    this.v(a[0], a[1], a[2], n[0], n[1], n[2], 0, 0, ca.r * d, ca.g * d, ca.b * d);
    this.v(b[0], b[1], b[2], n[0], n[1], n[2], 1, 0, cb.r * d, cb.g * d, cb.b * d);
    this.v(c[0], c[1], c[2], n[0], n[1], n[2], 0.5, 1, cc.r, cc.g, cc.b);
  }
  get count() {
    return this.p.length / 3;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.u), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ---------------------------------------------------------------- per-stop look
// ceil: wall height / ceiling height at the walls (lo) and far from any wall (hi); r: how far from a wall it takes to reach hi
export const STYLE = {
  surface: { lo: 13, hi: 13, r: 1, sky: true, wall: 0x6e6252, wall2: 0x4a4238, floor: 0x4c453b, floor2: 0x3a342c, ceil: 0x2a2620, glow: 0xffb468 },
  tunnels: { lo: 2.9, hi: 3.7, r: 2, wall: 0x5a4733, wall2: 0x3a2d20, floor: 0x3d352c, floor2: 0x2d2720, ceil: 0x2a2018, glow: 0xffb670 },
  flooded: { lo: 4.6, hi: 9.2, r: 12, wall: 0x6a716c, wall2: 0x464c49, floor: 0x474e4a, floor2: 0x323836, ceil: 0x3c4340, glow: 0xbff6ee },
  crystal: { lo: 5, hi: 17, r: 20, wall: 0x54487a, wall2: 0x32284c, floor: 0x3a3158, floor2: 0x261e3c, ceil: 0x2a2244, glow: 0x9a5cff },
  magma: { lo: 5, hi: 17, r: 18, wall: 0x3a302c, wall2: 0x1c1614, floor: 0x2c2321, floor2: 0x1c1614, ceil: 0x1a1210, glow: 0xff6a24 },
};

// rock: a tiling fractal height field (cracks cut into it), turned into a colour map and a normal map
function rockHeight(size) {
  const rnd = rng(1234);
  const grid = (n) => {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return a;
  };
  const layers = [
    [8, grid(8), 0.5],
    [16, grid(16), 0.28],
    [32, grid(32), 0.14],
    [64, grid(64), 0.08],
    [128, grid(128), 0.05],
  ];
  const sample = (g, n, u, v) => {
    const fx = u * n;
    const fy = v * n;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = g[(j % n) * n + (i % n)];
    const b = g[(j % n) * n + ((i + 1) % n)];
    const cc = g[((j + 1) % n) * n + (i % n)];
    const d = g[((j + 1) % n) * n + ((i + 1) % n)];
    return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
  };
  const h = new Float32Array(size * size);
  const crackAt = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let v = 0;
      for (const [n, g, w] of layers) v += sample(g, n, px / size, py / size) * w;
      const c = Math.abs(sample(layers[2][1], 32, px / size, py / size) - 0.5);
      const crack = c < 0.03 ? 0.4 + (c / 0.03) * 0.6 : 1;
      h[py * size + px] = v * crack;
      crackAt[py * size + px] = crack;
    }
  }
  return { h, crackAt };
}

export function rockTexture(size = 256) {
  const { h, crackAt } = rockHeight(size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const k = Math.max(0, Math.min(255, (0.55 + h[i] * 0.6) * 255 * (0.35 + 0.65 * crackAt[i])));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = k;
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

export function rockNormal(size = 256) {
  const { h } = rockHeight(size);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  const at = (i, j) => h[((j + size) % size) * size + ((i + size) % size)];
  const k = 9;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * k;
      const dy = (at(i, j + 1) - at(i, j - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const o = (j * size + i) * 4;
      img.data[o] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// soft round glow for halos and light pools
export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ---------------------------------------------------------------- the rock of a stop
// distance (in cells) from each open cell to the nearest rock
function rockDistance(grid) {
  const d = new Uint8Array(grid.length).fill(255);
  const q = [];
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] === 0) {
      d[k] = 0;
      q.push(k);
    }
  }
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    const i = k % STOP_NX;
    const j = (k - i) / STOP_NX;
    const nd = d[k] + 1;
    if (nd > 40) continue;
    if (i > 0 && d[k - 1] > nd) ((d[k - 1] = nd), q.push(k - 1));
    if (i < STOP_NX - 1 && d[k + 1] > nd) ((d[k + 1] = nd), q.push(k + 1));
    if (j > 0 && d[k - STOP_NX] > nd) ((d[k - STOP_NX] = nd), q.push(k - STOP_NX));
    if (j < STOP_NZ - 1 && d[k + STOP_NX] > nd) ((d[k + STOP_NX] = nd), q.push(k + STOP_NX));
  }
  return d;
}

const sstep = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

export function inPool(stop, lx, lz) {
  for (const p of stop.pools) if (lx >= p[0] && lx < p[2] && lz >= p[1] && lz < p[3]) return true;
  return false;
}

// Builds the walls, ceiling and floors of the stop into M (lit mesher) and returns { dist, ceilAt } for the props
export function buildRock(stop, M, G) {
  const st = STYLE[stop.id];
  const grid = stop.grid;
  const dist = rockDistance(grid);
  const wallC = col(st.wall);
  const wallC2 = col(st.wall2);
  const at = (i, j) => (i < 0 || j < 0 || i >= STOP_NX || j >= STOP_NZ ? 0 : grid[j * STOP_NX + i]);
  const cx = (i) => STOP_X0 + i * CELL;
  const cz = (j) => STOP_Z0 + j * CELL;
  const ceilAt = (x, z) => {
    const i = Math.floor((x - STOP_X0) / CELL);
    const j = Math.floor((z - STOP_Z0) / CELL);
    const d = i < 0 || j < 0 || i >= STOP_NX || j >= STOP_NZ ? 0 : dist[j * STOP_NX + i];
    return st.lo + (st.hi - st.lo) * sstep((d * CELL) / st.r);
  };
  const wallUV = (u0, u1, v0, v1) => [u0, v0, u1, v0, u1, v1, u0, v1];
  // walls: every open cell edge that meets rock, and the drops into a pit
  for (let j = 0; j < STOP_NZ; j++) {
    for (let i = 0; i < STOP_NX; i++) {
      const v = grid[j * STOP_NX + i];
      if (!v) continue;
      const x0 = cx(i);
      const z0 = cz(j);
      const x1 = x0 + CELL;
      const z1 = z0 + CELL;
      const lx = x0 + CELL / 2;
      const lz = z0 + CELL / 2;
      const void_ = v === VOID;
      const pool = !void_ && inPool(stop, lx, lz);
      const yb = void_ ? G.pit : pool ? -POOL_DEPTH : 0;
      const top = st.lo;
      const tint = hash2(i, j, 5);
      // west (-x), east, north (-z), south
      const dirs = [
        [-1, 0, [x0, z1], [x0, z0], 1, 0],
        [1, 0, [x1, z0], [x1, z1], -1, 0],
        [0, -1, [x0, z0], [x1, z0], 0, 1],
        [0, 1, [x1, z1], [x0, z1], 0, -1],
      ];
      for (const [di, dj, a, b, nx, nz] of dirs) {
        const nv = at(i + di, j + dj);
        if (nv === 0) {
          const c = wallC.clone().lerp(wallC2, 0.25 + tint * 0.6);
          const u0 = (di ? z0 : x0) / 3;
          M.quad([a[0], yb, a[1]], [b[0], yb, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], nx, 0, nz, c, wallUV(u0, u0 + 1 / 3, yb / 3, top / 3), [0.5, 0.5, 1, 1]);
        } else if (!void_ && nv === VOID) {
          // drop into the pit
          const c = G.pitWall;
          M.quad([a[0], G.pit, a[1]], [b[0], G.pit, b[1]], [b[0], yb, b[1]], [a[0], yb, a[1]], -nx, 0, -nz, c, null, [0.4, 0.4, 1, 1]);
          // (a quad seen from the pit side: wound the other way, so draw it facing the pit)
          M.quad([b[0], G.pit, b[1]], [a[0], G.pit, a[1]], [a[0], yb, a[1]], [b[0], yb, b[1]], -nx, 0, -nz, c, null, [0.4, 0.4, 1, 1]);
        } else if (!void_ && !pool && nv !== VOID && inPool(stop, lx + di, lz + dj)) {
          // the step down into a pool
          const c = wallC2.clone().multiplyScalar(0.8);
          M.quad([a[0], -POOL_DEPTH, a[1]], [b[0], -POOL_DEPTH, b[1]], [b[0], 0, b[1]], [a[0], 0, a[1]], -nx, 0, -nz, c, null, [0.6, 0.6, 1, 1]);
          M.quad([b[0], -POOL_DEPTH, b[1]], [a[0], -POOL_DEPTH, a[1]], [a[0], 0, a[1]], [b[0], 0, b[1]], -nx, 0, -nz, c, null, [0.6, 0.6, 1, 1]);
        }
      }
    }
  }
  // floors (dry), pools and pits as merged rectangles
  const dry = new Uint8Array(grid.length);
  const wet = new Uint8Array(grid.length);
  const pit = new Uint8Array(grid.length);
  for (let j = 0; j < STOP_NZ; j++) {
    for (let i = 0; i < STOP_NX; i++) {
      const v = grid[j * STOP_NX + i];
      if (!v) continue;
      const k = j * STOP_NX + i;
      if (v === VOID) pit[k] = 1;
      else if (inPool(stop, cx(i) + CELL / 2, cz(j) + CELL / 2)) wet[k] = 1;
      else dry[k] = 1;
    }
  }
  const floorRects = (flag, y, c0, c1, tile) => {
    for (const [i0, j0, i1, j1] of mergeCells(flag)) {
      const x0 = cx(i0);
      const x1 = cx(i1);
      const z0 = cz(j0);
      const z1 = cz(j1);
      const c = c0.clone().lerp(c1, hash2(i0, j0, 9) * 0.35);
      M.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], 0, 1, 0, c, [x0 / tile, z1 / tile, x1 / tile, z1 / tile, x1 / tile, z0 / tile, x0 / tile, z0 / tile]);
    }
  };
  floorRects(dry, 0, col(st.floor), col(st.floor2), 3);
  floorRects(wet, -POOL_DEPTH, col(st.floor2), col(st.floor2).multiplyScalar(0.6), 3);
  floorRects(pit, G.pit, G.pitFloor, G.pitFloor, 3);
  // ceiling: 2 m blocks over anything open, vertex heights from the distance to the rock
  if (!st.sky) {
    const cc = col(st.ceil);
    for (let j = 0; j < STOP_NZ; j += 2) {
      for (let i = 0; i < STOP_NX; i += 2) {
        if (!at(i, j) && !at(i + 1, j) && !at(i, j + 1) && !at(i + 1, j + 1)) continue;
        const x0 = cx(i);
        const z0 = cz(j);
        const x1 = x0 + 2 * CELL;
        const z1 = z0 + 2 * CELL;
        const h = (x, z) => ceilAt(x, z) + (hash2(Math.round(x), Math.round(z), 3) - 0.5) * 0.5 * Math.min(1, (st.hi - st.lo) / 6 + 0.2);
        const h00 = h(x0, z0);
        const h10 = h(x1, z0);
        const h11 = h(x1, z1);
        const h01 = h(x0, z1);
        const c = cc.clone().multiplyScalar(0.8 + hash2(i, j, 4) * 0.4);
        M.quad([x0, h01, z1], [x1, h11, z1], [x1, h10, z0], [x0, h00, z0], 0, -1, 0, c, [x0 / 3, z1 / 3, x1 / 3, z1 / 3, x1 / 3, z0 / 3, x0 / 3, z0 / 3].map((v) => v), [0.7, 0.7, 0.7, 0.7]);
      }
    }
  }
  return { dist, ceilAt };
}
