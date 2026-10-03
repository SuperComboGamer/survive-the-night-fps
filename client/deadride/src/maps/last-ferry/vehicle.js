// LAST FERRY — the ferry (MV CHARON) as a Vehicle. Real physics: 6-DOF hull floating on the shared Gerstner sea (ferryPhys.js), route autopilot along layout.js legs,
// docking against the quay with fenders + mooring lines, side ramp that raises as a gate, wake/foam/spray, engine vibration, creak/bump/horn events.
import * as THREE from 'three';
import { Vehicle } from '../../core/vehicle.js';
import { easeInOutCubic, clamp, lerp, rand } from '../../core/util.js';
import { FerryBody, quatToYPR, HULL, halfWidth } from './ferryPhys.js';
import { STOPS, leg, BEAM_HALF, FENDER, DECK_H } from './layout.js';
import { buildFerryModel, RAMP } from './ferryModel.js';
import { getSea, lampReg, DynRibbon, anim } from './shared.js';

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), QV = new THREE.Quaternion();
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const MOOR_A = [17, 7.2, -7.2, -17];                                    // along-quay offsets (m, +forward) of the four bollards
const CLEAT_Z = [-11.4, -6.4, 5.8, 11.2];                               // body z of the fairleads on the starboard bulwark
const ROPE_R = 0.05;

/** dynamic rope (tube with fixed topology, positions rewritten per frame): catenary sag from slack */
class Rope {
  constructor(mat, segs = 14, radial = 5) {
    this.segs = segs; this.radial = radial; const nv = (segs + 1) * radial; this.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3); this.nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3); this.uv = new THREE.BufferAttribute(new Float32Array(nv * 2), 2);
    const I = []; for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + (j + 1) % radial, c = (i + 1) * radial + j, d = (i + 1) * radial + (j + 1) % radial; I.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', this.pos); g.setAttribute('normal', this.nor); g.setAttribute('uv', this.uv); g.setIndex(I); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.visible = false; this.T = new THREE.Vector3(); this.N = new THREE.Vector3(); this.Bn = new THREE.Vector3(); this.P = new THREE.Vector3();
  }
  /** a: bollard end, b: ferry end (world), ext 0..1 how much of the rope has been thrown (from b towards a), slack length (m) */
  set(a, b, ext, slack) {
    const { segs, radial, pos, nor, uv, T, N, Bn, P } = this; const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * ext; const sag = Math.min(3.2, Math.sqrt(Math.max(0, 0.375 * Math.max(d, 1) * slack)));
    let s = 0, px = 0, py = 0, pz = 0; const pt = (t, o) => { const e = t * ext; o.set(b.x + (a.x - b.x) * e, b.y + (a.y - b.y) * e - 4 * sag * t * (1 - t) * (ext > 0.98 ? 1 : ext), b.z + (a.z - b.z) * e); return o; };
    for (let i = 0; i <= segs; i++) {
      const t = i / segs; pt(t, P); pt(Math.min(1, t + 0.02), T); pt(Math.max(0, t - 0.02), N); T.sub(N); if (T.lengthSq() < 1e-8) T.set(1, 0, 0); T.normalize();
      N.set(0, 1, 0).cross(T); if (N.lengthSq() < 1e-4) N.set(1, 0, 0); N.normalize(); Bn.copy(T).cross(N);
      if (i > 0) s += Math.hypot(P.x - px, P.y - py, P.z - pz); px = P.x; py = P.y; pz = P.z;
      for (let j = 0; j < radial; j++) { const ph = j / radial * Math.PI * 2, c = Math.cos(ph), sn = Math.sin(ph); const k = i * radial + j; const nx = N.x * c + Bn.x * sn, ny = N.y * c + Bn.y * sn, nz = N.z * c + Bn.z * sn; pos.setXYZ(k, P.x + nx * ROPE_R, P.y + ny * ROPE_R, P.z + nz * ROPE_R); nor.setXYZ(k, nx, ny, nz); uv.setXY(k, s, j / radial * ROPE_R * 6.28); }
    }
    pos.needsUpdate = true; nor.needsUpdate = true; uv.needsUpdate = true; this.mesh.visible = ext > 0.01;
  }
}

export class Ferry extends Vehicle {
  constructor(world, ctx) {
    super(world, { name: 'ferry' });
    this.sea = getSea(); this.sea.attach(world.root); this.gfx = world.gfx; this.fx = world.fx;
    this.model = buildFerryModel(this, ctx);
    this.body = new FerryBody((x, z, t) => this.sea.water.height(x, z, t), { cgY: -0.6 });
    this.mode = 'away'; this.state = 'away'; this.dockStop = -1; this.sail = null; this.doorsK = 0; this.group.visible = false;
    this.speed = 0; this.thrustK = 0; this.rideK = 0; this.ctl = { ref: null, moor: null, quay: null }; this.ref = { x: 0, z: 0, psi: 0, vx: 0, vz: 0, r: 0, ax: 0, az: 0 };
    this._o = [0, 0, 0]; this._r0 = [0, 0, 0]; this._r1 = [0, 0, 0]; this._r2 = [0, 0, 0]; this.moorSet = null; this.ropeExt = 0; this.ropeTarget = 0; this.creakT = 4; this.smokeT = 0; this.sprayT = 0; this.washT = 0; this.bowT = 0; this.rampAngle = Math.PI / 2; this.hornT = -1; this.slackK = 0;
    // mooring lines (bollard end fixed on the quay; ferry end on the fairlead)
    this.ropes = CLEAT_Z.map(() => new Rope(this.model.ropeMat)); for (const r of this.ropes) this.group.add(r.mesh);
    this.lineA = CLEAT_Z.map(() => new THREE.Vector3()); this.lineB = CLEAT_Z.map(() => new THREE.Vector3()); this.lineLen = CLEAT_Z.map(() => 10);
    // water effects
    this.collar = new DynRibbon(48); this.group.add(this.collar.mesh); this.wakeL = new DynRibbon(64); this.wakeR = new DynRibbon(64); this.group.add(this.wakeL.mesh, this.wakeR.mesh); this.wash = new DynRibbon(6); this.group.add(this.wash.mesh);
    this.hist = []; this.histT = 0;
    // dock calm: while the ramp is down at the quay the visible frame is held (almost) still, because the game mirrors the frame's colliders into the stop ONCE (static): frame = pS + k * (body - pS)
    this.calm = { on: false, k: 1, lpY: 0, lpP: 0, lpR: 0, init: false, e: new THREE.Euler(0, 0, 0, 'YXZ') };
    // pooled lights that ride with the ferry (cabin, deck)
    const g = this.gfx; const mk = (color, intensity, dist) => g.addLight({ kind: 'point', pos: new THREE.Vector3(0, -50, 0), color, intensity, distance: dist, decay: 2, priority: 3, enabled: false });
    this.lights = { cabin: mk(0xffd9a8, 5.5, 8), fore: mk(0xdfe8ff, 22, 18), ramp: mk(0xffd0a0, 14, 12), aft: mk(0xdfe8ff, 18, 16) };
    this.lampEntries = this.model.deckLamps.map((p) => lampReg.add(0, -99, 0, 0xffc890, 2.4, 0.25, -1)); this.navEntries = [lampReg.add(0, -99, 0, 0xff3020, 1.6, 0.2), lampReg.add(0, -99, 0, 0x20ff60, 1.6, 0.2), lampReg.add(0, -99, 0, 0xffffff, 2.0, 0.25)];
    this.snapshotBounds();
  }
  snapshotBounds() { this.bounds0 = { ...this.bounds }; }

  // ------------------------------------------------------------------ door helper (ramp raise/lower + safety beacon)
  applyDoors(k) { this.doorsK = k; }
  quayPlane(i) { const st = STOPS[i]; const o = this._qp || (this._qp = { nx: 0, nz: 0, off: 0 }); o.nx = st.out[0]; o.nz = st.out[1]; o.off = st.S[0] * st.out[0] + st.S[1] * st.out[1] + BEAM_HALF + FENDER - 0.02; return o; }
  /** where (world) a player stepping off the ramp arrives (quay deck beyond the ramp tip) */
  get exitPoint() { const i = this.dockStop; if (i < 0) return null; const st = STOPS[i]; const a = -1.5; return new THREE.Vector3(st.origin[0] + st.toLocal(a, BEAM_HALF + FENDER + RAMP.len * 0.75)[0], st.quayY + 0.05, st.origin[2] + st.toLocal(a, BEAM_HALF + FENDER + RAMP.len * 0.75)[1]); }

  // ------------------------------------------------------------------ lifecycle
  /** open / close the edge-wall gate in front of the ramp (colliders tagged 'berthGate' by kit.js wallCol): the player can walk from the ramp onto the quay only while the ferry is docked with the ramp down */
  _gates(open) { const st = this._gateStop !== undefined ? this.world.stops[this._gateStop] : null; const c = st && st.B && st.B.colliders; if (!c) return; for (const b of c.boxes) if (b.tag === 'berthGate') { b.solid = !open; b.shootable = !open; } }
  parkAway() { this._gates(false); this.group.visible = false; this.mode = 'away'; this.state = 'away'; this.dockStop = -1; this.sail = null; this._neutraliseMirror(); this.moorSet = null; this.ropeExt = 0; this.setDoors(0); }
  _placeOnLeg(lg, s, speedScale = 1) {
    lg.ref(s, this._r0); const v = lg.speed(s) * speedScale; lg.ref(Math.min(lg.L, s + 1), this._r1); const dx = this._r1[0] - this._r0[0], dz = this._r1[1] - this._r0[1], dl = Math.hypot(dx, dz) || 1;
    this.body.reset(this._r0[0], this._r0[1], this._r0[2], this.time); this.body.v[0] = dx / dl * v; this.body.v[2] = dz / dl * v;
    this.group.visible = true; this._pose(0, this.time); this.frame.updateMatrixWorld(true);
  }
  snapDocked(stop) {
    const i = stop.index, st = STOPS[i]; this.body.reset(st.S[0], st.S[1], st.yaw, this.time); this.group.visible = true; this.dockStop = i; this._setupMoor(i, 1); this.mode = 'moored'; this.ropeExt = 1; this.state = 'open'; this.stopIndex = i; this.setDoors(1);
    for (let k = 0; k < 60; k++) this.body.step(1 / 60, this.time, this._makeCtl(0.016)); this.calm.on = true; this.calm.k = 0.05; this.calm.init = false; this._pose(0, this.time); this.frame.updateMatrixWorld(true);
  }
  async arrive(stop) {
    const i = stop.index, lg = leg(i - 1 + STOPS.length); this.state = 'arriving'; this.dockStop = -1; this.stopIndex = -1; this.setDoors(0); this._neutraliseMirror(); this.calm.on = false; this.calm.k = 1;
    const s0 = Math.max(0, lg.L - 160); this._placeOnLeg(lg, s0); this.mode = 'sail'; this.sail = { leg: lg, s: s0, done: false, hooks: null, stopS: lg.L, arrival: true };
    this.emit('horn', { long: true, arrival: true }); this._horn(2.4);
    await this._sailDone(); await this._dock(i);
  }
  async ride(fromStop, toStop, hooks) {
    const i = fromStop.index, j = toStop.index, lg = leg(i); this.state = 'closing';
    if (this.dockStop < 0) this.snapDocked(fromStop);
    this.emit('horn', { long: false }); this._horn(1.6); this._calmOff(); await this.wait(0.8); await this._castOff(); this.state = 'riding';
    this.mode = 'sail'; this.sail = { leg: lg, s: 0, done: false, hooks, stopS: lg.L, arrival: false }; this.rideK = 0;
    await this._sailDone(); if (hooks && hooks.progress) hooks.progress(1); await this._dock(j);
  }
  async depart(stop) {
    const i = stop.index, lg = leg(i); this.state = 'closing'; this._neutraliseMirror(); if (this.dockStop < 0) this.snapDocked(stop);
    this.emit('horn', { long: false }); this._horn(1.6); this._calmOff(); await this.wait(0.6); await this._castOff();
    this.mode = 'sail'; this.sail = { leg: lg, s: 0, done: false, hooks: null, stopS: 150, arrival: false }; this.state = 'leaving'; await this._sailDone();
    this.parkAway();
  }
  _sailDone() { return new Promise((res) => { this.sail.resolve = res; }); }
  async _castOff() {
    // ramp up, lines off
    await this.closeDoors(3.4); this._gates(false); this.ropeTarget = 0; await this.wait(1.4); this.moorSet = null; this.ctl.moor = null; this.dockStop = -1; this._neutraliseMirror();
  }
  async _dock(i) {
    this.state = 'docking'; this.dockStop = i; this.mode = 'hold'; await this.wait(0.9);
    this._setupMoor(i, 0); this.ropeTarget = 1; await this.wait(1.7); this._setupMoor(i, 1); this.mode = 'moored'; this.emit('mooring', { stop: i }); this._calmOn(); await this.wait(0.9);
    await this.openDoors(3.6); this._gateStop = i; this._gates(true); this.state = 'open'; this.stopIndex = i; this.emit('arrived', { stop: i });
  }
  /** mooring set for stop i; slackK 0 = lines paid out (slack), 1 = lines heaved taut */
  _setupMoor(i, taut) {
    const st = STOPS[i]; const lines = this.moorSet ? this.moorSet.lines : CLEAT_Z.map(() => ({ cb: [0, 0, 0], B: [0, 0, 0], L0: 30, k: 2.6e5, c: 5e4, slack: false }));
    const cw = [0, 0, 0]; CLEAT_Z.forEach((z, k) => {
      const ln = lines[k]; ln.cb[0] = halfWidth(z) - 0.09; ln.cb[1] = 1.0; ln.cb[2] = z; const p = st.toLocal(MOOR_A[k], BEAM_HALF + FENDER + 1.1); ln.B[0] = st.origin[0] + p[0]; ln.B[1] = st.quayY + 0.3; ln.B[2] = st.origin[2] + p[1];
      this.body.bodyToWorld(ln.cb[0], ln.cb[1], ln.cb[2], cw); const d = Math.hypot(ln.B[0] - cw[0], ln.B[1] - cw[1], ln.B[2] - cw[2]);
      if (taut) { ln.L0 = d * 0.992; ln.slack = false; } else { ln.L0 = d * 1.08; ln.slack = true; }
      this.lineA[k].set(ln.B[0], ln.B[1], ln.B[2]);
    });
    this.moorSet = { lines }; this.slackK = taut;
  }

  // ------------------------------------------------------------------ per-frame
  simulate(dt, time) {
    dt = Math.min(dt, 0.05); const cam = this.gfx.camera.position; this.sea.tick(time, cam, this.gfx); anim.run(dt, time, cam);
    if (this.mode === 'away') { this._lights(false); return; }
    this._control(dt, time);
    this.body.step(dt, time, this.ctl);
    this._pose(dt, time); this._visuals(dt, time);
  }
  _makeCtl() { const c = this.ctl; if (this.mode === 'moored') { c.ref = null; c.moor = this.moorSet; c.quay = this.quayPlane(this.dockStop); } else if (this.mode === 'hold') { const st = STOPS[this.dockStop]; const r = this.ref; r.x = st.S[0] + st.out[0] * 0.05; r.z = st.S[1] + st.out[1] * 0.05; r.psi = st.yaw; r.vx = r.vz = r.r = r.ax = r.az = 0; c.ref = r; c.moor = this.moorSet && !this.moorSet.lines[0].slack ? this.moorSet : null; c.quay = this.quayPlane(this.dockStop); } return c; }
  _control(dt, time) {
    const c = this.ctl, b = this.body;
    if (this.mode === 'sail') {
      const S = this.sail, lg = S.leg; const O = b.deckPos(this._o); lg.ref(S.s, this._r0); lg.ref(Math.min(lg.L, S.s + 1), this._r1);
      // reference progress: waits for a ferry that LAGS it, and is pulled forward by a ferry that is AHEAD of it (braking to wait for a reference that stalled behind would strand the ferry)
      const ex0 = O[0] - this._r0[0], ez0 = O[2] - this._r0[1], tx0 = this._r1[0] - this._r0[0], tz0 = this._r1[1] - this._r0[1], tl0 = Math.hypot(tx0, tz0) || 1, along = (ex0 * tx0 + ez0 * tz0) / tl0, lag = -along, lat = Math.abs(ex0 * tz0 - ez0 * tx0) / tl0;
      const v = lg.speed(S.s), slow = lag > 6 ? 0.25 : lag > 3 ? 0.6 : 1, pull = along > 1 ? Math.min(along - 1, 12) * Math.min(1, dt * 2.5) : 0; S.s = Math.min(S.stopS, S.s + v * dt * slow + pull); this.trackErr = Math.hypot(ex0, ez0); this.trackLat = lat;
      lg.ref(S.s, this._r0); lg.ref(Math.min(lg.L, S.s + 1), this._r1); lg.ref(Math.max(0, S.s - 1), this._r2); const dx = this._r1[0] - this._r2[0], dz = this._r1[1] - this._r2[1], dl = Math.hypot(dx, dz) || 1, v2 = lg.speed(S.s);
      const r = this.ref; r.x = this._r0[0]; r.z = this._r0[1]; r.psi = this._r0[2]; r.vx = dx / dl * v2; r.vz = dz / dl * v2; r.r = wrapPi(this._r1[2] - this._r2[2]) / 2 * v2;
      const dv = (lg.speed(Math.min(lg.L, S.s + 1)) - lg.speed(Math.max(0, S.s - 1))) / 2 * v2; r.ax = dx / dl * dv; r.az = dz / dl * dv;
      const rem = lg.L - S.s; const next = STOPS[lg.to]; if (rem < 3 && S.stopS >= lg.L) { r.x += next.out[0] * 0.06; r.z += next.out[1] * 0.06; }
      c.ref = r; c.moor = null; c.quay = rem < 30 && S.stopS >= lg.L ? this.quayPlane(lg.to) : null; this.rideK = clamp(S.s / lg.L);
      if (S.hooks && S.hooks.progress) S.hooks.progress(this.rideK);
      if (S.s >= S.stopS - 0.02 && !S.done) { S.done = true; if (S.stopS < lg.L) { S.resolve && S.resolve(); } else { this.mode = 'hold'; this.dockStop = lg.to; this._holdT = 0; } }
    } else this._makeCtl();
    if (this.mode === 'hold') { this._makeCtl(); if (this.sail && this.sail.done && this.sail.resolve) { this._holdT = (this._holdT || 0) + dt; if (this._holdT > 0.8) { const rs = this.sail.resolve; this.sail.resolve = null; rs(); } } }
  }
  _pose(dt, time) {
    // DOCK CALM: the visible frame follows the body's horizontal position and yaw exactly, but its heave / pitch / roll are blended toward their slow (tau 2 s) MEAN while the ramp is down at the quay:
    // the game mirrors the frame's colliders into the stop once (static), so the deck must stay near the pose it had then, and it must sit at the MEAN height (not at whatever wave phase the snapshot happened to catch).
    const b = this.body, o = b.deckPos(this._o); const f = this.frame, C = this.calm; const a = quatToYPR(b.q);
    const al = C.init ? 1 - Math.exp(-Math.min(dt, 0.1) / 2.0) : 1; C.init = true; C.lpY += (o[1] - C.lpY) * al; C.lpP += (a.pitch - C.lpP) * al; C.lpR += (a.roll - C.lpR) * al; if (dt === 0) { C.lpY = o[1]; C.lpP = a.pitch; C.lpR = a.roll; }
    // (round 3: the game now refreshes the mirrored deck colliders at 20 Hz while docked, so HEAVE may follow the swell (colliders are level, yaw-only boxes, so PITCH / ROLL stay damped)
    const target = C.on ? 0.04 : 1; C.k += (target - C.k) * (1 - Math.exp(-dt / (C.on ? 1.1 : 0.9))); if (Math.abs(C.k - target) < 0.002) C.k = target; const k = C.k, kh = 1;
    f.position.set(o[0], C.lpY + kh * (o[1] - C.lpY), o[2]); C.e.set(C.lpP + k * (a.pitch - C.lpP), a.yaw, C.lpR + k * (a.roll - C.lpR), 'YXZ'); f.quaternion.setFromEuler(C.e);
    // engine vibration: tiny high-frequency ROTATIONAL jitter (position jitter would feed the player's inertial coupling as large accelerations)
    const th = this.thrustK, aj = 0.00035 + 0.0011 * th; const t = time; const ax = (Math.sin(t * 83.1) * 0.6 + Math.sin(t * 131.7 + 1.3) * 0.4) * aj, az = (Math.sin(t * 97.9 + 0.7) * 0.6 + Math.sin(t * 149.1) * 0.4) * aj;
    QV.set(ax, 0, az, 1).normalize(); f.quaternion.multiply(QV);
    this.sea.shelter = clamp((1 - C.k) / 0.95);
  }
  /** engage the dock calm (called when the ramp starts to lower); the physics body keeps moving with the waves */
  _calmOn() { this.calm.on = true; }
  _calmOff() { this.calm.on = false; }
  _visuals(dt, time) {
    const b = this.body, m = this.model, f = this.frame, ypr = quatToYPR(b.q); const fwd = b.forwardSpeed(); this.speed = fwd; this.thrustK = clamp(Math.abs(b.thrust) / 6e5);
    // --- ramp geometry (contact angle on the quay while docked), actuators, colliders, beacon
    this._ramp(quatToYPR([f.quaternion.x, f.quaternion.y, f.quaternion.z, f.quaternion.w]));
    m.animated.radar.rotation.y = -time * 2.4; const bk = this.doorsK > 0.02 && this.doorsK < 0.98 ? (Math.sin(time * 7) > 0 ? 1 : 0) : (this.state === 'riding' || this.state === 'closing' ? (Math.sin(time * 3) > 0.4 ? 0.7 : 0.0) : 0);
    m.beacon.material.emissiveIntensity = 0.3 + bk * 9; m.halos.setLevel(m.beaconGlow, bk * 1.3);
    // --- lights following the frame
    this._lights(true);
    // --- ropes
    this._ropes(dt);
    // --- water effects
    this._water(dt, time, ypr, fwd);
    // --- smoke + spray + horn steam + creaks
    this._particles(dt, time, ypr, fwd);
  }
  _ramp(ypr) {
    const m = this.model, RA = RAMP, k = this.doorsK, g = m.ramp; let thDown = -0.06;
    const zc = (RA.z0 + RA.z1) / 2; this.frame.updateMatrixWorld(true); V.set(RA.hx, 0.02, zc).applyMatrix4(this.frame.matrixWorld);
    if (this.dockStop >= 0) { const st = STOPS[this.dockStop]; const tipY = st.quayY + 0.04; const s = clamp((tipY - V.y) / RA.len, -0.6, 0.6); thDown = Math.asin(s) - ypr.roll; }
    const e = easeInOutCubic(clamp(k)); const th = lerp(Math.PI / 2 - 0.02, thDown, e); this.rampAngle = th; g.rotation.z = th;
    const c = Math.cos(th), s = Math.sin(th), n = m.rampSteps.length;
    for (let i = 0; i < n; i++) { const d = (i + 0.5) * RA.len / n, top = 0.02 + d * s + 0.07; const bx = m.rampSteps[i]; bx.x = RA.hx + d * c; bx.y1 = top; bx.y0 = top - 0.12; bx.y = top - 0.06; bx.walk = k > 0.9; }
    { const top = 0.02 + RA.len * s + 0.07, L = m.rampLanding; L.x = RA.hx + RA.len * c + 0.9; L.y1 = top; L.y0 = top - 0.12; L.y = top - 0.06; L.walk = k > 0.9; }
    m.blocker.solid = k < 0.9; m.blocker.walk = false;
    // actuators: barrel fixed at the deck, rod reaches the ramp underside
    for (const a of m.act) { const ex = RA.hx + 1.4 * c + 0.1 * s, ey = 0.02 + 1.4 * s - 0.1 * c; V.set(ex, ey, a.base.z).sub(a.base); const L = V.length(); V.normalize(); Q.setFromUnitVectors(V2.set(0, 1, 0), V); const bl = Math.min(0.9, L * 0.55); a.barrel.scale.y = bl; a.barrel.position.copy(a.base).addScaledVector(V, bl / 2); a.barrel.quaternion.copy(Q); a.rod.scale.y = L - bl + 0.05; a.rod.position.copy(a.base).addScaledVector(V, bl + (L - bl) / 2 + 0.02); a.rod.quaternion.copy(Q); }
  }
  _lights(on) {
    const L = this.lights, m = this.model, f = this.frame; const set = (src, x, y, z) => { if (!on) { src.enabled = false; return; } V.set(x, y, z).applyMatrix4(f.matrixWorld); src.pos.copy(V); src.enabled = this.group.visible; };
    set(L.cabin, 0, 1.35, 0.6); set(L.fore, 0, 4.6, -7.6); set(L.ramp, 3.4, 2.5, 1.6); set(L.aft, 0, 3.8, 9.6);
    const s = this.state === 'away' ? 0 : 1; L.cabin.intensity = 5.5 * this.interiorLightIntensity;
    this.lampEntries.forEach((e, i) => { const p = m.deckLamps[i]; V.set(p[0], p[1], p[2]).applyMatrix4(f.matrixWorld); e.x = V.x; e.y = V.y; e.z = V.z; e.on = on ? 1 : 0; });
    const nav = [[-4.3, 3.1, -3.3], [4.3, 3.1, -3.3], [0, 8.3, -3.6]]; this.navEntries.forEach((e, i) => { V.set(...nav[i]).applyMatrix4(f.matrixWorld); e.x = V.x; e.y = V.y; e.z = V.z; e.on = on ? 1 : 0; });
  }
  _ropes(dt) {
    const m = this.moorSet; this.ropeExt += (this.ropeTarget - this.ropeExt) * Math.min(1, dt * 1.2); if (Math.abs(this.ropeTarget - this.ropeExt) < 0.004) this.ropeExt = this.ropeTarget;
    if (!m || this.ropeExt <= 0) { for (const r of this.ropes) r.mesh.visible = false; return; }
    const cw = [0, 0, 0]; for (let k = 0; k < this.ropes.length; k++) { const ln = m.lines[k]; V.set(ln.cb[0], ln.cb[1], ln.cb[2]).applyMatrix4(this.frame.matrixWorld); cw[0] = V.x; cw[1] = V.y; cw[2] = V.z; this.lineB[k].set(cw[0], cw[1], cw[2]); const d = Math.hypot(ln.B[0] - cw[0], ln.B[1] - cw[1], ln.B[2] - cw[2]); const slack = Math.max(0, (ln.slack ? ln.L0 : ln.L0 * 1.001) - d) + (ln.slack ? 0.3 : 0.0) * this.ropeExt; this.ropes[k].set(this.lineA[k], this.lineB[k], this.ropeExt, slack); }
  }
  _water(dt, time, ypr, fwd) {
    const b = this.body, sp = Math.abs(fwd), th = this.thrustK; const c = this._o; const cw = [0, 0, 0];
    // hull collar: foam ring around the waterline (world xz), brighter when moving / slamming
    const pts = []; const zs = []; for (let i = 0; i <= 22; i++) zs.push(-13.8 + 27.6 * (i / 22));
    let n = 0; const amp = 0.55 + 0.45 * clamp(sp / 8) + 0.3 * clamp(b.slam / 3);
    const pt = (x, z, out) => { b.bodyToWorld(x, -1.3, z, cw); return cw; };
    for (const sd of [1, -1]) { const zz = sd === 1 ? zs : zs.slice().reverse(); for (const z of zz) { const w = halfWidth(z) - 0.06; b.bodyToWorld(sd * w, -1.3, z, cw); const x0 = cw[0], z0 = cw[2]; b.bodyToWorld(sd * (w + 0.7 + 0.5 * clamp(sp / 8)), -1.3, z, cw); this.collar.set(n, x0, z0, cw[0], cw[2], n * 0.6, amp, amp * 0.7, (sd > 0 ? 1 : 2) + z * 0.1); n++; } }
    this.collar.finish(n);
    // wake history (stern centre) every 0.22 s
    this.histT += dt; if (this.histT > 0.22 && sp > 0.8) { this.histT = 0; b.bodyToWorld(0, -1.3, 13.6, cw); this.hist.unshift({ x: cw[0], z: cw[2], t: time, psi: ypr.yaw, sp }); if (this.hist.length > 62) this.hist.pop(); } else if (sp <= 0.8 && this.hist.length && this.histT > 0.6) { this.histT = 0; this.hist.pop(); }
    const H = this.hist; let kk = 0; for (let i = 0; i < H.length; i++) { const h = H[i], age = time - h.t; const w0 = 0.6 + age * 0.9 * (0.6 + 0.4 * clamp(h.sp / 10)), a0 = clamp(1 - age / 14) * clamp(h.sp / 5) * 0.95; const rx = Math.cos(h.psi), rz = -Math.sin(h.psi); this.wakeR.set(kk, h.x, h.z, h.x + rx * w0, h.z + rz * w0, i * 1.2, a0, a0 * 0.4, -(3.5 + i * 0.01)); this.wakeL.set(kk, h.x, h.z, h.x - rx * w0, h.z - rz * w0, i * 1.2, a0, a0 * 0.4, -(7.5 + i * 0.01)); kk++; }
    this.wakeR.finish(kk); this.wakeL.finish(kk);
    // propeller wash patch astern
    if (th > 0.05) { b.bodyToWorld(0, -1.3, 14.3, cw); const fx = -Math.sin(ypr.yaw), fz = -Math.cos(ypr.yaw), rx = Math.cos(ypr.yaw), rz = -Math.sin(ypr.yaw); const L = 5 + 8 * th, W = 1.4 + 1.2 * th; for (let i = 0; i < 6; i++) { const t = i / 5; const cx = cw[0] - fx * L * t, cz = cw[2] - fz * L * t, w = W * (0.5 + t); this.wash.set(i, cx - rx * w * 0.5, cz - rz * w * 0.5, cx + rx * w * 0.5, cz + rz * w * 0.5, t * L, (1 - t) * th * 1.2, (1 - t) * th * 1.2, -(11.5)); } this.wash.finish(6); } else this.wash.finish(0);
  }
  _particles(dt, time, ypr, fwd) {
    if (!this.group.visible || this.state === 'away') return; const fx = this.fx, b = this.body; const cam = this.gfx.camera.position; const sp = Math.abs(fwd);
    const f = this.frame; const W = this._w || (this._w = new THREE.Vector3());
    // engine vibration: a steady low camera thrum while aboard (idle when moored, stronger under way); nothing for a camera far from the hull
    { V.setFromMatrixPosition(f.matrixWorld); if (cam.distanceTo(V) < 11 && fx.addShake) fx.addShake(1.6 * dt * (0.012 + 0.03 * this.thrustK)); }
    // funnel smoke: billowing flipbook smoke (idle puffs when moored, heavy dark plume when under way); it keeps a quarter of the ferry's speed, drag then leaves a trail astern
    this.smokeT -= dt; if (this.smokeT <= 0) { this.smokeT = 0.12 - 0.06 * this.thrustK; V.set(0, 5.35, 2.6).applyMatrix4(f.matrixWorld); const k = 0.3 + 0.7 * this.thrustK; fx.smoke.emit({ p: V, v: [(rand() - 0.5) * 0.5 + this.body.v[0] * 0.25, 1.6 + 1.6 * k, (rand() - 0.5) * 0.5 + this.body.v[2] * 0.25], life: 5 + rand() * 2, size: [0.9, 3.8 + 2.4 * k], c0: [0.2, 0.19, 0.18, 0.5 + 0.4 * k], c1: [0.4, 0.4, 0.4, 0], rot: rand() * 6.28, rotVel: (rand() - 0.5) * 0.4, drag: 0.6, gravity: -0.05 }, fx.time); }
    // propeller wash: churned white water astern of both screws, scaled by thrust
    if (this.thrustK > 0.12) { this.washT -= dt; if (this.washT <= 0) { this.washT = 0.05; const wfx = -Math.sin(ypr.yaw), wfz = -Math.cos(ypr.yaw); for (const sd of [-1, 1]) { b.bodyToWorld(sd * 0.95, -1.2, 14.4, W); const sv = 1.2 + 2.2 * this.thrustK; fx.alpha.emit({ p: W, v: [-wfx * sv + (rand() - 0.5) * 0.8, 0.3 + rand() * 0.5, -wfz * sv + (rand() - 0.5) * 0.8], life: 1.7 + rand() * 0.8, size: [0.5, 1.7 + this.thrustK], c0: [0.6, 0.68, 0.7, 0.34 * this.thrustK], c1: [0.6, 0.68, 0.7, 0], drag: 1.1, cell: 9 }, fx.time); } } }
    // bow wave: soft foam puffs riding along the flared bow
    if (sp > 3.0) { this.bowT -= dt; if (this.bowT <= 0) { this.bowT = 0.09; const brx = Math.cos(ypr.yaw), brz = -Math.sin(ypr.yaw); for (const sd of [-1, 1]) for (const z of [-12.6, -9.8]) { b.bodyToWorld(sd * (halfWidth(z) * 0.95 + 0.1), -1.25, z, W); fx.alpha.emit({ p: W, v: [brx * sd * (0.6 + rand() * 0.8), 0.4 + rand() * 0.5, brz * sd * (0.6 + rand() * 0.8)], life: 1.3, size: [0.3, 1.0 + sp * 0.05], c0: [0.6, 0.68, 0.72, 0.2], c1: [0.6, 0.68, 0.72, 0], drag: 1.0, cell: 9 }, fx.time); } } }
    // bow spray + wave slap
    if (sp > 2.5) { this.sprayT -= dt; if (this.sprayT <= 0) { this.sprayT = 0.04; for (const sd of [-1, 1]) { b.bodyToWorld(sd * 0.9, -1.25, -13.2, W); const up = 1.8 + sp * 0.28 + rand() * 1.4; const fx_ = -Math.sin(ypr.yaw), fz_ = -Math.cos(ypr.yaw), rx = Math.cos(ypr.yaw), rz = -Math.sin(ypr.yaw); fx.alpha.emit({ p: W, v: [rx * sd * (1.6 + rand() * 1.5) + fx_ * sp * 0.25, up, rz * sd * (1.6 + rand() * 1.5) + fz_ * sp * 0.25], life: 0.9 + rand() * 0.5, size: [0.05, 0.03], c0: [0.3, 0.34, 0.38, 0.8], c1: [0.3, 0.34, 0.38, 0], gravity: 1, drag: 0.15, cell: 7 }, fx.time); if (rand() < 0.5) fx.alpha.emit({ p: W, v: [rx * sd * 1.2, 1.0 + rand(), rz * sd * 1.2], life: 1.3, size: [0.3, 1.1 + sp * 0.08], c0: [0.3, 0.33, 0.36, 0.22], c1: [0.3, 0.33, 0.36, 0], drag: 1.2, cell: 9, wind: 0.5 }, fx.time); } } }
    // slam burst
    if (b.slam > 2 && !this._slamOn) { this._slamOn = true; b.bodyToWorld(0, -1.0, -12.5, W); for (let i = 0; i < 18; i++) fx.alpha.emit({ p: W, v: [(rand() - 0.5) * 5, 3 + rand() * 4, (rand() - 0.5) * 5], life: 1.1, size: [0.06, 0.03], c0: [0.3, 0.34, 0.38, 0.8], c1: [0.3, 0.34, 0.38, 0], gravity: 1, drag: 0.2, cell: 7 }, fx.time); this.emit('bump', { strength: 0.6, slam: true }); } else if (b.slam < 1) this._slamOn = false;
    // horn steam (flipbook puffs)
    if (this.hornT > 0) { this.hornT -= dt; V.set(0, 5.05, 3.35).applyMatrix4(f.matrixWorld); fx.smoke.emit({ p: V, v: [(rand() - 0.5) * 0.8, 2.6, (rand() - 0.5) * 0.8], life: 1.6, size: [0.15, 1.0], c0: [0.85, 0.85, 0.85, 0.45], c1: [0.9, 0.9, 0.9, 0], drag: 1.0, gravity: 0 }, fx.time); }
    // creaks / bumps
    this.creakT -= dt; const wob = Math.abs(this.body.wb[2]) + Math.abs(this.body.wb[0]); if (this.creakT <= 0) { this.creakT = 2.5 + rand() * 6 - clamp(wob * 6); if (this.mode === 'moored' || this.mode === 'hold') this.emit('creak', { strength: clamp(0.3 + wob * 5), rope: this.mode === 'moored' }); else if (wob > 0.06) this.emit('creak', { strength: clamp(wob * 4), rope: false }); }
    this.bumpCool = (this.bumpCool || 0) - dt; if (this.body.bump > 0.12 && this.bumpCool <= 0) { this.emit('bump', { strength: clamp(this.body.bump / 0.9), fender: true }); this.bumpCool = 0.7; } this.body.bump = 0;
  }
  _horn(sec) { this.hornT = sec; }

  // ------------------------------------------------------------------ helpers for the integrator: neutralise stale mirrored colliders (game.js syncVehicle snapshots)
  _neutraliseMirror() {
    const stops = this.world.stops; for (const st of stops) { const c = st.B && st.B.colliders; if (!c) continue; for (const b of c.boxes) if (b.tag === 'vehicle' || b.tag === 'vehicleFloor') { b.walk = false; b.solid = false; b.shootable = false; } for (const b of c.cyls) if (b.tag === 'vehicle') { b.walk = false; b.solid = false; b.shootable = false; } }
  }
}

export async function buildFerry(ctx) { const v = new Ferry(ctx.world, ctx); return v; }
