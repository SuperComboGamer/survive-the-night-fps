// Foley: footsteps (15 surfaces x L/R x walk/sprint/crouch), shell casings, boards, zombie shuffle/cloth, melee, player movement.
// Every sound is synthesised from physical ingredients: an impact excitation (noise transient), the struck body (modal resonators),
// and secondary textures (grain clouds for crunch/gravel, bubbles for water, stick-slip for creaks).
import * as dsp from '../dsp.js';
import { PLATE, BELL, partialsFrom, grain, crunch, bubble, swish, creak, wander, tilt } from './common.js';

// ------------------------------------------------------------------------------------------- footsteps
const hard = (K, s, t, a, h, fm, heel, P) => {
  K.mix(s, K.burst(0.012, { atk: 0.0002, tau: 0.0025, hp: P.click[0], lp: P.click[1] }), P.click[2] * a * h, t);
  K.mix(s, K.ring(0.2, P.slab.map(([f, g, d]) => [f * fm, g, d]), { soft: 0.003 }), (heel ? 0.55 : 0.3) * a, t);      // floor resonance: the dull part (kept below the shoe's own click / scuff so it survives small speakers)
  K.mix(s, K.burst(0.05, { color: 'pink', atk: 0.001, tau: 0.012, lp: P.slap[0] }), P.slap[1] * 1.5 * a, t);
  K.mix(s, K.burst(0.03, { atk: 0.0005, tau: 0.008, bp: P.grit[0], q: 0.7 }), P.grit[1] * 1.4 * a * h, t + 0.004);
  K.mix(s, K.svf(K.burst(0.03, { color: 'pink', atk: 0.0006, tau: 0.007 }), 'bp', P.slap[0] * 0.8, 0.9), 0.4 * a * h, t + 0.001);  // leather / rubber sole scuff body
  if (P.ring) K.mix(s, K.ring(0.1, P.ring.map(([f, g, d]) => [f * fm, g, d]), { soft: 0.0006 }), 0.35 * a * h, t);
  if (P.grains) K.mix(s, crunch(K, 0.07, P.grains[0], 0.04, P.grains[1], P.grains[2], 0.003, 0.008, 0.25 * a), 1, t);
};
const HARD = {
  concrete: { slab: [[92, 1, 0.035], [155, 0.6, 0.026], [305, 0.3, 0.02], [640, 0.12, 0.012]], click: [1400, 7500, 0.5], slap: [1100, 0.5], grit: [3200, 0.16] },
  brick: { slab: [[120, 1, 0.03], [250, 0.55, 0.022], [520, 0.25, 0.015]], click: [900, 5800, 0.38], slap: [900, 0.6], grit: [2200, 0.12] },
  tile: { slab: [[350, 0.6, 0.02], [720, 0.3, 0.014]], click: [2200, 10000, 0.7], slap: [1800, 0.25], grit: [4000, 0.1], ring: [[1250, 0.5, 0.012], [2350, 0.3, 0.008], [3600, 0.15, 0.006]] },
  rock: { slab: [[430, 0.5, 0.05], [930, 0.45, 0.035], [1700, 0.3, 0.03]], click: [1500, 9000, 0.6], slap: [1500, 0.4], grit: [3500, 0.2], grains: [700, 900, 3500] },
};
const CONTACT = {
  concrete: (K, s, t, a, h, fm, heel) => hard(K, s, t, a, h, fm, heel, HARD.concrete),
  brick: (K, s, t, a, h, fm, heel) => hard(K, s, t, a, h, fm, heel, HARD.brick),
  tile: (K, s, t, a, h, fm, heel) => hard(K, s, t, a, h, fm, heel, HARD.tile),
  rock: (K, s, t, a, h, fm, heel) => hard(K, s, t, a, h, fm, heel, HARD.rock),
  metal(K, s, t, a, h, fm, heel) { // steel grating over a void: plate modes + bars rattling in their frame
    const R = K.rng, f0 = (heel ? 300 : 340) * fm * R.range(0.9, 1.15);
    K.mix(s, K.ring(0.5, partialsFrom(f0, PLATE, 0.09), { soft: 0.0015 }), 0.7 * a, t);
    K.mix(s, K.ring(0.15, [[1800 * fm, 0.4, 0.03], [2900 * fm, 0.3, 0.02]]), 0.3 * a * h, t);
    K.mix(s, K.ring(0.2, [[80 * fm, 1, 0.06]]), 0.6 * a, t);
    K.mix(s, K.burst(0.008, { atk: 0.0001, tau: 0.0018, hp: 2000, lp: 9000 }), 0.45 * a * h, t);
    for (let k = 1; k <= 4; k++) K.mix(s, grain(K, R.range(1400, 2800), 0.006), 0.32 * a / k, t + 0.012 + k * 0.021 * R.range(0.7, 1.3));
  },
  wood(K, s, t, a, h, fm, heel) { // floorboard: plank + joist resonances, occasional creak
    K.mix(s, K.ring(0.2, [[190 * fm, 1, 0.05], [330 * fm, 0.55, 0.04], [590 * fm, 0.32, 0.03], [1150 * fm, 0.12, 0.02]], { soft: 0.002 }), 0.85 * a, t);
    K.mix(s, K.burst(0.06, { color: 'pink', atk: 0.001, tau: 0.02, lp: 650 }), 0.55 * a, t);
    K.mix(s, K.burst(0.02, { atk: 0.0003, tau: 0.005, bp: 2300, q: 1 }), 0.2 * a * h, t);
    if (heel && K.rng.chance(0.35)) K.mix(s, creak(K, 0.13, 240 * fm, 380 * fm, { slip: 55, atk: 0.02, rel: 0.04 }), 0.22 * a, t + 0.03);
  },
  snow(K, s, t, a, h, fm, heel) { // compaction crunch: cloud of ice-crystal fractures + soft body thud, sometimes a dry-snow squeak
    const R = K.rng;
    K.mix(s, crunch(K, heel ? 0.17 : 0.12, heel ? 1500 : 800, 0.06, 1400, 5800, 0.0012, 0.004, 0.34 * a * h), 1, t);
    K.mix(s, K.burst(0.14, { color: 'pink', atk: 0.004, tau: 0.05, lp: 750 }), 0.5 * a, t);
    K.mix(s, K.thump(0.12, 105 * fm, 52 * fm, 0.03, 0.035), 0.4 * a, t);
    if (heel && R.chance(0.4)) K.mix(s, K.tone(0.07, R.range(1900, 2700), { f1: R.range(1500, 2400), glideTau: 0.02, atk: 0.012, tau: 0.03 }), 0.06 * a, t + 0.02);
  },
  ice(K, s, t, a, h, fm, heel) {
    const R = K.rng;
    K.mix(s, K.burst(0.01, { atk: 0.0001, tau: 0.002, hp: 2500, lp: 10000 }), 0.55 * a * h, t);
    K.mix(s, K.ring(0.15, [[2600 * fm, 0.4, 0.025], [3900 * fm, 0.3, 0.018], [5300 * fm, 0.2, 0.012]], { soft: 0.0005 }), 0.45 * a * h, t);
    K.mix(s, K.ring(0.2, [[140 * fm, 1, 0.03], [310 * fm, 0.4, 0.02]], { soft: 0.003 }), 0.6 * a, t);
    K.mix(s, crunch(K, 0.1, 500, 0.05, 2500, 7500, 0.002, 0.006, 0.2 * a), 1, t);
    if (heel && R.chance(0.5)) K.mix(s, K.sweep(0.06, (u) => 1300 - 700 * u, { harm: [1, 0.4], atk: 0.004, rel: 0.02 }), 0.12 * a, t + 0.012);
  },
  water(K, s, t, a, h, fm, heel) { // wading: swish of displaced water, bubbles, drops
    const R = K.rng;
    K.mix(s, swish(K, 0.26, 380 * fm, 1300 * fm, 1.1, { atk: 0.04, tau: 0.09 }), 0.9 * a, t);
    K.mix(s, K.burst(0.05, { color: 'pink', atk: 0.002, tau: 0.02, lp: 500 }), 0.5 * a, t);
    for (let k = 0; k < (heel ? 6 : 4); k++) K.mix(s, bubble(K, R.range(300, 900), R.range(0.008, 0.02)), R.range(0.12, 0.4) * a, t + R.range(0.02, 0.2));
    for (let k = 0; k < 5; k++) K.mix(s, grain(K, R.range(2200, 4800), 0.004), 0.18 * a, t + R.range(0.05, 0.26));
  },
  dirt(K, s, t, a, h, fm) {
    K.mix(s, K.burst(0.09, { color: 'pink', atk: 0.0015, tau: 0.03, lp: 420 * fm }), 0.9 * a, t);
    K.mix(s, K.thump(0.09, 95 * fm, 55 * fm, 0.03, 0.03), 0.5 * a, t);
    K.mix(s, K.burst(0.04, { atk: 0.0004, tau: 0.011, hp: 1400, lp: 6000 }), 0.22 * a * h, t);
    K.mix(s, crunch(K, 0.08, 400, 0.03, 1500, 4500, 0.002, 0.005, 0.12 * a), 1, t + 0.006);
  },
  gravel(K, s, t, a, h, fm, heel) {
    K.mix(s, crunch(K, heel ? 0.26 : 0.18, heel ? 2200 : 1400, 0.09, 1200, 6500, 0.0015, 0.006, 0.3 * a * h), 1, t);
    K.mix(s, crunch(K, 0.1, 300, 0.04, 700, 1800, 0.006, 0.014, 0.3 * a), 1, t);
    K.mix(s, K.burst(0.08, { color: 'pink', atk: 0.002, tau: 0.03, lp: 500 }), 0.5 * a, t);
    K.mix(s, K.thump(0.08, 100 * fm, 55 * fm, 0.03, 0.03), 0.35 * a, t);
  },
  grass(K, s, t, a, h, fm) {
    K.mix(s, K.svf(K.burst(0.16, { color: 'pink', atk: 0.02, tau: 0.06 }), 'bp', 3200, 0.6), 0.55 * a, t);
    K.mix(s, K.burst(0.08, { color: 'pink', atk: 0.002, tau: 0.03, lp: 380 }), 0.7 * a, t);
    K.mix(s, crunch(K, 0.1, 250, 0.05, 2500, 6000, 0.002, 0.004, 0.1 * a), 1, t + 0.01);
  },
  carpet(K, s, t, a, h, fm) {
    K.mix(s, K.burst(0.1, { color: 'brown', atk: 0.004, tau: 0.04, lp: 500 }), 0.9 * a, t);
    K.mix(s, K.thump(0.1, 70 * fm, 45 * fm, 0.03, 0.04), 0.4 * a, t);
    K.mix(s, K.burst(0.12, { atk: 0.02, tau: 0.05, bp: 4200, q: 0.5 }), 0.07 * a, t);
  },
  crystal(K, s, t, a, h, fm) { // glassy crunch with a faint bell-like chime from the crystal lattice
    const R = K.rng, f = R.pick([1046.5, 1174.7, 1318.5, 1568, 1760, 2093]);
    K.mix(s, crunch(K, 0.16, 900, 0.07, 2200, 8500, 0.002, 0.008, 0.3 * a * h), 1, t);
    K.mix(s, K.ring(0.7, partialsFrom(f * fm, BELL, 0.35), { soft: 0.0004 }), 0.13 * a, t + 0.004);
    K.mix(s, K.ring(0.15, [[150 * fm, 1, 0.03]], { soft: 0.003 }), 0.5 * a, t);
    K.mix(s, K.burst(0.008, { atk: 0.0001, tau: 0.002, hp: 3000 }), 0.35 * a * h, t);
  },
  lava(K, s, t, a, h, fm) { // brittle cooled crust over magma: crunch, steam hiss, hollow pop
    const R = K.rng;
    K.mix(s, crunch(K, 0.2, 1100, 0.09, 700, 3200, 0.002, 0.007, 0.35 * a * h), 1, t);
    K.mix(s, K.burst(0.3, { atk: 0.02, tau: 0.12, hp: 3500 }), 0.1 * a, t);
    K.mix(s, K.ring(0.2, [[140 * fm, 1, 0.04], [290 * fm, 0.5, 0.03]], { soft: 0.002 }), 0.6 * a, t);
    K.mix(s, K.burst(0.08, { color: 'pink', atk: 0.002, tau: 0.03, lp: 700 }), 0.4 * a, t);
    if (R.chance(0.5)) K.mix(s, grain(K, R.range(500, 900), 0.02), 0.3 * a, t + R.range(0.05, 0.2));
  },
};
// high-frequency signature of each surface (heel click / scuff / grit / tink / crunch band) added on top of the contact model so the step is not a floor boom
const HFT = {
  hard(K, s, M, R) { K.mix(s, K.burst(0.004, { atk: 0.00004, tau: 0.0008, hp: 2500, lp: 12000 }), 0.55 * M.amp * R.range(0.8, 1.1), 0.004); K.mix(s, K.svf(K.burst(0.05, { color: 'pink', atk: 0.001, tau: 0.016 }), 'bp', R.range(2600, 4200), 0.7), 0.32 * M.amp, 0.006); K.mix(s, crunch(K, 0.05, 1500, 0.02, 2500, 8000, 0.0008, 0.003, 0.14 * M.amp), 1, 0.006); },
  wood(K, s, M, R, fm) { K.mix(s, K.burst(0.006, { atk: 0.00005, tau: 0.0015, bp: 3400, q: 0.8 }), 0.4 * M.amp, 0.004); K.mix(s, K.ring(0.12, [[R.range(900, 1400) * fm, 0.5, 0.012], [R.range(2100, 2900) * fm, 0.3, 0.008]], { soft: 0.0005 }), 0.3 * M.amp, 0.004); },
  metal(K, s, M, R, fm) { K.mix(s, K.ring(0.2, [[2300 * fm, 0.5, 0.04], [3700 * fm, 0.45, 0.03], [5900 * fm, 0.35, 0.018], [8300 * fm, 0.2, 0.01]], { soft: 0.0004 }), 0.6 * M.amp, 0.004); K.mix(s, K.burst(0.004, { atk: 0.00004, tau: 0.0008, hp: 3000, lp: 12000 }), 0.5 * M.amp, 0.004); },
  snow(K, s, M, R) { K.mix(s, crunch(K, 0.12, 900, 0.05, 4000, 9500, 0.0008, 0.003, 0.24 * M.amp), 1, 0.004); },
  gravel(K, s, M, R) { K.mix(s, crunch(K, 0.14, 1400, 0.06, 3000, 9000, 0.0008, 0.003, 0.22 * M.amp), 1, 0.004); },
  water(K, s, M, R) { for (let k = 0; k < 6; k++) K.mix(s, grain(K, R.range(3500, 7500), 0.003), R.range(0.1, 0.25) * M.amp, R.range(0.02, 0.24)); },
  soft(K, s, M, R) { K.mix(s, K.svf(K.burst(0.05, { color: 'pink', atk: 0.002, tau: 0.02 }), 'bp', R.range(3000, 5000), 0.6), 0.16 * M.amp, 0.006); },
};
const HFT_OF = { concrete: 'hard', brick: 'hard', tile: 'hard', rock: 'hard', wood: 'wood', metal: 'metal', snow: 'snow', gravel: 'gravel', water: 'water', dirt: 'soft', grass: 'soft', carpet: 'soft', lava: 'gravel' };
const TILT_SURF = new Set(['concrete', 'brick', 'tile', 'rock', 'wood', 'metal', 'ice', 'crystal']);
const MODE = {
  walk: { amp: 1.0, gap: 0.085, hard: 1.0, toe: 0.55, dur: 0.3, lp: 0, peak: 0.18 },
  sprint: { amp: 1.35, gap: 0.038, hard: 1.3, toe: 0.85, dur: 0.3, lp: 0, peak: 0.28, scuff: 0.3 },
  crouch: { amp: 0.5, gap: 0.13, hard: 0.55, toe: 0.5, dur: 0.36, lp: 3800, peak: 0.1 },
};
const EXTRA = { water: 0.2, snow: 0.06, gravel: 0.08, lava: 0.08, crystal: 0.4, metal: 0.25, ice: 0.1 };
function stepSound(K, surf, foot, mode) {
  const M = MODE[mode], R = K.rng, s = K.buf(M.dur + (EXTRA[surf] || 0)), fm = 1 + (foot ? 0.035 : -0.035) + R.range(-0.03, 0.03), gap = M.gap * R.range(0.85, 1.2), fn = CONTACT[surf];
  fn(K, s, 0.004, M.amp, M.hard * R.range(0.9, 1.1), fm, true);
  fn(K, s, 0.004 + gap, M.amp * M.toe, M.hard * 0.7, fm * 1.02, false);
  if (M.scuff && surf !== 'snow' && surf !== 'gravel' && surf !== 'water') K.mix(s, K.burst(0.07, { color: 'pink', atk: 0.012, tau: 0.02, bp: 2200, q: 0.5 }), M.scuff * M.amp * 0.3, 0.004 + gap * 0.3);
  const hk = HFT[HFT_OF[surf]]; if (hk) hk(K, s, M, R, fm);
  if (TILT_SURF.has(surf)) tilt(K, s, mode === 'crouch' ? 130 : 100, 2200, 0.95); else K.hp(s, 70);
  if (M.lp) K.lp(s, M.lp);
  return s;
}
export const STEP_SURFACES = ['concrete', 'brick', 'rock', 'metal', 'wood', 'snow', 'ice', 'water', 'dirt', 'gravel', 'grass', 'tile', 'carpet', 'crystal', 'lava'];

// ------------------------------------------------------------------------------------------- casings
// families: hard (stone/concrete/tile), metal, wood, glass(ice/crystal), soft(dirt/grass/carpet), gravel, snow, water
const CASE_FAM = { concrete: 'hard', brick: 'hard', rock: 'hard', tile: 'hard', plastic: 'hard', lava: 'hard', metal: 'metal', wood: 'wood', glass: 'glass', ice: 'glass', crystal: 'glass', dirt: 'soft', grass: 'soft', carpet: 'soft', fabric: 'soft', gravel: 'gravel', snow: 'snow', water: 'water', flesh: 'soft', sand: 'soft', mud: 'soft', cloth: 'soft', leather: 'soft', rubber: 'soft', foliage: 'soft', stone: 'hard', marble: 'hard', steel: 'metal', iron: 'metal', default: 'hard' };
function caseHit(K, s, t, a, kind, fam, f0) {
  const R = K.rng, tauB = { hard: 0.05, metal: 0.09, wood: 0.025, glass: 0.06, soft: 0.006, gravel: 0.02, snow: 0.003, water: 0.002 }[fam];
  if (fam === 'water') { K.mix(s, bubble(K, R.range(600, 1200), 0.008), 0.5 * a, t); K.mix(s, K.burst(0.04, { atk: 0.0005, tau: 0.012, bp: 3500, q: 0.6 }), 0.25 * a, t); return; }
  if (kind === 'brass') K.mix(s, K.ring(0.5, [[f0, 1, tauB], [f0 * 2.35, 0.5, tauB * 0.6], [f0 * 3.8, 0.3, tauB * 0.4], [f0 * 0.52, 0.3, tauB * 0.7]], { soft: 0.00012 }), 0.6 * a, t);
  else { K.mix(s, K.ring(0.2, [[f0 * 0.085, 1, 0.03], [f0 * 0.22, 0.4, 0.018]], { soft: 0.0006 }), 0.75 * a, t); K.mix(s, K.ring(0.2, [[2300, 0.4, tauB * 0.8]], { soft: 0.0002 }), 0.3 * a, t); } // plastic hull thud + brass head clink
  const surfMix = { hard: [3500, 0.35], metal: [4500, 0.3], wood: [1400, 0.45], glass: [4200, 0.4], soft: [900, 0.6], gravel: [3000, 0.3], snow: [600, 0.4] }[fam];
  K.mix(s, K.burst(0.012, { color: fam === 'soft' || fam === 'snow' ? 'pink' : 'white', atk: 0.0002, tau: 0.003, bp: surfMix[0], q: 0.6 }), surfMix[1] * a, t);
  if (fam === 'wood') K.mix(s, K.ring(0.05, [[900, 1, 0.012], [1700, 0.4, 0.008]]), 0.4 * a, t);
  if (fam === 'gravel') K.mix(s, crunch(K, 0.05, 500, 0.02, 1500, 5000, 0.002, 0.005, 0.2 * a), 1, t);
}
function casing(K, kind, fam) {
  const R = K.rng, e = kind === 'brass' ? 0.56 : 0.4, f0 = kind === 'brass' ? R.range(4300, 5500) : R.range(3900, 4800), s = K.buf(fam === 'soft' || fam === 'snow' ? 0.32 : 0.8);
  let t = 0.002, amp = 1, dt = R.range(0.075, 0.12);
  for (let b = 0; b < 7; b++) { caseHit(K, s, t, amp, kind, fam, f0 * R.range(0.99, 1.01)); t += dt; dt *= e * R.range(0.85, 1.05); amp *= e * 0.85; if (dt < 0.006 || amp < 0.04 || fam === 'snow' || (fam === 'soft' && b >= 1)) break; }
  if (kind === 'brass' && (fam === 'hard' || fam === 'metal' || fam === 'glass')) for (let k = 0; k < 8; k++) K.mix(s, K.ring(0.05, [[f0 * R.range(0.95, 1.05), 1, 0.012]]), 0.05 * (1 - k / 9), t + k * 0.011 * R.range(0.8, 1.2)); // final rolling rattle
  return s;
}

// ------------------------------------------------------------------------------------------- install
export function install(lib) {
  const common = new Set(['concrete', 'dirt']), common1 = new Set(['gravel', 'snow', 'wood', 'metal', 'rock']);
  // Only the LEFT foot is synthesised; the right foot is the same footfalls re-pitched (x1.045) from a rotated variant — halves synthesis cost, still 6 distinct walk steps.
  const derive = (name, src, ratio) => { const sd = lib.defs.get(src); lib.def(name, { n: sd.n, peak: sd.peak, prio: sd.prio }, (K, i) => K.resample(Float32Array.from(lib.buildVariant(src, (i + 1) % sd.n).getChannelData(0)), ratio)); };
  for (const surf of STEP_SURFACES) {
    const pr = common.has(surf) ? 2 : common1.has(surf) ? 1 : 0;
    lib.def(`step.${surf}.walk.L`, { n: 3, peak: MODE.walk.peak, prio: pr }, (K) => stepSound(K, surf, 0, 'walk'));
    lib.def(`step.${surf}.sprint.L`, { n: 2, peak: MODE.sprint.peak, prio: pr >= 2 ? 1 : pr }, (K) => stepSound(K, surf, 0, 'sprint'));
    lib.def(`step.${surf}.crouch.L`, { n: 1, peak: MODE.crouch.peak, prio: 0 }, (K) => stepSound(K, surf, 1, 'crouch'));
    for (const m of ['walk', 'sprint', 'crouch']) derive(`step.${surf}.${m}.R`, `step.${surf}.${m}.L`, 1.045);
    lib.alias(`step.${surf}`, [`step.${surf}.walk.L`, `step.${surf}.walk.R`]);
  }
  const SAL = { glass: 'ice', fabric: 'carpet', plastic: 'tile', default: 'concrete', flesh: 'dirt', sand: 'dirt', mud: 'dirt', stone: 'rock', marble: 'tile', steel: 'metal', iron: 'metal', cloth: 'carpet', leather: 'carpet', rubber: 'carpet', foliage: 'grass', leaves: 'grass' };
  for (const [a, b] of Object.entries(SAL)) { lib.alias(`step.${a}`, [`step.${b}.walk.L`, `step.${b}.walk.R`]); for (const m of ['walk', 'sprint', 'crouch']) for (const F of ['L', 'R']) lib.alias(`step.${a}.${m}.${F}`, `step.${b}.${m}.${F}`); }

  // casings (lazy: built the first time a surface is hit)
  for (const kind of ['brass', 'shell']) for (const fam of ['hard', 'metal', 'wood', 'glass', 'soft', 'gravel', 'snow', 'water']) lib.def(`casing.${kind}.${fam}`, { n: 2, peak: kind === 'shell' ? 0.3 : 0.28, prio: 0 }, (K) => casing(K, kind, fam));
  for (const [surf, fam] of Object.entries(CASE_FAM)) if (surf !== fam) for (const kind of ['brass', 'shell']) lib.alias(`casing.${kind}.${surf}`, `casing.${kind}.${fam}`); // (a surface named like its family already IS the family def)

  // ---- boards (window barricades)
  lib.def('board.plank', { n: 3, peak: 0.75, prio: 1 }, (K) => { // prising a nailed plank off: nail squeal (stick-slip), fibre crack, splinters, clatter
    const R = K.rng, s = K.buf(0.85);
    K.mix(s, creak(K, 0.28, R.range(700, 1000), R.range(1200, 1700), { slip: R.range(45, 80), harm: [1, 0.6, 0.4, 0.25], noise: 0.2, atk: 0.03, rel: 0.06 }), 0.5, 0);
    K.mix(s, K.burst(0.05, { atk: 0.0005, tau: 0.014, bp: 1800, q: 0.8 }), 0.9, 0.27);
    K.mix(s, K.ring(0.25, [[210, 1, 0.06], [380, 0.6, 0.05], [720, 0.4, 0.035], [1400, 0.2, 0.02]], { soft: 0.0015 }), 0.8, 0.27);
    K.mix(s, crunch(K, 0.2, 350, 0.08, 2500, 7000, 0.0015, 0.005, 0.25), 1, 0.27);
    let t = 0.42, a = 0.7; for (let b = 0; b < 4; b++) { K.mix(s, K.ring(0.15, [[R.range(150, 260), 1, 0.05], [R.range(420, 700), 0.5, 0.03]], { soft: 0.002 }), a * 0.6, t); K.mix(s, K.burst(0.03, { atk: 0.0003, tau: 0.007, bp: 1600, q: 0.8 }), a * 0.3, t); t += 0.09 * Math.pow(0.6, b) * R.range(0.8, 1.2); a *= 0.55; }
    return s;
  });
  lib.def('board.repair', { n: 3, peak: 0.7, prio: 1 }, (K) => { // hammer, three blows driving a nail into a plank, then the plank seating
    const R = K.rng, s = K.buf(0.9); let t = 0.02;
    for (let b = 0; b < 3; b++) { const a = 0.75 + 0.25 * b / 2; K.mix(s, K.ring(0.12, [[R.range(850, 1050), 1, 0.011], [R.range(1800, 2100), 0.45, 0.008], [R.range(3000, 3500), 0.25, 0.006]], { soft: 0.0004 }), 0.8 * a, t); K.mix(s, K.ring(0.25, [[R.range(3100, 3500), 1, 0.05 - b * 0.012]], { soft: 0.0002 }), 0.25 * a, t + 0.001); K.mix(s, K.thump(0.09, 160, 80, 0.02, 0.025), 0.55 * a, t); K.mix(s, K.burst(0.01, { atk: 0.0001, tau: 0.002, hp: 1500 }), 0.5 * a, t); t += R.range(0.17, 0.23); }
    K.mix(s, K.ring(0.3, [[200, 1, 0.06], [350, 0.5, 0.04]], { soft: 0.002 }), 0.5, t + 0.03); K.mix(s, K.burst(0.05, { color: 'pink', atk: 0.001, tau: 0.02, lp: 700 }), 0.4, t + 0.03);
    return s;
  });
  lib.def('board.hit', { n: 3, peak: 0.7, prio: 1 }, (K) => { const R = K.rng, s = K.buf(0.4); K.mix(s, K.ring(0.3, [[R.range(150, 230), 1, 0.06], [R.range(340, 500), 0.6, 0.04], [R.range(700, 1000), 0.3, 0.025]], { soft: 0.002 }), 0.9, 0); K.mix(s, K.burst(0.05, { color: 'pink', atk: 0.001, tau: 0.014, lp: 900 }), 0.6, 0); K.mix(s, crunch(K, 0.1, 400, 0.04, 1200, 4000, 0.002, 0.005, 0.2), 1, 0.01); for (let k = 0; k < 3; k++) K.mix(s, grain(K, R.range(2400, 3400), 0.02), 0.2 / (k + 1), 0.05 + k * 0.03); return s; });
  lib.def('board.break', { n: 2, peak: 0.8, prio: 1 }, (K) => { const R = K.rng, s = K.buf(0.7); K.mix(s, K.burst(0.06, { atk: 0.0004, tau: 0.02, bp: 1500, q: 0.7 }), 0.9, 0); K.mix(s, K.ring(0.3, [[170, 1, 0.07], [330, 0.7, 0.05], [610, 0.5, 0.04], [1200, 0.25, 0.03]], { soft: 0.0015 }), 0.9, 0); K.mix(s, crunch(K, 0.35, 600, 0.12, 1800, 6500, 0.0015, 0.006, 0.3), 1, 0.01); let t = 0.15; for (let b = 0; b < 5; b++) { K.mix(s, K.ring(0.12, [[R.range(140, 300), 1, 0.04]], { soft: 0.002 }), 0.4 * Math.pow(0.6, b), t); t += 0.07 * R.range(0.7, 1.2) * Math.pow(0.8, b); } return s; });

  // ---- zombies: shuffling feet, cloth, dragging limbs
  lib.def('zombie.step', { n: 4, peak: 0.4, prio: 1, meta: { refDist: 2.5, maxDist: 40 } }, (K) => { // dragging, half-lifted foot: sole scuff + wet cloth + soft bone-ish thud
    const R = K.rng, s = K.buf(0.42);
    K.mix(s, swish(K, 0.2, R.range(500, 900), R.range(1500, 2500), 0.7, { atk: 0.05, tau: 0.08 }), 0.7, 0);
    K.mix(s, K.burst(0.08, { color: 'pink', atk: 0.003, tau: 0.03, lp: 420 }), 0.9, 0.14);
    K.mix(s, K.thump(0.12, 85, 45, 0.03, 0.045), 0.5, 0.14);
    K.mix(s, crunch(K, 0.12, 350, 0.05, 1800, 4800, 0.002, 0.006, 0.12), 1, 0.15);
    return s;
  });
  lib.def('zombie.cloth', { n: 4, peak: 0.28, prio: 1, meta: { refDist: 2, maxDist: 25 } }, (K) => { // rotten garment rustle: band noise with irregular fold-crackle AM
    const R = K.rng, n = K.n(0.5), a = K.noise(0.5, 'pink'), w = wander(K, n, R.range(9, 16)); for (let i = 0; i < n; i++) a[i] *= Math.pow(w[i], 2.2);
    K.env(a, { atk: 0.04, tau: 0.16 }); K.hp(a, 700); K.lp(a, R.range(4200, 6500)); return a;
  });
  lib.def('zombie.drag', { n: 3, peak: 0.4, prio: 1, meta: { refDist: 2.5, maxDist: 35 } }, (K) => { const R = K.rng, n = K.n(0.7), a = K.noise(0.7, 'pink'), w = wander(K, n, R.range(5, 9)); for (let i = 0; i < n; i++) a[i] *= 0.3 + 0.7 * w[i]; K.env(a, { atk: 0.1, tau: 0.3 }); K.svf(a, 'bp', 700, 0.6); K.mix(a, K.thump(0.5, 70, 50, 0.1, 0.15), 0.3, 0.1); return a; });

  lib.def('zombie.hit', { n: 3, peak: 0.7, prio: 1, meta: { refDist: 2, maxDist: 40 } }, (K) => { // rotten claw / fist landing on the player: dull body thump, cloth-and-skin slap, wet smack
    const R = K.rng, s = K.buf(0.4);
    K.mix(s, K.thump(0.2, 120, 55, 0.035, 0.07), 0.6, 0); K.mix(s, K.burst(0.1, { color: 'pink', atk: 0.001, tau: 0.03, hp: 120, lp: 1500 }), 0.8, 0); K.mix(s, K.svf(K.burst(0.1, { color: 'pink', atk: 0.0005, tau: 0.03 }), 'bp', 700, 0.8), 0.7, 0.001); K.mix(s, K.burst(0.02, { atk: 0.0002, tau: 0.006, bp: 1800, q: 0.7 }), 0.5, 0.002);
    for (let k = 0; k < 3; k++) K.mix(s, bubble(K, R.range(240, 600), 0.01), 0.14, 0.03 + k * 0.03); return s;
  });
  lib.def('zombie.swing', { n: 3, peak: 0.3, prio: 1, meta: { refDist: 2, maxDist: 30 } }, (K) => { // slow arm through air: low-mid swish + sleeve rustle
    const R = K.rng, d = R.range(0.24, 0.36), s = swish(K, d, R.range(320, 520), R.range(1300, 2100), 0.9, { atk: d * 0.45, tau: d * 0.3 }), c = K.noise(d, 'pink'), w = wander(K, c.length, R.range(14, 22));
    for (let i = 0; i < c.length; i++) c[i] *= Math.pow(w[i], 2); K.env(c, { atk: d * 0.3, tau: d * 0.3 }); K.hp(c, 900); K.lp(c, 5000); K.mix(s, c, 0.3, 0); return s;
  });
  // ---- water: a body/object hitting a surface (splash) and a balloon bursting
  lib.def('water.splash', { n: 4, peak: 0.65, prio: 1, meta: { refDist: 3, maxDist: 45 } }, (K) => { // slap + sheet of spray, entrained-air bubbles (Minnaert, big ones early), droplets pattering back
    const R = K.rng, d = R.range(0.75, 1.05), s = K.buf(d);
    K.mix(s, K.burst(0.18, { color: 'pink', atk: 0.002, tau: 0.055, hp: 300, lp: R.range(5500, 8500) }), 0.85, 0); K.mix(s, K.thump(0.3, 150, 68, 0.04, 0.08), 0.5, 0); K.mix(s, K.burst(0.5, { color: 'pink', atk: 0.02, tau: 0.16, bp: 2600, q: 0.5 }), 0.22, 0.02);
    for (let k = 0, nb = R.int(12, 22); k < nb; k++) { const t = 0.015 + Math.pow(R.next(), 1.4) * 0.45, f = R.range(260, 2300) * (1.2 - 0.6 * t); K.mix(s, bubble(K, f, R.range(0.005, 0.018), R.range(1.2, 1.65)), R.range(0.1, 0.42) * (1 - t * 0.9), t); }
    K.mix(s, crunch(K, d - 0.1, 100, 0.28, 2500, 7500, 0.001, 0.004, 0.24), 1, 0.08); return s;
  });
  lib.def('balloon.pop', { n: 3, peak: 0.85, prio: 1, meta: { refDist: 3, maxDist: 60 } }, (K) => { // stretched latex/foil rupture: shock click, broadband crack, torn-rubber band noise, brief air-puff body
    const R = K.rng, s = K.buf(0.25);
    K.mix(s, K.burst(0.004, { atk: 0.00002, tau: 0.0008, hp: 800 }), 1, 0); K.mix(s, K.burst(0.03, { atk: 0.0001, tau: 0.008, hp: 1500, lp: 12000 }), 0.9, 0.0005); K.mix(s, K.burst(0.06, { atk: 0.0002, tau: 0.014, bp: R.range(2400, 3600), q: 0.5 }), 0.5, 0.002);
    K.mix(s, K.ring(0.1, [[R.range(520, 780), 0.6, 0.012], [R.range(1400, 1900), 0.35, 0.008]], { soft: 0.001 }), 0.3, 0); K.mix(s, K.thump(0.06, 150, 80, 0.015, 0.02), 0.25, 0); return s;
  });

  // ---- melee
  lib.def('melee.swing', { n: 3, peak: 0.45, prio: 1, meta: { refDist: 1.5 } }, (K) => { const R = K.rng, d = R.range(0.16, 0.22), s = swish(K, d, R.range(700, 1000), R.range(2600, 3400), 1.4, { atk: d * 0.4, tau: d * 0.3 }); K.mix(s, K.svf(K.noise(d), 'bp', R.range(3400, 4400), 6), 0.06, 0); return s; });
  lib.def('melee.hit', { n: 3, peak: 0.7, prio: 1 }, (K) => { const s = K.buf(0.35); K.mix(s, K.thump(0.14, 130, 60, 0.03, 0.05), 0.9, 0); K.mix(s, K.burst(0.05, { color: 'pink', atk: 0.0008, tau: 0.02, lp: 900 }), 0.7, 0); K.mix(s, K.burst(0.015, { atk: 0.0002, tau: 0.004, bp: 1800, q: 0.8 }), 0.5, 0); for (let k = 0; k < 4; k++) K.mix(s, bubble(K, K.rng.range(250, 600), 0.01), 0.15, 0.03 + k * 0.03); return s; });
  lib.def('melee.stab', { n: 3, peak: 0.6, prio: 1 }, (K) => { const R = K.rng, s = K.buf(0.3); K.mix(s, K.burst(0.02, { atk: 0.0002, tau: 0.006, bp: 1500, q: 0.6 }), 0.8, 0); K.mix(s, K.thump(0.1, 180, 90, 0.02, 0.03), 0.6, 0.005); K.mix(s, K.svf(K.burst(0.14, { color: 'pink', atk: 0.006, tau: 0.05 }), 'bp', 700, 1.2), 0.5, 0.01); for (let k = 0; k < 3; k++) K.mix(s, bubble(K, R.range(300, 700), 0.01), 0.15, 0.04 + k * 0.03); return s; });
  lib.def('melee.bash', { n: 3, peak: 0.75, prio: 1 }, (K) => { const s = K.buf(0.4); K.mix(s, K.thump(0.18, 110, 50, 0.04, 0.06), 1, 0); K.mix(s, K.burst(0.03, { atk: 0.0002, tau: 0.008, hp: 500, lp: 5000 }), 0.7, 0); K.mix(s, K.ring(0.15, [[420, 1, 0.03], [900, 0.4, 0.02]], { soft: 0.002 }), 0.4, 0); return s; });

  // ---- player movement / body
  lib.def('player.land', { n: 3, peak: 0.6, prio: 1, meta: { refDist: 1 } }, (K) => { const R = K.rng, s = K.buf(0.35); K.mix(s, K.thump(0.2, 95, 42, 0.05, 0.08), 0.9, 0); K.mix(s, K.burst(0.1, { color: 'pink', atk: 0.002, tau: 0.03, lp: 800 }), 0.6, 0); K.mix(s, K.burst(0.05, { atk: 0.0004, tau: 0.01, hp: 1200, lp: 6000 }), 0.3, 0); K.mix(s, K.burst(0.2, { atk: 0.02, tau: 0.08, bp: 2600, q: 0.6 }), 0.1, 0.03); return s; });
  lib.def('player.jump', { n: 2, peak: 0.3, prio: 1, meta: { refDist: 1 } }, (K) => { const s = K.buf(0.28); K.mix(s, K.burst(0.2, { atk: 0.02, tau: 0.07, bp: 2000, q: 0.5 }), 0.4, 0); K.mix(s, K.thump(0.1, 110, 60, 0.03, 0.03), 0.3, 0); return s; });
  lib.def('player.heartbeat', { n: 2, peak: 0.7, prio: 1, meta: { bus: 'sfx', refDist: 1, maxDist: 10, send: 0.1 } }, (K) => { // "lub-dub": two closing-valve thumps, LF heavy with a little 200 Hz body so it survives laptop speakers
    const R = K.rng, s = K.buf(0.9), lub = K.thump(0.22, 66, 38, 0.05, 0.07), dub = K.thump(0.2, 80, 46, 0.04, 0.06);
    K.mix(s, lub, 1, 0); K.mix(s, K.burst(0.05, { color: 'pink', atk: 0.002, tau: 0.02, lp: 240 }), 0.5, 0); K.mix(s, dub, 0.72, 0.17 + R.range(-0.01, 0.01)); K.mix(s, K.burst(0.04, { color: 'pink', atk: 0.002, tau: 0.015, lp: 280 }), 0.35, 0.17); K.lp(s, 420); return s;
  });
}
