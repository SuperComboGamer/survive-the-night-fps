// Generative retro / carnival music: original tunes composed at runtime (scale + motif + section form), rendered note by note from procedurally synthesised
// instruments (calliope, music box, cheap synth, accordion, church organ, bells) into a phrase buffer, deliberately a little out of tune (per-note detune, slow pitch
// drift "wow", tempo wobble, occasional dropped or stuck notes) so it sounds like worn machinery. No two phrases are alike.
import * as dsp from '../dsp.js';
import { BELL, TINE, partialsFrom } from './common.js';

const MODES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harmonicMinor: [0, 2, 3, 5, 7, 8, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10] };
export const TUNES = {
  carousel: { meter: 3, tempo: 118, mode: 'major', root: 60, acc: 'waltz', kind: 'calliope', bars: 8 },
  lullaby: { meter: 3, tempo: 80, mode: 'minor', root: 69, acc: 'arp', kind: 'musicbox', bars: 8 },
  circus: { meter: 2, tempo: 136, mode: 'major', root: 65, acc: 'oompah', kind: 'calliope', bars: 8 },
  spooky: { meter: 3, tempo: 72, mode: 'phrygian', root: 62, acc: 'drone', kind: 'musicbox', bars: 8 },
  dirge: { meter: 4, tempo: 52, mode: 'harmonicMinor', root: 45, acc: 'chords', kind: 'organ', bars: 8 },
  shanty: { meter: 3, tempo: 104, mode: 'dorian', root: 55, acc: 'waltz', kind: 'accordion', bars: 8 },
  attract: { meter: 4, tempo: 126, mode: 'minor', root: 57, acc: 'arp16', kind: 'synth', bars: 8 },
  space: { meter: 4, tempo: 108, mode: 'lydian', root: 64, acc: 'arp16', kind: 'synth', bars: 8 },
  waltz: { meter: 3, tempo: 96, mode: 'minor', root: 57, acc: 'waltz', kind: 'accordion', bars: 8 },
  bells: { meter: 4, tempo: 60, mode: 'minor', root: 64, acc: 'chords', kind: 'bells', bars: 8 },
};
const CELLS = { 2: [[1, 1], [0.5, 0.5, 1], [1.5, 0.5], [0.5, 0.5, 0.5, 0.5]], 3: [[1, 1, 1], [2, 1], [1, 2], [1.5, 0.5, 1], [1, 0.5, 0.5, 1], [0.5, 0.5, 1, 1]], 4: [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [1.5, 0.5, 1, 1], [0.5, 0.5, 1, 2], [1, 0.5, 0.5, 1, 1]] };
const CHORD_DEG = [0, 0, 3, 0, 4, 4, 0, 0];

/** compose one phrase: returns notes [{t (beats), dur (beats), midi, vel, part}] */
export function compose(R, S) {
  const scale = MODES[S.mode] || MODES.minor, mid = (d) => S.root + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7], beats = S.meter, cells = CELLS[beats] || CELLS[4], bars = S.bars || 8, notes = [];
  let d = R.pick([0, 2, 4]) + 7; const motifR = R.pick(cells), steps = [0, R.pick([1, 2, -1]), R.pick([1, -1, 2]), R.pick([-1, 1, 2, -2])];
  for (let b = 0; b < bars; b++) {
    const sec = b < 2 ? 'A' : b < 4 ? 'A2' : b < 6 ? 'B' : 'C'; let rhythm = sec === 'B' ? R.pick(cells) : motifR; if (b === bars - 1) rhythm = [beats];
    let t = b * beats; for (let k = 0; k < rhythm.length; k++) {
      let st = sec === 'C' ? -R.pick([1, 1, 2]) : steps[k % steps.length] * (sec === 'B' ? -1 : 1); if (sec === 'A2' && k === rhythm.length - 1) st = 1; d = Math.max(2, Math.min(13, d + st)); if (b === bars - 1) d = 7;
      notes.push({ t, dur: rhythm[k], midi: mid(d), vel: k === 0 ? 1 : 0.72, part: 'mel' }); t += rhythm[k];
    }
    const cd = CHORD_DEG[b % 8], root = mid(cd), third = mid(cd + 2), fifth = mid(cd + 4), acc = S.acc;
    if (acc === 'waltz' || acc === 'oompah') { notes.push({ t: b * beats, dur: 1, midi: root - 12, vel: 0.7, part: 'bass' }); for (let k = 1; k < beats; k++) for (const m of [third, fifth]) notes.push({ t: b * beats + k, dur: 0.8, midi: m, vel: 0.4, part: 'acc' }); }
    else if (acc === 'arp' || acc === 'arp16') { const per = acc === 'arp' ? 0.5 : 0.25, seq = [root, third, fifth, third + 12, fifth, third]; for (let k = 0, t2 = b * beats; t2 < (b + 1) * beats - 1e-6; k++, t2 += per) notes.push({ t: t2, dur: per, midi: seq[k % seq.length] - 12 * (acc === 'arp' ? 1 : 0), vel: 0.45, part: 'acc' }); }
    else if (acc === 'chords') { for (const m of [root - 12, third - 12, fifth - 12]) notes.push({ t: b * beats, dur: beats, midi: m, vel: 0.5, part: 'acc' }); }
    else if (acc === 'drone') { if (b % 2 === 0) { notes.push({ t: b * beats, dur: beats * 2, midi: S.root - 24, vel: 0.5, part: 'bass' }); notes.push({ t: b * beats, dur: beats * 2, midi: S.root - 12 + 7, vel: 0.35, part: 'acc' }); } }
  }
  return notes;
}

// ---------------------------------------------------------------------------------------------------------- instruments
const INSTR = {
  musicbox: { sr: 24000, gain: 1, note: (K, f) => { const s = K.ring(2.4, partialsFrom(f, TINE, 0.6), { soft: 0.0001, detune: 0.0008, phase: 1.2 }); K.mix(s, K.burst(0.004, { atk: 0.00005, tau: 0.001, hp: 3000 }), 0.15, 0); return s; } },
  calliope: { sr: 24000, gain: 0.8, note: (K, f) => { const d = 0.42, n = K.n(d + 0.1), a = K.saw(d + 0.1, (i) => f * (1 + 0.03 * Math.exp(-i / (0.03 * K.sr)))), b = K.pulse(d + 0.1, f * 1.003, { pw: 0.3 }); const s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = a[i] * 0.6 + b[i] * 0.4; K.lp(s, 4200); const st = K.noise(d + 0.1, 'white'); K.hp(st, 2500); K.lp(st, 7000); for (let i = 0; i < n; i++) { const t = i / K.sr; let e = Math.min(1, t / 0.012); if (t > d) e *= Math.max(0, 1 - (t - d) / 0.06); s[i] = (s[i] + st[i] * 0.05) * e; } return s; } },
  synth: { sr: 24000, gain: 0.7, note: (K, f) => { const d = 0.5, s = K.pulse(d, f, { pw: (i) => 0.35 + 0.2 * Math.sin(i / K.sr * 6.283 * 5) }); K.lp(s, 3500); K.env(s, { atk: 0.003, tau: 0.13 }); return s; } },
  accordion: { sr: 24000, gain: 0.8, note: (K, f) => { const d = 0.6, n = K.n(d), a = K.saw(d, f * 0.9965), b = K.saw(d, f * 1.0035), c = K.pulse(d, f, { pw: 0.5 }), s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = a[i] * 0.4 + b[i] * 0.4 + c[i] * 0.3; K.lp(s, 3000); K.peak(s, 1200, 1.2, 6); const br = K.noise(d, 'pink'); K.bp(br, 2200, 0.6); for (let i = 0; i < n; i++) { const t = i / K.sr; s[i] = (s[i] + br[i] * 0.03) * Math.min(1, t / 0.05) * (t > d - 0.1 ? Math.max(0, (d - t) / 0.1) : 1); } return s; } },
  organ: { sr: 24000, gain: 0.7, note: (K, f) => { const d = 1.6, s = K.tone(d, f, { harm: [1, 0.7, 0.5, 0.42, 0.3, 0.25, 0.15, 0.1], atk: 0.09, rel: 0.3, tau: 1e4, vib: 0.002, vibHz: 5.5 }); K.mix(s, K.burst(0.03, { atk: 0.002, tau: 0.01, bp: 1400, q: 1 }), 0.1, 0); return s; } },
  bells: { sr: 24000, gain: 0.9, note: (K, f) => K.ring(3.0, partialsFrom(f, BELL, 1.1), { soft: 0.0002 }) },
  theremin: { sr: 24000, gain: 0.75, note: (K, f) => { const d = 1.5, s = K.sweep(d, (u) => f * (1 + 0.05 * Math.exp(-u * d / 0.05)) * (1 + 0.011 * Math.sin(6.2832 * 5.6 * u * d)), { harm: [1, 0.1, 0.04], atk: 0.07, rel: 0.3 }); K.lp(s, 3800); return s; } }, // heterodyne oscillator: near-sine with a swoop into each note and deep vibrato
};
const noteCache = new Map();
/** build (or fetch) the note sample for `kind` at midi (generator-friendly: cheap enough to call inline) */
function noteFor(kind, midi, sr, seedBase) {
  const key = kind + ':' + sr; let m = noteCache.get(key); if (!m) { m = new Map(); noteCache.set(key, m); }
  let s = m.get(midi); if (!s) { const K = dsp.kit(sr, (seedBase + midi * 131) >>> 0); s = INSTR[kind].note(K, dsp.midiHz(midi)); dsp.fadeEdges(s, 8, 32); m.set(midi, s); } return s;
}
export const musicKinds = () => Object.keys(INSTR);
export const instrumentSr = (kind) => (INSTR[kind] || INSTR.musicbox).sr;

/** phrase generator (yields between notes so the shared job queue can time-slice it). opts: {tune | style object, kind, seed, detune (cents sigma), wow 0..1, tempo, root} */
export function* renderPhrase(sr, opts = {}) {
  const R = new dsp.Rng(opts.seed ?? 1), tn = opts.tune && typeof opts.tune === 'object' ? opts.tune : null, explicit = !!(tn && Array.isArray(tn.notes)), style0 = tn && !explicit ? tn : TUNES[opts.tune] || TUNES.carousel;
  let S = { ...style0, ...(opts.tempo ? { tempo: opts.tempo } : null), ...(opts.root ? { root: opts.root } : null), ...(opts.mode ? { mode: opts.mode } : null) }, notes;
  if (explicit) { // stop-authored melody: tune = { bpm, notes: [[midi, beats], ...] } (midi 0 = rest), played as written (humanised by detune / wow), with a soft bass note on each bar's downbeat for sustained instruments
    const meter = tn.meter || 4; notes = []; let t = 0, bar0 = -1; for (const nt of tn.notes) { const m = nt[0] | 0, d = +nt[1] || 1, bar = Math.floor(t / meter + 1e-6); if (m > 0) { notes.push({ t, dur: d, midi: m, vel: t % meter < 1e-6 ? 1 : 0.78, part: 'mel' }); if (bar !== bar0 && (opts.kind || tn.kind || tn.style) !== 'theremin' && (opts.kind || tn.kind || tn.style) !== 'musicbox') { notes.push({ t: bar * meter, dur: meter, midi: Math.max(36, m - 12), vel: 0.42, part: 'bass' }); } } if (m > 0) bar0 = bar; t += d; }
    S = { meter, tempo: tn.bpm || tn.tempo || opts.tempo || 90, bars: Math.max(1, Math.ceil(t / meter)), kind: tn.kind || tn.style };
  } else notes = compose(R, S);
  const kind = opts.kind || S.kind, inst = INSTR[kind] || INSTR.musicbox, detune = opts.detune ?? 16, wow = opts.wow ?? 0.5, spb0 = 60 / S.tempo * R.range(0.94, 1.06);
  // tempo wobble: bar-by-bar drift; wow: slow pitch drift over the phrase
  const bars = S.bars || 8, drift = [], wobPh = R.next() * 6.28; for (let b = 0; b <= bars; b++) drift.push(1 + 0.035 * Math.sin(b * 1.3 + wobPh) * (0.5 + wow));
  const beatTime = (t) => { const b = Math.min(bars - 1, Math.floor(t / S.meter)); let acc = 0; for (let i = 0; i < b; i++) acc += S.meter * spb0 * drift[i]; return acc + (t - b * S.meter) * spb0 * drift[b]; };
  const total = beatTime(bars * S.meter) + 2.6, out = new Float32Array(Math.ceil(total * sr)); let cnt = 0;
  for (const nt of notes) {
    if (R.chance(0.025) && nt.part === 'mel') continue; // dropped note (worn cylinder / missing tine)
    const t = beatTime(nt.t) + R.gauss() * 0.006, cents = R.gauss() * detune + wow * 30 * Math.sin(t * 0.25 + wobPh) + (nt.part === 'bass' ? -6 : 0), src = noteFor(kind, nt.midi, sr, (opts.seed ?? 1) >>> 0), ratio = Math.pow(2, cents / 1200);
    const buf = Math.abs(ratio - 1) > 0.0004 ? dsp.resample(src, ratio) : src; let len = buf.length; const at = Math.round(t * sr); if (nt.part !== 'mel' && (kind === 'calliope' || kind === 'accordion' || kind === 'synth')) len = Math.min(len, Math.round(nt.dur * spb0 * sr * 1.15 + 0.05 * sr));
    const g = inst.gain * nt.vel * (nt.part === 'acc' ? 0.7 : 1) * R.range(0.85, 1); for (let i = 0; i < len && at + i < out.length; i++) out[at + i] += buf[i] * g;
    if (R.chance(0.02) && nt.part === 'mel') { const at2 = at + Math.round(0.11 * sr); for (let i = 0; i < len && at2 + i < out.length; i++) out[at2 + i] += buf[i] * g * 0.7; } // stuck / repeated note
    if ((++cnt & 3) === 0) yield;
  }
  return out;
}
