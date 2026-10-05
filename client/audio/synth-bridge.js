// Procedural sounds of the crossing (client/game/cutscene.js), pure like synth.js: (sampleRate, rng) -> Float32Array.
// The car that drives the bridge: a four-cylinder at a steady 2400 rpm, played faster or slower with its speed. A
// tyre thump over a deck joint. And the last span going: the steel groaning as it lets go of its bearings, then
// sixty metres of deck and truss into the sea.
import { TAU, lerp, hann, rrange, Biquad, ModeBank, Pink, Brown, alloc, normalize, finish, softclip, dcBlock, loopify } from './dsp.js';
import { MID, LO, addNorm, thump, noise, modal, bubbles } from './synth.js';

const FIRE = 80; // firings a second: four cylinders at 2400 rpm
// what a firing rings in: the exhaust and the box of the silencer, duller than the generator's open pipe
const EXHAUST = [{ f: 82, d: 0.022, a: 1 }, { f: 164, d: 0.014, a: 0.8 }, { f: 247, d: 0.01, a: 0.5 }, { f: 410, d: 0.006, a: 0.3 }, { f: 930, d: 0.003, a: 0.12 }];

// the engine under load, as a seamless loop: firing pulses (every fourth a touch stronger: one cylinder is the
// loud one), the valve gear, the fan and the road under the tyres
export function loopCar(sr, rng) {
  const L = 2;
  const X = 0.2;
  const n = Math.ceil((L + X) * sr);
  const ex = new Float32Array(n);
  const len = Math.floor(0.0016 * sr);
  let ph = 0.4;
  let k = 0;
  for (let i = 0; i < n; i++) {
    // (a whole number of firings to a loop, and a slow lope that comes round twice in it)
    ph += (FIRE * (1 + 0.012 * Math.sin((TAU * 2 * i) / (L * sr)))) / sr;
    if (ph < 1) continue;
    ph -= 1;
    const a = (++k % 4 === 0 ? 1.15 : 1) * (0.85 + rng() * 0.2);
    for (let j = 0; j < len && i + j < n; j++) ex[i + j] += (rng() * 2 - 1) * (1 - j / len) * a;
  }
  const pipe = new ModeBank(sr, EXHAUST);
  const rum = new Biquad().lp(sr, 140, 0.8);
  const road = new Biquad().bp(sr, 520, 0.6);
  const fan = new Biquad().hp(sr, 2400, 0.7);
  const br = new Brown(rng);
  const pk = new Pink(rng);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = pipe.run(ex[i]) + rum.run(br.next()) * 0.3 + road.run(pk.next()) * 0.1 + fan.run(pk.next()) * 0.03 + 0.08 * Math.sin(TAU * FIRE * 0.5 * t) + 0.04 * Math.sin(TAU * FIRE * t);
  }
  softclip(out, 1.5);
  for (let i = 0; i < n; i++) if (out[i] !== out[i]) out[i] = 0;
  dcBlock(out, sr);
  return normalize(loopify(out, sr, X), 0.8);
}

// a tyre over a joint in the deck: two knocks an axle apart, the plate ringing dully under them
export function deckThump(sr, rng) {
  const out = alloc(sr, 0.5);
  for (const [t, a] of [[0, 1], [0.085, 0.8]]) {
    addNorm(out, thump(sr, rrange(rng, 95, 120), 48, 0.012, 0.045), sr, t, 0.8 * a);
    addNorm(out, noise(sr, rng, 0.05, { bp: [rrange(rng, 600, 900), 1.2], a: 0.001, d: 0.012 }), sr, t, 0.3 * a);
    addNorm(out, modal(sr, rng, [{ f: rrange(rng, 210, 260), d: 0.05, a: 1 }, { f: rrange(rng, 520, 610), d: 0.03, a: 0.5 }, { f: 1340, d: 0.012, a: 0.2 }], 0.3, 1.2), sr, t, 0.35 * a);
  }
  return finish(out, sr, 0.85, 0.001, 0.05);
}

// Steel under more than it can carry: a long groan that slides down as the member stretches, stick-slip shrieks
// riding on it, and the bolts going one after another at the end.
export function bridgeGroan(sr, rng) {
  const dur = 3.4;
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  // the groan: a stick-slip pulse train (slow, irregular) driving the truss's low modes, its rate sliding down
  const modes = new ModeBank(sr, [{ f: 58, d: 0.5, a: 1 }, { f: 97, d: 0.4, a: 0.9 }, { f: 151, d: 0.3, a: 0.7 }, { f: 233, d: 0.22, a: 0.5 }, { f: 388, d: 0.14, a: 0.35 }, { f: 612, d: 0.09, a: 0.2 }]);
  const shriek = new Biquad();
  const pk = new Pink(rng);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / dur;
    const rate = lerp(46, 17, u) * (1 + 0.25 * Math.sin(TAU * 0.9 * t) + 0.12 * Math.sin(TAU * 2.3 * t + 1));
    ph += rate / sr;
    let x = 0;
    if (ph >= 1) {
      ph -= 1;
      x = (0.6 + rng() * 0.6) * (rng() < 0.12 ? 2.2 : 1);
    }
    // the shriek: narrow noise whose pitch wanders up as the slips come slower (metal on metal, a rail-wheel squeal)
    if ((i & 31) === 0) shriek.bp(sr, lerp(900, 1500, u) * (1 + 0.08 * Math.sin(TAU * 3.1 * t)), 14);
    const env = hann(Math.min(1, u * 1.15)) * (0.55 + 0.45 * Math.sin(TAU * 0.7 * t) ** 2);
    out[i] = modes.run(x) * 1.6 * (0.4 + 0.6 * Math.min(1, u * 3)) + shriek.run(pk.next()) * 0.5 * env;
  }
  // rivets and bolts shearing: sharp cracks, closer together towards the end
  for (let k = 0, t = 0.5; t < dur - 0.25; k++, t += rrange(rng, 0.5, 0.12) * (1 - t / dur) + 0.07) {
    const f = rrange(rng, 1400, 2600);
    addNorm(out, modal(sr, rng, [{ f, d: 0.02, a: 1 }, { f: f * 1.63, d: 0.014, a: 0.7 }, { f: f * 2.71, d: 0.008, a: 0.4 }, { f: rrange(rng, 240, 420), d: 0.09, a: 0.8 }], 0.3, 0.5), sr, t, rrange(rng, 0.25, 0.5));
  }
  softclip(out, 1.3);
  dcBlock(out, sr);
  return finish(out, sr, 0.9, 0.08, 0.25);
}

// The span goes in: the bearings let go with a bang, a second of steel tearing and falling, the deck hitting the
// water flat (a great low thud under a wall of white noise), then the wash settling and air coming up.
export function bridgeFall(sr, rng) {
  const out = alloc(sr, 5.2);
  // the bang, and the truss ringing from it
  addNorm(out, thump(sr, 150, 38, 0.03, 0.16), sr, 0, 0.8);
  addNorm(out, modal(sr, rng, [{ f: 71, d: 0.7, a: 1 }, { f: 122, d: 0.5, a: 0.8 }, { f: 207, d: 0.4, a: 0.6 }, { f: 349, d: 0.25, a: 0.45 }, { f: 588, d: 0.16, a: 0.3 }, { f: 990, d: 0.09, a: 0.2 }], 1.6, 3, 2600), sr, 0, 0.7);
  // tearing on the way down: bursts of bright, ringing noise
  for (let k = 0; k < 9; k++) {
    const t = 0.08 + k * 0.1 + rng() * 0.05;
    addNorm(out, noise(sr, rng, 0.16, { bp: [rrange(rng, 700, 2400), 3], a: 0.002, d: 0.04 }), sr, t, rrange(rng, 0.18, 0.4));
  }
  // the deck meets the water
  const hit = 1.05;
  addNorm(out, thump(sr, 70, 24, 0.06, 0.45), sr, hit, 1);
  addNorm(out, noise(sr, rng, 2.6, { lp: 1900, hp: 90, pink: true, env: (u) => Math.min(1, u * 60) * Math.exp(-u * 4.2) }), sr, hit, 0.95);
  addNorm(out, noise(sr, rng, 1.2, { bp: [3200, 0.8], env: (u) => Math.min(1, u * 40) * Math.exp(-u * 6) }), sr, hit + 0.02, 0.35);
  // the spray coming back down, and the sea closing over it
  addNorm(out, noise(sr, rng, 2.8, { bp: [2100, 0.7], sweep: [2600, 900], env: (u) => hann(Math.min(1, u * 1.4)) * (1 - u) }), sr, hit + 0.7, 0.3);
  addNorm(out, bubbles(sr, rng, 3.2, 60, 140, 620, { skew: 1.6, env: (u) => 1 - u }), sr, hit + 0.5, 0.3);
  // what is still hanging from the pier knocks against it
  for (const t of [2.4, 2.95, 3.7]) addNorm(out, modal(sr, rng, [{ f: rrange(rng, 150, 210), d: 0.3, a: 1 }, { f: rrange(rng, 380, 470), d: 0.2, a: 0.6 }, { f: 910, d: 0.08, a: 0.3 }], 0.9, 1.5), sr, t + rng() * 0.1, rrange(rng, 0.12, 0.22));
  softclip(out, 1.4);
  dcBlock(out, sr);
  return finish(out, sr, 0.95, 0.001, 0.5);
}

export const BRIDGE_DEFS = [
  { bank: 'loop_car', n: 1, sr: LO, gen: loopCar, group: 'late' },
  { bank: 'deck_thump', n: 3, sr: LO, gen: deckThump, group: 'late' },
  { bank: 'bridge_groan', n: 1, sr: MID, gen: bridgeGroan, group: 'late' },
  { bank: 'bridge_fall', n: 1, sr: MID, gen: bridgeFall, group: 'late' },
];
