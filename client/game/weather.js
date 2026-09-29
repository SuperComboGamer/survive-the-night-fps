// Weather: a seeded schedule of fog banks, gales, rain and thunderstorms laid over the day/night clock.
// Every client derives the same weather - and the same lightning strikes, to within a tick - from the world
// seed and the replicated phase clock, so nothing extra goes over the wire. The schedule leans toward dusk
// and the night: fog rolls in with the evening and the storms come after dark.
//
// Weather clock u: one day + night pair per unit, the day on [0, 0.5) and the night on [0.5, 1), linear in
// time within each phase. An event may run past the end of its cycle into the next morning.
import { PHASE, MAP_HALF, DAY_LENGTH, FIRST_DAY_LENGTH, NIGHT_LENGTH } from '../../shared/constants.js';
import { mulberry32, hash2 } from '../../shared/rng.js';

// fog: fog density multiplier, wind: 0 calm .. ~1.2 gale, rain: 0..1, bolts: lightning (1 = a strike every
// ~5 s), cloud: overcast 0..1
export const WEATHER = {
  fog: { fog: 1.75, wind: 0.14, rain: 0, bolts: 0, cloud: 0.35 },
  gale: { fog: 1.0, wind: 1.15, rain: 0, bolts: 0.07, cloud: 0.5 },
  rain: { fog: 1.3, wind: 0.5, rain: 0.62, bolts: 0.12, cloud: 0.85 },
  storm: { fog: 1.35, wind: 1.05, rain: 1, bolts: 1, cloud: 1 },
};
const KINDS = Object.keys(WEATHER);
const PARAMS = ['fog', 'wind', 'rain', 'bolts', 'cloud'];
const BASE_WIND = 0.3;
const STRIKE_SLOT = 0.5; // seconds per lightning slot
const STRIKE_RATE = 1 / 5; // strikes per second at bolts = 1
const SOUND = 343; // m/s: thunder trails the flash by distance

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// 1-2 events per day/night cycle (always at least one; the first evening always brings the fog in)
function cycleEvents(seed, day) {
  const rng = mulberry32((Math.imul(seed | 0, 2654435761) ^ Math.imul(day + 17, 40503)) >>> 0);
  const prevailing = hash2(seed, 7, 311) * Math.PI * 2;
  const dir = prevailing + (rng() - 0.5) * 1.2;
  const pick = (w) => {
    let r = rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) if ((r -= w[i]) < 0) return KINDS[i];
    return KINDS[0];
  };
  const make = (kind, u0, len) => {
    const ramp = Math.min(len * 0.3, 0.035 + rng() * 0.02);
    return { kind, u0, u1: u0 + len, ramp, level: 0.75 + rng() * 0.25, side: (rng() - 0.5) * 300, dir };
  };
  const ev = [];
  if (day <= 1) {
    ev.push(make('fog', 0.37 + rng() * 0.05, 0.2 + rng() * 0.1));
    if (rng() < 0.6) ev.push(make(rng() < 0.55 ? 'storm' : 'rain', 0.6 + rng() * 0.12, 0.2 + rng() * 0.12));
    return { ev, wind: BASE_WIND, dir };
  }
  // primary: weighted toward the dark (fog, gale, rain, storm)
  const kind = pick([0.26, 0.16, 0.26, 0.32]);
  const at = {
    fog: () => (rng() < 0.7 ? 0.36 + rng() * 0.12 : 0.82 + rng() * 0.1),
    gale: () => 0.1 + rng() * 0.75,
    rain: () => 0.1 + rng() * 0.75,
    storm: () => 0.44 + rng() * 0.36,
  };
  const lens = { fog: [0.18, 0.3], gale: [0.12, 0.24], rain: [0.15, 0.3], storm: [0.2, 0.34] };
  const add = (k) => ev.push(make(k, at[k](), lens[k][0] + rng() * (lens[k][1] - lens[k][0])));
  add(kind);
  if (rng() < 0.4) add(pick(KINDS.map((k) => (k === kind ? 0 : 1))));
  return { ev, wind: 0.24 + rng() * 0.16, dir };
}

function envelope(e, u) {
  if (u <= e.u0 || u >= e.u1) return 0;
  return smooth(e.u0, e.u0 + e.ramp, u) * (1 - smooth(e.u1 - e.ramp, e.u1, u)) * e.level;
}

export class Weather {
  constructor() {
    this.seed = 0;
    this.roofs = [];
    this.cache = new Map();
    // smoothed live state (what the renderer + audio read)
    this.state = {
      kind: 'clear',
      fog: 1,
      wind: BASE_WIND, // with gusts
      windBase: BASE_WIND,
      windX: 1,
      windZ: 0,
      rain: 0,
      bolts: 0,
      cloud: 0,
      flash: 0, // current lightning brightness (0 .. ~1.5)
      flashX: 0,
      flashY: 1,
      flashZ: 0, // direction from the camera toward the last strike
      cover: false, // camera under a roof
    };
    this.target = { fog: 1, wind: BASE_WIND, rain: 0, bolts: 0, cloud: 0, dir: 0 };
    this.dir = 0;
    this.slotKey = '';
    this.lastSlot = -1;
    this.pending = []; // strikes waiting for their moment
    this.flashes = []; // [t0, strength, pulses]
    this.force = null; // debug: { kind, level } or param overrides { rain, wind, fog, bolts, cloud }
    this.onStrike = null; // (strike) => void, called when a strike's light arrives
    this.time = 0;
  }

  setWorld(world) {
    this.seed = world.seed | 0;
    this.roofs = world.roofs || [];
    this.world = world;
    this.cache.clear();
    this.lastSlot = -1;
    this.pending.length = 0;
  }

  events(day) {
    let c = this.cache.get(day);
    if (!c) {
      c = cycleEvents(this.seed, day);
      this.cache.set(day, c);
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    }
    return c;
  }

  // scheduled weather at clock u of `day` (+ the tail of the previous cycle's events)
  sample(day, u, out) {
    for (const k of PARAMS) out[k] = 0;
    out.fog = 1;
    const cur = this.events(day);
    out.wind = cur.wind;
    out.dir = cur.dir;
    out.kind = 'clear';
    out.event = null;
    out.eventU = 0;
    let best = 0.15;
    const apply = (list, uu) => {
      for (const e of list) {
        const a = envelope(e, uu);
        if (a <= 0) continue;
        const p = WEATHER[e.kind];
        out.fog = Math.max(out.fog, 1 + (p.fog - 1) * a);
        out.wind = Math.max(out.wind, p.wind * a);
        out.rain = Math.max(out.rain, p.rain * a);
        out.bolts = Math.max(out.bolts, p.bolts * a);
        out.cloud = Math.max(out.cloud, p.cloud * a);
        if (a > best) {
          best = a;
          out.kind = e.kind;
          out.event = e;
          out.eventU = uu;
        }
      }
    };
    apply(cur.ev, u);
    if (day > 1) apply(this.events(day - 1).ev, u + 1);
    return out;
  }

  static phaseLen(g) {
    if (g.phaseLen) return g.phaseLen;
    return g.phase === PHASE.NIGHT ? NIGHT_LENGTH : g.day <= 1 ? FIRST_DAY_LENGTH : DAY_LENGTH;
  }

  // clock u for a phase-elapsed time; null outside the day/night loop
  static clockU(g, elapsed) {
    if (!g || (g.phase !== PHASE.DAY && g.phase !== PHASE.NIGHT)) return null;
    const len = Weather.phaseLen(g);
    const f = clamp01(elapsed / Math.max(1, len));
    return (g.phase === PHASE.NIGHT ? 0.5 : 0) + f * 0.5;
  }

  // storm centre for a lightning-bearing event: sweeps across the map downwind over the event
  static stormCentre(e, uu) {
    const t = clamp01((uu - e.u0) / (e.u1 - e.u0));
    const along = -430 + 860 * t;
    const dx = Math.sin(e.dir);
    const dz = Math.cos(e.dir);
    return [dx * along - dz * e.side, dz * along + dx * e.side];
  }

  _forced(out) {
    const f = this.force;
    if (f.kind && WEATHER[f.kind]) {
      const p = WEATHER[f.kind];
      const a = f.level ?? 1;
      out.fog = 1 + (p.fog - 1) * a;
      out.wind = Math.max(BASE_WIND, p.wind * a);
      out.rain = p.rain * a;
      out.bolts = p.bolts * a;
      out.cloud = p.cloud * a;
      out.kind = f.kind;
    }
    for (const k of PARAMS) if (typeof f[k] === 'number') out[k] = f[k];
    if (typeof f.dir === 'number') out.dir = f.dir;
  }

  // g: replicated global state (null in the menu). cam: listener/camera position. Returns this.state.
  update(dt, g, time, cam) {
    this.time = time;
    const tg = this.target;
    const elapsed = g ? Weather.phaseLen(g) - g.timeLeft : 0;
    const u = Weather.clockU(g, elapsed);
    tg.event = null;
    if (u !== null) this.sample(g.day, u, tg);
    else {
      for (const k of PARAMS) tg[k] = 0;
      tg.fog = 1;
      tg.wind = g ? BASE_WIND : 0.42; // the menu gets a restless breeze
      tg.dir = this.events(1).dir;
      tg.kind = 'clear';
    }
    if (this.force) this._forced(tg);

    // ease toward the schedule (debug changes and phase jumps don't pop)
    const s = this.state;
    const k = Math.min(1, dt * 0.35);
    s.fog += (tg.fog - s.fog) * k;
    s.windBase += (tg.wind - s.windBase) * k;
    s.rain += (tg.rain - s.rain) * Math.min(1, dt * 0.5);
    s.bolts = tg.bolts;
    s.cloud += (tg.cloud - s.cloud) * k;
    s.kind = tg.kind;
    let dd = tg.dir - this.dir;
    dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    this.dir += dd * Math.min(1, dt * 0.2);
    s.windX = Math.sin(this.dir);
    s.windZ = Math.cos(this.dir);
    // gusts: slow swells, sharper and deeper in strong wind
    const wb = s.windBase;
    const sw = Math.sin(time * 0.21) * 0.5 + Math.sin(time * 0.53 + 1.3) * 0.3 + Math.sin(time * 1.31 + 0.4) * 0.2;
    s.wind = Math.max(0, wb * (1 + sw * (0.18 + 0.2 * clamp01((wb - 0.4) / 0.6))));

    // lightning: deterministic slots over the phase clock
    if (u !== null && !this.force?.noBolts) this._strikes(g, elapsed, cam);
    else this.lastSlot = -1;
    this._flash(dt, cam);
    s.cover = this.coverAt(cam.x, cam.y, cam.z);
    return s;
  }

  _strikes(g, elapsed, cam) {
    const key = g.day * 4 + g.phase;
    const slot = Math.floor(elapsed / STRIKE_SLOT);
    if (key !== this.slotKey || slot - this.lastSlot > 4) {
      // joined late, phase changed or the clock skipped ahead: don't replay old strikes
      this.slotKey = key;
      this.lastSlot = slot;
      return;
    }
    // (a server clock correction backwards waits here until the clock passes the slots already played)
    const len = Weather.phaseLen(g);
    for (let k = this.lastSlot + 1; k <= slot; k++) {
      const te = k * STRIKE_SLOT;
      const uu = (g.phase === PHASE.NIGHT ? 0.5 : 0) + clamp01(te / len) * 0.5;
      const w = this.force ? this.target : this.sample(g.day, uu, this._tmp || (this._tmp = {}));
      if (!(w.bolts > 0)) continue;
      const h = hash2(k, key, this.seed ^ 0x5bd1e995);
      if (h >= w.bolts * STRIKE_RATE * STRIKE_SLOT) continue;
      const r = (i) => hash2(k, key * 13 + i, this.seed);
      // around the storm centre as it crosses the map; rain and gales only flicker far away
      let cx = 0;
      let cz = 0;
      let far = true;
      if (this.force) {
        [cx, cz, far] = [cam.x, cam.z, w.bolts < 0.9];
      } else if (w.event && WEATHER[w.event.kind].bolts >= 1) {
        [cx, cz] = Weather.stormCentre(w.event, w.eventU);
        far = false;
      }
      const ang = r(1) * Math.PI * 2;
      const rad = far ? 380 + r(2) * 260 : 40 + Math.sqrt(r(2)) * 240;
      const x = Math.max(-MAP_HALF - 400, Math.min(MAP_HALF + 400, cx + Math.sin(ang) * rad));
      const z = Math.max(-MAP_HALF - 400, Math.min(MAP_HALF + 400, cz + Math.cos(ang) * rad));
      this.pending.push({ at: this.time + Math.max(0, te + r(3) * STRIKE_SLOT - elapsed), x, z, bolt: r(4) < 0.62, pulses: 2 + Math.floor(r(5) * 3), seed: Math.floor(r(6) * 1e6) });
    }
    this.lastSlot = slot;
  }

  // debug: a strike `dist` meters from the camera, now (at bearing `ang`, random if omitted)
  strikeNear(cam, dist = 150, bolt = true, ang = Math.random() * Math.PI * 2) {
    const a = ang;
    this.pending.push({ at: this.time, x: cam.x + Math.sin(a) * dist, z: cam.z + Math.cos(a) * dist, bolt, pulses: 3, seed: Math.floor(Math.random() * 1e6) });
  }

  _flash(dt, cam) {
    const s = this.state;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.at > this.time) continue;
      this.pending.splice(i, 1);
      if (this.time - p.at > 1) continue; // stale (tab was hidden)
      const dx = p.x - cam.x;
      const dz = p.z - cam.z;
      const dist = Math.hypot(dx, dz);
      p.dist = dist;
      p.delay = dist / SOUND;
      p.strength = 0.35 + 1.15 * Math.pow(clamp01(1 - dist / 900), 1.6);
      // a few return strokes, brightest first or second
      const rng = mulberry32(p.seed);
      const pulses = [];
      let t = 0;
      for (let j = 0; j < p.pulses; j++) {
        pulses.push([t, j === 0 ? 1 : 0.35 + rng() * 0.65]);
        t += 0.05 + rng() * 0.12;
      }
      p.pulseList = pulses;
      this.flashes.push([this.time, p.strength, pulses]);
      const inv = 1 / Math.max(1, Math.hypot(dx, 160, dz));
      s.flashX = dx * inv;
      s.flashY = 160 * inv;
      s.flashZ = dz * inv;
      this.onStrike?.(p);
    }
    let f = 0;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const [t0, str, pulses] = this.flashes[i];
      const age = this.time - t0;
      if (age > 1.5) {
        this.flashes.splice(i, 1);
        continue;
      }
      f = Math.max(f, str * pulseEnvelope(pulses, age));
    }
    s.flash = f;
  }

  // is (x,y,z) under a building roof or shelter?
  coverAt(x, y, z) {
    for (const r of this.roofs) {
      const dx = x - r.x;
      const dz = z - r.z;
      if (dx * dx + dz * dz > (r.hx + r.hz) ** 2) continue;
      const lx = r.c * dx - r.s * dz;
      const lz = r.s * dx + r.c * dz;
      if (Math.abs(lx) < r.hx && Math.abs(lz) < r.hz && y < r.y + Math.abs(r.rise) + 0.2) return true;
    }
    return false;
  }
}

// brightness of a strike `age` seconds in: sharp return strokes with a quick decay
export function pulseEnvelope(pulses, age) {
  let v = 0;
  for (const [t, a] of pulses) {
    const d = age - t;
    if (d < 0) continue;
    v = Math.max(v, a * Math.exp(-d / 0.07));
  }
  return v;
}
