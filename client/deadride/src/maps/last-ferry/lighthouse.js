// LAST FERRY — Stop 4: LIGHTHOUSE ROCK. A wave-lashed rock islet in a storm: tall red-and-white banded lighthouse with a rotating Fresnel light (real sweeping spotlight + volumetric beams),
// keeper's cottage, stone jetty, crashing surf (foam + spray), storm swell, wind-blown rain, lightning, bell buoy. Deep blue-black + white foam + the warm beam.
// Landmark: the lighthouse. Ferry berth: east jetty (ferry heads south, quay on its starboard = west).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { makeBeam } from '../../core/glow.js';
import { buildTerrain } from '../../core/terrain.js';
import { rand, makeRng, fbm2, noise2 } from '../../core/util.js';
import { STOPS, BEAM_HALF, FENDER } from './layout.js';
import { ATMO, ENV } from './atmos.js';
import { getSea, withLampRefl, LH, buildFoamStrips, lampReg } from './shared.js';
import { Builder } from '../../core/build.js';
import { makeKit, puddleMaterial, fitTex, terrainFrag, terrainSpec } from './kit.js';
import { makeBuilding } from './bld.js';
import { makeBoat } from './boats.js';
import { stubStop, skipStop } from './stub.js';
import { makeProps } from './props2.js';
import { platform } from './cover.js';
import { decalAtlas } from './decals.js';
import { makeGulls } from './wharfProps.js';
import { rockLedge } from './arch.js';
import { derrick, lobsterPots } from './detail3.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const P = Math.PI, IDX = 3, ST = STOPS[3], JX = -ST.quayFace, DY = ST.quayY;    // jetty face x = +103.2, jetty height 1.6
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export default {
  id: 'lighthouse', name: 'Lighthouse Rock', origin: ST.origin, viewRadius: 360,
  async build(ctx) {
    if (skipStop(IDX)) return stubStop(ctx, IDX, this);
    const { B, fx, gfx } = ctx; const sea = getSea(); sea.attach(ctx.world.root); const K = makeKit(ctx, IDX); const rng = K.rng;
    // ------------------------------------------------------------------ materials
    const M = {};
    const O = ST.origin; const wp = (pl) => pl.map(([x, z]) => [O[0] + x, O[2] + z]);
    const PATHS = [[[78, 6], [70, 5], [64, 5], [56, 4.6], [48, 4.4], [40, 5.6], [33, 3.4], [28, -2], [23, -7.5], [19.2, -11.2]], [[56, 4.6], [55.5, 9.5], [55.5, 14]], [[40, 5.6], [36, 9], [32.5, 11]], [[33, 3.4], [30, 6.5]]];
    M.rock = B.m('lRock', { pattern: 'rock', size: 1024, tile: 6, colors: [0x26282b, 0x363a3d, 0x505456, 0x70747a], params: { scale: 6, strata: 7, cracks: 0.9, roughness: 0.85, tone: 0.5, moisture: 0.8 }, bump: 110, rough: [0.35, 0.85], layers: { moss: 0.3, grime: 0.5, wet: 0.55, streak: 0.4 }, mossColor: 0x223a2a }, { triplanar: 1 / 6, breakup: 0.6, wet: true, key: 'lhTerrain', frag: terrainFrag({ grass: { lo: 3.4, hi: 5.6, c0: 0x263820, c1: 0x48602a }, beach: { hi: 1.7, c: 0x55544e }, path: { w: 1.5, c: 0x4a4740, lines: PATHS.map(wp) } }) }); M.rock.envMapIntensity = 0.7; terrainSpec(M.rock); withLampRefl(M.rock, { gain: 0.5, maxRough: 0.6, patchy: 0.6 });
    M.boulder = B.m('lBoulder', { pattern: 'rock', size: 512, tile: 1.6, colors: [0x2c2f32, 0x40454a, 0x5c6266, 0x7c8286], params: { scale: 6, strata: 5, cracks: 1.0, roughness: 0.85, tone: 0.5, moisture: 0.6 }, bump: 60, rough: [0.45, 0.9], layers: { moss: 0.5, grime: 0.6, wet: 0.35, streak: 0.5 }, mossColor: 0x2a4a2c }, { triplanar: 1 / 1.6, breakup: 0.5, wet: true });
    M.granite = B.m('lGranite', { pattern: 'stone', size: 512, tile: 3, colors: [0x70726c, 0x54564f, 0x1c1d1a, 0x8c8e86], params: { scale: 4, gap: 0.05, round: 0.2, variation: 0.55, mortarDark: 0.85, strata: 0.15, lichen: 0.5 }, mossColor: 0x2e4a30, bump: 18, rough: [0.5, 0.9], layers: { grime: 0.7, moss: 0.5, streak: 0.6, wet: 0.5 } }, { wet: true });
    M.jetty = B.m('lJetty', { pattern: 'bricks', size: 1024, tile: 3, colors: [0x8c908a, 0x6c706a, 0x40423e], params: { rows: 6, cols: 3, mortar: 0.012, variation: 0.6, chips: 0.35, moss: 0.35, soot: 0.3 }, mossColor: 0x1e4a2a, bump: 8, rough: [0.4, 0.85], layers: { moss: 0.5, grime: 0.7, wet: 0.7, streak: 0.5 } }, { wet: true, breakup: 0.5, refl: 1, frag: 'roughnessFactor = max(roughnessFactor, 0.34);' }); withLampRefl(M.jetty, { gain: 0.6, maxRough: 0.7, patchy: 0.7 });
    M.white = B.m('lWhite', { pattern: 'noise', size: 512, tile: 3, colors: [0xdad6ca, 0xc4bfae, 0x7a7566, 0xe8e4d8], params: { scale: 4, contrast: 2, fine: 96, speckle: 0.02, pores: 0.4, panels: 3, panelWidth: 0.002 }, rustColor: 0x6a3a1c, bump: 2, rough: [0.55, 0.9], layers: { grime: 0.6, streak: 0.9, rust: 0.2, moss: 0.25, wet: 0.3 } }, { wet: true });
    M.red = B.m('lRed', { pattern: 'noise', size: 512, tile: 3, colors: [0x9a2a22, 0x7a1e18, 0x3a0c08, 0xb84a3a], params: { scale: 4, contrast: 2, fine: 96, speckle: 0.02, pores: 0.4, panels: 3, panelWidth: 0.002 }, rustColor: 0x5a2a12, bump: 2, rough: [0.55, 0.9], layers: { grime: 0.6, streak: 0.9, rust: 0.15, moss: 0.15, wet: 0.3 } }, { wet: true });
    M.slate = B.m('lSlate', { pattern: 'scales', size: 512, tile: 2, colors: [0x3c4652, 0x2a323c], params: { rows: 14, cols: 12, round: 0.3, variation: 0.6 }, bump: 10, rough: [0.3, 0.7], layers: { moss: 0.35, grime: 0.6, wet: 0.7 }, mossColor: 0x2c4a30 }, { wet: true });
    M.copper = B.m('lCopper', { pattern: 'plates', size: 256, tile: 2, colors: [0x4f9a80, 0x3a7a66, 0x1e3a30], params: { cols: 4, rows: 4, seam: 0.01, rivets: 0, brushed: 0.3, panelVar: 0.5 }, bump: 3, metal: 0.8, rough: [0.4, 0.7], layers: { grime: 0.5, streak: 0.8 } });
    M.iron = B.m('lIron', { pattern: 'plates', size: 256, tile: 2, colors: [0x22282c, 0x181c1f, 0x0a0c0e], rustColor: 0x5a3018, params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.4, panelVar: 0.4 }, bump: 2, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.5, grime: 0.6, edge: 0.4, scratch: 0.3, streak: 0.7 } }, { wet: true });
    M.rustS = B.m('lRust', { pattern: 'plates', size: 256, tile: 2, colors: [0x5b3421, 0x452617, 0x1a0e08], rustColor: 0x6a3418, params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.3, panelVar: 0.5 }, bump: 3, metal: 0.45, rough: [0.5, 0.85], layers: { rust: 0.85, grime: 0.6, streak: 0.5 } });
    M.timber = B.m('lTimber', { pattern: 'planks', size: 512, tile: 2, colors: [0x4a3c2c, 0x30261a, 0x0e0a06], params: { rows: 10, gap: 0.005, grain: 8, knots: 0.3, cols: 1, vertical: 0, weather: 0.9, nails: 1 }, bump: 4, rough: [0.7, 0.95], layers: { grime: 0.6, streak: 0.5, moss: 0.3 }, mossColor: 0x2c4a30 }, { wet: true });
    M.turf = B.m('lTurf', { pattern: 'dirt', size: 512, tile: 4, colors: [0x3e5232, 0x536a42, 0x24301a, 0x7a9060], params: { scale: 5, pebbles: 0.3, cracks: 0.1, grass: 0.85 }, mossColor: 0x2c4a22, bump: 30, rough: [0.7, 1], layers: { wet: 0.6 } }, { triplanar: 1 / 4, wet: true });
    M.rope = B.m('lRope', { pattern: 'weave', size: 256, tile: 0.25, colors: [0x8a7a58, 0x5a4e36], params: { threads: 24, twill: 1, variation: 0.6, fuzz: 0.5 }, bump: 2, rough: [0.85, 1], layers: { grime: 0.5 } });
    M.tyre = B.m('lTyre', { pattern: 'rubber', size: 256, tile: 0.5, colors: [0x141414, 0x1e1e1e], params: { scale: 8, tread: 0.6 }, bump: 1.5, rough: [0.8, 0.95], layers: { grime: 0.4, dust: 0.3 } });
    M.brass = B.m('lBrass', std({ color: 0xb08a3c, roughness: 0.3, metalness: 1 })); M.black = B.m('lBlack', std({ color: 0x0c0d0e, roughness: 0.55, metalness: 0.5 })); M.glass = B.m('lGlass', std({ color: 0x000000, roughness: 0.04, metalness: 0, envMapIntensity: 2.2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    M.lit = B.m('lLit', std({ color: 0x000000, emissive: 0xffb45a, emissiveIntensity: 1.6, roughness: 0.4 })); M.dark = B.m('lDark', std({ color: 0x040608, roughness: 0.08, metalness: 0.2, envMapIntensity: 1.4 })); M.reveal = B.m('lReveal', std({ color: 0x020304, roughness: 1 })); M.frame = B.m('lFrame', std({ color: 0x1a1c1a, roughness: 0.6, metalness: 0.4 }));
    M.lamp = B.m('lLamp', std({ color: 0x000000, emissive: 0xffa848, emissiveIntensity: 8, roughness: 0.4 })); M.core = B.m('lCore', std({ color: 0x000000, emissive: 0xfff2d0, emissiveIntensity: 14, roughness: 0.4 })); M.lens = B.m('lLens', std({ color: 0x000000, emissive: 0xffe8b0, emissiveIntensity: 5, roughness: 0.3 }));
    const puddle = puddleMaterial(B, 'lPuddle', 0x03060a, 0x14263a); const bld = { wall: M.granite, roof: M.slate, trim: M.granite, lit: M.lit, dark: M.dark, reveal: M.reveal, frame: M.frame, stone: M.granite, iron: M.iron }; const BL = makeBuilding(K, bld);
    // ------------------------------------------------------------------ terrain: the rock islet (heightfield) + jetty
    const CX = 12, CZ = 0, RX = 96, RZ = 68;
    const Hraw = (x, z) => { const u = (x - CX) / RX, v = (z - CZ) / RZ; const warp = 1 + 0.34 * fbm2(x * 0.018 + 3.1, z * 0.018 - 1.7, 3); const d = Math.hypot(u, v) * warp; let h = 10.8 * (1 - d * d * d) - 1.2 + 2.6 * fbm2(x * 0.08, z * 0.08, 4) + 0.8 * fbm2(x * 0.3, z * 0.3, 3);
      const dl = Math.hypot(x - 22, z + 14); const pl = 1 - smooth(16, 30, dl); h = h * (1 - pl) + (9.2 + 0.3 * fbm2(x * 0.2, z * 0.2, 2)) * pl;               // lighthouse plateau
      const d2 = Math.hypot(x - 52, z + 2); const p2 = 1 - smooth(11, 20, d2); h = h * (1 - p2) + 9.3 * p2;                                                        // cottage terrace
      const tz = smooth(76, 88, x) * (1 - smooth(34, 48, Math.abs(z))); h = h * (1 - tz) + 0.8 * tz;                                                   // low terrace under the jetty
      return Math.max(h, -3.5); };
    const H = (x, z) => Hraw(x, z);
    buildTerrain(B, { minX: -104, maxX: 104, minZ: -94, maxZ: 94, cell: 2, heightFn: H, mat: M.rock, chunk: 32 }); B.colliders.groundY = -3.5; B.colliders.waterY = 0; B.colliders.groundSurface = 'rock';
    B.colliders.surfaceAt = (x, z) => (H(x, z) > 8.2 ? 'gravel' : 'rock');
    // turf patch on the plateau
    // jetty: masonry pier along x=JX face (z -40..40), rounded head, weed band at the waterline, iron rings, bollards, fenders, ladders
    const J = { x0: 84, z0: -42, z1: 42 };
    B.box({ p: [(J.x0 + JX) / 2, -3.4, 0], s: [JX - J.x0, DY + 3.4 - 0.02, J.z1 - J.z0], mat: M.jetty, col: 'rock' }); B.plane({ p: [(J.x0 + JX) / 2, DY + 0.003, 0], s: [JX - J.x0, J.z1 - J.z0], mat: M.jetty, cast: false });
    B.box({ p: [JX - 0.3, DY - 0.16, 0], s: [0.8, 0.28, J.z1 - J.z0], mat: M.granite, bevel: 0.03, cast: true });
    for (const sz of [-1, 1]) { B.box({ p: [(J.x0 + JX) / 2, DY - 0.02, sz * (J.z1 + 0.5) - sz * 0.5], s: [JX - J.x0 + 0.6, 0.3, 0.9], mat: M.granite, bevel: 0.03, cast: true }); }
    const ladderZ = [-30, -22, 22, 30, 36]; const inRec = (z) => ladderZ.some((l) => Math.abs(z - l) < 1.0);
    for (let z = J.z0; z <= J.z1; z += 6) { if (inRec(z)) continue; B.box({ p: [JX + 0.16, 0.3, z], s: [0.3, 1.5, 0.3], mat: M.timber, bevel: 0.04, cast: false }); }
    for (const a of [17, 7.2, -7.2, -17]) K.bollard(JX - 1.1, DY, a, M.iron, { h: 0.6, r: 0.2 });
    for (const z of [-36, -12, 12, 38]) K.bollard(JX - 1.4, DY, z, M.iron);
    for (const z of [-34, -18, 18, 34]) K.tyre(JX + 0.1, 0.5, z, M.tyre, { axis: 'x', r: 0.4, t: 0.15 });
    for (const z of ladderZ) K.ladder([JX, z], [1, 0], DY, M.iron);
    K.quayFoam([JX + 0.05, J.z0], [JX + 0.05, J.z1], 2.4, 1.0, 7); K.foamStrips[K.foamStrips.length - 1].side = -1;
    { let a = J.z0 - 4; for (const lz of ladderZ.concat([J.z1 + 4])) { const b = lz - 1.3; if (b - a > 0.3) K.wallCol([JX - 0.25, a], [JX - 0.25, b], DY, DY + 1.3, 0.3, 'rock'); a = lz + 1.3; } }
    K.wallCol([J.x0, J.z0], [JX, J.z0], DY, DY + 1.3, 0.3, 'rock'); K.wallCol([J.x0, J.z1], [JX, J.z1], DY, DY + 1.3, 0.3, 'rock');
    // shoreline foam: march from the centre outward at many angles to find the waterline; wide surf strips + a second broken ring
    const shore = []; for (let i = 0; i < 120; i++) { const a = i / 120 * P * 2; let r = 20; for (; r < 130; r += 1) { const x = CX + Math.cos(a) * r * 1.3, z = CZ + Math.sin(a) * r; if (H(x, z) < 0.1) break; } shore.push([CX + Math.cos(a) * r * 1.3, CZ + Math.sin(a) * r, a]); }
    const shoreClean = shore.filter((p) => !(p[0] > 78 && Math.abs(p[1]) < 46)); // (jetty side handled separately)
    { const strips = []; let cur = []; for (const p of shore) { if (p[0] > 78 && Math.abs(p[1]) < 46) { if (cur.length > 2) strips.push(cur); cur = []; } else cur.push([p[0], p[1]]); } if (cur.length > 2) strips.push(cur); for (const pts of strips) { K.foamStrips.push({ pts, width: 5.5, alpha: 1.0, side: -1, seed: 11 }); K.foamStrips.push({ pts: pts.map(([x, z]) => [x + (x - CX) * 0.03, z + z * 0.03]), width: 3.2, alpha: 0.85, side: -1, seed: 17 }); } }
    // boulders in the surf + sea stacks
    for (let i = 0; i < 26; i++) { const p = shore[(rng() * shore.length) | 0]; const a = p[2], off = 6 + rng() * 18; const x = p[0] + Math.cos(a) * off * 1.3, z = p[1] + Math.sin(a) * off; if (x > 74 && Math.abs(z) < 50) continue; const r = 1.6 + rng() * 3.6; B.rock({ p: [x, r * 0.25, z], r, squash: [1.2, 0.9 + rng() * 0.5, 1.1], amp: 0.55, seed: 30 + i, detail: 3, mat: M.boulder, col: false, cast: true }); K.pileFoam(x, z, r * 0.95, 1.8 + r * 0.3); }
    // ------------------------------------------------------------------ LIGHTHOUSE (banded tower, gallery, lantern room, rotating Fresnel lens)
    const LX = 22, LZ = -14, LY = 9.4, TH = 31, R0 = 4.3, R1 = 3.0; const rAt = (y) => R0 + (R1 - R0) * (y / TH);
    B.cyl({ p: [LX, LY - 0.4, LZ], r: R0 + 1.4, h: 2.6, seg: 22, mat: M.granite, col: 'rock', cast: true }); B.cyl({ p: [LX, LY + 2.1, LZ], r: R0 + 0.55, h: 0.4, seg: 22, mat: M.granite, cast: false });
    const bandsN = 7, bh = TH / bandsN; for (let i = 0; i < bandsN; i++) { const y0 = i * bh, y1 = (i + 1) * bh; B.lathe({ p: [LX, LY + 2.3 + y0 * 0.97, LZ], profile: [[rAt(y0), 0], [rAt(y1), bh * 0.97]], seg: 26, mat: i % 2 ? M.red : M.white, col: false, cast: true }); }
    for (let i = 0; i < 38; i++) { const y = 0.55 + i * (TH * 0.97 - 1.1) / 38; B.cyl({ p: [LX, LY + 2.3 + y * 0.97, LZ], r: rAt(y) + 0.03, h: 0.055, seg: 28, mat: Math.floor(y / bh) % 2 ? M.red : M.white, cast: false }); }   // masonry course lines
    B.colliders.addCyl({ x: LX, z: LZ, r: R0 + 0.2, y0: LY, y1: LY + 32, surface: 'concrete', walk: false });
    // door, steps, slit windows (spiral), lit windows
    { const ang = P * 0.9; const dx = Math.cos(ang), dz = Math.sin(ang); B.box({ p: [LX + dx * (R0 + 0.05), LY + 2.3, LZ + dz * (R0 + 0.05)], s: [1.5, 2.6, 0.3], mat: M.reveal, yaw: -ang + P / 2, bevel: 0, cast: false, col: false }); B.box({ p: [LX + dx * (R0 + 0.2), LY + 2.3, LZ + dz * (R0 + 0.2)], s: [1.2, 2.4, 0.12], mat: M.timber, yaw: -ang + P / 2, bevel: 0.02, cast: false });
      for (let i = 0; i < 7; i++) { const a = P * 0.9 + 0.5 + i * 1.05, y = 4 + i * 4, rr = rAt(y) + 0.02; B.box({ p: [LX + Math.cos(a) * rr, LY + 2.3 + y, LZ + Math.sin(a) * rr], s: [0.32, 0.9, 0.32], mat: i % 3 === 1 ? M.lit : M.dark, yaw: -a + P / 2, bevel: 0, cast: false }); } }
    // gallery + railing
    const GY = LY + 2.3 + TH * 0.97; B.cyl({ p: [LX, GY - 0.3, LZ], r: [R1 + 0.4, R1 + 1.3], h: 0.4, seg: 26, mat: M.granite, cast: true }); B.cyl({ p: [LX, GY + 0.1, LZ], r: R1 + 1.25, h: 0.12, seg: 26, mat: M.iron, col: false, cast: true });
    for (let i = 0; i < 28; i++) { const a = i / 28 * P * 2; B.cyl({ p: [LX + Math.cos(a) * (R1 + 1.15), GY + 0.2, LZ + Math.sin(a) * (R1 + 1.15)], r: 0.025, h: 1.05, seg: 5, mat: M.iron, cast: false }); } for (const y of [0.55, 1.15]) { const pts = []; for (let i = 0; i <= 28; i++) { const a = i / 28 * P * 2; pts.push([LX + Math.cos(a) * (R1 + 1.15), GY + 0.2 + y, LZ + Math.sin(a) * (R1 + 1.15)]); } B.tube({ pts, r: 0.03, mat: M.iron, seg: 5, segs: 40, cast: false }); }
    for (let i = 0; i < 20; i++) { const a = i / 20 * P * 2, c = Math.cos(a), sn = Math.sin(a); B.beam([LX + c * (R1 + 0.15), GY - 1.05, LZ + sn * (R1 + 0.15)], [LX + c * (R1 + 1.2), GY - 0.32, LZ + sn * (R1 + 1.2)], 0.2, 0.26, { mat: M.granite, bevel: 0.02, cast: true }); }   // gallery corbels
    // lantern room: glazed cylinder (12 panes), mullions, copper dome, ball, vane
    const LR = R1 - 0.2, LHt = 3.2; B.cyl({ p: [LX, GY + 0.1, LZ], r: LR + 0.1, h: 0.9, seg: 24, mat: M.red, cast: true }); B.cyl({ p: [LX, GY + 1.0, LZ], r: LR, h: LHt - 1.0, seg: 24, mat: M.glass, cast: false, open: true });
    for (let i = 0; i < 12; i++) { const a = i / 12 * P * 2; B.box({ p: [LX + Math.cos(a) * LR, GY + 1.0, LZ + Math.sin(a) * LR], s: [0.08, LHt - 1.0, 0.08], mat: M.iron, yaw: -a, bevel: 0, cast: false }); }
    for (const y of [1.05, LHt - 0.05]) { const pts = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * P * 2; pts.push([LX + Math.cos(a) * LR, GY + y, LZ + Math.sin(a) * LR]); } B.tube({ pts, r: 0.05, mat: M.iron, seg: 5, segs: 40, cast: false }); }
    B.lathe({ p: [LX, GY + LHt - 0.05, LZ], profile: [[LR + 0.25, 0], [LR + 0.12, 0.12], [LR * 0.8, 0.5], [LR * 0.45, 1.0], [LR * 0.15, 1.35], [0.12, 1.5]], seg: 24, mat: M.copper, cast: true }); B.sphere({ p: [LX, GY + LHt + 1.62, LZ], r: 0.16, mat: M.copper, seg: 8, cast: false }); B.cyl({ p: [LX, GY + LHt + 1.7, LZ], r: 0.02, h: 1.2, seg: 5, mat: M.iron, cast: false });
    // the Fresnel lens (rotating group): brass frame, 8 lens panels, white-hot core, glare + two beams (route-level cones handle the far view; here the real spot light)
    const lens = new THREE.Group(); lens.position.set(LX, GY + 1.9, LZ); B.group.add(lens); const coreM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), M.core); lens.add(coreM);
    { // Fresnel lens: stepped prism rings (one lathe) + brass frame (rings + 8 mullions merged): 3 meshes instead of 25
      const pts = []; for (let k = 0; k < 11; k++) { const y0 = -0.66 + k * 0.12; pts.push(new THREE.Vector2(0.6, y0), new THREE.Vector2(0.67, y0 + 0.05), new THREE.Vector2(0.62, y0 + 0.11)); } pts.push(new THREE.Vector2(0.6, 0.66)); lens.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 40), M.lens));
      const parts = []; for (const yy of [-0.7, 0.7]) { const g = new THREE.TorusGeometry(0.64, 0.035, 6, 36); g.rotateX(P / 2); g.translate(0, yy, 0); parts.push(g); } for (let k = 0; k < 8; k++) { const a = k / 8 * P * 2, g = new THREE.CylinderGeometry(0.02, 0.02, 1.4, 5); g.translate(Math.cos(a) * 0.66, 0, Math.sin(a) * 0.66); parts.push(g); } lens.add(new THREE.Mesh(mergeGeometries(parts), M.brass)); }
    B.cyl({ p: [LX, GY + 0.9, LZ], r: 0.5, h: 1.0, seg: 14, mat: M.brass, cast: false }); B.cyl({ p: [LX, GY + 1.0, LZ], r: 0.9, h: 0.06, seg: 20, mat: M.brass, cast: false });
    const lampWorld = [ctx.origin.x + LX, ctx.origin.y + GY + 1.9, ctx.origin.z + LZ]; LH.world = lampWorld;
    const gi = K.glows.add([LX, GY + 1.9, LZ], 0xffe8b0, 1.6, 1.0, 0, { mist: 2.0 }); K.lamps.push(lampReg.add(lampWorld[0], lampWorld[1], lampWorld[2], 0xffe8b0, 6, 1.5, IDX));
    const spot = ctx.light({ pos: [LX, GY + 1.9, LZ], color: 0xffe6b0, intensity: 2200, distance: 150, decay: 2, kind: 'spot', dir: [1, -0.05, 0], angle: 0.12, penumbra: 0.5, shadow: true });
    const spot2 = ctx.light({ pos: [LX, GY + 1.9, LZ], color: 0xffe6b0, intensity: 1500, distance: 130, decay: 2, kind: 'spot', dir: [-1, -0.05, 0], angle: 0.12, penumbra: 0.5, shadow: false });
    // ------------------------------------------------------------------ KEEPER'S COTTAGE + oil store + fog-signal house + walls
    const C = { x0: 48, x1: 58, z0: -6, z1: 2 }; const cy = 9.3; B.box({ p: [(C.x0 + C.x1) / 2, cy, (C.z0 + C.z1) / 2], s: [C.x1 - C.x0, 3.6, C.z1 - C.z0], mat: M.granite, bevel: 0.05, col: 'rock', walk: false, cast: true }); BL.gableRoof(C.x0, C.z0, C.x1, C.z1, cy + 3.6, 2.8, 'x', 0.4, M.slate, M.granite);
    B.box({ p: [C.x0 + 1.6, cy + 6.4, C.z0 + 1.2], s: [0.9, 3.2, 0.9], mat: M.granite, bevel: 0.03, cast: true }); BL.windowGrid('s', C.x0 + 1.5, C.x1 - 1.5, C.z1 + 0.02, cy + 1.0, 1, 3, 1.0, 1.4, 0, { litP: 1, litMats: [M.lit] }); B.box({ p: [(C.x0 + C.x1) / 2 + 0.0, cy, C.z1 + 0.05], s: [1.2, 2.2, 0.1], mat: M.timber, bevel: 0.02, cast: false });
    for (const x of [C.x0 + 2, C.x1 - 2]) K.glare([x, cy + 1.7, C.z1 + 0.8], 0xffb45a, 0.5, 0.6, { refl: 1.5, mist: 1.3 }); K.lamp([(C.x0 + C.x1) / 2, cy + 3.0, C.z1 + 1.2], { color: 0xffb45a, cd: 22, dist: 16, size: 0.35, refl: 2.4, flick: 0.12 });
    // cottage dressing: shutters, gutters + downpipes, chimney pots, doorstep
    for (const wx of [50.67, 53.0, 55.33]) for (const sd of [-1, 1]) B.box({ p: [wx + sd * 0.78, cy + 1.0, C.z1 + 0.06], s: [0.5, 1.4, 0.04], mat: M.red, bevel: 0.01, cast: false, col: false });
    for (const gz of [C.z0 - 0.35, C.z1 + 0.35]) B.cyl({ p: [(C.x0 + C.x1) / 2, cy + 3.5, gz], r: 0.05, h: C.x1 - C.x0 + 0.8, seg: 6, mat: M.iron, roll: P / 2, anchor: 'center', cast: false });
    for (const [dx, dz] of [[C.x1 + 0.3, C.z1 + 0.3], [C.x0 - 0.3, C.z0 - 0.3]]) B.cyl({ p: [dx, cy, dz], r: 0.05, h: 3.5, seg: 6, mat: M.iron, cast: false });
    for (const px of [-0.22, 0.22]) B.cyl({ p: [C.x0 + 1.6 + px, cy + 9.6, C.z0 + 1.2], r: 0.12, h: 0.45, seg: 8, mat: M.rustS, cast: false }); B.box({ p: [(C.x0 + C.x1) / 2, cy, C.z1 + 0.5], s: [1.6, 0.12, 0.8], mat: M.granite, bevel: 0.02, cast: true, col: false });
    const OS = { x0: 36, x1: 42, z0: -4, z1: 3 }; B.box({ p: [(OS.x0 + OS.x1) / 2, cy, (OS.z0 + OS.z1) / 2], s: [OS.x1 - OS.x0, 3.0, OS.z1 - OS.z0], mat: M.white, bevel: 0.05, col: 'rock', walk: false, cast: true }); BL.gableRoof(OS.x0, OS.z0, OS.x1, OS.z1, cy + 3.0, 1.6, 'x', 0.3, M.slate, M.white); B.box({ p: [(OS.x0 + OS.x1) / 2, cy, OS.z1 + 0.05], s: [1.5, 2.3, 0.1], mat: M.iron, bevel: 0.02, cast: false });
    const FS = { x0: 30, x1: 35, z0: 6, z1: 12 }; B.box({ p: [(FS.x0 + FS.x1) / 2, cy, (FS.z0 + FS.z1) / 2], s: [FS.x1 - FS.x0, 3.2, FS.z1 - FS.z0], mat: M.red, bevel: 0.05, col: 'rock', walk: false, cast: true }); B.box({ p: [(FS.x0 + FS.x1) / 2, cy + 3.2, (FS.z0 + FS.z1) / 2], s: [FS.x1 - FS.x0 + 0.4, 0.2, FS.z1 - FS.z0 + 0.4], mat: M.iron, bevel: 0.02, cast: true }); B.cyl({ p: [(FS.x0 + FS.x1) / 2, cy + 3.4, (FS.z0 + FS.z1) / 2], r: [0.5, 0.2], h: 1.2, seg: 10, mat: M.black, pitch: 0.3, cast: true }); B.cyl({ p: [(FS.x0 + FS.x1) / 2, cy + 4.3, (FS.z0 + FS.z1) / 2 - 0.4], r: [0.16, 0.6], h: 1.6, seg: 10, mat: M.red, roll: 0, pitch: -P / 2 + 0.25, cast: true, anchor: 'center' });
    // low garden/compound walls (stone) with a gate; mast with red light; rain barrel; washing line; lobster pots; derrick
    for (const [a, b] of [[[26, 8], [64, 8]], [[64, 8], [64, 6.6]], [[64, 3.4], [64, -20]], [[26, -30], [64, -30]], [[64, -30], [64, -20]]]) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]); B.box({ p: [(a[0] + b[0]) / 2, 9.3, (a[1] + b[1]) / 2], s: alongX ? [L, 1.0, 0.5] : [0.5, 1.0, L], mat: M.granite, bevel: 0.05, col: false, walk: false, cast: true }); }
    B.cyl({ p: [54, 9.3, 14], r: 0.1, h: 12, seg: 6, mat: M.iron, col: 'metal', cast: true }); K.glare([54, 21.5, 14], 0xff2010, 0.6, 1.3, { blink: [1.8, 0.3], refl: 3, mist: 1.4 }); B.cyl({ p: [59, 9.3, -8], r: 0.4, h: 0.9, seg: 10, mat: M.timber, col: 'wood', cast: true });
    for (let i = 0; i < 5; i++) K.crate(70 + (i % 3) * 1.1, 8.3, 4 + Math.floor(i / 3) * 1.1, 1.0, 0.7, 0.8, M.timber, { slats: false });
    // derrick crane on the jetty (steam-crane style) + winch house + stacked lobster pots + coils/barrels + dinghy on trestles
    derrick(K, M, 90, DY, -8);
    lobsterPots(K, Array.from({ length: 9 }, (_, i) => i < 6 ? [94 + (i % 3) * 1.1, DY, 14 + Math.floor(i / 3) * 1.0, (rng() - 0.5) * 0.25, true] : [94 + (i - 6) * 1.1, DY + 0.6, 14, (rng() - 0.5) * 0.25, false]));
    for (const [x, z] of [[96, 24], [97, 26], [92, -20], [90, 30]]) K.barrel(x, DY, z, M.rustS); K.coil(94, DY, -26, M.rope, { r: 0.5, turns: 5, w: 0.05 }); K.coil(90, DY, 8, M.rope, { r: 0.4 });
    // timber lookout deck on the jetty (3.2 m): sea-side sight line over the swell, stair from the jetty apron
    platform(K, { x0: 86.6, z0: 16, x1: 89, z1: 25, y: DY + 3.2, base: DY, mat: M.timber, frame: M.white, surface: 'wood', legs: 'nsew', rails: 'new', stairs: [{ side: 's', at: 87.8, w: 1.3 }], lamps: [[87.8, DY + 5.3, 20.5, { color: 0xffb45a, cd: 20, dist: 16, size: 0.45, refl: 2.4, flick: 0.2 }]] });
    // steps from the jetty terrace up to the compound (two flights with landings + handrails)
    B.stairs({ p: [88, DY, 6], n: 32, rise: 0.2, run: 0.3, w: 2.2, yaw: P, mat: M.granite, col: 'rock' }); for (const dz of [-1.2, 1.2]) B.beam([88, DY + 0.9, 6 + dz], [78.4, DY + 0.9 + 6.4, 6 + dz], 0.04, 0.04, { mat: M.iron, bevel: 0, cast: false }); for (let i = 0; i <= 8; i++) for (const dz of [-1.2, 1.2]) B.box({ p: [88 - i * 1.2, DY + i * 0.8, 6 + dz], s: [0.05, 0.95, 0.05], mat: M.iron, bevel: 0, cast: false });
    // storm lamps (tungsten lanterns on posts along the jetty; flicker in the wind)
    for (const [x, z] of [[98, -34], [98, -10], [98, 12], [98, 34], [52, 12], [40, -12]]) { const y0 = z > 20 || x < 90 ? (x < 90 ? 9.3 : DY) : DY; const h = K.lampPost(x, z, y0, { h: 4.6, mat: M.iron, glowMat: M.lamp, dir: [-1, 0], arm: 0.6 }); K.lamp(h, { color: 0xffb45a, cd: 24, dist: 20, size: 0.5, refl: 3.2, flick: 0.22, flickSpeed: 13 }); }
    // ------------------------------------------------------------------ gate piers, vegetation (instanced grass tufts on the turf), boulders on the slopes
    for (const z of [3.4, 6.6]) { B.box({ p: [64, 9.3, z], s: [0.7, 1.7, 0.7], mat: M.granite, bevel: 0.05, col: 'rock', walk: false, cast: true }); B.box({ p: [64, 11.0, z], s: [0.9, 0.16, 0.9], mat: M.granite, bevel: 0.03, cast: false }); }
    B.box({ p: [64.3, 9.3, 3.4 + 0.3], s: [0.06, 1.3, 1.5], mat: M.iron, bevel: 0.01, cast: false, yaw: 0.9 });
    const nrm = (x, z) => { const e = 0.8, hx = H(x - e, z) - H(x + e, z), hz = H(x, z - e) - H(x, z + e), l = Math.hypot(hx, 2 * e, hz); return 2 * e / l; };
    const segD = (x, z, a, b) => { const abx = b[0] - a[0], abz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[1]) * abz) / (abx * abx + abz * abz || 1))); return Math.hypot(x - a[0] - abx * t, z - a[1] - abz * t); };
    const pathD = (x, z) => { let d = 1e9; for (const pl of PATHS) for (let i = 0; i < pl.length - 1; i++) d = Math.min(d, segD(x, z, pl[i], pl[i + 1])); return d; };
    const boxes = [[48, -6, 58, 2, 3], [36, -4, 42, 3, 2], [30, 6, 35, 12, 2], [-2, -36, 46, 8, 0]];    // building footprints (+margin) and the lighthouse base circle handled below
    const free = (x, z, m = 0) => { for (const [x0, z0, x1, z1, mg] of boxes.slice(0, 3)) if (x > x0 - mg - m && x < x1 + mg + m && z > z0 - mg - m && z < z1 + mg + m) return false; if (Math.hypot(x - 22, z + 14) < 7.4 + m) return false; if (x > 74) return false; if (Math.abs(x - 44) < 21 && z > -31 && z < 9 && !(x > 24)) return false; return true; };
    K.grass(4200, [8, -36, 76, 18], H, (x, z) => { const y = H(x, z); return y > 4.6 && y < 10.1 && nrm(x, z) > 0.9 && pathD(x, z) > 1.5 && free(x, z, 0.4); }, { H, s0: 0.75, s1: 0.7 });
    K.grass(1400, [-40, -60, 84, 70], H, (x, z) => { const y = H(x, z); return y > 3.2 && y <= 4.6 && nrm(x, z) > 0.86 && pathD(x, z) > 1.5 && free(x, z, 0.4); }, { H, s0: 0.5, s1: 0.6, key: 'grass2' });
    for (let i = 0, n = 0; i < 400 && n < 46; i++) { const x = -34 + rng() * 108, z = -58 + rng() * 116, y = H(x, z); if (y < 1.4 || y > 9.0 || pathD(x, z) < 2.5 || !free(x, z, 2)) continue; if (nrm(x, z) > 0.97 && rng() < 0.7) continue; const r = 0.5 + rng() * 1.5; B.rock({ p: [x, y + r * 0.1, z], r, squash: [1.3, 0.7 + rng() * 0.5, 1.1], amp: 0.55, seed: 60 + n, detail: 3, mat: M.boulder, col: false, cast: true }); n++; }
    for (let i = 0, n = 0; i < 300 && n < 16; i++) { const x = -30 + rng() * 100, z = -56 + rng() * 112, y = H(x, z); if (y < 2.5 || y > 9.0 || pathD(x, z) < 3 || !free(x, z, 3) || nrm(x, z) > 0.93) continue; rockLedge(B, M.boulder, x, y - 0.1, z, 2.2 + rng() * 2.4, 1.4 + rng() * 1.6, 7 + n); n++; }
    // ------------------------------------------------------------------ DRESSING: whitewashed path stones, raised garden beds, wood pile, generator shed + tanks, benches, signpost, washing line, storm flag, extra pots/nets on the jetty
    { const PR = makeProps(K, { wood: M.timber, iron: M.iron, rust: M.rustS, steel: M.iron, rope: M.rope, conc: M.granite, tyre: M.tyre, glass: M.dark, lit: M.lit, black: M.black, net: M.timber }, DY); const Q = P / 2, y = (x, z) => H(x, z);
      const stoneW = M.white; for (const pl of PATHS.slice(0, 3)) for (let i = 0; i < pl.length - 1; i++) { const a = pl[i], b = pl[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(L / 1.15), nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; for (let k = 0; k < n; k++) for (const sd of [-1, 1]) { const t = (k + 0.5) / n, x = a[0] + (b[0] - a[0]) * t + nx * sd * 1.05 + (rng() - 0.5) * 0.15, z = a[1] + (b[1] - a[1]) * t + nz * sd * 1.05 + (rng() - 0.5) * 0.15; if (!free(x, z, -0.5)) continue; B.rock({ p: [x, y(x, z) + 0.05, z], r: 0.16 + rng() * 0.06, squash: [1.3, 0.75, 1], amp: 0.2, seed: 100 + k, detail: 1, mat: stoneW, col: false, cast: true }); } }
      const soil = B.m('lSoil', std({ color: 0x1e1610, roughness: 0.95 })), cab = B.m('lCab', std({ color: 0x3a5a2c, roughness: 0.8 }));
      for (const [x, z, yw] of [[45, -14, 0], [45, -19.5, 0], [52, -14, 0], [52, -19.5, 0]]) { const gy = 9.3; B.box({ p: [x, gy, z], s: [4.4, 0.4, 1.5], mat: M.timber, bevel: 0.02, col: 'wood', walk: false, cast: true }); B.box({ p: [x, gy + 0.36, z], s: [4.1, 0.06, 1.2], mat: soil, bevel: 0.02, cast: false }); for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) B.sphere({ p: [x - 1.7 + i * 0.68, gy + 0.55, z - 0.3 + j * 0.6], r: 0.2 + rng() * 0.07, mat: cab, seg: 7, cast: false }); }
      // wood pile (stacked logs) beside the cottage, generator shed, fuel tanks, drum rack
      for (let r = 0; r < 4; r++) for (let i = 0; i < 9 - r; i++) B.cyl({ p: [60.6 + r * 0.05, 9.3 + 0.13 + r * 0.24, -4.5 + i * 0.27 + r * 0.13], r: 0.12, h: 1.6, seg: 8, mat: M.timber, roll: P / 2, anchor: 'center', cast: true }); B.box({ p: [60.6, 9.3, -4.5 + 1.1], s: [0.1, 1.2, 0.1], mat: M.timber, bevel: 0, cast: false });
      { const G = { x0: 28, x1: 34, z0: -26, z1: -21 }; B.box({ p: [(G.x0 + G.x1) / 2, 9.3, (G.z0 + G.z1) / 2], s: [G.x1 - G.x0, 2.6, G.z1 - G.z0], mat: M.iron, bevel: 0.04, col: 'metal', walk: false, cast: true }); BL.gableRoof(G.x0, G.z0, G.x1, G.z1, 9.3 + 2.6, 1.2, 'x', 0.3, M.slate, M.iron); B.box({ p: [(G.x0 + G.x1) / 2 + 1.5, 9.3, G.z1 + 0.05], s: [1.6, 2.2, 0.1], mat: M.timber, bevel: 0.02, cast: false }); B.cyl({ p: [G.x0 + 1, 9.3 + 2.6, G.z0 + 1], r: 0.14, h: 1.4, seg: 8, mat: M.iron, cast: true }); B.box({ p: [(G.x0 + G.x1) / 2 - 1.2, 9.3 + 1.3, G.z1 + 0.06], s: [0.9, 0.8, 0.05], mat: M.lit, bevel: 0, cast: false }); K.glare([(G.x0 + G.x1) / 2 - 1.2, 9.3 + 1.3, G.z1 + 0.6], 0xffb45a, 0.35, 0.5, { refl: 1, mist: 0.9 }); }
      PR.tank(46, -25.5, 0, { y: 9.3, r: 0.8, len: 3.6, mat: M.iron }); PR.drumRack(56, -25.5, Q, { y: 9.3 }); PR.generator(38, -23.8, 0, { y: 9.3 });
      // benches + bins + signpost on the plateau path, storm flag on a tall pole, washing line
      PR.bench(52.5, 4.9, P, { y: 9.3, len: 1.7 }); PR.bench(26.5, -5.5, Q, { y: y(26.5, -5.5) }); PR.bin(56.5, 4.6, { y: 9.3 });
      B.cyl({ p: [76.2, 8.4, 3.6], r: 0.06, h: 1.9, seg: 6, mat: M.timber, cast: true }); K.sign(['LIGHTHOUSE ROCK', 'KEEP TO THE PATH'], [76.2, 10.0, 3.66], [1.2, 0.5, 0.05], { bg: '#f0ecdc', fg: '#20242a', weather: 0.5, w: 512 });
      B.cyl({ p: [61.5, 9.3, -12], r: 0.09, h: 7.5, seg: 8, mat: M.iron, col: 'metal', cast: true }); { const fm = std({ color: 0x9a1c18, roughness: 0.8, side: THREE.DoubleSide, wind: { amp: 0.16, freq: 5, stiff: 'uv' }, key: 'lhFlag' }); const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1, 12, 4), fm); fl.position.set(62.4, 9.3 + 6.9, -12); B.group.add(fl); }
      for (const x of [40, 46]) B.cyl({ p: [x, 9.3, -3.5], r: 0.05, h: 2.2, seg: 6, mat: M.timber, cast: false }); B.cable([40, 9.3 + 2.1, -3.5], [46, 9.3 + 2.1, -3.5], 0.3, 0.012, M.rope, { n: 8, cast: false }); for (let i = 0; i < 4; i++) B.box({ p: [40.9 + i * 1.3, 9.3 + 1.2, -3.5], s: [0.5, 0.85, 0.03], mat: i % 2 ? M.white : M.red, bevel: 0, cast: false });
      // jetty: more pots, nets, a mooring capstan, life-buoy cabinet, coils
      PR.pots(96, -26, 0, { y: DY, n: 6 }); PR.pots(93, -32, Q, { y: DY, n: 4 }); PR.pots(97.5, 36, 0, { y: DY, n: 6 }); PR.netHeap(95.5, -14, { y: DY }); PR.netHeap(94, 30, { y: DY, r: 1.1 }); PR.netHeap(97, -38, { y: DY });
      B.cyl({ p: [92.5, DY, 20], r: [0.3, 0.22], h: 0.7, seg: 12, mat: M.iron, col: 'metal', cast: true }); B.cyl({ p: [92.5, DY + 0.7, 20], r: 0.34, h: 0.1, seg: 12, mat: M.iron, cast: false }); B.box({ p: [90, DY, -4], s: [0.9, 1.6, 0.35], mat: M.red, bevel: 0.02, col: 'metal', walk: false, cast: false }); K.tyre(90, DY + 1.1, -3.8, M.white, { axis: 'z', r: 0.3, t: 0.07 });
    }
    // ------------------------------------------------------------------ dinghy hauled up, plus the bell buoy (floating, animated)
    const dinghy = makeBoat(ctx, { L: 5.2, HB: 0.85, free: 0.55, draft: 0.3, bow: 0.9, stern: 0.7, bulwark: 0.3, sheer: 0.3, seed: 8, mats: { top: M.timber, bottom: M.timber, deck: M.timber, cabin: M.timber, trim: M.iron, dark: M.dark, lit: M.lit } }); dinghy.group.position.set(84, 1.0, -30 + 0); dinghy.group.rotation.set(0.1, 0.4, 0.15); B.group.add(dinghy.group);
    const buoy = new THREE.Group(); { const bb = new Builder({ synth: ctx.synth, group: buoy, seed: 5, cell: 100 }); const rd = M.red, wh = M.white; bb.lathe({ p: [0, -0.9, 0], profile: [[0, 0], [1.4, 0], [1.5, 0.15], [1.4, 0.5], [0.9, 1.0], [0.55, 1.15], [0.5, 1.3]], seg: 16, mat: rd, cast: true }); for (const a of [0, 1.57, 3.14, 4.71]) bb.beam([Math.cos(a) * 0.5, 1.3, Math.sin(a) * 0.5], [Math.cos(a) * 0.15, 3.2, Math.sin(a) * 0.15], 0.07, 0.07, { mat: M.iron, bevel: 0, cast: false }); bb.cyl({ p: [0, 3.0, 0], r: 0.22, h: 0.5, seg: 8, mat: M.lit, cast: false }); bb.lathe({ p: [0, 1.7, 0], profile: [[0.3, 0], [0.38, 0.15], [0.3, 0.35], [0, 0.4]], seg: 10, mat: M.brass, cast: false }); bb.finish(); buoy.userData.halo = K.glows.add([0, 0, 0], 0xff3020, 0.5, 1.2, 0, { mist: 1.6, blink: [2.2, 0.3] }); }
    const BUOY = [118, -34]; buoy.position.set(BUOY[0], 0, BUOY[1]); B.group.add(buoy); const buoyGI = buoy.userData.halo; const buoyBase = K.glows.pos;
    // ------------------------------------------------------------------ weather: heavy wind-driven rain + sea-mist wisps
    ctx.weather({ count: 6000, box: [38, 24, 38], fall: 13, wind: null, size: 0.032, turb: 0.3, streak: 22, color: [0.62, 0.7, 0.85], alpha: 0.5, cell: 13, seed: 14 });
    decalAtlas(K, [
      { x: 84, z: -42, w: 19, d: 21, kind: 'jetty', y: DY + 0.014, rust: [[102, -17], [102, -7.2]], rustDir: Math.PI, paths: [[[98, -2], [97, -26]]], litter: 1.0 },
      { x: 84, z: -21, w: 19, d: 21, kind: 'jetty', y: DY + 0.014, rust: [[102, -7.2], [102, 7.2]], rustDir: Math.PI, paths: [[[98, -2], [92, 4], [88, 6]]], litter: 1.0 },
      { x: 84, z: 0, w: 19, d: 21, kind: 'jetty', y: DY + 0.014, rust: [[102, 7.2], [102, 17]], rustDir: Math.PI, litter: 1.0 },
      { x: 84, z: 21, w: 19, d: 21, kind: 'jetty', y: DY + 0.014, litter: 1.0 }], { seed: 14 });
    K.finishFoam();
    // ------------------------------------------------------------------ gameplay data
    const gulls = makeGulls(B, 12, { cx: 60, cz: 0, rx: 110, rz: 90, perched: 6, rng, spots: [[JX - 1.4, DY + 0.72, -12], [JX - 1.4, DY + 0.72, 12], [JX - 1.4, DY + 0.72, 38], [JX - 1.4, DY + 0.72, -36], [92.5, DY + 0.78, 20], [22, GY + 1.25, -14 + 5.2]] });
    const spawns = [...K.spawns]; for (const z of [-56, 56]) spawns.push({ kind: 'walk', pos: [88, DY, z], yaw: z < 0 ? P : 0, note: 'rocks' }); spawns.push({ kind: 'walk', pos: [16, 9.4, 14], yaw: 0, note: 'plateau west' }, { kind: 'walk', pos: [56, 9.4, -26], yaw: P, note: 'plateau north' });
    const splash = { t: 0 }, smoke = { t: 0 }; let nextFlash = 3 + rand() * 6, flash = 0, flashDir = 0; const cam = gfx.camera.position; const V = new THREE.Vector3();
    const data = {
      atmo: ATMO[IDX], reflect: { level: DY }, envPatches: ENV[IDX], playerStart: { pos: [98.5, DY, -2], yaw: P / 2 }, station: { pos: ST.stationLocal, yaw: ST.yaw }, groundY: -3.5, waterY: 0, waterHeight: (wx, wz) => sea.height(wx, wz), heightFn: H, groundSurface: 'rock', surfaceAt: (x, z) => (H(x, z) > 8.2 ? 'gravel' : 'rock'),
      navBounds: [-40, -50, 102, 60], navBlocked: (x, z, gy) => gy < 0.7, navCell: 0.7, landmark: { pos: [LX, GY + 3, LZ], name: 'Lighthouse' }, mooring: [17, 7.2, -7.2, -17].map((a) => ST.toLocal(a, BEAM_HALF + FENDER + 1.1)),
      spawns, buys: { walls: [{ pos: [(C.x0 + C.x1) / 2 - 2, cy + 1.6, C.z1 + 0.06], yaw: 0, gun: 'olympia' }, { pos: [OS.x0 - 0.06, cy + 1.6, 0], yaw: -P / 2, gun: 'mp5' }], perks: [{ pos: [102, DY, 14], yaw: -P / 2, perk: 'quickrevive' }], box: { pos: [92, DY, 4], yaw: -P / 2 } },
      zombieVariants: [{ id: 'ferry_keeper', weight: 2, minRound: 1 }, { id: 'ferry_drowned', weight: 3, minRound: 1 }, { id: 'ferry_sailor', weight: 2, minRound: 1 }],
      ambient: { space: 'open', gain: 1, beds: [{ type: 'water', gain: 0.9, lap: 1.4 }, { type: 'wind', gain: 0.7, gust: 0.7 }, { type: 'rumble', gain: 0.25 }], events: [{ type: 'bell', every: [2.5, 5], gain: 0.9, pos: [BUOY[0], 2, BUOY[1]] }, { type: 'foghorn', every: [16, 30], gain: 1.0, pos: [FS.x0, 12, FS.z0] }, { type: 'thunder', every: [14, 32], gain: 0.9, pos: 'far' }, { type: 'gust', every: [6, 14], gain: 0.8 }, { type: 'creak', every: [5, 12], gain: 0.5 }, { type: 'rockfall', every: [40, 80], gain: 0.3, pos: 'far' }] },
      update(dt, t, active) {
        gulls.update(t);
        sea.tick(t, cam, gfx); const ang = LH.angle(t); lens.rotation.y = -ang; const dx = Math.cos(ang), dz = Math.sin(ang); spot.dir.set(dx, -0.04, dz); spot2.dir.set(-dx, -0.04, -dz);
        // lantern glare flares as a beam sweeps past the camera
        V.set(cam.x - lampWorld[0], 0, cam.z - lampWorld[2]); const dl = V.length() || 1; const al = Math.max(0, (V.x * dx + V.z * dz) / dl), al2 = Math.max(0, -(V.x * dx + V.z * dz) / dl); const fl = 0.35 + 3.2 * Math.pow(Math.max(al, al2), 14); K.glows.setLevel(gi, fl);
        // bell buoy bobbing
        { const by = sea.height(ctx.origin.x + BUOY[0], ctx.origin.z + BUOY[1], t); const bx = sea.height(ctx.origin.x + BUOY[0] + 1.5, ctx.origin.z + BUOY[1], t), bz = sea.height(ctx.origin.x + BUOY[0], ctx.origin.z + BUOY[1] + 1.5, t); buoy.position.y = by; buoy.rotation.set(Math.atan2(bz - by, 1.5) * 0.8, 0, -Math.atan2(bx - by, 1.5) * 0.8); K.glows.setPos(buoyGI, BUOY[0], by + 3.3, BUOY[1]); }
        // lightning: random flashes lighting the sky (uLightning) + thunder handled by ambience
        nextFlash -= dt; if (nextFlash <= 0) { flash = 1; nextFlash = 5 + rand() * 14; } flash = Math.max(0, flash - dt * 2.2); const fv = flash > 0.5 ? (Math.sin(t * 90) > -0.2 ? 1 : 0.3) * flash : flash * 0.6; if (gfx.sky && gfx.sky.uniforms.uLightning) gfx.sky.uniforms.uLightning.value = fv * 0.5;
        if (!active) return; const o = ctx.origin;
        // surf spray: bursts at shore points where a crest arrives
        splash.t -= dt; if (splash.t <= 0) { splash.t = 0.05; for (let n = 0; n < 3; n++) { const p = shore[(rand() * shore.length) | 0]; if (p[0] > 78 && Math.abs(p[1]) < 46) continue; const px = p[0] + Math.cos(p[2]) * 2.5 * 1.3, pz = p[1] + Math.sin(p[2]) * 2.5; const hh = sea.height(o.x + px, o.z + pz, t); if (hh > 0.55 * sea.amp) { const nx = -Math.cos(p[2]), nz = -Math.sin(p[2]); for (let i = 0; i < 9; i++) fx.alpha.emit({ p: [o.x + px, hh, o.z + pz], v: [nx * (1 + rand() * 3) + (rand() - 0.5) * 2, 3 + rand() * 6, nz * (1 + rand() * 3) + (rand() - 0.5) * 2], life: 1.2 + rand(), size: [0.1, 0.7 + rand() * 0.7], c0: [0.55, 0.62, 0.7, 0.55], c1: [0.55, 0.62, 0.7, 0], gravity: 0.7, drag: 0.4, cell: rand() < 0.5 ? 7 : 9, wind: 0.6 }, fx.time); } } }
        smoke.t += dt; if (smoke.t > 0.08) { smoke.t = 0; fx.alpha.emit({ p: [o.x + C.x0 + 1.6, o.y + cy + 9.6, o.z + C.z0 + 1.2], v: [0, 0.8, 0], life: 3, size: [0.3, 1.6], c0: [0.05, 0.05, 0.05, 0.4], c1: [0.08, 0.08, 0.08, 0], drag: 0.4, cell: 1, wind: 1.6, gravity: -0.05 }, fx.time); }
      },
    };
    for (const w of data.buys.walls) K.wallLamp(w.pos[0], w.pos[1], w.pos[2], Math.sin(w.yaw), Math.cos(w.yaw), { color: 0xffb45a, mat: M.iron, cd: 18 });
    return data;
  },
};
