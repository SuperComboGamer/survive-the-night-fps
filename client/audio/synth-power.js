// Procedural sounds of the survivor-built generator and its floodlights (pure, like synth.js: (sampleRate, rng) ->
// Float32Array). The set is a small single-cylinder petrol engine: about 26 firings a second through a short
// exhaust, tappets ticking at twice that, the governor hunting a little, and now and then a stroke that half-misses.
import { TAU, lerp, hann, rrange, Biquad, ModeBank, Pink, Brown, alloc, normalize, finish, softclip, dcBlock, loopify } from './dsp.js';
import { HI, MID, LO, addNorm, thump, noise, modal, metalClick, bubbles } from './synth.js';

const IDLE = 26; // firings per second at its working speed
// the exhaust: what a firing pulse rings in
const PIPE = [{ f: 104, d: 0.03, a: 1 }, { f: 212, d: 0.018, a: 0.7 }, { f: 395, d: 0.01, a: 0.45 }, { f: 870, d: 0.005, a: 0.3 }, { f: 1650, d: 0.003, a: 0.18 }];

// Firing pulses at rate(t) firings a second, each a short burst scaled by amp(t); every ninth half-misses.
function firing(sr, rng, dur, rate, amp) {
  const n = Math.ceil(dur * sr);
  const ex = new Float32Array(n);
  const len = Math.floor(0.0022 * sr);
  let ph = 0.7;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (rate(t) * (1 + (rng() - 0.5) * 0.05)) / sr;
    if (ph < 1) continue;
    ph -= 1;
    const a = amp(t) * (++k % 9 === 4 ? 0.35 : 1) * (0.8 + rng() * 0.3);
    for (let j = 0; j < len && i + j < n; j++) ex[i + j] += (rng() * 2 - 1) * (1 - j / len) * a;
  }
  return ex;
}

// the running set, as a seamless loop
export function loopGenset(sr, rng) {
  const L = 3;
  const X = 0.25;
  const dur = L + X;
  const n = Math.ceil(dur * sr);
  const hunt = (t) => 1 + 0.02 * Math.sin((TAU * 2 * t) / L); // (two swings of the governor to a loop)
  const ex = firing(sr, rng, dur, (t) => IDLE * hunt(t), () => 1);
  // tappets: a tick every half firing period
  const tk = new Float32Array(n);
  const tl = Math.max(2, Math.floor(0.0006 * sr));
  let tp = 0;
  for (let i = 0; i < n; i++) {
    tp += (IDLE * 2 * hunt(i / sr)) / sr;
    if (tp < 1) continue;
    tp -= 1;
    const a = 0.5 + rng() * 0.5;
    for (let j = 0; j < tl && i + j < n; j++) tk[i + j] += (rng() * 2 - 1) * (1 - j / tl) * a;
  }
  const pipe = new ModeBank(sr, PIPE);
  const tap = new Biquad().bp(sr, 2600, 2);
  const rum = new Biquad().lp(sr, 180, 0.8);
  const br = new Brown(rng);
  const fan = new Biquad().hp(sr, 1800, 0.7);
  const pk = new Pink(rng);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // exhaust, tappets, the block's rumble, the cooling fan, and the frame humming at twice the firing rate
    out[i] = pipe.run(ex[i]) + tap.run(tk[i]) * 0.5 + rum.run(br.next()) * 0.35 + fan.run(pk.next()) * 0.06 + 0.05 * Math.sin((TAU * IDLE * 2 * i) / sr);
  }
  softclip(out, 1.6);
  for (let i = 0; i < n; i++) if (out[i] !== out[i]) out[i] = 0;
  dcBlock(out, sr);
  return normalize(loopify(out, sr, X), 0.8);
}

// engine strokes through the exhaust, for the two one-shots: rate and loudness as functions of time
function strokes(sr, rng, dur, rate, amp) {
  const ex = firing(sr, rng, dur, rate, amp);
  const pipe = new ModeBank(sr, PIPE);
  const rum = new Biquad().lp(sr, 200, 0.8);
  const br = new Brown(rng);
  for (let i = 0; i < ex.length; i++) ex[i] = pipe.run(ex[i]) + rum.run(br.next()) * 0.25 * amp(i / sr);
  return ex;
}

// the cord pulled: the recoil starter's ratchet, two strokes that do not catch, then it does and runs up to speed.
// The loop is already sounding underneath by then, so this fades out under it.
export function genStart(sr, rng) {
  const out = alloc(sr, 1.9);
  const cord = noise(sr, rng, 0.4, { bp: [1700, 1.4], sweep: [900, 2600], env: hann });
  for (let i = 0; i < cord.length; i++) cord[i] *= 0.35 + 0.65 * (Math.sin((TAU * lerp(55, 120, i / cord.length) * i) / sr) > 0 ? 1 : 0); // the pawl
  addNorm(out, cord, sr, 0, 0.5);
  for (const t of [0.3, 0.47]) {
    addNorm(out, thump(sr, 120, 60, 0.02, 0.05), sr, t + rng() * 0.02, 0.6);
    addNorm(out, noise(sr, rng, 0.09, { bp: [420, 1.2], a: 0.001, d: 0.025 }), sr, t, 0.4);
  }
  const run = strokes(sr, rng, 1.3, (t) => (t < 0.5 ? lerp(9, IDLE * 1.25, t / 0.5) : lerp(IDLE * 1.25, IDLE, Math.min(1, (t - 0.5) / 0.3))), (t) => Math.min(1, 0.5 + t) * (t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.6) : 1));
  addNorm(out, run, sr, 0.6, 1);
  softclip(out, 1.6);
  return finish(out, sr, 0.9, 0.002, 0.2);
}

// it dies: the strokes come slower and weaker, one last cough, the flywheel ticks to a stop
export function genStop(sr, rng) {
  const out = alloc(sr, 1.5);
  const run = strokes(sr, rng, 1.1, (t) => lerp(IDLE, 4, Math.min(1, t / 1.0) ** 0.7), (t) => Math.max(0, 1 - t / 1.1) ** 0.8);
  addNorm(out, run, sr, 0, 1);
  addNorm(out, thump(sr, 95, 45, 0.03, 0.07), sr, 1.08, 0.5);
  addNorm(out, noise(sr, rng, 0.12, { bp: [380, 1], a: 0.002, d: 0.04 }), sr, 1.08, 0.35);
  for (let k = 0; k < 3; k++) addNorm(out, metalClick(sr, rng, rrange(rng, 1900, 2500), 0.008), sr, 1.2 + k * (0.07 + k * 0.03), 0.16 - k * 0.04);
  softclip(out, 1.5);
  return finish(out, sr, 0.9, 0.002, 0.1);
}

// fuel into the tank: the cap, then the can glugging into a hollow tank that rings higher as it fills
export function genFuel(sr, rng) {
  const out = alloc(sr, 1.15);
  addNorm(out, metalClick(sr, rng, rrange(rng, 1300, 1700), 0.012), sr, 0, 0.5);
  const pour = noise(sr, rng, 0.9, { bp: [420, 1.6], sweep: [300, 640], env: hann });
  const glug = rrange(rng, 6, 8);
  for (let i = 0; i < pour.length; i++) pour[i] *= 0.45 + 0.55 * Math.abs(Math.sin((Math.PI * glug * i) / sr));
  addNorm(out, pour, sr, 0.12, 0.8);
  addNorm(out, bubbles(sr, rng, 0.85, 18, 170, 460, { env: hann }), sr, 0.14, 0.7);
  addNorm(out, modal(sr, rng, [{ f: 240, d: 0.09 }, { f: 610, d: 0.05, a: 0.5 }], 0.4, 1.5), sr, 0.1, 0.25); // the tank's own boom
  addNorm(out, metalClick(sr, rng, rrange(rng, 1500, 1900), 0.01), sr, 1.02, 0.35);
  return finish(out, sr, 0.85);
}

// a floodlight coming on (or going out): the contactor's clack and the lamp's short hum
export function floodSwitch(sr, rng) {
  const out = alloc(sr, 0.32);
  addNorm(out, thump(sr, 190, 80, 0.008, 0.02), sr, 0, 0.9);
  addNorm(out, metalClick(sr, rng, rrange(rng, 2200, 2800), 0.01), sr, 0.002, 0.6);
  const hum = alloc(sr, 0.26);
  for (let i = 0; i < hum.length; i++) {
    const t = i / sr;
    hum[i] = (Math.sin(TAU * 100 * t) + 0.5 * Math.sin(TAU * 200 * t) + 0.25 * Math.sin(TAU * 400 * t)) * Math.exp(-t / 0.07) * (1 - Math.exp(-t / 0.004));
  }
  addNorm(out, hum, sr, 0.012, 0.4);
  addNorm(out, modal(sr, rng, [{ f: 3100, d: 0.02 }, { f: 4700, d: 0.012, a: 0.5 }], 0.1, 0.3), sr, 0.03, 0.12); // the glass ticks as it warms
  return finish(out, sr, 0.9, 0.0003, 0.02);
}

// { bank, n (variants), sr, gen } rows for registry.js, as SFX_DEFS in synth.js
export const POWER_DEFS = [
  { bank: 'loop_genset', n: 1, sr: LO, gen: loopGenset },
  { bank: 'gen_start', n: 1, sr: MID, gen: genStart },
  { bank: 'gen_stop', n: 1, sr: MID, gen: genStop },
  { bank: 'gen_fuel', n: 2, sr: HI, gen: genFuel },
  { bank: 'flood_switch', n: 2, sr: HI, gen: floodSwitch },
];
