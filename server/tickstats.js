// Tick timing: how long ticks take, where a slow one spent its time and how late the loop's timer fired.
// Game.update stamps the clock after each of its sections (begin / mark / end); server/index.js reports how late
// each wake of the tick loop was (late) and closes a window every 10 s for the [stats] line and /status (roll).
// No game state in here, so scripts/sim-smoke.js can feed record() a made-up series of tick times.
// Costs one performance.now() per section; the buffers are fixed and a tick allocates nothing.

// a tick's sections, in the order Game.update runs them:
// inputs    commands, movement, gunfire and melee (processInputs)
// phase     the day / night clock, waves, a new game and its world generation (updatePhase)
// players   healing, holds, bleeding out (updatePlayers)
// zombies   the AI and its flow fields (Zombies.update)
// cats      (Cats.update)
// combat    projectiles, fire and gas areas
// upkeep    structures, items on the ground, supply crates, the lag compensation history
// snapshots encoding and sending every client's packet (sendSnapshots)
export const TICK_SECTIONS = ['inputs', 'phase', 'players', 'zombies', 'cats', 'combat', 'upkeep', 'snapshots'];
export const T_INPUTS = 0;
export const T_PHASE = 1;
export const T_PLAYERS = 2;
export const T_ZOMBIES = 3;
export const T_CATS = 4;
export const T_COMBAT = 5;
export const T_UPKEEP = 6;
export const T_SNAPSHOTS = 7;

// tick times kept per window for the percentile: 51 s at 20 Hz, five times the window the server reports
export const TICK_SAMPLES = 1024;
// at most one slow-tick line per this many ms: a bad minute is 12 lines, the rest are only counted
export const SLOW_LOG_EVERY = 5000;

const round = (v) => Math.round(v * 100) / 100;

export class TickStats {
  // budgetMs: what a tick may take (the tick interval); a tick over it is "slow"
  constructor(budgetMs) {
    this.budgetMs = budgetMs;
    this.sec = new Float64Array(TICK_SECTIONS.length); // ms per section of the tick being timed
    this.t0 = 0;
    this.prev = 0;
    this.ms = 0; // the last tick
    // the open window
    this.ring = new Float64Array(TICK_SAMPLES);
    this.sorted = new Float64Array(TICK_SAMPLES);
    this.n = 0;
    this.sum = 0;
    this.max = 0;
    this.over = 0;
    this.lateN = 0;
    this.lateSum = 0;
    this.lateMax = 0;
    this.lastLate = 0;
    // the last window that was closed (roll), everything since boot, and the last slow tick
    this.window = { ticks: 0, meanMs: 0, p99Ms: 0, maxMs: 0, over: 0, lateMeanMs: 0, lateMaxMs: 0 };
    this.total = { ticks: 0, over: 0, maxMs: 0, lateMaxMs: 0 };
    this.slowMs = 0;
    this.slowAt = 0;
    this.slowSec = new Float64Array(TICK_SECTIONS.length);
    this.logAt = -Infinity;
    this.unlogged = 0; // slow ticks since the last line that were not logged themselves
  }

  begin() {
    this.sec.fill(0);
    this.t0 = this.prev = performance.now();
  }
  // everything since the previous stamp was section i
  mark(i) {
    const t = performance.now();
    this.sec[i] += t - this.prev;
    this.prev = t;
  }
  // the tick ends at its last stamp. Returns true when it was slow and is due a log line (slowText)
  end() {
    return this.record(this.prev - this.t0, this.prev);
  }

  // one tick of `ms`, finished at `now` (ms, any monotonic clock)
  record(ms, now) {
    this.ms = ms;
    this.ring[this.n++ % TICK_SAMPLES] = ms;
    this.sum += ms;
    if (ms > this.max) this.max = ms;
    const t = this.total;
    t.ticks++;
    if (ms > t.maxMs) t.maxMs = ms;
    if (ms <= this.budgetMs) return false;
    this.over++;
    t.over++;
    this.slowMs = ms;
    this.slowAt = now;
    this.slowSec.set(this.sec);
    if (now - this.logAt < SLOW_LOG_EVERY) {
      this.unlogged++;
      return false;
    }
    this.logAt = now;
    return true;
  }

  // The loop woke `ms` after its timer was due: the event loop was busy with something that is not a tick, or
  // the host gave the process no CPU. A slow tick does not count here (the timer after it is armed late).
  late(ms) {
    this.lateN++;
    this.lateSum += ms;
    if (ms > this.lateMax) this.lateMax = ms;
    if (ms > this.total.lateMaxMs) this.total.lateMaxMs = ms;
    this.lastLate = ms;
  }

  // Closes the window: its figures go into this.window (returned) and a new one starts.
  // p99 is the nearest rank over the window's newest TICK_SAMPLES ticks; the rest covers every tick in it.
  roll() {
    const w = this.window;
    const n = Math.min(this.n, TICK_SAMPLES);
    w.ticks = this.n;
    w.meanMs = this.n ? this.sum / this.n : 0;
    w.maxMs = this.max;
    w.over = this.over;
    w.p99Ms = 0;
    if (n) {
      this.sorted.set(this.ring);
      this.sorted.fill(Infinity, n); // (what is left of an earlier window)
      this.sorted.sort();
      w.p99Ms = this.sorted[Math.ceil(n * 0.99) - 1];
    }
    w.lateMeanMs = this.lateN ? this.lateSum / this.lateN : 0;
    w.lateMaxMs = this.lateMax;
    this.n = this.sum = this.max = this.over = 0;
    this.lateN = this.lateSum = this.lateMax = 0;
    return w;
  }

  // The last slow tick for the log: its length, every section in ms, what the server was carrying (the caller's
  // counts), how late the loop woke for it, and how many slow ticks before it went unlogged.
  slowText(carrying) {
    let s = `${this.slowMs.toFixed(2)}ms:`;
    for (let i = 0; i < TICK_SECTIONS.length; i++) s += ` ${TICK_SECTIONS[i]}=${this.slowSec[i].toFixed(2)}`;
    s += ` | ${carrying} late ${this.lastLate.toFixed(2)}ms`;
    if (this.unlogged) s += ` | slow ticks not logged before it: ${this.unlogged}`;
    this.unlogged = 0;
    return s;
  }

  // for /status: timings only (now: the clock record() was given)
  status(now) {
    const w = this.window;
    const t = this.total;
    let lastSlow = null;
    if (this.slowMs) {
      lastSlow = { agoS: Math.round((now - this.slowAt) / 1000), ms: round(this.slowMs), sections: {} };
      for (let i = 0; i < TICK_SECTIONS.length; i++) lastSlow.sections[TICK_SECTIONS[i]] = round(this.slowSec[i]);
    }
    return {
      budgetMs: this.budgetMs,
      window: { ticks: w.ticks, meanMs: round(w.meanMs), p99Ms: round(w.p99Ms), maxMs: round(w.maxMs), over: w.over, lateMeanMs: round(w.lateMeanMs), lateMaxMs: round(w.lateMaxMs) },
      sinceBoot: { ticks: t.ticks, over: t.over, maxMs: round(t.maxMs), lateMaxMs: round(t.lateMaxMs) },
      lastSlow,
    };
  }
}
