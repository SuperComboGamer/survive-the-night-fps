// Verlet ragdoll: 20 mass particles at the joints, rigid distance constraints (bones + torso/pelvis bracing), inequality
// constraints (fold limits), hinge limits for knees/elbows, ground + wall collisions with Coulomb-ish friction, sleep.
// The bullet / blast impulse is applied at the actual hit point (distributed to the hit bone's end particles by lever arm).
// Bone rotations are rebuilt every frame from particle frames (primary axis + bend-plane secondary) → skin matrices.
// Also drives gibs (severed limbs) using a subset of particles.
import * as THREE from 'three';
import { RIG, BI, NB, basisQuat, HEAD_CENTER, PARENT } from './rig.js';

const V3 = THREE.Vector3;
// particle definition: [name, bone whose pivot (or tail) it sits on, 'pos'|'tail'|point, mass, radius]
const PDEF = [
  ['pelvis', 'pelvis', 'pos', 12, 0.12], ['spine', 'spine2', 'pos', 10, 0.12], ['neck', 'neck', 'pos', 7, 0.08], ['head', null, HEAD_CENTER, 5, 0.11],
  ['shL', 'upperarm.L', 'pos', 3, 0.06], ['elL', 'forearm.L', 'pos', 2, 0.05], ['wrL', 'hand.L', 'pos', 1, 0.04], ['hdL', 'hand.L', 'tail', 0.5, 0.035],
  ['shR', 'upperarm.R', 'pos', 3, 0.06], ['elR', 'forearm.R', 'pos', 2, 0.05], ['wrR', 'hand.R', 'pos', 1, 0.04], ['hdR', 'hand.R', 'tail', 0.5, 0.035],
  ['hipL', 'thigh.L', 'pos', 6, 0.09], ['knL', 'calf.L', 'pos', 4, 0.06], ['anL', 'foot.L', 'pos', 2, 0.05], ['toL', 'toe.L', 'tail', 0.8, 0.035],
  ['hipR', 'thigh.R', 'pos', 6, 0.09], ['knR', 'calf.R', 'pos', 4, 0.06], ['anR', 'foot.R', 'pos', 2, 0.05], ['toR', 'toe.R', 'tail', 0.8, 0.035],
];
export const PI_ = Object.fromEntries(PDEF.map((d, i) => [d[0], i]));
const NP = PDEF.length;
const REST = PDEF.map(([, bone, where]) => (where === 'pos' ? RIG.bones[BI[bone]].pos.clone() : where === 'tail' ? RIG.bones[BI[bone]].tail.clone() : where.clone()));
// constraints: [a, b, kind] kind 0 = rigid, 1 = min only (fold limit, fraction of rest), 2 = max only
const C = [];
const rig = (a, b, k = 1) => C.push([PI_[a], PI_[b], 0, k]); const minD = (a, b, f) => C.push([PI_[a], PI_[b], 1, f]);
rig('pelvis', 'spine'); rig('spine', 'neck'); rig('neck', 'head'); rig('neck', 'shL'); rig('neck', 'shR'); rig('shL', 'shR'); rig('spine', 'shL'); rig('spine', 'shR');
rig('pelvis', 'hipL'); rig('pelvis', 'hipR'); rig('hipL', 'hipR'); rig('spine', 'hipL'); rig('spine', 'hipR');
for (const s of ['L', 'R']) { rig('sh' + s, 'el' + s); rig('el' + s, 'wr' + s); rig('wr' + s, 'hd' + s); rig('hip' + s, 'kn' + s); rig('kn' + s, 'an' + s); rig('an' + s, 'to' + s); rig('kn' + s, 'to' + s, 0.6); }
minD('pelvis', 'neck', 0.82); minD('pelvis', 'head', 0.7); minD('spine', 'head', 0.8); minD('shL', 'wrL', 0.28); minD('shR', 'wrR', 0.28); minD('hipL', 'anL', 0.3); minD('hipR', 'anR', 0.3);
minD('hipL', 'shL', 0.75); minD('hipR', 'shR', 0.75); minD('head', 'shL', 0.72); minD('head', 'shR', 0.72); minD('knL', 'knR', 0.35); minD('anL', 'anR', 0.2);
const CN = C.length;
// joint friction (passive tissue resistance): limb particle velocity is pulled toward its parent's, so limbs follow the trunk
// instead of whipping (no legs flying over the head, no flailing forearms); [child, parent]
const JF = []; for (const s of ['L', 'R']) JF.push([PI_['el' + s], PI_['sh' + s]], [PI_['wr' + s], PI_['el' + s]], [PI_['hd' + s], PI_['wr' + s]], [PI_['kn' + s], PI_['hip' + s]], [PI_['an' + s], PI_['kn' + s]], [PI_['to' + s], PI_['an' + s]]);
JF.push([PI_.head, PI_.neck]);
// limbs balanced straight up once the body is down topple over (unstable equilibrium): [particle, base]
const TOP = []; for (const s of ['L', 'R']) TOP.push([PI_['wr' + s], PI_['sh' + s]], [PI_['hd' + s], PI_['sh' + s]], [PI_['kn' + s], PI_['hip' + s]], [PI_['an' + s], PI_['hip' + s]]);
const ELB = { L: new V3(...RIG.arm.L.elbowAxis), R: new V3(...RIG.arm.R.elbowAxis) }, KNEE_AX = new V3(-1, 0, 0);

const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _s = new V3(), _u = new V3(), _t2 = new V3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const L_ = { A: new V3(), B: new V3(), C: new V3(), d1: new V3(), d2: new V3(), n: new V3(), r0: new V3(), r1: new V3(), q0: new THREE.Quaternion(), q1: new THREE.Quaternion(), sec0: new V3(), sec: new V3() };
const H = 1 / 120; // fixed Verlet substep
const g = { y: 0, surface: 'concrete' };

export class Ragdoll {
  constructor() {
    this.x = new Float32Array(NP * 3); this.px = new Float32Array(NP * 3); this.m = new Float32Array(NP); this.im = new Float32Array(NP); this.r = new Float32Array(NP);
    this.len = new Float32Array(CN); this.active = new Uint8Array(NP).fill(1); this.cActive = new Uint8Array(CN).fill(1); this.ground = new Float32Array(NP); this.gAge = 0;
    this.asleep = false; this.quiet = 0; this.t = 0; this.scale = 1; this.headRel = new THREE.Quaternion(); this.fingerQ = null; this.sink = 0;
    for (let i = 0; i < NP; i++) { this.m[i] = PDEF[i][3]; this.im[i] = 1 / this.m[i]; this.r[i] = PDEF[i][4]; }
    this.prevN = { L: new V3(-1, 0, 0), R: new V3(-1, 0, 0), aL: new V3(), aR: new V3() };
  }
  /** initialise from a posed skeleton; vel = world velocity of the body (m/s); mask: optional Set of particle names to keep */
  fromPose(pose, vel, dt = 1 / 60, keep = null) {
    const s = pose.scale; this.scale = s; this.asleep = false; this.quiet = 0; this.t = 0; this.sink = 0; this.gAge = 0; this.collapse = 0;
    for (let i = 0; i < NP; i++) {
      const [, bone, where] = PDEF[i]; let p;
      if (where === 'pos') p = _a.copy(pose.P[BI[bone]]); else if (where === 'tail') p = pose.tail(BI[bone], _a); else p = pose.pointOn(BI.head, where.x, where.y, where.z, _a);
      this.x[i * 3] = p.x; this.x[i * 3 + 1] = p.y; this.x[i * 3 + 2] = p.z;
      this.px[i * 3] = p.x - vel.x * H; this.px[i * 3 + 1] = p.y - vel.y * H; this.px[i * 3 + 2] = p.z - vel.z * H;
      this.active[i] = keep ? (keep.has(PDEF[i][0]) ? 1 : 0) : 1;
    }
    for (let k = 0; k < CN; k++) { const [a, b, kind, f] = C[k]; this.len[k] = REST[a].distanceTo(REST[b]) * s * (kind === 1 ? f : 1); this.cActive[k] = this.active[a] && this.active[b] ? 1 : 0; this.stiff = f; }
    // head orientation relative to the neck frame at death (kept, then relaxes)
    this.headRel.copy(pose.Q[BI.neck]).invert().multiply(pose.Q[BI.head]);
    // remember local finger curls
    if (!this.fingerQ) this.fingerQ = Array.from({ length: NB }, () => new THREE.Quaternion());
    for (let i = 0; i < NB; i++) this.fingerQ[i].copy(pose.q[i]);
    for (let i = 0; i < NP; i++) this.ground[i] = -1e9;
    return this;
  }
  /** add an impulse (world vector, kg·m/s) at world point p; distributes to nearest particles by inverse distance */
  impulse(p, J, spread = 0.35) {
    let wsum = 0; const w = this._w || (this._w = new Float32Array(NP));
    for (let i = 0; i < NP; i++) { if (!this.active[i]) { w[i] = 0; continue; } const dx = this.x[i * 3] - p.x, dy = this.x[i * 3 + 1] - p.y, dz = this.x[i * 3 + 2] - p.z; const d = Math.sqrt(dx * dx + dy * dy + dz * dz); w[i] = Math.max(0, 1 - d / spread) ** 2; wsum += w[i]; }
    if (wsum < 1e-6) return;
    for (let i = 0; i < NP; i++) { if (!w[i]) continue; const k = (w[i] / wsum) * this.im[i] * H; // Δx_prev so that Δv = J·w/m
      this.px[i * 3] -= J.x * k; this.px[i * 3 + 1] -= J.y * k; this.px[i * 3 + 2] -= J.z * k; }
    this.asleep = false; this.quiet = 0;
  }
  /** radial blast: centre, strength (m/s at the centre), radius */
  blast(c, v0, radius) {
    for (let i = 0; i < NP; i++) {
      // radial push (velocity v0 at the centre, linear falloff) with a moderate upward component: bodies are thrown 1-3 m
      if (!this.active[i]) continue; const dx = this.x[i * 3] - c.x, dy = this.x[i * 3 + 1] - c.y, dz = this.x[i * 3 + 2] - c.z; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3; const k = v0 * Math.max(0, 1 - d / radius) * (0.85 + Math.random() * 0.3) * H;
      const ux = dx / d, uy = dy / d + 0.45, uz = dz / d, ul = Math.hypot(ux, uy, uz); this.px[i * 3] -= ux / ul * k; this.px[i * 3 + 1] -= uy / ul * k; this.px[i * 3 + 2] -= uz / ul * k;
    }
    this.asleep = false; this.quiet = 0;
  }
  step(dt, world) {
    if (this.asleep) return; this.t += dt;
    const n = Math.max(1, Math.min(6, Math.round(dt / H))), h = H; const gy = -9.81 * h * h; const damp = Math.pow(this.t < 1.2 ? 0.989 : 0.975, 60 * h); // more damping once down: settles, no jitter
    const X = this.x, PX = this.px;
    // ground heights (cached, refreshed every 3 frames)
    if (world && (this.gAge++ % 3 === 0)) for (let i = 0; i < NP; i++) { if (!this.active[i]) continue; const r = world.groundAt(X[i * 3], X[i * 3 + 2], X[i * 3 + 1] + 0.3, g, 0.6); this.ground[i] = r.y; }
    let maxV = 0;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < NP; i++) {
        if (!this.active[i]) continue; const o = i * 3;
        const vx = (X[o] - PX[o]) * damp, vy = (X[o + 1] - PX[o + 1]) * damp, vz = (X[o + 2] - PX[o + 2]) * damp;
        PX[o] = X[o]; PX[o + 1] = X[o + 1]; PX[o + 2] = X[o + 2]; X[o] += vx; X[o + 1] += vy + gy; X[o + 2] += vz;
      }
      // knee collapse for the first moments of a shot death: the knee particles are pulled down/forward so the legs fold under the body
      if (this.collapse > 0) { this.collapse -= h; for (const k of [PI_.knL, PI_.knR]) if (this.active[k]) { X[k * 3 + 1] -= 0.0009; } }
      this._friction(this.t < 0.2 ? 0.015 : 0.03);
      if (this.t > 0.5) this._topple();
      for (let it = 0; it < 4; it++) { this._constraints(); this._hinges(); this._collide(world, it === 3 && s === n - 1); }
    }
    for (let i = 0; i < NP; i++) { if (!this.active[i]) continue; const o = i * 3; const v = Math.hypot(X[o] - PX[o], X[o + 1] - PX[o + 1], X[o + 2] - PX[o + 2]) / h; if (v > maxV) maxV = v; }
    if (maxV < 0.06 && this.t > 0.6) { this.quiet += dt; if (this.quiet > 0.6) this.asleep = true; } else this.quiet = 0;
  }
  _friction(k) {
    const X = this.x, PX = this.px, A = this.active;
    for (let j = 0; j < JF.length; j++) {
      const c = JF[j][0], p = JF[j][1]; if (!A[c] || !A[p]) continue; const oc = c * 3, op = p * 3;
      for (let e = 0; e < 3; e++) { const rel = (X[oc + e] - PX[oc + e]) - (X[op + e] - PX[op + e]); PX[oc + e] += rel * k; }
    }
  }
  _topple() {
    const X = this.x, A = this.active, s = this.scale;
    for (let j = 0; j < TOP.length; j++) {
      const i = TOP[j][0], b = TOP[j][1]; if (!A[i] || !A[b]) continue; const oi = i * 3, ob = b * 3; if (X[oi + 1] - X[ob + 1] < 0.3 * s) continue;
      let dx = X[oi] - X[ob], dz = X[oi + 2] - X[ob + 2]; const l = Math.hypot(dx, dz); if (l < 1e-4) { dx = 1; dz = 0.3; } else { dx /= l; dz /= l; }
      X[oi] += dx * 0.00025; X[oi + 2] += dz * 0.00025;
    }
  }
  _constraints() {
    const X = this.x, im = this.im;
    for (let k = 0; k < CN; k++) {
      if (!this.cActive[k]) continue; const c = C[k], a = c[0] * 3, b = c[1] * 3, L = this.len[k];
      const dx = X[b] - X[a], dy = X[b + 1] - X[a + 1], dz = X[b + 2] - X[a + 2]; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9;
      if (c[2] === 1 && d >= L) continue; if (c[2] === 2 && d <= L) continue;
      const wa = im[c[0]], wb = im[c[1]], diff = (d - L) / (d * (wa + wb)) * (c[2] === 0 ? c[3] : 0.8);
      X[a] += dx * diff * wa; X[a + 1] += dy * diff * wa; X[a + 2] += dz * diff * wa; X[b] -= dx * diff * wb; X[b + 1] -= dy * diff * wb; X[b + 2] -= dz * diff * wb;
    }
  }
  /** knees bend forward only, elbows bend toward the front of the upper arm */
  _hinges() {
    const X = this.x; const P = (i, v) => v.set(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]);
    // pelvis frame
    P(PI_.hipR, _a).sub(P(PI_.hipL, _b)); P(PI_.spine, _c).sub(P(PI_.pelvis, _d)); const fwd = _s.crossVectors(_a, _c).normalize(); // right × up = backward? (x × y = z → +Z = back) → negate
    fwd.negate(); _u.copy(_c).normalize();
    for (const sd of ['L', 'R']) {
      const hi = PI_['hip' + sd], kn = PI_['kn' + sd], an = PI_['an' + sd]; if (!this.active[kn] || !this.active[an] || !this.active[hi]) continue;
      P(hi, _a); P(an, _b); P(kn, _c); _d.addVectors(_a, _b).multiplyScalar(0.5); const off = _c.sub(_d); const f = off.dot(fwd);
      if (f < 0.01 * this.scale) { const k = (0.01 * this.scale - f) * 0.5; X[kn * 3] += fwd.x * k; X[kn * 3 + 1] += fwd.y * k; X[kn * 3 + 2] += fwd.z * k; X[an * 3] -= fwd.x * k * 0.3; X[an * 3 + 2] -= fwd.z * k * 0.3; }
      // hip limits in the pelvis frame: flexion <= ~120 deg (thigh never above the belly), extension <= ~25 deg behind the trunk line
      P(kn, _t2).sub(P(hi, _a)); const tl = _t2.length() + 1e-9, tu = _t2.dot(_u) / tl, tf = _t2.dot(fwd) / tl;
      if (tu > 0.5) { const k = (tu - 0.5) * tl * 0.5; X[kn * 3] -= _u.x * k; X[kn * 3 + 1] -= _u.y * k; X[kn * 3 + 2] -= _u.z * k; }
      if (tf < -0.42) { const k = (-0.42 - tf) * tl * 0.5; X[kn * 3] += fwd.x * k; X[kn * 3 + 1] += fwd.y * k; X[kn * 3 + 2] += fwd.z * k; }
    }
  }
  _collide(world, walls) {
    const X = this.x, PX = this.px;
    for (let i = 0; i < NP; i++) {
      if (!this.active[i]) continue; const o = i * 3; const gy = this.ground[i] + this.r[i] * this.scale * 0.8 - this.sink;
      if (X[o + 1] < gy) { X[o + 1] = gy; // friction: kill most tangential motion on contact
        const fr = 0.55; PX[o] = X[o] - (X[o] - PX[o]) * fr; PX[o + 2] = X[o + 2] - (X[o + 2] - PX[o + 2]) * fr; if (PX[o + 1] < X[o + 1]) PX[o + 1] = X[o + 1] + (PX[o + 1] - X[o + 1]) * -0.1; }
      if (walls && world && (i === 0 || i === 1 || i === 2 || i === 3 || i === 5 || i === 9 || i === 13 || i === 17)) { _a.set(X[o], X[o + 1], X[o + 2]); if (world.push(_a, this.r[i] * this.scale, X[o + 1] - 0.05, 0.1, 0.0)) { X[o] = _a.x; X[o + 2] = _a.z; } }
    }
  }
  /** write bone world rotations/positions into pose from particle frames */
  toPose(pose) {
    const X = this.x, s = this.scale; const P = (i, v) => v.set(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]);
    const R = (i) => REST[i];
    const setB = (bone, pos, qw) => { const bi = BI[bone]; pose.P[bi].copy(pos); pose.Q[bi].copy(qw); };
    const tmp = this._t || (this._t = { d: new V3(), sd: new V3(), d0: new V3(), s0: new V3(), p: new V3(), q: new THREE.Quaternion(), qp: new THREE.Quaternion(), qc: new THREE.Quaternion() });
    const { d, sd, d0, s0, p, q } = tmp;
    // pelvis / spine / chest
    const act = this.active;
    if (act[PI_.pelvis]) {
      d0.subVectors(R(PI_.spine), R(PI_.pelvis)); s0.subVectors(R(PI_.hipR), R(PI_.hipL)); d.subVectors(P(PI_.spine, _a), P(PI_.pelvis, _b)); sd.subVectors(P(PI_.hipR, _c), P(PI_.hipL, _d));
      basisQuat(d0, s0, d, sd, tmp.qp); pose.rootQ.copy(tmp.qp); P(PI_.pelvis, p); setB('pelvis', p, tmp.qp);
      d0.subVectors(R(PI_.neck), R(PI_.spine)); s0.subVectors(R(PI_.shR), R(PI_.shL)); d.subVectors(P(PI_.neck, _a), P(PI_.spine, _b)); sd.subVectors(P(PI_.shR, _c), P(PI_.shL, _d));
      basisQuat(d0, s0, d, sd, tmp.qc);
      _q.copy(tmp.qp).slerp(tmp.qc, 0.5); pose.Q[BI.spine1].copy(_q); pose.Q[BI.spine2].copy(tmp.qc); pose.Q[BI.chest].copy(tmp.qc);
      // positions of spine bones: along the pelvis→spine→neck particles
      P(PI_.pelvis, _a); P(PI_.spine, _b); pose.P[BI.spine1].lerpVectors(_a, _b, 0.45); pose.P[BI.spine2].copy(_b);
      P(PI_.neck, _c); pose.P[BI.chest].lerpVectors(_b, _c, 0.38); pose.P[BI.neck].copy(_c);
      // neck/head: primary neck→head
      d0.subVectors(R(PI_.head), R(PI_.neck)); s0.set(1, 0, 0); d.subVectors(P(PI_.head, _a), P(PI_.neck, _b)); sd.set(1, 0, 0).applyQuaternion(tmp.qc);
      basisQuat(d0, s0, d, sd, q); pose.Q[BI.neck].copy(q); _q2.copy(q).multiply(this.headRel); this.headRel.slerp(_q.identity(), 0.01);
      pose.Q[BI.head].copy(_q2); pose.P[BI.head].copy(pose.P[BI.neck]).add(_a.subVectors(RIG.bones[BI.head].pos, RIG.bones[BI.neck].pos).multiplyScalar(s).applyQuaternion(q));
      pose.Q[BI.jaw].copy(_q2).multiply(_q.set(-0.15, 0, 0, 1).normalize()); pose.P[BI.jaw].copy(pose.P[BI.head]).add(_a.subVectors(RIG.bones[BI.jaw].pos, RIG.bones[BI.head].pos).multiplyScalar(s).applyQuaternion(_q2));
      for (const sx of ['L', 'R']) { const cl = BI['clavicle.' + sx]; d0.subVectors(R(PI_['sh' + sx]), RIG.bones[cl].pos); d.subVectors(P(PI_['sh' + sx], _a), pose.P[BI.neck]); s0.set(0, 1, 0); sd.set(0, 1, 0).applyQuaternion(tmp.qc); basisQuat(d0, s0, d, sd, q); pose.Q[cl].copy(q); pose.P[cl].copy(pose.P[BI.neck]).add(_b.subVectors(RIG.bones[cl].pos, RIG.bones[BI.neck].pos).multiplyScalar(s).applyQuaternion(tmp.qc)); }
    }
    // limbs
    for (const sx of ['L', 'R']) {
      this._limb(pose, 'upperarm.' + sx, 'forearm.' + sx, PI_['sh' + sx], PI_['el' + sx], PI_['wr' + sx], ELB[sx], sx, 'a');
      this._end(pose, 'hand.' + sx, PI_['wr' + sx], PI_['hd' + sx], 'forearm.' + sx);
      this._limb(pose, 'thigh.' + sx, 'calf.' + sx, PI_['hip' + sx], PI_['kn' + sx], PI_['an' + sx], KNEE_AX, sx, 'l');
      this._end(pose, 'foot.' + sx, PI_['an' + sx], PI_['to' + sx], 'calf.' + sx);
      pose.Q[BI['toe.' + sx]].copy(pose.Q[BI['foot.' + sx]]); pose.tail(BI['foot.' + sx], pose.P[BI['toe.' + sx]]);
    }
    // fingers: keep local curls from death, recompute world from the hand
    for (let i = 0; i < NB; i++) { const n = RIG.bones[i].name; if (!/^(index|middle|ring|pinky|thumb)/.test(n)) continue; const pr = PARENT[i]; pose.Q[i].copy(pose.Q[pr]).multiply(this.fingerQ[i]); _a.subVectors(RIG.bones[i].pos, RIG.bones[pr].pos).multiplyScalar(s).applyQuaternion(pose.Q[pr]); pose.P[i].copy(pose.P[pr]).add(_a); }
    // gib (severed limb, pelvis particle off): every bone outside the kept chain moves rigidly with the chain's root bone, so
    // vertices near the cut that are partly weighted to the parent (pelvis / clavicle / thigh) travel with the limb
    if (!act[PI_.pelvis]) {
      let root = -1;
      for (const sx of ['L', 'R']) { if (act[PI_['sh' + sx]]) root = BI['upperarm.' + sx]; else if (act[PI_['el' + sx]]) root = BI['forearm.' + sx]; else if (act[PI_['hip' + sx]]) root = BI['thigh.' + sx]; else if (act[PI_['kn' + sx]]) root = BI['calf.' + sx]; if (root >= 0) break; }
      if (root >= 0) for (let i = 0; i < NB; i++) { let j = i; while (j >= 0 && j !== root) j = PARENT[j]; if (j === root) continue; pose.Q[i].copy(pose.Q[root]); _a.subVectors(RIG.bones[i].pos, RIG.bones[root].pos).multiplyScalar(s).applyQuaternion(pose.Q[root]); pose.P[i].copy(pose.P[root]).add(_a); }
    }
    // root position = pelvis projected (mesh origin)
    pose.rootPos.copy(pose.P[BI.pelvis]);
  }
  _limb(pose, b0, b1, i0, i1, i2, axis, sx, kind) {
    if (!this.active[i0] && !this.active[i1]) return; const X = this.x; const P = (i, v) => v.set(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]);
    const A = P(i0, L_.A), Bp = P(i1, L_.B), Cp = P(i2, L_.C);
    const d1 = L_.d1.subVectors(Bp, A), d2 = L_.d2.subVectors(Cp, Bp); const n = L_.n.crossVectors(d1, d2); const key = kind + sx;
    const prev = this.prevN[key] || (this.prevN[key] = axis.clone());
    if (n.lengthSq() < 1e-6 * this.scale) n.copy(prev); else { n.normalize(); prev.copy(n); }
    const r0 = L_.r0.subVectors(RIG.bones[BI[b1]].pos, RIG.bones[BI[b0]].pos), r1 = L_.r1.subVectors(RIG.bones[BI[b1]].tail, RIG.bones[BI[b1]].pos);
    basisQuat(r0, axis, d1, n, L_.q0); basisQuat(r1, axis, d2, n, L_.q1);
    pose.Q[BI[b0]].copy(L_.q0); pose.P[BI[b0]].copy(A); pose.Q[BI[b1]].copy(L_.q1); pose.P[BI[b1]].copy(Bp);
  }
  _end(pose, bone, i0, i1, parent) {
    const X = this.x; const A = L_.A.set(X[i0 * 3], X[i0 * 3 + 1], X[i0 * 3 + 2]), Bp = L_.B.set(X[i1 * 3], X[i1 * 3 + 1], X[i1 * 3 + 2]);
    const bi = BI[bone]; const r0 = L_.r0.subVectors(RIG.bones[bi].tail, RIG.bones[bi].pos); const d = L_.d1.subVectors(Bp, A);
    const sec0 = L_.sec0.set(1, 0, 0), sec = L_.sec.set(1, 0, 0).applyQuaternion(pose.Q[BI[parent]]); basisQuat(r0, sec0, d, sec, L_.q0);
    pose.Q[bi].copy(L_.q0); pose.P[bi].copy(A);
  }
  /** random per-particle velocity kick (m/s) so nothing balances in an unstable equilibrium */
  jitter(v = 0.5) { for (let i = 0; i < NP; i++) { if (!this.active[i]) continue; this.px[i * 3] -= (Math.random() - 0.5) * v * H; this.px[i * 3 + 2] -= (Math.random() - 0.5) * v * H; } }
  /** recompute which constraints are active after particles were disabled */
  refreshMask() { for (let k = 0; k < CN; k++) { const [a, b] = C[k]; this.cActive[k] = this.active[a] && this.active[b] ? 1 : 0; } }
  firstActive(out) { for (let i = 0; i < NP; i++) if (this.active[i]) return out.set(this.x[i * 3], this.x[i * 3 + 1], this.x[i * 3 + 2]); return out; }
  /** pelvis particle position (for the mesh origin / hit tests) */
  centre(out) { return out.set(this.x[0], this.x[1], this.x[2]); }
}
export { NP, PDEF };
