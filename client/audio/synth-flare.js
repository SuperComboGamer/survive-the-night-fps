// Procedural sounds of the flare gun (ITEM.FLARE_GUN) and its parachute flare (PROJ.SKYFLARE). Pure like synth.js:
// (sampleRate, rng) => Float32Array (mono) | [Float32Array, Float32Array] (stereo), peak-normalised.
//
// A 26.5mm flare pistol is a wide, short tube with a light charge behind a cardboard-and-plastic shell: what comes out
// is a hollow "thoomp" (the bore rings like a struck pipe for a moment) with hardly any crack, the hiss of the
// burning star leaving the muzzle, and a rush that drops in pitch as it climbs away. At the top of its climb the star
// bursts alight under its chute (a muffled pop, then a crackling fizz), and burns down as a magnesium flare does:
// a fierce, sputtering hiss with a slow irregular flutter.
import { Biquad, ModeBank, Pink, Brown, Wander, alloc, normalize, finish, softclip, loopify, dcBlock, rrange } from './dsp.js';
import { HI, MID, addNorm, thump, noise, modal, metalClick, crackles } from './synth.js';

// the bore struck by the blast: a short open pipe (quarter-wave near 500 Hz) and its next partials
function borePok(sr, rng, k = 1) {
  return modal(sr, rng, [
    { f: 510 * k, d: 0.032, a: 1 },
    { f: 1170 * k, d: 0.02, a: 0.55 },
    { f: 1890 * k, d: 0.011, a: 0.3 },
    { f: 2750 * k, d: 0.006, a: 0.15 },
  ], 0.22, 1.3, 4200);
}

// the burning star rushing away: band-passed pink noise whose centre falls (it recedes) over `dur`, sputtering
function climbRush(sr, rng, dur, f0, f1) {
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const bp = new Biquad();
  const bp2 = new Biquad();
  const hp = new Biquad().hp(sr, 600, 0.7);
  const pk = new Pink(rng);
  const fl = new Wander(rng, sr, 22);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = i / n;
    if ((i & 15) === 0) {
      const f = f0 * Math.pow(f1 / f0, Math.pow(u, 0.6));
      bp.bp(sr, f, 1.1);
      bp2.bp(sr, f * 1.9, 1.4);
    }
    const x = hp.run(pk.next() * 2 + (rng() * 2 - 1) * 0.4);
    const e = Math.min(1, t / 0.025) * Math.exp(-t / (dur * 0.32)) * Math.min(1, (1 - u) / 0.3) * (0.8 + 0.2 * fl.next());
    out[i] = (bp.run(x) + bp2.run(x) * 0.6) * e;
  }
  return out;
}

// the shot: thump + hollow bore + a soft blast, a breath of crack, the star's hiss and the rush as it climbs away.
// fp = first person (stereo, decorrelated rush and echoes, more low end)
export function flareShot(sr, rng, fp) {
  const dur = 1.7;
  const n = Math.ceil(dur * sr);
  const shared = new Float32Array(n);
  const k = rrange(rng, 0.93, 1.07);
  addNorm(shared, thump(sr, rrange(rng, 102, 118), 48, 0.024, 0.075, 0.5), sr, 0, fp ? 1 : 0.8);
  addNorm(shared, borePok(sr, rng, k), sr, 0.0005, 0.62);
  // the blast: soft, dark and short (no supersonic anything)
  addNorm(shared, noise(sr, rng, 0.14, { hp: 120, lp: 1900, a: 0.0006, d: 0.022 }), sr, 0, 0.5);
  addNorm(shared, noise(sr, rng, 0.012, { hp: 2600, a: 0.0002, d: 0.0009 }), sr, 0, 0.16);
  // the star leaving the muzzle: a sharp hiss
  addNorm(shared, noise(sr, rng, 0.2, { hp: 3200, bp: [6200, 0.7], a: 0.003, d: 0.055 }), sr, 0.004, 0.3);
  const nch = fp ? 2 : 1;
  const outs = [];
  for (let ch = 0; ch < nch; ch++) {
    const c = new Float32Array(n);
    addNorm(c, climbRush(sr, rng, 1.45, rrange(rng, 2900, 3300), 1050), sr, 0.03 + (fp && ch ? 0.006 : 0), fp ? 0.42 : 0.36);
    addNorm(c, crackles(sr, rng, 1.3, 46, { hp: 1700, bp: 3600, pow: 3, env: (u) => Math.exp(-u * 3.2) * Math.min(1, (1 - u) / 0.3) }), sr, 0.04, 0.32);
    // the pop off the tree line: two dark, late copies of the thump and the bore
    for (const [et, eg] of [[0.21, 0.07], [0.49, 0.035]]) {
      const src = new Float32Array(Math.floor(0.3 * sr));
      for (let i = 0; i < src.length; i++) src[i] = shared[i];
      const e1 = new Biquad().lp(sr, 1200, 0.7);
      for (let i = 0; i < src.length; i++) src[i] = e1.run(src[i]);
      addNorm(c, src, sr, et + (fp ? (ch ? 0.015 : -0.009) : 0) + (rng() - 0.5) * 0.02, eg);
    }
    for (let i = 0; i < n; i++) c[i] += shared[i];
    outs.push(c);
  }
  const x = fp ? outs : outs[0];
  normalize(x, 1);
  softclip(x, 1.5);
  return finish(x, sr, 0.95, 0.0001, 0.08);
}

// the star bursting alight at the top of its climb, heard from far below: a muffled pop, the catch, then a crackling
// fizz that thins out as the burning loop (loopSkyflare) takes over close up
export function flarePop(sr, rng) {
  const dur = 2.4;
  const out = alloc(sr, dur);
  addNorm(out, thump(sr, rrange(rng, 140, 160), 62, 0.018, 0.05, 0.4), sr, 0, 0.75);
  addNorm(out, noise(sr, rng, 0.12, { hp: 90, lp: 950, a: 0.0008, d: 0.028 }), sr, 0, 0.6);
  // the catch: a low "fwump" of the composition taking light
  addNorm(out, noise(sr, rng, 0.6, { pink: true, bp: [380, 0.9], sweep: [260, 1100, 0.5], env: (u) => Math.min(1, u * 14) * Math.exp(-u * 4.5) }), sr, 0.015, 0.4);
  // the fizz: a bright hiss that swells in and fades with a flutter, and the sputter in it
  const fz = noise(sr, rng, 2.2, { hp: 2100, bp: [4600, 0.6], env: (u) => Math.min(1, u * 9) * Math.exp(-u * 2.6) * Math.min(1, (1 - u) / 0.35) });
  const w = new Wander(rng, sr, 11);
  for (let i = 0; i < fz.length; i++) fz[i] *= 0.7 + 0.3 * w.next();
  addNorm(out, fz, sr, 0.05, 0.42);
  addNorm(out, crackles(sr, rng, 2.2, 95, { hp: 1800, bp: 3300, pow: 2.6, env: (u) => Math.min(1, u * 12) * Math.exp(-u * 2.8) * Math.min(1, (1 - u) / 0.35) }), sr, 0.04, 0.7);
  addNorm(out, crackles(sr, rng, 1.6, 9, { hp: 450, bp: 1200, pow: 1.4, len: 0.004, env: (u) => Math.exp(-u * 2.5) }), sr, 0.06, 0.45);
  softclip(out, 1.3);
  return finish(out, sr, 0.9, 0.0004, 0.12);
}

// the burning flare, looped: a fierce hiss with a slow irregular flutter and a low rush under it, sputtering, now and
// then a spit of the composition, and short dips where the flame gutters
export function loopSkyflare(sr, rng) {
  const L = 4;
  const X = 0.4;
  const n = Math.ceil((L + X) * sr);
  const out = new Float32Array(n);
  const hp = new Biquad().hp(sr, 1700, 0.7);
  const pkEq = new Biquad().peak(sr, 4300, 0.8, 6);
  const lp = new Biquad().lp(sr, 11000, 0.7);
  const br = new Brown(rng);
  const rlp = new Biquad().lp(sr, 380, 0.7);
  const slow = new Wander(rng, sr, 1.7);
  const fast = new Wander(rng, sr, 9);
  const roarAm = new Wander(rng, sr, 2.5);
  // gutters: ~2 a second, 30-90 ms each, down to about half
  const gut = new Float32Array(n).fill(1);
  const count = Math.floor(L * 2.2);
  for (let k = 0; k < count; k++) {
    const s = Math.floor(rng() * n);
    const len = Math.floor(rrange(rng, 0.03, 0.09) * sr);
    const depth = rrange(rng, 0.3, 0.55);
    for (let j = 0; j < len && s + j < n; j++) {
      const u = j / len;
      gut[s + j] = Math.min(gut[s + j], 1 - depth * Math.sin(Math.PI * u));
    }
  }
  for (let i = 0; i < n; i++) {
    const g = (0.68 + 0.22 * slow.next() + 0.1 * fast.next()) * gut[i];
    const hiss = lp.run(pkEq.run(hp.run(rng() * 2 - 1))) * g;
    const roar = rlp.run(br.next()) * (0.75 + 0.25 * roarAm.next());
    out[i] = hiss + roar * 2.2;
  }
  normalize(out, 0.55);
  addNorm(out, crackles(sr, rng, L + X, 38, { hp: 1500, bp: 3000, pow: 3, len: 0.0012 }), sr, 0, 0.8);
  addNorm(out, crackles(sr, rng, L + X, 3, { hp: 400, bp: 1100, pow: 1.5, len: 0.004 }), sr, 0, 0.5);
  for (let i = 0; i < n; i++) if (out[i] !== out[i]) out[i] = 0;
  dcBlock(out, sr);
  return normalize(loopify(out, sr, X), 0.8);
}

// break-open reload, first person. Open: the latch, the barrel dropping on its hinge, the spent case drawn out, a new
// shell pushed home (~1.1 s in, inside the 1.7 s reload). Close: the barrel snapped shut on it
export function flareOpen(sr, rng) {
  const out = alloc(sr, 1.3);
  addNorm(out, metalClick(sr, rng, rrange(rng, 2300, 2600), 0.007), sr, 0, 0.6);
  addNorm(out, metalClick(sr, rng, rrange(rng, 950, 1100), 0.016), sr, 0.085, 0.75);
  addNorm(out, thump(sr, 210, 130, 0.008, 0.018), sr, 0.085, 0.35);
  addNorm(out, noise(sr, rng, 0.14, { bp: [2300, 1], sweep: [1700, 2900], env: (u) => Math.sin(Math.PI * u) }), sr, 0.36, 0.3);
  addNorm(out, modal(sr, rng, [{ f: 1750, d: 0.012, a: 1 }, { f: 3050, d: 0.008, a: 0.6 }], 0.08, 0.6), sr, 0.5, 0.35);
  addNorm(out, noise(sr, rng, 0.16, { bp: [1700, 1], sweep: [2500, 1400], env: (u) => Math.sin(Math.PI * u) }), sr, 0.95, 0.3);
  addNorm(out, modal(sr, rng, [{ f: 720, d: 0.02, a: 1 }, { f: 1580, d: 0.012, a: 0.5 }], 0.12, 0.9, 3500), sr, 1.1, 0.5);
  return finish(out, sr);
}
export function flareClose(sr, rng) {
  const out = alloc(sr, 0.4);
  addNorm(out, noise(sr, rng, 0.05, { bp: [1500, 1], env: (u) => Math.sin(Math.PI * u) }), sr, 0, 0.2);
  addNorm(out, metalClick(sr, rng, rrange(rng, 1350, 1550), 0.018), sr, 0.035, 1);
  addNorm(out, thump(sr, 240, 140, 0.008, 0.022), sr, 0.035, 0.55);
  addNorm(out, metalClick(sr, rng, rrange(rng, 2700, 3000), 0.006), sr, 0.06, 0.35);
  return finish(out, sr);
}

// { bank, n (variants), sr, gen } rows for registry.js, as SFX_DEFS in synth.js
export const FLARE_DEFS = [
  { bank: 'gun_flare', n: 2, sr: HI, gen: (sr, r) => flareShot(sr, r, false) },
  { bank: 'fp_flare', n: 2, sr: HI, gen: (sr, r) => flareShot(sr, r, true) },
  { bank: 'flare_pop', n: 2, sr: MID, gen: flarePop },
  { bank: 'loop_skyflare', n: 1, sr: MID, gen: loopSkyflare },
  { bank: 'flare_open', n: 1, sr: HI, gen: flareOpen },
  { bank: 'flare_close', n: 1, sr: HI, gen: flareClose },
];
