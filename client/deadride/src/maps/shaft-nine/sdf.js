// Signed-distance cavity modelling for Shaft Nine: caves, drifts and chambers are described as unions of air shapes minus
// solid pillars, sampled on a grid (coarse pass skips empty space) and polygonised with naive surface nets. The result is a
// continuous rock shell with smooth normals (gradient of the field), plus analytic wall colliders extracted from the same field.
//   air value a(x,y,z):  > 0 in open air, < 0 inside rock, 0 on the surface (approximately a distance).
import * as THREE from 'three';
import { noise3 } from '../../core/util.js';

const sqrt = Math.sqrt, abs = Math.abs, mx = Math.max, mn = Math.min;
export const smax = (a, b, k) => { if (k <= 0) return a > b ? a : b; const h = mx(k - abs(a - b), 0) / k; return mx(a, b) + h * h * k * 0.25; };
export const smin = (a, b, k) => { if (k <= 0) return a < b ? a : b; const h = mx(k - abs(a - b), 0) / k; return mn(a, b) - h * h * k * 0.25; };

// ---------------------------------------------------------------- shapes: {f(x,y,z) -> signed distance (<0 inside), bb:[x0,y0,z0,x1,y1,z1]}
export const shape = {
  /** axis-aligned rounded box centred at (cx,cy,cz) with half extents (hx,hy,hz), corner radius r */
  box(cx, cy, cz, hx, hy, hz, r = 0) {
    return { f: (x, y, z) => { const qx = abs(x - cx) - hx + r, qy = abs(y - cy) - hy + r, qz = abs(z - cz) - hz + r; const ox = mx(qx, 0), oy = mx(qy, 0), oz = mx(qz, 0); return sqrt(ox * ox + oy * oy + oz * oz) + mn(mx(qx, mx(qy, qz)), 0) - r; }, bb: [cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz] };
  },
  /** box rotated by yaw about Y (same yaw convention as Builder: local +x -> (cos, 0, -sin)) */
  obox(cx, cy, cz, hx, hy, hz, yaw = 0, r = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw), e = abs(c) * hx + abs(s) * hz, e2 = abs(s) * hx + abs(c) * hz;
    return { f: (x, y, z) => { const dx = x - cx, dz = z - cz; const lx = dx * c + dz * s, lz = -dx * s + dz * c; const qx = abs(lx) - hx + r, qy = abs(y - cy) - hy + r, qz = abs(lz) - hz + r; const ox = mx(qx, 0), oy = mx(qy, 0), oz = mx(qz, 0); return sqrt(ox * ox + oy * oy + oz * oz) + mn(mx(qx, mx(qy, qz)), 0) - r; }, bb: [cx - e, cy - hy, cz - e2, cx + e, cy + hy, cz + e2] };
  },
  /** capsule (round tunnel) between points a and b with radius r */
  cap(ax, ay, az, bx, by, bz, r) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz || 1;
    return { f: (x, y, z) => { const px = x - ax, py = y - ay, pz = z - az; let t = (px * dx + py * dy + pz * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t; return sqrt(qx * qx + qy * qy + qz * qz) - r; }, bb: [mn(ax, bx) - r, mn(ay, by) - r, mn(az, bz) - r, mx(ax, bx) + r, mx(ay, by) + r, mx(az, bz) + r] };
  },
  /** ellipsoid (approximate distance) */
  ell(cx, cy, cz, rx, ry, rz) {
    const rm = mn(rx, ry, rz);
    return { f: (x, y, z) => { const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz; const k0 = sqrt(px * px + py * py + pz * pz); const qx = px / rx, qy = py / ry, qz = pz / rz; const k1 = sqrt(qx * qx + qy * qy + qz * qz) || 1e-6; return k0 * (k0 - 1) / k1; }, bb: [cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz], rm };
  },
  /** vertical cylinder with flat caps y0..y1 */
  cylY(cx, cz, r, y0, y1) {
    return { f: (x, y, z) => { const dx = x - cx, dz = z - cz; const d = sqrt(dx * dx + dz * dz) - r; const e = abs(y - (y0 + y1) / 2) - (y1 - y0) / 2; return mn(mx(d, e), 0) + sqrt(mx(d, 0) ** 2 + mx(e, 0) ** 2); }, bb: [cx - r, y0, cz - r, cx + r, y1, cz + r] };
  },
  /** vertical cone frustum (stalactite / stalagmite): radius r0 at y0, r1 at y1 */
  coneY(cx, cz, y0, y1, r0, r1) {
    const h = y1 - y0, rm = mx(r0, r1);
    return { f: (x, y, z) => { const dx = x - cx, dz = z - cz; const t = mn(mx((y - y0) / h, 0), 1); const rr = r0 + (r1 - r0) * t; const d = (sqrt(dx * dx + dz * dz) - rr) * 0.9; const e = mx(y0 - y, y - y1); return mx(d, e); }, bb: [cx - rm, y0, cz - rm, cx + rm, y1, cz + rm] };
  },
  /** horizontal cylinder along Z (arched roofs / round drifts) */
  cylZ(cx, cy, r, z0, z1) {
    return { f: (x, y, z) => { const dx = x - cx, dy = y - cy; const d = sqrt(dx * dx + dy * dy) - r; const e = abs(z - (z0 + z1) / 2) - (z1 - z0) / 2; return mn(mx(d, e), 0) + sqrt(mx(d, 0) ** 2 + mx(e, 0) ** 2); }, bb: [cx - r, cy - r, z0, cx + r, cy + r, z1] };
  },
  /** horizontal cylinder along X */
  cylX(cy, cz, r, x0, x1) {
    return { f: (x, y, z) => { const dy = y - cy, dz = z - cz; const d = sqrt(dy * dy + dz * dz) - r; const e = abs(x - (x0 + x1) / 2) - (x1 - x0) / 2; return mn(mx(d, e), 0) + sqrt(mx(d, 0) ** 2 + mx(e, 0) ** 2); }, bb: [x0, cy - r, cz - r, x1, cy + r, cz + r] };
  },
  /** arbitrary function shape with explicit bbox */
  fn(f, bb) { return { f, bb }; },
};

// ---------------------------------------------------------------- grid field
export class GridSDF {
  constructor(F, nx, ny, nz, ox, oy, oz, h) { this.F = F; this.nx = nx; this.ny = ny; this.nz = nz; this.ox = ox; this.oy = oy; this.oz = oz; this.h = h; this.sample = this.sample.bind(this); }
  /** trilinear sample (clamped to the grid) */
  sample(x, y, z) {
    const { F, nx, ny, nz, h } = this; let fx = (x - this.ox) / h, fy = (y - this.oy) / h, fz = (z - this.oz) / h;
    fx = fx < 0 ? 0 : fx > nx - 1.001 ? nx - 1.001 : fx; fy = fy < 0 ? 0 : fy > ny - 1.001 ? ny - 1.001 : fy; fz = fz < 0 ? 0 : fz > nz - 1.001 ? nz - 1.001 : fz;
    const i = fx | 0, j = fy | 0, k = fz | 0, tx = fx - i, ty = fy - j, tz = fz - k, b = i + nx * (j + ny * k), sy = nx, sz = nx * ny;
    const a0 = F[b] + (F[b + 1] - F[b]) * tx, a1 = F[b + sy] + (F[b + sy + 1] - F[b + sy]) * tx, a2 = F[b + sz] + (F[b + sz + 1] - F[b + sz]) * tx, a3 = F[b + sy + sz] + (F[b + sy + sz + 1] - F[b + sy + sz]) * tx;
    const c0 = a0 + (a1 - a0) * ty, c1 = a2 + (a3 - a2) * ty; return c0 + (c1 - c0) * tz;
  }
}

// ---------------------------------------------------------------- cavity
export class Cavity {
  /** opts.noise: [{f:[fx,fy,fz]|number, a: amplitude(m), seed}] rock roughness applied near the surface; opts.fade: distance over which noise fades */
  constructor(opts = {}) {
    this.ops = []; this.lates = []; this.noise = (opts.noise || []).map((n, i) => ({ f: Array.isArray(n.f) ? n.f : [n.f, n.f, n.f], a: n.a, s: (n.seed ?? i) * 17.31 + 3.7, ridged: !!n.ridged }));
    this.noiseMax = this.noise.reduce((s, n) => s + n.a, 0); this.fade = opts.fade ?? 3.0; this.grid = null; this.noiseMul = opts.noiseMul || null;
  }
  air(sh, k = 0) { this.ops.push({ t: 0, k, ...sh }); return this; }
  solid(sh, k = 0) { this.ops.push({ t: 1, k, ...sh }); return this; }
  /** applied after the noise: fn(x,y,z,a) -> a'. Use for flat floors/ceilings: (x,y,z,a)=>Math.min(a, y - 0) */
  late(fn) { this.lates.push(fn); return this; }
  /** heightfield floor: fn(x,z) -> floor height (rock below). Evaluated once per grid column during bake(); return -1e9 where no floor applies. */
  floor2D(fn) { this.floorFn = fn; return this; }
  _base(x, y, z, list) {
    let a = -40; const ops = this.ops;
    for (let q = 0, n = list ? list.length : ops.length; q < n; q++) {
      const o = list ? ops[list[q]] : ops[q]; const b = o.bb; const dx = x < b[0] ? b[0] - x : x > b[3] ? x - b[3] : 0, dy = y < b[1] ? b[1] - y : y > b[4] ? y - b[4] : 0, dz = z < b[2] ? b[2] - z : z > b[5] ? z - b[5] : 0; const bd = sqrt(dx * dx + dy * dy + dz * dz);
      if (o.t === 0) { if (bd > 40) continue; const d = o.f(x, y, z); a = smax(a, -d, o.k); } else { if (bd > mx(a, 0) + o.k + 0.01) continue; const d = o.f(x, y, z); a = smin(a, d, o.k); }   // an op only matters if its bbox can beat the running union value
    }
    return a;
  }
  eval(x, y, z, fh, list) {
    let a = this._base(x, y, z, list);
    if (this.noise.length && abs(a) < this.fade) {
      let n = 0; for (const q of this.noise) { const v = noise3(x * q.f[0] + q.s, y * q.f[1] + q.s * 0.7, z * q.f[2] - q.s); n += q.a * (q.ridged ? 1 - 2 * abs(v) - 0.3 : v); }   // ridged octaves crease the rock along fracture lines
      const w = 1 - abs(a) / this.fade; a += n * w * (0.4 + 0.6 * w) * (this.noiseMul ? this.noiseMul(x, y, z) : 1);
    }
    for (const L of this.lates) a = L(x, y, z, a);
    if (this.floorFn) { const h = fh !== undefined ? fh : this.floorFn(x, z); if (y - h < a) a = y - h; }
    return a;
  }
  /** Sample the field on a grid over [min,max] with spacing h. Coarse blocks far from the surface are interpolated, not evaluated. */
  bake(min, max, h) {
    const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1; const F = new Float32Array(nx * ny * nz);
    const c = 4, cnx = Math.ceil((nx - 1) / c) + 2, cny = Math.ceil((ny - 1) / c) + 2, cnz = Math.ceil((nz - 1) / c) + 2, C = new Float32Array(cnx * cny * cnz);
    // per-block op lists: only ops whose bbox is within reach of the block can change the field near the surface (solids 4 m + k, air 6 m + k)
    const bs = c * h, lists = new Array(cnx * cny * cnz); for (let i = 0; i < lists.length; i++) lists[i] = [];
    this.ops.forEach((o, oi) => { const b = o.bb, R = (o.t === 0 ? 6 : 4) + o.k; const i0 = mx(0, Math.floor((b[0] - R - min[0]) / bs)), i1 = mn(cnx - 1, Math.floor((b[3] + R - min[0]) / bs)), j0 = mx(0, Math.floor((b[1] - R - min[1]) / bs)), j1 = mn(cny - 1, Math.floor((b[4] + R - min[1]) / bs)), k0 = mx(0, Math.floor((b[2] - R - min[2]) / bs)), k1 = mn(cnz - 1, Math.floor((b[5] + R - min[2]) / bs));
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[i + cnx * (j + cny * k)].push(oi); });
    if (this.noCull) for (let i = 0; i < lists.length; i++) lists[i] = undefined;   // debug / safety: evaluate every op everywhere
    const HC = new Float32Array(nx * nz).fill(NaN);
    for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) { const x = min[0] + i * c * h, y = min[1] + j * c * h, z = min[2] + k * c * h; C[i + cnx * (j + cny * k)] = this.eval(x, y, z, undefined, lists[i + cnx * (j + cny * k)]); }
    const margin = c * h * 1.8 + this.noiseMax + 0.6; const near = new Uint8Array((cnx - 1) * (cny - 1) * (cnz - 1));
    for (let k = 0; k < cnz - 1; k++) for (let j = 0; j < cny - 1; j++) for (let i = 0; i < cnx - 1; i++) { let m = 1e9; for (let q = 0; q < 8; q++) m = mn(m, abs(C[(i + (q & 1)) + cnx * ((j + ((q >> 1) & 1)) + cny * (k + (q >> 2)))])); near[i + (cnx - 1) * (j + (cny - 1) * k)] = m < margin ? 1 : 0; }
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const ci = (i / c) | 0, cj = (j / c) | 0, ck = (k / c) | 0;
      if (near[ci + (cnx - 1) * (cj + (cny - 1) * ck)]) { let fh; if (this.floorFn) { fh = HC[i + nx * k]; if (fh !== fh) fh = HC[i + nx * k] = this.floorFn(min[0] + i * h, min[2] + k * h); } F[i + nx * (j + ny * k)] = this.eval(min[0] + i * h, min[1] + j * h, min[2] + k * h, fh, lists[ci + cnx * (cj + cny * ck)]); }
      else { const fx = i / c - ci, fy = j / c - cj, fz = k / c - ck, b = (q) => C[(ci + (q & 1)) + cnx * ((cj + ((q >> 1) & 1)) + cny * (ck + (q >> 2)))]; const x0 = b(0) + (b(1) - b(0)) * fx, x1 = b(2) + (b(3) - b(2)) * fx, x2 = b(4) + (b(5) - b(4)) * fx, x3 = b(6) + (b(7) - b(6)) * fx; const y0 = x0 + (x1 - x0) * fy, y1 = x2 + (x3 - x2) * fy; F[i + nx * (j + ny * k)] = y0 + (y1 - y0) * fz; }
    }
    return (this.grid = new GridSDF(F, nx, ny, nz, min[0], min[1], min[2], h));
  }
}

// ---------------------------------------------------------------- naive surface nets
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];
/** Polygonise the zero level set of a GridSDF. Returns {p: Float32Array, n: Float32Array, i: Uint32Array}; normals point into the air. */
export function surfaceNets(grid) {
  const { F, nx, ny, nz, ox, oy, oz, h } = grid; const cnx = nx - 1, cny = ny - 1, cnz = nz - 1; const cell = new Int32Array(cnx * cny * cnz).fill(-1);
  const P = [], N = [], I = []; let nv = 0; const cv = new Float32Array(8); const sx = 1, sy = nx, sz = nx * ny;
  const grad = (i, j, k, out) => { // central differences of the node (i,j,k)
    const i0 = mx(i - 1, 0), i1 = mn(i + 1, nx - 1), j0 = mx(j - 1, 0), j1 = mn(j + 1, ny - 1), k0 = mx(k - 1, 0), k1 = mn(k + 1, nz - 1);
    out[0] = (F[i1 + nx * (j + ny * k)] - F[i0 + nx * (j + ny * k)]) / ((i1 - i0) * h); out[1] = (F[i + nx * (j1 + ny * k)] - F[i + nx * (j0 + ny * k)]) / ((j1 - j0) * h); out[2] = (F[i + nx * (j + ny * k1)] - F[i + nx * (j + ny * k0)]) / ((k1 - k0) * h);
  };
  const g8 = new Float32Array(24), gt = [0, 0, 0];
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
    const base = i + nx * (j + ny * k); let mask = 0;
    for (let c = 0; c < 8; c++) { const v = F[base + CX[c] * sx + CY[c] * sy + CZ[c] * sz]; cv[c] = v; if (v > 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, cnt = 0;
    for (let e = 0; e < 12; e++) { const a = EDGES[e][0], b = EDGES[e][1]; const va = cv[a], vb = cv[b]; if ((va > 0) === (vb > 0)) continue; const t = va / (va - vb); px += CX[a] + (CX[b] - CX[a]) * t; py += CY[a] + (CY[b] - CY[a]) * t; pz += CZ[a] + (CZ[b] - CZ[a]) * t; cnt++; }
    px /= cnt; py /= cnt; pz /= cnt; P.push(ox + (i + px) * h, oy + (j + py) * h, oz + (k + pz) * h);
    // gradient: trilinear blend of the 8 corner gradients
    let gx = 0, gy = 0, gz = 0;
    for (let c = 0; c < 8; c++) { grad(i + CX[c], j + CY[c], k + CZ[c], gt); const w = (CX[c] ? px : 1 - px) * (CY[c] ? py : 1 - py) * (CZ[c] ? pz : 1 - pz); gx += gt[0] * w; gy += gt[1] * w; gz += gt[2] * w; }
    const gl = sqrt(gx * gx + gy * gy + gz * gz) || 1; N.push(gx / gl, gy / gl, gz / gl);
    cell[i + cnx * (j + cny * k)] = nv++;
  }
  const quad = (a, b, c, d, wantAir) => { // a..d cell vertex indices around an edge; orient so the face normal points toward wantAir (+1: along +axis is air)
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2]; const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nxx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nzz = ux * vy - uy * vx; const dot = nxx * (N[a * 3] + N[b * 3] + N[c * 3] + N[d * 3]) + nyy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1] + N[d * 3 + 1]) + nzz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2] + N[d * 3 + 2]);
    if (dot >= 0) I.push(a, b, c, a, c, d); else I.push(a, c, b, a, d, c);
  };
  const ci = (i, j, k) => cell[i + cnx * (j + cny * k)];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = F[i + nx * (j + ny * k)] > 0;
    if (i < cnx && j > 0 && k > 0 && j < cny + 0 && k < cnz + 0 && (F[i + 1 + nx * (j + ny * k)] > 0) !== v0) quad(ci(i, j - 1, k - 1), ci(i, j, k - 1), ci(i, j, k), ci(i, j - 1, k), v0);
    if (j < cny && i > 0 && k > 0 && (F[i + nx * (j + 1 + ny * k)] > 0) !== v0) quad(ci(i - 1, j, k - 1), ci(i, j, k - 1), ci(i, j, k), ci(i - 1, j, k), v0);
    if (k < cnz && i > 0 && j > 0 && (F[i + nx * (j + ny * (k + 1))] > 0) !== v0) quad(ci(i - 1, j - 1, k), ci(i, j - 1, k), ci(i, j, k), ci(i - 1, j, k), v0);
  }
  return { p: new Float32Array(P), n: new Float32Array(N), i: new Uint32Array(I) };
}

/** Compact a subset of triangles of a mesh into its own raw geometry {p,n,u,i} with metre UVs (box projection). */
export function subMesh(mesh, keepTri) {
  const { p, n, i } = mesh; const map = new Map(), P = [], N = [], U = [], I = [];
  for (let t = 0; t < i.length; t += 3) {
    if (!keepTri(i[t], i[t + 1], i[t + 2])) continue;
    for (let q = 0; q < 3; q++) {
      const v = i[t + q]; let m = map.get(v);
      if (m === undefined) { m = P.length / 3; map.set(v, m); P.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]); N.push(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]); const ax = abs(n[v * 3]), ay = abs(n[v * 3 + 1]), az = abs(n[v * 3 + 2]); if (ax >= ay && ax >= az) U.push(p[v * 3 + 2], p[v * 3 + 1]); else if (ay >= az) U.push(p[v * 3], p[v * 3 + 2]); else U.push(p[v * 3], p[v * 3 + 1]); }
      I.push(m);
    }
  }
  if (!P.length) return null;
  return { p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) };
}

/** Add the shell to a Builder. classify(nx,ny,nz,y) -> key of parts map; parts: {key: material}. opts.cast, opts.bake. Returns triangle count. */
export function addShell(B, mesh, parts, classify, opts = {}) {
  const { p, n } = mesh; const cls = (a, b, c) => classify((n[a * 3] + n[b * 3] + n[c * 3]) / 3, (n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1]) / 3, (n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]) / 3, (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3, (p[a * 3] + p[b * 3] + p[c * 3]) / 3, (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3);
  let tris = 0; const M = new THREE.Matrix4();
  for (const key of Object.keys(parts)) { const raw = subMesh(mesh, (a, b, c) => cls(a, b, c) === key); if (!raw) continue; tris += raw.i.length / 3; B.addRaw(raw, M, parts[key], { cast: opts.cast ?? false, recv: true, bake: opts.bake ?? true }); }
  return tris;
}

// ---------------------------------------------------------------- colliders from the field
/**
 * Rock-wall colliders. The field is sampled on an xz raster at several height bands above `floor(x,z)`; each band gets its own greedy-merged boxes,
 * so a bulge at head height never blocks the floor and a floor-level rock never closes a doorway. Only cells that border open air are kept (thin skin).
 * thr inflates the solid slightly so the player never clips into the visible rock. Bands are [lo, hi] metres above the floor; the first band starts at
 * the step height (0.45 m) because lower obstacles are walked over.
 */
export function shellColliders(B, grid, o = {}) {
  const { x0, x1, z0, z1, cell = 0.6, floor = () => 0, bands = [[0.45, 1.1], [1.1, 1.75], [1.75, 2.5]], thr = 0.2, surface = 'rock', skin = 2, exclude = null } = o;
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell); const nb = bands.length; const solid = new Uint8Array(nx * nz * nb), openAll = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell, f = floor(x, z); const ex = exclude && exclude(x, z);
    let allAir = true;
    for (let b = 0; b < nb; b++) { const [lo, hi] = bands[b]; const ys = [lo + (hi - lo) * 0.2, (lo + hi) / 2, lo + (hi - lo) * 0.8]; let s = 0; if (!ex) for (const y of ys) if (grid.sample(x, f + y, z) < thr) { s = 1; break; } solid[(i + nx * j) * nb + b] = s; if (s) allAir = false; }
    if (allAir) openAll[i + nx * j] = 1;
  }
  const near = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let ok = false; for (let dj = -skin; dj <= skin && !ok; dj++) for (let di = -skin; di <= skin; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue; if (openAll[a + nx * b]) { ok = true; break; } } near[i + nx * j] = ok ? 1 : 0; }
  let count = 0;
  for (let b = 0; b < nb; b++) {
    const used = new Uint8Array(nx * nz); const [lo, hi] = bands[b];
    const keep = (i, j) => solid[(i + nx * j) * nb + b] && near[i + nx * j];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!keep(i, j) || used[i + nx * j]) continue; let w = 1; while (i + w < nx && keep(i + w, j) && !used[i + w + nx * j]) w++;
      let h = 1; outer: while (j + h < nz) { for (let a = 0; a < w; a++) if (!keep(i + a, j + h) || used[i + a + nx * (j + h)]) break outer; h++; }
      for (let q = 0; q < h; q++) for (let a = 0; a < w; a++) used[i + a + nx * (j + q)] = 1;
      const cx = x0 + (i + w / 2) * cell, cz = z0 + (j + h / 2) * cell, f = floor(cx, cz);
      B.colliders.addBox({ x: cx, y: f + (lo + hi) / 2, z: cz, hx: w * cell / 2, hy: (hi - lo) / 2 + (b === nb - 1 ? 0.4 : 0), hz: h * cell / 2, yaw: 0, surface, walk: false }); count++;
    }
  }
  return count;
}
