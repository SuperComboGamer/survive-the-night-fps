// Ambience runtime: per-stop recipes  { space, gain, beds:[{type,...params,gain,pos?}], events:[{type|custom, every:[min,max], gain, pos:'around'|'far'|[x,y,z], pitch:[a,b]}] }
//   audio.ambience.set(recipe | presetName, fadeSec)   crossfades from whatever is playing (equal power)      audio.ambience.blend(recipeA, recipeB, t)   continuous crossfade (vehicle transit)
//   audio.ambience.stop(fade)   audio.ambience.prepare(recipe) -> Promise (build all buffers ahead of time)    audio.ambience.presets   (16 stop recipes + menu)
// Bed types:  wind (live noise graph: gusts, whistles, howl; follows atmosphere wind) · hum · drone (pad) · rumble (live) · water {kind: lap|stream|waves|surf|rain|bubbles|hiss|drip}
//             noise {color, lp, hp, bp, q, mod, depth} (live) · crackle {kind: fire|ice|static|electric} · machine {kind: diesel|generator|gears|fan|steam|motor|pump|compressor|clock|turbine}
//             insects · music {kind: calliope|musicbox|synth|accordion|organ|bells, tune, tempo, detune, wow, gap}      Unknown types warn once and are ignored.
// Stop-authored recipes (stop.data.ambient) are accepted as they are (loose names such as lap/shimmer/style/tune{bpm,notes}/harmonics[..]/pos:'far' are understood, custom room definitions work, loudness is trimmed
// automatically). When the World is attached (audio.setWorld / attachPlayer) the engine plays its calibrated preset for '<map>.<stop>' instead; set `exact: true` on a recipe (or audio.preferPresets = false) to keep the authored one.
// Event types: drip creak clank gust crow gull owl parrot bell foghorn rockfall ice-crack thunder pipe bubble wolf scream-far laugh-far moan-far whistle firework radio ping chime boom steam splash scurry chain siren klaxon whisper
//             door wood-knock pop zap blip beep cannon metal-groan (+ aliases) and {custom:(A)=>{...}} with A = { play, around, far, rand, pick, chance, listener, audio, dsp, level, time }
import * as dsp from './dsp.js';
import { bedSpec, ensureBed } from './sfx/beds.js';
import { EVENTS, eventType } from './sfx/events.js';
import { renderPhrase, TUNES, instrumentSr } from './sfx/music.js';
import { PRESETS, resolvePreset } from './sfx/presets.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const warned = new Set(); const warnOnce = (k, msg) => { if (!warned.has(k)) { warned.add(k); console.warn('[audio.ambience] ' + msg); } };
const BED_TYPES = { wind: 'wind', gale: 'wind', hum: 'hum', buzz: 'hum', rumble: 'rumble', drone: 'drone', pad: 'drone', water: 'water', noise: 'noise', crackle: 'crackle', fire: 'fire', machine: 'machine', engine: 'machine', music: 'music', insects: 'insects', crickets: 'insects', rain: 'rain', surf: 'surf', waves: 'waves', hiss: 'hiss', steam: 'steam', custom: 'custom' };
const rand = (a, b) => a + Math.random() * (b - a);

const NOTE_KIND = [[/turbin|air.?handl|fan|vent|hvac/i, 'fan'], [/pump/i, 'pump'], [/compress/i, 'compressor'], [/generat/i, 'generator'], [/diesel|engine|boat/i, 'diesel'], [/gear|clock|mechani/i, 'gears'], [/steam|boiler/i, 'steam']];
/** normalise a raw bed definition: aliases -> canonical {type, kind...}; null if unknown. Also accepts the looser parameter names stop authors used (lap, shimmer, style, harmonics [..], tune {bpm, notes}, freq, note hints). */
function normBed(d) {
  const raw = String(d.type || '').toLowerCase(), t = BED_TYPES[raw]; if (!t) return null; const o = { ...d };
  if (t === 'rain' || t === 'surf' || t === 'waves') { o.type = 'water'; o.kind = t; } else if (t === 'hiss') { o.type = 'water'; o.kind = 'hiss'; } else if (t === 'fire') { o.type = 'crackle'; o.kind = o.kind || 'fire'; } else if (t === 'steam') { o.type = 'machine'; o.kind = 'steam'; } else o.type = t;
  switch (o.type) {
    case 'water': if (o.lap !== undefined) { o.kind = o.kind || 'lap'; if (o.intensity === undefined) o.intensity = clamp(o.lap * 0.75, 0.1, 1); } break;
    case 'drone': if (o.shimmer !== undefined) { if (o.detune === undefined) o.detune = 7 + 12 * o.shimmer; if (o.movement === undefined) o.movement = 0.35 + 0.5 * o.shimmer; if (o.bright === undefined) o.bright = 1500 + 2500 * o.shimmer; } break;
    case 'hum': if (Array.isArray(o.harmonics)) o.harmonics = clamp(Math.max(2, ...o.harmonics) + 2, 3, 16); break;
    case 'wind': if (o.freq !== undefined && o.pitch === undefined) o.pitch = clamp(o.freq / 800, 0.5, 1.6); break;
    case 'noise': if (o.kind === 'steam') { o.color = o.color || 'white'; o.hp ??= 2200; o.lp ??= 9000; o.mod ??= 0.2; o.depth ??= 0.35; } else if (o.freq !== undefined && !o.bp && !o.lp && !o.hp) { o.bp = o.freq; o.q ??= 0.7; } break;
    case 'crackle': if (o.kind === 'lava' || o.kind === 'magma') o.kind = 'fire'; o.intensity ??= 0.6; break;
    case 'machine': if (!o.kind) { const m = NOTE_KIND.find(([re]) => re.test(o.note || '')); o.kind = m ? m[1] : 'diesel'; } break;
    case 'music': o.kind = o.kind || o.style; if (o.wow === undefined && o.wobble !== undefined) o.wow = o.wobble; break;
    default:
  }
  return o;
}

class Runtime {
  constructor(def, fade, origin) { this.origin = origin || null; this.bornMs = performance.now(); this.retry = []; this.retryAt = 0; this.def = def; this.u = 0; this.target = 1; this.rate = 1 / Math.max(0.05, fade); this.state = 'loading'; this.beds = []; this.events = []; this.needs = []; this.out = null; this.born = 0; this.forceU = undefined; this.stats = { fired: 0 }; }
}

export class Ambience {
  constructor(engine) { this.e = engine; this.rts = []; this.presets = PRESETS; this.origin = { x: 0, y: 0, z: 0 }; this.wind = 0; this.loading = false; this.stats = { events: 0 }; this._byDef = new Map(); }
  /** local (stop) coordinates -> world */
  /** world position of a bed: [x,y,z] stop-local, or 'far' / 'around' (a fixed random spot 30-60 m / 6-14 m from the listener, chosen once per bed) */
  bedPos(def, L) { const p = def.pos; if (!p) return null; if (typeof p === 'string') return def._wp || (def._wp = this.place(p, { far: [30, 60], around: [6, 14], height: [1, 3] }, L)); return this.abs(p); }
  abs(p) { const o = this._o || this.origin; return { x: (p.x ?? p[0]) + o.x, y: (p.y ?? p[1]) + o.y, z: (p.z ?? p[2]) + o.z }; }
  setOrigin(o) { this.origin = { x: o.x ?? o[0] ?? 0, y: o.y ?? o[1] ?? 0, z: o.z ?? o[2] ?? 0 }; }
  _resolve(r) {
    if (!r) return null; if (typeof r === 'string') { const p = resolvePreset(r); if (!p) warnOnce('preset:' + r, `unknown ambience preset "${r}"`); return p; }
    const e = this.e, st = e._stopOfRecipe ? e._stopOfRecipe(r) : null; if (st && e.preferPresets !== false && !r.exact) return e._recipeFor(st) || r; // a stop's own authored recipe -> our calibrated preset for that stop (audio.preferPresets = false keeps the authored one)
    return r;
  }
  _find(def) { return this.rts.find((r) => r.def === def && r.target > 0) || null; }

  /** start a recipe (or preset name); everything else fades out over `fade` seconds. Returns the runtime handle. */
  set(recipe, fade = 2, opts = {}) {
    const def = this._resolve(recipe); if (!def) { this.stop(fade); return null; } const st0 = this.e._stopOfRecipe ? this.e._stopOfRecipe(recipe) : null, org = opts.origin || (st0 && st0.origin); if (org) this.setOrigin(org);
    let rt = this._find(def); if (rt) { rt.forceU = undefined; rt.rate = 1 / Math.max(0.05, fade); } else { rt = new Runtime(def, fade, { ...this.origin }); rt.born = this.e.time; this.rts.push(rt); this._needs(rt); }
    for (const r of this.rts) if (r !== rt) { r.target = 0; r.rate = 1 / Math.max(0.05, fade); r.forceU = undefined; }
    if (def.space && this.e && opts.space !== false) { if (!(this.e._spaceStamp && performance.now() - this.e._spaceStamp < 300)) this.e._stSpace = def.space; this.e.prepareSpaces([def.space]); } return rt; // an explicit setSpace() a moment ago (same tick) wins over the recipe's own room
  }
  /** continuous crossfade between two recipes, t in 0..1 (call every frame during a ride); afterwards call set(b) */
  blend(a, b, t, o) {
    const da = this._resolve(a), db = this._resolve(b); if (!da || !db) return; t = clamp(t, 0, 1);
    const ra = this._blendRt(da, o && o.originA), rb = this._blendRt(db, o && o.originB);
    ra.forceU = 1 - t; rb.forceU = t; ra.target = 1 - t > 0.001 ? 1 : 0; rb.target = 1; for (const r of this.rts) if (r !== ra && r !== rb) { r.target = 0; r.forceU = undefined; }
    if (this.e && (db.space || da.space)) this.e._stSpace = t < 0.5 ? da.space : db.space;
  }
  _blendRt(d, org) { let r = this._find(d); if (!r) { r = new Runtime(d, 1, org ? { x: org.x ?? org[0] ?? 0, y: org.y ?? org[1] ?? 0, z: org.z ?? org[2] ?? 0 } : { ...this.origin }); r.born = this.e.time; this.rts.push(r); this._needs(r); } return r; }
  stop(fade = 1.5) { for (const r of this.rts) { r.target = 0; r.rate = 1 / Math.max(0.05, fade); r.forceU = undefined; } }
  /** promise that resolves when all buffers the recipe needs are built (build is time-sliced through the library queue) */
  prepare(recipe) { const def = this._resolve(recipe); if (!def) return Promise.resolve(); if (def.space) this.e.prepareSpaces([def.space]); const rt = new Runtime(def, 1); this._needs(rt); const lib = this.e.lib; return new Promise((res) => { const chk = () => { if (rt.needs.every((n) => lib.variants(n).length > 0)) res(); else { lib.pump(6, 1); setTimeout(chk, 4); } }; chk(); }); }

  _needs(rt) {
    const lib = this.e.lib, def = rt.def; rt.needs = []; rt.beds.length = 0; rt.norm = []; rt.trim = 1;
    for (const b of def.beds || []) { const nb = normBed(b); if (!nb) { warnOnce('bed:' + b.type, `unknown bed type "${b.type}" ignored`); continue; } rt.norm.push(nb); if (nb.type === 'wind' || nb.type === 'rumble' || nb.type === 'noise' || (nb.type === 'water' && nb.kind === 'hiss')) rt.needs.push(this._noiseName(nb.type === 'noise' ? nb.color || 'white' : nb.type === 'rumble' ? 'brown' : nb.kind === 'hiss' ? 'white' : 'pink'), this._noiseName('white')); else if (nb.type === 'music') { /* phrases are generated on demand */ } else if (nb.type !== 'custom' && !(nb.type === 'water' && nb.kind === 'drip')) { const name = ensureBed(lib, nb); if (name) { rt.needs.push(name); nb._buf = name; } else warnOnce('bed2:' + nb.type + nb.kind, `bed "${nb.type}/${nb.kind}" is not buffer-backed`); } }
    rt.norm.forEach((nb) => { if (nb.type === 'wind') rt.needs.push(this._noiseName('pink'), this._noiseName('white')); });
    for (const ev of def.events || []) { if (ev.custom) continue; const t = eventType(ev.type); if (!EVENTS[t]) { warnOnce('evt:' + ev.type, `unknown event type "${ev.type}" ignored`); ev._skip = true; continue; } ev._t = t; const nm = 'amb.evt.' + t; lib.promote(nm, 1); rt.needs.push(nm); }
    for (const n of new Set(rt.needs)) this._ensureNoise(n); rt.needs = [...new Set(rt.needs)]; this.loading = true;
  }
  /**
   * Loudness normalisation for recipes we did not calibrate (stop-authored ones). Estimates the mean power the recipe will put out — beds (a bed of gain 1 sits at about -24 dBFS rms, beds add in
   * power, distant ones count less) plus one-shot events (energy of the real built buffers x gain^2 x the distance law at their typical placement / mean interval) — and pulls the result
   * 85 % of the way toward -32.5 dBFS, so no stop is inaudible or deafening. Called once the recipe's buffers exist.
   */
  _autoTrim(rt) {
    const def = rt.def; if (def.cal) return 1; const lib = this.e.lib, sr = this.e.ctx.sampleRate; let p = 0;
    for (const b of rt.norm || []) { const g = b.gain ?? 1, pf = typeof b.pos === 'string' ? (b.pos === 'far' ? 0.03 : 0.3) : b.pos ? 0.3 : 1; p += 0.00398 * g * g * pf * (b.type === 'music' ? 0.36 : 1); }
    for (const ev of def.events || []) {
      if (ev.custom || ev._skip || !ev._t) continue; const E = EVENTS[ev._t], meta = E.meta || {}, bufs = lib.variants('amb.evt.' + ev._t); if (!bufs.length) continue; const b = bufs[0], x = b.getChannelData(0); let e = 0; for (let k = 0; k < x.length; k++) e += x[k] * x[k]; e /= b.sampleRate || sr;
      const far = ev.pos === 'far' || (ev.pos === undefined && meta.far), d = Array.isArray(ev.pos) ? 18 : far ? (meta.far ? (meta.far[0] + meta.far[1]) / 2 : 130) : (meta.around ? (meta.around[0] + meta.around[1]) / 2 : 16), ref = meta.refDist ?? 8, f = Math.min(1, (ref / d) ** 2), per = ev.every ? (ev.every[0] + ev.every[1]) / 2 : 14, g = ev.gain ?? 1;
      p += e * g * g * f / per;
    }
    const est = 10 * Math.log10(Math.max(p, 1e-9) * (def.gain ?? 1) ** 2); return Math.pow(10, clamp(0.85 * (-32.5 - est), -14, 14) / 20);
  }
  _noiseName(c) { return 'amb.noise.' + c; }
  _ensureNoise(name) { const lib = this.e.lib; if (!name.startsWith('amb.noise.')) return; if (!lib.has(name)) { const color = name.slice(10); lib.def(name, { n: 1, sr: 32000, prio: 1, loop: true, norm: 'rms', rms: 0.25, meta: { bus: 'amb' }, remote: { fn: 'noise', args: { color } } }, (K) => { const L = 6, xf = 0.6, a = K.noise(L + xf, color); return K.makeLoop(a, xf); }); } else lib.promote(name, 1); }
  noiseSrc(color) { const e = this.e, b = e.lib.get(this._noiseName(color)) || (this._ensureNoise(this._noiseName(color)), e.lib.get(this._noiseName(color))); const s = e.ctx.createBufferSource(); let nb = Array.isArray(b) ? b[0] : b; if (nb.lazy) nb = nb.materialize(); s.buffer = nb; s.loop = true; s.start(0, Math.random() * s.buffer.duration); return s; }

  _activate(rt) {
    const e = this.e, ctx = e.ctx; rt.state = 'active'; rt.trim = this._autoTrim(rt); rt.out = ctx.createGain(); rt.out.gain.value = 1; rt.out.connect(e.buses.amb);
    for (const nb of rt.norm) { if (!this._bedReady(nb)) { rt.retry.push(nb); continue; } this._makeBed(rt, nb); }
    rt.events = (rt.def.events || []).filter((ev) => !ev._skip).map((ev) => ({ ev, next: e.time + (ev.delay ?? rand(0.3, 1.0) * (ev.every ? ev.every[0] : 5)) }));
    this.loading = this.rts.some((r) => r.state === 'loading');
  }
  /** are the noise loops a live bed reads from built? (workers deliver them asynchronously) */
  _bedReady(nb) { const lib = this.e.lib, has = (c) => lib.variants(this._noiseName(c)).length > 0; if (nb.type === 'wind') return has('pink') && has('white'); if (nb.type === 'rumble') return has('brown'); if (nb.type === 'noise') return has(nb.color || 'white'); if (nb.type === 'water' && nb.kind === 'hiss') return has('white'); return true; }
  _makeBed(rt, nb) { let bed = null; try { bed = createBed(this, rt, nb); } catch (err) { console.error('[audio.ambience] bed failed', nb.type, err); } if (bed) rt.beds.push(bed); }
  update(dt, L, st) {
    const e = this.e; if (!this.rts.length) return; if (st && st.wind !== undefined && st.wind !== null) { const w = st.wind; this.wind = typeof w === 'number' ? w : Array.isArray(w) ? Math.hypot(w[0] || 0, w[1] || 0, w[2] || 0) : Math.hypot(w.x || 0, w.y || 0, w.z || 0); }
    const t = e.time, lib = e.lib;
    for (let i = this.rts.length - 1; i >= 0; i--) {
      const rt = this.rts[i];
      if (rt.state === 'loading') { if (rt.needs.every((n) => lib.variants(n).length > 0) || performance.now() - rt.bornMs > 8000) this._activate(rt); else continue; }
      if (rt.forceU !== undefined) rt.u = clamp(rt.forceU, 0, 1); else rt.u += clamp(rt.target - rt.u, -rt.rate * dt, rt.rate * dt);
      const g = Math.sin(0.5 * Math.PI * clamp(rt.u, 0, 1)) * (rt.def.gain ?? 1) * (rt.trim ?? 1);
      if (rt.target === 0 && rt.u <= 0.001) { this._dispose(rt); this.rts.splice(i, 1); continue; }
      if (rt.retry.length && performance.now() > rt.retryAt) { rt.retryAt = performance.now() + 250; for (let k = rt.retry.length - 1; k >= 0; k--) if (this._bedReady(rt.retry[k])) this._makeBed(rt, rt.retry.splice(k, 1)[0]); } // beds whose noise loops were not built at activation
      this._o = rt.origin; for (const b of rt.beds) b.update(dt, t, g, L, st);
      if (g > 0.03) for (const s of rt.events) if (t >= s.next) { const ev = s.ev, every = ev.every || [8, 20]; s.next = t + rand(every[0], every[1]) / (0.5 + 0.5 * clamp(rt.u, 0.2, 1)); if (ev.chance === undefined || Math.random() < ev.chance) this._fire(rt, ev, g, L); }
    }
  }
  _dispose(rt) { for (const b of rt.beds) { try { b.dispose(); } catch (e) { /* ignore */ } } if (rt.out) { try { rt.out.disconnect(); } catch (e) { /* ignore */ } } }

  // ---- placement + firing of one-shot events
  place(spec, meta, L) {
    const R = (a, b) => rand(a, b);
    if (Array.isArray(spec)) return this.abs(spec); if (spec && typeof spec === 'object' && spec.x !== undefined) return this.abs(spec);
    const far = spec === 'far' || (spec === undefined && meta && meta.far && !meta.around), [d0, d1] = far ? (meta && meta.far) || [70, 190] : (meta && meta.around) || [7, 26], d = R(d0, d1), th = Math.random() * 6.2832, h = meta && meta.height ? R(meta.height[0], meta.height[1]) : (spec === 'above' ? R(8, 20) : R(0.3, 2.2));
    return { x: L.px + Math.sin(th) * d, y: L.py - 1.6 + h, z: L.pz - Math.cos(th) * d };
  }
  _fire(rt, ev, g, L) {
    const e = this.e; this.stats.events++; rt.stats.fired++;
    if (ev.custom) { try { ev.custom(this._api(rt, g, L)); } catch (err) { warnOnce('custom', 'custom event threw: ' + err); } return; }
    const type = ev._t, E = EVENTS[type], meta = E.meta || {}, pos = this.place(ev.pos, meta, L), pit = ev.pitch || [0.94, 1.06];
    e.play('amb.evt.' + type, { pos, vol: (ev.gain ?? 1) * g * (rt.def.eventGain ?? 1) * rand(0.7, 1.0), pitch: rand(pit[0], pit[1]), jitter: 0, bus: 'amb', minDist: ev.minDist, maxDist: ev.maxDist }); // (8+ variants per type x +-6 % pitch x 0.7..1 level: repeats are not recognisable)
  }
  _api(rt, g, L) {
    const e = this.e, self = this; return { audio: e, dsp, listener: L, level: g * (rt.def.eventGain ?? 1), time: e.time, origin: this.origin, rand, chance: (p) => Math.random() < p, pick: (a) => a[(Math.random() * a.length) | 0],
      around: (min = 7, max = 26, h = 1.2) => { const th = Math.random() * 6.2832, d = rand(min, max); return { x: L.px + Math.sin(th) * d, y: L.py - 1.6 + h, z: L.pz - Math.cos(th) * d }; },
      far: (min = 70, max = 190, h = 2) => { const th = Math.random() * 6.2832, d = rand(min, max); return { x: L.px + Math.sin(th) * d, y: L.py - 1.6 + h, z: L.pz - Math.cos(th) * d }; },
      play: (nameOrBuf, o = {}) => e.play(typeof nameOrBuf === 'string' && !e.lib.has(nameOrBuf) && e.lib.has('amb.evt.' + eventType(nameOrBuf)) ? 'amb.evt.' + eventType(nameOrBuf) : nameOrBuf, { bus: 'amb', vol: g * (rt.def.eventGain ?? 1), ...o, pos: o.pos ? (Array.isArray(o.pos) ? self.abs(o.pos) : o.pos) : o.pos }) };
  }
}

// ------------------------------------------------------------------------------------------------------------------------ beds
function createBed(A, rt, nb) {
  switch (nb.type) {
    case 'wind': return new WindBed(A, rt, nb);
    case 'rumble': return new RumbleBed(A, rt, nb);
    case 'noise': return new NoiseBed(A, rt, nb);
    case 'music': return new MusicBed(A, rt, nb);
    case 'water': if (nb.kind === 'hiss') return new NoiseBed(A, rt, { color: 'white', hp: nb.hp ?? 2500, lp: nb.lp ?? 9000, mod: nb.mod ?? 0.15, depth: nb.depth ?? 0.4, gain: nb.gain }); if (nb.kind === 'drip') return new DripBed(A, rt, nb); return new BufferBed(A, rt, nb);
    case 'custom': return nb.build ? nb.build(A, rt) : null;
    default: return nb._buf ? new BufferBed(A, rt, nb) : null;
  }
}
class BufferBed {
  constructor(A, rt, def) { this.A = A; this.rt = rt; this.def = def; this.name = def._buf; this.h = null; this.g = 0; this.retry = 0; }
  update(dt, t, g, L) {
    const e = this.A.e, target = g * (this.def.gain ?? 1) * (this.def.trim ?? 0.75); // calibration: gain 1 ~ -24 dBFS rms
    if (!this.h || !this.h.playing) { if (t < this.retry) return; const pos = this.A.bedPos(this.def, L); this.h = e.play(this.name, { loop: true, vol: Math.max(target, 0.0001), bus: 'amb', pos, offset: 'random', jitter: 0, prio: 2, send: this.def.send ?? (pos ? 1 : 0.5), minDist: this.def.minDist ?? 6, maxDist: this.def.maxDist ?? 140, name: 'amb.bed.' + this.name, pitch: this.def.pitch ?? 1 }); this.g = target; this.retry = t + 0.5; }
    else if (Math.abs(target - this.g) > 0.004 * (target + 0.02)) { this.h.setVol(Math.max(target, 0.0001), 0.2); this.g = target; }
  }
  dispose() { if (this.h) this.h.stop(0.05); }
}
class LiveBed { // shared helpers for noise-graph beds
  constructor(A, rt) { this.A = A; this.rt = rt; this.ctx = A.e.ctx; this.nodes = []; this.srcs = []; this.out = this.ctx.createGain(); this.out.gain.value = 0; this.out.connect(rt.out); this.g = -1; }
  node(n) { this.nodes.push(n); return n; }
  src(color) { const s = this.A.noiseSrc(color); this.srcs.push(s); return s; }
  filt(type, f, q) { const b = this.node(this.ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v = 0) { const g = this.node(this.ctx.createGain()); g.gain.value = v; return g; }
  set(param, v, tc = 0.1) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }
  setOut(g) { if (Math.abs(g - this.g) > 0.003 * (g + 0.01)) { this.out.gain.setTargetAtTime(g, this.ctx.currentTime, 0.12); this.g = g; } }
  dispose() { for (const s of this.srcs) { try { s.stop(); s.disconnect(); } catch (e) { /* */ } } for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* */ } } try { this.out.disconnect(); } catch (e) { /* */ } }
}
class WindBed extends LiveBed {
  constructor(A, rt, d) {
    super(A, rt); this.d = d; this.base = d.speed ?? 0.5; this.gust = d.gust ?? 0.4; this.whistle = d.whistle ?? 0.3; this.howl = d.howl ?? 0.2; this.bright = d.bright ?? 0.5; this.u = this.base; this.ou = 0; this.gs = 0; this.nextGust = rand(2, 6); this.acc = 0; this.wt = Math.random() * 100;
    const mix = this.gain(1); mix.connect(this.out);
    this.body = this.filt('lowpass', 400, 0.6); this.gb = this.gain(0); this.src('pink').connect(this.body); this.body.connect(this.gb); this.gb.connect(mix);
    this.hpf = this.filt('highpass', 500, 0.5); this.mid = this.filt('bandpass', 1500, 0.8); this.gm = this.gain(0); this.src('white').connect(this.hpf); this.hpf.connect(this.mid); this.mid.connect(this.gm); this.gm.connect(mix);
    this.wh = [0, 1, 2].map((k) => { const bp = this.filt('bandpass', [620, 1150, 2000][k], 28 + 10 * k), g = this.gain(0); this.src(k === 1 ? 'pink' : 'white').connect(bp); bp.connect(g); g.connect(mix); return { bp, g, f: [620, 1150, 2000][k] * (d.pitch ?? 1), ph: Math.random() * 6.28, rate: rand(0.08, 0.25) }; });
    this.hw = this.filt('bandpass', 170, 4); this.gh = this.gain(0); this.src('pink').connect(this.hw); this.hw.connect(this.gh); this.gh.connect(mix);
  }
  update(dt, t, g, L, st) {
    this.setOut(g * 0.7 * (this.d.gain ?? 1)); this.acc += dt; this.wt += dt; if (this.acc < 0.07) return; const step = this.acc; this.acc = 0;
    const follow = this.d.follow === false ? 1 : clamp(this.A.wind > 0 ? this.A.wind / (this.d.refWind ?? 6) : 1, 0.35, 1.8);
    this.ou += (-this.ou * 0.35 * step) + (Math.random() - 0.5) * 0.5 * Math.sqrt(step); this.nextGust -= step; if (this.nextGust <= 0) { this.gs = 1; this.nextGust = rand(3, 9) / (0.3 + this.gust); }
    this.gs = Math.max(0, this.gs - step / rand(2.2, 3.6)); const gustE = this.gs > 0.5 ? 1 : Math.sin(this.gs * Math.PI);
    const u = clamp(this.base * follow * (1 + 0.35 * this.ou * (0.5 + this.gust)) + this.gust * 0.55 * gustE, 0.02, 1.5); this.u += (u - this.u) * 0.5; const uu = this.u;
    this.set(this.body.frequency, 200 + 1700 * Math.pow(uu, 1.3) * (0.5 + this.bright)); this.set(this.gb.gain, 0.16 + 0.75 * Math.pow(uu, 1.25));
    this.set(this.mid.frequency, 800 + 2600 * uu * (0.5 + this.bright)); this.set(this.gm.gain, 0.5 * Math.pow(uu, 2) * (0.4 + this.bright));
    for (const w of this.wh) { const fw = w.f * (0.75 + 0.55 * uu) * (1 + 0.05 * Math.sin(this.wt * w.rate * 6.28 + w.ph)); this.set(w.bp.frequency, fw); this.set(w.g.gain, this.whistle * 0.55 * Math.pow(uu, 2.6) * (0.5 + 0.5 * Math.sin(this.wt * w.rate * 3 + w.ph * 2)) ** 2); }
    this.set(this.hw.frequency, 150 + 110 * uu); this.set(this.gh.gain, this.howl * 0.5 * Math.pow(uu, 1.6) * (0.6 + 0.4 * Math.sin(this.wt * 0.31 + 1)));
  }
}
class RumbleBed extends LiveBed {
  constructor(A, rt, d) { super(A, rt); this.d = d; const lp = this.filt('lowpass', d.freq ?? 90, 0.7); this.lp2 = this.filt('lowpass', (d.freq ?? 90) * 1.6, 0.5); this.src('brown').connect(lp); lp.connect(this.lp2); this.gm = this.gain(1); this.lp2.connect(this.gm); this.gm.connect(this.out); this.ph = Math.random() * 6.28; this.t = 0; if (d.sub) { const o = this.node(this.ctx.createOscillator()); o.frequency.value = d.sub; const og = this.gain(0.35); o.connect(og); og.connect(this.gm); o.start(); this.srcs.push(o); } }
  update(dt, t, g) { this.setOut(g * 0.37 * (this.d.gain ?? 1)); this.t += dt; const th = this.d.throb ?? 0.1, dep = this.d.depth ?? 0.4; this.gm.gain.value = 1 + dep * (Math.sin(this.t * 6.28 * (this.d.rate ?? 0.13) + this.ph) * 0.6 + Math.sin(this.t * 6.28 * 0.037 + this.ph * 2) * 0.4) * (th > 0 ? 1 : 0); }
}
class NoiseBed extends LiveBed {
  constructor(A, rt, d) { super(A, rt); this.d = d; let n = this.src(d.color || 'white'); const chain = []; if (d.hp) chain.push(this.filt('highpass', d.hp, 0.7)); if (d.lp) chain.push(this.filt('lowpass', d.lp, 0.7)); if (d.bp) chain.push(this.filt('bandpass', d.bp, d.q ?? 1)); const amp = this.gain(1); this.amp = amp; for (const f of chain) { n.connect(f); n = f; } n.connect(amp); amp.connect(this.out);
    if (d.mod) { const lfo = this.node(this.ctx.createOscillator()); lfo.frequency.value = d.mod; const lg = this.gain((d.depth ?? 0.4) * 0.5); lfo.connect(lg); lg.connect(amp.gain); amp.gain.value = 1 - (d.depth ?? 0.4) * 0.5; lfo.start(); this.srcs.push(lfo); } }
  update(dt, t, g) { this.setOut(g * (this.d.trim ?? 0.35) * (this.d.gain ?? 1)); }
}
class DripBed { // water dripping at `rate` per second inside the space (positional around the listener)
  constructor(A, rt, d) { this.A = A; this.rt = rt; this.d = d; this.next = 0; this.A.e.lib.promote('amb.evt.drip', 1); }
  update(dt, t, g, L) { if (t < this.next) return; this.next = t + rand(0.6, 1.6) / (this.d.rate ?? 0.6) / (0.4 + (this.d.intensity ?? 0.6)); if (g > 0.02) this.A.e.play('amb.evt.drip', { pos: this.A.place(this.d.pos || 'around', { around: [2, 16], height: [0, 2.5] }, L), vol: g * (this.d.gain ?? 1) * 1.3, pitch: rand(0.85, 1.2), bus: 'amb', jitter: 0 }); }
  dispose() {}
}
class MusicBed { // generative retro music: phrase after phrase, each composed and rendered (time-sliced) while the previous one plays
  constructor(A, rt, d) { this.A = A; this.rt = rt; this.d = d; const tk = d.kind || d.style, tobj = d.tune && typeof d.tune === 'object' ? d.tune : null; this.tune = tobj || (TUNES[d.tune] ? d.tune : (tk ? Object.keys(TUNES).find((k) => TUNES[k].kind === tk) : null) || 'carousel'); this.kind = tk || (tobj ? tobj.kind || tobj.style : null) || TUNES[this.tune].kind || 'musicbox'; this.h = null; this.pend = null; this.startAt = A.e.time + (d.delay ?? 0.5); this.endT = 0; this.uid = Math.floor(Math.random() * 1e9); this.n = 0; this.cur = null; this.g = 0; }
  _request() {
    const lib = this.A.e.lib, d = this.d, name = `amb.phrase.${this.uid}.${this.n++}`, sr = instrumentSr(this.kind), seed = (this.uid + this.n * 7919) >>> 0;
    const tb = typeof this.tune === 'object' ? this.tune : null, popts = { tune: this.tune, kind: this.kind, seed, detune: d.detune ?? (tb && tb.detune) ?? 16, wow: Math.min(1.5, d.wow ?? d.wobble ?? (tb && tb.wobble) ?? 0.5), tempo: d.tempo ?? (d.bpm || undefined), root: d.root, mode: d.mode }; lib.def(name, { n: 1, sr, prio: 1, norm: 'rms', rms: 0.14, meta: { bus: 'music', prio: 4 }, seed, remote: { fn: 'phrase', args: { sr, opts: popts } } }, () => renderPhrase(sr, popts)); this.pend = name;
  }
  update(dt, t, g, L) {
    const e = this.A.e, lib = e.lib; if (!this.pend && (!this.h) && t >= this.startAt - 12) this._request();
    if (this.pend && t >= this.startAt && lib.variants(this.pend).length > 0) { const buf = lib.variants(this.pend)[0], pos = this.A.bedPos(this.d, L); const name = this.pend; this.pend = null;
      this.h = e.play(buf, { bus: 'music', pos, vol: Math.max(g * (this.d.gain ?? 1) * 0.6, 0.0001), prio: 4, send: this.d.send ?? 0.7, minDist: this.d.minDist ?? 8, maxDist: this.d.maxDist ?? 160, jitter: 0, name: 'music.phrase', pitch: 1 }); this.g = g * (this.d.gain ?? 1) * 0.6;
      if (this.cur) lib.drop(this.cur); this.cur = name; const gap = this.d.gap || [1.5, 6]; this.endT = t + buf.duration; this.startAt = this.endT - 1.0 + rand(gap[0], gap[1]); this.next = this.startAt - 14; if (this.h) this.h.dur = buf.duration; }
    else if (this.h && this.h.playing) { const target = Math.max(g * (this.d.gain ?? 1) * 0.6, 0.0001); if (Math.abs(target - this.g) > 0.005 * (target + 0.02)) { this.h.setVol(target, 0.2); this.g = target; } }
    if (!this.pend && this.h && t >= (this.next ?? 0) && t < this.startAt) this._request();
  }
  dispose() { if (this.h) this.h.stop(0.3); if (this.cur) this.A.e.lib.drop(this.cur); if (this.pend) this.A.e.lib.drop(this.pend); }
}
