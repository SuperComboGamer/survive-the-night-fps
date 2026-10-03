// Audio sandbox.   ?sandbox=audio               interactive panel (buttons for every sound, spaces, ambience recipes, zombie voices, vehicle loops)
//                  ?sandbox=audio&mode=analyze   automated offline analysis (used by tools/audio-analyze.mjs): renders spaces / library / voices / ambience through the
//                                                real engine graph in an OfflineAudioContext and fills window.__report / window.__images, then sets window.__ready.
import * as dsp from '../core/dsp.js';
import { AudioEngine, audio as globalAudio, SPACES } from '../core/audio.js';
import { Library, LazyBuf } from '../core/sfx/library.js';
import { installAll } from '../core/sfx/index.js';
import * as A from './audio-analysis.js';

const SR = 48000;
const log = (...a) => console.log('[audio-sandbox]', ...a);

export async function run(gfx, P) {
  const mode = P.get('mode') || 'ui';
  if (mode === 'analyze') await analyze(P); else await ui(P);
}

// ---------------------------------------------------------------------------------------------------------------- helpers
export function shotBuffer(ctx) { // synthetic gunshot burst used for all room tests: 1 ms click + 30 ms noise burst + LF thump (short so RT60 measures the space, not the source)
  const K = dsp.kit(ctx, 99), s = K.buf(0.25);
  K.mix(s, K.burst(0.0012, { atk: 0.00002, tau: 0.0004 }), 1, 0); K.mix(s, K.burst(0.05, { atk: 0.0002, tau: 0.008, hp: 200, lp: 9000 }), 0.8, 0); K.mix(s, K.thump(0.1, 140, 60, 0.02, 0.025), 0.7, 0);
  return K.out(s, { peak: 0.9 });
}
const mono = (b) => { const L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L, o = new Float32Array(L.length); for (let i = 0; i < L.length; i++) o[i] = 0.5 * (L[i] + R[i]); return o; };
const sub = (a, b) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - b[i]; return o; };
const energy = (x, i0 = 0, i1 = x.length) => { let e = 0; for (let i = i0; i < i1; i++) e += x[i] * x[i]; return e; };
const dbf = (v) => 10 * Math.log10(v + 1e-30);
const LISTENER = { pos: { x: 0, y: 1.7, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };

/** Render `seconds` through a fresh engine on an OfflineAudioContext. setup(eng, oc) schedules sounds; step(t, eng) is called every `dt` seconds of rendered time. */
export async function offlineRender(seconds, setup, opts = {}) { // (a stalled render on the shared, heavily loaded machine is retried once with a fresh context)
  for (let attempt = 0; ; attempt++) { try { return await offlineRenderOnce(seconds, setup, opts, attempt ? 120000 : 45000); } catch (e) { if (attempt >= 1 || !/stalled/.test(String(e))) throw e; log('offline render stalled, retrying once:', String(e.message || e).slice(0, 120)); } }
}
async function offlineRenderOnce(seconds, setup, { lib = null, measure = true, dt = 0, step = null, listener = LISTENER, channels = 2 } = {}, watchdogMs = 120000) {
  const oc = new OfflineAudioContext(channels, Math.ceil(seconds * SR), SR), eng = new AudioEngine(lib || sharedLib()); await eng.init({ ctx: oc, sync: true, measure, noBackground: true });
  eng.update(0.016, listener); await setup(eng, oc); let reached = 0, callbacks = 0;
  if (step && dt > 0) for (let k = 1; k * dt < seconds - 0.05; k++) { const t = k * dt; oc.suspend(t).then(() => { callbacks++; reached = t; try { eng.update(dt, listener); step(oc.currentTime, eng); } catch (e) { console.error('offline step failed at', t, e && e.stack || e); } finally { oc.resume(); } }).catch((e) => console.error('suspend rejected', t, e)); }
  const buf = await Promise.race([oc.startRendering(), new Promise((_, rej) => setTimeout(() => rej(new Error(`offline render stalled: reached ${reached}s of ${seconds}s after ${callbacks} callbacks (ctx ${oc.state})`)), watchdogMs))]); return { buf, eng };
}
let _lib = null;
export function sharedLib() { if (!_lib) { const oc = new OfflineAudioContext(2, 1024, SR); _lib = new Library(oc); installAll(_lib); } return _lib; }
function pngURL(rgba, w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0); return c.toDataURL('image/png'); }
const images = () => (window.__images = window.__images || []);
const addImage = (name, img) => { images().push({ name, url: pngURL(img.data, img.w, img.h) }); };

// ---------------------------------------------------------------------------------------------------------------- analysis
async function analyze(P) {
  const only = new Set((P.get('only') || 'init,spaces,engine,integration,vevents,mix,realtime,cap,clip,library,voices,casting,ambience,maprecipes,vehicles,levels').split(',')), R = (window.__report = {}); window.__images = [];
  const step = async (name, fn) => { if (!only.has(name)) return; const t0 = performance.now(); log('>>', name); try { R[name] = await fn(); } catch (e) { R[name] = { error: String(e && e.stack || e) }; console.error(name, e); } log('<<', name, ((performance.now() - t0) / 1000).toFixed(1) + 's'); };
  await step('init', testInit); await step('spaces', testSpaces); await step('engine', testEngine); await step('integration', testIntegration); await step('vevents', testVehicleEvents); await step('mix', testMix); await step('calib', testCalib); await step('chain', testChain); await step('realtime', async () => { let best = null; for (let k = 0; k < 3; k++) { const r = await testRealtime(); r.attempt = k + 1; const ok = r.checks.filter((c) => c.ok).length; if (!best || ok > best.ok) best = { r, ok }; if (ok === r.checks.length) break; } best.r.tables = `[best of up to 3 attempts on a shared, loaded machine: attempt ${best.r.attempt}] ` + best.r.tables; return best.r; }); await step('cap', testVoiceCap); await step('clip', testClipping); await step('library', () => testLibrary(P));
  await step('voices', () => testVoices(P)); await step('casting', testVoiceCasting); await step('ambience', () => testAmbience(P)); await step('maprecipes', () => testMapRecipes(P)); await step('vehicles', () => testVehicles(P)); await step('levels', testLevels);
  window.__ready = true;
}

/** cold init timing (fresh library + engine), with synthesis workers and with main-thread time-slicing only. A 4 ms heartbeat measures real main-thread stalls. */
async function testInit() {
  const R = {}, attempts = []; // timing on a shared, loaded machine is noisy: the workers run is repeated (max 3) until it is clean and the best one is reported (all attempts are listed)
  for (const mode of ['workers', 'workers', 'workers', 'main']) {
    if (mode === 'workers' && R.workers && R.workers.stallPreload === 0 && R.workers.preloadMs < 3000) continue;
    const oc = new OfflineAudioContext(2, 4800, SR), lib = new Library(oc), eng = new AudioEngine(lib); let last = performance.now(), maxGap = 0, longTasks = 0, phase = 'init'; const gaps = []; const hb = setInterval(() => { const n = performance.now(), g = n - last; last = n; if (g > maxGap) maxGap = g; if (g > 20) { longTasks++; gaps.push(`${phase}:${g.toFixed(0)}ms@${(n - t0).toFixed(0)}`); } }, 4);
    const t0 = performance.now(); await eng.init({ ctx: oc, workers: mode === 'workers', noWorkers: mode !== 'workers', noBackground: true }); const initMs = performance.now() - t0, jobsAtInit = lib.stats.jobs, gapInit = maxGap; phase = 'preload';
    const t1 = performance.now(); await eng.preload(1, 6); const preloadMs = performance.now() - t1; phase = 'lazy'; const t2 = performance.now(); await eng.preload(0, 6); const lazyMs = performance.now() - t2; clearInterval(hb);
    let bytes = 0, bufs = 0; for (const d of lib.defs.values()) for (const b of d.out || []) { bytes += b.length * b.numberOfChannels * 4; bufs++; }
    R[mode] = { initMs, preloadMs, lazyMs, totalMs: initMs + preloadMs + lazyMs, coreMs: initMs + preloadMs, stallPreload: gaps.filter((g) => g.startsWith('preload')).length, maxStallInit: Math.max(0, ...gaps.filter((g) => g.startsWith('init')).map((g) => +g.split(':')[1].split('ms')[0])), stallCore: gaps.filter((g) => !g.startsWith('lazy')).length, maxStallCore: Math.max(0, ...gaps.filter((g) => !g.startsWith('lazy')).map((g) => +g.split(':')[1].split('ms')[0])), workerMs: lib.stats.workerMs, maxWorkerJobMs: lib.stats.maxWorkerJobMs, byFam: lib.stats.byFam || {}, jobsAtInit, buffers: bufs, memoryMB: bytes / 1048576, maxStallMs: maxGap, maxStallInitMs: gapInit, longTasks, gaps: gaps.slice(0, 12), slowJobs: lib.stats.slowJobs, maxJobMs: lib.stats.maxJobMs, maxSliceMs: lib.stats.maxSliceMs, remote: lib.stats.remote, local: lib.stats.local, maxStoreMs: lib.stats.maxStoreMs, maxStoreName: lib.stats.maxStoreName, workersUsed: !!eng.workersUsed };
    lib.stopWorkers(); if (mode === 'workers') { attempts.push(`init ${initMs.toFixed(0)} ms, background ${preloadMs.toFixed(0)} ms, ${R[mode].stallPreload} stalls > 20 ms while building (max ${R[mode].maxStallCore.toFixed(0)} ms)`); const prev = R._best; const sc = (r) => (r.initMs > 1500 ? 1e6 : 0) + r.stallPreload * 1000 + r.preloadMs; if (!prev || sc(R[mode]) < sc(prev)) R._best = R[mode]; R.workers = R._best; }
  }
  return { ...R.workers, workers: R.workers, main: R.main, attempts, ctxRealtime: await realtimeProbe() };
}
async function realtimeProbe() { try { const a = new AudioContext(), t0 = a.currentTime; await new Promise((r) => setTimeout(r, 250)); const o = { sr: a.sampleRate, state: a.state, advanced: a.currentTime - t0, baseLatency: a.baseLatency }; a.close(); return o; } catch (e) { return { error: String(e) }; } }

/** every space: RT60 (Schroeder, wet-only and total), octave-band RT60, centroid, HF roll-off, wet/dry energy ratio at 5 m and 25 m */
async function testSpaces() {
  const shot = shotBuffer(new OfflineAudioContext(1, 128, SR)), rows = [], edcAll = [], sheetItems = [], lib = sharedLib(); lib.drain(3);
  const srcM = new Float32Array(shot.getChannelData(0)), srcSp = A.spectralStats(srcM, SR), srcHF = srcSp.band(4000, 24000) / (srcSp.band(20, 500) || 1);
  for (const id of Object.keys(SPACES)) {
    let setMs = 0; const run = async (dist, wet) => (await offlineRender(7.5, (eng) => { const tsp = performance.now(); eng.setSpace(id, 0); setMs = Math.max(setMs, performance.now() - tsp); eng.update(0.016, LISTENER); if (!wet) eng.revSend.gain.value = 0; eng.play(shot, { pos: { x: 0, y: 1.7, z: -dist }, bus: 'weapon', vol: 1, jitter: 0, hrtf: false, minDist: 3, maxDist: 400, name: 'test' }); })).buf;
    const f8 = await run(5, true), d8 = await run(5, false), f25 = await run(25, true), d25 = await run(25, false);
    const F = mono(f8), D = mono(d8), W = sub(F, D), W25 = sub(mono(f25), mono(d25)), D25 = mono(d25);
    // reverb-to-direct energy ratio in the 250 Hz..4 kHz band, summed over both ears (the definition of `wet` in the space table)
    const band = (x) => { const y = Float32Array.from(x); dsp.biquadInPlace(y, 'hp', 250, 0.7071, SR); dsp.biquadInPlace(y, 'hp', 250, 0.7071, SR); dsp.biquadInPlace(y, 'lp', 4000, 0.7071, SR); dsp.biquadInPlace(y, 'lp', 4000, 0.7071, SR); return y; };
    const ratio = (full, dry) => { let ew = 0, ed = 0; for (let c = 0; c < 2; c++) { const fa = full.getChannelData(c), da = dry.getChannelData(c), w = band(sub(fa, da)), d = band(da); ew += energy(w); ed += energy(d); } return ew / (ed || 1e-20); };
    const eW = ratio(f8, d8), eD = 1, eW25 = ratio(f25, d25);
    const rtFull = A.rt60(F, SR), rtWet = A.rt60(W, SR), bands = A.rt60Bands(W, SR), spF = A.spectralStats(F, SR), spD = A.spectralStats(D, SR), spW = A.spectralStats(W, SR);
    const hf = (sp) => sp.band(4000, 24000) / (sp.band(20, 500) || 1);
    rows.push({ id, setMs, irSec: (lib.get('ir.' + id) || { duration: 0 }).duration, rt60Full: rtFull.rt60, rt60Wet: rtWet.rt60, edtWet: rtWet.edt, bands: bands.map((b) => +b.rt60.toFixed(2)), centroidFull: spF.centroid, centroidDry: spD.centroid, centroidWet: spW.centroid, centroidSrc: srcSp.centroid, hfRolloffDryDb: dbf(hf(spD)) - dbf(srcHF), hfRolloffFullDb: dbf(hf(spF)) - dbf(srcHF), wetDry5: eW, wetDry25: eW25, wetTarget: SPACES[id].wet, dryPeak5: A.levelStats(D, SR).peak, tailMs: (() => { const n = W.length; let i = n - 1; const thr = A.levelStats(W, SR).peak * 0.001; while (i > 0 && Math.abs(W[i]) < thr) i--; return i / SR * 1000; })() });
    edcAll.push({ id, db: rtFull.db, dbWet: rtWet.db });
    if (['open', 'mineShaft', 'snow', 'tunnel', 'crystalCavern', 'prison'].includes(id)) sheetItems.push({ name: `gunshot @8m in ${id}`, x: F.subarray(0, Math.floor(SR * 4.5)), sr: SR, note: `RT60 wet ${rtWet.rt60.toFixed(2)}s full ${rtFull.rt60.toFixed(2)}s` });
  }
  addImage('spaces_gunshot_spectrograms', A.contactSheet(sheetItems, { cols: 2, tileW: 520, tileH: 200, fmax: 20000 }));
  // decay curves
  const mk = (ids, title, useWet) => { const pick = edcAll.filter((e) => ids.includes(e.id)); addImage(title, A.plotLines(pick.map((e) => ({ name: e.id, y: useWet ? e.dbWet : e.db, rate: SR })), { w: 900, h: 320, xmin: 0, xmax: 6, ymin: -70, ymax: 0, title })); };
  mk(['mineShaft', 'tunnel', 'flooded', 'crystalCavern', 'castle', 'magmaChamber'], 'edc_enclosed_wet', true); mk(['open', 'openDusk', 'snow', 'blizzard', 'pier', 'wharf', 'cove', 'summit'], 'edc_open_wet', true); mk(['prison', 'plaza', 'space', 'whiteoutStation', 'lighthouse', 'cage', 'ferry'], 'edc_misc_wet', true);
  return { rows, srcCentroid: srcSp.centroid, srcHF: dbf(srcHF) };
}

/** bed calibration: RMS (dBFS) of every bed type at gain 1 in the open space — the convention is that gain 1 ~ -24 dBFS so recipe gains read like mixer faders */
async function testCalib() {
  const beds = { 'wind (speed .5)': { type: 'wind', speed: 0.5 }, 'wind (speed .9)': { type: 'wind', speed: 0.9, gust: 0.8, whistle: 0.7 }, 'wind (speed .15)': { type: 'wind', speed: 0.15 }, 'rumble 90': { type: 'rumble', freq: 90 }, 'noise white': { type: 'noise', color: 'white' }, 'noise pink lp800': { type: 'noise', color: 'pink', lp: 800 }, 'noise white hp3000': { type: 'noise', color: 'white', hp: 3000 }, 'noise brown lp200': { type: 'noise', color: 'brown', lp: 200 }, 'noise pink bp900': { type: 'noise', color: 'pink', bp: 900, q: 0.5 }, 'hiss': { type: 'water', kind: 'hiss' }, 'hum 50': { type: 'hum', freq: 50 }, 'drone 55': { type: 'drone', freq: 55 }, 'insects': { type: 'insects' }, 'water lap': { type: 'water', kind: 'lap' }, 'water stream': { type: 'water', kind: 'stream' }, 'water surf': { type: 'water', kind: 'surf' }, 'water waves': { type: 'water', kind: 'waves' }, 'water rain': { type: 'water', kind: 'rain' }, 'water bubbles': { type: 'water', kind: 'bubbles' }, 'crackle fire': { type: 'crackle', kind: 'fire' }, 'crackle ice': { type: 'crackle', kind: 'ice' }, 'machine diesel': { type: 'machine', kind: 'diesel' }, 'machine gears': { type: 'machine', kind: 'gears' }, 'machine steam': { type: 'machine', kind: 'steam' }, 'machine motor': { type: 'machine', kind: 'motor' }, 'machine fan': { type: 'machine', kind: 'fan' }, 'machine pump': { type: 'machine', kind: 'pump' }, 'machine generator': { type: 'machine', kind: 'generator' }, 'music calliope': { type: 'music', kind: 'calliope', tune: 'carousel', delay: 0.1 }, 'music musicbox': { type: 'music', kind: 'musicbox', tune: 'lullaby', delay: 0.1 }, 'music organ': { type: 'music', kind: 'organ', tune: 'dirge', delay: 0.1 }, 'music accordion': { type: 'music', kind: 'accordion', tune: 'waltz', delay: 0.1 }, 'music synth': { type: 'music', kind: 'synth', tune: 'space', delay: 0.1 } };
  const rows = []; for (const [name, bed] of Object.entries(beds)) { const { buf } = await offlineRender(10, (eng) => { eng.ambience.set({ space: 'open', beds: [{ ...bed, gain: 1 }], events: [] }, 0.05); eng.lib.drain(0); }, { measure: true, dt: 0.05, step: () => {} }); const x = mono(buf), seg = x.subarray(3 * SR, 10 * SR), st = A.levelStats(seg, SR), sp = A.spectralStats(seg, SR); rows.push({ name, rms: st.rmsDb, cent: sp.centroid }); }
  return { rows, tables: table(rows, [{ h: 'bed at gain 1', f: (r) => r.name, left: 1 }, { h: 'rms dBFS', f: (r) => fx(r.rms) }, { h: 'centroid', f: (r) => fx(r.cent, 0) }]) };
}

/** master chain transfer curve: 1 kHz tone through the UI bus (unity) at -60..+6 dBFS, full chain (glue comp + limiter + soft clip). Shows makeup gain, compression and the ceiling. */
async function testChain() {
  const oc0 = new OfflineAudioContext(1, 128, SR), rows = [], lib = sharedLib(); const tone = dsp.toBuffer(oc0, dsp.normalizeTo(dsp.kit(oc0, 1).tone(1.5, 1000, { tau: 1e6, atk: 0.0005 }), 1.0), SR);
  for (const db of [-60, -48, -36, -30, -24, -18, -12, -6, 0, 6, 12]) { const { buf, eng } = await offlineRender(1.6, (e) => { e.play(tone, { bus: 'ui', vol: Math.pow(10, db / 20) / 0.9, jitter: 0, name: 't' }); }, { measure: false }); const x = mono(buf).subarray(Math.floor(0.6 * SR), Math.floor(1.4 * SR)), st = A.levelStats(x, SR), inRms = db - 3.01; rows.push({ inDb: db, outPeak: st.peakDb, outRms: st.rmsDb, gain: st.rmsDb - inRms }); }
  return { rows, tables: table(rows, [{ h: 'in peak dBFS', f: (r) => r.inDb }, { h: 'out peak', f: (r) => fx(r.outPeak) }, { h: 'out rms', f: (r) => fx(r.outRms) }, { h: 'gain dB (rms)', f: (r) => fx(r.gain, 2) }]) };
}

/** real-time engine (real AudioContext + synthesis workers): init time, audio flows, deferred first plays, update() cost with ~35 voices, per-frame heap allocation */
async function testRealtime() {
  const eng = new AudioEngine(), checks = [], sleep = (ms) => new Promise((r) => setTimeout(r, ms)), t0 = performance.now(); await eng.init(); const initMs = performance.now() - t0;
  const an = eng.ctx.createAnalyser(); an.fftSize = 2048; eng.master.connect(an); const buf = new Float32Array(2048); const rmsNow = () => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return 10 * Math.log10(s / buf.length + 1e-14); };
  const L = { pos: { x: 0, y: 1.7, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } }, st = { space: 'mineShaft' }; const tp = performance.now(); await eng.prepareSpaces(['mineShaft']); const prepMs = performance.now() - tp; eng.update(0.016, L, st);
  const noise = eng.ctx.createBuffer(1, 48000, 48000), nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.05;
  eng.ambience.set('shaft-nine.tunnels', 0.5); const r = new dsp.Rng(5); for (let i = 0; i < 30; i++) eng.play(noise, { loop: true, pos: { x: r.range(-25, 25), y: 1, z: r.range(-25, 25) }, name: 'load' + i, prio: 3 + (i % 3), jitter: 0 });
  const cold = ['impact.ice', 'step.lava.walk.L', 'glass.break', 'casing.brass.gravel', 'melee.hit'], before = eng.stats.played; for (const n of cold) eng.play(n, { pos: { x: 2, y: 1, z: -4 } });
  const matT = [], lazyQ0 = eng.lib._lazyQ.length, mz = LazyBuf.prototype.materialize; LazyBuf.prototype.materialize = function () { const tt = performance.now(), r = mz.call(this); matT.push(performance.now() - tt); return r; }; const deferred0 = eng.stats.deferred || 0, durs = []; let flow = -200, tick = 0; const worst = []; for (let f = 0; f < 420; f++) { const t = performance.now(); eng.update(0.016, L, st); const dm = performance.now() - t; durs.push(dm); if (dm > 8) worst.push(`f${f}:${dm.toFixed(0)}ms`); if (f % 12 === 0) { flow = Math.max(flow, rmsNow()); } if (f === 60) eng.explosion({ x: 3, y: 1.5, z: -9 }, 6.2); if (f === 120) eng.play('ui.point', { bus: 'ui' }); await sleep(16); }
  durs.sort((a, b) => a - b); const keep = durs.slice(0, Math.floor(durs.length * 0.99)), mean = keep.reduce((a, v) => a + v, 0) / keep.length, p99 = durs[Math.floor(durs.length * 0.99)], mx = durs[durs.length - 1];
  // heap growth of the per-frame update path (no play() calls)
  if (window.gc) window.gc(); const h0 = performance.memory ? performance.memory.usedJSHeapSize : 0; const N = 1500; for (let f = 0; f < N; f++) eng.update(0.016, L, st); if (window.gc) window.gc(); const h1 = performance.memory ? performance.memory.usedJSHeapSize : 0, perFrame = (h1 - h0) / N;
  const played = eng.stats.played - before, defer = (eng.stats.deferred || 0) - deferred0, readyCold = cold.filter((n) => eng.isReady(n)).length;
  checks.push({ name: 'realtime: init() with a real AudioContext + workers < 1.5 s', ok: initMs < 1500 && eng.workersUsed, detail: `${initMs.toFixed(0)} ms, workers ${eng.workersUsed}, ctx ${eng.ctx.state}` });
  checks.push({ name: 'realtime: audio is flowing through the master chain (analyser > -70 dBFS)', ok: flow > -70, detail: `${flow.toFixed(1)} dBFS` });
  checks.push({ name: 'realtime: update() with ~35 voices + ambience: mean (worst 1 % excluded: OS preemption on a shared machine) < 0.6 ms, p99 < 12 ms', ok: mean < 0.6 && p99 < 12, detail: `mean ${mean.toFixed(3)} ms, p99 ${p99.toFixed(2)} ms, max ${mx.toFixed(2)} ms, voices ${eng.stats.voices}` });
  LazyBuf.prototype.materialize = mz;
  const mats = matT.slice().sort((a, b) => a - b), mMed = mats.length ? mats[mats.length >> 1] : 0, mMax = mats.length ? mats[mats.length - 1] : 0;
  checks.push({ name: 'realtime: worker results stay raw until played: only essentials are converted at load, the rest at first play (<= 1 ms each, median <= 0.3 ms)', ok: eng.lib.lazy === true && eng.lib._lazyQ.length === 0 && mMax <= 1.5 && mMed <= 0.3, detail: `lazy ${eng.lib.lazy}, essentials queued at start ${lazyQ0} (left ${eng.lib._lazyQ.length}), ${mats.length} first-play conversions, median ${mMed.toFixed(3)} ms, max ${mMax.toFixed(2)} ms` });
  checks.push({ name: 'realtime: no per-frame heap allocation in update() (< 150 bytes/frame)', ok: perFrame < 150, detail: `${perFrame.toFixed(0)} B/frame over ${N} frames` });
  checks.push({ name: 'realtime: first play of un-built sounds is deferred (no main-thread synthesis) and then plays', ok: readyCold >= 4 && (defer === 0 || played >= 1), detail: `${defer} deferred, ${played} extra plays, ${readyCold}/${cold.length} cold sounds built` });
  const tables = `init ${initMs.toFixed(0)} ms (workers ${eng.workersUsed}); update mean ${mean.toFixed(3)} ms p99 ${p99.toFixed(2)} ms max ${mx.toFixed(2)} ms (frames > 8 ms: ${worst.join(' ') || 'none'}); heap ${perFrame.toFixed(1)} B/frame; analyser peak ${flow.toFixed(1)} dBFS; stats ${JSON.stringify({ ...eng.stats, updateMs: +eng.stats.updateMs.toFixed(3) })}; lib pending ${eng.lib.pending}`;
  return { initMs, mean, p99, mx, perFrame, flow, tables, checks };
}

/** engine behaviour: distance law + air absorption, Doppler fly-by, occlusion, muffle, underwater, vehicle interior, ducking, tinnitus, speed-of-sound delay, space cross-fade */
async function testEngine() {
  const lib = sharedLib(), oc0 = new OfflineAudioContext(1, 128, SR), shot = shotBuffer(oc0), checks = [], R = {}, kit = dsp.kit(oc0, 5); lib.drain(3);
  const fx1 = (v, d = 1) => (v == null || Number.isNaN(v) ? '-' : (+v).toFixed(d));
  // ---- 1 distance law + air absorption (dry path only)
  const dist = []; for (const d of [2, 4, 8, 16, 32, 64, 128, 256]) { const { buf } = await offlineRender(1.2, (eng) => { eng.setSpace('open', 0); eng.update(0.016, LISTENER); eng.revSend.gain.value = 0; eng.play(shot, { pos: { x: 0, y: 1.7, z: -d }, hrtf: false, jitter: 0, bus: 'weapon', minDist: 3, maxDist: 600, name: 't' }); }); const x = mono(buf), st = A.levelStats(x, SR), sp = A.spectralStats(x, SR); dist.push({ d, peakDb: st.peakDb, cent: sp.centroid, hf: sp.band(4000, 24000) / (sp.band(20, 500) || 1) }); }
  const pk = (d) => dist.find((r) => r.d === d).peakDb; R.distance = dist; const slope = pk(4) - pk(16);
  checks.push({ name: 'distance: inverse-distance law (4 m -> 16 m = -12 dB +-3)', ok: Math.abs(slope - 12) < 3, detail: `${fx1(slope)} dB` });
  checks.push({ name: 'distance: air absorption darkens with distance (centroid 8 m > 128 m by 25 %+)', ok: dist.find((r) => r.d === 128).cent < 0.75 * dist.find((r) => r.d === 8).cent, detail: `${fx1(dist.find((r) => r.d === 8).cent, 0)} -> ${fx1(dist.find((r) => r.d === 128).cent, 0)} Hz; 256 m: ${fx1(dist.find((r) => r.d === 256).cent, 0)}` });
  // ---- 2 Doppler fly-by of a 1.5 kHz tone at 250 m/s (subsonic): instantaneous frequency vs the analytic c/(c - v_toward)
  const tone = dsp.toBuffer(oc0, dsp.normalizeTo(kit.tone(1.0, 1500, { tau: 1e6, atk: 0.001 }), 0.8), SR); const C = 343, spd = 250, from = { x: -40, y: 1.7, z: -6 }, to = { x: 40, y: 1.7, z: -6 };
  const dop = await offlineRender(0.6, (eng) => { eng.setSpace('open', 0); eng.update(0.016, LISTENER); eng.revSend.gain.value = 0; eng.flyby(tone, from, to, { speed: spd, window: 0.16, maxDist: 20, jitter: 0, distGain: false, name: 'tone' }); }); const dx = mono(dop.buf); const wins = []; const w = Math.floor(0.03 * SR);
  let dstart = 0; for (let i = 0; i < dx.length; i++) if (Math.abs(dx[i]) > 0.02) { dstart = i; break; }
  for (let k = 0; k < 8; k++) { const i0 = dstart + Math.floor(k * 0.04 * SR), seg = dx.subarray(i0, i0 + w); if (seg.length < w) break; let best = 0, bf = 0; const sp = A.welch(seg, SR, 1024, 0, seg.length); for (let j = 2; j < sp.f.length; j++) if (sp.p[j] > best && sp.f[j] > 300) { best = sp.p[j]; bf = sp.f[j]; } const tc = (0.015 + k * 0.04) / 0.32, ux = 0, X = from.x + (to.x - from.x) * tc, Zc = from.z, r = Math.hypot(X, Zc), vT = -(1 * X) / r * spd, exp = 1500 * C / (C - vT); wins.push({ t: k * 0.04, meas: bf, exp }); }
  R.doppler = wins; const err = wins.reduce((a, q) => a + Math.abs(q.meas - Math.min(q.exp, 1500 * 6)) / Math.min(q.exp, 1500 * 6), 0) / wins.length;
  checks.push({ name: 'doppler: fly-by pitch follows c/(c-v_toward) (mean error < 18 %)', ok: err < 0.18 && wins[0].meas > 2.2 * wins[wins.length - 1].meas, detail: `err ${fx1(err * 100)} %, ${fx1(wins[0].meas, 0)} Hz -> ${fx1(wins[wins.length - 1].meas, 0)} Hz (analytic ${fx1(wins[0].exp, 0)} -> ${fx1(wins[wins.length - 1].exp, 0)})` });
  // ---- 3 occlusion (per voice) + 4 muffle + 5 underwater + 6 vehicle interior: spectral centroid / level of the same pink-noise burst
  const nz = dsp.toBuffer(oc0, dsp.normalizeTo(dsp.noiseArray(Math.floor(0.6 * SR), new dsp.Rng(4), 'pink'), 0.6), SR);
  const meas = async (setup, stepFn) => { const { buf } = await offlineRender(3.0, (eng) => { eng.setSpace('open', 0); eng.update(0.016, LISTENER); eng.revSend.gain.value = 0; setup(eng); }, { dt: 0.05, step: stepFn || (() => {}) }); const x = mono(buf).subarray(Math.floor(1.6 * SR), Math.floor(2.4 * SR)); return { st: A.levelStats(x, SR), sp: A.spectralStats(x, SR) }; };
  const bed = (eng) => { eng.play(nz, { loop: true, pos: { x: 0, y: 1.7, z: -10 }, hrtf: false, jitter: 0, minDist: 3, maxDist: 100, occlusion: eng._occ ?? 0, name: 'bed', bus: 'sfx' }); };
  const base = await meas((e) => e.play(nz, { loop: true, pos: { x: 0, y: 1.7, z: -10 }, hrtf: false, jitter: 0, minDist: 3, name: 'b', bus: 'sfx' })), occ = await meas((e) => e.play(nz, { loop: true, pos: { x: 0, y: 1.7, z: -10 }, hrtf: false, jitter: 0, minDist: 3, occlusion: 0.85, name: 'b', bus: 'sfx' }));
  const mfl = await meas((e) => e.play(nz, { loop: true, pos: { x: 0, y: 1.7, z: -10 }, hrtf: false, jitter: 0, minDist: 3, name: 'b', bus: 'sfx' }), (t, e) => { e.muffle(1); }), uw = await meas((e) => e.play(nz, { loop: true, pos: { x: 0, y: 1.7, z: -10 }, hrtf: false, jitter: 0, minDist: 3, name: 'b', bus: 'sfx' }), (t, e) => { e.underwater(1); });
  const veh = await meas((e) => { e.setListenerVehicle('cage'); e.setVehicleDoors(0); e.play(nz, { loop: true, pos: { x: 0, y: 1.7, z: -10 }, hrtf: false, jitter: 0, minDist: 3, name: 'b', bus: 'sfx' }); }, () => {}), vehOpen = await meas((e) => { e.setListenerVehicle('cage'); e.setVehicleDoors(1); e.play(nz, { loop: true, pos: { x: 0, y: 1.7, z: -10 }, hrtf: false, jitter: 0, minDist: 3, name: 'b', bus: 'sfx' }); }, () => {});
  R.filters = { base: [base.sp.centroid, base.st.rmsDb], occluded: [occ.sp.centroid, occ.st.rmsDb], muffle1: [mfl.sp.centroid, mfl.st.rmsDb], underwater: [uw.sp.centroid, uw.st.rmsDb], vehicleClosed: [veh.sp.centroid, veh.st.rmsDb], vehicleOpen: [vehOpen.sp.centroid, vehOpen.st.rmsDb] };
  checks.push({ name: 'occlusion: per-voice occlusion 0.85 lowers centroid > 50 % and level > 3 dB', ok: occ.sp.centroid < 0.5 * base.sp.centroid && base.st.rmsDb - occ.st.rmsDb > 3, detail: `${fx1(base.sp.centroid, 0)}->${fx1(occ.sp.centroid, 0)} Hz, ${fx1(base.st.rmsDb - occ.st.rmsDb)} dB` });
  checks.push({ name: 'muffle(1): world low-passed (centroid < 25 % of clear)', ok: mfl.sp.centroid < 0.25 * base.sp.centroid, detail: `${fx1(base.sp.centroid, 0)}->${fx1(mfl.sp.centroid, 0)} Hz` });
  checks.push({ name: 'underwater: centroid < 500 Hz and quieter', ok: uw.sp.centroid < 500 && uw.st.rmsDb < base.st.rmsDb, detail: `${fx1(uw.sp.centroid, 0)} Hz, ${fx1(uw.st.rmsDb - base.st.rmsDb)} dB` });
  checks.push({ name: 'vehicle interior (doors closed) muffles the outside; doors open restores it', ok: veh.sp.centroid < 0.6 * base.sp.centroid && vehOpen.sp.centroid > veh.sp.centroid * 1.4, detail: `closed ${fx1(veh.sp.centroid, 0)} Hz, open ${fx1(vehOpen.sp.centroid, 0)} Hz, clear ${fx1(base.sp.centroid, 0)} Hz` });
  // ---- 7 ducking + tinnitus: a steady bed on the music bus, explosion 3 m away at t=1.5 s
  const bedBuf = dsp.toBuffer(oc0, dsp.noiseArray(SR, new dsp.Rng(8), 'pink').map((v) => v * 0.15), SR);
  const scene = (withBed, withBoom) => offlineRender(9, (eng) => { eng.seed(42); eng.setSpace('open', 0); eng.update(0.016, LISTENER); const bv = withBed ? 1 : 1e-5; eng.play(bedBuf, { loop: true, bus: 'music', jitter: 0, name: 'bed', vol: bv }); eng.play(bedBuf, { loop: true, bus: 'amb', jitter: 0, name: 'bed2', pitch: 0.7, vol: bv }); }, { measure: true, dt: 0.02, step: (t, eng) => { if (withBoom && t >= 1.5 && !eng._x) { eng._x = 1; eng.explosion({ x: 0, y: 1.5, z: -3 }, 8.3); } } });
  const sBed = await scene(true, false), sBoom = await scene(false, true), sBoth = await scene(true, true), xb = mono(sBed.buf), xe = mono(sBoom.buf), xa = mono(sBoth.buf), tx = xa;
  const resid = new Float32Array(xa.length); for (let i = 0; i < xa.length; i++) resid[i] = xa[i] - xe[i]; // bed as heard after ducking (system is linear in measure mode)
  const lv = (x, a, b) => A.levelStats(x.subarray(Math.floor(a * SR), Math.floor(b * SR)), SR).rmsDb; const before = lv(resid, 0.8, 1.4), during = lv(resid, 1.65, 2.05), later = lv(resid, 7.5, 8.9), ref = lv(xb, 1.65, 2.05), duckDb = during - ref;
  const ringBand = (a, b) => { const sp = A.welch(tx, SR, 8192, Math.floor(a * SR), Math.floor(b * SR)); let pk = 0, pf = 0, floor = 0, n = 0; for (let i = 1; i < sp.f.length; i++) { if (sp.f[i] > 5500 && sp.f[i] < 6600) { if (sp.p[i] > pk) { pk = sp.p[i]; pf = sp.f[i]; } } else if (sp.f[i] > 3000 && sp.f[i] < 5000) { floor += sp.p[i]; n++; } } return { peakHz: pf, ratioDb: 10 * Math.log10(pk / (floor / n + 1e-30)) }; };
  const ring = ringBand(2.2, 3.6), hfBefore = A.spectralStats(tx, SR, Math.floor(0.6 * SR), Math.floor(1.4 * SR)).centroid, hfAfter = A.spectralStats(tx, SR, Math.floor(1.9 * SR), Math.floor(2.5 * SR)).centroid;
  R.blast = { before, during, later, duckDb, ring, hfBefore, hfAfter };
  checks.push({ name: 'explosion ducking: bed under a 3 m blast is ducked > 6 dB (isolated by subtraction) and recovers within 7 s', ok: duckDb < -6 && Math.abs(later - before) < 1.5, detail: `duck ${fx1(duckDb)} dB at +0.3 s; bed ${fx1(before)} -> ${fx1(during)} -> ${fx1(later)} dBFS` });
  checks.push({ name: 'tinnitus: 6 kHz ring > 15 dB above the neighbouring spectrum for seconds after a 3 m blast', ok: ring.peakHz > 5700 && ring.peakHz < 6500 && ring.ratioDb > 15, detail: `${fx1(ring.peakHz, 0)} Hz, +${fx1(ring.ratioDb)} dB over floor` });
  checks.push({ name: 'tinnitus: master low-pass sweep dulls the world after a near blast (centroid drops > 40 %)', ok: hfAfter < 0.6 * hfBefore, detail: `${fx1(hfBefore, 0)} -> ${fx1(hfAfter, 0)} Hz` });
  // ---- 9 speed of sound: explosion 343 m away arrives ~ (d-8)/c late
  const sos = await offlineRender(3.2, (eng) => { eng.setSpace('open', 0); eng.update(0.016, LISTENER); eng.revSend.gain.value = 0; eng.play(shot, { pos: { x: 0, y: 1.5, z: -343 }, sos: 1, hrtf: false, jitter: 0, bus: 'weapon', minDist: 6, maxDist: 700, name: 'far' }); }, { measure: true }); const sx = mono(sos.buf); let on = 0; const th = A.levelStats(sx, SR).peak * 0.05; for (let i = 0; i < sx.length; i++) if (Math.abs(sx[i]) > th) { on = i / SR; break; }
  R.sos = { onset: on, expected: (343 - 8) / 343 }; checks.push({ name: 'speed of sound: a shot 343 m away arrives at (d-8)/c +- 40 ms', ok: Math.abs(on - (343 - 8) / 343) < 0.04, detail: `${fx1(on, 3)} s vs ${fx1((343 - 8) / 343, 3)} s` });
  // ---- 10 space cross-fade mineShaft -> snow while a tone plays: no clicks, no level dip
  const toneL = dsp.toBuffer(oc0, dsp.normalizeTo(kit.tone(6, 440, { tau: 1e6, atk: 0.001, harm: [1, 0.4] }), 0.5), SR), cf = await offlineRender(6, (eng) => { eng.setSpace('mineShaft', 0); eng.update(0.016, LISTENER); eng.play(toneL, { loop: true, pos: { x: 0, y: 1.7, z: -6 }, hrtf: false, jitter: 0, name: 'tone', bus: 'sfx' }); }, { measure: true, dt: 0.05, step: (t, eng) => { if (t >= 3 && !eng._s) { eng._s = 1; eng.setSpace('snow', 1.0); } } }); const cx = mono(cf.buf); let maxJump = 0; const tr = []; for (let i = 0; i + 0.01 * SR <= cx.length; i += 0.01 * SR) tr.push(A.levelStats(cx.subarray(i, i + 0.01 * SR), SR).rmsDb); for (let i = 1; i < tr.length; i++) if (i > 20) maxJump = Math.max(maxJump, Math.abs(tr[i] - tr[i - 1]));
  R.crossfade = { maxJumpDb: maxJump }; checks.push({ name: 'space change cross-fade: no level jump > 2.5 dB per 10 ms', ok: maxJump < 2.5, detail: `${fx1(maxJump, 2)} dB` });
  const tables = `distance (dry, 'open', burst):\n` + dist.map((r) => `  ${String(r.d).padStart(4)} m  peak ${fx1(r.peakDb).padStart(6)} dBFS  centroid ${fx1(r.cent, 0).padStart(6)} Hz  HF/LF ${fx1(10 * Math.log10(r.hf + 1e-12)).padStart(6)} dB`).join('\n') + `\n\ndoppler fly-by (tone 1500 Hz, 250 m/s):\n` + wins.map((q) => `  t=${fx1(q.t, 2)}s measured ${fx1(q.meas, 0).padStart(6)} Hz  analytic ${fx1(q.exp, 0).padStart(6)} Hz`).join('\n') + `\n\nfilters (centroid Hz / rms dB): ` + Object.entries(R.filters).map(([k, v]) => `${k} ${fx1(v[0], 0)}/${fx1(v[1])}`).join('  |  ') + `\nblast: bed ${fx1(before)} -> ${fx1(during)} -> ${fx1(later)} dBFS (ducked ${fx1(duckDb)} dB), ring ${fx1(ring.peakHz, 0)} Hz +${fx1(ring.ratioDb)} dB, centroid ${fx1(hfBefore, 0)} -> ${fx1(hfAfter, 0)} Hz\nspeed of sound: onset ${fx1(on, 3)} s (expected ${fx1((343 - 8) / 343, 3)})`;
  return { ...R, tables, checks };
}

/** voice cap: 140 looping voices + bursts of one-shots with mixed priorities must never exceed the cap; high priorities survive */
async function testVoiceCap() {
  const lib = sharedLib(), oc0 = new OfflineAudioContext(1, 4800, SR), noise = dsp.toBuffer(oc0, dsp.noiseArray(SR, new dsp.Rng(3), 'pink').map((v) => v * 0.05), SR); let maxSeen = 0, over = 0; const eng0 = {};
  const { eng } = await offlineRender(4, (eng) => {
    const r = new dsp.Rng(9); for (let i = 0; i < 140; i++) eng.play(noise, { loop: true, pos: { x: r.range(-30, 30), y: 1, z: r.range(-30, 30) }, prio: i % 10, name: 'load' + i, vol: 0.5 });
    for (let s = 0; s < 40; s++) { eng.play(`step.${['concrete', 'metal', 'wood', 'dirt'][s % 4]}.walk.L`, { pos: { x: r.range(-8, 8), y: 0, z: r.range(-8, 8) }, delay: r.range(0, 2.5) }); eng.play('impact.concrete', { pos: { x: r.range(-20, 20), y: 1, z: r.range(-20, 20) }, delay: r.range(0, 3) }); }
    eng.play('ui.point', { bus: 'ui' });
  }, { dt: 0.02, step: (t, e) => { const n = e.slots.filter((v) => v.active).length; maxSeen = Math.max(maxSeen, n); if (n > e.voiceCap) over++; } });
  const alive = eng.slots.filter((v) => v.active).map((v) => v.prio), minPrio = alive.length ? Math.min(...alive) : -1;
  return { cap: eng.voiceCap, maxActiveSeen: maxSeen, framesOverCap: over, statsPeak: eng.stats.peakVoices, played: eng.stats.played, dropped: eng.stats.dropped, stolen: eng.stats.stolen, cooldownSkips: eng.stats.cooldown, limited: eng.stats.limited, minPrioAlive: minPrio, activeAtEnd: alive.length };
}

/** heavy scene through the FULL master chain (glue compressor + limiter + soft clip): output must never reach 0 dBFS */
async function testClipping() {
  const lib = sharedLib(), shot = shotBuffer(new OfflineAudioContext(1, 128, SR)); lib.drain(3); const r = new dsp.Rng(21);
  const { buf } = await offlineRender(7, (eng) => {
    for (let i = 0; i < 9; i++) eng.explosion({ x: r.range(-8, 8), y: 1, z: r.range(-14, -3) }, (1 + r.next()) * 5.2);
    for (let i = 0; i < 90; i++) { eng.play(shot, { bus: 'weapon', vol: 1, delay: r.range(0, 5), name: 'shot', jitter: 0.06 }); eng.play('impact.metal', { pos: { x: r.range(-6, 6), y: 1.5, z: r.range(-10, -2) }, vol: 1.3, delay: r.range(0, 5) }); }
    for (let i = 0; i < 12; i++) eng.play('flesh.head', { pos: { x: r.range(-3, 3), y: 1.4, z: r.range(-5, -1) }, vol: 1.3, delay: r.range(0, 5) });
  }, { measure: false });
  const L = buf.getChannelData(0), Rr = buf.getChannelData(1); const sL = A.levelStats(L, SR), sR = A.levelStats(Rr, SR);
  return { peakDb: Math.max(sL.peakDb, sR.peakDb), peak: Math.max(sL.peak, sR.peak), clippedSamples: sL.clip + sR.clip, rmsDb: Math.max(sL.rmsDb, sR.rmsDb), crestDb: sL.crestDb, nan: sL.nan + sR.nan };
}

/** every library sound: level/spectral/clipping/silence stats, loop seams, spectrogram sheets grouped by family */
async function testLibrary(P) {
  const lib = sharedLib(), t0 = performance.now(); lib.drain(0); const buildMs = performance.now() - t0, rows = [], groups = new Map();
  for (const name of lib.names().sort()) {
    const d = lib.defs.get(name); if (d.alias || name.startsWith('ir.')) continue; const v = lib.variants(name);
    v.forEach((b, i) => {
      const x = b.getChannelData(0), st = A.levelStats(x, b.sampleRate), sp = A.spectralStats(x, b.sampleRate), seam = d.loop ? A.seamClick(x, b.sampleRate) : null;
      rows.push({ name, i, dur: st.dur, peakDb: st.peakDb, rmsDb: st.rmsDb, crestDb: st.crestDb, centroid: sp.centroid, roll85: sp.rolloff85, clip: st.clip, quiet: st.quietFrac, headMs: st.headMs, tailMs: st.tailMs, dc: st.dc, seamDb: seam, nan: st.nan, ch: b.numberOfChannels });
      if (i === 0) { const fam = name.startsWith('step.') ? (/\.(walk|sprint|crouch)\.L$/.test(name) ? 'step.' + name.split('.')[2] : null) : name.split('.')[0]; if (fam) { if (!groups.has(fam)) groups.set(fam, []); groups.get(fam).push({ name, x, sr: b.sampleRate, note: `pk ${st.peakDb.toFixed(1)} cen ${sp.centroid.toFixed(0)}` }); } }
    });
  }
  const want = (P.get('sheets') || 'impact,ricochet,bullet,flesh,glass,explosion,board,melee,zombie,player,casing,step,ui,perk,powerup,vehicle,amb').split(',');
  for (const [fam, items] of groups) if (want.some((w) => fam.startsWith(w))) { const per = 20; for (let k = 0; k < items.length; k += per) addImage(`lib_${fam}${k ? '_' + k : ''}`, A.contactSheet(items.slice(k, k + per), { cols: 4, tileW: 380, tileH: 150, fmax: 20000 })); }
  return { buildMs, count: rows.length, rows };
}
// ---- long-term spectrum shape (24 log bands, dB) used for distinctness matrices
const BANDS = Array.from({ length: 25 }, (_, i) => 40 * Math.pow(16000 / 40, i / 24));
function bandProfile(x, sr) { const { f, p } = A.welch(x, sr, 4096); const e = new Float64Array(24); for (let k = 1; k < f.length; k++) for (let b = 0; b < 24; b++) if (f[k] >= BANDS[b] && f[k] < BANDS[b + 1]) { e[b] += p[k]; break; } return Array.from(e, (v) => 10 * Math.log10(v + 1e-20)); }
const profDist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
const table = (rows, cols) => { const w = cols.map((c) => Math.max(c.h.length, ...rows.map((r) => String(c.f(r)).length))); return [cols.map((c, i) => c.h.padEnd(w[i])).join(' '), ...rows.map((r) => cols.map((c, i) => String(c.f(r))[c.left ? 'padEnd' : 'padStart'](w[i])).join(' '))].join('\n'); };
const fx = (v, d = 1) => (v == null || Number.isNaN(v) ? '-' : (+v).toFixed(d));

/** voice casting: the voice sets a map really declares (window.__voiceGroups from tools/audio-recipes.mjs) built as in a session (one engine per map): every pair within a map >= 8 dB apart in long-term spectrum */
async function testVoiceCasting() {
  const groups = window.__voiceGroups || {}, out = [], lib = sharedLib();
  for (const [g, list] of Object.entries(groups)) { if (list.length < 2) continue; const eng = new AudioEngine(lib);
    const sigs = list.map((p) => { const set = eng.zombieVoice(p), acc = new Float64Array(24); let n = 0; for (const cat of ['idle', 'attack', 'pain']) for (let i = 0; i < 3; i++) { const b = lib.buildVariant(set.names[cat], i); if (!b) continue; const q = bandProfile(b.getChannelData(0), b.sampleRate); for (let k = 0; k < 24; k++) acc[k] += q[k]; n++; } return Array.from(acc, (v) => v / n); });
    let mn = 1e9, mean = 0, cnt = 0; for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) { const d = profDist(sigs[i], sigs[j]); mn = Math.min(mn, d); mean += d; cnt++; } out.push({ g, n: list.length, min: mn, mean: mean / cnt }); }
  const checks = [{ name: 'voice casting: every voice set of a map differs from every other set of that map by >= 8 dB (24-band long-term spectrum, rms)', ok: out.length >= 3 && out.every((r) => r.min >= 8), detail: out.map((r) => `${r.g}: ${r.n} sets, min ${fx(r.min, 1)} / mean ${fx(r.mean, 1)} dB`).join(' | ') }];
  return { rows: out, checks, tables: out.map((r) => `${r.g.padEnd(22)} sets ${r.n}  min pair ${fx(r.min, 2)} dB  mean ${fx(r.mean, 1)} dB`).join('\n') };
}
/** zombie voice banks: >= 8 buffers per category, f0/formant/spectral checks per profile, distinctness between banks */
async function testVoices() {
  const lib = sharedLib(), eng = new AudioEngine(lib), rows = [], checks = [], prof = [], custom = { kind: 'guard', f0: [80, 125], rasp: 0.6, size: 1.15, seed: 77 };
  const sets = { ...Object.fromEntries(Object.keys(eng.voices).map((k) => [k, eng.voices[k]])), guard: eng.zombieVoice(custom) }; lib.drain(1);
  const t0 = performance.now(); let nb = 0;
  for (const [name, set] of Object.entries(sets)) {
    const P = set.profile, all = []; const sheet = [];
    for (const cat of ['idle', 'attack', 'pain', 'death', 'spawn', 'sprint']) {
      const v = set[cat]; nb += v.length; const st = v.map((b) => { const x = b.getChannelData(0); return { x, b, ls: A.levelStats(x, b.sampleRate), sp: A.spectralStats(x, b.sampleRate), f0: A.f0Track(x, b.sampleRate, { fmin: 55, fmax: 900 }) }; });
      const f0s = st.map((s) => s.f0.f0).filter((v) => v > 0).sort((a, b) => a - b), f0med = f0s.length ? f0s[f0s.length >> 1] : 0;
      rows.push({ name, cat, n: v.length, dur: [Math.min(...st.map((s) => s.ls.dur)), Math.max(...st.map((s) => s.ls.dur))], peak: Math.max(...st.map((s) => s.ls.peakDb)), rms: st.reduce((a, s) => a + s.ls.rmsDb, 0) / st.length, cent: st.reduce((a, s) => a + s.sp.centroid, 0) / st.length, acent: st.reduce((a, s) => a + s.sp.acentroid, 0) / st.length, f0: f0med, voiced: st.reduce((a, s) => a + s.f0.voiced, 0) / st.length, hf: st.reduce((a, s) => a + s.sp.band(2000, 8000), 0) / st.length, clip: st.reduce((a, s) => a + s.ls.clip, 0), lo: P.f0[0], hi: P.f0[1] });
      st.slice(0, 2).forEach((s, i) => sheet.push({ name: `${name}.${cat}#${i}`, x: s.x, sr: s.b.sampleRate, note: `f0 ${fx(s.f0.f0, 0)}Hz v${fx(s.f0.voiced, 2)} cen ${fx(s.sp.centroid, 0)}` })); if (cat === 'idle') for (const s of st) all.push(s.x);
      if (cat === 'attack' || cat === 'idle') { // formant estimate at the loudest voiced frame of each variant
        for (const s of st.slice(0, 4)) { const x = s.x, w = 1024; let best = 0, bi = 0; for (let i = 0; i + w < x.length; i += 256) { const e = A.levelStats(x.subarray(i, i + w), 1).rms; if (e > best) { best = e; bi = i; } } const fm = A.lpcFormants(x, s.b.sampleRate, bi, w, 14, 5000); if (fm.length) prof.push({ name, cat, F: fm.slice(0, 3).map((q) => Math.round(q.f)) }); }
      }
    }
    addImage(`voices_${name}`, A.contactSheet(sheet, { cols: 3, tileW: 420, tileH: 160, fmax: 8000 }));
    const cat = all.length ? all : []; sets[name]._prof = bandProfile(cat.reduce((a, x) => { const o = new Float32Array(Math.max(a.length, x.length)); o.set(a); for (let i = 0; i < x.length; i++) o[i] += x[i]; return o; }, new Float32Array(1)), sets[name].idle[0].sampleRate);
  }
  const names = Object.keys(sets), dmat = names.map((a) => names.map((b) => profDist(sets[a]._prof, sets[b]._prof))); let minD = 1e9, pair = ''; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (dmat[i][j] < minD) { minD = dmat[i][j]; pair = names[i] + '/' + names[j]; }
  const tables = table(rows, [{ h: 'bank', f: (r) => r.name, left: 1 }, { h: 'cat', f: (r) => r.cat, left: 1 }, { h: 'n', f: (r) => r.n }, { h: 'dur s', f: (r) => fx(r.dur[0], 2) + '-' + fx(r.dur[1], 2) }, { h: 'peak', f: (r) => fx(r.peak) }, { h: 'rms', f: (r) => fx(r.rms) }, { h: 'cent', f: (r) => fx(r.cent, 0) }, { h: 'Acent', f: (r) => fx(r.acent, 0) }, { h: '>2k%', f: (r) => fx(r.hf * 100, 0) }, { h: 'f0 med', f: (r) => fx(r.f0, 0) }, { h: 'profile f0', f: (r) => r.lo + '-' + r.hi }, { h: 'voiced', f: (r) => fx(r.voiced, 2) }, { h: 'clip', f: (r) => r.clip }])
    + '\n\nformant estimates (LPC, loudest frame; Hz) per bank:\n' + names.map((n) => `  ${n.padEnd(8)} ` + prof.filter((q) => q.name === n).map((q) => `${q.cat[0]}:[${q.F.join(',')}]`).join(' ')).join('\n')
    + `\n\ndistinctness (24-band idle spectrum distance, dB rms):\n` + '           ' + names.map((n) => n.slice(0, 7).padStart(8)).join('') + '\n' + names.map((n, i) => n.padEnd(11) + dmat[i].map((v) => fx(v, 1).padStart(8)).join('')).join('\n');
  for (const r of rows.filter((r) => r.cat === 'idle' || r.cat === 'attack')) if (r.name !== 'mascot') checks.push({ name: `voice ${r.name}.${r.cat}: median f0 within profile range (+-35%)`, ok: r.f0 > 0.65 * r.lo && r.f0 < 1.5 * r.hi, detail: `${fx(r.f0, 0)} Hz vs ${r.lo}-${r.hi}` });
  checks.push({ name: 'voices: >= 8 buffers per category for every bank', ok: rows.every((r) => r.n >= 8), detail: `${rows.length} category banks, min ${Math.min(...rows.map((r) => r.n))}` });
  checks.push({ name: 'voices: banks are spectrally distinct (min pair distance > 2 dB)', ok: minD > 2, detail: `${fx(minD, 2)} dB (${pair})` });
  checks.push({ name: 'voices: no clipping', ok: rows.every((r) => r.clip === 0), detail: '' });
  return { rows, tables, checks, buildMs: performance.now() - t0, buffers: nb };
}

/** all 16 stop recipes (+menu): offline render through the engine, level/stationarity/spectral checks, distinctness, event/music activity, crossfade + unknown-type handling */
async function testAmbience(P) {
  const allNames = Object.keys(sharedPresets()), names = P.get('recipes') ? P.get('recipes').split(',').filter((n) => allNames.includes(n)) : allNames, rows = [], checks = [], sheet = [], profs = {}, lib = sharedLib(); const DUR = +(P.get('ambdur') || 30);
  for (const name of names) {
    let fired = 0, phr = 0; log('ambience recipe', name); const tr0 = performance.now();
    const mute = P.get('mute'), base = sharedPresets()[name], rec = mute === 'events' ? { ...base, events: [] } : mute === 'beds' ? { ...base, beds: [] } : base; const { buf, eng } = await offlineRender(DUR, (eng) => { eng.ambience.set(rec, 0.05); eng.lib.drain(0); }, { measure: false, dt: 0.05, step: () => {} });
    const rt = eng.ambience.rts[0]; if (rt) { fired = rt.stats.fired; for (const b of rt.beds) if (b.n) phr += b.n; }
    const x = mono(buf), st = A.levelStats(x, SR), sp = A.spectralStats(x, SR), win = 4 * SR, rms = []; for (let i = 0; i + win <= x.length; i += win) rms.push(A.levelStats(x.subarray(i, i + win), SR).rmsDb);
    profs[name] = bandProfile(x, SR); const beds = (base.beds || []).map((b) => b.type + (b.kind ? ':' + b.kind : '')), evs = (base.events || []).map((e) => e.type || 'custom');
    log('  rendered', name, ((performance.now() - tr0) / 1000).toFixed(1) + 's rms', st.rmsDb.toFixed(1)); rows.push({ name, rms: st.rmsDb, peak: st.peakDb, cent: sp.centroid, acent: sp.acentroid, lf: sp.lf, hf: sp.hf + sp.vhf, span: Math.max(...rms) - Math.min(...rms), fired, phr, beds, evs, clip: st.clip, first: st.headMs });
    if (['shaft-nine.surface', 'shaft-nine.flooded', 'whiteout.summit', 'last-ferry.lighthouse', 'after-hours.plaza', 'after-hours.castle'].includes(name)) sheet.push({ name: name, x: x.subarray(0, Math.floor(SR * 24)), sr: SR, note: `rms ${fx(st.rmsDb)} cen ${fx(sp.centroid, 0)}` });
  }
  addImage('ambience_spectrograms', A.contactSheet(sheet, { cols: 2, tileW: 560, tileH: 210, fmax: 16000 }));
  const dm = names.map((a) => names.map((b) => profDist(profs[a], profs[b]))); let minD = 1e9, pair = ''; const close = []; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { close.push([dm[i][j], names[i], names[j]]); if (dm[i][j] < minD) { minD = dm[i][j]; pair = names[i] + ' / ' + names[j]; } }
  close.sort((a, b) => a[0] - b[0]);
  const jac = (a, b) => { const A1 = new Set(a), B1 = new Set(b); let i = 0; for (const v of A1) if (B1.has(v)) i++; return i / (A1.size + B1.size - i); }; let maxJ = 0, jp = ''; const badPairs = []; for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) { const jv = jac(rows[i].evs, rows[j].evs) * 0.5 + jac(rows[i].beds, rows[j].beds) * 0.5; if (jv > maxJ) { maxJ = jv; jp = rows[i].name + ' / ' + rows[j].name; } if (dm[i][j] <= 3 && jv >= 0.4) badPairs.push(`${rows[i].name}~${rows[j].name} (${fx(dm[i][j], 1)} dB, J ${fx(jv, 2)})`); }
  // (measurement windows are 500 ms: power estimates of noise bands from 250 ms windows scatter about +-1 dB by themselves)
  // crossfade: bed-only recipes A (pink lp 900) and B (white hp 2500); A for 8 s, then set(B, 4 s). Power must follow the equal-power law cos^2*Pa + sin^2*Pb (+-1.5 dB), no steps.
  const RA = { space: 'open', beds: [{ type: 'noise', color: 'pink', lp: 900, gain: 1 }], events: [] }, RB = { space: 'open', beds: [{ type: 'noise', color: 'white', hp: 2500, gain: 1 }], events: [] };
  const xf = await offlineRender(16, (eng) => { eng.ambience.set(RA, 0.05); eng.ambience.prepare(RB); eng.lib.drain(0); }, { measure: true, dt: 0.05, step: (t, eng) => { if (t >= 8 && !eng._sw) { eng._sw = 1; eng.lib.drain(0); eng.ambience.set(RB, 4); } } });
  const xm = mono(xf.buf), rmsAt = (a, b) => A.levelStats(xm.subarray(Math.floor(a * SR), Math.floor(b * SR)), SR).rms, pA = rmsAt(3, 7) ** 2, pB = rmsAt(13.5, 15.5) ** 2; let dev = 0, stepMax = 0, prev = null; const t0x = 8.0;
  for (const [WIN, isDev] of [[0.5, true], [0.25, false]]) { prev = null; for (let t = t0x + 0.4; t < t0x + 3.6 - WIN; t += WIN) { const u = (t + WIN / 2 - t0x) / 4, e = Math.cos(u * Math.PI / 2) ** 2 * pA + Math.sin(u * Math.PI / 2) ** 2 * pB, m = rmsAt(t, t + WIN) ** 2, d = 10 * Math.log10(m / e); if (isDev) dev = Math.max(dev, Math.abs(d)); else if (prev !== null) stepMax = Math.max(stepMax, Math.abs(10 * Math.log10(m / prev))); prev = m; } }
  const dip = dev;
  // unknown types: one warning each, no crash
  const warns = []; const ow = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); ow(...a); }; let crashed = false; try { await offlineRender(3, (eng) => { eng.ambience.set({ space: 'open', beds: [{ type: 'bogus', gain: 1 }, { type: 'wind', gain: 0.1 }, { type: 'bogus', gain: 1 }], events: [{ type: 'nonexistent', every: [0.5, 1] }, { type: 'nonexistent', every: [0.5, 1] }, { type: 'drip', every: [0.5, 1] }] }, 0.05); eng.lib.drain(0); }, { measure: false, dt: 0.05, step: () => {} }); } catch (e) { crashed = true; } console.warn = ow;
  const wb = warns.filter((w) => w.includes('bogus')).length, we = warns.filter((w) => w.includes('nonexistent')).length;
  const tables = table(rows, [{ h: 'recipe', f: (r) => r.name, left: 1 }, { h: 'rms dB', f: (r) => fx(r.rms) }, { h: 'peak', f: (r) => fx(r.peak) }, { h: 'centroid', f: (r) => fx(r.cent, 0) }, { h: 'A-cent', f: (r) => fx(r.acent, 0) }, { h: 'LF%', f: (r) => fx(r.lf * 100, 0) }, { h: 'HF%', f: (r) => fx(r.hf * 100, 0) }, { h: '4s-rms span', f: (r) => fx(r.span) }, { h: 'events', f: (r) => r.fired }, { h: 'phrases', f: (r) => r.phr }, { h: 'beds', f: (r) => r.beds.length }, { h: 'evt types', f: (r) => new Set(r.evs).size }])
    + `\n\nclosest recipe pairs by long-term spectrum (dB rms): ` + close.slice(0, 4).map((c) => `${c[1]}~${c[2]} ${fx(c[0], 1)}`).join(' | ') + `\nmost similar vocabulary (beds+events Jaccard): ${fx(maxJ, 2)} (${jp})\nequal-power crossfade pink->white noise beds over 4 s: max deviation from cos^2/sin^2 law ${fx(dip, 2)} dB, max 250 ms step ${fx(stepMax, 2)} dB\nunknown types: bed warnings ${wb}, event warnings ${we}, crashed ${crashed}`;
  checks.push({ name: 'ambience: all 16 stop recipes + menu rendered, none silent (rms > -60 dBFS)', ok: rows.length >= 17 && rows.every((r) => r.rms > -60), detail: `${rows.length} recipes, quietest ${fx(Math.min(...rows.map((r) => r.rms)))} dB` });
  checks.push({ name: 'ambience: levels within -40..-26 dBFS rms', ok: rows.every((r) => r.rms > -40 && r.rms < -26), detail: `${fx(Math.min(...rows.map((r) => r.rms)))}..${fx(Math.max(...rows.map((r) => r.rms)))}` });
  checks.push({ name: 'ambience: no clipping', ok: rows.every((r) => r.clip === 0), detail: '' });
  checks.push({ name: 'ambience: stops are distinct: every pair differs by > 3 dB spectrum shape OR has bed/event vocabulary Jaccard < 0.4', ok: badPairs.length === 0, detail: badPairs.length ? badPairs.join('; ') : `closest spectra ${fx(minD, 1)} dB (${pair}); max vocabulary overlap ${fx(maxJ, 2)}` });
  checks.push({ name: 'ambience: scheduled events fire (every recipe >= 3 in 30 s)', ok: rows.every((r) => r.fired >= 3), detail: `min ${Math.min(...rows.map((r) => r.fired))}` });
  checks.push({ name: 'ambience: recipe crossfade follows the equal-power law (+-1.5 dB over 10..90 % of the fade, steps < 3 dB / 250 ms)', ok: dip < 1.5 && stepMax < 3, detail: `dev ${fx(dip, 2)} dB, step ${fx(stepMax, 2)} dB` });
  checks.push({ name: 'ambience: unknown bed/event types warn once and are ignored', ok: !crashed && wb === 1 && we === 1, detail: `bed warns ${wb}, event warns ${we}` });
  return { rows, tables, checks, minD, maxJ };
}
function sharedPresets() { return globalAudio.ambience.presets; }

/** every vehicle event the map workers emit (src/maps/<map>/vehicle.js) must reach a sound (or be a documented data-only event) */
async function testVehicleEvents() {
  const EVT = { cage: ['doors', 'signal', 'start', 'stop', 'bump', 'creak', 'arrived', 'horn'], gondola: ['doors', 'start', 'bump', 'creak', 'state', 'approach', 'arrived', 'departed', 'horn'], ferry: ['doors', 'arrived', 'departed', 'mooring', 'horn', 'start', 'bump', 'creak'], monorail: ['doors', 'start', 'arrived', 'bump', 'horn', 'pylon', 'jointkick', 'pa', 'creak', 'departed'] }, rows = [], silent = [];
  await offlineRender(3, (eng) => { for (const [kind, evs] of Object.entries(EVT)) { const veh = { name: kind, group: { position: { x: 0, y: 0, z: -5 } } }; for (const evt of evs) { for (const data of evt === 'doors' ? [{ open: true }, { open: false }] : [{}]) { const before = eng.stats.played + eng.stats.cooldown + eng.stats.limited; eng.vehicleEvent(kind, evt, data, veh); const n = eng.stats.played + eng.stats.cooldown + eng.stats.limited - before; rows.push(`${kind}.${evt}${evt === 'doors' ? (data.open ? '(open)' : '(close)') : ''}=${n}`); if (!n && evt !== 'state') silent.push(`${kind}.${evt}`); } } } });
  return { rows, silent };
}

/** a scripted 32 s stretch of play through the full chain (real weapon sounds from the weapons module + our impacts / voices / footsteps / ambience / explosion / stinger): quiet exploration -> zombies close in -> pistol -> full-auto burst -> grenade -> sprint -> quiet again. Loudness in LUFS (BS.1770), peaks, loudness range. */
async function testMix() {
  const { registerSounds } = await import('../game/weapons/sounds.js'); const R = new dsp.Rng(11), checks = [], DUR = +(new URLSearchParams(location.search).get('mixdur') || 32), mixLib = new Library(new OfflineAudioContext(2, 1024, SR)); installAll(mixLib);
  const zs = Array.from({ length: 8 }, () => { const a = R.range(0, 6.28), d = R.range(6, 26); return { x: Math.sin(a) * d, y: 1.5, z: -Math.cos(a) * d, next: R.range(1, 4), nextA: R.range(8, 14), d0: d }; }); let shotT = 0, stepT = 1, m1T = 6, exploded = false, hurt = false, started = false;
  const phase = (t) => (t < 6 ? 'quiet' : t < 10 ? 'pistol' : t < 15 ? 'auto' : t < 24 ? 'sprint' : 'quiet'), mute = new URLSearchParams(location.search).get('mixmute') || '', muted = (k) => mute.split(',').includes(k);
  const { buf } = await offlineRender(DUR, (eng) => { eng.seed(7); registerSounds(eng); eng.lib.drain(0); eng.setSpace('openDusk', 0); if (!muted('amb')) eng.ambience.set('shaft-nine.surface', 0.05); eng.lib.drain(0); eng._vs = eng.zombieVoice({ id: 'miner', kind: 'miner', f0: [66, 112], rasp: 0.78, wet: 0.1, size: 1.22, breath: 0.25, seed: 101 }); eng.lib.drain(0); },
    { lib: mixLib, measure: false, dt: 0.05, step: (t, eng) => {
      const ph = phase(t); if (!started) { started = true; eng.play('ui.round.start', { bus: 'ui', vol: 0.9 }); }
      while (stepT < t) { if (muted('foley')) { stepT = t + 1; break; } const sp = t > 15 && t < 24; eng.step('concrete', sp ? 1.5 : 1, null); stepT += sp ? 0.34 : 0.5; }
      if (ph === 'pistol' && !muted('guns')) while (m1T < t) { eng.play('gun.m1911.fire', { bus: 'weapon', pos: null, vol: 1 }); if (R.chance(0.6)) eng.impact(R.chance(0.5) ? 'flesh' : 'concrete', { x: R.range(-5, 5), y: 1.2, z: -R.range(6, 15) }, { caliber: 1.1 }); m1T += 0.45; } else if (m1T < t) m1T = t;
      if (ph === 'auto' && !muted('guns')) while (shotT < t) { eng.play('gun.ak74u.fire', { bus: 'weapon', pos: null, vol: 1 }); if (R.chance(0.6)) eng.impact(R.chance(0.4) ? 'flesh' : 'concrete', { x: R.range(-6, 6), y: 1.2, z: -R.range(8, 22) }, { caliber: 0.8 }); shotT += 0.1; } else if (shotT < t) shotT = t;
      if (!muted('voice')) for (const z of zs) { const near = ph === 'pistol' || ph === 'auto' || ph === 'sprint', k = near ? 0.55 : 1; if (t >= z.next) { eng.speak(eng._vs, 'idle', { pos: near ? { x: z.x * 0.4, y: 1.5, z: z.z * 0.4 } : z }); z.next = t + R.range(2, 5) * k; } if (near && t >= z.nextA) { eng.speak(eng._vs, 'attack', { pos: { x: z.x * 0.3, y: 1.5, z: z.z * 0.3 } }); z.nextA = t + R.range(3, 7); } }
      if (t > 15 && !exploded && !muted('guns')) { exploded = true; eng.explosion({ x: 6, y: 1, z: -12 }, 5.2); } if (t > 16.5 && !hurt) { hurt = true; eng.hurt(30, null); }
    } });
  const Lc = buf.getChannelData(0), Rc = buf.getChannelData(1), m = A.lufs(Lc, Rc, SR), st = A.levelStats(mono(buf), SR); let pk = 0, over = 0; for (let i = 0; i < Lc.length; i++) { const a = Math.max(Math.abs(Lc[i]), Math.abs(Rc[i])); if (a > pk) pk = a; if (a > 0.891) over++; }
  const pkDb = 20 * Math.log10(pk + 1e-12); checks.push({ name: 'mix: scripted play scene stays below -1 dBFS sample peak through the master chain', ok: pkDb < -1, detail: `peak ${fx(pkDb, 2)} dBFS, ${over} samples above -1 dBFS` });
  checks.push({ name: 'mix: integrated loudness of the scene sits in a normal game range (-26..-12 LUFS), loud passages <= -10 LUFS short-term', ok: m.integrated > -26 && m.integrated < -12 && m.shortTermMax < -10, detail: `${fx(m.integrated, 1)} LUFS integrated, short-term max ${fx(m.shortTermMax, 1)}, momentary max ${fx(m.momentaryMax, 1)}` });
  checks.push({ name: 'mix: loudness range 5..18 LU (quiet exploration vs firefight: dynamic, not crushed)', ok: m.lra >= 5 && m.lra <= 18, detail: `LRA ${fx(m.lra, 1)} LU` });
  return { checks, tables: `scripted play ${DUR} s: integrated ${fx(m.integrated, 1)} LUFS, LRA ${fx(m.lra, 1)} LU, short-term max ${fx(m.shortTermMax, 1)}, momentary max ${fx(m.momentaryMax, 1)}, peak ${fx(pkDb, 2)} dBFS, rms ${fx(st.rmsDb, 1)} dBFS; short-term series (3 s windows, 1 s hop): ${m.shortTerm.map((v) => fx(v, 1)).join(' ')}` };
}

/** game integration paths (mock World + Player): auto stop following, preset substitution for authored recipes, transit cross-fade, ride vehicle attach, duplicate footstep suppression, explosion radius, sticky setSpace */
async function testIntegration() {
  const checks = [], obs = {}; const mkStop = (id, reverb, wind, oy, ambient, waterY) => ({ id, atmo: { reverb, wind }, ambient, origin: { x: 0, y: oy, z: 0 }, B: { colliders: { waterY } } });
  const authoredA = { space: 'open', gain: 1, beds: [{ type: 'wind', gain: 0.3 }], events: [{ type: 'bell', every: [5, 9], gain: 0.8, pos: [10, 2, 3] }] }, authoredB = { space: 'tunnel', gain: 1, beds: [{ type: 'rumble', gain: 0.3 }], events: [] };
  const A = mkStop('surface', 'openDusk', [3, 0, 1], 0, authoredA), B = mkStop('tunnels', 'tunnel', [0, 0, 0], -90, authoredB), C = mkStop('flooded', 'mineShaft', [0, 0, 0], 0, authoredB, 3);
  const veh = { name: 'cage', group: { position: { x: 0, y: 0, z: 0 }, visible: true }, vel: { length: () => 4 }, onEvent: null, doors: 1, time: 0 };
  const world = { map: { id: 'shaft-nine' }, stops: [A, B, C], active: A, transit: null, vehicle: veh, _wall: false, _rayD: 40, _ceil: 30,
    clear(ax, ay, az, bx, by, bz) { if (!world._wall) return true; if ((ax < 5) === (bx < 5)) return true; const u = (5 - ax) / (bx - ax), z = az + (bz - az) * u; return Math.abs(z) < 1; }, // a wall at x = 5 with a 2 m doorway around z = 0
    raycast(ox, oy, oz, dx, dy, dz, maxT, out) { if (world._wall && dx > 0.05 && ox < 5) { const t = (5 - ox) / dx, z = oz + dz * t; if (t < maxT && Math.abs(z) >= 1) { out.t = t; out.surface = world._wallFixed || (z < 3.5 ? 'glass' : z < 4.7 ? 'wood' : 'concrete'); return true; } } const d = dy > 0.9 ? world._ceil : world._rayD; if (d < maxT) { out.t = d; out.surface = 'concrete'; return true; } return false; } };
  const played = []; const player = { pos: { x: 0, y: 0, z: 0 }, world, hp: 100, maxHp: 100, alive: true, platform: null, onStep: null, onLand: null, onDamage: null };
  let eng0 = null;
  const occV = [], matV = []; const { buf, eng } = await offlineRender(28, (eng) => {
    eng0 = eng; eng.seed(3); eng.attachPlayer(player); const t0 = eng.stats.played; // game code that also plays a generic footstep from its own onStep handler (installed before attachPlayer)
    obs.attachedWorld = eng.gw === world; obs.occl = !!eng.occlusionQuery;
  }, { measure: true, dt: 0.05, step: (t, eng) => {
    const rec = () => eng.ambience.rts.filter((r) => r.target > 0).map((r) => ({ cal: !!r.def.cal, sp: r.def.space, org: r.origin && r.origin.y }));
    if (t > 1.0 && !obs.a) { obs.a = { space: eng.space, rts: rec(), wind: eng.ambience.wind, vehicles: eng.vehicles.size }; eng.setSpace('openDusk', 0.2); eng.ambience.set(authoredA, 0.2); }
    if (t > 1.6 && !obs.a2) { obs.a2 = { space: eng.space, rts: rec(), all: eng.ambience.rts.length }; world.active = B; world._rayD = 5; world._ceil = 4; } // (into the tunnels: a corridor)
    if (t > 3.2 && !obs.b) { obs.b = { space: eng.space, rts: rec(), all: eng.ambience.rts.length }; world.transit = { from: 1, to: 0, t: 0.3 }; }
    if (t > 3.8 && !obs.tr0) { obs.tr0 = 1; world._rayD = 40; world._ceil = 30; }
    if (t > 4.0 && !obs.tr) { obs.tr = { rts: eng.ambience.rts.filter((r) => r.state !== 'loading').length, forced: eng.ambience.rts.some((r) => r.forceU !== undefined), space: eng.space }; world.transit = null; world.active = C; }
    if (t > 6.0 && !obs.c) { obs.c = { space: eng.space, uw: eng._uwAuto }; world.active = A; eng._uwAuto = 0; }
    if (t > 10.0 && !obs.o1) { obs.o1 = 1; world._wall = true; world._wallFixed = 'concrete'; const sh = eng.lib.get('impact.concrete'); const buf = Array.isArray(sh) ? sh[0] : sh; for (const z of [0.2, 3.0, 8.0]) occV.push(eng.play(buf, { pos: { x: 10, y: 1.7, z }, loop: true, vol: 0.3, jitter: 0, name: 'occ.' + z, minDist: 6 })); }
    if (t > 11.2 && !obs.o2) { obs.o2 = occV.map((h) => (h ? +h.v.occT.toFixed(2) : null)); for (const h of occV) if (h) h.stop(0.05); world._wall = false; world._wallFixed = null; world._rayD = 40; world._ceil = 30; }
    if (t > 12.2 && !obs.m1) { obs.m1 = 1; world._wall = true; const sh = eng.lib.get('impact.concrete'), b0 = Array.isArray(sh) ? sh[0] : sh; for (const z of [6, 8, 11]) matV.push(eng.play(b0, { pos: { x: 10, y: 1.7, z }, loop: true, vol: 0.3, jitter: 0, name: 'mat.' + z, minDist: 6 })); }
    if (t > 13.6 && !obs.m2) { obs.m2 = matV.map((h) => (h ? +h.v.occT.toFixed(2) : null)); for (const h of matV) if (h) h.stop(0.05); world._wall = false; world._rayD = 40; world._ceil = 30; }
    if (t > 19.0 && !obs.r0) { obs.r0 = 1; world.active = B; world._rayD = 20; world._ceil = 12; }
    if (t > 23.0 && !obs.r1) { obs.r1 = eng.space; world._rayD = 3; world._ceil = 3; }
    if (t > 26.5 && !obs.r2) { obs.r2 = eng.space; }
    if (t > 15.0 && !obs.e1) { obs.e1 = +eng._encMul.toFixed(2); world._rayD = 3; world._ceil = 3; }
    if (t > 18.5 && !obs.e2) { obs.e2 = +eng._encMul.toFixed(2); }
    if (t > 8.0 && !obs.d) { obs.d = { space: eng.space, uw: eng._uwAuto };
      const before = eng.stats.played, cd0 = eng.stats.cooldown, p2 = { pos: { x: 0, y: 0, z: 0 }, world, hp: 100, maxHp: 100, alive: true, platform: null, onStep: (surface, k) => eng.play('step.' + surface, { vol: 0.35 * k }), onLand: null, onDamage: null }; // game code installs its own generic step handler first, then attaches the engine
      eng.attachPlayer(p2); p2.onStep('concrete', 1); obs.step = { plays: eng.stats.played - before, dropped: eng.stats.cooldown - cd0 };
      const p0 = eng.stats.played, p3 = { pos: { x: 0, y: 0, z: 0 }, world, hp: 100, maxHp: 100, alive: true, platform: null, onStep: null, onLand: null, onDamage: () => eng.play('player.hurt', { vol: 0.8 }) }; eng.attachPlayer(p3); p3.onDamage(30, null); obs.hurt = { plays: eng.stats.played - p0 };
      obs.expl = [eng.explosion({ x: 0, y: 1, z: -10 }, 5.2), eng.explosion({ x: 0, y: 1, z: -30 }, 2.6)].map((h) => (h ? h.v.name : null)); }
  } });
  const sp = (o) => (o ? o.space : null);
  checks.push({ name: 'integration: attachPlayer(player) attaches player.world (occlusion query + auto mode)', ok: obs.attachedWorld && obs.occl, detail: `attached ${obs.attachedWorld}, occlusion ${obs.occl}` });
  checks.push({ name: 'integration: the active stop drives the room (openDusk) and wind (|[3,0,1]|)', ok: sp(obs.a) === 'openDusk' && Math.abs(obs.a.wind - Math.hypot(3, 0, 1)) < 0.01, detail: `space ${sp(obs.a)}, wind ${obs.a && obs.a.wind.toFixed(2)}` });
  checks.push({ name: 'integration: ambience = our calibrated preset for <map>.<stop> with the stop origin', ok: obs.a && obs.a.rts.length === 1 && obs.a.rts[0].cal === true && obs.a.rts[0].sp === 'openDusk', detail: JSON.stringify(obs.a && obs.a.rts) });
  checks.push({ name: 'integration: explicit setSpace(stop reverb) / ambience.set(stop.ambient) join the same room and runtime (no duplicate)', ok: sp(obs.a2) === 'openDusk' && obs.a2.all === 1, detail: `space ${sp(obs.a2)}, runtimes ${obs.a2 && obs.a2.all}` });
  checks.push({ name: 'integration: next stop switches room (tunnel) and ambience (origin follows the stop)', ok: sp(obs.b) === 'tunnel' && obs.b.rts.length === 1 && obs.b.rts[0].sp === 'tunnel' && obs.b.rts[0].org === -90, detail: `space ${sp(obs.b)}, ${JSON.stringify(obs.b && obs.b.rts)}` });
  checks.push({ name: 'integration: world.transit cross-fades both stops\' beds continuously', ok: obs.tr && obs.tr.rts >= 2 && obs.tr.forced, detail: JSON.stringify(obs.tr) });
  checks.push({ name: 'integration: camera below waterY -> underwater room, cleared on leaving', ok: obs.c && obs.c.space === 'underwater' && obs.c.uw > 0.5, detail: JSON.stringify(obs.c) });
  checks.push({ name: 'integration: the ride vehicle is attached automatically (kind from vehicle.name)', ok: obs.a && obs.a.vehicles === 1 && veh._audioKind === 'cage', detail: `vehicles ${obs.a && obs.a.vehicles}, kind ${veh._audioKind}` });
  checks.push({ name: 'integration: a generic step played by game code right after the engine\'s own footstep is dropped', ok: obs.step && obs.step.plays === 1 && obs.step.dropped >= 1, detail: JSON.stringify(obs.step) });
  checks.push({ name: 'integration: player.hurt from both the engine hook and game code plays once (cooldown)', ok: obs.hurt && obs.hurt.plays === 1, detail: JSON.stringify(obs.hurt) });
  checks.push({ name: 'integration: explosion(pos, radius): grenade radius 5.2 -> full blast, 2.6 -> small', ok: obs.expl && obs.expl[0] === 'explosion' && obs.expl[1] === 'explosion.small', detail: JSON.stringify(obs.expl) });
  checks.push({ name: 'integration: occlusion looks for detours: doorway path clear 0, concrete wall beside the door < 0.72, far from it 0.72', ok: !!obs.o2 && obs.o2[0] === 0 && obs.o2[1] < 0.72 && obs.o2[1] >= 0.35 && obs.o2[2] >= 0.7, detail: JSON.stringify(obs.o2) });
  checks.push({ name: 'integration: occlusion depends on the material in the way: glass ~open, wood muffled, concrete strong', ok: !!obs.m2 && obs.m2[0] <= 0.16 && obs.m2[1] >= 0.3 && obs.m2[1] <= 0.5 && obs.m2[2] >= 0.6, detail: `glass ${obs.m2 && obs.m2[0]}, wood ${obs.m2 && obs.m2[1]}, concrete ${obs.m2 && obs.m2[2]}` });
  const rc = eng._recipeFor(A), bellEv = rc && rc.events && rc.events.find((e) => e._auth);
  checks.push({ name: 'integration: authored positional emitters are merged onto the calibrated preset (kept at their position, preset beds/levels/rooms stay)', ok: !!bellEv && Array.isArray(bellEv.pos) && bellEv.pos[0] === 10 && rc.cal === true && rc.events.length >= 3 && !rc.events.some((e) => e.type === 'crow' && e._auth), detail: `authored ${bellEv && bellEv.type} @ ${bellEv && JSON.stringify(bellEv.pos)} gain ${bellEv && bellEv.gain}, ${rc && rc.events.length} events, cal ${rc && rc.cal}` });
  checks.push({ name: 'integration: rooms inside a stop follow the listener probe (tunnels: hall -> tunnelHall, corridor -> tunnel), with a hold time', ok: obs.r1 === 'tunnelHall' && obs.r2 === 'tunnel', detail: `hall probe -> ${obs.r1}, corridor probe -> ${obs.r2}` });
  checks.push({ name: 'integration: room probe: open field lowers the reverb send (< 0.8x), a narrow passage raises it (> 1.25x)', ok: obs.e1 < 0.8 && obs.e2 > 1.25, detail: `open ${obs.e1}x, passage ${obs.e2}x` });
  return { checks, tables: `observations: ${JSON.stringify(obs)}` };
}

/** the ambience recipes that stop authors wrote inside src/maps/**  (extracted by tools/audio-recipes.mjs into window.__mapRecipes): the engine must play them as-is (loose param names, custom room definitions, explicit melodies) at sane levels */
async function testMapRecipes(P) {
  const recs = window.__mapRecipes || {}, names = Object.keys(recs).filter((k) => !recs[k].error), rows = [], checks = [], DUR = +(P.get('ambdur') || 24);
  const warns = []; const ow = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); ow(...a); };
  for (const name of names) {
    const rec = recs[name]; log('map recipe', name); const t0 = performance.now(); const w0 = warns.length;
    const { buf, eng } = await offlineRender(DUR, (eng) => { eng.preferPresets = false; eng.ambience.set(rec, 0.05); eng.lib.drain(0); }, { measure: false, dt: 0.05, step: () => {} });
    const rt = eng.ambience.rts[0], x = mono(buf), st = A.levelStats(x, SR), sp = A.spectralStats(x, SR);
    rows.push({ name, rms: st.rmsDb, peak: st.peakDb, cent: sp.centroid, clip: st.clip, fired: rt ? rt.stats.fired : 0, warns: warns.slice(w0).filter((w) => w.includes('[audio.ambience]')).length, beds: (rec.beds || []).length, evs: (rec.events || []).length }); log('  rendered', name, ((performance.now() - t0) / 1000).toFixed(1) + 's rms', st.rmsDb.toFixed(1));
  }
  console.warn = ow;
  const tables = table(rows, [{ h: 'map recipe (as authored)', f: (r) => r.name, left: 1 }, { h: 'rms dB', f: (r) => fx(r.rms) }, { h: 'peak', f: (r) => fx(r.peak) }, { h: 'centroid', f: (r) => fx(r.cent, 0) }, { h: 'beds', f: (r) => r.beds }, { h: 'events', f: (r) => r.evs }, { h: 'fired', f: (r) => r.fired }, { h: 'warnings', f: (r) => r.warns }]);
  checks.push({ name: 'map recipes: every stop-authored recipe plays (rendered, none silent)', ok: rows.length >= 14 && rows.every((r) => r.rms > -60), detail: `${rows.length} recipes, quietest ${fx(Math.min(...rows.map((r) => r.rms)))} dB` });
  checks.push({ name: 'map recipes: no unknown bed/event types (every authored name is understood)', ok: rows.every((r) => r.warns === 0), detail: rows.filter((r) => r.warns).map((r) => r.name + ':' + r.warns).join(' ') || 'none' });
  checks.push({ name: 'map recipes: levels within -40..-26 dBFS rms as authored', ok: rows.every((r) => r.rms > -40 && r.rms < -26), detail: `${fx(Math.min(...rows.map((r) => r.rms)))}..${fx(Math.max(...rows.map((r) => r.rms)))}` });
  checks.push({ name: 'map recipes: events fire (>= 3 in the render)', ok: rows.every((r) => r.fired >= 3), detail: `min ${Math.min(...rows.map((r) => r.fired))}` });
  return { rows, tables, checks };
}

/** vehicle rigs: loops follow speed (level, spectrum, pitch); event sounds present */
async function testVehicles() {
  const kinds = ['cage', 'gondola', 'ferry', 'monorail'], rows = [], checks = [], sheet = []; const lib = sharedLib();
  for (const kind of kinds) {
    log('vehicle rig', kind);
    const DUR = 16, { buf } = await offlineRender(DUR, (eng) => { eng.vehicleLoop(kind, { speed01: 0, inside: true }); eng.lib.drain(0); }, { measure: false, dt: 0.05, step: (t, eng) => { const k = t < 2 ? 0 : t < 7 ? (t - 2) / 5 : t < 10 ? 1 : Math.max(0, 1 - (t - 10) / 5); eng.vehicleLoop(kind, { speed01: k, inside: true }); } });
    const x = mono(buf), seg = (t0, t1) => x.subarray(Math.floor(t0 * SR), Math.floor(t1 * SR)), pts = [[0.5, 1.5, 0], [3.0, 4.0, 0.25], [4.5, 5.5, 0.5], [6.0, 7.0, 0.8], [8.5, 9.5, 1]];
    const r = pts.map(([a, b, k]) => { const s = seg(a, b), sp = A.spectralStats(s, SR); let pk = 0, pf = 0; for (let i = 1; i < sp.f.length; i++) if (sp.f[i] > 80 && sp.f[i] < 6000 && sp.p[i] > pk) { pk = sp.p[i]; pf = sp.f[i]; } return { k, rms: A.levelStats(s, SR).rmsDb, cent: sp.centroid, peakHz: pf }; });
    rows.push({ kind, r }); sheet.push({ name: `${kind} rig speed 0>1>0`, x, sr: SR, note: `rms ${r.map((q) => fx(q.rms, 0)).join('/')}` });
    checks.push({ name: `vehicle ${kind}: loop level rises with speed (rms(1.0) - rms(0.25) > 3 dB)`, ok: r[4].rms - r[1].rms > 3, detail: `${fx(r[1].rms)} -> ${fx(r[4].rms)} dB` });
    if (kind === 'monorail') checks.push({ name: 'vehicle monorail: motor whine pitch follows speed (peak Hz at 1.0 >= 1.6x at 0.25)', ok: r[4].peakHz >= 1.6 * r[1].peakHz, detail: `${fx(r[1].peakHz, 0)} -> ${fx(r[4].peakHz, 0)} Hz` });
  }
  addImage('vehicles_rigs', A.contactSheet(sheet, { cols: 2, tileW: 560, tileH: 200, fmax: 12000 }));
  const tables = rows.map((v) => `${v.kind.padEnd(9)} speed:   ${v.r.map((q) => fx(q.k, 2).padStart(8)).join('')}\n${''.padEnd(9)} rms dB:  ${v.r.map((q) => fx(q.rms).padStart(8)).join('')}\n${''.padEnd(9)} centroid:${v.r.map((q) => fx(q.cent, 0).padStart(8)).join('')}\n${''.padEnd(9)} peak Hz: ${v.r.map((q) => fx(q.peakHz, 0).padStart(8)).join('')}`).join('\n');
  const need = ['loop', 'door', 'start', 'stop', 'bump', 'creak', 'horn']; const miss = []; for (const k of kinds) for (const n of need) if (!lib.has(`vehicle.${k}.${n}`)) miss.push(`${k}.${n}`);
  checks.push({ name: 'vehicle sounds: vehicle.<cage|gondola|ferry|monorail>.<loop|door|start|stop|bump|creak|horn> all registered', ok: miss.length === 0, detail: miss.join(',') || '28/28' });
  return { rows, tables, checks };
}

/** loudness hierarchy: typical sounds through the full master chain; peak, max 50 ms rms (transients) and max 400 ms rms (sustained) */
async function testLevels() {
  const lib = sharedLib(), shot = shotBuffer(new OfflineAudioContext(1, 128, SR)), eng0 = new AudioEngine(lib), zv = eng0.voices.miner; lib.drain(1);
  const items = [['gunshot (test burst, non-positional)', (e) => e.play(shot, { bus: 'weapon', name: 'shot', jitter: 0 })], ['explosion @10 m', (e) => e.explosion({ x: 0, y: 1.5, z: -10 }, 5.2)], ['zombie attack @6 m', (e) => e.speak(zv, 'attack', { pos: { x: 0, y: 1.5, z: -6 } })], ['zombie idle @12 m', (e) => e.speak(zv, 'idle', { pos: { x: 3, y: 1.5, z: -12 } })], ['impact.concrete @8 m', (e) => e.play('impact.concrete', { pos: { x: 0, y: 1, z: -8 } })], ['flesh.head @4 m', (e) => e.play('flesh.head', { pos: { x: 0, y: 1.5, z: -4 } })], ['bullet.whiz near miss', (e) => e.whiz({ x: -4, y: 1.7, z: -30 }, { x: 0.5, y: 1.7, z: 10 }, { speed: 800 })], ['footstep (player, concrete)', (e) => e.play('step.concrete.walk.L', { pos: { x: 0.1, y: 0.05, z: 0 } })], ['footstep sprint', (e) => e.play('step.concrete.sprint.L', { pos: { x: 0.1, y: 0.05, z: 0 } })], ['ui.point', (e) => e.play('ui.point', { bus: 'ui' })], ['ui.buy', (e) => e.play('ui.buy', { bus: 'ui' })], ['perk.juggernog', (e) => e.play('perk.juggernog', { bus: 'ui' })], ['ui.round.start', (e) => e.play('ui.round.start', { bus: 'ui' })], ['player.heartbeat', (e) => e.play('player.heartbeat', {})], ['casing.brass @1 m', (e) => e.play('casing.brass.concrete', { pos: { x: 0.5, y: 0, z: -1 } })], ['ambience: shaft-nine.surface', (e) => { e.ambience.set('shaft-nine.surface', 0.05); }]];
    // (the ambience item renders 28 s instead of 7 s: its one-shots are random)
const rows = []; for (const [name, fn] of items) { const { buf } = await offlineRender(name.startsWith('ambience') ? 28 : 7, (eng) => { fn(eng); eng.lib.drain(0); }, { measure: false, dt: 0.05, step: () => {} }); const L = buf.getChannelData(0), R = buf.getChannelData(1), m = new Float32Array(L.length); for (let i = 0; i < L.length; i++) m[i] = 0.5 * (L[i] + R[i]); let mom = -200, sh = -200; const wins = [], w4 = Math.floor(0.4 * SR), w5 = Math.floor(0.05 * SR), hop = Math.floor(0.025 * SR); for (let i = 0; i + w4 <= m.length; i += hop) { const rr = A.levelStats(m.subarray(i, i + w4), SR).rmsDb; wins.push(rr); mom = Math.max(mom, rr); } wins.sort((a, b) => a - b); const momP90 = wins[Math.floor(wins.length * 0.9)]; for (let i = 0; i + w5 <= m.length; i += Math.floor(0.01 * SR)) sh = Math.max(sh, A.levelStats(m.subarray(i, i + w5), SR).rmsDb); rows.push({ name, peak: Math.max(A.levelStats(L, SR).peakDb, A.levelStats(R, SR).peakDb), short50: sh, mom, momP90, rmsAll: A.levelStats(m, SR).rmsDb }); }
  const tables = table(rows, [{ h: 'sound', f: (r) => r.name, left: 1 }, { h: 'peak dBFS', f: (r) => fx(r.peak) }, { h: 'max 50 ms rms', f: (r) => fx(r.short50) }, { h: 'max 400 ms rms', f: (r) => fx(r.mom) }, { h: 'p90 400 ms rms', f: (r) => fx(r.momP90) }]);
  const g = (n) => rows.find((r) => r.name.startsWith(n)); const chk = [
    { name: 'levels: explosion @10 m is >= 3 dB louder than a zombie attack @6 m (50 ms rms)', ok: g('explosion').short50 >= g('zombie attack').short50 + 3, detail: `${fx(g('explosion').short50)} vs ${fx(g('zombie attack').short50)} dBFS` },
    { name: 'levels: zombie attack sits >= 12 dB above the ambience\'s average level (400 ms rms vs the recipe\'s mean rms; its random events make single 400 ms windows vary +-4 dB from run to run, windows p90 is listed too)', ok: g('zombie attack').mom >= g('ambience').rmsAll + 12, detail: `${fx(g('zombie attack').mom)} vs ${fx(g('ambience').rmsAll)} dBFS mean (p90 window ${fx(g('ambience').momP90)}, max ${fx(g('ambience').mom)})` },
    { name: 'levels: a bullet impact @8 m is >= 6 dB above the player\'s own footstep (50 ms rms)', ok: g('impact.concrete').short50 >= g('footstep (player').short50 + 6, detail: `${fx(g('impact.concrete').short50)} vs ${fx(g('footstep (player').short50)} dBFS` },
    { name: 'levels: round stinger stays below the explosion and >= 12 dB above the ambience mean (400 ms rms)', ok: g('ui.round.start').mom < g('explosion').mom && g('ui.round.start').mom >= g('ambience').rmsAll + 12, detail: `${fx(g('ui.round.start').mom)} vs expl ${fx(g('explosion').mom)} / amb mean ${fx(g('ambience').rmsAll)}` },
    { name: 'levels: no peak above -0.5 dBFS through the master chain', ok: rows.every((r) => r.peak < -0.5), detail: `max ${fx(Math.max(...rows.map((r) => r.peak)), 2)}` }];
  return { rows, tables, checks: chk };
}

// ---------------------------------------------------------------------------------------------------------------- interactive UI
async function ui(P) {
  const audio = globalAudio; window.audio = audio; const root = document.getElementById('ui'); root.style.cssText = 'position:fixed;inset:0;overflow:auto;background:#0e1014;color:#d8dce6;font:13px/1.35 system-ui,sans-serif;padding:12px 16px';
  root.innerHTML = '<h2 style="margin:0 0 6px">Dead Ride — audio lab</h2><button id=go style="font-size:16px;padding:8px 18px">Start audio (needs a click)</button><pre id=info style="color:#9fb3d0"></pre>'; const info = root.querySelector('#info');
  await new Promise((r) => { root.querySelector('#go').onclick = r; if (P.get('auto')) r(); });
  const t0 = performance.now(); await audio.init(); root.querySelector('#go').remove(); window.__ready = true;
  const listener = { pos: { x: 0, y: 1.7, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } }, st = { space: 'open', muffle: 0, underwater: 0, wind: 0 }, ctl = { dist: 10, az: 0, yaw: 0, occ: 0, hrtf: true }, fake = { pos: { x: 0, y: 0, z: 0 }, hp: 100, maxHp: 100, alive: true, right: { x: 1, y: 0, z: 0 }, platform: null, onStep: null, onLand: null, onDamage: null };
  audio.attachPlayer(fake); const init = performance.now() - t0; let last = performance.now(), fr = 0;
  // meters
  const an = audio.ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0.8; audio.master.connect(an); const cv = document.createElement('canvas'); cv.width = 720; cv.height = 150; cv.style.cssText = 'background:#08090c;border:1px solid #223;display:block;margin:6px 0'; root.appendChild(cv); const g = cv.getContext('2d'), fb = new Uint8Array(an.frequencyBinCount), tb = new Float32Array(2048);
  const draw = () => { an.getByteFrequencyData(fb); g.fillStyle = '#08090c'; g.fillRect(0, 0, 720, 150); const sr = audio.ctx.sampleRate; for (let x = 0; x < 640; x++) { const f = 30 * Math.pow(20000 / 30, x / 640), k = Math.min(fb.length - 1, Math.round(f / (sr / 2) * fb.length)), v = fb[k] / 255; g.fillStyle = `hsl(${200 - v * 160},80%,${25 + v * 45}%)`; g.fillRect(x, 150 - v * 140, 1, v * 140); } an.getFloatTimeDomainData(tb); let pk = 0, ss = 0; for (const v of tb) { pk = Math.max(pk, Math.abs(v)); ss += v * v; } const db = (v) => Math.max(-70, 20 * Math.log10(v + 1e-6)); g.fillStyle = '#5c8'; g.fillRect(650, 145 - (db(Math.sqrt(ss / tb.length)) + 70) * 2, 20, 6); g.fillStyle = '#e85'; g.fillRect(680, 145 - (db(pk) + 70) * 2, 20, 6); };
  const loop = () => { const n = performance.now(), dt = (n - last) / 1000; last = n; const a = ctl.yaw * Math.PI / 180; listener.forward.x = -Math.sin(a); listener.forward.z = -Math.cos(a); st.wind = 4; audio.update(dt, listener, st); if ((fr++ & 7) === 0) { info.textContent = `init ${init.toFixed(0)} ms · ${audio.ctx.sampleRate} Hz · workers ${audio.workersUsed} · voices ${audio.stats.voices}/${audio.voiceCap} (peak ${audio.stats.peakVoices}, stolen ${audio.stats.stolen}, dropped ${audio.stats.dropped}, deferred ${audio.stats.deferred || 0}) · update ${audio.stats.updateMs.toFixed(3)} ms · library ${audio.lib.pending} pending · space ${audio.space}`; } draw(); requestAnimationFrame(loop); }; loop();
  const row = (label) => { const d = document.createElement('div'); d.style.cssText = 'margin:4px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap'; if (label) d.innerHTML = `<b style="min-width:110px">${label}</b>`; root.appendChild(d); return d; };
  const sel = (parent, opts, val, onchange) => { const s = document.createElement('select'); for (const o of opts) { const e = document.createElement('option'); e.value = e.textContent = o; s.appendChild(e); } if (val) s.value = val; s.onchange = () => onchange(s.value); parent.appendChild(s); return s; };
  const sld = (parent, label, min, max, val, onchange, step = 'any') => { const w = document.createElement('label'); w.innerHTML = `${label} <input type=range min=${min} max=${max} step=${step} value=${val} style="width:170px;vertical-align:middle"> <span style="display:inline-block;min-width:44px">${val}</span>`; const i = w.querySelector('input'), sp = w.querySelector('span'); i.oninput = () => { sp.textContent = (+i.value).toFixed(2); onchange(+i.value); }; parent.appendChild(w); return i; };
  const btn = (parent, text, fn, col) => { const b = document.createElement('button'); b.textContent = text; b.style.cssText = 'padding:3px 8px;background:' + (col || '#1c2230') + ';color:#dde;border:1px solid #334;border-radius:4px;cursor:pointer'; b.onclick = fn; parent.appendChild(b); return b; };
  const posAt = () => { const a = ctl.az * Math.PI / 180; return { x: Math.sin(a) * ctl.dist, y: 1.5, z: -Math.cos(a) * ctl.dist }; };
  let r = row('World'); sel(r, Object.keys(SPACES), 'open', (v) => { st.space = v; audio.setSpace(v, 0.8); }); sld(r, 'muffle', 0, 1, 0, (v) => (st.muffle = v)); sld(r, 'underwater', 0, 1, 0, (v) => (st.underwater = v)); sld(r, 'master', 0, 1.5, 1, (v) => (audio.masterVolume = v));
  r = row('Source'); sld(r, 'distance m', 1, 300, 10, (v) => (ctl.dist = v)); sld(r, 'azimuth °', -180, 180, 0, (v) => (ctl.az = v)); sld(r, 'listener yaw °', -180, 180, 0, (v) => (ctl.yaw = v)); sld(r, 'occlusion', 0, 1, 0, (v) => (ctl.occ = v));
  r = row('Combat'); btn(r, 'gunshot burst', () => audio.play(shotBuffer(audio.ctx), { pos: posAt(), bus: 'weapon', minDist: 6, maxDist: 600, occlusion: ctl.occ || undefined, sos: 1, name: 'test.shot' })); btn(r, 'explosion', () => audio.explosion(posAt(), 6.8)); btn(r, 'explosion @2 m (tinnitus)', () => audio.explosion({ x: 1.2, y: 1.5, z: -1.6 }, 8.3)); btn(r, 'bullet whiz L→R (800 m/s)', () => audio.whiz({ x: -40, y: 1.7, z: -3 }, { x: 40, y: 1.7, z: -3 }, { speed: 800 })); btn(r, 'subsonic whiz (250 m/s, Doppler)', () => audio.whiz({ x: -40, y: 1.7, z: -3 }, { x: 40, y: 1.7, z: -3 }, { speed: 250, window: 0.16 })); btn(r, 'ricochet', () => audio.play('ricochet', { pos: posAt() })); btn(r, 'impact (surface ▼)', () => audio.impact(surf.value, posAt(), { caliber: 1 })); const surf = sel(r, ['concrete', 'brick', 'rock', 'metal', 'wood', 'snow', 'ice', 'water', 'glass', 'crystal', 'lava', 'fabric', 'dirt', 'gravel', 'plastic', 'tile', 'grass', 'flesh'], 'concrete', () => {});
  r = row('Player'); btn(r, 'step (surface ▼)', () => audio.step(stepSurf.value, 1, fake)); btn(r, 'sprint step', () => audio.step(stepSurf.value, 1.4, fake)); btn(r, 'crouch step', () => audio.step(stepSurf.value, 0.45, fake)); btn(r, 'auto-walk 6 steps', () => { let k = 0; const iv = setInterval(() => { audio.step(stepSurf.value, 1, fake); if (++k >= 6) clearInterval(iv); }, 520); }); btn(r, 'land', () => audio.land(7, stepSurf.value, fake)); btn(r, 'hurt', () => audio.hurt(20, fake)); const stepSurf = sel(r, ['concrete', 'brick', 'rock', 'metal', 'wood', 'snow', 'ice', 'water', 'dirt', 'gravel', 'grass', 'tile', 'carpet', 'crystal', 'lava'], 'concrete', () => {}); sld(r, 'player HP', 0, 100, 100, (v) => (fake.hp = v));
  r = row('Ambience'); const presets = Object.keys(audio.ambience.presets); sel(r, ['(stop)', ...presets], '(stop)', (v) => { if (v === '(stop)') audio.ambience.stop(2); else audio.ambience.set(v, +fade.value || 2.5); }); const fade = document.createElement('input'); fade.type = 'number'; fade.value = 3; fade.style.width = '48px'; r.append(' crossfade s ', fade);
  const blA = sel(r, presets, presets[0], () => {}), blB = sel(r, presets, presets[5], () => {}); sld(r, 'blend A→B', 0, 1, 0, (v) => audio.ambience.blend(blA.value, blB.value, v));
  r = row('Vehicles'); for (const k of ['cage', 'gondola', 'ferry', 'monorail']) { const d = document.createElement('span'); d.innerHTML = `<b>${k}</b> `; sld(d, 'speed', 0, 1.2, 0, (v) => audio.vehicleLoop(k, { speed01: v, inside: true })); for (const e of ['door', 'door.close', 'start', 'stop', 'bump', 'creak', 'horn', 'bell']) btn(d, e, () => audio.play(`vehicle.${k}.${e}`, {})); btn(d, 'interior room', () => { audio.setListenerVehicle(k); }, '#243'); btn(d, 'exit', () => audio.setListenerVehicle(null)); r.appendChild(d); r.appendChild(document.createElement('br')); }
  r = row('Zombie voices'); for (const k of Object.keys(audio.voices)) { const set = audio.voices[k], d = document.createElement('span'); d.innerHTML = `<b>${k}</b> `; for (const cat of ['idle', 'attack', 'pain', 'death', 'spawn', 'sprint']) btn(d, cat, () => audio.speak(set, cat, { pos: posAt() })); r.appendChild(d); r.appendChild(document.createElement('br')); }
  const ta = document.createElement('textarea'); ta.value = JSON.stringify({ kind: 'guard', f0: [80, 125], rasp: 0.6, size: 1.15, seed: 7 }); ta.style.cssText = 'width:420px;height:40px;background:#111;color:#bdf'; r.append('custom profile: ', ta); btn(r, 'build + speak attack', () => { try { const set = audio.zombieVoice(JSON.parse(ta.value)); set.ready.then(() => audio.speak(set, 'attack', { pos: posAt() })); } catch (e) { alert(e); } });
  const groups = new Map(); for (const n of audio.names().sort()) { if (n.startsWith('ir.') || n.startsWith('amb.bed') || n.startsWith('amb.noise') || n.startsWith('voice.')) continue; const g0 = n.startsWith('amb.evt') ? 'amb.evt' : n.split('.')[0]; if (!groups.has(g0)) groups.set(g0, []); groups.get(g0).push(n); }
  const all = document.createElement('div'); all.innerHTML = '<h4 style="margin:12px 0 4px">All registered sounds</h4>'; root.appendChild(all);
  for (const [g0, names] of groups) { const d = document.createElement('details'); d.innerHTML = `<summary style="cursor:pointer">${g0} (${names.length})</summary>`; for (const n of names) { const isUI = g0 === 'ui' || g0 === 'perk' || g0 === 'powerup' || g0 === 'player'; btn(d, n.slice(g0.length + 1) || n, () => audio.play(n, { pos: isUI ? null : posAt(), bus: isUI ? 'ui' : undefined, occlusion: ctl.occ || undefined })); d.lastChild.style.margin = '2px'; } all.appendChild(d); }
}
