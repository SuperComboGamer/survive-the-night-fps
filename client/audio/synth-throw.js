// Procedural sound of the noisemaker (ITEM.DECOY): a wind-up twin-bell alarm clock ringing where it landed. Pure like
// synth.js: (sampleRate, rng) => Float32Array, peak-normalised.
//
// The hammer on its spring flies between the two bells about twenty times a second and strikes each in turn. A small
// thin-walled steel bell rings at a few inharmonic partials (no tierce: what makes it a clock bell and not a church
// bell is that it is tiny and shrill); the two bells are a little out of tune with each other, so the ring has a
// rough, insistent beat. The spring winding down shows as the hammer's rate and force wandering a little.
import { TAU, ModeBank, Biquad, Pink, normalize, softclip, dcBlock, loopify } from './dsp.js';
import { MID } from './synth.js';

// [ratio to the bell's strike note, level, seconds to 1/e] - a thin steel cup
const CUP = [
  [1, 1, 0.22],
  [2.27, 0.55, 0.11],
  [3.9, 0.32, 0.06],
  [5.96, 0.18, 0.035],
  [8.3, 0.08, 0.02],
];
const BELL_A = 2340;
const BELL_B = 2610;
const HAMMER = 19.5; // swings a second (each one strikes both bells)

export function loopAlarm(sr, rng) {
  const L = 2; // the loop
  const X = 0.15;
  const n = Math.ceil((L + X) * sr);
  const exA = new Float32Array(n);
  const exB = new Float32Array(n);
  const rattle = new Float32Array(n);
  const len = Math.max(2, Math.floor(0.0007 * sr));
  // strike times: the hammer swings at HAMMER Hz, a little uneven (the spring), hitting A then B half a swing later
  let ph = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const rate = HAMMER * (1 + 0.025 * Math.sin((TAU * t) / L) + (rng() - 0.5) * 0.01);
    ph += (2 * rate) / sr;
    if (ph < 1) continue;
    ph -= 1;
    const ex = k++ & 1 ? exB : exA;
    const force = (0.8 + rng() * 0.35) * (1 + 0.08 * Math.sin((TAU * 2 * t) / L));
    for (let j = 0; j < len && i + j < n; j++) {
      const env = 1 - j / len;
      ex[i + j] += (rng() * 2 - 1) * env * force;
      rattle[i + j] += (rng() * 2 - 1) * env * force;
    }
  }
  const bell = (f0) => new ModeBank(sr, CUP.map(([r, a, d]) => ({ f: f0 * r * (1 + (rng() - 0.5) * 0.004), d, a })));
  const A = bell(BELL_A);
  const B = bell(BELL_B);
  // the clockwork's own buzz: the hammer arm and the case it is riveted to, and a breath of the escapement
  const tick = new Biquad().bp(sr, 5200, 1.5);
  const box = new ModeBank(sr, [{ f: 610, d: 0.018, a: 1 }, { f: 1430, d: 0.01, a: 0.6 }]);
  const air = new Biquad().hp(sr, 3000, 0.7);
  const pk = new Pink(rng);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = A.run(exA[i]) + B.run(exB[i]) * 0.9 + tick.run(rattle[i]) * 0.5 + box.run(rattle[i]) * 0.35 + air.run(pk.next()) * 0.012;
  }
  softclip(out, 1.4);
  for (let i = 0; i < n; i++) if (out[i] !== out[i]) out[i] = 0;
  dcBlock(out, sr);
  return normalize(loopify(out, sr, X), 0.8);
}

// { bank, n (variants), sr, gen } rows for registry.js, as SFX_DEFS in synth.js
export const THROW_DEFS = [{ bank: 'loop_alarm', n: 1, sr: MID, gen: loopAlarm }];
