// Forest ambience, all scheduled from the engine's 200 ms tick (nothing per frame):
//  - recorded beds (samples.js): day forest, dawn chorus, dusk, night, crickets, three wind layers crossfaded by wind
//    speed and a shared deterministic gust field, and the near-fire body. Every bed starts at a random loop phase
//    and "breathes" (±1.5 dB at 0.03-0.08 Hz) so no loop is ever heard twice the same way.
//  - procedural beds (wind, pines, crickets, fire, the horde's chorus) cover for any recording that is not (yet)
//    available and fade out once it is; the night drone is always procedural.
//  - threat: the forest falls silent as zombies close in (birds, crickets, night life) and only slowly recovers.
//  - one-shots at world positions around the listener, as Poisson processes: recorded takes (song birds, raven,
//    woodpecker, owls, creaks, twig snaps, wolves) and the dead out in the dark (moans carried on the wind, a far-off
//    scream, a whisper at your shoulder) when loaded, the original procedural events otherwise, plus the bell. At
//    night "dread" events - a branch snapping, a rustle, something padding past - are placed in a cone behind you.
//  - weather (s.wind 0..1+, s.rain 0..1): wind swells the wind beds and sets the trees creaking, rain and gales
//    quiet the birds and crickets, a rain bed plays (a muffled drumming under a roof) and thunder is placed at each
//    lightning strike.
import { clamp01, smooth, bell, rand, expWait, gustField, windField } from './curves.js';

const TAU = Math.PI * 2;
const POOL = 10;
const MAX_HRTF = 3;

// weather quiet: birds hide from rain and gales
const shelter = (s) => (1 - 0.85 * (s.rain || 0)) * (1 - 0.8 * smooth(0.5, 1, s.wind || 0));

// Original procedural events. rate(s, day, night) -> events per minute. `by`: recordings that replace the event
// (it is skipped while any of them is available).
const PROC_EVENTS = [
  { bank: 'amb_bird', by: ['bird_chickadee', 'bird_robin'], rate: (s, d) => 7 * d * (1 - 0.85 * s.danger) * (s.menu ? 0.15 : 1) * shelter(s), dist: [12, 45], elev: [3, 12], vol: 0.3, ref: 8, gap: 1.5 },
  { bank: 'amb_crow', by: ['raven'], rate: (s, d, n) => (1.3 * d + 2.2 * smooth(0.1, 0.35, n) * (1 - smooth(0.5, 0.8, n))) * (s.menu ? 0.4 : 1) * shelter(s), dist: [30, 90], elev: [6, 16], vol: 0.45, ref: 16, gap: 9 },
  { bank: 'amb_woodpecker', by: ['woodpecker'], rate: (s, d) => 0.45 * d * (s.menu ? 0 : 1) * shelter(s), dist: [40, 90], elev: [2, 8], vol: 0.35, ref: 20, gap: 30 },
  { bank: 'amb_creak', by: ['tree_creak'], rate: (s, d, n) => 2 + 2.2 * n + 9 * smooth(0.4, 1.1, s.wind || 0), dist: [8, 35], elev: [3, 10], vol: 0.3, ref: 6, gap: 2 },
  { bank: 'amb_twig', by: ['branch_snap'], rate: (s, d, n) => (1.1 * n + 0.6 * s.danger) * (s.menu ? 0 : 1), dist: [6, 20], elev: [0, 0.3], vol: 0.35, ref: 4, gap: 10, hrtf: true },
  { bank: 'amb_owl', by: ['owl_barred', 'owl_horned'], rate: (s, d, n) => 1.9 * n * (s.horde ? 0.4 : 1), dist: [25, 70], elev: [6, 14], vol: 0.42, ref: 15, gap: 12 },
  { bank: 'amb_wolf', by: ['wolf_howl'], rate: (s, d, n) => 1.1 * smooth(0.4, 0.9, n) * (s.horde ? 0.5 : 1) * (s.menu ? 0.5 : 1), dist: [150, 260], elev: [0, 10], vol: 0.8, ref: 80, gap: 25 },
  { bank: 'amb_scream', by: ['zv_scream'], rate: (s, d, n) => (0.35 * smooth(0.5, 1, n) + (s.horde ? 0.8 : 0)) * (s.menu ? 0 : 1), dist: [120, 250], elev: [0, 5], vol: 0.55, ref: 70, gap: 30 },
  { bank: 'amb_whisper', by: ['zv_whisper'], rate: (s, d, n) => (0.22 * smooth(0.6, 1, n) + (s.dead ? 2 : 0) + s.lowHealth * 0.7) * (s.menu ? 0 : 1), dist: [2.5, 6], elev: [0, 1.5], vol: 0.2, ref: 2, gap: 20, hrtf: true },
  { bank: 'amb_bell', rate: (s, d, n) => 0.2 * smooth(0.5, 1, n), dist: [220, 320], elev: [10, 30], vol: 0.65, ref: 120, gap: 90, tolls: true },
  { bank: 'z_growl', by: ['zv_moan'], rate: (s, d, n) => (2 * smooth(0.5, 1, n) + (s.horde ? 14 : 0)) * (s.menu ? 0 : 1), dist: [35, 80], elev: [0, 1], vol: 0.4, ref: 6, gap: 0.8, rateJit: 0.15 },
];

// Recorded events. rate(s, tf, quiet, wind m/s) -> events per minute (only while the recording is loaded).
// bout: phrases sung from one perch, `gapIn` s apart; wet: reverb send at ref distance (falls off as (ref/d)^0.45);
// ground: height relative to the ground under the listener instead of the ear.
const REC_EVENTS = [
  { key: 'bird_chickadee', rate: (s, t, q, w) => 0.8 * (0.9 * t.day + 0.4 * t.dawn) * q * (1 - 0.6 * smooth(9, 16, w)) * shelter(s), dist: [12, 45], elev: [3, 14], vol: 0.55, ref: 5, gap: 8, bout: [3, 7], gapIn: [1, 4], wet: 0.45, rj: 0.04 },
  { key: 'bird_robin', rate: (s, t, q, w) => 0.7 * (t.dawn + 0.8 * t.dusk + 0.12 * t.day) * q * (1 - 0.6 * smooth(9, 16, w)) * shelter(s), dist: [25, 80], elev: [4, 14], vol: 0.6, ref: 8, gap: 10, bout: [2, 5], gapIn: [2.5, 6], wet: 0.5, rj: 0.03 },
  { key: 'raven', rate: (s, t, q) => (0.5 * t.day + 0.3 * t.dawn + 1.4 * t.dusk + (s.menu ? 0.4 : 0)) * q * shelter(s), dist: [40, 140], elev: [10, 35], vol: 0.55, ref: 16, gap: 20, bout: [2, 5], gapIn: [1.5, 4.5], wet: 0.6, rj: 0.05 },
  { key: 'woodpecker', rate: (s, t, q) => 0.45 * (t.day + 0.5 * t.dawn) * q * shelter(s), dist: [40, 110], elev: [3, 12], vol: 0.7, ref: 20, gap: 30, bout: [2, 4], gapIn: [4, 10], wet: 0.55, rj: 0.04 },
  { key: 'owl_barred', rate: (s, t, q) => 0.8 * (t.night + 0.3 * t.dusk) * q * (s.horde ? 0.4 : 1), dist: [45, 150], elev: [6, 18], vol: 0.8, ref: 15, gap: 15, bout: [1, 2], gapIn: [6, 14], wet: 0.75, rj: 0.03 },
  { key: 'owl_horned', rate: (s, t, q) => 0.7 * t.night * q * (s.horde ? 0.4 : 1), dist: [60, 180], elev: [8, 22], vol: 0.6, ref: 15, gap: 15, bout: [2, 4], gapIn: [3, 9], wet: 0.75, rj: 0.03 },
  { key: 'wolf_howl', rate: (s, t) => 0.45 * smooth(0.4, 0.9, t.night) * (s.horde ? 0.5 : 1) * (s.menu ? 0.5 : 1), dist: [200, 320], elev: [0, 8], vol: 0.6, ref: 80, gap: 40, wet: 0.9, rj: 0.04, answer: 0.45 },
  { key: 'tree_creak', rate: (s, t, q, w) => (1 + 1.4 * t.night + 3.5 * smooth(5, 14, w)) * (s.menu ? 0.6 : 1), dist: [8, 32], elev: [4, 14], vol: 1.2, ref: 6, gap: 4, wet: 0.5, rj: 0.15 },
  { key: 'branch_snap', rate: (s, t) => 0.9 * t.night * (s.menu ? 0 : 1), dist: [6, 20], elev: [0, 0.3], ground: true, vol: 0.7, ref: 4, gap: 10, hrtf: true, wet: 0.4, rj: 0.12 },
  // the dead, out in the dark: moans carried on the wind (a chorus of them once the horde is up), now and then a
  // scream from far away, and - late at night, hurt, or dead - a whisper right at your shoulder
  { key: 'zv_moan', rate: (s, t) => (2 * smooth(0.5, 1, t.night) + (s.horde ? 14 : 0)) * (s.menu ? 0 : 1), dist: [35, 80], elev: [0, 1], vol: 0.5, ref: 6, gap: 0.8, wet: 0.7, rj: 0.1, pitch: 0.85 },
  { key: 'zv_scream', rate: (s, t) => (0.35 * smooth(0.5, 1, t.night) + (s.horde ? 0.8 : 0)) * (s.menu ? 0 : 1), dist: [120, 250], elev: [0, 5], vol: 1.3, ref: 70, gap: 30, wet: 0.9, rj: 0.06, pitch: 0.9 },
  { key: 'zv_whisper', rate: (s, t) => (0.22 * smooth(0.6, 1, t.night) + (s.dead ? 2 : 0) + s.lowHealth * 0.7) * (s.menu ? 0 : 1), dist: [2.5, 6], elev: [0, 1.5], vol: 0.3, ref: 2, gap: 20, hrtf: true, wet: 0.3, rj: 0.08 },
];

const THUNDER = { bank: 'amb_thunder', dist: [0, 0], elev: [0, 0], vol: 1, ref: 160, gap: 0, rec: { key: 'thunder_far', vol: 1.05, ref: 160, rj: 0.05, wet: 0.5 } };
const THUNDER_NEAR = { bank: 'amb_thunder_near', dist: [0, 0], elev: [0, 0], vol: 1, ref: 60, gap: 0, rateJit: 0.08, rec: { key: 'thunder_near', vol: 1, ref: 60, rj: 0.06, wet: 0.5 } };

const REC_BY_KEY = Object.fromEntries(REC_EVENTS.map((e) => [e.key, e]));

// recorded beds: base linear gain (calibrated against the procedural mix), wind: rate follows the gusts,
// dry: bypasses the "under cover" muffle; lp: a fixed low-pass (heard from a distance); wet: reverb send
const REC_BEDS = {
  amb_horde: { gain: 0.36, lp: 3200, wet: 0.4 },
  amb_rain: { gain: 1.2, rain: true }, // through the rain's own low-pass: a muffled drumming under a roof
  amb_day: { gain: 0.65 },
  amb_day_wind: { gain: 0.42 },
  amb_dawn: { gain: 0.55 },
  amb_dusk: { gain: 0.88 },
  amb_night: { gain: 0.95 },
  amb_crickets: { gain: 0.78 },
  wind_light: { gain: 0.55 },
  wind_mid: { gain: 0.8 },
  wind_strong: { gain: 1.15 },
  fire_roar: { gain: 1.05, dry: true },
};

function setPos(p, x, y, z) {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else p.setPosition(x, y, z);
}

// procedural looping bed
class Bed {
  constructor(amb, bank, dest) {
    this.a = amb;
    this.bank = bank;
    this.gain = amb.ctx.createGain();
    this.gain.gain.value = 0;
    if (dest) this.gain.connect(dest);
    this.src = null;
    this.target = 0;
    this.offAt = 0;
  }
  set(v, now, tc) {
    if (Math.abs(v - this.target) > 0.003) {
      this.target = v;
      this.gain.gain.setTargetAtTime(v, now, tc);
    }
    if (v > 0.002) {
      this.offAt = 0;
      if (!this.src) this._start(now);
    } else if (this.src) {
      if (!this.offAt) this.offAt = now + tc * 6 + 1;
      else if (now > this.offAt) this._stop();
    }
  }
  _start(now) {
    const pool = this.a.e._pools.get(this.bank);
    if (!pool || !pool.length) return;
    const c = this.a.ctx;
    const buf = pool[Math.floor(Math.random() * pool.length)];
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(this.gain);
    s.start(now, Math.random() * buf.duration);
    this.src = s;
  }
  _stop() {
    const s = this.src;
    this.src = null;
    this.offAt = 0;
    try {
      s.stop();
    } catch {}
    s.disconnect();
  }
}

// recorded looping bed: random start phase, slow breathing, optional playback-rate modulation
class RecBed {
  constructor(amb, key, def, dest) {
    this.a = amb;
    this.key = key;
    this.def = def;
    this.gain = amb.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(dest);
    this.head = this.gain; // what the source plays into
    if (def.lp) {
      const f = amb.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = def.lp;
      f.Q.value = 0.5;
      f.connect(this.gain);
      this.head = f;
    }
    if (def.wet) {
      const send = amb.ctx.createGain();
      send.gain.value = def.wet;
      this.gain.connect(send);
      send.connect(amb.e._ambSend);
    }
    this.src = null;
    this.target = 0;
    this.offAt = 0;
    this.rate = 1;
    this.ph = Math.random() * 100;
    this.br = 0.03 + Math.random() * 0.05;
  }
  breath(t) {
    return 1 + 0.17 * Math.sin((t * this.br + this.ph) * TAU) * Math.sin((t * this.br * 0.37 + this.ph) * TAU);
  }
  set(level, now, tc) {
    const v = level * this.def.gain * this.breath(now);
    const on = v > 0.002;
    // keeps the decoded buffer alive (or brings it back) while the bed is wanted or still fading out
    const buf = on || this.src ? this.a.rec.get(this.key) : null;
    if (Math.abs(v - this.target) > this.target * 0.02 + 0.0003) {
      this.target = v;
      if (this.src) this.gain.gain.setTargetAtTime(v, now, tc);
    }
    if (on) {
      this.offAt = 0;
      if (!this.src && buf) this._start(buf, now, tc);
    } else if (this.src) {
      if (!this.offAt) this.offAt = now + tc * 6 + 1;
      else if (now > this.offAt) this._stop();
    }
  }
  setRate(r, now) {
    if (Math.abs(r - this.rate) < 0.002) return;
    this.rate = r;
    if (this.src) this.src.playbackRate.setTargetAtTime(r, now, 0.4);
  }
  _start(buf, now, tc) {
    const s = this.a.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = this.rate;
    s.connect(this.head);
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.setTargetAtTime(this.target, now, tc);
    s.start(now, Math.random() * buf.duration);
    this.src = s;
  }
  _stop() {
    const s = this.src;
    this.src = null;
    this.offAt = 0;
    try {
      s.stop();
    } catch {}
    s.disconnect();
  }
}

export class Ambience {
  constructor(engine) {
    this.e = engine;
    const c = (this.ctx = engine._ctx);
    this.out = engine._ambIn;
    this.windLP = c.createBiquadFilter();
    this.windLP.type = 'lowpass';
    this.windLP.frequency.value = 3000;
    this.windLP.Q.value = 0.5;
    this.windLP.connect(this.out);
    this.beds = {
      wind: new Bed(this, 'bed_wind', this.windLP),
      pines: new Bed(this, 'bed_pines', this.windLP),
      crickets: new Bed(this, 'bed_crickets', this.out),
      drone: new Bed(this, 'bed_drone', this.out),
      horde: new Bed(this, 'bed_horde', this.out),
      fire: new Bed(this, 'loop_campfire', this.out),
      rain: new Bed(this, 'bed_rain', null),
    };
    // rain: open sky, or a muffled drumming under a roof
    this.rainLP = c.createBiquadFilter();
    this.rainLP.type = 'lowpass';
    this.rainLP.frequency.value = 12000;
    this.rainLP.Q.value = 0.4;
    this.beds.rain.gain.connect(this.rainLP);
    this.rainLP.connect(this.out);
    // horde chorus also feeds the reverb (distance)
    const hs = c.createGain();
    hs.gain.value = 0.4;
    this.beds.horde.gain.connect(hs);
    hs.connect(engine._ambSend);

    // recorded beds; outdoor ones share a muffle for being under cover
    this.coverLP = c.createBiquadFilter();
    this.coverLP.type = 'lowpass';
    this.coverLP.frequency.value = 20000;
    this.coverLP.Q.value = 0.5;
    this.coverLP.connect(this.out);
    this.rbeds = {};
    for (const [k, d] of Object.entries(REC_BEDS)) this.rbeds[k] = new RecBed(this, k, d, d.rain ? this.rainLP : d.dry ? this.out : this.coverLP);
    this.rbedList = Object.values(this.rbeds);
    this.lvl = {}; // recorded bed levels (0..1 before gain)
    for (const k in REC_BEDS) this.lvl[k] = 0;

    // pooled emitters for one-shots
    this.chans = [];
    for (let i = 0; i < POOL; i++) {
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      const gain = c.createGain();
      const panner = c.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.maxDistance = 10000;
      panner.rolloffFactor = 1;
      const send = c.createGain();
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(this.out);
      gain.connect(send);
      send.connect(engine._ambSend);
      const ch = { filter, gain, panner, send, src: null, end: 0, model: 'equalpower', hrtf: false };
      ch.onEnded = () => this._release(ch);
      this.chans.push(ch);
    }
    this.hrtfN = 0;
    this.pT = PROC_EVENTS.map(() => expWait(1));
    this.pLast = new Float64Array(PROC_EVENTS.length);
    this.rT = REC_EVENTS.map(() => rand(0.05, 0.6)); // partly drained: the first calls come soon after joining
    this.rLast = new Float64Array(REC_EVENTS.length).fill(-1e9);
    this.dreadT = rand(0.3, 1);
    this.gust = 1; // procedural beds' random gusts
    this.nextGust = 0;
    this.lastTick = 0;
    this.pending = []; // { t, ev | key+o+left, pos } delayed events (bell tolls, bird bouts, dread steps)
    this.tf = { dawn: 0, day: 1, dusk: 0, night: 0 };
    this.prevNight = -1;
    this.nightPeak = 0;
    this.dawnAt = -1e9; // night seen falling (dawn inferred without `cycle`)
    this.kickAt = -1e9; // dawn stinger
    this.riseAt = -1e9; // night seen rising (dusk inferred without `cycle`)
    this.threat = 0; // smoothed: silences the forest
    this.fear = 0; // smoothed zombie proximity: drives the fear heartbeat
    this.wind = { speed: 5, gust: 0.5, strength: 0.3 };
  }

  get rec() {
    return this.e._rec;
  }

  _release(ch) {
    const s = ch.src;
    if (!s) return;
    s.onended = null;
    try {
      s.disconnect();
    } catch {}
    ch.src = null;
    if (ch.hrtf) this.hrtfN--;
    ch.hrtf = false;
  }

  // a free emitter; `steal`: when all are busy, take the one that ends soonest (thunder must not be dropped)
  _chan(now, steal) {
    let c = this.chans.find((ch) => !ch.src || ch.end + 0.5 < now);
    if (!c && steal) c = this.chans.reduce((a, b) => (b.end < a.end ? b : a));
    if (!c) return null;
    if (c.src) {
      try {
        c.src.stop();
      } catch {}
      this._release(c);
    }
    return c;
  }

  // start buf (or its [off, dur] slice) on a pooled emitter at x,y,z; send: reverb send gain
  _voice(buf, off, dur, x, y, z, vol, ref, hrtf, rate, send, t, now, steal = false) {
    const ch = this._chan(now, steal);
    if (!ch) return false;
    const e = this.e;
    const dx = x - e._lx;
    const dy = y - e._ly;
    const dz = z - e._lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const wantH = !!hrtf && this.hrtfN < MAX_HRTF;
    const model = wantH ? 'HRTF' : 'equalpower';
    if (ch.model !== model) {
      ch.panner.panningModel = model;
      ch.model = model;
    }
    if (wantH) this.hrtfN++;
    ch.hrtf = wantH;
    ch.panner.refDistance = ref;
    setPos(ch.panner, x, y, z);
    const fc = 400 + 19600 * Math.exp(-d / 90);
    ch.filter.frequency.value = fc > 18000 ? 20000 : fc;
    ch.gain.gain.value = vol;
    ch.send.gain.value = send < 0 ? 0.25 + 0.5 * Math.min(1, d / 150) : send * Math.pow(ref / Math.max(d, ref), 0.45);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(ch.filter);
    src.onended = ch.onEnded;
    if (dur > 0) src.start(t, off, dur);
    else src.start(t);
    ch.src = src;
    ch.end = t + (dur > 0 ? dur : buf.duration) / rate;
    return true;
  }

  _ring(dist, elev, ground) {
    const e = this.e;
    const ang = Math.random() * TAU;
    const r = rand(dist[0], dist[1]);
    return [e._lx + Math.sin(ang) * r, e._ly + (ground ? -1.4 : 0) + rand(elev[0], elev[1]), e._lz + Math.cos(ang) * r];
  }

  // a point on the ground in a cone of `spread` degrees behind the listener
  _behind(dMin, dMax, spread) {
    const e = this.e;
    const a = (e._lyaw || 0) + (Math.random() - 0.5) * spread * (Math.PI / 180);
    const r = rand(dMin, dMax);
    return [e._lx + Math.sin(a) * r, e._ly - 1.3, e._lz + Math.cos(a) * r];
  }

  // procedural one-shot at a random position around the listener (or at `pos`). Returns the position or null.
  emit(ev, now, when = 0, pos = null, steal = false) {
    const e = this.e;
    const buf = e._pick(ev.bank);
    if (!buf) {
      e._need(ev.bank);
      return null;
    }
    const p = pos || this._ring(ev.dist, ev.elev, false);
    const rj = ev.rateJit ?? 0.05;
    const rate = (1 + (Math.random() - 0.5) * 2 * rj) * e._rateMul;
    const ok = this._voice(buf, 0, 0, p[0], p[1], p[2], ev.vol * rand(0.75, 1.1), ev.ref, ev.hrtf, rate, -1, Math.max(now, when), now, steal);
    return ok ? p : null;
  }

  // recorded take of `key` (random slice); o: { vol, ref, hrtf, rj, wet, pitch }. Returns its duration (0 = not played).
  emitRec(key, o, now, when, pos, steal = false) {
    const buf = this.rec.get(key);
    if (!buf) return 0;
    const [off, dur] = this.rec.pick(key, buf);
    const rate = (o.pitch || 1) * (1 + (Math.random() - 0.5) * 2 * (o.rj ?? 0.05)) * this.e._rateMul;
    const t = Math.max(now, when);
    return this._voice(buf, off, dur, pos[0], pos[1], pos[2], o.vol * rand(0.75, 1.1), o.ref, o.hrtf, rate, o.wet ?? 0.6, t, now, steal) ? dur / rate : 0;
  }

  // a recorded event: the first phrase now; each phrase of a bout queues the next one from the same perch
  _fireRec(ev, now) {
    const pos = this._ring(ev.dist, ev.elev, ev.ground);
    const t = now + Math.random() * 0.2;
    const dur = this.emitRec(ev.key, ev, now, t, pos);
    if (!dur) return false;
    const left = ev.bout ? Math.round(rand(ev.bout[0], ev.bout[1])) - 1 : 0;
    if (left > 0) this.pending.push({ t: t + dur + rand(ev.gapIn[0], ev.gapIn[1]), key: ev.key, o: ev, pos, left: left - 1 });
    // a second animal answers from somewhere else
    if (ev.answer && Math.random() < ev.answer) this.pending.push({ t: t + dur * 0.5 + rand(2, 6), key: ev.key, o: ev, pos: this._ring(ev.dist, ev.elev, false), left: 0 });
    return true;
  }

  // night dread: a branch snapping, a rustle, or something padding past behind you
  _dread(now) {
    const k = Math.random();
    const v = rand(0.6, 1);
    if (k < 0.4) {
      if (!this.rec.has('branch_snap')) return;
      this.emitRec('branch_snap', { vol: 0.6 * v, ref: 4, hrtf: true, rj: 0.1, pitch: 0.92, wet: 0.45 }, now, now, this._behind(12, 35, 140));
    } else if (k < 0.7) {
      if (!this.rec.has('bush_rustle')) return;
      this.emitRec('bush_rustle', { vol: 0.55 * v, ref: 3, hrtf: true, rj: 0.08, wet: 0.35 }, now, now, this._behind(10, 30, 140));
    } else {
      if (!this.rec.has('animal_steps')) return;
      const p0 = this._behind(14, 28, 200);
      const a = Math.random() * TAU;
      const n = 3 + Math.floor(Math.random() * 5);
      const step = { vol: 0.7 * v, ref: 3, hrtf: true, rj: 0.1, pitch: 0.9, wet: 0.3 };
      let t = now;
      for (let i = 0; i < n; i++) {
        this.pending.push({ t, key: 'animal_steps', o: step, pos: [p0[0] + Math.sin(a) * i * 0.8, p0[1], p0[2] + Math.cos(a) * i * 0.8], left: 0 });
        t += rand(0.28, 0.45);
      }
      if (Math.random() < 0.4 && this.rec.has('bush_rustle')) this.pending.push({ t, key: 'bush_rustle', o: { vol: 0.4 * v, ref: 3, hrtf: true, wet: 0.35 }, pos: p0, left: 0 });
    }
  }

  // thunder for a lightning strike at (x, z), `dist` m from the listener, arriving `delay` s after the flash
  thunder(x, z, dist, delay) {
    const now = this.ctx.currentTime;
    const near = dist < 170;
    const y = this.e._ly + (near ? 25 : 80);
    const ev = near ? THUNDER_NEAR : THUNDER;
    this.rec.want(ev.rec.key); // decoded by the time the sound gets here
    this.pending.push({ t: now + delay, ev, pos: [x, y, z], steal: true });
  }

  burst(bank, count) {
    const now = this.ctx.currentTime;
    if (bank === 'amb_bird') {
      this.kickAt = now; // the dawn stinger: the chorus swells even when the game doesn't pass `cycle`
      if (this.rec.covers('bird_robin') || this.rec.covers('bird_chickadee')) {
        for (let k = 0; k < Math.min(3, count); k++) {
          const ev = REC_BY_KEY[k % 2 ? 'bird_chickadee' : 'bird_robin'];
          this.rec.want(ev.key);
          if (this.rec.covers(ev.key)) this.pending.push({ t: now + 0.5 + Math.random() * 5, key: ev.key, o: ev, pos: this._ring(ev.dist, ev.elev, false), left: 1 });
        }
        return;
      }
    }
    const ev = PROC_EVENTS.find((x) => x.bank === bank);
    if (!ev) return;
    for (let k = 0; k < count; k++) this.pending.push({ t: now + 0.5 + Math.random() * 5, ev, pos: null });
  }

  stateChanged(now, s) {
    // nothing immediate beyond the tick; kept for symmetry with Music
  }

  // time of day weights. `cycle` (the renderer's day cycle: day 0.055..0.485, night 0.5..0.99) gives proper
  // morning / evening windows; without it dawn and dusk are inferred from how `night` changes.
  _timeOfDay(now, s, dt) {
    const tf = this.tf;
    if (s.menu) {
      tf.dawn = 0;
      tf.day = 0.1;
      tf.dusk = 0.75;
      tf.night = 0.35;
      this.prevNight = -1;
      return tf;
    }
    const n = s.night;
    if (this.prevNight >= 0) {
      const dn = (n - this.prevNight) / Math.max(dt, 0.05);
      if (dn > 0.004) this.riseAt = now;
      // a real dawn comes out of full night (not the sky easing in after joining mid-day)
      else if (dn < -0.004 && n < 0.6 && this.nightPeak > 0.75) this.dawnAt = now;
    }
    this.prevNight = n;
    this.nightPeak = n < 0.05 ? 0 : Math.max(this.nightPeak, n);
    const c = s.cycle;
    let dawn;
    let dusk;
    if (c === c) {
      dawn = c < 0.3 ? 1 - smooth(0.085, 0.19, c) : smooth(0.97, 0.995, c);
      dusk = c > 0.3 && c < 0.7 ? smooth(0.385, 0.455, c) * (1 - smooth(0.505, 0.545, c)) : 0;
    } else {
      dawn = (1 - smooth(40, 90, now - this.dawnAt)) * (1 - smooth(0.4, 0.7, n));
      dusk = (1 - smooth(8, 20, now - this.riseAt)) * smooth(0, 0.08, n) * (1 - smooth(0.85, 1, n));
    }
    tf.dawn = Math.max(dawn, (1 - smooth(40, 90, now - this.kickAt)) * (1 - smooth(0.4, 0.7, n)));
    tf.dusk = dusk;
    tf.night = n;
    tf.day = (1 - n) * (1 - tf.dawn) * (1 - dusk);
    return tf;
  }

  tick(now, s) {
    const dt = this.lastTick ? Math.min(1, now - this.lastTick) : 0.2;
    this.lastTick = now;
    const rec = this.rec;
    const n = s.menu ? 0.6 : s.night;
    const d = 1 - n;
    const cover = Math.max(s.underCover ? 1 : 0, s.indoor);
    const tf = this._timeOfDay(now, s, dt);

    // threat: quick to hush the forest, slow to trust it again
    const raw = s.menu || s.dead ? 0 : Math.max(s.danger, s.horde ? 0.55 : 0, s.boss ? 0.7 : 0);
    this.threat += (raw - this.threat) * (1 - Math.exp(-dt / (raw > this.threat ? 1.2 : 9)));
    const fearRaw = s.menu || s.dead ? 0 : s.danger;
    this.fear += (fearRaw - this.fear) * (1 - Math.exp(-dt / (fearRaw > this.fear ? 0.8 : 4)));
    const quiet = 1 - 0.92 * this.threat;

    // wind (m/s): the weather's (0.3 everyday breeze .. ~1.2 gale, gusts included) when given, otherwise a slow
    // wander that picks up at night
    const w = s.wind === s.wind ? 1 + 13 * s.wind : windField(now) + 2.5 * tf.night + (s.horde ? 1.5 : 0);
    const own = gustField(now);
    const gust = s.gust === s.gust ? clamp01(0.5 * own + 0.6 * s.gust) : own;
    this.wind.speed = w;
    this.wind.gust = gust;
    this.wind.strength = clamp01((w - 1) / 13);

    // ---- procedural beds (original mix), faded out where a recording takes over
    if (now > this.nextGust) {
      this.nextGust = now + rand(2.5, 6);
      this.gust = rand(0.65, 1.3);
    }
    const recWind = rec.covers('wind_light') && rec.covers('wind_mid') ? 1 : 0;
    const recCrickets = rec.covers('amb_crickets') ? 1 : 0;
    const recFire = rec.covers('fire_roar') ? 1 : 0;
    const recHorde = rec.covers('amb_horde') ? 1 : 0;
    const recRain = rec.covers('amb_rain') ? 1 : 0;
    const tc = 1.6;
    // weather wind: 0.3 is the everyday breeze, ~1.2 a gale (gusts included, in step with the trees)
    const ww = Math.max(0, (s.wind === s.wind ? s.wind : 0.3) - 0.3);
    const rain = s.rain || 0;
    const weatherQuiet = (1 - 0.8 * rain) * (1 - 0.6 * smooth(0.5, 1, s.wind || 0));
    this.beds.wind.set(Math.min(0.95, (0.22 + 0.2 * n) * this.gust * (1 + ww * 1.7) * (1 - 0.4 * cover) * (s.menu ? 0.8 : 1)) * (1 - recWind), now, tc);
    this.beds.pines.set(Math.min(0.8, (0.14 + 0.09 * n) * this.gust * this.gust * (1 + ww * 2.2) * (1 - 0.6 * cover)) * (1 - recWind), now, tc);
    this.beds.rain.set(s.menu ? 0 : rain * (cover ? 0.42 : 0.55) * (1 - recRain), now, 2);
    const rl = cover ? 650 : 11000;
    if (rl !== this._rl) {
      this._rl = rl;
      this.rainLP.frequency.setTargetAtTime(rl, now, 0.3);
    }
    const cr = s.menu ? 0.18 : smooth(0.35, 0.85, n) * 0.38 * (1 - 0.75 * s.danger) * (s.horde ? 0.3 : 1) * weatherQuiet;
    this.beds.crickets.set(cr * (1 - recCrickets), now, 2.5);
    this.beds.drone.set(s.menu ? 0.16 : n * 0.28 + (s.horde ? 0.1 : 0) + (s.dead ? 0.25 : 0), now, 3);
    this.beds.horde.set(!s.menu && s.horde ? 0.32 * (1 - recHorde) : 0, now, 2.5);
    this.beds.fire.set(s.menu ? 0 : s.nearFire * 0.25 * (1 - recFire), now, 1);
    const wl = cover ? 900 : 1400 + 2600 * (this.gust - 0.6) + 1800 * Math.min(1, ww);
    if (Math.abs(wl - (this._wl || 0)) > 60) {
      this._wl = wl;
      this.windLP.frequency.setTargetAtTime(wl, now, 1.2);
    }

    // ---- recorded beds
    const L = this.lvl;
    const birds = (1 - 0.6 * smooth(9, 16, w)) * (1 - 0.85 * this.threat) * (1 - 0.85 * rain);
    const nn = tf.night;
    L.amb_day = (0.3 + 0.7 * tf.day) * (1 - nn) * (1 - 0.5 * tf.dawn) * birds;
    L.amb_day_wind = (1 - nn) * smooth(2.5, 8, w) * (0.6 + 0.4 * gust);
    L.amb_dawn = tf.dawn * birds;
    L.amb_dusk = tf.dusk * (1 - 0.7 * this.threat);
    L.amb_night = smooth(0.2, 0.7, nn) * (1 - 0.5 * this.threat);
    L.amb_crickets = (s.menu ? 0.45 : smooth(0.35, 0.85, nn)) * (1 - 0.95 * this.threat) * (s.horde ? 0.3 : 1) * (1 - 0.7 * smooth(8, 14, w)) * (1 - 0.8 * rain);
    const gustAmp = 0.62 + 0.55 * gust;
    L.wind_light = bell(w, 3.5, 3.2) * gustAmp;
    L.wind_mid = bell(w, 8.5, 3.5) * gustAmp;
    L.wind_strong = bell(w, 13.5, 4) * gustAmp;
    L.fire_roar = s.menu ? 0 : s.nearFire;
    L.amb_horde = !s.menu && s.horde ? 1 : 0;
    L.amb_rain = s.menu ? 0 : rain * (cover ? 0.76 : 1);
    const outdoor = 0.35 + 0.65 * (1 - cover);
    const wrate = 0.97 + 0.07 * gust + 0.02 * smooth(5, 20, w);
    for (const b of this.rbedList) {
      b.set(L[b.key] * (b.def.dry || b.def.rain ? 1 : outdoor), now, b.def.wind ? 0.5 : 1.6);
      if (b.def.wind) b.setRate(wrate, now);
    }
    const clp = cover ? 2500 : 20000;
    if (clp !== this._clp) {
      this._clp = clp;
      this.coverLP.frequency.setTargetAtTime(clp, now, 0.6);
    }

    // ---- one-shots: original procedural events unless a recording replaces them
    for (let i = 0; i < PROC_EVENTS.length; i++) {
      const ev = PROC_EVENTS[i];
      if (ev.by && (rec.covers(ev.by[0]) || (ev.by[1] && rec.covers(ev.by[1])))) continue;
      const perMin = ev.rate(s, d, n);
      if (perMin <= 0) continue;
      this.pT[i] -= (perMin / 60) * dt;
      if (this.pT[i] > 0) continue;
      this.pT[i] = expWait(1);
      if (now - this.pLast[i] < ev.gap) continue;
      const pos = this.emit(ev, now, now + Math.random() * 0.2);
      if (pos) {
        this.pLast[i] = now;
        if (ev.tolls) {
          const k = 1 + Math.floor(Math.random() * 3);
          for (let j = 1; j <= k; j++) this.pending.push({ t: now + j * 3.5, ev, pos });
        }
      }
    }
    for (let i = 0; i < REC_EVENTS.length; i++) {
      const ev = REC_EVENTS[i];
      const perMin = ev.rate(s, tf, quiet, w);
      // get(): keeps an active species decoded (or decodes it on demand); skipped until it is
      if (perMin <= 0 || !rec.get(ev.key)) continue;
      this.rT[i] -= (perMin / 60) * dt;
      if (this.rT[i] > 0) continue;
      this.rT[i] = expWait(1);
      if (now - this.rLast[i] < ev.gap) continue;
      if (this._fireRec(ev, now)) this.rLast[i] = now;
    }
    const dreadPerMin = s.menu || s.dead ? 0 : 0.6 * (tf.night + 0.4 * tf.dusk) * (1 + 4 * this.threat) * (1 - 0.6 * cover);
    if (dreadPerMin > 0.01) {
      this.dreadT -= (dreadPerMin / 60) * dt;
      if (this.dreadT <= 0) {
        this.dreadT = expWait(1);
        this._dread(now);
      }
    }
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k];
      if (p.t < now + 0.3) {
        this.pending.splice(k, 1);
        if (!p.key) {
          // the recorded take when the event has one and it is decoded, else its procedural bank
          if (!(p.ev.rec && this.emitRec(p.ev.rec.key, p.ev.rec, now, p.t, p.pos, !!p.steal))) this.emit(p.ev, now, p.t, p.pos, !!p.steal);
        } else {
          const dur = this.emitRec(p.key, p.o, now, p.t, p.pos);
          if (dur && p.left > 0) {
            p.t += dur + rand(p.o.gapIn[0], p.o.gapIn[1]);
            p.left--;
            this.pending.push(p);
          }
        }
      }
    }
  }
}
