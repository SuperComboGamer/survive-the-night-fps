// First-person player: real-scale kinematics (eye 1.7 m, walk 4 m/s, sprint 6.2 m/s, jump ≈ 0.9 m), collision against the active stop
// or the interior of a vehicle (platform mode with inertial coupling), camera effects (bob, strafe roll, landing dip, kick springs).
import * as THREE from 'three';
import { clamp, damp, lerp, Spring, Spring3, noise2, TAU } from './util.js';

const V = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), Q2 = new THREE.Quaternion();
const G_PLAYER = 19.6; // gameplay gravity (2 g) => 0.9 m jump with 5.9 m/s take-off, ~0.6 s air time (BO2-like)

export class Player {
  constructor(gfx, world, input) {
    this.gfx = gfx; this.world = world; this.input = input;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.radius = 0.34; this.stand = 1.7; this.crouchH = 1.15; this.eyeH = 1.7; this.height = 1.8; this.crouching = false; this.sprinting = false; this.onGround = true; this.surface = 'concrete';
    this.platform = null; this.local = new THREE.Vector3(); this.localVel = new THREE.Vector3();
    this.maxHp = 100; this.hp = 100; this.regenDelay = 5; this.sinceHit = 99; this.alive = true; this.perks = new Set(); this.speedMul = 1;
    this.kick = new Spring3(180, 20); this.bob = 0; this.bobAmp = 0; this.landDip = new Spring(160, 16); this.lean = new Spring(120, 14); this.headLag = new Spring3(60, 10);
    this.extraPitch = 0; this.extraYaw = 0; this.extraRoll = 0; this.frozen = false; this.fov = 62; this.moveSpeed = 0; this.lastStep = 0; this.stepDist = 0; this.stepping = false;
    this.eye = new THREE.Vector3(); this.forward = new THREE.Vector3(0, 0, -1); this.right = new THREE.Vector3(1, 0, 0); this.hitDir = []; this._g = { y: 0, surface: 'concrete', col: null };
    this.onStep = null; this.onLand = null; this.onDamage = null; this.onDeath = null; this.jumpBuffer = 0; this.coyote = 0; this.adsK = 0; this.canSprint = true;
  }
  get speedWalk() { return 4.0 * this.speedMul; }
  teleport(p, yaw = this.yaw) { this.pos.set(p[0] ?? p.x, p[1] ?? p.y, p[2] ?? p.z); this.vel.set(0, 0, 0); this.yaw = yaw; this.platform = null; }
  setPlatform(vehicle) {
    if (vehicle === this.platform) return;
    if (vehicle) { vehicle.frame.updateWorldMatrix(true, false); vehicle.worldToLocal(this.pos, this.local); this.localVel.set(0, 0, 0); this.yaw -= this._frameYaw(vehicle); this.platform = vehicle; }
    else if (this.platform) { const v = this.platform; this.yaw += this._frameYaw(v); v.localToWorld(this.local, this.pos); this.vel.set(0, 0, 0); this.platform = null; }
  }
  _frameYaw(v) { v.frame.updateWorldMatrix(true, false); E.setFromQuaternion(v.frame.getWorldQuaternion(Q), 'YXZ'); return E.y; }
  damage(amount, from = null) {
    if (!this.alive) return; this.hp -= amount; this.sinceHit = 0; this.kick.kick((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
    if (from) this.hitDir.push({ x: from.x, z: from.z, t: 1.4 }); this.onDamage?.(amount, from);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.onDeath?.(); }
  }
  heal(a) { this.hp = Math.min(this.maxHp, this.hp + a); }
  /** weapon recoil / impulses: pitch up (rad), yaw (rad), roll (rad) instantaneous view kick (springs recover) */
  addKick(p, y, r = 0) { this.kick.kick(p, y, r); }
  /** persistent recoil climb (does not spring back): adjusts aim */
  addAim(p, y) { this.pitch = clamp(this.pitch + p, -1.5, 1.5); this.yaw += y; }

  update(dt) {
    const inp = this.input, plat = this.platform;
    // ---- look
    if (!this.frozen && inp.locked) { const s = 0.0022 * inp.sens * (this.fov / 62) * (1 - this.adsK * 0.45); this.yaw -= inp.dx * s; this.pitch = clamp(this.pitch - inp.dy * s, -1.55, 1.55); }
    // ---- intent
    let fw = 0, st = 0; if (!this.frozen) { fw = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0); st = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0); }
    const wantCrouch = !this.frozen && (inp.down('KeyC') || inp.down('ControlLeft')); const wantSprint = !this.frozen && inp.down('ShiftLeft') && fw > 0 && !wantCrouch && this.canSprint && this.adsK < 0.3;
    if (wantCrouch !== this.crouching) { if (!wantCrouch) { /* need headroom */ } this.crouching = wantCrouch; }
    this.sprinting = wantSprint; this.eyeH = damp(this.eyeH, this.crouching ? 1.15 : 1.7, 12, dt); this.height = this.eyeH + 0.1;
    let speed = this.speedWalk * (this.crouching ? 0.5 : 1) * (this.sprinting ? 1.55 : 1) * (1 - this.adsK * 0.35);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = (-sy * fw + cy * st), wz = (-cy * fw - sy * st); const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
    if (!this.alive) { wx = wz = 0; }
    // ---- integrate
    if (!plat) this._moveWorld(dt, wx * speed, wz * speed, inp); else this._movePlatform(dt, wx * speed, wz * speed, inp, plat);
    // ---- health regen
    this.sinceHit += dt; if (this.alive && this.hp < this.maxHp && this.sinceHit > this.regenDelay) this.hp = Math.min(this.maxHp, this.hp + dt * 45);
    for (let i = this.hitDir.length - 1; i >= 0; i--) { this.hitDir[i].t -= dt; if (this.hitDir[i].t <= 0) this.hitDir.splice(i, 1); }
    this._camera(dt, plat);
  }

  _moveWorld(dt, tx, tz, inp) {
    const w = this.world; const g = w.groundAt(this.pos.x, this.pos.z, this.pos.y, this._g, 0.45);
    const grounded = this.pos.y <= g.y + 0.06 && this.vel.y <= 0.1; const wasGround = this.onGround;
    this.onGround = grounded; this.surface = g.surface; if (grounded) this.coyote = 0.1; else this.coyote -= dt;
    const lam = grounded ? (this.sprinting ? 9 : 12) : 1.8;
    this.vel.x = damp(this.vel.x, tx, lam, dt); this.vel.z = damp(this.vel.z, tz, lam, dt);
    if (inp.pressed('Space') && !this.frozen && this.alive) this.jumpBuffer = 0.12; this.jumpBuffer -= dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) { this.vel.y = 5.9; this.onGround = false; this.coyote = 0; this.jumpBuffer = 0; }
    this.vel.y -= G_PLAYER * dt; if (grounded && this.vel.y < 0) this.vel.y = 0;
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;
    // collisions (push out of solids); several iterations for corners
    for (let i = 0; i < 3; i++) if (!w.push(this.pos, this.radius, this.pos.y, this.height)) break;
    const g2 = w.groundAt(this.pos.x, this.pos.z, this.pos.y, this._g, 0.45);
    if (this.pos.y <= g2.y + 0.001 || (grounded && this.pos.y - g2.y < 0.5 && this.vel.y <= 0)) { if (!wasGround && this.vel.y < -3) { this.landDip.kick(-Math.min(4, -this.vel.y) * 0.9); this.onLand?.(-this.vel.y, g2.surface); } this.pos.y = g2.y; this.vel.y = Math.max(0, this.vel.y); this.onGround = true; this.surface = g2.surface; }
    if (g2.y > this.pos.y - 0.001) this.pos.y = Math.max(this.pos.y, g2.y);
    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);
    this._steps(dt, this.onGround);
  }
  _movePlatform(dt, tx, tz, inp, plat) {
    // target velocity is in world axes => convert to platform-local axes (yaw stored relative to frame)
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw); const fw = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0), st = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    const sp = this.speedWalk * (this.crouching ? 0.5 : 1) * (1 - this.adsK * 0.35) * (this.sprinting ? 1.35 : 1);
    let wx = (-sy * fw + cy * st), wz = (-cy * fw - sy * st); const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
    const lv = this.localVel; lv.x = damp(lv.x, wx * sp, 11, dt); lv.z = damp(lv.z, wz * sp, 11, dt);
    // inertial (fictitious) force: platform accelerations push the body the opposite way; friction resists
    const a = plat.accelLocal; lv.x -= a.x * dt * 0.75; lv.z -= a.z * dt * 0.75;
    this.headLag.x.target = clamp(-a.x * 0.006, -0.06, 0.06); this.headLag.y.target = clamp(-a.y * 0.005, -0.05, 0.05); this.headLag.z.target = clamp(-a.z * 0.006, -0.06, 0.06);
    if (inp.pressed('Space') && !this.frozen && this.onGround) { lv.y = 5.0; this.onGround = false; } lv.y -= G_PLAYER * dt;
    this.local.x += lv.x * dt; this.local.z += lv.z * dt; this.local.y += lv.y * dt;
    const c = plat.colliders, b = plat.bounds; const P = { x: this.local.x, z: this.local.z };
    for (let i = 0; i < 2; i++) c.push(P, this.radius, this.local.y, this.height, 0.35);
    P.x = clamp(P.x, b.minX + this.radius, b.maxX - this.radius); P.z = clamp(P.z, b.minZ + this.radius, b.maxZ - this.radius); this.local.x = P.x; this.local.z = P.z;
    const g = c.ground(P.x, P.z, this.local.y, 0.4, this._g); const fl = g.y + plat.floorY * 0;
    if (this.local.y <= fl) { if (!this.onGround && lv.y < -2.5) this.landDip.kick(-Math.min(3, -lv.y) * 0.7); this.local.y = fl; lv.y = 0; this.onGround = true; this.surface = g.surface; } else if (this.local.y > fl + 0.06) this.onGround = false;
    plat.localToWorld(this.local, this.pos); this.moveSpeed = Math.hypot(lv.x, lv.z); this._steps(dt, this.onGround && this.moveSpeed > 0.3);
  }
  _steps(dt, grounded) {
    const spd = this.moveSpeed; if (grounded && spd > 0.5) { const stride = this.sprinting ? 2.0 : this.crouching ? 1.1 : 1.45; this.stepDist += spd * dt; if (this.stepDist > stride) { this.stepDist -= stride; this.onStep?.(this.surface, this.sprinting ? 1.4 : this.crouching ? 0.45 : 1); } }
    this.bobAmp = damp(this.bobAmp, grounded ? clamp(spd / 4.5, 0, 1.5) : 0, 10, dt); this.bob += dt * (spd * (this.sprinting ? 2.1 : 2.6) + 0.0);
    this.lean.target = 0;
  }
  _camera(dt, plat) {
    const inp = this.input; this.kick.step(dt); this.landDip.step(dt); this.lean.step(dt);
    if (plat) this.headLag.step(dt);
    // strafe roll: proportional to lateral velocity relative to view
    const lat = plat ? this.localVel.x * Math.cos(this.yaw) + this.localVel.z * (-Math.sin(this.yaw)) : this.vel.x * Math.cos(this.yaw) + this.vel.z * (-Math.sin(this.yaw));
    this.roll = damp(this.roll, -lat * 0.0065, 8, dt);
    const bobY = Math.sin(this.bob * 2) * 0.018 * this.bobAmp * (1 - this.adsK * 0.8), bobX = Math.sin(this.bob) * 0.012 * this.bobAmp * (1 - this.adsK * 0.8);
    const lag = plat ? this.headLag : null; const fxs = this.gfx.fxShake || 0;
    const t = performance.now() * 0.001, shx = fxs * (noise2(t * 24, 1.3)) * 0.06, shy = fxs * (noise2(t * 24, 7.7)) * 0.06, shr = fxs * noise2(t * 20, 3.1) * 0.05;
    // camera pose
    const yawTot = this.yaw + this.kick.y.x + shx + this.extraYaw, pitchTot = this.pitch + this.kick.x.x + shy + this.extraPitch, rollTot = this.roll + this.kick.z.x + shr + this.extraRoll;
    const eyeOff = this.eyeH + bobY + this.landDip.x * 0.02 + (lag ? lag.y.x : 0);
    if (plat) {
      const base = V.set(this.local.x + bobX * Math.cos(this.yaw) + (lag ? lag.x.x : 0), this.local.y + eyeOff, this.local.z - bobX * Math.sin(this.yaw) + (lag ? lag.z.x : 0));
      plat.frame.updateWorldMatrix(true, false); base.applyMatrix4(plat.frame.matrixWorld); this.eye.copy(base);
      E.set(pitchTot, yawTot, rollTot, 'YXZ'); Q.setFromEuler(E); plat.frame.getWorldQuaternion(Q2); Q.premultiply(Q2);
    } else { this.eye.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + eyeOff, this.pos.z - bobX * Math.sin(this.yaw)); E.set(pitchTot, yawTot, rollTot, 'YXZ'); Q.setFromEuler(E); }
    const cam = this.gfx.camera; cam.position.copy(this.eye); cam.quaternion.copy(Q); cam.updateMatrixWorld();
    this.forward.set(0, 0, -1).applyQuaternion(Q); this.right.set(1, 0, 0).applyQuaternion(Q);
    // world-space yaw for gameplay (aim direction independent of roll)
    this.aimDir = this.forward;
  }
  /** world-space yaw of the view (accounts for platform rotation) */
  get worldYaw() { return Math.atan2(-this.forward.x, -this.forward.z); }
}
