// Detail pass for the base terminal (the landmark): board-and-batten cladding, stone plinth courses, casings + sills + shutters on the hall windows, zinc gutters with downpipes,
// snow-guard bars, double glass entrance doors with transom / push bars / kick plates, ramp with handrail, barn lamps, cable trays, heater vents, bike rack, notice boards.
import * as THREE from 'three';
import { Frame } from './common.js';
import { makeRng } from '../../core/util.js';

const P = Math.PI;
export function terminalDetails(ctx, B, M, halos, HALL) {
  const { x0, x1, z0, z1, eave } = HALL; const rng = makeRng(311), F0 = new Frame(B, 0, 0, 0, 0); const winX = [-8, -1.5, 5, 11.5, 18, 24.5, 31].filter((c) => c > x0 + 1.5 && c < x1 - 1.5);
  // ---- board-and-batten on the long walls (battens every 0.55 m, skipping the lit windows) + belt board
  for (const [zz, sg] of [[z0, -1], [z1, 1]]) {
    for (let x = x0 + 0.6; x < x1 - 0.4; x += 0.55) {
      const inWin = winX.some((c) => Math.abs(x - c) < 1.4); const segs = inWin ? [[1.15, 2.85], [5.65, eave - 0.05]] : [[1.15, eave - 0.05]];
      for (const [a, b] of segs) F0.box({ p: [x + (rng() - 0.5) * 0.01, a, zz + sg * 0.03], s: [0.075, b - a, 0.05], mat: M.beam, bevel: 0.008, col: false, cast: false });
    }
    F0.box({ p: [(x0 + x1) / 2, 1.15, zz + sg * 0.05], s: [x1 - x0, 0.12, 0.09], mat: M.beam, bevel: 0.015, col: false, cast: false });                                                    // belt board on the plinth
    F0.box({ p: [(x0 + x1) / 2, eave - 0.1, zz + sg * 0.06], s: [x1 - x0 + 0.4, 0.22, 0.12], mat: M.beam, bevel: 0.02, col: false, cast: false });                                          // eaves fascia
    for (const c of winX) { const y0 = 2.85, hgt = 2.8;
      for (const su of [-1, 1]) F0.box({ p: [c + su * 1.36, y0, zz + sg * 0.06], s: [0.14, hgt, 0.09], mat: M.beam, bevel: 0.012, col: false, cast: false });                                       // casing
      F0.box({ p: [c, y0 + hgt, zz + sg * 0.07], s: [2.9, 0.16, 0.1], mat: M.beam, bevel: 0.02, col: false, cast: false }); F0.box({ p: [c, y0 - 0.1, zz + sg * 0.14], s: [2.95, 0.09, 0.26], mat: M.beam, bevel: 0.02, col: false, cast: false });   // lintel + sill
      for (const k of [-1, 0, 1]) F0.box({ p: [c + k * 0.66, y0, zz + sg * 0.03], s: [0.05, hgt, 0.05], mat: M.beam, col: false, cast: false });                                                    // muntins
      F0.box({ p: [c, y0 + hgt * 0.5, zz + sg * 0.03], s: [2.7, 0.05, 0.05], mat: M.beam, col: false, cast: false });
      for (const su of [-1, 1]) { const sx = c + su * 1.98; for (const st of [-1, 1]) F0.box({ p: [sx + st * 0.27, y0, zz + sg * 0.08], s: [0.06, hgt, 0.04], mat: M.paintGreen, col: false, cast: false }); for (const yy of [0.05, hgt * 0.5, hgt - 0.1]) F0.box({ p: [sx, y0 + yy, zz + sg * 0.08], s: [0.6, 0.08, 0.04], mat: M.paintGreen, col: false, cast: false });
        for (let k = 0; k < 16; k++) F0.box({ p: [sx, y0 + 0.14 + k * 0.165, zz + sg * 0.1], s: [0.5, 0.05, 0.012], pitch: sg * 0.55, mat: M.paintGreen, bevel: 0.002, col: false, cast: false }); }                     // louvred shutters
      F0.rock({ p: [c, y0 - 0.02, zz + sg * 0.26], r: 1.4, squash: [1, 0.09, 0.2], amp: 0.3, seed: 4, detail: 1, mat: M.snow, cast: false }); }
    // gutter along the eave with downpipes at the ends and every ~9 m; snow-guard bars on the roof
    const ey = eave - 0.22, ez = zz + sg * 1.72; B.tube({ pts: [[x0 - 1.4, ey, ez], [(x0 + x1) / 2, ey - 0.12, ez], [x1 + 1.4, ey, ez]], r: 0.075, mat: M.zinc, seg: 8, segs: 10, cast: false });
    for (const x of [x0 + 0.2, (x0 + x1) / 2 - 8, (x0 + x1) / 2 + 8, x1 - 0.2]) { F0.cyl({ p: [x, 0.1, ez - sg * 0.08], r: 0.055, h: ey - 0.15, seg: 8, mat: M.zinc, col: false, cast: false }); for (const yy of [1.0, 2.6, 4.2, 5.6]) F0.cyl({ p: [x, yy, ez - sg * 0.08], r: 0.07, h: 0.05, seg: 8, mat: M.iron, col: false, cast: false }); F0.beam([x, ey - 0.05, ez], [x, ey - 0.05, zz + sg * 0.07], 0.07, 0.07, { mat: M.zinc, col: false, cast: false }); }
  }
  // ---- stone plinth courses on the west facade + entrance: coursed ashlar blocks
  for (let i = 0; i < 14; i++) for (const zz of [-13.8, 21.8]) F0.box({ p: [x0 - 0.06 + (i % 2) * 0.02, 0.05 + (i % 3) * 0.0, zz + (i - 6) * 0.3 * 0], s: [0.05, 0.001, 0.001], mat: M.stone, col: false, cast: false });
  for (let j = 0; j < 4; j++) for (let k = 0; k < 24; k++) { const z = z0 + 0.4 + k * (z1 - z0 - 0.8) / 24 + (j % 2) * 0.55; if (z > z1 - 0.3) continue; F0.box({ p: [x0 - 0.06, j * 0.28, z], s: [0.14, 0.26, 1.42 + (rng() - 0.5) * 0.2], mat: M.stone, bevel: 0.03, col: false, cast: false }); }
  // ---- double glass entrance doors (x0, z = -6.6 / -4.4): frames, transom, push bars, kick plates, closer boxes; mats + ramp handrail
  for (const zz of [-6.6, -4.4]) { const dz = 1.05; for (const s of [-1, 1]) F0.box({ p: [x0 - 0.2, 0, zz + s * dz / 2], s: [0.1, 2.45, 0.08], mat: M.steel, bevel: 0.01, col: false, cast: false }); F0.box({ p: [x0 - 0.2, 2.35, zz], s: [0.1, 0.1, dz + 0.08], mat: M.steel, col: false, cast: false }); F0.box({ p: [x0 - 0.2, 0.0, zz], s: [0.1, 0.35, dz], mat: M.steel, col: false, cast: false });
    F0.cyl({ p: [x0 - 0.32, 1.0, zz + 0.4], r: 0.017, h: 0.7, seg: 6, mat: M.zinc, col: false, cast: false }); F0.box({ p: [x0 - 0.22, 2.3, zz], s: [0.08, 0.08, 0.5], mat: M.iron, col: false, cast: false }); }
  F0.box({ p: [x0 - 0.2, 2.45, -5.5], s: [0.1, 0.55, 3.2], mat: M.steel, col: false, cast: false });
  for (let k = 0; k < 7; k++) F0.box({ p: [x0 - 1.7 - k * 0.34, 0.0, -5.5], s: [0.3, 0.06 + k * 0.0, 3.4], mat: M.concrete, col: false, cast: false }); F0.box({ p: [x0 - 2.2, 0.0, -5.5], s: [1.8, 0.015, 2.4], mat: M.rubber, bevel: 0.004, col: false, cast: false });
  for (const zz of [-3.7, -7.3]) { F0.cyl({ p: [x0 - 3.2, 0, zz], r: 0.03, h: 1.0, seg: 6, mat: M.zinc, col: false, cast: false }); } F0.cyl({ p: [x0 - 3.2, 1.0, -5.5], r: 0.03, h: 3.6, seg: 6, mat: M.zinc, roll: 0, pitch: P / 2, anchor: 'center', col: false, cast: false });
  // barn lamps over the doors and notice boards on the plinth
  for (const zz of [-8.5, -2.5]) { F0.beam([x0 - 0.1, 3.05, zz], [x0 - 0.9, 3.05, zz], 0.05, 0.05, { mat: M.iron, col: false, cast: false }); F0.cyl({ p: [x0 - 0.95, 2.95, zz], r: [0.22, 0.05], h: 0.2, seg: 10, mat: M.iron, col: false, cast: false }); F0.cyl({ p: [x0 - 0.95, 2.9, zz], r: 0.07, h: 0.06, seg: 8, mat: M.glowWhite, col: false, cast: false }); halos.add([x0 - 0.95, 2.86, zz], 0xffe8b8, 0.9, 0.5, 0); }
  for (let k = 0; k < 4; k++) { const zz = 1.0 + k * 1.3; F0.box({ p: [x0 - 0.14, 1.25, zz], s: [0.05, 0.9, 1.0], mat: M.timberV, bevel: 0.01, col: false, cast: false }); for (let q = 0; q < 5; q++) F0.box({ p: [x0 - 0.18, 1.35 + (q % 3) * 0.24, zz - 0.35 + (q % 2) * 0.35 + rng() * 0.1], s: [0.008, 0.2, 0.16 + rng() * 0.08], mat: M.plaster, col: false, cast: false, roll: (rng() - 0.5) * 0.1 }); }   // flyers on a pinboard
  // bike / ski rack + heater vent grilles + cable trays along the north wall
  for (let k = 0; k < 6; k++) F0.cyl({ p: [-6 + k * 0.5, 0, z0 - 1.2], r: 0.02, h: 0.7, seg: 6, mat: M.zinc, col: false, cast: false }); F0.cyl({ p: [-4.75, 0.7, z0 - 1.2], r: 0.02, h: 2.6, seg: 6, mat: M.zinc, roll: P / 2, anchor: 'center', col: false, cast: false });
  for (const c of [3, 9, 15]) { F0.box({ p: [c, 0.4, z0 - 0.12], s: [0.7, 0.5, 0.2], mat: M.steel, bevel: 0.02, col: false, cast: false }); for (let k = 0; k < 6; k++) F0.box({ p: [c, 0.46 + k * 0.07, z0 - 0.23], s: [0.6, 0.02, 0.02], mat: M.iron, col: false, cast: false }); }
  F0.box({ p: [(x0 + x1) / 2, 6.1, z0 - 0.12], s: [x1 - x0 - 4, 0.12, 0.2], mat: M.steel, bevel: 0.01, col: false, cast: false }); for (let x = x0 + 3; x < x1 - 2; x += 1.2) F0.box({ p: [x, 6.1, z0 - 0.12], s: [0.02, 0.13, 0.21], mat: M.iron, col: false, cast: false });
}
