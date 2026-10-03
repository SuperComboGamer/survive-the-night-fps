// Room-acoustics presets ("spaces"). Each one drives (a) a procedurally generated stereo impulse response (dsp.irGen) used by the shared
// convolution reverb and (b) the per-voice dry path (air absorption low-pass, send level, send falloff).
//   rt60      seconds for -60 dB at mid frequencies             damping   0..1 how much faster highs decay than mids
//   lfMul     LF reverb time multiplier (booming rooms > 1)     predelay  s before the first reflection
//   wet       reverb-to-direct ENERGY ratio at 5 m (unit source)   sendFalloff 0 = diffuse (level independent of distance) .. 1 = follows the direct sound
//   dryLP     Hz ceiling of the dry path (dense/foggy air)       airAbs    multiplier on the air-absorption model (dB/m at 8 kHz = 0.09 * airAbs)
//   early     [[delay s, gain, lpHz?, lenSec?]] crisp reflections (walls: slap echoes)   echoes  smeared discrete echoes (shafts, canyons)
//   flutter   {period, decay, gain, lp, count} repeated reflections between parallel walls  ring  [[Hz, amp, RT60 s]] metallic/tin resonances
export const SPACES = {
  // sub-rooms a stop switches to when the listener probe says the surroundings changed (see presets 'rooms'): a big mine chamber, a small timber/steel hut, a warehouse hall
  tunnelHall: { rt60: 3.4, damping: 0.35, lfMul: 1.25, predelay: 0.014, wet: 1.6, dryLP: 14500, airAbs: 0.8, sendFalloff: 0.12, seed: 21, mix: 0.07, echoGain: 1.2, early: [[0.03, 0.55, 7000], [0.07, 0.5, 6500], [0.13, 0.4, 5500]], echoes: [[0.22, 0.7, 5200, 0.01], [0.48, 0.6, 4200, 0.014], [0.85, 0.45, 3200, 0.02], [1.4, 0.35, 2400, 0.028]] },
  hutInterior: { rt60: 0.7, damping: 0.55, lfMul: 1.1, predelay: 0.004, wet: 0.55, dryLP: 15000, airAbs: 0.9, sendFalloff: 0.35, seed: 22, mix: 0.02, early: [[0.008, 0.6, 7500], [0.017, 0.5, 6500], [0.028, 0.4, 5500]] },
  warehouse: { rt60: 1.8, damping: 0.45, lfMul: 1.15, predelay: 0.012, wet: 0.95, dryLP: 15000, airAbs: 0.85, sendFalloff: 0.2, seed: 23, mix: 0.05, early: [[0.03, 0.55, 7000], [0.06, 0.45, 6500], [0.11, 0.4, 6000], [0.19, 0.3, 5000]], flutter: { period: 0.024, decay: 0.8, gain: 0.25, lp: 6000, count: 30, jitter: 0.03 } },
  open: { rt60: 0.55, damping: 0.85, predelay: 0.02, wet: 0.07, dryLP: 16000, airAbs: 1.0, sendFalloff: 0.75, early: [[0.10, 0.2, 5000], [0.27, 0.1, 3500]], lfMul: 1.1 },
  openDusk: { rt60: 0.65, damping: 0.8, predelay: 0.025, wet: 0.09, dryLP: 15000, airAbs: 1.0, sendFalloff: 0.75, early: [[0.13, 0.22, 4500], [0.33, 0.12, 3200]], lfMul: 1.1 },
  mineShaft: { rt60: 3.6, damping: 0.3, lfMul: 1.3, predelay: 0.012, wet: 2.0, dryLP: 15000, airAbs: 0.8, sendFalloff: 0.1, mix: 0.09, seed: 11, echoGain: 1.4,
    early: [[0.021, 0.6, 7000], [0.043, 0.5, 6500]],
    echoes: [[0.12, 0.9, 6000, 0.006], [0.31, 0.8, 5200, 0.008], [0.55, 0.7, 4200, 0.012], [0.9, 0.55, 3200, 0.018], [1.4, 0.45, 2400, 0.024], [1.95, 0.35, 1800, 0.03]],
    flutter: { period: 0.0198, decay: 0.84, gain: 0.5, lp: 7000, count: 70, jitter: 0.02 } },
  tunnel: { rt60: 2.0, damping: 0.5, lfMul: 1.2, predelay: 0.01, wet: 1.2, dryLP: 14000, airAbs: 0.8, sendFalloff: 0.15, seed: 12, mix: 0.06,
    early: [[0.02, 0.5, 6500], [0.045, 0.45, 6000], [0.09, 0.35, 5000], [0.18, 0.3, 4000]], flutter: { period: 0.0175, decay: 0.75, gain: 0.3, lp: 6000, count: 40, jitter: 0.03 } },
  flooded: { rt60: 2.5, damping: 0.35, lfMul: 1.15, predelay: 0.008, wet: 1.4, dryLP: 13000, airAbs: 0.7, sendFalloff: 0.1, seed: 13, mix: 0.05,
    early: [[0.02, 0.6, 7000], [0.05, 0.5, 6000]], echoes: [[0.09, 0.6, 5500, 0.008], [0.2, 0.5, 4500, 0.012], [0.36, 0.4, 3800, 0.016], [0.6, 0.3, 3000, 0.02]],
    ring: [[310, 0.25, 1.6], [615, 0.2, 1.3], [1230, 0.15, 1.0], [2440, 0.1, 0.8], [3600, 0.07, 0.6]] },
  crystalCavern: { rt60: 3.4, damping: 0.06, lfMul: 0.9, predelay: 0.02, wet: 1.4, dryLP: 18000, airAbs: 0.6, sendFalloff: 0.1, eq: [0.6, 1, 1, 0.9], seed: 14, mix: 0.08, echoGain: 0.8,
    early: [[0.03, 0.5, 9000], [0.07, 0.5, 9000], [0.13, 0.4, 8000]],
    ring: [[1760, 0.12, 2.2], [1782, 0.12, 2.4], [2637, 0.1, 2.0], [2655, 0.1, 2.1], [3520, 0.08, 1.8], [3542, 0.08, 1.9], [5274, 0.05, 1.5], [5290, 0.05, 1.4]] },
  magmaChamber: { rt60: 1.5, damping: 0.9, lfMul: 2.0, predelay: 0.02, wet: 1.0, dryLP: 6500, airAbs: 1.4, sendFalloff: 0.2, eq: [1.7, 0.8, 0.3, 0.1], lowCut: 25, seed: 15, mix: 0.07,
    early: [[0.05, 0.4, 2500], [0.11, 0.35, 2000]], ring: [[42, 0.5, 2.4], [63, 0.4, 2.0], [88, 0.3, 1.6]] },
  snow: { rt60: 0.14, damping: 0.98, lfMul: 1.0, predelay: 0.004, wet: 0.03, dryLP: 3500, airAbs: 2.5, sendFalloff: 0.9, eq: [1, 0.9, 0.3, 0.05], seed: 16, mix: 0.01, build: 0.004 },
  blizzard: { rt60: 0.16, damping: 0.98, lfMul: 1.0, predelay: 0.004, wet: 0.04, dryLP: 2400, airAbs: 3.5, sendFalloff: 0.9, eq: [1, 0.85, 0.25, 0.04], seed: 17, mix: 0.01, build: 0.004 },
  whiteoutStation: { rt60: 1.2, damping: 0.45, lfMul: 1.1, predelay: 0.012, wet: 0.9, dryLP: 15000, airAbs: 0.8, sendFalloff: 0.2, seed: 18, mix: 0.04,
    early: [[0.03, 0.55, 7000], [0.06, 0.45, 6500], [0.11, 0.4, 6000], [0.19, 0.3, 5000]] },
  summit: { rt60: 0.3, damping: 0.9, predelay: 0.03, wet: 0.04, dryLP: 9000, airAbs: 1.6, sendFalloff: 0.85, early: [[0.36, 0.14, 2500]], seed: 19 },
  pier: { rt60: 0.7, damping: 0.85, predelay: 0.02, wet: 0.1, dryLP: 11000, airAbs: 1.8, sendFalloff: 0.7, early: [[0.18, 0.55, 4500], [0.44, 0.3, 3500]], seed: 20 },
  wharf: { rt60: 0.9, damping: 0.75, predelay: 0.015, wet: 0.2, dryLP: 12500, airAbs: 1.5, sendFalloff: 0.5, early: [[0.09, 0.4, 5000], [0.21, 0.32, 4500], [0.38, 0.24, 3800]], seed: 21 },
  prison: { rt60: 1.6, damping: 0.55, lfMul: 1.1, predelay: 0.012, wet: 0.55, dryLP: 15000, airAbs: 0.9, sendFalloff: 0.35, seed: 22, mix: 0.05,
    early: [[0.075, 0.75, 7000], [0.16, 0.6, 6000], [0.3, 0.45, 5000]], flutter: { period: 0.146, decay: 0.62, gain: 0.5, lp: 6000, count: 8, len: 0.0015, jitter: 0.02 } },
  lighthouse: { rt60: 0.45, damping: 0.85, predelay: 0.025, wet: 0.08, dryLP: 9500, airAbs: 1.3, sendFalloff: 0.8, early: [[0.28, 0.15, 3000]], seed: 23 },
  plaza: { rt60: 0.9, damping: 0.6, predelay: 0.02, wet: 0.28, dryLP: 14000, airAbs: 1.0, sendFalloff: 0.55, early: [[0.03, 0.4, 7000], [0.07, 0.35, 6000], [0.22, 0.3, 4500], [0.5, 0.2, 3200]], seed: 24, mix: 0.03 },
  space: { rt60: 1.4, damping: 0.3, lfMul: 0.9, predelay: 0.01, wet: 0.65, dryLP: 18000, airAbs: 0.7, sendFalloff: 0.25, eq: [0.7, 1, 1, 0.8], seed: 25, mix: 0.03,
    early: [[0.02, 0.6, 9000], [0.05, 0.5, 9000], [0.09, 0.45, 8500], [0.15, 0.4, 8000]], ring: [[1200, 0.08, 0.5], [2400, 0.06, 0.4], [4800, 0.04, 0.3]] },
  castle: { rt60: 2.6, damping: 0.5, lfMul: 1.25, predelay: 0.02, wet: 1.0, dryLP: 13000, airAbs: 0.8, sendFalloff: 0.2, seed: 26, mix: 0.07,
    early: [[0.04, 0.6, 6500], [0.09, 0.5, 6000], [0.17, 0.4, 5000], [0.3, 0.3, 4000]] },
  cove: { rt60: 0.5, damping: 0.85, predelay: 0.02, wet: 0.1, dryLP: 11000, airAbs: 1.4, sendFalloff: 0.7, early: [[0.12, 0.22, 4000], [0.28, 0.12, 3000]], seed: 27 },
  // ---- vehicle interiors (the player's own box)
  vehicle: { rt60: 0.35, damping: 0.7, predelay: 0.004, wet: 0.3, dryLP: 12000, airAbs: 0.5, sendFalloff: 0.1, early: [[0.01, 0.5, 7000], [0.023, 0.4, 6000]], seed: 30 },
  cage: { rt60: 0.5, damping: 0.4, lfMul: 0.9, predelay: 0.003, wet: 0.55, dryLP: 12000, airAbs: 0.4, sendFalloff: 0.1, seed: 31, mix: 0.01, // tin shaft box: ringing sheet panels, rattling gate
    early: [[0.007, 0.7, 8000], [0.016, 0.55, 7000]], flutter: { period: 0.0068, decay: 0.72, gain: 0.35, lp: 6500, count: 30, jitter: 0.05 },
    ring: [[880, 0.3, 0.5], [1350, 0.25, 0.4], [2050, 0.2, 0.3], [3100, 0.12, 0.25]] },
  gondola: { rt60: 0.22, damping: 0.6, predelay: 0.002, wet: 0.3, dryLP: 9000, airAbs: 0.5, sendFalloff: 0.1, early: [[0.004, 0.6, 7000], [0.009, 0.5, 6000]], seed: 32, mix: 0.005 },
  ferry: { rt60: 0.7, damping: 0.5, predelay: 0.006, wet: 0.4, dryLP: 12500, airAbs: 0.8, sendFalloff: 0.3, early: [[0.03, 0.45, 6000], [0.07, 0.35, 5000]], ring: [[520, 0.15, 0.7], [1040, 0.1, 0.5], [2300, 0.06, 0.4]], seed: 33 },
  monorail: { rt60: 0.3, damping: 0.55, predelay: 0.003, wet: 0.35, dryLP: 12500, airAbs: 0.5, sendFalloff: 0.1, early: [[0.005, 0.6, 8000], [0.011, 0.5, 7000], [0.02, 0.35, 6000]], seed: 34, mix: 0.005 },
  underwater: { rt60: 1.0, damping: 0.95, predelay: 0.004, wet: 0.5, dryLP: 900, airAbs: 0.2, sendFalloff: 0.2, eq: [1.4, 0.7, 0.2, 0.05], seed: 35 },
};
// atmosphere `reverb` names used by stop authors -> space ids (exact ids win; then aliases; then keyword sniffing)
export const SPACE_ALIASES = {
  mine: 'mineShaft', shaft: 'mineShaft', mineshaft: 'mineShaft', tunnels: 'tunnel', drift: 'tunnel', timbered: 'tunnel', flood: 'flooded', water: 'flooded', cavern: 'crystalCavern', crystal: 'crystalCavern', cave: 'crystalCavern',
  magma: 'magmaChamber', lava: 'magmaChamber', chamber: 'magmaChamber', village: 'snow', snowfall: 'snow', ski: 'snow', station: 'whiteoutStation', midstation: 'whiteoutStation', observatory: 'summit', peak: 'summit',
  harbor: 'wharf', harbour: 'wharf', market: 'wharf', fish: 'wharf', jail: 'prison', yard: 'prison', island: 'prison', beacon: 'lighthouse', rock: 'lighthouse', entrance: 'plaza', square: 'plaza', spaceage: 'space', tomorrow: 'space',
  haunted: 'castle', keep: 'castle', pirate: 'cove', bay: 'cove', surface: 'openDusk', yardopen: 'open', dusk: 'openDusk', outdoor: 'open', outside: 'open', exterior: 'open', default: 'open',
};
/** map any reverb name to a space definition id ('open' if unknown) */
export function spaceFor(name) {
  if (!name) return 'open'; if (typeof name === 'object') return name; if (SPACES[name]) return name;
  const k = String(name).toLowerCase().replace(/[^a-z]/g, ''); for (const id of Object.keys(SPACES)) if (id.toLowerCase() === k) return id;
  if (SPACE_ALIASES[k]) return SPACE_ALIASES[k];
  for (const [alias, id] of Object.entries(SPACE_ALIASES)) if (k.includes(alias)) return id;
  return 'open';
}
