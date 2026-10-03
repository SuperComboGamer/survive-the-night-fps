// CLOTH SYSTEM for zombie garments. Garments are real cloth pieces built on the body:
//   1. a garment shell (offset body-cage faces, level-1 Catmull-Clark) is converted to a compact quad mesh (CMesh) and subdivided to
//      ~2 cm (simulation level);
//   2. a position-based-dynamics relaxation drapes it (gravity, fabric weight/stiffness, pins at shoulders / belt / collar, collision
//      against the body surface and the garments underneath, skin cling, a Laplacian bending prior) — result cached per look;
//   3. LOD0 refines it once more (~1 cm) and folds.js synthesises ridged creases from zone / strain fields (joints, hanging folds, belt
//      gathers, ankle stacking, quilted baffles); tears cut the mesh with visible cloth thickness;
//   4. the surface is emitted into the zombie GeoBuf (skin weights inherited from the body cage), then stitch.js adds construction
//      geometry (rolled hems, cuffs, seams, topstitch, pockets, zips, buttons …).
import * as THREE from 'three';
import { NB, BI, RIG } from './rig.js';
import { REC, GeoBuf, BONE_REGION } from './mesh.js';

const V = THREE.Vector3;
import { noise3, smooth, clamp01, GROUPS, GROUP_OF, computeFrames, applyFolds, applyBaffles } from './folds.js';
import { makeWear } from './wear.js';
export { noise3, smooth, clamp01 };
const CS = 8; // per-vertex channels: paint r g b, ao, frost, gap (height above the body), compress, pin

// ------------------------------------------------------------------ compact skinned quad mesh
const _bi = new Int32Array(40), _bw = new Float32Array(40);
export class CMesh {
  constructor(n, nf) { this.n = n; this.nf = nf; this.P = new Float64Array(n * 3); this.WI = new Uint8Array(n * 4); this.WW = new Float32Array(n * 4); this.C = new Float32Array(n * CS); this.F = new Int32Array(nf * 4); this.FT = new Uint8Array(nf); this.alive = null; this.level = 1; }
  clone() { const m = new CMesh(this.n, this.nf); m.P.set(this.P); m.WI.set(this.WI); m.WW.set(this.WW); m.C.set(this.C); m.F.set(this.F); m.FT.set(this.FT); m.level = this.level; if (this.alive) m.alive = this.alive.slice(); if (this.pin) m.pin = this.pin.slice(); if (this.cv) m.cv = this.cv.slice(); return m; }
  /** from a dense quad-only Cage (level ≥ 1): positions, top-4 weights, paint, collar flags */
  static fromCage(c) {
    const n = c.nv, nf = c.F.length, m = new CMesh(n, nf);
    for (let v = 0; v < n; v++) {
      const r = c.R[v]; m.P[v * 3] = r[0]; m.P[v * 3 + 1] = r[1]; m.P[v * 3 + 2] = r[2];
      let b0 = -1, b1 = -1, b2 = -1, b3 = -1, w0 = 0, w1 = 0, w2 = 0, w3 = 0;
      for (let b = 0; b < NB; b++) { const w = r[3 + b]; if (w <= w3) continue; if (w > w0) { b3 = b2; w3 = w2; b2 = b1; w2 = w1; b1 = b0; w1 = w0; b0 = b; w0 = w; } else if (w > w1) { b3 = b2; w3 = w2; b2 = b1; w2 = w1; b1 = b; w1 = w; } else if (w > w2) { b3 = b2; w3 = w2; b2 = b; w2 = w; } else { b3 = b; w3 = w; } }
      const s = w0 + w1 + w2 + w3 || 1; m.WI[v * 4] = Math.max(0, b0); m.WI[v * 4 + 1] = Math.max(0, b1); m.WI[v * 4 + 2] = Math.max(0, b2); m.WI[v * 4 + 3] = Math.max(0, b3); m.WW[v * 4] = w0 / s; m.WW[v * 4 + 1] = w1 / s; m.WW[v * 4 + 2] = w2 / s; m.WW[v * 4 + 3] = w3 / s;
      for (let k = 0; k < 5; k++) m.C[v * CS + k] = r[3 + NB + k];
    }
    m.cv = new Uint8Array(n);
    for (let f = 0; f < nf; f++) { const fc = c.F[f]; if (fc.length !== 4) throw new Error('CMesh.fromCage needs quads'); for (let k = 0; k < 4; k++) m.F[f * 4 + k] = fc[k]; if (c.T[f] && c.T[f].part === 'collar') { m.FT[f] = 1; for (let k = 0; k < 4; k++) m.cv[fc[k]] = 1; } }
    return m;
  }
  /** area-weighted vertex normals over live faces (Float32Array 3n) */
  normals(out) {
    const n = this.n, N = out || new Float32Array(n * 3); N.fill(0); const P = this.P, F = this.F, al = this.alive;
    for (let f = 0; f < this.nf; f++) {
      if (al && !al[f]) continue; const a = F[f * 4], b = F[f * 4 + 1], c = F[f * 4 + 2], d = F[f * 4 + 3];
      // Newell normal of the quad
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2], dx = P[d * 3], dy = P[d * 3 + 1], dz = P[d * 3 + 2];
      const nx = (ay - by) * (az + bz) + (by - cy) * (bz + cz) + (cy - dy) * (cz + dz) + (dy - ay) * (dz + az), ny = (az - bz) * (ax + bx) + (bz - cz) * (bx + cx) + (cz - dz) * (cx + dx) + (dz - az) * (dx + ax), nz = (ax - bx) * (ay + by) + (bx - cx) * (by + cy) + (cx - dx) * (cy + dy) + (dx - ax) * (dy + ay);
      for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; }
    }
    for (let v = 0; v < n; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); if (l > 1e-12) { N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; } else { N[v * 3 + 1] = 1; } }
    return N;
  }
  /** weights of vertex v as [[bone, w], …] (for GeoBuf.vert) */
  wOf(v) { const o = []; for (let k = 0; k < 4; k++) { const w = this.WW[v * 4 + k]; if (w > 0) o.push([this.WI[v * 4 + k], w]); } return o.length ? o : [[BI.chest, 1]]; }
}
const _src = [0, 0, 0, 0];
/** average of `cnt` source vertices' 4-weight sets → out slot (top 4, normalised) */
function mergeW(out, oi, m, src, cnt) {
  let k = 0;
  for (let s = 0; s < cnt; s++) { const v = src[s]; for (let j = 0; j < 4; j++) { const w = m.WW[v * 4 + j]; if (w <= 0) continue; const b = m.WI[v * 4 + j]; let q = 0; for (; q < k; q++) if (_bi[q] === b) break; if (q === k) { _bi[k] = b; _bw[k] = 0; k++; } _bw[q] += w; } }
  let sum = 0; for (let j = 0; j < 4; j++) { let bi = -1, bv = 0; for (let q = 0; q < k; q++) if (_bw[q] > bv) { bv = _bw[q]; bi = q; } if (bi < 0) { out.WI[oi * 4 + j] = 0; out.WW[oi * 4 + j] = 0; continue; } out.WI[oi * 4 + j] = _bi[bi]; out.WW[oi * 4 + j] = bv; sum += bv; _bw[bi] = -1; }
  for (let j = 0; j < 4; j++) out.WW[oi * 4 + j] /= sum || 1;
}
/** one Catmull-Clark step on an all-quad mesh (boundary rules as Cage.subdivide). Attributes other than position are inherited linearly. */
export function subdivQuads(m) {
  const n = m.n, nf = m.nf, F = m.F, P = m.P; const emap = new Map(); const ea = new Int32Array(nf * 4), eb = new Int32Array(nf * 4), ef0 = new Int32Array(nf * 4), ef1 = new Int32Array(nf * 4).fill(-1), fe = new Int32Array(nf * 4); let ne = 0;
  for (let f = 0; f < nf; f++) { if (m.alive && !m.alive[f]) { for (let k = 0; k < 4; k++) fe[f * 4 + k] = -1; continue; } for (let k = 0; k < 4; k++) { const a = F[f * 4 + k], b = F[f * 4 + ((k + 1) & 3)]; const key = a < b ? a * n + b : b * n + a; let e = emap.get(key); if (e === undefined) { e = ne++; emap.set(key, e); ea[e] = a; eb[e] = b; ef0[e] = f; } else ef1[e] = f; fe[f * 4 + k] = e; } }
  let nfl = 0; for (let f = 0; f < nf; f++) if (!m.alive || m.alive[f]) nfl++;
  const nO = n + ne + nf, out = new CMesh(nO, nf * 4); out.level = m.level + 1; out.cv = m.cv ? new Uint8Array(nO) : null; const fB = n + ne;
  const OP = out.P, OC = out.C, C = m.C;
  // face points
  for (let f = 0; f < nf; f++) { if (m.alive && !m.alive[f]) continue; const o = fB + f; for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; OP[o * 3] += P[v * 3] * 0.25; OP[o * 3 + 1] += P[v * 3 + 1] * 0.25; OP[o * 3 + 2] += P[v * 3 + 2] * 0.25; for (let c = 0; c < CS; c++) OC[o * CS + c] += C[v * CS + c] * 0.25; } _src[0] = F[f * 4]; _src[1] = F[f * 4 + 1]; _src[2] = F[f * 4 + 2]; _src[3] = F[f * 4 + 3]; mergeW(out, o, m, _src, 4); if (m.cv) { let cvv = 1; for (let k = 0; k < 4; k++) if (!m.cv[F[f * 4 + k]]) cvv = 0; out.cv[o] = cvv; } }
  // edge points
  const two = [0, 0];
  for (let e = 0; e < ne; e++) { const o = n + e, a = ea[e], b = eb[e]; if (ef1[e] >= 0) { const p0 = fB + ef0[e], p1 = fB + ef1[e]; for (let c = 0; c < 3; c++) OP[o * 3 + c] = (P[a * 3 + c] + P[b * 3 + c] + OP[p0 * 3 + c] + OP[p1 * 3 + c]) * 0.25; } else for (let c = 0; c < 3; c++) OP[o * 3 + c] = (P[a * 3 + c] + P[b * 3 + c]) * 0.5; for (let c = 0; c < CS; c++) OC[o * CS + c] = (C[a * CS + c] + C[b * CS + c]) * 0.5; two[0] = a; two[1] = b; mergeW(out, o, m, two, 2); if (m.cv) out.cv[o] = m.cv[a] && m.cv[b] ? 1 : 0; }
  // vertex points
  const vfN = new Int32Array(n), veN = new Int32Array(n), bN = new Int32Array(n), bA = new Int32Array(n).fill(-1), bB = new Int32Array(n).fill(-1); const vfS = new Float64Array(n * 3), veS = new Float64Array(n * 3);
  for (let f = 0; f < nf; f++) { if (m.alive && !m.alive[f]) continue; const o = fB + f; for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; vfN[v]++; vfS[v * 3] += OP[o * 3]; vfS[v * 3 + 1] += OP[o * 3 + 1]; vfS[v * 3 + 2] += OP[o * 3 + 2]; } }
  for (let e = 0; e < ne; e++) { const a = ea[e], b = eb[e]; for (let c = 0; c < 3; c++) { const mid = (P[a * 3 + c] + P[b * 3 + c]) * 0.5; veS[a * 3 + c] += mid; veS[b * 3 + c] += mid; } veN[a]++; veN[b]++; if (ef1[e] < 0) { if (bN[a] === 0) bA[a] = b; else bB[a] = b; bN[a]++; if (bN[b] === 0) bA[b] = a; else bB[b] = a; bN[b]++; } }
  for (let v = 0; v < n; v++) {
    for (let c = 0; c < CS; c++) OC[v * CS + c] = C[v * CS + c]; out.WI.set(m.WI.subarray(v * 4, v * 4 + 4), v * 4); out.WW.set(m.WW.subarray(v * 4, v * 4 + 4), v * 4); if (m.cv) out.cv[v] = m.cv[v];
    if (vfN[v] === 0) { OP[v * 3] = P[v * 3]; OP[v * 3 + 1] = P[v * 3 + 1]; OP[v * 3 + 2] = P[v * 3 + 2]; continue; }
    if (bN[v] >= 2) { if (bN[v] > 2) for (let c = 0; c < 3; c++) OP[v * 3 + c] = P[v * 3 + c]; else for (let c = 0; c < 3; c++) OP[v * 3 + c] = P[v * 3 + c] * 0.75 + (P[bA[v] * 3 + c] + P[bB[v] * 3 + c]) * 0.125; continue; }
    const k = veN[v]; for (let c = 0; c < 3; c++) OP[v * 3 + c] = (vfS[v * 3 + c] / vfN[v]) / k + (veS[v * 3 + c] / k) * 2 / k + P[v * 3 + c] * (k - 3) / k;
  }
  // faces (orientation preserved)
  const OF = out.F, OFT = out.FT; if (m.alive) { out.alive = new Uint8Array(nf * 4); }
  for (let f = 0; f < nf; f++) {
    if (m.alive && !m.alive[f]) continue;
    for (let k = 0; k < 4; k++) { const v = F[f * 4 + k], eN = fe[f * 4 + k], eP = fe[f * 4 + ((k + 3) & 3)]; const q = (f * 4 + k) * 4; OF[q] = v; OF[q + 1] = n + eN; OF[q + 2] = fB + f; OF[q + 3] = n + eP; OFT[f * 4 + k] = m.FT[f]; if (out.alive) out.alive[f * 4 + k] = 1; }
  }
  void nfl; return out;
}
/** adaptive interpolatory refinement: every edge longer than `tau` gets a midpoint (4-point rule along the grid line where the vertex is regular); quads are split
 *  in 2 (opposite long edges) or 4 — limb quads only along the limb, torso quads both ways. Original vertices keep their positions and indices. */
export function refineAdaptive(m, tau = 0.0186) {
  const n = m.n, nf = m.nf, F = m.F, P = m.P; const emap = new Map(); const ea = [], eb = [], fe = new Int32Array(nf * 4); let ne = 0;
  for (let f = 0; f < nf; f++) { for (let k = 0; k < 4; k++) { const a = F[f * 4 + k], b = F[f * 4 + ((k + 1) & 3)]; const key = a < b ? a * n + b : b * n + a; let e = emap.get(key); if (e === undefined) { e = ne++; emap.set(key, e); ea.push(a); eb.push(b); } fe[f * 4 + k] = e; } }
  const mark = new Uint8Array(ne); for (let e = 0; e < ne; e++) { const a = ea[e], b = eb[e]; const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; if (dx * dx + dy * dy + dz * dz > tau * tau) mark[e] = 1; }
  for (let ch = 1, it = 0; ch && it < 12; it++) { ch = 0; for (let f = 0; f < nf; f++) { const m0 = mark[fe[f * 4]], m1 = mark[fe[f * 4 + 1]], m2 = mark[fe[f * 4 + 2]], m3 = mark[fe[f * 4 + 3]]; const c = m0 + m1 + m2 + m3; if (c === 0 || c === 4 || (c === 2 && ((m0 && m2) || (m1 && m3)))) continue; for (let k = 0; k < 4; k++) if (!mark[fe[f * 4 + k]]) { mark[fe[f * 4 + k]] = 1; ch = 1; } } }
  // adjacency for the 4-point rule
  const deg = new Int32Array(n + 1); for (let e = 0; e < ne; e++) { deg[ea[e]]++; deg[eb[e]]++; } const off = new Int32Array(n + 1); for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg[i]; const nb = new Int32Array(off[n]); const fl = new Int32Array(n);
  for (let e = 0; e < ne; e++) { nb[off[ea[e]] + fl[ea[e]]++] = eb[e]; nb[off[eb[e]] + fl[eb[e]]++] = ea[e]; }
  const mid = new Int32Array(ne).fill(-1); let nm = 0; for (let e = 0; e < ne; e++) if (mark[e]) mid[e] = n + nm++;
  // faces → new faces
  const nq = []; const ctr = new Int32Array(nf).fill(-1); let nc = 0; for (let f = 0; f < nf; f++) if (mark[fe[f * 4]] && mark[fe[f * 4 + 1]] && mark[fe[f * 4 + 2]] && mark[fe[f * 4 + 3]]) ctr[f] = n + nm + nc++;
  const tags = [];
  for (let f = 0; f < nf; f++) {
    const v0 = F[f * 4], v1 = F[f * 4 + 1], v2 = F[f * 4 + 2], v3 = F[f * 4 + 3], m0 = mid[fe[f * 4]], m1 = mid[fe[f * 4 + 1]], m2 = mid[fe[f * 4 + 2]], m3 = mid[fe[f * 4 + 3]]; const t = m.FT[f];
    if (ctr[f] >= 0) { const c = ctr[f]; nq.push(v0, m0, c, m3); nq.push(m0, v1, m1, c); nq.push(c, m1, v2, m2); nq.push(m3, c, m2, v3); tags.push(t, t, t, t); }
    else if (m0 >= 0 && m2 >= 0) { nq.push(v0, m0, m2, v3); nq.push(m0, v1, v2, m2); tags.push(t, t); }
    else if (m1 >= 0 && m3 >= 0) { nq.push(v0, v1, m1, m3); nq.push(m3, m1, v2, v3); tags.push(t, t); }
    else { nq.push(v0, v1, v2, v3); tags.push(t); }
  }
  const nO = n + nm + nc, out = new CMesh(nO, tags.length); out.level = m.level + 1; out.cv = m.cv ? new Uint8Array(nO) : null; out.F.set(nq); out.FT.set(tags);
  const OP = out.P, OC = out.C, C = m.C; for (let v = 0; v < n; v++) { OP[v * 3] = P[v * 3]; OP[v * 3 + 1] = P[v * 3 + 1]; OP[v * 3 + 2] = P[v * 3 + 2]; for (let c = 0; c < CS; c++) OC[v * CS + c] = C[v * CS + c]; out.WI.set(m.WI.subarray(v * 4, v * 4 + 4), v * 4); out.WW.set(m.WW.subarray(v * 4, v * 4 + 4), v * 4); if (m.cv) out.cv[v] = m.cv[v]; }
  const far = (a, b) => { // neighbour of a most opposite to b (collinear continuation), or -1
    let bq = -1, bd = -0.72; const dx = P[b * 3] - P[a * 3], dy = P[b * 3 + 1] - P[a * 3 + 1], dz = P[b * 3 + 2] - P[a * 3 + 2]; const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    for (let q = off[a]; q < off[a + 1]; q++) { const u = nb[q]; if (u === b) continue; const ex = P[u * 3] - P[a * 3], ey = P[u * 3 + 1] - P[a * 3 + 1], ez = P[u * 3 + 2] - P[a * 3 + 2]; const el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1; const d = (dx * ex + dy * ey + dz * ez) / (dl * el); if (d < bd) { bd = d; bq = u; } } return bq; };
  const two = [0, 0];
  for (let e = 0; e < ne; e++) { const o = mid[e]; if (o < 0) continue; const a = ea[e], b = eb[e]; const pa = far(a, b), pb = far(b, a);
    for (let c = 0; c < 3; c++) OP[o * 3 + c] = (pa >= 0 && pb >= 0 && deg[a] === 4 && deg[b] === 4) ? (9 * (P[a * 3 + c] + P[b * 3 + c]) - P[pa * 3 + c] - P[pb * 3 + c]) / 16 : (P[a * 3 + c] + P[b * 3 + c]) * 0.5;
    for (let c = 0; c < CS; c++) OC[o * CS + c] = (C[a * CS + c] + C[b * CS + c]) * 0.5; two[0] = a; two[1] = b; mergeW(out, o, m, two, 2); if (m.cv) out.cv[o] = m.cv[a] && m.cv[b] ? 1 : 0; }
  const four = [0, 0, 0, 0];
  for (let f = 0; f < nf; f++) { const c = ctr[f]; if (c < 0) continue; for (let k = 0; k < 4; k++) { const o = mid[fe[f * 4 + k]]; OP[c * 3] += OP[o * 3] * 0.25; OP[c * 3 + 1] += OP[o * 3 + 1] * 0.25; OP[c * 3 + 2] += OP[o * 3 + 2] * 0.25; const v = F[f * 4 + k]; for (let q = 0; q < CS; q++) OC[c * CS + q] += C[v * CS + q] * 0.25; four[k] = F[f * 4 + k]; }
    mergeW(out, c, m, four, 4); if (m.cv) { let cv = 1; for (let k = 0; k < 4; k++) if (!m.cv[F[f * 4 + k]]) cv = 0; out.cv[c] = cv; } }
  return out;
}
/** boundary loops of a mesh: arrays of vertex indices following the face winding (interior on the left), plus per-loop open-side direction */
export function boundaryLoops(m) {
  const n = m.n, F = m.F, al = m.alive, nf = m.nf; const keys = new Float64Array(nf * 4); let nk = 0;
  for (let f = 0; f < nf; f++) { if (al && !al[f]) continue; for (let k = 0; k < 4; k++) { const a = F[f * 4 + k], b = F[f * 4 + ((k + 1) & 3)]; keys[nk++] = a < b ? a * n + b : b * n + a; } }
  const sk = keys.subarray(0, nk).sort(); const single = new Set(); for (let i = 0; i < nk; i++) { const eq = (i + 1 < nk && sk[i + 1] === sk[i]) || (i > 0 && sk[i - 1] === sk[i]); if (!eq) single.add(sk[i]); }
  if (!single.size) return [];
  const next = new Map(); const face = new Map();
  for (let f = 0; f < nf; f++) { if (al && !al[f]) continue; for (let k = 0; k < 4; k++) { const a = F[f * 4 + k], b = F[f * 4 + ((k + 1) & 3)]; if (single.has(a < b ? a * n + b : b * n + a)) { let l = next.get(a); if (!l) next.set(a, (l = [])); l.push(b); face.set(a * n + b, f); } } }
  const loops = []; const used = new Set(); const P = m.P;
  for (const [a0] of next) {
    if (used.has(a0)) continue; const L = []; let a = a0, guard = 0;
    while (a !== undefined && !used.has(a) && guard++ < 100000) { used.add(a); L.push(a); const nx = next.get(a); if (!nx) break; a = nx.find((x) => !used.has(x)) ?? nx[0]; if (a === a0) break; }
    if (L.length >= 3) { let ox = 0, oy = 0, oz = 0; for (let i = 0; i < L.length; i++) { const a1 = L[i], b1 = L[(i + 1) % L.length]; const f = face.get(a1 * n + b1); if (f === undefined) continue; let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; } ox += (P[a1 * 3] + P[b1 * 3]) * 0.5 - cx * 0.25; oy += (P[a1 * 3 + 1] + P[b1 * 3 + 1]) * 0.5 - cy * 0.25; oz += (P[a1 * 3 + 2] + P[b1 * 3 + 2]) * 0.5 - cz * 0.25; }
      const l = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1; let cx = 0, cy = 0, cz = 0; for (const v of L) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; }
      loops.push({ v: L, open: [ox / l, oy / l, oz / l], c: [cx / L.length, cy / L.length, cz / L.length] }); }
  }
  return loops;
}

// ------------------------------------------------------------------ body collision proxy (level-2 body surface) + garment layer heights
export class BodyProxy {
  constructor(bodyCage) {
    // the proxy is the body without hands / fingers (gloves are tight and never simulated), level 2 (~2 cm)
    const sel = bodyCage.select((t) => t.part !== 'finger' && t.part !== 'thumb' && t.part !== 'hand'); const cm = subdivQuads(CMesh.fromCage(sel.subdivideN(1))); const n = cm.n; this.n = n;
    this.P = Float32Array.from(cm.P); this.N = cm.normals();
    // adjacency (CSR)
    const deg = new Int32Array(n + 1); const seen = new Set(); const pairs = [];
    for (let f = 0; f < cm.nf; f++) for (let k = 0; k < 4; k++) { const a = cm.F[f * 4 + k], b = cm.F[f * 4 + ((k + 1) & 3)]; const key = a < b ? a * n + b : b * n + a; if (seen.has(key)) continue; seen.add(key); pairs.push(a, b); deg[a]++; deg[b]++; }
    this.off = new Int32Array(n + 1); for (let i = 0; i < n; i++) this.off[i + 1] = this.off[i] + deg[i]; this.adj = new Int32Array(this.off[n]); const fill = new Int32Array(n);
    for (let i = 0; i < pairs.length; i += 2) { const a = pairs[i], b = pairs[i + 1]; this.adj[this.off[a] + fill[a]++] = b; this.adj[this.off[b] + fill[b]++] = a; }
    // spatial grid (4 cm cells, CSR)
    const c = this.cell = 0.04; let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9; for (let v = 0; v < n; v++) { const x = this.P[v * 3], y = this.P[v * 3 + 1], z = this.P[v * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    this.gx0 = Math.floor(x0 / c) - 2; this.gy0 = Math.floor(y0 / c) - 2; this.gz0 = Math.floor(z0 / c) - 2; this.gnx = Math.floor(x1 / c) - this.gx0 + 3; this.gny = Math.floor(y1 / c) - this.gy0 + 3; this.gnz = Math.floor(z1 / c) - this.gz0 + 3;
    const nc = this.gnx * this.gny * this.gnz, cnt = new Int32Array(nc + 1); const cid = new Int32Array(n); for (let v = 0; v < n; v++) { const id = this._cell(this.P[v * 3], this.P[v * 3 + 1], this.P[v * 3 + 2]); cid[v] = id; cnt[id + 1]++; }
    for (let i = 0; i < nc; i++) cnt[i + 1] += cnt[i]; this.goff = cnt; this.glist = new Int32Array(n); const fp = new Int32Array(nc); for (let v = 0; v < n; v++) this.glist[cnt[cid[v]] + fp[cid[v]]++] = v;
  }
  _cell(x, y, z) { const c = this.cell; return ((Math.floor(z / c) - this.gz0) * this.gny + (Math.floor(y / c) - this.gy0)) * this.gnx + (Math.floor(x / c) - this.gx0); }
  nearestInit(x, y, z) {
    const c = this.cell, ci = Math.floor(x / c) - this.gx0, cj = Math.floor(y / c) - this.gy0, ck = Math.floor(z / c) - this.gz0; let best = -1, bd = 1e9; const P = this.P;
    for (let r = 1; r <= 4 && best < 0; r++) for (let k = Math.max(0, ck - r); k <= Math.min(this.gnz - 1, ck + r); k++) for (let j = Math.max(0, cj - r); j <= Math.min(this.gny - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(this.gnx - 1, ci + r); i++) { const id = (k * this.gny + j) * this.gnx + i; for (let q = this.goff[id]; q < this.goff[id + 1]; q++) { const v = this.glist[q]; const dx = P[v * 3] - x, dy = P[v * 3 + 1] - y, dz = P[v * 3 + 2] - z; const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = v; } } }
    return best < 0 ? 0 : best;
  }
  /** hill-climb from vertex v to the nearest proxy vertex of (x,y,z) */
  climb(v, x, y, z) {
    const P = this.P, adj = this.adj, off = this.off; let bd = (P[v * 3] - x) ** 2 + (P[v * 3 + 1] - y) ** 2 + (P[v * 3 + 2] - z) ** 2;
    for (let it = 0; it < 30; it++) { let bv = v, imp = false; for (let q = off[v], e = off[v + 1]; q < e; q++) { const u = adj[q]; const dx = P[u * 3] - x, dy = P[u * 3 + 1] - y, dz = P[u * 3 + 2] - z; const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bv = u; imp = true; } } if (!imp) break; v = bv; }
    return v;
  }
}

// ------------------------------------------------------------------ PBD relaxation
/** relax(m, proxy, H, prm): drapes mesh `m` (positions in m.P are modified). Quasi-static position-based dynamics: per-step gravity displacement (fabric weight),
 *  distance (structural + shear) constraints, a Laplacian bending prior toward the fitted shape (stiffness), collision against the body surface + inner layers (H),
 *  skin cling and pins. prm: {steps, iters, weight, stiff, cling, slack, margin, pin: Float32Array} → {compress, hv} */
export function relax(m, proxy, H, prm) {
  const n = m.n, nf = m.nf, F = m.F, P = m.P; const base = Float64Array.from(P);
  const emap = new Map(); const ea = [], eb = [], ek = [];
  const add = (a, b, k) => { const key = a < b ? a * n + b : b * n + a; if (emap.has(key)) return; emap.set(key, ea.length); ea.push(a); eb.push(b); ek.push(k); };
  for (let f = 0; f < nf; f++) { if (m.alive && !m.alive[f]) continue; for (let k = 0; k < 4; k++) add(F[f * 4 + k], F[f * 4 + ((k + 1) & 3)], 0); add(F[f * 4], F[f * 4 + 2], 1); add(F[f * 4 + 1], F[f * 4 + 3], 1); }
  const ne = ea.length, EA = Int32Array.from(ea), EB = Int32Array.from(eb), EK = Uint8Array.from(ek); const L = new Float32Array(ne);
  // CSR neighbours (structural edges only)
  const deg = new Int32Array(n + 1); for (let e = 0; e < ne; e++) if (!EK[e]) { deg[EA[e]]++; deg[EB[e]]++; } const off = new Int32Array(n + 1); for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg[i]; const nb = new Int32Array(off[n]); const fl = new Int32Array(n);
  for (let e = 0; e < ne; e++) if (!EK[e]) { const a = EA[e], b = EB[e]; nb[off[a] + fl[a]++] = b; nb[off[b] + fl[b]++] = a; }
  const slack = prm.slack ?? 0;
  for (let e = 0; e < ne; e++) { const a = EA[e], b = EB[e]; const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; L[e] = Math.sqrt(dx * dx + dy * dy + dz * dz) * (1 + slack); }
  const lapB = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const c = off[i + 1] - off[i]; if (!c) continue; let sx = 0, sy = 0, sz = 0; for (let q = off[i]; q < off[i + 1]; q++) { const j = nb[q]; sx += base[j * 3]; sy += base[j * 3 + 1]; sz += base[j * 3 + 2]; } lapB[i * 3] = base[i * 3] - sx / c; lapB[i * 3 + 1] = base[i * 3 + 1] - sy / c; lapB[i * 3 + 2] = base[i * 3 + 2] - sz / c; }
  const pin = prm.pin; const fixed = new Uint8Array(n); if (pin) for (let i = 0; i < n; i++) fixed[i] = pin[i] >= 0.999 ? 1 : 0;
  const X = Float64Array.from(P), Q = Float64Array.from(P), Vel = new Float64Array(n * 3), tmp = new Float64Array(n * 3), hv = new Int32Array(n), dcl = new Float32Array(n);
  for (let i = 0; i < n; i++) hv[i] = proxy.nearestInit(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const steps = prm.steps ?? 5, iters = prm.iters ?? 3, damp = prm.damp ?? 0.72, g = 0.0011 * (prm.weight ?? 1), kb = prm.stiff ?? 0.2, cling = prm.cling ?? 0.1, margin = prm.margin ?? 0.005;
  const PP = proxy.P, PN = proxy.N;
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < n; i++) {
      if (fixed[i]) { Q[i * 3] = X[i * 3] = base[i * 3]; Q[i * 3 + 1] = X[i * 3 + 1] = base[i * 3 + 1]; Q[i * 3 + 2] = X[i * 3 + 2] = base[i * 3 + 2]; Vel[i * 3] = Vel[i * 3 + 1] = Vel[i * 3 + 2] = 0; continue; }
      Vel[i * 3] *= damp; Vel[i * 3 + 1] = Vel[i * 3 + 1] * damp - g; Vel[i * 3 + 2] *= damp; Q[i * 3] = X[i * 3] + Vel[i * 3]; Q[i * 3 + 1] = X[i * 3 + 1] + Vel[i * 3 + 1]; Q[i * 3 + 2] = X[i * 3 + 2] + Vel[i * 3 + 2];
      hv[i] = proxy.climb(hv[i], Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]);
    }
    for (let it = 0; it < iters; it++) {
      for (let q = 0; q < ne; q++) {
        const e = (it & 1) ? ne - 1 - q : q; const a = EA[e], b = EB[e]; const dx = Q[b * 3] - Q[a * 3], dy = Q[b * 3 + 1] - Q[a * 3 + 1], dz = Q[b * 3 + 2] - Q[a * 3 + 2]; const len = Math.sqrt(dx * dx + dy * dy + dz * dz); if (len < 1e-9) continue;
        const wa = fixed[a] ? 0 : 1, wb = fixed[b] ? 0 : 1; const ws = wa + wb; if (!ws) continue;
        const diff = (len - L[e]) / len; const k = EK[e] ? 0.5 : (diff < 0 ? 0.7 : 1.0); const ca = wa / ws * diff * k, cb = wb / ws * diff * k;
        Q[a * 3] += dx * ca; Q[a * 3 + 1] += dy * ca; Q[a * 3 + 2] += dz * ca; Q[b * 3] -= dx * cb; Q[b * 3 + 1] -= dy * cb; Q[b * 3 + 2] -= dz * cb;
      }
      if (kb > 0) {
        for (let i = 0; i < n; i++) { const c = off[i + 1] - off[i]; if (!c || fixed[i]) { tmp[i * 3] = Q[i * 3]; tmp[i * 3 + 1] = Q[i * 3 + 1]; tmp[i * 3 + 2] = Q[i * 3 + 2]; continue; } let sx = 0, sy = 0, sz = 0; for (let q = off[i]; q < off[i + 1]; q++) { const j = nb[q]; sx += Q[j * 3]; sy += Q[j * 3 + 1]; sz += Q[j * 3 + 2]; } const k = 1 / c;
          tmp[i * 3] = Q[i * 3] + kb * (sx * k + lapB[i * 3] - Q[i * 3]); tmp[i * 3 + 1] = Q[i * 3 + 1] + kb * (sy * k + lapB[i * 3 + 1] - Q[i * 3 + 1]); tmp[i * 3 + 2] = Q[i * 3 + 2] + kb * (sz * k + lapB[i * 3 + 2] - Q[i * 3 + 2]); }
        Q.set(tmp);
      }
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue; const v = hv[i]; const nx = PN[v * 3], ny = PN[v * 3 + 1], nz = PN[v * 3 + 2]; const d = (Q[i * 3] - PP[v * 3]) * nx + (Q[i * 3 + 1] - PP[v * 3 + 1]) * ny + (Q[i * 3 + 2] - PP[v * 3 + 2]) * nz - (H[v] + margin);
        if (d < 0) { Q[i * 3] -= d * nx; Q[i * 3 + 1] -= d * ny; Q[i * 3 + 2] -= d * nz; }
        let sp = pin ? pin[i] : 0; if (d < 0.012) { const c = cling * (1 - (d > 0 ? d : 0) / 0.012); if (c > sp) sp = c; } if (sp > 0) { Q[i * 3] += (base[i * 3] - Q[i * 3]) * sp; Q[i * 3 + 1] += (base[i * 3 + 1] - Q[i * 3 + 1]) * sp; Q[i * 3 + 2] += (base[i * 3 + 2] - Q[i * 3 + 2]) * sp; }
      }
    }
    for (let i = 0; i < n * 3; i++) { Vel[i] = Q[i] - X[i]; X[i] = Q[i]; }
  }
  P.set(X);
  const comp = new Float32Array(n), cn = new Uint16Array(n);
  for (let e = 0; e < ne; e++) { if (EK[e]) continue; const a = EA[e], b = EB[e]; const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; const c = Math.max(0, (L[e] - Math.sqrt(dx * dx + dy * dy + dz * dz)) / L[e]); comp[a] += c; comp[b] += c; cn[a]++; cn[b]++; }
  for (let i = 0; i < n; i++) if (cn[i]) comp[i] /= cn[i];
  void dcl; return { compress: comp, hv };
}

// ------------------------------------------------------------------ garment orchestration
export const PROF = { sim: 0, refine: 0, fold: 0, emit: 0, hem: 0, proxy: 0, detail: 0, cull: 0, n: 0, log: [] }; const _now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const getProxy = (bodyCage) => { if (bodyCage._proxy) return bodyCage._proxy; const t = _now(); bodyCage._proxy = new BodyProxy(bodyCage); PROF.proxy += _now() - t; return bodyCage._proxy; };
const FITS = {
  tight: { slack: 0, stiff: 0.55, cling: 0.6, weight: 0.5, flare: 0, blouse: 0, ease: 0, legEase: 0, amp: 0.45, loose: 0.1, sim: false },
  normal: { slack: 0.012, stiff: 0.28, cling: 0.16, weight: 0.85, flare: 0.012, blouse: 0.012, ease: 0.003, legEase: 0.002, amp: 1.25, loose: 0.55, sim: true },
  loose: { slack: 0.028, stiff: 0.14, cling: 0.07, weight: 1.15, flare: 0.026, blouse: 0.028, ease: 0.006, legEase: 0.006, amp: 1.7, loose: 1.1, sim: true },
};
const FAB = { canvas: [1.25, 1.1], denim: [1.35, 1.2], weave: [1, 0.9], knit: [0.5, 0.85], fleece: [0.4, 0.9], quilt: [1.7, 1.0], oilskin: [1.4, 1.3], ripstop: [1.05, 0.8], hivis: [0.9, 0.8], stripes: [1, 0.9], check: [1, 0.9], plush: [0.5, 1.0], none: [1, 0.9] };
/** which body zones a garment covers (from its cage face tags) */
export function classify(sub) {
  const c = { sh: false, legs: false, arms: false, feet: false, hand: false, torso: false, minSeg: 99, maxSeg: -1, shin: 99 };
  for (const t of sub.T) { if (t.part === 'torso') { c.torso = true; c.minSeg = Math.min(c.minSeg, t.seg); c.maxSeg = Math.max(c.maxSeg, t.seg); if (t.seg >= 7) c.sh = true; } else if (t.part === 'upperarm' || t.part === 'forearm') c.arms = true; else if (t.part === 'thigh') c.legs = true; else if (t.part === 'shin') { c.legs = true; c.shin = Math.min(c.shin, t.seg); } else if (t.part === 'foot') c.feet = true; else if (t.part === 'hand' || t.part === 'finger' || t.part === 'thumb') c.hand = true; }
  c.top = c.sh || c.arms; return c;
}
/** fit + fabric parameters of a garment (opts.fit 'tight'|'normal'|'loose', opts.stiff, opts.weight, opts.wet override the defaults) */
export function fitParams(o, G, cls) {
  const kind = typeof G.kind === 'string' ? G.kind : 'custom'; const off = (G.o.offset ?? G.g.offset) + (G.o.loose ?? G.g.loose) * 0.5;
  let fit = G.o.fit ?? G.g.fit; if (!fit) fit = off < 0.0105 ? 'tight' : off < 0.028 ? 'normal' : 'loose'; if (!FITS[fit]) fit = 'normal';
  const prm = { ...FITS[fit], fit, kind }; const pat = G.o.pattern ?? G.g.mat?.pattern ?? 'none'; const fab = FAB[pat] || FAB.none;
  prm.stiff = clamp01((G.o.stiff ?? prm.stiff * fab[0])); prm.weight *= (G.o.weight ?? fab[1]);
  const wet = clamp01(G.o.wet ?? ((o.variant?.layers?.wet ?? 0) + (o.variant?.wet ? 0.4 : 0))); prm.wet = wet;
  prm.weight *= 1 + 0.6 * wet; prm.cling = Math.min(0.9, prm.cling + 0.3 * wet); prm.stiff *= 1 - 0.5 * wet; prm.amp *= 1 + 0.15 * wet;
  if (G.o.foldAmp != null) prm.amp *= G.o.foldAmp; if (G.o.flare != null) prm.flare = G.o.flare; if (G.o.blouse != null) prm.blouse = G.o.blouse; if (G.o.ease != null) prm.ease = G.o.ease; if (G.o.sim != null) prm.sim = !!G.o.sim;
  prm.puff = G.o.puff || null; prm.belt = o.info.belt ?? null; if (cls && prm.belt != null && !(cls.minSeg <= 2 || cls.top)) prm.belt = null;
  { const cuffOpt = G.o.cuff ?? G.g.cuff; prm.elastic = cuffOpt === 'elastic' || (!cuffOpt && (kind === 'jacket' || kind === 'coveralls' || kind === 'custom') && (pat === 'ripstop' || pat === 'quilt' || pat === 'fleece' || pat === 'hivis')); } prm.stack = G.o.stack ?? (cls && cls.legs && cls.shin <= 8 ? (prm.fit === 'tight' ? 0.3 : prm.fit === 'loose' ? 1 : 0.7) : 0);
  prm.cuff = G.o.cuffBunch ?? (prm.elastic ? 1 : 0.5); prm.sag = prm.sim ? (G.o.sag ?? 1) : 0; prm.thick = G.o.thick ?? (kind === 'boots' || kind === 'wellies' ? 0.004 : 0.0022);
  return prm;
}
/** analytic drape shape applied to the level-2 shell before the relaxation: hem flare, blousing over the belt, sleeve / trouser ease, sag */
function shapeMesh(m, fr, cls, prm) {
  const n = m.n, P = m.P, N = m.normals(); const g = fr.g, s = fr.s; let yHem = 1e9; for (let i = 0; i < n; i++) if (g[i] === 0 && fr.gw[i] > 0.7 && P[i * 3 + 1] < yHem) yHem = P[i * 3 + 1];
  const belt = prm.belt;
  for (let i = 0; i < n; i++) {
    if (m.cv && m.cv[i]) continue; const q = g[i], y = P[i * 3 + 1], S = s[i]; let e = 0, dy = 0;
    if (q === 0 && cls.top && !cls.legs) { e += prm.flare * Math.pow(smooth(Math.min(1.24, yHem + 0.3), yHem, y), 1.2); dy -= prm.sag * 0.02 * smooth(yHem + 0.22, yHem, y); }
    if (q === 0 && belt != null) e += prm.blouse * Math.exp(-(((y - (belt + 0.075)) / 0.055) ** 2));
    if (q >= 2 && q <= 5) { let ease = prm.ease * smooth(0.05, 0.42, S) - 0.006 * smooth(0.3, 0.56, S); if (prm.elastic) ease *= 1 - 0.85 * smooth(0.43, 0.56, S); e += ease; dy -= prm.sag * 0.009 * smooth(0.28, 0.58, S); }
    if (q >= 8 && q <= 11) { e += prm.legEase * smooth(0.0, 0.5, S) + (q >= 10 ? prm.legEase * 0.6 * smooth(0.5, 0.75, S) : 0); }
    if (e !== 0) { P[i * 3] += N[i * 3] * e; P[i * 3 + 1] += N[i * 3 + 1] * e; P[i * 3 + 2] += N[i * 3 + 2] * e; } if (dy !== 0) P[i * 3 + 1] += dy;
  }
}
/** where the garment is held (1 = fixed to the shell, fractions = friction support) */
function pinField(m, fr, cls, prm) {
  const n = m.n, pin = new Float32Array(n), P = m.P;
  for (let i = 0; i < n; i++) {
    if (m.cv && m.cv[i]) { pin[i] = 1; continue; } const q = fr.g[i], y = P[i * 3 + 1], S = fr.s[i]; let p = 0;
    if (cls.top) { if (q === 0) p = Math.max(p, smooth(1.27, 1.385, y)); else if (q === 2 || q === 3) p = Math.max(p, smooth(0.17, 0.05, S)); else if (q === 1) p = 1; }
    if (cls.legs) { if (q === 0) p = Math.max(p, smooth(0.92, 1.0, y)); else if (q === 8 || q === 9) p = Math.max(p, 0.5 * smooth(0.16, 0.0, S)); }
    if (prm.belt != null && q === 0 && (cls.top || cls.legs)) p = Math.max(p, 0.8 * Math.exp(-(((y - prm.belt) / 0.03) ** 2)));
    pin[i] = p;
  }
  return pin;
}
function meanEdge(m) { let s = 0, c = 0; const P = m.P, F = m.F, st = Math.max(1, Math.floor(m.nf / 400)); for (let f = 0; f < m.nf; f += st) for (let k = 0; k < 4; k++) { const a = F[f * 4 + k], b = F[f * 4 + ((k + 1) & 3)]; const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; s += Math.sqrt(dx * dx + dy * dy + dz * dz); c++; } return s / Math.max(1, c); }
/** simulate (once per look; cached in o._cc) the level-2 drape of a garment shell */
function simulate(o, G, sub, cls, prm, proxy, skey) {
  const T0 = _now(); const cc = o._cc; const L1 = sub.subdivCached(1, cc, skey + 'L1'); let m = CMesh.fromCage(L1); const T1 = _now(); const up = meanEdge(m) > 0.03;
  // the relaxation runs on the coarse (level-1, ~4 cm) shell — it only needs the low-frequency drape + collisions — and is then refined to level 2 (Catmull-Clark) with a final push-out pass
  const fr = computeFrames(m); if (prm.sim) shapeMesh(m, fr, cls, prm); const H = o._layerH; const T2 = _now();
  if (prm.sim) { const pin = pinField(m, fr, cls, prm); const res = relax(m, proxy, H, { steps: G.o.simSteps ?? 6, iters: 3, weight: prm.weight, stiff: prm.stiff, cling: prm.cling, slack: prm.slack, margin: 0.007, pin }); for (let i = 0; i < m.n; i++) { m.C[i * CS + 7] = pin[i]; m.C[i * CS + 6] = res.compress[i]; } }
  const T3 = _now(); if (up) m = subdivQuads(m); const n = m.n; const refine = meanEdge(m) > 0.0165;
  // level-2 push-out, gap (height above the body / underlying layers) + this garment's layer heights for the garments outside it
  const PP = proxy.P, PN = proxy.N, contrib = new Float32Array(proxy.n); const P = m.P;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; const v = proxy.climb(proxy.nearestInit(x, y, z), x, y, z); let h = (x - PP[v * 3]) * PN[v * 3] + (y - PP[v * 3 + 1]) * PN[v * 3 + 1] + (z - PP[v * 3 + 2]) * PN[v * 3 + 2]; const minH = H[v] + 0.005;
    if (prm.sim && h < minH) { const d = minH - h; P[i * 3] += PN[v * 3] * d; P[i * 3 + 1] += PN[v * 3 + 1] * d; P[i * 3 + 2] += PN[v * 3 + 2] * d; h = minH; }
    m.C[i * CS + 5] = Math.max(0, h - H[v] - 0.005); const top = h + prm.thick * 0.5 + 0.004 * prm.amp; if (top > contrib[v]) contrib[v] = top;
  }
  const tearSites = pickTears(o, G, m, cls, prm, skey); const T5 = _now(); if (PROF.trace) PROF.log.push(`  [l1 ${(T1 - T0).toFixed(0)} shape ${(T2 - T1).toFixed(0)} relax ${(T3 - T2).toFixed(0)} l2+push ${(T5 - T3).toFixed(0)}]`);
  return { m2: m, contrib, refine, tears: tearSites };
}
/** allocation-free GeoBuf.vert for compact meshes: weights straight from typed arrays (top-4, normalised) */
const _wc = [0, 0, 0];
GeoBuf.prototype.vertS = function (px, py, pz, nx, ny, nz, wi, ww, o, spec, ao, cr, cg, cb) {
  if (this.wear && spec === this.wearSpec) { _wc[0] = cr; _wc[1] = cg; _wc[2] = cb; ao *= this.wear(px, py, pz, nx, ny, nz, _wc); cr = _wc[0]; cg = _wc[1]; cb = _wc[2]; } // grime of the layer this vertex belongs to (wear.js)
  const i = this.n++; this.P.push(px, py, pz); this.N.push(nx, ny, nz);
  const q0 = Math.round(ww[o] * 255), q1 = Math.round(ww[o + 1] * 255), q2 = Math.round(ww[o + 2] * 255), q3 = Math.round(ww[o + 3] * 255); const sum = q0 + q1 + q2 + q3;
  this.SI.push(wi[o], wi[o + 1], wi[o + 2], wi[o + 3]); this.SW.push(q0 + 255 - sum, q1, q2, q3); this.COL.push(cr, cg, cb, 255);
  this.MAT.push(spec.mat[0], spec.mat[1], spec.mat[2], spec.mat[3]); this.MAT2.push(spec.mat2[0], spec.mat2[1], spec.mat2[2], spec.mat2[3]);
  const reg = this.forceRegion >= 0 ? this.forceRegion : BONE_REGION[wi[o]]; this.AUX.push(Math.round(Math.max(0, Math.min(1, ao * spec.ao)) * 255), reg, Math.round(Math.max(0, Math.min(1, spec.sway)) * 255), Math.round(Math.max(0, Math.min(1, spec.frost)) * 255)); this.REGV.push(reg);
  return i;
};
const _vert0 = GeoBuf.prototype.vert;
GeoBuf.prototype.vert = function (p, nrm, w, spec, ao = 1, region = -1, col = null) {
  if (this.wear && spec === this.wearSpec) { const c = col || spec.col; _wc[0] = c[0]; _wc[1] = c[1]; _wc[2] = c[2]; const am = this.wear(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2], nrm.x ?? nrm[0], nrm.y ?? nrm[1], nrm.z ?? nrm[2], _wc); return _vert0.call(this, p, nrm, w, spec, ao * am, region, [_wc[0], _wc[1], _wc[2]]); }
  return _vert0.call(this, p, nrm, w, spec, ao, region, col);
};
/** face-list → GeoBuf: emits vertices used by live faces, returns the vertex map. Vertex AO = paint AO × fold cavity. */
export function emitMesh(o, m, N, spec, opt = {}) {
  const buf = o.buf, n = m.n, P = m.P, F = m.F, al = m.alive; const map = new Int32Array(n).fill(-1); const cav = new Float32Array(n), cn = new Uint8Array(n); const sx = new Float64Array(n * 3);
  for (let f = 0; f < m.nf; f++) { if (al && !al[f]) continue; for (let k = 0; k < 4; k++) { const a = F[f * 4 + k], b = F[f * 4 + ((k + 1) & 3)]; sx[a * 3] += P[b * 3]; sx[a * 3 + 1] += P[b * 3 + 1]; sx[a * 3 + 2] += P[b * 3 + 2]; cn[a]++; sx[b * 3] += P[a * 3]; sx[b * 3 + 1] += P[a * 3 + 1]; sx[b * 3 + 2] += P[a * 3 + 2]; cn[b]++; } }
  for (let i = 0; i < n; i++) if (cn[i]) { const k = 1 / cn[i]; const d = ((sx[i * 3] * k - P[i * 3]) * N[i * 3] + (sx[i * 3 + 1] * k - P[i * 3 + 1]) * N[i * 3 + 1] + (sx[i * 3 + 2] * k - P[i * 3 + 2]) * N[i * 3 + 2]); cav[i] = clamp01(d / (opt.cavRange ?? 0.006)); }
  const cavK = opt.cavK ?? 0.5; const wear = opt.wear || null; const w0 = buf.wear; buf.wear = null;
  for (let f = 0; f < m.nf; f++) {
    if (al && !al[f]) continue; const id = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) { const v = F[f * 4 + k]; let bi = map[v]; if (bi < 0) { const c = m.C, pc0 = c[v * CS], pc1 = c[v * CS + 1], pc2 = c[v * CS + 2]; let cr = Math.min(255, spec.col[0] * pc0), cg = Math.min(255, spec.col[1] * pc1), cb = Math.min(255, spec.col[2] * pc2); let ao = c[v * CS + 3] * (1 - cavK * cav[v]);
      if (wear) { _wc[0] = cr; _wc[1] = cg; _wc[2] = cb; ao *= wear(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], N[v * 3], N[v * 3 + 1], N[v * 3 + 2], _wc); cr = _wc[0]; cg = _wc[1]; cb = _wc[2]; }
      bi = map[v] = buf.vertS(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], N[v * 3], N[v * 3 + 1], N[v * 3 + 2], m.WI, m.WW, v * 4, spec, ao, Math.round(cr), Math.round(cg), Math.round(cb)); } id[k] = bi; }
    buf.quad(id[0], id[1], id[2], id[3]);
  }
  buf.wear = w0; return map;
}
/** worn / torn cloth. pickTears (at simulation time, cached) chooses the sites — knees, elbows, shoulder, seat, belly, hem — deterministically per garment; applyTears cuts the
 *  ragged holes into the final mesh (hole rims get a thick frayed edge in stitch.js addHems). Inner layers are not culled behind a tear, the skin stays visible underneath. */
function pickTears(o, G, m, cls, prm, seedKey) {
  const wear = G.o.wear ?? G.g.wear ?? 0.3; if (G.o.tears === false || wear < 0.3 || prm.kind === 'gloves' || prm.kind === 'boots' || prm.kind === 'socks' || prm.kind === 'wellies') return [];
  const nT = Math.min(5, Math.round((wear - 0.2) * 5.5 * (cls.legs && cls.top ? 1.25 : 1))); if (nT <= 0) return [];
  let h = 2166136261; for (let i = 0; i < seedKey.length; i++) h = Math.imul(h ^ seedKey.charCodeAt(i), 16777619); const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const cand = []; const side = () => (rnd() < 0.5 ? -1 : 1);
  if (cls.legs) { const sx = side(); cand.push([sx * 0.097, 0.5, -0.05, 0.034, 0.046], [-sx * 0.097, 0.47, -0.05, 0.026, 0.036], [side() * 0.105, 0.72, -0.07, 0.03, 0.05], [side() * 0.08, 0.85, 0.09, 0.03, 0.04], [side() * 0.1, 0.27, -0.02, 0.025, 0.04]); }
  if (cls.top) { const A = RIG.arm[side() < 0 ? 'L' : 'R']; cand.push([A.el[0] + A.sx * 0.02, A.el[1] - 0.01, A.el[2] + 0.035, 0.03, 0.04], [side() * 0.17, 1.44, 0.01, 0.035, 0.03], [side() * 0.07, 1.16, -0.1, 0.04, 0.05], [side() * 0.1, 1.0, -0.09, 0.035, 0.04], [side() * 0.05, 1.22, 0.11, 0.04, 0.05]); }
  const sites = [], P = m.P, n = m.n; const N = m.normals();
  for (let k = 0; k < nT && cand.length; k++) {
    const [ax, ay, az, rx, ry] = cand.splice(Math.floor(rnd() * cand.length), 1)[0];
    let bv = -1, bd = 0.02; for (let v = 0; v < n; v++) { const dx = P[v * 3] - ax, dy = P[v * 3 + 1] - ay, dz = P[v * 3 + 2] - az; const d = dx * dx + dy * dy + dz * dz; if (d < bd && !(m.cv && m.cv[v])) { bd = d; bv = v; } } if (bv < 0) continue;
    const nx = N[bv * 3], ny = N[bv * 3 + 1], nz = N[bv * 3 + 2]; let t1 = [-nx * ny, 1 - ny * ny, -nz * ny]; { const l = Math.hypot(t1[0], t1[1], t1[2]) || 1; t1 = [t1[0] / l, t1[1] / l, t1[2] / l]; } const t2 = [ny * t1[2] - nz * t1[1], nz * t1[0] - nx * t1[2], nx * t1[1] - ny * t1[0]];
    const size = 0.75 + rnd() * 0.75; const rip = rnd() < 0.38; const RX = rip ? rx * 0.36 : rx, RY = rip ? ry * 2.7 : ry; sites.push({ c: [P[bv * 3], P[bv * 3 + 1], P[bv * 3 + 2]], n: [nx, ny, nz], t1, t2, rx: RX, ry: RY, size, ph: rnd() * 6.3, seed: (rnd() * 200) | 0, r: Math.max(RX, RY) * size * 1.3, rip });
  }
  return sites;
}
function applyTears(m, sites) {
  if (!sites.length) return; if (!m.alive) m.alive = new Uint8Array(m.nf).fill(1); const P = m.P;
  for (const t of sites) { const [cx, cy, cz] = t.c, [nx, ny, nz] = t.n, { t1, t2, rx, ry, size, ph, seed } = t;
    for (let f = 0; f < m.nf; f++) { if (!m.alive[f]) continue; let qx = 0, qy = 0, qz = 0; for (let q = 0; q < 4; q++) { const v = m.F[f * 4 + q]; qx += P[v * 3]; qy += P[v * 3 + 1]; qz += P[v * 3 + 2]; } qx *= 0.25; qy *= 0.25; qz *= 0.25; const dx = qx - cx, dy = qy - cy, dz = qz - cz; if (Math.abs(dx * nx + dy * ny + dz * nz) > 0.03) continue;
      const u = (dx * t2[0] + dy * t2[1] + dz * t2[2]) / (rx * size), v2 = (dx * t1[0] + dy * t1[1] + dz * t1[2]) / (ry * size); const r2 = Math.sqrt(u * u + v2 * v2); if (r2 > 1.7) continue; const th = Math.atan2(v2, u);
      const T = 0.92 + 0.34 * noise3(qx * 61, qy * 61, qz * 61, seed) + 0.22 * Math.sin(th * 3 + ph) + 0.12 * Math.sin(th * 7 + ph * 2); if (r2 < T) m.alive[f] = 0; } }
}
/**
 * Build a garment as a draped cloth mesh (LOD 0 / 1). `sub` = level-0 shell cage (offsets, V-neck and collar already applied; no hems).
 * Returns the layer record {G, m, N, map, prm, cls}.
 */
export function clothSim(o, G, sub, spec, ctx) {
  const proxy = getProxy(ctx.bodyCage); if (!o._layerH) o._layerH = new Float32Array(proxy.n);
  const cls = classify(sub), prm = fitParams(o, G, cls); const skey = 'cs|' + o._garmentSig + '|' + G.i;
  let S = o._cc.get(skey); if (!S) { const t = _now(); S = simulate(o, G, sub, cls, prm, proxy, skey); o._cc.set(skey, S); const dt = _now() - t; PROF.sim += dt; PROF.n++; if (PROF.trace) PROF.log.push(`${prm.kind}:${prm.fit} sim=${prm.sim} n=${S.m2.n} nf=${S.m2.nf} refine=${S.refine} ${dt.toFixed(0)}ms`); }
  const H = o._layerH; const con = S.contrib; for (let v = 0; v < proxy.n; v++) if (con[v] > H[v]) H[v] = con[v]; // garments further out collide with this one
  return { G, prm, cls, spec, S, n2: S.m2.n };
}
/** refine + folds + tears of a simulated garment → layer {m, …} (cached per outfit signature and LOD; culled faces are flagged in S.cull) */
export function clothShape(o, L0) {
  const { G, prm, cls, spec, S, n2 } = L0; const lod = o.lod; const fkey = 'cf|' + o._garmentSig + '|' + G.i + '|' + lod; const cached = o._cc.get(fkey);
  if (cached) { if (cached.sites.length) (o._tearSites || (o._tearSites = [])).push(...cached.sites); return { G, m: cached.m, prm, cls, spec, n2, frames: cached.fr, tears: cached.sites.length > 0 }; }
  const tr = _now(); const base = S.m2.clone(); if (S.cull) for (let f = 0; f < base.nf; f++) if (S.cull[f]) base.FT[f] |= 2; // hidden under an outer garment: children inherit the flag
  let m = lod === 0 && S.refine ? refineAdaptive(base) : base; PROF.refine += _now() - tr; const tf = _now();
  const seed = (G.i * 53 + o._garmentSig.length * 7) & 255; const fr = computeFrames(m); const N0 = m.normals();
  if (prm.puff) { applyBaffles(m, N0, { period: prm.puff.period ?? 0.105, bulge: Math.min(prm.puff.bulge ?? 0.02, 0.02) * 0.78, seed, fr }); applyFolds(m, m.normals(), { amp: prm.amp * 0.45, loose: prm.loose, seed, belt: prm.belt, stack: prm.stack, cuff: prm.cuff, lod, fr, stiff: prm.stiff }); }
  else applyFolds(m, N0, { amp: prm.amp, loose: prm.loose, seed, belt: prm.belt, stack: prm.stack, cuff: prm.cuff, lod, fr, stiff: prm.stiff, boot: G.g.boot ? (G.g.mat?.mat === 'leather' ? 1 : 0.55) : 0 });
  if (G.g.boot) { const P = m.P; for (let v = 0; v < m.n; v++) if (P[v * 3 + 1] < 0.004) P[v * 3 + 1] = 0.004; } // boots stand on the ground plane (big offsets / sag would sink the sole edge into the floor)
  if (G.g.boot) { const P = m.P; for (let v = 0; v < m.n; v++) { const z = P[v * 3 + 2]; if (z < -0.06 && P[v * 3 + 1] < 0.1) { const t = smooth(-0.06, -0.18, z); const cx = Math.sign(P[v * 3]) * 0.105; P[v * 3] = cx + (P[v * 3] - cx) * (1 + 0.13 * t); P[v * 3 + 1] += 0.011 * t * smooth(0.0, 0.05, P[v * 3 + 1]); } } } // rounder, taller toe box than the body's pointed foot
  if (G.o.cutSleeve) { const cs = G.o.cutSleeve; const gA = cs.side === 'R' ? [3, 5] : [2, 4]; if (!m.alive) m.alive = new Uint8Array(m.nf).fill(1); for (let f = 0; f < m.nf; f++) { let all = true; for (let k = 0; k < 4 && all; k++) { const v = m.F[f * 4 + k]; if (!(fr.g[v] === gA[0] || fr.g[v] === gA[1]) || fr.s[v] < (cs.at ?? 0.34)) all = false; } if (all) m.alive[f] = 0; } } // cut / missing sleeve
  const sites = (S.tears || []).map((t) => ({ c: t.c, r: t.r })); if (sites.length) { applyTears(m, S.tears); (o._tearSites || (o._tearSites = [])).push(...sites); }
  { let any = false; for (let f = 0; f < m.nf; f++) if (m.FT[f] & 2) { if (!m.alive) m.alive = new Uint8Array(m.nf).fill(1); m.alive[f] = 0; any = true; } if (any) { m.culled = new Uint8Array(m.nf); for (let f = 0; f < m.nf; f++) if (m.FT[f] & 2) m.culled[f] = 1; } }
  PROF.fold += _now() - tf; o._cc.set(fkey, { m, fr, sites }); return { G, m, prm, cls, spec, n2, frames: fr, tears: sites.length > 0 };
}
export const buildClothGarment = (o, G, sub, spec, ctx) => clothShape(o, clothSim(o, G, sub, spec, ctx));
/** emit a finished layer into the GeoBuf, register its surface for snapping / detail placement */
export function finishLayer(o, layer, opt = {}) {
  const te = _now(); const m = layer.m; const N = m._N || (m._N = m.normals()); layer.N = N; // meshes are shared by the looks of a variant: normals / loops / surface grid are computed once
  layer.wearFn = makeWear(o, layer.G, layer.prm, layer.cls, o._tearSites || [], (o._garmentSig || '') + '|' + layer.G.i + '|' + (o._wseed ?? 0)); layer.map = emitMesh(o, m, N, layer.spec, { ...opt, wear: layer.wearFn });
  o.buf.wear = layer.wearFn; o.buf.wearSpec = layer.spec; // hems + construction details of this layer get the same grime
  const n = layer.n2 ?? m.n; for (let v = 0; v < n; v++) if (layer.map[v] >= 0) o._pi.add(m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2], m.wOf(v).map(([b, w]) => [b, w]));
  (o._layers || (o._layers = [])).push(layer); PROF.emit += _now() - te; if (PROF.trace) { let q = 0; for (let f = 0; f < m.nf; f++) if (!m.alive || m.alive[f]) q++; PROF.log.push(`L${o.lod}:${layer.prm.kind}:${q * 2}t`); } return layer;
}
