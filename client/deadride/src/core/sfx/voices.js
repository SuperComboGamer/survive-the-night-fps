// Zombie voice banks (source-filter synthesis, see vocal.js) + player grunts/breath.
//   audio.zombieVoice(profile) -> { idle:[AudioBuffer..], attack:[], pain:[], death:[], spawn:[], sprint:[], pick(cat), ready:Promise }   (>= 8 buffers per category, cached by profile JSON)
//   profile (documented in docs/API.md): { f0: Hz | [lo,hi], formants: [F1,F2,F3] Hz of the resting vowel (or a scale number), rasp 0..1, wet 0..1, muffle 0..1, kind } — kind: 'male'|'masked'|'burnt'|'crystal'|'miner'|'ski'|'drowned'|'mascot'|'guest'|'guard'|'zombie'; extras: size 0.7..1.5, breath, growl, sub, seed
import * as dsp from '../dsp.js';
import { synth, synthG, VOWELS as V, bubbles, chatter, wheeze } from './vocal.js';
import { grain, crunch, bubble, swish, creak, PLATE, partialsFrom } from './common.js';

export const VOICE_SR = 32000;
export const CATEGORIES = ['idle', 'attack', 'pain', 'death', 'spawn', 'sprint'];
const KIND = {
  miner: { f0: [68, 112], rasp: 0.75, wet: 0.08, muffle: 0, size: 1.2, breath: 0.25, growl: 0.35, sub: 0.45, cough: 0.5 },
  ski: { f0: [115, 205], rasp: 0.4, wet: 0, muffle: 0, size: 0.95, breath: 0.55, growl: 0.15, sub: 0.2, shiver: 0.6 },
  drowned: { f0: [85, 150], rasp: 0.45, wet: 0.9, muffle: 0.2, size: 1.05, breath: 0.4, growl: 0.2, sub: 0.3 },
  mascot: { f0: [150, 270], rasp: 0.35, wet: 0, muffle: 0.85, size: 1.25, breath: 0.2, growl: 0.1, sub: 0.15, squeak: 0.5, laugh: 0.4 },
  guest: { f0: [105, 240], rasp: 0.3, wet: 0, muffle: 0, size: 0.9, breath: 0.35, growl: 0.15, sub: 0.2 },
  guard: { f0: [80, 130], rasp: 0.55, wet: 0, muffle: 0.15, size: 1.15, breath: 0.25, growl: 0.3, sub: 0.35 },
  zombie: { f0: [90, 160], rasp: 0.45, wet: 0.1, muffle: 0, size: 1, breath: 0.3, growl: 0.25, sub: 0.3 },
  masked: { f0: [90, 150], rasp: 0.5, wet: 0.2, muffle: 0.6, size: 1.05, breath: 0.35, growl: 0.25, sub: 0.3 },
  burnt: { f0: [70, 120], rasp: 1, wet: 0, muffle: 0, size: 1.05, breath: 0.55, growl: 0.4, sub: 0.5, cough: 0.6 },
  crystal: { f0: [64, 120], rasp: 0.35, wet: 0.1, muffle: 0, size: 1.15, breath: 0.15, growl: 0.15, sub: 0.15, glass: 0.8 },
};
const KIND_ALIAS = { male: 'zombie', man: 'zombie', ghoul: 'zombie', walker: 'zombie', frozen: 'ski', skier: 'ski', ice: 'ski', drown: 'drowned', wet: 'drowned', clown: 'mascot', animatronic: 'mascot', robot: 'mascot', pirate: 'guest', child: 'guest', woman: 'guest', female: 'guest', prisoner: 'guard', warden: 'guard' };
export const VOICE_PRESETS = {
  miner: { id: 'miner', kind: 'miner', f0: [66, 112], rasp: 0.78, wet: 0.1, muffle: 0, size: 1.22, breath: 0.25, seed: 101 },
  frozen: { id: 'frozen', kind: 'ski', f0: [112, 205], rasp: 0.42, wet: 0, muffle: 0, size: 0.95, breath: 0.55, seed: 202 },
  drowned: { id: 'drowned', kind: 'drowned', f0: [85, 150], rasp: 0.45, wet: 0.9, muffle: 0.2, size: 1.05, breath: 0.4, seed: 303 },
  mascot: { id: 'mascot', kind: 'mascot', f0: [150, 270], rasp: 0.35, wet: 0, muffle: 0.85, size: 1.25, breath: 0.2, seed: 404 },
  guest: { id: 'guest', kind: 'guest', f0: [105, 240], rasp: 0.3, wet: 0, muffle: 0, size: 0.9, breath: 0.35, seed: 505 },
};
const SEQ = {
  idle: [['uh', 'o', 'u'], ['a', 'uh', 'o'], ['o', 'u', 'u'], ['er', 'uh', 'o'], ['a', 'o', 'u'], ['uh', 'a', 'o']], attack: [['a', 'o', 'uh'], ['ae', 'a', 'o'], ['a', 'a', 'uh'], ['o', 'a', 'uh']], pain: [['ae', 'eh', 'uh'], ['a', 'ae', 'e'], ['e', 'ae', 'uh']],
  death: [['a', 'uh', 'u'], ['o', 'uh', 'u'], ['ae', 'uh', 'o']], spawn: [['u', 'o', 'a'], ['oo', 'uh', 'a'], ['u', 'uh', 'ae']], sprint: [['a', 'uh', 'a'], ['uh', 'a', 'uh']],
};
export function normalizeProfile(p = {}) {
  const kind = KIND[p.kind] ? p.kind : KIND_ALIAS[p.kind] || 'zombie', base = KIND[kind], P = { ...base, ...p, kind: KIND[p.kind] ? p.kind : (p.kind || 'zombie'), _base: kind };
  P.f0 = Array.isArray(p.f0) && p.f0.length >= 2 ? p.f0 : typeof p.f0 === 'number' && p.f0 > 20 ? [p.f0 * 0.86, p.f0 * 1.16] : base.f0; P.size = Math.max(0.7, Math.min(1.5, +P.size || 1)); const f = p.formants, cl = (v, a, b) => Math.max(a, Math.min(b, v));
  P.formScale = 1; P.fs3 = null; P.vowelBias = null;
  if (Array.isArray(f) && f.length >= 3) P.fs3 = [cl(f[0] / 500, 0.55, 1.6), cl(f[1] / 1500, 0.55, 1.6), cl(f[2] / 2500, 0.6, 1.5)]; // resting-vowel formants [F1,F2,F3] Hz relative to a neutral schwa [500,1500,2500]
  else if (typeof f === 'number') P.formScale = f; else if (f && typeof f === 'object') { P.formScale = f.scale || 1; P.vowelBias = f.vowels || null; }
  P.seed = p.seed ?? dsp.hashStr(JSON.stringify(p)); return P;
}
// ---- voice casting: every voice set gets its own spectral colour: 10 peaking bands (60 Hz .. 12 kHz), each +-G dB by a code word of a distance-3 code, so any two sets differ in >= 3 bands (>= ~8 dB rms long-term spectrum distance even when their profile parameters are nearly equal)
const TIM_F = [60, 110, 200, 380, 700, 1300, 2400, 4400, 8000, 12000], TIM_G = 16, TIM_WORDS = (() => { const w = []; const pc = (x) => { let b = 0; while (x) { b += x & 1; x >>= 1; } return b; }; for (let i = 0; i < 1024; i++) { let ok = true; for (const c of w) if (pc(i ^ c) < 3) { ok = false; break; } if (ok) w.push(i); } return w; })();
const timbreGains = (slot) => { const w = TIM_WORDS[((slot % TIM_WORDS.length) + TIM_WORDS.length) % TIM_WORDS.length]; return TIM_F.map((_, k) => ((w >> k) & 1 ? TIM_G : -TIM_G)); };
const popc = (x) => { let b = 0; while (x) { b += x & 1; x >>= 1; } return b; };
/** colour slot of a voice set: the first set takes a hash-chosen word, every next one the code word farthest (most bands different) from the sets already cast in this engine */
export function timbreSlot(engine, key0, seed) {
  const n = TIM_WORDS.length, used = engine && (engine._timbre || (engine._timbre = new Map())); if (!used) return seed % n; if (used.has(key0)) return used.get(key0);
  const taken = [...used.values()]; let slot = seed % n; if (taken.length) { let best = -1; for (let k = 0; k < n; k++) { if (taken.includes(k)) continue; let md = 99; for (const u of taken) md = Math.min(md, popc(TIM_WORDS[k] ^ TIM_WORDS[u])); const sc = md * 1000 - ((k - seed % n + n) % n); if (sc > best) { best = sc; slot = k; } } }
  used.set(key0, slot); return slot;
}
const applyTimbre = (out, sr, slot) => { const g = timbreGains(slot); for (let k = 0; k < TIM_F.length; k++) if (TIM_F[k] < sr * 0.45) dsp.biquadInPlace(out, 'peak', TIM_F[k], 1.6, sr, g[k]); return out; };
const vowelKeys = (dur, names, R) => names.map((nm, k) => { const v = V[nm]; const j = () => 1 + (R.next() - 0.5) * 0.1; return [dur * k / (names.length - 1), v[0] * j(), v[1] * j(), v[2] * j()]; });
const swell = (dur, R) => { const a = R.range(0.08, 0.25), rel = R.range(0.25, 0.5), dip = R.range(0.55, 0.85), t1 = R.range(0.35, 0.5); return [[0, 0], [a, 1], [dur * t1, dip], [dur * (t1 + 0.22), 1], [dur - rel, 0.6], [dur, 0]]; };

function squeak(K, R, level = 1) { const d = R.range(0.07, 0.13), f0 = R.range(1100, 1700), f1 = f0 * R.range(1.7, 2.6), s = K.sweep(d, (u) => f0 + (f1 - f0) * Math.pow(u, 0.7), { harm: [1, 0.55, 0.3, 0.15], atk: 0.004, rel: 0.02 }); for (let i = 0; i < s.length; i++) s[i] *= 1 + 0.3 * Math.sin(i / K.sr * 6.283 * 38); return s.map((v) => v * level); }
function cough(K, P, R, sr) { // one or a few dry hacking coughs (glottal burst + noise through /uh/ formants)
  const parts = R.int(2, 4), d1 = R.range(0.12, 0.17), gap = R.range(0.17, 0.24), tot = parts * gap + d1, o = new Float32Array(K.n(tot)), f = R.range(P.f0[0], P.f0[1]) * 0.8;
  for (let k = 0; k < parts; k++) { const c = synth(sr, { dur: d1, f0: [[0, f * 0.9], [d1, f * 0.6]], vowels: [[0, ...V.uh], [d1, ...V.o]], amp: [[0, 0], [0.008, 0.9], [0.06, 0.4], [d1, 0]], asp: [[0, 0], [0.008, 1], [0.05, 0.6], [d1, 0]], breath: 1, sub: 0.6, rasp: 0.8, jitter: 0.08, fscale: 1 / P.size, wet: P.kind === 'drowned' ? 0.5 : 0.25 }, R); dsp.mixInto(o, c, 0.7 * Math.pow(0.85, k), Math.round(k * gap * sr)); }
  return o;
}
function laugh(K, P, R, sr) { // distorted mascot laugh: ha-ha-ha with clipped animatronic timbre
  const pulses = R.int(3, 6), c = R.range(0.17, 0.24), o = new Float32Array(K.n(pulses * c + 0.1)), f = R.range(P.f0[0], P.f0[1]) * 1.1;
  for (let k = 0; k < pulses; k++) { const d = 0.14, y = synth(sr, { dur: d, f0: [[0, f * (1 + 0.05 * k)], [d, f * 0.85]], vowels: [[0, ...V.a], [d, ...V.uh]], amp: [[0, 0], [0.01, 1], [0.08, 0.6], [d, 0]], breath: 0.5, rasp: 0.9, open: 0.7, fscale: 1 / P.size, muffle: P.muffle * 0.6 }, R); dsp.mixInto(o, y, 1, Math.round(k * c * sr)); }
  return dsp.saturate(o, 3);
}

/** syllable-structured contour: `ns` syllables, each with its own amplitude hump, F0 accent + fall (declining across the phrase) and vowel glide; the breath continues in the gaps. Returns key lists for synthG. */
function syllables(dur, ns, f, R, seq, P, { start = 1.1, end = 0.8, dip = 0.3, breathy = 0.5 } = {}) {
  const w = Array.from({ length: ns }, () => R.range(0.7, 1.4)), tw = w.reduce((a, b) => a + b, 0), f0 = [], amp = [], asp = [], vw = []; let t = 0;
  for (let j = 0; j < ns; j++) {
    const len = dur * w[j] / tw, a = t + (j ? 0.012 : 0), b = t + len - (j < ns - 1 ? 0.012 : 0), top = f * start * (1 - 0.06 * j) * (1 + 0.05 * R.gauss()), bot = f * end * (1 - 0.07 * j);
    f0.push([a, top * R.range(0.95, 1.03)], [a + 0.3 * (b - a), top], [b, bot]);
    amp.push([a, j === 0 ? 0 : dip * 0.5], [a + 0.12 * (b - a), 1 - 0.08 * j], [a + 0.6 * (b - a), 0.72 - 0.06 * j], [b, j < ns - 1 ? dip * 0.4 : 0]);
    asp.push([a, breathy * P.breath * 1.3], [a + 0.15 * (b - a), 0.15 * P.breath * 1.3], [b - 0.1 * (b - a), 0.3 * P.breath * 1.3], [b, breathy * 0.8 * P.breath * 1.3]);
    vw.push([a, ...V[R.pick(seq)]], [b, ...V[R.pick(seq)]]); t += len;
  }
  return { f0, amp, asp, vowels: vw };
}

/** build one buffer of `cat` for profile P (K = kit at VOICE_SR seeded per variant) */
export function* buildVoice(K, P, cat, i) {
  const KB = P._base || P.kind, R = K.rng, sr = K.sr, f = R.range(P.f0[0], P.f0[1]) * Math.pow(P.size, -0.3), fsc = P.formScale / P.size;
  const seq = R.pick(SEQ[cat]), base = { fscale: fsc, fs3: P.fs3, breath: P.breath * R.range(0.7, 1.3), rasp: P.rasp * R.range(0.65, 1.05), wet: P.wet, muffle: P.muffle, bw: [80, 100, 150], open: R.range(0.5, 0.72), jitter: 0.02 + 0.05 * P.rasp, shimmer: 0.05 + 0.08 * P.rasp, sub: P.sub * R.range(0.4, 1), growl: P.growl * R.range(0.6, 1.2), growlHz: R.range(24, 38), vib: R.range(0.005, 0.014), vibHz: R.range(4.5, 6.5) };
  let S, dur, extra = null;
  const shiver = P.shiver && cat !== 'attack' ? { vib: 0.035 + 0.03 * P.shiver, vibHz: R.range(8.5, 11.5) } : null;
  switch (cat) {
    case 'idle': { dur = R.range(1.2, 2.8); const sy = syllables(dur, R.int(1, dur > 2 ? 4 : 3), f, R, seq, P, { start: 1.1, end: 0.78, dip: R.range(0.2, 0.45), breathy: R.range(0.3, 0.8) }); S = { ...base, dur, f0: sy.f0, vowels: sy.vowels, amp: sy.amp, asp: sy.asp }; break; }
    case 'attack': { dur = R.range(0.55, 1.05); const two = R.chance(0.6), h = two ? R.range(0.42, 0.55) : 0; // a growled "rah" with an aspirated onset, often a second push ("ra-AH")
      S = { ...base, dur, f0: two ? [[0, f * 0.95], [dur * 0.08, f * 1.4], [dur * (h - 0.05), f * 1.15], [dur * h, f * 1.05], [dur * (h + 0.06), f * 1.45], [dur, f * 0.78]] : [[0, f * 0.95], [dur * 0.08, f * 1.4], [dur * 0.4, f * 1.15], [dur, f * 0.8]], vowels: vowelKeys(dur, seq, R),
        amp: two ? [[0, 0], [0.012, 1], [dur * (h - 0.08), 0.85], [dur * h, 0.45], [dur * (h + 0.07), 1], [dur * 0.8, 0.9], [dur, 0]] : [[0, 0], [0.015, 1], [dur * 0.6, 0.9], [dur, 0]], asp: [[0, 1.3 * P.breath], [0.05, 0.3 * P.breath], [dur * 0.5, 0.25 * P.breath], [dur, 0.2 * P.breath]],
        open: 0.5, jitter: 0.045, shimmer: 0.1, growl: Math.min(0.75, base.growl * 1.6), growlHz: R.range(30, 40), rasp: Math.min(1, base.rasp * 1.15 + 0.1), vib: 0.02 }; break; }
    case 'pain': dur = R.range(0.22, 0.5); S = { ...base, dur, f0: [[0, f * 1.2], [dur * 0.2, f * 1.75], [dur, f * 1.15]], vowels: vowelKeys(dur, seq, R), amp: [[0, 0], [0.01, 1], [dur * 0.5, 0.85], [dur, 0]], rasp: base.rasp * 0.8, growl: base.growl * 0.3, jitter: 0.06 }; break;
    case 'death': dur = R.range(1.3, 2.6); S = { ...base, dur, f0: [[0, f], [dur * 0.3, f * 0.85], [dur * 0.7, f * 0.6], [dur, f * 0.42]], vowels: vowelKeys(dur, seq, R), amp: [[0, 0], [0.06, 1], [dur * 0.5, 0.7], [dur * 0.85, 0.3], [dur, 0]], asp: [[0, 0.2], [dur * 0.6, 0.5], [dur, 0.9]].map(([t, g]) => [t, g * P.breath * 1.6]), sub: Math.min(0.9, P.sub * 1.5 + 0.2) }; break;
    case 'spawn': dur = R.range(1.4, 2.7); S = { ...base, dur, f0: [[0, f * 0.5], [dur * 0.5, f * 0.85], [dur * 0.9, f * 1.15], [dur, f]], vowels: vowelKeys(dur, seq, R), amp: [[0, 0], [dur * 0.3, 0.5], [dur * 0.8, 1], [dur, 0]], rasp: Math.min(1, base.rasp * 1.1), sub: Math.min(0.9, base.sub * 1.2), growl: Math.min(0.8, base.growl * 1.3) }; break;
    default: { // sprint: rhythmic "hah-hah" pants/snarls
      dur = R.range(0.8, 1.4); const c = R.range(0.2, 0.3), amp = [[0, 0]], asp = [[0, 0]]; for (let t = 0; t < dur - 0.2; t += c) { amp.push([t + 0.01, 1], [t + 0.09, 0.55], [t + 0.15, 0]); asp.push([t + 0.005, 0.6], [t + 0.1, 0.3], [t + 0.15, 0.1], [t + c * 0.75, 0.8], [t + c - 0.02, 0.05]); }
      amp.push([dur, 0]); asp.push([dur, 0]); S = { ...base, dur, f0: [[0, f * 1.05], [dur, f * 1.2]], vowels: vowelKeys(dur, seq, R), amp, asp: asp.map(([t, g]) => [t, g * P.breath * 1.5]), sub: base.sub * 0.6, growl: base.growl * 0.4 };
    }
  }
  if (shiver) Object.assign(S, shiver);
  if (cat === 'idle' || cat === 'attack' || cat === 'death' || cat === 'spawn') { // phrase-level life: slow random pitch drift on top of the contour and bursts of vocal fry (period doubling) at random moments
    const drift = R.range(0.03, 0.09), ph = R.next() * 6.28, dp = R.range(2.2, 4.5); S.f0 = S.f0.map(([t, hz]) => [t, hz * (1 + drift * Math.sin(ph + t * dp))]);
    const fry = [[0, S.sub ?? 0]]; const nb = R.int(1, 3); for (let k = 0; k < nb; k++) { const t = R.range(0.1, 0.9) * dur, w = R.range(0.06, 0.2), a = R.range(0.5, 0.95); fry.push([Math.max(fry[fry.length - 1][0] + 0.01, t - 0.02), S.sub ?? 0], [t, a], [t + w, a], [t + w + 0.03, S.sub ?? 0]); } fry.sort((x, y) => x[0] - y[0]); const okf = []; for (const q of fry) if (!okf.length || q[0] > okf[okf.length - 1][0]) okf.push(q); if (okf.length > 1 && okf[okf.length - 1][0] < dur) okf.push([dur, S.sub ?? 0]); S.subCurve = okf;
  }
  const y = yield* synthG(sr, S, R), n = y.length; let out = y;
  // ----- kind-specific layers
  const mixAt = (arr, g, t) => dsp.mixInto(out, arr, g, Math.round(t * sr));
  if ((KB === 'miner' || KB === 'burnt')) { if ((cat === 'idle' && R.chance(P.cough)) || cat === 'sprint' && R.chance(0.3)) mixAt(cough(K, P, R, sr), 0.9, cat === 'idle' ? R.range(0, Math.max(0.05, dur - 0.7)) : 0); if (cat === 'death') mixAt(cough(K, P, R, sr), 0.6, dur * 0.55); if (cat === 'spawn') mixAt(crunch(K, dur, 60, 1.2, 800, 3500, 0.004, 0.02, 0.15), 1, 0); }
  if (KB === 'ski') {
    if (cat === 'idle' && R.chance(0.7)) mixAt(chatter(sr, Math.min(dur, R.range(0.5, 1.2)), R.range(11, 16), R, 0.35), 1, R.range(0, Math.max(0, dur - 1.2)));
    if ((cat === 'idle' || cat === 'pain') && R.chance(0.45)) { const w = wheeze(sr, 0.28, R.range(1200, 1700), R.range(1900, 2600), R, 0.55, 7); out = dsp.concatArr(w, out); }
    if (cat === 'spawn') mixAt(crunch(K, dur, 400, 0.8, 1500, 6000, 0.001, 0.004, 0.22), 1, 0);
  }
  if (KB === 'drowned') {
    mixAt(bubbles(sr, dur, cat === 'death' ? R.range(14, 22) : R.range(6, 13), R, cat === 'death' ? 0.5 : 0.32), 1, 0);
    if (cat === 'spawn') { const sp = K.burst(0.6, { color: 'pink', atk: 0.02, tau: 0.22, lp: 2200 }); mixAt(sp, 0.7, 0); mixAt(bubbles(sr, dur * 0.7, 25, R, 0.5), 1, 0); }
  }
  if (KB === 'mascot') {
    if (cat === 'pain' || (cat === 'idle' && R.chance(P.squeak))) mixAt(squeak(K, R, cat === 'pain' ? 0.9 : 0.55), 1, cat === 'pain' ? 0 : R.range(0.1, Math.max(0.15, dur - 0.3)));
    if (cat === 'attack' && R.chance(P.laugh)) out = dsp.concatArr(laugh(K, P, R, sr), out.subarray(0, Math.floor(out.length * 0.6)));
    if (cat === 'death') { const leak = K.noise(dur, 'white'); K.env(leak, { atk: 0.05, tau: dur * 0.4 }); dsp.svf(leak, sr, 'bp', (j) => 3200 - 2800 * (j / leak.length), 2); mixAt(leak, 0.45, 0.1); mixAt(K.sweep(0.5, (u) => 900 - 600 * u, { harm: [1, 0.5, 0.3], atk: 0.01, rel: 0.1 }), 0.35, 0.05); }
    if (cat === 'spawn') mixAt(creak(K, dur * 0.8, 200, 320, { slip: 14, atk: 0.2, rel: 0.3 }), 0.25, 0.1);
  }
  if (KB === 'guard' && cat === 'attack') mixAt(K.burst(0.05, { color: 'pink', atk: 0.002, tau: 0.02, lp: 2500 }), 0.4, 0);
  if (KB === 'guest' && cat === 'attack' && R.chance(0.35)) { /* raspy scream variant: pitch up */ out = dsp.resample(out, R.range(1.25, 1.6)); }
  if (KB === 'burnt' && cat !== 'pain') mixAt(crunch(K, dur, 34, 0.7, 600, 3800, 0.001, 0.004, 0.14), 1, 0); // charred throat: dry crackle riding on the voice
  if (KB === 'crystal') for (let k = 0, np = R.int(1, 3); k < np; k++) mixAt(K.ring(0.7, partialsFrom(R.range(1400, 3200), PLATE, 0.22), { soft: 0.0002 }), 0.15, R.range(0, Math.max(0.05, dur * 0.8))); // glassy pings from the crystalline growth
  if (cat === 'spawn' || cat === 'death') { const rum = K.low(4, (K2) => { const a = K2.noise(dur, 'brown'); K2.env(a, { atk: 0.2, tau: dur * 0.5 }); K2.lp(a, 150); return a; }); dsp.mixInto(out, rum, cat === 'spawn' ? 0.5 : 0.18, 0); }
  if ((cat === 'idle' || cat === 'death') && R.chance(cat === 'death' ? 0.7 : 0.4)) { const gs = wheeze(sr, R.range(0.16, 0.3), R.range(900, 1500), R.range(1500, 2400), R, 0.5, 4); out = cat === 'death' ? dsp.concatArr(out, gs) : dsp.concatArr(gs, out); } // an intake / last gasp
  return applyTimbre(out, sr, P.timbre ?? (dsp.hashStr(P.id || JSON.stringify(P.f0)) % TIM_WORDS.length));
}

/** cached voice banks: defs `voice.<key>.<cat>` (8 variants each) built through the shared time-sliced library queue */
export function makeZombieVoice(engine, profile) {
  const P = normalizeProfile(profile), lib = engine.lib; P.timbre = timbreSlot(engine, JSON.stringify(profile || {}), dsp.hashStr(JSON.stringify(profile || {})) >>> 0); const key = (P.id ? P.id + '-' : '') + (dsp.hashStr(JSON.stringify(P)) >>> 0).toString(36).slice(0, 5), set = { profile: P, key, names: {}, done: false };
  const rng = new dsp.Rng(P.seed ^ 0x51ed), last = {};
  for (const cat of CATEGORIES) {
    const name = `voice.${key}.${cat}`; set.names[cat] = name;
    if (!lib.has(name)) lib.def(name, { n: 8, peak: 0.7, norm: 'rms', rms: 0.15, sr: VOICE_SR, prio: 1, seed: (P.seed + dsp.hashStr(cat)) >>> 0, remote: { fn: 'voice', args: { P: JSON.parse(JSON.stringify(P)), cat } }, meta: { bus: 'voice', prio: cat === 'attack' || cat === 'death' ? 6 : 5, refDist: cat === 'attack' ? 4.5 : 3.5, maxDist: 75, send: 1, max: 6 } }, (K, i) => buildVoice(K, P, cat, i));
    Object.defineProperty(set, cat, { enumerable: true, get: () => lib.variants(name) });
  }
  set.pick = (cat) => { const arr = lib.get(set.names[cat]); if (!arr) return null; if (!Array.isArray(arr)) return arr; let j = (rng.next() * arr.length) | 0; if (arr.length > 1 && j === last[cat]) j = (j + 1) % arr.length; last[cat] = j; return arr[j]; };
  set.count = () => CATEGORIES.reduce((s, c) => s + lib.variants(set.names[c]).length, 0);
  set.ready = new Promise((res) => { const chk = () => { if (CATEGORIES.every((c) => lib.variants(set.names[c]).length >= 8)) { set.done = true; res(set); return true; } return false; }; if (!chk()) { const cb = () => { if (chk()) lib.listeners.splice(lib.listeners.indexOf(cb), 1); }; lib.listeners.push(cb); } });
  for (const c of CATEGORIES) lib.promote(set.names[c], 1);
  return set;
}

/** player grunts / breathing (male, close-miked) */
export function install(lib) {
  const P = normalizeProfile({ kind: 'zombie', f0: [105, 135], rasp: 0.12, wet: 0, size: 1, breath: 0.3, growl: 0, sub: 0.05 });
  // generic zombie voice per category (lazy): what `audio.play('zombie.' + kind)` resolves to when a stop's own voice bank is not built yet
  const PZ = normalizeProfile({ kind: 'zombie', seed: 909 });
  for (const cat of CATEGORIES) lib.def(`zombie.${cat}`, { n: 3, peak: 0.7, norm: 'rms', rms: 0.15, sr: VOICE_SR, prio: 0, meta: { bus: 'voice', prio: 5, refDist: 3.5, maxDist: 75, send: 1, max: 6 } }, (K, i) => buildVoice(K, PZ, cat, i));
  lib.def('player.hurt', { n: 4, peak: 0.7, norm: 'rms', rms: 0.12, sr: VOICE_SR, prio: 2, meta: { bus: 'sfx', refDist: 1, maxDist: 20, send: 0.5 } }, (K, i) => { const R = K.rng, d = R.range(0.28, 0.45), f = R.range(105, 140); return synthG(K.sr, { dur: d, f0: [[0, f * 1.05], [d * 0.25, f * 1.35], [d, f * 0.85]], vowels: [[0, ...V.eh], [d * 0.4, ...V.ae], [d, ...V.uh]], amp: [[0, 0], [0.01, 1], [d * 0.5, 0.8], [d, 0]], breath: 0.35, rasp: 0.25, jitter: 0.03, shimmer: 0.06, fscale: 1, open: 0.6 }, R); });
  lib.def('player.breath', { n: 3, peak: 0.45, norm: 'rms', rms: 0.06, sr: VOICE_SR, prio: 1, meta: { bus: 'sfx', refDist: 1, maxDist: 15, send: 0.4 } }, (K, i) => { const R = K.rng, T = R.range(1.3, 1.8), k = R.range(0.85, 1.1); return synthG(K.sr, { dur: T, noiseOnly: true, f0: [[0, 120], [T, 120]], vowels: [[0, ...V.schwa], [T * 0.5, ...V.uh], [T, ...V.schwa]], amp: [[0, 0], [T, 0]], asp: [[0, 0], [0.05 * T, 0.05], [0.28 * T, 0.6 * k], [0.45 * T, 0.12], [0.55 * T, 0], [0.6 * T, 0.05], [0.72 * T, 0.95 * k], [0.95 * T, 0.12], [T, 0]], breath: 1, bw: [140, 190, 260], fscale: 1 }, R); });
  lib.def('player.death', { n: 2, peak: 0.6, norm: 'rms', rms: 0.12, sr: VOICE_SR, prio: 1, meta: { bus: 'sfx', refDist: 1, maxDist: 20, duck: [0.75, 3.2, 'world'] } }, (K) => { const R = K.rng, d = R.range(1.2, 1.8), f = 120; return synthG(K.sr, { dur: d, f0: [[0, f], [d * 0.4, f * 0.8], [d, f * 0.5]], vowels: [[0, ...V.a], [d * 0.5, ...V.uh], [d, ...V.u]], amp: [[0, 0], [0.05, 1], [d * 0.6, 0.5], [d, 0]], asp: [[0, 0.3], [d, 0.8]], breath: 0.6, rasp: 0.3, sub: 0.6, wet: 0.35, fscale: 1 }, R); });
}
