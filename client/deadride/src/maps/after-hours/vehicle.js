// AFTER HOURS — the MONORAIL. A two-car Alweg-style straddle-beam train riding the closed spline of track.js.
// Physics: arc-length motion with a jerk-limited S-curve (accel <= 1.1 m/s^2, jerk 0.9 m/s^3, peak ~14.8 m/s), two-bogie chord pose (a rigid 24 m body
// overhangs curves like the real thing), superelevation banking, body roll/pitch/heave on damped springs driven by the true lateral acceleration
// (v^2 kappa cos(phi) - g sin(phi)), joint clatter every 12.5 m beam segment (per bogie), tyre vibration, pylon whooshes, and inertial coupling
// to the player through the Vehicle base class (accelLocal is converted to *specific force* so the banking compensation is felt).
import * as THREE from 'three';
import { Vehicle } from '../../core/vehicle.js';
import { Spring, clamp, damp, lerp, easeInOutCubic, noise2 } from '../../core/util.js';
import { planRide, planBrake, planLaunch, FLOOR_ABOVE_BEAM } from './track.js';
import { buildTrainModel } from './train.js';
import { PARK } from './park.js';

const F = new THREE.Vector3(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), M4 = new THREE.Matrix4(), Q1 = new THREE.Quaternion();
const BOGIE = 7.6, JOINT = 12.5, PYLON = 25, PYLON_OFF = 3.1, G = 9.81, ARRIVE_V = 13, GAP = 0.02;

export class Monorail extends Vehicle {
  constructor(world) {
    super(world, { name: 'monorail' });
    this.track = PARK.track;
    this.sc = 0; this.v = 0; this.a = 0; this.motion = null; this.speed = 0; this.motorLoad = 0; this.lat = 0;   // speed/motorLoad/lat are public read-outs for the audio layer
    this.roll = new Spring(85, 7); this.pitch = new Spring(70, 8); this.heave = new Spring(190, 16);
    this.pf = {}; this.pr = {}; this.pose = { x: 0, y: 0, z: 0 };
    this._jf = 0; this._jr = 0; this._pyl = 0; this._acc = new THREE.Vector3(); this._gl = new THREE.Vector3();
    this.floorY = 0; this.colliders.groundY = 0;
    this.boardBox = { min: new THREE.Vector3(-1.15, 0, -11.3), max: new THREE.Vector3(1.15, 2.4, 11.3) };
    this.bounds = { minX: -1.15, maxX: 1.15, minZ: -11.3, maxZ: 11.3 };
    this.lightSrc = []; this.head = null; this.state = 'away'; this.group.visible = false;
  }
  async build(synth) {
    this.model = await buildTrainModel({ synth, gfx: this.world.gfx }); this.frame.add(this.model.root); this.model.onPa = () => this.emit('pa', { pos: this.localToWorld(new THREE.Vector3(0, 2.36, -6.6), new THREE.Vector3()) });
    for (const c of this.model.colliders) this.colliders.addBox(c);
    // solid outer wall segments on the platform side between the door openings (so the player can only leave through open doors)
    const dz = this.model.doorZ; let z0 = -11.6; const wall = (a, b) => { if (b - a > 0.05) this.colliders.addBox({ x: 1.32, y: 1.2, z: (a + b) / 2, hx: 0.1, hy: 1.2, hz: (b - a) / 2, surface: 'metal', walk: false }); };
    for (const [a, b] of dz) { wall(z0, a); z0 = b; } wall(z0, 11.6);
    this.colliders.build();
    const gfx = this.world.gfx;
    for (const l of this.model.lights || []) { const s = gfx.addLight({ kind: 'point', pos: new THREE.Vector3(), color: l.color ?? 0xdfeeff, intensity: l.intensity ?? 9, distance: l.distance ?? 9, decay: 2, flicker: l.flicker ?? 0.25, flickerSpeed: 9, enabled: false, priority: 3 }); s._local = new THREE.Vector3(...l.pos); this.lightSrc.push(s); }
    if (this.model.headlights?.length) { const h = this.model.headlights[0]; this.head = gfx.addLight({ kind: 'spot', pos: new THREE.Vector3(), color: 0xfff2d8, intensity: 260, distance: 70, decay: 2, angle: 0.42, penumbra: 0.7, dir: new THREE.Vector3(0, -0.06, -1), enabled: false, priority: 2 }); this.head._local = new THREE.Vector3(...h.pos); }
    return this;
  }

  // ------------------------------------------------------------ station helpers
  stationS(i) { return this.track.stations[i].s; }
  _placeAt(sc) { this.sc = this.track.wrapS(sc); }
  _dock(i) { this._placeAt(this.stationS(i)); this.v = 0; this.a = 0; this.motion = null; this.stopIndex = i; this._applyPose(0, true); }
  parkAway() { this.group.visible = false; this.state = 'away'; this.v = 0; this.a = 0; this.motion = null; this._syncLights(false); }
  snapDocked(stop) { this.group.visible = true; this._dock(stop.index); this.state = 'open'; this.setDoors(1); this._syncLights(true); }
  get exitPoint() { if (this.state !== 'open') return null; const p = this.localToWorld(V1.set(2.75, 0.02, -3.05), new THREE.Vector3()); return p; }

  /** run a planned motion; resolves when finished. dir: +1 forward along the track. */
  _run(plan, s0, { progress = null, total = 1, onEnd = null } = {}) { return new Promise((res) => { this.motion = { plan, s0, t: 0, progress, total, res, onEnd, cruiseAfter: 0 }; }); }

  async arrive(stop) {
    if (!this._frames) { this.snapDocked(stop); return; }                          // world loop not running yet (sandbox/boot): dock instantly instead of deadlocking
    this.group.visible = true; this.stopIndex = stop.index; this.setDoors(0); this.state = 'arriving'; this._syncLights(true);
    const br = planBrake(ARRIVE_V); this._placeAt(this.stationS(stop.index) - br.dist); this.v = ARRIVE_V;
    await this._run(br, this.sc); this.emit('arrived', { stop: stop.index }); this.emit('bump', { strength: 0.35 }); await this.wait(0.5); await this.openDoors(1.5); this.state = 'open';
  }
  async ride(fromStop, toStop, hooks = {}) {
    if (this.state !== 'open' && this.state !== 'closed') this.snapDocked(fromStop);
    this.state = 'closing'; this.emit('horn', {}); await this.closeDoors(1.7); await this.wait(0.7); this.state = 'riding'; this.emit('start', {}); this.emit('bump', { strength: 0.45 });
    const L = this.track.legLength(fromStop.index, toStop.index), plan = planRide(L, 16); const s0 = this.stationS(fromStop.index);
    await this._run(plan, s0, { progress: hooks.progress, total: L }); this.stopIndex = toStop.index; this._placeAt(this.stationS(toStop.index)); this.v = 0;
    this.emit('arrived', { stop: toStop.index }); this.emit('bump', { strength: 0.35 }); hooks.progress?.(1); await this.wait(0.6); await this.openDoors(1.5); this.state = 'open';
  }
  async depart(stop) {
    if (this.state === 'away') return; this.state = 'closing'; await this.closeDoors(1.7); await this.wait(0.5); this.state = 'departing'; this.emit('start', { departing: true });
    const lp = planLaunch(ARRIVE_V), s0 = this.sc, plan = { T: lp.T + 8, at: (t) => { if (t < lp.T) return lp.at(t); const e = lp.at(lp.T); return [e[0] + ARRIVE_V * (t - lp.T), ARRIVE_V, 0]; } };
    await this._run(plan, s0); this.parkAway();
  }

  // ------------------------------------------------------------ doors
  applyDoors(k) { this.model?.setDoors(k); this.bounds.maxX = k > 0.85 ? 3.2 : 1.15; }

  // ------------------------------------------------------------ per-frame physics
  update(dt, time) { this._frames = (this._frames || 0) + 1; super.update(dt, time); PARK.tick(dt, time); }
  simulate(dt, time) {
    const m = this.motion;
    if (m) {
      m.t += dt; const [s, v, a] = m.plan.at(m.t); this.sc = this.track.wrapS(m.s0 + s); this.v = v; this.a = a;
      if (m.progress) m.progress(clamp(s / m.total));
      if (m.t >= m.plan.T) { this.motion = null; this.v = 0; this.a = 0; m.res(); }
    }
    if (!this.group.visible) return;
    this._applyPose(dt, false); this._fxUpdate(dt);
    const kin = this._kin || (this._kin = { acc: this.accelLocal, v: 0, doors: 0 }); kin.v = this.v; kin.doors = this.doors; this.model?.update(dt, time, kin);
  }
  /** collector-shoe arcs on the power rail: short blue-white spark showers + a flash of light, more frequent at speed (particles inherit the train's world velocity) */
  _fxUpdate(dt) {
    const fx = this.world.fx; if (!fx || dt <= 0) return; if (this.v < 3.5) { this._arcT = 0.4; return; }
    this._arcT = (this._arcT ?? 0.4) - dt; if (this._arcT > 0) return; this._arcT = 0.35 + Math.random() * 2.2 * (1 - 0.7 * clamp(this.v / 15, 0, 1));
    const z = Math.random() < 0.6 ? -BOGIE : BOGIE, x = Math.random() < 0.5 ? -0.44 : 0.44; this.frame.updateWorldMatrix(true, false); V1.set(x, -0.74, z).applyMatrix4(this.frame.matrixWorld);
    const n = 6 + (Math.random() * 9 | 0), vel = this.vel; for (let i = 0; i < n; i++) fx.add.emit({ p: V1, v: [vel.x + (Math.random() - 0.5) * 3, vel.y + 0.6 + Math.random() * 2, vel.z + (Math.random() - 0.5) * 3], life: 0.22 + Math.random() * 0.3, size: [0.034, 0.008], c0: [0.9, 1.5, 4, 1], c1: [0.25, 0.5, 1.6, 0], gravity: 1, drag: 0.5, stretch: 0.05, cell: 2 }, fx.time);
    fx.pulseLight(V1, 0x9ac8ff, 5, 0.07, 9);
  }
  _syncLights(on) { for (const l of this.lightSrc) l.enabled = on; if (this.head) this.head.enabled = on; }

  _applyPose(dt, snap) {
    const T = this.track, sc = this.sc, v = this.v; T.at(sc + BOGIE, this.pf); T.at(sc - BOGIE, this.pr); const pf = this.pf, pr = this.pr;
    F.set(pf.x - pr.x, pf.y - pr.y, pf.z - pr.z).normalize();                        // chord of the two bogie points = forward
    const bank = (pf.bank + pr.bank) * 0.5;
    V2.crossVectors(F, V3.set(0, 1, 0)).normalize();                                 // right
    V3.crossVectors(V2, F).normalize();                                                // up
    const cb = Math.cos(bank), sb = Math.sin(bank); const rx = V2.x * cb + V3.x * sb, ry = V2.y * cb + V3.y * sb, rz = V2.z * cb + V3.z * sb, ux = V3.x * cb - V2.x * sb, uy = V3.y * cb - V2.y * sb, uz = V3.z * cb - V2.z * sb;
    M4.makeBasis(V1.set(rx, ry, rz), V2.set(ux, uy, uz), V3.set(-F.x, -F.y, -F.z)); Q1.setFromRotationMatrix(M4);
    const px = (pf.x + pr.x) / 2 + ux * FLOOR_ABOVE_BEAM, py = (pf.y + pr.y) / 2 + uy * FLOOR_ABOVE_BEAM, pz = (pf.z + pr.z) / 2 + uz * FLOOR_ABOVE_BEAM;
    this.group.position.set(px, py, pz); this.group.quaternion.copy(Q1);
    if (snap) { this.roll.x = this.roll.v = this.pitch.x = this.pitch.v = this.heave.x = this.heave.v = 0; }
    // ---- suspension: body rolls to the outside of a bend, pitches with longitudinal acceleration
    const kap = (pf.kappa + pr.kappa) * 0.5, lat = v * v * kap * cb - G * sb; this.lat = lat;
    this.roll.target = -0.012 * lat; this.pitch.target = 0.0095 * this.a;
    // ---- joint clatter: each bogie crosses an expansion joint every 12.5 m of beam
    if (dt > 0 && v > 0.3) {
      const jf = Math.floor((sc + BOGIE) / JOINT), jr = Math.floor((sc - BOGIE) / JOINT);
      if (jf !== this._jf) { this._jf = jf; this._kick(v, 1); } if (jr !== this._jr) { this._jr = jr; this._kick(v, 0.8); }
      const py2 = Math.floor((sc + BOGIE - PYLON_OFF) / PYLON); if (py2 !== this._pyl) { this._pyl = py2; this.emit('pylon', { v, pos: this.group.position }); }
    }
    if (dt > 0) {
      const vib = clamp(v / 15, 0, 1); const nz = noise2(this.time * 31.7, 3.3) * 0.0012 * vib, nr = noise2(this.time * 27.1, 9.1) * 0.0009 * vib;
      this.roll.step(dt); this.pitch.step(dt); this.heave.step(dt);
      this.frame.rotation.set(this.pitch.x, 0, this.roll.x + nr, 'YXZ'); this.frame.position.set(0, this.heave.x + nz, 0);
      this.speed = v; this.motorLoad = clamp(Math.abs(this.a) / 1.1, 0, 1);
    }
    this.group.updateMatrixWorld(true);
    // lights follow the frame (world)
    if (this.lightSrc.length || this.head) {
      this.frame.updateWorldMatrix(true, false);
      for (const l of this.lightSrc) l.pos.copy(l._local).applyMatrix4(this.frame.matrixWorld);
      if (this.head) { this.head.pos.copy(this.head._local).applyMatrix4(this.frame.matrixWorld); this.head.dir.set(0, -0.05, -1).transformDirection(this.frame.matrixWorld); this.head.on = this.v > 0.2 || this.state === 'open' ? 1 : 0.3; }
    }
  }
  _kick(v, k) { const s = clamp(v / 15, 0.2, 1.2) * k; this.heave.kick(-(0.025 + Math.random() * 0.03) * s); this.roll.kick((Math.random() - 0.5) * 0.035 * s); this.pitch.kick((Math.random() - 0.5) * 0.012 * s); this.emit('jointkick', { v, k: s }); }

  /** base tracks kinematic acceleration of the frame; convert it to *specific force* so banking compensation reaches the player. */
  _track(dt) {
    super._track(dt); if (dt <= 0) return;
    const inv = this._qi; if (!inv) return; this._gl.set(0, G, 0).applyQuaternion(inv);
    this.accelLocal.x += this._gl.x; this.accelLocal.z += this._gl.z; this.accelLocal.y += this._gl.y - G;
  }
}
