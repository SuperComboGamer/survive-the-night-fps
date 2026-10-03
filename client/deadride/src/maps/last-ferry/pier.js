// LAST FERRY — Stop 1: CITY PIER. Sodium-lit old timber-and-iron pier, brick warehouse row, dockside portal crane, 'FERRY' terminal, 1950s trucks, rain-slick planks, mist.
// Landmark: the tall portal crane + the big lit FERRY sign. Ferry berth: north face (ferry heads east, quay on its starboard = south).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { rand, makeRng } from '../../core/util.js';
import { STOPS, BEAM_HALF, FENDER } from './layout.js';
import { ATMO, ENV } from './atmos.js';
import { getSea, withLampRefl } from './shared.js';
import { makeKit, puddleMaterial, fitTex, towerTexture } from './kit.js';
import { makeBuilding } from './bld.js';
import { truck, container, portalCrane, frame } from './pierProps.js';
import { makeProps } from './props2.js';
import { platform } from './cover.js';
import { decalAtlas } from './decals.js';
import { makeGulls } from './wharfProps.js';
import { facadeReal, rollerDoor, modelTower, wagonDetail, rope3 } from './arch.js';
import { ribbedUnder } from './real.js';
import { stubStop, skipStop } from './stub.js';

const P = Math.PI, IDX = 0, ST = STOPS[0], QZ = ST.quayFace, DY = ST.quayY;   // quay face z = -103.2, deck top 1.9

export default {
  id: 'pier', name: 'City Pier', origin: ST.origin, viewRadius: 330,
  async build(ctx) {
    if (skipStop(IDX)) return stubStop(ctx, IDX, this);
    const { B, fx, gfx } = ctx; const sea = getSea(); sea.attach(ctx.world.root); const K = makeKit(ctx, IDX); const rng = K.rng; const bld = { mats: null };
    // ------------------------------------------------------------------ materials
    const M = {};
    M.deck = B.m('deck', { pattern: 'planks', size: 1024, tile: 2, colors: [0x6a5238, 0x3c2d1d, 0x120c07], params: { rows: 8, gap: 0.006, grain: 8, knots: 0.35, cols: 1, vertical: 1, weather: 0.9, nails: 1 }, bump: 5, rough: [0.6, 0.9], layers: { grime: 0.55, dust: 0.1, wet: 0.35, streak: 0.3 } }, { wet: true, breakup: 0.5, refl: 1, frag: 'roughnessFactor = max(roughnessFactor, 0.3);' }); withLampRefl(M.deck, { gain: 0.6, maxRough: 0.8, patchy: 0.7 });
    M.wall = B.m('pierWall', { pattern: 'planks', size: 512, tile: 2, colors: [0x3b2c1c, 0x241a10, 0x0a0705], params: { rows: 9, gap: 0.008, grain: 8, knots: 0.3, cols: 1, vertical: 1, weather: 0.6, nails: 1 }, bump: 5, rough: [0.7, 0.95], layers: { grime: 0.7, moss: 0.35, streak: 0.5 }, mossColor: 0x2f4a24 }, { wet: true });
    M.pile = B.m('pile', { pattern: 'wood', size: 512, tile: 1.2, colors: [0x33261a, 0x120d08], params: { scale: 14, rings: 9, knots: 0.5, weather: 0.5, vertical: 0 }, bump: 6, rough: [0.7, 0.95], layers: { moss: 0.5, grime: 0.6, streak: 0.4 }, mossColor: 0x2c4422 }, { wet: true });
    M.iron = B.m('iron', { pattern: 'plates', size: 256, tile: 2, colors: [0x2d3132, 0x202426, 0x101213], rustColor: 0x5a2f18, params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.4, panelVar: 0.4 }, bump: 2, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.45, grime: 0.6, edge: 0.4, scratch: 0.3, streak: 0.6 } }, { wet: true });
    M.rust = B.m('rust', { pattern: 'plates', size: 256, tile: 2, colors: [0x5b3421, 0x452617, 0x1a0e08], rustColor: 0x6a3418, params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.3, panelVar: 0.5 }, bump: 3, metal: 0.45, rough: [0.5, 0.85], layers: { rust: 0.8, grime: 0.6, streak: 0.5, edge: 0.3 } });
    M.brick = B.m('brick', { pattern: 'bricks', size: 1024, tile: 2, colors: [0x7a3a29, 0x5a2b1f, 0x6c655a], params: { rows: 26, cols: 8, mortar: 0.006, variation: 0.75, chips: 0.5, moss: 0.05, soot: 0.65 }, bump: 5, rough: [0.75, 0.97], layers: { grime: 0.6, streak: 0.7, moss: 0.1 } }, { breakup: 0.6, wet: true });
    M.roof = B.m('roofCorr', { pattern: 'corrugated', size: 512, tile: 2, colors: [0x4d4a44, 0x36332e], rustColor: 0x52301a, params: { ribs: 12, depth: 1, vertical: 0, dents: 1 }, bump: 22, metal: 0.45, rough: [0.45, 0.8], layers: { rust: 0.6, streak: 0.8, grime: 0.6 } }, { breakup: 0.5, wet: true });
    M.cobble = B.m('cobble', { pattern: 'stone', size: 512, tile: 2, colors: [0x4a4a48, 0x3a3a3a, 0x121212, 0x6a655c], params: { scale: 14, gap: 0.09, round: 0.5, variation: 0.6, mortarDark: 0.6, strata: 0, lichen: 0.05 }, bump: 14, rough: [0.4, 0.8], layers: { grime: 0.5, wet: 0.5, oil: 0.3 } }, { wet: true, breakup: 0.5, refl: 1, detail: 'gravel', frag: 'roughnessFactor = max(roughnessFactor, 0.38);' }); withLampRefl(M.cobble, { gain: 0.3, maxRough: 0.8, patchy: 0.8 });
    M.conc = B.m('conc', { pattern: 'noise', size: 512, tile: 3, colors: [0x6a6963, 0x55534e, 0x2c2b28, 0x8a877e], params: { scale: 5, contrast: 3, fine: 96, speckle: 0.04, pores: 0.5, panels: 3, panelWidth: 0.003 }, bump: 3, rough: [0.7, 0.95], layers: { grime: 0.6, cracks: 0.4, streak: 0.5, moss: 0.15 } }, { breakup: 0.5, wet: true });
    M.rope = B.m('rope', { pattern: 'weave', size: 256, tile: 0.25, colors: [0x8a7a58, 0x5a4e36], params: { threads: 24, twill: 1, variation: 0.6, fuzz: 0.5 }, bump: 2, rough: [0.85, 1], layers: { grime: 0.5 } });
    M.tyre = B.m('tyre', { pattern: 'rubber', size: 256, tile: 0.5, colors: [0x141414, 0x1e1e1e], params: { scale: 8, tread: 0.6 }, bump: 1.5, rough: [0.8, 0.95], layers: { grime: 0.4, dust: 0.3 } });
    M.tar = B.m('tarp', { pattern: 'weave', size: 256, tile: 0.4, colors: [0x2b3a2d, 0x1c281f], params: { threads: 48, twill: 0, variation: 0.4, fuzz: 0.4, ripstop: 0.3 }, bump: 1, rough: [0.5, 0.75], layers: { grime: 0.5, wet: 0.6 } }, { wet: true });
    M.timber = B.m('timberBoard', { pattern: 'planks', size: 512, tile: 2, colors: [0x8a7a5c, 0x6a5a40, 0x2a2318], params: { rows: 10, gap: 0.005, grain: 8, knots: 0.3, cols: 1, vertical: 0, weather: 0.9, nails: 1 }, bump: 4, rough: [0.7, 0.95], layers: { grime: 0.5, streak: 0.5 } }, { wet: true });
    M.crane = B.m('craneBody', { pattern: 'plates', size: 512, tile: 3, colors: [0x2d4a3c, 0x233a2f, 0x0d1712], rustColor: 0x5a3018, params: { cols: 3, rows: 3, seam: 0.008, rivets: 10, brushed: 0.3, panelVar: 0.5 }, bump: 3, metal: 0.45, rough: [0.45, 0.8], layers: { rust: 0.3, grime: 0.6, edge: 0.4, streak: 0.7, scratch: 0.3 } }, { wet: true });
    M.craneCream = B.m('craneCream', { pattern: 'plates', size: 256, tile: 2, colors: [0xcfc6a8, 0xb5ac90, 0x6a6350], params: { cols: 2, rows: 2, seam: 0.006, rivets: 6, brushed: 0.2, panelVar: 0.3 }, bump: 2, metal: 0.4, rough: [0.45, 0.8], layers: { rust: 0.2, grime: 0.6, streak: 0.8 } });
    M.craneJib = B.m('craneJib', { pattern: 'plates', size: 256, tile: 2, colors: [0xa8321f, 0x852416, 0x3a100a], rustColor: 0x5a2a14, params: { cols: 2, rows: 2, seam: 0.008, rivets: 6, brushed: 0.3, panelVar: 0.4 }, bump: 2, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.35, grime: 0.5, edge: 0.4, streak: 0.6 } });
    const ctn = (n, c0, c1) => B.m(n, { pattern: 'corrugated', size: 256, tile: 2, colors: [c0, c1], rustColor: 0x5a2f18, params: { ribs: 20, depth: 1, vertical: 1, dents: 1.2 }, bump: 10, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.5, grime: 0.6, streak: 0.8, scratch: 0.4 } }, { wet: true });
    M.ct = [ctn('ct0', 0x6a2a20, 0x4a1c14), ctn('ct1', 0x2a4a5a, 0x1e3642), ctn('ct2', 0x8a6a2a, 0x64491c), ctn('ct3', 0x3a5a3a, 0x284028)];
    M.lit = B.m('litWin', std({ color: 0x000000, emissive: 0xffb45a, emissiveIntensity: 1.5, roughness: 0.4 }));
    M.lit2 = B.m('litWin2', std({ color: 0x000000, emissive: 0xffd08a, emissiveIntensity: 1.15, roughness: 0.4 }));
    M.dark = B.m('darkGlass', std({ color: 0x06090c, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.5 }));
    M.reveal = B.m('reveal', std({ color: 0x040404, roughness: 1 }));
    M.frame = B.m('winFrame', std({ color: 0x2a2620, roughness: 0.6, metalness: 0.3 }));
    M.stone = B.m('stoneTrim', { pattern: 'noise', size: 256, tile: 2, colors: [0x86827a, 0x6a675f, 0x2c2a26, 0xa09c92], params: { scale: 6, contrast: 2, fine: 64, speckle: 0.02, pores: 0.3 }, bump: 3, rough: [0.7, 0.95], layers: { grime: 0.6, streak: 0.6 } });
    M.lampGlow = B.m('lampGlow', std({ color: 0x000000, emissive: 0xffa848, emissiveIntensity: 11, roughness: 0.4 }));
    M.steel = B.m('steelP', std({ color: 0x9aa0a3, roughness: 0.35, metalness: 1 }));
    const paint = (n, c) => B.m(n, { pattern: 'plates', size: 256, tile: 2, colors: [c, c, 0x101010], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2, panelVar: 0.1 }, bump: 1, metal: 0.06, rough: [0.24, 0.5], layers: { grime: 0.5, rust: 0.12, scratch: 0.4, streak: 0.6, edge: 0.3 } }, { wet: true });
    const trk = { paint: paint('truckCream', 0xc9bf9a), paint2: paint('truckRed', 0x8a2a1c), paint3: paint('truckGreen', 0x2f5a44), chrome: B.m('chromeP', std({ color: 0xd0d4d6, roughness: 0.16, metalness: 1 })), black: B.m('blackP', std({ color: 0x0c0d0e, roughness: 0.55, metalness: 0.5 })), glass: M.dark, tyre: M.tyre, wood: M.timber, lampOn: B.m('lampOnT', std({ color: 0x000000, emissive: 0xffe2a8, emissiveIntensity: 8 })), lampRed: B.m('lampRedT', std({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 6 })), steel: M.steel };
    const puddle = puddleMaterial(B, 'puddle', 0x05070a, 0x30200f);
    bld.mats = { wall: M.brick, roof: M.roof, trim: M.stone, lit: M.lit, dark: M.dark, reveal: M.reveal, frame: M.frame, stone: M.stone, iron: M.iron }; const BL = makeBuilding(K, bld.mats);

    // ------------------------------------------------------------------ ground: pier deck (timber), street (cobbles), quay wall + piles + wales + fenders + ladders
    const XW = 150, ZS = -50;                                   // structure half-length reference, street south edge
    B.box({ p: [0, -3.2, (QZ + ZS) / 2], s: [XW * 2, DY + 3.2 - 0.02, ZS - QZ], mat: M.wall, col: 'wood' });                   // solid body (walkable top at DY-0.02)
    B.plane({ p: [0, DY + 0.003, (QZ + -79.5) / 2], s: [XW * 2, -79.5 - QZ], mat: M.deck, cast: false });                      // timber deck planks
    B.plane({ p: [0, DY + 0.003, (-79.5 + ZS) / 2], s: [XW * 2, ZS + 79.5], mat: M.cobble, cast: false });                     // cobbled street
    B.box({ p: [0, DY - 0.01, -79.6], s: [XW * 2, 0.02, 0.5], mat: M.stone, bevel: 0.01, cast: false });                        // kerb between deck and street
    // real deck boards on the ferry apron (x -26..66, z quay..-87): 170-220 mm boards, 6 mm gaps, staggered butt joints, per-board height / tilt jitter (same programme as the deck material)
    M.board = B.m('board', { pattern: 'wood', size: 512, tile: 1.4, colors: [0x6a5238, 0x3c2d1d, 0x120c07], params: { scale: 9, rings: 8, knots: 0.35, weather: 0.9, vertical: 0 }, bump: 5, rough: [0.6, 0.9], layers: { grime: 0.55, dust: 0.1, wet: 0.35, streak: 0.3 } }, { wet: true, breakup: 0.5, refl: 1, frag: 'roughnessFactor = max(roughnessFactor, 0.3);' }); withLampRefl(M.board, { gain: 0.6, maxRough: 0.8, patchy: 0.7 });
    for (let bz = QZ + 0.55; bz < -89;) { const wd = 0.17 + rng() * 0.05; let bx = -18 - rng() * 3; while (bx < 58) { const len = 2.4 + rng() * 2.8, x1 = Math.min(58, bx + len); B.box({ p: [(bx + x1) / 2, DY - 0.035 + (rng() - 0.5) * 0.008, bz + wd / 2], s: [x1 - bx - 0.008, 0.045, wd - 0.006], mat: M.board, bevel: 0, col: false, cast: false, yaw: (rng() - 0.5) * 0.004 }); bx = x1; } bz += wd; }
    B.colliders.groundY = -3; B.colliders.waterY = 0; B.colliders.groundSurface = 'wood';
    B.colliders.surfaceAt = (x, z) => (z > -80 ? 'gravel' : 'wood');
    const ladderX = [-66, -56, -34, -26, 27, 35, 52, 66]; const inRecess = (x) => ladderX.some((lx) => Math.abs(x - lx) < 0.9);
    // fascia: wales, kerb log, piles, tyres, bollards
    const seg = (a, b, fn) => { let x = a; for (const lx of ladderX.concat([1e9])) { if (lx > a && lx - 0.9 > x) { fn(x, Math.min(lx - 0.9, b)); } x = lx + 0.9; if (x >= b) break; } };
    for (let x = -XW; x < XW; x += 3.0) { if (inRecess(x)) continue; K.pile(x, -3.2, DY + 0.28, QZ - 0.45, 0.24, M.pile); if (Math.abs(x) < 80) K.pileFoam(x, QZ - 0.45, 0.24, 0.8); }
    let lastX = -XW; for (const lx of ladderX.concat([XW])) { const a = lastX, b = lx - 0.95; if (b - a > 0.5) { for (const y of [0.85, -0.45]) B.box({ p: [(a + b) / 2, y, QZ - 0.17], s: [b - a, 0.3, 0.3], mat: M.pile, bevel: 0.02, cast: false }); B.box({ p: [(a + b) / 2, DY - 0.04, QZ + 0.16], s: [b - a, 0.3, 0.36], mat: M.pile, bevel: 0.03, cast: false }); } lastX = lx + 0.95; }
    for (const x of [-78, -46, -44.5, 15, 44.5, 78]) if (!inRecess(x) && Math.abs(x) > 24) K.tyre(x, 0.55, QZ - 0.85, M.tyre, { axis: 'z', r: 0.4, t: 0.15 });
    for (const x of [-84, -72, -60, -46, -30, -14, 14, 30, 46, 60, 72, 84]) K.bollard(x, DY, QZ + 1.1, M.iron);
    for (const a of [17, 7.2, -7.2, -17]) K.bollard(a, DY, QZ + 1.1 + 0, M.iron, { h: 0.6, r: 0.19 });
    // ladders down the north face + pier ends (zombie signature)
    const steel = M.iron; for (const x of ladderX) K.ladder([x, QZ], [0, -1], DY, steel);
    K.quayFoam([-XW, QZ - 0.05], [XW, QZ - 0.05], 1.6, 0.75, 3);
    // end faces of the timber pier (x = +-74): short return walls with ladders
    for (const sx of [-1, 1]) { K.ladder([sx * 74, -96], [sx, 0], DY, steel); }
    // wall along the deck ends + invisible edge colliders (player can't walk off): north edge (gap at ladders), ends
    { let a = -XW; for (const lx of ladderX.concat([XW + 1])) { const b = lx - 1.2; if (b - a > 0.3) K.wallCol([a, QZ + 0.25], [b, QZ + 0.25], DY, DY + 1.3, 0.3, 'wood'); a = lx + 1.2; } }
    for (const sx of [-1, 1]) { K.wallCol([sx * 74.5, QZ + 0.25], [sx * 74.5, -50], DY, DY + 1.6, 0.4, 'metal'); }
    K.wallCol([-74.5, ZS - 0.2], [74.5, ZS - 0.2], DY, DY + 1.6, 0.4, 'brick');

    // ------------------------------------------------------------------ rails (crane tracks) + wagons
    const RZ = [-100.3, -92.7]; for (const z of RZ) for (const s of [-0.7175, 0.7175]) { B.box({ p: [-48, DY, z + s], s: [52, 0.09, 0.07], mat: M.steel, bevel: 0.01, cast: false }); B.box({ p: [-48, DY, z + s * 1.45], s: [52, 0.02, 0.11], mat: M.reveal, bevel: 0, cast: false }); }
    for (const z of RZ) { B.box({ p: [-21.5, DY, z], s: [0.5, 0.6, 1.9], mat: M.iron, bevel: 0.03, col: 'metal' }); B.box({ p: [-74.2, DY, z], s: [0.5, 0.6, 1.9], mat: M.iron, bevel: 0.03, col: 'metal' }); }
    const wagon = (cx, z, kind) => { const wy = DY + 0.42; wagonDetail(B, M.iron, M.steel, cx, z, wy); for (const dx of [-3.4, -2.3, 2.3, 3.4]) for (const sd of [-1, 1]) B.cyl({ p: [cx + dx, wy, z + sd * 0.72], r: 0.42, h: 0.1, seg: 14, mat: M.iron, pitch: P / 2, anchor: 'center', cast: false }); B.box({ p: [cx, wy - 0.15, z], s: [9.4, 0.32, 2.1], mat: M.iron, bevel: 0.02, col: 'metal' });
      for (const sx of [-1, 1]) { B.box({ p: [cx + sx * 4.85, wy - 0.05, z - 0.8], s: [0.35, 0.1, 0.14], mat: M.iron, bevel: 0.01, cast: false }); B.box({ p: [cx + sx * 4.85, wy - 0.05, z + 0.8], s: [0.35, 0.1, 0.14], mat: M.iron, bevel: 0.01, cast: false }); B.cyl({ p: [cx + sx * 4.95, wy - 0.05, z - 0.8], r: 0.13, h: 0.05, seg: 8, mat: M.steel, pitch: 0, roll: P / 2, anchor: 'center', cast: false }); B.cyl({ p: [cx + sx * 4.95, wy - 0.05, z + 0.8], r: 0.13, h: 0.05, seg: 8, mat: M.steel, roll: P / 2, anchor: 'center', cast: false }); }
      if (kind === 'box') { B.box({ p: [cx, wy + 0.17, z], s: [9.0, 2.7, 2.7], mat: M.timber, bevel: 0.03, col: 'wood', walk: false }); B.box({ p: [cx, wy + 2.87, z], s: [9.3, 0.25, 2.9], mat: M.iron, bevel: 0.05, cast: true }); for (const zz of [-1, 1]) B.box({ p: [cx - 1.5, wy + 0.2, z + zz * 1.37], s: [3.2, 2.5, 0.06], mat: M.rust, bevel: 0, cast: false }); K.sign(['PORT RAILWAY', 'No. 4471'], [cx + 2.6, wy + 1.2, z + 1.4], [2.4, 0.5, 0.03], { bg: '#4a1c14', fg: '#d8c8a0', weather: 0.8, w: 512 }); }
      else { for (const [dx, dz, w, h, d] of [[-2.5, 0.2, 1.6, 1.1, 1.3], [-0.6, -0.3, 1.2, 0.9, 1.4], [1.6, 0.2, 1.9, 1.3, 1.5]]) K.crate(cx + dx, wy + 0.17, z + dz, w, h, d, M.timber, { batten: M.iron }); for (const [dx, dz] of [[3.3, -0.5], [3.3, 0.4]]) K.barrel(cx + dx, wy + 0.17, z + dz, M.rust); B.box({ p: [cx + 2, wy + 1.42, z + 0.2], s: [2.0, 0.08, 1.6], mat: M.tar, bevel: 0.04, cast: false }); } };
    wagon(-31, RZ[1], 'box'); wagon(-63, RZ[0], 'flat');
    const craneParts = portalCrane(K, { body: M.crane, dark: M.iron, cream: M.craneCream, jib: M.craneJib, rope: M.rope, lit: M.lit, conc: M.conc }, -46.2, -96.5, { y: DY });

    // ------------------------------------------------------------------ FERRY TERMINAL (timber + corrugated), canopy over the apron, big lit FERRY sign
    const T = { x0: -20, x1: 22, z0: -90, z1: -82.5, h: 5.6 };
    B.box({ p: [(T.x0 + T.x1) / 2, DY, (T.z0 + T.z1) / 2], s: [T.x1 - T.x0, T.h, T.z1 - T.z0], mat: M.timber, bevel: 0.03, col: 'wood', walk: false, cast: true });
    BL.gableRoof(T.x0, T.z0, T.x1, T.z1, DY + T.h, 2.6, 'x', 0.5, M.roof, M.timber);
    // canopy over the apron (sloping iron roof on columns)
    B.box({ p: [(T.x0 + T.x1) / 2 + 1, DY + 4.7, T.z0 - 3.3], s: [T.x1 - T.x0 + 3, 0.1, 7], mat: M.roof, roll: 0, pitch: 0.09, bevel: 0, col: false, cast: true });
    ribbedUnder(B, M.roof, (T.x0 + T.x1) / 2 + 1, T.z0 - 3.3, T.x1 - T.x0 + 3, 6.95, DY + 4.645, 0.09);
    for (let x = T.x0 + 1; x <= T.x1 + 1; x += 6) { B.cyl({ p: [x, DY, T.z0 - 6.4], r: 0.14, h: 4.55, seg: 8, mat: M.iron, col: 'metal' }); B.box({ p: [x, DY + 4.35, T.z0 - 5.9], s: [0.12, 0.12, 1.4], mat: M.iron, bevel: 0, cast: false }); const lp = [x + 3, DY + 4.2, T.z0 - 4.2]; B.cyl({ p: lp, r: [0.2, 0.06], h: 0.22, seg: 8, mat: M.iron, cast: false }); B.sphere({ p: [lp[0], lp[1] - 0.05, lp[2]], r: 0.09, mat: M.lampGlow, seg: 8, cast: false }); K.lamp([lp[0], lp[1] - 0.15, lp[2]], { color: 0xffb060, cd: 26, dist: 20, size: 0.5, refl: 3.5, light: x < 4 && x > -12 }); }
    // wall of the terminal facing the apron: windows (lit), doors
    BL.windowGrid('n', T.x0 + 2, T.x1 - 2, T.z0 - 0.02, DY + 1.6, 1, 8, 1.3, 1.7, 0, { litP: 0.75, litMats: [M.lit, M.lit2] });
    for (const x of [-6, 9]) { B.box({ p: [x, DY, T.z0 - 0.05], s: [2.1, 2.7, 0.08], mat: M.reveal, bevel: 0, cast: false }); B.box({ p: [x - 0.52, DY, T.z0 - 0.09], s: [1.0, 2.62, 0.05], mat: M.timber, bevel: 0.01, cast: false }); B.box({ p: [x + 0.52, DY, T.z0 - 0.09], s: [1.0, 2.62, 0.05], mat: M.timber, bevel: 0.01, cast: false }); K.glare([x, DY + 1.3, T.z0 - 0.3], 0xffc070, 0.45, 0.6, { mist: 1.2, refl: 2 }); }
    K.sign(['FERRIES', 'TO THE ISLANDS'], [-6, DY + 3.3, T.z0 - 0.1], [4.6, 0.9, 0.05], { bg: '#10243a', fg: '#e8dcb0', weather: 0.6, w: 512 }); K.sign(['TICKETS'], [9, DY + 3.3, T.z0 - 0.1], [2.4, 0.7, 0.05], { bg: '#10243a', fg: '#e8dcb0', weather: 0.6, w: 512 });
    // the FERRY sign: board on a steel frame above the roof, bulb-outlined letters
    const SGN = { x: 1, y: DY + T.h + 3.3, z: (T.z0 + T.z1) / 2, w: 13, h: 4.2 };
    const fsTex = (() => { const c = document.createElement('canvas'); c.width = 1024; c.height = 330; const g = c.getContext('2d'); g.fillStyle = '#0b1c30'; g.fillRect(0, 0, 1024, 330); g.strokeStyle = '#e8d8a8'; g.lineWidth = 8; g.strokeRect(14, 14, 996, 302); g.fillStyle = '#f2e6bc'; g.shadowColor = '#ffcf80'; g.shadowBlur = 26; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 250px "Arial Black", Impact, sans-serif'; g.fillText('FERRY', 512, 152); g.shadowBlur = 0; g.font = '700 42px Arial, sans-serif'; g.fillStyle = '#c8b888'; g.fillText('C I T Y   P I E R   ·   B E R T H   4', 512, 290); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; })();
    fitTex(fsTex, SGN.w, SGN.h); const fsMat = B.m('ferrySign', std({ map: fsTex, emissiveMap: fsTex, emissive: 0xffffff, emissiveIntensity: 1.8, roughness: 0.6 }));
    B.box({ p: [SGN.x, SGN.y - SGN.h / 2, SGN.z], s: [SGN.w, SGN.h, 0.3], mat: fsMat, bevel: 0.02, cast: false, col: false });
    B.box({ p: [SGN.x, SGN.y - SGN.h / 2 - 0.05, SGN.z + 0.18], s: [SGN.w + 0.4, SGN.h + 0.3, 0.1], mat: M.iron, bevel: 0.02, cast: false });
    for (const sx of [-5.5, 5.5]) { B.box({ p: [SGN.x + sx, DY + T.h, SGN.z], s: [0.3, 3.4, 0.3], mat: M.iron, bevel: 0.02, cast: true }); B.beam([SGN.x + sx, DY + T.h + 0.3, SGN.z], [SGN.x + sx * 0.5, SGN.y - SGN.h + 0.05, SGN.z + 0.4], 0.16, 0.16, { mat: M.iron, bevel: 0, cast: false }); }
    for (let i = 0; i <= 26; i++) { const t = i / 26; K.glare([SGN.x - SGN.w / 2 + 0.25 + t * (SGN.w - 0.5), SGN.y - 0.22, SGN.z - 0.3], 0xffd490, 0.14, 0.8, { refl: 0, mist: 0.5 }); K.glare([SGN.x - SGN.w / 2 + 0.25 + t * (SGN.w - 0.5), SGN.y - SGN.h + 0.22, SGN.z - 0.3], 0xffd490, 0.14, 0.8, { refl: 0, mist: 0.5 }); }
    K.lamp([SGN.x, SGN.y - SGN.h / 2, SGN.z - 3], { color: 0xffd090, cd: 40, dist: 30, size: 0.1, k: 0, refl: 5, light: true, mist: 0 });
    K.glare([SGN.x, SGN.y - SGN.h / 2, SGN.z - 0.6], 0xffd8a0, 1.6, 0.35, { refl: 5, mist: 1.5 });
    // vertical blade sign "FERRY" on its own steel mast east of the canopy: readable along the quay (the roof sign faces the water only)
    { const BX = 27.5, BZ = -91.6, BY = DY + 3.2; B.cyl({ p: [BX, DY, BZ - 1.15], r: 0.16, h: BY + 8.4 - DY, seg: 10, mat: M.iron, col: 'metal' }); B.cyl({ p: [BX, DY, BZ + 1.15], r: 0.16, h: BY + 8.4 - DY, seg: 10, mat: M.iron, col: 'metal' });
      for (const y of [BY - 0.3, BY + 3.6, BY + 7.6]) B.box({ p: [BX, y, BZ], s: [0.35, 0.22, 2.7], mat: M.iron, bevel: 0.02, cast: false });
      const nf = K.neon(['F', 'E', 'R', 'R', 'Y'], [BX - 0.13, BY, BZ], [0.16, 7.2, 1.9], { colors: ['#ffd27a'], glow: 2.4, w: 512, face: 'x', frame: '#ff9a3a', bg: '#140c06', weight: '900' });
      K.neon(['F', 'E', 'R', 'R', 'Y'], [BX + 0.13, BY, BZ], [0.16, 7.2, 1.9], { colors: ['#ffd27a'], glow: 2.4, w: 512, face: 'x', frame: '#ff9a3a', bg: '#140c06', weight: '900', yaw: P });
      K.glare([BX + 0.6, BY + 3.6, BZ], 0xffc070, 0.9, 0.22, { refl: 1.2, mist: 0.7 }); K.glare([BX - 0.6, BY + 3.6, BZ], 0xffc070, 0.9, 0.22, { refl: 1.2, mist: 0.7 });
      K.lamp([BX + 2.5, BY + 1.2, BZ - 1.5], { color: 0xffc888, cd: 26, dist: 22, size: 0.1, k: 0, refl: 2, mist: 0 }); }
    // ------------------------------------------------------------------ HARBOUR OFFICE (2 storeys, lit windows, hip roof, flagpole)
    const H = { x0: 40, x1: 56, z0: -96, z1: -85 };
    B.box({ p: [(H.x0 + H.x1) / 2, DY, (H.z0 + H.z1) / 2], s: [H.x1 - H.x0, 7.2, H.z1 - H.z0], mat: M.timber, bevel: 0.04, col: 'wood', walk: false, cast: true });
    BL.gableRoof(H.x0, H.z0, H.x1, H.z1, DY + 7.2, 3.0, 'x', 0.6, M.roof, M.timber);
    for (const z of [H.z0 - 0.02]) { BL.windowGrid('n', H.x0 + 1.5, H.x1 - 1.5, z, DY + 1.2, 2, 5, 1.2, 1.8, 3.1, { litP: 0.8, litMats: [M.lit, M.lit2] }); }
    B.box({ p: [(H.x0 + H.x1) / 2, DY, H.z0 - 0.7], s: [5, 0.45, 1.4], mat: M.timber, bevel: 0.02, col: 'wood', walk: true }); B.box({ p: [(H.x0 + H.x1) / 2, DY + 0.45, H.z0 - 0.7], s: [3, 0.1, 1.2], mat: M.iron, bevel: 0.01, cast: false });
    K.sign(["HARBOUR MASTER", "& PORT AUTHORITY"], [(H.x0 + H.x1) / 2, DY + 4.5, H.z0 - 0.06], [6, 1.1, 0.06], { bg: '#1c2a20', fg: '#e0d2a0', weather: 0.7, w: 768 });
    B.cyl({ p: [H.x1 + 1.2, DY, H.z0 - 0.5], r: 0.09, h: 9.5, seg: 8, mat: M.iron, col: 'metal' }); const flagM = std({ color: 0x8a1e1a, roughness: 0.8, side: THREE.DoubleSide, wind: { amp: 0.09, freq: 3.4, stiff: 'uv' }, key: 'pierFlag' }); const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0, 10, 4), flagM); flag.position.set(H.x1 + 2.1, DY + 8.8, H.z0 - 0.5); B.group.add(flag);
    K.lamp([(H.x0 + H.x1) / 2, DY + 3.9, H.z0 - 1.2], { color: 0xffb060, cd: 22, dist: 16, size: 0.5, refl: 3 }); B.cyl({ p: [(H.x0 + H.x1) / 2 - 2.6, DY + 3.6, H.z0 - 0.5], r: [0.22, 0.05], h: 0.2, seg: 8, mat: M.iron, cast: false });

    // ------------------------------------------------------------------ extra levels: harbour-office balcony (3.1 m, stair at the west end) + raised loading dock (1.15 m) in front of the bonded warehouse
    platform(K, { x0: 40.3, z0: -97.9, x1: 55.7, z1: -96.04, y: DY + 3.1, base: DY, mat: M.timber, frame: M.iron, surface: 'wood', legs: 'n', rails: 'nw', stairs: [{ side: 'e', at: -97.4, w: 1.0 }], lamps: [[45, DY + 5.4, -97.2], [52, DY + 5.4, -97.2]] });
    platform(K, { x0: -2, z0: -54.4, x1: 26, z1: -50.25, y: DY + 1.15, base: DY, solid: true, mat: M.timber, baseMat: M.conc, surface: 'wood', baseSurface: 'concrete', frame: M.iron, stairMat: M.timber, stairSurface: 'wood', stairs: [{ side: 'w', at: -52.3, w: 1.8 }, { side: 'e', at: -52.3, w: 1.8 }], lamps: [[4, DY + 4.4, -50.4, { color: 0xffa850, cd: 26, dist: 18, size: 0.5, refl: 3, light: true }], [17, DY + 4.4, -50.4, { color: 0xffa850, cd: 22, dist: 16, size: 0.5, refl: 3, light: false }]] });
    // ------------------------------------------------------------------ WAREHOUSE ROW (brick) south of the street, alleys between
    const WH = [{ x0: -74, x1: -42 }, { x0: -38, x1: -8 }, { x0: -4, x1: 28 }, { x0: 32, x1: 74 }];
    WH.forEach((w, i) => {
      const z0 = ZS, z1 = ZS + 16 + (i % 2) * 3, h = 11.5 + (i % 3) * 1.2; B.box({ p: [(w.x0 + w.x1) / 2, DY, (z0 + z1) / 2], s: [w.x1 - w.x0, h, z1 - z0], mat: M.brick, bevel: 0.05, col: 'brick', walk: false, cast: true }); BL.gableRoof(w.x0, z0, w.x1, z1, DY + h, 3.2 + i % 2, 'x', 0.45, M.roof, M.brick);
      B.box({ p: [(w.x0 + w.x1) / 2, DY + h - 0.5, z0 - 0.12], s: [w.x1 - w.x0 + 0.2, 0.5, 0.3], mat: M.stone, bevel: 0.03, cast: false }); B.box({ p: [(w.x0 + w.x1) / 2, DY, z0 - 0.1], s: [w.x1 - w.x0 + 0.1, 0.5, 0.25], mat: M.stone, bevel: 0.03, cast: false });
      { const cols = Math.round((w.x1 - w.x0 - 4) / 3.4); facadeReal(K, { wall: M.brick, stone: M.stone, iron: M.iron, reveal: M.reveal }, { x0: w.x0, x1: w.x1, z: z0, y0: DY, h, dir: -1, bay: (w.x1 - w.x0 - 4.4) / cols, a0: w.x0 + 2.2, courses: [5.55, 8.45] }); }
      BL.windowGrid('n', w.x0 + 2.2, w.x1 - 2.2, z0 - 0.05, DY + 3.2, 3, Math.round((w.x1 - w.x0 - 4) / 3.4), 1.2, 1.8, 2.9, { litP: 0.28, arch: true, bars: i === 3, litMats: [M.lit, M.lit2] });
      const doors = i === 1 ? [w.x0 + 7, w.x1 - 7] : [w.x0 + 8, (w.x0 + w.x1) / 2 + 3]; doors.forEach((dx, k) => { B.box({ p: [dx, DY, z0 - 0.07], s: [3.2, 3.4, 0.14], mat: M.reveal, bevel: 0, cast: false }); rollerDoor(B, { iron: M.rust, yellow: M.lampGlow }, dx, DY, z0 - 0.03, 3.0, 3.3, -1); K.lamp([dx, DY + 4.1, z0 - 0.5], { color: 0xffa850, cd: 18, dist: 14, size: 0.4, refl: 2.6, light: false }); B.cyl({ p: [dx, DY + 3.85, z0 - 0.3], r: [0.2, 0.06], h: 0.2, seg: 8, mat: M.iron, cast: false }); });
      if (i === 0 || i === 3) BL.hoist((w.x0 + w.x1) / 2, DY + h - 1.2, z0 - 0.1, 0, -1, M.iron, M.rope); BL.downpipe(w.x0 + 0.4, z0 - 0.2, DY, DY + h, M.iron); BL.downpipe(w.x1 - 0.4, z0 - 0.2, DY, DY + h, M.iron);
      if (i === 1) BL.fireEscape(w.x0 + 14, z0 - 0.1, -1, DY + 0.6, DY + 9.2, M.iron); if (i === 2) BL.fireEscape(w.x1 - 6, z0 - 0.1, -1, DY + 0.6, DY + 9.2, M.iron);
      K.sign([['J. HARGREAVES & SON', 'GENERAL MERCHANTS'], ['NORTHERN COLD STORAGE'], ['PORT OF THE ISLES', 'BONDED WAREHOUSE No.3'], ['SALT · TIMBER · COAL', 'W. TANNER LTD']][i], [(w.x0 + w.x1) / 2, DY + 8.6, z0 - 0.15], [8, 1.6, 0.06], { bg: ['#28221a', '#1a2a2e', '#2e2620', '#22261e'][i], fg: '#d4c89c', weather: 1, w: 1024 });
    });
    // side walls of the alleys and the dark gaps (alleys lead south into fog)
    for (const ax of [-40, -6, 30]) { B.box({ p: [ax, DY, ZS + 9], s: [4, 12, 18], mat: M.reveal, bevel: 0, cast: false }); K.lamp([ax, DY + 5, ZS + 1], { color: 0xffa850, cd: 20, dist: 16, size: 0.45, refl: 2.4, light: false }); }
    // ------------------------------------------------------------------ CONTAINER WALLS on the street ends (with a dark gap), trucks, dock equipment
    for (const sx of [-1, 1]) { const x = sx * 72; let z = -78.3; for (let k = 0; k < 4; k++) { const zc = z + 3.03; if (k === 2) { z += 8.2; continue; } for (let lv = 0; lv < 2; lv++) container(K, x + (lv % 2 ? 0.25 : 0), DY + lv * 2.6, zc, false, M.ct[(k + lv + (sx > 0 ? 1 : 0)) % 4], { col: 'metal' }); z += 6.1; } }
    for (const sx of [-1, 1]) K.wallCol([sx * 71, -78.5], [sx * 71, -52], DY, DY + 6, 0.2, 'metal');
    truck(K, trk, { x: 30, z: -66, yaw: 0, kind: 'van', on: false }); truck(K, { ...trk, paint2: trk.paint2 }, { x: -34, z: -62, yaw: P, kind: 'flat', load: [[-1.6, -0.3, 1.2, 1.0, 0.9], [-0.2, 0.3, 1.0, 0.8, 0.9]] }); truck(K, { ...trk, paint: trk.paint3, paint2: trk.paint3 }, { x: 56, z: -68, yaw: 0, kind: 'van', on: true });
    // ------------------------------------------------------------------ lamps (sodium), telephone box, hydrant, bins, bench, crates, barrels, coils, tarp piles, hawsers, chain barriers
    const posts = [[-68, QZ + 2.4, [0, 1]], [-56, QZ + 2.4, [0, 1]], [-34, QZ + 2.4, [0, 1]], [-9, QZ + 2.4, [0, 1]], [9, QZ + 2.4, [0, 1]], [34, QZ + 2.4, [0, 1]], [58, QZ + 2.4, [0, 1]], [-60, -78.5, [0, 1]], [-30, -78.5, [0, 1]], [0, -78.5, [0, 1]], [30, -78.5, [0, 1]], [60, -78.5, [0, 1]], [-20, -58, [0, -1]], [22, -58, [0, -1]], [50, -58, [0, -1]]];
    posts.forEach(([x, z, dir], i) => { const head = K.lampPost(x, z, DY, { h: 6.4, mat: M.iron, glowMat: M.lampGlow, dir }); K.lamp(head, { color: 0xffa044, cd: 20, dist: 26, size: 0.6, refl: 4.2, flick: i % 3 === 0 ? 0.03 : 0, spill: true }); });
    for (const [x, z] of [[62, -76.5]]) { B.box({ p: [x, DY, z], s: [1.0, 2.6, 1.0], mat: B.m('phoneRed', std({ color: 0x8a1412, roughness: 0.4, metalness: 0.4 })), bevel: 0.03, col: 'metal', walk: false }); B.box({ p: [x, DY + 0.5, z + 0.51], s: [0.7, 1.7, 0.02], mat: M.lit2, bevel: 0, cast: false }); K.glare([x, DY + 1.5, z + 0.8], 0xffd08a, 0.5, 0.7, { refl: 1.5 }); }
    for (const [x, z] of [[-14, -77], [12, -77]]) { B.cyl({ p: [x, DY, z], r: 0.16, h: 0.7, seg: 8, mat: M.rust, col: 'metal' }); B.sphere({ p: [x, DY + 0.75, z], r: 0.15, mat: M.rust, seg: 8, cast: false }); }
    const scatter = (n, area, fn, avoid = []) => { let t = 0; while (n > 0 && t++ < n * 40) { const x = area[0] + rng() * (area[2] - area[0]), z = area[1] + rng() * (area[3] - area[1]); if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue; fn(x, z); n--; } };
    const keep = [[-1.5, -99, 6], [-46, -96, 9], [-31, -92.7, 7], [-63, -100.3, 7]];
    scatter(16, [-72, -102, 72, -80.5], (x, z) => { const k = rng(); if (k < 0.35) K.crate(x, DY, z, 0.9 + rng() * 0.5, 0.7 + rng() * 0.4, 0.8 + rng() * 0.3, M.timber, { yaw: (rng() < 0.5 ? 0 : P / 2), batten: M.iron }); else if (k < 0.7) K.barrel(x, DY, z, rng() < 0.5 ? M.rust : M.iron); else if (k < 0.85) K.coil(x, DY, z, M.rope, { r: 0.35 + rng() * 0.2 }); else K.crate(x, DY, z, 1.2, 1.2, 1.2, M.timber, { batten: M.iron }); }, keep);
    for (let i = 0; i < 4; i++) { const x = -40 + i * 24 + rng() * 6, z = -101.2 + rng() * 0.6; K.coil(x, DY, z, M.rope, { r: 0.5, turns: 5, w: 0.05 }); }
    // hawsers lying along the deck + chain barrier posts
    rope3(B, [[12, DY + 0.05, -100], [18, DY + 0.05, -98.5], [24, DY + 0.05, -99.4], [30, DY + 0.05, -98]], 0.06, M.rope);
    for (let x = 32; x <= 68; x += 12) { B.box({ p: [x, DY, QZ + 0.6], s: [0.14, 1.0, 0.14], mat: M.iron, bevel: 0.01, cast: false }); if (x < 68) B.cable([x, DY + 0.85, QZ + 0.6], [x + 12, DY + 0.85, QZ + 0.6], 0.25, 0.018, M.iron, { n: 10, cast: false }); }
    // tarp-covered cargo heaps + timber stacks + pallets near the street ends
    for (const [x, z, w, d, h] of [[-60, -70, 5, 3, 1.5], [12, -58, 4, 3, 1.2], [46, -74, 3.5, 3, 1.8]]) B.box({ p: [x, DY, z], s: [w, h, d], mat: M.tar, bevel: 0.35, col: 'fabric', walk: false, cast: true });
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) B.box({ p: [-18 + i * 0.3, DY + j * 0.13, -70.5], s: [0.26, 0.12, 3.4], mat: M.timber, bevel: 0.005, cast: false });
    // puddles (mirror-like, rain-rippled) scattered on deck and street
    for (let i = 0; i < 26; i++) { const x = -70 + rng() * 140, z = -102 + rng() * 50; if (Math.hypot(x + 1.5, z + 99) < 3) continue; const s = 0.9 + rng() * 2.6; K.puddle(puddle, x, DY + 0.006, z, s * 0.8, s * 0.55, rng() * P); }
    // wet dark patches / oil stains as puddles near the ramp landing
    K.puddle(puddle, -1.5, DY + 0.007, -97, 2.2, 1.4, 0.2);
    // cables overhead (sagging wires between lamp posts and buildings)
    for (const [a, b] of [[[-34, DY + 6.2, -78.5], [-30, DY + 6.0, -78.5]], [[0, DY + 6.2, -78.5], [30, DY + 6.2, -78.5]], [[30, DY + 6.2, -78.5], [60, DY + 6.2, -78.5]]]) B.cable(a, b, 1.2, 0.012, M.iron, { n: 12, cast: false });
    // signs / posters / notices
    K.sign(['BERTH 4', 'FERRY LANDING'], [-1.5, DY + 2.3, QZ + 1.3], [1.8, 0.7, 0.05], { bg: '#e0c030', fg: '#181818', weather: 0.8, w: 512, cast: true }); B.cyl({ p: [-1.5, DY, QZ + 1.3], r: 0.05, h: 2.0, seg: 6, mat: M.iron, cast: false });
    K.decal('BERTH 4', [-1.5, DY + 0.016, -100.6], [3.4, 1.0], { fg: '#d8d0b0', from: [0, 1], w: 512 }); K.decal('KEEP CLEAR', [22, DY + 0.016, -99.6], [4, 0.9], { fg: '#c8b040', from: [0, 1], w: 512 });
    // lifebuoy stand + rescue ladder box
    B.box({ p: [16, DY, QZ + 1.6], s: [0.9, 1.6, 0.35], mat: M.rust, bevel: 0.02, col: 'metal', walk: false, cast: false }); K.tyre(16, DY + 1.1, QZ + 1.8, B.m('lifebuoyM', std({ color: 0xd8d4c8, roughness: 0.6 })), { axis: 'z', r: 0.3, t: 0.07 });
    // ------------------------------------------------------------------ DRESSING: luggage, mail sacks, pallets, crates, drums, forklift, benches, kiosk, queue stanchions (cover + character; lanes stay >= 2.5 m)
    { const PR = makeProps(K, { wood: M.timber, iron: M.iron, rust: M.rust, steel: M.steel, rope: M.rope, conc: M.conc, tyre: M.tyre, glass: M.dark, lit: M.lit }, DY); const Q = P / 2;
      // ferry berth (keep x -6..3 clear for the ramp): waiting luggage, queue stanchions, benches + bins on the terminal apron
      PR.trolley(14.5, -98.4, 0.12); PR.trolley(-11.6, -97.6, P + 0.25); PR.trolley(20.5, -93.2, Q + 0.1); PR.sacks(-9.4, -94.2, 0.1, { rows: 4, cols: 3 }); PR.sacks(16.2, -94.6, Q, { rows: 3, cols: 2 });
      PR.stanchions([-13, -93.4], [-4.6, -93.4]); PR.stanchions([12.4, -93.4], [19.4, -93.4]); PR.stanchions([-4.6, -93.4], [-4.6, -95.8]);
      for (const x of [-13.5, -1.6, 15.5]) PR.bench(x, -90.35, P); PR.bin(-16.2, -90.5); PR.bin(2.4, -90.5); PR.bin(18.6, -90.5); PR.kiosk(32.6, -93.6, P, { sign: ['NEWS · TOBACCO'], glow: 0xffc080 });
      PR.kiosk(-28.5, -86.5, P, { sign: ['LEFT LUGGAGE'], glow: 0xffb060 });
      // west cargo yard (south of the crane rails): pallets of crates/sacks/boxes, a container, drum racks, a forklift, hand carts
      PR.pallet(-58, -87, 0, { load: 'crates', n: 3 }); PR.pallet(-56.4, -87.1, 0, { load: 'crates', n: 2 }); PR.pallet(-53.5, -85.6, Q, { load: 'sacks', n: 5 }); PR.pallet(-40.5, -87.5, 0, { load: 'boxes', n: 3 }); PR.pallet(-39, -87.4, 0, { load: 'boxes', n: 2 }); PR.pallet(-38, -84.4, Q, { load: 'crates', n: 2 });
      container(K, -47.5, DY, -84.5, true, M.ct[1], { col: 'metal' }); container(K, -47.5, DY + 2.6, -84.5, true, M.ct[2], { col: 'metal' });
      PR.drumRack(-33.6, -85.2, 0); PR.drumRack(-29.4, -88.6, Q); PR.forklift(-44, -89, Q, { lift: 0.9, beacon: true }); PR.handcart(-50.6, -90, 0.2); PR.handcart(-26.3, -84.2, Q);
      PR.reel(-62.6, -84.8, 0); PR.reel(-64.4, -84.9, 0, { r: 0.5 });
      // east yard: stacked crates, tank, generator + flood stand beside the harbour office, sacks
      for (const [x, z, n] of [[29.5, -86.5, 3], [31.1, -86.6, 2], [30.3, -85.2, 2]]) for (let k = 0; k < n; k++) K.crate(x, DY + k * 0.9, z, 1.4, 0.9, 1.0, M.timber, { yaw: (k % 2) * 0.1, batten: M.iron });
      PR.pallet(35.5, -85.8, Q, { load: 'sacks', n: 4 }); PR.pallet(37.2, -85.7, Q, { load: 'sacks', n: 3 }); PR.tank(62.5, -87, 0); PR.generator(60.2, -80.6, P); PR.floodStand(58.5, -82.2, 0, { cd: 24, color: 0xffd090 }); PR.handcart(41, -84.5, Q);
      // street: parked hand carts + benches by the trucks, drum clusters, more sacks
      PR.handcart(24, -68, Q + 0.2); PR.handcart(-26, -72.5, 0.4); PR.bench(6, -58.2, 0); PR.bench(-6, -58.2, 0); PR.bin(0, -58.1); PR.drumRack(-48, -66, Q); PR.drumRack(50, -60, 0); PR.sacks(-22, -64, Q, { rows: 3, cols: 3 }); PR.sacks(40, -62, 0, { rows: 3, cols: 2 });
      // raised dock (1.15 m) cargo + mid-height cover across the street
      { const DK = DY + 1.15; for (const [x, z, n] of [[2, -52.0, 3], [3.6, -52.2, 2], [18.5, -51.8, 3]]) for (let k = 0; k < n; k++) K.crate(x, DK + k * 0.9, z, 1.3, 0.9, 1.0, M.timber, { yaw: (k % 2) * 0.12, batten: M.iron }); K.barrel(9.5, DK, -52.6, M.rust); K.barrel(10.2, DK, -51.9, M.iron); K.barrel(10.6, DK, -52.9, M.rust); PR.sacks(13.5, -52.5, 0, { rows: 3, cols: 3, y: DK }); PR.handcart(22.5, -52.3, 0.2, { y: DK }); }
      for (const [x, z, yw] of [[-16, -71, 0], [-3, -75.5, Q], [14, -64.5, 0], [41, -72, Q]]) { PR.pallet(x, z, yw, { load: 'crates', n: 3 }); PR.pallet(x + 1.7, z + 0.35, yw, { load: 'boxes', n: 2 }); K.barrel(x - 1.1, DY, z + 0.2, M.rust); }
    }
    // ------------------------------------------------------------------ city backdrop: tower blocks with lit windows (behind the warehouses)
    const towerTex = towerTexture(9, 0.22, 1);
    const towerMat = B.m('tower', std({ map: towerTex, emissiveMap: towerTex, emissive: 0xffffff, emissiveIntensity: 2.6, roughness: 0.8 }));
    for (let i = 0; i < 16; i++) { const x = -190 + i * 25 + (rng() - 0.5) * 12, z = -20 + rng() * 120, w = 14 + rng() * 14, d = 14 + rng() * 14, h = 26 + rng() * 60; modelTower(B, towerMat, M.iron, x, z, w, d, h, rng); }

    // ------------------------------------------------------------------ atmosphere weather: drizzle + sodium mist wisps
    ctx.weather({ count: 4200, box: [38, 24, 38], fall: 10, wind: null, size: 0.03, turb: 0.15, streak: 16, color: [0.62, 0.68, 0.8], alpha: 0.42, cell: 13, seed: 11 });
    decalAtlas(K, [
      { x: -12, z: -103, w: 24, d: 20, kind: 'deck', y: DY + 0.017, rust: [[-7.2, QZ + 1.1], [7.2, QZ + 1.1], [-14, QZ + 1.1], [14, QZ + 1.1]], rustDir: Math.PI / 2, paths: [[[-1.5, -100], [-3, -96], [-6, -91.5]], [[-1.5, -100], [9, -97], [9, -91.5]]], litter: 1.2 },
      { x: 12, z: -103, w: 24, d: 20, kind: 'deck', y: DY + 0.017, rust: [[14, QZ + 1.1], [30, QZ + 1.1]], rustDir: Math.PI / 2, paths: [[[-1.5, -100], [14, -98], [30, -98.5], [41, -99.2]]], litter: 1.2 },
      { x: 36, z: -103, w: 24, d: 20, kind: 'deck', y: DY + 0.017, rust: [[46, QZ + 1.1]], paths: [[[41, -99.2], [47, -97.2], [48, -93.5]]], litter: 1.2 },
      { x: 0, z: -72, w: 24, d: 20, kind: 'cobble', y: DY + 0.012, litter: 1.4 }], { seed: 11 });
    K.finishFoam();
    // ------------------------------------------------------------------ gameplay data
    const spawns = [...K.spawns];
    [-40, -6, 30].forEach((x) => spawns.push({ kind: 'walk', pos: [x, DY, ZS + 12], yaw: 0, note: 'alley' }));
    [-1, 1].forEach((sx) => spawns.push({ kind: 'walk', pos: [sx * 73.4, DY, -64], yaw: sx > 0 ? P / 2 : -P / 2, note: 'container gap' }));
    const gulls = makeGulls(B, 12, { cx: 0, cz: -100, rx: 90, rz: 40, perched: 7, rng, spots: [[-14, DY + 0.72, QZ + 1.1], [14, DY + 0.72, QZ + 1.1], [46, DY + 0.72, QZ + 1.1], [34, DY + 6.55, QZ + 2.4], [-9, DY + 6.55, QZ + 2.4], [58, DY + 6.55, QZ + 2.4], [-30, DY + 0.72, QZ + 1.1]] });
    const pu = ST.toLocal(0, 5);
    const steam = { t: 0 }; const lampSrc = K.lamps;
    const data = {
      atmo: ATMO[IDX], reflect: { level: DY }, envPatches: ENV[IDX], playerStart: { pos: [41, DY, -99.2], yaw: P / 2 + 0.2 }, station: { pos: ST.stationLocal, yaw: ST.yaw },
      groundY: -3, waterY: 0, waterHeight: (wx, wz) => sea.height(wx, wz), groundSurface: 'wood', navBounds: [-72, -103, 72, -50.5], navBlocked: (x, z, gy) => gy < 1.0, navCell: 0.6,
      landmark: { pos: [24, DY + 8.5, -91.6], name: 'Blade FERRY sign, terminal canopy & portal crane' }, mooring: [17, 7.2, -7.2, -17].map((a) => ST.toLocal(a, BEAM_HALF + FENDER + 1.1)),
      spawns,
      buys: { walls: [{ pos: [-24, DY + 1.5, ZS - 0.15], yaw: P, gun: 'olympia' }, { pos: [10.5, DY + 1.5, ZS - 0.15], yaw: P, gun: 'mp5' }], perks: [{ pos: [-22, DY, -84], yaw: 0, perk: 'juggernog' }], box: { pos: [24, DY, -84.2], yaw: 0 } },
      zombieVariants: [{ id: 'ferry_dockworker', weight: 3, minRound: 1 }, { id: 'ferry_drowned', weight: 2, minRound: 1 }, { id: 'ferry_sailor', weight: 2, minRound: 2 }],
      ambient: { space: 'open', gain: 1, beds: [{ type: 'water', gain: 0.5, lap: 0.6 }, { type: 'wind', gain: 0.25, gust: 0.3 }, { type: 'hum', freq: 100, gain: 0.05 }, { type: 'machine', gain: 0.1 }], events: [{ type: 'foghorn', every: [20, 45], gain: 0.9, pos: 'far' }, { type: 'gull', every: [8, 22], gain: 0.5, pos: 'around' }, { type: 'creak', every: [5, 12], gain: 0.6 }, { type: 'clank', every: [9, 24], gain: 0.5, pos: 'far' }, { type: 'bell', every: [10, 20], gain: 0.4, pos: 'far' }] },
      update(dt, t, active) { sea.tick(t, gfx.camera.position, gfx); gulls.update(t); if (!active) return; steam.t += dt; if (steam.t > 0.09) { steam.t = 0; const o = ctx.origin; fx.puff({ x: o.x + 14, y: DY + 0.1, z: o.z - 68 }, { x: 0, y: 1, z: 0 }, 1, { speed: 0.6, size: [0.3, 1.8], life: 3.2, color: [0.18, 0.14, 0.11, 0.2], rise: 1.1, drag: 0.7, spread: 0.3, cell: 1 }); fx.puff({ x: o.x - 30, y: DY + 0.1, z: o.z - 58 }, { x: 0, y: 1, z: 0 }, 1, { speed: 0.6, size: [0.3, 1.8], life: 3.2, color: [0.18, 0.14, 0.11, 0.2], rise: 1.1, drag: 0.7, spread: 0.3, cell: 1 }); } },
    };
    for (const w of data.buys.walls) K.wallLamp(w.pos[0], w.pos[1], w.pos[2], Math.sin(w.yaw), Math.cos(w.yaw), { color: 0xffb060, mat: M.iron });
    return data;
  },
};
