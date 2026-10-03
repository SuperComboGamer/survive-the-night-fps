// Mid-Mountain Station detail pass. Reference: an alpine mid-station of a 1970s-90s detachable gondola (concrete + steel + glass), ski-patrol cabin, generator shed.
//  * board-formed concrete: horizontal form-work reveals every 0.6 m, tie-hole grid, cold-joint lines, rust / lime streaks under sills and scuppers;
//  * ribbon windows: thermally broken aluminium frames, mullions, hopper sashes, projecting sills with drip, lintel upstands;
//  * roof deck: 2 rooftop AC units with fans, 3 vent stacks with rain caps, roof ladder with cage, conduit runs, scuppers + downpipes, parapet coping;
//  * canopy: knee braces, a lattice truss under every portal beam, zinc gutter + downpipes, cable tray + junction boxes;
//  * rope gantries: real sheave batteries (twin rail, 6 rollers with hubs / axles / bolts) and cable guards; lattice-tube chairlift towers with T-head battery, ladders and cages;
//  * patrol hut / generator shed: stovepipe + cap, gutters, window frames, hinged doors with latch + hasp, stretcher rack, first-aid cabinet, boot / ski racks, fuel tank on cradle with valve,
//    exhaust stack with rain cap, cooling louvres, cable trunking, warning placards, oil stains.
import * as THREE from 'three';
import { Frame } from './common.js';
import { makeRng } from '../../core/util.js';

const P = Math.PI;

export function stationDetails(ctx, B, M, halos, F, SBLOCK) {
  const { u0, u1, v0, v1, h1, h2 } = SBLOCK, top = h1 + h2, rng = makeRng(919);
  // ---- concrete formwork on the four faces of the restaurant storey (h1+0.2 .. top)
  const faces = [['v', v0 - 0.01, u0, u1, -1], ['v', v1 + 0.01, u0, u1, 1], ['u', u0 - 0.01, v0, v1, -1], ['u', u1 + 0.01, v0, v1, 1]];
  for (const [ax, fixed, a, b, sg] of faces) {
    for (let y = h1 + 0.5; y < top - 0.1; y += 0.6) ax === 'v' ? F.box({ p: [(a + b) / 2, y, fixed + sg * 0.005], s: [b - a + 0.6, 0.014, 0.02], mat: M.concreteDark, col: false, cast: false }) : F.box({ p: [fixed + sg * 0.005, y, (a + b) / 2], s: [0.02, 0.014, b - a + 0.6], mat: M.concreteDark, col: false, cast: false });
    for (let c = a + 0.35; c < b - 0.2; c += 0.6) for (let y = h1 + 0.8; y < top - 0.3; y += 0.6) { if (rng() < 0.08) continue; ax === 'v' ? F.box({ p: [c, y, fixed + sg * 0.006], s: [0.035, 0.035, 0.014], mat: M.dark, col: false, cast: false }) : F.box({ p: [fixed + sg * 0.006, y, c], s: [0.014, 0.035, 0.035], mat: M.dark, col: false, cast: false }); }   // tie holes
  }
  // ---- aluminium window frames + streaks on the ribbon windows of the front and left faces
  const wins = (a, b, n, w2) => Array.from({ length: n }, (_, i) => ({ c: a + (b - a) * (i + 0.5) / n, w: w2 })); const y0 = h1 + 0.75, hh = 2.25;
  for (const o of wins(u0 + 0.6, u1 - 0.6, 5, 1.9)) { const fz = v0 - 0.04;
    for (const s of [-1, 1]) F.box({ p: [o.c + s * (o.w / 2 - 0.03), y0, fz], s: [0.06, hh, 0.07], mat: M.steelDark, col: false, cast: false }); F.box({ p: [o.c, y0, fz], s: [o.w, 0.06, 0.07], mat: M.steelDark, col: false, cast: false }); F.box({ p: [o.c, y0 + hh - 0.06, fz], s: [o.w, 0.06, 0.07], mat: M.steelDark, col: false, cast: false });
    F.box({ p: [o.c, y0, fz], s: [0.05, hh, 0.07], mat: M.steelDark, col: false, cast: false }); F.box({ p: [o.c, y0 + hh * 0.72, fz], s: [o.w, 0.05, 0.07], mat: M.steelDark, col: false, cast: false });                             // mullion + transom (hopper light above)
    for (const s of [-1, 0, 1]) F.box({ p: [o.c + s * 0.5 + (rng() - 0.5) * 0.15, y0 - 0.95, v0 - 0.012], s: [0.05 + rng() * 0.03, 0.85 + rng() * 0.25, 0.006], mat: M.concreteDark, col: false, cast: false });                       // drip streaks
  }
  for (const o of wins(v0 + 0.8, v1 - 0.8, 6, 1.9)) { const fx = u0 - 0.04;
    for (const s of [-1, 1]) F.box({ p: [fx, y0, o.c + s * (o.w / 2 - 0.03)], s: [0.07, hh, 0.06], mat: M.steelDark, col: false, cast: false }); F.box({ p: [fx, y0, o.c], s: [0.07, 0.06, o.w], mat: M.steelDark, col: false, cast: false }); F.box({ p: [fx, y0 + hh - 0.06, o.c], s: [0.07, 0.06, o.w], mat: M.steelDark, col: false, cast: false }); F.box({ p: [fx, y0, o.c], s: [0.07, hh, 0.05], mat: M.steelDark, col: false, cast: false });
  }
  // ---- roof deck equipment
  { const rd = (u, v, w, d, hgt, mat) => F.box({ p: [u, top + 0.45, v], s: [w, hgt, d], mat, bevel: 0.03, col: false, cast: false });
    for (const [u, v] of [[1.6, 4.2], [4.4, 3.4]]) { rd(u, v, 1.6, 1.1, 1.0, M.galv); F.cyl({ p: [u, top + 1.47, v], r: 0.42, h: 0.06, seg: 14, mat: M.dark, col: false, cast: false }); for (let k = 0; k < 4; k++) F.box({ p: [u, top + 1.54, v], s: [0.86, 0.015, 0.02], yaw: k * P / 4, mat: M.iron, col: false, cast: false }); for (let k = 0; k < 7; k++) F.box({ p: [u + 0.82, top + 0.6 + k * 0.1, v], s: [0.02, 0.05, 0.9], mat: M.iron, col: false, cast: false }); F.rock({ p: [u, top + 1.56, v], r: 0.7, squash: [1, 0.22, 0.8], amp: 0.3, seed: 6, detail: 1, mat: M.snow, cast: false }); }
    for (const [u, v] of [[8.6, 3.2], [9.4, 12.2], [2.4, 14.6]]) { F.cyl({ p: [u, top + 0.45, v], r: 0.13, h: 1.3, seg: 8, mat: M.galv, col: false, cast: false }); F.cyl({ p: [u, top + 1.75, v], r: [0.26, 0.05], h: 0.2, seg: 8, mat: M.galv, col: false, cast: false }); F.cyl({ p: [u, top + 1.7, v], r: 0.03, h: 0.15, seg: 5, mat: M.iron, col: false, cast: false }); }
    for (let k = 0; k < 9; k++) F.box({ p: [10.2, top + 0.45 + k * 0.3, 8.2], s: [0.04, 0.04, 0.5], mat: M.galv, col: false, cast: false }); for (const s of [-1, 1]) F.box({ p: [10.2, top + 0.45, 8.2 + s * 0.25], s: [0.04, 2.7, 0.04], mat: M.galv, col: false, cast: false });         // roof ladder
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) F.cyl({ p: [10.2, top + 1.8 + k * 0.32, 8.2], r: [0.3, 0.3], h: 0.02, seg: 12, mat: M.galv, col: false, cast: false, roll: 0 });
    F.cyl({ p: [1.0, top + 0.5, 8.0], r: 0.04, h: 6.0, seg: 6, mat: M.iron, roll: 0, pitch: P / 2, anchor: 'center', col: false, cast: false });                                                       // conduit run
    for (const [u, v] of [[5.0, 1.55], [8.0, 1.55], [10.55, 9.0]]) { F.box({ p: [u, top + 0.34, v], s: [0.4, 0.12, 0.3], mat: M.steelDark, col: false, cast: false }); F.cyl({ p: [u, 0.2, v - 0.1], r: 0.05, h: top + 0.2, seg: 6, mat: M.galv, col: false, cast: false }); } }        // scuppers + downpipes
  // ---- canopy: knee braces + truss diagonals + gutter + cable tray
  for (const v of [1.0, -3.5, -8, -12.5]) { for (const [u, su] of [[-9.3, 1], [2.9, -1]]) F.beam([u, 4.2, v], [u + su * 1.5, 5.4, v], 0.11, 0.11, { mat: M.steel, col: false, cast: false });
    const A = [-9.3, 5.1, v], Bp = [2.9, 6.3, v]; for (let k = 0; k < 6; k++) { const t0 = k / 6, t1 = (k + 1) / 6, pa = [A[0] + (Bp[0] - A[0]) * t0, A[1] + (Bp[1] - A[1]) * t0 - 0.55, v], pb = [A[0] + (Bp[0] - A[0]) * t1, A[1] + (Bp[1] - A[1]) * t1 - 0.55, v], ta = [pa[0], pa[1] + 0.55, v], tb = [pb[0], pb[1] + 0.55, v];
      F.beam(k % 2 ? ta : pa, k % 2 ? pb : tb, 0.05, 0.05, { mat: M.steel, col: false, cast: false }); } F.beam([A[0], A[1] - 0.55, v], [Bp[0], Bp[1] - 0.55, v], 0.06, 0.06, { mat: M.steel, col: false, cast: false }); }
  F.cyl({ p: [-9.7, 5.1, -6.5], r: 0.07, h: 16.4, seg: 8, mat: M.galv, pitch: P / 2, anchor: 'center', col: false, cast: false }); for (const v of [-13.5, -1]) F.cyl({ p: [-9.75, 0.1, v], r: 0.05, h: 5.0, seg: 6, mat: M.galv, col: false, cast: false });
  F.box({ p: [-4.5, 5.35, -6.8], s: [0.25, 0.08, 15.4], mat: M.steelDark, col: false, cast: false }); for (let v = -13.5; v < 1; v += 2.4) F.box({ p: [-4.5, 5.31, v], s: [0.27, 0.05, 0.03], mat: M.iron, col: false, cast: false }); for (const v of [-10.2, -5.8, -1.6]) F.box({ p: [-4.5, 5.15, v], s: [0.3, 0.2, 0.25], mat: M.steelDark, bevel: 0.02, col: false, cast: false });
  // ---- rope gantries: sheave batteries (the rope runs along v at u~0) -- twin rails, 6 rollers with hubs, bolts, guard hoops
  for (const v of [-17.5, -22.5, -27.5]) { for (const s of [-1, 1]) F.box({ p: [s * 0.24, 4.62, v], s: [0.06, 0.1, 1.9], mat: M.steel, bevel: 0.01, col: false, cast: false });
    for (let k = 0; k < 6; k++) { F.cyl({ p: [0, 4.8, v - 0.8 + k * 0.32], r: 0.11, h: 0.32, seg: 12, mat: M.iron, roll: P / 2, anchor: 'center', col: false, cast: false }); F.cyl({ p: [0, 4.8, v - 0.8 + k * 0.32], r: 0.045, h: 0.5, seg: 8, mat: M.steel, roll: P / 2, anchor: 'center', col: false, cast: false }); for (const s of [-1, 1]) F.cyl({ p: [s * 0.27, 4.8, v - 0.8 + k * 0.32], r: 0.03, h: 0.03, seg: 6, mat: M.galv, roll: P / 2, anchor: 'center', col: false, cast: false }); }
    for (const dz of [-0.95, 0.95]) B.tube({ pts: [F.p(-0.34, 4.66, v + dz), F.p(-0.3, 5.15, v + dz), F.p(0.3, 5.15, v + dz), F.p(0.34, 4.66, v + dz)], r: 0.02, mat: M.steel, seg: 5, segs: 8, cast: false }); }
}

/** patrol hut + generator shed extras (F frames come from patrolHut / generatorShed) */
export function hutDetails(ctx, B, M, halos, hut, shed) {
  const rng = makeRng(77); const h = hut.F, w = 6.4, d = 4.6, hg = 2.9;
  h.cyl({ p: [-1.8, hg + 0.1, 0.8], r: 0.1, h: 1.7, seg: 8, mat: M.iron, col: false, cast: false }); h.cyl({ p: [-1.8, hg + 1.75, 0.8], r: [0.22, 0.05], h: 0.14, seg: 8, mat: M.iron, col: false, cast: false });               // stovepipe + rain cap
  h.cyl({ p: [-1.8, hg + 0.5, 0.8], r: 0.14, h: 0.08, seg: 8, mat: M.steel, col: false, cast: false });
  B.tube({ pts: [h.p(-w / 2 - 0.4, hg + 0.02, -d / 2 - 0.4), h.p(0, hg - 0.02, -d / 2 - 0.4), h.p(w / 2 + 0.4, hg + 0.02, -d / 2 - 0.4)], r: 0.06, mat: M.galv, seg: 8, segs: 8, cast: false }); h.cyl({ p: [w / 2 + 0.3, 0.1, -d / 2 - 0.35], r: 0.045, h: hg - 0.1, seg: 6, mat: M.galv, col: false, cast: false });
  h.box({ p: [0.2, 0.4, -d / 2 - 0.55], s: [2.2, 0.06, 0.9], mat: M.timber, col: false, cast: false }); for (const s of [-1, 1]) h.box({ p: [0.2 + s * 1.0, 0, -d / 2 - 0.55], s: [0.08, 0.4, 0.8], mat: M.steelDark, col: false, cast: false });         // stretcher rack: two rails on stands
  for (let k = 0; k < 2; k++) { h.box({ p: [0.2, 0.46 + k * 0.03, -d / 2 - 0.55 + (k - 0.5) * 0.3], s: [2.0, 0.05, 0.22], mat: M.red, bevel: 0.03, col: false, cast: false }); }
  h.box({ p: [-0.6, 1.35, -d / 2 - 0.05], s: [0.5, 0.55, 0.14], mat: M.rime, bevel: 0.02, col: false, cast: false }); h.box({ p: [-0.6, 1.55, -d / 2 - 0.13], s: [0.36, 0.2, 0.03], mat: M.red, col: false, cast: false }); h.box({ p: [-0.6, 1.44, -d / 2 - 0.13], s: [0.12, 0.03, 0.03], mat: M.rime, col: false, cast: false });      // first-aid cabinet
  h.box({ p: [2.4, 0, -d / 2 - 0.4], s: [1.2, 0.9, 0.5], mat: M.timber, bevel: 0.02, col: 'wood', walk: false, cast: false }); for (let k = 0; k < 6; k++) h.box({ p: [2.05 + k * 0.14, 0.9, -d / 2 - 0.45], s: [0.06, 0.02, 0.36], mat: M.iron, col: false, cast: false });                          // boot bench
  for (let k = 0; k < 4; k++) h.beam([-2.6 + k * 0.1, 0.02, d / 2 + 0.24 + k * 0.02], [-2.6 + k * 0.1 + 0.2, 1.9, d / 2 + 0.03], 0.03, 0.012, { mat: [M.red, M.orange, M.iron, M.red][k], col: false, cast: false });
  h.box({ p: [1.4, 2.35, -d / 2 - 0.5], s: [0.4, 0.3, 0.4], mat: M.steelDark, bevel: 0.03, col: false, cast: false }); h.cyl({ p: [1.4, 2.28, -d / 2 - 0.5], r: 0.13, h: 0.05, seg: 10, mat: M.lampG, col: false, cast: false }); halos.add(h.p(1.4, 2.25, -d / 2 - 0.5), 0xdcfff0, 0.8, 0.5, 0);
  const sF = shed.F, sw = 5.6, sd = 4.4, sh = 3.0;
  for (let k = 0; k < 8; k++) sF.box({ p: [sw / 2 + 0.02, 1.2 + k * 0.1, 0.6], s: [0.04, 0.05, 1.3], mat: M.steelDark, pitch: 0, col: false, cast: false });                            // cooling louvres
  sF.box({ p: [sw / 2 + 0.6, 0.5, -0.4], s: [1.0, 0.5, 1.8], mat: M.steelDark, bevel: 0.03, col: false }); sF.cyl({ p: [sw / 2 + 0.6, 0.98, -0.4], r: 0.5, h: 1.5, seg: 14, mat: M.orange, pitch: P / 2, anchor: 'base', col: false, cast: false });            // fuel tank on cradle
  sF.cyl({ p: [sw / 2 + 0.6, 1.5, -0.4], r: 0.06, h: 0.1, seg: 8, mat: M.iron, col: false, cast: false }); sF.cyl({ p: [sw / 2 + 0.6, 0.9, 0.62], r: 0.03, h: 0.3, seg: 6, mat: M.iron, col: false, cast: false }); sF.box({ p: [sw / 2 + 0.6, 0.72, 0.7], s: [0.1, 0.08, 0.1], mat: M.red, col: false, cast: false });
  sF.box({ p: [0, 2.6, -sd / 2 - 0.08], s: [sw - 0.4, 0.14, 0.12], mat: M.steelDark, col: false, cast: false }); for (let k = 0; k < 7; k++) sF.box({ p: [-2.4 + k * 0.8, 2.2, -sd / 2 - 0.05], s: [0.03, 0.4, 0.05], mat: M.steelDark, col: false, cast: false });      // cable trunking + drops
  sF.box({ p: [-0.9, 1.0, -sd / 2 - 0.06], s: [0.36, 0.14, 0.05], mat: M.iron, col: false, cast: false }); sF.box({ p: [-0.9, 0.95, -sd / 2 - 0.08], s: [0.06, 0.28, 0.06], mat: M.iron, col: false, cast: false });                                                                          // hasp
  sF.box({ p: [0.9, 1.55, -sd / 2 - 0.06], s: [0.4, 0.28, 0.02], mat: M.hazard, col: false, cast: false }); sF.rock({ p: [-0.5, 0.02, -sd / 2 - 1.1], r: 0.8, squash: [1, 0.01, 0.7], amp: 0.1, seed: 2, detail: 1, mat: M.dark, cast: false });                                               // warning placard + oil stain
}

/** lattice-tube chairlift tower: 4 tapered legs, X bracing every 1.9 m, platform with railing, ladder, T-head with a 2 x 4 roller battery. Returns nothing. */
export function latticeTower(B, M, F, h) {
  const bw = 1.1, tw = 0.45; const leg = (su, sv, y) => { const k = y / h, r = bw + (tw - bw) * k; return [su * r, y, sv * r * 0.7]; };
  for (const su of [-1, 1]) for (const sv of [-1, 1]) F.beam(leg(su, sv, 0), leg(su, sv, h), 0.13, 0.13, { mat: M.steel, col: 'metal', walk: false, cast: true });
  for (let y = 0; y < h - 1.9; y += 1.9) for (const [a, b] of [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]]) { const p0 = leg(a[0], a[1], y), p1 = leg(b[0], b[1], y + 1.9), q0 = leg(b[0], b[1], y), q1 = leg(a[0], a[1], y + 1.9); F.beam(p0, p1, 0.05, 0.05, { mat: M.steel, col: false, cast: false }); F.beam(q0, q1, 0.05, 0.05, { mat: M.steel, col: false, cast: false }); }
  for (let y = 1.9; y < h; y += 1.9) for (const [a, b] of [[[1, 1], [1, -1]], [[1, -1], [-1, -1]]]) F.beam(leg(a[0], a[1], y), leg(b[0], b[1], y), 0.06, 0.06, { mat: M.steel, col: false, cast: false });
  F.box({ p: [0, h * 0.62, 0], s: [1.6, 0.06, 1.2], mat: M.grating, col: false, cast: false }); for (const [u, v] of [[-0.8, -0.6], [0.8, -0.6], [0.8, 0.6], [-0.8, 0.6]]) F.cyl({ p: [u, h * 0.62, v], r: 0.02, h: 1.0, seg: 5, mat: M.galv, col: false, cast: false });
  for (let k = 0; k < Math.floor(h * 0.62 / 0.3); k++) F.box({ p: [0.0, 0.3 + k * 0.3, bw * 0.7 * (1 - 0.5 * k * 0.3 / h) + 0.1], s: [0.4, 0.03, 0.03], mat: M.galv, col: false, cast: false });                         // ladder rungs
  F.box({ p: [0, h, 0], s: [4.6, 0.36, 0.42], mat: M.steel, bevel: 0.03, col: false });
  for (const su of [-1, 1]) { F.box({ p: [su * 2.0, h - 0.5, 0], s: [0.1, 0.56, 2.2], mat: M.steelDark, bevel: 0.01, col: false, cast: false }); for (let k = 0; k < 4; k++) { F.cyl({ p: [su * 2.0, h - 0.05, -0.75 + k * 0.5], r: 0.2, h: 0.14, seg: 12, mat: M.iron, roll: P / 2, anchor: 'center', col: false, cast: false }); F.cyl({ p: [su * 2.0, h - 0.05, -0.75 + k * 0.5], r: 0.05, h: 0.26, seg: 8, mat: M.steel, roll: P / 2, anchor: 'center', col: false, cast: false }); } }
}
