// Props of the base village: lamp posts with halos, frozen fountain, snowmobiles, snowcat groomer, ski racks, drifts, woodpiles, signs.
import * as THREE from 'three';
import { Frame, quad } from './common.js';
import { lampCone } from './snowkit.js';
import { signMaterial } from '../../core/canvas2d.js';
import { makeRng } from '../../core/util.js';

export function drift(B, M, x, y, z, len, h, wid, yaw = 0, seed = 1) { B.rock({ p: [x, y + h * 0.15, z], r: 1, squash: [len / 2, h, wid / 2], amp: 0.28, seed, detail: 2, mat: M.snow, yaw, cast: true, col: false }); }

/** Victorian iron lamp post with a lantern (emissive), halo and a pooled warm light. */
export function lampPost(ctx, B, M, halos, x, z, { h = 5.0, yaw = 0, intensity = 28, dist = 22, arm = 0.0, y = 0 } = {}) {
  const F = new Frame(B, x, z, yaw, y);
  F.cyl({ p: [0, 0, 0], r: [0.22, 0.16], h: 0.5, seg: 10, mat: M.iron, col: false }); F.cyl({ p: [0, 0.5, 0], r: [0.11, 0.07], h: h - 0.5, seg: 10, mat: M.iron, col: 'metal' });
  F.cyl({ p: [0, h - 0.3, 0], r: 0.13, h: 0.1, seg: 10, mat: M.iron, col: false, cast: false });
  F.box({ p: [0, h - 0.05, 0], s: [0.34, 0.5, 0.34], mat: M.lampGlow, bevel: 0.03, col: false, cast: false });                                   // lantern body (glowing)
  for (const su of [-1, 1]) for (const sv of [-1, 1]) F.box({ p: [su * 0.17, h - 0.08, sv * 0.17], s: [0.04, 0.56, 0.04], mat: M.iron, col: false, cast: false });
  F.prism({ p: [0, h + 0.45, 0], s: [0.55, 0.28, 0.55], mat: M.iron }); F.box({ p: [0, h + 0.72, 0], s: [0.5, 0.18, 0.5], mat: M.snow, bevel: 0.08, col: false, cast: false });
  const wp = F.p(0, h + 0.2, 0); halos.add(wp, 0xffb45c, 1.0, 0.8, 5 + (x * 3.1 % 3)); lampCone(B.group, [wp[0], wp[1] - 0.2, wp[2]], { len: h + 0.2, r1: 2.4, intensity: 0.16 }); ctx.light({ pos: [wp[0], wp[1] - 0.3, wp[2]], color: 0xffa64d, intensity, distance: dist, decay: 2, flicker: 0.04, flickerSpeed: 4 });
  B.rock({ p: F.p(0.15, 0.1, 0.1), r: 0.55, squash: [1.3, 0.35, 1.1], amp: 0.3, seed: 4, detail: 1, mat: M.snow, cast: false });                       // snow banked at the foot
  return wp;
}

/** Frozen fountain: octagonal stone basin, tiered pedestal, ice cascades with hanging icicles, snow caps. */
export function fountain(B, M, x, z) {
  const F = new Frame(B, x, z, 0.2, 0);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, r = 3.1; F.box({ p: [Math.cos(a) * r, 0, Math.sin(a) * r], s: [2.5, 0.85, 0.5], yaw: -a + Math.PI / 2, mat: M.stone, bevel: 0.05, col: 'rock' }); }
  F.cyl({ p: [0, 0, 0], r: 2.85, h: 0.55, seg: 24, mat: M.iceBlock, col: false, cast: false });                                                                   // frozen water
  F.rock({ p: [0, 0.35, 0], r: 2.3, squash: [1, 0.22, 1], amp: 0.2, seed: 9, detail: 2, mat: M.snow, cast: false });
  F.cyl({ p: [0, 0.5, 0], r: [0.75, 0.55], h: 1.5, seg: 14, mat: M.stone, col: 'rock' }); F.cyl({ p: [0, 2.0, 0], r: [1.55, 1.2], h: 0.35, seg: 20, mat: M.stone, col: false });
  F.cyl({ p: [0, 2.35, 0], r: [0.34, 0.26], h: 1.3, seg: 10, mat: M.stone, col: false }); F.cyl({ p: [0, 3.55, 0], r: [1.0, 0.75], h: 0.3, seg: 16, mat: M.stone, col: false });
  F.rock({ p: [0, 2.6, 0], r: 1.2, squash: [1.05, 0.5, 1.05], amp: 0.35, seed: 5, detail: 2, mat: M.iceBlock, cast: false }); F.rock({ p: [0, 3.75, 0], r: 0.7, squash: [1, 0.7, 1], amp: 0.4, seed: 7, detail: 2, mat: M.iceBlock, cast: false });
  const rng = makeRng(12); const g = new THREE.ConeGeometry(0.012, 1, 5, 1, true); g.rotateX(Math.PI); g.translate(0, -0.5, 0);
  for (let i = 0; i < 90; i++) { const a = rng() * 6.28, tier = rng() < 0.6, r = tier ? 1.5 : 0.95, y = tier ? 2.33 : 3.62, len = 0.25 + rng() * (tier ? 0.85 : 0.6); const p = F.p(Math.cos(a) * r, y, Math.sin(a) * r); B.instance('icicleF', g, M.ice, B.matrix(p, 0, [1 + rng() * 1.2, len, 1 + rng() * 1.2]), 0xffffff, { cast: false }); }
  F.rock({ p: [0, 4.0, 0], r: 0.75, squash: [1, 0.4, 1], amp: 0.4, seed: 2, detail: 1, mat: M.snow, cast: false });
}

/** Snowmobile: shell, seat, windshield, skis, track. base at ground, forward = -v of the frame. */
export function snowmobile(B, M, x, z, yaw, body = M.steelRed) {
  const F = new Frame(B, x, z, yaw, 0);
  F.box({ p: [0, 0.32, 0.0], s: [0.72, 0.16, 2.0], mat: M.steel, bevel: 0.04, col: false });                                                              // chassis
  F.box({ p: [0, 0.34, 0.15], s: [0.9, 0.5, 2.5], mat: M.rubber, col: false, cast: false, bevel: 0.2 });                                                       // track (rear tunnel)
  F.sphere({ p: [0, 0.68, -0.55], r: 0.5, scale: [0.85, 0.62, 1.55], mat: body, seg: 14 });                                                                    // hood
  F.box({ p: [0, 0.62, 0.35], s: [0.62, 0.3, 1.15], mat: body, bevel: 0.1, col: false });                                                                    // tunnel cover
  F.box({ p: [0, 0.9, 0.55], s: [0.48, 0.16, 1.0], mat: M.rubber, bevel: 0.06, col: false });                                                                 // seat
  F.rock({ p: [0, 1.02, 0.55], r: 0.4, squash: [0.9, 0.22, 1.5], amp: 0.3, seed: 6, detail: 1, mat: M.snow, cast: false });
  F.box({ p: [0, 0.98, -0.35], s: [0.5, 0.38, 0.05], mat: M.ice, pitch: -0.5, bevel: 0.01, col: false, cast: false });                                        // windshield
  F.cyl({ p: [0, 1.0, -0.22], r: 0.02, h: 0.8, seg: 6, mat: M.iron, roll: Math.PI / 2, anchor: 'center', col: false, cast: false });                          // handlebar
  F.box({ p: [0, 0.68, -1.28], s: [0.34, 0.12, 0.06], mat: M.glowWhite, bevel: 0.02, col: false, cast: false });                                                // headlight
  for (const su of [-1, 1]) { F.box({ p: [su * 0.5, 0.06, -0.75], s: [0.16, 0.06, 1.5], mat: M.iron, pitch: 0.12, bevel: 0.02, col: false, cast: false }); F.box({ p: [su * 0.34, 0.3, -0.7], s: [0.05, 0.4, 0.05], mat: M.steel, col: false, cast: false, roll: su * 0.5 }); }
  B.colliders.addBox({ x, y: 0.55, z, hx: 0.5, hy: 0.55, hz: 1.4, yaw, surface: 'metal', walk: false });
}

/** Snowcat / piste groomer: cab with panoramic glass, tracks, blade, tiller, amber beacon. */
export function snowcat(B, M, x, z, yaw, halos = null) {
  const F = new Frame(B, x, z, yaw, 0); const body = M.steelRed;
  for (const su of [-1, 1]) { F.box({ p: [su * 1.35, 0.0, 0.2], s: [0.85, 0.95, 4.8], mat: M.rubber, bevel: 0.32, col: false }); for (const sv of [-1.9, -0.65, 0.65, 1.9, 2.5]) F.cyl({ p: [su * 1.35, 0.5, sv + 0.2], r: 0.42, h: 0.75, seg: 12, mat: M.steel, roll: Math.PI / 2, anchor: 'center', col: false, cast: false }); }
  F.box({ p: [0, 0.75, 0.1], s: [2.6, 0.95, 4.2], mat: body, bevel: 0.1, col: false });                                                                       // hull
  F.box({ p: [0, 1.65, -0.9], s: [2.3, 1.55, 1.9], mat: body, bevel: 0.08, col: false });                                                                      // cab lower
  F.box({ p: [0, 1.95, -0.9], s: [2.24, 1.1, 1.84], mat: M.ice, bevel: 0.03, col: false, cast: false });                                                       // cab glass
  for (const su of [-1, 1]) F.box({ p: [su * 1.05, 1.9, -0.9], s: [0.08, 1.2, 1.9], mat: body, col: false }); for (const sv of [-1, 1]) F.box({ p: [0, 1.9, -0.9 + sv * 0.9], s: [2.3, 1.2, 0.08], mat: body, col: false });
  F.box({ p: [0, 3.15, -0.9], s: [2.4, 0.14, 2.0], mat: body, bevel: 0.05, col: false }); F.box({ p: [0, 3.24, -0.9], s: [2.0, 0.2, 1.7], mat: M.snow, bevel: 0.1, col: false, cast: false });
  F.box({ p: [0, 3.3, -0.2], s: [1.2, 0.1, 0.16], mat: M.glowWhite, col: false, cast: false });                                                               // light bar
  F.box({ p: [0, 1.2, 1.55], s: [2.3, 1.0, 1.3], mat: body, bevel: 0.08, col: false });                                                                       // engine deck
  F.box({ p: [0, 0.8, -2.6], s: [3.7, 0.95, 0.22], mat: M.steel, bevel: 0.05, pitch: 0.15, col: false });                                                     // blade
  F.box({ p: [0, 0.4, 3.05], s: [3.4, 0.5, 0.8], mat: M.steel, bevel: 0.05, col: false });                                                                     // tiller
  F.box({ p: [0, 0.35, 3.6], s: [3.5, 0.32, 0.9], mat: M.rubber, bevel: 0.08, col: false, cast: false });
  F.cyl({ p: [-0.7, 3.4, -0.5], r: 0.13, h: 0.24, seg: 10, mat: M.lampGlow, col: false, cast: false }); if (halos) halos.add(F.p(-0.7, 3.62, -0.5), 0xffa020, 1.4, 1.1, 2.2);
  F.rock({ p: [0, 2.6, 1.6], r: 1.0, squash: [1.2, 0.2, 1.3], amp: 0.3, seed: 3, detail: 1, mat: M.snow, cast: false });
  B.colliders.addBox({ x, y: 1.5, z, hx: 1.9, hy: 1.5, hz: 2.9, yaw, surface: 'metal', walk: false });
}

/** Ski rack with n pairs of skis (+ poles) leaning against it. */
export function skiRack(B, M, x, z, yaw, n = 6, seed = 1) {
  const F = new Frame(B, x, z, yaw, 0), rng = makeRng(seed); const L = n * 0.32 + 0.2;
  for (const su of [-1, 1]) F.box({ p: [su * L / 2, 0, 0], s: [0.1, 1.3, 0.5], mat: M.beam, bevel: 0.02, col: false }); F.box({ p: [0, 1.05, -0.12], s: [L + 0.1, 0.09, 0.1], mat: M.beam, bevel: 0.02, col: false }); F.box({ p: [0, 0.35, 0.02], s: [L, 0.08, 0.1], mat: M.beam, col: false, cast: false });
  const cols = [M.steelRed, M.paintBlue, M.iron, M.paintGreen, M.plaster];
  for (let i = 0; i < n; i++) { const u = (-L / 2 + 0.25) + i * 0.32; const m = cols[(rng() * cols.length) | 0]; const lean = 0.09 + rng() * 0.06;
    F.box({ p: [u, 0.02, 0.15], s: [0.075, 1.75, 0.02], mat: m, pitch: lean, bevel: 0.006, col: false, cast: false }); F.box({ p: [u + 0.09, 0.02, 0.15], s: [0.075, 1.72, 0.02], mat: m, pitch: lean * 1.05, bevel: 0.006, col: false, cast: false });
    F.box({ p: [u + 0.04, 0.02, 0.32], s: [0.02, 1.35, 0.02], mat: M.iron, pitch: lean * 1.5, col: false, cast: false }); }
  B.colliders.addBox({ x, y: 0.65, z, hx: L / 2 * Math.abs(Math.cos(yaw)) + 0.3 * Math.abs(Math.sin(yaw)), hy: 0.65, hz: L / 2 * Math.abs(Math.sin(yaw)) + 0.3 * Math.abs(Math.cos(yaw)), yaw: 0, surface: 'wood', walk: false });
}

export function woodpile(B, M, x, z, yaw, seed = 1) {
  const F = new Frame(B, x, z, yaw, 0), rng = makeRng(seed); const g = new THREE.CylinderGeometry(0.075, 0.075, 1.1, 8); g.rotateZ(Math.PI / 2);
  for (let r = 0; r < 6; r++) for (let i = 0; i < 12 - r; i++) { const p = F.p((i - (11 - r) / 2) * 0.16, 0.08 + r * 0.14, (rng() - 0.5) * 0.05); B.instance('log', g, M.beam, B.matrix(p, yaw + Math.PI / 2, [1, 1, 1]), 0xffffff, { cast: false }); }
  F.box({ p: [0, 0.98, 0], s: [1.95, 0.32, 1.25], mat: M.snow, bevel: 0.14, col: false, cast: false }); B.colliders.addBox({ x, y: 0.5, z, hx: 1.0 * Math.abs(Math.cos(yaw)) + 0.6 * Math.abs(Math.sin(yaw)), hy: 0.5, hz: 1.0 * Math.abs(Math.sin(yaw)) + 0.6 * Math.abs(Math.cos(yaw)), yaw: 0, surface: 'wood', walk: false });
}
export function signpost(B, M, x, z, yaw, lines, w = 1.5) {
  const F = new Frame(B, x, z, yaw, 0); F.box({ p: [0, 0, 0], s: [0.14, 2.6, 0.14], mat: M.beam, bevel: 0.02, col: 'wood' });
  F.box({ p: [0, 1.8, -0.085], s: [w + 0.06, 0.61, 0.05], mat: M.beam, bevel: 0.01, col: false, cast: false }); quad(B, signMaterial({ lines, bg: '#1b3a5a', fg: '#f4f0e6', w: 512, h: 192, weather: 0.6, border: true }), F.p(0, 2.105, -0.12), w, 0.55, F.yaw + Math.PI);
  F.box({ p: [0, 2.35, 0], s: [w + 0.2, 0.18, 0.2], mat: M.snow, bevel: 0.07, col: false, cast: false });
}
