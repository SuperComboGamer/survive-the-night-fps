// Real-construction parts for Shaft Nine, built as geometry (rawgeo.js) and merged into the stop's static batches with the stop's EXISTING materials (no new draws / programs).
// Reference dimensions (all metres): mine rail 20 lb/yd = head 32 x 15, web 8, foot 66 x 12 mm, 0.61 m gauge, fishplate 360 x 70 x 10 mm with 4 bolts, sleepers 1.0 x 0.075 x 0.10 every ~0.72 m;
// timber sets: posts / caps 250-300 mm hewn, lagging 45 x 200-250 mm; ore tub 1.35 x 0.72 x 0.72 (2 mm sheet, 40 mm rim angle, 6 mm rivets, 0.30 m cast wheels); corrugated iron pitch 76 mm, depth
// 19 mm, sheets 762 mm wide with one-wave laps; brick 215 x 102 x 65 mm + 10 mm mortar; steel sections: I 300 x 150 x 20 / 12, angle 100 x 10, channel 200 x 75; wire rope lay length ~ 6 x diameter.
import * as THREE from 'three';
import { Geo, profI, profL, profC, profFlat, profTimber, profRail, profRope, profCircle } from './rawgeo.js';
const PI = Math.PI, TAU = PI * 2, IDENT = new THREE.Matrix4(); const E_ = new THREE.Euler(), Q_ = new THREE.Quaternion();

/** column-major matrix elements (Matrix4.compose with Euler YXZ, like Builder.matrix): position p, yaw, pitch, roll, uniform/array scale */
export function T(p, yaw = 0, pitch = 0, roll = 0, s = 1) { E_.set(pitch, yaw, roll, 'YXZ'); Q_.setFromEuler(E_); const sc = Array.isArray(s) ? s : [s, s, s]; return new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), Q_.clone(), new THREE.Vector3(sc[0], sc[1], sc[2])).elements.slice(); }
/** kit convention: local (lx, ly, lz) about p rotated by yaw -> world */
export const at = (p, lx, ly, lz, yaw = 0) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [p[0] + lx * c + lz * s, p[1] + ly, p[2] - lx * s + lz * c]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** per-material geometry accumulators; parts append faces, flush() hands each one to Builder.addRaw (one draw per material per chunk) */
export class Parts {
  constructor(B, rnd) { this.B = B; this.rnd = rnd; this.g = new Map(); this.gn = new Map(); }
  /** accumulator for a material (casts shadows unless cast=false) */
  of(mat, cast = true) { const m = cast ? this.g : this.gn; let g = m.get(mat); if (!g) { g = new Geo(); m.set(mat, g); } return g; }
  uv(g) { g.offset(this.rnd() * 11, this.rnd() * 11); return g; }
  shadowQuad(pts) { const b = this.B.batch; if (b && b.proxyQuad) b.proxyQuad(pts); }
  flush() { for (const [m, g] of this.g) if (g.tris) this.B.addRaw(g.raw(), IDENT, m, { cast: true, noShadow: true }); for (const [m, g] of this.gn) if (g.tris) this.B.addRaw(g.raw(), IDENT, m, { cast: false, noShadow: true }); this.g.clear(); this.gn.clear(); }
  get tris() { let n = 0; for (const g of this.g.values()) n += g.tris; for (const g of this.gn.values()) n += g.tris; return n; }
}

// ================================================================== fasteners
/** rivet / bolt heads along a line (domes facing n) */
export function rivets(P, mat, a, b, n, count, r = 0.006) { const g = P.of(mat, false); for (let k = 0; k < count; k++) { const t = count > 1 ? k / (count - 1) : 0.5, p = lerp3(a, b, t); g.dome(p[0], p[1], p[2], n[0], n[1], n[2], r * (0.9 + P.rnd() * 0.25), 5); } }
const BOLT = (() => { const g = new Geo(); g.lathe([[0.034, 0], [0.034, 0.005], [0.014, 0.005], [0.014, 0.011], [0.013, 0.013], [0.0, 0.013]], 8, 0, 0, 0, {}); return g; })();
/** lag bolt with square washer plate at p, axis along unit n (head outward) */
export function bolt(P, mat, p, n, s = 1) { const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]; const x = norm(cross(up, n)), z = cross(n, x); const m = [x[0] * s, x[1] * s, x[2] * s, 0, n[0] * s, n[1] * s, n[2] * s, 0, z[0] * s, z[1] * s, z[2] * s, 0, p[0], p[1], p[2], 1]; P.of(mat, false).append(BOLT, m); }
/** flat plate (gusset, tie plate, washer plate): polygon pts in 3-D (CCW seen from +n) extruded t along n; edges get real thickness */
export function slab(P, mat, pts, n, t = 0.012, cast = false) { const g = P.of(mat, cast), h = t / 2, up = pts.map((q) => [q[0] + n[0] * h, q[1] + n[1] * h, q[2] + n[2] * h]), dn = pts.map((q) => [q[0] - n[0] * h, q[1] - n[1] * h, q[2] - n[2] * h]); g.poly(up); g.poly(dn.slice().reverse()); for (let k = 0; k < pts.length; k++) { const k2 = (k + 1) % pts.length; g.poly([dn[k], dn[k2], up[k2], up[k]]); } }

// ================================================================== steel sections
/** sweep any section along a -> b (web plane vertical unless up given). o: {up, sag, twist, step, cast} */
export function member(P, mat, a, b, prof, o = {}) {
  const g = P.uv(P.of(mat, o.cast !== false)), d = sub(b, a), L = len(d); if (L < 1e-4) return; let up = o.up; if (!up) up = Math.abs(d[1]) / L > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const n = Math.max(1, Math.round(L / (o.step || 4))), path = []; for (let k = 0; k <= n; k++) { const t = k / n, sag = o.sag ? Math.sin(t * PI) * o.sag : 0; path.push([a[0] + d[0] * t, a[1] + d[1] * t - sag, a[2] + d[2] * t]); }
  g.sweep(prof, path, { up, twist: o.twist, scale: o.scale });
}
export const iBeam = (P, mat, a, b, h = 0.3, w = 0.15, tf = 0.02, tw = 0.012, o = {}) => member(P, mat, a, b, profI(h, w, tf, tw), o);
export const angle = (P, mat, a, b, s = 0.1, t = 0.01, o = {}) => member(P, mat, a, b, profL(s, t).map((q) => [q[0] - s / 2, q[1] - s / 2]), o);
export const channel = (P, mat, a, b, h = 0.2, w = 0.075, t = 0.009, o = {}) => member(P, mat, a, b, profC(h, w, t), o);
export const flat = (P, mat, a, b, w = 0.08, t = 0.01, o = {}) => member(P, mat, a, b, profFlat(w, t), o);
/** gusset plate with rivets at the joint c, plane spanned by unit vectors u, v; size s */
export function gusset(P, mat, matBolt, c, u, v, s = 0.5, t = 0.012) {
  const R = P.rnd, n = cross(u, v), q = (a, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b]; const k = s * (0.85 + R() * 0.3);
  const pts = [q(-k * 0.5, -k * 0.5), q(k * 0.5, -k * 0.5), q(k * 0.62, k * 0.05), q(k * 0.1, k * 0.55), q(-k * 0.5, k * 0.5)]; slab(P, mat, pts, n, t, false);
  for (const p of pts) { const p2 = lerp3(p, c, 0.22); P.of(matBolt, false).dome(p2[0] + n[0] * t / 2, p2[1] + n[1] * t / 2, p2[2] + n[2] * t / 2, n[0], n[1], n[2], 0.011, 6); P.of(matBolt, false).dome(p2[0] - n[0] * t / 2, p2[1] - n[1] * t / 2, p2[2] - n[2] * t / 2, -n[0], -n[1], -n[2], 0.011, 6); }
}
/** wire rope along a polyline: twisted lobed profile so the strands are visible; lay = length of one full twist */
export function wireRope(P, mat, pts, r = 0.016, lay = 0.11) {
  const path = []; for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1], L = len(sub(b, a)), n = Math.max(2, Math.ceil(L / (lay / 5))); for (let i = 0; i < n; i++) path.push(lerp3(a, b, i / n)); } path.push(pts[pts.length - 1]);
  let total = 0; for (let k = 1; k < path.length; k++) total += len(sub(path[k], path[k - 1])); P.uv(P.of(mat, false)).sweep(profRope(r, 6, 2), path, { smooth: true, twist: (t) => t * total / lay * TAU, uvw: 4 });
}

// ================================================================== timber
/** hand-hewn timber a -> b (w x h section): jittered chamfered section, bow, taper, twist; nailed marks are separate (bolt/nail) */
export function hewn(P, mat, a, b, w, h, o = {}) {
  const R = P.rnd, g = P.uv(P.of(mat, o.cast !== false)), d = sub(b, a), L = len(d); if (L < 0.02) return; const dir = norm(d);
  let up = o.up; if (!up) up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]; const side = norm(cross(dir, up)), bow = (o.bow ?? 0.008 * L) * (R() < 0.5 ? -1 : 1), bd = R() < 0.5 ? side : up, n = Math.max(2, Math.ceil(L / 0.6));
  const path = []; for (let k = 0; k <= n; k++) { const t = k / n, s = Math.sin(t * PI) * bow; path.push([a[0] + d[0] * t + bd[0] * s, a[1] + d[1] * t + bd[1] * s, a[2] + d[2] * t + bd[2] * s]); }
  const c = o.chamfer ?? 0.16 * Math.min(w, h), tap = o.taper ?? 0.04, tw = (o.twist ?? 0.05) * (R() - 0.5) * 2; g.sweep(profTimber(w, h, c, R, 0.014 * Math.min(w, h)), path, { up, scale: (i, t) => 1 - tap * t, twist: (t) => tw * t, off: (i, t) => [Math.sin(t * 6 + w) * 0.003, Math.cos(t * 5 + h) * 0.003] });
}
/** real timber set across a drift (kit convention: local x across, z along; p = centre on the floor): hewn posts on sill blocks, cap beam with wedges, optional diagonal brace, lag bolts with washer plates */
export function timberSet(P, M, { p, yaw = 0, w = 2.9, h = 2.6, t = 0.28, lean = 0.06, brace = false, seed = 1, col = true }) {
  const R = P.rnd, hw = w / 2, pt = (lx, ly, lz = 0) => at(p, lx, ly, lz, yaw), tt = (v) => t * (1 + (R() - 0.5) * v);
  for (const s of [-1, 1]) {
    const bx = s * (hw + t / 2), tx = s * (hw - lean + t / 2); hewn(P, M.post, pt(bx, 0.08), pt(tx, h + 0.02), tt(0.15), tt(0.15), { bow: 0.012 + R() * 0.012, up: [Math.cos(yaw), 0, -Math.sin(yaw)] });
    hewn(P, M.post, pt(bx, 0.045, -0.22), pt(bx, 0.045, 0.22), t + 0.14, 0.09, { bow: 0.004, taper: 0, twist: 0.02, up: [0, 1, 0] });                     // sill block under the post
    if (col) P.B.colliders.addBox({ x: pt(bx, 0)[0], y: h / 2, z: pt(bx, 0)[2], hx: t / 2, hy: h / 2, hz: t / 2, yaw, surface: 'wood', walk: false });
    const wa = pt(s * (hw - lean + t * 0.9), h - 0.42), wb = pt(s * (hw - lean + t * 0.5), h + 0.03); hewn(P, M.board, wa, wb, 0.1, 0.13, { taper: 0.5, bow: 0.002, chamfer: 0.01 });          // wedge between post and cap
    const nx = norm(sub(pt(s, 0, 0), pt(0, 0, 0))); for (const k of [0, 1]) bolt(P, M.iron, pt(tx + s * t / 2 + s * 0.004, h - 0.2 - k * 0.16, 0), nx, 0.9);
  }
  const capL = w + 2 * t + 0.4 + R() * 0.3; hewn(P, M.post, pt(-capL / 2, h + t / 2 - 0.02), pt(capL / 2, h + t / 2 - 0.02), tt(0.1), tt(0.12), { bow: 0.01 + R() * 0.02, up: [0, 1, 0], twist: 0.03 });      // cap beam (sags slightly)
  if (brace) for (const s of [R() < 0.5 ? -1 : 1]) hewn(P, M.post, pt(s * (hw + t * 0.4), h * 0.28), pt(s * (hw * 0.15), h + t * 0.1), 0.16, 0.14, { bow: 0.01 });
  { const nz = norm(sub(pt(0, 0, 1), pt(0, 0, 0))); for (const s of [-1, 1]) bolt(P, M.iron, pt(s * (hw - lean * 0.5 + t * 0.2), h + t / 2 - 0.02, t / 2 + 0.005), nz, 1.1); }
}
/** lagging boards behind the sets (walls both sides and roof); each board is a bent, sawn plank with its own width, gap and slope */
export function lagging(P, M, { p, yaw = 0, len: L = 2.4, w = 3, h = 2.6, gap = 0.18, seed = 1, sides = true, roof = true, t = 0.045 }) {
  const R = P.rnd, hw = w / 2 + 0.02; const plank = (a, b, wd, th, up) => { const g = P.uv(P.of(M.board, false)); const bow = (R() - 0.5) * 0.02, d = sub(b, a), n = norm(d); const mid = add(lerp3(a, b, 0.5), mul(up, bow)); g.sweep([[-wd / 2, -th / 2], [wd / 2, -th / 2 + (R() - 0.5) * 0.004], [wd / 2, th / 2], [-wd / 2, th / 2 + (R() - 0.5) * 0.004]], [a, mid, b], { up }); };
  if (sides) for (const s of [-1, 1]) for (let y = 0.05; y < h - 0.1; y += 0.26 + (R() - 0.5) * 0.03) { if (R() < gap) continue; const wd = 0.2 + R() * 0.06, l = L * (0.82 + R() * 0.18), z0 = (R() - 0.5) * (L - l); const x = s * (hw + t + 0.26 + (R() - 0.5) * 0.02); plank(at(p, x, y, z0 - l / 2, yaw), at(p, x, y + (R() - 0.5) * 0.02, z0 + l / 2, yaw), wd, t, [Math.cos(yaw), 0, -Math.sin(yaw)]); }
  if (roof) for (let lx = -hw - 0.3; lx < hw + 0.3; lx += 0.27) { if (R() < gap * 0.6) continue; const wd = 0.22 + R() * 0.04, l = L * (0.85 + R() * 0.15), yy = h + t + 0.34 + (R() - 0.5) * 0.02; plank(at(p, lx, yy, -l / 2, yaw), at(p, lx + (R() - 0.5) * 0.02, yy, l / 2, yaw), wd, t, [0, 1, 0]); }
}

// ================================================================== track
/** light rail track a -> b: T rails in 9.14 m lengths (2 cm gaps), bolted fishplates, spiked hewn sleepers (cracked / sunk / skewed / missing ones), gravel chips */
export function railLine(P, M, a, b, { gauge = 0.61, y = 0, every = 0.72, ballast = true, chips = 12 } = {}) {
  const R = P.rnd, d = sub(b, a), L = Math.hypot(d[0], d[2]); if (L < 0.5) return; const u = [d[0] / L, 0, d[2] / L], n = [-u[2], 0, u[0]], rc = gauge / 2 + 0.016;
  const pos = (s, o = 0, h = 0) => [a[0] + u[0] * s + n[0] * o, y + h, a[2] + u[2] * s + n[2] * o];
  for (let s = 0.2; s < L - 0.3; s += every * (0.92 + R() * 0.16)) {
    if (R() < 0.03) continue; const ln = 1.0 + (R() - 0.5) * 0.08, sink = (R() - 0.5) * 0.02, cr = R() < 0.09, sk = (R() - 0.5) * 0.06;
    const cx = pos(s, 0, 0.037 + sink), tz = (o) => [cx[0] + n[0] * o + u[0] * sk * o, cx[1], cx[2] + n[2] * o + u[2] * sk * o];
    for (const [o0, o1] of (cr ? [[-ln / 2, -0.005], [0.005, ln / 2]] : [[-ln / 2, ln / 2]])) hewn(P, M.sleeper, tz(o0), tz(o1), 0.1 + (R() - 0.5) * 0.012, 0.075 + (R() - 0.5) * 0.01, { bow: 0.004, chamfer: 0.01, taper: 0.01, up: [0, 1, 0], cast: false });
    for (const sd of [-1, 1]) for (const io of [-1, 1]) { const q = pos(s + (R() - 0.5) * 0.01, sd * rc + io * 0.036, 0.075 + sink + 0.012); P.of(M.iron, false).dome(q[0], q[1], q[2], 0, 1, 0, 0.012, 5); }
  }
  for (const sd of [-1, 1]) {
    let s = 0, k = 0; while (s < L - 0.05) {
      const seg = Math.min(9.14 - (k === 0 ? R() * 3 : 0), L - s); member(P, M.rail, pos(s, sd * rc, 0.075), pos(s + seg - 0.02, sd * rc, 0.075), profRail(), { up: [0, 1, 0], step: 3, cast: false });
      if (s + seg < L - 0.2) for (const f of [-1, 1]) { const c = pos(s + seg - 0.01, sd * rc + f * 0.0095, 0.075 + 0.036); member(P, M.iron, [c[0] - u[0] * 0.18, c[1], c[2] - u[2] * 0.18], [c[0] + u[0] * 0.18, c[1], c[2] + u[2] * 0.18], profFlat(0.006, 0.062), { up: [0, 1, 0], cast: false }); for (let q = 0; q < 4; q++) { const bp = [c[0] + u[0] * (-0.135 + q * 0.09) + n[0] * f * 0.0035, c[1], c[2] + u[2] * (-0.135 + q * 0.09) + n[2] * f * 0.0035]; P.of(M.iron, false).dome(bp[0], bp[1], bp[2], n[0] * f, 0, n[2] * f, 0.011, 5); } }
      s += seg; k++;
    }
  }
  if (ballast && M.ballast) { const g = P.of(M.ballast, false), cnt = Math.floor(L * chips); for (let k = 0; k < cnt; k++) { const s = R() * L, o = (R() - 0.5) * 1.55; if (Math.abs(o) < 0.5 && R() < 0.5) continue; const q = pos(s, o, 0.03 + R() * 0.02); g.rock(q[0], q[1], q[2], 0.018 + R() * R() * 0.05, R, { cuts: 2, low: true }); } }
}

// ================================================================== rolling stock
/** ore tub / mine car: tapered 2 mm sheet body with dents, riveted rim angle, ribs, four cast wheels on journal boxes, coupler; load: 'coal' | 'ore' | null */
export function oreCart(P, M, { p, yaw = 0, load = null, seed = 1, tilt = 0 }) {
  const R = P.rnd, L = 1.35, W = 0.72, H = 0.66, y0 = 0.27, bt = 0.11, pt = (lx, ly, lz) => at(p, lx, ly, lz, yaw); const g = P.uv(P.of(M.tub, true)), gi = P.of(M.tub, false);
  const wallTop = [L / 2, W / 2], wallBot = [L / 2 - 0.1, W / 2 - 0.09];
  const cor = (sx, sz, top) => { const [hx, hz] = top ? wallTop : wallBot; return pt(sx * hx, y0 + (top ? H : 0), sz * hz); };
  const dented = (A, B2, C, D, nx, ny, amp) => { const P2 = []; for (let j = 0; j <= ny; j++) { const row = []; for (let i = 0; i <= nx; i++) { const u = i / nx, v = j / ny, top = lerp3(D, C, u), bot = lerp3(A, B2, u), q = lerp3(bot, top, v); const e = (i > 0 && i < nx && j > 0 && j < ny) ? (R() - 0.5) * amp : 0; const nn = norm(cross(sub(B2, A), sub(D, A))); row.push([q[0] + nn[0] * e, q[1] + nn[1] * e, q[2] + nn[2] * e]); } P2.push(row); } for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g.poly([P2[j][i], P2[j][i + 1], P2[j + 1][i + 1], P2[j + 1][i]]); };
  dented(cor(-1, -1, 0), cor(1, -1, 0), cor(1, -1, 1), cor(-1, -1, 1), 4, 2, 0.012); dented(cor(1, 1, 0), cor(-1, 1, 0), cor(-1, 1, 1), cor(1, 1, 1), 4, 2, 0.012);                       // long sides (outer)
  dented(cor(1, -1, 0), cor(1, 1, 0), cor(1, 1, 1), cor(1, -1, 1), 2, 2, 0.01); dented(cor(-1, 1, 0), cor(-1, -1, 0), cor(-1, -1, 1), cor(-1, 1, 1), 2, 2, 0.01);                          // ends
  g.poly([cor(-1, -1, 0), cor(-1, 1, 0), cor(1, 1, 0), cor(1, -1, 0)].reverse());                                                                                                       // floor
  const rim = (sa, sb) => { const A = cor(sa[0], sa[1], 1), B2 = cor(sb[0], sb[1], 1); member(P, M.rim || M.tub, [A[0], A[1] - 0.005, A[2]], [B2[0], B2[1] - 0.005, B2[2]], profL(0.045, 0.006).map((q) => [q[0] - 0.02, q[1] - 0.02]), { up: [0, 1, 0], cast: false }); };
  rim([-1, -1], [1, -1]); rim([1, -1], [1, 1]); rim([1, 1], [-1, 1]); rim([-1, 1], [-1, -1]);
  for (const sz of [-1, 1]) for (let k = 0; k < 4; k++) { const lx = (-0.5 + k / 3) * L * 0.86; const a = pt(lx, y0 + 0.02, sz * (W / 2 - 0.045 + 0.05)), b = pt(lx, y0 + H - 0.03, sz * (W / 2 + 0.005)); member(P, M.rim || M.tub, a, b, profFlat(0.04, 0.008), { up: [Math.sin(yaw), 0, Math.cos(yaw)], cast: false }); }           // vertical stiffener ribs
  for (const sz of [-1, 1]) for (let k = 0; k < 15; k++) { const q = pt(-L / 2 + 0.07 + k * ((L - 0.14) / 14), y0 + H - 0.018, sz * (W / 2 + 0.006)); P.of(M.iron, false).dome(q[0], q[1], q[2], Math.sin(yaw) * sz, 0, Math.cos(yaw) * sz, 0.0055, 5); }
  for (const sx of [-1, 1]) for (let k = 0; k < 7; k++) { const q = pt(sx * (L / 2 + 0.006), y0 + H - 0.018, -W / 2 + 0.05 + k * ((W - 0.1) / 6)); P.of(M.iron, false).dome(q[0], q[1], q[2], Math.cos(yaw) * sx, 0, -Math.sin(yaw) * sx, 0.0055, 5); }
  const wheel = new Geo(); wheel.lathe([[0.03, -0.04], [0.06, -0.04], [0.06, -0.022], [0.13, -0.02], [0.14, -0.01], [0.14, 0.02], [0.158, 0.026], [0.158, 0.036], [0.14, 0.036], [0.06, 0.03], [0.06, 0.05], [0.03, 0.05]], 14, 0, 0, 0, {});
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const c = pt(sx * 0.42, 0.155, sz * 0.3); P.of(M.wheel || M.iron, true).append(wheel, T(c, yaw, PI / 2, 0, 1)); hewn(P, M.iron, pt(sx * 0.42, 0.2, sz * 0.22), pt(sx * 0.42, 0.2, sz * 0.36), 0.1, 0.12, { bow: 0, taper: 0, chamfer: 0.012, cast: false }); }
  for (const sx of [-1, 1]) member(P, M.iron, pt(sx * 0.42, 0.155, -0.38), pt(sx * 0.42, 0.155, 0.38), profCircle(0.022, 8), { smooth: true, up: [0, 1, 0], cast: false });
  for (const sx of [-1, 1]) { const A = pt(sx * (L / 2 + 0.02), y0 + 0.08, 0), B2 = pt(sx * (L / 2 + 0.3), y0 + 0.08 + (R() - 0.5) * 0.03, 0); member(P, M.iron, A, B2, profFlat(0.012, 0.04), { up: [0, 1, 0], cast: false }); const c = at(p, sx * (L / 2 + 0.3), y0 + 0.08, 0, yaw); P.of(M.iron, false).sweep(profCircle(0.008, 5), Array.from({ length: 13 }, (_, k) => at([c[0], c[1], c[2]], Math.cos(k / 12 * TAU) * 0.035 * 0, Math.sin(k / 12 * TAU) * 0.035, Math.cos(k / 12 * TAU) * 0.035 - 0.035, yaw + PI / 2)), { smooth: true, up: [0, 1, 0] }); }
  if (load) { const mat = load === 'coal' ? M.coal : M.ore || M.coal, gl = P.of(mat, false); const cnt = 34; for (let k = 0; k < cnt; k++) { const lx = (R() - 0.5) * (L - 0.1), lz = (R() - 0.5) * (W - 0.1); const mound = 0.22 * (1 - (2 * lx / L) ** 2) * (1 - (2 * lz / W) ** 2); const q = pt(lx, y0 + H * 0.78 + mound + R() * 0.05, lz); gl.rock(q[0], q[1], q[2], 0.05 + R() * 0.09, R, { cuts: 3 }); } }
}

// ================================================================== sheet metal
/** real corrugated iron: sine profile (pitch 76 mm, depth 19 mm), 762 mm sheets with one-wave laps, screws with washers on the crests, dents and a curled edge. o: {a: bottom-left corner, dir: unit horizontal dir along the width, up: unit extrusion dir (default +Y), out: unit outward normal, w, h, seed, lap} */
export function corrugated(P, mat, matBolt, { a, dir, up = [0, 1, 0], w, h, out = null, screws = true, pitch = 0.076, amp = 0.0095 }) {
  const R = P.rnd, nrm = out || norm(cross(dir, up)), g = P.uv(P.of(mat, false)), sw = 0.762, step = sw - pitch; let x0 = 0;
  { const c = (u, v) => [a[0] + dir[0] * u + up[0] * v, a[1] + dir[1] * u + up[1] * v, a[2] + dir[2] * u + up[2] * v]; P.shadowQuad([c(0, 0), c(w, 0), c(w, h), c(0, h)]); }
  while (x0 < w - 0.05) {
    const sheetW = Math.min(sw, w - x0), waves = Math.round(sheetW / pitch), seg = 6, curl = R() < 0.25, tilt = (R() - 0.5) * 0.012, lift = R() < 0.3 ? R() * 0.012 : 0; const cols = [];
    for (let i = 0; i <= waves * seg; i++) { const s = i / seg * pitch, off = amp * Math.sin(i / seg * TAU); cols.push([s, off]); }
    const rows = 3, pos = (s, off, v) => { const bend = (v === 0 && curl ? 0.012 : 0) + Math.sin(v * PI / 2) * lift + (v === 1 ? (R() - 0.5) * 0.004 : 0), vv = v * h * (0.5); return [a[0] + dir[0] * (x0 + s) + nrm[0] * (off + bend + tilt * v) + up[0] * (vv), a[1] + dir[1] * (x0 + s) + nrm[1] * (off + bend + tilt * v) + up[1] * vv, a[2] + dir[2] * (x0 + s) + nrm[2] * (off + bend + tilt * v) + up[2] * vv]; };
    for (let v = 0; v < 2; v++) for (let i = 0; i < cols.length - 1; i++) { const A = pos(cols[i][0], cols[i][1], v), B2 = pos(cols[i + 1][0], cols[i + 1][1], v), C = pos(cols[i + 1][0], cols[i + 1][1], v + 1), D = pos(cols[i][0], cols[i][1], v + 1); g.poly([A, B2, C, D]); const t = -0.0012; g.poly([add(A, mul(nrm, t)), add(D, mul(nrm, t)), add(C, mul(nrm, t)), add(B2, mul(nrm, t))]); }
    if (screws) for (const rowV of [0.07, 0.5, 0.93]) for (let wv = 1; wv < waves; wv += 2) { const s = (wv + 0.25) * pitch, v = rowV * 2, cp = pos(s, amp * Math.sin(0.25 * TAU) * 1, 0); const q = add(cp, mul(up, rowV * h)); P.of(matBolt, false).dome(q[0] + nrm[0] * amp * 1.0, q[1] + nrm[1] * amp * 1.0, q[2] + nrm[2] * amp * 1.0, nrm[0], nrm[1], nrm[2], 0.0075, 5); }
    x0 += step;
  }
}

// ================================================================== brick
/** brick facing on a wall plane: p = wall base centre, yaw, w x h, holes [{x0,x1,y0,y1}] (wall-local x from centre, y from base), face = +1 / -1 side. Bricks are real boxes (215 x 65 mm, 10 mm joints) standing 8-18 mm proud of the mortar plane with per-brick colour region, jitter, chips and spalls. */
export function brickWall(P, mat, { p, yaw = 0, w, h, holes = [], face = 1, t = 0, seed = 1, spall = 0.012, plinth = 0.5, cornice = true }) {
  const R = P.rnd, g = P.of(mat, false), bl = 0.215, bh = 0.065, jw = 0.01, px = bl + jw, py = bh + jw, x0 = -w / 2, c = Math.cos(yaw), s = Math.sin(yaw); const nrm = [s * face, 0, c * face], right = [c * face, 0, -s * face];
  const O = (lx, ly, d) => [p[0] + right[0] * lx * 1 + nrm[0] * (t / 2 + d), p[1] + ly, p[2] + right[1] * 0 + right[2] * lx + nrm[2] * (t / 2 + d)];
  const hs = face < 0 ? holes.map((q) => ({ x0: -q.x1, x1: -q.x0, y0: q.y0, y1: q.y1 })) : holes;
  const inHole = (x, y) => { for (const hh of hs) if (x + bl > hh.x0 - 0.02 && x < hh.x1 + 0.02 && y + bh > hh.y0 - 0.02 && y < hh.y1 + 0.02) return true; return false; };
  for (let row = 0, y = 0; y < h - bh * 0.5; row++, y += py) {
    const shift = (row & 1) ? px / 2 : 0, top = y + bh > h;
    for (let x = x0 - shift; x < x0 + w; x += px) { const bx = Math.max(x, x0), be = Math.min(x + bl, x0 + w); if (be - bx < 0.03) continue; if (inHole(bx, y)) continue; if (R() < spall) continue;
      const d = 0.009 + R() * 0.009 + (y < plinth ? 0.006 : 0), j = 0.0015, hy = Math.min(bh, h - y) * (1 + (R() - 0.5) * 0.06), xa = bx + (R() - 0.5) * j, xb = be + (R() - 0.5) * j, ya = y + (R() - 0.5) * j, yb = y + hy + (R() - 0.5) * j; g.offset(R() * 13, R() * 13);
      const c0 = O(xa, ya, 0), c1 = O(xb, ya, 0), c2 = O(xb, yb, 0), c3 = O(xa, yb, 0), f0 = O(xa + (R() - 0.5) * j, ya, d), f1 = O(xb, ya + (R() - 0.5) * j, d), f2 = O(xb, yb, d + (R() - 0.5) * 0.002), f3 = O(xa, yb, d);
      g.poly([f0, f1, f2, f3]); g.poly([f3, f2, c2, c3]); g.poly([c1, c2, f2, f1]); g.poly([c3, c0, f0, f3]); if (y < 0.6 || R() < 0.15) g.poly([c0, c1, f1, f0]);
    }
  }
  const stone = (lx0, lx1, y0, y1, d) => { const q = [O(lx0, y0, d), O(lx1, y0, d), O(lx1, y1, d), O(lx0, y1, d)], b = [O(lx0, y0, 0), O(lx1, y0, 0), O(lx1, y1, 0), O(lx0, y1, 0)]; g.offset(R() * 9, R() * 9); g.poly(q); g.poly([q[3], q[2], b[2], b[3]]); g.poly([b[0], b[1], q[1], q[0]]); g.poly([b[1], b[2], q[2], q[1]]); g.poly([b[3], b[0], q[0], q[3]]); };
  for (const hh of hs) { if (hh.y1 - hh.y0 < 1.0) continue; stone(hh.x0 - 0.12, hh.x1 + 0.12, hh.y1, hh.y1 + 0.16, 0.05); if (hh.y0 > 0.5) stone(hh.x0 - 0.08, hh.x1 + 0.08, hh.y0 - 0.07, hh.y0, 0.06); }
  if (cornice) { for (let x = x0; x < x0 + w - 0.1; x += 0.215) { if (R() < 0.5) stone(x + 0.01, x + 0.2, h - 0.13, h - 0.06, 0.04); } stone(x0, x0 + w, h - 0.06, h + 0.03, 0.07); }
  for (let y = 0, k = 0; y < h; y += 0.28, k++) { stone(x0, x0 + (k & 1 ? 0.5 : 0.36), y, y + 0.27, 0.02); stone(x0 + w - (k & 1 ? 0.36 : 0.5), x0 + w, y, y + 0.27, 0.02); }   // quoins
}

// ================================================================== drums, crates, spools, lamps
const DRUM = (() => { const g = new Geo(); g.lathe([[0.0, 0.0], [0.28, 0.0], [0.292, 0.012], [0.292, 0.09], [0.302, 0.10], [0.302, 0.108], [0.292, 0.118], [0.292, 0.38], [0.302, 0.39], [0.302, 0.398], [0.292, 0.408], [0.292, 0.70], [0.302, 0.71], [0.302, 0.718], [0.292, 0.728], [0.292, 0.83], [0.30, 0.845], [0.30, 0.86], [0.27, 0.865], [0.27, 0.87], [0.0, 0.87]], 18, 0, 0, 0, { jit: (r, y, a) => (r > 0.25 ? Math.sin(a * 3 + y * 6) * 0.002 : 0) }); return g; })();
/** 200 l steel drum: rolling hoops, chime rings, recessed lid with bungs, dents (per-instance radial jitter) */
export function drum(P, mat, matDark, p, { yaw = 0, tilt = 0, roll = 0, dent = 0.008, lidBungs = true } = {}) {
  const g = new Geo(); const R = P.rnd, ph = R() * 6, ph2 = R() * 6; g.lathe([[0.0, 0.0], [0.28, 0.0], [0.292, 0.012], [0.292, 0.09], [0.302, 0.10], [0.302, 0.108], [0.292, 0.118], [0.292, 0.38], [0.302, 0.39], [0.302, 0.398], [0.292, 0.408], [0.292, 0.70], [0.302, 0.71], [0.302, 0.718], [0.292, 0.728], [0.292, 0.83], [0.30, 0.845], [0.30, 0.86], [0.27, 0.865], [0.27, 0.87], [0.0, 0.87]], 20, 0, 0, 0, { jit: (r, y, a) => (r > 0.25 ? (Math.sin(a * 2 + ph) * Math.sin(y * 5 + ph2) * dent) : 0) });
  P.uv(P.of(mat, true)).append(g, T(p, yaw, tilt, roll, 1));
  if (lidBungs) { const b = new Geo(); b.lathe([[0, 0], [0.03, 0], [0.03, 0.012], [0.0, 0.014]], 8, 0, 0, 0, {}); for (const [x, z] of [[0.13, 0.05], [-0.1, -0.12]]) P.of(matDark, false).append(b, T(at(p, x, 0.868, z, yaw), yaw, 0, 0, 1)); }
}
/** slatted crate with corner battens, nail heads on every slat end, stencilled lid marks come from the material */
export function crate(P, mat, matIron, p, s = [0.6, 0.4, 0.4], yaw = 0) {
  const R = P.rnd, g = P.uv(P.of(mat, true)), [sx, sy, sz] = s; const th = 0.02, n = Math.max(2, Math.round(sy / 0.09)); const pt = (x, y, z) => at(p, x, y, z, yaw);
  for (const side of [-1, 1]) for (let k = 0; k < n; k++) { const y = 0.02 + (k + 0.5) * (sy - 0.04) / n, hh = (sy - 0.04) / n - 0.006; hewn(P, mat, pt(-sx / 2 + (R() - 0.5) * 0.004, y, side * (sz / 2 + th / 2)), pt(sx / 2, y, side * (sz / 2 + th / 2)), hh, th, { bow: 0.002, chamfer: 0.002, taper: 0, up: [0, 0, 1] }); }
  for (const side of [-1, 1]) for (let k = 0; k < n; k++) { const y = 0.02 + (k + 0.5) * (sy - 0.04) / n, hh = (sy - 0.04) / n - 0.006; hewn(P, mat, pt(side * (sx / 2 + th / 2), y, -sz / 2), pt(side * (sx / 2 + th / 2), y, sz / 2), hh, th, { bow: 0.002, chamfer: 0.002, taper: 0, up: [1, 0, 0] }); }
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) hewn(P, mat, pt(cx * (sx / 2 + th), 0, cz * (sz / 2 + th)), pt(cx * (sx / 2 + th), sy, cz * (sz / 2 + th)), 0.035, 0.035, { bow: 0, chamfer: 0.004, taper: 0, twist: 0 });
  for (let i = 0; i < 3; i++) hewn(P, mat, pt(-sx / 2, sy + th / 2, -sz / 2 + (i + 0.5) * sz / 3), pt(sx / 2, sy + th / 2, -sz / 2 + (i + 0.5) * sz / 3), sz / 3 - 0.008, th, { bow: 0.002, chamfer: 0.002, taper: 0, up: [0, 0, 1] });
  for (const side of [-1, 1]) for (let k = 0; k < n; k++) for (const e of [-1, 1]) { const q = pt(e * (sx / 2 - 0.035), 0.02 + (k + 0.5) * (sy - 0.04) / n, side * (sz / 2 + th + 0.001)); P.of(matIron, false).dome(q[0], q[1], q[2], Math.sin(yaw) * side, 0, Math.cos(yaw) * side, 0.005, 4); }
}
/** caged mining lamp: glass bulb, brass base, six cage wires, top ring, hook + cord */
export function lampCage(P, mat, matGlass, p, o = {}) {
  const g = P.of(mat, false); const b = new Geo(); b.lathe([[0.0, 0], [0.03, 0], [0.036, 0.012], [0.05, 0.05], [0.052, 0.075], [0.04, 0.105], [0.02, 0.122], [0.0, 0.125]], 10, 0, 0, 0, {}); P.of(matGlass, false).append(b, T([p[0], p[1] - 0.07, p[2]], 0, 0, 0, 1));
  const ring = (y, r) => { const path = []; for (let k = 0; k <= 12; k++) path.push([p[0] + Math.cos(k / 12 * TAU) * r, y, p[2] + Math.sin(k / 12 * TAU) * r]); member(P, mat, path[0], path[1], profCircle(0.0035, 4), {}); for (let k = 1; k < 12; k++) member(P, mat, path[k], path[k + 1], profCircle(0.0035, 4), { cast: false }); };
  ring(p[1] - 0.075, 0.062); ring(p[1] + 0.06, 0.055); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; member(P, mat, [p[0] + Math.cos(a) * 0.064, p[1] - 0.078, p[2] + Math.sin(a) * 0.064], [p[0] + Math.cos(a) * 0.05, p[1] + 0.075, p[2] + Math.sin(a) * 0.05], profCircle(0.0032, 4), { cast: false }); }
  const c = new Geo(); c.lathe([[0.0, 0], [0.05, 0], [0.045, 0.03], [0.02, 0.04], [0.0, 0.04]], 8, 0, 0, 0, {}); g.append(c, T([p[0], p[1] - 0.09 - 0.0, p[2]], 0, 0, 0, 1)); g.append(c, T([p[0], p[1] + 0.06, p[2]], 0, 0, 0, 1));
}
/** coiled rope / hose / cable on the floor */
export function coil(P, mat, p, r = 0.25, cr = 0.02, turns = 4, yaw = 0) { const path = []; const n = turns * 14; for (let k = 0; k <= n; k++) { const t = k / n, a = t * turns * TAU, rr = r * (1 - 0.35 * t); path.push(at(p, Math.cos(a) * rr, cr * 1.6 * t, Math.sin(a) * rr, yaw)); } member(P, mat, path[0], path[1], profCircle(cr, 6), { cast: false }); const g = P.of(mat, false); g.sweep(profCircle(cr, 6), path, { smooth: true, up: [0, 1, 0] }); }
