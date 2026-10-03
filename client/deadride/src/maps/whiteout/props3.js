// High-fidelity props: cast-iron lamp posts, snowmobiles, groomer, ski racks, benches, and a small clutter library (crates, jerrycans, buckets, rope coils, sandbags, tyres,
// shovels, ski bags, cones, extinguishers, salt bins...). All Builder geometry with the stop's existing materials: no new draw calls. Sizes are real (comments give the reference).
import * as THREE from 'three';
import { Frame } from './common.js';
import { lampCone } from './snowkit.js';
import { makeRng } from '../../core/util.js';

const P = Math.PI;

/** Cast-iron alpine street lamp, 5.0 m: octagonal plinth (0.54 m across), tapered fluted shaft with three collars, ladder bar, two scrolled arm brackets, four-pane lantern (0.34 x 0.5 m)
 *  with corner posts and mullions, 4-sided pierced cap, finial + vane, snow on the cap and icicles under it. Warm pooled light + halo + light cone like the old lamp. */
export function lampPost2(ctx, B, M, halos, x, z, { h = 5.0, yaw = 0, intensity = 28, dist = 22, y = 0 } = {}) {
  const F = new Frame(B, x, z, yaw, y);
  F.lathe({ p: [0, 0, 0], profile: [[0.001, 0], [0.27, 0], [0.27, 0.07], [0.22, 0.1], [0.2, 0.2], [0.155, 0.3], [0.135, 0.42], [0.105, 0.52]], seg: 8, mat: M.iron, col: 'metal' });                     // plinth
  F.lathe({ p: [0, 0.5, 0], profile: [[0.11, 0], [0.09, 0.4], [0.082, 1.4], [0.072, 2.6], [0.064, h - 0.95]], seg: 12, mat: M.iron, col: false });                                                     // tapered shaft
  for (const yy of [1.2, 2.5, h - 1.05]) F.lathe({ p: [0, yy, 0], profile: [[0.07, 0], [0.115, 0.02], [0.12, 0.05], [0.1, 0.09], [0.07, 0.1]], seg: 12, mat: M.iron, col: false, cast: false });      // collars
  F.cyl({ p: [0, 3.65, 0], r: 0.014, h: 0.9, seg: 6, mat: M.iron, roll: P / 2, anchor: 'center', col: false, cast: false }); for (const s of [-1, 1]) F.lathe({ p: [s * 0.45, 3.62, 0], profile: [[0.001, 0], [0.03, 0.03], [0.03, 0.07], [0.001, 0.1]], seg: 6, mat: M.iron, col: false, cast: false });   // banner bar
  const top = h - 0.86;
  for (const s of [-1, 1]) B.tube({ pts: [F.p(s * 0.06, top, 0), F.p(s * 0.24, top - 0.05, 0), F.p(s * 0.38, top + 0.12, 0), F.p(s * 0.3, top + 0.3, 0), F.p(s * 0.14, top + 0.32, 0)], r: 0.016, mat: M.iron, seg: 5, segs: 10, cast: false });   // scrolled brackets
  F.lathe({ p: [0, h - 0.9, 0], profile: [[0.1, 0], [0.13, 0.03], [0.09, 0.09], [0.16, 0.14], [0.2, 0.17]], seg: 12, mat: M.iron, col: false, cast: false });                                             // lantern socket
  const ly = h - 0.74; F.box({ p: [0, ly, 0], s: [0.4, 0.04, 0.4], mat: M.iron, bevel: 0.01, col: false, cast: false });
  for (const su of [-1, 1]) for (const sv of [-1, 1]) F.box({ p: [su * 0.185, ly + 0.03, sv * 0.185], s: [0.035, 0.46, 0.035], mat: M.iron, bevel: 0.005, col: false, cast: false });                       // corner posts
  for (const [du, dv, w2, d2] of [[0, -0.185, 0.34, 0.012], [0, 0.185, 0.34, 0.012], [-0.185, 0, 0.012, 0.34], [0.185, 0, 0.012, 0.34]]) { F.box({ p: [du, ly + 0.06, dv], s: [w2, 0.4, d2], mat: M.lampGlow, col: false, cast: false });
    F.box({ p: [du, ly + 0.06, dv], s: [w2 > d2 ? 0.014 : d2, 0.4, w2 > d2 ? d2 : 0.014], mat: M.iron, col: false, cast: false }); F.box({ p: [du, ly + 0.25, dv], s: [w2 > d2 ? w2 : 0.02, 0.014, w2 > d2 ? 0.02 : d2], mat: M.iron, col: false, cast: false }); }    // panes + mullions
  F.sphere({ p: [0, ly + 0.28, 0], r: 0.07, mat: M.glowWhite, seg: 8, col: false, cast: false });                                                                                                        // bulb
  F.cyl({ p: [0, ly + 0.5, 0], r: [0.32, 0.03], h: 0.26, seg: 4, yaw: P / 4, mat: M.iron, col: false }); F.lathe({ p: [0, ly + 0.76, 0], profile: [[0.001, 0], [0.05, 0.02], [0.03, 0.07], [0.055, 0.12], [0.001, 0.22]], seg: 8, mat: M.iron, col: false, cast: false });   // pierced cap + finial
  F.rock({ p: [0, ly + 0.66, 0], r: 0.3, squash: [1.05, 0.25, 1.05], amp: 0.3, seed: 4, detail: 1, mat: M.snow, cast: false });                                                                              // snow on the cap
  for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283 + 0.3, rr = 0.27 + (i % 2) * 0.03, p = F.p(Math.cos(a) * rr, ly + 0.5, Math.sin(a) * rr); B.instance('icicleF', new THREE.ConeGeometry(0.01, 1, 5, 1, true).rotateX(P).translate(0, -0.5, 0), M.ice, B.matrix(p, 0, [1, 0.08 + (i % 3) * 0.05, 1]), 0xffffff, { cast: false }); }
  B.colliders.addCyl({ x: F.x, z: F.z, r: 0.22, y0: y, y1: y + h, surface: 'metal', walk: false });
  const wp = F.p(0, ly + 0.28, 0); halos.add(wp, 0xffb45c, 1.0, 0.8, 5 + (x * 3.1 % 3)); lampCone(B.group, [wp[0], wp[1] - 0.2, wp[2]], { len: h + 0.2, r1: 2.4, intensity: 0.16 });
  ctx.light({ pos: [wp[0], wp[1] - 0.3, wp[2]], color: 0xffa64d, intensity, distance: dist, decay: 2, flicker: 0.04, flickerSpeed: 4 });
  B.rock({ p: F.p(0.15, 0.1, 0.1), r: 0.55, squash: [1.3, 0.35, 1.1], amp: 0.3, seed: 4, detail: 1, mat: M.snow, cast: false });
  return wp;
}

/** Touring snowmobile (Ski-Doo / Polaris class): 3.0 m x 1.2 m x 1.2 m. Skis on A-arm suspension, cowl, screen, seat with piping, bars with grips + mirrors, headlamp, tunnel with track and bogies. */
export function snowmobile2(B, M, x, z, yaw, body = M.steelRed, y = 0) {
  const F = new Frame(B, x, z, yaw, y);   // forward = -v
  for (const s of [-1, 1]) {
    B.tube({ pts: [F.p(s * 0.42, 0.13, 0.35), F.p(s * 0.42, 0.06, -0.3), F.p(s * 0.42, 0.06, -0.85), F.p(s * 0.42, 0.13, -1.12), F.p(s * 0.42, 0.28, -1.22)], r: 0.028, mat: M.iron, seg: 6, segs: 12, cast: false });          // ski (curved tip)
    F.box({ p: [s * 0.42, 0.005, -0.4], s: [0.15, 0.03, 1.05], mat: M.steel, bevel: 0.01, col: false, cast: false, pitch: 0.0 });                                                                            // ski skin
    F.beam([s * 0.42, 0.14, -0.7], [s * 0.23, 0.42, -0.62], 0.035, 0.035, { mat: M.steel, col: false, cast: false }); F.beam([s * 0.42, 0.14, -0.55], [s * 0.23, 0.36, -0.5], 0.03, 0.03, { mat: M.steel, col: false, cast: false });   // A-arms
    F.cyl({ p: [s * 0.36, 0.05, 0.45], r: 0.09, h: 0.08, seg: 10, mat: M.steel, roll: P / 2, anchor: 'center', col: false, cast: false });
  }
  F.box({ p: [0, 0.2, 0.45], s: [0.44, 0.34, 1.35], mat: M.rubber, bevel: 0.12, col: false, cast: false });                                                                                                 // track
  for (let i = 0; i < 12; i++) F.box({ p: [0, 0.02 + (i % 2) * 0.006, 1.06 - i * 0.11], s: [0.42, 0.03, 0.045], mat: M.iron, col: false, cast: false });                                                      // cleats on the ground run
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) F.cyl({ p: [s * 0.23, 0.1 + 0.0, 0.05 + i * 0.32], r: 0.07, h: 0.05, seg: 8, mat: M.steel, roll: P / 2, anchor: 'center', col: false, cast: false });      // bogie wheels
  F.box({ p: [0, 0.3, -0.1], s: [0.62, 0.22, 1.0], mat: M.steel, bevel: 0.04, col: false, cast: false });                                                                                                   // belly pan / chassis
  F.sphere({ p: [0, 0.6, -0.62], r: 0.5, scale: [0.85, 0.5, 1.4], mat: body, seg: 14, col: false });                                                                                                        // cowl
  F.sphere({ p: [0, 0.56, -0.98], r: 0.4, scale: [0.72, 0.42, 1.1], mat: body, seg: 12, col: false, cast: false });                                                                                         // nose
  F.box({ p: [0, 0.78, -0.72], s: [0.32, 0.05, 0.55], mat: M.iron, bevel: 0.02, col: false, cast: false }); for (let i = 0; i < 4; i++) for (const s of [-1, 1]) F.box({ p: [s * 0.4, 0.52 + i * 0.03, -0.55 - i * 0.05], s: [0.01, 0.018, 0.22], mat: M.dark, col: false, cast: false });   // hood scoop + side vents
  for (const s of [-1, 1]) F.box({ p: [s * 0.36, 0.24, 0.1], s: [0.06, 0.28, 1.15], mat: body, bevel: 0.02, col: false, cast: false, roll: s * 0.1 });                                                         // side pods / running boards
  F.box({ p: [0, 0.8, -0.38], s: [0.5, 0.42, 0.04], mat: M.ice, bevel: 0.005, pitch: -0.62, col: false, cast: false }); F.box({ p: [0, 0.78, -0.34], s: [0.54, 0.05, 0.05], mat: M.iron, pitch: -0.62, col: false, cast: false });    // windscreen
  F.box({ p: [0, 0.72, 0.28], s: [0.4, 0.14, 0.9], mat: M.rubber, bevel: 0.05, col: false, cast: false }); F.box({ p: [0, 0.83, 0.34], s: [0.36, 0.05, 0.72], mat: M.rubber, bevel: 0.03, col: false, cast: false });                 // seat
  F.box({ p: [0.0, 0.855, 0.34], s: [0.005, 0.012, 0.72], mat: M.plaster, col: false, cast: false }); F.rock({ p: [0, 0.9, 0.36], r: 0.32, squash: [0.9, 0.16, 1.4], amp: 0.3, seed: 6, detail: 1, mat: M.snow, cast: false });         // piping + snow on the seat
  F.cyl({ p: [0, 0.6, -0.16], r: 0.022, h: 0.42, seg: 6, mat: M.iron, pitch: -0.5, col: false, cast: false }); F.cyl({ p: [0, 0.98, -0.28], r: 0.013, h: 0.72, seg: 6, mat: M.iron, roll: P / 2, anchor: 'center', col: false, cast: false });   // steering column + bars
  for (const s of [-1, 1]) { F.cyl({ p: [s * 0.37, 0.98, -0.28], r: 0.02, h: 0.14, seg: 8, mat: M.rubber, roll: P / 2, anchor: 'center', col: false, cast: false }); F.box({ p: [s * 0.3, 0.96, -0.36], s: [0.02, 0.02, 0.14], mat: M.iron, col: false, cast: false });   // grips + brake levers
    F.beam([s * 0.34, 0.96, -0.3], [s * 0.4, 1.12, -0.42], 0.012, 0.012, { mat: M.iron, col: false, cast: false }); F.box({ p: [s * 0.4, 1.1, -0.44], s: [0.09, 0.06, 0.012], mat: M.steel, col: false, cast: false }); }              // mirrors
  F.cyl({ p: [0, 0.56, -1.36], r: 0.075, h: 0.05, seg: 12, mat: M.glowWhite, pitch: P / 2, col: false, cast: false }); F.box({ p: [0, 0.5, -1.36], s: [0.3, 0.05, 0.03], mat: M.iron, col: false, cast: false });                        // headlamp
  F.box({ p: [0, 0.6, 1.14], s: [0.36, 0.06, 0.03], mat: M.lampR || M.steelRed, col: false, cast: false }); F.cyl({ p: [0, 0.35, 1.22], r: 0.03, h: 0.4, seg: 6, mat: M.iron, roll: P / 2, anchor: 'center', col: false, cast: false });     // taillight + rear bar
  F.cyl({ p: [0.16, 0.55, 0.85], r: 0.05, h: 0.28, seg: 8, mat: M.steel, pitch: P / 2, anchor: 'center', col: false, cast: false });                                                                                       // muffler
  for (const s of [-1, 1]) F.box({ p: [s * 0.41, 0.58, -0.5], s: [0.012, 0.09, 0.6], mat: M.plaster, col: false, cast: false });                                                                                       // livery stripe
  B.colliders.addBox({ x, y: y + 0.55, z, hx: 0.5, hy: 0.55, hz: 1.4, yaw, surface: 'metal', walk: false });
}

/** Ski rack: A-frame timber rack with 8 pairs of skis (tips curved, bindings, brakes) and 8 poles with baskets and straps. Real ski 1.7 m, poles 1.2 m. */
export function skiRack2(B, M, x, z, yaw, n = 8, seed = 1, y = 0) {
  const F = new Frame(B, x, z, yaw, y), rng = makeRng(seed * 13 + 5); const L = n * 0.3 + 0.3;
  for (const su of [-1, 1]) { F.beam([su * L / 2, 0, -0.3], [su * L / 2 - su * 0.05, 1.5, 0.05], 0.08, 0.08, { mat: M.beam, col: false }); F.beam([su * L / 2, 0, 0.42], [su * L / 2 - su * 0.05, 1.5, 0.05], 0.08, 0.08, { mat: M.beam, col: false }); }
  F.box({ p: [0, 1.46, 0.02], s: [L + 0.2, 0.09, 0.14], mat: M.beam, bevel: 0.02, col: false }); F.box({ p: [0, 0.4, 0.34], s: [L, 0.07, 0.1], mat: M.beam, col: false, cast: false }); F.box({ p: [0, 1.1, -0.02], s: [L, 0.05, 0.08], mat: M.beam, col: false, cast: false });
  const cols = [M.steelRed, M.paintBlue, M.iron, M.paintGreen, M.plaster, M.paintRed];
  for (let i = 0; i < n; i++) { const u = -L / 2 + 0.3 + i * 0.3, m = cols[(rng() * cols.length) | 0], lean = 0.1 + rng() * 0.05;
    for (const dx of [-0.055, 0.055]) { const ax = u + dx; B.tube({ pts: [F.p(ax, 0.05, 0.3), F.p(ax, 0.9, 0.16 - lean * 0.6), F.p(ax, 1.55, 0.02 - lean), F.p(ax, 1.68, -0.02 - lean * 1.6)], r: 0.016, mat: m, seg: 5, segs: 6, cast: false });      // ski, tip rocker curved
      F.box({ p: [ax, 0.58, 0.19], s: [0.07, 0.05, 0.16], mat: M.iron, bevel: 0.006, col: false, cast: false }); }                                                                                                     // binding
    const pu = u + 0.0; B.tube({ pts: [F.p(pu, 0.02, 0.42), F.p(pu, 0.6, 0.28), F.p(pu, 1.18, 0.14)], r: 0.008, mat: M.steel, seg: 5, segs: 4, cast: false }); F.cyl({ p: [pu, 0.05, 0.42], r: [0.045, 0.045], h: 0.008, seg: 8, mat: M.rubber, col: false, cast: false }); F.cyl({ p: [pu, 1.1, 0.16], r: 0.017, h: 0.12, seg: 6, mat: M.rubber, col: false, cast: false });       // pole + basket + grip
  }
  F.rock({ p: [0, 1.56, 0.02], r: 1, squash: [L * 0.5, 0.12, 0.15], amp: 0.3, seed: 2 + seed, detail: 1, mat: M.snow, cast: false });
  B.colliders.addBox({ x, y: y + 0.75, z, hx: L / 2 * Math.abs(Math.cos(yaw)) + 0.4 * Math.abs(Math.sin(yaw)), hy: 0.75, hz: L / 2 * Math.abs(Math.sin(yaw)) + 0.4 * Math.abs(Math.cos(yaw)), yaw: 0, surface: 'wood', walk: false });
}

// ---------------------------------------------------------------- clutter library (reference sizes in comments)
export const CLUTTER = {
  /** wooden crate 0.6 x 0.4 x 0.4 with slat gaps, corner posts and stencil band */
  crate(F, M, rng) { F.box({ p: [0, 0, 0], s: [0.6, 0.4, 0.4], mat: M.dark, col: false, cast: false }); for (let k = 0; k < 4; k++) F.box({ p: [0, k * 0.1, 0], s: [0.63, 0.085, 0.43], mat: M.timberV, bevel: 0.006, col: false, cast: false }); for (const su of [-1, 1]) for (const sv of [-1, 1]) F.box({ p: [su * 0.29, 0, sv * 0.19], s: [0.05, 0.4, 0.05], mat: M.beam, col: false, cast: false }); F.box({ p: [0, 0.4, 0], s: [0.6, 0.03, 0.42], mat: M.timber, col: false, cast: false }); void rng; },
  /** 20 l jerrycan 0.34 x 0.16 x 0.46: body, embossed X ribs, handle, spout, cap */
  jerrycan(F, M, rng) { const c = rng() < 0.5 ? M.steelRed : M.orange; F.box({ p: [0, 0, 0], s: [0.34, 0.46, 0.16], mat: c, bevel: 0.025, col: false, cast: false }); F.box({ p: [0, 0.46, 0.0], s: [0.24, 0.03, 0.06], mat: c, bevel: 0.01, col: false, cast: false }); F.cyl({ p: [-0.1, 0.46, 0], r: 0.025, h: 0.07, seg: 8, mat: M.iron, col: false, cast: false }); F.beam([-0.12, 0.42, 0], [0.12, 0.44, 0], 0.02, 0.05, { mat: c, col: false, cast: false }); F.beam([-0.15, 0.1, 0.085], [0.15, 0.36, 0.085], 0.02, 0.008, { mat: M.dark, col: false, cast: false }); F.beam([-0.15, 0.36, 0.085], [0.15, 0.1, 0.085], 0.02, 0.008, { mat: M.dark, col: false, cast: false }); },
  /** 10 l steel bucket 0.28 dia x 0.26 with bail handle */
  bucket(F, M, rng) { F.cyl({ p: [0, 0, 0], r: [0.12, 0.15], h: 0.27, seg: 12, mat: M.zinc, col: false, cast: false }); F.cyl({ p: [0, 0.27, 0], r: 0.155, h: 0.02, seg: 12, mat: M.steel, col: false, cast: false }); F.cyl({ p: [0, 0.22, 0], r: 0.14, h: 0.008, seg: 12, mat: M.steel, col: false, cast: false }); if (rng() < 0.6) F.rock({ p: [0, 0.27, 0], r: 0.14, squash: [1, 0.3, 1], amp: 0.3, seed: 3, detail: 1, mat: M.snow, cast: false }); },
  /** coiled 12 mm climbing rope, 0.36 dia x 0.18 */
  ropeCoil(F, M, rng) { const c = rng() < 0.5 ? M.paintRed : M.paintBlue; for (let k = 0; k < 6; k++) F.cyl({ p: [0, k * 0.028, 0], r: [0.18 - k * 0.004, 0.18 - k * 0.004], h: 0.03, seg: 14, mat: c, col: false, cast: false }); F.cyl({ p: [0, 0, 0], r: 0.1, h: 0.18, seg: 12, mat: M.dark, col: false, cast: false }); },
  /** row of 3 sandbags (0.5 x 0.3 x 0.14 each, sagging) */
  sandbags(F, M, rng) { for (let k = 0; k < 3; k++) F.rock({ p: [(k - 1) * 0.5, 0.08, 0], r: 0.25, squash: [1.0, 0.36, 0.6], amp: 0.25, seed: 5 + k, detail: 1, mat: M.plaster, col: false, cast: false }); void rng; },
  /** truck tyre 0.75 dia x 0.25, with tread blocks */
  tyre(F, M, rng) { F.cyl({ p: [0, 0, 0], r: 0.37, h: 0.25, seg: 14, mat: M.rubber, col: false, cast: false }); F.cyl({ p: [0, -0.005, 0], r: 0.2, h: 0.26, seg: 10, mat: M.dark, col: false, cast: false }); F.rock({ p: [0, 0.25, 0], r: 0.3, squash: [1, 0.2, 1], amp: 0.3, seed: 2, detail: 1, mat: M.snow, cast: false }); void rng; },
  /** aluminium snow shovel leaning: 1.15 m handle + 0.4 x 0.3 blade */
  shovel(F, M) { F.beam([0, 0.02, 0.35], [0, 1.15, 0.03], 0.03, 0.03, { mat: M.beam, col: false, cast: false }); F.box({ p: [0, 0.0, 0.36], s: [0.38, 0.03, 0.3], mat: M.zinc, bevel: 0.006, col: false, cast: false, pitch: -0.25 }); F.box({ p: [0, 1.12, 0.03], s: [0.18, 0.03, 0.03], mat: M.iron, col: false, cast: false }); },
  /** ski bag 1.8 m x 0.22 lying with strap and buckle */
  skiBag(F, M, rng) { const c = rng() < 0.5 ? M.paintBlue : M.paintRed; F.sphere({ p: [0, 0.1, 0], r: 0.11, scale: [8, 1, 1], mat: c, seg: 10, col: false, cast: false }); for (const u of [-0.5, 0.4]) F.box({ p: [u, 0.02, 0], s: [0.05, 0.2, 0.23], mat: M.iron, col: false, cast: false }); },
  /** orange piste cone 0.7 m with white bands */
  cone(F, M) { F.cyl({ p: [0, 0, 0], r: [0.17, 0.03], h: 0.7, seg: 10, mat: M.orange, col: false, cast: false }); F.cyl({ p: [0, 0.3, 0], r: [0.1, 0.075], h: 0.1, seg: 10, mat: M.plaster, col: false, cast: false }); F.box({ p: [0, 0, 0], s: [0.4, 0.03, 0.4], mat: M.rubber, col: false, cast: false }); },
  /** 6 kg extinguisher 0.16 dia x 0.55 with hose + gauge */
  extinguisher(F, M) { F.cyl({ p: [0, 0, 0], r: 0.08, h: 0.46, seg: 10, mat: M.steelRed, col: false, cast: false }); F.cyl({ p: [0, 0.46, 0], r: [0.08, 0.03], h: 0.08, seg: 10, mat: M.steelRed, col: false, cast: false }); F.box({ p: [0.04, 0.5, 0], s: [0.09, 0.03, 0.03], mat: M.iron, col: false, cast: false }); },
  /** rock-salt / grit bin 0.9 x 0.6 x 0.6 with hinged lid + hazard stencil */
  saltBin(F, M) { F.box({ p: [0, 0, 0], s: [0.9, 0.6, 0.6], mat: M.orange, bevel: 0.03, col: 'metal', walk: false, cast: false }); F.box({ p: [0, 0.6, 0.02], s: [0.95, 0.05, 0.66], mat: M.orange, bevel: 0.02, col: false, cast: false, pitch: -0.05 }); F.box({ p: [0.0, 0.26, 0.31], s: [0.6, 0.12, 0.01], mat: M.plaster, col: false, cast: false }); F.rock({ p: [0, 0.65, 0], r: 0.4, squash: [1.1, 0.2, 0.8], amp: 0.3, seed: 8, detail: 1, mat: M.snow, cast: false }); },
  /** wheelie bin 240 l: 0.58 x 0.73 x 1.07 */
  bin(F, M) { F.box({ p: [0, 0.1, 0], s: [0.58, 0.95, 0.72], mat: M.steel, bevel: 0.04, col: 'metal', walk: false, cast: false }); F.box({ p: [0, 1.04, 0.0], s: [0.62, 0.05, 0.76], mat: M.iron, bevel: 0.02, col: false, cast: false }); for (const s of [-1, 1]) F.cyl({ p: [s * 0.3, 0.0, 0.3], r: 0.1, h: 0.05, seg: 10, mat: M.rubber, roll: P / 2, anchor: 'center', col: false, cast: false }); F.rock({ p: [0, 1.08, 0], r: 0.35, squash: [1, 0.25, 1.1], amp: 0.3, seed: 8, detail: 1, mat: M.snow, cast: false }); },
  /** pair of ski boots 0.33 long */
  boots(F, M, rng) { for (const s of [-1, 1]) { F.box({ p: [s * 0.1, 0, rng() * 0.05], s: [0.11, 0.09, 0.3], mat: M.iron, bevel: 0.03, col: false, cast: false, yaw: (rng() - 0.5) * 0.4 }); F.box({ p: [s * 0.1, 0.09, 0.05 + rng() * 0.03], s: [0.1, 0.25, 0.14], mat: M.paintBlue, bevel: 0.03, col: false, cast: false }); F.box({ p: [s * 0.1, 0.2, 0.0], s: [0.08, 0.015, 0.14], mat: M.plaster, col: false, cast: false }); } },
  /** hessian sack of grit 0.35 x 0.6 */
  sack(F, M) { F.rock({ p: [0, 0.22, 0], r: 0.3, squash: [0.7, 0.9, 0.55], amp: 0.28, seed: 9, detail: 1, mat: M.plaster, col: false, cast: false }); },
};
/** scatter clutter: list of [kind, u, v, yaw?] in the given frame */
export function scatter(B, M, F, list, seed = 1) {
  const rng = makeRng(seed * 31 + 7); for (const [kind, u, v, yw = 0, yy = 0] of list) { const f = CLUTTER[kind]; if (!f) continue; const G = new Frame(B, F.p(u, 0, v)[0], F.p(u, 0, v)[2], F.yaw + yw + (rng() - 0.5) * 0.3, F.y0 + yy); f(G, M, rng); }
}

/** Frozen fountain (reference: a 3.3 m stone basin with two bowls on a baluster column, iced solid): moulded basin wall, cracked ice disc, column, two bowls with rim beads,
 *  ~110 hanging icicles + ice curtains + frozen spray on the column, snow caps and drifts. */
export function fountain2(B, M, x, z, halos) {
  const F = new Frame(B, x, z, 0.2, 0), rng = makeRng(12);
  F.lathe({ p: [0, 0, 0], profile: [[0.001, 0], [3.0, 0], [3.1, 0.05], [3.12, 0.52], [3.32, 0.58], [3.36, 0.8], [3.08, 0.84], [2.9, 0.72], [2.88, 0.5], [0.001, 0.5]], seg: 28, mat: M.stone, col: 'rock' });                          // basin wall with cornice
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.2832; F.box({ p: [Math.cos(a) * 3.14, 0.14, Math.sin(a) * 3.14], s: [1.4, 0.36, 0.06], yaw: -a + P / 2, mat: M.stone, bevel: 0.02, col: false, cast: false }); }              // recessed panels
  F.cyl({ p: [0, 0.5, 0], r: 2.86, h: 0.16, seg: 28, mat: M.iceBlock, col: false, cast: false });                                                                                                                                                       // ice disc
  for (let i = 0; i < 22; i++) { const a = rng() * 6.28, r = rng() * 2.5, l = 0.5 + rng() * 1.3; F.box({ p: [Math.cos(a) * r, 0.665, Math.sin(a) * r], s: [l, 0.004, 0.012], yaw: rng() * 6, mat: M.dark, col: false, cast: false }); }             // cracks
  F.rock({ p: [0.7, 0.62, 0.5], r: 2.2, squash: [1, 0.11, 0.9], amp: 0.3, seed: 9, detail: 2, mat: M.snow, cast: false });
  F.lathe({ p: [0, 0.6, 0], profile: [[0.001, 0], [0.62, 0], [0.7, 0.08], [0.52, 0.18], [0.4, 0.5], [0.3, 1.0], [0.34, 1.2], [0.5, 1.3], [0.34, 1.4], [0.28, 1.7], [0.001, 1.7]], seg: 16, mat: M.stone, col: 'rock' });                       // baluster column
  F.lathe({ p: [0, 2.15, 0], profile: [[0.001, 0], [0.4, 0.03], [1.5, 0.2], [1.72, 0.32], [1.78, 0.4], [1.7, 0.44], [1.5, 0.34], [0.5, 0.16], [0.001, 0.12]], seg: 28, mat: M.stone, col: false });                                    // lower bowl
  F.lathe({ p: [0, 3.05, 0], profile: [[0.001, 0], [0.26, 0.03], [0.9, 0.12], [1.02, 0.2], [0.98, 0.24], [0.85, 0.16], [0.3, 0.08], [0.001, 0.06]], seg: 22, mat: M.stone, col: false });                                            // upper bowl
  F.lathe({ p: [0, 3.05, 0], profile: [[0.001, 0.05], [0.1, 0.1], [0.14, 0.7], [0.26, 0.8], [0.13, 0.95], [0.001, 1.0]], seg: 10, mat: M.stone, col: false }); F.sphere({ p: [0, 4.15, 0], r: 0.2, mat: M.stone, seg: 10, col: false, cast: false });
  F.rock({ p: [0, 2.6, 0], r: 1.5, squash: [1, 0.3, 1], amp: 0.35, seed: 5, detail: 2, mat: M.iceBlock, cast: false }); F.rock({ p: [0, 3.3, 0], r: 0.85, squash: [1, 0.3, 1], amp: 0.35, seed: 7, detail: 2, mat: M.iceBlock, cast: false });      // ice-filled bowls
  F.rock({ p: [0, 2.5, 0], r: 0.36, squash: [1, 3.2, 1], amp: 0.4, seed: 3, detail: 2, mat: M.iceBlock, cast: false });                                                                                                                                   // frozen spray sleeve on the column
  F.rock({ p: [0, 4.2, 0], r: 0.4, squash: [1, 0.4, 1], amp: 0.4, seed: 2, detail: 1, mat: M.snow, cast: false });
  const g = new THREE.ConeGeometry(0.012, 1, 5, 1, true); g.rotateX(P); g.translate(0, -0.5, 0);
  for (let i = 0; i < 60; i++) { const tier = i % 3 === 0 ? 1 : 0, a = rng() * 6.28, r = tier ? 0.98 : 1.72, y = tier ? 3.2 : 2.5, len = (tier ? 0.25 : 0.4) + rng() * (tier ? 0.7 : 1.2); const p = F.p(Math.cos(a) * r, y, Math.sin(a) * r); B.instance('icicleF2', g, M.ice, B.matrix(p, 0, [1 + rng() * 1.6, len, 1 + rng() * 1.6]), 0xffffff, { cast: false }); }
  // ice curtains: frozen sheets down the rim of both bowls, each with a fringe of tapered icicles (long ones where the water used to run over)
  for (const [nS, r, yR, wS] of [[18, 1.77, 2.55, 0.34], [9, 0.99, 3.27, 0.3]]) for (let i = 0; i < nS; i++) {
    const a = i / nS * 6.283 + rng() * 0.25, len = 0.1 + rng() * 0.42, wd = wS * (0.5 + rng() * 0.8), c = Math.cos(a), sn = Math.sin(a);
    F.box({ p: [c * r, yR - len, sn * r], s: [wd, len, 0.035], yaw: -a + P / 2, mat: M.iceBlock, bevel: 0.01, col: false, cast: false });
    for (let k = 0; k < 4; k++) { const off = (k / 3 - 0.5) * wd * 0.9, p2 = F.p(c * r - sn * off, yR - len, sn * r + c * off); B.instance('icicleF2', g, M.ice, B.matrix(p2, 0, [1.4 + rng() * 1.8, 0.12 + rng() * (k === 1 || k === 2 ? 0.75 : 0.35), 1.4 + rng() * 1.8]), 0xffffff, { cast: false }); }
  }
  // ring of recessed warm-white uplights round the basin (the fountain is lit for the winter season): emissive strips + halos
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 + 0.2; F.box({ p: [Math.cos(a) * 2.72, 0.66, Math.sin(a) * 2.72], s: [0.34, 0.04, 0.07], yaw: -a + P / 2, mat: M.glowWhite, col: false, cast: false }); if (halos) { const q = F.p(Math.cos(a) * 2.72, 0.75, Math.sin(a) * 2.72); halos.add([q[0], q[1], q[2]], 0xf0f4ff, 0.3, 0.32, 0); } }
}

/** Floor imperfections: salt / grit splashes, wet slush patches, drips and drag marks as thin flat boxes / discs (batched with the floor's materials: no extra draws).
 *  mats: [[material, 'blob'|'streak', weight]]; keep y ~7 mm above the surface (no z-fighting). */
export function floorGrime(F, mats, { u0, u1, v0, v1, y = 0.02, n = 40, seed = 1, sizes = [0.12, 0.7] }) {
  const rng = makeRng(seed), tot = mats.reduce((a, m) => a + (m[2] ?? 1), 0);
  for (let i = 0; i < n; i++) {
    let r = rng() * tot, e = mats[0]; for (const m of mats) { r -= m[2] ?? 1; if (r <= 0) { e = m; break; } }
    const u = u0 + rng() * (u1 - u0), v = v0 + rng() * (v1 - v0), w = sizes[0] + rng() * (sizes[1] - sizes[0]);
    if (e[1] === 'streak') F.box({ p: [u, y, v], s: [w * 2.4, 0.004, w * 0.22], yaw: rng() * 3.14, mat: e[0], col: false, cast: false, bevel: 0 });
    else F.cyl({ p: [u, y, v], r: w * 0.5, h: 0.004, seg: 7, mat: e[0], col: false, cast: false });
  }
}
