// Reusable real-scale props. Every function takes the Builder B (and materials by name/instance) and adds geometry + colliders.
import * as THREE from 'three';
import { boxRaw, toRaw } from './build.js';

/** 200 L / 55 gal oil drum: Ø0.58 m x 0.88 m with rolling hoops. p = base centre. */
export function oilDrum(B, p, { mat, yaw = 0, open = false, tilt = 0 } = {}) {
  const r = 0.29, h = 0.88, prof = [[0.0, 0], [r - 0.02, 0], [r, 0.02], [r, 0.09], [r - 0.012, 0.11], [r - 0.012, h * 0.3], [r, h * 0.33], [r - 0.012, h * 0.36], [r - 0.012, h * 0.62], [r, h * 0.65], [r - 0.012, h * 0.68], [r - 0.012, h - 0.11], [r, h - 0.09], [r, h - 0.02], [r - 0.02, h], [0.0, h]];
  B.lathe({ p, yaw, profile: prof, seg: 20, mat, col: 'metal', cast: true });
}
/** Wooden crate with corner battens. s = [w,h,d] */
export function crate(B, p, s = [0.8, 0.7, 0.8], { mat, batten, yaw = 0, col = 'wood' } = {}) {
  B.box({ p, s, yaw, mat, bevel: 0.012, col });
  const [w, h, d] = s; const c = Math.cos(yaw), sn = Math.sin(yaw); const bm = batten || mat; const t = 0.05;
  const put = (lx, ly, lz, sx, sy, sz) => B.box({ p: [p[0] + lx * c + lz * sn, p[1] + ly, p[2] - lx * sn + lz * c], s: [sx, sy, sz], yaw, mat: bm, bevel: 0.006, cast: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(sx * (w / 2 - t / 2), 0, sz * (d / 2 + 0.004), t, h, 0.014), put(sx * (w / 2 + 0.004), 0, sz * (d / 2 - t / 2), 0.014, h, t);
  put(0, h - 0.03, d / 2 + 0.004, w, 0.06, 0.014); put(0, 0, d / 2 + 0.004, w, 0.06, 0.014); put(0, h - 0.03, -d / 2 - 0.004, w, 0.06, 0.014); put(0, 0, -d / 2 - 0.004, w, 0.06, 0.014);
}
/** EUR-style pallet 1.2 x 0.8 x 0.144 */
export function pallet(B, p, { mat, yaw = 0 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw); const put = (lx, ly, lz, sx, sy, sz) => B.box({ p: [p[0] + lx * c + lz * s, p[1] + ly, p[2] - lx * s + lz * c], s: [sx, sy, sz], yaw, mat, bevel: 0.004, cast: true });
  for (const z of [-0.34, 0, 0.34]) put(0, 0, z, 1.2, 0.09, 0.1);
  for (const x of [-0.5, 0.5]) for (const z of [-0.34, 0, 0.34]) put(x, 0.0, z, 0.1, 0.09, 0.1);
  for (let i = 0; i < 5; i++) put(-0.5 + i * 0.25, 0.09, 0, 0.1, 0.022, 0.8);
  B.colliders.addBox({ x: p[0], y: p[1] + 0.07, z: p[2], hx: 0.6, hy: 0.07, hz: 0.4, yaw, surface: 'wood', walk: true });
}
/** Rail track between a and b (y = ground level). gauge m. Sleepers instanced via boxes. */
export function railTrack(B, a, b, { gauge = 0.61, sleeperMat, railMat, ballastMat, spacing = 0.65, railH = 0.07, ballastW = 1.5 } = {}) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  if (ballastMat) B.box({ p: [(a[0] + b[0]) / 2, a[1] - 0.02, (a[2] + b[2]) / 2], s: [L, 0.14, ballastW], yaw, mat: ballastMat, bevel: 0.04, cast: false, col: false });
  for (let s = 0.2; s < L; s += spacing) { const x = a[0] + ux * s, z = a[2] + uz * s; B.box({ p: [x, a[1] + 0.02, z], s: [0.12, 0.09, gauge + 0.35], yaw, mat: sleeperMat, bevel: 0.01, cast: false }); }
  for (const k of [-1, 1]) B.box({ p: [(a[0] + b[0]) / 2 + nx * k * gauge / 2, a[1] + 0.09, (a[2] + b[2]) / 2 + nz * k * gauge / 2], s: [L, railH, 0.045], yaw, mat: railMat, bevel: 0.01, cast: false });
}
/** Post-and-rail / picket fence along a→b. */
export function fenceLine(B, a, b, { height = 1.8, postEvery = 2.6, postMat, panelMat, wire = null, wireMat = null, col = 'wood', picket = true } = {}) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx); const n = Math.max(1, Math.round(L / postEvery)); const ux = dx / L, uz = dz / L;
  for (let i = 0; i <= n; i++) B.box({ p: [a[0] + ux * L * i / n, a[1], a[2] + uz * L * i / n], s: [0.14, height + 0.15, 0.14], mat: postMat, bevel: 0.015, col, walk: false });
  if (picket) { B.box({ p: [(a[0] + b[0]) / 2, a[1] + height * 0.28, (a[2] + b[2]) / 2 + 0.0], s: [L, 0.12, 0.035], yaw, mat: panelMat, bevel: 0.004, cast: true }); B.box({ p: [(a[0] + b[0]) / 2, a[1] + height * 0.78, (a[2] + b[2]) / 2], s: [L, 0.12, 0.035], yaw, mat: panelMat, bevel: 0.004, cast: true }); const np = Math.floor(L / 0.16); for (let i = 0; i < np; i++) { const t = (i + 0.5) / np; B.box({ p: [a[0] + dx * t, a[1], a[2] + dz * t], s: [0.014, height - (i % 3) * 0.04, 0.09], yaw, mat: panelMat, bevel: 0.002, cast: false }); } B.colliders.addBox({ x: (a[0] + b[0]) / 2, y: a[1] + height / 2, z: (a[2] + b[2]) / 2, hx: L / 2, hy: height / 2, hz: 0.05, yaw, surface: 'wood', walk: false }); }
  if (wire) for (let k = 0; k < wire; k++) { const y = a[1] + height + 0.1 + k * 0.12; B.cable([a[0], y, a[2]], [b[0], y, b[2]], 0.03, 0.006, wireMat, { n: 8, seg: 4, cast: false }); }
}
/** Ladder against a wall: base centre p, height h, facing yaw (rungs on +z local). */
export function ladder(B, p, h, { mat, yaw = 0, width = 0.46, rung = 0.3 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw); const put = (lx, ly, lz, sx, sy, sz) => B.box({ p: [p[0] + lx * c + lz * s, p[1] + ly, p[2] - lx * s + lz * c], s: [sx, sy, sz], yaw, mat, bevel: 0.004, cast: true });
  for (const k of [-1, 1]) put(k * width / 2, 0, 0, 0.045, h, 0.07);
  for (let y = 0.25; y < h - 0.1; y += rung) put(0, y, 0, width, 0.03, 0.035);
}
/** Pole lamp: post + arm + shade + halo + pooled light. ctx = stop ctx (for light()), halos = HaloBatch. Returns light source. */
export function lampPost(ctx, halos, p, { height = 5.5, mat, glowMat, color = 0xffb060, intensity = 220, distance = 22, flicker = 0.03, arm = 0.8, dir = [0, 0, 1], size = 0.9 } = {}) {
  const B = ctx.B; const yaw = Math.atan2(dir[0], dir[2]);
  B.cyl({ p, r: [0.1, 0.075], h: height, seg: 10, mat, col: 'wood' });
  const ax = p[0] + Math.sin(yaw) * arm, az = p[2] + Math.cos(yaw) * arm;
  B.beam([p[0], p[1] + height - 0.2, p[2]], [ax, p[1] + height + 0.05, az], 0.06, 0.06, { mat });
  B.cyl({ p: [ax, p[1] + height - 0.16, az], r: [0.28, 0.06], h: 0.16, seg: 12, mat, cast: false });
  B.sphere({ p: [ax, p[1] + height - 0.19, az], r: 0.085, mat: glowMat, cast: false, seg: 8 });
  if (halos) halos.add([ax, p[1] + height - 0.2, az], color, size, 1.0, flicker > 0 ? 6 : 0);
  return ctx.light({ pos: [ax, p[1] + height - 0.35, az], color, intensity, distance, decay: 2, flicker, kind: 'point' });
}
/** Lots of rolling-stock like tub: mine ore cart 1.2 x 0.9 x 0.7 on wheels. */
export function oreCart(B, p, { mat, wheelMat, yaw = 0, rustMat, load = null } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw); const put = (lx, ly, lz, sx, sy, sz, m = mat) => B.box({ p: [p[0] + lx * c + lz * s, p[1] + ly, p[2] - lx * s + lz * c], s: [sx, sy, sz], yaw, mat: m, bevel: 0.015, cast: true });
  put(0, 0.28, 0, 1.15, 0.05, 0.62); put(0, 0.32, 0.32, 1.25, 0.6, 0.04); put(0, 0.32, -0.32, 1.25, 0.6, 0.04); put(0.6, 0.32, 0, 0.04, 0.6, 0.62); put(-0.6, 0.32, 0, 0.04, 0.6, 0.62);
  put(0, 0.9, 0.33, 1.29, 0.04, 0.06); put(0, 0.9, -0.33, 1.29, 0.04, 0.06);
  for (const x of [-0.38, 0.38]) for (const z of [-0.3, 0.3]) B.cyl({ p: [p[0] + x * c + z * s, p[1] + 0.02, p[2] - x * s + z * c], r: 0.13, h: 0.05, seg: 12, mat: wheelMat, pitch: Math.PI / 2, yaw, anchor: 'center', cast: true });
  B.colliders.addBox({ x: p[0], y: p[1] + 0.5, z: p[2], hx: 0.65, hy: 0.5, hz: 0.36, yaw, surface: 'metal', walk: true });
}
