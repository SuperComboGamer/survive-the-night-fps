// Zombie rig: canonical 54-bone humanoid skeleton (model space, 1.75 m, faces −Z, +X = character's right, +Y up),
// per-zombie Pose (local rotations → world FK), two-bone IK, skin-matrix output for world-space skinning, hit capsules.
// All rest orientations are IDENTITY (bone frames are aligned with the model axes) — rotations are always expressed as
// "rotate the rest geometry", which keeps authoring (outfits, IK, ragdoll) simple: a point p bound to bone i at rest moves to
// P_i + s·R(Q_i)·S_i·(p − rest_i).
import * as THREE from 'three';

export const REST_HEIGHT = 1.75;
const V3 = THREE.Vector3;

// ------------------------------------------------------------------ small math helpers (allocation free)
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _va = new V3(), _vb = new V3(), _vc = new V3(), _vd = new V3(), _m3 = new THREE.Matrix3();
/** quaternion rotating unit vector a onto unit vector b (shortest arc) */
export function arcQuat(a, b, out) {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  if (d < -0.999999) { // opposite: any orthogonal axis
    let ax = 0, ay = -a.z, az = a.y; if (ay * ay + az * az < 1e-8) { ax = a.z; ay = 0; az = -a.x; }
    const l = Math.hypot(ax, ay, az); return out.set(ax / l, ay / l, az / l, 0);
  }
  const cx = a.y * b.z - a.z * b.y, cy = a.z * b.x - a.x * b.z, cz = a.x * b.y - a.y * b.x;
  out.set(cx, cy, cz, 1 + d); return out.normalize();
}
/** world rotation mapping the rest basis (d0 primary, s0 secondary) onto (d, s) — both pairs need not be orthogonal */
export function basisQuat(d0, s0, d, s, out) {
  // orthonormal frames: y = primary, x = secondary ⟂ y, z = x × y.  R = R1 · R0ᵀ (maps rest frame onto current frame)
  let l = Math.hypot(d0.x, d0.y, d0.z); const y0x = d0.x / l, y0y = d0.y / l, y0z = d0.z / l;
  let k = s0.x * y0x + s0.y * y0y + s0.z * y0z; let x0x = s0.x - y0x * k, x0y = s0.y - y0y * k, x0z = s0.z - y0z * k; l = Math.hypot(x0x, x0y, x0z) || 1; x0x /= l; x0y /= l; x0z /= l;
  const z0x = x0y * y0z - x0z * y0y, z0y = x0z * y0x - x0x * y0z, z0z = x0x * y0y - x0y * y0x;
  l = Math.hypot(d.x, d.y, d.z); const y1x = d.x / l, y1y = d.y / l, y1z = d.z / l;
  k = s.x * y1x + s.y * y1y + s.z * y1z; let x1x = s.x - y1x * k, x1y = s.y - y1y * k, x1z = s.z - y1z * k; l = Math.hypot(x1x, x1y, x1z);
  if (l < 1e-6) { // secondary parallel to primary: carry the rest secondary across with the shortest arc
    arcQuat(_va.set(y0x, y0y, y0z), _vb.set(y1x, y1y, y1z), _qb); _vc.set(x0x, x0y, x0z).applyQuaternion(_qb); x1x = _vc.x; x1y = _vc.y; x1z = _vc.z; l = 1;
  }
  x1x /= l; x1y /= l; x1z /= l;
  const z1x = x1y * y1z - x1z * y1y, z1y = x1z * y1x - x1x * y1z, z1z = x1x * y1y - x1y * y1x;
  const e = _m3.elements; // column-major: e[c*3 + r] = R_rc = x1_r x0_c + y1_r y0_c + z1_r z0_c
  e[0] = x1x * x0x + y1x * y0x + z1x * z0x; e[3] = x1x * x0y + y1x * y0y + z1x * z0y; e[6] = x1x * x0z + y1x * y0z + z1x * z0z;
  e[1] = x1y * x0x + y1y * y0x + z1y * z0x; e[4] = x1y * x0y + y1y * y0y + z1y * z0y; e[7] = x1y * x0z + y1y * y0z + z1y * z0z;
  e[2] = x1z * x0x + y1z * y0x + z1z * z0x; e[5] = x1z * x0y + y1z * y0y + z1z * z0y; e[8] = x1z * x0z + y1z * y0z + z1z * z0z;
  return quatFromMat3(e, out);
}
export function quatFromMat3(te, out) { // te column-major 3x3
  const m11 = te[0], m12 = te[3], m13 = te[6], m21 = te[1], m22 = te[4], m23 = te[7], m31 = te[2], m32 = te[5], m33 = te[8], tr = m11 + m22 + m33;
  let s;
  if (tr > 0) { s = 0.5 / Math.sqrt(tr + 1.0); out.w = 0.25 / s; out.x = (m32 - m23) * s; out.y = (m13 - m31) * s; out.z = (m21 - m12) * s; }
  else if (m11 > m22 && m11 > m33) { s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33); out.w = (m32 - m23) / s; out.x = 0.25 * s; out.y = (m12 + m21) / s; out.z = (m13 + m31) / s; }
  else if (m22 > m33) { s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33); out.w = (m13 - m31) / s; out.x = (m12 + m21) / s; out.y = 0.25 * s; out.z = (m23 + m32) / s; }
  else { s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22); out.w = (m21 - m12) / s; out.x = (m13 + m31) / s; out.y = (m23 + m32) / s; out.z = 0.25 * s; }
  return out.normalize();
}
export function axisAngle(out, ax, ay, az, ang) { const h = ang * 0.5, s = Math.sin(h); return out.set(ax * s, ay * s, az * s, Math.cos(h)); }
/** multiply out = out · axisAngle(axis, ang) (local post-rotation) */
export function postRot(q, ax, ay, az, ang) { if (ang === 0) return q; axisAngle(_qa, ax, ay, az, ang); return q.multiply(_qa); }
export function preRot(q, ax, ay, az, ang) { if (ang === 0) return q; axisAngle(_qa, ax, ay, az, ang); return q.premultiply(_qa); }
/** rotation vector (axis * angle) → quaternion */
export function expMap(out, x, y, z) { const a = Math.hypot(x, y, z); if (a < 1e-9) return out.set(x * 0.5, y * 0.5, z * 0.5, 1).normalize(); const s = Math.sin(a * 0.5) / a; return out.set(x * s, y * s, z * s, Math.cos(a * 0.5)); }

// ------------------------------------------------------------------ canonical rest skeleton
// Proportions follow Drillis & Contini segment ratios for H = 1.75 m (hip 0.53H, knee 0.285H, shoulder 0.818H, upper arm 0.186H,
// forearm 0.146H, hand 0.108H, thigh/shank 0.245H, foot 0.152H).
const B = []; // {name, parent, pos:V3, tail:V3, r (capsule radius), part, limb, axis:{...}}
const add = (name, parent, pos, tail, r = 0, part = null, limb = null) => { const b = { name, parent: parent === null ? -1 : B.findIndex((x) => x.name === parent), pos: new V3(...pos), tail: new V3(...tail), r, part, limb, index: B.length }; B.push(b); return b; };
const vadd = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rotAbout = (v, k, ang) => { const c = Math.cos(ang), s = Math.sin(ang), d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2]; const x = cross(k, v); return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)]; };

// core
add('root', null, [0, 0, 0], [0, 0.97, 0]);
add('pelvis', 'root', [0, 0.975, 0.012], [0, 1.06, 0.03], 0.15, 'torso');
add('spine1', 'pelvis', [0, 1.06, 0.03], [0, 1.17, 0.036], 0.14, 'torso');
add('spine2', 'spine1', [0, 1.17, 0.036], [0, 1.29, 0.032], 0.145, 'torso');
add('chest', 'spine2', [0, 1.29, 0.032], [0, 1.485, 0.034], 0.155, 'torso');
add('neck', 'chest', [0, 1.485, 0.034], [0, 1.598, 0.018], 0.058, 'head', 'head');
add('head', 'neck', [0, 1.598, 0.018], [0, 1.75, 0.0], 0.098, 'head', 'head');
add('jaw', 'head', [0, 1.618, -0.004], [0, 1.528, -0.074], 0.045, 'head', 'head');
export const HEAD_CENTER = new V3(0, 1.662, 0.004); // cranium centre (used by the head generator + shader landmarks)

// arms (A-pose: 42° abduction, 8° forward flexion, 20° elbow flexion, relaxed half-curled hand)
const ARM = {};
for (const [side, sx] of [['L', -1], ['R', 1]]) {
  const sh = [sx * 0.178, 1.405, 0.014];
  let u = [0, -1, 0]; u = rotAbout(u, [0, 0, sx], 42 * Math.PI / 180); u = rotAbout(u, [1, 0, 0], 8 * Math.PI / 180); u = norm(u);
  const el = vadd(sh, u, 0.326);
  const elbowAxis = norm(cross(u, [0, 0, -1])); // flexion moves the forearm forward
  const f = norm(rotAbout(u, elbowAxis, 20 * Math.PI / 180));
  const wr = vadd(el, f, 0.255);
  // hand frame: h along hand, p palm normal, t thumb side
  let p0 = rotAbout([-sx, 0, 0], [0, 0, sx], 42 * Math.PI / 180); p0 = rotAbout(p0, [1, 0, 0], 8 * Math.PI / 180);
  const h = norm(rotAbout(f, elbowAxis, 6 * Math.PI / 180)); // slight wrist flexion
  let p = [p0[0], p0[1], p0[2]]; const dp = p[0] * h[0] + p[1] * h[1] + p[2] * h[2]; p = norm([p[0] - h[0] * dp, p[1] - h[1] * dp, p[2] - h[2] * dp]);
  const t = norm(cross(h, p).map((v) => v * sx));
  const at = (a, b, c) => [wr[0] + h[0] * a + p[0] * b + t[0] * c, wr[1] + h[1] * a + p[1] * b + t[1] * c, wr[2] + h[2] * a + p[2] * b + t[2] * c];
  ARM[side] = { sx, sh, el, wr, u, f, h, p, t, elbowAxis, at, fingers: {} };
  const clav = [sx * 0.024, 1.432, -0.034];
  add('clavicle.' + side, 'chest', clav, sh, 0.05, 'torso');
  add('upperarm.' + side, 'clavicle.' + side, sh, el, 0.052, 'arm', 'arm' + side);
  add('forearm.' + side, 'upperarm.' + side, el, wr, 0.042, 'arm', 'arm' + side);
  const knuckle = at(0.092, 0.004, 0.0);
  add('hand.' + side, 'forearm.' + side, wr, knuckle, 0.042, 'arm', 'arm' + side);
  // fingers: MCP position (a along hand, c toward thumb), segment lengths, base radius, splay (rad toward thumb), rest curl (MCP, PIP, DIP)
  const FING = [
    ['index', 0.089, 0.027, [0.041, 0.024, 0.019], 0.0098, 0.07, [0.20, 0.30, 0.20]],
    ['middle', 0.093, 0.008, [0.045, 0.028, 0.021], 0.0102, 0.0, [0.24, 0.36, 0.24]],
    ['ring', 0.089, -0.011, [0.042, 0.026, 0.020], 0.0095, -0.06, [0.30, 0.42, 0.26]],
    ['pinky', 0.080, -0.028, [0.033, 0.019, 0.017], 0.0084, -0.15, [0.38, 0.48, 0.30]],
  ];
  for (const [fn, a, c, len, rad, splay, curl] of FING) {
    const base = at(a, 0.004, c);
    // splay rotates the finger within the palm plane toward the thumb side (index) or away (ring, pinky)
    const d = norm([h[0] * Math.cos(splay) + t[0] * Math.sin(splay), h[1] * Math.cos(splay) + t[1] * Math.sin(splay), h[2] * Math.cos(splay) + t[2] * Math.sin(splay)]);
    const flexAxis = norm(cross(d, p)); // rotating about this moves the finger toward the palm side
    const pts = [base]; let dir = d;
    for (let k = 0; k < 3; k++) { dir = norm(rotAbout(dir, flexAxis, curl[k])); pts.push(vadd(pts[k], dir, len[k])); }
    ARM[side].fingers[fn] = { pts, flexAxis, rad, len };
    add(fn + '1.' + side, 'hand.' + side, pts[0], pts[1], rad, 'arm', 'arm' + side);
    add(fn + '2.' + side, fn + '1.' + side, pts[1], pts[2], rad * 0.9, 'arm', 'arm' + side);
    add(fn + '3.' + side, fn + '2.' + side, pts[2], pts[3], rad * 0.8, 'arm', 'arm' + side);
  }
  { // thumb: CMC near the wrist on the thumb/palm side; opposes toward the palm
    const cmc = at(0.022, 0.012, 0.022);
    let d = norm([h[0] * 0.62 + t[0] * 0.66 + p[0] * 0.42, h[1] * 0.62 + t[1] * 0.66 + p[1] * 0.42, h[2] * 0.62 + t[2] * 0.66 + p[2] * 0.42]);
    const flexAxis = norm(cross(d, p).map((v, i) => v * 0.55 + (cross(h, p))[i] * 0.45));
    const len = [0.045, 0.032, 0.027], rad = 0.0125; const pts = [cmc]; let dir = d; const curl = [0.0, 0.25, 0.3];
    for (let k = 0; k < 3; k++) { dir = norm(rotAbout(dir, flexAxis, curl[k])); pts.push(vadd(pts[k], dir, len[k])); }
    ARM[side].fingers.thumb = { pts, flexAxis, rad, len };
    add('thumb1.' + side, 'hand.' + side, pts[0], pts[1], rad, 'arm', 'arm' + side);
    add('thumb2.' + side, 'thumb1.' + side, pts[1], pts[2], rad * 0.85, 'arm', 'arm' + side);
    add('thumb3.' + side, 'thumb2.' + side, pts[2], pts[3], rad * 0.78, 'arm', 'arm' + side);
  }
}
// legs
const LEG = {};
for (const [side, sx] of [['L', -1], ['R', 1]]) {
  const hip = [sx * 0.09, 0.925, -0.004], knee = [sx * 0.097, 0.5, -0.012], ankle = [sx * 0.101, 0.077, 0.024], ball = [sx * 0.108, 0.024, -0.118], toe = [sx * 0.11, 0.018, -0.19];
  LEG[side] = { sx, hip, knee, ankle, ball, toe, heel: [sx * 0.1, 0.0, 0.085] };
  add('thigh.' + side, 'pelvis', hip, knee, 0.075, 'leg', 'leg' + side);
  add('calf.' + side, 'thigh.' + side, knee, ankle, 0.055, 'leg', 'leg' + side);
  add('foot.' + side, 'calf.' + side, ankle, ball, 0.045, 'leg', 'leg' + side);
  add('toe.' + side, 'foot.' + side, ball, toe, 0.035, 'leg', 'leg' + side);
}

export const BONES = B.map((b) => b.name);
export const NB = B.length;
export const BI = Object.fromEntries(B.map((b, i) => [b.name, i])); // name → index
export const RIG = { bones: B, arm: ARM, leg: LEG, headCenter: HEAD_CENTER };
export const PARENT = Int16Array.from(B.map((b) => b.parent));
/** rest position of bone i as a new Vector3 (build-time helper) */
export const restPos = (name) => B[typeof name === 'number' ? name : BI[name]].pos.clone();
export const restTail = (name) => B[typeof name === 'number' ? name : BI[name]].tail.clone();
/** point at fraction t along bone (rest) */
export const restAt = (name, t) => { const b = B[typeof name === 'number' ? name : BI[name]]; return b.pos.clone().lerp(b.tail, t); };

// hit parts (for raycast); bones without capsules (root, jaw) are skipped. The limb decides dismemberment.
export const HIT_BONES = B.filter((b) => b.r > 0 && !/^(index|middle|ring|pinky|thumb)[23]/.test(b.name) && b.name !== 'jaw').map((b) => b.index);

// ------------------------------------------------------------------ per-zombie pose
/**
 * Pose: local rotations q[i] (relative to parent, rest = identity), animated local translations t[i] (parent frame, metres at rest
 * scale), world rotations Q[i] and pivots P[i]. `scale` = uniform body scale (height/1.75). Per-bone proportions: lenScale[i] scales
 * the bone along its own axis and the offsets of its children; girth[i] scales perpendicular to it.
 */
export class Pose {
  constructor() {
    this.q = Array.from({ length: NB }, () => new THREE.Quaternion());
    this.t = Array.from({ length: NB }, () => new V3());
    this.Q = Array.from({ length: NB }, () => new THREE.Quaternion());
    this.P = Array.from({ length: NB }, () => new V3());
    this.lenScale = new Float32Array(NB).fill(1); this.girth = new Float32Array(NB).fill(1);
    this.scale = 1; this.M = Array.from({ length: NB }, () => new THREE.Matrix4()); // per-bone S_i · T(−rest_i)
    this._w = new THREE.Matrix4(); this._k = new THREE.Matrix4();
    this.rootPos = new V3(); this.rootQ = new THREE.Quaternion();
    this.setProportions(1, null, null);
  }
  /** scale = height/1.75; len/girth: optional Float32Array overrides */
  setProportions(scale, len, girth) {
    this.scale = scale; if (len) this.lenScale.set(len); else this.lenScale.fill(1); if (girth) this.girth.set(girth); else this.girth.fill(1);
    for (let i = 0; i < NB; i++) {
      const b = B[i], d = _va.copy(b.tail).sub(b.pos); const L = d.length(); if (L > 1e-6) d.divideScalar(L); else d.set(0, 1, 0);
      const ls = this.lenScale[i], g = this.girth[i];
      // S = g·I + (ls − g)·d dᵀ   (scale ls along d, g across)
      const m = this.M[i], e = m.elements, k = ls - g;
      e[0] = g + k * d.x * d.x; e[4] = k * d.x * d.y; e[8] = k * d.x * d.z;
      e[1] = k * d.y * d.x; e[5] = g + k * d.y * d.y; e[9] = k * d.y * d.z;
      e[2] = k * d.z * d.x; e[6] = k * d.z * d.y; e[10] = g + k * d.z * d.z;
      e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
      // translation: −S·rest
      const p = b.pos; e[12] = -(e[0] * p.x + e[4] * p.y + e[8] * p.z); e[13] = -(e[1] * p.x + e[5] * p.y + e[9] * p.z); e[14] = -(e[2] * p.x + e[6] * p.y + e[10] * p.z);
    }
  }
  reset() { for (let i = 0; i < NB; i++) { this.q[i].identity(); this.t[i].set(0, 0, 0); } }
  /** forward kinematics from bone `from` (default all). Root world transform = rootPos/rootQ. */
  fk(from = 0) {
    const q = this.q, t = this.t, Q = this.Q, P = this.P, s = this.scale, ls = this.lenScale;
    for (let i = from; i < NB; i++) {
      const p = PARENT[i];
      if (p < 0) { Q[i].copy(this.rootQ).multiply(q[i]); P[i].copy(this.rootPos).add(_va.copy(t[i]).applyQuaternion(this.rootQ).multiplyScalar(s)); continue; }
      const b = B[i], pb = B[p], k = ls[p];
      _va.set((b.pos.x - pb.pos.x) * k + t[i].x, (b.pos.y - pb.pos.y) * k + t[i].y, (b.pos.z - pb.pos.z) * k + t[i].z).applyQuaternion(Q[p]).multiplyScalar(s);
      P[i].copy(P[p]).add(_va); Q[i].multiplyQuaternions(Q[p], q[i]);
    }
  }
  /** recompute world transforms only for the subtree rooted at i (bones are ordered parent-first; subtree = contiguous-ish) */
  fkSubtree(i) { this._fkOne(i); for (let j = i + 1; j < NB; j++) if (this._isDesc(j, i)) this._fkOne(j); }
  _fkOne(i) { const p = PARENT[i], b = B[i], pb = B[p], k = this.lenScale[p], t = this.t[i]; _va.set((b.pos.x - pb.pos.x) * k + t.x, (b.pos.y - pb.pos.y) * k + t.y, (b.pos.z - pb.pos.z) * k + t.z).applyQuaternion(this.Q[p]).multiplyScalar(this.scale); this.P[i].copy(this.P[p]).add(_va); this.Q[i].multiplyQuaternions(this.Q[p], this.q[i]); }
  _isDesc(j, i) { let p = PARENT[j]; while (p >= 0) { if (p === i) return true; p = PARENT[p]; } return false; }
  /** world position of a rest-space point bound rigidly to bone i */
  pointOn(i, rx, ry, rz, out) { const b = B[i], s = this.scale; out.set(rx - b.pos.x, ry - b.pos.y, rz - b.pos.z).applyMatrix3(_m3.setFromMatrix4(this.M[i])); /* S·(p−rest) */ out.applyQuaternion(this.Q[i]).multiplyScalar(s).add(this.P[i]); return out; }
  /** world tail (end point) of bone i */
  tail(i, out) { const b = B[i]; return this.pointOn(i, b.tail.x, b.tail.y, b.tail.z, out); }
  /** set world rotation of bone i (converts to local; parent world must be current) */
  setWorldQ(i, qw) { const p = PARENT[i]; if (p < 0) this.q[i].copy(this.rootQ).invert().multiply(qw); else this.q[i].copy(this.Q[p]).invert().multiply(qw); this.Q[i].copy(qw); }
  /** write skin matrices (world, relative to `origin`) into a Float32Array (skeleton.boneMatrices layout) */
  writeSkin(arr, origin) {
    const s = this.scale, w = this._w, k = this._k;
    for (let i = 0; i < NB; i++) {
      w.makeRotationFromQuaternion(this.Q[i]); const e = w.elements;
      e[0] *= s; e[1] *= s; e[2] *= s; e[4] *= s; e[5] *= s; e[6] *= s; e[8] *= s; e[9] *= s; e[10] *= s;
      e[12] = this.P[i].x - origin.x; e[13] = this.P[i].y - origin.y; e[14] = this.P[i].z - origin.z;
      k.multiplyMatrices(w, this.M[i]); k.toArray(arr, i * 16);
    }
  }
  /** full 4x4 skin matrix of bone i in WORLD space (for mapping world hit points back to rest space) */
  skinMatrix(i, out) { const s = this.scale, w = this._w; w.makeRotationFromQuaternion(this.Q[i]); const e = w.elements; e[0] *= s; e[1] *= s; e[2] *= s; e[4] *= s; e[5] *= s; e[6] *= s; e[8] *= s; e[9] *= s; e[10] *= s; e[12] = this.P[i].x; e[13] = this.P[i].y; e[14] = this.P[i].z; return out.multiplyMatrices(w, this.M[i]); }
  copyFrom(o) { for (let i = 0; i < NB; i++) { this.q[i].copy(o.q[i]); this.t[i].copy(o.t[i]); this.Q[i].copy(o.Q[i]); this.P[i].copy(o.P[i]); } this.rootPos.copy(o.rootPos); this.rootQ.copy(o.rootQ); }
}

// ------------------------------------------------------------------ IK
const _ik = { a: new V3(), b: new V3(), c: new V3(), u: new V3(), v: new V3(), k: new V3(), d1: new V3(), d2: new V3(), n: new V3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), r0: new V3(), r1: new V3(), s0: new V3() };
/**
 * Two-bone IK on the chain (i0 → i1 → end of i1). Places the end (i1's tail… i.e. i2's pivot) at `target` (world), bending in the
 * plane that contains `pole` (world direction the middle joint should point to). restBend = rest bend-axis (model space) used as
 * the secondary basis vector. Returns the reach ratio (>1 means target was out of reach and got clamped).
 */
export function solveTwoBone(pose, i0, i1, i2, target, pole, restBend0, restBend1, maxStretch = 0.9995) {
  const P = pose.P, s = pose.scale;
  const b0 = B[i0], b1 = B[i1], b2 = B[i2];
  const l1 = b0.pos.distanceTo(b1.pos) * pose.lenScale[i0] * s, l2 = b1.pos.distanceTo(b2.pos) * pose.lenScale[i1] * s;
  const A = P[i0]; const toT = _ik.a.copy(target).sub(A); let d = toT.length(); const reach = d / (l1 + l2);
  const dMax = (l1 + l2) * maxStretch, dMin = Math.abs(l1 - l2) + 1e-4; if (d > dMax) d = dMax; if (d < dMin) d = dMin;
  const u = _ik.u.copy(toT).normalize();
  // v: pole direction orthogonal to u
  const v = _ik.v.copy(pole).addScaledVector(u, -pole.dot(u)); if (v.lengthSq() < 1e-8) { v.set(0, 0, -1).addScaledVector(u, -u.z * -1); if (v.lengthSq() < 1e-8) v.set(1, 0, 0); } v.normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d); const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const d1 = _ik.d1.copy(u).multiplyScalar(cosA).addScaledVector(v, sinA); // first segment direction
  const K = _ik.b.copy(A).addScaledVector(d1, l1); const E = _ik.c.copy(A).addScaledVector(u, d);
  const d2 = _ik.d2.copy(E).sub(K).normalize();
  // bend-plane normal: d1 × d2 (≈ sign matches rest bend axis convention)
  const n = _ik.n.crossVectors(d1, d2); if (n.lengthSq() < 1e-10) n.crossVectors(d1, v); n.normalize();
  // world rotations: map rest (dir, bendAxis) → current (dir, n)
  const r0 = _ik.r0.copy(b1.pos).sub(b0.pos).normalize(); basisQuat(r0, restBend0, d1, n, _ik.q); pose.setWorldQ(i0, _ik.q); pose._fkOne(i1);
  const r1 = _ik.r1.copy(b2.pos).sub(b1.pos).normalize(); basisQuat(r1, restBend1, d2, n, _ik.q2); pose.setWorldQ(i1, _ik.q2); pose._fkOne(i2);
  return reach;
}
/** rotate bone i (world) so that its rest direction (to its tail) points along worldDir, keeping twist via the secondary axis. */
export function aimBone(pose, i, worldDir, restSecondary, worldSecondary) {
  const b = B[i]; const r0 = _ik.r0.copy(b.tail).sub(b.pos).normalize(); basisQuat(r0, restSecondary, worldDir, worldSecondary, _ik.q); pose.setWorldQ(i, _ik.q);
}
