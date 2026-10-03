// SHAFT NINE — Stop 3: FLOODED LEVEL (y = -180). A concrete-lined pump gallery: vaulted hall with four giant multi-stage pumps, the pipe manifold
// (landmark), steel-grating catwalks and bridges over knee-to-waist black water, an overhead crane, a glazed control cabin, an electrical annex.
// Cold blue-green emergency lighting, red rotating beacons, rust, slime, dripping, analytic lamp reflections on the still water.
import * as THREE from 'three';
import { Parts } from './parts.js';
import { grating, scatter as scatterParts, bucket } from './parts2.js';
import { std, visVariant } from '../../core/mats.js';
import { signMaterial } from '../../core/canvas2d.js';
import { makeRng, TAU } from '../../core/util.js';
import { makeBeam } from '../../core/glow.js';
import { Cavity, shape, surfaceNets, addShell, shellColliders } from './sdf.js';
import { installBake, bakeable, prepGeo } from './bake.js';
import { normalizePatch, unifyPrograms, phaser, lampGloss, puddleWater, setEmitters, PI, OPEN, SHAFT, at, cylBetween, pipeRun, barrel, crateBox, handrail, steelLadder, signQuad, lightPool, lin, makeHalos, tubeLamp, bulbLamp, gratingMaterial, waterMaterial, waterRect, Drips, meshMaterial, steelRawMat, steelRustMat, puddleMaterial, stairCheeks, cliffBlocker } from './kit.js';
import { shaftMats, shaftLining } from './shaft.js';
import { buildLanding } from './landing.js';
import { custom, TIMBER, STRATA, SHUTTER, COAL, CINDER } from './glsl.js';

const WATER = -0.4, FLOOR = -1.05, VX = 13.2;
const top = (ax) => 4.4 + 4.8 * Math.sqrt(Math.max(0, 1 - (ax / VX) ** 2));
const concFrag = (oy) => `
{ float ly = vWPos.y - (${oy.toFixed(2)}); vec3 wn = normalize(vWN); float wallK = 1.0 - smoothstep(0.5, 0.85, abs(wn.y));
  float n = zfbm3(vWPos * vec3(1.1, 0.7, 1.1)); float below = smoothstep(${(WATER + 0.06).toFixed(2)}, ${(WATER - 0.4).toFixed(2)}, ly + n * 0.12); float band = exp(-pow((ly - ${(WATER + 0.04).toFixed(2)} + n * 0.08) * 5.5, 2.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.04, 0.03) * (0.7 + n), below * 0.92); roughnessFactor = mix(roughnessFactor, 0.1, below); diffuseColor.rgb *= 1.0 - band * 0.35 * wallK;
  float dr = smoothstep(0.6, 0.92, zvn3(vec3(vWPos.x * 6.0 + vWPos.z * 6.0, ly * 0.35, vWPos.x * 3.0))) * wallK * smoothstep(-0.2, 3.5, ly); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.055, 0.02), dr * 0.5);
  float ef = smoothstep(0.7, 0.95, zvn3(vec3(vWPos.x * 3.0 + vWPos.z * 3.0, ly * 0.9, 1.7))) * smoothstep(2.0, 6.0, ly); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.45, 0.4), ef * 0.35); }`;

export default {
  id: 'flooded', name: 'Flooded Level', origin: [0, -180, 0], viewRadius: 120,
  async build(ctx) {
    const { B, fx } = ctx; const oy = ctx.origin.y; const R = makeRng(180); const t0 = performance.now(); const ph = phaser('flooded');
    const bb = installBake(B, { cell: 100, cellY: 80, shift: [45, 20, 10] }); B.inst.cell = 100; const halos = makeHalos(B, 260); const E = { B, ctx, halos, bake: bb, gloss: [] };
    // ------------------------------------------------------------ materials
    const conc = bakeable(B.m('fConc', custom(SHUTTER, [12, 1, 0.5, 0.8, 0.6, 0.4], { colors: [0x565f5d, 0x6f7977, 0x232b2a], size: 1024, tile: 3, bump: 7, rough: [0.62, 0.97], layers: { grime: 0.35 } }), { triplanar: 1 / 3, vis: true, breakup: 0.4, wet: true, frag: concFrag(oy) }));
    const rockW = bakeable(B.m('fRock', custom(STRATA, [4, 0.1, 0.7, 0.4, 6, 0.0, 0.0], { colors: [0x0e1214, 0x1a2024, 0x252d33, 0x3a444c], size: 512, tile: 4, bump: 110, rough: [0.4, 0.9] }), { triplanar: 1 / 4, vis: true, breakup: 0.4, wet: true }));
    const floorC = bakeable(B.m('fFloorW', { pattern: 'noise', size: 512, tile: 3, colors: [0x2c3634, 0x222b2a, 0x111817, 0x445250], params: { scale: 6, contrast: 3, fine: 90, speckle: 0.06, pores: 0.5, panels: 0, panelWidth: 0 }, bump: 5, rough: [0.4, 0.8], layers: { grime: 0.7, moss: 0.35, streak: 0.3 }, mossColor: 0x1c3324 }, { vis: true, wet: true, breakup: 0.5 }));
    const slab = B.m('fSlab', custom(SHUTTER, [4, 0, 0.3, 0.7, 0.4, 0.5, 0.6], { colors: [0x5b6462, 0x707b79, 0x252d2c], size: 512, tile: 3, bump: 4, rough: [0.4, 0.9], layers: { grime: 0.6, oil: 0.5 } }), { wet: true, breakup: 0.5 });
    const paint = B.m('fPaint', { pattern: 'plates', size: 512, tile: 2, colors: [0x4f8f80, 0x3a7064, 0x16332e], rustColor: 0x5a3018, params: { cols: 2, rows: 2, seam: 0.012, rivets: 8, brushed: 0.15, panelVar: 0.4 }, bump: 3, metal: 1, rough: [0.4, 0.75], layers: { rust: 0.16, grime: 0.6, edge: 0.55, scratch: 0.4, streak: 0.5 } }, { breakup: 0.5, wet: true });
    const pipe = B.m('fPipe', { pattern: 'plates', size: 512, tile: 2, colors: [0x6e4a2c, 0x54381f, 0x1c120a], rustColor: 0x6a3416, params: { cols: 1, rows: 1, seam: 0.0, rivets: 0, brushed: 0.6 }, bump: 2, metal: 1, rough: [0.45, 0.85], layers: { rust: 0.16, grime: 0.6, streak: 0.6, edge: 0.2 } }, { breakup: 0.5, wet: true });
    const pipeG = B.m('fPipeG', { pattern: 'plates', size: 512, tile: 2, colors: [0x4c6b58, 0x3a5646, 0x131d17], rustColor: 0x5a3018, params: { cols: 1, rows: 1, seam: 0.0, rivets: 0, brushed: 0.6 }, bump: 2, metal: 1, rough: [0.4, 0.8], layers: { rust: 0.16, grime: 0.6, streak: 0.5, edge: 0.3 } }, { breakup: 0.5, wet: true });
    const yellow = B.m('fYellow', { pattern: 'plates', size: 256, tile: 1, colors: [0xb08f1e, 0x8a6f14, 0x2a2005], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.4 }, bump: 1, metal: 0.6, rough: [0.45, 0.8], layers: { grime: 0.5, edge: 0.6, scratch: 0.5 } });
    const steelRaw = steelRawMat(B); const grate = B.m('fGrate', gratingMaterial({ color: 0x4a5257, rust: 0.3 }));
    const redPaint = B.m('fRed', std({ color: 0x8a1c14, metalness: 0.4, roughness: 0.45, key: 'fRed' })), brass = B.m('fBrass', std({ color: 0xa98a3d, metalness: 1, roughness: 0.32, key: 'fBrass' })), dark = B.m('fDark', std({ color: 0x07090a, roughness: 0.7, key: 'fDark' }));
    const glass = B.m('fGlass', std({ color: 0x0b1a1c, roughness: 0.05, metalness: 0.3, key: 'fGlass', emissive: 0x0a2226, emissiveIntensity: 0.6 }));
    const pGreen = B.m('fPanelG', std({ color: 0x000000, emissive: 0x30ff90, emissiveIntensity: 5, key: 'fPanelG' })), pAmber = B.m('fPanelA', std({ color: 0x000000, emissive: 0xffa020, emissiveIntensity: 5, key: 'fPanelA' })), pRed = B.m('fPanelR', std({ color: 0x000000, emissive: 0xff2010, emissiveIntensity: 6, key: 'fPanelR' }));
    const cord = B.m('fCord', std({ color: 0x050606, roughness: 0.7, key: 'fCord' })); const puddle = B.m('fPuddle', puddleWater(0x060a0a));

    // ------------------------------------------------------------ cavity: vaulted concrete hall z 1.75..55, shaft, west drift, east annex, far door corridor
    const inShaft = (x, z) => Math.abs(x) < 2.6 && z < 1.85; const Z0 = 1.75, Z1 = 55;
    const hall = shape.fn((x, y, z) => { const ax = Math.abs(x); return Math.max(0.8 * (y - top(ax)), ax - VX, Math.abs(z - (Z0 + Z1) / 2) - (Z1 - Z0) / 2, -(y + 9)); }, [-VX, -9, Z0, VX, 9.3, Z1]);
    const cav = new Cavity({ noise: [{ f: [0.3, 0.4, 0.3], a: 0.3, seed: 1 }, { f: [0.9, 1.4, 0.9], a: 0.16, seed: 2 }, { f: [2.1, 3, 2.1], a: 0.07, seed: 3 }], fade: 2.5,
      noiseMul: (x, y, z) => (Math.abs(x) < VX + 0.6 && z > 1.6 && z < Z1 + 0.3 ? 0.05 : 1) });
    cav.air(shape.box(0, -0.5, 0, 2.35, 7.5, 1.75, 0.05)); cav.air(hall);
    cav.air(shape.box(-25, 1.2, 30, 12.6, 2.3, 1.7, 0.4)); cav.air(shape.box(14.0, 1.3, 26, 1.4, 2.3, 1.6, 0.15)); cav.air(shape.box(18.2, 1.6, 26, 4.6, 2.7, 6.2, 0.3)); cav.air(shape.box(8, 1.3, 57, 1.7, 2.3, 3.0, 0.15));
    cav.late((x, y, z, a) => (inShaft(x, z) ? a : Math.min(a, y - FLOOR)));
    ph('materials+ops'); const grid = cav.bake([-40, -9, -5], [26, 10, 61], 0.5); bb.air = grid.sample; ph('sdf bake'); const mesh = surfaceNets(grid); ph('surface nets');
    addShell(B, mesh, { conc, rockW, floorC }, (nx, ny, nz, y, x, z) => (ny > 0.93 && Math.abs(y - FLOOR) < 0.05 ? 'floorC' : (Math.abs(x) > VX + 0.35 || (z > Z1 + 0.35) ? 'rockW' : 'conc')), { cast: false });
    ph('addShell'); B.colliders.groundY = FLOOR; shellColliders(B, grid, { x0: -40, x1: 26, z0: -5, z1: 61, cell: 0.5, floor: () => FLOOR, thr: 0.2, skin: 2 }); ph('shell colliders');

    // ------------------------------------------------------------ shaft stub (concrete) + landing
    const sm = shaftMats(B, 'concrete'); shaftLining(B, sm, { y0: -8, y1: 7, style: 'concrete', front: [{ y0: 0, y1: OPEN.h }], collide: true, seed: 3 });
    const landing = buildLanding(ctx, B, { frame: conc, steel: steelRaw, mesh: meshMaterial({ kind: 'grid', cell: 0.05, wire: 3.4, tile: 0.4 }), plate: paint }, { style: 'steel' });

    // ------------------------------------------------------------ platforms: apron, central pump floor, far apron (concrete slabs), catwalks (grating), bridges, stairs
    const slabBox = (x0, x1, z0, z1, y0 = FLOOR, o = {}) => B.box({ p: [(x0 + x1) / 2, y0, (z0 + z1) / 2], s: [x1 - x0, -y0, z1 - z0], mat: slab, bevel: 0.03, col: 'concrete', tag: 'deck', ...o });
    const PT = new Parts(B, R);
    slabBox(-13.1, 13.1, Z0, 9.05); slabBox(-6.2, 6.2, 9.05, 47); slabBox(-13.1, 13.1, 47, Z1 - 0.05); slabBox(6.3, 9.7, Z1 - 0.06, 60.2);        // far-door corridor floor at apron level
    for (const s of [-1, 1]) B.box({ p: [s * 6.2, -0.03, 28], s: [0.14, 0.04, 38], mat: yellow, bevel: 0.005, cast: false });
    for (const s of [-1, 1]) {
      const cx = s * 12.4; B.box({ p: [cx, FLOOR, 28], s: [1.6, -FLOOR - 0.06, 38], mat: slab, bevel: 0.02, col: 'concrete', tag: 'deck' }); B.box({ p: [cx, -0.06, 28], s: [1.6, 0.06, 38], mat: grate, bevel: 0, col: 'metal', cast: false });
      grating(PT, steelRaw, { x0: cx - 0.8, x1: cx + 0.8, z0: 9.05, z1: 47, y: 0.032, edge: [0, 0, 0, 0] });
      handrail(B, yellow, [s * 11.62, 0, 9.05], [s * 11.62, 0, 47], { posts: 1.9, toe: true });
      for (const zb of [17, 33]) { B.box({ p: [s * 8.9, -0.08, zb], s: [5.6, 0.08, 1.8], mat: dark, bevel: 0, col: 'metal', cast: false, tag: 'deck' }); grating(PT, steelRaw, { x0: s * 8.9 - 2.8, x1: s * 8.9 + 2.8, z0: zb - 0.9, z1: zb + 0.9, y: 0.03, edge: [0, 0, 0, 0] }); for (const q of [-0.8, 0.8]) B.box({ p: [s * 8.9, -0.4, zb + q], s: [5.7, 0.3, 0.1], mat: steelRaw, bevel: 0.01, cast: false }); handrail(B, yellow, [s * 6.2, 0, zb - 0.9], [s * 11.6, 0, zb - 0.9], { posts: 1.6 }); handrail(B, yellow, [s * 6.2, 0, zb + 0.9], [s * 11.6, 0, zb + 0.9], { posts: 1.6 }); }
      for (const [za, zb2] of [[9.05, 10.6], [12.4, 16.1], [17.9, 24.1], [25.9, 32.1], [33.9, 40.1], [41.9, 47]]) handrail(B, yellow, [s * 6.2, 0, za], [s * 6.2, 0, zb2], { posts: 1.8 });
      for (const zs of [11.5, 25, 41]) { B.stairs({ p: [s * 7.9, FLOOR, zs], n: 5, rise: 0.21, run: 0.3, w: 1.5, yaw: s > 0 ? PI : 0, mat: slab, col: 'concrete' }); stairCheeks(B, slab, { p: [s * 7.9, FLOOR, zs], yaw: s > 0 ? PI : 0, n: 5, rise: 0.21, run: 0.3, w: 1.5, t: 0.14, surface: 'concrete' }); }
    }
    // west drift mouth: stairs up out of the water onto the west catwalk ledge (the drift floor is 1.05 m below it)
    B.stairs({ p: [-15.0, FLOOR, 30], n: 5, rise: 0.21, run: 0.3, w: 2.6, yaw: 0, mat: slab, col: 'concrete' }); stairCheeks(B, slab, { p: [-15.0, FLOOR, 30], yaw: 0, n: 5, rise: 0.21, run: 0.3, w: 2.6, t: 0.14, surface: 'concrete' });

    // ------------------------------------------------------------ concrete ribs (pilasters + arch segments) every 4.4 m
    for (let z = 5.5; z < Z1 - 1; z += 4.4) {
      for (const s of [-1, 1]) B.box({ p: [s * (VX - 0.2), FLOOR, z], s: [0.5, 4.4 - FLOOR, 0.62], mat: conc, bevel: 0.03, cast: false, col: false });
      const N = 16; let prev = null; for (let i = 0; i <= N; i++) { const a = PI * i / N; const x = -VX * Math.cos(a) * 0.985, y = 4.4 + 4.8 * Math.sin(a) * 0.985 - 0.25; const q = [x, y, z]; if (prev) B.beam(prev, q, 0.62, 0.5, { mat: conc, bevel: 0.03, cast: false }); prev = q; }
    }
    // ------------------------------------------------------------ pumps (4) with plinths, motors, ring-section barrels, suction + discharge pipes, gate valves
    const bolts = (c, axis, r, n, mat, rb = 0.028) => { for (let i = 0; i < n; i++) { const a = i * TAU / n; const q = axis === 'z' ? [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]] : axis === 'x' ? [c[0], c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r] : [c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]; B.cyl({ p: q, r: rb, h: 0.07, seg: 6, mat, pitch: axis === 'z' ? PI / 2 : 0, roll: axis === 'x' ? PI / 2 : 0, anchor: 'center', cast: false }); } };
    const valve = (p, r, mat, hand = 0.55) => { B.cyl({ p: [p[0], p[1] - 0.45, p[2]], r: r * 1.05, h: 0.9, seg: 16, mat }); B.cyl({ p: [p[0], p[1] + 0.35, p[2]], r: r * 0.55, h: 0.7, seg: 12, mat }); cylBetween(B, [p[0], p[1] + 1.0, p[2]], [p[0], p[1] + 1.35, p[2]], 0.03, steelRaw, { seg: 6 }); B.tube({ pts: [[p[0] + hand, p[1] + 1.35, p[2]], [p[0], p[1] + 1.35, p[2] + hand], [p[0] - hand, p[1] + 1.35, p[2]], [p[0], p[1] + 1.35, p[2] - hand]], r: 0.03, mat: redPaint, closed: true, seg: 6, segs: 24 }); for (let k = 0; k < 4; k++) cylBetween(B, [p[0], p[1] + 1.35, p[2]], [p[0] + Math.cos(k * PI / 2) * hand, p[1] + 1.35, p[2] + Math.sin(k * PI / 2) * hand], 0.014, redPaint, { seg: 5 }); };
    const pumps = [[-3.6, 14], [3.6, 14], [-3.6, 28], [3.6, 28]];
    pumps.forEach(([xc, z0], i) => {
      const s = xc > 0 ? 1 : -1; const zA = z0 - 3.4;
      B.box({ p: [xc, 0, z0], s: [2.5, 0.5, 7.0], mat: slab, bevel: 0.03, col: 'concrete' });
      B.cyl({ p: [xc, 1.55, zA + 1.3], r: 0.86, h: 2.6, seg: 24, mat: paint, pitch: PI / 2, anchor: 'center', col: false }); B.cyl({ p: [xc, 1.55, zA + 1.3], r: 0.9, h: 0.16, seg: 24, mat: steelRaw, pitch: PI / 2, anchor: 'center' });
      for (let k = 0; k < 8; k++) B.cyl({ p: [xc, 1.55, zA + 0.25 + k * 0.32], r: 0.88, h: 0.06, seg: 24, mat: steelRaw, pitch: PI / 2, anchor: 'center', cast: false });          // cooling fins
      B.box({ p: [xc, 1.05, zA + 1.3], s: [1.7, 0.5, 2.7], mat: paint, bevel: 0.04, cast: false }); B.box({ p: [xc, 2.5, zA + 1.1], s: [0.7, 0.4, 0.9], mat: paint, bevel: 0.05 });   // motor feet, terminal box
      B.cyl({ p: [xc, 1.55, zA + 3.05], r: 0.35, h: 0.55, seg: 16, mat: yellow, pitch: PI / 2, anchor: 'center' }); B.box({ p: [xc, 1.55, zA + 3.05], s: [1.4, 1.2, 0.6], mat: yellow, bevel: 0.05, cast: false });   // coupling guard
      for (let k = 0; k < 6; k++) B.cyl({ p: [xc, 1.5, zA + 3.7 + k * 0.5], r: 0.86, h: 0.16, seg: 24, mat: paint, pitch: PI / 2, anchor: 'center', col: false }); B.cyl({ p: [xc, 1.5, zA + 5.2], r: 0.66, h: 3.3, seg: 20, mat: paint, pitch: PI / 2, anchor: 'center' });
      B.sphere({ p: [xc, 1.5, zA + 6.7], r: 0.62, seg: 16, ps: 0.5, pitch: PI / 2, mat: paint }); B.box({ p: [xc, 0.7, zA + 5.3], s: [1.9, 0.3, 3.4], mat: paint, bevel: 0.04, cast: false });
      bolts([xc, 1.5, zA + 3.45], 'z', 0.78, 16, steelRaw); bolts([xc, 1.5, zA + 3.95], 'z', 0.78, 16, steelRaw);
      // suction (into the flooded aisle) and discharge (up to the header)
      const sp = [[xc, 1.0, zA + 6.6], [xc + s * 1.2, 1.0, zA + 6.9], [s * 6.7, 0.5, zA + 6.9], [s * 6.9, -0.9, zA + 6.9]]; pipeRun(B, sp, 0.34, pipeG, { flange: 2.6, seg: 16 });
      const hy = i % 2 === 0 ? 6.5 : 5.55; pipeRun(B, [[xc, 2.2, zA + 4.9], [xc, hy, zA + 4.9], [xc, hy, 50.5]], 0.28, pipe, { flange: 5.5, seg: 14 }); valve([xc, 3.0, zA + 4.9], 0.4, pipeG, 0.5);
      bolts([xc, 2.2, zA + 4.9], 'y', 0.36, 12, steelRaw); for (const gz of [zA + 5.4]) { B.cyl({ p: [xc + s * 0.35, 2.7, gz], r: 0.09, h: 0.03, seg: 12, mat: brass, pitch: PI / 2, anchor: 'center', cast: false }); B.cyl({ p: [xc + s * 0.35, 2.7, gz - 0.02], r: 0.1, h: 0.04, seg: 12, mat: steelRaw, pitch: PI / 2, anchor: 'center', cast: false }); }
    });
    // ------------------------------------------------------------ manifold header (landmark): header pipe, tees, exit lines into the east wall, big valves, gauges, bolts
    const HY = 6.05, HZ = 50.5;
    B.cyl({ p: [-6.3, HY, HZ], r: 0.78, h: 12.6, seg: 24, mat: pipe, roll: PI / 2, anchor: 'center' }); for (let x = -6; x <= 6.1; x += 2.4) { B.cyl({ p: [x, HY, HZ], r: 0.9, h: 0.22, seg: 24, mat: pipe, roll: PI / 2, anchor: 'center', cast: false }); bolts([x, HY, HZ], 'x', 0.83, 20, steelRaw, 0.032); }
    B.cyl({ p: [0.0, HY, HZ], r: 0.78, h: 12.6, seg: 24, mat: pipe, roll: PI / 2, anchor: 'center', cast: false });
    pipeRun(B, [[6.0, HY, HZ], [13.4, HY, HZ]], 0.78, pipe, { flange: 3.0, seg: 24 }); valve([9.0, HY + 0.35, HZ], 0.95, pipe, 1.0); B.box({ p: [8.9, HY + 1.4, HZ - 0.45], s: [1.6, 0.12, 0.12], mat: steelRaw, cast: false });
    B.sphere({ p: [-6.7, HY, HZ], r: 0.86, seg: 20, mat: pipe });  for (let k = 0; k < 6; k++) { const gx = -5 + k * 2.1; B.cyl({ p: [gx, HY + 0.7, HZ], r: 0.06, h: 0.5, seg: 8, mat: steelRaw, cast: false }); B.cyl({ p: [gx, HY + 1.05, HZ - 0.06], r: 0.14, h: 0.06, seg: 16, mat: brass, pitch: PI / 2, anchor: 'center', cast: false }); }
    for (const [x, z0] of pumps.map((p) => [p[0], p[1]])) { const hy = z0 === 14 ? 6.5 : 5.55; B.sphere({ p: [x, hy, 50.4], r: 0.35, seg: 12, mat: pipe, cast: false }); }
    for (const s of [-1, 1]) for (const z of [12, 20, 36, 44]) { cylBetween(B, [s * 13.0, 4.2, z], [s * 10.5, 4.2, z], 0.16, pipeG, { seg: 10 }); }
    signQuad(B, signMaterial({ lines: ['MAIN DISCHARGE', 'LINE 1 · 2 · 3 · 4'], bg: '#c9a227', fg: '#111', w: 512, h: 128, weather: 0.9 }), [3.0, 3.9, 50.92], 1.6, 0.4, PI);

    // ------------------------------------------------------------ overhead crane (rails, bridge, trolley, hoist block on chain)
    for (const s of [-1, 1]) { B.box({ p: [s * 8.1, 7.05, 30], s: [0.34, 0.5, 52], mat: yellow, bevel: 0.02, col: false }); for (let z = 5.5; z < Z1 - 1; z += 4.4) B.box({ p: [s * 8.75, 6.9, z], s: [1.4, 0.3, 0.4], mat: steelRaw, bevel: 0.02, cast: false }); }
    const bz = 22; B.box({ p: [0, 6.75, bz], s: [16.6, 0.6, 0.5], mat: yellow, bevel: 0.02, col: false }); B.box({ p: [0, 6.45, bz], s: [1.6, 0.9, 1.2], mat: paint, bevel: 0.04, col: false }); for (const s of [-1, 1]) B.box({ p: [s * 8.1, 6.4, bz], s: [0.6, 0.7, 1.4], mat: paint, bevel: 0.04, cast: false });
    cylBetween(B, [0.5, 6.4, bz], [0.5, 4.3, bz], 0.012, steelRaw, { seg: 5 }); B.box({ p: [0.5, 3.75, bz], s: [0.34, 0.55, 0.34], mat: yellow, bevel: 0.03 }); B.tube({ pts: [[0.5, 3.75, bz], [0.62, 3.4, bz], [0.5, 3.25, bz], [0.3, 3.5, bz]], r: 0.03, mat: steelRaw, seg: 6, segs: 16 });

    // ------------------------------------------------------------ control cabin (west, on legs over the apron, glazed) + stairs
    const CX0 = -12.9, CX1 = -7.6, CZ0 = 47.6, CZ1 = 54.6, CY = 3.4;
    for (const [x, z] of [[CX0 + 0.3, CZ0 + 0.3], [CX1 - 0.3, CZ0 + 0.3], [CX0 + 0.3, CZ1 - 0.3], [CX1 - 0.3, CZ1 - 0.3]]) { B.box({ p: [x, 0, z], s: [0.3, CY, 0.3], mat: paint, bevel: 0.02, col: 'metal' }); }
    B.box({ p: [(CX0 + CX1) / 2, CY - 0.15, (CZ0 + CZ1) / 2], s: [CX1 - CX0, 0.15, CZ1 - CZ0], mat: paint, bevel: 0.02, col: 'metal', tag: 'deck' }); B.box({ p: [(CX0 + CX1) / 2, CY + 2.5, (CZ0 + CZ1) / 2], s: [CX1 - CX0 + 0.3, 0.2, CZ1 - CZ0 + 0.3], mat: paint, bevel: 0.03, col: false });
    B.box({ p: [(CX0 + CX1) / 2, CY, CZ0], s: [CX1 - CX0, 2.5, 0.16], mat: paint, bevel: 0.01, col: 'metal' }); B.box({ p: [CX0, CY, (CZ0 + CZ1) / 2], s: [0.16, 2.5, CZ1 - CZ0], mat: paint, bevel: 0.01, col: 'metal' }); B.box({ p: [(CX0 + CX1) / 2, CY, CZ1], s: [CX1 - CX0, 2.5, 0.16], mat: paint, bevel: 0.01, col: 'metal' }); B.box({ p: [CX1, CY, CZ1 - 0.3], s: [0.16, 2.5, 0.6], mat: paint, bevel: 0.01, col: 'metal' }); B.box({ p: [CX1, CY, (CZ0 + 52.0) / 2], s: [0.16, 2.5, 52.0 - CZ0], mat: paint, bevel: 0.01, col: 'metal' }); B.box({ p: [CX1, CY + 2.0, 53.0], s: [0.16, 0.5, 2.0], mat: paint, bevel: 0.01, col: false });
    B.box({ p: [(CX0 + CX1) / 2, CY + 1.05, CZ0 - 0.02], s: [CX1 - CX0 - 0.5, 1.1, 0.05], mat: glass, bevel: 0, cast: false }); B.box({ p: [CX1 + 0.01, CY + 1.05, CZ0 + 2.6], s: [0.05, 1.1, 1.6], mat: glass, bevel: 0, cast: false });
    for (let k = 0; k < 6; k++) B.box({ p: [CX0 + 1.0 + k * 0.75, CY + 0.0, CZ0 + 0.4], s: [0.6, 0.85, 0.5], mat: dark, bevel: 0.02, cast: false });
    for (let k = 0; k < 6; k++) for (let j = 0; j < 3; j++) B.box({ p: [CX0 + 0.85 + k * 0.75, CY + 0.9 + j * 0.16, CZ0 + 0.66], s: [0.1, 0.05, 0.03], mat: R() < 0.55 ? pGreen : R() < 0.7 ? pAmber : pRed, bevel: 0, cast: false });
    halos.add([(CX0 + CX1) / 2, CY + 1.3, CZ0 + 0.7], 0x30ff90, 3.0, 0.35, 0); bulbLamp(E, [-10.2, CY + 2.15, 51.0], { cageMat: steelRaw, cordMat: cord, color: 0xbfe8ff, I: 4, R: 6, size: 0.45, pool: 0, hang: 0.3, halo: 0.5, glowK: 9 });
    B.stairs({ p: [-7.1, 0, 48.3], n: 19, rise: 0.179, run: 0.28, w: 1.0, yaw: -PI / 2, mat: grate, col: 'metal' }); stairCheeks(B, steelRaw, { p: [-7.1, 0, 48.3], yaw: -PI / 2, n: 19, rise: 0.179, run: 0.28, w: 1.0, t: 0.08, surface: 'metal', sides: [-1] });
    cylBetween(B, [-6.62, 0.95, 48.3], [-6.62, CY + 0.95, 53.62], 0.022, yellow, { seg: 6, cast: false }); cylBetween(B, [-6.62, 0.5, 48.3], [-6.62, CY + 0.5, 53.62], 0.018, yellow, { seg: 6, cast: false }); for (let i = 0; i <= 19; i += 3) B.cyl({ p: [-6.62, i * 0.179, 48.3 + i * 0.28], r: 0.02, h: 0.98, seg: 5, mat: yellow, cast: false });
    for (const [x, z, sx, sz] of [[(CX0 + CX1) / 2, CZ0 + 0.1, CX1 - CX0, 0.16], [CX0 + 0.1, (CZ0 + CZ1) / 2, 0.16, CZ1 - CZ0], [(CX0 + CX1) / 2, CZ1 - 0.1, CX1 - CX0, 0.16], [CX1 - 0.1, (CZ0 + CZ1) / 2, 0.16, CZ1 - CZ0]]) B.box({ p: [x, 0, z], s: [sx, CY - 0.2, sz], mat: paint, bevel: 0.02, col: 'metal' });      // plinth: solid base under the cabin floor

    signQuad(B, signMaterial({ lines: ['PUMP CONTROL', 'AUTHORISED ONLY'], bg: '#122b2c', fg: '#bfe8e0', w: 512, h: 160, weather: 0.9 }), [-10.3, 5.55, 47.5], 2.0, 0.6, PI);

    // ------------------------------------------------------------ electrical annex (east): transformer, switchgear, cable trays, warning signs; annex floor raised to y=0
    B.box({ p: [18.4, FLOOR, 26], s: [9.2, -FLOOR, 12.4], mat: slab, bevel: 0.02, col: 'concrete' }); B.box({ p: [14.1, FLOOR, 26], s: [2.4, -FLOOR, 3.2], mat: slab, bevel: 0.02, col: 'concrete' });
    B.box({ p: [19.5, 0, 21.4], s: [3.0, 2.4, 2.2], mat: paint, bevel: 0.05, col: 'metal' }); for (let k = 0; k < 14; k++) B.box({ p: [19.5, 0.2, 20.2 + k * 0.18], s: [3.2, 2.0, 0.05], mat: steelRaw, bevel: 0.006, cast: false }); for (const x of [18.6, 19.5, 20.4]) { B.cyl({ p: [x, 2.4, 21.4], r: 0.11, h: 0.5, seg: 10, mat: pipeG }); B.cyl({ p: [x, 2.9, 21.4], r: 0.16, h: 0.14, seg: 10, mat: steelRaw, cast: false }); }
    for (let k = 0; k < 6; k++) { B.box({ p: [16.4 + k * 0.85, 0, 31.6], s: [0.8, 2.2, 0.6], mat: paint, bevel: 0.03, col: 'metal' }); B.box({ p: [16.4 + k * 0.85, 1.3, 31.28], s: [0.5, 0.3, 0.03], mat: dark, cast: false }); B.box({ p: [16.25 + k * 0.85, 1.75, 31.27], s: [0.1, 0.05, 0.03], mat: R() < 0.5 ? pGreen : pAmber, cast: false }); }
    for (let x = 14.8; x < 22.6; x += 0.9) B.box({ p: [x, 3.3, 26], s: [0.06, 0.06, 12], mat: steelRaw, cast: false }); B.box({ p: [18.6, 3.25, 26], s: [7.6, 0.06, 0.5], mat: steelRaw, cast: false });
    signQuad(B, signMaterial({ lines: ['DANGER', '6600 V'], bg: '#a3140f', fg: '#f8f2e2', w: 256, h: 192, weather: 0.9 }), [17.5, 1.9, 20.3], 0.7, 0.5, 0); signQuad(B, signMaterial({ lines: ['SUBSTATION', 'No.180'], bg: '#122b2c', fg: '#bfe8e0', w: 256, h: 128, weather: 0.9 }), [14.6, 2.4, 24.32], 1.0, 0.5, 0);
    bulbLamp(E, [18.5, 3.3, 26], { cageMat: steelRaw, cordMat: cord, color: 0xffd08a, I: 6, R: 8, size: 0.7, pool: 2.4, hang: 0.5 });
    // steel bulkhead with a 1.5 x 1.9 opening at the annex door (x = 13.2) for the barricade + far door bulkhead (z = 55)
    for (const [z0, z1] of [[24.5, 25.25], [26.75, 27.5]]) B.box({ p: [13.3, 0, (z0 + z1) / 2], s: [0.3, 3.8, z1 - z0], mat: paint, bevel: 0.02, col: 'metal' }); B.box({ p: [13.3, 1.9, 26], s: [0.3, 1.9, 1.5], mat: paint, bevel: 0.02, col: false });
    for (const [x0, x1] of [[6.5, 7.25], [8.75, 9.5]]) B.box({ p: [(x0 + x1) / 2, 0, Z1 - 0.15], s: [x1 - x0, 3.8, 0.3], mat: paint, bevel: 0.02, col: 'metal' }); B.box({ p: [8, 1.9, Z1 - 0.15], s: [1.5, 1.9, 0.3], mat: paint, bevel: 0.02, col: false });
    B.box({ p: [8.0, 0, Z1 - 0.35], s: [0.14, 2.2, 0.14], mat: steelRaw, cast: false, col: false });

    // ------------------------------------------------------------ props: tool bench, barrels, drums, crates, pallets, hoses, ladders, lockers, signage
    B.box({ p: [3.5, 0, 52.4], s: [2.4, 0.9, 0.9], mat: paint, bevel: 0.03, col: 'metal' }); B.box({ p: [3.5, 0.9, 52.4], s: [2.5, 0.06, 1.0], mat: steelRaw, bevel: 0.01 }); for (let k = 0; k < 3; k++) B.box({ p: [2.9 + k * 0.6, 0.96, 52.3], s: [0.4, 0.14, 0.24], mat: yellow, bevel: 0.02, cast: false });
    for (let k = 0; k < 5; k++) barrel(B, pipe, [-2.0 + (k % 3) * 0.66, 0, 51.2 + Math.floor(k / 3) * 0.7]); for (let k = 0; k < 3; k++) barrel(B, pipeG, [6.0 + k * 0.62, 0, 53.4]);
    crateBox(B, slab, [-1.2, 0, 47.6], [1.0, 0.8, 0.8], { yaw: 0.2 }); crateBox(B, paint, [9.6, 0, 50.0], [1.2, 1.0, 0.9], { yaw: -0.15 });
    steelLadder(B, steelRaw, [-13.0, FLOOR, 12.5], 5.0, PI / 2 * 3, { width: 0.5 });
    // hose reels + fire cabinet on the apron wall, first aid
    for (const s of [-1, 1]) { B.box({ p: [s * 12.95, 1.0, 5.2], s: [0.25, 0.9, 0.7], mat: redPaint, bevel: 0.02, cast: false }); B.cyl({ p: [s * 12.75, 1.45, 5.2], r: 0.28, h: 0.15, seg: 18, mat: redPaint, roll: PI / 2, anchor: 'center', cast: false }); }
    signQuad(B, signMaterial({ lines: ['LEVEL 180', 'PUMP STATION'], bg: '#122b2c', fg: '#bfe8e0', w: 512, h: 160, weather: 0.85 }), [0, 4.6, 8.9], 3.0, 0.9, PI); signQuad(B, signMaterial({ lines: ['LEVEL 180', 'PUMP STATION'], bg: '#122b2c', fg: '#bfe8e0', w: 512, h: 160, weather: 0.85 }), [0, 4.6, 8.86], 3.0, 0.9, 0); for (const x of [-1.4, 1.4]) { cylBetween(B, [x, 5.05, 8.88], [x, 8.9, 8.88], 0.02, steelRaw, { seg: 5 }); }
    for (const [x, z] of [[-3.2, 48.8], [3.2, 48.8], [-9, 52.6], [9, 52.6], [0, 53.6]]) { B.beam([x, 0, z], [x, 3.4, z], 0.1, 0.1, { mat: steelRaw }); bulbLamp(E, [x, 3.5, z], { cageMat: steelRaw, cordMat: cord, color: 0xffc888, I: 20, R: 12, size: 0.9, pool: 0, hang: 0.15, glowK: 12 }); }
    for (const s of [-1, 1]) signQuad(B, signMaterial({ lines: ['DEEP WATER', 'KEEP OFF'], bg: '#c9a227', fg: '#111', w: 256, h: 128, weather: 0.9 }), [s * 6.25, 0.9, 12.5], 0.6, 0.3, s > 0 ? PI / 2 : -PI / 2);
    for (const [x, z, s] of [[-2, 24, 2.4], [3, 38, 2.0], [0, 12, 1.8], [-3, 44, 1.6], [4, 48, 1.8], [-5, 8, 1.6]]) signQuad(B, puddle, [x, 0.012, z], s * 1.5, s, R() * PI, { pitch: -PI / 2 });

    // ------------------------------------------------------------ platform clutter + cover (aisle |x|<2.3 and the box at z=40 stay clear)
    { const jb = (x, z, yaw) => { B.box({ p: [x, 0, z], s: [2.4, 0.84, 0.5], yaw, mat: slab, bevel: 0.03, col: 'concrete' }); B.box({ p: [x, 0.84, z], s: [2.4, 0.16, 0.34], yaw, mat: slab, bevel: 0.03, cast: false }); for (const k of [-0.9, 0.9]) { const q = at([x, 0, z], k, 0.55, 0.26, yaw); B.box({ p: [q[0], q[1], q[2]], s: [0.34, 0.1, 0.02], yaw, mat: yellow, bevel: 0, cast: false }); } };
      jb(3.0, 21.0, 0.25); jb(-3.2, 34.5, -0.2); jb(4.6, 45.0, 1.4);
      const cyls = (x, z, yaw) => { for (let k = 0; k < 3; k++) { const q = at([x, 0, z], (k - 1) * 0.27, 0, 0, yaw); B.cyl({ p: [q[0], 0.18, q[2]], r: 0.115, h: 1.32, seg: 12, mat: k === 1 ? redPaint : paint, col: false }); B.sphere({ p: [q[0], 1.5, q[2]], r: 0.115, seg: 10, ps: 0.5, mat: k === 1 ? redPaint : paint, cast: false }); B.cyl({ p: [q[0], 1.42, q[2]], r: 0.05, h: 0.1, seg: 8, mat: brass, cast: false }); }
        B.box({ p: [x, 0.1, z], s: [0.95, 0.05, 0.42], yaw, mat: steelRaw, bevel: 0.01, col: 'metal' }); B.box({ p: [x, 0.45, at([x, 0, z], 0, 0, 0.21, yaw)[2]], s: [0.95, 0.04, 0.03], yaw, mat: steelRaw, cast: false }); for (const sd of [-1, 1]) { const q = at([x, 0, z], sd * 0.4, 0, 0.0, yaw); B.cyl({ p: [q[0], 0.14, q[2]], r: 0.14, h: 0.05, seg: 14, mat: dark, pitch: PI / 2, yaw, anchor: 'center', cast: false }); } };
      cyls(4.5, 19.2, -0.4);
      // pallet of cement sacks
      B.box({ p: [-4.4, 0, 20.6], s: [1.2, 0.14, 1.0], mat: B.m('fPallet', { pattern: 'planks', size: 256, tile: 1, colors: [0x3d4646, 0x232b2b, 0x0a0d0d], params: { rows: 6, gap: 0.01, grain: 6, knots: 0.3, cols: 1, weather: 0.7, nails: 1 }, bump: 3, rough: [0.7, 0.95], layers: { grime: 0.5, dust: 0.2 } }, { wet: true }), bevel: 0.01, col: 'wood' });
      for (let y = 0; y < 4; y++) for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) B.box({ p: [-4.4 + (i - 0.5) * 0.5 + (y % 2) * 0.06, 0.14 + y * 0.17, 20.6 + (j - 1) * 0.31], s: [0.46, 0.17, 0.3], mat: slab, bevel: 0.05, cast: true, col: y === 0 && i === 0 && j === 1 ? 'fabric' : false });
      // spare impeller on skids, concrete pipe rings, drum group, tool chests, hose coil
      B.box({ p: [-4.6, 0, 37.0], s: [1.6, 0.12, 0.9], mat: pipe, bevel: 0.02, col: 'wood' }); B.cyl({ p: [-4.6, 0.12, 37.0], r: 0.62, h: 0.34, seg: 24, mat: pipeG, col: 'metal' }); B.cyl({ p: [-4.6, 0.46, 37.0], r: [0.62, 0.18], h: 0.32, seg: 24, mat: pipeG, cast: true }); for (let k = 0; k < 8; k++) { const a = k * TAU / 8; B.box({ p: [-4.6 + Math.cos(a) * 0.4, 0.3, 37.0 + Math.sin(a) * 0.4], s: [0.5, 0.04, 0.05], yaw: -a, mat: steelRaw, cast: false }); }
      for (const [x, y] of [[4.3, 0.6], [5.5, 0.6], [4.9, 1.64]]) B.cyl({ p: [x, y, 38.7], r: 0.6, h: 1.2, seg: 24, mat: slab, pitch: PI / 2, anchor: 'center', col: y < 1 ? 'concrete' : false });
      for (let k = 0; k < 6; k++) barrel(B, k % 2 ? paint : redPaint, [-5.2 + (k % 3) * 0.66, 0, 43.4 + Math.floor(k / 3) * 0.66], { tilt: k === 5 ? PI / 2 : 0 });
      crateBox(B, paint, [4.6, 0, 42.2], [1.0, 0.7, 0.55], { yaw: 0.1 }); crateBox(B, dark, [4.7, 0.7, 42.1], [0.7, 0.28, 0.5], { yaw: -0.05 });
      B.tube({ pts: Array.from({ length: 25 }, (_, i) => { const a = i * 0.5; return [2.0 + Math.cos(a) * (0.32 - i * 0.008), 0.05 + Math.floor(i / 12) * 0.1, 27.0 + Math.sin(a) * (0.32 - i * 0.008)]; }), r: 0.04, mat: B.m('fHose', std({ color: 0x111820, roughness: 0.6, key: 'fHose' })), seg: 6, segs: 60, cast: true });
      for (const [x, z] of [[1.9, 33.4], [-1.6, 25.6], [5.3, 25.3], [-5.4, 47.4]]) { B.cyl({ p: [x, 0, z], r: [0.15, 0.04], h: 0.7, seg: 10, mat: B.m('fCone', std({ color: 0xc23a10, roughness: 0.6, key: 'fCone' })), col: false }); B.cyl({ p: [x, 0, z], r: 0.2, h: 0.03, seg: 10, mat: B.m('fCone', std({ color: 0xc23a10, roughness: 0.6, key: 'fCone' })), cast: false }); B.cyl({ p: [x, 0.35, z], r: [0.088, 0.075], h: 0.11, seg: 10, mat: slab, cast: false }); }
    }
    // dim emergency lamps down the flooded west drift (one dying, one red)
    bulbLamp(E, [-19, 2.9, 30.2], { cageMat: steelRaw, cordMat: cord, color: 0xff9a50, I: 7, R: 9, size: 0.85, pool: 0, hang: 0.5, flicker: 0.12 }); bulbLamp(E, [-27, 2.9, 29.8], { cageMat: steelRaw, cordMat: cord, color: 0xffb070, I: 5, R: 8, size: 0.7, pool: 0, hang: 0.5, flicker: 0.5 }); bulbLamp(E, [-34, 2.9, 30.2], { cageMat: steelRaw, cordMat: cord, color: 0xff4a28, I: 6, R: 9, size: 0.85, pool: 0, hang: 0.5, flicker: 0.2 });

    { const bottleG = B.m('fBottle', std({ color: 0x2a3a2a, roughness: 0.08, metalness: 0.1 })), CM = { iron: steelRaw, dark, glass: bottleG, post: B.mats.get('fPallet') || slab, board: B.mats.get('fPallet') || slab, brick: slab, hat: B.m('fHat', std({ color: 0x6a5410, roughness: 0.55 })) };
      for (const a of [[-5.4, 10, 5.4, 46], [-13, 9.4, -11.7, 46], [11.7, 9.4, 13, 46], [-13, 47.5, 13, 54.5]]) scatterParts(PT, CM, { area: a, n: a[2] - a[0] > 8 ? 44 : 34, kinds: ['bucket', 'bottle', 'plank', 'hat', 'brick', 'bucket', 'plank'] }); }
    console.log('[flooded] real parts triangles', PT.tris); PT.flush();
    // ------------------------------------------------------------ lighting: emergency tubes (cold), a few dead/flickering, red beacons, green exit signs
    const tubes = []; let ti = 0;
    for (let z = 3.3; z < Z1 - 1; z += 4.4) for (const s of [-1, 1]) { const dead = R() < 0.14; tubes.push(tubeLamp(E, [s * 12.9, 3.6, z], { yaw: PI / 2, len: 1.2, color: 0xbff6ee, I: dead ? 0 : 30, R: 14, glowK: dead ? 0.2 : 9, flicker: (ti++ % 5 === 0) ? 0.55 : 0.02, real: !dead })); }
    for (let z = 6; z < Z1 - 2; z += 6) tubes.push(tubeLamp(E, [0, 6.4, z], { yaw: 0, len: 1.5, color: 0xa8fff0, I: 30, R: 15, glowK: 8, flicker: 0.03 }));
    for (const x of [-3, 3]) bulbLamp(E, [x, 3.2, 4.3], { cageMat: steelRaw, cordMat: cord, color: 0xcaf4ff, I: 22, R: 10, size: 0.9, pool: 3.2, poolK: 0.15, hang: 1.2 });
    for (const z of [10, 26, 44]) { halos.add([0, 8.0, z], 0xff2810, 1.6, 1.1, 0); }
    const beacons = [[-4.0, 7.4, 12], [4.0, 7.4, 29], [-4.0, 7.4, 45]].map(([x, y, z]) => { const g = new THREE.Group(); g.position.set(x, y, z); B.group.add(g); const cone = makeBeam({ length: 18, r0: 0.05, r1: 1.3, color: 0xff2410, intensity: 0.2, dust: 1, near: 1.5 }); const cone2 = makeBeam({ length: 18, r0: 0.05, r1: 1.3, color: 0xff2410, intensity: 0.2, dust: 1, near: 1.5 }); cone.lookAt(0, 0, 1); cone2.lookAt(0, 0, -1); g.add(cone, cone2); const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2010, emissiveIntensity: 5 })); g.add(dome); halos.add([x, y, z], 0xff2810, 0.9, 1.2, 4); if (bb) bb.light({ p: [x, y - 0.3, z], c: [1, 0.12, 0.05], I: 3, R: 12, s: 0.4, shadow: true }); return g; });
    for (const z of [18, 44]) ctx.light({ pos: [0, 8.3, z], color: 0xc8fff4, intensity: 200, distance: 26, decay: 2, kind: 'spot', dir: [0, -1, 0.12], angle: 0.72, penumbra: 0.75, shadow: true });
    for (const [x, z] of [[0, 18], [0, 44], [-3.6, 30], [3.6, 8.5]]) { const bm = makeBeam({ length: 9, r0: 0.25, r1: 2.3, color: 0xbff6ee, intensity: 0.09, dust: 1, near: 1.5 }); bm.position.set(x, 8.4, z); bm.lookAt(x, 0, z + 1.0); B.group.add(bm); lightPool(B, [x, 0.03, z + 1.0], 3.2, 0.07, 0xbff6ee); }   // light shafts down from the vault
    // floating debris on the flooded aisles (planks, drums, crates): bobbing + drifting, with ring ripples around them
    const debris = []; { const wood = B.mats.get('fPallet'); const mk = (geo, mat, x, z, yaw, o = {}) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, WATER, z); m.rotation.set(o.rx || 0, yaw, o.rz || 0); m.castShadow = false; m.receiveShadow = true; B.group.add(m); debris.push({ m, x, z, yaw, ph: R() * 6.28, rx: o.rx || 0, rz: o.rz || 0, ring: R() * 2 }); return m; };
      const plank = (l) => new THREE.BoxGeometry(l, 0.05, 0.2), drum = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 14).rotateZ(PI / 2), crate = new THREE.BoxGeometry(0.7, 0.5, 0.55);
      [[-8.6, 15, 0.3, 1.5], [-9.6, 22.5, 1.2, 1.1], [-7.4, 31, 2.4, 1.7], [-10.2, 39, 0.6, 1.3], [8.5, 17, 1.8, 1.6], [9.7, 26, 0.2, 1.2], [7.6, 35.5, 2.9, 1.5], [10.3, 43, 1.0, 1.0], [-22, 30.2, 0.4, 1.4], [-29, 29.6, 1.9, 1.2]].forEach(([x, z, yaw, l]) => mk(plank(l), wood, x, z, yaw, { rz: (R() - 0.5) * 0.1 }));
      mk(drum, paint, -6.9, 27, 0.7); mk(drum, pipe, 10.9, 32, 2.2); mk(crate, wood, -10.9, 45, 0.5); mk(crate, wood, 7.2, 12, 1.4); }
    const redLight = ctx.light({ pos: [0, 7.2, 29], color: 0xff2410, intensity: 5, distance: 11, decay: 2, kind: 'point', flicker: 0 });
    for (const [x, z] of [[-9, 6], [9, 6]]) { B.box({ p: [x, 2.7, z - 0.1], s: [0.7, 0.28, 0.08], mat: B.m('fExit', std({ color: 0x001a08, emissive: 0x30ff70, emissiveIntensity: 6, key: 'fExit' })), cast: false }); halos.add([x, 2.85, z - 0.1], 0x40ff80, 0.6, 0.6, 0); }

    // ------------------------------------------------------------ water (aisles + west drift), reflections of tubes/beacons, drips
    const emit = []; for (const t of tubes) { if (!t || t.intensity <= 0) continue; if (emit.length < 20 && Math.abs(t.pos.x) > 5 ? R() < 0.42 : false) emit.push({ p: [t.pos.x, t.pos.y + 0.15, t.pos.z], c: [0.42, 0.95, 0.85], s: 0.5 }); } for (const b of beacons) if (emit.length < 24) emit.push({ p: [b.position.x, b.position.y + oy, b.position.z], c: [1, 0.15, 0.06], s: 0.4 });
    for (let z = 6; z < Z1 - 2 && emit.length < 24; z += 8.8) emit.push({ p: [0, 8.4 + oy, z], c: [0.4, 1.0, 0.9], s: 0.7 });
    const wmat = waterMaterial({ color: 0x031412, emitters: emit, alphaBase: 0.9, ripple: 0.8, key: 'fW', shade: '{ float dpt = (1.0 - smoothstep(0.0, 2.7, abs(abs(wp.x) - 8.9))) * step(abs(wp.x), 12.6); float murk = zfbm3(wp * vec3(0.55, 0.2, 0.55) + 2.0); diffuseColor.rgb = mix(vec3(0.035, 0.10, 0.095), vec3(0.004, 0.02, 0.028), clamp(dpt * 0.8 + murk * 0.35, 0.0, 1.0)); }' }); ctx.water = wmat;
    waterRect(B, wmat, [-8.9, WATER, 28], 5.4, 38); waterRect(B, wmat, [8.9, WATER, 28], 5.4, 38); waterRect(B, wmat, [-25, WATER, 30], 23.5, 3.5);
    const dr = new Drips(fx, [{ p: [-9, 5.5, 20], y: WATER + oy, h: 5.9, rate: 2.2 }, { p: [8.6, 6.0, 33], y: WATER + oy, h: 6.4, rate: 1.7 }, { p: [-7.8, 4.4, 40], y: WATER + oy, h: 4.8, rate: 2.8 }, { p: [7.4, 5.0, 14], y: WATER + oy, h: 5.4, rate: 2.0 }, { p: [-24, 3.0, 30], y: WATER + oy, h: 3.4, rate: 1.4 }, { p: [3.6, 5.5, 20.4], y: 0 + oy, h: 5.5, rate: 3.0 }, { p: [-3.6, 5.6, 34], y: 0 + oy, h: 5.6, rate: 3.4 }].map((q) => ({ ...q, p: [q.p[0], q.p[1] + oy, q.p[2]] })));
    { const g = E.gloss, mid = g.filter((e) => Math.abs(e.p[0]) < 5), side = g.filter((e) => Math.abs(e.p[0]) >= 5).filter((_, i) => i % 3 === 0); const extra = beacons.map((b) => ({ p: [b.position.x, b.position.y, b.position.z], c: [2.4, 0.3, 0.1], s: 0.3 }));
      const gl = [...mid, ...extra, ...side]; lampGloss(B, oy, gl, { k: 1.0 }); setEmitters(puddle, gl, oy); }
    ctx.weather({ type: 'dust', count: 700, box: [30, 8, 30], fall: 0.01, size: 0.012, turb: 0.25, color: [0.5, 0.75, 0.75], alpha: 0.1, cell: 9, seed: 21, wind: [0.1, 0, 0.15] });
    const atmo = {
      name: 'Shaft Nine · Flooded Level', fog: { color: 0x02080a, scatter: 0x061c1e, density: 0.0075, falloff: 0.0, base: 0, power: 2.0 },
      sky: null, sun: { dir: [0.0, 0.06, 1], color: 0x9fffee, intensity: 0, shadow: false }, env: { intensity: 0.16 },
      exposure: 1.0, bloom: 0.42, vignette: 0.45, grain: 0.04, chroma: 0.002, ao: 0.9, wet: 0.85, reverb: 'mineShaft',
      grade: { sat: 0.92, contrast: 1.2, lift: [0.0, 0.006, 0.01], gain: [0.96, 1.0, 1.02], tint: [0.97, 1.0, 1.02] }, autoExposure: { key: 0.1, min: 0.9, max: 2.0 },
    };
    ph('props+lights'); ph.done(); console.log('[flooded] build ms', (performance.now() - t0).toFixed(0));
    const sirenT = { v: 0 };
    normalizePatch(B, { breakup: 0.4, addBreakup: true, wet: true });
    return {
      onReady(st) { const u = unifyPrograms(st.group); console.log('[flooded] programs after unify', u.programs, 'meshes', u.meshes, '| build+finish ms', (performance.now() - t0).toFixed(0)); },
      atmo, envPatches: [{ dir: [0, 1, 0.1], color: 0x60c0c0, size: 4, intensity: 6 }, { dir: [0.6, 0.1, 0.4], color: 0x306080, size: 3, intensity: 2 }],
      playerStart: { pos: [0, 0, 9.2], yaw: PI }, station: { pos: [0, 0, 0], yaw: 0 }, groundY: FLOOR, groundSurface: 'water', waterY: WATER, landing,
      navBounds: [-41, -3, 26, 61], navBlocked: cliffBlocker(B.colliders), landmark: { pos: [0, 6, 50.5], name: 'Pump Manifold' },
      spawns: [{ kind: 'walk', pos: [-35.5, FLOOR, 30], yaw: -PI / 2 }, { kind: 'barricade', pos: [14.0, 0, 26], yaw: PI / 2, boards: 5 }, { kind: 'barricade', pos: [8, 0, 56.6], yaw: 0, boards: 5 }, { kind: 'rise', pos: [-9, FLOOR, 24], yaw: -PI / 2 }, { kind: 'rise', pos: [9, FLOOR, 38], yaw: PI / 2 }, { kind: 'rise', pos: [-9, FLOOR, 44], yaw: -PI / 2 }, { kind: 'rise', pos: [9, FLOOR, 21], yaw: PI / 2 }],
      buys: { walls: [{ pos: [-13.05, 1.5, 6.2], yaw: PI / 2, gun: 'mp5' }, { pos: [13.05, 1.5, 6.2], yaw: -PI / 2, gun: 'm14' }], perks: [{ pos: [-4.6, 0, 52.9], yaw: PI, perk: 'doubletap' }], box: { pos: [0, 0, 40], yaw: PI } },
      zombieVariants: ['miner_drowned', 'miner_lamp', 'miner_gas', { id: 'miner_foreman', weight: 0.5, minRound: 3 }],
      ambient: { space: 'mineShaft', gain: 1, beds: [{ type: 'water', gain: 0.3, kind: 'lap' }, { type: 'machine', kind: 'pump', freq: 47, gain: 0.22, pos: 'far' }, { type: 'hum', freq: 100, gain: 0.05 }, { type: 'rumble', freq: 32, gain: 0.12 }], events: [{ type: 'drip', every: [0.5, 2.4], gain: 0.55, pos: 'around', pitch: [0.8, 1.2] }, { type: 'pipe', every: [7, 18], gain: 0.4, pos: 'far' }, { type: 'clank', every: [12, 30], gain: 0.3, pos: 'far' }, { type: 'bubble', every: [4, 10], gain: 0.3, pos: 'around' }, { type: 'creak', every: [8, 20], gain: 0.3, pos: 'far' }] },
      update(dt, t, active) {
        for (const d of debris) { const ph = t * 0.8 + d.ph; d.m.position.set(d.x + Math.sin(t * 0.11 + d.ph) * 0.35, WATER + 0.015 + Math.sin(ph) * 0.022, d.z + Math.cos(t * 0.09 + d.ph * 1.7) * 0.5); d.m.rotation.set(d.rx + Math.sin(ph * 0.9) * 0.03, d.yaw + Math.sin(t * 0.17 + d.ph) * 0.12, d.rz + Math.cos(ph * 0.7) * 0.03); d.ring -= dt; if (active && d.ring < 0) { d.ring = 1.4 + Math.random() * 1.6; fx.alpha.emit({ p: [d.m.position.x, WATER + oy + 0.012, d.m.position.z], v: [0, 0, 0], life: 1.6, size: [0.25, 0.9], c0: [0.7, 0.85, 0.9, 0.3], c1: [0.7, 0.85, 0.9, 0], cell: 14, rot: 0 }, fx.time); } }
        for (const g of beacons) g.rotation.y += dt * 2.6; redLight.intensity = 3.5 + 3 * Math.max(0, Math.sin(t * 2.6 * 1.0)); dr.update(dt, active);
        if (active && Math.random() < dt * 0.6) { fx.puff({ x: 9 + (Math.random() - 0.5) * 0.4, y: 3.2 + oy, z: 36 }, { x: 0, y: 1, z: 0 }, 1, { speed: 0.6, size: [0.15, 0.9], life: 2.6, color: [0.6, 0.7, 0.7, 0.16], rise: 0.9, drag: 0.6, spread: 0.3, cell: 1 }); }
      },
    };
  },
};
