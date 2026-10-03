// Frame-time statistics + on-screen counter (F3) + benchmark recorder used by tools/bench.mjs (window.__perf).
/** quality rungs, best → worst: render scale + zombie quality level (0 = full, 1 = medium, 2 = low, 3 = minimal) */
export const PerfLadder = [{ scale: 1, zq: 0 }, { scale: 1, zq: 1 }, { scale: 0.87, zq: 1 }, { scale: 0.87, zq: 2 }, { scale: 0.75, zq: 2 }, { scale: 0.65, zq: 3 }, { scale: 0.55, zq: 3 }];
export class Perf {
  constructor(gfx, hud) {
    this.gfx = gfx; this.hud = hud; this.ft = new Float32Array(600); this.n = 0; this.i = 0; this.tAcc = 0; this.frames = 0; this.fps = 60; this.recording = null; this.slow = 0; this.fast = 0; this.info = ''; this.on = false;
    this.last = performance.now();
  }
  toggle(v = !this.on) { this.on = v; this.hud.setPerf(v); }
  /** call once per rAF with raw delta (ms) */
  frame(ms, extra = '') {
    this.ft[this.i] = ms; this.i = (this.i + 1) % this.ft.length; this.n = Math.min(this.n + 1, this.ft.length); this.tAcc += ms; this.frames++;
    if (this.recording) { const r = this.recording; r.ft.push(ms); if (this.gfx.gpuMs) r.gpu.push(this.gfx.gpuMs); r.calls = Math.max(r.calls, this.gfx.stats.calls); r.tris = Math.max(r.tris, this.gfx.stats.tris); const m = performance.memory; if (m) r.heap.push(m.usedJSHeapSize / 1048576); }
    if (this.tAcc >= 500) { this.fps = this.frames * 1000 / this.tAcc; this.tAcc = 0; this.frames = 0; this.updateText(extra); }
  }
  stats(arr = null) {
    const a = arr ? Float64Array.from(arr) : Float64Array.from(this.ft.subarray(0, this.n)); if (!a.length) return { p50: 0, p95: 0, p99: 0, max: 0, avg: 0, over16: 0, over20: 0, over33: 0, n: 0 };
    a.sort(); const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))]; let s = 0, o16 = 0, o20 = 0, o33 = 0; for (const v of a) { s += v; if (v > 16.9) o16++; if (v > 20) o20++; if (v > 33) o33++; }
    return { p50: q(0.5), p95: q(0.95), p99: q(0.99), p999: q(0.999), max: a[a.length - 1], avg: s / a.length, over16: o16, over20: o20, over33: o33, n: a.length };
  }
  updateText(extra) {
    if (!this.on) return; const s = this.stats(), g = this.gfx, st = g.stats, m = performance.memory;
    const txt = `${this.fps.toFixed(0)} FPS  ${s.avg.toFixed(1)} ms avg\np99 ${s.p99.toFixed(1)} ms  max ${s.max.toFixed(1)} ms\nGPU ${(g.gpuMsAvg || 0).toFixed(1)} ms   res ${(g.renderScale * 100).toFixed(0)}%\ncalls ${st.calls}  tris ${(st.tris / 1000).toFixed(0)}k  tex ${st.tex}\n${m ? 'heap ' + (m.usedJSHeapSize / 1048576).toFixed(0) + ' MB  ' : ''}${extra}`;
    this.hud.perf(txt, Array.from(this.ft.subarray(Math.max(0, this.n - 120), this.n)));
  }
  start(name) { this.recording = { name, ft: [], gpu: [], heap: [], calls: 0, tris: 0, t0: performance.now() }; }
  stop() { const r = this.recording; this.recording = null; if (!r) return null; const s = this.stats(r.ft); const g = r.gpu.length ? r.gpu.reduce((a, b) => a + b, 0) / r.gpu.length : 0; const gs = Float64Array.from(r.gpu).sort(); return { name: r.name, ...s, gpuAvg: g, gpuP99: gs.length ? gs[Math.floor(gs.length * 0.99)] : 0, calls: r.calls, tris: r.tris, heapStart: r.heap[0] || 0, heapEnd: r.heap[r.heap.length - 1] || 0, seconds: (performance.now() - r.t0) / 1000 }; }
  /** adaptive resolution: call each frame when dynamic resolution is enabled */
  /** adaptive quality ladder (dynamic resolution + zombie detail): GPU-bound / slow frames step DOWN quickly (0.4 s), headroom steps UP slowly (6 s).
   *  Zombie detail (nearest full-detail bodies, near-shader distance, triangle budget) is reduced BEFORE the resolution drops much: a few far zombies at lower detail is far less visible than a blurry screen. */
  adapt(dt) {
    const g = this.gfx; if (!g.dynRes) return; const ms = dt * 1000, gms = g.gpuMsAvg || 0;
    if (ms > 45) return; // single hitches (loading / GC) do not count
    if (ms > 17.4 || gms > 13.8) { this.slow += dt; this.fast = 0; } else if (ms < 13.2 && gms < 10.8) { this.fast += dt; this.slow = 0; } else { this.slow = Math.max(0, this.slow - dt * 0.5); this.fast = Math.max(0, this.fast - dt); }
    const L = PerfLadder; let k = this.rung ?? 0; const step = (d) => { k = Math.max(0, Math.min(L.length - 1, k + d)); this.rung = k; g.setRenderScale(L[k].scale); const z = window.__g?.zombies; if (z && z.setQualityRung) z.setQualityRung(L[k].zq); };
    if (this.slow > 0.4 && k < L.length - 1) { step(ms > 26 && k < L.length - 2 ? 2 : 1); this.slow = 0; } else if (this.fast > 6 && k > 0) { step(-1); this.fast = 0; }
  }


}
