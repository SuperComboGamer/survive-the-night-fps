// Sample-level DSP helpers for synthesising sounds offline into AudioBuffers (no external audio files).
// Usage:  const buf = dsp.render(ctx, 0.6, (t, i, sr) => sample) ...  or build with layers:  dsp.layers(ctx, 1.2, [ L1, L2 ])
// All functions are allocation-light so hundreds of short sounds can be generated at load time.
export const TAU = Math.PI * 2;
let _seed = 12345; export const seedNoise = (s) => { _seed = s >>> 0; };
export const rnd = () => { _seed = (_seed + 0x6d2b79f5) >>> 0; let t = _seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const noise = () => rnd() * 2 - 1;

/** Biquad filter (RBJ). type: lp hp bp notch peak lowshelf highshelf. Process sample by sample: y = f.p(x) */
export class Biquad {
  constructor(type = 'lp', freq = 1000, q = 0.707, sr = 44100, gainDb = 0) { this.sr = sr; this.set(type, freq, q, gainDb); this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(type, freq, q = 0.707, gainDb = 0) {
    const w0 = TAU * Math.min(freq, this.sr * 0.49) / this.sr, cw = Math.cos(w0), sw = Math.sin(w0), al = sw / (2 * q), A = Math.pow(10, gainDb / 40); let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'peak': b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
      case 'lowshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'highshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      default: b0 = 1; b1 = b2 = a1 = a2 = 0; a0 = 1;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this;
  }
  p(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
/** One-pole lowpass */
export class OnePole { constructor(fc, sr = 44100) { this.a = 1 - Math.exp(-TAU * fc / sr); this.y = 0; } p(x) { this.y += this.a * (x - this.y); return this.y; } }
// envelopes
export const expDecay = (t, tau) => Math.exp(-t / tau);
export const adsr = (t, a, d, s, r, dur) => t < a ? t / a : t < a + d ? 1 - (1 - s) * (t - a) / d : t < dur - r ? s : s * Math.max(0, (dur - t) / r);
export const attack = (t, a) => Math.min(1, t / a);
export const sat = (x, k = 1) => Math.tanh(x * k);
export const hardClip = (x) => Math.max(-1, Math.min(1, x));
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Modal (struck object) synthesis: sum of exponentially decaying sinusoids. partials: [[ratio, amp, decaySec]...] */
export function modal(t, f0, partials, phase = 0) { let s = 0; for (const [r, a, d] of partials) s += a * Math.sin(TAU * f0 * r * t + phase * r) * Math.exp(-t / d); return s; }
export const METAL = [[1, 1, 0.09], [2.76, 0.7, 0.06], [5.4, 0.5, 0.04], [8.93, 0.3, 0.03], [13.3, 0.15, 0.02]];
export const WOOD = [[1, 1, 0.03], [2.3, 0.5, 0.02], [3.9, 0.3, 0.012]];
export const GLASS = [[1, 1, 0.25], [2.32, 0.6, 0.18], [4.25, 0.5, 0.12], [6.63, 0.3, 0.09]];

/**
 * Render mono/stereo AudioBuffer. fn(t, i, sr, ch) => sample. seconds. channels 1|2 (fn called per channel when 2).
 * Peak-normalises to `peak` (default 0.9) unless normalize=false.
 */
export function render(ctx, seconds, fn, { channels = 1, normalize = true, peak = 0.9, sr = ctx.sampleRate } = {}) {
  const n = Math.max(1, Math.floor(seconds * sr)), buf = ctx.createBuffer(channels, n, sr); let mx = 1e-9;
  for (let c = 0; c < channels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) { const v = fn(i / sr, i, sr, c); d[i] = v; const a = v < 0 ? -v : v; if (a > mx) mx = a; } }
  if (normalize) { const g = peak / mx; for (let c = 0; c < channels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] *= g; } }
  return buf;
}
/** Render with a generator that fills a Float32Array itself: fill(out: Float32Array, sr, ch). */
export function renderArray(ctx, seconds, fill, { channels = 1, normalize = true, peak = 0.9, sr = ctx.sampleRate } = {}) {
  const n = Math.max(1, Math.floor(seconds * sr)), buf = ctx.createBuffer(channels, n, sr);
  for (let c = 0; c < channels; c++) fill(buf.getChannelData(c), sr, c);
  if (normalize) { let mx = 1e-9; for (let c = 0; c < channels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > mx) mx = a; } } const g = peak / mx; for (let c = 0; c < channels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] *= g; } }
  return buf;
}

// =====================================================================================================================
// EXTENDED TOOLKIT (audio worker).  Everything below works on plain Float32Arrays so hundreds of sounds can be built at
// load time with tight, allocation-light loops.  `sr` is passed explicitly (or bound by `kit(ctx)`).
// NOTE on speed: V8 slows ~50x on denormal floats, so every recursive resonator below is cut off after ~-120 dB.
// =====================================================================================================================
export const PI = Math.PI;
const SIN_N = 4096, SIN_T = (() => { const t = new Float32Array(SIN_N + 1); for (let i = 0; i <= SIN_N; i++) t[i] = Math.sin(TAU * i / SIN_N); return t; })();
/** fast sine (table + linear interpolation, error < 3e-7): ~4x cheaper than Math.sin in per-sample loops. x in radians (any magnitude). */
export function fsin(x) { let u = x * (SIN_N / TAU); const k = Math.floor(u); u -= k; const i = k & (SIN_N - 1); return SIN_T[i] + (SIN_T[i + 1] - SIN_T[i]) * u; }
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const dbToGain = (d) => Math.pow(10, d / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));
export const hashStr = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Independent seeded stream (mulberry32) so every sound variant is reproducible and unaffected by other generators. */
export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() { let t = (this.s = (this.s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  sym() { return this.next() * 2 - 1; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(a + (b - a + 1) * this.next()); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  gauss() { let u = 0; while (u === 0) u = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * this.next()); }
  fork(tag) { return new Rng((this.s ^ hashStr(String(tag))) >>> 0); }
}
const _rng = new Rng(7);

// ---------------------------------------------------------------------------------------------- array helpers
export const alloc = (n) => new Float32Array(Math.max(1, n | 0));
/** dst += src*gain starting at sample offset `at` (bounds-safe). */
export function mixInto(dst, src, gain = 1, at = 0) {
  at |= 0; let i0 = 0, i1 = src.length; if (at < 0) i0 = -at; if (at + i1 > dst.length) i1 = dst.length - at;
  for (let i = i0; i < i1; i++) dst[at + i] += src[i] * gain; return dst;
}
export function peakOf(a) { let m = 0; for (let i = 0; i < a.length; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > m) m = v; } return m; }
export function rmsOf(a, i0 = 0, i1 = a.length) { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); }
export function scaleBy(a, g) { for (let i = 0; i < a.length; i++) a[i] *= g; return a; }
export function normalizeTo(a, peak = 0.9) { const m = peakOf(a); if (m > 1e-9) scaleBy(a, peak / m); return a; }
export function fadeEdges(a, inN, outN) { const n = a.length; inN = Math.min(inN | 0, n); outN = Math.min(outN | 0, n); for (let i = 0; i < inN; i++) a[i] *= i / inN; for (let i = 0; i < outN; i++) a[n - 1 - i] *= i / outN; return a; }
export function reverseArr(a) { a.reverse(); return a; }
export function concatArr(...arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Float32Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }
/** Remove DC / infrasonic drift with a one-pole highpass (fc Hz). */
export function dcBlock(a, sr, fc = 12) { const k = Math.exp(-TAU * fc / sr); let x1 = 0, y1 = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; y1 = x - x1 + k * y1; x1 = x; a[i] = y1; } return a; }
/** Catmull-Rom (cubic Hermite) resample: ratio>1 => higher pitch & shorter. Bounds handled by padding once, so the inner loop is branch-free. */
export function resample(a, ratio) {
  const n = Math.max(2, Math.floor((a.length - 1) / ratio)), o = new Float32Array(n), m = a.length, p = new Float32Array(m + 3); p.set(a, 1); p[0] = a[0]; p[m + 1] = a[m - 1]; p[m + 2] = a[m - 1];
  for (let i = 0; i < n; i++) { const q = i * ratio, k = q | 0, f = q - k, y0 = p[k], y1 = p[k + 1], y2 = p[k + 2], y3 = p[k + 3]; o[i] = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0))); }
  return o;
}
/** Loop-safe cross-fade: returns array of length n-xf whose end flows seamlessly into its start (equal-power). */
export function makeLoop(a, xfN) {
  const n = a.length - xfN, o = new Float32Array(n); o.set(a.subarray(0, n));
  for (let i = 0; i < xfN; i++) { const t = i / xfN, gA = Math.sin(t * PI / 2), gB = Math.cos(t * PI / 2); o[i] = a[i] * gA + a[n + i] * gB; }
  return o;
}

// ---------------------------------------------------------------------------------------------- noise generators
/** color: white | pink (-3 dB/oct, Kellet) | brown (-6) | blue (+3) | violet (+6). Roughly unit-ish RMS (~0.3..0.6). */
export function noiseArray(n, rng = _rng, color = 'white') {
  const a = new Float32Array(n);
  switch (color) {
    case 'pink': { let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; for (let i = 0; i < n; i++) { const w = rng.next() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.22; b6 = w * 0.115926; } break; }
    case 'brown': { let l = 0; for (let i = 0; i < n; i++) { l = (l + 0.02 * (rng.next() * 2 - 1)) / 1.02; a[i] = l * 6; } break; }
    case 'blue': { let p = 0; for (let i = 0; i < n; i++) { const w = rng.next() * 2 - 1; a[i] = (w - p) * 0.7; p = w; } break; }
    case 'violet': { let p = 0, p2 = 0; for (let i = 0; i < n; i++) { const w = rng.next() * 2 - 1; a[i] = (w - 2 * p + p2) * 0.5; p2 = p; p = w; } break; }
    default: for (let i = 0; i < n; i++) a[i] = rng.next() * 2 - 1;
  }
  return a;
}

// ---------------------------------------------------------------------------------------------- filters (in place)
/** RBJ biquad over a whole array. type as in Biquad. Returns the same array. */
export function biquadInPlace(a, type, f, q, sr, gainDb = 0) {
  const bq = new Biquad(type, clamp(f, 8, sr * 0.49), q, sr, gainDb); const b0 = bq.b0, b1 = bq.b1, b2 = bq.b2, a1 = bq.a1, a2 = bq.a2; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; a[i] = y; }
  return a;
}
export const lowpass = (a, f, sr, order = 2) => { biquadInPlace(a, 'lp', f, 0.7071, sr); if (order >= 4) biquadInPlace(a, 'lp', f, 0.7071, sr); if (order >= 6) biquadInPlace(a, 'lp', f, 0.7071, sr); return a; };
export const highpass = (a, f, sr, order = 2) => { biquadInPlace(a, 'hp', f, 0.7071, sr); if (order >= 4) biquadInPlace(a, 'hp', f, 0.7071, sr); return a; };
export const bandpass = (a, f, q, sr) => biquadInPlace(a, 'bp', f, q, sr);
export function onePoleLP(a, sr, fc) { const k = 1 - Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < a.length; i++) { y += k * (a[i] - y); a[i] = y; } return a; }
export function onePoleHP(a, sr, fc) { const k = 1 - Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < a.length; i++) { y += k * (a[i] - y); a[i] -= y; } return a; }
/** State-variable filter (TPT) with per-block modulated cutoff. mode: 'lp'|'bp'|'hp'|'notch'. fc: Hz or (sampleIndex)=>Hz (evaluated every 8 samples). bp has unity peak gain. */
export function svf(a, sr, mode, fc, q = 0.7, out = a) {
  const fn = typeof fc === 'function' ? fc : null, m = mode === 'lp' ? 0 : mode === 'bp' ? 1 : mode === 'hp' ? 2 : 3, k = 1 / q; let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0;
  for (let i = 0; i < a.length; i++) {
    if ((i & 7) === 0) { const f = fn ? fn(i) : fc, g = Math.tan(PI * Math.min(Math.max(f, 5), sr * 0.45) / sr); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; }
    const x = a[i], v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3; ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    out[i] = m === 0 ? v2 : m === 1 ? k * v1 : m === 2 ? x - k * v1 - v2 : x - k * v1;
  }
  return out;
}
/** Feedback comb (fb) / feed-forward mix. delay in seconds. */
export function combFilter(a, sr, delay, fb = 0.5, damp = 0) { const D = Math.max(1, Math.round(delay * sr)), buf = new Float32Array(D); let p = 0, lp = 0; for (let i = 0; i < a.length; i++) { const o = buf[p]; lp = o * (1 - damp) + lp * damp; buf[p] = a[i] + lp * fb; a[i] += o; if (++p >= D) p = 0; } return a; }
export function allpass(a, sr, delay, g = 0.5) { const D = Math.max(1, Math.round(delay * sr)), buf = new Float32Array(D); let p = 0; for (let i = 0; i < a.length; i++) { const bo = buf[p], x = a[i]; a[i] = bo - x * g; buf[p] = x + bo * g; if (++p >= D) p = 0; } return a; }
/** tanh saturation with makeup so small signals keep their level. */
export function saturate(a, drive = 2) { const inv = 1 / Math.tanh(drive); for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * drive) * inv; return a; }
export function foldback(a, k = 2) { for (let i = 0; i < a.length; i++) { let x = a[i] * k; while (x > 1 || x < -1) x = x > 1 ? 2 - x : -2 - x; a[i] = x; } return a; }
export function bitcrush(a, bits = 6, hold = 1) { const q = Math.pow(2, bits - 1); let h = 0, c = 0; for (let i = 0; i < a.length; i++) { if (c-- <= 0) { h = Math.round(a[i] * q) / q; c = hold - 1; } a[i] = h; } return a; }
/** Soft envelope follower-based compression (feed-forward, peak); returns same array. */
export function compress(a, sr, thr = 0.3, ratio = 4, att = 0.002, rel = 0.08) { const ka = Math.exp(-1 / (att * sr)), kr = Math.exp(-1 / (rel * sr)); let e = 0; for (let i = 0; i < a.length; i++) { const x = Math.abs(a[i]); e = x > e ? ka * e + (1 - ka) * x : kr * e + (1 - kr) * x; const g = e > thr ? Math.pow(e / thr, 1 / ratio - 1) : 1; a[i] *= g; } return a; }

// ---------------------------------------------------------------------------------------------- envelopes
/** Multiply by attack(ramp, smooth)+exponential decay. tau = time constant (s) of the decay after `hold`. */
export function envelope(a, sr, { atk = 0.001, hold = 0, tau = 0.1, start = 0 } = {}) {
  const i0 = Math.round(start * sr), na = Math.max(1, Math.round(atk * sr)), nh = Math.round(hold * sr), k = Math.exp(-1 / (Math.max(1e-5, tau) * sr)); let e = 1;
  for (let i = 0; i < a.length; i++) { const j = i - i0; if (j < 0) { a[i] = 0; continue; } if (j < na) { const s = j / na; a[i] *= s * s * (3 - 2 * s); } else if (j < na + nh) { /* hold */ } else { e *= k; a[i] *= e; } }
  return a;
}
/** Piecewise-linear gain curve [[tSec, g], ...] applied in place. */
export function curveEnv(a, sr, pts) { let j = 0; for (let i = 0; i < a.length; i++) { const t = i / sr; while (j < pts.length - 2 && t > pts[j + 1][0]) j++; const p0 = pts[j], p1 = pts[Math.min(j + 1, pts.length - 1)], u = p1[0] > p0[0] ? clamp((t - p0[0]) / (p1[0] - p0[0])) : 1; a[i] *= p0[1] + (p1[1] - p0[1]) * u; } return a; }

// ---------------------------------------------------------------------------------------------- generators
/** Filtered noise burst with attack/decay envelope. opts: color atk hold tau lp hp bp q order gain rng */
export function burst(sr, dur, o = {}) {
  const n = Math.max(2, Math.ceil(dur * sr)), a = noiseArray(n, o.rng || _rng, o.color || 'white');
  envelope(a, sr, { atk: o.atk ?? 0.0004, hold: o.hold ?? 0, tau: o.tau ?? dur / 4 });
  if (o.gain !== undefined && o.gain !== 1) scaleBy(a, o.gain);
  if (o.hp) highpass(a, o.hp, sr, o.hpOrder || 2);
  if (o.lp) lowpass(a, o.lp, sr, o.order || 2);
  if (o.bp) bandpass(a, o.bp, o.q ?? 1, sr);
  return a;
}
/** Pure/harmonic tone with optional glide f0->f1 (exp), harmonic amplitudes h[k], vibrato, attack, exp decay. */
export function tone(sr, dur, f0, o = {}) {
  const n = Math.ceil(dur * sr), a = new Float32Array(n), f1 = o.f1 ?? f0, h = o.harm || [1], nh = h.length, vibD = o.vib || 0, vibF = o.vibHz || 5.5, na = Math.max(1, Math.round((o.atk ?? 0.005) * sr)), k = Math.exp(-1 / ((o.tau ?? dur) * sr)), kg = o.glideTau ? Math.exp(-1 / (o.glideTau * sr)) : 1;
  let ph = o.phase || 0, e = 1, fc = f0; const rel = o.rel ? Math.round(o.rel * sr) : 0;
  for (let i = 0; i < n; i++) {
    if (kg !== 1) fc = f1 + (fc - f1) * kg; else fc = f0 + (f1 - f0) * (i / n);
    const fv = fc * (1 + vibD * fsin(TAU * vibF * i / sr)); ph += TAU * fv / sr; if (ph > 256) ph -= Math.floor(ph / TAU) * TAU;
    let s = 0; for (let j = 0; j < nh; j++) { if (fv * (j + 1) > sr * 0.45) break; s += h[j] * fsin(ph * (j + 1)); }
    e *= k; let m = i < na ? i / na : 1; if (rel && i > n - rel) m *= (n - i) / rel; a[i] = s * e * m;
  }
  return a;
}
/** Sine sweep from f0 to f1 (exponential in time-constant tauF) — kicks, thumps, blips, laser zaps. */
export function thump(sr, dur, f0, f1, tauF, tauA, o = {}) {
  const n = Math.ceil(dur * sr), a = new Float32Array(n), kf = Math.exp(-1 / (tauF * sr)), ka = Math.exp(-1 / (tauA * sr)), na = Math.max(1, Math.round((o.atk ?? 0.0008) * sr)); let ph = o.phase || 0, f = f0 - f1, e = 1;
  for (let i = 0; i < n; i++) { ph += TAU * (f1 + f) / sr; f *= kf; e *= ka; a[i] = fsin(ph) * e * (i < na ? i / na : 1); }
  if (o.drive) saturate(a, o.drive);
  return a;
}
/** Frequency sweep of arbitrary shape via fn(u in 0..1)->Hz, with harmonic list and amplitude fn. */
export function sweep(sr, dur, fn, o = {}) {
  const n = Math.ceil(dur * sr), a = new Float32Array(n), h = o.harm || [1], amp = o.amp || null, na = Math.max(1, Math.round((o.atk ?? 0.004) * sr)), nr = Math.max(1, Math.round((o.rel ?? 0.01) * sr)); let ph = 0;
  for (let i = 0; i < n; i++) { const u = i / n, f = fn(u); ph += TAU * f / sr; if (ph > 256) ph -= Math.floor(ph / TAU) * TAU; let s = 0; for (let j = 0; j < h.length; j++) { if (f * (j + 1) > sr * 0.45) break; s += h[j] * fsin(ph * (j + 1)); } let m = amp ? amp(u) : 1; if (i < na) m *= i / na; if (n - i < nr) m *= (n - i) / nr; a[i] = s * m; }
  return a;
}
function polyblep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
/** Band-limited (PolyBLEP) saw / pulse. freq: Hz or (i)=>Hz. shape: 'saw' | 'pulse' (pw). */
export function bandlimited(sr, dur, freq, o = {}) {
  const n = Math.ceil(dur * sr), a = new Float32Array(n), fn = typeof freq === 'function' ? freq : null, pulse = o.shape === 'pulse'; let ph = o.phase || 0; const pwFn = typeof o.pw === 'function' ? o.pw : null;
  for (let i = 0; i < n; i++) { const f = fn ? fn(i) : freq, dt = f / sr; ph += dt; if (ph >= 1) ph -= 1; if (pulse) { const pw = pwFn ? pwFn(i) : (o.pw ?? 0.5); let v = ph < pw ? 1 : -1; v += polyblep(ph, dt); v -= polyblep((ph + (1 - pw)) % 1, dt); a[i] = v; } else a[i] = 2 * ph - 1 - polyblep(ph, dt); }
  return a;
}
/** Two-operator FM voice: sin(2pi fc t + I(t) sin(2pi fc*ratio t)); I decays with idxTau, amplitude with tau. */
export function fmTone(sr, dur, fc, ratio, index, o = {}) {
  const n = Math.ceil(dur * sr), a = new Float32Array(n), wc = TAU * fc / sr, wm = TAU * fc * ratio / sr, ki = Math.exp(-1 / ((o.idxTau ?? 0.25) * sr)), ka = Math.exp(-1 / ((o.tau ?? 0.4) * sr)), na = Math.max(1, Math.round((o.atk ?? 0.002) * sr)), fb = o.feedback || 0; let pc = 0, pm = 0, I = index, A = 1, y1 = 0;
  for (let i = 0; i < n; i++) { pc += wc * (o.bend ? 1 + o.bend * i / n : 1); pm += wm; if (pc > TAU) pc -= TAU; if (pm > TAU) pm -= TAU; const y = fsin(pc + I * fsin(pm + fb * y1)); y1 = y; a[i] = y * A * (i < na ? i / na : 1); I *= ki; A *= ka; }
  return a;
}
/** Struck-object resonator bank: partials [[freqHz, amp, tauSec]...]; contact softness `soft` (s) rolls off high partials. Returns Float32Array(n). */
export function ringBank(n, sr, partials, { phase = PI / 2, soft = 0, out = null, gain = 1, delay = 0, detune = 0, rng = _rng } = {}) {
  const y = out || new Float32Array(n), off = Math.round(delay * sr);
  for (let p = 0; p < partials.length; p++) {
    const P = partials[p]; let f = Array.isArray(P) ? P[0] : P.f, a = (Array.isArray(P) ? P[1] : P.a) * gain; const tau = Array.isArray(P) ? P[2] : P.d;
    if (detune) f *= 1 + detune * (rng.next() * 2 - 1);
    if (f >= sr * 0.48 || a === 0 || tau <= 0) continue;
    if (soft > 0) { const u = PI * f * soft; a /= 1 + u * u; }
    const w = TAU * f / sr, R = Math.exp(-1 / (tau * sr)), c1 = 2 * R * Math.cos(w), c2 = -R * R, len = Math.min(n - off, Math.ceil(tau * sr * 13.8));
    let y2 = a * Math.sin(phase), y1 = a * R * Math.sin(w + phase); if (len > 0) y[off] += y2; if (len > 1) y[off + 1] += y1;
    for (let i = 2; i < len; i++) { const v = c1 * y1 + c2 * y2; y[off + i] += v; y2 = y1; y1 = v; }
  }
  return y;
}
/** Bell partial series (church/hand bell: hum, prime, tierce, quint, nominal...) as [ratio, amp, decayMul]. */
export const BELL = [[0.5, 0.75, 1.6], [1, 1, 1.2], [1.19, 0.65, 1], [1.5, 0.5, 0.8], [2, 0.7, 0.6], [2.5, 0.35, 0.5], [2.74, 0.3, 0.42], [3, 0.3, 0.38], [4.07, 0.22, 0.28], [5.43, 0.15, 0.2]];
/** Music-box / comb tine: cantilever beam modes 1 : 6.27 : 17.55 : 34.4 */
export const TINE = [[1, 1, 1], [6.267, 0.35, 0.35], [17.55, 0.12, 0.12], [34.4, 0.04, 0.05]];
/** Free-free bar / marimba-ish and steel plate partial sets. */
export const BAR = [[1, 1, 1], [2.76, 0.5, 0.5], [5.4, 0.25, 0.3], [8.93, 0.12, 0.2]];
export const PLATE = [[1, 1, 1], [1.59, 0.8, 0.9], [2.14, 0.7, 0.8], [2.65, 0.6, 0.7], [3.16, 0.5, 0.6], [4.06, 0.4, 0.5], [4.5, 0.3, 0.45], [5.15, 0.25, 0.4], [6.3, 0.2, 0.3]];
export function partialsFrom(f0, set, tau, ampMul = 1) { return set.map(([r, a, d]) => [f0 * r, a * ampMul, tau * d]); }
/** Poisson-scattered grains: rate (events/s or fn(t)), grain(rng,t)->Float32Array|null, gain fn(t, rng)->g. */
export function scatter(n, sr, rng, rate, grain, gainFn) {
  const out = new Float32Array(n), T = n / sr; let t = 0;
  for (let guard = 0; guard < 2e5; guard++) { const r = typeof rate === 'function' ? rate(t) : rate; if (r <= 1e-6) { t += 0.01; if (t >= T) break; continue; } t += -Math.log(1 - rng.next()) / r; if (t >= T) break; const g = grain(rng, t); if (g) mixInto(out, g, gainFn ? gainFn(t, rng) : 1, Math.round(t * sr)); }
  return out;
}
/** Karplus-free plucked string via modal synthesis: harmonics decay faster with number; `pos` = pluck position (0..0.5). */
export function pluck(sr, dur, f, { tau = 0.6, harmonics = 14, pos = 0.18, bright = 0.7, inharm = 0.0002, gain = 1, rng = _rng } = {}) {
  const n = Math.ceil(dur * sr), parts = [];
  for (let k = 1; k <= harmonics; k++) { const fk = f * k * Math.sqrt(1 + inharm * k * k); if (fk > sr * 0.45) break; const a = Math.abs(Math.sin(PI * k * pos)) / Math.pow(k, 1 + (1 - bright)); parts.push([fk, a, tau / (1 + 0.55 * (k - 1) * (1.2 - bright))]); }
  const y = ringBank(n, sr, parts, { phase: PI / 2 * 0 + 1.1, gain }); return y;
}

// ---------------------------------------------------------------------------------------------- reverb baked into a sound
/** Freeverb-style Schroeder-Moorer reverb applied offline; returns a LONGER array (dry + tail). rt (s), damp 0..1, wet 0..1 relative RMS. */
export function reverbBake(a, sr, { rt = 1.6, damp = 0.35, wet = 0.3, pre = 0.01, tail = null } = {}) {
  const T = tail ?? rt * 0.75, n = a.length + Math.ceil((T + pre) * sr), out = new Float32Array(n), scale = sr / 44100;
  const cl = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * scale)), al = [556, 441, 341, 225].map((d) => Math.round(d * scale));
  const cb = cl.map((d) => new Float32Array(d)), cp = new Int32Array(cl.length), cs = new Float64Array(cl.length), cf = cl.map((d) => Math.pow(10, -3 * d / (rt * sr)));
  const ab = al.map((d) => new Float32Array(d)), ap = new Int32Array(al.length), ps = Math.round(pre * sr); const verb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i - ps >= 0 && i - ps < a.length ? a[i - ps] * 0.03 : 0; let acc = 0;
    for (let c = 0; c < cl.length; c++) { const b = cb[c], o = b[cp[c]]; cs[c] = o * (1 - damp) + cs[c] * damp; b[cp[c]] = x + cs[c] * cf[c]; if (++cp[c] >= b.length) cp[c] = 0; acc += o; }
    for (let k = 0; k < al.length; k++) { const b = ab[k], bo = b[ap[k]]; const y = -acc + bo; b[ap[k]] = acc + bo * 0.5; acc = y; if (++ap[k] >= b.length) ap[k] = 0; }
    verb[i] = acc;
  }
  const ra = rmsOf(a) || 1e-6, rv = rmsOf(verb) || 1e-6, g = wet * ra / rv * 1.0;
  for (let i = 0; i < n; i++) out[i] = (i < a.length ? a[i] : 0) + verb[i] * g;
  return out;
}

// ---------------------------------------------------------------------------------------------- buffer output
/** Float32Array | [L,R] -> AudioBuffer. */
export function toBuffer(ctx, data, sr = ctx.sampleRate) {
  const ch = Array.isArray(data) ? data : [data], b = ctx.createBuffer(ch.length, ch[0].length, sr);
  for (let c = 0; c < ch.length; c++) { if (b.copyToChannel) b.copyToChannel(ch[c], c); else b.getChannelData(c).set(ch[c]); }
  return b;
}
/** In-place finishing of raw channel data (Float32Array | [L,R]): DC block, edge fades, peak-normalise. Returns the channel array list (used by workers, which have no AudioBuffer). */
export function finishData(data, { peak = 0.9, fadeIn = 0.0004, fadeOut = 0.004, dc = true, sr = 48000, normalize = true } = {}) {
  const ch = Array.isArray(data) ? data : [data]; let mx = 0; for (const a of ch) { if (dc) dcBlock(a, sr, 10); fadeEdges(a, Math.round(fadeIn * sr), Math.round(fadeOut * sr)); mx = Math.max(mx, peakOf(a)); }
  if (normalize && mx > 1e-9) for (const a of ch) scaleBy(a, peak / mx);
  return ch;
}
/** Finish a sound: DC block, fade edges, peak-normalise (peak) and create the AudioBuffer. */
export function finish(ctx, data, { sr = ctx.sampleRate, ...o } = {}) { return toBuffer(ctx, finishData(data, { sr, ...o }), sr); }

// ---------------------------------------------------------------------------------------------- room impulse responses
/**
 * Room impulse response generator (yields between stages so it can be time-sliced). Energy-normalised: sum(h^2)=1 per channel, so the wet
 * level in the engine is set purely by the send gain. spec:
 *  rt60 (s, mids), damping 0..1 (HF decay speed), lfMul (LF RT multiplier), predelay (s), lowCut (Hz), eq [lo,mid,hi1,hi2] tail balance, build (s) onset,
 *  mix (s) echo-density build-up (sparse early tail), density (<1 drops samples), echoGain (scale of discrete echoes; 1 = each echo carries the energy of 50 ms of tail),
 *  early [[delay, gain, lpHz?, lenSec?]] impulse-like taps (crisp copies of the source), echoes [[delay, gain, lpHz, lenSec]] smeared discrete bursts (shaft/canyon), flutter {period, decay, gain, lp, jitter, count},
 *  ring [[freq, amp, tau]] metallic modes, width 0..1 (L/R decorrelation), seed.
 */
export function* irGen(sr, spec = {}) {
  const S = Object.assign({ rt60: 1.5, damping: 0.5, predelay: 0.01, early: [], density: 1, lowCut: 60, lfMul: 1.15, eq: [1, 1, 0.75, 0.45], build: 0.012, mix: 0.05, echoGain: 1, echoes: null, flutter: null, ring: null, width: 1, seed: 1, hfMul: null }, spec);
  const pre = Math.floor(S.predelay * sr), rts = [S.rt60 * S.lfMul, S.rt60, S.rt60 / (1 + 1.7 * S.damping), S.rt60 / (1 + 4.5 * S.damping)];
  if (S.hfMul) { rts[2] = S.rt60 * S.hfMul[0]; rts[3] = S.rt60 * S.hfMul[1]; }
  const tail = Math.ceil(Math.min(7, Math.max(...rts) * 0.86 + 0.03) * sr), N = pre + tail, // tail cut at ~-50 dB: inaudible, and ConvolverNode.buffer assignment cost is proportional to IR length
     out = [new Float32Array(N), new Float32Array(N)];
  const kEnv = rts.map((r) => Math.exp(-6.9078 / (r * sr))), common = S.width < 1 ? noiseArray(tail, new Rng(S.seed * 31 + 5), 'pink') : null;
  for (let c = 0; c < 2; c++) {
    const rng = new Rng((S.seed * 2654435761 + c * 40503 + 17) >>> 0), d = out[c];
    let base = noiseArray(tail, rng, 'pink'); if (common) { const w = S.width; for (let i = 0; i < tail; i++) base[i] = base[i] * w + common[i] * (1 - w); }
    const r0 = rmsOf(base) || 1; scaleBy(base, 1 / r0); yield;
    const lo = base.slice(); biquadInPlace(lo, 'lp', 200, 0.7071, sr); biquadInPlace(lo, 'lp', 200, 0.7071, sr); for (let i = 0; i < tail; i++) base[i] -= lo[i];
    const mid = base.slice(); biquadInPlace(mid, 'lp', 2000, 0.7071, sr); for (let i = 0; i < tail; i++) base[i] -= mid[i];
    const h1 = base.slice(); biquadInPlace(h1, 'lp', 6500, 0.7071, sr); for (let i = 0; i < tail; i++) base[i] -= h1[i]; yield;
    let e0 = S.eq[0], e1 = S.eq[1], e2 = S.eq[2], e3 = S.eq[3]; const mixN = Math.max(1, Math.round(S.mix * sr)), buildN = Math.round(S.build * sr * 6);
    for (let i = 0; i < tail; i++) {
      let v = lo[i] * e0 + mid[i] * e1 + h1[i] * e2 + base[i] * e3; e0 *= kEnv[0]; e1 *= kEnv[1]; e2 *= kEnv[2]; e3 *= kEnv[3];
      if (i < buildN) v *= 1 - Math.exp(-i / (S.build * sr));
      if (i < mixN) { const p = Math.pow(i / mixN, 1.6); if (rng.next() > p) v = 0; else v /= Math.sqrt(Math.max(p, 0.05)); }
      if (S.density < 1) { if (rng.next() > S.density) v = 0; else v /= Math.sqrt(S.density); }
      d[pre + i] = v;
    }
    yield;
    const burstAt = (delaySec, g, lp, lenSec) => {
      const k0 = pre + Math.round((delaySec + (c ? 0.00113 : 0)) * sr), len = Math.max(3, Math.round(lenSec * sr)); if (k0 + len >= N) return;
      // g = energy of this echo relative to the diffuse tail's energy in a 50 ms window at the same time (g=1: as strong as 50 ms of tail)
      const lvl = g * S.echoGain * Math.sqrt(0.05 * sr) * Math.exp(-6.9078 * delaySec / rts[1]), b = new Float32Array(len); let e = 1, E = 0; const kk = Math.exp(-3 / len);
      for (let i = 0; i < len; i++) { b[i] = (rng.next() * 2 - 1) * e; e *= kk; }
      if (lp) biquadInPlace(b, 'lp', lp, 0.7071, sr); for (let i = 0; i < len; i++) E += b[i] * b[i]; const sc = lvl / Math.sqrt(E || 1); for (let i = 0; i < len; i++) d[k0 + i] += b[i] * sc;
    };
    for (const t of S.early) burstAt(t[0], t[1], t[2] ?? 7000, t[3] ?? 0.0012);
    if (S.echoes) for (const t of S.echoes) burstAt(t[0], t[1], t[2] ?? 3500, t[3] ?? 0.012);
    if (S.flutter) { const F = Object.assign({ period: 0.02, decay: 0.8, gain: 0.7, lp: 8000, jitter: 0.03, count: 60, start: 0, len: 0.0006 }, S.flutter); let t = F.start || F.period; for (let k = 0; k < F.count && t < S.rt60 * 1.1; k++) { burstAt(t, F.gain * Math.pow(F.decay, k), F.lp / (1 + 0.12 * k), F.len); t += F.period * (1 + F.jitter * (rng.next() * 2 - 1)); } }
    if (S.ring) for (const [f, a, rt] of S.ring) { // ring modes: 3rd value is the mode's RT60 (s)
      const tau = rt / 6.9078, ff = f * (1 + (c ? 0.0021 : 0)), w = TAU * ff / sr, R = Math.exp(-1 / (tau * sr)), c1 = 2 * R * Math.cos(w), c2 = -R * R, len = Math.min(tail, Math.ceil(tau * sr * 9)), ph = c * 1.3 + f, att = 0.004 * sr;
      let y2 = a * Math.sin(ph), y1 = a * R * Math.sin(w + ph);
      for (let i = 0; i < len; i++) { let y; if (i === 0) y = y2; else if (i === 1) y = y1; else { y = c1 * y1 + c2 * y2; y2 = y1; y1 = y; } d[pre + i] += y * Math.min(1, i / att) * 0.5; }
    }
    biquadInPlace(d, 'hp', S.lowCut, 0.6, sr); yield;
  }
  // level: normalise so the 250 Hz..4 kHz band passes energy exactly like a unit-energy white IR would (band fraction of Nyquist). Then `wet` in the space table is a
  // true reverb-to-direct energy ratio for speech/foley-band content, independent of the IR's spectral tilt (a pink, LF-heavy IR would otherwise be far too loud).
  let Eb = 0; for (let c = 0; c < 2; c++) { const t = Float32Array.from(out[c]); biquadInPlace(t, 'hp', 250, 0.7071, sr); biquadInPlace(t, 'lp', 4000, 0.7071, sr); for (let i = 0; i < N; i++) Eb += t[i] * t[i]; yield; }
  const frac = (4000 - 250) / (sr / 2), g = Math.sqrt(frac / (Eb / 2 || 1e-12));
  scaleBy(out[0], g); scaleBy(out[1], g);
  return out;
}
/** Convolution reverb impulse response: rt60 seconds, damping (0..1 high-frequency decay speed), predelay s, early reflection taps [[delay s, gain]...], stereo decorrelated.
 *  Extended (see irGen): lfMul, echoes, flutter, ring, eq, mix, build, echoDb, width, seed. */
export function impulseResponse(ctx, spec = {}) {
  const sr = spec.sr || ctx.sampleRate, it = irGen(sr, spec); let r = it.next(); while (!r.done) r = it.next();
  return toBuffer(ctx, r.value, sr);
}

// ---------------------------------------------------------------------------------------------- kit (sr-bound convenience)
/** kit(ctx|sr, seed) -> object with all generators bound to the sample rate and a private RNG. Sound definitions use it. */
export function kit(ctxOrSr, seed = 1, outCtx = null) {
  const sr = typeof ctxOrSr === 'number' ? ctxOrSr : ctxOrSr.sampleRate, ctx = typeof ctxOrSr === 'number' ? outCtx : ctxOrSr, rng = new Rng(seed);
  const K = {
    sr, ctx, rng, TAU, PI,
    seed(s) { rng.s = (s >>> 0) || 1; return K; },
    n: (sec) => Math.max(1, Math.ceil(sec * sr)),
    buf: (sec) => new Float32Array(Math.max(1, Math.ceil(sec * sr))),
    noise: (sec, color = 'white') => noiseArray(Math.max(1, Math.ceil(sec * sr)), rng, color),
    burst: (sec, o = {}) => burst(sr, sec, { rng, ...o }),
    tone: (sec, f, o) => tone(sr, sec, f, o),
    thump: (sec, f0, f1, tauF, tauA, o) => thump(sr, sec, f0, f1, tauF, tauA, o),
    sweep: (sec, fn, o) => sweep(sr, sec, fn, o),
    saw: (sec, f, o) => bandlimited(sr, sec, f, o),
    pulse: (sec, f, o) => bandlimited(sr, sec, f, { ...o, shape: 'pulse' }),
    fm: (sec, fc, ratio, index, o) => fmTone(sr, sec, fc, ratio, index, o),
    ring: (sec, partials, o) => ringBank(Math.ceil(sec * sr), sr, partials, { rng, ...o }),
    pluck: (sec, f, o) => pluck(sr, sec, f, { rng, ...o }),
    scatter: (sec, rate, grain, gainFn) => scatter(Math.ceil(sec * sr), sr, rng, rate, grain, gainFn),
    mix: (dst, src, g = 1, tSec = 0) => mixInto(dst, src, g, Math.round(tSec * sr)),
    lp: (a, f, order) => lowpass(a, f, sr, order), hp: (a, f, order) => highpass(a, f, sr, order), bp: (a, f, q = 1) => bandpass(a, f, q, sr),
    notch: (a, f, q = 2) => biquadInPlace(a, 'notch', f, q, sr), peak: (a, f, q, db) => biquadInPlace(a, 'peak', f, q, sr, db),
    lowshelf: (a, f, db) => biquadInPlace(a, 'lowshelf', f, 0.7, sr, db), highshelf: (a, f, db) => biquadInPlace(a, 'highshelf', f, 0.7, sr, db),
    svf: (a, mode, fc, q, out) => svf(a, sr, mode, fc, q, out), lp1: (a, f) => onePoleLP(a, sr, f), hp1: (a, f) => onePoleHP(a, sr, f),
    comb: (a, delay, fb, damp) => combFilter(a, sr, delay, fb, damp), allpass: (a, delay, g) => allpass(a, sr, delay, g),
    sat: saturate, fold: foldback, crush: bitcrush, comp: (a, thr, ratio, att, rel) => compress(a, sr, thr, ratio, att, rel),
    env: (a, o) => envelope(a, sr, o), curve: (a, pts) => curveEnv(a, sr, pts), verb: (a, o) => reverbBake(a, sr, o),
    scale: scaleBy, norm: normalizeTo, peakOf, rmsOf, fade: (a, i, o) => fadeEdges(a, Math.round(i * sr), Math.round(o * sr)), reverse: reverseArr, resample, makeLoop: (a, xfSec) => makeLoop(a, Math.round(xfSec * sr)),
    delay: (a, sec) => { const s = Math.round(sec * sr), o = new Float32Array(a.length + s); o.set(a, s); return o; },
    stereo: (a, { width = 0.4, delay = 0.0007 } = {}) => { const d = Math.round(delay * sr), L = new Float32Array(a.length + d), R = new Float32Array(a.length + d); for (let i = 0; i < a.length; i++) { L[i] += a[i]; R[i + d] += a[i]; } if (width < 1) { for (let i = 0; i < L.length; i++) { const m = (L[i] + R[i]) * 0.5; L[i] = m + (L[i] - m) * width; R[i] = m + (R[i] - m) * width; } } return [L, R]; },
    out: (data, o = {}) => finish(ctx, data, { sr, ...o }), toBuffer: (data) => toBuffer(ctx, data, sr),
    partials: partialsFrom, hz: midiHz, db: dbToGain, clamp, lerp, smooth,
    /** build long, low-passed material cheaply: fn(K2) runs at sr/div (K2 is a kit at the lower rate) and the result is upsampled (cubic). */
    low: (div, fn) => { const K2 = kit(sr / div, (rng.next() * 4294967296) >>> 0, ctx); return resample(fn(K2), 1 / div); },
  };
  return K;
}
