// WHITEOUT -- the dead of the resort: ski patrol, tourists in puffy parkas, instructors, mountain guides, snowboarders, ski tourists and the frozen ones of the
// summit. Seven variants built with the Outfit API (src/game/zombies/README.md). Each is recognisable by SILHOUETTE from 10 m:
//   patrol       red/black jacket, white cross on the back, white helmet with goggles, big rescue pack, radio, avalanche probe
//   tourist      fat quilted parka in a loud colour, pom-pom beanie, thick scarf, moon boots, lift pass
//   instructor   bright bib over a blue jacket, helmet + goggles on the eyes, two ski poles
//   guide        heavy shell with the fur hood UP, rope coil over the chest, big pack, ice axe
//   snowboarder  baggy pants + oversized hoodie, beanie, goggles, the board strapped diagonally on the back
//   tourist_skier retro one-colour ski suit, ski boots, a pair of skis carried over the shoulder, headband
//   frozen       pale frost-crusted parka, hood up, icicles, ice growths, blue-grey skin, glowing ice-blue eyes (the summit's dead)
import * as THREE from 'three';
import { registerVariants } from '../../game/zombies/factory.js';
import { RIG } from '../../game/zombies/rig.js';
import '../../game/zombies/gear.js';

const V3 = THREE.Vector3;
/** hand grip frame (same maths as the built-in held tools): c = grip centre, h = along the hand, p = palm normal, t = thumb side */
const grip = (side) => { const A = RIG.arm[side]; const h = new V3(...A.h), p = new V3(...A.p), t = new V3(...A.t), w = new V3(...A.wr); return { c: w.clone().addScaledVector(h, 0.068).addScaledVector(p, 0.026), h, p, t }; };

/** thick knitted scarf: a band round the neck + a tail down the chest (drawn over the clothed body) */
function scarf(o, color, accent) {
  o.parts.band({ y: 1.5, height: 0.095, thick: 0.03, lift: 0.03, center: [0, 0.028], seg: 26, window: 0.03, tilt: -0.012, mat: 'cloth', pattern: 'knit', color, rough: 0.95, dirt: 0.3 });
  o.parts.strap([[0.075, 1.47, -0.135], [0.09, 1.36, -0.16], [0.085, 1.22, -0.155]], 0.085, 0.022, { mat: 'cloth', pattern: 'knit', color: accent ?? color, rough: 0.95, dirt: 0.3 }, {});
}
/** lift pass on a lanyard: a little plastic card on the chest */
function liftPass(o, color = 0xe8c020) {
  o.parts.custom((o2) => { const p = o2.snap([-0.07, 1.28, 0.02], [0, 0, -1], 0.13); o2._box({ bind: 'auto', p: [p.x, p.y, p.z - 0.004], s: [0.05, 0.075, 0.005], mat: 'plastic', color, wear: 0.3, dirt: 0.3, bevel: 0.002 }); });
}
/** white cross on the back of the jacket (extruded outline snapped onto the cloth) */
function backCross(o, color = 0xf0f0f0, out = 0.146) {          // out = how far behind the jacket surface (0.146 = on the rear face of the rescue pack)
  o.parts.custom((o2) => { const p = o2.snap([0, 1.22, 0.02], [0, 0, 1], 0.12); const c = 0.058, w = 0.02, outline = [[-w, -c], [w, -c], [w, -w], [c, -w], [c, w], [w, w], [w, c], [-w, c], [-w, w], [-c, w], [-c, -w], [-w, -w]];
    o2._extrude({ bind: 'auto', p: [p.x, p.y, p.z + out], outline, depth: 0.006, mat: 'cloth', color, dirt: 0.15 }); });
}
/** a long thin object (ski pole / probe / axe shaft) held in a hand, trailing down-back */
function heldShaft(o, side, len, r, color, mat = 'metal', tipUp = false) {
  const g = grip(side), hb = 'hand.' + side; const ax = g.h.clone().multiplyScalar(0.62).addScaledVector(g.t, tipUp ? 0.78 : -0.78).normalize();
  o.parts.capsuleBetween(g.c.clone().addScaledVector(ax, -0.06), g.c.clone().addScaledVector(ax, len), r, r * 0.8, { mat, color, rough: 0.35, wear: 0.4 }, { bone: hb, rigid: true, seg: 6 });
  return { g, ax };
}
/** ice axe held in the right hand: red shaft, steel pick + adze, spike */
function iceAxe(o, side = 'R') {
  const g = grip(side), hb = 'hand.' + side; const ax = g.h.clone().multiplyScalar(0.72).addScaledVector(g.t, 0.69).normalize();
  const bot = g.c.clone().addScaledVector(ax, -0.1), top = g.c.clone().addScaledVector(ax, 0.6);
  o.parts.capsuleBetween(bot, top, 0.014, 0.014, { mat: 'metal', color: 0xb02818, rough: 0.4, wear: 0.4, dirt: 0.3 }, { bone: hb, rigid: true, seg: 8, rings: 3 });
  o.parts.capsuleBetween(bot.clone().addScaledVector(ax, -0.04), bot.clone().addScaledVector(ax, 0.05), 0.006, 0.014, { mat: 'metal', color: 0x8a9096, rough: 0.3, wear: 0.5 }, { bone: hb, rigid: true, seg: 6 });
  const pd = g.h.clone().addScaledVector(ax, -g.h.dot(ax)); if (pd.lengthSq() < 1e-6) pd.copy(g.p); pd.normalize();
  const eye = top.clone().addScaledVector(ax, -0.015);
  o.parts.box({ bone: hb, p: [eye.x, eye.y, eye.z], s: [0.035, 0.05, 0.035], rot: new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), pd), mat: 'metal', color: 0x9ea4aa, rough: 0.3, wear: 0.5, bevel: 0.004 });
  const tip = eye.clone().addScaledVector(pd, 0.2).addScaledVector(ax, -0.06), mid = eye.clone().addScaledVector(pd, 0.1).addScaledVector(ax, -0.004);
  o.parts.tube([eye, mid, tip], [0.014, 0.01, 0.002], { mat: 'metal', color: 0xa0a6ac, rough: 0.3, wear: 0.6 }, { bone: hb, seg: 6, sub: 2 });
  const adz = eye.clone().addScaledVector(pd, -0.085); o.parts.box({ bone: hb, p: [adz.x, adz.y, adz.z], s: [0.07, 0.008, 0.045], rot: new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), pd), mat: 'metal', color: 0x9ea4aa, rough: 0.3, wear: 0.5, bevel: 0.002 });
  o.info.tools.push({ kind: 'pickaxe', hand: side });
}
/** climbing rope coiled diagonally over the chest (bandolier of loops) */
function ropeCoil(o, color, color2) {
  for (let i = 0; i < 4; i++) o.parts.torusRing({ bone: 'chest', p: [0.0 + i * 0.006, 1.27 + i * 0.006, 0.014], R: 0.235 + i * 0.002, r: 0.0135, rot: [0.3, 0, -0.62], scale: [1, 1.08], seg: 26, tseg: 6, mat: 'rope', color: i % 2 ? color2 : color, rough: 0.9, dirt: 0.4, wear: 0.4 });
}
/** two skis over the right shoulder (nose forward and up), with bindings */
function skisOnShoulder(o, cols) {
  for (let i = 0; i < 2; i++) { const dx = -0.045 + i * 0.09; o.parts.box({ bone: 'chest', weights: { chest: 0.7, spine2: 0.3 }, p: [0.15 + dx * 0.5, 1.56 + i * 0.004, 0.14], s: [0.075, 0.016, 1.62], rot: [-0.36, -0.05 + i * 0.04, 0.08], mat: 'paint', color: cols[i], rough: 0.3, wear: 0.15, dirt: 0.15, bevel: 0.004 });
    o.parts.box({ bone: 'chest', p: [0.15 + dx * 0.5, 1.578, 0.13], s: [0.06, 0.034, 0.15], rot: [-0.36, -0.05 + i * 0.04, 0.08], mat: 'plastic', color: 0x14141a, rough: 0.5, bevel: 0.006 }); }
}
/** snowboard strapped diagonally across the back */
function boardOnBack(o, color, color2) {
  o.parts.box({ bone: 'chest', weights: { chest: 0.6, spine2: 0.4 }, p: [0.03, 1.26, 0.155], s: [0.27, 1.5, 0.024], rot: [0, 0, 0.42], mat: 'plastic', color, rough: 0.3, wear: 0.4, dirt: 0.3, bevel: 0.008 });
  o.parts.box({ bone: 'chest', weights: { chest: 0.6, spine2: 0.4 }, p: [0.03, 1.26, 0.168], s: [0.2, 1.1, 0.006], rot: [0, 0, 0.42], mat: 'plastic', color: color2, rough: 0.3, wear: 0.4, bevel: 0.002 });
  for (const sx of [-1, 1]) o.parts.strap([[sx * 0.11, 1.4, 0.115], [sx * 0.12, 1.3, 0.16], [sx * 0.11, 1.2, 0.115], [sx * 0.11, 1.28, -0.11], [sx * 0.11, 1.4, -0.105]], 0.035, 0.005, { mat: 'cloth', pattern: 'weave', color: 0x1c1c1c, rough: 0.9 }, {});
}

export const WHITEOUT_VARIANTS = [
  {
    id: 'patrol', name: 'Ski Patroller', looks: 2, height: [1.68, 1.92], hp: 1.15,
    body: { gaunt: 0.25, girthRange: [1.0, 1.1] }, skin: { tint: [0.9, 0.95, 1.08], variation: 0.1 },
    layers: { frost: 0.55, blood: 0.55 }, eyes: { cataract: 0.9 }, hair: { color: 0x3a2a1c, amount: 0.7, beard: 0.6 },
    speedClasses: { walk: 0.9, run: 1.2, sprint: 0.9 }, breath: true, helmetY: 1.71, helmetSurface: 'plastic',
    voice: { f0: 96, formants: [580, 1100, 2500], rasp: 0.55, wet: 0.2, muffle: 0.15, kind: 'male' },
    idiosyncrasy: { limpChance: 0.2, limp: [0.3, 0.6], hunch: [0.05, 0.25], tilt: 0.3 }, arms: { reach: 0.5 },
    build(o, rng, look) {
      o.body({ skin: 0x6c7278, girth: 1.03, face: { gaunt: 0.45 } });
      const red = look ? 0xae1a14 : 0xc8321c;
      o.garment('pants', { color: 0x15171c, pattern: 'ripstop', offset: 0.024, loose: 0.014, dirt: 0.35, wear: 0.35, detail: 8 | 16, frost: 0.7 });
      o.garment('jacket', { color: red, pattern: 'ripstop', offset: 0.032, loose: 0.014, wear: 0.4, dirt: 0.35, collar: 'stand', collarHeight: 0.07, detail: 1 | 2 | 4 | 32, frost: 0.9 });
      o.garment('boots', { color: 0x22242a, mat: 'rubber', height: 5, offset: 0.02, loose: 0.016 });
      o.garment('gloves', { color: 0x121212, mat: 'leather' });
      o.hardHat({ color: look ? 0xe6e2da : 0xf2f0ea, wear: 0.35 }); o.goggles({ on: 'helmet', lens: 0xd08a30 });
      o.backpack({ color: look ? 0x9a1812 : 0xb02618 }); backCross(o);
      o.parts.box({ bone: 'chest', p: [-0.115, 1.31, -0.16], s: [0.048, 0.1, 0.034], mat: 'plastic', color: 0x1a1a1c, rough: 0.5, bevel: 0.006 });                      // radio
      o.parts.capsuleBetween(new V3(-0.115, 1.36, -0.16), new V3(-0.11, 1.52, -0.15), 0.004, 0.003, { mat: 'rubber', color: 0x101010 }, { bone: 'chest', rigid: true, seg: 5 });     // its antenna
      heldShaft(o, 'R', 2.1, 0.008, 0xff6a10, 'metal', true);                                                                                                                       // avalanche probe
      o.info.tools.push({ kind: 'pickaxe', hand: 'R' });
      o.icicles({ points: [['head', 0.03, 1.535, -0.09], ['chest', 0.1, 1.42, -0.13], ['head', -0.04, 1.53, -0.088]] });
    },
  },
  {
    id: 'tourist', name: 'Puffy Tourist', looks: 2, height: [1.58, 1.84], hp: 0.95,
    body: { gaunt: 0.2, girthRange: [1.02, 1.16] }, skin: { tint: [0.92, 0.96, 1.08], variation: 0.08 },
    layers: { frost: 0.6, blood: 0.4 }, eyes: { cataract: 0.95 }, hair: { color: 0x3a2a1c, amount: 0.8, beard: 0.2 },
    speedClasses: { walk: 1.3, run: 0.9, sprint: 0.5 }, breath: true, arms: { reach: 0.45 },
    voice: { f0: 118, formants: [640, 1250, 2650], rasp: 0.4, wet: 0.25, muffle: 0.1, kind: 'male' },
    idiosyncrasy: { limpChance: 0.3, limp: [0.3, 0.7], hunch: [0.08, 0.3], tilt: 0.35, armHangChance: 0.2 },
    build(o, rng, look) {
      o.body({ skin: 0x707880, girth: 1.06, belly: 0.3, gaunt: 0.2, face: { gaunt: 0.4, bloat: 0.15 } });
      const parka = look ? 0x14a4ac : 0xd02c78, trim = look ? 0xe86a1c : 0xe8c020;
      o.garment('pants', { color: look ? 0x1c2a44 : 0x2a2030, pattern: 'ripstop', offset: 0.03, loose: 0.02, dirt: 0.3, wear: 0.3, frost: 0.8 });
      o.garment('jacket', { color: parka, pattern: 'quilt', puff: { period: 0.105, depth: 0.026, bulge: 0.02 }, offset: 0.04, loose: 0.014, dirt: 0.3, wear: 0.35, frost: 1, collar: 'stand', collarHeight: 0.08 });
      o.garment('wellies', { color: 0x1c1e22, offset: 0.024, loose: 0.026, dirt: 0.3 });
      o.garment('mittens', { color: look ? 0xe86a1c : 0x1a1a1a, dirt: 0.2 });
      o.hood({ color: parka, fur: 0xd8cfc0, up: false, pattern: 'quilt' });
      o.beanie({ color: trim, pompom: look ? 0xf4f0e6 : 0xc82828, fold: true }); scarf(o, look ? 0xf0ece0 : 0x2a58b0, look ? 0xe86a1c : 0xe8c020);
      liftPass(o, look ? 0xe86a1c : 0x2a9adc);
      if (!look) o.goggles({ on: 'forehead', lens: 0x8a5a20, frame: 0xe0e0e0, strap: 0x303848 });
      o.icicles({ points: [['chest', 0.09, 1.43, -0.14], ['chest', -0.1, 1.42, -0.13], ['head', 0.02, 1.515, -0.08]] });
    },
  },
  {
    id: 'instructor', name: 'Ski Instructor', looks: 2, height: [1.72, 1.94], hp: 1.0,
    body: { gaunt: 0.3, girthRange: [0.96, 1.06] }, skin: { tint: [0.94, 0.97, 1.06], variation: 0.1 },
    layers: { frost: 0.6, blood: 0.5 }, eyes: { cataract: 0.85 }, hair: { color: 0x2a2218, amount: 0.6, beard: 0.35 },
    speedClasses: { walk: 0.8, run: 1.4, sprint: 1.1 }, breath: true, helmetY: 1.71, helmetSurface: 'plastic', arms: { reach: 0.55 },
    voice: { f0: 108, formants: [610, 1180, 2600], rasp: 0.5, wet: 0.2, muffle: 0.12, kind: 'male' },
    idiosyncrasy: { limpChance: 0.15, hunch: [0.02, 0.2], tilt: 0.3 },
    build(o, rng, look) {
      o.body({ skin: 0x6e747c, girth: 0.98, gaunt: 0.3, face: { gaunt: 0.55 } });
      const jack = look ? 0x1a3a7a : 0x2a6a4a, bib = look ? 0xff7a10 : 0xf0e020;
      o.garment('pants', { color: 0x14161c, pattern: 'ripstop', offset: 0.022, loose: 0.012, dirt: 0.3, wear: 0.3, detail: 8, frost: 0.7 });
      o.garment('jacket', { color: jack, pattern: 'ripstop', offset: 0.026, loose: 0.012, dirt: 0.3, wear: 0.3, collar: 'stand', collarHeight: 0.07, detail: 1 | 4 | 32, frost: 0.9 });
      o.garment('vest', { color: bib, pattern: 'hivis', offset: 0.05, loose: 0.01, dirt: 0.35, wear: 0.3, layer: 5, frost: 0.8 });
      o.garment('boots', { color: 0x20222a, mat: 'plastic', height: 4, offset: 0.024, loose: 0.01 });
      o.garment('gloves', { color: 0x141414, mat: 'leather' });
      o.hardHat({ color: look ? 0xe8e8ee : 0x1a1c20, wear: 0.3 }); o.goggles({ on: 'eyes', lens: 0xe0a030, frame: 0x1a1a1a });
      o.skiPoles({ color: look ? 0xd02818 : 0x9aa0a8 });
      o.parts.custom((o2) => { const p = o2.snap([0, 1.26, 0.02], [0, 0, 1], 0.14); o2._box({ bind: 'auto', p: [p.x, p.y, p.z + 0.004], s: [0.16, 0.12, 0.006], mat: 'cloth', color: 0xf4f0e6, dirt: 0.4, wear: 0.4 }); });      // school crest on the bib's back
      o.icicles({ points: [['head', 0.03, 1.535, -0.09], ['chest', 0.1, 1.42, -0.13]] });
    },
  },
  {
    id: 'guide', name: 'Mountain Guide', looks: 2, height: [1.72, 1.94], hp: 1.3,
    body: { gaunt: 0.35, girthRange: [1.06, 1.18] }, skin: { tint: [0.9, 0.94, 1.04], variation: 0.1 },
    layers: { frost: 0.8, blood: 0.5 }, eyes: { cataract: 0.8 }, hair: { color: 0x2a2018, amount: 0.7, beard: 1.0 },
    speedClasses: { walk: 1.2, run: 0.9, sprint: 0.4 }, breath: true, arms: { reach: 0.4 },
    voice: { f0: 84, formants: [540, 1000, 2350], rasp: 0.8, wet: 0.25, muffle: 0.3, kind: 'male' },
    idiosyncrasy: { limpChance: 0.3, limp: [0.3, 0.6], hunch: [0.15, 0.4], tilt: 0.3 },
    build(o, rng, look) {
      o.body({ skin: 0x6a7076, girth: 1.12, belly: 0.3, muscle: 0.6, gaunt: 0.3, face: { gaunt: 0.5 } });
      const shell = look ? 0x2a3a52 : 0x3a4238;
      o.garment('pants', { color: look ? 0x1c1e26 : 0x2a2c26, pattern: 'canvas', offset: 0.03, loose: 0.02, dirt: 0.5, wear: 0.5, frost: 0.9 });
      o.garment('jacket', { color: shell, pattern: 'ripstop', offset: 0.05, loose: 0.02, dirt: 0.45, wear: 0.5, collar: 'stand', collarHeight: 0.09, detail: 1 | 2 | 4 | 32, frost: 1 });
      o.garment('boots', { color: 0x2a2018, mat: 'leather', height: 5, offset: 0.026, loose: 0.02, dirt: 0.6 });
      o.garment('mittens', { color: 0x3a2a1a, dirt: 0.5 });
      o.hood({ color: shell, fur: 0xa89878, up: true, pattern: 'ripstop' });
      ropeCoil(o, look ? 0xd85a1c : 0x2a7ac8, 0xe8e4d8); o.backpack({ color: look ? 0x6a2a18 : 0x2e4a2e }); iceAxe(o, 'R');
      o.parts.custom((o2) => { const p = o2.snap([0.12, 0.98, 0.02], [0.9, 0, -0.1], 0.2); o2._box({ bind: 'auto', p: [p.x + 0.01, p.y, p.z], s: [0.03, 0.09, 0.05], mat: 'metal', color: 0x9aa0a6, rough: 0.3, wear: 0.5, bevel: 0.004 }); });      // carabiner rack on the hip
      o.icicles({ points: [['head', 0.03, 1.54, -0.1], ['head', -0.05, 1.53, -0.09], ['chest', 0.1, 1.44, -0.14], ['chest', -0.1, 1.44, -0.13]] });
    },
  },
  {
    id: 'snowboarder', name: 'Snowboarder', looks: 2, height: [1.64, 1.88], hp: 0.85,
    body: { gaunt: 0.4, girthRange: [0.9, 1.0] }, skin: { tint: [0.94, 0.98, 1.06], variation: 0.12 },
    layers: { frost: 0.5, blood: 0.5 }, eyes: { cataract: 0.7 }, hair: { color: 0x5a3a20, amount: 0.9, beard: 0.15 },
    speedClasses: { walk: 0.6, run: 1.3, sprint: 1.6 }, breath: true, arms: { reach: 0.6 },
    voice: { f0: 128, formants: [660, 1300, 2750], rasp: 0.5, wet: 0.3, muffle: 0.05, kind: 'male' },
    idiosyncrasy: { limpChance: 0.1, hunch: [0.1, 0.4], tilt: 0.5, armHangChance: 0.3 },
    build(o, rng, look) {
      o.body({ skin: 0x707880, girth: 0.94, gaunt: 0.4, face: { gaunt: 0.6 } });
      const hood = look ? 0x6a2a8a : 0x2a8a5a, board = look ? 0xe8402a : 0x18a0d8;
      o.garment('pants', { color: look ? 0x2a2a2e : 0x3a4a3a, pattern: 'canvas', offset: 0.05, loose: 0.03, dirt: 0.45, wear: 0.5, frost: 0.8 });
      o.garment('jacket', { color: hood, pattern: 'fleece', offset: 0.05, loose: 0.026, dirt: 0.4, wear: 0.4, collar: 'stand', collarHeight: 0.06, frost: 0.9 });
      o.garment('boots', { color: 0x1c1c20, mat: 'rubber', height: 5, offset: 0.024, loose: 0.02 });
      o.garment('gloves', { color: 0x1a1a1a, mat: 'leather' });
      o.hood({ color: hood, up: false, pattern: 'fleece' });
      o.beanie({ color: look ? 0x1a1a1a : 0xe8e2d0, fold: true, pompom: false }); o.goggles({ on: 'forehead', lens: look ? 0xd04a30 : 0x40a8e0, frame: 0x1a1a1a, strap: 0x2a2a2a });
      boardOnBack(o, board, look ? 0xf0e8d0 : 0x1a1a1e);
      o.icicles({ points: [['head', 0.03, 1.52, -0.09], ['chest', -0.1, 1.42, -0.13]] });
    },
  },
  {
    id: 'tourist_skier', name: 'Ski Tourist', looks: 2, height: [1.62, 1.86], hp: 1.0,
    body: { gaunt: 0.3, girthRange: [1.0, 1.1] }, skin: { tint: [0.94, 0.97, 1.05], variation: 0.1 },
    layers: { frost: 0.55, blood: 0.45 }, eyes: { cataract: 0.9 }, hair: { color: 0x4a3a28, amount: 0.7, beard: 0.4 },
    speedClasses: { walk: 1.4, run: 0.8, sprint: 0.3 }, breath: true, arms: { reach: 0.35 },
    voice: { f0: 112, formants: [620, 1200, 2600], rasp: 0.45, wet: 0.25, muffle: 0.1, kind: 'male' },
    idiosyncrasy: { limpChance: 0.55, limp: [0.25, 0.55], dragChance: 0.25, hunch: [0.05, 0.25], tilt: 0.4, armHangChance: 0.4 },     // stiff ski-boot shuffle
    build(o, rng, look) {
      o.body({ skin: 0x707880, girth: 1.04, belly: 0.15, gaunt: 0.3, face: { gaunt: 0.5 } });
      const suit = look ? 0x18a8a0 : 0xd8282a, second = look ? 0x8a2a9a : 0xf0e8d8;
      o.garment('coveralls', { color: suit, pattern: 'ripstop', offset: 0.032, loose: 0.016, dirt: 0.35, wear: 0.4, collar: 'stand', collarHeight: 0.07, detail: 1 | 2 | 4 | 32, frost: 0.9 });
      o.garment('boots', { color: 0x1a1a22, mat: 'plastic', height: 3, offset: 0.03, loose: 0.006, dirt: 0.4 });
      o.garment('gloves', { color: 0x1c1c1c, mat: 'leather' });
      o.parts.band({ y: 1.2, height: 0.09, thick: 0.006, lift: 0.036, center: [0, 0.01], seg: 30, mat: 'cloth', pattern: 'stripes', color: second, rough: 0.7, dirt: 0.3 });   // chest stripe (retro suit)
      o.beanie({ color: second, fold: true, pompom: false }); o.goggles({ on: 'forehead', lens: 0x60a0d0, frame: 0xd8d8d8, strap: 0x303030 });
      skisOnShoulder(o, look ? [0x1a6ad0, 0xf0f0f0] : [0xd8282a, 0x1a1a1a]);
      o.icicles({ points: [['head', 0.03, 1.52, -0.09], ['chest', 0.1, 1.42, -0.13], ['chest', -0.09, 1.42, -0.13]] });
    },
  },
  {
    id: 'frozen', name: 'Frozen One', looks: 2, height: [1.66, 1.92], hp: 1.45,
    body: { gaunt: 0.6, girthRange: [1.0, 1.12] }, skin: { tint: [0.82, 0.92, 1.1], variation: 0.06 },
    layers: { frost: 1, blood: 0.25 }, eyes: { glow: 1.8, color: 0x8fd8ff, cataract: 0.4 }, hair: { color: 0xc8d0d8, amount: 0.6, beard: 0.5 },
    speedClasses: { walk: 1.6, run: 0.6, sprint: 0.1 }, breath: true, arms: { reach: 0.3 }, emissiveColor: 0x9fdcff,
    voice: { f0: 72, formants: [500, 1000, 2400], rasp: 0.7, wet: 0.1, muffle: 0.45, kind: 'male' },
    idiosyncrasy: { limpChance: 0.5, limp: [0.4, 0.9], dragChance: 0.4, hunch: [0.2, 0.5], tilt: 0.45, armHangChance: 0.5 },
    build(o, rng, look) {
      o.body({ skin: 0x8fa0b0, gaunt: 0.6, decay: 0.15, face: { gaunt: 0.85 } });
      const shell = look ? 0x7a8aa2 : 0x5e6c82;
      o.garment('pants', { color: look ? 0x5a6678 : 0x46505f, pattern: 'ripstop', offset: 0.034, loose: 0.02, dirt: 0.2, wear: 0.6, frost: 1 });
      o.garment('jacket', { color: shell, pattern: 'quilt', puff: { period: 0.11, depth: 0.026, bulge: 0.02 }, offset: 0.044, loose: 0.016, dirt: 0.25, wear: 0.6, frost: 1, collar: 'stand', collarHeight: 0.08 });
      o.garment('boots', { color: 0x4a5058, mat: 'rubber', height: 5, offset: 0.028, loose: 0.02, frost: 1 });
      o.garment('mittens', { color: 0x6a7686, frost: 1 });
      o.hood({ color: shell, fur: 0xe4ecf2, up: true, pattern: 'quilt' });
      if (look) scarf(o, 0xc8d0da, 0xc8d0da);
      o.crystals({ color: 0xbfe6ff, emissive: 1.8, spots: [['chest', 0.11, 1.4, 0.1, 0.4, 0.7, 0.6], ['upperarm.L', -0.27, 1.32, 0.03, -0.8, 0.5, 0.2], ['chest', -0.06, 1.3, 0.14, -0.2, 0.4, 0.9]] });
      o.icicles({ points: [['head', 0.03, 1.545, -0.1], ['head', -0.05, 1.54, -0.095], ['head', 0.0, 1.55, -0.105], ['chest', 0.1, 1.44, -0.14], ['chest', -0.1, 1.44, -0.13], ['chest', 0.0, 1.45, -0.15], ['upperarm.R', 0.26, 1.33, -0.02], ['upperarm.L', -0.26, 1.33, -0.02]] });
    },
  },
];
registerVariants('whiteout', WHITEOUT_VARIANTS, { aliases: { frost_tourist: 'tourist', ski_patrol: 'patrol' } });
