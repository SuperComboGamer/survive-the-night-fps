// Sound library: registry of named procedural sounds + a time-sliced job queue that synthesises them into AudioBuffers.
// DOM-free (works in Node with a shim ctx {sampleRate, createBuffer}) so the offline lab/analysis can use it directly.
//   lib.def(name, {n:variants, peak, prio, sr, norm, meta}, (K, i, ctx) => Float32Array | [L,R] | AudioBuffer(s) | iterator)   // library sounds
//   lib.register(name, (ctx, dsp) => AudioBuffer | AudioBuffer[], meta?)                                                   // external (weapons etc.)
//   lib.get(name) -> AudioBuffer | AudioBuffer[] (variants built so far; builds variant 0 on demand)
//   lib.pump(ms, minPrio) time-slices pending jobs;  prio 3 = init-blocking, 2 = preload, 1 = background, 0 = lazy (on demand)
import * as dsp from '../dsp.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const isBuf = (o) => o && typeof o.getChannelData === 'function';
const wcap = (d) => !!d.remote && (!d.external || !!d.extRemote); // can a synthesis worker build this def? (library sounds always; external registrations only when the worker holds the same registration)
const isIter = (r) => r && typeof r.next === 'function' && !(r instanceof Float32Array) && !Array.isArray(r) && !isBuf(r);
/** minimal AudioContext stand-in (Node lab, synthesis workers): createBuffer returns plain Float32Array-backed buffers */
export function makeShimCtx(sr = 48000) { return { sampleRate: sr, createBuffer(ch, n, rate) { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { numberOfChannels: ch, length: n, sampleRate: rate, duration: n / rate, getChannelData: (c) => d[c], copyToChannel: (a, c) => d[c].set(a) }; } }; }

/** Default playback behaviour per name prefix (longest prefix wins). bus, prio (0..10 for voice stealing), refDist/maxDist (m), cd (s cooldown), send (reverb send mul), vol, sos (speed-of-sound delay 0/1), max (concurrent voices of this name). */
export const PREFIX_META = {
  '': { bus: 'sfx', prio: 3, refDist: 3, maxDist: 100, send: 1 },
  'gun.': { bus: 'weapon', prio: 8, refDist: 6, maxDist: 500, send: 1.15, sos: 1 },
  'step.': { bus: 'sfx', prio: 3, refDist: 2, maxDist: 45, send: 0.8, cd: 0.03, max: 6 },
  'impact.': { bus: 'sfx', prio: 5, refDist: 3, maxDist: 110, send: 1, cd: 0.012, max: 8, sos: 1 },
  'ricochet': { bus: 'sfx', prio: 5, refDist: 4, maxDist: 120, send: 1.1, cd: 0.05, max: 4, sos: 1 },
  'bullet.': { bus: 'sfx', prio: 6, refDist: 3, maxDist: 60, send: 0.6, cd: 0.03, max: 4, doppler: 1 },
  'flesh.': { bus: 'sfx', prio: 6, refDist: 3, maxDist: 70, send: 0.9, cd: 0.02, max: 6 },
  'glass.': { bus: 'sfx', prio: 5, refDist: 4, maxDist: 100, send: 1.1, max: 3, sos: 1 },
  'explosion': { bus: 'weapon', prio: 9, refDist: 12, maxDist: 900, send: 1.4, max: 3, sos: 1, vol: 1.6 }, // (+4 dB cancels the weapon-bus trim: a grenade stays the loudest thing in the game)
  'casing.': { bus: 'sfx', prio: 1, refDist: 1.5, maxDist: 25, send: 0.6, cd: 0.02, max: 6 },
  'board.': { bus: 'sfx', prio: 5, refDist: 3, maxDist: 60, send: 1, max: 4 },
  'zombie.': { bus: 'voice', prio: 4, refDist: 3, maxDist: 60, send: 1, max: 6 },
  'melee.': { bus: 'sfx', prio: 6, refDist: 2, maxDist: 40, send: 0.9, max: 4 },
  'player.': { bus: 'sfx', prio: 9, refDist: 1, maxDist: 20, send: 0.7, max: 3, cd: 0.2 },
  'ui.': { bus: 'ui', prio: 10, refDist: 1, maxDist: 100, send: 0, max: 3 },
  'perk.': { bus: 'ui', prio: 10, refDist: 1, maxDist: 100, send: 0.1, max: 2 },
  'powerup.': { bus: 'ui', prio: 10, refDist: 1, maxDist: 100, send: 0.1, max: 2 },
  'vehicle.': { bus: 'sfx', prio: 6, refDist: 5, maxDist: 200, send: 1, max: 4 },
  'amb.': { bus: 'amb', prio: 2, refDist: 8, maxDist: 250, send: 1.2, max: 8, sos: 1 },
  'voice.': { bus: 'voice', prio: 5, refDist: 3, maxDist: 70, send: 1, max: 8 },
  'music.': { bus: 'music', prio: 4, refDist: 6, maxDist: 100, send: 0.4 },
};
const PREFIX_KEYS = Object.keys(PREFIX_META).sort((a, b) => b.length - a.length);

/** A worker result kept as raw channel arrays until it is really needed: converted to an AudioBuffer in slices of <= ~20 us by Library.drainLazy() (background, budgeted per frame) or all at once
 *  when it is played / handed to a node. Quacks like an AudioBuffer (duration, length, getChannelData...) so callers need no changes. */
export class LazyBuf {
  constructor(lib, chs, sr) { this.lazy = true; this.lib = lib; this.chs = chs; this.sampleRate = sr; this.numberOfChannels = chs.length; this.length = chs[0].length; this.duration = this.length / sr; this.buf = null; this.def = null; this._b = null; this._c = 0; this._o = 0; }
  /** copy up to `maxSamples` floats into the AudioBuffer; true when finished */
  step(maxSamples = 16384) {
    if (this.buf) return true; if (!this._b) this._b = this.lib.ctx.createBuffer(this.numberOfChannels, this.length, this.sampleRate);
    let left = maxSamples; while (left > 0 && this._c < this.numberOfChannels) { const src = this.chs[this._c], n = Math.min(left, this.length - this._o); this._b.copyToChannel(n === this.length ? src : src.subarray(this._o, this._o + n), this._c, this._o); this._o += n; left -= n; if (this._o >= this.length) { this._c++; this._o = 0; } }
    if (this._c >= this.numberOfChannels) { this.buf = this._b; this._b = null; this.chs = null; this.lib._materialised(this); return true; } return false;
  }
  materialize() { while (!this.step(1 << 30)); return this.buf; }
  getChannelData(c) { return this.materialize().getChannelData(c); }
  copyFromChannel(...a) { return this.materialize().copyFromChannel(...a); }
}

export class Library {
  constructor(ctx) {
    this.ctx = ctx || null; this.defs = new Map(); this.jobs = [[], [], [], []]; this.pending = 0; this.active = null; this.ready = new Set(); this._metaCache = new Map(); this.bufMeta = new WeakMap(); // AudioBuffer -> def (so a buffer played directly keeps its sound's bus / priority / limits)
    this.stats = { jobs: 0, ms: 0, maxJobMs: 0, maxSliceMs: 0, maxStoreMs: 0, maxStoreName: '', slowJobs: [], remote: 0, local: 0, workerMs: 0, maxWorkerJobMs: 0 }; this.listeners = [];
    this.workers = []; this.workersReady = false; this.workerExt = null; this.lazy = false; this._lazyQ = []; this._inflight = new Map(); this._jobId = 1; this._waiters = []; this._installing = false; this.maxInflight = 2;
  }
  setContext(ctx) { this.ctx = ctx; }
  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 48000; }

  /** metadata (bus, priority, distances, cooldown...) for a sound name: def meta over prefix defaults */
  meta(name) {
    let m = this._metaCache.get(name); if (m) return m;
    let base = PREFIX_META['']; for (const k of PREFIX_KEYS) if (k && name.startsWith(k)) { base = PREFIX_META[k]; break; }
    const d = this.defs.get(name); m = Object.assign({}, PREFIX_META[''], base, d && d.meta ? d.meta : null); if (name.startsWith('gun.') && name.endsWith('.fire') && !m.duck) m.duck = [0.3, 0.9]; /* ambience / music dip under the player's own gunfire */ this._metaCache.set(name, m); return m;
  }
  /** library sound definition. opts: n variants, peak (0..1), prio (3 init, 2 preload, 1 background, 0 lazy), sr (synthesis rate override), norm 'peak'|'rms'|'none', rms, meta, fadeOut, loop */
  def(name, opts, make) {
    if (typeof opts === 'function') { make = opts; opts = {}; }
    const d = { name, n: opts.n || 1, make, peak: opts.peak ?? 0.8, sr: opts.sr || 0, prio: opts.prio ?? 1, meta: opts.meta || null, norm: opts.norm || 'peak', rms: opts.rms ?? 0.1, fadeOut: opts.fadeOut, fadeIn: opts.fadeIn, loop: !!opts.loop, seed: opts.seed ?? dsp.hashStr(name), built: [], out: [], done: 0, external: false, single: (opts.n || 1) === 1 && !opts.array, remote: opts.remote !== undefined ? opts.remote : (this._installing ? { fn: 'lib' } : null) };
    d.built = new Array(d.n).fill(null); this.defs.set(name, d); this._metaCache.delete(name);
    for (let i = 0; i < d.n; i++) { this.jobs[i === 0 ? d.prio : Math.min(d.prio, 1)].push({ d, i, it: null }); this.pending++; } // variant 0 at `prio`, extra variants in the background
    return d;
  }
  /** external registration (weapons worker etc.): gen(ctx, dsp) -> AudioBuffer | AudioBuffer[]  (or a ready buffer). Built lazily / in the background (prio 1). */
  register(name, gen, meta) {
    const old = this.defs.get(name); if (old) this._dropJobs(old);
    const d = { name, n: 1, make: gen, peak: 0.9, sr: 0, prio: 1, meta: meta || null, norm: 'none', built: [null], out: [], done: 0, external: true, single: true, seed: dsp.hashStr(name) };
    this.defs.set(name, d); this._metaCache.delete(name); if (typeof gen === 'function' && this.workerExt && this.workerExt.has(name)) { d.extRemote = true; d.remote = { fn: 'lib' }; }
    if (isBuf(gen) || Array.isArray(gen)) { const arr = Array.isArray(gen) ? gen : [gen]; d.built = arr; d.out = arr.slice(); d.n = arr.length; d.done = arr.length; d.single = arr.length === 1; }
    else { this.jobs[1].push({ d, i: 0, it: null }); this.pending++; }
    return d;
  }
  /** alias: get(name) returns the concatenated variants of the target names (e.g. 'step.concrete' = left + right feet). */
  alias(name, targets, meta) { const d = { name, alias: Array.isArray(targets) ? targets : [targets], meta: meta || null, out: [], built: [], n: 1, done: 1, single: false, _key: -1, _arr: [], external: false }; this.defs.set(name, d); this._metaCache.delete(name); return d; }
  _aliasGet(d, block = !this.workersReady) {
    let key = 0; for (const t of d.alias) { const e = this.defs.get(t); if (e) key += e.alias ? 1000 : e.out.length; }
    if (key === 0) { for (const t of d.alias) { const b = this.get(t, block); if (b) break; } key = 1; for (const t of d.alias) { const e = this.defs.get(t); if (e && !e.alias) key += e.out.length; } }
    if (key !== d._key) { const arr = []; for (const t of d.alias) { const b = this.get(t, block); if (!b) continue; if (Array.isArray(b)) for (const x of b) arr.push(x); else arr.push(b); } d._arr = arr; d.out = arr; d._key = key; }
    return d._arr.length ? d._arr : null;
  }
  /** move a def's pending jobs to a higher priority queue (e.g. lazy -> background) */
  promote(name, prio = 1) { const d = this.defs.get(name); if (!d) return; if (d.alias) { for (const t of d.alias) this.promote(t, prio); return; } for (let p = 0; p < prio; p++) { const q = this.jobs[p]; for (let i = q.length - 1; i >= 0; i--) if (q[i].d === d) { const j = q.splice(i, 1)[0]; this.jobs[prio].push(j); } } }
  /** promote every def whose name starts with `prefix` (e.g. when a vehicle / stop is loaded) */
  promotePrefix(prefix, prio = 1) { for (const k of this.defs.keys()) if (k.startsWith(prefix)) this.promote(k, prio); }
  /** build a specific variant (used by derived sounds) and return its AudioBuffer */
  buildVariant(name, i) { const d = this.defs.get(name); if (!d) return null; if (d.alias) return this.buildVariant(d.alias[0], i); if (!d.built[i]) { const j = this._findJob(d, i); if (j) this._finish(j, true); } return d.built[i] || null; }
  _dropJobs(d) { for (const q of this.jobs) for (let i = q.length - 1; i >= 0; i--) if (q[i].d === d) { q.splice(i, 1); this.pending--; } }
  has(name) { return this.defs.has(name); }
  /** forget a sound (frees its buffers): used for one-off generated material such as music phrases */
  drop(name) { const d = this.defs.get(name); if (!d) return; this._dropJobs(d); this.defs.delete(name); this.ready.delete(name); this._metaCache.delete(name); }
  names(prefix = '') { const o = []; for (const k of this.defs.keys()) if (k.startsWith(prefix)) o.push(k); return o; }

  /** AudioBuffer | AudioBuffer[] (built variants); forces variant 0 synchronously if nothing is built yet. null if unknown. */
  get(name, block = !this.workersReady) {
    const d = this.defs.get(name); if (!d) return null; if (d.alias) return this._aliasGet(d, block);
    if (d.out.length === 0) {
      const j = this._findJob(d);
      if (j && !block && wcap(d) && !j.failed) { this._urgent(j); if (d.n > 1) this.promote(name, 1); return null; } // workers active: never synthesise on the main thread; the caller retries / defers
      if (j) { this._finish(j, true); if (d.n > 1) this.promote(name, 1); }
    }
    if (d.out.length === 0) return null;
    return d.single && d.out.length === 1 ? d.out[0] : d.out;
  }
  /** is this sound (variant 0) built? never triggers synthesis */
  isReady(name) { const d = this.defs.get(name); if (!d) return false; if (d.alias) return d.alias.some((t) => this.isReady(t)); return d.out.length > 0; }
  /** send a job to a worker right now (bypasses the queue order): used for sounds requested before they were built */
  _urgent(job) { if (job.remote || !this.workersReady) return; this._dispatchJob(job, true); }
  _findJob(d, idx = -1) { for (let p = 3; p >= 0; p--) { const q = this.jobs[p]; for (let i = 0; i < q.length; i++) if (q[i].d === d && (idx < 0 || q[i].i === idx)) return q[i]; } return null; }
  _remove(job) { const q = this.jobs[job.d.prio]; const k = q.indexOf(job); if (k >= 0) { q.splice(k, 1); this.pending--; } else { for (const qq of this.jobs) { const j = qq.indexOf(job); if (j >= 0) { qq.splice(j, 1); this.pending--; break; } } } }

  /** run (or resume) a job to completion synchronously (used by get()/drain) */
  _finish(job, sync = false) {
    const t0 = now(); let res;
    if (!job.it) { res = this._start(job); if (isIter(res)) { job.it = res; res = undefined; } }
    if (job.it) { let r = job.it.next(); while (!r.done) r = job.it.next(); res = r.value; job.it = null; }
    this._complete(job, res, now() - t0);
  }
  kitFor(d, i) { return dsp.kit(d.sr || this.ctx, (d.seed + i * 7919 + 1) >>> 0, this.ctx); }
  _start(job) { const d = job.d; if (d.external) return d.make(this.ctx, dsp); return d.make(this.kitFor(d, job.i), job.i, this.ctx); }
  /** raw synthesis result -> finished channel arrays (level normalisation, DC removal, fades). Shared by the main thread and the synthesis workers. */
  finalize(d, res) {
    const sr = d.sr || this.sampleRate, ch = Array.isArray(res) ? res : [res], opts = { peak: d.peak, sr, fadeOut: d.fadeOut ?? (d.loop ? 0 : 0.004), fadeIn: d.loop ? 0 : (d.fadeIn ?? 0.0004), dc: !d.loop };
    if (d.norm === 'rms') { let s = 0; for (const a of ch) s += dsp.rmsOf(a) ** 2; const r = Math.sqrt(s / ch.length) || 1e-9, g = d.rms / r; for (const a of ch) dsp.scaleBy(a, g); let mx = 0; for (const a of ch) mx = Math.max(mx, dsp.peakOf(a)); if (mx > 0.93) for (const a of ch) dsp.scaleBy(a, 0.93 / mx); opts.normalize = false; } // (0.93: headroom for the DC removal / fades applied afterwards)
    else if (d.norm === 'none') opts.normalize = false;
    if (d.loop) for (const a of ch) { let m = 0; for (let k = 0; k < a.length; k++) m += a[k]; m /= a.length; if (Math.abs(m) > 1e-6) for (let k = 0; k < a.length; k++) a[k] -= m; } // remove DC without touching the seam
    return { chs: dsp.finishData(ch, opts), sr };
  }
  /** synchronous, complete production of one variant as plain arrays (used inside workers) */
  produce(d, i, make) {
    if (d.external) { let r = d.make(this.ctx, dsp); if (isIter(r)) { let q = r.next(); while (!q.done) q = r.next(); r = q.value; } const arr = Array.isArray(r) ? r : [r]; return { ext: arr.map((b) => ({ chs: Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)), sr: b.sampleRate })) }; } // external registration (weapons...) run inside a worker
    let res = (make || d.make)(this.kitFor(d, i), i, this.ctx); if (isIter(res)) { let r = res.next(); while (!r.done) r = res.next(); res = r.value; } return this.finalize(d, res); }
  _complete(job, res, ms) {
    const d = job.d; this._remove(job); if (res == null) { d.done++; return; }
    let bufs; if (isBuf(res)) bufs = [res]; else if (Array.isArray(res) && res.length && isBuf(res[0])) bufs = res; else { const f = this.finalize(d, res); bufs = [dsp.toBuffer(this.ctx, f.chs, f.sr)]; }
    this._store(job, bufs, ms, false);
  }
  _store(job, bufs, ms, remote) {
    const d = job.d; if (d.external) { d.built = bufs; d.out = bufs.slice(); d.n = bufs.length; d.done = bufs.length; d.single = bufs.length === 1; } else { d.built[job.i] = bufs[0]; d.out = d.built.filter(Boolean); d.done++; }
    for (const b of bufs) if (b && typeof b === 'object') { this.bufMeta.set(b, d); if (b.lazy) { b.def = d; if (d.prio >= 2) this._lazyQ.push(b); } } // (only the essential sounds - steps, impacts, hurt, explosion, ui basics - are converted in the background / during loading; every other result stays raw until it is really played: AudioBuffer allocation is what triggers the GC pauses, so most buffers are never allocated at all)
    this.stats.jobs++; this.stats.ms += ms; remote ? this.stats.remote++ : this.stats.local++; if (ms > this.stats.maxJobMs && !remote) this.stats.maxJobMs = ms; if (ms > 20 && !remote) this.stats.slowJobs.push({ name: d.name, i: job.i, ms: +ms.toFixed(1) });
    if (d.done >= d.n) { this.ready.add(d.name); for (const f of this.listeners) f(d.name); }
  }

  // ------------------------------------------------------------------------------------------ synthesis workers (optional)
  /** start module workers that synthesise library sounds off the main thread (falls back to main-thread slicing if unsupported). Returns a promise resolving when >= 1 worker is ready (or failed). */
  startWorkers(url, count = 2) {
    if (this.workers.length || typeof Worker === 'undefined' || !this.ctx) return Promise.resolve(false);
    return new Promise((resolve) => {
      let pendingReady = 0; const done = () => resolve(this.workersReady); const to = setTimeout(done, 8000); // generous: a busy main thread (map building) delays the worker's 'ready' message, and the fallback (main-thread synthesis) is far slower
      try { for (let k = 0; k < count; k++) { const w = new Worker(url, { type: 'module' }), rec = { w, inflight: 0, ready: false, dead: false }; pendingReady++; w.onmessage = (e) => { const m = e.data; if (m.t === 'ready') { rec.ready = true; this.workersReady = true; if (m.ext) this._adoptExternal(m.ext); clearTimeout(to); resolve(true); } this._onWorker(rec, m); }; w.onerror = (e) => { this._workerFailed(rec, e); if (!this.workers.some((x) => !x.dead)) { this.workersReady = false; clearTimeout(to); done(); } }; w.postMessage({ t: 'init', sr: this.sampleRate }); this.workers.push(rec); } } catch (e) { clearTimeout(to); this.workers = []; resolve(false); }
    });
  }
  stopWorkers() { for (const r of this.workers) { try { r.w.terminate(); } catch (e) { /* */ } } this.workers = []; this.workersReady = false; for (const [, job] of this._inflight) { job.remote = false; job.failed = true; } this._inflight.clear(); }
  _workerFailed(rec, e) { rec.dead = true; for (const [id, job] of this._inflight) if (job.rec === rec) { this._inflight.delete(id); job.remote = false; job.failed = true; } console.warn('[audio] synthesis worker failed, falling back to main thread:', e && (e.message || e)); }
  _onWorker(rec, m) {
    if (m.t !== 'done') return; const job = this._inflight.get(m.id); this._inflight.delete(m.id); rec.inflight = Math.max(0, rec.inflight - 1); const ws = this._waiters; if (ws.length) { this._waiters = []; for (const r of ws) r(); }
    if (!job) return; if (m.error) { console.warn('[audio] worker job failed', job.d.name, m.error); job.remote = false; job.failed = true; return; }
    const d = job.d; job.remote = false; if (d.external ? d.out.length : d.built[job.i]) return; // already built locally (get()/drain won the race)
    if (!this.jobs.some((q) => q.includes(job))) return; const ts = now(); this._remove(job); this.stats.workerMs += m.ms || 0; { const fam = d.name.split('.').slice(0, d.name.startsWith('step.') ? 1 : 2).join('.'); (this.stats.byFam || (this.stats.byFam = {}))[fam] = ((this.stats.byFam || {})[fam] || 0) + (m.ms || 0); } if ((m.ms || 0) > this.stats.maxWorkerJobMs) this.stats.maxWorkerJobMs = m.ms; this._store(job, m.ext ? m.ext.map((e) => this._wrap(e.chs, e.sr)) : [this._wrap(m.chs, m.sr)], now() - job.t0, true); const dt = now() - ts; if (dt > this.stats.maxStoreMs) { this.stats.maxStoreMs = dt; this.stats.maxStoreName = d.name; }
  }
  _wrap(chs, sr) { return this.lazy && this.ctx && typeof this.ctx.createBuffer === 'function' ? new LazyBuf(this, chs, sr) : dsp.toBuffer(this.ctx, chs, sr); }
  _materialised(lb) { const d = lb.def; if (!d) return; for (const arr of [d.built, d.out]) { const i = arr.indexOf(lb); if (i >= 0) arr[i] = lb.buf; } this.bufMeta.set(lb.buf, d); }
  /** background conversion of queued worker results into AudioBuffers, at most `ms` milliseconds (each step copies <= 96 KB) */
  drainLazy(ms) { const q = this._lazyQ; if (!q.length) return 0; const t0 = now(); let n = 0; while (q.length && now() - t0 < ms) { const lb = q[0]; if (lb.buf || lb.step()) { q.shift(); n++; } } return q.length; }
  /** names of external registrations (weapons...) that the workers hold too: they are then synthesised off the main thread like library sounds */
  _adoptExternal(names) { this.workerExt = new Set(names); for (const [n, d] of this.defs) if (d.external && !d.extRemote && d.done === 0 && d.make && typeof d.make === 'function' && this.workerExt.has(n)) { d.extRemote = true; d.remote = { fn: 'lib' }; } }
  _dispatch(minPrio) {
    let free = 0; for (const r of this.workers) if (r.ready && !r.dead) free += this.maxInflight - r.inflight; if (free <= 0) return;
    for (let p = 3; p >= minPrio && free > 0; p--) for (const job of this.jobs[p]) {
      if (free <= 0) break; const d = job.d; if (job.remote || job.failed || !wcap(d) || job === this.active) continue;
      if (!this._dispatchJob(job)) return; free--;
    }
  }
  _dispatchJob(job, force = false) {
    const d = job.d; let rec = null; for (const r of this.workers) if (r.ready && !r.dead && (force || r.inflight < this.maxInflight) && (!rec || r.inflight < rec.inflight)) rec = r; if (!rec) return false;
    const id = this._jobId++; job.remote = true; job.rec = rec; job.t0 = now(); rec.inflight++; this._inflight.set(id, job);
    rec.w.postMessage({ t: 'job', id, name: d.name, i: job.i, remote: d.remote, opts: { sr: d.sr, peak: d.peak, norm: d.norm, rms: d.rms, loop: d.loop, fadeIn: d.fadeIn, fadeOut: d.fadeOut, seed: d.seed } }); return true;
  }
  /** promise that resolves on the next worker result (or after ms) — lets loading loops sleep instead of spinning */
  waitTick(ms = 8) { return new Promise((r) => { this._waiters.push(r); setTimeout(r, ms); }); }
  /** next queued job the MAIN thread should run (skips jobs owned by workers) */
  _nextLocal(minPrio) { const useW = this.workersReady; for (let p = 3; p >= minPrio; p--) for (const job of this.jobs[p]) { if (job.remote) continue; if (useW && wcap(job.d) && !job.failed) continue; return job; } return null; }
  /** time-sliced work: dispatch remote jobs, and run local jobs of priority >= minPrio for about `ms` milliseconds. Returns true if work remains. */
  pump(ms = 4, minPrio = 1) {
    const t0 = now(); if (this.workersReady) this._dispatch(minPrio);
    for (;;) {
      let job = this.active; if (!job) { job = this._nextLocal(minPrio); if (!job) break; }
      const s = now();
      if (!job.it) { const r = this._start(job); if (isIter(r)) job.it = r; else { this._complete(job, r, now() - s); this.active = null; if (now() - t0 >= ms) break; continue; } }
      const r = job.it.next(); const dt = now() - s; if (dt > this.stats.maxSliceMs) this.stats.maxSliceMs = dt; if (r.done) { job.it = null; this._complete(job, r.value, dt); this.active = null; } else this.active = job;
      if (now() - t0 >= ms) break;
    }
    return this.remaining(minPrio) > 0;
  }
  remaining(minPrio = 1) { let n = 0; for (let p = 3; p >= minPrio; p--) n += this.jobs[p].length; return n; }
  /** synchronously build everything with priority >= minPrio (tools/tests). */
  drain(minPrio = 0) { for (let p = 3; p >= minPrio; p--) { const q = this.jobs[p]; while (q.length) this._finish(q[0], true); } this.active = null; }
  /** build all variants of one name now */
  build(name) { const d = this.defs.get(name); if (!d) return null; if (d.alias) { for (const t of d.alias) this.build(t); d._key = -1; return this.get(name); } let j; while ((j = this._findJob(d))) this._finish(j, true); return this.get(name); }
  /** all built variants (array, possibly empty) */
  variants(name) { const d = this.defs.get(name); if (!d) return []; if (d.alias) { this._aliasGet(d); } return d.out; }
}
