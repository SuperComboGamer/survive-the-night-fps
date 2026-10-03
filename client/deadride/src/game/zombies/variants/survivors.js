// The living: co-op teammates (net/teammates.js) are built with the same body, rig, cloth and skin pipeline as the dead, but
// healthy - no wounds, no blood, no decay, clear eyes, a closed mouth, an upright gait - in four outfits, one per team slot.
import { registerVariants } from '../factory.js';
import '../gear.js';

const ALIVE = {
  looks: 1, height: [1.72, 1.82], hp: 1,
  body: { gaunt: 0, girthRange: [0.98, 1.04] }, skin: { tint: [1, 1, 1], variation: 0.04 },
  layers: { blood: 0, dust: 0.12, wet: 0, frost: 0, burn: 0, crystal: 0 }, eyes: { glow: 0, darkGlow: 0, cataract: 0 },
  wounds: [], extraWounds: 0, jawOpen: 0, arms: { reach: 0 },
  idiosyncrasy: { limpChance: 0, dragChance: 0, hunch: 0, tilt: 0.1, armHangChance: 0, kypho: 0, headFwd: 0, twitchChance: 0 },
  voice: null,
};
const SKIN = [0xc8a088, 0x8a5e44, 0xe0b8a0, 0xa8785a];
const healthy = (o, i, face = {}) => o.body({ skin: SKIN[i], gaunt: 0, muscle: 0.55, decay: 0, dirt: 0.15, nails: 0xc89a8a, face });

export const SURVIVOR_VARIANTS = [
  {
    ...ALIVE, id: 'surv_ranger', name: 'Survivor (field jacket)',
    hair: { color: 0x2a1c12, amount: 0.9, beard: 0.6, bald: 0, hairline: 0.15 }, facial: { moustache: 0.5, sideburns: 0.5, age: 0.35, cheekWound: 0 },
    build(o) {
      healthy(o, 0, { jaw: 1.05 });
      o.garment('shirt', { color: 0x6a5a48, pattern: 'check', dirt: 0.2, wear: 0.15, sleeve: 6 });
      o.garment('pants', { color: 0x2c3a52, pattern: 'denim', dirt: 0.2, wear: 0.15 });
      o.garment('jacket', { color: 0x4a4e32, pattern: 'canvas', dirt: 0.25, wear: 0.2, loose: 0.02 });
      o.garment('boots', { color: 0x3a2618, dirt: 0.35, wear: 0.25, height: 6 });
      o.belt({ y: 0.99, color: 0x24190f });
      o.backpack({ color: 0x3e4230 });
    },
  },
  {
    ...ALIVE, id: 'surv_parka', name: 'Survivor (red parka)',
    hair: { color: 0x6a4a2a, amount: 0.9, beard: 0.1, bald: 0, hairline: 0.1 }, facial: { moustache: 0, sideburns: 0.2, age: 0.25, cheekWound: 0 },
    build(o) {
      healthy(o, 1);
      o.garment('tshirt', { color: 0x30343a, pattern: 'weave', dirt: 0.15, wear: 0.1 });
      o.garment('pants', { color: 0x24262a, pattern: 'ripstop', dirt: 0.2, wear: 0.15 });
      o.garment('jacket', { color: 0x9a2a1e, pattern: 'quilt', puff: { period: 0.105, depth: 0.02, bulge: 0.015 }, offset: 0.028, loose: 0.01, dirt: 0.2, wear: 0.15, collar: 'stand', collarHeight: 0.07 });
      o.garment('boots', { color: 0x2a2420, mat: 'rubber', height: 5, dirt: 0.3 });
      o.garment('gloves', { color: 0x1a1a1a, dirt: 0.2 });
      o.beanie({ color: 0x2a3440, fold: true });
    },
  },
  {
    ...ALIVE, id: 'surv_medic', name: 'Survivor (fleece)',
    hair: { color: 0x14100c, amount: 1, beard: 0, bald: 0, hairline: 0.05 }, facial: { moustache: 0, sideburns: 0, age: 0.2, cheekWound: 0 },
    build(o) {
      healthy(o, 2, { jaw: 0.95 });
      o.garment('shirt', { color: 0x8a8e94, pattern: 'weave', dirt: 0.15, wear: 0.1, sleeve: 6 });
      o.garment('pants', { color: 0x4a4436, pattern: 'canvas', dirt: 0.25, wear: 0.15 });
      o.garment('vest', { color: 0x2a4a6a, pattern: 'fleece', dirt: 0.2, wear: 0.1 });
      o.garment('boots', { color: 0x2e2216, dirt: 0.3, wear: 0.2, height: 5 });
      o.neckerchief({ color: 0xa83228 });
      o.backpack({ kind: 'satchel', color: 0x5a4a32 });
    },
  },
  {
    ...ALIVE, id: 'surv_worker', name: 'Survivor (hi-vis)',
    hair: { color: 0x3a3028, amount: 0.7, beard: 0.9, bald: 0, hairline: 0.35 }, facial: { moustache: 0.9, sideburns: 0.6, age: 0.55, cheekWound: 0 },
    build(o) {
      healthy(o, 3, { jaw: 1.1, brow: 1.1 });
      o.garment('shirt', { color: 0x3a3e48, pattern: 'check', dirt: 0.25, wear: 0.2, sleeve: 6 });
      o.garment('pants', { color: 0x30302c, pattern: 'canvas', dirt: 0.3, wear: 0.2 });
      o.garment('vest', { color: 0xd8e020, pattern: 'hivis', dirt: 0.2, wear: 0.15 });
      o.garment('boots', { color: 0x2a1e14, dirt: 0.4, wear: 0.3, height: 6 });
      o.garment('gloves', { color: 0x6a5a3a, dirt: 0.3 });
      o.hardHat({ color: 0xe8e4dc, wear: 0.2 });
    },
  },
];
registerVariants('survivors', SURVIVOR_VARIANTS);
