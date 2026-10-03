// CONSTRUCTION GEOMETRY for cloth garments (LOD0): rolled hems with thickness, raised seam welts, topstitch dashes, patch / flap pockets that
// bulge, zips with real teeth + slider + pull, buttons with holes and thread, waistbands, belt loops, knee patches, plackets …
// Everything is built on a finished garment layer {m (CMesh), N, map, spec, prm} through `Surf` (closest point / ray queries on the layer's own
// mesh, so details sit exactly on the folded cloth and inherit its skin weights) and is emitted into o.buf.
import * as THREE from 'three';
import { boundaryLoops } from './cloth.js';
import { matSpec } from './mesh.js';
import { NB, BI, RIG } from './rig.js';
import { bootSole, bootDetails } from './boots.js';

const V = THREE.Vector3;
const sq = Math.sqrt;

// ------------------------------------------------------------------ hems (rolled edges)
/** rolled hem along every open edge of the layer: the cloth turns under with visible thickness (outer edge → rounded tip → inner return) */
export function addHems(o, layer, opt = {}) {
  const { m, N, map, spec } = layer; const buf = o.buf, P = m.P; const ht = opt.thick ?? Math.min(layer.prm.thick * 2.5, 0.0072), ret = opt.ret ?? 0.017;
  const loops = m._loops || (m._loops = boundaryLoops(m)); const out = []; let culledV = null, deadV = null;
  for (const L of loops) {
    const nL = L.v.length; if (nL < 5) continue; const A = [], B = [], C = [], D = [];
    // torn rim? (hole cut by cutTears: every vertex touches a removed face)
    let torn = false; if (m.alive) { let dead = 0, cul = 0; if (!culledV) { culledV = new Set(); deadV = new Set(); const F4 = m.F; for (let f = 0; f < m.nf; f++) if (!m.alive[f]) { const tgt = m.culled && m.culled[f] ? culledV : deadV; for (let k = 0; k < 4; k++) tgt.add(F4[f * 4 + k]); } }
      for (const v of L.v) { if (deadV.has(v)) dead++; if (culledV.has(v)) cul++; } if (cul > nL * 0.4) continue; torn = dead > nL * 0.7; }
    for (let i = 0; i < nL; i++) {
      const v = L.v[i], vp = L.v[(i + nL - 1) % nL], vn = L.v[(i + 1) % nL]; if (map[v] < 0) { A.push(-1); B.push(-1); C.push(-1); D.push(-1); continue; }
      const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2]; let tx = P[vn * 3] - P[vp * 3], ty = P[vn * 3 + 1] - P[vp * 3 + 1], tz = P[vn * 3 + 2] - P[vp * 3 + 2]; const tl = sq(tx * tx + ty * ty + tz * tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let ox = ty * nz - tz * ny, oy = tz * nx - tx * nz, oz = tx * ny - ty * nx; const ol = sq(ox * ox + oy * oy + oz * oz) || 1; ox /= ol; oy /= ol; oz /= ol; if (ox * L.open[0] + oy * L.open[1] + oz * L.open[2] < 0) { ox = -ox; oy = -oy; oz = -oz; }
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2], ao = m.C[v * 8 + 3];
      const jit = torn ? 0.6 + 0.9 * Math.abs(Math.sin(v * 12.9898)) : 1; // torn edges: irregular thickness
      const mk = (ax, k, nnx, nny, nnz, a2) => { const l = sq(nnx * nnx + nny * nny + nnz * nnz) || 1; return buf.vertS(px + ox * ax * jit + nx * k * ht * jit, py + oy * ax * jit + ny * k * ht * jit, pz + oz * ax * jit + nz * k * ht * jit, nnx / l, nny / l, nnz / l, m.WI, m.WW, v * 4, spec, ao * a2, spec.col[0], spec.col[1], spec.col[2]); };
      A.push(map[v]);
      B.push(mk(0.5 * ht, -0.15, ox * 0.8 + nx * 0.6, oy * 0.8 + ny * 0.6, oz * 0.8 + nz * 0.6, 0.9));
      C.push(mk(0.5 * ht, -0.85, ox * 0.8 - nx * 0.6, oy * 0.8 - ny * 0.6, oz * 0.8 - nz * 0.6, 0.75));
      D.push(mk(-ret, -1, -nx, -ny, -nz, 0.55));
    }
    for (let i = 0; i < nL; i++) { const j = (i + 1) % nL; if (A[i] < 0 || A[j] < 0) continue; buf.quad(A[i], B[i], B[j], A[j]); buf.quad(B[i], C[i], C[j], B[j]); buf.quad(C[i], D[i], D[j], C[j]); }
    if (torn) { // frayed threads: thin tapering triangles standing off the rim (lighter fibre colour)
      const fib = matSpec({ mat: 'cloth', color: 0xb4a890, rough: 0.95, wear: 0.4, dirt: 0.6, pattern: 'none' }); for (let i = 0; i < nL; i += 1) { const v = L.v[i], vn2 = L.v[(i + 1) % nL]; if (map[v] < 0 || ((v * 7 + i) % 3) === 0) continue; const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2]; const len = 0.007 + 0.016 * Math.abs(Math.sin(v * 4.37 + i)); const dir = [L.open[0] * 0.8 - nx * 0.25, L.open[1] * 0.8 - ny * 0.25, L.open[2] * 0.8 - nz * 0.25]; const dl = sq(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]) || 1;
        const p0 = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], p1 = [P[vn2 * 3], P[vn2 * 3 + 1], P[vn2 * 3 + 2]]; const tip = [(p0[0] + p1[0]) / 2 + dir[0] / dl * len, (p0[1] + p1[1]) / 2 + dir[1] / dl * len - 0.002, (p0[2] + p1[2]) / 2 + dir[2] / dl * len]; const w = m.wOf(v);
        const a0 = buf.vert([p0[0] - nx * 0.001, p0[1] - ny * 0.001, p0[2] - nz * 0.001], [nx, ny, nz], w, fib, 0.8), a1 = buf.vert([p1[0] - nx * 0.001, p1[1] - ny * 0.001, p1[2] - nz * 0.001], [nx, ny, nz], w, fib, 0.8), a2 = buf.vert(tip, [nx, ny, nz], w, fib, 0.8); buf.tri(a0, a1, a2); buf.tri(a1, a0, a2); } }
    out.push(L);
  }
  layer.loops = out; return out;
}

/** flag faces of inner cloth layers (their level-2 simulated shells) that lie completely under an outer layer: centroid + corners project onto it within 10 cm along
 *  the face normal. Flags live in S.cull (cached with the simulation, shared by looks / LODs); clothShape turns them into removed faces. */
export function cullSims(o, pend) {
  if (pend.length < 2 || globalThis.__ZNOCULL) return;
  const surfOf = (L) => L.S.surf2 || (L.S.surf2 = new Surf({ m: L.S.m2, N: L.S.m2.normals() }));
  for (let i = 0; i < pend.length - 1; i++) {
    const L = pend[i], m = L.S.m2; if (L.S.cull) continue; const occ = []; for (let j = i + 1; j < pend.length; j++) if (pend[j].G.o.opaque !== false) occ.push(j); if (!occ.length) continue;
    const flags = new Uint8Array(m.nf); const N = m.normals(), P = m.P, F = m.F; const S = occ.map((j) => surfOf(pend[j]));
    const hit = (x, y, z, nx, ny, nz) => { for (const q of S) if (q.ray(x + nx * 0.002, y + ny * 0.002, z + nz * 0.002, nx, ny, nz, 0.1)) return true; return false; }; let cnt = 0;
    const tsites = []; for (let j = i + 1; j < pend.length; j++) if (pend[j].S.tears) for (const t of pend[j].S.tears) tsites.push(t); // never cull behind a tear in an outer garment
    for (let f = 0; f < m.nf; f++) { if (m.FT[f] & 1) continue; let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0; for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; nx += N[v * 3]; ny += N[v * 3 + 1]; nz += N[v * 3 + 2]; } cx *= 0.25; cy *= 0.25; cz *= 0.25; const nl = sq(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      if (tsites.length) { let nearT = false; for (const t of tsites) { const d = Math.hypot(cx - t.c[0], cy - t.c[1], cz - t.c[2]); if (d < t.r * 1.9 + 0.04) { nearT = true; break; } } if (nearT) continue; }
      if (!hit(cx, cy, cz, nx, ny, nz)) continue; let all = true; for (let k = 0; k < 4 && all; k++) { const v = F[f * 4 + k]; if (!hit(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], N[v * 3], N[v * 3 + 1], N[v * 3 + 2])) all = false; } if (all) { flags[f] = 1; cnt++; } }
    L.S.cull = flags; if (PROF_LOG && cnt) PROF_LOG(`cull ${L.prm.kind}: ${cnt}/${m.nf}`);
  }
}
let PROF_LOG = null; export const setCullLog = (fn) => { PROF_LOG = fn; };
// ------------------------------------------------------------------ surface queries on a garment layer
const _t = { u: 0, v: 0, w: 0 };
/** closest point on triangle abc to p (Ericson); writes barycentrics to _t, returns squared distance and the point in out */
function closestTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz; let u, v, w;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
  else { const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
    else { const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); u = 1 - t; v = t; w = 0; }
      else { const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
        else { const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); u = 1 - t; v = 0; w = t; }
          else { const va = d3 * d6 - d5 * d4;
            if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - t; w = t; }
            else { const dn = 1 / (va + vb + vc); v = vb * dn; w = vc * dn; u = 1 - v - w; } } } } } }
  _t.u = u; _t.v = v; _t.w = w; out[0] = ax * u + bx * v + cx * w; out[1] = ay * u + by * v + cy * w; out[2] = az * u + bz * v + cz * w;
  const dx = px - out[0], dy = py - out[1], dz = pz - out[2]; return dx * dx + dy * dy + dz * dz;
}
export class Surf {
  constructor(layer) {
    const m = layer.m, N = layer.N; this.m = m; this.N = N; this.cell = 0.035; const c = this.cell, P = m.P, F = m.F; let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let v = 0; v < m.n; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    this.gx0 = Math.floor(x0 / c) - 1; this.gy0 = Math.floor(y0 / c) - 1; this.gz0 = Math.floor(z0 / c) - 1; this.nx = Math.floor(x1 / c) - this.gx0 + 2; this.ny = Math.floor(y1 / c) - this.gy0 + 2; this.nz = Math.floor(z1 / c) - this.gz0 + 2;
    const nc = this.nx * this.ny * this.nz, cnt = new Int32Array(nc + 1), al = m.alive; const lists = [];
    const cellsOf = (f, fn) => { let ax = 1e9, ay = 1e9, az = 1e9, bx = -1e9, by = -1e9, bz = -1e9; for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y; if (z < az) az = z; if (z > bz) bz = z; }
      for (let k = Math.floor(az / c) - this.gz0; k <= Math.floor(bz / c) - this.gz0; k++) for (let j = Math.floor(ay / c) - this.gy0; j <= Math.floor(by / c) - this.gy0; j++) for (let i = Math.floor(ax / c) - this.gx0; i <= Math.floor(bx / c) - this.gx0; i++) fn((k * this.ny + j) * this.nx + i); };
    for (let f = 0; f < m.nf; f++) { if (al && !al[f]) continue; cellsOf(f, (id) => { cnt[id + 1]++; }); }
    for (let i = 0; i < nc; i++) cnt[i + 1] += cnt[i]; this.off = cnt; this.list = new Int32Array(cnt[nc]); const fp = new Int32Array(nc);
    for (let f = 0; f < m.nf; f++) { if (al && !al[f]) continue; cellsOf(f, (id) => { this.list[cnt[id] + fp[id]++] = f; }); }
    this.stamp = new Int32Array(m.nf); this.st = 0; this.h = { p: [0, 0, 0], n: [0, 1, 0], a: 0, b: 0, c: 0, u: 1, v: 0, w: 0, t: 0, d: 0 }; this._o = [0, 0, 0];
  }
  _id(x, y, z) { const c = this.cell; return ((Math.floor(z / c) - this.gz0) * this.ny + (Math.floor(y / c) - this.gy0)) * this.nx + (Math.floor(x / c) - this.gx0); }
  _test(id, x, y, z) {
    const P = this.m.P, F = this.m.F, o = this._o, h = this.h;
    for (let q = this.off[id]; q < this.off[id + 1]; q++) { const f = this.list[q]; if (this.stamp[f] === this.st) continue; this.stamp[f] = this.st;
      const a = F[f * 4], b = F[f * 4 + 1], cc = F[f * 4 + 2], d = F[f * 4 + 3];
      let dd = closestTri(x, y, z, P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2], P[cc * 3], P[cc * 3 + 1], P[cc * 3 + 2], o); if (dd < this._best) { this._best = dd; this._hit = true; h.a = a; h.b = b; h.c = cc; h.u = _t.u; h.v = _t.v; h.w = _t.w; h.p[0] = o[0]; h.p[1] = o[1]; h.p[2] = o[2]; }
      dd = closestTri(x, y, z, P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[cc * 3], P[cc * 3 + 1], P[cc * 3 + 2], P[d * 3], P[d * 3 + 1], P[d * 3 + 2], o); if (dd < this._best) { this._best = dd; this._hit = true; h.a = a; h.b = cc; h.c = d; h.u = _t.u; h.v = _t.v; h.w = _t.w; h.p[0] = o[0]; h.p[1] = o[1]; h.p[2] = o[2]; } }
  }
  /** closest surface point to (x,y,z) within maxD → shared hit record (valid until the next query) or null. Cell first, neighbours only when needed. */
  closest(x, y, z, maxD = 0.03) {
    const c = this.cell, cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c), ci = cx - this.gx0, cj = cy - this.gy0, ck = cz - this.gz0; const h = this.h; this._best = maxD * maxD; this._hit = false; this.st++;
    if (ci >= 0 && cj >= 0 && ck >= 0 && ci < this.nx && cj < this.ny && ck < this.nz) this._test((ck * this.ny + cj) * this.nx + ci, x, y, z);
    const fx = x - cx * c, fy = y - cy * c, fz = z - cz * c; const bd = Math.min(fx, c - fx, fy, c - fy, fz, c - fz);
    if (!this._hit || this._best > bd * bd) { const r = Math.max(1, Math.ceil(maxD / c)); for (let k = Math.max(0, ck - r); k <= Math.min(this.nz - 1, ck + r); k++) for (let j = Math.max(0, cj - r); j <= Math.min(this.ny - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(this.nx - 1, ci + r); i++) this._test((k * this.ny + j) * this.nx + i, x, y, z); }
    if (!this._hit) return null; this._fin(h); h.d = sq(this._best); return h;
  }
  _fin(h) { const N = this.N; const nx = N[h.a * 3] * h.u + N[h.b * 3] * h.v + N[h.c * 3] * h.w, ny = N[h.a * 3 + 1] * h.u + N[h.b * 3 + 1] * h.v + N[h.c * 3 + 1] * h.w, nz = N[h.a * 3 + 2] * h.u + N[h.b * 3 + 2] * h.v + N[h.c * 3 + 2] * h.w; const l = sq(nx * nx + ny * ny + nz * nz) || 1; h.n[0] = nx / l; h.n[1] = ny / l; h.n[2] = nz / l; }
  /** first surface hit of the ray (double sided) within tMax (3D DDA over the cell grid) */
  ray(ox, oy, oz, dx, dy, dz, tMax = 1) {
    const c = this.cell, P = this.m.P, F = this.m.F; const dl = sq(dx * dx + dy * dy + dz * dz); dx /= dl; dy /= dl; dz /= dl; let bestT = tMax, hit = false; const h = this.h; this.st++;
    // clip to the grid box
    const lo = [this.gx0 * c, this.gy0 * c, this.gz0 * c], hi = [(this.gx0 + this.nx) * c, (this.gy0 + this.ny) * c, (this.gz0 + this.nz) * c], O = [ox, oy, oz], D = [dx, dy, dz]; let t0 = 0, t1 = tMax;
    for (let a = 0; a < 3; a++) { if (Math.abs(D[a]) < 1e-12) { if (O[a] < lo[a] || O[a] > hi[a]) return null; } else { let ta = (lo[a] - O[a]) / D[a], tb = (hi[a] - O[a]) / D[a]; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return null; } }
    const px = ox + dx * (t0 + 1e-6), py = oy + dy * (t0 + 1e-6), pz = oz + dz * (t0 + 1e-6);
    let ix = Math.floor(px / c), iy = Math.floor(py / c), iz = Math.floor(pz / c); const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? c / Math.abs(dx) : 1e30, tdy = dy !== 0 ? c / Math.abs(dy) : 1e30, tdz = dz !== 0 ? c / Math.abs(dz) : 1e30;
    let tx = dx !== 0 ? ((ix + (dx > 0 ? 1 : 0)) * c - ox) / dx : 1e30, ty = dy !== 0 ? ((iy + (dy > 0 ? 1 : 0)) * c - oy) / dy : 1e30, tz = dz !== 0 ? ((iz + (dz > 0 ? 1 : 0)) * c - oz) / dz : 1e30;
    for (let guard = 0; guard < 400; guard++) {
      const ci = ix - this.gx0, cj = iy - this.gy0, ck = iz - this.gz0; if (ci < 0 || cj < 0 || ck < 0 || ci >= this.nx || cj >= this.ny || ck >= this.nz) break;
      const id = (ck * this.ny + cj) * this.nx + ci;
      for (let q = this.off[id]; q < this.off[id + 1]; q++) {
        const f = this.list[q]; if (this.stamp[f] === this.st) continue; this.stamp[f] = this.st; const v0 = F[f * 4], v1 = F[f * 4 + 1], v2 = F[f * 4 + 2], v3 = F[f * 4 + 3];
        for (let tt = 0; tt < 2; tt++) {
          const a = v0, b = tt ? v2 : v1, cc = tt ? v3 : v2; const e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2], e2x = P[cc * 3] - P[a * 3], e2y = P[cc * 3 + 1] - P[a * 3 + 1], e2z = P[cc * 3 + 2] - P[a * 3 + 2];
          const qx0 = dy * e2z - dz * e2y, qy0 = dz * e2x - dx * e2z, qz0 = dx * e2y - dy * e2x; const det = e1x * qx0 + e1y * qy0 + e1z * qz0; if (Math.abs(det) < 1e-12) continue; const id2 = 1 / det; const tx2 = ox - P[a * 3], ty2 = oy - P[a * 3 + 1], tz2 = oz - P[a * 3 + 2];
          const u = (tx2 * qx0 + ty2 * qy0 + tz2 * qz0) * id2; if (u < -1e-6 || u > 1 + 1e-6) continue; const qx = ty2 * e1z - tz2 * e1y, qy = tz2 * e1x - tx2 * e1z, qz = tx2 * e1y - ty2 * e1x; const v = (dx * qx + dy * qy + dz * qz) * id2; if (v < -1e-6 || u + v > 1 + 1e-6) continue; const t = (e2x * qx + e2y * qy + e2z * qz) * id2;
          if (t > 1e-4 && t < bestT) { bestT = t; hit = true; h.a = a; h.b = b; h.c = cc; h.v = u; h.w = v; h.u = 1 - u - v; h.p[0] = ox + dx * t; h.p[1] = oy + dy * t; h.p[2] = oz + dz * t; h.t = t; }
        }
      }
      const tn = Math.min(tx, ty, tz); if (hit && bestT <= tn) break; if (tn > tMax) break;
      if (tx <= ty && tx <= tz) { ix += sx; tx += tdx; } else if (ty <= tz) { iy += sy; ty += tdy; } else { iz += sz; tz += tdz; }
    }
    if (!hit) return null; this._fin(h); return h;
  }
  /** skin weights of the current hit ([[bone, w], …], top 4) */
  weights(h) {
    const m = this.m; let k = 0; const bi = _wb, bw = _ww;
    const add = (v, kk) => { for (let j = 0; j < 4; j++) { const w = m.WW[v * 4 + j]; if (w <= 0) continue; const b = m.WI[v * 4 + j]; let q = 0; for (; q < k; q++) if (bi[q] === b) break; if (q === k) { bi[k] = b; bw[k] = 0; k++; } bw[q] += w * kk; } };
    add(h.a, h.u); add(h.b, h.v); add(h.c, h.w); const out = []; for (let n = 0; n < 4; n++) { let bq = -1, bv = 0; for (let q = 0; q < k; q++) if (bw[q] > bv) { bv = bw[q]; bq = q; } if (bq < 0) break; out.push([bi[bq], bv]); bw[bq] = -1; } return out.length ? out : [[BI.chest, 1]];
  }
  ao(h) { const C = this.m.C; return C[h.a * 8 + 3] * h.u + C[h.b * 8 + 3] * h.v + C[h.c * 8 + 3] * h.w; }
}
const _wb = new Int32Array(16), _ww = new Float64Array(16);

// ------------------------------------------------------------------ building blocks
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = sq(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** densify control points (guess positions) to `step` spacing */
export function densify(pts, step = 0.006) { const out = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const k = Math.max(1, Math.round(L / step)); for (let j = 0; j < k; j++) { const t = j / k; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); } } out.push(pts[pts.length - 1].slice()); return out; }
/** project guess points onto the surface: [{p, n, w (weights), ao}] (points farther than maxD from the surface are dropped) */
export function project(S, pts, maxD = 0.03) { const out = []; for (const g of pts) { const h = S.closest(g[0], g[1], g[2], maxD); if (!h) continue; out.push({ p: h.p.slice(), n: h.n.slice(), w: S.weights(h), ao: S.ao(h) }); } return out; }
const PROFILES = {
  flat: [[-1, 0], [-1, 1], [1, 1], [1, 0]], round: [[-1, 0], [-0.8, 0.72], [0, 1], [0.8, 0.72], [1, 0]], seam: [[-2.3, 0], [-1, 0.6], [1, 0.6], [2.3, 0]], welt: [[-1, 0], [-1, 0.6], [-0.6, 1], [0.6, 1], [1, 0.6], [1, 0]],
};
/** ribbon along a projected chain: profile across (halfWidth units) × height (lift units) — seam welts, tapes, plackets, straps */
export function ribbon(o, chain, { width = 0.004, lift = 0.0015, profile = 'round', spec, closed = false, ao = 1, offset = 0, off2 = 0 }) {
  const buf = o.buf, M = chain.length; if (M < 2) return; const prof = PROFILES[profile] || profile, J = prof.length; const hw = width / 2; const idx = [];
  // per-profile-point normals in the (across, up) plane
  const pn = prof.map((pt, j) => { const a = prof[Math.max(0, j - 1)], b = prof[Math.min(J - 1, j + 1)]; const da = (b[0] - a[0]) * hw, dh = (b[1] - a[1]) * lift; let nA = -dh, nH = da; if (j === 0 || j === J - 1) { /* vertical wall */ } const l = sq(nA * nA + nH * nH) || 1; nA /= l; nH /= l; if (nH < 0) { nA = -nA; nH = -nH; } return [nA, nH]; });
  for (let i = 0; i < M; i++) {
    const c = chain[i], prv = chain[closed ? (i + M - 1) % M : Math.max(0, i - 1)], nxt = chain[closed ? (i + 1) % M : Math.min(M - 1, i + 1)];
    const t = norm3([nxt.p[0] - prv.p[0], nxt.p[1] - prv.p[1], nxt.p[2] - prv.p[2]]); const n = c.n; let s = norm3(cross(n, t)); const row = [];
    for (let j = 0; j < J; j++) { const [a, h] = prof[j]; const pa = pn[j]; const px = c.p[0] + s[0] * (a * hw + offset) + n[0] * (h * lift + off2), py = c.p[1] + s[1] * (a * hw + offset) + n[1] * (h * lift + off2), pz = c.p[2] + s[2] * (a * hw + offset) + n[2] * (h * lift + off2);
      const nn = norm3([n[0] * pa[1] + s[0] * pa[0], n[1] * pa[1] + s[1] * pa[0], n[2] * pa[1] + s[2] * pa[0]]); row.push(buf.vert([px, py, pz], nn, c.w, spec, ao * (h > 0.05 ? 1 : 0.8) * c.ao)); }
    idx.push(row);
  }
  const N2 = closed ? M : M - 1; for (let i = 0; i < N2; i++) { const A = idx[i], B = idx[(i + 1) % M]; for (let j = 0; j < J - 1; j++) buf.quad(A[j], B[j], B[j + 1], A[j + 1]); }
}
/** stitch dashes along a projected chain (chain spacing ≈ dash length; alternate segments) */
export function dashes(o, chain, { width = 0.0012, lift = 0.0009, spec, every = 2, phase = 0, ao = 1 }) {
  const buf = o.buf; for (let i = phase % every; i < chain.length - 1; i += every) {
    const a = chain[i], b = chain[i + 1]; const t = norm3([b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]]); const mk = (c, sgn) => { const s = norm3(cross(c.n, t)); return buf.vert([c.p[0] + s[0] * sgn * width + c.n[0] * lift, c.p[1] + s[1] * sgn * width + c.n[1] * lift, c.p[2] + s[2] * sgn * width + c.n[2] * lift], c.n, c.w, spec, ao); };
    const a0 = mk(a, -1), b0 = mk(b, -1), b1 = mk(b, 1), a1 = mk(a, 1); buf.quad(a0, b0, b1, a1);
  }
}
/** convenience: stitch contrast colour for a fabric colour (sRGB bytes) */
export function threadSpec(spec, hex = null) { const [r, g, b] = spec.col; const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255; let c; if (hex != null) c = hex; else if (lum < 0.22) c = ((Math.min(255, r * 1.9 + 40) << 16) | (Math.min(255, g * 1.9 + 38) << 8) | Math.min(255, b * 1.9 + 36)); else if (lum > 0.6) c = ((r * 0.62) << 16) | ((g * 0.6) << 8) | (b * 0.58); else c = ((Math.min(255, r * 1.45 + 30) << 16) | (Math.min(255, g * 1.35 + 24) << 8) | Math.min(255, b * 1.1 + 14)); return matSpec({ mat: 'cloth', color: c, rough: 0.75, wear: 0.15, dirt: spec.mat2[1] / 255 * 0.8, pattern: 'none' }); }
/** raised seam: welt + (optional) double topstitch, along guess points */
export function seam(o, S, guess, { spec, welt = 0.0016, stitch = 0.0055, thread, dashLen = 0.006, lift = 0.0016, profile = 'seam', width = 0.0055 } = {}) {
  const fine = project(S, densify(guess, dashLen)); if (fine.length < 2) return fine; const chain = fine.filter((c, i) => i % 3 === 0 || i === fine.length - 1); if (welt > 0) ribbon(o, chain, { width, lift: welt, profile, spec });
  if (stitch > 0 && thread) { for (const sg of [-1, 1]) { const off = fine.map((c, i) => { const t = norm3(i < fine.length - 1 ? [fine[i + 1].p[0] - c.p[0], fine[i + 1].p[1] - c.p[1], fine[i + 1].p[2] - c.p[2]] : [c.p[0] - fine[i - 1].p[0], c.p[1] - fine[i - 1].p[1], c.p[2] - fine[i - 1].p[2]]); const s = norm3(cross(c.n, t)); return { p: [c.p[0] + s[0] * sg * stitch, c.p[1] + s[1] * sg * stitch, c.p[2] + s[2] * sg * stitch], n: c.n, w: c.w, ao: c.ao }; }); dashes(o, off, { spec: thread, lift: lift * 0.6 + welt * 0.35, ao: 1 }); } }
  return chain;
}
/** small axis-aligned-in-frame box on the surface: centre p, frame (t along, s across, n up), size [along, across, up] — zip teeth, sliders, rivets */
export function box(o, c, t, s, n, size, spec, w, ao = 1) {
  const buf = o.buf, [a, b, h] = [size[0] / 2, size[1] / 2, size[2]]; const P = (ia, ib, ih) => [c[0] + t[0] * ia * a + s[0] * ib * b + n[0] * ih * h, c[1] + t[1] * ia * a + s[1] * ib * b + n[1] * ih * h, c[2] + t[2] * ia * a + s[2] * ib * b + n[2] * ih * h];
  const face = (corners, nn) => { const ids = corners.map((q) => buf.vert(P(...q), nn, w, spec, ao)); buf.quad(ids[0], ids[1], ids[2], ids[3]); };
  face([[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], n);
  face([[-1, -1, 0], [-1, -1, 1], [-1, 1, 1], [-1, 1, 0]], [-t[0], -t[1], -t[2]]); face([[1, 1, 0], [1, 1, 1], [1, -1, 1], [1, -1, 0]], t);
  face([[1, -1, 0], [1, -1, 1], [-1, -1, 1], [-1, -1, 0]], [-s[0], -s[1], -s[2]]); face([[-1, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, 0]], s);
}
/** disc button (shirt / coat): rim, dished centre, two/four thread holes with a crossed stitch */
export function button(o, S, gp, { r = 0.0058, spec, hole = 0.0011, holes = 4, thread, lift = 0.001, h = 0.0022 } = {}) {
  const hh = S.closest(gp[0], gp[1], gp[2], 0.03); if (!hh) return; const c = hh.p.slice(), n = hh.n.slice(), w = S.weights(hh), ao = S.ao(hh); const buf = o.buf; const up = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const t = norm3(cross(up, n)), s = norm3(cross(n, t)); const K = 12;
  const ring = (rad, hgt, nrm) => { const ids = []; for (let k = 0; k < K; k++) { const a = k / K * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); const p = [c[0] + (t[0] * ca + s[0] * sa) * rad + n[0] * (lift + hgt), c[1] + (t[1] * ca + s[1] * sa) * rad + n[1] * (lift + hgt), c[2] + (t[2] * ca + s[2] * sa) * rad + n[2] * (lift + hgt)]; const nn = norm3([n[0] * nrm[1] + (t[0] * ca + s[0] * sa) * nrm[0], n[1] * nrm[1] + (t[1] * ca + s[1] * sa) * nrm[0], n[2] * nrm[1] + (t[2] * ca + s[2] * sa) * nrm[0]]); ids.push(buf.vert(p, nn, w, spec, ao)); } return ids; };
  const r0 = ring(r * 1.0, 0, [1, 0]), r1 = ring(r * 1.0, h * 0.75, [0.9, 0.4]), r2 = ring(r * 0.86, h, [0.4, 0.9]), r3 = ring(r * 0.52, h * 0.66, [-0.5, 0.85]);
  for (const [A, B] of [[r0, r1], [r1, r2], [r2, r3]]) for (let k = 0; k < K; k++) { const k1 = (k + 1) % K; buf.quad(A[k], A[k1], B[k1], B[k]); }
  const cc = buf.vert([c[0] + n[0] * (lift + h * 0.6), c[1] + n[1] * (lift + h * 0.6), c[2] + n[2] * (lift + h * 0.6)], n, w, spec, ao); for (let k = 0; k < K; k++) buf.tri(r3[k], r3[(k + 1) % K], cc);
  if (thread) for (const [dx, dy] of holes === 4 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[-1, 0], [1, 0]]) { const px = c[0] + (t[0] * dx + s[0] * dy) * r * 0.24 + n[0] * (lift + h * 0.68), py = c[1] + (t[1] * dx + s[1] * dy) * r * 0.24 + n[1] * (lift + h * 0.68), pz = c[2] + (t[2] * dx + s[2] * dy) * r * 0.24 + n[2] * (lift + h * 0.68); const q = (a2, b2) => buf.vert([px + (t[0] * a2 + s[0] * b2) * hole, py + (t[1] * a2 + s[1] * b2) * hole, pz + (t[2] * a2 + s[2] * b2) * hole], n, w, thread, ao * 0.7); buf.quad(q(-1, -1), q(1, -1), q(1, 1), q(-1, 1)); }
}
/** patch (pocket / knee patch / elbow patch): rectangle projected onto the cloth, lifted, with side walls, optional bulge (contents), topstitch and a flap */
export function patch(o, S, ctr, down, { w = 0.12, h = 0.14, lift = 0.0026, bulge = 0, spec, thread, flap = 0, stitch = true, nu = 6, nv = 7, round = 0.012, inset = 0.005, flapSpec, button: btn = null, slit = false } = {}) {
  const buf = o.buf; const dn = norm3(down); const h0 = S.closest(ctr[0], ctr[1], ctr[2], 0.03); if (!h0) return null; const n0 = h0.n.slice(); let side = norm3(cross(dn, n0)); const dn2 = norm3(cross(n0, side)); if (dn2[1] > 0) side = side.map((x) => -x); const dv = norm3(cross(n0, side)); const dvec = dv[1] > 0 ? dv.map((x) => -x) : dv;
  const grid = [], cornerCut = (u, v) => { const du = Math.max(0, Math.abs(u) - (w / 2 - round)), dvv = Math.max(0, v - (h - round)); const rr = sq(du * du + dvv * dvv); return rr > round ? round / rr : 1; };
  const g = []; for (let j = 0; j < nv; j++) { const row = []; for (let i = 0; i < nu; i++) { const u = (i / (nu - 1) - 0.5) * w, v = (j / (nv - 1)) * h; const k = cornerCut(u, v); const uu = u * (1 + 0.0), vv = v; const gp = [ctr[0] + side[0] * uu * k + dvec[0] * vv * k, ctr[1] + side[1] * uu * k + dvec[1] * vv * k, ctr[2] + side[2] * uu * k + dvec[2] * vv * k]; const hit = S.closest(gp[0], gp[1], gp[2], 0.03); if (!hit) { row.push(null); continue; }
      const edge = Math.min(1, Math.min(i, nu - 1 - i, j, nv - 1 - j) / 1.5); const bul = bulge * Math.pow(Math.sin(Math.PI * (i / (nu - 1))), 0.8) * smoothS(0.15, 0.95, j / (nv - 1)) * edge; row.push({ p: hit.p.slice(), n: hit.n.slice(), w: S.weights(hit), ao: S.ao(hit), lift: lift + bul, edge: edge < 1 }); } g.push(row); }
  const ids = g.map((row) => row.map((c) => (c ? buf.vert([c.p[0] + c.n[0] * c.lift, c.p[1] + c.n[1] * c.lift, c.p[2] + c.n[2] * c.lift], c.n, c.w, spec, c.ao) : -1)));
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) { const a = ids[j][i], b = ids[j][i + 1], c = ids[j + 1][i + 1], d = ids[j + 1][i]; if (a < 0 || b < 0 || c < 0 || d < 0) continue; buf.quad(a, d, c, b); }
  // side walls around the perimeter (visible cloth thickness) going down to the garment surface
  const per = []; for (let i = 0; i < nu; i++) per.push([0, i]); for (let j = 1; j < nv; j++) per.push([j, nu - 1]); for (let i = nu - 2; i >= 0; i--) per.push([nv - 1, i]); for (let j = nv - 2; j >= 1; j--) per.push([j, 0]);
  for (let k = 0; k < per.length; k++) { const [j0, i0] = per[k], [j1, i1] = per[(k + 1) % per.length]; const A = g[j0][i0], B = g[j1][i1]; if (!A || !B) continue; const cu = [0, 0, 0]; for (const q of [A, B]) { cu[0] += q.p[0]; cu[1] += q.p[1]; cu[2] += q.p[2]; } const ctrp = [0, 0, 0]; let cnt = 0; for (const row of g) for (const c of row) if (c) { ctrp[0] += c.p[0]; ctrp[1] += c.p[1]; ctrp[2] += c.p[2]; cnt++; } ctrp[0] /= cnt; ctrp[1] /= cnt; ctrp[2] /= cnt;
    const out = norm3([cu[0] / 2 - ctrp[0], cu[1] / 2 - ctrp[1], cu[2] / 2 - ctrp[2]]); const va = buf.vert(A.p, out, A.w, spec, A.ao * 0.7), vb = buf.vert(B.p, out, B.w, spec, B.ao * 0.7), vc = buf.vert([B.p[0] + B.n[0] * B.lift, B.p[1] + B.n[1] * B.lift, B.p[2] + B.n[2] * B.lift], out, B.w, spec, B.ao * 0.9), vd = buf.vert([A.p[0] + A.n[0] * A.lift, A.p[1] + A.n[1] * A.lift, A.p[2] + A.n[2] * A.lift], out, A.w, spec, A.ao * 0.9);
    // winding: perimeter runs clockwise seen from above (u right, v down) → flip so the wall faces outward
    buf.quad(va, vd, vc, vb); }
  // topstitch inset from the border (on top of the patch)
  if (stitch && thread) { const ring = []; const nn = 2; void nn; const pts = []; const ins = inset; const cx = 0; void cx; const K = 26; for (let q = 0; q <= K; q++) { /* perimeter path around the rectangle at `inset` */ } void K; void pts; void ring;
    const path = []; const iw = w / 2 - inset, ih = h - inset; const corners = [[-iw, inset], [iw, inset], [iw, ih], [-iw, ih], [-iw, inset]]; for (let c = 0; c < 4; c++) { const a = corners[c], b = corners[c + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const k = Math.max(1, Math.round(L / 0.005)); for (let q = 0; q < k; q++) { const t = q / k; path.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
    const ch = []; for (const [u, v] of path) { const kk = cornerCut(u, v); const gp = [ctr[0] + side[0] * u * kk + dvec[0] * v * kk, ctr[1] + side[1] * u * kk + dvec[1] * v * kk, ctr[2] + side[2] * u * kk + dvec[2] * v * kk]; const hit = S.closest(gp[0], gp[1], gp[2], 0.03); if (!hit) continue; ch.push({ p: [hit.p[0] + hit.n[0] * (lift + 0.0009), hit.p[1] + hit.n[1] * (lift + 0.0009), hit.p[2] + hit.n[2] * (lift + 0.0009)], n: hit.n.slice(), w: S.weights(hit), ao: S.ao(hit) }); }
    dashes(o, ch, { spec: thread, lift: 0.0004, width: 0.0011 }); }
  // flap: a second panel hanging over the top edge
  if (flap > 0) { const fs = flapSpec || spec; const ctrF = [ctr[0] - dvec[0] * 0.012, ctr[1] - dvec[1] * 0.012, ctr[2] - dvec[2] * 0.012]; patch(o, S, ctrF, dvec, { w: w * 1.04, h: flap, lift: lift + 0.0032, spec: fs, thread, stitch: true, nu: 6, nv: 4, round: 0.01, inset: 0.004, bulge: 0 }); if (btn) button(o, S, [ctrF[0] + dvec[0] * flap * 0.72, ctrF[1] + dvec[1] * flap * 0.72, ctrF[2] + dvec[2] * flap * 0.72], { spec: btn.spec, thread: btn.thread, lift: lift + 0.0032 + 0.002, r: btn.r ?? 0.0055 }); }
  return { side, down: dvec };
}
const smoothS = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** zip: two tapes, interlocking teeth (alternating left / right), slider with a pull tab, bottom stop. `guess` = points down the closure line, top → bottom or bottom → top */
export function zipper(o, S, guess, { tape, metal, pitch = 0.0042, slider = 0.85 } = {}) {
  const buf = o.buf; const chain = project(S, densify(guess, 0.005)); if (chain.length < 6) return; for (const sg of [-1, 1]) ribbon(o, chain, { width: 0.0075, lift: 0.0012, profile: 'flat', spec: tape, offset: sg * 0.0048 });
  // arc-length param
  const cum = [0]; for (let i = 1; i < chain.length; i++) cum.push(cum[i - 1] + Math.hypot(chain[i].p[0] - chain[i - 1].p[0], chain[i].p[1] - chain[i - 1].p[1], chain[i].p[2] - chain[i - 1].p[2])); const L = cum[cum.length - 1];
  const at = (sl) => { let i = 1; while (i < cum.length - 1 && cum[i] < sl) i++; const k = (sl - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); const a = chain[i - 1], b = chain[i]; const p = [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k]; const n = norm3([a.n[0] + (b.n[0] - a.n[0]) * k, a.n[1] + (b.n[1] - a.n[1]) * k, a.n[2] + (b.n[2] - a.n[2]) * k]); const t = norm3([b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]]); return { p, n, t, w: k < 0.5 ? a.w : b.w, ao: a.ao }; };
  const nT = Math.floor((L * slider - 0.02) / pitch); const from = L * (1 - slider) + 0.012;
  for (let k = 0; k < nT; k++) { const q = at(from + k * pitch); const s = norm3(cross(q.n, q.t)); const side = k % 2 ? 1 : -1; const c = [q.p[0] + s[0] * side * 0.0017 + q.n[0] * 0.0012, q.p[1] + s[1] * side * 0.0017 + q.n[1] * 0.0012, q.p[2] + s[2] * side * 0.0017 + q.n[2] * 0.0012]; box(o, c, q.t, s, q.n, [0.0032, 0.0036, 0.0016], metal, q.w, 1); }
  // slider + pull tab at the top of the closed section
  const sq0 = at(from + 0.004), sc = [sq0.p[0] + sq0.n[0] * 0.0012, sq0.p[1] + sq0.n[1] * 0.0012, sq0.p[2] + sq0.n[2] * 0.0012]; const ss = norm3(cross(sq0.n, sq0.t)); box(o, sc, sq0.t, ss, sq0.n, [0.016, 0.013, 0.0042], metal, sq0.w, 1);
  const pc = [sc[0] + sq0.n[0] * 0.0046 + sq0.t[0] * 0.012, sc[1] + sq0.n[1] * 0.0046 + sq0.t[1] * 0.012, sc[2] + sq0.n[2] * 0.0046 + sq0.t[2] * 0.012]; box(o, pc, sq0.t, ss, sq0.n, [0.026, 0.0085, 0.0014], metal, sq0.w, 1);
  const stop = at(L - 0.006); box(o, [stop.p[0] + stop.n[0] * 0.0012, stop.p[1] + stop.n[1] * 0.0012, stop.p[2] + stop.n[2] * 0.0012], stop.t, norm3(cross(stop.n, stop.t)), stop.n, [0.006, 0.011, 0.0025], metal, stop.w, 1);
}

// ------------------------------------------------------------------ recipes: what each garment gets
const PI = Math.PI, D2R = PI / 180;
const torsoAt = (S, y, a, maxT = 0.45) => { const h = S.ray(0, y, 0.02, Math.sin(a), 0, -Math.cos(a), maxT); return h ? h.p.slice() : null; };
const frontAt = (S, x, y) => { const h = S.ray(x, y, -0.5, 0, 0, 1, 0.9); return h ? h.p.slice() : null; };
const backAt = (S, x, y) => { const h = S.ray(x, y, 0.5, 0, 0, -1, 0.9); return h ? h.p.slice() : null; };
const list = (arr) => arr.filter(Boolean);
/** is a point on layer li covered by an outer layer? (details of inner garments under a jacket are skipped) */
function covered(layers, li, p, n) { for (let j = li + 1; j < layers.length; j++) { const Sj = layers[j].surf || (layers[j].surf = new Surf(layers[j])); if (Sj.ray(p[0] + n[0] * 0.002, p[1] + n[1] * 0.002, p[2] + n[2] * 0.002, n[0], n[1], n[2], 0.14)) return true; } return false; }
function hemStitch(o, L, S, thread) {
  const kd = L.prm.kind; for (const lp of L.loops || []) { if (lp.v.length < 9 || kd === 'gloves' || kd === 'mittens') continue; const P = L.m.P; const pts = lp.v.map((v) => [P[v * 3] - lp.open[0] * 0.0085, P[v * 3 + 1] - lp.open[1] * 0.0085, P[v * 3 + 2] - lp.open[2] * 0.0085]); pts.push(pts[0]); const ch = project(S, densify(pts, 0.0075), 0.02); if (ch.length > 3) dashes(o, ch, { spec: thread, lift: 0.0006, width: 0.0012 }); }
}
/** gloves / mittens: stitched cuff band above the wrist, seam welts along the back of the hand (tendon lines), a knuckle arc of stitches */
function gloveDetails(o, L, S, thread, spec) {
  const mit = L.prm.kind === 'mittens';
  for (const side of ['L', 'R']) {
    const A = RIG.arm[side]; const wr = A.wr, h = A.h, pn = A.p, t = A.t; const f = norm3(A.f), c = [wr[0] - f[0] * 0.03, wr[1] - f[1] * 0.03, wr[2] - f[2] * 0.03]; const u = norm3(cross(f, Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = norm3(cross(f, u)); const g = [];
    for (let k = 0; k <= 22; k++) { const a = k / 22 * PI * 2; const d = [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)]; const hh = S.ray(c[0], c[1], c[2], d[0], d[1], d[2], 0.08); if (hh) g.push(hh.p.slice()); }
    if (g.length > 14) { ribbon(o, project(S, densify(g, 0.007), 0.03), { width: 0.032, lift: 0.0026, profile: 'flat', spec }); for (const sg of [-1, 1]) dashes(o, project(S, densify(g.map((p) => [p[0] + f[0] * sg * 0.012, p[1] + f[1] * sg * 0.012, p[2] + f[2] * sg * 0.012]), 0.0045), 0.03), { spec: thread, lift: 0.003, width: 0.001 }); }
    for (const cc of mit ? [0] : [-0.026, 0, 0.026]) { const gp = []; for (let a = 0.014; a <= 0.086; a += 0.012) gp.push([wr[0] + h[0] * a + t[0] * cc - pn[0] * 0.019, wr[1] + h[1] * a + t[1] * cc - pn[1] * 0.019, wr[2] + h[2] * a + t[2] * cc - pn[2] * 0.019]); if (gp.length > 4) seam(o, S, gp, { spec, thread, welt: 0.0012, stitch: 0.0038, width: 0.0042, dashLen: 0.0048 }); }
    if (!mit) { const gp = []; for (let k = -4; k <= 4; k++) gp.push([wr[0] + h[0] * (0.082 - Math.abs(k) * 0.0012) + t[0] * k * 0.0085 - pn[0] * 0.02, wr[1] + h[1] * (0.082 - Math.abs(k) * 0.0012) + t[1] * k * 0.0085 - pn[1] * 0.02, wr[2] + h[2] * (0.082 - Math.abs(k) * 0.0012) + t[2] * k * 0.0085 - pn[2] * 0.02]); dashes(o, project(S, densify(gp, 0.0045), 0.03), { spec: thread, lift: 0.0008, width: 0.001 }); }
  }
}
/** construction details of one garment layer (LOD0). layers = all cloth layers (inner → outer) */
export function decorate(o, layers, li) {
  const L = layers[li], G = L.G, S = L.surf || (L.surf = L.m._surf || (L.m._surf = new Surf(L))), spec = L.spec, kind = L.prm.kind, cls = L.cls; const soft = spec.id === 13 || spec.id === 18; /* fur / plastic suits: no buttons, pockets or seams */ const thread = threadSpec(spec, G.o.thread); const det = G.o.detail ?? G.g.detail ?? 0;
  const metal = matSpec({ mat: 'metal', color: G.o.zipColor ?? 0x8a8a84, rough: 0.35, wear: 0.5, dirt: 0.5 }), tape = matSpec({ mat: 'cloth', color: G.o.tapeColor ?? 0x1a1a1c, rough: 0.9, dirt: 0.5, pattern: 'weave' });
  const btnSpec = matSpec({ mat: 'plastic', color: G.o.buttonColor ?? 0x2a2620, rough: 0.35, wear: 0.3, dirt: 0.5 }), btnThread = matSpec({ mat: 'cloth', color: 0x0a0908, rough: 0.9 });
  const tally = (nm) => { if (o._tal) { o._tal.push(nm + ':' + (o.buf.triCount - o._tal.t0)); o._tal.t0 = o.buf.triCount; } }; if (o._tal) o._tal.t0 = o.buf.triCount;
  if (G.g.boot) { const tb = o.buf.triCount; bootSole(o, L, S); bootDetails(o, layers, li, S); if (o._tal) o._tal.push(kind + ':boot:' + (o.buf.triCount - tb)); return; }
  if (cls.hand && !cls.legs && !cls.top) { gloveDetails(o, L, S, thread, spec); return; }
  if (soft) return; hemStitch(o, L, S, thread); tally(kind + ':hemStitch');
  // elastic / velcro sleeve cuffs: a stitched band just above each wrist opening with a tab
  if (L.prm.elastic && cls.arms) for (const lp of L.loops || []) { const A = lp.c; let near = false; for (const sd of ['L', 'R']) { const w = RIG.arm[sd].wr; if (Math.hypot(A[0] - w[0], A[1] - w[1], A[2] - w[2]) < 0.1) near = true; } if (!near) continue;
    const ax = lp.open, c = [A[0] - ax[0] * 0.035, A[1] - ax[1] * 0.035, A[2] - ax[2] * 0.035]; const u = norm3(cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = norm3(cross(ax, u)); const g = [];
    for (let k = 0; k <= 26; k++) { const a = k / 26 * PI * 2; const d = [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)]; const h = S.ray(c[0], c[1], c[2], d[0], d[1], d[2], 0.11); if (h) g.push(h.p.slice()); }
    if (g.length > 16) { const ch = project(S, densify(g, 0.008), 0.03); ribbon(o, ch, { width: 0.05, lift: 0.0024, profile: 'flat', spec }); for (const sg of [-1, 1]) { const g2 = g.map((p) => [p[0] + ax[0] * sg * 0.021, p[1] + ax[1] * sg * 0.021, p[2] + ax[2] * sg * 0.021]); dashes(o, project(S, densify(g2, 0.005), 0.03), { spec: thread, lift: 0.0026, width: 0.0011 }); } } }
  const top = cls.top && !cls.legs, whole = cls.top && cls.legs, bottoms = cls.legs && !cls.top; const hemY = (() => { let y = 9; const P = L.m.P; for (let v = 0; v < L.m.n; v++) if (L.m.WI[v * 4] === BI.spine1 || L.m.WI[v * 4] === BI.pelvis || L.m.WI[v * 4] === BI.spine2) y = Math.min(y, P[v * 3 + 1]); return y; })();
  const sideSeams = () => { for (const sx of [-1, 1]) { const g = []; for (let y = Math.max(0.85, hemY + 0.01); y <= 1.255; y += 0.02) g.push(torsoAt(S, y, sx * PI / 2)); const pts = list(g); if (pts.length > 4) seam(o, S, pts, { spec, thread }); } };
  const underarm = () => { for (const side of ['L', 'R']) { const A = RIG.arm[side]; const sh = new V(...A.sh), el = new V(...A.el), wr = new V(...A.wr); const g = []; const end = (G.o.sleeve ?? 6) >= 6 ? 0.56 : 0.44; for (let sL = 0.04; sL <= end; sL += 0.02) { const c = sL <= 0.326 ? sh.clone().addScaledVector(new V(...A.u), sL) : el.clone().addScaledVector(new V(...A.f), sL - 0.326); const ax = sL <= 0.326 ? new V(...A.u) : new V(...A.f); const d = new V(0, -1, 0).addScaledVector(ax, ax.y); d.add(new V(-A.sx * 0.35, 0, 0)).normalize(); const h = S.ray(c.x, c.y, c.z, d.x, d.y, d.z, 0.16); if (h) g.push(h.p.slice()); } if (g.length > 5) seam(o, S, g, { spec, thread }); } };
  const shoulder = () => { for (const sx of [-1, 1]) { const g = []; for (let x = 0.065; x <= 0.19; x += 0.02) { const h = S.ray(sx * x, 1.7, 0.016, 0, -1, 0, 0.5); if (h) g.push(h.p.slice()); } if (g.length > 3) seam(o, S, g, { spec, thread }); } };
  const backSeam = () => { const g = []; for (let y = Math.max(0.86, hemY + 0.01); y <= 1.42; y += 0.02) g.push(backAt(S, 0, y)); const pts = list(g); if (pts.length > 6) seam(o, S, pts, { spec, thread }); };
  const armhole = () => { for (const side of ['L', 'R']) { const A = RIG.arm[side]; const sh = new V(...A.sh), u = new V(...A.u); const ax = u.clone().normalize(); const f = new V(0, 0, -1).addScaledVector(ax, -ax.z).normalize(); const l = new V().crossVectors(ax, f).normalize(); const g = []; const c = sh.clone().addScaledVector(ax, 0.045); for (let k = 0; k <= 24; k++) { const a = k / 24 * PI * 2; const d = f.clone().multiplyScalar(Math.cos(a)).addScaledVector(l, Math.sin(a)); const h = S.ray(c.x, c.y, c.z, d.x, d.y, d.z, 0.11); if (h) g.push(h.p.slice()); } if (g.length > 12) seam(o, S, g, { spec, thread }); } };
  if (cls.top && (det & 4 || kind === 'jacket' || kind === 'shirt' || kind === 'coveralls')) { if (G.o.seams !== false) { sideSeams(); underarm(); shoulder(); if (kind !== 'shirt') backSeam(); if (kind === 'jacket' || kind === 'shirt' || kind === 'coveralls') armhole(); } }
  tally(kind + ':seams');
  // hem drawcords with cord-lock toggles hanging at the front of technical jackets
  if (kind === 'jacket' && (G.o.drawcord ?? ((G.o.pattern ?? G.g.mat?.pattern) === 'ripstop' || (G.o.pattern ?? G.g.mat?.pattern) === 'quilt'))) for (const sx of [-1, 1]) { const p = frontAt(S, sx * 0.12, hemY + 0.035); if (!p) continue; const hh = S.closest(p[0], p[1], p[2], 0.03); if (!hh) continue; const w = S.weights(hh); const pts = [new V(p[0], p[1], p[2] - 0.004), new V(p[0] + sx * 0.002, p[1] - 0.03, p[2] - 0.012), new V(p[0] + sx * 0.004, p[1] - 0.066, p[2] - 0.016), new V(p[0] + sx * 0.003, p[1] - 0.088, p[2] - 0.015)]; const cs = o._spec({ mat: 'rubber', color: 0x18181a, rough: 0.75, dirt: 0.5 }); o._tubeRaw(pts, [0.0022, 0.0022, 0.0022, 0.0022], cs, { seg: 5, sub: 2, bindFn: () => w }); o._box({ bind: 'auto', p: [pts[3].x, pts[3].y - 0.009, pts[3].z], s: [0.008, 0.016, 0.008], mat: 'plastic', color: 0x1a1a1c, rough: 0.5, bevel: 0.002 }); }
  // retro-reflective tape (hi-vis vests / jackets): two bands round the body + over-shoulder stripes; epaulettes on workwear / uniform jackets
  { const pat0 = G.o.pattern ?? G.g.mat?.pattern; const refl = matSpec({ mat: 'plastic', color: 0xb8bcc0, rough: 0.3, wear: 0.15, dirt: 0.55 });
    if (cls.top && (G.o.reflective ?? pat0 === 'hivis')) { for (const y of [1.19, 1.05].filter((v) => v > hemY + 0.06)) { const g = []; for (let k = 0; k <= 56; k++) g.push(torsoAt(S, y, k / 56 * PI * 2)); const pts = list(g); if (pts.length > 40) ribbon(o, project(S, densify(pts, 0.011), 0.03), { width: 0.05, lift: 0.0017, profile: 'flat', spec: refl }); }
      for (const sx of [-1, 1]) for (const fr of [0, 1]) { const g = []; for (let y = Math.max(hemY + 0.02, 0.9); y <= 1.4; y += 0.02) g.push(fr ? backAt(S, sx * 0.075, y) : frontAt(S, sx * 0.075, y)); const pts = list(g); if (pts.length > 8) ribbon(o, project(S, densify(pts, 0.012), 0.03), { width: 0.05, lift: 0.0017, profile: 'flat', spec: refl }); } }
    const ep = G.o.epaulettes ?? (kind === 'jacket' && (pat0 === 'canvas' || pat0 === 'weave' || pat0 === 'denim' || pat0 === 'oilskin')); if (ep && cls.top) for (const sx of [-1, 1]) { const g = []; for (let x = 0.06; x <= 0.175; x += 0.02) { const h = S.ray(sx * x, 1.7, -0.012, 0, -1, 0, 0.5); if (h) g.push(h.p.slice()); } if (g.length > 4) { const ch = project(S, densify(g, 0.008), 0.03); ribbon(o, ch, { width: 0.04, lift: 0.0032, profile: 'flat', spec }); dashes(o, project(S, densify(g.map((p) => [p[0], p[1], p[2] - 0.0175]), 0.005), 0.03), { spec: thread, lift: 0.0036, width: 0.0011 }); dashes(o, project(S, densify(g.map((p) => [p[0], p[1], p[2] + 0.0175]), 0.005), 0.03), { spec: thread, lift: 0.0036, width: 0.0011 }); button(o, S, [g[1][0], g[1][1], g[1][2] - 0.004], { spec: btnSpec, thread: btnThread, lift: 0.0034, r: 0.0048 }); } } }
  // front closure: zip (flag 32) or button placket (flag 1)
  if (cls.top && (det & 1)) {
    const yTop = 1.395, yBot = Math.max(0.9, hemY + 0.015); const front = []; for (let y = yBot; y <= yTop; y += 0.02) front.push(frontAt(S, 0.0, y)); const pts = list(front);
    if (pts.length > 6) {
      const nm = S.closest(pts[Math.floor(pts.length / 2)][0], pts[Math.floor(pts.length / 2)][1], pts[Math.floor(pts.length / 2)][2], 0.03);
      if (nm && !covered(layers, li, nm.p.slice(), nm.n.slice())) {
        if (det & 32) { zipper(o, S, pts.slice().reverse(), { tape, metal }); for (const sg of [-1, 1]) { const ch = project(S, densify(pts.map((p) => [p[0] + sg * 0.014, p[1], p[2]]), 0.006), 0.03); dashes(o, ch, { spec: thread, lift: 0.0008, width: 0.0011 }); } }
        else { const ch = project(S, densify(pts.map((p) => [p[0], p[1], p[2]]), 0.008), 0.03); ribbon(o, ch, { width: 0.034, lift: 0.0018, profile: 'flat', spec }); for (const sg of [-1, 1]) { const c2 = project(S, densify(pts.map((p) => [p[0] + sg * 0.0145, p[1], p[2]]), 0.006), 0.03); dashes(o, c2, { spec: thread, lift: 0.0022, width: 0.0011 }); }
          for (let y = yTop - 0.03; y > yBot + 0.02; y -= 0.082) { const p = frontAt(S, 0, y); if (p) button(o, S, [p[0], p[1], p[2]], { spec: btnSpec, thread: btnThread, lift: 0.0022 }); } }
      }
    }
  }
  tally(kind + ':closure');
  // chest pockets with button-down flaps (flag 2)
  if (cls.top && (det & 2)) for (const sx of [-1, 1]) { const p = frontAt(S, sx * 0.088, 1.335); if (!p) continue; const h = S.closest(p[0], p[1], p[2], 0.03); if (!h || covered(layers, li, p, h.n.slice())) continue; patch(o, S, p, [0, -1, 0], { w: 0.1, h: 0.11, spec, thread, flap: 0.042, bulge: 0.003, button: { spec: btnSpec, thread: btnThread } }); }
  tally(kind + ':chestPk');
  // jackets: slanted hip pockets
  if (kind === 'jacket' && (det & 2) && G.o.hipPockets !== false) for (const sx of [-1, 1]) { const a = sx * 33 * D2R; const p = torsoAt(S, 1.055, a); if (!p) continue; const h = S.closest(p[0], p[1], p[2], 0.03); if (!h || covered(layers, li, p, h.n.slice())) continue; patch(o, S, p, [0, -1, 0], { w: 0.135, h: 0.145, spec, thread, flap: 0.05, bulge: 0.004, button: { spec: btnSpec, thread: btnThread } }); }
  tally(kind + ':hipPk');
  // trousers
  if (cls.legs && !cls.sh && (det & 8 || kind === 'pants')) {
    const heavy = matSpec({ mat: 'cloth', color: G.o.thread ?? 0xb98a3c, rough: 0.7 }); void heavy;
    // outseam / inseam
    for (const sx of [-1, 1]) { const g = []; for (let y = 0.93; y >= 0.13; y -= 0.025) { const h = S.ray(sx * 0.5, y, -0.005, -sx, 0, 0, 0.5); if (h) g.push(h.p.slice()); } if (g.length > 8) seam(o, S, g, { spec, thread, stitch: 0.0055 });
      const g2 = []; for (let y = 0.77; y >= 0.13; y -= 0.025) { const h = S.ray(0, y, 0.005, sx, 0, 0, 0.3); if (h) g2.push(h.p.slice()); } if (g2.length > 8) seam(o, S, g2, { spec, thread, welt: 0.0012, stitch: 0.005 }); }
    // waistband + belt loops
    const wb = []; for (let k = 0; k <= 40; k++) wb.push(torsoAt(S, 0.985, k / 40 * PI * 2)); const wpts = list(wb);
    if (wpts.length > 30) { const ch = project(S, densify(wpts, 0.008), 0.03); ribbon(o, ch, { width: 0.048, lift: 0.0022, profile: 'flat', spec, closed: false }); for (const yy of [0.965, 1.005]) { const g = []; for (let k = 0; k <= 60; k++) g.push(torsoAt(S, yy, k / 60 * PI * 2)); const c2 = project(S, densify(list(g), 0.006), 0.03); dashes(o, c2, { spec: thread, lift: 0.0026, width: 0.0011 }); }
      for (const deg of [-155, -110, -25, 25, 90, 155, 180, -90]) { const a = deg * D2R; const g = []; for (let y = 0.95; y <= 1.025; y += 0.012) g.push(torsoAt(S, y, a)); const pts = list(g); if (pts.length > 4) ribbon(o, project(S, densify(pts, 0.008), 0.05), { width: 0.012, lift: 0.0042, profile: 'round', spec }); } }
    // fly + button
    { const g = []; for (let y = 0.955; y >= 0.845; y -= 0.012) g.push(frontAt(S, 0.026, y)); for (let k = 1; k <= 5; k++) g.push(frontAt(S, 0.026 - k * 0.0055, 0.845 - k * k * 0.0018)); const pts = list(g); if (pts.length > 6) { dashes(o, project(S, densify(pts, 0.005), 0.05), { spec: thread, lift: 0.0009, width: 0.0012 }); ribbon(o, project(S, densify(pts.slice(0, 5), 0.006), 0.05), { width: 0.004, lift: 0.0012, profile: 'round', spec }); }
      const bp = frontAt(S, 0.0, 0.978); if (bp) button(o, S, bp, { spec: G.o.rivets === false ? btnSpec : matSpec({ mat: 'metal', color: 0x8a7a5a, rough: 0.4, wear: 0.6 }), r: 0.0072, lift: 0.0022, holes: 0 }); }
    // back pockets (patch, stitched), front slash pockets
    for (const sx of [-1, 1]) { const p = backAt(S, sx * 0.078, 0.925); if (p) patch(o, S, p, [0, -1, 0], { w: 0.125, h: 0.135, spec, thread, bulge: 0.0015, round: 0.02 });
      const g = []; for (const [deg, y] of [[20, 0.985], [30, 0.965], [40, 0.94], [50, 0.905], [58, 0.865]]) g.push(torsoAt(S, y, sx * deg * D2R)); const pts = list(g); if (pts.length > 3) { const ch = project(S, densify(pts, 0.006), 0.03); ribbon(o, ch, { width: 0.008, lift: 0.0018, profile: 'welt', spec }); dashes(o, project(S, densify(pts.map((q) => [q[0] + sx * 0.0, q[1] - 0.007, q[2]]), 0.005), 0.05), { spec: thread, lift: 0.0018, width: 0.0011 }); } }
    // knee patches (flag 16)
    if (det & 16) for (const sx of [-1, 1]) { const h = S.ray(sx * 0.097, 0.575, -0.5, 0, 0, 1, 0.9); if (h) patch(o, S, h.p.slice(), [0, -1, 0], { w: 0.115, h: 0.15, spec, thread, lift: 0.0034, bulge: 0, round: 0.03, inset: 0.006 }); }
  }
  tally(kind + ':trousers');
}
