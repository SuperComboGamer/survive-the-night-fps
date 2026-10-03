// Procedural hard-surface modelling kit for the weapon system (true scale, metres).
// Gun-local frame: -Z = muzzle direction, +Y up, +X right; origin = bore axis at the breech face.
// A gun is a tree of rigid PARTS (each becomes a bone). Every primitive is merged per material into ONE skinned mesh,
// so a whole gun costs ~4-7 draw calls while every moving part (slide, hammer, bolt, mag, pump...) animates.
// Vertex attribute `aWear` (0..1) marks chamfers / machined edges where the finish wears to bare metal (materials.js).
import * as THREE from 'three';
import { boxRaw } from '../../core/build.js';

export const DEG = Math.PI / 180;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _nm = new THREE.Matrix3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

/** Matrix from position [x,y,z], euler degrees [x,y,z] (XYZ), scale (number | [x,y,z]). */
export function mat4(p = [0, 0, 0], r = null, s = null) {
  _e.set((r?.[0] || 0) * DEG, (r?.[1] || 0) * DEG, (r?.[2] || 0) * DEG, r?.[3] || 'XYZ'); _q.setFromEuler(_e);
  if (s === null || s === undefined) _s.set(1, 1, 1); else if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q, _s);
}
const AXIS_ROT = { y: null, '-y': [180, 0, 0], z: [90, 0, 0], '-z': [-90, 0, 0], x: [0, 0, -90], '-x': [0, 0, 90] };
// rotations that map the local +X axis (extrusion direction) onto the requested axis
const SCREW_ROT = { x: null, '-x': [0, 180, 0], y: [0, 0, 90], '-y': [0, 0, -90], z: [0, -90, 0], '-z': [0, 90, 0] };

// ------------------------------------------------------------------ 2D outline helpers (u = gun z, v = gun y for side profiles)
/** Round polygon corners. pts: [[u,v,r?],...] closed polygon; r (per point) fillet radius, segDeg angular step. */
export function roundPoly(pts, segDeg = 12) {
  const out = []; const n = pts.length;
  for (let i = 0; i < n; i++) {
    const P = pts[i], r = P[2] || 0; if (r <= 0) { out.push([P[0], P[1]]); continue; }
    const A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
    let d1u = A[0] - P[0], d1v = A[1] - P[1], d2u = B[0] - P[0], d2v = B[1] - P[1]; const l1 = Math.hypot(d1u, d1v), l2 = Math.hypot(d2u, d2v);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push([P[0], P[1]]); continue; }
    d1u /= l1; d1v /= l1; d2u /= l2; d2v /= l2;
    const cosA = Math.max(-1, Math.min(1, d1u * d2u + d1v * d2v)), al = Math.acos(cosA); if (al < 1e-3 || al > Math.PI - 1e-3) { out.push([P[0], P[1]]); continue; }
    let tl = r / Math.tan(al / 2); const lim = 0.49 * Math.min(l1, l2); let rr = r; if (tl > lim) { tl = lim; rr = tl * Math.tan(al / 2); }
    const bu = d1u + d2u, bv = d1v + d2v, bl = Math.hypot(bu, bv); const cd = rr / Math.sin(al / 2);
    const cu = P[0] + bu / bl * cd, cv = P[1] + bv / bl * cd;
    const t1u = P[0] + d1u * tl, t1v = P[1] + d1v * tl, t2u = P[0] + d2u * tl, t2v = P[1] + d2v * tl;
    let a0 = Math.atan2(t1v - cv, t1u - cu), a1 = Math.atan2(t2v - cv, t2u - cu); let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const ns = Math.max(1, Math.ceil(Math.abs(da) / (segDeg * DEG)));
    for (let k = 0; k <= ns; k++) { const a = a0 + da * k / ns; out.push([cu + Math.cos(a) * rr, cv + Math.sin(a) * rr]); }
  }
  return out;
}
export function arcPts(cu, cv, r, a0, a1, n = 8, rv = r) { const o = []; for (let k = 0; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * DEG; o.push([cu + Math.cos(a) * r, cv + Math.sin(a) * rv]); } return o; }
export function bezPts(p0, p1, p2, p3, n = 8) { const o = []; for (let k = 0; k <= n; k++) { const t = k / n, s = 1 - t; o.push([s * s * s * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t * t * t * p3[0], s * s * s * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t * t * t * p3[1]]); } return o; }
function polyArea(pts) { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function cleanPoly(pts) { const o = []; for (const p of pts) { const q = o[o.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-7) o.push([p[0], p[1]]); } while (o.length > 2 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 1e-7) o.pop(); return o; }

// ------------------------------------------------------------------ raw builders {p,n,u,w,i} (plain arrays)
function R() { return { p: [], n: [], u: [], w: [], i: [] }; }
function vtx(r, x, y, z, nx, ny, nz, u, v, w) { r.p.push(x, y, z); r.n.push(nx, ny, nz); r.u.push(u, v); r.w.push(w); return r.p.length / 3 - 1; }
/** push triangle, oriented so its geometric normal agrees with the average vertex normal */
function tri(r, a, b, c) {
  const P = r.p, N = r.n;
  _a.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]); _b.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]); _c.crossVectors(_a, _b);
  const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
  if (_c.x * nx + _c.y * ny + _c.z * nz >= 0) r.i.push(a, b, c); else r.i.push(a, c, b);
}
function quad(r, a, b, c, d) { tri(r, a, b, c); tri(r, a, c, d); }

/** Chamfered box (core boxRaw) + wear on the chamfer faces. UVs are replaced by gun-space box projection in Part.add. */
export function boxGeo(w, h, d, bevel) {
  const b = boxRaw(w, h, d, bevel); const n = b.p.length / 3; const r = { p: b.p, n: b.n, u: b.u, i: b.i, w: new Float32Array(n) };
  for (let k = 0; k < n; k++) { const nx = Math.abs(b.n[k * 3]), ny = Math.abs(b.n[k * 3 + 1]), nz = Math.abs(b.n[k * 3 + 2]); r.w[k] = (nx > 0.2 ? 1 : 0) + (ny > 0.2 ? 1 : 0) + (nz > 0.2 ? 1 : 0) >= 2 ? 1 : 0; }
  return r;
}

/**
 * Lathe around +Y. profile: [[r, a, wear?], ...] traversed counter-clockwise in the (r,a) plane (outer surfaces: increasing a).
 * Corners sharper than `sharp` degrees are split (hard edge). Short 25-65deg segments (< chamfer m) are flagged as worn chamfers.
 * t0/tlen: angular start/extent (radians); seam defaults to the underside once mapped to a z axis.
 */
export function latheGeo(profile, seg = 24, { t0 = Math.PI / 2, tlen = Math.PI * 2, sharp = 38, chamfer = 0.0016, rRef = 0 } = {}) {
  const r = R(); const np = profile.length; const S = [];
  let rmax = rRef; if (!rmax) for (const q of profile) rmax = Math.max(rmax, q[0]);
  const segN = (i) => { const A = profile[i], B = profile[i + 1]; const dr = B[0] - A[0], da = B[1] - A[1]; const l = Math.hypot(dr, da) || 1; return [da / l, -dr / l, l, Math.abs(Math.atan2(Math.abs(dr), Math.abs(da)) / DEG)]; };
  let s = 0;
  for (let i = 0; i < np; i++) {
    const P = profile[i]; const nin = i > 0 ? segN(i - 1) : null, nout = i < np - 1 ? segN(i) : null;
    const wIn = nin && nin[2] < chamfer && nin[3] > 22 && nin[3] < 68 ? 1 : 0, wOut = nout && nout[2] < chamfer && nout[3] > 22 && nout[3] < 68 ? 1 : 0;
    const pw = P[2] ?? null;
    if (i > 0) s += Math.hypot(P[0] - profile[i - 1][0], P[1] - profile[i - 1][1]);
    if (nin && nout) {
      const ang = Math.acos(Math.max(-1, Math.min(1, nin[0] * nout[0] + nin[1] * nout[1]))) / DEG;
      if (ang > sharp) { S.push({ r: P[0], a: P[1], nr: nin[0], na: nin[1], w: pw ?? wIn, s }); S.push({ r: P[0], a: P[1], nr: nout[0], na: nout[1], w: pw ?? wOut, s, brk: true }); continue; }
      const nr = nin[0] + nout[0], na = nin[1] + nout[1], l = Math.hypot(nr, na) || 1; S.push({ r: P[0], a: P[1], nr: nr / l, na: na / l, w: pw ?? Math.max(wIn, wOut), s });
    } else { const q = nin || nout; S.push({ r: P[0], a: P[1], nr: q[0], na: q[1], w: pw ?? (nin ? wIn : wOut), s }); }
  }
  const cols = seg + 1; const full = Math.abs(tlen - Math.PI * 2) < 1e-6;
  for (let j = 0; j < S.length; j++) {
    const q = S[j];
    for (let k = 0; k < cols; k++) { const t = t0 + tlen * k / seg, c = Math.cos(t), sn = Math.sin(t); vtx(r, q.r * c, q.a, q.r * sn, q.nr * c, q.na, q.nr * sn, q.a, (t - t0) * rmax, q.w); }
  }
  for (let j = 0; j < S.length - 1; j++) {
    if (S[j + 1].brk) continue; // duplicated corner: no band between the two copies
    for (let k = 0; k < seg; k++) { const a = j * cols + k, b = a + 1, c = a + cols + 1, d = a + cols; if (S[j].r < 1e-7) tri(r, a, c, d); else if (S[j + 1].r < 1e-7) tri(r, a, b, c); else quad(r, a, b, c, d); }
  }
  if (!full) { /* open lathe: caller closes it if needed */ }
  return r;
}

/**
 * Side-profile extrusion: outline [[u,v],...] in the gun's ZY plane (u -> z, v -> y), extruded along X from x0 to x1,
 * with chamfer `bevel` on both faces (flagged as wear). holes: array of outlines. Smooth walls unless the corner > crease deg.
 */
export function extrudeGeo(outline, x0, x1, { bevel = 0.0006, bevel0 = null, bevel1 = null, holes = [], crease = 35, wearWalls = 0, caps = true } = {}) {
  const r = R(); const th = x1 - x0; const b0 = Math.min(bevel0 ?? bevel, th * 0.45), b1 = Math.min(bevel1 ?? bevel, th * 0.45);
  let outer = cleanPoly(outline); if (polyArea(outer) < 0) outer.reverse();
  const hs = holes.map((h) => { const c = cleanPoly(h); if (polyArea(c) > 0) c.reverse(); return c; });
  const loops = [outer, ...hs];
  const inset = (loop, b) => { // move each vertex against the outward normal by b (miter, clamped)
    if (b <= 0) return loop; const n = loop.length, o = [];
    for (let i = 0; i < n; i++) {
      const A = loop[(i - 1 + n) % n], P = loop[i], B = loop[(i + 1) % n];
      const e1u = P[0] - A[0], e1v = P[1] - A[1], e2u = B[0] - P[0], e2v = B[1] - P[1]; const l1 = Math.hypot(e1u, e1v) || 1, l2 = Math.hypot(e2u, e2v) || 1;
      const n1u = e1v / l1, n1v = -e1u / l1, n2u = e2v / l2, n2v = -e2u / l2; let mu = n1u + n2u, mv = n1v + n2v; const ml = Math.hypot(mu, mv) || 1; mu /= ml; mv /= ml;
      const dd = mu * n1u + mv * n1v; const k = Math.min(b / Math.max(dd, 0.3), b * 3); o.push([P[0] - mu * k, P[1] - mv * k]);
    }
    return o;
  };
  const k = Math.SQRT1_2;
  for (const loop of loops) {
    const n = loop.length; const ins0 = inset(loop, b0), ins1 = inset(loop, b1); let s = 0;
    const en = []; for (let i = 0; i < n; i++) { const P = loop[i], B = loop[(i + 1) % n]; const du = B[0] - P[0], dv = B[1] - P[1], l = Math.hypot(du, dv) || 1; en.push([dv / l, -du / l, l]); }
    const vn = (i, e) => {
      const prev = en[(i - 1 + n) % n], next = en[i]; const ang = Math.acos(Math.max(-1, Math.min(1, prev[0] * next[0] + prev[1] * next[1]))) / DEG;
      if (ang > crease) return [en[e][0], en[e][1], 1]; const mu = prev[0] + next[0], mv = prev[1] + next[1], l = Math.hypot(mu, mv) || 1; return [mu / l, mv / l, 0];
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, P = loop[i], Q = loop[j]; const L = en[i][2];
      const na = vn(i, i), nb = vn(j, i); const wa = wearWalls * na[2], wb = wearWalls * nb[2];
      const xa = x0 + b0, xb = x1 - b1;
      const a0 = vtx(r, xa, P[1], P[0], 0, na[1], na[0], s, xa, wa), a1 = vtx(r, xa, Q[1], Q[0], 0, nb[1], nb[0], s + L, xa, wb);
      const a2 = vtx(r, xb, Q[1], Q[0], 0, nb[1], nb[0], s + L, xb, wb), a3 = vtx(r, xb, P[1], P[0], 0, na[1], na[0], s, xb, wa); quad(r, a0, a1, a2, a3);
      if (b0 > 0) { const Pi = ins0[i], Qi = ins0[j];
        const c0 = vtx(r, x0, Pi[1], Pi[0], -k, na[1] * k, na[0] * k, s, x0, 1), c1 = vtx(r, x0, Qi[1], Qi[0], -k, nb[1] * k, nb[0] * k, s + L, x0, 1);
        const c2 = vtx(r, xa, Q[1], Q[0], -k, nb[1] * k, nb[0] * k, s + L, xa, 1), c3 = vtx(r, xa, P[1], P[0], -k, na[1] * k, na[0] * k, s, xa, 1); quad(r, c0, c1, c2, c3); }
      if (b1 > 0) { const Pi = ins1[i], Qi = ins1[j];
        const d0 = vtx(r, x1, Pi[1], Pi[0], k, na[1] * k, na[0] * k, s, x1, 1), d1 = vtx(r, x1, Qi[1], Qi[0], k, nb[1] * k, nb[0] * k, s + L, x1, 1);
        const d2 = vtx(r, xb, Q[1], Q[0], k, nb[1] * k, nb[0] * k, s + L, xb, 1), d3 = vtx(r, xb, P[1], P[0], k, na[1] * k, na[0] * k, s, xb, 1); quad(r, d0, d1, d2, d3); }
      s += L;
    }
  }
  if (caps) for (const [x, nx, b] of [[x0, -1, b0], [x1, 1, b1]]) {
    if (caps !== true && !caps.includes(nx)) continue;
    const capO = inset(outer, b), capH = hs.map((h) => inset(h, b));
    const tris = THREE.ShapeUtils.triangulateShape(capO.map((p) => new THREE.Vector2(p[0], p[1])), capH.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
    const all = [...capO, ...capH.flat()]; const base = r.p.length / 3; for (const p of all) vtx(r, x, p[1], p[0], nx, 0, 0, p[0], p[1], 0);
    for (const t of tris) tri(r, base + t[0], base + t[1], base + t[2]);
  }
  return r;
}

/**
 * Loft through cross-sections (superellipses) along a path. sections: [{c:[x,y,z], a (half width), b (half height) | bt/bb (top/bottom),
 * n (exponent, 2 = ellipse, 4+ = rounded rect), up:[x,y,z]?, sx: x-offset of section centre}]. K points around. caps: flat end caps.
 */
export function loftGeo(sections, { K = 28, up = [0, 1, 0], capStart = true, capEnd = true, wear = 0, smoothT = true } = {}) {
  const r = R(); const n = sections.length; const C = sections.map((s) => new THREE.Vector3(...s.c)); const T = [];
  for (let i = 0; i < n; i++) { const a = C[Math.max(0, i - 1)], b = C[Math.min(n - 1, i + 1)]; T.push(sections[i].t ? new THREE.Vector3(...sections[i].t).normalize() : new THREE.Vector3().subVectors(b, a).normalize()); }
  const grid = []; let sAlong = 0;
  for (let i = 0; i < n; i++) {
    const sc = sections[i], t = T[i]; const u0 = new THREE.Vector3(...(sc.up || up)); const rt = new THREE.Vector3().crossVectors(t, u0).normalize(); const uu = new THREE.Vector3().crossVectors(rt, t).normalize();
    if (i > 0) sAlong += C[i].distanceTo(C[i - 1]);
    const ex = 2 / (sc.n ?? 2.5), row = [];
    for (let k = 0; k <= K; k++) {
      const ph = -Math.PI / 2 + (k / K) * Math.PI * 2; const cs = Math.cos(ph), sn = Math.sin(ph);
      const x = (sc.a) * Math.sign(cs) * Math.pow(Math.abs(cs), ex) + (sc.sx || 0);
      const bb = sn >= 0 ? (sc.bt ?? sc.b) : (sc.bb ?? sc.b); const y = bb * Math.sign(sn) * Math.pow(Math.abs(sn), ex) + (sc.sy || 0);
      const P = new THREE.Vector3().copy(C[i]).addScaledVector(rt, x).addScaledVector(uu, y);
      const curv = Math.pow(Math.abs(cs * sn) * 2, 2) ; // high at the rounded corners of a superellipse
      row.push({ P, s: sAlong, w: wear * curv, ctr: C[i] });
    }
    grid.push(row);
  }
  // perimeter coordinate per row
  for (const row of grid) { let v = 0; for (let k = 0; k <= K; k++) { if (k > 0) v += row[k].P.distanceTo(row[k - 1].P); row[k].v = v; } }
  // normals via finite differences
  const idx = [];
  for (let i = 0; i < n; i++) {
    const ri = []; for (let k = 0; k <= K; k++) {
      const g = grid[i][k]; const kp = k === K ? 1 : k + 1, km = k === 0 ? K - 1 : k - 1; _a.subVectors(grid[i][kp].P, grid[i][km].P);
      const ip = Math.min(n - 1, i + 1), im = Math.max(0, i - 1); _b.subVectors(grid[ip][k].P, grid[im][k].P); if (_b.lengthSq() < 1e-14) _b.copy(T[i]);
      _n.crossVectors(_a, _b).normalize(); _c.subVectors(g.P, g.ctr); if (_n.dot(_c) < 0) _n.negate();
      ri.push(vtx(r, g.P.x, g.P.y, g.P.z, _n.x, _n.y, _n.z, g.s, g.v, g.w));
    }
    idx.push(ri);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < K; k++) quad(r, idx[i][k], idx[i][k + 1], idx[i + 1][k + 1], idx[i + 1][k]);
  const cap = (i, sgn) => { const t = T[i]; const c = vtx(r, C[i].x, C[i].y, C[i].z, t.x * sgn, t.y * sgn, t.z * sgn, 0, 0, 0); const ring = []; for (let k = 0; k <= K; k++) { const P = grid[i][k].P; ring.push(vtx(r, P.x, P.y, P.z, t.x * sgn, t.y * sgn, t.z * sgn, P.x + P.z, P.y, wear * 0.6)); } for (let k = 0; k < K; k++) tri(r, c, ring[k], ring[k + 1]); };
  if (capStart) cap(0, -1); if (capEnd) cap(n - 1, 1);
  return r;
}

/** resample a closed polygon to n points spaced evenly by arc length, starting at the point of max y (then max x) */
export function resamplePoly(pts, n) {
  let P = cleanPoly(pts); if (polyArea(P) < 0) P = P.slice().reverse();
  let s0 = 0; for (let i = 1; i < P.length; i++) if (P[i][1] > P[s0][1] + 1e-9 || (Math.abs(P[i][1] - P[s0][1]) < 1e-9 && P[i][0] > P[s0][0])) s0 = i;
  P = P.slice(s0).concat(P.slice(0, s0));
  const L = [0]; for (let i = 1; i <= P.length; i++) { const a = P[i - 1], b = P[i % P.length]; L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const tot = L[L.length - 1], o = []; let j = 0;
  for (let k = 0; k < n; k++) { const t = tot * k / n; while (j < P.length - 1 && L[j + 1] < t) j++; const a = P[j], b = P[(j + 1) % P.length], f = (t - L[j]) / ((L[j + 1] - L[j]) || 1); o.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
  return o;
}
/**
 * Loft through arbitrary closed cross-section polygons stacked along z (receivers, slides, handguards, stocks with real sections).
 * sections: [{ z, pts: [[x,y],...] }] (any vertex count; each is resampled to N points by arc length, anchored at its top point so
 * sections line up). Smooth normals; aWear from section curvature (rounded edges wear first). Flat caps.
 */
export function polyLoftGeo(sections, { N = 48, capStart = true, capEnd = true, wear = 0.8, wearK = 0.0025 } = {}) {
  const r = R(); const S = sections.map((sc) => ({ z: sc.z, q: resamplePoly(sc.pts, N) })); const n = S.length;
  const curv = S.map((sc) => sc.q.map((p, k) => { const a = sc.q[(k - 1 + N) % N], b = sc.q[(k + 1) % N]; const e1x = p[0] - a[0], e1y = p[1] - a[1], e2x = b[0] - p[0], e2y = b[1] - p[1];
    const l = (Math.hypot(e1x, e1y) + Math.hypot(e2x, e2y)) / 2 || 1; const ang = Math.abs(Math.atan2(e1x * e2y - e1y * e2x, e1x * e2x + e1y * e2y)); return ang / l; })); // rad per metre
  const idx = [];
  for (let i = 0; i < n; i++) {
    const sc = S[i], row = []; let v = 0;
    for (let k = 0; k < N; k++) {
      const p = sc.q[k], a = sc.q[(k - 1 + N) % N], b = sc.q[(k + 1) % N]; if (k > 0) v += Math.hypot(p[0] - a[0], p[1] - a[1]);
      // tangent around the section and along z (finite differences) -> normal
      _a.set(b[0] - a[0], b[1] - a[1], 0); const ip = Math.min(n - 1, i + 1), im = Math.max(0, i - 1); const P1 = S[ip].q[k], P0 = S[im].q[k];
      _b.set(P1[0] - P0[0], P1[1] - P0[1], (S[ip].z - S[im].z) || 1e-6); _n.crossVectors(_b, _a).normalize();
      if (_n.x * (b[1] - a[1]) - _n.y * (b[0] - a[0]) < 0 && (_n.x * _n.x + _n.y * _n.y) > 1e-6) _n.negate(); // outward for CCW sections
      const w = Math.min(1, curv[i][k] * wearK) * wear;
      row.push(vtx(r, p[0], p[1], sc.z, _n.x, _n.y, _n.z, sc.z, v, w));
    }
    row.push(vtx(r, sc.q[0][0], sc.q[0][1], sc.z, r.n[row[0] * 3], r.n[row[0] * 3 + 1], r.n[row[0] * 3 + 2], sc.z, v + Math.hypot(sc.q[0][0] - sc.q[N - 1][0], sc.q[0][1] - sc.q[N - 1][1]), r.w[row[0]]));
    idx.push(row);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < N; k++) quad(r, idx[i][k], idx[i][k + 1], idx[i + 1][k + 1], idx[i + 1][k]);
  const cap = (i, sg) => { const q = S[i].q; const tris = THREE.ShapeUtils.triangulateShape(q.map((p) => new THREE.Vector2(p[0], p[1])), []); const base = r.p.length / 3;
    for (const p of q) vtx(r, p[0], p[1], S[i].z, 0, 0, sg, p[0], p[1], 0); for (const t of tris) tri(r, base + t[0], base + t[1], base + t[2]); };
  if (capStart) cap(0, S[0].z < S[n - 1].z ? -1 : 1); if (capEnd) cap(n - 1, S[0].z < S[n - 1].z ? 1 : -1);
  return r;
}

/** Tube swept along a polyline / closed loop (parallel-transport frames). pts: [[x,y,z],...]. radius number or [r0..] per point. */
export function sweepGeo(pts, radius, { seg = 10, closed = false, caps = true, smooth = 0 } = {}) {
  const r = R(); let P = pts.map((p) => new THREE.Vector3(...p));
  if (smooth > 0) { const cur = new THREE.CatmullRomCurve3(P, closed, 'catmullrom', 0.5); P = cur.getPoints(Math.max(4, Math.round(P.length * smooth))); if (closed) P.pop(); }
  const n = P.length; const T = []; for (let i = 0; i < n; i++) { const a = closed ? P[(i - 1 + n) % n] : P[Math.max(0, i - 1)], b = closed ? P[(i + 1) % n] : P[Math.min(n - 1, i + 1)]; T.push(new THREE.Vector3().subVectors(b, a).normalize()); }
  let N0 = new THREE.Vector3(0, 1, 0); if (Math.abs(N0.dot(T[0])) > 0.9) N0.set(1, 0, 0); N0.addScaledVector(T[0], -N0.dot(T[0])).normalize();
  const Ns = [N0]; for (let i = 1; i < n; i++) { const prev = Ns[i - 1]; const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]); Ns.push(prev.clone().applyQuaternion(q)); }
  const rad = (i) => (Array.isArray(radius) ? radius[Math.round(i / (n - 1) * (radius.length - 1))] : radius);
  const rows = []; let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += P[i].distanceTo(P[i - 1]); const B = new THREE.Vector3().crossVectors(T[i], Ns[i]); const row = []; const rr = rad(i);
    for (let k = 0; k <= seg; k++) { const a = k / seg * Math.PI * 2; const c = Math.cos(a), sn = Math.sin(a); const nx = Ns[i].x * c + B.x * sn, ny = Ns[i].y * c + B.y * sn, nz = Ns[i].z * c + B.z * sn; row.push(vtx(r, P[i].x + nx * rr, P[i].y + ny * rr, P[i].z + nz * rr, nx, ny, nz, s, a * rr, 0)); }
    rows.push(row);
  }
  const last = closed ? n : n - 1; for (let i = 0; i < last; i++) { const A = rows[i], Bq = rows[(i + 1) % n]; for (let k = 0; k < seg; k++) quad(r, A[k], A[k + 1], Bq[k + 1], Bq[k]); }
  if (!closed && caps) for (const [i, sg] of [[0, -1], [n - 1, 1]]) { const t = T[i]; const c = vtx(r, P[i].x, P[i].y, P[i].z, t.x * sg, t.y * sg, t.z * sg, 0, 0, 0); const ring = []; for (let k = 0; k <= seg; k++) { const q = rows[i][k]; ring.push(vtx(r, r.p[q * 3], r.p[q * 3 + 1], r.p[q * 3 + 2], t.x * sg, t.y * sg, t.z * sg, 0, 0, 0)); } for (let k = 0; k < seg; k++) tri(r, c, ring[k], ring[k + 1]); }
  return r;
}

/** Flat quad in the local XY plane facing +Z, UVs = rect [u0,v0,u1,v1] (for markings atlas). */
export function quadGeo(w, h, uv = [0, 0, 1, 1]) { const r = R(); const a = vtx(r, -w / 2, -h / 2, 0, 0, 0, 1, uv[0], uv[1], 0), b = vtx(r, w / 2, -h / 2, 0, 0, 0, 1, uv[2], uv[1], 0), c = vtx(r, w / 2, h / 2, 0, 0, 0, 1, uv[2], uv[3], 0), d = vtx(r, -w / 2, h / 2, 0, 0, 0, 1, uv[0], uv[3], 0); quad(r, a, b, c, d); return r; }

// ------------------------------------------------------------------ parts / kit
class Part {
  constructor(kit, name, parent, pivot) { this.kit = kit; this.name = name; this.parent = parent; this.pivot = new THREE.Vector3(...pivot); this.bufs = new Map(); this.index = kit.parts.length; }
  _buf(mat) { let b = this.bufs.get(mat); if (!b) this.bufs.set(mat, (b = { P: [], N: [], U: [], W: [], I: [] })); return b; }
  /** add raw geometry with a matrix. uv: 'raw' keeps the primitive's metre UVs (+offset), 'box' = gun-space box projection. */
  add(mat, raw, m, uv = 'raw', wearMul = 1, uvOff = null) {
    const b = this._buf(mat), base = b.P.length / 3, e = m.elements; _nm.getNormalMatrix(m); const ne = _nm.elements; const n = raw.p.length / 3;
    const det = m.determinant(); const ou = uvOff ? uvOff[0] : 0, ov = uvOff ? uvOff[1] : 0;
    for (let k = 0; k < n; k++) {
      const x = raw.p[k * 3], y = raw.p[k * 3 + 1], z = raw.p[k * 3 + 2];
      const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = raw.n[k * 3], ny = raw.n[k * 3 + 1], nz = raw.n[k * 3 + 2];
      let tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz; const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      b.P.push(X, Y, Z); b.N.push(tx, ty, tz);
      if (uv === 'box') { const ax = Math.abs(tx), ay = Math.abs(ty), az = Math.abs(tz); if (ax >= ay && ax >= az) b.U.push(Z + ou, Y + ov); else if (ay >= az) b.U.push(Z + ou, X + ov); else b.U.push(X + ou, Y + ov); }
      else b.U.push(raw.u[k * 2] + ou, raw.u[k * 2 + 1] + ov);
      b.W.push((raw.w ? raw.w[k] : 0) * wearMul);
    }
    const I = raw.i; if (det >= 0) for (let k = 0; k < I.length; k++) b.I.push(base + I[k]); else for (let k = 0; k < I.length; k += 3) b.I.push(base + I[k], base + I[k + 2], base + I[k + 1]);
    return this;
  }
  // ---- primitives (p = centre, r = euler degrees, sizes in metres) ----
  box(mat, p, s, { r = null, b = null, wear = 1, uv = 'box' } = {}) { const bev = b ?? Math.min(0.0006, Math.min(s[0], s[1], s[2]) * 0.2); return this.add(mat, boxGeo(s[0], s[1], s[2], bev), mat4(p, r), uv, wear); }
  /** cylinder along axis ('x','y','z','-z'...), p = centre; r radius or [r0,r1] (r0 at the -axis end); b chamfer */
  cyl(mat, p, rad, len, { axis = 'z', seg = 20, b = 0.0005, r = null, t0, tlen, wear = 1, open = false } = {}) {
    const r0 = Array.isArray(rad) ? rad[0] : rad, r1 = Array.isArray(rad) ? rad[1] : rad, h = len / 2; const bb = Math.min(b, r0 * 0.4, r1 * 0.4, h * 0.4);
    const prof = open ? [[r0, -h], [r1, h]] : bb > 0 ? [[0, -h], [r0 - bb, -h], [r0, -h + bb], [r1, h - bb], [r1 - bb, h], [0, h]] : [[0, -h], [r0, -h], [r1, h], [0, h]];
    return this.lathe(mat, p, prof, { axis, seg, r, t0, tlen, wear });
  }
  /** hollow tube (barrel with bore): outer ro, inner ri, length along axis; chamfer b on outer + inner edges */
  tube(mat, p, ro, ri, len, { axis = 'z', seg = 24, b = 0.0005, r = null, wear = 1 } = {}) {
    const h = len / 2, bb = Math.min(b, (ro - ri) * 0.4);
    const prof = [[ri + bb, -h], [ro - bb, -h], [ro, -h + bb], [ro, h - bb], [ro - bb, h], [ri + bb, h], [ri, h - bb], [ri, -h + bb], [ri + bb, -h]];
    return this.lathe(mat, p, prof, { axis, seg, r, wear });
  }
  lathe(mat, p, profile, { axis = 'z', seg = 24, r = null, t0, tlen, wear = 1, sharp, chamfer, uvOff = null, scale = null } = {}) {
    const g = latheGeo(profile, seg, { t0: t0 ?? Math.PI / 2, tlen: tlen ?? Math.PI * 2, sharp: sharp ?? 38, chamfer: chamfer ?? 0.0016 });
    const ar = AXIS_ROT[axis]; const m = mat4(p, r); if (scale) m.multiply(mat4([0, 0, 0], null, scale)); if (ar) m.multiply(mat4([0, 0, 0], ar));
    return this.add(mat, g, m, 'raw', wear, uvOff || [p[0] * 7.3 + p[1] * 3.1, p[2] * 5.7]);
  }
  /** side-profile extrusion (outline in gun z/y), thickness x0..x1 */
  ext(mat, outline, x0, x1, { b = 0.0006, b0 = null, b1 = null, holes = [], crease = 35, r = null, p = [0, 0, 0], wear = 1, wearWalls = 0, caps = true } = {}) {
    const g = extrudeGeo(outline, x0, x1, { bevel: b, bevel0: b0, bevel1: b1, holes, crease, wearWalls, caps }); return this.add(mat, g, mat4(p, r), 'raw', wear);
  }
  /** cross-section extrusion along Z: outline [[x,y],...] in the XY plane, from z0 to z1 (e.g. slide, receiver sections) */
  extZ(mat, outline, z0, z1, { b = 0.0006, b0 = null, b1 = null, holes = [], crease = 35, p = [0, 0, 0], r = null, wear = 1, caps = true } = {}) {
    // reuse extrudeGeo (u->z,v->y, along x) then rotate: map (x,y,z) -> (z... ) : outline u := x, v := y, extrude along X => rotate -90 about Y
    const g = extrudeGeo(outline, z0, z1, { bevel: b, bevel0: b0, bevel1: b1, holes, crease, caps });
    const m = mat4(p, r).multiply(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1)); // swap x<->z
    return this.add(mat, g, m, 'raw', wear);
  }
  loft(mat, sections, o = {}) { return this.add(mat, loftGeo(sections, o), mat4(o.p || [0, 0, 0], o.r), 'raw', o.wearMul ?? 1); }
  /** loft through arbitrary cross-section polygons stacked along z: sections [{z, pts}] (see polyLoftGeo) */
  polyLoft(mat, sections, o = {}) { return this.add(mat, polyLoftGeo(sections, o), mat4(o.p || [0, 0, 0], o.r), o.uv || 'raw', o.wearMul ?? 1); }
  /**
   * Profile-driven loft for stocks / grips / forends: side-view top and bottom curves y(z), half-width w(z) and superellipse
   * exponent n(z) given as key lists [[z, v], ...] (Catmull-Rom interpolated); sections are vertical slices along z.
   */
  profLoft(mat, { top, bot, w, n = [[0, 2.6]], z0, z1, steps = 40, K = 30, x = 0, wear = 0.4, capStart = true, capEnd = true }) {
    const f = (keys, z) => { if (keys.length === 1) return keys[0][1]; let i = 0; while (i < keys.length - 2 && z > keys[i + 1][0]) i++; const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
      const t = Math.max(0, Math.min(1, (z - k1[0]) / ((k2[0] - k1[0]) || 1))); const t2 = t * t, t3 = t2 * t; // centripetal-ish Catmull-Rom on values
      const m1 = (k2[1] - k0[1]) / ((k2[0] - k0[0]) || 1) * (k2[0] - k1[0]), m2 = (k3[1] - k1[1]) / ((k3[0] - k1[0]) || 1) * (k2[0] - k1[0]);
      return (2 * t3 - 3 * t2 + 1) * k1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[1] + (t3 - t2) * m2; };
    const secs = []; for (let i = 0; i <= steps; i++) { const z = z0 + (z1 - z0) * i / steps; const t = f(top, z), b = f(bot, z), hw = f(w, z); secs.push({ c: [x, (t + b) / 2, z], a: hw, b: (t - b) / 2, n: f(n, z), t: [0, 0, z1 > z0 ? 1 : -1] }); }
    return this.add(mat, loftGeo(secs, { K, wear, capStart, capEnd }), mat4([0, 0, 0]), 'raw', 1);
  }
  sweep(mat, pts, radius, o = {}) { return this.add(mat, sweepGeo(pts, radius, o), mat4(o.p || [0, 0, 0], o.r), 'raw', 1); }
  sphere(mat, p, rad, { seg = 16, r = null, scale = null, hemi = false } = {}) {
    const prof = []; const n = Math.max(4, seg >> 1); for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (hemi ? Math.PI / 2 : 0) + (hemi ? Math.PI / 2 : Math.PI) * i / n; prof.push([Math.cos(a) * rad, Math.sin(a) * rad]); }
    if (hemi) prof.unshift([0, 0]);
    const g = latheGeo(prof, seg, { sharp: 80 }); const m = mat4(p, r, scale); return this.add(mat, g, m, 'raw', 0);
  }
  torus(mat, p, R0, r0, { r = null, seg = 10, tube = 20, arc = Math.PI * 2 } = {}) { const g = new THREE.TorusGeometry(R0, r0, seg, tube, arc); const raw = { p: g.attributes.position.array, n: g.attributes.normal.array, u: g.attributes.uv.array.map((x, i) => x * (i % 2 ? 2 * Math.PI * r0 : 2 * Math.PI * R0)), i: g.index.array, w: null }; this.add(mat, raw, mat4(p, r), 'raw', 0); g.dispose(); return this; }
  /** slotted screw head (base disk + two D-shaped halves = a real slot), axis = outward normal ('x','-x','y','-y','z','-z') */
  screw(mat, p, rad, { axis = 'x', slot = 0, h = null } = {}) {
    const hh = h ?? rad * 0.42, g = rad * 0.22, base = hh * 0.35; const rot = SCREW_ROT[axis];
    const m = mat4(p, rot).multiply(mat4([0, 0, 0], [slot, 0, 0]));
    this.add(mat, latheGeo([[0, 0], [rad, 0], [rad, base], [0, base]], 18, { sharp: 50 }), m.clone().multiply(mat4([0, 0, 0], [0, 0, -90])), 'raw', 1);
    const ca = Math.acos(Math.min(0.99, g / 2 / rad)) / DEG;
    for (const s of [1, -1]) {
      const pts = arcPts(0, 0, rad * 0.97, s > 0 ? -ca : 180 - ca, s > 0 ? ca : 180 + ca, 10); // D half (u = local z, v = local y)
      this.add(mat, extrudeGeo(pts, base * 0.9, hh, { bevel: Math.min(rad * 0.18, 0.0005) }), m, 'raw', 1);
    }
    return this;
  }
  /** cross pin / rivet head flush-ish with a surface: short chamfered cylinder along axis */
  pin(mat, p, rad, len, { axis = 'x', dome = false } = {}) { if (!dome) return this.cyl(mat, p, rad, len, { axis, seg: 14, b: Math.min(rad * 0.3, 0.0004) }); const prof = [[0, -len / 2], [rad, -len / 2], [rad, len / 2 - rad * 0.4], [rad * 0.7, len / 2 - rad * 0.1], [0, len / 2]]; return this.lathe(mat, p, prof, { axis, seg: 14, sharp: 60 }); }
  /** row of ridges (serrations / cooling fins): n boxes spaced `pitch` along dir from start */
  ridges(mat, start, n, pitch, s, dir = [0, 0, 1], { r = null, b = 0.0002 } = {}) { for (let i = 0; i < n; i++) this.box(mat, [start[0] + dir[0] * pitch * i, start[1] + dir[1] * pitch * i, start[2] + dir[2] * pitch * i], s, { r, b }); return this; }
  quad(mat, p, w, h, uv, { r = null } = {}) { return this.add(mat, quadGeo(w, h, uv), mat4(p, r), 'raw', 0); }
}

export class Kit {
  constructor(id) { this.id = id; this.parts = []; this.byName = {}; this.sockets = {}; this.slotMat = null; this.part('root'); }
  /** new rigid part (bone). pivot = rotation centre in gun-local metres (rest pose). */
  part(name, { parent = 'root', pivot = [0, 0, 0] } = {}) { if (this.byName[name]) return this.byName[name]; const par = name === 'root' ? null : this.byName[parent]; const p = new Part(this, name, par, pivot); this.parts.push(p); this.byName[name] = p; return p; }
  get root() { return this.byName.root; }
  /** named frame attached to a part: pos (rest, gun-local), euler degrees */
  socket(name, part, pos, rot = [0, 0, 0]) { const q = rot && rot.isQuaternion ? rot.clone() : new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ')); this.sockets[name] = { part, pos: new THREE.Vector3(...pos), quat: q }; }
  /** socket whose frame axes (X, Y, Z) are given in part-local coordinates */
  socketBasis(name, part, pos, X, Y, Z) { const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...X), new THREE.Vector3(...Y), new THREE.Vector3(...Z)); this.socket(name, part, pos, new THREE.Quaternion().setFromRotationMatrix(m)); }

  /** Merge all parts into per-material geometries. Returns {geos: Map(mat -> BufferGeometry), bounds}. Skin attributes included. */
  geometry() {
    const byMat = new Map();
    for (const part of this.parts) for (const [mat, b] of part.bufs) { let a = byMat.get(mat); if (!a) byMat.set(mat, (a = [])); a.push({ part, b }); }
    const geos = new Map(); const box = new THREE.Box3(); let tris = 0;
    for (const [mat, list] of byMat) {
      let nv = 0, ni = 0; for (const { b } of list) { nv += b.P.length / 3; ni += b.I.length; }
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), W = new Float32Array(nv), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4); const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let ov = 0, oi = 0;
      for (const { part, b } of list) {
        const n = b.P.length / 3; P.set(b.P, ov * 3); N.set(b.N, ov * 3); U.set(b.U, ov * 2); W.set(b.W, ov);
        for (let k = 0; k < n; k++) { SI[(ov + k) * 4] = part.index; SW[(ov + k) * 4] = 1; }
        for (let k = 0; k < b.I.length; k++) I[oi + k] = b.I[k] + ov; ov += n; oi += b.I.length;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      g.setAttribute('aWear', new THREE.BufferAttribute(W, 1)); g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4)); g.setIndex(new THREE.BufferAttribute(I, 1));
      g.computeBoundingSphere(); g.computeBoundingBox(); box.union(g.boundingBox); tris += ni / 3; geos.set(mat, g);
    }
    return { geos, box, tris };
  }
}
