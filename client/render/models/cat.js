// Procedural stray cat. ONE rigidly-skinned SkinnedMesh like the zombies (see skinning.js); geometry is
// shared per coat, each instance owns its skeleton. Fully procedural walk / gallop / sit / idle animation
// blended by smoothed state weights. Faces -Z, meters, feet at y = 0.
import * as THREE from 'three';
import { CANIM } from '../../../shared/defs.js';
import { MeshBuilder, instantiateRig, setFx, getCharacterMaterial, fbm3, noise3, clamp, lerp } from './skinning.js';
import { CR } from './charTextures.js';

const TAU = Math.PI * 2;

// bone bind positions (model space)
const B = {
  hips: [0, 0.22, 0.1],
  chest: [0, 0.225, -0.08],
  neck: [0, 0.25, -0.15],
  head: [0, 0.3, -0.19],
  ear: [0.028, 0.335, -0.19],
  tail: [[0, 0.235, 0.17], [0, 0.235, 0.24], [0, 0.235, 0.31], [0, 0.235, 0.38]],
  tailEnd: [0, 0.235, 0.44],
  // front leg: shoulder -> elbow -> wrist
  fu: [0.042, 0.19, -0.1],
  fl: [0.042, 0.105, -0.087],
  fp: [0.042, 0.022, -0.1],
  // hind leg: hip -> knee -> hock
  hu: [0.05, 0.2, 0.12],
  hk: [0.05, 0.115, 0.075],
  hh: [0.05, 0.055, 0.14],
};
const TAIL_N = B.tail.length;

// coats: base fur, stripes (tabby), white bib/paws, calico patches, eye + nose colour
const COATS = [
  { name: 'orange tabby', fur: 0xc47a38, stripe: 0x86481c, white: 0.55, eye: 0xb8b830, nose: 0xc98a80 },
  { name: 'black', fur: 0x1d1b1b, eye: 0xd6b830, nose: 0x2a2222 },
  { name: 'grey tabby', fur: 0x86827c, stripe: 0x45423e, white: 0.35, eye: 0x9cb848, nose: 0xb08480 },
  { name: 'tuxedo', fur: 0x1c1b1b, white: 1, eye: 0x9cc040, nose: 0x3a2c2c },
  { name: 'calico', fur: 0xd8d1c4, patches: [0xc47634, 0x221f1e], eye: 0xc0a838, nose: 0xd09088 },
];
export const CAT_COATS = COATS.length;

const _w = new THREE.Color(0xdcd6ca);

// per-part coat colouring; P/N are bind-pose model-space position/normal
function coatTint(coat, part) {
  const stripe = coat.stripe != null ? new THREE.Color(coat.stripe) : null;
  const patchA = coat.patches ? new THREE.Color(coat.patches[0]) : null;
  const patchB = coat.patches ? new THREE.Color(coat.patches[1]) : null;
  const w = coat.white || 0;
  return (P, N, C) => {
    if (stripe) {
      // tabby: bands over the back, rings on legs and tail, lines on the forehead
      const n = fbm3(P.x * 18, P.y * 18, P.z * 18, 2, 5);
      let s = -1;
      if (part === 'body') s = N.y > -0.5 ? Math.sin(P.z * 62 + Math.abs(P.x) * 25 + n * 4.5) : -1;
      else if (part === 'leg') s = Math.sin(P.y * 95 + n * 3);
      else if (part === 'tail') s = Math.sin(P.z * 75 + n * 2);
      else if (part === 'head') s = P.y > 0.312 && P.z > -0.236 ? Math.sin(P.x * 150 + n * 2) : -1;
      if (s > 0.25) C.lerp(stripe, clamp((s - 0.25) * 2.2, 0, 0.85));
    }
    if (patchA) {
      const n = fbm3(P.x * 9 + 11, P.y * 9, P.z * 9, 3, 17);
      const m = fbm3(P.x * 7, P.y * 7 + 5, P.z * 7, 3, 23);
      if (n > 0.56) C.lerp(patchA, clamp((n - 0.56) * 12, 0, 1));
      else if (m > 0.6) C.lerp(patchB, clamp((m - 0.6) * 12, 0, 1));
    }
    if (w) {
      // belly + bib, muzzle, socks (tuxedos get tall ones)
      let white = false;
      if (part === 'body') white = N.y < -0.5 || (P.z < -0.1 && N.z < -0.2 && Math.abs(P.x) < 0.045 && P.y < 0.26);
      else if (part === 'head') white = P.z < -0.228 && P.y < 0.292;
      else if (part === 'leg') white = P.y < (w > 0.8 ? 0.07 : 0.032);
      if (white) C.lerp(_w, w > 0.8 ? 0.95 : w);
    }
  };
}

function buildCat(coatIdx) {
  const coat = COATS[coatIdx % COATS.length];
  const mb = new MeshBuilder();
  mb.addBone('root', null, 0, 0, 0);
  mb.addBone('hips', 'root', ...B.hips);
  mb.addBone('chest', 'hips', ...B.chest);
  mb.addBone('neck', 'chest', ...B.neck);
  mb.addBone('head', 'neck', ...B.head);
  mb.addBone('earL', 'head', -B.ear[0], B.ear[1], B.ear[2]);
  mb.addBone('earR', 'head', B.ear[0], B.ear[1], B.ear[2]);
  for (let i = 0; i < TAIL_N; i++) mb.addBone('tail' + i, i ? 'tail' + (i - 1) : 'hips', ...B.tail[i]);
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    mb.addBone('fu' + n, 'chest', s * B.fu[0], B.fu[1], B.fu[2]);
    mb.addBone('fl' + n, 'fu' + n, s * B.fl[0], B.fl[1], B.fl[2]);
    mb.addBone('fp' + n, 'fl' + n, s * B.fp[0], B.fp[1], B.fp[2]);
    mb.addBone('hu' + n, 'hips', s * B.hu[0], B.hu[1], B.hu[2]);
    mb.addBone('hk' + n, 'hu' + n, s * B.hk[0], B.hk[1], B.hk[2]);
    mb.addBone('hh' + n, 'hk' + n, s * B.hh[0], B.hh[1], B.hh[2]);
  }
  // parts are placed in model space; geom() takes bone-relative coordinates
  const rel = (bone, p) => {
    const b = mb.bonePos(bone);
    return [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  };
  const furs = {};
  const fur = (part) => furs[part] || (furs[part] = { color: coat.fur, region: CR.PLAIN, mottle: 0.14, mf: 45, tint: coatTint(coat, part) });
  const ellip = (part, bone, c, r, o = {}) => mb.ellip(bone, rel(bone, c), r, { ...fur(part), ...o });
  const seg = (part, bone, a, b, r0, r1, o = {}) => mb.seg(bone, rel(bone, a), rel(bone, b), r0, r1, { rs: 7, hs: 2, caps: 2, ...fur(part), ...o });
  // ball at a joint so rigid segments don't open a gap when it bends
  const joint = (part, bone, c, r) => ellip(part, bone, c, [r, r, r], { ws: 7, hs: 5 });

  // body: haunches + barrel on the hips, ribcage on the chest (overlap hides the seam when the spine flexes)
  ellip('body', 'hips', [0, 0.212, 0.075], [0.066, 0.074, 0.095], { ws: 16, hs: 11 });
  ellip('body', 'hips', [0, 0.208, -0.005], [0.062, 0.07, 0.09], { ws: 16, hs: 11 });
  ellip('body', 'chest', [0, 0.215, -0.075], [0.063, 0.078, 0.085], { ws: 16, hs: 11 });
  ellip('body', 'neck', [0, 0.258, -0.148], [0.042, 0.052, 0.05], { ws: 14, hs: 9 });
  // head: skull, cheeks, muzzle pads, chin, nose
  ellip('head', 'head', [0, 0.302, -0.2], [0.05, 0.046, 0.05], { ws: 16, hs: 12 });
  ellip('head', 'head', [0, 0.286, -0.21], [0.057, 0.034, 0.04], { ws: 16, hs: 9 });
  for (const s of [-1, 1]) ellip('head', 'head', [s * 0.012, 0.283, -0.244], [0.016, 0.013, 0.013], { ws: 7, hs: 5 });
  ellip('head', 'head', [0, 0.272, -0.236], [0.014, 0.01, 0.012], { ws: 6, hs: 4 });
  mb.ellip('head', rel('head', [0, 0.292, -0.252]), [0.008, 0.006, 0.005], { ws: 6, hs: 4, color: coat.nose, region: CR.PLAIN, mottle: 0 });
  // eyes (a little eyeshine) + slit pupils
  for (const s of [-1, 1]) {
    mb.ellip('head', rel('head', [s * 0.021, 0.309, -0.242]), [0.0105, 0.011, 0.0065], { ws: 8, hs: 6, color: coat.eye, glow: 0.35, region: CR.PLAIN, mottle: 0, ao: false });
    mb.ellip('head', rel('head', [s * 0.021, 0.309, -0.2485]), [0.0026, 0.0092, 0.0018], { ws: 6, hs: 5, color: 0x080606, region: CR.PLAIN, mottle: 0, ao: false });
  }
  // ears: flattened four-sided cones, pink inside
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    for (const inner of [false, true]) {
      const g = new THREE.ConeGeometry(inner ? 0.015 : 0.022, inner ? 0.034 : 0.044, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(1, 1, 0.42);
      g.translate(0, inner ? 0.015 : 0.02, inner ? -0.004 : 0);
      mb.geom('ear' + n, g, {
        rot: [-0.12, 0, -s * 0.28],
        at: [0, -0.004, 0],
        ...(inner ? { color: coat.nose === 0x2a2222 ? 0x3a2a2a : 0xc49490, region: CR.PLAIN, mottle: 0.1 } : fur('ear')),
      });
    }
  }
  // tail: one tapered segment per bone
  for (let i = 0; i < TAIL_N; i++) {
    const a = B.tail[i];
    const b = i + 1 < TAIL_N ? B.tail[i + 1] : B.tailEnd;
    const r0 = 0.018 - i * 0.0015;
    seg('tail', 'tail' + i, a, b, r0, r0 - 0.0015, { rs: 7, hs: 1 });
    joint('tail', 'tail' + i, a, r0);
  }
  // legs
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const X = (p) => [s * p[0], p[1], p[2]];
    // front: shoulder blade, upper arm, forearm, paw
    ellip('leg', 'fu' + n, X([0.045, 0.19, -0.095]), [0.026, 0.045, 0.034], { ws: 10, hs: 7 });
    seg('leg', 'fu' + n, X(B.fu), X(B.fl), 0.022, 0.017);
    seg('leg', 'fl' + n, X(B.fl), X(B.fp), 0.016, 0.0135);
    joint('leg', 'fl' + n, X(B.fl), 0.017);
    joint('leg', 'fp' + n, X(B.fp), 0.0135);
    ellip('leg', 'fp' + n, X([0.042, 0.013, -0.112]), [0.017, 0.012, 0.024], { ws: 8, hs: 5 });
    // hind: haunch, thigh, shin, hock, paw
    ellip('leg', 'hu' + n, X([0.047, 0.175, 0.105]), [0.03, 0.052, 0.05], { ws: 10, hs: 7 });
    seg('leg', 'hu' + n, X(B.hu), X(B.hk), 0.03, 0.02);
    seg('leg', 'hk' + n, X(B.hk), X(B.hh), 0.017, 0.014);
    joint('leg', 'hk' + n, X(B.hk), 0.02);
    seg('leg', 'hh' + n, X(B.hh), X([0.05, 0.016, 0.126]), 0.013, 0.012);
    joint('leg', 'hh' + n, X(B.hh), 0.014);
    ellip('leg', 'hh' + n, X([0.05, 0.013, 0.114]), [0.017, 0.012, 0.025], { ws: 8, hs: 5 });
  }
  mb.dirt = null;
  mb.aoStrength = 0.25;
  return mb.build();
}

const rigs = new Map();
function getRig(coat) {
  let r = rigs.get(coat);
  if (!r) {
    r = buildCat(coat);
    rigs.set(coat, r);
  }
  return r;
}

// ------------------------------------------------------------------ animation
const n1 = (t, seed) => noise3(t, seed * 1.7, 0.5, 11) * 2 - 1;
// leg phase offsets (fractions of a cycle): lateral-sequence walk vs. gallop
const WALK_OFF = { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 };
const RUN_OFF = { LH: 0, RH: 0.12, LF: 0.55, RF: 0.67 };

class CatInstance {
  constructor(coat, seed) {
    const rig = getRig(coat);
    const inst = instantiateRig(rig, getCharacterMaterial(), rig.sphere.radius * 1.6 + 0.2);
    this.mesh = inst.mesh;
    this.bones = inst.bones;
    this.skeleton = inst.skeleton;
    this.fx = inst.fx;
    this.X = {};
    for (const [name, idx] of rig.names) this.X[name] = idx;
    this.object = new THREE.Group();
    this.object.name = 'cat';
    this.object.add(this.mesh);
    this.seed = seed;
    this.curl = seed & 1 ? 1 : -1; // side the tail wraps to when sitting
    this.phase = 0;
    this.wSit = 1;
    this.wRun = 0;
    this.wMove = 0;
    this.earT = 1 + (seed % 5);
    this.earSide = 0;
    this.earK = 0;
    this._seen = true;
    this.mesh.onBeforeRender = () => {
      this._seen = true;
    };
    this.update(0, CANIM.SIT, 0, 0);
  }

  rot(name, x, y, z) {
    this.bones[this.X[name]].rotation.set(x, y, z);
  }

  update(dt, anim, speed, time) {
    if (dt > 0.1) dt = 0.1;
    const k = Math.min(1, dt * 4);
    const moving = anim === CANIM.WALK || anim === CANIM.RUN;
    this.wSit += ((anim === CANIM.SIT ? 1 : 0) - this.wSit) * Math.min(1, dt * 2.5);
    this.wRun += ((anim === CANIM.RUN ? 1 : 0) - this.wRun) * k;
    this.wMove += ((moving ? clamp(speed / 0.5, 0, 1) : 0) - this.wMove) * Math.min(1, dt * 6);
    const stride = lerp(0.36, 1.05, this.wRun);
    this.phase = (this.phase + (dt * speed * TAU) / stride) % (TAU * 1000);
    // ear flicks now and then
    this.earT -= dt;
    if (this.earT <= 0) {
      this.earT = 1.5 + Math.random() * 5;
      this.earSide = Math.random() < 0.5 ? 0 : 1;
      this.earK = 1;
    }
    this.earK = Math.max(0, this.earK - dt * 5);
    setFx(this.fx, 0, 1);
    const seen = this._seen;
    this._seen = false;
    if (!seen) return;
    this.pose(time);
  }

  pose(t) {
    const { wSit: S, wRun: R, wMove: M } = this;
    const st = 1 - S;
    const ph = this.phase;
    const sd = this.seed * 0.37;
    const hipsB = this.bones[this.X.hips];
    // gait
    const walkA = 1 - R;
    const legs = {};
    for (const key of ['LH', 'LF', 'RH', 'RF']) {
      const th = ph + TAU * lerp(WALK_OFF[key], RUN_OFF[key], R);
      legs[key] = { s: Math.sin(th), lift: Math.max(0, Math.cos(th)) };
    }
    const ampF = lerp(0.42, 0.95, R) * M;
    const ampH = lerp(0.48, 1.0, R) * M;
    const flexF = lerp(0.75, 1.4, R) * M;
    const flexH = lerp(0.55, 1.2, R) * M;
    // spine: gallop flex, walk roll
    const flex = Math.sin(ph) * 0.16 * R * M;
    const bob = (Math.abs(Math.sin(ph)) * 0.008 * walkA + (0.5 + 0.5 * Math.sin(ph * 2)) * 0.03 * R) * M;
    const roll = Math.sin(ph) * 0.05 * walkA * M;
    // look around when standing still
    const lookY = n1(t * 0.25, sd) * 0.9 * (1 - M * 0.8);
    const lookX = n1(t * 0.2, sd + 3) * 0.25 * (1 - M);

    // --- sit: hips down, body pitched up, hind legs folded under, front legs straight
    const sitPitch = 0.78;
    hipsB.position.set(B.hips[0], B.hips[1] - 0.105 * S + bob * st, B.hips[2] + 0.02 * S);
    this.rot('hips', sitPitch * S + flex * st, 0, roll * st);
    this.rot('chest', -0.12 * S - flex * 1.3 * st, 0, -roll * 0.6 * st);
    const bodyPitch = sitPitch * S - 0.12 * S; // world pitch of the chest
    this.rot('neck', -0.35 * S + lookX * 0.4 + 0.12 * st * (1 - M) - 0.1 * R * M, lookY * 0.45, 0);
    this.rot('head', -(bodyPitch - 0.35 * S) * 0.75 + lookX * 0.6 - Math.sin(ph * 2) * 0.05 * walkA * M, lookY * 0.55, n1(t * 0.15, sd + 7) * 0.12 * (1 - M));
    // ears: forward, flick one back occasionally, flatten when running
    const flick = this.earK * 0.7;
    this.rot('earL', -0.3 * R * M, 0, (this.earSide === 0 ? -flick : 0) - 0.25 * R * M);
    this.rot('earR', -0.3 * R * M, 0, (this.earSide === 1 ? flick : 0) + 0.25 * R * M);

    // front legs
    for (const [side, key] of [['L', 'LF'], ['R', 'RF']]) {
      const g = legs[key];
      const sitCounter = -bodyPitch; // keep them vertical under the raised chest
      this.rot('fu' + side, g.s * ampF * st + sitCounter * S + 0.06 * S, 0, 0);
      this.rot('fl' + side, -g.lift * flexF * st, 0, 0);
      this.rot('fp' + side, g.lift * flexF * 0.7 * st + (g.s < 0 ? -g.s * 0.25 * M * st : 0), 0, 0);
    }
    // hind legs
    for (const [side, key] of [['L', 'LH'], ['R', 'RH']]) {
      const g = legs[key];
      this.rot('hu' + side, (g.s * ampH - 0.05) * st + 0.5 * S, 0, 0);
      this.rot('hk' + side, -g.lift * flexH * st - 1.75 * S, 0, 0);
      this.rot('hh' + side, g.lift * flexH * 0.85 * st + 0.45 * S, 0, 0);
    }

    // tail: "?" held high on a walk, streaming behind at a run, swishing low when standing, curled round when sitting
    const walkTail = [-1.15, -0.15, -0.22, -0.4];
    const runTail = [-0.35, 0.06, 0.06, 0.02];
    const idleTail = [0.55, 0.25, -0.3, -0.45];
    // sitting: drops behind the rump, lies flat along the ground (cumulative pitch 0 with the hips'
    // sit pitch, so the Y rotations below curl it about the vertical), then wraps round the side
    const sitTail = [1.2 - sitPitch, -1.2, 0, 0];
    const sitCurl = [0, 0.85 * this.curl, 0.9 * this.curl, 0.9 * this.curl];
    const idleK = 1 - M;
    for (let i = 0; i < TAIL_N; i++) {
      const stand = lerp(lerp(walkTail[i], runTail[i], R), idleTail[i], idleK);
      const x = lerp(stand, sitTail[i], S) + Math.sin(ph + i * 0.9) * 0.08 * R * M;
      const swish = Math.sin(t * (1.1 + idleK * 0.6) + i * 0.7 + sd) * (0.1 + 0.18 * idleK) * st + (i === TAIL_N - 1 ? Math.sin(t * 1.3 + sd) * 0.25 * S : 0);
      this.rot('tail' + i, x, swish + sitCurl[i] * S, 0);
    }
  }

  dispose() {
    this.skeleton.dispose();
    if (this.object.parent) this.object.parent.remove(this.object);
  }
}

/** A cat view: { object, update(dt, anim, speed, time), dispose() }. coat = server variant byte. */
export function createCat(coat = 0, seed = 0) {
  const c = new CatInstance((coat >>> 0) % COATS.length, seed >>> 0);
  return {
    object: c.object,
    update: (dt, anim, speed, time) => c.update(dt, anim, speed, time),
    dispose: () => c.dispose(),
    _inst: c,
  };
}
