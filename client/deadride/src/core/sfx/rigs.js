// Speed-driven vehicle sound rigs: looping layers whose gain and pitch (playbackRate) follow the vehicle's speed, plus randomly scheduled physical events
// (hull creaks, wave slaps, rope creaks). audio.vehicleLoop(name, {speed | speed01, inside, pos, load}) drives them; audio.attachVehicle() calls it every frame.
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const vehicleKind = (n) => { n = String(n || '').toLowerCase(); for (const k of ['cage', 'gondola', 'ferry', 'monorail']) if (n.includes(k)) return k; if (n.includes('elevator') || n.includes('lift') || n.includes('mine')) return 'cage'; if (n.includes('cable') || n.includes('gondel') || n.includes('tram')) return 'gondola'; if (n.includes('boat') || n.includes('ship')) return 'ferry'; if (n.includes('rail') || n.includes('train')) return 'monorail'; return null; };

// layer: buffer name, gain(k, ctx) 0..1.2, rate(k) playbackRate
const RIGS = {
  cage: { vmax: 9, layers: [
    { n: 'vehicle.cage.hum', g: (k) => 0.55 * sstep(0.0, 0.12, k) * (0.6 + 0.6 * k), r: (k) => 0.72 + 0.55 * k },
    { n: 'vehicle.cage.rope', g: (k) => 0.55 * k, r: (k) => 0.8 + 0.4 * k },
    { n: 'vehicle.cage.rail', g: (k) => 0.75 * Math.pow(k, 1.2), r: (k) => 0.55 + 1.1 * k } ],
    events: [{ n: 'vehicle.cage.creak', every: [4, 9], when: (k) => k > 0.05, vol: 0.5 }] },
  gondola: { vmax: 7, layers: [
    { n: 'vehicle.gondola.hum', g: (k) => 0.45 * sstep(0.0, 0.1, k) * (0.4 + 0.9 * k), r: (k) => 0.8 + 0.4 * k },
    { n: 'vehicle.gondola.wind', g: (k) => 0.25 + 0.65 * k, r: (k) => 0.9 + 0.2 * k } ],
    events: [{ n: 'vehicle.gondola.creak', every: [5, 11], when: (k) => k > 0.05, vol: 0.5 }] },
  ferry: { vmax: 8, layers: [
    { n: 'vehicle.ferry.engine.idle', g: (k) => 0.6 * (1 - sstep(0.15, 0.7, k)) + 0.08, r: (k) => 0.9 + 0.2 * k },
    { n: 'vehicle.ferry.engine.cruise', g: (k) => 1.2 * sstep(0.1, 0.65, k), r: (k) => 0.82 + 0.3 * k },
    { n: 'vehicle.ferry.water', g: (k) => 0.12 + 0.75 * k, r: (k) => 0.9 + 0.2 * k } ],
    events: [{ n: 'vehicle.ferry.slap', every: [1.2, 3.2], scaleK: true, when: () => true, vol: 0.7 }, { n: 'vehicle.ferry.creak', every: [6, 13], when: () => true, vol: 0.6 }] },
  monorail: { vmax: 22, layers: [
    { n: 'vehicle.monorail.motor', g: (k) => 0.55 * (0.1 + 0.9 * sstep(0.0, 0.2, k)) * (0.4 + 0.6 * k), r: (k) => 0.55 + 1.6 * k },
    { n: 'vehicle.monorail.joint', g: (k) => 0.7 * sstep(0.02, 0.2, k) * (0.3 + 0.7 * k), r: (k) => 0.4 + 2.2 * k },
    { n: 'vehicle.monorail.whoosh', g: (k) => 0.8 * k * k, r: (k) => 0.85 + 0.35 * k } ],
    events: [{ n: 'vehicle.monorail.creak', every: [7, 15], when: (k) => k > 0.1, vol: 0.35 }] },
};

export class VehicleRigs {
  constructor(engine) { this.e = engine; this.rigs = new Map(); this.t = 0; }
  /** drive a rig; p = {speed (m/s) | speed01, inside, pos, active}. p === null / active:false fades it out. */
  drive(kind, p) {
    const def = RIGS[kind]; if (!def) return; if (!p || p.active === false) { this.stop(kind); return; }
    let r = this.rigs.get(kind); if (!r) { r = { kind, def, h: [], inside: null, k: 0, kT: 0, last: 0, ev: def.events.map((e) => ({ next: 0 })), pos: null }; this.rigs.set(kind, r); this.e.lib.promotePrefix(`vehicle.${kind}.`, 1); }
    r.kT = p.speed01 !== undefined ? clamp(p.speed01, 0, 1.4) : clamp((p.speed || 0) / def.vmax, 0, 1.4); r.inside = p.inside === undefined ? r.inside ?? true : !!p.inside; r.pos = p.pos || r.pos; r.last = this.e.time; r.load = p.load ?? 1;
  }
  stop(kind, fade = 0.6) { const r = this.rigs.get(kind); if (!r) return; for (const l of r.h) if (l.handle) l.handle.stop(fade); this.rigs.delete(kind); }
  _start(r) {
    const e = this.e; for (const l of r.h) if (l.handle) l.handle.stop(0.3); r.h = []; r.startedInside = r.inside;
    for (const L of r.def.layers) { const handle = e.play(L.n, { loop: true, vol: 0.0001, pitch: 1, jitter: 0, bus: 'sfx', pos: r.inside ? null : (r.pos || null), follow: r.inside ? null : r.pos, offset: 'random', prio: 6, send: r.inside ? 0.5 : 1, minDist: 8, maxDist: 250, name: L.n + (r.inside ? '.in' : '.out') }); r.h.push({ L, handle, g: 0, rate: 1 }); }
  }
  update(dt) {
    const e = this.e; this.t += dt;
    for (const [kind, r] of this.rigs) {
      if (e.time - r.last > 0.7) { this.stop(kind, 1.0); continue; }
      r.k += (r.kT - r.k) * (1 - Math.exp(-dt * 2.2)); if (r.h.length === 0 || r.startedInside !== r.inside) this._start(r);
      const k = r.k, mul = r.inside ? 1 : 0.85;
      for (const l of r.h) { if (!l.handle || !l.handle.playing) { l.handle = e.play(l.L.n, { loop: true, vol: 0.0001, jitter: 0, bus: 'sfx', pos: r.inside ? null : r.pos, follow: r.inside ? null : r.pos, offset: 'random', prio: 6, send: r.inside ? 0.5 : 1, minDist: 8, maxDist: 250, name: l.L.n + (r.inside ? '.in' : '.out') }); if (!l.handle) continue; }
        const g = l.L.g(k) * mul * (r.load || 1), rate = l.L.r(k); if (Math.abs(g - l.g) > 0.01 * (g + 0.05)) { l.g = g; l.handle.setVol(Math.max(g, 0.0001), 0.12); } if (Math.abs(rate - l.rate) > 0.004) { l.rate = rate; l.handle.setPitch(rate, 0.2); } }
      r.def.events.forEach((ev, i) => { const st = r.ev[i]; if (e.time >= st.next) { const [a, b] = ev.every, sk = ev.scaleK ? 0.35 + 1.2 * k : 1; st.next = e.time + (a + Math.random() * (b - a)) / sk; if (ev.when(k) && e.lib.has(ev.n)) e.play(ev.n, { pos: r.inside ? null : r.pos, vol: ev.vol * (0.6 + 0.6 * Math.random()), pitch: 0.92 + Math.random() * 0.16, bus: 'sfx' }); } });
    }
  }
}
