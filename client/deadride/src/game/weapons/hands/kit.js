// Hands geometry kit: a skinned triangle accumulator (GB), parametric surfaces (Surf) and the things that are built ON them:
// dense surface grids, raised panels (TPR guards, pads, straps, patches), stitch rows (one small raised thread lozenge per stitch)
// and welts. Everything is bone-weighted rest-pose geometry that is merged into one SkinnedMesh per material.
// Per-vertex data (besides position / normal / uv in metres):
//   color  rgb tint (linear)           aZ = [leather, tpr, strap (1 loop-webbing, 2 hook), thread]   material-zone weights
//   aX = [wear, dirt, perforation, ao]   aJ = [joint id + 1 (0 = none), joint proximity, palmar side (-1..1), 0]  (pose-driven bunching)
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const gs = (x, s) => Math.exp(-(x * x) / (s * s)); // gaussian bump, 1 at 0
export const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
export const hash1 = (n) => { const s = Math.sin(n * 127.1 + 74.7) * 43758.5453123; return s - Math.floor(s); };
const V3 = THREE.Vector3;
const _s0 = new V3(), _s1 = new V3(), _s2 = new V3(), _s3 = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _t = new V3(), _bt = new V3(), _nn = new V3();
const _lc = new THREE.Color();
/** sRGB hex -> linear [r,g,b] */
export const lin = (hex) => { _lc.setHex(hex, THREE.SRGBColorSpace); return [_lc.r, _lc.g, _lc.b]; };
export const ZERO4 = [0, 0, 0, 0];

export class GB {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.SI = []; this.SW = []; this.Z = []; this.X = []; this.J = []; this.I = []; }
  get n() { return this.P.length / 3; }
  /** p, n: Vector3; c [r,g,b]; w [[bone, weight],...]; z, x, j: 4-arrays */
  vert(p, n, u, v, c, w, z, x, j) {
    const i = this.P.length / 3; this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.U.push(u, v); this.C.push(c[0], c[1], c[2]);
    let a = w; if (a.length > 4) a = a.slice().sort((q, r) => r[1] - q[1]).slice(0, 4);
    let s = 0; for (const e of a) s += e[1]; if (s <= 1e-9) { a = [[a[0][0], 1]]; s = 1; }
    for (let k = 0; k < 4; k++) { const e = a[k]; this.SI.push(e ? e[0] : 0); this.SW.push(e ? e[1] / s : 0); }
    this.Z.push(z[0], z[1], z[2], z[3]); this.X.push(x[0], x[1], x[2], x[3]); const jj = j || ZERO4; this.J.push(jj[0], jj[1], jj[2], jj[3]);
    return i;
  }
  tri(a, b, c) { // wind by the average vertex normal
    const P = this.P, N = this.N; const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; if (cx * cx + cy * cy + cz * cz < 1e-18) return;
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (cx * nx + cy * ny + cz * nz >= 0) this.I.push(a, b, c); else this.I.push(a, c, b);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  /** append src mirrored in X (left hand) with bones remapped */
  mirrorFrom(src, boneMap) {
    const base = this.n, n = src.n;
    for (let k = 0; k < n; k++) {
      this.P.push(-src.P[k * 3], src.P[k * 3 + 1], src.P[k * 3 + 2]); this.N.push(-src.N[k * 3], src.N[k * 3 + 1], src.N[k * 3 + 2]); this.U.push(src.U[k * 2], src.U[k * 2 + 1]);
      for (let j = 0; j < 3; j++) this.C.push(src.C[k * 3 + j]); for (let j = 0; j < 4; j++) { this.SI.push(boneMap(src.SI[k * 4 + j])); this.SW.push(src.SW[k * 4 + j]); this.Z.push(src.Z[k * 4 + j]); this.X.push(src.X[k * 4 + j]); this.J.push(src.J[k * 4 + j]); }
    }
    for (let k = 0; k < src.I.length; k += 3) this.I.push(base + src.I[k], base + src.I[k + 2], base + src.I[k + 1]);
  }
  append(src) { const base = this.n; for (const k of ['P', 'N', 'U', 'C', 'SI', 'SW', 'Z', 'X', 'J']) for (const v of src[k]) this[k].push(v); for (const i of src.I) this.I.push(base + i); }
  /** this (right hand) + its X-mirror (left hand, bones remapped) as ONE BufferGeometry, built with typed-array copies */
  geometryPair(boneMap) {
    const n = this.n, T = n * 2; const A = (Ctor, k, m) => new Ctor(T * m); const P = A(Float32Array, 0, 3), N = A(Float32Array, 0, 3), U = A(Float32Array, 0, 2), C = A(Float32Array, 0, 3), Z = A(Float32Array, 0, 4), X = A(Float32Array, 0, 4), J = A(Float32Array, 0, 4), SI = A(Uint16Array, 0, 4), SW = A(Float32Array, 0, 4);
    P.set(this.P); N.set(this.N); U.set(this.U); C.set(this.C); Z.set(this.Z); X.set(this.X); J.set(this.J); SI.set(this.SI); SW.set(this.SW);
    const s = this; for (let k = 0; k < n; k++) { P[(n + k) * 3] = -s.P[k * 3]; P[(n + k) * 3 + 1] = s.P[k * 3 + 1]; P[(n + k) * 3 + 2] = s.P[k * 3 + 2]; N[(n + k) * 3] = -s.N[k * 3]; N[(n + k) * 3 + 1] = s.N[k * 3 + 1]; N[(n + k) * 3 + 2] = s.N[k * 3 + 2]; }
    U.set(this.U, n * 2); C.set(this.C, n * 3); Z.set(this.Z, n * 4); X.set(this.X, n * 4); J.set(this.J, n * 4); SW.set(this.SW, n * 4); for (let k = 0; k < n * 4; k++) SI[n * 4 + k] = boneMap(s.SI[k]);
    const m = this.I.length; const I = T > 65535 ? new Uint32Array(m * 2) : new Uint16Array(m * 2); I.set(this.I); for (let k = 0; k < m; k += 3) { I[m + k] = n + this.I[k]; I[m + k + 1] = n + this.I[k + 2]; I[m + k + 2] = n + this.I[k + 1]; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('aZ', new THREE.BufferAttribute(Z, 4)); g.setAttribute('aX', new THREE.BufferAttribute(X, 4)); g.setAttribute('aJ', new THREE.BufferAttribute(J, 4)); g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeBoundingSphere(); return g;
  }
  geometry() {
    const g = new THREE.BufferGeometry(); const f = (a, k) => g.setAttribute(a, new THREE.Float32BufferAttribute(this[k], a === 'position' || a === 'normal' || a === 'color' ? 3 : a === 'uv' ? 2 : 4));
    f('position', 'P'); f('normal', 'N'); f('uv', 'U'); f('color', 'C'); f('aZ', 'Z'); f('aX', 'X'); f('aJ', 'J');
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1)); g.computeBoundingSphere(); return g;
  }
}

/** Parametric surface: f(u, v, out) -> rest position; c(u, out) -> section centre (outward test); w(u, v, p) -> bone weights */
export class Surf {
  constructor(f, c, w, { du = 2e-4, dv = 2e-3 } = {}) { this.f = f; this.c = c; this.w = w; this.du = du; this.dv = dv; }
  pos(u, v, out = new V3()) { return this.f(u, v, out); }
  /** position + outward normal with 3 evaluations (forward differences) */
  frame(u, v, P, N) { this.f(u, v, P); this.f(u + this.du, v, _s0); this.f(u, v + this.dv, _s2); _s0.sub(P); _s2.sub(P); N.crossVectors(_s2, _s0); if (N.lengthSq() < 1e-24) N.set(0, 1, 0); N.normalize(); this.c(u, _s1); _s3.subVectors(P, _s1); if (N.dot(_s3) < 0) N.negate(); return N; }
  nrm(u, v, out = new V3()) {
    const du = this.du, dv = this.dv; this.f(u + du, v, _s0); this.f(u - du, v, _s1); this.f(u, v + dv, _s2); this.f(u, v - dv, _s3);
    _s0.sub(_s1); _s2.sub(_s3); out.crossVectors(_s2, _s0); if (out.lengthSq() < 1e-24) out.set(0, 1, 0); out.normalize();
    this.f(u, v, _s0); this.c(u, _s1); _s0.sub(_s1); if (out.dot(_s0) < 0) out.negate(); return out;
  }
}
const DEF = { c: [1, 1, 1], z: [0, 0, 0, 0], x: [0, 0, 0, 1], j: ZERO4 };
/**
 * Dense grid over a surface. us = rows (u values), vs = columns (a closed turn repeats the first column at +TAU so uv stays continuous).
 * attr(i, j, u, v, p) -> {c, w, z, x, j}; off(u, v, i, j) -> metres along the surface normal (raised layers / welts)
 */
export function surfGrid(gb, S, us, vs, attr, { off = null, uvScale = 1, flip = false, cap = false } = {}) {
  const nR = us.length, nC = vs.length, K = nC - 1; const closed = Math.abs(vs[K] - vs[0] - TAU) < 1e-6; const G = [], NN = [];
  for (let i = 0; i < nR; i++) { const row = []; for (let j = 0; j < nC; j++) { const p = new V3(); if (off) { S.frame(us[i], vs[j], p, _nn); const o = off(us[i], vs[j], i, j); if (o) p.addScaledVector(_nn, o); } else S.pos(us[i], vs[j], p); row.push(p); } G.push(row); }
  const base = gb.n; const U = [], Vv = []; // uv: u = along the row, v = along the column
  for (let i = 0; i < nR; i++) { U.push([0]); Vv.push([]); for (let j = 1; j < nC; j++) U[i].push(U[i][j - 1] + G[i][j].distanceTo(G[i][j - 1])); }
  for (let j = 0; j < nC; j++) { const col = [0]; for (let i = 1; i < nR; i++) col.push(col[i - 1] + G[i][j].distanceTo(G[i - 1][j])); for (let i = 0; i < nR; i++) Vv[i][j] = col[i]; }
  for (let i = 0; i < nR; i++) {
    S.c(us[i], _c);
    for (let j = 0; j < nC; j++) {
      const im = Math.max(0, i - 1), ip = Math.min(nR - 1, i + 1); const jm = closed ? (j - 1 + K) % K : Math.max(0, j - 1), jp = closed ? (j + 1) % K : Math.min(K, j + 1);
      _a.subVectors(G[ip][j], G[im][j]); _b.subVectors(G[i][jp], G[i][jm]); _t.crossVectors(_b, _a); if (_t.lengthSq() < 1e-22) _t.subVectors(G[i][j], _c);
      _t.normalize(); if (_t.dot(_s0.subVectors(G[i][j], _c)) < 0) _t.negate(); if (flip) _t.negate();
      const p = G[i][j]; const a = attr ? attr(i, j, us[i], vs[j], p) : DEF; NN.push(gb.vert(p, _t, U[i][j] * uvScale, Vv[i][j] * uvScale, a.c || DEF.c, a.w || S.w(us[i], vs[j], p), a.z || DEF.z, a.x || DEF.x, a.j));
    }
  }
  for (let i = 0; i < nR - 1; i++) for (let j = 0; j < K; j++) { const a = base + i * nC + j, b = a + 1, c = a + nC + 1, d = a + nC; gb.tri(a, b, c); gb.tri(a, c, d); }
  if (cap) { // close the last row with a fan (fingertips, palm front)
    const cen = new V3(), prev = new V3(); for (let j = 0; j < K; j++) { cen.add(G[nR - 1][j]); prev.add(G[nR - 2][j]); } cen.multiplyScalar(1 / K); prev.multiplyScalar(1 / K); const n = cen.clone().sub(prev).normalize();
    const a = attr ? attr(nR - 1, 0, us[nR - 1], vs[0], cen) : DEF; const ci = gb.vert(cen, n, U[nR - 1][0] * uvScale, Vv[nR - 1][0] * uvScale, a.c || DEF.c, a.w || S.w(us[nR - 1], vs[0], cen), a.z || DEF.z, a.x || DEF.x, a.j);
    for (let j = 0; j < K; j++) gb.tri(ci, base + (nR - 1) * nC + j + 1, base + (nR - 1) * nC + j);
  }
  return base;
}

const PROF = [[1.0, -0.0005], [0.985, 0.32], [0.95, 0.66], [0.9, 0.9], [0.78, 1.0], [0.5, 1.05], [0.2, 1.08]]; // [t (1 = rim), height / H]
/**
 * Raised panel on a surface, region = superellipse |du/hu|^p + |dv/hv|^p <= 1 centred at (uc, vc) in parameter space, rotated by rot.
 * cfg: {uc, vc, hu, hv, p, H, prof, K, attr(i,j,u,v)->{c,w,z,x}, hfn(a,b)->extra height, lift(a,b)->extra height (tab)}
 */
export function panel(gb, S, cfg) {
  const { uc, vc, hu, hv, p = 4, H = 0.001, K = 28, attr, hfn = null, rot = 0, mu = 1, mv = 1 } = cfg; const prof = cfg.prof || PROF; const ex = 2 / p; const cr = Math.cos(rot), sr = Math.sin(rot);
  const base = gb.n; const rows = prof.length; const pts = []; const nrm = new V3(), P0 = new V3();
  const at = (t, ph) => { const ca = Math.cos(ph), sa = Math.sin(ph); const a = t * spow(ca, ex), b = t * spow(sa, ex); const du = (a * cr - b * sr) * hu, dv = (a * sr + b * cr) * hv; return [uc + du, vc + dv, a, b]; };
  for (let i = 0; i < rows; i++) { const row = []; const t = prof[i][0]; for (let j = 0; j <= K; j++) { const q = at(t, j / K * TAU); const u = q[0], v = q[1]; S.frame(u, v, P0, nrm); let h = prof[i][1] * (prof[i][1] < 0 ? 1 : H); if (prof[i][1] >= 0) h = prof[i][1] * H; if (hfn) h += hfn(q[2], q[3]) * (prof[i][1] > 0 ? 1 : 0); row.push({ p: P0.clone().addScaledVector(nrm, h), u, v, sn: nrm.clone() }); } pts.push(row); }
  // centre vertex
  const cP = new V3(), cN = new V3(); S.frame(uc, vc, cP, cN); const hc = prof[rows - 1][1] * H + (hfn ? hfn(0, 0) : 0); cP.addScaledVector(cN, hc);
  const idx = []; const getAttr = (i, j, u, v, pp) => (attr ? attr(i, j, u, v, pp) : DEF);
  for (let i = 0; i < rows; i++) { const r = []; for (let j = 0; j <= K; j++) { const e = pts[i][j]; const jm = (j - 1 + K) % K, jp = (j + 1) % K; _a.subVectors(pts[Math.min(rows - 1, i + 1)][j].p, pts[Math.max(0, i - 1)][j].p); _b.subVectors(pts[i][jp].p, pts[i][jm].p); _t.crossVectors(_b, _a).normalize();
    if (_t.dot(e.sn) < 0) _t.negate(); if (!isFinite(_t.x)) _t.copy(e.sn); const a = getAttr(i, j, e.u, e.v, e.p); r.push(gb.vert(e.p, _t, e.u * mu, e.v * mv, a.c || DEF.c, a.w || S.w(e.u, e.v, e.p), a.z || DEF.z, a.x || DEF.x, a.j)); } idx.push(r); }
  const a0 = getAttr(rows - 1, 0, uc, vc, cP); const ci = gb.vert(cP, cN, uc * mu, vc * mv, a0.c || DEF.c, a0.w || S.w(uc, vc, cP), a0.z || DEF.z, a0.x || DEF.x, a0.j);
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < K; j++) gb.quad(idx[i][j], idx[i][j + 1], idx[i + 1][j + 1], idx[i + 1][j]);
  for (let j = 0; j < K; j++) gb.tri(ci, idx[rows - 1][j + 1], idx[rows - 1][j]);
  return base;
}

/** densify a parameter-space polyline [[u,v],...] to samples with arc length (metres) measured on the surface */
export function pathSamples(S, path, closed = false) {
  const out = []; let s = 0; const q = new V3(), q0 = new V3(); const pts = closed ? path.concat([path[0]]) : path;
  for (let i = 0; i < pts.length - 1; i++) { const A = pts[i], B = pts[i + 1]; const n = 6; for (let k = 0; k < n; k++) { const t = k / n; const u = A[0] + (B[0] - A[0]) * t, v = A[1] + (B[1] - A[1]) * t; S.pos(u, v, q); if (out.length) s += q.distanceTo(q0); q0.copy(q); out.push({ u, v, s }); } }
  const B = pts[pts.length - 1]; S.pos(B[0], B[1], q); if (out.length) s += q.distanceTo(q0); out.push({ u: B[0], v: B[1], s }); return out;
}
const sampleAt = (sp, s) => { let lo = 0, hi = sp.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sp[m].s <= s) lo = m; else hi = m; } const a = sp[lo], b = sp[hi]; const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0; return [a.u + (b.u - a.u) * f, a.v + (b.v - a.v) * f]; };

/** one raised thread lozenge per stitch along a surface path. cfg: {pitch, len, w, h, lift (base offset), col, x, z, weights(u,v,p)} */
export function stitchLine(gb, S, path, cfg = {}) {
  const { pitch = 0.0031, len = 0.0021, w = 0.00058, h = 0.00042, lift = 0, closed = false, col = [0.5, 0.42, 0.3], x = [0.1, 0, 0, 1], z = [0, 0, 0, 1], shrink = 0 } = cfg; const sp = pathSamples(S, path, closed); const total = sp[sp.length - 1].s; if (total < pitch) return 0;
  const n = Math.floor((total - shrink * 2) / pitch); const off = (total - (n - 1) * pitch) / 2; let cnt = 0; const R = [0.6, 1.0, 0.6], AN = [0, 90, 180].map((d) => d * Math.PI / 180);
  const pp = [new V3(), new V3(), new V3()], nn = new V3(), T = new V3(), B = new V3(), Nn = new V3();
  for (let k = 0; k < n; k++) {
    const s = off + k * pitch; const ring = [];
    for (let q = 0; q < 3; q++) { const uv = sampleAt(sp, clamp(s + (q - 1) * len / 2, 0, total)); if (q === 1) S.frame(uv[0], uv[1], pp[q], Nn); else S.pos(uv[0], uv[1], pp[q]); ring.push(uv); } for (let q = 0; q < 3; q++) pp[q].addScaledVector(Nn, lift);
    T.subVectors(pp[2], pp[0]).normalize(); B.crossVectors(T, Nn).normalize(); const N2 = _bt.crossVectors(B, T).normalize(); const uvc = ring[1]; const wts = cfg.weights ? cfg.weights(uvc[0], uvc[1], pp[1]) : S.w(uvc[0], uvc[1], pp[1]);
    const ids = []; for (let q = 0; q < 3; q++) { const r = []; for (let a = 0; a < 3; a++) { const ca = Math.cos(AN[a]), sa = Math.sin(AN[a]); const P = pp[q].clone().addScaledVector(B, ca * w * 0.5 * R[q]).addScaledVector(N2, sa * h * (q === 1 ? 1 : 0.75) - h * 0.3); const N = _nn.copy(B).multiplyScalar(ca * h).addScaledVector(N2, sa * w * 0.5).normalize(); r.push(gb.vert(P, N, s * 1000, a * 0.3, col, wts, z, x)); } ids.push(r); }
    for (let q = 0; q < 2; q++) for (let a = 0; a < 2; a++) gb.quad(ids[q][a], ids[q][a + 1], ids[q + 1][a + 1], ids[q + 1][a]); cnt++;
  }
  return cnt;
}

/** continuous raised welt / binding along a path: cfg {w, h, step, col, z, x, lift, closed, ends} */
export function welt(gb, S, path, cfg = {}) {
  const { w = 0.0018, h = 0.0007, step = 0.0012, lift = 0, closed = false, col = [0.05, 0.05, 0.05], x = [0, 0, 0, 1], z = [0, 0, 0, 0], K = 6, hfn = null } = cfg; const sp = pathSamples(S, path, closed); const total = sp[sp.length - 1].s; const n = Math.max(2, Math.round(total / step)); const rows = [];
  const P = new V3(), nn = new V3(), P2 = new V3(), T = new V3(), B = new V3(), N2 = new V3(); const base = gb.n;
  for (let i = 0; i <= n; i++) {
    const uv = sampleAt(sp, total * i / n); const uv2 = sampleAt(sp, Math.min(total, total * i / n + 0.0006)); const uv1 = sampleAt(sp, Math.max(0, total * i / n - 0.0006));
    S.frame(uv[0], uv[1], P, nn); S.pos(uv2[0], uv2[1], P2); S.pos(uv1[0], uv1[1], T); T.subVectors(P2, T).normalize(); B.crossVectors(T, nn).normalize(); N2.crossVectors(B, T).normalize();
    const wts = cfg.weights ? cfg.weights(uv[0], uv[1], P) : S.w(uv[0], uv[1], P); const hh = h * (hfn ? hfn(i / n) : 1); const r = [];
    for (let a = 0; a <= K; a++) { const ang = a / K * Math.PI; const ca = Math.cos(ang), sa = Math.sin(ang); const q = P.clone().addScaledVector(nn, lift).addScaledVector(B, ca * w * 0.5).addScaledVector(N2, sa * hh - (a === 0 || a === K ? 0.0003 : 0)); const N = _nn.copy(B).multiplyScalar(ca * hh).addScaledVector(N2, sa * w * 0.5).normalize(); r.push(gb.vert(q, N, total * i / n, a * 0.3, col, wts, z, x)); }
    rows.push(r);
  }
  for (let i = 0; i < n; i++) for (let a = 0; a < K; a++) gb.quad(rows[i][a], rows[i][a + 1], rows[i + 1][a + 1], rows[i + 1][a]);
  return base;
}
