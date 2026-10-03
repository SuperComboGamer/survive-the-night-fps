// THE GONDOLA -- a detachable 8-passenger cabin on a moving haul rope. Real physics: the cabin is a 2-DOF pendulum (pitch/roll about the grip)
// driven by wind drag (1/2 rho Cd A v_rel^2, advected gusts), cable acceleration (jerk-limited), rope curvature (catenary sag + bullwheel arcs)
// and tower crossings (sheave-train bumps). The frame the player rides in is the pendulum's cabin: accelerations are analytic and include the
// floor-tilt component of gravity, so the player is pushed inertially. Stations: the cabin wraps the bullwheel at walking pace, stops at the
// platform and opens its doors; on departure it accelerates out onto the rope. Other cabins pass on the parallel rope (traffic.js).
import * as THREE from 'three';
import { Vehicle } from '../../core/vehicle.js';
import { clamp, lerp, smoothstep, damp, easeInOutCubic, noise2 } from '../../core/util.js';
import { buildCabin, CAB } from './cabin.js';
import { getLine, sampleS, LAND } from './line.js';
import { Pendulum, wind, WIND_DIR, G0 } from './pendulum.js';
import { Traffic, LEG_WIND } from './traffic.js';
import { PARKED } from './vdress.js';

export const CRUISE = [11, 12, 16];      // rope speed per leg (m/s): legs take ~40 s (real detachables run 5-7 m/s; the 532 m descent to the village runs faster, ~46 s)
const A_MAX = 1.6, A_DEC = 1.2, JERK = 0.8, ARC_V = 3.0;
const V3 = THREE.Vector3, Q4 = THREE.Quaternion;

export class Gondola extends Vehicle {
  constructor(world, ctx) {
    super(world, { name: 'gondola' });
    this.ctx = ctx; this.gfx = ctx.gfx; this.fx = ctx.fx; this.line = getLine();
    this.cab = buildCabin(ctx); this.frame.add(this.cab.group);
    this.traffic = new Traffic(this.line, this.cab, PARKED.get(world) || []); this.trafficGroup = this.traffic.group;
    this.pend = new Pendulum(); this.leg = 0; this.path = this.line.paths[0]; this.s = 0; this.v = 0; this.acc = 0; this.vmax = 14; this.moving = false;
    this.stopAtEnd = true; this.endS = 0; this._done = null; this.hooks = null; this.bumps = []; this.lastS = 0; this.frostK = 0.2; this.gustK = 0; this.creakT = 2; this.stateT = 0;
    this.pos = new V3(); this.quat = new Q4(); this.pivot = new V3(); this.hx = 1; this.hz = 0; this.vel3 = new V3(); this.prevPos = new V3(); this._first = true;
    this.ropeSpeed = 0.5; this.a_h = 0; this.a_u = 0; this.a_l = 0; this.windSpeed = 0; this.expo = 0; this.sway = 0; this.wx = 0; this.wz = 0; this._lp = new V3(0, 1.15, 0);
    // interior colliders (frame-local)
    const hd = CAB.D / 2, W = CAB.W;
    for (const sz of [-1, 1]) this.colliders.addBox({ x: 0, y: 0.26, z: sz * (hd - 0.07 - 0.24), hx: (W - 0.16) / 2, hy: 0.26, hz: 0.23, surface: 'fabric', walk: false });
    this.colliders.addBox({ x: 0.98, y: 0.9, z: 0, hx: 0.06, hy: 1.0, hz: 1.2, surface: 'metal', walk: false });
    this.bounds = { minX: -0.92, maxX: 0.92, minZ: -0.66, maxZ: 0.66 }; this.boardBox = { min: new V3(-0.95, 0, -0.68), max: new V3(0.95, 2.1, 0.68) }; this.floorY = 0;
    // interior lamp (a pooled real light that follows the cabin)
    this.lamp = this.gfx.addLight({ kind: 'point', pos: new V3(), color: 0xffe8c8, intensity: 0.6, distance: 5.5, decay: 2, priority: 6, enabled: false, flicker: 0 });
    // ride weather (snow rushing past the windows): volumes owned by the vehicle
    this.rideSnow = this.fx.addWeather({ count: 3600, box: [30, 18, 30], fall: 1.6, size: 0.032, turb: 1.4, streak: 0, color: [0.86, 0.9, 0.98], alpha: 0.75, cell: 3, wind: [3, 0, 8], seed: 41 }); this.rideSnow.intensity = 0;
    this.rideStreak = this.fx.addWeather({ count: 2600, box: [36, 20, 36], fall: 2.2, size: 0.018, turb: 0.6, streak: 12, color: [0.8, 0.86, 0.96], alpha: 0.45, cell: 13, wind: [4, 0, 11], seed: 43 }); this.rideStreak.intensity = 0;
    this.group.visible = false; this.state = 'away'; this.applyDoors(0); this.setDoors(0);
    this.snowLevel = 0;
  }

  // ---------------------------------------------------------------- lifecycle
  _setLeg(k) { this.leg = k; this.path = this.line.paths[k]; this.vmax = CRUISE[k]; }
  _place(s) { this.s = s; this._sync(0, true); }
  parkAway() { this.group.visible = false; this.state = 'away'; this.moving = false; this.lamp.enabled = false; }
  snapDocked(stop) { this._setLeg(stop.index); this.moving = false; this.s = 0; this.v = 0; this.acc = 0; this.pend.reset(); this.group.visible = true; this.state = 'open'; this.stopIndex = stop.index; this._sync(0, true); this.setDoors(1); this.frostK = 0.12; }
  _go(path, leg, s0, v0, endS, stop) {
    this._setLeg(leg); this.s = s0; this.v = v0; this.acc = 0; this.endS = endS; this.stopAtEnd = stop; this.moving = true; this.lastS = s0; this.bumps.length = 0;
    return new Promise((res) => { this._done = res; });
  }
  /** Bring the cabin into `stop`: it appears on the line ~130 m out, slows, wraps the bullwheel and docks with doors open. */
  async arrive(stop) {
    if (!this._ticks || (this.state === 'open' && this.stopIndex === stop.index)) { this.snapDocked(stop); return; }        // sandbox / already docked: no animated approach
    const leg = (stop.index + 2) % 3, P = this.line.paths[leg]; const s0 = Math.max(0, P.length - 150);
    this.group.visible = true; this.state = 'arriving'; this.setDoors(0); this.pend.reset(); this.stopIndex = stop.index; this.hooks = null; this.frostK = 0.25 + leg * 0.2;
    this._setLeg(leg); this.s = s0; this._sync(0, true); this.emit('approach', { stop: stop.index });
    await this._go(P, leg, s0, Math.min(CRUISE[leg] * 0.55, 8), P.length, true);
    this._setLeg(stop.index); this.s = 0; this.moving = false; this.v = 0; this._sync(0, true); this.state = 'open'; this.emit('arrived', { stop: stop.index }); await this.openDoors(1.6);
  }
  async ride(fromStop, toStop, hooks = {}) {
    const k = fromStop.index; this._setLeg(k); this.state = 'closing'; this.hooks = hooks; this.pend.reset();
    await this.closeDoors(1.6); await this.wait(0.55); this.state = 'riding'; this.emit('start', { leg: k, cruise: CRUISE[k] });
    await this._go(this.path, k, 0, 0, this.path.length, true);
    this.hooks = null; if (hooks.progress) hooks.progress(1); const dest = this.line.paths[k].to;
    this._setLeg(dest); this.s = 0; this.moving = false; this.v = 0; this._sync(0, true); this.state = 'open'; this.stopIndex = dest; this.emit('arrived', { stop: dest }); await this.openDoors(1.7);
  }
  async depart(stop) {
    const k = stop.index; this._setLeg(k); this.state = 'closing'; await this.closeDoors(1.5); await this.wait(0.4); this.state = 'riding';
    await this._go(this.path, k, 0, 0, 120, false); this.parkAway(); this.emit('departed', { stop: k });
  }
  get exitPoint() { const p = new V3(0, 0, 0); this.frame.updateWorldMatrix(true, false); return this.localToWorld(p.set(-2.3, 0, 0), p); }

  // ---------------------------------------------------------------- doors (two sliding leaves, right side)
  applyDoors(k) {
    const [L, R] = this.cab.doors, z0 = this.cab.doorClosed; const open = (CAB.doorW / 2 - 0.02) * k;
    L.position.z = z0[0] - open; R.position.z = z0[1] + open; this.bounds && (this.bounds.minX = k > 0.3 ? -1.6 : -0.92);
  }

  // ---------------------------------------------------------------- physics
  _plan(dt) {
    const P = this.path, s = this.s, v = this.v; let vcap = this.vmax, ff = 0;
    if (this.stopAtEnd) {
      if (s < P.arcS0 - 2) { const dArc = P.arcS0 - 2 - s; const v1 = Math.sqrt(ARC_V * ARC_V + 2 * A_DEC * dArc); if (v1 < vcap) { vcap = v1; ff = -A_DEC * v / v1; } }          // slow to walking pace before the bullwheel
      else { const dEnd = Math.max(0, this.endS - s); const v2 = Math.min(ARC_V, Math.sqrt(2 * 0.6 * dEnd) + 0.03); if (v2 < vcap) { vcap = v2; ff = dEnd < 4.8 ? -0.6 * v / Math.max(v2, 0.1) : 0; } }     // creep round the wheel, stop at the platform
    }
    const err = vcap - v; let acmd = clamp(err * 1.7 + (vcap < this.vmax - 0.01 ? ff : 0), -A_DEC * 1.2, A_MAX);
    this.acc += clamp(acmd - this.acc, -JERK * dt, JERK * dt);
    this.v = Math.max(0, v + this.acc * dt); this.s = s + (v + this.v) * 0.5 * dt;
    if (this.stopAtEnd) { if (this.endS - this.s < 0.02 || (this.endS - this.s < 0.25 && this.v < 0.12)) { this.s = this.endS; this.v = 0; this.acc = 0; this.moving = false; const d = this._done; this._done = null; d && d(); } }
    else if (this.s >= this.endS) { this.moving = false; const d = this._done; this._done = null; d && d(); }
  }
  _windFor(px, pz, t, s) {
    const P = this.path, k = this.leg, wd = LEG_WIND[k], f = s / P.length;
    const scale = k === 0 ? lerp(0.8, 1.05, f) : k === 1 ? lerp(0.9, 1.2, f) : lerp(1.2, 0.8, smoothstep(0, 1, f));
    const expo = smoothstep(P.gateOutS - 8, P.gateOutS + 6, s) * (1 - smoothstep(P.gateInS - 6, P.gateInS + 10, s));
    const sp = wind.speed(px, pz, t, wd.mean * scale, wd.gust) * expo; const a = Math.atan2(WIND_DIR[1], WIND_DIR[0]) + wind.wobble(px, pz, t);
    this.windSpeed = sp; this.expo = expo; this.wx = Math.cos(a) * sp; this.wz = Math.sin(a) * sp;
  }
  update(dt, time) { this._ticks = (this._ticks || 0) + 1; const f = this.world.routeData && this.world.routeData.forest; if (f) { const cam = this.gfx.camera; cam.getWorldDirection(this._fd || (this._fd = new V3())); f.update(cam.position, this._fd); } super.update(dt, time); }
  simulate(dt, time) {
    const near = this.state === 'away' ? -1 : this.state === 'arriving' ? this.stopIndex : this.state === 'riding' ? (this.s < 45 ? this.leg : this.s > this.path.length - 45 ? this.path.to : -1) : (this.stopIndex ?? -1);
    this.traffic.update(dt, time, { leg: this.moving && this.state === 'riding' ? this.leg : -1, v: this.v, s: this.s, near, cam: this.gfx.camera.position });
    this.ropeSpeed = this.moving && this.state === 'riding' ? Math.max(0.5, this.v) : 0.5;
    if (this.state === 'away') return;
    dt = Math.min(dt, 0.05);
    if (this.moving) this._plan(dt); else { this.v = 0; this.acc = 0; }
    this._sync(dt, false); this._effects(dt, time);
    if (this.hooks && this.hooks.progress && this.state === 'riding') this.hooks.progress(smoothstep(0.06, 0.94, this.s / this.path.length));
  }
  /** integrate the pendulum, place the frame */
  _sync(dt, snap) {
    const P = this.path, T = sampleS(P, this.s), t = this.time; const hl = Math.hypot(T.tx, T.tz) || 1; let hx = T.tx / hl, hz = T.tz / hl;
    // heading smoothing is unnecessary: the plan path is smooth (arcs are circles)
    this.hx = hx; this.hz = hz; const v = this.v, acc = this.acc;
    // pivot acceleration = T*acc + K*v^2 (+ tower bumps), in the (h,u,l) frame
    let ax = T.tx * acc + T.kx * v * v, ay = T.ty * acc + T.ky * v * v, az = T.tz * acc + T.kz * v * v;
    let bu = 0, bh = 0;
    for (let i = this.bumps.length - 1; i >= 0; i--) { const b = this.bumps[i]; const tau = t - b.t0; if (tau > 0.7) { this.bumps.splice(i, 1); continue; } const pulse = b.amp * Math.exp(-tau / 0.11) * Math.sin(6.28318 * 5.2 * tau); bu += pulse * 1.3; bh += pulse * 0.55; }
    ay += bu; ax += hx * bh; az += hz * bh;
    const lx = -hz, lz = hx; const ah = ax * hx + az * hz, au = ay, al = ax * lx + az * lz;
    this._windFor(T.x, T.z, t, this.s);
    const vh = v * (T.tx * hx + T.tz * hz), vl = v * (T.tx * lx + T.tz * lz);
    const wh = this.wx * hx + this.wz * hz, wl = this.wx * lx + this.wz * lz;
    const hold = Math.max(1 - smoothstep(P.gateOutS - 14, P.gateOutS - 2, this.s), smoothstep(P.gateInS - 4, P.gateInS + 12, this.s));
    const torque = noise2(t * 0.6, 5.5) * 0.5 * this.windSpeed / 12 * this.expo;
    if (snap) { this.pend.reset(); } else this.pend.step(dt, ah, au, al, vh, vl, wh, wl, hold, torque);
    this.a_h = ah; this.a_u = au; this.a_l = al; this.pivot.set(T.x, T.y, T.z);
    this.pend.pose(T.x, T.y, T.z, hx, hz, this.pos, this.quat);
    this.frame.position.copy(this.pos); this.frame.quaternion.copy(this.quat); this.frame.updateMatrix();
    this.sway = Math.hypot(this.pend.th, this.pend.ph);
    // crossing detection (towers) -- bump + audio + camera shake
    if (this.moving) for (let i = 0; i < P.towers.length; i++) { const ts = P.towers[i].s; if (this.lastS < ts && this.s >= ts && v > 2) { const amp = 0.3 + 0.055 * v; this.bumps.push({ t0: t, amp }); this.emit('bump', { tower: i, speed: v, intensity: clamp(v / 18, 0.2, 1) }); this.fx.addShake(0.05 + 0.006 * v); this.pend.thd += 0.008 * v / 15; this._towerKick(v); } }
    if (this.moving) this.lastS = this.s;
  }
  /** crossing a tower: the grip runs over the sheave train -- a burst of ice chips and a few sparks off the rope, a rime cloud shaken loose from the tower head */
  _towerKick(v) {
    const p = this.pivot, k = clamp(v / 18, 0.3, 1); const W = this._kp || (this._kp = new V3()), D = this._kd || (this._kd = new V3());
    W.copy(p); D.set(-this.hx * 0.6, 0.5, -this.hz * 0.6);
    this.fx.spark(W, D, 6 + ((8 * k) | 0), 4 + 4 * k, 0.014, [0.85, 0.92, 1.0], 0.5);
    this.fx.puff(W, D, 5, { speed: 2.4 * k, size: [0.1, 0.6], life: 1.4, color: [0.92, 0.95, 1, 0.5], rise: 0.2, drag: 1.4, spread: 1, cell: 1 });
    this.fx.puff({ x: W.x + this.hx * 3, y: W.y + 1.6, z: W.z + this.hz * 3 }, { x: 0.3, y: -0.3, z: 0.1 }, 4, { speed: 1.4, size: [0.2, 0.9], life: 2.2, color: [0.9, 0.94, 1, 0.35], rise: -0.4, drag: 1.0, spread: 1.2, cell: 1 });
  }
  /** override: analytic kinematics (smooth, no finite-difference noise) + floor-tilt gravity so the player slides on a tilted floor */
  _track(dt) {
    if (dt <= 0) return; const p = this.pend, L = p.Lf, sT = Math.sin(p.th), cT = Math.cos(p.th), sP = Math.sin(p.ph), cP = Math.cos(p.ph);
    const thd = p.thd, phd = p.phd; const tt = damp(this._sthdd ?? 0, p.thdd, 22, dt), pp = damp(this._sphdd ?? 0, p.phdd, 22, dt); this._sthdd = tt; this._sphdd = pp;
    const Dh = tt * cT * cP - thd * thd * sT * cP - 2 * thd * phd * cT * sP - pp * sT * sP - phd * phd * sT * cP;
    const Du = tt * sT * cP + thd * thd * cT * cP - 2 * thd * phd * sT * sP + pp * cT * sP + phd * phd * cT * cP;
    const Dl = pp * cP - phd * phd * sP;
    const ah = this.a_h + L * Dh, au = this.a_u + L * Du, al = this.a_l + L * Dl; const hx = this.hx, hz = this.hz;
    this.accel.set(ah * hx - al * hz, au, ah * hz + al * hx).clampLength(0, 25);
    const inv = this._qi || (this._qi = new Q4()); inv.copy(this.quat).invert(); this.accelLocal.copy(this.accel).applyQuaternion(inv);
    // gravity component along the tilted floor (the base class only knows the frame's world acceleration)
    const g = this._g || (this._g = new V3()); g.set(0, -G0, 0).applyQuaternion(inv); this.accelLocal.x -= g.x; this.accelLocal.z -= g.z;
    this.vel.set(this.v * hx, 0, this.v * hz); this.angVel.set(-p.thd, p.psid, p.phd);
  }
  _effects(dt, time) {
    const riding = this.state === 'riding', T = this.time;
    // frost creeps in on the panes while riding; the warm docked cabin clears slowly
    const target = riding || this.state === 'arriving' ? clamp(0.3 + this.leg * 0.22 + 0.3 * this.s / this.path.length, 0, 1) : 0.1;
    this.frostK = damp(this.frostK, target, riding ? 0.05 : 0.15, dt); this.cab.frost.value = this.frostK;
    // interior lamp follows the cabin, flickers on bumps and gusts
    const l = this.lamp; this.localToWorld(this._lp, l.pos);
    let fl = 0.92 + 0.08 * noise2(T * 9, 1.7); for (const b of this.bumps) fl *= 1 - 0.55 * Math.exp(-(T - b.t0) / 0.09) * Math.abs(Math.sin((T - b.t0) * 40)); l.intensity = 1.0 * fl * (this.state === 'away' ? 0 : 1); l.enabled = this.group.visible; this.cab.lampMat.emissiveIntensity = 2.2 * fl;
    // ride weather (world-fixed flakes rushing past the windows at cruise)
    const k = riding ? clamp(this.v / 6, 0, 1) : this.state === 'arriving' ? clamp(this.v / 6, 0, 1) : 0; this.rideSnow.intensity = damp(this.rideSnow.intensity, k * this.expo, 2, dt); this.rideStreak.intensity = damp(this.rideStreak.intensity, k * this.expo * clamp(this.windSpeed / 12, 0.2, 1), 2, dt);
    for (const w of [this.rideSnow, this.rideStreak]) { w.u.uWind.value.set(WIND_DIR[0] * this.windSpeed * 0.8, 0, WIND_DIR[1] * this.windSpeed * 0.8); }
    // the storm blows in through the open doors (stronger at every stop); a constant sheave/rope rumble while riding
    const dOpen = this.doors > 0.3 && this.state !== 'away'; this.ingT = (this.ingT || 0) - dt;
    if (dOpen && this.ingT <= 0) { const lvl = [0.4, 0.75, 1.15][this.stopIndex ?? 0] ?? 0.5; this.ingT = 0.06 / lvl; const wp = this._ing || (this._ing = new V3()), o = this._ingO || (this._ingO = { x: 0, y: 0, z: 0 }); wp.set(-1.15, 0.5 + Math.random() * 1.4, (Math.random() - 0.5) * 1.1); this.localToWorld(wp, wp);
      this.fx.puff(wp, { x: (Math.cos(this.hx) * 0 + WIND_DIR[0]) * 1, y: 0.05, z: WIND_DIR[1] }, 1, { speed: 2.6 * lvl, size: [0.05, 0.12], life: 1.3, color: [0.9, 0.94, 1, 0.5], rise: -0.05, drag: 0.7, spread: 0.9, cell: 3 }); void o; }
    if (riding && this.moving) this.fx.addShake(dt * 1.6 * (0.02 + 0.03 * clamp(this.v / 18, 0, 1) + 0.035 * clamp(this.windSpeed / 25, 0, 1)));
    // audio cues for the vehicle sound engine
    this.creakT -= dt; const sw = Math.hypot(this.pend.thd, this.pend.phd); if (this.creakT <= 0 && this.moving) { this.emit('creak', { amount: clamp(sw * 4 + this.windSpeed / 30, 0, 1), sway: this.sway }); this.creakT = 1.2 + Math.random() * 3.4 * (1 - clamp(sw * 3, 0, 0.7)); }
    this.stateT -= dt; if (this.stateT <= 0) { this.stateT = 0.12; this.emit('state', { speed: this.v, wind: this.windSpeed, sway: this.sway, swayRate: sw, expo: this.expo, riding, leg: this.leg, s: this.s / this.path.length, accel: this.acc }); }
  }
}
