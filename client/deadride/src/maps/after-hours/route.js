// AFTER HOURS — route scenery between the lands, in absolute world coordinates: the elevated concrete beam (segmented, 12.5 m expansion joints) with support
// pylons, the park lawn, the ring of distant trees and the rides seen from the monorail (ferris wheel, roller-coaster loop, carousel, log flume, fireworks,
// searchlights, blimp). Rides animate through PARK.animators (ticked by the Monorail, which always updates).
import * as THREE from 'three';
import { HaloBatch, makeBeam } from '../../core/glow.js';
import { std } from '../../core/mats.js';
import { makeRng } from '../../core/util.js';
import { loftRaw, geo, disc, torus, pipe, glowMat, bulbMat, mergedMesh, coarseBatches, TAU, PI } from './common.js';
import { stripeMat } from './bake.js';
import { buildRides } from './rides.js';
import { PARK } from './park.js';
import { STATION_YAW } from './track.js';

export async function buildRoute(ctx) {
  const { B } = ctx; PARK.reset(); coarseBatches(B, 1400, 64, [700, 10, 700]); const T = PARK.track, R = makeRng(77), RC = () => R();
  const M = (name, pattern, colors, params, o = {}, extra) => B.m(name, { pattern, size: o.size || 512, tile: o.tile || 2, colors, params, bump: o.bump ?? 3, rough: o.rough || [0.6, 0.9], metal: o.metal || 0, layers: o.layers || {}, mossColor: o.mossColor }, extra);
  const beamM = M('beamConc', 'noise', [0xa9a69c, 0x8f8c83, 0x504e48, 0xbdbab0], { scale: 5, contrast: 2.5, fine: 100, speckle: 0.03, pores: 0.3, panels: 12, panelWidth: 0.004 }, { tile: 2.5, bump: 3, rough: [0.7, 0.95], layers: { grime: 0.45, streak: 0.55, dust: 0.2 } }, { breakup: 0.5 });
  const pylonM = M('pylonConc', 'noise', [0x9b988e, 0x84817a, 0x45433e, 0xb1aea4], { scale: 4, contrast: 2.5, fine: 90, speckle: 0.03, pores: 0.4, panels: 4, panelWidth: 0.005 }, { tile: 2, bump: 3, rough: [0.75, 0.97], layers: { grime: 0.5, streak: 0.6, moss: 0.08 } }, { breakup: 0.6 });
  const lawn = M('lawn', 'dirt', [0x1a2214, 0x222b18, 0x0d1009, 0x33402a], { scale: 5, pebbles: 0.02, cracks: 0, grass: 1 }, { size: 1024, tile: 3.2, bump: 30, rough: [0.85, 1], mossColor: 0x25341c }, { breakup: 0.9 });
  B.plane({ p: [0, -0.95, 0], s: [900, 900], mat: lawn, cast: false });
  // ---------------------------------------------------------------- the beam
  const SEG = 12.5, GAP = 0.03, W = 0.36, D = 1.15, CH = 0.07; const nseg = Math.round(T.L / SEG), segLen = T.L / nseg; const pt = {};
  const prof = [[-W, -CH], [-W + CH, 0], [W - CH, 0], [W, -CH], [W, -D + CH], [W - CH, -D], [-W + CH, -D], [-W, -D + CH]];        // chamfered box, y down from the beam top
  const railM = B.m('railDark', std({ color: 0x1a1c1f, roughness: 0.5, metalness: 0.7 }));
  const EX = [{ prof: [[-0.33, 0], [-0.33, 0.04], [-0.27, 0.04], [-0.27, 0]], mat: railM }, { prof: [[0.27, 0], [0.27, 0.04], [0.33, 0.04], [0.33, 0]], mat: railM }, { prof: [[0.365, -0.34], [0.365, -0.22], [0.42, -0.22], [0.42, -0.34]], mat: railM }, { prof: [[-0.1, -D], [-0.1, -D - 0.09], [0.1, -D - 0.09], [0.1, -D]], mat: railM }];   // running kerbs, power rail, cable duct under the beam
  for (let j = 0; j < nseg; j++) {
    const s0 = j * segLen + GAP, s1 = (j + 1) * segLen - GAP, n = Math.max(2, Math.round((s1 - s0) / 1.4)), rings = [], extra = EX.map((e) => ({ ...e, rings: [] }));
    for (let i = 0; i <= n; i++) {
      T.at(s0 + (s1 - s0) * i / n, pt); const cb = Math.cos(pt.bank), sb = Math.sin(pt.bank); const fx = pt.tx, fy = pt.ty, fz = pt.tz;
      let rx = -fz, ry = 0, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;                                                 // right = forward x up (horizontal)
      const ux0 = ry * fz - rz * fy, uy0 = rz * fx - rx * fz, uz0 = rx * fy - ry * fx;                                                          // up' = right x forward
      const RX = rx * cb + ux0 * sb, RY = ry * cb + uy0 * sb, RZ = rz * cb + uz0 * sb, UX = ux0 * cb - rx * sb, UY = uy0 * cb - ry * sb, UZ = uz0 * cb - rz * sb;
      rings.push(prof.map(([x, y]) => [pt.x + RX * x + UX * y, pt.y + RY * x + UY * y, pt.z + RZ * x + UZ * y]));
      for (const e of extra) e.rings.push(e.prof.map(([x, y]) => [pt.x + RX * x + UX * y, pt.y + RY * x + UY * y, pt.z + RZ * x + UZ * y]));
    }
    const c0 = rings[0][0].slice(); for (const r of rings) for (const q of r) { q[0] -= c0[0]; q[1] -= c0[1]; q[2] -= c0[2]; }             // chunk-local coordinates so the static batch can cull per segment
    B.addRaw(loftRaw(rings, { closed: true, capStart: true, capEnd: true, flip: true }), new THREE.Matrix4().makeTranslation(c0[0], c0[1], c0[2]), beamM, { cast: true });
    for (const e of extra) { for (const r of e.rings) for (const q of r) { q[0] -= c0[0]; q[1] -= c0[1]; q[2] -= c0[2]; } B.addRaw(loftRaw(e.rings, { closed: true, capStart: true, capEnd: true, flip: true }), new THREE.Matrix4().makeTranslation(c0[0], c0[1], c0[2]), e.mat, { cast: false }); }
  }
  // ---------------------------------------------------------------- pylons every 25 m (stations carry their own)
  const stationS = T.stations.map((s) => s.s); const nearStation = (s) => stationS.some((q) => { let d = Math.abs(s - q); d = Math.min(d, T.L - d); return d < 19; });
  const pylons = []; for (let s = 3.1; s < T.L; s += 25) { if (nearStation(s)) continue; T.at(s, pt); pylons.push({ s, x: pt.x, y: pt.y, z: pt.z, yaw: pt.yaw }); }
  for (const p of pylons) {
    const h = p.y - D - 0.12; B.box({ p: [p.x, -0.3, p.z], s: [2.2, 0.7, 2.2], yaw: p.yaw, mat: pylonM, bevel: 0.05, col: 'concrete', cast: true });
    B.cyl({ p: [p.x, 0.4, p.z], r: [1.0, 0.66], h: h - 0.4 - 0.55, seg: 4, yaw: p.yaw + PI / 4, mat: pylonM, col: 'concrete' });
    B.box({ p: [p.x, h - 0.55, p.z], s: [1.7, 0.55, 1.15], yaw: p.yaw, mat: pylonM, bevel: 0.06, cast: true }); B.box({ p: [p.x, h - 0.02, p.z], s: [0.9, 0.14, 0.8], yaw: p.yaw, mat: B.m('bearing', std({ color: 0x1c1d20, roughness: 0.5, metalness: 0.8 })), cast: false });
    { const c = Math.cos(p.yaw), sn = Math.sin(p.yaw), L = (lx, y, lz) => [p.x + lx * c + lz * sn, y, p.z - lx * sn + lz * c], bm = B.m('bearing');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl({ p: L(sx * 0.9, 0.4, sz * 0.9), r: 0.035, h: 0.16, seg: 6, mat: bm, cast: false });                                   // anchor bolts
      B.box({ p: L(0, h - 0.95, 0), s: [1.4, 0.16, 0.95], yaw: p.yaw, mat: pylonM, bevel: 0.02, cast: false }); B.box({ p: L(0, h - 0.8, 0), s: [1.2, 0.14, 0.8], yaw: p.yaw, mat: pylonM, bevel: 0.02, cast: false });   // stepped capital
      for (const sx of [-1, 1]) B.box({ p: L(sx * 0.16, 0.6, 0.66 - 0.1), s: [0.04, h - 1.6, 0.03], yaw: p.yaw, mat: bm, cast: false }); for (let y = 0.9; y < h - 1.3; y += 0.3) B.box({ p: L(0, y, 0.6 + 0.02), s: [0.36, 0.025, 0.025], yaw: p.yaw, mat: bm, cast: false });   // maintenance ladder
    }
  }
  ctx.pylons = pylons;
  // ---------------------------------------------------------------- materials for the rides + park hub
  const halos = new HaloBatch(320); B.group.add(halos.mesh);
  const paint = (name, c0, c1, c2, o = {}) => M(name, 'plates', [c0, c1, c2], { cols: 2, rows: 2, seam: 0.008, rivets: 6, brushed: 0.2, panelVar: 0.3 }, { tile: 2, bump: 2.5, metal: o.metal ?? 0.3, rough: [0.28, 0.6], layers: { grime: 0.3, edge: 0.4, scratch: 0.2 } });
  const RM = {
    steel: paint('rSteel', 0x6a7480, 0x59626d, 0x2a2f36), white: paint('rWhite', 0xe4e7ea, 0xd2d6da, 0x80868c), red: paint('rRed', 0xc8322e, 0xb02b28, 0x5a1412), teal: paint('rTeal', 0x2a9c96, 0x238882, 0x104440), chrome: std({ color: 0xd8dde0, roughness: 0.14, metalness: 1 }), chromeP: std({ color: 0xc8ced2, roughness: 0.2, metalness: 1 }), conc: beamM,
    gold: std({ color: 0xd4a83a, roughness: 0.3, metalness: 1 }), canopy: stripeMat(B, 'rCanopy', { c0: 0xb42f2b, c1: 0xe6dcc4, n: 10, tile: 2, side: THREE.DoubleSide }),
    bulbA: bulbMat(0xffc070, 12, { speed: 1.4, dir: [1, 0.6], freq: 0.5, dead: 0.1, base: 0.3 }), bulbB: bulbMat(0xff6aa8, 11, { speed: 2.0, dir: [0.4, 1], freq: 0.4, dead: 0.12, base: 0.25 }), bulbC: bulbMat(0x50f0e0, 10, { speed: 1.8, dir: [1, 1], freq: 0.35, dead: 0.1, base: 0.25 }),
    gondola: std({ color: 0xffffff, roughness: 0.32, metalness: 0.2 }), gondolaGlow: glowMat(0xffd890, 6, { flicker: 0.1, cell: 100, seed: 4 }), redRail: std({ color: 0xc8322e, roughness: 0.35, metalness: 0.5 }), carMat: std({ color: 0xffffff, roughness: 0.3, metalness: 0.3 }),
    flumeWater: std({ color: 0x0a3a3c, roughness: 0.04, metalness: 0.2, emissive: 0x0a8a80, emissiveIntensity: 0.35 }), boat: std({ color: 0xffffff, roughness: 0.75, map: null }), blimp: std({ color: 0xdfe3e8, roughness: 0.35, metalness: 0.3, envMapIntensity: 1.3 }),
  };
  buildRides(ctx, RM, halos);
  // pylon marker lamps
  for (const p of pylons) halos.add([p.x, p.y + 0.9, p.z], (p.s | 0) % 2 ? 0xff5030 : 0xffb040, 0.7, 0.5, 0);
  // ---------------------------------------------------------------- central lake with ring lights and a fountain show, paths + lamps, distant treeline
  const lakeM = std({ color: 0x03121a, roughness: 0.02, metalness: 0.3 }); disc(B, { p: [0, -0.5, 0], r1: 40, seg: 64, mat: lakeM, cast: false });
  const neonL = [glowMat(0x40e8ff, 8, { flicker: 0.02, cell: 6, seed: 1 }), glowMat(0xff3cc8, 8, { flicker: 0.03, cell: 6, seed: 2 })]; [[12, 0], [24, 1], [36, 0]].forEach(([r, k]) => torus(B, { p: [0, -0.42, 0], R: r, r: 0.1, seg: 5, tube: 96, mat: neonL[k], cast: false }));
  B.cyl({ p: [0, -0.5, 0], r: 40.6, h: 0.45, seg: 64, mat: beamM, open: true, cast: false });
  const jets = [[0, 0, 1.6]]; for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; jets.push([Math.cos(a) * 12, Math.sin(a) * 12, 1.0]); if (i % 2) jets.push([Math.cos(a) * 24, Math.sin(a) * 24, 1.2]); }
  for (const [x, z] of jets) { B.cyl({ p: [x, -0.5, z], r: 0.5, h: 0.5, seg: 8, mat: RM.steel, cast: false }); halos.add([x, 0.1, z], (x * 7 + z) % 2 ? 0x40e8ff : 0xff5cc8, 0.9, 0.5, 0); }
  { const O = new THREE.Vector3(); const EJ = { p: [0, -0.3, 0], v: [0, 0, 0], life: 1.9, size: [0.08, 0.05], c0: [0.8, 0.95, 1, 0.5], c1: [0.8, 0.95, 1, 0], gravity: 1, drag: 0.05, cell: 7 }; PARK.animators.push((dt, t) => { const cam = ctx.gfx.camera.position; if (Math.hypot(cam.x, cam.z) > 230) return; for (let i = 0; i < jets.length; i++) { if (Math.random() >= 0.55) continue; const j = jets[i]; EJ.p[0] = j[0]; EJ.p[2] = j[1]; EJ.v[0] = (Math.random() - 0.5) * 0.9; EJ.v[1] = 9 * j[2] + Math.random() * 2.5 + Math.sin(t * 1.3 + j[0]) * 2; EJ.v[2] = (Math.random() - 0.5) * 0.9; ctx.fx.alpha.emit(EJ, ctx.fx.time); } }); }
  const pathM = M('parkPath', 'asphalt', [0x2a2a2d, 0x1f1f22, 0xb0a890, 0x4a4a50], { scale: 5, aggregate: 0.4, cracks: 0.5, lines: 0 }, { tile: 4, bump: 8, rough: [0.3, 0.8], layers: { wet: 0.4, grime: 0.3 } }, { wet: true });
  for (const [x, z, w, d] of [[70, 0, 62, 5], [-70, 0, 62, 5], [0, 70, 5, 62], [0, -70, 5, 62]]) B.plane({ p: [x, -0.9, z], s: [w, d], mat: pathM, cast: false });
  { const lp = geo('rLampPole', () => new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6)), lg = geo('rLampGlobe', () => new THREE.SphereGeometry(0.26, 8, 6)), lgM = glowMat(0xffc880, 9, { flicker: 0.03, cell: 30, dead: 0.2, seed: 5 }), poleM = std({ color: 0x1c2024, roughness: 0.5, metalness: 0.8 }); let n = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let d = 46; d < 108; d += 14) for (const side of [-1, 1]) { const x = dx * d + (dz ? side * 3.6 : 0), z = dz * d + (dx ? side * 3.6 : 0); B.instance('rLampPole', lp, poleM, B.matrix([x, -0.9 + 2.1, z]), 0xffffff, { cast: false }); B.instance('rLampGlobe', lg, lgM, B.matrix([x, -0.9 + 4.3, z]), 0xffffff, { cast: false }); if (n++ % 2 === 0) halos.add([x, 3.5, z], 0xffc880, 0.5, 0.5, 0); } }
  { const tg = (() => { const parts = [], trunk = new THREE.CylinderGeometry(0.5, 0.7, 4, 5); trunk.translate(0, 2, 0); parts.push({ geo: trunk }); for (const [r, h, y] of [[5.2, 7, 5], [4.0, 6.5, 9], [2.7, 6, 13.2]]) { const c = new THREE.ConeGeometry(r, h, 7); c.translate(0, y + h / 2 - 1, 0); parts.push({ geo: c }); } return parts; })(); const tm = mergedMesh(B.group, tg, std({ color: 0xffffff, roughness: 1 })); B.group.remove(tm);
    const NT = 460, trees = new THREE.InstancedMesh(tm.geometry, std({ color: 0xffffff, roughness: 1, metalness: 0 }), NT); trees.frustumCulled = false; const m = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3();
    let nt = 0; for (let i = 0; i < NT; i++) { const a = RC() * TAU, r = 310 + RC() * 130, h = 1.2 + RC() * 1.8; const tx = Math.cos(a) * r, tz = Math.sin(a) * r; if (tx < -100 && Math.abs(tz) < 295) { RC(); RC(); RC(); RC(); RC(); continue; } pp.set(tx, -0.95, tz); sc.set(h, h * (0.9 + RC() * 0.5), h); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), RC() * TAU); m.compose(pp, q, sc); trees.setMatrixAt(nt, m); c.setRGB(0.012 + RC() * 0.02, 0.03 + RC() * 0.03, 0.02 + RC() * 0.02); trees.setColorAt(nt, c); nt++; } trees.count = nt; B.group.add(trees); }
  return { pylons };
}
