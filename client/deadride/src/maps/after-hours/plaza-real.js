// AFTER HOURS — Entrance Plaza: real architecture and street furniture as GEOMETRY (Victorian / Edwardian Main Street reference sizes):
//   storey heights 3.1 m, window opening 1.3 x 1.9 m with 12 cm architrave, sill 14 cm proud, louvered shutter leaves 0.42 m wide with 8-10 slats at ~35 degrees,
//   pilaster 0.4-0.5 m wide with base / reeding / capital, crown cornice ~0.6 m deep, balustrade 0.7 m with turned balusters at 0.2 m centres, downpipe 9 cm dia with collars every 1.3 m,
//   gas lamp: 4.2 m fluted column, 4.7 m lantern centre, hexagonal glazed lantern 0.34 m; cast-iron bench 1.7 m with 4 seat + 3 back slats; fountain coping 16 cm thick stone blocks.
// Everything goes through the Builder into the plaza's EXISTING materials (no new draws).
import * as THREE from 'three';
import { makeRng } from '../../core/util.js';
import { toRaw } from '../../core/build.js';
import { extrudeXY, pipe, torus, TAU, PI } from './common.js';
import { ashlarRing } from './real.js';

const rawC = new Map();
const rawOf = (k, mk) => { let r = rawC.get(k); if (!r) { const g = mk(); r = toRaw(g, 'box'); g.dispose(); rawC.set(k, r); } return r; };
const lathePts = (a) => a.map(([r, y]) => new THREE.Vector2(r, y));
const BALUSTER = [[0.03, 0], [0.055, 0.05], [0.032, 0.14], [0.06, 0.28], [0.03, 0.42], [0.052, 0.53], [0.02, 0.58]];   // 7 profile points: still reads as a turned baluster from the street
const CRAFT = [[0, 0], [0.1, 0], [0.1, 0.06], [0.22, 0.06], [0.22, 0.12], [0.34, 0.14], [0.46, 0.2], [0.54, 0.3], [0.56, 0.4], [0.6, 0.4], [0.6, 0.46], [0, 0.46]];   // crown moulding (out, up)
const CSMALL = [[0, 0], [0.08, 0], [0.08, 0.05], [0.17, 0.05], [0.17, 0.1], [0.22, 0.14], [0.26, 0.2], [0.26, 0.26], [0, 0.26]];

/** shutter leaf: stiles, rails, mid rail and 9 louver slats tilted 35 degrees (outer edge down) */
function shutter(B, X, s, m, y, z, w = 0.42, h = 1.9) {
  const bx = (d, yy, zz, sd, sy, sz, e = {}) => B.box({ p: [X(d), yy, zz], s: [sd, sy, sz], mat: m, anchor: 'center', bevel: 0, cast: false, ...e });
  for (const dz of [-1, 1]) bx(0.02, y + h / 2, z + dz * (w / 2 - 0.02), 0.05, h, 0.04);
  for (const yy of [y + 0.03, y + h / 2, y + h - 0.03]) bx(0.02, yy, z, 0.05, 0.06, w);
  for (let i = 0; i < 9; i++) bx(0.03, y + 0.16 + i * ((h - 0.32) / 8), z, 0.05, 0.016, w - 0.07, { roll: s * 0.6 });
}

/** everything that turns a flat shop-front box into architecture. o: { xF, s, zc, ww, wwin, H, roof } K: materials */
export function facadeDetail(B, K, o) {
  const { xF, s, zc, ww, wwin, H, roof } = o, { trim, concrete, iron, gold } = K, rng = makeRng(Math.floor(zc * 131 + s * 17 + 7)), X = (d) => xF - s * d, yaw = s > 0 ? PI : 0;
  const bx = (d, y, z, sd, sy, sz, m = trim, e = {}) => B.box({ p: [X(d), y, z], s: [sd, sy, sz], mat: m, anchor: 'center', bevel: 0, cast: false, ...e });
  // pilasters: plinth block, reeding, echinus + abacus capital, and a console under the fascia
  for (const z of [zc - ww / 2 + 0.25, zc + ww / 2 - 0.25, zc - 0.6 - (ww - 5.4) / 2 - 0.15]) {
    bx(0.24, 1.1, z, 0.5, 0.3, 0.58); bx(0.22, 1.3, z, 0.44, 0.06, 0.52); const top = 0.95 + H - 1.6;
    bx(0.25, top - 0.1, z, 0.46, 0.12, 0.54); bx(0.29, top + 0.02, z, 0.52, 0.12, 0.62); bx(0.3, top + 0.1, z, 0.58, 0.06, 0.68);
    for (const dz of [-0.14, 0, 0.14]) bx(0.21, 1.3 + (H - 3.2) / 2 + 0.5, z + dz, 0.03, H - 3.2, 0.05);
    bx(0.2, 4.5, z, 0.3, 0.34, 0.18); bx(0.28, 4.32, z, 0.18, 0.12, 0.14);
  }
  // fascia cornice + stallriser panels under the shop window
  extrudeXY(B, { p: [xF, 4.66, zc], yaw, pts: CSMALL, depth: ww, mat: trim, cast: false });
  for (let z = zc - 0.6 - wwin / 2 + 0.6; z < zc - 0.6 + wwin / 2 - 0.4; z += 1.15) { bx(0.13, 0.5, z, 0.05, 0.62, 0.98); bx(0.15, 0.5, z, 0.025, 0.4, 0.78); }
  // upper storeys: architraves, lintels with keystones, sill brackets, louvered shutters, string course between floors
  const floors = H > 10.5 ? 2 : 1, nw = Math.max(2, Math.floor((ww - 1.5) / 3.3));
  for (let f = 0; f < floors; f++) { const y0 = 5.4 + f * 3.1;
    for (let i = 0; i < nw; i++) { const z = zc - ww / 2 + (i + 0.5) * ww / nw;
      for (const dz of [-1, 1]) bx(0.085, y0 + 1.05, z + dz * 0.91, 0.1, 2.2, 0.16); bx(0.1, y0 + 2.14, z, 0.12, 0.16, 2.12); bx(0.13, y0 + 2.2, z, 0.14, 0.3, 0.24, concrete);
      for (const dz of [-0.62, 0.62]) { bx(0.17, y0 - 0.3, z + dz, 0.12, 0.2, 0.12); bx(0.21, y0 - 0.2, z + dz, 0.06, 0.1, 0.1); }
      for (let k = 0; k < 5; k++) for (const dz of [-1, 1]) bx(0.09, y0 + 0.2 + k * 0.42, z + dz * 1.0, 0.06 + (k % 2) * 0.05, 0.4, 0.2 + (k % 2) * 0.06, concrete);   // quoin blocks either side
      if (rng() < 0.5) for (const dz of [-1, 1]) shutter(B, X, s, K.shut, y0 + 0.05, z + dz * 1.32);
      if (f === 1 && i % 2 === 0) { const wb = 1.9;   // wrought-iron balcony: slab, brackets, rails, 13 balusters, scroll
        bx(0.36, y0 - 0.05, z, 0.62, 0.1, wb, concrete); for (const dz of [-0.7, 0.7]) bx(0.3, y0 - 0.3, z + dz, 0.4, 0.3, 0.1, concrete);
        bx(0.62, y0 + 0.95, z, 0.03, 0.04, wb, iron); bx(0.62, y0 + 0.1, z, 0.03, 0.04, wb, iron); for (const dz of [-1, 1]) bx(0.3, y0 + 0.52, z + dz * (wb / 2 - 0.02), 0.6, 0.04, 0.04, iron, { yaw: 0 });
        for (let k = 0; k < 13; k++) bx(0.62, y0 + 0.52, z - wb / 2 + 0.08 + k * (wb - 0.16) / 12, 0.02, 0.85, 0.02, iron);
        torus(B, { p: [X(0.62), y0 + 0.52, z], R: 0.22, r: 0.012, seg: 4, tube: 14, yaw: -s * PI / 2, mat: iron, cast: false }); }
    } if (f === 0 && floors === 2) bx(0.1, y0 + 2.9 + 0.55, zc, 0.2, 0.22, ww); }
  // roofline: crown moulding, then a turned-baluster parapet on flat roofs
  extrudeXY(B, { p: [xF, H - 0.05, zc], yaw, pts: CRAFT, depth: ww + 0.2, mat: trim, cast: false });
  for (let z = zc - ww / 2 + 0.5; z < zc + ww / 2; z += 1.3) { bx(0.32, H - 0.55, z, 0.3, 0.36, 0.16); bx(0.42, H - 0.34, z, 0.2, 0.14, 0.14); }   // cornice brackets
  if (roof === 'flat') {
    const y = H + 0.4; bx(0.3, y + 0.05, zc, 0.36, 0.1, ww + 0.1); bx(0.3, y + 0.75, zc, 0.3, 0.09, ww + 0.1);
    const bal = rawOf('baluster', () => new THREE.LatheGeometry(lathePts(BALUSTER), 6)); for (let z = zc - ww / 2 + 0.2; z < zc + ww / 2 - 0.1; z += 0.27) B.addRaw(bal, B.matrix([X(0.3), y + 0.1, z]), trim, { cast: false });
    for (let z = zc - ww / 2 + 0.15; z <= zc + ww / 2; z += 2.9) { bx(0.3, y + 0.42, z, 0.3, 0.84, 0.3); bx(0.3, y + 0.9, z, 0.38, 0.1, 0.38); B.sphere({ p: [X(0.3), y + 1.12, z], r: 0.17, seg: 8, mat: concrete, cast: false }); }
  }
  // downpipes with collars and a hopper head
  for (const z of [zc - ww / 2 + 0.75, zc + ww / 2 - 0.75]) { pipe(B, [X(0.12), 0.2, z], [X(0.12), H - 0.9, z], 0.045, iron, { seg: 8, cast: false }); bx(0.14, H - 0.75, z, 0.22, 0.26, 0.26, iron);
    for (let y = 1.0; y < H - 1; y += 1.3) B.cyl({ p: [X(0.12), y, z], r: 0.065, h: 0.05, seg: 8, mat: iron, cast: false }); bx(0.2, 0.12, z, 0.16, 0.2, 0.14, iron); }
}

/** gas lamp: fluted cast-iron column on a moulded plinth, ladder bar, two scrolled arms with hexagonal glazed lanterns, roofs and finials. lantern centres at (x +- 0.5, 4.72). */
export function lampPost(B, K, x, z, lit) {
  const { iron, gold, lampOn, lampOff } = K, glass = lit ? lampOn : lampOff;
  B.lathe({ p: [x, 0, z], profile: [[0, 0], [0.34, 0], [0.34, 0.1], [0.3, 0.14], [0.3, 0.22], [0.24, 0.3], [0.2, 0.36], [0.2, 0.6], [0.16, 0.7], [0.155, 0.76], [0.2, 0.8], [0.2, 0.86], [0.15, 0.9], [0.11, 0.96], [0.1, 1.1]], seg: 12, mat: iron, col: 'metal' });
  B.lathe({ p: [x, 1.1, z], profile: [[0.1, 0], [0.086, 1.2], [0.076, 3.05]], seg: 10, mat: iron, cast: true });
  for (const [y, R] of [[1.55, 0.095], [2.75, 0.085], [3.9, 0.082]]) torus(B, { p: [x, y, z], R, r: 0.022, seg: 5, tube: 12, mat: gold, cast: false });
  B.box({ p: [x, 3.75, z], s: [0.56, 0.03, 0.03], mat: iron, anchor: 'center', cast: false });
  B.cyl({ p: [x, 4.12, z], r: [0.1, 0.16], h: 0.12, seg: 10, mat: iron, cast: false });
  for (const sx of [-1, 1]) { const hx = x + sx * 0.5;
    pipe(B, [x, 4.15, z], [x + sx * 0.28, 4.3, z], 0.032, iron, { seg: 6, cast: false }); pipe(B, [x + sx * 0.28, 4.3, z], [hx, 4.34, z], 0.028, iron, { seg: 6, cast: false });
    torus(B, { p: [x + sx * 0.3, 4.22, z], R: 0.13, r: 0.014, seg: 4, tube: 12, arc: PI * 1.3, yaw: 0, pitch: 0, roll: sx > 0 ? PI * 0.6 : PI * 1.9, mat: iron, cast: false });
    B.cyl({ p: [hx, 4.34, z], r: [0.15, 0.19], h: 0.08, seg: 6, mat: iron, cast: false });
    B.cyl({ p: [hx, 4.42, z], r: 0.16, h: 0.5, seg: 6, mat: glass, cast: false });
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + PI / 6; B.box({ p: [hx + Math.cos(a) * 0.165, 4.66, z + Math.sin(a) * 0.165], s: [0.024, 0.52, 0.024], yaw: -a, mat: iron, anchor: 'center', cast: false }); }
    B.lathe({ p: [hx, 4.9, z], profile: [[0.26, 0], [0.22, 0.05], [0.14, 0.12], [0.05, 0.22], [0.0, 0.26]], seg: 6, mat: iron, cast: false }); B.sphere({ p: [hx, 5.2, z], r: 0.04, seg: 6, mat: gold, cast: false }); B.cyl({ p: [hx, 5.13, z], r: [0.03, 0.01], h: 0.1, seg: 5, mat: iron, cast: false });
  }
}

/** cast-iron park bench: scrolled ends, seat 4 slats, back 3 slats, arm rests, crossbars, bolt heads */
export function benchReal(B, K, x, z, yaw) {
  const { iron, wood } = K, c = Math.cos(yaw), sn = Math.sin(yaw);
  const L = (lx, y, lz, sx, sy, sz, m, e = {}) => B.box({ p: [x + lx * c + lz * sn, y, z - lx * sn + lz * c], s: [sx, sy, sz], yaw, mat: m, anchor: 'center', bevel: e.bevel ?? 0.008, cast: e.cast ?? true, pitch: e.pitch, roll: e.roll });
  for (let i = 0; i < 4; i++) L(0, 0.44, -0.2 + i * 0.13, 1.72, 0.04, 0.105, wood);
  for (let i = 0; i < 3; i++) L(0, 0.66 + i * 0.13, -0.3 - i * 0.02, 1.72, 0.1, 0.03, wood, { pitch: -0.2 });
  for (const e of [-0.78, 0.78]) {
    L(e, 0.22, 0.2, 0.05, 0.44, 0.07, iron, { cast: false }); L(e, 0.22, -0.2, 0.05, 0.44, 0.07, iron, { cast: false }); L(e, 0.42, 0.0, 0.05, 0.05, 0.5, iron, { cast: false });   // legs + seat rail
    L(e, 0.7, -0.3, 0.05, 0.6, 0.05, iron, { cast: false, pitch: -0.2 }); L(e, 0.66, 0.08, 0.05, 0.05, 0.5, iron, { cast: false });                                     // back leg + arm
    L(e, 0.05, 0.3, 0.07, 0.05, 0.14, iron, { cast: false }); L(e, 0.05, -0.28, 0.07, 0.05, 0.14, iron, { cast: false });                                             // feet
    const sxw = x + e * c + 0.0 * sn, szw = z - e * sn; torus(B, { p: [sxw + 0.0, 0.56, szw + 0.0], R: 0.09, r: 0.014, seg: 4, tube: 10, arc: PI * 1.5, yaw: yaw + PI / 2, pitch: 0, roll: 0, mat: iron, cast: false });
    for (const [lz, y] of [[0.2, 0.46], [-0.2, 0.46]]) L(e + Math.sign(e) * 0.03, y, lz, 0.02, 0.02, 0.02, iron, { cast: false });
  }
  for (const lx of [-0.55, 0, 0.55]) for (const lz of [-0.2, 0.18]) B.cyl({ p: [x + lx * c + lz * sn, 0.465, z - lx * sn + lz * c], r: 0.011, h: 0.012, seg: 5, mat: iron, cast: false });   // bolt heads
}

/** fountain dressing: coping blocks, raised wall panels, urn posts, scallop beads and water sheets; radius 6.0-6.75 basin wall (top y 0.72), upper bowl rim r 1.9 at y 2.4 */
export function fountainReal(B, K) {
  const { concrete, ring, trim, gold, fwater } = K, rng = makeRng(4242);
  ashlarRing(B, { c: [0, 0], r: 6.8, y0: 0.72, y1: 0.9, a0: 0, a1: TAU - 0.02, mat: concrete, rng, ch: [0.17, 0.17], bw: [0.9, 1.5], prot: 0, depth: 0.85, gap: 0.02 });
  for (let i = 0; i < 24; i++) { const a = i / 24 * TAU + 0.05, R = 6.62; B.box({ p: [Math.cos(a) * R, 0.36, Math.sin(a) * R], s: [1.35, 0.34, 0.04], yaw: PI / 2 - a, mat: trim, anchor: 'center', bevel: 0, cast: false }); }
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + 0.2, R = 7.0, px = Math.cos(a) * R, pz = Math.sin(a) * R; B.box({ p: [px, 0.3, pz], s: [0.5, 0.6, 0.5], yaw: PI / 2 - a, mat: concrete, anchor: 'center', bevel: 0.02, cast: true }); B.box({ p: [px, 0.66, pz], s: [0.6, 0.1, 0.6], yaw: PI / 2 - a, mat: concrete, anchor: 'center', cast: false }); B.lathe({ p: [px, 0.72, pz], profile: [[0.0, 0], [0.14, 0.02], [0.22, 0.2], [0.26, 0.36], [0.2, 0.55], [0.12, 0.62], [0.16, 0.66], [0.0, 0.7]], seg: 10, mat: gold, cast: false }); }
  for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; B.sphere({ p: [Math.cos(a) * 1.9, 2.42, Math.sin(a) * 1.9], r: 0.075, seg: 6, mat: gold, cast: false }); }
  for (let i = 0; i < 24; i++) { const a = i / 24 * TAU + 0.07; B.box({ p: [Math.cos(a) * 2.02, 1.75, Math.sin(a) * 2.02], s: [0.16, 1.32, 0.02], yaw: PI / 2 - a, mat: fwater, anchor: 'center', cast: false }); }   // water sheeting off the bowl
  torus(B, { p: [0, 0.5, 0], R: 2.6, r: 0.06, seg: 5, tube: 48, mat: gold, cast: false }); torus(B, { p: [0, 0.95, 0], R: 1.9, r: 0.05, seg: 5, tube: 40, mat: gold, cast: false }); torus(B, { p: [0, 0.72, 0], R: 6.05, r: 0.04, seg: 5, tube: 72, mat: gold, cast: false });
}

/** clock tower dressing (shaft 5.8 m square from y 1.2 to 17.1, belfry to 22.7): quoins, string courses, crown cornice with brackets, pinnacles */
export function clockTowerReal(B, K, TX, TZ) {
  const { concrete, trim, iron, gold } = K, rng = makeRng(77), bx = (x, y, z, sx, sy, sz, m = trim, e = {}) => B.box({ p: [x, y, z], s: [sx, sy, sz], mat: m, anchor: 'center', bevel: 0, cast: false, ...e });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let y = 1.6, k = 0; y < 16.7; y += 0.5, k++) { const l = k % 2 ? 0.95 : 0.55; bx(TX + sx * 2.9, y, TZ + sz * (2.9 - (l - 0.55) / 2 * 0 ) , 0.62, 0.46, 0.62, concrete); bx(TX + sx * (2.9 + 0.02), y, TZ + sz * (2.9 - 0.3), 0.66, 0.46, 0.5 + (k % 2) * 0.4, concrete); }
  for (const y of [5.0, 10.0, 15.6]) for (const [dx, dz, yw] of [[0, 2.9, 0], [0, -2.9, PI], [2.9, 0, PI / 2], [-2.9, 0, -PI / 2]]) extrudeXY(B, { p: [TX + dx, y, TZ + dz], yaw: yw === 0 ? -PI / 2 : yw === PI ? PI / 2 : yw === PI / 2 ? 0 : PI, pts: [[0, 0], [0.12, 0], [0.12, 0.06], [0.22, 0.06], [0.22, 0.14], [0, 0.2]], depth: 5.9, mat: trim, cast: false });
  for (const [dx, dz, yw] of [[0, 3.55, -PI / 2], [0, -3.55, PI / 2], [3.55, 0, 0], [-3.55, 0, PI]]) { extrudeXY(B, { p: [TX + dx, 17.35, TZ + dz], yaw: yw, pts: CRAFT, depth: 7.5, mat: trim, cast: false }); for (let t = -3.1; t <= 3.1; t += 0.8) bx(TX + dx + (dx ? Math.sign(dx) * 0.28 : t), 16.75, TZ + dz + (dz ? Math.sign(dz) * 0.28 : t), dx ? 0.3 : 0.24, 0.42, dx ? 0.24 : 0.3); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const x = TX + sx * 3.4, z = TZ + sz * 3.4; bx(x, 22.9, z, 0.6, 0.5, 0.6, concrete); B.lathe({ p: [x, 23.15, z], profile: [[0.24, 0], [0.16, 0.1], [0.12, 0.3], [0.2, 0.42], [0.1, 0.7], [0.0, 1.0]], seg: 8, mat: trim, cast: false }); B.sphere({ p: [x, 24.25, z], r: 0.07, seg: 6, mat: gold, cast: false }); }
}

/** street dressing: sandwich boards, queue stanchions with rope swags, bollards, newspaper stand */
export function streetKit(B, K, pts) {
  const { iron, gold, wood, board } = K;
  for (const [x, z, yaw, kind] of pts) { const c = Math.cos(yaw), sn = Math.sin(yaw), L = (lx, y, lz, sx, sy, sz, m, e = {}) => B.box({ p: [x + lx * c + lz * sn, y, z - lx * sn + lz * c], s: [sx, sy, sz], yaw, mat: m, anchor: 'center', bevel: 0.006, cast: false, ...e });
    if (kind === 'a') { for (const d of [-1, 1]) { L(0, 0.55, d * 0.17, 0.62, 1.1, 0.03, wood, { pitch: -d * 0.16 }); } L(0, 0.02, 0, 0.62, 0.04, 0.5, wood); L(0, 0.75, 0.2, 0.5, 0.6, 0.01, board, { pitch: -0.16 }); L(0, 0.18, 0.28, 0.5, 0.04, 0.05, wood); }
    else if (kind === 'p') { B.cyl({ p: [x, 0, z], r: [0.13, 0.11], h: 0.06, seg: 10, mat: iron, cast: false }); B.cyl({ p: [x, 0.06, z], r: 0.035, h: 0.9, seg: 8, mat: iron, cast: false }); B.sphere({ p: [x, 1.0, z], r: 0.06, seg: 8, mat: gold, cast: false }); }
    else if (kind === 'b') { B.lathe({ p: [x, 0, z], profile: [[0.0, 0], [0.18, 0], [0.19, 0.05], [0.15, 0.1], [0.14, 0.5], [0.16, 0.55], [0.14, 0.62], [0.0, 0.68]], seg: 12, mat: iron, col: 'metal', cast: true }); }
  }
}

/** lap (bevel) siding: 14 cm exposure boards, wedge profile 3.6 cm at the butt, run along the whole facade (behind the windows/pilasters, which stand proud of it) */
export function siding(B, { xF, s, zc, ww, H, mat, y0 = 1.0, open = [] }) {
  const yaw = s > 0 ? PI : 0, pts = [[0, 0], [0.036, 0], [0.028, 0.155], [0, 0.155]], zA = zc - ww / 2 + 0.06, zB = zc + ww / 2 - 0.06;
  for (let y = y0; y < H - 0.32; y += 0.14) {
    const cut = open.filter((o) => y + 0.155 > o.y0 - 0.02 && y < o.y1 + 0.02).sort((a, b) => a.z0 - b.z0); let z = zA;   // board runs between the openings that cross its height
    const seg = (a, b) => { if (b - a > 0.1) extrudeXY(B, { p: [xF, y, (a + b) / 2], yaw, pts, depth: b - a, mat, cast: false }); };
    for (const o of cut) { seg(z, Math.min(o.z0, zB)); z = Math.max(z, o.z1); } seg(z, zB);
  }
}

/** mascot statue dressing (statue base y0 = 3.0): glove fingers, seam rings, mounting bolts, bronze plaque, eye rims. The gloved arms end at (+-1.25, y0 + 2.5 / 1.8, 0.3) */
export function statueReal(B, K) {
  const { fibreW, fibreR, gold, iron } = K, y0 = 3.0;
  for (const [sx, gy] of [[1, 2.5], [-1, 1.8]]) { const hx = sx * 1.25, hy = y0 + gy, hz = 0.3; for (let f = 0; f < 4; f++) { const a = -0.55 + f * 0.37; pipe(B, [hx + Math.cos(a + 1.2) * 0.12, hy + 0.05, hz + 0.15], [hx + Math.cos(a + 1.2) * 0.3, hy + 0.05 + Math.sin(a) * 0.22, hz + 0.32 + Math.sin(f) * 0.05], 0.05, fibreW, { seg: 6, cast: false }); B.sphere({ p: [hx + Math.cos(a + 1.2) * 0.3, hy + 0.05 + Math.sin(a) * 0.22, hz + 0.32 + Math.sin(f) * 0.05], r: 0.055, seg: 6, mat: fibreW, cast: false }); }
    pipe(B, [hx - sx * 0.12, hy - 0.05, hz + 0.1], [hx - sx * 0.3, hy - 0.22, hz + 0.25], 0.055, fibreW, { seg: 6, cast: false }); torus(B, { p: [sx * 1.0, y0 + (sx > 0 ? 2.05 : 1.6), 0.28], R: 0.14, r: 0.028, seg: 5, tube: 14, pitch: PI / 2, roll: sx * 0.9, mat: fibreR, cast: false }); }   // cuffs
  for (const y of [y0 + 1.7, y0 + 0.45]) torus(B, { p: [0, y, 0], R: y > y0 + 1 ? 0.55 : 0.44, r: 0.02, seg: 4, tube: 32, mat: iron, cast: false });   // fibreglass mould seams
  torus(B, { p: [0, y0 + 2.7, 0], R: 0.93, r: 0.02, seg: 4, tube: 40, pitch: PI / 2, mat: iron, cast: false });
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; B.cyl({ p: [Math.cos(a) * 0.86, 2.7, Math.sin(a) * 0.86], r: 0.03, h: 0.03, seg: 6, mat: gold, cast: false }); }
  B.box({ p: [0, 2.55, 0.92], s: [0.7, 0.28, 0.03], mat: gold, anchor: 'center', bevel: 0.006, cast: false, pitch: -0.25 }); for (const dx of [-0.3, 0.3]) B.cyl({ p: [dx, 2.55, 0.94], r: 0.018, h: 0.02, seg: 6, mat: iron, cast: false, pitch: PI / 2 });
  for (const sx of [-1, 1]) torus(B, { p: [sx * 0.34, y0 + 2.9, 0.79], R: 0.29, r: 0.022, seg: 5, tube: 20, mat: fibreR, cast: false });   // eye rims
}

/** gate pier dressing: rusticated horizontal grooves every 0.5 m on all four faces + a crown cornice and stepped cap */
export function pierReal(B, K, x, GZ) {
  const { trim, concrete } = K;
  for (let y = 1.7; y < 12.2; y += 0.5) for (const [dx, dz, sx, sz] of [[0, 1.81, 3.62, 0.03], [0, -1.81, 3.62, 0.03], [1.81, 0, 0.03, 3.62], [-1.81, 0, 0.03, 3.62]]) B.box({ p: [x + dx, y, GZ + dz], s: [sx, 0.045, sz], mat: concrete, anchor: 'center', bevel: 0, cast: false });
  for (const [dx, dz, yw] of [[0, 2.4, -PI / 2], [0, -2.4, PI / 2], [2.4, 0, 0], [-2.4, 0, PI]]) extrudeXY(B, { p: [x + dx, 13.3, GZ + dz], yaw: yw, pts: CRAFT, depth: 4.9, mat: trim, cast: false });
}
