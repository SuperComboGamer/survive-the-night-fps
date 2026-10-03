// Zombie geometry core:
//   GeoBuf   — accumulates skinned triangles with packed per-vertex material data (one buffer per LOD).
//   Cage     — quad-dominant control cage with dense per-vertex skin weights + paint channels, Catmull-Clark subdivision
//              (boundary rules), so the whole body (torso, shoulders, crotch, finger webs, neck) is ONE continuous skin — no gaps at
//              joints. Garments are offset shells of cage face-regions subdivided the same way (they share the body's weights,
//              therefore never poke through while animating).
//   finalize — splits triangles by dismemberment region, packs attributes, concatenates LODs into one BufferGeometry whose
//              index is [LOD0][LOD1][LOD2]; each zombie picks its range per frame via drawRange (main pass and shadow pass).
import * as THREE from 'three';
import { NB, BI, RIG, PARENT } from './rig.js';

// ------------------------------------------------------------------ material ids (mirrored in shading.js)
export const MID = { skin: 0, cloth: 1, leather: 2, rubber: 3, metal: 4, paint: 5, hair: 6, teeth: 7, mouth: 8, flesh: 9, bone: 10, emissive: 11, glass: 12, fur: 13, crystal: 14, rope: 15, nail: 16, eye: 17, plastic: 18 };
// fabric/print patterns (aMat2.z → shader)
export const PAT = { none: 0, weave: 1, denim: 2, canvas: 3, knit: 4, quilt: 5, stripes: 6, check: 7, oilskin: 8, plush: 9, ripstop: 10, fleece: 11, hivis: 12 };

// ------------------------------------------------------------------ dismemberment regions (one bit each in uHide)
export const REG = { core: 0, head: 1, uarmL: 2, larmL: 3, uarmR: 4, larmR: 5, thighL: 6, llegL: 7, thighR: 8, llegR: 9,
  capNeck: 10, capShoulderL: 11, capElbowL: 12, capShoulderR: 13, capElbowR: 14, capHipL: 15, capKneeL: 16, capHipR: 17, capKneeR: 18,
  gibUarmL: 19, gibLarmL: 20, gibUarmR: 21, gibLarmR: 22, gibThighL: 23, gibLlegL: 24, gibThighR: 25, gibLlegR: 26, balloon: 27, hat: 28, hair: 29 }; // hat: headwear (can be left off per spawn)
export const CAP_MASK = (() => { let m = 0; for (let r = REG.capNeck; r <= REG.gibLlegR; r++) m |= 1 << r; return m; })();
/** region of a bone (dominant-weight bone of a vertex) */
export const BONE_REGION = new Uint8Array(NB);
for (let i = 0; i < NB; i++) {
  const n = RIG.bones[i].name, s = n.endsWith('.L') ? 'L' : n.endsWith('.R') ? 'R' : '';
  let r = REG.core;
  if (n === 'head' || n === 'jaw') r = REG.head;
  else if (n.startsWith('upperarm')) r = s === 'L' ? REG.uarmL : REG.uarmR;
  else if (/^(forearm|hand|index|middle|ring|pinky|thumb)/.test(n)) r = s === 'L' ? REG.larmL : REG.larmR;
  else if (n.startsWith('thigh')) r = s === 'L' ? REG.thighL : REG.thighR;
  else if (/^(calf|foot|toe)/.test(n)) r = s === 'L' ? REG.llegL : REG.llegR;
  BONE_REGION[i] = r;
}

// ------------------------------------------------------------------ material spec → packed bytes
const _c = new THREE.Color();
/** Normalise a user material spec {mat, color, rough, metal, wear, dirt, pattern, emissive, sheen, param, ao, sway} */
export function matSpec(m = {}) {
  if (m._packed) return m;
  const id = typeof m.mat === 'number' ? m.mat : (MID[m.mat || 'cloth'] ?? 1);
  _c.set(m.color ?? 0x808080); // hex are sRGB; keep sRGB bytes (shader linearises)
  const toS = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  const srgb = _c.clone().convertLinearToSRGB();
  const defRough = { 0: 0.62, 1: 0.9, 2: 0.55, 3: 0.82, 4: 0.42, 5: 0.45, 6: 0.6, 7: 0.3, 8: 0.35, 9: 0.3, 10: 0.7, 11: 0.5, 12: 0.06, 13: 0.95, 14: 0.12, 15: 0.9, 16: 0.4, 17: 0.1, 18: 0.4 }[id] ?? 0.7;
  const defMetal = id === 4 ? 1 : 0;
  const pat = typeof m.pattern === 'number' ? m.pattern : PAT[m.pattern || 'none'] ?? 0;
  return {
    _packed: true, id,
    col: [toS(srgb.r), toS(srgb.g), toS(srgb.b)],
    mat: [id, toS(m.rough ?? defRough), toS(m.metal ?? defMetal), toS(m.emissive != null ? m.emissive / 16 : (m.param ?? 0))],
    mat2: [toS(m.wear ?? 0.3), toS(m.dirt ?? 0.3), pat, toS(m.sheen ?? m.scale ?? 0.5)],
    ao: m.ao ?? 1, sway: m.sway ?? 0, frost: m.frost ?? 1,
  };
}

// ------------------------------------------------------------------ GeoBuf: output accumulator for one LOD
export class GeoBuf {
  constructor() { this.P = []; this.N = []; this.SI = []; this.SW = []; this.COL = []; this.MAT = []; this.MAT2 = []; this.AUX = []; this.I = []; this.REGV = []; this.n = 0; this.forceRegion = -1; }
  /** add a vertex: p,nrm arrays/Vector3; w: {bone:w} | [[boneIndex, w],...] ; spec: packed material; aux: {ao, sway, frost}; region override */
  vert(p, nrm, w, spec, ao = 1, region = -1, col = null) {
    const i = this.n++;
    this.P.push(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]); this.N.push(nrm.x ?? nrm[0], nrm.y ?? nrm[1], nrm.z ?? nrm[2]);
    // top-4 weights, quantised to bytes that sum to exactly 255
    const top = topWeights(w);
    const q = [0, 0, 0, 0]; let sum = 0; for (let k = 0; k < 4; k++) { q[k] = Math.round(top[k][1] * 255); sum += q[k]; } q[0] += 255 - sum;
    this.SI.push(top[0][0], top[1][0], top[2][0], top[3][0]); this.SW.push(q[0], q[1], q[2], q[3]);
    const c = col || spec.col; this.COL.push(c[0], c[1], c[2], 255);
    this.MAT.push(spec.mat[0], spec.mat[1], spec.mat[2], spec.mat[3]); this.MAT2.push(spec.mat2[0], spec.mat2[1], spec.mat2[2], spec.mat2[3]);
    const reg = region >= 0 ? region : this.forceRegion >= 0 ? this.forceRegion : BONE_REGION[top[0][0]];
    this.AUX.push(Math.round(Math.max(0, Math.min(1, ao * spec.ao)) * 255), reg, Math.round(Math.max(0, Math.min(1, spec.sway)) * 255), Math.round(Math.max(0, Math.min(1, spec.frost)) * 255));
    this.REGV.push(reg);
    return i;
  }
  tri(a, b, c) { this.I.push(a, b, c); }
  quad(a, b, c, d) { this.I.push(a, b, c, a, c, d); }
  get triCount() { return this.I.length / 3; }
}
const _ti = new Int32Array(4), _tv = new Float64Array(4);
const _top = [[0, 0], [0, 0], [0, 0], [0, 0]];
/** top-4 weights (normalised) → shared scratch [[bone, w] x4] (consume immediately) */
function topWeights(w) {
  _ti.fill(0); _tv.fill(0);
  const push = (b, v) => { if (!(v > 1e-5)) return; for (let k = 0; k < 4; k++) if (v > _tv[k]) { for (let j = 3; j > k; j--) { _tv[j] = _tv[j - 1]; _ti[j] = _ti[j - 1]; } _tv[k] = v; _ti[k] = b; return; } };
  if (w instanceof Float32Array || w instanceof Float64Array) { for (let b = 0; b < w.length; b++) if (w[b] > 1e-5) push(b, w[b]); }
  else if (Array.isArray(w)) { for (const e of w) push(typeof e[0] === 'string' ? BI[e[0]] : e[0], e[1]); }
  else if (typeof w === 'number') push(w, 1);
  else if (typeof w === 'string') push(BI[w], 1);
  else for (const k in w) push(BI[k] ?? +k, w[k]);
  let s = _tv[0] + _tv[1] + _tv[2] + _tv[3]; if (s <= 0) { _ti[0] = BI.chest; _tv[0] = 1; s = 1; }
  for (let k = 0; k < 4; k++) { _top[k][0] = _ti[k]; _top[k][1] = _tv[k] / s; }
  return _top;
}

// ------------------------------------------------------------------ Cage + Catmull-Clark
// Record layout per vertex: [x y z | NB weights | 5 paint channels (r g b ao frost)]
const PCH = 5; export const REC = 3 + NB + PCH;
export class Cage {
  constructor() { this.R = []; this.F = []; this.T = []; this.nv = 0; this.crease = new Set(); }
  /** add a vertex. w: {bone: weight} (dense internally); paint: [r,g,b,ao,frost] linear 0..1 (optional) */
  v(p, w, paint = null) {
    const r = new Float64Array(REC); r[0] = p[0] ?? p.x; r[1] = p[1] ?? p.y; r[2] = p[2] ?? p.z;
    if (w instanceof Float64Array || w instanceof Float32Array) { for (let b = 0; b < NB; b++) r[3 + b] = w[b]; }
    else { let s = 0; for (const k in w) { const bi = BI[k] ?? +k; r[3 + bi] += w[k]; s += w[k]; } if (s > 0) for (let b = 0; b < NB; b++) r[3 + b] /= s; }
    const pc = paint || [1, 1, 1, 1, 1]; for (let k = 0; k < PCH; k++) r[3 + NB + k] = pc[k] ?? 1;
    this.R.push(r); return this.nv++;
  }
  f(idx, tag) { this.F.push(idx.slice()); this.T.push(tag); return this.F.length - 1; }
  pos(i) { const r = this.R[i]; return new THREE.Vector3(r[0], r[1], r[2]); }
  /** mark an edge as sharp (kept as a crease through subdivision) */
  sharp(a, b) { this.crease.add(a < b ? a * 1e7 + b : b * 1e7 + a); }
  /** one Catmull-Clark step → new Cage (quads). Records live in one flat buffer (no per-vertex allocation). */
  subdivide() {
    const R = this.R, F = this.F, nv = this.nv, out = new Cage();
    const edges = new Map(); const eList = [];
    const key = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
    for (let fi = 0; fi < F.length; fi++) { const f = F[fi]; for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length], kk = key(a, b); let e = edges.get(kk); if (!e) { e = { a, b, f0: fi, f1: -1, n: 1, idx: -1, crease: this.crease.has(kk) }; edges.set(kk, e); eList.push(e); } else { e.f1 = fi; e.n++; } } }
    const nE = eList.length, nF = F.length, nOut = nv + nE + nF;
    const buf = new Float64Array(nOut * REC); const OR = out.R = new Array(nOut); for (let i = 0; i < nOut; i++) OR[i] = buf.subarray(i * REC, (i + 1) * REC); out.nv = nOut;
    const fBase = nv + nE;
    // face points
    for (let fi = 0; fi < nF; fi++) { const f = F[fi], r = OR[fBase + fi], k = 1 / f.length; for (const v of f) addTo(r, R[v], k); }
    // adjacency counts / sums
    const vfN = new Int32Array(nv), veN = new Int32Array(nv), bN = new Int32Array(nv), bA = new Int32Array(nv).fill(-1), bB = new Int32Array(nv).fill(-1);
    const vfSum = new Float64Array(nv * REC), veSum = new Float64Array(nv * REC);
    for (let fi = 0; fi < nF; fi++) { const fr = OR[fBase + fi]; for (const v of F[fi]) { vfN[v]++; const o = v * REC; for (let i = 0; i < REC; i++) vfSum[o + i] += fr[i]; } }
    for (const e of eList) {
      for (const v of [e.a, e.b]) { veN[v]++; const o = v * REC, ra = R[e.a], rb = R[e.b]; for (let i = 0; i < REC; i++) veSum[o + i] += (ra[i] + rb[i]) * 0.5; }
      if (e.n === 1 || e.crease) { if (bN[e.a] === 0) bA[e.a] = e.b; else bB[e.a] = e.b; bN[e.a]++; if (bN[e.b] === 0) bA[e.b] = e.a; else bB[e.b] = e.a; bN[e.b]++; }
    }
    // vertex points
    for (let v = 0; v < nv; v++) {
      const r = OR[v], rv = R[v];
      if (vfN[v] === 0) { r.set(rv); continue; }
      if (bN[v] >= 2) { if (bN[v] > 2) r.set(rv); else { const ra = R[bA[v]], rb = R[bB[v]]; for (let i = 0; i < REC; i++) r[i] = rv[i] * 0.75 + (ra[i] + rb[i]) * 0.125; } continue; }
      const n = veN[v], kq = 1 / (vfN[v] * n), km = 2 / (n * n), kv = (n - 3) / n, o = v * REC;
      for (let i = 0; i < REC; i++) r[i] = vfSum[o + i] * kq + veSum[o + i] * km + rv[i] * kv;
    }
    // edge points
    for (let i = 0; i < nE; i++) {
      const e = eList[i], r = OR[nv + i]; e.idx = nv + i; const ra = R[e.a], rb = R[e.b];
      if (e.n === 2 && !e.crease) { const f0 = OR[fBase + e.f0], f1 = OR[fBase + e.f1]; for (let j = 0; j < REC; j++) r[j] = (ra[j] + rb[j] + f0[j] + f1[j]) * 0.25; }
      else { for (let j = 0; j < REC; j++) r[j] = (ra[j] + rb[j]) * 0.5; }
      if (e.crease) { out.crease.add(key(e.a, e.idx)); out.crease.add(key(e.idx, e.b)); }
    }
    const OF = out.F = new Array(); const OT = out.T;
    for (let fi = 0; fi < nF; fi++) {
      const f = F[fi], n = f.length, fc = fBase + fi, tg = this.T[fi];
      for (let k = 0; k < n; k++) { const v = f[k], vn = f[(k + 1) % n], vp = f[(k + n - 1) % n]; OF.push([v, edges.get(key(v, vn)).idx, fc, edges.get(key(vp, v)).idx]); OT.push(tg); }
    }
    return out;
  }
  /** area-weighted vertex normals */
  normals() {
    const N = new Float64Array(this.nv * 3), R = this.R;
    for (const f of this.F) {
      const n = f.length; let nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < n; k++) { const a = R[f[k]], b = R[f[(k + 1) % n]]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); } // Newell
      for (const v of f) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; }
    }
    for (let i = 0; i < this.nv; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
    return N;
  }
  /** sub-cage made of the faces passing `sel(tag, faceIndex)` (vertices re-indexed; records copied) */
  select(sel) {
    const out = new Cage(), map = new Map();
    for (let fi = 0; fi < this.F.length; fi++) {
      if (!sel(this.T[fi], fi)) continue;
      const idx = this.F[fi].map((v) => { let m = map.get(v); if (m === undefined) { m = out.nv++; out.R.push(Float64Array.from(this.R[v])); map.set(v, m); } return m; });
      out.F.push(idx); out.T.push(this.T[fi]);
    }
    out.srcMap = map; return out;
  }
  subdivideN(n) { let c = this; for (let i = 0; i < n; i++) c = c.subdivide(); return c; }
  /** deep copy (records in one flat buffer) */
  clone() { const o = new Cage(); const buf = new Float64Array(this.nv * REC); o.R = new Array(this.nv); for (let i = 0; i < this.nv; i++) { const r = buf.subarray(i * REC, (i + 1) * REC); r.set(this.R[i]); o.R[i] = r; } o.nv = this.nv; o.F = this.F; o.T = this.T; o.crease = this.crease; return o; }
  /** subdivide to `level`, reusing a cached level-1 result (shared across LODs of one look) */
  subdivCached(level, cache, key) {
    let l1 = cache && cache.get(key + '#1'); if (!l1) { l1 = this.subdivide(); if (cache) cache.set(key + '#1', l1); }
    // level 0 (LOD2): cage topology with the level-1 vertex points as positions — closer to the smooth limit surface than the
    // raw (inflated) cage, so LOD2 is not bloated / boxy and pops less against LOD1
    if (level === 0) { const c0 = this.clone(); for (let v = 0; v < this.nv; v++) { const r = c0.R[v], q = l1.R[v]; r[0] = q[0]; r[1] = q[1]; r[2] = q[2]; } return c0; }
    if (level === 1) return l1.clone();
    let l2 = cache && cache.get(key + '#2'); if (!l2) { l2 = l1.subdivide(); if (cache) cache.set(key + '#2', l2); } if (level === 2) return l2.clone();
    return l2.subdivideN(level - 2); // level 3+ (bare skin at LOD0): fresh, not cached (used once per look)
  }
  /**
   * Cage fitting: move control vertices so that the subdivided surface passes through the authored positions (Catmull-Clark
   * shrinks convex shapes ~10-30 %). Uses a positions-only subdivision (fast). After fitting, authored numbers = real sizes.
   */
  fit(levels = 2, iters = 4, k = 1.0) {
    const nv = this.nv, target = new Float64Array(nv * 3); for (let v = 0; v < nv; v++) { const r = this.R[v]; target[v * 3] = r[0]; target[v * 3 + 1] = r[1]; target[v * 3 + 2] = r[2]; }
    for (let it = 0; it < iters; it++) {
      const P = subdividePositions(this, levels);
      for (let v = 0; v < nv; v++) { const r = this.R[v]; r[0] += (target[v * 3] - P[v * 3]) * k; r[1] += (target[v * 3 + 1] - P[v * 3 + 1]) * k; r[2] += (target[v * 3 + 2] - P[v * 3 + 2]) * k; }
    }
  }
  /** emit into a GeoBuf: spec(tag) → packed material, paintCol(true) → use cage paint rgb as colour multiplier */
  emit(buf, specFn, { flip = false, normals = null, colFn = null, aoMul = 1, region = -1 } = {}) {
    const N = normals || this.normals();
    const W = new Float32Array(NB);
    // vertices are duplicated per face-material so every triangle carries one material
    const vmap = new Map(); // cage vertex → [[spec, bufIndex], ...]
    const sg = flip ? -1 : 1; const single = new Int32Array(this.nv).fill(-1); let singleSpec = null;
    for (let fi = 0; fi < this.F.length; fi++) {
      const f = this.F[fi], spec = specFn(this.T[fi]); if (!spec) continue;
      if (singleSpec === null) singleSpec = spec;
      const ids = f.map((v) => {
        if (spec === singleSpec && single[v] >= 0) return single[v];
        let lst = vmap.get(v); if (lst) { for (const e of lst) if (e[0] === spec) return e[1]; } else if (spec !== singleSpec) vmap.set(v, (lst = []));
        const r = this.R[v]; for (let b = 0; b < NB; b++) W[b] = r[3 + b];
        const pc = r.subarray(3 + NB); let col = spec.col;
        if (colFn) col = colFn(spec, pc, r); else if (pc[0] !== 1 || pc[1] !== 1 || pc[2] !== 1) col = [Math.min(255, Math.round(spec.col[0] * pc[0])), Math.min(255, Math.round(spec.col[1] * pc[1])), Math.min(255, Math.round(spec.col[2] * pc[2]))];
        const i = buf.vert([r[0], r[1], r[2]], [N[v * 3] * sg, N[v * 3 + 1] * sg, N[v * 3 + 2] * sg], W, spec, pc[3] * aoMul, region, col);
        if (spec === singleSpec) single[v] = i; else lst.push([spec, i]); return i;
      });
      if (ids.length === 4) { if (flip) buf.quad(ids[0], ids[3], ids[2], ids[1]); else buf.quad(ids[0], ids[1], ids[2], ids[3]); }
      else if (ids.length === 3) { if (flip) buf.tri(ids[0], ids[2], ids[1]); else buf.tri(ids[0], ids[1], ids[2]); }
      else for (let k = 1; k < ids.length - 1; k++) { if (flip) buf.tri(ids[0], ids[k + 1], ids[k]); else buf.tri(ids[0], ids[k], ids[k + 1]); }
    }
  }
}
function addTo(r, s, k) { for (let i = 0; i < REC; i++) r[i] += s[i] * k; }
/** positions-only Catmull-Clark (returns Float64Array of the first nv vertex positions after `levels` steps) */
function subdividePositions(cage, levels) {
  let nv = cage.nv, P = new Float64Array(nv * 3); for (let v = 0; v < nv; v++) { const r = cage.R[v]; P[v * 3] = r[0]; P[v * 3 + 1] = r[1]; P[v * 3 + 2] = r[2]; }
  let F = cage.F; const crease0 = cage.crease;
  const orig = nv;
  for (let L = 0; L < levels; L++) {
    const key = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
    const edges = new Map(); const eList = [];
    for (let fi = 0; fi < F.length; fi++) { const f = F[fi]; for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length], kk = key(a, b); let e = edges.get(kk); if (!e) { e = { a, b, f0: fi, f1: -1, idx: 0, crease: L === 0 && crease0.has(kk) }; edges.set(kk, e); eList.push(e); } else e.f1 = fi; } }
    const nF = F.length, FP = new Float64Array(nF * 3);
    for (let fi = 0; fi < nF; fi++) { const f = F[fi]; let x = 0, y = 0, z = 0; for (const v of f) { x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; } FP[fi * 3] = x / f.length; FP[fi * 3 + 1] = y / f.length; FP[fi * 3 + 2] = z / f.length; }
    const nE = eList.length, outN = nv + nE + nF, Q = new Float64Array(outN * 3);
    // vertex points
    const vfS = new Float64Array(nv * 3), vfN = new Int32Array(nv), veS = new Float64Array(nv * 3), veN = new Int32Array(nv), bS = new Float64Array(nv * 3), bN = new Int32Array(nv);
    for (let fi = 0; fi < nF; fi++) for (const v of F[fi]) { vfS[v * 3] += FP[fi * 3]; vfS[v * 3 + 1] += FP[fi * 3 + 1]; vfS[v * 3 + 2] += FP[fi * 3 + 2]; vfN[v]++; }
    for (const e of eList) {
      const mx = (P[e.a * 3] + P[e.b * 3]) * 0.5, my = (P[e.a * 3 + 1] + P[e.b * 3 + 1]) * 0.5, mz = (P[e.a * 3 + 2] + P[e.b * 3 + 2]) * 0.5;
      for (const v of [e.a, e.b]) { veS[v * 3] += mx; veS[v * 3 + 1] += my; veS[v * 3 + 2] += mz; veN[v]++; }
      if (e.f1 < 0 || e.crease) { bS[e.a * 3] += P[e.b * 3]; bS[e.a * 3 + 1] += P[e.b * 3 + 1]; bS[e.a * 3 + 2] += P[e.b * 3 + 2]; bN[e.a]++; bS[e.b * 3] += P[e.a * 3]; bS[e.b * 3 + 1] += P[e.a * 3 + 1]; bS[e.b * 3 + 2] += P[e.a * 3 + 2]; bN[e.b]++; }
    }
    for (let v = 0; v < nv; v++) {
      const n = veN[v];
      if (vfN[v] === 0) { Q[v * 3] = P[v * 3]; Q[v * 3 + 1] = P[v * 3 + 1]; Q[v * 3 + 2] = P[v * 3 + 2]; continue; }
      if (bN[v] >= 2) { if (bN[v] > 2) { Q[v * 3] = P[v * 3]; Q[v * 3 + 1] = P[v * 3 + 1]; Q[v * 3 + 2] = P[v * 3 + 2]; } else for (let c = 0; c < 3; c++) Q[v * 3 + c] = P[v * 3 + c] * 0.75 + bS[v * 3 + c] * 0.125; continue; }
      for (let c = 0; c < 3; c++) Q[v * 3 + c] = (vfS[v * 3 + c] / vfN[v]) / n + (veS[v * 3 + c] / n) * 2 / n + P[v * 3 + c] * (n - 3) / n;
    }
    for (let i = 0; i < nE; i++) { const e = eList[i], o = (nv + i) * 3; e.idx = nv + i;
      if (e.f1 >= 0 && !e.crease) for (let c = 0; c < 3; c++) Q[o + c] = (P[e.a * 3 + c] + P[e.b * 3 + c] + FP[e.f0 * 3 + c] + FP[e.f1 * 3 + c]) * 0.25;
      else for (let c = 0; c < 3; c++) Q[o + c] = (P[e.a * 3 + c] + P[e.b * 3 + c]) * 0.5; }
    for (let fi = 0; fi < nF; fi++) { const o = (nv + nE + fi) * 3; Q[o] = FP[fi * 3]; Q[o + 1] = FP[fi * 3 + 1]; Q[o + 2] = FP[fi * 3 + 2]; }
    if (L === levels - 1) return Q.subarray(0, orig * 3);
    const NF = [];
    for (let fi = 0; fi < nF; fi++) { const f = F[fi], n = f.length; for (let k = 0; k < n; k++) { const v = f[k], vn = f[(k + 1) % n], vp = f[(k + n - 1) % n]; NF.push([v, edges.get(key(v, vn)).idx, nv + nE + fi, edges.get(key(vp, v)).idx]); } }
    F = NF; P = Q; nv = outN;
  }
  return P.subarray(0, orig * 3);
}

// ------------------------------------------------------------------ ring helpers for cage authoring
/** bridge two vertex rings (closed loops) with quads; rings may differ by count (extra verts become triangles). Aligns start. */
export function bridge(cage, A, B, tag, { align = true, open = false } = {}) {
  let b = B;
  if (align && A.length === B.length && !open) { // choose rotation of B minimising distance to A
    let best = 0, bd = Infinity; const n = B.length;
    for (let s = 0; s < n; s++) { let d = 0; for (let k = 0; k < n; k++) { const p = cage.R[A[k]], q = cage.R[B[(k + s) % n]]; d += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; } if (d < bd) { bd = d; best = s; } }
    b = B.map((_, k) => B[(k + best) % n]);
  }
  const na = A.length, nb = b.length;
  if (na === nb) { const m = open ? na - 1 : na; for (let k = 0; k < m; k++) cage.f([A[k], A[(k + 1) % na], b[(k + 1) % nb], b[k]], tag); return; }
  // uneven: walk both loops by parameter, emitting quads where possible and triangles at the extra steps
  let i = 0, j = 0; const ta = (x) => x / na, tb = (x) => x / nb;
  while (i < na || j < nb) {
    const ni = i + 1, nj = j + 1;
    if (i < na && j < nb && Math.abs(ta(ni) - tb(nj)) < 0.5 / Math.max(na, nb)) { cage.f([A[i % na], A[ni % na], b[nj % nb], b[j % nb]], tag); i = ni; j = nj; }
    else if (j >= nb || (i < na && ta(ni) < tb(nj))) { cage.f([A[i % na], A[ni % na], b[j % nb]], tag); i = ni; }
    else { cage.f([A[i % na], b[nj % nb], b[j % nb]], tag); j = nj; }
  }
}
/** close a ring with a fan of quads around a centre vertex (n even) or triangles */
export function capRing(cage, A, centre, w, tag, paint) {
  const c = cage.v(centre, w, paint); const n = A.length;
  if (n % 2 === 0 && n >= 6) { for (let k = 0; k < n; k += 2) cage.f([A[k], A[(k + 1) % n], A[(k + 2) % n], c], tag); }
  else for (let k = 0; k < n; k++) cage.f([A[k], A[(k + 1) % n], c], tag);
  return c;
}

// ------------------------------------------------------------------ finalize: LOD buffers → one BufferGeometry
/**
 * bufs: [GeoBuf LOD0, LOD1, LOD2]. Triangles get a single region (majority of their vertices' regions; ties → most proximal),
 * vertices shared across regions are duplicated so hidden regions collapse cleanly. Returns {geometry, lods:[{start,count}], tris}
 */
/** finalize() = geometryFromArrays(finalizeArrays(bufs)): the arrays stage is THREE-object free, so build workers can post it
 *  (transferable typed arrays) and the IndexedDB cache can store it; the main thread only wraps it (zero-copy). */
export function finalize(bufs) { return geometryFromArrays(finalizeArrays(bufs)); }
const ATTRS = { position: [3, false], normal: [3, false], skinIndex: [4, false], skinWeight: [4, true], aCol: [4, true], aMat: [4, false], aMat2: [4, false], aAux: [4, false] };
export function geometryFromArrays(fa) {
  const g = new THREE.BufferGeometry();
  for (const k in ATTRS) g.setAttribute(k, new THREE.BufferAttribute(fa.attrs[k], ATTRS[k][0], ATTRS[k][1]));
  g.setIndex(new THREE.BufferAttribute(fa.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
  return { geometry: g, lods: fa.lods, verts: fa.verts, tris: fa.tris, info: fa.info ?? null };
}
/** FNV-1a over every attribute + index byte (identity check: worker / cache path vs synchronous path) */
export function geoChecksum(g) {
  let h = 0x811c9dc5; const G = g.geometry || g; const arrs = [...Object.keys(ATTRS).map((k) => G.attributes[k].array), G.index.array];
  for (const a of arrs) { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } }
  return (h >>> 0).toString(16);
}
export function finalizeArrays(bufs) {
  const out = { P: [], N: [], SI: [], SW: [], COL: [], MAT: [], MAT2: [], AUX: [] }; const I = []; const lods = []; let vbase = 0;
  for (const b of bufs) {
    const start = I.length; const remap = new Map(); const own = new Int32Array(b.n).fill(-1); // own[v]: copy of vertex v in its own region (nearly every use); the Map only serves vertices shared across regions
    const copyV = (v, reg) => {
      const key = v * 64 + reg; const isOwn = reg === b.REGV[v]; let r = isOwn ? own[v] : remap.get(key); if (r !== undefined && r >= 0) return r;
      r = vbase++;
      out.P.push(b.P[v * 3], b.P[v * 3 + 1], b.P[v * 3 + 2]); out.N.push(b.N[v * 3], b.N[v * 3 + 1], b.N[v * 3 + 2]);
      for (let k = 0; k < 4; k++) { out.SI.push(b.SI[v * 4 + k]); out.SW.push(b.SW[v * 4 + k]); out.COL.push(b.COL[v * 4 + k]); out.MAT.push(b.MAT[v * 4 + k]); out.MAT2.push(b.MAT2[v * 4 + k]); }
      out.AUX.push(b.AUX[v * 4], reg, b.AUX[v * 4 + 2], b.AUX[v * 4 + 3]);
      if (isOwn) own[v] = r; else remap.set(key, r); return r;
    };
    for (let t = 0; t < b.I.length; t += 3) {
      const a = b.I[t], c = b.I[t + 1], d = b.I[t + 2]; const ra = b.REGV[a], rc = b.REGV[c], rd = b.REGV[d];
      let reg; if (ra === rc || ra === rd) reg = ra; else if (rc === rd) reg = rc; else reg = Math.min(ra, rc, rd);
      I.push(copyV(a, reg), copyV(c, reg), copyV(d, reg));
    }
    lods.push({ start, count: I.length - start });
  }
  const attrs = { position: new Float32Array(out.P), normal: new Float32Array(out.N), skinIndex: new Uint8Array(out.SI), skinWeight: new Uint8Array(out.SW), aCol: new Uint8Array(out.COL), aMat: new Uint8Array(out.MAT), aMat2: new Uint8Array(out.MAT2), aAux: new Uint8Array(out.AUX) };
  return { attrs, index: vbase > 65535 ? new Uint32Array(I) : new Uint16Array(I), lods, verts: vbase, tris: lods.map((l) => l.count / 3) };
}

// ------------------------------------------------------------------ vertex spatial lookup (surface snapping / auto-binding)
export class PointIndex {
  constructor(cell = 0.03) { this.cell = cell; this.map = new Map(); this.pts = []; }
  add(x, y, z, data) { const i = this.pts.length; this.pts.push({ x, y, z, data }); const k = this._k(Math.floor(x / this.cell), Math.floor(y / this.cell), Math.floor(z / this.cell)); let a = this.map.get(k); if (!a) this.map.set(k, (a = [])); a.push(i); }
  _k(i, j, k) { return (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512); }
  /** nearest point within maxR */
  nearest(x, y, z, maxR = 0.2) {
    // expanding cell shells (Chebyshev radius 0, 1, 2 …): stop as soon as no farther shell can hold a closer point (was a full (2r+1)^3 scan per query)
    const c = this.cell, r = Math.ceil(maxR / c), ci = Math.floor(x / c), cj = Math.floor(y / c), ck = Math.floor(z / c); let best = null, bd = maxR * maxR;
    for (let s = 0; s <= r; s++) {
      for (let i = -s; i <= s; i++) for (let j = -s; j <= s; j++) { const edge = s === 0 || i === -s || i === s || j === -s || j === s; for (let k = -s; k <= s; k += (edge ? 1 : 2 * s)) { const a = this.map.get(this._k(ci + i, cj + j, ck + k)); if (!a) continue; for (const pi of a) { const p = this.pts[pi]; const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } } } }
      if (best && bd <= (s * c) * (s * c)) break;
    }
    return best;
  }
  /** outermost surface along dir from origin: max projection among points within `rad` of the ray */
  cast(o, dir, rad = 0.02, maxT = 0.6, window = 0.06) {
    // candidate surface points near the ray; returns the OUTERMOST layer of the FIRST surface met (clothing over skin), ignoring
    // unrelated surfaces further out (shoulders behind a neck band, the other arm, ...)
    const steps = Math.ceil(maxT / this.cell); let first = 1e9; const cand = this._cand || (this._cand = []); cand.length = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s * this.cell, x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t; const c = this.cell, ci = Math.floor(x / c), cj = Math.floor(y / c), ck = Math.floor(z / c);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const a = this.map.get(this._k(ci + i, cj + j, ck + k)); if (!a) continue; for (const pi of a) { const p = this.pts[pi]; const px = p.x - o.x, py = p.y - o.y, pz = p.z - o.z; const tt = px * dir.x + py * dir.y + pz * dir.z; if (tt < 0.005) continue; const qx = px - dir.x * tt, qy = py - dir.y * tt, qz = pz - dir.z * tt; if (qx * qx + qy * qy + qz * qz > rad * rad) continue; cand.push(tt, pi); if (tt < first) first = tt; } }
      if (first < 1e8 && t > first + window + this.cell) break;
    }
    if (first > 1e8) return null; let best = first, bp = null;
    for (let i = 0; i < cand.length; i += 2) { const tt = cand[i]; if (tt <= first + window && tt >= best) { best = tt; bp = this.pts[cand[i + 1]]; } }
    return { t: best, p: bp };
  }
}
export { PARENT };
