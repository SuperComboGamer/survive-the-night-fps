// Source-filter vocal synthesis (formant synthesiser): glottal-flow-derivative pulse train (jitter, shimmer, subharmonic period doubling, vibrato, growl AM)
// + aspiration noise -> cascade of time-varying formant resonators (F1..F3 sweep, fixed F4/F5) -> rasp waveshaping / gargle / muffled-head resonator.
// Used for zombie voices, player grunts/breath, teddy giggle, and animal-like ambience (wolf, crow, gull, distant screams).
import * as dsp from '../dsp.js';
const TAU = Math.PI * 2;

/** neutral adult-male vowel formants (Hz): F1, F2, F3 */
export const VOWELS = { a: [730, 1090, 2440], ae: [660, 1720, 2410], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410], u: [300, 870, 2240], uh: [640, 1190, 2390], schwa: [500, 1500, 2500], er: [490, 1350, 1690], oo: [440, 1020, 2240], eh: [550, 1770, 2490] };

class Curve { // piecewise-linear curve over sorted [t, v] keyframes, evaluated with a monotone pointer (O(1) per block)
  constructor(pts) { this.p = pts; this.j = 0; }
  at(t) { const p = this.p; while (this.j < p.length - 2 && t > p[this.j + 1][0]) this.j++; const a = p[this.j], b = p[Math.min(this.j + 1, p.length - 1)], u = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 1; return a[1] + (b[1] - a[1]) * u; }
}
const tabs = new Map();
/** derivative of a Rosenberg-C glottal flow pulse over one period (open quotient oq, speed quotient ~1.5) */
function glottal(oq) {
  const key = Math.round(oq * 50); let t = tabs.get(key); if (t) return t; const N = 1024, tp = oq * 0.6, tn = oq * 0.4; t = new Float32Array(N);
  for (let j = 0; j < N; j++) { const u = j / N; t[j] = u < tp ? 0.5 * Math.PI / tp * Math.sin(Math.PI * u / tp) : u < tp + tn ? -(Math.PI / (2 * tn)) * Math.sin(Math.PI / 2 * (u - tp) / tn) : 0; }
  let m = 0; for (let j = 0; j < N; j++) m = Math.max(m, Math.abs(t[j])); for (let j = 0; j < N; j++) t[j] /= m; tabs.set(key, t); return t;
}

/**
 * spec: dur (s); f0 [[t,Hz]...]; vowels [[t,F1,F2,F3]...]; amp [[t,g]...] voicing level; asp [[t,g]...] aspiration-noise level (default breath*amp);
 * breath, open (glottal open quotient 0.4 pressed .. 0.8 breathy), jitter, shimmer, sub (period doubling 0..1) or subCurve [[t, 0..1]..] (vocal-fry bursts), vib/vibHz, growl/growlHz (AM), rasp (0..1 distortion),
 * bw [B1,B2,B3], fscale (vocal-tract scale: <1 = larger creature), fs3 [k1,k2,k3] per-formant multipliers, fixed [F4,F5], wet (gargle/bubbles/formant flutter), muffle (foam-head/box), tilt (Hz of source lowpass), noiseOnly.
 * Returns Float32Array (unnormalised peak ~ arbitrary; callers normalise).
 */
export function* synthG(sr, S, rng = new dsp.Rng(1)) {
  const n = Math.ceil(S.dur * sr), out = new Float32Array(n), BLK = 32, tab = glottal(S.open ?? 0.6), TN = tab.length;
  const cF0 = new Curve(S.f0.map(([t, f]) => [t, Math.log(f)])), cA = new Curve(S.amp), cAsp = S.asp ? new Curve(S.asp) : null, cF = [1, 2, 3].map((k) => new Curve(S.vowels.map((v) => [v[0], v[k]])));
  const fs = S.fscale ?? 1, fs3 = S.fs3 || [1, 1, 1], bw = S.bw || [70, 90, 140], fixed = S.fixed || [3350, 4500];
  const subC = S.subCurve ? new Curve(S.subCurve) : null, jit = S.jitter ?? 0.02, shim = S.shimmer ?? 0.05, sub0 = S.sub ?? 0, vibD = S.vib ?? 0.008, vibHz = S.vibHz ?? 5.2, breath = S.breath ?? 0.2, wet = S.wet ?? 0, growl = S.growl ?? 0, growlHz = S.growlHz ?? 30, rasp = S.rasp ?? 0;
  const vibPh = rng.next() * TAU, wobPh = rng.next() * TAU, tiltK = S.tilt ? 1 - Math.exp(-TAU * S.tilt / sr) : 1, oq = S.open ?? 0.6, noiseOnly = !!S.noiseOnly;
  // 5 series resonators (Klatt): y = A x + B y1 + C y2, DC gain 1. Unrolled into locals for speed.
  let A0 = 0, B0 = 0, C0 = 0, A1 = 0, B1 = 0, C1 = 0, A2 = 0, B2 = 0, C2 = 0, A3 = 0, B3 = 0, C3 = 0, A4 = 0, B4 = 0, C4 = 0, a1 = 0, a2 = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0, d1 = 0, d2 = 0, e1 = 0, e2 = 0;
  let phase = 1, T = sr / 100, cycAmp = 1, cyc = 0, tiltY = 0, aspHP = 0, ampB = 0, aspB = 0, flutter = 0, flutter2 = 0, seed = (rng.next() * 4294967295) | 1;
  const hpK = 1 - Math.exp(-TAU * 900 / sr), wetBW = 1 + wet * 1.2;
  // growl (AM) and gargle oscillators as rotating phasors
  let gc = 1, gs = 0, gcr = 1, gsr = 0, wc = 1, ws = 0, wcr = 1, wsr = 0; const gargHz = rng.range(22, 32); { const p = rng.next() * TAU; gc = Math.cos(p); gs = Math.sin(p); const q = rng.next() * TAU; wc = Math.cos(q); ws = Math.sin(q); }
  const res = (F, B) => { const r = Math.exp(-Math.PI * B / sr), b = 2 * r * Math.cos(TAU * Math.min(F, sr * 0.45) / sr), c = -r * r; return [1 - b - c, b, c]; };
  for (let i = 0; i < n; i++) {
    if ((i & (BLK - 1)) === 0) {
      const t = i / sr; ampB = cA.at(t); aspB = cAsp ? cAsp.at(t) : breath * ampB;
      if (wet > 0) { flutter += (rng.next() * 2 - 1 - flutter) * 0.25; flutter2 += (rng.next() * 2 - 1 - flutter2) * 0.2; }
      const F1 = cF[0].at(t) * fs * fs3[0] * (wet > 0 ? 1 + wet * 0.14 * flutter : 1), F2 = cF[1].at(t) * fs * fs3[1] * (wet > 0 ? 1 + wet * 0.14 * flutter2 : 1), F3 = cF[2].at(t) * fs * fs3[2];
      let r = res(F1, bw[0] * wetBW); A0 = r[0]; B0 = r[1]; C0 = r[2]; r = res(F2, bw[1] * wetBW); A1 = r[0]; B1 = r[1]; C1 = r[2]; r = res(F3, bw[2] * wetBW); A2 = r[0]; B2 = r[1]; C2 = r[2];
      if ((i & 255) === 0) { r = res(fixed[0] * fs, 260); A3 = r[0]; B3 = r[1]; C3 = r[2]; r = res(fixed[1] * fs, 260); A4 = r[0]; B4 = r[1]; C4 = r[2]; }
      if (growl > 0) { const w = TAU * growlHz * (1 + 0.12 * Math.sin(t * 6.3 + wobPh)) * BLK / sr; gcr = Math.cos(w); gsr = Math.sin(w); }
      if (wet > 0) { const w = TAU * gargHz * (1 + 0.2 * Math.sin(t * 4.1 + wobPh)) * BLK / sr; wcr = Math.cos(w); wsr = Math.sin(w); }
    }
    // glottal source (per-cycle jitter / shimmer / subharmonic)
    phase += 1 / T; if (phase >= 1) {
      phase -= 1; cyc++; let f = Math.exp(cF0.at(i / sr)) * (1 + vibD * Math.sin(TAU * vibHz * i / sr + vibPh)); f *= 1 + jit * rng.gauss() * 0.7; cycAmp = 1 + shim * rng.gauss() * 0.7; let per = sr / Math.max(30, f);
      const sub = subC ? subC.at(i / sr) : sub0; if (sub > 0 && (cyc & 1)) { cycAmp *= 1 - sub * 0.55; per *= 1 + sub * 0.07; } T = Math.max(8, per);
    }
    const gi = phase * TN, gj = gi | 0, gf = gi - gj; let g = noiseOnly ? 0 : (tab[gj] + (tab[(gj + 1) & (TN - 1)] - tab[gj]) * gf) * cycAmp * ampB;
    if (tiltK < 1) { tiltY += tiltK * (g - tiltY); g = tiltY; }
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const w = (seed | 0) * 4.656612873077393e-10; aspHP += hpK * (w - aspHP);
    const nz = (w - aspHP) * aspB * (noiseOnly ? 1 : 0.35 + 0.65 * (phase < oq ? 1 : 0.4));
    let y = g * 0.75 + nz * 0.9, yy;
    yy = A0 * y + B0 * a1 + C0 * a2; a2 = a1; a1 = yy; y = yy; yy = A1 * y + B1 * b1 + C1 * b2; b2 = b1; b1 = yy; y = yy; yy = A2 * y + B2 * c1 + C2 * c2; c2 = c1; c1 = yy; y = yy;
    yy = A3 * y + B3 * d1 + C3 * d2; d2 = d1; d1 = yy; y = yy; yy = A4 * y + B4 * e1 + C4 * e2; e2 = e1; e1 = yy; y = yy;
    if (growl > 0) { const c = gc * gcr - gs * gsr; gs = gs * gcr + gc * gsr; gc = c; const m = 0.5 + 0.5 * gs; y *= 1 - growl * m * Math.sqrt(m); }
    if (wet > 0) { const c = wc * wcr - ws * wsr; ws = ws * wcr + wc * wsr; wc = c; const m = 0.5 + 0.5 * ws; y *= 1 - wet * 0.65 * Math.sqrt(m); }
    out[i] = y;
    if ((i & 8191) === 8191) yield; // time-slice point (main-thread fallback: <= ~1 ms of work per slice)
    if ((i & 1023) === 1023) { const k = 1.5 - 0.5 * (gc * gc + gs * gs); gc *= k; gs *= k; const k2 = 1.5 - 0.5 * (wc * wc + ws * ws); wc *= k2; ws *= k2; }
  }
  yield;
  // ---- post: rasp shaper (fast rational tanh), foam-head muffling, water low-pass
  let mx = 0; for (let i = 0; i < n; i++) { const a = out[i] < 0 ? -out[i] : out[i]; if (a > mx) mx = a; } if (mx > 0) { const g = 1 / mx; for (let i = 0; i < n; i++) out[i] *= g; }
  if (rasp > 0) { const drive = 1 + 5.5 * rasp, mk = 1 + 0.25 * rasp; for (let i = 0; i < n; i++) { let x = out[i] * drive; x = x > 3 ? 3 : x < -3 ? -3 : x; out[i] = x * (27 + x * x) / (27 + 9 * x * x) * mk; } }
  if (S.muffle > 0) { const m = S.muffle; dsp.biquadInPlace(out, 'lp', 5200 - 4300 * m, 0.7, sr); dsp.biquadInPlace(out, 'peak', 300 + 60 * m, 3, sr, 11 * m); const D = Math.round(0.0016 * sr); for (let i = n - 1; i >= D; i--) out[i] += out[i - D] * 0.45 * m; }
  if (wet > 0) dsp.biquadInPlace(out, 'lp', 4200 - 1400 * Math.min(1, wet), 0.7, sr);
  return out;
}
/** synchronous variant */
export function synth(sr, S, rng) { const it = synthG(sr, S, rng); let r = it.next(); while (!r.done) r = it.next(); return r.value; }

// ------------------------------------------------------------------------------------------------ non-vocal vocalisation layers
/** water bubbles (Minnaert chirps) at `rate` per second: gargle/drowning texture */
export function bubbles(sr, dur, rate, rng, level = 1, fLo = 220, fHi = 1300) {
  const n = Math.ceil(dur * sr), o = new Float32Array(n); let t = 0;
  for (;;) { t += -Math.log(1 - rng.next()) / rate; if (t >= dur) break; const f = rng.range(fLo, fHi), tau = 0.5 / f * rng.range(6, 14), b = dsp.thump(sr, tau * 7, f, f * rng.range(1.2, 1.7), tau * 0.8, tau, { atk: 0.001 }); dsp.mixInto(o, b, level * rng.range(0.25, 1), Math.round(t * sr)); }
  return o;
}
/** teeth chatter / shivering: clicks at `hz` with jittered timing, each a short resonant burst */
export function chatter(sr, dur, hz, rng, level = 1) {
  const n = Math.ceil(dur * sr), o = new Float32Array(n); let t = rng.range(0, 1 / hz);
  while (t < dur) { const f = rng.range(2200, 3800), b = dsp.ringBank(Math.ceil(0.02 * sr), sr, [[f, 1, 0.003], [f * 1.9, 0.5, 0.002], [700, 0.6, 0.004]]); const nb = dsp.burst(sr, 0.004, { rng, tau: 0.001, hp: 1500 }); dsp.mixInto(o, b, level * rng.range(0.5, 1), Math.round(t * sr)); dsp.mixInto(o, nb, level * 0.5, Math.round(t * sr)); t += (1 / hz) * (1 + 0.25 * rng.sym()); }
  return o;
}
/** breathy wheeze / gasp through a narrowed airway: noise with sweeping narrow resonances */
export function wheeze(sr, dur, f0, f1, rng, level = 1, q = 6) {
  const n = Math.ceil(dur * sr), a = dsp.noiseArray(n, rng, 'white'); dsp.svf(a, sr, 'bp', (i) => f0 + (f1 - f0) * i / n, q); const nn = a.length; for (let i = 0; i < nn; i++) { const u = i / nn; a[i] *= level * Math.sin(Math.PI * Math.pow(u, 0.7)); } return a;
}
