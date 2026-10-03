// WHITEOUT -- Stop 3: SUMMIT OBSERVATORY (the worst storm). Near-total whiteout gusts, lightning-flash sky, aurora through the gaps.
// Landmark: the ice-glazed 1930s stone observatory with the copper dome (open slit + refractor) and the radio mast with red beacons.
// Palette: pale blue / violet moonlight, black basalt, rime on everything.
import * as THREE from 'three';
import { HaloBatch } from '../../core/glow.js';
import { makeBeam } from '../../core/glow.js';
import { rand, makeRng, clamp, smoothstep, noise2 } from '../../core/util.js';
import { G, glowMaterial } from '../../core/mats.js';
import * as L from './land.js';
import { terrainPatch, coarse, unifyPrograms, Frame, quad, timer, heightGrid, FarLights, driftMesh, sunkH, AtmoMod, addIcicles } from './common.js';
import { skyOccluder, windowQuad, roofSnow, slabSnow } from './snowkit.js';
import { ledBoard } from './sdress.js';
import { WindVeil } from './veil.js';
import { trail } from './tracks.js';
import { scatter } from './props3.js';
import { observatoryDetails, hutRoofDetails, hutCourses, mastDetails } from './udetail.js';
import { guideRope, summitCross, weatherStation, terraceRail, buriedCat } from './udress.js';
import { summitMats } from './umats.js';
import { wall } from './chalets.js';
import { buildObservatory, buildAnnex, buildMast, rimeFeathers, spires } from './ubuild.js';
import { makeBullwheel } from './wheel.js';
import { stationRope } from './line.js';

const P = Math.PI;
export default {
  id: 'summit', name: 'Summit Observatory', origin: L.ORIGINS[2], viewRadius: 220,
  async build(ctx) {
    const T0 = timer('summit'); const { B, fx, gfx } = ctx; coarse(B); const st = L.STATIONS[2]; const M = summitMats(B); const H = L.localH(2); const R = L.STOP_RECTS[2]; T0('materials');
    const halos = new HaloBatch(96); B.group.add(halos.mesh); const far = new FarLights(32, 0.5); B.group.add(far.mesh);
    const F = new Frame(B, 0, 0, st.yaw, 0); const O = L.ORIGINS[2]; const wnd = [0.35, 0.94];
    // ------------------------------------------------------------ ground: sunk under the station slab and the observatory terrace
    const SL = { u0: -9.8, u1: 10.8, v0: -12.5, v1: 18.2 };
    const Hs0 = sunkH(H, F, SL.u0, SL.u1, SL.v0, SL.v1, 0.7, 1.6);
    const OBS = { x: 11.5, z: 13.5 }; const rectSink = (Hb, x0, x1, z0, z1) => (x, z) => { const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1); return Hb(x, z) - 0.7 * (1 - smoothstep(0, 1.6, Math.hypot(dx, dz))); };
    const Hs = rectSink(Hs0, OBS.x - 8.4, OBS.x + 8.4, OBS.z - 8.4, OBS.z + 8.4);
    const Hg = heightGrid(Hs, R.lminX, R.lmaxX, R.lminZ, R.lmaxZ, 2.5); B.colliders.heightFn = Hg;                                                       // sample the (expensive fbm) mountain function ONCE per grid node; the mesh + normals read the grid
    terrainPatch(B, { minX: R.lminX, maxX: R.lmaxX, minZ: R.lminZ, maxZ: R.lmaxZ, cell: 2.5, chunk: 32, H: Hg, mat: M.terrain, skirt: 8 }); T0('terrain');
    // ------------------------------------------------------------ stone lift hut around the bullwheel (the summit station)
    const t = 0.8, u0 = -1.6, u1 = 10.2, v0 = 1.0, v1 = 16.5, hw = 6.2;
    F.box({ p: [(SL.u0 + SL.u1) / 2, -0.7, (SL.v0 + SL.v1) / 2], s: [SL.u1 - SL.u0, 0.7, SL.v1 - SL.v0], mat: M.concrete, bevel: 0.03, col: 'concrete' });
    F.box({ p: [(SL.u0 + SL.u1) / 2, 0, (SL.v0 + SL.v1) / 2], s: [SL.u1 - SL.u0 - 0.4, 0.015, SL.v1 - SL.v0 - 0.4], mat: M.floor, bevel: 0.002, col: false, cast: false });
    wall(F, 'v', u1 - t / 2, v0, v1, 0, hw, t, M.granite, [{ c: 4.4, w: 6.4, y0: 0, y1: 5.5 }, { c: 11.6, w: 1.5, y0: 0, y1: 1.9 }, { c: 14.6, w: 1.2, y0: 1.2, y1: 3.4 }], 'rock');
    wall(F, 'u', v1 - t / 2, u0, u1, 0, hw, t, M.graniteDark, [{ c: 4.3, w: 1.2, y0: 1.2, y1: 3.4 }], 'rock');
    wall(F, 'u', v0 + t / 2, u0, u1, 0, hw, t, M.granite, [{ c: 1.4, w: 1.7, y0: 1.0, y1: 4.4 }, { c: 4.8, w: 1.7, y0: 1.0, y1: 4.4 }, { c: 8.2, w: 1.7, y0: 1.0, y1: 4.4 }], 'rock');
    wall(F, 'v', u0 + t / 2, v0, v1, 0, hw, t, M.granite, [{ c: 4.6, w: 1.7, y0: 1.0, y1: 4.4 }, { c: 8.6, w: 1.7, y0: 1.0, y1: 4.4 }, { c: 12.6, w: 1.7, y0: 1.0, y1: 4.4 }], 'rock');
    const nU = [F.c, -F.s], nV = [F.s, F.c]; let wk = 0;
    const glow = (ax, fixed, c, w, y0, y1, face) => { const n = ax === 'u' ? (face > 0 ? [-nV[0], -nV[1]] : nV) : (face > 0 ? [-nU[0], -nU[1]] : nU); const p = F.p(...(ax === 'u' ? [c, (y0 + y1) / 2, fixed - face * 0.06] : [fixed - face * 0.06, (y0 + y1) / 2, c])); windowQuad(B, M.winCool, p, n, w, y1 - y0, (wk++) % 4);
      F.box({ p: ax === 'u' ? [c, y0 + (y1 - y0) / 2, fixed - face * 0.04] : [fixed - face * 0.04, y0 + (y1 - y0) / 2, c], s: ax === 'u' ? [w, 0.06, 0.1] : [0.1, 0.06, w], mat: M.iron, col: false, cast: false }); F.box({ p: ax === 'u' ? [c, y0 - 0.1, fixed - face * 0.3] : [fixed - face * 0.3, y0 - 0.1, c], s: ax === 'u' ? [w + 0.5, 0.2, 0.7] : [0.7, 0.2, w + 0.5], mat: M.graniteDark, col: false, cast: false }); };
    for (const c of [1.4, 4.8, 8.2]) glow('u', v0 + t / 2, c, 1.7, 1.0, 4.4, 1); for (const c of [4.6, 8.6, 12.6]) glow('v', u0 + t / 2, c, 1.7, 1.0, 4.4, 1);
    F.box({ p: [(u0 + u1) / 2, hw, (v0 + v1) / 2], s: [u1 - u0 + 0.9, 0.4, v1 - v0 + 0.9], mat: M.concrete, bevel: 0.04, col: false }); skyOccluder(B, F, u0 - 0.5, u1 + 0.5, v0 - 0.5, v1 + 0.5, hw - 0.1, hw + 0.5); skyOccluder(B, F, -9.8, 3.2, -9.7, 1.6, 5.6, 6.6);
    F.prism({ p: [(u0 + u1) / 2, hw + 0.4, (v0 + v1) / 2], s: [v1 - v0 + 2.4, 3.6, u1 - u0 + 2.0], mat: M.copper, yaw: P / 2 }); { const cxx = F.p((u0 + u1) / 2, 0, (v0 + v1) / 2), N = new Frame(B, cxx[0], cxx[2], F.yaw - P / 2, 0), RH = 3.6, hdr = (u1 - u0 + 2.0) / 2; roofSnow(B, M.snow, N, { w: v1 - v0 + 0.4, d: u1 - u0, ridgeY: hw + 0.4 + RH, pitch: Math.atan2(RH, hdr), ov: 1.0, seed: 5, depth: 0.46 }); }
    F.box({ p: [(u0 + u1) / 2, hw + 0.4, v0 - 0.5], s: [u1 - u0 + 1.0, 0.4, 0.5], mat: M.iceSolid, bevel: 0.05, col: false, cast: false });
    for (const [a, b] of [[[F.p(u0 - 0.9, 0, v0 - 1.0)[0], F.p(u0 - 0.9, 0, v0 - 1.0)[2]], [F.p(u1 + 0.9, 0, v0 - 1.0)[0], F.p(u1 + 0.9, 0, v0 - 1.0)[2]]]]) addIcicles(B, M.iceSolid, a, b, { every: 0.17, seed: 21, y: hw + 0.35, minLen: 0.25, maxLen: 1.4 });
    // bullwheel (visible through the big frosted windows), drive housing, rope + rail
    const C = st.C; const wheel = makeBullwheel(ctx, { R: L.RAIL_R, mats: { steel: M.steel, steelRed: M.redPaint, iron: M.iron }, spokes: 12 }); wheel.position.set(C[0], L.PIVOT_H, C[1]); B.group.add(wheel);
    B.cyl({ p: [C[0], 0, C[1]], r: 4.3, h: 0.9, seg: 32, mat: M.concrete, col: 'concrete' }); B.box({ p: F.p(6.5, 0, 14.5), s: [3.0, 2.6, 2.4], yaw: F.yaw, mat: M.redPaint, bevel: 0.06, col: 'metal', walk: false });
    const rp = stationRope(2); B.tube({ pts: rp, r: 0.03, mat: M.wire, seg: 5, segs: rp.length * 2 }); const rail = rp.filter((_, i) => i % 2 === 0).map((p) => [p[0], p[1] + 0.34, p[2]]); B.tube({ pts: rail, r: 0.06, mat: M.iron, seg: 6, segs: rail.length, cast: true });
    for (let i = 0; i < rp.length; i += 8) B.beam([rp[i][0], rp[i][1] + 0.34, rp[i][2]], [rp[i][0], rp[i][1] + 1.2, rp[i][2]], 0.06, 0.06, { mat: M.iron, cast: false });
    // platform canopy over the exit arm: timber posts on granite footings, steel-plate roof glazed in ice, hazard edge
    for (const v of [1.0, -3.5, -8]) { for (const u of [-9.3, 2.9]) { F.box({ p: [u, -0.2, v], s: [0.9, 0.6, 0.9], mat: M.graniteDark, bevel: 0.04, col: 'rock' }); F.box({ p: [u, 0.4, v], s: [0.36, 5.2, 0.36], mat: M.timber, bevel: 0.03, col: 'wood' }); }
      F.beam([-9.3, 5.4, v], [2.9, 6.3, v], 0.3, 0.4, { mat: M.timber }); }
    F.box({ p: [-3.2, 6.0, -3.5], s: [13.4, 0.16, 12.6], mat: M.steelPaint, bevel: 0.03, col: false, cast: true }); slabSnow(B, M.snow, F, { u0: -9.95, u1: 3.65, v0: -9.95, v1: 2.85, y: 6.16, depth: 0.6, seed: 21 });
    addIcicles(B, M.iceSolid, [F.p(-9.6, 0, -9.7)[0], F.p(-9.6, 0, -9.7)[2]], [F.p(-9.6, 0, 1.5)[0], F.p(-9.6, 0, 1.5)[2]], { every: 0.15, seed: 31, y: 5.5, minLen: 0.2, maxLen: 1.2 });
    F.box({ p: [-1.36, 0.0, -4.5], s: [0.4, 0.012, 12.5], mat: M.redPaint, bevel: 0.002, col: false, cast: false }); F.box({ p: [-9.4, 0, -4.5], s: [0.1, 1.1, 12.4], mat: M.iron, bevel: 0.02, col: 'metal' });
    F.box({ p: [-8.92, 1.5, -1.0], s: [0.08, 0.84, 2.24], mat: M.iron, bevel: 0.01, col: false, cast: false }); quad(B, ledBoard(B, 'uBoard', ['GIPFEL', '3 452 m', 'WIND 118 KM/H'], { fg: '#cfe4ff', bg: '#050a14', k: 1.2 }), F.p(-8.87, 1.92, -1.0), 2.2, 0.8, F.yaw + Math.PI / 2);
    // rope gantries out along both arms (rail posts to the gates)
    for (const v of [-13.5, -19, -24]) { F.cyl({ p: [3.4, 0, v], r: [0.3, 0.18], h: 5.6, seg: 10, mat: M.steel, col: 'metal' }); F.beam([3.4, 5.2, v], [0.3, 5.05, v], 0.16, 0.22, { mat: M.steel }); F.box({ p: [0, 4.75, v], s: [0.5, 0.28, 0.5], mat: M.iron, bevel: 0.04, col: false }); }
    T0('station');
    // ------------------------------------------------------------ the observatory (landmark) + annex + mast
    const obs = buildObservatory(ctx, B, M, halos, OBS.x, OBS.z, 0.0, Hg); observatoryDetails(ctx, B, M, halos, obs); hutRoofDetails(ctx, B, M, F, u0, u1, v0, v1, hw); hutCourses(F, M, u0, u1, v0, v1, hw); T0('observatory');
    const annexF = new Frame(B, -12.5, 14, 0.0, 0); const annex = buildAnnex(ctx, B, M, halos, annexF);
    const mastX = -3, mastZ = 20; const mast = buildMast(ctx, B, M, far, mastX, mastZ, Hg(mastX, mastZ), 30); mastDetails(B, M, mastX, mastZ, Hg(mastX, mastZ), 30); T0('mast');
    // rim: basalt spires, boulders, cornices, drifts; rime feathers on windward edges
    spires(B, M, Hg, [[-19, -10, 8, 2.2], [-20, 4, 13, 2.6], [-17, 19, 9, 2.0], [16, -19, 11, 2.4], [20, -6, 7, 1.8], [19, 3, 14, 2.8], [4, -22, 8, 2.0], [-9, -22, 10, 2.3], [24, 12, 12, 2.5], [-24, 12, 9, 2.1], [8, 26, 8, 1.9], [-22, -20, 12, 2.4]], 5);
    for (const [x, z, l, h, w, yw] of [[-6, 4, 12, 1.6, 3.0, 0.3], [16, 22, 9, 1.5, 3, 0.2], [-16, -6, 12, 1.9, 3.4, 0.4], [-8, 11, 9, 1.6, 3, 0.3], [2, 24, 10, 1.4, 2.6, 0.2], [20, -14, 10, 1.5, 3, 0.3], [-19, 8, 11, 1.8, 3.4, 0.3]]) driftMesh(B, M.snow, Hs, { x, z, len: l * 1.7, wid: w * 1.8, h, ax: 0.35 + yw * 0.1, az: 0.94, seed: z + 5 });
    for (const [x, z, yw] of [[19, -2, 0], [17, 24, 0.4], [-12, -25, 1.2]]) B.rock({ p: [x, Hg(x, z) + 0.6, z], r: 1, squash: [7, 1.4, 2.2], amp: 0.35, seed: 44 + ((x + z) | 0) % 5, detail: 2, mat: M.snow, yaw: yw, roll: 0.25, cast: true });
    { const rng = makeRng(8); const pts = []; const addRing = (cx, cy, cz, r, n) => { for (let i = 0; i < n; i++) { const a = rng() * 6.28; pts.push([cx + Math.cos(a) * r, cy + (rng() - 0.5) * 0.4, cz + Math.sin(a) * r]); } };
      addRing(...F.p(0, 0, 0).slice(0, 3), 0.1, 0); const ox = obs.F.p(0, 0, 0); for (let i = 0; i < 26; i++) { const a = -0.9 + rng() * 1.8 + P; const px = ox[0] + Math.sin(a) * 4.9, pz = ox[2] - Math.cos(a) * 4.9; pts.push([px, 5.2 + rng() * 1.2, pz]); }
      for (let i = 0; i < 40; i++) { const yy = rng() * 30; const a = rng() * 6.28, rr = 1.5 - 1.05 * (yy / 30); pts.push([mastX + Math.cos(a) * rr, Hg(mastX, mastZ) + yy, mastZ + Math.sin(a) * rr]); }
      for (let i = 0; i < 30; i++) pts.push([F.p(-9.3, 0, [1, -3.5, -8][i % 3])[0] + rng() * 0.3, 5.2 + rng() * 0.6, F.p(-9.3, 0, [1, -3.5, -8][i % 3])[2]]);
      rimeFeathers(B, M, pts, wnd, { n: 5, seed: 3 }); }
    { const inSL = (x, z) => { const u = x * F.c - z * F.s, v = x * F.s + z * F.c; return u > SL.u0 - 0.6 && u < SL.u1 + 0.6 && v > SL.v0 - 0.6 && v < SL.v1 + 0.6; }; const Hf = (x, z) => (inSL(x, z) ? 0.0 : Hs(x, z)) + 0.02, opt = { lift: 0.035, step: 0.8 };
      const od = obs.F.p(0, 0, -6.2); trail(B, 'foot', [[od[0], od[2]], [F.p(6, 0, 5)[0], F.p(6, 0, 5)[2]], [F.p(0, 0, -1)[0], F.p(0, 0, -1)[2]], [F.p(-6, 0, -3)[0], F.p(-6, 0, -3)[2]]], Hf, { ...opt, jitter: 0.06 });
      trail(B, 'foot', [[od[0] - 1, od[2] + 0.4], [4, 20], [-1.5, 19.4]], Hf, { ...opt, jitter: 0.06 }); trail(B, 'foot', [[annexF.p(-2.2, 0, -3.6)[0], annexF.p(-2.2, 0, -3.6)[2]], [-8, 8], [od[0] - 3, od[2] - 0.5]], Hf, { ...opt, jitter: 0.05 }); }
    // ------------------------------------------------------------ storm guide-ropes, summit cross, weather station, terrace rail, buried snowcat
    { const p = (u, v) => { const q = F.p(u, 0, v); return [q[0], q[2]]; };
      guideRope(B, M, Hg, [p(9.0, 12.0), [OBS.x - 1.4, OBS.z - 6.5], [OBS.x - 1.4, OBS.z - 12.2]], { seed: 1, halos });
      guideRope(B, M, Hg, [p(-8.5, 0.6), p(-9.3, -6.5), [-14.5, -13.5], [-17.5, -19]], { seed: 2, halos });
      guideRope(B, M, Hg, [[-9.5, 14.5], [-8.2, 19.5], [mastX + 3.3, mastZ + 1.2]], { seed: 3, halos }); }
    const cross = summitCross(B, M, halos, -18.6, Hg(-18.6, 7.4), 7.4, 0.3); const wx = weatherStation(B, M, Hg, 17.5, -8.2, 0.6);
    terraceRail(B, M, obs.F); buriedCat(ctx, B, M, halos, Hg, 16, -16.5, 2.2);
    // warm accents against the cold: amber doorway light + lantern glow at the observatory and the annex, a lit lamp at the lift-hut service door
    { const od = obs.door, ad = annexF.p(-2.2, 2.4, -3.9), hd2 = F.p(9.6, 2.3, 11.6);
      ctx.light({ pos: [od[0], 2.6, od[2] - 1.4], color: 0xffa850, intensity: 12, distance: 11, decay: 2, flicker: 0.08, flickerSpeed: 5 }); halos.add([od[0], 2.7, od[2] - 0.9], 0xffb060, 0.8, 0.7, 4);
      ctx.light({ pos: ad, color: 0xffa040, intensity: 10, distance: 10, decay: 2, flicker: 0.1, flickerSpeed: 6 }); halos.add([ad[0], ad[1] + 0.1, ad[2]], 0xffb060, 0.7, 0.65, 5);
      ctx.light({ pos: hd2, color: 0xffb060, intensity: 8, distance: 9, decay: 2, flicker: 0.05, flickerSpeed: 4 }); halos.add(hd2, 0xffc078, 0.7, 0.6, 3); }
    { const Ms = { ...M, timberV: M.timber, beam: M.timber, steelRed: M.redPaint, zinc: M.steelPaint, paintRed: M.redPaint, paintBlue: M.steel, plaster: M.iceSolid, orange: M.orange }; const od2 = obs.door; const OF = new Frame(B, od2[0], od2[2], obs.F.yaw, 0);
      scatter(B, Ms, F, [['crate', -8.6, -2.5], ['crate', -8.6, -3.0, 0.3, 0.4], ['jerrycan', -8.3, -3.7], ['bin', -8.6, -6.5], ['extinguisher', -9.1, -1.5], ['ropeCoil', -8.4, -8.2], ['skiBag', -7.4, 0.9, 0.2], ['sack', 1.6, -8.6], ['sack', 2.1, -8.9], ['tyre', 2.3, -2.6], ['cone', -1.9, -8.4], ['cone', -1.9, -4.7], ['bucket', -8.2, -9.2], ['boots', -5.6, -0.6], ['shovel', -9.15, -5.0]], 6);
      scatter(B, Ms, OF, [['crate', 2.6, -0.8], ['jerrycan', 3.0, -1.0], ['ropeCoil', -2.5, -1.4], ['shovel', -3.4, -0.5, 0.0], ['bucket', 3.6, -1.6], ['sack', -4.0, -1.0], ['sack', -4.4, -1.3], ['boots', 1.5, -0.7]], 7); }
    T0('rim');
    // ------------------------------------------------------------ lights: observatory red lamp, station lamp, mast beacon, moon shafts through the slit
    const redL = ctx.light({ pos: [obs.F.p(0, 0, 0)[0], obs.top - 1.2, obs.F.p(0, 0, 0)[2]], color: 0xff3a22, intensity: 9, distance: 12, decay: 2, flicker: 0.1, flickerSpeed: 3 });
    ctx.light({ pos: [F.p(4, 5.5, 8)[0], 5.5, F.p(4, 5.5, 8)[2]], color: 0x9db4ff, intensity: 12, distance: 14, decay: 2, flicker: 0.12, flickerSpeed: 5 });
    ctx.light({ pos: [F.p(-4.6, 5, -3)[0], 5, F.p(-4.6, 5, -3)[2]], color: 0xc8d8ff, intensity: 10, distance: 12, decay: 2, flicker: 0.3, flickerSpeed: 7 });
    const mastL = ctx.light({ pos: [mast.top[0], mast.top[1] - 0.2, mast.top[2]], color: 0xff2a18, intensity: 40, distance: 24, decay: 2 });
    // ------------------------------------------------------------ atmosphere: violet moonlight through a lightning-lit whiteout
    const moon = new THREE.Vector3(-0.4, 0.34, -0.85).normalize();
    unifyPrograms(B);
    const atmo = {
      name: 'Whiteout · Summit Observatory (violent storm)',
      fog: { color: 0x161a30, scatter: 0x5460a0, density: 0.034, falloff: 0.0045, base: 0, power: 3 },
      sky: { zenith: 0x060812, horizon: 0x1f2648, ground: 0x080a18, gradPow: 0.55, sunColor: 0xb0bcff, sunSize: 0.035, sunGlow: 0.5, disc: 2, stars: 0.5, cloud: 0.82, cloudColor: 0x131830, cloudLit: 0x4c5896, cloudSpeed: 0.03, cloudScale: 1.5, cloudDark: 0.6, aurora: 0.7, auroraA: 0x3fe0a0, auroraB: 0x8a5cff, horizonFog: 0.8 },
      sun: { dir: moon.toArray(), color: 0xaab8ff, intensity: 0.7, shadow: true }, env: { intensity: 0.4 },
      exposure: 0.9, bloom: 0.6, vignette: 0.48, grain: 0.05, chroma: 0.0024, ao: 0.75,
      grade: { sat: 0.86, contrast: 1.16, lift: [0.01, 0.01, 0.035], gain: [0.98, 0.985, 1.04], tint: [1, 1, 1.02] }, autoExposure: { key: 0.085, min: 0.7, max: 1.3 },
      wind: [8, 0, 21], snow: 0.4, wet: 0, frost: 0.9, reverb: 'snow', lightning: 0.0,
    };
    const wxA = ctx.weather({ count: 10000, box: [24, 14, 24], fall: 2.0, wind: [7.6, 0, 20.5], size: 0.03, turb: 1.4, color: [0.84, 0.88, 1], alpha: 0.9, cell: 3, seed: 31 });
    const wxM = ctx.weather({ count: 8000, box: [50, 26, 50], fall: 2.0, wind: [7.6, 0, 20.5], size: 0.034, turb: 1.4, color: [0.8, 0.85, 1], alpha: 0.7, cell: 3, seed: 32 });
    const wxB = ctx.weather({ count: 800, box: [13, 8, 13], fall: 1.6, wind: [8, 0, 22], size: 0.034, turb: 1.6, color: [0.9, 0.93, 1], alpha: 0.5, cell: 3, seed: 33 });
    const wxC = ctx.weather({ count: 7000, box: [36, 20, 36], fall: 3.0, wind: [11, 0, 30], size: 0.02, streak: 13, turb: 0.6, color: [0.8, 0.86, 1], alpha: 0.4, cell: 13, seed: 35 });
    const veil = new WindVeil(ctx.gfx, { wind: [8, 21], alpha: 0.8, color: [0.66, 0.72, 0.95], coverage: 0.18, heights: [0.35, 0.7, 1.15, 1.7, 2.4, 3.3, 4.6] }); ctx.group.add(veil.mesh);
    const mod = new AtmoMod(gfx); let stopRt = null; let gustA = 0, gustB = 0, smokeT = 0;
    const strike = { next: 5 + Math.random() * 6, t: 99, dur: 0, pat: [], bolt: null, boltT: 0 };
    const boltMat = glowMaterial({ color: 0xdfe6ff, fog: false, opacity: 1 }); const boltGroup = new THREE.Group(); boltGroup.visible = false; gfx.scene.add(boltGroup);
    { const primer = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -900, 0), new THREE.Vector3(0, -900.01, 0.01), new THREE.Vector3(0, -900.02, 0)]), 2, 0.001, 5, false), boltMat); primer.frustumCulled = false; primer.name = 'bolt-primer'; ctx.group.add(primer); }   // a real (tiny, far below the mountain) tube with the bolts' vertex layout: world.warm() compiles the bolt program at load, not at the first strike
    const lightning = { onStrike: null };
    const makeBolt = (cam) => {
      boltGroup.clear(); const az = rand() * 6.283, dist = 260 + rand() * 220; const bx = cam.x + Math.cos(az) * dist, bz = cam.z + Math.sin(az) * dist; const top = cam.y + 200 + rand() * 60, bot = cam.y - 40 - rand() * 60;
      const path = (x0, y0, z0, y1, n, jag) => { const pts = []; let x = x0, z = z0; for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3(x, y0 + (y1 - y0) * t, z)); x += (rand() - 0.5) * jag; z += (rand() - 0.5) * jag; } return pts; };
      const main = path(bx, top, bz, bot, 18, 30); const mk = (pts, r) => { const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), pts.length * 3, r, 5, false); return new THREE.Mesh(geo, boltMat); };
      boltGroup.add(mk(main, 1.6)); for (let b = 0; b < 3; b++) { const i = 3 + ((rand() * 10) | 0); const s = main[i]; boltGroup.add(mk(path(s.x, s.y, s.z, s.y - 60 - rand() * 90, 8, 26).map((p, k) => { p.x += (k * 8) * (rand() - 0.5); return p; }), 0.8)); }
    };
    return {
      atmo, envPatches: [{ dir: moon.toArray(), color: 0xb0bcff, size: 2.4, intensity: 4 }, { dir: [0, 0.7, 0.2], color: 0x6a90ff, size: 6, intensity: 0.45 }], lightning,
      playerStart: { pos: [-10.9, 0, 0.8], yaw: -2.08 }, station: { pos: [0, 0, 0], yaw: st.yaw }, heightFn: Hg, groundSurface: 'snow', surfaceAt: (x, z) => { const u = x * F.c - z * F.s, v = x * F.s + z * F.c; return (u > SL.u0 && u < SL.u1 && v > SL.v0 && v < SL.v1) ? 'concrete' : (Hg(x, z) > 0.5 && Math.hypot(x - OBS.x, z - OBS.z) < 9 ? 'rock' : 'ice'); },
      navBounds: [-21, -24, 21, 24], landmark: { pos: [OBS.x, 9, OBS.z], name: 'Observatory' },
      spawns: [
        { kind: 'barricade', pos: obs.F.p(0, 0, -3.65), yaw: obs.F.yaw, boards: 5, note: 'observatory door' },
        { kind: 'barricade', pos: annexF.p(-2.2, 0, -1.65), yaw: annexF.yaw, boards: 5, note: 'annex door' },
        { kind: 'barricade', pos: F.p(9.0, 0, 11.6), yaw: Math.atan2(-F.c, F.s), boards: 5, note: 'station service door' },
        { kind: 'walk', pos: [-21, 0, 0], yaw: -P / 2 }, { kind: 'walk', pos: [-8, 0, -24], yaw: P }, { kind: 'walk', pos: [20, 0, -12], yaw: P / 2 }, { kind: 'walk', pos: [-14, 0, 24], yaw: 0 }, { kind: 'walk', pos: [21, 0, 22], yaw: P / 4 },
        { kind: 'rise', pos: [-6, 0, 5], yaw: 0 }, { kind: 'rise', pos: [-16, 0, -6], yaw: -P / 2 }, { kind: 'rise', pos: [2, 0, 22], yaw: 0 }, { kind: 'rise', pos: [14, 0, -16], yaw: P },
      ],
      buys: { walls: [{ pos: obs.F.p(4.27, 1.6, -2.45), yaw: obs.F.yaw - 1.047, gun: 'm14' }, { pos: annexF.p(4.34, 1.5, 0), yaw: -P / 2, gun: 'olympia' }], perks: [{ pos: F.p(4.5, 0, 0.9), yaw: st.yaw, perk: 'doubleTap' }], box: { pos: [-8, 0, 16], yaw: 0.5 } },
      zombieVariants: [{ id: 'frozen', weight: 5 }, { id: 'guide', weight: 3 }, { id: 'patrol', weight: 2 }, { id: 'instructor', weight: 2, minRound: 2 }, { id: 'snowboarder', weight: 1, minRound: 3 }, { id: 'tourist', weight: 1 }],
      ambient: { space: 'snow', gain: 1, beds: [{ type: 'wind', gain: 1.0, gust: 1.0, freq: 620 }, { type: 'drone', gain: 0.1, freq: 46 }, { type: 'noise', gain: 0.08, freq: 4200 }],
        events: [{ type: 'thunder', every: [9, 22], gain: 0.9, pos: 'far' }, { type: 'ice-crack', every: [10, 24], gain: 0.7, pos: 'around' }, { type: 'gust', every: [5, 12], gain: 0.9, pos: 'around' }, { type: 'whistle', every: [8, 18], gain: 0.6, pos: [mastX, 25, mastZ] }, { type: 'creak', every: [6, 14], gain: 0.7, pos: 'around' }, { type: 'clank', every: [14, 30], gain: 0.6, pos: [mastX, 20, mastZ] }, { type: 'wolf', every: [45, 90], gain: 0.5, pos: 'far' }, { type: 'rockfall', every: [50, 100], gain: 0.5, pos: 'far' }] },
      onReady(rt) { stopRt = rt; },
      update(dt, t, active) {
        const k = stopRt ? stopRt.intensity : (active ? 1 : 0); const veh = ctx.world.vehicle; const rs = veh ? (veh.ropeSpeed ?? 0.5) : 0.5; wheel.rotation.y -= rs / L.RAIL_R * dt; if (obs.dome) obs.dome.rotation.y += 0.02 * dt;
        // gust fronts: near-total whiteout for a few seconds, then a lull
        gustA = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.091 + 2.0); gustB = Math.max(0, Math.sin(t * 0.37 + Math.sin(t * 0.11) * 2) * 1.2 - 0.25); const g = clamp(gustA * 0.5 + gustB * 0.9, 0, 1);
        wxC.w.cfg.alpha = 0.25 + 0.7 * g; wxA.w.cfg.alpha = 0.95 - 0.25 * g; wxM.w.cfg.alpha = 0.7 + 0.2 * g; wxB.w.cfg.alpha = 0.45 + 0.3 * g;
        { const cam = gfx.camera.position, o = ctx.origin; veil.update(dt, cam, o.y + Hg(cam.x - o.x, cam.z - o.z), k * (0.65 + 0.8 * g)); }
        // lightning: sky flash + fog/key-light flash + a bolt in the distance, with a flicker pattern
        strike.next -= dt; if (strike.next < 0 && k > 0.6) { strike.t = 0; strike.dur = 0.65; strike.pat = [[0, 0.9], [0.09, 0.25], [0.16, 1.0], [0.3, 0.35], [0.42, 0.7]]; strike.next = 7 + Math.random() * 15; makeBolt(gfx.camera.position); const d = 900 + Math.random() * 1500; if (lightning.onStrike) lightning.onStrike(d); }
        strike.t += dt; let fl = 0; if (strike.t < strike.dur) for (const [tt, a] of strike.pat) { const x = strike.t - tt; if (x >= 0) fl = Math.max(fl, a * Math.exp(-x * 9)); } boltGroup.visible = fl > 0.05 && k > 0.5; boltMat.opacity = clamp(fl * 1.4, 0, 1);
        mod.apply({ fog: 0.0009 * 0 + g * 0.045 * k, fr: fl * 0.16 * k, fg: fl * 0.18 * k, fb: fl * 0.3 * k, sun: fl * 2.4 * k, env: fl * 0.9 * k, sky: fl * 0.85 * k });
        if (!active) return; smokeT += dt; if (smokeT > 0.1) { smokeT = 0; fx.puff({ x: annex.chimney[0], y: annex.chimney[1], z: annex.chimney[2] }, { x: 0.7, y: 0.6, z: 1.0 }, 1, { speed: 2.5, size: [0.25, 1.5], life: 2.2, color: [0.62, 0.66, 0.78, 0.2], rise: 0.4, drag: 0.6, spread: 0.6, cell: 1 }); }
        wx.rotor.rotation.y += dt * (1.5 + (0.6 + 0.9 * g) * 9); wx.vane.rotation.y = -Math.atan2(21, 8) + 0.5 * Math.sin(t * 0.9) * (0.4 + g) + 3.14159;
        for (const b of mast.beacons) b.material.emissiveIntensity = 1 + 9 * Math.max(0, Math.sin(t * 2.2)); mastL.intensity = 6 + 40 * Math.max(0, Math.sin(t * 2.2));
      },
    };
  },
};
