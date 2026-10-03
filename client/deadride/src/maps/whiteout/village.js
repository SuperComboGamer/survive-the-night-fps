// WHITEOUT -- Stop 1: BASE VILLAGE (night blizzard, moderate). Warm-lit timber chalets against deep-blue snow.
// Landmark: the steel-and-timber gondola base terminal with the illuminated WHITEOUT RESORT sign. Palette: orange windows vs blue night.
import * as THREE from 'three';
import { HaloBatch } from '../../core/glow.js';
import { fenceLine } from '../../core/props.js';
import { rand, makeRng, clamp, smoothstep } from '../../core/util.js';
import * as L from './land.js';
import { terrainPatch, coarse, unifyPrograms, pineGeometry, spillMaterial, spill, Frame, timer, heightGrid, driftMesh, sunkH } from './common.js';
import { villageMats } from './vmats.js';
import { chalet, setPotFir } from './chalets.js';
import { lampPost, fountain, snowmobile, snowcat, skiRack, woodpile, signpost, drift } from './vprops.js';
import { buildTerminal, HALL } from './vterminal.js';
import { WindVeil } from './veil.js';
import { trail } from './tracks.js';
import { chapel } from './vchapel.js';
import { lampPost2, snowmobile2, skiRack2, scatter, fountain2, floorGrime } from './props3.js';
import { terminalDetails } from './vdetail.js';
import { conifer } from './trees.js';
import { festoon, festoonPole, christmasTree, stall, bench, barrel, luggage, sled, hallDressing, parkedCar, snowPole, PARKED } from './vdress.js';

const P = Math.PI;
export default {
  id: 'village', name: 'Base Village', origin: L.ORIGINS[0], viewRadius: 250,
  async build(ctx) {
    const T0 = timer('village'); const { B, fx, rng } = ctx; coarse(B); const st = L.STATIONS[0]; const M = villageMats(B); T0('materials'); const H = L.localH(0); const R = L.STOP_RECTS[0];
    const halos = new HaloBatch(640); B.group.add(halos.mesh); const spillM = spillMaterial();
    // ------------------------------------------------------------ ground: fine terrain patch (hole under the terminal slab), packed-snow plaza
    const hall = { x0: HALL.x0 - 0.7, x1: HALL.x1 + 0.7, z0: HALL.z0 - 0.7, z1: HALL.z1 + 0.7 };
    const Hs = sunkH(H, { c: 1, s: 0 }, hall.x0, hall.x1, hall.z0, hall.z1, 0.7, 1.6);
    const Hg = heightGrid(Hs, R.lminX, R.lmaxX, R.lminZ, R.lmaxZ, 2.5); B.colliders.heightFn = Hg;                                                       // sample the (expensive fbm) mountain function ONCE per grid node; the mesh + normals read the grid
    terrainPatch(B, { minX: R.lminX, maxX: R.lmaxX, minZ: R.lminZ, maxZ: R.lmaxZ, cell: 2.5, chunk: 32, H: Hg, mat: M.terrain, skirt: 8 }); T0('terrain');
    B.plane({ p: [-25, 0.035, 2], s: [30, 40], mat: M.packed, cast: false }); B.plane({ p: [-6, 0.035, -19.5], s: [30, 8], mat: M.packed, cast: false }); B.plane({ p: [-31, 0.035, 22], s: [24, 6], mat: M.packed, cast: false });
    // ------------------------------------------------------------ the terminal (landmark)
    const T = buildTerminal(ctx, B, M, halos, st); terminalDetails(ctx, B, M, halos, HALL); T0('terminal');
    // ------------------------------------------------------------ chalets: north row (facing the plaza), south row, west end
    const chimneys = []; const door = (c, w = 1.5) => ({ c, w, h: 1.9, sill: 0 }); const win = (wall, c, o = {}) => ({ wall, c, w: 1.2, h: 1.3, sill: 1.05, kind: 'window', ...o });
    const N1 = chalet(B, M, ctx, { x: -38, z: -24, yaw: P, w: 9, d: 8, floors: 2, hollow: true, shutter: 'green', seed: 1, balcony: true, sign: { c: 0, y: 2.2, w: 2.2, lines: ['SPORT', 'SHOP'], bg: '#123a33' },
      openings: [{ wall: 'front', ...door(0), kind: 'barricade' }, win('front', -3), win('front', 3), win('front', -2.6, { floor: 1, sill: 3.9 }), win('front', 2.6, { floor: 1, sill: 3.9 }), win('left', 0, { floor: 0 }), win('back', 0)] });
    const N2 = chalet(B, M, ctx, { x: -25, z: -24.5, yaw: P, w: 11, d: 8.4, floors: 2, hollow: false, shutter: 'red', seed: 2, balcony: true, sign: { c: -3.2, y: 2.2, w: 2.3, lines: ['HOTEL', 'ALPENROSE'], bg: '#4a1810' },
      openings: [{ wall: 'front', ...door(-3.2), kind: 'door' }, win('front', 1.2), win('front', 4, { w: 1.4 }), win('front', -2.6, { floor: 1, sill: 3.9 }), win('front', 0.6, { floor: 1, sill: 3.9 }), win('front', 3.8, { floor: 1, sill: 3.9 })] });
    const N3 = chalet(B, M, ctx, { x: -9, z: -24, yaw: P, w: 9, d: 8, floors: 1, hollow: true, shutter: 'blue', seed: 3, chimney: true, sign: { c: 1.6, y: 2.2, w: 1.9, lines: ['SKI', 'SCHOOL'], bg: '#17304d' },
      openings: [{ wall: 'front', ...door(1.6), kind: 'barricade' }, win('front', -2.4), win('front', -0.4, { w: 0.9 }), win('right', 0)] });
    const S1 = chalet(B, M, ctx, { x: -30, z: 27.2, yaw: 0, w: 16, d: 8.6, floors: 1, h1: 3.1, hollow: true, shutter: 'red', pitch: 0.42, seed: 4, chimney: false, sign: { c: -4.5, y: 2.3, w: 2.6, lines: ['SKI RENTAL'], bg: '#3a1410' },
      openings: [{ wall: 'front', ...door(-4.5), kind: 'barricade' }, { wall: 'front', c: 1.5, w: 2.6, h: 1.5, sill: 0.9, kind: 'window' }, { wall: 'front', c: 5.6, w: 2.6, h: 1.5, sill: 0.9, kind: 'window' }, win('left', 0)] });
    const S2 = chalet(B, M, ctx, { x: -13, z: 28.4, yaw: 0, w: 8.4, d: 7.6, floors: 2, hollow: false, shutter: 'green', seed: 5, sign: { c: 0, y: 2.2, w: 1.9, lines: ['BAKERY'], bg: '#3a2a10' },
      openings: [{ wall: 'front', ...door(0), kind: 'door' }, win('front', -2.8), win('front', 2.8), win('front', -2.6, { floor: 1, sill: 3.9 }), win('front', 2.6, { floor: 1, sill: 3.9 })] });
    const W1 = chalet(B, M, ctx, { x: -40.2, z: 4, yaw: -P / 2, w: 12, d: 7.6, floors: 2, hollow: true, shutter: 'red', seed: 6, balcony: true, sign: { c: -2.6, y: 2.2, w: 2.0, lines: ['POST', 'OFFICE'], bg: '#33301a' },
      openings: [{ wall: 'front', ...door(-2.6), kind: 'barricade' }, win('front', 1.8), win('front', 4.6), win('front', -3.4, { floor: 1, sill: 3.9 }), win('front', 0.6, { floor: 1, sill: 3.9 }), win('front', 3.8, { floor: 1, sill: 3.9 })] });
    const chalets = [N1, N2, N3, S1, S2, W1]; T0('chalets');
    // window glare + light spill on the snow in front of every lit window
    for (const c of chalets) for (const w of c.windows) { halos.add([w.x, w.y, w.z], 0xffa858, 1.3, 0.6, 0); const sg = w.wl === 'front' ? -1 : w.wl === 'back' ? 1 : 0; const F = c.F; const sp = F.p(w.c, 0.03, sg * 3.0); if (w.y < 3) spill(B, spillM, sp[0], 0.03, sp[2], 3.2, 3.6, F.yaw, 0xffb070); }
    for (const c of chalets) for (const l of c.lamps) { halos.add([l.x, l.y, l.z], l.big ? 0xffd9a0 : 0xffb45c, l.big ? 0.9 : 0.55, l.big ? 0.3 : 0.55, 0); if (!l.big) { const off = l.wl === 'front' ? [0, -1.5] : l.wl === 'back' ? [0, 1.5] : l.wl === 'left' ? [-1.5, 0] : [1.5, 0], a = c.F.p(off[0], 0, off[1]), b0 = c.F.p(0, 0, 0); spill(B, spillM, l.x + a[0] - b0[0], 0.03, l.z + a[2] - b0[2], 2.6, 2.8, c.F.yaw, 0xffb070); } }
    for (const c of chalets) { const w = c.windows.find((q) => q.y < 3 && q.wl === 'front'); if (!w) continue; const o0 = c.F.p(0, 0, 0), o1 = c.F.p(0, 0, -1); const nx = o1[0] - o0[0], nz = o1[2] - o0[2];
      ctx.light({ pos: [w.x + nx * 1.1, 1.9, w.z + nz * 1.1], color: 0xffae5c, intensity: 7.5, distance: 9.5, decay: 2, flicker: 0.035, flickerSpeed: 3 + (c.F.x | 0) % 3 }); }
    // ------------------------------------------------------------ plaza dressing
    fountain2(B, M, -26, 4, halos);
    const lamps = [[-32, -13], [-32, 17.5], [-19.5, -13], [-19.5, 17.5], [-4, -17.5], [8, -17.5], [-3, 25.5], [22, 26], [-44 + 3, 4]];
    for (const [x, z] of lamps) lampPost2(ctx, B, M, halos, x, z, { h: 5.0, intensity: 20, dist: 18 });
    snowcat(B, M, 15, 28.5, 0.15, halos);
    snowmobile2(B, M, -37, 16, 0.5); snowmobile2(B, M, -35.4, 18.2, -0.2, M.paintBlue); snowmobile2(B, M, -33.4, 16.4, 0.9);
    skiRack2(B, M, -30.5, 21.2, 0, 8, 3); skiRack2(B, M, -25, -19.6, P, 6, 4); skiRack2(B, M, -16.2, 22.6, 0, 5, 5); skiRack2(B, M, -35.5, 9.8, -P / 2, 6, 6);
    woodpile(B, M, -34, -19.6, P, 1); woodpile(B, M, -18.6, -19.8, P, 2); woodpile(B, M, -20, 30, 0, 3);
    signpost(B, M, -17.5, 7.5, -P / 2 + 0.2, ['GONDOLA', '→ BASE STATION'], 1.9); signpost(B, M, -33, 0, 0.4, ['SKI SCHOOL', 'RENTAL  ↓'], 1.7);
    fenceLine(B, [40, 0, -30], [40, 0, -6], { height: 1.2, postEvery: 2.4, postMat: M.beam, panelMat: M.timberV, col: 'wood' }); fenceLine(B, [40, 0, 14], [40, 0, 30], { height: 1.2, postEvery: 2.4, postMat: M.beam, panelMat: M.timberV, col: 'wood' });
    // ------------------------------------------------------------ plaza life: festoon lights, Christmas tree, Gluhwein stall, benches, luggage
    { const fy = 4.55, A = [-32, -13], Bp = [-19.5, -13], C = [-19.5, 17.5], D = [-32, 17.5]; const fp = (q, y = fy) => [q[0], y, q[1]];
      festoonPole(B, M, -19.5, 2.25); festoonPole(B, M, -32, 2.25);
      festoon(B, M, halos, fp(A), fp(Bp), { sag: 0.7, n: 12, seed: 1 }); festoon(B, M, halos, fp(D), fp(C), { sag: 0.7, n: 12, seed: 3 });
      festoon(B, M, halos, fp(Bp), [-19.5, 4.7, 2.25], { sag: 0.9, n: 13, seed: 5 }); festoon(B, M, halos, [-19.5, 4.7, 2.25], fp(C), { sag: 0.9, n: 13, seed: 7 });
      festoon(B, M, halos, fp(A), [-32, 4.7, 2.25], { sag: 0.9, n: 13, seed: 2 }); festoon(B, M, halos, [-32, 4.7, 2.25], fp(D), { sag: 0.9, n: 13, seed: 4 });
      festoon(B, M, halos, [-13.8 - 4.9, 3.5, -9.3], [-13.8 - 4.9, 3.5, -1.7], { sag: 0.3, n: 9, seed: 6 }); }
    christmasTree(ctx, B, M, halos, -21, -4.5);
    const kiosk = stall(ctx, B, M, halos, -31, -16.4, P); barrel(B, M, -34.3, -17.2); barrel(B, M, -34.9, -16.4); barrel(B, M, -28.3, -17.6, false);
    bench(B, M, -31.2, 4, -P / 2); bench(B, M, -20.8, 6.5, P / 2 + 0.15); bench(B, M, -30.5, 10.5, -P / 2 - 0.2);
    luggage(B, M, -15.6, -2.4, 0.15, 1); luggage(B, M, -14.9, -8.6, -0.1, 2); sled(B, M, -28.6, -20.55, 0.15, 0.55); sled(B, M, -27.9, -20.6, -0.1, 0.5);
    const ch = chapel(ctx, B, M, halos, -3.5, 28.5, P / 2);
    parkedCar(B, M, -41.6, -17.5, 0.35, { kind: 'suv', snow: 1.2, H, sink: 0.25 }); parkedCar(B, M, -41.2, 19.5, 2.9, { kind: 'bus', snow: 1.0, H, sink: 0.2 }); parkedCar(B, M, 5, -18.5, P / 2, { kind: 'suv', paint: M.paintGreen, snow: 0.8, H, sink: 0.02 });
    for (let i = 0; i < 9; i++) { const z = -30 + i * 7; snowPole(B, M, -46.2, z, H(-46.2, z)); }
    const hallD = hallDressing(ctx, B, M, halos, HALL); { const o = ctx.origin; PARKED.set(ctx.world, hallD.parked.map((q) => ({ ...q, x: q.x + o.x, y: q.y + o.y, z: q.z + o.z }))); for (const q of hallD.parked) B.colliders.addBox({ x: q.x, y: 1.2, z: q.z, hx: 1.2, hy: 1.2, hz: 1.05, yaw: 0, surface: 'metal', walk: false }); }
    { const F0 = new Frame(B, 0, 0, 0, 0);
      scatter(B, M, F0, [
        ['crate', -37.2, -19.2], ['crate', -36.6, -19.4, 0.3, 0.4], ['jerrycan', -35.6, -19.1], ['bucket', -23.2, -19.1], ['shovel', -22.4, -20.35, P], ['boots', -37.6, -20.1], ['sandbags', -8.4, -19.4], ['tyre', -6.2, -19.0], ['tyre', -6.0, -19.1, 0, 0.25], ['saltBin', -14.8, -18.8],
        ['bin', -29.6, -19.4], ['bin', -28.8, -19.5], ['ropeCoil', -33.2, -19.3], ['skiBag', -24.5, -18.9, 0.2], ['skiBag', -10.5, -19.1, 1.4], ['cone', -18.2, -12.8], ['cone', -18.4, -11.6], ['cone', -18.6, -10.4],
        ['crate', -38.6, 24.2], ['jerrycan', -37.9, 24.3], ['bucket', -20.6, 22.9], ['sandbags', -33.4, 22.6], ['saltBin', -9.4, 23.4], ['bin', -17.8, 24.0], ['shovel', -12.3, 24.05], ['boots', -14.0, 23.8], ['ropeCoil', -26.2, 22.5], ['tyre', -3.8, 27.4], ['sack', -2.7, 27.3], ['sack', -2.2, 27.7],
        ['crate', -36.9, 6.8], ['jerrycan', -36.6, 7.4], ['bucket', -36.2, 2.4], ['skiBag', -36.0, -1.2, 1.57], ['shovel', -36.05, 0.4, -P / 2], ['boots', -36.6, 4.0], ['crate', -15.4, -1.8], ['crate', -15.6, -2.4, 0.4], ['jerrycan', -14.9, -2.0], ['extinguisher', -13.6, 2.2], ['extinguisher', -13.6, 12.0],
        ['bin', -14.4, 14.6], ['bin', -14.5, 15.6], ['cone', 0.0, 25.5], ['cone', 2.0, 25.6], ['cone', 4.0, 25.4], ['sack', 12.0, 26.6], ['sack', 12.5, 26.8], ['crate', 20.0, 26.8], ['tyre', 25.0, 26.0],
      ], 5); }
    T0('dressing');
    // snow drifts: against the windward (NNW) sides of walls, against the terminal, along fence and plateau rim (also the 'rise' spawn heaps)
    const drifts = [[-38, -29, 8, 1.6, 2.6, 0.2], [-25, -29.6, 10, 1.9, 2.8, 0.1], [-9, -29, 8, 1.6, 2.4, 0.3], [-3, -17.2, 9, 1.3, 2.0, 0], [-14.5, 8, 3.2, 1.6, 4.5, 0.4], [-14.5, -9, 3, 1.4, 4.0, -0.3], [-44.6, 12, 4, 1.8, 6, 0.1], [-20, 32, 9, 1.2, 2.6, 0.2], [38, 8, 3, 1.4, 5, 0], [0, 33, 14, 1.6, 3.0, 0.1], [-2, 24.6, 12, 1.0, 1.6, 0], [30, -16.6, 9, 1.0, 1.8, 0.1], [-34, 24, 5, 1.1, 3, -0.4], [-44, -12, 4, 1.5, 6, 0]];
    for (const [x, z, l, h, w, ax, az, sd] of [[-24, -18.2, 32, 0.55, 1.5, 1, 0, 71], [-26, 21.6, 30, 0.5, 1.5, 1, 0, 72], [-36.4, -6, 24, 0.5, 1.4, 0, 1, 73], [-15.2, 18, 12, 0.4, 1.2, 0, 1, 74], [-15.4, -14, 8, 0.4, 1.2, 0, 1, 75]]) driftMesh(B, M.snow, Hs, { x, z, len: l, wid: w * 1.4, h, ax, az, seed: sd });     // plough berms along the plaza edges
    drifts.forEach(([x, z, l, h, w, yaw], i) => driftMesh(B, M.snow, Hs, { x, z, len: l * 1.5, wid: w * 1.6, h: h * 0.85, ax: 0.35 + yaw * 0.2, az: 0.94, seed: 30 + i }));
    // ------------------------------------------------------------ tracks: boot prints between doors, fountain, stall and the terminal; snowmobile grooves; the groomer's corduroy
    { const Hf = (x, z) => Math.max(0, Hs(x, z)) + 0.035, opt = { lift: 0.03, step: 0.8 };
      const foot = [[[-21.8, -19.6], [-22.4, -12], [-24.4, -4.5], [-25.6, 0.4]], [[-10.6, -19.6], [-14, -17], [-16.2, -10], [-14.8, -6.4]], [[-13, 24.2], [-15.5, 17.5], [-18, 10], [-19.6, 5.4]], [[-36.2, 1.6], [-32.4, 2.6], [-30, 4.2], [-29.2, 5.2]],
        [[-22.8, -5.5], [-25, -10.5], [-27.6, -14.4], [-29.4, -14.9]], [[-17, 4], [-16.2, -0.5], [-14.6, -4.6]], [[-29.2, 8], [-25.4, 9.4], [-22.6, 7.4], [-21.8, 3.6]], [[-36.2, -10], [-34, -12.6], [-32.4, -14.2]], [[-29.4, 23], [-27, 15], [-26.6, 9.8]]];
      foot.push([[-36.5, -8.4], [-33.2, -7], [-30.2, -4.6], [-27.6, -2.2]], [[-38.2, -10], [-35.6, -9.6], [-33, -10.2], [-30.6, -12]], [[-33, -3.4], [-29, -8], [-25, -9.6], [-21.4, -10.4]], [[-34.4, -6], [-30.8, -9.5], [-27, -13], [-25.4, -17.4]],
        [[-35.2, -7], [-33.6, -3], [-32.2, 0.8], [-31.6, 3.6]], [[-30, -10.6], [-27, -8], [-24.4, -4.8], [-23.6, -1]], [[-28.4, -1.4], [-31.4, 2.4], [-30.4, 6.6], [-26.4, 8]], [[-21, 3], [-19.4, -1.6], [-19, -6], [-20.6, -11]], [[-16.6, -3], [-13, -6.4], [-9, -8.2], [-4.6, -8.6]], [[-16.4, 2], [-12, 5.4], [-8.6, 9.4], [-6.6, 14]]);
      foot.forEach((p, i) => trail(B, 'foot', p, Hf, { ...opt, jitter: 0.05 + 0.02 * (i % 9) }));
      trail(B, 'ski', [[-36.4, 16.4], [-38.4, 21], [-42, 25.5], [-44, 30]], Hf, opt); trail(B, 'ski', [[-34.4, 14.6], [-30.4, 12.4], [-27.6, 14.6], [-32.6, 18.6]], Hf, opt); trail(B, 'ski', [[-44, -6], [-38, -4], [-33, -1], [-30, 0.4]], Hf, opt);
      trail(B, 'tread', [[17, 36], [6, 35.4], [-6, 34.6], [-20, 33.4], [-33, 30.2], [-42, 25.5], [-47, 19]], Hf, { ...opt, step: 1.1 }); trail(B, 'tread', [[-6, 34], [-12, 27], [-17.5, 21], [-17.6, 14]], Hf, { ...opt, step: 1.1 }); }
    T0('tracks');
    // pines on the rim + behind the north chalets (hand-placed hero trees; the rest of the forest comes from the route)
    setPotFir(conifer({ h: 6, seed: 51, kind: 'fir', snow: 0.5, droop: 0.28 })); const g1 = conifer({ h: 12, seed: 5, kind: 'spruce', snow: 0.8 }), g2 = conifer({ h: 9, seed: 12, kind: 'fir', snow: 0.7, droop: 0.3 }), g3 = conifer({ h: 14, seed: 17, kind: 'spruce', snow: 0.75, lean: 0.08 });
    const rt = makeRng(77); for (let i = 0; i < 46; i++) { const a = rt() * 6.283; let x = Math.cos(a) * (58 + rt() * 26), z = Math.sin(a) * (44 + rt() * 22); if (Math.abs(x) < 46 && Math.abs(z) < 34) continue; const y = H(x, z); if (y > 60 || L.slopeDeg(x, z, 3) > 36) continue; { const q = rt(); B.instance('vpine' + (q < 0.4 ? 1 : q < 0.75 ? 2 : 3), q < 0.4 ? g1 : q < 0.75 ? g2 : g3, M.pine, B.matrix([x, y - 0.3, z], rt() * 6.3, 0.75 + rt() * 0.8), 0xffffff, { cast: false }); } }
    T0('props');
    // ------------------------------------------------------------ atmosphere
    const sunDir = new THREE.Vector3(-0.5, 0.46, -0.72).normalize();
    unifyPrograms(B);
    const atmo = {
      name: 'Whiteout · Base Village (night blizzard)',
      fog: { color: 0x0f1a2f, scatter: 0x3a5486, density: 0.0125, falloff: 0.012, base: 0, power: 3 },
      sky: { zenith: 0x050914, horizon: 0x23365a, ground: 0x0a1120, gradPow: 0.6, sunColor: 0xb2c8f2, sunSize: 0.03, sunGlow: 0.55, disc: 2, stars: 0.12, cloud: 0.96, cloudColor: 0x1b2843, cloudLit: 0x5b78ab, cloudSpeed: 0.007, cloudScale: 1.4, cloudDark: 0.5, horizonFog: 0.85 },
      sun: { dir: sunDir.toArray(), color: 0xa9c2ee, intensity: 0.95, shadow: true }, env: { intensity: 0.5 },
      exposure: 0.8, bloom: 0.52, vignette: 0.42, grain: 0.04, chroma: 0.0017, ao: 0.7,
      grade: { sat: 1.06, contrast: 1.1, lift: [0.0, 0.008, 0.03], gain: [1, 1, 1.03], tint: [1, 1, 1] }, autoExposure: { key: 0.11, min: 0.7, max: 1.4 },
      wind: [3.0, 0, 8.0], snow: 0.85, wet: 0, frost: 0.22, reverb: 'snow',
    };
    const wxA = ctx.weather({ count: 9000, box: [24, 14, 24], fall: 1.5, wind: [3, 0, 8.2], size: 0.03, turb: 0.9, color: [0.9, 0.94, 1], alpha: 0.9, cell: 3, seed: 3 });
    const wxM = ctx.weather({ count: 7000, box: [50, 26, 50], fall: 1.5, wind: [3, 0, 8.2], size: 0.034, turb: 0.9, color: [0.85, 0.9, 1], alpha: 0.7, cell: 3, seed: 5 });
    const wxB = ctx.weather({ count: 620, box: [13, 8, 13], fall: 1.2, wind: [3.4, 0, 9.4], size: 0.032, turb: 1.3, color: [0.95, 0.97, 1], alpha: 0.5, cell: 3, seed: 9 });
    const wxC = ctx.weather({ count: 4200, box: [32, 16, 32], fall: 2.0, wind: [6, 0, 17], size: 0.016, streak: 10, turb: 0.5, color: [0.85, 0.9, 1], alpha: 0.0, cell: 13, seed: 15 });
    const veil = new WindVeil(ctx.gfx, { wind: [4.4, 11.6], alpha: 0.24, color: [0.8, 0.87, 1], coverage: 0.3 }); ctx.group.add(veil.mesh);
    const smokeC = [...chalets.filter((c) => c.chimney).map((c) => c.chimney), kiosk.steam]; let smokeT = 0, gust = 0;
    return {
      atmo, envPatches: [{ dir: sunDir.toArray(), color: 0xa8c0f0, size: 2.4, intensity: 5 }, { dir: [0.9, 0.05, 0.15], color: 0xff9a50, size: 5, intensity: 0.03 }],
      playerStart: { pos: [-36, 0, -8], yaw: -P / 2 }, station: { pos: [0, 0, 0], yaw: st.yaw }, heightFn: Hg, groundSurface: 'snow', surfaceAt: (x, z) => (x > HALL.x0 && x < HALL.x1 && z > HALL.z0 && z < HALL.z1 ? 'concrete' : 'snow'),
      navBounds: [-44, -32, 44, 32], landmark: { pos: [HALL.x0 - 1.5, 9, 4], name: 'Gondola Terminal' },
      spawns: [
        { kind: 'barricade', pos: [-38, 0, -21.2], yaw: P, boards: 5, note: 'N1 door' }, { kind: 'barricade', pos: [-7.4, 0, -20.8], yaw: P, boards: 5, note: 'N3 door' },
        { kind: 'barricade', pos: [-34.5, 0, 24.0], yaw: 0, boards: 5, note: 'rental door' }, { kind: 'barricade', pos: [-36.2, 0, 1.4], yaw: -P / 2, boards: 5, note: 'W1 door' },
        { kind: 'walk', pos: [-44, 0, -2], yaw: -P / 2, note: 'west road' }, { kind: 'walk', pos: [-43, 0, -28], yaw: -P / 2 }, { kind: 'walk', pos: [4, 0, -31.5], yaw: P, note: 'north slope' }, { kind: 'walk', pos: [20, 0, 31.5], yaw: 0 }, { kind: 'walk', pos: [43.5, 0, 20], yaw: P / 2 },
        { kind: 'rise', pos: [-44, 0, 12], yaw: -P / 2 }, { kind: 'rise', pos: [-20, 0, 32], yaw: 0 }, { kind: 'rise', pos: [38, 0, 8], yaw: P / 2 }, { kind: 'rise', pos: [-25, 0, -29.4], yaw: P },
      ],
      buys: { walls: [{ pos: [-21.5, 1.5, -20.32], yaw: P, gun: 'olympia' }, { pos: [-24, 1.5, 22.9], yaw: 0, gun: 'mp5' }, { pos: [HALL.x0 - 0.05, 1.5, 10.5], yaw: P / 2, gun: 'm14' }], perks: [{ pos: [HALL.x0 - 0.9, 0, -11.5], yaw: P / 2, perk: 'juggernog' }], box: { pos: [-26.5, 0, 11.2], yaw: 0 } },
      zombieVariants: [{ id: 'tourist', weight: 5 }, { id: 'patrol', weight: 3 }, { id: 'tourist_skier', weight: 2, minRound: 2 }, { id: 'instructor', weight: 2, minRound: 3 }, { id: 'snowboarder', weight: 1.5, minRound: 4 }],
      ambient: { space: 'snow', gain: 1, beds: [{ type: 'wind', gain: 0.55, gust: 0.5, freq: 380 }, { type: 'hum', freq: 100, gain: 0.03, pos: [-19, 4, 4] }, { type: 'crackle', gain: 0.08, pos: [-25, 2, -24] }, { type: 'machine', gain: 0.06, freq: 42, pos: [-6, 3, 6] }],
        events: [{ type: 'creak', every: [5, 12], gain: 0.7, pos: 'around' }, { type: 'bell', every: [22, 45], gain: 0.7, pos: [ch.bell[0], ch.bell[1], ch.bell[2]] }, { type: 'rockfall', every: [35, 70], gain: 0.55, pos: 'far', pitch: [0.7, 0.9] }, { type: 'wolf', every: [40, 90], gain: 0.45, pos: 'far' }, { type: 'clank', every: [12, 30], gain: 0.5, pos: [8, 4, 4] }, { type: 'radio', every: [30, 60], gain: 0.35, pos: [-17, 1.5, -12] }, { type: 'whistle', every: [26, 55], gain: 0.4, pos: 'far' }] },
      wheel: T.wheel,
      update(dt, t, active) {
        const veh = ctx.world.vehicle; const rs = veh ? (veh.ropeSpeed ?? 0.5) : 0.5; if (T.wheel) T.wheel.rotation.y -= rs / L.RAIL_R * dt;
        gust = 0.5 + 0.5 * Math.sin(t * 0.33) * Math.sin(t * 0.121 + 1.7); wxC.w.cfg.alpha = 0.16 + 0.5 * gust * gust; wxA.w.cfg.alpha = 0.9 - 0.2 * gust; wxM.w.cfg.alpha = 0.6 + 0.2 * gust; wxB.w.cfg.alpha = 0.45 + 0.2 * gust;
        { const cam = ctx.gfx.camera.position, o = ctx.origin; veil.update(dt, cam, o.y + Hg(cam.x - o.x, cam.z - o.z), (ctx.stop.intensity ?? 1) * (0.55 + 0.6 * gust)); }
        const flick = 1 - 0.28 * Math.max(0, Math.sin(t * 27.1) * Math.sin(t * 3.3 + 1) - 0.62) * 3; T.sign.emissiveIntensity = 2.6 * flick;
        if (!active) return; smokeT += dt; if (smokeT > 0.09) { smokeT = 0; for (const c of smokeC) fx.puff({ x: c[0] + (rand() - 0.5) * 0.3, y: c[1], z: c[2] + (rand() - 0.5) * 0.3 }, { x: 0.35, y: 1, z: 0.9 }, 1, { speed: 0.7, size: [0.25, 1.6], life: 3.6, color: [0.55, 0.58, 0.65, 0.22], rise: 1.0, drag: 0.5, spread: 0.4, cell: 1 }); }
      },
    };
  },
};
