// World: loads a map (all stops + vehicle + route scenery), owns per-stop runtime state, atmosphere blending, world queries.
// Stops are authored in LOCAL coordinates around their own origin; the world adds `origin` (translation only).
import * as THREE from 'three';
import { Builder } from './build.js';
import { compileAtmo } from './gfx.js';
import { NavGrid } from './nav.js';
import { G } from './mats.js';
import { makeRng, clamp, lerp } from './util.js';

const V = new THREE.Vector3();

export class StopRuntime {
  constructor(def, index, world) {
    this.def = def; this.index = index; this.world = world; this.id = def.id; this.name = def.name;
    this.origin = new THREE.Vector3(...(def.origin || [0, 0, 0]));
    this.group = new THREE.Group(); this.group.position.copy(this.origin); this.group.name = 'stop:' + def.id;
    this.viewRadius = def.viewRadius ?? 260; this.center = new THREE.Vector3();
    this.lightSources = []; this.weather = []; this.data = null; this.visible = true; this.intensity = 0;
  }
  // world <-> local
  toLocal(x, y, z, out) { out.set(x - this.origin.x, y - this.origin.y, z - this.origin.z); return out; }
  get colliders() { return this.B.colliders; }
}

export class World {
  constructor(gfx, synth, fx) {
    this.gfx = gfx; this.synth = synth; this.fx = fx; this.root = new THREE.Group(); this.root.name = 'world'; this.root.matrixAutoUpdate = false; gfx.scene.add(this.root); gfx.vmSkip?.add(this.root);
    this.stops = []; this.map = null; this.active = null; this.activeIndex = 0; this.transit = null; this.vehicle = null; this.routeGroup = null; this.time = 0; this.listeners = [];
    this._o = {}; this._g = { y: 0, surface: 'concrete', col: null };
  }

  // ---------------------------------------------------------------- loading
  /** Staged load: heroOnly builds just stop 0 (menu preview); loadRest() builds the remaining stops + route + vehicle. */
  async loadMap(mapDef, onProgress = () => {}, { heroOnly = false } = {}) {
    this.unload(); this.map = mapDef; this.loadedAll = false;
    await this.synth.warm(true);
    const n = heroOnly ? 1 : mapDef.stops.length; await this._buildStops(0, n, onProgress, mapDef.stops.length);
    if (!heroOnly) await this._buildRest(onProgress); else this.setActive(0);
    return this;
  }
  async loadRest(onProgress = () => {}) { if (this.loadedAll) return; const n = this.map.stops.length; await this._buildStops(this.stops.length, n, onProgress, n); await this._buildRest(onProgress); }
  async _buildStops(from, to, onProgress, total) {
    const mapDef = this.map;
    for (let i = from; i < to; i++) {
      onProgress(i / (total + 2), `Building ${mapDef.stops[i].name}…`);
      const st = await this._buildStop(mapDef.stops[i], i); this.stops.push(st); this.root.add(st.group);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  async _buildRest(onProgress) {
    const mapDef = this.map, n = mapDef.stops.length; let done = n;
    if (mapDef.buildRoute && !this.routeGroup) { onProgress(done / (n + 2), 'Building route…'); this.routeGroup = new THREE.Group(); this.routeGroup.name = 'route'; this.root.add(this.routeGroup); const B = new Builder({ synth: this.synth, group: this.routeGroup, seed: 77 }); this.routeData = await mapDef.buildRoute(this._ctx(B, null)); B.finish(); this.routeB = B; done++; }
    if (mapDef.buildVehicle && !this.vehicle) { onProgress(done / (n + 2), 'Building vehicle…'); this.vehicle = await mapDef.buildVehicle(this._ctx(null, null)); this.root.add(this.vehicle.group); }
    onProgress(1, 'Ready'); this.loadedAll = true; this.setActive(this.activeIndex || 0);
  }
  unload() {
    for (const s of this.stops) { for (const l of s.lightSources) this.gfx.removeLight(l); for (const w of s.weather) this.fx.removeWeather(w.w); }
    this.root.clear(); this.stops = []; this.active = null; this.vehicle = null; this.routeGroup = null; this.transit = null; this.fx.clearWorldFX();
  }
  _ctx(B, stop) {
    const w = this;
    return {
      B, synth: this.synth, gfx: this.gfx, fx: this.fx, THREE, rng: makeRng(stop ? stop.index * 977 + 13 : 4242), stop, world: this, group: stop ? stop.group : this.root,
      origin: stop ? stop.origin : new THREE.Vector3(),
      /** register a light (LOCAL coords). Returns the source (mutable). Enabled automatically when the stop is near. */
      light(o) { const src = w.gfx.addLight({ ...o, pos: (o.pos.isVector3 ? o.pos.clone() : new THREE.Vector3(...o.pos)).add(stop.origin), dir: o.dir ? (o.dir.isVector3 ? o.dir.clone() : new THREE.Vector3(...o.dir)) : undefined, enabled: false }); src._local = o.pos.isVector3 ? o.pos.clone() : new THREE.Vector3(...o.pos); stop.lightSources.push(src); return src; },
      /** volumetric weather (snow, rain, embers, dust...) — see fx.VolumeWeather cfg. Returns handle. */
      weather(cfg) { const wx = w.fx.addWeather(cfg); wx.mesh.visible = false; const h = { w: wx, base: cfg.alpha ?? 0.8 }; stop.weather.push(h); return h; },
      env(atmoDef, patches, res) { return w.gfx.makeEnv(atmoDef, patches, res); },
    };
  }
  async _buildStop(def, index) {
    const st = new StopRuntime(def, index, this); st.B = new Builder({ synth: this.synth, group: st.group, seed: index * 131 + 7 });
    const ctx = this._ctx(st.B, st);
    const data = (await def.build(ctx)) || {}; st.B.finish(); st.data = data;
    st.atmoDef = data.atmo || {}; st.atmo = compileAtmo(st.atmoDef); st.atmo.envTex = data.envTex || this.gfx.makeEnv(st.atmoDef, data.envPatches || []); st.atmo.name = def.id;
    st.spawns = data.spawns || []; st.playerStart = data.playerStart || { pos: [0, 0, 0], yaw: 0 }; st.station = data.station || { pos: [0, 0, 0], yaw: 0 }; st.buys = data.buys || { walls: [], perks: [], box: null };
    st.ambient = data.ambient || null; st.update = data.update || null; st.zombieVariants = data.zombieVariants || null; st.landmark = data.landmark || null;
    const b = st.B.colliders.bounds; const nb = data.navBounds ? { minX: data.navBounds[0], minZ: data.navBounds[1], maxX: data.navBounds[2], maxZ: data.navBounds[3] } : b;
    st.center.set((nb.minX + nb.maxX) / 2, 0, (nb.minZ + nb.maxZ) / 2).add(st.origin); st.navBounds = nb;
    if (data.groundY !== undefined) st.B.colliders.groundY = data.groundY; if (data.heightFn) st.B.colliders.heightFn = data.heightFn; if (data.surfaceAt) st.B.colliders.surfaceAt = data.surfaceAt; if (data.groundSurface) st.B.colliders.groundSurface = data.groundSurface;
    if (data.waterY !== undefined) st.B.colliders.waterY = data.waterY;
    st.nav = data.nav === false ? null : new NavGrid(st.B.colliders, nb, data.navCell || 0.6, 0.38, { blockedFn: data.navBlocked });
    for (const l of st.B.lights) { /* lights added via ctx.light already */ }
    if (data.onReady) data.onReady(st);
    st.group.visible = false;
    // a stop's group never moves: freeze it so three.js's per-frame updateMatrixWorld does not re-multiply every static descendant (force propagation)
    st.group.updateMatrixWorld(true); st.group.matrixAutoUpdate = false; st.group.updateMatrix(); st.group.matrixWorldNeedsUpdate = false;
    return st;
  }

  // ---------------------------------------------------------------- state
  /** Show/hide the whole world (several Worlds can coexist, e.g. menu heroes); hidden worlds contribute no lights/weather. */
  setShown(v) {
    this.root.visible = v; this.shown = v;
    if (!v) { for (const s of this.stops) { for (const l of s.lightSources) l.enabled = false; for (const h of s.weather) h.w.mesh.visible = false; } }
    else if (this.active) { this._refreshVisibility(true); this._applyWeather(); }
  }
  /** Make every stop / route / vehicle visible for one un-culled warm-up frame (shader compile), then restore visibility. */
  async warm() {
    const saved = this.stops.map((s) => s.group.visible), rv = this.routeGroup?.visible, vv = this.vehicle?.group.visible, root = this.root.visible;
    this.root.visible = true; this.stops.forEach((s) => (s.group.visible = true)); if (this.routeGroup) this.routeGroup.visible = true; if (this.vehicle) this.vehicle.group.visible = true;
    try { await this.gfx.warmup(); } finally { this.stops.forEach((s, i) => (s.group.visible = saved[i])); if (this.routeGroup) this.routeGroup.visible = rv; if (this.vehicle) this.vehicle.group.visible = vv; this.root.visible = root; }
  }
  setActive(i) {
    const s = this.stops[i]; this.active = s; this.activeIndex = i; this.gfx.setAtmo(s.atmo); this.transit = null;
    this.fx.clearWorldFX(); this._refreshVisibility(true); this._applyWeather(); this.listeners.forEach((f) => f('active', s));
    this.fx.setWorld(this);
  }
  /** begin blending atmosphere between two stops (t in 0..1). Call every frame during a ride; setActive() when done. */
  setTransit(from, to, t) { this.transit = { from, to, t }; }
  update(dt, time, camPos) {
    if (this.shown === false) return; this.time = time;
    { const rf = this.active?.data?.reflect; G.reflWant = rf && typeof rf.level === 'number' ? rf.level + this.active.origin.y : null; } // stop asks for a planar reflection plane (glossy floors with `refl` materials, see mats.js)
    if (this.transit) {
      const { from, to, t } = this.transit, A = this.stops[from].atmo, B = this.stops[to].atmo;
      const tt = clamp(t); this.gfx.blendAtmo(A, B, tt); this.gfx.scene.environment = (tt < 0.5 ? A : B).envTex;
    }
    this._refreshVisibility(false, camPos);
    this._applyWeather();
    for (const s of this.stops) if (s.visible && s.update) s.update(dt, time, s === this.active);
    if (this.vehicle) this.vehicle.update(dt, time);
  }
  _refreshVisibility(force, camPos = this.gfx.camera.position) {
    for (const s of this.stops) {
      const d = camPos.distanceTo(s.center); const vis = (this.transit ? (s.index === this.transit.from || s.index === this.transit.to || d < s.viewRadius) : (s === this.active)) || d < s.viewRadius * 0.5;
      const shouldLights = vis && d < s.viewRadius * 1.2 + 80;
      if (force || vis !== s.visible) { s.visible = vis; s.group.visible = vis; }
      for (const l of s.lightSources) l.enabled = shouldLights && (l.on !== 0 || l.flicker >= 0) && s.visible;
    }
  }
  _applyWeather() {
    for (const s of this.stops) {
      let k = s === this.active && !this.transit ? 1 : 0;
      if (this.transit) { const { from, to, t } = this.transit; if (s.index === from) k = 1 - clamp(t * 1.4); else if (s.index === to) k = clamp((t - 0.4) * 1.7); }
      s.intensity = k; for (const h of s.weather) { h.w.intensity = k; h.w.mesh.visible = k > 0.01; }
    }
  }
  get playerStart() { return this.active.playerStart; }

  // ---------------------------------------------------------------- queries (WORLD coordinates, active stop)
  raycast(ox, oy, oz, dx, dy, dz, maxT, out) {
    const s = this.active; const c = s.B.colliders, o = s.origin;
    const ok = c.raycast(ox - o.x, oy - o.y, oz - o.z, dx, dy, dz, maxT, out); return ok;
  }
  groundAt(x, z, yRef, out = this._g, step = 0.5) { const s = this.active; const o = s.origin; const g = s.B.colliders.ground(x - o.x, z - o.z, yRef - o.y, step, out); g.y += o.y; return g; }
  /** push a cylinder out of solid geometry; pos is WORLD (mutated) */
  push(pos, r, y, h, step = 0.45) { const s = this.active; const o = s.origin; pos.x -= o.x; pos.z -= o.z; const hit = s.B.colliders.push(pos, r, y - o.y, h, step); pos.x += o.x; pos.z += o.z; return hit; }
  flow(x, z, out) { const s = this.active; if (!s.nav) { out.x = out.z = 0; return -1; } return s.nav.flow(x - s.origin.x, z - s.origin.z, out); }
  navTarget(x, z) { const s = this.active; if (s.nav) s.nav.compute(x - s.origin.x, z - s.origin.z); }
  /** co-op: the field toward the nearest of several targets ([{x, z}] world) */
  navTargets(list) { const s = this.active; if (!s.nav) return; const o = s.origin; const pts = this._navPts || (this._navPts = []); pts.length = 0; for (const t of list) pts.push({ x: t.x - o.x, z: t.z - o.z }); s.nav.computeMany(pts); }
  isFree(x, z) { const s = this.active; return !s.nav || s.nav.isFree(x - s.origin.x, z - s.origin.z); }
  clear(ax, ay, az, bx, by, bz) { const s = this.active, o = s.origin; return s.B.colliders.clear(ax - o.x, ay - o.y, az - o.z, bx - o.x, by - o.y, bz - o.z); }
}
