// UI / gameplay stingers: points, buy, deny, round start/end (dark string stingers), mystery-box music box + teddy, five perk jingles (each its own
// original melody + timbre), four power-up stingers, menu clicks. Synthesis: FM bells, PolyBLEP strings/brass with filter sweeps, comb-tine (cantilever) music box,
// modal plucks, baked Schroeder reverb. Everything is short-lived and built at 32 kHz (content is < 12 kHz).
import * as dsp from '../dsp.js';
import { synth, VOWELS as V } from './vocal.js';
import { BELL, TINE, partialsFrom, grain, crunch, bubble, swish } from './common.js';

const SR = 32000, mh = dsp.midiHz;
const cents = (K, c) => Math.pow(2, K.rng.gauss() * c / 1200);
/** bowed-string-like tone: 3 detuned band-limited saws, vibrato, slow attack, low-pass that opens with the bow */
function strings(K, f, dur, { atk = 0.5, rel = 0.6, vib = 0.004, lp = 2800, det = 7, gain = 1 } = {}) {
  const n = K.n(dur), o = new Float32Array(n);
  for (const d of [-det, 0, det]) { const ff = f * Math.pow(2, d / 1200) * cents(K, 2), vf = K.rng.range(4.6, 5.6), ph = K.rng.next() * 6.28; const s = K.saw(dur, (i) => ff * (1 + vib * Math.sin(6.283 * vf * i / K.sr + ph))); for (let i = 0; i < n; i++) o[i] += s[i] / 3; }
  const na = atk * K.sr, nr = rel * K.sr; K.svf(o, 'lp', (i) => 350 + (lp - 350) * Math.min(1, i / (na * 1.4)), 0.8);
  for (let i = 0; i < n; i++) { let e = 1; if (i < na) { const u = i / na; e = u * u * (3 - 2 * u); } if (n - i < nr) e *= (n - i) / nr; o[i] *= e * gain; }
  return o;
}
/** brass-like note: saw through a resonant low-pass that swells open (the "blat") */
function brass(K, f, dur, { atk = 0.04, lp0 = 350, lp1 = 3200, rel = 0.12, gain = 1, det = 4 } = {}) {
  const n = K.n(dur), a = K.saw(dur, f * cents(K, det)), b = K.saw(dur, f * 1.004), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = 0.5 * (a[i] + b[i]);
  const na = Math.max(1, atk * K.sr); K.svf(o, 'lp', (i) => lp0 + (lp1 - lp0) * Math.min(1, i / (na * 3.5)), 1.1); const nr = rel * K.sr;
  for (let i = 0; i < n; i++) { let e = i < na ? i / na : 1; if (n - i < nr) e *= (n - i) / nr; o[i] *= e * gain; } return o;
}
const bell = (K, f, dur, tau = 0.6, g = 1) => K.ring(dur, partialsFrom(f, BELL, tau), { soft: 0.0001, gain: g });
const tine = (K, f, dur, tau = 0.5, g = 1) => K.ring(dur, partialsFrom(f, TINE, tau), { soft: 0.0001, gain: g, detune: 0.0008 });
const fmBell = (K, f, dur, g = 1, idx = 3.2) => K.fm(dur, f, 3.5, idx, { idxTau: 0.18, tau: dur * 0.35, atk: 0.001 }).map((v) => v * g);
const kick = (K, dur = 0.35, f0 = 120, f1 = 42) => K.thump(dur, f0, f1, 0.035, 0.11, { drive: 1.6 });
const snare = (K) => { const s = K.burst(0.18, { atk: 0.0004, tau: 0.045, hp: 900 }); K.mix(s, K.thump(0.1, 220, 150, 0.03, 0.04), 0.5, 0); return s; };
const shaker = (K, d = 0.06) => K.burst(d, { atk: 0.004, tau: d * 0.35, hp: 5200 });

export function install(lib) {
  const P = (extra) => ({ sr: SR, prio: 1, ...extra }), UI = { bus: 'ui', prio: 10, refDist: 1, send: 0 };
  // ------------------------------------------------------------------------------------------- basic UI
  lib.def('ui.point', P({ n: 3, peak: 0.42, prio: 3, meta: UI }), (K, i) => { const s = K.buf(0.13), f = 1320 * Math.pow(2, (i - 1) * 0.07); K.mix(s, K.ring(0.12, [[f, 1, 0.02], [f * 2.01, 0.25, 0.012]], { soft: 0.0001 }), 0.8, 0); K.mix(s, K.ring(0.1, [[f * 1.335, 1, 0.022]], { soft: 0.0001 }), 0.75, 0.035); K.mix(s, K.burst(0.003, { atk: 0.00005, tau: 0.001, hp: 3000 }), 0.35, 0); return s; });
  lib.def('ui.buy', P({ n: 2, peak: 0.55, prio: 3, meta: UI }), (K, i) => { const s = K.buf(1.0); K.mix(s, K.burst(0.03, { atk: 0.0002, tau: 0.008, bp: 1800, q: 0.7 }), 0.8, 0); K.mix(s, K.thump(0.08, 160, 80, 0.015, 0.03), 0.6, 0); K.mix(s, bell(K, 2640 * Math.pow(2, i * 0.05), 0.9, 0.3), 0.7, 0.045); K.mix(s, crunch(K, 0.25, 90, 0.08, 3500, 7500, 0.006, 0.02, 0.4), 1, 0.07); return s; });
  lib.def('ui.deny', P({ n: 2, peak: 0.45, prio: 3, meta: UI }), (K, i) => { const s = K.buf(0.42); for (const t of [0, 0.15]) { const b = K.pulse(0.11, (j) => 140 - 18 * (j / (0.11 * K.sr)), { pw: 0.35 }); K.lp(b, 900); K.env(b, { atk: 0.004, tau: 0.09 }); K.mix(s, b, 0.8, t); K.mix(s, K.thump(0.09, 90, 60, 0.03, 0.03), 0.5, t); } return s; });
  for (const [nm, f, d, fmul] of [['click', 1800, 0.05, 1], ['hover', 2600, 0.03, 0.5], ['confirm', 1200, 0.16, 1], ['back', 900, 0.12, 1], ['tab', 2200, 0.04, 0.8]]) lib.def('ui.' + nm, P({ peak: 0.3 * fmul + 0.1, prio: 3, meta: UI }), (K) => { const s = K.buf(d * 3 + 0.05); K.mix(s, K.ring(d * 2, [[f, 1, d * 0.4], [f * 1.5, 0.4, d * 0.3]], { soft: 0.0002 }), 1, 0); if (nm === 'confirm') K.mix(s, K.ring(0.2, [[f * 1.5, 1, 0.05]], { soft: 0.0002 }), 0.7, 0.07); if (nm === 'back') s.reverse(); K.mix(s, K.burst(0.004, { atk: 0.00005, tau: 0.001, hp: 2500 }), 0.3, 0); return s; });
  // ------------------------------------------------------------------------------------------- round stingers
  lib.def('ui.round.start', P({ peak: 0.9, norm: 'rms', rms: 0.078, prio: 1, meta: { ...UI, prio: 10, duck: [0.55, 3.4] } }), function* (K) { // riser -> sub hit -> dissonant string cluster with reverb
    const T = 4.6, s = K.buf(T), R = K.rng; yield;
    const rise = K.noise(1.0, 'white'); K.env(rise, { atk: 0.85, tau: 0.08 }); K.svf(rise, 'bp', (i) => 300 + 3800 * Math.pow(i / (1.0 * K.sr), 2), 1.6); K.mix(s, rise, 0.4, 0); yield;
    for (const f of [mh(38), mh(50.6)]) K.mix(s, strings(K, f * 2, 3.6, { atk: 1.2, rel: 1.8, lp: 1800, gain: 0.35 }), 1, 0.1); yield; // slow low pad
    for (const m of [50, 51, 56.02, 57, 62.5]) K.mix(s, strings(K, mh(m), 3.4, { atk: 0.9, rel: 1.6, lp: 3200 - (m - 50) * 30, det: 9, vib: 0.006, gain: 0.5 }), 0.6, 0.6); yield; // D3 Eb3 Ab3 A3 D4(+50c): minor-second/tritone cluster
    K.mix(s, K.thump(1.8, 66, 26, 0.3, 0.7, { drive: 2.2 }), 0.95, 0.9); K.mix(s, K.burst(0.3, { color: 'pink', atk: 0.003, tau: 0.09, lp: 500 }), 0.6, 0.9); K.mix(s, K.burst(0.02, { atk: 0.0001, tau: 0.006, hp: 300 }), 0.6, 0.9); yield;
    for (let k = 0; k < 4; k++) K.mix(s, K.thump(0.5, 90, 45, 0.05, 0.14), 0.25, 0.9 + 0.7 * k + (k % 2) * 0.03); yield; // distant timpani ostinato
    return K.verb(s, { rt: 2.4, wet: 0.35, damp: 0.5, pre: 0.02 });
  });
  lib.def('ui.round.end', P({ peak: 0.9, norm: 'rms', rms: 0.078, prio: 1, meta: { ...UI, prio: 10, duck: [0.45, 2.8] } }), function* (K) { // falling minor strings + low brass sigh
    const T = 3.4, s = K.buf(T); yield;
    for (const [k, m] of [[0, 57], [1, 52], [2, 48.02], [3, 45]]) { const f = mh(m), n = K.n(2.6), d = strings(K, f, 2.6, { atk: 0.25 + 0.05 * k, rel: 1.2, lp: 2600, det: 8, gain: 0.55 }); K.mix(s, d, 1, 0.0 + k * 0.07); }
    const g = K.saw(2.4, (i) => mh(45) * (1 - 0.18 * i / (2.4 * K.sr))); K.svf(g, 'lp', (i) => 900 - 500 * i / (2.4 * K.sr), 1.2); K.env(g, { atk: 0.3, tau: 0.9 }); K.mix(s, g, 0.7, 0.1); yield;
    K.mix(s, K.thump(1.6, 55, 28, 0.25, 0.55, { drive: 1.8 }), 0.8, 0.05); K.mix(s, K.low(4, (K2) => { const a = K2.noise(2.6, 'brown'); K2.env(a, { atk: 0.3, tau: 0.9 }); K2.lp(a, 180); return a; }), 0.4, 0); yield;
    return K.verb(s, { rt: 2.2, wet: 0.3, damp: 0.55 });
  });
  // ------------------------------------------------------------------------------------------- mystery box
  lib.def('ui.box.open', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, duck: [0.3, 1.6] } }), function* (K) { // detuned comb-tine music box melody (A minor), pin clicks, winding-down last notes
    const R = K.rng, notes = [69, 72, 76, 81, 79, 76, 72, 74, 77, 81, 79, 77, 76, 72, 71, 69], T = 6.2, s = K.buf(T); let t = 0.04, dt = 0.26; yield;
    notes.forEach((m, k) => { const wind = k > 11 ? 1 + (k - 11) * 0.22 : 1, f = mh(m) * cents(K, 14) * (1 - 0.012 * Math.max(0, k - 11)); K.mix(s, tine(K, f, 1.6, 0.42, 1), 0.75 * (k > 11 ? 0.8 : 1), t); K.mix(s, K.burst(0.004, { atk: 0.00005, tau: 0.001, hp: 3000 }), 0.12, t - 0.001); t += dt * wind * R.range(0.96, 1.05); }); yield;
    K.mix(s, K.burst(T, { color: 'pink', atk: 0.3, tau: 3, lp: 600 }), 0.02, 0); return K.verb(s, { rt: 1.5, wet: 0.22, damp: 0.4 }); yield;
  });
  lib.def('ui.box.teddy', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: UI }), function* (K) { // creepy child giggle -> witch cackle over a music box running down
    const R = K.rng, T = 4.4, s = K.buf(T), gig = new Float32Array(K.n(1.2)); let t = 0; yield;
    for (let k = 0; k < 7; k++) { const f = 640 * (1 + 0.16 * Math.sin(k * 0.9)) * Math.pow(0.985, k), d = 0.1; dsp.mixInto(gig, synth(K.sr, { dur: d, f0: [[0, f * 1.05], [d, f * 0.93]], vowels: [[0, ...V.i], [d, ...V.e]], amp: [[0, 0], [0.012, 1], [0.06, 0.6], [d, 0]], breath: 0.55, open: 0.72, fscale: 1.3, rasp: 0.1, jitter: 0.04, bw: [90, 130, 200] }, R), 0.8, Math.round(t * K.sr)); t += 0.115 * R.range(0.92, 1.08); }
    K.mix(s, gig, 1, 0.1); yield;
    let tc = 1.55; for (let k = 0; k < 5; k++) { const f = 400 * Math.pow(0.86, k), d = 0.18; K.mix(s, synth(K.sr, { dur: d, f0: [[0, f * 1.15], [d, f * 0.8]], vowels: [[0, ...V.a], [d, ...V.uh]], amp: [[0, 0], [0.015, 1], [0.1, 0.5], [d, 0]], breath: 0.5, open: 0.7, fscale: 1.05, rasp: 0.55, jitter: 0.05, vib: 0.02, vibHz: 8 }, R), 0.9, tc); tc += 0.22 * (1 + 0.05 * k); }
    let m = 0, sp = 1; for (let k = 0; k < 9; k++) { const f = mh([69, 72, 76, 74, 72, 69, 67, 64, 60][k]) * sp; K.mix(s, tine(K, f, 1.2, 0.35), 0.35, 0.05 + m); m += 0.28 * (1 + k * 0.12); sp *= 0.965; }
    return K.verb(s, { rt: 1.8, wet: 0.3, damp: 0.5 });
  });
  // ------------------------------------------------------------------------------------------- perk jingles (five different melodies & timbres)
  lib.def('perk.juggernog', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, prio: 10, duck: [0.35, 1.8] } }), function* (K) { // heavy brass fanfare + timpani (E-flat)
    const s = K.buf(3.6), seq = [[51, 0, 0.2], [58, 0.22, 0.2], [63, 0.44, 0.5], [67, 0.98, 0.22], [70, 1.2, 0.26], [75, 1.46, 1.2]]; yield;
    for (const [m, t, d] of seq) { K.mix(s, brass(K, mh(m), d + 0.12, { lp1: 3600, gain: 0.7 }), 0.55, t); K.mix(s, brass(K, mh(m - 12), d + 0.12, { lp1: 1400, gain: 0.7 }), 0.45, t); }
    for (const t of [0, 0.44, 0.98, 1.46]) K.mix(s, K.thump(0.45, 105, 50, 0.04, 0.13, { drive: 1.5 }), 0.9, t); yield;
    K.mix(s, K.burst(1.6, { atk: 0.02, tau: 0.6, hp: 4500 }), 0.12, 1.5); K.mix(s, bell(K, mh(87), 1.8, 0.7), 0.16, 1.5); yield;
    return K.verb(s, { rt: 1.8, wet: 0.22, damp: 0.45 });
  });
  lib.def('perk.speedcola', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, prio: 10, duck: [0.35, 1.8] } }), function* (K) { // bubbly bright FM-bell run + fizz + chime
    const s = K.buf(2.6), run = [72, 74, 76, 79, 81, 84, 86, 88]; yield;
    run.forEach((m, k) => K.mix(s, fmBell(K, mh(m), 0.5, 0.8, 2.6), 0.6, k * 0.085)); yield;
    for (let k = 0; k < 14; k++) K.mix(s, bubble(K, K.rng.range(500, 1600), 0.01, 1.5), 0.22, 0.02 + k * 0.06 + K.rng.next() * 0.03); yield;
    K.mix(s, K.burst(0.8, { atk: 0.01, tau: 0.25, hp: 5500 }), 0.1, 0.05); yield;
    K.mix(s, bell(K, mh(91), 1.6, 0.6), 0.5, 0.72); K.mix(s, bell(K, mh(96), 1.4, 0.5), 0.3, 0.74); yield;
    return K.verb(s, { rt: 1.0, wet: 0.16, damp: 0.3 });
  });
  lib.def('perk.doubletap', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, prio: 10, duck: [0.35, 1.8] } }), function* (K) { // driven power-chord "da-DUM da-DUM" + cowbell + snare
    const s = K.buf(2.6), hit = (t, amp) => { const c = new Float32Array(K.n(0.7)); for (const m of [40, 47, 52]) dsp.mixInto(c, K.pluck(0.7, mh(m), { tau: 0.45, harmonics: 12, bright: 0.85, pos: 0.12 }), 1, 0); K.sat(c, 5); K.lp(c, 3800); K.mix(s, c, amp, t); K.mix(s, kick(K, 0.3), amp * 0.7, t); }; yield;
    hit(0, 0.6); hit(0.16, 0.75); hit(0.5, 0.6); hit(0.66, 0.85); K.mix(s, snare(K), 0.6, 0.33); K.mix(s, snare(K), 0.65, 0.83); yield;
    for (const t of [0.08, 0.24, 0.58, 0.74]) K.mix(s, K.ring(0.3, [[562, 1, 0.09], [845, 0.7, 0.07], [1690, 0.2, 0.03]], { soft: 0.0002 }), 0.3, t); yield;
    K.mix(s, K.burst(1.2, { atk: 0.005, tau: 0.45, hp: 6000 }), 0.1, 0.83); return K.verb(s, { rt: 0.9, wet: 0.12, damp: 0.4 }); yield;
  });
  lib.def('perk.quickrevive', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, prio: 10, duck: [0.35, 2.2] } }), function* (K) { // heavenly: harp/glockenspiel arpeggio over a slow choir-like pad
    const s = K.buf(4.0); [77, 81, 84, 88, 93].forEach((m, k) => { K.mix(s, K.pluck(1.4, mh(m), { tau: 0.9, harmonics: 8, bright: 0.6, pos: 0.25 }), 0.5, 0.05 + k * 0.15); K.mix(s, bell(K, mh(m + 12), 1.2, 0.5), 0.1, 0.05 + k * 0.15); }); yield;
    for (const m of [65, 69, 72, 76]) { const p = K.tone(3.4, mh(m), { harm: [1, 0.3, 0.12, 0.05], atk: 0.7, vib: 0.006, vibHz: 5.2, rel: 1.4, tau: 5 }); K.mix(s, p, 0.13, 0.35); const p2 = K.tone(3.4, mh(m) * 1.003, { harm: [1, 0.3, 0.1], atk: 0.9, vib: 0.005, vibHz: 4.8, rel: 1.4, tau: 5 }); K.mix(s, p2, 0.1, 0.4); }
    K.mix(s, bell(K, mh(100), 2.4, 1.0), 0.16, 0.85); return K.verb(s, { rt: 2.6, wet: 0.3, damp: 0.35 }); yield;
  });
  lib.def('perk.staminup', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, prio: 10, duck: [0.35, 1.8] } }), function* (K) { // jazzy trumpet riff (FM) with shaker and kick, G major
    const s = K.buf(2.8), riff = [[67, 0, 0.1], [69, 0.11, 0.1], [71, 0.22, 0.1], [74, 0.33, 0.16], [76, 0.52, 0.1], [74, 0.64, 0.1], [71, 0.76, 0.1], [67, 0.88, 0.1], [69, 1.0, 0.1], [71, 1.11, 0.1], [74, 1.22, 0.1], [79, 1.36, 0.9]]; yield;
    for (const [m, t, d] of riff) { const tr = K.fm(d + 0.25, mh(m), 1, 2.2, { idxTau: 0.05, tau: d * 1.4 + 0.06, atk: 0.012 }); K.svf(tr, 'lp', 3400, 0.9); K.mix(s, tr, 0.55, t); }
    for (let k = 0; k < 16; k++) K.mix(s, shaker(K), 0.16 + (k % 4 === 0 ? 0.08 : 0), 0.05 + k * 0.095); for (const t of [0, 0.44, 0.88, 1.32]) K.mix(s, kick(K, 0.25, 130, 50), 0.6, t); yield;
    K.mix(s, bell(K, mh(103), 1.0, 0.4), 0.14, 1.36); return K.verb(s, { rt: 1.1, wet: 0.14, damp: 0.4 }); yield;
  });
  // ------------------------------------------------------------------------------------------- power-ups
  lib.def('powerup.maxammo', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, prio: 10, duck: [0.35, 2.0] } }), function* (K) { // magazine "clack-clack" then rising triple bell
    const s = K.buf(2.0); for (const [t, g] of [[0, 1], [0.09, 0.85]]) { K.mix(s, K.ring(0.2, [[1500, 1, 0.012], [2900, 0.6, 0.01], [4400, 0.3, 0.008]], { soft: 0.0001 }), 0.7 * g, t); K.mix(s, K.burst(0.02, { atk: 0.00005, tau: 0.004, hp: 800 }), 0.6 * g, t); K.mix(s, K.thump(0.08, 180, 90, 0.02, 0.03), 0.5 * g, t); }
    [88, 92, 95].forEach((m, k) => { K.mix(s, bell(K, mh(m), 1.2, 0.45 - k * 0.05), 0.55, 0.3 + k * 0.13); }); K.mix(s, crunch(K, 0.6, 80, 0.3, 4000, 9000, 0.004, 0.015, 0.25), 1, 0.4); return K.verb(s, { rt: 1.0, wet: 0.14, damp: 0.3 }); yield;
  });
  lib.def('powerup.instakill', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, prio: 10, duck: [0.5, 2.4] } }), function* (K) { // skull horn + tritone stab + inhuman shriek
    const R = K.rng, s = K.buf(2.4); const horn = K.saw(1.2, (i) => mh(38) * (1 + 0.32 * Math.min(1, i / (0.4 * K.sr)))); K.svf(horn, 'lp', (i) => 500 + 1800 * Math.min(1, i / (0.5 * K.sr)), 1.6); K.sat(horn, 3); K.env(horn, { atk: 0.05, tau: 0.5 }); K.mix(s, horn, 0.8, 0); yield;
    for (const m of [60, 66]) K.mix(s, brass(K, mh(m), 0.9, { lp1: 2600, gain: 0.7, atk: 0.02 }), 0.4, 0.05); yield;
    K.mix(s, synth(K.sr, { dur: 1.1, f0: [[0, 420], [0.5, 860], [1.1, 600]], vowels: [[0, ...V.a], [0.5, ...V.ae], [1.1, ...V.o]], amp: [[0, 0], [0.04, 1], [0.8, 0.8], [1.1, 0]], breath: 0.4, rasp: 0.85, sub: 0.4, growl: 0.4, growlHz: 34, jitter: 0.05, fscale: 1.05 }, R), 0.6, 0.3); yield;
    K.mix(s, K.thump(1.0, 60, 30, 0.2, 0.4, { drive: 2 }), 0.8, 0); return K.verb(s, { rt: 1.6, wet: 0.25, damp: 0.5 }); yield;
  });
  lib.def('powerup.doublepoints', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, prio: 10, duck: [0.35, 2.0] } }), function* (K) { // coin cascade + two bright pings
    const R = K.rng, s = K.buf(2.0); for (let k = 0; k < 22; k++) { const t = 0.05 + Math.pow(R.next(), 1.5) * 1.0, f = R.range(2400, 5400); K.mix(s, K.ring(0.3, [[f, 1, R.range(0.05, 0.11)], [f * 1.5, 0.4, 0.04]], { soft: 0.0001 }), 0.22, t); K.mix(s, K.burst(0.004, { atk: 0.00005, tau: 0.001, hp: 3500 }), 0.1, t); }
    K.mix(s, bell(K, mh(88), 1.4, 0.55), 0.6, 0); K.mix(s, bell(K, mh(95), 1.4, 0.55), 0.55, 0.13); K.mix(s, K.sweep(0.5, (u) => 500 + 3500 * u * u, { harm: [1, 0.3], atk: 0.1, rel: 0.1, amp: (u) => u * 0.4 }), 0.25, 0.0); return K.verb(s, { rt: 1.0, wet: 0.14, damp: 0.3 }); yield;
  });
  lib.def('powerup.spawn', P({ n: 2, peak: 0.7, prio: 1, meta: { bus: 'sfx', prio: 6, refDist: 4, maxDist: 60, send: 0.8 } }), function* (K, i) { // a power-up materialising: glassy rising bell cascade + airy sweep + sparkle
    const s = K.buf(1.7), base = 84 + i * 2;
    [0, 4, 7, 12, 16].forEach((m, k) => K.mix(s, bell(K, mh(base + m), 1.2, 0.42 - k * 0.03), 0.4 - k * 0.04, 0.05 + k * 0.075));
    K.mix(s, K.sweep(0.9, (u) => 700 + 4300 * u * u, { harm: [1, 0.25], atk: 0.25, rel: 0.25, amp: (u) => Math.sin(Math.PI * u) }), 0.18, 0); K.mix(s, crunch(K, 1.0, 120, 0.4, 4500, 10000, 0.003, 0.012, 0.22), 1, 0.05); yield;
    return K.verb(s, { rt: 1.2, wet: 0.2, damp: 0.3 });
  });
  lib.def('powerup.nuke', P({ peak: 0.9, norm: 'rms', rms: 0.1, prio: 1, meta: { ...UI, prio: 10, duck: [0.6, 4.0] } }), function* (K) { // rising air-raid siren -> sub boom + ring
    const R = K.rng, s = K.buf(4.2); const sir = K.sweep(2.1, (u) => 500 + 380 * Math.sin(u * 6.283 * 2.2 - 0.6), { harm: [1, 0.35, 0.18, 0.09], atk: 0.2, rel: 0.1, amp: (u) => 0.25 + 0.75 * u }); K.mix(s, sir, 0.55, 0); yield;
    K.mix(s, K.burst(0.05, { atk: 0.0002, tau: 0.012, hp: 300 }), 1, 1.9); K.mix(s, K.thump(2.2, 84, 24, 0.35, 0.8, { drive: 2.4 }), 1, 1.9); K.mix(s, K.low(4, (K2) => { const a = K2.noise(2.3, 'pink'); K2.env(a, { atk: 0.006, tau: 0.6 }); return K2.svf(a, 'lp', (i) => 150 + 2200 * Math.exp(-i / (0.3 * K2.sr)), 0.8); }), 0.9, 1.9); yield;
    K.mix(s, K.tone(2.0, 6000, { atk: 0.4, tau: 1.6 }), 0.03, 2.0); K.mix(s, bell(K, mh(60), 2.0, 1.2), 0.15, 1.95); return K.verb(s, { rt: 1.8, wet: 0.2, damp: 0.5 }); yield;
  });
}
