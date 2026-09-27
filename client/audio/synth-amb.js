// Pure generators for ambience beds, ambient one-shots, music instruments and cinematic stingers.
import {
  TAU, clamp, lerp, rrange, Biquad, OnePole, Pink, Brown, Wander, Curve, polyblep, hann, alloc, normalize,
  finish, softclip, mixInto, loopify, dcBlock, reverse, widen, semis,
} from './dsp.js';
import {
  HI, MID, LO, addNorm, thump, noise, modal, metalModes, woodModes, creak, crackles, voice, birdPhrase, metalHit,
} from './synth.js';

// ------------------------------------------------------------------ helpers
function finishLoop(x, sr, xf, peak = 0.85) {
  for (const c of Array.isArray(x) ? x : [x]) {
    for (let i = 0; i < c.length; i++) if (c[i] !== c[i]) c[i] = 0;
    dcBlock(c, sr);
  }
  return normalize(loopify(x, sr, xf), peak);
}

// far-away treatment: low-pass + a couple of smeared echoes, returned in place
function distant(c, sr, lpHz = 2000, echoes = [[0.38, 0.3], [0.85, 0.15]]) {
  const lp = new Biquad().lp(sr, lpHz, 0.6);
  for (let i = 0; i < c.length; i++) c[i] = lp.run(c[i]);
  const dry = Float32Array.from(c);
  for (const [t, g] of echoes) {
    const d = Math.floor(t * sr);
    const e = new OnePole().lp(sr, lpHz * 0.6);
    for (let i = 0; i + d < c.length; i++) c[i + d] += e.run(dry[i]) * g;
  }
  return c;
}

// detuned saw pad with a time-varying low-pass. freqs: Hz list. lp: [[u, hz]]
export function padChord(sr, rng, freqs, dur, o = {}) {
  const n = Math.floor(dur * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const det = o.detune ?? 8;
  const voices = [];
  freqs.forEach((f, j) => {
    for (let v = 0; v < 2; v++) {
      const cents = (v ? 1 : -1) * det * rrange(rng, 0.6, 1.2);
      const pan = clamp(0.5 + (j % 2 ? 0.3 : -0.3) * rrange(rng, 0.3, 1) + (v ? 0.1 : -0.1), 0, 1);
      voices.push({ inc: (f * semis(cents / 100)) / sr, ph: rng(), gl: Math.sqrt(1 - pan), gr: Math.sqrt(pan), a: o.amps ? o.amps[j] : 1 });
    }
  });
  for (let i = 0; i < n; i++) {
    let l = 0;
    let r = 0;
    for (let k = 0; k < voices.length; k++) {
      const vo = voices[k];
      vo.ph += vo.inc;
      if (vo.ph >= 1) vo.ph -= 1;
      const s = (2 * vo.ph - 1 - polyblep(vo.ph, vo.inc)) * vo.a;
      l += s * vo.gl;
      r += s * vo.gr;
    }
    L[i] = l;
    R[i] = r;
  }
  const lpc = new Curve(o.lp ?? [[0, 900], [1, 900]]);
  const att = o.attack ?? 1;
  const rel = o.release ?? 1.5;
  const f = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 63) === 0) {
      const fc = lpc.at(i / n);
      f[0].lp(sr, fc, 0.8);
      f[1].lp(sr, fc, 0.6);
      f[2].lp(sr, fc, 0.8);
      f[3].lp(sr, fc, 0.6);
    }
    const e = Math.min(1, Math.pow(t / att, 1.5)) * (t > dur - rel ? Math.max(0, (dur - t) / rel) : 1);
    L[i] = f[1].run(f[0].run(L[i])) * e;
    R[i] = f[3].run(f[2].run(R[i])) * e;
  }
  return [L, R];
}

// ------------------------------------------------------------------ ambience beds (seamless loops)
export function bedWind(sr, rng) {
  const Ls = 10;
  const X = 1.5;
  const n = Math.ceil((Ls + X) * sr);
  const gust = new Float32Array(n);
  const g1 = new Wander(rng, sr, 0.18);
  const g2 = new Wander(rng, sr, 0.05);
  for (let i = 0; i < n; i++) gust[i] = clamp(0.55 + 0.35 * g1.next() + 0.25 * g2.next(), 0.1, 1.2);
  const outs = [];
  for (let ch = 0; ch < 2; ch++) {
    const c = new Float32Array(n);
    const pk = new Pink(rng);
    const br = new Brown(rng);
    const bp = new Biquad();
    const lpb = new Biquad().lp(sr, 170, 0.7);
    const wh = new Biquad();
    const ww = new Wander(rng, sr, 0.3);
    for (let i = 0; i < n; i++) {
      if ((i & 63) === 0) {
        bp.bp(sr, 260 + 420 * gust[i], 0.55);
        wh.bp(sr, 950 + 350 * ww.next(), 14);
      }
      c[i] = bp.run(pk.next()) * gust[i] * 1.8 + lpb.run(br.next()) * 0.7 + wh.run(rng() * 2 - 1) * Math.max(0, gust[i] - 0.65) * 2.5;
    }
    outs.push(c);
  }
  return finishLoop(outs, sr, X, 0.8);
}
export function bedPines(sr, rng) {
  const Ls = 8;
  const X = 1;
  const n = Math.ceil((Ls + X) * sr);
  const gust = new Wander(rng, sr, 0.15);
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = clamp(0.5 + 0.5 * gust.next(), 0.05, 1);
  const outs = [];
  for (let ch = 0; ch < 2; ch++) {
    const c = new Float32Array(n);
    const hp = new Biquad().hp(sr, 1900, 0.7);
    const lp = new Biquad().lp(sr, 6500, 0.7);
    const fl = new Wander(rng, sr, 11);
    for (let i = 0; i < n; i++) c[i] = lp.run(hp.run(rng() * 2 - 1)) * g[i] * g[i] * (0.7 + 0.3 * fl.next());
    outs.push(c);
  }
  return finishLoop(outs, sr, X, 0.7);
}
export function bedCrickets(sr, rng) {
  const Ls = 8;
  const X = 0.6;
  const T = Ls + X;
  const n = Math.ceil(T * sr);
  const outs = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 9; c++) {
    const f = rrange(rng, 3900, 5200);
    const pulses = 3 + Math.floor(rng() * 2);
    const plen = rrange(rng, 0.012, 0.019);
    const pgap = rrange(rng, 0.008, 0.013);
    const period = rrange(rng, 0.42, 0.95);
    const amp = c < 6 ? rrange(rng, 0.35, 1) : rrange(rng, 0.1, 0.22);
    const pan = rng();
    const gl = Math.sqrt(1 - pan);
    const gr = Math.sqrt(pan);
    let t = rng() * period;
    const pl = Math.floor(plen * sr);
    while (t < T) {
      if (rng() > 0.08) {
        for (let p = 0; p < pulses; p++) {
          const s = Math.floor((t + p * (plen + pgap)) * sr);
          for (let j = 0; j < pl && s + j < n; j++) {
            const u = j / pl;
            const tt = (s + j) / sr;
            const v = (Math.sin(TAU * f * tt) + 0.15 * Math.sin(TAU * 2 * f * tt)) * Math.pow(Math.sin(Math.PI * u), 0.6) * amp;
            outs[0][s + j] += v * gl;
            outs[1][s + j] += v * gr;
          }
        }
      }
      t += period * (1 + (rng() - 0.5) * 0.1);
    }
  }
  // continuous tree-cricket trill
  const tw = new Wander(rng, sr, 0.25);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const am = Math.max(0, Math.sin(TAU * 42 * t)) ** 2;
    const v = Math.sin(TAU * 2900 * t) * am * 0.12 * (0.6 + 0.4 * tw.next());
    outs[0][i] += v * 0.8;
    outs[1][i] += v * 0.5;
  }
  return finishLoop(outs, sr, X, 0.75);
}
export function bedDrone(sr, rng) {
  const Ls = 12;
  const X = 1.5;
  const n = Math.ceil((Ls + X) * sr);
  const outs = [];
  for (let ch = 0; ch < 2; ch++) {
    const c = new Float32Array(n);
    const br = new Brown(rng);
    const lp = new Biquad().lp(sr, 120, 0.8);
    const w = new Wander(rng, sr, 0.1);
    const pk = new Pink(rng);
    const bp = new Biquad().bp(sr, 300, 1.2);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      c[i] = lp.run(br.next()) * (0.6 + 0.4 * w.next()) * 1.5 + bp.run(pk.next()) * 0.35 * (0.5 + 0.5 * Math.sin(TAU * 0.15 * t));
    }
    outs.push(c);
  }
  const noiseLoop = loopify(outs, sr, X);
  // periodic tonal layer (frequencies are multiples of 1/Ls so it loops without a crossfade)
  const N = noiseLoop[0].length;
  const q = (f) => Math.round(f * Ls) / Ls;
  const tones = [[[q(41.2), 0.5], [q(43.7), 0.4], [q(82.4), 0.18], [q(2350), 0.012], [q(2353.4), 0.012]], [[q(41.2), 0.5], [q(43.6), 0.4], [q(87.3), 0.15], [q(1760), 0.01], [q(1763.2), 0.01]]];
  for (let ch = 0; ch < 2; ch++) {
    const c = noiseLoop[ch];
    const tone = new Float32Array(N);
    // phasor recurrence per partial (cheap sine generation); periodic over the loop length
    for (const [f, amp] of tones[ch]) {
      const w = (TAU * f) / sr;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      const p0 = rng() * TAU;
      let x = Math.cos(p0);
      let y = Math.sin(p0);
      for (let i = 0; i < N; i++) {
        tone[i] += y * amp;
        const nx = x * cw - y * sw;
        y = x * sw + y * cw;
        x = nx;
        if ((i & 4095) === 4095) {
          // renormalise to stop amplitude drift
          const m = 1 / Math.sqrt(x * x + y * y);
          x *= m;
          y *= m;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const am = 0.7 + 0.3 * Math.sin(((TAU * i) / sr / Ls) * 2 + ch);
      c[i] = c[i] * 0.35 + tone[i] * am;
    }
  }
  return normalize(noiseLoop, 0.8);
}
export function bedHorde(sr, rng) {
  const Ls = 8;
  const X = 1;
  const T = Ls + X;
  const n = Math.ceil(T * sr);
  const outs = [new Float32Array(n), new Float32Array(n)];
  for (let k = 0; k < 12; k++) {
    const dur = rrange(rng, 0.9, 2.2);
    const b = rrange(rng, 65, 120);
    const v = voice(sr, rng, {
      dur, pitch: [[0, b], [0.3, b * rrange(rng, 1.05, 1.4)], [1, b * 0.75]], vowels: [[0, 'uh'], [0.5, 'a'], [1, 'o']],
      fscale: rrange(rng, 0.75, 0.9), bw: 1.8, jitter: 0.07, shimmer: 0.4, sub: 0.5, gurgle: 0.5, rasp: 0.5, breath: 0.35, drive: 3,
      chest: 0.5, env: [[0, 0], [0.15, 1], [0.6, 0.7], [1, 0]],
    });
    const lp = new Biquad().lp(sr, rrange(rng, 900, 1500), 0.7);
    for (let i = 0; i < v.length; i++) v[i] = lp.run(v[i]);
    const t = rng() * (T - dur);
    const pan = rng();
    const a = rrange(rng, 0.3, 1);
    addNorm(outs[0], v, sr, t, a * Math.sqrt(1 - pan));
    addNorm(outs[1], v, sr, t, a * Math.sqrt(pan));
  }
  for (const c of outs) distant(c, sr, 1600, [[0.31, 0.35], [0.72, 0.2]]);
  return finishLoop(outs, sr, X, 0.8);
}

// ------------------------------------------------------------------ ambient one-shots (mono; engine positions them)
export function crow(sr, rng) {
  const caws = 2 + Math.floor(rng() * 3);
  const out = alloc(sr, caws * 0.48 + 0.5);
  const base = rrange(rng, 480, 600);
  for (let k = 0; k < caws; k++) {
    const d = rrange(rng, 0.22, 0.34);
    const c = new Float32Array(Math.floor(d * sr));
    const b1 = new Biquad().bp(sr, 1300, 3);
    const b2 = new Biquad().bp(sr, 2300, 4);
    const w = new Wander(rng, sr, 130);
    let ph = 0;
    for (let i = 0; i < c.length; i++) {
      const u = i / c.length;
      const f = base * (u < 0.3 ? lerp(0.9, 1.1, u / 0.3) : lerp(1.1, 0.85, (u - 0.3) / 0.7));
      ph += f / sr;
      const src = (2 * (ph % 1) - 1) * (1 + 0.9 * w.next()) + (rng() * 2 - 1) * 0.4;
      c[i] = Math.tanh((b1.run(src) + b2.run(src) * 0.7) * 3) * Math.min(1, u * 15) * Math.pow(1 - u, 0.7);
    }
    addNorm(out, c, sr, k * rrange(rng, 0.38, 0.5), rrange(rng, 0.7, 1));
  }
  distant(out, sr, 3500, [[0.3, 0.18]]);
  return finish(out, sr);
}
export function bird(sr, rng, i) {
  return birdPhrase(sr, rng, i % 3);
}
export function owl(sr, rng, i) {
  const pat = i % 2 ? [[0, 0.35], [0.55, 0.18], [0.78, 0.22], [1.25, 0.55]] : [[0, 0.45], [0.9, 0.3], [1.35, 0.6]];
  const out = alloc(sr, 2.6);
  const f0 = rrange(rng, 340, 400);
  for (const [t, d] of pat) {
    const c = new Float32Array(Math.floor(d * sr));
    const lp = new Biquad().bp(sr, f0 * 1.1, 2);
    let ph = 0;
    for (let j = 0; j < c.length; j++) {
      const u = j / c.length;
      ph += (f0 * (1 - 0.06 * u)) / sr;
      const env = Math.min(1, u * 5) * Math.pow(1 - u, 1.2);
      c[j] = (Math.sin(TAU * ph) + 0.08 * Math.sin(2 * TAU * ph) + lp.run(rng() * 2 - 1) * 0.5) * env;
    }
    addNorm(out, c, sr, t, 0.9);
  }
  distant(out, sr, 1800, [[0.33, 0.2]]);
  return finish(out, sr);
}
export function wolf(sr, rng, i) {
  const dur = rrange(rng, 3.6, 5);
  const out = alloc(sr, dur + 2.2);
  const howl = (f0, d, vibHz) => {
    const n = Math.floor(d * sr);
    const c = new Float32Array(n);
    const fm = new Biquad();
    const w = new Wander(rng, sr, 0.8);
    let ph = 0;
    for (let j = 0; j < n; j++) {
      const t = j / sr;
      const u = j / n;
      if ((j & 63) === 0) fm.bp(sr, lerp(700, 1100, Math.sin(Math.PI * u)), 1.4);
      let f = u < 0.15 ? lerp(f0 * 0.62, f0, Math.sin((u / 0.15) * Math.PI * 0.5)) : u > 0.75 ? lerp(f0, f0 * 0.7, (u - 0.75) / 0.25) : f0 * (1 + 0.03 * w.next());
      f *= 1 + 0.012 * Math.sin(TAU * vibHz * t) * Math.min(1, t);
      ph += f / sr;
      const s = Math.sin(TAU * ph) + 0.45 * Math.sin(2 * TAU * ph) + 0.2 * Math.sin(3 * TAU * ph) + 0.08 * Math.sin(4 * TAU * ph);
      const env = Math.min(1, t / 0.35) * (u > 0.8 ? (1 - u) / 0.2 : 1);
      c[j] = (s * 0.6 + fm.run(s) * 1.2 + (rng() * 2 - 1) * 0.04) * env;
    }
    return c;
  };
  const f0 = rrange(rng, 480, 560);
  addNorm(out, howl(f0, dur, rrange(rng, 4.5, 6)), sr, 0, 1);
  if (i === 2) addNorm(out, howl(f0 * 1.26, dur * 0.8, 5.2), sr, 0.9, 0.7);
  distant(out, sr, 2200, [[0.41, 0.35], [0.95, 0.2], [1.6, 0.1]]);
  return finish(out, sr, 0.9, 0.01, 0.4);
}
export function scream(sr, rng) {
  const b = rrange(rng, 620, 760);
  const d = rrange(rng, 1.5, 2.2);
  const v = voice(sr, rng, {
    dur: d, pitch: [[0, b * 0.8], [0.1, b * 1.2], [0.5, b * 1.1], [0.8, b], [1, b * 0.65]], vowels: [[0, 'ae'], [0.3, 'a'], [1, 'a']],
    fscale: 1.22, bw: 1.3, jitter: 0.04, vib: 0.02, vibHz: 6, shimmer: 0.2, rasp: 0.35, breath: 0.3, drive: 2.2, chest: 0.1,
    env: [[0, 0], [0.08, 1], [0.7, 0.85], [1, 0]],
  });
  const out = alloc(sr, d + 1.4);
  addNorm(out, v, sr, 0, 1);
  distant(out, sr, 1800, [[0.45, 0.35], [1.05, 0.18]]);
  return finish(out, sr, 0.9, 0.01, 0.3);
}
export function whisper(sr, rng) {
  const dur = rrange(rng, 1.8, 2.8);
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const vv = ['a', 'e', 'i', 'o', 'u', 'uh', 'er'];
  const pts = [];
  const env = [[0, 0]];
  let t = 0.05;
  while (t < dur - 0.15) {
    const sl = rrange(rng, 0.09, 0.2);
    pts.push([t / dur, vv[Math.floor(rng() * vv.length)]]);
    env.push([t / dur, 0.1], [(t + sl * 0.3) / dur, rrange(rng, 0.5, 1)], [(t + sl) / dur, 0.15]);
    t += sl + (rng() < 0.2 ? rrange(rng, 0.08, 0.25) : 0.01);
  }
  env.push([1, 0]);
  const v = voice(sr, rng, {
    dur, pitch: [[0, 150], [1, 140]], vowels: pts.length > 1 ? pts : [[0, 'a'], [1, 'u']], voiced: 0, breath: 1.4, bw: 1.3,
    drive: 1.2, hp: 400, a3: 0.7, a4: 0.4, env,
  });
  addNorm(out, v, sr, 0, 1);
  // sibilants
  for (let k = 0; k < 3 + rng() * 3; k++) {
    const s = noise(sr, rng, rrange(rng, 0.08, 0.16), { hp: 4500, env: hann });
    addNorm(out, s, sr, rng() * (dur - 0.2), rrange(rng, 0.2, 0.45));
  }
  return finish(out, sr, 0.85, 0.02, 0.1);
}
export function treeCreak(sr, rng) {
  const d = rrange(rng, 1.4, 3);
  const out = alloc(sr, d + 0.3);
  addNorm(out, creak(sr, rng, d, rrange(rng, 8, 20), rrange(rng, 35, 80), rrange(rng, 0.6, 1)), sr, 0, 1);
  return finish(out, sr);
}
export function twig(sr, rng) {
  const out = alloc(sr, 0.5);
  addNorm(out, noise(sr, rng, 0.02, { hp: 1000, a: 0.0002, d: 0.003 }), sr, 0, 0.8);
  addNorm(out, modal(sr, rng, [{ f: rrange(rng, 800, 1100), d: 0.015 }, { f: rrange(rng, 1600, 2000), d: 0.012, a: 0.7 }, { f: 2900, d: 0.008, a: 0.5 }], 0.1, 0.4), sr, 0, 1);
  addNorm(out, modal(sr, rng, [{ f: rrange(rng, 1200, 1500), d: 0.01 }, { f: 2400, d: 0.008, a: 0.6 }], 0.08, 0.3), sr, rrange(rng, 0.02, 0.05), 0.5);
  addNorm(out, noise(sr, rng, 0.2, { hp: 2500, lp: 7000, env: hann }), sr, 0.03, 0.2);
  return finish(out, sr);
}
export function bell(sr, rng) {
  const f = 196;
  const r = [0.5, 1, 1.19, 1.5, 2, 2.52, 3.0, 4.07];
  const d = [5, 3.6, 2.6, 2.2, 1.9, 1.3, 0.9, 0.6];
  const a = [0.5, 0.8, 0.6, 0.35, 1, 0.3, 0.25, 0.15];
  const modes = [];
  for (let k = 0; k < r.length; k++) {
    modes.push({ f: f * r[k], d: d[k], a: a[k] });
    modes.push({ f: f * r[k] * 1.0025, d: d[k] * 0.9, a: a[k] * 0.4 });
  }
  const out = modal(sr, rng, modes, 6.5, 2, 3000);
  distant(out, sr, 1500, [[0.5, 0.25], [1.2, 0.12]]);
  return finish(out, sr, 0.85, 0.001, 0.5);
}
export function woodpecker(sr, rng) {
  const out = alloc(sr, 1.3);
  let t = 0.01;
  for (let k = 0; k < 14; k++) {
    addNorm(out, modal(sr, rng, [{ f: 1050, d: 0.01 }, { f: 1850, d: 0.008, a: 0.7 }, { f: 2650, d: 0.006, a: 0.5 }], 0.05, 0.3), sr, t, 1 - k * 0.03);
    t += 1 / (16 + k * 0.4);
  }
  distant(out, sr, 3000, [[0.35, 0.15]]);
  return finish(out, sr);
}

// ------------------------------------------------------------------ music instruments
export function pianoNote(sr, rng, f0, dur) {
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const B = 0.0003;
  const tauBase = 2.8 * Math.pow(220 / f0, 0.45);
  const fmax = Math.min(sr * 0.45, 7000);
  for (let k = 1; k <= 18; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > fmax) break;
    const bright = Math.exp(-((k - 1) * f0) / 2200);
    const hammer = Math.abs(Math.sin((Math.PI * k) / 7.3)) * 0.7 + 0.3;
    const ak = (1 / Math.pow(k, 0.9)) * (0.25 + 0.75 * bright) * hammer;
    const tau = tauBase / (1 + 0.35 * (k - 1));
    const detC = 0.6 + rng() * 0.9;
    const strings = k <= 6 ? 2 : 1;
    for (let s = 0; s < strings; s++) {
      const fr = fk * (strings === 2 ? semis(((s ? 1 : -1) * detC) / 100) : 1);
      const w = (TAU * fr) / sr;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      let x = 1;
      let y = 0;
      let e1 = 0.6 * ak / strings;
      let e2 = 0.4 * ak / strings;
      const r1 = Math.exp(-1 / (tau * 0.22 * sr));
      const r2 = Math.exp(-1 / (tau * sr));
      for (let i = 0; i < n; i++) {
        out[i] += y * (e1 + e2);
        const nx = x * cw - y * sw;
        y = x * sw + y * cw;
        x = nx;
        e1 *= r1;
        e2 *= r2;
        if ((i & 1023) === 0 && e1 + e2 < 1e-5) break;
      }
    }
  }
  addNorm(out, noise(sr, rng, 0.03, { lp: 1200, a: 0.0005, d: 0.006 }), sr, 0, 0.04);
  const a = Math.floor(0.002 * sr);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  return finish(out, sr, 0.9, 0.001, Math.min(0.4, dur * 0.1));
}
export function musicBox(sr, rng, f0) {
  const out = modal(sr, rng, [
    { f: f0, d: 1.5, a: 1 },
    { f: f0 * 2.01, d: 0.5, a: 0.1 },
    { f: f0 * 5.4, d: 0.32, a: 0.35 },
    { f: f0 * 8.93, d: 0.18, a: 0.16 },
    { f: f0 * 12.1, d: 0.09, a: 0.08 },
  ], 3.2, 0.3, 0);
  addNorm(out, noise(sr, rng, 0.004, { hp: 4000, a: 0.0001, d: 0.001 }), sr, 0, 0.05);
  return finish(out, sr, 0.9, 0.0005, 0.3);
}
// kind 0 big drum, 1 mid drum, 2 rim / ka
export function taiko(sr, rng, kind) {
  if (kind === 2) {
    const out = alloc(sr, 0.35);
    addNorm(out, modal(sr, rng, woodModes(rng, 2.6, 0.7), 0.3, 0.8, 5000), sr, 0, 1);
    addNorm(out, noise(sr, rng, 0.02, { bp: [3000, 1], a: 0.0002, d: 0.004 }), sr, 0, 0.5);
    return finish(out, sr);
  }
  const dur = kind ? 1.2 : 1.9;
  const f0 = kind ? rrange(rng, 88, 96) : rrange(rng, 54, 60);
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const r = [1, 1.59, 2.14, 2.3, 2.65, 2.92];
  const am = [1, 0.5, 0.35, 0.25, 0.18, 0.12];
  const dd = [0.7, 0.35, 0.25, 0.2, 0.15, 0.1];
  const dm = kind ? 0.55 : 1;
  for (let k = 0; k < r.length; k++) {
    let ph = rng();
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += (f0 * r[k] * (1 + 0.22 * Math.exp(-t / 0.035))) / sr;
      out[i] += Math.sin(TAU * ph) * am[k] * Math.exp(-t / (dd[k] * dm)) * (1 - Math.exp(-t / 0.0015));
    }
  }
  addNorm(out, noise(sr, rng, 0.05, { bp: [1500, 0.8], a: 0.0003, d: 0.01 }), sr, 0, 0.35);
  addNorm(out, noise(sr, rng, 0.2, { lp: 450, a: 0.001, d: 0.05 }), sr, 0, 0.5);
  softclip(out, 1.6);
  return finish(out, sr, 0.92, 0.0003, 0.2);
}
export function subPulse(sr, rng) {
  const out = alloc(sr, 0.8);
  addNorm(out, thump(sr, 58, 44, 0.05, 0.12), sr, 0, 1);
  addNorm(out, thump(sr, 52, 40, 0.05, 0.1), sr, 0.22, 0.7);
  addNorm(out, noise(sr, rng, 0.1, { lp: 200, env: hann }), sr, 0, 0.25);
  return finish(out, sr);
}
export function bassNote(sr, rng) {
  const dur = 0.75;
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const lp = new Biquad();
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 15) === 0) lp.lp(sr, 250 + 1300 * Math.exp(-t / 0.09), 3);
    const d1 = 55 / sr;
    const d2 = 55.3 / sr;
    p1 += d1;
    if (p1 >= 1) p1 -= 1;
    p2 += d2;
    if (p2 >= 1) p2 -= 1;
    p3 += 27.5 / sr;
    const saw = 2 * p1 - 1 - polyblep(p1, d1);
    const sq = (p2 < 0.5 ? 1 : -1) + polyblep(p2, d2) - polyblep((p2 + 0.5) % 1, d2);
    const e = Math.min(1, t / 0.004) * (0.55 * Math.exp(-t / 0.12) + 0.45) * (t > dur - 0.12 ? (dur - t) / 0.12 : 1);
    out[i] = Math.tanh((lp.run(saw * 0.6 + sq * 0.4) + Math.sin(TAU * p3) * 0.4) * 3) * e;
  }
  return finish(out, sr, 0.9, 0.001, 0.02);
}
export function brassStab(sr, rng) {
  const dur = 2.6;
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const vo = [55, 55 * 1.004, 55 * 0.996, 110, 110 * 1.003, 110 * 0.997, 82.4].map((f) => ({ inc: f / sr, ph: rng() }));
  const lp = new Biquad();
  const lp2 = new Biquad();
  const w = new Wander(rng, sr, 30);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = t < 0.12 ? t / 0.12 : t < 2 ? lerp(1, 0.55, (t - 0.12) / 1.88) : 0.55 * Math.max(0, 1 - (t - 2) / 0.6);
    if ((i & 15) === 0) {
      lp.lp(sr, 180 + 2400 * env * env, 1.5);
      lp2.lp(sr, 200 + 2600 * env * env, 0.7);
    }
    let s = 0;
    for (const v of vo) {
      v.ph += v.inc;
      if (v.ph >= 1) v.ph -= 1;
      s += 2 * v.ph - 1 - polyblep(v.ph, v.inc);
    }
    out[i] = Math.tanh(lp2.run(lp.run(s * 0.3)) * 2.5 * (1 + 0.1 * w.next())) * Math.min(1, t / 0.06) * (t > 2 ? Math.max(0, 1 - (t - 2) / 0.6) : 1);
  }
  return finish(out, sr, 0.9, 0.002, 0.1);
}
export function revSwell(sr, rng, i) {
  const dur = 4.2;
  const n = Math.floor(dur * sr);
  let fwd;
  if (i === 0) {
    fwd = new Float32Array(n);
    for (const f of [110, 116.54, 155.56]) addNorm(fwd, pianoNote(sr, rng, f, dur), sr, 0, 0.5);
    addNorm(fwd, noise(sr, rng, dur, { lp: 2500, env: (u) => Math.exp(-u * 4) }), sr, 0, 0.35);
  } else {
    fwd = noise(sr, rng, dur, { hp: 2500, env: (u) => Math.exp(-u * 3.5) });
    normalize(fwd, 0.6);
    addNorm(fwd, thump(sr, 60, 50, 1, 1.6, dur), sr, 0, 0.5);
  }
  const rv = reverse(fwd);
  for (let k = 0; k < n; k++) rv[k] *= Math.pow(k / n, 1.2);
  const st = widen(rv, sr, 11, 0.4);
  return finish(st, sr, 0.85, 0.05, 0.004);
}
export function scrape(sr, rng) {
  const dur = 2.3;
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const w = new Wander(rng, sr, 12);
  const rw = new Wander(rng, sr, 70);
  const bp = new Biquad().bp(sr, 2500, 2);
  const hp = new Biquad().hp(sr, 2000, 0.7);
  const f0 = rrange(rng, 1100, 1400);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const inc = (f0 * (1 + 0.03 * w.next())) / sr;
    ph += inc;
    if (ph >= 1) ph -= 1;
    const saw = 2 * ph - 1 - polyblep(ph, inc);
    const bow = hp.run(rng() * 2 - 1) * (0.5 + 0.5 * Math.abs(rw.next()));
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, u / 0.7) * 0.5), 2) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
    out[i] = Math.tanh((bp.run(saw) * 1.2 + bow * 0.5 + saw * 0.15) * 2) * env;
  }
  return finish(out, sr, 0.85);
}

// ------------------------------------------------------------------ stingers (stereo)
function st2(sr, dur) {
  const n = Math.floor(dur * sr);
  return [new Float32Array(n), new Float32Array(n)];
}
function addSt(dst, src, sr, t, peak, pan = 0.5) {
  if (Array.isArray(src)) {
    const m = Math.max(1e-9, ...src.map((c) => c.reduce((a, v) => Math.max(a, Math.abs(v)), 0)));
    mixInto(dst[0], src[0], Math.floor(t * sr), peak / m);
    mixInto(dst[1], src[1], Math.floor(t * sr), peak / m);
  } else {
    addNorm(dst[0], src, sr, t, peak * Math.sqrt(1 - pan) * 1.41);
    addNorm(dst[1], src, sr, t, peak * Math.sqrt(pan) * 1.41);
  }
}

export function stgNight(sr, rng) {
  const out = st2(sr, 8);
  addSt(out, thump(sr, 55, 30, 0.3, 1.3, 4), sr, 0, 0.7);
  addSt(out, padChord(sr, rng, [36.71, 73.42, 77.78, 103.83, 146.83], 7.8, { attack: 3.2, release: 3, detune: 12, lp: [[0, 150], [0.45, 1400], [1, 250]] }), sr, 0, 0.8);
  // distant horn
  const hd = 3;
  const hn = Math.floor(hd * sr);
  const horn = new Float32Array(hn);
  const b1 = new Biquad().bp(sr, 700, 2);
  const lp = new Biquad().lp(sr, 1200, 0.7);
  let ph = 0;
  for (let i = 0; i < hn; i++) {
    const t = i / sr;
    const inc = lerp(146.83, 139, t / hd) / sr;
    ph += inc;
    if (ph >= 1) ph -= 1;
    const s = 2 * ph - 1 - polyblep(ph, inc);
    horn[i] = lp.run(b1.run(s) * 2 + s * 0.3) * Math.min(1, t / 0.5) * (t > hd - 1.2 ? (hd - t) / 1.2 : 1);
  }
  distant(horn, sr, 1300, [[0.45, 0.4], [0.97, 0.22], [1.6, 0.1]]);
  addSt(out, horn, sr, 1.8, 0.45, 0.35);
  const wh = new Float32Array(Math.floor(6 * sr));
  for (let i = 0; i < wh.length; i++) {
    const t = i / sr;
    wh[i] = (Math.sin(TAU * 1760 * t) + Math.sin(TAU * 1767 * t)) * hann(i / wh.length);
  }
  addSt(out, wh, sr, 1.5, 0.04, 0.6);
  return finish(out, sr, 0.9, 0.01, 0.5);
}
export function stgDawn(sr, rng) {
  const out = st2(sr, 7.5);
  addSt(out, padChord(sr, rng, [73.42, 110, 146.83, 185, 220, 329.63, 369.99], 7.4, { attack: 2, release: 3.2, detune: 6, lp: [[0, 400], [0.4, 1300], [1, 600]] }), sr, 0, 0.6);
  const notes = [[440, 1.0], [587.33, 1.6], [659.25, 2.2], [739.99, 3.0]];
  for (const [f, t] of notes) addSt(out, musicBox(sr, rng, f), sr, t, 0.22, rng());
  for (let k = 0; k < 5; k++) addSt(out, birdPhrase(sr, rng, k % 3), sr, 2 + rng() * 4, rrange(rng, 0.1, 0.2), rng());
  return finish(out, sr, 0.85, 0.05, 0.6);
}
export function stgDeath(sr, rng) {
  const out = st2(sr, 5.8);
  addSt(out, thump(sr, 72, 26, 0.15, 0.9, 3), sr, 0, 1);
  addSt(out, noise(sr, rng, 0.8, { lp: 800, a: 0.002, d: 0.25 }), sr, 0, 0.6);
  addSt(out, modal(sr, rng, metalModes(rng, 70, 2.5), 4, 2, 1500), sr, 0, 0.4);
  const n = Math.floor(5.5 * sr);
  const tin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    tin[i] = (Math.sin(TAU * 3800 * t) + 0.7 * Math.sin(TAU * 3806 * t)) * Math.min(1, t / 0.05) * Math.exp(-t / 2.2);
  }
  addSt(out, tin, sr, 0.05, 0.18);
  addSt(out, padChord(sr, rng, [36.71, 55, 38.89], 5.5, { attack: 0.8, release: 3.5, detune: 10, lp: [[0, 300], [1, 120]] }), sr, 0.1, 0.4);
  return finish(out, sr, 0.9, 0.0005, 0.6);
}
export function stgBoss(sr, rng) {
  const out = st2(sr, 5);
  addSt(out, padChord(sr, rng, [36.71, 55, 73.42, 77.78, 110], 4.6, { attack: 0.12, release: 2, detune: 14, lp: [[0, 150], [0.05, 2800], [0.45, 900], [1, 300]] }), sr, 0, 1);
  const roar = voice(sr, rng, {
    dur: 2.6, pitch: [[0, 40], [0.15, 55], [0.6, 50], [1, 32]], vowels: [[0, 'o'], [0.3, 'a'], [1, 'u']], fscale: 0.5, bw: 2.2,
    jitter: 0.08, shimmer: 0.5, sub: 0.6, gurgle: 0.45, rasp: 0.8, raspHz: 80, breath: 0.5, drive: 6, chest: 1.2,
    env: [[0, 0], [0.08, 1], [0.6, 0.9], [1, 0]],
  });
  addSt(out, roar, sr, 0.3, 0.7);
  addSt(out, thump(sr, 60, 28, 0.3, 1, 3), sr, 0, 0.8);
  softclip(out, 1.6);
  return finish(out, sr, 0.95, 0.001, 0.5);
}
export function stgVictory(sr, rng) {
  const out = st2(sr, 8);
  addSt(out, padChord(sr, rng, [58.27, 116.54, 146.83, 174.61, 220], 3.4, { attack: 1.2, release: 1.2, detune: 7, lp: [[0, 500], [1, 1400]] }), sr, 0, 0.55);
  addSt(out, padChord(sr, rng, [73.42, 146.83, 185, 220, 293.66, 369.99], 5, { attack: 1.0, release: 2.8, detune: 7, lp: [[0, 900], [0.3, 1800], [1, 700]] }), sr, 2.8, 0.6);
  const arp = [587.33, 739.99, 880, 1174.66];
  arp.forEach((f, k) => addSt(out, musicBox(sr, rng, f), sr, 3.1 + k * 0.42, 0.22, 0.3 + k * 0.15));
  addSt(out, pianoNote(sr, rng, 73.42, 4.5), sr, 2.8, 0.35);
  return finish(out, sr, 0.85, 0.05, 0.6);
}
export function stgGameOver(sr, rng) {
  const out = st2(sr, 8);
  const seq = [[146.83, 0], [130.81, 0.7], [116.54, 1.4], [103.83, 2.1]];
  for (const [f, t] of seq) addSt(out, pianoNote(sr, rng, f, 3.5), sr, t, 0.4, 0.4 + rng() * 0.2);
  addSt(out, pianoNote(sr, rng, 36.71, 5), sr, 3.2, 0.6);
  addSt(out, pianoNote(sr, rng, 51.91, 5), sr, 3.2, 0.4);
  addSt(out, thump(sr, 50, 28, 0.3, 1.2, 3), sr, 3.2, 0.6);
  addSt(out, padChord(sr, rng, [36.71, 38.89, 51.91], 7.5, { attack: 2, release: 3.5, detune: 12, lp: [[0, 200], [0.5, 500], [1, 120]] }), sr, 0.3, 0.45);
  return finish(out, sr, 0.85, 0.01, 0.8);
}
export function stgJumpscare(sr, rng) {
  const dur = 2;
  const out = st2(sr, dur);
  const n = Math.floor(1.8 * sr);
  const set = [0, 1, 6, 7, 11, 13, 18, 19, 23, 25];
  for (let ch = 0; ch < 2; ch++) {
    const c = new Float32Array(n);
    const vo = set.map((s) => ({ inc: (523.25 * semis(s + (rng() - 0.5) * 0.3)) / sr, ph: rng() }));
    const lp = new Biquad().lp(sr, 6000, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let s = 0;
      for (const v of vo) {
        v.ph += v.inc;
        if (v.ph >= 1) v.ph -= 1;
        s += 2 * v.ph - 1 - polyblep(v.ph, v.inc);
      }
      const trem = 0.75 + 0.25 * Math.sin(TAU * 14 * t + ch);
      c[i] = lp.run(s * 0.2) * Math.min(1, t / 0.004) * Math.exp(-t / 0.55) * trem;
    }
    mixInto(out[ch], c, 0, 1);
  }
  normalize(out, 0.8);
  addSt(out, noise(sr, rng, 0.25, { hp: 2000, a: 0.001, d: 0.06 }), sr, 0, 0.5);
  addSt(out, thump(sr, 65, 30, 0.08, 0.3), sr, 0, 0.8);
  softclip(out, 2);
  return finish(out, sr, 0.95, 0.0005, 0.2);
}
export function stgJoin(sr, rng) {
  const out = st2(sr, 3.2);
  addSt(out, padChord(sr, rng, [73.42, 110, 146.83], 3.1, { attack: 0.9, release: 1.6, detune: 6, lp: [[0, 300], [0.5, 700], [1, 300]] }), sr, 0, 0.5);
  addSt(out, musicBox(sr, rng, 587.33), sr, 0.45, 0.25, 0.6);
  return finish(out, sr, 0.7, 0.05, 0.5);
}
export function stgCarPart(sr, rng) {
  const out = st2(sr, 2.8);
  addSt(out, metalHit(sr, rng, 185), sr, 0, 0.6, 0.45);
  const arp = [587.33, 739.99, 880, 1174.66];
  arp.forEach((f, k) => addSt(out, musicBox(sr, rng, f), sr, 0.3 + k * 0.16, 0.3, 0.3 + k * 0.13));
  addSt(out, padChord(sr, rng, [146.83, 220, 293.66, 369.99], 2.4, { attack: 0.3, release: 1.4, detune: 6, lp: [[0, 600], [1, 1200]] }), sr, 0.3, 0.3);
  return finish(out, sr, 0.85, 0.001, 0.4);
}

// ------------------------------------------------------------------ registries
export const AMB_DEFS = [
  { bank: 'bed_wind', n: 1, sr: LO, gen: bedWind },
  { bank: 'bed_pines', n: 1, sr: LO, gen: bedPines },
  { bank: 'bed_crickets', n: 1, sr: MID, gen: bedCrickets },
  { bank: 'bed_drone', n: 1, sr: LO, gen: bedDrone },
  { bank: 'bed_horde', n: 1, sr: LO, group: 'late', gen: bedHorde },
  { bank: 'amb_crow', n: 3, sr: LO, group: 'late', gen: crow },
  { bank: 'amb_bird', n: 4, sr: MID, group: 'late', gen: bird },
  { bank: 'amb_owl', n: 2, sr: LO, group: 'late', gen: owl },
  { bank: 'amb_wolf', n: 3, sr: LO, group: 'late', gen: wolf },
  { bank: 'amb_scream', n: 2, sr: LO, group: 'late', gen: scream },
  { bank: 'amb_whisper', n: 3, sr: MID, group: 'late', gen: whisper },
  { bank: 'amb_creak', n: 4, sr: LO, group: 'late', gen: treeCreak },
  { bank: 'amb_twig', n: 2, sr: MID, group: 'late', gen: twig },
  { bank: 'amb_bell', n: 1, sr: LO, group: 'late', gen: bell },
  { bank: 'amb_woodpecker', n: 1, sr: MID, group: 'late', gen: woodpecker },
];

// mus_piano variant i is the note A(1+i) (55 * 2^i Hz); mus_box i is A(4+i); mus_taiko i is the drum kind.
export const PIANO_BASE_HZ = [55, 110, 220, 440, 880];
export const BOX_BASE_HZ = [440, 880];
export const MUSIC_DEFS = [
  { bank: 'mus_piano', n: 5, sr: MID, gen: (sr, r, i) => pianoNote(sr, r, PIANO_BASE_HZ[i], [7, 6, 5, 4, 3][i]) },
  { bank: 'mus_box', n: 2, sr: HI, gen: (sr, r, i) => musicBox(sr, r, BOX_BASE_HZ[i]) },
  { bank: 'mus_taiko', n: 3, sr: MID, gen: taiko },
  { bank: 'mus_pulse', n: 1, sr: LO, gen: subPulse },
  { bank: 'mus_swell', n: 2, sr: MID, gen: revSwell },
  { bank: 'mus_bass', n: 1, sr: MID, group: 'late', gen: bassNote },
  { bank: 'mus_brass', n: 1, sr: MID, group: 'late', gen: brassStab },
  { bank: 'mus_scrape', n: 1, sr: MID, group: 'late', gen: scrape },
];

export const STINGER_DEFS = [
  { bank: 'stg_night', n: 1, sr: MID, group: 'late', gen: stgNight },
  { bank: 'stg_dawn', n: 1, sr: MID, group: 'late', gen: stgDawn },
  { bank: 'stg_death', n: 1, sr: MID, group: 'late', gen: stgDeath },
  { bank: 'stg_boss', n: 1, sr: MID, group: 'late', gen: stgBoss },
  { bank: 'stg_victory', n: 1, sr: MID, group: 'late', gen: stgVictory },
  { bank: 'stg_gameover', n: 1, sr: MID, group: 'late', gen: stgGameOver },
  { bank: 'stg_jumpscare', n: 1, sr: HI, group: 'late', gen: stgJumpscare },
  { bank: 'stg_join', n: 1, sr: MID, gen: stgJoin },
  { bank: 'stg_car_part', n: 1, sr: HI, group: 'late', gen: stgCarPart },
];
