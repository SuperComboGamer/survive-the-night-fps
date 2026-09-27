// Forest ambience: seamless looping beds (wind, pines, crickets, night drone, distant horde, 2D fire)
// plus randomly scheduled one-shots (birds, crows, owls, wolves, creaks, twigs, screams, whispers,
// a distant chapel bell, far-off zombie groans) placed at world positions around the listener.
// All scheduling runs from the engine's 200 ms tick - nothing per frame.

const rand = (a, b) => a + (b - a) * Math.random();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const POOL = 8;
const MAX_HRTF = 3;

// rate(s, day, night) -> events per minute
const EVENTS = [
  { bank: 'amb_bird', rate: (s, d) => 7 * d * (1 - 0.85 * s.danger) * (s.menu ? 0.15 : 1), dist: [12, 45], elev: [3, 12], vol: 0.3, ref: 8, gap: 1.5 },
  { bank: 'amb_crow', rate: (s, d, n) => (1.3 * d + 2.2 * smooth(0.1, 0.35, n) * (1 - smooth(0.5, 0.8, n))) * (s.menu ? 0.4 : 1), dist: [30, 90], elev: [6, 16], vol: 0.45, ref: 16, gap: 9 },
  { bank: 'amb_woodpecker', rate: (s, d) => 0.45 * d * (s.menu ? 0 : 1), dist: [40, 90], elev: [2, 8], vol: 0.35, ref: 20, gap: 30 },
  { bank: 'amb_creak', rate: (s, d, n) => 2 + 2.2 * n, dist: [8, 35], elev: [3, 10], vol: 0.3, ref: 6, gap: 4 },
  { bank: 'amb_twig', rate: (s, d, n) => (1.1 * n + 0.6 * s.danger) * (s.menu ? 0 : 1), dist: [6, 20], elev: [0, 0.3], vol: 0.35, ref: 4, gap: 10, hrtf: true },
  { bank: 'amb_owl', rate: (s, d, n) => 1.9 * n * (s.horde ? 0.4 : 1), dist: [25, 70], elev: [6, 14], vol: 0.42, ref: 15, gap: 12 },
  { bank: 'amb_wolf', rate: (s, d, n) => 1.1 * smooth(0.4, 0.9, n) * (s.horde ? 0.5 : 1) * (s.menu ? 0.5 : 1), dist: [150, 260], elev: [0, 10], vol: 0.8, ref: 80, gap: 25 },
  { bank: 'amb_scream', rate: (s, d, n) => (0.35 * smooth(0.5, 1, n) + (s.horde ? 0.8 : 0)) * (s.menu ? 0 : 1), dist: [120, 250], elev: [0, 5], vol: 0.55, ref: 70, gap: 30 },
  { bank: 'amb_whisper', rate: (s, d, n) => (0.22 * smooth(0.6, 1, n) + (s.dead ? 2 : 0) + s.lowHealth * 0.7) * (s.menu ? 0 : 1), dist: [2.5, 6], elev: [0, 1.5], vol: 0.2, ref: 2, gap: 20, hrtf: true },
  { bank: 'amb_bell', rate: (s, d, n) => 0.2 * smooth(0.5, 1, n), dist: [220, 320], elev: [10, 30], vol: 0.65, ref: 120, gap: 90, tolls: true },
  { bank: 'z_growl', rate: (s, d, n) => (2 * smooth(0.5, 1, n) + (s.horde ? 14 : 0)) * (s.menu ? 0 : 1), dist: [35, 80], elev: [0, 1], vol: 0.4, ref: 6, gap: 0.8, rateJit: 0.15 },
];

function setPos(p, x, y, z) {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else p.setPosition(x, y, z);
}

class Bed {
  constructor(amb, bank, dest) {
    this.a = amb;
    this.bank = bank;
    this.gain = amb.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(dest);
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
    };
    // horde chorus also feeds the reverb (distance)
    const hs = c.createGain();
    hs.gain.value = 0.4;
    this.beds.horde.gain.connect(hs);
    hs.connect(engine._ambSend);

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
    this.lastAt = new Float64Array(EVENTS.length);
    this.gust = 1;
    this.nextGust = 0;
    this.lastTick = 0;
    this.pending = []; // [time, bank] delayed extra events (bell tolls, bursts)
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

  // play a one-shot at a random world position around the listener (or at `pos` [x,y,z]).
  // Returns the position used (or null).
  emit(ev, now, when = 0, pos = null) {
    const e = this.e;
    const buf = e._pick(ev.bank);
    if (!buf) {
      e._need(ev.bank);
      return null;
    }
    let ch = null;
    for (const c of this.chans) {
      if (!c.src || c.end + 0.5 < now) {
        if (c.src) {
          try {
            c.src.stop();
          } catch {}
          this._release(c);
        }
        ch = c;
        break;
      }
    }
    if (!ch) return null;
    let x;
    let y;
    let z;
    if (pos) [x, y, z] = pos;
    else {
      const ang = Math.random() * Math.PI * 2;
      const r = rand(ev.dist[0], ev.dist[1]);
      x = e._lx + Math.sin(ang) * r;
      z = e._lz + Math.cos(ang) * r;
      y = e._ly + rand(ev.elev[0], ev.elev[1]);
    }
    const dx = x - e._lx;
    const dy = y - e._ly;
    const dz = z - e._lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const wantH = !!ev.hrtf && this.hrtfN < MAX_HRTF;
    const model = wantH ? 'HRTF' : 'equalpower';
    if (ch.model !== model) {
      ch.panner.panningModel = model;
      ch.model = model;
    }
    if (wantH) this.hrtfN++;
    ch.hrtf = wantH;
    ch.panner.refDistance = ev.ref;
    setPos(ch.panner, x, y, z);
    const fc = 400 + 19600 * Math.exp(-d / 90);
    ch.filter.frequency.value = fc > 18000 ? 20000 : fc;
    ch.gain.gain.value = ev.vol * rand(0.75, 1.1);
    ch.send.gain.value = 0.25 + 0.5 * Math.min(1, d / 150);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const rj = ev.rateJit ?? 0.05;
    src.playbackRate.value = (1 + (Math.random() - 0.5) * 2 * rj) * e._rateMul;
    src.connect(ch.filter);
    src.onended = ch.onEnded;
    const t = Math.max(now, when);
    src.start(t);
    ch.src = src;
    ch.end = t + buf.duration / src.playbackRate.value;
    return [x, y, z];
  }

  burst(bank, count) {
    const ev = EVENTS.find((x) => x.bank === bank);
    if (!ev) return;
    const now = this.ctx.currentTime;
    for (let k = 0; k < count; k++) this.pending.push([now + 0.5 + Math.random() * 5, ev]);
  }

  stateChanged(now, s) {
    // nothing immediate beyond the tick; kept for symmetry with Music
  }

  tick(now, s) {
    const dt = this.lastTick ? Math.min(1, now - this.lastTick) : 0.2;
    this.lastTick = now;
    const n = s.menu ? 0.6 : s.night;
    const d = 1 - n;
    const cover = s.underCover ? 1 : 0;
    if (now > this.nextGust) {
      this.nextGust = now + rand(2.5, 6);
      this.gust = rand(0.65, 1.3);
    }
    const tc = 1.6;
    this.beds.wind.set((0.22 + 0.2 * n) * this.gust * (1 - 0.4 * cover) * (s.menu ? 0.8 : 1), now, tc);
    this.beds.pines.set((0.14 + 0.09 * n) * this.gust * this.gust * (1 - 0.6 * cover), now, tc);
    const cr = s.menu ? 0.18 : smooth(0.35, 0.85, n) * 0.38 * (1 - 0.75 * s.danger) * (s.horde ? 0.3 : 1);
    this.beds.crickets.set(cr, now, 2.5);
    this.beds.drone.set(s.menu ? 0.16 : n * 0.28 + (s.horde ? 0.1 : 0) + (s.dead ? 0.25 : 0), now, 3);
    this.beds.horde.set(!s.menu && s.horde ? 0.32 : 0, now, 2.5);
    this.beds.fire.set(s.menu ? 0 : s.nearFire * 0.25, now, 1);
    const wl = cover ? 900 : 1400 + 2600 * (this.gust - 0.6);
    if (Math.abs(wl - (this._wl || 0)) > 60) {
      this._wl = wl;
      this.windLP.frequency.setTargetAtTime(wl, now, 1.2);
    }

    // random one-shots
    for (let i = 0; i < EVENTS.length; i++) {
      const ev = EVENTS[i];
      const perMin = ev.rate(s, d, n);
      if (perMin <= 0) continue;
      if (now - this.lastAt[i] < ev.gap) continue;
      if (Math.random() < (perMin / 60) * dt) {
        const pos = this.emit(ev, now, now + Math.random() * 0.2);
        if (pos) {
          this.lastAt[i] = now;
          if (ev.tolls) {
            const k = 1 + Math.floor(Math.random() * 3);
            for (let j = 1; j <= k; j++) this.pending.push([now + j * 3.5, ev, pos]);
          }
        }
      }
    }
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k];
      if (p[0] < now + 0.3) {
        this.pending.splice(k, 1);
        this.emit(p[1], now, p[0], p[2] || null);
      }
    }
  }
}
