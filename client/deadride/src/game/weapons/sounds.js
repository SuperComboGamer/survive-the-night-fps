// Weapon sound library — everything synthesised offline into AudioBuffers (registered lazily with audio.register).
// Gunshot = [supersonic N-wave crack (HP)] + [muzzle blast: shaped noise, sub-ms attack, calibre-specific spectrum] + [body thump:
// decaying low sine sweep] + [action: modal metal clacks at the real cycle times] + [stereo decorrelated low-passed tail].
// '.distant' variants: low-passed, no crack/action, longer rolling tail. Foley = scrapes (band-passed rough noise), clacks
// (noise impulse + inharmonic modal ring), slaps, thuds, whooshes. The audio engine adds the room (convolution space) on top.
const TAU = Math.PI * 2;
const STEEL = [[1, 1, 0.05], [2.76, 0.6, 0.035], [5.40, 0.45, 0.025], [8.93, 0.28, 0.018], [13.34, 0.16, 0.012]];
const STEEL_L = [[1, 1, 0.12], [2.76, 0.55, 0.08], [5.40, 0.4, 0.05], [8.93, 0.22, 0.035]];
const RING = [[1, 1, 0.08], [1.46, 0.55, 0.06], [2.37, 0.4, 0.045], [3.19, 0.25, 0.03], [4.61, 0.14, 0.02]]; // inharmonic tube/receiver modes
const ACT = [[1, 1, 0.024], [2.76, 0.62, 0.017], [5.40, 0.45, 0.012], [8.93, 0.3, 0.009], [13.34, 0.18, 0.006]]; // action parts: short, damped clack
const BRASS = [[1, 1, 0.09], [2.71, 0.7, 0.07], [5.15, 0.5, 0.05], [8.6, 0.3, 0.03]];
const PLASTIC = [[1, 1, 0.012], [2.3, 0.4, 0.008], [3.9, 0.2, 0.006]];

// per-gun report parameters (physically motivated):
//  T  = positive-phase duration of the Friedlander muzzle-blast pulse (s): longer = lower, boomier (big bore / low pressure)
//  plp / glp = low-pass on the pulse / gas noise (Hz), on = pulse rise time (s), pg = pulse gain, shelf = dB above 3 kHz on the gas
//  gas = turbulent muzzle-gas noise burst [centre Hz, Q, decay s, amp]; crack = bullet N-wave [ms, amp] (supersonic rounds only)
//  thump = 1-2 cycle low body [Hz, decay s, amp]; mech = action clacks [t s, f0 Hz, amp, partials] timed to the fire-clip animation
//  (slide/bolt/carrier/op-rod hitting the rear stop, then returning to battery); ring = body resonance [Hz, amp, decay s]; tail = near-field decay [amp, decay s, LP Hz]
const GUN = {
  m1911: { plp: 4200, on: 0.00016, dur: 0.7, T: 0.0009, pg: 2.4, shelf: -3, gas: [900, 0.6, 0.006, 1.05], crack: null, thump: [140, 0.016, 0.2], mech: [[0.012, 1650, 0.07, ACT], [0.070, 2300, 0.05, ACT]], ring: [2150, 0.05, 0.035], tail: [0.11, 0.07, 2400], drive: 1.5, seed: 11 },
  mp5: { plp: 7000, on: 0.0001, dur: 0.55, T: 0.00055, pg: 1.6, shelf: -1, gas: [1700, 0.6, 0.0045, 1.0], crack: [0.15, 0.12], thump: [110, 0.012, 0.18], mech: [[0.018, 2600, 0.05, ACT], [0.050, 3100, 0.03, ACT]], ring: [3250, 0.035, 0.022], tail: [0.09, 0.05, 3200], drive: 1.6, seed: 23 },
  olympia: { plp: 5500, on: 0.00018, dur: 1.0, T: 0.0019, pg: 1.0, shelf: -1, gas: [760, 0.5, 0.012, 1.3], crack: null, thump: [120, 0.024, 0.26], mech: [], ring: [1080, 0.035, 0.06], tail: [0.16, 0.11, 1700], drive: 2.0, seed: 31 },
  m14: { plp: 9000, on: 0.0001, dur: 0.9, T: 0.0012, pg: 1.2, shelf: 2, gas: [1400, 0.6, 0.008, 1.0], crack: [0.34, 1.35], thump: [120, 0.02, 0.26], mech: [[0.019, 1450, 0.06, ACT], [0.070, 1900, 0.045, ACT]], ring: [1620, 0.05, 0.05], tail: [0.14, 0.09, 2600], drive: 1.8, seed: 41 },
  ak74u: { plp: 10000, on: 8e-05, dur: 0.75, T: 0.00078, pg: 1.2, shelf: 1, gas: [1900, 0.7, 0.006, 1.1], crack: [0.25, 0.9], thump: [100, 0.014, 0.22], mech: [[0.022, 1250, 0.06, ACT], [0.060, 1700, 0.04, ACT]], ring: [1900, 0.06, 0.04], tail: [0.13, 0.08, 3600], drive: 1.9, seed: 53 },
  remington870: { plp: 5800, on: 0.00018, dur: 1.0, T: 0.0017, pg: 1.0, shelf: -1, gas: [820, 0.5, 0.011, 1.3], crack: null, thump: [128, 0.022, 0.26], mech: [], ring: [960, 0.035, 0.055], tail: [0.16, 0.1, 1800], drive: 2.0, seed: 67 },
};

function stereoBuf(ctx, dur) { const sr = ctx.sampleRate; return ctx.createBuffer(2, Math.max(1, Math.floor(dur * sr)), sr); }
function monoBuf(ctx, dur) { const sr = ctx.sampleRate; return ctx.createBuffer(1, Math.max(1, Math.floor(dur * sr)), sr); }
function normalize(buf, peak = 0.9) { let m = 1e-9; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; } } const g = peak / m; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; } return buf; }
function fadeOut(buf, sec = 0.02) { const sr = buf.sampleRate, n = Math.floor(sec * sr); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c), L = d.length; for (let i = 0; i < n && i < L; i++) d[L - 1 - i] *= i / n; } return buf; }

/** gunshot: Friedlander blast + gas noise + N-wave crack + body thump + action + near-field tail (the engine adds the room) */
function shot(ctx, D, P, seed, distant = false) {
  const sr = ctx.sampleRate, dur = P.dur * (distant ? 2.2 : 1); const buf = stereoBuf(ctx, dur); const n = buf.length; D.seedNoise(seed * 7919 + P.seed * 131);
  const v = 1 + (D.rnd() - 0.5) * 0.12, T = P.T * v; const core = new Float32Array(n);
  const [gf, gq, gt, ga] = P.gas; const bp = new D.Biquad('bp', gf * v, gq, sr), hs = new D.Biquad('highshelf', 3000, 0.7, sr, P.shelf ?? 0), hp = new D.Biquad('hp', 45, 0.7, sr);
  const crackHP = new D.Biquad('hp', 1200, 0.7, sr), crackHP2 = new D.Biquad('hp', 1200, 0.7, sr), plp = new D.Biquad('lp', P.plp || 8000, 0.6, sr), plp2 = new D.Biquad('lp', P.plp || 8000, 0.6, sr), glp = new D.Biquad('lp', P.glp || 16000, 0.6, sr), glp2 = new D.Biquad('lp', P.glp || 16000, 0.6, sr); const mech = distant ? [] : P.mech; const [tf, tt, ta] = P.thump;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // Friedlander pulse (positive phase then the natural negative phase), b = 1.4
    const fr = plp2.p(plp.p((1 - t / T) * Math.exp(-1.4 * t / T) * Math.min(1, t / (P.on || 0.0001))));
    // turbulent gas burst
    const env = Math.min(1, t / 0.00025) * (Math.exp(-t / (gt * v)) + 0.18 * Math.exp(-t / (gt * 5)));
    let s = fr * 1.6 * (P.pg ?? 1) + glp2.p(glp.p(hs.p(bp.p(D.noise())))) * env * ga * 1.4;
    // bullet N-wave crack (supersonic rounds)
    if (P.crack && !distant) { const d = P.crack[0] * 1e-3; const nw = t < d ? (1 - 2 * t / d) * P.crack[1] * 2.2 : 0; s += crackHP2.p(crackHP.p(nw)); }
    // body thump: ~1.5 cycles
    s += Math.sin(2 * Math.PI * tf * t) * Math.exp(-t / tt) * ta * Math.min(1, t / 0.001);
    for (let k = 0; k < mech.length; k++) { const m = mech[k]; const u = t - m[0] * v; if (u > 0 && u < 0.2) s += (D.modal(u, m[1] * v, m[3]) + D.noise() * Math.exp(-u / 0.0012) * 0.8) * m[2]; }
    // body resonance: slide / receiver / barrel steel ringing, excited by the blast (short, per-gun pitch)
    if (P.ring && !distant) s += D.modal(t, P.ring[0] * v, RING) * P.ring[1] * Math.min(1, t / 0.0004) * Math.exp(-t / P.ring[2]);
    core[i] = hp.p(s);
  }
  const [la, lt, lf] = P.tail;
  for (let c = 0; c < 2; c++) {
    const out = buf.getChannelData(c); const tl = new D.Biquad('lp', (distant ? 1100 : lf) * (c ? 0.92 : 1.06), 0.6, sr), tl2 = new D.Biquad('lp', distant ? 1500 : lf * 1.3, 0.6, sr);
    const dl = new D.Biquad('lp', 3000, 0.6, sr), dl2 = new D.Biquad('lp', 2400, 0.6, sr); const tau = lt * (distant ? 5 : 1);
    let dly = 0; const pre = distant ? Math.floor(sr * 0.012) : 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr; const tail = tl2.p(tl.p(D.noise())) * la * (distant ? 2.2 : 1) * Math.min(1, t / 0.004) * Math.exp(-t / tau) * (0.85 + 0.3 * Math.sin(t * 29 + c * 2.1));
      let x = (distant ? (i >= pre ? core[i - pre] : 0) * 0.55 : core[i]) + tail; if (distant) x = dl2.p(dl.p(x)) * 1.8;
      out[i] = Math.tanh(x * P.drive) / Math.tanh(P.drive);
    }
  }
  return fadeOut(normalize(buf, 0.92), 0.03);
}

// ------------------------------------------------------------------ foley primitives (events rendered into a mono buffer)
// ev: [t, type, f, amp, dur]  types: clack click scrape slap thud rattle whoosh ping tink thock
function foley(ctx, D, events, dur, seed = 1, { lp = 16000 } = {}) {
  const sr = ctx.sampleRate; const buf = monoBuf(ctx, dur); const out = buf.getChannelData(0); D.seedNoise(seed * 977 + 13);
  for (const e of events) {
    const [t0, type, f = 2000, amp = 1, dd = 0.1] = e; const i0 = Math.floor(t0 * sr); const bp = new D.Biquad('bp', f, type === 'scrape' ? 2.2 : type === 'whoosh' ? 1.4 : 1.1, sr); const lpf = new D.Biquad('lp', f * 1.6, 0.7, sr); let rough = 0;
    const len = Math.floor((type === 'scrape' || type === 'whoosh' || type === 'rattle' ? dd + 0.03 : 0.35) * sr);
    for (let i = 0; i < len && i0 + i < out.length; i++) {
      const t = i / sr; let s = 0;
      switch (type) {
        case 'clack': s = bp.p(D.noise()) * Math.exp(-t / 0.0022) * 1.4 + D.modal(t, f * 0.5, STEEL) * 0.55 + D.noise() * Math.exp(-t / 0.0006) * 0.5; break;
        case 'click': s = bp.p(D.noise()) * Math.exp(-t / 0.0007) * 1.5 + D.modal(t, f * 0.8, STEEL) * 0.18 * Math.exp(-t / 0.01); break;
        case 'scrape': { rough += 0.02 * (D.noise() - rough); const env = Math.min(1, t / 0.012) * Math.min(1, (dd - t) / 0.02); s = env > 0 ? bp.p(D.noise()) * env * (0.5 + 5 * Math.abs(rough)) : 0; break; }
        case 'slap': s = lpf.p(D.noise()) * Math.exp(-t / 0.009) * 1.2 + Math.sin(TAU * 180 * t) * Math.exp(-t / 0.02) * 0.6; break;
        case 'thud': s = bp.p(D.noise()) * Math.exp(-t / 0.018) + Math.sin(TAU * f * 0.35 * t) * Math.exp(-t / 0.03) * 0.8; break;
        case 'rattle': { const k = Math.floor(t * 90); const r = ((k * 2654435761) >>> 0) / 4294967296; s = (r > 0.6 ? bp.p(D.noise()) * Math.exp(-(t % (1 / 90)) / 0.0012) : 0) * Math.min(1, (dd - t) / 0.03); break; }
        case 'whoosh': { const u = Math.min(1, t / dd); bp.set('bp', f * (0.6 + 0.9 * u), 1.2); s = bp.p(D.noise()) * Math.sin(Math.PI * u) ** 1.5; break; }
        case 'ping': s = D.modal(t, f, STEEL_L) * 0.9 + bp.p(D.noise()) * Math.exp(-t / 0.001); break;
        case 'tink': s = D.modal(t, f, BRASS) + D.noise() * Math.exp(-t / 0.0004) * 0.4; break;
        case 'thock': s = bp.p(D.noise()) * Math.exp(-t / 0.006) * 1.2 + D.modal(t, f * 0.5, PLASTIC) * 0.8; break;
      }
      out[i0 + i] += s * amp;
    }
  }
  if (lp < 16000) { const f1 = new D.Biquad('lp', lp, 0.7, sr), f2 = new D.Biquad('lp', lp, 0.7, sr); for (let i = 0; i < out.length; i++) out[i] = f2.p(f1.p(out[i])); }
  return fadeOut(normalize(buf, 0.85), 0.01);
}
const F = (events, dur, seed, o) => (ctx, D) => foley(ctx, D, events, dur, seed, o);
const V = (make, n) => (ctx, D) => { const a = []; for (let i = 0; i < n; i++) a.push(make(ctx, D, i)); return a; };

// ------------------------------------------------------------------ ray gun (synth)
function rayZap(ctx, D, seed) {
  const sr = ctx.sampleRate, dur = 0.75; const buf = stereoBuf(ctx, dur); D.seedNoise(seed * 31 + 7); const v = 1 + (D.rnd() - 0.5) * 0.08;
  for (let c = 0; c < 2; c++) {
    const out = buf.getChannelData(c); let ph = 0, ph2 = 0, ph3 = 0; const bp = new D.Biquad('bp', 3200, 1.5, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr; const f = (320 + 2600 * Math.exp(-t / 0.045)) * v; ph += TAU * f / sr; ph2 += TAU * (f * 1.5 + 37) / sr; ph3 += TAU * 92 / sr;
      const fm = Math.sin(ph + 2.4 * Math.sin(ph2)); const ring = fm * (0.55 + 0.45 * Math.sin(ph3)); const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.13);
      const crackle = bp.p(D.noise()) * Math.exp(-t / 0.03) * 0.7; const sub = Math.sin(TAU * (70 + 60 * Math.exp(-t / 0.03)) * t) * Math.exp(-t / 0.08) * 0.7;
      const hum = Math.sin(TAU * 240 * t + c) * 0.08 * Math.exp(-t / 0.35);
      out[i] = Math.tanh((ring * env + crackle + sub + hum) * 1.5);
    }
  }
  return fadeOut(normalize(buf, 0.9), 0.05);
}
function rayCharge(ctx, D) { const sr = ctx.sampleRate, dur = 0.9; const buf = monoBuf(ctx, dur); const out = buf.getChannelData(0); let ph = 0; for (let i = 0; i < out.length; i++) { const t = i / sr; const f = 180 + 900 * (t / dur) ** 1.4; ph += TAU * f / sr; out[i] = (Math.sin(ph) * 0.6 + Math.sin(ph * 2.01) * 0.3 + Math.sin(ph * 3.02) * 0.15) * Math.min(1, t / 0.05) * Math.min(1, (dur - t) / 0.08) * (0.7 + 0.3 * Math.sin(TAU * 11 * t)); } return normalize(buf, 0.8); }
function rayImpact(ctx, D, seed) { const sr = ctx.sampleRate, dur = 0.9; const buf = monoBuf(ctx, dur); const out = buf.getChannelData(0); D.seedNoise(seed + 99); const lp = new D.Biquad('lp', 2400, 0.7, sr); let ph = 0; for (let i = 0; i < out.length; i++) { const t = i / sr; ph += TAU * (900 * Math.exp(-t / 0.08) + 90) / sr; out[i] = Math.tanh((lp.p(D.noise()) * Math.exp(-t / 0.12) * 1.3 + Math.sin(ph) * Math.exp(-t / 0.2) * 0.6 + Math.sin(TAU * 55 * t) * Math.exp(-t / 0.15) * 0.8) * 1.4); } return fadeOut(normalize(buf, 0.9), 0.05); }

// ------------------------------------------------------------------ registry
const SURF = { concrete: { lp: 16000, g: 1 }, brick: { lp: 12000, g: 1 }, rock: { lp: 14000, g: 1 }, tile: { lp: 16000, g: 1.1 }, metal: { lp: 16000, g: 1.2, ring: 900 }, wood: { lp: 6000, g: 0.8, thud: 700 }, dirt: { lp: 2500, g: 0.5 }, gravel: { lp: 6000, g: 0.7 }, grass: { lp: 2000, g: 0.4 }, snow: { lp: 1500, g: 0.3 }, ice: { lp: 16000, g: 1.1 }, glass: { lp: 16000, g: 1.1 }, water: { lp: 1800, g: 0.3 }, plastic: { lp: 8000, g: 0.8 }, fabric: { lp: 2000, g: 0.4 }, crystal: { lp: 16000, g: 1.2 }, lava: { lp: 3000, g: 0.5 }, flesh: { lp: 1500, g: 0.3 } };

export const SOUND_NAMES = [];
const hasSound = (audio, n) => !!((audio.lib && audio.lib.has && audio.lib.has(n)) || (audio.gens && audio.gens.has && audio.gens.has(n)));
function reg(audio, name, gen, { soft = false } = {}) { SOUND_NAMES.push(name); if (soft && hasSound(audio, name)) return; audio.register(name, gen); }

export function registerSounds(audio) {
  if (!audio || !audio.register || audio._wpnSounds) return; audio._wpnSounds = true;
  for (const [id, P] of Object.entries(GUN)) {
    reg(audio, `gun.${id}.fire`, V((c, D, i) => shot(c, D, P, 100 + i), 4));
    reg(audio, `gun.${id}.fire.distant`, V((c, D, i) => shot(c, D, P, 200 + i, true), 2));
  }
  reg(audio, 'gun.raygun.fire', V((c, D, i) => rayZap(c, D, i), 3)); reg(audio, 'gun.raygun.fire.distant', V((c, D, i) => rayZap(c, D, 10 + i), 1));
  reg(audio, 'gun.raygun.charge', (c, D) => rayCharge(c, D)); reg(audio, 'gun.raygun.impact', V((c, D, i) => rayImpact(c, D, i), 2));
  // ---- M1911
  reg(audio, 'gun.m1911.dry', F([[0, 'click', 3800, 1], [0.006, 'click', 2400, 0.5]], 0.15, 1));
  reg(audio, 'gun.m1911.magout', F([[0, 'click', 3000, 0.8], [0.012, 'scrape', 2600, 0.5, 0.08], [0.09, 'click', 4200, 0.3]], 0.25, 2));
  reg(audio, 'gun.m1911.magdrop', F([[0, 'thud', 900, 0.6], [0.004, 'tink', 1900, 0.35], [0.11, 'thud', 1100, 0.25]], 0.4, 3, { lp: 7000 }));
  reg(audio, 'gun.m1911.magin', F([[0, 'scrape', 2200, 0.45, 0.07], [0.075, 'clack', 3200, 1], [0.083, 'click', 5200, 0.6]], 0.3, 4));
  reg(audio, 'gun.m1911.slide', F([[0, 'click', 4200, 0.5], [0.004, 'scrape', 2800, 0.35, 0.03], [0.035, 'clack', 2100, 1], [0.04, 'rattle', 3600, 0.2, 0.05]], 0.35, 5));
  reg(audio, 'gun.m1911.draw', F([[0, 'scrape', 1400, 0.3, 0.16], [0.18, 'click', 3500, 0.5], [0.23, 'rattle', 3000, 0.15, 0.06]], 0.42, 6));
  // ---- MP5
  reg(audio, 'gun.mp5.dry', F([[0, 'click', 3400, 1], [0.01, 'click', 2000, 0.4]], 0.15, 11));
  reg(audio, 'gun.mp5.magout', F([[0, 'click', 2600, 0.7], [0.02, 'scrape', 1800, 0.5, 0.12], [0.14, 'click', 3800, 0.3]], 0.3, 12));
  reg(audio, 'gun.mp5.magin', F([[0, 'scrape', 1700, 0.5, 0.09], [0.1, 'clack', 2500, 1], [0.108, 'click', 4600, 0.6]], 0.35, 13));
  reg(audio, 'gun.mp5.chargeBack', F([[0, 'click', 3000, 0.5], [0.01, 'scrape', 2400, 0.5, 0.09], [0.1, 'clack', 3000, 0.7], [0.16, 'click', 4200, 0.5]], 0.3, 14));
  reg(audio, 'gun.mp5.chargeSlap', F([[0, 'slap', 600, 1], [0.012, 'clack', 1800, 1], [0.018, 'rattle', 3000, 0.25, 0.05]], 0.3, 15));
  reg(audio, 'gun.mp5.selector', F([[0, 'click', 5200, 1], [0.02, 'click', 4400, 0.5]], 0.1, 16));
  reg(audio, 'gun.mp5.draw', F([[0, 'scrape', 1200, 0.3, 0.2], [0.2, 'rattle', 2800, 0.2, 0.08], [0.3, 'click', 3200, 0.3]], 0.45, 17));
  // ---- Olympia
  reg(audio, 'gun.olympia.dry', F([[0, 'click', 2800, 1], [0.005, 'thud', 700, 0.3]], 0.15, 21));
  reg(audio, 'gun.olympia.open', F([[0, 'click', 3000, 0.7], [0.03, 'scrape', 1500, 0.4, 0.08], [0.12, 'clack', 1200, 1], [0.13, 'thud', 500, 0.5]], 0.4, 22));
  reg(audio, 'gun.olympia.eject', F([[0, 'click', 2200, 0.5], [0.01, 'thock', 1400, 0.6], [0.02, 'thock', 1300, 0.5]], 0.25, 23));
  reg(audio, 'gun.olympia.shellIn', V((c, D, i) => foley(c, D, [[0, 'scrape', 1100, 0.35, 0.05], [0.055, 'thock', 1500 + i * 120, 0.9], [0.06, 'tink', 2600, 0.2]], 0.2, 24 + i), 2));
  reg(audio, 'gun.olympia.close', F([[0, 'scrape', 1200, 0.3, 0.05], [0.055, 'clack', 1100, 1], [0.06, 'thud', 450, 0.7], [0.075, 'click', 3600, 0.4]], 0.35, 26));
  reg(audio, 'gun.olympia.hammer', F([[0, 'click', 3600, 0.6], [0.035, 'click', 2800, 1]], 0.15, 27));
  reg(audio, 'gun.olympia.draw', F([[0, 'scrape', 900, 0.3, 0.22], [0.26, 'thud', 600, 0.3]], 0.45, 28));
  // ---- M14
  reg(audio, 'gun.m14.dry', F([[0, 'click', 3000, 1], [0.008, 'click', 2000, 0.5]], 0.15, 31));
  reg(audio, 'gun.m14.magout', F([[0, 'click', 2400, 0.8], [0.02, 'scrape', 1600, 0.45, 0.1], [0.12, 'clack', 1800, 0.4]], 0.3, 32));
  reg(audio, 'gun.m14.magin', F([[0, 'scrape', 1500, 0.4, 0.06], [0.07, 'clack', 1600, 0.8], [0.12, 'clack', 2300, 1], [0.126, 'click', 4200, 0.5]], 0.35, 33));
  reg(audio, 'gun.m14.bolt', F([[0, 'click', 3200, 0.5], [0.01, 'scrape', 2000, 0.45, 0.05], [0.07, 'clack', 1400, 1], [0.075, 'rattle', 2600, 0.25, 0.07]], 0.35, 34));
  reg(audio, 'gun.m14.boltBack', F([[0, 'scrape', 1900, 0.5, 0.08], [0.08, 'clack', 1700, 0.6]], 0.25, 35));
  reg(audio, 'gun.m14.draw', F([[0, 'scrape', 800, 0.35, 0.25], [0.28, 'rattle', 2400, 0.2, 0.08]], 0.45, 36));
  // ---- AK-74u
  reg(audio, 'gun.ak74u.dry', F([[0, 'click', 2600, 1], [0.012, 'click', 1800, 0.5]], 0.15, 41));
  reg(audio, 'gun.ak74u.magout', F([[0, 'click', 2200, 0.8], [0.03, 'scrape', 1400, 0.5, 0.1], [0.13, 'clack', 1500, 0.35]], 0.3, 42));
  reg(audio, 'gun.ak74u.magin', F([[0, 'scrape', 1300, 0.4, 0.06], [0.07, 'clack', 1400, 0.7], [0.14, 'clack', 2000, 1], [0.145, 'click', 3800, 0.4]], 0.35, 43));
  reg(audio, 'gun.ak74u.boltBack', F([[0, 'click', 2600, 0.4], [0.01, 'scrape', 1600, 0.5, 0.09], [0.1, 'clack', 1300, 0.6]], 0.25, 44));
  reg(audio, 'gun.ak74u.boltFwd', F([[0, 'scrape', 1800, 0.4, 0.04], [0.045, 'clack', 1200, 1], [0.05, 'rattle', 2400, 0.3, 0.08]], 0.3, 45));
  reg(audio, 'gun.ak74u.selector', F([[0, 'click', 2400, 0.8], [0.03, 'clack', 1800, 1]], 0.15, 46));
  reg(audio, 'gun.ak74u.draw', F([[0, 'scrape', 900, 0.3, 0.2], [0.22, 'rattle', 2200, 0.25, 0.1]], 0.45, 47));
  // ---- Remington 870
  reg(audio, 'gun.remington870.dry', F([[0, 'click', 2600, 1]], 0.12, 51));
  reg(audio, 'gun.remington870.pumpBack', F([[0, 'click', 2400, 0.4], [0.006, 'scrape', 1300, 0.55, 0.09], [0.1, 'clack', 1200, 0.9], [0.105, 'thud', 500, 0.3]], 0.25, 52));
  reg(audio, 'gun.remington870.pumpFwd', F([[0, 'scrape', 1500, 0.5, 0.07], [0.075, 'clack', 1500, 1], [0.08, 'rattle', 2600, 0.2, 0.06]], 0.25, 53));
  reg(audio, 'gun.remington870.shellIn', V((c, D, i) => foley(c, D, [[0, 'scrape', 1200, 0.35, 0.06], [0.065, 'click', 2600, 0.7], [0.07, 'thock', 1300 + i * 90, 0.9]], 0.22, 54 + i), 3));
  reg(audio, 'gun.remington870.draw', F([[0, 'scrape', 900, 0.3, 0.2], [0.23, 'thud', 700, 0.25]], 0.45, 57));
  // ---- Ray gun foley
  reg(audio, 'gun.raygun.dry', F([[0, 'click', 3000, 0.8], [0.01, 'ping', 1800, 0.2]], 0.2, 61));
  reg(audio, 'gun.raygun.cellOut', F([[0, 'click', 2600, 0.7], [0.02, 'scrape', 2000, 0.4, 0.1], [0.12, 'ping', 1500, 0.3]], 0.35, 62));
  reg(audio, 'gun.raygun.cellIn', F([[0, 'scrape', 1800, 0.4, 0.07], [0.08, 'clack', 2200, 1], [0.09, 'ping', 1200, 0.4]], 0.4, 63));
  reg(audio, 'gun.raygun.draw', F([[0, 'scrape', 1100, 0.3, 0.18], [0.2, 'ping', 1600, 0.3]], 0.45, 64));
  // ---- generic
  reg(audio, 'wpn.melee.swing', V((c, D, i) => foley(c, D, [[0, 'whoosh', 900 + i * 150, 1, 0.22]], 0.3, 70 + i), 2));
  reg(audio, 'wpn.melee.hit', F([[0, 'thud', 500, 1], [0.004, 'slap', 400, 0.6]], 0.3, 73));
  reg(audio, 'wpn.grenade.pin', F([[0, 'click', 3200, 0.7], [0.015, 'ping', 2900, 0.6], [0.05, 'rattle', 4200, 0.25, 0.1]], 0.35, 74));
  reg(audio, 'wpn.grenade.throw', F([[0, 'whoosh', 700, 1, 0.3], [0.1, 'ping', 1700, 0.25]], 0.45, 75));
  reg(audio, 'wpn.grenade.bounce', V((c, D, i) => foley(c, D, [[0, 'thud', 700 + i * 90, 1], [0.002, 'clack', 1300 + i * 100, 0.6]], 0.3, 76 + i, { lp: 6000 }), 3));
  // casings per surface (brass tink / shell thock)
  for (const [s, o] of Object.entries(SURF)) {
    reg(audio, `casing.brass.${s}`, V((c, D, i) => foley(c, D, [[0, 'tink', 3400 + i * 420, 1 * o.g], [0.0, 'click', 5200, 0.3], ...(o.ring ? [[0, 'ping', o.ring, 0.3]] : []), ...(o.thud ? [[0, 'thud', o.thud, 0.4]] : [])], 0.22, 90 + i, { lp: o.lp }), 3), { soft: true });
    reg(audio, `casing.shell.${s}`, V((c, D, i) => foley(c, D, [[0, 'thock', 1250 + i * 150, 1 * o.g], [0.001, 'tink', 2600 + i * 200, 0.35], ...(o.ring ? [[0, 'ping', o.ring, 0.2]] : [])], 0.2, 120 + i, { lp: o.lp }), 3), { soft: true });
  }
}
/** pre-generate buffers a few per call (spread over frames to avoid a load hitch). Returns true when done. */
export function warmSounds(audio, n = 3) {
  if (!audio?.ready) return false;
  if (audio.lib && audio.lib.promotePrefix) { audio.lib.promotePrefix('gun.', 2); audio.lib.promotePrefix('wpn.', 2); return true; } // library synthesises in the background
  audio._wpnWarm = audio._wpnWarm || 0; let k = 0; while (audio._wpnWarm < SOUND_NAMES.length && k < n) { audio.get(SOUND_NAMES[audio._wpnWarm++]); k++; } return audio._wpnWarm >= SOUND_NAMES.length;
}
export const GUN_SOUND_PARAMS = GUN;
