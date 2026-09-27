// Generative horror score. A handful of long-lived oscillators (drone, choir, tension strings) plus
// pre-rendered instrument buffers (piano, music box, taiko, bass, brass, swells) scheduled with a
// look-ahead from the engine's 200 ms tick. Never repeats identically: every choice is random.

const LOOK = 0.5; // seconds scheduled ahead of currentTime
const ROOT = 38; // D2
const SCALE = [0, 1, 3, 5, 6, 7, 8, 10]; // D phrygian + b5
const PIANO_BASE = [33, 45, 57, 69, 81]; // mus_piano variants (A1..A5)
const BOX_BASE = [69, 81]; // mus_box variants (A4, A5)
const BASS_BASE = 33; // mus_bass (A1)
const BRASS_BASE = 33; // mus_brass (A1)

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + (b - a) * Math.random();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// drone "chords": [root offset, interval] in semitones
const DRONE_CHORDS = [[0, 7], [0, 1], [0, 6], [-2, 5], [1, 8], [0, 3], [-4, 3], [0, 10]];

// horde percussion: B big drum, m mid drum, k rim, p sub pulse (heartbeat)
const HORDE_PATTERNS = ['B...p...B..mp...', 'B..mp...B.m.p.m.', 'B...p..mB...p.k.', 'B.m.p...B.B.p.mm', 'B...p.k.B..mp..k', 'B..kp...B...p.m.'];
const HORDE_FILLS = ['B...p...BmmmBmBB', 'B..mp.m.BmBmmBBB', 'B...p...B.B.BBBB'];
// boss ostinato (semitones above D1; null = rest)
const BOSS_BASS = [
  [0, 0, 12, 0, 1, 0, 0, 12, 0, 0, 6, 0, 1, 0, 3, 1],
  [0, null, 0, 12, 0, 0, 1, null, 0, 0, 6, 6, 0, 1, 0, -2],
  [0, 0, 1, 0, 0, 12, 0, 1, 0, 0, 6, 0, 7, 6, 1, 0],
];
// menu lullaby phrases (semitones relative to D4) and their bass notes (relative to D2)
const LULLABY = [
  [7, 3, 2, 0, 1, 0, -2, -5],
  [0, 3, 7, 8, 7, 3, 2, 1],
  [12, 10, 8, 7, 6, 7, 3, 0],
  [5, 3, 1, 0, 3, 2, -2, 0],
  [7, 8, 7, 3, 0, 1, 3, 2],
];
const LULLABY_BASS = [0, -4, -7, -5, 0];

export class Music {
  constructor(engine) {
    this.e = engine;
    const c = (this.ctx = engine._ctx);
    const g = (v) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    this.out = g(1);
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.filter.Q.value = 0.5;
    this.duckG = g(1);
    this.out.connect(this.filter);
    this.filter.connect(this.duckG);
    this.duckG.connect(engine._musicIn);

    // long hall reverb for piano / swells
    this.verbIn = g(1);
    this.verbIn.channelCount = 1;
    this.verbIn.channelCountMode = 'explicit';
    this.verb = c.createConvolver();
    this.verbOut = g(0.9);
    this.verbIn.connect(this.verb);
    this.verb.connect(this.verbOut);
    this.verbOut.connect(this.out);
    if (engine._hallIR) this.verb.buffer = engine._hallIR;

    const layer = (v, send) => {
      const n = g(v);
      n.connect(this.out);
      if (send) {
        const s = g(send);
        n.connect(s);
        s.connect(this.verbIn);
      }
      return n;
    };
    this.droneG = layer(0, 0.12);
    this.choirG = layer(0, 0.5);
    this.pianoG = layer(0.7, 1.1);
    this.swellG = layer(0.5, 0.6);
    this.tensionG = layer(0, 0.3);
    this.hordeG = layer(0, 0.25);
    this.bossG = layer(0, 0.18);

    this.last = Object.create(null);
    this.danger = 0;
    this.detune = 1;
    this.deg = 4;
    this.nextNote = 0;
    this.nextSwell = 0;
    this.nextChord = 0;
    this.seqStep = -1;
    this.seqTime = 0;
    this.seqUntil = 0;
    this.bar = 0;
    this.stepDur = 0.19;
    this.pattern = HORDE_PATTERNS[0];
    this.bassPat = BOSS_BASS[0];
    this.bossOn = false;
    this.menuPhrase = null;
    this.menuIdx = 0;
    this.menuLast = -1;
    this.tens = null;
    this.tensionOffAt = 0;
    this.nextHigh = 0;
    this.chord = DRONE_CHORDS[0];
    this._buildDrone();
  }

  setIR(buf) {
    try {
      this.verb.buffer = buf;
    } catch {}
  }

  _buffer(bank, idx) {
    const a = this.e._banks.get(bank);
    return a ? a[idx] || null : null;
  }

  _set(key, param, v, tc, now) {
    const l = this.last[key];
    if (l !== undefined && Math.abs(l - v) < 0.004) return;
    this.last[key] = v;
    param.setTargetAtTime(v, now, tc);
  }

  // ---------------------------------------------------------------- drone + choir (long-lived oscillators)
  _buildDrone() {
    const c = this.ctx;
    const now = c.currentTime;
    this.dFilter = c.createBiquadFilter();
    this.dFilter.type = 'lowpass';
    this.dFilter.frequency.value = 300;
    this.dFilter.Q.value = 1.4;
    this.dFilter.connect(this.droneG);
    this.dLfo = c.createOscillator();
    this.dLfo.frequency.value = 0.045;
    const lg = c.createGain();
    lg.gain.value = 110;
    this.dLfo.connect(lg);
    lg.connect(this.dFilter.frequency);
    this.dLfo.start(now);
    const root = mtof(ROOT);
    const osc = (type, f, det, gain, dest) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const gg = c.createGain();
      gg.gain.value = gain;
      o.connect(gg);
      gg.connect(dest);
      o.start(now);
      o._baseDet = det;
      return o;
    };
    this.dSub = osc('sine', root / 2, 0, 0.55, this.dFilter);
    this.dA = osc('sawtooth', root, -7, 0.16, this.dFilter);
    this.dB = osc('sawtooth', root, 6, 0.16, this.dFilter);
    this.dC = osc('sawtooth', root * Math.pow(2, 7 / 12), 3, 0.1, this.dFilter);
    // ghost choir: saws through two vowel formants with slow vibrato
    this.cF1 = c.createBiquadFilter();
    this.cF1.type = 'bandpass';
    this.cF1.frequency.value = 480;
    this.cF1.Q.value = 5;
    this.cF2 = c.createBiquadFilter();
    this.cF2.type = 'bandpass';
    this.cF2.frequency.value = 820;
    this.cF2.Q.value = 6;
    const cm = c.createGain();
    cm.gain.value = 0.5;
    cm.connect(this.cF1);
    cm.connect(this.cF2);
    this.cF1.connect(this.choirG);
    this.cF2.connect(this.choirG);
    this.cA = osc('sawtooth', root * 2, 0, 0.5, cm);
    this.cB = osc('sawtooth', root * 2 * Math.pow(2, 3 / 12), 0, 0.4, cm);
    this.vib = c.createOscillator();
    this.vib.frequency.value = 4.8;
    const vg = c.createGain();
    vg.gain.value = 9;
    this.vib.connect(vg);
    vg.connect(this.cA.detune);
    vg.connect(this.cB.detune);
    this.vib.start(now);
    this.droneOsc = [this.dSub, this.dA, this.dB, this.dC, this.cA, this.cB];
  }

  _newChord(now, menu) {
    this.chord = menu ? pick([[0, 7], [0, 3], [-4, 3]]) : pick(DRONE_CHORDS);
    const [r, iv] = this.chord;
    const root = mtof(ROOT + r);
    const tc = 2.5;
    this.dSub.frequency.setTargetAtTime(root / 2, now, tc);
    this.dA.frequency.setTargetAtTime(root, now, tc);
    this.dB.frequency.setTargetAtTime(root, now, tc);
    this.dC.frequency.setTargetAtTime(root * Math.pow(2, iv / 12), now, tc);
    this.cA.frequency.setTargetAtTime(root * 2, now, tc * 1.5);
    this.cB.frequency.setTargetAtTime(root * 2 * Math.pow(2, (iv === 7 ? 3 : iv) / 12), now, tc * 1.5);
  }

  // ---------------------------------------------------------------- tension strings (created on demand)
  _ensureTension() {
    if (this.tens) return;
    const c = this.ctx;
    const now = c.currentTime;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.Q.value = 0.8;
    const trem = c.createGain();
    trem.gain.value = 0.55;
    const lfo = c.createOscillator();
    lfo.frequency.value = 8;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.45;
    lfo.connect(lfoG);
    lfoG.connect(trem.gain);
    lp.connect(trem);
    trem.connect(this.tensionG);
    const oscs = [lfo];
    for (const m of [50, 51, 56, 57]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      o.detune.value = rand(-9, 9);
      const og = c.createGain();
      og.gain.value = 0.12;
      o.connect(og);
      og.connect(lp);
      o.start(now);
      oscs.push(o);
    }
    // high glassy harmonic with vibrato
    const hi = c.createOscillator();
    hi.type = 'sine';
    hi.frequency.value = mtof(86);
    const hv = c.createOscillator();
    hv.frequency.value = 5.5;
    const hvg = c.createGain();
    hvg.gain.value = 9;
    hv.connect(hvg);
    hvg.connect(hi.frequency);
    const hg = c.createGain();
    hg.gain.value = 0.05;
    hi.connect(hg);
    hg.connect(this.tensionG);
    hi.start(now);
    hv.start(now);
    lfo.start(now);
    oscs.push(hi, hv);
    this.tens = { lp, trem, lfo, hi, oscs, nodes: [lp, trem, lfoG, hg, hvg] };
    this.last.tLp = undefined;
    this.last.tRate = undefined;
  }

  _releaseTension() {
    const t = this.tens;
    if (!t) return;
    this.tens = null;
    const now = this.ctx.currentTime;
    for (const o of t.oscs) {
      try {
        o.stop(now + 0.05);
      } catch {}
      o.onended = () => o.disconnect();
    }
    setTimeout(() => {
      for (const n of t.nodes) {
        try {
          n.disconnect();
        } catch {}
      }
    }, 300);
  }

  // ---------------------------------------------------------------- note helpers
  _note(t, midi, vel, box, bend = 0, dest = this.pianoG) {
    const bases = box ? BOX_BASE : PIANO_BASE;
    let bi = 0;
    for (let k = 1; k < bases.length; k++) if (Math.abs(midi - bases[k]) < Math.abs(midi - bases[bi])) bi = k;
    const buf = this._buffer(box ? 'mus_box' : 'mus_piano', bi);
    if (!buf) return;
    const rate = Math.pow(2, (midi - bases[bi]) / 12) * this.detune * (1 + (Math.random() - 0.5) * 0.01);
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    if (bend) {
      src.playbackRate.setValueAtTime(rate, t + 0.25);
      src.playbackRate.linearRampToValueAtTime(rate * Math.pow(2, bend / 12), t + 2.2);
    }
    const g = c.createGain();
    g.gain.value = vel;
    src.connect(g);
    let p = null;
    if (c.createStereoPanner) {
      p = c.createStereoPanner();
      p.pan.value = rand(-0.6, 0.6);
      g.connect(p);
      p.connect(dest);
    } else g.connect(dest);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      if (p) p.disconnect();
    };
    src.start(t);
  }

  _hit(bank, idx, t, vel, dest, rate = 1, pan = 0) {
    const buf = this._buffer(bank, idx);
    if (!buf) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * this.detune;
    const g = c.createGain();
    g.gain.value = vel;
    src.connect(g);
    let p = null;
    if (pan && c.createStereoPanner) {
      p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(dest);
    } else g.connect(dest);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      if (p) p.disconnect();
    };
    src.start(t);
  }

  _degToMidi(d) {
    const o = Math.floor(d / SCALE.length);
    const k = d - o * SCALE.length;
    return 62 + o * 12 + SCALE[k];
  }

  _walk(lo, hi) {
    this.deg += pick([-2, -1, -1, 1, 1, 2, 0, 3, -3]);
    let m = this._degToMidi(this.deg);
    while (m < lo) {
      this.deg += SCALE.length;
      m += 12;
    }
    while (m > hi) {
      this.deg -= SCALE.length;
      m -= 12;
    }
    return m;
  }

  // ---------------------------------------------------------------- schedulers
  _pianoEvent(t, st) {
    const night = st.night;
    const box = Math.random() < 0.35 * (1 - night) + 0.08;
    const lo = night > 0.5 ? 50 : 60;
    const hi = night > 0.5 ? 76 : 86;
    const m = this._walk(lo, hi);
    const vel = rand(0.22, 0.6);
    const r = Math.random();
    if (r < 0.52) this._note(t, m, vel, box);
    else if (r < 0.72) {
      this._note(t, m, vel, box);
      this._note(t + rand(0, 0.05), m + (Math.random() < 0.5 ? 1 : 6), vel * 0.75, box);
    } else if (r < 0.88) {
      let d = this.deg;
      const gap = rand(0.35, 0.65);
      for (let k = 0; k < 3; k++) {
        this._note(t + k * gap, this._degToMidi(d) + (m - this._degToMidi(this.deg)), vel * (1 - k * 0.15), box);
        d -= Math.random() < 0.3 ? 2 : 1;
      }
    } else if (r < 0.96) {
      this._note(t, ROOT + pick([0, -2, 1, 5, 6]), 0.45, false);
      this._note(t + 0.03, m, vel * 0.7, box);
    } else this._note(t, m, vel, false, -rand(0.3, 1));
  }

  _menuStep(t) {
    if (!this.menuPhrase || this.menuIdx >= this.menuPhrase.length) {
      let k = Math.floor(Math.random() * LULLABY.length);
      if (k === this.menuLast) k = (k + 1) % LULLABY.length;
      this.menuLast = k;
      this.menuPhrase = LULLABY[k];
      this.menuIdx = 0;
      this._note(t, ROOT + LULLABY_BASS[k], 0.42, false);
      if (Math.random() < 0.5) this._note(t + 0.02, ROOT + LULLABY_BASS[k] + 7, 0.22, false);
    }
    let x = this.menuPhrase[this.menuIdx++];
    if (Math.random() < 0.1) x += pick([1, -1, 6]);
    if (Math.random() < 0.08) x += 12;
    const m = 62 + x;
    this._note(t, m, rand(0.3, 0.45), true);
    if (Math.random() < 0.3) this._note(t + 0.01, m - 12, 0.2, false);
    const beat = 1.15;
    return this.menuIdx >= this.menuPhrase.length ? beat * rand(2.5, 4) : beat * (Math.random() < 0.18 ? 2 : 1);
  }

  _schedulePiano(now, st) {
    if (!this._buffer('mus_piano', 2)) return;
    if (this.nextNote < now) this.nextNote = now + 0.2;
    while (this.nextNote < now + LOOK) {
      const t = this.nextNote;
      if (st.menu) {
        this.nextNote = t + this._menuStep(t);
        continue;
      }
      this._pianoEvent(t, st);
      let gap = (9 - 5 * st.night) * rand(0.5, 1.5);
      if (st.horde) gap *= 1.6;
      if (st.boss) gap *= 2.5;
      if (st.dead) gap *= 1.3;
      this.nextNote = t + gap;
    }
  }

  _scheduleSwell(now, st) {
    if (!this.nextSwell) this.nextSwell = now + rand(15, 35);
    if (now < this.nextSwell - LOOK) return;
    const t = Math.max(now + 0.05, this.nextSwell);
    this.nextSwell = t + rand(35, 80) * (1.3 - 0.5 * st.night);
    if (st.boss) return;
    const v = Math.floor(Math.random() * 2);
    const buf = this._buffer('mus_swell', v);
    if (!buf) return;
    this._hit('mus_swell', v, t, rand(0.35, 0.6) * (st.menu ? 0.6 : 1), this.swellG);
    const end = t + buf.duration / this.detune;
    this._note(end, ROOT + pick([0, 1, -2, 6]), 0.55, false);
    if (Math.random() < 0.5) this._note(end + 0.02, ROOT + 12 + pick([0, 1, 6]), 0.3, false);
  }

  _sequence(now, st) {
    const want = !st.menu && (st.horde || st.boss);
    if (want) this.seqUntil = now + 6;
    if (now > this.seqUntil) {
      this.seqStep = -1;
      return;
    }
    if (!this._buffer('mus_taiko', 0)) return;
    if (this.seqStep < 0) {
      this.seqStep = 0;
      this.seqTime = now + 0.15;
      this.bar = 0;
    }
    if (this.seqTime < now) this.seqTime = now + 0.05;
    while (this.seqTime < now + LOOK) {
      const s = this.seqStep % 16;
      const t = this.seqTime;
      if (s === 0) this._newBar(t, st);
      const ch = this.pattern[s];
      const hum = (Math.random() - 0.5) * 0.008;
      if (ch === 'B') this._hit('mus_taiko', 0, t + hum, rand(0.85, 1), this.hordeG, rand(0.97, 1.03), rand(-0.2, 0.2));
      else if (ch === 'm') this._hit('mus_taiko', 1, t + hum, rand(0.5, 0.75), this.hordeG, rand(0.96, 1.04), rand(-0.4, 0.4));
      else if (ch === 'k') this._hit('mus_taiko', 2, t + hum, rand(0.3, 0.45), this.hordeG, rand(0.95, 1.05), rand(-0.5, 0.5));
      else if (ch === 'p') this._hit('mus_pulse', 0, t, 0.9, this.hordeG);
      if (this.bossOn) {
        const b = this.bassPat[s];
        if (b !== null && b !== undefined) {
          this._hit('mus_bass', 0, t, s % 4 === 0 ? 0.85 : 0.6, this.bossG, Math.pow(2, (b + (ROOT - 12) - BASS_BASE) / 12));
        }
      }
      this.seqStep++;
      this.seqTime += this.stepDur;
    }
  }

  _newBar(t, st) {
    this.bar++;
    this.bossOn = st.boss;
    const bpm = st.boss ? 100 : rand(76, 82);
    this.stepDur = 60 / bpm / 4;
    this.pattern = this.bar % 4 === 0 ? pick(HORDE_FILLS) : pick(HORDE_PATTERNS);
    if (this.bossOn) {
      if (this.bar % 2 === 1) this.bassPat = pick(BOSS_BASS);
      if (this.bar % 2 === 1) this._hit('mus_brass', 0, t, 0.6, this.bossG, Math.pow(2, (ROOT + pick([0, 0, 1, -2]) - BRASS_BASE) / 12));
    }
  }

  _tension(now, st) {
    const target = st.menu ? 0 : clamp01(this.danger * 0.9 + (st.horde ? 0.15 : 0)) * (1 - 0.4 * st.nearFire) * (st.dead ? 0.3 : 1);
    if (target > 0.02) {
      this._ensureTension();
      this.tensionOffAt = 0;
    }
    this._set('tension', this.tensionG.gain, target * 0.42, target > (this.last.tension ?? 0) ? 0.8 : 2.5, now);
    const t = this.tens;
    if (!t) return;
    this._set('tRate', t.lfo.frequency, 6 + 8 * this.danger, 0.8, now);
    this._set('tLp', t.lp.frequency, 800 + 2800 * this.danger, 0.8, now);
    if (now > this.nextHigh) {
      this.nextHigh = now + rand(6, 11);
      t.hi.frequency.setTargetAtTime(mtof(pick([86, 87, 80, 81, 92])), now, 1.2);
    }
    if (target <= 0.02) {
      if (!this.tensionOffAt) this.tensionOffAt = now + 10;
      else if (now > this.tensionOffAt) this._releaseTension();
    }
    if (this.danger > 0.45 && Math.random() < this.danger * 0.012) {
      this._hit('mus_scrape', 0, now + 0.05, 0.25 * this.danger, this.tensionG, rand(0.85, 1.15), rand(-0.7, 0.7));
    }
  }

  // ---------------------------------------------------------------- public
  stateChanged(now, st) {
    this.detune = st.dead ? 0.94 : 1;
    const det = st.dead ? -35 : 0;
    for (const o of this.droneOsc) o.detune.setTargetAtTime(o._baseDet + det, now, 1.5);
    if (st.menu) {
      this.menuPhrase = null;
      this.nextNote = now + 0.6;
      this._newChord(now, true);
      this.nextChord = now + rand(30, 50);
    }
  }

  duck(now, dur) {
    const p = this.duckG.gain;
    const v = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
    p.setTargetAtTime(0.3, now, 0.25);
    p.setTargetAtTime(1, now + dur, 1.2);
  }

  tick(now, st) {
    const menu = st.menu;
    const k = st.danger > this.danger ? 0.5 : 0.06;
    this.danger += (st.danger - this.danger) * k;
    const night = st.night;
    const fire = 1 - 0.25 * st.nearFire;
    const drone = menu ? 0.42 : (0.14 + 0.24 * night + (st.boss ? 0.14 : 0) + (st.dead ? 0.12 : 0)) * fire;
    this._set('drone', this.droneG.gain, drone, 2.5, now);
    const choir = menu ? 0.05 : night * 0.09 * (0.4 + 0.6 * Math.max(0, Math.sin(now * 0.04)));
    this._set('choir', this.choirG.gain, choir, 3, now);
    this._set('dLp', this.dFilter.frequency, st.dead ? 160 : menu ? 380 : 240 + 140 * night + (st.boss ? 200 : 0), 3, now);
    const piano = menu ? 0.85 : (0.55 + 0.2 * night) * (st.horde || st.boss ? 0.55 : 1);
    this._set('piano', this.pianoG.gain, piano, 2, now);
    this._set('horde', this.hordeG.gain, !menu && (st.horde || st.boss) ? 0.75 : 0, st.horde || st.boss ? 1.2 : 3, now);
    this._set('boss', this.bossG.gain, !menu && st.boss ? 0.7 : 0, st.boss ? 0.8 : 3, now);
    const lp = st.dead ? 700 : 18000 * Math.pow(3500 / 18000, st.lowHealth * 0.8);
    this._set('filter', this.filter.frequency, lp, st.dead ? 0.6 : 1, now);
    if (now > this.nextChord) {
      this.nextChord = now + rand(25, 50);
      this._newChord(now, menu);
    }
    this._schedulePiano(now, st);
    this._scheduleSwell(now, st);
    this._tension(now, st);
    this._sequence(now, st);
  }
}
