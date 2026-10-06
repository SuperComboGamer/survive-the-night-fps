// Procedural sounds of blows on the world (shared/surfaces.js soundFor) and of a wreck coming apart
// (client/render/wrecks.js). Pure, like synth.js: (sampleRate, rng) => Float32Array, peak-normalised.
//
// A struck thing is an exciter - the knock of the weapon, a few milliseconds of noise shaped by how hard and how
// sharp it is - into a bank of modes: sheet steel rings low and short with a rattle after it, a blade rings high and
// long, stone hardly rings at all and leaves grit, earth and cloth and rubber only thud. The recorded impacts
// (audio.js R_*) are laid over these where there is one; these give each weapon its own voice under it.
import { TAU, ModeBank, Biquad, Pink, alloc, finish, softclip } from './dsp.js';
import { HI, MID } from './synth.js';

// an exciter: `ms` of noise falling away, lowpassed at `lp` Hz (a soft thing strikes dull)
function knock(sr, rng, n, ms, lp, gain = 1, at = 0) {
  const ex = new Float32Array(n);
  const len = Math.max(2, Math.floor((ms / 1000) * sr));
  const f = new Biquad().lp(sr, lp, 0.7);
  const i0 = Math.floor(at * sr);
  for (let i = 0; i < len && i0 + i < n; i++) ex[i0 + i] = f.run((rng() * 2 - 1) * (1 - i / len) ** 2) * gain;
  return ex;
}
const modes = (rng, list, spread = 0.03) => list.map(([f, d, a]) => ({ f: f * (1 + (rng() - 0.5) * spread), d, a }));
const ring = (sr, ex, list) => {
  const bank = new ModeBank(sr, list);
  const out = new Float32Array(ex.length);
  for (let i = 0; i < ex.length; i++) out[i] = bank.run(ex[i]);
  return out;
};
const add = (dst, src, g = 1) => {
  for (let i = 0; i < dst.length && i < src.length; i++) dst[i] += src[i] * g;
  return dst;
};
// noise through a band, with its own envelope env(t)
function band(sr, rng, n, f, q, env) {
  const out = new Float32Array(n);
  const b = new Biquad().bp(sr, f, q);
  for (let i = 0; i < n; i++) out[i] = b.run(rng() * 2 - 1) * env(i / sr);
  return out;
}

// a car's panel: a hollow boom, the sheet's own low modes, and what is loose in the door rattling after it
function panel(sr, rng) {
  const n = alloc(sr, 0.7).length;
  const f0 = 92 + rng() * 40;
  const out = ring(sr, knock(sr, rng, n, 9, 900, 1), modes(rng, [[f0, 0.09, 1], [f0 * 1.63, 0.07, 0.8], [f0 * 2.37, 0.05, 0.6], [f0 * 3.9, 0.04, 0.5], [f0 * 6.1, 0.03, 0.32], [f0 * 9.7, 0.02, 0.2]], 0.08));
  for (let k = 0; k < 4; k++) add(out, ring(sr, knock(sr, rng, n, 2, 5000, 0.16 / (k + 1), 0.03 + k * 0.035 + rng() * 0.02), modes(rng, [[1900, 0.012, 1], [3300, 0.008, 0.6]], 0.3)));
  return finish(softclip(out, 1.6), sr, 0.9);
}
// a knife's point on steel: a tick, a thin ring, the scrape of the edge drawn off it
function tink(sr, rng) {
  const n = alloc(sr, 0.32).length;
  const f0 = 2600 + rng() * 1400;
  const out = ring(sr, knock(sr, rng, n, 1.2, 12000, 1), modes(rng, [[f0, 0.05, 1], [f0 * 1.52, 0.035, 0.6], [f0 * 2.31, 0.02, 0.4], [f0 * 0.41, 0.02, 0.35]], 0.05));
  add(out, band(sr, rng, n, 5200 + rng() * 2000, 2.2, (t) => (t < 0.02 ? 0 : Math.exp(-(t - 0.02) / 0.045) * (0.6 + 0.4 * Math.sin(t * 900)))), 0.05);
  return finish(out, sr, 0.85);
}
// a machete's flat on steel: the blade itself rings, long
function blade(sr, rng) {
  const n = alloc(sr, 0.9).length;
  const f0 = 640 + rng() * 260;
  const out = ring(sr, knock(sr, rng, n, 2.5, 9000, 1), modes(rng, [[f0, 0.22, 0.8], [f0 * 2.76, 0.3, 1], [f0 * 5.4, 0.2, 0.7], [f0 * 8.93, 0.11, 0.45], [f0 * 13.3, 0.06, 0.25], [f0 * 0.5, 0.05, 0.4]], 0.02));
  add(out, band(sr, rng, n, 3000, 0.8, (t) => Math.exp(-t / 0.012)), 0.3);
  return finish(softclip(out, 1.3), sr, 0.9);
}
// stone or brick: a hard click, almost no ring, grit falling
function stone(sr, rng) {
  const n = alloc(sr, 0.45).length;
  const out = ring(sr, knock(sr, rng, n, 1.5, 9000, 1), modes(rng, [[1500, 0.008, 1], [2900, 0.006, 0.8], [4700, 0.004, 0.5], [640, 0.012, 0.6]], 0.3));
  const grit = new Float32Array(n);
  for (let k = 0; k < 14; k++) add(grit, knock(sr, rng, n, 1 + rng() * 2, 7000, 0.05 + rng() * 0.08, 0.04 + rng() * 0.3));
  const hp = new Biquad().hp(sr, 1800, 0.7);
  for (let i = 0; i < n; i++) out[i] += hp.run(grit[i]) * 2.2;
  return finish(out, sr, 0.85);
}
// turf: a dull thump and the patter of earth
function earth(sr, rng) {
  const n = alloc(sr, 0.4).length;
  const out = ring(sr, knock(sr, rng, n, 14, 500, 1), modes(rng, [[70, 0.05, 1], [118, 0.035, 0.7], [210, 0.02, 0.4]], 0.2));
  add(out, band(sr, rng, n, 900, 0.6, (t) => Math.exp(-t / 0.05) * 0.5 + (t > 0.08 ? Math.exp(-(t - 0.08) / 0.09) * 0.12 * (rng() < 0.2 ? 1 : 0.2) : 0)), 0.5);
  return finish(out, sr, 0.85);
}
// canvas: the rip of it, rising
function cloth(sr, rng) {
  const n = alloc(sr, 0.34).length;
  const out = new Float32Array(n);
  const b = new Biquad();
  const pk = new Pink(rng);
  let tooth = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i % 24 === 0) b.bp(sr, 1400 + 5200 * (t / 0.3), 1.4);
    // (thread after thread letting go)
    tooth = i % Math.max(8, Math.floor(sr / (260 + 900 * (t / 0.3)))) === 0 ? 1 : tooth * 0.9;
    out[i] = b.run(pk.next() * 3 + (rng() * 2 - 1)) * tooth * Math.min(1, t / 0.01) * Math.exp(-Math.max(0, t - 0.2) / 0.05);
  }
  return finish(out, sr, 0.8);
}
// glass that holds: a sharp tick and the crackle of the crack running
function glass(sr, rng) {
  const n = alloc(sr, 0.3).length;
  const f0 = 3600 + rng() * 1500;
  const out = ring(sr, knock(sr, rng, n, 0.8, 14000, 1), modes(rng, [[f0, 0.03, 1], [f0 * 1.47, 0.02, 0.7], [f0 * 2.2, 0.012, 0.5]], 0.06));
  for (let k = 0; k < 9; k++) add(out, ring(sr, knock(sr, rng, n, 0.5, 14000, 0.3 * rng(), 0.012 + rng() * 0.16), modes(rng, [[5200 + rng() * 3000, 0.006, 1]], 0.1)));
  return finish(out, sr, 0.8);
}
// a tyre: rubber, dead and low
function tyre(sr, rng) {
  const n = alloc(sr, 0.35).length;
  const out = ring(sr, knock(sr, rng, n, 16, 420, 1), modes(rng, [[86, 0.06, 1], [150, 0.04, 0.7], [240, 0.025, 0.4], [520, 0.01, 0.2]], 0.15));
  return finish(softclip(out, 1.4), sr, 0.85);
}
// ...and the air going out of it
function hiss(sr, rng) {
  const n = alloc(sr, 1.9).length;
  const out = new Float32Array(n);
  const hp = new Biquad().hp(sr, 2400, 0.8), bp = new Biquad().bp(sr, 6200, 0.9);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = rng() * 2 - 1;
    out[i] = (hp.run(x) * 0.6 + bp.run(x)) * Math.min(1, t / 0.02) * Math.exp(-t / 0.55) * (1 + 0.15 * Math.sin(TAU * 31 * t));
  }
  return finish(out, sr, 0.7, 0.002, 0.2);
}
// a rusted hinge: the pin sticking and letting go, faster as the panel swings, in the panel's own resonance
function creak(sr, rng) {
  const n = alloc(sr, 0.75).length;
  const ex = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / 0.7;
    ph += (55 + 150 * Math.sin(Math.PI * Math.min(1, u)) ** 2 * (1 + (rng() - 0.5) * 0.25)) / sr;
    if (ph >= 1) {
      ph -= 1;
      const a = (0.5 + rng() * 0.5) * Math.sin(Math.PI * Math.min(1, u));
      for (let j = 0; j < 40 && i + j < n; j++) ex[i + j] += (rng() * 2 - 1) * (1 - j / 40) * a;
    }
  }
  const f0 = 430 + rng() * 240;
  const out = ring(sr, ex, modes(rng, [[f0, 0.012, 1], [f0 * 2.21, 0.01, 0.9], [f0 * 3.7, 0.007, 0.7], [f0 * 6.3, 0.005, 0.4]], 0.05));
  return finish(softclip(out, 1.5), sr, 0.75);
}
// a piece of trim on the ground: it lands, skips twice, and rings itself still
function drop(sr, rng) {
  const n = alloc(sr, 0.95).length;
  const out = new Float32Array(n);
  const f0 = 520 + rng() * 500;
  const m = modes(rng, [[f0, 0.05, 1], [f0 * 2.13, 0.045, 0.9], [f0 * 3.41, 0.03, 0.7], [f0 * 5.77, 0.02, 0.5], [f0 * 8.2, 0.014, 0.3]], 0.04);
  let t = 0, gap = 0.2 + rng() * 0.08, a = 1;
  for (let k = 0; k < 5; k++) {
    add(out, ring(sr, knock(sr, rng, n, 2.5, 7000, a, t), m));
    t += gap;
    gap *= 0.55;
    a *= 0.55;
  }
  return finish(softclip(out, 1.4), sr, 0.85);
}
// the alarm's warning: two beeps from a horn with not much behind it
function chirp(sr) {
  const n = alloc(sr, 0.36).length;
  const out = new Float32Array(n);
  const lp = new Biquad().lp(sr, 4200, 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const on = (t < 0.09 ? 1 : t > 0.17 && t < 0.27 ? 1 : 0) * 1;
    const ph = (2750 * t) % 1;
    out[i] = lp.run((ph < 0.5 ? 1 : -1) * on) * (0.8 + 0.2 * Math.sin(TAU * 38 * t));
  }
  return finish(out, sr, 0.7, 0.001, 0.01);
}
// ...and the alarm itself: one whoop of a two-tone horn, its pitch sagging as the battery does. Played end to end
function alarm(sr, rng) {
  const dur = 0.84;
  const n = alloc(sr, dur).length;
  const out = new Float32Array(n);
  const f1 = new Biquad().bp(sr, 1150, 2.2), f2 = new Biquad().bp(sr, 2600, 2.5), lp = new Biquad().lp(sr, 5200, 0.7);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / dur;
    const f = (620 + 620 * (u < 0.62 ? u / 0.62 : 1 - (u - 0.62) / 0.38 * 0.25)) * (1 - 0.02 * Math.sin(TAU * 5 * t));
    p1 = (p1 + f / sr) % 1;
    p2 = (p2 + (f * 1.26) / sr) % 1;
    const saw = 2 * p1 - 1 + 0.7 * (2 * p2 - 1) + (rng() - 0.5) * 0.04;
    const x = lp.run(saw);
    out[i] = (x * 0.4 + f1.run(x) * 1.2 + f2.run(x) * 0.7) * Math.min(1, t / 0.012) * Math.min(1, (dur - t) / 0.03);
  }
  return finish(softclip(out, 1.8), sr, 0.8, 0.002, 0.01);
}

// { bank, n (variants), sr, gen } rows for registry.js, as SFX_DEFS in synth.js
export const STRIKE_DEFS = [
  { bank: 'strike_panel', n: 3, sr: MID, gen: panel },
  { bank: 'strike_tink', n: 3, sr: HI, gen: tink },
  { bank: 'strike_blade', n: 3, sr: HI, gen: blade },
  { bank: 'strike_stone', n: 3, sr: HI, gen: stone },
  { bank: 'strike_earth', n: 2, sr: MID, gen: earth },
  { bank: 'strike_cloth', n: 2, sr: HI, gen: cloth },
  { bank: 'strike_glass', n: 3, sr: HI, gen: glass },
  { bank: 'strike_tyre', n: 2, sr: MID, gen: tyre },
  { bank: 'tyre_hiss', n: 1, sr: HI, group: 'late', gen: hiss },
  { bank: 'hinge_creak', n: 2, sr: MID, group: 'late', gen: creak },
  { bank: 'part_drop', n: 3, sr: HI, group: 'late', gen: drop },
  { bank: 'car_chirp', n: 1, sr: MID, group: 'late', gen: chirp },
  { bank: 'car_alarm', n: 1, sr: MID, group: 'late', gen: alarm },
];
