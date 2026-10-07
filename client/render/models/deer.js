// Procedural white-tailed deer. ONE rigidly-skinned SkinnedMesh like the zombies, the dog and the cat (see
// skinning.js): geometry is shared per coat, each instance owns its skeleton. Does in two coats and a buck with
// antlers; and the mainland's undead (DEER_UNDEAD) in three more: the coat greyed and falling out in scabbed patches,
// one flank torn open to the ribs, eyes that glow, the jaw hanging, a torn ear, a snapped antler, a stump of a tail.
// Procedural stand / walk / bound, head down to graze, and the fall when it is killed; the undead also lower their
// antlers to charge (pawing the ground first) and toss them up in a ram. Blended by smoothed state weights (DANIM,
// shared/deer.js). Faces -Z, meters, hooves at y = 0.
// The head is where the server's hitbox has it (DEER_HEAD: up on the neck, or down in the grass while it grazes);
// `/sandbox/models-test.html?deer=grid&hit=1` draws the two over each other and prints where the skull ends up.
import * as THREE from 'three';
import { DANIM, DEER_UNDEAD } from '../../../shared/deer.js';
import { MeshBuilder, instantiateRig, setFx, getCharacterMaterial, fbm3, noise3, clamp, lerp, smooth } from './skinning.js';
import { CR } from './charTextures.js';

const TAU = Math.PI * 2;

// bone bind positions (model space)
const B = {
  hips: [0, 0.84, 0.32],
  chest: [0, 0.84, -0.2],
  neck: [0, 0.74, -0.36], // the base of the neck, low in the chest: what lets the muzzle reach the grass
  neck2: [0, 0.97, -0.5],
  head: [0, 1.2, -0.64],
  jaw: [0, 1.19, -0.73],
  ear: [0.068, 1.295, -0.645],
  tail: [0, 0.95, 0.56],
  // front leg: shoulder -> elbow -> knee -> hoof
  fu: [0.105, 0.8, -0.27],
  fl: [0.105, 0.6, -0.2],
  fp: [0.105, 0.31, -0.23],
  fhoof: [0.105, 0.03, -0.245],
  // hind leg: hip -> stifle -> hock -> hoof
  hu: [0.11, 0.84, 0.36],
  hk: [0.11, 0.6, 0.25],
  hh: [0.11, 0.37, 0.44],
  hhoof: [0.11, 0.03, 0.4],
};
const SKULL = [0, 1.24, -0.705]; // the middle of the skull: where the server's head sphere sits (DEER_HEAD.up)

// coats: fur, the darker line down the back, the white of belly, throat, rump and tail
const COATS = [
  { name: 'doe', fur: 0x94663c, back: 0x5e3f24, white: 0xd9d2c2 },
  { name: 'grey doe', fur: 0x80684e, back: 0x4e3d2c, white: 0xd4cfc4 },
  { name: 'buck', fur: 0x86592f, back: 0x4a3018, white: 0xd6cdb8, antlers: true, neck: 1.22 },
  // the undead (ribs: the flank torn open; tornEar, snapped: that side's ear, that side's antler beam)
  { name: 'undead doe', fur: 0x66574a, back: 0x342a22, white: 0x9a9286, undead: true, ribs: 1 },
  { name: 'undead grey doe', fur: 0x5b5650, back: 0x2e2a27, white: 0x8c8880, undead: true, ribs: -1, tornEar: 1 },
  { name: 'undead buck', fur: 0x5c4834, back: 0x2a1f17, white: 0x8e8574, antlers: true, neck: 1.22, undead: true, ribs: -1, tornEar: -1, snapped: 1 },
];
export const DEER_COATS = COATS.length;
const C_HOOF = 0x17120e;
const C_NOSE = 0x100c0a;
const C_ROT = new THREE.Color(0x6c605c); // the hide bare: grey, bruised skin
const C_SCAB = new THREE.Color(0x3a1410);
const C_RAW = new THREE.Color(0x5e1612); // the wound round the ribs
const C_GORE = new THREE.Color(0x2c0806);
// the torn flank (coat.ribs): its middle and half its length and height, on the chest's shell behind the shoulder
const RIP = { z: -0.11, y: 0.77, hz: 0.15, hy: 0.12 };
// [z, horizontal radius] of the chest's shell at its widest stations (its lathe profile below), for the ribs to lie on
const CHEST_R = [[-0.31, 0.15], [-0.2, 0.17], [-0.08, 0.172], [0.06, 0.16]];
const CHEST_Y = 0.775; // ...the middle of its section
const CHEST_H = 1.27; // ...and how much taller than wide it is

// per-part coat colouring; P/N are bind-pose model-space position/normal
function coatTint(coat, part) {
  const back = new THREE.Color(coat.back);
  const white = new THREE.Color(coat.white);
  const rot = coat.undead ? rotTint(coat, part) : null;
  return (P, N, C) => {
    if (rot) rot(P, N, C);
    const n = fbm3(P.x * 11, P.y * 11, P.z * 11, 2, 3) - 0.5;
    if (part === 'body') {
      // dark down the spine, pale under the belly, a white rump round the tail
      C.lerp(back, smooth(clamp((N.y - 0.55 + n * 0.3) * 3, 0, 1)) * 0.55);
      C.lerp(white, smooth(clamp((-N.y - 0.62 + n * 0.25) * 5, 0, 1)) * 0.8);
      if (P.z > 0.5 && P.y > 0.74 && P.y < 0.93 && Math.abs(P.x) < 0.1) C.lerp(white, 0.75);
    } else if (part === 'neck') {
      C.lerp(back, smooth(clamp((N.z - 0.3) * 2, 0, 1)) * 0.35); // the nape
      if (P.y > 0.98 && N.z < -0.45) C.lerp(white, 0.85); // the throat patch
    } else if (part === 'head') {
      if (P.y > 1.27) C.lerp(back, 0.35); // forehead
      if (P.z < -0.83 && P.y < 1.215) C.lerp(white, 0.75); // chin and the band behind the nose
      if (N.y < -0.5) C.lerp(white, 0.7); // under the jaw
    } else if (part === 'leg') {
      // the insides of the legs, and paler down to the hooves
      if (N.x * Math.sign(P.x) < -0.45 && P.y > 0.3) C.lerp(white, 0.45);
      else if (P.y < 0.4) C.lerp(back, 0.18);
    } else if (part === 'tail') {
      // brown on top, the white flag underneath
      if (N.y < 0.25 || Math.abs(N.x) > 0.75) C.lerp(white, 0.95);
      else C.lerp(back, 0.4);
    } else if (part === 'ear') {
      C.lerp(back, 0.2);
    }
  };
}

// (undead) how far into the torn flank a point is: > 0 inside it, 1 at its middle
function inRip(coat, P) {
  if (!coat.ribs || P.x * coat.ribs < 0.04) return -1;
  return 1 - Math.hypot((P.z - RIP.z) / RIP.hz, (P.y - RIP.y) / RIP.hy) - (fbm3(P.z * 13, P.y * 13, 1.7, 2, 5) - 0.5) * 0.45;
}

// the undead's hide, under the coat's colouring: patches of it fallen out to the grey skin, scabbed; the torn flank raw
function rotTint(coat, part) {
  return (P, N, C) => {
    const m = fbm3(P.x * 9 + 3.1, P.y * 9, P.z * 9, 3, 31);
    if (m > 0.55) C.lerp(C_ROT, clamp((m - 0.55) * 9, 0, 0.9));
    if (m > 0.65) C.lerp(C_SCAB, clamp((m - 0.65) * 10, 0, 0.75));
    if (part === 'body') {
      const k = inRip(coat, P);
      if (k > -0.35) C.lerp(C_RAW, clamp((k + 0.35) * 2.4, 0, 0.92));
      if (k > 0.25) C.lerp(C_GORE, clamp((k - 0.25) * 2, 0, 0.8));
    }
  };
}

// (undead) the horizontal radius of the chest's shell at z, and where its surface is at height y on that side
function chestR(z) {
  const R = CHEST_R;
  if (z <= R[0][0]) return R[0][1];
  for (let i = 1; i < R.length; i++) if (z <= R[i][0]) return lerp(R[i - 1][1], R[i][1], (z - R[i - 1][0]) / (R[i][0] - R[i - 1][0]));
  return R[R.length - 1][1];
}
function chestX(z, y) {
  const r = chestR(z);
  const v = (y - CHEST_Y) / (r * CHEST_H);
  return r * Math.sqrt(Math.max(0, 1 - v * v));
}

function buildDeer(coatIdx) {
  const coat = COATS[coatIdx % COATS.length];
  const mb = new MeshBuilder();
  mb.addBone('root', null, 0, 0, 0);
  mb.addBone('hips', 'root', ...B.hips);
  mb.addBone('chest', 'hips', ...B.chest);
  mb.addBone('neck', 'chest', ...B.neck);
  mb.addBone('neck2', 'neck', ...B.neck2);
  mb.addBone('head', 'neck2', ...B.head);
  mb.addBone('jaw', 'head', ...B.jaw);
  mb.addBone('earL', 'head', -B.ear[0], B.ear[1], B.ear[2]);
  mb.addBone('earR', 'head', B.ear[0], B.ear[1], B.ear[2]);
  mb.addBone('tail', 'hips', ...B.tail);
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
  const fur = (part) => furs[part] || (furs[part] = { color: coat.fur, region: CR.PLAIN, mottle: 0.12, mf: 30, blood: false, tint: coatTint(coat, part) });
  const ellip = (part, bone, c, r, o = {}) => mb.ellip(bone, rel(bone, c), r, { ...fur(part), ...o });
  const seg = (part, bone, a, b, r0, r1, o = {}) => mb.seg(bone, rel(bone, a), rel(bone, b), r0, r1, { rs: 8, hs: 1, caps: 2, ...fur(part), ...o });
  const joint = (part, bone, c, r) => ellip(part, bone, c, [r, r, r], { ws: 7, hs: 5 });
  const plain = (color, o = {}) => ({ color, region: CR.PLAIN, mottle: 0.1, ao: false, blood: false, ws: 7, hs: 5, ...o });
  // a horizontal body shell: lathe profile [radius, z] from rump to front, elliptical section (h = height / width)
  // around a centre line at height y
  const shell = (part, bone, y, prof, h, lift) =>
    mb.lathe(bone, rel(bone, [0, y, 0]), prof.map(([r, z]) => [r, -z]), {
      rs: 14, sz: h, rot: [-Math.PI / 2, 0, 0], shape: lift ? (v) => (v.z += lift(-v.y)) : null, ...fur(part),
    });

  // body: a deep chest on the chest bone, barrel and rump on the hips (the shells overlap at the waist so no gap
  // opens when the spine flexes at a bound)
  shell('body', 'chest', 0.775, [[0, 0.2], [0.12, 0.16], [0.16, 0.06], [0.172, -0.08], [0.17, -0.2], [0.15, -0.31], [0.105, -0.39], [0.05, -0.43], [0, -0.44]], 1.27);
  const tuck = (z) => 0.035 * Math.exp(-(((z - 0.14) / 0.14) ** 2)); // the flank, drawn up in front of the haunch
  shell('body', 'hips', 0.795, [[0, 0.57], [0.05, 0.56], [0.105, 0.52], [0.145, 0.44], [0.16, 0.33], [0.158, 0.2], [0.155, 0.08], [0.15, -0.04], [0.12, -0.14], [0, -0.2]], 1.18, tuck);
  // withers
  ellip('body', 'chest', [0, 0.945, -0.22], [0.075, 0.055, 0.2], { ws: 10, hs: 7 });
  // neck: two segments so it can arch down to the grass, a brisket where it leaves the chest
  const nk = coat.neck || 1;
  ellip('neck', 'chest', [0, 0.76, -0.37], [0.125 * nk, 0.16, 0.13], { ws: 10, hs: 7 });
  seg('neck', 'neck', [0, 0.73, -0.35], B.neck2, 0.15 * nk, 0.1 * nk, { rs: 10, sx: 0.74 });
  seg('neck', 'neck2', B.neck2, [0, 1.21, -0.645], 0.1 * nk, 0.078 * nk, { rs: 10, sx: 0.78 });
  joint('neck', 'neck2', B.neck2, 0.085 * nk);
  // head: skull, a long tapering muzzle, black nose, lower jaw
  ellip('head', 'head', SKULL, [0.078, 0.08, 0.105], { ws: 12, hs: 8 });
  seg('head', 'head', [0, 1.228, -0.75], [0, 1.18, -0.905], 0.064, 0.036, { rs: 9, sx: 0.85 });
  mb.ellip('head', rel('head', [0, 1.182, -0.925]), [0.023, 0.019, 0.017], plain(C_NOSE, { mottle: 0.05 }));
  ellip('head', 'jaw', [0, 1.16, -0.82], [0.03, 0.019, 0.088], { ws: 8, hs: 5 });
  for (const s of [-1, 1]) {
    // large dark eyes set on the sides of the skull (the undead's clouded over, and glowing)
    mb.ellip('head', rel('head', [s * 0.069, 1.262, -0.755]), [0.012, 0.018, 0.02], coat.undead ? plain(0xff5a26, { region: CR.GLOW, glow: 0.9, mottle: 0 }) : plain(0x0c0806, { mottle: 0 }));
    // ears: big flattened four-sided cones, pale inside, held out to the sides (one torn short on some of the undead)
    const n = s < 0 ? 'L' : 'R';
    const torn = coat.tornEar === s ? 0.55 : 1;
    for (const inner of [false, true]) {
      const len = (inner ? 0.12 : 0.155) * torn;
      const g = new THREE.ConeGeometry(inner ? 0.036 : 0.052, len, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(1, 1, 0.3);
      g.translate(0, len * 0.5 - 0.008, inner ? -0.007 : 0);
      mb.geom('ear' + n, g, { rot: [0.1, 0, -s * 0.85], ...(inner ? plain(coat.undead ? 0x7a4a44 : 0xcdb9a6) : fur('ear')) });
    }
    if (coat.antlers) {
      // a main beam sweeping out, up and forward, with three tines standing off it (on the undead, stained, and one
      // beam snapped off short above the first tine)
      const bone = plain(coat.undead ? 0x8c7a5c : 0xb7a27e, { region: CR.BONE, mottle: 0.25, rs: 5 });
      const snapped = coat.snapped === s;
      const beam = [[s * 0.035, 1.3, -0.69], [s * 0.085, 1.39, -0.655], [s * 0.165, 1.5, -0.68], [s * 0.19, 1.555, -0.775], [s * 0.15, 1.565, -0.86]];
      mb.tube('head', (snapped ? beam.slice(0, 3) : beam).map((p) => rel('head', p)), 0.017, snapped ? 0.013 : 0.007, { ...bone, ts: snapped ? 6 : 10 });
      mb.spike('head', rel('head', [s * 0.07, 1.36, -0.665]), rel('head', [s * 0.05, 1.445, -0.72]), 0.009, bone); // brow tine
      if (!snapped) {
        mb.spike('head', rel('head', [s * 0.15, 1.48, -0.67]), rel('head', [s * 0.17, 1.62, -0.66]), 0.01, bone);
        mb.spike('head', rel('head', [s * 0.188, 1.55, -0.76]), rel('head', [s * 0.215, 1.66, -0.79]), 0.009, bone);
      }
    }
  }
  // tail: a short flat flag, white underneath (the undead's a stump)
  if (coat.undead) seg('tail', 'tail', B.tail, [0, 0.885, 0.6], 0.042, 0.03, { rs: 8, sx: 1.35, sz: 0.55 });
  else seg('tail', 'tail', B.tail, [0, 0.77, 0.635], 0.048, 0.022, { rs: 8, sx: 1.35, sz: 0.55 });
  // (undead) the ribs in the torn flank: bars of bone curving down the side, lying in the raw wound on the shell. A
  // tube's start is open, so each comes out of the body (buried 2 cm in at the top) and ends capped on the surface
  if (coat.ribs) {
    const rib = plain(0xd2c6a8, { region: CR.BONE, mottle: 0.2, rs: 5 });
    for (let i = 0; i < 4; i++) {
      const z = RIP.z - 0.1 + i * 0.06;
      const pts = [[chestX(z, 0.9) - 0.02, 0.9, z - 0.006]];
      for (const [k, y] of [0.86, 0.8, 0.74, 0.68].entries()) pts.push([chestX(z, y) + 0.002, y, z + k * 0.008]);
      mb.tube('chest', pts.map((p) => rel('chest', [coat.ribs * p[0], p[1], p[2]])), 0.0085, 0.007, { ...rib, ts: 8 });
    }
  }
  // legs: long and fine under a muscled shoulder and haunch, black cloven hooves
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const X = (p) => [s * p[0], p[1], p[2]];
    const hoof = (bone, at) => mb.box(bone, rel(bone, X(at)), [0.046, 0.06, 0.066], { color: C_HOOF, region: CR.PLAIN, mottle: 0.1, blood: false, round: 0.55, seg: 2 });
    // front: shoulder blade and upper arm, forearm, cannon
    seg('leg', 'fu' + n, X([0.075, 0.9, -0.3]), X(B.fl), 0.09, 0.056, { sx: 0.62 });
    seg('leg', 'fl' + n, X(B.fl), X(B.fp), 0.044, 0.027);
    joint('leg', 'fl' + n, X(B.fl), 0.047);
    seg('leg', 'fp' + n, X(B.fp), X([B.fhoof[0], 0.06, B.fhoof[2]]), 0.024, 0.02);
    joint('leg', 'fp' + n, X(B.fp), 0.031);
    hoof('fp' + n, B.fhoof);
    // hind: haunch, gaskin, cannon
    seg('leg', 'hu' + n, X([0.08, 0.91, 0.37]), X(B.hk), 0.125, 0.064, { sx: 0.62, rs: 9 });
    seg('leg', 'hk' + n, X(B.hk), X(B.hh), 0.054, 0.028, { sx: 0.8 });
    joint('leg', 'hk' + n, X(B.hk), 0.056);
    seg('leg', 'hh' + n, X(B.hh), X([B.hhoof[0], 0.06, B.hhoof[2]]), 0.025, 0.02);
    joint('leg', 'hh' + n, X(B.hh), 0.031);
    hoof('hh' + n, B.hhoof);
  }
  mb.dirt = { y0: 0.22, k: 0.7 };
  mb.aoStrength = 0.28;
  return mb.build();
}

const rigs = new Map();
function getRig(coat) {
  let r = rigs.get(coat);
  if (!r) {
    r = buildDeer(coat);
    rigs.set(coat, r);
  }
  return r;
}

// ------------------------------------------------------------------ animation
const n1 = (t, seed) => noise3(t, seed * 1.7, 0.5, 17) * 2 - 1;
// leg phase offsets (fractions of a cycle): a lateral-sequence walk, and the bound of a whitetail - both hind
// feet, then both fore
const WALK_OFF = { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 };
const RUN_OFF = { LH: 0, RH: 0.07, LF: 0.5, RF: 0.58 };
// (undead) the head and neck charging: down level with the back, the face turned to the ground so the antlers lead
// (the skull ends up where DEER_HEAD.charge has it); and the ram: tossed up and back over RAM_T s
const CHARGE_POSE = { neck: -0.62, neck2: -0.12, head: 0.62 };
const RAM_T = 0.45;
// each leg: its phase offsets and the three bones it bends (built once: posing builds no strings or arrays)
const LEGS = ['LF', 'RF', 'LH', 'RH'].map((key) => {
  const s = key[0];
  const f = key[1] === 'F';
  return { walk: WALK_OFF[key], run: RUN_OFF[key], front: f, side: s, a: (f ? 'fu' : 'hu') + s, b: (f ? 'fl' : 'hk') + s, c: (f ? 'fp' : 'hh') + s };
});

class DeerInstance {
  constructor(coat, seed) {
    const rig = getRig(coat);
    const inst = instantiateRig(rig, getCharacterMaterial(), rig.sphere.radius * 1.7 + 0.4);
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
    this.object.name = 'deer';
    this.object.add(this.mesh);
    const r = (k) => noise3(seed * 0.618 + k * 7.1, k, 0.3, 31);
    this.sd = seed * 0.37;
    this.side = r(1) < 0.5 ? 1 : -1; // the side it falls on
    this.lead = r(2) < 0.5 ? 1 : -1; // which foreleg stands ahead while it grazes
    this.state = DANIM.GRAZE;
    this.stateT = 0;
    this.phase = r(3) * TAU;
    this.undead = !!COATS[coat].undead;
    this.wGraze = 1;
    this.wDead = 0;
    this.wRun = 0;
    this.wMove = 0;
    this.wCharge = 0;
    this.wRam = 0;
    this.speed = 0;
    this.earT = 1 + r(4) * 4;
    this.earSide = 0;
    this.earK = 0;
    this.tailT = 2 + r(5) * 5;
    this.tailK = 0;
    this._seen = true;
    this.mesh.onBeforeRender = () => {
      this._seen = true;
    };
    // the middle of the skull (the sandbox holds it against the server's head sphere)
    this.headCenter = new THREE.Object3D();
    this.headCenter.position.set(SKULL[0] - B.head[0], SKULL[1] - B.head[1], SKULL[2] - B.head[2]);
    this.bones[this.X.head].add(this.headCenter);
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
    this.speed = speed;
    const dead = anim === DANIM.DEAD;
    const moving = anim === DANIM.WALK || anim === DANIM.RUN || ((anim === DANIM.CHARGE || anim === DANIM.ATTACK) && speed > 0.3);
    this.wGraze += ((anim === DANIM.GRAZE ? 1 : 0) - this.wGraze) * Math.min(1, dt * (anim === DANIM.GRAZE ? 3.5 : 7)); // down in under a second, up at once: the head sphere a shot is judged by moves with the state
    this.wDead += ((dead ? 1 : 0) - this.wDead) * Math.min(1, dt * 14);
    this.wRun += (clamp((speed - 2.6) / 3, 0, 1) - this.wRun) * Math.min(1, dt * 6);
    this.wMove += ((moving ? clamp(speed / 0.7, 0, 1) : 0) - this.wMove) * Math.min(1, dt * 7);
    this.wCharge += ((anim === DANIM.CHARGE || anim === DANIM.ATTACK ? 1 : 0) - this.wCharge) * Math.min(1, dt * 9); // (as quick as the head sphere a shot is judged by; the ram hooks up out of the charge)
    this.wRam += ((anim === DANIM.ATTACK ? 1 : 0) - this.wRam) * Math.min(1, dt * 14);
    if (!dead) {
      const stride = lerp(1.25, 4.6, this.wRun); // ground covered per gait cycle
      this.phase = (this.phase + (dt * speed * TAU) / stride) % (TAU * 1000);
    }
    // an ear turns to a sound, the tail flicks
    this.earT -= dt;
    if (this.earT <= 0) {
      this.earT = 1 + Math.random() * 4;
      this.earSide = Math.random() < 0.5 ? 0 : 1;
      this.earK = 1;
    }
    this.earK = Math.max(0, this.earK - dt * 3);
    this.tailT -= dt;
    if (this.tailT <= 0) {
      this.tailT = 2 + Math.random() * 7;
      this.tailK = 1;
    }
    this.tailK = Math.max(0, this.tailK - dt * 1.6);
    setFx(this.fx, 0, this.undead && dead ? Math.max(0.1, 1 - this.stateT * 0.5) : 1); // (an undead one's eyes go out)
    const seen = this._seen;
    this._seen = false;
    if (!seen && !inView) return;
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
    const st = { hy: 0, rootX: 0, rootY: 0 };
    const D = this.wDead;
    if (D < 0.999) this.poseLive(t, 1 - D, st);
    if (D > 0.001) this.poseDead(D, st);
    const bones = this.bones;
    for (let i = 1; i < this.nb; i++) bones[i].rotation.set(this.rx[i], this.ry[i], this.rz[i]);
    bones[this.X.hips].position.set(B.hips[0], B.hips[1] + st.hy, B.hips[2]);
    bones[this.X.root].position.set(st.rootX, st.rootY, 0);
  }

  // standing, walking, bounding (speed-driven), with the head up - or down in the grass (wGraze)
  poseLive(t, W, st) {
    const M = this.wMove;
    const R = this.wRun;
    const G = this.wGraze * (1 - M);
    const ph = this.phase;
    const sd = this.sd;
    const walk = 1 - R;
    const ampF = lerp(0.3, 0.8, R) * M;
    const ampH = lerp(0.28, 0.85, R) * M;
    for (const L of LEGS) {
      const th = ph + TAU * lerp(L.walk, L.run, R);
      const s = Math.sin(th);
      const lift = Math.max(0, Math.cos(th));
      if (L.front) {
        // the knee comes up and forward, the cannon folds back under it
        this.add(L.a, W, s * ampF + lift * lerp(0.12, 0.3, R) * M);
        this.add(L.b, W, lift * lerp(0.35, 0.75, R) * M);
        this.add(L.c, W, -lift * lerp(0.9, 1.9, R) * M);
      } else {
        this.add(L.a, W, s * ampH + lift * lerp(0.1, 0.25, R) * M);
        this.add(L.b, W, -lift * lerp(0.45, 1.0, R) * M);
        this.add(L.c, W, lift * lerp(0.6, 1.2, R) * M);
      }
    }
    // spine: the bound gathers and stretches the body and throws it up off the hind legs; a walk rolls it a little
    const flex = Math.sin(ph + 0.6) * 0.17 * R * M;
    st.hy += (Math.abs(Math.sin(ph)) * 0.012 * walk + (0.5 - 0.5 * Math.cos(ph - 0.9)) * 0.2 * R) * M * W;
    this.add('hips', W, flex + Math.sin(ph - 0.4) * 0.1 * R * M, 0, Math.sin(ph) * 0.035 * walk * M);
    this.add('chest', W, -flex * 1.5, 0, -Math.sin(ph) * 0.03 * walk * M);
    // head and neck: up and watchful, nodding with each stride of a walk, stretched out at a run
    const idle = (1 - M) * (1 - G);
    const lookY = n1(t * 0.22, sd) * 0.5 * idle;
    const lookX = n1(t * 0.17, sd + 3) * 0.12 * idle;
    const nod = Math.sin(ph * 2) * 0.05 * walk * M;
    // (undead) charging, the head and neck go to CHARGE_POSE whatever the gait
    const C = this.wCharge;
    const free = 1 - C;
    this.add('neck', W, lerp(-0.34 * R * M - 0.1 * walk * M + nod + lookX, CHARGE_POSE.neck, C), lookY * 0.4 * free);
    this.add('neck2', W, lerp(-0.22 * R * M + lookX, CHARGE_POSE.neck2, C), lookY * 0.3 * free);
    this.add('head', W, lerp(0.5 * R * M + 0.08 * walk * M - nod * 0.6, CHARGE_POSE.head, C), lookY * 0.4 * free, n1(t * 0.13, sd + 7) * 0.1 * idle * free);
    if (this.undead) this.poseUndead(t, W, st, C, M);
    // grazing: the neck arcs down to the grass, the muzzle works along it, one foreleg set ahead
    if (G > 0.001) {
      const nib = Math.sin(t * 2.4 + sd) * 0.035 + Math.sin(t * 0.9 + sd * 2) * 0.04;
      const sweep = Math.sin(t * 0.35 + sd) * 0.14; // (little: the head stays inside the sphere a shot is judged by)
      this.add('chest', W * G, -0.07);
      this.add('neck', W * G, -1.32 + nib, sweep * 0.5);
      this.add('neck2', W * G, -0.76 + nib, sweep * 0.5);
      this.add('head', W * G, 0.86 - nib * 1.5, 0, 0);
      this.add('jaw', W * G, -(0.04 + Math.max(0, Math.sin(t * 6.5 + sd)) * 0.16));
      this.add(this.lead > 0 ? 'fuR' : 'fuL', W * G, 0.16);
      this.add(this.lead > 0 ? 'fuL' : 'fuR', W * G, -0.1);
    }
    // ears: out to the sides and turning to sounds, laid back at a run
    const turn = this.earK * 0.8 * (1 - R * M);
    this.add('earL', W, 0.75 * R * M, this.earSide === 0 ? turn : 0, -0.25 * R * M + n1(t * 0.5, sd + 11) * 0.12 * idle);
    this.add('earR', W, 0.75 * R * M, this.earSide === 1 ? -turn : 0, 0.25 * R * M - n1(t * 0.5, sd + 13) * 0.12 * idle);
    // tail: down, a flick now and then; up and flagging white at a run
    this.add('tail', W, lerp(0.12 - this.tailK * 0.5, -2.2, R * M), Math.sin(t * 9) * 0.5 * this.tailK * (1 - R * M) + Math.sin(ph) * 0.35 * R * M);
  }

  // (undead) what the dead do on top of the living deer's poses: the jaw hangs, the head jerks now and then; standing
  // with its antlers down it paws the ground; the ram tosses them up and back
  poseUndead(t, W, st, C, M) {
    const sd = this.sd;
    const twitch = Math.max(0, n1(t * 1.3, sd + 21) - 0.55) * 1.1 * (1 - C);
    this.add('neck2', W, twitch * 0.3 * Math.sin(t * 19), 0, twitch * Math.sin(t * 23));
    this.add('jaw', W, -(0.12 + 0.22 * C + 0.1 * this.wRun * M));
    // pawing: the lead foreleg lifts and scrapes back, the body sits back on its haunches
    const paw = C * (1 - M);
    if (paw > 0.001) {
      const s = Math.sin(t * 9 + sd);
      const up = Math.max(0, s);
      const f = this.lead > 0 ? 'R' : 'L';
      this.add('fu' + f, W * paw, -0.25 + s * 0.3);
      this.add('fl' + f, W * paw, up * 0.7);
      this.add('fp' + f, W * paw, -up * 1.2);
      this.add('hips', W * paw, 0.06);
      this.add('chest', W * paw, -0.08);
      st.hy -= 0.035 * paw * W;
    }
    // the ram: the lowered antlers hooked up through whoever they hit, to the head held high, and down again, over
    // RAM_T s from when it got home
    const K = this.wRam;
    if (K > 0.001) {
      const u = this.state === DANIM.ATTACK ? clamp(this.stateT / RAM_T, 0, 1) : 1;
      const toss = Math.sin(Math.PI * Math.sqrt(u)) * K; // (up fast, down slower)
      this.add('neck', W, 0.7 * toss);
      this.add('neck2', W, 0.15 * toss);
      this.add('head', W, -0.6 * toss);
      this.add('chest', W, 0.1 * toss);
      this.add('jaw', W, -0.2 * toss);
    }
  }

  // DEAD: the legs go from under it, it rolls onto its side, a few kicks, then still
  poseDead(W, st) {
    const T = this.stateT;
    const buckle = smooth(clamp(T / 0.3, 0, 1));
    const roll = smooth(clamp((T - 0.12) / 0.5, 0, 1));
    const kick = Math.max(0, 1 - T / 1.8) * Math.sin(T * 21) * 0.22;
    const sg = this.side;
    this.rz[this.X.root] += sg * 1.5 * roll * W;
    st.rootX += sg * 0.62 * roll * W;
    st.rootY += (0.17 * roll - 0.3 * buckle * (1 - roll)) * W;
    this.add('neck', W, -0.95 * roll - 0.2 * buckle, sg * 0.3 * roll);
    this.add('neck2', W, -0.25 * roll);
    this.add('head', W, 0.35 * roll, sg * 0.2 * roll);
    this.add('jaw', W, -0.25 * roll);
    for (const L of LEGS) {
      const k = L.side === 'L' ? kick : -kick;
      if (L.front) {
        this.add(L.a, W, lerp(0.25, 0.4, roll) + k);
        this.add(L.b, W, 0.5 * buckle * (1 - roll) + 0.15 * roll);
        this.add(L.c, W, -1.1 * buckle * (1 - roll) - 0.45 * roll);
      } else {
        this.add(L.a, W, lerp(0.3, -0.25, roll) - k);
        this.add(L.b, W, -0.8 * buckle * (1 - roll) - 0.2 * roll);
        this.add(L.c, W, 0.7 * buckle * (1 - roll) + 0.15 * roll);
      }
    }
    this.add('earL', W, 0.4);
    this.add('earR', W, 0.4);
    this.add('tail', W, 0.2);
  }

  // dead before anyone saw it: lying there, the fall long over
  settle() {
    this.state = DANIM.DEAD;
    this.stateT = 9;
    this.wDead = 1;
    this.wGraze = 0;
    this.pose(0);
  }

  // hoof beats since it was made: two to a bound (the hind pair, then the fore), four to a walking stride
  footfalls() {
    return Math.floor(this.phase / (this.wRun > 0.5 ? Math.PI : Math.PI / 2));
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
export function deerStats() {
  return COATS.map((c, i) => ({ type: 'deer', variant: i, tris: getRig(i).tris, bones: getRig(i).bones.length }));
}

/**
 * A deer view: { object, update(dt, anim, speed, time, inView), footfalls(), settle(), anchorWorld, dispose }. anim is a
 * DANIM state. variant is the server's byte: bit 0 a buck, bit 7 (DEER_UNDEAD) undead, the rest its coat and build.
 */
export function createDeer(variant = 0, seed = 0) {
  const buck = variant & 1;
  const d = new DeerInstance((buck ? 2 : (variant >> 1) & 1) + (variant & DEER_UNDEAD ? 3 : 0), (seed >>> 0) + (variant & 0x7f) * 131);
  // bucks stand a little taller; no two are quite the same size
  d.object.scale.setScalar((buck ? 1.06 : 0.97) + (((variant >> 2) & 15) / 15 - 0.5) * 0.07);
  return {
    object: d.object,
    update: (dt, anim, speed, time, inView) => d.update(dt, anim, speed, time, inView),
    footfalls: () => d.footfalls(),
    settle: () => d.settle(),
    anchorWorld: (a, out) => d.anchorWorld(a, out),
    dispose: () => d.dispose(),
    _inst: d,
  };
}
