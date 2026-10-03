// Procedural sound of a handcar on the railway (shared/handcar.js), pure like synth.js: (sampleRate, rng) ->
// Float32Array. One loop, the car rolling at its working speed (10 m/s): steel wheels on steel rail, the frame
// rattling over the sleepers, and every 12 m rail joint knocked twice, once by each axle. The car plays it faster
// or slower with its speed (client/game/handcar.js), so the joints come round as often as they would.
import { TAU, Biquad, ModeBank, Brown, Pink, normalize, softclip, dcBlock, loopify } from './dsp.js';
import { LO } from './synth.js';

const JOINT = 1.2; // seconds between two rail joints at 10 m/s: the loop
const AXLES = 0.15; // ...and between the two axles going over one
const WHEEL = [{ f: 690, d: 0.03, a: 1 }, { f: 1610, d: 0.02, a: 0.7 }, { f: 2870, d: 0.012, a: 0.45 }, { f: 4150, d: 0.007, a: 0.3 }];
const ROLL = [{ f: 205, d: 0.02, a: 1 }, { f: 470, d: 0.012, a: 0.6 }, { f: 1130, d: 0.006, a: 0.3 }];

export function loopHandcar(sr, rng) {
  const L = JOINT;
  const X = 0.15;
  const n = Math.ceil((L + X) * sr);
  // the knocks: a short burst at each axle over the joint, the first one harder
  const ex = new Float32Array(n);
  const thumps = new Float32Array(n);
  const burst = Math.floor(0.0018 * sr);
  for (let r = 0; r * L < L + X; r++) {
    for (const [at, a] of [[0.12, 1], [0.12 + AXLES, 0.75]]) {
      const i0 = Math.floor((r * L + at) * sr);
      for (let j = 0; j < burst && i0 + j < n; j++) {
        const k = 1 - j / burst;
        ex[i0 + j] += (rng() * 2 - 1) * k * a;
        thumps[i0 + j] += k * a;
      }
    }
  }
  const ring = new ModeBank(sr, WHEEL);
  const roll = new ModeBank(sr, ROLL);
  const body = new Biquad().lp(sr, 110, 0.9);
  const rum = new Biquad().lp(sr, 320, 0.7);
  const hiss = new Biquad().bp(sr, 3200, 1.2);
  const br = new Brown(rng);
  const pk = new Pink(rng);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // the rolling: low rumble, the wheels ringing faintly on it, the frame rattling at the sleepers (0.6 m apart)
    const sleeper = 0.5 + 0.5 * Math.sin((TAU * t * 10) / 0.62);
    const rattle = rng() < 0.004 * sleeper ? rng() * 2 - 1 : 0;
    out[i] = rum.run(br.next()) * 0.22 + roll.run(pk.next() * 0.05 + rattle * 0.3) * 0.3 + hiss.run(pk.next()) * 0.015 + ring.run(ex[i]) * 1.5 + body.run(thumps[i]) * 3;
  }
  softclip(out, 1.4);
  for (let i = 0; i < n; i++) if (out[i] !== out[i]) out[i] = 0;
  dcBlock(out, sr);
  return normalize(loopify(out, sr, X), 0.8);
}

export const HANDCAR_DEFS = [{ bank: 'loop_handcar', n: 1, sr: LO, gen: loopHandcar }];
