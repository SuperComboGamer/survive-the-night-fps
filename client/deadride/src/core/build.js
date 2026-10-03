// World-building toolkit: real-scale primitives with metre UVs, chamfered edges, static batching (merged + spatially chunked),
// instancing, and automatic colliders. All units are metres, y is up. See docs/API.md.
import * as THREE from 'three';
import { Colliders } from './colliders.js';
import { visVariant } from './mats.js';
import { makeRng, noise3 } from './util.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
/** static batching granularity (m): larger cells = fewer draw calls (CPU-bound submission) at the cost of drawing a bit more off-screen geometry. ?cell=N overrides. */
export const BUILD = { cell: (typeof location !== 'undefined' && +new URLSearchParams(location.search).get('cell')) || 28 };

const V = new THREE.Vector3(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S1 = new THREE.Vector3(1, 1, 1);

// ------------------------------------------------------------------ raw geometry {p,n,u,i}
const rawCache = new Map();
function boxUV(px, py, pz, nx, ny, nz, swap, out) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  let u, v;
  if (ax >= ay && ax >= az) { u = -Math.sign(nx || 1) * pz; v = py; } else if (ay >= az) { u = px; v = -Math.sign(ny || 1) * pz; } else { u = Math.sign(nz || 1) * px; v = py; }
  if (swap) { const t = u; u = v; v = t; }
  out[0] = u; out[1] = v;
}
function finishRaw(P, N, I, swap) {
  const p = new Float32Array(P), n = new Float32Array(N), u = new Float32Array((P.length / 3) * 2), o = [0, 0];
  for (let k = 0; k < P.length / 3; k++) { boxUV(p[k * 3], p[k * 3 + 1], p[k * 3 + 2], n[k * 3], n[k * 3 + 1], n[k * 3 + 2], swap, o); u[k * 2] = o[0]; u[k * 2 + 1] = o[1]; }
  return { p, n, u, i: new Uint32Array(I) };
}
/** Box centred at origin. bevel>0 => chamfered edges (catches light like real machined/worn edges). */
export function boxRaw(w, h, d, bevel = 0, swap = false) {
  const key = `b${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${bevel.toFixed(3)},${swap ? 1 : 0}`;
  let r = rawCache.get(key); if (r) return r;
  const hx = w / 2, hy = h / 2, hz = d / 2; const P = [], N = [], I = [];
  const rr = Math.min(bevel, hx * 0.9, hy * 0.9, hz * 0.9);
  const quad = (a, b, c, e, n) => { // ensure ccw wrt n
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const base = P.length / 3; for (const q of [a, b, c, e]) { P.push(q[0], q[1], q[2]); N.push(n[0], n[1], n[2]); }
    if (!flip) I.push(base, base + 1, base + 2, base, base + 2, base + 3); else I.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const tri = (a, b, c, n) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const base = P.length / 3; for (const q of [a, b, c]) { P.push(q[0], q[1], q[2]); N.push(n[0], n[1], n[2]); }
    if (!flip) I.push(base, base + 1, base + 2); else I.push(base, base + 2, base + 1);
  };
  const ix = hx - rr, iy = hy - rr, iz = hz - rr;
  for (const s of [-1, 1]) {
    quad([s * hx, -iy, -iz], [s * hx, iy, -iz], [s * hx, iy, iz], [s * hx, -iy, iz], [s, 0, 0]);
    quad([-ix, s * hy, -iz], [ix, s * hy, -iz], [ix, s * hy, iz], [-ix, s * hy, iz], [0, s, 0]);
    quad([-ix, -iy, s * hz], [ix, -iy, s * hz], [ix, iy, s * hz], [-ix, iy, s * hz], [0, 0, s]);
  }
  if (rr > 0) {
    const k = Math.SQRT1_2;
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) quad([-ix, sy * hy, sz * iz], [ix, sy * hy, sz * iz], [ix, sy * iy, sz * hz], [-ix, sy * iy, sz * hz], [0, sy * k, sz * k]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) quad([sx * hx, -iy, sz * iz], [sx * hx, iy, sz * iz], [sx * ix, iy, sz * hz], [sx * ix, -iy, sz * hz], [sx * k, 0, sz * k]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) quad([sx * hx, sy * iy, -iz], [sx * hx, sy * iy, iz], [sx * ix, sy * hy, iz], [sx * ix, sy * hy, -iz], [sx * k, sy * k, 0]);
    const c = 1 / Math.sqrt(3);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) tri([sx * hx, sy * iy, sz * iz], [sx * ix, sy * hy, sz * iz], [sx * ix, sy * iy, sz * hz], [sx * c, sy * c, sz * c]);
  }
  r = finishRaw(P, N, I, swap); rawCache.set(key, r); return r;
}
/** Convert a THREE.BufferGeometry to raw with metre UVs. mode: 'cyl' (uv.x wraps around: metres = uv.x*circ), 'sph', 'keep', 'box' */
export function toRaw(g, mode = 'keep', a = 1, b = 1) {
  const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv; const n = pa.count;
  const p = new Float32Array(pa.array), nn = new Float32Array(na.array), u = new Float32Array(n * 2);
  if (mode === 'box') { const o = [0, 0]; for (let k = 0; k < n; k++) { boxUV(p[k * 3], p[k * 3 + 1], p[k * 3 + 2], nn[k * 3], nn[k * 3 + 1], nn[k * 3 + 2], false, o); u[k * 2] = o[0]; u[k * 2 + 1] = o[1]; } }
  else if (mode === 'cyl') { // a = circumference (m), b = height (m); caps use planar
    for (let k = 0; k < n; k++) { if (Math.abs(nn[k * 3 + 1]) > 0.8) { u[k * 2] = p[k * 3]; u[k * 2 + 1] = p[k * 3 + 2]; } else { u[k * 2] = ua.getX(k) * a; u[k * 2 + 1] = p[k * 3 + 1]; } } }
  else if (mode === 'sph') { for (let k = 0; k < n; k++) { u[k * 2] = ua.getX(k) * a; u[k * 2 + 1] = ua.getY(k) * b; } }
  else if (ua) for (let k = 0; k < n; k++) { u[k * 2] = ua.getX(k) * a; u[k * 2 + 1] = ua.getY(k) * b; }
  const idx = g.index ? new Uint32Array(g.index.array) : new Uint32Array(Array.from({ length: n }, (_, i) => i));
  return { p, n: nn, u, i: idx };
}

export function rawToGeometry(raw) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(raw.p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(raw.n, 3)); g.setAttribute('uv', new THREE.BufferAttribute(raw.u, 2)); g.setIndex(new THREE.BufferAttribute(raw.i, 1)); g.computeBoundingSphere(); return g;
}
/** Lumpy rock / heap: deformed icosphere with smooth normals. Use with triplanar materials. */
export function rockRaw(r = 1, detail = 3, amp = 0.35, seed = 1, squash = [1, 1, 1], freq = 1.4) {
  let g = new THREE.IcosahedronGeometry(r, detail); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-4);
  const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const d = v.clone().normalize(); const n = noise3(d.x * freq + seed * 3.1, d.y * freq + seed, d.z * freq - seed * 1.7) * 0.6 + noise3(d.x * freq * 2.7 + seed, d.y * freq * 2.7, d.z * freq * 2.7) * 0.28 + noise3(d.x * freq * 6.3, d.y * freq * 6.3 + seed, d.z * freq * 6.3) * 0.12; v.copy(d).multiplyScalar(r * (1 + n * amp)); v.x *= squash[0]; v.y *= squash[1]; v.z *= squash[2]; p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); const nn = g.attributes.normal; const uv = new Float32Array(p.count * 2); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const raw = { p: new Float32Array(g.attributes.position.array), n: new Float32Array(nn.array), u: uv, i: new Uint32Array(g.index.array) };
  const o = [0, 0]; for (let k = 0; k < p.count; k++) { boxUV(raw.p[k * 3], raw.p[k * 3 + 1], raw.p[k * 3 + 2], raw.n[k * 3], raw.n[k * 3 + 1], raw.n[k * 3 + 2], false, o); raw.u[k * 2] = o[0]; raw.u[k * 2 + 1] = o[1]; }
  g.dispose(); return raw;
}
/** Triangular prism (gable roof): base w (x, ridge direction) x d (z), ridge height h; centred on x,z at y=0. */
export function prismRaw(w, h, d) {
  const hx = w / 2, hz = d / 2, P = [], N = [], U = [], I = []; const sl = Math.hypot(h, hz), ny = hz / sl, nz = h / sl;
  const quad = (a, b, c, e, n, ua, ub, uc, ud) => { const base = P.length / 3; for (const q of [a, b, c, e]) P.push(...q); for (let i = 0; i < 4; i++) N.push(...n); U.push(...ua, ...ub, ...uc, ...ud); I.push(base, base + 1, base + 2, base, base + 2, base + 3); };
  quad([-hx, 0, hz], [hx, 0, hz], [hx, h, 0], [-hx, h, 0], [0, ny, nz], [0, 0], [w, 0], [w, sl], [0, sl]);                  // +z slope
  quad([hx, 0, -hz], [-hx, 0, -hz], [-hx, h, 0], [hx, h, 0], [0, ny, -nz], [0, 0], [w, 0], [w, sl], [0, sl]);              // -z slope
  const tri = (a, b, c, n, ua, ub, uc) => { const base = P.length / 3; for (const q of [a, b, c]) P.push(...q); for (let i = 0; i < 3; i++) N.push(...n); U.push(...ua, ...ub, ...uc); I.push(base, base + 1, base + 2); };
  tri([hx, 0, hz], [hx, 0, -hz], [hx, h, 0], [1, 0, 0], [hz, 0], [-hz, 0], [0, h]); tri([-hx, 0, -hz], [-hx, 0, hz], [-hx, h, 0], [-1, 0, 0], [-hz, 0], [hz, 0], [0, h]);
  quad([-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz], [0, -1, 0], [0, 0], [w, 0], [w, d], [0, d]);
  return { p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) };
}

// ------------------------------------------------------------------ baked sky visibility (horizon scan against collision geometry)
export class SkyVis {
  constructor(col, { cell = 1, R = 26 } = {}) {
    this.col = col; this.cell = cell; this.R = R; const b = col.bounds; if (!(b.maxX > b.minX)) { this.ok = false; return; } this.ok = true;
    this.x0 = b.minX - R; this.z0 = b.minZ - R; this.w = Math.ceil((b.maxX - b.minX + 2 * R) / cell); this.h = Math.ceil((b.maxZ - b.minZ + 2 * R) / cell); if (this.w * this.h > 4e6) { this.ok = false; return; }
    const H = this.H = new Float32Array(this.w * this.h).fill(-1e9);
    for (const c of col.boxes) { if (c.y1 - c.y0 < 0.05) continue; const i0 = Math.max(0, Math.floor((c.minX - this.x0) / cell)), i1 = Math.min(this.w - 1, Math.floor((c.maxX - this.x0) / cell)), j0 = Math.max(0, Math.floor((c.minZ - this.z0) / cell)), j1 = Math.min(this.h - 1, Math.floor((c.maxZ - this.z0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = this.x0 + (i + 0.5) * cell, z = this.z0 + (j + 0.5) * cell; const dx = x - c.x, dz = z - c.z, lx = dx * c.c + dz * c.s, lz = -dx * c.s + dz * c.c; if (Math.abs(lx) <= c.hx + cell * 0.5 && Math.abs(lz) <= c.hz + cell * 0.5) { const k = j * this.w + i; if (c.y1 > H[k]) H[k] = c.y1; } } }
    for (const c of col.cyls) { const i0 = Math.max(0, Math.floor((c.minX - this.x0) / cell)), i1 = Math.min(this.w - 1, Math.floor((c.maxX - this.x0) / cell)), j0 = Math.max(0, Math.floor((c.minZ - this.z0) / cell)), j1 = Math.min(this.h - 1, Math.floor((c.maxZ - this.z0) / cell)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = this.x0 + (i + 0.5) * cell, z = this.z0 + (j + 0.5) * cell; if ((x - c.x) ** 2 + (z - c.z) ** 2 <= (c.r + cell * 0.5) ** 2) { const k = j * this.w + i; if (c.y1 > H[k]) H[k] = c.y1; } } }
  }
  /** terrain height lazily cached on the SkyVis grid (bilinear): a raw heightFn (fbm terrain) was costing ~40 s per stop through the 56 horizon samples per vertex */
  _g(i, j) { const G = this.G || (this.G = new Float32Array(this.w * this.h).fill(NaN)); const k = j * this.w + i; let v = G[k]; if (v !== v) v = G[k] = this.col.heightFn(this.x0 + (i + 0.5) * this.cell, this.z0 + (j + 0.5) * this.cell); return v; }
  _hf(x, z) {
    const fx = (x - this.x0) / this.cell - 0.5, fz = (z - this.z0) / this.cell - 0.5, i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i + 1 >= this.w || j + 1 >= this.h) return this.col.heightFn(x, z);
    const tx = fx - i, tz = fz - j; return (this._g(i, j) * (1 - tx) + this._g(i + 1, j) * tx) * (1 - tz) + (this._g(i, j + 1) * (1 - tx) + this._g(i + 1, j + 1) * tx) * tz;
  }
  top(x, z) { let g = this.col.heightFn ? this._hf(x, z) : this.col.groundY; const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell); if (i >= 0 && j >= 0 && i < this.w && j < this.h) { const v = this.H[j * this.w + i]; if (v > g) g = v; } return g; }
  /** sky visibility 0..1 for a surface point p with normal n (offset outward before sampling) */
  at(px, py, pz, nx, ny, nz) {
    const ox = px + nx * 0.25, oy = py + ny * 0.25 + 0.05, oz = pz + nz * 0.25;
    // roof test: anything solid directly above (not part of this surface) => covered
    const above = this.top(ox, oz); let roof = 0; if (above > oy + 0.4 && this.hasRoof(ox, oy, oz)) roof = 1;
    let occ = 0; const N = 8;
    for (let k = 0; k < N; k++) { const a = k / N * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a); let m = 0; for (let r = 1.2; r <= this.R; r *= 1.55) { const h = this.top(ox + dx * r, oz + dz * r) - oy; if (h > 0) { const e = h / Math.hypot(h, r); if (e > m) m = e; } } occ += m; }
    let vis = 1 - (occ / N) * 1.15; const hem = 0.55 + 0.45 * Math.max(-0.2, ny); vis = Math.max(0.03, Math.min(1, vis)) * Math.min(1, hem * 1.1);
    return roof ? vis * 0.06 : vis;
  }
  hasRoof(x, y, z) { // is there a collider whose footprint covers (x,z) with bottom above y ?
    const list = this._l || (this._l = []); this.col._cellList(x - 0.01, x + 0.01, z - 0.01, z + 0.01, list);
    for (const c of list) { if (c.y0 <= y + 0.3 || c.y1 - c.y0 < 0.02) continue; if (c.type === 0) { const dx = x - c.x, dz = z - c.z, lx = dx * c.c + dz * c.s, lz = -dx * c.s + dz * c.c; if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) return true; } else if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r) return true; }
    return false;
  }
}

// ------------------------------------------------------------------ static batch (merged geometry, chunked for frustum culling)
/** Layer used by depth-only shadow proxy meshes: seen by shadow cameras only (gfx enables it on every shadow camera). */
export const SHADOW_LAYER = 5;
const proxySafe = (mat) => !mat.transparent && !mat.alphaTest && !mat.alphaMap && !(mat.userData.patchOpts && (mat.userData.patchOpts.wind || mat.userData.patchOpts.vertex)) && mat.side !== THREE.BackSide;
let _proxyMat = null; const proxyMaterial = () => _proxyMat || (_proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
export class StaticBatch {
  constructor(parent, { cell = BUILD.cell, cellY = 60 } = {}) { this.parent = parent; this.cell = cell; this.cellY = cellY; this.map = new Map(); this.meshes = []; this.proxies = new Map(); this.proxy = true; }
  _proxyAdd(raw, e, ne, cx, cy, cz, dbl) {
    const key = `${cx},${cy},${cz}|${dbl ? 2 : 1}`; let a = this.proxies.get(key); if (!a) { a = { P: [], I: [], nv: 0, dbl }; this.proxies.set(key, a); }
    const n = raw.p.length / 3, base = a.nv;
    for (let k = 0; k < n; k++) { const x = raw.p[k * 3], y = raw.p[k * 3 + 1], z = raw.p[k * 3 + 2]; a.P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]); }
    for (let k = 0; k < raw.i.length; k++) a.I.push(raw.i[k] + base); a.nv += n;
  }
  _proxyFinish() {
    for (const a of this.proxies.values()) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a.P, 3)); g.setIndex(a.nv > 65535 ? new THREE.Uint32BufferAttribute(a.I, 1) : new THREE.Uint16BufferAttribute(a.I, 1)); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, proxyMaterial()); m.castShadow = true; m.receiveShadow = false; m.layers.set(SHADOW_LAYER); m.matrixAutoUpdate = false; m.name = 'shadowProxy'; m.userData.shadowProxy = true; this.parent.add(m); this.meshes.push(m);
    }
    this.proxies.clear();
  }
  /** add raw geometry transformed by matrix (THREE.Matrix4) */
  add(raw, matrix, mat, { cast = true, recv = true } = {}) {
    const nrm = new THREE.Matrix3().getNormalMatrix(matrix); const e = matrix.elements; const ne = nrm.elements;
    const cx = Math.floor(e[12] / this.cell), cy = Math.floor(e[13] / this.cellY), cz = Math.floor(e[14] / this.cell);
    if (cast && this.proxy && proxySafe(mat)) { this._proxyAdd(raw, e, ne, cx, cy, cz, mat.side === THREE.DoubleSide); cast = false; } // shadow comes from the merged depth-only proxy
    const key = `${mat.uuid}|${cast ? 1 : 0}${recv ? 1 : 0}|${cx},${cy},${cz}`;
    let a = this.map.get(key); if (!a) { a = { mat, cast, recv, P: [], N: [], U: [], I: [], nv: 0 }; this.map.set(key, a); }
    const n = raw.p.length / 3, base = a.nv;
    for (let k = 0; k < n; k++) {
      const x = raw.p[k * 3], y = raw.p[k * 3 + 1], z = raw.p[k * 3 + 2];
      a.P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      const nx = raw.n[k * 3], ny = raw.n[k * 3 + 1], nz = raw.n[k * 3 + 2];
      let tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz; const l = Math.hypot(tx, ty, tz) || 1;
      a.N.push(tx / l, ty / l, tz / l); a.U.push(raw.u[k * 2], raw.u[k * 2 + 1]);
    }
    for (let k = 0; k < raw.i.length; k++) a.I.push(raw.i[k] + base);
    a.nv += n;
  }
  finish(visFn = null) {
    for (const a of this.map.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(a.N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(a.U, 2));
      g.setIndex(a.nv > 65535 ? new THREE.Uint32BufferAttribute(a.I, 1) : new THREE.Uint16BufferAttribute(a.I, 1));
      if (visFn) { const nv = a.nv, va = new Uint8Array(nv * 2); for (let i = 0; i < nv; i++) { const v = visFn(a.P[i * 3], a.P[i * 3 + 1], a.P[i * 3 + 2], a.N[i * 3], a.N[i * 3 + 1], a.N[i * 3 + 2]); va[i * 2] = 255; va[i * 2 + 1] = Math.round(v * 255); } g.setAttribute('aVis', new THREE.BufferAttribute(va, 2, true)); }
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, visFn ? visVariant(a.mat) : a.mat); m.castShadow = a.cast; m.receiveShadow = a.recv; m.matrixAutoUpdate = false; m.updateMatrix();
      this.parent.add(m); this.meshes.push(m);
    }
    this._proxyFinish(); this.map.clear(); return this.meshes;
  }
}

// ------------------------------------------------------------------ instancer (chunked)
export class Instancer {
  constructor(parent, { cell = BUILD.cell } = {}) { this.parent = parent; this.cell = cell; this.groups = new Map(); this.meshes = []; }
  /** geo: THREE.BufferGeometry (shared), mat: material. Returns nothing. */
  add(key, geo, mat, matrix, color = null, { cast = true, recv = true } = {}) {
    const e = matrix.elements; const k = `${key}|${Math.floor(e[12] / this.cell)},${Math.floor(e[13] / 60)},${Math.floor(e[14] / this.cell)}`;
    let g = this.groups.get(k); if (!g) { g = { geo, mat, cast, recv, m: [], c: [] }; this.groups.set(k, g); }
    g.m.push(matrix.clone()); g.c.push(color);
  }
  /** batch (optional): opaque casting instances are baked into its shadow proxy instead of being drawn again as instanced casters */
  finish(batch = null) {
    for (const g of this.groups.values()) {
      let cast = g.cast;
      if (cast && batch && batch.proxy && proxySafe(g.mat) && g.geo.attributes.position) {
        const pos = g.geo.attributes.position.array; const idx = g.geo.index ? g.geo.index.array : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i); const rawLike = { p: pos, i: idx };
        for (const m of g.m) { const e = m.elements; batch._proxyAdd(rawLike, e, null, Math.floor(e[12] / batch.cell), Math.floor(e[13] / batch.cellY), Math.floor(e[14] / batch.cell), g.mat.side === THREE.DoubleSide); }
        cast = false;
      }
      const im = new THREE.InstancedMesh(g.geo, g.mat, g.m.length);
      const hasC = g.c.some((c) => c !== null); const col = new THREE.Color();
      g.m.forEach((m, i) => { im.setMatrixAt(i, m); if (hasC) { col.set(g.c[i] ?? 0xffffff); im.setColorAt(i, col); } });
      im.instanceMatrix.needsUpdate = true; im.castShadow = cast; im.receiveShadow = g.recv; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.updateMatrix();
      this.parent.add(im); this.meshes.push(im);
    }
    this.groups.clear(); return this.meshes;
  }
}

// ------------------------------------------------------------------ Builder
/**
 * Builder wraps a stop's group + colliders + material cache.
 *   const B = new Builder({ synth, group, seed });
 *   B.m('wood', {pattern:'planks',...}, {triplanar:false})   // named material (synth-baked, cached)
 *   B.box({ p:[x,y,z], s:[w,h,d], yaw, mat:'wood', bevel:.02, col:'wood' })   // p = centre of the BASE (y = bottom); s = size
 * Every solid call: col: surface string => registers a collider (omit/false for decoration). walk:false => cannot be stood upon.
 */
export class Builder {
  constructor({ synth, group, seed = 1, cell = BUILD.cell }) {
    this.synth = synth; this.group = group; this.rng = makeRng(seed); this.mats = new Map(); this.colliders = new Colliders();
    this.batch = new StaticBatch(group, { cell }); this.inst = new Instancer(group, { cell }); this.lights = []; this.dyn = [];
    this.geoCache = new Map();
  }
  // ---- materials
  m(name, def, extra) { let m = this.mats.get(name); if (!m) { m = def && def.isMaterial ? def : this.synth.material(def, extra); m.name = name; this.mats.set(name, m); } return m; }
  mat(x) { return typeof x === 'string' ? this.mats.get(x) : x; }
  // ---- generic
  _mat4(p, yaw = 0, pitch = 0, roll = 0, scale = null) { E.set(pitch, yaw, roll, 'YXZ'); Q.setFromEuler(E); return M4.compose(V.set(p[0], p[1], p[2]), Q, scale || S1).clone(); }
  addRaw(raw, matrix, mat, opt) { this.batch.add(raw, matrix, this.mat(mat), opt); }
  _col(o, cx, cy, cz, hx, hy, hz, yaw) {
    if (!o.col) return null; const surface = typeof o.col === 'string' ? o.col : 'concrete';
    return this.colliders.addBox({ x: cx, y: cy, z: cz, hx, hy, hz, yaw, surface, walk: o.walk !== false, solid: o.solid !== false, tag: o.tag });
  }
  /** Box. p = base centre, s = [w,h,d], yaw about y. anchor:'center' => p is the box centre. */
  box(o) {
    const [w, h, d] = o.s, p = o.p; const cy = o.anchor === 'center' ? p[1] : p[1] + h / 2;
    const raw = boxRaw(w, h, d, o.bevel ?? Math.min(0.03, Math.min(w, h, d) * 0.2), !!o.swap);
    const m = this._mat4([p[0], cy, p[2]], o.yaw || 0, o.pitch || 0, o.roll || 0); this.addRaw(raw, m, o.mat, o);
    return this._col(o, p[0], cy, p[2], w / 2, h / 2, d / 2, o.yaw || 0);
  }
  /** Box between two points (beam/plank/rail). w,h cross-section; roll rotates about its axis. Collider only if o.col (axis-aligned yaw-only approximation). */
  beam(a, b, w, h, o) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); const raw = boxRaw(L, h, w, o.bevel ?? Math.min(0.02, h * 0.15, w * 0.15), o.swap === undefined ? false : o.swap);
    const yaw = Math.atan2(-dz, dx), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    E.set(0, yaw, pitch, 'YZX'); Q.setFromEuler(E); const m = M4.compose(V.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), Q, S1).clone(); this.addRaw(raw, m, o.mat, o);
    if (o.col) { const flat = Math.abs(dy) < 0.05 * L; if (flat) this.colliders.addBox({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2, hx: L / 2, hy: h / 2, hz: w / 2, yaw, surface: typeof o.col === 'string' ? o.col : 'wood', walk: o.walk !== false }); }
  }
  /** Cylinder / cone frustum. p = base centre. r or [rBottom,rTop]. seg default 16. */
  cyl(o) {
    const rb = Array.isArray(o.r) ? o.r[0] : o.r, rt = Array.isArray(o.r) ? o.r[1] : o.r, h = o.h, seg = o.seg || 16;
    const key = `c${rb.toFixed(3)},${rt.toFixed(3)},${h.toFixed(3)},${seg},${o.open ? 1 : 0}`; let raw = this.geoCache.get(key);
    if (!raw) { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!o.open); raw = toRaw(g, 'cyl', Math.PI * (rb + rt), h); g.dispose(); this.geoCache.set(key, raw); }
    const p = o.p; const m = this._mat4([p[0], o.anchor === 'center' ? p[1] : p[1] + h / 2, p[2]], o.yaw || 0, o.pitch || 0, o.roll || 0); this.addRaw(raw, m, o.mat, o);
    if (o.col && !o.pitch && !o.roll) return this.colliders.addCyl({ x: p[0], z: p[2], r: Math.max(rb, rt), y0: p[1], y1: p[1] + h, surface: typeof o.col === 'string' ? o.col : 'metal', walk: o.walk !== false, solid: o.solid !== false, tag: o.tag });
    return null;
  }
  sphere(o) { // r, p = centre
    const key = `s${o.r.toFixed(3)},${o.seg || 16},${(o.hs || 0)},${(o.ps || 1)}`; let raw = this.geoCache.get(key);
    if (!raw) { const g = new THREE.SphereGeometry(o.r, o.seg || 16, Math.max(6, (o.seg || 16) >> 1), 0, Math.PI * 2, 0, Math.PI * (o.ps || 1)); raw = toRaw(g, 'sph', 2 * Math.PI * o.r, Math.PI * o.r); g.dispose(); this.geoCache.set(key, raw); }
    const m = this._mat4(o.p, o.yaw || 0, o.pitch || 0, o.roll || 0, o.scale ? V.set(...o.scale).clone() : null); this.addRaw(raw, m, o.mat, o);
    if (o.col) this.colliders.addCyl({ x: o.p[0], z: o.p[2], r: o.r * (o.scale ? o.scale[0] : 1), y0: o.p[1] - o.r, y1: o.p[1] + o.r, surface: typeof o.col === 'string' ? o.col : 'rock' });
  }
  /** Lathe: profile = [[radius, y],...] from bottom to top; p = base centre. */
  lathe(o) {
    const seg = o.seg || 24; const pts = o.profile.map(([r, y]) => new THREE.Vector2(r, y)); const g = new THREE.LatheGeometry(pts, seg); const rmax = Math.max(...o.profile.map((q) => q[0])); const hmax = o.profile[o.profile.length - 1][1];
    const raw = toRaw(g, 'sph', 2 * Math.PI * rmax, hmax * 1.0); g.dispose(); const m = this._mat4(o.p, o.yaw || 0); this.addRaw(raw, m, o.mat, o);
    if (o.col) this.colliders.addCyl({ x: o.p[0], z: o.p[2], r: rmax, y0: o.p[1], y1: o.p[1] + hmax, surface: typeof o.col === 'string' ? o.col : 'concrete' });
  }
  /** Extrude a 2D polygon [[x,z]...] (in the xz plane) by height h upward. p = origin. */
  extrude(o) {
    const shape = new THREE.Shape(o.poly.map(([x, z]) => new THREE.Vector2(x, -z))); const g = new THREE.ExtrudeGeometry(shape, { depth: o.h, bevelEnabled: !!o.bevel, bevelSize: o.bevel || 0, bevelThickness: o.bevel || 0, bevelSegments: 1, curveSegments: 6 });
    g.rotateX(-Math.PI / 2); g.computeVertexNormals(); const raw = toRaw(g, 'box'); g.dispose(); const m = this._mat4(o.p, o.yaw || 0); this.addRaw(raw, m, o.mat, o);
    if (o.col) { let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; for (const [x, z] of o.poly) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); } const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0); const lx = (minx + maxx) / 2, lz = (minz + maxz) / 2; this.colliders.addBox({ x: o.p[0] + lx * c + lz * s, y: o.p[1] + o.h / 2, z: o.p[2] - lx * s + lz * c, hx: (maxx - minx) / 2, hy: o.h / 2, hz: (maxz - minz) / 2, yaw: o.yaw || 0, surface: typeof o.col === 'string' ? o.col : 'concrete' }); }
  }
  /** Tube along a polyline/curve. pts [[x,y,z]...], r radius (or fn(t)), seg radial segments. */
  tube(o) {
    const curve = new THREE.CatmullRomCurve3(o.pts.map((q) => new THREE.Vector3(...q)), !!o.closed, 'catmullrom', 0.5); const segs = o.segs || Math.max(8, o.pts.length * 8);
    const g = new THREE.TubeGeometry(curve, segs, o.r, o.seg || 8, !!o.closed); const raw = toRaw(g, 'keep', 2 * Math.PI * o.r, curve.getLength()); g.dispose(); this.addRaw(raw, new THREE.Matrix4(), o.mat, o);
  }
  /** Catenary-ish cable between a and b with sag (m). */
  cable(a, b, sag, r, mat, o = {}) {
    const pts = []; const n = o.n || 14; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t), a[2] + (b[2] - a[2]) * t]); }
    this.tube({ pts, r, mat, seg: o.seg || 6, segs: n * 2, cast: o.cast });
  }
  /** Flat quad on the xz plane (decals, water surfaces, ground patches). p centre, s [w,d], repeat in metres. */
  plane(o) {
    const [w, d] = o.s; const key = `pl${w.toFixed(2)},${d.toFixed(2)}`; let raw = this.geoCache.get(key);
    if (!raw) { const hx = w / 2, hz = d / 2; raw = { p: new Float32Array([-hx, 0, -hz, hx, 0, -hz, hx, 0, hz, -hx, 0, hz]), n: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), u: new Float32Array([0, 0, w, 0, w, d, 0, d]), i: new Uint32Array([0, 2, 1, 0, 3, 2]) }; this.geoCache.set(key, raw); }
    const m = this._mat4(o.p, o.yaw || 0, o.pitch || 0, o.roll || 0); this.addRaw(raw, m, o.mat, o);
    if (o.col) this.colliders.addBox({ x: o.p[0], y: o.p[1] - 0.05, z: o.p[2], hx: w / 2, hy: 0.05, hz: d / 2, yaw: o.yaw || 0, surface: typeof o.col === 'string' ? o.col : 'concrete' });
  }
  /** Stairs going +x local direction rotated by yaw. p = bottom-front centre; steps n, rise/run metres, width w. Steps are individual boxes (colliders => walkable). */
  stairs(o) {
    const { n, rise = 0.18, run = 0.28, w, mat } = o; const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0);
    for (let i = 0; i < n; i++) { const lx = run * (i + 0.5), h = rise * (i + 1); const x = o.p[0] + lx * c, z = o.p[2] - lx * s; this.box({ p: [x, o.p[1], z], s: [run, h, w], yaw: o.yaw || 0, mat, bevel: 0.012, col: o.col || 'concrete', cast: true }); }
  }
  /** Lumpy rock/heap (use a triplanar material). r radius, amp lumpiness, squash [sx,sy,sz]. col => cylinder collider. */
  rock(o) {
    const key = `rk${o.r.toFixed(2)},${o.detail || 3},${o.amp ?? 0.35},${o.seed || 1},${(o.squash || [1, 1, 1]).join('/')}`; let raw = this.geoCache.get(key);
    if (!raw) { raw = rockRaw(o.r, o.detail || 3, o.amp ?? 0.35, o.seed || 1, o.squash || [1, 1, 1], o.freq || 1.4); this.geoCache.set(key, raw); }
    const m = this._mat4(o.p, o.yaw || 0, o.pitch || 0, o.roll || 0); this.addRaw(raw, m, o.mat, o);
    if (o.col) { const sq = o.squash || [1, 1, 1]; this.colliders.addCyl({ x: o.p[0], z: o.p[2], r: o.r * Math.max(sq[0], sq[2]) * 0.85, y0: o.p[1] - o.r * sq[1] * 0.8, y1: o.p[1] + o.r * sq[1] * 0.75, surface: typeof o.col === 'string' ? o.col : 'rock', walk: o.walk === true }); }
  }
  /** Gable roof prism. p = base centre, s = [length(x), height, depth(z)]. */
  prism(o) { const raw = prismRaw(o.s[0], o.s[1], o.s[2]); this.addRaw(raw, this._mat4(o.p, o.yaw || 0), o.mat, o); }
  /** Register a light source with the light pool (see gfx.addLight). Returned object is owned by the stop. */
  light(o) { this.lights.push(o); return o; }
  /** Instanced prop: many copies of one geometry. geo: THREE.BufferGeometry (cached by key). */
  instance(key, geo, mat, matrix, color, opt) { this.inst.add(key, geo, this.mat(mat), matrix, color, opt); }
  matrix(p, yaw = 0, sc = 1, pitch = 0, roll = 0) { E.set(pitch, yaw, roll, 'YXZ'); Q.setFromEuler(E); return new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), Q.clone(), new THREE.Vector3(...(Array.isArray(sc) ? sc : [sc, sc, sc]))); }
  finish() {
    this.colliders.build(); let fn = null;
    if (this.skyVis !== false) { const sv = new SkyVis(this.colliders); if (sv.ok) fn = (x, y, z, nx, ny, nz) => sv.at(x, y, z, nx, ny, nz); this.sv = sv; }
    this.inst.finish(this.batch); this.batch.finish(fn);
  }
}
