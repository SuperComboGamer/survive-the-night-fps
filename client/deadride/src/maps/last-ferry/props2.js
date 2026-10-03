// LAST FERRY — shared prop library (dressing + cover). Every builder takes (x, z, yaw, opts) in stop-local coordinates and builds into the stop's Builder.
// Geometry is boxes/cylinders in a local frame (frame() from pierProps: u forward, w up, v right), so any yaw works visually; colliders are added only when yaw is a multiple of 90 deg.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { frame } from './pierProps.js';

const P = Math.PI;
const quarter = (yaw) => Math.abs(Math.sin(yaw * 2)) < 1e-3;   // yaw is a multiple of 90 deg?

/** pal: stop palette {wood, iron, rust, steel, rope, conc, tyre, black, glass, tarp?, lit?}. y0 = walking height of the stop's floor. */
export function makeProps(K, pal, y0) {
  const B = K.B, rng = K.rng;
  pal = { brass: pal.steel, net: pal.rope, ...pal };
  if (!pal.lit) pal.lit = B.m('pr_lit', std({ color: 0x000000, emissive: 0xffd9a0, emissiveIntensity: 1.6, roughness: 0.4 }));
  if (!pal.black) pal.black = B.m('pr_black', std({ color: 0x0c0d0e, roughness: 0.55, metalness: 0.5 }));
  const bx = (F, yaw, u0, u1, w0, w1, v0, v1, mat, o = {}) => B.box({ p: F((u0 + u1) / 2, w0, (v0 + v1) / 2), s: [Math.abs(u1 - u0), w1 - w0, Math.abs(v1 - v0)], yaw, mat, bevel: o.bevel ?? 0.015, col: false, walk: false, cast: o.cast ?? true });
  const cyU = (F, yaw, u, w, v, r, len, mat, seg = 12, o = {}) => B.cyl({ p: F(u, w, v), r, h: len, seg, mat, yaw, roll: P / 2, anchor: 'center', cast: o.cast ?? true });  // axis along local u
  const cyV = (F, yaw, u, w, v, r, len, mat, seg = 12, o = {}) => B.cyl({ p: F(u, w, v), r, h: len, seg, mat, yaw, pitch: P / 2, anchor: 'center', cast: o.cast ?? true }); // axis along local v
  const col = (F, u0, u1, w0, w1, v0, v1, yaw, surface = 'metal') => { if (!quarter(yaw)) { const c = F(0, 0, 0); const r = Math.max(Math.abs(u1 - u0), Math.abs(v1 - v0)) * 0.5; B.colliders.addCyl({ x: F((u0 + u1) / 2, 0, (v0 + v1) / 2)[0], z: F((u0 + u1) / 2, 0, (v0 + v1) / 2)[2], r: r * 0.85, y0: c[1] + w0, y1: c[1] + w1, surface, walk: false }); return; }
    const c = F((u0 + u1) / 2, (w0 + w1) / 2, (v0 + v1) / 2), alongX = Math.abs(Math.cos(yaw)) > 0.5; B.colliders.addBox({ x: c[0], y: c[1], z: c[2], hx: (alongX ? Math.abs(u1 - u0) : Math.abs(v1 - v0)) / 2, hy: (w1 - w0) / 2, hz: (alongX ? Math.abs(v1 - v0) : Math.abs(u1 - u0)) / 2, surface, walk: false }); };
  // ------------------------------------------------------------------ shared materials (created once per stop builder)
  const burlap = B.m('pr_burlap', { pattern: 'weave', size: 256, tile: 0.5, colors: [0xa89468, 0x7c6c46], params: { threads: 30, twill: 0, variation: 0.7, fuzz: 0.8 }, bump: 3, rough: [0.9, 1], layers: { grime: 0.6, dust: 0.3 } });
  const sandbagM = B.m('pr_sandbag', { pattern: 'weave', size: 256, tile: 0.5, colors: [0x8a7c5c, 0x62563c], params: { threads: 26, twill: 0, variation: 0.8, fuzz: 0.9 }, bump: 3, rough: [0.92, 1], layers: { grime: 0.8, dust: 0.5 } });
  const plastic = B.m('pr_plastic', std({ color: 0xc8ccc8, roughness: 0.5 }));
  const plasticBlue = B.m('pr_plasticB', std({ color: 0x2a5aa0, roughness: 0.5 }));
  const yellow = B.m('pr_yellow', std({ color: 0xd0a018, roughness: 0.5, metalness: 0.3 }));
  const orange = B.m('pr_orange', std({ color: 0xe0561a, roughness: 0.55 }));
  const hazard = B.m('pr_hazard', (() => { const tex = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = '#e0b818'; c.fillRect(0, 0, w, h); c.fillStyle = '#16161a'; for (let i = -2; i < 6; i++) { c.beginPath(); c.moveTo(i * 32, h); c.lineTo(i * 32 + 16, h); c.lineTo(i * 32 + 16 + h, 0); c.lineTo(i * 32 + h, 0); c.closePath(); c.fill(); } }); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1 / 0.5, 1 / 0.5); return std({ map: tex, roughness: 0.6, metalness: 0.2 }); })());
  const redwhite = B.m('pr_rw', (() => { const tex = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = '#e8e8e0'; c.fillRect(0, 0, w, h); c.fillStyle = '#c02018'; for (let i = 0; i < 8; i += 2) c.fillRect(i * 16, 0, 16, h); }); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1 / 1.0, 1); return std({ map: tex, roughness: 0.5 }); })());
  const glass = pal.glass || B.m('pr_glass', std({ color: 0x05090c, roughness: 0.05, metalness: 0.2 }));
  const sackGeo = (() => { const g = new THREE.SphereGeometry(0.5, 10, 7); g.scale(0.56, 0.24, 0.34); return g; })();
  const R = {};

  // ------------------------------------------------------------------ logistics
  /** EUR-style pallet; o.load = 'crates'|'sacks'|'boxes' */
  R.pallet = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), W = pal.wood;
    for (const v of [-0.34, 0, 0.34]) bx(F, yaw, -0.6, 0.6, 0.02, 0.1, v - 0.05, v + 0.05, W, { bevel: 0.006, cast: false });
    for (let i = 0; i < 5; i++) bx(F, yaw, -0.6 + i * 0.27 - 0.06, -0.6 + i * 0.27 + 0.06, 0.1, 0.122, -0.4, 0.4, W, { bevel: 0.006, cast: false });
    for (const u of [-0.56, 0, 0.56]) bx(F, yaw, u - 0.06, u + 0.06, 0, 0.02, -0.4, 0.4, W, { bevel: 0.004, cast: false });
    let top = 0.122;
    if (o.load === 'crates') { for (let k = 0; k < (o.n ?? 2); k++) { K.crate(F(0, top + k * 0.5, 0)[0], y + top + k * 0.5, F(0, 0, 0)[2], 1.1, 0.5, 0.74, pal.wood, { yaw: yaw + (k % 2) * 0.05, slats: false }); } top += 0.5 * (o.n ?? 2); }
    else if (o.load === 'sacks') { for (let r = 0; r < (o.n ?? 4); r++) for (let i = 0; i < 4; i++) { const c = F(-0.4 + (i % 2) * 0.8 * 0.5 * 1 + (r % 2) * 0.1, top + r * 0.2 + 0.11, (i < 2 ? -0.17 : 0.17)); B.instance('sack', sackGeo, burlap, B.matrix(c, yaw + (rng() - 0.5) * 0.3, [1.1, 1, 1]), 0xffffff, { cast: true }); } top += 0.2 * (o.n ?? 4); }
    else if (o.load === 'boxes') { for (let k = 0; k < (o.n ?? 3); k++) bx(F, yaw, -0.5, 0.5, top + k * 0.36, top + (k + 1) * 0.36, -0.36, 0.36, plastic, { bevel: 0.02 }); top += 0.36 * (o.n ?? 3); }
    if (o.load) col(F, -0.6, 0.6, 0, top, -0.4, 0.4, yaw, 'wood'); return top; };
  /** stack of burlap sacks (rows x cols) */
  R.sacks = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), rows = o.rows ?? 4, cols = o.cols ?? 3;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols - (r > 2 ? 1 : 0); c++) for (const v of [-0.2, 0.2]) { const p = F(-0.4 * (cols - 1) / 2 * 2 * 0.5 + c * 0.55 + (r % 2) * 0.25, r * 0.2 + 0.11, v + (rng() - 0.5) * 0.04); B.instance('sack', sackGeo, burlap, B.matrix(p, yaw + (rng() - 0.5) * 0.25, [1, 1 + (rng() - 0.5) * 0.2, 1]), 0xffffff, { cast: true }); }
    col(F, -0.15 - cols * 0.2, cols * 0.4, 0, rows * 0.2 + 0.1, -0.4, 0.4, yaw, 'fabric'); };
  /** railway/dock luggage trolley (flat platform on four wheels, tow handle) with trunks and suitcases */
  R.trolley = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw);
    bx(F, yaw, -1.0, 1.0, 0.34, 0.4, -0.5, 0.5, pal.wood, { bevel: 0.01 }); bx(F, yaw, -1.0, 1.0, 0.28, 0.34, -0.5, 0.5, pal.iron, { bevel: 0.01, cast: false });
    for (const u of [-0.75, 0.75]) for (const v of [-0.5, 0.5]) { cyV(F, yaw, u, 0.16, v * 1.02, 0.16, 0.07, pal.tyre, 12); }
    B.beam(F(1.0, 0.36, 0.0), F(1.9, 0.95, 0.0), 0.03, 0.03, { mat: pal.iron, bevel: 0, cast: false }); B.beam(F(1.9, 0.95, -0.28), F(1.9, 0.95, 0.28), 0.03, 0.03, { mat: pal.iron, bevel: 0, cast: false });
    const cases = [[-0.55, -0.15, 0.7, 0.42, 0.42, 0], [0.1, 0.2, 0.62, 0.36, 0.38, 0], [0.45, -0.2, 0.5, 0.3, 0.34, 0], [-0.4, 0.22, 0.5, 0.3, 0.32, 0.4]];
    const cm = [pal.wood, B.m('pr_case1', std({ color: 0x4a2c1c, roughness: 0.6 })), B.m('pr_case2', std({ color: 0x1c2a3a, roughness: 0.55 })), B.m('pr_case3', std({ color: 0x3c4a2c, roughness: 0.6 }))];
    cases.forEach(([u, v, l, h, d, yw], i) => { bx(F, yaw + yw, u - l / 2, u + l / 2, 0.4, 0.4 + h, v - d / 2, v + d / 2, cm[i % 4], { bevel: 0.03 }); bx(F, yaw + yw, u - 0.03, u + 0.03, 0.4, 0.4 + h + 0.01, v - d / 2 - 0.005, v + d / 2 + 0.005, pal.iron, { bevel: 0.005, cast: false }); }); };
  /** two-wheel hand cart with load */
  R.handcart = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw);
    cyV(F, yaw, 0, 0.36, 0.5, 0.36, 0.06, pal.tyre, 14); cyV(F, yaw, 0, 0.36, -0.5, 0.36, 0.06, pal.tyre, 14); bx(F, yaw, -0.5, 0.6, 0.36, 0.42, -0.45, 0.45, pal.wood, { bevel: 0.01 });
    for (const v of [-0.45, 0.45]) { bx(F, yaw, -0.5, 0.6, 0.42, 0.75, v - 0.02, v + 0.02, pal.wood, { bevel: 0.005 }); B.beam(F(-0.5, 0.42, v), F(-1.4, 0.9, v), 0.035, 0.035, { mat: pal.iron, bevel: 0, cast: false }); } bx(F, yaw, -0.5, -0.46, 0.42, 0.75, -0.45, 0.45, pal.wood, { bevel: 0.005 });
    for (let k = 0; k < 3; k++) bx(F, yaw, -0.4 + k * 0.32, -0.4 + k * 0.32 + 0.28, 0.42, 0.42 + 0.26 + (k % 2) * 0.1, -0.36, 0.36, k === 1 ? plastic : pal.wood, { bevel: 0.02 }); };
  /** timber bench with cast-iron ends */
  R.bench = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), L = o.len ?? 1.7;
    for (let i = 0; i < 3; i++) bx(F, yaw, -L / 2, L / 2, 0.44, 0.48, -0.22 + i * 0.15, -0.22 + i * 0.15 + 0.13, pal.wood, { bevel: 0.008, cast: false });
    for (let i = 0; i < 2; i++) bx(F, yaw, -L / 2, L / 2, 0.62 + i * 0.15, 0.62 + i * 0.15 + 0.11, -0.25 - i * 0.02, -0.235 - i * 0.02, pal.wood, { bevel: 0.006, cast: false });
    for (const u of [-L / 2 + 0.12, L / 2 - 0.12]) { bx(F, yaw, u - 0.025, u + 0.025, 0, 0.44, -0.22, 0.22, pal.iron, { bevel: 0.01, cast: false }); bx(F, yaw, u - 0.025, u + 0.025, 0.44, 0.9, -0.27, -0.24, pal.iron, { bevel: 0.01, cast: false }); }
    col(F, -L / 2, L / 2, 0, 0.5, -0.24, 0.24, yaw, 'wood'); };
  /** litter bin / dustbin */
  R.bin = (x, z, o = {}) => { const y = o.y ?? y0; B.cyl({ p: [x, y, z], r: [0.24, 0.27], h: 0.86, seg: 12, mat: o.mat || pal.iron, cast: true, col: 'metal' }); B.cyl({ p: [x, y + 0.86, z], r: 0.28, h: 0.05, seg: 12, mat: o.mat || pal.iron, cast: false }); for (const yy of [0.25, 0.6]) B.cyl({ p: [x, y + yy, z], r: 0.275, h: 0.02, seg: 12, mat: pal.rust, cast: false }); };
  /** queue stanchions: posts every ~1.8 m with a rope swag */
  R.stanchions = (a, b, o = {}) => { const y = o.y ?? y0, L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 1.8)); const pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; B.cyl({ p: [x, y, z], r: [0.05, 0.04], h: 0.95, seg: 8, mat: o.mat || pal.iron, cast: false }); B.cyl({ p: [x, y, z], r: 0.16, h: 0.03, seg: 10, mat: o.mat || pal.iron, cast: false }); B.sphere({ p: [x, y + 0.98, z], r: 0.06, mat: pal.brass || pal.steel, seg: 8, cast: false }); pts.push([x, z]); }
    for (let i = 0; i < n; i++) { const A = pts[i], C = pts[i + 1]; B.cable([A[0], y + 0.85, A[1]], [C[0], y + 0.85, C[1]], 0.16, 0.022, o.rope || pal.rope, { n: 8, cast: false }); } };
  /** small ticket / newspaper kiosk with a lit counter window */
  R.kiosk = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), m = o.mat || pal.wood;
    bx(F, yaw, -1.1, 1.1, 0, 2.3, -0.8, 0.8, m, { bevel: 0.03 }); bx(F, yaw, -1.3, 1.3, 2.3, 2.42, -1.0, 1.0, pal.iron, { bevel: 0.02 });
    bx(F, yaw, -0.8, 0.8, 1.15, 1.9, 0.78, 0.84, o.lit || pal.lit, { bevel: 0 }); bx(F, yaw, -0.9, 0.9, 1.1, 1.15, 0.7, 1.0, pal.iron, { bevel: 0.01 }); bx(F, yaw, -0.9, 0.9, 1.9, 1.96, 0.76, 0.9, pal.iron, { bevel: 0.01, cast: false });
    for (const u of [-0.9, 0.9]) bx(F, yaw, u - 0.02, u + 0.02, 1.1, 1.96, 0.76, 0.84, pal.iron, { bevel: 0.005, cast: false });
    if (o.sign) K.sign(o.sign, F(0, 2.62, 0.82), [1.8, 0.4, 0.05], { bg: o.bg || '#10243a', fg: '#e8dcb0', weather: 0.5, w: 512, yaw }); col(F, -1.1, 1.1, 0, 2.4, -0.8, 0.8, yaw, 'wood');
    if (o.glow) K.glare(F(0, 1.5, 1.05), o.glow, 0.5, 0.6, { refl: 1.2, mist: 0.9 }); };
  /** forklift (yellow), forks lowered or raised */
  R.forklift = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), body = o.mat || yellow, up = o.lift ?? 0;
    bx(F, yaw, -1.15, 0.7, 0.22, 0.95, -0.6, 0.6, body, { bevel: 0.05 }); bx(F, yaw, -1.2, -0.6, 0.95, 1.2, -0.55, 0.55, body, { bevel: 0.05 }); bx(F, yaw, -0.2, 0.55, 0.95, 1.05, -0.55, 0.55, pal.black, { bevel: 0.02 });
    for (const u of [-0.55, 0.5]) for (const v of [-0.62, 0.62]) cyV(F, yaw, u, 0.3, v, u < 0 ? 0.26 : 0.32, 0.22, pal.tyre, 14);
    for (const u of [-0.6, 0.4]) for (const v of [-0.55, 0.55]) B.beam(F(u, 0.95, v), F(u, 2.1, v * 0.9), 0.05, 0.05, { mat: pal.black, bevel: 0, cast: false }); bx(F, yaw, -0.7, 0.5, 2.1, 2.16, -0.6, 0.6, pal.black, { bevel: 0.01 });
    bx(F, yaw, -0.3, 0.2, 1.05, 1.5, -0.25, 0.25, pal.black, { bevel: 0.05 }); bx(F, yaw, -0.62, -0.5, 1.05, 1.7, -0.25, 0.25, pal.black, { bevel: 0.05, cast: false });
    for (const v of [-0.3, 0.3]) bx(F, yaw, 0.75, 0.83, 0.1, 2.3, v - 0.05, v + 0.05, pal.steel, { bevel: 0.01 }); bx(F, yaw, 0.72, 0.86, 0.5 + up, 0.58 + up, -0.5, 0.5, pal.steel, { bevel: 0.01 });
    for (const v of [-0.3, 0.3]) bx(F, yaw, 0.83, 1.9, 0.06 + up, 0.11 + up, v - 0.06, v + 0.06, pal.steel, { bevel: 0.01 });
    if (o.beacon) K.glare(F(-0.7, 2.25, 0), 0xffa020, 0.28, 0.9, { blink: [1.0, 0.5, 0], refl: 1.5, mist: 0.8 }); col(F, -1.2, 0.9, 0, 2.15, -0.65, 0.65, yaw, 'metal'); };
  // ------------------------------------------------------------------ security / yard
  /** concrete jersey barrier segment(s), painted top stripe. len per piece 3 m */
  R.jersey = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, n = o.n ?? 1, L = 3.0, C = o.mat || pal.conc;
    for (let i = 0; i < n; i++) { const F = frame(x, y, z, yaw), u = (i - (n - 1) / 2) * (L + 0.04);
      bx(F, yaw, u - L / 2, u + L / 2, 0, 0.24, -0.3, 0.3, C, { bevel: 0.02 }); bx(F, yaw, u - L / 2, u + L / 2, 0.24, 0.56, -0.21, 0.21, C, { bevel: 0.02 }); bx(F, yaw, u - L / 2, u + L / 2, 0.56, 0.82, -0.13, 0.13, C, { bevel: 0.02 });
      bx(F, yaw, u - L / 2 + 0.02, u + L / 2 - 0.02, 0.82, 0.835, -0.12, 0.12, o.stripe || hazard, { bevel: 0, cast: false }); bx(F, yaw, u - 0.12, u + 0.12, 0.55, 0.62, -0.3, 0.3, pal.iron, { bevel: 0.01, cast: false }); }
    col(frame(x, y, z, yaw), -(n * 1.5 + 0.1), n * 1.5 + 0.1, 0, 0.84, -0.3, 0.3, yaw, 'concrete'); };
  /** sandbag emplacement: wall of `len` metres, `rows` high (instanced bags, staggered) */
  R.sandbags = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), len = o.len ?? 3.2, rows = o.rows ?? 4, w = 0.5;
    for (let r = 0; r < rows; r++) { const n = Math.floor(len / w) - (r % 2 ? 1 : 0); for (let i = 0; i < n; i++) for (const v of (o.thick ? [-0.17, 0.17] : [0])) { const p = F(-len / 2 + w / 2 + i * w + (r % 2 ? w / 2 : 0), r * 0.15 + 0.09, v + (rng() - 0.5) * 0.03); B.instance('sandbag', sackGeo, sandbagM, B.matrix(p, yaw + (rng() - 0.5) * 0.12, [0.95, 0.9 + rng() * 0.2, 1.05]), 0xffffff, { cast: true }); } }
    col(F, -len / 2, len / 2, 0, rows * 0.15 + 0.05, -0.22, 0.22, yaw, 'fabric'); };
  /** guard booth: 2 x 2 m cabin with glazing, door, roof overhang, lit interior */
  R.booth = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), m = o.mat || pal.conc;
    bx(F, yaw, -1.05, 1.05, 0, 0.9, -1.05, 1.05, m, { bevel: 0.03 }); for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(F, yaw, u * 1.0 - 0.05, u * 1.0 + 0.05, 0.9, 2.4, v * 1.0 - 0.05, v * 1.0 + 0.05, pal.steel, { bevel: 0.01 });
    bx(F, yaw, -1.0, 1.0, 1.1, 2.3, 0.97, 1.0, glass, { bevel: 0 }); bx(F, yaw, 0.97, 1.0, 1.1, 2.3, -1.0, 1.0, glass, { bevel: 0 }); bx(F, yaw, -1.0, 1.0, 1.1, 2.3, -1.0, -0.97, glass, { bevel: 0 });
    bx(F, yaw, -1.35, 1.35, 2.4, 2.52, -1.35, 1.35, pal.steel, { bevel: 0.03 }); bx(F, yaw, -0.5, 0.5, 1.0, 1.05, -0.7, -0.2, o.lit || pal.lit, { bevel: 0, cast: false }); bx(F, yaw, -0.4, 0.4, 0.9, 1.0, 0.5, 0.95, pal.black, { bevel: 0.01, cast: false });
    col(F, -1.1, 1.1, 0, 2.5, -1.1, 1.1, yaw, 'concrete'); if (o.light) K.lamp(F(0, 2.0, 0), { color: o.light, cd: 12, dist: 9, size: 0.2, k: 0, refl: 1, mist: 0, light: false }); };
  /** boom barrier: post housing + striped arm (down across the lane unless o.up) */
  R.barrier = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), L = o.len ?? 4.4;
    bx(F, yaw, -0.2, 0.2, 0, 1.05, -0.2, 0.2, pal.steel, { bevel: 0.04 }); bx(F, yaw, -0.12, 0.12, 1.05, 1.1, -0.12, 0.12, pal.black, { bevel: 0.01, cast: false });
    if (o.up) { B.beam(F(0, 1.0, 0.15), F(0.1, 1.0 + L, 0.15), 0.08, 0.09, { mat: redwhite, bevel: 0, cast: true }); } else { B.beam(F(0.05, 0.98, 0.14), F(0.05, 0.98, L * 0.98), 0.09, 0.1, { mat: redwhite, bevel: 0, cast: true }); bx(F, yaw, -0.06, 0.06, 0, 0.98, L * 0.98 - 0.06, L * 0.98 + 0.06, pal.steel, { bevel: 0.01, cast: false }); }
    col(F, -0.2, 0.2, 0, 1.1, -0.2, 0.2, yaw, 'metal'); };
  /** traffic cones */
  R.cones = (pts, o = {}) => { const y = o.y ?? y0; for (const [x, z] of pts) { B.cyl({ p: [x, y, z], r: [0.15, 0.035], h: 0.62, seg: 10, mat: orange, cast: true }); B.cyl({ p: [x, y + 0.3, z], r: [0.105, 0.08], h: 0.1, seg: 10, mat: plastic, cast: false }); B.box({ p: [x, y, z], s: [0.4, 0.03, 0.4], mat: pal.black, bevel: 0.005, cast: false }); } };
  /** floodlight tripod / portable lamp stand with a lit head */
  R.floodStand = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), h = o.h ?? 3.0;
    for (const a of [0, 2.1, 4.2]) B.beam([x, y + h * 0.78, z], [x + Math.cos(a + yaw) * 0.6, y, z + Math.sin(a + yaw) * 0.6], 0.04, 0.04, { mat: pal.steel, bevel: 0, cast: false });
    B.cyl({ p: [x, y + h * 0.7, z], r: 0.03, h: h * 0.3, seg: 6, mat: pal.steel, cast: false }); bx(F, yaw, -0.12, 0.12, h, h + 0.3, -0.32, 0.32, pal.black, { bevel: 0.03 }); bx(F, yaw, 0.1, 0.14, h + 0.03, h + 0.27, -0.28, 0.28, o.lit || pal.lit, { bevel: 0, cast: false });
    const p = F(0.3, h + 0.15, 0); K.lamp(p, { color: o.color || 0xdff4ff, cd: o.cd ?? 26, dist: 26, size: 0.5, refl: 3, k: 0.8, mist: 0.6, spill: true, spillR: 8, gy: y }); };
  /** portable generator (skid frame, fuel tank, exhaust, cables) */
  R.generator = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw);
    bx(F, yaw, -0.9, 0.9, 0.05, 0.13, -0.5, 0.5, pal.steel, { bevel: 0.01 }); bx(F, yaw, -0.85, 0.85, 0.13, 1.05, -0.45, 0.45, o.mat || pal.iron, { bevel: 0.05 }); bx(F, yaw, -0.6, 0.6, 1.05, 1.12, -0.4, 0.4, pal.black, { bevel: 0.02, cast: false });
    for (let i = 0; i < 5; i++) bx(F, yaw, 0.86, 0.89, 0.3 + i * 0.13, 0.36 + i * 0.13, -0.3, 0.3, pal.black, { bevel: 0, cast: false }); cyU(F, yaw, -0.2, 1.3, 0.5, 0.07, 0.6, pal.steel, 8, { cast: false }); B.cyl({ p: F(-0.7, 1.05, -0.3), r: 0.05, h: 0.45, seg: 8, mat: pal.steel, cast: false });
    B.tube({ pts: [F(0.5, 0.4, 0.46), F(0.9, 0.05, 0.9), F(1.5, 0.03, 1.4), F(2.2, 0.03, 1.2)], r: 0.03, mat: pal.black, seg: 5, segs: 14, cast: false }); col(F, -0.9, 0.9, 0, 1.15, -0.5, 0.5, yaw, 'metal'); };
  /** horizontal steel fuel tank on saddles */
  R.tank = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), r = o.r ?? 0.9, L = o.len ?? 3.6;
    for (const u of [-L * 0.32, L * 0.32]) bx(F, yaw, u - 0.15, u + 0.15, 0, r * 0.7, -r * 0.85, r * 0.85, pal.conc, { bevel: 0.03 }); cyU(F, yaw, 0, r + 0.15, 0, r, L, o.mat || pal.iron, 20); for (const u of [-L / 2 + 0.05, L / 2 - 0.05]) cyU(F, yaw, u, r + 0.15, 0, r + 0.02, 0.08, pal.iron, 20, { cast: false });
    B.cyl({ p: F(0, r * 2 + 0.12, 0), r: 0.22, h: 0.18, seg: 10, mat: pal.steel, cast: false }); B.cyl({ p: F(L * 0.3, r * 2 + 0.12, 0), r: 0.07, h: 0.2, seg: 8, mat: pal.steel, cast: false }); bx(F, yaw, -0.05, 0.05, 0.3, r * 1.6, r + 0.02, r + 0.12, pal.steel, { bevel: 0.01, cast: false }); col(F, -L / 2, L / 2, 0, r * 2 + 0.2, -r, r, yaw, 'metal'); };
  /** cable drum (wooden reel with wound cable) */
  R.reel = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), r = o.r ?? 0.6; cyV(F, yaw, 0, r, 0, r, 0.06, pal.wood, 16); cyV(F, yaw, 0, r, 0.42, r, 0.06, pal.wood, 16); cyV(F, yaw, 0, r, 0.21, r * 0.55, 0.38, pal.black, 14); cyV(F, yaw, 0, r, 0.21, 0.07, 0.5, pal.steel, 8, { cast: false }); };
  // ------------------------------------------------------------------ fishing / harbour
  /** stack of slatted lobster/crab pots (net-covered frames) */
  R.pots = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), n = o.n ?? 6, netM = o.net || pal.net;
    for (let i = 0; i < n; i++) { const lvl = Math.floor(i / 3), k = i % 3, u = (k - 1) * 0.95 + (lvl % 2) * 0.2, w0 = lvl * 0.52; bx(F, yaw + (rng() - 0.5) * 0.08, u - 0.45, u + 0.45, w0, w0 + 0.5, -0.32, 0.32, netM || pal.wood, { bevel: 0.03 });
      for (const uu of [-0.45, 0.45]) for (const vv of [-0.32, 0.32]) bx(F, yaw, u + uu - 0.02, u + uu + 0.02, w0, w0 + 0.5, vv - 0.02, vv + 0.02, pal.wood, { bevel: 0.005, cast: false }); bx(F, yaw, u - 0.45, u + 0.45, w0 + 0.48, w0 + 0.52, -0.32, 0.32, pal.wood, { bevel: 0.005, cast: false }); }
    col(F, -1.5, 1.5, 0, Math.ceil(n / 3) * 0.52, -0.34, 0.34, yaw, 'wood'); };
  /** insulated ice / fish bin (white plastic, hinged lid) */
  R.iceBin = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw); bx(F, yaw, -0.6, 0.6, 0, 0.75, -0.4, 0.4, o.blue ? plasticBlue : plastic, { bevel: 0.05 }); bx(F, yaw, -0.62, 0.62, 0.75, 0.82, -0.42, 0.42, o.blue ? plasticBlue : plastic, { bevel: 0.03 }); bx(F, yaw, -0.3, 0.3, 0.82, 0.86, -0.06, 0.06, pal.black, { bevel: 0.01, cast: false }); col(F, -0.6, 0.6, 0, 0.85, -0.4, 0.4, yaw, 'plastic'); };
  /** small boat on a road trailer (dinghy hull from the caller's makeBoat is added separately) */
  R.trailer = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), L = o.len ?? 4.6;
    bx(F, yaw, -L / 2, L / 2, 0.42, 0.5, -0.5, 0.5, pal.iron, { bevel: 0.02 }); B.beam(F(L / 2, 0.46, -0.4), F(L / 2 + 1.5, 0.5, 0), 0.06, 0.07, { mat: pal.iron, bevel: 0, cast: false }); B.beam(F(L / 2, 0.46, 0.4), F(L / 2 + 1.5, 0.5, 0), 0.06, 0.07, { mat: pal.iron, bevel: 0, cast: false });
    for (const v of [-0.62, 0.62]) { cyV(F, yaw, -0.4, 0.34, v, 0.34, 0.14, pal.tyre, 14); bx(F, yaw, -0.9, 0.1, 0.4, 0.46, v - 0.04, v + 0.04, pal.iron, { bevel: 0.01, cast: false }); } cyV(F, yaw, L / 2 + 1.5, 0.12, 0, 0.12, 0.08, pal.tyre, 8);
    for (const u of [-1.2, 0, 1.2]) bx(F, yaw, u - 0.12, u + 0.12, 0.5, 0.62, -0.4, 0.4, pal.wood, { bevel: 0.01, cast: false }); };
  /** cargo net heap + hawser coils (soft mound with net texture) */
  R.netHeap = (x, z, o = {}) => { const y = o.y ?? y0; B.rock({ p: [x, y + 0.2, z], r: o.r ?? 0.9, squash: [1.3, 0.55, 1.0], amp: 0.25, seed: Math.floor(x * 7 + z * 3) & 255, detail: 2, mat: o.net || pal.net || pal.rope, col: false, cast: true }); };
  /** stone-faced oil drum rack: 3 x 2 drums lying on a timber cradle */
  R.drumRack = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw); for (const u of [-1.0, 1.0]) bx(F, yaw, u - 0.1, u + 0.1, 0, 0.16, -0.95, 0.95, pal.wood, { bevel: 0.01, cast: false });
    for (let i = 0; i < 3; i++) for (let l = 0; l < 2 - (i === 2 ? 1 : 0); l++) cyU(F, yaw, 0, 0.16 + 0.29 + l * 0.5, -0.6 + i * 0.6 + l * 0.3, 0.29, 1.5, i % 2 ? pal.rust : (o.mat || pal.iron), 12); col(F, -0.8, 0.8, 0, 1.1, -0.95, 0.95, yaw, 'metal'); };
  // ------------------------------------------------------------------ vehicles (prison yard)
  const vpaint = (n, c1, c2 = 0x101010, metal = 0.4) => B.m(n, { pattern: 'plates', size: 256, tile: 2, colors: [c1, c1, c2], params: { cols: 5, rows: 2, seam: 0.004, rivets: 2, brushed: 0.15, panelVar: 0.12 }, bump: 1, metal, rough: [0.3, 0.62], layers: { grime: 0.6, rust: 0.12, scratch: 0.45, streak: 0.7, edge: 0.3 } }, { wet: true });
  /** prisoner transport bus (barred windows, grey-green lower, cream upper, roof vents). Long axis = local u. */
  R.bus = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), lo = vpaint('pr_busLo', o.lo ?? 0x3a4a44), up = vpaint('pr_busUp', o.up ?? 0xb6b8ac, 0x201c18, 0.2), L = 4.8, Wd = 1.25;
    bx(F, yaw, -L, L, 0.5, 1.55, -Wd, Wd, lo, { bevel: 0.05 }); bx(F, yaw, -L, L, 1.55, 2.75, -Wd + 0.02, Wd - 0.02, up, { bevel: 0.05 }); bx(F, yaw, -L - 0.05, L + 0.05, 2.75, 2.85, -Wd - 0.02, Wd + 0.02, up, { bevel: 0.04 });
    bx(F, yaw, -L, L, 0.36, 0.5, -Wd + 0.1, Wd - 0.1, pal.black, { bevel: 0.02, cast: false }); bx(F, yaw, L - 0.02, L + 0.2, 0.34, 0.62, -Wd, Wd, pal.steel, { bevel: 0.04 }); bx(F, yaw, -L - 0.2, -L + 0.02, 0.34, 0.62, -Wd, Wd, pal.steel, { bevel: 0.04 });
    // windows: dark glass + steel bars on both sides, windshield at the front (+u)
    for (const sd of [-1, 1]) { const v0 = sd * (Wd - 0.005); for (let i = 0; i < 7; i++) { const u = -L + 0.7 + i * 1.28; bx(F, yaw, u - 0.5, u + 0.5, 1.75, 2.5, v0 - 0.02, v0 + 0.02, glass, { bevel: 0, cast: false }); for (let k = 0; k < 5; k++) bx(F, yaw, u - 0.42 + k * 0.21 - 0.012, u - 0.42 + k * 0.21 + 0.012, 1.72, 2.52, v0 + sd * 0.02 - 0.012, v0 + sd * 0.02 + 0.012, pal.steel, { bevel: 0, cast: false }); } }
    bx(F, yaw, L - 0.04, L + 0.04, 1.7, 2.6, -Wd + 0.15, Wd - 0.15, glass, { bevel: 0, cast: false }); bx(F, yaw, -L - 0.04, -L + 0.04, 1.9, 2.5, -0.7, 0.7, glass, { bevel: 0, cast: false });
    for (const sd of [-1, 1]) { bx(F, yaw, L - 0.06, L + 0.08, 0.9, 1.1, sd * 0.85 - 0.16, sd * 0.85 + 0.16, o.on ? pal.lit : glass, { bevel: 0.01, cast: false }); bx(F, yaw, -L - 0.06, -L + 0.02, 0.9, 1.05, sd * 0.85 - 0.14, sd * 0.85 + 0.14, o.brake || pal.rust, { bevel: 0.01, cast: false }); }
    for (let i = 0; i < 9; i++) bx(F, yaw, L + 0.04, L + 0.08, 0.95 + i * 0.045, 0.975 + i * 0.045, -0.5, 0.5, pal.black, { bevel: 0, cast: false });
    // wheels (front pair + rear duals), arches, roof gear
    for (const [u, dual] of [[3.3, false], [-2.7, true], [-1.7, true]]) for (const sd of [-1, 1]) { cyV(F, yaw, u, 0.5, sd * (Wd - 0.06), 0.5, 0.3, pal.tyre, 16); cyV(F, yaw, u, 0.5, sd * (Wd + 0.02), 0.28, 0.06, pal.steel, 10, { cast: false }); }
    bx(F, yaw, -2.2, -0.6, 2.85, 3.15, -0.8, 0.8, pal.steel, { bevel: 0.05 }); for (let i = 0; i < 3; i++) bx(F, yaw, 1.4 + i * 0.7, 1.9 + i * 0.7, 2.85, 2.98, -0.5, 0.5, pal.steel, { bevel: 0.03, cast: false });
    bx(F, yaw, L - 0.6, L - 0.1, 2.85, 2.95, -0.9, 0.9, pal.black, { bevel: 0.02, cast: false }); if (o.beacon) { K.glare(F(L - 0.4, 3.02, -0.6), 0xff2020, 0.3, 0.9, { blink: [0.5, 0.5, 0], refl: 2, mist: 1 }); K.glare(F(L - 0.4, 3.02, 0.6), 0x2040ff, 0.3, 0.9, { blink: [0.5, 0.5, 0.25], refl: 2, mist: 1 }); }
    bx(F, yaw, -L, L, 1.55, 1.66, -Wd - 0.01, Wd + 0.01, o.stripe || pal.rust, { bevel: 0, cast: false }); col(F, -L - 0.2, L + 0.2, 0, 3.2, -Wd, Wd, yaw, 'metal'); };
  /** patrol jeep (olive, roll bar with light bar, spare wheel) */
  R.jeep = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), b = vpaint('pr_jeep', o.paint ?? 0x4a5a3e, 0x101010, 0.3);
    bx(F, yaw, -1.9, 1.9, 0.42, 1.0, -0.86, 0.86, b, { bevel: 0.05 }); bx(F, yaw, 0.3, 1.9, 1.0, 1.12, -0.82, 0.82, b, { bevel: 0.04 }); bx(F, yaw, -1.2, 0.35, 1.0, 1.85, -0.84, 0.84, b, { bevel: 0.05 }); bx(F, yaw, -1.5, -1.2, 1.0, 1.4, -0.84, 0.84, b, { bevel: 0.03 });
    bx(F, yaw, 0.28, 0.4, 1.05, 1.8, -0.8, 0.8, glass, { bevel: 0, cast: false }); bx(F, yaw, -1.18, 0.27, 1.5, 1.8, -0.86, 0.86, glass, { bevel: 0, cast: false }); bx(F, yaw, -1.2, 0.36, 1.85, 1.92, -0.86, 0.86, b, { bevel: 0.03 });
    for (const sd of [-1, 1]) { bx(F, yaw, 1.86, 1.98, 0.65, 0.85, sd * 0.55 - 0.14, sd * 0.55 + 0.14, o.on ? pal.lit : glass, { bevel: 0.01, cast: false }); for (const u of [-1.25, 1.2]) cyV(F, yaw, u, 0.4, sd * 0.9, 0.4, 0.26, pal.tyre, 14); }
    bx(F, yaw, 1.9, 2.05, 0.4, 0.55, -0.86, 0.86, pal.steel, { bevel: 0.03 }); cyV(F, yaw, -1.98, 0.75, 0, 0.36, 0.2, pal.tyre, 14); bx(F, yaw, -0.5, 0.05, 1.92, 2.02, -0.6, 0.6, pal.black, { bevel: 0.02, cast: false });
    if (o.beacon) { K.glare(F(-0.2, 2.1, -0.35), 0xff2020, 0.25, 0.9, { blink: [0.6, 0.5, 0], refl: 2, mist: 1 }); K.glare(F(-0.2, 2.1, 0.35), 0x2040ff, 0.25, 0.9, { blink: [0.6, 0.5, 0.3], refl: 2, mist: 1 }); } col(F, -2.1, 2.1, 0, 2.05, -0.9, 0.9, yaw, 'metal'); };
  /** run of steel lockers */
  R.lockers = (x, z, yaw = 0, o = {}) => { const y = o.y ?? y0, F = frame(x, y, z, yaw), n = o.n ?? 4, m = o.mat || vpaint('pr_locker', 0x4a5a6a, 0x101418, 0.5);
    for (let i = 0; i < n; i++) { const u = (i - (n - 1) / 2) * 0.4; bx(F, yaw, u - 0.19, u + 0.19, 0, 1.9, -0.25, 0.25, m, { bevel: 0.012 }); bx(F, yaw, u - 0.12, u + 0.12, 1.5, 1.62, 0.25, 0.262, pal.black, { bevel: 0, cast: false }); bx(F, yaw, u + 0.11, u + 0.14, 1.0, 1.25, 0.25, 0.27, pal.steel, { bevel: 0, cast: false }); }
    col(F, -n * 0.2, n * 0.2, 0, 1.9, -0.25, 0.25, yaw, 'metal'); };
  return R;
}
