// Procedural sounds of the vehicles (shared/vehicles.js, client/game/vehicles.js), pure like synth.js: (sampleRate,
// rng) -> Float32Array. A car's own engine is the crossing's (synth-bridge.js loopCar), played by its revs.
//   loopMoped   a small two-stroke single: a hard, ringing buzz with a rattle on it, played faster with the revs
//   loopHorn    a car horn held down: two reeds a third apart
//   vehCrash    sheet metal into something solid: a thud, the panel crumpling, glass and bits after it
//   vehBreak    one breaking down: a bang under the bonnet, then steam
//   vehDoor     a car door shut
//   vehMount    a leg swung over a saddle: the springs take the weight
//   vehSkid     tyres letting go on a hard road: a short squeal
//   bikeBell    a bicycle's bell, struck twice
import { TAU, hann, rrange, Biquad, ModeBank, Pink, Brown, alloc, normalize, finish, softclip, dcBlock, loopify } from './dsp.js';
import { HI, MID, LO, addNorm, thump, noise, modal } from './synth.js';

const FIRE = 56; // firings a second: a single at 3400 rpm (it fires every turn)
// what a firing rings in: a thin steel pipe and a tin expansion box
const PIPE = [{ f: 168, d: 0.012, a: 1 }, { f: 336, d: 0.009, a: 0.9 }, { f: 620, d: 0.006, a: 0.7 }, { f: 1180, d: 0.004, a: 0.5 }, { f: 2350, d: 0.002, a: 0.3 }];

export function loopMoped(sr, rng) {
  const L = 1.5;
  const X = 0.15;
  const n = Math.ceil((L + X) * sr);
  const ex = new Float32Array(n);
  const len = Math.floor(0.0011 * sr);
  let ph = 0.3;
  for (let i = 0; i < n; i++) {
    // (a whole number of firings to the loop; it four-strokes a little: every so often one misses)
    ph += (FIRE * (1 + 0.01 * Math.sin((TAU * 3 * i) / (L * sr)))) / sr;
    if (ph < 1) continue;
    ph -= 1;
    const a = rng() < 0.07 ? 0.35 : 0.85 + rng() * 0.3;
    for (let j = 0; j < len && i + j < n; j++) ex[i + j] += (rng() * 2 - 1) * (1 - j / len) * a;
  }
  const pipe = new ModeBank(sr, PIPE);
  const rattle = new Biquad().bp(sr, 3100, 2.5);
  const whine = new Biquad().bp(sr, 1500, 6);
  const low = new Biquad().lp(sr, 200, 0.8);
  const br = new Brown(rng);
  const pk = new Pink(rng);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const fire = 0.5 + 0.5 * Math.sin(TAU * FIRE * t);
    out[i] = pipe.run(ex[i]) * 1.1 + rattle.run(pk.next()) * 0.12 * fire + whine.run(pk.next()) * 0.05 + low.run(br.next()) * 0.12 + 0.05 * Math.sin(TAU * FIRE * t);
  }
  softclip(out, 1.8);
  for (let i = 0; i < n; i++) if (out[i] !== out[i]) out[i] = 0;
  dcBlock(out, sr);
  return normalize(loopify(out, sr, X), 0.8);
}

export function loopHorn(sr, rng) {
  const L = 1;
  const X = 0.1;
  const n = Math.ceil((L + X) * sr);
  const out = new Float32Array(n);
  const horn = new Biquad().bp(sr, 1900, 0.8);
  // (both reeds a whole number of cycles to the loop)
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let x = 0;
    for (const [f, a] of [[410, 1], [512, 0.85]]) {
      const p = (t * f) % 1;
      // a reed: a buzz rich in odd partials, its duty wandering a hair
      x += a * ((p < 0.42 + 0.02 * Math.sin(TAU * 5 * t) ? 1 : -1) * 0.5 + 0.35 * Math.sin(TAU * f * t));
    }
    out[i] = horn.run(x) * 0.9 + x * 0.25 + (rng() - 0.5) * 0.01;
  }
  softclip(out, 1.6);
  dcBlock(out, sr);
  return normalize(loopify(out, sr, X), 0.8);
}

const PANEL = (rng) => [{ f: rrange(rng, 90, 130), d: 0.16, a: 1 }, { f: rrange(rng, 210, 290), d: 0.1, a: 0.8 }, { f: rrange(rng, 470, 640), d: 0.06, a: 0.6 }, { f: rrange(rng, 1100, 1500), d: 0.035, a: 0.4 }, { f: rrange(rng, 2400, 3300), d: 0.02, a: 0.25 }];

export function vehCrash(sr, rng) {
  const out = alloc(sr, 1.5);
  addNorm(out, thump(sr, 130, 42, 0.03, 0.12), sr, 0, 1);
  addNorm(out, modal(sr, rng, PANEL(rng), 0.9, 2.5, 3200), sr, 0.004, 0.9);
  addNorm(out, noise(sr, rng, 0.35, { lp: 2600, hp: 120, env: (u) => Math.min(1, u * 80) * Math.exp(-u * 7) }), sr, 0, 0.7);
  // the panel folding: a few cracks of buckling steel
  for (let k = 0; k < 5; k++) {
    const t = 0.03 + k * 0.045 + rng() * 0.03;
    addNorm(out, modal(sr, rng, PANEL(rng), 0.3, 0.6), sr, t, rrange(rng, 0.2, 0.45));
  }
  // glass and trim coming off and settling
  for (let k = 0; k < 14; k++) {
    const t = 0.08 + Math.pow(rng(), 0.7) * 0.9;
    const f = rrange(rng, 3200, 7800);
    addNorm(out, modal(sr, rng, [{ f, d: 0.012, a: 1 }, { f: f * 1.47, d: 0.008, a: 0.6 }], 0.08, 0.3), sr, t, rrange(rng, 0.06, 0.2) * (1.1 - t));
  }
  softclip(out, 1.5);
  dcBlock(out, sr);
  return finish(out, sr, 0.95, 0.0008, 0.2);
}

export function vehBreak(sr, rng) {
  const out = alloc(sr, 2.6);
  addNorm(out, thump(sr, 190, 60, 0.02, 0.07), sr, 0, 1);
  addNorm(out, modal(sr, rng, PANEL(rng), 0.5, 1.2, 4000), sr, 0, 0.8);
  // a clatter running down as it stops turning
  for (let k = 0, t = 0.06; t < 0.9; k++, t += 0.035 + k * 0.012) addNorm(out, modal(sr, rng, [{ f: rrange(rng, 600, 900), d: 0.02, a: 1 }, { f: rrange(rng, 1700, 2300), d: 0.012, a: 0.5 }], 0.12, 0.5), sr, t, 0.35 * (1 - t));
  // steam
  addNorm(out, noise(sr, rng, 2.3, { bp: [5200, 0.7], sweep: [6400, 3600], env: (u) => Math.min(1, u * 12) * Math.pow(1 - u, 1.6) }), sr, 0.2, 0.4);
  softclip(out, 1.3);
  dcBlock(out, sr);
  return finish(out, sr, 0.9, 0.0008, 0.3);
}

export function vehDoor(sr, rng) {
  const out = alloc(sr, 0.5);
  addNorm(out, thump(sr, rrange(rng, 95, 115), 50, 0.02, 0.06), sr, 0.012, 1);
  addNorm(out, modal(sr, rng, [{ f: rrange(rng, 160, 200), d: 0.07, a: 1 }, { f: rrange(rng, 430, 520), d: 0.04, a: 0.5 }, { f: 1250, d: 0.015, a: 0.25 }], 0.4, 1.5, 2400), sr, 0.012, 0.6);
  addNorm(out, noise(sr, rng, 0.03, { bp: [2600, 1.5], a: 0.0008, d: 0.006 }), sr, 0, 0.35); // the latch
  addNorm(out, noise(sr, rng, 0.05, { bp: [1800, 1.2], a: 0.001, d: 0.012 }), sr, 0.02, 0.25);
  return finish(out, sr, 0.85, 0.0008, 0.08);
}

export function vehMount(sr, rng) {
  const out = alloc(sr, 0.6);
  addNorm(out, thump(sr, 80, 46, 0.03, 0.07), sr, 0.05, 0.9);
  // the saddle's springs and the stand
  for (const [t, f] of [[0.05, rrange(rng, 520, 640)], [0.13, rrange(rng, 700, 860)], [0.24, rrange(rng, 430, 520)]]) addNorm(out, modal(sr, rng, [{ f, d: 0.05, a: 1 }, { f: f * 2.3, d: 0.02, a: 0.4 }], 0.25, 1), sr, t, 0.3);
  addNorm(out, noise(sr, rng, 0.2, { bp: [900, 0.8], env: (u) => hann(u) }), sr, 0, 0.18); // cloth over the seat
  return finish(out, sr, 0.8, 0.002, 0.1);
}

export function vehSkid(sr, rng) {
  const dur = 0.55;
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  const sq = new Biquad();
  const sq2 = new Biquad();
  const pk = new Pink(rng);
  const f0 = rrange(rng, 1250, 1700);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 15) === 0) {
      const f = f0 * (1 - 0.18 * u) * (1 + 0.03 * Math.sin(TAU * 31 * (i / sr)));
      sq.bp(sr, f, 18);
      sq2.bp(sr, f * 2.02, 14);
    }
    const x = pk.next();
    out[i] = (sq.run(x) + sq2.run(x) * 0.5) * hann(Math.min(1, 0.08 + u * 0.92)) + (rng() - 0.5) * 0.02 * (1 - u);
  }
  softclip(out, 1.4);
  dcBlock(out, sr);
  return finish(out, sr, 0.8, 0.01, 0.12);
}

export function bikeBell(sr, rng) {
  const out = alloc(sr, 1.4);
  const f = rrange(rng, 2050, 2250);
  const modes = [{ f, d: 0.5, a: 1 }, { f: f * 1.006, d: 0.45, a: 0.8 }, { f: f * 2.71, d: 0.22, a: 0.5 }, { f: f * 5.2, d: 0.09, a: 0.25 }];
  addNorm(out, modal(sr, rng, modes, 1.2, 0.3), sr, 0, 0.9);
  addNorm(out, modal(sr, rng, modes, 1.1, 0.3), sr, 0.17, 0.8);
  return finish(out, sr, 0.8, 0.0005, 0.25);
}

// { bank, n (variants), sr, gen } rows for registry.js, as SFX_DEFS in synth.js
export const VEHICLE_DEFS = [
  { bank: 'loop_moped', n: 1, sr: LO, gen: loopMoped, group: 'late' },
  { bank: 'loop_horn', n: 1, sr: LO, gen: loopHorn, group: 'late' },
  { bank: 'veh_crash', n: 3, sr: MID, gen: vehCrash, group: 'late' },
  { bank: 'veh_break', n: 1, sr: MID, gen: vehBreak, group: 'late' },
  { bank: 'veh_door', n: 2, sr: MID, gen: vehDoor, group: 'late' },
  { bank: 'veh_mount', n: 2, sr: MID, gen: vehMount, group: 'late' },
  { bank: 'veh_skid', n: 3, sr: MID, gen: vehSkid, group: 'late' },
  { bank: 'bike_bell', n: 1, sr: HI, gen: bikeBell, group: 'late' },
];
void normalize;
