// SHAFT NINE — the dead miners. Seven variants built with the outfit API (see ../README.md).
import { registerVariants } from '../factory.js';
import '../gear.js';

const pick = (rng, arr) => arr[(rng() * arr.length) | 0];
// shared base: work shirt + canvas trousers + hobnail boots + belt (+ knee pads)
function minerBase(o, rng, look, { jacket = true, shirt = 0x5a4a36, trousers = 0x1c1b19, jacketCol = 0x1c2230, dirt = 0.75 } = {}) {
  o.garment('shirt', { color: shirt, pattern: 'weave', dirt, wear: 0.55, sleeve: jacket ? 6 : 4 + ((rng() * 2) | 0) });
  o.garment('pants', { color: trousers, pattern: 'canvas', dirt: dirt + 0.1, wear: 0.6 });
  if (jacket) o.garment('jacket', { color: jacketCol, pattern: 'canvas', dirt, wear: 0.6, loose: 0.02 });
  o.garment('boots', { color: 0x2a1e14, dirt: 0.85, wear: 0.7, height: 6 });
  o.belt({ y: 0.99, color: 0x24190f });
  if (rng() < 0.7) o.kneePads({ color: 0x1e1b18 });
}

export const SHAFT_NINE_VARIANTS = [
  {
    id: 'miner_lamp', name: 'Lamp Miner', looks: 2, height: [1.64, 1.86], hp: 1,
    body: { gaunt: 0.55, girthRange: [0.92, 1.04] }, skin: { tint: [0.95, 0.99, 1.0], variation: 0.12 },
    layers: { dust: 0.45, blood: 0.55 }, eyes: { glow: 0.0, cataract: 0.85 }, hair: { color: 0x1c1712, amount: 0.8, beard: 0.7 },
    facial: { moustache: 0.7, sideburns: 0.3, age: [0.3, 0.8], cheekWound: 0.15 }, wounds: [{ type: 'bite', at: 'neck', r: 0.045 }, { type: 'gash', at: 'forearm', r: 0.04, chance: 0.5 }], gearDrop: { hat: 0.2 },
    speedClasses: { walk: 1, run: 1, sprint: 0.8 }, voice: { f0: 92, formants: [560, 1050, 2450], rasp: 0.6, wet: 0.35, muffle: 0, kind: 'male' },
    lamp: { color: 0xffe2b6, intensity: 32, range: 18 }, emissiveColor: 0xffe2b6, helmetY: 1.69, helmetSurface: 'plastic',
    build(o, rng, look) {
      o.body({ skin: 0x8a9684, girth: look ? 1.05 : 0.97, gaunt: look ? 0.35 : 0.55, muscle: look ? 0.8 : 0.45, fat: look ? 0.15 : 0, // look 1: stocky, heavy-muscled hewer build
         face: { gaunt: 0.8, jaw: 1.1, brow: 1.3, nose: 1.15, cheek: 0.9 } });
      minerBase(o, rng, look, { jacketCol: look ? 0x1e2a22 : 0x1a2233 });
      o.minerHelmet({ color: look ? 0x3a3530 : 0x1e1e1e, wear: 0.6, lamp: { lensColor: 0xfff0d0, emissive: 10 } });
      o.hairShell({ color: 0x1c1712, length: 0.02, messy: 0.8 });
      o.tatters({ color: look ? 0x1e2a22 : 0x1a2233, y: 0.9, count: 4, length: 0.14 });
      o.neckerchief({ color: look ? 0x8a1a12 : 0x1a3a7a });
      if (rng() < 0.5) o.garment('gloves', { color: 0x3a2a1a, mat: 'leather', dirt: 0.8 });
    },
  },
  {
    id: 'miner_foreman', name: 'Foreman', looks: 2, height: [1.72, 1.92], hp: 1.25,
    body: { gaunt: 0.2, girthRange: [1.05, 1.16] }, skin: { tint: [1.0, 0.97, 0.95] },
    layers: { dust: 0.3, blood: 0.65 }, eyes: { glow: 0.0, cataract: 0.6 }, hair: { color: 0x2a221c, amount: 0.6, beard: 1.0, hairline: 0.6 },
    facial: { moustache: 0.95, sideburns: 0.8, age: [0.7, 1.0], cheekWound: 0.1 }, wounds: [{ type: 'open', at: 'chest', r: 0.075, side: -1 }, { type: 'bandage', at: 'forearm', r: 0.05, chance: 0.6 }], gearDrop: { hat: 0.25 }, jawOpen: [0.14, 0.3],
    speedClasses: { walk: 1.3, run: 0.8, sprint: 0.3 }, voice: { f0: 82, formants: [520, 980, 2300], rasp: 0.75, wet: 0.3, muffle: 0, kind: 'male' },
    helmetY: 1.7, helmetSurface: 'plastic', arms: { reach: 0.2 },
    build(o, rng, look) {
      o.body({ skin: 0x8c8a7c, girth: 1.1, belly: 0.55, gaunt: 0.15, muscle: 0.55, fat: 0.55, age: 0.55, face: { jaw: 1.28, chin: 1.25, nose: 1.25, noseW: 1.3, brow: 1.1, cranium: 1.03, bloat: 0.25, gaunt: 0.1, cheek: 1.2 } });
      o.garment('shirt', { color: look ? 0x9a9280 : 0x3e5670, pattern: 'weave', dirt: 0.6, wear: 0.5, sleeve: 4 });
      o.garment('vest', { color: look ? 0x3a1812 : 0x22201e, pattern: 'weave', dirt: 0.5, wear: 0.45 });
      o.garment('pants', { color: 0x262624, pattern: 'canvas', dirt: 0.6, wear: 0.5, detail: 8 | 16 });
      o.garment('boots', { color: 0x2a1c12, dirt: 0.7, height: 6 });
      o.belt({ y: 1.0, color: 0x1a120c });
      o.hardHat({ color: 0xe6e0cc, wear: 0.5, dirt: 0.55, cracked: 0.2 });
      o.hairShell({ color: 0x5a5048, length: 0.014, hairline: 0.1, messy: 0.5 }); // receding grey
      o.pickaxe({ hand: 'R' });
    },
  },
  {
    id: 'miner_coal', name: 'Coal Hewer', looks: 2, height: [1.62, 1.82], hp: 0.9,
    body: { gaunt: 0.75, girthRange: [0.9, 1.0] }, skin: { tint: [0.9, 0.9, 0.9] },
    layers: { dust: 0.92, blood: 0.4 }, eyes: { glow: 0.0, cataract: 0.9 }, hair: { color: 0x0e0c0a, amount: 0.9, beard: 0.8 },
    speedClasses: { walk: 0.7, run: 1.3, sprint: 1.3 }, voice: { f0: 105, formants: [600, 1150, 2550], rasp: 0.5, wet: 0.45, muffle: 0, kind: 'male' },
    idiosyncrasy: { hunch: [0.25, 0.5], kypho: [0.3, 0.8], headFwd: [0.3, 0.8] }, facial: { moustache: 0.2, age: [0.1, 0.5], cheekWound: 0.4 }, wounds: [{ type: 'open', at: 'belly', r: 0.06 }, { type: 'bite', at: 'shoulder', r: 0.045, chance: 0.7 }], jawOpen: [0.18, 0.34],
    build(o, rng, look) {
      o.body({ skin: 0x8a8c80, girth: 0.94, gaunt: 0.75, muscle: 0.55, face: { gaunt: 1.0, cheek: 0.75, jaw: 0.9, nose: 0.92, brow: 1.4, teethMissing: 0.45, lipsGone: 0.5 } });
      o.garment('pants', { color: look ? 0x2a2622 : 0x34302a, pattern: 'canvas', dirt: 0.95, wear: 0.75 });
      o.garment('boots', { color: 0x1e1814, dirt: 0.95, height: 6 });
      o.braces({ color: 0x241a14 }); o.belt({ y: 0.98, color: 0x1a120c });
      o.kneePads({ color: 0x1a1816 });
      if (look) o.neckerchief({ color: 0x3a2a24 }); else o.beanie({ color: 0x22201c, fold: true });
    },
  },
  {
    id: 'miner_drowned', name: 'Drowned Miner', looks: 2, height: [1.64, 1.86], hp: 1.1,
    body: { gaunt: 0.2, girthRange: [1.04, 1.14] }, skin: { tint: [0.9, 0.98, 1.06], variation: 0.08 },
    layers: { wet: 0.95, dust: 0.15, blood: 0.2 }, eyes: { glow: 0.0, cataract: 1.0 }, hair: { color: 0x14140f, amount: 0.7, beard: 0.4 },
    speedClasses: { walk: 1.6, run: 0.6, sprint: 0.2 }, voice: { f0: 88, formants: [480, 900, 2200], rasp: 0.4, wet: 0.95, muffle: 0.2, kind: 'male' },
    wet: true, helmetY: 1.69, helmetSurface: 'plastic', arms: { reach: 0.7 }, facial: { moustache: 0.1, age: [0.2, 0.6] }, wounds: [{ type: 'bite', at: 'neck', r: 0.05 }, { type: 'bite', at: 'forearm', r: 0.045, chance: 0.6 }], gearDrop: { hat: 0.3 }, jawOpen: [0.2, 0.36],
    build(o, rng, look) {
      o.body({ skin: 0x98aaa4, girth: 1.08, belly: 0.4, gaunt: 0.1, fat: 0.4, face: { bloat: 1.0, gaunt: 0.0, lipsGone: 0.85, nose: 0.8, earsGone: look ? 1 : 0, jaw: 1.05 } });
      o.garment('coveralls', { color: look ? 0x1c3430 : 0x2a2c22, pattern: 'canvas', dirt: 0.8, wear: 0.7 });
      o.garment('wellies', { color: 0x1a1c1a, dirt: 0.6 });
      o.belt({ y: 1.0, color: 0x1e1a14 });
      o.minerHelmet({ color: 0x2a2e2a, wear: 0.8, dirt: 0.8, lamp: { emissive: 0.0, lensColor: 0x303830 }, ridge: true });
      o.hairShell({ color: 0x14140f, length: 0.024, messy: 1.0 }); // matted, wet
      o.tatters({ color: look ? 0x1c3430 : 0x2a2c22, y: 0.62, count: 3, length: 0.12, side: 'front' });
      o.seaweed({ color: 0x1e2614, anchors: [[0.12, 1.44, -0.06], [-0.1, 1.45, 0.06], [0.16, 1.0, -0.06], [-0.3, 1.25, 0.02]] });
    },
  },
  {
    id: 'miner_crystal', name: 'Crystal-Riddled', looks: 2, height: [1.66, 1.88], hp: 1.35,
    body: { gaunt: 0.6, girthRange: [0.94, 1.04] }, skin: { tint: [0.95, 0.92, 1.05] },
    layers: { dust: 0.35, crystal: 0.8, blood: 0.3 }, eyes: { glow: 3.5, color: 0xb070ff, cataract: 0.4 }, hair: { color: 0x2a2226, amount: 0.5, bald: 1 },
    speedClasses: { walk: 0.9, run: 1.1, sprint: 1 }, voice: { f0: 70, formants: [500, 1400, 3100], rasp: 0.35, wet: 0.2, muffle: 0, kind: 'crystal' },
    emissiveColor: 0xa878ff, helmetY: 1.69, helmetSurface: 'crystal', facial: { age: [0.4, 0.9] }, wounds: [{ type: 'open', at: 'chest', r: 0.06, chance: 0.7 }],
    build(o, rng, look) {
      o.body({ skin: 0x9a92a4, gaunt: 0.6, age: 0.35, face: { cranium: 1.04, brow: 1.45, forehead: 1, jaw: 1.05, gaunt: 0.7, nose: 1.1 } });
      o.garment('coveralls', { color: look ? 0x3a2c20 : 0x1e2430, pattern: 'canvas', dirt: 0.7, wear: 0.85, sleeve: 5 });
      o.garment('boots', { color: 0x2a2018, dirt: 0.7 });
      o.belt({ y: 1.0 });
      o.goggles({ on: 'forehead', lens: 0x3a2850 });
      o.crystals({ color: look ? 0xb070ff : 0x60c8ff, emissive: 7 });
    },
  },
  {
    id: 'miner_burnt', name: 'Magma-Burnt', looks: 2, height: [1.66, 1.9], hp: 1.5,
    body: { gaunt: 0.5, girthRange: [0.96, 1.08] }, skin: { tint: [0.9, 0.85, 0.8] },
    layers: { burn: 0.85, dust: 0.2, blood: 0.1 }, eyes: { glow: 5, color: 0xff5a18, cataract: 0.2 }, hair: { color: 0x0a0806, amount: 0.15, bald: 1, beard: 0.1, brows: 0 },
    speedClasses: { walk: 0.8, run: 1.2, sprint: 1.1 }, voice: { f0: 78, formants: [520, 1000, 2350], rasp: 1.0, wet: 0.1, muffle: 0, kind: 'burnt' },
    embers: true, emissiveColor: 0xff7a30, helmetY: 1.69, helmetSurface: 'metal',
    build(o, rng, look) {
      o.body({ skin: 0x3a3230, gaunt: 0.5, face: { lipsGone: 1, gaunt: 0.9, nose: 0.55, earsGone: 3, brow: 1.2 } });
      o.garment('pants', { color: 0x141210, pattern: 'canvas', dirt: 0.9, wear: 0.95 });
      if (look) o.garment('singlet', { color: 0x1a1612, pattern: 'knit', dirt: 0.9, wear: 0.95 });
      o.garment('boots', { color: 0x141210, dirt: 0.9 });
      if (!look) o.minerHelmet({ color: 0x141210, wear: 0.9, dirt: 0.9, lamp: { emissive: 0.0, lensColor: 0x201810 } });
    },
  },
  {
    id: 'miner_gas', name: 'Gas Miner', looks: 2, height: [1.66, 1.86], hp: 1.1,
    body: { gaunt: 0.45, girthRange: [0.96, 1.06] }, skin: { tint: [0.96, 1.0, 0.94] },
    layers: { dust: 0.45, blood: 0.35 }, eyes: { glow: 0.0, cataract: 0.7 }, hair: { color: 0x1a1612, amount: 0.8 },
    speedClasses: { walk: 1, run: 1.1, sprint: 0.9 }, voice: { f0: 96, formants: [540, 1100, 2400], rasp: 0.55, wet: 0.3, muffle: 0.75, kind: 'masked' },
    helmetY: 1.69, helmetSurface: 'plastic', facial: { age: [0.2, 0.7] }, wounds: [{ type: 'bandage', at: 'forearm', r: 0.05 }, { type: 'gash', at: 'thigh', r: 0.045, chance: 0.6 }], gearDrop: { hat: 0.2 },
    build(o, rng, look) {
      o.body({ skin: 0x8c9486, gaunt: 0.45, fat: 0.2, face: { jaw: 1.15, chin: 1.1, gaunt: 0.5 } });
      o.garment('coveralls', { color: look ? 0x2c3640 : 0x424a30, pattern: 'canvas', dirt: 0.7, wear: 0.55 });
      if (!look) o.garment('vest', { color: 0xd8641a, pattern: 'hivis', dirt: 0.6, wear: 0.5, detail: 0 }); // orange safety vest: saturated accent
      o.garment('gloves', { color: 0x2c2c26, mat: 'rubber', dirt: 0.6 });
      o.garment('boots', { color: 0x221a12, dirt: 0.75 });
      o.belt({ y: 1.0 }); o.beltCanister({ x: -0.13, y: 0.95, color: 0x6a6a52 });
      o.respirator({ canisters: look ? 1 : 2, filterColor: 0x5c5a3c });
      o.goggles({ on: 'eyes', lens: 0x2a3228 });
      o.minerHelmet({ color: look ? 0x6a5a2a : 0x3a3a34, wear: 0.6, lamp: false });
      o.backpack({ color: 0x44442e });
      o.tatters({ color: look ? 0x2c3640 : 0x424a30, y: 0.36, count: 3, length: 0.1 });
    },
  },
];
registerVariants('shaft-nine', SHAFT_NINE_VARIANTS, { aliases: { miner: 'miner_coal', miner_helmet: 'miner_lamp' } });
