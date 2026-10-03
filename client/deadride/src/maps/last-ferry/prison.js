// LAST FERRY — Stop 3: ISLAND PRISON DOCK. Concrete and barbed wire under sweeping searchlights: a floodlit landing with stencilled numbers, chain-link sally-port funnels,
// guard shacks, the gate arch cut into the perimeter wall, catwalks, watchtowers with rotating searchlights (visible beams) and the cell block on the cliff behind.
// Cold mercury / sodium light, harsh moon shadows, greenish-grey palette. Landmark: the searchlight watchtower + the prison gate arch. Ferry berth: south face (ferry heads west, quay on its starboard = north).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { rand, makeRng } from '../../core/util.js';
import { STOPS, BEAM_HALF, FENDER } from './layout.js';
import { ATMO, ENV } from './atmos.js';
import { getSea, withLampRefl, makeSoftBeam } from './shared.js';
import { makeKit, puddleMaterial, fitTex } from './kit.js';
import { makeBuilding } from './bld.js';
import { stubStop, skipStop } from './stub.js';
import { makeProps } from './props2.js';
import { decalAtlas } from './decals.js';
import { makeGulls } from './wharfProps.js';
import { chainLinks } from './arch.js';

const P = Math.PI, IDX = 2, ST = STOPS[2], QZ = -ST.quayFace, DY = ST.quayY;   // quay face z = +103.2, dock height 2.0

export default {
  id: 'prison', name: 'Island Prison Dock', origin: ST.origin, viewRadius: 340,
  async build(ctx) {
    if (skipStop(IDX)) return stubStop(ctx, IDX, this);
    const { B, fx, gfx } = ctx; const sea = getSea(); sea.attach(ctx.world.root); const K = makeKit(ctx, IDX); const rng = K.rng;
    // ------------------------------------------------------------------ materials
    const M = {};
    M.conc = B.m('pConc', { pattern: 'noise', size: 1024, tile: 3, colors: [0x7b857c, 0x646f61, 0x323a34, 0x9aa596], params: { scale: 5, contrast: 3, fine: 96, speckle: 0.04, pores: 0.5, panels: 3, panelWidth: 0.003 }, bump: 3, rough: [0.65, 0.95], layers: { grime: 0.6, cracks: 0.5, streak: 0.7, moss: 0.2, wet: 0.2 } }, { breakup: 0.5, wet: true });
    M.slab = B.m('pSlab', { pattern: 'tiles', size: 1024, tile: 4, colors: [0x59645a, 0x4d574d, 0x2c352d], params: { n: 3, grout: 0.008, checker: 0, bevel: 0.004, wear: 0.6, gloss: 0.3, crackle: 0.45 }, bump: 3, rough: [0.4, 0.85], layers: { grime: 0.6, oil: 0.4, wet: 0.5, cracks: 0.3 } }, { wet: true, breakup: 0.5, refl: 1, frag: 'roughnessFactor = max(roughnessFactor, 0.3);' }); withLampRefl(M.slab, { gain: 0.7, maxRough: 0.8, patchy: 0.7 });
    M.steel = B.m('pSteel', { pattern: 'plates', size: 256, tile: 2, colors: [0x3a4144, 0x2b3134, 0x14181a], rustColor: 0x5a3018, params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.5, panelVar: 0.4 }, bump: 2, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.35, grime: 0.6, edge: 0.4, scratch: 0.4, streak: 0.6 } }, { wet: true });
    M.rustS = B.m('pRust', { pattern: 'plates', size: 256, tile: 2, colors: [0x5b3421, 0x452617, 0x1a0e08], rustColor: 0x6a3418, params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.3, panelVar: 0.5 }, bump: 3, metal: 0.45, rough: [0.5, 0.85], layers: { rust: 0.8, grime: 0.6, streak: 0.5, edge: 0.3 } });
    M.stone = B.m('pStone', { pattern: 'stone', size: 512, tile: 3, colors: [0x707a72, 0x545e56, 0x1c221e, 0x8f9a90], params: { scale: 5, gap: 0.06, round: 0.25, variation: 0.5, mortarDark: 0.8, strata: 0.2, lichen: 0.4 }, bump: 16, rough: [0.6, 0.95], layers: { grime: 0.7, moss: 0.3, streak: 0.6, wet: 0.3 } }, { wet: true });
    M.rock = B.m('pRock', { pattern: 'rock', size: 512, tile: 5, colors: [0x1c221f, 0x2c3530, 0x424c46, 0x5b665f], params: { scale: 5, strata: 5, cracks: 0.9, roughness: 0.8, tone: 0.5, moisture: 0.6 }, bump: 90, rough: [0.6, 0.95], layers: { moss: 0.3, grime: 0.4, wet: 0.5 } }, { triplanar: 1 / 5, breakup: 0.5, wet: true });
    M.yellow = B.m('pYellow', { pattern: 'plates', size: 256, tile: 2, colors: [0xd8b420, 0xb89418, 0x4a3a08], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2, panelVar: 0.1 }, bump: 1, metal: 0.4, rough: [0.4, 0.75], layers: { grime: 0.6, scratch: 0.5, rust: 0.2, streak: 0.5, edge: 0.4 } }, { wet: true });
    M.hazard = B.m('pHazard', { pattern: 'hazard', size: 256, tile: 0.6, colors: [0xe0b020, 0x181818, 0x403830], params: { n: 6, angle: 0, wear: 0.7 }, bump: 1, rough: [0.5, 0.9], layers: { grime: 0.4 } }, { wet: true });
    M.tileSea = B.m('pTile', { pattern: 'tiles', size: 512, tile: 2, colors: [0x7aa08e, 0x5e8874, 0x2a3c34], params: { n: 8, grout: 0.008, checker: 0, bevel: 0.003, wear: 0.5, gloss: 0.7, crackle: 0.2 }, bump: 1.5, rough: [0.15, 0.5], layers: { grime: 0.6, wet: 0.4 } }, { wet: true });
    M.rope = B.m('pRope', { pattern: 'weave', size: 256, tile: 0.25, colors: [0x8a7a58, 0x5a4e36], params: { threads: 24, twill: 1, variation: 0.6, fuzz: 0.5 }, bump: 2, rough: [0.85, 1], layers: { grime: 0.5 } });
    M.sack = B.m('pSack', { pattern: 'weave', size: 256, tile: 0.5, colors: [0x8a7c58, 0x6a5e42], params: { threads: 32, twill: 0, variation: 0.6, fuzz: 0.7 }, bump: 2, rough: [0.9, 1], layers: { grime: 0.6, wet: 0.5 } }, { wet: true });
    M.tyre = B.m('pTyre', { pattern: 'rubber', size: 256, tile: 0.5, colors: [0x141414, 0x1e1e1e], params: { scale: 8, tread: 0.6 }, bump: 1.5, rough: [0.8, 0.95], layers: { grime: 0.4, dust: 0.3 } });
    M.black = B.m('pBlack', std({ color: 0x0c0d0e, roughness: 0.55, metalness: 0.5 })); M.chrome = B.m('pChrome', std({ color: 0xc0c8cc, roughness: 0.25, metalness: 1 })); M.wire = B.m('pWire', std({ color: 0x8a9092, roughness: 0.4, metalness: 1 }));
    M.lit = B.m('pLit', std({ color: 0x000000, emissive: 0xd8ffe8, emissiveIntensity: 1.4, roughness: 0.4 })); M.litW = B.m('pLitW', std({ color: 0x000000, emissive: 0xffd890, emissiveIntensity: 1.2, roughness: 0.4 }));
    M.dark = B.m('pDark', std({ color: 0x050809, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.4 })); M.reveal = B.m('pReveal', std({ color: 0x040606, roughness: 1 })); M.frame = B.m('pFrame', std({ color: 0x1c2420, roughness: 0.6, metalness: 0.4 }));
    M.flood = B.m('pFlood', std({ color: 0x000000, emissive: 0xd8f0ff, emissiveIntensity: 9, roughness: 0.4 })); M.sodium = B.m('pSodium', std({ color: 0x000000, emissive: 0xffb050, emissiveIntensity: 9, roughness: 0.4 })); M.red = B.m('pRedL', std({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 8 }));
    M.roofG = B.m('pRoof', { pattern: 'corrugated', size: 256, tile: 2, colors: [0x4a5650, 0x323c37], rustColor: 0x52301a, params: { ribs: 12, depth: 1, vertical: 0, dents: 1 }, bump: 18, metal: 0.45, rough: [0.45, 0.8], layers: { rust: 0.5, streak: 0.8, grime: 0.6 } }, { wet: true });
    const paint = (n, c) => B.m(n, { pattern: 'plates', size: 256, tile: 2, colors: [c, c, 0x101010], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2, panelVar: 0.1 }, bump: 1, metal: 0.06, rough: [0.3, 0.65], layers: { grime: 0.55, rust: 0.15, scratch: 0.5, streak: 0.6, edge: 0.3 } }, { wet: true });
    const van = { paint: paint('vanGreen', 0x4a5e50), paint2: paint('vanGrey', 0x6a716c) };
    const puddle = puddleMaterial(B, 'pPuddle', 0x04060a, 0x1c2c26);
    const bld = { wall: M.conc, roof: M.roofG, trim: M.stone, lit: M.lit, dark: M.dark, reveal: M.reveal, frame: M.frame, stone: M.stone, iron: M.steel }; const BL = makeBuilding(K, bld);
    // ------------------------------------------------------------------ ground: landing apron (slabs), wall, gate, quay wall with fenders + ladders
    const XW = 64, ZA = 58; const HERE = (x, z) => [x, z];
    B.box({ p: [0, -3.2, (ZA + QZ) / 2], s: [XW * 2, DY + 3.2 - 0.02, QZ - ZA], mat: M.conc, col: 'concrete' }); B.plane({ p: [0, DY + 0.003, (ZA + QZ) / 2], s: [XW * 2, QZ - ZA], mat: M.slab, cast: false });
    B.box({ p: [0, -3.2, (ZA - 40) / 2 + 0.0], s: [XW * 2, DY + 3.2 - 0.02, ZA + 40 + 0], mat: M.conc, col: 'concrete' }); B.plane({ p: [0, DY + 0.003, (ZA - 40 + 0) / 2 + 0.0], s: [XW * 2, ZA + 40], mat: M.slab, cast: false });
    B.colliders.groundY = -3; B.colliders.waterY = 0; B.colliders.groundSurface = 'concrete';
    const ladderX = [-54, -42, -30, 30, 42, 54]; const inRec = (x) => ladderX.some((l) => Math.abs(x - l) < 1.0);
    B.box({ p: [0, DY - 0.15, QZ - 0.3], s: [XW * 2 + 20, 0.3, 0.8], mat: M.stone, bevel: 0.03, cast: true });
    for (let x = -XW; x <= XW; x += 5) { if (inRec(x)) continue; B.box({ p: [x, 0.35, QZ + 0.16], s: [0.3, 1.5, 0.3], mat: M.black, bevel: 0.04, cast: false }); B.box({ p: [x, DY - 0.8, QZ + 0.1], s: [0.9, 0.5, 0.2], mat: M.yellow, bevel: 0.03, cast: false }); }
    for (const a of [17, 7.2, -7.2, -17]) K.bollard(-a, DY, QZ - 1.1, M.steel, { h: 0.65, r: 0.22 });
    for (const x of [-60, -48, -36, -24, 24, 36, 48, 60]) K.bollard(x, DY, QZ - 1.3, M.steel, { h: 0.6, r: 0.2 });
    for (const x of ladderX) K.ladder([x, QZ], [0, 1], DY, M.steel);
    K.quayFoam([-XW, QZ + 0.05], [XW, QZ + 0.05], 1.6, 0.7, 5); K.foamStrips[K.foamStrips.length - 1].side = -1;
    { let a = -XW; for (const lx of ladderX.concat([XW + 2])) { const b = lx - 1.2; if (b - a > 0.3) K.wallCol([a, QZ - 0.25], [b, QZ - 0.25], DY, DY + 1.3, 0.3, 'concrete'); a = lx + 1.2; } }
    for (const sx of [-1, 1]) { K.wallCol([sx * (XW - 0.3), QZ], [sx * (XW - 0.3), -30], DY, DY + 3, 0.5, 'concrete'); B.box({ p: [sx * XW, -3, 36.5], s: [1.2, DY + 3 + 9, 140], mat: M.conc, bevel: 0.03, col: false, walk: false }); }
    // stencilled numbers, bay lines, hazard edge, dock name
    K.decal('7', [0, DY + 0.014, 84], [9, 6], { fg: '#e0c420', from: [0, 1], w: 512, scale: 0.95 }); K.decal('LANDING B', [-30, DY + 0.014, 90], [10, 2], { fg: '#d8d8c8', from: [0, 1], w: 768 }); K.decal('NO PARKING', [32, DY + 0.014, 76], [8, 1.6], { fg: '#e0c420', from: [0, 1], w: 768 }); K.decal('AUTHORISED PERSONNEL ONLY', [0, DY + 0.014, 66], [24, 1.4], { fg: '#e0c420', from: [0, 1], w: 1536, scale: 0.7 });
    for (const x of [-46, -38, 38, 46]) K.decal(String(1 + ((x + 46) / 8 | 0)), [x, DY + 0.014, 96], [1.8, 2.4], { fg: '#d8d8c8', from: [0, 1], w: 256 });
    B.box({ p: [0, DY + 0.006, QZ - 0.6], s: [XW * 2 - 2, 0.01, 0.5], mat: M.hazard, bevel: 0, cast: false }); for (const x of [-56, -32, 32, 56]) B.box({ p: [x, DY + 0.006, 78], s: [0.16, 0.01, 12], mat: M.yellow, bevel: 0, cast: false });
    // ------------------------------------------------------------------ PERIMETER WALL + GATE ARCH + catwalk
    const WH = 8.6, GW = 5.0; const wall = (x0, x1) => { B.box({ p: [(x0 + x1) / 2, DY, ZA - 0.1], s: [x1 - x0, WH, 1.6], mat: M.conc, bevel: 0.04, col: 'concrete', walk: false, cast: true }); B.box({ p: [(x0 + x1) / 2, DY + WH, ZA - 0.1], s: [x1 - x0 + 0.2, 0.35, 2.0], mat: M.stone, bevel: 0.03, cast: true }); for (let x = x0 + 3; x < x1 - 2; x += 6) B.box({ p: [x, DY, ZA + 0.85], s: [0.5, WH - 0.5, 0.35], mat: M.conc, bevel: 0.02, cast: false }); K.razor([x0, DY + WH + 0.7, ZA - 0.1], [x1, DY + WH + 0.7, ZA - 0.1], M.wire); K.razor([x0, DY + WH + 0.45, ZA - 0.1], [x1, DY + WH + 0.45, ZA - 0.1], M.wire); };
    wall(-XW, -10); wall(10, XW);
    // cast-concrete formwork: tie-holes on a 1.2 m grid, panel seams every 2.4 m, board-mark bands (apron side of the perimeter wall)
    for (const [fa, fb] of [[-70, -12], [12, 70]]) { for (let fx = fa; fx <= fb; fx += 1.2) for (const yy of [1.0, 2.2, 3.4, 4.6, 5.8, 7.0, 8.0]) B.box({ p: [fx, DY + yy, ZA + 0.71], s: [0.07, 0.07, 0.02], mat: M.black, bevel: 0, cast: false, col: false });
      for (let yy = 2.4; yy < 8.6; yy += 2.4) B.box({ p: [(fa + fb) / 2, DY + yy, ZA + 0.706], s: [fb - fa, 0.014, 0.012], mat: M.black, bevel: 0, cast: false, col: false });
      for (let fx = fa; fx <= fb; fx += 2.4) B.box({ p: [fx, DY, ZA + 0.706], s: [0.014, 8.6, 0.012], mat: M.black, bevel: 0, cast: false, col: false }); }
    // apron: expansion joints every 4 m and slabs that have lifted 6-12 mm (trip edges that catch the searchlights)
    for (let jx = -40; jx <= 40; jx += 4) B.box({ p: [jx, DY + 0.006, 81], s: [0.03, 0.008, 38], mat: M.black, bevel: 0, cast: false, col: false }); for (let jz = 62; jz <= 100; jz += 4) B.box({ p: [0, DY + 0.006, jz], s: [80, 0.008, 0.03], mat: M.black, bevel: 0, cast: false, col: false });
    for (let i = 0; i < 46; i++) { const sx0 = -40 + 4 * Math.floor(rng() * 20), sz0 = 62 + 4 * Math.floor(rng() * 9.5); B.box({ p: [sx0 + 2, DY + 0.003, sz0 + 2], s: [3.94, 0.006 + rng() * 0.008, 3.94], mat: M.slab, bevel: 0.004, cast: false, col: false, pitch: (rng() - 0.5) * 0.004, roll: (rng() - 0.5) * 0.004 }); }
    // gatehouse: massive rusticated arch cut into the wall, steel gates (open), guard rooms above
    B.box({ p: [-7.5, DY, ZA - 0.3], s: [5, 12.5, 3.6], mat: M.stone, bevel: 0.05, col: 'concrete', walk: false, cast: true }); B.box({ p: [7.5, DY, ZA - 0.3], s: [5, 12.5, 3.6], mat: M.stone, bevel: 0.05, col: 'concrete', walk: false, cast: true }); B.box({ p: [0, DY + 8.2, ZA - 0.3], s: [10.2, 4.4, 3.6], mat: M.stone, bevel: 0.05, col: 'concrete', walk: false, cast: true });
    { const pts = []; for (let i = 0; i <= 14; i++) { const a = P * i / 14; pts.push([Math.cos(a) * (GW / 2 + 0.25), DY + 6.2 + Math.sin(a) * (GW / 2 + 0.25), ZA + 1.55]); } B.tube({ pts, r: 0.22, mat: M.stone, seg: 6, segs: 24, cast: true }); }
    B.box({ p: [0, DY + 6.2, ZA + 1.55], s: [GW + 0.4, 0.5, 0.5], mat: M.stone, bevel: 0.03, cast: false }); // spring line
    K.sign(["H.M. PRISON", "ISLAND No.7"], [0, DY + 9.5, ZA + 1.53], [7.6, 1.9, 0.12], { bg: '#1a201c', fg: '#d8d2b4', weather: 0.9, w: 1024 });
    for (const sd of [-1, 1]) { const x = sd * (GW / 2 - 0.05); B.box({ p: [x - sd * 1.15, DY, ZA + 2.0], s: [2.3, 5.8, 0.14], mat: M.steel, bevel: 0.02, cast: false, col: false }); for (let i = 0; i < 8; i++) B.box({ p: [x - sd * 0.2 - sd * i * 0.28, DY + 0.2, ZA + 1.93], s: [0.06, 5.6, 0.06], mat: M.black, bevel: 0, cast: false }); }
    B.box({ p: [0, DY, ZA - 0.3], s: [GW, 6.0, 3.0], mat: M.reveal, bevel: 0, cast: false }); K.glare([0, DY + 5.6, ZA + 1.2], 0xd8f0ff, 0.6, 0.6, { refl: 2, mist: 1 }); for (const sd of [-1, 1]) { const h = [sd * 4.6, DY + 5.4, ZA + 2.3]; B.cyl({ p: [h[0], DY, h[2]], r: 0.09, h: 5.4, seg: 6, mat: M.steel, cast: true, col: false }); B.box({ p: [h[0] - sd * 0.3, h[1] - 0.1, h[2]], s: [0.7, 0.35, 0.5], mat: M.steel, bevel: 0.03, cast: false }); K.lamp([h[0] - sd * 0.5, h[1] - 0.35, h[2] + 0.3], { color: 0xd8f0ff, cd: 34, dist: 30, size: 0.55, refl: 4, flick: 0.01 }); }
    K.wallCol([-GW / 2, ZA + 1.5], [GW / 2 + 0, ZA + 1.5], DY, DY + 0.1, 0.2, 'metal'); // (no solid across the gate)
    // gate ironmongery: hinge straps + pins, lock cases, chain and padlock
    for (const sd of [-1, 1]) { for (const yy of [0.6, 2.9, 5.2]) { B.box({ p: [sd * 2.05, DY + yy, ZA + 2.08], s: [0.8, 0.14, 0.03], mat: M.black, bevel: 0.005, cast: false, col: false }); B.cyl({ p: [sd * 2.45, DY + yy - 0.02, ZA + 2.06], r: 0.045, h: 0.2, seg: 8, mat: M.black, cast: false }); } B.cyl({ p: [sd * 2.46, DY + 0.4, ZA + 2.05], r: 0.03, h: 5.3, seg: 6, mat: M.black, cast: false }); B.box({ p: [sd * 0.3, DY + 1.5, ZA + 2.1], s: [0.22, 0.32, 0.07], mat: M.black, bevel: 0.01, cast: false, col: false }); }
    chainLinks(B, M.black, [-0.28, DY + 1.55, ZA + 2.14], [0.28, DY + 1.55, ZA + 2.14], { sag: 0.16 }); B.box({ p: [0, DY + 1.36, ZA + 2.14], s: [0.1, 0.13, 0.05], mat: M.black, bevel: 0.01, cast: false, col: false });
    for (const sd of [-1, 1]) B.colliders.addBox({ x: sd * (GW / 2 + 3.0), y: DY + 6, z: ZA - 0.3, hx: 3.0, hy: 6.5, hz: 1.8, surface: 'concrete', walk: false });
    // guard-room windows above the arch (lit) + wall lamps
    B.box({ p: [0, DY + 8.6, ZA + 1.5], s: [6, 1.3, 0.06], mat: M.lit, bevel: 0, cast: false }); for (let i = -2; i <= 2; i++) B.box({ p: [i * 1.2, DY + 8.6, ZA + 1.53], s: [0.08, 1.3, 0.06], mat: M.frame, bevel: 0, cast: false });
    // catwalk inside the wall + stair towers + rail
    const CW = { y: 6.4, z0: ZA - 2.4, z1: ZA - 0.9 }; for (const [x0, x1] of [[-XW + 4, -12], [12, XW - 4]]) { B.box({ p: [(x0 + x1) / 2, DY + CW.y - 0.12, (CW.z0 + CW.z1) / 2], s: [x1 - x0, 0.14, CW.z1 - CW.z0], mat: M.steel, bevel: 0.01, col: 'metal', walk: true, cast: true }); for (let x = x0; x <= x1; x += 3) { B.box({ p: [x, DY, CW.z0 + 0.1], s: [0.2, CW.y - 0.12, 0.2], mat: M.steel, bevel: 0, cast: false }); } for (const y of [0.5, 1.05]) B.box({ p: [(x0 + x1) / 2, DY + CW.y + y - 0.1, CW.z0], s: [x1 - x0, 0.05, 0.05], mat: M.steel, bevel: 0, cast: false }); K.wallCol([x0, CW.z0], [x1, CW.z0], DY + CW.y, DY + CW.y + 1.2, 0.12, 'metal'); }
    for (const sx of [-1, 1]) { const x = sx * 30; B.stairs({ p: [x, DY, CW.z0 - 9.3], n: 35, rise: CW.y / 35, run: 0.26, w: 1.3, yaw: -P / 2, mat: M.steel, col: 'metal' }); }
    // ------------------------------------------------------------------ WATCHTOWERS with searchlights (sweeping, visible cones)
    const towers = []; const SLmat = M.steel;
    const tower = (x, z, h, sweep) => {
      B.box({ p: [x, DY, z], s: [3.6, h, 3.6], mat: M.conc, bevel: 0.05, col: 'concrete', walk: false, cast: true }); for (let y = 3; y < h - 4; y += 5.5) B.box({ p: [x, DY + y, z], s: [3.9, 0.3, 3.9], mat: M.stone, bevel: 0.03, cast: false });
      const cy = DY + h; B.box({ p: [x, cy, z], s: [5.4, 0.45, 5.4], mat: M.steel, bevel: 0.03, cast: true }); B.box({ p: [x, cy + 0.45, z], s: [4.6, 2.6, 4.6], mat: M.frame, bevel: 0.04, cast: true }); for (const sd of [-1, 1]) { B.box({ p: [x, cy + 1.2, z + sd * 2.32], s: [4.2, 1.2, 0.06], mat: M.lit, bevel: 0, cast: false }); B.box({ p: [x + sd * 2.32, cy + 1.2, z], s: [0.06, 1.2, 4.2], mat: M.lit, bevel: 0, cast: false }); }
      B.prism({ p: [x, cy + 3.05, z], s: [5.6, 1.5, 5.6], mat: M.roofG }); for (const y of [0.5, 1.05]) for (const [dx, dz, w, d] of [[0, 2.7, 5.4, 0.05], [0, -2.7, 5.4, 0.05], [2.7, 0, 0.05, 5.4], [-2.7, 0, 0.05, 5.4]]) B.box({ p: [x + dx, cy + 0.45 + y - 0.1 - 0.4, z + dz], s: [w, 0.05, d], mat: M.steel, bevel: 0, cast: false });
      // external stairs (zigzag) up the shaft
      // searchlight on the roof edge: housing + lens + rotating group
      const g = new THREE.Group(); g.position.set(x, cy + 3.6, z); B.group.add(g); const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 14), M.flood); lens.rotation.x = P / 2; lens.position.z = 0.9; g.add(lens); const hous = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 1.4, 14), SLmat); hous.rotation.x = P / 2; hous.position.z = 0.2; g.add(hous); const yoke = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12), SLmat); yoke.position.set(0, 0, 0.2); g.add(yoke); const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 8), SLmat); post.position.set(0, -0.8, 0.2); g.add(post);
      const beam = makeSoftBeam({ length: 170, w0: 0.22, w1: 4.2, color: 0xdff4ff, intensity: 0.42, dust: 0.7, fall: 0.0035, near: 8 }); beam.position.copy(g.position); B.group.add(beam);
      const spot = ctx.light({ pos: [x, cy + 3.6, z], color: 0xdff4ff, intensity: 1300, distance: 120, decay: 2, kind: 'spot', dir: [0, -0.3, 1], angle: 0.14, penumbra: 0.45, shadow: sweep.shadow });
      K.glare([x, cy + 3.6, z], 0xdff4ff, 0.7, 1.0, { refl: 4, mist: 1.4 }); K.glare([x, cy + 4.3, z], 0xff2010, 0.35, 1.2, { blink: [1.6, 0.3, x * 0.01], refl: 1.5, mist: 1.2 });
      for (let i = 0; i < 3; i++) K.lamp([x + (i - 1) * 1.6, cy - 0.5, z + 2.8], { color: 0xd8f0ff, cd: 20, dist: 14, size: 0.35, refl: 2, light: false });
      for (const [cxx, czz] of [[1.9, 1.9], [-1.9, 1.9]]) { B.cyl({ p: [x + cxx, DY, z + czz], r: 0.045, h: h, seg: 6, mat: M.black, cast: false }); for (let yy = 2; yy < h - 2; yy += 4) B.box({ p: [x + cxx, DY + yy, z + czz], s: [0.16, 0.2, 0.12], mat: M.black, bevel: 0.01, cast: false, col: false }); }
      towers.push({ g, beam, spot, x, y: cy + 3.6, z, ...sweep }); return { cy };
    };
    tower(-55, 62, 19, { base: -0.35, amp: 1.1, w: 0.22, ph: 0.0, pitch: -0.32, shadow: true }); tower(55, 62, 19, { base: 0.35, amp: 1.1, w: 0.19, ph: 2.1, pitch: -0.3, shadow: true }); tower(0, -12, 26, { base: 0.0, amp: 0.7, w: 0.13, ph: 4.0, pitch: -0.14, shadow: false });
    for (const [x, z] of [[-55, 62], [55, 62]]) { B.beam([x - 1.6, DY, z + 2.2], [x - 1.6, DY + 8, z + 2.2], 0.1, 0.1, { mat: M.steel, bevel: 0, cast: false }); }
    // ------------------------------------------------------------------ CELL BLOCK on the cliff behind (barred lit windows), chimney, water tank, cliffs (rock)
    const CB = { x0: -46, x1: 46, z0: -30, z1: 14, h: 17 }; B.box({ p: [(CB.x0 + CB.x1) / 2, DY, (CB.z0 + CB.z1) / 2], s: [CB.x1 - CB.x0, CB.h, CB.z1 - CB.z0], mat: M.conc, bevel: 0.06, col: 'concrete', walk: false, cast: true }); BL.flatRoof(CB.x0, CB.z0, CB.x1, CB.z1, DY + CB.h, 0.9);
    for (let r = 0; r < 4; r++) { const n = 24, step = (CB.x1 - CB.x0 - 4) / n; for (let k = 0; k < n; k++) { const x = CB.x0 + 2 + step * (k + 0.5), y = DY + 1.4 + r * 3.9, lit = rng() < 0.16; B.box({ p: [x, y, CB.z1 + 0.04], s: [1.0, 1.6, 0.08], mat: M.reveal, bevel: 0, cast: false }); B.box({ p: [x, y + 0.08, CB.z1 + 0.1], s: [0.9, 1.45, 0.05], mat: lit ? M.lit : M.dark, bevel: 0, cast: false }); for (let b = -2; b <= 2; b++) B.box({ p: [x + b * 0.18, y + 0.05, CB.z1 + 0.15], s: [0.03, 1.55, 0.04], mat: M.black, bevel: 0, cast: false }); B.box({ p: [x, y - 0.1, CB.z1 + 0.14], s: [1.1, 0.08, 0.14], mat: M.stone, bevel: 0.01, cast: false }); if (lit && r === 0) K.glare([x, y + 0.8, CB.z1 + 0.6], 0xd8ffe8, 0.5, 0.5, { refl: 1.5, mist: 1.2 }); } }
    B.box({ p: [0, DY, CB.z1 + 0.6], s: [16, 6.6, 1.2], mat: M.stone, bevel: 0.05, col: 'concrete', walk: false, cast: true }); B.box({ p: [0, DY + 6.6, CB.z1 + 0.4], s: [17, 0.5, 1.6], mat: M.steel, bevel: 0.03, cast: false }); K.sign(['ADMINISTRATION', 'VISITORS REPORT HERE'], [0, DY + 4.2, CB.z1 + 1.22], [10, 1.2, 0.08], { bg: '#1c241e', fg: '#d8d2b4', weather: 0.9, w: 1024 });
    B.cyl({ p: [-30, DY + CB.h, -22], r: [2.0, 1.4], h: 22, seg: 14, mat: M.conc, col: 'concrete', cast: true }); B.cyl({ p: [-30, DY + CB.h + 22, -22], r: 1.55, h: 0.5, seg: 14, mat: M.steel, cast: false }); K.glare([-30, DY + CB.h + 23, -22], 0xff2010, 0.7, 1.4, { blink: [1.6, 0.3, 0.5], refl: 3, mist: 1.4 });
    B.cyl({ p: [26, DY + CB.h + 0.3, -18], r: 2.6, h: 4, seg: 14, mat: M.rustS, col: false, cast: true }); B.cyl({ p: [26, DY + CB.h + 4.3, -18], r: [2.6, 0.2], h: 1.4, seg: 14, mat: M.rustS, cast: false });
    for (const [x, y, z, r, sq, sd] of [[-105, -2, 20, 30, [1.2, 1.3, 1.6], 3], [105, -2, 24, 30, [1.2, 1.4, 1.5], 9], [-100, -2, -40, 34, [1.2, 1.5, 1.4], 14], [100, -2, -46, 34, [1.2, 1.4, 1.4], 21], [0, 0, -84, 46, [2.4, 1.0, 0.9], 5], [-46, 0, -70, 28, [1.5, 1.2, 1.0], 27], [46, 0, -70, 28, [1.5, 1.2, 1.0], 33], [-150, -6, 60, 40, [1, 0.8, 1], 41], [150, -6, 60, 40, [1, 0.8, 1], 47]]) B.rock({ p: [x, y + r * sq[1] * 0.4, z], r, squash: sq, amp: 0.4, seed: sd, detail: 3, mat: M.rock, col: false, cast: true });
    // ------------------------------------------------------------------ inner yard: fences/cages with razor wire, guard shacks, laundry, benches, sally-port funnel on the apron
    const fenceMat = M.wire; const cage = (x0, z0, x1, z1) => { for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]]) { if (a[0] === x0 && b[0] === x0) continue; K.fence([a[0], a[1]], [b[0], b[1]], 3.2, M.steel, { y0: DY, wire: true, wireMat: fenceMat }); } };
    cage(-56, 28, -36, 44); cage(36, 28, 56, 44);
    // sally-port funnel on the apron: two chain-link lanes leading to the gate
    for (const sd of [-1, 1]) { K.fence([sd * 9, 74], [sd * 9, 60], 3.0, M.steel, { y0: DY, wire: true, wireMat: fenceMat }); K.fence([sd * 9, 74], [sd * 24, 88], 3.0, M.steel, { y0: DY, wire: true, wireMat: fenceMat, col: false }); K.wallCol([sd * 9, 74], [sd * 24, 88], DY, DY + 2.8, 0.15, 'metal'); }
    K.fence([-9, 60.5], [-4, 60.5], 3.0, M.steel, { y0: DY, wire: false, col: false });
    // guard shacks
    const shack = (x, z, w, d, yaw) => { B.box({ p: [x, DY, z], s: [w, 2.9, d], mat: M.conc, bevel: 0.04, col: 'concrete', walk: false, cast: true }); B.box({ p: [x, DY + 2.9, z], s: [w + 0.5, 0.2, d + 0.5], mat: M.steel, bevel: 0.02, cast: true }); B.box({ p: [x, DY + 1.3, z + d / 2 + 0.02], s: [w - 0.8, 1.0, 0.05], mat: M.litW, bevel: 0, cast: false }); B.box({ p: [x + w / 2 + 0.02, DY + 1.3, z], s: [0.05, 1.0, d - 0.8], mat: M.litW, bevel: 0, cast: false }); K.glare([x, DY + 1.6, z + d / 2 + 0.8], 0xffd890, 0.5, 0.6, { refl: 2, mist: 1.2 }); K.lamp([x, DY + 3.2, z + d / 2 + 0.5], { color: 0xffb050, cd: 24, dist: 16, size: 0.4, refl: 2.6 }); };
    shack(-16, 68, 3.6, 3.0); shack(16, 68, 3.6, 3.0); shack(-30, 22, 4.4, 3.4);
    // prison van (armoured, barred windows) parked on the apron + jeep-like patrol car + crates/sandbags/barrels
    const vanBody = (x, z, alongX) => { const L = 6.6, W = 2.4; const s = alongX ? [L, 2.6, W] : [W, 2.6, L]; B.box({ p: [x, DY + 0.5, z], s, mat: van.paint, bevel: 0.08, col: 'metal', walk: false, cast: true }); B.box({ p: [x + (alongX ? 3.6 : 0), DY + 0.5, z + (alongX ? 0 : 3.6)], s: alongX ? [1.6, 2.0, 2.2] : [2.2, 2.0, 1.6], mat: van.paint2, bevel: 0.1, cast: true }); for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { const q = alongX ? [x - 1.6 + i * 1.5, DY + 1.9, z + sd * (W / 2 + 0.02)] : [x + sd * (W / 2 + 0.02), DY + 1.9, z - 1.6 + i * 1.5]; B.box({ p: q, s: alongX ? [0.7, 0.55, 0.05] : [0.05, 0.55, 0.7], mat: M.dark, bevel: 0, cast: false }); for (let b = -1; b <= 1; b++) B.box({ p: [q[0] + (alongX ? b * 0.2 : sd * 0.03), q[1], q[2] + (alongX ? sd * 0.03 : b * 0.2)], s: alongX ? [0.03, 0.6, 0.03] : [0.03, 0.6, 0.03], mat: M.black, bevel: 0, cast: false }); }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const q = alongX ? [x + sx * 2.1, DY + 0.5, z + sz * 1.2] : [x + sz * 1.2, DY + 0.5, z + sx * 2.1]; B.cyl({ p: q, r: 0.5, h: 0.3, seg: 14, mat: M.tyre, roll: alongX ? 0 : P / 2, pitch: alongX ? P / 2 : 0, anchor: 'center', cast: true }); } K.glare([x + (alongX ? 4.4 : 0), DY + 1.9, z + (alongX ? 0 : 4.4)], 0xff2010, 0.4, 1.2, { blink: [0.9, 0.35], refl: 2, mist: 1 }); };
    vanBody(34, 82, true); vanBody(-38, 72, true);
    const keep = [[1.5, 98, 9], [0, 62, 10], [-30, 22, 6], [34, 82, 6], [-38, 72, 6]];
    const scatter = (n, area, fn) => { let t = 0; while (n > 0 && t++ < n * 40) { const x = area[0] + rng() * (area[2] - area[0]), z = area[1] + rng() * (area[3] - area[1]); if (keep.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue; fn(x, z); n--; } };
    scatter(22, [-58, 20, 58, 102], (x, z) => { const k = rng(); if (k < 0.3) K.crate(x, DY, z, 0.9, 0.8 + rng() * 0.3, 0.9, M.steel, { batten: M.steel, slats: false }); else if (k < 0.55) K.barrel(x, DY, z, rng() < 0.5 ? M.rustS : M.steel); else if (k < 0.8) { for (let j = 0; j < 4; j++) B.box({ p: [x + (j % 2) * 0.8, DY + Math.floor(j / 2) * 0.28, z + (j % 2) * 0.05], s: [0.75, 0.26, 0.42], mat: M.sack, bevel: 0.12, col: 'fabric', walk: false, cast: true }); } else K.coil(x, DY, z, M.rope, { r: 0.4 }); });
    for (const [x, z] of [[-6, 70], [6, 70], [-6, 62], [6, 62]]) for (let j = 0; j < 7; j++) B.box({ p: [x + (j % 3) * 0.7 - 0.7, DY + Math.floor(j / 3) * 0.28, z + (j % 2) * 0.1], s: [0.7, 0.26, 0.4], mat: M.sack, bevel: 0.12, col: j === 0 ? 'fabric' : false, walk: false, cast: true });
    // ------------------------------------------------------------------ DRESSING: jersey-barrier chicanes, sandbag emplacements, transport bus + patrol jeep, gate booths + boom barrier, floodlight stands, generator/tank, supply pallets, processing lockers + benches
    { M.timber = B.m('pTimber', { pattern: 'planks', size: 512, tile: 2, colors: [0x6a5a44, 0x4a3e2c, 0x1a140c], params: { rows: 8, gap: 0.006, grain: 8, knots: 0.3, cols: 1, vertical: 0, weather: 0.9, nails: 0 }, bump: 4, rough: [0.7, 0.95], layers: { grime: 0.6, streak: 0.5 } }, { wet: true });
      const PR = makeProps(K, { wood: M.timber, iron: M.steel, rust: M.rustS, steel: M.steel, rope: M.rope, conc: M.conc, tyre: M.tyre, glass: M.dark, lit: M.lit, black: M.black }, DY); const Q = P / 2;
      PR.jersey(-10, 88.5, 0, { n: 4 }); PR.jersey(13, 85.5, 0, { n: 4 }); PR.jersey(-2, 79.5, 0, { n: 3 }); PR.jersey(-26, 78, 0, { n: 3 }); PR.jersey(27, 76, 0, { n: 3 }); PR.jersey(0, 100.4, 0, { n: 2, stripe: undefined });
      PR.sandbags(-22, 84, 0, { len: 3.6, rows: 4, thick: true }); PR.sandbags(24, 80.5, 0, { len: 3.6, rows: 4, thick: true }); PR.sandbags(-53, 67.5, Q, { len: 3.4, rows: 4, thick: true }); PR.sandbags(53, 67.5, Q, { len: 3.4, rows: 4, thick: true }); PR.sandbags(-15, 64.5, 0, { len: 2.4, rows: 3 }); PR.sandbags(15, 64.5, 0, { len: 2.4, rows: 3 });
      PR.cones([[-4, 93], [-2, 91.4], [0, 89.8], [2, 88.2], [4, 86.6], [-0.5, 83], [-3, 82], [3.5, 82.5]]);
      PR.bus(-33, 93, 0, { on: false, beacon: false }); PR.jeep(36, 92.5, P, { beacon: true, on: false });
      PR.barrier(-4.9, 62.8, Q, { len: 9.4 }); PR.booth(-13.5, 62.2, 0, { light: 0xffd890 }); PR.booth(13.5, 62.2, 0, { light: 0xffd890 });
      PR.floodStand(-19, 91, Q, { cd: 24, color: 0xdff4ff }); PR.floodStand(20, 94, -Q, { cd: 24, color: 0xdff4ff }); PR.floodStand(-45, 76, 0, { cd: 22, color: 0xdff4ff });
      PR.generator(-50.4, 78, Q); PR.tank(-57.5, 84, 0, { r: 0.65, len: 3.0, mat: M.rustS }); PR.drumRack(-58.5, 74, Q); PR.generator(52, 76, -Q); PR.drumRack(58, 84, Q);
      PR.pallet(45, 95.5, 0, { load: 'boxes', n: 3 }); PR.pallet(46.6, 95.5, 0, { load: 'boxes', n: 2 }); PR.pallet(-45, 96, 0, { load: 'crates', n: 2 }); PR.sacks(-52, 96, 0, { rows: 3, cols: 3 }); PR.pallet(20, 100, 0, { load: 'sacks', n: 4 }); PR.handcart(-14, 96, 0.6); PR.handcart(31, 98, 2.6);
      // apron foreground cover: crate pyramids (2.9 m), drum clusters, a sandbag nest with a floodlight
      { const pyr = (x, z, yw) => { for (let k = 0; k < 3; k++) for (let i = 0; i < 3 - k; i++) K.crate(x + (i - (2 - k) / 2) * 1.5 * Math.cos(yw), DY + k * 1.0, z - (i - (2 - k) / 2) * 1.5 * Math.sin(yw), 1.4, 1.0, 1.1, M.timber, { batten: M.steel, yaw: yw }); }; pyr(-10.5, 83.5, 0); pyr(11.5, 80.8, 0.2); PR.drumRack(-9.5, 95.5, 0); PR.drumRack(12.5, 96, Q); PR.sandbags(6.8, 88.6, 0, { len: 2.6, rows: 4, thick: true }); PR.sandbags(-7.2, 87.4, 0, { len: 2.6, rows: 3 }); PR.pallet(-20.5, 88.5, Q, { load: 'boxes', n: 3 }); PR.pallet(24.5, 93.5, 0, { load: 'crates', n: 3 }); }
      PR.lockers(-42, 60.4, 0, { n: 6 }); PR.lockers(42, 60.4, 0, { n: 6 }); PR.bench(-30, 63.6, P); PR.bench(-24, 63.6, P); PR.bench(24, 63.6, P); PR.bench(30, 63.6, P); PR.bin(-36, 60.9); PR.bin(36, 60.9);
      K.sign(['NO PHOTOGRAPHY', 'ALL VISITORS REPORT TO GATEHOUSE'], [-30, DY + 4.6, 59.05], [4.4, 1.1, 0.06], { bg: '#a01818', fg: '#f0e8d8', weather: 0.6, w: 768 }); K.sign(['HM PRISON SERVICE', 'SECURE AREA · CCTV IN OPERATION'], [30, DY + 4.6, 59.05], [4.4, 1.1, 0.06], { bg: '#1a2a3a', fg: '#e8e0c0', weather: 0.6, w: 768 });
    }
    // flood-lit poles (mercury) along the apron; sodium low lamps by the shacks; puddles
    for (const [x, z] of [[-48, 98], [-24, 96], [24, 96], [48, 98], [-46, 66], [46, 66], [-30, 40], [30, 40], [0, 36]]) { const h = K.lampPost(x, z, DY, { h: 9.5, mat: M.steel, glowMat: M.flood, dir: [0, z > 60 ? -1 : 1], arm: 1.2 }); K.lamp(h, { color: 0xd0ecff, cd: 28, dist: 32, size: 0.65, refl: 4.5, spill: true, spillR: 12 }); B.box({ p: [h[0], h[1] - 0.05, h[2]], s: [0.9, 0.12, 0.45], mat: M.flood, bevel: 0, cast: false }); }
    for (let i = 0; i < 22; i++) { const x = -56 + rng() * 112, z = 22 + rng() * 78; const s = 0.9 + rng() * 2.6; K.puddle(puddle, x, DY + 0.006, z, s * 0.8, s * 0.55, rng() * P); }
    K.puddle(puddle, 1.5, DY + 0.007, 96, 2.2, 1.5, 0.1);
    // signs: warning boards on the wall/fences
    K.sign(['WARNING', 'PRISON PROPERTY', 'NO LANDING BEYOND THIS POINT'], [-20, DY + 3.6, ZA + 0.9], [5.2, 1.8, 0.06], { bg: '#e0c020', fg: '#181818', weather: 0.8, w: 768 }); K.sign(['SEARCH', 'ALL VISITORS'], [20, DY + 3.6, ZA + 0.9], [3.2, 1.4, 0.06], { bg: '#a82a22', fg: '#f0e8d0', weather: 0.8, w: 512 });
    // ------------------------------------------------------------------ atmosphere weather: thin cold mist wisps + faint drizzle
    ctx.weather({ count: 2200, box: [36, 22, 36], fall: 9, wind: null, size: 0.024, turb: 0.15, streak: 14, color: [0.6, 0.68, 0.72], alpha: 0.26, cell: 13, seed: 13 });
    decalAtlas(K, [
      { x: -12, z: 76, w: 24, d: 24, kind: 'concrete', y: DY + 0.014, paths: [[[1.5, 96], [1, 80], [0, 66]]], litter: 1.0 },
      { x: -36, z: 76, w: 24, d: 24, kind: 'concrete', y: DY + 0.014, paths: [[[1.5, 96], [-20, 90], [-34, 64]]], litter: 1.0 },
      { x: 12, z: 76, w: 24, d: 24, kind: 'concrete', y: DY + 0.014, paths: [[[1.5, 96], [20, 90], [34, 64]]], litter: 1.0 },
      { x: -12, z: 58, w: 24, d: 18, kind: 'concrete', y: DY + 0.014, litter: 1.0 }], { seed: 13 });
    K.finishFoam();
    // ------------------------------------------------------------------ gameplay data
    const spawns = [...K.spawns]; for (const x of [-52, 0, 52]) spawns.push({ kind: 'walk', pos: [x, DY, 22], yaw: P, note: 'cell block yard' }); spawns.push({ kind: 'walk', pos: [-60, DY, 60], yaw: P / 2, note: 'west gate' }, { kind: 'walk', pos: [60, DY, 60], yaw: -P / 2, note: 'east gate' });
    const gulls = makeGulls(B, 8, { cx: 0, cz: 100, rx: 90, rz: 30, perched: 5, rng, spots: [[24, DY + 0.72, QZ - 1.3], [36, DY + 0.72, QZ - 1.3], [-24, DY + 0.72, QZ - 1.3], [-36, DY + 0.72, QZ - 1.3], [48, DY + 0.72, QZ - 1.3]] });
    const sw = { t: 0 }; let flash = 0;
    const data = {
      atmo: ATMO[IDX], reflect: { level: DY }, envPatches: ENV[IDX], playerStart: { pos: [1.5, DY, 96], yaw: 0 }, station: { pos: ST.stationLocal, yaw: ST.yaw }, groundY: -3, waterY: 0, waterHeight: (wx, wz) => sea.height(wx, wz), groundSurface: 'concrete',
      navBounds: [-62, 18, 62, 103], navBlocked: (x, z, gy) => gy < 1.0, navCell: 0.6, landmark: { pos: [-55, DY + 24, 62], name: 'Searchlight watchtower & gate arch' }, mooring: [17, 7.2, -7.2, -17].map((a) => ST.toLocal(a, BEAM_HALF + FENDER + 1.1)),
      spawns, buys: { walls: [{ pos: [-22, DY + 1.55, ZA + 0.75], yaw: 0, gun: 'ak74u' }, { pos: [22, DY + 1.55, ZA + 0.75], yaw: 0, gun: 'remington870' }], perks: [{ pos: [-22, DY, 66], yaw: 0, perk: 'doubletap' }], box: { pos: [-44, DY, 84], yaw: P / 2 } },
      zombieVariants: [{ id: 'ferry_guard', weight: 3, minRound: 1 }, { id: 'ferry_inmate', weight: 3, minRound: 1 }, { id: 'ferry_drowned', weight: 2, minRound: 2 }],
      ambient: { space: 'open', gain: 1, beds: [{ type: 'water', gain: 0.5, lap: 0.7 }, { type: 'wind', gain: 0.32, gust: 0.35 }, { type: 'hum', freq: 100, gain: 0.09 }, { type: 'machine', gain: 0.1 }], events: [{ type: 'klaxon', every: [28, 60], gain: 0.5, pos: 'far' }, { type: 'clank', every: [7, 16], gain: 0.6, pos: 'around' }, { type: 'foghorn', every: [35, 70], gain: 0.6, pos: 'far' }, { type: 'radio', every: [18, 40], gain: 0.3, pos: [-16, 3, 68] }, { type: 'gull', every: [14, 30], gain: 0.3 }, { type: 'scream-far', every: [40, 90], gain: 0.25, pos: 'far' }, { type: 'creak', every: [6, 14], gain: 0.4 }] },
      update(dt, t, active) {
        gulls.update(t);
        sea.tick(t, gfx.camera.position, gfx);
        const O = ctx.origin; for (const T of towers) { const yaw = T.base + T.amp * Math.sin(t * T.w + T.ph); const cp = Math.cos(T.pitch), sp = Math.sin(T.pitch); const dx = Math.sin(yaw) * cp, dz = Math.cos(yaw) * cp; const tx = O.x + T.x + dx * 10, ty = O.y + T.y + sp * 10, tz = O.z + T.z + dz * 10; T.g.lookAt(tx, ty, tz); T.beam.lookAt(tx, ty, tz); if (T.spot) T.spot.dir.set(dx, sp, dz); }
        if (!active) return; sw.t += dt;
        if (sw.t > 0.09) { sw.t = 0; const o = ctx.origin; fx.puff({ x: o.x + 26, y: o.y + DY + 24.6, z: o.z - 18 }, { x: 0, y: 1, z: 0 }, 1, { speed: 0.5, size: [0.4, 2.0], life: 4.5, color: [0.2, 0.22, 0.22, 0.14], rise: 1.2, drag: 0.6, spread: 0.3, cell: 1 }); }
      },
    };
    for (const w of data.buys.walls) K.wallLamp(w.pos[0], w.pos[1], w.pos[2], Math.sin(w.yaw), Math.cos(w.yaw), { color: 0xdff0ff, mat: M.steel, cd: 18 });
    return data;
  },
};
