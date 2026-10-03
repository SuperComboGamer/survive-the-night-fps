// Summit detail pass. Reference: a 1930s stone observatory (ashlar granite, bronze / copper dome, 4.9 m drum) and its lift hut, on a windswept 3450 m ridge.
//  * ashlar courses (0.42 m) on the drum + hut faces as proud bands with staggered joints, corbelled cornice (32 corbels), plinth with chamfer, string course;
//  * stone portal (jambs, lintel, pediment, keystone), iron-strapped door leaf standing ajar with studs; arched window surrounds with voussoirs and sills;
//  * dome: rivet lines along every rib, slit beading (two rolled edges), roller trucks under the skirt, zenith hatch + finial + lightning rod;
//  * copper roof of the lift hut: standing seams every 0.6 m, ridge roll, eave gutter, verdigris runs; radio mast: ladder with safety cage, cable tray, insulators on guys.
import * as THREE from 'three';
import { Frame } from './common.js';
import { makeRng } from '../../core/util.js';

const P = Math.PI;
export function observatoryDetails(ctx, B, M, halos, obs) {
  const F = obs.F, rng = makeRng(505), R0 = 4.9, hDrum = 6.0, seg = 16, chord = 2 * R0 * Math.sin(P / seg) + 0.04;
  for (let j = 0; j < 13; j++) { const y = 0.95 + j * 0.42; for (let i = 1; i < seg; i++) { const a = i / seg * P * 2 + (j % 2) * P / seg * 0.5; F.box({ p: [Math.sin(a) * (R0 + 0.025), y, -Math.cos(a) * (R0 + 0.025)], s: [chord * (0.96 + rng() * 0.06), 0.045, 0.06], yaw: -a, mat: M.graniteDark, col: false, cast: false }); } }   // ashlar course joints
  for (let i = 0; i < 32; i++) { const a = i / 32 * P * 2; if (Math.abs(Math.sin(a / 2)) < 0.16) continue; F.box({ p: [Math.sin(a) * (R0 + 0.16), hDrum - 0.5, -Math.cos(a) * (R0 + 0.16)], s: [0.3, 0.3, 0.42], yaw: -a, mat: M.granite, bevel: 0.03, col: false, cast: false }); }                                    // corbels under the cornice
  F.cyl({ p: [0, 0, 0], r: R0 + 0.32, h: 0.8, seg: 32, mat: M.graniteDark, col: false, cast: false }); F.cyl({ p: [0, 0.8, 0], r: [R0 + 0.32, R0 + 0.08], h: 0.16, seg: 32, mat: M.granite, col: false, cast: false });  // plinth + chamfer
  F.cyl({ p: [0, 3.4, 0], r: R0 + 0.16, h: 0.22, seg: 32, mat: M.granite, col: false, cast: false });                                                                                                                                                  // string course
  // portal: jambs, lintel, pediment, keystone, ajar door leaf with straps + studs
  const z = -R0 - 0.35; for (const s of [-1, 1]) { F.box({ p: [s * 1.45, 0, z], s: [0.5, 2.75, 0.75], mat: M.granite, bevel: 0.04, col: false, cast: false }); for (let k = 0; k < 5; k++) F.box({ p: [s * 1.45, 0.05 + k * 0.55, z - 0.03], s: [0.55, 0.05, 0.02], mat: M.graniteDark, col: false, cast: false }); }
  F.box({ p: [0, 2.75, z], s: [3.5, 0.42, 0.8], mat: M.granite, bevel: 0.05, col: false, cast: false }); F.prism({ p: [0, 3.17, z], s: [3.9, 0.7, 0.85], mat: M.granite }); F.box({ p: [0, 2.6, z - 0.42], s: [0.34, 0.5, 0.2], mat: M.graniteDark, bevel: 0.03, col: false, cast: false });
  { const g = new Frame(B, F.p(-0.95, 0, z)[0], F.p(-0.95, 0, z)[2], F.yaw + 1.15, 0); g.box({ p: [0.5, 0, 0], s: [1.0, 2.6, 0.09], mat: M.iron, bevel: 0.01, col: false, cast: false }); for (const yy of [0.4, 1.3, 2.2]) g.box({ p: [0.5, yy, -0.05], s: [1.0, 0.14, 0.03], mat: M.steelDark || M.iron, col: false, cast: false });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) g.cyl({ p: [0.15 + i * 0.22, 0.25 + j * 0.31, -0.06], r: 0.022, h: 0.03, seg: 6, mat: M.brass, pitch: P / 2, col: false, cast: false }); }
  // arched window surrounds around the drum's lit windows (i % 4 === 2): voussoir ring + sill
  for (let i = 2; i < seg; i += 4) { const a = i / seg * P * 2, r = R0 + 0.06; const c = [Math.sin(a) * r, 0, -Math.cos(a) * r]; F.box({ p: [c[0], 1.55, c[2]], s: [1.15, 0.12, 0.3], yaw: -a, mat: M.granite, bevel: 0.02, col: false, cast: false });
    for (let k = 0; k < 7; k++) { const t = k / 6, ang = P * (0.05 + 0.9 * t), lx = -Math.cos(ang) * 0.5, ly = 4.3 + Math.sin(ang) * 0.5; F.box({ p: [c[0] + Math.cos(a) * lx, ly - 0.09, c[2] + Math.sin(a) * lx], s: [0.16, 0.2, 0.16], yaw: -a, roll: 0, mat: k === 3 ? M.granite : M.graniteDark, bevel: 0.02, col: false, cast: false }); } }
}

export function hutRoofDetails(ctx, B, M, F, u0, u1, v0, v1, hw) {
  const rng = makeRng(606), rf = 3.6, cu = (u0 + u1) / 2, half = (u1 - u0 + 2.0) / 2, slope = Math.atan2(rf, half), len = half / Math.cos(slope);
  for (const sg of [-1, 1]) for (let k = 0; k < Math.floor((v1 - v0 + 2.4) / 0.6); k++) { const v = v0 - 1.2 + 0.3 + k * 0.6; const a = [cu + sg * (half - 0.05), hw + 0.45 + 0.03, v], b = [cu + sg * 0.1, hw + 0.4 + rf + 0.03, v]; if (v > v1 + 1.0) continue; F.beam(a, b, 0.03, 0.05, { mat: M.copper, col: false, cast: false }); }
  F.cyl({ p: [cu, hw + 0.4 + rf + 0.05, (v0 + v1) / 2], r: 0.09, h: v1 - v0 + 2.4, seg: 8, mat: M.copper, pitch: P / 2, anchor: 'center', col: false, cast: false });
  for (const sg of [-1, 1]) B.tube({ pts: [F.p(cu + sg * (half + 0.02), hw + 0.36, v0 - 1.2), F.p(cu + sg * (half + 0.02), hw + 0.34, (v0 + v1) / 2), F.p(cu + sg * (half + 0.02), hw + 0.36, v1 + 1.2)], r: 0.06, mat: M.copper, seg: 8, segs: 8, cast: false });
  for (let k = 0; k < 6; k++) F.box({ p: [cu + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * (half - 1)), hw + 0.4, v0 - 1.1 + rng() * (v1 - v0 + 2.2)], s: [0.05 + rng() * 0.08, 0.001, 0.8 + rng() * 1.2], mat: M.dark, col: false, cast: false });
}
/** stone courses on the lift hut faces (front v0, left u0, back v1, right u1) */
export function hutCourses(F, M, u0, u1, v0, v1, hw) {
  const rng = makeRng(707); for (let y = 0.5; y < hw - 0.2; y += 0.45) {
    for (const [ax, fixed, a, b, sg] of [['u', v0 - 0.02, u0, u1, -1], ['u', v1 + 0.02, u0, u1, 1], ['v', u0 - 0.02, v0, v1, -1], ['v', u1 + 0.02, v0, v1, 1]]) {
      for (let c = a + (rng() * 0.6); c < b - 0.3; c += 0.9 + rng() * 0.8) { const l = 0.8 + rng() * 0.7; ax === 'u' ? F.box({ p: [c + l / 2, y, fixed + sg * 0.005], s: [Math.min(l, b - c), 0.04, 0.05], mat: M.graniteDark, col: false, cast: false }) : F.box({ p: [fixed + sg * 0.005, y, c + l / 2], s: [0.05, 0.04, Math.min(l, b - c)], mat: M.graniteDark, col: false, cast: false }); }
    }
  }
}
export function mastDetails(B, M, x, z, y0, h) {
  const rng = makeRng(808); const at = (yy) => { const r = 1.5 - 1.05 * (yy / h); return [x + r, y0 + yy, z]; };
  for (let yy = 0.6; yy < h - 1; yy += 0.32) { const p = at(yy); B.box({ p: [p[0] + 0.02, p[1], p[2]], s: [0.03, 0.03, 0.42], mat: M.steel, col: false, cast: false }); }
  for (const s of [-1, 1]) B.beam(at(0.4).map((v, i) => (i === 2 ? v + s * 0.21 : v)), at(h - 1).map((v, i) => (i === 2 ? v + s * 0.21 : v)), 0.04, 0.04, { mat: M.steel, cast: false });
  for (let yy = 2.5; yy < h - 1; yy += 1.6) { const p = at(yy); const pts = []; for (let k = 0; k <= 12; k++) { const a = -P * 0.5 + k / 12 * P * 1.6; pts.push([p[0] + 0.14 + Math.cos(a) * 0.3, p[1], p[2] + Math.sin(a) * 0.3]); } B.tube({ pts, r: 0.012, mat: M.steel, seg: 4, segs: 12, cast: false }); }             // cage hoops
  for (let yy = 1; yy < h - 1; yy += 2.2) { const p = at(yy); B.box({ p: [p[0] - 0.22, p[1], p[2] - 0.5], s: [0.22, 0.12, 0.05], mat: M.dark, col: false, cast: false }); }
  void rng;
}
