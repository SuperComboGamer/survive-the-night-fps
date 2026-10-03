// SHAFT NINE — Stop 5: MAGMA CHAMBER (y = -400). A basalt cavern with a lava lake, a lava river from a lava fall, hexagonal basalt columns, obsidian,
// a truss catwalk bridge over the glowing lake to an island smelter, steel-grating platforms, steam vents, embers, ash and a low hot haze layer.
import * as THREE from 'three';
import { Parts } from './parts.js';
import { basaltField, gratingYaw, grating } from './parts2.js';
import { Geo } from './rawgeo.js';
import { std, G } from '../../core/mats.js';
import { signMaterial } from '../../core/canvas2d.js';
import { makeRng, noise2, lerp, TAU } from '../../core/util.js';
import { Cavity, shape, surfaceNets, addShell, shellColliders } from './sdf.js';
import { installBake, bakeable } from './bake.js';
import { normalizePatch, unifyPrograms, bakeBench, phaser, lampGloss, PI, OPEN, at, cylBetween, lin, makeHalos, lightPool, meshMaterial, steelRawMat, steelRustMat, signQuad, handrail, pipeRun, barrel, gratingMaterial, tub, railLine, stairCheeks, cliffBlocker } from './kit.js';
import { hexCrystalRaw } from './crystals.js';
import { shaftMats, shaftLining } from './shaft.js';
import { buildLanding } from './landing.js';
import { custom, BASALT, STRATA, SHUTTER, COAL, CINDER } from './glsl.js';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const LAVA = -4.4, LK = { x: 13, z: 34, rx: 14, rz: 15.5 };
const ellD = (x, z, cx, cz, rx, rz) => Math.hypot((x - cx) / rx, (z - cz) / rz);
const riverX = (z) => 12.5 + 3.2 * Math.sin((z - 40) * 0.11);            // north river centreline
const westZ = (x) => 33 + 2.6 * Math.sin(x * 0.13 + 1.0);                   // west drain centreline
const FLOOR0 = -2.5, LB = LAVA - 1.2;                                   // cavern floor and lava-bowl bottom
function baseH(x, z) {
  let y = FLOOR0 + 0.3 * noise2(x * 0.16, z * 0.16) + 0.08 * noise2(x * 0.5, z * 0.5);
  y = lerp(y, 3.6 + 0.25 * noise2(x * 0.3, z * 0.3), sm(15, 29, x) * sm(30, 46, z) * (1 - sm(56, 62, z)));   // east ledge, reached by a long ramp
  y = lerp(y, FLOOR0 + 0.05, 1 - sm(0.7, 1.2, ellD(x, z, 13, 34, 6.2, 6.2)));                              // island: level with the catwalk decks
  return y;
}
function floorH(x, z) {
  const y = baseH(x, z); const lk = 1 - sm(0.74, 1.0, ellD(x, z, LK.x, LK.z, LK.rx, LK.rz)); const isl = 1 - sm(0.7, 1.2, ellD(x, z, 13, 34, 6.2, 6.2));
  const rv = (1 - sm(1.4, 4.8, Math.abs(x - riverX(z)))) * sm(44, 47, z) * (1 - sm(66, 68, z)); const wd = (1 - sm(1.4, 4.6, Math.abs(z - westZ(x)))) * (1 - sm(-4, 1, x)) * sm(-22, -15, x);
  const lava = Math.max(lk * (1 - isl), rv, wd * (x < 0 ? 1 : 0)); return lerp(y, LB, lava);
}
const isLava = (x, z) => floorH(x, z) < LAVA + 0.3;
const lavaFrag = (fall) => `
{ if (abs(vWPos.x) < 2.8 && vWPos.z < 2.0) discard; vec2 p = ${fall ? 'vec2(vWPos.x + vWPos.z, vWPos.y * 0.7)' : 'vWPos.xz'}; float t = uTime; vec2 fl = ${fall ? 'vec2(0.0, 0.55)' : 'vec2(0.0, -0.05)'};
  vec2 w = vec2(zfbm3(vec3(p * 0.09, t * 0.045)), zfbm3(vec3(p * 0.09 + 7.0, t * 0.045))) - 0.5;
  vec2 u1 = p / 7.0 + fl * t * ${fall ? '0.5' : '1.0'} + w * 0.9, u2 = p / 3.6 - fl * t * 0.5 + w.yx * 0.7 + 0.37;
  vec3 e1 = texture2D(emissiveMap, u1).rgb, e2 = texture2D(emissiveMap, u2).rgb; float pulse = 0.85 + 0.15 * sin(t * 1.6 + p.x * 0.31 + p.y * 0.17);
  float hot = zfbm3(vec3(p * 0.35, t * 0.12)); vec3 e = (e1 * 0.8 + e2 * 0.55) * pulse * (0.75 + 0.6 * hot);
  float hs = smoothstep(0.6, 0.85, zfbm3(vec3(p * 0.16 + 4.0, t * 0.06))); e = mix(e, vec3(2.0, 1.4, 0.5) * (0.6 + 0.4 * hot), hs * 0.22);               // white-yellow hot spots where fresh lava wells up
  float cr = smoothstep(0.42, 0.62, zfbm3(vec3(p * 0.11 + w * 3.0, t * 0.03))); e *= mix(1.0, 0.35, cr * (1.0 - hs));                                  // drifting dark crust plates
  e += vec3(0.7, 1.0, 1.3) * step(0.987, zvn3(vec3(p * 5.0, floor(t * 3.0)))) * 1.1;                                                                  // rare blue-white flecks
  { vec3 eh = e * ${fall ? '0.75' : '0.58'}; totalEmissiveRadiance = vec3(eh.r, pow(max(eh.g, 0.0), 1.3), pow(max(eh.b, 0.0), 1.9)); } diffuseColor.rgb = texture2D(map, u1).rgb * 0.25; roughnessFactor = 0.65; }`;
const rockFrag = (oy) => `
{ vec3 wn = normalize(vWN); float ly = vWPos.y - (${oy.toFixed(2)}); float up = smoothstep(0.35, 0.85, wn.y);
  // hot fissures: sparse zones of tapering seams (warped planes cut by the surface), hotter toward lava level. Everything else is lit by the baked lava light only.
  vec3 wq = vWPos + 2.0 * (vec3(zfbm3(vWPos * 0.23 + 2.0), zfbm3(vWPos * 0.23 + 9.0), zfbm3(vWPos * 0.23 + 15.0)) - 0.5);
  float zone = smoothstep(0.53, 0.65, zfbm3(vWPos * 0.08 + 1.0)); float sw = smoothstep(0.36, 0.7, zfbm3(vWPos * 0.6 + 8.0));
  float sa = abs(fract(dot(wq, vec3(0.7, 0.2, 0.68)) * 0.21 + 0.5) - 0.5), th = mix(0.0015, 0.014, sw);
  float f = (1.0 - smoothstep(th * 0.3, th, sa)) * zone; float near = smoothstep(2.0, -4.6, ly);
  float hot = f * (0.1 + near * 0.9) * (0.6 + 0.6 * zvn3(vWPos * 3.0));
  vec3 hc = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.5, 0.1), smoothstep(0.2, 0.9, hot));
  totalEmissiveRadiance += hc * hot * 0.85;
  // rock touching the lava glows dull red for a hand's width (cooling skin)
  float rim = smoothstep(-3.3, -4.5, ly) * smoothstep(-5.4, -4.5, ly) * (0.4 + 0.6 * zfbm3(vWPos * 1.3 + 4.0)); totalEmissiveRadiance += vec3(1.0, 0.16 + 0.55 * smoothstep(-4.1, -4.5, ly), 0.02) * rim * 0.6;
  float sul = smoothstep(0.64, 0.78, zfbm3(vWPos * 0.45 + 11.0)) * (1.0 - smoothstep(-1.0, 3.0, ly)) * (1.0 - up * 0.3); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.28, 0.05), sul * 0.7); totalEmissiveRadiance += vec3(0.14, 0.09, 0.0) * sul;
  float ash = smoothstep(0.5, 0.85, zfbm3(vWPos * 0.6)) * up; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.15, 0.15), ash * 0.6); roughnessFactor = mix(roughnessFactor, 0.95, ash);
  float gl = step(0.999, zvn3(vWPos * 70.0)); diffuseColor.rgb += gl * vec3(0.25, 0.2, 0.15); }`;

export default {
  id: 'magma', name: 'Magma Chamber', origin: [0, -400, 0], viewRadius: 150,
  async build(ctx) {
    const { B, fx } = ctx; const oy = ctx.origin.y; const R = makeRng(400); const t0 = performance.now(); const ph = phaser('magma');
    const bb = installBake(B, { cell: 120, cellY: 80, shift: [56, 20, 10] }); B.inst.cell = 100; bb.gain = 0.5; bb.maxK = 0.9; const halos = makeHalos(B, 260); const E = { B, ctx, halos, bake: bb };
    const gy = (x, z) => Math.max(floorH(x, z), LAVA + 0.1);
    // ------------------------------------------------------------ materials
    const basalt = bakeable(B.m('mBasalt', custom(BASALT, [6, 0.3, 0.3, 0.2, 0.5], { colors: [0x0e0c0b, 0x1e1a18, 0x2f2825, 0x54473e], size: 1024, tile: 4, bump: 130, rough: [0.6, 1] }), { triplanar: 1 / 4, vis: true, breakup: 0.4, frag: rockFrag(oy) }));
    const floorB = bakeable(B.m('mFloor', custom(CINDER, [22, 0.0, 0.0, 0.0, 0.0], { colors: [0x100d0c, 0x1e1a18, 0x080706, 0x4a3d34], size: 512, tile: 3, bump: 30, rough: [0.6, 1] }), { vis: true, breakup: 0.4, frag: rockFrag(oy) }));
    const lavaDef = { pattern: 'lava', size: 1024, tile: 6, colors: [0x120c0a, 0x241813, 0xe23806, 0xff8418], params: { scale: 3, crackWidth: 0.09, glow: 2.6, crust: 0.55 }, bump: 40, rough: [0.7, 0.95] };
    const lavaM = B.m('mLava', lavaDef, { frag: lavaFrag(false), vertex: '{ transformed.y += (sin(transformed.x * 0.31 + uTime * 0.7) * sin(transformed.z * 0.27 - uTime * 0.55) + 0.5 * sin(transformed.x * 0.83 + transformed.z * 0.6 + uTime * 1.3)) * 0.04; }', emissiveIntensity: 1.0 }); const lavaF = B.m('mLavaFall', lavaDef, { frag: lavaFrag(true), emissiveIntensity: 1.0 });
    const obsidian = B.m('mObsidian', std({ color: 0x050506, roughness: 0.2, metalness: 0.0, physical: true, clearcoat: 0.35, clearcoatRoughness: 0.12, envMapIntensity: 0.5, key: 'obsidian' }));
    const steel = steelRustMat(B, [0x2e2a28, 0x201d1c, 0x0d0b0a]); const steelRaw = steelRawMat(B, [0x3e3d3e, 0x2d2c2d, 0x121112]); const grate = B.m('mGrate', gratingMaterial({ color: 0x3a3536, rust: 0.35 }));
    const scorch = B.m('mScorch', { pattern: 'plates', size: 256, tile: 1.5, colors: [0x39322e, 0x272220, 0x0c0a09], rustColor: 0x3a1c0e, params: { cols: 1, rows: 1, seam: 0, rivets: 8, brushed: 0.4 }, bump: 2, metal: 1, rough: [0.4, 0.85], layers: { rust: 0.25, grime: 0.8, streak: 0.5, edge: 0.5, oil: 0.3 } });
    const warn = B.m('mWarn', { pattern: 'hazard', size: 256, tile: 0.8, colors: [0xb8901c, 0x151313, 0x40382a], params: { n: 5, angle: 0, wear: 0.9 }, bump: 1, rough: [0.5, 0.9], layers: { grime: 0.7 } });
    const cord = B.m('mCord', std({ color: 0x050403, roughness: 0.7, key: 'mCord' }));
    const crustGlow = B.m('mCrustGlow', std({ color: 0x000000, emissive: 0xff4a10, emissiveIntensity: 1.6, key: 'mCrustGlow' }));
    const hotGlow = B.m('mHotGlow', std({ color: 0x000000, emissive: 0xff5a10, emissiveIntensity: 6, key: 'mHotGlow' })); const railM = { sleeper: scorch, rail: B.m('mRail', std({ color: 0x3a2a22, metalness: 1, roughness: 0.5, key: 'mRail' })), ballast: null };

    // ------------------------------------------------------------ cavity: dome, shaft, hex basalt columns, west drain + NE tunnels
    const inShaft = (x, z) => Math.abs(x) < 2.6 && z < 1.85;
    const hexP = (cx, cz, r, y0, y1) => shape.fn((x, y, z) => { const dx = Math.abs(x - cx), dz = Math.abs(z - cz); const d = Math.max(dx * 0.866 + dz * 0.5, dz) - r; return Math.max(d, Math.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2); }, [cx - r, y0, cz - r, cx + r, y1, cz + r]);
    const cav = new Cavity({ noise: [{ f: [0.13, 0.18, 0.13], a: 0.9, seed: 1 }, { f: [0.42, 0.55, 0.42], a: 0.42, seed: 2 }, { f: [1.2, 1.5, 1.2], a: 0.16, seed: 3 }], fade: 3.5, noiseMul: (x, y, z) => (z < 8 ? 0.5 : 1) });
    cav.air(shape.box(0, -0.5, 0, 2.35, 7.5, 1.75, 0.05)); cav.air(shape.box(0, 1.9, 6.4, 9.5, 4.4, 5.2, 1.3)); cav.air(shape.ell(2, 6, 34, 34, 17, 29)); cav.air(shape.ell(13, -8, 34, 15.5, 8, 17)); cav.air(shape.ell(0, 2, 62, 20, 18, 6));
    cav.air(shape.box(-38, -0.5, 34, 13, 2.6, 2.6, 0.5)); cav.air(shape.box(39.5, 5.4, 46, 9.0, 2.2, 2.6, 0.3)); cav.air(shape.box(-6, 0.0, 70, 2.5, 3.0, 6, 0.5));
    const cols = []; const rc = makeRng(9); for (let i = 0; i < 34; i++) { const a = rc() * TAU, side = i % 3; let cx, cz; if (side === 0) { cx = -32 + rc() * 6; cz = 12 + rc() * 46; } else if (side === 1) { cx = 6 + rc() * 22; cz = 62 + rc() * 4; } else { cx = 30 + rc() * 4; cz = 24 + rc() * 12; } const h = 1.5 + rc() * 7; const f = gy(cx, cz); cols.push({ cx, cz, r: 1.0 + rc() * 0.7, f, h }); }
    for (let i = 0; i < 40; i++) { const x = (rc() - 0.5) * 60, z = 12 + rc() * 50; const ct = 6 + 17 * Math.sqrt(Math.max(0, 1 - ((x - 2) / 34) ** 2 - ((z - 34) / 29) ** 2)); if (ct < 8) continue; const len = 1.5 + rc() * 5, r = 0.5 + rc() * 0.9; cav.solid(shape.coneY(x, z, ct - len, ct + 0.6, 0.06, r), 0.9); }
    cav.floor2D((x, z) => (inShaft(x, z) ? -1e9 : floorH(x, z)));
    ph('materials+cavity ops'); bakeBench('magma', () => cav.bake([-52, -8, -5], [46, 26, 78], 0.6)); const grid = cav.bake([-52, -8, -5], [46, 26, 78], 0.6); bb.air = grid.sample; ph('sdf bake'); const mesh = surfaceNets(grid); ph('surface nets');
    addShell(B, mesh, { basalt, floorB }, (nx, ny) => (ny > 0.62 ? 'floorB' : 'basalt'), { cast: false });
    ph('addShell'); B.colliders.heightFn = floorH; B.colliders.groundY = -1e9;
    shellColliders(B, grid, { x0: -52, x1: 46, z0: -5, z1: 78, cell: 0.6, floor: floorH, thr: 0.2, skin: 2, exclude: (x, z) => floorH(x, z) < LAVA - 0.6 });
    ph('shell colliders');
    for (let z = 12; z < 62; z += 7) for (const x of [-29, -25]) bb.light({ p: [x, gy(x, z) + 2.2, z], c: [1, 0.3, 0.06], I: 55, R: 15, s: 1.6 });      // firelight on the west columns
    // real basalt columns: bundles of hexagonal prisms (jointed, tilted tops) replace the smooth SDF pillars; one cylinder collider per bundle
    const PT = new Parts(B, R);
    for (const c of cols) { B.colliders.addCyl({ x: c.cx, z: c.cz, r: c.r * 0.9, y0: c.f - 1, y1: c.f + c.h, surface: 'rock', walk: false }); basaltField(PT, basalt, { cx: c.cx, cz: c.cz, rx: c.r, rz: c.r, r0: 0.3 + R() * 0.1, base: () => c.f - 0.8, top: (x, z, r) => c.f + c.h * (0.4 + 0.6 * r()), j: 0.09 }); }
    // hazard cells: keep everyone out of the lava. Layer 1 (low, y -8.3..-2.9) catches anything that slides down a bank; layer 2 (y -2.9..-0.9) walls off the
    // lava edge except under the catwalk decks (bridge footprints), so decks stay walkable for players and zombies alike.
    const bridges = [[[5.0, 20.0], [11.2, 30.6], 2.2], [[13.0, 38.2], [9.5, 54.0], 2.2], [[-14, 26.0], [-14, 37.6], 1.8]];
    const onDeck = (x, z) => bridges.some(([a, b, w]) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)) < w / 2 + 0.7; });
    let hc = 0;
    { const x0 = -40, x1 = 44, z0 = 8, z1 = 72, cell = 0.6; const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell); const lv = new Uint8Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) lv[i + nx * j] = isLava(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell) ? 1 : 0;
      const layer = (yc, hy, useDeck) => { const mask = new Uint8Array(nx * nz), used = new Uint8Array(nx * nz);
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let m = 0; for (let dj = -1; dj <= 1 && !m; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < nz && lv[a + nx * b]) { m = 1; break; } } if (m && useDeck && onDeck(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell)) m = 0; mask[i + nx * j] = m; }
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { if (!mask[i + nx * j] || used[i + nx * j]) continue; let w = 1; while (i + w < nx && mask[i + w + nx * j] && !used[i + w + nx * j]) w++; let h = 1; outer: while (j + h < nz) { for (let a = 0; a < w; a++) if (!mask[i + a + nx * (j + h)] || used[i + a + nx * (j + h)]) break outer; h++; } for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) used[i + a + nx * (j + b)] = 1; B.colliders.addBox({ x: x0 + (i + w / 2) * cell, y: yc, z: z0 + (j + h / 2) * cell, hx: w * cell / 2, hy: hy, hz: h * cell / 2, surface: 'lava', walk: false, shootable: false }); hc++; } };
      layer(-5.6, 2.7, false); layer(-1.9, 1.0, true); }

    ph('hazard cells');
    // ------------------------------------------------------------ shaft stub (hot rock) + landing + landing platform (steel grating)
    const sm2 = shaftMats(B, 'hot'); shaftLining(B, sm2, { y0: -8, y1: 7, style: 'hot', front: [{ y0: 0, y1: OPEN.h }], collide: true, seed: 5 });
    const landing = buildLanding(ctx, B, { frame: scorch, steel: steelRaw, mesh: meshMaterial({ kind: 'diamond', cell: 0.06, wire: 3.4, tile: 0.48 }), plate: scorch }, { style: 'steel' });
    B.box({ p: [0, -0.03, 6.4], s: [17.6, 0.04, 9.4], mat: scorch, bevel: 0, col: 'metal', cast: false, tag: 'deck' }); grating(PT, steelRaw, { x0: -8.8, x1: 8.8, z0: 1.7, z1: 11.1, y: 0.045, edge: [0, 0, 0, 0] }); for (let z = 2.2; z < 11; z += 1.5) B.box({ p: [0, -0.32, z], s: [17.6, 0.26, 0.1], mat: steelRaw, bevel: 0.01, cast: false });
    handrail(B, warn, [-8.8, 0, 2.0], [-8.8, 0, 5.0], { posts: 1.5 }); handrail(B, warn, [-8.8, 0, 7.8], [-8.8, 0, 11.0], { posts: 1.5 }); handrail(B, warn, [8.8, 0, 2.0], [8.8, 0, 5.0], { posts: 1.5 }); handrail(B, warn, [8.8, 0, 7.8], [8.8, 0, 11.0], { posts: 1.5 }); handrail(B, warn, [-8.8, 0, 11.0], [-2.4, 0, 11.0], { posts: 1.8 }); handrail(B, warn, [2.4, 0, 11.0], [8.8, 0, 11.0], { posts: 1.8 });
    for (const s2 of [-1, 1]) { B.box({ p: [s2 * 8.95, 0, 6.4], s: [0.2, 2.7, 2.8], mat: scorch, bevel: 0.02, col: 'metal' }); for (const z of [5.0, 7.8]) B.box({ p: [s2 * 8.95, 0, z], s: [0.3, 2.9, 0.16], mat: steelRaw, bevel: 0.02, cast: false }); B.box({ p: [s2 * 8.95, 2.7, 6.4], s: [0.3, 0.16, 2.96], mat: steelRaw, bevel: 0.02, cast: false }); }
    B.stairs({ p: [0, FLOOR0, 15.02], n: 14, rise: 0.1786, run: 0.28, w: 4.0, yaw: PI / 2, mat: grate, col: 'metal' }); stairCheeks(B, steelRaw, { p: [0, FLOOR0, 15.02], yaw: PI / 2, n: 14, rise: 0.1786, run: 0.28, w: 4.0, t: 0.12, surface: 'metal' });
    for (const [x, z, sx, sz] of [[-8.7, 6.4, 0.2, 9.4], [8.7, 6.4, 0.2, 9.4], [-5.45, 11.0, 6.7, 0.2], [5.45, 11.0, 6.7, 0.2]]) { B.box({ p: [x, FLOOR0, z], s: [sx, -FLOOR0 - 0.05, sz], mat: scorch, bevel: 0.02, col: 'metal' }); for (const y of [-1.7, -0.9, -0.2]) B.box({ p: [x, y, z], s: [sx + 0.08, 0.1, sz + 0.08], mat: steelRaw, bevel: 0.01, cast: false }); }   // solid skirt under the platform
    for (const [x, z] of [[-8.4, 2.3], [8.4, 2.3], [-8.4, 10.6], [8.4, 10.6], [-8.4, 6.4], [8.4, 6.4], [-2.2, 10.6], [2.2, 10.6]]) B.box({ p: [x, FLOOR0 - 0.2, z], s: [0.4, -FLOOR0 + 0.2, 0.4], mat: steelRaw, bevel: 0.02, col: 'metal' });      // platform legs

    // ------------------------------------------------------------ lava surfaces: lake/river plane (clipped by terrain), lava fall sheet, glowing shore
    const lavaPlane = new THREE.Mesh(new THREE.PlaneGeometry(110, 100, 110, 100).rotateX(-PI / 2), lavaM); lavaPlane.position.set(-4, LAVA, 34); lavaPlane.renderOrder = 1; B.group.add(lavaPlane);
    const fallM = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 18, 1, 1), lavaF); fallM.position.set(riverX(64), 4.6, 66.3); B.group.add(fallM); B.box({ p: [riverX(64), 12.4, 67.2], s: [8.6, 2.6, 1.6], mat: basalt, bevel: 0.05, cast: false, col: false });
    for (let x = -30; x <= 32; x += 3.2) for (let z = 10; z <= 66; z += 3.2) { if (!isLava(x, z)) continue; bb.light({ p: [x, LAVA + 0.8, z], c: [1, 0.4, 0.09], I: 26, R: 12, s: 2.4 }); if ((Math.round(x / 3.2) * 7 + Math.round(z / 3.2) * 13) % 23 === 0) halos.add([x, LAVA + 0.6, z], 0xff5a10, 1.6, 0.05, 0); }
    for (let y = -2; y < 14; y += 2.6) { bb.light({ p: [riverX(64), y, 65], c: [1, 0.4, 0.09], I: 40, R: 16, s: 2 }); if (y > 3 && y < 8) halos.add([riverX(64), y, 65.6], 0xff6a18, 2.0, 0.12, 0); }

    // ------------------------------------------------------------ truss catwalk bridge (landmark) from the near shelf across the lake to the island, second span to the far shelf
    const bridge = (a, b, w = 2.0) => { const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx), ux = dx / L, uz = dz / L, nx = -uz, nz = ux; const yD = a[1];
      B.box({ p: [(a[0] + b[0]) / 2, yD - 0.08, (a[2] + b[2]) / 2], s: [L, 0.08, w], yaw, mat: scorch, bevel: 0, col: 'metal', cast: false }); gratingYaw(PT, steelRaw, { c: [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2], y: yD + 0.03, len: L, wid: w, yaw });
      const n = Math.max(2, Math.round(L / 2.4)); for (let i = 0; i <= n; i++) { const t = i / n, x = a[0] + dx * t, z = a[2] + dz * t; for (const s of [-1, 1]) B.beam([x + nx * s * w / 2, yD - 0.08, z + nz * s * w / 2], [x + nx * s * w / 2, yD + 1.0, z + nz * s * w / 2], 0.09, 0.09, { mat: steelRaw }); B.box({ p: [x, yD - 0.35, z], s: [0.14, 0.26, w + 0.3], yaw, mat: steelRaw, bevel: 0.01, cast: false }); if (i < n) { const t2 = (i + 1) / n, x2 = a[0] + dx * t2, z2 = a[2] + dz * t2; for (const s of [-1, 1]) { B.beam([x + nx * s * w / 2, yD + 1.0, z + nz * s * w / 2], [x2 + nx * s * w / 2, yD + 1.0, z2 + nz * s * w / 2], 0.07, 0.07, { mat: warn }); B.beam([x + nx * s * w / 2, yD - 0.2, z + nz * s * w / 2], [x2 + nx * s * w / 2, yD + 0.95, z2 + nz * s * w / 2], 0.06, 0.06, { mat: steelRaw }); B.beam([x + nx * s * w / 2, yD + 0.95, z + nz * s * w / 2], [x2 + nx * s * w / 2, yD - 0.2, z2 + nz * s * w / 2], 0.06, 0.06, { mat: steelRaw }); B.beam([x + nx * s * w / 2, yD + 0.5, z + nz * s * w / 2], [x2 + nx * s * w / 2, yD + 0.5, z2 + nz * s * w / 2], 0.05, 0.05, { mat: steelRaw }); } } }
      // heavy trusses above at the ends: portal frames
      for (const q of [0, 1]) { const p0 = q ? b : a; for (const s of [-1, 1]) B.beam([p0[0] + nx * s * w / 2, yD, p0[2] + nz * s * w / 2], [p0[0] + nx * s * w / 2, yD + 2.6, p0[2] + nz * s * w / 2], 0.18, 0.18, { mat: steel }); B.beam([p0[0] + nx * w / 2, yD + 2.6, p0[2] + nz * w / 2], [p0[0] - nx * w / 2, yD + 2.6, p0[2] - nz * w / 2], 0.18, 0.18, { mat: steel }); }
      // piers into the lava
      for (let i = 1; i < n; i += 2) { const t = i / n, x = a[0] + dx * t, z = a[2] + dz * t; if (isLava(x, z)) { for (const s of [-1, 1]) B.beam([x + nx * s * 0.7, LAVA - 2, z + nz * s * 0.7], [x + nx * s * 0.7, yD - 0.3, z + nz * s * 0.7], 0.2, 0.2, { mat: steel }); B.beam([x + nx * 0.7, LAVA + 1.2, z + nz * 0.7], [x - nx * 0.7, LAVA + 1.2, z - nz * 0.7], 0.14, 0.14, { mat: steelRaw }); } }
      return { L, yaw };
    };
    const BY = FLOOR0 + 0.22;
    bridge([5.0, BY, 20.0], [11.2, BY, 30.6], 2.2); bridge([13.0, BY, 38.2], [9.5, BY, 54.0], 2.2); bridge([-14, BY, 26.0], [-14, BY, 37.6], 1.8);
    // island smelter: crucible, gantry, pipes, hopper, tub on rails, signs
    const IX = 13, IZ = 35.5, IY = FLOOR0 + 0.05;
    B.cyl({ p: [IX + 1.5, IY, IZ - 1], r: 1.9, h: 4.2, seg: 24, mat: scorch, col: 'metal' }); B.cyl({ p: [IX + 1.5, IY + 4.2, IZ - 1], r: [1.9, 1.0], h: 1.4, seg: 24, mat: scorch, cast: true }); for (let y = 0.8; y < 4.2; y += 1.0) B.cyl({ p: [IX + 1.5, IY + y, IZ - 1], r: 1.95, h: 0.14, seg: 24, mat: steelRaw, cast: false });
    for (let k = 0; k < 4; k++) { const a = k * PI / 2 + 0.7; B.beam([IX + 1.5 + Math.cos(a) * 1.7, IY, IZ - 1 + Math.sin(a) * 1.7], [IX + 1.5 + Math.cos(a) * 1.4, IY + 4.4, IZ - 1 + Math.sin(a) * 1.4], 0.18, 0.18, { mat: steel }); }
    B.sphere({ p: [IX + 1.5, IY + 4.4, IZ - 1], r: 0.26, seg: 10, mat: hotGlow, cast: false }); halos.add([IX + 1.5, IY + 4.7, IZ - 1], 0xff6a18, 0.9, 0.16, 5);
    cylBetween(B, [IX + 2.6, IY + 2.6, IZ - 1.6], [IX + 6.5, IY + 1.2, IZ - 2.2], 0.28, steelRaw, { seg: 12 }); pipeRun(B, [[IX + 6.5, IY + 1.2, IZ - 2.2], [IX + 8.0, IY + 1.2, IZ - 2.2], [IX + 8.0, IY + 9.0, IZ - 2.2]], 0.36, scorch, { flange: 3, seg: 14 });
    B.box({ p: [IX - 3, IY, IZ + 1.5], s: [2.2, 1.6, 1.8], mat: scorch, bevel: 0.04, col: 'metal' }); B.box({ p: [IX - 3, IY + 1.6, IZ + 1.5], s: [2.6, 0.12, 2.2], mat: steelRaw, bevel: 0.02 }); for (let k = 0; k < 7; k++) B.rock({ p: [IX - 3 + (R() - 0.5) * 1.6, IY + 1.75, IZ + 1.5 + (R() - 0.5) * 1.4], r: 0.28 + R() * 0.2, squash: [1.2, 0.7, 1], amp: 0.5, seed: k, detail: 1, mat: basalt, cast: true });
    signQuad(B, signMaterial({ lines: ['DANGER', 'MOLTEN ROCK'], bg: '#b8231b', fg: '#f4f0e6', w: 512, h: 256, weather: 0.95 }), [IX - 3, IY + 2.4, IZ + 0.55], 1.4, 0.7, 0);
    railLine(B, railM, [IX - 5.5, IY, IZ - 4], [IX + 2, IY, IZ - 4.2], { gauge: 0.61, y: 0, ballast: false, seed: 3 }); tub(B, { tub: scorch, rim: steelRaw, wheel: steelRaw, coal: basalt, ore: basalt }, { p: [IX - 1.5, IY, IZ - 4.1], yaw: 0.03, load: 'coal', seed: 9 });

    // ------------------------------------------------------------ obsidian spires (glassy black), heat-blackened props, shore rubble
    const spire = (x, z, h, r, seed) => { const f = gy(x, z); for (let k = 0; k < 6; k++) { const raw = hexCrystalRaw(r * (0.5 + R() * 0.7), h * (0.35 + R() * 0.65), seed * 11 + k, { tip: 1.6 + R(), sides: 5 + (k % 2), jitter: 0.14 }); const d = new THREE.Vector3((R() - 0.5) * 0.7, 1, (R() - 0.5) * 0.7).normalize(); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); const m = new THREE.Matrix4().compose(new THREE.Vector3(x + (R() - 0.5) * r * 2, f - 0.3, z + (R() - 0.5) * r * 2), q, new THREE.Vector3(1, 1, 1)); B.addRaw(raw, m, obsidian, { cast: true, bake: false }); } B.colliders.addCyl({ x, z, r: r * 1.1, y0: f - 1, y1: f + h * 0.6, surface: 'crystal', walk: false }); };
    for (const [x, z, h, r] of [[6, 30, 4.0, 0.9], [-12, 40, 5.5, 1.1], [24, 26, 6.0, 1.2], [-18, 22, 3.6, 0.8], [-8, 55, 5.0, 1.0], [27, 50, 4.5, 0.9], [16, 58, 3.2, 0.7], [-24, 46, 4.0, 0.9]]) spire(x, z, h, r, x * 3 + z);
    for (let i = 0; i < 70; i++) { const x = (R() - 0.5) * 62, z = 12 + R() * 54; const f = gy(x, z); if (isLava(x, z) || f < -3.9 || (Math.abs(x) < 4 && z < 14)) continue; B.rock({ p: [x, f + 0.1, z], r: 0.2 + R() * 0.8, squash: [1.3, 0.55, 1.1], amp: 0.5, seed: i + 2, detail: 2, mat: basalt, cast: true, col: R() < 0.3 ? 'rock' : undefined }); }
    // steam vents (glowing rims) + a coolant pipe run with a leak, warning signs and lanterns at the landing
    const vents = [[-9, 26], [-14, 44], [3, 50], [-4, 36], [22, 62]]; for (const [x, z] of vents) { const f = gy(x, z); B.cyl({ p: [x, f, z], r: [0.55, 0.34], h: 0.3, seg: 12, mat: basalt, cast: false }); B.cyl({ p: [x, f + 0.28, z], r: 0.3, h: 0.03, seg: 12, mat: hotGlow, cast: false }); halos.add([x, f + 0.4, z], 0xff5a10, 1.1, 0.16, 0); ctx.light({ pos: [x, f + 0.6, z], color: 0xff5a18, intensity: 5, distance: 6, decay: 2, kind: 'point', flicker: 0.3, flickerSpeed: 6 }); }
    pipeRun(B, [[-8.8, 2.4, 12], [-16, 1.6, 16], [-22, -0.5, 24], [-22, -2.2, 33]], 0.22, scorch, { flange: 3.4, seg: 12 });
    signQuad(B, signMaterial({ lines: ['LEVEL 400', 'HEAT HAZARD'], bg: '#b8231b', fg: '#f4f0e6', w: 512, h: 160, weather: 0.9 }), [8.83, 2.15, 6.4], 1.6, 0.5, -PI / 2);
    for (const [x, y, z] of [[-7.6, 3.0, 4.0], [7.6, 3.0, 4.0]]) { halos.add([x, y, z], 0xffa860, 0.9, 0.7, 6); ctx.light({ pos: [x, y - 0.1, z], color: 0xffa860, intensity: 10, distance: 8, decay: 2, flicker: 0.1, flickerSpeed: 7, kind: 'point' }); bb.light({ p: [x, y, z], c: lin(0xffa860), I: 3, R: 10, s: 0.4, shadow: true }); B.sphere({ p: [x, y, z], r: 0.07, seg: 8, mat: hotGlow, cast: false }); }
    // barricade: blast door bulkhead on the east ledge (opening 1.5 x 1.9)
    const EX = 35.7, EY = gy(38, 46), EZ = 46;
    for (const [z0, z1] of [[EZ - 2.05, EZ - 0.75], [EZ + 0.75, EZ + 2.05]]) B.box({ p: [EX, EY, (z0 + z1) / 2], s: [0.3, 4.4, z1 - z0], mat: scorch, bevel: 0.02, col: 'metal' }); B.box({ p: [EX, EY + 1.9, EZ], s: [0.3, 2.5, 1.5], mat: scorch, bevel: 0.02, col: false });
    for (let k = 0; k < 5; k++) B.box({ p: [EX - 0.18, EY + 0.3 + k * 0.4, EZ - 1.4], s: [0.06, 0.06, 1.2], mat: warn, cast: false });
    // floating crust plates on the lava (dark faceted slabs with a glowing margin) + slag lumps on the shore
    for (let k = 0; k < 46; k++) { let x = 0, z = 0, ok = false; for (let t = 0; t < 12 && !ok; t++) { x = LK.x + (R() - 0.5) * 2 * LK.rx * 0.9, z = LK.z + (R() - 0.5) * 2 * LK.rz * 0.9; ok = isLava(x, z) && Math.hypot(x - 13, z - 34) > 7; } if (!ok) continue; const r = 0.5 + Math.pow(R(), 2) * 1.6; PT.of(basalt, false).rock(x, LAVA + 0.02, z, r, R, { squash: [1, 0.07, 1], cuts: 6, jit: 0.2, tilt: 0.06 }); PT.of(crustGlow, false).rock(x, LAVA + 0.004, z, r * 1.16, R, { squash: [1, 0.05, 1], cuts: 0, jit: 0.1, tilt: 0.0, low: true }); }
    for (let k = 0; k < 70; k++) { const x = (R() - 0.5) * 56 + 4, z = 12 + R() * 56, f = gy(x, z); if (isLava(x, z) || f < -3.6 || (Math.abs(x) < 4.5 && z < 14)) continue; PT.of(basalt, false).rock(x, f, z, 0.1 + Math.pow(R(), 2.5) * 0.5, R, { cuts: 6, jit: 0.25 }); }
    console.log('[magma] real parts triangles', PT.tris); PT.flush();
    // ------------------------------------------------------------ pooled lights: hot orange above the lake / fall / shelves; embers, ash, haze
    for (const [x, y, z, I, Rr] of [[13, -2.2, 22, 85, 26], [4, -2.2, 34, 50, 24], [16, -2.2, 45, 85, 26], [12, 4, 62, 170, 30], [22, -1.5, 30, 60, 22], [-6, -1, 44, 45, 20], [12, 3, 34, 45, 22]]) ctx.light({ pos: [x, y, z], color: 0xff5a1a, intensity: I, distance: Rr, decay: 2, kind: 'point', flicker: 0.12, flickerSpeed: 3.4 });
    for (const [x, z] of [[8, 25], [11, 30], [10, 46], [11, 51]]) ctx.light({ pos: [x, -3.4, z], color: 0xff5a18, intensity: 45, distance: 14, decay: 2, kind: 'point', flicker: 0.1, flickerSpeed: 4 });
    ctx.weather({ type: 'embers', count: 320, box: [50, 18, 50], fall: -0.9, size: 0.018, turb: 1.1, color: [3.0, 0.9, 0.2], alpha: 0.9, cell: 3, additive: true, twinkle: 0.8, seed: 41, wind: [0.2, 0.1, -0.15] });
    ctx.weather({ type: 'ash', count: 700, box: [50, 18, 50], fall: 0.25, size: 0.03, turb: 0.9, color: [0.34, 0.32, 0.3], alpha: 0.55, cell: 3, seed: 42, wind: [0.3, 0, -0.2] });
    { const em = []; for (const [x, z, r] of [[13, 34, 3], [6, 30, 3], [20, 30, 3], [13, 42, 3], [8, 24, 2.5], [18, 24, 2.5], [10, 50, 3], [14, 55, 2.5], [-8, 30, 2.5], [-14, 33, 2.5], [22, 40, 2.5], [4, 38, 2.5]]) em.push({ p: [x, LAVA + 0.3, z], c: [4.0, 1.5, 0.3], s: r }); em.push({ p: [riverX(64), 4, 65], c: [4.0, 1.4, 0.3], s: 3 }); for (const [x, y, z] of [[13 + 1.5, 4.7, 34.5 - 1], [-7.6, 3.0, 4.0], [7.6, 3.0, 4.0]]) em.push({ p: [x, y, z], c: [3.5, 1.1, 0.25], s: 0.5 }); lampGloss(B, oy, em, { k: 0.3 }); }
    const atmo = {
      name: 'Shaft Nine · Magma Chamber', fog: { color: 0x0c0608, scatter: 0x3a1408, density: 0.02, falloff: 0.06, base: -404, power: 2.5 },
      sky: null, sun: { dir: [0.1, 0.05, 1], color: 0xff6a20, intensity: 0, shadow: false }, env: { intensity: 0.15 },
      exposure: 1.0, bloom: 0.3, vignette: 0.45, grain: 0.04, chroma: 0.0024, ao: 0.85, wet: 0, reverb: 'mineShaft',
      grade: { sat: 1.12, contrast: 1.14, lift: [0.02, 0.0, 0.0], gain: [1.08, 0.97, 0.9], tint: [1.03, 0.97, 0.94] }, autoExposure: { key: 0.13, min: 0.85, max: 1.5 },
    };
    ph('props+lights'); ph.done(); console.log('[magma] build ms', (performance.now() - t0).toFixed(0), 'hazard boxes', hc);
    const ventT = { t: 0 };
    normalizePatch(B, { breakup: 0.4, addBreakup: true, wet: false });
    return {
      onReady(st) { const u = unifyPrograms(st.group); console.log('[magma] programs after unify', u.programs, 'meshes', u.meshes, '| build+finish ms', (performance.now() - t0).toFixed(0)); },
      atmo, envPatches: [{ dir: [0, -0.4, 1], color: 0xff5a20, size: 5, intensity: 3 }, { dir: [0, 1, 0.2], color: 0x2a3078, size: 4, intensity: 3.2 }, { dir: [-0.7, 0.3, -0.3], color: 0x1c2a66, size: 4, intensity: 2.2 }],
      playerStart: { pos: [0, 0, 9.4], yaw: PI }, station: { pos: [0, 0, 0], yaw: 0 }, heightFn: floorH, groundY: -1e9, groundSurface: 'rock', landing,
      surfaceAt: (x, z) => (isLava(x, z) ? 'lava' : 'rock'), navBlocked: cliffBlocker(B.colliders), navBounds: [-54, -3, 50, 78], landmark: { pos: [10, 3, 34], name: 'Lava Lake Bridge' },
      spawns: [{ kind: 'barricade', pos: [36.8, EY, 46], yaw: PI / 2, boards: 5 }, { kind: 'walk', pos: [-49, FLOOR0, 34], yaw: -PI / 2 }, { kind: 'walk', pos: [-6, FLOOR0, 72], yaw: 0 }, { kind: 'rise', pos: [-9, gy(-9, 26), 26], yaw: 0 }, { kind: 'rise', pos: [-16, gy(-16, 40), 40], yaw: 0 }, { kind: 'rise', pos: [-3, gy(-3, 48), 48], yaw: 0 }, { kind: 'rise', pos: [27, gy(27, 52), 52], yaw: 0 }],
      buys: { walls: [{ pos: [-8.83, 1.5, 6.4], yaw: PI / 2, gun: 'ak74u' }, { pos: [8.83, 1.5, 6.4], yaw: -PI / 2, gun: 'm14' }], perks: [{ pos: [0, gy(0, 17), 17], yaw: PI, perk: 'staminup' }], box: { pos: [-10, gy(-10, 24), 24], yaw: PI / 2 } },
      zombieVariants: ['miner_burnt', 'miner_lamp', { id: 'miner_gas', weight: 0.7 }, { id: 'miner_foreman', weight: 0.5, minRound: 3 }],
      ambient: { space: 'mineShaft', gain: 1, beds: [{ type: 'rumble', freq: 28, gain: 0.3 }, { type: 'crackle', gain: 0.16, kind: 'lava' }, { type: 'noise', color: 'pink', gain: 0.07, kind: 'steam' }, { type: 'drone', freq: 55, gain: 0.1 }], events: [{ type: 'bubble', every: [1.2, 4.5], gain: 0.5, pos: 'around' }, { type: 'rockfall', every: [25, 60], gain: 0.4, pos: 'far' }, { type: 'clank', every: [8, 20], gain: 0.3, pos: 'far' }, { type: 'gust', every: [6, 16], gain: 0.3, pos: 'around' }] },
      update(dt, t, active) {
        if (G.uHeat) G.uHeat.value = active ? 1 : 0;    // heat shimmer intensity for the screen-space distortion (contract: 0..1, owned by this stop while visible)
        if (!active) return; ventT.t -= dt; if (ventT.t < 0) { ventT.t = 0.09; for (const [x, z] of vents) { const f = gy(x, z) + oy; fx.puff({ x: x + (Math.random() - 0.5) * 0.3, y: f + 0.4, z: z + (Math.random() - 0.5) * 0.3 }, { x: 0, y: 1, z: 0 }, 1, { speed: 1.6, size: [0.25, 1.8], life: 2.6, color: [0.75, 0.55, 0.42, 0.22], rise: 2.2, drag: 0.5, spread: 0.4, cell: 1 }); } }
        if (Math.random() < dt * 8) { const x = LK.x + (Math.random() - 0.5) * 22, z = LK.z + (Math.random() - 0.5) * 24; if (isLava(x, z)) fx.add.emit({ p: [x, LAVA + oy + 0.1, z], v: [(Math.random() - 0.5) * 0.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.5], life: 0.9, size: [0.06, 0.02], c0: [3, 1.1, 0.2, 1], c1: [1, 0.15, 0, 0], gravity: 1, cell: 0 }, fx.time); }
      },
    };
  },
};
