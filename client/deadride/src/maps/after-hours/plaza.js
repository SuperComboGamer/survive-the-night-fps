// AFTER HOURS — Stop 1: ENTRANCE PLAZA ("Main Square", cream / red / teal Americana, warm tungsten bulbs, half of them dead).
// Landmark: the huge neon arch over the entrance gate, the clock tower and the monorail station canopy. Sun mascot fountain in the middle.
// Local coords: origin = fountain centre, +x east, +z south. The gate is at z = +46, the station (platform 5.4 m) at z = -38 north of the square.
import * as THREE from 'three';
import { HaloBatch, makeBeam } from '../../core/glow.js';
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { rand, makeRng } from '../../core/util.js';
import { glowMat, bulbMat, neonText, neonPanel, extrudeXY, quad, torus, pipe, pipes, festoon, litter, scatter, geo, balloonGeo, stationFrame, coarseBatches, hedgeWall, awningMesh, TAU, PI, arc } from './common.js';
import { buildStationBase } from './station.js';
import { grimeAtlas, grimeFace, grimeFlush } from './grime.js';
import { shopSkin, bayInterior, doorReal, upperWindow } from './plaza-bays.js';
import { facadeDetail, lampPost, benchReal, fountainReal, clockTowerReal, streetKit, siding, statueReal, pierReal } from './plaza-real.js';
import { STATION_LOCAL, STATION_YAW } from './track.js';
import { stripeMat } from './bake.js';
import { decalAtlas, placeDecals, PAINT } from './detail.js';

export default {
  id: 'plaza', name: 'Entrance Plaza', origin: [0, 0, 163], viewRadius: 180,
  async build(ctx) {
    const { B, fx } = ctx; const R = makeRng(101); const RC = () => R(); coarseBatches(B, 240, 32, [100, 10, 60]);
    const M = (name, pattern, colors, params, o = {}, extra) => B.m(name, { pattern, size: o.size || 512, tile: o.tile || 2, colors, params, bump: o.bump ?? 3, rough: o.rough || [0.6, 0.9], metal: o.metal || 0, layers: o.layers || {}, rustColor: o.rustColor, mossColor: o.mossColor, seed: o.seed || 0, ao: o.ao, emissive: o.emissive }, extra);
    // ------------------------------------------------------------ materials (night-tuned albedos)
    const pave = M('pave', 'tiles', [0xa89e88, 0x82503c, 0x241f1b, 0x968c76], { n: 8, grout: 0.012, checker: 1, bevel: 0.006, wear: 0.5, gloss: 0.5, crackle: 0.3 }, { size: 2048, tile: 3.2, bump: 6, rough: [0.4, 0.85], layers: { grime: 0.45, wet: 0.3, oil: 0.15 } }, { breakup: 0.5, wet: true, refl: 0.6 });
    const ring = M('ring', 'tiles', [0x4b6360, 0x7a4038, 0x1c1a18, 0xa89f8c], { n: 4, grout: 0.016, checker: 1, bevel: 0.01, wear: 0.7, gloss: 0.6, crackle: 0.5 }, { size: 1024, tile: 4, bump: 7, rough: [0.3, 0.75], layers: { grime: 0.55, wet: 0.35, dust: 0.25, cracks: 0.3 } }, { wet: true, breakup: 0.5, refl: 0.6 });
    const asphalt = M('asphalt', 'asphalt', [0x323234, 0x242427, 0xd8d0b8, 0x55555a], { scale: 6, aggregate: 0.5, cracks: 0.5, lines: 0 }, { size: 1024, tile: 4, bump: 10, rough: [0.22, 0.75], layers: { wet: 0.55, oil: 0.4, grime: 0.3 } }, { wet: true, breakup: 0.5, refl: 0.6 });
    const concrete = M('concrete', 'noise', [0x8b8880, 0x74726b, 0x3e3c38, 0xa09d94], { scale: 5, contrast: 3, fine: 96, speckle: 0.04, pores: 0.5, panels: 3, panelWidth: 0.004 }, { size: 512, tile: 3, rough: [0.8, 0.97], layers: { grime: 0.5, cracks: 0.4, streak: 0.5 } }, { breakup: 0.6 });
    const plCream = M('plCream', 'noise', [0xcdc4aa, 0xbdb395, 0x948d74, 0xdbd3ba], { scale: 6, contrast: 2, fine: 88, speckle: 0.015, pores: 0.25 }, { tile: 3, bump: 2.5, rough: [0.8, 0.97], layers: { grime: 0.35, streak: 0.45, dust: 0.15 } }, { breakup: 0.5 });
    const plTeal = M('plTeal', 'noise', [0x66807a, 0x5a736d, 0x3c504b, 0x7e978f], { scale: 6, contrast: 2, fine: 88, speckle: 0.015, pores: 0.2 }, { tile: 3, bump: 2.5, rough: [0.75, 0.95], layers: { grime: 0.35, streak: 0.5 } }, { breakup: 0.5 });
    const plRose = M('plRose', 'noise', [0x94564c, 0x84493f, 0x55302a, 0xa96e62], { scale: 6, contrast: 2, fine: 88, speckle: 0.015, pores: 0.2 }, { tile: 3, bump: 2.5, rough: [0.75, 0.95], layers: { grime: 0.4, streak: 0.5 } }, { breakup: 0.5 });
    const plButter = M('plButter', 'noise', [0xbfa878, 0xae9666, 0x7d6a45, 0xd0bc90], { scale: 6, contrast: 2, fine: 88, speckle: 0.015, pores: 0.2 }, { tile: 3, bump: 2.5, rough: [0.75, 0.95], layers: { grime: 0.35, streak: 0.45 } }, { breakup: 0.5 });
    const brick = M('brick', 'bricks', [0x8f4a38, 0x6f3a2c, 0xa39b88], { rows: 20, cols: 8, mortar: 0.008, variation: 0.6, chips: 0.5, moss: 0, soot: 0.5 }, { size: 1024, tile: 2, bump: 5, rough: [0.8, 0.98], layers: { grime: 0.45, streak: 0.4 } }, { breakup: 0.6 });
    const trim = M('trim', 'planks', [0xeee7d6, 0xd9d1bd, 0x8a826f], { rows: 4, gap: 0.004, grain: 3, knots: 0, cols: 1, vertical: 1, weather: 0.3, nails: 0 }, { tile: 2, bump: 2, rough: [0.35, 0.7], layers: { grime: 0.25, edge: 0.2 } });
    const metalTeal = M('metalTeal', 'plates', [0x486f6a, 0x3f625d, 0x1f3532], { cols: 2, rows: 2, seam: 0.008, rivets: 8, brushed: 0.15, panelVar: 0.3 }, { tile: 2, bump: 2.5, metal: 0.3, rough: [0.28, 0.6], layers: { grime: 0.3, edge: 0.4, scratch: 0.25 } });
    const metalRed = M('metalRed', 'plates', [0x8c3a34, 0x7c322d, 0x421d1a], { cols: 2, rows: 2, seam: 0.008, rivets: 8, brushed: 0.15, panelVar: 0.3 }, { tile: 2, bump: 2.5, metal: 0.3, rough: [0.28, 0.6], layers: { grime: 0.3, edge: 0.4, scratch: 0.25 } });
    const iron = M('iron', 'plates', [0x22282a, 0x1a1f21, 0x0c0f10], { cols: 1, rows: 1, seam: 0.0, rivets: 0, brushed: 0.5 }, { tile: 1, bump: 1.5, metal: 0.85, rough: [0.4, 0.7], layers: { rust: 0.15, grime: 0.4, edge: 0.3 }, rustColor: 0x5a3320 });
    const wood = M('wood', 'planks', [0x8a5a34, 0x6a4326, 0x2a1a0e], { rows: 6, gap: 0.006, grain: 6, knots: 0.2, cols: 2, weather: 0.5, nails: 1 }, { tile: 1.5, bump: 3, rough: [0.55, 0.9], layers: { grime: 0.3 } });
    const roofT = M('roofT', 'scales', [0x3a5f5a, 0x2f504b, 0x1a2f2c], { rows: 18, cols: 14, round: 0.5, variation: 0.5 }, { tile: 2, bump: 6, rough: [0.4, 0.75], layers: { grime: 0.4, streak: 0.3 } });
    const roofR = M('roofR', 'scales', [0x7a3630, 0x652c27, 0x35171a], { rows: 18, cols: 14, round: 0.5, variation: 0.5 }, { tile: 2, bump: 6, rough: [0.4, 0.75], layers: { grime: 0.4 } });
    const awnRed = stripeMat(B, 'awnRed', { c0: 0x8e3630, c1: 0xd8cdb4, n: 6, tile: 1.5, side: THREE.DoubleSide });
    const awnTeal = stripeMat(B, 'awnTeal', { c0: 0x3f6a63, c1: 0xd8cdb4, n: 6, tile: 1.5, side: THREE.DoubleSide });
    const gold = std({ color: 0xc9a23c, roughness: 0.32, metalness: 1 });
    const chrome = std({ color: 0xd8dde0, roughness: 0.14, metalness: 1 });
    const fibre = std({ color: 0xf0a92a, roughness: 0.18, metalness: 0.0 }); const fibreR = std({ color: 0xc83228, roughness: 0.22 }); const fibreW = std({ color: 0xece8e0, roughness: 0.2 }); const fibreT = std({ color: 0x2a9d95, roughness: 0.22 });
    const dark = std({ color: 0x0b0c0e, roughness: 0.15, metalness: 0.2 });
    const winLit = glowMat(0xffc880, 3.2, { flicker: 0.05, cell: 3, dead: 0.0, seed: 3, rough: 0.5 }); const winLit2 = glowMat(0xffb060, 2.2, { flicker: 0.02, cell: 3, seed: 8, rough: 0.5 });
    const winPink = glowMat(0xff7ab8, 2.4, { flicker: 0.04, cell: 3, seed: 5 });
    const bulbW = bulbMat(0xffc070, 12, { speed: 1.2, dir: [1, 0], freq: 0.7, dead: 0.14, base: 0.35 }); const bulbS = bulbMat(0xffb060, 9, { steady: true, dead: 0.18, base: 1 });
    const neonPink = glowMat(0xff3c96, 10, { flicker: 0.05, cell: 3.0, dead: 0.0, seed: 2 }); const neonCyan = glowMat(0x40e8ff, 9, { flicker: 0.02, cell: 6, seed: 7 }); const neonAmber = glowMat(0xffa030, 9, { flicker: 0.03, cell: 4, seed: 4 });
    const lampOn = glowMat(0xffd090, 11, { flicker: 0.02, cell: 1, seed: 1 }); const lampOff = std({ color: 0x1a1a18, roughness: 0.2, metalness: 0.3 });
    const waterM = std({ color: 0x06141a, roughness: 0.03, metalness: 0.0 });
    const uwater = glowMat(0x30d8e0, 7, { flicker: 0.02, cell: 5, seed: 9 });
    const cloth = M('cloth', 'weave', [0xd8cfc0, 0xc7bcab], { threads: 40, twill: 0, variation: 0.4, fuzz: 0.3 }, { tile: 0.6, bump: 2, rough: [0.8, 1] });
    const rubberM = std({ color: 0x141414, roughness: 0.9 }); const paperM = std({ color: 0xe8e2d0, roughness: 0.8 }); const plasticM = std({ color: 0xffffff, roughness: 0.25 }); const balloonM = std({ color: 0xffffff, roughness: 0.22, metalness: 0, envMapIntensity: 1.4 });
    const topiary = M('topiary', 'noise', [0x356a30, 0x458a3e, 0x1c3a1a, 0x6cae58], { scale: 9, contrast: 3, fine: 120, speckle: 0.1 }, { tile: 1, bump: 8, rough: [0.85, 1] }, { breakup: 0.3 });
    const halos = new HaloBatch(420); B.group.add(halos.mesh);
    const yawFace = (a, b) => Math.atan2(-(b[1] - a[1]), b[0] - a[0]);

    // ------------------------------------------------------------ ground: paving, fountain ring, street, curbs
    B.plane({ p: [0, 0, 6], s: [76, 92], mat: pave, cast: false, col: 'tile' });                               // the square (x -38..38, z -40..52)
    B.plane({ p: [0, 0.012, 0], s: [26, 26], mat: ring, cast: false });                                       // fountain inlay
    B.plane({ p: [0, 0, 82], s: [140, 60], mat: asphalt, cast: false, col: 'concrete' });                     // street outside the gate
    for (const [x, z, w, d] of [[0, 112.5, 141, 1], [70.5, 82, 1, 60], [-70.5, 82, 1, 60]]) B.box({ p: [x, -0.95, z], s: [w, 0.95, d], mat: concrete, bevel: 0.03, cast: false });
    for (const [x, z, w, d] of [[0, -40.2, 77, 0.8], [-38.3, 6, 0.8, 92], [38.3, 6, 0.8, 92], [0, 52.4, 77, 0.8]]) B.box({ p: [x, -0.95, z], s: [w, 1.07, d], mat: concrete, bevel: 0.05, cast: false });   // curbs down to the lawn
    // lane markings outside the gate
    for (let x = -60; x < 60; x += 6) B.box({ p: [x, 0.008, 84], s: [3, 0.01, 0.16], mat: B.m('paint', std({ color: 0xd8d0a8, roughness: 0.5 })), cast: false, bevel: 0 });
    B.colliders.groundY = 0;

    // ------------------------------------------------------------ STATION (platform at z = -38, heading east) + canopy
    const S = buildStationBase(ctx, 0, { deck: pave, col: concrete, stair: concrete, rail: chrome, edge: B.m('edgeY', std({ color: 0xd8b020, roughness: 0.5 })), warn: B.m('warn', std({ color: 0x8a7a30, roughness: 0.6 })) });
    // barrel-vault canopy (profile in the station x_s / y plane, extruded along the platform)
    { const top = [], bot = []; for (let i = 0; i <= 14; i++) { const t = i / 14, x = 0.5 + t * 6.9; top.push([x, 4.9 + 1.5 * Math.sin(PI * t)]); bot.push([x, 4.55 + 1.3 * Math.sin(PI * t)]); }
      extrudeXY(B, { p: S.P(0, 0, 0), yaw: S.yaw, pts: [...top, ...bot.reverse()], depth: 29.6, mat: roofT, cast: true });
      // painted plaster soffit + arched ribs under the vault (the teal roof-tile pattern read as flat neon green from below under the warm platform lights)
      const cv = (dy) => Array.from({ length: 15 }, (_, i) => { const t = i / 14; return [0.5 + t * 6.9, 4.55 + 1.3 * Math.sin(PI * t) + dy]; });
      extrudeXY(B, { p: S.P(0, 0, 0), yaw: S.yaw, pts: [...cv(-0.005), ...cv(-0.045).reverse()], depth: 29.3, mat: plCream, cast: false });
      for (let z = -14.4; z <= 14.5; z += 3.6) extrudeXY(B, { p: S.P(0, 0, z), yaw: S.yaw, pts: [...cv(-0.045), ...cv(-0.2).reverse()], depth: 0.22, mat: trim, cast: false }); }
    for (const z of [-14.5, -7.25, 0, 7.25, 14.5]) {                                                            // striped columns + arches
      for (const [x, m] of [[6.9, metalRed]]) B.cyl({ p: S.P(x, 0, z), r: 0.17, h: 4.55, seg: 12, mat: m, col: 'metal' });
      B.cyl({ p: S.P(6.9, 0, z), r: 0.26, h: 0.3, seg: 12, mat: gold, cast: false }); B.cyl({ p: S.P(6.9, 4.3, z), r: 0.24, h: 0.28, seg: 12, mat: gold, cast: false });
    }
    B.box({ p: S.P(7.05, 3.9, 0), s: [0.14, 0.62, 30], yaw: S.yaw, mat: awnRed, bevel: 0.01, cast: false });      // scalloped valance strip
    B.box({ p: S.P(7.05, 4.55, 0), s: [0.3, 0.16, 30], yaw: S.yaw, mat: trim, bevel: 0.02, cast: false });
    for (let z = -14.6; z <= 14.6; z += 0.55) { const q = S.P(7.16, 3.86, z); B.instance('bulbS', geo('bulb.05', () => new THREE.SphereGeometry(0.05, 7, 5)), bulbW, B.matrix(q), (Math.floor(RC() * 255) << 16) | 0x808080, { cast: false }); }
    for (let z = -14.6; z <= 14.6; z += 3.3) halos.add(S.P(7.2, 3.86, z), 0xffc070, 0.3, 0.6, 0);
    // "MONORAIL" neon blade sign on the canopy crown (faces the square)
    { const sm = neonPanel(1024, 256, (c, e, w, h) => { c.fillStyle = '#10222a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#d9c27a'; c.lineWidth = 10; c.strokeRect(12, 12, w - 24, h - 24); neonText(e, 'Monorail', w / 2, h / 2 + 6, 170, '#40e8ff', { core: '#e8ffff', tube: 0.055 }); neonText(c, 'Monorail', w / 2, h / 2 + 6, 170, '#1a4a54', { core: '#1a4a54', tube: 0.03 }); }, { intensity: 9 });
      extrudeXY(B, { p: S.P(4.0, 6.75, 0), yaw: S.yaw + PI / 2, pts: [[-3.6, -0.9], [3.6, -0.9], [3.6, 0.9], [-3.6, 0.9]], depth: 0.2, mat: sm, uv: 'bbox', cast: false }); pipe(B, S.P(4.0, 5.9, -2.8), S.P(4.0, 6.0, -2.8), 0.05, iron); B.box({ p: S.P(4.0, 5.9, 0), s: [0.2, 1.0, 6.8], yaw: S.yaw, mat: iron, cast: false }); }
    // benches, poster boards, PA horns and a dead departure board on the platform
    for (const z of [-9, 9]) { B.box({ p: S.P(5.5, 0, z), s: [0.55, 0.06, 2.2], yaw: S.yaw, mat: wood, bevel: 0.01, col: 'wood' }); B.box({ p: S.P(5.7, 0.45, z), s: [0.1, 0.5, 2.2], yaw: S.yaw, mat: wood, bevel: 0.01 }); for (const dz of [-0.9, 0.9]) B.box({ p: S.P(5.5, 0, z + dz), s: [0.5, 0.42, 0.06], yaw: S.yaw, mat: iron, bevel: 0.01, cast: false }); }
    B.box({ p: S.P(6.4, 1.5, 3.2), s: [0.08, 1.0, 1.6], yaw: S.yaw, mat: neonPanel(256, 128, (c, e, w, h) => { c.fillStyle = '#0a0c10'; c.fillRect(0, 0, w, h); neonText(e, 'DELAYED', w / 2, h * 0.38, 46, '#ff5030', { core: '#ffd0c0', tube: 0.08, style: '700' }); neonText(e, '- - : - -', w / 2, h * 0.72, 40, '#ff8040', { core: '#ffe0c0', tube: 0.08, style: '700' }); }, { intensity: 4 }), col: false, cast: false });
    const stLightA = ctx.light({ pos: S.P(4, 3.6, -8), color: 0xffb466, intensity: 34, distance: 20, decay: 2, flicker: 0.05 }), stLightB = ctx.light({ pos: S.P(4, 3.6, 8), color: 0xffb466, intensity: 34, distance: 20, decay: 2, flicker: 0.12, flickerSpeed: 14 });
    ctx.plazaStation = S;

    // ------------------------------------------------------------ MAIN STREET: shops on both sides (front planes at x = +-21)
    const memo = (fn) => { const m = new Map(); return (...a) => { const k = a.join('|'); let v = m.get(k); if (!v) { v = fn(...a); m.set(k, v); } return v; }; };   // identical sign / poster / curtain requests share ONE material (fewer draws)
    const _signMat = (label, bg, fg, fs = 62) => neonPanel(512, 128, (c, e, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.strokeStyle = '#d9c27a'; c.lineWidth = 5; c.strokeRect(6, 6, w - 12, h - 12); neonText(e, label, w / 2, h / 2 + 4, fs, fg, { core: '#ffffff', tube: 0.07 }); neonText(c, label, w / 2, h / 2 + 4, fs, '#3a3630', { core: '#3a3630', tube: 0.04 }); }, { intensity: 6.5 });
    const signMat = memo(_signMat);
    const _bladeMat = (l1, l2, col, bg) => neonPanel(128, 256, (c, e, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.strokeStyle = col; c.lineWidth = 5; c.strokeRect(5, 5, w - 10, h - 10); neonText(e, l1, w / 2, h * 0.36, 40, col, { core: '#ffffff', tube: 0.08, style: '700' }); neonText(e, l2, w / 2, h * 0.64, 40, col, { core: '#ffffff', tube: 0.08, style: '700' }); }, { intensity: 8 });
    const bladeMat = memo(_bladeMat);
    const grimeA = grimeAtlas('grimeP', { dirt: 'rgba(40,32,26,A)', damp: 'rgba(28,30,28,A)', rust: 'rgba(150,72,30,A)', salt: 'rgba(225,222,205,A)', moss: 'rgba(60,84,44,A)', paint: 'rgba(214,206,188,A)', crack: 'rgba(8,8,10,0.8)' }, 11), gRng = makeRng(555);
    const shops = [];
    // ---- shop window displays (canvas, emissive): lit shops glow warm, dead ones only show dusty silhouettes
    const _displayMat = (kind, lit, seed) => { const r = makeRng(seed), HUE = { gifts: 350, souv: 28, candy: 335, ice: 190, arcade: 235, costume: 285, diner: 160 }[kind] ?? 30;   // interior back wall of a display bay: wallpaper over a panelled dado, framed pictures, warm light falling from the ceiling strip (NO painted merchandise: that is real geometry now)
      return neonPanel(1024, 256, (c, e, w, h) => {
        c.fillStyle = `hsl(${HUE},20%,17%)`; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) { c.fillStyle = `hsla(${HUE},24%,27%,0.6)`; c.fillRect(x, 0, 14, h * 0.7); }
        c.fillStyle = `hsl(${HUE},18%,11%)`; c.fillRect(0, h * 0.7, w, h * 0.3); for (let x = 16; x < w; x += 96) { c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 3; c.strokeRect(x, h * 0.74, 78, h * 0.2); c.strokeStyle = `hsla(${HUE},22%,30%,0.55)`; c.lineWidth = 1.5; c.strokeRect(x + 4, h * 0.755, 70, h * 0.17); }
        c.fillStyle = `hsl(${HUE},22%,30%)`; c.fillRect(0, h * 0.69, w, 6); c.fillRect(0, 0, w, 10);
        e.fillStyle = '#000'; e.fillRect(0, 0, w, h); const wash = e.createLinearGradient(0, 0, 0, h); wash.addColorStop(0, `hsla(${HUE},42%,66%,${lit ? 0.7 : 0.1})`); wash.addColorStop(0.5, `hsla(${HUE},34%,44%,${lit ? 0.36 : 0.05})`); wash.addColorStop(1, `hsla(${HUE},28%,24%,${lit ? 0.14 : 0.02})`); e.fillStyle = wash; e.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 32) { e.fillStyle = 'rgba(0,0,0,0.35)'; e.fillRect(x + 14, 0, 18, h * 0.7); } e.fillStyle = 'rgba(0,0,0,0.5)'; e.fillRect(0, h * 0.7, w, h * 0.3);
        for (let i = 0; i < 6; i++) { const x = 60 + i * 165 + r() * 40, y = h * (0.12 + r() * 0.14), pw = 60 + r() * 40, ph = 50 + r() * 30, hh = Math.floor(r() * 360), l = 30 + r() * 18; c.fillStyle = '#b89a58'; c.fillRect(x - 4, y - 4, pw + 8, ph + 8); c.fillStyle = `hsl(${hh},30%,${l}%)`; c.fillRect(x, y, pw, ph); e.fillStyle = `hsla(${hh},30%,${l}%,${lit ? 0.5 : 0.08})`; e.fillRect(x, y, pw, ph); }
      }, { intensity: lit ? 2.4 : 0.7, flicker: lit ? 0.02 : 0, cell: 3, dead: 0, seed: seed }); };
    const displayMat = memo(_displayMat);
    const _valanceMat = (c1, c2) => std({ map: canvasTexture(512, 64, (c, w, h) => { c.clearRect(0, 0, w, h); const n = 20; for (let i = 0; i < n; i++) { const x0 = i * w / n, x1 = (i + 1) * w / n; c.fillStyle = i % 2 ? c2 : c1; c.beginPath(); c.moveTo(x0, 0); c.lineTo(x1, 0); c.lineTo(x1, h * 0.55); c.arc((x0 + x1) / 2, h * 0.55, (x1 - x0) / 2, 0, PI); c.lineTo(x0, h * 0.55); c.fill(); } c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, h * 0.45, w, 3); }, { repeat: true }), alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });   // 12 scallops = 5.04 m per tile, repeated along the run: ONE material per colour pair
    const valanceMat = memo(_valanceMat);
    const _curtainMat = (hue) => neonPanel(64, 128, (c, e, w, h) => { c.fillStyle = '#0a0a0e'; c.fillRect(0, 0, w, h); e.fillStyle = '#000'; e.fillRect(0, 0, w, h); for (let i = 0; i < 8; i++) { const gr = e.createLinearGradient(i * 8, 0, i * 8 + 8, 0); gr.addColorStop(0, `hsla(${hue},60%,45%,0.9)`); gr.addColorStop(0.5, `hsla(${hue},70%,72%,1)`); gr.addColorStop(1, `hsla(${hue},60%,45%,0.9)`); e.fillStyle = gr; e.fillRect(i * 8, 0, 8, h); } }, { intensity: 2.6, flicker: 0.03, cell: 2.5, dead: 0.1, seed: hue });
    const curtainMat = memo(_curtainMat);
    const openSign = neonPanel(128, 64, (c, e, w, h) => { c.fillStyle = '#101216'; c.fillRect(0, 0, w, h); neonText(e, 'OPEN', w / 2, h / 2 + 2, 40, '#ff4060', { core: '#ffe0e8', tube: 0.09, style: '700', font: '"Liberation Sans", sans-serif' }); }, { intensity: 7, flicker: 0.06, cell: 0.4, dead: 0.35, seed: 3 });
    const _posterMat = (seed) => neonPanel(128, 192, (c, e, w, h) => { const r = makeRng(seed); c.fillStyle = ['#e8d8a0', '#c8e0d8', '#e8b8b0', '#b8c8e8'][seed % 4]; c.fillRect(0, 0, w, h); c.fillStyle = '#3a2a20'; c.fillRect(6, 6, w - 12, 8); c.fillRect(6, h - 22, w - 12, 12); c.fillStyle = ['#c03030', '#2a8a80', '#d09020'][seed % 3]; c.beginPath(); c.arc(w / 2, h * 0.42, 30 + r() * 10, 0, TAU); c.fill(); c.fillStyle = '#f5e8c8'; c.beginPath(); c.arc(w / 2 - 10, h * 0.4, 6, 0, TAU); c.arc(w / 2 + 10, h * 0.4, 6, 0, TAU); c.fill(); c.strokeStyle = '#f5e8c8'; c.lineWidth = 4; c.beginPath(); c.arc(w / 2, h * 0.44, 16, 0.2, PI - 0.2); c.stroke(); c.fillStyle = 'rgba(60,40,20,0.35)'; for (let i = 0; i < 30; i++) c.fillRect(r() * w, r() * h, 2 + r() * 5, 6 + r() * 20); e.fillStyle = '#000'; e.fillRect(0, 0, w, h); }, { intensity: 0.4, rough: 0.9 });
    const posterMat = memo(_posterMat);
    const paneVar = Array.from({ length: 6 }, (_, k) => neonPanel(64, 96, (c, e, w, h) => { const r = makeRng(k * 19 + 3); const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#141e34'); g.addColorStop(1, '#070b14'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,0.5)'; if (k % 3 === 0) { c.fillRect(w * 0.1, h * 0.55, w * 0.5, h * 0.45); c.fillRect(w * 0.62, h * 0.35, w * 0.3, h * 0.65); } else if (k % 3 === 1) { c.fillRect(0, h * 0.7, w, h * 0.3); c.beginPath(); c.arc(w * 0.7, h * 0.4, 12, 0, TAU); c.fill(); } c.strokeStyle = 'rgba(180,200,230,0.12)'; c.lineWidth = 2; c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.moveTo(0, h * 0.5); c.lineTo(w, h * 0.5); c.stroke(); e.fillStyle = '#000'; e.fillRect(0, 0, w, h); if (k === 2) { e.fillStyle = '#5a3a18'; e.fillRect(w * 0.45, 4, 5, 9); } }, { intensity: 1, rough: 0.05, metal: 0.55 }));
    const dentilG = geo('dentil', () => new THREE.BoxGeometry(0.16, 0.2, 0.22)), flagG = geo('bflag', () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-0.14, 0, 0, 0.14, 0, 0, 0, -0.34, 0.0], 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2)); return g; });
    const buntM = std({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, key: 'bunting', wind: { amp: 0.25, freq: 2.2, stiff: 'uv' } });
    const flowerG = geo('flowerB', () => new THREE.SphereGeometry(0.075, 6, 5)); const flowerCols = [0xff5a8a, 0xffd040, 0xf0f0f0, 0xff8a30, 0xb060e0];
    const shop = (sd, zc, w, H, wall, awn, label, o = {}) => {
      const dep = o.depth || 11, xF = sd * 21, xc = xF + sd * dep / 2, ww = w - 0.08; const s = sd, yawF = -s * PI / 2, kind = o.kind || 'gifts', lit = !o.dark;
      const wwin = ww - 5.4, zb = zc - 0.6, dz = zc + ww / 2 - 1.8, floors = H > 10.5 ? 2 : 1, nwU = Math.max(2, Math.floor((ww - 1.5) / 3.3)), X = (d) => xF - s * d;
      const OPN = [{ z0: zb - wwin / 2, z1: zb + wwin / 2, y0: 1.0, y1: 3.3 }, { z0: dz - 0.5, z1: dz + 0.5, y0: 0, y1: 2.4 }];
      for (let f = 0; f < floors; f++) { const y0 = 5.4 + f * 3.1; for (let i = 0; i < nwU; i++) { const z = zc - ww / 2 + (i + 0.5) * ww / nwU; OPN.push({ z0: z - 0.82, z1: z + 0.82, y0: y0 + 0.03, y1: y0 + 1.97 }); } }
      shopSkin(B, wall, { xF, s, zc, ww, H, dep, open: OPN });   // real wall thickness with true openings (plaza-bays.js)
      B.box({ p: [xF - s * 0.1, 0, zc], s: [0.2, 1.0, ww + 0.1], mat: brick, bevel: 0.03, cast: false });
      // pilasters + string course
      for (const z of [zc - ww / 2 + 0.25, zc + ww / 2 - 0.25, zc - 0.6 - (ww - 5.4) / 2 - 0.15]) B.box({ p: [xF - s * 0.2, 0.95, z], s: [0.4, H - 1.6, 0.5], mat: trim, bevel: 0.03, cast: true });
      B.box({ p: [xF - s * 0.14, 4.85, zc], s: [0.28, 0.3, ww], mat: trim, bevel: 0.03, cast: false });
      // shop window with a painted, lit display + mullions
      const disp = displayMat(kind, lit && !o.pink === false ? lit : lit, Math.floor(zc * 7 + s * 31 + 100));
      bayInterior(B, { X, s, yawF, zb, wwin, kind, lit, rng: RC, disp, K: { wood, trim, winLit2 } });   // display bay: back wall, shelves, merchandise, glass
      for (let z = zc - 0.6 - wwin / 2 + 2.2; z < zc - 0.6 + wwin / 2 - 1.0; z += 2.2) B.box({ p: [xF - s * 0.1, 1.0, z], s: [0.14, 2.3, 0.1], mat: trim, cast: false, bevel: 0.01 });
      B.box({ p: [xF - s * 0.1, 3.3, zc - 0.6], s: [0.16, 0.1, wwin], mat: trim, cast: false, bevel: 0.01 }); B.box({ p: [xF - s * 0.1, 0.9, zc - 0.6], s: [0.16, 0.12, wwin], mat: trim, cast: false, bevel: 0.01 });
      // door: framed glass with warm interior, kick plate, handle, OPEN sign, gooseneck lamp
      doorReal(B, { X, yawF, dz, lit, glass: lit ? curtainMat(20 + 7 * (Math.floor(zc * 3) % 8)) : dark, sign: openSign, K: { trim, gold, iron, concrete } });
      // (kick plate, handle and OPEN sign are part of doorReal)
      { const lx = xF - s * 0.3, lz = dz + 1.3; pipe(B, [lx + s * 0.1, 2.9, lz], [lx - s * 0.5, 3.1, lz], 0.025, iron, { seg: 5 }); B.cyl({ p: [lx - s * 0.5, 2.85, lz], r: [0.03, 0.15], h: 0.22, seg: 8, mat: iron, cast: false }); if (lit) { B.sphere({ p: [lx - s * 0.5, 2.85, lz], r: 0.09, seg: 6, mat: lampOn, cast: false }); halos.add([lx - s * 0.5, 2.85, lz], 0xffc880, 0.5, 0.5, 0); } }
      // posters
      for (let i = 0; i < 2; i++) quad(B, { p: [xF - s * 0.11, 2.0, zc - ww / 2 + 1.0 + i * 1.1], w: 0.75, h: 1.1, yaw: yawF, mat: posterMat(Math.floor(zc * 13 + i * 5 + 40) % 6) });
      // sign band
      extrudeXY(B, { p: [xF - s * 0.09, 4.15, zc - 0.6], yaw: yawF, pts: [[-wwin / 2, -0.5], [wwin / 2, -0.5], [wwin / 2, 0.5], [-wwin / 2, 0.5]], depth: 0.16, uv: 'bbox', mat: signMat(label, o.signBg || '#1a1c22', o.signFg || '#ff5aa5'), cast: false });
      // awning: sloped striped canvas, scalloped valance, posts, bunting
      awningMesh(B, { p: [xF, 3.65, zc], yaw: s > 0 ? PI : 0, out: 2.7, drop: 0.8, width: ww - 1.6, mat: awn }); quad(B, { p: [xF - s * 2.66, 2.72, zc], w: ww - 1.6, h: 0.55, yaw: yawF, mat: valanceMat(awn === awnRed ? '#8e3630' : '#3f6a63', '#d8cdb4'), uMax: (ww - 1.6) / 5.04 });
      for (const z of [zc - ww / 2 + 1.0, zc + ww / 2 - 1.0]) B.cyl({ p: [xF - s * 2.55, 0, z], r: 0.04, h: 3.0, seg: 6, mat: iron, cast: false });
      { const n = Math.floor((ww - 2) / 0.36); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, z = zc - (ww - 2) / 2 + (ww - 2) * t, y = 3.45 + 0.0 - 4 * 0.5 * t * (1 - t) * 0 ; B.instance('bflag', flagG, buntM, B.matrix([xF - s * 2.72, 3.05 - 0.14 * Math.sin(PI * t * 6) * 0.5, z], yawF, 0.62), [0xa83a32, 0xd0a030, 0x3f8a80, 0xc86a86, 0xe0dccc][i % 5], { cast: false }); } }
      // upper floors: framed windows with hoods, sills, shutters, curtains, flower boxes
      for (let f = 0; f < floors; f++) {
        const y0 = 5.4 + f * 3.1; const nw = Math.max(2, Math.floor((ww - 1.5) / 3.3)); for (let i = 0; i < nw; i++) {
          const z = zc - ww / 2 + (i + 0.5) * ww / nw; const litW = lit && RC() < 0.5; const glassW = litW ? curtainMat(20 + 7 * Math.floor(RC() * 8)) : paneVar[Math.floor(RC() * paneVar.length)];
          B.box({ p: [xF - s * 0.16, y0 - 0.12, z], s: [0.3, 0.1, 1.95], mat: concrete, bevel: 0.02, cast: false }); upperWindow(B, { X, s, yawF, z, y0, lit: litW, back: glassW, rng: RC, K: { trim, iron } });
          B.box({ p: [xF - s * 0.16, y0 - 0.12, z], s: [0.3, 0.1, 1.95], mat: concrete, bevel: 0.02, cast: false }); for (const [dy, sy, sz, oz] of [[1.0, 1.8, 0.05, 0], [1.02, 0.05, 1.3, 0], [1.62, 0.05, 1.3, 0]]) B.box({ p: [xF - s * 0.205, y0 + dy, z + oz], s: [0.03, sy, sz], mat: trim, anchor: 'center', bevel: 0, cast: false });   // mullion + transom bars in front of the glass B.box({ p: [xF - s * 0.18, y0 + 1.98, z], s: [0.32, 0.12, 1.9], mat: trim, bevel: 0.03, cast: false }); B.prism({ p: [xF - s * 0.2, y0 + 2.08, z], s: [1.7, 0.45, 0.34], yaw: yawF + PI / 2 * 0, mat: trim });
          RC();
          if (RC() < 0.4) { B.box({ p: [xF - s * 0.34, y0 - 0.02, z], s: [0.4, 0.22, 1.5], mat: wood, bevel: 0.02, cast: false }); for (let k = 0; k < 7; k++) B.instance('flowerB', flowerG, topiary, B.matrix([xF - s * 0.34, y0 + 0.28, z - 0.6 + k * 0.2], 0, 1 + RC() * 0.5), flowerCols[Math.floor(RC() * 5)], { cast: false }); }
        }
      }
      B.box({ p: [xF - s * 0.42, H - 0.75, zc], s: [1.05, 0.75, ww + 0.3], mat: trim, bevel: 0.05, cast: true }); B.box({ p: [xF - s * 0.25, H - 0.05, zc], s: [0.6, 0.5, ww + 0.1], mat: wall, bevel: 0.05, cast: false });
      for (let z = zc - ww / 2 + 0.3; z < zc + ww / 2; z += 0.42) B.box({ p: [xF - s * 0.3, H - 0.92, z], s: [0.16, 0.2, 0.22], mat: trim, anchor: 'center', bevel: 0, cast: false });
      if (o.roof === 'gable') B.prism({ p: [xc, H, zc], s: [ww + 0.6, 3.0, dep + 0.8], yaw: PI / 2, mat: s > 0 ? roofT : roofR });
      else if (o.roof === 'mansard') B.box({ p: [xc - s * 0.6, H, zc], s: [dep - 2, 1.8, ww - 1.4], mat: s > 0 ? roofR : roofT, bevel: 0.15, cast: true });
      else { B.cyl({ p: [xc + s * 2, H, zc - 3], r: [0.9, 0.9], h: 1.6, seg: 10, mat: metalRed }); B.box({ p: [xc + s * 3, H, zc + 2], s: [1.0, 3.0, 1.0], mat: brick, bevel: 0.05, cast: true }); B.box({ p: [xc + s * 3, H + 3.0, zc + 2], s: [1.3, 0.2, 1.3], mat: concrete, cast: false }); }
      for (const dz2 of [-1, 1]) B.cyl({ p: [xc + s * 4, H, zc + dz2 * 2.5], r: [0.32, 0.26], h: 0.9, seg: 8, mat: metalTeal, cast: false });
      if (o.blade) extrudeXY(B, { p: [xF - s * 1.0, H - 2.3, zc - ww / 2 + 1.1], yaw: 0, pts: [[-0.55, -1.6], [0.55, -1.6], [0.55, 1.6], [-0.55, 1.6]], depth: 0.2, uv: 'bbox', mat: bladeMat(o.blade[0], o.blade[1], o.blade[2], '#14161c'), cast: false });
      if (o.blade) B.box({ p: [xF - s * 0.5, H - 3.9, zc - ww / 2 + 1.1], s: [1.0, 0.1, 0.12], mat: iron, cast: false });
      ctx.light({ pos: [xF - s * 2.2, 2.4, zc], color: lit ? 0xffb060 : 0x503060, intensity: lit ? 14 : 6, distance: 9, decay: 2, flicker: lit ? 0.08 : 0.3 });
      if (wall !== brick) siding(B, { xF, s, zc, ww, H, mat: wall, open: OPN });
      grimeFace(B, grimeA, gRng, { p: [xF - s * 0.045, 0, s > 0 ? zc - ww / 2 : zc + ww / 2], yaw: s > 0 ? -PI / 2 : PI / 2, w: ww, h: H - 0.3, n: Math.round(ww * H * 0.6), y0: 0.1, kinds: [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 14] });
      facadeDetail(B, { trim, concrete, iron, gold, shut: awnRed === awn ? metalTeal : metalRed }, { xF, s, zc, ww, wwin, H, roof: o.roof });
      shops.push({ sd, zc, w, H });
    };
    shop(1, -17, 16, 10.8, plCream, awnRed, 'GIFT EMPORIUM', { roof: 'gable', blade: ['GIFTS', '& TOYS', '#ff4fa8'], signFg: '#ff5aa5', kind: 'gifts' });
    shop(1, -0.5, 15, 9.6, plTeal, awnRed, 'CANDY KITCHEN', { roof: 'mansard', signFg: '#ffd040', blade: ['CANDY', 'FUDGE', '#ffb030'], kind: 'candy' });
    shop(1, 18.5, 16, 11.6, brick, awnTeal, 'STAR ARCADE', { roof: 'flat', dark: true, signFg: '#40e8ff', blade: ['ARCADE', '★★★', '#40e8ff'], kind: 'arcade' });
    shop(1, 34.5, 14, 9.6, plButter, awnRed, 'ICE CREAM', { roof: 'gable', signFg: '#ff7ac0', kind: 'ice' });
    shop(-1, -17.5, 15, 10.6, plButter, awnTeal, 'GUEST SERVICES', { roof: 'flat', signFg: '#40e8ff', blade: ['GUEST', 'INFO', '#40e8ff'], kind: 'souv' });
    shop(-1, -0.5, 17, 11.8, brick, awnRed, 'COSTUME SHOP', { roof: 'mansard', dark: true, signFg: '#ffb030', blade: ['COSTUMES', '& HATS', '#ff4fa8'], kind: 'costume' });
    shop(-1, 20, 16, 9.8, plTeal, awnRed, 'SUNNY DINER', { roof: 'gable', signFg: '#ffd040', blade: ['DINER', 'OPEN', '#ff3c60'], kind: 'diner' });
    shop(-1, 36.5, 13, 10.4, plCream, awnTeal, 'SOUVENIRS', { roof: 'flat', signFg: '#ff5aa5', kind: 'gifts' });
    // service alleys between the shops (backstage): tall gates with a dead light
    for (const [sd, z] of [[1, 9.3], [-1, 9.6]]) { B.box({ p: [sd * 23.5, 0, z], s: [0.3, 3.4, 3.2], mat: iron, bevel: 0.02, col: 'metal' }); B.box({ p: [sd * 23.4, 0, z], s: [0.36, 0.3, 3.3], mat: metalRed, cast: false }); for (let i = 0; i < 6; i++) B.box({ p: [sd * 23.3, 0.3 + i * 0.5, z], s: [0.05, 0.08, 3.1], mat: iron, cast: false }); }
    // back-lot wall behind the shops (dark, tall) so the square reads as enclosed
    B.box({ p: [36.6, 0, 6], s: [1.2, 8.5, 92], mat: concrete, bevel: 0.05, col: 'concrete' }); B.box({ p: [-36.6, 0, 6], s: [1.2, 8.5, 92], mat: concrete, bevel: 0.05, col: 'concrete' });
    { const hedgeM = M('hedge', 'noise', [0x264c2a, 0x336636, 0x1a3d1d, 0x4c8845], { scale: 8, contrast: 2.1, fine: 150, speckle: 0.09 }, { tile: 1, bump: 10, rough: [0.85, 1] }, { breakup: 0.3 });                          // north hedge-wall behind the station: dark moonlit foliage, real relief
      hedgeWall(B, { p: [0, 0, -41.0], w: 78, h: 9, mat: hedgeM, cast: false }); B.box({ p: [0, 0, -41.85], s: [78, 9, 1.2], mat: hedgeM, cast: true, bevel: 0.05 }); B.colliders.addBox({ x: 0, y: 4.5, z: -40.85, hx: 39, hy: 4.5, hz: 0.5, surface: 'concrete' }); }
    // ------------------------------------------------------------ overhead bulb strings across the street + lamp posts
    const gBulb = geo('bulb.05', () => new THREE.SphereGeometry(0.05, 7, 5)); const cableM = B.m('cable', std({ color: 0x1a1a1a, roughness: 0.6 }));
    for (const z of [-20, -9, 2, 13, 24, 35]) festoon(B, halos, [-20.5, 7.6, z], [20.5, 7.6, z], { sag: 1.9, n: 30, bulb: bulbW, cable: cableM, rng: RC, size: 0.3, haloEvery: 3, color: 0xffc070 });
    const lampPts = [[-14, -20], [14, -20], [-14, -8], [14, -8], [-14, 4], [14, 4], [-14, 16], [14, 16], [-14, 28], [14, 28], [-14, 40], [14, 40]]; const lampState = [1, 1, 0, 1, 1, 2, 1, 0, 2, 1, 1, 0];   // 1 on, 0 dead, 2 flickering
    lampPts.forEach(([x, z], i) => {
      const st = lampState[i]; lampPost(B, { iron, gold, lampOn, lampOff }, x, z, !!st); for (const sx of [-1, 1]) if (st) halos.add([x + sx * 0.5, 4.72, z], 0xffc884, 0.55, st === 2 ? 0.7 : 0.85, st === 2 ? 7 : 0);
      if (st) ctx.light({ pos: [x, 4.3, z], color: 0xffb466, intensity: 44, distance: 24, decay: 2, flicker: st === 2 ? 0.35 : 0.03, flickerSpeed: st === 2 ? 11 : 6 });
    });

    // ------------------------------------------------------------ FOUNTAIN with the sun-mascot statue (origin)
    B.lathe({ p: [0, 0, 0], profile: [[6.05, 0], [6.6, 0], [6.6, 0.55], [6.75, 0.6], [6.75, 0.72], [6.0, 0.72], [6.0, 0.6], [6.05, 0.55]], seg: 40, mat: ring, col: 'concrete' });
    B.cyl({ p: [0, 0, 0], r: 6.06, h: 0.16, seg: 40, mat: B.m('fountainFloor', std({ color: 0x1c5a60, roughness: 0.3 })), cast: false });
    B.plane({ p: [0, 0.4, 0], s: [12, 12], mat: B.m('fwater', std({ color: 0x06222c, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.82, depthWrite: false })), cast: false });
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; B.sphere({ p: [Math.cos(a) * 5.7, 0.22, Math.sin(a) * 5.7], r: 0.15, seg: 8, mat: uwater, cast: false }); if (i % 2 === 0) halos.add([Math.cos(a) * 5.7, 0.35, Math.sin(a) * 5.7], 0x30e0e8, 0.8, 0.9, 0); }
    ctx.light({ pos: [0, 0.8, 0], color: 0x30d8e0, intensity: 26, distance: 14, decay: 2, flicker: 0.06 });
    B.lathe({ p: [0, 0, 0], profile: [[0, 0.15], [2.6, 0.15], [2.6, 0.5], [1.9, 0.95], [1.5, 1.0], [1.3, 1.5], [0, 1.5]], seg: 32, mat: ring, col: 'concrete' });        // lower tier
    B.lathe({ p: [0, 1.5, 0], profile: [[0.85, 0], [1.05, 0], [1.05, 0.4], [1.9, 0.75], [1.9, 0.9], [1.7, 0.9], [0.95, 0.55], [0.85, 0.55]], seg: 32, mat: ring });   // upper bowl
    B.cyl({ p: [0, 1.5, 0], r: [0.7, 0.55], h: 1.2, seg: 20, mat: gold }); B.cyl({ p: [0, 2.7, 0], r: 0.9, h: 0.3, seg: 20, mat: fibreT });
    fountainReal(B, { concrete, ring, trim, gold, fwater: B.m('fwater') });
    { const y0 = 3.0; // statue: 'Sunny' faces south (+z)
      for (const sx of [-1, 1]) { B.cyl({ p: [sx * 0.28, y0, 0.05], r: 0.2, h: 0.55, seg: 10, mat: fibreT }); B.sphere({ p: [sx * 0.28, y0 + 0.07, 0.3], r: 0.26, seg: 10, mat: fibreR, scale: [1, 0.55, 1.5] }); }
      B.sphere({ p: [0, y0 + 1.1, 0], r: 0.72, seg: 16, mat: fibreR, scale: [1, 1.15, 0.9] }); B.sphere({ p: [0, y0 + 1.05, 0.58], r: 0.3, seg: 10, mat: fibreW, scale: [1.4, 1.2, 0.35] });   // torso + white bib
      for (const sx of [-1, 1]) { const a = [sx * 0.68, y0 + 1.4, 0], b = [sx * 1.25, y0 + (sx > 0 ? 2.5 : 1.8), 0.3]; pipe(B, a, b, 0.13, fibreW, { seg: 8 }); B.sphere({ p: b, r: 0.24, seg: 10, mat: fibreW }); }
      B.sphere({ p: [0, y0 + 2.7, 0], r: 0.92, seg: 20, mat: fibre });                                                                                    // head
      for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; pipe(B, [Math.cos(a) * 0.95, y0 + 2.7 + Math.sin(a) * 0.95, 0], [Math.cos(a) * 1.75, y0 + 2.7 + Math.sin(a) * 1.75, 0], 0.16, i % 2 ? fibreR : fibre, { seg: 6, r2: 0.0 }); }
      for (const sx of [-1, 1]) { B.sphere({ p: [sx * 0.34, y0 + 2.9, 0.78], r: 0.27, seg: 10, mat: fibreW, scale: [1, 1.25, 0.5] }); B.sphere({ p: [sx * 0.36, y0 + 2.86, 0.9], r: 0.11, seg: 8, mat: rubberM }); B.sphere({ p: [sx * 0.6, y0 + 2.5, 0.72], r: 0.2, seg: 8, mat: fibreR, scale: [1, 0.7, 0.4] }); }
      torus(B, { p: [0, y0 + 2.42, 0.6], R: 0.42, r: 0.05, seg: 6, tube: 16, arc: PI, pitch: PI / 2 + 0.25, roll: PI, mat: B.m('smile', std({ color: 0x5a1010, roughness: 0.4 })), cast: false });
      B.sphere({ p: [0, y0 + 2.68, 0.9], r: 0.16, seg: 8, mat: fibreR });
      // balloon bunch in its raised glove
      for (let i = 0; i < 6; i++) { const a = i * 1.1, hx = 1.25 + Math.cos(a) * 0.35, hy = y0 + 4.2 + Math.sin(a * 1.7) * 0.3, hz = 0.3 + Math.sin(a) * 0.35; pipe(B, [1.25, y0 + 2.55, 0.3], [hx, hy - 0.2, hz], 0.008, cableM, { seg: 3, cast: false }); B.instance('balloonS', balloonGeo(), balloonM, B.matrix([hx, hy, hz], 0, 1.1), [0xd83030, 0xf0b020, 0x2a9d95, 0xff5aa5, 0x4a70e0, 0xf0f0f0][i], { cast: false }); }
    }
    statueReal(B, { fibreW, fibreR, gold, iron });
    const fountainLight = ctx.light({ pos: [0, 8.2, 3], color: 0xffd8a0, intensity: 52, distance: 18, decay: 2, kind: 'point' });
    ctx.light({ kind: 'spot', pos: [-23.6, 19.5, -25.2], dir: [0.62, -0.5, 0.6], color: 0xffd6a0, intensity: 1500, distance: 70, decay: 2, angle: 0.42, penumbra: 0.85, shadow: true, flicker: 0.02 });   // security floodlight on the clock tower: long soft shadows across the square
    const spot = makeBeam({ length: 14, r0: 0.1, r1: 3.6, color: 0xffd8a0, intensity: 0.04, dust: 1 }); spot.position.set(-7, 0.4, 7); spot.lookAt(0, 6, 0); B.group.add(spot);
    const spot2 = makeBeam({ length: 14, r0: 0.1, r1: 3.6, color: 0xffd8a0, intensity: 0.04, dust: 1 }); spot2.position.set(7, 0.4, 7); spot2.lookAt(0, 6, 0); B.group.add(spot2);
    for (const sx of [-1, 1]) B.box({ p: [sx * 7, 0, 7], s: [0.5, 0.4, 0.5], mat: iron, cast: false });

    // ------------------------------------------------------------ ENTRANCE GATE: piers, huge neon arch sign, ticket booths, turnstiles
    const GZ = 46, ARCH = (x) => 21 - 8.2 * (x / 17.5) * (x / 17.5);
    for (const sx of [-1, 1]) { const x = sx * 17.5;
      B.box({ p: [x, 0, GZ], s: [4.8, 1.2, 4.8], mat: concrete, col: 'concrete', bevel: 0.06 }); B.box({ p: [x, 1.2, GZ], s: [3.6, 11.4, 3.6], mat: plCream, col: 'concrete', bevel: 0.08 });
      for (const y of [4.5, 9.4]) B.box({ p: [x, y, GZ], s: [3.85, 0.55, 3.85], mat: metalTeal, bevel: 0.05, cast: false }); B.box({ p: [x, 12.6, GZ], s: [4.6, 0.7, 4.6], mat: metalRed, bevel: 0.06 });
      pierReal(B, { trim, concrete }, x, GZ);
      for (const dz of [-1, 1]) { extrudeXY(B, { p: [x + sx * 2.3, 6, GZ + dz * 0.0], yaw: 0, pts: [[0, -6], [1.1, -3], [1.1, 4.5], [0, 8]], depth: 0.35, mat: metalTeal, cast: true }); break; }   // Googie fin
      pipe(B, [x, 13.3, GZ], [x, 19.5, GZ], 0.1, chrome, { seg: 8 }); B.sphere({ p: [x, 19.8, GZ], r: 0.32, seg: 10, mat: gold });
      torus(B, { p: [x, 15.8, GZ], R: 0.9, r: 0.035, seg: 5, tube: 24, pitch: PI / 2, mat: neonCyan, cast: false }); torus(B, { p: [x, 15.8, GZ], R: 0.9, r: 0.035, seg: 5, tube: 24, pitch: PI / 2, roll: PI / 2, mat: neonPink, cast: false }); halos.add([x, 15.8, GZ], 0x40e8ff, 2.2, 0.8, 0);
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; pipe(B, [x + Math.cos(a) * 0.5, 9.0 + Math.sin(a) * 0.5, GZ + 1.85], [x + Math.cos(a) * 1.4, 9.0 + Math.sin(a) * 1.4, GZ + 1.85], 0.03, neonAmber, { seg: 4, cast: false }); pipe(B, [x + Math.cos(a) * 0.5, 9.0 + Math.sin(a) * 0.5, GZ - 1.85], [x + Math.cos(a) * 1.4, 9.0 + Math.sin(a) * 1.4, GZ - 1.85], 0.03, neonAmber, { seg: 4, cast: false }); }   // sunburst ornaments on the pier faces
      halos.add([x, 9.0, GZ + 1.9], 0xffa030, 1.6, 0.8, 0); halos.add([x, 9.0, GZ - 1.9], 0xffa030, 1.6, 0.8, 0);
    }
    { const top = [], bot = []; for (let i = 0; i <= 28; i++) { const x = -17.5 + 35 * i / 28; top.push([x, ARCH(x) + 0.65]); bot.push([x, ARCH(x) - 0.65]); }
      extrudeXY(B, { p: [0, 0, GZ], pts: [...top, ...bot.reverse()], depth: 1.5, mat: metalTeal, cast: true });
      const cy = [], pk = []; for (let i = 0; i <= 40; i++) { const x = -17.4 + 34.8 * i / 40; cy.push([x, ARCH(x) + 0.68, GZ + 0.78]); pk.push([x, ARCH(x) - 0.66, GZ + 0.78]); }
      B.tube({ pts: cy, r: 0.07, mat: neonCyan, seg: 6, segs: 60, cast: false }); B.tube({ pts: pk, r: 0.07, mat: neonPink, seg: 6, segs: 60, cast: false });
      B.tube({ pts: cy.map((q) => [q[0], q[1], GZ - 0.78]), r: 0.07, mat: neonCyan, seg: 6, segs: 60, cast: false }); B.tube({ pts: pk.map((q) => [q[0], q[1], GZ - 0.78]), r: 0.07, mat: neonPink, seg: 6, segs: 60, cast: false });
      for (let i = 0; i <= 14; i++) { const x = -16 + 32 * i / 14; halos.add([x, ARCH(x) + 0.9, GZ + 0.9], i % 2 ? 0x40e8ff : 0xff3c96, 1.1, 0.75, 0); halos.add([x, ARCH(x) + 0.9, GZ - 0.9], i % 2 ? 0x40e8ff : 0xff3c96, 1.1, 0.75, 0); }
      // the sign lens between the arch and the flat bottom line
      const pts = []; for (let i = 0; i <= 30; i++) { const x = -15 + 30 * i / 30; pts.push([x, ARCH(x) - 0.75 - 0.15]); } pts.push([15, 13.9]); pts.push([-15, 13.9]);
      const arcSign = neonPanel(2048, 420, (c, e, w, h) => {
        c.fillStyle = '#0e1a30'; c.fillRect(0, 0, w, h); c.fillStyle = '#132644'; c.fillRect(0, h * 0.5, w, h * 0.5); c.strokeStyle = '#d9c27a'; c.lineWidth = 8;
        c.strokeRect(0, 0, w, h);
        neonText(e, 'After Hours', w / 2, h * 0.52, 250, '#ff3c96', { core: '#ffeaf6', tube: 0.05, style: 'italic 700' }); neonText(c, 'After Hours', w / 2, h * 0.52, 250, '#4a1a3a', { core: '#4a1a3a', tube: 0.03, style: 'italic 700' });
        neonText(e, '★  A M U S E M E N T   P A R K  ★', w / 2, h * 0.9, 46, '#40e8ff', { core: '#ffffff', tube: 0.09, style: '700', font: '"Liberation Sans", sans-serif' });
        for (let i = 0; i < 26; i++) { e.fillStyle = i % 3 ? '#ffd070' : '#ff4fa8'; e.beginPath(); e.arc(60 + i * 72, 14, 6, 0, TAU); e.fill(); }
      }, { intensity: 11, rough: 0.5, flicker: 0.05, cell: 2.4, dead: 0.09, seed: 1.7 });
      arcSign.userData.arch = true;
      extrudeXY(B, { p: [0, 0, GZ], pts, depth: 0.6, mat: arcSign, uv: 'bbox', cast: true }); ctx.arcSign = arcSign;
      pipes(B, [[-15, 14.0, GZ + 0.4], [-15, ARCH(-15) - 0.6, GZ + 0.4]], 0.03, chrome);
    }
    for (const sx of [-1, 1]) for (const bx of [9.2, 14.0]) {   // ticket booths flanking the turnstiles: hollow kiosks with a real 1.9 x 2.1 m service opening (the barricade), counter, till, stool and a warm lamp inside
      const x = sx * bx, z = GZ - 1.3, wt = 0.26, ow = 1.9, oh = 2.1, seg = (3.6 - ow) / 2;   // booth 3.6 x 3.0 x 2.6, front wall faces the plaza (-z)
      B.box({ p: [x, 0, z + 1.3 - wt / 2], s: [3.6, 3.0, wt], mat: plRose, bevel: 0.03, col: 'brick' });                                            // back wall
      for (const s2 of [-1, 1]) B.box({ p: [x + s2 * (1.8 - wt / 2), 0, z], s: [wt, 3.0, 2.6 - 2 * wt], mat: plRose, bevel: 0.03, col: 'brick' });   // side walls
      for (const s2 of [-1, 1]) B.box({ p: [x + s2 * (ow / 2 + seg / 2), 0, z - 1.3 + wt / 2], s: [seg, 3.0, wt], mat: plRose, bevel: 0.03, col: 'brick' });   // front wall piers
      B.box({ p: [x, oh, z - 1.3 + wt / 2], s: [ow, 3.0 - oh, wt], mat: plRose, bevel: 0.03, col: 'brick' });                                        // lintel
      B.box({ p: [x, 0, z], s: [3.6 - 2 * wt, 0.06, 2.6 - 2 * wt], mat: wood, cast: false, col: 'wood' }); B.box({ p: [x, 2.96, z], s: [3.6, 0.1, 2.6], mat: trim, cast: false });                // floor + ceiling
      B.prism({ p: [x, 3.0, z], s: [4.2, 1.5, 3.2], yaw: 0, mat: roofT, cast: true });
      for (const s2 of [-1, 1]) { B.box({ p: [x + s2 * (ow / 2 + 0.06), 0, z - 1.3 - 0.03], s: [0.14, oh + 0.1, 0.34], mat: trim, cast: false, bevel: 0.01 }); }
      B.box({ p: [x, oh, z - 1.3 - 0.03], s: [ow + 0.36, 0.14, 0.34], mat: trim, cast: false, bevel: 0.01 }); B.box({ p: [x, 1.02, z - 1.3 - 0.16], s: [ow + 0.5, 0.07, 0.5], mat: trim, cast: false, bevel: 0.02 });   // sill / shelf
      B.box({ p: [x, 2.36, z - 1.3 - 0.06], s: [2.6, 0.5, 0.08], mat: signMat('TICKETS', '#1a1c22', '#ffd040', 56), cast: false }); B.box({ p: [x, 2.98, z - 1.3 - 0.14], s: [3.8, 0.12, 0.3], mat: awnRed, cast: false });
      // interior: side desk with a till, a stool, a lamp, a price board and a "closed" tag on the sill; the middle stays clear for the zombies
      B.box({ p: [x + sx * 1.3, 0, z + 0.4], s: [0.5, 0.95, 1.4], mat: wood, bevel: 0.02, col: 'wood' }); B.box({ p: [x + sx * 1.3, 0.95, z + 0.4], s: [0.3, 0.2, 0.32], mat: metalRed, bevel: 0.02, cast: false });
      B.cyl({ p: [x - sx * 1.2, 0, z + 0.6], r: 0.2, h: 0.58, seg: 8, mat: iron, cast: false }); B.cyl({ p: [x - sx * 1.2, 0.58, z + 0.6], r: 0.24, h: 0.06, seg: 10, mat: metalRed, cast: false });
      B.sphere({ p: [x, 2.7, z + 0.2], r: 0.11, seg: 8, mat: lampOn, cast: false }); halos.add([x, 2.7, z + 0.2], 0xffc880, 0.5, 0.35, 0); ctx.light({ pos: [x, 2.55, z + 0.2], color: 0xffb060, intensity: 7, distance: 6, decay: 2, flicker: 0.25, flickerSpeed: 9 });
      B.box({ p: [x + 0.55, 1.5, z - 1.3 + 0.36], s: [0.42, 0.28, 0.02], mat: signMat('CLOSED', '#3a1414', '#ff6a5a', 46), cast: false, pitch: 0.08 }); B.box({ p: [x - sx * 1.65, 1.2, z + 0.1], s: [0.02, 0.6, 0.9], mat: posterMat(Math.floor(x * 5 + 77) % 6), cast: false });
    }
    { const arrowM = glowMat(0x50ff90, 6, { flicker: 0.05, cell: 3, dead: 0.3, seed: 6 }), xM = glowMat(0xff3040, 6, { flicker: 0.05, cell: 3, seed: 7 }); const chainM = B.m('gateChain', std({ color: 0x8c9096, roughness: 0.35, metalness: 1 }));
      for (let i = -2; i <= 2; i++) { const x = i * 2.3, z = GZ - 1.4;
        B.box({ p: [x - 0.42, 0, z], s: [0.36, 1.05, 1.15], mat: metalRed, bevel: 0.07, col: 'metal' }); B.box({ p: [x + 0.42, 0, z], s: [0.36, 1.05, 1.15], mat: metalRed, bevel: 0.07, col: 'metal' }); B.box({ p: [x - 0.42, 1.03, z], s: [0.42, 0.06, 1.22], mat: chrome, bevel: 0.02, cast: false }); B.box({ p: [x + 0.42, 1.03, z], s: [0.42, 0.06, 1.22], mat: chrome, bevel: 0.02, cast: false });
        B.box({ p: [x - 0.42, 0.62, z - 0.585], s: [0.26, 0.3, 0.03], mat: i % 2 ? arrowM : xM, cast: false }); B.box({ p: [x - 0.42, 0.98, z - 0.585], s: [0.26, 0.05, 0.03], mat: dark, cast: false });
        B.cyl({ p: [x, 0, z], r: 0.07, h: 1.12, seg: 8, mat: chrome, cast: false }); B.cyl({ p: [x, 1.05, z], r: 0.1, h: 0.14, seg: 10, mat: chrome, cast: false });
        for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + i * 0.7 + 0.4; const ex = x + Math.cos(a) * 0.62, ez = z + Math.sin(a) * 0.62; pipe(B, [x, 1.1, z], [ex, 1.1, ez], 0.026, chrome, { seg: 6, cast: false }); B.sphere({ p: [ex, 1.1, ez], r: 0.04, seg: 6, mat: chrome, cast: false }); }
        if (i % 2 === 0) B.cable([x - 0.24, 0.95, z - 0.55], [x + 0.24, 0.9, z - 0.55], 0.12, 0.012, chainM, { n: 7, seg: 3, cast: false }); }
      B.box({ p: [0, 2.05, GZ - 2.15], s: [11.6, 0.42, 0.06], mat: signMat('ALL ACCESS  -  ONE PRICE  -  ALL DAY', '#14202a', '#ffd040', 40), cast: false }); pipe(B, [-5.6, 0, GZ - 2.15], [-5.6, 2.3, GZ - 2.15], 0.05, iron, { seg: 6, cast: false }); pipe(B, [5.6, 0, GZ - 2.15], [5.6, 2.3, GZ - 2.15], 0.05, iron, { seg: 6, cast: false });
      const pier = (sx, kind) => { const x = sx * 17.5, tex = neonPanel(256, 384, (c, e, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, kind ? '#0f2a44' : '#3a1030'); g.addColorStop(1, kind ? '#1c6a8a' : '#a02a4a'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.strokeStyle = '#f2e6c8'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12); c.fillStyle = '#f2e6c8'; c.textAlign = 'center'; c.font = '900 46px "Liberation Sans", sans-serif'; c.fillText(kind ? 'NEW!' : 'GRAND', w / 2, 84); c.font = '900 38px "Liberation Sans", sans-serif'; c.fillText(kind ? 'ROCKET' : 'REOPENING', w / 2, 142); c.fillText(kind ? 'ROOM' : '1965', w / 2, 190); c.beginPath(); c.arc(w / 2, 270, 46, 0, TAU); c.fillStyle = kind ? '#ffd040' : '#ff5a8a'; c.fill(); c.fillStyle = '#14202a'; c.font = '900 30px "Liberation Sans", sans-serif'; c.fillText(kind ? '30 M' : '* * *', w / 2, 282); c.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = 0; i < 40; i++) c.fillRect(Math.random() * w, Math.random() * h, 2, 8 + Math.random() * 30); }, { intensity: 0.5, rough: 0.6 });
        B.box({ p: [x, 1.7, GZ - 1.83], s: [1.9, 2.85, 0.05], mat: tex, cast: false }); B.box({ p: [x, 1.7 - 1.45, GZ - 1.81], s: [2.0, 0.06, 0.08], mat: trim, cast: false }); B.box({ p: [x, 1.7 + 1.45, GZ - 1.81], s: [2.0, 0.06, 0.08], mat: trim, cast: false }); };
      pier(-1, 0); pier(1, 1); }
    for (const sx of [-1, 1]) { B.box({ p: [sx * 27.5, 0, GZ], s: [17, 0.25, 0.5], mat: concrete, bevel: 0.03, col: 'concrete' }); for (let x = 19.6; x < 36; x += 0.28) B.box({ p: [sx * x, 0.25, GZ], s: [0.05, 2.1, 0.05], mat: iron, cast: false, bevel: 0.003 }); B.box({ p: [sx * 27.5, 2.3, GZ], s: [17, 0.08, 0.1], mat: iron, cast: false }); B.colliders.addBox({ x: sx * 27.8, y: 1.2, z: GZ, hx: 8.6, hy: 1.2, hz: 0.15, surface: 'metal', walk: false }); }
    ctx.light({ pos: [0, 12.6, GZ - 4], color: 0xff5aa0, intensity: 60, distance: 24, decay: 2, flicker: 0.08 }); ctx.light({ pos: [0, 12.6, GZ - 5], color: 0x50e0ff, intensity: 34, distance: 22, decay: 2, flicker: 0.04 });

    // ------------------------------------------------------------ CLOCK TOWER (NW of the square, stopped at 11:58)
    { const TX = -27, TZ = -28.6;
      B.box({ p: [TX, 0, TZ], s: [7.6, 1.2, 7.6], mat: concrete, col: 'concrete', bevel: 0.06 }); B.box({ p: [TX, 1.2, TZ], s: [5.8, 15.9, 5.8], mat: plCream, col: 'concrete', bevel: 0.08 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box({ p: [TX + sx * 2.85, 1.2, TZ + sz * 2.85], s: [0.7, 15.9, 0.7], mat: trim, bevel: 0.06, cast: false });
      for (const y of [5.5, 10.5]) for (const [dx, dz, w, d] of [[0, 2.95, 0.7, 0.12], [0, -2.95, 0.7, 0.12], [2.95, 0, 0.12, 0.7], [-2.95, 0, 0.12, 0.7]]) B.box({ p: [TX + dx, y, TZ + dz], s: [w, 2.2, d], mat: winLit2, cast: false, bevel: 0.01 });
      B.box({ p: [TX, 17.1, TZ], s: [6.8, 5.6, 6.8], mat: plTeal, bevel: 0.08, cast: true }); B.box({ p: [TX, 16.9, TZ], s: [7.4, 0.5, 7.4], mat: trim, bevel: 0.05 }); B.box({ p: [TX, 22.5, TZ], s: [7.4, 0.5, 7.4], mat: trim, bevel: 0.05 });
      clockTowerReal(B, { concrete, trim, iron, gold }, TX, TZ);
      const face = neonPanel(512, 512, (c, e, w, h) => {
        for (const g of [c, e]) { g.fillStyle = g === c ? '#e9dfc4' : '#000'; g.fillRect(0, 0, w, h); }
        c.fillStyle = '#e9dfc4'; c.beginPath(); c.arc(256, 256, 250, 0, TAU); c.fill(); e.fillStyle = '#c99a50'; e.beginPath(); e.arc(256, 256, 245, 0, TAU); e.fill();
        for (const g of [c, e]) { g.strokeStyle = g === c ? '#1a1712' : '#000'; g.lineWidth = 10; g.beginPath(); g.arc(256, 256, 236, 0, TAU); g.stroke(); g.fillStyle = g === c ? '#1a1712' : '#000'; g.font = 'bold 54px "Liberation Serif", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          for (let i = 1; i <= 12; i++) { const a = i / 12 * TAU - PI / 2; g.fillText(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][i - 1], 256 + Math.cos(a) * 190, 256 + Math.sin(a) * 190); }
          g.lineCap = 'round'; g.lineWidth = 16; g.beginPath(); g.moveTo(256, 256); g.lineTo(256 + Math.cos(-PI / 2 - 0.05) * 205, 256 + Math.sin(-PI / 2 - 0.05) * 205); g.stroke(); g.lineWidth = 22; g.beginPath(); g.moveTo(256, 256); g.lineTo(256 + Math.cos(-PI / 2 - 0.55) * 130, 256 + Math.sin(-PI / 2 - 0.55) * 130); g.stroke(); g.beginPath(); g.arc(256, 256, 20, 0, TAU); g.fill(); }
      }, { intensity: 3.4, rough: 0.4 });
      for (const [dx, dz, yaw] of [[0, 3.44, 0], [0, -3.44, PI], [3.44, 0, PI / 2], [-3.44, 0, -PI / 2]]) { quad(B, { p: [TX + dx, 19.7, TZ + dz], w: 4.4, h: 4.4, yaw, mat: face }); torus(B, { p: [TX + dx * 1.005, 19.7, TZ + dz * 1.005], R: 2.2, r: 0.09, seg: 6, tube: 32, pitch: PI / 2, yaw, mat: gold, cast: false }); }
      B.box({ p: [TX, 22.9, TZ], s: [5.4, 3.7, 5.4], mat: plCream, bevel: 0.06, cast: true });
      for (const [dx, dz, w, d] of [[0, 2.72, 2.0, 0.1], [0, -2.72, 2.0, 0.1], [2.72, 0, 0.1, 2.0], [-2.72, 0, 0.1, 2.0]]) { B.box({ p: [TX + dx, 23.3, TZ + dz], s: [w, 2.4, d], mat: dark, cast: false }); B.box({ p: [TX + dx * 1.01, 24.55, TZ + dz * 1.01], s: [w + 0.3, 0.3, d + 0.3], mat: gold, cast: false, bevel: 0.05 }); }
      B.lathe({ p: [TX, 26.6, TZ], profile: [[5.4, 0], [5.0, 0.3], [0.0, 7.2]], seg: 4, yaw: PI / 4, mat: roofT }); B.lathe({ p: [TX, 26.6, TZ], profile: [[4.9, 0], [5.6, -0.05], [5.6, -0.3], [4.9, -0.3]], seg: 4, yaw: PI / 4, mat: trim, cast: false });
      pipe(B, [TX, 33.8, TZ], [TX, 36.6, TZ], 0.06, gold, { seg: 6 }); B.sphere({ p: [TX, 33.9, TZ], r: 0.34, seg: 10, mat: gold }); extrudeXY(B, { p: [TX + 0.6, 36.2, TZ], pts: [[-0.6, 0], [0.7, 0.16], [0.7, -0.16]], depth: 0.05, mat: gold, cast: false });
      for (const y of [8, 14.5]) for (const [dx, dz, yaw] of [[0, 2.99, 0], [0, -2.99, 0], [2.99, 0, PI / 2], [-2.99, 0, PI / 2]]) pipes(B, [[TX + dx - (yaw ? 0 : 2.6), y, TZ + dz - (yaw ? 2.6 : 0)], [TX + dx + (yaw ? 0 : 2.6), y, TZ + dz + (yaw ? 2.6 : 0)]], 0.035, neonPink, { seg: 6, cast: false });
      halos.add([TX, 14.5, TZ + 3.05], 0xff3c96, 2.4, 0.7, 0); halos.add([TX, 8, TZ + 3.05], 0xff3c96, 2.4, 0.7, 0); halos.add([TX, 19.7, TZ + 3.7], 0xffcc80, 3, 0.5, 0);
      for (const sx of [-1, 1]) { const b = makeBeam({ length: 22, r0: 0.1, r1: 2.6, color: 0xffcc88, intensity: 0.035, dust: 1 }); b.position.set(TX + sx * 4.6, 0.3, TZ + 4.8); b.lookAt(TX + sx * 1.6, 18, TZ + 3); B.group.add(b); }
      ctx.light({ pos: [TX + 3, 12, TZ + 6], color: 0xffcc88, intensity: 60, distance: 26, decay: 2 });
    }
    // ------------------------------------------------------------ street furniture
    const bench = (x, z, yaw) => { benchReal(B, { iron, wood }, x, z, yaw); B.colliders.addBox({ x, y: 0.3, z, hx: 0.9, hy: 0.3, hz: 0.28, yaw, surface: 'wood', walk: true }); };
    for (const [x, z, yaw] of [[-8.5, -12, 0], [8.5, -12, PI], [-17.4, 14, -PI / 2 + 0.1], [17.4, 22, PI / 2], [-9, 34, PI], [9, 34, 0], [-17.4, -4, -PI / 2], [17.4, -6, PI / 2]]) bench(x, z, yaw);
    streetKit(B, { iron, gold, wood, board: dark }, [[-10, 26, 0.4, 'a'], [11, 12, -0.3, 'a'], [-12, -22, 0.2, 'a'], [12.5, -14, PI - 0.3, 'a'], [-9.5, 4, -0.5, 'a'], ...Array.from({ length: 16 }, (_, i) => [-2.4 + (i % 8) * 0.68, 38 + Math.floor(i / 8) * 1.3, 0, 'p']), ...[[-16.5, 26], [-16.5, 34], [16.5, 26], [16.5, 14], [-16.5, -12], [16.5, -20]].map(([x, z]) => [x, z, 0, 'b'])]);   // sandwich boards, queue stanchions, bollards
    const planter = (x, z, w, d, m = plTeal, n = 3) => { B.box({ p: [x, 0, z], s: [w, 0.75, d], mat: m, bevel: 0.04, col: 'concrete' }); B.box({ p: [x, 0.7, z], s: [w - 0.2, 0.12, d - 0.2], mat: B.m('soil', std({ color: 0x1d1610, roughness: 1 })), cast: false }); B.box({ p: [x, 0.74, z], s: [w + 0.14, 0.1, d + 0.14], mat: trim, bevel: 0.03, cast: false }); for (let i = 0; i < n; i++) { const lx = w > d ? (i - (n - 1) / 2) * (w / n) : 0, lz = w > d ? 0 : (i - (n - 1) / 2) * (d / n); B.sphere({ p: [x + lx, 1.4, z + lz], r: 0.55 + RC() * 0.12, seg: 10, mat: topiary }); B.cyl({ p: [x + lx, 0.8, z + lz], r: 0.06, h: 0.4, seg: 6, mat: wood, cast: false }); } };
    for (const [x, z, w, d, m] of [[-18.5, -22.5, 3.4, 1.2, plRose], [18.5, -22.5, 3.4, 1.2, plTeal], [-18.5, 4, 1.2, 3.6, plTeal], [18.5, 8, 1.2, 3.6, plRose], [-9, -30, 4, 1.2, plTeal], [9, -30, 4, 1.2, plRose], [-18.5, 44, 3.4, 1.2, plRose], [18.5, 44, 3.4, 1.2, plTeal], [-6.5, 26, 1.4, 4, plCream], [6.5, 26, 1.4, 4, plCream]]) planter(x, z, w, d, m);
    const bin = (x, z) => { B.lathe({ p: [x, 0, z], profile: [[0, 0], [0.3, 0], [0.32, 0.1], [0.34, 0.9], [0.3, 0.98], [0.0, 1.02]], seg: 14, mat: fibreT, col: 'plastic' }); B.box({ p: [x, 0.62, z + 0.31], s: [0.3, 0.16, 0.06], mat: rubberM, cast: false }); B.sphere({ p: [x, 1.0, z], r: 0.16, seg: 8, mat: fibre, cast: false }); };
    for (const [x, z] of [[-12, -16], [12, -16], [-15.5, 30], [15.5, 30], [-3, 40], [3, 40], [15.5, -2], [-15.5, 8]]) bin(x, z);
    { const bp = [[-12, -16], [12, -16], [-15.5, 30], [15.5, 30], [-3, 40], [3, 40], [15.5, -2], [-15.5, 8], [-8.5, -12], [8.5, -12], [-17.4, 14], [17.4, 22], [-9, 34], [9, 34]]; const around = (n, r) => bp.flatMap(([x, z]) => Array.from({ length: n }, () => [x + (RC() - 0.5) * 2 * r, z + (RC() - 0.5) * 2 * r]));
      litter(B, RC, around(20, 1.5), { mat: plasticM, kind: 'cup', colors: [0xd83030, 0xffffff, 0x2a9d95, 0xf0b020] }); litter(B, RC, around(26, 1.7), { mat: paperM, kind: 'paper', colors: [0xe8e2d0, 0xd8c8a0, 0xe0e0e8, 0xc8d8e8] }); litter(B, RC, around(9, 1.2), { mat: plasticM, kind: 'can', colors: [0xc0c4c8, 0xd83030, 0x3070c0] }); litter(B, RC, around(7, 1.3), { mat: paperM, kind: 'box', colors: [0xf0e0b0, 0xd83030, 0xffffff] }); }   // litter clustered around bins and benches
    const cartStripe = awnRed;
    const cart = (x, z, yaw, kind) => {
      const c = Math.cos(yaw), s = Math.sin(yaw); const L = (lx, y, lz, sx, sy, sz, m, o = {}) => B.box({ p: [x + lx * c + lz * s, y, z - lx * s + lz * c], s: [sx, sy, sz], yaw, mat: m, bevel: 0.03, ...o });
      L(0, 0.35, 0, 1.6, 0.85, 0.9, kind === 'pop' ? metalRed : metalTeal, { col: 'metal' }); L(0, 1.2, 0, 1.62, 0.06, 0.94, chrome);
      if (kind === 'pop') { L(0, 1.26, 0, 1.4, 0.75, 0.75, B.m('popGlass', std({ color: 0xcfe8f0, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.18, depthWrite: false })), { cast: false }); L(0, 1.32, 0, 1.2, 0.35, 0.6, B.m('popcorn', std({ color: 0xe8c860, roughness: 0.9 })), { cast: false }); L(0, 2.0, 0, 1.9, 0.08, 1.3, cartStripe, { roll: 0.0 }); L(0, 2.4, 0, 0.1, 0.6, 0.1, chrome); halos.add([x, 1.7, z], 0xffcc70, 1.0, 0.6, 0); }
      else { L(0, 1.9, 0, 0.06, 1.0, 0.06, chrome); B.cyl({ p: [x, 2.7, z], r: [1.2, 0.05], h: 0.5, seg: 10, mat: cartStripe, cast: true }); }
      for (const sx of [-0.7, 0.7]) for (const sz of [-0.5, 0.5]) B.cyl({ p: [x + sx * c + sz * s, 0.16, z - sx * s + sz * c], r: 0.16, h: 0.08, seg: 10, mat: rubberM, pitch: PI / 2, yaw, anchor: 'center', cast: false });
      if (kind === 'balloon') for (let i = 0; i < 16; i++) { const a = i * 2.4, r = 0.35 + (i % 4) * 0.22, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, py = 3.6 + (i % 5) * 0.32; pipe(B, [x, 2.0, z], [px, py - 0.25, pz], 0.006, cableM, { seg: 3, cast: false }); B.instance('balloonS', balloonGeo(), balloonM, B.matrix([px, py, pz], 0, 1.15), [0xd83030, 0xf0b020, 0x2a9d95, 0xff5aa5, 0x4a70e0, 0xfafafa, 0x9a50d0][i % 7], { cast: false }); }
    };
    cart(-10.5, 20, 0.5, 'pop'); cart(8.6, 24.5, -0.4, 'balloon'); cart(11, -19.5, 0.2, 'pop');
    // wet-ground details: glossy puddles reflecting the string lights, manhole covers, queue stanchions with velvet ropes at the turnstiles
    { const dcW = decalAtlas('puddleP', [PAINT.puddle([12, 12, 24]), PAINT.puddle([16, 12, 22]), PAINT.puddle([10, 14, 24])], { rough: 0.035, env: 2.6, seed: 8 }); const pl = []; for (const [x, z, sz] of [[-6, 12, 2.6], [8, 4, 2.4], [-14, 24, 3.2], [12, 30, 2.4], [0, -14, 3.4], [-5, 40, 2.8], [16, -10, 1.9], [-18, -6, 2.1], [3, 22, 1.7], [-9, 34, 2.2], [20, -30, 2.0], [-20, 44, 2.6], [10, 42, 2.0]]) pl.push([x, 0.002, z, sz, Math.floor(RC() * 3), RC() * TAU, null, 1.0 + RC() * 0.45]); placeDecals(B, dcW, pl);
      for (const [x, z] of [[-3, 14], [6, 32], [-12, -22], [14, 8]]) { B.cyl({ p: [x, 0.0, z], r: 0.42, h: 0.03, seg: 14, mat: iron, cast: false }); B.cyl({ p: [x, 0.03, z], r: 0.36, h: 0.01, seg: 14, mat: B.m('manholeM', std({ color: 0x6a7076, roughness: 0.55, metalness: 0.7 })), cast: false }); }
      const post = (x, z) => { B.cyl({ p: [x, 0, z], r: 0.2, h: 0.03, seg: 10, mat: chrome, cast: false }); B.cyl({ p: [x, 0, z], r: 0.03, h: 0.95, seg: 8, mat: chrome, cast: false }); B.sphere({ p: [x, 0.98, z], r: 0.06, seg: 8, mat: chrome, cast: false }); };
      const pts = []; for (let i = 0; i < 6; i++) pts.push([-6 + i * 2.4, 38.5 + (i % 2) * 0 - 1.6 * 0]); for (let i = 0; i < 6; i++) { post(pts[i][0], 40.2); post(pts[i][0], 37.4); if (i) { B.cable([pts[i - 1][0], 0.9, 40.2], [pts[i][0], 0.9, 40.2], 0.18, 0.02, B.m('velvet', std({ color: 0x8a1520, roughness: 0.8 })), { n: 6, seg: 4, cast: false }); if (i % 2) B.cable([pts[i - 1][0], 0.9, 37.4], [pts[i][0], 0.9, 37.4], 0.18, 0.02, B.m('velvet', std({ color: 0x8a1520, roughness: 0.8 })), { n: 6, seg: 4, cast: false }); } } }
    // ---- pavement decals: gum, sticky soda stains, confetti, kids' chalk drawings, cracks, drain grates, tickets, scuffs, muddy shoe prints, wet leaves
    { const dcP = decalAtlas('plaza', [PAINT.gum, PAINT.stain('rgb(96,44,64)', 0.32), PAINT.stain('rgb(30,60,90)', 0.32), PAINT.confetti, PAINT.chalkHop, PAINT.chalkHeart('rgba(190,110,140,0.75)'), PAINT.chalkSun, PAINT.crack, PAINT.drain, PAINT.ticket, PAINT.scuff, PAINT.footprint('rgba(34,26,20,0.55)', false), PAINT.leaf('rgb(160,90,30)', 'rgb(110,70,26)'), PAINT.stain('rgb(20,18,22)', 0.6), PAINT.chalkHeart('rgba(110,160,190,0.75)'), PAINT.puddleRim], { seed: 5 });
      const dl = []; const put = (n, box, cells, sz, ok = () => true) => { for (let i = 0, k = 0; i < n * 6 && k < n; i++) { const x = box[0] + RC() * (box[2] - box[0]), z = box[1] + RC() * (box[3] - box[1]); if (!ok(x, z)) continue; k++; dl.push([x, 0, z, sz[0] + RC() * (sz[1] - sz[0]), cells[Math.floor(RC() * cells.length)], RC() * TAU, null]); } };
      const open = (x, z) => Math.hypot(x, z) > 7.4 && !(Math.abs(x) < 4.2 && z < -27) && !(Math.abs(x - 15.5) < 5 && Math.abs(z - 15.5) < 5);
      put(240, [-31, -27, 31, 44], [0, 10, 12], [0.7, 1.5], open); put(120, [-31, -27, 31, 44], [1, 2, 13], [0.7, 1.5], open); put(64, [-28, -25, 28, 43], [3], [2.0, 3.4], open); put(88, [-28, -25, 28, 43], [7], [1.6, 2.6], open);
      put(120, [-31, -27, 31, 44], [9, 11], [0.8, 1.4], open); put(36, [-24, -20, 24, 40], [4], [1.3, 1.7], open); put(28, [-24, -20, 24, 40], [5, 14], [1.0, 1.4], open); put(20, [-24, -20, 24, 40], [6], [1.2, 1.6], open);
      for (const [x, z] of [[-4, 33], [4, 33], [-7, 20], [7, -18]]) dl.push([x, 0, z, 1.1, 8, 0, null]);           // storm drain grates
      for (let i = 0; i < 12; i++) dl.push([-3 + RC() * 6, 0, 40 + RC() * 3, 1.0, 11, PI + (RC() - 0.5) * 0.5, null]);   // shoe prints toward the gate
      placeDecals(B, dcP, dl); }
    // dropped balloons, litter, spilled popcorn, paper
    { const pts = scatter(RC, 70, [-30, -30, 30, 44], (x, z) => Math.hypot(x, z) > 7.2); for (const [x, z] of pts) B.instance('balloonS', balloonGeo(), balloonM, B.matrix([x, 0.2, z], RC() * TAU, 1.0, RC() * 0.6, RC() * 6), [0xd83030, 0xf0b020, 0x2a9d95, 0xff5aa5, 0x4a70e0, 0xfafafa][Math.floor(RC() * 6)], { cast: false });
      litter(B, RC, scatter(RC, 320, [-31, -30, 31, 44]), { mat: plasticM, kind: 'cup', colors: [0xd83030, 0xffffff, 0x2a9d95, 0xf0b020] }); litter(B, RC, scatter(RC, 420, [-31, -30, 31, 44]), { mat: paperM, kind: 'paper', colors: [0xe8e2d0, 0xd8c8a0, 0xe0e0f0, 0xf0d0d0] }); litter(B, RC, scatter(RC, 26, [-31, -30, 31, 44]), { mat: plasticM, kind: 'box', colors: [0xd83030, 0xf0e8d0] });
      const pc = geo('pop', () => new THREE.SphereGeometry(0.03, 6, 4)); for (const [cx, cz] of [[-9, 22], [-11.5, 19], [9.6, -18.5], [12, -20]]) for (let i = 0; i < 18; i++) B.instance('pop', pc, B.m('popcorn', std({ color: 0xe8c860, roughness: 0.9 })), B.matrix([cx + (RC() - 0.5) * 2.6, 0.03, cz + (RC() - 0.5) * 2.6], RC() * 6, 0.8 + RC() * 0.6), 0xffffff, { cast: false }); }
    // ---- Victorian bandstand east of the fountain: 1 m octagonal stage with two stairs, iron columns, scalloped teal roof + weather vane, bulb ring, a dead band's kit and a painted banner
    { const BX = 15.5, BZ = 15.5, H = 1.0, RR = 4.2, yw = PI / 8, oc = (a, r) => [BX + Math.cos(a) * r, BZ - Math.sin(a) * r];
      B.cyl({ p: [BX, 0, BZ], r: [RR + 0.3, RR + 0.3], h: 0.22, seg: 8, yaw: yw, mat: concrete, cast: false }); B.cyl({ p: [BX, 0.2, BZ], r: [RR, RR], h: H - 0.2, seg: 8, yaw: yw, mat: plCream, col: 'concrete' }); B.cyl({ p: [BX, H - 0.02, BZ], r: [RR + 0.08, RR + 0.08], h: 0.08, seg: 8, yaw: yw, mat: wood, cast: false });
      const fl = RR * Math.cos(PI / 8);
      B.stairs({ p: [BX - fl - 5 * 0.32 + 0.05, 0, BZ], n: 5, rise: H / 5, run: 0.32, w: 2.5, yaw: 0, mat: plCream, col: 'concrete' }); B.stairs({ p: [BX, 0, BZ + fl + 5 * 0.32 - 0.05], n: 5, rise: H / 5, run: 0.32, w: 2.5, yaw: PI / 2, mat: plCream, col: 'concrete' });
      for (const [px, pz, ry] of [[BX - fl - 0.9, BZ - 1.5, 0], [BX - fl - 0.9, BZ + 1.5, 0]]) pipe(B, [px, 0, pz], [px, 1.0, pz], 0.04, iron, { seg: 6, cast: false });
      const cols = []; for (let k = 0; k < 8; k++) { const a = k * PI / 4 + PI / 8, [x, z] = oc(a, RR - 0.15); cols.push([x, z]); pipe(B, [x, H, z], [x, H + 3.15, z], 0.1, iron, { seg: 8, r2: 0.075 }); B.cyl({ p: [x, H, z], r: [0.2, 0.13], h: 0.32, seg: 8, mat: iron, cast: false }); B.sphere({ p: [x, H + 3.2, z], r: 0.13, seg: 8, mat: gold, cast: false }); B.colliders.addCyl({ x, z, r: 0.14, y0: H, y1: H + 3.2, surface: 'metal', walk: false }); }
      for (let k = 0; k < 8; k++) { const [x0, z0] = cols[k], [x1, z1] = cols[(k + 1) % 8]; pipe(B, [x0, H + 3.05, z0], [x1, H + 3.05, z1], 0.11, iron, { seg: 6 }); const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, ya = Math.atan2(-(z1 - z0), x1 - x0); B.box({ p: [mx, H + 2.55, mz], s: [Math.hypot(x1 - x0, z1 - z0) - 0.2, 0.45, 0.05], yaw: ya, mat: k % 2 ? plTeal : plRose, cast: false, bevel: 0.01 });
        for (let i = 0; i < 6; i++) { const t = (i + 0.5) / 6, bx = x0 + (x1 - x0) * t, bz = z0 + (z1 - z0) * t; B.instance('bsBulb', geo('bsBulb', () => new THREE.SphereGeometry(0.055, 6, 4)), bulbW, B.matrix([bx, H + 3.0, bz]), (Math.floor(RC() * 255) << 16) | 0x808080, { cast: false }); }
        if (k % 2 === 0) B.cyl({ p: [mx, H + 2.1, mz], r: [0.05, 0.13], h: 0.45, seg: 6, mat: gold, cast: false }); }
      B.lathe({ p: [BX, H + 3.2, BZ], profile: [[RR + 0.75, 0], [RR * 0.86, 0.3], [RR * 0.62, 0.85], [RR * 0.38, 1.6], [RR * 0.18, 2.35], [0.28, 2.95], [0.1, 3.3]], seg: 8, yaw: yw, mat: roofT });
      pipe(B, [BX, H + 6.4, BZ], [BX, H + 7.6, BZ], 0.04, gold, { seg: 6 }); B.sphere({ p: [BX, H + 6.55, BZ], r: 0.18, seg: 10, mat: gold }); B.box({ p: [BX + 0.35, H + 7.35, BZ], s: [0.8, 0.22, 0.03], mat: gold, cast: false, bevel: 0.01 });
      for (let i = 0; i < 3; i++) { const a = 0.8 + i * 0.7, x = BX - 1.6 + Math.cos(a) * 1.6, z = BZ - 0.8 + Math.sin(a) * 1.4; pipe(B, [x, H, z], [x, H + 1.0, z], 0.015, chrome, { seg: 5, cast: false }); B.box({ p: [x, H + 1.0, z], s: [0.5, 0.36, 0.03], mat: iron, cast: false, pitch: -0.35, yaw: 0.6 + i * 0.4 }); B.cyl({ p: [x, H, z], r: 0.16, h: 0.03, seg: 8, mat: iron, cast: false }); }
      { const dx = BX + 1.3, dz = BZ - 1.0; B.cyl({ p: [dx, H + 0.34, dz], r: [0.36, 0.36], h: 0.32, seg: 14, roll: PI / 2, anchor: 'center', mat: fibreR }); B.cyl({ p: [dx - 0.5, H + 0.78, dz - 0.2], r: [0.2, 0.2], h: 0.15, seg: 12, mat: fibreW, cast: false }); for (const [ox, oz, r] of [[-0.35, 0.5, 0.17], [0.25, 0.55, 0.19]]) B.cyl({ p: [dx + ox, H + 0.72, dz + oz], r: [r, r], h: 0.2, seg: 10, mat: fibreW, cast: false }); for (const [ox, oz, hh, r] of [[-0.75, -0.5, 1.15, 0.24], [0.6, 0.85, 1.25, 0.26]]) { pipe(B, [dx + ox, H, dz + oz], [dx + ox, H + hh, dz + oz], 0.014, chrome, { seg: 5, cast: false }); B.cyl({ p: [dx + ox, H + hh, dz + oz], r: [r, r], h: 0.012, seg: 12, mat: gold, cast: false }); } B.cyl({ p: [dx - 0.1, H, dz + 1.1], r: 0.2, h: 0.5, seg: 8, mat: fibreR, cast: false }); }
      { const bn = neonPanel(512, 96, (c, e, w, h) => { c.fillStyle = '#2a1a14'; c.fillRect(0, 0, w, h); c.strokeStyle = '#d9c27a'; c.lineWidth = 4; c.strokeRect(4, 4, w - 8, h - 8); c.fillStyle = '#f2e6c8'; c.font = 'italic 700 34px "Liberation Serif", serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('LIVE TONIGHT  -  THE SUNNY SIDE BAND', w / 2, h / 2 + 2); }, { intensity: 0.0 });
        const [x0, z0] = cols[6], [x1, z1] = cols[7], ya = Math.atan2(-(z1 - z0), x1 - x0); B.box({ p: [(x0 + x1) / 2 + Math.sin(ya) * 0.05, H + 1.35, (z0 + z1) / 2 + Math.cos(ya) * 0.05], s: [2.8, 0.5, 0.03], yaw: ya, mat: bn, cast: false }); }
      ctx.light({ pos: [BX, H + 2.7, BZ], color: 0xffc078, intensity: 24, distance: 12, decay: 2, flicker: 0.1 }); }
    // park directory board + a stroller
    B.box({ p: [-18, 0, -14], s: [0.12, 2.2, 2.6], mat: neonPanel(512, 256, (c, e, w, h) => { c.fillStyle = '#14202a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#d9c27a'; c.lineWidth = 6; c.strokeRect(8, 8, w - 16, h - 16); neonText(e, 'YOU ARE HERE', w / 2, 46, 46, '#ffd040', { core: '#fff', tube: 0.08, style: '700', font: '"Liberation Sans", sans-serif' }); c.strokeStyle = '#7a8a90'; c.lineWidth = 3; for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(256 + (i - 1.5) * 110, 160, 34, 0, TAU); c.stroke(); e.strokeStyle = ['#ff4fa8', '#40e8ff', '#a060ff', '#ffb030'][i]; e.lineWidth = 4; e.beginPath(); e.arc(256 + (i - 1.5) * 110, 160, 30, 0, TAU); e.stroke(); } }, { intensity: 3.5 }), col: 'plastic', bevel: 0.02 });

    // ------------------------------------------------------------ weather + atmosphere
    ctx.weather({ count: 420, box: [56, 14, 56], fall: 0.0, size: 0.032, turb: 0.9, color: [1.0, 0.75, 0.42], alpha: 0.6, cell: 3, additive: true, twinkle: 0.7, seed: 21, wind: [0.4, 0, 0.2] });      // moths / dust motes around the lamps
    ctx.weather({ count: 36, box: [44, 4, 44], fall: 0.35, size: 0.04, turb: 1.6, color: [0.2, 0.185, 0.15], alpha: 0.8, cell: 12, seed: 33, wind: [2.6, 0, 1.0] });                                       // blowing litter
    ctx.weather({ count: 150, box: [70, 3.2, 70], fall: 0.0, size: 4.2, turb: 0.25, color: [0.28, 0.27, 0.32], alpha: 0.05, cell: 1, seed: 47, wind: [0.5, 0, 0.3] });                                   // low mist
    const atmo = {
      name: 'After Hours · Entrance Plaza',
      fog: { color: 0x0c0e18, scatter: 0x3a3448, density: 0.0058, falloff: 0.03, base: 0, power: 5 },
      sky: { zenith: 0x030518, horizon: 0x1e2038, ground: 0x08070c, gradPow: 0.62, sunColor: 0xfff2d4, sunSize: 0.03, sunGlow: 0.2, disc: 2, stars: 0.6, cloud: 0.3, cloudColor: 0x1e2136, cloudLit: 0x7a7088, cloudSpeed: 0.004, cloudScale: 1.7, cloudDark: 0.4, horizonFog: 0.55 },
      sun: { dir: [-0.42, 0.55, 0.46], color: 0xbccaff, intensity: 0.95, shadow: true }, env: { intensity: 0.5 },
      exposure: 1.0, bloom: 0.5, vignette: 0.4, grain: 0.03, chroma: 0.0016, ao: 0.75,
      grade: { sat: 0.96, contrast: 1.1, lift: [0.004, 0.0, 0.01], gain: [1.05, 1.0, 0.94], tint: [1, 1, 1] }, autoExposure: { key: 0.055, min: 0.85, max: 2.0 },
      wind: [1.6, 0, 0.6], wet: 0.4, reverb: 'openDusk',
    };
    const O = ctx.origin, nozzles = Array.from({ length: 8 }, (_, i) => { const a = i / 8 * TAU; return [Math.cos(a) * 1.55, 2.45, Math.sin(a) * 1.55, Math.cos(a), Math.sin(a)]; }); let spray = 0; const EF = { p: [0, 0, 0], v: [0, 0, 0], life: 1.1, size: [0.04, 0.025], c0: [0.85, 0.95, 1, 0.8], c1: [0.8, 0.9, 1, 0], gravity: 1, drag: 0.05, cell: 7 };   // one reusable descriptor: no per-frame garbage of our own
    const pf = S.P(3.3, 0, -3.05), fw = S.dir(1, 0);
    grimeFlush(B, grimeA);   // all facade weathering decals -> one mesh
    return {
      atmo, envPatches: [{ dir: [-0.42, 0.55, 0.46], color: 0xbccaff, size: 2.2, intensity: 7 }, { dir: [0.2, -0.5, 1], color: 0xffa860, size: 5, intensity: 2.2 }, { dir: [-0.5, -0.3, -0.8], color: 0xff4fa0, size: 3, intensity: 1.5 }],
      playerStart: { pos: pf, yaw: Math.atan2(-fw[0], -fw[1]) }, station: { pos: STATION_LOCAL[0], yaw: STATION_YAW[0] }, groundY: 0, groundSurface: 'tile', reflect: { level: 0 },
      navBounds: [-36, -40, 36, 51], landmark: { pos: [0, 16, 46], name: 'Neon Arch' },
      spawns: [
        { kind: 'barricade', pos: [-9.2, 0, 44.55], yaw: 0, boards: 5, note: 'ticket window W1' }, { kind: 'barricade', pos: [-14.0, 0, 44.55], yaw: 0, boards: 5, note: 'ticket window W2' },
        { kind: 'barricade', pos: [9.2, 0, 44.55], yaw: 0, boards: 5, note: 'ticket window E1' }, { kind: 'barricade', pos: [14.0, 0, 44.55], yaw: 0, boards: 5, note: 'ticket window E2' },
        { kind: 'barricade', pos: [22.6, 0, 9.3], yaw: PI / 2, boards: 5, note: 'east service gate' }, { kind: 'barricade', pos: [-22.6, 0, 9.6], yaw: -PI / 2, boards: 5, note: 'west service gate' },
        { kind: 'walk', pos: [-4.6, 0, 49.5], yaw: PI, note: 'turnstiles' }, { kind: 'walk', pos: [4.6, 0, 49.5], yaw: PI, note: 'turnstiles' }, { kind: 'walk', pos: [0, 0, 51], yaw: PI, note: 'gate' },
        { kind: 'walk', pos: [-30, 0, -36], yaw: 0, note: 'backstage NW' }, { kind: 'walk', pos: [30, 0, -36], yaw: 0, note: 'backstage NE' },
      ],
      buys: { walls: [{ pos: [20.93, 1.7, -23.9], yaw: -PI / 2, gun: 'mp5' }, { pos: [-20.93, 1.7, -14.6], yaw: PI / 2, gun: 'olympia' }, { pos: [-20.93, 1.7, 41.5], yaw: PI / 2, gun: 'ak74u' }], perks: [{ pos: [-22.2, 0, -28.6], yaw: PI / 2, perk: 'juggernog' }], box: { pos: [-18.6, 0, 30], yaw: PI / 2 } },
      zombieVariants: [{ id: 'guest', weight: 6 }, { id: 'staff', weight: 3 }, { id: 'usher', weight: 2, minRound: 2 }, { id: 'mascot_sun', weight: 2, minRound: 3 }, { id: 'clown', weight: 1, minRound: 5 }],
      ambient: {
        space: { rt60: 0.9, damping: 0.6, predelay: 0.03, wet: 0.22, dryLP: 12000, early: [[0.07, 0.25], [0.16, 0.18]] }, gain: 0.9,
        beds: [
          { type: 'drone', freq: 55, gain: 0.05, note: 'distant generator' }, { type: 'hum', freq: 100, harmonics: [2, 3, 5], gain: 0.05, note: 'neon transformers' },
          { type: 'music', style: 'calliope', gain: 0.13, pos: 'far', tune: { bpm: 124, detune: 18, wobble: 0.6, notes: [[72, 0.5], [76, 0.5], [79, 0.5], [84, 1], [83, 0.5], [79, 0.5], [76, 1], [74, 0.5], [77, 0.5], [81, 0.5], [86, 1], [84, 0.5], [81, 0.5], [77, 1], [72, 0.5], [76, 0.5], [79, 0.5], [84, 1], [88, 0.5], [86, 0.5], [84, 0.5], [83, 0.5], [79, 0.5], [77, 0.5], [76, 1.5], [0, 0.5]] } },
          { type: 'wind', gain: 0.1, gust: 0.3 }, { type: 'crackle', gain: 0.02, note: 'failing neon' },
        ],
        events: [{ type: 'scream-far', every: [10, 26], gain: 0.35, pos: 'far' }, { type: 'laugh-far', every: [14, 36], gain: 0.3, pos: 'far' }, { type: 'creak', every: [6, 16], gain: 0.3, pos: 'far' }, { type: 'clank', every: [10, 26], gain: 0.22 }, { type: 'bell', every: [45, 90], gain: 0.4, pos: [-27, 24, -28.6] }, { type: 'radio', every: [18, 46], gain: 0.22, pos: [0, 12, 46] }, { type: 'firework', every: [20, 46], gain: 0.35, pos: 'far' }],
      },
      onReady(st) { st.arcSign = ctx.arcSign; },
      update(dt, t, active) {
        if (!active) return; spray += dt;
        if (spray > 0.045) { spray = 0; for (let i = 0; i < nozzles.length; i++) { const n = nozzles[i]; EF.p[0] = O.x + n[0]; EF.p[1] = O.y + n[1]; EF.p[2] = O.z + n[2]; EF.v[0] = n[3] * (1.3 + Math.random() * 0.5); EF.v[1] = 3.9 + Math.random() * 0.7; EF.v[2] = n[4] * (1.3 + Math.random() * 0.5); fx.alpha.emit(EF, fx.time); } }
      },
    };
  },
};
