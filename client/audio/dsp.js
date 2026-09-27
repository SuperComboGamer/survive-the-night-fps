// Pure DSP primitives used by the procedural sound generators.
// No DOM / WebAudio here: everything works on Float32Arrays so it can be unit-tested in Node.

export const TAU = Math.PI * 2;

// ------------------------------------------------------------------ math helpers
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};
export const semis = (s) => Math.pow(2, s / 12);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);

// ------------------------------------------------------------------ random
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const rrange = (rng, a, b) => a + (b - a) * rng();
export const rpick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ------------------------------------------------------------------ filters
const fclamp = (f, sr) => (f < 5 ? 5 : f > sr * 0.48 ? sr * 0.48 : f);

// RBJ cookbook biquad (direct form I)
export class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    return this;
  }
  _set(b0, b1, b2, a0, a1, a2) {
    const ia = 1 / a0;
    this.b0 = b0 * ia;
    this.b1 = b1 * ia;
    this.b2 = b2 * ia;
    this.a1 = a1 * ia;
    this.a2 = a2 * ia;
    return this;
  }
  lp(sr, f, q = 0.7071) {
    const w = (TAU * fclamp(f, sr)) / sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this._set((1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al);
  }
  hp(sr, f, q = 0.7071) {
    const w = (TAU * fclamp(f, sr)) / sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this._set((1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
  }
  // band-pass, constant 0 dB peak gain
  bp(sr, f, q = 1) {
    const w = (TAU * fclamp(f, sr)) / sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this._set(al, 0, -al, 1 + al, -2 * cs, 1 - al);
  }
  peak(sr, f, q, db) {
    const A = Math.pow(10, db / 40);
    const w = (TAU * fclamp(f, sr)) / sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    return this._set(1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A);
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export class OnePole {
  constructor() {
    this.a = 1;
    this.y = 0;
  }
  lp(sr, f) {
    this.a = 1 - Math.exp((-TAU * fclamp(f, sr)) / sr);
    return this;
  }
  run(x) {
    return (this.y += this.a * (x - this.y));
  }
  // high-pass output = input minus low-passed
  hp(x) {
    return x - (this.y += this.a * (x - this.y));
  }
}

// Two-pole resonator: impulse response is a damped sinusoid (freq f, amplitude time constant `decay` s)
export class Resonator {
  constructor(sr, f, decay, amp = 1) {
    this.y1 = 0;
    this.y2 = 0;
    this.set(sr, f, decay, amp);
  }
  set(sr, f, decay, amp = 1) {
    const w = (TAU * fclamp(f, sr)) / sr;
    const r = Math.exp(-1 / (Math.max(decay, 1e-4) * sr));
    this.c1 = 2 * r * Math.cos(w);
    this.c2 = -r * r;
    this.g = Math.sin(w) * amp;
    return this;
  }
  run(x) {
    const y = x * this.g + this.c1 * this.y1 + this.c2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// bank of modes [{f, d, a}] excited in parallel
export class ModeBank {
  constructor(sr, modes) {
    this.r = modes.filter((m) => m.f < sr * 0.47).map((m) => new Resonator(sr, m.f, m.d, m.a ?? 1));
  }
  run(x) {
    let s = 0;
    const r = this.r;
    for (let i = 0; i < r.length; i++) s += r[i].run(x);
    return s;
  }
}

// simple feedback comb / delay line
export class Delay {
  constructor(len) {
    this.buf = new Float32Array(Math.max(1, len | 0));
    this.i = 0;
  }
  read() {
    return this.buf[this.i];
  }
  write(x) {
    this.buf[this.i] = x;
    if (++this.i >= this.buf.length) this.i = 0;
  }
}

// ------------------------------------------------------------------ noise / modulators
export class Pink {
  constructor(rng) {
    this.rng = rng;
    this.b0 = 0;
    this.b1 = 0;
    this.b2 = 0;
  }
  next() {
    const w = this.rng() * 2 - 1;
    this.b0 = 0.99765 * this.b0 + w * 0.099046;
    this.b1 = 0.963 * this.b1 + w * 0.2965164;
    this.b2 = 0.57 * this.b2 + w * 1.0526913;
    return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.25;
  }
}

export class Brown {
  constructor(rng) {
    this.rng = rng;
    this.y = 0;
  }
  next() {
    this.y = (this.y + 0.04 * (this.rng() * 2 - 1)) * 0.996;
    return this.y * 2.2;
  }
}

// smoothly interpolated random values in [-1, 1] changing `hz` times per second
export class Wander {
  constructor(rng, sr, hz) {
    this.rng = rng;
    this.step = hz / sr;
    this.p = 1;
    this.a = 0;
    this.b = rng() * 2 - 1;
  }
  rate(sr, hz) {
    this.step = hz / sr;
    return this;
  }
  next() {
    this.p += this.step;
    if (this.p >= 1) {
      this.p -= Math.floor(this.p);
      this.a = this.b;
      this.b = this.rng() * 2 - 1;
    }
    const s = this.p * this.p * (3 - 2 * this.p);
    return this.a + (this.b - this.a) * s;
  }
}

export function polyblep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// Piecewise-linear curve over normalised time u in [0,1]: pts = [[u, v], ...] sorted by u.
export class Curve {
  constructor(pts) {
    this.pts = pts;
    this.k = 0;
  }
  at(u) {
    const p = this.pts;
    if (u <= p[0][0]) return p[0][1];
    const last = p.length - 1;
    if (u >= p[last][0]) return p[last][1];
    let k = this.k;
    if (u < p[k][0]) k = 0;
    while (k < last - 1 && u > p[k + 1][0]) k++;
    this.k = k;
    const a = p[k];
    const b = p[k + 1];
    const t = (u - a[0]) / (b[0] - a[0] || 1);
    return a[1] + (b[1] - a[1]) * t;
  }
}

// ------------------------------------------------------------------ envelopes
export const ar = (t, a, tau) => (t < a ? t / a : Math.exp(-(t - a) / tau));
export const hann = (u) => (u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(TAU * u));

// ------------------------------------------------------------------ buffer helpers
export const alloc = (sr, sec) => new Float32Array(Math.max(1, Math.ceil(sr * sec)));

export function chans(x) {
  return Array.isArray(x) ? x : [x];
}

export function peakOf(x) {
  let m = 0;
  for (const c of chans(x)) for (let i = 0; i < c.length; i++) {
    const v = c[i] < 0 ? -c[i] : c[i];
    if (v > m) m = v;
  }
  return m;
}

export function rmsOf(x) {
  let s = 0;
  let n = 0;
  for (const c of chans(x)) {
    for (let i = 0; i < c.length; i++) s += c[i] * c[i];
    n += c.length;
  }
  return Math.sqrt(s / Math.max(1, n));
}

export function scale(x, g) {
  for (const c of chans(x)) for (let i = 0; i < c.length; i++) c[i] *= g;
  return x;
}

export function normalize(x, peak = 0.9) {
  const p = peakOf(x);
  if (p > 1e-9) scale(x, peak / p);
  return x;
}

export function dcBlock(c, sr = 44100, hz = 12) {
  const R = Math.exp((-TAU * hz) / sr);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    const y = x - x1 + R * y1;
    x1 = x;
    y1 = y;
    c[i] = y;
  }
  return c;
}

export function fade(x, sr, fin = 0.002, fout = 0.01) {
  for (const c of chans(x)) {
    const ni = Math.min(c.length, Math.floor(fin * sr));
    for (let i = 0; i < ni; i++) c[i] *= i / ni;
    const no = Math.min(c.length, Math.floor(fout * sr));
    for (let i = 0; i < no; i++) c[c.length - 1 - i] *= i / no;
  }
  return x;
}

// Final tidy-up for one-shots: DC block, edge fades, normalise.
export function finish(x, sr, peak = 0.9, fin = 0.0015, fout = 0.02) {
  for (const c of chans(x)) {
    for (let i = 0; i < c.length; i++) if (c[i] !== c[i]) c[i] = 0; // NaN guard
    dcBlock(c, sr);
  }
  fade(x, sr, fin, fout);
  return normalize(x, peak);
}

export function softclip(x, drive) {
  const n = Math.tanh(drive);
  for (const c of chans(x)) for (let i = 0; i < c.length; i++) c[i] = Math.tanh(c[i] * drive) / n;
  return x;
}

export function mixInto(dst, src, offset = 0, gain = 1) {
  const o = Math.floor(offset);
  const n = Math.min(src.length, dst.length - o);
  for (let i = Math.max(0, -o); i < n; i++) dst[o + i] += src[i] * gain;
  return dst;
}

export function reverse(c) {
  const out = new Float32Array(c.length);
  for (let i = 0, n = c.length; i < n; i++) out[i] = c[n - 1 - i];
  return out;
}

// Make a seamless loop: input must be (loopLen + xfade) samples long; the tail is crossfaded (equal power)
// into the head so sample[loopLen-1] -> sample[0] is continuous.
export function loopify(x, sr, xfadeSec) {
  const out = [];
  for (const c of chans(x)) {
    const X = Math.min(Math.floor(xfadeSec * sr), Math.floor(c.length / 3));
    const N = c.length - X;
    const o = new Float32Array(N);
    for (let i = 0; i < N; i++) o[i] = c[i];
    for (let i = 0; i < X; i++) {
      const u = i / X;
      o[i] = c[i] * Math.sin(u * Math.PI * 0.5) + c[N + i] * Math.cos(u * Math.PI * 0.5);
    }
    out.push(o);
  }
  return Array.isArray(x) ? out : out[0];
}

// Mono -> stereo with slight decorrelation (short Haas-style offset + filtering), for wide 2D sounds.
export function widen(c, sr, ms = 9, amt = 0.35) {
  const d = Math.floor((ms / 1000) * sr);
  const L = new Float32Array(c.length);
  const R = new Float32Array(c.length);
  for (let i = 0; i < c.length; i++) {
    const del = i >= d ? c[i - d] : 0;
    L[i] = c[i] + del * amt;
    R[i] = c[i] - del * amt;
  }
  return [L, R];
}

// ------------------------------------------------------------------ impulse responses
// Outdoor forest: sparse early reflections off trunks, a diffuse tail that darkens quickly
// (foliage absorbs highs) and a few smeared slap-back echoes from distant hills.
export function forestIR(sr, dur = 3, seed = 1) {
  const rng = mulberry32(seed);
  const n = Math.floor(sr * dur);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let ch = 0; ch < 2; ch++) {
    const c = out[ch];
    const lp = new OnePole();
    const pre = Math.floor(0.011 * sr);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      if ((i & 63) === 0) lp.lp(sr, 900 + 8500 * Math.exp(-t * 3.2));
      const env = Math.exp(-t * (6.9 / dur)) * (1 - Math.exp(-t * 60));
      c[i] = lp.run(rng() * 2 - 1) * env * 0.55;
    }
    // early reflections (tree trunks)
    for (let k = 0; k < 16; k++) {
      const t = 0.008 + rng() * 0.09;
      const i = Math.floor(t * sr);
      const g = (0.25 + rng() * 0.5) * Math.exp(-t * 12) * (rng() < 0.5 ? -1 : 1);
      for (let j = 0; j < 12 && i + j < n; j++) c[i + j] += g * Math.exp(-j / 3);
    }
    // distant slap-back echoes (hills / tree line)
    const echoes = [0.19 + rng() * 0.05, 0.41 + rng() * 0.08, 0.72 + rng() * 0.1, 1.1 + rng() * 0.15];
    const eg = [0.3, 0.2, 0.12, 0.07];
    for (let k = 0; k < echoes.length; k++) {
      const s = Math.floor(echoes[k] * sr);
      const len = Math.floor(0.05 * sr);
      const elp = new OnePole().lp(sr, 1800 - k * 300);
      for (let j = 0; j < len && s + j < n; j++) {
        c[s + j] += elp.run(rng() * 2 - 1) * eg[k] * Math.exp(-j / (0.012 * sr)) * 2.2;
      }
    }
    dcBlock(c, sr, 20);
  }
  const p = peakOf(out);
  scale(out, 0.6 / Math.max(p, 1e-6));
  return out;
}

// Long, dark, dense hall for music (piano notes with long reverb).
export function hallIR(sr, dur = 5, seed = 2) {
  const rng = mulberry32(seed);
  const n = Math.floor(sr * dur);
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let ch = 0; ch < 2; ch++) {
    const c = out[ch];
    const lp = new OnePole();
    const lp2 = new OnePole();
    const pre = Math.floor(0.028 * sr);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      if ((i & 63) === 0) {
        const f = 700 + 5200 * Math.exp(-t * 1.1);
        lp.lp(sr, f);
        lp2.lp(sr, f * 1.3);
      }
      const env = Math.exp(-t * (6.9 / dur)) * (1 - Math.exp(-t * 18));
      c[i] = lp2.run(lp.run(rng() * 2 - 1)) * env;
    }
    dcBlock(c, sr, 25);
  }
  const p = peakOf(out);
  scale(out, 0.5 / Math.max(p, 1e-6));
  return out;
}
