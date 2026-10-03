// SHAFT NINE — Stop 4: CRYSTAL CAVERN (y = -285). A natural cathedral cavern: huge amethyst / quartz clusters that glow (emissive fresnel material +
// baked/pooled light + halos), a central spire cluster on an island in a glassy black lake (mirrored crystal reflections), stalactites and columns,
// bioluminescent moss, glowing mineral veins, sparkle dust; an old timbered adit breaks in from the west (barricade).
import * as THREE from 'three';
import { Parts } from './parts.js';
import { rockPile } from './parts2.js';
import { std } from '../../core/mats.js';
import { signMaterial } from '../../core/canvas2d.js';
import { makeRng, noise2, lerp, TAU } from '../../core/util.js';
import { Cavity, shape, surfaceNets, addShell, shellColliders } from './sdf.js';
import { installBake, bakeable } from './bake.js';
import { normalizePatch, unifyPrograms, bakeBench, phaser, lampGloss, PI, OPEN, at, cylBetween, lin, makeHalos, lightPool, meshMaterial, steelRawMat, steelRustMat, timberSet, railLine, tub, signQuad, puddleMaterial, waterMaterial, waterRect, Drips, cliffBlocker } from './kit.js';
import { hexCrystalRaw, crystalCluster, crystalMaterial } from './crystals.js';
import { shaftMats, shaftLining } from './shaft.js';
import { buildLanding } from './landing.js';
import { custom, TIMBER, STRATA, SHUTTER, COAL, CINDER, CALCITE } from './glsl.js';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ellD = (x, z, cx, cz, rx, rz) => Math.hypot((x - cx) / rx, (z - cz) / rz);
const LAKE = { cx: 0, cz: 37, rx: 13, rz: 15 }, WY = -3.62, LBOT = -6.0;
function baseH(x, z) {
  let y = -3.0; y = lerp(y, 0.0, 1 - sm(8.0, 15.0, z));
  y += 0.32 * noise2(x * 0.17, z * 0.17) + 0.1 * noise2(x * 0.55, z * 0.55);
  y = lerp(y, 2.7 + 0.25 * noise2(x * 0.3, z * 0.3), 1 - sm(0.72, 1.08, ellD(x, z, 24, 38, 9, 12)));      // east ledge (long ramp)
  y = lerp(y, -3.3, 1 - sm(0.7, 1.05, ellD(x, z, -25, 33, 8.5, 9.5)));                                   // west mossy bowl
  y = lerp(y, -2.6 + 0.2 * noise2(x * 0.5, z * 0.5), 1 - sm(0.8, 1.1, ellD(x, z, 0, 37, 6.4, 6.4)));      // central island
  return y;
}
function floorH(x, z) {
  const y = baseH(x, z); const lk = ellD(x, z, LAKE.cx, LAKE.cz, LAKE.rx, LAKE.rz); const isl = 1 - sm(0.8, 1.1, ellD(x, z, 0, 37, 6.4, 6.4));
  const cw = (1 - sm(1.8, 2.5, Math.abs(x))) * sm(17, 20, z) * (1 - sm(30, 32, z)); const keep = Math.max(isl, cw); const inLake = (1 - sm(0.8, 1.02, lk)) * (1 - keep);
  return lerp(y, LBOT, inLake);
}
const veinFrag = (oy) => `
{ vec3 wn = normalize(vWN); float up = smoothstep(0.3, 0.85, wn.y); float ly = vWPos.y - (${oy.toFixed(2)});
  // mineral seams = warped planes cutting the rock (not contour lines): sparse zones, thickness that swells and pinches, pale calcite with only a faint glow
  vec3 wq = vWPos + 2.4 * (vec3(zfbm3(vWPos * 0.21 + 1.0), zfbm3(vWPos * 0.21 + 7.0), zfbm3(vWPos * 0.21 + 13.0)) - 0.5);
  float zoneA = smoothstep(0.5, 0.62, zfbm3(vWPos * 0.07 + 4.0)), zoneB = smoothstep(0.52, 0.64, zfbm3(vWPos * 0.09 + 17.0));
  float swell = smoothstep(0.38, 0.68, zfbm3(vWPos * 0.55 + 21.0));
  float sa = abs(fract(dot(wq, vec3(0.62, 0.30, 0.72)) * 0.19 + 0.5) - 0.5), sb = abs(fract(dot(wq, vec3(-0.75, 0.22, 0.62)) * 0.27 + 0.5) - 0.5);
  float thA = mix(0.003, 0.02, swell), thB = mix(0.002, 0.012, swell);
  float v1 = (1.0 - smoothstep(thA * 0.35, thA, sa)) * zoneA, v2 = (1.0 - smoothstep(thB * 0.35, thB, sb)) * zoneB; float vein = clamp(v1 + v2 * 0.8, 0.0, 1.0);
  vec3 vc = mix(vec3(0.5, 0.25, 1.0), vec3(0.25, 0.75, 1.0), zvn3(vWPos * 0.25 + 1.0));
  float stn = smoothstep(0.52, 0.74, zfbm3(vWPos * vec3(0.8, 0.22, 0.8) + 5.0)) * (1.0 - up * 0.85); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.115, 0.07) * (0.7 + 0.6 * zvn3(vWPos * 3.0)), stn * 0.6);
  float dr = smoothstep(0.55, 0.78, zfbm3(vWPos * vec3(1.6, 0.12, 1.6) + 9.0)) * (1.0 - up * 0.7); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.4, 0.44), dr * 0.4); roughnessFactor = mix(roughnessFactor, 0.35, dr);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.46, 0.6), vein * 0.5); roughnessFactor = mix(roughnessFactor, 0.3, vein); totalEmissiveRadiance += vc * vein * 0.16;
  float sp = step(0.9992, zvn3(vWPos * 90.0)) * (0.4 + 0.6 * up); diffuseColor.rgb += sp * vec3(0.35, 0.3, 0.5); roughnessFactor = mix(roughnessFactor, 0.05, sp);
  float mo = smoothstep(0.62, 0.82, zfbm3(vWPos * vec3(0.7, 0.5, 0.7) + 11.0)) * smoothstep(0.05, 0.6, up + 0.25 * (1.0 - smoothstep(-2.0, 2.0, ly)));
  float mf = 0.55 + 0.45 * zvn3(vWPos * 7.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.085, 0.06) * (0.6 + 0.8 * mf), mo * 0.85); totalEmissiveRadiance += vec3(0.02, 0.5, 0.36) * mo * mf * mf * 0.3; roughnessFactor = mix(roughnessFactor, 0.6, mo);
  float wet = smoothstep(-1.5, -3.6, ly) * (1.0 - up * 0.3); roughnessFactor = mix(roughnessFactor, 0.1, wet); diffuseColor.rgb *= 1.0 - 0.3 * wet; }`;

export default {
  id: 'crystal', name: 'Crystal Cavern', origin: [0, -285, 0], viewRadius: 150,
  async build(ctx) {
    const { B, fx } = ctx; const oy = ctx.origin.y; const R = makeRng(285); const t0 = performance.now(); const ph = phaser('crystal');
    const bb = installBake(B, { cell: 120, cellY: 80, shift: [60, 20, 10] }); B.inst.cell = 100; bb.maxK = 2.0; bb.gain = 1.5; const halos = makeHalos(B, 320); const E = { B, ctx, halos, bake: bb };
    const gy = (x, z) => Math.max(floorH(x, z), WY - 0.2);
    // ------------------------------------------------------------ materials
    const rock = bakeable(B.m('cRock', custom(CALCITE, [5, 0.5, 0.5, 0.7, 0.4], { colors: [0x16141c, 0x2b2733, 0x403b4c, 0x8f88a8], size: 1024, tile: 4, bump: 140, rough: [0.4, 0.9] }), { triplanar: 1 / 4, vis: true, breakup: 0.35, wet: true, frag: veinFrag(oy) }));
    const amethyst = crystalMaterial({ key: 'amethyst', base: 0x1b0c46, glow: [0.26, 0.06, 0.66], glow2: [0.42, 0.14, 0.92], rim: [0.6, 0.3, 1.3], k: 0.62 });
    const aqua = crystalMaterial({ key: 'aqua', base: 0x07263e, glow: [0.03, 0.34, 0.7], glow2: [0.08, 0.6, 0.6], rim: [0.25, 0.8, 1.2], k: 0.58 });
    const quartz = crystalMaterial({ key: 'quartz', base: 0x2a3050, glow: [0.34, 0.36, 0.7], glow2: [0.5, 0.36, 0.8], rim: [0.8, 0.85, 1.3], k: 0.5, rough: 0.05, ior: 0.8 });
    const mirrorM = std({ color: 0x000000, emissive: 0x5a30d0, emissiveIntensity: 1.1, side: THREE.BackSide, key: 'cMirror' });
    const mossDef = (name, a0, a1, em) => B.m(name, { emissive: true, size: 256, tile: 1.2, glsl: `S p_custom(vec2 uv){ S s = mk(); float n = fbmU(uv, 5., 4), g = vnoise(uv * 60., vec2(60.)), g2 = vnoise(uv * 23., vec2(23.)); float blob = smoothstep(.42, .7, n); float nod = smoothstep(.45, .85, g * .6 + g2 * .5); s.a = mix(vec3(${a0}), vec3(${a1}), nod); s.h = n * .5 + nod * .5; s.r = .85; s.e = vec3(${em}) * blob * (.12 + .88 * nod * nod) * 0.4; return s; }`, bump: 30, rough: [0.7, 0.95] }, { triplanar: 1 / 1.2, emissiveIntensity: 1.0 });
    const moss = mossDef('cMoss', '.015, .04, .03', '.05, .15, .10', '.02, .8, .6'), mossV = mossDef('cMossV', '.03, .015, .05', '.12, .05, .18', '.55, .12, .95'), mossA = mossDef('cMossA', '.05, .03, .01', '.16, .09, .02', '.95, .45, .06');
    const pickMoss = () => { const r = R(); return r < 0.5 ? moss : r < 0.78 ? mossV : mossA; };
    const floorM = bakeable(B.m('cFloor', custom(CINDER, [26, 0.2, 0.0, 0.0, 0.0], { colors: [0x18161d, 0x2a2731, 0x0e0d12, 0x4d465f], size: 512, tile: 3, bump: 20, rough: [0.6, 1] }), { vis: true, breakup: 0.4, wet: true, frag: veinFrag(oy) }));
    const steel = steelRustMat(B, [0x3d4048, 0x2c2f36, 0x14161b]); const steelRaw = steelRawMat(B);
    const timber = B.m('cTimber', { pattern: 'wood', size: 256, tile: 1.5, colors: [0x4d3f33, 0x241c15], params: { scale: 14, rings: 9, knots: 0.5, weather: 0.8, vertical: 0 }, bump: 5, rough: [0.7, 0.95], layers: { grime: 0.6, dust: 0.3 } }, { wet: true });
    const planks = B.m('cPlanks', { pattern: 'planks', size: 256, tile: 2, colors: [0x554636, 0x2c2218, 0x0d0a07], params: { rows: 7, gap: 0.006, grain: 7, knots: 0.4, cols: 1, weather: 0.9, nails: 1 }, bump: 4, rough: [0.72, 0.96], layers: { grime: 0.5, dust: 0.3 } }, { wet: true });
    const iron = B.m('cIron', { pattern: 'plates', size: 256, tile: 1.5, colors: [0x2d2c2f, 0x201f22, 0x0b0b0c], params: { cols: 1, rows: 1, seam: 0.01, rivets: 10, brushed: 0.3 }, bump: 3, metal: 1, rough: [0.4, 0.8], layers: { rust: 0.14, grime: 0.6, scratch: 0.5, edge: 0.4 }, rustColor: 0x4e2812 });
    const cord = B.m('cCord', std({ color: 0x060606, roughness: 0.7, key: 'cCord' })); const puddle = B.m('cPuddle', puddleMaterial(0x07061a));

    // ------------------------------------------------------------ cavity
    const inShaft = (x, z) => Math.abs(x) < 2.6 && z < 1.85; const domeTop = (x, z) => 3 + 14 * Math.sqrt(Math.max(0, 1 - (x / 31) ** 2 - ((z - 36) / 27) ** 2));
    const cav = new Cavity({ noise: [{ f: [0.12, 0.16, 0.12], a: 0.95, seed: 1 }, { f: [0.4, 0.5, 0.4], a: 0.4, seed: 2 }, { f: [1.1, 1.4, 1.1], a: 0.15, seed: 3 }], fade: 3.5, noiseMul: (x, y, z) => (z < 8 ? 0.55 : 1) });
    cav.air(shape.box(0, -0.5, 0, 2.35, 7.5, 1.75, 0.05)); cav.air(shape.box(0, 2.6, 6.2, 9.5, 3.8, 5.0, 1.3)); cav.air(shape.ell(0, 3, 36, 31, 14, 27)); cav.air(shape.ell(0, -10, 37, 13.6, 20, 15.8));
    cav.air(shape.ell(26, 6, 38, 12, 8, 13)); cav.air(shape.ell(-27, 0, 33, 10, 7, 11)); cav.air(shape.box(-43, -1.3, 33, 9, 1.7, 2.0, 0.3)); cav.air(shape.box(21, 0.3, 60, 2.6, 3.4, 10, 0.4));
    for (const [x, z, r] of [[-9, 22, 1.5], [10, 26, 1.3], [-11, 47, 1.6], [12.5, 50, 1.4], [8, 14.5, 1.1], [-7, 14, 1.2], [-3, 55, 1.5]]) cav.solid(shape.cylY(x, z, r, gy(x, z) - 1, domeTop(x, z) + 1), 1.4);       // columns
    const rs = makeRng(77); for (let i = 0; i < 90; i++) { const x = (rs() - 0.5) * 58, z = 12 + rs() * 50; const ct = domeTop(x, z); if (ct < 6 || ellD(x, z, 0, 37, 5, 5) < 1) continue; const len = 1.5 + rs() * 6.5, r = 0.5 + rs() * 1.0; cav.solid(shape.coneY(x, z, ct - len, ct + 0.6, 0.06, r), 0.9); }
    for (let i = 0; i < 40; i++) { const x = (rs() - 0.5) * 58, z = 10 + rs() * 52; const f = gy(x, z); if (f < -3.7 || ellD(x, z, LAKE.cx, LAKE.cz, LAKE.rx + 1, LAKE.rz + 1) < 1 || (Math.abs(x) < 3 && z < 34) || z < 11) continue; const h = 0.8 + rs() * 3.0, r = 0.35 + rs() * 0.75; cav.solid(shape.coneY(x, z, f - 0.6, f + h, r, 0.05), 0.7); }
    cav.floor2D((x, z) => (inShaft(x, z) ? -1e9 : floorH(x, z)));
    ph('materials+cavity ops'); bakeBench('crystal', () => cav.bake([-56, -9, -5], [46, 21, 72], 0.6)); const grid = cav.bake([-56, -9, -5], [46, 21, 72], 0.6); bb.air = grid.sample; ph('sdf bake'); const mesh = surfaceNets(grid); ph('surface nets');
    addShell(B, mesh, { rock, floorM }, (nx, ny) => (ny > 0.62 ? 'floorM' : 'rock'), { cast: false });
    ph('addShell'); B.colliders.heightFn = floorH; B.colliders.groundY = -1e9;
    shellColliders(B, grid, { x0: -56, x1: 46, z0: -5, z1: 72, cell: 0.6, floor: floorH, thr: 0.2, skin: 2, exclude: (x, z) => floorH(x, z) < WY - 0.6 });
    ph('shell colliders');
    // invisible lake-edge barrier ring (leaves the causeway open) so the deep basin cannot be entered
    for (let k = 0; k < 72; k++) { const a = k * TAU / 72, a2 = (k + 1) * TAU / 72; const x1 = LAKE.cx + Math.cos(a) * LAKE.rx * 0.94, z1 = LAKE.cz + Math.sin(a) * LAKE.rz * 0.94, x2 = LAKE.cx + Math.cos(a2) * LAKE.rx * 0.94, z2 = LAKE.cz + Math.sin(a2) * LAKE.rz * 0.94; const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2; if (Math.abs(mx) < 3.0 && mz < 31) continue; const L = Math.hypot(x2 - x1, z2 - z1); B.colliders.addBox({ x: mx, y: -2, z: mz, hx: L / 2 + 0.05, hy: 3, hz: 0.25, yaw: Math.atan2(-(z2 - z1), x2 - x1), surface: 'rock', walk: false, shootable: false }); }

    // ------------------------------------------------------------ shaft stub (rock-bolted) + landing
    const sm2 = shaftMats(B, 'rock'); shaftLining(B, sm2, { y0: -8, y1: 7, style: 'rock', front: [{ y0: 0, y1: OPEN.h }], collide: true, seed: 4 });
    const landing = buildLanding(ctx, B, { frame: steel, steel: steelRaw, mesh: meshMaterial({ kind: 'diamond', cell: 0.06, wire: 3.4, tile: 0.48 }), plate: steel }, { style: 'steel' });
    B.box({ p: [0, -0.02, 6.4], s: [3.6, 0.02, 8.0], mat: steel, bevel: 0.005, cast: false, col: false });

    // ------------------------------------------------------------ crystals: central spire (island), shore clusters, ledge, grotto, geodes on walls, ceiling
    const mats = { violet: [amethyst, amethyst, amethyst, amethyst, amethyst, quartz, aqua], cyan: [aqua, aqua, aqua, quartz, amethyst], white: [quartz, quartz, aqua, amethyst] };
    const mirror = (raw, M, i) => { const m = new THREE.Matrix4().makeScale(1, -1, 1); const t = new THREE.Matrix4().makeTranslation(0, 2 * WY, 0); B.addRaw(raw, t.multiply(m).multiply(M), mirrorM, { cast: false, recv: false, bake: false }); };
    const PTc = new Parts(B, R);
    const lights = []; const cluster = (p, o, lightK = 1, col = 0x9a60ff, mirrorIt = false) => {
      const cs = crystalCluster(B, o.mats || mats.violet, { p, dir: o.dir || [0, 1, 0], n: o.n || 10, h: o.h || 4, spread: o.spread ?? 0.6, seed: o.seed || 1, colRadius: o.col ?? 0, mirror: mirrorIt ? mirror : null });
      const c = lin(col); const H = o.h || 4; if (H > 2.4) for (let k = 0; k < 6 + Math.round(H * 2); k++) { const a = R() * TAU, d = 0.25 + R() * (0.9 + H * 0.12); PTc.of(rock, false).rock(p[0] + Math.cos(a) * d * (o.dir ? 0.6 : 1), p[1] + (o.dir && o.dir[1] < 0.5 ? (R() - 0.5) * 1.2 : 0.0) + 0.05, p[2] + Math.sin(a) * d * (o.dir ? 0.6 : 1), 0.18 + R() * R() * 0.5, R, { cuts: 5, jit: 0.25 }); } const mid = [p[0] + (o.dir?.[0] || 0) * H * 0.4, p[1] + (o.dir ? o.dir[1] : 1) * H * 0.45, p[2] + (o.dir?.[2] || 0) * H * 0.4];
      bb.light({ p: mid, c, I: H * 4.2 * lightK, R: 10 + H * 1.6, s: 1.0 + H * 0.1, shadow: false }); halos.add(mid, col, 0.8 + H * 0.25, 0.25 + lightK * 0.08, 0); lights.push({ mid, col, H });
      
      return cs;
    };
    // central spire on the island (landmark): giant amethyst with aqua + quartz satellites
    const IX = 0, IZ = 37, IY = gy(IX, IZ);
    cluster([IX, IY, IZ], { n: 34, h: 18, spread: 0.5, seed: 11, col: 2.6, mats: mats.violet }, 1.5, 0x9a5cff, true);
    for (let k = 0; k < 7; k++) { const a = k * TAU / 7 + 0.3, r = 3.4 + R() * 0.8; const p = [IX + Math.cos(a) * r, gy(IX + Math.cos(a) * r, IZ + Math.sin(a) * r), IZ + Math.sin(a) * r]; cluster(p, { n: 9, h: 5.5 + R() * 3.5, spread: 0.7, dir: [Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5], seed: 20 + k, col: 1.0, mats: k % 2 ? mats.cyan : mats.violet }, 1, k % 2 ? 0x40c8ff : 0xa070ff, true); }
    // shore + ledge + walls
    const spots = [[-9, 26, 3.6, 0x40c8ff], [9.5, 25, 3.2, 0xa070ff], [-13.5, 40, 4.4, 0x9a5cff], [13.8, 43, 3.8, 0x40c8ff], [-8, 52, 5.0, 0xa070ff], [8, 53, 4.4, 0x9a5cff], [0, 58, 6.5, 0x70b0ff], [-16, 24, 2.8, 0xa070ff], [17, 27, 2.6, 0x40c8ff], [23, 34, 4.2, 0x9a5cff], [27, 42, 3.4, 0x40c8ff], [21, 46, 2.6, 0xa070ff], [-22, 40, 3.2, 0x40c8ff], [-28, 28, 3.6, 0xa070ff], [-6, 12, 2.2, 0x40c8ff], [7, 11, 2.0, 0xa070ff]];
    spots.forEach(([x, z, h, c], i) => { const y = gy(x, z); cluster([x, y, z], { n: 8, h, spread: 0.6, seed: 40 + i, col: 0.5, mats: c === 0x40c8ff ? mats.cyan : mats.violet }, 0.8, c, ellD(x, z, 0, 37, 16, 18) < 1.05); });
    // wall geodes (horizontal growth) + ceiling crystals
    for (const [x, y, z, dx, dz, h, c] of [[-24, 3.5, 44, 0.9, -0.2, 3.5, 0xa070ff], [27, 6.5, 30, -0.9, 0.2, 3.0, 0x40c8ff], [-30, 1.5, 24, 0.9, 0.3, 2.6, 0x9a5cff], [0, 3, 65, 0, -1, 3.8, 0x40c8ff], [-20, 6, 58, 0.5, -0.7, 3.4, 0xa070ff], [18, 8, 58, -0.5, -0.7, 3.0, 0x9a5cff]]) cluster([x, y, z], { n: 8, h, spread: 0.7, dir: [dx, 0.2, dz], seed: Math.abs(x * 7 + z), col: 0, mats: mats.violet }, 0.9, c);
    for (const [x, z, h] of [[-9, 34, 3.5], [10, 38, 3.0], [-5, 47, 2.8], [6, 27, 2.4], [-14, 32, 2.6]]) { const ct = domeTop(x, z) - 1.0; cluster([x, ct, z], { n: 7, h, spread: 0.5, dir: [0, -1, 0], seed: Math.abs(x * 3 + z * 5), col: 0, mats: mats.cyan }, 0.8, 0x50d0ff); }

    for (let k = 0; k < 14; k++) { const a = k * TAU / 14 + 0.2, x = Math.cos(a) * 25, z = 36 + Math.sin(a) * 21, viol = k % 2 === 0; bb.light({ p: [x, 3 + (k % 3) * 2, z], c: viol ? [0.3, 0.1, 0.85] : [0.08, 0.45, 0.85], I: 70, R: 22, s: 2.2 }); }   // wall wash: the crystals' glow on the cavern walls
    // faceted talus and scree: piles along the cavern walls, a pebble beach round the lake, rubble at the causeway ends (real rock chunks with planar cuts, not smooth blobs)
    { const PT = new Parts(B, R); const air = bb.air;
      for (let k = 0; k < 30; k++) { const a = k / 30 * TAU + R() * 0.2, x = Math.cos(a) * (24 + R() * 5), z = 36 + Math.sin(a) * (22 + R() * 4), f = gy(x, z); if (f < -3.5 || air(x, f + 0.8, z) < 0.6) continue; rockPile(PT, rock, { c: [x, f, z], r: 1.4 + R() * 1.4, n: 26 + ((R() * 20) | 0), hgt: 0.5 + R() * 0.5, ground: gy, size: 0.4 }); }
      for (let k = 0; k < 220; k++) { const a = R() * TAU, rr = 1.02 + R() * 0.18, x = LAKE.cx + Math.cos(a) * LAKE.rx * rr, z = LAKE.cz + Math.sin(a) * LAKE.rz * rr, f = gy(x, z); if (f < -3.75 || (Math.abs(x) < 3 && z < 32)) continue; PT.of(rock, false).rock(x, f, z, 0.05 + Math.pow(R(), 2.4) * 0.28, R, { cuts: 5, jit: 0.22 }); }
      for (const [x, z] of [[-3, 16.5], [3, 16.5], [-2.2, 31.5], [2.4, 31.5]]) rockPile(PT, rock, { c: [x, gy(x, z), z], r: 1.2, n: 24, hgt: 0.4, ground: gy, size: 0.35 });
      console.log('[crystal] real parts triangles', PT.tris + PTc.tris); PT.flush(); PTc.flush(); }
    // ------------------------------------------------------------ moss cushions (bioluminescent) + rocks + shore pebbles
    for (let i = 0; i < 80; i++) { const x = (R() - 0.5) * 56, z = 12 + R() * 50; const f = gy(x, z); if (f < -3.9 || ellD(x, z, LAKE.cx, LAKE.cz, LAKE.rx, LAKE.rz) < 1.0 || (Math.abs(x) < 4 && z < 12)) continue; const r = 0.3 + R() * 0.7; B.rock({ p: [x, f + r * 0.2, z], r, squash: [1.3, 0.45, 1.1], amp: 0.5, seed: i + 5, detail: 2, mat: R() < 0.55 ? pickMoss() : rock, cast: false }); }
    for (const [x, z] of [[-26, 30], [-24, 36], [-28, 34], [-22, 28], [-25, 38], [-19, 33]]) { const f = gy(x, z); for (let k = 0; k < 4; k++) B.rock({ p: [x + (R() - 0.5) * 3, f + 0.1, z + (R() - 0.5) * 3], r: 0.5 + R() * 0.6, squash: [1.5, 0.4, 1.2], amp: 0.5, seed: 200 + k, detail: 2, mat: pickMoss(), cast: false }); halos.add([x, f + 0.5, z], 0x20e0b8, 1.2, 0.12, 0); bb.light({ p: [x, f + 0.6, z], c: [0.03, 0.6, 0.45], I: 5, R: 8, s: 0.8 }); }

    // ------------------------------------------------------------ old timbered adit with barricade (west wall) + rails + tub
    const AX = -35.1, AY = -3.0, AZ = 33;
    for (const s of [-1, 1]) { B.beam([AX + 0.4, AY, AZ + s * 2.0], [AX + 0.4, AY + 3.1, AZ + s * 1.95], 0.32, 0.32, { mat: timber, bevel: 0.02 }); B.colliders.addBox({ x: AX + 0.4, y: AY + 1.5, z: AZ + s * 2.0, hx: 0.2, hy: 1.6, hz: 0.2, surface: 'wood', walk: false }); }
    B.box({ p: [AX + 0.4, AY + 3.05, AZ], s: [0.36, 0.34, 4.6], mat: timber, bevel: 0.02 });
    for (const [z0, z1] of [[AZ - 1.85, AZ - 0.75], [AZ + 0.75, AZ + 1.85]]) { B.box({ p: [AX, AY, (z0 + z1) / 2], s: [0.16, 3.05, z1 - z0], mat: planks, bevel: 0.01, col: 'wood' }); for (let k = 0; k < 4; k++) B.box({ p: [AX + 0.11, AY + 0.5 + k * 0.72, (z0 + z1) / 2], s: [0.05, 0.1, z1 - z0 + 0.1], mat: timber, roll: (R() - 0.5) * 0.06, cast: false }); }
    B.box({ p: [AX, AY + 1.95, AZ], s: [0.16, 1.05, 1.5], mat: planks, bevel: 0.01, col: false }); B.box({ p: [AX, AY + 2.9, AZ], s: [0.16, 0.2, 4.1], mat: planks, bevel: 0.01, col: false });
    const railM = { sleeper: timber, rail: B.m('cRail', std({ color: 0x4a2f22, metalness: 1, roughness: 0.42, key: 'cRail' })), ballast: null }; railLine(B, railM, [AX + 1.2, AY, AZ], [AX + 9, AY + 0.4, AZ], { gauge: 0.61, y: 0, ballast: false, seed: 4 });
    for (const [x, z] of [[-33.6, 31.6], [-33.4, 34.4]]) { const f = gy(x, z); B.box({ p: [x, f, z], s: [0.6, 0.06, 0.6], mat: timber, cast: false }); }
    signQuad(B, signMaterial({ lines: ['OLD LEVEL 285', 'DANGER — UNSAFE GROUND'], bg: '#c9a227', fg: '#161616', w: 512, h: 160, weather: 0.9 }), [AX + 0.62, AY + 2.4, AZ + 2.1], 1.2, 0.38, PI / 2 * 3 + 0, {});

    // ------------------------------------------------------------ backing plates for wall buys, a rusted machine relic, lanterns
    for (const [x, z, yaw] of [[-8.55, 5.5, PI / 2], [8.55, 5.5, -PI / 2]]) { B.box({ p: [x, 0.5, z], s: [0.1, 2.0, 2.0], yaw: 0, mat: steel, bevel: 0.02, cast: false }); }
    const lanternMat = B.m('cLantern', std({ color: 0x000000, emissive: 0xffb060, emissiveIntensity: 8, key: 'cLantern' })); for (const [x, y, z] of [[-7.2, 2.4, 4.0], [7.2, 2.4, 4.0]]) { B.cyl({ p: [x, y - 0.15, z], r: 0.07, h: 0.3, seg: 8, mat: lanternMat, cast: false }); halos.add([x, y, z], 0xffb060, 0.9, 0.7, 6); ctx.light({ pos: [x, y - 0.1, z], color: 0xffa860, intensity: 9, distance: 8, decay: 2, flicker: 0.08, flickerSpeed: 7, kind: 'point' }); bb.light({ p: [x, y, z], c: lin(0xffa860), I: 3, R: 10, s: 0.4, shadow: true }); }

    // ------------------------------------------------------------ lake (glassy, transparent by fresnel, mirrored crystals underneath), drips
    const emit = lights.filter((l) => l.H > 4).slice(0, 14).map((l) => ({ p: [l.mid[0], l.mid[1] + oy, l.mid[2]], c: lin(l.col).map((v) => v * 0.9), s: 0.8 + l.H * 0.15 }));
    const wmat = waterMaterial({ color: 0x05041a, emitters: emit, alphaBase: 0.9, ripple: 0.5, scale: 0.6, key: 'cW' }); waterRect(B, wmat, [0, WY, 37], 27.6, 32.4); waterRect(B, wmat, [-25, -4.02, 33], 15, 17);
    const dr = new Drips(fx, [{ p: [-4, 12, 30], y: WY + oy, h: 15, rate: 3.0 }, { p: [5, 11, 43], y: WY + oy, h: 14, rate: 3.6 }, { p: [-9, 10.5, 40], y: WY + oy, h: 14, rate: 4.2 }, { p: [7, 10.4, 33], y: WY + oy, h: 14, rate: 2.6 }, { p: [-24, 6, 30], y: -4.2 + oy, h: 10, rate: 2.0 }].map((q) => ({ ...q, p: [q.p[0], q.p[1] + oy, q.p[2]] })));
    ctx.weather({ type: 'sparkle', count: 420, box: [46, 16, 46], fall: -0.02, size: 0.016, turb: 0.9, color: [0.7, 0.6, 1.8], alpha: 0.9, cell: 4, additive: true, twinkle: 0.95, seed: 31, wind: [0.05, 0.03, 0.05] });
    ctx.weather({ type: 'spores', count: 260, box: [46, 12, 46], fall: -0.05, size: 0.04, turb: 1.4, color: [0.1, 1.6, 1.2], alpha: 0.7, cell: 0, additive: true, twinkle: 0.7, seed: 32, wind: [0.02, 0, 0.02] });
    lampGloss(B, oy, lights.slice().sort((a, b) => b.H - a.H).slice(0, 24).map((l) => ({ p: l.mid, c: lin(l.col).map((v) => v * 3.0), s: 0.5 + l.H * 0.14 })), { k: 1.0 });
    // key light: a fake "crystal glow" directional light with real shadows from props/crystals (shell casts none)
    const atmo = {
      name: 'Shaft Nine · Crystal Cavern', fog: { color: 0x150c34, scatter: 0x3d2488, density: 0.012, falloff: 0.0, base: 0, power: 3 },
      sky: null, sun: { dir: [0.25, 0.72, -0.62], color: 0x7a56ff, intensity: 0.28, shadow: true }, env: { intensity: 0.12 },
      exposure: 1.0, bloom: 0.36, vignette: 0.45, grain: 0.035, chroma: 0.0022, ao: 0.85, wet: 0.2, reverb: 'mineShaft',
      grade: { sat: 1.12, contrast: 1.1, lift: [0.018, 0.0, 0.04], gain: [0.98, 0.97, 1.05], tint: [0.98, 0.96, 1.04] }, autoExposure: { key: 0.12, min: 0.85, max: 1.5 },
    };
    // pooled lights (best 8 win): spire, satellites, shore clusters
    for (const l of lights.slice(0, 26)) ctx.light({ pos: l.mid, color: l.col, intensity: 8 + l.H * 2.4, distance: 12 + l.H * 1.3, decay: 2, kind: 'point', flicker: 0.02, flickerSpeed: 3 });
    ph('crystals+props+lights'); ph.done(); console.log('[crystal] build ms', (performance.now() - t0).toFixed(0));
    const upT = { t: 0 };
    normalizePatch(B, { breakup: 0.4, addBreakup: true, wet: true });
    return {
      onReady(st) { const u = unifyPrograms(st.group); console.log('[crystal] programs after unify', u.programs, 'meshes', u.meshes, '| build+finish ms', (performance.now() - t0).toFixed(0)); },
      atmo, envPatches: [{ dir: [0, 1, 0.3], color: 0x7a50ff, size: 4, intensity: 6 }, { dir: [0.5, 0.2, 1], color: 0x30b0ff, size: 3, intensity: 4 }, { dir: [-0.6, 0.3, 0.8], color: 0xa060ff, size: 3, intensity: 3 }],
      playerStart: { pos: [0, 0, 9.4], yaw: PI }, station: { pos: [0, 0, 0], yaw: 0 }, heightFn: floorH, groundY: -1e9, groundSurface: 'rock', waterY: WY, landing,
      surfaceAt: (x, z) => (floorH(x, z) < WY - 0.05 ? 'water' : (ellD(x, z, 0, 37, 6, 6) < 1 ? 'crystal' : 'rock')),
      navBounds: [-54, -3, 44, 70], navBlocked: cliffBlocker(B.colliders, { extra: (x, z) => floorH(x, z) < WY - 0.3 }), landmark: { pos: [0, 12, 37], name: 'Crystal Spire' },
      spawns: [{ kind: 'barricade', pos: [-35.9, -3.0, 33], yaw: -PI / 2, boards: 5 }, { kind: 'walk', pos: [-49, gy(-49, 33), 33], yaw: -PI / 2 }, { kind: 'walk', pos: [21, gy(21, 67), 67], yaw: 0 }, { kind: 'rise', pos: [-13, gy(-13, 24), 24], yaw: 0 }, { kind: 'rise', pos: [10, gy(10, 22), 22], yaw: 0 }, { kind: 'rise', pos: [-16, gy(-16, 45), 45], yaw: 0 }, { kind: 'rise', pos: [-6, gy(-6, 52), 52], yaw: 0 }],
      buys: { walls: [{ pos: [-8.5, 1.5, 5.5], yaw: PI / 2, gun: 'olympia' }, { pos: [8.5, 1.5, 5.5], yaw: -PI / 2, gun: 'ak74u' }], perks: [{ pos: [6.0, 0, 8.6], yaw: -PI / 2, perk: 'quickrevive' }], box: { pos: [-6.5, gy(-6.5, 20), 20], yaw: PI } },
      zombieVariants: ['miner_crystal', 'miner_lamp', { id: 'miner_gas', weight: 0.6 }, { id: 'miner_foreman', weight: 0.5, minRound: 3 }],
      ambient: { space: 'mineShaft', gain: 1, beds: [{ type: 'drone', freq: 110, gain: 0.16, shimmer: 0.6 }, { type: 'hum', freq: 60, gain: 0.08 }, { type: 'drone', freq: 165, gain: 0.08, shimmer: 1.0 }, { type: 'water', gain: 0.1, kind: 'lap' }], events: [{ type: 'ping', every: [1.4, 5.5], gain: 0.28, pos: 'around', pitch: [0.8, 2.2] }, { type: 'drip', every: [2, 6], gain: 0.4, pos: 'around' }, { type: 'bubble', every: [6, 14], gain: 0.25, pos: 'around' }, { type: 'rockfall', every: [60, 120], gain: 0.3, pos: 'far' }] },
      update(dt, t, active) { dr.update(dt, active); },
    };
  },
};
