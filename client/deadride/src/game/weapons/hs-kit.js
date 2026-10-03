// Hard-surface kit v2 for the weapon models (adds to geo.js; nothing in geo.js is changed).
//  * rboxRaw / Part.rb      : welded ROUNDED box (true fillets, `seg` facets per 45 deg, smooth normals, wear on the fillet band)
//  * extrudeR / Part.rext, rextZ : outline extrusion with REAL rounded cap edges (seg facets) and split normals on sharp outline corners
//  * checkerRaw / Part.checker   : diamond checkering as real pyramids (flat-shaded facets) over any parametric surface
//  * Part.knurl              : fluted or diamond knurling on a cylinder (real ridges, seamless wrap)
//  * Part.spring             : coil spring (helix sweep)
//  * roundOpen, circle, hexPoly, insideTest, rng, planeMap, measureKit : small helpers
// Conventions identical to geo.js: gun-local metres, -Z = muzzle, +Y up, +X right. Every primitive carries `aWear` (0..1) on the
// fillet / ridge-tip vertices so the finish shader wears exactly the edges a hand or a holster would touch.
import * as THREE from 'three';
import { Kit, mat4, DEG, loftGeo, quadGeo } from './geo.js';

export const Part = new Kit('__hs').root.constructor; // Part is not exported by geo.js
const SWAP = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1); // x <-> z (cross-section outlines extruded along z)

// ------------------------------------------------------------------ helpers
export function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function circle(cx, cy, r, n = 20, a0 = 0) { const o = []; for (let k = 0; k < n; k++) { const a = a0 * DEG + k / n * Math.PI * 2; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; }
export function hexPoly(cx, cy, r, rot = 0) { return circle(cx, cy, r, 6, rot); }
/** open polyline with per-point fillet radius: [[u,v,r?],...] -> rounded polyline (end points untouched); for lathe profiles / sweeps */
export function roundOpen(pts, segDeg = 12) {
  const out = [[pts[0][0], pts[0][1]]]; const n = pts.length;
  for (let i = 1; i < n - 1; i++) {
    const P = pts[i], r = P[2] || 0; if (r <= 0) { out.push([P[0], P[1]]); continue; }
    const A = pts[i - 1], B = pts[i + 1]; let d1u = A[0] - P[0], d1v = A[1] - P[1], d2u = B[0] - P[0], d2v = B[1] - P[1]; const l1 = Math.hypot(d1u, d1v), l2 = Math.hypot(d2u, d2v);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push([P[0], P[1]]); continue; } d1u /= l1; d1v /= l1; d2u /= l2; d2v /= l2;
    const al = Math.acos(Math.max(-1, Math.min(1, d1u * d2u + d1v * d2v))); if (al < 1e-3 || al > Math.PI - 1e-3) { out.push([P[0], P[1]]); continue; }
    let tl = r / Math.tan(al / 2); const lim = 0.49 * Math.min(l1, l2); let rr = r; if (tl > lim) { tl = lim; rr = tl * Math.tan(al / 2); }
    const bu = d1u + d2u, bv = d1v + d2v, bl = Math.hypot(bu, bv), cd = rr / Math.sin(al / 2); const cu = P[0] + bu / bl * cd, cv = P[1] + bv / bl * cd;
    const t1u = P[0] + d1u * tl, t1v = P[1] + d1v * tl, t2u = P[0] + d2u * tl, t2v = P[1] + d2v * tl; let a0 = Math.atan2(t1v - cv, t1u - cu), a1 = Math.atan2(t2v - cv, t2u - cu), da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; const ns = Math.max(1, Math.ceil(Math.abs(da) / (segDeg * DEG)));
    for (let k = 0; k <= ns; k++) { const a = a0 + da * k / ns; out.push([cu + Math.cos(a) * rr, cv + Math.sin(a) * rr]); }
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]); return out;
}
/** point-in-polygon with an inset margin (for checkering borders): returns fn(u,v) */
export function insideTest(poly, margin = 0) {
  const n = poly.length;
  return (u, v) => {
    let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
    if (!c) return false; if (margin <= 0) return true;
    for (let i = 0, j = n - 1; i < n; j = i++) { const a = poly[i], b = poly[j]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; let t = ((u - a[0]) * dx + (v - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); if (Math.hypot(u - a[0] - t * dx, v - a[1] - t * dy) < margin) return false; }
    return true;
  };
}
/** parametric planar surface: origin o, unit axes U,V (normal = U x V) -> map(u,v) = {p, n} */
export function planeMap(o, U, V) { const n = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]]; return (u, v) => ({ p: [o[0] + U[0] * u + V[0] * v, o[1] + U[1] * u + V[1] * v, o[2] + U[2] * u + V[2] * v], n }); }

// ------------------------------------------------------------------ raw mesh builders
const R_ = () => ({ p: [], n: [], u: [], w: [], i: [] });
const vtx = (r, x, y, z, nx, ny, nz, u, v, w) => { r.p.push(x, y, z); r.n.push(nx, ny, nz); r.u.push(u, v); r.w.push(w); return r.p.length / 3 - 1; };
function tri(r, a, b, c) { // orient so the geometric normal agrees with the summed vertex normals
  const P = r.p, N = r.n; const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
  if (cx * nx + cy * ny + cz * nz >= 0) r.i.push(a, b, c); else r.i.push(a, c, b);
}
const quad = (r, a, b, c, d) => { tri(r, a, b, c); tri(r, a, c, d); };
const polyArea = (pts) => { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const cleanPoly = (pts) => { const o = []; for (const p of pts) { const q = o[o.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-7) o.push([p[0], p[1]]); } while (o.length > 2 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 1e-7) o.pop(); return o; };

/** welded rounded box: outer size w,h,d, fillet radius r, `seg` facets per 45 deg of every edge/corner (seg 1 = 2 facets per quarter round) */
const _rb = new Map();
export function rboxRaw(w, h, d, r = 0.0005, seg = 2) {
  const key = `${w.toFixed(5)},${h.toFixed(5)},${d.toFixed(5)},${r.toFixed(5)},${seg}`; let g = _rb.get(key); if (g) return g;
  const hx = w / 2, hy = h / 2, hz = d / 2, rr = Math.max(1e-5, Math.min(r, hx * 0.98, hy * 0.98, hz * 0.98)); const ix = hx - rr, iy = hy - rr, iz = hz - rr;
  const lines = (i) => { const pos = [i]; for (let k = 1; k <= seg; k++) pos.push(i + rr * Math.tan(Math.PI / 4 * k / seg)); const neg = pos.slice().reverse().map((v) => -v); return neg.concat(pos); };
  const Lx = lines(ix), Ly = lines(iy), Lz = lines(iz), n = Lx.length; g = R_(); const id = new Int32Array(n * n * n).fill(-1);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) {
    if (a && a < n - 1 && b && b < n - 1 && c && c < n - 1) continue;
    const qx = Lx[a], qy = Ly[b], qz = Lz[c]; const ux = Math.max(-ix, Math.min(ix, qx)), uy = Math.max(-iy, Math.min(iy, qy)), uz = Math.max(-iz, Math.min(iz, qz));
    let dx = qx - ux, dy = qy - uy, dz = qz - uz; const l = Math.hypot(dx, dy, dz) || 1; const cnt = (Math.abs(dx) > 1e-9) + (Math.abs(dy) > 1e-9) + (Math.abs(dz) > 1e-9); dx /= l; dy /= l; dz /= l;
    id[(a * n + b) * n + c] = vtx(g, ux + dx * rr, uy + dy * rr, uz + dz * rr, dx, dy, dz, 0, 0, cnt >= 2 ? 1 : 0);
  }
  const I = (a, b, c) => id[(a * n + b) * n + c];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) for (const s of [0, n - 1]) {
    quad(g, I(s, i, j), I(s, i + 1, j), I(s, i + 1, j + 1), I(s, i, j + 1));
    quad(g, I(i, s, j), I(i + 1, s, j), I(i + 1, s, j + 1), I(i, s, j + 1));
    quad(g, I(i, j, s), I(i + 1, j, s), I(i + 1, j + 1, s), I(i, j + 1, s));
  }
  _rb.set(key, g); return g;
}

/**
 * Outline extrusion along +X (u -> gun z, v -> gun y) with rounded cap edges. Same contract as geo.js extrudeGeo but the edge is a real
 * fillet of radius r (r0 / r1 per cap; 0 = sharp) built from `seg` facets per 90 deg, smooth normals along smooth outline stretches
 * and split (flat) normals at outline corners sharper than `crease` degrees. holes: outlines cut through. wearWalls: aWear on creased corners.
 */
export function extrudeR(outline, x0, x1, { r = 0.0006, r0 = null, r1 = null, seg = 2, holes = [], crease = 40, wearWalls = 0, caps = true } = {}) {
  const th = x1 - x0; const R0 = Math.max(0, Math.min(r0 ?? r, th * 0.45)), R1 = Math.max(0, Math.min(r1 ?? r, th * 0.45)); const g = R_();
  let outer = cleanPoly(outline); if (polyArea(outer) < 0) outer.reverse(); const hs = holes.map((h) => { const c = cleanPoly(h); if (polyArea(c) > 0) c.reverse(); return c; }); const loops = [outer, ...hs];
  const rings = [];
  if (R0 > 0) for (let k = seg; k >= 0; k--) { const a = Math.PI / 2 * k / seg; rings.push({ x: x0 + R0 - R0 * Math.sin(a), d: R0 * (1 - Math.cos(a)), nx: -Math.sin(a), nc: Math.cos(a), w: k > 0 ? 1 : 0 }); } else rings.push({ x: x0, d: 0, nx: 0, nc: 1, w: 0 });
  if (R1 > 0) for (let k = 0; k <= seg; k++) { const a = Math.PI / 2 * k / seg; rings.push({ x: x1 - R1 + R1 * Math.sin(a), d: R1 * (1 - Math.cos(a)), nx: Math.sin(a), nc: Math.cos(a), w: k > 0 ? 1 : 0 }); } else rings.push({ x: x1, d: 0, nx: 0, nc: 1, w: 0 });
  const mit = [];
  for (const loop of loops) {
    const n = loop.length, en = [], sv = []; let s = 0, mi = []; for (let i = 0; i < n; i++) { const P = loop[i], Q = loop[(i + 1) % n]; const du = Q[0] - P[0], dv = Q[1] - P[1], l = Math.hypot(du, dv) || 1; en.push([dv / l, -du / l]); sv.push(s); s += l; }
    const st = [];
    for (let i = 0; i < n; i++) {
      const np = en[(i - 1 + n) % n], nn = en[i]; const ang = Math.acos(Math.max(-1, Math.min(1, np[0] * nn[0] + np[1] * nn[1]))) / DEG; let mu = np[0] + nn[0], mv = np[1] + nn[1]; const ml = Math.hypot(mu, mv) || 1; mu /= ml; mv /= ml;
      const dd = mu * np[0] + mv * np[1], f = Math.min(1 / Math.max(dd, 0.3), 3); mi.push({ mu, mv, f }); const cr = ang > crease;
      const mk = (nu, nv, wallW) => rings.map((rg) => vtx(g, rg.x, loop[i][1] - mv * rg.d * f, loop[i][0] - mu * rg.d * f, rg.nx, rg.nc * nv, rg.nc * nu, sv[i], rg.x, rg.nc > 0.999 ? wallW : rg.w));
      if (cr) st.push({ A: mk(np[0], np[1], wearWalls), B: mk(nn[0], nn[1], wearWalls) }); else { const q = mk(mu, mv, 0); st.push({ A: q, B: q }); }
    }
    mit.push(mi);
    for (let i = 0; i < n; i++) { const S0 = st[i].B, S1 = st[(i + 1) % n].A; for (let k = 0; k < rings.length - 1; k++) quad(g, S0[k], S1[k], S1[k + 1], S0[k + 1]); }
  }
  if (caps) for (const [xe, nxs, Re] of [[x0, -1, R0], [x1, 1, R1]]) {
    const base = g.p.length / 3, pts2 = [];
    loops.forEach((loop, li) => loop.forEach((P, i) => { const m = mit[li][i], off = Re * m.f, pu = P[0] - m.mu * off, pv = P[1] - m.mv * off; pts2.push(new THREE.Vector2(pu, pv)); vtx(g, xe, pv, pu, nxs, 0, 0, pu, pv, 0); }));
    let o = outer.length; const contour = pts2.slice(0, o); const holeArr = hs.map((h) => { const a = pts2.slice(o, o + h.length); o += h.length; return a; });
    for (const t of THREE.ShapeUtils.triangulateShape(contour, holeArr)) tri(g, base + t[0], base + t[1], base + t[2]);
  }
  return g;
}

/**
 * Diamond checkering as REAL geometry: a lattice of square pyramids (pitch = groove spacing) rotated `alpha` deg in the (u,v) plane of a
 * parametric surface map(u,v) -> {p:[x,y,z], n:[x,y,z]}. Valleys sit on the surface, tips rise `h`. Flat-shaded facets; aWear on the tips.
 * inside(u,v): cell-centre test (border margins / outlines). Returns raw mesh.
 */
export function checkerRaw({ map, u0, u1, v0, v1, pitch = 0.0015, h = 0.0004, alpha = 45, inside = null, tipWear = 0.8, seed = 0 }) {
  const g = R_(), ca = Math.cos(alpha * DEG), sa = Math.sin(alpha * DEG); const rnd = rng(seed + 7);
  const cs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [(u * ca + v * sa) / pitch, (-u * sa + v * ca) / pitch]);
  const m0 = Math.floor(Math.min(...cs.map((c) => c[0]))) - 1, m1 = Math.ceil(Math.max(...cs.map((c) => c[0]))) + 1, n0 = Math.floor(Math.min(...cs.map((c) => c[1]))) - 1, n1 = Math.ceil(Math.max(...cs.map((c) => c[1]))) + 1;
  const UV = (m, n) => [(m * ca - n * sa) * pitch, (m * sa + n * ca) * pitch];
  const P3 = (u, v, hh) => { const s = map(u, v); return [s.p[0] + s.n[0] * hh, s.p[1] + s.n[1] * hh, s.p[2] + s.n[2] * hh, s.n]; };
  for (let m = m0; m < m1; m++) for (let n = n0; n < n1; n++) {
    const [uc, vc] = UV(m + 0.5, n + 0.5); if (uc < u0 || uc > u1 || vc < v0 || vc > v1) continue; if (inside && !inside(uc, vc)) continue;
    const hh = h * (0.92 + rnd() * 0.16); const pk = P3(uc, vc, hh); const q = [UV(m, n), UV(m + 1, n), UV(m + 1, n + 1), UV(m, n + 1)].map(([u, v]) => P3(u, v, 0));
    for (let k = 0; k < 4; k++) {
      const A = q[k], B = q[(k + 1) % 4]; const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = pk[0] - A[0], vy = pk[1] - A[1], vz = pk[2] - A[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (nx * pk[3][0] + ny * pk[3][1] + nz * pk[3][2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const a = vtx(g, A[0], A[1], A[2], nx, ny, nz, 0, 0, 0), b = vtx(g, B[0], B[1], B[2], nx, ny, nz, 0, 0, 0), c = vtx(g, pk[0], pk[1], pk[2], nx, ny, nz, 0, 0, tipWear);
      // winding of (A,B,peak) must agree with the facet normal (which was already flipped toward the surface normal)
      const cx = (B[1] - A[1]) * (pk[2] - A[2]) - (B[2] - A[2]) * (pk[1] - A[1]), cy = (B[2] - A[2]) * (pk[0] - A[0]) - (B[0] - A[0]) * (pk[2] - A[2]), cz = (B[0] - A[0]) * (pk[1] - A[1]) - (B[1] - A[1]) * (pk[0] - A[0]);
      if (cx * nx + cy * ny + cz * nz >= 0) g.i.push(a, b, c); else g.i.push(a, c, b);
    }
  }
  return g;
}

/** fluted (straight) knurl along local +Z: n flutes, ridge radius R, valley R-depth, from z0..z1 (flat-shaded V facets) */
export function flutedRaw(R, z0, z1, n = 48, depth = 0.0004) {
  const g = R_(); const pts = []; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 0.5) / n * Math.PI * 2; pts.push([Math.cos(a0) * R, Math.sin(a0) * R, 1], [Math.cos(a1) * (R - depth), Math.sin(a1) * (R - depth), 0]); }
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const A = pts[i], B = pts[(i + 1) % m]; const ex = B[0] - A[0], ey = B[1] - A[1]; let nx = ey, ny = -ex; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; // outward for CCW
    const wA = A[2] * 0.9, wB = B[2] * 0.9; const a = vtx(g, A[0], A[1], z0, nx, ny, 0, 0, 0, wA), b = vtx(g, B[0], B[1], z0, nx, ny, 0, 0, 0, wB), c = vtx(g, B[0], B[1], z1, nx, ny, 0, 0, 0, wB), d = vtx(g, A[0], A[1], z1, nx, ny, 0, 0, 0, wA); quad(g, a, b, c, d);
  }
  for (const [z, sg] of [[z0, -1], [z1, 1]]) { const c = vtx(g, 0, 0, z, 0, 0, sg, 0, 0, 0); const ring = pts.map((q) => vtx(g, q[0], q[1], z, 0, 0, sg, 0, 0, 0)); for (let i = 0; i < m; i++) tri(g, c, ring[i], ring[(i + 1) % m]); }
  return g;
}

// ------------------------------------------------------------------ Part methods
const P0 = [0, 0, 0];
export const HS = { wear: 0.62 }; // global scale on every aWear value written by the hs primitives (edge wear reads as a thin worn line, not stitching)
/** rounded box: (mat, centre, size, {r: fillet, seg, rot: euler deg, wear}) */
Part.prototype.rb = function (mat, p, s, { r = 0.0005, seg = 2, rot = null, wear = 1, uv = 'box' } = {}) { return this.add(mat, rboxRaw(s[0], s[1], s[2], r, seg), mat4(p, rot), uv, wear * HS.wear); };
/** outline extruded along X between x0..x1 (outline u = gun z, v = gun y) with real rounded edges: (mat, outline, x0, x1, {r, r0, r1, seg, holes, crease, wearWalls, p, rot, wear}) */
Part.prototype.rext = function (mat, outline, x0, x1, o = {}) { return this.add(mat, extrudeR(outline, x0, x1, o), mat4(o.p || P0, o.rot || null), o.uv || 'box', (o.wear ?? 1) * HS.wear); };
/** cross-section outline (x,y) extruded along Z between z0..z1 with real rounded cap edges */
Part.prototype.rextZ = function (mat, outline, z0, z1, o = {}) { return this.add(mat, extrudeR(outline, z0, z1, o), mat4(o.p || P0, o.rot || null).multiply(SWAP), o.uv || 'box', (o.wear ?? 1) * HS.wear); };
/** checkering patch: (mat, {map, u0,u1,v0,v1, pitch, h, alpha, inside, p, rot}) */
Part.prototype.checker = function (mat, o) { return this.add(mat, checkerRaw(o), mat4(o.p || P0, o.rot || null), 'box', o.wear ?? 1); };
/** knurl on a cylinder along `axis` (x|y|z|-x|..): fluted (ridges) or diamond (cross-hatch pyramids). p = centre. */
const KAX = { z: null, '-z': [180, 0, 0], x: [0, 90, 0], '-x': [0, -90, 0], y: [-90, 0, 0], '-y': [90, 0, 0] };
Part.prototype.knurl = function (mat, p, R, len, { axis = 'z', n = 48, depth = 0.0004, diamond = false, pitch = 0.0008, rot = null, wear = 1 } = {}) {
  const m = mat4(p, rot); const ar = KAX[axis]; if (ar) m.multiply(mat4(P0, ar));
  if (!diamond) return this.add(mat, flutedRaw(R, -len / 2, len / 2, n, depth), m, 'box', wear * HS.wear);
  const circ = 2 * Math.PI * R, nu = Math.max(4, Math.round(circ / (pitch * Math.SQRT2))), pp = circ / (nu * Math.SQRT2); // seamless wrap
  const map = (u, v) => { const a = u / R; return { p: [Math.cos(a) * (R - depth * 0.5), Math.sin(a) * (R - depth * 0.5), v], n: [Math.cos(a), Math.sin(a), 0] }; };
  return this.add(mat, checkerRaw({ map, u0: 0, u1: circ, v0: -len / 2, v1: len / 2, pitch: pp, h: depth, alpha: 45, tipWear: 0.9 }), m, 'box', wear * HS.wear);
};
/** light slotted screw head (dome lathe + dark slot bar; ~120 vertices vs ~340 for geo.js screw): axis = outward normal, slot = slot angle (deg) */
Part.prototype.hsScrew = function (mat, p, rad, { axis = 'x', slot = 0, h = null, dark = 'bore', seg = 12 } = {}) {
  const hh = h ?? rad * 0.42; this.rlathe(mat, p, [[0, 0], [rad, 0, rad * 0.1], [rad, hh * 0.45], [rad * 0.64, hh * 0.93, rad * 0.22], [0, hh]], { axis, seg, sharp: 70 });
  const m = mat4(p, null); const ar = KAX[axis]; if (ar) m.multiply(mat4(P0, ar)); m.multiply(mat4([0, 0, hh * 0.985], [0, 0, slot]));
  return this.add(dark, quadGeo(rad * 1.86, Math.max(0.0003, rad * 0.24)), m, 'box', 0);
};
/** coil spring between two points: (mat, a, b, {R, wire, turns, seg, ppt}) */
Part.prototype.spring = function (mat, a, b, { R = 0.004, wire = 0.0004, turns = 12, seg = 6, ppt = 10 } = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), ax = B.clone().sub(A), L = ax.length(); ax.normalize(); const u = new THREE.Vector3(Math.abs(ax.y) < 0.9 ? 0 : 1, Math.abs(ax.y) < 0.9 ? 1 : 0, 0).cross(ax).normalize(), v = ax.clone().cross(u);
  const pts = []; const n = Math.round(turns * ppt); for (let k = 0; k <= n; k++) { const t = k / n, ph = t * turns * Math.PI * 2; pts.push(A.clone().addScaledVector(ax, L * t).addScaledVector(u, Math.cos(ph) * R).addScaledVector(v, Math.sin(ph) * R).toArray()); }
  return this.sweep(mat, pts, wire, { seg });
};
/** geo.js profLoft with a selectable UV mode ('box' = gun-space projection: grain runs along z on every face, no contour-line artefacts on swelling grips) */
Part.prototype.profLoftB = function (mat, { top, bot, w, n = [[0, 2.6]], z0, z1, steps = 40, K = 30, x = 0, wear = 0.4, capStart = true, capEnd = true, uv = 'box' }) {
  const f = (keys, z) => { if (keys.length === 1) return keys[0][1]; let i = 0; while (i < keys.length - 2 && z > keys[i + 1][0]) i++; const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
    const t = Math.max(0, Math.min(1, (z - k1[0]) / ((k2[0] - k1[0]) || 1))); const t2 = t * t, t3 = t2 * t; const m1 = (k2[1] - k0[1]) / ((k2[0] - k0[0]) || 1) * (k2[0] - k1[0]), m2 = (k3[1] - k1[1]) / ((k3[0] - k1[0]) || 1) * (k2[0] - k1[0]);
    return (2 * t3 - 3 * t2 + 1) * k1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[1] + (t3 - t2) * m2; };
  const secs = []; for (let i = 0; i <= steps; i++) { const z = z0 + (z1 - z0) * i / steps; const t = f(top, z), b = f(bot, z), hw = f(w, z); secs.push({ c: [x, (t + b) / 2, z], a: hw, b: (t - b) / 2, n: f(n, z), t: [0, 0, z1 > z0 ? 1 : -1] }); }
  return this.add(mat, loftGeo(secs, { K, wear, capStart, capEnd }), mat4([0, 0, 0]), uv, 1);
};
/** lathe with filleted profile points: (mat, centre, [[r,a,fillet?]...], opts as Part.lathe) */
Part.prototype.rlathe = function (mat, p, profile, o = {}) { return this.lathe(mat, p, roundOpen(profile, o.segDeg || 12), { ...o, wear: (o.wear ?? 1) * HS.wear }); };

// ------------------------------------------------------------------ measuring helper (works headless and in the engine)
/** per-part and overall bounding boxes of a Kit (metres) + expectation checks [[label, value, expected, tolFraction]] -> printable rows */
export function measureKit(kit, checks = []) {
  const all = new THREE.Box3(), rows = [], parts = {};
  for (const part of kit.parts) { const b = new THREE.Box3(); for (const buf of part.bufs.values()) for (let k = 0; k < buf.P.length; k += 3) b.expandByPoint(_v.set(buf.P[k], buf.P[k + 1], buf.P[k + 2])); if (!b.isEmpty()) { parts[part.name] = b; all.union(b); } }
  const sz = all.getSize(new THREE.Vector3());
  rows.push(`overall L ${(sz.z * 1000).toFixed(1)} mm  H ${(sz.y * 1000).toFixed(1)} mm  W ${(sz.x * 1000).toFixed(1)} mm`);
  for (const [n, b] of Object.entries(parts)) rows.push(`  ${n.padEnd(12)} z ${(b.min.z * 1000).toFixed(1)}..${(b.max.z * 1000).toFixed(1)}  y ${(b.min.y * 1000).toFixed(1)}..${(b.max.y * 1000).toFixed(1)}  x ${(b.min.x * 1000).toFixed(1)}..${(b.max.x * 1000).toFixed(1)}`);
  for (const [label, val, exp, tol] of checks) { const err = (val - exp) / exp; rows.push(`${Math.abs(err) <= tol ? 'OK  ' : 'FAIL'} ${label}: ${(val * 1000).toFixed(1)} mm vs ${(exp * 1000).toFixed(1)} mm (${(err * 100).toFixed(1)} %)`); }
  return { rows, box: all, parts, size: sz };
}
const _v = new THREE.Vector3();
