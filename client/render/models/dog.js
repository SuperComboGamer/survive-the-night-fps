// Procedural zombie dog. ONE rigidly-skinned SkinnedMesh like the zombies and the stray cat (see skinning.js):
// geometry is shared per coat, each instance owns its skeleton. Emaciated and mangy, lips peeled back off
// its teeth, clouded glowing eyes; per coat an exposed ribcage, a torn ear, a stump tail or an old collar.
// Procedural trot / gallop / bite / crouch / lunge / feed / stagger / death, blended by smoothed ZANIM
// weights. Faces -Z, meters, feet at y = 0. Same view interface as createZombie().
import * as THREE from 'three';
import { ZANIM } from '../../../shared/defs.js';
import { MeshBuilder, instantiateRig, setFx, getCharacterMaterial, fbm3, noise3, clamp, lerp, smooth } from './skinning.js';
import { CR } from './charTextures.js';

const TAU = Math.PI * 2;

// bone bind positions (model space). The server hitbox is a body cylinder around the origin and a head
// sphere 0.5 m ahead of it at 0.58 m (ZOMBIE_DEFS[ZTYPE.DOG]).
const B = {
  hips: [0, 0.55, 0.24],
  chest: [0, 0.56, -0.16],
  neck: [0, 0.59, -0.3],
  head: [0, 0.625, -0.45],
  jaw: [0, 0.585, -0.5],
  ear: [0.048, 0.685, -0.465],
  tail: [[0, 0.6, 0.37], [0, 0.585, 0.46], [0, 0.56, 0.55]],
  tailEnd: [0, 0.53, 0.64],
  // front leg: shoulder -> elbow -> wrist -> paw
  fu: [0.1, 0.5, -0.2],
  fl: [0.1, 0.3, -0.16],
  fp: [0.1, 0.085, -0.19],
  fpaw: [0.1, 0.022, -0.225],
  // hind leg: hip -> stifle -> hock -> paw
  hu: [0.1, 0.52, 0.3],
  hk: [0.1, 0.32, 0.23],
  hh: [0.1, 0.14, 0.34],
  hpaw: [0.1, 0.022, 0.31],
};
const TAIL_N = B.tail.length;
/** Paw sole (ground contact) relative to the wrist (fp*) / hock (hh*) bone, for foot-planting measurements. */
export const DOG_SOLES = { fp: [0, -B.fp[1], B.fpaw[2] - 0.01 - B.fp[2]], hh: [0, -B.hh[1], B.hpaw[2] - 0.005 - B.hh[2]] };

// coats: fur, darker saddle over the back, pale belly/muzzle, ears (up / floppy), zombie damage
const COATS = [
  { name: 'shepherd', fur: 0x6e4e2e, saddle: 0x1d1814, belly: 0x9a7a52, ears: 'up', ribs: 1, collar: 0x5a2a1c },
  { name: 'husky', fur: 0x6f6c66, saddle: 0x3a3836, belly: 0xb4b0a6, ears: 'up', tornEar: -1, stump: true },
  { name: 'black lab', fur: 0x201e1c, ears: 'flop', ribs: -1, collar: 0x8a1c14 },
  { name: 'mutt', fur: 0x5e3c24, belly: 0x8c6a48, ears: 'flop', tornEar: 1 },
  { name: 'pit', fur: 0xa89c86, belly: 0xc4baa6, ears: 'up', ribs: -1, tornEar: 1, stump: true },
];
export const DOG_COATS = COATS.length;

const C_MANGE = new THREE.Color(0x7c6a64); // bald, diseased skin
const C_SCAB = new THREE.Color(0x3a1410);
const C_TEETH = 0xb8ab84;
const C_GUM = 0x4a0e10;

// per-part fur colouring; P/N are bind-pose model-space position/normal
function coatTint(coat, part, seed) {
  const saddle = coat.saddle != null ? new THREE.Color(coat.saddle) : null;
  const belly = coat.belly != null ? new THREE.Color(coat.belly) : null;
  return (P, N, C) => {
    if (saddle && (part === 'body' || part === 'neck')) {
      // dark saddle over the back and down the neck
      const k = smooth(clamp((P.y - 0.55 + (fbm3(P.x * 9, P.y * 9, P.z * 9, 2, 3) - 0.5) * 0.08) * 14, 0, 1));
      if (P.z > -0.3 && P.z < 0.36) C.lerp(saddle, k * 0.85);
    }
    if (belly) {
      let b = 0;
      if (part === 'body') b = N.y < -0.35 ? 0.8 : 0;
      else if (part === 'neck') b = N.y < -0.2 ? 0.6 : 0;
      else if (part === 'head') b = P.y < 0.6 && P.z < -0.5 ? 0.7 : 0;
      else if (part === 'leg') b = P.y < 0.2 ? 0.55 : 0;
      if (b) C.lerp(belly, b);
    }
    // mange: bald, scabbed patches
    if (part !== 'paw') {
      const m = fbm3(P.x * 10 + seed, P.y * 10, P.z * 10, 3, 31);
      if (m > 0.58) C.lerp(C_MANGE, clamp((m - 0.58) * 9, 0, 0.9));
      if (m > 0.68) C.lerp(C_SCAB, clamp((m - 0.68) * 10, 0, 0.7));
    }
  };
}

function buildDog(coatIdx) {
  const coat = COATS[coatIdx % COATS.length];
  const seed = coatIdx * 13.7;
  const mb = new MeshBuilder();
  mb.addBone('root', null, 0, 0, 0);
  mb.addBone('hips', 'root', ...B.hips);
  mb.addBone('chest', 'hips', ...B.chest);
  mb.addBone('neck', 'chest', ...B.neck);
  mb.addBone('head', 'neck', ...B.head);
  mb.addBone('jaw', 'head', ...B.jaw);
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
  const fur = (part) => furs[part] || (furs[part] = { color: coat.fur, region: CR.PLAIN, mottle: 0.22, mf: 40, tint: coatTint(coat, part, seed) });
  const ellip = (part, bone, c, r, o = {}) => mb.ellip(bone, rel(bone, c), r, { ...fur(part), ...o });
  const seg = (part, bone, a, b, r0, r1, o = {}) => mb.seg(bone, rel(bone, a), rel(bone, b), r0, r1, { rs: 7, hs: 1, caps: 2, ...fur(part), ...o });
  const joint = (part, bone, c, r) => ellip(part, bone, c, [r, r, r], { ws: 6, hs: 4 });
  const plain = (color, o = {}) => ({ color, region: CR.PLAIN, mottle: 0.15, ao: false, ws: 6, hs: 4, ...o });
  // a horizontal body shell: lathe profile [radius, z] from rump to front, elliptical section (h = height / width)
  // around a centre line at height y that rises by lift(z)
  const shell = (part, bone, y, prof, h, lift) =>
    mb.lathe(bone, rel(bone, [0, y, 0]), prof.map(([r, z]) => [r, -z]), {
      rs: 12, sz: h, rot: [-Math.PI / 2, 0, 0], shape: lift ? (v) => (v.z += lift(-v.y)) : null, ...fur(part),
    });

  // body: deep narrow ribcage on the chest, tucked-up starved loin and bony rump on the hips (the shells overlap
  // at the waist so no gap opens when the spine flexes)
  shell('body', 'chest', 0.5, [[0, 0.1], [0.06, 0.08], [0.078, 0.02], [0.088, -0.06], [0.092, -0.14], [0.088, -0.22], [0.072, -0.28], [0.042, -0.315], [0, -0.325]], 1.45);
  const tuck = (z) => 0.03 * Math.exp(-(((z - 0.04) / 0.12) ** 2));
  shell('body', 'hips', 0.55, [[0, 0.43], [0.045, 0.41], [0.074, 0.36], [0.082, 0.29], [0.074, 0.2], [0.06, 0.12], [0.054, 0.04], [0.058, -0.04], [0.064, -0.1], [0, -0.15]], 1.12, tuck);
  // spine and hip bones pushing through the hide
  for (let i = 0; i < 6; i++) {
    const z = -0.22 + i * 0.085;
    const bone = z < 0 ? 'chest' : 'hips';
    ellip('body', bone, [0, z < -0.05 ? 0.628 : 0.614, z], [0.013, 0.011, 0.022], { ws: 6, hs: 4 });
  }
  for (const s of [-1, 1]) ellip('body', 'hips', [s * 0.058, 0.61, 0.29], [0.018, 0.016, 0.024], { ws: 6, hs: 4 });
  // exposed ribs: a torn-open flank, dark cavity and bare bone
  if (coat.ribs) {
    const s = coat.ribs;
    mb.ellip('chest', rel('chest', [s * 0.088, 0.5, -0.15]), [0.03, 0.085, 0.1], plain(0x3a0a08, { region: CR.GORE, mottle: 0.3, blood: false }));
    for (let i = 0; i < 4; i++) {
      const z = -0.225 + i * 0.045;
      mb.tube('chest', [rel('chest', [s * 0.07, 0.6, z]), rel('chest', [s * 0.108, 0.52, z + 0.008]), rel('chest', [s * 0.098, 0.43, z + 0.018])], 0.0075, 0.006, { rs: 4, ts: 4, color: 0xd8ccb0, region: CR.BONE, blood: false, cap: false });
    }
  }
  // neck, with a ragged ruff where it meets the chest
  seg('neck', 'neck', [0, 0.54, -0.22], [0, 0.625, -0.46], 0.07, 0.05, { rs: 10, sx: 0.85 });
  ellip('neck', 'neck', [0, 0.565, -0.3], [0.064, 0.074, 0.07], { ws: 10, hs: 7, noise: 0.01, nf: 30 });
  if (coat.collar != null) {
    // somebody's pet once
    const g = new THREE.TorusGeometry(0.066, 0.011, 5, 14);
    g.rotateX(0.31);
    mb.geom('neck', g, { at: rel('neck', [0, 0.588, -0.36]), color: coat.collar, region: CR.LEATHER, mottle: 0.2 });
    mb.box('neck', rel('neck', [0, 0.51, -0.37]), [0.022, 0.028, 0.004], { color: 0xb09a58, region: CR.PLAIN, mottle: 0.1, glow: 0.08 });
  }
  // head: skull, brow, muzzle, nose, lower jaw
  ellip('head', 'head', [0, 0.64, -0.49], [0.066, 0.064, 0.08], { ws: 10, hs: 7 });
  ellip('head', 'head', [0, 0.662, -0.525], [0.058, 0.03, 0.04], { ws: 8, hs: 5 });
  ellip('head', 'head', [0, 0.608, -0.585], [0.04, 0.038, 0.075], { ws: 9, hs: 6 });
  for (const s of [-1, 1]) ellip('head', 'head', [s * 0.045, 0.612, -0.51], [0.028, 0.036, 0.045], { ws: 7, hs: 5 });
  mb.ellip('head', rel('head', [0, 0.626, -0.658]), [0.021, 0.017, 0.016], plain(0x141010, { mottle: 0.05 }));
  ellip('head', 'jaw', [0, 0.574, -0.57], [0.032, 0.017, 0.072], { ws: 8, hs: 5 });
  // lips peeled back: gums and teeth along both sides, long canines
  for (const s of [-1, 1]) {
    mb.ellip('head', rel('head', [s * 0.03, 0.59, -0.59]), [0.012, 0.012, 0.06], plain(C_GUM, { region: CR.GORE, blood: false }));
    mb.ellip('jaw', rel('jaw', [s * 0.026, 0.583, -0.58]), [0.01, 0.009, 0.055], plain(C_GUM, { region: CR.GORE, blood: false }));
    for (let i = 0; i < 4; i++) {
      const z = -0.55 - i * 0.03;
      const x = s * (0.035 - i * 0.004);
      const fang = i === 3;
      const h = fang ? 0.03 : 0.012 + (i % 2) * 0.004;
      const tooth = plain(C_TEETH, { region: CR.BONE, blood: false, mottle: 0.25, rs: 4 });
      mb.spike('head', rel('head', [x, 0.592, z]), rel('head', [x * 0.97, 0.592 - h, z - (fang ? 0.004 : 0)]), fang ? 0.0065 : 0.0048, tooth);
      mb.spike('jaw', rel('jaw', [x * 0.9, 0.58, z + 0.005]), rel('jaw', [x * 0.88, 0.58 + h * 0.8, z + 0.005]), fang ? 0.0055 : 0.0042, tooth);
    }
    // clouded, faintly glowing eyes in bruised sockets
    mb.ellip('head', rel('head', [s * 0.041, 0.655, -0.548]), [0.014, 0.012, 0.01], plain(0x241010, { region: CR.GORE }));
    mb.ellip('head', rel('head', [s * 0.043, 0.656, -0.553]), [0.0095, 0.0085, 0.007], plain(0xcfc47a, { glow: 0.45, mottle: 0, blood: false }));
  }
  // ears: flattened four-sided cones; pricked or floppy, one torn short on some
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const torn = coat.tornEar === s;
    const len = torn ? 0.04 : 0.072;
    for (const inner of [false, true]) {
      const g = new THREE.ConeGeometry(inner ? 0.028 : 0.042, inner ? len * 0.75 : len, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(1, 1, 0.34);
      g.translate(0, (inner ? len * 0.375 : len * 0.5) - 0.006, inner ? -0.006 : 0);
      const rot = coat.ears === 'flop' ? [-0.35, 0, -s * 2.1] : [0.15, 0, -s * 0.38];
      mb.geom('ear' + n, g, { rot, ...(inner ? plain(torn ? 0x4a1210 : 0x5c3a36, { region: CR.SKIN }) : fur('ear')) });
    }
  }
  // tail: tapered segments, or a gnawed stump
  const tailN = coat.stump ? 1 : TAIL_N;
  for (let i = 0; i < tailN; i++) {
    const a = B.tail[i];
    const b = coat.stump ? [0, 0.59, 0.43] : i + 1 < TAIL_N ? B.tail[i + 1] : B.tailEnd;
    const r0 = 0.03 - i * 0.007;
    seg('tail', 'tail' + i, a, b, r0, r0 - 0.006, { rs: 6, hs: 1 });
    joint('tail', 'tail' + i, a, r0);
  }
  if (coat.stump) mb.ellip('tail0', rel('tail0', [0, 0.59, 0.435]), [0.022, 0.022, 0.012], plain(0x5a0c0a, { region: CR.GORE, blood: false }));
  // legs: thin, knobby joints, big paws
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const X = (p) => [s * p[0], p[1], p[2]];
    // front: shoulder blade + upper arm, forearm, pastern, paw
    seg('leg', 'fu' + n, X([0.045, 0.565, -0.225]), X(B.fu), 0.036, 0.052, { sx: 0.6 });
    seg('leg', 'fu' + n, X(B.fu), X(B.fl), 0.052, 0.034, { sx: 0.8 });
    seg('leg', 'fl' + n, X(B.fl), X(B.fp), 0.031, 0.023);
    joint('leg', 'fl' + n, X(B.fl), 0.033);
    seg('leg', 'fp' + n, X(B.fp), X(B.fpaw), 0.022, 0.02);
    joint('leg', 'fp' + n, X(B.fp), 0.024);
    ellip('paw', 'fp' + n, X([0.1, 0.02, -0.232]), [0.028, 0.02, 0.04], { ws: 7, hs: 4 });
    // hind: flat bony thigh, shin, hock, paw
    seg('leg', 'hu' + n, X([0.055, 0.555, 0.3]), X(B.hk), 0.074, 0.038, { sx: 0.6, rs: 8 });
    seg('leg', 'hk' + n, X(B.hk), X(B.hh), 0.033, 0.022, { sx: 0.8 });
    joint('leg', 'hk' + n, X(B.hk), 0.034);
    seg('leg', 'hh' + n, X(B.hh), X(B.hpaw), 0.021, 0.019);
    joint('leg', 'hh' + n, X(B.hh), 0.023);
    ellip('paw', 'hh' + n, X([0.1, 0.02, 0.305]), [0.027, 0.019, 0.038], { ws: 7, hs: 4 });
  }
  // blood: soaked muzzle and chest, a bite wound on the haunch
  mb.blood([0, 0.575, -0.6], 0.075, 1);
  mb.blood([0, 0.42, -0.24], 0.085, 0.8);
  mb.blood([-0.1, 0.5, 0.25], 0.06, 0.9);
  mb.dirt = { y0: 0.25, k: 1.2 };
  mb.aoStrength = 0.3;
  return mb.build();
}

const rigs = new Map();
function getRig(coat) {
  let r = rigs.get(coat);
  if (!r) {
    r = buildDog(coat);
    rigs.set(coat, r);
  }
  return r;
}

// ------------------------------------------------------------------ animation
const n1 = (t, seed) => noise3(t, seed * 1.7, 0.5, 13) * 2 - 1;
// leg phase offsets (fractions of a cycle): diagonal trot vs. rotary gallop
const TROT_OFF = { LF: 0, RH: 0.02, RF: 0.5, LH: 0.52 };
const RUN_OFF = { LH: 0, RH: 0.1, LF: 0.5, RF: 0.62 };
// pose states (weights are smoothed towards the server's ZANIM state)
const S_LOCO = 0, S_ATK = 1, S_SPC = 2, S_AIR = 3, S_STAG = 4, S_DEAD = 5, S_EAT = 6, NS = 7;
const STATE_OF = { [ZANIM.IDLE]: S_LOCO, [ZANIM.WALK]: S_LOCO, [ZANIM.RUN]: S_LOCO, [ZANIM.ATTACK]: S_ATK, [ZANIM.SPECIAL]: S_SPC, [ZANIM.AIRBORNE]: S_AIR, [ZANIM.STAGGER]: S_STAG, [ZANIM.DEAD]: S_DEAD, [ZANIM.EAT]: S_EAT };
const BLEND = [9, 16, 14, 14, 18, 14, 6]; // 1/s towards each state

class DogInstance {
  constructor(coat, seed) {
    const rig = getRig(coat);
    const inst = instantiateRig(rig, getCharacterMaterial(), rig.sphere.radius * 1.6 + 0.3);
    this.mesh = inst.mesh;
    this.bones = inst.bones;
    this.skeleton = inst.skeleton;
    this.fx = inst.fx;
    this.nb = this.bones.length;
    this.X = {};
    for (const [name, idx] of rig.names) this.X[name] = idx;
    this.rx = new Float32Array(this.nb);
    this.ry = new Float32Array(this.nb);
    this.rz = new Float32Array(this.nb);
    this.object = new THREE.Group();
    this.object.name = 'zombie';
    this.object.add(this.mesh);
    const r = (k) => noise3(seed * 0.618 + k * 7.1, k, 0.3, 29);
    this.seed = seed;
    this.sd = seed * 0.37;
    this.side = r(1) < 0.5 ? 1 : -1; // side it falls on when it dies
    this.limpLeg = r(2) < 0.45 ? ['LF', 'RF', 'LH', 'RH'][Math.floor(r(3) * 4) & 3] : null;
    this.limp = 0.35 + r(4) * 0.4;
    this.headLow = 0.15 + r(5) * 0.2;
    this.state = ZANIM.IDLE;
    this.stateT = 0;
    this.w = new Float32Array(NS);
    this.w[S_LOCO] = 1;
    this.phase = r(6) * TAU;
    this.wRun = 0;
    this.wMove = 0;
    this.speed = 0;
    this.hit = 0;
    this.flinchT = 9; // since the last hit (flinch)
    this.flinchSide = 1;
    this.voxT = 9; // since the last bark / snarl (jaw and head move with it)
    this.voxKind = 0;
    this.headless = false;
    this.time = 0;
    this._seen = true;
    this.mesh.onBeforeRender = () => {
      this._seen = true;
    };
    // anchors: skull centre + mouth (effects, calibration)
    this.headCenter = new THREE.Object3D();
    this.headCenter.position.set(0, 0.64 - B.head[1], -0.51 - B.head[2]);
    this.bones[this.X.head].add(this.headCenter);
    this.mouth = new THREE.Object3D();
    this.mouth.position.set(0, 0.58 - B.jaw[1], -0.63 - B.jaw[2]);
    this.bones[this.X.jaw].add(this.mouth);
    this.object.userData.mouth = this.mouth;
    this.object.userData.head = this.headCenter;
    this.pose(0);
  }

  update(dt, anim, speed, time, inView = false) {
    if (dt > 0.1) dt = 0.1;
    if (anim !== this.state) {
      this.state = anim;
      this.stateT = 0;
    }
    this.stateT += dt;
    this.time = time;
    this.speed = speed;
    const cur = STATE_OF[anim] ?? S_LOCO;
    for (let i = 0; i < NS; i++) this.w[i] += ((i === cur ? 1 : 0) - this.w[i]) * Math.min(1, dt * BLEND[cur]);
    const moving = anim === ZANIM.WALK || anim === ZANIM.RUN;
    this.wRun += (clamp((speed - 2.4) / 2.2, 0, 1) - this.wRun) * Math.min(1, dt * 5);
    this.wMove += ((moving ? clamp(speed / 0.8, 0, 1) : 0) - this.wMove) * Math.min(1, dt * 7);
    if (anim !== ZANIM.DEAD) {
      const stride = lerp(1.08, 2.7, this.wRun); // ground covered per gait cycle (keeps planted paws from sliding)
      this.phase = (this.phase + (dt * speed * TAU) / stride) % (TAU * 1000);
    }
    if (this.hit > 0) this.hit = Math.max(0, this.hit - dt * 5);
    this.flinchT += dt;
    this.voxT += dt;
    const glow = anim === ZANIM.DEAD ? Math.max(0.15, 1 - this.stateT * 0.6) : 1;
    setFx(this.fx, this.hit, glow);
    const seen = this._seen;
    this._seen = false;
    if (!seen && !inView && this.w[cur] > 0.99) return;
    this.pose(time);
  }

  add(name, w, x, y = 0, z = 0) {
    const i = this.X[name];
    this.rx[i] += x * w;
    this.ry[i] += y * w;
    this.rz[i] += z * w;
  }

  pose(t) {
    this.rx.fill(0);
    this.ry.fill(0);
    this.rz.fill(0);
    const w = this.w;
    const st = { hy: 0, hz: 0, ry: 0, rootX: 0, rootY: 0 };
    if (w[S_LOCO] > 0.001) this.poseLoco(t, w[S_LOCO], st);
    if (w[S_ATK] > 0.001) this.poseBite(t, w[S_ATK], st);
    if (w[S_SPC] > 0.001) this.poseCrouch(t, w[S_SPC], st);
    if (w[S_AIR] > 0.001) this.poseLeap(t, w[S_AIR], st);
    if (w[S_STAG] > 0.001) this.poseStagger(t, w[S_STAG], st);
    if (w[S_EAT] > 0.001) this.poseFeed(t, w[S_EAT], st);
    if (w[S_DEAD] > 0.001) this.poseDead(t, w[S_DEAD], st);
    const live = 1 - w[S_DEAD];
    if (this.flinchT < 0.35) {
      // hit: the head snaps away and the body jerks to one side
      const k = Math.sin((this.flinchT / 0.35) * Math.PI) * live;
      const sg = this.flinchSide;
      this.add('neck', k, 0.25, sg * 0.35, sg * 0.2);
      this.add('chest', k, 0.05, -sg * 0.12, -sg * 0.1);
      this.add('hips', k, 0, sg * 0.08, sg * 0.1);
    }
    const vd = this.voxKind ? 0.75 : 0.9;
    if (this.voxT < vd) {
      // bark / snarl: jaws work with the sound, a snap of the head on each bark
      const u = this.voxT / vd;
      const env = Math.sin(u * Math.PI) * live;
      const open = this.voxKind ? Math.max(0, Math.sin(u * Math.PI * 6)) * 0.55 : 0.25 + Math.sin(this.voxT * 30) * 0.06;
      this.add('jaw', env, -open);
      this.add('head', env, this.voxKind ? open * 0.3 : 0.05);
      this.add('earL', env, 0.5);
      this.add('earR', env, 0.5);
    }
    const bones = this.bones;
    for (let i = 1; i < this.nb; i++) bones[i].rotation.set(this.rx[i], this.ry[i], this.rz[i]);
    bones[this.X.hips].position.set(B.hips[0], B.hips[1] + st.hy, B.hips[2] + st.hz);
    bones[this.X.root].position.set(st.rootX, st.rootY, 0);
    bones[this.X.head].scale.setScalar(this.headless ? 0.001 : 1);
  }

  // stand / trot / gallop (speed-driven), with a hitching limp, a low twitchy head and panting
  poseLoco(t, W, st) {
    const M = this.wMove;
    const R = this.wRun;
    const ph = this.phase;
    const sd = this.sd;
    const trot = 1 - R;
    const ampF = lerp(0.42, 0.95, R) * M;
    const ampH = lerp(0.4, 0.85, R) * M;
    const flexF = lerp(0.9, 1.5, R) * M;
    const flexH = lerp(0.7, 1.25, R) * M;
    for (const key of ['LF', 'RF', 'LH', 'RH']) {
      const th = ph + TAU * lerp(TROT_OFF[key], RUN_OFF[key], R);
      let s = Math.sin(th);
      let lift = Math.max(0, Math.cos(th));
      if (key === this.limpLeg) {
        // favours a bad leg: short, hitching steps with the paw barely set down
        s *= 1 - this.limp * 0.5;
        lift = lift * (1 - this.limp * 0.3) + this.limp * 0.35 * M;
      }
      const side = key[0];
      if (key[1] === 'F') {
        this.add('fu' + side, W, s * ampF + 0.04);
        this.add('fl' + side, W, -lift * flexF);
        this.add('fp' + side, W, lift * flexF * 0.9 + (s < 0 ? -s * 0.2 * M : 0));
      } else {
        this.add('hu' + side, W, s * ampH - 0.04);
        this.add('hk' + side, W, -lift * flexH - 0.05);
        this.add('hh' + side, W, lift * flexH * 0.85 + 0.05);
      }
    }
    // spine: gallop flex + bounding bob, trot roll
    const flex = Math.sin(ph) * 0.14 * R * M;
    st.hy += ((Math.abs(Math.sin(ph * 2)) - 0.5) * 0.014 * trot + (0.5 + 0.5 * Math.sin(ph)) * 0.05 * R) * M * W;
    this.add('hips', W, flex, 0, Math.sin(ph) * 0.04 * trot * M);
    this.add('chest', W, -flex * 1.3, 0, -Math.sin(ph) * 0.03 * trot * M);
    // head: carried low and forward, stretched out at a gallop; sniffs and twitches when standing
    const idle = 1 - M;
    const lookY = n1(t * 0.3, sd) * 0.7 * idle;
    const sniff = Math.max(0, n1(t * 0.5, sd + 5)) * 0.35 * idle;
    const twitch = Math.pow(Math.max(0, n1(t * 1.7, sd + 9)), 6) * 6;
    this.add('neck', W, -this.headLow - 0.12 * R * M - sniff + Math.sin(ph * 2) * 0.05 * trot * M, lookY * 0.5 + twitch * 0.25, twitch * 0.2);
    this.add('head', W, this.headLow * 0.6 + 0.18 * R * M + sniff * 0.4 + twitch * 0.3, lookY * 0.6, n1(t * 0.2, sd + 7) * 0.15 * idle);
    // panting, snapping at the air now and then
    const pant = 0.1 + Math.sin(t * 11 + sd) * 0.05 + 0.1 * R * M;
    this.add('jaw', W, -(pant + Math.max(0, n1(t * 0.9, sd + 11) - 0.55) * 1.2));
    // ears half back, pinned flat at a gallop; tail low, streaming behind at speed
    const ear = 0.25 + 0.6 * R * M;
    this.add('earL', W, ear, 0, -0.1);
    this.add('earR', W, ear, 0, 0.1);
    for (let i = 0; i < TAIL_N; i++) {
      const x = lerp(i === 0 ? 0.85 : 0.18, i === 0 ? 0.25 : 0.05, R * M) + Math.sin(ph + i * 0.9) * 0.1 * R * M;
      this.add('tail' + i, W, x, Math.sin(t * 1.3 + i * 0.8 + sd) * 0.18 * idle + Math.sin(ph + i) * 0.1 * trot * M);
    }
  }

  // ATTACK: rear the head back, lunge-snap, then a tearing head shake
  poseBite(t, W, st) {
    const u = (this.stateT % 0.7) / 0.7;
    const reach = u < 0.25 ? -smooth(u / 0.25) * 0.4 : u < 0.4 ? lerp(-0.4, 1, smooth((u - 0.25) / 0.15)) : lerp(1, 0.2, smooth((u - 0.4) / 0.6));
    const open = u < 0.3 ? smooth(u / 0.3) * 0.85 : u < 0.4 ? lerp(0.85, 0.05, (u - 0.3) / 0.1) : 0.05 + Math.max(0, Math.sin(u * 30)) * 0.1;
    const shake = u > 0.4 ? Math.sin(u * 45) * 0.3 * (1 - u) : 0;
    this.add('neck', W, -0.1 + reach * 0.35, shake, shake * 0.6);
    this.add('head', W, 0.05 - reach * 0.15, shake * 0.8);
    this.add('jaw', W, -open);
    this.add('chest', W, -0.08 - reach * 0.06);
    st.hz += reach * 0.05 * W;
    // front legs braced wide, hind legs driving
    for (const s of ['L', 'R']) {
      this.add('fu' + s, W, -0.15 + reach * 0.15, 0, s === 'L' ? -0.1 : 0.1);
      this.add('fl' + s, W, -0.2);
      this.add('fp' + s, W, 0.25);
      this.add('hu' + s, W, 0.15 - reach * 0.2);
      this.add('hk' + s, W, -0.3);
      this.add('hh' + s, W, 0.3);
    }
    this.add('earL', W, 0.9, 0, -0.15);
    this.add('earR', W, 0.9, 0, 0.15);
    for (let i = 0; i < TAIL_N; i++) this.add('tail' + i, W, i === 0 ? 0.35 : 0.05);
  }

  // SPECIAL (lunge wind-up): crouched low on coiled legs, head down, snarling
  poseCrouch(t, W, st) {
    const quiver = Math.sin(t * 40 + this.sd) * 0.02;
    st.hy -= 0.08 * W;
    this.add('hips', W, -0.12);
    this.add('chest', W, -0.1);
    this.add('neck', W, -0.35 + quiver, 0, quiver);
    this.add('head', W, 0.45);
    this.add('jaw', W, -0.45 - quiver * 3);
    for (const s of ['L', 'R']) {
      this.add('fu' + s, W, 0.45);
      this.add('fl' + s, W, -0.95);
      this.add('fp' + s, W, 0.55);
      this.add('hu' + s, W, 0.55);
      this.add('hk' + s, W, -0.85);
      this.add('hh' + s, W, 0.55);
    }
    this.add('earL', W, 1.1, 0, -0.2);
    this.add('earR', W, 1.1, 0, 0.2);
    for (let i = 0; i < TAIL_N; i++) this.add('tail' + i, W, i === 0 ? 0.15 : 0, Math.sin(t * 22) * 0.05);
  }

  // AIRBORNE (lunge): stretched out flat, forelegs reaching, jaws wide
  poseLeap(t, W, st) {
    const u = clamp(this.stateT / 0.45, 0, 1);
    this.add('hips', W, 0.12 - u * 0.2);
    this.add('neck', W, 0.1);
    this.add('head', W, -0.05);
    this.add('jaw', W, -0.8);
    for (const s of ['L', 'R']) {
      this.add('fu' + s, W, 1.15 - u * 0.3);
      this.add('fl' + s, W, 0.15);
      this.add('fp' + s, W, -0.2);
      this.add('hu' + s, W, -0.95);
      this.add('hk' + s, W, 0.35);
      this.add('hh' + s, W, -0.4);
    }
    this.add('earL', W, 1.2);
    this.add('earR', W, 1.2);
    for (let i = 0; i < TAIL_N; i++) this.add('tail' + i, W, i === 0 ? 0.05 : -0.05);
  }

  // STAGGER: knocked sideways, head thrown back
  poseStagger(t, W, st) {
    const u = clamp(this.stateT / 0.35, 0, 1);
    const k = Math.sin(u * Math.PI);
    this.add('hips', W, -0.1 * k, 0.25 * k, 0.2 * k);
    this.add('chest', W, 0.1 * k, -0.2 * k, -0.15 * k);
    this.add('neck', W, 0.3 * k, 0.5 * k, 0.3 * k);
    this.add('head', W, 0.2 * k);
    this.add('jaw', W, -0.5 * k);
    for (const s of ['L', 'R']) {
      this.add('fu' + s, W, -0.2 * k, 0, (s === 'L' ? -0.3 : 0.3) * k);
      this.add('fl' + s, W, -0.3 * k);
      this.add('hu' + s, W, 0.2 * k);
      this.add('hk' + s, W, -0.4 * k);
      this.add('hh' + s, W, 0.3 * k);
    }
    this.add('earL', W, 0.8 * k);
    this.add('earR', W, 0.8 * k);
    for (let i = 0; i < TAIL_N; i++) this.add('tail' + i, W, i === 0 ? 0.6 : 0.2);
  }

  // EAT: front end down on a carcass, tearing at it
  poseFeed(t, W, st) {
    const sd = this.sd;
    const tear = Math.max(0, Math.sin(t * 2.3 + sd));
    const chew = Math.max(0, Math.sin(t * 8 + sd));
    st.hy -= 0.03 * W;
    this.add('hips', W, -0.28);
    this.add('chest', W, -0.05);
    this.add('neck', W, -0.55 + tear * 0.15, Math.sin(t * 1.7 + sd) * 0.2, Math.sin(t * 3.1) * tear * 0.15);
    this.add('head', W, -0.1 + tear * 0.35, Math.sin(t * 5 + sd) * tear * 0.2);
    this.add('jaw', W, -(0.08 + chew * 0.3));
    for (const s of ['L', 'R']) {
      this.add('fu' + s, W, 0.5, 0, s === 'L' ? -0.12 : 0.12);
      this.add('fl' + s, W, -0.75);
      this.add('fp' + s, W, 0.35);
      this.add('hu' + s, W, 0.12);
      this.add('hk' + s, W, -0.2);
      this.add('hh' + s, W, 0.15);
    }
    this.add('earL', W, 0.3, 0, -0.1);
    this.add('earR', W, 0.3, 0, 0.1);
    for (let i = 0; i < TAIL_N; i++) this.add('tail' + i, W, i === 0 ? 0.9 : 0.2, Math.sin(t * 0.9 + i) * 0.1);
  }

  // DEAD: legs buckle, it rolls onto its side, a few kicks, then limp
  poseDead(t, W, st) {
    const T = this.stateT;
    const buckle = smooth(clamp(T / 0.25, 0, 1));
    const roll = smooth(clamp((T - 0.1) / 0.4, 0, 1));
    const kick = Math.max(0, 1 - T / 1.6) * Math.sin(T * 24) * 0.25;
    const sg = this.side;
    this.rz[this.X.root] += sg * 1.5 * roll * W;
    st.rootX += sg * 0.42 * roll * W;
    st.rootY += (0.1 * roll - 0.12 * buckle * (1 - roll)) * W;
    this.add('neck', W, -0.35 * roll, 0, -sg * 0.3 * roll);
    this.add('head', W, 0.25 * roll);
    this.add('jaw', W, -0.35 - 0.1 * buckle);
    for (const s of ['L', 'R']) {
      const k = s === 'L' ? kick : -kick;
      this.add('fu' + s, W, lerp(0.3, 0.45, roll) + k);
      this.add('fl' + s, W, -0.6 * buckle * (1 - roll) - 0.25 * roll);
      this.add('fp' + s, W, 0.3);
      this.add('hu' + s, W, lerp(0.35, -0.3, roll) - k);
      this.add('hk' + s, W, -0.7 * buckle * (1 - roll) - 0.2 * roll);
      this.add('hh' + s, W, 0.4 * buckle * (1 - roll) + 0.1);
    }
    this.add('earL', W, 0.5);
    this.add('earR', W, 0.5);
    for (let i = 0; i < TAIL_N; i++) this.add('tail' + i, W, i === 0 ? 1.0 : 0.1);
  }

  hurt() {
    this.flinchT = 0;
    this.flinchSide = Math.random() < 0.5 ? -1 : 1;
  }

  vocalize(kind) {
    this.voxKind = kind;
    this.voxT = 0;
  }

  flash(a) {
    this.hit = Math.max(this.hit, clamp(a, 0, 1));
    setFx(this.fx, this.hit, 1);
  }

  setHeadless(v) {
    this.headless = !!v;
    this.bones[this.X.head].scale.setScalar(this.headless ? 0.001 : 1);
  }

  anchorWorld(anchor, out) {
    anchor.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(anchor.matrixWorld);
  }

  dispose() {
    this.skeleton.dispose();
    if (this.object.parent) this.object.parent.remove(this.object);
  }
}

/** Triangle counts per coat (models sandbox stats). */
export function dogStats() {
  return COATS.map((c, i) => ({ type: 'dog', variant: i, tris: getRig(i).tris, bones: getRig(i).bones.length }));
}

/**
 * A zombie dog view with the createZombie() interface: { object, update(dt, anim, speed, time, inView), flash, hurt, vocalize, setHeadless,
 * anchorWorld, dispose }. seed picks the coat (same hash as the other zombie variants) + per-instance quirks.
 */
export function createZombieDog(seed = 0) {
  const coat = (((seed >>> 0) * 2654435761) >>> 0) % COATS.length;
  const d = new DogInstance(coat, seed >>> 0);
  return {
    object: d.object,
    update: (dt, anim, speed, time, inView) => d.update(dt, anim, speed, time, inView),
    flash: (a) => d.flash(a),
    hurt: () => d.hurt(),
    vocalize: (kind) => d.vocalize(kind),
    setHeadless: (v) => d.setHeadless(v),
    anchorWorld: (a, out) => d.anchorWorld(a, out),
    dispose: () => d.dispose(),
    _inst: d,
  };
}
