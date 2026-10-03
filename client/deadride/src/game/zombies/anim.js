// Procedural, physically grounded locomotion + upper-body layers for one zombie.
//   Root: acceleration-limited velocity, lateral-accel-limited turning, facing follows velocity (turn-rate limit).
//   Gait: one stride phase φ; each foot has a stance window (duty factor by speed). Stance feet are LOCKED to the ground at the
//         contact point (heel rocker → flat → forefoot rocker, pivoting exactly on the contact) — they cannot slip by construction;
//         swing feet fly along a minimum-jerk arc to a target predicted from the root velocity at touchdown (mid-stance under the hip).
//   Pelvis: height = min(desired, reach limit of every stance leg) → the inverted-pendulum dip at double support emerges; sway toward
//         the stance foot, rotation/list with the stride; spine counter-rotates; lean = atan(a/g) + speed lean + banking in turns.
//   Arms:  per-arm damped pendulum (flex/abduct/elbow) driven by mode targets + chest acceleration (they lag and overshoot).
//   Head:  critically-damped look-at with neck limits and lag; jaw from voice/attack.
//   Layers: attack (two swings with a damage frame), stagger springs fed by hit impulses at the hit location, knee buckle.
import * as THREE from 'three';
import { BI, RIG, NB, solveTwoBone, arcQuat, axisAngle, expMap } from './rig.js';
import { clamp, lerp, damp, wrapAngle, angleDelta, smoothstep } from '../../core/util.js';

const V3 = THREE.Vector3, Q4 = THREE.Quaternion;
const G = 9.81;
// scratch
const _v = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3(), _q = new Q4(), _q2 = new Q4(), _q3 = new Q4(), _q4 = new Q4();
const _cl = new V3(), _cl2 = new V3(); // hand-to-wound clutch scratch
const _pole = new V3(), _tgt = new V3(), _fw = new V3(), _sv = new V3();
const X_NEG = new V3(-1, 0, 0);
const UP = new V3(0, 1, 0);
const b = BI;
// rest data
const LEGR = {}; for (const s of ['L', 'R']) { const L = RIG.leg[s]; LEGR[s] = { hip: new V3(...L.hip), ankle: new V3(...L.ankle), heel: new V3(L.ankle[0], 0, 0.083), ball: new V3(L.ball[0], 0, L.ball[2]), thigh: RIG.bones[BI['thigh.' + s]], len: new V3(...L.hip).distanceTo(new V3(...L.knee)) + new V3(...L.knee).distanceTo(new V3(...L.ankle)) }; }
const ARMR = {}; for (const s of ['L', 'R']) { const A = RIG.arm[s]; ARMR[s] = { u0: new V3(...A.u), f0: new V3(...A.f), elbowAxis: new V3(...A.elbowAxis), sx: A.sx, h: new V3(...A.h), p: new V3(...A.p), wristAxis: new V3().crossVectors(new V3(...A.h), new V3(...A.p)).normalize(), fingers: A.fingers }; }
// foot geometry (rest, model space, relative to the ankle projection)
const A_H = new V3(0, 0.077, 0.024 - 0.083); // ankle − heel contact
const A_B = { L: new V3(RIG.leg.L.ankle[0] - RIG.leg.L.ball[0], 0.077 - 0.024, 0.024 + 0.118), R: new V3(RIG.leg.R.ankle[0] - RIG.leg.R.ball[0], 0.077 - 0.024, 0.024 + 0.118) }; // ankle − MTP (toe) joint: the forefoot rocker pivots on the joint, toes stay flat & fixed
const BALL_OFF = { L: new V3(RIG.leg.L.ball[0] - RIG.leg.L.ankle[0], 0, RIG.leg.L.ball[2] - 0.083), R: new V3(RIG.leg.R.ball[0] - RIG.leg.R.ankle[0], 0, RIG.leg.R.ball[2] - 0.083) };
const MTP_H = 0.024;
const HEEL_TO_BALL = 0.201;

// gait tables (speed m/s → params); interpolated
const GK = [
  //  v     cadence duty  clear  kick  strike toeOff width bob   sway  prot  armSw  lean
  [0.0, 1.10, 0.70, 0.030, 0.00, 0.10, 0.30, 0.17, 0.004, 0.022, 0.05, 0.10, 0.00],
  [0.9, 1.52, 0.65, 0.034, 0.00, 0.17, 0.42, 0.16, 0.010, 0.030, 0.10, 0.28, 0.03],
  [1.4, 1.78, 0.62, 0.040, 0.02, 0.21, 0.50, 0.15, 0.014, 0.028, 0.13, 0.36, 0.05],
  [2.4, 2.45, 0.37, 0.085, 0.16, 0.12, 0.62, 0.11, 0.030, 0.018, 0.15, 0.55, 0.14],
  [3.5, 2.62, 0.31, 0.105, 0.22, 0.08, 0.70, 0.09, 0.036, 0.014, 0.16, 0.70, 0.19],
  [4.5, 2.85, 0.25, 0.130, 0.30, -0.04, 0.78, 0.07, 0.040, 0.010, 0.17, 0.85, 0.26],
  [6.0, 3.10, 0.21, 0.160, 0.36, -0.10, 0.85, 0.06, 0.044, 0.008, 0.18, 0.95, 0.32],
];
const GP = { cadence: 1, duty: 2, clear: 3, kick: 4, strike: 5, toeOff: 6, width: 7, bob: 8, sway: 9, prot: 10, armSw: 11, lean: 12 };
const GPK = Object.keys(GP), GPI = GPK.map((k) => GP[k]);
function gaitParams(v, out) {
  let i = 0; while (i < GK.length - 2 && v > GK[i + 1][0]) i++;
  const a = GK[i], c = GK[i + 1], t = clamp((v - a[0]) / (c[0] - a[0]), 0, 1);
  for (let k = 0; k < GPK.length; k++) { const j = GPI[k]; out[GPK[k]] = a[j] + (c[j] - a[j]) * t; }
  return out;
}
const FN5 = ['index', 'middle', 'ring', 'pinky', 'thumb'];
const mjerk = (t) => t * t * t * (10 + t * (-15 + 6 * t));

/** simple damped angular spring (scalar) */
class S1 { constructor(k = 60, c = 12) { this.x = 0; this.v = 0; this.k = k; this.c = c; this.t = 0; } step(dt) { const n = dt > 0.02 ? 2 : 1, h = dt / n; for (let i = 0; i < n; i++) { this.v += (this.k * (this.t - this.x) - this.c * this.v) * h; this.x += this.v * h; } return this.x; } }

export class Animator {
  constructor(pose, rng) {
    this.pose = pose; this.rng = rng;
    this.pos = new V3(); this.vel = new V3(); this.yaw = 0; this.yawRate = 0; this.acc = new V3(); this._pv = new V3();
    this.want = { vx: 0, vz: 0, faceYaw: null, look: new V3(), hasLook: false, speedCap: 1 };
    this.gp = {}; this.phase = 0; this.moving = false; this.cls = 'walk'; this.scale = 1;
    this.feet = ['L', 'R'].map((s, i) => ({ s, i, rec: -1, recFrom: new V3(), recPitch: 0, stance: true, heel: new V3(), yaw: 0, pitch: 0, liftAnkle: new V3(), liftPitch: 0, tgtHeel: new V3(), ankle: new V3(), plantBall: new V3(), plantHeel: new V3(), slip: 0, pivot: 0, tgtYaw: 0, corr: -1, corrFrom: new V3(), corrT: 0, groundY: 0, drag: false, toeY: 0 }));
    this.pelvisY = 0; this.pelvisYV = 0; this.pelvisOff = new V3(); this.sway = 0;
    // springs: arms [flex, abd, elbow] per side, head yaw/pitch, spine (twist, flex, side), knee buckle
    this.arm = { L: { f: new S1(40, 9), a: new S1(40, 9), e: new S1(50, 10), mode: 'swing', pron: 0 }, R: { f: new S1(40, 9), a: new S1(40, 9), e: new S1(50, 10), mode: 'swing', pron: 0 } };
    this.head = { y: new S1(30, 11), p: new S1(30, 11), r: new S1(40, 10) };
    this.hit = { chestX: new S1(90, 9), chestY: new S1(90, 9), chestZ: new S1(90, 9), headX: new S1(140, 11), headY: new S1(140, 11), headZ: new S1(140, 11), pelvisX: new S1(80, 10), pelvisZ: new S1(80, 10), buckleL: new S1(60, 9), buckleR: new S1(60, 9), armL: new S1(70, 8), armR: new S1(70, 8) };
    this.jaw = new S1(80, 9); this.jawOpen = 0.08; this.voiceJaw = 0; this.breath = rng() * 10;
    // idiosyncrasy
    this.idio = { limp: 0, limpSide: 1, drag: -1, hunch: 0.1, tilt: 0, twitch: 0, lean: 0, armHang: -1, cadenceMul: 1, widthMul: 1, sway: 1, loll: 0, kypho: 0, headFwd: 0, shDrop: 0, kneeSplay: 0, toeOut: 0 };
    this.lunge = 0; this.clutch = null; this._clutchPlant = { L: null, R: null }; this._twT = 1;
    this.attack = null; this.onAttackFrame = null; this.tAlive = 0; this.stepSink = null;
    this.slip = { max: 0, sum: 0, n: 0, last: 0 }; this.measure = false;
    this.lookW = 1; this.crouch = 0; this.stumble = 0; this.onStep = null; this.speedClass = 'walk';
    this.handPlant = null; // optional arm IK targets {L:V3|null, R:V3|null}
    this.strafe = false; // face want.faceYaw even while moving (the living: co-op teammates walk one way and look another)
    this.scripted = null; this.mode = 'loco'; this.lost = null;
  }
  /** initialise at a world position/yaw with body scale */
  reset(pos, yaw, scale) {
    this.pos.copy(pos); this.yaw = yaw; this.yawRate = 0; this.vel.set(0, 0, 0); this.acc.set(0, 0, 0); this.scale = scale; this.phase = 0; this.moving = false; this.attack = null; this.stumble = 0;
    const s = scale; this.pelvisY = pos.y + 0.925 * s; this.pelvisYV = 0;
    for (const f of this.feet) { this._standPos(f, _v); f.heel.copy(_v); f.yaw = yaw; f.pitch = 0; f.stance = true; f.corr = -1; f.rec = -1; f.slip = 0; f.groundY = pos.y; f.plantHeel.copy(f.heel); this._ballOf(f, f.plantBall); this._ankleFrom(f, 0, 0, yaw, f.ankle); }
    for (const k in this.hit) { this.hit[k].x = 0; this.hit[k].v = 0; this.hit[k].t = 0; }
    this.head.y.x = 0; this.head.p.x = 0;
  }
  /** set per-zombie style (from variant + rng) */
  setStyle(o) { Object.assign(this.idio, o); }
  // ---------------------------------------------------------------- helpers
  _fwd(yaw, out) { return out.set(-Math.sin(yaw), 0, -Math.cos(yaw)); }
  _right(yaw, out) { return out.set(Math.cos(yaw), 0, -Math.sin(yaw)); }
  /** neutral stance heel position for a foot at the current root pose */
  _standPos(f, out) {
    const s = this.scale, sx = f.s === 'L' ? -1 : 1; const hw = 0.5 * (this.gp.width ?? 0.16) * this.idio.widthMul;
    this._right(this.yaw, _v4); this._fwd(this.yaw, _fw);
    return out.copy(this.pos).addScaledVector(_v4, sx * hw * s).addScaledVector(_fw, -0.059 * s).setY(this.pos.y);
  }
  _ballOf(f, out) { axisAngle(_q2, 0, 1, 0, f.yaw); return out.copy(BALL_OFF[f.s]).multiplyScalar(this.scale).applyQuaternion(_q2).add(f.heel); }
  /** ankle world position for foot f given heel/ball pivot, yaw, pitch */
  _ankleFrom(f, pivot, pitch, yaw, out) {
    const s = this.scale; axisAngle(_q, 0, 1, 0, yaw); axisAngle(_q2, 1, 0, 0, pitch); _q.multiply(_q2);
    const a = pivot === 0 ? A_H : A_B[f.s]; out.copy(a).multiplyScalar(s).applyQuaternion(_q);
    if (pivot === 0) out.add(f.heel); else { this._ballOf(f, _v3); _v3.y += MTP_H * s; out.add(_v3); }
    return out;
  }

  // ---------------------------------------------------------------- main update (locomotion mode)
  update(dt, world, t) {
    this._lastDt = dt;
    if (this.scripted) { this.tAlive += dt; return this._scriptedPose(dt, world); }
    if (this.mode === 'crawl') { this.tAlive += dt; return this._crawl(dt, world); }
    this.tAlive += dt; const s = this.scale, P = this.pose; const W = this.want, id = this.idio;
    // ---- 1. root dynamics (acceleration + turn limits)
    const cls = this.speedClass; const aMax = (cls === 'sprint' ? 8.0 : cls === 'run' ? 5.0 : 2.4) * (this.stumble > 0 ? 0.3 : 1), dMax = aMax * 1.25;
    _v.set(W.vx, 0, W.vz); const dvx = _v.x - this.vel.x, dvz = _v.z - this.vel.z; const dl = Math.hypot(dvx, dvz);
    const speedNow = Math.hypot(this.vel.x, this.vel.z); const decel = (_v.x * this.vel.x + _v.z * this.vel.z) < speedNow * speedNow * 0.98;
    const lim = (decel ? dMax : aMax) * dt; const k = dl > lim ? lim / dl : 1;
    this._pv.copy(this.vel); this.vel.x += dvx * k; this.vel.z += dvz * k;
    // lateral acceleration limit (turning at speed): rotate the velocity toward the new direction at most a_lat/v per second
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.acc.set((this.vel.x - this._pv.x) / Math.max(dt, 1e-4), 0, (this.vel.z - this._pv.z) / Math.max(dt, 1e-4));
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    // facing: velocity direction when moving, else requested facing
    let wantYaw = this.yaw; if (this.strafe && W.faceYaw !== null) wantYaw = W.faceYaw; else if (spd > 0.25 && this.stumble <= 0) wantYaw = Math.atan2(-this.vel.x, -this.vel.z); else if (W.faceYaw !== null) wantYaw = W.faceYaw;
    const maxTurn = Math.min(cls === 'sprint' ? 3.4 : cls === 'run' ? 3.0 : 1.8, 6.0 / Math.max(spd, 0.6));
    const dy = angleDelta(this.yaw, wantYaw); const tr = clamp(dy * 6, -maxTurn, maxTurn); this.yawRate = damp(this.yawRate, tr, 10, dt); this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
    // ---- 2. gait params
    const gp = gaitParams(spd, this.gp); gp.cadence *= id.cadenceMul * (1 - id.limp * 0.12);
    const moving = spd > 0.12 || (!this.feet[0].stance && this.feet[0].corr < 0) || (!this.feet[1].stance && this.feet[1].corr < 0);
    // ---- 3. feet
    if (moving) {
      if (!this.moving) this._startGait();
      this.moving = true;
      let f0 = gp.cadence * 0.5;
      // cadence feedback: if a stance foot trails further behind the hip than planned (body accelerated / was pushed), step faster
      const vl = Math.max(spd, 0.2); let boost = 0;
      for (const f of this.feet) { if (!f.stance || f.rec >= 0) continue; const back = -((f.ankle.x - this.pos.x) * this.vel.x + (f.ankle.z - this.pos.z) * this.vel.z) / vl; const planned = spd * (gp.duty / f0) * 0.5 + 0.06 * s; if (back > planned) boost = Math.max(boost, (back - planned) / (LEGR[f.s].len * s)); }
      f0 *= 1 + Math.min(1.5, boost * 4);
      this.phase = (this.phase + f0 * dt) % 1;
      for (const f of this.feet) this._footGait(f, gp, dt, world, f0);
    } else {
      this.moving = false; this._idleFeet(dt, world);
    }
    // ---- 4. pelvis
    const dutyPh = this.phase; const L = this.feet[0], R = this.feet[1];
    const ground = this.pos.y;
    const stand = 0.925 * s * (1 - 0.018 - this.crouch - id.hunch * 0.04 - (this.speedClass === 'walk' ? 0.01 : 0.03));
    let bob = 0; if (this.moving) { const st = gp.duty > 0.5; bob = st ? -gp.bob * Math.cos(dutyPh * 4 * Math.PI) * 0.6 : gp.bob * Math.cos(dutyPh * 4 * Math.PI + Math.PI * 0.35); }
    let yDes = ground + stand + bob * s - (this.hit.buckleL.x + this.hit.buckleR.x) * 0.12 * s;
    // lateral sway toward the stance foot, forward offset from lean
    const swayK = this.moving ? gp.sway * id.sway : 0.012 * Math.sin(this.tAlive * 0.7 + this.breath);
    this.sway = damp(this.sway, (L.stance && !R.stance ? -1 : R.stance && !L.stance ? 1 : 0) * swayK * s, 6, dt);
    this._right(this.yaw, _v4); this._fwd(this.yaw, _fw);
    const accF = this.acc.x * _fw.x + this.acc.z * _fw.z, accL = this.acc.x * _v4.x + this.acc.z * _v4.z;
    const leanF = clamp(Math.atan2(accF, G) * 0.8 + gp.lean + id.lean * 0.3 + this.stumble * 0.2 + this.lunge * 0.22, -0.35, 0.7);
    const bank = clamp(Math.atan2(spd * this.yawRate, G) * 0.8 + Math.atan2(accL, G) * 0.4, -0.3, 0.3);
    const px = this.pos.x + _v4.x * this.sway, pz = this.pos.z + _v4.z * this.sway;
    // reach constraint for stance feet: hip must stay within 0.985 leg length of the ankle
    const pelvisRot = this.moving ? -gp.prot * Math.cos(dutyPh * 2 * Math.PI) : 0; // + = right hip forward (peaks at right heel strike)
    let yMax = 1e9;
    // exact hip joint offsets from the pelvis pivot under this frame's pelvis rotation
    expMap(_q3, -(0.06 + leanF * 0.35 + this.hit.pelvisX.x), pelvisRot, bank * 0.5 + this.hit.pelvisZ.x); axisAngle(_q4, 0, 1, 0, this.yaw); _q4.multiply(_q3);
    const pbR = RIG.bones[b.pelvis].pos; const pvx = px + 0, pvz = pz; // pelvis pivot xz ≈ root + sway (rest z offset rotated below)
    _v2.set(0, 0, pbR.z * s).applyQuaternion(_q.copy(this.pose.rootQ).setFromAxisAngle(UP, this.yaw));
    for (const f of this.feet) {
      if (!f.stance) continue;
      const lr = LEGR[f.s]; _v.copy(lr.hip).sub(pbR).multiplyScalar(s).applyQuaternion(_q4);
      const hx = pvx + _v2.x + _v.x, hz = pvz + _v2.z + _v.z; const d2 = (f.ankle.x - hx) ** 2 + (f.ankle.z - hz) ** 2; const Lmax = lr.len * s * 0.985 * this.pose.lenScale[BI['thigh.' + f.s]];
      // pelvisY here = hip-joint-level height; hip.y = pelvisY + 0.05 s + _v.y
      if (d2 < Lmax * Lmax) yMax = Math.min(yMax, f.ankle.y + Math.sqrt(Lmax * Lmax - d2) - (_v.y + 0.05 * s)); else yMax = Math.min(yMax, f.ankle.y + 0.02 * s);
    }
    if (yMax < yDes - 0.22 * s) { // would need a deep squat: release the worst stance foot (recovery step) instead
      let worst = null, wd = -1; for (const f of this.feet) { if (!f.stance || f.rec >= 0) continue; const d = Math.hypot(f.ankle.x - this.pos.x, f.ankle.z - this.pos.z); if (d > wd) { wd = d; worst = f; } }
      if (worst) { this._lift(worst); worst.rec = 0; worst.recFrom.copy(worst.ankle); worst.recPitch = worst.pitch; this.recoveries = (this.recoveries || 0) + 1; yMax = Math.max(yMax, yDes - 0.22 * s); }
    }
    let y = Math.min(yDes, yMax);
    this.pelvisY = damp(this.pelvisY, y, 22, dt); if (this.pelvisY > yMax) this.pelvisY = yMax;
    // ---- 5. set pose: root, pelvis, spine, arms, head
    P.rootPos.set(this.pos.x, ground, this.pos.z); axisAngle(P.rootQ, 0, 1, 0, this.yaw);
    for (let i = 0; i < NB; i++) P.q[i].identity();
    const hp = this.hit;
    // pelvis: translation in root frame (rest units), rotation: yaw with stride, list, tilt
    const pb = b.pelvis;
    P.t[pb].set(this.sway / s, (this.pelvisY + 0.05 * s - ground) / s - RIG.bones[pb].pos.y, 0);
    expMap(P.q[pb], -(0.06 + leanF * 0.35 + hp.pelvisX.step(dt)), pelvisRot, bank * 0.5 + hp.pelvisZ.step(dt) + (L.stance && !R.stance ? -0.06 : R.stance && !L.stance ? 0.06 : 0) * (this.moving ? 1 : 0) * (1 + this.idio.limp));
    // spine: counter-rotation, lean, hunch, breathing, stagger springs
    const hunch = id.hunch, br = Math.sin(this.tAlive * (this.moving ? 3.2 : 1.6) + this.breath);
    const cx = hp.chestX.step(dt), cy = hp.chestY.step(dt), cz = hp.chestZ.step(dt);
    expMap(P.q[b.spine1], -(leanF * 0.3 + hunch * 0.35 + cx * 0.3), -pelvisRot * 0.45 + cy * 0.3, -bank * 0.3 + cz * 0.3);
    expMap(P.q[b.spine2], -(leanF * 0.25 + hunch * 0.4 + cx * 0.35 + id.kypho * 0.13), -pelvisRot * 0.4 + cy * 0.35, cz * 0.35 + id.lean * 0.1);
    expMap(P.q[b.chest], -(leanF * 0.15 + hunch * 0.3 - br * 0.012 + cx * 0.35 + id.kypho * 0.16), -pelvisRot * 0.3 + cy * 0.35, cz * 0.3);
    // head / neck look-at with lag and limits (in chest space); tilt idiosyncrasy; stagger snap
    let hy = 0, hpch = 0.0;
    if (W.hasLook && this.lookW > 0) {
      _v.subVectors(W.look, this.pos); const ly = Math.atan2(-_v.x, -_v.z); hy = clamp(angleDelta(this.yaw + pelvisRot * 0.2, ly), -1.1, 1.1) * this.lookW;
      const hd = Math.hypot(_v.x, _v.z); hpch = clamp(Math.atan2(_v.y - (1.6 * s + (this.pelvisY - ground - 0.925 * s)), Math.max(hd, 0.3)), -0.6, 0.5) * this.lookW;
    }
    const lo = id.loll || 0; this.head.y.t = hy; this.head.p.t = hpch + (leanF * 0.6 + hunch * 0.9) + Math.sin(this.tAlive * 0.63 + this.breath * 1.3) * 0.13 * lo; this.head.r.t = id.tilt + Math.sin(this.tAlive * 0.9 + this.breath) * 0.24 * lo;
    if (id.twitch > 0) { this._twT -= dt; if (this._twT <= 0) { this._twT = 1.1 + this.rng() * 3.2; hp.headZ.v += (this.rng() - 0.5) * 10 * id.twitch; hp.headY.v += (this.rng() - 0.5) * 7 * id.twitch; hp.chestZ.v += (this.rng() - 0.5) * 2 * id.twitch; } }
    const HY = this.head.y.step(dt), HP = this.head.p.step(dt), HR = this.head.r.step(dt);
    const hx2 = hp.headX.step(dt), hy2 = hp.headY.step(dt), hz2 = hp.headZ.step(dt);
    // forward-head posture: neck flexes forward, head extends back so the gaze stays level (kyphosis adds to it)
    expMap(P.q[b.neck], -(-HP * 0.45) + hx2 * 0.4 - id.headFwd * 0.32, HY * 0.4 + hy2 * 0.4, HR * 0.4 + hz2 * 0.4);
    expMap(P.q[b.head], -(-HP * 0.55) + hx2 * 0.6 + id.headFwd * 0.3 + id.kypho * 0.18, HY * 0.6 + hy2 * 0.6, HR * 0.6 + hz2 * 0.6);
    // jaw
    this.jaw.t = clamp(this.jawOpen + this.voiceJaw + (this.attack ? this._attackJaw() : 0) + 0.02 * Math.sin(this.tAlive * 1.3 + this.breath), 0, 0.5);
    axisAngle(P.q[b.jaw], 1, 0, 0, -this.jaw.step(dt));
    // arms (reach poses compensate the torso pitch so the arms stay near horizontal in the world)
    this._torsoPitch = 0.06 + leanF * 1.05 + hunch * 1.05 + cx * 0.95;
    this._arms(dt, gp, spd, accF, accL);
    // ---- 6. FK + leg IK
    P.fk();
    this._legIK();
    if (this.handPlant) this._handIK();
    else if (this.clutch && !this.attack) this._clutchIK(dt);
    if (this.measure) this._measureSlip();
    // decay stumble
    if (this.stumble > 0) this.stumble = Math.max(0, this.stumble - dt);
  }

  _startGait() {
    // choose the foot that is further behind (relative to the velocity) to swing first
    const L = this.feet[0], R = this.feet[1]; const vx = this.vel.x, vz = this.vel.z;
    const dl = (L.heel.x - this.pos.x) * vx + (L.heel.z - this.pos.z) * vz, dr = (R.heel.x - this.pos.x) * vx + (R.heel.z - this.pos.z) * vz;
    const duty = this.gp.duty ?? 0.62;
    // left swings first ⇒ phase just after left lift-off (left stance = [0, duty))
    this.phase = dl < dr ? duty + 0.001 : (0.5 + duty + 0.001) % 1;
    for (const f of this.feet) { f.corr = -1; }
  }
  /** per-foot gait: stance lock + swing trajectory */
  _footGait(f, gp, dt, world, f0) {
    const s = this.scale, id = this.idio; const off = f.i === 0 ? 0 : 0.5; let ph = (this.phase - off + 1) % 1;
    // limp: shorten the stance of the bad leg
    let duty = gp.duty; if (id.limp > 0) duty *= (f.i === (id.limpSide > 0 ? 1 : 0) ? 1 - id.limp * 0.18 : 1 + id.limp * 0.06);
    duty = clamp(duty, 0.2, 0.8);
    // emergency recovery step: if the body was shoved beyond this planted foot's reach, step instead of dragging the foot
    if (f.rec >= 0) { this._recoverStep(f, gp, dt, world); return; }
    if (f.stance && this._outOfReach(f)) { this._lift(f); f.rec = 0; f.recFrom.copy(f.ankle); f.recPitch = f.pitch; this.recoveries = (this.recoveries || 0) + 1; this._recoverStep(f, gp, dt, world); return; }
    const inStance = ph < duty;
    if (inStance && !f.stance) this._plant(f, world);
    if (!inStance && f.stance) this._lift(f);
    if (inStance) {
      // stance: rockers pivoting on the locked contact
      const u = ph / duty; const sHeel = gp.strike > 0 ? 0.14 : 0, sToe = 0.58 - (1 - duty) * 0.2;
      if (gp.strike > 0 && u < sHeel) { f.pivot = 0; f.pitch = gp.strike * (1 - u / sHeel) * (1 - u / sHeel); }
      else if (u < sToe) { f.pivot = gp.strike > 0 ? 0 : 1; f.pitch = gp.strike > 0 ? 0 : Math.min(0, gp.strike) * (1 - u / sToe); }
      else { f.pivot = 1; const k = (u - sToe) / (1 - sToe); f.pitch = -gp.toeOff * Math.pow(k, 1.6); }
      this._ankleFrom(f, f.pivot, f.pitch, f.yaw, f.ankle);
    } else {
      // swing: from lift pose to predicted landing pose
      const w = (ph - duty) / (1 - duty); const Tsw = (1 - duty) / f0; const Ttd = (1 - w) * Tsw;
      // predicted root at touchdown + half stance ahead + lateral offset
      const Tst = duty / f0; const yawTd = this.yaw + clamp(this.yawRate * Ttd, -0.6, 0.6);
      this._right(yawTd, _v4); this._fwd(yawTd, _fw); const sx = f.s === 'L' ? -1 : 1; const hw = 0.5 * gp.width * id.widthMul * s;
      _tgt.set(this.pos.x + this.vel.x * (Ttd + Tst * 0.5) + _v4.x * sx * hw - _fw.x * 0.059 * s, f.groundY, this.pos.z + this.vel.z * (Ttd + Tst * 0.5) + _v4.z * sx * hw - _fw.z * 0.059 * s);
      this._clampReach(f, _tgt, this.pos.x + this.vel.x * Ttd, this.pos.z + this.vel.z * Ttd);
      if (w > 0.35 && !f._gq) { const g = world ? world.groundAt(_tgt.x, _tgt.z, this.pos.y + 0.5) : null; f.groundY = g ? g.y : this.pos.y; f._gq = true; }
      _tgt.y = f.groundY; f.tgtHeel.copy(_tgt); f.tgtYaw = yawTd + (f.s === 'L' ? 1 : -1) * this.idio.toeOut; // toe-out / toe-in
      // landing ankle (heel strike pose)
      const strike = gp.strike; _sv.copy(f.heel); f.heel.copy(_tgt); this._ankleFrom(f, strike > 0 ? 0 : 1, strike, yawTd, _v2); f.heel.copy(_sv);
      const m = mjerk(clamp((w - 0.04) / 0.9, 0, 1)); const kickW = gp.kick * Math.pow(Math.sin(Math.PI * Math.min(1, w * 1.25)), 2) * (1 - w);
      f.ankle.lerpVectors(f.liftAnkle, _v2, m);
      // heel kick for runners: ankle rises behind early in swing
      const lift = (gp.clear * Math.pow(Math.sin(Math.PI * w), 0.9) + kickW) * s * (f.i === (id.limpSide > 0 ? 1 : 0) ? 1 - id.limp * 0.5 : 1);
      f.ankle.y += lift;
      if (id.drag === f.i) { f.ankle.y = Math.min(f.ankle.y, _v2.y + 0.012 * s); }
      // pitch: toe-off → dorsiflex → strike
      f.pitch = lerp(f.liftPitch, strike, m) + 0.25 * Math.sin(Math.PI * w) * (id.drag === f.i ? -1.6 : 1);
      f.yaw = lerp(f.yaw, yawTd, clamp(m * 1.2, 0, 1)); f.pivot = -1;
      // keep heel position consistent for the next plant
      f.heel.copy(_tgt);
    }
  }
  /** planted foot too far from its hip (horizontal) → the leg cannot keep it planted */
  _outOfReach(f) {
    const s = this.scale; this._right(this.yaw, _v4); const sx = f.s === 'L' ? -1 : 1; const L = LEGR[f.s].len * s;
    const hx = this.pos.x + _v4.x * sx * 0.09 * s, hz = this.pos.z + _v4.z * sx * 0.09 * s; const dxz = Math.hypot(f.ankle.x - hx, f.ankle.z - hz);
    const hipY = Math.max(this.pelvisY, this.pos.y + 0.6 * s); const dy = hipY - f.ankle.y;
    return dxz > L * 0.8 || Math.hypot(dxz, dy) > L * 1.02 || dy < 0.25 * L;
  }
  /** clamp a heel target so the ankle stays inside the reachable disk of the hip at the given root position */
  _clampReach(f, heel, rx, rz) {
    const s = this.scale; this._right(this.yaw, _v4); const sx = f.s === 'L' ? -1 : 1; const R = LEGR[f.s].len * s * 0.62;
    const hx = rx + _v4.x * sx * 0.09 * s, hz = rz + _v4.z * sx * 0.09 * s; const dx = heel.x - hx, dz = heel.z - hz; const d = Math.hypot(dx, dz);
    if (d > R) { heel.x = hx + dx / d * R; heel.z = hz + dz / d * R; }
  }
  _recoverStep(f, gp, dt, world) {
    const s = this.scale; f.rec += dt / 0.24; const w = Math.min(1, f.rec); const m = mjerk(w);
    this._standPos(f, _tgt); _tgt.x += this.vel.x * 0.15; _tgt.z += this.vel.z * 0.15; _tgt.y = f.groundY; f.tgtHeel.copy(_tgt); f.tgtYaw = this.yaw + (f.s === 'L' ? 1 : -1) * this.idio.toeOut;
    _sv.copy(f.heel); f.heel.copy(_tgt); this._ankleFrom(f, 0, 0.1, this.yaw, _v2); f.heel.copy(_sv);
    f.ankle.lerpVectors(f.recFrom, _v2, m); f.ankle.y += Math.sin(Math.PI * w) * 0.07 * s; f.pitch = lerp(f.recPitch, 0.1, m); f.yaw = lerp(f.yaw, this.yaw, m); f.pivot = -1; f.stance = false;
    if (w >= 1) { f.rec = -1; this._plant(f, world); }
  }
  _plant(f, world) {
    f.stance = true; f._gq = false;
    // snap heel to ground at the planned target; recompute from current (landing) state
    f.heel.copy(f.tgtHeel); this._clampReach(f, f.heel, this.pos.x, this.pos.z); f.yaw = f.tgtYaw; const g = world ? world.groundAt(f.heel.x, f.heel.z, this.pos.y + 0.5) : null; f.groundY = g ? g.y : this.pos.y; f.heel.y = f.groundY;
    f.plantHeel.copy(f.heel); this._ballOf(f, f.plantBall); f.slip = 0;
    this.onStep?.(f, this);
  }
  _lift(f) {
    f.stance = false; f.liftAnkle.copy(f.ankle); f.liftPitch = f.pitch; f._gq = false;
    if (this.measure) { this.slip.sum += f.slip; this.slip.n++; this.slip.max = Math.max(this.slip.max, f.slip); this.slip.last = f.slip; if (f.slip > 0.006 && f.slip > (this.slipDiag?.slip || 0)) this.slipDiag = { slip: f.slip, foot: f.s, pos: this.pos.toArray().map((v) => +v.toFixed(2)), ankle: f.ankle.toArray().map((v) => +v.toFixed(2)), plant: f.plantHeel.toArray().map((v) => +v.toFixed(2)), pelvisY: +this.pelvisY.toFixed(2), rec: f.rec, moving: this.moving, speed: +Math.hypot(this.vel.x, this.vel.z).toFixed(2), cls: this.speedClass, crawl: this.mode, dt: +(this._lastDt || 0).toFixed(3), pivot: f.pivot }; }
  }
  /** idle: feet planted; correction steps when the stance drifts or the body turns */
  _idleFeet(dt, world) {
    const s = this.scale; let busy = false;
    for (const f of this.feet) if (f.corr >= 0) busy = true;
    for (const f of this.feet) {
      if (f.corr >= 0) {
        f.corrT += dt / 0.42; const w = Math.min(1, f.corrT); const m = mjerk(w);
        f.heel.lerpVectors(f.corrFrom, f.tgtHeel, m); f.heel.y = lerp(f.corrFrom.y, f.tgtHeel.y, m); f.yaw = f.corrYaw0 + angleDelta(f.corrYaw0, f.tgtYaw) * m;
        this._ankleFrom(f, 0, 0.12 * Math.sin(Math.PI * w), f.yaw, f.ankle); f.ankle.y += 0.05 * s * Math.sin(Math.PI * w); f.pitch = 0.12 * Math.sin(Math.PI * w);
        if (w >= 1) { f.corr = -1; f.stance = true; f.heel.copy(f.tgtHeel); f.plantHeel.copy(f.heel); this._ballOf(f, f.plantBall); f.slip = 0; f.pitch = 0; this.onStep?.(f, this); }
        continue;
      }
      if (f.rec >= 0) { this._recoverStep(f, this.gp, dt, world); continue; }
      f.stance = true; f.pivot = 0; f.pitch = damp(f.pitch, 0, 12, dt);
      this._ankleFrom(f, 0, f.pitch, f.yaw, f.ankle);
      if (this._outOfReach(f)) { this._lift(f); f.rec = 0; f.recFrom.copy(f.ankle); f.recPitch = f.pitch; this.recoveries = (this.recoveries || 0) + 1; continue; }
      if (!busy) {
        this._standPos(f, _v); const d = Math.hypot(_v.x - f.heel.x, _v.z - f.heel.z); const dyaw = Math.abs(angleDelta(f.yaw, this.yaw));
        if (d > 0.14 * s || dyaw > 0.6) { f.corr = 0; f.corrT = 0; f.corrFrom.copy(f.heel); f.corrYaw0 = f.yaw; f.tgtHeel.copy(_v); const g = world ? world.groundAt(_v.x, _v.z, this.pos.y + 0.5) : null; f.tgtHeel.y = g ? g.y : this.pos.y; f.groundY = f.tgtHeel.y; f.tgtYaw = this.yaw; f.stance = false; busy = true; if (this.measure) { this.slip.sum += f.slip; this.slip.n++; this.slip.max = Math.max(this.slip.max, f.slip); } }
      }
    }
  }
  _legIK() {
    const P = this.pose;
    for (const f of this.feet) {
      const s = f.s, th = BI['thigh.' + s], ca = BI['calf.' + s], fo = BI['foot.' + s], to = BI['toe.' + s];
      this._fwd(f.yaw, _pole); _pole.y = 0.05; this._right(f.yaw, _v4); _pole.addScaledVector(_v4, (s === 'L' ? -1 : 1) * (0.12 + this.idio.kneeSplay * 0.4)); // splayed knees
      solveTwoBone(P, th, ca, fo, f.ankle, _pole, X_NEG, X_NEG, 0.9995);
      // foot world orientation: yaw + pitch (toes flat on the ground during toe-off)
      axisAngle(_q, 0, 1, 0, f.yaw); axisAngle(_q2, 1, 0, 0, f.pitch); _q3.multiplyQuaternions(_q, _q2); P.setWorldQ(fo, _q3); P._fkOne(to);
      const toePitch = f.stance && f.pitch < 0 ? -f.pitch : (f.pivot < 0 ? -f.pitch * 0.3 : 0);
      axisAngle(_q4, 1, 0, 0, toePitch); P.q[to].copy(_q4); P._fkOne(to);
    }
  }
  /** measured slip: world position of the active contact point from the FINAL bone transforms vs where it was planted */
  _measureSlip() {
    const P = this.pose;
    for (const f of this.feet) {
      if (!f.stance || f.corr >= 0) continue;
      const fo = BI['foot.' + f.s], to = BI['toe.' + f.s];
      let dx = 0, dz = 0;
      if (f.pivot === 0) { P.pointOn(fo, LEGR[f.s].heel.x, 0.0, 0.083, _v); dx = _v.x - f.plantHeel.x; dz = _v.z - f.plantHeel.z; }
      else { P.pointOn(to, LEGR[f.s].ball.x, 0.0, LEGR[f.s].ball.z, _v); dx = _v.x - f.plantBall.x; dz = _v.z - f.plantBall.z; }
      const d = Math.hypot(dx, dz); if (d > f.slip) f.slip = d;
    }
  }

  // ---------------------------------------------------------------- arms
  _arms(dt, gp, spd, accF, accL) {
    const P = this.pose, id = this.idio; const ph = this.phase * Math.PI * 2;
    for (const side of ['L', 'R']) {
      const A = this.arm[side], R0 = ARMR[side], sx = R0.sx; const oppPh = side === 'L' ? ph : ph + Math.PI; // arm swings with the opposite leg
      let fT = 0.12, aT = 0.12, eT = 0.35, k = 40, c = 9, pron = 0.0, curl = 0.35;
      let mode = id.armHang === (side === 'L' ? 0 : 1) ? 'limp' : A.mode; if (mode === 'swing' && this.lunge > 0.55 && spd < 3) mode = 'reach';
      if (mode === 'reach') { fT = 1.42 - (this._torsoPitch || 0) * 0.9 + 0.08 * Math.sin(oppPh) + (this.speedClass === 'walk' ? 0 : 0.1) + this.lunge * 0.22; aT = 0.18; eT = 0.42 + 0.1 * Math.sin(oppPh + 1); k = 55; c = 10; pron = 0.9; curl = 0.75; }
      else if (mode === 'swing') { const amp = gp.armSw * (spd > 0.15 ? 1 : 0); fT = 0.16 - amp * Math.cos(oppPh) * (spd > 3.6 ? 2.2 : spd > 2 ? 1.6 : 1.15); aT = 0.14 + (spd > 3 ? 0.1 : 0); eT = 0.3 + (spd > 3.6 ? 1.2 + 0.35 * Math.sin(oppPh) : spd > 2 ? 0.8 + 0.25 * Math.sin(oppPh) : 0.15 * (1 + Math.sin(oppPh))); k = 45; }
      else if (mode === 'limp') { fT = 0.05; aT = 0.06; eT = 0.1; k = 8; c = 2.2; curl = 0.2; pron = 0.3; }
      else if (mode === 'script' && this.scripted && this.scripted.arm && this.scripted.arm[side]) { const o = this.scripted.arm[side]; fT = o.f; aT = o.a; eT = o.e; k = o.k ?? 120; c = o.c ?? 16; curl = o.curl ?? 0.6; pron = o.pron ?? 0.5; }
      // attack override
      if (this.attack) { const o = this._attackArm(side); if (o) { fT = o[0]; aT = o[1]; eT = o[2]; k = o[3]; c = o[4]; curl = o[5]; pron = o[6] ?? pron; } }
      A.f.k = k; A.f.c = c; A.a.k = k; A.a.c = c; A.e.k = k * 1.2; A.e.c = c * 1.1;
      A.f.t = fT; A.a.t = aT; A.e.t = eT;
      // inertial coupling: chest acceleration swings the arm opposite (pendulum), gravity restores through the spring
      A.f.v += accF * dt * 1.4; A.a.v += -accL * sx * dt * 0.9;
      const hk = this.hit['arm' + side]; const fl = A.f.step(dt) + hk.step(dt), ab = Math.max(-0.1, A.a.step(dt)), el = clamp(A.e.step(dt), 0.02, 2.3);
      // upper arm direction in chest frame: abduct (out) then flex (forward)
      _v.set(0, -1, 0); axisAngle(_q, 0, 0, sx, ab); _v.applyQuaternion(_q); axisAngle(_q, 1, 0, 0, fl); _v.applyQuaternion(_q);
      arcQuat(R0.u0, _v, _q2); // world-from-chest rotation for the upper arm (chest-relative)
      // clavicle shrug when the arm is raised
      const clv = BI['clavicle.' + side]; const shrug = clamp((fl - 1.0) * 0.18, 0, 0.22) + (this.attack ? 0.05 : 0) - ((id.shDrop > 0) === (side === 'R') ? Math.abs(id.shDrop) * 0.16 : 0); axisAngle(P.q[clv], 0, 0, sx, shrug); // dropped shoulder
      // q_upperarm = q_clav⁻¹ · arc
      _q3.copy(P.q[clv]).invert().multiply(_q2); P.q[BI['upperarm.' + side]].copy(_q3);
      // elbow flex about the rest hinge + pronation twist about the forearm axis
      axisAngle(_q, R0.elbowAxis.x, R0.elbowAxis.y, R0.elbowAxis.z, el - 0.349); axisAngle(_q4, R0.f0.x, R0.f0.y, R0.f0.z, pron * -sx); P.q[BI['forearm.' + side]].multiplyQuaternions(_q, _q4);
      // wrist + fingers
      axisAngle(P.q[BI['hand.' + side]], R0.wristAxis.x, R0.wristAxis.y, R0.wristAxis.z, curl * 0.25 - 0.1);
      if (this.detail !== false) this._fingers(side, curl); else this._fingersCheap(side, curl);
    }
  }
  /** far LODs: same curl on every finger bone via a cached quaternion (fingers are sub-pixel) */
  _fingersCheap(side, curl) { const P = this.pose, F = ARMR[side].fingers; for (const fn of FN5) { const fa = F[fn].flexAxis; axisAngle(_q, fa[0], fa[1], fa[2], curl * 0.7); P.q[BI[fn + '1.' + side]].copy(_q); P.q[BI[fn + '2.' + side]].copy(_q); P.q[BI[fn + '3.' + side]].copy(_q); } }
  _fingers(side, curl) {
    const P = this.pose, F = ARMR[side].fingers; const t = this.tAlive;
    for (const fn of FN5) {
      const fa = F[fn].flexAxis; const var_ = fn === 'index' ? -0.1 : fn === 'pinky' ? 0.15 : 0; const tw = 0.05 * Math.sin(t * 3 + fn.length);
      const c1 = fn === 'thumb' ? curl * 0.3 : (curl * 0.35 + var_) - 0.1, c2 = fn === 'thumb' ? curl * 0.5 : curl * 0.9 + var_ + tw, c3 = fn === 'thumb' ? curl * 0.4 : curl * 0.6 + var_;
      axisAngle(P.q[BI[fn + '1.' + side]], fa[0], fa[1], fa[2], c1); axisAngle(P.q[BI[fn + '2.' + side]], fa[0], fa[1], fa[2], c2); axisAngle(P.q[BI[fn + '3.' + side]], fa[0], fa[1], fa[2], c3);
    }
  }
  _handIK() {
    const P = this.pose;
    for (const side of ['L', 'R']) {
      const tgt = this.handPlant[side]; if (!tgt) continue; const R0 = ARMR[side];
      _pole.set(R0.sx * 0.6, -0.4, 0.5).applyQuaternion(P.Q[BI.chest]);
      solveTwoBone(P, BI['upperarm.' + side], BI['forearm.' + side], BI['hand.' + side], tgt, _pole, R0.elbowAxis, R0.elbowAxis, 0.999);
      // children of the forearm (hand, fingers) follow
      P.fkSubtree(BI['hand.' + side]);
    }
  }

  // ---------------------------------------------------------------- scripted poses (spawn animations)
  /**
   * this.scripted = { x, y, z, yaw, hipY, pitch (pelvis fwd tilt), roll, spine (fwd flex total), twist, headP (+ up), headY, jaw,
   *   arm: {L:{f,a,e,curl,pron}|null, R:…}, hand: {L:V3|null, R:V3|null}, foot: {L:{ankle:V3, yaw, pitch}|null, R:…} }
   * Missing entries fall back to neutral. Everything stays skinned through the same FK/IK path as locomotion.
   */
  _scriptedPose(dt, world) {
    const S = this.scripted, P = this.pose, s = this.scale; const b = BI;
    this.pos.set(S.x, S.y, S.z); this.yaw = S.yaw; this.vel.set(S.vx || 0, 0, S.vz || 0);
    P.rootPos.copy(this.pos); axisAngle(P.rootQ, 0, 1, 0, this.yaw);
    for (let i = 0; i < NB; i++) P.q[i].identity();
    const pb = b.pelvis; P.t[pb].set(S.px || 0, (S.hipY + 0.05 * s - S.y) / s - RIG.bones[pb].pos.y, S.pz || 0);
    const hp = this.hit;
    expMap(P.q[pb], -(S.pitch || 0) - hp.pelvisX.step(dt), S.pyaw || 0, (S.roll || 0) + hp.pelvisZ.step(dt));
    const sp = S.spine || 0, tw = S.twist || 0, cx = hp.chestX.step(dt), cy = hp.chestY.step(dt), cz = hp.chestZ.step(dt);
    expMap(P.q[b.spine1], -(sp * 0.3 + cx * 0.3), tw * 0.3 + cy * 0.3, (S.side || 0) * 0.3 + cz * 0.3); expMap(P.q[b.spine2], -(sp * 0.38 + cx * 0.35), tw * 0.35 + cy * 0.35, (S.side || 0) * 0.35 + cz * 0.35); expMap(P.q[b.chest], -(sp * 0.32 + cx * 0.35), tw * 0.35 + cy * 0.35, (S.side || 0) * 0.35 + cz * 0.3);
    this.head.y.t = S.headY || 0; this.head.p.t = S.headP || 0; this.head.r.t = this.idio.tilt;
    const HY = this.head.y.step(dt), HP = this.head.p.step(dt), HR = this.head.r.step(dt), hx2 = hp.headX.step(dt), hy2 = hp.headY.step(dt), hz2 = hp.headZ.step(dt);
    expMap(P.q[b.neck], HP * 0.45 + hx2 * 0.4, HY * 0.4 + hy2 * 0.4, HR * 0.4 + hz2 * 0.4); expMap(P.q[b.head], HP * 0.55 + hx2 * 0.6, HY * 0.6 + hy2 * 0.6, HR * 0.6 + hz2 * 0.6);
    this.jaw.t = clamp((S.jaw ?? this.jawOpen) + this.voiceJaw, 0, 0.55); axisAngle(P.q[b.jaw], 1, 0, 0, -this.jaw.step(dt));
    const saveL = this.arm.L.mode, saveR = this.arm.R.mode; if (S.arm?.L) this.arm.L.mode = 'script'; if (S.arm?.R) this.arm.R.mode = 'script';
    this._arms(dt, this.gp.cadence ? this.gp : gaitParams(0, this.gp), 0, 0, 0); this.arm.L.mode = saveL; this.arm.R.mode = saveR;
    P.fk();
    for (const f of this.feet) { const o = S.foot && S.foot[f.s]; if (!o) { f.ankle.copy(P.P[BI['foot.' + f.s]]); continue; } f.ankle.copy(o.ankle); f.yaw = o.yaw ?? this.yaw; f.pitch = o.pitch || 0; f.stance = !!o.stance; f.pivot = o.stance ? 0 : -1; if (o.stance) { f.heel.copy(o.ankle); } }
    if (S.foot) this._legIK();
    if (S.hand && (S.hand.L || S.hand.R)) { this.handPlant = S.hand; this._handIK(); this.handPlant = null; }
  }

  // ---------------------------------------------------------------- crawler locomotion (legs lost / broken)
  _crawl(dt, world) {
    const s = this.scale, P = this.pose, W = this.want; const b = BI;
    // root dynamics (slow)
    const aMax = 1.2 * dt; const dvx = W.vx - this.vel.x, dvz = W.vz - this.vel.z; const dl = Math.hypot(dvx, dvz); const k = dl > aMax ? aMax / dl : 1; this.vel.x += dvx * k; this.vel.z += dvz * k;
    const spd = Math.hypot(this.vel.x, this.vel.z); this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    let wantYaw = spd > 0.08 ? Math.atan2(-this.vel.x, -this.vel.z) : (W.faceYaw ?? this.yaw); const dyaw = angleDelta(this.yaw, wantYaw); this.yaw = wrapAngle(this.yaw + clamp(dyaw * 3, -1.2, 1.2) * dt);
    const cyc = 0.55 + spd * 0.8; this.phase = (this.phase + cyc * dt) % 1; const ph = this.phase * Math.PI * 2;
    const g = this.pos.y; this._fwd(this.yaw, _fw); this._right(this.yaw, _v4);
    // body: pelvis on the ground, chest propped on the arms, heaving with each pull
    const heave = Math.sin(ph * 2) * 0.015 * s;
    P.rootPos.set(this.pos.x, g, this.pos.z); axisAngle(P.rootQ, 0, 1, 0, this.yaw);
    for (let i = 0; i < NB; i++) P.q[i].identity();
    const pb = b.pelvis; P.t[pb].set(Math.sin(ph) * 0.02, 0.2 - RIG.bones[pb].pos.y + heave / s, 0.05);
    expMap(P.q[pb], -1.32, Math.sin(ph) * 0.12, Math.sin(ph) * 0.08);
    const cx = this.hit.chestX.step(dt), cy = this.hit.chestY.step(dt);
    expMap(P.q[b.spine1], 0.18 - cx * 0.3, -Math.sin(ph) * 0.1 + cy * 0.3, 0); expMap(P.q[b.spine2], 0.2 - cx * 0.3, -Math.sin(ph) * 0.08, 0); expMap(P.q[b.chest], 0.15 - cx * 0.3, 0, 0);
    // head looks forward/up at the target
    let hy = 0; if (W.hasLook) { _v.subVectors(W.look, this.pos); hy = clamp(angleDelta(this.yaw, Math.atan2(-_v.x, -_v.z)), -0.9, 0.9); }
    this.head.y.t = hy; this.head.p.t = 0.75; const HY = this.head.y.step(dt), HP = this.head.p.step(dt);
    expMap(P.q[b.neck], HP * 0.5 + this.hit.headX.step(dt), HY * 0.4, 0); expMap(P.q[b.head], HP * 0.5, HY * 0.6, 0);
    this.jaw.t = 0.12 + this.voiceJaw + 0.08 * Math.max(0, Math.sin(ph * 2)); axisAngle(P.q[b.jaw], 1, 0, 0, -this.jaw.step(dt));
    // arms: flexed forward, hands planted by IK
    for (const side of ['L', 'R']) { const A = this.arm[side]; A.mode = 'script'; }
    const S0 = this.scripted; this.scripted = { arm: { L: { f: 1.6, a: 0.35, e: 0.6, curl: 0.95, pron: 1.0 }, R: { f: 1.6, a: 0.35, e: 0.6, curl: 0.95, pron: 1.0 } } };
    this._arms(dt, this.gp.cadence ? this.gp : gaitParams(0, this.gp), 0, 0, 0); this.scripted = S0;
    // legs drag: slight bend, toes down
    for (const side of ['L', 'R']) { const th = b['thigh.' + side], ca = b['calf.' + side], fo = b['foot.' + side]; expMap(P.q[th], 0.1 + Math.sin(ph + (side === 'L' ? 0 : Math.PI)) * 0.12, 0, (side === 'L' ? -1 : 1) * 0.12); axisAngle(P.q[ca], 1, 0, 0, -(0.25 + 0.2 * Math.max(0, Math.sin(ph + (side === 'L' ? 0 : Math.PI))))); axisAngle(P.q[fo], 1, 0, 0, -0.9); }
    P.fk();
    // hands: stance on the ground (locked), swing forward in an arc
    const hp = this.handPlant || (this.handPlant = { L: null, R: null });
    const hs = this._hs || (this._hs = { L: { st: true, p: new V3(), from: new V3(), t: 1 }, R: { st: true, p: new V3(), from: new V3(), t: 1 } });
    for (const side of ['L', 'R']) {
      const H = hs[side]; const off = side === 'L' ? 0 : 0.5; const u = (this.phase + off) % 1; const stance = u < 0.55;
      const sh = P.P[b['upperarm.' + side]]; const sx = side === 'L' ? -1 : 1;
      _tgt.set(sh.x + _fw.x * 0.28 * s + _v4.x * sx * 0.1 * s + this.vel.x * 0.5, g + 0.03 * s, sh.z + _fw.z * 0.28 * s + _v4.z * sx * 0.1 * s + this.vel.z * 0.5);
      if (stance && !H.st) { H.st = true; H.p.copy(_tgt); const ev = this._handEv || (this._handEv = { s: 'L', hand: true, heel: null }); ev.s = side; ev.heel = H.p; this.onStep?.(ev, this); }
      if (!stance && H.st) { H.st = false; H.from.copy(H.p); }
      if (!H.st) { const w = (u - 0.55) / 0.45; const m = mjerk(w); H.p.lerpVectors(H.from, _tgt, m); H.p.y += Math.sin(Math.PI * w) * 0.12 * s; }
      if (H.st && H.p.distanceTo(sh) > 0.62 * s) H.p.lerp(_tgt, 0.2); // out of reach → drag
      const hv = this._hpVec || (this._hpVec = { L: new V3(), R: new V3() }); hv[side].copy(H.p); hp[side] = (this.lost && this.lost['arm' + side]) ? null : hv[side];
    }
    this._handIK(); this.handPlant = hp;
  }

  // ---------------------------------------------------------------- attack layer
  /** start an attack: type 0 = overhead double claw, 1 = one-arm swipe (side), 2 = tool swing (right arm, two-handed) */
  startAttack(type, side = 'R', dur = 1.05) { if (this.attack) return false; this.attack = { type, side, t: 0, dur, hitDone: false }; return true; }
  _attackPhase() { const a = this.attack; return a.t / a.dur; }
  _attackJaw() { const u = this._attackPhase(); return this.attack && this.attack.type === 3 ? (u > 0.25 && u < 0.5 ? 0.5 : u < 0.62 ? 0.02 : 0.2) : u > 0.3 && u < 0.6 ? 0.35 : 0.12; } // bite: gape, then snap shut
  _attackArm(side) {
    const a = this.attack; const u = a.t / a.dur;
    // key poses: [flex, abd, elbow, k, c, curl, pron]
    const wind = smoothstep(0.0, 0.34, u), strike = smoothstep(0.36, 0.5, u), rec = smoothstep(0.62, 1.0, u);
    if (a.type === 0) { // overhead claw with both arms
      const f = lerp(lerp(1.2, 2.55, wind), 0.75, strike); const e = lerp(lerp(0.5, 1.4, wind), 0.35, strike);
      return [lerp(f, 0.6, rec), 0.28, lerp(e, 0.4, rec), 160, 18, 0.95, 0.6];
    }
    if (a.type === 1) { // single-arm swipe; other arm reaches
      if (side !== a.side) return [1.1, 0.2, 0.5, 60, 10, 0.7, 0.9];
      const f = lerp(lerp(1.1, 1.6, wind), 1.1, strike); const ab = lerp(lerp(0.2, 1.15, wind), -0.25, strike); const e = lerp(lerp(0.5, 1.1, wind), 0.25, strike);
      return [lerp(f, 0.8, rec), lerp(ab, 0.2, rec), lerp(e, 0.4, rec), 180, 16, 0.95, 0.8];
    }
    if (a.type === 3) { // two-hand grab: both arms reach wide, then clamp together at shoulder height while the head lunges to bite
      const f = lerp(lerp(1.2, 1.55, wind), 1.35, strike); const ab = lerp(lerp(0.25, 0.75, wind), 0.05, strike); const e = lerp(lerp(0.4, 0.25, wind), 0.75, strike);
      return [lerp(f, 0.9, rec), lerp(ab, 0.2, rec), lerp(e, 0.4, rec), 150, 15, lerp(0.4, 1.05, strike), 0.9];
    }
    // tool: two-handed overhead swing (pickaxe)
    const f = lerp(lerp(0.9, 2.7, wind), 0.55, strike); const e = lerp(lerp(0.9, 1.5, wind), 0.25, strike);
    return [lerp(f, 0.7, rec), side === 'R' ? 0.1 : 0.25, lerp(e, 0.9, rec), 200, 20, 1.2, 0.2];
  }
  /** advance attack timer; returns true exactly once at the damage frame */
  tickAttack(dt) {
    const a = this.attack; if (!a) return false; a.t += dt; const u = a.t / a.dur;
    // torso participates: windup leans back/twists, strike flexes forward
    const tw = a.type === 1 ? (a.side === 'R' ? 1 : -1) : 0; const wind = smoothstep(0, 0.34, u), strike = smoothstep(0.36, 0.5, u), rec = smoothstep(0.62, 1, u);
    const lunge = a.type === 3 ? 1.6 : 1; this.hit.chestX.t = (-0.25 * wind + 0.55 * strike * lunge) * (1 - rec); this.hit.chestY.t = (0.5 * wind - 0.8 * strike) * tw * (1 - rec); this.hit.headX.t = (a.type === 3 ? -0.25 : 0.25) * strike * (1 - rec);
    if (a.type === 3 && strike > 0.2 && rec < 0.5) { this.vel.x += -Math.sin(this.yaw) * dt * 3; this.vel.z += -Math.cos(this.yaw) * dt * 3; } // lurch forward into the bite
    let fire = false; if (!a.hitDone && u >= 0.46) { a.hitDone = true; fire = true; }
    if (u >= 1) { this.attack = null; this.hit.chestX.t = 0; this.hit.chestY.t = 0; this.hit.headX.t = 0; }
    return fire;
  }

  // ---------------------------------------------------------------- hit reactions (additive springs at the hit location)
  /**
   * Apply a hit. bone: bone index hit, point (world), dir (unit, bullet direction), impulse magnitude (kg·m/s-ish game units).
   * Torque = r × J around the relevant pivot → angular kicks to that region; linear part → root stumble.
   */
  applyHit(bone, point, dir, J, rest = null) {
    J = Math.max(J, 2.4); // every hit reads at gameplay distance, even from a pistol
    const P = this.pose; const name = RIG.bones[bone].name; const inv = _q.copy(P.rootQ).invert();
    _v.copy(dir).multiplyScalar(J); // impulse vector (world)
    const kick = (pivotBone, sx, sy, sz, springs, gain) => {
      _v2.subVectors(point, P.P[pivotBone]); _v3.crossVectors(_v2, _v).applyQuaternion(inv); // torque in root frame
      springs[0].v += _v3.x * gain * sx; springs[1].v += _v3.y * gain * sy; springs[2].v += _v3.z * gain * sz;
    };
    const h = this.hit; let clutch = null;
    if (name === 'head' || name === 'neck' || name === 'jaw') { kick(BI.neck, 1, 1, 1, [h.headX, h.headY, h.headZ], 90); kick(BI.spine1, 1, 1, 1, [h.chestX, h.chestY, h.chestZ], 8); }
    else if (/^(pelvis|spine1)/.test(name)) { kick(BI.pelvis, 1, 1, 1, [h.pelvisX, h.chestY, h.pelvisZ], 26); h.buckleL.v += 1.2; h.buckleR.v += 1.2; clutch = 'same'; }
    else if (/^(spine2|chest|clavicle)/.test(name)) { kick(BI.spine1, 1, 1, 1, [h.chestX, h.chestY, h.chestZ], 38); clutch = 'same'; }
    else if (/arm|hand|index|middle|ring|pinky|thumb/.test(name)) { const side = name.endsWith('.L') ? 'L' : 'R'; _v2.copy(_v).applyQuaternion(inv); h['arm' + side].v += -_v2.z * 3.4 + 1.2; kick(BI.spine2, 1, 1, 1, [h.chestX, h.chestY, h.chestZ], 12); clutch = side === 'L' ? 'R' : 'L'; }
    else if (/thigh|calf|foot|toe/.test(name)) { const side = name.endsWith('.L') ? 'L' : 'R'; h['buckle' + side].v += 2.6 + J * 0.45; kick(BI.pelvis, 1, 1, 1, [h.pelvisX, h.chestY, h.pelvisZ], 16); h.chestX.v += 2.5; }
    // linear stagger: push the root and suppress self-propulsion for a moment (the gait takes recovery steps)
    const push = Math.min(3.0, 0.6 + J * 0.12); this.vel.x += dir.x * push; this.vel.z += dir.z * push; this.stumble = Math.max(this.stumble, Math.min(0.8, 0.2 + J * 0.035));
    // hand to the wound (torso / arm hits): IK the free hand onto the hit point for ~1 s
    if (clutch && rest && !this.attack && (!this.lost || !this.lost['arm' + (clutch === 'same' ? (rest.x >= 0 ? 'R' : 'L') : clutch)])) {
      const side = clutch === 'same' ? (rest.x >= 0 ? 'R' : 'L') : clutch; this.clutch = { bone, rx: rest.x, ry: rest.y, rz: rest.z, side, t: 0 };
    }
  }
  _clutchIK(dt) {
    const c = this.clutch, P = this.pose; c.t += dt; const w = c.t < 0.16 ? c.t / 0.16 : c.t < 0.85 ? 1 : 1 - (c.t - 0.85) / 0.35; if (w <= 0) { this.clutch = null; return; }
    const hb = BI['hand.' + c.side]; P.pointOn(c.bone, c.rx, c.ry, c.rz, _cl); _cl2.subVectors(_cl, P.P[BI.spine2]); _cl2.y = 0; const l = _cl2.length() || 1;
    _cl.addScaledVector(_cl2, 0.06 / l); _cl.lerpVectors(P.P[hb], _cl, w * w * (3 - 2 * w));
    const cp = this._clutchPlant; cp.L = c.side === 'L' ? _cl : null; cp.R = c.side === 'R' ? _cl : null; this.handPlant = cp; this._handIK(); this.handPlant = null;
  }
}
