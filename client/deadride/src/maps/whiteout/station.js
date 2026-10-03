// WHITEOUT -- Stop 2: MID-MOUNTAIN STATION (stronger storm, fog 0.048). An exposed ridge: concrete/steel/glass station with the glazed
// bullwheel hall + panoramic restaurant, wrecked chairlift, snow cannons, avalanche barriers, ski-patrol hut, crashed rescue sled.
// Palette: cold green-white emergency light; flickering fluorescents, red beacons; hard wind-scoured rime.
import * as THREE from 'three';
import { HaloBatch } from '../../core/glow.js';
import { rand, makeRng, clamp, smoothstep, noise2 } from '../../core/util.js';
import * as L from './land.js';
import { terrainPatch, coarse, unifyPrograms, pineGeometry, Frame, timer, heightGrid, FarLights, driftMesh, sunkH } from './common.js';
import { stationMats } from './smats.js';
import { buildStationHall, SSLAB, SBLOCK } from './sbuild.js';
import { chairlift, snowCannon, snowBridge, patrolHut, rescueSled, generatorShed, drift } from './sprops.js';
import { lampCone } from './snowkit.js';
import { makeBeam } from '../../core/glow.js';
import { WindVeil } from './veil.js';
import { conifer } from './trees.js';
import { trail } from './tracks.js';
import { stationDetails, hutDetails } from './sdetail.js';
import { scatter, floorGrime } from './props3.js';
import { lightMast, canopyDressing, snowFence, warnSign, palletStack, drum, patrolSled, groomer, clothAndTape, wheelLeds, netting, gazex } from './sdress.js';

const P = Math.PI;
export default {
  id: 'station', name: 'Mid-Mountain Station', origin: L.ORIGINS[1], viewRadius: 200,
  async build(ctx) {
    const T0 = timer('station'); const { B, fx } = ctx; coarse(B); const st = L.STATIONS[1]; const M = stationMats(B); const H = L.localH(1); const R = L.STOP_RECTS[1]; T0('materials');
    const halos = new HaloBatch(64); B.group.add(halos.mesh); const far = new FarLights(64, 0.6); B.group.add(far.mesh);
    const F = new Frame(B, 0, 0, st.yaw, 0);
    const inSlab = (x, z) => { const u = x * F.c - z * F.s, v = x * F.s + z * F.c; return u > SSLAB.u0 - 0.7 && u < SSLAB.u1 + 0.7 && v > SSLAB.v0 - 0.7 && v < SSLAB.v1 + 0.7; };
    const Hs = sunkH(H, F, SSLAB.u0, SSLAB.u1, SSLAB.v0, SSLAB.v1, 0.7, 1.6);
    const Hg = heightGrid(Hs, R.lminX, R.lmaxX, R.lminZ, R.lmaxZ, 2.5); B.colliders.heightFn = Hg;                                                       // sample the (expensive fbm) mountain function ONCE per grid node; the mesh + normals read the grid
    terrainPatch(B, { minX: R.lminX, maxX: R.lmaxX, minZ: R.lminZ, maxZ: R.lmaxZ, cell: 2.5, chunk: 32, H: Hg, mat: M.terrain, skirt: 8 }); T0('terrain');
    const S = buildStationHall(ctx, B, M, st, far); T0('hall');
    // ------------------------------------------------------------ plateau dressing
    const hut = patrolHut(B, M, ctx, 14, -16, 2.42); const shed = generatorShed(B, M, ctx, -14, 16, -0.72); rescueSled(B, M, 8.4, H(8.4, -9.6), -9.6, 0.7); T0('huts');
    // ------------------------------------------------------------ dressing: canopy, light masts, groomer, patrol sled, pallets, fences, signs, flags
    canopyDressing(ctx, B, M, halos, F); stationDetails(ctx, B, M, halos, F, SBLOCK); hutDetails(ctx, B, M, halos, hut, shed);
    const masts = [[7.6, -6.5], [-8.6, 12.5], [7.2, 17.5]].map(([u, v]) => { const p = F.p(u, 0, v); return lightMast(ctx, B, M, halos, p[0], p[2], F.yaw + P, { h: 8.5, y0: 0 }); });
    { const q = F.p(-14.5, 0, -6.5); masts.push(lightMast(ctx, B, M, halos, q[0], q[2], F.yaw, { h: 8, y0: H(q[0], q[2]), intensity: 20, dist: 22 })); }
    { const g = F.p(2.5, 0, -22.5); groomer(ctx, B, M, halos, g[0], H(g[0], g[2]), g[2], F.yaw + 0.5); const s1 = F.p(9.2, 0, 8), s2 = F.p(9.0, 0, 10.4); patrolSled(B, M, s1[0], 0, s1[2], F.yaw + P / 2 + 0.2); patrolSled(B, M, s2[0], 0, s2[2], F.yaw + P / 2 - 0.15); }
    { const a = F.p(8.4, 0, 20.9), b = F.p(9.4, 0, 22.1); palletStack(B, M, a[0], a[2], F.yaw, 3, 1); palletStack(B, M, b[0] - 1.6, b[2] - 0.5, F.yaw + 0.3, 2, 2); drum(B, M, a[0] + 1.6, a[2] + 0.9, M.orange); drum(B, M, a[0] + 2.2, a[2] + 0.4, M.red); drum(B, M, a[0] + 1.9, a[2] - 0.4, M.steel); }
    snowFence(B, M, H, [-22, -21], [-8, -22.5], 1); snowFence(B, M, H, [2, -27], [14, -26.5], 2); snowFence(B, M, H, [-27, 15], [-24, 4], 3);
    { const a = F.p(-9.5, 0, -15.6), b = F.p(9.6, 0, -1.4), c = F.p(-9.4, 0, 3.0); warnSign(B, M, a[0], a[2], F.yaw, 'closed'); warnSign(B, M, b[0], b[2], F.yaw + P / 2, 'avalanche'); warnSign(B, M, c[0], c[2], F.yaw + P / 2, 'assembly'); const d = hut.door; warnSign(B, M, d[0] - 3, d[2] + 1.5, 2.4, 'avalanche'); }
    clothAndTape(B, M, H, F, [5, 0, 13.5]);
    { const Mx = { ...M, timberV: M.timber, beam: M.timber, steelRed: M.red, zinc: M.galv, paintRed: M.red, paintBlue: M.steelDark, plaster: M.rime }; const HF = new Frame(B, hut.door[0], hut.door[2], hut.F.yaw, 0);
      scatter(B, Mx, F, [['crate', -8.6, -3], ['crate', -8.6, -3.5, 0.3, 0.4], ['jerrycan', -8.3, -4.1], ['bin', -8.6, -7.5], ['bin', -8.6, -8.3], ['saltBin', -8.4, -11], ['extinguisher', -9.1, -2.5], ['extinguisher', -9.1, -9.5], ['cone', -1.9, -13.2], ['cone', -1.9, -9.4], ['cone', -1.9, -5.7], ['bucket', -8.2, -13.6], ['shovel', -9.15, -13.0], ['ropeCoil', -8.5, -1.5], ['skiBag', -7.0, 0.8, 0.2], ['sack', 0.6, -13.6], ['sack', 1.1, -13.9], ['tyre', 2.0, -3.4], ['boots', -6.0, -1.2], ['crate', 6.4, -1.8], ['jerrycan', 6.9, -1.4], ['bin', 10.2, 5.4], ['sandbags', 10.0, -0.4, 1.57]], 3);
      scatter(B, Mx, HF, [['crate', 2.2, -1.0], ['jerrycan', 2.6, -1.3], ['bucket', -1.8, -1.2], ['skiBag', 3.0, 0.5, 1.5], ['boots', -0.4, -0.8], ['sandbags', -3.0, -1.1], ['cone', 3.6, -2.4], ['shovel', -2.4, 0.0, 1.5]], 4); }
    wheelLeds(S.wheel, M, L.RAIL_R);
    { const pp = (u, v) => { const q = F.p(u, 0, v); return [q[0], q[2]]; }; netting(B, M, Hg, pp(-24, -18), pp(-24, 12), 0, 1); netting(B, M, Hg, pp(-22, 20), pp(-2, 27), 0, 2); netting(B, M, Hg, pp(20, -20), pp(21, 8), 0, 3);
      const g1 = F.p(-16, 0, 24), g2 = F.p(15, 0, -27); gazex(ctx, B, M, halos, g1[0], Hg(g1[0], g1[2]), g1[2], F.yaw + 0.6); gazex(ctx, B, M, halos, g2[0], Hg(g2[0], g2[2]), g2[2], F.yaw - 2.3); }
    // the landmark: steady cold floods inside the glass hall + warm light under the turning wheel
    ctx.light({ pos: F.p(1.2, 4.6, 6), color: 0xe4fff2, intensity: 26, distance: 15, decay: 2 }); ctx.light({ pos: F.p(6.4, 4.6, 12), color: 0xe4fff2, intensity: 20, distance: 14, decay: 2 }); ctx.light({ pos: F.p(3.4, 1.4, 8), color: 0xff9a50, intensity: 16, distance: 10, decay: 2, flicker: 0.05, flickerSpeed: 3 });
    { const Hf = (x, z) => (inSlab(x, z) ? 0.0 : Hg(x, z)) + 0.02, opt = { lift: 0.03, step: 0.8 }; const fp = (u, v) => { const q = F.p(u, 0, v); return [q[0], q[2]]; };
      trail(B, 'foot', [[hut.door[0], hut.door[2]], fp(-4, -17.2), fp(-7.6, -13.6), fp(-8, -9)], Hf, { ...opt, jitter: 0.05 }); trail(B, 'foot', [fp(-8, -9), fp(-6, -4), fp(-3, 0.4), fp(1, 3.5)], Hf, { ...opt, jitter: 0.06 });
      trail(B, 'foot', [fp(-8.4, 12), fp(-5.6, 8.5), fp(-4.4, 4)], Hf, { ...opt, jitter: 0.05 }); trail(B, 'foot', [fp(12.4, 2), fp(14, -3), fp(13.6, -10)], Hf, { ...opt, jitter: 0.05 });
      trail(B, 'tread', [fp(-24, -28), fp(-10, -27), fp(2.5, -23), fp(14, -26), fp(24, -20)], Hf, { ...opt, step: 1.1 }); trail(B, 'tread', [fp(2.5, -23), fp(6, -30), fp(12, -36)], Hf, { ...opt, step: 1.1 });
      trail(B, 'ski', [fp(9.2, 9), fp(13, 14), fp(16.5, 22), fp(20, 30)], Hf, opt); trail(B, 'ski', [fp(9, 10.4), fp(12, 12), fp(-14, 8), fp(-21, -2)], Hf, opt);
      const fl = () => 0.015, o2 = { lift: 0.012, step: 0.75 };      // wet boot prints across the platform slab (canopy zone)
      [[[-1, -13.5], [-2.5, -9], [-3.2, -4], [-2, 0.5]], [[-7.5, -12], [-6, -7.5], [-4.4, -3.6], [-1.4, -1.2]], [[0.8, -12], [-0.4, -8], [-1.6, -5]], [[-5, -3], [-3, -1], [0.5, 0]], [[-8.6, -6], [-7, -2.6], [-5.6, 0.4]], [[1.4, -3.6], [-0.2, -6.4], [-1.8, -10.4], [-3.6, -14]]].forEach((p2, i) => trail(B, 'foot', p2.map(([u, v]) => fp(u, v)), fl, { ...o2, jitter: 0.06 + 0.01 * i }));
      trail(B, 'tread', [fp(-9, -8), fp(-4, -8.4), fp(1, -8.2)], fl, { ...o2, step: 1.0 }); }
    { floorGrime(F, [[M.rime, 'blob', 3], [M.concreteDark, 'blob', 4], [M.rime, 'streak', 3], [M.concreteDark, 'streak', 2]], { u0: -8.8, u1: 2.2, v0: -13.8, v1: 1.0, n: 90, seed: 41, y: 0.022, sizes: [0.1, 0.62] });
      floorGrime(F, [[M.rime, 'blob', 4], [M.concreteDark, 'blob', 3]], { u0: 3, u1: 10, v0: -12, v1: 18, n: 40, seed: 42, y: 0.022, sizes: [0.12, 0.8] }); }
    T0('dressing');
    const lift = chairlift(B, M, ctx, H, [22.5, -30], [25.5, 21], { towers: 4, wreck: 2, chairs: 12, seed: 5 }); T0('chairlift');
    const cannons = [[-24, -19, 0.5], [-25.5, -5, 0.2], [-20, 8, 0.4], [3, -24.5, 0.1], [18, -25, 0.3], [-7, 24, 0.8]];
    for (const [x, z, yw] of cannons) snowCannon(B, M, x, H(x, z), z, yw + 3.0);
    // avalanche barriers on the flanks (rows across the fall line)
    const bars = [[-34, -12], [-36, 0], [-34, 12], [-30, -24], [-8, -34], [10, -35], [-40, 20], [34, 8], [36, -8]];
    bars.forEach(([x, z], i) => { const e = 2; const gx = (H(x + e, z) - H(x - e, z)) / (2 * e), gz = (H(x, z + e) - H(x, z - e)) / (2 * e); const yaw = Math.atan2(gz, -gx) + P / 2 * 0; snowBridge(B, M, H, x, z, Math.atan2(-gx, -gz) + P, 6.5, 3 + i); });
    T0('barriers');
    // wind drifts (long crests streaming SSE off every obstacle)
    const dr = [[-8, 8, 12, 1.5, 3, 0.36], [6, 9, 9, 1.3, 2.6, 0.4], [-4, 22, 12, 1.6, 3.4, 0.3], [20, -6, 10, 1.4, 2.4, 0.4], [12, 20, 8, 1.2, 2.4, 0.4], [-22, -14, 9, 1.2, 2.6, 0.2], [-14, -22, 9, 1.0, 2.4, 0.3], [-24, 20, 9, 1.6, 3.4, 0.5], [0, -25, 10, 1.2, 2.6, 0.2], [24, 12, 8, 1.4, 3, 0.5], [-26, -2, 6, 1.6, 3.2, 0.3], [16, -24, 8, 1.0, 2.2, 0.3]];
    dr.forEach(([x, z, l, h, w, yw], i) => driftMesh(B, M.snow, Hs, { x, z, len: l * 1.6, wid: w * 1.7, h: h * 0.9, ax: 0.35 + yw * 0.15, az: 0.94, seed: 50 + i }));
    // a few storm-bent pines on the rim
    const g1 = conifer({ h: 8, seed: 7, kind: 'spruce', snow: 0.9, lean: 0.12, droop: 0.42 }); const rt = makeRng(4); for (let i = 0; i < 18; i++) { const a = rt() * 6.283, x = Math.cos(a) * (46 + rt() * 20), z = Math.sin(a) * (44 + rt() * 20); if (Math.abs(x) < 30 && Math.abs(z) < 29) continue; const y = H(x, z); if (L.slopeDeg(x + L.ORIGINS[1][0], z + L.ORIGINS[1][2], 3) > 34) continue; B.instance('spine', g1, M.pine, B.matrix([x, y - 0.3, z], rt() * 6, 0.6 + rt() * 0.6, 0.12, 0.05), 0xffffff, { cast: false }); }
    T0('props');
    // ------------------------------------------------------------ lights: flickering emergency fluorescents, red rotating beacon, mast floodlight
    const emerg = [...S.flick, ...S.hallLamps].map((p) => ctx.light({ pos: [p[0], p[1] - 0.1, p[2]], color: 0xc8ffe2, intensity: 11, distance: 12, decay: 2, flicker: 0.55, flickerSpeed: 9 }));
    const redL = ctx.light({ pos: S.beacon.position.toArray(), color: 0xff2a18, intensity: 30, distance: 22, decay: 2 });
    const flood = ctx.light({ pos: [F.p(4, 12.5, 12)[0], 12.5, F.p(4, 12.5, 12)[2]], color: 0xdaf8ee, intensity: 160, distance: 44, decay: 2, kind: 'spot', dir: [0.5, -0.8, 0.4], angle: 0.6, penumbra: 0.7, flicker: 0.05 });
    ctx.light({ pos: [hut.door[0], 3.2, hut.door[2]], color: 0xa8ffc8, intensity: 7, distance: 10, decay: 2 });
    // rotating red beacon sweep + cold light cones under the canopy fluorescents + mast flood beam
    const bpos = S.beacon.position; const pivot = new THREE.Group(); pivot.position.copy(bpos); B.group.add(pivot); const sweep = makeBeam({ length: 30, r0: 0.05, r1: 3.0, color: 0xff3a22, intensity: 0.1, dust: 0.7, near: 1.5 }); sweep.rotation.x = 0.06; pivot.add(sweep); const sweep2 = makeBeam({ length: 30, r0: 0.05, r1: 3.0, color: 0xff3a22, intensity: 0.1, dust: 0.7, near: 1.5 }); sweep2.rotation.set(0.06, Math.PI, 0); pivot.add(sweep2);
    for (const p of S.flick) lampCone(B.group, [p[0], p[1] - 0.1, p[2]], { len: 5.0, r1: 2.0, color: 0xd8fff0, intensity: 0.12 });
    const floodBeam = makeBeam({ length: 34, r0: 0.7, r1: 8.5, color: 0xdaf8ee, intensity: 0.028, dust: 1.35, near: 3.5 }); floodBeam.position.set(F.p(4, 12.5, 12)[0], 12.5, F.p(4, 12.5, 12)[2]); floodBeam.lookAt(floodBeam.position.x + 0.5 * 20, 12.5 - 0.8 * 20, floodBeam.position.z + 0.4 * 20); B.group.add(floodBeam);
    // ------------------------------------------------------------ atmosphere
    const moon = new THREE.Vector3(0.25, 0.42, -0.6).normalize();
    unifyPrograms(B);
    const atmo = {
      name: 'Whiteout · Mid-Mountain Station (storm)',
      fog: { color: 0x141c1b, scatter: 0x486760, density: 0.046, falloff: 0.008, base: 0, power: 2.5 },
      sky: { zenith: 0x090f0e, horizon: 0x1d2826, ground: 0x0d1312, gradPow: 0.5, sunColor: 0xb4d4c8, sunSize: 0.03, sunGlow: 0.2, disc: 0, stars: 0, cloud: 1.0, cloudColor: 0x151c1b, cloudLit: 0x3a4843, cloudSpeed: 0.014, cloudScale: 1.7, cloudDark: 0.3, horizonFog: 0.95 },
      sun: { dir: moon.toArray(), color: 0xa4c6bd, intensity: 0.28, shadow: false }, env: { intensity: 0.5 },
      exposure: 1.0, bloom: 0.62, vignette: 0.5, grain: 0.05, chroma: 0.0022, ao: 0.75,
      grade: { sat: 0.82, contrast: 1.18, lift: [0.0, 0.004, 0.004], gain: [0.985, 1.01, 1.0], tint: [0.99, 1.0, 1.0] }, autoExposure: { key: 0.085, min: 0.8, max: 1.3 },
      wind: [5, 0, 13.5], snow: 0.6, wet: 0, frost: 0.55, reverb: 'snow',
    };
    const wxA = ctx.weather({ count: 9000, box: [24, 14, 24], fall: 1.8, wind: [5.2, 0, 14], size: 0.03, turb: 1.1, color: [0.86, 0.95, 0.92], alpha: 0.9, cell: 3, seed: 21 });
    const wxM = ctx.weather({ count: 7500, box: [50, 26, 50], fall: 1.8, wind: [5.2, 0, 14], size: 0.034, turb: 1.1, color: [0.82, 0.92, 0.88], alpha: 0.7, cell: 3, seed: 22 });
    const wxB = ctx.weather({ count: 700, box: [13, 8, 13], fall: 1.5, wind: [5.6, 0, 15.5], size: 0.032, turb: 1.4, color: [0.9, 0.98, 0.95], alpha: 0.5, cell: 3, seed: 23 });
    const wxC = ctx.weather({ count: 5000, box: [34, 18, 34], fall: 2.4, wind: [8, 0, 22], size: 0.018, streak: 11, turb: 0.5, color: [0.8, 0.92, 0.88], alpha: 0.3, cell: 13, seed: 25 });
    const veil = new WindVeil(ctx.gfx, { wind: [5.5, 14.5], alpha: 0.38, color: [0.7, 0.82, 0.78], coverage: 0.25 }); ctx.group.add(veil.mesh);
    const wv = F.p(3.4, 0, 8), st0 = F.p(-3.5, 0, -15); st0[1] = 0;
    let beaconA = 0; let gust = 0, cannonT = 0, cut = 0, cutT = 6 + Math.random() * 10;
    return {
      atmo, envPatches: [{ dir: moon.toArray(), color: 0xb0cdc6, size: 3, intensity: 2.0 }, { dir: [0, 0.6, 0], color: 0x86a49c, size: 6, intensity: 0.35 }],
      playerStart: { pos: st0, yaw: Math.atan2(-(wv[0] - st0[0]), -(wv[2] - st0[2])) }, station: { pos: [0, 0, 0], yaw: st.yaw }, heightFn: Hg, groundSurface: 'snow', surfaceAt: (x, z) => (inSlab(x, z) ? 'concrete' : 'snow'),
      navBounds: [-26, -25, 26, 25], landmark: { pos: [wv[0], 4.5, wv[2]], name: 'Glass Station' },
      spawns: [
        { kind: 'barricade', pos: F.p(9.45, 0, 5.0), yaw: Math.atan2(-F.c, F.s), boards: 5, note: 'station service door' },
        { kind: 'barricade', pos: hut.F.p(1.4, 0, -1.35), yaw: 2.42, boards: 5, note: 'patrol hut' },
        { kind: 'barricade', pos: shed.F.p(-0.9, 0, -1.25), yaw: -0.72, boards: 5, note: 'generator shed' },
        { kind: 'walk', pos: [-26, 0, -2], yaw: -P / 2 }, { kind: 'walk', pos: [-14, 0, -25], yaw: P }, { kind: 'walk', pos: [24, 0, -18], yaw: P / 2 }, { kind: 'walk', pos: [22, 0, 24], yaw: 0 }, { kind: 'walk', pos: [-22, 0, 22], yaw: -P / 4 },
        { kind: 'rise', pos: [-8, 0, 9], yaw: 0 }, { kind: 'rise', pos: [-24, 0, -13], yaw: -P / 2 }, { kind: 'rise', pos: [21, 0, -5], yaw: P / 2 }, { kind: 'rise', pos: [-1, 0, 22], yaw: 0 },
      ],
      buys: { walls: [{ pos: F.p(10.55, 1.5, 9.5), yaw: Math.atan2(-F.c, F.s), gun: 'ak74u' }, { pos: hut.F.p(-0.2, 1.5, -2.35), yaw: 2.42, gun: 'mp5' }], perks: [{ pos: F.p(4.5, 0, 0.7), yaw: st.yaw, perk: 'speedCola' }], box: { pos: [9, 0, -13.5], yaw: 2.42 } },
      zombieVariants: [{ id: 'patrol', weight: 5 }, { id: 'tourist', weight: 3 }, { id: 'instructor', weight: 2, minRound: 2 }, { id: 'guide', weight: 2, minRound: 2 }, { id: 'snowboarder', weight: 1.5, minRound: 3 }, { id: 'tourist_skier', weight: 1.5 }],
      ambient: { space: 'snow', gain: 1, beds: [{ type: 'wind', gain: 0.75, gust: 0.7, freq: 480 }, { type: 'machine', gain: 0.1, freq: 58, pos: [F.p(4, 3, 12)[0], 3, F.p(4, 3, 12)[2]] }, { type: 'hum', freq: 50, gain: 0.05, pos: [F.p(-4.6, 5, -5)[0], 5, F.p(-4.6, 5, -5)[2]] }, { type: 'noise', gain: 0.05, freq: 3000 }],
        events: [{ type: 'creak', every: [4, 10], gain: 0.8, pos: 'around' }, { type: 'clank', every: [8, 18], gain: 0.8, pos: [23, 6, 6] }, { type: 'ice-crack', every: [15, 35], gain: 0.6, pos: 'around' }, { type: 'pipe', every: [20, 40], gain: 0.4, pos: [F.p(4, 3, 12)[0], 3, F.p(4, 3, 12)[2]] }, { type: 'ping', every: [25, 50], gain: 0.4, pos: [F.p(-4.6, 5, -5)[0], 5, F.p(-4.6, 5, -5)[2]] }, { type: 'radio', every: [20, 45], gain: 0.35, pos: [hut.door[0], 2, hut.door[2]] }, { type: 'gust', every: [7, 16], gain: 0.7, pos: 'around' }, { type: 'rockfall', every: [40, 80], gain: 0.55, pos: 'far' }] },
      update(dt, t, active) {
        const veh = ctx.world.vehicle; const rs = veh ? (veh.ropeSpeed ?? 0.5) : 0.5; if (S.wheel) S.wheel.rotation.y -= rs / L.RAIL_R * dt; if (S.fly) S.fly.rotation.z += 0.35 * dt * (0.4 + rs / 6);
        gust = 0.5 + 0.5 * Math.sin(t * 0.41) * Math.sin(t * 0.17 + 0.8); wxC.w.cfg.alpha = 0.2 + 0.6 * gust * gust; wxA.w.cfg.alpha = 0.9 - 0.2 * gust; wxM.w.cfg.alpha = 0.65 + 0.2 * gust; wxB.w.cfg.alpha = 0.45 + 0.2 * gust;
        { const cam = ctx.gfx.camera.position, o = ctx.origin; veil.update(dt, cam, o.y + Hg(cam.x - o.x, cam.z - o.z), (ctx.stop.intensity ?? 1) * (0.6 + 0.6 * gust)); }
        // emergency power: fluorescents flicker; now and then the whole hall drops out for a beat
        cutT -= dt; if (cutT < 0) { cut = 0.25 + Math.random() * 0.5; cutT = 9 + Math.random() * 18; } cut = Math.max(0, cut - dt);
        const fl = (0.78 + 0.22 * noise2(t * 11, 3.3)) * (Math.sin(t * 47) * Math.sin(t * 13.7) > 0.86 ? 0.2 : 1) * (cut > 0 ? 0.05 : 1); M.lampG.emissiveIntensity = 6 * fl; M.glassLit.emissiveIntensity = 1.6 * (0.85 + 0.15 * fl); M.glassWarm.emissiveIntensity = 1.7 * (0.9 + 0.1 * fl); M.exit.emissiveIntensity = 3 * (cut > 0 ? 0.6 : 1);
        for (const l of emerg) l.on = cut > 0 ? 0.08 : 1;
        beaconA += dt * 1.5; pivot.rotation.y = beaconA;
        const bp = Math.max(0, Math.sin(t * 3.4)); M.lampR.emissiveIntensity = 1 + 9 * bp; if (S.beacon) S.beacon.material.emissiveIntensity = 1 + 9 * bp; redL.intensity = 4 + 40 * bp;
        if (!active) return; cannonT += dt; if (cannonT > 0.06) { cannonT = 0; for (const c of [cannons[0], cannons[3]]) { const x = c[0], z = c[1], yw = c[2] + 3.0; fx.puff({ x: x - Math.sin(yw) * 1.5, y: H(x, z) + 5.0, z: z - Math.cos(yw) * 1.5 }, { x: -Math.sin(yw), y: 0.1, z: -Math.cos(yw) }, 1, { speed: 7, size: [0.3, 2.6], life: 2.4, color: [0.88, 0.94, 0.92, 0.35], rise: -0.3, drag: 1.4, spread: 0.6, cell: 1, grav: 0.3 }); } }
      },
    };
  },
};
