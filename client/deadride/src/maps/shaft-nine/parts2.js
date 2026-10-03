// Shaft Nine parts, second set: rock scree / basalt colonnades / grating / pipes / small clutter (bucket, bottle, hard hat, tyre, cable drum, tools, paper, barbed wire).
// All built from rawgeo.js faces and merged into existing materials (see parts.js header). Dimensions: bucket 300 mm tall, hard hat 200 mm brim, tyre 800 x 200, cable drum 1.0 x 0.6, grating bars 30 x 3 mm @ 50 mm.
import { Geo, profCircle, profFlat } from './rawgeo.js';
import { T, at, member, hewn, bolt } from './parts.js';
const PI = Math.PI, TAU = PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = (a) => Math.hypot(a[0], a[1], a[2]), norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** matrix (column-major) whose local +Y is dir, origin p */
export function basisY(p, dir, s = 1) { const y = norm(dir), up = Math.abs(y[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0], x = norm(cross(up, y)), z = cross(y, x); return [x[0] * s, x[1] * s, x[2] * s, 0, y[0] * s, y[1] * s, y[2] * s, 0, z[0] * s, z[1] * s, z[2] * s, 0, p[0], p[1], p[2], 1]; }

/** heap of faceted rocks (spoil, scree, talus): power-law sizes, larger ones lower, count n inside radius r around c, heightfn(x,z)->ground y */
export function rockPile(P, mat, { c, r, n, hgt = 0.4, ground = () => c[1], seed = 1, size = 0.5, squash = [1.2, 0.7, 1], cast = false }) {
  const R = P.rnd, g = P.uv(P.of(mat, cast)); for (let k = 0; k < n; k++) { const a = R() * TAU, d = r * Math.sqrt(R()), x = c[0] + Math.cos(a) * d, z = c[2] + Math.sin(a) * d, s = size * (0.12 + 0.88 * Math.pow(R(), 2.6)), f = 1 - (d / r) ** 2; g.rock(x, ground(x, z) + hgt * f * (0.4 + R() * 0.6) + s * 0.1, z, s, R, { cuts: 4 + ((R() * 3) | 0), squash, jit: 0.16 }); }
}
/** basalt colonnade: hexagonal columns on a jittered hex lattice inside the ellipse (cx,cz,rx,rz); base(x,z) and top(x,z,rnd) give the column bottom / top heights */
export function basaltField(P, mat, { cx, cz, rx, rz, r0 = 0.45, base, top, seed = 1, j = 0.07, cast = true }) {
  const R = P.rnd, g = P.uv(P.of(mat, cast)), dx = r0 * 1.732 * 1.02, dz = r0 * 1.5 * 1.02; let row = 0;
  for (let z = -rz; z <= rz; z += dz, row++) for (let x = -rx + (row & 1 ? dx / 2 : 0); x <= rx; x += dx) { if ((x / rx) ** 2 + (z / rz) ** 2 > 1) continue; const X = cx + x + (R() - 0.5) * r0 * 0.12, Z = cz + z + (R() - 0.5) * r0 * 0.12; g.hex(X, Z, base(X, Z), top(X, Z, R), r0 * (0.92 + R() * 0.1), R, j, 0.05); }
}
/** steel bar grating over the rectangle x0..x1 x z0..z1 at height y: bearing bars 30 x 3 mm every 50 mm (along z), cross rods every 100 mm, banding bars and a toe plate on the open edges */
export function grating(P, mat, { x0, x1, z0, z1, y, edge = [1, 1, 1, 1], pitch = 0.05 }) {
  const R = P.rnd, g = P.of(mat, false); for (let x = x0 + 0.02; x < x1 - 0.01; x += pitch) g.box(x, y - 0.015, (z0 + z1) / 2, 0.003, 0.03, z1 - z0, 0, R);
  for (let z = z0 + 0.05; z < z1; z += 0.1) g.box((x0 + x1) / 2, y + 0.006, z, x1 - x0, 0.006, 0.006, 0, R);
  g.box((x0 + x1) / 2, y - 0.015, z0 + 0.0015, x1 - x0, 0.03, 0.003, 0, R); g.box((x0 + x1) / 2, y - 0.015, z1 - 0.0015, x1 - x0, 0.03, 0.003, 0, R);
  if (edge[0]) g.box((x0 + x1) / 2, y + 0.05, z0 + 0.002, x1 - x0, 0.1, 0.004, 0, R); if (edge[1]) g.box((x0 + x1) / 2, y + 0.05, z1 - 0.002, x1 - x0, 0.1, 0.004, 0, R);
}
/** pipe along a polyline with flanged unions (rings + bolt circles) every `every` m and at every bend, and saddle clamps; r = outside radius */
export function pipe(P, mat, matBolt, pts, r, { every = 3.2, seg = 12, clamps = true } = {}) {
  const R = P.rnd, g = P.of(mat, true), fl = new Geo(); fl.lathe([[r * 0.98, -0.014], [r * 1.42, -0.014], [r * 1.42, 0.014], [r * 0.98, 0.014]], seg, 0, 0, 0, {});
  const flange = (p, dir) => { P.of(mat, false).append(fl, basisY(p, dir)); const x = norm(cross(Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], dir)), z = cross(dir, x); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU, q = [p[0] + (x[0] * Math.cos(a) + z[0] * Math.sin(a)) * r * 1.25, p[1] + (x[1] * Math.cos(a) + z[1] * Math.sin(a)) * r * 1.25, p[2] + (x[2] * Math.cos(a) + z[2] * Math.sin(a)) * r * 1.25]; P.of(matBolt, false).dome(q[0] + dir[0] * 0.014, q[1] + dir[1] * 0.014, q[2] + dir[2] * 0.014, dir[0], dir[1], dir[2], r * 0.09, 5); } };
  for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1], d = sub(b, a), L = len(d), u = norm(d); P.uv(g).sweep(profCircle(r, seg), [a, b], { smooth: true, up: Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], caps: k === 0 || k === pts.length - 2 });
    for (let s = every; s < L - 0.3; s += every * (0.9 + R() * 0.2)) flange([a[0] + u[0] * s, a[1] + u[1] * s, a[2] + u[2] * s], u);
    if (k > 0) { flange(a, u); const ball = new Geo(); ball.lathe([[0, -1], [0.5, -0.87], [0.87, -0.5], [1, 0], [0.87, 0.5], [0.5, 0.87], [0, 1]].map(([rr, y]) => [rr * r * 1.02, y * r * 1.02]), 12, 0, 0, 0, {}); P.of(mat, true).append(ball, T(a, 0, 0, 0, 1)); }
    if (clamps && L > 2) for (let s = 0.8; s < L - 0.5; s += 2.2) { const p = [a[0] + u[0] * s, a[1] + u[1] * s, a[2] + u[2] * s]; P.of(matBolt, false).append(fl, basisY(p, u, 0.98)); } }
}
/** 10 l galvanised bucket with rolled rim, bottom bead, wire bail; optionally tipped */
export function bucket(P, mat, matWire, p, { yaw = 0, tilt = 0, roll = 0, dent = 0.004 } = {}) {
  const R = P.rnd, ph = R() * 6, g = new Geo(); g.lathe([[0, 0], [0.108, 0], [0.114, 0.007], [0.118, 0.02], [0.152, 0.27], [0.158, 0.276], [0.156, 0.284], [0.148, 0.284], [0.148, 0.272], [0.112, 0.024], [0.0, 0.02]], 14, 0, 0, 0, { jit: (r, y, a) => (r > 0.1 ? Math.sin(a * 2 + ph) * dent : 0) });
  P.uv(P.of(mat, false)).append(g, T(p, yaw, tilt, roll, 1)); const path = []; for (let k = 0; k <= 10; k++) { const a = k / 10 * PI; path.push(at([0, 0, 0], Math.cos(a) * 0.15, 0.27 + Math.sin(a) * 0.15, 0, 0)); }
  const m = T(p, yaw, tilt, roll, 1), gw = new Geo(); gw.sweep(profCircle(0.0026, 4), path, { smooth: true, up: [0, 0, 1] }); P.of(matWire, false).append(gw, m);
}
/** glass bottle (0.75 l wine shape) lying or standing */
export function bottle(P, mat, p, { yaw = 0, tilt = 0, roll = 0 } = {}) { const g = new Geo(); g.lathe([[0, 0], [0.036, 0], [0.038, 0.006], [0.038, 0.19], [0.03, 0.235], [0.013, 0.27], [0.013, 0.31], [0.0165, 0.31], [0.0165, 0.318], [0.0125, 0.318], [0.0125, 0.29], [0.0, 0.27]], 10, 0, 0, 0, {}); P.of(mat, false).append(g, T(p, yaw, tilt, roll, 1)); }
/** miner's hard hat (ABS shell with ridges and brim; lamp bracket) */
export function hardHat(P, mat, p, { yaw = 0, tilt = 0, roll = 0 } = {}) { const g = new Geo(); g.lathe([[0.155, 0], [0.185, 0.004], [0.198, 0.014], [0.17, 0.024], [0.152, 0.05], [0.13, 0.095], [0.09, 0.13], [0.035, 0.143], [0, 0.145], [0.03, 0.138], [0.085, 0.124], [0.122, 0.09], [0.142, 0.048], [0.148, 0.008], [0.14, 0.002]], 16, 0, 0, 0, { jit: (r, y, a) => (y > 0.03 && y < 0.14 && r > 0.03 ? 0.004 * Math.max(0, Math.cos(a * 3)) : 0) }); P.of(mat, false).append(g, T(p, yaw, tilt, roll, 1)); }
/** rubber tyre torus (rim not modelled) */
export function tyre(P, mat, p, { r = 0.34, w = 0.11, yaw = 0, tilt = PI / 2, roll = 0 } = {}) { const path = []; for (let k = 0; k <= 24; k++) { const a = k / 24 * TAU; path.push([Math.cos(a) * r, 0, Math.sin(a) * r]); } const g = new Geo(); g.sweep(profCircle(w, 10).map((q) => [q[0] * 0.95, q[1] * 1.25]), path, { smooth: true, up: [0, 1, 0], caps: false }); P.of(mat, false).append(g, T(p, yaw, tilt - PI / 2 + PI / 2, roll, 1)); }
/** timber cable drum with flanges (lathe discs), bolts, core and turns of cable */
export function spool(P, mat, matCable, p, { r = 0.5, w = 0.5, yaw = 0, wraps = 9 } = {}) {
  const fl = new Geo(); fl.lathe([[0.05, 0], [r, 0], [r, 0.04], [0.05, 0.04]], 20, 0, 0, 0, {}); const m0 = T(p, yaw, PI / 2, 0, 1); const a = new Geo(); a.append(fl, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); const g = P.uv(P.of(mat, true));
  for (const s of [0, 1]) { const q = at(p, 0, 0, (s ? 1 : -1) * w / 2, yaw); g.append(fl, T(q, yaw, PI / 2, 0, 1)); }
  const core = new Geo(); core.lathe([[0.18, 0.0], [0.18, w]], 16, 0, 0, 0, {}); g.append(core, T(at(p, 0, 0, -w / 2, yaw), yaw, PI / 2, 0, 1));
  for (let k = 0; k < wraps; k++) { const cz = -w / 2 + 0.05 + k * (w - 0.1) / wraps, path = []; for (let q = 0; q <= 16; q++) { const an = q / 16 * TAU; path.push(at(p, Math.cos(an) * (0.2 + (k % 3) * 0.02), Math.sin(an) * (0.2 + (k % 3) * 0.02), cz, yaw)); } P.of(matCable, false).sweep(profCircle(0.022, 6), path, { smooth: true, up: [0, 1, 0] }); }
}
/** barbed wire strand: catenary with a twisted double wire (crossed-quad barbs every 0.5 m); segments ~0.6 m so a long fence stays cheap */
export function barbedWire(P, mat, a, b, sag = 0.06) {
  const R = P.rnd, L = len(sub(b, a)), n = Math.max(3, Math.ceil(L / 0.6)), path = []; for (let k = 0; k <= n; k++) { const t = k / n; path.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * PI) * sag, a[2] + (b[2] - a[2]) * t]); }
  const g = P.of(mat, false); g.sweep(profCircle(0.0016, 4), path, { smooth: true, up: [0, 1, 0], caps: false, twist: (t) => t * L * 60 });
  for (let s = 0.2; s < L; s += 0.5) { const t = s / L, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * PI) * sag, a[2] + (b[2] - a[2]) * t], ang = R() * PI, dy = Math.cos(ang) * 0.016, dz = Math.sin(ang) * 0.016;
    g.poly([[q[0] - 0.002, q[1] - dy, q[2] - dz], [q[0] + 0.002, q[1] - dy, q[2] - dz], [q[0] + 0.002, q[1] + dy, q[2] + dz], [q[0] - 0.002, q[1] + dy, q[2] + dz]]); g.poly([[q[0] - 0.002, q[1] + dy, q[2] + dz], [q[0] + 0.002, q[1] + dy, q[2] + dz], [q[0] + 0.002, q[1] - dy, q[2] - dz], [q[0] - 0.002, q[1] - dy, q[2] - dz]]); }
}
/** shovel: ash handle, steel blade with turned-up edges */
export function shovel(P, matWood, matSteel, p, { yaw = 0, lean = 1.1 } = {}) {
  const d = [Math.sin(yaw) * Math.cos(lean), Math.sin(lean), Math.cos(yaw) * Math.cos(lean)], b = [p[0] + d[0] * 1.15, p[1] + d[1] * 1.15, p[2] + d[2] * 1.15]; hewn(P, matWood, p, b, 0.03, 0.03, { bow: 0.006, chamfer: 0.008, taper: 0, cast: false });
  const g = new Geo(); g.sweep([[-0.11, 0], [0.11, 0], [0.11, 0.008], [-0.11, 0.008]], [[0, 0, 0], [0, 0.28, 0.02]], { up: [0, 0, 1] }); P.of(matSteel, false).append(g, basisY(p, [d[0], d[1], d[2]], 1));
}
/** scatter of small floor clutter along a track / wall, gravity-correct: `n` items chosen by weight from the given table of {kind, mats} */
export function scatter(P, M, { area, n, kinds }) {
  const R = P.rnd; for (let k = 0; k < n; k++) { const [x0, z0, x1, z1] = area, x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0), y = 0, kind = kinds[(R() * kinds.length) | 0], yaw = R() * TAU;
    if (kind === 'bucket') bucket(P, M.iron, M.dark, [x, y, z], { yaw, tilt: R() < 0.3 ? 1.3 : 0, roll: 0 }); else if (kind === 'bottle') bottle(P, M.glass, [x, y + 0.038, z], { yaw, tilt: PI / 2, roll: 0 }); else if (kind === 'hat') hardHat(P, M.hat || M.iron, [x, y, z], { yaw }); else if (kind === 'tyre') tyre(P, M.dark, [x, y + 0.12, z], { yaw }); else if (kind === 'shovel') shovel(P, M.post, M.iron, [x, y + 0.01, z], { yaw, lean: 0.08 });
    else if (kind === 'plank') hewn(P, M.board, [x, y + 0.025, z], [x + Math.cos(yaw) * (0.6 + R()), y + 0.025, z + Math.sin(yaw) * (0.6 + R())], 0.2, 0.045, { bow: 0.01, chamfer: 0.004, cast: false }); else if (kind === 'brick') P.of(M.brick, false).box(x, y + 0.032, z, 0.215, 0.065, 0.1, 0.004, R); }
}
/** lab layout for src/sandbox/shaft-parts.js */
export function lab(P, M, p, R) {
  const mat = M.coal, g = (x, z) => 0;
  rockPile(P, M.coal, { c: [p[0] - 2, 0, -1], r: 1.6, n: 46, hgt: 0.6, size: 0.55 }); basaltField(P, M.iron, { cx: p[0] + 1.8, cz: -1, rx: 1.6, rz: 1.5, r0: 0.3, base: () => 0, top: (x, z, r) => 0.5 + r() * 0.7 });
  grating(P, M.iron, { x0: p[0] - 1, x1: p[0] + 1, z0: 2, z1: 4, y: 0.6 }); pipe(P, M.iron, M.iron, [[p[0] - 1, 0.3, 5], [p[0] + 2, 0.3, 5], [p[0] + 2, 1.4, 5]], 0.09, { every: 1.2 });
  bucket(P, M.tub, M.dark, [p[0] - 2.4, 0, 2.5], {}); bottle(P, M.glass, [p[0] - 2.0, 0.038, 2.6], { tilt: PI / 2, yaw: 0.6 }); hardHat(P, M.iron, [p[0] - 2.4, 0, 3.4], {}); tyre(P, M.dark, [p[0] + 2.8, 0.12, 2.5], {}); shovel(P, M.post, M.iron, [p[0] + 3.0, 0, 3.4], {}); spool(P, M.board, M.dark, [p[0] + 3.2, 0.5, 0.5], {});
  barbedWire(P, M.iron, [p[0] - 3, 1.2, -3], [p[0] + 3, 1.25, -3], 0.05); scatter(P, M, { area: [p[0] - 3, 6, p[0] + 3, 9], n: 24, kinds: ['bucket', 'bottle', 'hat', 'plank', 'brick', 'shovel'] });
}
/** grating over a rotated rectangle (bridge decks): centre c, length along the yaw direction, width across */
export function gratingYaw(P, mat, { c, y, len: L, wid, yaw = 0, pitch = 0.05 }) { const g = new Geo(); grating({ of: () => g, rnd: P.rnd }, mat, { x0: -L / 2, x1: L / 2, z0: -wid / 2, z1: wid / 2, y: 0, pitch }); P.of(mat, false).append(g, T([c[0], y, c[2]], yaw, 0, 0, 1)); }
