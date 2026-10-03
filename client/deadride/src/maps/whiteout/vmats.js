// Materials of the BASE VILLAGE: warm timber chalets against deep-blue night snow. All baked on the GPU (real-scale tiles).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { terrainMaterial, snowFrag } from './common.js';
import { windowMaterial } from './snowkit.js';

export function villageMats(B) {
  const M = {};
  M.terrain = terrainMaterial(B, { name: 'vTerrain', frag: { rock: [0.12, 0.13, 0.17], rock2: [0.24, 0.24, 0.27], tint: [0.9, 0.97, 1.1], ice: 0.35, strata: 0.3, snowFx: { sss: [0.02, 0.04, 0.09], bump: 0.9, aniso: 0.8, macro: 1.4 } } });
  M.snow = B.m('vSnow', { pattern: 'snow', size: 512, tile: 3, colors: [0xdbe5f2, 0xf3f7ff, 0xa6b9d3], params: { scale: 5, ripples: 0.12, sparkle: 0.7, direction: 1, crust: 0.2 }, bump: 26, rough: [0.45, 0.72] }, { triplanar: 1 / 3, breakup: 0.5, frag: snowFrag({ sss: [0.02, 0.04, 0.09], bump: 1.0, aniso: 0.8, macro: 1.4 }) });
  M.packed = B.m('vPacked', { pattern: 'snow', size: 1024, tile: 5, colors: [0xc2cee0, 0xe1e9f5, 0x9aacc6], params: { scale: 7, ripples: 0.12, sparkle: 0.6, direction: 0, crust: 0.15 }, bump: 10, rough: [0.42, 0.7], layers: { dust: 0.12 } }, { breakup: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  M.timber = B.m('vTimber', { pattern: 'planks', size: 1024, tile: 2, colors: [0x6a4a2c, 0x3d2914, 0x150d06], params: { rows: 8, gap: 0.004, grain: 9, knots: 0.45, cols: 1, weather: 0.6, nails: 0.6 }, bump: 5, rough: [0.72, 0.95], layers: { grime: 0.35, frost: 0.11, dust: 0.1 } }, { snow: 0.55, breakup: 0.4 });
  M.timberV = B.m('vTimberV', { pattern: 'planks', size: 512, tile: 2, colors: [0x775532, 0x4a321b, 0x1a1108], params: { rows: 10, gap: 0.004, grain: 8, knots: 0.35, cols: 2, vertical: 1, weather: 0.5, nails: 0.5 }, bump: 4, rough: [0.72, 0.95], layers: { grime: 0.3, frost: 0.1 } }, { snow: 0.4, breakup: 0.4 });
  M.log = B.m('vLog', { pattern: 'wood', size: 1024, tile: 1.6, colors: [0x54432f, 0x372a1c, 0x1c140c], params: { scale: 10, rings: 7, knots: 0.5, weather: 0.8, vertical: 0 }, bump: 6, rough: [0.7, 0.95], layers: { grime: 0.45, frost: 0.1, streak: 0.3, edge: 0.25 } }, { snow: 0.5, breakup: 0.4 });
  M.orange = B.m('vOrange', { pattern: 'plates', size: 256, tile: 2, colors: [0xd9651b, 0xb85015, 0x3a1a08], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2 }, bump: 1.2, metal: 0.4, rough: [0.4, 0.7], layers: { grime: 0.4, edge: 0.35, frost: 0.15, scratch: 0.35 } }, { snow: 0.6 });
  M.zinc = B.m('vZinc', { pattern: 'plates', size: 256, tile: 1, colors: [0x9aa2a8, 0x7f878d, 0x3a4046], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.6 }, bump: 1, metal: 1, rough: [0.35, 0.6], layers: { rust: 0.12, grime: 0.4, streak: 0.5, frost: 0.2 } }, { snow: 0.6 });
  M.beam = B.m('vBeam', { pattern: 'wood', size: 512, tile: 1.6, colors: [0x8c6a44, 0x4d331d], params: { scale: 12, rings: 8, knots: 0.35, weather: 0.35, vertical: 0 }, bump: 4, rough: [0.6, 0.88], layers: { grime: 0.2, frost: 0.08 } }, { snow: 0.7 });
  M.stone = B.m('vStone', { pattern: 'stone', size: 512, tile: 2, colors: [0x8a8f96, 0x6d737b, 0x2b2e33, 0xa0a6ad], params: { scale: 5, gap: 0.05, round: 0.3, variation: 0.55, strata: 0.2, lichen: 0.12 }, bump: 14, rough: [0.7, 0.95], layers: { frost: 0.2, grime: 0.3 } }, { snow: 0.9, breakup: 0.5 });
  M.shingle = B.m('vShingle', { pattern: 'scales', size: 512, tile: 1.5, colors: [0x4a3a30, 0x35291f], params: { rows: 9, cols: 7, round: 0.4, variation: 0.6 }, bump: 8, rough: [0.7, 0.95], layers: { grime: 0.4, frost: 0.12 } }, { snow: 1.6, breakup: 0.4 });
  M.slate = B.m('vSlate', { pattern: 'scales', size: 512, tile: 1.0, colors: [0x2f343d, 0x22262d], params: { rows: 14, cols: 10, round: 0.15, variation: 0.5 }, bump: 9, rough: [0.55, 0.85], layers: { grime: 0.08, frost: 0.14 } }, { snow: 1.9, breakup: 0.4 });
  M.plaster = B.m('vPlaster', { pattern: 'noise', size: 512, tile: 2, colors: [0xcfc6b2, 0xb9af9a, 0x8a806c, 0xe6dfcf], params: { scale: 4, contrast: 1.8, fine: 96, speckle: 0.03, pores: 0.3 }, bump: 3, rough: [0.85, 1], layers: { grime: 0.5, streak: 0.55, frost: 0.08 } }, { snow: 0.5, breakup: 0.5 });
  M.steelRed = B.m('vSteelRed', { pattern: 'plates', size: 512, tile: 2, colors: [0xa3241f, 0x8a1c18, 0x2a0f0d], params: { cols: 2, rows: 2, seam: 0.008, rivets: 8, brushed: 0.25, panelVar: 0.3 }, bump: 2, metal: 0.65, rough: [0.38, 0.65], layers: { rust: 0.06, grime: 0.3, edge: 0.3, scratch: 0.3, frost: 0, streak: 0.35 } }, { snow: 1.2 });
  M.steel = B.m('vSteel', { pattern: 'plates', size: 512, tile: 2, colors: [0x5c626a, 0x484d54, 0x1e2226], params: { cols: 2, rows: 2, seam: 0.008, rivets: 8, brushed: 0.5, panelVar: 0.4 }, bump: 2, metal: 1, rough: [0.35, 0.65], layers: { rust: 0.12, grime: 0.5, edge: 0.35, scratch: 0.4, frost: 0.16, streak: 0.4 } }, { snow: 1.0, breakup: 0.4 });
  M.concrete = B.m('vConcrete', { pattern: 'noise', size: 1024, tile: 3, colors: [0x76766f, 0x605f5a, 0x35342f, 0x93918a], params: { scale: 5, contrast: 1.4, fine: 96, speckle: 0.04, pores: 0.3, panels: 3, panelWidth: 0.003 }, bump: 3, rough: [0.8, 0.98], layers: { grime: 0.22, cracks: 0.3, streak: 0.35, frost: 0.08 } }, { snow: 1.4, breakup: 0.6 });
  M.floor = B.m('vFloor', { pattern: 'tiles', size: 512, tile: 3, colors: [0x777b80, 0x666a6f, 0x4d5055], params: { n: 6, grout: 0.008, checker: 0, bevel: 0.004, wear: 0.7, gloss: 0.25, crackle: 0.5 }, bump: 1.4, rough: [0.4, 0.85], layers: { grime: 0.6, wet: 0.5, dust: 0.3, scratch: 0.4 } });
  M.iron = B.m('vIron', std({ color: 0x1a1b1e, metalness: 0.85, roughness: 0.55 }));
  M.rubber = B.m('vRubber', { pattern: 'rubber', size: 512, tile: 0.8, colors: [0x141517, 0x212226], params: { scale: 10, tread: 1 }, bump: 3, rough: [0.85, 0.98] }, { snow: 0.6 });
  M.ice = B.m('vIce', std({ color: 0xcfe6f8, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.72, envMapIntensity: 1.6 }));
  M.iceBlock = B.m('vIceBlock', { pattern: 'ice', size: 512, tile: 2, colors: [0x9cc4de, 0xd7ecf8, 0xffffff], params: { scale: 4, cracks: 0.9, bubbles: 0.5, depth: 0.6 }, bump: 6, rough: [0.06, 0.3], layers: { frost: 0.16 } });
  M.glow = B.m('vGlow', std({ color: 0x1a0d04, emissive: 0xffa550, emissiveIntensity: 3.2, roughness: 0.5 }));
  M.win = B.m('vWin', windowMaterial(1.25));
  M.winHall = B.m('vWinHall', windowMaterial(0.9, 'warm'));
  M.glowWhite = B.m('vGlowW', std({ color: 0x101418, emissive: 0xfff0d8, emissiveIntensity: 2.3, roughness: 0.4 }));
  M.lampGlow = B.m('vLampGlow', std({ color: 0x000000, emissive: 0xffb866, emissiveIntensity: 13, roughness: 0.4 }));
  M.dark = B.m('vDark', std({ color: 0x050403, roughness: 1 }));
  M.paintRed = B.m('vPaintRed', { pattern: 'planks', size: 512, tile: 1.5, colors: [0x8e1f1a, 0x6c1612, 0x2a0c0a], params: { rows: 8, gap: 0.004, grain: 5, knots: 0.15, cols: 1, weather: 0.5, nails: 0 }, bump: 2.5, rough: [0.5, 0.8], layers: { grime: 0.35, frost: 0.1 } }, { snow: 0.5 });
  M.paintGreen = B.m('vPaintGreen', { pattern: 'planks', size: 512, tile: 1.5, colors: [0x2a4a3a, 0x1e3629, 0x0c1912], params: { rows: 8, gap: 0.004, grain: 5, knots: 0.15, cols: 1, weather: 0.5, nails: 0 }, bump: 2.5, rough: [0.5, 0.8], layers: { grime: 0.35, frost: 0.1 } }, { snow: 0.5 });
  M.paintBlue = B.m('vPaintBlue', { pattern: 'planks', size: 512, tile: 1.5, colors: [0x27435f, 0x1a3148, 0x0a1622], params: { rows: 8, gap: 0.004, grain: 5, knots: 0.15, cols: 1, weather: 0.5, nails: 0 }, bump: 2.5, rough: [0.5, 0.8], layers: { grime: 0.35, frost: 0.1 } }, { snow: 0.5 });
  M.rockV = B.m('vRock', { pattern: 'rock', size: 512, tile: 4, colors: [0x24272d, 0x393e46, 0x50565f, 0x6b727d], params: { scale: 5, strata: 7, cracks: 0.9, roughness: 0.8, tone: 0.5, moisture: 0.2 }, bump: 90, rough: [0.65, 0.95], layers: { frost: 0.12 } }, { triplanar: 1 / 4, snow: 1.0 });
  M.fabric = B.m('vFabric', { pattern: 'weave', size: 512, tile: 0.5, colors: [0x9a2c22, 0x7d2018], params: { threads: 80, twill: 1, variation: 0.5, fuzz: 0.6 }, bump: 0.6, rough: [0.85, 1] }, { snow: 0.3 });
  M.pine = B.m('vPine', std({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  return M;
}
