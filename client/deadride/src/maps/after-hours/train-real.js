// AFTER HOURS — monorail train: exterior hardware as real geometry (bodyshell is a lofted skin with painted livery; everything below is added on top through the train's own Builder).
// References (Alweg / Disney-type monorail car, 12 m car, 2.64 m wide): window gasket 4 cm, door track rails top and bottom, wiper 0.45 m, headlamp bezel 0.22 m, bogie wheelbase 2.2 m with
// 0.36 m rubber road wheels + side guide wheels, roof AC housing 1.0 x 0.5 x 0.24 m.
import * as THREE from 'three';
import { pipe, torus, TAU, PI } from './common.js';

const CAR_L = 12, GAP = 0.6;
export function trainReal(B, K) {
  const { chrome, rubber, darkM, paintW, lampW, lampRed, WINDOWS, DOORS, ringAt } = K;
  const bx = (x, y, z, sx, sy, sz, m, e = {}) => B.box({ p: [x, y, z], s: [sx, sy, sz], mat: m, anchor: 'center', bevel: 0, cast: false, ...e });
  for (const mirror of [-1, 1]) {
    const Z = (s) => mirror * (GAP + s);
    // window gaskets: four black rubber strips proud of the skin around every side window (both sides); door tracks
    const halfW = (s, y) => { const r = ringAt(s); let best = 1.3; for (let i = 1; i <= 16; i++) { const [x0, y0] = r[i - 1], [x1, y1] = r[i]; if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1) && Math.abs(y1 - y0) > 1e-4) best = x0 + (x1 - x0) * (y - y0) / (y1 - y0); } return best; };
    for (const sd of [-1, 1]) for (const [s0, s1] of WINDOWS) { const zc = Z((s0 + s1) / 2), L = s1 - s0, xw = (y) => sd * (halfW((s0 + s1) / 2, y) + 0.012);
      for (const y of [0.95, 2.25]) bx(xw(y), y, zc, 0.03, 0.045, L + 0.05, rubber); for (const e of [-1, 1]) bx(xw(1.6), 1.6, zc + e * (L / 2 + 0.01), 0.03, 1.32, 0.045, rubber);
      bx(xw(1.6), 1.6, zc, 0.024, 0.03, L, chrome);   // sash bar
    }
    for (const sd of [-1, 1]) for (const [s0, s1] of DOORS) { const zc = Z((s0 + s1) / 2), L = s1 - s0 + 0.5; bx(sd * (halfW((s0 + s1) / 2, 2.05) + 0.02), 2.06, zc, 0.04, 0.06, L, chrome); bx(sd * (halfW((s0 + s1) / 2, 0.06) + 0.02), 0.1, zc, 0.04, 0.05, L, chrome);
      for (const e of [-1, 1]) bx(sd * (halfW(s0, 1.0) + 0.02), 1.05, Z(e > 0 ? s1 : s0) + e * 0.02, 0.04, 1.9, 0.05, rubber); }   // door track top / bottom + rubber edge seals
    // underframe: skirt panels with louvres, battery box, air reservoirs and air lines
    for (const sd of [-1, 1]) for (const [s0, s1] of [[0.6, 2.4], [4.2, 6.9], [8.6, 9.4]]) { const zc = Z((s0 + s1) / 2), L = s1 - s0, x = sd * (halfW((s0 + s1) / 2, -0.4) + 0.03);
      bx(x, -0.5, zc, 0.03, 0.34, L, darkM); for (let k = 0; k < 6; k++) bx(x + sd * 0.01, -0.62 + k * 0.05, zc, 0.012, 0.018, L * 0.6, rubber);
      for (const e of [-0.35, 0.35]) B.cyl({ p: [sd * 0.55, -0.66, zc + e * L], r: 0.09, h: 0.55, seg: 8, mat: chrome, roll: PI / 2, anchor: 'center', cast: false }); }
    pipe(B, [0.5, -0.5, Z(0.4)], [0.5, -0.5, Z(11.7)], 0.017, rubber, { seg: 5, cast: false }); pipe(B, [-0.5, -0.56, Z(0.4)], [-0.5, -0.56, Z(11.7)], 0.017, chrome, { seg: 5, cast: false });
    // bogies straddling the beam: frame, two pairs of rubber road wheels with hubs, side guide wheels, coil springs, dampers
    for (const s of [1.6, 9.6]) { const zc = Z(s);
      bx(0, -0.78, zc, 1.6, 0.16, 2.3, darkM); for (const sd of [-1, 1]) bx(sd * 0.52, -1.0, zc, 0.12, 0.5, 2.3, darkM);
      for (const dz of [-1.0, 1.0]) for (const sd of [-1, 1]) { B.cyl({ p: [sd * 0.55, -1.2, zc + dz], r: 0.36, h: 0.26, seg: 14, mat: rubber, roll: PI / 2, anchor: 'center', cast: false }); B.cyl({ p: [sd * 0.55 + sd * 0.14, -1.2, zc + dz], r: 0.16, h: 0.05, seg: 10, mat: chrome, roll: PI / 2, anchor: 'center', cast: false });
        B.cyl({ p: [sd * 0.5, -1.62, zc + dz], r: 0.16, h: 0.16, seg: 10, mat: rubber, anchor: 'center', cast: false }); }   // road wheel + hub + guide wheel
      for (const sd of [-1, 1]) for (const dz of [-0.8, 0.8]) { pipe(B, [sd * 0.62, -0.7, zc + dz], [sd * 0.62, -1.0, zc + dz], 0.045, chrome, { seg: 6, cast: false }); for (let k = 0; k < 5; k++) torus(B, { p: [sd * 0.62, -0.72 - k * 0.055, zc + dz], R: 0.075, r: 0.011, seg: 4, tube: 12, mat: chrome, cast: false }); } }
    // roof: HVAC housings, antenna, PA horn, cable trays
    for (const s of [2.6, 8.6]) { bx(0, 2.83, Z(s), 1.05, 0.22, 1.7, paintW, { bevel: 0.03 }); for (let k = 0; k < 9; k++) bx(0, 2.96, Z(s) - 0.7 + k * 0.175, 0.9, 0.018, 0.05, darkM); B.cyl({ p: [0.32, 2.98, Z(s) + 0.2], r: 0.2, h: 0.03, seg: 12, mat: darkM, cast: false }); }
    pipe(B, [-0.55, 2.78, Z(5.5)], [-0.55, 3.35, Z(5.5)], 0.008, chrome, { seg: 4, cast: false }); B.sphere({ p: [-0.55, 3.36, Z(5.5)], r: 0.022, seg: 5, mat: chrome, cast: false }); bx(0.7, 2.82, Z(5.3), 0.4, 0.05, 3.4, darkM);
    // nose: wipers, headlamp bezels, coupler door outline, number plate, roof lamp visor
    const sN = 11.7;
    for (const sd of [-1, 1]) { pipe(B, [sd * 0.35, 1.28, Z(sN - 0.42)], [sd * 0.06, 1.62, Z(sN - 0.52)], 0.007, darkM, { seg: 4, cast: false }); pipe(B, [sd * 0.35, 1.28, Z(sN - 0.42)], [sd * 0.05, 1.5, Z(sN - 0.55)], 0.005, chrome, { seg: 4, cast: false });
      torus(B, { p: [sd * 0.63, 0.5, Z(sN + 0.07)], R: 0.155, r: 0.02, seg: 5, tube: 18, yaw: mirror > 0 ? 0 : PI, mat: chrome, cast: false }); }
    bx(0, 0.52, Z(sN + 0.05), 0.5, 0.36, 0.03, darkM); bx(0, 0.52, Z(sN + 0.07), 0.44, 0.3, 0.012, rubber); for (const dx of [-0.16, 0.16]) B.cyl({ p: [dx, 0.52, Z(sN + 0.09)], r: 0.018, h: 0.012, seg: 6, mat: chrome, pitch: PI / 2, anchor: 'center', cast: false });
    B.cyl({ p: [0, 0.05, Z(sN + 0.3)], r: 0.05, h: 0.25, seg: 8, mat: chrome, pitch: PI / 2, anchor: 'center', cast: false });   // coupler stub
  }
}
