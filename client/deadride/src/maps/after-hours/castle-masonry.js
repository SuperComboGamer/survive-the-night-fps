// AFTER HOURS — Haunted Castle: the walls as REAL masonry (coursed ashlar blocks, battered plinths, string courses, corbel tables, voussoir arches, arrow slits, chains),
// pushed into the existing static batches. Real-world references: castle curtain wall course height 0.28-0.40 m, block length 0.5-1.1 m, arrow slit 1.0 x 0.16 m with splayed reveal,
// voussoir depth 0.4 m, chain link pitch 8.5 cm. Blocks are only modelled where a player can reach (<= 6 m); above that the coursed 'bricks' texture continues.
import * as THREE from 'three';
import { makeRng } from '../../core/util.js';
import { extrudeXY, pipe, TAU, PI } from './common.js';
import { grimeAtlas, grimeFace, grimeFlush } from './grime.js';
import { keepReal } from './castle-keep.js';
import { ashlar, ashlarRing, voussoirs, chain, cobbles } from './real.js';

export function masonry(K) {
  const { B, ashlarM, stone, stoneD, iron, wood, voidM } = K; const rng = makeRng(9091);
  const gA = grimeAtlas('grimeC', { dirt: 'rgba(10,14,10,A)', damp: 'rgba(8,16,12,A)', rust: 'rgba(120,70,30,A)', salt: 'rgba(190,200,190,A)', moss: 'rgba(40,86,44,A)', paint: 'rgba(110,120,112,A)', crack: 'rgba(2,4,4,0.9)' }, 21), gR = makeRng(31);
  const box = (x, y, z, sx, sy, sz, mat, o = {}) => B.box({ p: [x, y, z], s: [sx, sy, sz], mat, anchor: 'center', bevel: o.bevel ?? 0, cast: o.cast ?? false, yaw: o.yaw, pitch: o.pitch, roll: o.roll });
  // ---- curtain walls (front faces at z = -0.5, 10 m tall): plinth batter, coursed blocks, string course, corbel table, arrow slits
  for (const [x0, x1] of [[-40, -8.2], [8.2, 40]]) {
    const cx = (x0 + x1) / 2, L = x1 - x0; const buttress = (x) => { for (let bx = x0 + 4; bx < x1 - 2; bx += 9) if (Math.abs(x - bx) < 1.05) return true; return false; };
    const slits = [x0 + 6.5, x0 + 15.5, x0 + 24.5].filter((x) => x > x0 + 2 && x < x1 - 2);
    extrudeXY(B, { p: [cx, 0, -0.5], yaw: -PI / 2, pts: [[0, 0], [0.55, 0], [0.46, 0.45], [0.28, 1.0], [0, 1.25]], depth: L, mat: stoneD, cast: false });
    ashlar(B, { p: [x0, 0, -0.5], yaw: 0, w: L, h: 9.3, y0: 1.25, mat: ashlarM, rng, skip: (u, v, bw) => { const x = x0 + u; if (buttress(x)) return true; for (const sx of slits) if (Math.abs(x - sx) < 0.5 + bw / 2 && Math.abs(v - 4.6) < 0.95) return true; return false; } });
    grimeFace(B, gA, gR, { p: [x0, 0, -0.5 + 0.08], yaw: 0, w: L, h: 10, n: Math.round(L * 3.6), y0: 0.4, kinds: [0, 1, 2, 3, 4, 5, 9, 10, 14] });
    box(cx, 5.3, -0.5 + 0.13, L, 0.3, 0.3, stoneD);                                                                                   // string course
    for (let x = x0 + 0.6; x < x1; x += 1.05) { box(x, 9.72, -0.5 + 0.17, 0.44, 0.5, 0.34, stoneD); box(x, 9.4, -0.5 + 0.1, 0.34, 0.16, 0.2, stoneD); }   // corbels under the wall-walk
    for (const sx of slits) { box(sx, 4.6, -0.5 + 0.02, 0.16, 1.0, 0.22, voidM); for (const d of [-1, 1]) box(sx + d * 0.17, 4.6, -0.5 + 0.06, 0.16, 1.3, 0.16, stoneD); box(sx, 5.32, -0.5 + 0.06, 0.5, 0.18, 0.2, stoneD); box(sx, 3.86, -0.5 + 0.1, 0.5, 0.14, 0.28, stoneD); }   // slit + jambs + lintel + sill
    // buttresses: stepped with a weathered cap
    for (let bx = x0 + 4; bx < x1 - 2; bx += 9) { box(bx, 0.45, 0.02, 1.9, 0.9, 1.5, stoneD); box(bx, 8.35, 0.02, 1.34, 0.22, 1.26, stoneD); box(bx, 8.6, 0.02, 1.04, 0.3, 1.0, stoneD, { pitch: 0.0 }); }
  }
  // ---- gatehouse front (z = 2.1): blocks around the pointed-arch tunnel, voussoirs, keystone, string courses
  { const W = 16.4, GU = W / 2, aw = 4.6, ah = 6.8, p0 = ah - aw * 0.95;
    const hw = (v) => (v <= p0 ? aw / 2 : v > ah ? -1 : aw / 2 - (1 - Math.cos(Math.asin(Math.min(1, (v - p0) / (aw * 0.95))))) * aw * 0.55);
    ashlar(B, { p: [-8.2, 0, 2.1], yaw: 0, w: W, h: 12.6, y0: 0, mat: ashlarM, rng, skip: (u, v, bw) => Math.abs(u - GU) - bw / 2 < hw(v) + 0.46 || (Math.abs(u - GU) < 0.9 && v > 7.5 && v < 9.4) });
    const pts = [[GU - aw / 2, 0], [GU - aw / 2, p0]]; for (let i = 1; i < 10; i++) { const a = i / 10 * PI / 2 * 0.98; pts.push([GU - aw / 2 + (1 - Math.cos(a)) * aw * 0.55, p0 + Math.sin(a) * aw * 0.95]); } pts.push([GU, ah]);
    for (let i = 9; i >= 1; i--) { const a = i / 10 * PI / 2 * 0.98; pts.push([GU + aw / 2 - (1 - Math.cos(a)) * aw * 0.55, p0 + Math.sin(a) * aw * 0.95]); } pts.push([GU + aw / 2, p0], [GU + aw / 2, 0]);
    voussoirs(B, { p: [-8.2, 0, 2.1], yaw: 0, pts, center: [GU, p0], mat: stoneD, rng, out: 0.46, len: 0.55 });
    grimeFace(B, gA, gR, { p: [-8.2, 0, 2.1 + 0.1], yaw: 0, w: W, h: 12.4, n: 190, y0: 0.4, kinds: [0, 1, 2, 3, 4, 5, 9, 10, 14] });
    box(0, ah + 0.25, 2.1 + 0.02, 0.5, 0.62, 0.5, stoneD);                                                                           // keystone
    box(0, 6.5, 2.1 + 0.08, W, 0.3, 0.3, stoneD); box(0, 12.7, 2.1 + 0.2, W + 0.3, 0.32, 0.5, stoneD);                                // string courses
    for (let x = -8; x < 8.1; x += 1.0) { box(x, 12.25, 2.1 + 0.16, 0.42, 0.5, 0.34, stoneD); box(x, 11.95, 2.1 + 0.1, 0.32, 0.14, 0.2, stoneD); }   // corbel table
    for (const sx of [-1, 1]) { chain(B, [sx * 3.2, 9.6, 2.45], [sx * 3.2, 0.95, 13.6], iron, { sag: 0.35 }); box(sx * 3.2, 9.7, 2.3, 0.4, 0.4, 0.3, iron); }   // drawbridge chains (real links)
  }
  // ---- round towers: ashlar rings on the courtyard side (gate towers r 3.9 at x = +-10.6, outer towers r 5.4 at x = +-38.5)
  for (const sx of [-1, 1]) {
    ashlarRing(B, { c: [sx * 10.6, -1.4], r: 3.9, y0: 0.6, y1: 16.2, a0: 0.02, a1: PI - 0.02, mat: ashlarM, rng, skip: (x, y, z) => Math.abs(x) < 8.3 && z < 2.3 });
    ashlarRing(B, { c: [sx * 38.5, -2.5], r: 5.4, y0: 0.6, y1: 17.4, a0: 0.02, a1: PI - 0.02, mat: ashlarM, rng });
    for (const [cx, cz, r, y] of [[sx * 10.6, -1.4, 3.9, 12.15], [sx * 38.5, -2.5, 5.4, 11.15]]) for (let i = 0; i < 30; i++) { const a = i / 30 * PI, R = r + 0.12; box(cx + Math.cos(a) * R, y, cz + Math.sin(a) * R, 0.7, 0.3, 0.34, stoneD, { yaw: PI / 2 - a }); }   // string course ring
    B.cyl({ p: [sx * 10.6, 0, -1.4], r: [4.35, 4.0], h: 1.1, seg: 28, mat: stoneD }); B.cyl({ p: [sx * 38.5, 0, -2.5], r: [5.9, 5.55], h: 1.1, seg: 28, mat: stoneD });   // battered plinths
  }
  // ---- courtyard paving in front of the gate: real cobble setts (skipping the drawbridge)
  cobbles(B, { x0: -11, z0: 4, x1: 11, z1: 34, mat: K.ashlarM, rng, skip: [[-3.3, 2, 3.3, 15]] });
  // ---- drawbridge: nail heads, iron straps and plank imperfection
  for (let i = 0; i < 13; i++) { const z = 2.3 + i * 0.93; for (const x of [-2.9, -1.0, 1.0, 2.9]) for (const dz of [-0.3, 0.3]) box(x + (rng() - 0.5) * 0.05, -0.15, z + dz, 0.05, 0.02, 0.05, iron); if (i % 4 === 0) box(0, -0.16, z, 6.5, 0.03, 0.14, iron); }
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) box(sx * 3.4, 0.55, 2.6 + i * 2.0, 0.42, 0.14, 0.2, iron);
  keepReal({ B, ashlarM: K.ashlarM, stoneD, wood, iron, voidM, glowG: K.glowG });   // keep / porch / halls / turrets masonry, machicolations, hoardings, gargoyles, rose tracery (castle-keep.js)
  grimeFlush(B, gA);
}
