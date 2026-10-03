// Vehicle base class. A vehicle owns a THREE.Group (world space), an interior `frame` the player rides in, local interior
// colliders, a boarding trigger and an async state machine: arrive(stop) -> [player boards] -> ride(from,to) -> depart(stop).
// Subclasses implement visuals + physics; this class provides sequencing helpers (animate/wait), kinematic tracking
// (velocity/acceleration in the interior frame, used for inertial coupling with the player) and door helpers.
import * as THREE from 'three';
import { Colliders } from './colliders.js';
import { clamp, easeInOutCubic } from './util.js';

const M = new THREE.Matrix4(), V = new THREE.Vector3(), Q = new THREE.Quaternion();

export class Vehicle {
  constructor(world, { name = 'vehicle' } = {}) {
    this.world = world; this.name = name;
    this.group = new THREE.Group(); this.group.name = name;
    this.frame = new THREE.Group(); this.frame.name = name + ':frame'; this.group.add(this.frame); // player rides in this frame (may sway relative to group)
    this.colliders = new Colliders(); this.colliders.groundY = 0; // interior, LOCAL to frame
    this.boardBox = { min: new THREE.Vector3(-1, 0, -1), max: new THREE.Vector3(1, 2.2, 1) };   // local trigger: player inside => can depart
    this.bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };                                      // walkable interior bounds (local xz)
    this.floorY = 0; this.state = 'away'; this.doors = 0; this.time = 0; this.anims = []; this.stopIndex = -1; this.ridePhase = 0;
    this.vel = new THREE.Vector3(); this.accel = new THREE.Vector3(); this.accelLocal = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this._pp = new THREE.Vector3(); this._pv = new THREE.Vector3(); this._pq = new THREE.Quaternion(); this._init = false; this.soundKey = null;
    this.timeScale = 1; this.clock = 0; // the vehicle's own clock (co-op: a teammate's ride is nudged to keep time with the host's)
    this.interiorLightIntensity = 1; this.onEvent = null; // (evt, data) — 'doors', 'departed', 'arrived', 'bump', 'creak', ...
  }
  emit(evt, data) { if (this.onEvent) this.onEvent(evt, data); }

  // ---- sequencing helpers (promise based; advance in update())
  animate(duration, fn, ease = null) { return new Promise((res) => this.anims.push({ t: 0, d: Math.max(1e-3, duration), fn, ease, res })); }
  wait(sec) { return this.animate(sec, () => {}); }
  update(dt, time) {
    this.time = time; const sdt = dt * this.timeScale; this.clock += sdt;
    for (let i = this.anims.length - 1; i >= 0; i--) { const a = this.anims[i]; a.t += sdt; const k = clamp(a.t / a.d); a.fn(a.ease ? a.ease(k) : k, sdt); if (k >= 1) { this.anims.splice(i, 1); a.res(); } }
    this.simulate(sdt, time);
    this.group.updateMatrixWorld(true); this._track(dt);
  }
  /** override: continuous physics (sway, engine vibration, wheel spin…) called every frame */
  simulate(dt, time) {}
  _track(dt) {
    if (dt <= 0) return; this.frame.matrixWorld.decompose(V, Q, this._sc || (this._sc = new THREE.Vector3()));
    if (!this._init) { this._pp.copy(V); this._pq.copy(Q); this._pv.set(0, 0, 0); this._init = true; return; }
    const v = this._nv || (this._nv = new THREE.Vector3()); v.copy(V).sub(this._pp).divideScalar(dt);
    this.accel.copy(v).sub(this._pv).divideScalar(dt); this.accel.clampLength(0, 25); this.vel.copy(v);
    const inv = this._qi || (this._qi = new THREE.Quaternion()); inv.copy(Q).invert(); this.accelLocal.copy(this.accel).applyQuaternion(inv);
    const dq = this._dq || (this._dq = new THREE.Quaternion()); dq.copy(Q).multiply(this._pq.clone().invert()); dq.normalize(); const ang = 2 * Math.acos(clamp(dq.w, -1, 1)); const s = Math.sqrt(Math.max(1e-9, 1 - dq.w * dq.w));
    const a = ang > Math.PI ? ang - 2 * Math.PI : ang; this.angVel.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(a / dt).applyQuaternion(inv);
    this._pp.copy(V); this._pq.copy(Q); this._pv.copy(v);
  }
  worldToLocal(p, out = new THREE.Vector3()) { this.frame.updateWorldMatrix(true, false); M.copy(this.frame.matrixWorld).invert(); return out.copy(p).applyMatrix4(M); }
  localToWorld(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.frame.matrixWorld); }
  isInside(worldPos) { const l = this.worldToLocal(worldPos, V); const b = this.boardBox; return l.x > b.min.x && l.x < b.max.x && l.y > b.min.y - 0.5 && l.y < b.max.y && l.z > b.min.z && l.z < b.max.z; }

  // ---- door helper: doors 0 (closed) .. 1 (open)
  setDoors(k) { this.doors = k; this.applyDoors(k); }
  applyDoors(k) {}
  openDoors(sec = 1.4) { const from = this.doors; this.emit('doors', { open: true }); return this.animate(sec, (t) => this.setDoors(from + (1 - from) * t), easeInOutCubic); }
  closeDoors(sec = 1.4) { const from = this.doors; this.emit('doors', { open: false }); return this.animate(sec, (t) => this.setDoors(from * (1 - t)), easeInOutCubic); }

  // ---- lifecycle (subclass overrides): all return promises
  /** Place the vehicle out of sight (initial state / after departure). */
  parkAway(stop) { this.group.visible = false; this.state = 'away'; }
  /** Snap to docked pose at stop with doors open. */
  snapDocked(stop) { this.group.visible = true; this.state = 'open'; this.stopIndex = stop.index; this.setDoors(1); }
  async arrive(stop) { this.snapDocked(stop); }
  async ride(fromStop, toStop, hooks) { }
  async depart(stop) { this.parkAway(stop); }
  /** Where (world) the player should appear when disembarking at the docked stop */
  get exitPoint() { return null; }
}
