// Materials of the MID-MOUNTAIN STATION: wind-scoured board-formed concrete, signal-grey painted steel, frosted glass, hazard stripes,
// galvanised avalanche barriers, rime on everything. Palette: cold green-white (emergency fluorescents), red for patrol.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { terrainMaterial, snowFrag } from './common.js';
import { windowMaterial } from './snowkit.js';

export function stationMats(B) {
  const M = {};
  M.terrain = terrainMaterial(B, { name: 'sTerrain', frag: { rock: [0.12, 0.15, 0.14], rock2: [0.25, 0.29, 0.27], tint: [0.9, 1.0, 0.97], ice: 0.55, strata: 0.7, snowFx: { sss: [0.02, 0.05, 0.04], bump: 0.55, scale: 1.1 } } });
  M.snow = B.m('sSnow', { pattern: 'snow', size: 512, tile: 3, colors: [0xdbe7e3, 0xf0f7f4, 0xaec4bd], params: { scale: 5, ripples: 0.35, sparkle: 0.7, direction: 0, crust: 0.6 }, bump: 45, rough: [0.5, 0.78] }, { triplanar: 1 / 3, breakup: 0.5, frag: snowFrag({ sss: [0.02, 0.05, 0.04], bump: 0.55, scale: 1.1 }) });
  M.concrete = B.m('sConcrete', { pattern: 'noise', size: 1024, tile: 3, colors: [0x8a9590, 0x737e79, 0x3c4541, 0xa5b0ab], params: { scale: 5, contrast: 1.3, fine: 128, speckle: 0.05, pores: 0.35, panels: 3, panelWidth: 0.004 }, bump: 4, rough: [0.78, 0.98], layers: { grime: 0.1, cracks: 0.2, streak: 0.4, frost: 0 } }, { snow: 0.8, breakup: 0.6 });
  M.concreteDark = B.m('sConcreteD', { pattern: 'noise', size: 512, tile: 3, colors: [0x515a56, 0x424a47, 0x232927, 0x6a7570], params: { scale: 5, contrast: 1.4, fine: 96, speckle: 0.04, pores: 0.3, panels: 2, panelWidth: 0.004 }, bump: 4, rough: [0.8, 0.98], layers: { grime: 0.15, cracks: 0.2, streak: 0.4, frost: 0 } }, { snow: 0.5, breakup: 0.6 });
  M.steel = B.m('sSteel', { pattern: 'plates', size: 512, tile: 2, colors: [0x62766d, 0x52625b, 0x1f2824], params: { cols: 2, rows: 2, seam: 0.008, rivets: 8, brushed: 0.3, panelVar: 0.4, bolts: 1 }, bump: 2, metal: 0.85, rough: [0.38, 0.7], layers: { rust: 0.1, grime: 0.2, edge: 0.4, scratch: 0.35, frost: 0.07, streak: 0.5 } }, { snow: 1.0, breakup: 0.4 });
  M.steelDark = B.m('sSteelD', { pattern: 'plates', size: 512, tile: 2, colors: [0x2f3733, 0x252b28, 0x101412], params: { cols: 2, rows: 2, seam: 0.008, rivets: 6, brushed: 0.5, panelVar: 0.3 }, bump: 2, metal: 1, rough: [0.35, 0.65], layers: { rust: 0.2, grime: 0.5, edge: 0.4, scratch: 0.4, frost: 0.25, streak: 0.4 } }, { snow: 0.8 });
  M.galv = B.m('sGalv', { pattern: 'plates', size: 512, tile: 2, colors: [0xa7b0b2, 0x939da0, 0x545c5e], params: { cols: 1, rows: 2, seam: 0.006, rivets: 0, brushed: 0.7, panelVar: 0.5 }, bump: 1.5, metal: 1, rough: [0.4, 0.75], layers: { rust: 0.25, grime: 0.35, frost: 0.25, scratch: 0.4 } }, { snow: 1.2 });
  M.corr = B.m('sCorr', { pattern: 'corrugated', size: 512, tile: 2, colors: [0xa8b8b0, 0x8fa097], params: { ribs: 12, depth: 1, vertical: 1, dents: 1.2 }, bump: 26, metal: 0.8, rough: [0.45, 0.8], layers: { rust: 0.22, streak: 0.6, grime: 0.5, frost: 0.25 } }, { snow: 0.6, breakup: 0.5 });
  M.hazard = B.m('sHazard', { pattern: 'hazard', size: 256, tile: 1, colors: [0xd9b520, 0x1a1c1b, 0x3f3b30], params: { n: 6, angle: 0, wear: 0.7 }, bump: 1, rough: [0.5, 0.9], layers: { frost: 0.2, grime: 0.3 } }, { snow: 0.4 });
  M.red = B.m('sRed', { pattern: 'plates', size: 512, tile: 2, colors: [0xb02a22, 0x8f201a, 0x2c0e0c], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.25 }, bump: 1.2, metal: 0.4, rough: [0.4, 0.7], layers: { grime: 0.4, edge: 0.3, frost: 0.2, scratch: 0.3 } }, { snow: 0.6 });
  M.orange = B.m('sOrange', { pattern: 'plates', size: 512, tile: 2, colors: [0xd9651b, 0xb85015, 0x3a1a08], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2 }, bump: 1.2, metal: 0.5, rough: [0.35, 0.65], layers: { grime: 0.45, edge: 0.35, frost: 0.23, scratch: 0.35 } }, { snow: 0.8 });
  M.timber = B.m('sTimber', { pattern: 'planks', size: 512, tile: 2, colors: [0x6c5a44, 0x463829, 0x1a140e], params: { rows: 9, gap: 0.005, grain: 8, knots: 0.4, cols: 2, weather: 0.35, nails: 0.8 }, bump: 5, rough: [0.75, 0.96], layers: { grime: 0.4, frost: 0.3, dust: 0.1 } }, { snow: 0.7, breakup: 0.4 });
  M.grating = B.m('sGrating', { pattern: 'diamond', size: 512, tile: 1, colors: [0x7a8580, 0x626c68], params: { n: 10, height: 1, wear: 0.5 }, bump: 3, metal: 1, rough: [0.4, 0.7], layers: { scratch: 0.5, grime: 0.4, frost: 0.25, wet: 0.2 } });
  M.floor = B.m('sFloor', { pattern: 'tiles', size: 1024, tile: 3, colors: [0x84908b, 0x738079, 0x4a5450], params: { n: 3, grout: 0.014, checker: 0, bevel: 0.006, wear: 0.8, gloss: 0.45, crackle: 0.55 }, bump: 2.5, rough: [0.32, 0.8], layers: { grime: 0.3, wet: 0.5, dust: 0.2, scratch: 0.5, streak: 0.4 } });
  M.rubber = B.m('sRubber', { pattern: 'rubber', size: 512, tile: 0.8, colors: [0x141816, 0x202522], params: { scale: 10, tread: 1 }, bump: 3, rough: [0.85, 0.98], layers: { frost: 0.15 } }, { snow: 0.5 });
  M.iron = B.m('sIron', std({ color: 0x1c201e, metalness: 0.85, roughness: 0.55 }));
  M.wire = B.m('sWire', std({ color: 0x2b302e, metalness: 0.9, roughness: 0.45 }));
  M.ice = B.m('sIce', std({ color: 0xcfe9e4, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.7, envMapIntensity: 1.5 }));
  M.iceBlock = B.m('sIceBlock', { pattern: 'ice', size: 512, tile: 2, colors: [0x8fb8b0, 0xd0ece6, 0xffffff], params: { scale: 4, cracks: 1.0, bubbles: 0.5, depth: 0.7 }, bump: 8, rough: [0.05, 0.3], layers: { frost: 0.25 } });
  M.rime = B.m('sRime', { pattern: 'ice', size: 512, tile: 1.5, colors: [0xe4f2ee, 0xf6fbf9, 0xcfe0da], params: { scale: 6, cracks: 0.2, bubbles: 0.9, depth: 0.5 }, bump: 14, rough: [0.4, 0.85], layers: { sparkle: 0.7 } });
  M.glassFrost = B.m('sGlassF', std({ color: 0xa8c6bd, roughness: 0.32, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }));
  M.glassLit = B.m('sGlassLit', std({ color: 0x1a2622, emissive: 0xd8ffe6, emissiveIntensity: 2.6, roughness: 0.4 }));
  M.winCool = B.m('sWin', windowMaterial(0.22, 'cool'));
  M.glassWarm = B.m('sGlassWarm', std({ color: 0x1c1610, emissive: 0xffd9a0, emissiveIntensity: 2.8, roughness: 0.4 }));
  M.lampG = B.m('sLampG', std({ color: 0x0c1410, emissive: 0xe4fff1, emissiveIntensity: 6, roughness: 0.4 }));
  M.lampR = B.m('sLampR', std({ color: 0x140606, emissive: 0xff2c1c, emissiveIntensity: 8, roughness: 0.4 }));
  M.lampAmber = B.m('sLampA', std({ color: 0x140c04, emissive: 0xffa020, emissiveIntensity: 8, roughness: 0.4 }));
  M.exit = B.m('sExit', std({ color: 0x03150a, emissive: 0x20ff70, emissiveIntensity: 3, roughness: 0.5 }));
  M.dark = B.m('sDark', std({ color: 0x040605, roughness: 1 }));
  M.chairPaint = B.m('sChair', { pattern: 'plates', size: 256, tile: 1, colors: [0xc23a24, 0xa02c1a, 0x2a0d08], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2 }, bump: 1, metal: 0.4, rough: [0.4, 0.7], layers: { grime: 0.5, frost: 0.28, scratch: 0.3 } }, { snow: 1.0 });
  M.pine = B.m('sPine', std({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  M.rockS = B.m('sRock', { pattern: 'rock', size: 512, tile: 4, colors: [0x1f2523, 0x343c39, 0x4a5350, 0x687270], params: { scale: 5, strata: 8, cracks: 0.9, roughness: 0.8, tone: 0.5, moisture: 0.2 }, bump: 90, rough: [0.65, 0.95], layers: { frost: 0.23 } }, { triplanar: 1 / 4, snow: 0.8 });
  return M;
}
