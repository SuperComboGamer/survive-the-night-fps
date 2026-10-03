// SHAFT NINE — Stop 2: TIMBERED TUNNELS (y = -90). A dark coal-measure level: a big timber-framed junction hall at the shaft (hoist bell + signal
// board = landmark), a long timbered main drift with a track and ore tubs, a west gallery (pit-pony stalls, miners' lamp room), an east gallery
// (dynamite magazine, ventilation fan, cave-in), a mezzanine stage, coal seams in raw rock. Warm tungsten pools in near-black.
import * as THREE from 'three';
import { pipe as ductPipe } from './parts2.js';
import { profFlat } from './rawgeo.js';
import { std } from '../../core/mats.js';
import { signMaterial } from '../../core/canvas2d.js';
import { makeRng, rand, TAU } from '../../core/util.js';
import { makeBeam } from '../../core/glow.js';
import { Cavity, shape, surfaceNets, addShell, shellColliders } from './sdf.js';
import { installBake, bakeable } from './bake.js';
import { Parts, member, bolt, T as partT } from './parts.js';
import { scatter as scatterParts, rockPile } from './parts2.js';
import { normalizePatch, unifyPrograms, phaser, cutawayFill, lampGloss, puddleWater, setEmitters, Drips, PI, OPEN, SHAFT, at, rot, cylBetween, bulbLamp, lightPool, makeHalos, timberSet, lagging, railLine, tub, pipeRun, barrel, sack, crateBox, steelRawMat, steelRustMat, lin, handrail, steelLadder, meshMaterial, puddleMaterial, cliffBlocker, signQuad } from './kit.js';
import { addTunnelProps } from './tunnelProps.js';
import { custom, TIMBER, STRATA, SHUTTER, COAL, CINDER } from './glsl.js';
import { shaftMats, shaftLining } from './shaft.js';
import { buildLanding } from './landing.js';

export default {
  id: 'tunnels', name: 'Timbered Tunnels', origin: [0, -90, 0], viewRadius: 110,
  async build(ctx) {
    const { B, fx } = ctx; const oy = ctx.origin.y; const R = makeRng(2024); const t0 = performance.now(); const ph = phaser('tunnels');
    const bb = installBake(B, { cell: 100, cellY: 80, shift: [50, 20, 10] }); B.inst.cell = 100; const halos = makeHalos(B, 220); const E = { B, ctx, halos, bake: bb, gloss: [] };
    // ------------------------------------------------------------ materials
    const rock = bakeable(B.m('tRock', custom(STRATA, [4, 0.35, 0.45, 0.5, 8, 0.0, 0.3], { colors: [0x0c0d0e, 0x1b1b1a, 0x282622, 0x3a352e], size: 1024, tile: 4, bump: 130, rough: [0.62, 0.98] }), { triplanar: 1 / 4, vis: true, breakup: 0.35, wet: true }));
    const floor = bakeable(B.m('tFloor', custom(CINDER, [30, 0.5, 0.06, 0.5, 0.6], { colors: [0x131210, 0x211f1c, 0x0a0908, 0x3a352d], size: 1024, tile: 3, bump: 14, rough: [0.7, 1] }), { vis: true, wet: true }));
    const post = B.m('tPost', custom(TIMBER, [0.35, 0.35, 0.25, 0.35, 0, 0.9, 1], { colors: [0x24201b, 0x4f4436], size: 512, tile: 1.6, bump: 12, rough: [0.72, 0.97], layers: { grime: 0.35 } }), { wet: true });
    const board = B.m('tBoard', custom(TIMBER, [0.55, 0.5, 0.2, 0.4, 0, 0.7, 4], { colors: [0x2a251f, 0x5a4e3f], size: 512, tile: 1.2, bump: 10, rough: [0.75, 0.98], layers: { grime: 0.4, dust: 0.1 } }), { wet: true });
    const planks = B.m('tPlanks', custom(TIMBER, [0.5, 0.55, 0.15, 0.3, 0, 0.6, 6], { colors: [0x2d2620, 0x5d5040], size: 512, tile: 1.5, bump: 8, rough: [0.72, 0.98], layers: { grime: 0.4, dust: 0.1 } }), { wet: true });
    const steel = steelRustMat(B, [0x4a4038, 0x372e28, 0x17110e]); const steelRaw = steelRawMat(B);
    const rail = B.m('tRail', std({ color: 0x4a2f22, metalness: 1, roughness: 0.42, key: 'tRail' }));
    const brass = B.m('tBrass', std({ color: 0xa88235, metalness: 1, roughness: 0.32, key: 'tBrass' }));
    const iron = B.m('tIron', { pattern: 'plates', size: 512, tile: 1.5, colors: [0x2d2c2a, 0x201f1d, 0x0b0b0a], params: { cols: 1, rows: 1, seam: 0.01, rivets: 10, brushed: 0.3 }, bump: 3, metal: 1, rough: [0.4, 0.8], layers: { rust: 0.14, grime: 0.6, scratch: 0.5, edge: 0.4 }, rustColor: 0x4e2812 });
    const coal = B.m('tCoal', custom(COAL, [7, 0.7, 0.4], { colors: [0x1a1a1c, 0x2a2a2e, 0x3a3b44, 0x9a9cb0], size: 512, tile: 1, bump: 28, rough: [0.2, 0.6] }), { triplanar: 1 });
    const ore = B.m('tOre', custom(STRATA, [3, 0.05, 0.4, 0.3, 5, 0.7, 0.6], { colors: [0x2a2622, 0x4a3f34, 0x6b5a45, 0x9a7a4a], size: 512, tile: 2, bump: 40, rough: [0.45, 0.9] }), { triplanar: 1 / 2 });
    const sackM = B.m('tSack', { pattern: 'weave', size: 256, tile: 0.4, colors: [0x6b5f48, 0x564b38], params: { threads: 36, twill: 0, variation: 0.6, fuzz: 0.6 }, bump: 2, rough: [0.9, 1], layers: { grime: 0.5, dust: 0.3 } });
    const hay = B.m('tHay', { pattern: 'dirt', size: 512, tile: 1.0, colors: [0x8a7440, 0x6b5a30, 0x3a3018, 0xb09a5a], params: { scale: 10, pebbles: 0, cracks: 0, grass: 1 }, bump: 14, rough: [0.9, 1], mossColor: 0xa08c48 });
    const bulbCage = steelRaw; const cord = B.m('tCord', std({ color: 0x060606, roughness: 0.7, key: 'tCord' }));
    const flat = (name, colors, o = {}) => B.m(name, { rustColor: 0x4e2812, pattern: 'plates', size: 256, tile: 1, colors, params: { cols: 1, rows: 1, seam: 0.0, rivets: 0, brushed: 0.8 }, bump: 1, metal: 1, rough: [0.4, 0.75], layers: { rust: 0.18, grime: 0.5, streak: 0.4 }, ...o });
    const pipe = flat('tPipe', [0x3c4a44, 0x2d3833, 0x121815]), pipeB = flat('tPipeB', [0x2f3d4f, 0x242f3d, 0x0f141b]), locker = B.m('tLocker', { pattern: 'plates', size: 256, tile: 1, colors: [0x3f4a44, 0x2f3833, 0x111614], params: { cols: 2, rows: 3, seam: 0.012, rivets: 6, brushed: 0.3 }, bump: 2, metal: 1, rough: [0.45, 0.8], rustColor: 0x4e2812, layers: { rust: 0.2, grime: 0.6, streak: 0.5, scratch: 0.4 } });
    const drum = B.m('tDrum', { pattern: 'corrugated', size: 256, tile: 1, colors: [0x3c4a3a, 0x29342a], params: { ribs: 6, depth: 0.2, vertical: 0, dents: 1.5 }, bump: 6, metal: 1, rough: [0.4, 0.75], layers: { rust: 0.25, grime: 0.55, streak: 0.4 }, rustColor: 0x4e2812 });
    const olive = B.m('tOlive', { pattern: 'planks', size: 256, tile: 1.5, colors: [0x4a4f34, 0x30331f, 0x0d0e08], params: { rows: 5, gap: 0.006, grain: 6, knots: 0.2, cols: 2, weather: 0.6, nails: 1 }, bump: 3, rough: [0.7, 0.95], layers: { grime: 0.4, dust: 0.3 } });
    const canvas = B.m('tCanvas', { pattern: 'weave', size: 256, tile: 0.5, colors: [0x5b5a4a, 0x484739], params: { threads: 40, twill: 0, variation: 0.5, fuzz: 0.6 }, bump: 1.5, rough: [0.9, 1], layers: { grime: 0.6, dust: 0.4 } }); canvas.side = THREE.DoubleSide;
    const glowG = B.m('tGlowG', std({ color: 0x000000, emissive: 0x40ff80, emissiveIntensity: 5, key: 'tGlowG' })), glowY = B.m('tGlowY', std({ color: 0x000000, emissive: 0xffb040, emissiveIntensity: 6, key: 'tGlowY' }));
    const tubM = { tub: steel, rim: iron, wheel: iron, coal, ore }; const ballast = B.m('tBallast', custom(CINDER, [70, 0.0, 0.0, 0.2, 0.0], { colors: [0x24211e, 0x37332e, 0x161412, 0x655e53], size: 512, tile: 1.5, bump: 14, rough: [0.85, 1] })); const railM = { sleeper: post, rail, ballast, iron };
    const M = { post, board, planks, steel, steelRaw, iron, brass, coal, ore, sackM, hay, cord, olive, canvas, locker, lampGlowG: glowG, lampGlowY: glowY, pipe, pipeB, drum,
      paper: B.m('tPaper', std({ color: 0xd8cfb8, roughness: 0.9, key: 'tPaper' })), bucket: B.m('tBucket', std({ color: 0x8a2a20, metalness: 0.7, roughness: 0.5, key: 'tBucket' })), water: B.m('tTrough', std({ color: 0x080d0f, roughness: 0.04, key: 'tTrough' })),
      stove: iron, redbox: B.m('tRedbox', std({ color: 0x7a1710, roughness: 0.6, metalness: 0.2, key: 'tRedbox' })), puddle: B.m('tPuddle', puddleWater(0x070605)) };
    const timberM = { post, board, iron };

    // ------------------------------------------------------------ cavity (air = union of chambers; solids = rubble). Floor is the plane y = 0.
    const inShaft = (x, z) => Math.abs(x) < 2.6 && z < 1.85;
    const cav = new Cavity({ noise: [{ f: [0.3, 0.5, 0.3], a: 0.38, seed: 1 }, { f: [0.8, 1.5, 0.8], a: 0.2, seed: 2 }, { f: [1.9, 3.2, 1.9], a: 0.1, seed: 3 }, { f: [4.2, 6, 4.2], a: 0.04, seed: 4 }], fade: 2.5,
      noiseMul: (x, y, z) => (z > 14 || Math.abs(x) > 6 ? 0.4 : (Math.abs(x) < 8.6 && z > 1.5 && z < 16 ? 0.5 : 1)) });
    cav.air(shape.box(0, -0.5, 0, 2.35, 7.5, 1.75, 0.05));                                   // shaft column
    cav.air(shape.box(0, 2.6, 8.9, 8.0, 2.6, 7.15, 0.5));                                    // junction hall  z 1.75..16
    cav.air(shape.box(0, 1.6, 34.5, 2.1, 1.6, 19.5, 0.45));                                // main drift     z 15..54
    cav.air(shape.box(-17.5, 1.5, 8, 11.5, 1.5, 2.1, 0.4)); cav.air(shape.box(-29, 1.6, 8, 3.3, 1.6, 4.4, 0.3)); // west gallery + lamp room
    for (const x of [-12.6, -15.2, -17.8, -20.4]) cav.air(shape.box(x, 1.15, 5.2, 0.8, 1.15, 1.7, 0.2)); // pony stalls
    cav.air(shape.box(16, 1.5, 8, 11, 1.5, 2.1, 0.4)); cav.air(shape.box(15, 1.35, 10.6, 1.6, 1.35, 1.7, 0.2)); cav.air(shape.box(15, 1.4, 14.9, 3.0, 1.4, 2.9, 0.25)); // east gallery, magazine
    for (const [x, z] of [[-2.6, 21], [2.6, 29], [-2.6, 39], [2.6, 46]]) cav.air(shape.box(x, 1.0, z, 0.9, 1.0, 0.75, 0.2)); // refuge niches
    cav.air(shape.box(-38, 1.4, 8, 7, 1.4, 1.6, 0.35));                                       // dark drift beyond the lamp room (barricade side)
    cav.air(shape.cylY(5.4, 11.6, 0.95, 4.6, 13));                                            // ore pass above the mezzanine
    cav.air(shape.ell(-2.5, 5.6, 5, 3.4, 1.5, 2.6));                                          // roof cavity over the shaft end of the hall
    cav.solid(shape.ell(26.2, 0.6, 8, 2.2, 1.9, 1.7), 0.7); cav.solid(shape.ell(0.2, 0.5, 53.6, 2.4, 1.8, 2.2), 0.7); cav.solid(shape.ell(-1.0, 0.3, 43.4, 1.3, 0.9, 0.9), 0.6);
    cav.late((x, y, z, a) => (inShaft(x, z) ? a : Math.min(a, y)));
    ph('materials+ops'); const grid = cav.bake([-46, -9, -5], [30, 9.5, 57], 0.42); bb.air = grid.sample; ph('sdf bake');
    const mesh = surfaceNets(grid); ph('surface nets');
    addShell(B, mesh, { rock, floor }, (nx, ny, nz, y) => (ny > 0.95 && Math.abs(y) < 0.04 ? 'floor' : 'rock'), { cast: false });
    ph('addShell'); shellColliders(B, grid, { x0: -46, x1: 30, z0: -5, z1: 57, cell: 0.5, floor: () => 0, y0: -0.3, y1: 4.2, heights: [0.4, 1.2, 2.2], thr: 0.28, skin: 2 }); ph('shell colliders');

    // ------------------------------------------------------------ shaft stub (timber-lined) + landing
    const sm = shaftMats(B, 'timber');
    shaftLining(B, sm, { y0: -8, y1: 7, style: 'timber', front: [{ y0: 0, y1: OPEN.h }], collide: true, seed: 2 });
    const landing = buildLanding(ctx, B, { frame: post, steel: steelRaw, mesh: meshMaterial({ kind: 'diamond', cell: 0.06, wire: 3.4, tile: 0.48 }), plate: steel }, { style: 'timber' });
    B.box({ p: [0, 0, 3.6], s: [8.6, 0.06, 3.6], mat: planks, bevel: 0.01, col: 'wood' });                       // landing deck

    // ------------------------------------------------------------ junction hall timbering
    for (const [x, z] of [[-4.6, 5.6], [4.6, 5.6], [-4.6, 11.0], [4.6, 11.0]]) {
      B.beam([x, 0, z], [x, 4.7, z], 0.56, 0.56, { mat: post, bevel: 0.03 }); B.box({ p: [x, 0, z], s: [0.8, 0.28, 0.8], mat: post, bevel: 0.03, cast: false }); B.box({ p: [x, 4.5, z], s: [0.8, 0.22, 0.8], mat: post, bevel: 0.03, cast: false });
      B.colliders.addBox({ x, y: 2.4, z, hx: 0.3, hy: 2.4, hz: 0.3, surface: 'wood', walk: false });
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) B.beam([x + dx * 1.15, 3.55, z + dz * 1.15], [x + dx * 0.28, 4.6, z + dz * 0.28], 0.2, 0.2, { mat: post, bevel: 0.015 });
    }
    for (const x of [-4.6, 4.6]) B.box({ p: [x, 4.55, 8.6], s: [0.55, 0.55, 13.6], mat: post, bevel: 0.03 });
    for (const z of [2.9, 5.6, 11.0, 14.3]) B.box({ p: [0, 4.6, z], s: [15.2, 0.46, 0.5], mat: post, bevel: 0.03 });
    for (let z = 2.9; z <= 14.4; z += 1.15) for (const s of [-1, 1]) B.box({ p: [s * 6.2, 4.7, z], s: [3.0, 0.3, 0.3], mat: post, bevel: 0.02 });
    // wall-line posts + lagging on both hall walls (gallery openings left free)
    for (const s of [-1, 1]) for (const z of [2.9, 4.6, 11.4, 13.0, 14.4]) { B.beam([s * 7.3, 0, z], [s * 7.25, 4.7, z], 0.42, 0.42, { mat: post, bevel: 0.02 }); if (z !== 4.6) B.colliders.addBox({ x: s * 7.3, y: 2.35, z, hx: 0.22, hy: 2.35, hz: 0.22, surface: 'wood', walk: false }); }
    for (const s of [-1, 1]) for (const [za, zb] of [[2.9, 4.6], [11.4, 13.0], [13.0, 14.4]]) for (let i = 0; i < 17; i++) { if (R() < 0.12) continue; B.box({ p: [s * 7.62, i * 0.27 + 0.02, (za + zb) / 2], s: [0.05, 0.26, zb - za - 0.2], mat: board, bevel: 0.004, cast: false }); }
    // gallery portals + drift portal
    timberSet(B, timberM, { p: [-7.7, 0, 8], yaw: PI / 2, w: 2.9, h: 2.75, t: 0.34, seed: 5 }); timberSet(B, timberM, { p: [7.7, 0, 8], yaw: -PI / 2, w: 2.9, h: 2.75, t: 0.34, seed: 6 });
    timberSet(B, timberM, { p: [0, 0, 15.6], yaw: 0, w: 3.0, h: 2.8, t: 0.4, seed: 7, brace: true });

    // ------------------------------------------------------------ main drift: timber sets, lagging, lamps, track
    for (let z = 18, i = 0; z < 52; z += 2.4, i++) {
      timberSet(B, timberM, { p: [0, 0, z], yaw: 0, w: 2.9, h: 2.65, seed: i + 11, brace: i % 4 === 1 });
      if (z < 40) lagging(B, timberM, { p: [0, 0, z + 1.2], yaw: 0, len: 2.1, w: 2.9, h: 2.65, seed: i * 5 + 1, gap: 0.2, roof: false });
    }
    for (const x of [-10.6, -14.3, -16.9, -19.5, -22.1, -24.7, -26.9]) timberSet(B, timberM, { p: [x, 0, 8], yaw: PI / 2, w: 2.9, h: 2.65, seed: x * 3 });
    for (const x of [10.6, 13.2, 17.4, 20.0, 22.4]) timberSet(B, timberM, { p: [x, 0, 8], yaw: -PI / 2, w: 2.9, h: 2.65, seed: x * 5 });
    for (const x of [-12.4, -15.6, -18.2, -20.8, -23.4, -25.8]) lagging(B, timberM, { p: [x, 0, 8], yaw: PI / 2, len: 2.2, w: 2.9, h: 2.65, seed: x * 7, gap: 0.28, roof: false }); for (const x of [11.9, 15.3, 18.7, 21.2]) lagging(B, timberM, { p: [x, 0, 8], yaw: -PI / 2, len: 2.2, w: 2.9, h: 2.65, seed: x * 9, gap: 0.28, roof: false });
    railLine(B, railM, [0.5, 0, 6], [0.5, 0, 50], { gauge: 0.61, y: 0, ballast: true });
    railLine(B, railM, [-7.6, 0, 8], [-26.5, 0, 8], { gauge: 0.61, y: 0, ballast: true, seed: 5 }); railLine(B, railM, [7.6, 0, 8], [23, 0, 8], { gauge: 0.61, y: 0, ballast: true, seed: 6 });
    tub(B, tubM, { p: [0.5, 0.0, 22.2], yaw: PI / 2, load: 'coal', seed: 1 }); tub(B, tubM, { p: [0.5, 0, 23.75], yaw: PI / 2, load: 'coal', seed: 2 }); tub(B, tubM, { p: [0.5, 0, 33.4], yaw: PI / 2 + 0.02, load: 'ore', seed: 3 });
    tub(B, tubM, { p: [-24.6, 0, 8.9], yaw: 0.05, load: null, seed: 4 }); tub(B, tubM, { p: [19.6, 0, 7.2], yaw: 0.03, load: 'coal', seed: 5 });

    const props = addTunnelProps({ B, E, m: M, ctx, halos });
    // ---- floor wear (cosmetic, no colliders): coal spill along the walls, board crossings between the rails, oil + water puddles, leaning pit props
    { const oil = B.m('tOil', puddleWater(0x0b0907));
      for (let i = 0; i < 40; i++) { const side = i % 2 ? 1 : -1, x = side * (1.55 + R() * 0.35), z = 17 + R() * 34; B.rock({ p: [x, 0.03, z], r: 0.14 + R() * 0.2, squash: [1.5, 0.45, 1.1], amp: 0.5, seed: 40 + i, detail: 1, mat: coal, cast: false }); }
      for (let i = 0; i < 16; i++) { const x = (R() < 0.5 ? -1 : 1) * (5 + R() * 5) * (R() < 0.5 ? 1 : 0.4), z = 3 + R() * 12; if (Math.abs(x) < 3.6 && z < 5) continue; B.rock({ p: [x, 0.03, z], r: 0.12 + R() * 0.18, squash: [1.4, 0.45, 1.1], amp: 0.5, seed: 90 + i, detail: 1, mat: coal, cast: false }); }
      for (const z of [26.3, 31.2, 40.5, 46.0, 21.4]) { for (const dz of [-0.13, 0.13]) B.box({ p: [0.5, 0.115, z + dz], s: [0.5, 0.035, 0.24], yaw: (R() - 0.5) * 0.05, mat: board, bevel: 0.004, cast: false }); }
      for (let i = 0; i < 22; i++) { const x = (R() - 0.5) * 3.2, z = 17 + R() * 34; if (Math.abs(x - 0.5) < 0.45) continue; const w = 0.5 + R() * 1.2; signQuad(B, R() < 0.3 ? oil : M.puddle, [x, 0.014 + (i % 3) * 0.0006, z], w * 1.3, w * 0.85, R() * PI, { pitch: -PI / 2 }); }
      for (let i = 0; i < 10; i++) { const x = (R() - 0.5) * 12, z = 2.5 + R() * 13; signQuad(B, R() < 0.4 ? oil : M.puddle, [x, 0.014, z], 0.9 + R(), 0.7 + R() * 0.6, R() * PI, { pitch: -PI / 2 }); }
      for (let i = 0; i < 6; i++) { const z = 19 + i * 6.3 + R() * 1.5, s = i % 2 ? 1 : -1; B.beam([s * 1.72, 0, z], [s * 1.5, 2.15, z + 0.25], 0.14, 0.14, { mat: post, bevel: 0.01, cast: false }); }
      }
    { const bm = makeBeam({ length: 10, r0: 0.9, r1: 1.7, color: 0x9cc0ff, intensity: 0.22, dust: 1, near: 1.2 }); bm.position.set(5.4, 12.4, 11.6); bm.lookAt(5.4, 2.4, 11.6); B.group.add(bm); ctx.light({ pos: [5.4, 10, 11.6], color: 0xb8d4ff, intensity: 160, distance: 13, decay: 2, kind: 'spot', dir: [0, -1, 0.02], angle: 0.36, penumbra: 0.55, shadow: true }); bb.light({ p: [5.4, 4.6, 11.6], c: [0.5, 0.66, 1.0], I: 10, R: 10, s: 0.8, shadow: true }); halos.add([5.4, 4.8, 11.6], 0xa8c8ff, 1.6, 0.35, 0); }
    const drips = new Drips(fx, [[-3, 3.2, 20, 0, 3], [2.5, 3.0, 27, 0, 2.6], [-2.2, 3.1, 36, 0, 3.4], [1.9, 2.9, 44, 0, 2.2], [-10, 2.7, 6.9, 0, 3.0], [-20, 2.6, 8.7, 0, 2.5], [12, 2.6, 7.3, 0, 3.2], [-6, 5.0, 8, 0, 3.6], [6, 5.0, 4, 0, 2.8]].map(([x, y, z, fy, r]) => ({ p: [x, y + oy, z], y: fy + oy, h: y - fy, rate: r })));

    { const PD = new Parts(B, R);                                                                      // ventilation duct (flanged sections + hangers), cable runs with clamps, junction boxes
      ductPipe(PD, iron, steelRaw, [[0.05, 2.28, 16.4], [0.05, 2.28, 53]], 0.27, { every: 2.4, seg: 14, clamps: false });
      for (let z = 18; z < 52; z += 4.8) { member(PD, steelRaw, [-0.1, 2.28 + 0.27, z], [-0.1, 2.68, z], profFlat(0.05, 0.006), { up: [1, 0, 0], step: 2, cast: false }); member(PD, steelRaw, [0.2, 2.28 + 0.27, z], [0.2, 2.68, z], profFlat(0.05, 0.006), { up: [1, 0, 0], step: 2, cast: false }); }
      for (const [x, y, dy] of [[-1.4, 1.95, 0], [-1.4, 1.83, 0.04], [-1.4, 1.71, -0.02]]) ductPipe(PD, cord, steelRaw, [[x, y + dy, 15.5], [x, y + dy - 0.05, 53]], 0.022, { every: 1.6, seg: 6, clamps: false });
      for (const z of [23, 31.5, 44]) { PD.of(iron, true).box(-1.36, 1.6, z, 0.12, 0.34, 0.26, 0.004, R); for (const dy of [-0.11, 0.11]) for (const dz of [-0.08, 0.08]) bolt(PD, steelRaw, [-1.295, 1.6 + dy, z + dz], [1, 0, 0], 0.8); }
      PD.flush(); }
    { const PT = new Parts(B, R), CM = { iron, dark: cord, glass: cord, post, board, brick: board, hat: B.m('tHat', std({ color: 0x6a4e12, roughness: 0.55 })) };   // real floor clutter: buckets, bottles, hard hats, planks, shovels, spilled tools
      for (const [x, z, r] of [[-6.6, 3.4, 1.2], [6.6, 3.6, 1.1], [-6.7, 14.6, 1.3], [6.7, 14.7, 1.1], [-1.7, 51, 1.2], [1.6, 30, 0.6], [-1.6, 41, 0.6], [-33.5, 6.6, 1.3], [25.5, 9.4, 1.0], [-25, 9.4, 0.8]]) rockPile(PT, rock, { c: [x, 0, z], r, n: 22, hgt: 0.35, ground: () => 0, size: 0.3 });
      scatterParts(PT, CM, { area: [-1.3, 17, 1.3, 50], n: 46, kinds: ['bucket', 'bottle', 'hat', 'plank', 'shovel', 'plank'] }); scatterParts(PT, CM, { area: [-6.5, 3, 6.5, 14.5], n: 30, kinds: ['bucket', 'bottle', 'hat', 'plank', 'shovel'] });
      scatterParts(PT, CM, { area: [-27, 7.2, -8, 8.8], n: 22, kinds: ['bucket', 'bottle', 'plank', 'hat'] }); scatterParts(PT, CM, { area: [8, 7.2, 24, 8.8], n: 16, kinds: ['bucket', 'bottle', 'plank', 'hat'] }); PT.flush(); }
    // ------------------------------------------------------------ lamps (pooled real lights + baked + halos + floor pools)
    const LS = 0.6; const L = (x, y, z, o = {}) => bulbLamp(E, [x, y, z], { cageMat: bulbCage, cordMat: cord, ...o, I: (o.I ?? 10) * LS });
    for (const [x, z] of [[-2.3, 4.2], [2.3, 4.2], [0.0, 8.5], [-2.3, 12.4], [2.3, 12.4]]) L(x, 3.9, z, { I: 16, R: 14, size: 1.0, pool: 4.2, poolK: 0.026, hang: 0.85, floorY: z < 5.4 ? 0.07 : 0 });
    for (const [x, z] of [[-6.2, 3.5], [6.2, 3.5], [-6.6, 13], [6.6, 13]]) L(x, 3.0, z, { I: 11, R: 11, size: 0.8, pool: 3.0, poolK: 0.026, hang: 1.7, floorY: z < 5.4 ? 0.07 : 0 });
    for (let z = 21, i = 0; z < 52; z += 9.6, i++) L(i % 2 ? 0.75 : -0.75, 2.45, z, { I: 19, R: 12, size: 0.85, pool: 3.4, poolK: 0.034, hang: 0.5 });
    for (let x = -11; x > -26; x -= 5.2) L(x, 2.45, 8 + (x % 2 ? 0.5 : -0.5), { I: 12, R: 11, size: 0.8, pool: 3.0, poolK: 0.026, hang: 0.5 }); for (let x = 11; x < 25; x += 5.4) L(x, 2.45, 8.2, { I: 12, R: 11, size: 0.8, pool: 3.0, poolK: 0.026, hang: 0.5 });
    L(-29, 2.6, 8, { I: 8, R: 9, size: 0.9, pool: 3.2, hang: 0.6 }); L(15, 2.5, 14.9, { I: 4, R: 7, size: 0.7, pool: 2.4, hang: 0.5, color: 0xff8f40 });

    for (const [x, z] of [[-1.5, 15.2], [1.5, 15.6], [-8.0, 8.4], [8.0, 8.4]]) L(x, 2.7, z, { I: 12, R: 12, size: 0.7, pool: 2.6, poolK: 0.03, hang: 0.4, color: 0xffa860 });
    lampGloss(B, oy, E.gloss, { k: 1.0 }); setEmitters(M.puddle, E.gloss, oy); setEmitters(B.mats.get('tOil'), E.gloss, oy);
    const cut = cutawayFill(ctx, { pos: [-4, 12, 22], color: 0xffb878, intensity: 500, ceil: 6.2 });
    // ------------------------------------------------------------ weather + atmosphere
    ctx.weather({ type: 'dust', count: 1800, box: [30, 8, 30], fall: 0.02, size: 0.012, turb: 0.35, color: [0.75, 0.55, 0.35], alpha: 0.12, cell: 9, seed: 11, wind: [0.06, 0, 0.1] });
    const atmo = {
      name: 'Shaft Nine · Timbered Tunnels', fog: { color: 0x060403, scatter: 0x1f130a, density: 0.026, falloff: 0.0, base: 0, power: 2.5 },
      sky: null, sun: { dir: [0.05, 0.03, 1], color: 0xffb060, intensity: 0, shadow: false }, env: { intensity: 0.17 },
      exposure: 1.0, bloom: 0.42, vignette: 0.42, grain: 0.04, chroma: 0.0018, ao: 0.9, wet: 0.22, reverb: 'tunnel',
      grade: { sat: 0.94, contrast: 1.16, lift: [0.004, 0.006, 0.012], gain: [1.0, 1.0, 1.0], tint: [1, 1, 1] }, autoExposure: { key: 0.09, min: 1.25, max: 2.6 },
    };
    ph('props+lights'); ph.done(); console.log('[tunnels] build ms', (performance.now() - t0).toFixed(0), 'shell tris', bb.stats?.tris);
    normalizePatch(B, { breakup: 0.35, addBreakup: true, wet: true });
    return {
      onReady(st) { const u = unifyPrograms(st.group); console.log('[tunnels] programs after unify', u.programs, 'meshes', u.meshes, '| build+finish ms', (performance.now() - t0).toFixed(0)); },
      atmo, envPatches: [{ dir: [0, 1, 0.2], color: 0x90a8d0, size: 4, intensity: 4 }, { dir: [0, 0.2, 1], color: 0xffa060, size: 2, intensity: 1.0 }],
      playerStart: { pos: [0, 0, 9.2], yaw: PI }, station: { pos: [0, 0, 0], yaw: 0 }, groundY: 0, groundSurface: 'gravel', landing,
      navBounds: [-45, -3, 28, 54], navBlocked: cliffBlocker(B.colliders), landmark: { pos: [0, 3.0, 4.2], name: 'Junction Hall' },
      spawns: [{ kind: 'barricade', pos: [0, 0, 47.8], yaw: 0, boards: 5 }, { kind: 'barricade', pos: [-32.9, 0, 8], yaw: -PI / 2, boards: 5 }, { kind: 'walk', pos: [0, 0, 50.0], yaw: 0 }, { kind: 'walk', pos: [-38.5, 0, 8], yaw: -PI / 2 }, { kind: 'rise', pos: [21.0, 0, 8], yaw: PI / 2 }, { kind: 'rise', pos: [1.0, 0, 39.5], yaw: 0 }],
      buys: { walls: [{ pos: [-5.5, 1.5, 15.9], yaw: PI, gun: 'ak74u' }, { pos: [-7.7, 1.5, 4.0], yaw: PI / 2, gun: 'remington870' }], perks: [{ pos: [6.9, 0, 3.4], yaw: -PI / 2, perk: 'speedcola' }], box: { pos: [-6.4, 0, 12.2], yaw: PI / 2 } },
      zombieVariants: ['miner_lamp', 'miner_foreman', 'miner_coal', 'miner_gas'],
      ambient: { space: 'tunnel', gain: 1, beds: [{ type: 'rumble', freq: 38, gain: 0.22 }, { type: 'hum', freq: 50, gain: 0.05 }, { type: 'machine', kind: 'compressor', gain: 0.1, pos: 'far' }], events: [{ type: 'drip', every: [0.8, 3.2], gain: 0.5, pos: 'around' }, { type: 'creak', every: [4, 11], gain: 0.5, pos: 'around' }, { type: 'clank', every: [9, 24], gain: 0.35, pos: 'far' }, { type: 'rockfall', every: [35, 80], gain: 0.4, pos: 'far' }] },
      ringBell: props.ringBell,
      update(dt, t, active) { props.update(dt, t, active); drips.update(dt, active); cut(active); },
    };
  },
};
