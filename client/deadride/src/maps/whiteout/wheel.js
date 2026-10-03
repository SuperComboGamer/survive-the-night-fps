// Horizontal bullwheel (vertical axis) that the haul rope wraps in every station. Returns a rotating THREE.Group (Builder-merged, 3-4 draw calls).
// Built like the real thing: a rolled steel channel rim with a machined rope groove and a dark rubber tyre liner, tapered box-section spokes with gusset plates
// and tie-rod cross bracing, a flanged hub with a ring of bolts, a toothed bull gear + brake disc with caliper under the wheel (seen from the platform), pillow-block bearing.
import * as THREE from 'three';
import { Builder } from '../../core/build.js';

/** o: {R (rope radius), mats:{steel, steelRed, iron}, spokes, drive:true} -- group origin = wheel centre at rope height */
export function makeBullwheel(ctx, o) {
  const group = new THREE.Group(); const B = new Builder({ synth: ctx.synth, group, seed: 5 }); const { R } = o; const M = o.mats; const TAU = Math.PI * 2;
  const spokes = o.spokes ?? 12, pt = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r];
  // ---- rim: closed channel section swept round the wheel; lips + groove floor sized for the rope (r ~ 0.03) sitting at radius R
  B.lathe({ p: [0, 0, 0], seg: 96, mat: M.steelRed, cast: true, profile: [[R - 0.46, -0.26], [R + 0.02, -0.26], [R + 0.09, -0.22], [R + 0.10, -0.12], [R + 0.07, -0.075], [R - 0.03, -0.045], [R - 0.03, 0.045], [R + 0.07, 0.075], [R + 0.10, 0.12], [R + 0.09, 0.22], [R + 0.02, 0.26], [R - 0.46, 0.26], [R - 0.48, 0.24], [R - 0.48, -0.24], [R - 0.46, -0.26]] });
  B.lathe({ p: [0, 0, 0], seg: 96, mat: M.iron, cast: false, profile: [[R - 0.036, -0.05], [R - 0.018, -0.05], [R - 0.018, 0.05], [R - 0.036, 0.05], [R - 0.036, -0.05]] });         // dark rubber tyre liner in the groove
  for (let i = 0; i < 48; i++) { const a = (i + 0.5) / 48 * TAU; B.box({ p: pt(R - 0.47, -0.21, a), s: [0.14, 0.42, 0.05], yaw: -a, mat: M.steel, cast: false, bevel: 0.006 }); }        // web stiffener ribs inside the rim channel
  // ---- inner ring + spokes (tapered box sections: heavy at the hub, light at the rim) with gussets and tie-rod bracing
  const rIn = R * 0.62; const inner = []; for (let i = 0; i < 48; i++) inner.push(pt(rIn, -0.32, i / 48 * TAU));
  B.tube({ pts: inner, r: 0.15, mat: M.steel, seg: 8, segs: 96, closed: true, cast: true });
  for (let i = 0; i < spokes; i++) { const a = i / spokes * TAU;
    B.beam(pt(0.8, -0.3, a), pt(rIn, -0.31, a), 0.22, 0.4, { mat: M.steel, cast: true }); B.beam(pt(rIn, -0.31, a), pt(R - 0.44, -0.16, a), 0.15, 0.26, { mat: M.steel, cast: true });
    B.box({ p: pt(rIn + 0.02, -0.5, a), s: [0.42, 0.03, 0.3], yaw: -a, mat: M.iron, cast: false, bevel: 0.006 }); B.box({ p: pt(R - 0.5, -0.36, a), s: [0.38, 0.03, 0.26], yaw: -a, mat: M.iron, cast: false, bevel: 0.006 });   // gusset plates
    const b = (i + 1) / spokes * TAU; B.beam(pt(rIn + 0.05, -0.22, a), pt(R - 0.6, -0.14, b), 0.04, 0.04, { mat: M.iron, cast: false }); B.beam(pt(R - 0.6, -0.14, a), pt(rIn + 0.05, -0.22, b), 0.04, 0.04, { mat: M.iron, cast: false });     // tie-rod X bracing
    for (const k of [-1, 1]) B.cyl({ p: pt(R - 0.5, -0.33, a + k * 0.028), r: 0.018, h: 0.04, seg: 6, mat: M.steel, cast: false });                                                                     // gusset bolts
  }
  for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; B.box({ p: pt(R - 0.25, -0.4, a), s: [0.5, 0.06, 0.18], yaw: -a, mat: M.iron, cast: false, bevel: 0.01 }); }              // bolt plates on the underside
  // ---- hub: tapered barrel + top flange with a ring of hex bolts + cap; shaft down to the gearbox with a pillow-block bearing
  B.cyl({ p: [0, -0.7, 0], r: [0.85, 0.7], h: 0.9, seg: 24, mat: M.steel, cast: true }); B.cyl({ p: [0, 0.16, 0], r: 0.98, h: 0.09, seg: 24, mat: M.steel, cast: true });
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; B.cyl({ p: pt(0.86, 0.25, a), r: 0.045, h: 0.05, seg: 6, mat: M.iron, cast: false }); }
  B.sphere({ p: [0, 0.25, 0], r: 0.34, ps: 0.5, seg: 12, mat: M.steel, cast: false });
  B.cyl({ p: [0, -1.65, 0], r: 0.32, h: 1.0, seg: 14, mat: M.iron, cast: false }); B.box({ p: [0, -1.95, 0], s: [0.95, 0.34, 0.95], mat: M.steelRed, cast: false, bevel: 0.03 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.cyl({ p: [sx * 0.36, -1.61, sz * 0.36], r: 0.035, h: 0.05, seg: 6, mat: M.iron, cast: false });
  // ---- bull gear (toothed ring) + brake disc with caliper under the wheel
  { const gr = 1.75, ring = []; for (let i = 0; i < 40; i++) ring.push(pt(gr, -0.95, i / 40 * TAU)); B.tube({ pts: ring, r: 0.07, mat: M.iron, seg: 6, segs: 80, closed: true, cast: false });
    for (let i = 0; i < 64; i++) { const a = i / 64 * TAU; B.box({ p: pt(gr + 0.09, -0.97, a), s: [0.09, 0.14, 0.075], yaw: -a, mat: M.iron, cast: false, bevel: 0.006 }); }
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.beam(pt(0.7, -0.93, a), pt(gr - 0.05, -0.95, a), 0.06, 0.1, { mat: M.iron, cast: false }); }
    B.cyl({ p: [0, -1.34, 0], r: 0.95, h: 0.035, seg: 32, mat: M.steelRed, cast: false }); B.box({ p: pt(0.98, -1.41, 0.6), s: [0.34, 0.18, 0.2], yaw: -0.6, mat: M.steelRed, cast: false, bevel: 0.02 });
    B.cable(pt(1.1, -1.32, 0.6), pt(1.7, -1.05, 0.9), 0.15, 0.012, M.iron, { n: 8, cast: false }); }
  B.finish(); group.userData.R = R; return group;
}
