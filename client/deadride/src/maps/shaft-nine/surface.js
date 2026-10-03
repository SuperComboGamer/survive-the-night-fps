// SHAFT NINE — Stop 1: SURFACE YARD (dusk). Landmark: the 34 m steel headframe with twin sheave wheels over the shaft collar (the cage rides up into it).
// Low orange sun with long shadows and cool blue shade, a fenced colliery yard with a hollow brick engine house (real barricade openings), rails and
// tubs, coal heaps, a water tower, tool shed, timber yard and the adit, ringed by distant ridges.
import * as THREE from 'three';
import { HaloBatch, makeBeam } from '../../core/glow.js';
import { signMaterial } from '../../core/canvas2d.js';
import { oilDrum, crate, pallet, ladder } from '../../core/props.js';
import { buildTerrain } from '../../core/terrain.js';
import { rand, makeRng, noise2, fbm2, TAU } from '../../core/util.js';
import { std } from '../../core/mats.js';
import { normalizePatch, PI, OPEN, SHAFT, at, cylBetween, railLine, tub, wallHoles, signQuad, steelRawMat, steelRustMat, puddleWater, setEmitters, unifyPrograms, extendMaterial, smoothVis, lin, lightPool, barrel, sack, crateBox, handrail, meshMaterial, cliffBlocker } from './kit.js';
import { bakeGroundMacro } from './macro.js';
import { prepGeo, ShiftedStaticBatch } from './bake.js';
import { Parts, wireRope, brickWall, hewn, coil as coilP, T as partT } from './parts.js';
import { drum as drumP, crate as crateP } from './parts.js';
import { scatter as scatterP, bucket as bucketP } from './parts2.js';
import { spool as spoolP, barbedWire as barbedP } from './parts2.js';
import { headframe, sheaveGeo, geoToBuffer, windowFrame, doubleDoor, gableRoof, chimney, shed, waterTower, fenceRun, lampPole, pallet as palletP, heap, railing, cagedLadder } from './yard.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { visVariant } from '../../core/mats.js';
import { shaftMats, shaftLining } from './shaft.js';
import { buildLanding } from './landing.js';
import { custom, CINDER, TIMBER, COAL, STRATA } from './glsl.js';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bench = (h, st, amt) => { const f = h / st, fl = Math.floor(f), fr = f - fl; return h + ((fl + Math.pow(sm(0.5, 0.92, fr), 1.6)) * st - h) * amt * sm(3, 30, h); };      // stepped rock strata
const hills = (x, z) => { const r = Math.hypot(x, z); if (r < 80) return 0; const k = sm(80, 300, r); const n = fbm2(x * 0.0055 + 4.0, z * 0.0055 - 2.0, 5) * 2 - 0.35; const rg = 1 - Math.abs(noise2(x * 0.011, z * 0.011) * 2); let h = k * (10 + 62 * Math.max(0, n) + 26 * rg * rg) + 0.6 * noise2(x * 0.09, z * 0.09) * k;
  h = bench(h, 6.5, 0.6); const cr = 1 - Math.abs(noise2(x * 0.055 + 7.0, z * 0.055 - 3.0) * 2); return h + k * 6.0 * cr * cr * cr * sm(8, 50, h) + k * 1.4 * noise2(x * 0.21, z * 0.21); };
const groundFrag = `
{ float ly = vWPos.y; vec3 wn = normalize(vWN); float slope = 1.0 - smoothstep(0.55, 0.95, wn.y);
  vec2 mu = (vWPos.xz - uMacro.xy) / uMacro.z; float ins = step(0.0, mu.x) * step(mu.x, 1.0) * step(0.0, mu.y) * step(mu.y, 1.0);
  vec4 mA = texture2D(uMacroA, mu) * ins, mB = texture2D(uMacroB, mu) * ins;                                   // baked macro structure (macro.js): road, rut, dark stains, mottling | yard, grass, puddle, noise
  float n = zvn3(vWPos * 0.05), n3 = zvn3(vWPos * 2.3), n4 = zvn3(vWPos * 0.07 + 5.0);
  float road = mA.r, rut = mA.g, dk = mA.b, mot = mA.a, yardM = mB.r, grass = mB.g, pud = mB.b, n2 = mix(n4, mB.a, ins);
  vec3 cinderC = vec3(0.022, 0.021, 0.023) * (0.7 + 0.7 * n3); diffuseColor.rgb = mix(diffuseColor.rgb, cinderC, yardM * 0.7);
  float pale = clamp((mot - 0.5) * 2.0, 0.0, 1.0), rust = clamp((0.5 - mot) * 2.0, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.132, 0.12) * (0.7 + 0.6 * n2), pale * 0.6); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.045, 0.028) * (0.7 + 0.6 * n2), rust);
  diffuseColor.rgb *= 1.0 - 0.72 * dk; roughnessFactor = mix(roughnessFactor, 0.6, dk);
  diffuseColor.rgb *= (0.6 + 0.8 * zvn3(vWPos * 11.0)) * (0.8 + 0.4 * zvn3(vWPos * 31.0 + 4.0)) * (1.0 + (zvn3(vWPos * 0.21) - 0.5) * 0.8 + (zvn3(vWPos * 0.53 + 1.7) - 0.5) * 0.4);   // pebble-scale variation + world-space tile breaking (the 4 m texture repeat showed as a lattice from above)
  float low = 1.0 - smoothstep(4.0, 26.0, ly); float g2 = (grass + (1.0 - ins) * smoothstep(0.32, 0.6, n4) * 0.9) * low;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.078, 0.04) * (0.7 + 0.6 * n3), g2 * 0.75); roughnessFactor = mix(roughnessFactor, 0.98, g2);
  vec3 roadC = vec3(0.075, 0.07, 0.064) * (0.8 + 0.4 * n3); diffuseColor.rgb = mix(diffuseColor.rgb, roadC, road * 0.8); roughnessFactor = mix(roughnessFactor, 0.95, road);
  diffuseColor.rgb *= 1.0 - rut * 0.6; roughnessFactor = mix(roughnessFactor, 0.12, rut * smoothstep(0.5, 0.7, n2));
  diffuseColor.rgb *= 1.0 - 0.38 * (1.0 - yardM);                                                                                          // natural ground darker than the worked yard: value separation for zombies and the ridge line
  vec3 rockC = vec3(0.075, 0.072, 0.082) * (0.7 + 0.6 * n);
  float hi = smoothstep(2.0, 30.0, ly) * 0.75 + slope * 0.9 + (1.0 - ins) * smoothstep(0.58, 0.74, n) * 0.55; diffuseColor.rgb = mix(diffuseColor.rgb, rockC, clamp(hi, 0.0, 0.95)); roughnessFactor = mix(roughnessFactor, 0.92, hi);
  float snow = smoothstep(120.0, 190.0, ly + (n2 - 0.5) * 60.0) * (1.0 - slope * 0.85) * smoothstep(0.55, 0.9, wn.y); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.34, 0.42) * (0.8 + 0.3 * n3), snow * 0.8); roughnessFactor = mix(roughnessFactor, 0.6, snow);
  float pd = pud * (1.0 - clamp(hi, 0.0, 1.0)); diffuseColor.rgb *= 1.0 - 0.3 * pd; roughnessFactor = mix(roughnessFactor, 0.1, pd);
  // real relief: tyre ruts, hollows and pebbles perturb the shading normal (screen-space derivative bump, no geometry needed)
  { float hb = -rut * 0.045 - pd * 0.02 + (zvn3(vWPos * 13.0) - 0.5) * 0.016 * (1.0 - clamp(hi, 0.0, 1.0)) + (zvn3(vWPos * 3.1) - 0.5) * 0.035 * yardM + (zvn3(vWPos * 0.9) - 0.5) * 0.06;
    vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition), R1 = cross(sY, normal), R2 = cross(normal, sX); float det = dot(sX, R1);
    if (abs(det) > 1e-10) { vec2 dH = vec2(dFdx(hb), dFdy(hb)); vec3 gr = sign(det) * (dH.x * R1 + dH.y * R2); normal = normalize(abs(det) * normal - gr); } } }`;
// wind-blown cloth (flags, hanging tarps): a vertex flutter that grows with distance from the fixed edge (local x from the pole / -y from the hanging edge)
const CLOTH_V = `{ float k = clamp(transformed.x * 0.5, 0.0, 1.0) + clamp(-transformed.y * 0.6, 0.0, 1.0); float ph = uTime * (2.4 + 2.2 * k) - transformed.x * 3.2 + transformed.y * 1.7; float g = 0.55 + 0.12 * length(uWind);
  transformed.z += (sin(ph) * 0.14 + sin(ph * 2.13 + 1.3) * 0.05) * k * g; transformed.y -= (1.0 - cos(k * 0.9)) * 0.05; }`;

export default {
  id: 'surface', name: 'Surface Yard', origin: [0, 0, 0], viewRadius: 170,
  async build(ctx) {
    const { B, fx, rng } = ctx; const t0 = performance.now(); const R = makeRng(41);
    B.batch = new ShiftedStaticBatch(B.group, { cell: 120, cellY: 200, shift: [50, 4, 40] }); B.inst.cell = 64;     // the whole yard in ONE chunk per material: draw calls (not triangles) are the cost
    // ------------------------------------------------------------ materials (real-scale tiles, baked on the GPU)
    const dirt = B.m('dirt', custom(CINDER, [44, 0.2, 0.2, 0.5, 0.35], { colors: [0x2e2c29, 0x403d38, 0x1c1b19, 0x635e54], size: 1024, tile: 4, bump: 6, rough: [0.85, 1] }), { frag: groundFrag }); const macro = bakeGroundMacro(ctx.gfx, { half: 96, size: 1024 });
    const cinder = B.m('cinder', custom(CINDER, [60, 0.5, 0.05, 0.7, 0.2], { colors: [0x2b2824, 0x3d3833, 0x171513, 0x5c5448], size: 512, tile: 2, bump: 8, rough: [0.8, 1] }), { breakup: 0.6, wet: true });
    const steel = B.m('steel', { pattern: 'plates', size: 512, tile: 2, colors: [0x3f4c48, 0x2f3a37, 0x111614], rustColor: 0x5a3018, params: { cols: 2, rows: 2, seam: 0.012, rivets: 10, brushed: 0.2, panelVar: 0.5 }, bump: 3, metal: 1, rough: [0.4, 0.78], layers: { rust: 0.16, grime: 0.6, edge: 0.35, scratch: 0.3, streak: 0.6 } }, { breakup: 0.5 });
    const steelRaw = steelRawMat(B); const drumM = B.m('drum', { pattern: 'corrugated', size: 256, tile: 1, colors: [0x2f4a3a, 0x22382b], params: { ribs: 6, depth: 0.2, vertical: 0, dents: 1.5 }, bump: 6, metal: 1, rough: [0.35, 0.7], layers: { rust: 0.22, grime: 0.5, streak: 0.4, scratch: 0.4 }, rustColor: 0x522a16 });
    const brick = B.m('brick', { pattern: 'bricks', size: 512, tile: 2, colors: [0x6a382b, 0x532a21, 0x8c877a], params: { rows: 26, cols: 8, mortar: 0.006, variation: 0.7, chips: 0.6, moss: 0.0, soot: 0.6 }, bump: 5, rough: [0.8, 0.98], layers: { grime: 0.5, streak: 0.5 } }, { breakup: 0.6 });
    const corr = B.m('corr', { pattern: 'corrugated', size: 512, tile: 2, colors: [0x4f5754, 0x3c4341], rustColor: 0x4a2814, params: { ribs: 12, depth: 1, vertical: 1, dents: 1 }, bump: 26, metal: 1, rough: [0.45, 0.8], layers: { rust: 0.24, streak: 0.7, grime: 0.5 } }, { breakup: 0.5 });
    const timber = B.m('timber', custom(TIMBER, [0.5, 0.7, 0.45, 0.1, 0, 0.5, 8], { colors: [0x2a2620, 0x5c564c], size: 512, tile: 2, bump: 9, rough: [0.72, 0.97], layers: { grime: 0.45 } }));
    const beamWood = B.m('beamWood', custom(TIMBER, [0.45, 0.7, 0.45, 0.1, 0, 0.7, 1], { colors: [0x29241e, 0x574f43], size: 512, tile: 1.6, bump: 10, rough: [0.72, 0.97], layers: { grime: 0.45 } }));
    const concrete = B.m('concrete', { pattern: 'noise', size: 512, tile: 3, colors: [0x66655f, 0x53524d, 0x2c2b28, 0x85837a], params: { scale: 5, contrast: 3, fine: 96, speckle: 0.04, pores: 0.6, panels: 3, panelWidth: 0.003 }, bump: 3, rough: [0.8, 0.98], layers: { grime: 0.6, cracks: 0.5, streak: 0.5, moss: 0.1 } }, { breakup: 0.6, wet: true });
    const coal = B.m('coal', custom(COAL, [46, 0.35, 0.5], { colors: [0x0b0b0d, 0x151518, 0x232429, 0x4a4c58], size: 1024, tile: 4, bump: 26, rough: [0.55, 0.92] }), { triplanar: 1 / 4, breakup: 0.5 });
    const rockM = B.m('rock', { pattern: 'rock', size: 512, tile: 4, colors: [0x1c1b1a, 0x2b2927, 0x3c3935, 0x55514a], params: { scale: 5, strata: 3, cracks: 0.9, roughness: 0.85, tone: 0.45, moisture: 0.35 }, bump: 110, rough: [0.7, 0.98], layers: { moss: 0.12, grime: 0.3 } }, { triplanar: 1 / 4, breakup: 0.5 });
    const wheelMat = B.m('wheel', { pattern: 'plates', size: 256, tile: 1, colors: [0x2c2825, 0x262220], params: { cols: 1, rows: 1, seam: 0.0, rivets: 0, brushed: 0.9 }, bump: 1, metal: 1, rough: [0.5, 0.8], layers: { rust: 0.25 } });
    const rope = B.m('rope', std({ color: 0x1b1c1e, metalness: 0.9, roughness: 0.45, key: 'ropeS' })); const pole = B.m('pole', { pattern: 'wood', size: 256, tile: 1.5, colors: [0x4a3b2a, 0x261d14], params: { scale: 12, rings: 7, knots: 0.4, weather: 0.8, vertical: 0 }, bump: 4, rough: [0.8, 1], layers: { grime: 0.3 } });
    const lampGlow = B.m('lampGlow', std({ color: 0x000000, emissive: 0xffb060, emissiveIntensity: 12, roughness: 0.4, key: 'lamp' })); const puddleM = B.m('puddle', puddleWater(0x0c0a08));
    const wire = B.m('wire', std({ color: 0x555555, metalness: 1, roughness: 0.5, key: 'wire' })); const warn = B.m('warn', { pattern: 'hazard', size: 256, tile: 1, colors: [0xc9a020, 0x1a1a1a, 0x403830], params: { n: 6, angle: 0, wear: 0.7 }, bump: 1, rough: [0.5, 0.9] });
    const glassDark = B.m('glass', std({ color: 0x090c0f, roughness: 0.08, metalness: 0.2, key: 'glassDark' })); const rMat = B.m('rail', std({ color: 0x4a3226, metalness: 1, roughness: 0.5, key: 'rail' }));
    const brickFace = B.m('brickFace', { pattern: 'noise', size: 512, tile: 0.8, colors: [0x5c3a30, 0x482c25, 0x725649, 0x33231e], params: { scale: 14, contrast: 1.8, fine: 70, speckle: 0.12, pores: 0.5, panels: 0, panelWidth: 0 }, bump: 6, rough: [0.85, 0.98], layers: { grime: 0.75, streak: 0.65, dust: 0.3 } }, { breakup: 0.5 });
    const drumPaint = B.m('drumPaint', { pattern: 'plates', size: 512, tile: 1, colors: [0x2f4a3a, 0x22382b, 0x0c1410], rustColor: 0x522a16, params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.3 }, bump: 2, metal: 1, rough: [0.35, 0.75], layers: { rust: 0.3, grime: 0.55, streak: 0.4, scratch: 0.4 } }, { breakup: 0.5 });
    const bottleGlass = B.m('bottleGlass', std({ color: 0x24331f, roughness: 0.08, metalness: 0.1 })), hatMat = B.m('hatMat', std({ color: 0x7a5c14, roughness: 0.5 })), hoseMat = B.m('hoseMat', std({ color: 0x1a2028, roughness: 0.55 }));
    const halos = new HaloBatch(120); B.group.add(halos.mesh); const black = B.m('void', std({ color: 0x000000, roughness: 1, key: 'void' }));

    // ------------------------------------------------------------ ground + ridges (terrain), yard pads, dead trees on the ridge line
    { const IN = 64, OUT = 430, tm = (a, b, c, d, cell, chunk) => buildTerrain(B, { minX: a, maxX: b, minZ: c, maxZ: d, cell, chunk, heightFn: hills, mat: dirt, cast: false });
      tm(-IN, IN, -IN, IN, 1.6, 80); tm(-OUT, -IN, -OUT, OUT, 5, 90); tm(IN, OUT, -OUT, OUT, 5, 90); tm(-IN, IN, -OUT, -IN, 5, 90); tm(-IN, IN, IN, OUT, 5, 90);
      // far range: two coarse rings of big mountains (hazed to blue by the fog) so the horizon reads as layered ridges, not one smooth hump
      const far = (x, z) => { const r = Math.hypot(x, z); const e = sm(OUT - 6, OUT + 40, r); if (e <= 0) return hills(x, z) - 3; const m = fbm2(x * 0.0021 + 9.0, z * 0.0021 + 3.0, 4) * 2 - 0.5; const rg = 1 - Math.abs(noise2(x * 0.0042 - 5.0, z * 0.0042 + 1.0) * 2); return bench(hills(x, z) + e * (60 + 210 * Math.max(0, m) + 120 * rg * rg * sm(600, 1100, r)), 24, 0.5) - 3 * (1 - e); };
      const tf = (a, b, c, d) => buildTerrain(B, { minX: a, maxX: b, minZ: c, maxZ: d, cell: 32, chunk: 64, heightFn: far, mat: dirt, cast: false }); const FO = 1500, S0 = OUT - 6;
      tf(-FO, -S0, -FO, FO); tf(S0, FO, -FO, FO); tf(-S0, S0, -FO, -S0); tf(-S0, S0, S0, FO); }
    for (let i = 0; i < 40; i++) { const a = R() * TAU, d = 62 + R() * 150; const x = Math.cos(a) * d, z = Math.sin(a) * d; const y = hills(x, z); const h = 4 + R() * 6; B.tube({ pts: [[x, y, z], [x + (R() - 0.5), y + h * 0.5, z + (R() - 0.5)], [x + (R() - 0.5) * 1.6, y + h, z + (R() - 0.5) * 1.6]], r: 0.11, mat: pole, seg: 5, segs: 8, cast: false }); for (let k = 0; k < 4; k++) cylBetween(B, [x, y + h * (0.4 + k * 0.15), z], [x + (R() - 0.5) * 3, y + h * (0.55 + k * 0.15), z + (R() - 0.5) * 3], 0.03, pole, { seg: 4, cast: false }); }
    { const PB = new Parts(B, R), gB = PB.of(rockM, false); for (let i = 0; i < 300; i++) { const a = R() * TAU, d = 74 + Math.pow(R(), 0.8) * 230, x = Math.cos(a) * d, z = Math.sin(a) * d, s = 0.7 + Math.pow(R(), 3.0) * 6.5; gB.rock(x, hills(x, z) + s * 0.05, z, s, R, { cuts: 6, jit: 0.3, squash: [1 + R() * 0.6, 0.6 + R() * 0.5, 1 + R() * 0.5], tilt: 0.5 }); } PB.flush(); }

    // ------------------------------------------------------------ SHAFT COLLAR: slab with the cage opening, timber-lined stub below, landing gates
    const CX = SHAFT.hx + 0.3, CZ = SHAFT.hz + 0.3;                     // outer face of the lining
    const slab = (x0, x1, z0, z1) => B.box({ p: [(x0 + x1) / 2, -0.5, (z0 + z1) / 2], s: [x1 - x0, 0.5, z1 - z0], mat: concrete, bevel: 0.02, col: 'concrete' });
    slab(-6.5, 6.5, CZ, 7.5); slab(-6.5, 6.5, -7.5, -CZ); slab(-6.5, -CX, -CZ, CZ); slab(CX, 6.5, -CZ, CZ);
    for (const s2 of [-1, 1]) B.box({ p: [s2 * (CX + 0.35), 0, 0], s: [0.5, 0.02, 2 * CZ + 1.0], mat: warn, bevel: 0, cast: false }); B.box({ p: [0, 0, CZ + 0.3], s: [2 * CX + 1.2, 0.02, 0.5], mat: warn, bevel: 0, cast: false });
    const sm2 = shaftMats(B, 'timber'); shaftLining(B, sm2, { y0: -8, y1: 0, style: 'timber', front: [], collide: true, seed: 1 });
    B.box({ p: [0, -20, 0], s: [CX * 2 - 0.4, 12, CZ * 2 - 0.4], mat: black, col: false, cast: false });
    const landing = buildLanding(ctx, B, { frame: concrete, steel: steelRaw, mesh: meshMaterial({ kind: 'diamond', cell: 0.06, wire: 3.4, tile: 0.48 }), plate: steel }, { style: 'steel' });
    // banksman's bell post + sign, guard chains along the collar sides
    B.box({ p: [3.9, 0, 3.6], s: [0.16, 2.4, 0.16], mat: pole, bevel: 0.01, col: 'wood' }); B.box({ p: [3.9, 2.35, 3.6], s: [0.9, 0.08, 0.1], mat: pole, cast: false }); B.cyl({ p: [4.2, 2.0, 3.6], r: [0.16, 0.05], h: 0.28, seg: 12, mat: B.m('brassS', std({ color: 0xa88235, metalness: 1, roughness: 0.35, key: 'brassS' })), cast: true });
    for (const x of [-5.05, -3.55]) B.box({ p: [x, 0, 3.6], s: [0.12, 2.1, 0.12], mat: pole, bevel: 0.01, col: 'wood' }); signQuad(B, signMaterial({ lines: ['DANGER', 'KEEP CLEAR OF CAGE'], bg: '#b8231b', fg: '#f4f0e6', weather: 0.8 }), [-4.3, 1.5, 3.65], 1.4, 0.8, 0);
    for (const s of [-1, 1]) handrail(B, warn, [s * 5.6, 0, CZ + 0.3], [s * 5.6, 0, 7.0], { posts: 1.6 });

    // ------------------------------------------------------------ HEADFRAME (34 m): real steel lattice (laced corner-angle legs, I-beam rings with gussets, X bracing with turnbuckles, grating decks, caged ladder, sheave deck, A-frames)
    const tm = (l) => console.log('[surface t]', l, (performance.now() - t0) | 0, 'ms, tris', PT.tris); const PT = new Parts(B, R); const PM = { steelRaw, steel, timber, beamWood, post: beamWood, board: timber, corr, concrete, glass: glassDark, coal, brick: brickFace, iron: steelRaw };
    const legBase = [[-5.2, -4.6], [5.2, -4.6], [5.2, 4.6], [-5.2, 4.6]], H = 32, top = 1.7;
    const atL = (i, h) => { const t = h / H; return [legBase[i][0] + (Math.sign(legBase[i][0]) * top - legBase[i][0]) * t, h, legBase[i][1] + (Math.sign(legBase[i][1]) * top - legBase[i][1]) * t]; };
    const levels = [0, 6, 12, 17.5, 22.5, 27, 32];
    for (let i = 0; i < 4; i++) { B.box({ p: [legBase[i][0], 0, legBase[i][1]], s: [1.4, 0.5, 1.4], mat: concrete, col: 'concrete' }); B.colliders.addCyl({ x: legBase[i][0], z: legBase[i][1], r: 0.5, y0: 0, y1: 5, surface: 'metal', walk: false }); }
    tm('pre'); headframe(PT, PM, { legBase, H, top, levels, atL }); tm('headframe');
    const sheaves = new THREE.Group(); sheaves.position.set(0, H + 2.3, -2.6); B.group.add(sheaves);
    { const sg = geoToBuffer(sheaveGeo()); for (const sx of [-0.75, 0.75]) { const w = new THREE.Group(); w.position.x = sx; const m = new THREE.Mesh(sg, visVariant(wheelMat)); m.castShadow = true; m.receiveShadow = true; w.add(m); sheaves.add(w); }
      const half = []; for (let k = 0; k <= 24; k++) { const th = k / 24 * PI; half.push([Math.cos(th) * 2.5 - 2.6 + 2.6, 0, 0]); }
      for (const sx of [-0.75, 0.75]) { const arc = []; for (let k = 0; k <= 30; k++) { const th = k / 30 * PI; arc.push([sx, H + 2.3 + Math.sin(th) * 2.5, -2.6 + Math.cos(th) * 2.5]); } wireRope(PT, rope, arc, 0.03, 0.38);
        const p0 = [sx, H + 2.3, -5.1], p1 = [sx, H * 0.55, -12], p2 = [sx, 4.6, -19.2], pts = []; for (let k = 0; k <= 40; k++) { const t = k / 40, u = 1 - t; pts.push([sx, u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1], u * u * p0[2] + 2 * u * t * p1[2] + t * t * p2[2]]); } wireRope(PT, rope, pts, 0.032, 0.38); } }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), B.m('beaconMat', std({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 8, key: 'beacon' }))); beacon.position.set(0, H + 5.1, -2.6); B.group.add(beacon); halos.add([0, H + 5.1, -2.6], 0xff2a10, 1.6, 1.4, 2.4);
    const flood = ctx.light({ pos: [0, 21, 4.8], color: 0xfff0d0, intensity: 240, distance: 42, decay: 2, kind: 'spot', dir: [0, -0.86, -0.36], angle: 0.42, penumbra: 0.6, flicker: 0.01 });
    const floodBeam = makeBeam({ length: 24, r0: 0.15, r1: 6.0, color: 0xfff0d0, intensity: 0.035, dust: 1 }); floodBeam.position.set(0, 21, 4.8); floodBeam.lookAt(0, 0, 0); B.group.add(floodBeam); B.box({ p: [0, 20.6, 4.9], s: [0.6, 0.35, 0.4], mat: steelRaw, cast: false });

    // ------------------------------------------------------------ ENGINE HOUSE (brick, hollow): front wall with door, two barricade openings, boarded windows; interior with winding drum + firebox glow
    const EZ = -19, EW = 16, ED = 10, EH = 7, T = 0.55, FZ = EZ + ED / 2;      // front face z = -14
    const holes = [{ x0: -1.7, x1: 1.7, y0: 0, y1: 3.8 }, { x0: -4.35, x1: -2.85, y0: 0, y1: 1.9 }, { x0: 2.85, x1: 4.35, y0: 0, y1: 1.9 }, { x0: -6.5, x1: -5.3, y0: 1.3, y1: 3.9 }, { x0: 5.3, x1: 6.5, y0: 1.3, y1: 3.9 }];
    wallHoles(B, concrete, { p: [0, 0, FZ - T / 2], w: EW, h: EH, t: T, holes, col: 'brick' }); brickWall(PT, brickFace, { p: [0, 0, FZ - T / 2], yaw: 0, w: EW, h: EH, holes, face: 1, t: T, seed: 3 });
    wallHoles(B, brick, { p: [0, 0, EZ - ED / 2 + T / 2], w: EW, h: EH, t: T, holes: [{ x0: -1.6, x1: 1.6, y0: 0, y1: 3.4 }], col: 'brick' });
    for (const s of [-1, 1]) { const sh = [{ x0: -3.4, x1: -1.7, y0: 1.3, y1: 3.6 }]; wallHoles(B, concrete, { p: [s * (EW / 2 - T / 2), 0, EZ], yaw: PI / 2, w: ED - 2 * T, h: EH, t: T, holes: sh, col: 'brick' }); brickWall(PT, brickFace, { p: [s * (EW / 2 - T / 2), 0, EZ], yaw: PI / 2, w: ED - 2 * T, h: EH, holes: sh, face: s, t: T, cornice: false }); }
    B.box({ p: [0, -0.12, EZ], s: [EW - 2 * T, 0.12, ED - 2 * T], mat: concrete, bevel: 0.01, col: 'concrete', cast: false });
    B.box({ p: [0, 0, FZ + 0.15], s: [EW + 0.6, 0.5, 0.4], mat: concrete, bevel: 0.03, cast: false });
    gableRoof(PT, PM, { p: [0, 0, EZ], w: EW, d: ED, rise: 2.81, overhang: 0.7, y0: EH }); B.colliders.addBox({ x: 0, y: EH + 2.1, z: EZ, hx: EW / 2 + 0.7, hy: 0.15, hz: ED / 2 + 0.7, surface: 'metal', walk: false });   // roof occluder for the sky-visibility bake; its underside (9.0 m) stays above wall tops + agent height, so nav probes on the lintels are not blocked
    { const my = EH + 2.85; for (const [x, z] of [[-1.4, -1.0], [1.4, -1.0], [-1.4, 1.0], [1.4, 1.0]]) hewn(PT, beamWood, [x, my, EZ + z], [x, my + 1.3, EZ + z], 0.12, 0.12, { bow: 0.004, chamfer: 0.01 }); for (const sz of [-1, 1]) for (let k = 0; k < 6; k++) hewn(PT, timber, [-1.5, my + 0.15 + k * 0.2, EZ + sz * 1.06], [1.5, my + 0.15 + k * 0.2 + 0.05, EZ + sz * 1.08], 0.19, 0.02, { bow: 0.004, chamfer: 0.002, taper: 0, up: [0, 0.5, sz] }); hewn(PT, beamWood, [-1.7, my + 1.34, EZ - 1.1], [1.7, my + 1.34, EZ - 1.1], 0.16, 0.14, { bow: 0.004, chamfer: 0.01, up: [0, 1, 0] }); hewn(PT, beamWood, [-1.7, my + 1.34, EZ + 1.1], [1.7, my + 1.34, EZ + 1.1], 0.16, 0.14, { bow: 0.004, chamfer: 0.01, up: [0, 1, 0] }); gableRoof(PT, PM, { p: [0, 0, EZ], w: 3.4, d: 2.2, rise: 0.75, overhang: 0.25, y0: my + 1.4, trussEvery: 1.7 }); }
    tm('engine walls+roof');
    // double door, four window frames with glazing bars + broken panes / boards (real openings in the brick), side windows
    doubleDoor(PT, PM, { p: [0, 0, FZ], yaw: 0, w: 3.4, h: 3.8, recess: 0.22 });
    for (const wx of [-5.9, 5.9]) windowFrame(PT, PM, { p: [wx, 2.6, FZ], yaw: 0, w: 1.2, h: 2.6, recess: 0.2 });
    for (const s of [-1, 1]) windowFrame(PT, PM, { p: [s * EW / 2, 2.45, EZ + 2.55], yaw: s * PI / 2, w: 1.7, h: 2.3, recess: 0.2 });
    // interior (seen through the openings): winding drum, flywheel, boiler, firebox glow
    B.cyl({ p: [0, 1.0, EZ - 1.2], r: 1.7, h: 3.0, seg: 24, mat: steel, roll: PI / 2, anchor: 'center' }); B.cyl({ p: [-2.1, 1.0, EZ - 1.2], r: 2.6, h: 0.3, seg: 28, mat: steel, roll: PI / 2, anchor: 'center', cast: true }); B.box({ p: [3.5, 0, EZ - 3.4], s: [5.2, 2.6, 2.2], mat: drumM, bevel: 0.05, col: 'metal' }); B.box({ p: [-5.4, 0, EZ - 3.2], s: [4.0, 2.2, 2.6], mat: steel, bevel: 0.05, col: 'metal' });
    B.sphere({ p: [3.5, 1.4, EZ - 2.28], r: 0.3, seg: 10, mat: B.m('fireGlow', std({ color: 0x000000, emissive: 0xff5010, emissiveIntensity: 7, key: 'fireGlow' })), cast: false }); halos.add([3.5, 1.4, EZ - 2.1], 0xff6020, 1.6, 0.6, 5); const fire = ctx.light({ pos: [3.5, 1.4, EZ - 1.6], color: 0xff6a24, intensity: 6, distance: 9, decay: 2, flicker: 0.4, flickerSpeed: 9, kind: 'point' });
    B.box({ p: [EW / 2 - 0.4, 0, FZ - 0.4], s: [0.28, EH + 3.2, 0.28], mat: steelRaw, cast: false });
    // chimney + flue
    chimney(PT, brickFace, steelRaw, { x: 9.6, z: EZ - 2.5, r0: 1.5, r1: 0.85, h: 27 }); B.colliders.addCyl({ x: 9.6, z: EZ - 2.5, r: 1.4, y0: 0, y1: 27, surface: 'brick', walk: false });
    B.cyl({ p: [6.2, EH - 0.6, EZ - 2.5], r: 0.55, h: 6.4, seg: 14, mat: steelRaw, roll: PI / 2, anchor: 'center', cast: true }); B.box({ p: [-7.4, 0, EZ + 6.0], s: [3, 3.2, 3.4], mat: corr, bevel: 0.03, col: 'metal' }); B.prism({ p: [-7.4, 3.2, EZ + 6.0], s: [3.6, 1.1, 3.8], mat: corr });
    signQuad(B, signMaterial({ lines: ['ENGINE HOUSE No.9'], bg: '#20241f', fg: '#d8c890', w: 1024, h: 192, weather: 1, border: true }), [0, 4.9, FZ + 0.06], 5.4, 0.9, 0);

    tm('engine house done');
    // ------------------------------------------------------------ RAILS + ORE CARTS
    const gravel = B.m('ballast', custom(CINDER, [70, 0.0, 0.0, 0.2, 0.0], { colors: [0x4d4b47, 0x6b6861, 0x2c2b29, 0x9a968a], size: 512, tile: 1.5, bump: 14, rough: [0.85, 1] }), { breakup: 0.5 });
    const railM = { sleeper: beamWood, rail: rMat, ballast: gravel };
    railLine(B, railM, [-38, 0, 9], [30, 0, 9], { gauge: 0.61, ballast: true }); railLine(B, railM, [22, 0, 9], [22, 0, 22], { gauge: 0.61, ballast: true, seed: 4 });
    const tubM = { tub: drumM, rim: steelRaw, wheel: wheelMat, coal, ore: coal }; tub(B, tubM, { p: [-20, 0, 9], yaw: 0, load: 'coal', seed: 1 }); tub(B, tubM, { p: [-18.4, 0, 9], yaw: 0, load: 'coal', seed: 2 }); tub(B, tubM, { p: [8, 0, 9], yaw: 0.02, load: null, seed: 3 });
    B.box({ p: [-38.6, 0, 9], s: [0.5, 0.6, 1.4], mat: steel, col: 'metal' }); B.box({ p: [30.6, 0, 9], s: [0.5, 0.6, 1.4], mat: steel, col: 'metal' });
    B.box({ p: [21.0, 0.32, 16.0], s: [1.25, 0.7, 0.62], mat: drumM, yaw: 0.6, roll: PI / 2 + 0.2, col: 'metal', bevel: 0.03 });

    // ------------------------------------------------------------ COAL HEAPS + hopper + ore bin with chute
    heap(PT, coal, { c: [25, 0.2, 16], rx: 8.1, rz: 6.5, ry: 3.6, n: 520, size: 0.5 }); heap(PT, coal, { c: [31, 0.2, 21], rx: 4.2, rz: 4.2, ry: 2.2, n: 200, size: 0.42 }); heap(PT, coal, { c: [-30, 0.1, -20], rx: 6.6, rz: 5.5, ry: 2.7, n: 300, size: 0.45 });
    B.rock({ p: [25, 0.2, 16], r: 6.5, squash: [1.25, 0.58, 1.0], amp: 0.6, freq: 2.2, seed: 11, detail: 5, mat: coal, col: 'rock' }); B.rock({ p: [31, 0.2, 21], r: 4.2, squash: [1.0, 0.55, 1.0], amp: 0.6, freq: 2.4, seed: 5, detail: 5, mat: coal, col: 'rock' }); B.rock({ p: [-30, 0.1, -20], r: 5.5, squash: [1.2, 0.5, 1.0], amp: 0.6, freq: 2.2, seed: 14, detail: 5, mat: coal, col: 'rock' });
    for (const [x, z] of [[-2.2, -2.0], [2.2, -2.0], [-2.2, 2.0], [2.2, 2.0]]) B.cyl({ p: [16 + x, 0, 2 + z], r: 0.13, h: 4.6, seg: 8, mat: steel, col: 'metal' });
    B.cyl({ p: [16, 3.2, 2], r: [2.8, 0.5], h: 2.4, seg: 20, mat: steel, col: false }); B.cyl({ p: [16, 5.6, 2], r: [2.85, 2.85], h: 0.3, seg: 20, mat: steel, col: false });
    for (const [x, z] of [[-2.2, -2.0], [2.2, -2.0], [-2.2, 2.0], [2.2, 2.0]]) B.beam([16 + x, 1.2, 2 + z], [16 - x, 3.6, 2 - z], 0.09, 0.09, { mat: steelRaw });
    B.box({ p: [16, 2.0, 2], s: [0.7, 1.4, 0.7], mat: steel, cast: true, col: false }); B.cyl({ p: [16, 3.0, 2], r: 0.28, h: 1.2, seg: 10, mat: steel, cast: false });
    // screening bin: timber hopper on legs over the track at x=-8 with a chute
    for (const [x, z] of [[-9.6, 6.6], [-6.4, 6.6], [-9.6, 11.4], [-6.4, 11.4]]) { B.beam([x, 0, z], [x, 3.6, z], 0.3, 0.3, { mat: beamWood }); B.colliders.addBox({ x, y: 1.8, z, hx: 0.17, hy: 1.8, hz: 0.17, surface: 'wood', walk: false }); }
    B.box({ p: [-8, 3.5, 9], s: [4.4, 0.3, 6.2], mat: timber, bevel: 0.02, cast: true }); for (const [x, z, sx, sz] of [[-8, 5.9, 4.4, 0.16], [-8, 12.1, 4.4, 0.16], [-10.2, 9, 0.16, 6.2], [-5.8, 9, 0.16, 6.2]]) B.box({ p: [x, 3.6, z], s: [sx, 1.3, sz], mat: timber, bevel: 0.02, cast: true }); B.beam([-8, 3.4, 9.6], [-8, 2.4, 9.0], 0.9, 0.9, { mat: timber }); for (let i = 0; i < 6; i++) B.rock({ p: [-8 + (R() - 0.5) * 3, 4.75 + R() * 0.2, 9 + (R() - 0.5) * 4.5], r: 0.4 + R() * 0.3, squash: [1.3, 0.7, 1.1], amp: 0.5, seed: 50 + i, detail: 1, mat: coal });

    // ------------------------------------------------------------ TIMBER YARD (SW): log stacks + sawn stacks, a-frame rack
    const logGeo = new THREE.CylinderGeometry(0.19, 0.2, 4.6, 10); logGeo.rotateZ(PI / 2); const logMat = B.m('log', { pattern: 'bark', size: 256, tile: 1, colors: [0x3a2b1e, 0x5b4632, 0x1f160e], params: { scale: 6, depth: 1, moss: 0.2 }, bump: 14, rough: [0.85, 1], layers: { grime: 0.3 } });
    for (const [sx, sz, yaw] of [[-27, 15, 0.08], [-27, 19.5, -0.05], [-20, 21, 0.4]]) { const sn = Math.sin(yaw), cs = Math.cos(yaw); for (let layer = 0; layer < 5; layer++) { const n = 6 - layer; for (let i = 0; i < n; i++) { const lx = (i - (n - 1) / 2) * 0.4, ly = 0.2 + layer * 0.35; B.cyl({ p: [sx + lx * sn, ly, sz + lx * cs], r: 0.2, h: 4.6, seg: 10, mat: logMat, roll: PI / 2, yaw: yaw, anchor: 'center', cast: true }); } } B.box({ p: [sx, 0, sz], s: [4.7, 1.9, 2.4], yaw, mat: logMat, col: 'wood', cast: false, bevel: 0.05 }); }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) B.box({ p: [-20 + i * 0.45 - 0.7, j * 0.11, -0.8], s: [0.4, 0.11, 3.6], mat: timber, bevel: 0.006, cast: false }); B.box({ p: [-19.8, 0, 2.4], s: [2.2, 0.5, 3.6], mat: timber, col: 'wood', bevel: 0.01 });
    for (const z of [-1, 1]) B.beam([-33, 0, 12 + z * 3], [-33, 2.2, 12 + z * 3], 0.2, 0.2, { mat: beamWood }); B.beam([-33, 2.2, 9], [-33, 2.2, 15], 0.2, 0.2, { mat: beamWood });

    tm('yard props 1');
    // ------------------------------------------------------------ TOOL SHED + WATER TOWER
    shed(PT, PM, { p: [-27, 0, -8], w: 8, d: 4.6, h: 3.2 }); B.colliders.addBox({ x: -27, y: 1.6, z: -8, hx: 4, hy: 1.6, hz: 2.3, surface: 'metal', walk: false }); B.colliders.addBox({ x: -27, y: 3.4, z: -8, hx: 4.3, hy: 0.15, hz: 2.6, surface: 'metal', walk: false });
    waterTower(PT, PM, { x: 31, z: -12 }); for (let i = 0; i < 6; i++) { const a = i / 6 * 2 * PI + PI / 6; B.colliders.addCyl({ x: 31 + Math.cos(a) * 2.9, z: -12 + Math.sin(a) * 2.9, r: 0.22, y0: 0, y1: 6, surface: 'metal', walk: false }); } cagedLadder(PT, PM, [34.3, 0, -12], 9.7, -PI / 2); B.box({ p: [31, 0, -12], s: [6.2, 0.2, 6.2], mat: concrete, col: false, cast: false });



    // ------------------------------------------------------------ MINE ADIT (west): rock face with timbered portal
    B.rock({ p: [-48, 4, -2], r: 14, squash: [1.2, 0.9, 1.6], amp: 0.75, freq: 1.9, seed: 3, detail: 5, mat: rockM }); B.rock({ p: [-47, 3, 10], r: 10, squash: [1.1, 0.8, 1.2], amp: 0.75, freq: 2.0, seed: 8, detail: 5, mat: rockM }); B.rock({ p: [-47, 3, -14], r: 11, squash: [1.1, 0.8, 1.1], amp: 0.75, freq: 2.0, seed: 21, detail: 5, mat: rockM });
    for (const [z0, z1] of [[-24, -1.95], [1.95, 22]]) B.colliders.addBox({ x: -45, y: 3, z: (z0 + z1) / 2, hx: 8, hy: 3.5, hz: (z1 - z0) / 2, surface: 'rock', walk: false }); B.colliders.addBox({ x: -54, y: 3, z: 0, hx: 1, hy: 3.5, hz: 2, surface: 'rock', walk: false });   // mound colliders leave the adit corridor open
    for (const z of [-1.9, 1.9]) B.box({ p: [-38.8, 0, z], s: [0.45, 3.2, 0.45], mat: beamWood, col: 'wood', bevel: 0.02 }); B.box({ p: [-38.8, 3.05, 0], s: [0.5, 0.45, 4.6], mat: beamWood, col: false, bevel: 0.02 }); B.box({ p: [-43.0, 0, 0], s: [9.0, 3.0, 3.6], mat: black, col: false, cast: false });
    railLine(B, railM, [-38.8, 0, 0], [-30, 0, 0], { gauge: 0.61, ballast: false, seed: 6 }); signQuad(B, signMaterial({ lines: ['ADIT No.9', 'NO ENTRY'], bg: '#c9a227', fg: '#181818', w: 512, h: 256, weather: 0.8 }), [-38.55, 2.4, 0], 2.6, 0.7, -PI / 2);

    // ------------------------------------------------------------ PERIMETER FENCE with gates + barbed wire
    const picketTex = canvasTexture(256, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h); const cols = ['#4b463f', '#575044', '#413d37', '#4f473b']; g.fillStyle = '#2f2b26'; for (const y of [0.22, 0.72]) g.fillRect(0, h * y, w, h * 0.06);      // the two rails (visible through the gaps)
      for (let i = 0; i < 4; i++) { const x = i * 64 + 8, top = 14 + ((i * 7) % 3) * 8; g.fillStyle = cols[i]; g.beginPath(); g.moveTo(x, h); g.lineTo(x, top + 22); g.lineTo(x + 24, top); g.lineTo(x + 48, top + 22); g.lineTo(x + 48, h); g.closePath(); g.fill();
        g.fillStyle = 'rgba(20,16,12,0.35)'; for (let k = 0; k < 7; k++) g.fillRect(x + 4 + Math.random() * 40, top + 30 + Math.random() * (h - top - 40), 1.5, 20 + Math.random() * 90); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 42, top + 22, 6, h); }
    }); picketTex.wrapS = THREE.RepeatWrapping; picketTex.wrapT = THREE.ClampToEdgeWrapping; picketTex.anisotropy = 8;
    const picketM = B.m('picket', std({ map: picketTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 }));
    const fenceLine = (B, a, b, o) => { const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, H = 1.9, nx = -uz, nz = ux; const n = Math.max(1, Math.round(L / 3.2));
      fenceRun(PT, PM, a, b);
      const raw = { p: new Float32Array([a[0], 0.05, a[2], b[0], 0.05, b[2], b[0], H, b[2], a[0], H, a[2]]), n: new Float32Array([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz]), u: new Float32Array([0, 0, L / 0.64, 0, L / 0.64, 1, 0, 1]), i: new Uint32Array([0, 1, 2, 0, 2, 3]) };
      B.addRaw(raw, new THREE.Matrix4(), picketM, { cast: true }); B.colliders.addBox({ x: (a[0] + b[0]) / 2, y: H / 2, z: (a[2] + b[2]) / 2, hx: L / 2, hy: H / 2, hz: 0.07, yaw: Math.atan2(-dz, dx), surface: 'wood', walk: false }); };
    const F = { x0: -40, x1: 40, z0: -32, z1: 32 }; const fenceWood = B.m('fenceWood', custom(TIMBER, [0.5, 0.7, 0.5, 0.15, 0, 0.5, 8], { colors: [0x221f1b, 0x4d473f], size: 512, tile: 2, bump: 9, rough: [0.75, 0.98], layers: { grime: 0.45 } })); const fo = { postMat: pole, panelMat: fenceWood, wire: 3, wireMat: wire, height: 2.0 };
    fenceLine(B, [F.x0, 0, F.z0], [-14, 0, F.z0], fo); fenceLine(B, [-2, 0, F.z0], [F.x1, 0, F.z0], fo); fenceLine(B, [F.x1, 0, F.z0], [F.x1, 0, -4], fo); fenceLine(B, [F.x1, 0, 6], [F.x1, 0, F.z1], fo); fenceLine(B, [F.x1, 0, F.z1], [8, 0, F.z1], fo); fenceLine(B, [-4, 0, F.z1], [F.x0, 0, F.z1], fo); fenceLine(B, [F.x0, 0, F.z1], [F.x0, 0, 6], fo); fenceLine(B, [F.x0, 0, -6], [F.x0, 0, F.z0], fo);
    for (const [x, z] of [[-14, F.z0], [-2, F.z0], [F.x1, -4], [F.x1, 6], [8, F.z1], [-4, F.z1]]) B.box({ p: [x, 0, z], s: [0.32, 3.0, 0.32], mat: beamWood, col: 'wood', bevel: 0.02 });
    B.box({ p: [-8, 2.9, F.z0], s: [12.2, 0.3, 0.3], mat: beamWood, col: false }); signQuad(B, signMaterial({ lines: ['SHAFT No.9', 'COLLIERY  •  EST. 1911'], bg: '#3b2f22', fg: '#e8d8b0', w: 1024, h: 256, weather: 0.9, border: true }), [-8, 2.05, F.z0 + 0.17], 12.0, 1.0, 0); signQuad(B, signMaterial({ lines: ['SHAFT No.9', 'COLLIERY  •  EST. 1911'], bg: '#3b2f22', fg: '#e8d8b0', w: 1024, h: 256, weather: 0.9, border: true }), [-8, 2.05, F.z0 - 0.17], 12.0, 1.0, PI);

    // ------------------------------------------------------------ LAMPS (pooled real lights + halos) + fire barrel
    const lampPts = [[-12, 0, 12], [12, 0, 12], [-14, 0, -8], [14, 0, -8], [0, 0, 22], [-28, 0, 4], [28, 0, 4], [0, 0, -30]];
    for (const p of lampPts) { const bulb = lampPole(PT, PM, p, { height: 5.2, dir: [-p[0], 0, -p[2]], matShade: steel, matGlass: lampGlow }); ctx.light({ pos: bulb, color: 0xffb468, intensity: 18, distance: 24, decay: 2, flicker: 0.03, kind: 'point' }); halos.add(bulb, 0xffb468, 0.9, 1.0, 6); B.colliders.addCyl({ x: p[0], z: p[2], r: 0.15, y0: 0, y1: 5.2, surface: 'wood', walk: false }); }
    drumP(PT, drumPaint, black, [-21.5, 0, -1.5], { yaw: 0.4 }); B.colliders.addCyl({ x: -21.5, z: -1.5, r: 0.3, y0: 0, y1: 0.87, surface: 'metal', walk: true }); const fireLight = ctx.light({ pos: [-21.5, 1.3, -1.5], color: 0xff7a30, intensity: 8, distance: 14, decay: 2, flicker: 0.35, flickerSpeed: 11, kind: 'point' }); halos.add([-21.5, 1.05, -1.5], 0xff8a3a, 1.1, 1.0, 9);

    // ------------------------------------------------------------ PROPS: drums, crates, pallets, cable drums, generator, notice board, puddles, gravel
    for (const [x, z] of [[-10, -12.5], [-9.4, -12.4], [-10.2, -11.8], [12, -12.6], [11.3, -12.7], [20, -5], [34, 12]]) { drumP(PT, drumPaint, black, [x, 0, z], { yaw: R() * 6.28, dent: 0.012 }); B.colliders.addCyl({ x, z, r: 0.3, y0: 0, y1: 0.87, surface: 'metal', walk: true }); } drumP(PT, drumPaint, black, [-12.4, 0, -12.9], { tilt: 1.5, yaw: 0.5 });
    for (const [x, z, s] of [[-13.5, -12.2, [0.9, 0.8, 0.9]], [-13.4, -12.2, [0.7, 0.6, 0.7]], [15, -12.2, [1, 0.9, 1]], [-4, 14, [0.8, 0.7, 0.8]], [3.5, 15.2, [1.1, 0.8, 0.8]], [-16, 12.8, [0.9, 0.9, 0.9]]]) { const yw = R.range(-0.4, 0.4); crateP(PT, timber, steelRaw, [x, 0, z], s, yw); B.colliders.addBox({ x, y: s[1] / 2, z, hx: s[0] / 2, hy: s[1] / 2, hz: s[2] / 2, yaw: yw, surface: 'wood', walk: true }); }
    crateP(PT, timber, steelRaw, [-13.4, 0.8, -12.2], [0.7, 0.6, 0.7], 0.3); for (const [px, pz, py] of [[6, 16, 0.2], [7.4, 16.6, -0.15], [-8, 20, 0.1]]) palletP(PT, PM, [px, 0, pz], py);
    for (const [x, z, yw] of [[14, 12, 0.3], [16, 12.9, -0.4]]) { spoolP(PT, beamWood, black, [x, 0.55, z], { r: 0.55, w: 0.5, yaw: yw }); B.colliders.addCyl({ x, z, r: 0.5, y0: 0, y1: 1.05, surface: 'wood', walk: true }); } coilP(PT, black, [12.6, 0, 13.9], 0.3, 0.024, 5, 0.2); coilP(PT, hoseMat, [-11.0, 0, 15.5], 0.35, 0.03, 4, 1.1);
    B.box({ p: [36, 0, -8], s: [2.2, 1.5, 1.2], mat: corr, bevel: 0.03, col: 'metal' }); B.box({ p: [36, 1.5, -8], s: [2.4, 0.08, 1.4], mat: steel, cast: false }); B.cyl({ p: [36.8, 1.5, -7.6], r: 0.06, h: 0.9, seg: 8, mat: steelRaw, cast: false });
    B.box({ p: [24, 0, -26], s: [0.16, 2.0, 0.16], mat: pole, col: 'wood' }); B.box({ p: [21, 0, -26], s: [0.16, 2.0, 0.16], mat: pole, col: 'wood' }); B.box({ p: [22.5, 1.0, -26], s: [3.4, 1.3, 0.06], mat: timber, cast: true }); signQuad(B, signMaterial({ lines: ['NOTICE', 'SHIFT ROSTER'], bg: '#e9dfc4', fg: '#231d16', w: 512, h: 256, weather: 0.9, border: false }), [22.5, 1.6, -25.96], 1.2, 0.6, 0);
    for (let i = 0; i < 16; i++) { const x = R.range(-34, 34), z = R.range(-28, 28); if (Math.hypot(x, z) < 6) continue; const s = R.range(0.5, 1.8); signQuad(B, puddleM, [x, 0.014, z], s * 1.8, s * 1.2, R.range(0, PI), { pitch: -PI / 2 }); }
    for (let i = 0; i < 90; i++) { const x = R.range(-36, 36), z = R.range(-28, 28); if (Math.hypot(x, z) < 5) continue; B.rock({ p: [x, 0.03, z], r: R.range(0.06, 0.2), squash: [1, 0.55, 1], amp: 0.4, seed: 100 + i, detail: 1, mat: rockM, cast: false }); }
    B.cyl({ p: [12, 0, -8], r: [0.16, 0.11], h: 9.2, seg: 10, mat: pole, col: 'wood' }); B.beam([10.8, 8.6, -8], [13.2, 8.6, -8], 0.1, 0.12, { mat: beamWood }); B.cyl({ p: [12.35, 6.9, -8.0], r: 0.27, h: 0.8, seg: 12, mat: steelRaw, cast: true });
    B.cable([11, 8.6, -8], [4, 6.4, FZ], 0.5, 0.012, wire, { n: 12 }); B.cable([13.2, 8.6, -8], [10.6, 6.4, FZ], 0.4, 0.012, wire, { n: 12 });


    // ------------------------------------------------------------ MORE DRESSING: pit-prop piles, tarp heaps, flatbed truck, fuel tank, scaffolding, weighbridge, cable spools, hoses, skips
    const tarp = B.m('tarp', { pattern: 'weave', size: 256, tile: 0.6, colors: [0x2e4a52, 0x243c44], params: { threads: 48, twill: 0, variation: 0.5, fuzz: 0.5 }, bump: 2, rough: [0.7, 0.95], layers: { grime: 0.6, dust: 0.3, streak: 0.4 } }); 
    for (const [x, z, yaw, n] of [[12, 22, 0.2, 5], [-4, 26, -0.1, 4], [30, 6, 0.5, 4]]) for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) B.cyl({ p: [x + Math.sin(yaw) * (j - (n - i - 1) / 2) * 0.4, 0.2 + i * 0.34, z + Math.cos(yaw) * (j - (n - i - 1) / 2) * 0.4], r: 0.2, h: 3.2, seg: 10, mat: logMat, roll: PI / 2, yaw: yaw, anchor: 'center', cast: true });
    for (const [x, z, sx, sz, h] of [[6, -24, 3.6, 2.6, 1.3], [-8, -22, 2.8, 2.2, 1.0]]) { B.rock({ p: [x, 0, z], r: 1.0, squash: [sx / 2, h, sz / 2], amp: 0.14, seed: Math.abs(x), detail: 3, mat: tarp, cast: true, col: 'fabric' }); for (const dx of [-1, 0, 1]) B.beam([x + dx * sx * 0.3, 0, z - sz * 0.5], [x + dx * sx * 0.3, h * 0.9, z - sz * 0.5], 0.06, 0.06, { mat: pole }); }
    { // flatbed truck (1930s style), parked by the east gate
      const tx = 26, tz = 24, ty = 0.4, tyaw = 0.3; const P = (lx, ly, lz, sx, sy, sz, m = steel, o = {}) => { const q = at([tx, 0, tz], lx, ly, lz, tyaw); B.box({ p: [q[0], q[1], q[2]], s: [sx, sy, sz], yaw: tyaw, mat: m, bevel: 0.03, ...o }); };
      P(0, 0.55, 0, 5.2, 0.16, 2.0, steel, { col: 'metal' }); P(-1.2, 0.71, 0, 2.6, 0.06, 2.2, timber, { col: 'wood' }); P(1.7, 0.71, 0, 1.6, 1.4, 2.0, steel, { col: 'metal' }); P(2.7, 0.71, 0, 1.0, 0.9, 1.9, drumM, { col: 'metal' }); P(1.55, 1.6, 0, 1.3, 0.14, 1.9, steel); P(2.2, 1.2, 0, 0.06, 0.55, 1.5, glassDark, { cast: false });
      for (const [lx, lz] of [[-1.8, -1.0], [-1.8, 1.0], [1.9, -1.0], [1.9, 1.0]]) { const q = at([tx, 0, tz], lx, 0, lz, tyaw); B.cyl({ p: [q[0], 0, q[2]], r: 0.46, h: 0.28, seg: 18, mat: wheelMat, pitch: PI / 2, yaw: tyaw, anchor: 'center', col: false }); B.cyl({ p: [q[0], 0.46, q[2]], r: 0.46, h: 0.28, seg: 18, mat: B.m('tyre', std({ color: 0x0c0c0c, roughness: 0.9, key: 'tyre' })), pitch: PI / 2, yaw: tyaw, anchor: 'center', cast: true }); }
      for (const lz of [-0.6, 0.6]) { const q = at([tx, 0, tz], 3.25, 0.85, lz, tyaw); B.sphere({ p: q, r: 0.11, seg: 8, mat: B.m('headlamp', std({ color: 0x111111, emissive: 0xffe0a0, emissiveIntensity: 1.5, key: 'headlamp' })), cast: false }); } signQuad(B, signMaterial({ lines: ['SHAFT No.9', 'COLLIERY'], bg: '#1c231f', fg: '#e0d0a0', w: 256, h: 96, weather: 0.9 }), at([tx, 0, tz], 1.7, 1.0, 1.01, tyaw), 0.9, 0.3, tyaw);
    }
    // fuel tank on stand, scaffold tower against the engine house, weighbridge, cable spools, skips, hoses, lantern crate
    B.cyl({ p: [34, 1.3, -20], r: 0.9, h: 3.0, seg: 18, mat: drumM, roll: PI / 2, anchor: 'center', col: 'metal' }); for (const dx of [-1, 1]) B.box({ p: [34 + dx * 0.9, 0, -20], s: [0.2, 1.0, 1.2], mat: steel, col: 'metal' });
    for (const [x, z] of [[-9.5, -13.2], [-7.5, -13.2]]) B.beam([x, 0, z], [x, 5.6, z], 0.1, 0.1, { mat: steelRaw }); for (const y of [1.2, 2.6, 4.0, 5.4]) B.box({ p: [-8.5, y, -13.2], s: [2.2, 0.05, 0.9], mat: timber, bevel: 0.01, cast: true }); B.beam([-9.5, 0.2, -13.2], [-7.5, 2.6, -13.2], 0.05, 0.05, { mat: steelRaw }); B.beam([-7.5, 0.2, -13.2], [-9.5, 2.6, -13.2], 0.05, 0.05, { mat: steelRaw });
    B.box({ p: [-24, 0, 24], s: [7.0, 0.3, 3.4], mat: concrete, bevel: 0.02, col: 'concrete' }); B.box({ p: [-24, 0.3, 24], s: [6.6, 0.06, 3.0], mat: steelRaw, bevel: 0.01, cast: false }); B.box({ p: [-27.6, 0, 24], s: [0.5, 1.6, 2.8], mat: steel, bevel: 0.03, col: 'metal' });
    for (const [x, z] of [[-3, 30], [-2, 28.6]]) { B.cyl({ p: [x, 0, z], r: 0.7, h: 0.1, seg: 18, mat: beamWood, pitch: 0 }); B.cyl({ p: [x, 0.1, z], r: 0.18, h: 0.9, seg: 10, mat: beamWood }); B.cyl({ p: [x, 1.0, z], r: 0.7, h: 0.1, seg: 18, mat: beamWood }); B.cyl({ p: [x, 0.12, z], r: 0.6, h: 0.86, seg: 18, mat: B.m('cableR', std({ color: 0x151515, roughness: 0.6, key: 'cableR' })) }); }
    for (const [x, z, yaw] of [[-33, -4, 0.4], [34, 16, -0.3]]) { B.box({ p: [x, 0.0, z], s: [1.6, 0.9, 1.0], mat: drumM, yaw, bevel: 0.05, col: 'metal' }); B.box({ p: [x, 0.9, z], s: [1.7, 0.08, 1.1], mat: steel, yaw, cast: false }); }
    B.tube({ pts: [[12.4, 0.05, -10], [13.6, 0.03, -8], [15, 0.05, -6], [15.5, 0.04, -3]], r: 0.05, mat: B.m('hose', std({ color: 0x1e1e1e, roughness: 0.7, key: 'hose' })), seg: 6, segs: 24, cast: true });

    // ------------------------------------------------------------ YARD DETAIL: concrete aprons, coal spill, dry grass tufts, power line along the haul road
    B.plane({ p: [0, 0.02, -10.6], s: [18.4, 6.6], mat: concrete, cast: false }); B.plane({ p: [-5.4, 0.018, 3.2], s: [9.6, 5.6], mat: concrete, yaw: 0.04, cast: false });
    { const heaps = [[25, 16, 9], [31, 21, 7], [-30, -20, 8], [8, 9, 3], [-20, 9, 2.5]]; const NL = 300, ig = new THREE.IcosahedronGeometry(1, 0), raw = { p: ig.attributes.position.array, n: ig.attributes.normal.array, u: ig.attributes.uv.array, i: Uint32Array.from({ length: ig.attributes.position.count }, (_, k) => k) }; const tmp = new THREE.Object3D();
      for (let i = 0; i < NL; i++) { const c = heaps[i % heaps.length], a = R() * TAU, d = c[2] * (0.5 + R() * 1.0), x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d, sz = 0.04 + R() * R() * 0.15; tmp.position.set(x, sz * 0.4, z); tmp.rotation.set(R() * 0.6, R() * PI, R() * 0.6); tmp.scale.set(sz * (1 + R() * 0.6), sz * (0.6 + R() * 0.5), sz * (1 + R() * 0.5)); tmp.updateMatrix(); B.addRaw(raw, tmp.matrix.clone(), coal, { cast: false }); }
      const tuftGeo = (() => { const P = [], N = [], U = [], I = []; for (let b = 0; b < 7; b++) { const a = b * 2.399 + 0.5, lean = 0.25 + (b % 3) * 0.12, h = 0.3 + (b % 4) * 0.1, w = 0.02, ux = Math.cos(a), uz = Math.sin(a), bx = ux * 0.03, bz = uz * 0.03, px = -uz * w, pz = ux * w, base = P.length / 3; P.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + ux * lean * h, h, bz + uz * lean * h); N.push(0, 1, 0, 0, 1, 0, 0, 1, 0); U.push(0, 0, 1, 0, 0.5, 1); I.push(base, base + 1, base + 2); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g; })();
      const tuftM = B.m('tuft', std({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide, wind: { amp: 0.1, freq: 1.5, stiff: 'uv' } })); const tints = [0x8f7f48, 0x6f6b3c, 0xa48f52, 0x5e5a34]; const tl = [];
      for (let n = 0, tries = 0; n < 1500 && tries < 9000; tries++) { const x = R.range(-78, 78), z = R.range(-66, 76); const e = Math.max(Math.abs(x) / 40, Math.abs(z) / 33); if (Math.abs(z) < 0.01) continue; if (z > 8 && Math.abs(x - 2 * (z - 12) / 54) < 2.8) continue; if (Math.hypot(x + 46, z) < 12) continue; if (R() > (e > 1.05 ? 0.9 : e > 0.9 ? 0.55 : 0.04)) continue; n++; tl.push([x, z, R() * TAU, 0.7 + R() * 0.9, 0.8 + R() * 0.6, tints[(R() * 4) | 0]]); }
      const tuft = new THREE.InstancedMesh(tuftGeo, tuftM, tl.length); const col = new THREE.Color(); tl.forEach(([x, z, yaw, sc, sy, c], i) => { tmp.position.set(x, 0, z); tmp.rotation.set(0, yaw, 0); tmp.scale.set(sc, sc * sy, sc); tmp.updateMatrix(); tuft.setMatrixAt(i, tmp.matrix); tuft.setColorAt(i, col.set(c)); });
      tuft.instanceMatrix.needsUpdate = true; tuft.instanceColor.needsUpdate = true; tuft.frustumCulled = false; tuft.matrixAutoUpdate = false; B.group.add(tuft); }            // one draw for every grass tuft
    // scattered yard debris (static, batched with the existing materials: no extra programs): broken pallet boards, pipe offcuts, a tyre, buckets, rope coils
    for (let i = 0; i < 26; i++) { const x = R.range(-34, 34), z = R.range(-28, 28); if (Math.hypot(x, z) < 6 || (Math.abs(x) < 6.5 && z < 6.5 && z > -8)) continue; const yaw = R() * PI;
      if (i % 4 === 0) B.box({ p: [x, 0, z], s: [R.range(0.7, 1.5), 0.045, R.range(0.09, 0.15)], yaw, mat: timber, bevel: 0.004, cast: false }); else if (i % 4 === 1) cylBetween(B, [x, 0.06, z], [x + Math.cos(yaw) * R.range(0.6, 1.4), 0.06, z - Math.sin(yaw) * R.range(0.6, 1.4)], 0.055, steelRaw, { seg: 8, cast: false }); else if (i % 4 === 2) B.cyl({ p: [x, 0, z], r: 0.15, h: 0.26, seg: 10, mat: drumM, cast: false }); else B.cyl({ p: [x, 0, z], r: 0.42, h: 0.2, seg: 14, mat: B.m('tyre', std({ color: 0x0c0c0c, roughness: 0.9 })), cast: false }); }
    // wind-blown cloth: flags on the headframe and the engine house, hanging tarps on the timber-yard rack and the scaffold (vertex flutter, see CLOTH_V)
    { const cloth = B.m('cloth', { pattern: 'weave', size: 256, tile: 0.7, colors: [0x8a2a1e, 0x66200f], params: { threads: 44, twill: 1, variation: 0.5, fuzz: 0.5 }, bump: 1.5, rough: [0.85, 1], layers: { grime: 0.5, dust: 0.3 } }, { vertex: CLOTH_V }); cloth.side = THREE.DoubleSide;
      const sheet = (Lx, Hy, nx, ny, hang) => { const P = [], N = [], U = [], I = []; for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { P.push(Lx * i / nx, hang ? -Hy * j / ny : Hy * (1 - j / ny), 0); N.push(0, 0, 1); U.push(i / nx, 1 - j / ny); } for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; I.push(a, c, b, b, c, d); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g; };
      const put = (g, x, y, z, yaw, mat = cloth) => { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.y = yaw; m.castShadow = false; m.receiveShadow = true; m.updateMatrix(); m.matrixAutoUpdate = false; B.group.add(m); return m; };
      B.cyl({ p: [1.9, 34.6, -2.6], r: 0.03, h: 3.6, seg: 6, mat: steelRaw, cast: false }); put(sheet(2.6, 1.4, 12, 5, false), 1.93, 36.6, -2.6, 0);            // headframe pennant (hero view)
      B.cyl({ p: [-6.5, 10.2, EZ], r: 0.03, h: 3.2, seg: 6, mat: steelRaw, cast: false }); put(sheet(1.8, 1.05, 10, 4, false), -6.47, 12.2, EZ, 0);                   // engine-house flag
      put(sheet(5.6, 1.5, 12, 4, true), -33.2, 2.2, 9.2, -PI / 2); put(sheet(5.6, 1.3, 12, 4, true), -32.7, 2.2, 15.0, PI / 2 + PI);                                       // tarps on the timber rack
      put(sheet(2.0, 3.0, 8, 6, true), -9.5, 5.4, -13.3, 0); }
    for (const [x, z] of [[5, 40], [5.5, 53], [6, 66]]) { B.cyl({ p: [x, 0, z], r: [0.16, 0.11], h: 9.2, seg: 10, mat: pole, col: 'wood' }); B.beam([x - 1.2, 8.5, z], [x + 1.2, 8.5, z], 0.1, 0.12, { mat: beamWood }); B.beam([x - 1.0, 7.4, z], [x + 1.0, 7.4, z], 0.08, 0.1, { mat: beamWood }); }
    for (const dx of [-1.1, 1.1]) for (const [a, b] of [[[5, 40], [5.5, 53]], [[5.5, 53], [6, 66]], [[5, 40], [1.5, 24]]]) B.cable([a[0] + dx, 8.55, a[1]], [b[0] + dx * (b[1] < 30 ? 0.2 : 1), b[1] < 30 ? 5.6 : 8.55, b[1]], 0.6, 0.011, wire, { n: 14 });

    tm('all props');
    // ------------------------------------------------------------ CLUTTER (real small objects, gravity-placed, dense along the paths the player walks) + merge all real-construction parts
    { const CM = { iron: steelRaw, dark: black, glass: bottleGlass, post: beamWood, board: timber, brick: brickFace, hat: hatMat };
      scatterP(PT, CM, { area: [-14, 10.5, 14, 28], n: 70, kinds: ['bucket', 'bottle', 'plank', 'shovel', 'brick', 'tyre', 'bottle', 'plank', 'brick', 'plank'] }); scatterP(PT, CM, { area: [-38, 7.2, 30, 10.8], n: 60, kinds: ['bucket', 'bottle', 'plank', 'brick', 'plank', 'bottle', 'brick'] });
      scatterP(PT, CM, { area: [-14, -13, 14, -6.5], n: 50, kinds: ['bucket', 'bottle', 'hat', 'plank', 'brick', 'shovel'] }); scatterP(PT, CM, { area: [-34, 12, -16, 24], n: 36, kinds: ['plank', 'plank', 'bucket', 'bottle', 'shovel'] });
      scatterP(PT, CM, { area: [-33, -12, -21, -4], n: 26, kinds: ['bucket', 'bottle', 'hat', 'shovel', 'plank'] }); scatterP(PT, CM, { area: [26, -16, 36, -8], n: 22, kinds: ['bucket', 'bottle', 'plank', 'tyre'] }); scatterP(PT, CM, { area: [-6, 26, 6, 34], n: 26, kinds: ['bucket', 'bottle', 'plank', 'hat', 'brick'] }); }
    console.log('[surface] real parts triangles', PT.tris, 'by material', [...PT.g, ...PT.gn].map(([m, g]) => (m.name || '?') + ':' + (g.tris / 1000).toFixed(0) + 'k').sort().join(' ')); PT.flush();
    // ------------------------------------------------------------ weather + atmosphere (dusk: low warm sun, cool blue shade, restrained haze)
    ctx.weather({ type: 'dust', count: 1600, box: [46, 22, 46], fall: 0.05, size: 0.03, turb: 0.6, color: [0.9, 0.72, 0.55], alpha: 0.22, cell: 9, seed: 3, wind: [3.2, 0, 1.4] });
    ctx.weather({ type: 'embers', count: 160, box: [28, 14, 28], fall: -0.5, rise: 0.0, size: 0.028, turb: 1.0, color: [3.0, 1.0, 0.3], alpha: 0.9, cell: 3, additive: true, twinkle: 0.7, seed: 9, wind: [1, 0, 0.5] });
    // golden hour, sun low in the west-south-west (side light for the arrival view): long shadows stream east across the yard, sunlit faces are warm, everything in
    // shade is lit by a cool blue sky (separate, bluer environment map than the visible sky), distant ridges are dark hazy silhouettes against the glow.
    const SUN = [-0.88, 0.33, 0.22];
    { const em = lampPts.map((p) => ({ p: [p[0], 5.0, p[2]], c: [4.5, 2.4, 0.9], s: 0.2 })); const sd = new THREE.Vector3(...SUN).normalize().multiplyScalar(300); em.push({ p: [sd.x, sd.y, sd.z], c: [30, 17, 7], s: 9 }, { p: [-21.5, 1.4, -1.5], c: [5, 2, 0.5], s: 0.3 }, { p: [3.5, 1.4, EZ - 2.1], c: [5, 2, 0.5], s: 0.3 }); setEmitters(puddleM, em, 0); }
    const atmo = {
      name: 'Shaft Nine · Surface Yard (dusk)',
      fog: { color: 0x3c5078, scatter: 0xffae6a, density: 0.0011, falloff: 0.03, base: 0, power: 7 },
      sky: { zenith: 0x0f3494, horizon: 0x9aa0c2, ground: 0x3a2c24, gradPow: 0.6, sunColor: 0xffa054, sunSize: 0.03, sunGlow: 1.5, disc: 1, stars: 0.08, cloud: 0.42, cloudColor: 0x2a3a66, cloudLit: 0xff9048, cloudSpeed: 0.003, cloudScale: 1.7, cloudDark: 0.6, horizonFog: 0.3 },
      sun: { dir: SUN, color: 0xffc084, intensity: 9.5, shadow: true }, env: { intensity: 0.4 }, shafts: 0.3,
      exposure: 1.0, bloom: 0.3, vignette: 0.36, grain: 0.03, chroma: 0.0014, ao: 0.8,
      grade: { sat: 1.1, contrast: 1.2, lift: [0.0, 0.02, 0.07], gain: [1.03, 1.0, 0.97], tint: [1, 1, 1] }, autoExposure: { key: 0.19, min: 0.85, max: 1.5 },
      wind: [3.2, 0, 1.4], wet: 0.1, reverb: 'openDusk',
    };
    // cool ambient: blue sky dome + warm ground bounce + a soft warm glow patch toward the sun (no sun disc: the directional light is the sun)
    const envTex = ctx.env({ sky: { zenith: 0x1f4bb0, horizon: 0x5c74a8, ground: 0x4a382c, gradPow: 0.6, sunGlow: 0, disc: 0, stars: 0, cloud: 0, horizonFog: 0 }, fog: { color: 0x3c5078 }, sun: { dir: SUN } },
      [{ dir: SUN, color: 0xff9a55, size: 3.4, intensity: 2.6 }, { dir: [0, 1, 0], color: 0x2a4fb8, size: 5, intensity: 3.0 }, { dir: [0.7, 0.3, 0.4], color: 0x5a78c8, size: 4, intensity: 1.8 }]);
    normalizePatch(B, { breakup: 0.5, wet: false });
    const sunDir = new THREE.Vector3(...atmo.sun.dir).normalize(); const steam = { t: 0 };
    console.log('[surface] build ms', (performance.now() - t0).toFixed(0));
    return {
      atmo, envTex,
      playerStart: { pos: [0, 0, 18], yaw: 0 }, station: { pos: [0, 0, 0], yaw: 0 }, groundY: 0, heightFn: hills, groundSurface: 'dirt', landing,
      navBounds: [-46, -38, 46, 38], navBlocked: cliffBlocker(B.colliders), landmark: { pos: [0, 26, 0], name: 'Headframe' }, sheaves, beacon, halos,
      spawns: [
        { kind: 'barricade', pos: [-3.6, 0, FZ - 0.8], yaw: PI, boards: 5 }, { kind: 'barricade', pos: [3.6, 0, FZ - 0.8], yaw: PI, boards: 5 },
        { kind: 'walk', pos: [-44.0, 0, 0], yaw: -PI / 2, note: 'adit' }, { kind: 'walk', pos: [40, 0, 1], yaw: PI / 2, note: 'east gate' }, { kind: 'walk', pos: [2, 0, 32.5], yaw: 0, note: 'south gate' }, { kind: 'walk', pos: [-8, 0, -32.5], yaw: PI, note: 'north gate' },
      ],
      buys: { walls: [{ pos: [7.3, 1.5, FZ + 0.06], yaw: 0, gun: 'm14' }, { pos: [-27, 1.4, -5.6], yaw: 0, gun: 'olympia' }], perks: [{ pos: [9.6, 0, FZ + 0.8], yaw: 0, perk: 'juggernog' }], box: { pos: [-15, 0, 8.6], yaw: 0 } },
      zombieVariants: ['miner', 'miner_lamp', 'miner_foreman'],
      ambient: { space: 'openDusk', beds: [{ type: 'wind', gain: 0.5, gust: 0.4 }, { type: 'hum', freq: 50, gain: 0.05 }], events: [{ type: 'creak', every: [6, 16] }, { type: 'crow', every: [12, 30] }, { type: 'clank', every: [8, 20] }] },
      onReady(st) {
        const dm = new Set(); st.group.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'dirt') { dm.add(o.material); if (o.geometry.attributes.aVis) smoothVis(o.geometry, 3); } });
        for (const m of dm) extendMaterial(m, { uniforms: { uMacroA: { value: macro.texA }, uMacroB: { value: macro.texB }, uMacro: { value: macro.o } }, decl: 'uniform sampler2D uMacroA; uniform sampler2D uMacroB; uniform vec3 uMacro;', tag: 'mac' });
        const u = unifyPrograms(st.group); console.log('[surface] programs after unify', u.programs, 'meshes', u.meshes, '| build+finish ms', (performance.now() - t0).toFixed(0));
      },
      update(dt, t, active) {
        fireLight.intensity = 8 * (0.75 + 0.25 * Math.sin(t * 13) * Math.sin(t * 5.3)); fire.intensity = 5 + 2 * Math.sin(t * 9) * Math.sin(t * 3.1); beacon.material.emissiveIntensity = 1.5 + 8 * Math.max(0, Math.sin(t * 2.4));
        if (!active) return; steam.t += dt; if (steam.t > 0.05) { steam.t = 0; fx.puff({ x: 6.2 + (rand() - 0.5) * 0.3, y: EH - 0.7, z: EZ - 5.8 }, { x: 0, y: 1, z: 0 }, 1, { speed: 0.5, size: [0.3, 1.8], life: 3.4, color: [0.75, 0.72, 0.68, 0.26], rise: 1.1, drag: 0.6, spread: 0.3, cell: 1 }); fx.puff({ x: 9.6, y: 27.2, z: EZ - 2.5 }, { x: 0, y: 1, z: 0 }, 1, { speed: 0.6, size: [0.9, 5.5], life: 8, color: [0.2, 0.19, 0.19, 0.3], rise: 1.5, drag: 0.3, spread: 0.5, cell: 1 }); }
      },
    };
  },
};
