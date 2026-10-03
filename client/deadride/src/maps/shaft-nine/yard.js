// SHAFT NINE surface yard: real-construction structures built from rawgeo/parts (see parts.js). Every function appends to a Parts accumulator (merged into the stop's static batch with the
// stop's existing materials) and returns nothing unless noted.
// References (metres): headframe leg = 4 corner angles 120 x 13 mm laced with 60 x 8 mm flat bars (pitch ~0.95 m), section 0.92 -> 0.54; ring beams I 280 x 140; diagonals angle 90 x 9;
// sheave wheel 5.1 m over the groove, rim 0.32 wide, 8 spokes; wire rope 64 mm dia with ~0.4 m lay; ladder stringers 60 x 6, rungs 22 mm dia @ 300 mm, safety hoops 720 mm dia @ 0.9 m;
// brick 215 x 65 (10 mm joints), corrugated iron 76 x 19 mm; water-tower stave tank with 8 iron hoops; hard-hat / bucket / bottle dimensions in parts2.js.
import * as THREE from 'three';
import { Geo, profI, profL, profFlat, profCircle, profC } from './rawgeo.js';
import { member, iBeam, angle, channel, gusset, slab, bolt, wireRope, corrugated, brickWall, hewn, at, T } from './parts.js';
import { grating, pipe, barbedWire, basisY, rockPile } from './parts2.js';
const PI = Math.PI, TAU = PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** railing: posts every ~1.3 m (flat bars), top rail + mid rail (round tube), toe plate. pts = polyline at deck level, h = 1.05 */
export function railing(P, mat, pts, { h = 1.05, closed = false } = {}) {
  const n = pts.length + (closed ? 1 : 0); for (let k = 0; k < n - 1; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length], d = sub(b, a), L = len(d), u = norm(d), np = Math.max(1, Math.round(L / 1.3));
    for (let i = 0; i <= np; i++) { const p = lerp3(a, b, i / np); member(P, mat, p, [p[0], p[1] + h, p[2]], profFlat(0.05, 0.008), { up: [-u[2], 0, u[0]], step: 3, cast: false }); }
    member(P, mat, [a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], profCircle(0.02, 6), { up: [0, 1, 0], step: 3, cast: false }); member(P, mat, [a[0], a[1] + h * 0.52, a[2]], [b[0], b[1] + h * 0.52, b[2]], profCircle(0.014, 5), { up: [0, 1, 0], step: 3, cast: false });
    member(P, mat, [a[0], a[1] + 0.05, a[2]], [b[0], b[1] + 0.05, b[2]], profFlat(0.008, 0.1), { up: [-u[2], 0, u[0]], step: 3, cast: false });
  }
}
/** safety-caged vertical ladder: base centre p (world), rising to y1, facing yaw (rungs toward local +z). Rungs 22 mm, stringers 60x6 angles, hoops from 2.4 m */
export function cagedLadder(P, M, p, y1, yaw = 0, { width = 0.46, cage = true, follow = null } = {}) {
  const S = M.steelRaw, R = P.rnd, X = (lx, y, lz) => { const q = at(p, lx, y, lz, yaw); return follow ? follow(q, y) : q; };
  for (const s of [-1, 1]) member(P, S, X(s * width / 2, p[1] + 0.05, 0), X(s * width / 2, y1, 0), profL(0.06, 0.006).map((q) => [q[0] - 0.03, q[1] - 0.03]), { up: at([0, 0, 0], 0, 0, 1, yaw), step: 6, cast: false });
  for (let y = p[1] + 0.3; y < y1 - 0.1; y += 0.3) { const a = X(-width / 2, y, 0.02), b = X(width / 2, y, 0.02); member(P, S, a, b, profCircle(0.011, 6), { up: [0, 1, 0], step: 2, cast: false }); }
  if (cage) for (let y = p[1] + 2.4; y < y1 - 0.3; y += 0.9) { const path = [X(-0.36, y, 0.03), X(-0.36, y, 0.3)]; for (let k = 1; k < 10; k++) { const a = -PI / 2 + k / 10 * PI; path.push(X(0.36 * Math.sin(a), y, 0.3 + 0.36 * Math.cos(a))); } path.push(X(0.36, y, 0.3), X(0.36, y, 0.03)); P.of(S, false).sweep(profFlat(0.045, 0.006), path, { up: [0, 1, 0], smooth: true, caps: true }); }
  if (cage) for (const lx of [-0.36, 0.36, 0]) { const a = X(lx, p[1] + 2.4, lx === 0 ? 0.4 : 0.05), b = X(lx, y1 - 0.3, lx === 0 ? 0.4 : 0.05); member(P, S, a, b, profFlat(0.03, 0.006), { up: at([0, 0, 0], 0, 0, 1, yaw), step: 6, cast: false }); }
}
/** grating deck with a rectangular opening in the middle (the shaft) + perimeter railing; rect = [x0,x1,z0,z1] */
export function deck(P, M, y, rect, hole, { rail = true } = {}) {
  const [x0, x1, z0, z1] = rect, [hx0, hx1, hz0, hz1] = hole; const G = M.steelRaw;
  for (const r of [[x0, x1, z0, hz0], [x0, x1, hz1, z1], [x0, hx0, hz0, hz1], [hx1, x1, hz0, hz1]]) if (r[1] - r[0] > 0.2 && r[3] - r[2] > 0.2) grating(P, G, { x0: r[0], x1: r[1], z0: r[2], z1: r[3], y, edge: [0, 0, 0, 0] });
  for (const z of [z0, z1]) iBeam(P, G, [x0, y - 0.12, z], [x1, y - 0.12, z], 0.14, 0.08, 0.009, 0.006, { cast: false }); for (const x of [x0, x1]) iBeam(P, G, [x, y - 0.12, z0], [x, y - 0.12, z1], 0.14, 0.08, 0.009, 0.006, { cast: false });
  if (rail) { railing(P, G, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], { closed: true }); railing(P, G, [[hx0, y, hz0], [hx1, y, hz0], [hx1, y, hz1], [hx0, y, hz1]], { closed: true }); }
}

/** the 34 m steel lattice headframe: laced corner-angle legs, ring beams with gussets, X bracing with turnbuckles, decks, caged ladder, sheave deck + A-frames */
export function headframe(P, M, { legBase, H, top, levels, atL }) {
  const S = M.steelRaw, PL = M.steel, R = P.rnd, sec = (h) => 0.92 - 0.38 * (h / H), cor = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const angleProf = (mirror) => { const p = profL(0.15, 0.016); return mirror ? p.map((q) => [-q[0], q[1]]).reverse() : p; };
  for (let i = 0; i < 4; i++) {
    const c0 = atL(i, 0), c1 = atL(i, H);
    for (const [sx, sz] of cor) member(P, S, [c0[0] + sx * sec(0) / 2, 0.02, c0[2] + sz * sec(0) / 2], [c1[0] + sx * sec(H) / 2, H, c1[2] + sz * sec(H) / 2], angleProf(sx * sz > 0), { up: [0, 0, -sz], step: 8 });
    for (let k = 0; k < 4; k++) {
      const [sx0, sz0] = cor[k], [sx1, sz1] = cor[(k + 1) % 4], nrm = [(sx0 + sx1) / 2, 0, (sz0 + sz1) / 2], dx = sx1 - sx0, dz = sz1 - sz0;
      const pos = (h, u) => { const s = sec(h), c = atL(i, h), inset = 0.07 / s, uu = inset + u * (1 - 2 * inset); return [c[0] + (sx0 + dx * uu) * s / 2 + nrm[0] * 0.0105, h, c[2] + (sz0 + dz * uu) * s / 2 + nrm[2] * 0.0105]; };
      let j = 0; for (let h = 0.4; h + 0.95 < H - 0.2; h += 0.95, j++) {
        const a = pos(h, j & 1 ? 1 : 0), b = pos(h + 0.95, j & 1 ? 0 : 1); member(P, S, a, b, profFlat(0.085, 0.011), { up: nrm, step: 3, cast: false });
        if (h < 6.5) for (const q of [a, b]) P.of(S, false).dome(q[0] + nrm[0] * 0.004, q[1], q[2] + nrm[2] * 0.004, nrm[0], 0, nrm[2], 0.0085, 5);
      }
      if (k === 0) for (let h = 3; h < H - 2; h += 6.4) { const s = sec(h), c = atL(i, h), a = [c[0] - s / 2 - 0.02, h, c[2] - s / 2 - 0.02]; slab(P, PL, [[c[0] - s / 2 - 0.02, h, c[2] - s / 2 - 0.02], [c[0] + s / 2 + 0.02, h, c[2] - s / 2 - 0.02], [c[0] + s / 2 + 0.02, h + 0.3, c[2] - s / 2 - 0.02], [c[0] - s / 2 - 0.02, h + 0.3, c[2] - s / 2 - 0.02]], [0, 0, -1], 0.01, false); }
    }
    // base: footing block on the concrete pad, steel base plate, anchor bolts with nuts, four gusset ribs
    const b = [legBase[i][0], 0.5, legBase[i][1]], sx = Math.sign(b[0]), sz = Math.sign(b[2]); const hw = 0.55; slab(P, PL, [[b[0] - hw, 0.5, b[2] - hw], [b[0] + hw, 0.5, b[2] - hw], [b[0] + hw, 0.5, b[2] + hw], [b[0] - hw, 0.5, b[2] + hw]].reverse(), [0, 1, 0], 0.035, true);
    for (const [ax, az] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = [b[0] + ax * 0.44, 0.5 + 0.02, b[2] + az * 0.44]; bolt(P, S, q, [0, 1, 0], 1.6); member(P, S, [q[0], 0.45, q[2]], [q[0], q[1] + 0.06, q[2]], profCircle(0.014, 6), { up: [1, 0, 0], step: 2, cast: false }); }
    for (const [ax, az] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const q0 = [b[0] + ax * 0.5, 0.52, b[2] + az * 0.5], q1 = [b[0] + ax * 0.3, 0.52, b[2] + az * 0.3], q2 = [b[0] + ax * 0.3, 1.3, b[2] + az * 0.3]; const n = [-az, 0, ax]; slab(P, PL, [q0, q1, q2].map((q) => q), n, 0.02, false); slab(P, PL, [q2, q1, q0], n, 0.02, false); }
  }
  // ring beams (I 280x140) with web gussets at the legs, diagonals with turnbuckles
  const rings = [2.4, ...levels.slice(1)];
  for (const lv of rings) for (let i = 0; i < 4; i++) {
    const a = atL(i, lv), b = atL((i + 1) % 4, lv), d = sub(b, a), L = len(d), u = norm(d), t0 = (sec(lv) / 2 + 0.03) / L; const p0 = lerp3(a, b, t0), p1 = lerp3(a, b, 1 - t0);
    iBeam(P, S, p0, p1, 0.36, 0.18, 0.026, 0.015, { step: 6 });
    for (const [p, dir] of [[p0, u], [p1, mul(u, -1)]]) { const q = add(p, mul(dir, 0.3)), nn = [-dir[2], 0, dir[0]]; for (const side of [-1, 1]) { const c = add(q, mul(nn, side * 0.0135)); slab(P, PL, [add(c, [0, -0.2, 0]), add(add(c, mul(dir, -0.3)), [0, -0.2, 0]), add(add(c, mul(dir, -0.3)), [0, 0.2, 0]), add(c, [0, 0.2, 0])].map((v) => v), side > 0 ? nn : mul(nn, -1), 0.012, false); } }
  }
  for (let l = 0; l < levels.length - 1; l++) for (let i = 0; i < 4; i++) {
    const a0 = atL(i, levels[l]), a1 = atL((i + 1) % 4, levels[l]), b0 = atL(i, levels[l + 1]), b1 = atL((i + 1) % 4, levels[l + 1]); const nn = norm(cross(sub(a1, a0), [0, 1, 0]));
    for (const [a, b] of [[a0, b1], [a1, b0]]) { const A = add(a, mul(nn, 0.06)), B = add(b, mul(nn, 0.06)); angle(P, S, lerp3(A, B, 0.06), lerp3(A, B, 0.94), 0.12, 0.012, { sag: 0.05, step: 5 }); const m = lerp3(A, B, 0.5); const tb = new Geo(); tb.lathe([[0.012, -0.16], [0.035, -0.1], [0.035, 0.1], [0.012, 0.16]], 8, 0, 0, 0, {}); P.of(S, false).append(tb, basisY(m, sub(B, A))); }
  }
  // decks: grating landings at 6 / 12 / 22.5 m around the open shaft, chequer-plate sheave deck at the top
  for (const lv of [6, 12, 22.5]) { const hx = 5.2 - 3.5 * lv / H - 0.7, hz = 4.6 - 2.9 * lv / H - 0.7; deck(P, M, lv, [-hx, hx, -hz, hz], [-1.7, 1.7, -1.4, 1.4]); }
  // caged ladder up the +x face
  cagedLadder(P, M, [5.2 + 0.55, 0, 0], H - 0.6, -PI / 2, { follow: (q, y) => [q[0] - 3.5 * y / H, q[1], q[2]] });
  // sheave deck: two I-beam runners, cross beams, chequer plate, A-frame pedestals carrying the axle at H+2.3
  for (const sx of [-1, 1]) iBeam(P, S, [sx * 2.4, H - 0.25, -6.6], [sx * 2.4, H - 0.25, 3.6], 0.4, 0.2, 0.022, 0.014, { step: 5 });
  for (let z = -6.2; z <= 3.4; z += 1.55) iBeam(P, S, [-2.4, H - 0.22, z], [2.4, H - 0.22, z], 0.24, 0.12, 0.014, 0.009, { step: 5, cast: false });
  slab(P, PL, [[-2.62, H - 0.03, 3.5], [2.62, H - 0.03, 3.5], [2.62, H - 0.03, -6.7], [-2.62, H - 0.03, -6.7]].reverse(), [0, 1, 0], 0.012, true);
  for (let z = -6.4; z < 3.4; z += 0.22) for (const x of [-2.55, 2.55]) member(P, S, [x - 0.02, H, z], [x + 0.02, H, z], profFlat(0.05, 0.004), { up: [0, 1, 0], step: 2, cast: false });
  railing(P, S, [[-2.62, H, 3.5], [-2.62, H, -6.7], [2.62, H, -6.7], [2.62, H, 3.5]]);
  for (const sx of [-1, 1]) {
    const X = sx * 2.0, apex = [X, H + 2.3, -2.6]; for (const z0 of [2.9, -7.2]) channel(P, S, [X, H, z0], apex, 0.22, 0.08, 0.01, { up: [1, 0, 0], step: 4 });
    iBeam(P, S, [X, H + 1.2, 1.2], [X, H + 1.2, -6.3], 0.16, 0.1, 0.01, 0.007, { step: 5, cast: false }); gusset(P, PL, S, apex, [0, 0, 1], [0, 1, 0], 0.7);
    const g = P.of(S, true); g.box(X, H + 2.3 - 0.22, -2.6, 0.34, 0.36, 0.46, 0.006); for (const dz of [-0.16, 0.16]) for (const dy of [-0.1, 0.1]) g.dome(X + sx * 0.17, H + 2.3 - 0.22 + dy, -2.6 + dz, sx, 0, 0, 0.022, 6);
  }
  member(P, S, [-2.35, H + 2.3, -2.6], [2.35, H + 2.3, -2.6], profCircle(0.13, 12), { up: [0, 1, 0], step: 6, smooth: true });                              // axle through the sheaves
}
/** one sheave wheel (axis along X, centred at the origin): grooved rim, 8 I-section spokes, hoop ties, hub with bolts. Returns a Geo. */
export function sheaveGeo(R = 2.55) {
  const g = new Geo(), s = R / 2.55; const rim = [[2.60, -0.16], [2.64, -0.12], [2.64, -0.08], [2.50, -0.055], [2.455, 0], [2.50, 0.055], [2.64, 0.08], [2.64, 0.12], [2.60, 0.16], [2.30, 0.16], [2.30, -0.16], [2.60, -0.16]].map(([r, y]) => [r * s, y * s]);
  g.lathe(rim, 72, 0, 0, 0, {});
  const tmpP = { of: () => g, rnd: Math.random, uv: (x) => x }; const R2 = Math.random;
  for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + 0.2, c = Math.cos(a), sn = Math.sin(a); const p0 = [0.34 * c * s, 0, 0.34 * sn * s], p1 = [2.32 * c * s, 0, 2.32 * sn * s]; const P2 = { of: () => g, rnd: R2, uv: (q) => q }; member(P2, null, p0, p1, profI(0.2, 0.16, 0.02, 0.014), { up: [0, 1, 0], step: 6 }); }
  for (let k = 0; k < 8; k++) { const a0 = k / 8 * TAU + 0.2, a1 = (k + 1) / 8 * TAU + 0.2, r = 1.45 * s; const P2 = { of: () => g, rnd: R2, uv: (q) => q }; member(P2, null, [Math.cos(a0) * r, 0.0, Math.sin(a0) * r], [Math.cos(a1) * r, 0.0, Math.sin(a1) * r], profFlat(0.06, 0.012), { up: [0, 1, 0], step: 6 }); }
  const hub = [[0.15, -0.3], [0.32, -0.26], [0.38, -0.2], [0.38, 0.2], [0.32, 0.26], [0.15, 0.3], [0.15, -0.3]].map(([r, y]) => [r * s, y * s]); g.lathe(hub, 20, 0, 0, 0, {});
  for (const y of [-0.27 * s, 0.27 * s]) for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; g.dome(Math.cos(a) * 0.27 * s, y, Math.sin(a) * 0.27 * s, 0, Math.sign(y), 0, 0.028 * s, 6); }
  const out = new Geo(); out.append(g, T([0, 0, 0], 0, 0, PI / 2, 1)); return out;
}
/** THREE.BufferGeometry from a Geo (position, normal, uv + aVis/aBake for the patched materials) */
export function geoToBuffer(g) {
  const b = new THREE.BufferGeometry(); const n = g.verts; b.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3)); b.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3)); b.setAttribute('uv', new THREE.Float32BufferAttribute(g.u, 2));
  b.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(n * 2).fill(1), 2)); b.setAttribute('aBake', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); b.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(g.i, 1) : new THREE.Uint16BufferAttribute(g.i, 1)); b.computeBoundingSphere(); return b;
}

// ================================================================== engine house
/** window: hewn frame in a wall opening, glazing bars, panes (some broken / boarded). p = centre of the opening on the wall plane, n = outward unit normal, w x h opening, depth = recess from the outer face */
export function windowFrame(P, M, { p, yaw = 0, w, h, recess = 0.16 }) {
  const R = P.rnd, q = (lx, ly, lz) => at(p, lx, ly, lz, yaw), fz = -recess, ft = 0.07;
  hewn(P, M.timber, q(-w / 2 + ft / 2, -h / 2, fz), q(-w / 2 + ft / 2, h / 2, fz), ft, 0.1, { bow: 0.004, chamfer: 0.008, up: q(0, 0, 1).map((v, i) => v - p[i]) }); hewn(P, M.timber, q(w / 2 - ft / 2, -h / 2, fz), q(w / 2 - ft / 2, h / 2, fz), ft, 0.1, { bow: 0.004, chamfer: 0.008, up: q(0, 0, 1).map((v, i) => v - p[i]) });
  hewn(P, M.timber, q(-w / 2, -h / 2 + ft / 2, fz), q(w / 2, -h / 2 + ft / 2, fz), ft, 0.1, { bow: 0.004, chamfer: 0.008, up: [0, 1, 0] }); hewn(P, M.timber, q(-w / 2, h / 2 - ft / 2, fz), q(w / 2, h / 2 - ft / 2, fz), ft, 0.1, { bow: 0.004, chamfer: 0.008, up: [0, 1, 0] });
  const cols = 3, rows = Math.max(2, Math.round(h / 0.5)), pw = (w - 2 * ft) / cols, ph = (h - 2 * ft) / rows;
  for (let i = 1; i < cols; i++) { const x = -w / 2 + ft + i * pw; hewn(P, M.timber, q(x, -h / 2 + ft, fz), q(x, h / 2 - ft, fz), 0.03, 0.05, { bow: 0, chamfer: 0.004, taper: 0, up: q(0, 0, 1).map((v, k) => v - p[k]) }); }
  for (let j = 1; j < rows; j++) { const y = -h / 2 + ft + j * ph; hewn(P, M.timber, q(-w / 2 + ft, y, fz), q(w / 2 - ft, y, fz), 0.03, 0.05, { bow: 0, chamfer: 0.004, taper: 0, up: [0, 1, 0] }); }
  const g = P.of(M.glass, false), nn = q(0, 0, 1).map((v, i) => v - p[i]);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x0 = -w / 2 + ft + i * pw + 0.015, x1 = x0 + pw - 0.03, y0 = -h / 2 + ft + j * ph + 0.015, y1 = y0 + ph - 0.03, r = R();
    if (r < 0.34) continue;                                                                                                                                               // missing pane
    if (r < 0.5) { const c = q((x0 + x1) / 2, (y0 + y1) / 2, fz + 0.03); const sh = [[-0.5, -0.5], [0.5, -0.5], [0.15, 0.5]].map(([a, b]) => q(x0 + (x1 - x0) * (0.5 + a * (0.5 + R() * 0.4)), y0 + (y1 - y0) * (0.5 + b * (0.4 + R() * 0.5)), fz + 0.03)); g.poly(sh); continue; }   // shard
    g.poly([q(x0, y0, fz + 0.005), q(x1, y0, fz + 0.005), q(x1, y1, fz + 0.005), q(x0, y1, fz + 0.005)]); g.poly([q(x0, y1, fz + 0.005), q(x1, y1, fz + 0.005), q(x1, y0, fz + 0.005), q(x0, y0, fz + 0.005)]);
    if (R() < 0.35) { const a = q(x0, y0, fz + 0.02), b = q(x1, y1, fz + 0.02); P.of(M.steelRaw, false); }
  }
  if (R() < 0.7) for (let k = 0; k < 2 + ((R() * 2) | 0); k++) { const y = -h / 2 + 0.25 + R() * (h - 0.5), tilt = (R() - 0.5) * 0.3; hewn(P, M.board, q(-w / 2 - 0.08, y - tilt * 0.4, 0.02), q(w / 2 + 0.08, y + tilt * 0.4, 0.02), 0.19, 0.03, { bow: 0.006, chamfer: 0.003, up: nn.slice(), cast: true }); }
}
/** double door of vertical planks with ledges, Z-braces, strap hinges and a hasp; closed but not flush. p = base centre of the opening on the wall plane */
export function doubleDoor(P, M, { p, yaw = 0, w = 3.4, h = 3.8, recess = 0.22 }) {
  const R = P.rnd, q = (lx, ly, lz) => at(p, lx, ly, lz, yaw), nn = norm(sub(q(0, 0, 1), q(0, 0, 0))), fz = -recess;
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? 0.01 : -w / 2 + 0.02, x1 = s > 0 ? w / 2 - 0.02 : -0.01, n = Math.round((x1 - x0) / 0.155), pw = (x1 - x0) / n;
    for (let i = 0; i < n; i++) { const x = x0 + (i + 0.5) * pw, top = h - 0.1 - R() * 0.03, bot = 0.04 + R() * 0.03; hewn(P, M.timber, q(x, bot, fz + (R() - 0.5) * 0.008), q(x, top, fz + (R() - 0.5) * 0.008), pw - 0.005, 0.045, { bow: 0.006, chamfer: 0.003, taper: 0, twist: 0.02, up: nn.slice() }); }
    for (const y of [0.35, h / 2, h - 0.5]) hewn(P, M.beamWood, q(x0, y, fz + 0.05), q(x1, y, fz + 0.05), 0.14, 0.04, { bow: 0.004, chamfer: 0.003, taper: 0, up: [0, 1, 0] });
    hewn(P, M.beamWood, q(s > 0 ? x0 + 0.05 : x1 - 0.05, 0.4, fz + 0.09), q(s > 0 ? x1 - 0.05 : x0 + 0.05, h - 0.55, fz + 0.09), 0.13, 0.035, { bow: 0.005, chamfer: 0.003, taper: 0, up: nn.slice() });
    for (const y of [0.55, h - 0.65]) { const a = q(s > 0 ? x1 : x0, y, fz + 0.075), b = q(s > 0 ? x0 + 0.05 : x1 - 0.05, y, fz + 0.075); member(P, M.steelRaw, a, b, profFlat(0.11, 0.009), { up: nn.slice(), step: 2, cast: false }); for (let k = 0; k < 4; k++) { const t = 0.1 + k * 0.25, c = lerp3(a, b, t); P.of(M.steelRaw, false).dome(c[0] + nn[0] * 0.006, c[1], c[2] + nn[2] * 0.006, nn[0], 0, nn[2], 0.013, 5); } }
  }
  const c = q(0, h / 2 - 0.1, fz + 0.09); member(P, M.steelRaw, add(c, [0, 0, 0]), add(c, [0, -0.2, 0]), profFlat(0.05, 0.01), { up: nn.slice(), step: 2, cast: false }); P.of(M.steelRaw, false).dome(c[0] + nn[0] * 0.01, c[1] - 0.22, c[2] + nn[2] * 0.01, nn[0], 0, nn[2], 0.035, 8);
}
/** corrugated gable roof (ridge along x) with real sheets, fascia, half-round gutter, ridge roll and visible king-post trusses under it. Returns nothing. */
export function gableRoof(P, M, { p, w, d, rise, overhang = 0.7, trussEvery = 2.4, y0 = 0 }) {
  const R = P.rnd, half = d / 2 + overhang, run = half, sl = Math.hypot(rise * (half / (d / 2)), run), riseFull = rise * (half / (d / 2));
  for (const s of [-1, 1]) { const up = norm([0, riseFull, -s * run]), dir = [s, 0, 0], a = [p[0] - s * (w / 2 + overhang), p[1] + y0, p[2] + s * half]; corrugated(P, M.corr, M.steelRaw, { a, dir, up, w: w + 2 * overhang, h: sl, out: norm(cross(dir, up)) }); }
  const ridge = [p[0] - w / 2 - overhang, p[1] + y0 + riseFull, p[2]], ridge1 = [p[0] + w / 2 + overhang, p[1] + y0 + riseFull, p[2]]; member(P, M.steelRaw, ridge, ridge1, profCircle(0.11, 10), { up: [0, 1, 0], step: 6, smooth: true });
  for (const s of [-1, 1]) { const a = [p[0] - w / 2 - overhang, p[1] + y0 - 0.02, p[2] + s * half], b = [p[0] + w / 2 + overhang, p[1] + y0 - 0.02, p[2] + s * half]; hewn(P, M.board, add(a, [0, -0.13, 0.02 * s]), add(b, [0, -0.13, 0.02 * s]), 0.22, 0.03, { bow: 0.01, chamfer: 0.003, taper: 0, up: [0, 0, s] }); const gp = []; for (let k = 0; k <= 8; k++) { const t = -PI * 0.5 + k / 8 * PI; gp.push([Math.sin(t) * 0.06, -Math.cos(t) * 0.05 - 0.03]); } member(P, M.steelRaw, add(a, [0, -0.28, 0.1 * s]), add(b, [0, -0.28, 0.1 * s]), gp.concat(gp.slice().reverse().map(([x, y]) => [x * 0.9, y * 0.9 + 0.006])), { up: [0, 1, 0], step: 6, caps: true, cast: false }); }
  for (let x = p[0] - w / 2 + 0.6; x < p[0] + w / 2 - 0.3; x += trussEvery) { const eave = (s) => [x, p[1] + y0 - 0.02, p[2] + s * (d / 2)], apex = [x, p[1] + y0 + rise - 0.25, p[2]];
    hewn(P, M.post, eave(-1), eave(1), 0.16, 0.2, { bow: 0.012, chamfer: 0.012, up: [0, 1, 0] }); for (const s of [-1, 1]) hewn(P, M.post, eave(s), apex, 0.14, 0.17, { bow: 0.006, chamfer: 0.01 });
    hewn(P, M.post, [x, p[1] + y0 + 0.16, p[2]], [x, apex[1], p[2]], 0.14, 0.14, { bow: 0.004, chamfer: 0.01, up: [1, 0, 0] }); for (const s of [-1, 1]) hewn(P, M.post, [x, p[1] + y0 + 0.2, p[2]], [x, p[1] + y0 + rise * 0.5, p[2] + s * d * 0.25], 0.11, 0.13, { bow: 0.004, chamfer: 0.01, up: [1, 0, 0] }); }
  for (let k = 1; k <= 4; k++) for (const s of [-1, 1]) hewn(P, M.board, [p[0] - w / 2, p[1] + y0 + riseFull * k / 5 * 0.9, p[2] + s * half * (1 - k / 5)], [p[0] + w / 2, p[1] + y0 + riseFull * k / 5 * 0.9, p[2] + s * half * (1 - k / 5)], 0.09, 0.1, { bow: 0.008, chamfer: 0.006, up: [0, 1, 0], cast: false });
}
/** brick chimney: tapering shaft with mortar-recessed courses (lathe steps every 6 courses), corbelled cap, iron bands with lugs. Returns a Geo for the brick material (bands go to the second output) */
export function chimney(P, matBrick, matIron, { x, z, r0 = 1.5, r1 = 0.85, h = 27 }) {
  const prof = []; const rr = (y) => r0 + (r1 - r0) * (y / h); prof.push([0.0, 0]); prof.push([rr(0) + 0.28, 0]); prof.push([rr(0) + 0.28, 0.5]); prof.push([rr(0) + 0.14, 0.5]); prof.push([rr(0) + 0.14, 0.8]);
  for (let y = 0.8; y < h - 1.4; y += 0.45) { prof.push([rr(y) + 0.008, y]); prof.push([rr(y) - 0.008, y + 0.0]); prof.push([rr(y) - 0.008, y + 0.45]); }
  const top = h - 1.2; prof.push([rr(top) + 0.01, top]); prof.push([rr(top) + 0.16, top + 0.12]); prof.push([rr(top) + 0.16, top + 0.4]); prof.push([rr(top) + 0.3, top + 0.55]); prof.push([rr(top) + 0.3, h - 0.02]); prof.push([rr(top) + 0.04, h]); prof.push([0, h]);
  const g = new Geo(); g.lathe(prof, 30, x, 0, z, { uvr: 1 }); P.of(matBrick, true).append(g);
  for (const y of [5, 10, 15.5, 21, 25.5]) { const r = rr(y) + 0.03, ring = []; for (let k = 0; k <= 24; k++) ring.push([x + Math.cos(k / 24 * TAU) * r, y, z + Math.sin(k / 24 * TAU) * r]); P.of(matIron, false).sweep(profFlat(0.1, 0.014), ring, { up: [0, 1, 0], smooth: true }); const a = k0(y); P.of(matIron, false).box(x + r + 0.01, y, z, 0.05, 0.16, 0.12, 0.004, P.rnd); }
}
const k0 = (y) => y;
/** corrugated tool shed: framed walls with real sheets, mono-pitch roof with laps, plank door with strap hinges, small window with bars */
export function shed(P, M, { p, yaw = 0, w = 8, d = 4.6, h = 3.2 }) {
  const q = (lx, ly, lz) => at(p, lx, ly, lz, yaw), R = P.rnd; const dirx = norm(sub(q(1, 0, 0), q(0, 0, 0))), dirz = norm(sub(q(0, 0, 1), q(0, 0, 0)));
  const wall = (a, dir, out, ww, hh, skip = null) => corrugated(P, M.corr, M.steelRaw, { a, dir, up: [0, 1, 0], w: ww, h: hh, out });
  wall(q(-w / 2, 0, d / 2), dirx, dirz, w, h); wall(q(w / 2, 0, -d / 2), mul(dirx, -1), mul(dirz, -1), w, h); wall(q(w / 2, 0, d / 2), mul(dirz, -1), dirx, d, h); wall(q(-w / 2, 0, -d / 2), dirz, mul(dirx, -1), d, h);
  for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) hewn(P, M.post, q(lx, 0, lz), q(lx, h + 0.2, lz), 0.14, 0.14, { bow: 0.006, chamfer: 0.012 }); for (const lx of [-w / 4, w / 4]) { hewn(P, M.post, q(lx, 0, d / 2 + 0.06), q(lx, h, d / 2 + 0.06), 0.09, 0.09, { bow: 0.004, chamfer: 0.008 }); }
  for (const lz of [-d / 2 - 0.05, d / 2 + 0.05]) hewn(P, M.post, q(-w / 2 - 0.1, h + 0.02, lz), q(w / 2 + 0.1, h + 0.28, lz), 0.14, 0.12, { bow: 0.01, chamfer: 0.008, up: [0, 1, 0] });
  const up = norm(add(mul(dirz, -1 * 1.0), [0, 0.09, 0])), roofUp = norm(add(mul(dirz, -d), [0, 0.28, 0])); const a = q(-w / 2 - 0.3, h + 0.04, d / 2 + 0.3), rl = Math.hypot(d + 0.6, 0.3);
  corrugated(P, M.corr, M.steelRaw, { a, dir: dirx, up: roofUp, w: w + 0.6, h: rl, out: norm(cross(dirx, roofUp)) });
  for (let k = 0; k < 5; k++) hewn(P, M.board, q(-w / 2 - 0.3, h + 0.02 + (0.28 * (0.1 + k * 0.2)), d / 2 * (0.9 - k * 0.45)), q(w / 2 + 0.3, h + 0.02 + (0.28 * (0.1 + k * 0.2)), d / 2 * (0.9 - k * 0.45)), 0.08, 0.1, { bow: 0.006, chamfer: 0.005, up: [0, 1, 0], cast: false });
  doubleDoor(P, M, { p: q(0.0, 0, d / 2 + 0.03), yaw, w: 1.6, h: 2.2, recess: 0.03 });
}
/** timber-stave water tank on an I-beam tower: stave lines, 8 iron hoops with lugs, conical roof, rungs; returns nothing (collider legs added by the caller) */
export function waterTower(P, M, { x, z, y0 = 6.2, r = 2.5, h = 3.6 }) {
  const R = P.rnd, S = M.steelRaw, tank = new Geo(); const prof = [[0, y0 - 0.1], [r * 0.98, y0 - 0.1], [r, y0], [r + 0.02, y0 + 0.02]]; for (let k = 0; k <= 1; k++) prof.push([r + 0.02, y0 + 0.02 + k * h]); prof.push([r, y0 + h + 0.05], [r * 0.5, y0 + h + 0.9], [0.1, y0 + h + 1.6], [0, y0 + h + 1.65]);
  tank.lathe(prof, 32, x, 0, z, { jit: (rr, y, a) => (rr > 1 ? Math.sin(a * 40) * 0.006 : 0) }); P.uv(P.of(M.timber, true)).append(tank);
  for (let k = 0; k < 8; k++) { const y = y0 + 0.2 + k * (h - 0.4) / 7, path = []; for (let i = 0; i <= 32; i++) path.push([x + Math.cos(i / 32 * TAU) * (r + 0.045), y, z + Math.sin(i / 32 * TAU) * (r + 0.045)]); P.of(S, false).sweep(profFlat(0.08, 0.012), path, { up: [0, 1, 0], smooth: true }); const a = k * 0.7; P.of(S, false).box(x + Math.cos(a) * (r + 0.06), y, z + Math.sin(a) * (r + 0.06), 0.08, 0.13, 0.13, 0.004, R); }
  const legs = []; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + PI / 6, bx = x + Math.cos(a) * 2.9, bz = z + Math.sin(a) * 2.9, tx = x + Math.cos(a) * 2.2, tz = z + Math.sin(a) * 2.2; legs.push([[bx, 0, bz], [tx, y0 - 0.1, tz]]); iBeam(P, S, [bx, 0.0, bz], [tx, y0 - 0.1, tz], 0.24, 0.12, 0.014, 0.009, { step: 4, up: [-Math.sin(a), 0, Math.cos(a)] }); const foot = [[bx - 0.3, 0.02, bz - 0.3], [bx + 0.3, 0.02, bz - 0.3], [bx + 0.3, 0.02, bz + 0.3], [bx - 0.3, 0.02, bz + 0.3]]; slab(P, M.steel, foot.reverse(), [0, 1, 0], 0.03, false); }
  for (let l = 0; l < 3; l++) for (let i = 0; i < 6; i++) { const t0 = 0.12 + l * 0.3, t1 = 0.12 + (l + 1) * 0.3; const a = lerp3(legs[i][0], legs[i][1], t0), b = lerp3(legs[(i + 1) % 6][0], legs[(i + 1) % 6][1], t1), c = lerp3(legs[(i + 1) % 6][0], legs[(i + 1) % 6][1], t0), dd = lerp3(legs[i][0], legs[i][1], t1); angle(P, S, a, b, 0.07, 0.007, { sag: 0.03, step: 4 }); angle(P, S, c, dd, 0.07, 0.007, { sag: 0.03, step: 4 }); const m = lerp3(a, b, 0.5), tb = new Geo(); tb.lathe([[0.01, -0.1], [0.026, -0.06], [0.026, 0.06], [0.01, 0.1]], 6, 0, 0, 0, {}); P.of(S, false).append(tb, basisY(m, sub(b, a))); }
  pipe(P, S, S, [[x + 2.55, 1.0, z], [x + 2.55, y0 + 0.3, z]], 0.06, { every: 1.4 });
}
/** timber fence bay set: hewn posts with caps, two rails, alpha picket strip is added by the caller; barbed wire on outriggers. a -> b */
export function fenceRun(P, M, a, b, { outriggers = true } = {}) {
  const R = P.rnd, d = sub(b, a), L = Math.hypot(d[0], d[2]), u = [d[0] / L, 0, d[2] / L], n = Math.max(1, Math.round(L / 3.2)), out = [-u[2], 0, u[0]];
  for (let i = 0; i <= n; i++) { const p = [a[0] + d[0] * i / n, 0, a[2] + d[2] * i / n]; hewn(P, M.post, p, [p[0] + (R() - 0.5) * 0.05, 2.1, p[2] + (R() - 0.5) * 0.05], 0.15, 0.15, { bow: 0.006, chamfer: 0.014, cast: true }); P.of(M.steelRaw, false).box(p[0], 2.12, p[2], 0.2, 0.03, 0.2, 0.01, R); }
  if (outriggers) for (let i = 0; i <= n * 2; i++) { const t = i / (n * 2), p = [a[0] + d[0] * t, 1.95, a[2] + d[2] * t]; member(P, M.steelRaw, p, [p[0] + out[0] * 0.28, 2.3, p[2] + out[2] * 0.28], profFlat(0.03, 0.006), { up: u, step: 2, cast: false }); }
  if (outriggers) for (const k of [0, 1]) { const off = [out[0] * (k * 0.14), 0, out[2] * (k * 0.14)]; barbedWire(P, M.steelRaw, [a[0] + off[0], 2.05 + k * 0.1, a[2] + off[2]], [b[0] + off[0], 2.05 + k * 0.1, b[2] + off[2]], 0.05); }
}
/** timber lamp pole with a cross-arm, brace, cast-iron bracket and an enamel shade with a glass globe; returns the bulb position (world) */
export function lampPole(P, M, p, { height = 5.2, dir = [0, 0, 1], matShade, matGlass }) {
  const R = P.rnd, b = norm(dir), top = [p[0], p[1] + height, p[2]];
  hewn(P, M.post, p, top, 0.26, 0.26, { bow: 0.03, chamfer: 0.03, taper: 0.4, twist: 0.06 }); for (const y of [0.5, 1.6, 3.2]) { const path = []; for (let k = 0; k <= 10; k++) path.push([p[0] + Math.cos(k / 10 * TAU) * (0.15 - 0.1 * y / height), p[1] + y, p[2] + Math.sin(k / 10 * TAU) * (0.15 - 0.1 * y / height)]); P.of(M.steelRaw, false).sweep(profFlat(0.05, 0.008), path, { up: [0, 1, 0], smooth: true }); }
  const arm = [top[0] + b[0] * 0.9, top[1] + 0.08, top[2] + b[2] * 0.9]; hewn(P, M.post, [top[0], top[1] - 0.15, top[2]], arm, 0.09, 0.1, { bow: 0.006, chamfer: 0.008 }); member(P, M.steelRaw, [top[0], top[1] - 1.0, top[2]], [arm[0] - b[0] * 0.1, arm[1] - 0.1, arm[2] - b[2] * 0.1], profFlat(0.05, 0.008), { up: [-b[2], 0, b[0]], step: 3, cast: false });
  const sh = new Geo(); sh.lathe([[0.03, 0.2], [0.12, 0.19], [0.3, 0.02], [0.32, 0.0], [0.3, -0.005], [0.12, 0.13], [0.03, 0.14]], 14, 0, 0, 0, {}); P.of(matShade, false).append(sh, T([arm[0], arm[1] - 0.22, arm[2]], 0, 0, 0, 1));
  const gl = new Geo(); gl.lathe([[0.0, -0.05], [0.06, -0.045], [0.085, 0.0], [0.09, 0.04], [0.06, 0.09], [0.03, 0.1], [0.0, 0.1]], 10, 0, 0, 0, {}); P.of(matGlass, false).append(gl, T([arm[0], arm[1] - 0.3, arm[2]], 0, 0, 0, 1));
  for (let k = 0; k < 2; k++) P.of(M.steelRaw, false).dome(top[0] + b[1] * 0, top[1] - 0.05 - k * 0.2, top[2], b[0], 0, b[2], 0.016, 5); return [arm[0], arm[1] - 0.31, arm[2]];
}
/** wooden pallet 1.2 x 1.0: 5 top boards + 3 bottom boards + 3 notched stringers with nails */
export function pallet(P, M, p, yaw = 0) {
  const R = P.rnd, q = (lx, ly, lz) => at(p, lx, ly, lz, yaw); for (let i = 0; i < 5; i++) hewn(P, M.board, q(-0.6, 0.128 + 0.011, -0.5 + 0.06 + i * 0.22), q(0.6, 0.128 + 0.011, -0.5 + 0.06 + i * 0.22), 0.1 + R() * 0.02, 0.022, { bow: 0.003, chamfer: 0.002, taper: 0, up: [0, 0, 1], cast: false });
  for (const lz of [-0.44, 0, 0.44]) hewn(P, M.board, q(-0.6, 0.022, lz), q(0.6, 0.022, lz), 0.1, 0.022, { bow: 0.002, chamfer: 0.002, taper: 0, up: [0, 0, 1], cast: false });
  for (const lx of [-0.55, 0, 0.55]) hewn(P, M.board, q(lx, 0.0, -0.5), q(lx, 0.0, 0.5), 0.045, 0.09, { bow: 0.002, chamfer: 0.004, taper: 0, up: [1, 0, 0], cast: false });
}
/** rock chunks on the surface of an ellipsoidal heap (coal / spoil): sizes shrink toward the crest, faceted and randomly rotated. c = centre on the ground, radii rx, rz, height ry */
export function heap(P, mat, { c, rx, rz, ry, n, size = 0.4, cast = false }) {
  const R = P.rnd, g = P.uv(P.of(mat, cast)); for (let k = 0; k < n; k++) { const a = R() * TAU, d = Math.sqrt(R()) * 0.98, dx = Math.cos(a) * d * rx, dz = Math.sin(a) * d * rz, f = Math.sqrt(Math.max(0, 1 - d * d)), y = c[1] + ry * f - 0.05, s = size * (0.16 + 0.84 * Math.pow(R(), 3.2)) * (0.6 + 0.4 * (1 - f)); g.rock(c[0] + dx, y, c[2] + dz, s, R, { cuts: 6 + ((R() * 4) | 0), squash: [0.8 + R() * 0.7, 0.55 + R() * 0.5, 0.8 + R() * 0.6], jit: 0.28, low: s < 0.14, tilt: 1.6 }); }
}
