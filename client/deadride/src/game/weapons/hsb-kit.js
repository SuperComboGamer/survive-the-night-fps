// HSB kit ("hard-surface B"): high-density modelling helpers for the rebuilt MP5 / AKS-74U / Olympia / Ray Gun.
// Built on geo.js's Kit/Part (bones = moving parts, one skinned mesh per material) but every solid is FILLETED: nothing has a razor edge.
//   fext(outline, t0, t1, opts)  -> raw geometry: 2D outline extruded from t0 to t1 with rounded (filleted) face edges, smooth wall normals,
//                                   creased corners split, holes supported (sheet metal with real thickness + cut-outs), aWear on the fillets.
//   axis 'x': outline [[z,y]..] extruded along X (side profiles) | 'z': outline [[x,y]..] along Z (cross sections) | 'y': [[x,z]..] along Y
//   hsb(K) -> bound helpers: ex / ez / ey (extrusions), bx (rounded box), lt (rounded lathe), cy / tb (cylinder / tube), rv (rivet), hx (hex), gear (knurl/serration),
//             spring, bar (beam between two points), strip (strap along a path), checker (real checkering geometry), cyl-ring etc.
// All sizes are metres in gun-local space; fillet radii default to 0.5 mm (a real 1:1 edge break) unless stated.
import * as THREE from 'three';
import { roundPoly, arcPts, bezPts, mat4, DEG, sweepGeo, latheGeo } from './geo.js';
export { roundPoly, arcPts, bezPts, DEG };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const jit = (p, k) => { const v = Math.sin(p[0] * 12.9898 + p[1] * 78.233 + p[2] * 37.719 + k * 4.581) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; }; // deterministic pseudo-random -1..1 from a position
export function area(pts) { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function clean(pts) { const o = []; for (const p of pts) { const q = o[o.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-7) o.push([p[0], p[1]]); } while (o.length > 2 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 1e-7) o.pop(); return o; }
/** round the corners of [[u,v,r?]..] when any point carries a radius; segDeg = angular step of the arcs */
export function rp(pts, segDeg = 22) { for (const p of pts) if (p[2] > 0) return roundPoly(pts, segDeg); return pts.map((p) => [p[0], p[1]]); }

class Raw {
  constructor() { this.p = []; this.n = []; this.u = []; this.w = []; this.i = []; }
  v(x, y, z, nx, ny, nz, w = 0, u = 0, t = 0) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, t); this.w.push(w); return this.p.length / 3 - 1; }
  /** triangle oriented so its geometric normal agrees with the vertex normals; degenerate ones are dropped */
  tri(a, b, c) {
    const P = this.p, N = this.n; const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; if (cx * cx + cy * cy + cz * cz < 1e-18) return;
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (cx * nx + cy * ny + cz * nz >= 0) this.i.push(a, b, c); else this.i.push(a, c, b);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
}
const AX = { x: (u, v, t) => [t, v, u], z: (u, v, t) => [u, v, t], y: (u, v, t) => [u, t, v] };

function prep(loop, crease) {
  const n = loop.length, E = [], V = [];
  for (let i = 0; i < n; i++) { const P = loop[i], Q = loop[(i + 1) % n]; const du = Q[0] - P[0], dv = Q[1] - P[1], l = Math.hypot(du, dv) || 1; E.push([dv / l, -du / l]); }
  for (let i = 0; i < n; i++) {
    const a = E[(i - 1 + n) % n], b = E[i]; const ang = Math.acos(clamp(a[0] * b[0] + a[1] * b[1], -1, 1)) / DEG;
    let mu = a[0] + b[0], mv = a[1] + b[1]; const ml = Math.hypot(mu, mv) || 1; mu /= ml; mv /= ml; const dd = mu * a[0] + mv * a[1];
    V.push({ u: loop[i][0], v: loop[i][1], mu, mv, k: 1 / Math.max(dd, 0.3), cr: ang > crease, a, b });
  }
  return { n, V };
}

/**
 * Filleted extrusion. outline: [[u,v]..] (rounded beforehand, see rp), t0..t1 = extent along the axis.
 * opts: r (fillet radius, both faces) | r0 / r1, segs (fillet steps, 1 = soft chamfer, 2 default, 3 = round), holes: [[[u,v]..]..], crease (deg), wear (aWear scale),
 *       axis 'x'|'y'|'z', caps0 / caps1 (false = leave that face open, e.g. hidden inside another part)
 */
export function fext(outline, t0, t1, o = {}) {
  const { holes = [], crease = 38, wear = 1, axis = 'x' } = o; const map = AX[axis]; const S = Math.max(1, o.segs ?? 2);
  const th = t1 - t0, lim = th * 0.5 - 1e-6; let r0 = Math.min(o.r0 ?? o.r ?? 0.0005, lim), r1 = Math.min(o.r1 ?? o.r ?? 0.0005, lim); if (r0 < 2e-5) r0 = 0; if (r1 < 2e-5) r1 = 0;
  const ring = (r, t, sg) => { // rings from the face (phi = 0) to the wall (phi = 90 deg); sg = +1 on the t0 side, -1 on the t1 side
    if (r === 0) return [{ t, ins: 0, nt: -sg, nn: 0, w: 0 }, { t, ins: 0, nt: 0, nn: 1, w: 0 }];
    const a = []; for (let k = 0; k <= S; k++) { const ph = Math.PI / 2 * k / S; a.push({ t: t + sg * r * (1 - Math.cos(ph)), ins: r * (1 - Math.sin(ph)), nt: -sg * Math.cos(ph), nn: Math.sin(ph), w: wear * (k === 0 ? 0.4 : k === S ? 0 : 0.8) }); } return a; }; // wear: face-side of the fillet 0.4, mid 0.8, wall 0 (on near-black paint even 4% of the bare-steel colour shows as blotches)
  const rings = ring(r0, t0, 1).concat(ring(r1, t1, -1).reverse());
  let outer = clean(outline); if (area(outer) < 0) outer.reverse();
  const H = holes.map((h) => { const c = clean(h); if (area(c) > 0) c.reverse(); return c; });
  const loops = [outer, ...H].map((l) => prep(l, crease)); const R = new Raw(); const IDX = [];
  for (let ri = 0; ri < rings.length; ri++) {
    const rg = rings[ri], per = [];
    for (const L of loops) {
      const arr = [];
      for (const q of L.V) {
        const pu = q.u - q.mu * q.k * rg.ins, pv = q.v - q.mv * q.k * rg.ins; const [X, Y, Z] = map(pu, pv, rg.t);
        const mk = (nu, nv) => { const m = map(nu * rg.nn, nv * rg.nn, rg.nt); return R.v(X, Y, Z, m[0], m[1], m[2], rg.w); };
        if (q.cr) arr.push([mk(q.a[0], q.a[1]), mk(q.b[0], q.b[1])]); else { const s = mk(q.mu, q.mv); arr.push([s, s]); }
      }
      per.push(arr);
    }
    IDX.push(per);
  }
  for (let ri = 0; ri < rings.length - 1; ri++) {
    const A = rings[ri], B = rings[ri + 1]; if (Math.abs(A.t - B.t) < 1e-9 && Math.abs(A.ins - B.ins) < 1e-9) continue;
    for (let li = 0; li < loops.length; li++) { const n = loops[li].n; for (let i = 0; i < n; i++) { const j = (i + 1) % n; R.quad(IDX[ri][li][i][1], IDX[ri][li][j][0], IDX[ri + 1][li][j][0], IDX[ri + 1][li][i][1]); } }
  }
  const cap = (ri, nt) => {
    const rg = rings[ri]; const flat = loops.map((L) => L.V.map((q) => [q.u - q.mu * q.k * rg.ins, q.v - q.mv * q.k * rg.ins]));
    const tris = THREE.ShapeUtils.triangulateShape(flat[0].map((p) => new THREE.Vector2(p[0], p[1])), flat.slice(1).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
    const all = flat.flat(), base = R.p.length / 3, nm = map(0, 0, nt); for (const p of all) { const m = map(p[0], p[1], rg.t); R.v(m[0], m[1], m[2], nm[0], nm[1], nm[2], 0); }
    for (const t of tris) R.tri(base + t[0], base + t[1], base + t[2]);
  };
  if (o.caps0 !== false) cap(0, -1); if (o.caps1 !== false) cap(rings.length - 1, 1);
  return R;
}

// ------------------------------------------------------------------ 2D outline builders
/** rounded rectangle polygon [x0,x1] x [y0,y1] with corner radius rc */
export function rrect(x0, x1, y0, y1, rc = 0.0005, deg = 30) { return roundPoly([[x0, y0, rc], [x1, y0, rc], [x1, y1, rc], [x0, y1, rc]], deg); }
/** circle polygon (for holes / round plates) */
export function circ(cu, cv, r, n = 14) { const o = []; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; o.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]); } return o; }
/** slot (stadium) between (u0,v0) and (u1,v1) of width w */
export function slot(u0, v0, u1, v1, w, n = 5) { const a = Math.atan2(v1 - v0, u1 - u0), o = []; for (let k = 0; k <= n; k++) { const t = a - Math.PI / 2 + Math.PI * k / n; o.push([u1 + Math.cos(t) * w / 2, v1 + Math.sin(t) * w / 2]); } for (let k = 0; k <= n; k++) { const t = a + Math.PI / 2 + Math.PI * k / n; o.push([u0 + Math.cos(t) * w / 2, v0 + Math.sin(t) * w / 2]); } return o; }
/** gear / knurl outline: teeth with tip radius R, root radius R - depth, duty = fraction of the pitch at the tip */
export function gearPoly(teeth, R, depth, duty = 0.45) { const o = [], st = Math.PI * 2 / teeth, ro = R - depth; for (let k = 0; k < teeth; k++) { const a = k * st; o.push([Math.cos(a - st * 0.5 * (1 - duty) - st * 0.25) * ro, Math.sin(a - st * 0.5 * (1 - duty) - st * 0.25) * ro], [Math.cos(a - st * duty * 0.5) * R, Math.sin(a - st * duty * 0.5) * R], [Math.cos(a + st * duty * 0.5) * R, Math.sin(a + st * duty * 0.5) * R], [Math.cos(a + st * 0.5 * (1 - duty) + st * 0.25) * ro, Math.sin(a + st * 0.5 * (1 - duty) + st * 0.25) * ro]); } return o; }
export function hexPoly(R, rot = 0) { const o = []; for (let k = 0; k < 6; k++) { const a = rot + k / 6 * Math.PI * 2; o.push([Math.cos(a) * R, Math.sin(a) * R]); } return o; }
/** strap of constant width along a smooth path [[u,v]..] (Catmull-Rom), returned as a closed polygon (for trigger guards, straps, bent wire flats) */
export function strip(path, width, { n = 5, closedEnds = 0.0 } = {}) {
  const cur = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(p[0], p[1], 0)), false, 'centripetal'); const pts = cur.getPoints(Math.max(8, (path.length - 1) * n)); const L = [], Rr = [];
  for (let i = 0; i < pts.length; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let du = b.x - a.x, dv = b.y - a.y; const l = Math.hypot(du, dv) || 1; du /= l; dv /= l; L.push([pts[i].x - dv * width / 2, pts[i].y + du * width / 2]); Rr.push([pts[i].x + dv * width / 2, pts[i].y - du * width / 2]); }
  return L.concat(Rr.reverse());
}
/** helix points along +Z: radius R, `turns`, length len (for springs) */
export function helixPts(len, R, turns, n = 0) { const N = n || Math.max(16, Math.round(turns * 10)), o = []; for (let i = 0; i <= N; i++) { const t = i / N, a = t * turns * Math.PI * 2; o.push([Math.cos(a) * R, Math.sin(a) * R, t * len]); } return o; }

/**
 * Real checkering: a lattice of square pyramids (rotated 45 deg = diamonds) over a region, following a gentle curvature.
 * frame: origin C, unit tangents U, V, normal N (all [x,y,z]); half extents hu, hv; inside(a,b) -> bool clips the region (rounded pad);
 * pitch = distance between grooves, depth = pyramid height; ru / rv = curvature radii of the surface along U / V (Infinity = flat); base = height of the valley plane above the surface.
 */
export function checkerGeo({ C, U, V, N, hu, hv, pitch = 0.0016, depth = 0.0009, ru = Infinity, rv = Infinity, inside = null, rot45 = true }) {
  const R = new Raw(); const cs = rot45 ? Math.SQRT1_2 : 1, sn = rot45 ? Math.SQRT1_2 : 0; const half = Math.hypot(hu, hv);
  const nU = Math.ceil(half / pitch) + 1; const c = new THREE.Vector3(...C), u = new THREE.Vector3(...U), v = new THREE.Vector3(...V), nn = new THREE.Vector3(...N);
  const P = (a, b, h) => { // a, b in pad coordinates (lattice frame is rotated by 45 deg relative to the pad frame)
    const x = a * cs - b * sn, y = a * sn + b * cs; const z = h - (ru === Infinity ? 0 : x * x / (2 * ru)) - (rv === Infinity ? 0 : y * y / (2 * rv)); return new THREE.Vector3().copy(c).addScaledVector(u, x).addScaledVector(v, y).addScaledVector(nn, z); };
  const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3();
  const face = (p0, p1, p2, wr) => { _e1.subVectors(p1, p0); _e2.subVectors(p2, p0); _n.crossVectors(_e1, _e2).normalize(); if (_n.dot(nn) < 0) _n.negate(); const a = R.v(p0.x, p0.y, p0.z, _n.x, _n.y, _n.z, wr), b = R.v(p1.x, p1.y, p1.z, _n.x, _n.y, _n.z, wr), d = R.v(p2.x, p2.y, p2.z, _n.x, _n.y, _n.z, wr); R.tri(a, b, d); };
  for (let i = -nU; i < nU; i++) for (let j = -nU; j < nU; j++) {
    const a0 = i * pitch, a1 = a0 + pitch, b0 = j * pitch, b1 = b0 + pitch, ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
    const xc = ca * cs - cb * sn, yc = ca * sn + cb * cs; if (Math.abs(xc) > hu || Math.abs(yc) > hv) continue; if (inside && !inside(xc, yc)) continue;
    const q00 = P(a0, b0, 0), q10 = P(a1, b0, 0), q11 = P(a1, b1, 0), q01 = P(a0, b1, 0), ap = P(ca, cb, depth);
    face(q00, q10, ap, 0.9); face(q10, q11, ap, 0.9); face(q11, q01, ap, 0.9); face(q01, q00, ap, 0.9);
  }
  return R;
}

// ------------------------------------------------------------------ helpers bound to a Kit
export function hsb(K) {
  const add = (part, mat, raw, o = {}) => part.add(mat, raw, o.m || mat4(o.p || [0, 0, 0], o.r || null, o.s || null), o.uv || 'box', 1, o.uvo || null); // (aWear scale is baked by fext / the lathe, not applied twice)
  const deg = (o, r) => o.deg ?? (r > 0.002 ? 18 : 40);
  const H = {
    add, fext,
    /** side-profile extrusion: outline [[z,y,r?]..] x0..x1 along X */
    ex(part, mat, outline, x0, x1, o = {}) { const d = deg(o, o.r ?? 0.0005); return add(part, mat, fext(rp(outline, d), x0, x1, { ...o, holes: (o.holes || []).map((h) => rp(h, d)), axis: 'x' }), o); },
    /** cross-section extrusion: outline [[x,y,r?]..] z0..z1 along Z */
    ez(part, mat, outline, z0, z1, o = {}) { const d = deg(o, o.r ?? 0.0005); return add(part, mat, fext(rp(outline, d), z0, z1, { ...o, holes: (o.holes || []).map((h) => rp(h, d)), axis: 'z' }), o); },
    /** plan-view extrusion: outline [[x,z,r?]..] y0..y1 along Y */
    ey(part, mat, outline, y0, y1, o = {}) { const d = deg(o, o.r ?? 0.0005); return add(part, mat, fext(rp(outline, d), y0, y1, { ...o, holes: (o.holes || []).map((h) => rp(h, d)), axis: 'y' }), o); },
    /** fully rounded box, centre p, size [w,h,d] (x,y,z); o.r fillet (all 12 edges), o.rot euler deg */
    bx(part, mat, p, s, o = {}) { const r = Math.min(o.r ?? 0.0006, Math.min(s[0], s[1], s[2]) * 0.3); return add(part, mat, fext(rrect(-s[0] / 2, s[0] / 2, -s[1] / 2, s[1] / 2, r, o.deg ?? 45), -s[2] / 2, s[2] / 2, { r, segs: o.segs ?? 2, axis: 'z', wear: o.wear ?? 1, caps0: o.caps0, caps1: o.caps1 }), { ...o, p, r: o.rot }); },
    /** rounded lathe: closed profile polygon [[radius, axial, fillet?]..] (include the axis edge), axis 'x'|'y'|'z' */
    lt(part, mat, p, prof, o = {}) { return part.lathe(mat, p, roundPoly(prof, o.deg ?? 20), { axis: o.axis || 'z', seg: o.seg ?? 24, r: o.rot || null, t0: o.t0, tlen: o.tlen, wear: o.wear ?? 1, sharp: o.sharp ?? 55, chamfer: o.chamfer ?? 0.004, uvOff: o.uvo || null, scale: o.scale || null }); },
    /** cylinder / cone frustum, centre p, radius r | [r0 (at -axis end), r1], length len, edge fillet o.r */
    cy(part, mat, p, rad, len, o = {}) { const r0 = Array.isArray(rad) ? rad[0] : rad, r1 = Array.isArray(rad) ? rad[1] : rad, h = len / 2, rc = Math.min(o.r ?? 0.0005, r0 * 0.45, r1 * 0.45, h * 0.45); return H.lt(part, mat, p, [[0, -h], [r0, -h, rc], [r1, h, rc], [0, h]], o); },
    /** tube: outer ro, inner ri, length; fillets on all four edges */
    tb(part, mat, p, ro, ri, len, o = {}) { const h = len / 2, rc = Math.min(o.r ?? 0.0005, (ro - ri) * 0.4, h * 0.45); return H.lt(part, mat, p, [[ri, -h, rc], [ro, -h, rc], [ro, h, rc], [ri, h, rc]], o); },
    /** domed rivet / round-head screw (axis = outward normal), radius r, height h */
    rv(part, mat, p, r0, o = {}) { // hand-made fasteners are never perfectly placed: deterministic +-0.25 mm slide along the surface, +-5 % size, +-8 % height
      const ax = (o.axis || 'x').replace('-', ''), q = [p[0], p[1], p[2]], a = 0.00025; if (ax !== 'x') q[0] += jit(p, 1) * a; if (ax !== 'y') q[1] += jit(p, 2) * a; if (ax !== 'z') q[2] += jit(p, 3) * a;
      const r = r0 * (1 + jit(p, 4) * 0.05), h = (o.h ?? r0 * 0.55) * (1 + jit(p, 6) * 0.08); return H.lt(part, mat, q, [[0, 0], [r, 0], [r * 0.96, h * 0.45], [r * 0.7, h * 0.9], [0, h]], { axis: o.axis || 'x', seg: o.seg ?? 10, deg: 60, wear: o.wear ?? 0.7 }); },
    /** hex head / nut: circumradius R, thickness t, axis normal; chamfered by fext */
    hx(part, mat, p, R, t, o = {}) { const ax0 = o.axis || 'x', neg = ax0[0] === '-', ax = neg ? ax0.slice(1) : ax0; return add(part, mat, fext(hexPoly(R, (o.spin || 0) + jit(p, 5) * 0.2), neg ? -t : 0, neg ? 0 : t, { r: Math.min(0.0004, t * 0.3), segs: 1, axis: ax, wear: 0.9 }), { ...o, p, r: o.rot }); },
    /** slotted screw head with an actual slot (two D-halves) - thin wrapper around Part.screw */
    sc(part, mat, p, r, o = {}) { return part.screw(mat, p, r, { axis: o.axis || 'x', slot: o.slot ?? 20 }); },
    /** knurl / serration ring: gear outline extruded along the axis */
    gear(part, mat, p, teeth, R, depth, len, o = {}) { return add(part, mat, fext(gearPoly(teeth, R, depth, o.duty ?? 0.45), -len / 2, len / 2, { r: Math.min(0.0003, len * 0.2), segs: 1, axis: o.axis || 'z', wear: 0.9 }), { ...o, p, r: o.rot }); },
    /** coil spring from a to b: wire radius, mean coil radius R, turns */
    spring(part, mat, a, b, R, wire, turns, o = {}) {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B), z = B.clone().sub(A).normalize(); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), z);
      const M = new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1)); return part.add(mat, sweepGeo(helixPts(L, R, turns, o.n || 0), wire, { seg: o.seg ?? 6 }), M, 'raw', 0.3);
    },
    /** beam between two points (gun-local), cross-section w (across, roughly x) x h, fillet r */
    bar(part, mat, a, b, w, h, o = {}) {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B), z = B.clone().sub(A).normalize(); const up = Math.abs(z.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const x = new THREE.Vector3().crossVectors(up, z).normalize(), y = new THREE.Vector3().crossVectors(z, x); const M = new THREE.Matrix4().makeBasis(x, y, z).setPosition(A.clone().add(B).multiplyScalar(0.5));
      return H.bx(part, mat, [0, 0, 0], [w, h, L + (o.ext ?? 0)], { ...o, m: M, rot: null, r: o.r ?? 0.0006 });
    },
    /** flat strap along a side-view path (z,y), thickness x0..x1 */
    sx(part, mat, path, width, x0, x1, o = {}) { return H.ex(part, mat, strip(path, width, o), x0, x1, o); },
    /** real checkering (see checkerGeo) */
    checker(part, mat, o) { return part.add(mat, checkerGeo(o), new THREE.Matrix4(), 'box', 0.8); },
  };
  return H;
}
