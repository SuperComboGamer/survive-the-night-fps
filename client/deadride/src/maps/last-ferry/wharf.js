// LAST FERRY — Stop 2: FISH-MARKET WHARF. Cobbled wet wharf, covered stalls, ice/fish crates, hanging scales, neon FRESH FISH / OYSTERS / CRAB signs (pink-green-blue),
// a big iron market hall (enterable), a rusty trawler moored alongside, boiling shed steam, gulls, drying racks and nets. Wet, slimy, cyan-magenta.
// Landmark: the market hall with the huge neon sign + the trawler. Ferry berth: west face (ferry heads north, quay on its starboard = east).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { rand, makeRng } from '../../core/util.js';
import { STOPS, BEAM_HALF, FENDER } from './layout.js';
import { ATMO, ENV } from './atmos.js';
import { getSea, withLampRefl } from './shared.js';
import { makeKit, puddleMaterial, fitTex } from './kit.js';
import { makeBuilding } from './bld.js';
import { stall, trawler, makeGulls, fishGeo, stripeMat } from './wharfProps.js';
import { stubStop, skipStop } from './stub.js';
import { makeProps } from './props2.js';
import { platform } from './cover.js';
import { decalAtlas } from './decals.js';
import { stallDress, fishGeoLite, fishMatLite, instG } from './detail3.js';
import { facadeReal } from './arch.js';
import { truck } from './pierProps.js';
import { makeBoat } from './boats.js';

const P = Math.PI, IDX = 1, ST = STOPS[1], QX = ST.quayFace, DY = ST.quayY;   // quay face x = -103.2, wharf height 1.35

export default {
  id: 'wharf', name: 'Fish-Market Wharf', origin: ST.origin, viewRadius: 330,
  async build(ctx) {
    if (skipStop(IDX)) return stubStop(ctx, IDX, this);
    const { B, fx, gfx } = ctx; const sea = getSea(); sea.attach(ctx.world.root); const K = makeKit(ctx, IDX); const rng = K.rng;
    // ------------------------------------------------------------------ materials (teal/green slime, white tile, painted timber, plastic crates, neon)
    const M = {};
    M.cobble = B.m('cobbleW', { pattern: 'stone', size: 1024, tile: 2, colors: [0x647572, 0x4a5b58, 0x1a2624, 0x8a9e9a], params: { scale: 12, gap: 0.1, round: 0.6, variation: 0.6, mortarDark: 0.7, strata: 0, lichen: 0.35 }, mossColor: 0x3a7048, bump: 16, rough: [0.32, 0.78], layers: { moss: 0.3, grime: 0.4, wet: 0.45, oil: 0.2, sparkle: 0.4 } }, { wet: true, breakup: 0.5, refl: 1, detail: 'gravel', frag: 'roughnessFactor = max(roughnessFactor, 0.38);' }); withLampRefl(M.cobble, { gain: 0.9, maxRough: 0.8, patchy: 0.85 });
    M.wall = B.m('quayWallW', { pattern: 'stone', size: 512, tile: 3, colors: [0x4d5652, 0x39423e, 0x121816, 0x6c766f], params: { scale: 5, gap: 0.05, round: 0.2, variation: 0.5, mortarDark: 0.8, strata: 0.3, lichen: 0.5 }, mossColor: 0x2a5a30, bump: 18, rough: [0.6, 0.95], layers: { moss: 0.6, grime: 0.7, wet: 0.5, streak: 0.5 } }, { wet: true });
    M.tile = B.m('tileW', { pattern: 'tiles', size: 512, tile: 2, colors: [0xc8d2d0, 0xa6b4b2, 0x3a4644], params: { n: 8, grout: 0.006, checker: 0, bevel: 0.003, wear: 0.4, gloss: 0.8, crackle: 0.15 }, bump: 1.5, rough: [0.12, 0.4], layers: { grime: 0.5, wet: 0.7, cracks: 0.2 } }, { wet: true }); withLampRefl(M.tile, { gain: 0.9, maxRough: 0.6, patchy: 0.5 });
    M.brick = B.m('brickW', { pattern: 'bricks', size: 1024, tile: 2, colors: [0x9a5c46, 0x804a38, 0x4c3c34], params: { rows: 26, cols: 8, mortar: 0.006, variation: 0.7, chips: 0.4, moss: 0.25, soot: 0.5 }, mossColor: 0x35583a, bump: 5, rough: [0.7, 0.95], layers: { grime: 0.6, streak: 0.7, moss: 0.2 } }, { breakup: 0.6, wet: true });
    M.paintTeal = B.m('paintTeal', { pattern: 'planks', size: 512, tile: 2, colors: [0x2d8a86, 0x1f6664, 0x0b2a2a], params: { rows: 9, gap: 0.006, grain: 6, knots: 0.1, cols: 1, vertical: 1, weather: 0.5, nails: 0 }, bump: 3, rough: [0.45, 0.85], layers: { grime: 0.5, streak: 0.6 } }, { wet: true });
    M.paintCoral = B.m('paintCoral', { pattern: 'planks', size: 256, tile: 2, colors: [0xb0503c, 0x8a3a2a, 0x2a1008], params: { rows: 9, gap: 0.006, grain: 6, knots: 0.1, cols: 1, vertical: 1, weather: 0.6, nails: 0 }, bump: 3, rough: [0.45, 0.85], layers: { grime: 0.5, streak: 0.6 } }, { wet: true });
    M.paintCream = B.m('paintCream', { pattern: 'planks', size: 256, tile: 2, colors: [0xc8c0a0, 0xa89f80, 0x40382a], params: { rows: 9, gap: 0.006, grain: 6, knots: 0.1, cols: 1, vertical: 1, weather: 0.6, nails: 0 }, bump: 3, rough: [0.5, 0.85], layers: { grime: 0.5, streak: 0.6 } }, { wet: true });
    M.paintNavy = B.m('paintNavy', { pattern: 'planks', size: 256, tile: 2, colors: [0x27436a, 0x1a2f4c, 0x080e18], params: { rows: 9, gap: 0.006, grain: 6, knots: 0.1, cols: 1, vertical: 1, weather: 0.6, nails: 0 }, bump: 3, rough: [0.45, 0.85], layers: { grime: 0.5, streak: 0.6 } }, { wet: true });
    M.roofBlue = B.m('roofBlue', { pattern: 'corrugated', size: 256, tile: 2, colors: [0x3a5060, 0x2a3a46], rustColor: 0x52301a, params: { ribs: 12, depth: 1, vertical: 0, dents: 1 }, bump: 18, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.45, streak: 0.8, grime: 0.6, moss: 0.2 } }, { wet: true });
    M.roofRust = B.m('roofRust', { pattern: 'corrugated', size: 512, tile: 2, colors: [0x5a4634, 0x3c2e22], rustColor: 0x6a3418, params: { ribs: 12, depth: 1, vertical: 0, dents: 1.2 }, bump: 22, metal: 0.45, rough: [0.45, 0.8], layers: { rust: 0.7, streak: 0.8, grime: 0.6 } }, { wet: true });
    M.iron = B.m('ironW', { pattern: 'plates', size: 256, tile: 2, colors: [0x22382f, 0x182a23, 0x0b1410], rustColor: 0x5a3018, params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.4, panelVar: 0.4 }, bump: 2, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.35, grime: 0.6, edge: 0.4, scratch: 0.3, streak: 0.6 } }, { wet: true });
    M.rust = B.m('rustW', { pattern: 'plates', size: 256, tile: 2, colors: [0x5b3421, 0x452617, 0x1a0e08], rustColor: 0x6a3418, params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.3, panelVar: 0.5 }, bump: 3, metal: 0.45, rough: [0.5, 0.85], layers: { rust: 0.8, grime: 0.6, streak: 0.5, edge: 0.3 } });
    M.steel = B.m('steelW', std({ color: 0xaab2b4, roughness: 0.3, metalness: 1 })); M.black = B.m('blackW', std({ color: 0x0c0d0e, roughness: 0.55, metalness: 0.5 }));
    M.marble = B.m('marbleW', { pattern: 'terrazzo', size: 256, tile: 1, colors: [0xdcdcd6, 0x9aa0a0, 0xb8bcb8, 0x6a6e6e], params: { scale: 3, chips: 0.2, chipSize: 0.25 }, bump: 0.5, rough: [0.1, 0.3], layers: { wet: 0.5, grime: 0.3 } }, { wet: true }); withLampRefl(M.marble, { gain: 1, maxRough: 0.5, patchy: 0.4 });
    M.ice = B.m('iceW', std({ color: 0xbfe4f0, roughness: 0.25, metalness: 0 }));
    M.crateBlue = B.m('crateBlue', std({ color: 0x1f5ea8, roughness: 0.5 })); M.crateWhite = B.m('crateWhite', std({ color: 0xd8dcd6, roughness: 0.5 })); M.crateOrange = B.m('crateOrange', std({ color: 0xd8681c, roughness: 0.5 })); M.crateRed = B.m('crateRed', std({ color: 0xa8282a, roughness: 0.5 }));
    M.bulb = B.m('bulbW', std({ color: 0x000000, emissive: 0xffcf8a, emissiveIntensity: 5 })); M.lit = B.m('litW', std({ color: 0x000000, emissive: 0xffd9a0, emissiveIntensity: 1.5, roughness: 0.4 })); M.litCool = B.m('litCoolW', std({ color: 0x000000, emissive: 0xcfeeff, emissiveIntensity: 1.6, roughness: 0.4 })); M.litCoolDim = B.m('litCoolDimW', std({ color: 0x000000, emissive: 0xcfeeff, emissiveIntensity: 0.55, roughness: 0.4 })); M.tube = B.m('tubeW', std({ color: 0x000000, emissive: 0xdff4ff, emissiveIntensity: 3.5 }));
    M.litDim = B.m('litDimW', std({ color: 0x000000, emissive: 0xffc880, emissiveIntensity: 0.75, roughness: 0.4 })); M.dark = B.m('darkGlassW', std({ color: 0x05090a, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.5 })); M.reveal = B.m('revealW', std({ color: 0x040606, roughness: 1 })); M.frame = B.m('frameW', std({ color: 0x1c2a26, roughness: 0.6, metalness: 0.3 }));
    M.stone = B.m('graniteW', { pattern: 'noise', size: 256, tile: 2, colors: [0x7c827e, 0x5e645f, 0x262a28, 0x9aa09a], params: { scale: 6, contrast: 2, fine: 64, speckle: 0.05, pores: 0.2 }, bump: 3, rough: [0.6, 0.9], layers: { grime: 0.6, moss: 0.3, wet: 0.4 } }, { wet: true });
    M.pile = B.m('pileW', { pattern: 'wood', size: 512, tile: 1.2, colors: [0x30261c, 0x120d08], params: { scale: 14, rings: 9, knots: 0.5, weather: 0.5, vertical: 0 }, bump: 6, rough: [0.7, 0.95], layers: { moss: 0.7, grime: 0.6, streak: 0.4 }, mossColor: 0x2c5a30 }, { wet: true });
    M.rope = B.m('ropeW', { pattern: 'weave', size: 256, tile: 0.25, colors: [0x8a7a58, 0x5a4e36], params: { threads: 24, twill: 1, variation: 0.6, fuzz: 0.5 }, bump: 2, rough: [0.85, 1], layers: { grime: 0.5 } });
    M.tyre = B.m('tyreW', { pattern: 'rubber', size: 256, tile: 0.5, colors: [0x141414, 0x1e1e1e], params: { scale: 8, tread: 0.6 }, bump: 1.5, rough: [0.8, 0.95], layers: { grime: 0.4, dust: 0.3 } });
    M.timber = B.m('timberW', { pattern: 'planks', size: 512, tile: 2, colors: [0x7a6a4c, 0x5a4a34, 0x201a10], params: { rows: 10, gap: 0.005, grain: 8, knots: 0.3, cols: 1, vertical: 0, weather: 0.9, nails: 1 }, bump: 4, rough: [0.7, 0.95], layers: { grime: 0.5, streak: 0.5 } }, { wet: true });
    M.net = B.m('netW', (() => { const tex = canvasTextureNet(); return std({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 }); })());
    M.trawlHull = B.m('trawlHull', { pattern: 'plates', size: 512, tile: 3, colors: [0x9a3a28, 0x7c2c20, 0x341410], rustColor: 0x7a3a18, params: { cols: 3, rows: 2, seam: 0.008, rivets: 10, brushed: 0.2, panelVar: 0.15 }, bump: 3, metal: 0.25, rough: [0.5, 0.85], layers: { rust: 0.22, grime: 0.4, streak: 0.55, edge: 0.3, moss: 0.1 } }, { wet: true });
    M.trawlBottom = B.m('trawlBottom', { pattern: 'plates', size: 256, tile: 3, colors: [0x4c3028, 0x3a241c, 0x1a0e0a], mossColor: 0x2e5a34, params: { cols: 3, rows: 2, seam: 0.008, rivets: 4, brushed: 0.2, panelVar: 0.6 }, bump: 3, metal: 0.2, rough: [0.6, 0.9], layers: { moss: 0.6, rust: 0.3, grime: 0.5 } }, { wet: true });
    M.trawlDeck = B.m('trawlDeck', { pattern: 'planks', size: 256, tile: 2, colors: [0x5a4a34, 0x3a2e1f, 0x120c07], params: { rows: 8, gap: 0.006, grain: 6, knots: 0.3, cols: 1, vertical: 1, weather: 0.8, nails: 1 }, bump: 4, rough: [0.7, 0.95], layers: { grime: 0.7, wet: 0.4 } }, { wet: true });
    M.trawlCabin = B.m('trawlCabin', { pattern: 'plates', size: 256, tile: 2, colors: [0xcfcab8, 0xb0ab98, 0x5a5648], rustColor: 0x6a3a1c, params: { cols: 3, rows: 2, seam: 0.006, rivets: 4, brushed: 0.2, panelVar: 0.3 }, bump: 2, metal: 0.4, rough: [0.45, 0.85], layers: { rust: 0.3, grime: 0.7, streak: 0.9 } }, { wet: true });
    M.trawlTrim = B.m('trawlTrim', std({ color: 0x24303a, roughness: 0.5, metalness: 0.7 })); M.nameBoard = B.m('trawlName', nameMat('FV MARGUERITE  ·  PL 218', '#e8e2c8', '#1a2630', fitTex));
    const puddle = puddleMaterial(B, 'puddleW', 0x04090a, 0x0e3038); const stripeA = stripeMat('#2e9a94', '#e8e4d0', 'awnA'), stripeB = stripeMat('#b8423a', '#e8e4d0', 'awnB'), stripeC = stripeMat('#2f5aa0', '#e8e4d0', 'awnC'), stripeD = stripeMat('#d8a838', '#e8e4d0', 'awnD');
    const bld = { wall: M.brick, roof: M.roofBlue, trim: M.stone, lit: M.lit, dark: M.dark, reveal: M.reveal, frame: M.frame, stone: M.stone, iron: M.iron }; const BL = makeBuilding(K, bld);
    // ------------------------------------------------------------------ ground: wharf body + cobbles + quay wall + coping + fender posts + ladders + foam
    const XE = 62, ZH = 140;
    B.box({ p: [(QX + XE) / 2, -3.2, 0], s: [XE - QX, DY + 3.2 - 0.02, ZH * 2], mat: M.wall, col: 'concrete' }); B.plane({ p: [(QX + XE) / 2, DY + 0.003, 0], s: [XE - QX, ZH * 2], mat: M.cobble, cast: false });
    B.colliders.groundY = -3; B.colliders.waterY = 0; B.colliders.groundSurface = 'gravel';
    // real cobble setts around the landing (x -100..-87, z -7..10): ~5k instanced, half-buried, jittered stones (size / yaw / tint) over the textured plane, which supplies the dark joints
    { const sg = new THREE.SphereGeometry(1, 6, 3), stoneM = B.m('cobbleStone', std({ color: 0xffffff, roughness: 0.34, wet: true, refl: 1 })), tints = [0x5a5d5f, 0x4e514f, 0x66665f, 0x42474a, 0x6e695f, 0x545e5c], q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(); let row = 0;
      for (let gz = -7; gz < 10; gz += 0.2, row++) for (let gx = -100; gx < -87; gx += 0.2) { const x = gx + (row % 2) * 0.1 + (rng() - 0.5) * 0.06, z = gz + (rng() - 0.5) * 0.06; B.instance('setts', sg, stoneM, new THREE.Matrix4().compose(v.set(x, DY + 0.006, z), q.setFromEuler(e.set((rng() - 0.5) * 0.12, rng() * 6.28, (rng() - 0.5) * 0.12)), sc.set(0.078 + rng() * 0.028, 0.026 + rng() * 0.02, 0.078 + rng() * 0.028)), tints[(rng() * tints.length) | 0], { cast: false }); } }
    const ladderZ = [-84, -68, -52, -38, -27, 27, 38, 52, 62]; const inRec = (z) => ladderZ.some((l) => Math.abs(z - l) < 1.0);
    B.box({ p: [QX + 0.3, DY - 0.16, 0], s: [0.85, 0.26, ZH * 2], mat: M.stone, bevel: 0.03, cast: true });
    for (let z = -ZH; z <= ZH; z += 6) { if (inRec(z)) continue; K.pile(QX - 0.4, -3.2, DY + 0.35, z, 0.2, M.pile); K.pileFoam(QX - 0.4, z, 0.2, 0.7); }
    for (const z of [-124, -100, -76, -46, -14, 14, 46, 76, 100, 124]) { K.bollard(QX + 1.2, DY, z, M.iron); }
    for (const a of [17, 7.2, -7.2, -17]) K.bollard(QX + 1.1, DY, -a, M.iron, { h: 0.6, r: 0.19 });
    for (const z of [-60, -22, 22, 60]) K.tyre(QX - 0.25, 0.5, z, M.tyre, { axis: 'x', r: 0.4, t: 0.15 });
    for (const z of ladderZ) K.ladder([QX, z], [-1, 0], DY, M.iron);
    K.quayFoam([QX - 0.05, -ZH], [QX - 0.05, ZH], 1.6, 0.8, 2); { const pts = []; for (let z = -ZH; z <= ZH; z += 3) pts.push([QX - 0.05, z]); K.foamStrips[K.foamStrips.length - 1].side = -1; }
    { let a = -ZH; for (const lz of ladderZ.concat([ZH + 1])) { const b = lz - 1.3; if (b - a > 0.3) K.wallCol([QX + 0.25, a], [QX + 0.25, b], DY, DY + 1.3, 0.3, 'concrete'); a = lz + 1.3; } }
    K.wallCol([QX + 0.25, ZH], [XE - 0.5, ZH], DY, DY + 2, 0.4); K.wallCol([QX + 0.25, -ZH], [XE - 0.5, -ZH], DY, DY + 2, 0.4);
    // boundary of the play area (invisible walls): north/south ends of the wharf and east side (village hillside)
    K.wallCol([QX, -92], [58, -92], DY, DY + 3, 0.4); K.wallCol([QX, 104], [58, 104], DY, DY + 3, 0.4); K.wallCol([58, -92], [58, 104], DY, DY + 3, 0.4);

    // ------------------------------------------------------------------ MARKET HALL (yellow-brick, sawtooth roof, arched openings on the west face, enterable)
    const HX0 = -56, HX1 = -12, HZ0 = -20, HZ1 = 40, HH = 9.6, T = 0.6;
    const arches = [-4, 10, 24]; const AW = 4.6, AH = 5.6;
    // west face: wall segments between openings, lintel above
    { let z = HZ0; for (const az of arches.concat([HZ1 + AW])) { const a = az - AW / 2; if (a - z > 0.2) B.box({ p: [HX0 + T / 2, DY, (z + Math.min(a, HZ1)) / 2], s: [T, HH, Math.min(a, HZ1) - z], mat: M.brick, bevel: 0.03, col: 'brick', walk: false, cast: true }); z = az + AW / 2; }
      for (const az of arches) { B.box({ p: [HX0 + T / 2, DY + AH, az], s: [T, HH - AH, AW], mat: M.brick, bevel: 0.03, col: 'brick', walk: false, cast: true }); B.box({ p: [HX0 - 0.1, DY + AH - 0.2, az], s: [0.28, 0.4, AW + 0.9], mat: M.stone, bevel: 0.02, cast: false }); for (const sd of [-1, 1]) B.box({ p: [HX0 - 0.08, DY, az + sd * (AW / 2 + 0.25)], s: [0.24, AH, 0.5], mat: M.stone, bevel: 0.02, cast: false });
        const pts = []; for (let i = 0; i <= 12; i++) { const a = P * i / 12; pts.push([HX0 - 0.12, DY + AH - 0.05 + Math.sin(a) * 0.9 * 0, az + Math.cos(a) * (AW / 2 + 0.25)]); } } }
    B.box({ p: [(HX0 + HX1) / 2, DY, HZ0 + T / 2], s: [HX1 - HX0, HH, T], mat: M.brick, bevel: 0.03, col: 'brick', walk: false, cast: true }); B.box({ p: [(HX0 + HX1) / 2, DY, HZ1 - T / 2], s: [HX1 - HX0, HH, T], mat: M.brick, bevel: 0.03, col: 'brick', walk: false, cast: true }); B.box({ p: [HX1 - T / 2, DY, (HZ0 + HZ1) / 2], s: [T, HH, HZ1 - HZ0], mat: M.brick, bevel: 0.03, col: 'brick', walk: false, cast: true });
    // floor tiles inside, iron columns, roof: sawtooth with lit glazing
    B.plane({ p: [(HX0 + HX1) / 2, DY + 0.006, (HZ0 + HZ1) / 2], s: [HX1 - HX0 - 2 * T, HZ1 - HZ0 - 2 * T], mat: M.tile, cast: false });
    for (let x = HX0 + 8; x < HX1 - 4; x += 12) for (let z = HZ0 + 10; z < HZ1 - 6; z += 14) { B.cyl({ p: [x, DY, z], r: 0.2, h: HH, seg: 8, mat: M.iron, col: 'metal', cast: true }); }
    for (let k = 0; k < 6; k++) { const z0 = HZ0 + k * 10; K.extrudeXY([[0, 0], [0, 2.6], [10, 0]], -HX1, -HX0, M.roofBlue, { rotY: -P / 2, cx: 0, cz: z0, y: DY + HH }); B.box({ p: [(HX0 + HX1) / 2, DY + HH + 0.02, z0 + 0.03], s: [HX1 - HX0 - 1, 2.4, 0.05], mat: M.litCoolDim, bevel: 0, cast: false }); }
    B.box({ p: [(HX0 + HX1) / 2, DY + HH - 0.15, (HZ0 + HZ1) / 2], s: [HX1 - HX0, 0.3, HZ1 - HZ0], mat: M.iron, bevel: 0, cast: false, col: false });
    // interior: counters with fish, hanging scales, fluorescent tubes, tiles walls, drains
    const fish = fishGeoLite(B), fishMat = fishMatLite(B); const fishCols = [0xb8c4c8, 0x8ea0aa, 0xd8a0a0, 0x6a8aa0, 0xc86a3a, 0x9aa8a0, 0xe0d8c0]; let fishN = 0;
    const putFish = (x, y, z, n, w, d) => { for (let i = 0; i < n; i++) { if (fishN++ > 380) return; instG(B, 'fishL', fish, fishMat, B.matrix([x + (rng() - 0.5) * w, y, z + (rng() - 0.5) * d], rng() * P * 2, 0.8 + rng() * 0.6, 0, (rng() - 0.5) * 0.6), fishCols[(rng() * fishCols.length) | 0]); } };
    for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) { const cz = HZ0 + 6 + i * 8.5, cx = HX0 + 12 + row * 14; const w = 2.4, d = 6; B.box({ p: [cx, DY, cz], s: [w, 0.9, d], mat: M.tile, bevel: 0.02, col: 'tile', walk: false }); B.box({ p: [cx, DY + 0.9, cz], s: [w + 0.12, 0.07, d + 0.12], mat: M.marble, bevel: 0.01, cast: false }); B.box({ p: [cx, DY + 0.97, cz], s: [w - 0.3, 0.09, d - 0.4], mat: M.ice, bevel: 0.03, cast: false }); putFish(cx, DY + 1.06, cz, 28, w - 0.7, d - 0.8);
      for (const zz of [-2.2, 0, 2.2]) { B.cyl({ p: [cx, DY + 2.7, cz + zz], r: 0.012, h: 0.9, seg: 4, mat: M.steel, cast: false }); B.cyl({ p: [cx, DY + 2.68, cz + zz], r: 0.13, h: 0.03, seg: 10, mat: M.steel, pitch: P / 2, anchor: 'center', cast: false }); }
      B.box({ p: [cx, DY + 3.9, cz], s: [0.1, 0.06, 5.2], mat: M.tube, bevel: 0, cast: false }); K.glare([cx, DY + 3.85, cz - 2], 0xdff4ff, 0.3, 0.7, { refl: 1.2, mist: 0.7 }); K.glare([cx, DY + 3.85, cz + 2], 0xdff4ff, 0.3, 0.7, { refl: 1.2, mist: 0.7 }); }
    for (const [x, z] of [[HX0 + 12, HZ0 + 14], [HX0 + 26, HZ0 + 40]]) K.lamp([x, DY + 3.7, z], { color: 0xdff4ff, cd: 18, dist: 16, size: 0.3, k: 0, refl: 1.2, mist: 0 });
    for (let z = HZ0 + 2; z < HZ1 - 2; z += 4) { B.box({ p: [HX1 - T - 0.02, DY, z + 1], s: [0.04, 2.2, 3.8], mat: M.tile, bevel: 0, cast: false }); }
    facadeReal(K, { wall: M.brick, stone: M.stone, iron: M.iron, reveal: M.reveal }, { axis: 'z', x0: HZ0, x1: HZ1, z: HX0, y0: DY, h: HH - 1.3, dir: -1, bay: 14, a0: -11, courses: [AH + 0.6] });
    // facade: neon FRESH FISH + secondary neons; gable-like parapet with sign board
    B.box({ p: [HX0 - 0.35, DY + HH - 0.2, (HZ0 + HZ1) / 2], s: [0.5, 1.4, HZ1 - HZ0 + 0.6], mat: M.stone, bevel: 0.03, cast: true });
    const NZ = 10; B.box({ p: [HX0 - 0.55, DY + HH + 0.5, NZ], s: [0.4, 4.6, 17], mat: M.frame, bevel: 0.03, cast: false });
    K.neon(['FRESH FISH'], [HX0 - 0.8, DY + HH + 2.8, NZ], [0.14, 3.9, 16], { colors: ['#ff2fa0'], glow: 5.2, w: 1024, face: 'x', frame: '#22e6ff' });
    K.neon(['OYSTERS  ·  CRAB  ·  ICE'], [HX0 - 0.7, DY + HH - 0.1, NZ], [0.1, 0.9, 15], { colors: ['#40ff7a'], glow: 4.5, w: 1024, face: 'x' });
    K.glare([HX0 - 1.4, DY + HH + 2.8, NZ], 0xff2fa0, 1.6, 0.4, { refl: 1.3, mist: 1.1 }); K.glare([HX0 - 1.4, DY + HH + 0.4, NZ], 0x40ff7a, 0.9, 0.35, { refl: 0.9, mist: 0.9 });
    K.lamp([HX0 - 3, DY + HH + 1.5, NZ - 5], { color: 0xff2fa0, cd: 15, dist: 22, size: 0.1, k: 0, refl: 0.7, mist: 0 }); K.lamp([HX0 - 3, DY + HH + 1.5, NZ + 5], { color: 0x22e6ff, cd: 14, dist: 22, size: 0.1, k: 0, refl: 0.7, mist: 0 });
    for (const az of arches) for (let i = 0; i < 9; i++) { const zz = az - AW / 2 + i * (AW / 8); K.glare([HX0 - 0.2, DY + AH + 0.1, zz], 0xffcf8a, 0.14, 0.8, { refl: 0, mist: 0.5 }); }
    K.neon(['HALL No.1'], [HX0 - 0.3, DY + 6.4, 33.5], [0.08, 0.7, 3.4], { colors: ['#22e6ff'], glow: 4.0, w: 512, face: 'x' }); K.neon(['ICE'], [HX0 - 0.3, DY + 6.4, -12], [0.08, 0.8, 1.9], { colors: ['#5ab4ff'], glow: 4.0, w: 256, face: 'x' });
    // hall windows on the side walls (cool lit), roof drains
    BL.windowGrid('n', HX0 + 4, HX1 - 4, HZ0 - 0.02, DY + 3.5, 1, 7, 1.3, 2.0, 0, { litP: 0.7, litMats: [M.litCool, M.lit] });

    // ------------------------------------------------------------------ STALLS on the open wharf (two rows), neon icons, ice crates, nets
    const pals = [{ wood: M.paintTeal, roof: M.roofBlue, awn: stripeA, neon: '#ff2fa0' }, { wood: M.paintCoral, roof: M.roofRust, awn: stripeB, neon: '#22e6ff' }, { wood: M.paintCream, roof: M.roofBlue, awn: stripeC, neon: '#40ff7a' }, { wood: M.paintNavy, roof: M.roofRust, awn: stripeD, neon: '#ff7a2f' }];
    const signs = [['CRAB'], ['OYSTERS'], ['COD'], ['EELS'], ['LOBSTER'], ['SMOKED'], ['ICE'], ['HERRING'], ['PRAWNS'], ['MUSSELS'], ['SQUID'], ['TROUT'], ['SPRATS'], ['WHELKS']];
    const stallSpots = [[-86, -76, 'e'], [-86, -66, 'e'], [-86, -56, 'e'], [-86, -46, 'e'], [-86, 40, 'e'], [-86, 50, 'e'], [-86, 60, 'e'], [-72, -66, 'w'], [-72, -54, 'w'], [-72, 50, 'w'], [-86, -34, 'e'], [-86, -23, 'e'], [-86, 22, 'e'], [-86, 31, 'e'], [-71, -34, 'w'], [-71, -23, 'w'], [-71, 22, 'w'], [-71, 31, 'w']];
    stallSpots.forEach(([x, z, face], i) => { const st = stall(K, M, { x, z, w: 5, d: 3.4, face, y: DY, pal: pals[i % 4], sign: { lines: signs[i % signs.length] }, light: i % 2 === 0 }); stallDress(K, M, st, { face, rng, i }); });
    // strings of bulbs between poles across the wharf
    const poles = [[-92, -70], [-80, -70], [-92, -48], [-80, -48], [-92, 44], [-80, 44], [-92, 66], [-80, 66], [-92, -38], [-79, -38], [-92, -18], [-79, -18], [-92, 18], [-79, 18], [-92, 38], [-79, 38]]; for (const [x, z] of poles) B.cyl({ p: [x, DY, z], r: 0.06, h: 4.4, seg: 6, mat: M.timber, cast: true, col: false });
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [8, 9], [10, 11], [12, 13], [14, 15], [8, 10], [9, 11], [12, 14], [13, 15]]) { const A = poles[a], C = poles[b]; B.cable([A[0], DY + 4.3, A[1]], [C[0], DY + 4.3, C[1]], 0.5, 0.008, M.black, { n: 10, cast: false }); const n = Math.round(Math.hypot(C[0] - A[0], C[1] - A[1]) / 1.4); for (let i = 1; i < n; i++) { const t = i / n; const p = [A[0] + (C[0] - A[0]) * t, DY + 4.3 - 4 * 0.5 * t * (1 - t) - 0.08, A[1] + (C[1] - A[1]) * t]; K.glare(p, [0xffc880, 0xff8a6a, 0x9aeaff, 0xffe08a][i % 4], 0.13, 0.9, { refl: 0.5, mist: 0.6 }); } }
    // ------------------------------------------------------------------ boiling shed (steam) + ice house + drying racks + crab pots + gutting tables + carts
    const BS = { x0: -84, x1: -72, z0: 72, z1: 84 }; B.box({ p: [(BS.x0 + BS.x1) / 2, DY, (BS.z0 + BS.z1) / 2], s: [BS.x1 - BS.x0, 5.2, BS.z1 - BS.z0], mat: M.brick, bevel: 0.04, col: 'brick', walk: false, cast: true }); BL.gableRoof(BS.x0, BS.z0, BS.x1, BS.z1, DY + 5.2, 2.2, 'z', 0.4, M.roofRust, M.brick);
    B.cyl({ p: [BS.x1 - 2, DY + 5.2, BS.z0 + 3], r: [0.55, 0.45], h: 6.2, seg: 10, mat: M.brick, col: 'brick', cast: true }); B.cyl({ p: [BS.x1 - 2, DY + 11.3, BS.z0 + 3], r: 0.6, h: 0.25, seg: 10, mat: M.iron, cast: false });
    BL.windowGrid('w', BS.z0 + 2, BS.z1 - 2, BS.x0 - 0.02, DY + 1.8, 1, 3, 1.2, 1.4, 0, { litP: 1, litMats: [M.lit] }); B.box({ p: [BS.x0 - 0.06, DY, (BS.z0 + BS.z1) / 2], s: [0.1, 2.5, 2.4], mat: M.reveal, bevel: 0, cast: false }); K.glare([BS.x0 - 0.5, DY + 1.4, (BS.z0 + BS.z1) / 2], 0xff9a5a, 1.2, 0.7, { refl: 2.5, mist: 1.5 });
    const IH = { x0: -30, x1: -12, z0: -62, z1: -46 }; B.box({ p: [(IH.x0 + IH.x1) / 2, DY, (IH.z0 + IH.z1) / 2], s: [IH.x1 - IH.x0, 8.6, IH.z1 - IH.z0], mat: M.tile, bevel: 0.04, col: 'tile', walk: false, cast: true }); BL.gableRoof(IH.x0, IH.z0, IH.x1, IH.z1, DY + 8.6, 2.6, 'x', 0.4, M.roofBlue, M.tile);
    K.neon(['ICE HOUSE'], [(IH.x0 + IH.x1) / 2, DY + 5.6, IH.z1 + 0.1], [8, 1.6, 0.06], { colors: ['#5ab4ff'], glow: 4.5, w: 1024 }); K.glare([(IH.x0 + IH.x1) / 2, DY + 5.6, IH.z1 + 1.2], 0x5ab4ff, 2.0, 0.4, { refl: 4, mist: 1.6 }); K.lamp([(IH.x0 + IH.x1) / 2, DY + 4.5, IH.z1 + 2.2], { color: 0x5ab4ff, cd: 30, dist: 22, size: 0.1, k: 0, refl: 3, mist: 0 });
    BL.windowGrid('s', IH.x0 + 2, IH.x1 - 2, IH.z1 + 0.02, DY + 1.4, 1, 3, 1.2, 1.6, 0, { litP: 0.8, litMats: [M.litCool] }); B.box({ p: [(IH.x0 + IH.x1) / 2 + 3, DY, IH.z1 + 0.08], s: [2.4, 2.8, 0.12], mat: M.steel, bevel: 0.02, cast: false });
    // elevated fire-escape gallery on the east face of the ice house (3.15 m) with a stair down to the market lane
    platform(K, { x0: IH.x1, z0: IH.z0 + 2, x1: IH.x1 + 1.8, z1: IH.z1 - 2, y: DY + 3.15, base: DY, mat: M.timber, frame: M.steel, surface: 'wood', legs: 'e', rails: 'en', stairs: [{ side: 's', at: IH.x1 + 0.9, w: 1.3 }], lamps: [[IH.x1 + 0.9, DY + 5.6, IH.z0 + 4.5, { color: 0x9ae8ff, cd: 18, dist: 14, size: 0.4, refl: 2, light: true }]] });
    // drying racks with nets and hanging fish
    for (let k = 0; k < 3; k++) { const rx = -95 + k * 3.2, rz = -86 + k * 0.3; for (const sz of [-1, 1]) { B.beam([rx, DY, rz + sz * 2.2], [rx, DY + 3.0, rz + sz * 2.2], 0.12, 0.12, { mat: M.timber, bevel: 0, cast: true }); } B.beam([rx, DY + 3.0, rz - 2.2], [rx, DY + 3.0, rz + 2.2], 0.1, 0.1, { mat: M.timber, bevel: 0, cast: true }); B.box({ p: [rx, DY + 0.6, rz], s: [0.03, 2.4, 4.3], mat: M.net, bevel: 0, cast: false }); for (let f = 0; f < 6; f++) B.instance('fishL', fish, fishMat, B.matrix([rx + 0.1, DY + 2.7 - (f % 2) * 0.5, rz - 2 + f * 0.75], P / 2, 0.9, 0, 1.5), fishCols[f % fishCols.length], { cast: false }); }
    for (const [x, z] of [[-70, 4], [-66, 8], [-70, 10], [-40, -66], [-38, 60]]) { B.box({ p: [x, DY, z], s: [0.9, 0.7, 0.9], mat: M.net, bevel: 0.05, col: 'metal', walk: false, cast: true }); B.box({ p: [x, DY + 0.7, z], s: [0.9, 0.05, 0.9], mat: M.iron, bevel: 0, cast: false }); }
    for (const [x, z] of [[-92, 20], [-88, 30]]) { B.box({ p: [x, DY, z], s: [2.2, 0.9, 0.9], mat: M.steel, bevel: 0.03, col: 'metal', walk: false }); putFish(x, DY + 0.98, z, 8, 1.8, 0.5); }
    // painted quay markings (readable from the ferry) + dressing clusters flanking the landing lane
    K.decal('BERTH 2', [-98.4, DY + 0.016, 1.5], [3.6, 1.0], { fg: '#d8e0d8', from: [-1, 0], w: 512 }); K.decal('KEEP CLEAR', [-98.4, DY + 0.016, 14], [4.2, 0.9], { fg: '#e0c030', from: [-1, 0], w: 512 }); K.decal('FISH ONLY', [-90, DY + 0.016, -8], [4.4, 1.0], { fg: '#c8d8d8', from: [-1, 0], w: 512 });
    for (const zc of [-13, 17]) { const c = [-90.5, zc]; for (let k = 0; k < 5; k++) K.crate(c[0] + (k % 3) * 0.62, DY + Math.floor(k / 3) * 0.36, c[1] + (k % 2) * 0.5, 0.58, 0.34, 0.44, [M.crateBlue, M.crateWhite, M.crateOrange][k % 3], { yaw: (k % 2) * 0.2, slats: false }); K.barrel(c[0] - 1.4, DY, c[1] + 0.4, M.rust); K.barrel(c[0] - 1.9, DY, c[1] - 0.3, M.iron); K.coil(c[0] + 1.6, DY, c[1] + 1.1, M.rope, { r: 0.42 }); B.box({ p: [c[0] + 0.8, DY, c[1] - 1.6], s: [1.5, 0.75, 0.8], mat: M.steel, bevel: 0.03, col: 'metal', walk: false }); B.box({ p: [c[0] + 0.8, DY + 0.76, c[1] - 1.6], s: [1.3, 0.06, 0.62], mat: M.ice, bevel: 0.02, cast: false }); putFish(c[0] + 0.8, DY + 0.86, c[1] - 1.6, 9, 1.1, 0.4); }
    // ------------------------------------------------------------------ DRESSING: delivery vans, forklift + pallets of fish boxes, ice bins, lobster pots, nets, hand carts, boat on trailer, extra stalls (cover along the market lanes)
    { const PR = makeProps(K, { wood: M.timber, iron: M.iron, rust: M.rust, steel: M.steel, rope: M.rope, conc: M.stone, tyre: M.tyre, glass: M.dark, lit: M.lit, net: M.net }, DY); const Q = P / 2;
      const wpaint = (n, c) => B.m(n, { pattern: 'plates', size: 256, tile: 2, colors: [c, c, 0x101010], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2, panelVar: 0.1 }, bump: 1, metal: 0.06, rough: [0.26, 0.5], layers: { grime: 0.6, rust: 0.15, scratch: 0.4, streak: 0.7, edge: 0.3 } }, { wet: true });
      const trkW = { paint: wpaint('vanTeal', 0x2c7a76), paint2: wpaint('vanCream', 0xd4d0bc), paint3: wpaint('vanRed', 0x9a2a22), chrome: B.m('chromeW', std({ color: 0xd0d4d6, roughness: 0.16, metalness: 1 })), black: M.black, glass: M.dark, tyre: M.tyre, wood: M.timber, lampOn: B.m('lampOnW', std({ color: 0x000000, emissive: 0xffe2a8, emissiveIntensity: 6 })), lampRed: B.m('lampRedW', std({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 5 })), steel: M.steel };
      truck(K, trkW, { x: -66, z: -76, yaw: Q, y: DY, kind: 'van', on: false }); truck(K, { ...trkW, paint: trkW.paint3, paint2: trkW.paint2 }, { x: -62.5, z: 68, yaw: -Q, y: DY, kind: 'flat', load: [[-1.6, -0.3, 1.2, 0.8, 0.9]] });
      // landing strip flanks (keep z -5..8 clear): ice bins, pot stacks along the quay, nets, carts
      PR.iceBin(-91.6, -12.4, 0); PR.iceBin(-91.6, -11.0, 0, { blue: true }); PR.iceBin(-91.3, 14.6, 0); PR.iceBin(-91.6, 16.0, 0, { blue: true }); PR.handcart(-94, -24, Q); PR.handcart(-95.5, 30, Q + 0.2);
      for (const z of [-63, -52, -41, -29, 26, 40, 58]) PR.pots(-99.2, z, Q, { n: 6, net: M.net });
      PR.netHeap(-96.5, -34); PR.netHeap(-97, 46, { r: 1.1 }); PR.netHeap(-97.6, -83);
      // mid strip between the stalls and the hall: forklift with pallets of fish boxes, ice bins, a boat on a trailer, tanks and drum racks
      PR.forklift(-64, -36, Q, { lift: 0.5, beacon: true }); PR.pallet(-64, -32.4, Q, { load: 'boxes', n: 3 }); PR.pallet(-62.5, -30.4, Q, { load: 'boxes', n: 2 }); PR.pallet(-64.2, -29, Q, { load: 'boxes', n: 3 });
      PR.tank(-66.5, -8.5, Q, { r: 0.8, len: 3.2, mat: M.paintTeal }); PR.drumRack(-62, 8, Q); PR.drumRack(-62, 26, Q); PR.iceBin(-63.5, 46, Q); PR.iceBin(-63.5, 47.4, Q, { blue: true });
      PR.trailer(-66, 18.5, Q, { len: 4.6 }); { const dinghy = makeBoat(ctx, { L: 5.4, HB: 1.0, free: 0.5, draft: 0.34, bow: 0.85, stern: 0.7, bulwark: 0.32, sheer: 0.3, seed: 12, mats: { top: M.paintCoral, bottom: M.paintNavy, deck: M.timber, cabin: M.paintCream, trim: M.iron, dark: M.dark, lit: M.litDim } }); dinghy.group.position.set(-66, DY + 1.05, 18.5); dinghy.group.rotation.set(0, Q, 0); B.group.add(dinghy.group); }
      // extra stalls flanking the hall lane
      for (const [x, z, f, i] of [[-64, -14, 'e', 1], [-64, 4, 'e', 3], [-64, 44, 'e', 0], [-64, 56, 'e', 2]]) { const st = stall(K, M, { x, z, w: 5, d: 3.4, face: f, y: DY, pal: pals[i % 4], sign: { lines: signs[(i + 5) % signs.length] }, light: i % 2 === 0 }); stallDress(K, M, st, { face: f, rng, i }); }
      // north yard (z -100..-88): pallets, reels, tarps, more pots ; south yard (z 88..100): net drying frames already; add sacks + pallets
      PR.pallet(-76, -95, 0, { load: 'crates', n: 3 }); PR.pallet(-74.4, -95, 0, { load: 'crates', n: 2 }); PR.pallet(-70, -92, Q, { load: 'boxes', n: 3 }); PR.reel(-80, -94, 0); PR.sacks(-60, -90, 0, { rows: 4, cols: 3 }); PR.forklift(-72, -98, 0, { lift: 0, beacon: false });
      PR.pallet(-52, 92, 0, { load: 'boxes', n: 3 }); PR.pallet(-50.4, 92, 0, { load: 'boxes', n: 2 }); PR.sacks(-58, 96, Q, { rows: 3, cols: 3 }); PR.handcart(-66, 92, 0.5); PR.reel(-46, 96, 0);
      for (const [x, z, yw] of [[-82, -16, 0], [-79, 15, Q], [-77.5, -28, 0], [-78, 34, Q], [-82, 40, 0]]) { PR.pallet(x, z, yw, { load: 'boxes', n: 3 }); PR.pallet(x + 1.8, z + 0.4, yw, { load: 'crates', n: 2 }); K.barrel(x - 1.2, DY, z + 0.3, M.rust); }
    }
    // scattered crates/barrels/carts, fish boxes and ice on the wharf; puddles; coils
    const keep = [[-97, 2, 9], [-86, -66, 8], [-86, 50, 10], [-106.8, 86, 14]]; const scatter = (n, area, fn) => { let t = 0; while (n > 0 && t++ < n * 40) { const x = area[0] + rng() * (area[2] - area[0]), z = area[1] + rng() * (area[3] - area[1]); if (keep.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue; fn(x, z); n--; } };
    scatter(34, [-100, -88, -58, 100], (x, z) => { const k = rng(); if (k < 0.5) K.crate(x, DY, z, 0.55, 0.32 + rng() * 0.3, 0.42, [M.crateBlue, M.crateWhite, M.crateOrange, M.crateRed][(rng() * 4) | 0], { yaw: (rng() < 0.5 ? 0 : P / 2), slats: false }); else if (k < 0.75) K.barrel(x, DY, z, rng() < 0.5 ? M.rust : M.iron); else if (k < 0.9) K.coil(x, DY, z, M.rope, { r: 0.4 }); else K.crate(x, DY, z, 1.1, 1.0, 0.9, M.timber, { batten: M.iron }); });
    for (let i = 0; i < 36; i++) { const x = -100 + rng() * 44, z = -88 + rng() * 188; if (Math.hypot(x + 97, z - 2) < 6) continue; const s = 0.9 + rng() * 2.4; K.puddle(puddle, x, DY + 0.006, z, s * 0.8, s * 0.55, rng() * P); }
    K.puddle(puddle, -97, DY + 0.007, 1.5, 2.4, 1.5, 0.3);
    // lamps (cool mercury, green-white) along the quay + on the hall
    { const glowC = B.m('lampGlowW', std({ color: 0x000000, emissive: 0xcff8ff, emissiveIntensity: 9 })), glowW = B.m('lampGlowWW', std({ color: 0x000000, emissive: 0xffc078, emissiveIntensity: 9 }));
      const lp = [[-99, -78], [-99, -58], [-99, -38], [-99, -18], [-99, 20], [-99, 40], [-99, 60], [-99, 80], [-64, -74], [-64, -44], [-64, -14], [-64, 46], [-64, 76], [-40, -70], [-40, 70], [-20, -76], [4, 20]];
      lp.forEach(([x, z], i) => { const warm = i % 3 === 1; const h = K.lampPost(x, z, DY, { h: 5.6, mat: M.iron, glowMat: warm ? glowW : glowC, dir: x < -60 ? [1, 0] : [0, 1] }); K.lamp(h, { color: warm ? 0xffb266 : 0xbff4e8, cd: warm ? 22 : 26, dist: 24, size: 0.55, refl: 3.0, flick: 0.02, spill: true }); }); }
    // hall facade: warm wall lamps between the arches wash the brick (readable landmark + colour contrast to the neon)
    for (const z of [-12, 3, 17, 31, 38]) { B.cyl({ p: [HX0 - 0.7, DY + 5.0, z], r: [0.16, 0.05], h: 0.3, seg: 8, mat: M.iron, cast: false }); K.lamp([HX0 - 0.75, DY + 5.15, z], { color: 0xffb870, cd: 12, dist: 14, size: 0.3, refl: 1.6, wall: [-1, 0], wallR: 3.4, wallK: 0.16 }); }
    // ------------------------------------------------------------------ the trawler alongside (rocking on the swell), tied with lines; gangplank
    const tw = trawler(ctx, K, M, QX - 3.3 - 0.5, 86); B.group.add(tw.group); const trawlerOrigin = ctx.origin; K.lamps.push(...tw.lamps);
    for (const dz of [-9, -3, 3, 9]) { const zz = 86 + dz; K.bollard(QX + 1.2, DY, zz, M.iron); B.tube({ pts: [[QX + 1.2, DY + 0.4, zz], [QX - 1.6, DY + 0.9, zz + dz * 0.15], [QX - 3.6, DY + 0.8, zz + dz * 0.1]], r: 0.05, mat: M.rope, seg: 5, segs: 10, cast: false }); }
    B.box({ p: [QX - 1.1, DY + 0.05, 78], s: [2.6, 0.06, 0.9], mat: M.timber, bevel: 0.01, cast: false });
    K.lamp([QX + 0.5, DY + 5.5, 86], { color: 0xdff8ff, cd: 24, dist: 24, size: 0.4, refl: 3, k: 0, mist: 0 }); K.lamp([QX - 2, 6.8, 80], { color: 0xdff8ff, cd: 20, dist: 16, size: 0.1, k: 0, refl: 2, mist: 0, light: false });
    // village on the hillside east of the hall (lit windows), church spire, and far towers => skyline distinct from the pier
    const houseTex = B.m('houseWin', std({ color: 0x000000, emissive: 0xffb45a, emissiveIntensity: 1.3 }));
    for (let i = 0; i < 26; i++) { const x = 30 + i * 6 + rng() * 6, z = -90 + rng() * 190, s = 5 + rng() * 5, h = 5 + rng() * 5, y = 0.6 * (x - 25) / 6 + DY; B.box({ p: [x, y - 6, z], s: [s, h + 6, s * 1.2], mat: M.brick, bevel: 0.05, col: false, cast: false }); BL.gableRoof(x - s / 2, z - s * 0.6, x + s / 2, z + s * 0.6, y + h, 2.2, 'z', 0.3, M.roofRust, M.brick); if (rng() < 0.65) B.box({ p: [x - s / 2 - 0.03, y + h * 0.4, z], s: [0.06, 1.1, 1.0], mat: houseTex, bevel: 0, cast: false }); }
    B.box({ p: [46, DY + 6, -70], s: [6, 30, 6], mat: M.brick, bevel: 0.05, cast: false }); B.prism({ p: [46, DY + 36, -70], s: [6.4, 9, 6.4], mat: M.roofBlue }); B.box({ p: [46, DY + 28, -66.95], s: [1.2, 3, 0.05], mat: M.litCool, bevel: 0, cast: false });
    // ------------------------------------------------------------------ weather + gulls
    ctx.weather({ count: 3000, box: [38, 24, 38], fall: 9, wind: null, size: 0.026, turb: 0.15, streak: 14, color: [0.55, 0.68, 0.76], alpha: 0.3, cell: 13, seed: 12 });
    const gulls = makeGulls(B, 14, { cx: -75, cz: 0, rx: 70, rz: 90, perched: 7, rng, spots: [[QX + 1.2, DY + 0.66, -76], [QX + 1.2, DY + 0.66, 100], [-84, DY + 3.2, 10], [-40, DY + 9.9, 42], [-70, DY + 3.3, 46], [-98, DY + 4.5, 66], [-56, DY + 9.7, 12]] });
    decalAtlas(K, [
      { x: -103, z: -14, w: 22, d: 22, kind: 'cobble', y: DY + 0.036, rust: [[-102, -7.2], [-102, 7.2]], rustDir: 0, paths: [[[-97, 1.5], [-88, -8], [-86, -22]], [[-97, 1.5], [-80, 4], [-62, 10]]], litter: 1.5 },
      { x: -103, z: 8, w: 22, d: 22, kind: 'cobble', y: DY + 0.036, paths: [[[-97, 1.5], [-90, 14], [-86, 24]]], litter: 1.5 },
      { x: -82, z: -14, w: 22, d: 22, kind: 'cobble', y: DY + 0.012, litter: 1.4 },
      { x: -82, z: 8, w: 22, d: 22, kind: 'cobble', y: DY + 0.012, litter: 1.4 }], { seed: 12 });
    K.finishFoam();
    // ------------------------------------------------------------------ gameplay data
    const spawns = [...K.spawns]; for (const z of [-84, -40, 30, 70]) spawns.push({ kind: 'walk', pos: [56, DY, z], yaw: -P / 2, note: 'village lane' }); spawns.push({ kind: 'walk', pos: [HX1 - 1, DY, 12], yaw: -P / 2, note: 'hall back door' });
    const steam = { t: 0 }, drip = { t: 0 };
    const data = {
      atmo: ATMO[IDX], reflect: { level: DY }, envPatches: ENV[IDX], playerStart: { pos: [-96.5, DY, 1.5], yaw: -P / 2 }, station: { pos: ST.stationLocal, yaw: ST.yaw }, groundY: -3, waterY: 0, waterHeight: (wx, wz) => sea.height(wx, wz), groundSurface: 'gravel',
      navBounds: [-102, -90, 58, 102], navBlocked: (x, z, gy) => gy < 0.6, navCell: 0.6, landmark: { pos: [HX0 - 1, DY + 12, 10], name: 'Market hall & neon FRESH FISH sign' }, mooring: [17, 7.2, -7.2, -17].map((a) => ST.toLocal(a, BEAM_HALF + FENDER + 1.1)),
      spawns, buys: { walls: [{ pos: [HX0 - 0.35, DY + 1.6, 17], yaw: -P / 2, gun: 'm14' }, { pos: [(IH.x0 + IH.x1) / 2 - 5, DY + 1.6, IH.z1 + 0.12], yaw: 0, gun: 'olympia' }], perks: [{ pos: [HX1 - 1.4, DY, 24], yaw: -P / 2, perk: 'speedcola' }], box: { pos: [-64, DY, 26], yaw: -P / 2 } },
      zombieVariants: [{ id: 'ferry_fishmonger', weight: 3, minRound: 1 }, { id: 'ferry_drowned', weight: 2, minRound: 1 }, { id: 'ferry_dockworker', weight: 1, minRound: 2 }, { id: 'ferry_sailor', weight: 1, minRound: 3 }],
      ambient: { space: 'open', gain: 1, beds: [{ type: 'water', gain: 0.55, lap: 0.8 }, { type: 'wind', gain: 0.2, gust: 0.25 }, { type: 'hum', freq: 120, gain: 0.06 }, { type: 'machine', gain: 0.12 }], events: [{ type: 'gull', every: [4, 11], gain: 0.7, pos: 'around' }, { type: 'foghorn', every: [30, 60], gain: 0.7, pos: 'far' }, { type: 'bell', every: [6, 14], gain: 0.4, pos: 'far' }, { type: 'clank', every: [7, 16], gain: 0.55 }, { type: 'radio', every: [25, 50], gain: 0.25, pos: [-84, 3, 44] }, { type: 'creak', every: [5, 12], gain: 0.5 }, { type: 'bubble', every: [6, 14], gain: 0.4 }] },
      update(dt, t, active) { sea.tick(t, gfx.camera.position, gfx); tw.update(t, ctx.origin.x, ctx.origin.z); gulls.update(t); if (!active) return; const o = ctx.origin; steam.t += dt; if (steam.t > 0.07) { steam.t = 0; fx.puff({ x: o.x - 74, y: DY + 4.2, z: o.z + 74 }, { x: 0, y: 1, z: 0 }, 1, { speed: 0.9, size: [0.5, 2.6], life: 4, color: [0.32, 0.4, 0.42, 0.28], rise: 1.6, drag: 0.6, spread: 0.4, cell: 1 }); fx.puff({ x: o.x - 22, y: DY + 11.5, z: o.z + 63 }, { x: 0, y: 1, z: 0 }, 1, { speed: 0.6, size: [0.4, 2.0], life: 4, color: [0.3, 0.36, 0.38, 0.2], rise: 1.4, drag: 0.6, spread: 0.3, cell: 1 }); } drip.t += dt; if (drip.t > 0.25) { drip.t = 0; for (const [x, z] of [[-86, -66], [-86, 50]]) fx.alpha.emit({ p: [o.x + x + 1.4 + rand() * 3, o.y + DY + 2.5, o.z + z + (rand() - 0.5) * 4], v: [0, -0.5, 0], life: 0.7, size: [0.025, 0.02], c0: [0.4, 0.5, 0.55, 0.6], c1: [0.4, 0.5, 0.55, 0.3], gravity: 1, cell: 7, drag: 0.1 }, fx.time); } },
    };
    for (const w of data.buys.walls) K.wallLamp(w.pos[0], w.pos[1], w.pos[2], Math.sin(w.yaw), Math.cos(w.yaw), { color: 0xffc888, mat: M.iron });
    return data;
  },
};

function canvasTextureNet() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.strokeStyle = 'rgba(140,120,84,1)'; g.lineWidth = 3; for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 128, 128); g.stroke(); g.beginPath(); g.moveTo(i * 32 + 128, 0); g.lineTo(i * 32, 128); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.5, 1 / 0.5); t.anisotropy = 4; return t;
}
function nameMat(text, fg, bg, fit) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 1024, 128); g.fillStyle = fg; g.font = '700 70px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; fit(t, 4.2, 0.5); return std({ map: t, roughness: 0.6 });
}
