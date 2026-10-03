// LAST FERRY — architecture + vehicle detail (round 3): real brick facades (plinth, pilasters, string courses, stepped corbel cornice with dentils, wall-anchor plates, air bricks),
// roller-shutter loading doors, modelled tower blocks (podium / shaft / set-backs / crown + rooftop plant, tank on legs, mast), truck detail (lug nuts, tread lugs, mud flaps, wipers, handles,
// louvres, van ribs, flatbed boards), rail-wagon running gear, chain links, three-strand twisted rope. Everything lands in the caller's Builder (StaticBatch / Instancer).
import * as THREE from 'three';
const P = Math.PI;

/** brick facade relief on a wall whose outward normal is dir*z (dir -1 = 'n' face). Wall plane z; spans x0..x1; bays start at a0 with pitch `bay`. m: {wall, stone, iron, reveal} */
export function facadeReal(K, m, o) {
  const B = K.B, { x0, x1, z, y0, h, dir = -1, bay = 3.4, floors = 3, a0 = x0 + 0.2 } = o, L = x1 - x0, cx = (x0 + x1) / 2, floorH = (h - 1.4) / floors, courses = o.courses || Array.from({ length: floors - 1 }, (_, i) => 0.8 + (i + 1) * floorH);
  const ax = o.axis || 'x', box = (u, y, out, su, sy, so, mat, bev = 0.006) => B.box({ p: ax === 'x' ? [u, y, z + dir * out] : [z + dir * out, y, u], s: ax === 'x' ? [su, sy, so] : [so, sy, su], mat, bevel: bev, cast: true, col: false });
  box(cx, y0, 0.07, L + 0.16, 0.8, 0.14, m.stone, 0.01); box(cx, y0 + 0.8, 0.09, L + 0.22, 0.1, 0.18, m.stone, 0.01);                                       // plinth + water table
  for (let px = a0; px <= x1 + 0.01; px += bay) { if (px < x0 + 0.15 || px > x1 - 0.15) continue; box(px, y0 + 0.9, 0.06, 0.44, h - 1.85, 0.12, m.wall, 0.008); box(px, y0 + h - 0.95, 0.1, 0.58, 0.18, 0.2, m.stone, 0.01); box(px, y0 + 0.88, 0.1, 0.56, 0.14, 0.2, m.stone, 0.01);
    for (const ch of courses) box(px, y0 + ch + 0.25, 0.135, 0.15, 0.15, 0.03, m.iron, 0.004); }                                            // pilasters, caps, bases, anchor plates
  for (const ch of courses) box(cx, y0 + ch - 0.09, 0.05, L, 0.18, 0.1, m.stone, 0.008);                                                   // string courses
  const yc = y0 + h; box(cx, yc - 0.78, 0.05, L + 0.06, 0.1, 0.1, m.stone); for (let dx = x0 + 0.15; dx < x1 - 0.1; dx += 0.36) box(dx, yc - 0.68, 0.08, 0.15, 0.1, 0.09, m.stone, 0);   // corbel course + dentils
  box(cx, yc - 0.58, 0.12, L + 0.26, 0.16, 0.24, m.stone, 0.01); box(cx, yc - 0.42, 0.2, L + 0.36, 0.14, 0.4, m.stone, 0.01); box(cx, yc - 0.28, 0.3, L + 0.46, 0.28, 0.6, m.stone, 0.012);   // stepped cornice
  for (let px = a0 + bay / 2; px < x1 - 0.2; px += bay) box(px, y0 + 0.36, 0.145, 0.24, 0.14, 0.02, m.reveal, 0);                                                // air bricks
}

/** roller-shutter loading door in front of a wall plane z (dir -1 = north face): slats, guide rails, drum + hood, bottom bar with hazard stripe */
export function rollerDoor(B, m, x, y, z, w, h, dir = -1) {
  const n = Math.round(h / 0.085), sl = h / n;
  for (let i = 0; i < n; i++) B.box({ p: [x, y + i * sl, z + dir * 0.05], s: [w, sl - 0.008, 0.04], mat: m.iron, bevel: 0, cast: false });
  for (const s of [-1, 1]) B.box({ p: [x + s * (w / 2 + 0.07), y, z + dir * 0.08], s: [0.13, h + 0.25, 0.14], mat: m.iron, bevel: 0.01, cast: true });
  B.box({ p: [x, y + h + 0.02, z + dir * 0.17], s: [w + 0.46, 0.44, 0.34], mat: m.iron, bevel: 0.02, cast: true }); B.cyl({ p: [x, y + h + 0.24, z + dir * 0.17], r: 0.17, h: w, seg: 10, mat: m.iron, roll: P / 2, anchor: 'center', cast: false });
  B.box({ p: [x, y, z + dir * 0.075], s: [w, 0.14, 0.07], mat: m.iron, bevel: 0.01, cast: false }); if (m.yellow) B.box({ p: [x, y + 0.02, z + dir * 0.115], s: [w - 0.1, 0.06, 0.01], mat: m.yellow, bevel: 0, cast: false });
  B.box({ p: [x + w * 0.3, y + 1.1, z + dir * 0.09], s: [0.14, 0.18, 0.05], mat: m.iron, bevel: 0.01, cast: false });
}

/** modelled tower block: podium, shaft, set-back, crown; rooftop plant (units, tank on legs, mast). mat = emissive window material, plant = dark metal material */
export function modelTower(B, mat, plant, x, z, w, d, h, r) {
  B.box({ p: [x, 0, z], s: [w + 1.4, h * 0.24, d + 1.4], mat, bevel: 0.04, col: false, cast: false });
  B.box({ p: [x, h * 0.24, z], s: [w, h * 0.58, d], mat, bevel: 0.04, col: false, cast: false });
  B.box({ p: [x, h * 0.82, z], s: [w * 0.8, h * 0.12, d * 0.8], mat, bevel: 0.03, col: false, cast: false });
  const top = h * 0.94; B.box({ p: [x, top, z], s: [w * 0.6, h * 0.05, d * 0.6], mat, bevel: 0.03, col: false, cast: false }); const ty = top + h * 0.05;
  B.box({ p: [x, ty, z], s: [w * 0.62, 0.35, d * 0.62], mat: plant, bevel: 0.02, col: false, cast: false });                                                          // roof slab
  for (let i = 0; i < 3; i++) B.box({ p: [x + (r() - 0.5) * w * 0.32, ty + 0.35, z + (r() - 0.5) * d * 0.32], s: [1.2 + r() * 1.6, 0.9 + r() * 1.1, 1.2 + r() * 1.4], mat: plant, bevel: 0.02, col: false, cast: false });
  if (r() < 0.6) { const tx = x + (r() - 0.5) * w * 0.3, tz = z + (r() - 0.5) * d * 0.3; for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box({ p: [tx + sx * 0.7, ty + 0.35, tz + sz * 0.7], s: [0.1, 1.8, 0.1], mat: plant, bevel: 0, col: false, cast: false }); B.cyl({ p: [tx, ty + 2.1, tz], r: 1.1, h: 2.0, seg: 10, mat: plant, col: false, cast: false }); B.cyl({ p: [tx, ty + 4.1, tz], r: [1.1, 0.1], h: 0.5, seg: 10, mat: plant, col: false, cast: false }); }
  const mh = 6 + r() * 12; B.cyl({ p: [x + (r() - 0.5) * w * 0.2, ty + 0.35, z + (r() - 0.5) * d * 0.2], r: 0.12, h: mh, seg: 5, mat: plant, col: false, cast: false });
  return { mastTop: ty + 0.35 + mh };
}

/** truck detail (local frame F(u,w,v): u forward, w up, v right; alongX axis flag). Lug nuts, tread lugs, mud flaps, wipers, door handles, louvres, van ribs, flatbed boards, tail bar. */
export function truckDetail(K, m, F, alongX, kind, y) {
  const B = K.B; const bx = (u0, u1, w0, w1, v0, v1, mat, bev = 0.004) => { const a = F((u0 + u1) / 2, w0, (v0 + v1) / 2); B.box({ p: a, s: alongX ? [Math.abs(u1 - u0), w1 - w0, Math.abs(v1 - v0)] : [Math.abs(v1 - v0), w1 - w0, Math.abs(u1 - u0)], mat, bevel: bev, col: false, cast: true }); };
  for (const [u, v] of [[-1.95, -0.98], [-1.95, 0.98], [1.75, -0.98], [1.75, 0.98]]) { const sd = Math.sign(v);
    for (let k = 0; k < 8; k++) { const a = k / 8 * P * 2; bx(u + Math.cos(a) * 0.15 - 0.02, u + Math.cos(a) * 0.15 + 0.02, 0.5 + Math.sin(a) * 0.15 - 0.02, 0.5 + Math.sin(a) * 0.15 + 0.02, v + sd * 0.13, v + sd * 0.155, m.chrome, 0); }
    for (let k = 0; k < 22; k++) { const a = k / 22 * P * 2, c = F(u + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, v); B.box({ p: c, s: alongX ? [0.09, 0.05, 0.27] : [0.27, 0.05, 0.09], mat: m.tyre, yaw: 0, pitch: alongX ? 0 : a, roll: alongX ? a : 0, bevel: 0, col: false, cast: false }); }
    bx(u - 0.62, u - 0.5, 0.05, 0.62, v - 0.16, v + 0.16, m.black, 0.004); }                                                                                       // mud flaps
  for (const v of [-0.55, 0.3]) B.beam(F(1.66, 1.6, v), F(1.66, 1.98, v + 0.35), 0.014, 0.014, { mat: m.black, bevel: 0, cast: false });                                 // wipers
  for (const v of [-1, 1]) { bx(0.7, 0.88, 1.7, 1.74, v * 0.99 - 0.03, v * 0.99 + 0.03, m.chrome, 0.004); bx(1.5, 1.56, 1.6, 1.72, v * 0.99 - 0.04, v * 0.99 + 0.04, m.chrome, 0.004);        // door handle + hinge
    for (let i = 0; i < 5; i++) bx(1.55 + i * 0.17, 1.6 + i * 0.17, 0.98, 1.24, v * 0.635 - 0.01, v * 0.635 + 0.01, m.black, 0); }                                              // hood louvres
  bx(2.79, 2.83, 0.48, 0.58, -0.22, 0.22, m.paint2, 0.004); bx(-3.09, -3.06, 0.56, 0.68, -0.22, 0.22, m.paint2, 0.004);                                                   // number plates
  if (kind === 'van') { for (const v of [-1, 1]) for (let i = 0; i < 14; i++) bx(-2.9 + i * 0.18, -2.9 + i * 0.18 + 0.035, 0.84, 2.52, v * 1.06 - 0.012, v * 1.06 + 0.012, m.paint2, 0);
    for (const v of [-1, 1]) bx(-3.07, 0.2, 2.56, 2.62, v * 1.1 - 0.03, v * 1.1 + 0.03, m.black, 0.004); for (const v of [-0.3, 0.3]) { bx(-3.09, -3.05, 1.3, 1.9, v - 0.02, v + 0.02, m.chrome, 0.004); bx(-3.09, -3.05, 1.55, 1.65, v - 0.09, v + 0.09, m.black, 0.004); } }
  else { for (let i = 0; i < 12; i++) bx(-3.0 + i * 0.247, -3.0 + i * 0.247 + 0.236, 0.9, 0.935, -1.05, 1.05, m.wood, 0.004);                                        // flatbed boards
    for (const v of [-1, 1]) for (let i = 0; i < 6; i++) bx(-2.95 + i * 0.6, -2.95 + i * 0.6 + 0.07, 0.78, 0.9, v * 1.05 - 0.05, v * 1.05 + 0.05, m.black, 0.004); }
  bx(-3.0, -2.94, 0.5, 0.62, -1.0, 1.0, m.black, 0.004);                                                                                                                 // tail bar
}

/** rail wagon running gear: leaf springs, axle boxes, buffers on springs, brake rigging, end ladders. cx,z centre, wy = deck reference height (top of bogie), len 9.4 */
export function wagonDetail(B, mat, steel, cx, z, wy) {
  for (const dx of [-2.85, 2.85]) for (const sd of [-1, 1]) { B.box({ p: [cx + dx, wy - 0.55, z + sd * 0.72], s: [1.6, 0.06, 0.09], mat, bevel: 0.006, col: false, cast: true }); B.box({ p: [cx + dx, wy - 0.49, z + sd * 0.72], s: [1.3, 0.05, 0.08], mat, bevel: 0.006, col: false, cast: false }); B.box({ p: [cx + dx, wy - 0.44, z + sd * 0.72], s: [0.9, 0.05, 0.07], mat, bevel: 0.006, col: false, cast: false });
    for (const ax of [-0.85, 0.85]) B.box({ p: [cx + dx + ax * 0.5, wy - 0.42, z + sd * 0.8], s: [0.24, 0.3, 0.16], mat: steel, bevel: 0.012, col: false, cast: true }); }                    // springs + axle boxes
  for (const sx of [-1, 1]) for (const sd of [-1, 1]) { B.cyl({ p: [cx + sx * 4.93, wy - 0.2, z + sd * 0.8], r: 0.04, h: 0.5, seg: 6, mat: steel, roll: P / 2, anchor: 'center', cast: false }); B.cyl({ p: [cx + sx * 5.2, wy - 0.2, z + sd * 0.8], r: 0.13, h: 0.03, seg: 10, mat: steel, roll: P / 2, anchor: 'center', cast: false }); }   // buffers
  for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) B.beam([cx - 3.6 + i * 2.4, wy - 0.3, z + sd * 0.95], [cx - 2.6 + i * 2.4, wy - 0.42, z + sd * 0.95], 0.03, 0.03, { mat: steel, bevel: 0, cast: false });   // brake pull rods
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) B.box({ p: [cx + sx * 4.75, wy + 0.1 + k * 0.28, z - 0.9], s: [0.04, 0.03, 0.34], mat: steel, bevel: 0, col: false, cast: false });                      // ladder rungs
}

/** chain hanging between two points: alternating flat / edge-on links (instanced). a,b = [x,y,z] */
export function chainLinks(B, mat, a, b, o = {}) {
  const geo = chainLinks._g || (chainLinks._g = new THREE.TorusGeometry(0.028, 0.0065, 5, 8)); const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.05)); const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1.5, 1);
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(), up = new THREE.Vector3(0, 1, 0), base = new THREE.Quaternion().setFromUnitVectors(up, dir);
  for (let i = 0; i <= n; i++) { const t = i / n, sag = (o.sag ?? 0.06) * 4 * t * (1 - t); v.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag, a[2] + (b[2] - a[2]) * t); q.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(up, i % 2 ? P / 2 : 0)); B.instance('chainLink', geo, mat, new THREE.Matrix4().compose(v, q, s), 0xffffff, { cast: false }); }
}

/** three-strand twisted rope along a polyline (world coords): helical strands around the Catmull-Rom centre line. r = overall radius */
export function rope3(B, pts, r, mat, o = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), N = o.n ?? Math.max(24, Math.round(curve.getLength() / 0.06)), fr = curve.computeFrenetFrames(N, false), twist = o.twist ?? 5.5;
  for (let s = 0; s < 3; s++) { const sp = []; for (let i = 0; i <= N; i++) { const c = curve.getPointAt(i / N), a = i / N * curve.getLength() * twist + s * P * 2 / 3, nn = fr.normals[i], bb = fr.binormals[i]; sp.push([c.x + (nn.x * Math.cos(a) + bb.x * Math.sin(a)) * r * 0.55, c.y + (nn.y * Math.cos(a) + bb.y * Math.sin(a)) * r * 0.55, c.z + (nn.z * Math.cos(a) + bb.z * Math.sin(a)) * r * 0.55]); }
    B.tube({ pts: sp, r: r * 0.5, mat, seg: 5, segs: N, cast: false }); }
}

/** arbitrary-direction lattice boom between points a,b: 4 chords + zig-zag diagonals (w = cross-section width) */
export function latticeBoom(B, a, b, w, mat, o = {}) {
  const A = new THREE.Vector3(...a), E = new THREE.Vector3(...b), ax = E.clone().sub(A), L = ax.length(); ax.normalize();
  const ref = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), u = new THREE.Vector3().crossVectors(ax, ref).normalize(), v = new THREE.Vector3().crossVectors(ax, u).normalize();
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => u.clone().multiplyScalar(i * w / 2).add(v.clone().multiplyScalar(j * w / 2))), ch = (o.chord ?? 0.06) * 2;
  for (const c of cs) B.beam([A.x + c.x, A.y + c.y, A.z + c.z], [E.x + c.x, E.y + c.y, E.z + c.z], ch, ch, { mat, bevel: 0, cast: true });
  const n = Math.max(2, Math.round(L / (o.bay ?? 0.9))); const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n; for (let s = 0; s < 4; s++) { const c0 = cs[s], c1 = cs[(s + 1) % 4], up = (i + s) % 2 === 0; p0.copy(A).lerp(E, up ? t0 : t1).add(c0); p1.copy(A).lerp(E, up ? t1 : t0).add(c1); B.beam([p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], o.diag ?? 0.035, o.diag ?? 0.035, { mat, bevel: 0, cast: false }); } }
}

/** one indexed geometry from axis-aligned boxes [cx,cy,cz,sx,sy,sz] (for animated groups that cannot use the static batch) */
export function boxesGeo(list) {
  const p = [], n = [], u = [], ix = []; const F = [[[1, 0, 0], [0, 0, 1], [0, 1, 0]], [[-1, 0, 0], [0, 0, -1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, -1]], [[0, 0, 1], [-1, 0, 0], [0, 1, 0]], [[0, 0, -1], [1, 0, 0], [0, 1, 0]]];
  for (const [cx, cy, cz, sx, sy, sz] of list) for (const [nn, uu, vv] of F) { const k = p.length / 3, h = [sx / 2, sy / 2, sz / 2]; for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.push(cx + (nn[0] + uu[0] * a + vv[0] * b) * h[0], cy + (nn[1] + uu[1] * a + vv[1] * b) * h[1], cz + (nn[2] + uu[2] * a + vv[2] * b) * h[2]), n.push(...nn), u.push((a + 1) / 2, (b + 1) / 2); ix.push(k, k + 1, k + 2, k, k + 2, k + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); g.setIndex(ix); return g;
}

/** fractured rock ledge: 3-6 stacked, offset, tilted slabs (strata) with a chipped fall-away block; x,y,z = base centre */
export function rockLedge(B, mat, x, y, z, w, d, seed = 1) {
  const r = (i) => { const v = Math.sin(seed * 91.7 + i * 12.9898) * 43758.5453; return v - Math.floor(v); }; const n = 3 + Math.floor(r(0) * 4); let cy = y;
  for (let i = 0; i < n; i++) { const th = 0.28 + r(i + 1) * 0.34, sw = w * (1 - i * 0.13) * (0.8 + r(i + 5) * 0.35), sd = d * (1 - i * 0.1) * (0.8 + r(i + 9) * 0.3); B.box({ p: [x + (r(i + 13) - 0.5) * w * 0.25, cy, z + (r(i + 17) - 0.5) * d * 0.25], s: [sw, th, sd], yaw: (r(i + 21) - 0.5) * 0.9, pitch: (r(i + 25) - 0.5) * 0.12, roll: (r(i + 29) - 0.5) * 0.12, mat, bevel: 0.06, col: false, cast: true }); cy += th * 0.86; }
  for (let k = 0; k < 3; k++) B.box({ p: [x + (r(k + 40) - 0.5) * w * 1.3, y, z + (r(k + 44) - 0.5) * d * 1.3], s: [0.3 + r(k + 48) * 0.5, 0.25 + r(k + 52) * 0.35, 0.3 + r(k + 56) * 0.5], yaw: r(k + 60) * 3, pitch: (r(k + 64) - 0.5) * 0.5, roll: (r(k + 68) - 0.5) * 0.5, mat, bevel: 0.05, col: false, cast: true });
}
