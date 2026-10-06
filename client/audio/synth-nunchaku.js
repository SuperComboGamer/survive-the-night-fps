// Procedural sounds of the nunchucks (ITEM.NUNCHAKU). Pure like synth.js: (sampleRate, rng) => Float32Array,
// peak-normalised. What plays them, and at what pitch, is the simulated chain's own motion (client/game/nunchaku.js):
// a whoosh each time the free handle comes round, pitched by how fast it is going; the chain's rattle when it is
// pulled up taut; the knock of one handle on the other; the slap of a catch in the palm; and what the hardwood
// strikes - flesh, bone, wood, metal, the ground.
import { rrange, alloc, finish, softclip, Biquad, Pink } from './dsp.js';
import { HI, addNorm, thump, noise, modal, metalClick, woodModes, metalModes, crackles } from './synth.js';

// A handle through the air: short, breathy, a narrow band that sweeps up and away. Higher and tighter than a bat's
// swing (the handle is a third of the weight and four times as fast); played faster still for a faster handle.
export function nkWhoosh(sr, rng) {
  const dur = rrange(rng, 0.15, 0.19);
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const a = new Biquad(), b = new Biquad();
  const pk = new Pink(rng);
  const f0 = rrange(rng, 650, 800), fpk = rrange(rng, 2300, 2900), f1 = rrange(rng, 1100, 1400);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 15) === 0) {
      const f = u < 0.45 ? f0 * Math.pow(fpk / f0, u / 0.45) : fpk * Math.pow(f1 / fpk, (u - 0.45) / 0.55);
      a.bp(sr, f, 2.6);
      b.bp(sr, f * 2.2, 3.2); // the chain's own thin whistle, above the wood's
    }
    const x = pk.next() * 2 + (rng() * 2 - 1) * 0.4;
    const e = u < 0.45 ? Math.pow(u / 0.45, 2) : Math.pow(1 - (u - 0.45) / 0.55, 1.6);
    out[i] = (a.run(x) + b.run(x) * 0.35) * e;
  }
  return finish(out, sr);
}

// The chain pulled up short: a handful of links knocking together, bright and dry (welded steel, no ring to speak of)
export function nkRattle(sr, rng) {
  const out = alloc(sr, 0.16);
  const links = 3 + Math.floor(rng() * 3);
  let t = 0;
  for (let k = 0; k < links; k++) {
    addNorm(out, metalClick(sr, rng, rrange(rng, 3400, 6200), rrange(rng, 0.004, 0.009)), sr, t, rrange(rng, 0.4, 1) * (1 - k / (links + 1)));
    t += rrange(rng, 0.006, 0.022);
  }
  addNorm(out, noise(sr, rng, 0.03, { hp: 5000, a: 0.0003, d: 0.006 }), sr, 0, 0.25);
  return finish(out, sr);
}

// hardwood on hardwood: the two handles knocking - a short bright knock with the note of a small dense bar
const BAR = (rng, k = 1) => [
  { f: 1150 * k * rrange(rng, 0.96, 1.04), d: 0.028, a: 1 },
  { f: 2980 * k * rrange(rng, 0.95, 1.05), d: 0.014, a: 0.6 },
  { f: 5600 * k * rrange(rng, 0.95, 1.05), d: 0.007, a: 0.35 },
  { f: 420 * k * rrange(rng, 0.95, 1.05), d: 0.02, a: 0.3 },
];
export function nkClack(sr, rng) {
  const out = alloc(sr, 0.14);
  addNorm(out, modal(sr, rng, BAR(rng, rrange(rng, 0.92, 1.12)), 0.13, 0.5, 6000), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.012, { bp: [3500, 1.2], a: 0.0002, d: 0.003 }), sr, 0, 0.4);
  return finish(out, sr);
}

// caught: the handle into the palm of a glove. A soft slap, the wood's knock muffled under it, the chain settling after
export function nkCatch(sr, rng) {
  const out = alloc(sr, 0.22);
  addNorm(out, noise(sr, rng, 0.05, { bp: [rrange(rng, 900, 1300), 1.1], a: 0.0006, d: 0.014 }), sr, 0, 1);
  addNorm(out, thump(sr, 150, 90, 0.012, 0.022), sr, 0, 0.55);
  addNorm(out, modal(sr, rng, BAR(rng, 0.8), 0.05, 0.6, 1800), sr, 0.001, 0.3);
  addNorm(out, nkRattle(sr, rng), sr, 0.02, 0.22);
  return finish(out, sr);
}

// ---- what it strikes
// flesh: the wood's crack, dull, over a dead thud - a blunt blow, no wet in it
export function nkHitFlesh(sr, rng) {
  const out = alloc(sr, 0.34);
  addNorm(out, thump(sr, rrange(rng, 105, 130), 55, 0.018, 0.045), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.07, { bp: [rrange(rng, 1000, 1400), 1.6], a: 0.0005, d: 0.018 }), sr, 0, 0.8);
  addNorm(out, modal(sr, rng, BAR(rng, 0.7), 0.06, 0.6, 2200), sr, 0, 0.45);
  softclip(out, 1.5);
  return finish(out, sr);
}
// bone (a skull): the same, with a hard crack on the front of it and something giving
export function nkHitBone(sr, rng) {
  const out = alloc(sr, 0.4);
  addNorm(out, modal(sr, rng, [{ f: rrange(rng, 1700, 2100), d: 0.012, a: 1 }, { f: rrange(rng, 3300, 3900), d: 0.007, a: 0.7 }, { f: rrange(rng, 640, 760), d: 0.02, a: 0.6 }], 0.08, 0.4, 8000), sr, 0, 1);
  addNorm(out, thump(sr, rrange(rng, 120, 140), 60, 0.015, 0.04), sr, 0, 0.8);
  addNorm(out, crackles(sr, rng, 0.05, 420, { hp: 1900, bp: 3200 }), sr, 0.004, 0.5);
  addNorm(out, modal(sr, rng, BAR(rng, 0.9), 0.07, 0.5, 4000), sr, 0, 0.5);
  softclip(out, 1.6);
  return finish(out, sr);
}
// wood (a tree, a wall, a barricade): two pieces of timber, the big one booming under the handle's knock
export function nkHitWood(sr, rng) {
  const out = alloc(sr, 0.4);
  addNorm(out, modal(sr, rng, BAR(rng, rrange(rng, 0.9, 1.1)), 0.13, 0.5, 7000), sr, 0, 1);
  addNorm(out, modal(sr, rng, woodModes(rng, rrange(rng, 0.9, 1.2)), 0.36, 1.2, 2600), sr, 0.001, 0.75);
  addNorm(out, thump(sr, 130, 75, 0.015, 0.03), sr, 0, 0.4);
  return finish(out, sr);
}
// metal (a wreck, a steel wall): the knock, and the sheet it struck ringing on
export function nkHitMetal(sr, rng) {
  const out = alloc(sr, 0.9);
  addNorm(out, modal(sr, rng, BAR(rng, rrange(rng, 1, 1.15)), 0.1, 0.4, 9000), sr, 0, 0.9);
  addNorm(out, modal(sr, rng, metalModes(rng, rrange(rng, 380, 560), 0.55), 0.9, 0.5), sr, 0.001, 1);
  addNorm(out, noise(sr, rng, 0.02, { hp: 3500, a: 0.0002, d: 0.004 }), sr, 0, 0.45);
  return finish(out, sr);
}
// the ground, masonry: a dead knock and grit
export function nkHitDirt(sr, rng) {
  const out = alloc(sr, 0.3);
  addNorm(out, thump(sr, 110, 60, 0.014, 0.035), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.09, { bp: [rrange(rng, 1800, 2600), 0.9], a: 0.0005, d: 0.022 }), sr, 0, 0.6);
  addNorm(out, modal(sr, rng, BAR(rng, 0.75), 0.05, 0.6, 2500), sr, 0, 0.4);
  return finish(out, sr);
}

// snapped open on the draw: the chain running out, and the handle it was folded against let go
export function nkDraw(sr, rng) {
  const out = alloc(sr, 0.4);
  addNorm(out, nkClack(sr, rng), sr, 0.02, 0.5);
  for (let k = 0; k < 3; k++) addNorm(out, nkRattle(sr, rng), sr, 0.04 + k * rrange(rng, 0.03, 0.05), 0.7 - k * 0.15);
  addNorm(out, nkWhoosh(sr, rng), sr, 0.08, 0.55);
  return finish(out, sr);
}

// { bank, n (variants), sr, gen } rows for registry.js, as SFX_DEFS in synth.js
export const NUNCHAKU_DEFS = [
  { bank: 'nk_whoosh', n: 4, sr: HI, gen: nkWhoosh },
  { bank: 'nk_rattle', n: 5, sr: HI, gen: nkRattle },
  { bank: 'nk_clack', n: 3, sr: HI, gen: nkClack },
  { bank: 'nk_catch', n: 3, sr: HI, gen: nkCatch },
  { bank: 'nk_hit_flesh', n: 3, sr: HI, gen: nkHitFlesh },
  { bank: 'nk_hit_bone', n: 2, sr: HI, gen: nkHitBone },
  { bank: 'nk_hit_wood', n: 3, sr: HI, gen: nkHitWood },
  { bank: 'nk_hit_metal', n: 3, sr: HI, gen: nkHitMetal },
  { bank: 'nk_hit_dirt', n: 2, sr: HI, gen: nkHitDirt },
  { bank: 'nk_draw', n: 1, sr: HI, gen: nkDraw },
];
