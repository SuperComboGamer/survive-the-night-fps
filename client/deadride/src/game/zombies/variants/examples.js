// Reference variants for the other three maps — one per signature mechanic. Map workers: copy these into your own
// src/maps/<id>/zombies.js (or call registerVariants from there) and build a full set of ≥ 5 variants per map.
import { registerVariants } from '../factory.js';
import '../gear.js';

// WHITEOUT — frost-caked tourist in a puffy parka (frost crust + icicles + breath puffs)
export const WHITEOUT_EXAMPLE = [{
  id: 'frost_tourist', name: 'Frozen Tourist', looks: 2, height: [1.6, 1.86], hp: 1,
  body: { gaunt: 0.3, girthRange: [0.98, 1.08] }, skin: { tint: [0.92, 0.96, 1.08], variation: 0.08 },
  layers: { frost: 0.85, blood: 0.35 }, eyes: { glow: 0, cataract: 0.95 }, hair: { color: 0x3a2a1c, amount: 0.8, beard: 0.3 },
  speedClasses: { walk: 1.2, run: 1, sprint: 0.7 }, voice: { f0: 110, formants: [620, 1200, 2600], rasp: 0.45, wet: 0.2, muffle: 0.1, kind: 'male' },
  breath: true, arms: { reach: 0.4 },
  build(o, rng, look) {
    o.body({ skin: 0x687076, gaunt: 0.3, face: { gaunt: 0.5 } });
    const parka = look ? 0xb03020 : 0x2a5a8a;
    o.garment('jacket', { color: parka, pattern: 'quilt', puff: { period: 0.105, depth: 0.024, bulge: 0.018 }, offset: 0.032, loose: 0.01, dirt: 0.3, wear: 0.35, frost: 1, collar: 'stand', collarHeight: 0.075 });
    o.garment('pants', { color: 0x1c1e24, pattern: 'ripstop', offset: 0.022, dirt: 0.3, wear: 0.3 });
    o.garment('boots', { color: 0x2a2420, mat: 'rubber', height: 5, offset: 0.02, loose: 0.02 });
    o.garment('mittens', { color: 0x1a1a1a, dirt: 0.2 });
    o.hood({ color: parka, fur: 0xb0a080, up: false, pattern: 'quilt' });
    if (look) o.beanie({ color: 0xd8d0c0, pompom: 0xc03030 }); else o.goggles({ on: 'forehead', lens: 0x8a5a20, frame: 0xe0e0e0, strap: 0x303848 });
    o.icicles({ points: [['chest', 0.09, 1.43, -0.13], ['chest', -0.1, 1.42, -0.12], ['head', 0.02, 1.515, -0.08], ['head', -0.015, 1.52, -0.078], ['chest', 0.0, 1.44, -0.14]] });
  },
}];
// LAST FERRY — drowned dockworker in oilskins (wet + drips + seaweed; climbs pier ladders out of the water)
export const LAST_FERRY_EXAMPLE = [{
  id: 'drowned_docker', name: 'Drowned Docker', looks: 2, height: [1.66, 1.9], hp: 1.1,
  body: { gaunt: 0.2, girthRange: [1.02, 1.14] }, skin: { tint: [0.88, 0.97, 1.05] },
  layers: { wet: 0.95, blood: 0.2 }, eyes: { glow: 0, cataract: 1 }, hair: { color: 0x2a2a24, amount: 0.7, beard: 0.9 },
  speedClasses: { walk: 1.3, run: 0.9, sprint: 0.5 }, voice: { f0: 85, formants: [470, 880, 2200], rasp: 0.5, wet: 1.0, muffle: 0.15, kind: 'male' },
  wet: true, arms: { reach: 0.6 },
  build(o, rng, look) {
    o.body({ skin: 0x7a8886, girth: 1.08, belly: 0.35, face: { bloat: 0.8, lipsGone: 0.5 } });
    o.garment('shirt', { color: 0x3a4450, pattern: 'check', dirt: 0.4 });
    o.garment('pants', { color: 0x2a2c30, pattern: 'canvas', dirt: 0.5 });
    o.garment('jacket', { color: 0xc89a1a, pattern: 'oilskin', offset: 0.026, loose: 0.024, dirt: 0.5, wear: 0.5 });
    o.garment('wellies', { color: 0x1c1e1c });
    if (look) o.souwester({ color: 0xc89a1a }); else o.beanie({ color: 0x2a3440, fold: true });
    o.cargoHook({ hand: 'R' });
    o.seaweed({ color: 0x2a3a18 });
  },
}];
// AFTER HOURS — park guest in a (cracked) mascot suit with a balloon on a string
export const AFTER_HOURS_EXAMPLE = [{
  id: 'mascot_guest', name: 'Mascot Suit', looks: 2, height: [1.64, 1.9], hp: 1.2,
  body: { gaunt: 0.2, girthRange: [1.0, 1.1] }, skin: { tint: [1, 0.96, 0.95] },
  layers: { blood: 0.7 }, eyes: { glow: 0, cataract: 0.8 }, hair: { color: 0x2a1c14, amount: 0.8 },
  speedClasses: { walk: 1, run: 1, sprint: 0.8 }, voice: { f0: 100, formants: [560, 1100, 2500], rasp: 0.5, wet: 0.3, muffle: 0.55, kind: 'masked' },
  balloon: { hand: 'L', color: 0xd82828, length: 1.1 }, hitHeadR: 0.27, hitHeadDY: 0.05, arms: { reach: 0.3 },
  build(o, rng, look) {
    o.body({ skin: 0x7a7a70 });
    const fur = look ? 0x6a8ab0 : 0x8a5a32;
    o.garment('coveralls', { color: fur, mat: 'fur', pattern: 'plush', offset: 0.03, loose: 0.02, dirt: 0.5, wear: 0.6 });
    o.garment('mittens', { color: 0xe8e0d0, mat: 'fur', pattern: 'plush', offset: 0.02 });
    o.garment('boots', { color: 0x3a2a20, mat: 'fur', pattern: 'plush', offset: 0.03, loose: 0.03, height: 7 });
    o.mascotHead({ kind: look ? 'rabbit' : 'bear', color: fur, snout: 0xe0d0b0, cracked: 0.45, plush: false });
  },
}];
// registered under a pseudo map so the ids resolve everywhere; variants/index.js registerAll() also lists each example under its
// real map id when that map has not registered a set of its own (so a map without zombies still gets its signature zombie)
registerVariants('examples', [...WHITEOUT_EXAMPLE, ...LAST_FERRY_EXAMPLE, ...AFTER_HOURS_EXAMPLE]);
export const EXAMPLES_BY_MAP = { whiteout: WHITEOUT_EXAMPLE, 'last-ferry': LAST_FERRY_EXAMPLE, 'after-hours': AFTER_HOURS_EXAMPLE };
