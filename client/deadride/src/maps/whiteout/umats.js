// Materials of the SUMMIT OBSERVATORY: black wind-scoured basalt, granite masonry glazed in ice, verdigris copper, rime feathers, sastrugi snow.
// Palette: pale blue / violet moonlight, lightning white, ice.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { terrainMaterial, snowFrag } from './common.js';
import { windowMaterial } from './snowkit.js';

export function summitMats(B) {
  const M = {};
  M.terrain = terrainMaterial(B, { name: 'uTerrain', frag: { rock: [0.06, 0.065, 0.085], rock2: [0.14, 0.15, 0.19], tint: [0.9, 0.94, 1.12], ice: 0.8, strata: 1.2, rockStart: 0.3, snowFx: { sss: [0.04, 0.045, 0.1], bump: 0.8, scale: 1.2, aniso: 1.5 } } });
  M.snow = B.m('uSnow', { pattern: 'snow', size: 512, tile: 3, colors: [0xd4dcf2, 0xecf1ff, 0x9ea9d0], params: { scale: 4, ripples: 0.4, sparkle: 1.0, direction: 0, crust: 0.7 }, bump: 70, rough: [0.4, 0.7] }, { triplanar: 1 / 3, breakup: 0.5, frag: snowFrag({ sss: [0.04, 0.045, 0.1], bump: 0.8, scale: 1.2, aniso: 1.5 }) });
  M.rock = B.m('uRock', { pattern: 'rock', size: 1024, tile: 4, colors: [0x0f1116, 0x1c1f28, 0x2d313d, 0x4e5566], params: { scale: 5, strata: 9, cracks: 1.0, roughness: 0.85, tone: 0.5, moisture: 0.1 }, bump: 130, rough: [0.55, 0.9], layers: { frost: 0.5, sparkle: 0.6 } }, { triplanar: 1 / 4, snow: 1.4 });
  M.granite = B.m('uGranite', { pattern: 'bricks', size: 1024, tile: 2, colors: [0x9296a2, 0x6c707c, 0x2c2e36], params: { rows: 7, cols: 3, mortar: 0.028, variation: 0.6, chips: 0.6, roughness: 0.8, moss: 0, soot: 0.25 }, bump: 16, rough: [0.62, 0.92], layers: { frost: 0.28, grime: 0.22, streak: 0.3 } }, { snow: 0.7, breakup: 0.5 });
  M.graniteDark = B.m('uGraniteD', { pattern: 'bricks', size: 512, tile: 2, colors: [0x666a76, 0x4a4e5a, 0x1c1d24], params: { rows: 8, cols: 3, mortar: 0.03, variation: 0.55, chips: 0.5, roughness: 0.85, moss: 0, soot: 0.4 }, bump: 16, rough: [0.7, 0.95], layers: { frost: 0.2, grime: 0.3 } }, { snow: 0.6, breakup: 0.5 });
  M.copper = B.m('uCopper', { pattern: 'plates', size: 1024, tile: 2, colors: [0x4f9c86, 0x3b7f6e, 0x7a4a26], rustColor: 0x9a5a2c, params: { cols: 5, rows: 3, seam: 0.012, rivets: 0, brushed: 0.2, panelVar: 0.8 }, bump: 5, metal: 0.65, rough: [0.4, 0.75], layers: { rust: 0.35, grime: 0.2, edge: 0.5, streak: 0.8, frost: 0.2 } }, { snow: 1.0, breakup: 0.5, side: THREE.DoubleSide });
  M.steel = B.m('uSteel', { pattern: 'plates', size: 512, tile: 2, colors: [0x5c6072, 0x4a4e5e, 0x1c1e28], params: { cols: 2, rows: 2, seam: 0.008, rivets: 8, brushed: 0.4, panelVar: 0.4, bolts: 1 }, bump: 2, metal: 0.9, rough: [0.36, 0.7], layers: { rust: 0.22, grime: 0.3, edge: 0.4, scratch: 0.35, frost: 0.3, streak: 0.5 } }, { snow: 1.0, breakup: 0.4 });
  M.steelPaint = B.m('uSteelP', { pattern: 'plates', size: 512, tile: 2, colors: [0xb8bcc8, 0x9ea3b3, 0x4a4e5c], params: { cols: 1, rows: 3, seam: 0.006, rivets: 6, brushed: 0.2, panelVar: 0.3 }, bump: 2, metal: 0.7, rough: [0.4, 0.7], layers: { rust: 0.3, grime: 0.35, edge: 0.4, scratch: 0.3, frost: 0.3, streak: 0.5 } }, { snow: 1.0 });
  M.redPaint = B.m('uRed', { pattern: 'plates', size: 256, tile: 2, colors: [0xb0281f, 0x8c1e18, 0x2a0e0c], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2 }, bump: 1, metal: 0.5, rough: [0.4, 0.7], layers: { grime: 0.4, frost: 0.3, edge: 0.3 } }, { snow: 0.7 });
  M.brass = B.m('uBrass', std({ color: 0xb98d3e, metalness: 1, roughness: 0.3 }));
  M.iron = B.m('uIron', std({ color: 0x1c1d24, metalness: 0.85, roughness: 0.55 }));
  M.wire = B.m('uWire', std({ color: 0x2b2d36, metalness: 0.9, roughness: 0.45 }));
  M.timber = B.m('uTimber', { pattern: 'planks', size: 512, tile: 2, colors: [0x5f5a58, 0x3d3a3c, 0x151416], params: { rows: 8, gap: 0.005, grain: 8, knots: 0.4, cols: 2, weather: 0.4, nails: 0.9 }, bump: 5, rough: [0.75, 0.96], layers: { grime: 0.3, frost: 0.55 } }, { snow: 0.7, breakup: 0.4 });
  M.concrete = B.m('uConcrete', { pattern: 'noise', size: 512, tile: 3, colors: [0x6c707c, 0x585c68, 0x2e3038, 0x8a8e9c], params: { scale: 5, contrast: 1.4, fine: 96, speckle: 0.05, pores: 0.3, panels: 3, panelWidth: 0.004 }, bump: 4, rough: [0.78, 0.98], layers: { grime: 0.2, cracks: 0.25, streak: 0.45 } }, { snow: 0.9, breakup: 0.6 });
  M.floor = B.m('uFloor', { pattern: 'tiles', size: 512, tile: 3, colors: [0x6a6e7a, 0x555964, 0x2a2c33], params: { n: 5, grout: 0.012, checker: 0, bevel: 0.006, wear: 0.6, gloss: 0.5, crackle: 0.4 }, bump: 1.4, rough: [0.3, 0.75], layers: { grime: 0.2, wet: 0.3, scratch: 0.4 } });
  M.ice = B.m('uIce', std({ color: 0xd2e0ff, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.26, depthWrite: false, envMapIntensity: 1.8 }));
  M.iceSolid = B.m('uIceSolid', { pattern: 'ice', size: 512, tile: 2, colors: [0x9db8ec, 0xdbe6ff, 0xffffff], params: { scale: 4, cracks: 1.0, bubbles: 0.6, depth: 0.8 }, bump: 10, rough: [0.05, 0.3], layers: { frost: 0.4 } });
  M.rimeSpike = B.m('uRimeSpike', std({ color: 0xe8efff, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.85, depthWrite: true }));
  M.glowWarm = B.m('uGlowWarm', std({ color: 0x180e08, emissive: 0xffb066, emissiveIntensity: 1.5, roughness: 0.4 }));
  M.glowRed = B.m('uGlowRed', std({ color: 0x120404, emissive: 0xff1c0c, emissiveIntensity: 7, roughness: 0.4 }));
  M.glowBlue = B.m('uGlowBlue', std({ color: 0x080c18, emissive: 0x9db4ff, emissiveIntensity: 1.3, roughness: 0.4 }));
  M.glassFrost = B.m('uGlassF', std({ color: 0x9db0d8, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
  M.orange = B.m('uOrange', { pattern: 'plates', size: 256, tile: 2, colors: [0xc85a18, 0xa84a12, 0x3a1a08], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2 }, bump: 1, metal: 0.5, rough: [0.35, 0.65], layers: { grime: 0.4, edge: 0.3, frost: 0.5, scratch: 0.3 } }, { snow: 0.9 });
  M.rubber = B.m('uRubber', { pattern: 'rubber', size: 256, tile: 0.8, colors: [0x1a1b1e, 0x2a2b30], params: { scale: 10, tread: 1 }, bump: 3, rough: [0.85, 0.98], layers: { frost: 0.5 } }, { snow: 0.6 });
  M.steelDark = B.m('uSteelD', { pattern: 'plates', size: 256, tile: 2, colors: [0x2c2f3a, 0x22252e, 0x0e1016], params: { cols: 2, rows: 2, seam: 0.008, rivets: 6, brushed: 0.5, panelVar: 0.3 }, bump: 2, metal: 1, rough: [0.35, 0.65], layers: { grime: 0.5, edge: 0.4, scratch: 0.4, frost: 0.5 } }, { snow: 0.8 });
  M.lampG = B.m('uLampG', std({ color: 0x0c1018, emissive: 0xd8e6ff, emissiveIntensity: 5, roughness: 0.4 }));
  M.lampAmber = B.m('uLampA', std({ color: 0x140c04, emissive: 0xffa020, emissiveIntensity: 8, roughness: 0.4 }));
  M.winCool = B.m('uWinCool', windowMaterial(0.11, 'dim')); M.winWarm = B.m('uWinWarm', windowMaterial(0.42, 'warm')); M.winDim = B.m('uWinDim', windowMaterial(0.34, 'dim'));
  M.dark = B.m('uDark', std({ color: 0x030306, roughness: 1 }));
  M.pine = B.m('uPine', std({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  return M;
}
