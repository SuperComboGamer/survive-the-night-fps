// First-person arms. Full-finger tactical gloves (knit back, synthetic-leather palm, TPR knuckle guard + accordion finger segments, stitched panels,
// velcro wrist strap with pull tab), bare forearm with a pushed-up field-jacket sleeve (two-turn rolled cuff, folds, topstitch) and, on the left
// wrist, a steel watch. All of it is real bone-weighted geometry (hands/*.js): 36 bones (2 x 18), 4 draw calls (glove, skin, sleeve, hardware).
// Rest pose (right arm): wrist at the origin, fingers along -Z, palm facing -Y, thumb on the -X side, forearm along +Z.
// Posing: setArm(side, wristPos, handQuat, fingerPose) + analytic 2-bone IK (shoulder -> elbow -> wrist) with a pole vector.
import * as THREE from 'three';
import { UPPER, FORE, FING, THUMB, NB } from './hands/anat.js';
import { GB } from './hands/kit.js';
import { buildGlove } from './hands/glove.js';
import { buildSkin, buildSleeve } from './hands/arm.js';
import { buildWatch } from './hands/gear.js';
import { handMaterials } from './hands/hmats.js';

const D = Math.PI / 180;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ finger poses (deg). thumb: [cmcFlex, cmcAbd, mcp, ip, roll]; fingers: [mcp, pip, dip, spread, roll]
export const POSES = {
  flat: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
  relaxed: [[10, 8, 12, 10, 0], [18, 22, 10, 3, 0], [22, 28, 12, 0, 0], [26, 32, 14, -3, 0], [30, 36, 16, -7, 0]],
  open: [[-5, 18, 0, 0, 0], [4, 6, 4, 8, 0], [2, 4, 2, 1, 0], [4, 6, 4, -6, 0], [6, 8, 4, -14, 0]],
  fist: [[30, 10, 40, 40, 20], [88, 100, 50, 0, 0], [90, 102, 50, 0, 0], [90, 102, 50, 0, 0], [88, 100, 48, -2, 0]],
  // pistol: fingers wrap the front strap, index on the trigger, thumb high along the frame
  pistolGrip: [[24, 0, 8, 4, 0], [30, 58, 22, 6, -6], [80, 96, 44, 0, 0], [84, 98, 46, -2, 0], [86, 96, 46, -6, 0]],
  pistolGripMag: [[40, -4, 22, 14, 6], [30, 58, 22, 6, -6], [80, 96, 44, 0, 0], [84, 98, 46, -2, 0], [86, 96, 46, -6, 0]],
  pistolGripStop: [[14, -8, 4, 2, 0], [30, 58, 22, 6, -6], [80, 96, 44, 0, 0], [84, 98, 46, -2, 0], [86, 96, 46, -6, 0]],
  pistolSupport: [[10, 0, 5, 0, 0], [58, 64, 30, 2, 0], [62, 66, 32, 0, 0], [64, 68, 32, -2, 0], [66, 68, 32, -5, 0]],
  rifleGrip: [[28, 22, 22, 12, 12], [26, 56, 24, 6, -6], [78, 92, 40, 0, 0], [80, 94, 42, -2, 0], [82, 94, 42, -5, 0]],
  rifleGripThumb: [[-6, -10, -4, 0, 0], [26, 56, 24, 6, -6], [78, 92, 40, 0, 0], [80, 94, 42, -2, 0], [82, 94, 42, -5, 0]],
  handguard: [[10, 40, 10, 6, 0], [48, 52, 26, 4, 0], [52, 56, 28, 0, 0], [54, 58, 28, -2, 0], [56, 58, 28, -6, 0]],
  magGrip: [[20, 38, 20, 10, 0], [55, 60, 28, 4, 0], [62, 66, 32, 0, 0], [66, 68, 32, -3, 0], [68, 70, 32, -7, 0]],
  pinch: [[26, 48, 22, 16, 10], [46, 52, 30, 4, 0], [70, 86, 44, 0, 0], [76, 92, 46, -2, 0], [80, 94, 46, -6, 0]],
  pump: [[8, 42, 8, 4, 0], [52, 58, 28, 4, 0], [58, 62, 30, 0, 0], [60, 64, 30, -2, 0], [62, 64, 30, -6, 0]],
  slap: [[-4, 24, 0, 0, 0], [8, 8, 4, 4, 0], [6, 6, 4, 0, 0], [8, 8, 4, -4, 0], [10, 10, 4, -9, 0]],
  knife: [[34, 20, 30, 30, 20], [82, 90, 46, 2, 0], [86, 94, 48, 0, 0], [88, 96, 48, -2, 0], [86, 94, 46, -4, 0]],
  grenade: [[18, 40, 22, 18, 10], [42, 52, 30, 4, 0], [46, 56, 32, 0, 0], [50, 58, 32, -3, 0], [52, 58, 32, -8, 0]],
  point: [[24, 20, 26, 26, 12], [4, 6, 4, 4, 0], [86, 98, 48, 0, 0], [88, 100, 48, -2, 0], [86, 98, 46, -4, 0]],
};
export function poseArr(p) { const a = new Float32Array(25); const src = typeof p === 'string' ? POSES[p] : p; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) a[i * 5 + j] = src[i][j]; return a; }
export const POSE_ARR = Object.fromEntries(Object.keys(POSES).map((k) => [k, poseArr(k)]));

/** Hand frame from the direction of the straight fingers and the palm normal (camera/gun space). */
export function handQuat(fingerDir, palmNormal, out = new THREE.Quaternion()) {
  _z.set(-fingerDir[0], -fingerDir[1], -fingerDir[2]).normalize(); _y.set(-palmNormal[0], -palmNormal[1], -palmNormal[2]); _y.addScaledVector(_z, -_y.dot(_z)).normalize(); _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z); return out.setFromRotationMatrix(_m);
}

export class Hands {
  constructor(mats, { layer = 1, materials = null } = {}) {
    this.group = new THREE.Group(); this.group.name = 'hands';
    // bones: [R: 0..17, L: 18..35]
    this.bones = []; this.arms = {};
    for (const side of ['R', 'L']) {
      const sx = side === 'R' ? 1 : -1; const o = side === 'R' ? 0 : NB; const bs = [];
      const upper = new THREE.Bone(); upper.position.set(0, 0, UPPER + FORE); const fore = new THREE.Bone(); fore.position.set(0, 0, FORE); const hand = new THREE.Bone();
      this.group.add(upper, fore, hand); bs.push(upper, fore, hand);
      // thumb chain with a rest rotation aligning -Z with the thumb direction
      const dir = new THREE.Vector3(...THUMB.dir).normalize(); dir.x *= sx; const up0 = new THREE.Vector3(...THUMB.up); up0.x *= sx; const Zt = dir.clone().negate(); const Yt = up0.clone().addScaledVector(Zt, -up0.dot(Zt)).normalize(); const Xt = new THREE.Vector3().crossVectors(Yt, Zt);
      const qT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xt, Yt, Zt));
      const t1 = new THREE.Bone(); t1.position.set(THUMB.cmc[0] * sx, THUMB.cmc[1], THUMB.cmc[2]); t1.quaternion.copy(qT); hand.add(t1);
      const t2 = new THREE.Bone(); t2.position.set(0, 0, -THUMB.len[0]); t1.add(t2); const t3 = new THREE.Bone(); t3.position.set(0, 0, -THUMB.len[1]); t2.add(t3); bs.push(t1, t2, t3);
      const fingers = [[t1, t2, t3]];
      for (const f of FING) { const b1 = new THREE.Bone(); b1.position.set(f.mcp[0] * sx, f.mcp[1], f.mcp[2]); hand.add(b1); const b2 = new THREE.Bone(); b2.position.set(0, 0, -f.len[0]); b1.add(b2); const b3 = new THREE.Bone(); b3.position.set(0, 0, -f.len[1]); b2.add(b3); bs.push(b1, b2, b3); fingers.push([b1, b2, b3]); }
      bs.forEach((b, i) => { b.name = side + i; b.userData.restQ = b.quaternion.clone(); b.userData.restP = b.position.clone(); });
      this.bones.push(...bs); this.arms[side] = { upper, fore, hand, fingers, sx, qT, pose: poseArr('relaxed'), elbow: new THREE.Vector3(), shoulder: new THREE.Vector3(), visible: true };
    }
    this.group.updateMatrixWorld(true); this.skeleton = new THREE.Skeleton(this.bones);
    // geometry: right arm built once, left = mirror (+ the left-only watch)
    const t0 = performance.now();
    const gl = buildGlove(), sk = buildSkin(), sl = buildSleeve(), wt = buildWatch();
    const bm = (i) => i + NB;
    this.buildMs = performance.now() - t0;
    const M = materials || handMaterials(mats); this.mats = M;
    this.meshes = []; this.parts = { glove: gl.gb, skin: sk.gb, sleeve: sl.gb, hw: wt.gb };
    for (const [geo, mat] of [[gl.gb.geometryPair(bm), M.glove], [sk.gb.geometryPair(bm), M.skin], [sl.gb.geometryPair(bm), M.sleeve], [wt.gb.geometry(), M.hw]]) { const m = new THREE.SkinnedMesh(geo, mat); m.bind(this.skeleton, new THREE.Matrix4()); m.frustumCulled = false; m.layers.set(layer); m.receiveShadow = true; this.group.add(m); this.meshes.push(m); }
    this.tris = this.meshes.reduce((a, m) => a + m.geometry.index.count / 3, 0); this._bend = (M.U && M.U.uBend && M.U.uBend.value) || new Float32Array(32); // per-joint flexion (rad) for the bunching shader: ids 1-12 fingers (PIP 2+3f, DIP 3+3f), 14-15 thumb; +16 = left arm
    // default shoulders / poles (camera space)
    this.shoulder = { R: new THREE.Vector3(0.19, -0.24, 0.10), L: new THREE.Vector3(-0.19, -0.24, 0.10) };
    this.pole = { R: new THREE.Vector3(0.7, -1, 0.1), L: new THREE.Vector3(-0.7, -1, 0.1) };
  }

  /** Pose one arm: wrist position + hand orientation (camera space), finger pose (Float32Array(25)). */
  setArm(side, wrist, hq, pose, shoulder = this.shoulder[side], pole = this.pole[side], twistK = 0.6) {
    const A = this.arms[side], sx = A.sx;
    A.hand.position.copy(wrist); A.hand.quaternion.copy(hq);
    // ---- IK: shoulder may protract toward the target when out of reach
    const S = A.shoulder.copy(shoulder); _v.subVectors(wrist, S); let d = _v.length(); const reach = UPPER + FORE - 0.002;
    if (d > reach) { S.addScaledVector(_v, (d - reach) / d); d = reach; } d = Math.max(d, 0.1);
    _u.copy(_v).normalize(); // shoulder -> wrist
    const along = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, UPPER * UPPER - along * along));
    _w.copy(pole).addScaledVector(_u, -pole.dot(_u)); if (_w.lengthSq() < 1e-8) _w.set(0, -1, 0); _w.normalize();
    const E = A.elbow.copy(S).addScaledVector(_u, along).addScaledVector(_w, h);
    // forearm: -Z from elbow to wrist, roll follows the hand's back (+Y) partly (pronation), rest follows the elbow bend plane
    _z.subVectors(E, wrist).normalize(); // bone +Z points back toward the elbow
    _y.set(0, 1, 0).applyQuaternion(hq); _x.copy(_w).negate(); // elbow-plane up (away from the elbow bend)
    _y.lerp(_x, 1 - twistK); _y.addScaledVector(_z, -_y.dot(_z)).normalize(); _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z); A.fore.quaternion.setFromRotationMatrix(_m); A.fore.position.copy(E);
    // upper arm: -Z from shoulder to elbow
    _z.subVectors(S, E).normalize(); _y.set(0, 1, 0).applyQuaternion(A.fore.quaternion); _y.addScaledVector(_z, -_y.dot(_z)).normalize(); _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z); A.upper.quaternion.setFromRotationMatrix(_m); A.upper.position.copy(S);
    this.setFingers(side, pose);
  }
  setFingers(side, p) {
    const A = this.arms[side], sx = A.sx;
    // thumb: CMC flex (about local X) + abduction (about local Y) + roll (about Z), then MCP/IP flex
    const T = A.fingers[0];
    _e.set(-p[0] * D, p[1] * D * sx * 0 + p[1] * D, p[4] * D * sx, 'YXZ'); _q.setFromEuler(_e); T[0].quaternion.copy(T[0].userData.restQ).multiply(_q);
    _e.set(-p[2] * D, 0, 0); T[1].quaternion.setFromEuler(_e); _e.set(-p[3] * D, 0, 0); T[2].quaternion.setFromEuler(_e);
    const bo = side === 'L' ? 16 : 0, Bd = this._bend; Bd[bo + 14] = Math.max(0, p[2]) * D; Bd[bo + 15] = Math.max(0, p[3]) * D;
    for (let f = 1; f < 5; f++) {
      const F = A.fingers[f], o = f * 5; Bd[bo + 2 + 3 * (f - 1)] = Math.max(0, p[o + 1]) * D; Bd[bo + 3 + 3 * (f - 1)] = Math.max(0, p[o + 2]) * D; Bd[bo + 1 + 3 * (f - 1)] = Math.max(0, p[o]) * D * 0;
      _e.set(-p[o] * D, p[o + 3] * D * sx, p[o + 4] * D * sx, 'YXZ'); F[0].quaternion.setFromEuler(_e);
      _e.set(-p[o + 1] * D, 0, 0); F[1].quaternion.setFromEuler(_e); _e.set(-p[o + 2] * D, 0, 0); F[2].quaternion.setFromEuler(_e);
    }
  }
  setVisible(side, v) { const A = this.arms[side]; A.visible = v; if (!v) { A.hand.position.set(0, -5, 0); A.fore.position.set(0, -5, 0.3); A.upper.position.set(0, -5, 0.6); } }
}
