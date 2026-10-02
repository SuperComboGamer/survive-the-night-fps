// Procedural sounds of the chapel bell and the Relay Station's radio (shared/fixtures.js). Pure generators like
// synth.js: (sampleRate, rng) => Float32Array, peak-normalised.
import { TAU, alloc, finish, hann } from './dsp.js';
import { MID, LO, addNorm, noise, creak, rustle, metalClick } from './synth.js';

// ------------------------------------------------------------------ the bell
// One toll of a church bell, by its partials: the hum an octave under the strike note, the prime, the tierce a minor
// third over it (what makes a bell sound like a bell and not a gong), the quint, the nominal an octave up, and the
// short-lived upper ones that are the clang of the clapper. [ratio to the strike note, level, seconds to 1/e].
// Every partial is a pair a fraction of a hertz apart: no bell is quite round, and the two beat slowly against each
// other. One variant: it is one bell, and every toll of it is the same note.
const BELL_NOTE = 233.1; // the strike note (a B flat: a small country bell, low enough to carry)
const BELL_PARTIALS = [
  [0.5, 0.5, 5.2],
  [1, 0.9, 3.4],
  [1.189, 0.75, 2.7],
  [1.498, 0.3, 1.7],
  [2, 1, 2.0],
  [2.52, 0.3, 1.0],
  [3.01, 0.42, 0.75],
  [4.07, 0.32, 0.45],
  [5.43, 0.2, 0.28],
  [6.81, 0.12, 0.18],
];
export function bellToll(sr, rng) {
  const out = alloc(sr, 7.5);
  BELL_PARTIALS.forEach(([ratio, level, tau], k) => {
    const f = BELL_NOTE * ratio;
    const beat = 0.35 + 0.27 * k; // Hz between the pair
    const w1 = (TAU * f) / sr;
    const w2 = (TAU * (f + beat)) / sr;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const env = Math.exp(-t / tau) * Math.min(1, t / 0.003);
      out[i] += level * env * (0.62 * Math.sin(w1 * i) + 0.38 * Math.sin(w2 * i + k));
    }
  });
  // the clapper: a knock of iron on bronze at the very start
  addNorm(out, noise(sr, rng, 0.03, { bp: [1900, 1.4], a: 0.0006, d: 0.008 }), sr, 0, 0.9);
  addNorm(out, metalClick(sr, rng, 1260, 0.02), sr, 0, 0.5);
  return finish(out, sr, 0.9, 0.0008, 1.2);
}

// the rope taken up: the headstock creaks over on its bearings and the rope runs through a hand
export function bellRope(sr, rng) {
  const out = alloc(sr, 1.3);
  addNorm(out, creak(sr, rng, 1.1, 14, 46, 0.7), sr, 0.05, 0.8);
  addNorm(out, rustle(sr, rng, 0.5, 1500), sr, 0, 0.35);
  addNorm(out, rustle(sr, rng, 0.45, 1300), sr, 0.7, 0.3);
  return finish(out, sr, 0.85, 0.01, 0.1);
}

// ------------------------------------------------------------------ the radio
// a band of static with its level drawn by env(u), u = 0..1 over the burst
function hiss(sr, rng, dur, f, q, env) {
  return noise(sr, rng, dur, { bp: [f, q], env });
}
// a steady tone with rounded ends
function tone(sr, f, dur) {
  const out = alloc(sr, dur);
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((TAU * f * i) / sr) * Math.min(1, i / (0.006 * sr), (out.length - i) / (0.012 * sr));
  return out;
}

// keyed up: the switch, static, and the whistle of a carrier being tuned in
export function radioTune(sr, rng) {
  const dur = 1.5;
  const out = alloc(sr, dur);
  addNorm(out, metalClick(sr, rng, 2100, 0.008), sr, 0, 0.7);
  addNorm(out, hiss(sr, rng, dur - 0.05, 1900, 0.5, (u) => Math.min(1, u * 10) * (0.55 + 0.45 * Math.sin(u * 23) ** 2) * (1 - u * 0.5)), sr, 0.04, 0.55);
  const whistle = alloc(sr, 1.0);
  let ph = 0;
  for (let i = 0; i < whistle.length; i++) {
    const u = i / whistle.length;
    ph += (2600 * Math.pow(0.24, u) + 60 * Math.sin(u * 40)) / sr; // sliding down onto the frequency
    whistle[i] = Math.sin(TAU * ph) * hann(u) * (0.6 + 0.4 * Math.sin(u * 31));
  }
  addNorm(out, whistle, sr, 0.25, 0.3);
  return finish(out, sr, 0.85, 0.001, 0.15);
}

// the call going out: three rising call tones, a few clipped words of somebody answering through the static, and
// the squelch closing
export function radioCall(sr, rng) {
  const out = alloc(sr, 3.2);
  addNorm(out, hiss(sr, rng, 3.1, 1800, 0.5, (u) => Math.min(1, u * 30) * (u > 0.93 ? (1 - u) / 0.07 : 1) * (0.7 + 0.3 * Math.sin(u * 57) ** 2)), sr, 0.02, 0.3);
  [1050, 1320, 1760].forEach((f, k) => addNorm(out, tone(sr, f, k === 2 ? 0.34 : 0.2), sr, 0.12 + k * 0.24, 0.6));
  // the answer: syllables of band-limited noise around a voice's formants, too far gone to make out
  let t = 1.25;
  for (let k = 0; k < 7; k++) {
    const len = 0.09 + rng() * 0.13;
    const f = 500 + rng() * 900;
    addNorm(out, hiss(sr, rng, len, f, 3.5, hann), sr, t, 0.5);
    addNorm(out, hiss(sr, rng, len, f * 2.3, 4, hann), sr, t, 0.25);
    t += len + 0.03 + (k === 3 ? 0.16 : 0) + rng() * 0.05;
  }
  addNorm(out, metalClick(sr, rng, 2300, 0.006), sr, 3.0, 0.6);
  return finish(out, sr, 0.85, 0.001, 0.08);
}

// { bank, n, sr, group, gen } as SFX_DEFS in synth.js (registry.js lists them with the rest)
export const FIXTURE_DEFS = [
  { bank: 'bell_toll', n: 1, sr: LO, group: 'late', gen: bellToll },
  { bank: 'bell_rope', n: 2, sr: MID, group: 'late', gen: bellRope },
  { bank: 'radio_tune', n: 2, sr: MID, group: 'late', gen: radioTune },
  { bank: 'radio_call', n: 2, sr: MID, group: 'late', gen: radioCall },
];
