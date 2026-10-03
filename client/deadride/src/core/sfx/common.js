// Shared building blocks for the procedural sound library (all take a dsp kit K).
import * as dsp from '../dsp.js';
export const { PLATE, BELL, TINE, BAR, partialsFrom } = dsp;

/** tiny resonant click: frequency f (Hz), decay tau (s) — the atom of crunch/gravel/glass/debris textures */
export const grain = (K, f, tau, a = 1) => K.ring(tau * 6 + 0.0005, [[f, a, tau]]);
/** Poisson cloud of grains: rate0 events/s decaying with tauR (s); grain freq lo..hi, decay t1..t2, level amp. Grains are drawn from a pool of pre-built templates (fast, and indistinguishable in noisy textures). */
export const crunch = (K, dur, rate0, tauR, lo, hi, t1, t2, amp = 1) => { const pool = Array.from({ length: 10 }, () => grain(K, K.rng.range(lo, hi), K.rng.range(t1, t2), 1)); return K.scatter(dur, (t) => rate0 * Math.exp(-t / tauR), (rng) => pool[(rng.next() * 10) | 0], (t, rng) => amp * rng.range(0.35, 1)); };
/** Poisson cloud from an arbitrary template pool: rate(t), pool of Float32Arrays, level */
export const cloud = (K, dur, rate, pool, amp = 1) => K.scatter(dur, rate, (rng) => pool[(rng.next() * pool.length) | 0], (t, rng) => amp * rng.range(0.3, 1));
/** Minnaert bubble: sine that rises `up`x while it decays (tau s) — drips, splashes, gurgles, boiling */
export const bubble = (K, f, tau, up = 1.35) => K.thump(tau * 7, f, f * up, tau * 0.8, tau, { atk: 0.0015 });
/** mix a list of [array, gain, timeSec] layers */
export const layers = (K, s, list) => { for (const [a, g, t] of list) K.mix(s, a, g, t || 0); return s; };
/** filtered-noise swish with a moving band-pass centre (Hz from f0 to f1 over the sound), envelope attack/tau */
export function swish(K, dur, f0, f1, q = 1.2, o = {}) {
  const n = K.n(dur), a = K.noise(dur, o.color || 'pink'); K.env(a, { atk: o.atk ?? dur * 0.25, tau: o.tau ?? dur * 0.35 });
  return K.svf(a, 'bp', (i) => f0 + (f1 - f0) * Math.min(1, i / n), q);
}
/** stick-slip friction squeal/creak: pitch contour fn(u), harmonics, AM at `slip` Hz with irregularity (wood/metal creaks, rope, hinges, brakes) */
export function creak(K, dur, f0, f1, { slip = 40, harm = [1, 0.7, 0.45, 0.3, 0.2], irregular = 0.5, noise = 0.15, atk = 0.03, rel = 0.05, curve = 1 } = {}) {
  const n = K.n(dur), r = K.rng, a = new Float32Array(n); let ph = 0, sl = 0, g = 0.6, jit = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, f = (f0 + (f1 - f0) * Math.pow(u, curve)) * (1 + jit); ph += dsp.TAU * f / K.sr; if (ph > 256) ph -= Math.floor(ph / dsp.TAU) * dsp.TAU;
    sl += slip * (1 + irregular * 0.6 * Math.sin(i * 0.0009 + r.next() * 0.02)) / K.sr; if (sl >= 1) { sl -= 1; g = 0.35 + 0.65 * r.next(); jit = (r.next() - 0.5) * 0.05 * irregular; }
    let v = 0; for (let j = 0; j < harm.length; j++) { if (f * (j + 1) > K.sr * 0.45) break; v += harm[j] * dsp.fsin(ph * (j + 1)); }
    const slipEnv = 0.45 + 0.55 * Math.pow(Math.max(0, dsp.fsin(Math.PI * sl)), 0.7); a[i] = (v + noise * (r.next() * 2 - 1) * 2) * slipEnv * g;
  }
  return K.env(a, { atk, tau: dur * 4, hold: dur - rel - atk }) && fadeTail(K, a, rel);
}
export function fadeTail(K, a, sec) { const n = Math.min(a.length, Math.round(sec * K.sr)); for (let i = 0; i < n; i++) a[a.length - 1 - i] *= i / n; return a; }
/** N-wave / hard impulse: extremely short broadband click with optional low-pass */
export const click = (K, lp = 12000, len = 0.0006) => K.burst(len, { atk: 0.00003, tau: len / 3, lp });
/** soft-onset random walk (0..1) control curve of `n` samples: used for wobble/gust envelopes. Returns Float32Array. */
export function wander(K, n, rateHz, depth = 1, smoothHz = null) {
  const a = new Float32Array(n), r = K.rng, step = Math.max(1, Math.round(K.sr / rateHz)); let p = r.next(), q = r.next();
  for (let i = 0; i < n; i++) { if (i % step === 0) { p = q; q = r.next(); } const u = (i % step) / step, s = u * u * (3 - 2 * u); a[i] = (p + (q - p) * s); }
  return a;
}
export const sec = (K, a) => a.length / K.sr;

/** circular mix (wraps around the end) — for seamless loops with ringing tails */
export function circMix(dst, src, gain = 1, at = 0) { const n = dst.length; at = ((at % n) + n) % n; for (let i = 0; i < src.length; i++) { let j = at + i; if (j >= n) j -= n * Math.floor(j / n); dst[j] += src[i] * gain; } return dst; }
/** seamless noise loop of length L seconds: colour noise -> fn(array) filtering -> equal-power seam crossfade; then periodic modulators [{cycles, depth, phase}] (integer cycles per loop stay seamless) */
export function loopNoise(K, L, color, fn, mods = []) {
  const xf = Math.min(0.5, L * 0.12), a = K.noise(L + xf, color); if (fn) fn(a); const o = K.makeLoop(a, xf), n = o.length;
  for (const m of mods) { const w = 6.283185307 * m.cycles / n, ph = m.phase ?? K.rng.next() * 6.28; for (let i = 0; i < n; i++) o[i] *= 1 - m.depth + m.depth * (0.5 + 0.5 * dsp.fsin(w * i + ph)); }
  return o;
}
/** periodic harmonic stack: base frequency f0 quantised so an integer number of cycles fits in L; partials [[ratio, amp]]. Uses one shared sine table (index arithmetic) — ~5x cheaper than Math.sin per sample. */
export function loopTones(K, L, f0, partials, { beat = 0, beatAmp = 0.4 } = {}) {
  const n = K.n(L), o = new Float32Array(n), cyc = Math.max(1, Math.round(f0 * L)), tab = loopTones._tab && loopTones._tab.length === n ? loopTones._tab : (loopTones._tab = (() => { const t = new Float32Array(n), w = 6.283185307179586 / n; for (let i = 0; i < n; i++) t[i] = Math.sin(w * i); return t; })());
  const add = (k, a) => { if (k / L > K.sr * 0.45 || k <= 0) return; let idx = (K.rng.next() * n) | 0; for (let i = 0; i < n; i++) { o[i] += a * tab[idx]; idx += k; if (idx >= n) idx -= n; while (idx >= n) idx -= n; } };
  for (const [r, a] of partials) { const k = Math.round(cyc * r); add(k, a); if (beat) add(k + Math.max(1, Math.round(beat * L)), a * beatAmp); }
  return o;
}
/** marine/stationary diesel: exhaust pulse train (integer pulses per loop), block knock, valve ticks, turbo whine, mechanical hash. */
export function* diesel(K, L, firingHz, level = 1) {
  const n = K.n(L), s = new Float32Array(n), R = K.rng, N = Math.round(firingHz * L), thp = K.thump(0.09, 105, 62, 0.02, 0.028, { drive: 1.2 }), tick = K.burst(0.006, { atk: 0.00005, tau: 0.0015, hp: 1500, lp: 6000 }), knock = K.ring(0.05, [[190, 1, 0.012], [420, 0.7, 0.008], [900, 0.4, 0.005], [1700, 0.2, 0.004]], { soft: 0.0004 }), puff = K.burst(0.05, { color: 'pink', atk: 0.002, tau: 0.014, bp: 700, q: 0.7 });
  for (let k = 0; k < N; k++) { const at = Math.round((k + R.range(-0.08, 0.08)) / N * n), a = R.range(0.65, 1.0) * (k % 6 === 3 ? 0.75 : 1); circMix(s, thp, a * level * 0.7, at); circMix(s, knock, 0.5 * a, at + Math.round(0.002 * K.sr)); circMix(s, tick, 0.35 * a, at + Math.round(0.011 * K.sr)); circMix(s, puff, 0.6 * a, at); if ((k & 15) === 15) yield; }
  const bed = loopNoise(K, L, 'brown', (a) => K.lp(a, 350)), turbo = loopTones(K, L, 900 + 400 * (firingHz / 40), [[1, 1], [2.02, 0.3]]), mech = loopNoise(K, L, 'pink', (a) => K.bp(a, 2200, 0.8), [{ cycles: N, depth: 0.6 }]);
  for (let i = 0; i < n; i++) s[i] = s[i] * 0.6 + bed[i] * 0.10 + turbo[i] * 0.004 + mech[i] * 0.05; return s;
}
/** spectral balance of a contact sound: cut the sub-bass below `hp` and lift the top (a copy high-passed at `shelfHz` mixed back at `shelfGain`) - shoe / bullet contacts are dominated by clicks, scuffs and grit, not by a floor boom */
export function tilt(K, s, hp = 110, shelfHz = 2200, shelfGain = 0.9) { K.hp(s, hp); if (shelfGain > 0) { const hf = s.slice(); K.hp(hf, shelfHz); K.mix(s, hf, shelfGain, 0); } return s; }

