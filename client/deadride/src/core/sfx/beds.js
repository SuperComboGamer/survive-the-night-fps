// Ambient bed loop builders (seamless, low sample-rate loops): hum, drone pad, insects, water (rain, surf, waves, lap, stream, bubbles), crackle (fire/ice/static/electric),
// machines (diesel, generator, gears, fan, steam, motor, pump, compressor, clock, turbine). Live-graph beds (wind, rumble, noise) live in ambience.js.
// Every loop is built either from integer-cycle periodic components or with an equal-power seam crossfade, so the seam click is < -40 dB (measured by the analyzer).
import * as dsp from '../dsp.js';
import { PLATE, partialsFrom, grain, crunch, cloud, bubble, circMix, loopNoise, loopTones, diesel } from './common.js';

const q = (v, step) => Math.round(v / step) * step;
const fmt = (v) => String(+(+v).toFixed(2));

/** returns { key, sr, L?, make(K) } for buffer-backed bed types, or null for live beds */
export function bedSpec(def) {
  const t = def.type;
  switch (t) {
    case 'hum': { const f = def.freq ?? 50, h = def.harmonics ?? 8, b = q(def.buzz ?? 0.3, 0.1), c = q(def.color ?? 0.4, 0.2); return { key: `hum.${fmt(f)}.${h}.${fmt(b)}.${fmt(c)}`, sr: 16000, make: (K) => hum(K, f, h, b, c) }; }
    case 'drone': { const f = def.freq ?? 55, ch = def.chord ?? [1, 1.5, 2, 3], mv = q(def.movement ?? 0.5, 0.25), br = def.bright ?? 1800, dt = def.detune ?? 9; return { key: `drone.${fmt(f)}.${ch.join('_')}.${fmt(mv)}.${br}.${dt}`, sr: 12000, make: (K) => drone(K, f, ch, mv, br, dt) }; }
    case 'insects': { const f = def.freq ?? 4400, d = q(def.density ?? 0.6, 0.2); return { key: `insects.${f}.${fmt(d)}`, sr: 16000, make: (K) => insects(K, f, d) }; }
    case 'water': { const kind = def.kind ?? 'lap', it = q(def.intensity ?? 0.5, 0.25); if (kind === 'hiss' || kind === 'drip') return null; return { key: `water.${kind}.${fmt(it)}`, sr: 24000, make: (K) => water(K, kind, it, def) }; }
    case 'crackle': { const kind = def.kind ?? 'fire', it = q(def.intensity ?? 0.5, 0.25); return { key: `crackle.${kind}.${fmt(it)}`, sr: 24000, make: (K) => crackle(K, kind, it) }; }
    case 'machine': { const kind = def.kind ?? 'diesel', rpm = def.rpm ?? DEFAULT_RPM[kind] ?? 1000; return { key: `machine.${kind}.${q(rpm, 50)}`, sr: 16000, make: (K) => machine(K, kind, rpm, def) }; }
    default: return null;
  }
}
const DEFAULT_RPM = { diesel: 750, generator: 1500, gears: 84, fan: 1450, steam: 150, motor: 1450, pump: 180, compressor: 60, clock: 60, turbine: 6000, refrigerator: 1500, ventilation: 900 };

const plainDef = (d) => JSON.parse(JSON.stringify(d, (k, v) => (k.startsWith('_') || typeof v === 'function' ? undefined : v)));
/** make sure the lib has a def for this bed; returns its name (or null for live beds). Time-sliced (prio 1). */
export function ensureBed(lib, def) {
  const s = bedSpec(def); if (!s) return null; const name = 'amb.bed.' + s.key;
  if (!lib.has(name)) lib.def(name, { n: 1, sr: s.sr, prio: 1, loop: true, norm: 'rms', rms: 0.1, meta: { bus: 'amb', prio: 2, refDist: 8, maxDist: 250, send: 0.6 }, remote: { fn: 'bed', args: { def: plainDef(def) } } }, s.make); else lib.promote(name, 1);
  return name;
}

// ---------------------------------------------------------------------------------------------------------- builders
function hum(K, f, harm, buzz, color) { // mains/transformer/lamp hum: harmonic stack (odd emphasis = buzz), slow beat, faint noise floor
  const parts = []; for (let k = 1; k <= harm; k++) parts.push([k, (1 / Math.pow(k, 1.1 + (1 - color) * 0.9)) * (k % 2 ? 1 + 2.2 * buzz : 1)]);
  const t = loopTones(K, 4, f, parts, { beat: 0.25, beatAmp: 0.35 }), n = loopNoise(K, 4, 'pink', (a) => K.lp(a, 500)); return t.map((v, i) => v * 0.2 + n[i] * 0.05);
}
function* drone(K, f, chord, movement, bright, det) { // detuned saw pad, slowly breathing low-pass; integer cycles per loop => seamless
  const L = 16, warm = 1.2, n = K.n(L + warm), o = new Float32Array(n), R = K.rng;
  for (const r of chord) for (const d of [-det, det]) { const ff = Math.round(f * r * Math.pow(2, d / 1200) * L) / L, s = K.saw(L + warm, ff, { phase: R.next() }); for (let i = 0; i < n; i++) o[i] += s[i]; yield; }
  const ph = R.next() * 6.28, w = 6.283185307 * 3 / (K.sr * L); K.svf(o, 'lp', (i) => bright * (1 + movement * 0.6 * Math.sin(w * i + ph)), 0.9); const w2 = 6.283185307 * 2 / (K.sr * L); for (let i = 0; i < n; i++) o[i] *= 1 + 0.25 * movement * Math.sin(w2 * i);
  return o.subarray(K.n(warm), K.n(warm) + K.n(L));
}
function insects(K, f, density) { // crickets: groups of 30 Hz pulse-trains on a 4-5 kHz carrier, several animals out of phase
  const L = 8, n = K.n(L), o = new Float32Array(n), R = K.rng, animals = 4 + Math.round(density * 8);
  for (let a = 0; a < animals; a++) {
    const fc = f * R.range(0.93, 1.07), pr = R.range(24, 34), np = R.int(3, 5), chirps = Math.round(R.range(1.4, 2.6) * L), pulse = K.tone(0.008, fc, { atk: 0.0015, tau: 0.003, rel: 0.002 }), amp = R.range(0.3, 1);
    for (let c = 0; c < chirps; c++) { const t0 = (c + R.next() * 0.4) / chirps * L; for (let p = 0; p < np; p++) circMix(o, pulse, amp * (0.6 + 0.4 * Math.sin(Math.PI * (p + 0.5) / np)), Math.round((t0 + p / pr) * K.sr)); }
  }
  const low = loopNoise(K, L, 'pink', (x) => K.lp(x, 600)); for (let i = 0; i < n; i++) o[i] = o[i] * 0.35 + low[i] * 0.02; return o;
}
function water(K, kind, it, def) {
  const R = K.rng;
  switch (kind) {
    case 'rain': { const L = 14, xf = 0.6, n = K.n(L + xf), wash = K.noise(L + xf, 'pink'); K.hp(wash, 500); K.lp(wash, 9000); for (let i = 0; i < n; i++) wash[i] *= 0.25 + 0.6 * it;
      const pool = Array.from({ length: 14 }, () => grain(K, R.range(2000, 7500), R.range(0.002, 0.005))), big = Array.from({ length: 6 }, () => bubble(K, R.range(500, 1400), 0.008, 1.5)); const d = cloud(K, L + xf, () => 60 + 700 * it, pool, 0.32), b = cloud(K, L + xf, () => 3 + 30 * it, big, 0.1); for (let i = 0; i < n; i++) wash[i] += d[i] + b[i]; return K.makeLoop(wash, xf); }
    case 'surf': case 'waves': { const L = kind === 'surf' ? 24 : 30, n = K.n(L), env = new Float32Array(n), fcv = new Float32Array(n), big = kind === 'surf'; let t = R.range(0, 2); const nz = K.noise(L + 1.2, 'pink');
      while (t < L) { const P = R.range(big ? 7 : 9, big ? 11 : 14), a = R.range(0.7, 1) * (0.5 + 0.5 * it), rise = R.range(2, 3.2), decay = R.range(2.5, 4); const w = new Float32Array(K.n(rise + decay * 3)); for (let i = 0; i < w.length; i++) { const u = i / K.sr; w[i] = u < rise ? Math.pow(u / rise, 2.2) : Math.exp(-(u - rise) / decay); } circMix(env, w, a, Math.round(t * K.sr)); t += P; }
      for (let i = 0; i < n; i++) { env[i] = Math.min(1.4, env[i]) + 0.06; fcv[i] = 500 + (big ? 4200 : 2600) * Math.pow(Math.min(1, env[i]), 1.6); } K.svf(nz, 'lp', (i) => fcv[i % n], 0.7); const o = K.makeLoop(nz, 1.2); for (let i = 0; i < o.length; i++) o[i] *= Math.pow(env[i], 0.9); return o; }
    case 'lap': { const L = 10, xf = 0.5, o = K.buf(L + xf), floor = K.noise(L + xf, 'pink'); K.lp(floor, 500); for (let i = 0; i < o.length; i++) o[i] = floor[i] * 0.12;
      const pool = Array.from({ length: 8 }, () => { const s = K.buf(0.3); K.mix(s, K.svf(K.burst(0.25, { color: 'pink', atk: 0.02, tau: 0.07 }), 'bp', R.range(500, 1500), 0.9), 0.7, 0); for (let k = 0; k < 3; k++) K.mix(s, bubble(K, R.range(300, 1000), R.range(0.01, 0.025)), 0.35, R.range(0.02, 0.2)); K.mix(s, K.thump(0.1, 200, 90, 0.02, 0.03), 0.3, 0); return s; });
      const c = cloud(K, L + xf, () => 1.4 + 2.2 * it, pool, 0.5); for (let i = 0; i < o.length; i++) o[i] += c[i]; return K.makeLoop(o, xf); }
    case 'stream': case 'flow': { const L = 8, xf = 0.4, n = K.n(L + xf), a = K.noise(L + xf, 'pink'); K.bp(a, 1600, 0.6); const w = loopWander(K, n, 22); for (let i = 0; i < n; i++) a[i] *= 0.4 + 0.9 * w[i];
      const pool = Array.from({ length: 16 }, () => bubble(K, R.range(400, 2500), R.range(0.004, 0.012), 1.4)); const c = cloud(K, L + xf, () => 60 + 160 * it, pool, 0.25), low = K.noise(L + xf, 'brown'); K.lp(low, 200); for (let i = 0; i < n; i++) a[i] = a[i] * (0.4 + 0.6 * it) + c[i] + low[i] * 0.1; return K.makeLoop(a, xf); }
    case 'bubbles': default: { const L = 10, xf = 0.5, n = K.n(L + xf), o = new Float32Array(n), lowf = def && def.low, pool = Array.from({ length: 10 }, () => { const f = lowf ? R.range(70, 300) : R.range(180, 900); return K.thump(0.5, f, f * 1.4, 0.06, R.range(0.05, 0.14), { atk: 0.006 }); }); const c = cloud(K, L + xf, () => 2 + 7 * it, pool, 0.6); const h = K.noise(L + xf, 'pink'); K.lp(h, lowf ? 500 : 1500); for (let i = 0; i < n; i++) o[i] = c[i] + h[i] * 0.08; return K.makeLoop(o, xf); }
  }
}
function loopWander(K, n, rateHz) { const a = new Float32Array(n), step = Math.max(1, Math.round(K.sr / rateHz)); let p = K.rng.next(), q2 = K.rng.next(); for (let i = 0; i < n; i++) { if (i % step === 0) { p = q2; q2 = K.rng.next(); } const u = (i % step) / step; a[i] = p + (q2 - p) * u * u * (3 - 2 * u); } return a; }
function crackle(K, kind, it) {
  const R = K.rng, L = kind === 'ice' ? 12 : 10, xf = 0.5, n = K.n(L + xf), o = new Float32Array(n);
  if (kind === 'fire') {
    const pool = Array.from({ length: 14 }, () => { const s = K.buf(0.05); K.mix(s, K.burst(0.02, { atk: 0.0002, tau: R.range(0.003, 0.012), lp: R.range(1200, 4500), hp: 200 }), 1, 0); K.mix(s, K.ring(0.05, [[R.range(300, 900), 1, 0.02]], { soft: 0.001 }), 0.4, 0); return s; });
    const c = K.scatter(L + xf, () => 10 + 45 * it, (rng) => pool[(rng.next() * 14) | 0], (t, rng) => 0.9 * Math.pow(rng.next(), 2.4) + (rng.chance(0.03) ? 0.6 : 0)), roar = K.noise(L + xf, 'brown'); K.lp(roar, 260); const w = loopWander(K, n, 1.3), hiss = K.noise(L + xf, 'pink'); K.hp(hiss, 3000);
    for (let i = 0; i < n; i++) o[i] = c[i] * 0.9 + roar[i] * (0.18 + 0.3 * w[i]) + hiss[i] * 0.03 * (0.5 + w[i]);
  } else if (kind === 'ice') {
    const pool = Array.from({ length: 12 }, () => K.ring(0.15, [[R.range(2000, 7000), 1, R.range(0.015, 0.06)], [R.range(600, 1500), 0.4, 0.05]], { soft: 0.0002 })), c = cloud(K, L + xf, () => 1.2 + 4 * it, pool, 0.7), low = K.noise(L + xf, 'brown'); K.lp(low, 120); for (let i = 0; i < n; i++) o[i] = c[i] + low[i] * 0.06;
  } else if (kind === 'static') {
    const a = K.noise(L + xf, 'white'), w = loopWander(K, n, 14); K.hp(a, 800); for (let i = 0; i < n; i++) o[i] = a[i] * Math.pow(w[i], 3) * (0.3 + 0.7 * it);
    const pool = Array.from({ length: 8 }, () => K.burst(0.006, { atk: 0.00005, tau: 0.001, hp: 1500 })), c = cloud(K, L + xf, () => 5 + 20 * it, pool, 0.6); for (let i = 0; i < n; i++) o[i] += c[i];
  } else { // electric: 100 Hz arcing buzz bursts + sparks
    const a = K.noise(L + xf, 'white'); K.bp(a, 2600, 0.5); const w = loopWander(K, n, 6), b = K.tone(L + xf, 100, { harm: [1, 0.6, 0.5, 0.4, 0.3, 0.3], tau: 1e6, atk: 0 });
    for (let i = 0; i < n; i++) { const g = Math.pow(w[i], 4) * (0.3 + 0.7 * it); o[i] = (a[i] * 0.5 + b[i] * 0.3) * g; }
    const pool = Array.from({ length: 8 }, () => K.burst(0.012, { atk: 0.0001, tau: 0.003, hp: 1800 })), c = cloud(K, L + xf, () => 3 + 14 * it, pool, 0.8); for (let i = 0; i < n; i++) o[i] += c[i];
  }
  return K.makeLoop(o, xf);
}
function* machine(K, kind, rpm, def) {
  const R = K.rng;
  switch (kind) {
    case 'diesel': return yield* diesel(K, 4, Math.max(8, rpm / 60 * (def.cylinders ?? 4) / 2), 1);
    case 'generator': { const d = yield* diesel(K, 5, Math.max(10, rpm / 60 / 2 * (def.cylinders ?? 2)), 1), h = loopTones(K, 5, 50, [[1, 1], [2, 0.5], [3, 0.35], [4, 0.2]]), w = loopWander(K, d.length, 0.6); return d.map((v, i) => v * (0.75 + 0.25 * w[i]) + h[i] * 0.06); }
    case 'gears': { const L = 6, hz = def.rate ?? 1.4, N = Math.max(2, Math.round(hz * L)), n = K.n(L), s = new Float32Array(n), m = loopTones(K, L, 40, [[1, 1], [2, 0.5], [3, 0.3]]), rum = loopNoise(K, L, 'brown', (a) => K.lp(a, 220));
      for (let k = 0; k < N; k++) { const at = Math.round((k + R.range(-0.04, 0.04)) / N * n); circMix(s, K.ring(0.3, partialsFrom(R.range(700, 1500), PLATE, 0.05), { soft: 0.0004 }), 0.35, at); circMix(s, K.thump(0.12, 150, 70, 0.02, 0.04), 0.6, at); circMix(s, K.burst(0.03, { atk: 0.0002, tau: 0.008, bp: 1500, q: 0.7 }), 0.4, at); for (let j = 1; j <= 3; j++) circMix(s, grain(K, R.range(1400, 3500), 0.006), 0.15, at + Math.round(j * 0.03 * K.sr)); }
      for (let i = 0; i < n; i++) s[i] = s[i] + m[i] * 0.03 + rum[i] * 0.12; return s; }
    case 'fan': { const bpf = Math.max(80, rpm / 60 * (def.blades ?? 5)), t = loopTones(K, 4, bpf, [[1, 1], [2, 0.5], [3, 0.35], [4, 0.2], [5, 0.1]], { beat: 0.5, beatAmp: 0.2 }), a = loopNoise(K, 4, 'pink', (x) => K.lp(x, 3200), [{ cycles: 2, depth: 0.15 }]); return t.map((v, i) => v * 0.05 + a[i] * 0.5); }
    case 'steam': { const L = 5, hz = Math.max(1, rpm / 60), N = Math.round(hz * L), n = K.n(L), s = new Float32Array(n); for (let k = 0; k < N; k++) { const at = Math.round(k / N * n), ch = K.burst(0.22, { color: 'pink', atk: 0.006, tau: 0.06 }); K.svf(ch, 'lp', (i) => 2600 - 2000 * i / ch.length, 0.8); circMix(s, ch, k % 4 === 0 ? 1 : 0.7, at); circMix(s, K.thump(0.12, 120, 60, 0.02, 0.04), 0.4, at); circMix(s, K.burst(0.006, { atk: 0.00005, tau: 0.002, hp: 2000 }), 0.2, at + Math.round(0.11 * K.sr)); } const h = loopNoise(K, L, 'white', (x) => { K.hp(x, 2500); K.lp(x, 9000); }); for (let i = 0; i < n; i++) s[i] = s[i] * 0.6 + h[i] * 0.08; return s; }
    case 'motor': { const f = 100, t = loopTones(K, 4, f, [[1, 1], [2, 0.6], [3, 0.3], [4, 0.2], [6, 0.1]], { beat: 0.5, beatAmp: 0.3 }), w = loopTones(K, 4, def.whine ?? 1800, [[1, 1], [1.5, 0.3]], { beat: 0.25, beatAmp: 0.4 }), b = loopNoise(K, 4, 'pink', (x) => K.bp(x, 2500, 0.8)), r = loopNoise(K, 4, 'brown', (x) => K.lp(x, 200)); return t.map((v, i) => v * 0.1 + w[i] * 0.02 + b[i] * 0.08 + r[i] * 0.2); }
    case 'pump': { const L = 4, hz = Math.max(1, rpm / 60), N = Math.round(hz * L), n = K.n(L), s = new Float32Array(n); for (let k = 0; k < N; k++) { const at = Math.round(k / N * n); circMix(s, K.thump(0.18, 100, 55, 0.03, 0.06), 1, at); circMix(s, K.burst(0.12, { color: 'pink', atk: 0.004, tau: 0.04, bp: 900, q: 0.7 }), 0.5, at + Math.round(0.05 * K.sr)); } const h = loopTones(K, L, 50, [[1, 1], [2, 0.4]]), r = loopNoise(K, L, 'brown', (x) => K.lp(x, 250)); for (let i = 0; i < n; i++) s[i] = s[i] * 0.6 + h[i] * 0.05 + r[i] * 0.1; return s; }
    case 'compressor': { const L = 6, n = K.n(L), s = new Float32Array(n); for (let k = 0; k < 2; k++) { const at = Math.round(k * 1.1 / L * n); for (let j = 0; j < 8; j++) circMix(s, K.thump(0.1, 110, 60, 0.02, 0.035), 0.9 - j * 0.05, at + Math.round(j * 0.12 * K.sr)); } circMix(s, K.burst(0.9, { atk: 0.01, tau: 0.35, hp: 2500, lp: 9000 }), 0.35, Math.round(2.4 / L * n)); const r = loopNoise(K, L, 'brown', (x) => K.lp(x, 180)); for (let i = 0; i < n; i++) s[i] = s[i] + r[i] * 0.12; return s; }
    case 'clock': { const L = 4, hz = Math.max(0.5, rpm / 60), N = Math.max(2, Math.round(hz * L)), n = K.n(L), s = new Float32Array(n); for (let k = 0; k < N; k++) { const at = Math.round(k / N * n), tock = k % 2; circMix(s, K.ring(0.15, [[tock ? 1900 : 2500, 1, 0.012], [tock ? 900 : 1200, 0.5, 0.02]], { soft: 0.0001 }), 0.8, at); circMix(s, K.thump(0.05, 260, 140, 0.008, 0.012), 0.4, at); circMix(s, K.burst(0.004, { atk: 0.00003, tau: 0.001, hp: 3000 }), 0.3, at); } const r = loopNoise(K, L, 'pink', (x) => K.lp(x, 400)); for (let i = 0; i < n; i++) s[i] += r[i] * 0.02; return s; }
    case 'turbine': { const f = Math.max(150, rpm / 60 * 3), t = loopTones(K, 4, f, [[1, 1], [2, 0.6], [3, 0.4], [5, 0.2], [7.03, 0.1]], { beat: 0.5, beatAmp: 0.3 }), a = loopNoise(K, 4, 'pink', (x) => K.lp(x, 6000)); return t.map((v, i) => v * 0.05 + a[i] * 0.4); }
    default: { const t = loopTones(K, 4, rpm / 60 * 2 || 50, [[1, 1], [2, 0.5], [3, 0.3]]), a = loopNoise(K, 4, 'pink', (x) => K.lp(x, 1500)); return t.map((v, i) => v * 0.06 + a[i] * 0.3); }
  }
}
