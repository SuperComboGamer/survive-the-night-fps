// AFTER HOURS — Space-Age Land: the 30 m rocket, gantry, saucer restaurant and terrazzo as real construction.
// References (1960s Atlas / Redstone-class display rockets): hull skin panels ~1.2 x 1.5 m with 6 mm overlap, rivet pitch 8 cm at seams, access hatch 0.6 x 0.9 m with 4 hinges + wheel latch,
// engine bell ring stiffeners every 0.3 m, umbilical hoses 6 cm dia; saucer underside radial ribs every 10 degrees; terrazzo brass divider strips 6 mm wide.
import * as THREE from 'three';
import { makeRng } from '../../core/util.js';
import { pipe, torus, geo, TAU, PI } from './common.js';

export function rocketReal(B, K) {
  const { fibre, steelW, chrome, iron } = K, rng = makeRng(2024), R0 = 2.33;
  const rv = geo('rivet', () => new THREE.SphereGeometry(0.032, 4, 3));
  const radAt = (y) => (y < 21.5 ? 2.32 - Math.max(0, y - 17) * 0.0044 : 2.30 - (y - 21.5) * 0.1176);
  const plate = (a, y, h, w, m) => { const R = radAt(y + h / 2) + 0.008 + rng() * 0.006; B.box({ p: [Math.cos(a) * R, y + h / 2, Math.sin(a) * R], s: [w, h, 0.02], yaw: PI / 2 - a, mat: m, anchor: 'center', bevel: 0, cast: false });
    for (const [dy, du] of [[0.06, 0.06], [0.06, -0.06], [h - 0.06, 0.06], [h - 0.06, -0.06]]) { const ang = a + (du > 0 ? 1 : -1) * (w / 2 - 0.06) / R; B.instance('rivet', rv, chrome, B.matrix([Math.cos(ang) * (R + 0.012), y + dy, Math.sin(ang) * (R + 0.012)]), null, { cast: false }); } };
  for (const [y0, rows, hh] of [[4.7, 6, 1.5], [17.25, 3, 1.5]]) for (let r = 0; r < rows; r++) for (let k = 0; k < 12; k++) { const a = (k + (r % 2) * 0.5) / 12 * TAU, y = y0 + r * (hh + 0.06); plate(a, y, hh, 1.15, (k + r) % 5 === 0 ? steelW : fibre); }
  for (const [a, y] of [[0.5, 8.6], [2.6, 11.7], [4.4, 7.4], [5.6, 12.2]]) {   // access hatches: frame, door, wheel latch, hinges
    const R = R0 + 0.03, cx = Math.cos(a) * R, cz = Math.sin(a) * R, yaw = PI / 2 - a, tx = Math.cos(a + PI / 2), tz = Math.sin(a + PI / 2);
    for (const [dx, dy, sx, sy] of [[0, 0.5, 0.7, 0.07], [0, -0.5, 0.7, 0.07], [0.32, 0, 0.07, 1.0], [-0.32, 0, 0.07, 1.0]]) B.box({ p: [cx + tx * dx, y + dy, cz + tz * dx], s: [sx, sy, 0.05], yaw, mat: steelW, anchor: 'center', bevel: 0, cast: false });
    B.box({ p: [cx, y, cz], s: [0.58, 0.9, 0.03], yaw, mat: chrome, anchor: 'center', bevel: 0, cast: false }); torus(B, { p: [cx + Math.cos(a) * 0.04, y, cz + Math.sin(a) * 0.04], R: 0.1, r: 0.014, seg: 4, tube: 12, yaw: yaw, pitch: PI / 2, mat: iron, cast: false });
    for (const dy of [-0.35, 0.35]) B.cyl({ p: [cx + tx * 0.34, y + dy, cz + tz * 0.34], r: 0.03, h: 0.12, seg: 6, mat: iron, cast: false });
  }
  for (let i = 0; i < 4; i++) { const b = i * PI / 2, bx = Math.cos(b) * 1.15, bz = Math.sin(b) * 1.15;   // engine bells: stiffener rings, exit lip, throat glow ring
    for (let k = 0; k < 5; k++) { const y = 1.6 + k * 0.28, r = 0.8 - 0.233 * (y - 1.45); torus(B, { p: [bx, y, bz], R: r + 0.012, r: 0.022, seg: 4, tube: 20, mat: chrome, cast: false }); }
    torus(B, { p: [bx, 1.46, bz], R: 0.8, r: 0.05, seg: 5, tube: 24, mat: chrome, cast: false }); }
  for (const [x, y, ay] of [[0.35, 11.4, -3.3], [-0.35, 11.4, -3.3], [0.35, 19.9, -3.3], [-0.35, 19.9, -3.3]]) B.cable([x, y + 0.15, -3.5], [x * 1.5, y - 1.1, -2.34], 0.5, 0.055, iron, { n: 10, seg: 5 });   // umbilical hoses from the swing arms
}

export function saucerReal(B, K, SX, SY, SZ) {
  const { chrome, steelW } = K, prof = [[3.0, -0.35], [7.0, 0.15], [10.4, 1.1], [11.2, 1.55], [11.4, 1.85]];
  for (let k = 0; k < 40; k++) { const a = k / 40 * TAU; let prev = [0.6, -0.25]; for (const p of prof) { pipe(B, [SX + Math.cos(a) * prev[0], SY + prev[1] - 0.03, SZ + Math.sin(a) * prev[0]], [SX + Math.cos(a) * p[0], SY + p[1] - 0.03, SZ + Math.sin(a) * p[0]], 0.04, steelW, { seg: 4, cast: false }); prev = p; } }
  for (const [r, y] of [[3.0, -0.36], [7.0, 0.14], [10.4, 1.09]]) torus(B, { p: [SX, SY + y - 0.02, SZ], R: r, r: 0.06, seg: 5, tube: 72, mat: chrome, cast: false });
}

export function inlays(B, K) {
  const { brass } = K; for (const R of [28.6, 30.2, 44, 46.4, 60]) torus(B, { p: [0, 0.008, 0], R, r: 0.012, seg: 4, tube: Math.max(96, Math.round(R * 4)), mat: brass, cast: false });
  for (let k = 0; k < 24; k++) { const a = k / 24 * TAU; const r0 = 28.6, r1 = 46.4; pipe(B, [Math.cos(a) * r0, 0.008, Math.sin(a) * r0], [Math.cos(a) * r1, 0.008, Math.sin(a) * r1], 0.010, brass, { seg: 4, cast: false }); }
}
