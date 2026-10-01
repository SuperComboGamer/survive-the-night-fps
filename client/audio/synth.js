// Pure procedural sound generators (no DOM / WebAudio).
// Every generator is (sampleRate, rng, ...) => Float32Array (mono) | [Float32Array, Float32Array] (stereo),
// peak-normalised to <= ~0.95. The engine turns them into AudioBuffers; Node can unit-test them directly.

import {
  TAU, clamp, lerp, smoothstep, rrange, rpick, Biquad, OnePole, Resonator, ModeBank, Pink, Brown, Wander, Curve,
  polyblep, ar, hann, alloc, normalize, finish, softclip, mixInto, loopify, dcBlock, peakOf,
} from './dsp.js';

export const HI = 44100;
export const MID = 32000;
export const LO = 22050;

// ------------------------------------------------------------------ small building blocks

// add `src` into `dst` at time `t` (s), normalised so its peak equals `peak`
export function addNorm(dst, src, sr, t, peak) {
  const p = peakOf(src);
  if (p < 1e-9) return dst;
  return mixInto(dst, src, Math.floor(t * sr), peak / p);
}

// pitch-dropping sine thump
export function thump(sr, f0, f1, sweep, decay, len) {
  const n = Math.floor((len ?? decay * 7) * sr);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / sweep);
    ph += f / sr;
    out[i] = Math.sin(TAU * ph) * Math.exp(-t / decay) * (1 - Math.exp(-t / 0.0012));
  }
  return out;
}

// filtered noise burst. o: {hp, lp, bp:[f,q], sweep:[f0,f1] (bp centre sweep, exponential), a, d, env(u), lp2}
export function noise(sr, rng, dur, o = {}) {
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const hp = o.hp ? new Biquad().hp(sr, o.hp, 0.7) : null;
  const lp = o.lp ? new Biquad().lp(sr, o.lp, 0.7) : null;
  const lp2 = o.lp ? new Biquad().lp(sr, o.lp, 0.7) : null;
  const bp = o.bp ? new Biquad().bp(sr, o.bp[0], o.bp[1]) : null;
  const sw = o.sweep;
  const a = o.a ?? 0.001;
  const d = o.d ?? dur / 4;
  const pink = o.pink ? new Pink(rng) : null;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if (sw && (i & 15) === 0) bp.bp(sr, sw[0] * Math.pow(sw[1] / sw[0], sw[2] ? Math.pow(u, sw[2]) : u), o.bp[1]);
    let x = pink ? pink.next() : rng() * 2 - 1;
    if (hp) x = hp.run(x);
    if (lp) x = lp2.run(lp.run(x));
    if (bp) x = bp.run(x);
    out[i] = x * (o.env ? o.env(u) : ar(i / sr, a, d));
  }
  return out;
}

// struck modal object (wood, metal, glass...). modes: [{f,d,a}]; excitation = short noise burst
export function modal(sr, rng, modes, len, exciteMs = 0.8, exciteLP = 0) {
  const n = Math.floor(len * sr);
  const out = new Float32Array(n);
  const bank = new ModeBank(sr, modes);
  const ex = Math.max(1, Math.floor((exciteMs / 1000) * sr));
  const elp = exciteLP ? new OnePole().lp(sr, exciteLP) : null;
  for (let i = 0; i < n; i++) {
    let x = i < ex ? (rng() * 2 - 1) * (1 - i / ex) : 0;
    if (elp) x = elp.run(x);
    out[i] = bank.run(x);
  }
  return out;
}

export function metalClick(sr, rng, f, decay = 0.012) {
  return modal(sr, rng, [
    { f, d: decay, a: 1 },
    { f: f * 1.73, d: decay * 0.8, a: 0.8 },
    { f: f * 2.94, d: decay * 0.6, a: 0.6 },
    { f: f * 4.21, d: decay * 0.45, a: 0.4 },
  ], decay * 7 + 0.004, 0.4);
}

export function woodModes(rng, k = 1, d = 1) {
  return [
    { f: 170 * k * rrange(rng, 0.92, 1.08), d: 0.07 * d, a: 1 },
    { f: 405 * k * rrange(rng, 0.92, 1.08), d: 0.05 * d, a: 0.8 },
    { f: 720 * k * rrange(rng, 0.92, 1.08), d: 0.035 * d, a: 0.6 },
    { f: 1180 * k * rrange(rng, 0.92, 1.08), d: 0.022 * d, a: 0.45 },
    { f: 2050 * k * rrange(rng, 0.9, 1.1), d: 0.012 * d, a: 0.3 },
  ];
}

export function metalModes(rng, f0, d = 1) {
  const r = [1, 2.76, 5.4, 8.93, 13.34, 1.51, 3.93];
  const dd = [1.1, 0.8, 0.55, 0.4, 0.28, 0.7, 0.45];
  const aa = [1, 0.7, 0.5, 0.35, 0.22, 0.4, 0.3];
  const m = [];
  for (let i = 0; i < r.length; i++) {
    const f = f0 * r[i] * rrange(rng, 0.985, 1.015);
    m.push({ f, d: dd[i] * d, a: aa[i] });
    m.push({ f: f * 1.004, d: dd[i] * d * 0.9, a: aa[i] * 0.5 }); // beating pair
  }
  return m;
}

// band-passed noise whoosh with a centre-frequency arc f0 -> fpk -> f1
export function whoosh(sr, rng, dur, f0, fpk, f1, q = 1.6, peakAt = 0.4) {
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const bp = new Biquad();
  const bp2 = new Biquad();
  const pk = new Pink(rng);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 15) === 0) {
      const f = u < peakAt ? f0 * Math.pow(fpk / f0, u / peakAt) : fpk * Math.pow(f1 / fpk, (u - peakAt) / (1 - peakAt));
      bp.bp(sr, f, q);
      bp2.bp(sr, f * 1.5, q);
    }
    const x = pk.next() * 2 + (rng() * 2 - 1) * 0.3;
    const e = u < peakAt ? Math.pow(u / peakAt, 1.5) : Math.pow(1 - (u - peakAt) / (1 - peakAt), 2);
    out[i] = (bp.run(x) + bp2.run(x) * 0.5) * e;
  }
  return out;
}

// sparse crackles: excitation impulses coloured by a HP + BP. rate per second, amp shaped by env(u)
export function crackles(sr, rng, dur, rate, o = {}) {
  const n = Math.floor(dur * sr);
  const ex = new Float32Array(n);
  const count = Math.floor(rate * dur);
  for (let k = 0; k < count; k++) {
    const u = o.skew ? Math.pow(rng(), o.skew) : rng();
    const i = Math.floor(u * n);
    const a = Math.pow(rng(), o.pow ?? 3) * (o.env ? o.env(u) : 1) * (rng() < 0.5 ? -1 : 1);
    const len = 1 + Math.floor(rng() * (o.len ?? 0.0012) * sr);
    for (let j = 0; j < len && i + j < n; j++) ex[i + j] += a * (rng() * 2 - 1) * (1 - j / len);
  }
  const hp = new Biquad().hp(sr, o.hp ?? 1200, 0.7);
  const bp = new Biquad().bp(sr, o.bp ?? 2600, 0.9);
  for (let i = 0; i < n; i++) {
    const h = hp.run(ex[i]);
    ex[i] = h * 0.6 + bp.run(h) * 1.2;
  }
  return ex;
}

// Minnaert bubbles / wet blips (exponentially decaying sines with rising pitch)
export function bubbles(sr, rng, dur, rate, fLo = 300, fHi = 1100, o = {}) {
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const count = Math.max(1, Math.floor(rate * dur));
  for (let k = 0; k < count; k++) {
    const u = o.skew ? Math.pow(rng(), o.skew) : rng();
    const s = Math.floor(u * n);
    const f0 = fLo * Math.pow(fHi / fLo, rng());
    const d = rrange(rng, 0.006, 0.02) * (600 / f0) ** 0.5;
    const a = rrange(rng, 0.3, 1) * (o.env ? o.env(u) : 1);
    const len = Math.floor(d * 6 * sr);
    let ph = 0;
    for (let j = 0; j < len && s + j < n; j++) {
      const t = j / sr;
      ph += (f0 * (1 + (t / d) * 0.25)) / sr;
      out[s + j] += Math.sin(TAU * ph) * Math.exp(-t / d) * (1 - Math.exp(-t / 0.0008)) * a;
    }
  }
  return out;
}

// stick-slip creak: irregular pulse train exciting wood resonances
export function creak(sr, rng, dur, rLo = 18, rHi = 70, k = 1) {
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const bank = new ModeBank(sr, [
    { f: 330 * k * rrange(rng, 0.9, 1.1), d: 0.03, a: 1 },
    { f: 520 * k * rrange(rng, 0.9, 1.1), d: 0.025, a: 0.8 },
    { f: 910 * k * rrange(rng, 0.9, 1.1), d: 0.018, a: 0.6 },
    { f: 1450 * k * rrange(rng, 0.9, 1.1), d: 0.01, a: 0.35 },
  ]);
  const w = new Wander(rng, sr, rrange(rng, 1.5, 3));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const r = lerp(rLo, rHi, 0.5 + 0.5 * w.next());
    ph += r / sr;
    let x = 0;
    if (ph >= 1) {
      ph -= 1 + (rng() - 0.5) * 0.3;
      x = (0.5 + rng() * 0.5) * (rng() < 0.08 ? 2 : 1);
    }
    out[i] = bank.run(x) * hann(u * 0.5 + 0.25) * Math.min(1, u * 8);
  }
  return out;
}

// cloth rustle
export function rustle(sr, rng, dur, f = 2400) {
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const bp = new Biquad().bp(sr, f, 0.6);
  const hp = new Biquad().hp(sr, 700, 0.7);
  const w = new Wander(rng, sr, 40);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const g = Math.max(0, 0.4 + 0.6 * w.next());
    out[i] = bp.run(hp.run(rng() * 2 - 1)) * g * g * hann(u);
  }
  return out;
}

// ------------------------------------------------------------------ gunshots
export const GUNS = {
  pistol: {
    dur: 1.0, crack: 0.8, crackHP: 3000, crackDecay: 0.0011, nwave: 0,
    bodyHP: 450, bodyLP0: 7500, bodyLP1: 900, lpSweep: 0.03, bodyDecay: 0.032, bark: [1400, 1.2, 5],
    thump: 0.75, thumpF0: 180, thumpF1: 52, thumpSweep: 0.02, thumpDecay: 0.05,
    tail: 0.07, tailLP: 1300, tailDecay: 0.16,
    mech: [[0.032, 2600, 0.1], [0.068, 1900, 0.07]], echoes: [[0.2, 0.06], [0.46, 0.03]], drive: 1.8,
  },
  ak47: {
    dur: 1.2, crack: 0.9, crackHP: 2200, crackDecay: 0.0014, nwave: 0.25,
    bodyHP: 260, bodyLP0: 5200, bodyLP1: 700, lpSweep: 0.04, bodyDecay: 0.042, bark: [820, 1.4, 7],
    thump: 0.85, thumpF0: 140, thumpF1: 44, thumpSweep: 0.022, thumpDecay: 0.06,
    tail: 0.09, tailLP: 950, tailDecay: 0.22,
    mech: [[0.042, 1250, 0.1]], echoes: [[0.24, 0.07], [0.53, 0.035], [0.9, 0.018]], drive: 2.2,
  },
  shotgun: {
    dur: 1.7, crack: 0.6, crackHP: 1500, crackDecay: 0.0018, nwave: 0,
    bodyHP: 100, bodyLP0: 3600, bodyLP1: 380, lpSweep: 0.05, bodyDecay: 0.075, bark: [300, 1, 5],
    thump: 1.1, thumpF0: 105, thumpF1: 33, thumpSweep: 0.035, thumpDecay: 0.11,
    tail: 0.14, tailLP: 650, tailDecay: 0.35,
    mech: [], echoes: [[0.27, 0.1], [0.61, 0.05], [1.02, 0.025]], drive: 2,
  },
  rifle: {
    dur: 2.7, crack: 1.0, crackHP: 4000, crackDecay: 0.0009, nwave: 0.8,
    bodyHP: 380, bodyLP0: 9000, bodyLP1: 1100, lpSweep: 0.025, bodyDecay: 0.038, bark: [1100, 1, 4],
    thump: 0.8, thumpF0: 150, thumpF1: 48, thumpSweep: 0.02, thumpDecay: 0.07,
    tail: 0.08, tailLP: 1500, tailDecay: 0.4,
    mech: [], echoes: [[0.33, 0.18], [0.72, 0.11], [1.25, 0.06], [1.86, 0.03]], drive: 1.7,
  },
  // 5.56 carbine: snappier and brighter than the AK, supersonic crack, short buffer spring twang
  m4a1: {
    dur: 1.15, crack: 1.0, crackHP: 3200, crackDecay: 0.001, nwave: 0.45,
    bodyHP: 340, bodyLP0: 7000, bodyLP1: 850, lpSweep: 0.03, bodyDecay: 0.034, bark: [1150, 1.3, 6],
    thump: 0.7, thumpF0: 160, thumpF1: 50, thumpSweep: 0.018, thumpDecay: 0.05,
    tail: 0.08, tailLP: 1100, tailDecay: 0.2,
    mech: [[0.03, 2100, 0.09], [0.05, 3400, 0.04]], echoes: [[0.23, 0.07], [0.51, 0.035], [0.86, 0.016]], drive: 2.1,
  },
  // 9mm SMG: pistol-calibre pop with a busy roller-delayed bolt, little low end
  mp5: {
    dur: 0.85, crack: 0.7, crackHP: 2800, crackDecay: 0.0012, nwave: 0,
    bodyHP: 520, bodyLP0: 6800, bodyLP1: 1000, lpSweep: 0.025, bodyDecay: 0.026, bark: [1600, 1.2, 5],
    thump: 0.55, thumpF0: 200, thumpF1: 60, thumpSweep: 0.016, thumpDecay: 0.04,
    tail: 0.05, tailLP: 1400, tailDecay: 0.13,
    mech: [[0.024, 2900, 0.12], [0.046, 2200, 0.08]], echoes: [[0.19, 0.05], [0.43, 0.025]], drive: 1.7,
  },
  // double-barrel 12 gauge: bigger, rounder boom than the pump, long rolling tail
  dbshotgun: {
    dur: 1.9, crack: 0.65, crackHP: 1300, crackDecay: 0.002, nwave: 0,
    bodyHP: 80, bodyLP0: 3300, bodyLP1: 340, lpSweep: 0.055, bodyDecay: 0.085, bark: [260, 1, 6],
    thump: 1.25, thumpF0: 95, thumpF1: 30, thumpSweep: 0.04, thumpDecay: 0.13,
    tail: 0.16, tailLP: 600, tailDecay: 0.4,
    mech: [], echoes: [[0.28, 0.11], [0.63, 0.055], [1.06, 0.028]], drive: 2.1,
  },
};

// Layered gunshot: transient crack (+ supersonic N-wave), band-shaped noise body, pitch-dropping thump,
// mechanical clicks, dark rumble tail and delayed tree-line echoes; soft-clipped for punch.
// fp = first person: stereo (decorrelated body/tail/echoes), more low thump.
export function gunshot(sr, rng, P, fp) {
  const n = Math.ceil(P.dur * sr);
  const v = (a) => a * (1 + (rng() - 0.5) * 0.12);
  const shared = new Float32Array(n);
  // transient crack
  const cn = Math.min(n, Math.floor(0.01 * sr));
  const crack = new Float32Array(cn);
  const hp = new Biquad().hp(sr, P.crackHP, 0.8);
  for (let i = 0; i < cn; i++) crack[i] = hp.run(rng() * 2 - 1) * Math.exp(-i / sr / P.crackDecay);
  if (P.nwave) {
    const len = Math.max(3, Math.floor(0.0007 * sr));
    normalize(crack, 1);
    for (let i = 0; i < len; i++) crack[i] += P.nwave * (1 - (2 * i) / len);
  }
  addNorm(shared, crack, sr, 0, P.crack);
  // low thump (pitch drop)
  addNorm(shared, thump(sr, v(P.thumpF0), P.thumpF1, P.thumpSweep, v(P.thumpDecay), Math.min(P.dur, P.thumpDecay * 8)), sr, 0, P.thump * (fp ? 1.15 : 0.75));
  // mechanical tail (slide / bolt carrier)
  for (const [t, f, a] of P.mech) addNorm(shared, metalClick(sr, rng, v(f), 0.012), sr, t + (rng() - 0.5) * 0.006, a);

  const nch = fp ? 2 : 1;
  const outs = [];
  const bd = v(P.bodyDecay);
  const bn = Math.min(n, Math.floor(bd * 14 * sr));
  for (let ch = 0; ch < nch; ch++) {
    const c = new Float32Array(n);
    // noise body: fast attack, band-shaped, closing low-pass
    const body = new Float32Array(bn);
    const bhp = new Biquad().hp(sr, P.bodyHP, 0.7);
    const blp = new Biquad();
    const blp2 = new Biquad();
    const bark = new Biquad().peak(sr, P.bark[0], P.bark[1], P.bark[2]);
    for (let i = 0; i < bn; i++) {
      const t = i / sr;
      if ((i & 15) === 0) {
        const f = P.bodyLP1 + (P.bodyLP0 - P.bodyLP1) * Math.exp(-t / P.lpSweep);
        blp.lp(sr, f, 0.6);
        blp2.lp(sr, f * 1.3, 0.6);
      }
      const e = (1 - Math.exp(-t / 0.0005)) * (Math.exp(-t / bd) * 0.92 + 0.08 * Math.exp(-t / (bd * 2.5)));
      body[i] = bark.run(blp2.run(blp.run(bhp.run(rng() * 2 - 1)))) * e;
    }
    normalize(body, 1);
    mixInto(c, body, 0, 1);
    // dark rumble tail (the blast rolling through the trees)
    const tail = new Float32Array(n);
    const tl = new Biquad().lp(sr, P.tailLP, 0.7);
    const tl2 = new OnePole().lp(sr, P.tailLP * 0.8);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      tail[i] = tl.run(tl2.run(rng() * 2 - 1)) * (1 - Math.exp(-t / 0.015)) * Math.exp(-t / P.tailDecay);
    }
    addNorm(c, tail, sr, 0, P.tail);
    // echoes off the tree line / hills: darker delayed copies of the blast
    const src = new Float32Array(bn);
    for (let i = 0; i < bn; i++) src[i] = body[i] + shared[i] * 0.4;
    for (const [et, eg] of P.echoes) {
      const d = Math.floor((et + (fp ? (ch ? 0.017 : -0.011) : 0) + (rng() - 0.5) * 0.02) * sr);
      const e1 = new OnePole().lp(sr, 1500);
      const e2 = new OnePole().lp(sr, 1100);
      const echo = new Float32Array(bn);
      for (let i = 0; i < bn; i++) echo[i] = e2.run(e1.run(src[i]));
      addNorm(c, echo, sr, d / sr, eg);
    }
    for (let i = 0; i < n; i++) c[i] += shared[i];
    outs.push(c);
  }
  normalize(fp ? outs : outs[0], 1);
  softclip(fp ? outs : outs[0], P.drive);
  return finish(fp ? outs : outs[0], sr, 0.95, 0.0001, 0.08);
}

// ------------------------------------------------------------------ voices (zombies, players, creatures)
export const VOWELS = {
  a: [730, 1090, 2440], o: [570, 840, 2410], u: [300, 870, 2240], uh: [520, 1190, 2390],
  e: [530, 1840, 2480], i: [270, 2290, 3010], ae: [660, 1720, 2410], er: [490, 1350, 1690], oo: [350, 700, 2300],
};

// Glottal-pulse source -> parallel formant band-passes -> gurgle / rasp AM -> waveshaper.
// p.pitch: [[u,hz]], p.vowels: [[u,'a']], p.env: [[u,amp]] (u = normalised time)
export function voice(sr, rng, p) {
  const dur = p.dur;
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  const pitch = new Curve(p.pitch);
  const fs = p.fscale ?? 1;
  const F = [0, 1, 2].map((k) => new Curve(p.vowels.map(([u, v]) => [u, VOWELS[v][k] * fs])));
  const env = new Curve(p.env);
  const bwm = p.bw ?? 1;
  const bw = [90 * bwm, 120 * bwm, 180 * bwm];
  const fa = [1, p.a2 ?? 0.65, p.a3 ?? 0.4];
  const fl = [new Biquad(), new Biquad(), new Biquad()];
  const f4 = new Biquad().bp(sr, 3300 * fs, 3);
  const body = new OnePole().lp(sr, 380 * fs);
  const jit = new Wander(rng, sr, p.jitterHz ?? 28);
  const gur = new Wander(rng, sr, p.gurgleHz ?? 22);
  const rasp = new Wander(rng, sr, p.raspHz ?? 110);
  const bhp = new OnePole().lp(sr, 900);
  const jitter = p.jitter ?? 0.03;
  const shimmer = p.shimmer ?? 0.2;
  const sub = p.sub ?? 0;
  const breath = p.breath ?? 0.1;
  const voiced = p.voiced ?? 1;
  const gurgle = p.gurgle ?? 0;
  const raspA = p.rasp ?? 0;
  const vib = p.vib ?? 0;
  const vibHz = p.vibHz ?? 5.5;
  const chest = p.chest ?? 0.3;
  const a4 = p.a4 ?? 0.15;
  let ph = 0;
  let pulse = 0;
  let pAmp = 1;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 31) === 0) {
      for (let k = 0; k < 3; k++) {
        const f = F[k].at(u);
        fl[k].bp(sr, f, f / bw[k]);
      }
    }
    const f = pitch.at(u) * (1 + jit.next() * jitter + (vib ? vib * Math.sin((TAU * vibHz * i) / sr) : 0));
    const dt = f / sr;
    ph += dt;
    if (ph >= 1) {
      ph -= 1;
      pulse++;
      pAmp = (1 - shimmer * rng()) * (pulse & 1 ? 1 - sub : 1);
    }
    let saw = 2 * ph - 1;
    saw -= polyblep(ph, dt);
    let src = -saw * pAmp * voiced;
    src += bhp.hp(rng() * 2 - 1) * breath * (ph < 0.5 ? 1.3 : 0.6);
    let y = fl[0].run(src) * fa[0] + fl[1].run(src) * fa[1] + fl[2].run(src) * fa[2] + f4.run(src) * a4;
    y += body.run(src) * chest;
    if (gurgle) y *= 1 - gurgle * (0.5 + 0.5 * gur.next());
    if (raspA) y *= 1 + raspA * rasp.next();
    out[i] = y * env.at(u);
  }
  normalize(out, 1);
  if (p.bubbles) {
    const b = bubbles(sr, rng, dur, p.bubbles, 250, 900, { env: (u) => env.at(u) });
    addNorm(out, b, sr, 0, 0.35 * (p.bubbleAmp ?? 1));
  }
  const drive = p.drive ?? 1.5;
  const nd = Math.tanh(drive);
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * drive) / nd;
  if (p.hp) {
    const h = new Biquad().hp(sr, p.hp, 0.7);
    for (let i = 0; i < n; i++) out[i] = h.run(out[i]);
  }
  return finish(out, sr, 0.9, 0.004, 0.04);
}

function contour(rng, base, k, lo, hi, endMul = 1) {
  const pts = [];
  for (let j = 0; j <= k; j++) pts.push([j / k, base * rrange(rng, lo, hi) * (j === k ? endMul : 1)]);
  return pts;
}
function vowelPath(list, rng) {
  const n = list.length;
  return list.map((v, j) => [n === 1 ? 0 : clamp(j / (n - 1) + (j > 0 && j < n - 1 ? (rng() - 0.5) * 0.1 : 0), 0, 1), v]);
}

const GROWL_V = [['uh', 'a', 'o', 'u'], ['o', 'a', 'uh', 'er'], ['u', 'uh', 'a', 'o'], ['a', 'o', 'u', 'uh'], ['er', 'a', 'uh', 'u'], ['o', 'u', 'a', 'uh']];

export function zGrowl(sr, rng, i) {
  const dur = rrange(rng, 1.1, 1.9);
  return voice(sr, rng, {
    dur, pitch: contour(rng, rrange(rng, 72, 105), 5, 0.8, 1.25, 0.8), vowels: vowelPath(GROWL_V[i % GROWL_V.length], rng),
    fscale: rrange(rng, 0.78, 0.92), bw: 1.7, jitter: 0.07, shimmer: 0.45, sub: rrange(rng, 0.35, 0.7),
    gurgle: rrange(rng, 0.4, 0.75), gurgleHz: rrange(rng, 14, 30), rasp: 0.5, breath: 0.3, drive: rrange(rng, 2.5, 4),
    chest: 0.6, bubbles: rrange(rng, 3, 9), env: [[0, 0], [0.12, 1], [0.35, 0.72], [0.55, 0.95], [0.85, 0.55], [1, 0]],
  });
}
export function zAttack(sr, rng, i) {
  const b = rrange(rng, 105, 130);
  return voice(sr, rng, {
    dur: rrange(rng, 0.55, 0.85), pitch: [[0, b], [0.15, b * 1.5], [0.5, b * 1.3], [1, b * 0.75]],
    vowels: vowelPath([['a', 'ae', 'a', 'uh'], ['ae', 'a', 'o'], ['a', 'a', 'er', 'uh']][i % 3], rng),
    fscale: rrange(rng, 0.85, 0.95), bw: 1.8, jitter: 0.09, shimmer: 0.4, sub: 0.3, gurgle: 0.3, rasp: 0.75, raspHz: 140,
    breath: 0.4, drive: rrange(rng, 4, 5.5), chest: 0.5, bubbles: 4, env: [[0, 0], [0.05, 1], [0.5, 0.9], [0.8, 0.5], [1, 0]],
  });
}
export function zDeath(sr, rng, i) {
  const b = rrange(rng, 120, 145);
  return voice(sr, rng, {
    dur: rrange(rng, 1.7, 2.4), pitch: [[0, b], [0.1, b * 1.1], [0.35, b * 0.85], [0.7, b * 0.55], [1, b * 0.4]],
    vowels: vowelPath([['a', 'o', 'u', 'uh'], ['ae', 'a', 'o', 'u'], ['a', 'er', 'o', 'uh']][i % 3], rng),
    fscale: rrange(rng, 0.8, 0.92), bw: 1.6, jitter: 0.08, shimmer: 0.5, sub: rrange(rng, 0.4, 0.7), gurgle: 0.65, gurgleHz: 12,
    rasp: 0.5, breath: 0.35, drive: 3, chest: 0.6, bubbles: 14, bubbleAmp: 1.4,
    env: [[0, 0], [0.05, 1], [0.3, 0.85], [0.65, 0.5], [0.9, 0.22], [1, 0]],
  });
}
export function zPain(sr, rng, i) {
  const b = rrange(rng, 140, 175);
  return voice(sr, rng, {
    dur: rrange(rng, 0.35, 0.55), pitch: [[0, b], [0.2, b * 1.3], [1, b * 0.7]],
    vowels: vowelPath([['ae', 'a', 'uh'], ['a', 'uh'], ['e', 'a', 'er']][i % 3], rng),
    fscale: 0.9, bw: 1.6, jitter: 0.08, shimmer: 0.4, sub: 0.3, gurgle: 0.35, rasp: 0.6, breath: 0.35, drive: 3.5, chest: 0.4,
    env: [[0, 0], [0.06, 1], [0.4, 0.8], [1, 0]],
  });
}
export function zRunner(sr, rng) {
  const b = rrange(rng, 360, 420);
  return voice(sr, rng, {
    dur: rrange(rng, 1.0, 1.4), pitch: [[0, b * 0.7], [0.12, b * 1.5], [0.4, b * 1.35], [0.7, b * 1.2], [1, b * 0.7]],
    vowels: vowelPath(['ae', 'a', 'ae', 'a', 'er'], rng), fscale: 1.05, bw: 2.2, jitter: 0.1, jitterHz: 40, shimmer: 0.5,
    sub: 0.2, gurgle: 0.15, rasp: 0.85, raspHz: 180, breath: 0.5, drive: 5, chest: 0.2, a3: 0.6, a4: 0.4,
    env: [[0, 0], [0.08, 1], [0.6, 0.9], [0.85, 0.5], [1, 0]],
  });
}
export function zTank(sr, rng) {
  const b = rrange(rng, 48, 56);
  const main = voice(sr, rng, {
    dur: rrange(rng, 2.0, 2.5), pitch: [[0, b * 0.85], [0.15, b * 1.3], [0.5, b * 1.15], [0.8, b], [1, b * 0.7]],
    vowels: vowelPath(['o', 'a', 'a', 'o', 'u'], rng), fscale: 0.62, bw: 2, jitter: 0.07, shimmer: 0.5, sub: 0.6,
    gurgle: 0.5, gurgleHz: 16, rasp: 0.7, raspHz: 90, breath: 0.45, drive: 5, chest: 1.2, bubbles: 5,
    env: [[0, 0], [0.1, 1], [0.6, 0.9], [0.85, 0.5], [1, 0]],
  });
  const sub = thump(sr, 70, 38, 0.4, 0.7, main.length / sr);
  addNorm(main, sub, sr, 0.05, 0.4);
  return normalize(main, 0.92);
}
export function zSpit(sr, rng) {
  const out = alloc(sr, 1.0);
  const hock = voice(sr, rng, {
    dur: 0.45, pitch: [[0, 90], [1, 120]], vowels: [[0, 'er'], [0.6, 'i'], [1, 'i']], voiced: 0.3, breath: 1.2,
    rasp: 1, raspHz: 60, gurgle: 0.6, gurgleHz: 25, drive: 3, env: [[0, 0], [0.3, 0.6], [0.85, 1], [1, 0]],
  });
  addNorm(out, hock, sr, 0, 0.6);
  addNorm(out, noise(sr, rng, 0.12, { bp: [1600, 0.8], a: 0.002, d: 0.03 }), sr, 0.47, 0.9);
  addNorm(out, bubbles(sr, rng, 0.25, 60, 400, 1500, { env: (u) => 1 - u }), sr, 0.48, 0.5);
  addNorm(out, thump(sr, 140, 70, 0.02, 0.03), sr, 0.47, 0.45);
  return finish(out, sr);
}
export function zLeaper(sr, rng) {
  const b = rrange(rng, 420, 480);
  return voice(sr, rng, {
    dur: rrange(rng, 0.8, 1.0), pitch: [[0, b], [0.5, b * 2.0], [0.8, b * 1.8], [1, b * 1.3]],
    vowels: vowelPath(['i', 'ae', 'i', 'e'], rng), fscale: 1.12, bw: 2.4, jitter: 0.12, jitterHz: 50, shimmer: 0.6, sub: 0.25,
    rasp: 0.9, raspHz: 220, breath: 0.55, drive: 5, chest: 0.1, a3: 0.7, a4: 0.5,
    env: [[0, 0], [0.1, 0.7], [0.6, 1], [0.85, 0.6], [1, 0]],
  });
}
export function zRoper(sr, rng) {
  const out = alloc(sr, 0.85);
  addNorm(out, whoosh(sr, rng, 0.16, 500, 3500, 2500, 1.4, 0.7), sr, 0, 0.7);
  // elastic twang
  const tw = new Float32Array(Math.floor(0.4 * sr));
  let ph = 0;
  for (let i = 0; i < tw.length; i++) {
    const t = i / sr;
    ph += (140 + 560 * Math.exp(-t / 0.08)) / sr;
    tw[i] = Math.tanh(Math.sin(TAU * ph) * 2) * Math.exp(-t / 0.12) * (1 + 0.3 * Math.sin(TAU * 38 * t));
  }
  addNorm(out, tw, sr, 0.12, 0.45);
  addNorm(out, thump(sr, 120, 60, 0.02, 0.05), sr, 0.15, 0.8);
  addNorm(out, noise(sr, rng, 0.2, { bp: [900, 2], sweep: [1400, 500], a: 0.002, d: 0.05 }), sr, 0.15, 0.7);
  addNorm(out, bubbles(sr, rng, 0.3, 45, 350, 1400, { env: (u) => 1 - u }), sr, 0.16, 0.4);
  return finish(out, sr);
}
export function zBoomer(sr, rng) {
  const b = rrange(rng, 60, 72);
  return voice(sr, rng, {
    dur: rrange(rng, 1.4, 1.9), pitch: [[0, b], [0.3, b * 1.2], [0.7, b * 0.95], [1, b * 0.8]],
    vowels: vowelPath(['o', 'u', 'o', 'uh'], rng), fscale: 0.74, bw: 1.8, jitter: 0.08, shimmer: 0.6, sub: 0.5,
    gurgle: 0.85, gurgleHz: 9, rasp: 0.4, breath: 0.3, drive: 2.6, chest: 1, bubbles: 28, bubbleAmp: 1.8,
    env: [[0, 0], [0.1, 0.8], [0.4, 1], [0.8, 0.6], [1, 0]],
  });
}
export function zBat(sr, rng) {
  const out = alloc(sr, 0.75);
  const count = 3 + Math.floor(rng() * 3);
  let t = 0.01;
  for (let k = 0; k < count && t < 0.6; k++) {
    const len = rrange(rng, 0.05, 0.11);
    const c = new Float32Array(Math.floor(len * sr));
    const f0 = rrange(rng, 2000, 2600);
    const f1 = f0 * rrange(rng, 1.3, 1.7);
    let ph = 0;
    for (let i = 0; i < c.length; i++) {
      const u = i / c.length;
      const f = u < 0.4 ? lerp(f0, f1, u / 0.4) : lerp(f1, f0 * 1.1, (u - 0.4) / 0.6);
      ph += (f * (1 + 0.04 * Math.sin(TAU * 55 * (i / sr)))) / sr;
      c[i] = Math.tanh(Math.sin(TAU * ph) * 2.5) * hann(u) + (rng() * 2 - 1) * 0.15 * hann(u);
    }
    addNorm(out, c, sr, t, rrange(rng, 0.6, 1));
    t += len + rrange(rng, 0.03, 0.09);
  }
  return finish(out, sr);
}
export function zBoss(sr, rng) {
  const dur = rrange(rng, 2.8, 3.2);
  const out = alloc(sr, dur + 0.2);
  const lay = [[38, 0.5, 1], [57, 0.6, 0.8], [86, 0.72, 0.55]];
  for (const [b, fsc, a] of lay) {
    const v = voice(sr, rng, {
      dur, pitch: [[0, b * 0.8], [0.12, b * 1.25], [0.5, b * 1.1], [0.8, b * 0.95], [1, b * 0.6]],
      vowels: vowelPath(['o', 'a', 'a', 'o', 'u'], rng), fscale: fsc, bw: 2.2, jitter: 0.08, shimmer: 0.5, sub: 0.6,
      gurgle: 0.45, gurgleHz: 14, rasp: 0.8, raspHz: 80, breath: 0.5, drive: 6, chest: 1.2, bubbles: 4,
      env: [[0, 0], [0.08, 1], [0.6, 0.9], [0.85, 0.5], [1, 0]],
    });
    addNorm(out, v, sr, rng() * 0.05, a);
  }
  addNorm(out, thump(sr, 55, 28, 0.6, 1.1, dur), sr, 0.05, 0.6);
  const br = new Brown(rng);
  const lp = new Biquad().lp(sr, 500, 0.8);
  const w = new Wander(rng, sr, 9);
  const nr = new Float32Array(Math.floor(dur * sr));
  for (let i = 0; i < nr.length; i++) nr[i] = lp.run(br.next()) * (0.6 + 0.4 * w.next()) * hann(i / nr.length * 0.5 + 0.1);
  addNorm(out, nr, sr, 0.1, 0.35);
  softclip(out, 1.5);
  return finish(out, sr, 0.95);
}
// the shade stalking in the dark: several breathy, almost voiceless whispers on top of each other, no words
export function shadeWhisper(sr, rng, i) {
  const dur = rrange(rng, 1.3, 1.9);
  const out = alloc(sr, dur + 0.25);
  const paths = [['i', 'e', 'u', 'i'], ['u', 'ae', 'i', 'e'], ['e', 'i', 'a', 'u']];
  for (let k = 0; k < 3; k++) {
    const b = rrange(rng, 150, 210);
    const w = voice(sr, rng, {
      dur: dur * rrange(rng, 0.7, 1), pitch: contour(rng, b, 4, 0.85, 1.2, 0.8), vowels: vowelPath(paths[(i + k) % 3], rng),
      fscale: rrange(rng, 1.0, 1.25), bw: 2.6, voiced: 0.05, breath: 1.5, rasp: 0.6, raspHz: rrange(rng, 6, 11), jitter: 0.1, shimmer: 0.6,
      drive: 1.2, chest: 0, a3: 0.8, a4: 0.6, hp: 500, env: [[0, 0], [0.2, 0.7], [0.45, 1], [0.7, 0.55], [1, 0]],
    });
    addNorm(out, w, sr, k * rrange(rng, 0.05, 0.12), 0.7 - k * 0.15);
  }
  return finish(out, sr, 0.8, 0.02, 0.12);
}
// light catches it: a sharp indrawn hiss, then it sets hard like cooling stone
export function shadeFreeze(sr, rng) {
  const out = alloc(sr, 0.75);
  addNorm(out, noise(sr, rng, 0.2, { bp: [1500, 1.6], sweep: [900, 5200], env: (u) => u * u * (1 - smoothstep((u - 0.9) / 0.1)) }), sr, 0, 0.8);
  addNorm(out, modal(sr, rng, [
    { f: rrange(rng, 610, 680), d: 0.05, a: 1 }, { f: rrange(rng, 1380, 1520), d: 0.035, a: 0.8 },
    { f: rrange(rng, 2500, 2800), d: 0.02, a: 0.6 }, { f: rrange(rng, 4300, 4700), d: 0.012, a: 0.4 },
  ], 0.3, 1.2), sr, 0.19, 0.9);
  addNorm(out, crackles(sr, rng, 0.45, 70, { skew: 2.2, pow: 2, hp: 1800, bp: 3600 }), sr, 0.2, 0.55);
  addNorm(out, thump(sr, 95, 50, 0.03, 0.06), sr, 0.19, 0.5);
  return finish(out, sr, 0.9);
}
// the light is gone: a thin doubled shriek that climbs as it comes for you
export function shadeShriek(sr, rng) {
  const dur = rrange(rng, 0.9, 1.1);
  const out = alloc(sr, dur + 0.1);
  const b = rrange(rng, 520, 600);
  for (const det of [1, 1.07]) {
    const v = voice(sr, rng, {
      dur, pitch: [[0, b * det * 0.7], [0.25, b * det * 1.2], [0.7, b * det * 1.7], [1, b * det * 1.9]],
      vowels: vowelPath(['u', 'i', 'ae', 'i'], rng), fscale: 1.2, bw: 2.6, jitter: 0.14, jitterHz: 60, shimmer: 0.6, sub: 0.2,
      rasp: 0.8, raspHz: 260, breath: 0.9, drive: 4, chest: 0, a3: 0.8, a4: 0.6, hp: 350,
      env: [[0, 0], [0.08, 0.5], [0.6, 1], [0.9, 0.7], [1, 0]],
    });
    addNorm(out, v, sr, det > 1 ? 0.02 : 0, det > 1 ? 0.6 : 1);
  }
  addNorm(out, whoosh(sr, rng, dur * 0.8, 500, 3000, 1400, 1.2, 0.6), sr, 0, 0.35);
  softclip(out, 2.5);
  return finish(out, sr, 0.9);
}

export function zpGrowl(sr, rng, i) {
  const b = rrange(rng, 90, 118);
  return voice(sr, rng, {
    dur: rrange(rng, 0.9, 1.3), pitch: contour(rng, b, 4, 0.85, 1.25, 0.8),
    vowels: vowelPath([['uh', 'a', 'er'], ['a', 'o', 'uh'], ['er', 'a', 'u']][i % 3], rng),
    fscale: 0.92, bw: 1.5, jitter: 0.06, shimmer: 0.35, sub: 0.4, gurgle: 0.5, rasp: 0.55, breath: 0.35, drive: 3.2,
    chest: 0.5, bubbles: 4, env: [[0, 0], [0.1, 1], [0.6, 0.85], [1, 0]],
  });
}

// the stray cat: "mi-a-ow" - small vocal tract (high formants), bright rising-falling pitch, no gurgle
const MEOW_V = [['u', 'i', 'ae', 'a', 'o', 'u'], ['u', 'e', 'a', 'o', 'oo'], ['i', 'ae', 'a', 'u']];
export function catMeow(sr, rng, i) {
  const b = rrange(rng, 540, 720);
  const short = i % 3 === 2; // a quick chirpy "mrrp"
  return voice(sr, rng, {
    dur: short ? rrange(rng, 0.28, 0.36) : rrange(rng, 0.55, 0.85),
    pitch: short ? [[0, b * 0.8], [0.4, b * 1.2], [1, b * 1.1]] : [[0, b * 0.78], [0.25, b * 1.12], [0.55, b * 1.05], [0.85, b * 0.82], [1, b * 0.66]],
    vowels: vowelPath(MEOW_V[i % MEOW_V.length], rng), fscale: rrange(rng, 1.45, 1.6), bw: 1.25, jitter: 0.015, jitterHz: 18,
    shimmer: 0.08, breath: 0.12, rasp: short ? 0.35 : 0.08, raspHz: 38, vib: 0.012, vibHz: 6, drive: 1.3, chest: 0.04, a3: 0.55, a4: 0.3, hp: 320,
    env: short ? [[0, 0], [0.12, 1], [0.6, 0.8], [1, 0]] : [[0, 0], [0.1, 0.45], [0.3, 1], [0.7, 0.8], [0.9, 0.35], [1, 0]],
  });
}

// human (player) sounds
export function humanHurt(sr, rng, i) {
  const b = rrange(rng, 125, 150);
  return voice(sr, rng, {
    dur: rrange(rng, 0.26, 0.42), pitch: [[0, b], [0.2, b * 1.18], [1, b * 0.82]],
    vowels: vowelPath([['uh', 'uh'], ['a', 'uh'], ['uh', 'a', 'uh'], ['e', 'uh']][i % 4], rng),
    fscale: rrange(rng, 0.98, 1.05), bw: 1.05, jitter: 0.02, shimmer: 0.12, rasp: 0.2, breath: 0.35, drive: 1.8, chest: 0.35,
    env: [[0, 0], [0.08, 1], [0.45, 0.75], [1, 0]],
  });
}
export function humanDeath(sr, rng) {
  const b = rrange(rng, 150, 170);
  const out = alloc(sr, 1.9);
  const v = voice(sr, rng, {
    dur: 1.4, pitch: [[0, b], [0.15, b * 1.12], [0.5, b * 0.9], [1, b * 0.6]], vowels: vowelPath(['a', 'a', 'o', 'uh'], rng),
    fscale: 1, bw: 1.1, jitter: 0.04, shimmer: 0.2, rasp: 0.35, breath: 0.4, drive: 2, chest: 0.4,
    env: [[0, 0], [0.06, 1], [0.4, 0.8], [0.8, 0.35], [1, 0]],
  });
  addNorm(out, v, sr, 0, 0.9);
  const ex = voice(sr, rng, {
    dur: 0.5, pitch: [[0, 100], [1, 80]], vowels: [[0, 'uh'], [1, 'u']], voiced: 0.15, breath: 1, drive: 1.2,
    env: [[0, 0], [0.2, 1], [1, 0]],
  });
  addNorm(out, ex, sr, 1.35, 0.35);
  return finish(out, sr);
}
export function breath(sr, rng) {
  const out = alloc(sr, 2.1);
  let t = 0.02;
  let k = 0;
  while (t < 1.85) {
    const ex = k % 2 === 0;
    const len = ex ? rrange(rng, 0.2, 0.26) : rrange(rng, 0.16, 0.2);
    const v = voice(sr, rng, {
      dur: len, pitch: [[0, 120], [1, 105]], vowels: ex ? [[0, 'a'], [1, 'uh']] : [[0, 'e'], [1, 'i']],
      voiced: ex ? 0.12 : 0.03, breath: 1, bw: 1.6, drive: 1.3, hp: ex ? 200 : 600,
      env: ex ? [[0, 0], [0.15, 1], [0.6, 0.6], [1, 0]] : [[0, 0], [0.5, 1], [1, 0]],
    });
    addNorm(out, v, sr, t, ex ? 0.85 : 0.45);
    t += len + rrange(rng, 0.03, 0.07);
    k++;
  }
  return finish(out, sr);
}

// ------------------------------------------------------------------ impacts
export function fleshHit(sr, rng, heavy = 0) {
  const out = alloc(sr, 0.45);
  addNorm(out, thump(sr, rrange(rng, 95, 120), 50, 0.02, 0.04 + heavy * 0.02), sr, 0, 0.9);
  addNorm(out, noise(sr, rng, 0.2, { bp: [1200, 2.5], sweep: [rrange(rng, 1300, 1700), 450], a: 0.001, d: 0.05 + heavy * 0.02 }), sr, 0.002, 0.8);
  addNorm(out, noise(sr, rng, 0.08, { lp: 700, a: 0.001, d: 0.02 }), sr, 0, 0.6);
  addNorm(out, bubbles(sr, rng, 0.25, 20, 500, 1600, { env: (u) => 1 - u }), sr, 0.01, 0.25);
  if (heavy) addNorm(out, crackles(sr, rng, 0.04, 400, { hp: 1800, bp: 3000 }), sr, 0.004, 0.5 * heavy);
  softclip(out, 1.6);
  return finish(out, sr);
}
export function headshotWet(sr, rng) {
  const out = alloc(sr, 0.6);
  addNorm(out, fleshHit(sr, rng, 1), sr, 0, 0.9);
  addNorm(out, crackles(sr, rng, 0.05, 500, { hp: 1500, bp: 2600, pow: 1.5 }), sr, 0.003, 0.7);
  addNorm(out, bubbles(sr, rng, 0.4, 40, 600, 2200, { env: (u) => (1 - u) ** 2 }), sr, 0.02, 0.35);
  return finish(out, sr);
}
export function woodHit(sr, rng, k = 1) {
  const out = alloc(sr, 0.4);
  addNorm(out, modal(sr, rng, woodModes(rng, k * rrange(rng, 0.9, 1.15)), 0.38, 1.5, 3000), sr, 0, 1);
  addNorm(out, thump(sr, 120, 70, 0.015, 0.03), sr, 0, 0.5);
  addNorm(out, noise(sr, rng, 0.05, { bp: [2500, 1], a: 0.0005, d: 0.008 }), sr, 0, 0.4);
  return finish(out, sr);
}
export function woodBreak(sr, rng) {
  const out = alloc(sr, 1.4);
  addNorm(out, noise(sr, rng, 0.08, { hp: 300, a: 0.0005, d: 0.02 }), sr, 0, 0.9);
  addNorm(out, modal(sr, rng, woodModes(rng, 0.7, 1.5), 0.5, 2), sr, 0, 1);
  // splinters
  const sp = alloc(sr, 1.0);
  for (let k = 0; k < 34; k++) {
    const t = Math.pow(rng(), 1.8) * 0.8;
    const m = modal(sr, rng, [{ f: rrange(rng, 700, 3200), d: rrange(rng, 0.006, 0.02) }, { f: rrange(rng, 1500, 4500), d: 0.008, a: 0.6 }], 0.08, 0.5);
    addNorm(sp, m, sr, t, rrange(rng, 0.2, 1) * (1 - t));
  }
  addNorm(out, sp, sr, 0.01, 0.7);
  addNorm(out, creak(sr, rng, 0.45, 25, 90, 1.2), sr, 0.12, 0.35);
  for (let k = 0; k < 4; k++) addNorm(out, woodHit(sr, rng, rrange(rng, 1.2, 2)), sr, 0.35 + k * rrange(rng, 0.1, 0.22), rrange(rng, 0.15, 0.35));
  softclip(out, 1.4);
  return finish(out, sr);
}
export function metalHit(sr, rng, f0) {
  const out = alloc(sr, 1.4);
  addNorm(out, modal(sr, rng, metalModes(rng, f0 ?? rrange(rng, 300, 460)), 1.4, 0.5), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.03, { hp: 3000, a: 0.0003, d: 0.004 }), sr, 0, 0.5);
  addNorm(out, thump(sr, 160, 90, 0.01, 0.02), sr, 0, 0.35);
  return finish(out, sr);
}
export function glassBreak(sr, rng) {
  const out = alloc(sr, 1.0);
  addNorm(out, noise(sr, rng, 0.12, { hp: 2500, a: 0.0005, d: 0.03 }), sr, 0, 0.8);
  const sh = alloc(sr, 1.0);
  for (let k = 0; k < 26; k++) {
    const t = Math.pow(rng(), 2) * 0.65;
    const m = modal(sr, rng, [
      { f: rrange(rng, 2600, 8500), d: rrange(rng, 0.03, 0.2) },
      { f: rrange(rng, 3500, 9500), d: rrange(rng, 0.02, 0.1), a: 0.6 },
    ], 0.35, 0.3);
    addNorm(sh, m, sr, t, rrange(rng, 0.2, 1) * (1 - t * 0.9));
  }
  addNorm(out, sh, sr, 0.005, 0.9);
  return finish(out, sr);
}
export function hammerBuild(sr, rng) {
  const out = alloc(sr, 1.1);
  let t = 0;
  for (let k = 0; k < 3; k++) {
    addNorm(out, woodHit(sr, rng, rrange(rng, 1.0, 1.2)), sr, t, 0.9);
    addNorm(out, modal(sr, rng, [{ f: rrange(rng, 2300, 2700), d: 0.05 }, { f: rrange(rng, 3700, 4200), d: 0.03, a: 0.6 }], 0.25, 0.3), sr, t, 0.35);
    t += rrange(rng, 0.26, 0.32);
  }
  return finish(out, sr);
}
export function explosion(sr, rng) {
  // mono: played through a PannerNode
  const dur = 3.4;
  const n = Math.floor(dur * sr);
  const c = new Float32Array(n);
  const boom = new Float32Array(n);
  const lp = new Biquad();
  const lp2 = new Biquad();
  const br = new Brown(rng);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 15) === 0) {
      const f = 130 + 2600 * Math.exp(-t / 0.18);
      lp.lp(sr, f, 0.7);
      lp2.lp(sr, f, 0.7);
    }
    const e = (1 - Math.exp(-t / 0.004)) * (0.85 * Math.exp(-t / 0.22) + 0.15 * Math.exp(-t / 0.9));
    boom[i] = lp2.run(lp.run(rng() * 2 - 1)) * e * 3 + br.next() * Math.exp(-t / 1.1) * 0.25;
  }
  addNorm(c, boom, sr, 0, 1);
  addNorm(c, thump(sr, 80, 24, 0.25, 0.6, dur), sr, 0, 0.9);
  addNorm(c, noise(sr, rng, 0.03, { hp: 700, a: 0.0003, d: 0.006 }), sr, 0, 0.8);
  addNorm(c, crackles(sr, rng, 2.8, 70, { hp: 900, bp: 2200, skew: 1.6, env: (u) => (1 - u) ** 2, len: 0.004 }), sr, 0.12, 0.25);
  addNorm(c, noise(sr, rng, 2.4, { hp: 1200, lp: 5000, env: (u) => hann(u * 0.5 + 0.05) * (1 - u) }), sr, 0.4, 0.06);
  normalize(c, 1);
  softclip(c, 1.8);
  return finish(c, sr, 0.95, 0.0002, 0.2);
}
export function slam(sr, rng) {
  const out = alloc(sr, 1.8);
  addNorm(out, thump(sr, 65, 28, 0.12, 0.3, 1.8), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.6, { lp: 1200, a: 0.002, d: 0.09 }), sr, 0, 0.9);
  addNorm(out, crackles(sr, rng, 1.4, 50, { hp: 700, bp: 1800, skew: 1.5, env: (u) => (1 - u) ** 2, len: 0.004 }), sr, 0.05, 0.25);
  addNorm(out, woodHit(sr, rng, 0.5), sr, 0, 0.3);
  normalize(out, 1);
  softclip(out, 1.7);
  return finish(out, sr, 0.95);
}

// ------------------------------------------------------------------ misc world sfx
export function acidSizzle(sr, rng) {
  const out = alloc(sr, 1.3);
  addNorm(out, noise(sr, rng, 1.3, { hp: 2500, bp: [5500, 0.6], env: (u) => Math.min(1, u * 30) * Math.exp(-u * 2.5) }), sr, 0, 0.6);
  addNorm(out, crackles(sr, rng, 1.3, 140, { hp: 2000, bp: 4500, pow: 2, env: (u) => Math.exp(-u * 2) }), sr, 0, 0.8);
  addNorm(out, bubbles(sr, rng, 1.2, 30, 500, 1800, { env: (u) => Math.exp(-u * 2) }), sr, 0.02, 0.4);
  return finish(out, sr);
}
export function fireWhoosh(sr, rng) {
  const out = alloc(sr, 1.9);
  addNorm(out, glassBreak(sr, rng), sr, 0, 0.55);
  const n = Math.floor(1.8 * sr);
  const w = new Float32Array(n);
  const lp = new Biquad();
  const pk = new Pink(rng);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 15) === 0) lp.lp(sr, 150 + 3400 * (1 - Math.exp(-t / 0.12)) * Math.exp(-t / 0.9), 0.8);
    w[i] = lp.run(pk.next()) * Math.min(1, t / 0.12) * Math.exp(-t / 0.6);
  }
  addNorm(out, w, sr, 0.03, 1);
  addNorm(out, thump(sr, 95, 45, 0.05, 0.12), sr, 0.03, 0.6);
  addNorm(out, crackles(sr, rng, 1.6, 45, { hp: 1500, env: (u) => 1 - u }), sr, 0.1, 0.4);
  return finish(out, sr);
}
export function campfireAdd(sr, rng) {
  const out = alloc(sr, 1.3);
  addNorm(out, woodHit(sr, rng, 1.4), sr, 0, 0.5);
  addNorm(out, whoosh(sr, rng, 0.7, 200, 1600, 500, 0.8, 0.45), sr, 0.04, 0.8);
  addNorm(out, crackles(sr, rng, 1.2, 30, { hp: 1500, env: (u) => Math.exp(-u * 2.5) }), sr, 0.08, 0.6);
  return finish(out, sr);
}
export function crateLand(sr, rng) {
  const out = alloc(sr, 1.4);
  addNorm(out, thump(sr, 75, 38, 0.05, 0.12), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.3, { lp: 500, a: 0.002, d: 0.08 }), sr, 0, 0.8);
  addNorm(out, modal(sr, rng, woodModes(rng, 0.55, 1.8), 0.6, 2, 2000), sr, 0, 0.8);
  addNorm(out, creak(sr, rng, 0.5, 20, 60, 0.9), sr, 0.18, 0.3);
  for (let k = 0; k < 4; k++) addNorm(out, metalClick(sr, rng, rrange(rng, 1500, 3000), 0.02), sr, 0.04 + rng() * 0.3, 0.15);
  softclip(out, 1.5);
  return finish(out, sr);
}
export function carPart(sr, rng) {
  const out = alloc(sr, 1.1);
  addNorm(out, metalHit(sr, rng, rrange(rng, 170, 200)), sr, 0, 0.9);
  for (let k = 0; k < 5; k++) addNorm(out, metalClick(sr, rng, 2200, 0.01), sr, 0.3 + k * 0.065, 0.35);
  addNorm(out, modal(sr, rng, metalModes(rng, 260, 0.4), 0.5, 0.6), sr, 0.68, 0.5);
  return finish(out, sr);
}
export function carStart(sr, rng) {
  const dur = 4.6;
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  // A) starter motor cranking with compression strokes
  const crankEnd = 1.75;
  const cn = Math.floor(crankEnd * sr);
  const cr = new Float32Array(cn);
  const bp = new Biquad().bp(sr, 900, 1);
  const lpn = new Biquad().lp(sr, 350, 0.8);
  let ph = 0;
  for (let i = 0; i < cn; i++) {
    const t = i / sr;
    const comp = Math.pow(0.5 + 0.5 * Math.sin(TAU * 5.6 * t), 3);
    const f = (150 + 40 * Math.min(1, t)) * (1 - 0.1 * comp);
    ph += f / sr;
    const saw = 2 * (ph % 1) - 1;
    const e = Math.min(1, t / 0.05) * (t > crankEnd - 0.15 ? (crankEnd - t) / 0.15 : 1);
    cr[i] = (bp.run(saw) * 0.8 + lpn.run(rng() * 2 - 1) * comp * 2.5) * e;
  }
  addNorm(out, cr, sr, 0, 0.6);
  for (let t = 0.1; t < crankEnd - 0.1; t += 1 / 5.6) addNorm(out, thump(sr, 80, 55, 0.03, 0.05), sr, t, 0.3);
  // B) sputters
  for (const t of [1.55, 1.82, 2.02, 2.28]) {
    addNorm(out, thump(sr, 110, 50, 0.02, 0.06), sr, t + rng() * 0.04, 0.7);
    addNorm(out, noise(sr, rng, 0.1, { bp: [420, 1.2], a: 0.001, d: 0.03 }), sr, t, 0.5);
  }
  // C) engine catches: firing pulses exciting exhaust resonances, revving then settling to idle
  const s0 = 2.35;
  const en = n - Math.floor(s0 * sr);
  const ex = new Float32Array(en);
  let fp = 0;
  for (let i = 0; i < en; i++) {
    const t = i / sr;
    const rate = t < 0.5 ? lerp(10, 44, t / 0.5) : t < 1.1 ? lerp(44, 24, (t - 0.5) / 0.6) : 24 + Math.sin(t * 3) * 0.8;
    fp += (rate * (1 + (rng() - 0.5) * 0.08)) / sr;
    if (fp >= 1) {
      fp -= 1;
      const L = Math.floor(0.002 * sr);
      for (let j = 0; j < L && i + j < en; j++) ex[i + j] += (rng() * 2 - 1) * (1 - j / L) * (0.7 + rng() * 0.3);
    }
  }
  const bank = new ModeBank(sr, [{ f: 85, d: 0.03, a: 1 }, { f: 170, d: 0.02, a: 0.7 }, { f: 340, d: 0.012, a: 0.4 }, { f: 700, d: 0.006, a: 0.25 }]);
  const rum = new Biquad().lp(sr, 250, 0.9);
  const br = new Brown(rng);
  for (let i = 0; i < en; i++) {
    const t = i / sr;
    const e = Math.min(1, t / 0.08) * (t > 1.9 ? Math.max(0, 1 - (t - 1.9) / 0.35) * 0.6 + 0.4 : 1);
    ex[i] = (bank.run(ex[i]) + rum.run(br.next()) * 0.6) * e;
  }
  addNorm(out, ex, sr, s0, 1);
  softclip(out, 2);
  return finish(out, sr, 0.95, 0.002, 0.3);
}

// ------------------------------------------------------------------ first-person / UI foley
export function reloadRemote(sr, rng) {
  const out = alloc(sr, 1.1);
  addNorm(out, metalClick(sr, rng, 1800, 0.01), sr, 0.03, 0.6);
  addNorm(out, noise(sr, rng, 0.14, { bp: [2000, 1.2], env: hann }), sr, 0.08, 0.35);
  addNorm(out, metalClick(sr, rng, 1350, 0.014), sr, 0.55, 0.9);
  addNorm(out, thump(sr, 190, 120, 0.01, 0.015), sr, 0.55, 0.4);
  addNorm(out, metalClick(sr, rng, 2300, 0.012), sr, 0.82, 0.8);
  addNorm(out, noise(sr, rng, 0.06, { bp: [3000, 1], env: hann }), sr, 0.79, 0.3);
  return finish(out, sr);
}
export function reloadStart(sr, rng) {
  const out = alloc(sr, 0.4);
  addNorm(out, metalClick(sr, rng, 2100, 0.008), sr, 0.0, 0.7);
  addNorm(out, noise(sr, rng, 0.16, { bp: [1800, 1.1], sweep: [2200, 1200], env: hann }), sr, 0.02, 0.45);
  addNorm(out, metalClick(sr, rng, 1100, 0.012), sr, 0.17, 0.4);
  return finish(out, sr);
}
export function reloadEnd(sr, rng) {
  const out = alloc(sr, 0.55);
  addNorm(out, noise(sr, rng, 0.07, { bp: [1500, 1], env: hann }), sr, 0, 0.3);
  addNorm(out, metalClick(sr, rng, 1300, 0.016), sr, 0.06, 1);
  addNorm(out, thump(sr, 220, 130, 0.01, 0.018), sr, 0.06, 0.5);
  addNorm(out, metalClick(sr, rng, 2500, 0.012), sr, 0.28, 0.9);
  addNorm(out, noise(sr, rng, 0.05, { hp: 2500, a: 0.0005, d: 0.008 }), sr, 0.28, 0.4);
  return finish(out, sr);
}
export function shellInsert(sr, rng) {
  const out = alloc(sr, 0.22);
  addNorm(out, noise(sr, rng, 0.05, { bp: [1600, 1], env: hann }), sr, 0, 0.3);
  addNorm(out, metalClick(sr, rng, rrange(rng, 1700, 2000), 0.012), sr, 0.035, 0.9);
  addNorm(out, thump(sr, 260, 150, 0.008, 0.015), sr, 0.035, 0.5);
  return finish(out, sr);
}
export function boltCycle(sr, rng) {
  const out = alloc(sr, 0.7);
  addNorm(out, metalClick(sr, rng, 2600, 0.009), sr, 0, 0.6);
  addNorm(out, noise(sr, rng, 0.09, { bp: [1800, 1.2], sweep: [2400, 1500], env: hann }), sr, 0.08, 0.45);
  addNorm(out, metalClick(sr, rng, 1500, 0.014), sr, 0.17, 0.9);
  addNorm(out, noise(sr, rng, 0.08, { bp: [1700, 1.2], sweep: [1500, 2300], env: hann }), sr, 0.28, 0.45);
  addNorm(out, metalClick(sr, rng, 1750, 0.014), sr, 0.37, 0.9);
  addNorm(out, metalClick(sr, rng, 2400, 0.01), sr, 0.48, 0.7);
  return finish(out, sr);
}
export function pump(sr, rng) {
  const out = alloc(sr, 0.5);
  addNorm(out, noise(sr, rng, 0.08, { bp: [1300, 1], env: hann }), sr, 0, 0.5);
  addNorm(out, metalClick(sr, rng, 1100, 0.018), sr, 0.07, 1);
  addNorm(out, thump(sr, 170, 100, 0.01, 0.025), sr, 0.07, 0.6);
  addNorm(out, noise(sr, rng, 0.07, { bp: [1500, 1], env: hann }), sr, 0.17, 0.5);
  addNorm(out, metalClick(sr, rng, 1350, 0.016), sr, 0.24, 1);
  addNorm(out, thump(sr, 190, 110, 0.01, 0.02), sr, 0.24, 0.6);
  return finish(out, sr);
}
export function dryClick(sr, rng) {
  const out = alloc(sr, 0.12);
  addNorm(out, metalClick(sr, rng, rrange(rng, 3000, 3400), 0.007), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.01, { hp: 3000, a: 0.0002, d: 0.002 }), sr, 0, 0.4);
  return finish(out, sr);
}
export function weaponSwitch(sr, rng) {
  const out = alloc(sr, 0.36);
  addNorm(out, rustle(sr, rng, 0.14, 2000), sr, 0, 0.6);
  addNorm(out, metalClick(sr, rng, 2000, 0.012), sr, 0.1, 0.8);
  addNorm(out, metalClick(sr, rng, 1600, 0.014), sr, 0.17, 0.7);
  return finish(out, sr);
}
export function swing(sr, rng, heavy) {
  const out = alloc(sr, heavy ? 0.42 : 0.28);
  if (heavy) {
    addNorm(out, whoosh(sr, rng, 0.38, 250, rrange(rng, 800, 1000), 320, 1.3, 0.45), sr, 0, 1);
    addNorm(out, noise(sr, rng, 0.3, { lp: 300, env: hann }), sr, 0.02, 0.4);
  } else {
    addNorm(out, whoosh(sr, rng, 0.24, 500, rrange(rng, 1500, 1900), 700, 1.8, 0.4), sr, 0, 1);
  }
  return finish(out, sr);
}
export function throwSnd(sr, rng) {
  const out = alloc(sr, 0.35);
  addNorm(out, whoosh(sr, rng, 0.26, 700, 2000, 900, 1.5, 0.35), sr, 0.02, 1);
  addNorm(out, rustle(sr, rng, 0.1, 2200), sr, 0, 0.35);
  return finish(out, sr);
}
export function leapSnd(sr, rng) {
  const out = alloc(sr, 0.6);
  addNorm(out, whoosh(sr, rng, 0.5, 250, 1200, 400, 1.3, 0.4), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.4, { lp: 250, env: hann }), sr, 0.03, 0.5);
  return finish(out, sr);
}
export function pickupSnd(sr, rng) {
  const out = alloc(sr, 0.3);
  addNorm(out, rustle(sr, rng, 0.12, 2600), sr, 0, 0.7);
  addNorm(out, metalClick(sr, rng, rrange(rng, 2600, 3200), 0.01), sr, 0.06, 0.35);
  addNorm(out, thump(sr, 200, 140, 0.01, 0.02), sr, 0.05, 0.3);
  return finish(out, sr);
}
export function craftSnd(sr, rng) {
  const out = alloc(sr, 1.2);
  for (let k = 0; k < 3; k++) addNorm(out, rustle(sr, rng, rrange(rng, 0.1, 0.16), rrange(rng, 1800, 2800)), sr, k * 0.24, 0.55);
  addNorm(out, metalClick(sr, rng, 2200, 0.02), sr, 0.15, 0.4);
  addNorm(out, metalClick(sr, rng, 3100, 0.02), sr, 0.44, 0.35);
  const rip = noise(sr, rng, 0.32, { hp: 1500, env: (u) => Math.min(1, u * 10) * (1 - u) });
  const w = new Wander(rng, sr, 90);
  for (let i = 0; i < rip.length; i++) rip[i] *= 0.4 + 0.6 * Math.abs(w.next());
  addNorm(out, rip, sr, 0.72, 0.6);
  return finish(out, sr);
}
export function bandageSnd(sr, rng) {
  const out = alloc(sr, 1.4);
  for (let k = 0; k < 4; k++) addNorm(out, rustle(sr, rng, 0.2, 1600 + k * 350), sr, k * 0.24, 0.6);
  const rip = noise(sr, rng, 0.25, { hp: 1800, env: (u) => Math.min(1, u * 10) * (1 - u) });
  const w = new Wander(rng, sr, 110);
  for (let i = 0; i < rip.length; i++) rip[i] *= 0.3 + 0.7 * Math.abs(w.next());
  addNorm(out, rip, sr, 1.05, 0.5);
  return finish(out, sr);
}
export function healChime(sr, rng) {
  const out = alloc(sr, 1.3);
  const freqs = [293.66, 440, 587.33, 739.99];
  for (let k = 0; k < freqs.length; k++) {
    const c = new Float32Array(Math.floor(1.2 * sr));
    const f = freqs[k];
    for (let i = 0; i < c.length; i++) {
      const u = i / c.length;
      c[i] = (Math.sin((TAU * f * i) / sr) + 0.2 * Math.sin((TAU * f * 2 * i) / sr)) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.3)), 2) * (1 - u);
    }
    addNorm(out, c, sr, k * 0.05, 0.4 - k * 0.06);
  }
  addNorm(out, rustle(sr, rng, 0.2, 2000), sr, 0, 0.25);
  return finish(out, sr, 0.8);
}
export function hitmarker(sr, rng) {
  const out = alloc(sr, 0.06);
  addNorm(out, modal(sr, rng, [{ f: 2900, d: 0.012 }, { f: 4400, d: 0.008, a: 0.6 }], 0.06, 0.2), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.005, { hp: 5000, a: 0.0001, d: 0.001 }), sr, 0, 0.5);
  return finish(out, sr, 0.9, 0.0001, 0.005);
}
export function headshotDing(sr, rng) {
  const out = alloc(sr, 0.7);
  addNorm(out, crackles(sr, rng, 0.035, 700, { hp: 1800, bp: 3200, pow: 1.3 }), sr, 0, 0.8);
  addNorm(out, thump(sr, 150, 60, 0.015, 0.035), sr, 0, 0.6);
  addNorm(out, modal(sr, rng, [{ f: 1480, d: 0.32 }, { f: 2960 * 1.01, d: 0.18, a: 0.5 }, { f: 4480, d: 0.1, a: 0.3 }, { f: 6100, d: 0.05, a: 0.2 }], 0.65, 0.3), sr, 0.012, 0.75);
  return finish(out, sr);
}
export function killConfirm(sr, rng) {
  const out = alloc(sr, 0.35);
  addNorm(out, thump(sr, 180, 110, 0.03, 0.05), sr, 0, 0.7);
  const c = new Float32Array(Math.floor(0.3 * sr));
  for (let i = 0; i < c.length; i++) {
    const t = i / sr;
    c[i] = (Math.sin(TAU * 660 * t) + 0.6 * Math.sin(TAU * 990 * t)) * Math.exp(-t / 0.07) * Math.min(1, t / 0.004);
  }
  addNorm(out, c, sr, 0.015, 0.45);
  return finish(out, sr);
}
export function uiClick(sr, rng) {
  const out = alloc(sr, 0.05);
  const c = new Float32Array(Math.floor(0.04 * sr));
  let ph = 0;
  for (let i = 0; i < c.length; i++) {
    const t = i / sr;
    ph += (1200 + 700 * Math.exp(-t / 0.004)) / sr;
    c[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.008);
  }
  addNorm(out, c, sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.004, { hp: 3000, a: 0.0001, d: 0.001 }), sr, 0, 0.4);
  return finish(out, sr, 0.9, 0.0001, 0.005);
}
export function uiHover(sr) {
  const out = alloc(sr, 0.03);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = Math.sin(TAU * 2400 * t) * Math.exp(-t / 0.005) * Math.min(1, t / 0.001);
  }
  return finish(out, sr, 0.9, 0.0005, 0.005);
}
export function heartbeat(sr, rng) {
  const out = alloc(sr, 0.65);
  addNorm(out, thump(sr, 62, 42, 0.04, 0.07), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.08, { lp: 160, env: hann }), sr, 0, 0.4);
  addNorm(out, thump(sr, 56, 40, 0.04, 0.06), sr, 0.27, 0.72);
  addNorm(out, noise(sr, rng, 0.07, { lp: 150, env: hann }), sr, 0.27, 0.3);
  return finish(out, sr);
}
export function jumpSnd(sr, rng) {
  const out = alloc(sr, 0.32);
  addNorm(out, rustle(sr, rng, 0.12, 2200), sr, 0, 0.6);
  const ex = voice(sr, rng, { dur: 0.18, pitch: [[0, 130], [1, 110]], vowels: [[0, 'uh'], [1, 'a']], voiced: 0.15, breath: 1, drive: 1.2, hp: 300, env: [[0, 0], [0.2, 1], [1, 0]] });
  addNorm(out, ex, sr, 0.03, 0.45);
  return finish(out, sr);
}
export function landSnd(sr, rng) {
  const out = alloc(sr, 0.32);
  addNorm(out, thump(sr, 95, 48, 0.02, 0.05), sr, 0, 1);
  addNorm(out, noise(sr, rng, 0.12, { lp: 700, a: 0.001, d: 0.03 }), sr, 0, 0.7);
  addNorm(out, crackles(sr, rng, 0.08, 150, { hp: 2000, bp: 3500 }), sr, 0.004, 0.25);
  for (let k = 0; k < 2; k++) addNorm(out, metalClick(sr, rng, rrange(rng, 1800, 2600), 0.01), sr, 0.03 + k * 0.05, 0.12);
  return finish(out, sr);
}
export function flashlightClick(sr, rng) {
  const out = alloc(sr, 0.1);
  addNorm(out, modal(sr, rng, [{ f: 3400, d: 0.004 }, { f: 5200, d: 0.003, a: 0.6 }, { f: 1500, d: 0.006, a: 0.5 }], 0.03, 0.2), sr, 0, 1);
  addNorm(out, modal(sr, rng, [{ f: 2800, d: 0.004 }, { f: 4600, d: 0.003, a: 0.6 }, { f: 1300, d: 0.006, a: 0.5 }], 0.03, 0.2), sr, 0.035, 0.7);
  return finish(out, sr, 0.9, 0.0001, 0.005);
}
export function clawSnd(sr, rng) {
  const out = alloc(sr, 0.45);
  addNorm(out, whoosh(sr, rng, 0.14, 800, 2600, 1200, 1.6, 0.6), sr, 0, 0.8);
  const tear = noise(sr, rng, 0.12, { hp: 1500, a: 0.001, d: 0.04 });
  const w = new Wander(rng, sr, 160);
  for (let i = 0; i < tear.length; i++) tear[i] *= 0.3 + 0.7 * Math.abs(w.next());
  addNorm(out, tear, sr, 0.09, 0.8);
  addNorm(out, zPain(sr, rng, 1), sr, 0.02, 0.3);
  return finish(out, sr);
}
export function notifySnd(sr, rng) {
  const out = alloc(sr, 0.6);
  addNorm(out, whoosh(sr, rng, 0.5, 350, 1700, 1300, 1.2, 0.7), sr, 0, 0.8);
  const c = new Float32Array(Math.floor(0.4 * sr));
  for (let i = 0; i < c.length; i++) c[i] = Math.sin((TAU * 587.33 * i) / sr) * hann(i / c.length) * 0.5;
  addNorm(out, c, sr, 0.15, 0.2);
  return finish(out, sr, 0.8);
}
export function chatBlip(sr) {
  const out = alloc(sr, 0.06);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    ph += (1250 + 250 * Math.min(1, t / 0.03)) / sr;
    out[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.018) * Math.min(1, t / 0.002);
  }
  return finish(out, sr, 0.9, 0.001, 0.01);
}
export function installPart(sr, rng) {
  const out = alloc(sr, 1.0);
  for (let k = 0; k < 6; k++) addNorm(out, metalClick(sr, rng, 2200 + (k % 2) * 200, 0.01), sr, k * 0.062, 0.45);
  addNorm(out, metalHit(sr, rng, 160), sr, 0.45, 0.8);
  return finish(out, sr);
}
export function eatSnd(sr, rng) {
  const out = alloc(sr, 1.15);
  for (let k = 0; k < 3; k++) {
    const t = k * 0.34 + rng() * 0.04;
    addNorm(out, crackles(sr, rng, 0.08, 220, { hp: 1500, bp: 2500, pow: 1.5 }), sr, t, 0.7);
    addNorm(out, noise(sr, rng, 0.08, { bp: [800, 2], env: hann }), sr, t + 0.02, 0.4);
    addNorm(out, thump(sr, 120, 80, 0.01, 0.02), sr, t, 0.3);
  }
  return finish(out, sr);
}
export function buildFail(sr, rng) {
  const out = alloc(sr, 0.45);
  addNorm(out, woodHit(sr, rng, 0.7), sr, 0, 0.6);
  const c = new Float32Array(Math.floor(0.3 * sr));
  const lp = new Biquad().lp(sr, 700, 0.9);
  let ph = 0;
  for (let i = 0; i < c.length; i++) {
    ph += 98 / sr;
    c[i] = lp.run((ph % 1) < 0.5 ? 1 : -1) * Math.min(1, i / (0.01 * sr)) * (1 - i / c.length);
  }
  addNorm(out, c, sr, 0.03, 0.5);
  return finish(out, sr);
}
export function playerDeathLocal(sr, rng) {
  const out = alloc(sr, 2.2);
  addNorm(out, humanDeath(sr, rng), sr, 0, 0.85);
  addNorm(out, thump(sr, 80, 40, 0.03, 0.09), sr, 1.1, 0.7);
  addNorm(out, noise(sr, rng, 0.2, { lp: 600, a: 0.002, d: 0.05 }), sr, 1.1, 0.5);
  return finish(out, sr);
}

// ------------------------------------------------------------------ footsteps
export function footstep(sr, rng, surface) {
  const out = alloc(sr, 0.36);
  switch (surface) {
    case 'wood':
      addNorm(out, modal(sr, rng, woodModes(rng, rrange(rng, 0.75, 0.9), 1.3), 0.3, 2, 1800), sr, 0, 0.9);
      addNorm(out, thump(sr, 100, 60, 0.015, 0.03), sr, 0, 0.5);
      if (rng() < 0.35) addNorm(out, creak(sr, rng, 0.14, 40, 90, 1.3), sr, 0.03, 0.15);
      break;
    case 'grass':
      addNorm(out, thump(sr, 90, 55, 0.015, 0.025), sr, 0, 0.3);
      addNorm(out, noise(sr, rng, 0.16, { hp: 2200, lp: 7000, env: (u) => Math.min(1, u * 8) * (1 - u) ** 2 }), sr, 0, 0.8);
      addNorm(out, crackles(sr, rng, 0.12, 120, { hp: 2500, bp: 4200, env: (u) => 1 - u }), sr, 0.01, 0.3);
      break;
    case 'water': {
      addNorm(out, noise(sr, rng, 0.22, { bp: [800, 1.1], sweep: [600, 2600, 0.6], env: (u) => Math.min(1, u * 12) * (1 - u) ** 1.5 }), sr, 0, 0.9);
      addNorm(out, bubbles(sr, rng, 0.25, 40, 400, 1500, { env: (u) => 1 - u }), sr, 0.02, 0.5);
      addNorm(out, noise(sr, rng, 0.2, { lp: 400, env: hann }), sr, 0, 0.4);
      break;
    }
    case 'metal':
      addNorm(out, modal(sr, rng, metalModes(rng, rrange(rng, 210, 300), 0.18), 0.35, 1, 3000), sr, 0, 0.7);
      addNorm(out, thump(sr, 110, 60, 0.015, 0.03), sr, 0, 0.6);
      addNorm(out, noise(sr, rng, 0.05, { lp: 1500, a: 0.001, d: 0.01 }), sr, 0, 0.4);
      break;
    default: // dirt
      addNorm(out, thump(sr, rrange(rng, 100, 125), 58, 0.015, 0.028), sr, 0, 0.7);
      addNorm(out, noise(sr, rng, 0.12, { lp: 1100, a: 0.001, d: 0.028 }), sr, 0, 0.8);
      addNorm(out, crackles(sr, rng, 0.08, 220, { hp: 2200, bp: 3600, env: (u) => 1 - u }), sr, 0.004, 0.35);
      addNorm(out, noise(sr, rng, 0.06, { lp: 900, a: 0.004, d: 0.015 }), sr, rrange(rng, 0.035, 0.06), 0.35);
  }
  return finish(out, sr, 0.9, 0.0005, 0.03);
}

// ------------------------------------------------------------------ seamless loops
function finishLoop(x, sr, xf, peak = 0.85) {
  for (const c of Array.isArray(x) ? x : [x]) {
    for (let i = 0; i < c.length; i++) if (c[i] !== c[i]) c[i] = 0;
    dcBlock(c, sr);
  }
  return normalize(loopify(x, sr, xf), peak);
}

// fire loops: size 0 torch, 1 campfire, 2 big molotov fire
export function loopFire(sr, rng, size = 1) {
  const L = [4, 6, 6][size];
  const X = 0.5;
  const n = Math.ceil((L + X) * sr);
  const out = new Float32Array(n);
  const br = new Brown(rng);
  const rlp = new Biquad().lp(sr, [260, 320, 480][size], 0.7);
  const am = new Wander(rng, sr, 1.1);
  const pk = new Pink(rng);
  const bp = new Biquad().bp(sr, [650, 620, 520][size], 0.6);
  const am2 = new Wander(rng, sr, 7);
  const hs = new Biquad().hp(sr, 3500, 0.7);
  const am3 = new Wander(rng, sr, 3);
  const rA = [0.35, 0.8, 1.4][size];
  const fA = [0.9, 0.55, 0.8][size];
  for (let i = 0; i < n; i++) {
    const roar = rlp.run(br.next()) * (0.7 + 0.3 * am.next());
    const fl = bp.run(pk.next()) * (0.55 + 0.45 * am2.next());
    const hiss = hs.run(rng() * 2 - 1) * 0.05 * (0.5 + 0.5 * am3.next());
    out[i] = roar * rA * 3 + fl * fA * 2.5 + hiss;
  }
  normalize(out, 0.6);
  addNorm(out, crackles(sr, rng, L + X, [6, 14, 26][size], { hp: 1400, bp: 2800, pow: 3.5, len: 0.0015 }), sr, 0, 0.9);
  addNorm(out, crackles(sr, rng, L + X, [1, 2, 4][size], { hp: 500, bp: 1300, pow: 1.5, len: 0.003 }), sr, 0, 0.6);
  return finishLoop(out, sr, X);
}
export function loopAcid(sr, rng) {
  const L = 4;
  const X = 0.4;
  const n = Math.ceil((L + X) * sr);
  const out = new Float32Array(n);
  const hp = new Biquad().hp(sr, 2800, 0.7);
  const bp = new Biquad().bp(sr, 5500, 0.7);
  const w = new Wander(rng, sr, 5);
  for (let i = 0; i < n; i++) out[i] = bp.run(hp.run(rng() * 2 - 1)) * (0.6 + 0.4 * w.next());
  normalize(out, 0.35);
  addNorm(out, crackles(sr, rng, L + X, 90, { hp: 2200, bp: 4800, pow: 2.5 }), sr, 0, 0.7);
  addNorm(out, bubbles(sr, rng, L + X, 14, 300, 900), sr, 0, 0.5);
  return finishLoop(out, sr, X);
}
export function loopZombieIdle(sr, rng) {
  const L = 5;
  const X = 0.3;
  const out = alloc(sr, L + X);
  let t = rng() * 0.2;
  while (t < L + X - 0.3) {
    const exLen = rrange(rng, 1.1, 1.6);
    const b = rrange(rng, 65, 88);
    const v = voice(sr, rng, {
      dur: exLen, pitch: [[0, b], [0.4, b * rrange(rng, 1.05, 1.25)], [1, b * 0.8]], vowels: vowelPath(rpick(rng, GROWL_V), rng),
      fscale: 0.82, bw: 1.8, jitter: 0.06, shimmer: 0.5, sub: 0.55, gurgle: 0.6, rasp: 0.5, breath: 0.7, voiced: 0.7,
      drive: 2.2, chest: 0.6, bubbles: 5, env: [[0, 0], [0.25, 1], [0.7, 0.7], [1, 0]],
    });
    addNorm(out, v, sr, t, rrange(rng, 0.6, 1));
    t += exLen + rrange(rng, 0.05, 0.2);
    const inLen = rrange(rng, 0.6, 0.9);
    const inh = voice(sr, rng, {
      dur: inLen, pitch: [[0, 90], [1, 100]], vowels: [[0, 'er'], [1, 'i']], voiced: 0.1, breath: 1.2, rasp: 0.9, raspHz: 45,
      drive: 1.5, env: [[0, 0], [0.6, 1], [1, 0]],
    });
    addNorm(out, inh, sr, t, 0.3);
    t += inLen + rrange(rng, 0.05, 0.2);
  }
  return finishLoop(out, sr, X, 0.8);
}
export function loopBossBreath(sr, rng) {
  const L = 6;
  const X = 0.4;
  const out = alloc(sr, L + X);
  const inh = voice(sr, rng, {
    dur: 2.3, pitch: [[0, 50], [1, 60]], vowels: [[0, 'o'], [1, 'er']], fscale: 0.55, voiced: 0.15, breath: 1.3, rasp: 0.9, raspHz: 35,
    drive: 2, bw: 2, env: [[0, 0], [0.7, 1], [1, 0]],
  });
  addNorm(out, inh, sr, 0.1, 0.5);
  const ex = voice(sr, rng, {
    dur: 3.3, pitch: [[0, 42], [0.3, 46], [1, 34]], vowels: [[0, 'a'], [0.5, 'o'], [1, 'u']], fscale: 0.5, voiced: 0.8, breath: 0.8,
    sub: 0.6, gurgle: 0.6, gurgleHz: 11, rasp: 0.8, raspHz: 60, drive: 4, bw: 2.2, chest: 1.3, bubbles: 6,
    env: [[0, 0], [0.12, 1], [0.6, 0.7], [1, 0]],
  });
  addNorm(out, ex, sr, 2.5, 1);
  addNorm(out, thump(sr, 45, 30, 0.5, 1.2, 3), sr, 2.5, 0.3);
  return finishLoop(out, sr, X, 0.85);
}
export function loopGenerator(sr, rng) {
  const L = 2;
  const X = 0.2;
  const n = Math.ceil((L + X) * sr);
  const ex = new Float32Array(n);
  let fp = 0;
  for (let i = 0; i < n; i++) {
    fp += (30 * (1 + (rng() - 0.5) * 0.04)) / sr;
    if (fp >= 1) {
      fp -= 1;
      const Ls = Math.floor(0.0015 * sr);
      for (let j = 0; j < Ls && i + j < n; j++) ex[i + j] += (rng() * 2 - 1) * (1 - j / Ls);
    }
  }
  const bank = new ModeBank(sr, [{ f: 95, d: 0.025 }, { f: 190, d: 0.015, a: 0.6 }, { f: 420, d: 0.008, a: 0.4 }, { f: 1300, d: 0.004, a: 0.3 }]);
  const hum = new Float32Array(n);
  const rat = new Biquad().bp(sr, 2400, 1.5);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    hum[i] = bank.run(ex[i]) + 0.15 * Math.sin(TAU * 60 * t) + 0.08 * Math.sin(TAU * 120 * t) + rat.run(rng() * 2 - 1) * 0.08 * (0.5 + 0.5 * Math.sin(TAU * 30 * t));
  }
  softclip(hum, 1.4);
  return finishLoop(hum, sr, X, 0.8);
}

// ------------------------------------------------------------------ 2D event sounds
export function plane(sr, rng) {
  const dur = 9;
  const n = Math.floor(dur * sr);
  const mono = new Float32Array(n);
  const tc = 4.4;
  const lp = new Biquad();
  const bp = new Biquad().bp(sr, 500, 0.7);
  const pk = new Pink(rng);
  const wl = new Biquad().lp(sr, 900, 0.7);
  let ph = 0;
  const amp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const dop = 1 - 0.075 * Math.tanh((t - tc) / 1.2);
    const a = 1 / (1 + ((t - tc) / 1.9) ** 2);
    amp[i] = a;
    if ((i & 31) === 0) lp.lp(sr, 500 + 2600 * a * a, 0.8);
    const fe = 58 * dop;
    ph += fe / sr;
    const p = ph % 1;
    const src = (p < 0.14 ? 1 : -0.16) + 0.4 * (2 * p - 1);
    const prop = 0.72 + 0.28 * Math.sin(TAU * 21 * dop * t);
    mono[i] = (lp.run(src) * 1.2 + bp.run(src) * 0.4) * prop * a + wl.run(pk.next()) * a * 0.9;
  }
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const p = Math.tanh((t - tc) / 2.2);
    L[i] = mono[i] * Math.sqrt((1 - p) / 2);
    R[i] = mono[i] * Math.sqrt((1 + p) / 2);
  }
  return finish([L, R], sr, 0.9, 0.5, 0.8);
}
export function hordeHorn(sr, rng) {
  const dur = 7.5;
  const n = Math.floor(dur * sr);
  const mono = new Float32Array(n);
  const lp = new Biquad().lp(sr, 420, 2);
  const lp2 = new Biquad().lp(sr, 700, 0.7);
  const sbp = new Biquad().bp(sr, 700, 0.8);
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let ps = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const he = Math.min(1, t / 1.3) * (t > 5 ? Math.max(0, 1 - (t - 5) / 2.2) : 1);
    p1 += 62 / sr;
    p2 += 93.3 / sr;
    p3 += 124.6 / sr;
    const horn = lp2.run(lp.run((2 * (p1 % 1) - 1) + 0.8 * (2 * (p2 % 1) - 1) + 0.5 * (2 * (p3 % 1) - 1))) * he;
    const sf = t < 0.5 ? 170 : t < 3 ? lerp(170, 430, smoothU((t - 0.5) / 2.5)) : lerp(430, 150, smoothU((t - 3) / 3.6));
    ps += (sf * (1 + 0.01 * Math.sin(TAU * 0.9 * t))) / sr;
    const s = Math.sin(TAU * ps) + 0.3 * Math.sin(3 * TAU * ps);
    const se = Math.min(1, Math.max(0, t - 0.4) / 1.2) * (t > 5.6 ? Math.max(0, 1 - (t - 5.6) / 1.4) : 1);
    mono[i] = horn * 1.1 + sbp.run(s) * se * 0.8;
  }
  normalize(mono, 0.8);
  const out = [];
  const echoes = [[[0.37, 0.45], [0.93, 0.25], [1.6, 0.12]], [[0.52, 0.4], [1.21, 0.2], [1.9, 0.1]]];
  for (let ch = 0; ch < 2; ch++) {
    const c = Float32Array.from(mono);
    for (const [et, g] of echoes[ch]) {
      const d = Math.floor(et * sr);
      const e = new OnePole().lp(sr, 1100);
      for (let i = 0; i + d < n; i++) c[i + d] += e.run(mono[i]) * g;
    }
    const f = new OnePole().lp(sr, 1700);
    for (let i = 0; i < n; i++) c[i] = f.run(c[i]);
    out.push(c);
  }
  return finish(out, sr, 0.9, 0.05, 0.5);
}
function smoothU(u) {
  u = clamp(u, 0, 1);
  return u * u * (3 - 2 * u);
}

// songbird phrase
export function birdPhrase(sr, rng, kind = 0) {
  const out = alloc(sr, 1.8);
  let t = 0.02;
  const notes = kind === 2 ? 1 : 3 + Math.floor(rng() * 5);
  for (let k = 0; k < notes && t < 1.5; k++) {
    const len = kind === 2 ? rrange(rng, 0.5, 0.8) : rrange(rng, 0.04, 0.13);
    const c = new Float32Array(Math.floor(len * sr));
    const f0 = rrange(rng, 2600, 5000);
    const f1 = kind === 2 ? f0 * 0.6 : f0 * rrange(rng, 0.7, 1.4);
    const trill = kind === 1 && rng() < 0.6;
    let ph = 0;
    for (let i = 0; i < c.length; i++) {
      const u = i / c.length;
      const f = lerp(f0, f1, u) * (1 + (trill ? 0.08 * Math.sin((TAU * 32 * i) / sr) : 0.01 * Math.sin((TAU * 9 * i) / sr)));
      ph += f / sr;
      c[i] = Math.sin(TAU * ph) * Math.pow(hann(u), 0.7);
    }
    addNorm(out, c, sr, t, rrange(rng, 0.5, 1));
    t += len + rrange(rng, 0.02, 0.12);
  }
  return finish(out, sr, 0.85);
}
export function rooster(sr, rng) {
  const syl = [[0, 0.12, 520, 560, 0.7], [0.16, 0.12, 600, 640, 0.8], [0.32, 0.16, 700, 760, 0.9], [0.52, 0.75, 790, 560, 1]];
  const out = alloc(sr, 1.4);
  for (const [s, d, f0, f1, a] of syl) {
    const c = new Float32Array(Math.floor(d * sr));
    const b1 = new Biquad().bp(sr, 1150, 3);
    const b2 = new Biquad().bp(sr, 2300, 4);
    const w = new Wander(rng, sr, 90);
    let ph = 0;
    for (let i = 0; i < c.length; i++) {
      const u = i / c.length;
      const f = d > 0.5 ? (u < 0.4 ? lerp(f0 * 0.95, f0, u / 0.4) : lerp(f0, f1, (u - 0.4) / 0.6)) : lerp(f0, f1, u);
      ph += (f * (1 + 0.02 * Math.sin((TAU * 7 * i) / sr))) / sr;
      const src = (2 * (ph % 1) - 1) * (1 + 0.5 * w.next());
      c[i] = (b1.run(src) + b2.run(src) * 0.6) * Math.min(1, u * 12) * Math.min(1, (1 - u) * 6);
    }
    addNorm(out, c, sr, s, a);
  }
  return out;
}
export function dawnSfx(sr, rng) {
  const dur = 6.5;
  const n = Math.floor(dur * sr);
  const outs = [new Float32Array(n), new Float32Array(n)];
  const r = rooster(sr, rng);
  const lp = new OnePole().lp(sr, 2400);
  for (let i = 0; i < r.length; i++) r[i] = lp.run(r[i]);
  for (let ch = 0; ch < 2; ch++) {
    addNorm(outs[ch], r, sr, 0.3 + ch * 0.012, ch ? 0.45 : 0.55);
    addNorm(outs[ch], r, sr, 0.3 + 0.55 + ch * 0.1, 0.12); // echo
  }
  for (let k = 0; k < 22; k++) {
    const t = 1.2 + Math.pow(rng(), 0.7) * 4.8;
    const b = birdPhrase(sr, rng, k % 3);
    const pan = rng();
    const a = rrange(rng, 0.2, 0.5);
    addNorm(outs[0], b, sr, t, a * Math.sqrt(1 - pan));
    addNorm(outs[1], b, sr, t, a * Math.sqrt(pan));
  }
  return finish(outs, sr, 0.8, 0.1, 0.8);
}

// ------------------------------------------------------------------ registry
// Each def: { bank, n (variants), sr, group: 'core' | 'late', gen(sr, rng, i) }
const G = GUNS;
export const SFX_DEFS = [
  // remote (mono, positional) gunshots
  { bank: 'gun_pistol', n: 3, sr: HI, gen: (sr, r) => gunshot(sr, r, G.pistol, false) },
  { bank: 'gun_ak47', n: 3, sr: HI, gen: (sr, r) => gunshot(sr, r, G.ak47, false) },
  { bank: 'gun_shotgun', n: 2, sr: HI, gen: (sr, r) => gunshot(sr, r, G.shotgun, false) },
  { bank: 'gun_rifle', n: 2, sr: HI, gen: (sr, r) => gunshot(sr, r, G.rifle, false) },
  { bank: 'gun_m4a1', n: 3, sr: HI, gen: (sr, r) => gunshot(sr, r, G.m4a1, false) },
  { bank: 'gun_mp5', n: 3, sr: HI, gen: (sr, r) => gunshot(sr, r, G.mp5, false) },
  { bank: 'gun_dbshotgun', n: 2, sr: HI, gen: (sr, r) => gunshot(sr, r, G.dbshotgun, false) },
  // first-person (stereo)
  { bank: 'fp_pistol', n: 3, sr: HI, gen: (sr, r) => gunshot(sr, r, G.pistol, true) },
  { bank: 'fp_ak47', n: 4, sr: HI, gen: (sr, r) => gunshot(sr, r, G.ak47, true) },
  { bank: 'fp_shotgun', n: 2, sr: HI, gen: (sr, r) => gunshot(sr, r, G.shotgun, true) },
  { bank: 'fp_rifle', n: 2, sr: HI, gen: (sr, r) => gunshot(sr, r, G.rifle, true) },
  { bank: 'fp_m4a1', n: 4, sr: HI, gen: (sr, r) => gunshot(sr, r, G.m4a1, true) },
  { bank: 'fp_mp5', n: 4, sr: HI, gen: (sr, r) => gunshot(sr, r, G.mp5, true) },
  { bank: 'fp_dbshotgun', n: 2, sr: HI, gen: (sr, r) => gunshot(sr, r, G.dbshotgun, true) },
  // zombies
  { bank: 'z_growl', n: 6, sr: MID, gen: zGrowl },
  { bank: 'z_attack', n: 3, sr: MID, gen: zAttack },
  { bank: 'z_death', n: 3, sr: MID, gen: zDeath },
  { bank: 'z_pain', n: 3, sr: MID, gen: zPain },
  { bank: 'z_runner', n: 2, sr: MID, gen: zRunner },
  { bank: 'z_tank', n: 2, sr: MID, gen: zTank },
  { bank: 'z_spit', n: 2, sr: MID, gen: zSpit },
  { bank: 'z_leaper', n: 2, sr: MID, gen: zLeaper },
  { bank: 'z_roper', n: 2, sr: MID, gen: zRoper },
  { bank: 'z_boomer', n: 2, sr: MID, gen: zBoomer },
  { bank: 'z_bat', n: 2, sr: HI, gen: zBat },
  { bank: 'z_boss', n: 2, sr: MID, gen: zBoss },
  { bank: 'z_shade_whisper', n: 3, sr: MID, gen: shadeWhisper },
  { bank: 'z_shade_freeze', n: 2, sr: HI, gen: shadeFreeze },
  { bank: 'z_shade_shriek', n: 2, sr: MID, gen: shadeShriek },
  { bank: 'zp_growl', n: 3, sr: MID, gen: zpGrowl },
  { bank: 'cat_meow', n: 3, sr: HI, gen: catMeow },
  // players
  { bank: 'hurt', n: 4, sr: MID, gen: humanHurt },
  { bank: 'pdeath', n: 1, sr: MID, gen: humanDeath },
  { bank: 'death_local', n: 1, sr: MID, gen: playerDeathLocal },
  { bank: 'breath', n: 1, sr: MID, gen: breath },
  // impacts
  { bank: 'flesh', n: 4, sr: HI, gen: (sr, r) => fleshHit(sr, r, 0) },
  { bank: 'flesh_heavy', n: 3, sr: HI, gen: (sr, r) => fleshHit(sr, r, 0.7) },
  { bank: 'headshot_w', n: 2, sr: HI, gen: headshotWet },
  { bank: 'wood_hit', n: 3, sr: HI, gen: (sr, r) => woodHit(sr, r, 1) },
  { bank: 'wood_break', n: 2, sr: HI, gen: woodBreak },
  { bank: 'metal_hit', n: 3, sr: HI, gen: (sr, r) => metalHit(sr, r) },
  { bank: 'glass', n: 2, sr: HI, gen: glassBreak },
  { bank: 'build', n: 2, sr: HI, gen: hammerBuild },
  { bank: 'explosion', n: 2, sr: MID, gen: explosion },
  { bank: 'slam', n: 1, sr: MID, gen: slam },
  // world
  { bank: 'acid', n: 1, sr: HI, gen: acidSizzle },
  { bank: 'fire_whoosh', n: 1, sr: HI, gen: fireWhoosh },
  { bank: 'campfire_add', n: 1, sr: HI, gen: campfireAdd },
  { bank: 'crate', n: 1, sr: MID, gen: crateLand },
  { bank: 'car_part', n: 1, sr: HI, gen: carPart },
  { bank: 'car_start', n: 1, sr: MID, gen: carStart },
  // foley
  { bank: 'reload', n: 1, sr: HI, gen: reloadRemote },
  { bank: 'reload_start', n: 1, sr: HI, gen: reloadStart },
  { bank: 'reload_end', n: 1, sr: HI, gen: reloadEnd },
  { bank: 'shell_insert', n: 2, sr: HI, gen: shellInsert },
  { bank: 'bolt', n: 1, sr: HI, gen: boltCycle },
  { bank: 'pump', n: 1, sr: HI, gen: pump },
  { bank: 'dry', n: 1, sr: HI, gen: dryClick },
  { bank: 'switch', n: 2, sr: HI, gen: weaponSwitch },
  { bank: 'swing', n: 3, sr: HI, gen: (sr, r) => swing(sr, r, false) },
  { bank: 'swing_heavy', n: 2, sr: HI, gen: (sr, r) => swing(sr, r, true) },
  { bank: 'throw', n: 1, sr: HI, gen: throwSnd },
  { bank: 'leap', n: 1, sr: MID, gen: leapSnd },
  { bank: 'pickup', n: 2, sr: HI, gen: pickupSnd },
  { bank: 'craft', n: 1, sr: HI, gen: craftSnd },
  { bank: 'bandage', n: 1, sr: HI, gen: bandageSnd },
  { bank: 'heal', n: 1, sr: HI, gen: healChime },
  { bank: 'hitmarker', n: 1, sr: HI, gen: hitmarker },
  { bank: 'headshot_ding', n: 1, sr: HI, gen: headshotDing },
  { bank: 'kill', n: 1, sr: HI, gen: killConfirm },
  { bank: 'ui_click', n: 1, sr: HI, gen: uiClick },
  { bank: 'ui_hover', n: 1, sr: HI, gen: uiHover },
  { bank: 'heartbeat', n: 1, sr: LO, gen: heartbeat },
  { bank: 'jump', n: 1, sr: HI, gen: jumpSnd },
  { bank: 'land', n: 2, sr: HI, gen: landSnd },
  { bank: 'flashlight', n: 1, sr: HI, gen: flashlightClick },
  { bank: 'claw', n: 2, sr: MID, gen: clawSnd },
  { bank: 'notify', n: 1, sr: HI, gen: notifySnd },
  { bank: 'chat', n: 1, sr: HI, gen: chatBlip },
  { bank: 'install_part', n: 1, sr: HI, gen: installPart },
  { bank: 'eat', n: 1, sr: HI, gen: eatSnd },
  { bank: 'build_fail', n: 1, sr: HI, gen: buildFail },
  // footsteps
  { bank: 'step_dirt', n: 5, sr: MID, gen: (sr, r) => footstep(sr, r, 'dirt') },
  { bank: 'step_grass', n: 4, sr: MID, gen: (sr, r) => footstep(sr, r, 'grass') },
  { bank: 'step_wood', n: 4, sr: MID, gen: (sr, r) => footstep(sr, r, 'wood') },
  { bank: 'step_water', n: 4, sr: MID, gen: (sr, r) => footstep(sr, r, 'water') },
  { bank: 'step_metal', n: 4, sr: MID, gen: (sr, r) => footstep(sr, r, 'metal') },
  // loops
  { bank: 'loop_campfire', n: 1, sr: MID, gen: (sr, r) => loopFire(sr, r, 1) },
  { bank: 'loop_torch', n: 1, sr: MID, gen: (sr, r) => loopFire(sr, r, 0) },
  { bank: 'loop_fire', n: 1, sr: MID, gen: (sr, r) => loopFire(sr, r, 2) },
  { bank: 'loop_acid', n: 1, sr: MID, gen: loopAcid },
  { bank: 'loop_zombie_idle', n: 3, sr: LO, gen: loopZombieIdle },
  { bank: 'loop_boss_breath', n: 1, sr: LO, gen: loopBossBreath },
  { bank: 'loop_generator', n: 1, sr: LO, gen: loopGenerator },
  // 2D events (rendered after init; rendered on demand if requested earlier)
  { bank: 'plane', n: 1, sr: LO, group: 'late', gen: plane },
  { bank: 'horde_horn', n: 1, sr: LO, group: 'late', gen: hordeHorn },
  { bank: 'dawn', n: 1, sr: MID, group: 'late', gen: dawnSfx },
];
