// AUDIO ENGINE — procedural Web Audio engine (no audio files). Public surface (kept from the skeleton):
//   await audio.init()                                    // after a user gesture  (init({ctx}) accepts an OfflineAudioContext for tests)
//   audio.register('gun.m1911.fire', ctx => buffer|[buffers])
//   audio.play(nameOrBuffer, { pos, vol, pitch, bus, loop, minDist, maxDist, space, occlusion, ... }) -> handle
//   audio.update(dt, { pos, forward, up }, { space, muffle, underwater, wind })
//   audio.setSpace(idOrDef, fadeSec)   audio.spaceFor(atmo.reverb)   audio.ambience.set(recipe | 'map.stop', fadeSec, { origin })
//   audio.attachPlayer(player)   -> footsteps / landing / hurt / low-HP heartbeat AND (via player.world) audio.setWorld(world): the engine then follows the active stop by itself
//                                   (room, ambience preset + origin, wind, underwater, transit cross-fade, ride vehicle sounds, occlusion). Disable with audio.auto = false.
//   audio.explosion(pos, radiusMetres)   audio.impact(surface, pos, {caliber, dir, normal})   audio.whiz(a, b)   audio.flesh(pos)   audio.casing(pos, surface, isShotgun)
//   audio.zombieVoice(profile) / audio.voices.{miner,frozen,drowned,mascot,guest}   audio.vehicleLoop(name, params)   audio.duck(bus, amt, secs)   audio.masterVolume
// Graph:   src -> pre(vol) -+-> send -> reverb bus (2 convolvers, cross-faded per space)
//                           +-> dist(gain) -> air-absorption LP -> HRTF panner | stereo panner -> bus -> duck -> world -> muffle LP -> master
//          master -> tinnitus LP -> glue compressor -> limiter -> soft clipper -> destination
import * as dsp from './dsp.js';
import { Library } from './sfx/library.js';
import { installAll } from './sfx/index.js';
import { SPACES, spaceFor } from './sfx/spaces.js';
import { Ambience } from './ambience.js';
import { eventType } from './sfx/events.js';
import { makeZombieVoice, VOICE_PRESETS } from './sfx/voices.js';
import { VehicleRigs, vehicleKind } from './sfx/rigs.js';

export { SPACES, spaceFor, Library };

const BUS_NAMES = ['sfx', 'weapon', 'ui', 'voice', 'amb', 'music'];
const BUS_GAIN = { sfx: 1, weapon: 0.63, ui: 0.9, voice: 0.8, amb: 0.85, music: 0.7 }; // weapon bus -4 dB (explosions are compensated in their meta): full-auto bursts sit near -16 LUFS short-term
const MAT_OCC = { glass: 0.12, plastic: 0.3, fabric: 0.3, carpet: 0.3, grass: 0.3, foliage: 0.3, wood: 0.42, dirt: 0.5, snow: 0.5, ice: 0.45, crystal: 0.5, water: 0.5, tile: 0.6, brick: 0.68, metal: 0.7, concrete: 0.72, rock: 0.78, lava: 0.7, default: 0.7 }; // opacity of one layer of each material (0 = sound passes, 0.85 cap)
const VEH_ROOMS = { ferry: [{ space: 'open', ceilMin: 6, meanMin: 14 }] }; // vehicle interiors: the ferry's open deck vs its cabin (probe grid measured in the real game: deck cells 21-40 m free path, no roof; cabin cells 6-11 m)
const AUTH_GAIN = 0.6; // authored positional emitters merged onto a preset keep their gain x this (loudness hierarchy)
const C_SOUND = 343, TWO_PI = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let _mc = null, _mcRes = null; // MessageChannel yield (no 4 ms setTimeout clamp); created lazily and unref'd so Node scripts can exit
const yieldNow = () => new Promise((r) => { if (typeof MessageChannel === 'undefined') { setTimeout(r, 0); return; } if (!_mc) { _mc = new MessageChannel(); _mc.port1.onmessage = () => { const f = _mcRes; _mcRes = null; if (f) f(); }; if (_mc.port1.unref) _mc.port1.unref(); } _mcRes = r; _mc.port2.postMessage(0); });
const px = (p) => (p.x !== undefined ? p.x : p[0]), py = (p) => (p.y !== undefined ? p.y : p[1]), pz = (p) => (p.z !== undefined ? p.z : p[2]);
const warned = new Set(); const warnOnce = (k, msg) => { if (!warned.has(k)) { warned.add(k); if (typeof console !== 'undefined') console.warn('[audio] ' + msg); } };

// crossfade curves (equal power), reused for every space change
const FADE_IN = new Float32Array(48), FADE_OUT = new Float32Array(48); for (let i = 0; i < 48; i++) { FADE_IN[i] = Math.sin(i / 47 * Math.PI / 2); FADE_OUT[i] = Math.cos(i / 47 * Math.PI / 2); }
// output soft clipper: identity up to |x|=0.6, then a smooth knee toward 0.95 (input range clamps at +-1, so the output can never exceed ~0.885)
function clipCurve() { const n = 4097, c = new Float32Array(n), T = 0.6, M = 0.95; for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1, a = Math.abs(x); c[i] = a < T ? x : Math.sign(x) * (T + (M - T) * Math.tanh((a - T) / (M - T))); } return c; }

export class AudioEngine {
  constructor(lib = null) {
    this.lib = lib || new Library(null); this.ctx = null; this.ready = false; this.enabled = true; this.offline = false; this.listener = null; this.master = null;
    this.buses = {}; this.duckNodes = {}; this._duck = {}; this.space = 'open'; this.spaceDef = SPACES.open; this._spaceKey = null; this._mv = 1; this.initMs = 0; this.time = 0;
    this.voiceCap = 48; this.slots = []; this._posPools = { hrtf: [], stereo: [] }; this._flatPool = []; this._hrtfMax = 12; this._nameCount = new Map(); this._nameLast = new Map(); this._last = new Map();
    this.L = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, rx: 1, ry: 0, rz: 0, set: false };
    this.sp = { sendAmp: 0.1, dryLP: 16000, airAbs: 1, sendFalloff: 0.75 }; this._spT = { ...this.sp }; this._spRate = 3;
    this.stats = { voices: 0, peakVoices: 0, played: 0, dropped: 0, stolen: 0, cooldown: 0, limited: 0, updateMs: 0 };
    this.speedOfSound = C_SOUND; this.sosScale = 1; this.occlusionQuery = null; this.hrtf = true; this._deferred = []; this._spaceWait = null;
    this._muffle = 0; this._muffleEff = 0; this._uw = 0; this._vehMuffle = 0; this._veh = null; this._vehName = null; this._doors = 1; this._stSpace = 'open'; this._wantedKey = null; this._rand = Math.random;
    this._roomId = null; this._roomWant = null; this._roomHold = 0; this._roomChanged = false; this._quietUntil = 0; this._frame = 0; this._rotStamp = 0; this._spStamp = 0; this._lw = { px: 1e9, py: 0, pz: 0, fx: 0, fy: 0, fz: 0, ux: 0, uy: 0, uz: 0 }; this._rs = { fx: 0, fz: 0, rx: 0, rz: 0 }; this._spL = { sendAmp: -1, dryLP: -1, airAbs: -1, sendFalloff: -1 }; this._crowdSet = 1; this._encMul = 1; this._encT = 1; this._probeT = 0; this._probeK = 0; this.probeRooms = true; this.gw = null; this.auto = true; this.preferPresets = true; this._autoStop = null; this._autoTransit = false; this._uwAuto = 0; this._stepGuard = 0; this._spaceStamp = 0;
    this.player = null; this._foot = 0; this.vehicles = new Set(); this._beat = 0; this._breath = 0; this._lowHp = 0; this._cache = new Map(); this._irCache = new Map(); this._tinT = 0; this._pumpBudget = 3;
    this.ambience = new Ambience(this); this.rigs = new VehicleRigs(this); this._voiceSets = new Map();
    const eng = this; this.voices = {}; // ready-made zombie voice banks: audio.voices.{miner,frozen,drowned,mascot,guest} (built lazily, time-sliced)
    for (const k of Object.keys(VOICE_PRESETS)) Object.defineProperty(this.voices, k, { enumerable: true, get() { return eng.zombieVoice(VOICE_PRESETS[k]); } });
  }
  /** hold back all background work (buffer conversion) for `sec` seconds: call at the start of a wave / heavy moment */
  quiet(sec = 5) { this._quietUntil = now() + sec * 1000; }
  get masterVolume() { return this._mv; }
  set masterVolume(v) { this._mv = clamp(+v || 0, 0, 2); if (this.master) this.master.gain.setTargetAtTime(this._mv, this.ctx.currentTime, 0.02); }
  seed(n) { const r = new dsp.Rng(n); this._rand = () => r.next(); }

  // ---------------------------------------------------------------------------------------------------------- init
  async init(opts = {}) {
    if (this.ready) return this; if (this._initP) return this._initP;
    return (this._initP = this._init(opts));
  }
  async _init(opts) {
    const t0 = now();
    if (!opts.ctx && typeof window === 'undefined') throw new Error('audio.init needs a browser or {ctx}');
    const ctx = this.ctx = opts.ctx || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.offline = typeof ctx.startRendering === 'function'; this._measure = !!opts.measure; this.lib.setContext(ctx); if (!this.lib.defs.size) installAll(this.lib);
    this._buildGraph(); this._registerSpaces();
    // synthesis runs in module workers when available (zero main-thread stalls); otherwise time-sliced on the main thread
    const useW = opts.workers ?? (!this.offline && !opts.sync && !opts.noWorkers && typeof Worker !== 'undefined'); this.workersUsed = false; this.lib.lazy = !!useW && !this.offline; // worker results stay raw until needed (LazyBuf) and are converted in tiny budgeted slices
    const deadline = t0 + (opts.maxBlockMs ?? 3000); // init never holds the loading screen longer than this (a busy machine): whatever is unfinished continues in the background and early plays are deferred
    if (useW) { try { const wp = this.lib.startWorkers(new URL('./sfx/worker.js', import.meta.url), opts.workerCount ?? Math.min(3, Math.max(1, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 2))); this.workersUsed = await Promise.race([wp, new Promise((r) => setTimeout(() => r(false), Math.max(0, deadline - now())))]); } catch (e) { this.workersUsed = false; } }
    const first = this._pendingSpace ? this._pendingSpace[0] : 'open', firstId = spaceFor(first); if (typeof firstId === 'string') this.lib.promote('ir.' + firstId, 3); // the first room's impulse response is built with the init batch
    if (opts.sync) this.lib.drain(2);
    else while ((this.lib.remaining(2) > 0 || this.lib._lazyQ.length) && now() < deadline) { this.lib.pump(8, 2); this.lib.drainLazy(6); await (this.lib.workersReady ? this.lib.waitTick() : yieldNow()); } // (loading screen: the essential results are converted here, everything else lazily)
    this._applySpace(first, 0);
    this.ready = true; this.initMs = now() - t0;
    if (!this.offline && ctx.state === 'suspended' && ctx.resume) { try { await ctx.resume(); } catch (e) { /* needs user gesture */ } }
    if (!opts.noBackground && !this.offline) this._bgPump();
    // autonomous mode: while the host does not call update() (menu, loading screens) a 10 Hz heartbeat keeps ambience, rooms and deferred sounds running
    if (!this.offline && typeof setInterval !== 'undefined' && !opts.noHeartbeat) { this._lastUpd = now(); this._hbLast = now(); this._hb = setInterval(() => { const t = now(); if (this.ready && t - this._lastUpd > 300) { const dt = (t - this._hbLast) / 1000; this._hbLast = t; this._inHb = true; try { this.update(dt, null, {}); } finally { this._inHb = false; } } else this._hbLast = t; }, 100); if (this._hb.unref) this._hb.unref(); }
    return this;
  }
  /** resolve when every library sound with priority >= minPrio is built (default: everything except lazy ones). Time-sliced. */
  async preload(minPrio = 1, budgetMs = 8) { while (this.lib.remaining(minPrio) > 0) { this.lib.pump(budgetMs, minPrio); await (this.lib.workersReady ? this.lib.waitTick() : yieldNow()); } return this; }
  _bgPump() { if (this._bg) return; this._bg = true; const step = () => { if (!this.lib.pump(4, 1)) { this._bg = false; return; } setTimeout(step, 12); }; setTimeout(step, 50); }

  _buildGraph() {
    const c = this.ctx, G = () => c.createGain(), B = (type, f, q) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    this.master = G(); this.master.gain.value = this._mv;
    this.tinLP = B('lowpass', 24000, -3); this.comp = c.createDynamicsCompressor(); this.limiter = c.createDynamicsCompressor(); this.clip = c.createWaveShaper();
    const cp = this.comp, lm = this.limiter; cp.threshold.value = -14; cp.knee.value = 10; cp.ratio.value = 3; cp.attack.value = 0.018; cp.release.value = 0.25; // slow attack: transients (gunshots) pass, sustained loudness is glued
    lm.threshold.value = -3; lm.knee.value = 0; lm.ratio.value = 20; lm.attack.value = 0.001; lm.release.value = 0.06; this.clip.curve = clipCurve(); this.clip.oversample = '4x';
    // DynamicsCompressorNode applies automatic makeup gain (+5 dB for these settings, measured by tools/audio-analyze.mjs 'chain'); the pre-trim cancels it so quiet material keeps its level and only loud peaks are glued/limited
    this.post = G(); this.trim = G(); this.trim.gain.value = 0.563; this.master.connect(this.tinLP); this.tinLP.connect(this.post); if (this._measure) this.post.connect(c.destination); else { this.post.connect(this.trim); this.trim.connect(cp); cp.connect(lm); lm.connect(this.clip); this.clip.connect(c.destination); }
    this.world = G(); this.wf = B('lowpass', 24000, -3); this.wfGain = G(); this.world.connect(this.wf); this.wf.connect(this.wfGain); this.wfGain.connect(this.master);
    this.crowd = G(); this._crowd = 1; // voice-bus crowd control: many close voices at once (24 zombies) are pulled down instead of stacking up (see update())
    for (const b of BUS_NAMES) { const g = G(), d = G(); g.gain.value = BUS_GAIN[b]; if (b === 'voice') { g.connect(this.crowd); this.crowd.connect(d); } else g.connect(d); d.connect(b === 'ui' ? this.master : this.world); this.buses[b] = g; this.duckNodes[b] = d; this._duck[b] = { until: 0, depth: 0 }; }
    this.revSend = G(); this.revOut = G(); this.revOut.connect(this.world);
    this._convCache = new Map(); this._active = null; this._prev = null; this._revA = 0;
    this.listener = c.listener;
  }
  _registerSpaces() {
    for (const [id, def] of Object.entries(SPACES)) { const name = 'ir.' + id; if (this.lib.has(name)) continue; const spec = { ...def, seed: def.seed || dsp.hashStr(id) }; this.lib.def(name, { prio: 0, loop: true, norm: 'none', seed: spec.seed, remote: { fn: 'ir', args: { spec } } }, (K) => dsp.irGen(K.sr, spec)); }
  }

  // ---------------------------------------------------------------------------------------------------------- registry
  register(name, gen, meta) { this.lib.register(name, gen, meta); if (this.ready && typeof gen === 'function') this._bgPump(); }
  /** AudioBuffer | AudioBuffer[] | null (null while a synthesis worker is still building it; use isReady()/load()) */
  get(name) { return this.lib.get(name); }
  has(name) { return this.lib.has(name); }
  isReady(name) { return this.lib.isReady(name); }
  /** promote sounds to init priority and resolve when they are built: await audio.load('step.snow.walk.L', 'impact.ice') */
  async load(...names) { const list = names.flat(); for (const n of list) this.lib.promote(n, 3); while (list.some((n) => !this.lib.isReady(n) && this.lib.has(n))) { this.lib.pump(6, 1); await (this.lib.workersReady ? this.lib.waitTick() : yieldNow()); } return this; }
  names(prefix = '') { return this.lib.names(prefix); }

  // ---------------------------------------------------------------------------------------------------------- spaces
  spaceFor(name) { return spaceFor(name); }
  /** impulse response for a space; null when a worker is still building it (the switch is retried every frame) */
  _irName(key, def, prio = 1) {
    const lib = this.lib; let name;
    if (typeof key === 'string' && SPACES[key] === def && lib.has('ir.' + key)) { name = 'ir.' + key; lib.promote(name, prio); }
    else { const spec = { ...def, seed: def.seed || dsp.hashStr(String(key)) }; name = 'ir.c' + (dsp.hashStr(JSON.stringify(spec)) >>> 0).toString(36); if (!lib.has(name)) lib.def(name, { prio, loop: true, norm: 'none', seed: spec.seed, remote: { fn: 'ir', args: { spec } } }, (K) => dsp.irGen(K.sr, spec)); else lib.promote(name, prio); }
    return name;
  }
  _irFor(key, def) {
    let ir = this._irCache.get(key); if (ir) return ir; ir = this.lib.get(this._irName(key, def, 1)); if (!ir) return null; if (ir.lazy) ir = ir.materialize(); this._irCache.set(key, ir); return ir;
  }
  /** convolver node for a room (one per space, kept with its IR loaded: the .buffer assignment does the FFT partitioning and costs 10-60 ms, so it is done ahead of time by prepareSpaces()) */
  _convFor(key, ir) {
    let e = this._convCache.get(key); if (e) return e; const c = this.ctx, cv = c.createConvolver(), w = c.createGain(); cv.normalize = false; cv.buffer = ir; w.gain.value = 0; cv.connect(w); w.connect(this.revOut); e = { cv, w, key, linked: false, retireAt: 0 }; this._convCache.set(key, e); return e;
  }
  _retire(e) { if (!e || !e.linked) return; try { this.revSend.disconnect(e.cv); } catch (err) { /* */ } e.linked = false; e.w.gain.cancelScheduledValues(0); e.w.gain.value = 0; if (this._prev === e) this._prev = null; }
  /** get rooms ready before they are needed (map load / ride): builds the impulse responses in the workers and loads them into their convolvers, one per frame, so switching stops never hitches. Returns a promise. */
  async prepareSpaces(ids) {
    const list = []; for (const id0 of ids || []) { const id = typeof id0 === 'object' && id0 ? id0 : spaceFor(id0), def = typeof id === 'string' ? SPACES[id] : id; if (!def || typeof def !== 'object') continue; const key = typeof id === 'string' ? id : (def.id || JSON.stringify(def)); if (this._convCache.has(key)) continue; list.push([key, def]); }
    for (const [key, def] of list) this._irName(key, def, 1); // start every impulse response build first, then load them into convolvers one at a time
    for (const [key, def] of list) { if (this._convCache.has(key)) continue; let ir = null; for (let k = 0; k < 4000 && !(ir = this._irFor(key, def)); k++) { this.lib.pump(6, 1); await (this.lib.workersReady ? this.lib.waitTick() : yieldNow()); } if (ir) this._convFor(key, ir); await yieldNow(); }
  }
  /** explicit room change (sticky: it becomes the default room until `update(..., {space})`, a vehicle or underwater overrides it). idOrDef: SPACES id, atmosphere reverb name or a {rt60, damping, predelay, wet, dryLP, early:[[t,g]...]} definition. */
  setSpace(idOrDef, fade = 0.6) {
    idOrDef = this._refineSpace(idOrDef);
    this._stSpace = idOrDef; this._spaceStamp = now();
    if (!this.ctx) { this._pendingSpace = [idOrDef, fade]; return; }
    this._fadeOverride = fade; this._wantedKey = null; // update() reconciles with vehicle / underwater state
    if (!this._veh && !(this._uw > 0.5)) { this._applySpace(idOrDef, fade); this._wantedKey = typeof idOrDef === 'string' ? spaceFor(idOrDef) : idOrDef; }
  }
  _applySpace(idOrDef, fade) {
    const id = typeof idOrDef === 'string' ? spaceFor(idOrDef) : idOrDef, isId = typeof id === 'string', def = isId ? SPACES[id] : id;
    if (!def) return; const key = isId ? id : (def.id || JSON.stringify(def)); if (key === this._spaceKey) return;
    const ir = this._irFor(key, def); if (!ir) { this._spaceWait = [idOrDef, fade]; return; } this._spaceWait = null; const ctx = this.ctx, t = ctx.currentTime, tm = now();
    const nxt = this._convFor(key, ir), cur = this._active; if (this._prev && this._prev !== nxt && this._prev !== cur) this._retire(this._prev); // (an older fading-out convolver is dropped)
    const fd = Math.max(0, fade); nxt.w.gain.cancelScheduledValues(t); if (cur && cur !== nxt) cur.w.gain.cancelScheduledValues(t);
    if (!nxt.linked) { this.revSend.connect(nxt.cv); nxt.linked = true; }
    if (fd < 0.02 || !cur) { nxt.w.gain.setValueAtTime(1, t); if (cur && cur !== nxt) { cur.w.gain.setValueAtTime(0, t); this._retire(cur); } this._prev = null; }
    else if (cur !== nxt) { nxt.w.gain.setValueAtTime(0, t); nxt.w.gain.setValueCurveAtTime(FADE_IN, t, fd); cur.w.gain.setValueAtTime(1, t); cur.w.gain.setValueCurveAtTime(FADE_OUT, t, fd); this._prev = cur; cur.retireAt = t + fd + 0.1; }
    this._active = nxt; this._spaceKey = key; this.space = isId ? id : (def.id || 'custom'); this.spaceDef = def; this._spFade = fd; this.stats.maxSpaceMs = Math.max(this.stats.maxSpaceMs || 0, now() - tm);
    const T = this._spT; T.dryLP = def.dryLP ?? 16000; T.airAbs = def.airAbs ?? 1; T.sendFalloff = def.sendFalloff ?? 0.5; T.sendAmp = Math.sqrt(Math.max(0, def.wet ?? 0.1) * 0.5) * 0.6 * 0.78; this._spRate = fd < 0.02 ? 1e3 : 3 / Math.max(0.1, fd); // (0.78: measured calibration so `wet` reads as the true 250 Hz-4 kHz reverb:direct energy ratio at 5 m)
    if (fd < 0.02) Object.assign(this.sp, T);
  }

  // ---------------------------------------------------------------------------------------------------------- voices
  _newPos(hrtf) {
    const c = this.ctx, ch = { hrtf, pre: c.createGain(), dist: c.createGain(), lp: c.createBiquadFilter(), pan: hrtf ? c.createPanner() : c.createStereoPanner(), send: c.createGain(), busName: null, flat: false, used: false };
    ch.lp.type = 'lowpass'; ch.lp.Q.value = -3; ch.lp.frequency.value = 22000;
    if (hrtf) { const p = ch.pan; p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1; p.rolloffFactor = 0; p.maxDistance = 1e6; p.coneInnerAngle = 360; p.coneOuterAngle = 360; }
    ch.pre.connect(ch.dist); ch.dist.connect(ch.lp); ch.lp.connect(ch.pan); ch.pre.connect(ch.send); ch.send.connect(this.revSend); return ch;
  }
  _newFlat() { const c = this.ctx, ch = { pre: c.createGain(), send: c.createGain(), busName: null, flat: true, used: false }; ch.pre.connect(ch.send); ch.send.connect(this.revSend); return ch; }
  _chain(positional, hrtf) {
    if (!positional) { let ch = this._flatPool.find((x) => !x.used); if (!ch) { ch = this._newFlat(); this._flatPool.push(ch); } return ch; }
    const pool = hrtf ? this._posPools.hrtf : this._posPools.stereo; let ch = pool.find((x) => !x.used); if (!ch) { if (hrtf && pool.length >= this._hrtfMax) return null; ch = this._newPos(hrtf); pool.push(ch); } return ch;
  }
  _score(prio, loud) { return prio * 100 + 20 * Math.log10(Math.max(loud, 1e-4)); }
  _acquire(score, positional, hrtf) {
    let n = 0, worst = null, ws = Infinity; for (const v of this.slots) { if (!v.active) continue; n++; if (v.score < ws) { ws = v.score; worst = v; } }
    if (n >= this.voiceCap) { if (!worst || ws >= score) return null; this._kill(worst, 0.012); this.stats.stolen++; }
    let ch = this._chain(positional, hrtf && this.hrtf); if (!ch && hrtf) ch = this._chain(positional, false); return ch;
  }
  _voiceObj() { let v = this.slots.find((x) => !x.active && !x.fading); if (!v) { v = { active: false, fading: false, gen: 0 }; this.slots.push(v); } return v; }

  /**
   * Play a registered sound name or an AudioBuffer. Options: pos {x,y,z}|[x,y,z] (world; omit = non-positional), vol, pitch, jitter, bus ('sfx'|'weapon'|'ui'|'voice'|'amb'|'music'),
   * loop, minDist (ref distance for the 1/d law), maxDist, occlusion 0..1, send (reverb send multiplier), delay/when (s), sos (speed-of-sound delay), doppler, follow ({x,y,z} tracked each frame),
   * hrtf (force/forbid HRTF), prio, offset, loopStart/loopEnd, space ('id' -> different room character for this sound), path {from,to,dur} (animated position for near-miss whizzes).
   */
  play(name, o = {}) {
    if (!this.ready || !this.enabled) return null;
    const lib = this.lib, isName = typeof name === 'string'; let b = isName ? lib.get(name) : name; if (!b) { if (isName) { if (lib.has(name) && lib.workersReady) { if (!o.loop) this._defer(name, o); } else warnOnce('missing:' + name, `unknown sound "${name}"`); } return null; }
    let meta, nm; if (isName) { meta = lib.meta(name); nm = name; } else { const bd = o.meta ? null : lib.bufMeta.get(name); meta = o.meta || (bd ? lib.meta(bd.name) : DEFAULT_META); nm = o.name || (bd ? bd.name : '(buffer)'); } // a buffer played directly keeps its sound's bus / priority / concurrency limit
    const t = this.ctx.currentTime;
    if (this._stepGuard > t && isName && !o.pos && name.startsWith('step.')) { this.stats.cooldown++; return null; } // the player's own footstep just played: drop a duplicate generic step from game code
    if (meta.cd) { const last = this._nameLast.get(nm); if (last !== undefined && t - last < meta.cd) { this.stats.cooldown++; return null; } }
    if (meta.max) { const cnt = this._nameCount.get(nm) || 0; if (cnt >= meta.max) { this.stats.limited++; return null; } }
    if (Array.isArray(b)) { let i = (this._rand() * b.length) | 0; const li = this._last.get(nm); if (b.length > 1 && i === li) i = (i + 1 + ((this._rand() * (b.length - 1)) | 0)) % b.length; this._last.set(nm, i); b = b[i]; }
    if (b.lazy) b = b.materialize(); // (LazyBuf -> AudioBuffer; the meta lookup above already used the lazy object)
    const pos = o.pos || null, positional = !!pos, bus = o.bus || meta.bus || 'sfx', prio = o.prio ?? meta.prio ?? 3, vol = (o.vol ?? 1) * (meta.vol ?? 1), refDist = o.minDist ?? meta.refDist ?? 3, maxDist = o.maxDist ?? meta.maxDist ?? 100, L = this.L;
    let x = 0, y = 0, z = 0, d = 0; if (positional) { x = px(pos); y = py(pos); z = pz(pos); const dx = x - L.px, dy = y - L.py, dz = z - L.pz; d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d > maxDist && !o.loop) return null; }
    const loud = vol * (positional ? refDist / Math.max(d, refDist) : 1), score = this._score(prio, loud) + (o.loop ? -30 : 0);
    if (loud < 0.0004 && !o.loop) return null;
    const wantH = positional && (o.hrtf ?? (d < 40 && prio >= 3 && !o.loop)), ch = this._acquire(score, positional, wantH); if (!ch) { this.stats.dropped++; return null; }
    const v = this._voiceObj(); v.active = true; v.fading = false; v.gen++; v.ch = ch; ch.used = true; v.name = nm; v.bus = bus; v.prio = prio; v.score = score; v.positional = positional; v.follow = o.follow || null; v.x = x; v.y = y; v.z = z; v.loop = !!o.loop; v.vol = vol;
    v.refDist = refDist; v.maxDist = maxDist; v.occ = o.occlusion ?? 0; v.occT = v.occ; v.occAuto = o.occlusion === undefined; v.occNext = t + this._rand() * 0.2; v.sendMul = (o.send ?? meta.send ?? 1) * (o.space ? this._spaceMul(o.space) : 1); v.doppler = o.doppler ?? !!meta.doppler; v.lastD = d; v.dop = 1; v.gd = -1; v.gs = -1; v.gp = 9; v.gf = -1; v.path = o.path || null;
    const pitch = (o.pitch ?? 1) * (1 + (this._rand() - 0.5) * (o.jitter ?? meta.jitter ?? 0.04)); v.pitch = pitch; v.airK = o.air ?? 1;
    let delay = (o.when !== undefined ? Math.max(0, o.when - t) : 0) + (o.delay || 0); const sos = o.sos ?? meta.sos; if (sos && positional && d > 8) delay += (d - 8) / this.speedOfSound * this.sosScale;
    const start = t + delay; v.startT = start; v.endT = o.loop ? Infinity : start + b.duration / Math.max(0.05, pitch) + 0.06;
    const c = this.ctx; if (ch.busName !== bus) { const dst = this.buses[bus] || this.buses.sfx; if (ch.busName) { try { (ch.flat ? ch.pre : ch.pan).disconnect(this.buses[ch.busName]); } catch (e) {} } (ch.flat ? ch.pre : ch.pan).connect(dst); ch.busName = bus; }
    ch.pre.gain.cancelScheduledValues(t); ch.pre.gain.setValueAtTime(vol, t);
    if (positional) this._spatial(v, true);
    else { ch.send.gain.value = (o.send ?? meta.send ?? 0) * this.sp.sendAmp * (o.space === true ? 1 : 0.7) * (meta.send === 0 ? 0 : 1); }
    const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = pitch; if (o.loop) { src.loop = true; if (o.loopStart !== undefined) { src.loopStart = o.loopStart; src.loopEnd = o.loopEnd ?? b.duration; } }
    src.connect(ch.pre); v.src = src; const off = o.offset === 'random' ? this._rand() * b.duration : (o.offset || 0); src.start(start, off); if (positional && ch.hrtf && v.path) this._pathAutomation(v, start);
    this._nameCount.set(nm, (this._nameCount.get(nm) || 0) + 1); this._nameLast.set(nm, t); v.counted = nm; this.stats.played++;
    let na = 0; for (let i = 0; i < this.slots.length; i++) if (this.slots[i].active) na++; this.stats.voices = na; if (na > this.stats.peakVoices) this.stats.peakVoices = na;
    if (meta.duck) this.duck(meta.duck[2] || ['amb', 'music'], meta.duck[0], meta.duck[1], 0.05 + delay + meta.duck[1] * 0.35); // stingers / jingles: the world dips under them
    return new Handle(this, v, v.gen, src, ch.pre);
  }
  /** worker mode: a sound requested before its buffer arrived is played as soon as it is built (never synthesised on the main thread) */
  _defer(name, o) { if (this._deferred.length >= 48) return; this._deferred.push({ name, o: { ...o }, t: this.time }); this.stats.deferred = (this.stats.deferred || 0) + 1; }
  _spaceMul(id) { const def = SPACES[spaceFor(id)]; return def ? Math.min(3, Math.sqrt((def.wet ?? 0.1) / Math.max(0.02, this.spaceDef.wet ?? 0.1))) : 1; }
  _kill(v, fade = 0.015) {
    if (!v.active) return; const t = this.ctx.currentTime, ch = v.ch;
    try { ch.pre.gain.cancelScheduledValues(t); ch.pre.gain.setTargetAtTime(0, t, Math.max(0.002, fade / 4)); v.src.stop(t + fade + 0.02); } catch (e) { /* already stopped */ }
    v.active = false; v.fading = true; v.relAt = t + fade + 0.05; if (v.counted) { const n = (this._nameCount.get(v.counted) || 1) - 1; if (n <= 0) this._nameCount.delete(v.counted); else this._nameCount.set(v.counted, n); v.counted = null; }
  }
  _release(v) {
    if (!v.active && !v.fading) return; const ch = v.ch; try { v.src.disconnect(); } catch (e) {}
    if (v.counted) { const n = (this._nameCount.get(v.counted) || 1) - 1; if (n <= 0) this._nameCount.delete(v.counted); else this._nameCount.set(v.counted, n); v.counted = null; }
    v.active = false; v.fading = false; v.src = null; v.follow = null; if (ch) { ch.used = false; ch.send.gain.value = 0; } v.ch = null;
  }
  _pathAutomation(v, start) {
    const p = v.ch.pan, P = v.path, t1 = start + P.dur; p.positionX.cancelScheduledValues(start); p.positionY.cancelScheduledValues(start); p.positionZ.cancelScheduledValues(start);
    p.positionX.setValueAtTime(px(P.from), start); p.positionY.setValueAtTime(py(P.from), start); p.positionZ.setValueAtTime(pz(P.from), start);
    p.positionX.linearRampToValueAtTime(px(P.to), t1); p.positionY.linearRampToValueAtTime(py(P.to), t1); p.positionZ.linearRampToValueAtTime(pz(P.to), t1); v.pathEnd = t1;
    if (P.rate && P.rate.length > 1 && v.src) { const c = new Float32Array(P.rate.length); for (let i = 0; i < c.length; i++) c[i] = P.rate[i] * v.pitch; v.src.playbackRate.setValueCurveAtTime(c, start, P.dur); }
  }

  /** air absorption low-pass cutoff (Hz) for distance d: attenuation at 8 kHz of 0.09*airAbs dB per metre, first-order shape */
  _airCutoff(d, k) { const a8 = 0.09 * this.sp.airAbs * k * d; if (a8 < 0.02) return 22000; const r = Math.sqrt(Math.pow(10, a8 / 10) - 1); return clamp(12000 / r, 260, 22000); }
  _spatial(v, first) {
    const L = this.L, ch = v.ch; if (v.follow) { v.x = px(v.follow); v.y = py(v.follow); v.z = pz(v.follow); }
    const dx = v.x - L.px, dy = v.y - L.py, dz = v.z - L.pz;
    if (!first && !v.doppler && !v.path) { // nothing that feeds the panner / gain / filters / send has changed (source + listener still, occlusion settled, same room parameters, same view for stereo panning): they already hold the right values
      const eps = 0.02 + 0.004 * v.lastD;
      if (Math.abs(dx - v.cdx) < eps && Math.abs(dy - v.cdy) < eps && Math.abs(dz - v.cdz) < eps && v.occ === v.cocc && v.csp === this._spStamp && (ch.hrtf || v.crot === this._rotStamp)) return v.lastD;
      if (v.lastD > 6 && ((this._frame + v.gen) & (v.lastD > 30 ? 3 : 1)) !== 0) return v.lastD; // level-of-detail: sources beyond 6 m refresh every 2nd frame (30 Hz), beyond 30 m every 4th
    }
    v.cdx = dx; v.cdy = dy; v.cdz = dz; v.cocc = v.occ; v.csp = this._spStamp; v.crot = this._rotStamp;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz), ref = v.refDist;
    let g = ref / Math.max(d, ref); const fs = v.maxDist * 0.7; if (d > fs) { const u = clamp((d - fs) / (v.maxDist - fs), 0, 1); g *= (1 - u) * (1 - u); }
    const occ = v.occ; let fc = Math.min(this._airCutoff(d, v.airK), this.sp.dryLP), gm = 1;
    if (occ > 0.001) { fc = Math.min(fc, 21000 * Math.pow(1 - occ, 2.6) + 380); gm = 1 - 0.55 * occ; }
    let back = 0;
    if (!ch.hrtf) { const lx = dx * L.rx + dy * L.ry + dz * L.rz, lz = dx * L.fx + dy * L.fy + dz * L.fz, h = Math.sqrt(lx * lx + lz * lz), pan = h > 0.05 ? clamp(lx / h * Math.min(1, d / 0.6), -1, 1) : 0; if (first || Math.abs(pan - v.gp) > 0.01) { ch.pan.pan.value = pan; v.gp = pan; } if (lz < 0 && d > 0.5) { back = clamp(-lz / d, 0, 1); fc *= 1 - 0.55 * back; g *= 1 - 0.18 * back; } }
    else if (first || !v.path) { const p = ch.pan; if (first || ((v.follow || v.moving) && Math.abs(v.x - v.wx) + Math.abs(v.y - v.wy) + Math.abs(v.z - v.wz) > 0.05 + 0.006 * d)) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; v.wx = v.x; v.wy = v.y; v.wz = v.z; } }
    g *= gm; if (first || Math.abs(g - v.gd) > 0.012 * (g + 0.02)) { ch.dist.gain.value = g; v.gd = g; } // (~0.1 dB steps: inaudible, and every AudioParam write is a native call)
    if (first || Math.abs(fc - v.gf) > 0.06 * fc) { ch.lp.frequency.value = fc; v.gf = fc; }
    const sd = Math.pow(clamp(5 / Math.max(d, 2), 0, 1), this.sp.sendFalloff), sg = this.sp.sendAmp * v.sendMul * sd; if (first || Math.abs(sg - v.gs) > 0.06 * (sg + 1e-4)) { ch.send.gain.value = sg; v.gs = sg; }
    if (v.doppler && !first && this._dt > 0 && !v.path) { const vr = (d - v.lastD) / this._dt, r = clamp(this.speedOfSound / (this.speedOfSound + clamp(vr, -250, 250)), 0.6, 1.6); v.dop += (r - v.dop) * 0.4; if (Math.abs(v.dop - 1) > 0.002 || v.dopSet) { v.src.playbackRate.value = v.pitch * v.dop; v.dopSet = true; } }
    v.lastD = d; return d;
  }

  // ---------------------------------------------------------------------------------------------------------- update
  update(dt, listener, st = {}) {
    if (!this.ready) return; const t0 = now(), ctx = this.ctx; this._frame = (this._frame + 1) | 0; if (!this._inHb) this._lastUpd = t0; dt = clamp(dt || 0.016, 0, 0.25); this._dt = dt; this.time = ctx.currentTime;
    if (listener && listener.pos) this._setListener(listener, dt);
    // rooms: vehicle interior overrides the atmosphere's reverb; underwater overrides both
    if (this.gw && this.auto) this._worldSync(dt, st);
    let want = this._refineSpace(st.space ?? this._stSpace); this._stSpace = want; let key = this._veh ? (this._roomId || this._vehSpace) : (st.underwater > 0.5 || this._uw > 0.5 || this._uwAuto > 0.5 ? 'underwater' : want);
    if (this._wantedKey !== key) { this._wantedKey = key; this._applySpace(key, this._veh ? 0.25 : (this._fadeOverride ?? 0.7)); this._fadeOverride = undefined; }
    const T = this._spT, sp = this.sp, k = 1 - Math.exp(-dt * this._spRate); sp.sendAmp += (T.sendAmp * this._encMul - sp.sendAmp) * k; sp.dryLP += (T.dryLP - sp.dryLP) * k; sp.airAbs += (T.airAbs - sp.airAbs) * k; sp.sendFalloff += (T.sendFalloff - sp.sendFalloff) * k;
    { const q = this._spL, r = (a, b) => Math.abs(a - b) > 0.01 * (Math.abs(a) + 1e-4); if (r(sp.sendAmp, q.sendAmp) || r(sp.dryLP, q.dryLP) || r(sp.airAbs, q.airAbs) || r(sp.sendFalloff, q.sendFalloff)) { q.sendAmp = sp.sendAmp; q.dryLP = sp.dryLP; q.airAbs = sp.airAbs; q.sendFalloff = sp.sendFalloff; this._spStamp++; } } // room parameters moved: every voice re-derives its gain / filter / send once
    if (this._prev && t0 > 0 && ctx.currentTime > this._prev.retireAt) this._retire(this._prev);
    this._updateMuffle(dt, st); if (this._spaceWait) this._applySpace(this._spaceWait[0], this._spaceWait[1]);
    if (this._deferred.length) for (let i = this._deferred.length - 1; i >= 0; i--) { const q = this._deferred[i]; if (this.lib.isReady(q.name)) { this._deferred.splice(i, 1); if (this.time - q.t < 1.5) this.play(q.name, q.o); } else if (this.time - q.t > 4) this._deferred.splice(i, 1); }
    const t = this.time; let crowdP = 0; for (let i = 0; i < this.slots.length; i++) {
      const v = this.slots[i];
      if (v.fading) { if (t > v.relAt) this._release(v); continue; } if (!v.active) continue;
      if (!v.loop && t > v.endT) { this._release(v); continue; }
      if (v.positional && t >= v.startT - 0.02) {
        if (v.occAuto && this.occlusionQuery && t > v.occNext) { v.occNext = t + 0.18 + (i % 5) * 0.03; v.occT = this._occlusion(v); }
        if (v.occ !== v.occT) { v.occ += (v.occT - v.occ) * Math.min(1, dt * 9); if (Math.abs(v.occ - v.occT) < 0.01) v.occ = v.occT; }
        this._spatial(v, false);
      }
      if (v.bus === 'voice' && t >= v.startT) { const l = v.vol * (v.positional ? Math.min(1, v.refDist / Math.max(v.lastD, v.refDist)) : 1); crowdP += l * l; }
    }
    { const g = 1 / Math.sqrt(Math.max(1, crowdP / 1.5)), c = this._crowd; this._crowd = c + (g - c) * (1 - Math.exp(-dt * (g < c ? 20 : 3))); if (Math.abs(this._crowd - this._crowdSet) > 0.01) { this.crowd.gain.value = this._crowd; this._crowdSet = this._crowd; } }
    let na = 0; for (let i = 0; i < this.slots.length; i++) if (this.slots[i].active) na++; this.stats.voices = na; if (na > this.stats.peakVoices) this.stats.peakVoices = na;
    if (this.player) this._playerUpdate(dt);
    for (const veh of this.vehicles) this._vehicleUpdate(veh, dt);
    this.rigs.update(dt); this.ambience.update(dt, this.L, st);
    if (this.lib.pending > 0) this.lib.pump(this.offline ? 40 : this.ambience.loading ? 5 : this._pumpBudget, 1);
    if (this.lib._lazyQ.length && dt < 0.024 && t0 > this._quietUntil) this.lib.drainLazy(this.stats.voices > 28 ? 0.1 : 0.2); // background AudioBuffer conversion: slices of ~20 us, <= 0.2 ms per frame, paused when frames are slow, busy or during audio.quiet()
    this.stats.updateMs += ((now() - t0) - this.stats.updateMs) * 0.05;
  }
  /**
   * Occlusion of a voice by the world (0 = clear .. 0.75 = fully blocked). Blocked direct line -> look for a way around the blocker: does the listener see points 1.6 m beside / above the source
   * (door, window, corner), does the source see points beside the listener? Every open detour lets sound diffract in and lowers the occlusion (0.75 -> 0.6 -> 0.47 -> ...).
   */
  _occlusion(v) {
    const L = this.L, q = this.occlusionQuery, w = this.gw, x = v.x, y = v.y, z = v.z; if (q(L.px, L.py, L.pz, x, y, z)) return 0;
    let base = 0.75; // blocked: what blocks it? Up to 3 layers along the line, each contributing the opacity of its material (glass ~ open, thin wood muffled, concrete / rock strong)
    if (w && w.raycast) { const o = this._occOut || (this._occOut = {}); let ox = L.px, oy = L.py, oz = L.pz, dx = x - ox, dy = y - oy, dz = z - oz; const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= len; dy /= len; dz /= len; let rem = len, sum = 0, hits = 0;
      for (let k = 0; k < 3 && rem > 0.1; k++) { if (!w.raycast(ox, oy, oz, dx, dy, dz, rem, o)) break; sum += MAT_OCC[o.surface] ?? MAT_OCC.default; hits++; const adv = o.t + 0.08; ox += dx * adv; oy += dy * adv; oz += dz * adv; rem -= adv; }
      if (hits) base = clamp(hits > 1 ? sum * 0.85 : sum, 0.08, 0.85); }
    const dx2 = x - L.px, dz2 = z - L.pz, len2 = Math.hypot(dx2, dz2) || 1, sx = -dz2 / len2 * 1.6, sz = dx2 / len2 * 1.6; let open = 0; // ways around the blocker: does the listener see points beside / above the source, the source points beside the listener? each open detour lets sound diffract in
    if (q(L.px, L.py, L.pz, x + sx, y, z + sz)) open++; if (q(L.px, L.py, L.pz, x - sx, y, z - sz)) open++; if (q(L.px, L.py, L.pz, x, y + 1.6, z)) open++;
    if (q(L.px + sx, L.py, L.pz + sz, x, y, z)) open++; if (q(L.px - sx, L.py, L.pz - sz, x, y, z)) open++;
    return Math.max(0.06, base - 0.13 * open * (base / 0.75));
  }
  /** room probe (auto mode, needs world.raycast): 8 horizontal rays + one up every 0.3 s -> enclosure 0 (open field) .. 1 (corridor / small room) scales the reverb send 0.75 .. 1.5 x (smoothed), so the same room preset sounds bigger in the open and tighter in a passage */
  _probeRoom(dt) {
    const w = this.gw, L = this.L, pl = this.player, veh = this._veh && pl && pl.platform && pl.platform.colliders && pl.local ? pl.platform : null; // inside a vehicle the rays go against its own (local) colliders
    if (!this.probeRooms || !L.set || (!veh && !w.raycast) || (veh && !veh.colliders.raycast)) { this._encT = 1; this._encMul += (1 - this._encMul) * (1 - Math.exp(-dt * 1.2)); return; }
    this._probeT -= dt; if (this._probeT <= 0) {
      this._probeT = 0.3; const o = this._probeOut || (this._probeOut = {}), MAXT = 40, rot = (this._probeK = (this._probeK + 1) & 7) * (Math.PI / 32), ox = veh ? pl.local.x : L.px, oy = (veh ? pl.local.y : L.py) - 0.2, oz = veh ? pl.local.z : L.pz, C = veh ? veh.colliders : w; let sum = 0;
      for (let k = 0; k < 8; k++) { const a = rot + k * Math.PI / 4; sum += C.raycast(ox, oy, oz, Math.cos(a), 0, Math.sin(a), MAXT, o) ? o.t : MAXT; }
      const ceil = C.raycast(ox, oy, oz, 0, 1, 0, 30, o) ? o.t : 30, mean = sum / 8; this._pm = mean; this._pc = ceil;
      this._encT = veh ? 1 : 0.75 + 0.75 * clamp(1 - mean / 25, 0, 1) * (0.65 + 0.35 * (1 - clamp((ceil - 3) / 12, 0, 1)));
    }
    this._encMul += (this._encT - this._encMul) * (1 - Math.exp(-dt * 1.2));
  }
  /** sub-rooms of a stop (preset `rooms`: [{space, meanMin/Max, ceilMin/Max}]) and of the ferry: the listener probe (mean free path, ceiling height) picks the room; a change must hold 0.9 s, then the rooms cross-fade */
  _roomTick(dt, rooms) {
    const m = this._pm, c = this._pc; let pick = null; if (rooms && m !== undefined) for (const r of rooms) if ((r.meanMin === undefined || m >= r.meanMin) && (r.meanMax === undefined || m <= r.meanMax) && (r.ceilMin === undefined || c >= r.ceilMin) && (r.ceilMax === undefined || c <= r.ceilMax)) { pick = r.space; break; }
    if (pick === this._roomWant) this._roomHold += dt; else { this._roomWant = pick; this._roomHold = 0; }
    if (this._roomHold > 0.9 && this._roomWant !== this._roomId) { this._roomId = this._roomWant; this._roomChanged = true; this._fadeOverride = 1.2; }
  }
  _setListener(l, dt) {
    const L = this.L, p = l.pos, f = l.forward, u = l.up || null; let fx = f.x, fy = f.y, fz = f.z; const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let ux = u ? u.x : 0, uy = u ? u.y : 1, uz = u ? u.z : 0; let rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux; const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (rl < 1e-4) { rx = 1; ry = 0; rz = 0; } else { rx /= rl; ry /= rl; rz /= rl; } ux = ry * fz - rz * fy; uy = rz * fx - rx * fz; uz = rx * fy - ry * fx;
    L.px = p.x; L.py = p.y; L.pz = p.z; L.fx = fx; L.fy = fy; L.fz = fz; L.rx = rx; L.ry = ry; L.rz = rz; L.ux = ux; L.uy = uy; L.uz = uz; L.set = true;
    const rs = this._rs; if (Math.abs(fx - rs.fx) + Math.abs(fz - rs.fz) + Math.abs(rx - rs.rx) + Math.abs(rz - rs.rz) > 0.001) { rs.fx = fx; rs.fz = fz; rs.rx = rx; rs.rz = rz; this._rotStamp++; } // stereo-panned voices re-aim only when the view really turned
    const w = this._lw, moved = Math.abs(p.x - w.px) + Math.abs(p.y - w.py) + Math.abs(p.z - w.pz) > 0.01, turned = Math.abs(fx - w.fx) + Math.abs(fy - w.fy) + Math.abs(fz - w.fz) + Math.abs(ux - w.ux) + Math.abs(uy - w.uy) + Math.abs(uz - w.uz) > 0.0006;
    if (!moved && !turned) return; // the AudioListener params (9 native setters) are only written when the listener changed
    const a = this.listener; if (a.positionX) { if (moved) { a.positionX.value = p.x; a.positionY.value = p.y; a.positionZ.value = p.z; w.px = p.x; w.py = p.y; w.pz = p.z; } if (turned) { a.forwardX.value = fx; a.forwardY.value = fy; a.forwardZ.value = fz; a.upX.value = ux; a.upY.value = uy; a.upZ.value = uz; w.fx = fx; w.fy = fy; w.fz = fz; w.ux = ux; w.uy = uy; w.uz = uz; } } else if (a.setPosition) { a.setPosition(p.x, p.y, p.z); a.setOrientation(fx, fy, fz, ux, uy, uz); w.px = p.x; w.py = p.y; w.pz = p.z; w.fx = fx; w.fy = fy; w.fz = fz; w.ux = ux; w.uy = uy; w.uz = uz; }
  }
  _updateMuffle(dt, st) {
    let target = Math.max(st.muffle || 0, this._muffle, this._vehMuffle * (this._roomId ? 0.2 : 1) * (1 - 0.85 * this._doors)); // (on the ferry's open deck the outside is barely muffled) if (this._lowHp > 0) target = Math.max(target, this._lowHp * 0.4);
    const uwT = Math.max(st.underwater || 0, this._uw, this._uwAuto), k = 1 - Math.exp(-dt * 7); this._muffleEff += (target - this._muffleEff) * k; this._uwEff = (this._uwEff || 0) + (uwT - (this._uwEff || 0)) * k;
    const m = this._muffleEff, u = this._uwEff; let fc = 21500 * Math.pow(1 - clamp(m, 0, 0.995), 2.6) + 380; if (u > 0.001) fc = Math.min(fc, 22000 * Math.pow(0.03, u) + 60);
    if (Math.abs(fc - (this._wfF || 0)) > 0.02 * fc) { this.wf.frequency.value = fc; this._wfF = fc; }
    const q = u > 0.3 ? 1.5 : -3; if (q !== this._wfQ) { this.wf.Q.value = q; this._wfQ = q; }
    const gain = (1 - 0.32 * m) * (1 - 0.15 * u); if (Math.abs(gain - (this._wfG || 0)) > 0.004) { this.wfGain.gain.value = gain; this._wfG = gain; }
  }
  /** manual muffle (0..1) — behind a wall, inside something; smoothly applied */
  muffle(x) { this._muffle = clamp(+x || 0, 0, 1); }
  underwater(x) { this._uw = clamp(+x || 0, 0, 1); }
  setBusVolume(bus, v) { const g = this.buses[bus]; if (g) g.gain.setTargetAtTime(clamp(v, 0, 2) * BUS_GAIN[bus], this.ctx.currentTime, 0.03); }
  /** Duck buses (name | array | 'all' | 'world') by amt (0..1 reduction) with fast attack and release over `secs`. */
  duck(bus, amt = 0.5, secs = 1, hold = 0.05) {
    if (!this.ready) return; const list = bus === 'all' ? BUS_NAMES.filter((b) => b !== 'ui') : bus === 'world' ? ['sfx', 'amb', 'music', 'voice'] : Array.isArray(bus) ? bus : [bus], t = this.ctx.currentTime;
    for (const b of list) { const d = this._duck[b], g = this.duckNodes[b]; if (!g) continue; const depth = clamp(amt, 0, 0.98); if (t < d.until && depth <= d.depth * 0.9) continue; d.depth = depth; d.until = t + hold + secs; g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(1 - depth, t, 0.012); g.gain.setTargetAtTime(1, t + hold, Math.max(0.05, secs / 3)); }
  }
  explosionDuck(amt = 0.6) { this.duck('all', amt, 2.4, 0.25); }

  // ---------------------------------------------------------------------------------------------------------- helpers used by gameplay
  /** wait (s) that sound needs to travel from `pos` to the listener */
  delayFor(pos) { const L = this.L, dx = px(pos) - L.px, dy = py(pos) - L.py, dz = pz(pos) - L.pz; return Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - 8) / this.speedOfSound * this.sosScale; }
  distance(pos) { const L = this.L, dx = px(pos) - L.px, dy = py(pos) - L.py, dz = pz(pos) - L.pz; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  /** bullet impact sound for surface at pos. opts: {caliber (1 = 9mm, 0.6 .22, 1.6 rifle), isShotgun, dir, normal, vol} */
  impact(surface, pos, o = {}) {
    if (!this.ready) return null; const cal = o.caliber ?? 1, name = this.lib.has('impact.' + surface) ? 'impact.' + surface : 'impact.default';
    const h = this.play(name, { pos, vol: (o.vol ?? 1) * clamp(0.65 + 0.35 * cal, 0.5, 1.4) * (o.isShotgun ? 0.7 : 1), pitch: clamp(1.12 - 0.12 * cal, 0.8, 1.25) });
    if (o.dir && o.normal && (surface === 'metal' || surface === 'rock' || surface === 'concrete' || surface === 'brick' || surface === 'tile' || surface === 'glass')) { const cosI = Math.abs(o.dir.x * o.normal.x + o.dir.y * o.normal.y + o.dir.z * o.normal.z), p = surface === 'metal' ? 0.4 : 0.18; if (cosI < 0.42 && this._rand() < p * (1 - cosI)) this.play('ricochet', { pos, vol: 0.9, delay: 0.02 + this._rand() * 0.03 }); }
    return h;
  }
  flesh(pos, o = {}) { return this.play(o.head ? 'flesh.head' : 'flesh.hit', { pos, vol: o.vol ?? 1 }); }
  casing(pos, surface = 'concrete', isShotgun = false, bounce = 1) { if (!this.ready) return null; const name = `casing.${isShotgun ? 'shell' : 'brass'}.${surface}`; return this.play(this.lib.has(name) ? name : `casing.${isShotgun ? 'shell' : 'brass'}.hard`, { pos, vol: (bounce > 1 ? 0.55 : 1), pitch: 0.95 + this._rand() * 0.1 }); }
  /**
   * Moving-source fly-by along the segment a->b (world) at `speed` m/s with true Doppler (playbackRate follows c/(c - v_toward) computed from the geometry at 24 points)
   * and an animated HRTF position. Only the part within +-window seconds of the closest approach is rendered. Supersonic sources (speed > c) get no Doppler (no wave
   * emitted ahead of them) — their "zip" comes from the sound itself. Returns the handle or null when the path never gets within maxDist of the listener.
   */
  flyby(sound, a, b, o = {}) {
    if (!this.ready || !this.L.set) return null; const L = this.L, ax = px(a), ay = py(a), az = pz(a), bx = px(b), by = py(b), bz = pz(b), sx = bx - ax, sy = by - ay, sz = bz - az, len2 = sx * sx + sy * sy + sz * sz; if (len2 < 1e-6) return null;
    const tt = clamp(((L.px - ax) * sx + (L.py - ay) * sy + (L.pz - az) * sz) / len2, 0, 1), cx = ax + sx * tt, cy = ay + sy * tt, cz = az + sz * tt, dm = Math.hypot(cx - L.px, cy - L.py, cz - L.pz); if (dm > (o.maxDist ?? 9)) return null;
    const len = Math.sqrt(len2), ux = sx / len, uy = sy / len, uz = sz / len, speed = o.speed ?? 700, half = Math.min(speed * (o.window ?? 0.06), o.maxHalf ?? 200), t0 = Math.max(0, tt * len - half), t1 = Math.min(len, tt * len + half);
    const from = { x: ax + ux * t0, y: ay + uy * t0, z: az + uz * t0 }, to = { x: ax + ux * t1, y: ay + uy * t1, z: az + uz * t1 }, dur = Math.max(0.03, (t1 - t0) / speed), c = this.speedOfSound; let rate = null;
    if (o.doppler !== false && speed < c) { rate = new Float32Array(24); for (let i = 0; i < 24; i++) { const u = i / 23, X = from.x + (to.x - from.x) * u - L.px, Y = from.y + (to.y - from.y) * u - L.py, Z = from.z + (to.z - from.z) * u - L.pz, r = Math.hypot(X, Y, Z) || 1, vToward = -(ux * X + uy * Y + uz * Z) / r * speed; rate[i] = clamp(c / (c - vToward), 0.25, 6); } }
    return this.play(sound, { pos: { x: cx, y: cy, z: cz }, vol: (o.vol ?? 1) * (o.distGain ? Math.pow(clamp(1 - dm / (o.maxDist ?? 9), 0, 1), 0.5) : 1), hrtf: true, path: { from, to, dur, rate }, pitch: o.pitch ?? 1, jitter: o.jitter ?? 0.03, name: o.name, minDist: o.minDist, maxDist: 200, prio: o.prio, bus: o.bus, sos: false });
  }
  /** near-miss: bullet path a->b (world); plays the bullet.whiz crack/zip with fly-by positioning (+ Doppler for subsonic rounds). speed m/s */
  whiz(a, b, o = {}) { return this.flyby('bullet.whiz', a, b, { speed: 700, ...o, distGain: true, vol: (o.vol ?? 1) * 1.1 }); }
  /** explosion: layered sound through the current space + ducking + tinnitus for close blasts. `radius` = blast radius in metres (grenade 5.2 = normal, 2.6 = small, 12+ = huge); opts.power overrides the derived strength (1 = grenade). */
  explosion(pos, radius = 5.2, o = {}) {
    if (!this.ready) return null; const power = o.power ?? clamp(radius / 5.2, 0.15, 3), d = this.L.set ? this.distance(pos) : 10, sq = Math.sqrt(Math.max(0.2, power)), far = d > 70 * sq;
    const h = this.play(far ? 'explosion.far' : power < 0.55 ? 'explosion.small' : 'explosion', { pos, vol: clamp(0.55 + 0.45 * power, 0.5, 1.3), sos: 1, prio: 9 });
    const sev = clamp(1 - d / (15 * sq), 0, 1), delay = this.delayFor(pos);
    if (sev > 0.02 || d < 50 * sq) this._blastEffects(sev, clamp(1.3 * power / (1 + d / (7 * sq)), 0, 0.85), delay);
    return h;
  }
  _blastEffects(sev, duckAmt, delay) {
    const c = this.ctx, t = c.currentTime + delay;
    if (duckAmt > 0.05) { const secs = 1.4 + 2.2 * duckAmt; this.duck(['sfx', 'amb', 'music'], duckAmt, secs, 0.12 + 0.4 * sev); this.duck('voice', duckAmt * 0.6, secs * 0.8, 0.1); this.duck('weapon', duckAmt * 0.35, secs * 0.6, 0.08); }
    if (sev < 0.08) return;
    // tinnitus: master low-pass sweep (deafened), then recovery, plus a decaying 6 kHz ring
    const f = this.tinLP.frequency, lo = 700 + (1 - sev) * 4200, rec = 2 + 4 * sev; f.cancelScheduledValues(t); f.setValueAtTime(24000, t); f.setTargetAtTime(lo, t, 0.03); f.setTargetAtTime(24000, t + 0.5 + 0.9 * sev, rec / 3);
    if (this.ctx.currentTime - this._tinT < 0.4 && !this.offline) return; this._tinT = this.ctx.currentTime;
    const osc = c.createOscillator(), osc2 = c.createOscillator(), g = c.createGain(); osc.type = 'sine'; osc2.type = 'sine'; osc.frequency.value = 6000 + this._rand() * 300; osc2.frequency.value = 9100 + this._rand() * 500;
    const lvl = 0.02 + 0.055 * sev; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + 0.25 + 0.4 * (1 - sev)); g.gain.setTargetAtTime(0, t + 0.8, 1.1 + 1.8 * sev);
    const g2 = c.createGain(); g2.gain.value = 0.35; osc.connect(g); osc2.connect(g2); g2.connect(g); g.connect(this.post); osc.start(t); osc2.start(t); const end = t + 0.8 + (1.1 + 1.8 * sev) * 7; osc.stop(end); osc2.stop(end);
  }
  ui(name, o = {}) { return this.play(name.startsWith('ui.') || name.startsWith('perk.') || name.startsWith('powerup.') ? name : 'ui.' + name, { bus: 'ui', ...o }); }

  // ---------------------------------------------------------------------------------------------------------- player / vehicles
  /** hook footsteps, landing, damage and low-HP heartbeat/breathing to a Player (src/core/player.js) */
  attachPlayer(player) {
    if (player._audioAttached) { this.player = player; if (player.world && player.world !== this.gw) this.setWorld(player.world); return; } player._audioAttached = true;
    this.player = player; const s0 = player.onStep, l0 = player.onLand, d0 = player.onDamage; // ours first, so a generic step/land/hurt sound played by game code right after is recognised as a duplicate and dropped
    player.onStep = (surface, k) => { this.step(surface, k, player); if (s0) s0(surface, k); };
    player.onLand = (speed, surface) => { this.land(speed, surface, player); if (l0) l0(speed, surface); };
    player.onDamage = (amt, from) => { this.hurt(amt, player); if (d0) d0(amt, from); };
    if (player.world && player.world !== this.gw) this.setWorld(player.world);
  }
  step(surface, k = 1, who = null) {
    if (!this.ready) return null; this._stepGuard = this.ctx.currentTime + 0.09; const mode = k > 1.2 ? 'sprint' : k < 0.7 ? 'crouch' : 'walk', foot = (this._foot ^= 1) ? 'L' : 'R'; let name = `step.${surface}.${mode}.${foot}`; if (!this.lib.has(name)) name = `step.default.${mode}.${foot}`;
    const p = who && who.pos ? who.pos : (this.L.set ? { x: this.L.px, y: this.L.py - 1.6, z: this.L.pz } : null), r = this.L, off = foot === 'L' ? -0.14 : 0.14;
    const pos = p ? { x: p.x + r.rx * off, y: p.y + 0.05, z: p.z + r.rz * off } : null;
    return this.play(name, { pos, vol: mode === 'sprint' ? 0.9 : mode === 'crouch' ? 0.7 : 0.8, pitch: mode === 'crouch' ? 0.96 : 1 });
  }
  land(speed, surface, who) { if (!this.ready) return; this._stepGuard = this.ctx.currentTime + 0.12; const v = clamp(speed / 9, 0.3, 1.3), p = who && who.pos ? { x: who.pos.x, y: who.pos.y + 0.05, z: who.pos.z } : null; this.play('player.land', { pos: p, vol: v }); const name = `step.${surface}.sprint.L`; this.play(this.lib.has(name) ? name : 'step.default.sprint.L', { pos: p, vol: v * 0.8, delay: 0.01 }); }
  hurt(amount, who) { if (!this.ready) return; this.play('player.hurt', { vol: clamp(0.6 + amount / 60, 0.6, 1.2), prio: 9 }); this.duck(['amb', 'music'], 0.25, 0.6, 0.05); }
  _playerUpdate(dt) {
    const p = this.player, hpF = p.maxHp > 0 ? clamp(p.hp / p.maxHp, 0, 1) : 1, t = this.time;
    this._lowHp = p.alive === false ? 0 : clamp((0.45 - hpF) / 0.3, 0, 1);
    if (this._lowHp > 0.02) {
      if (t >= this._beat) { const rate = 0.5 + 0.65 * (1 - this._lowHp * 0.9); this._beat = t + rate; this.play('player.heartbeat', { bus: 'sfx', vol: 0.5 + 0.5 * this._lowHp, jitter: 0.02 }); }
      if (t >= this._breath) { this._breath = t + 2.3 - 0.9 * this._lowHp + this._rand() * 0.6; this.play('player.breath', { vol: 0.35 + 0.4 * this._lowHp, jitter: 0.06 }); }
    }
    const plat = p.platform; const kind = plat ? (vehicleKind(plat.name) || 'vehicle') : null; if (kind !== this._vehName) this.setListenerVehicle(kind);
  }
  /** switch to a vehicle interior ('cage'|'gondola'|'ferry'|'monorail'|null): interior space + partial muffle of the outside world */
  setListenerVehicle(name, opts = {}) {
    const kind = name ? vehicleKind(name) || name : null; this._vehName = kind || null; this._veh = !!kind; this._roomId = null; this._roomWant = null; this._roomHold = 0;
    if (kind) { this._vehSpace = SPACES[kind] ? kind : 'vehicle'; this._vehMuffle = opts.muffle ?? 0.55; } else { this._vehSpace = null; this._vehMuffle = 0; }
    this._wantedKey = null;
  }
  setVehicleDoors(k) { this._doors = clamp(k, 0, 1); }
  /** route a Vehicle's emit() events ('doors','creak','bump','arrived','departed') to sounds and drive its loops from its speed */
  attachVehicle(vehicle) {
    const kind = vehicleKind(vehicle.name); if (!kind) { warnOnce('veh:' + vehicle.name, `attachVehicle: unknown vehicle name "${vehicle.name}"`); return; } vehicle._audioKind = kind; this.vehicles.add(vehicle); this.lib.promotePrefix(`vehicle.${kind}.`, 1); this.prepareSpaces([SPACES[kind] ? kind : 'vehicle']); const prev = vehicle.onEvent;
    vehicle.onEvent = (evt, data) => { if (prev) prev(evt, data); this.vehicleEvent(kind, evt, data, vehicle); };
  }
  vehicleEvent(kind, evt, data = {}, vehicle = null) {
    if (!this.ready) return; const g = vehicle && vehicle.group ? vehicle.group.position : null, pos = g ? { x: g.x, y: g.y + 1, z: g.z } : null, base = `vehicle.${kind}.`;
    switch (evt) {
      case 'doors': this.play(data && data.open === false ? base + 'door.close' : base + 'door', { pos, vol: 1 }); if (data && data.open === false) this._doors = 0; else this._doors = 1; break;
      case 'creak': this.play(base + 'creak', { pos, vol: 0.9 }); break; case 'bump': this.play(base + 'bump', { pos, vol: clamp(data && data.strength !== undefined ? data.strength : 1, 0.3, 1.2) }); break;
      case 'arrived': if (!(vehicle && this.time - (vehicle._audStopT || -99) < 4)) this.play(base + 'stop', { pos }); this.play(base + 'bell', { pos, delay: 0.3, vol: 0.9 }); break; // (the cage emits 'stop' just before 'arrived': one brake sound)
      case 'approach': this.play(this.lib.has(base + 'chime') ? base + 'chime' : base + 'bell', { pos, vol: 0.8 }); break;
      case 'stop': if (vehicle) vehicle._audStopT = this.time; this.play(base + 'stop', { pos }); break; case 'departed': case 'start': this.play(base + 'start', { pos }); break;
      case 'horn': this.play(base + 'horn', { pos, vol: 1.1 }); break;
      case 'jointkick': this.play(base + 'jointkick', { pos, vol: clamp(((data && data.v) || 10) / 15 * ((data && data.k) || 1) * 0.6, 0.15, 0.7) }); break;
      case 'pa': this.play(base + 'pa', { pos: data && data.pos ? data.pos : pos, vol: 0.8 }); break;
      default: if (this.lib.has(base + evt)) this.play(base + evt, { pos });
    }
  }
  _vehicleUpdate(veh, dt) {
    const kind = veh._audioKind, sp = veh.vel ? veh.vel.length() : 0, inside = this.player && this.player.platform === veh;
    if (veh.doors !== undefined && inside) this._doors = veh.doors;
    this.rigs.drive(kind, { speed: sp, inside, active: veh.group ? veh.group.visible : true, time: veh.time });
  }
  /** drive a vehicle's loop bed: audio.vehicleLoop('monorail', {speed: 0..1+ (or m/s with unit:'ms'), load, inside}) ; audio.vehicleLoop(name, null) stops it */
  vehicleLoop(name, params) { if (!this.ready) return; this.rigs.drive(vehicleKind(name) || name, params); }
  /**
   * Hand the engine the World (attachPlayer(player) does it with player.world). Installs the occlusion test (world.clear) and — unless `audio.auto = false` — makes the audio follow the world by itself:
   * per active stop the room (stop-specific SPACES id), the ambience (audio.ambience.presets['<map>.<stop>'], else the stop's own `ambient` recipe, with the stop's origin), wind from the atmosphere,
   * underwater when the camera is below waterY, and a continuous cross-fade of rooms/beds while world.transit (vehicle ride) blends two stops. Explicit setSpace()/ambience.set() calls still work.
   */
  setWorld(world, opts = {}) {
    this.gw = world || null; this.occlusionQuery = world && world.clear ? (a, b, c, d, e, f) => world.clear(a, b, c, d, e, f) : null; this._autoStop = null; this._autoTransit = false; if (opts.auto !== undefined) this.auto = !!opts.auto;
    if (world && world.stops && this.ready && !this.offline) { const ids = []; for (const st of world.stops) { const sp = this._spaceOfStop(st), rec = this._recipeFor(st); if (sp && !ids.includes(sp)) ids.push(sp); if (rec && rec.rooms) for (const r of rec.rooms) if (!ids.includes(r.space)) ids.push(r.space); } if (!ids.includes('open')) ids.push('open'); this.prepareSpaces(ids).catch(() => {}); } // load every room of this map into its convolver now (during the loading screen), so a stop change / ride never hitches
  }
  /** the recipe this engine plays for a stop: our calibrated preset for '<map>.<stop>' (unless audio.preferPresets = false), else the recipe the stop declares */
  _recipeFor(stop) {
    if (!stop) return null; if (stop._aRecFor === this.preferPresets && stop._aRecW === this.gw) return stop._aRec; const w = this.gw, P = this.ambience.presets, key = (w && w.map ? w.map.id : '') + '.' + stop.id, exact = stop.ambient && stop.ambient.exact;
    stop._aRec = this.preferPresets !== false && !exact && P[key] ? this._mergeAuthored(P[key], stop.ambient) : (stop.ambient || null); stop._aRecFor = this.preferPresets; stop._aRecW = this.gw; return stop._aRec; // (cached on the stop: called every frame during a ride)
  }
  /** our calibrated preset supplies beds / levels / rooms; the emitters the map authors placed at explicit positions (bell at the buoy, radio at the hut, ring bell...) replace the preset's events of the same type, at a trimmed gain */
  _mergeAuthored(preset, authored) {
    const ev = authored && authored.events; if (!ev) return preset; const keep = ev.filter((e) => e && e.type && Array.isArray(e.pos) && !e.custom); if (!keep.length) return preset; const types = new Set(keep.map((e) => eventType(e.type)));
    return { ...preset, events: [...(preset.events || []).filter((e) => !e.type || !types.has(eventType(e.type))), ...keep.map((e) => ({ ...e, gain: Math.min(1, e.gain ?? 1) * AUTH_GAIN, _auth: true }))] };
  }
  /** the active stop's generic atmosphere reverb name ('open', 'snow', 'mineShaft'...) -> that stop's specific room ('pier', 'crystalCavern'...); anything else unchanged */
  _refineSpace(x) { if (this.gw && this.auto && typeof x === 'string') { const st = this.gw.active; if (st && st.atmo && st.atmo.reverb === x) return this._spaceOfStop(st) || x; } return x; }
  _stopOfRecipe(r) { const w = this.gw; if (!w || !r || typeof r !== 'object') return null; for (const s of w.stops) if (s.ambient === r) return s; return null; }
  _spaceOfStop(stop) { const rec = this._recipeFor(stop), atmo = stop && stop.atmo; if (rec && rec.space && (typeof rec.space === 'object' || rec.cal)) return rec.space; return atmo && atmo.reverb ? atmo.reverb : (rec && rec.space) || 'open'; }
  _enterStop(stop, fade) {
    const rec = this._recipeFor(stop); if (rec) this.ambience.set(rec, fade, { origin: stop.origin, space: false }); else this.ambience.stop(fade);
    this._roomId = null; this._roomWant = null; this._roomHold = 0; this._stSpace = this._spaceOfStop(stop); this._wantedKey = null; this._fadeOverride = Math.min(1.2, fade * 0.5); this._spaceStamp = 0;
  }
  _worldSync(dt, st) {
    const w = this.gw, stop = w.active; if (!stop || w.shown === false) return; const tr = w.transit, L = this.L;
    if (w.vehicle && w.vehicle !== this._autoVeh) { if (this._autoVeh) this.vehicles.delete(this._autoVeh); this._autoVeh = w.vehicle; this.attachVehicle(w.vehicle); } // the ride vehicle: door / horn / bump / arrival sounds and its speed-driven loops
    let wind = stop.atmo && stop.atmo.wind;
    if (tr && w.stops[tr.from] && w.stops[tr.to]) { // ride between two stops: continuous cross-fade of beds, room follows the nearer end
      const A = w.stops[tr.from], B = w.stops[tr.to], t = tr.t; this._autoTransit = true; this._autoStop = null;
      const bo = this._blendO || (this._blendO = { originA: null, originB: null }); bo.originA = A.origin; bo.originB = B.origin; this.ambience.blend(this._recipeFor(A), this._recipeFor(B), t, bo); const near = t < 0.5 ? A : B; if (this._nearStop !== near) { this._nearStop = near; this._stSpace = this._spaceOfStop(near); this._fadeOverride = 1.0; }
      const wa = A.atmo && A.atmo.wind, wb = B.atmo && B.atmo.wind; wind = (t < 0.5 ? wa : wb) || wind;
    } else if (this._autoTransit || stop !== this._autoStop) { const first = !this._autoStop && !this._autoTransit; this._autoTransit = false; this._nearStop = null; this._autoStop = stop; this._enterStop(stop, first ? 0.6 : 2.5); }
    this._probeRoom(dt); if (!tr) { const rec = this._recipeFor(stop); this._roomTick(dt, this._veh ? VEH_ROOMS[this._vehName] : rec && rec.rooms); if (this._roomChanged) { this._roomChanged = false; this._stSpace = this._roomId || (this._veh ? this._vehSpace : this._spaceOfStop(stop)); this._wantedKey = null; } } else this._roomId = null;
    if (st.wind === undefined && wind) this.ambience.wind = Array.isArray(wind) ? Math.hypot(wind[0] || 0, wind[1] || 0, wind[2] || 0) : Math.hypot(wind.x || 0, wind.y || 0, wind.z || 0);
    if (st.underwater === undefined && this.L.set) { const wy = stop.B && stop.B.colliders ? stop.B.colliders.waterY : undefined, oy = stop.origin ? stop.origin.y : 0; this._uwAuto = typeof wy === 'number' && isFinite(wy) && !tr ? clamp((wy + oy - L.py) / 0.12, 0, 1) : 0; }
  }

  // ---------------------------------------------------------------------------------------------------------- voices
  /** zombie voice bank: audio.zombieVoice(profile) -> {idle:[],attack:[],pain:[],death:[],spawn:[],sprint:[], pick(cat), ready:Promise}; cached by profile JSON; buffers are built time-sliced */
  zombieVoice(profile) { const key = JSON.stringify(profile || {}); let s = this._voiceSets.get(key); if (!s) { s = makeZombieVoice(this, profile || {}); this._voiceSets.set(key, s); } return s; }
  /** play one of a voice bank's sounds (random variant, avoiding immediate repeats). Returns handle */
  speak(set, category, o = {}) { const b = set && set.pick ? set.pick(category) : null; if (!b) return null; return this.play(b, { bus: 'voice', prio: o.prio ?? 5, minDist: 4, maxDist: 70, name: 'voice.' + category, ...o }); }
  debug() { return { ...this.stats, space: this.space, voices: this.slots.filter((v) => v.active).map((v) => `${v.name}${v.positional ? '@' + v.lastD.toFixed(1) : ''}`), pending: this.lib.pending, initMs: this.initMs }; }
}
const DEFAULT_META = { bus: 'sfx', prio: 3, refDist: 3, maxDist: 100, send: 1 };

class Handle {
  constructor(eng, v, gen, src, gain) { this.eng = eng; this.v = v; this.gen = gen; this.src = src; this.gain = gain; }
  get playing() { return this.v.active && this.v.gen === this.gen; }
  stop(fade = 0.03) { if (this.playing) this.eng._kill(this.v, fade); }
  setVol(vol, ramp = 0.03) { if (!this.playing) return; const g = this.v.ch.pre.gain, t = this.eng.ctx.currentTime; g.cancelScheduledValues(t); g.setTargetAtTime(vol, t, ramp / 3); }
  setPitch(p, ramp = 0.05) { if (this.playing) this.v.src.playbackRate.setTargetAtTime(p, this.eng.ctx.currentTime, ramp / 3); }
  setPos(p) { if (this.playing && this.v.positional) { this.v.x = px(p); this.v.y = py(p); this.v.z = pz(p); this.v.moving = true; } }
  setOcclusion(o) { if (this.playing) { this.v.occT = o; this.v.occAuto = false; } }
}

export const audio = new AudioEngine();
export default audio;
