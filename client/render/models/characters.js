// Procedural zombie + survivor characters.
// Every character is ONE SkinnedMesh (one draw call) with rigid skinning. Geometry/material are shared
// per type+variant; each instance owns only its Skeleton + bones. Animation is fully procedural and
// writes bone rotations; state changes crossfade from a pose snapshot.
import * as THREE from 'three';
import { ZTYPE, ZOMBIE_DEFS, ZANIM, ITEM, WEAPONS } from '../../../shared/defs.js';
import { CRAWL_HEAD_FWD } from '../../../shared/constants.js';
import { CEMETERY } from '../../../shared/cemetery.js';
import {
  MeshBuilder, instantiateRig, setFx, getCharacterMaterial, getPropMaterial, ikTwoBone, mulberry32, fbm3, noise3,
  clamp, lerp, smooth, color,
} from './skinning.js';
import { CR } from './charTextures.js';
import { createWorldWeapon, getNunchakuGeo } from './weapons.js';
import { createBackpack, WORN_AT } from './backpack.js';
import { createZombieDog, dogStats, DOG_COATS } from './dog.js';
import { buildPerson, deadHead } from './people.js';
import { walkerLook, WALKER_VARIANTS, oldLook, bloodied } from './deadlooks.js';
import {
  hulk, field, ringLoft, limb, bigHand, bigFoot, tornOpen, stitches, chain, blister, rag, shard, strap, surfTube, bound, onSurf, ragPants, angleOn, reweigh,
  jointW, angDiff,
} from './monsters.js';
import { mouthAnchor, surfPoint, headPoint, sheet, headSurface, torsoSurf, bodyBuild } from './humans.js';
import { LOOKS, deadLook, frameOf } from './looks.js';
import { NunchakuTP } from './nunchaku.js';
import { CHARACTERS, CHARACTER_COUNT } from '../../../shared/characters.js';

const PI = Math.PI;
const TAU = PI * 2;
const HALF = PI / 2;

// ------------------------------------------------------------------ humanoid bone layout
const ROOT = 1, HIPS = 2, SPINE = 3, CHEST = 4, NECK = 5, HEAD = 6, JAW = 7;
const CLAV_L = 8, UARM_L = 9, FARM_L = 10, HAND_L = 11;
const CLAV_R = 12, UARM_R = 13, FARM_R = 14, HAND_R = 15;
const THIGH_L = 16, SHIN_L = 17, FOOT_L = 18, THIGH_R = 19, SHIN_R = 20, FOOT_R = 21;


function humanP(o) {
  const P = Object.assign(
    {
      hipY: 0.93, hipW: 0.095, thighLen: 0.43, shinLen: 0.42,
      spineLen: 0.13, chestLen: 0.2, neckOff: 0.2, neckLen: 0.09, headR: 0.11,
      shoulderW: 0.185, shoulderDrop: 0.05, uarmLen: 0.29, farmLen: 0.26, handLen: 0.17,
      depth: 0.13, neckZ: 0, headZ: 0,
    },
    o
  );
  P.thighY = P.hipY - 0.03;
  P.kneeY = P.thighY - P.thighLen;
  P.ankleY = P.kneeY - P.shinLen;
  P.spineY = P.hipY + P.spineLen;
  P.chestY = P.spineY + P.chestLen;
  P.neckY = P.chestY + P.neckOff;
  P.headY = P.neckY + P.neckLen;
  P.shoulderY = P.neckY - P.shoulderDrop;
  P.elbowY = P.shoulderY - P.uarmLen;
  P.wristY = P.elbowY - P.farmLen;
  return P;
}

function addHumanoidBones(mb, P) {
  mb.addBone('root', null, 0, 0, 0);
  mb.addBone('hips', 'root', 0, P.hipY, 0);
  mb.addBone('spine', 'hips', 0, P.spineY, 0);
  mb.addBone('chest', 'spine', 0, P.chestY, 0);
  mb.addBone('neck', 'chest', 0, P.neckY, P.neckZ);
  mb.addBone('head', 'neck', 0, P.headY, P.headZ);
  mb.addBone('jaw', 'head', 0, P.headY + P.headR * 0.42, P.headZ - P.headR * 0.12);
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    mb.addBone('clav' + n, 'chest', s * 0.04, P.shoulderY + 0.01, 0);
    mb.addBone('uarm' + n, 'clav' + n, s * P.shoulderW, P.shoulderY, 0);
    mb.addBone('farm' + n, 'uarm' + n, s * P.shoulderW, P.elbowY, 0);
    mb.addBone('hand' + n, 'farm' + n, s * P.shoulderW, P.wristY, 0);
  }
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    mb.addBone('thigh' + n, 'hips', s * P.hipW, P.thighY, 0);
    mb.addBone('shin' + n, 'thigh' + n, s * P.hipW, P.kneeY, 0);
    mb.addBone('foot' + n, 'shin' + n, s * P.hipW, P.ankleY, 0);
  }
}


function mulColor(hex, k) {
  return color(hex).multiplyScalar(k);
}

// ------------------------------------------------------------------ body part builders


/** Ragged, bloody limb stump with the bone poking out, at the joint of `bone` (hangs along -Y). */
function stump(mb, bone, r, y) {
  mb.ellip(bone, [0, y, 0], [r * 1.05, r * 0.9, r * 1.0], {
    ws: 7, hs: 5, color: 0x5a1210, region: CR.FLESH, mottle: 0.3, noise: r * 0.12, nf: 60, blood: false,
  });
  mb.spike(bone, [0, y - r * 0.3, 0.003], [r * 0.12, y - r * 2.1, -0.004], r * 0.34, { rs: 5, color: 0xd8ccb0, region: CR.BONE, blood: false });
  // dangling sinew
  mb.tube(bone, [[-r * 0.4, y - r * 0.5, -r * 0.2], [-r * 0.5, y - r * 1.3, -r * 0.1], [-r * 0.3, y - r * 2.0, 0]], r * 0.13, r * 0.05, { rs: 4, ts: 3, color: 0x6a1a18, region: CR.FLESH, blood: false });
}


/**
 * What a leg shot off at the knee leaves: a stump under each thigh, on a bone of its own so that it can be kept
 * scaled away until the shin goes (ZombieInstance.setLegs).
 */
function legStumps(mb, P, L) {
  const r = (L.thighR || 0.078) * 0.7;
  mb.shin = L.pants && !L.pants.shorts ? L.pants.color : L.skin; // what the shin that flies off is wearing
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    mb.addBone('stump' + n, 'thigh' + n, s * P.hipW, P.kneeY, 0);
    stump(mb, 'stump' + n, r, 0.012);
  }
}

// ------------------------------------------------------------------ zombie looks
const PANTS = [0x3b4a63, 0x7d7055, 0x262626, 0x4a3a2a, 0x55555a, 0x2f3d52];


// ------------------------------------------------------------------ type builders

/**
 * A whole dead person (people.js) on the humanoid rig, with the stumps a shot-off leg leaves. L: a look (deadlooks.js)
 * or the keys the specials were written with before (oldLook). Returns people.js's { H, T, arms, legs, B, L }.
 */
function standardHumanoid(mb, P, L, detail = buildDetail, prep = null) {
  addHumanoidBones(mb, P);
  const NL = L.dead ? L : oldLook(L);
  mb.dirt = NL.dirt || { y0: 0.4, k: 0.5 };
  // (prep: what must be made on the trunk before its skin is - a wound, whose hole the skin and the clothes are cut by)
  if (prep && detail >= 0.7) prep(torsoSurf(mb, P, bodyBuild(NL)));
  const built = buildPerson(mb, P, NL, detail);
  built.L = NL;
  legStumps(mb, P, NL);
  return built;
}

/** A flank torn open: bone ribs over a wound in the side of the chest (built: standardHumanoid's). */
function exposedRibs(mb, P, side, y0, n, built) {
  const chestY = P.chestY, cb = mb.bonePos('chest');
  for (let i = 0; i < n; i++) {
    const y = chestY + y0 + i * 0.034;
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const p = surfPoint(built.T, side * (0.5 + k * 0.28), y - k * 0.006, 0.003);
      pts.push([p[0] - cb[0], p[1] - cb[1], p[2] - cb[2]]);
    }
    mb.tube('chest', pts, 0.0085, 0.007, { rs: 4, ts: 4, color: 0xd8ccb0, region: CR.BONE, blood: false, cap: false });
  }
  const L = built.L;
  const c = surfPoint(built.T, side * 1.0, chestY + y0 + n * 0.017, 0);
  (L.wounds || (L.wounds = [])).push([c[0], c[1], c[2], 0.1]);
}

function buildWalker(v) {
  const L = walkerLook(v);
  const f = L.sex === 'f';
  const P = humanP({ headR: f ? 0.098 : 0.102, neckLen: 0.1, ...(f ? { shoulderW: 0.172, hipW: 0.1, uarmLen: 0.28, farmLen: 0.25 } : null) });
  const mb = new MeshBuilder();
  // (the wound in the side, before the body is built: its tint goes on as the skin is made)
  if (v % 3 === 0) L.wounds = [...(L.wounds || []), [0.07, P.spineY + 0.03, -0.1, 0.06]];
  const built = standardHumanoid(mb, P, L);
  if (L.gaunt > 0.85 && !L.top) exposedRibs(mb, P, v % 2 ? 1 : -1, -0.06, 4, built);
  return { mb, P, A: L.jawHang ? { jawHang: L.jawHang } : null };
}

function buildRunner(v) {
  const P = humanP({ hipY: 0.94, thighLen: 0.44, shinLen: 0.43, spineLen: 0.12, chestLen: 0.19, neckOff: 0.19, headR: 0.104, shoulderW: 0.17, uarmLen: 0.31, farmLen: 0.28, handLen: 0.18 });
  const rnd = mulberry32(2000 + v * 31);
  const L = {
    skin: [0x8a8a7e, 0x7a8470, 0x8c8078][v % 3], skinRegion: CR.GORE, gaunt: 0.95, ribs: 1, armR: 0.038, thighR: 0.068, neckR: 0.04, chestR: 0.148,
    shirt: v % 2 === 0 ? { color: v === 0 ? 0x8a8472 : 0x5a2a24, type: 'tank', tear: 0.4, seed: 71 + v, rags: 4, hem: 0.0 } : null,
    pants: { color: PANTS[(v + 2) % PANTS.length], region: CR.DENIM, tearY: 0.35 + rnd() * 0.1 },
    shoes: null, hair: { color: 0x1a1410, patchy: 0.55, cover: 0.5 },
    eye: 0xe0d890, eyeGlow: 0.3, socket: 0.22, fingerMul: 1.15, claws: 0.02, curl: 0.7,
    blood: [[[0, 1.5, -0.1], 0.12, 1], [[0.05, 1.2, -0.13], 0.15, 1], [[-0.1, 0.95, -0.1], 0.1, 1], [[0.17, 0.8, 0], 0.08, 1]],
    missingTeeth: 0x12, fang: true,
    ...[{ cheekTear: 1 }, { skullPatch: [-0.3, 0.8, 0.35, 0.6] }, { oneEye: -1, noEar: 1, jawHang: 0.25 }][v % 3],
  };
  const mb = new MeshBuilder();
  const built = standardHumanoid(mb, P, L);
  exposedRibs(mb, P, -1, -0.07, 4, built);
  return { mb, P, A: L.jawHang ? { jawHang: L.jawHang } : null };
}

/** A wound's paint on a person's skin (people.js skinTint works in model space): only on the trunk, between heights. */
const ripTint = (T, rip, y0, y1, xw) => (p, n, c) => {
  if (p.y > y0 && p.y < y1 && Math.abs(p.x) < xw) rip.paint(angleOn(T, p.x, p.y, p.z), p.y, c);
};

/**
 * The spitter: starved to a rake, all of it gone into the acid it carries. A long neck with a pouch of the stuff hung
 * under the jaw from chin to collarbone, lit from inside; a jaw eaten loose; the front of its shirt and the chest under
 * it burned through to the breastbone by what it drools; a little round belly full of more.
 */
function buildSpitter() {
  const P = humanP({ hipY: 1.0, thighLen: 0.47, shinLen: 0.46, spineLen: 0.14, chestLen: 0.2, neckOff: 0.17, neckLen: 0.24, headR: 0.1, shoulderW: 0.165, uarmLen: 0.34, farmLen: 0.31, handLen: 0.19, neckZ: 0.0, headZ: -0.02 });
  const far = buildDetail < 0.7;
  const scald = (p, n, c) => {
    // acid burns: yellowed, blistered patches, worst down the front
    const m = fbm3(p.x * 12, p.y * 12, p.z * 12, 2, 3);
    if (m > 0.6) c.lerp(color(0x9ab040), Math.min(0.6, (m - 0.6) * 5));
    if (p.z < -0.02 && p.y > 0.9 && p.y < 1.55) c.lerp(color(0x8a7a2a), clamp((1.55 - p.y) * 0.5 * (0.5 + m), 0, 0.4));
  };
  const L = {
    dead: true, skin: 0x8c9670, eye: 0xb8ff60, eyeGlow: 0.9, noBrows: true,
    face: { sockets: 1.85, gaunt: 1, rot: 0.8, w: 0.95, h: 1.12, jaw: 1.1, chin: 1.15, lips: 0.4 },
    gaunt: 1, build: { w: 0.92, arm: 0.8, leg: 0.82, neck: 0.78, belly: 1.3 },
    top: { kind: 'tee', color: 0x6c6c5a, region: CR.COTTON, sleeves: 'short', tear: 0.3, hem: 0.09, tint: bloodied(7, 0.4, (p, n, c) => p.z < 0 && Math.abs(p.x) < 0.1 && c.lerp(color(0x4a4a1a), clamp((1.5 - p.y) * 1.6, 0, 0.75))) },
    pants: { color: 0x3a3a34, region: CR.TWILL, tear: 0.15, tearY: 0.22, tint: bloodied(9, 0.5) },
    shoes: null, hair: null,
    fingerMul: 1.25, claws: 0.02, curl: 0.6, jawScale: 1.1, missingTeeth: 0x21, cheekTear: -1,
    blood: [[[0, 1.62, -0.12], 0.1, 0.6]], dirt: { y0: 0.4, k: 0.5 }, skinTint: scald,
  };
  const mb = new MeshBuilder();
  const yC = P.chestY;
  const built = standardHumanoid(mb, P, L, buildDetail, (T) => {
    // burned through to the breastbone
    const rip = tornOpen(mb, T, -0.5, 0.42, yC + 0.0, yC + 0.15, { ribs: 4, r: 0.0055, depth: 0.012, nu: 7, nv: 7, rag: 0.45, flesh: 0x5a3a14, rim: 0x6a6a1a, slope: 0.3, seed: 4 });
    L.hole = rip.fn;
    const rt = ripTint(T, rip, yC - 0.06, yC + 0.2, 0.14);
    L.skinTint = (p, n, c) => {
      scald(p, n, c);
      rt(p, n, c);
    };
  });
  // the pouch (own bone for pulsing): from under the jaw to the collarbones, in lobes
  mb.addBone('sac', 'neck', 0, P.neckY + P.neckLen * 0.5, -0.03);
  const nY = P.neckY, hY = P.headY;
  const veined = (p, n, c) => {
    if (fbm3(p.x * 40, p.y * 40, p.z * 40, 2, 5) < 0.4) c.lerp(color(0x3a5a18), 0.6);
    if (Math.abs(fbm3(p.x * 22, p.y * 9, p.z * 22, 2, 15) - 0.5) < 0.03) c.lerp(color(0x1e3a10), 0.8);
  };
  ringLoft(mb, 'sac', [
    { c: [0, hY - 0.005, -0.05], rx: 0.028, ry: 0.024 }, { c: [0, hY - 0.05, -0.082], rx: 0.066, ry: 0.058 }, { c: [0, lerp(nY, hY, 0.45), -0.108], rx: 0.1, ry: 0.088 },
    { c: [0, nY + 0.03, -0.108], rx: 0.094, ry: 0.08 }, { c: [0, nY - 0.04, -0.09], rx: 0.045, ry: 0.036 },
  ], {
    nu: far ? 7 : 12, sub: far ? 1 : 3, up: [0, 0, -1], color: 0x9cff48, region: CR.GLOW, glow: 0.7, mottle: 0.2, blood: false, ao: false, cap0: 0.01, cap1: 0.012, tint: veined,
    dr: (s, a) => 0.009 * Math.sin(a * 3 + 1) * Math.sin(s * PI) + 0.006 * Math.sin(s * 14),
  });
  if (!far) {
    bound(mb, [mb.bi('sac'), 1, 0, 0], () => {
      for (const s of [-1, 1]) mb.ellip('root', [s * 0.058, lerp(nY, hY, 0.3), -0.058], [0.04, 0.056, 0.042], { ws: 8, hs: 6, color: 0x8cf040, region: CR.GLOW, glow: 0.55, blood: false, ao: false, tint: veined });
      mb.ellip('root', [0.03, nY + 0.0, -0.1], [0.03, 0.036, 0.028], { ws: 7, hs: 5, color: 0x8cf040, region: CR.GLOW, glow: 0.6, blood: false, ao: false, tint: veined });
    });
    // what it drools: strands off the jaw, and the runs of it down its front
    const jb = mb.bonePos('jaw'), hb = mb.bonePos('head');
    const wet = { color: 0x9ae040, glow: 0.45, region: CR.GLOW, blood: false, ao: false };
    bound(mb, [mb.bi('jaw'), 1, 0, 0], () => {
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 0.022, y0 = hb[1] + P.headR * 0.15, z0 = hb[2] - P.headR * 0.82;
        mb.tube('root', [[x, y0, z0], [x * 1.2, y0 - 0.05 - i * 0.02, z0 - 0.006], [x * 1.3, y0 - 0.1 - i * 0.035, z0 + 0.004]], 0.0045, 0.0015, { rs: 4, ts: 3, ...wet });
        mb.ellip('root', [x * 1.3, y0 - 0.105 - i * 0.035, z0 + 0.004], [0.006, 0.009, 0.006], { ws: 5, hs: 3, ...wet });
      }
      void jb;
    });
    surfTube(mb, built.T, [[0.1, yC + 0.2], [0.14, yC + 0.1], [0.08, yC - 0.02], [0.12, yC - 0.14]], 0.006, 0.003, { ...wet, glow: 0.35, ts: 8 });
    surfTube(mb, built.T, [[-0.3, yC + 0.18], [-0.22, yC + 0.02], [-0.3, yC - 0.1]], 0.005, 0.0025, { ...wet, glow: 0.35, ts: 6 });
    // blisters of it up the back and over the shoulders: what shows of a spitter from behind, in the dark
    const rnd = mulberry32(31);
    for (let i = 0; i < 9; i++) blister(mb, built.T, PI + (rnd() - 0.5) * 2.4, P.spineY + rnd() * (P.shoulderY - P.spineY), 0.014 + rnd() * 0.014, 0.7, { color: 0xa8f048, glow: 0.5, rim: 0x5a5a1a, ws: 6, hs: 4 });
  }
  return { mb, P, A: { jawHang: 0.3 } };
}

/**
 * The leaper: somebody young in a hooded top who now goes on all fours. All sinew - forearms and shins too long, the
 * hands and feet grown into hooks - the hood still up over a face that is eyes and teeth, the back of the top split
 * open down a spine that has grown spurs.
 */
function buildLeaper() {
  const P = humanP({ hipY: 0.98, hipW: 0.1, thighLen: 0.46, shinLen: 0.46, spineLen: 0.13, chestLen: 0.19, neckOff: 0.18, neckLen: 0.1, headR: 0.1, shoulderW: 0.17, uarmLen: 0.36, farmLen: 0.35, handLen: 0.2 });
  const far = buildDetail < 0.7;
  const hoodC = 0x2c3a2e, skinC = 0x8e8e84;
  const L = {
    dead: true, skin: skinC, eye: 0xffe070, eyeGlow: 0.9, noBrows: true,
    face: { sockets: 1.9, gaunt: 1, rot: 0.6, lips: 0.3, jaw: 1.1, cheek: 1.3 },
    gaunt: 0.9, build: { w: 0.94, arm: 0.86, leg: 0.88, neck: 0.85 },
    top: { kind: 'hoodie', color: hoodC, region: CR.FLEECE, sleeves: 'long', tear: 0.24, hem: 0.03, collar: 'crew', backOpen: true, loose: 0.004, tint: bloodied(7, 0.6) },
    pants: { color: 0x2a2a2c, region: CR.TWILL, tear: 0.2, tearY: 0.3, tint: bloodied(9, 0.5) },
    shoes: null, hair: null, fingerMul: 1.3, claws: 0.035, curl: 1.1, fang: true, missingTeeth: 0x08,
    noHands: !far, noFeet: !far,
    blood: [[[0, 1.5, -0.1], 0.1, 1], [[0.2, 0.7, -0.05], 0.1, 0.8]], dirt: { y0: 0.45, k: 0.7 },
  };
  const mb = new MeshBuilder();
  const built = standardHumanoid(mb, P, L);
  const { H, T } = built;
  const hr = P.headR;
  const head = mb.bi('head'), jaw = mb.bi('jaw');
  // the hood, up: a shell round the head, open over the face, peaked at the back
  {
    const depth = (phi, lam) => Math.hypot(phi / 0.86, (lam + 0.1) / 0.8) - 1;
    const push = (phi, lam) => hr * (0.17 + 0.16 * smooth((Math.abs(phi) - 1.0) / 1.6) + 0.1 * Math.max(0, Math.sin(lam)) + 0.1 * smooth(-lam - 0.5));
    const { geo, wts } = headSurface(H, far ? 14 : 24, far ? 9 : 14, head, jaw, { depth }, push);
    for (let i = 0; i < wts.length; i += 4) {
      wts[i + 1] = 1;
      wts[i + 3] = 0;
    }
    mb.geom('head', geo, { color: hoodC, region: CR.FLEECE, mottle: 0.2, double: true, keepNormals: true, wts, tint: (p, n, c) => p.z > 0 && c.multiplyScalar(0.9) });
    // its hem round the face
    const pts = [], hp = new THREE.Vector3();
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * TAU;
      const phi = Math.sin(a) * 0.88, lam = -0.1 + Math.cos(a) * 0.82;
      headPoint(H, phi, lam, hp);
      const r = Math.hypot(hp.x, hp.y - H.cy, hp.z), k = 1 + (push(phi, lam) + 0.004) / r;
      pts.push([hp.x * k, H.cy + (hp.y - H.cy) * k, hp.z * k - hr * 0.06]);
    }
    if (!far) mb.tube('head', pts, hr * 0.085, hr * 0.085, { rs: 5, ts: 26, color: mulColor(hoodC, 0.8), region: CR.FLEECE, cap: false });
  }
  // ...and its skirts on the shoulders
  mb.lathe('neck', [0, 0, 0.012], [[0.105, -0.07], [0.112, -0.01], [0.098, 0.06], [0.088, 0.1]], { rs: far ? 8 : 12, sx: 1.42, sz: 1.22, color: hoodC, region: CR.FLEECE, double: true, mottle: 0.2 });
  if (!far) {
    const skinT = (p, n, c) => fbm3(p.x * 9, p.y * 9, p.z * 9, 2, 33) > 0.6 && c.lerp(color(0x4a3040), 0.3);
    for (const s of [-1, 1]) {
      const n = s < 0 ? 'L' : 'R';
      bigHand(mb, 'hand' + n, s, { scale: 1.3, curl: 0.85, spread: 1.2, fingerMul: 1.35, claws: 0.05, skin: skinC, region: CR.ROT, tint: skinT });
      bigFoot(mb, 'foot' + n, s, { w: 1.1, l: 1.45, h: 1.05, skin: skinC, region: CR.ROT, tint: skinT, claws: 0.035 });
    }
    // the spine, through the split in the back of the top: a spur a vertebra
    for (let i = 0; i < 10; i++) {
      const y = P.hipY + 0.06 + i * 0.047;
      const a = surfPoint(T, PI, y, -0.006);
      const len = 0.03 + 0.022 * Math.sin((i / 9) * PI);
      shard(mb, T.wts(y, 0), a, [0, a[1] + len * 0.5, a[2] + len], 0.013, { rs: 4, color: 0xb8ac8c });
    }
  }
  return { mb, P };
}

/**
 * The roper: a big man in a work shirt, and what he throws is his own tongue - metres of it, kept wound in loops
 * round his neck and down one arm like a line on a dock. The neck is swollen to hold its root and the jaw has come
 * apart to let it out; its end hangs out of the mouth to his chest.
 */
function buildRoper() {
  const P = humanP({ hipY: 1.0, thighLen: 0.46, shinLen: 0.46, spineLen: 0.14, chestLen: 0.22, neckOff: 0.2, neckLen: 0.1, headR: 0.12, shoulderW: 0.2, uarmLen: 0.33, farmLen: 0.3, handLen: 0.19 });
  const far = buildDetail < 0.7;
  const L = {
    dead: true, skin: 0x8e8672, eye: 0xe0e0c0, eyeGlow: 0.25, noBrows: true,
    face: { sockets: 1.8, gaunt: 0.5, rot: 0.6, w: 1.1, jaw: 1.5, chin: 1.25, lips: 0.3, nose: 0.6 },
    gaunt: 0.3, build: { w: 1.14, d: 1.12, arm: 1.12, leg: 1.04, neck: 1.5, belly: 0.35 },
    top: { kind: 'shirt', color: 0x54483c, region: CR.CANVAS, sleeves: 'rolled', tear: 0.26, open: 0.34, under: { color: 0x8a8672, region: CR.COTTON }, collar: 'shirt', hem: 0.05, tint: bloodied(7, 0.7) },
    pants: { color: 0x2f3440, region: CR.DENIM, tear: 0.14, tearY: 0.12, tint: bloodied(9, 0.5) },
    shoes: { kind: 'work', color: 0x30261c }, hair: { style: 'balding', color: 0x2a2018 },
    jawScale: 1.45, fang: true, missingTeeth: 0x42, cheekTear: 1, curl: 0.6,
    blood: [[[0, 1.6, -0.14], 0.14, 1], [[0, 1.4, -0.16], 0.12, 0.9]], dirt: { y0: 0.4, k: 0.6 },
  };
  const mb = new MeshBuilder();
  const built = standardHumanoid(mb, P, L);
  const { T, arms } = built;
  const tongue = (bone, pts, r0, r1, o = {}) => limb(mb, bone, pts, pts.map((_, i) => lerp(r0, r1, i / (pts.length - 1))), {
    nu: far ? 5 : 7, sub: far ? 1 : 2, color: 0x8e3440, region: CR.FLESH, mottle: 0.25, blood: false, flat: 0.8,
    paint: (s, a, c) => {
      c.multiplyScalar(0.8 + 0.2 * Math.sin(s * 60)); // ringed like a worm
      if (Math.cos(a) < -0.3) c.lerp(color(0xb8787a), 0.4); // paler underneath
    },
    ...o,
  });
  // loops of it round the neck, thrown over the left shoulder
  const nY = P.neckY, ySh = P.shoulderY;
  const turns = far ? 2 : 3;
  const coil = [];
  for (let i = 0; i <= turns * 8; i++) {
    const a = (i / 8) * TAU + 0.6, u = i / (turns * 8);
    const y = nY + 0.085 - u * 0.1 + 0.008 * Math.sin(a * 2);
    const r = 0.082 + u * 0.03;
    coil.push([Math.sin(a) * r * 1.05, y, -Math.cos(a) * r + 0.012]);
  }
  tongue('neck', coil, 0.021, 0.025, { cap0: 0.02 });
  const sh = surfPoint(T, -1.45, ySh + 0.045, 0.03);
  const drape = [coil[coil.length - 1], [sh[0] * 0.75, ySh + 0.07, sh[2] - 0.05], [sh[0] - 0.01, sh[1] + 0.012, sh[2] + 0.01], surfPoint(T, PI + 0.9, ySh - 0.06, 0.03), surfPoint(T, PI + 0.6, P.chestY + 0.02, 0.03), surfPoint(T, PI + 1.3, P.chestY - 0.1, 0.03), surfPoint(T, -1.2, P.chestY - 0.13, 0.035), surfPoint(T, -0.5, P.chestY - 0.06, 0.035)];
  tongue('chest', drape, 0.025, 0.02, { cap1: 0.02, wts: (p) => T.wts(clamp(p[1], T.yLo, T.yHi), p[0]) });
  // ...and more wound down the left forearm, the way a man carries a line
  if (!far) {
    const A = arms[0];
    const wrap = [];
    for (let i = 0; i <= 22; i++) {
      const u = i / 22;
      wrap.push(surfPoint(A, u * TAU * 2.75 + 1, lerp(A.yE - 0.03, A.yW + 0.035, u), 0.017));
    }
    tongue('farmL', wrap, 0.017, 0.015, { cap0: 0.012, cap1: 0.012, sub: 1 });
  }
  // the throat swollen round its root
  blister(mb, built.T, 0, nY + 0.0, 0.07, 0.75, { color: 0x8a6a62, glow: 0, region: CR.TUMOR, rim: 0x6a3a3a, ws: far ? 6 : 9, hs: far ? 4 : 6, tall: 1.2 });
  // its end, out of the mouth and down to the chest (on the jaw: it swings as the mouth works)
  const hb = mb.bonePos('head');
  const m0 = [0, hb[1] + P.headR * 0.42, hb[2] - P.headR * 0.5];
  tongue('jaw', [m0, [0.004, m0[1] - 0.012, m0[2] - 0.075], [0.012, m0[1] - 0.075, m0[2] - 0.098], [0.02, m0[1] - 0.17, m0[2] - 0.088], [0.012, m0[1] - 0.25, m0[2] - 0.07], [0.0, m0[1] - 0.3, m0[2] - 0.075]], 0.024, 0.009, { cap1: 0.02, nu: far ? 5 : 8 });
  return { mb, P, A: { jawHang: 0.38 } };
}

/**
 * The Shade: a starved, ash-dark silhouette that the night swallows whole (a beam shows it grey as a statue). What
 * gives it away in the dark are the pale eyes, the veins of cold light under its skin - faint while it stalks, flaring
 * when a light pins it (ZombieInstance.hold) - and the same light in the cage of its ribs, where its chest has opened.
 */
function buildShade() {
  const P = humanP({ hipY: 1.06, hipW: 0.09, thighLen: 0.5, shinLen: 0.49, spineLen: 0.15, chestLen: 0.2, neckOff: 0.18, neckLen: 0.14, headR: 0.098, shoulderW: 0.16, uarmLen: 0.4, farmLen: 0.41, handLen: 0.23, headZ: -0.015 });
  const far = buildDetail < 0.7;
  const ash = color(0x5c5a68);
  const ashen = (p, n, c) => {
    if (fbm3(p.x * 16, p.y * 16, p.z * 16, 2, 9) > 0.6) c.lerp(ash, 0.55);
  };
  const skinC = 0x34323b;
  const L = {
    dead: true, skin: skinC, eye: 0xe6eeff, eyeGlow: 1.3, noBrows: true,
    face: { sockets: 2.2, gaunt: 1, rot: 0.9, w: 0.92, h: 1.16, jaw: 1.1, chin: 1.3, lips: 0.2, noNose: true, nose: 0 },
    gaunt: 1, build: { w: 0.87, arm: 0.7, leg: 0.72, neck: 0.7 },
    top: null, pants: { color: 0x131317, region: CR.CLOTH, tear: 0.2, tearY: 0.55, belt: false }, shoes: null, hair: null,
    fingerMul: 1.7, claws: 0.06, curl: 0.8, jawScale: 1.15, fang: true, missingTeeth: 0x24, noHands: !far,
    blood: [], dirt: { y0: 0, k: 0 }, skinTint: ashen, headTint: (lx, ly, lz, c) => ashen({ x: lx, y: ly, z: lz }, null, c),
  };
  const mb = new MeshBuilder();
  const yC = P.chestY;
  const built = standardHumanoid(mb, P, L, buildDetail, (T) => {
    // the chest come open down the breastbone: the ribs a cage, the cold light inside it
    const rip = tornOpen(mb, T, -0.52, 0.52, yC - 0.05, yC + 0.13, { ribs: 5, r: 0.0058, depth: 0.03, nu: 8, nv: 8, rag: 0.3, flesh: 0x9db4ff, glow: 0.6, rim: 0x14131a, bone: 0x2a2930, slope: 0, seed: 9 });
    L.hole = rip.fn;
    const rt = ripTint(T, rip, yC - 0.1, yC + 0.2, 0.14);
    L.skinTint = (p, n, c) => {
      ashen(p, n, c);
      rt(p, n, c);
    };
  });
  const light = { rs: 3, color: 0x9db4ff, region: CR.GLOW, glow: 0.55, blood: false, ao: false, cap: false };
  const vein = (S, pts, r = 0.0045) => surfTube(mb, S, pts.map(([t, y]) => [t, y, 0.003]), r, r * 0.35, { ...light, ts: pts.length * (far ? 1 : 2) });
  const { T, H } = built;
  const yS = P.spineY, yH = P.hipY, ySh = P.shoulderY;
  // veins of it: out from the chest over the shoulders and down the belly, down each limb, up the throat
  vein(T, [[0.5, yC + 0.12], [0.7, yC + 0.07], [1.0, yC + 0.1], [1.3, yC + 0.06]], 0.005);
  vein(T, [[-0.5, yC + 0.12], [-0.75, yC + 0.15], [-1.05, yC + 0.11], [-1.35, yC + 0.14]], 0.005);
  vein(T, [[0.12, yC - 0.06], [-0.1, yS + 0.08], [0.14, yS - 0.02], [-0.06, yH + 0.06]], 0.006);
  if (!far) {
    vein(T, [[-0.1, yS + 0.08], [-0.6, yS + 0.03], [-1.0, yS + 0.06]]);
    vein(T, [[0.14, yS - 0.02], [0.6, yS - 0.05], [0.95, yH + 0.1]]);
    vein(T, [[PI - 0.3, ySh - 0.02], [PI - 0.15, yC + 0.05], [PI - 0.35, yC - 0.05], [PI - 0.2, yS]]);
    vein(T, [[PI + 0.35, ySh - 0.04], [PI + 0.2, yC], [PI + 0.4, yS + 0.05]]);
    vein(built.N, [[0.5, P.neckY + 0.01], [0.3, P.neckY + 0.07], [0.55, P.neckY + 0.14]], 0.004);
    vein(built.N, [[-0.6, P.neckY + 0.0], [-0.4, P.neckY + 0.1]], 0.004);
  }
  const hp = new THREE.Vector3();
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const A = built.arms[s < 0 ? 0 : 1], Lg = built.legs[s < 0 ? 0 : 1];
    vein(A, [[0.1, A.yS - 0.05], [-0.1, A.yS - 0.17], [0.08, A.yS - 0.27], [s * 0.3, A.yE - 0.02]]);
    vein(A, [[0, A.yE - 0.04], [s * 0.15, A.yE - 0.16], [-s * 0.1, A.yE - 0.26], [s * 0.1, A.yW + 0.04]]);
    if (!far) vein(Lg, [[s * 0.4, Lg.yK + 0.12], [s * 0.2, Lg.yK - 0.02], [s * 0.5, Lg.yK - 0.16], [s * 0.3, Lg.yK - 0.3], [s * 0.45, Lg.yA + 0.06]]);
    // tear tracks of light running down from the eyes
    const track = [];
    for (const [a, l] of [[0.42, 0.06], [0.52, -0.12], [0.5, -0.3], [0.42, -0.5]]) {
      headPoint(H, s * a, l, hp);
      track.push([hp.x, hp.y, hp.z - 0.001]);
    }
    mb.tube('head', track, 0.004, 0.0014, { ...light, ts: 8 });
    if (!far) bigHand(mb, 'hand' + n, s, { scale: 1.12, curl: 0.55, spread: 1.25, fingerMul: 1.95, claws: 0.075, skin: skinC, region: CR.ROT, tint: ashen, nail: 0x0c0c10 });
  }
  // the spine: a ridge of bone spurs down the back
  for (let i = 0; i < (far ? 5 : 9); i++) {
    const y = P.chestY - 0.07 + i * (far ? 0.055 : 0.032);
    const a = surfPoint(T, PI, y, -0.008);
    const len = 0.045 + 0.03 * Math.sin((i / (far ? 4 : 8)) * PI);
    shard(mb, T.wts(y, 0), a, [0, a[1] + len * 0.6, a[2] + len], 0.012, { rs: 4, color: 0x24232a });
  }
  // what is left of a shroud: tatters off the shoulders, the forearms and the waist
  const rnd = mulberry32(4107);
  const cloth = { color: 0x0b0b0e, region: CR.CLOTH, blood: false, sway: 0.03 };
  for (let i = 0; i < (far ? 5 : 9); i++) {
    const t = (i / (far ? 5 : 9)) * TAU + rnd() * 0.4;
    rag(mb, 'hips', surfPoint(T, t, yH + 0.05, 0.012), 0.3 + rnd() * 0.3, 0.05 + rnd() * 0.04, -t, { ...cloth, seed: i + 1, nv: far ? 2 : 4 });
  }
  if (!far) {
    for (const s of [-1, 1]) {
      const A = built.arms[s < 0 ? 0 : 1], n = s < 0 ? 'L' : 'R';
      for (let i = 0; i < 3; i++) rag(mb, 'farm' + n, surfPoint(A, PI + (i - 1) * 0.7, A.yE - 0.06 - i * 0.09, 0.004), 0.26 + rnd() * 0.2, 0.04 + rnd() * 0.02, PI + (i - 1) * 0.7, { ...cloth, seed: i + 20 + s, nv: 4 });
      for (let i = 0; i < 2; i++) rag(mb, 'chest', surfPoint(T, PI + s * (0.7 + i * 0.5), ySh + 0.02, 0.008), 0.34 + rnd() * 0.26, 0.06 + rnd() * 0.03, PI + s * (0.7 + i * 0.5), { ...cloth, seed: i + 30 + s, nv: 4 });
    }
  }
  return { mb, P, A: { jawHang: 0.5 } };
}

// ------------------------------------------------------------------ the swollen: boomer and Bloater
// gas-green skin gone livid in patches, a marbling of dark veins running down it, the stretched underside bruised
const swollen = (seed, f = 7) => (p, n, c) => {
  const m = fbm3(p.x * f, p.y * f, p.z * f, 2, seed);
  if (m > 0.58) c.lerp(color(0x566f22), Math.min(0.6, (m - 0.58) * 5));
  if (m < 0.34) c.lerp(color(0x7a4a52), Math.min(0.45, (0.34 - m) * 5));
  c.lerp(color(0x4a3a30), clamp(-n.y * 0.5, 0, 0.35));
};
const marbled = (seed, w = 0.022) => (t, y, c) => {
  const v = fbm3(Math.cos(t) * 2.6 + seed, y * 1.1, Math.sin(t) * 2.6, 3, seed);
  if (Math.abs(v - 0.5) < w) c.lerp(color(0x24401a), 0.75);
  const v2 = fbm3(Math.cos(t) * 5 + seed, y * 2.4, Math.sin(t) * 5, 2, seed + 9);
  if (Math.abs(v2 - 0.52) < w * 0.6) c.lerp(color(0x3a2a48), 0.6);
};
/** Blisters scattered over a patch of S: n of them between the angles and heights given, biggest first. */
function pox(mb, S, rnd, n, t0, t1, y0, y1, r0, r1, o) {
  for (let i = 0; i < n; i++) {
    const t = lerp(t0, t1, rnd()), y = lerp(y0, y1, rnd());
    const r = lerp(r1, r0, rnd() * rnd());
    blister(mb, S, t, y, r, 0.6, { color: rnd() < 0.5 ? 0xd8d070 : 0xc4c462, glow: (o.glow ?? 0.2) * (0.6 + rnd() * 0.8), rim: 0x8a3024, ws: o.ws || 7, hs: o.hs || 5 });
  }
}
/** A split in swollen skin on S: a slit standing open from (t, y0) to (t, y1), what is under it glowing through. */
function split(mb, S, t, y0, y1, w, o = {}) {
  const n = 5;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pts.push(surfPoint(S, t + (o.wander || 0) * Math.sin(u * 5 + t * 7), lerp(y0, y1, u), -w * 0.3));
  }
  onSurf(mb, S, () => {
    ringLoft(mb, 'root', pts.map((c, i) => ({ c, rx: w * (0.25 + Math.sin((i / n) * PI) * 0.75), ry: w * 0.55 })), { nu: 6, sub: 1, up: [Math.sin(t), 0, -Math.cos(t)], color: o.color ?? 0xb8e050, region: CR.GLOW, glow: o.glow ?? 0.45, mottle: 0.2, blood: false, cap0: w * 0.5, cap1: w * 0.5, tint: (p, nn, c) => c.lerp(color(0x6a1a12), clamp(Math.abs(nn.x * Math.cos(t) + nn.z * Math.sin(t)) * 1.5 - 0.3, 0, 0.9)) });
  });
}

/**
 * The boomer: a corpse blown up tight with gas and bile, about to go. A drum of a belly that has ridden its undershirt
 * up to the chest and burst its fly, the skin stretched thin and green over it and split where it could not stretch,
 * the neck and face swollen shut round small eyes.
 */
function buildBoomer() {
  const P = humanP({ hipY: 0.88, hipW: 0.13, thighLen: 0.4, shinLen: 0.4, spineLen: 0.14, chestLen: 0.22, neckOff: 0.2, neckLen: 0.06, headR: 0.12, shoulderW: 0.27, uarmLen: 0.28, farmLen: 0.26, handLen: 0.17 });
  const d = buildDetail, far = d < 0.7;
  const g = (n) => Math.max(6, Math.round(n * (far ? 0.62 : 1)));
  const skinC = 0xaeaa6a;
  const mb = new MeshBuilder();
  addHumanoidBones(mb, P);
  mb.addBone('belly', 'spine', 0, P.spineY + 0.02, -0.08); // (it swells and pulses: poseExtras)
  mb.dirt = { y0: 0.4, k: 0.5 };
  mb.blood([0, 1.5, -0.14], 0.1, 0.7);
  const yH = P.hipY, yS = P.spineY, yC = P.chestY, ySh = P.shoulderY, yE = P.elbowY, yW = P.wristY;
  const tf = field([
    { t: 0, y: yH - 0.04, st: 1.0, sy: 0.03, k: -0.03 }, // the fold under the belly
    { t: 0, y: yS + 0.0, st: 0.1, sy: 0.035, k: 0.03 }, // a navel pushed out
    { t: 0.6, y: yC + 0.05, st: 0.4, sy: 0.06, k: 0.02, sym: true },
    { t: 0.6, y: yC - 0.02, st: 0.5, sy: 0.02, k: -0.016, sym: true },
    { t: PI, ridge: 't', st: 0.08, k: -0.014, y0: yH, y1: ySh, fade: 0.06 },
    { t: PI, y: yS + 0.06, st: 1.0, sy: 0.02, k: -0.016 },
    { t: PI - 0.45, y: yH - 0.04, st: 0.42, sy: 0.07, k: 0.022, sym: true },
  ]);
  const vein = marbled(8);
  const B = hulk(mb, P, {
    skin: { color: skinC, region: CR.SKIN, mottle: 0.16, tint: swollen(21) }, shade: 12,
    torso: [
      [0.74, 0.08, 0.08, 0.1, 2],
      [0.8, 0.24, 0.2, 0.2, 2.3, 0, -0.03],
      [0.88, 0.35, 0.35, 0.25, 2.3, 0, -0.06],
      [1.0, 0.4, 0.44, 0.26, 2.3, 0, -0.08],
      [1.1, 0.4, 0.44, 0.26, 2.3, 0, -0.08],
      [1.2, 0.36, 0.37, 0.26, 2.3, 0, -0.05],
      [1.3, 0.325, 0.27, 0.25, 2.4, 0, -0.02],
      [1.39, 0.31, 0.2, 0.23, 2.5],
      [1.44, 0.2, 0.15, 0.19, 2.3],
      [1.475, 0.08, 0.07, 0.09, 2],
    ],
    tf, nu: g(24), nvT: g(18), paintT: far ? null : vein,
    belly: { bone: 'belly', y: yS + 0.02, sy: 0.2, k: 0.85 },
    neck: [0.092, 0.085], neckDown: 0.07,
    arm: (s) => [
      [yW - 0.01, 0.04, 0.036, 0.038],
      [yW + 0.06, 0.05, 0.046, 0.046],
      [yE - 0.09, 0.074, 0.066, 0.07],
      [yE + 0.0, 0.07, 0.07, 0.076],
      [yE + 0.13, 0.086, 0.088, 0.088],
      [ySh - 0.05, 0.096, 0.096, 0.098],
      [ySh + 0.03, 0.09, 0.09, 0.092],
      [ySh + 0.08, 0.05, 0.05, 0.052, 2, -s * 0.02],
      [ySh + 0.095, 0.015, 0.015, 0.015, 2, -s * 0.04],
    ],
    nuA: g(12), nvA: g(11),
    leg: () => [
      [P.ankleY - 0.01, 0.05, 0.05, 0.055],
      [P.ankleY + 0.06, 0.055, 0.054, 0.062],
      [P.kneeY - 0.2, 0.078, 0.07, 0.09],
      [P.kneeY - 0.07, 0.088, 0.08, 0.1],
      [P.kneeY + 0.03, 0.092, 0.096, 0.092],
      [P.thighY - 0.2, 0.118, 0.118, 0.112],
      [P.thighY - 0.05, 0.132, 0.132, 0.134],
      [P.thighY + 0.07, 0.125, 0.125, 0.13],
    ],
    nuL: g(12), nvL: g(9),
  });
  const { T, legs } = B;
  const L = oldLook({
    face: { w: 1.22, cheek: 1.8, jaw: 1.4, chin: 0.8, nose: 1.1, gaunt: 0, sockets: 1.5, rot: 0.2, lips: 1.3 },
    skin: skinC, gaunt: 0, eye: 0xe0dc80, eyeGlow: 0.3, jawScale: 1.1, missingTeeth: 0x48,
    headTint: (lx, ly, lz, c) => swollen(21)({ x: lx * 3, y: ly * 3, z: lz * 3 }, { y: 0 }, c),
  });
  L.blood = null;
  deadHead(mb, P, L, d);
  // trousers that no longer close, their waistband under the belly
  const pcol = 0x3b3a30;
  ragPants(mb, B, yH - 0.02, (s) => P.ankleY + (s > 0 ? 0.12 : 0.05), { color: pcol, region: CR.TWILL, push: 0.009, tear: far ? 0 : 0.1, fray: 0.06, nu: g(20), nvT: 3, nuL: g(12), nvL: g(8), tint: bloodied(9, 0.5) });
  // the undershirt it has swollen out of: ridden up over the belly, split down the front
  const shirtTear = { amt: far ? 0 : 0.2, f: 11, seed: 171, fn: (x, y, z) => (y < yC - 0.03 + 0.05 * fbm3(x * 14, 0, z * 14, 2, 3)) || (z < 0 && Math.abs(x) < 0.02 + (ySh - y) * 0.16 && y < ySh - 0.02) };
  sheet(mb, T, 0, TAU, yC - 0.06, ySh + 0.045, g(22), g(7), 0.008, { color: 0x9a9680, region: CR.COTTON, mottle: 0.16, tint: bloodied(7, 0.6), tear: shirtTear });
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    if (far) {
      bound(mb, [mb.bi('hand' + n), 1, 0, 0], () => mb.box('hand' + n, [0, -0.08, 0], [0.04, 0.16, 0.085], { round: 0.5, seg: 1, color: skinC, region: CR.SKIN }));
      bound(mb, [mb.bi('foot' + n), 1, 0, 0], () => mb.box('foot' + n, [0, -P.ankleY + 0.035, -0.05], [0.11, 0.07, 0.26], { round: 0.5, seg: 1, color: skinC, region: CR.SKIN }));
    } else {
      bigHand(mb, 'hand' + n, s, { scale: 1.2, curl: 0.45, thick: 1.5, skin: skinC, region: CR.SKIN, tint: swollen(21) });
      bigFoot(mb, 'foot' + n, s, { w: 1.4, l: 1.1, h: 1.3, skin: skinC, region: CR.SKIN, tint: swollen(21) });
    }
  }
  if (!far) {
    // where the skin has given: splits down the drum of the belly, what is under them lit a sick green
    split(mb, T, 0.16, yS - 0.12, yS + 0.14, 0.022, { wander: 0.03 });
    split(mb, T, -0.5, yS - 0.02, yS + 0.16, 0.017, { wander: 0.04 });
    split(mb, T, 0.75, yH + 0.0, yS + 0.06, 0.015, { wander: 0.03 });
    const rnd = mulberry32(99);
    pox(mb, T, rnd, 9, -1.3, 1.3, yH - 0.06, yC - 0.02, 0.05, 0.018, { glow: 0.16 });
    pox(mb, T, rnd, 5, PI - 1.2, PI + 1.2, yS, ySh - 0.03, 0.04, 0.016, { glow: 0.12 });
    // a goitre of bile under the jaw
    blister(mb, B.N, 0.25, P.neckY + 0.03, 0.05, 0.9, { color: 0xc8d060, glow: 0.22, rim: 0x7a4030 });
  }
  legStumps(mb, P, { thighR: 0.12, pants: { color: pcol } });
  void legs;
  mb.aoStrength = 0.33;
  return { mb, P };
}

/**
 * The Bloater: a boomer three times over. The gut is most of it - an apron of swollen flesh hanging past the knees,
 * marbled with dark veins, split in a dozen places and studded with sacs of bile that glow through the skin - with a
 * small head drowned in the fat of its neck and arms that cannot reach round it. What it wore is still on its shoulders.
 */
function buildBloater() {
  const P = humanP({ hipY: 0.86, hipW: 0.15, thighLen: 0.4, shinLen: 0.4, spineLen: 0.16, chestLen: 0.22, neckOff: 0.2, neckLen: 0.05, headR: 0.115, shoulderW: 0.33, uarmLen: 0.3, farmLen: 0.28, handLen: 0.17, headZ: -0.04 });
  const skinC = 0xa4a664;
  const mb = new MeshBuilder();
  addHumanoidBones(mb, P);
  mb.addBone('belly', 'spine', 0, P.spineY - 0.02, -0.1); // the gut, on its own bone so it heaves (poseExtras)
  mb.dirt = { y0: 0.3, k: 0.5 };
  mb.blood([0, 1.5, -0.2], 0.1, 0.6);
  const yH = P.hipY, yS = P.spineY, yC = P.chestY, ySh = P.shoulderY, yE = P.elbowY, yW = P.wristY;
  const tf = field([
    { t: 0, y: 0.66, st: 1.2, sy: 0.03, k: -0.06 }, // the fold where the gut's apron hangs from
    { t: 0, y: yS - 0.02, st: 0.1, sy: 0.04, k: 0.04 }, // the navel, turned inside out
    { t: 0.7, y: yC + 0.07, st: 0.5, sy: 0.07, k: 0.035, sym: true }, // a chest lying on the gut
    { t: 0.7, y: yC - 0.02, st: 0.6, sy: 0.025, k: -0.03, sym: true },
    { t: 1.5, y: yS + 0.0, st: 0.4, sy: 0.12, k: 0.05, sym: true }, // flanks
    { t: 1.1, y: yH - 0.02, st: 0.5, sy: 0.2, k: 0.04 }, // a second, lopsided swelling on one side
    { t: PI, ridge: 't', st: 0.08, k: -0.025, y0: 0.7, y1: ySh, fade: 0.08 },
    { t: PI, y: yS + 0.04, st: 1.2, sy: 0.025, k: -0.03 }, // the rolls of its back
    { t: PI, y: yC + 0.0, st: 1.2, sy: 0.025, k: -0.028 },
    { t: PI - 0.5, y: 0.78, st: 0.45, sy: 0.1, k: 0.04, sym: true },
  ]);
  const vein = marbled(61, 0.03);
  const B = hulk(mb, P, {
    skin: { color: skinC, region: CR.SKIN, mottle: 0.18, tint: swollen(23, 5) }, shade: 9,
    torso: [
      [0.35, 0.14, 0.11, 0.1, 2, 0, -0.42],
      [0.43, 0.36, 0.26, 0.2, 2.2, 0, -0.42],
      [0.55, 0.5, 0.36, 0.3, 2.3, 0, -0.36],
      [0.7, 0.57, 0.46, 0.5, 2.3, 0, -0.26],
      [0.86, 0.6, 0.54, 0.52, 2.3, 0, -0.2],
      [1.02, 0.58, 0.56, 0.5, 2.3, 0, -0.18],
      [1.16, 0.53, 0.5, 0.44, 2.3, 0, -0.14],
      [1.28, 0.47, 0.4, 0.38, 2.4, 0, -0.08],
      [1.38, 0.43, 0.31, 0.34, 2.5, 0, -0.03],
      [1.44, 0.28, 0.22, 0.27, 2.3, 0, 0],
      [1.49, 0.12, 0.1, 0.13, 2, 0, 0.02],
    ],
    tf, nu: 30, nvT: 26, paintT: vein,
    belly: { bone: 'belly', y: 0.82, sy: 0.4, k: 0.85 },
    neck: [0.115, 0.105], neckDown: 0.07, neckBack: 0.0,
    arm: (s) => [
      [yW - 0.01, 0.06, 0.055, 0.058],
      [yW + 0.06, 0.075, 0.07, 0.07],
      [yE - 0.1, 0.105, 0.095, 0.1],
      [yE + 0.0, 0.1, 0.1, 0.106],
      [yE + 0.14, 0.126, 0.126, 0.126],
      [ySh - 0.06, 0.142, 0.14, 0.142],
      [ySh + 0.03, 0.13, 0.13, 0.132],
      [ySh + 0.09, 0.07, 0.07, 0.072, 2, -s * 0.03],
      [ySh + 0.11, 0.02, 0.02, 0.02, 2, -s * 0.05],
    ],
    nuA: 14, nvA: 12,
    leg: () => [
      [P.ankleY - 0.005, 0.07, 0.07, 0.075],
      [P.ankleY + 0.06, 0.075, 0.075, 0.085],
      [P.kneeY - 0.2, 0.105, 0.095, 0.12],
      [P.kneeY - 0.07, 0.12, 0.11, 0.135],
      [P.kneeY + 0.03, 0.125, 0.13, 0.125],
      [P.thighY - 0.2, 0.16, 0.16, 0.15],
      [P.thighY - 0.05, 0.18, 0.18, 0.18],
      [P.thighY + 0.08, 0.17, 0.17, 0.18],
    ],
    nvL: 10,
  });
  const { T, legs } = B;
  const L = oldLook({
    face: { w: 1.28, cheek: 1.8, jaw: 1.45, chin: 0.85, nose: 1.2, gaunt: 0, sockets: 1.6, rot: 0.2, lips: 1.3 },
    skin: skinC, gaunt: 0, eye: 0xe8e070, eyeGlow: 0.5, jawScale: 1.15, missingTeeth: 0x52,
    headTint: (lx, ly, lz, c) => swollen(23, 5)({ x: lx * 3, y: ly * 3, z: lz * 3 }, { y: 0 }, c),
  });
  L.blood = null;
  bossHead(mb, P, L, 1.25);
  // what it wore: the legs of its trousers, their seat split, and a shirt's yoke still across the shoulders
  for (const Lg of legs) {
    const yb = P.ankleY + (Lg.side > 0 ? 0.16 : 0.1);
    sheet(mb, Lg, 0, TAU, yb, Lg.yHi - 0.04, 14, 7, 0.012, { color: 0x34322a, region: CR.TWILL, mottle: 0.14, tint: bloodied(9, 0.5), tear: { amt: 0.12, f: 9, seed: 81 + Lg.side, fn: (x, y, z) => y < yb + 0.06 * fbm3(x * 14, y * 3, z * 14, 2, 11) } });
  }
  sheet(mb, T, PI - 1.5, PI + 1.5, 0.6, 0.92, 12, 5, 0.012, { color: 0x34322a, region: CR.TWILL, mottle: 0.14, tear: { amt: 0.2, f: 8, seed: 5, fn: (x, y) => Math.abs(x) < 0.03 + (0.92 - y) * 0.1 } });
  sheet(mb, T, 0, TAU, yC + 0.06, ySh + 0.05, 24, 5, 0.012, { color: 0x7e7a66, region: CR.COTTON, mottle: 0.16, tint: bloodied(7, 0.6), tear: { amt: 0.3, f: 8, seed: 31, fn: (x, y, z) => z < 0.05 && Math.abs(x) < 0.16 + (ySh - y) * 0.6 } });
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    bigHand(mb, 'hand' + n, s, { scale: 1.55, curl: 0.45, thick: 1.5, skin: skinC, region: CR.SKIN, tint: swollen(23, 5) });
    bigFoot(mb, 'foot' + n, s, { w: 1.9, l: 1.4, h: 1.6, skin: skinC, region: CR.SKIN, tint: swollen(23, 5) });
  }
  // sacs of bile standing out of the gut, the biggest low on its front; splits between them; boils everywhere else
  const rnd = mulberry32(4817);
  const sac = (t, y, r) => blister(mb, T, t, y, r, 0.75, { color: 0xc6dc58, glow: 0.3, rim: 0x7a2c20, ws: 9, hs: 6, noise: r * 0.08, nf: 20, tint: (p, n, c) => fbm3(p.x * 30, p.y * 30, p.z * 30, 2, 5) < 0.42 && c.lerp(color(0x3a5a18), 0.5) });
  sac(-0.35, 0.72, 0.15);
  sac(0.5, 0.9, 0.12);
  sac(0.1, 1.12, 0.09);
  sac(-0.9, 0.98, 0.1);
  sac(1.25, 0.72, 0.11);
  sac(0.25, 0.5, 0.09);
  sac(PI + 0.5, 1.12, 0.1);
  sac(PI - 0.7, 0.95, 0.09);
  split(mb, T, 0.12, 0.76, 1.04, 0.035, { wander: 0.03 });
  split(mb, T, -0.62, 0.86, 1.1, 0.026, { wander: 0.04 });
  split(mb, T, 0.9, 0.58, 0.8, 0.026, { wander: 0.03 });
  split(mb, T, -0.2, 0.42, 0.6, 0.02, { wander: 0.03 });
  pox(mb, T, rnd, 16, -1.5, 1.5, 0.45, 1.2, 0.05, 0.016, { glow: 0.2 });
  pox(mb, T, rnd, 9, PI - 1.4, PI + 1.4, 0.75, 1.36, 0.05, 0.02, { glow: 0.14 });
  for (const A of B.arms) pox(mb, A, rnd, 3, A.side * 0.6, A.side * 2.2, yE, ySh - 0.04, 0.03, 0.016, { glow: 0.12 });
  // a goitre of it under the jaw, and what runs off the chin
  blister(mb, B.N, -0.2, P.neckY + 0.02, 0.075, 0.9, { color: 0xc8d860, glow: 0.3, rim: 0x7a4030, ws: 8, hs: 6 });
  const jb = mb.bonePos('jaw');
  bound(mb, [mb.bi('jaw'), 1, 0, 0], () => mb.tube('root', [[0, jb[1] - P.headR * 0.55, jb[2] - P.headR * 1.0], [0.01, jb[1] - P.headR * 1.3, jb[2] - P.headR * 1.12], [0.0, jb[1] - P.headR * 2.2, jb[2] - P.headR * 1.05]], 0.016, 0.006, { rs: 5, ts: 5, color: 0xa8c040, region: CR.GLOW, glow: 0.35, blood: false }));
  legStumps(mb, P, { thighR: 0.17, pants: { color: 0x34322a } });
  mb.aoStrength = 0.35;
  return { mb, P };
}


// ------------------------------------------------------------------ the hulks (monsters.js)
/** A boss's head: people.js's dead face on the head bone, a little larger than its skeleton's (hs), the look's own. */
function bossHead(mb, P, L, hs = 1) {
  const NL = L.dead ? L : { ...oldLook(L), blood: null };
  if (hs === 1) return deadHead(mb, P, NL);
  // (the bigger head is set down by what its middle rose, so the middle stays on the head anchor: where headshots land)
  const dy = P.headR * (hs - 1) * 0.9;
  const geom = mb.geom;
  mb.geom = function (bone, geo, o) {
    geo.translate(0, -dy, 0);
    return geom.call(this, bone, geo, o);
  };
  try {
    return deadHead(mb, { ...P, headR: P.headR * hs }, NL);
  } finally {
    mb.geom = geom;
  }
}
// livid, bruised dead hide: the colour of a part of the body by where it is
const hide = (seed, bruise = 0x5a2226, rot = 0x5a5e58, f = 4) => (p, n, c) => {
  const m = fbm3(p.x * f, p.y * f, p.z * f, 3, seed);
  if (m > 0.6) c.lerp(color(bruise), Math.min(0.5, (m - 0.6) * 3));
  if (m < 0.36) c.lerp(color(rot), Math.min(0.4, (0.36 - m) * 3));
};
// where the hide is gone: raw muscle, its fibres running down the limb
const flayed = (seed, f = 1.6, at = 0.6) => (t, y, c) => {
  const m = fbm3(Math.cos(t) * f + seed, y * f * 1.3, Math.sin(t) * f, 3, seed);
  if (m > at) {
    const k = clamp((m - at) * 9, 0, 1);
    const fib = 0.75 + 0.25 * Math.sin(t * 46 + y * 9);
    c.lerp(color(0x8e2a22).multiplyScalar(fib), k * 0.92);
    if (m < at + 0.03) c.lerp(color(0x2a0806), 0.6); // the hide's torn edge
  }
};

/**
 * The Tank: a man grown past what his skin could hold. A gorilla's build that walks on its knuckles - a hump of
 * trapezius behind a small sunken head, arms as thick as its body - the hide split along every muscle and gone
 * altogether in patches, bone grown out through the shoulders, the spine and the forearms it rams with.
 */
function buildTank() {
  const P = humanP({
    hipY: 1.0, hipW: 0.22, thighLen: 0.46, shinLen: 0.45, spineLen: 0.3, chestLen: 0.45, neckOff: 0.5, neckLen: 0.08,
    headR: 0.15, shoulderW: 0.62, shoulderDrop: 0.06, uarmLen: 0.8, farmLen: 0.78, handLen: 0.3, headZ: -0.3, neckZ: -0.18, depth: 0.42,
  });
  const skinC = 0x938279, raw = 0x7c1c16;
  const mb = new MeshBuilder();
  addHumanoidBones(mb, P);
  mb.dirt = { y0: 0.6, k: 0.6 };
  mb.blood([0, 2.34, -0.5], 0.11, 0.8);
  mb.blood([0.62, 0.42, -0.05], 0.3, 0.9);
  mb.blood([-0.62, 0.42, -0.05], 0.3, 0.9);
  mb.blood([0.3, 1.62, -0.3], 0.2, 0.6);
  const yH = P.hipY, yS = P.spineY, yC = P.chestY, ySh = P.shoulderY, yE = P.elbowY, yW = P.wristY;
  const tf = field([
    { t: 0.52, y: yC + 0.2, st: 0.4, sy: 0.14, k: 0.055, sym: true }, // pectorals
    { t: 0, y: yC + 0.22, st: 0.08, sy: 0.2, k: -0.035 }, // the sternum between them
    { t: 0.5, y: yC + 0.03, st: 0.5, sy: 0.035, k: -0.022, sym: true }, // under them
    { t: 0, ridge: 't', st: 0.055, k: -0.016, y0: yH + 0.12, y1: yC + 0.02, fade: 0.08 },
    ...[0, 1, 2].map((i) => ({ t: 0.22, y: yS - 0.06 + i * 0.165, st: 0.17, sy: 0.062, k: 0.026, sym: true })), // the belly's slabs
    { t: 1.12, y: yC - 0.02, st: 0.28, sy: 0.12, k: 0.035, sym: true }, // serratus
    { t: 1.35, y: yS + 0.05, st: 0.34, sy: 0.13, k: 0.03, sym: true }, // obliques
    { t: PI, ridge: 't', st: 0.06, k: -0.04, y0: yH - 0.05, y1: ySh + 0.25, fade: 0.1 }, // the spine's furrow
    { t: PI - 0.8, y: yC + 0.14, st: 0.42, sy: 0.24, k: 0.07, sym: true }, // lats
    { t: PI - 0.42, y: ySh + 0.08, st: 0.34, sy: 0.16, k: 0.07, sym: true }, // the hump of trapezius
    { t: PI - 0.3, y: yS + 0.1, st: 0.2, sy: 0.25, k: 0.03, sym: true }, // the columns either side of the spine
    { t: PI - 0.48, y: yH - 0.04, st: 0.4, sy: 0.09, k: 0.04, sym: true }, // buttocks
  ], 1.7);
  const armF = (side) => field([
    { t: 0, y: yE + 0.34, st: 0.7, sy: 0.17, k: 0.04 }, // biceps
    { t: PI, y: yE + 0.4, st: 0.8, sy: 0.2, k: 0.035 }, // triceps
    { t: side * 1.57, ridge: 't', st: 0.1, k: -0.02, y0: yE + 0.1, y1: ySh - 0.2, fade: 0.1 }, // the groove between them
    { t: side * 1.2, y: ySh - 0.3, st: 0.5, sy: 0.04, k: -0.02 }, // under the deltoid
    { t: side * 0.9, y: yE - 0.2, st: 0.6, sy: 0.18, k: 0.03 }, // the forearm's mass, outside
    { t: -side * 1.0, ridge: 't', st: 0.1, k: -0.014, y0: yW + 0.1, y1: yE - 0.08, fade: 0.1 },
  ], 1.6);
  const legF = () => field([
    { t: 0, y: P.thighY - 0.2, st: 0.7, sy: 0.16, k: 0.03 }, // quadriceps
    { t: 0, y: P.kneeY + 0.01, st: 0.45, sy: 0.05, k: 0.025 }, // kneecap
    { t: PI, y: P.kneeY - 0.14, st: 0.7, sy: 0.1, k: 0.035 }, // calf
  ], 1.5);
  // (the trunk is made before the wound in its flank is: its hole and its rim are cut and painted through `rip`)
  let rip = null;
  const tornAt = [-1.85, -0.75, yC - 0.3, yC + 0.2];
  const B = hulk(mb, P, {
    skin: { color: skinC, region: CR.ROT, mottle: 0.16, tint: hide(31) }, raw, rawAt: -0.03, shade: 7,
    torso: [
      [0.83, 0.1, 0.1, 0.12, 2],
      [0.9, 0.3, 0.2, 0.25, 2.4],
      [1.0, 0.38, 0.25, 0.29, 2.5],
      [1.16, 0.36, 0.26, 0.26, 2.4],
      [1.32, 0.37, 0.28, 0.26, 2.3],
      [1.54, 0.45, 0.31, 0.3, 2.4],
      [1.76, 0.57, 0.36, 0.37, 2.5],
      [1.97, 0.66, 0.38, 0.45, 2.6, 0, 0.02],
      [2.13, 0.68, 0.36, 0.5, 2.6, 0, 0.03],
      [2.27, 0.57, 0.37, 0.52, 2.4, 0, 0.03],
      [2.4, 0.43, 0.34, 0.47, 2.2, 0, 0.05],
      [2.52, 0.25, 0.2, 0.3, 2, 0, 0.1],
    ],
    tf, nu: 30, nvT: 26,
    paintT: (t, y, c) => {
      flayed(3)(t, y, c);
      rip.paint(t, y, c);
    },
    holeT: (x, y, z) => rip.fn(x, y, z),
    prep: (T) => (rip = tornOpen(mb, T, ...tornAt, { ribs: 6, r: 0.024, depth: 0.06, nu: 10, nv: 12, seed: 7, rag: 0.3 })),
    neck: [0.17, 0.15], neckDown: 0.08, neckBack: 0.05,
    arm: (s) => [
      [yW - 0.03, 0.13, 0.115, 0.12],
      [yW + 0.1, 0.16, 0.14, 0.145],
      [yE - 0.44, 0.235, 0.205, 0.21],
      [yE - 0.22, 0.28, 0.25, 0.255],
      [yE - 0.06, 0.225, 0.2, 0.225],
      [yE + 0.05, 0.19, 0.19, 0.215],
      [yE + 0.3, 0.235, 0.255, 0.235],
      [yE + 0.52, 0.225, 0.235, 0.23],
      [ySh - 0.1, 0.265, 0.27, 0.275, 2, s * 0.02],
      [ySh + 0.05, 0.255, 0.25, 0.265, 2, s * 0.012],
      [ySh + 0.16, 0.18, 0.17, 0.19, 2, -s * 0.04],
      [ySh + 0.215, 0.07, 0.07, 0.08, 2, -s * 0.09],
    ],
    af: armF, paintA: (s) => flayed(s > 0 ? 11 : 17, 2.2), nuA: 16, nvA: 20,
    leg: () => [
      [P.ankleY - 0.01, 0.1, 0.1, 0.11],
      [P.ankleY + 0.06, 0.1, 0.1, 0.115],
      [P.kneeY - 0.26, 0.135, 0.12, 0.155],
      [P.kneeY - 0.11, 0.165, 0.14, 0.195],
      [P.kneeY + 0.02, 0.165, 0.17, 0.165],
      [P.thighY - 0.3, 0.2, 0.2, 0.19],
      [P.thighY - 0.12, 0.25, 0.25, 0.25],
      [P.thighY + 0.04, 0.26, 0.26, 0.27],
      [P.thighY + 0.16, 0.2, 0.2, 0.21],
    ],
    lf: legF, paintL: (s) => flayed(s > 0 ? 23 : 29, 2.4),
  });
  const { T, arms } = B;
  bossHead(mb, P, {
    face: { w: 1.2, h: 0.88, brow: 2.6, jaw: 1.7, chin: 1.3, sockets: 2.4, cheek: 1.5, noseW: 1.6 },
    skin: 0x8e7c74, gaunt: 0, eye: 0xff7030, eyeGlow: 0.9, jawScale: 1.35, fang: true, nose: 0.5, missingTeeth: 0x04,
  }, 1.42);
  // what is left of his jeans, and the belt that held them
  ragPants(mb, B, yH + 0.14, (s) => P.kneeY + (s > 0 ? 0.1 : 0.2), { color: 0x2a303a, region: CR.DENIM, push: 0.014, tear: 0.12, fray: 0.14, tint: bloodied(9, 0.5) });
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const A = arms[s < 0 ? 0 : 1];
    // fists it walks on: the knuckles grown over with bone
    bigHand(mb, 'hand' + n, s, { scale: 3.3, curl: 1.18, spread: 1.05, thick: 1.4, skin: mulColor(skinC, 0.92), region: CR.ROT, tint: hide(41 + s), nu: 6 });
    const hb = mb.bonePos('hand' + n);
    for (let k = 0; k < 4; k++) shard(mb, [mb.bi('hand' + n), 1, 0, 0], [hb[0] - s * 0.05, hb[1] - 0.27, hb[2] + (-0.105 + k * 0.07) * 1.05], [hb[0] - s * 0.13, hb[1] - 0.37, hb[2] + (-0.11 + k * 0.074) * 1.05], 0.042, { rs: 5 });
    bigFoot(mb, 'foot' + n, s, { w: 2.2, l: 1.55, h: 1.9, skin: mulColor(skinC, 0.9), region: CR.ROT, tint: hide(51) });
    // bone through the forearm: a ridge of blades down its outer edge, the ram it charges with
    const fa = [mb.bi('farm' + n), 1, 0, 0];
    for (let i = 0; i < 3; i++) {
      const y = yE - 0.12 - i * 0.2;
      const a = surfPoint(A, s * 1.45, y, -0.05);
      const len = [0.3, 0.2, 0.26][i];
      shard(mb, fa, a, [a[0] + s * len * 0.35, a[1] + 0.12 - i * 0.03, a[2] + len * 0.9], [0.075, 0.06, 0.065][i], { rs: 4 }); // (raking back, not out: no wider than its hitbox)
    }
    // ...and through the shoulder: a crest of shards over each
    const ch = [mb.bi('chest'), 1, 0, 0];
    for (let i = 0; i < 3; i++) {
      const x = s * [0.38, 0.5, 0.6][i], z = [0.3, 0.14, 0.26][i];
      const y = ySh + [0.14, 0.1, 0.02][i];
      const len = [0.3, 0.42, 0.26][i];
      shard(mb, ch, [x, y - 0.06, z], [x + s * len * 0.5, y + len, z + len * 0.45], [0.075, 0.09, 0.07][i], { rs: 4 });
    }
    // veins standing out along the biceps and the forearm
    surfTube(mb, A, [[s * 0.3, yE + 0.5], [s * 0.15, yE + 0.34], [s * 0.4, yE + 0.16], [s * 0.2, yE + 0.02]], 0.011, 0.008, { color: 0x4a3046, region: CR.FLESH, ts: 10, blood: false });
    surfTube(mb, A, [[-s * 0.3, yE - 0.06], [-s * 0.5, yE - 0.26], [-s * 0.25, yE - 0.46], [-s * 0.4, yW + 0.06]], 0.01, 0.007, { color: 0x4a3046, region: CR.FLESH, ts: 10, blood: false });
  }
  // the spine come through the hump: a row of spurs, the tallest between the shoulders
  for (let i = 0; i < 6; i++) {
    const y = yC - 0.12 + i * 0.135;
    const a = surfPoint(T, PI, y, -0.06);
    const len = 0.1 + 0.14 * Math.sin((i / 5) * PI) + (i % 2) * 0.03;
    shard(mb, T.wts(y, 0), a, [0, a[1] + len * 0.7, a[2] + len], 0.062, { rs: 4 });
  }
  mb.aoStrength = 0.36;
  return { mb, P };
}

/** A rubber boot on a hulk's leg: the foot lofted heel to toe on the foot bone, the shaft up the shin (Lg: its surface). */
function bigBoot(mb, Lg, s, o) {
  const n = s < 0 ? 'L' : 'R';
  const b = mb.bonePos('foot' + n);
  const w = o.w, l = o.l, h = o.h;
  const col = o.color;
  const at = (x, y, z) => [b[0] + x * w, y * h, b[2] + z * l];
  const sole = color(o.sole ?? 0x141210);
  ringLoft(mb, 'foot' + n, [
    { c: at(0, 0.04, 0.066), rx: 0.03 * w, ru: 0.04 * h, rd: 0.04 * h },
    { c: at(0, 0.052, 0.04), rx: 0.042 * w, ru: 0.062 * h, rd: 0.052 * h },
    { c: at(0, 0.05, -0.02), rx: 0.046 * w, ru: 0.06 * h, rd: 0.05 * h },
    { c: at(0, 0.04, -0.08), rx: 0.05 * w, ru: 0.04 * h, rd: 0.04 * h },
    { c: at(0, 0.034, -0.13), rx: 0.052 * w, ru: 0.032 * h, rd: 0.034 * h },
    { c: at(0, 0.03, -0.165), rx: 0.044 * w, ru: 0.026 * h, rd: 0.03 * h },
  ].map((r) => ({ ...r, n: 3 })), {
    color: col, region: CR.LEATHER, mottle: 0.12, nu: 12, sub: 2, cap0: 0.012 * l, cap1: 0.016 * l,
    tint: (p, nn, c) => {
      if (p.y < 0.03 * h) c.copy(sole);
    },
  });
  sheet(mb, Lg, 0, TAU, b[1] - 0.01, o.top, 14, 4, (t, y) => 0.03 + 0.012 * smooth((y - b[1]) / (o.top - b[1])), { color: col, region: CR.LEATHER, mottle: 0.12 });
  sheet(mb, Lg, 0, TAU, o.top - 0.03, o.top, 14, 1, 0.052, { color: mulColor(col, 0.75), region: CR.LEATHER, cap1: 0 });
}

/**
 * The Brute, night 1's boss: the slaughterhouse's butcher, twice the size he was. Fat over slabs of muscle, a gut that
 * hangs over his belt under a blood-soaked apron, forearms red to the elbow, rubber boots; a small bald head sunk
 * between his shoulders, a cleaver's scar stitched across it. The hook he was hung on is still through his left
 * shoulder with its chain down his back, somebody's cleaver is in the other, and he has brought a hook of his own.
 */
function buildBrute() {
  const P = humanP({
    hipY: 1.08, hipW: 0.19, thighLen: 0.5, shinLen: 0.5, spineLen: 0.3, chestLen: 0.38, neckOff: 0.34, neckLen: 0.07,
    headR: 0.125, shoulderW: 0.5, shoulderDrop: 0.06, uarmLen: 0.46, farmLen: 0.42, handLen: 0.22, headZ: -0.14, neckZ: -0.08, depth: 0.4,
  });
  const skinC = 0xa8948a;
  const mb = new MeshBuilder();
  addHumanoidBones(mb, P);
  mb.addBone('belly', 'spine', 0, P.spineY - 0.05, -0.1); // the gut: its own bone so it heaves with the breathing (poseExtras)
  mb.dirt = { y0: 0.5, k: 0.5 };
  mb.blood([0, 2.2, -0.32], 0.08, 0.8);
  mb.blood([0.5, 1.2, -0.05], 0.3, 1);
  mb.blood([-0.5, 1.2, -0.05], 0.3, 1);
  const yH = P.hipY, yS = P.spineY, yC = P.chestY, ySh = P.shoulderY, yE = P.elbowY, yW = P.wristY;
  const tf = field([
    { t: 0.55, y: yC + 0.07, st: 0.42, sy: 0.1, k: 0.05, sym: true }, // a sagging chest
    { t: 0.55, y: yC - 0.06, st: 0.5, sy: 0.03, k: -0.03, sym: true }, // the fold under it
    { t: 0, y: yC + 0.1, st: 0.1, sy: 0.14, k: -0.02 },
    { t: 0, y: yH + 0.0, st: 0.9, sy: 0.04, k: -0.05 }, // under the paunch
    { t: 0, y: yS - 0.05, st: 0.07, sy: 0.03, k: -0.03 }, // the navel
    { t: 1.6, y: yS - 0.12, st: 0.45, sy: 0.1, k: 0.045, sym: true }, // love handles
    { t: PI, ridge: 't', st: 0.07, k: -0.03, y0: yH, y1: ySh + 0.1, fade: 0.1 },
    { t: PI, y: yS + 0.06, st: 1.1, sy: 0.03, k: -0.028 }, // the rolls of a fat back
    { t: PI, y: yC - 0.04, st: 1.1, sy: 0.03, k: -0.025 },
    { t: PI - 0.5, y: yC + 0.14, st: 0.5, sy: 0.12, k: 0.045, sym: true },
    { t: PI - 0.4, y: ySh + 0.04, st: 0.4, sy: 0.08, k: 0.05, sym: true }, // trapezius piled up behind the head
    { t: PI - 0.45, y: yH - 0.05, st: 0.4, sy: 0.09, k: 0.04, sym: true },
  ]);
  const armF = (side) => field([
    { t: 0, y: yE + 0.2, st: 0.8, sy: 0.1, k: 0.03 },
    { t: PI, y: yE + 0.22, st: 0.8, sy: 0.12, k: 0.03 },
    { t: side * 1.3, y: ySh - 0.2, st: 0.6, sy: 0.03, k: -0.02 },
    { t: side * 0.9, y: yE - 0.12, st: 0.7, sy: 0.1, k: 0.025 },
    { t: PI, y: yE + 0.0, st: 0.5, sy: 0.04, k: 0.02 }, // the point of the elbow
  ]);
  // red to the elbows: the blood of his trade, dried black in the creases
  const butcher = (t, y, c) => {
    const k = clamp((yE + 0.08 - y) * 5 + (fbm3(t * 2, y * 6, 3, 2, 17) - 0.5) * 1.4, 0, 1);
    c.lerp(color(0x4a0806), k * 0.85);
  };
  const B = hulk(mb, P, {
    skin: { color: skinC, region: CR.ROT, mottle: 0.14, tint: hide(57, 0x6a2a2a, 0x74786a, 3.2) }, shade: 9,
    torso: [
      [0.92, 0.1, 0.1, 0.12, 2],
      [1.0, 0.32, 0.22, 0.27, 2.4],
      [1.1, 0.43, 0.36, 0.31, 2.5],
      [1.25, 0.48, 0.47, 0.32, 2.4],
      [1.42, 0.49, 0.47, 0.32, 2.4],
      [1.6, 0.47, 0.4, 0.33, 2.4],
      [1.78, 0.5, 0.34, 0.36, 2.5],
      [1.93, 0.56, 0.31, 0.38, 2.6],
      [2.04, 0.57, 0.28, 0.39, 2.6, 0, 0.02],
      [2.13, 0.44, 0.27, 0.37, 2.4, 0, 0.03],
      [2.21, 0.3, 0.22, 0.3, 2.2, 0, 0.05],
      [2.28, 0.15, 0.11, 0.17, 2, 0, 0.07],
    ],
    tf, nu: 28, nvT: 24,
    belly: { bone: 'belly', y: yS - 0.02, sy: 0.26, k: 0.82 },
    neck: [0.15, 0.135], neckDown: 0.08, neckBack: 0.04,
    arm: (s) => [
      [yW - 0.02, 0.085, 0.075, 0.08],
      [yW + 0.07, 0.1, 0.09, 0.09],
      [yE - 0.2, 0.15, 0.13, 0.135],
      [yE - 0.08, 0.155, 0.14, 0.145],
      [yE + 0.02, 0.14, 0.14, 0.15],
      [yE + 0.2, 0.172, 0.178, 0.172],
      [ySh - 0.1, 0.192, 0.19, 0.192, 2, s * 0.01],
      [ySh + 0.02, 0.186, 0.18, 0.19, 2, 0],
      [ySh + 0.1, 0.13, 0.13, 0.14, 2, -s * 0.03],
      [ySh + 0.14, 0.05, 0.05, 0.05, 2, -s * 0.06],
    ],
    af: armF, paintA: () => butcher, nuA: 16, nvA: 16,
    leg: () => [
      [P.ankleY - 0.01, 0.085, 0.085, 0.09],
      [P.ankleY + 0.08, 0.09, 0.09, 0.1],
      [P.kneeY - 0.26, 0.12, 0.11, 0.14],
      [P.kneeY - 0.1, 0.14, 0.125, 0.165],
      [P.kneeY + 0.02, 0.14, 0.15, 0.14],
      [P.thighY - 0.25, 0.18, 0.18, 0.17],
      [P.thighY - 0.08, 0.21, 0.21, 0.21],
      [P.thighY + 0.06, 0.215, 0.21, 0.22],
      [P.thighY + 0.15, 0.17, 0.17, 0.18],
    ],
    legEnd: () => P.kneeY - 0.2, nvL: 8,
  });
  const { T, arms, legs } = B;
  const H = bossHead(mb, P, {
    // a small, brutal head: the brow a shelf, the jaw a slab, the nose broken flat, a cleaver scar stitched shut across it
    face: { w: 1.16, h: 0.92, brow: 2.4, jaw: 1.6, chin: 1.3, noseW: 1.9, ear: 1.3, sockets: 2.0, cheek: 1.5 },
    headTint: (lx, ly, lz, c) => {
      const u = lx * 0.8 + ly * 0.6; // a line from the left temple down across the nose to the right jaw
      if (Math.abs(u - 0.004) < 0.011 && lz < 0) c.lerp(color(0x4a1414), 0.75);
      if (Math.abs(u - 0.004) < 0.022 && lz < 0 && Math.abs(Math.sin((lx - ly) * 120)) > 0.85) c.lerp(color(0x1a0a08), 0.8); // the stitches
    },
    skin: skinC, gaunt: 0, eye: 0xffa040, eyeGlow: 0.7, socket: 0.2, jawScale: 1.3, nose: 0.3, missingTeeth: 0x24,
  }, 1.36);
  void H;
  // heavy trousers into rubber boots
  ragPants(mb, B, yH + 0.1, () => P.kneeY - 0.16, { color: 0x2e2a26, region: CR.TWILL, push: 0.014, tear: 0.03, fray: 0.02, nvL: 8, tint: bloodied(11, 0.5) });
  for (const Lg of legs) bigBoot(mb, Lg, Lg.side, { w: 2.0, l: 1.55, h: 1.7, color: 0x1e2420, top: P.kneeY - 0.1 });
  // the apron: a bib up the chest and over the gut (it heaves with it), a skirt hanging from the paunch to the knees
  const apronTint = (p, n, c) => {
    const m = fbm3(p.x * 5, p.y * 4, p.z * 5, 3, 91);
    const smear = fbm3(p.x * 2.5, p.y * 9, p.z * 2.5, 2, 17); // streaks running down
    c.lerp(color(0x5a0806), clamp((m - 0.4) * 3.5 + (smear - 0.55) * 2.5 + (1.5 - p.y) * 0.6, 0, 0.95)); // soaked from the belly down
    c.lerp(color(0x2a0604), clamp((m - 0.62) * 4, 0, 0.6)); // dried black where it pooled
    c.lerp(color(0x2a1c14), clamp((0.95 - p.y) * 1.2, 0, 0.4)); // filth at the hem
  };
  const apron = { color: 0xd8d0b8, region: CR.CANVAS, mottle: 0.2, blood: false, tint: apronTint };
  const aT = 1.0, bibY = yC + 0.2, pA = 0.022;
  const bibW = (y) => (y > yC - 0.02 ? lerp(0.62, 0.42, clamp((y - yC + 0.02) / (bibY - yC + 0.02), 0, 1)) : aT);
  sheet(mb, T, -aT, aT, yH - 0.03, bibY, 14, 14, pA, { ...apron, double: true, tear: { amt: 0, fn: (x, y, z) => y > yC - 0.02 && Math.abs(angleOn(T, x, y, z)) > bibW(y) } });
  reweigh(mb, T.wts3);
  {
    const W = 10, Hn = 6;
    const geo = new THREE.PlaneGeometry(1, 1, W, Hn);
    const pa = geo.attributes.position;
    const yTop = yH - 0.02, yBot = P.kneeY + 0.1;
    for (let i = 0; i < pa.count; i++) {
      const u = pa.getX(i) * 2, v = 0.5 - pa.getY(i);
      const top = surfPoint(T, u * aT, yTop, pA);
      const sag = 0.014 * Math.sin(u * 7 + v * 3) * v; // cloth folds towards the hem
      pa.setXYZ(i, top[0] * (1 + 0.06 * v), lerp(yTop, yBot, v) - (v > 0.99 ? 0.03 * fbm3(u * 3, 1, 1, 2, 4) : 0), top[2] - 0.03 * v + sag);
    }
    geo.computeVertexNormals();
    bound(mb, [mb.bi('hips'), 1, 0, 0], () => mb.geom('root', geo, { ...apron, double: true, keepNormals: true }));
  }
  // its neck strap, and the ties round the waist knotted at the back
  const tie = { color: 0x8a8270, region: CR.CANVAS, mottle: 0.2 };
  strap(mb, T, [[-0.42, bibY - 0.01, pA], [-0.5, ySh - 0.02], [-0.8, ySh + 0.07], [PI + 0.5, ySh + 0.08], [PI, ySh + 0.05], [PI - 0.5, ySh + 0.08], [0.8, ySh + 0.07], [0.5, ySh - 0.02], [0.42, bibY - 0.01, pA]], 0.03, 0.008, { ...tie, segs: 26 });
  strap(mb, T, [[aT, yS - 0.06, pA], [1.5, yS - 0.07], [2.1, yS - 0.08], [2.7, yS - 0.08], [PI, yS - 0.09], [3.6, yS - 0.08], [4.2, yS - 0.08], [4.8, yS - 0.07], [TAU - aT, yS - 0.06, pA]], 0.03, 0.008, { ...tie, segs: 26 });
  // an old wound sewn shut across the back, in butcher's twine
  stitches(mb, T, [[PI + 0.95, yC + 0.16], [PI + 0.55, yC + 0.05], [PI + 0.2, yC - 0.1], [PI - 0.1, yS + 0.1]], { n: 12, w: 0.07, scar: 0x5a1a18 });
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    bigHand(mb, 'hand' + n, s, { scale: 2.25, curl: s > 0 ? 1.2 : 0.75, spread: 1.05, thick: 1.4, skin: 0x5a1a14, region: CR.ROT, nu: 6 });
  }
  const steel = { color: 0x6a665e, region: CR.PLAIN, mottle: 0.4, blood: false };
  const wood = { color: 0x4a3524, region: CR.LEATHER, mottle: 0.25, blood: false };
  // the hook in his right fist: a wooden bar across the palm, the steel out between his fingers and down to its point
  {
    const hb = mb.bonePos('handR');
    const hw = [mb.bi('handR'), 1, 0, 0];
    const at = (x, y, z) => [hb[0] + x, hb[1] + y, hb[2] + z];
    bound(mb, hw, () => {
      mb.seg('root', at(-0.05, -0.19, -0.16), at(-0.05, -0.19, 0.16), 0.036, 0.036, { rs: 7, ...wood, caps: 2 });
      mb.tube('root', [at(-0.05, -0.2, 0), at(-0.03, -0.4, 0.0), at(-0.02, -0.52, -0.03), at(-0.02, -0.62, -0.12), at(-0.02, -0.61, -0.24), at(-0.02, -0.52, -0.3), at(-0.02, -0.42, -0.28)], 0.034, 0.008, { rs: 6, ts: 16, ...steel, tint: (p, nn, c) => p.y < hb[1] - 0.45 && c.lerp(color(0x4a0806), 0.6) });
    });
  }
  // the hook he was hung on, still through the back of his left shoulder, and its chain down his back
  {
    const cw = [mb.bi('chest'), 1, 0, 0];
    const a = surfPoint(T, PI + 0.75, ySh - 0.02, 0);
    bound(mb, cw, () => mb.tube('root', [[a[0], a[1] - 0.12, a[2] + 0.07], [a[0], a[1] + 0.08, a[2] + 0.12], [a[0], a[1] + 0.2, a[2] + 0.02], [a[0] + 0.01, a[1] + 0.16, a[2] - 0.12], [a[0] + 0.02, a[1] + 0.04, a[2] - 0.16]], 0.024, 0.01, { rs: 6, ts: 12, ...steel }));
    chain(mb, (x, y) => T.wts(y, x), [[a[0], a[1] - 0.12, a[2] + 0.07], [a[0] + 0.03, a[1] - 0.32, a[2] + 0.06], [a[0] + 0.08, yC - 0.05, surfPoint(T, PI + 0.6, yC - 0.05, 0.04)[2]], [a[0] + 0.14, yS + 0.05, surfPoint(T, PI + 0.45, yS + 0.05, 0.04)[2]], [a[0] + 0.12, yS - 0.2, surfPoint(T, PI + 0.4, yS - 0.2, 0.05)[2]]], 0.036, { color: 0x4e4a44 });
    // ...and a cleaver somebody left in the other one
    const b = surfPoint(T, PI - 0.7, ySh - 0.08, 0);
    bound(mb, cw, () => {
      mb.box('root', [b[0] + 0.02, b[1] + 0.06, b[2] + 0.07], [0.012, 0.2, 0.22], { ...steel, rot: [0.5, 0.25, 0], tint: (p, nn, c) => p.z < b[2] + 0.05 && c.lerp(color(0x4a0806), 0.7) });
      mb.seg('root', [b[0] + 0.045, b[1] + 0.13, b[2] + 0.15], [b[0] + 0.1, b[1] + 0.25, b[2] + 0.31], 0.022, 0.02, { rs: 6, ...wood, caps: 2 });
    });
    void arms;
  }
  mb.aoStrength = 0.34;
  return { mb, P };
}

/**
 * Somebody the body has not finished taking in: a skull pressing out under its hide at `c` (model coordinates), facing
 * along `dir`, the sockets and the mouth sunk dark, an arm still reaching out of the flesh beside it. Bound by w.
 */
function absorbed(mb, w, c, dir, r, o) {
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), d);
  const at = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).multiplyScalar(r).applyQuaternion(q);
    return [c[0] + v.x, c[1] + v.y, c[2] + v.z];
  };
  const dark = { color: 0x1c0806, region: CR.FLESH, mottle: 0.1, blood: false, ao: false };
  bound(mb, w, () => {
    mb.ellip('root', c, [r * 0.82, r * 1.02, r * 0.92], { ws: 10, hs: 8, q, color: o.skin, region: CR.ROT, mottle: 0.2, tint: o.tint, noise: r * 0.03, nf: 9 });
    mb.ellip('root', at(0, -0.62, -0.5), [r * 0.52, r * 0.5, r * 0.5], { ws: 8, hs: 6, q, color: o.skin, region: CR.ROT, mottle: 0.2, tint: o.tint }); // the jaw
    for (const s of [-1, 1]) mb.ellip('root', at(s * 0.36, 0.12, -0.8), [r * 0.2, r * 0.17, r * 0.14], { ws: 6, hs: 4, q, ...dark });
    mb.ellip('root', at(0, -0.55, -0.9), [r * 0.26, r * 0.3, r * 0.14], { ws: 7, hs: 5, q, ...dark }); // a mouth stretched open
    for (let i = 0; i < 5; i++) mb.box('root', at((i - 2) * 0.1, -0.36, -0.99), [r * 0.07, r * 0.12, r * 0.05], { q, color: 0xc8bc98, region: CR.BONE, mottle: 0.2, blood: false, ao: false });
  });
  if (o.arm) {
    // the arm: out of the flesh below the head, bent at the elbow, the fingers spread
    const a = at(o.arm * 0.9, -0.9, -0.1), e = at(o.arm * 1.5, -1.3, -1.5), h = at(o.arm * 1.1, -0.5, -2.7);
    bound(mb, w, () => {
      ringLoft(mb, 'root', [{ c: a, rx: r * 0.34 }, { c: [lerp(a[0], e[0], 0.5), lerp(a[1], e[1], 0.5), lerp(a[2], e[2], 0.5)], rx: r * 0.27 }, { c: e, rx: r * 0.22 }, { c: [lerp(e[0], h[0], 0.5), lerp(e[1], h[1], 0.5), lerp(e[2], h[2], 0.5)], rx: r * 0.2 }, { c: h, rx: r * 0.15 }], { nu: 7, sub: 2, color: o.skin, region: CR.ROT, mottle: 0.2, tint: o.tint, cap1: r * 0.1 });
      for (let i = 0; i < 4; i++) {
        const f = at(o.arm * 1.1 + (i - 1.5) * 0.3, -0.15 + Math.abs(i - 1.5) * -0.12, -3.5);
        mb.tube('root', [h, [lerp(h[0], f[0], 0.55), lerp(h[1], f[1], 0.55) + r * 0.12, lerp(h[2], f[2], 0.55)], f], r * 0.07, r * 0.035, { rs: 4, ts: 3, color: o.skin, region: CR.ROT, tint: o.tint });
      }
    });
  }
}

/**
 * The Abomination: what the dead make of each other. Four metres of several people grown into one - a hump of them on
 * its back, faces still pressing out of it and an arm or two still reaching - with one arm far bigger than the other, a
 * trunk split open down the front into a mouth of ribs, two withered arms left over beside it, and too many eyes.
 */
function buildAbomination() {
  const P = humanP({
    hipY: 1.5, hipW: 0.32, thighLen: 0.72, shinLen: 0.68, spineLen: 0.42, chestLen: 0.6, neckOff: 0.72, neckLen: 0.14,
    headR: 0.3, shoulderW: 0.9, shoulderDrop: 0.08, uarmLen: 1.05, farmLen: 1.0, handLen: 0.5, headZ: -0.42, neckZ: -0.22, depth: 0.6,
  });
  const skinC = 0x96736a, raw = 0x7a1614;
  const mb = new MeshBuilder();
  addHumanoidBones(mb, P);
  mb.dirt = { y0: 0.9, k: 0.6 };
  mb.blood([0, 3.48, -0.75], 0.2, 0.9);
  mb.blood([0, 2.1, -0.6], 0.6, 0.8);
  mb.blood([0.95, 0.9, -0.1], 0.5, 0.9);
  mb.blood([-0.95, 1.0, -0.1], 0.4, 0.8);
  const yH = P.hipY, yS = P.spineY, yC = P.chestY, ySh = P.shoulderY, yE = P.elbowY, yW = P.wristY;
  const skinT = hide(41, 0x6a1c1c, 0x5a5268, 2.4);
  const tf = field([
    { t: 0.6, y: yC + 0.36, st: 0.42, sy: 0.2, k: 0.08, sym: true }, // slabs of chest either side of the split
    { t: 0.6, y: yC + 0.1, st: 0.5, sy: 0.05, k: -0.04, sym: true },
    { t: 1.2, y: yC - 0.05, st: 0.3, sy: 0.18, k: 0.06, sym: true },
    { t: 1.4, y: yS + 0.0, st: 0.36, sy: 0.2, k: 0.05, sym: true },
    { t: PI, ridge: 't', st: 0.07, k: -0.07, y0: yH - 0.1, y1: ySh + 0.2, fade: 0.15 },
    { t: PI - 0.8, y: yC + 0.2, st: 0.42, sy: 0.3, k: 0.1, sym: true },
    { t: PI - 0.5, y: ySh + 0.14, st: 0.4, sy: 0.22, k: 0.1 }, // the hump, lopsided
    { t: PI + 0.45, y: ySh + 0.0, st: 0.4, sy: 0.25, k: 0.14 },
    { t: PI - 0.48, y: yH - 0.06, st: 0.4, sy: 0.14, k: 0.06, sym: true },
    // where one body meets the next: seams round the trunk
    { t: 2.2, y: yC + 0.25, st: 0.9, sy: 0.035, k: -0.05 },
    { t: -1.3, y: yS + 0.2, st: 0.8, sy: 0.035, k: -0.05 },
  ]);
  const armF = (side) => field([
    { t: 0, y: yE + 0.45, st: 0.7, sy: 0.22, k: 0.06 },
    { t: PI, y: yE + 0.5, st: 0.8, sy: 0.26, k: 0.05 },
    { t: side * 1.57, ridge: 't', st: 0.1, k: -0.03, y0: yE + 0.12, y1: ySh - 0.25, fade: 0.12 },
    { t: side * 1.2, y: ySh - 0.4, st: 0.5, sy: 0.05, k: -0.03 },
    { t: side * 0.9, y: yE - 0.28, st: 0.6, sy: 0.22, k: 0.05 },
    { t: 2.5, y: yE - 0.5, st: 1.2, sy: 0.04, k: -0.04 }, // a seam round the forearm
  ], side > 0 ? 1.3 : 1);
  let maw = null;
  const mawAt = [-0.4, 0.4, yS - 0.12, yC + 0.2];
  const armK = (s) => (s > 0 ? 1 : 0.8);
  const B = hulk(mb, P, {
    skin: { color: skinC, region: CR.ROT, mottle: 0.18, tint: skinT }, raw, rawAt: -0.035, shade: 6,
    torso: [
      [1.26, 0.15, 0.14, 0.16, 2],
      [1.38, 0.46, 0.3, 0.36, 2.4],
      [1.52, 0.6, 0.4, 0.44, 2.5],
      [1.75, 0.6, 0.46, 0.42, 2.4],
      [1.95, 0.62, 0.5, 0.42, 2.4],
      [2.25, 0.68, 0.5, 0.46, 2.4],
      [2.55, 0.8, 0.52, 0.56, 2.5],
      [2.85, 0.93, 0.52, 0.7, 2.6, 0.03, 0.04],
      [3.1, 0.98, 0.5, 0.8, 2.6, 0.04, 0.06],
      [3.3, 0.82, 0.5, 0.84, 2.5, 0.05, 0.06],
      [3.5, 0.58, 0.44, 0.72, 2.3, 0.06, 0.1],
      [3.68, 0.3, 0.26, 0.44, 2, 0.06, 0.2],
    ],
    tf, nu: 28, nvT: 25,
    paintT: (t, y, c) => {
      flayed(5, 0.9, 0.58)(t, y, c);
      maw.paint(t, y, c);
    },
    holeT: (x, y, z) => maw.fn(x, y, z),
    prep: (T) => (maw = tornOpen(mb, T, ...mawAt, { ribs: 0, depth: 0.2, nu: 10, nv: 14, seed: 12, rag: 0.22, flesh: 0x5a100e })),
    neck: [0.26, 0.24], neckDown: 0.12, neckBack: 0.08,
    arm: (s) => {
      const m = armK(s);
      return [
        [yW - 0.04, 0.17, 0.15, 0.16],
        [yW + 0.14, 0.2, 0.18, 0.19],
        [yE - 0.55, 0.3, 0.27, 0.28],
        [yE - 0.28, 0.36, 0.33, 0.33],
        [yE - 0.08, 0.29, 0.26, 0.29],
        [yE + 0.07, 0.25, 0.25, 0.28],
        [yE + 0.4, 0.31, 0.34, 0.31],
        [yE + 0.7, 0.3, 0.31, 0.3],
        [ySh - 0.14, 0.35, 0.35, 0.36, 2, s * 0.03],
        [ySh + 0.07, 0.34, 0.33, 0.35, 2, s * 0.01],
        [ySh + 0.22, 0.24, 0.23, 0.25, 2, -s * 0.05],
        [ySh + 0.3, 0.09, 0.09, 0.1, 2, -s * 0.12],
      ].map((r) => [r[0], r[1] * m, r[2] * m, r[3] * m, r[4] || 2, r[5] || 0]);
    },
    af: armF, paintA: (s) => flayed(s > 0 ? 13 : 19, 1.3, 0.58), nuA: 15, nvA: 18,
    leg: () => [
      [P.ankleY - 0.01, 0.14, 0.14, 0.15],
      [P.ankleY + 0.1, 0.15, 0.15, 0.165],
      [P.kneeY - 0.4, 0.2, 0.18, 0.23],
      [P.kneeY - 0.15, 0.23, 0.2, 0.27],
      [P.kneeY + 0.03, 0.23, 0.24, 0.23],
      [P.thighY - 0.4, 0.29, 0.29, 0.27],
      [P.thighY - 0.12, 0.34, 0.34, 0.33],
      [P.thighY + 0.08, 0.35, 0.34, 0.36],
      [P.thighY + 0.22, 0.27, 0.27, 0.28],
    ],
    lf: () => field([{ t: 0, y: P.thighY - 0.3, st: 0.7, sy: 0.24, k: 0.05 }, { t: 0, y: P.kneeY + 0.02, st: 0.45, sy: 0.07, k: 0.04 }, { t: PI, y: P.kneeY - 0.22, st: 0.7, sy: 0.16, k: 0.05 }]),
    paintL: (s) => flayed(s > 0 ? 23 : 31, 1.5, 0.6),
  });
  const { T, arms } = B;
  const hr = P.headR;
  bossHead(mb, P, {
    face: { w: 1.12, brow: 2.5, jaw: 1.8, chin: 1.35, sockets: 2.6, rot: 1, cheek: 1.4 },
    skin: skinC, gaunt: 0.3, eye: 0xff3010, eyeGlow: 1, jawScale: 1.55, fang: true, nose: 0.2, cheekTear: 1,
  }, 1.12);
  // more eyes than a head has room for, up the left of its brow
  for (const [x, y, r] of [[-0.42, 1.38, 0.075], [-0.2, 1.52, 0.06], [-0.55, 1.12, 0.055], [0.3, 1.45, 0.05]]) {
    mb.ellip('head', [x * hr, hr * y, -hr * (0.86 - Math.abs(x) * 0.25)], [hr * r * 1.5, hr * r * 1.3, hr * r], { ws: 6, hs: 4, color: 0x2a0806, region: CR.FLESH, ao: false, blood: false, mottle: 0 });
    mb.ellip('head', [x * hr, hr * y, -hr * (0.9 - Math.abs(x) * 0.25)], [hr * r, hr * r * 0.85, hr * r * 0.7], { ws: 6, hs: 4, color: 0xff4020, glow: 1, region: CR.PLAIN, ao: false, blood: false, mottle: 0 });
  }
  // the mouth down its front: the ribs of the chest it opened, grown into teeth along both lips
  {
    const [t0, t1, y0, y1] = mawAt;
    for (let i = 0; i < 9; i++) {
      const u = (i + 0.5) / 9;
      const y = lerp(y0 + 0.05, y1 - 0.05, u);
      const wd = Math.sin(u * PI) ** 0.6;
      for (const s of [-1, 1]) {
        if ((i * 7 + (s > 0 ? 3 : 0)) % 11 === 0) continue; // (a gap or two)
        const a = surfPoint(T, s * lerp(0.1, t1 * 0.92, wd), y, -0.05);
        const len = (0.16 + 0.1 * wd) * (0.8 + ((i * 13 + s * 5) % 7) / 14);
        shard(mb, T.wts(y, a[0]), a, [a[0] - s * len * 0.75, a[1] + (s > 0 ? 0.03 : -0.03), a[2] - len * 0.75], 0.05, { rs: 4, color: 0xd2c6a4 });
      }
    }
    // a throat of gut behind them
    const c = surfPoint(T, 0, (y0 + y1) / 2, -0.24);
    bound(mb, T.wts((y0 + y1) / 2, 0), () => mb.ellip('root', c, [0.16, 0.26, 0.1], { ws: 8, hs: 7, color: 0x2a0606, region: CR.FLESH, mottle: 0.3, blood: false, noise: 0.02, nf: 12 }));
  }
  // withered extra arms beside it, on bones of their own (poseExtras): xarm -> xfarm
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const sy2 = P.chestY - 0.3;
    mb.addBone('xarm' + n, 'chest', s * 0.55, sy2, -0.35);
    mb.addBone('xfarm' + n, 'xarm' + n, s * 0.55, sy2 - 0.55, -0.35);
    const xa = mb.bi('xarm' + n), xf = mb.bi('xfarm' + n);
    const jw = jointW(xa, xf, sy2 - 0.55, 0.06);
    const x = s * 0.55, z = -0.35;
    ringLoft(mb, 'xarm' + n, [
      { c: [x - s * 0.06, sy2 + 0.14, z + 0.12], rx: 0.13 }, { c: [x, sy2, z], rx: 0.1 }, { c: [x, sy2 - 0.28, z], rx: 0.075 }, { c: [x, sy2 - 0.55, z], rx: 0.082 },
      { c: [x, sy2 - 0.8, z], rx: 0.062 }, { c: [x, sy2 - 1.03, z], rx: 0.05 }, { c: [x - s * 0.01, sy2 - 1.1, z], rx: 0.062, ry: 0.04 },
    ], { nu: 8, sub: 2, up: [0, 0, -1], color: 0xa48278, region: CR.ROT, mottle: 0.2, tint: skinT, wts: (p) => jw(p[1]), cap1: 0.03 });
    for (let f = 0; f < 3; f++) {
      limb(mb, 'xfarm' + n, [[x, sy2 - 1.1, z + (f - 1) * 0.045], [x - s * 0.03, sy2 - 1.24, z + (f - 1) * 0.07 - 0.02], [x - s * 0.07, sy2 - 1.36, z + (f - 1) * 0.085 - 0.07]], [0.022, 0.018, 0.012], { nu: 5, sub: 1, color: 0xa48278, region: CR.ROT });
      shard(mb, [xf, 1, 0, 0], [x - s * 0.07, sy2 - 1.35, z + (f - 1) * 0.085 - 0.07], [x - s * 0.12, sy2 - 1.47, z + (f - 1) * 0.09 - 0.13], 0.014, { color: 0x2a2016 });
    }
  }
  // the hands that slam and throw: the right the bigger, both clawed
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    bigHand(mb, 'hand' + n, s, { scale: s > 0 ? 4.3 : 3.4, curl: 0.5, spread: 1.1, thick: 1.25, fingerMul: 1.35, claws: s > 0 ? 0.2 : 0.16, skin: mulColor(skinC, 0.86), region: CR.ROT, tint: skinT, nu: 6 });
    bigFoot(mb, 'foot' + n, s, { w: 3.1, l: 2.3, h: 2.7, skin: mulColor(skinC, 0.88), region: CR.ROT, tint: skinT, claws: 0.09 });
  }
  // the hump: the people in it
  const cw = [mb.bi('chest'), 1, 0, 0];
  const body = { skin: mulColor(skinC, 1.08), tint: skinT };
  {
    const a = surfPoint(T, PI + 0.55, ySh + 0.12, -0.13);
    absorbed(mb, cw, a, [0.55, 0.5, 0.8], 0.21, { ...body, arm: 1 });
    const b = surfPoint(T, PI - 0.75, ySh - 0.1, -0.12);
    absorbed(mb, cw, b, [-0.8, 0.25, 0.7], 0.19, body);
    const c = surfPoint(T, -1.25, yC + 0.4, -0.11);
    absorbed(mb, cw, c, [-1, 0.1, -0.35], 0.18, body);
    const d = surfPoint(T, PI + 0.1, yC + 0.15, -0.1);
    absorbed(mb, T.wts(yC + 0.15, 0), d, [0.2, -0.1, 1], 0.17, body);
  }
  // the spines of all of them, come out through the back in a broken row
  const rnd = mulberry32(4242);
  for (let i = 0; i < 7; i++) {
    const y = yC - 0.1 + i * 0.2;
    const tt = PI + (i % 2 ? 0.16 : -0.14);
    const a = surfPoint(T, tt, y, -0.08);
    const len = 0.3 + rnd() * 0.3;
    shard(mb, T.wts(y, a[0]), a, [a[0] * 1.3, a[1] + len * 0.7, a[2] + len], 0.085, { rs: 4 });
  }
  shard(mb, [mb.bi('uarmR'), 1, 0, 0], surfPoint(arms[1], 2.0, ySh - 0.1, -0.06), [1.3, ySh + 0.25, 0.45], 0.09, { rs: 4 });
  shard(mb, [mb.bi('farmR'), 1, 0, 0], surfPoint(arms[1], 2.0, yE - 0.25, -0.06), [1.3, yE - 0.05, 0.5], 0.08, { rs: 4 });
  // sores that glow under the skin of its back and shoulders
  for (let i = 0; i < 6; i++) blister(mb, T, PI + (rnd() - 0.5) * 2.2, ySh - 0.5 + rnd() * 0.7, 0.07 + rnd() * 0.04, 0.6, { color: 0xffa040, glow: 0.9, rim: 0x5a1410, ws: 7, hs: 5 });
  // what it still wears of what they wore: rags round the hips
  const rc = [0x2a2622, 0x3a3428, 0x26303a, 0x4a2a22, 0x2e2e2a];
  for (let i = 0; i < 11; i++) {
    const t = (i / 11) * TAU + rnd() * 0.3;
    const a = surfPoint(T, t, yH + 0.08 + rnd() * 0.06, 0.02);
    rag(mb, 'hips', a, 0.5 + rnd() * 0.45, 0.22 + rnd() * 0.16, -t, { color: rc[i % rc.length], region: i % 2 ? CR.DENIM : CR.CLOTH, seed: i + 3, sway: 0.08, nv: 4 });
  }
  strap(mb, T, [0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8, 5.4, 6.0, TAU].map((t) => [t, yH + 0.12 + 0.03 * Math.sin(t * 2)]), 0.07, 0.02, { color: 0x2a2018, region: CR.LEATHER, segs: 36 });
  mb.aoStrength = 0.36;
  return { mb, P };
}

/**
 * The Hive Queen: a woman three and a half metres tall and starved to the bone, carrying a roost. Four jointed legs of
 * chitin have grown out of her back and hold up the sac that hangs behind her hips - plated above, lit green from
 * inside below, its back pocked with the cells her bats crawl out of. Scythes of the same stuff run back from her
 * forearms, a crown of it has come through her scalp, and her jaw has parted into mandibles. Her gown is still on her.
 */
function buildHiveQueen() {
  const P = humanP({
    hipY: 1.4, hipW: 0.16, thighLen: 0.68, shinLen: 0.64, spineLen: 0.34, chestLen: 0.42, neckOff: 0.4, neckLen: 0.26,
    headR: 0.24, shoulderW: 0.4, shoulderDrop: 0.08, uarmLen: 0.82, farmLen: 0.86, handLen: 0.34, headZ: -0.06, depth: 0.3,
  });
  const chit = 0x343a2a, skinC = 0x6a745c, gown = 0x1e1826;
  const mb = new MeshBuilder();
  mb.bloodColor = color(0x2a4a08);
  addHumanoidBones(mb, P);
  mb.dirt = { y0: 0.5, k: 0.5 };
  mb.blood([0, 3.0, -0.3], 0.2, 0.5);
  const yH = P.hipY, yS = P.spineY, yC = P.chestY, ySh = P.shoulderY, yE = P.elbowY, yW = P.wristY;
  const skinT = hide(71, 0x3a4a2a, 0x4a4458, 3);
  const ribs = (t, y) => {
    if (y < yC - 0.22 || y > yC + 0.24) return 0;
    const fr = clamp(Math.cos(t) * 0.6 + 0.6, 0, 1) * (Math.abs(Math.sin(t)) > 0.1 ? 1 : 0.25);
    const r = Math.abs(Math.sin(((y - yC + 0.22) * PI) / 0.075));
    return (r * r * 0.022 - 0.012) * fr;
  };
  const tf0 = field([
    { t: 0, y: yS + 0.1, st: 0.8, sy: 0.14, k: -0.035 }, // a belly sunk under the ribs
    { t: 0.9, y: yH + 0.04, st: 0.25, sy: 0.07, k: 0.03, sym: true }, // the points of the hips
    { t: 0.45, y: ySh - 0.02, st: 0.5, sy: 0.03, k: 0.02, sym: true }, // collarbones
    { t: PI, ridge: 't', st: 0.06, k: 0.02, y0: yH, y1: ySh + 0.1, fade: 0.06 }, // the spine standing out
    { t: PI - 0.55, y: yC + 0.2, st: 0.3, sy: 0.12, k: 0.03, sym: true }, // shoulder blades
  ]);
  const tf = (t, y) => tf0(t, y) + ribs(t, y) + (Math.abs(angDiff(t, PI)) < 0.12 ? 0.012 * Math.abs(Math.sin(y * 34)) : 0);
  const B = hulk(mb, P, {
    skin: { color: skinC, region: CR.ROT, mottle: 0.16, tint: skinT }, shade: 16,
    torso: [
      [1.2, 0.08, 0.08, 0.1, 2],
      [1.3, 0.2, 0.15, 0.2, 2.3],
      [1.42, 0.27, 0.18, 0.22, 2.4],
      [1.6, 0.2, 0.14, 0.16, 2.2],
      [1.78, 0.2, 0.15, 0.16, 2.2],
      [2.0, 0.28, 0.2, 0.2, 2.3],
      [2.2, 0.35, 0.23, 0.24, 2.4],
      [2.38, 0.4, 0.22, 0.26, 2.5],
      [2.48, 0.42, 0.19, 0.25, 2.5],
      [2.58, 0.3, 0.15, 0.2, 2.3],
      [2.66, 0.14, 0.1, 0.13, 2],
    ],
    tf, nu: 26, nvT: 28,
    neck: [0.088, 0.078], neckDown: 0.08,
    arm: (s) => [
      [yW - 0.01, 0.04, 0.036, 0.04],
      [yW + 0.1, 0.05, 0.045, 0.05],
      [yE - 0.3, 0.066, 0.06, 0.06],
      [yE - 0.05, 0.06, 0.055, 0.06],
      [yE + 0.03, 0.064, 0.06, 0.068],
      [yE + 0.3, 0.07, 0.07, 0.07],
      [ySh - 0.1, 0.086, 0.086, 0.086],
      [ySh + 0.02, 0.09, 0.086, 0.09],
      [ySh + 0.08, 0.05, 0.05, 0.05, 2, -s * 0.03],
      [ySh + 0.1, 0.015, 0.015, 0.015, 2, -s * 0.05],
    ],
    nuA: 10, nvA: 14,
    leg: () => [
      [P.ankleY - 0.01, 0.045, 0.045, 0.05],
      [P.ankleY + 0.08, 0.05, 0.05, 0.056],
      [P.kneeY - 0.3, 0.07, 0.06, 0.086],
      [P.kneeY - 0.05, 0.075, 0.075, 0.075],
      [P.kneeY + 0.05, 0.08, 0.086, 0.08],
      [P.thighY - 0.3, 0.105, 0.105, 0.1],
      [P.thighY - 0.05, 0.125, 0.125, 0.125],
      [P.thighY + 0.1, 0.12, 0.12, 0.125],
    ],
    nuL: 10, nvL: 10,
  });
  const { T, arms } = B;
  const hr = P.headR;
  const L = oldLook({
    sex: 'f', face: { w: 0.86, h: 1.05, d: 1.35, jaw: 0.9, chin: 1.2, sockets: 2.6, gaunt: 1, rot: 0.8, cheek: 1.5, noNose: true, fem: 0.4 },
    skin: skinC, gaunt: 1, eye: 0x90ff48, eyeGlow: 1.1, jawScale: 1.2, fang: true, nose: 0, missingTeeth: 0x10,
    hair: { color: 0x14100e, long: true },
    headTint: (lx, ly, lz, c) => lz > 0.05 && ly > 0 && c.lerp(color(chit), 0.5),
  });
  L.blood = null;
  L.hair = { style: 'long', color: 0x14100e, length: 0.3, ragged: 0.3 };
  const H = deadHead(mb, P, L);
  // a crown of chitin through the scalp: a fan of blades, the tallest at the back
  const hp = new THREE.Vector3();
  const hb = mb.bonePos('head');
  const hw = [mb.bi('head'), 1, 0, 0];
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) / 3; // -1..1 across the head
    headPoint(H, a * 1.5 + Math.sign(a || 1) * 0.5, 0.75 - Math.abs(a) * 0.22, hp);
    const base = [hb[0] + hp.x * 0.9, hb[1] + hp.y - 0.03, hb[2] + hp.z * 0.9];
    const len = hr * (1.5 - Math.abs(a) * 0.6);
    shard(mb, hw, base, [base[0] + a * len * 0.5, base[1] + len * 0.9, base[2] + len * 0.55], hr * 0.16, { rs: 4, color: i % 2 ? 0x4a5038 : chit });
  }
  // mandibles where the corners of her mouth were, on the jaw
  const jw = [mb.bi('jaw'), 1, 0, 0];
  for (const s of [-1, 1]) {
    headPoint(H, s * 0.75, -0.5, hp);
    const a = [hb[0] + hp.x, hb[1] + hp.y, hb[2] + hp.z];
    bound(mb, jw, () => ringLoft(mb, 'root', [
      { c: a, rx: 0.03, ry: 0.045 }, { c: [a[0] + s * 0.06, a[1] - 0.1, a[2] - 0.12], rx: 0.024, ry: 0.04 },
      { c: [a[0] + s * 0.02, a[1] - 0.18, a[2] - 0.26], rx: 0.016, ry: 0.028 }, { c: [a[0] - s * 0.06, a[1] - 0.2, a[2] - 0.34], rx: 0.004, ry: 0.006 },
    ], { nu: 6, sub: 2, color: 0x24281c, region: CR.CHITIN, mottle: 0.2, blood: false, cap0: 0.01 }));
  }
  // what is left of a gown: a bodice in tatters, its skirts hanging from the hips in strips
  sheet(mb, T, 0, TAU, yH + 0.02, yC + 0.2, 22, 12, 0.014, { color: gown, region: CR.CLOTH, mottle: 0.2, tint: bloodied(7, 0.4), tear: { amt: 0.36, f: 5.5, seed: 44, fn: (x, y, z) => z > 0.1 || y > yC + 0.12 + 0.1 * fbm3(x * 8, 0, z * 8, 2, 2) } });
  const rnd = mulberry32(606);
  for (let i = 0; i < 12; i++) {
    const t = -2.2 + (i / 11) * 4.4;
    const a = surfPoint(T, t, yH + 0.03 + rnd() * 0.04, 0.02);
    rag(mb, 'hips', a, 0.7 + rnd() * 0.55, 0.16 + rnd() * 0.1, -t, { color: i % 3 ? gown : 0x2a2030, region: CR.CLOTH, seed: i + 11, sway: 0.1, nv: 5, taper: 0.3 });
  }
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const A = arms[s < 0 ? 0 : 1];
    bigHand(mb, 'hand' + n, s, { scale: 1.6, curl: 0.5, spread: 1.1, fingerMul: 1.45, claws: 0.1, skin: mulColor(skinC, 0.85), region: CR.ROT, tint: skinT, nail: 0x1a1c12 });
    bigFoot(mb, 'foot' + n, s, { w: 1.3, l: 1.6, h: 1.3, skin: mulColor(skinC, 0.85), region: CR.ROT, tint: skinT, claws: 0.05 });
    // the scythe: a blade of chitin out of the back of the forearm, running back past the elbow
    const e = surfPoint(A, PI, yE - 0.3, -0.02);
    bound(mb, [mb.bi('farm' + n), 1, 0, 0], () => ringLoft(mb, 'root', [
      { c: [e[0], yE - 0.5, e[2] - 0.02], rx: 0.012, ry: 0.03 }, { c: [e[0], yE - 0.25, e[2] + 0.05], rx: 0.022, ry: 0.075 },
      { c: [e[0] + s * 0.01, yE + 0.05, e[2] + 0.12], rx: 0.02, ry: 0.07 }, { c: [e[0] + s * 0.02, yE + 0.32, e[2] + 0.2], rx: 0.012, ry: 0.04 }, { c: [e[0] + s * 0.03, yE + 0.52, e[2] + 0.3], rx: 0.003, ry: 0.006 },
    ], { nu: 6, sub: 2, up: [0, 0, 1], color: chit, region: CR.CHITIN, mottle: 0.25, blood: false, cap0: 0.01, tint: (p, nn, c) => p.z > e[2] + 0.1 && c.lerp(color(0x8a8a60), 0.35) }));
    // plates of it over the shoulders
    bound(mb, [mb.bi('chest'), 1, 0, 0], () => mb.ellip('root', [s * 0.38, ySh + 0.07, 0.03], [0.2, 0.09, 0.19], { ws: 9, hs: 6, color: chit, region: CR.CHITIN, rot: [0, 0, -s * 0.45], noise: 0.012, nf: 9 }));
  }
  // the cells of the roost, down her back between the legs' roots: dark holes in a crust of wax
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 4 - (j % 2); i++) {
      const t = PI + (i - (3 - (j % 2)) / 2) * 0.3, y = yC - 0.14 + j * 0.105;
      blister(mb, T, t, y, 0.05, 0.5, { color: 0x100c08, glow: 0, region: CR.FLESH, rim: 0x8e8454, ws: 6, hs: 4 });
    }
  }
  // the sac (own bone, child of the hips): hung behind her, tilted up, swollen in the middle
  mb.addBone('abdomen', 'hips', 0, P.hipY + 0.08, 0.22);
  const ern = mulberry32(77);
  const sacRings = (grow) => [
    { c: [0, 1.5, 0.16], rx: 0.14, ry: 0.14 }, { c: [0, 1.55, 0.4], rx: 0.3, ru: 0.26, rd: 0.3 }, { c: [0, 1.63, 0.74], rx: 0.5, ru: 0.4, rd: 0.5 },
    { c: [0, 1.7, 1.1], rx: 0.58, ru: 0.44, rd: 0.56 }, { c: [0, 1.75, 1.45], rx: 0.5, ru: 0.38, rd: 0.48 }, { c: [0, 1.81, 1.74], rx: 0.31, ru: 0.24, rd: 0.29 }, { c: [0, 1.87, 1.92], rx: 0.1, ry: 0.1 },
  ].map((r) => ({ c: r.c, rx: r.rx + grow, ru: (r.ru ?? r.ry) + grow, rd: (r.rd ?? r.ry) + grow }));
  const band = (s) => Math.pow(Math.abs(Math.sin(s * PI * 5.5)), 6);
  ringLoft(mb, 'abdomen', sacRings(0), {
    nu: 18, sub: 4, color: 0x8cf050, region: CR.GLOW, glow: 0.5, mottle: 0.25, blood: false, cap0: 0.02, cap1: 0.05,
    dr: (s) => -0.035 * band(s),
    paint: (s, a, c, p) => {
      c.lerp(color(0x1c2216), band(s) * 0.85); // the grooves between its segments
      // what is in it, seen through the skin: dark shapes hanging in the light
      const m = fbm3(p.x * 5, p.y * 5, p.z * 5, 2, 9);
      if (m > 0.54) c.lerp(color(0x162a0c), clamp((m - 0.54) * 7, 0, 0.9));
      if (Math.abs(fbm3(p.x * 3, p.y * 7, p.z * 3, 2, 21) - 0.5) < 0.02) c.lerp(color(0x1e3a10), 0.8); // veins
    },
  });
  // plates of chitin over its back, one a segment, a gap between each
  ringLoft(mb, 'abdomen', sacRings(0.025), {
    nu: 18, sub: 4, color: 0x2a3020, region: CR.CHITIN, mottle: 0.3, blood: false, cap0: 0.02,
    tear: { amt: 0, fn: (x, y, z) => y < 1.5 + (z - 0.16) * 0.21 + 0.1 + 0.05 * Math.sin(z * 9) || band((z - 0.16) / 1.76) > 0.45 },
    tint: (p, nn, c) => c.lerp(color(0x5a6040), clamp((fbm3(p.x * 9, p.y * 9, p.z * 9, 2, 3) - 0.5) * 3, 0, 0.5)),
  });
  bound(mb, [mb.bi('abdomen'), 1, 0, 0], () => {
    // the mouths of the roost along its back
    for (let i = 0; i < 9; i++) {
      const z = 0.5 + ern() * 1.15, x = (ern() - 0.5) * 0.5;
      const y = 1.55 + (z - 0.4) * 0.2 + 0.4 * Math.sin(clamp((z - 0.2) / 1.7, 0, 1) * PI) * Math.sqrt(Math.max(0.1, 1 - (x / 0.5) ** 2)) + 0.02;
      mb.ellip('root', [x, y, z], [0.07, 0.03, 0.075], { ws: 7, hs: 4, color: 0x0c0a06, region: CR.FLESH, blood: false, mottle: 0.1, rot: [0.2, 0, -x * 1.2], tint: (p, nn, c) => nn.y < 0.6 && c.lerp(color(0x8e8454), 0.8) });
    }
    // eggs through the skin of its underside
    for (let i = 0; i < 7; i++) {
      const z = 0.55 + ern() * 1.1, a = (ern() - 0.5) * 1.9;
      const k = Math.sin(clamp((z - 0.16) / 1.76, 0, 1) * PI);
      mb.ellip('root', [Math.sin(a) * 0.56 * k, 1.56 + (z - 0.4) * 0.2 - Math.cos(a) * 0.52 * k, z], [0.085, 0.085, 0.1], { ws: 7, hs: 5, color: 0xc8ff90, glow: 0.85, region: CR.GLOW, ao: false, blood: false });
    }
    mb.ellip('root', [0, 1.5, 0.3], [0.22, 0.22, 0.26], { ws: 8, hs: 6, color: chit, region: CR.CHITIN });
  });
  // four legs out of her back: sleg{i} (upper) -> slegb{i} (lower)
  const legsS = [[-1, 0.0], [1, 0.0], [-1, 0.25], [1, 0.25]];
  for (let i = 0; i < 4; i++) {
    const [s, zo] = legsS[i];
    const by = P.chestY - 0.05 - zo * 0.8, bz = 0.2 + zo;
    mb.addBone('sleg' + i, 'chest', s * 0.2, by, bz);
    const kx = s * 0.95, ky = by + 0.75, kz = bz + 0.35 + zo;
    mb.addBone('slegb' + i, 'sleg' + i, kx, ky, kz);
    const a = [s * 0.2, by, bz], k = [kx, ky, kz], f = [kx + s * 0.55, 0.02, kz + 0.25 + zo * 1.5];
    const mid = (p, q, u, lift = 0) => [lerp(p[0], q[0], u), lerp(p[1], q[1], u) + lift, lerp(p[2], q[2], u)];
    const co = { color: chit, region: CR.CHITIN, mottle: 0.25, blood: false };
    ringLoft(mb, 'sleg' + i, [{ c: mid(a, k, -0.12), rx: 0.1 }, { c: a, rx: 0.085 }, { c: mid(a, k, 0.3, 0.03), rx: 0.06 }, { c: mid(a, k, 0.75, 0.02), rx: 0.05 }, { c: k, rx: 0.075 }], { nu: 7, sub: 2, ...co, cap1: 0.03 });
    ringLoft(mb, 'slegb' + i, [{ c: k, rx: 0.08 }, { c: mid(k, f, 0.12), rx: 0.055 }, { c: mid(k, f, 0.5, 0), rx: 0.05, ry: 0.036 }, { c: mid(k, f, 0.85), rx: 0.03, ry: 0.022 }, { c: f, rx: 0.006 }], { nu: 7, sub: 2, ...co, color: 0x2a3020, cap0: 0.03, tint: (p, nn, c) => p.y < 0.5 && c.lerp(color(0x8a8a60), 0.3 * (1 - p.y / 0.5)) });
    // spurs down the shin
    for (let j = 0; j < 3; j++) {
      const p = mid(k, f, 0.25 + j * 0.2);
      shard(mb, [mb.bi('slegb' + i), 1, 0, 0], p, [p[0] + s * 0.1, p[1] + 0.12, p[2] + 0.06], 0.022, { color: 0x4a5038 });
    }
  }
  void rnd;
  return { mb, P };
}

// ------------------------------------------------------------------ bat
/**
 * The bat: a big fruit bat's frame gone to rot. A furred barrel of a body with the ribs through one side, a fox's
 * head with tall ears, a leaf of a nose and long fangs, and wings that are an arm and a hand: upper arm, forearm, a
 * hooked thumb at the wrist, three fingers fanned through a membrane that is torn at its edge and holed between them.
 */
function buildBat() {
  const mb = new MeshBuilder();
  mb.addBone('root', null, 0, 0, 0);
  mb.addBone('body', 'root', 0, 0, 0);
  mb.addBone('head', 'body', 0, 0.03, -0.13);
  mb.addBone('jaw', 'head', 0, -0.01, -0.03);
  const fur = 0x54443c, skinC = 0x5a3c3a, mem = 0x7c4c46;
  const body = [mb.bi('body'), 1, 0, 0], head = [mb.bi('head'), 1, 0, 0], jaw = [mb.bi('jaw'), 1, 0, 0];
  const furT = (p, n, c) => {
    const m = fbm3(p.x * 30, p.y * 30, p.z * 30, 2, 7);
    if (m > 0.6) c.lerp(color(0x7c6a64), Math.min(0.8, (m - 0.6) * 6)); // mange
    if (n.y < -0.3) c.multiplyScalar(1.25); // a paler belly
  };
  // the body: shoulders the widest of it, tapering to the rump
  ringLoft(mb, 'body', [
    { c: [0, -0.012, 0.215], rx: 0.016, ry: 0.014 }, { c: [0, -0.008, 0.16], rx: 0.036, ry: 0.032 }, { c: [0, -0.002, 0.08], rx: 0.054, ry: 0.05 },
    { c: [0, 0.004, 0.0], rx: 0.066, ru: 0.058, rd: 0.064 }, { c: [0, 0.012, -0.065], rx: 0.058, ru: 0.052, rd: 0.05 }, { c: [0, 0.024, -0.115], rx: 0.036, ry: 0.034 },
  ], {
    nu: 9, sub: 2, color: fur, region: CR.HAIR, mottle: 0.25, mf: 50, tint: furT, cap0: 0.012,
    dr: (s, a) => 0.005 * Math.sin(a * 7 + s * 23) * Math.sin(s * PI), // a ragged pelt
    tear: { amt: 0, fn: (x, y, z) => x > 0.03 && Math.hypot((z - 0.005) / 0.055, (y + 0.005) / 0.04) < 1 },
  });
  // the ribs through its right side
  bound(mb, body, () => {
    mb.ellip('root', [0.036, -0.004, 0.005], [0.02, 0.036, 0.05], { ws: 6, hs: 5, color: 0x3a0a08, region: CR.GORE, mottle: 0.3, blood: false });
    for (let i = 0; i < 4; i++) {
      const z = -0.035 + i * 0.026;
      mb.tube('root', [[0.04, 0.03, z], [0.058, 0.002, z + 0.004], [0.048, -0.03, z + 0.008]], 0.0034, 0.0028, { rs: 3, ts: 4, color: 0xc8bc9c, region: CR.BONE, blood: false, cap: false });
    }
  });
  // head: a long skull, a short snout, the lips off the teeth
  ringLoft(mb, 'head', [
    { c: [0, 0.03, -0.1], rx: 0.03, ry: 0.03 }, { c: [0, 0.038, -0.135], rx: 0.043, ru: 0.04, rd: 0.036 }, { c: [0, 0.036, -0.168], rx: 0.038, ru: 0.03, rd: 0.03 },
    { c: [0, 0.03, -0.195], rx: 0.024, ru: 0.02, rd: 0.018 }, { c: [0, 0.027, -0.214], rx: 0.015, ru: 0.013, rd: 0.011 },
  ], {
    nu: 8, sub: 2, color: fur, region: CR.HAIR, mottle: 0.25, mf: 50, cap1: 0.006,
    tint: (p, n, c) => {
      furT(p, n, c);
      if (p.z < -0.185 && p.y < 0.03) c.lerp(color(0x4a0e10), 0.8);
    },
  });
  bound(mb, head, () => {
    // a nose-leaf standing up off the snout
    mb.spike('root', [0, 0.036, -0.212], [0, 0.064, -0.208], 0.011, { rs: 4, color: skinC, region: CR.MEMBRANE });
    mb.ellip('root', [0, 0.03, -0.218], [0.009, 0.007, 0.006], { ws: 5, hs: 3, color: 0x120c0c, region: CR.PLAIN, mottle: 0 });
    for (const s of [-1, 1]) {
      // tall ears, their insides bare
      for (const inner of [false, true]) {
        const g = new THREE.ConeGeometry(inner ? 0.02 : 0.03, inner ? 0.085 : 0.11, 4, 1);
        g.rotateY(PI / 4);
        g.scale(1, 1, 0.4);
        g.translate(0, inner ? 0.04 : 0.05, inner ? -0.006 : 0);
        g.rotateZ(-s * 0.42);
        g.rotateX(0.2);
        g.translate(s * 0.03, 0.066, -0.118);
        mb.geom('root', g, { color: inner ? 0x7a4a48 : mulColor(fur, 0.8), region: inner ? CR.MEMBRANE : CR.HAIR, mottle: 0.2 });
      }
      mb.ellip('root', [s * 0.026, 0.048, -0.172], [0.011, 0.0095, 0.008], { ws: 5, hs: 3, color: 0x1c0808, region: CR.FLESH, ao: false, mottle: 0 });
      mb.ellip('root', [s * 0.0275, 0.0485, -0.1765], [0.0078, 0.007, 0.0055], { ws: 5, hs: 3, color: 0xff2010, glow: 1, region: CR.PLAIN, ao: false, mottle: 0, blood: false });
      mb.spike('root', [s * 0.011, 0.022, -0.203], [s * 0.012, -0.006, -0.206], 0.0045, { rs: 4, color: 0xe8e0c8, region: CR.BONE, blood: false });
      mb.spike('root', [s * 0.019, 0.022, -0.19], [s * 0.019, 0.01, -0.191], 0.003, { rs: 3, color: 0xe8e0c8, region: CR.BONE, blood: false });
    }
  });
  ringLoft(mb, 'jaw', [{ c: [0, 0.014, -0.14], rx: 0.026, ru: 0.006, rd: 0.012 }, { c: [0, 0.012, -0.175], rx: 0.02, ru: 0.006, rd: 0.01 }, { c: [0, 0.012, -0.204], rx: 0.011, ru: 0.005, rd: 0.007 }], {
    nu: 6, sub: 1, color: fur, region: CR.HAIR, mottle: 0.25, cap0: 0.004, cap1: 0.004,
    tint: (p, n, c) => n.y > 0.4 && c.copy(color(0x3a0a0a)),
  });
  bound(mb, jaw, () => {
    for (const s of [-1, 1]) mb.spike('root', [s * 0.008, 0.015, -0.198], [s * 0.008, 0.034, -0.2], 0.0036, { rs: 4, color: 0xe8e0c8, region: CR.BONE, blood: false });
  });
  // wings: w1 (upper arm) -> w2 (forearm) -> w3 (the hand)
  const memO = { color: mem, region: CR.MEMBRANE, double: true, mottle: 0.25 };
  const blend = (a, b, t) => (t <= 0 ? [a, 1, b, 0] : t >= 1 ? [b, 1, a, 0] : [a, 1 - t, b, t]);
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    mb.addBone('w1' + n, 'body', s * 0.06, 0.02, -0.04);
    mb.addBone('w2' + n, 'w1' + n, s * 0.24, 0.03, -0.02);
    mb.addBone('w3' + n, 'w2' + n, s * 0.44, 0.02, 0.02);
    const b1 = mb.bi('w1' + n), b2 = mb.bi('w2' + n), b3 = mb.bi('w3' + n);
    const J0 = [s * 0.06, 0.02, -0.04], J1 = [s * 0.24, 0.03, -0.02], J2 = [s * 0.44, 0.02, 0.02];
    const F = [[s * 0.62, 0.0, 0.0], [s * 0.6, 0.01, 0.16], [s * 0.5, 0.02, 0.26]]; // the fingers' tips
    const R0 = [s * 0.035, -0.02, 0.2]; // where the membrane meets the leg
    const L3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    // the arm: fur on the upper arm, bare bone-thin forearm, a hooked thumb at the wrist
    ringLoft(mb, 'w1' + n, [{ c: L3(J0, J1, -0.15), rx: 0.02 }, { c: J0, rx: 0.019 }, { c: L3(J0, J1, 0.6), rx: 0.013 }, { c: J1, rx: 0.012 }], { nu: 5, sub: 1, color: fur, region: CR.HAIR, mottle: 0.25, tint: furT });
    ringLoft(mb, 'w2' + n, [{ c: J1, rx: 0.012 }, { c: L3(J1, J2, 0.5), rx: 0.008 }, { c: J2, rx: 0.009 }], { nu: 5, sub: 1, color: skinC, region: CR.MEMBRANE, mottle: 0.2 });
    bound(mb, [b3, 1, 0, 0], () => {
      mb.spike('root', J2, [J2[0] + s * 0.02, J2[1] + 0.022, J2[2] - 0.055], 0.006, { rs: 4, color: 0x1a1410, region: CR.BONE });
      for (const f of F) mb.tube('root', [J2, L3(J2, f, 0.55), f], 0.0062, 0.0022, { rs: 3, ts: 3, color: skinC, region: CR.MEMBRANE, cap: false });
    });
    // the membrane from the arm back to the leg and out to the third finger: one sheet, bending at the elbow and wrist
    {
      const nu = 9, nv = 4;
      const pos = [], idx = [], wts = [], uv = [];
      const lead = (u) => (u < 0.47 ? L3(J0, J1, u / 0.47) : L3(J1, J2, (u - 0.47) / 0.53));
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const a = lead(u);
        const tr = L3(R0, F[2], u);
        tr[2] -= 0.05 * Math.sin(u * PI); // the trailing edge drawn in between the leg and the finger
        const w = u < 0.39 ? [b1, 1, b2, 0] : u < 0.55 ? blend(b1, b2, (u - 0.39) / 0.16) : u < 0.8 ? [b2, 1, b3, 0] : blend(b2, b3, (u - 0.8) / 0.2);
        for (let j = 0; j <= nv; j++) {
          const v = j / nv;
          const p = L3(a, tr, v);
          pos.push(p[0], p[1] - 0.008 * Math.sin(v * PI) * (0.5 + u), p[2] + (j === nv ? 0.012 * Math.sin(u * 40 + s) : 0));
          uv.push(u, v);
          wts.push(...(u < 0.12 && v > 0.5 ? blend(b1, body[0], (v - 0.5) * 1.4) : w));
        }
      }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
        if (s > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      mb.geom('root', geo, { ...memO, keepNormals: true, wts: new Float32Array(wts), tear: { amt: 0.33, f: 16, seed: s > 0 ? 3 : 8 } });
    }
    // ...and between the fingers, on the hand: each web's edge scalloped back toward the wrist
    for (let k = 0; k < 2; k++) {
      const fa = F[k + 1], fb = F[k];
      const nu = 4, nv = 2;
      const pos = [], idx = [];
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const e = L3(fa, fb, u);
        const sag = 0.3 * Math.sin(u * PI);
        const edge = L3(e, J2, sag);
        for (let j = 0; j <= nv; j++) {
          const p = L3(J2, edge, j / nv);
          pos.push(p[0], p[1] - 0.006 * Math.sin((j / nv) * PI), p[2]);
        }
      }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
        if (s > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      bound(mb, [b3, 1, 0, 0], () => mb.geom('root', geo, { ...memO, keepNormals: true, tear: { amt: 0.3, f: 22, seed: 11 + k + (s > 0 ? 0 : 5) } }));
    }
  }
  // legs trailing behind, hooked feet, a scrap of membrane between them
  bound(mb, body, () => {
    for (const s of [-1, 1]) {
      mb.tube('root', [[s * 0.026, -0.022, 0.12], [s * 0.04, -0.03, 0.18], [s * 0.046, -0.045, 0.235]], 0.011, 0.006, { rs: 4, ts: 3, color: skinC, region: CR.MEMBRANE, cap: false });
      for (let c = 0; c < 3; c++) mb.spike('root', [s * 0.046, -0.045, 0.235], [s * (0.04 + c * 0.008), -0.075, 0.245 + c * 0.004], 0.004, { rs: 3, color: 0x1a1410, region: CR.BONE });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.03, -0.022, 0.13, 0.03, -0.022, 0.13, -0.044, -0.04, 0.225, 0.044, -0.04, 0.225, 0, -0.03, 0.2], 3));
    g.setIndex([0, 2, 4, 0, 4, 1, 1, 4, 3]);
    g.computeVertexNormals();
    mb.geom('root', g, { ...memO, keepNormals: true });
  });
  mb.blood([0, 0.02, -0.2], 0.04, 1);
  mb.dirt = null;
  mb.aoStrength = 0.15;
  return { mb, P: null };
}


// ------------------------------------------------------------------ rig cache + calibration
const BUILDERS = {
  [ZTYPE.WALKER]: buildWalker,
  [ZTYPE.RUNNER]: buildRunner,
  [ZTYPE.TANK]: buildTank,
  [ZTYPE.SPITTER]: buildSpitter,
  [ZTYPE.LEAPER]: buildLeaper,
  [ZTYPE.ROPER]: buildRoper,
  [ZTYPE.BOOMER]: buildBoomer,
  [ZTYPE.BAT]: buildBat,
  [ZTYPE.BOSS_ABOMINATION]: buildAbomination,
  [ZTYPE.BOSS_HIVEQUEEN]: buildHiveQueen,
  [ZTYPE.SHADE]: buildShade,
  [ZTYPE.BOSS_BRUTE]: buildBrute,
  [ZTYPE.BOSS_BLOATER]: buildBloater,
};
const VARIANTS = { [ZTYPE.WALKER]: WALKER_VARIANTS, [ZTYPE.RUNNER]: 3, [ZTYPE.DOG]: DOG_COATS };
const NO_EXTRAS = {};

const rigCache = new Map();
// The detail a rig is built at (standardHumanoid reads it): 1 near, LOD_DETAIL for the far copy of the humanoid dead.
let buildDetail = 1;
const LOD_DETAIL = 0.5;
const LOD_FAR = 15, LOD_NEAR = 12; // (m: at 15 m a walker is some 140 px tall on a 1080p screen)
// (types whose far copy is worth having: everything people.js builds whole)
const LOD_TYPES = new Set([ZTYPE.WALKER, ZTYPE.RUNNER, ZTYPE.SPITTER, ZTYPE.LEAPER, ZTYPE.ROPER, ZTYPE.BOOMER, ZTYPE.SHADE]);
function getRig(type, variant, far = false) {
  if (far && !LOD_TYPES.has(type)) return null;
  const key = type + ':' + variant + (far ? ':far' : '');
  let r = rigCache.get(key);
  if (!r) {
    buildDetail = far ? LOD_DETAIL : 1;
    try {
      const { mb, P, A } = BUILDERS[type](variant);
      r = mb.build();
      r.P = P;
      r.A = A || NO_EXTRAS; // per-variant animation quirks (e.g. dislocated jaw)
      r.shin = mb.shin;
      r.type = type;
    } finally {
      buildDetail = 1;
    }
    rigCache.set(key, r);
  }
  return r;
}

// ------------------------------------------------------------------ animation styles
const ZS = {
  [ZTYPE.WALKER]: {
    walkLean: -0.6, runLean: -0.6, cycleWalk: 1.3, cycleRun: 2.0, limp: 0.65, headPitch: -0.15, headTilt: 0.28, jaw: 0.22,
    idleLean: -0.45, reachArms: true, shoulderRoll: 0.18,
    // planted-foot gait (poseGait): a hunched, lurching shamble that drags the limp leg
    gWalk: {
      ref: 1.9, duty: 0.62, lift: 0.07, strike: 0.22, toeOff: -0.55, rollIn: 0.15, heelOff: 0.62, bias: -0.03, width: 0.03, ext: 0.985, bob: 0, vault: 0.7, vt: 0.7,
      hipYaw: 0.16, drop: 0.08, hike: 0.12, sway: 0.055, roll: 0.12, nod: 0.07, headRoll: 0.18, droop: 0.1, armSwing: 0.32, elbow: 0.22, stumble: true, hipLean: 0.2,
    },
    gRun: {
      ref: 3.5, duty: 0.54, lift: 0.1, strike: 0.2, toeOff: -0.6, rollIn: 0.15, heelOff: 0.55, bias: -0.05, width: 0.03, ext: 0.98, bob: 0, vault: 0.5, vt: 0.7,
      hipYaw: 0.18, drop: 0.07, hike: 0.12, sway: 0.045, roll: 0.1, nod: 0.09, headRoll: 0.15, droop: 0.2, armSwing: 0.45, elbow: 0.3, stumble: true, hipLean: 0.2,
    },
  },
  [ZTYPE.RUNNER]: {
    walkLean: -0.75, runLean: -0.95, cycleWalk: 1.2, cycleRun: 2.9, limp: 0, headPitch: 0.25, headTilt: 0.15, jaw: 0.35,
    idleLean: -0.6, twitchy: 1,
    // stalking prowl: crouched, quick light steps, arms hanging forward
    gWalk: {
      ref: 2.2, duty: 0.6, lift: 0.08, strike: 0.1, toeOff: -0.6, rollIn: 0.12, heelOff: 0.55, bias: -0.04, width: 0.03, ext: 0.92, bob: 0.015, vt: 0.7,
      hipYaw: 0.12, drop: 0.04, sway: 0.03, roll: 0.05, nod: 0.05, headRoll: 0.06, droop: 0.4, armSwing: 0.22, elbow: 0.5, hipLean: 0.25, head: 0, neck: 0.45,
    },
    // feral sprint: flight phase, heels kicked up behind, forefoot landings
    gRun: {
      ref: 5.6, duty: 0.34, lift: 0.36, liftPow: 0.62, strike: 0.02, toeOff: -0.95, rollIn: 0.1, heelOff: 0.35, bias: -0.1, width: 0, ext: 0.99, vt: 0.8,
      pitchRate: 1.4, comp: 0.02, flight: 0.05, hipYaw: 0.2, drop: 0.04, sway: 0.015, roll: 0.03, nod: 0.1, sprint: true, asym: true, hipLean: 0.3,
    },
  },
  [ZTYPE.SPITTER]: {
    walkLean: -0.35, runLean: -0.5, cycleWalk: 1.45, cycleRun: 2.3, walkStride: 0.38, walkKnee: 0.6, runStride: 0.65, runKnee: 1.1,
    limp: 0.25, sway: 1.2, armWalk: 0.3, armDroop: 0.12, armSwing: 0.25, armRun: 0.6, elbow: 0.5, headPitch: 0.05, headTilt: 0.2, jaw: 0.3, neckFwd: 0.55,
    idleLean: -0.35,
  },
  [ZTYPE.LEAPER]: {
    walkLean: -1.0, runLean: -1.05, cycleWalk: 1.2, cycleRun: 2.6, walkStride: 0.45, walkKnee: 0.7, runStride: 0.7, runKnee: 0.9,
    baseT: 1.05, baseK: 1.75, limp: 0, sway: 0.4, elbow: 0.4, headPitch: 0.2, headTilt: 0.1, jaw: 0.25, quad: true,
    idleLean: -1.05,
  },
  [ZTYPE.ROPER]: {
    walkLean: -0.18, runLean: -0.26, cycleWalk: 1.5, cycleRun: 2.1, walkStride: 0.38, walkKnee: 0.55, runStride: 0.5, runKnee: 0.9,
    limp: 0.35, sway: 0.8, armWalk: 0.25, armDroop: 0.1, armSwing: 0.22, armRun: 0.7, elbow: 0.3, headPitch: -0.1, headTilt: 0.35, jaw: 0.35,
    idleLean: -0.15,
  },
  [ZTYPE.BOOMER]: {
    walkLean: 0.08, runLean: -0.02, cycleWalk: 1.0, cycleRun: 1.5, walkStride: 0.3, walkKnee: 0.45, runStride: 0.38, runKnee: 0.6,
    limp: 0, sway: 2.2, waddle: 1, armWalk: 0.15, armDroop: 0.1, armSwing: 0.2, armRun: 0.4, armOut: 0.35, elbow: 0.25, headPitch: 0.0, headTilt: 0.1, jaw: 0.25,
    legSplay: 0.1, idleLean: 0.05,
  },
  [ZTYPE.TANK]: {
    walkLean: -0.5, runLean: -0.58, cycleWalk: 2.0, cycleRun: 3.2, walkStride: 0.38, walkKnee: 0.5, runStride: 0.45, runKnee: 0.7,
    limp: 0, sway: 0.6, knuckle: true, elbow: 0.3, headPitch: 0.35, headTilt: 0.05, jaw: 0.2, legSplay: 0.12, idleLean: -0.45,
  },
  [ZTYPE.BOSS_ABOMINATION]: {
    walkLean: -0.3, runLean: -0.45, cycleWalk: 3.0, cycleRun: 4.2, walkStride: 0.35, walkKnee: 0.5, runStride: 0.5, runKnee: 0.75,
    limp: 0.3, sway: 0.7, armWalk: 0.35, armDroop: 0.15, armSwing: 0.25, armRun: 0.6, elbow: 0.4, headPitch: 0.2, headTilt: 0.1, jaw: 0.3, legSplay: 0.1,
    idleLean: -0.3, roar: true,
  },
  [ZTYPE.BOSS_HIVEQUEEN]: {
    walkLean: -0.25, runLean: -0.4, cycleWalk: 2.6, cycleRun: 3.6, walkStride: 0.4, walkKnee: 0.7, runStride: 0.55, runKnee: 0.9,
    limp: 0, sway: 0.5, armWalk: 0.7, armDroop: 0.7, armSwing: 0.12, armRun: 0.9, elbow: 1.9, headPitch: 0.25, headTilt: 0.1, jaw: 0.3, legSplay: 0.08,
    idleLean: -0.25, mantis: true,
  },
  [ZTYPE.SHADE]: {
    // long, low strides with both clawed hands reaching ahead: whatever stride the light catches is the statue it becomes
    walkLean: -0.32, runLean: -0.6, cycleWalk: 1.7, cycleRun: 3.3, walkStride: 0.42, walkKnee: 0.6, runStride: 0.75, runKnee: 1.1,
    limp: 0, sway: 0.5, armWalk: 0.55, armDroop: 0.35, armSwing: 0.1, armRun: 1.05, armOut: 0.22, elbow: 0.4, headPitch: 0.3, headTilt: 0.3, jaw: 0.45, neckFwd: 0.45,
    idleLean: -0.28, shoulderRoll: 0.2,
  },
  [ZTYPE.BOSS_BRUTE]: {
    // a heavy, rolling waddle under the gut, fists swinging wide of it; enraged (RUN) it lumbers in bent forward
    walkLean: -0.16, runLean: -0.42, cycleWalk: 2.1, cycleRun: 3.1, walkStride: 0.3, walkKnee: 0.42, runStride: 0.5, runKnee: 0.85,
    limp: 0, sway: 1.5, waddle: 1, armWalk: 0.2, armDroop: 0.08, armSwing: 0.3, armRun: 0.55, armOut: 0.34, elbow: 0.35, headPitch: 0.12, headTilt: 0.06, jaw: 0.3,
    legSplay: 0.12, idleLean: -0.1, neckFwd: 0.1, shoulderRoll: 0.05,
  },
  [ZTYPE.BOSS_BLOATER]: {
    // the boomer's waddle, slower and wider, leaning back to carry the gut
    walkLean: 0.1, runLean: 0.0, cycleWalk: 1.75, cycleRun: 2.4, walkStride: 0.28, walkKnee: 0.4, runStride: 0.34, runKnee: 0.55,
    limp: 0, sway: 2.6, waddle: 1, armWalk: 0.18, armDroop: 0.12, armSwing: 0.18, armRun: 0.35, armOut: 0.55, elbow: 0.3, headPitch: 0.05, headTilt: 0.12, jaw: 0.35,
    legSplay: 0.16, idleLean: 0.08, neckFwd: 0.05,
  },
};

// ------------------------------------------------------------------ pose helpers (pose = Float32Array[nb*4 + 3])
function clearPose(p, nb) {
  for (let i = 0; i < nb; i++) {
    const k = i * 4;
    p[k] = 0;
    p[k + 1] = 0;
    p[k + 2] = 0;
    p[k + 3] = 1;
  }
  p[nb * 4] = 0;
  p[nb * 4 + 1] = 0;
  p[nb * 4 + 2] = 0;
}
function R(p, b, x, y, z) {
  const k = b * 4;
  p[k] = x;
  p[k + 1] = y;
  p[k + 2] = z;
}
function A(p, b, x, y, z) {
  const k = b * 4;
  p[k] += x;
  p[k + 1] += y;
  p[k + 2] += z;
}
const chestPitch = (p) => p[HIPS * 4] + p[SPINE * 4] + p[CHEST * 4];

/** Arm with WORLD-ish pitch (compensating torso lean). side 0 = left, 1 = right. */
function arm(p, side, pitch, abd, twist, elbow, wrist = 0) {
  const ua = side ? UARM_R : UARM_L;
  const sg = side ? 1 : -1;
  const k = ua * 4;
  p[k] = pitch - chestPitch(p);
  p[k + 1] = twist * sg;
  p[k + 2] = abd * sg;
  p[(ua + 1) * 4] = elbow;
  p[(ua + 2) * 4] = wrist;
}
function headLook(p, pitch, yaw, roll, neckShare = 0.45) {
  const need = pitch - chestPitch(p) - p[NECK * 4] - p[HEAD * 4];
  p[NECK * 4] += need * neckShare;
  p[HEAD * 4] += need * (1 - neckShare);
  p[NECK * 4 + 1] += yaw * 0.4;
  p[HEAD * 4 + 1] += yaw * 0.6;
  p[HEAD * 4 + 2] += roll;
}
/** Leg cycle; grounds the body via root y. */
function legCycle(z, p, ph, amp, knee, baseT, baseK, limp, splay = 0) {
  const P = z.P;
  let ext = -1;
  for (let side = 0; side < 2; side++) {
    const th = side ? THIGH_R : THIGH_L;
    const phi = ph + side * PI;
    const s = Math.sin(phi), c = Math.cos(phi);
    let a = amp, k = knee;
    if (limp && side === z.limpSide) {
      a *= 1 - 0.4 * limp;
      k *= 1 - 0.8 * limp;
    }
    const t = baseT + a * s;
    const kn = -(baseK + k * Math.max(0, c) * (0.6 + 0.4 * Math.max(0, s + 0.3)));
    const ft = -(t + kn) * 0.9 + (c > 0 ? 0.25 * c * (amp > 0.05 ? 1 : 0) : 0);
    const sg = side ? 1 : -1;
    R(p, th, t, limp && side === z.limpSide ? sg * 0.25 * limp : 0, sg * splay);
    R(p, th + 1, kn, 0, 0);
    R(p, th + 2, ft, 0, 0);
    const e = P.thighLen * Math.cos(t) * Math.cos(splay) + P.shinLen * Math.cos(t + kn);
    if (e > ext) ext = e;
  }
  p[z.nb * 4 + 1] += ext - (P.thighLen + P.shinLen);
}
/** Static leg pose (both legs), grounded. */
function legsStatic(z, p, tL, kL, tR, kR, splay = 0) {
  const P = z.P;
  R(p, THIGH_L, tL, 0, -splay);
  R(p, SHIN_L, kL, 0, 0);
  R(p, FOOT_L, -(tL + kL) * 0.9, 0, 0);
  R(p, THIGH_R, tR, 0, splay);
  R(p, SHIN_R, kR, 0, 0);
  R(p, FOOT_R, -(tR + kR) * 0.9, 0, 0);
  const eL = P.thighLen * Math.cos(tL) * Math.cos(splay) + P.shinLen * Math.cos(tL + kL);
  const eR = P.thighLen * Math.cos(tR) * Math.cos(splay) + P.shinLen * Math.cos(tR + kR);
  p[z.nb * 4 + 1] += Math.max(eL, eR) - (P.thighLen + P.shinLen);
}

/** Zombie posture: neck thrust forward, shoulders rolled forward/uneven. */
function posture(z, p) {
  const st = z.st;
  const nf = st.neckFwd ?? 0.3;
  A(p, NECK, -nf, 0, 0);
  const r = st.shoulderRoll ?? 0.12;
  const u = (z.limpSide ? 1 : -1) * 0.06;
  A(p, CLAV_L, 0, -r, -u);
  A(p, CLAV_R, 0, r, -u);
}

// deterministic per-instance noise helpers
const n1 = (t, seed) => noise3(t, seed * 1.7, 0.5, 11) * 2 - 1;

// ------------------------------------------------------------------ humanoid states
function poseIdle(z, p) {
  const st = z.st, t = z.time + z.off;
  const br = Math.sin(t * 1.3 * z.rate);
  if (st.quad) return poseQuad(z, p, false, true);
  if (st.knuckle) return poseTankLoco(z, p, false, true);
  const sway = n1(t * 0.35, z.seed) * 0.07;
  const ws = z.limpSide ? 1 : -1; // weight shifted onto the straight leg
  R(p, HIPS, 0, 0.08 * ws, -0.06 * ws - sway * 0.5);
  R(p, SPINE, st.idleLean * 0.45 + br * 0.025, sway * 0.5, 0.06 * ws + sway);
  R(p, CHEST, st.idleLean * 0.55 + br * 0.02, n1(t * 0.3, z.seed + 3) * 0.12, 0.04 * ws + sway * 0.6);
  p[z.nb * 4] = sway * 0.3 - ws * 0.02;
  posture(z, p);
  // twitch
  const tw = twitch(z, t, st.twitchy ? 2.6 : 0.7);
  headLook(p, st.headPitch + tw * 0.25 + n1(t * 0.5, z.seed + 5) * 0.1, n1(t * 0.25, z.seed + 7) * 0.5 + tw * 0.4, z.tilt * st.headTilt + tw * 0.3, 0.2);
  const jaw = st.jaw * (0.6 + 0.4 * Math.max(0, Math.sin(t * 2.2)));
  R(p, JAW, -jaw - tw * 0.2, 0, 0);
  const splay = st.legSplay || 0.05;
  if (z.limpSide) legsStatic(z, p, 0.24, -0.5, -0.02, -0.06, splay);
  else legsStatic(z, p, -0.02, -0.06, 0.24, -0.5, splay);
  z.standOn = true;
  // arms dangle
  const aw = n1(t * 0.6, z.seed + 11) * 0.12;
  if (st.mantis) {
    arm(p, 0, 0.9 + aw, 0.3, 0.3, 2.2, 0.4);
    arm(p, 1, 0.9 - aw, 0.3, 0.3, 2.2, 0.4);
  } else {
    arm(p, 0, 0.18 + aw, 0.1 + (st.armOut || 0), 0.3, 0.35 + aw, 0.35);
    arm(p, 1, 0.14 - aw, 0.1 + (st.armOut || 0), 0.3, 0.45 - aw, 0.35);
  }
  if (st.twitchy) {
    A(p, UARM_L, tw * 0.5, 0, tw * 0.3);
    A(p, CHEST, br * 0.05, 0, 0);
    A(p, CLAV_L, 0, 0, -Math.abs(br) * 0.1);
    A(p, CLAV_R, 0, 0, Math.abs(br) * 0.1);
  }
  if (st.roar) roar(z, p, t);
}

function twitch(z, t, rate) {
  // occasional sharp twitch: returns -1..1 impulses
  const cell = Math.floor(t * rate);
  const h = noise3(cell * 7.13, z.seed, 1.3, 77);
  if (h < 0.62) return 0;
  const f = t * rate - cell;
  const env = f < 0.15 ? f / 0.15 : Math.max(0, 1 - (f - 0.15) / 0.3);
  return (noise3(cell * 3.1, z.seed, 2.7, 78) * 2 - 1) * env;
}

function roar(z, p, t) {
  const per = 7;
  const u = ((t + z.seed * 3) % per) / per;
  if (u > 0.3) return;
  const k = Math.sin((u / 0.3) * PI);
  A(p, SPINE, 0.25 * k, 0, 0);
  A(p, CHEST, 0.2 * k, 0, 0);
  A(p, NECK, 0.3 * k, 0, 0);
  A(p, HEAD, 0.35 * k + Math.sin(t * 40) * 0.03 * k, 0, 0);
  A(p, JAW, -0.8 * k, 0, 0);
  A(p, UARM_L, 0.4 * k, 0, -0.9 * k);
  A(p, UARM_R, 0.4 * k, 0, 0.9 * k);
}

function poseLoco(z, p, run) {
  const st = z.st;
  if (z.legs) return poseHobble(z, p);
  if (run ? st.gRun : st.gWalk) return poseGait(z, p, run);
  if (st.quad) return poseQuad(z, p, run, false);
  if (st.knuckle) return poseTankLoco(z, p, run, false);
  const t = z.time + z.off;
  const ph = z.phase;
  const lean = run ? st.runLean : st.walkLean;
  const s1 = Math.sin(ph), c2 = Math.cos(ph * 2);
  const sw = st.sway || 1;
  R(p, HIPS, 0, -0.12 * s1, 0.05 * Math.cos(ph) * sw);
  R(p, SPINE, lean * 0.5 + 0.03 * c2, 0.1 * s1, -0.04 * s1 * sw);
  R(p, CHEST, lean * 0.5 + 0.02 * c2, 0.08 * s1, -0.03 * s1 * sw);
  if (st.waddle) {
    A(p, HIPS, 0, 0, 0.12 * Math.sin(ph));
    A(p, SPINE, 0, 0, -0.1 * Math.sin(ph));
    p[z.nb * 4] += 0.05 * Math.sin(ph);
  }
  legCycle(z, p, ph, run ? st.runStride : st.walkStride, run ? st.runKnee : st.walkKnee, st.baseT || 0, st.baseK || 0.06, run ? 0 : st.limp, st.legSplay || 0);
  posture(z, p);
  // limp hitch: shoulder dips on the limp side
  if (st.limp && !run) {
    const hitch = Math.max(0, Math.sin(ph + (z.limpSide ? PI : 0)));
    A(p, SPINE, 0, 0, (z.limpSide ? 1 : -1) * 0.08 * hitch * st.limp);
    p[z.nb * 4 + 1] -= 0.025 * hitch * st.limp;
  }
  // arms
  if (st.mantis) {
    arm(p, 0, 0.9 + 0.1 * Math.sin(ph), 0.3, 0.3, 2.2, 0.4);
    arm(p, 1, 0.9 - 0.1 * Math.sin(ph), 0.3, 0.3, 2.2, 0.4);
  } else {
    const sw2 = st.armSwing * Math.sin(ph);
    const reach = run ? st.armRun : st.armWalk;
    const n = n1(t * 0.8, z.seed + 2) * 0.1;
    const hi = z.armSide; // which arm is raised
    const out = st.armOut || 0;
    const up0 = hi === 0 ? reach : st.armDroop;
    const up1 = hi === 1 ? reach : st.armDroop;
    const a0 = (run ? reach : up0) + sw2 + n, a1 = (run ? reach : up1) - sw2 - n;
    const k0 = clamp(a0 - 0.3, 0, 1), k1 = clamp(a1 - 0.3, 0, 1);
    arm(p, 0, a0, 0.14 + out, 0.25 * k0 - 0.1 * (1 - k0), st.elbow * (1 - 0.6 * k0) * (0.5 + 0.5 * k0) + 0.1, 0.3);
    arm(p, 1, a1, 0.14 + out, 0.25 * k1 - 0.1 * (1 - k1), st.elbow * (1 - 0.6 * k1) * (0.5 + 0.5 * k1) + 0.1, 0.3);
  }
  // head
  const bob = Math.cos(ph * 2) * 0.04;
  const tw = twitch(z, t, st.twitchy ? 2 : 0.5);
  headLook(p, st.headPitch + bob + tw * 0.2 + (run ? 0.1 : 0), n1(t * 0.4, z.seed + 4) * 0.25 + tw * 0.3, z.tilt * st.headTilt + 0.05 * s1, 0.2);
  R(p, JAW, -st.jaw * (0.5 + 0.5 * Math.abs(Math.sin(t * 1.7))), 0, 0);
}

/** Quadruped-ish crawl (leaper). */
function poseQuad(z, p, run, idle) {
  const st = z.st;
  const t = z.time + z.off;
  const ph = idle ? 0 : z.phase;
  const lean = run ? st.runLean : st.walkLean;
  const breathe = Math.sin(t * 3) * 0.03;
  R(p, SPINE, lean * 0.55 + breathe, 0, 0);
  R(p, CHEST, lean * 0.45 + (run ? 0.12 * Math.sin(ph * 2) : 0), 0.06 * Math.sin(ph), 0);
  const amp = idle ? 0 : run ? st.runStride : st.walkStride;
  if (run) {
    // bounding gallop: legs in phase
    const s = Math.sin(ph);
    const k = -(st.baseK + 0.5 * Math.max(0, Math.cos(ph)));
    legsStatic(z, p, st.baseT + amp * s, k, st.baseT + amp * Math.sin(ph + 0.4), k, 0.12);
    p[z.nb * 4 + 1] += 0.08 * Math.max(0, Math.sin(ph * 2));
  } else {
    legCycle(z, p, ph, amp, idle ? 0 : st.walkKnee, st.baseT, st.baseK, 0, 0.14);
  }
  // arms reach down to the ground, alternating with legs
  const aPh = run ? ph + PI * 0.5 : ph + PI;
  const aa = idle ? 0 : run ? 0.7 : 0.4;
  for (let side = 0; side < 2; side++) {
    const s = Math.sin(aPh + (run ? side * 0.4 : side * PI));
    const c = Math.cos(aPh + (run ? side * 0.4 : side * PI));
    arm(p, side, 0.3 + aa * s + (idle ? n1(t * 0.7, z.seed + side) * 0.08 : 0), 0.18, 0.2, 0.35 + 0.5 * Math.max(0, -c) * (idle ? 0 : 1), 0.45);
  }
  const tw = twitch(z, t, 1.6);
  headLook(p, 0.35 + tw * 0.2, (idle ? n1(t * 0.6, z.seed) * 0.7 : 0) + tw * 0.4, tw * 0.3, 0.5);
  R(p, JAW, -0.2 - 0.15 * Math.abs(Math.sin(t * 2)), 0, 0);
}

/** Tank knuckle walk / heavy run. */
function poseTankLoco(z, p, run, idle) {
  const st = z.st;
  const t = z.time + z.off;
  const ph = idle ? 0 : z.phase;
  const lean = idle ? st.idleLean : run ? st.runLean : st.walkLean;
  const br = Math.sin(t * 1.1) * 0.04;
  R(p, HIPS, 0, -0.08 * Math.sin(ph), 0.05 * Math.cos(ph));
  R(p, SPINE, lean * 0.5 + br * 0.5 + (run ? 0.05 * Math.cos(ph * 2) : 0), 0.1 * Math.sin(ph), 0.04 * Math.sin(ph));
  R(p, CHEST, lean * 0.5 + br, 0.12 * Math.sin(ph), 0.04 * Math.sin(ph));
  A(p, CLAV_L, 0, 0, -br);
  A(p, CLAV_R, 0, 0, br);
  if (idle) legsStatic(z, p, 0.15, -0.3, 0.1, -0.25, st.legSplay);
  else legCycle(z, p, ph, run ? st.runStride : st.walkStride, run ? st.runKnee : st.walkKnee, 0.12, 0.25, 0, st.legSplay);
  // arms: knuckles planted, swinging opposite to legs
  const amp = idle ? 0 : run ? 0.55 : 0.35;
  for (let side = 0; side < 2; side++) {
    const s = Math.sin(ph + (side ? 0 : PI));
    const c = Math.cos(ph + (side ? 0 : PI));
    arm(p, side, 0.28 + amp * s, 0.22, 0.25, 0.25 + (idle ? 0 : 0.35 * Math.max(0, c)), 0.3);
  }
  headLook(p, st.headPitch + (idle ? n1(t * 0.3, z.seed) * 0.15 : 0), idle ? n1(t * 0.2, z.seed + 4) * 0.5 : 0, 0, 0.3);
  R(p, JAW, -0.15 - 0.1 * Math.abs(Math.sin(t * 1.3)), 0, 0);
}

// ------------------------------------------------------------------ planted-foot gait (walker, runner)
// Instead of swinging leg angles, these styles plan where each ankle goes. A stance foot stays put on the ground while
// the body travels over it (one gait cycle covers exactly the ground distance that drives the phase, so feet don't
// skate), lands on the heel and rolls off the ball; the swing foot lifts, drags its toes or kicks up behind. solveLegs
// fits the legs with two-bone IK once the upper body (and the head-over-origin shift) is final.
const FOOT_HEEL = 0.085, FOOT_BALL = 0.12, FOOT_TOE = 0.17;
const frac = (x) => x - Math.floor(x);
const hash01 = (a, b) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Per-instance gait quirks (created lazily so the survivor zombie-mode shim gets them too). */
function gaitVars(z) {
  if (z.gv) return z.gv;
  const r = mulberry32(((z.seed >>> 0) * 7919 + 1013 + (z.type | 0) * 131) >>> 0);
  const limp = r(), arms = r();
  z.gv = {
    limp: limp < 0.2 ? 0 : 0.35 + 0.65 * r(), // how badly the bad leg drags (some shuffle on two good legs)
    lean: 0.85 + 0.3 * r(),
    stride: 0.92 + 0.16 * r(),
    arms: arms < 0.36 ? 0 : arms < 0.76 ? 1 : 2, // walker: dangle / one arm reaching / both; runner: pump / claw / flail
    reach: 1.05 + 0.35 * r(),
    stumble: 0.05 + 0.12 * r(), // chance per gait cycle of a stumbling lurch
    slouch: (r() - 0.5) * 0.14,
    asym: (r() - 0.5) * 0.07, // runner: uneven, galloping rhythm
  };
  return z.gv;
}

/** Ground distance (m) of one gait cycle before the instance's rate; strides shorten when moving slowly. */
function gaitLen(z, run, speed) {
  const st = z.st;
  const base = run ? st.cycleRun : st.cycleWalk;
  const G = run ? st.gRun : st.gWalk;
  if (!G) return base;
  return base * gaitVars(z).stride * clamp(Math.sqrt(Math.max(speed, 0.01) / G.ref), 0.6, 1.15);
}

/** Per-leg timing for this frame. Leg 0 = left, 1 = right; the limp leg lands at 0, the other at td. */
function gaitSetup(z, run) {
  const st = z.st, G = run ? st.gRun : st.gWalk, V = gaitVars(z);
  const k = z.gk || (z.gk = { G, len: 1, limp: 0, D: [0, 0], td: [0, 0], lift: [0, 0], drag: [0, 0], circ: [0, 0], bob: [0, 0], vault: [0, 0], x: [0, 0], w: [0, 0], stance: [false, false], load: [0, 0], u: 0 });
  k.G = G;
  k.len = gaitLen(z, run, z.speed) / ((z.rate || 1) * (z.gScale || 1)); // in rig units
  const b = z.limpSide, g = 1 - b;
  const limp = (G.limp ?? st.limp ?? 0) * V.limp;
  k.limp = limp;
  // limp: short stance on the bad leg and a quick step off it, long slow drag of the bad foot ("step... draag")
  k.D[b] = G.duty - 0.12 * limp;
  k.D[g] = G.duty + 0.12 * limp;
  k.td[b] = 0;
  k.td[g] = 0.5 - 0.1 * limp + (G.asym ? V.asym : 0);
  k.lift[b] = G.lift * (1 - 0.8 * limp);
  k.lift[g] = G.lift;
  k.drag[b] = limp;
  k.drag[g] = 0;
  k.circ[b] = 0.05 * limp;
  k.circ[g] = 0;
  // single support: vault up over a stiff stance leg; the bad knee buckles under the weight instead
  k.bob[b] = G.bob - 0.04 * limp;
  k.bob[g] = G.bob;
  k.vault[b] = (G.vault || 0) * (1 - 0.8 * limp);
  k.vault[g] = G.vault || 0;
  const u = frac(z.phase / TAU);
  k.u = u;
  for (let i = 0; i < 2; i++) {
    const x = frac(u - k.td[i]), D = k.D[i];
    k.x[i] = x;
    k.stance[i] = x < D;
    k.w[i] = x < D ? 0 : (x - D) / (1 - D);
    k.load[i] = legLoad(k, i, x);
  }
  return k;
}
function legLoad(k, i, x) {
  const D = k.D[i];
  return x < D ? smooth(Math.min(x, D - x) / 0.08) : 0;
}
/** Planned forward offset of the flat foot (rig m) at cycle time x since touchdown. */
function footFwd(k, i, x) {
  const D = k.D[i], h = D * k.len * 0.5;
  return x < D ? h - x * k.len : -h + 2 * h * smooth((x - D) / (1 - D));
}
/** Weight shift, -1 (left foot) .. 1 (right foot), at cycle time u. */
const latAt = (k, u) => legLoad(k, 1, frac(u - k.td[1])) - legLoad(k, 0, frac(u - k.td[0]));
/** Which foot leads, ~-1 (left ahead) .. 1 (right ahead), at cycle time u. */
const leadAt = (k, u) => (footFwd(k, 1, frac(u - k.td[1])) - footFwd(k, 0, frac(u - k.td[0]))) / ((k.D[0] + k.D[1]) * 0.5 * k.len);
/** Footfall jolt: a bump just after each touchdown (heavier on the limp leg). */
function jolt(k, u, b) {
  let j = 0;
  for (let i = 0; i < 2; i++) {
    const x = frac(u - k.td[i]);
    if (x < 0.2) j += Math.sin((PI * x) / 0.2) * (i === b ? 1 + k.limp : 1);
  }
  return j;
}
/** Occasional stumbling lurch: 0..1 over a whole gait cycle, on a random minority of cycles. */
function stumble(z, V) {
  const c = Math.floor(z.phase / TAU);
  if (hash01(c, z.seed) > V.stumble) return 0;
  const s = Math.sin(PI * frac(z.phase / TAU));
  return s * s;
}

function poseGait(z, p, run) {
  const st = z.st, V = gaitVars(z), k = gaitSetup(z, run), G = k.G;
  const t = z.time + z.off, n = z.nb * 4, u = k.u, b = z.limpSide;
  z.gOn = true;
  const lat = k.load[1] - k.load[0];
  const latLag = latAt(k, u - 0.1);
  const lead = leadAt(k, u), leadLag = leadAt(k, u - 0.07), leadLag2 = leadAt(k, u - 0.17);
  const jl = jolt(k, u, b), jlLag = jolt(k, u - 0.06, b);
  const tw = twitch(z, t, st.twitchy ? 2 : 0.5);
  // pelvis: turns with the leading leg, drops on the swing side (a dragged leg hikes its hip instead), shifts over the stance foot
  let roll = 0;
  for (let i = 0; i < 2; i++) if (!k.stance[i]) roll += (i ? 1 : -1) * Math.sin(PI * k.w[i]) * lerp(-G.drop, G.hike || 0, k.drag[i]);
  const yaw = G.hipYaw * lead;
  const lean = (run ? st.runLean : st.walkLean) * V.lean;
  const hl = lean * (G.hipLean || 0); // part of the lean tips the pelvis (the leg IK absorbs it)
  R(p, HIPS, hl, yaw, roll);
  p[n] = G.sway * lat + (b ? -0.015 : 0.015) * k.limp; // weight favors the good leg

  if (G.sprint) {
    // --- feral sprint: pitched far forward, shoulders whipping against the hips, head locked on the prey
    const nod = G.nod * jl, tl = lean - hl;
    R(p, SPINE, tl * 0.5 - nod * 0.4 + 0.03 * Math.sin(t * 2.3), -yaw * 0.9, -roll * 0.5 - G.roll * lat);
    R(p, CHEST, tl * 0.5 - nod * 0.3, -yaw * 1.05, -G.roll * lat * 0.5);
    posture(z, p);
    A(p, CLAV_L, 0, 0, -0.06 * Math.max(0, -lead));
    A(p, CLAV_R, 0, 0, 0.06 * Math.max(0, lead));
    headLook(p, st.headPitch - 0.2 - 0.7 * G.nod * jlLag + tw * 0.25, yaw * 0.9 + n1(t * 0.7, z.seed + 4) * 0.12 + tw * 0.35, z.tilt * st.headTilt * 0.6 + tw * 0.2, 0.5);
    R(p, JAW, -0.4 - 0.2 * jl - 0.15 * Math.abs(Math.sin(t * 5.3)), 0, 0);
    for (let s = 0; s < 2; s++) {
      const sg = s ? 1 : -1;
      const d = -sg * leadLag, d2 = -sg * leadLag2; // + while this arm is forward (opposite leg leads)
      const ns = n1(t * 3.1, z.seed + s * 3) * 0.25, na = n1(t * 2.3, z.seed + 9 + s) * 0.15;
      if (V.arms === 1) {
        // clawing forward at the prey, alternating grabs
        arm(p, s, 1.2 + 0.45 * d + ns, 0.28 + na, 0.3, 0.35 + 0.45 * Math.max(0, d2 - d), 0.65);
      } else if (V.arms === 2) {
        // flailing: loose, oversized and out of sync
        arm(p, s, 0.6 + 0.8 * d + ns * 1.5, 0.45 + 0.25 * Math.sin(u * TAU * 2 + s) + na, 0.3, 0.4 + 0.9 * Math.max(0, d2 - d), 0.3);
      } else {
        // sprinter's pump, wide and ragged
        arm(p, s, 0.35 + 0.95 * d + ns, 0.3 + 0.12 * Math.abs(d) + na, 0.35, 1.2 - 0.45 * d + 0.6 * Math.max(0, d2 - d), 0.35);
      }
    }
    return;
  }

  // --- shamble: hunched, lurching over the stance leg, head lolling a beat behind
  const nod = G.nod * jl;
  const stum = G.stumble ? stumble(z, V) : 0;
  const lurch = k.limp * k.load[b] * (b ? 1 : -1); // + toward the right
  const trunkRoll = -G.roll * lat - 0.22 * lurch;
  const br = Math.sin(t * 1.9) * 0.015, tl = lean - hl;
  R(p, SPINE, tl * 0.5 - nod * 0.5 - 0.14 * stum + br, -yaw * 0.7, -roll * 0.6 + trunkRoll * 0.5 + V.slouch * 0.5);
  R(p, CHEST, tl * 0.5 - nod * 0.4 - 0.1 * stum + br, -yaw * 0.75, trunkRoll * 0.5 + V.slouch * 0.5);
  p[n + 1] -= 0.03 * stum;
  posture(z, p);
  headLook(
    p,
    (G.head ?? st.headPitch) - 1.3 * G.nod * jlLag + 0.3 * stum + tw * 0.2 + (V.arms === 2 && st.reachArms ? 0.1 : 0),
    n1(t * 0.4, z.seed + 4) * 0.25 + tw * 0.3 + yaw * 0.4,
    z.tilt * st.headTilt - G.headRoll * latLag + tw * 0.15,
    G.neck || 0.2
  );
  R(p, JAW, -st.jaw * (0.5 + 0.5 * Math.abs(Math.sin(t * 1.7))) - 0.08 * jl, 0, 0);
  for (let s = 0; s < 2; s++) {
    const sg = s ? 1 : -1;
    const reach = st.reachArms && (V.arms === 2 || (V.arms === 1 && s === z.armSide));
    const ns = n1(t * 0.8, z.seed + 2 + s) * 0.08;
    if (reach) {
      // arm held out toward the prey, bouncing on each footfall
      arm(p, s, V.reach - 0.16 * jlLag - 0.05 * sg * lead + 0.3 * stum + ns, 0.1 + (st.armOut || 0), 0.2, 0.3 + 0.12 * jlLag, -0.15 + 0.2 * jlLag);
    } else {
      // dead weight: swings with the opposite leg, forearm trailing the upper arm (the elbow flops open and shut)
      const a1 = G.droop + G.armSwing * -sg * leadLag + ns, a2 = G.droop + G.armSwing * -sg * leadLag2 + ns;
      const flop = Math.max(0, a2 - a1);
      arm(p, s, a1 + 0.6 * stum, 0.1 + (st.armOut || 0) - 0.05 * sg * latLag, 0.3, G.elbow + 1.4 * flop + 0.1 * jlLag, 0.3 + 0.5 * flop);
    }
  }
  if (st.twitchy) {
    A(p, UARM_L, tw * 0.4, 0, tw * 0.25);
    A(p, CHEST, 0, tw * 0.1, 0);
  }
}

/** Ankle position (forward, up) of a foot pitched ph (+ toe up) whose flat position is `flat`: pivots on the heel or the ball. */
const _an = { f: 0, y: 0 };
function pivotAnkle(flat, ph, a) {
  const c = Math.cos(ph), s = Math.sin(ph);
  if (ph > 0) {
    _an.f = flat - FOOT_HEEL + FOOT_HEEL * c - a * s;
    _an.y = FOOT_HEEL * s + a * c;
  } else {
    _an.f = flat + FOOT_BALL - FOOT_BALL * c - a * s;
    _an.y = -FOOT_BALL * s + a * c;
  }
  return _an;
}
const _foot = { f: 0, y: 0, ph: 0, flat: 0 };
/** Planned ankle (forward of the stance center, height) and world pitch of leg i this frame. */
function planFoot(k, i, a) {
  const G = k.G, D = k.D[i], x = k.x[i], len = k.len;
  const fL = G.bias + D * len * 0.5, fO = G.bias - D * len * 0.5;
  if (x < D) {
    const s = x / D;
    const ph = s < G.rollIn ? G.strike * (1 - smooth(s / G.rollIn)) : s > G.heelOff ? G.toeOff * Math.pow((s - G.heelOff) / (1 - G.heelOff), 1.6) : 0;
    const q = pivotAnkle(fL - x * len, ph, a);
    _foot.f = q.f;
    _foot.y = q.y;
    _foot.ph = ph;
    _foot.flat = fL - x * len; // where the foot sits on the ground (the ankle rolls around it)
    return _foot;
  }
  const w = k.w[i];
  const q0 = pivotAnkle(fO, G.toeOff, a), f0 = q0.f, y0 = q0.y;
  const q1 = pivotAnkle(fL, G.strike, a), f1 = q1.f, y1 = q1.y;
  // Hermite: leaves and lands moving back at ground speed (world-still), so lift-off and touchdown don't snap
  const v = -len * (1 - D) * G.vt;
  const w2 = w * w, w3 = w2 * w;
  const f = (2 * w3 - 3 * w2 + 1) * f0 + (w3 - 2 * w2 + w) * v + (3 * w2 - 2 * w3) * f1 + (w3 - w2) * v;
  let ph = G.toeOff + (G.strike - G.toeOff) * smooth(w * (G.pitchRate || 1));
  ph = lerp(ph, -0.5, k.drag[i] * Math.sin(PI * w)); // foot drop: the dragged foot hangs toe-down
  let y = y0 + (y1 - y0) * w + k.lift[i] * Math.sin(PI * Math.pow(w, G.liftPow || 1));
  // never through the ground: toe and heel stay above it (a dragged toe scrapes along)
  const c = Math.cos(ph), sn = Math.sin(ph);
  y = Math.max(y, a * c - FOOT_TOE * sn, a * c + FOOT_HEEL * sn);
  _foot.f = f;
  _foot.y = y;
  _foot.ph = ph;
  return _foot;
}

const _v3 = { x: 0, y: 0, z: 0 };
/** v = R * v for three.js Euler XYZ (R = Rx Ry Rz); inv applies the transpose. */
function rotXYZ(ax, ay, az, inv) {
  let { x, y, z } = _v3, c, s, t;
  if (!inv) {
    c = Math.cos(az); s = Math.sin(az); t = x * c - y * s; y = x * s + y * c; x = t;
    c = Math.cos(ay); s = Math.sin(ay); t = x * c + z * s; z = -x * s + z * c; x = t;
    c = Math.cos(ax); s = Math.sin(ax); t = y * c - z * s; z = y * s + z * c; y = t;
  } else {
    c = Math.cos(ax); s = Math.sin(ax); t = y * c + z * s; z = -y * s + z * c; y = t;
    c = Math.cos(ay); s = Math.sin(ay); t = x * c - z * s; z = x * s + z * c; x = t;
    c = Math.cos(az); s = Math.sin(az); t = x * c + y * s; y = -x * s + y * c; x = t;
  }
  _v3.x = x;
  _v3.y = y;
  _v3.z = z;
  return _v3;
}

const _ft = { x: [0, 0], y: [0, 0], f: [0, 0], z: [0, 0], ph: [0, 0], flat: [0, 0] };

// How far (rig m) a pinned foot may end up from the gait plan before it gets dragged along: forward/back, sideways.
const PIN_F = 0.22, PIN_X = 0.1;
/**
 * World-space foot pinning: a stance foot stays on the spot where it touched down, even when the body's actual
 * motion (interpolated network movement, crowd shoves, turning, a speed estimate that lags) differs from what the
 * gait planned. At lift-off the leftover offset fades out over the swing, so the next step lands on plan again.
 * Needs the instance's world placement (wx, wz, wyaw, wScale); culled frames re-pin.
 */
function pinFeet(z, k) {
  const L = z.pin || (z.pin = { on: [false, false], x: [0, 0], z: [0, 0], ex: [0, 0], ef: [0, 0], t: -1 });
  const s = z.wScale, c = Math.cos(z.wyaw), sn = Math.sin(z.wyaw), cz = z.gcz;
  const fresh = z.time - L.t < 0.12;
  L.t = z.time;
  for (let i = 0; i < 2; i++) {
    if (!k.stance[i]) {
      L.on[i] = false;
      if (!fresh) L.ex[i] = L.ef[i] = 0;
      const f = 1 - smooth(k.w[i]);
      _ft.x[i] += L.ex[i] * f;
      _ft.f[i] += L.ef[i] * f;
      continue;
    }
    const px = _ft.x[i], pz = cz - _ft.flat[i]; // planned ground spot, rig space
    if (!L.on[i] || !fresh) {
      if (fresh) z.footfalls++;
      L.on[i] = true;
      L.x[i] = z.wx + (px * c + pz * sn) * s;
      L.z[i] = z.wz + (pz * c - px * sn) * s;
    }
    const dx = L.x[i] - z.wx, dz = L.z[i] - z.wz;
    let ex = (dx * c - dz * sn) / s - px, ez = (dx * sn + dz * c) / s - pz;
    const e = Math.hypot(ex / PIN_X, ez / PIN_F);
    if (e > 1) {
      // shoved too far off plan: the foot slides (drag the pin along)
      ex /= e;
      ez /= e;
      const lx = px + ex, lz = pz + ez;
      L.x[i] = z.wx + (lx * c + lz * sn) * s;
      L.z[i] = z.wz + (lz * c - lx * sn) * s;
    }
    L.ex[i] = ex;
    L.ef[i] = -ez;
    _ft.x[i] += ex;
    _ft.f[i] -= ez;
  }
}
/** Pelvis height + two-bone leg IK onto the planned feet. Runs after the upper body and the head shift are final. */
function solveLegs(z, p) {
  const k = z.gk, G = k.G, P = z.P, n = z.nb * 4;
  const L1 = P.thighLen, L2 = P.shinLen, a = P.ankleY;
  // feet are planned around a low-passed copy of the hips' z, so a changing head shift can't drag planted feet along
  const rz = p[n + 2];
  if (z.gcz === undefined || Math.abs(rz - z.gcz) > 0.3) z.gcz = rz;
  else z.gcz += (rz - z.gcz) * 0.08;
  const cz = z.gcz;
  for (let i = 0; i < 2; i++) {
    const q = planFoot(k, i, a);
    _ft.f[i] = q.f;
    _ft.y[i] = q.y;
    _ft.ph[i] = q.ph;
    _ft.flat[i] = q.flat;
    _ft.x[i] = (i ? 1 : -1) * (P.hipW + G.width + (k.stance[i] ? 0 : k.circ[i] * Math.sin(PI * k.w[i])));
  }
  if (z.wScale) pinFeet(z, k);
  // pelvis height: as high as the legs reach at touchdown / lift-off (they are longest-spread there), plus the
  // vault over a walking stance leg or the dip-and-bound of a running one
  const Lr = (L1 + L2) * G.ext, wd = G.width;
  const reach = (f, y) => y + Math.sqrt(Math.max(0.01, Lr * Lr - f * f - wd * wd)) + 0.03;
  let hTD = 9, hTO = 9;
  for (let i = 0; i < 2; i++) {
    const D = k.D[i];
    const q1 = pivotAnkle(G.bias + D * k.len * 0.5, G.strike, a);
    hTD = Math.min(hTD, reach(q1.f, q1.y));
    const q0 = pivotAnkle(G.bias - D * k.len * 0.5, G.toeOff, a);
    hTO = Math.min(hTO, reach(q0.f, q0.y));
  }
  let hy;
  const s0 = k.stance[0], s1 = k.stance[1];
  if (G.sprint) {
    if (s0 || s1) {
      let m = 9;
      for (let i = 0; i < 2; i++) {
        if (!k.stance[i]) continue;
        const s = k.x[i] / k.D[i];
        m = Math.min(m, lerp(hTD, hTO, s) - G.comp * Math.sin(PI * s));
      }
      hy = m;
    } else {
      // airborne: from the last lift-off to the next touchdown
      const i = k.x[0] - k.D[0] < k.x[1] - k.D[1] ? 0 : 1, j = 1 - i;
      const tau = k.x[i] - k.D[i], f = tau / Math.max(1e-4, tau + 1 - k.x[j]);
      hy = lerp(hTO, hTD, f) + G.flight * Math.sin(PI * f);
    }
  } else {
    hy = Math.min(hTD, hTO);
    if (s0 !== s1) {
      const i = s0 ? 0 : 1, j = 1 - i;
      const tau = k.x[j] - k.D[j], f = tau / Math.max(1e-4, tau + 1 - k.x[j]);
      const mid = reach(pivotAnkle(G.bias, 0, a).f, a);
      hy += (k.bob[i] + k.vault[i] * Math.max(0, mid - hy)) * Math.sin(PI * f);
    }
  }
  p[n + 1] += hy - P.hipY;
  for (let i = 0; i < 2; i++) _ft.z[i] = cz - _ft.f[i];
  keepReach(z, p, _ft, k.stance);
  legsIK(z, p, _ft);
}

/**
 * Lowers the pelvis until every planted ankle target T (rig x, y, z) is within reach. The drop is eased (quick to
 * sink, slower to rise) so a foot landing out of reach or lifting off doesn't make the hips jump in one frame;
 * meanwhile the IK leaves that foot a little short of its target.
 */
function keepReach(z, p, T, planted) {
  const P = z.P, n = z.nb * 4, maxR = (P.thighLen + P.shinLen) * 0.999;
  const hx = p[HIPS * 4], hyw = p[HIPS * 4 + 1], hz = p[HIPS * 4 + 2];
  let need = 0;
  for (let i = 0; i < 2; i++) {
    if (!planted[i]) continue;
    _v3.x = (i ? 1 : -1) * P.hipW;
    _v3.y = -0.03;
    _v3.z = 0;
    const o = rotXYZ(hx, hyw, hz, false);
    const dx = T.x[i] - (p[n] + o.x), dz = T.z[i] - (p[n + 2] + o.z);
    const top = T.y[i] + Math.sqrt(Math.max(0, maxR * maxR - dx * dx - dz * dz));
    need = Math.max(need, p[n + 1] + P.hipY + o.y - top);
  }
  if (!z.wScale) {
    p[n + 1] -= need; // posed in place (calibration, treadmill): exact
    return;
  }
  const dt = clamp(z.time - (z.dropT ?? z.time), 0, 0.1);
  z.dropT = z.time;
  const d0 = z.drop || 0;
  z.drop = d0 + (need - d0) * Math.min(1, dt * (need > d0 ? 30 : 10));
  p[n + 1] -= z.drop;
}

/** Two-bone IK of both legs onto ankle targets T (rig x, y, z) with the feet at world pitch T.ph. */
function legsIK(z, p, T) {
  const P = z.P, n = z.nb * 4, L1 = P.thighLen, L2 = P.shinLen;
  const hx = p[HIPS * 4], hyw = p[HIPS * 4 + 1], hz = p[HIPS * 4 + 2];
  for (let i = 0; i < 2; i++) {
    const sg = i ? 1 : -1, th = i ? THIGH_R : THIGH_L;
    _v3.x = sg * P.hipW;
    _v3.y = -0.03;
    _v3.z = 0;
    const o = rotXYZ(hx, hyw, hz, false), ox = o.x, oy = o.y, oz = o.z; // o is the shared scratch vector
    _v3.x = T.x[i] - (p[n] + ox);
    _v3.y = T.y[i] - (p[n + 1] + P.hipY + oy);
    _v3.z = T.z[i] - (p[n + 2] + oz);
    const v = rotXYZ(hx, hyw, hz, true); // hip -> ankle in the hips' frame
    let d = Math.hypot(v.x, v.y, v.z);
    d = clamp(d, Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.9995);
    const ck = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
    const kn = -Math.acos(ck);
    const Y = L1 + L2 * ck, Zk = L2 * Math.sin(kn);
    const splay = Math.asin(clamp(v.x / Y, -0.9, 0.9));
    let pitch = Math.atan2(v.z, v.y) - Math.atan2(-Zk, -Y * Math.cos(splay));
    if (pitch > PI) pitch -= TAU;
    else if (pitch < -PI) pitch += TAU;
    R(p, th, pitch, 0, splay);
    R(p, th + 1, kn, 0, 0);
    R(p, th + 2, T.ph[i] - (hx + pitch + kn), 0, -(splay + hz));
  }
}

// Standing still (idle, braced attack, menace): the feet stay planted in the world while the hips sway, and the legs
// are re-solved onto them. Turning on the spot or being shoved off the stance makes it shuffle a foot back under it.
const STEP_T = 0.3, STEP_LIFT = 0.07, STEP_X = 0.09, STEP_F = 0.14;
const _st = { x: [0, 0], y: [0, 0], z: [0, 0], ph: [0, 0], planted: [true, true] };
function plantStatic(z, p) {
  const P = z.P, n = z.nb * 4, L1 = P.thighLen, L2 = P.shinLen;
  const S = z.stand || (z.stand = { x: [0, 0], z: [0, 0], sx: [0, 0], sz: [0, 0], u: [-1, -1], t: -1 });
  const s = z.wScale, c = Math.cos(z.wyaw), sn = Math.sin(z.wyaw);
  const fresh = z.time - S.t < 0.12, dt = fresh ? z.time - S.t : 0;
  S.t = z.time;
  const rz = p[n + 2];
  if (z.gcz === undefined || Math.abs(rz - z.gcz) > 0.3) z.gcz = rz;
  else z.gcz += (rz - z.gcz) * 0.08;
  for (let i = 0; i < 2; i++) {
    // where the static pose puts this ankle under a still pelvis (thigh + shin FK), in the world
    const th = i ? THIGH_R : THIGH_L, kn = p[(th + 1) * 4];
    _v3.x = 0;
    _v3.y = -L1 - L2 * Math.cos(kn);
    _v3.z = -L2 * Math.sin(kn);
    const q = rotXYZ(p[th * 4], p[th * 4 + 1], p[th * 4 + 2], false);
    const rx = (i ? 1 : -1) * P.hipW + q.x, rzr = z.gcz + q.z;
    const wx = z.wx + (rx * c + rzr * sn) * s, wz = z.wz + (rzr * c - rx * sn) * s;
    if (!fresh) {
      S.x[i] = wx;
      S.z[i] = wz;
      S.u[i] = -1;
    }
    let px = S.x[i], pz = S.z[i], lift = 0;
    if (S.u[i] >= 0) {
      S.u[i] = Math.min(1, S.u[i] + dt / STEP_T);
      const e = smooth(S.u[i]);
      px = S.sx[i] + (wx - S.sx[i]) * e;
      pz = S.sz[i] + (wz - S.sz[i]) * e;
      lift = STEP_LIFT * Math.sin(PI * S.u[i]);
      if (S.u[i] >= 1) {
        S.u[i] = -1;
        S.x[i] = wx;
        S.z[i] = wz;
      }
    } else {
      const ex = ((px - wx) * c - (pz - wz) * sn) / s, ez = ((px - wx) * sn + (pz - wz) * c) / s;
      const e = Math.hypot(ex / STEP_X, ez / STEP_F);
      if (e > 2.5) {
        // shoved well off it before a step could fix it: the foot slides
        px = wx + (px - wx) * (2.5 / e);
        pz = wz + (pz - wz) * (2.5 / e);
        S.x[i] = px;
        S.z[i] = pz;
      }
      if (e > 1 && S.u[1 - i] < 0) {
        S.u[i] = 0;
        S.sx[i] = px;
        S.sz[i] = pz;
      }
    }
    const dx = px - z.wx, dz = pz - z.wz;
    _st.x[i] = (dx * c - dz * sn) / s;
    _st.z[i] = (dx * sn + dz * c) / s;
    _st.y[i] = P.ankleY + lift;
    _st.ph[i] = 0;
    _st.planted[i] = S.u[i] < 0;
  }
  keepReach(z, p, _st, _st.planted);
  legsIK(z, p, _st);
}

function poseAttack(z, p) {
  const st = z.st, type = z.type;
  const t = z.stateT;
  const per = (z.def.rate || 1) / z.rate;
  const u = (t % per) / per;
  // lower body: keep walking (or running) if moving, else braced
  const mv = z.sub ?? (z.speed > 0.4 ? 1 : 0);
  if (mv) poseLoco(z, p, mv === 2);
  else {
    clearPose(p, z.nb);
    if (st.quad) legsStatic(z, p, st.baseT + 0.1, -st.baseK, st.baseT - 0.1, -st.baseK + 0.1, 0.14);
    else legsStatic(z, p, 0.35, -0.35, -0.15, -0.1, st.legSplay || 0.05);
    z.standOn = true;
  }
  if (type === ZTYPE.TANK || type === ZTYPE.BOSS_BRUTE) return tankSmash(z, p, u);
  if (type === ZTYPE.BOSS_ABOMINATION) return abomSweep(z, p, u);
  if (type === ZTYPE.BOSS_HIVEQUEEN) return queenSlash(z, p, u);
  if (type === ZTYPE.BOSS_BLOATER) return bloaterSlap(z, p, u);
  if (type === ZTYPE.BOOMER) {
    // belly bump / lurch
    const k = Math.sin(u * TAU);
    R(p, SPINE, 0.1 + 0.2 * k, 0, 0);
    R(p, CHEST, -0.1 - 0.25 * Math.max(0, -k), 0, 0);
    arm(p, 0, 0.9 + 0.3 * k, 0.4, 0, 0.5);
    arm(p, 1, 0.9 - 0.3 * k, 0.4, 0, 0.5);
    headLook(p, 0.1, 0, 0);
    R(p, JAW, -0.4 - 0.3 * Math.max(0, k), 0, 0);
    return;
  }
  // two-arm grab + claw swipes, lunge with the head (walker, runner, spitter, leaper, roper)
  const lean = st.quad ? -0.75 : -0.42;
  const lunge = Math.max(0, Math.sin(u * TAU));
  R(p, SPINE, lean * 0.5 - 0.12 * lunge, 0.15 * Math.sin(u * TAU), 0);
  A(p, CHEST, lean * 0.5 - 0.1 * lunge, 0.2 * Math.sin(u * TAU), 0);
  for (let side = 0; side < 2; side++) {
    const ui = (u + side * 0.5) % 1;
    const raise = ui < 0.4 ? smooth(ui / 0.4) : ui < 0.55 ? 1 - smooth((ui - 0.4) / 0.15) * 1.35 : -0.35 * (1 - smooth((ui - 0.55) / 0.45));
    arm(p, side, 1.25 + 0.75 * raise, 0.26 - 0.12 * raise, 0.3, 0.2 + 0.25 * Math.max(0, raise), 0.7);
  }
  const sw = Math.sin(u * TAU);
  headLook(p, 0.05 - 0.25 * lunge, 0, z.tilt * 0.15);
  R(p, JAW, -0.25 - 0.5 * Math.max(0, Math.sin(u * TAU * 2 + 1)), 0, 0);
}

function tankSmash(z, p, u) {
  // raise both arms overhead (0..0.45), smash down (0.45..0.6), recover
  let up;
  if (u < 0.45) up = smooth(u / 0.45);
  else if (u < 0.58) up = 1 - smooth((u - 0.45) / 0.13) * 1.35;
  else up = -0.35 * (1 - smooth((u - 0.58) / 0.42));
  const pitch = 0.4 + up * 2.6;
  R(p, SPINE, -0.2 + up * 0.35, 0, 0);
  R(p, CHEST, -0.2 + up * 0.25, 0, 0);
  arm(p, 0, pitch, 0.1 + 0.15 * up, 0.2, 0.3 + 0.4 * Math.max(0, up), 0.2);
  arm(p, 1, pitch, 0.1 + 0.15 * up, 0.2, 0.3 + 0.4 * Math.max(0, up), 0.2);
  headLook(p, 0.3 + up * 0.2, 0, 0, 0.3);
  R(p, JAW, -0.3 - 0.4 * Math.max(0, up), 0, 0);
}

function abomSweep(z, p, u) {
  // sweeping right claw from right to left
  const w = u < 0.4 ? smooth(u / 0.4) : u < 0.6 ? 1 - smooth((u - 0.4) / 0.2) * 2 : -1 + smooth((u - 0.6) / 0.4);
  R(p, SPINE, -0.2, w * 0.35, 0);
  R(p, CHEST, -0.15, w * 0.35, 0);
  arm(p, 1, 1.4, 0.6 + 0.8 * w, 0.2, 0.4, 0.3);
  arm(p, 0, 0.6, 0.4, 0, 0.6, 0.2);
  headLook(p, 0.15, -w * 0.3, 0, 0.3);
  R(p, JAW, -0.35 - 0.25 * Math.abs(w), 0, 0);
}

function bloaterSlap(z, p, u) {
  // one stubby arm swung out wide and back (0..0.45), slapped across the front (0.45..0.6), dragged back round
  const w = u < 0.45 ? smooth(u / 0.45) : u < 0.6 ? 1 - smooth((u - 0.45) / 0.15) * 2 : -1 + smooth((u - 0.6) / 0.4);
  const side = z.armSide, sg = side ? 1 : -1;
  R(p, SPINE, 0.06, -sg * w * 0.28, 0);
  R(p, CHEST, -0.02, -sg * w * 0.3, 0);
  arm(p, side, 1.25 + 0.15 * Math.abs(w), 0.15 + 1.05 * w, 0.2, 0.25 + 0.35 * Math.max(0, w), 0.25);
  arm(p, 1 - side, 0.45, 0.55, 0, 0.45, 0.2);
  headLook(p, 0.08, sg * w * 0.25, 0, 0.3);
  R(p, JAW, -0.3 - 0.35 * Math.abs(w), 0, 0);
  z.bellyPulse = 0.05;
}

function queenSlash(z, p, u) {
  const k = Math.sin(u * TAU);
  R(p, SPINE, -0.2, 0.2 * k, 0);
  R(p, CHEST, -0.2, 0.2 * k, 0);
  arm(p, 0, 1.2 + 0.8 * k, 0.4, 0.3, 0.6 + 1.0 * Math.max(0, -k), 0.4);
  arm(p, 1, 1.2 - 0.8 * k, 0.4, 0.3, 0.6 + 1.0 * Math.max(0, k), 0.4);
  headLook(p, 0.15, 0, 0);
  R(p, JAW, -0.3, 0, 0);
}

function poseSpecial(z, p) {
  const type = z.type, t = z.stateT, st = z.st;
  switch (type) {
    case ZTYPE.TANK: {
      // ground slam windup: rear back with arms high, trembling, then slam and hold
      clearPose(p, z.nb);
      const wind = smooth(t / 0.7);
      const slam = smooth((t - 0.75) / 0.15);
      const shake = t < 0.75 ? Math.sin(t * 60) * 0.03 * wind : 0;
      const up = wind * (1 - slam) - slam * 0.4;
      legsStatic(z, p, 0.35 * (1 - slam) + 0.6 * slam, -0.5 - 0.6 * slam, -0.2 + 0.4 * slam, -0.2 - 0.6 * slam, 0.15);
      R(p, SPINE, -0.25 + up * 0.5 + shake, 0, 0);
      R(p, CHEST, -0.25 + up * 0.35 - slam * 0.35, 0, 0);
      arm(p, 0, 0.4 + up * 2.8 + shake, 0.15, 0.2, 0.25 + 0.3 * up, 0.1);
      arm(p, 1, 0.4 + up * 2.8 - shake, 0.15, 0.2, 0.25 + 0.3 * up, 0.1);
      headLook(p, 0.4 + 0.3 * wind * (1 - slam), 0, 0, 0.3);
      R(p, JAW, -0.2 - 0.6 * wind, 0, 0);
      return;
    }
    case ZTYPE.SPITTER: {
      // rear head back, then lunge forward spitting (loops ~1.2s)
      const u = (t % 1.2) / 1.2;
      clearPose(p, z.nb);
      legsStatic(z, p, 0.3, -0.3, -0.1, -0.1, 0.05);
      const back = u < 0.45 ? smooth(u / 0.45) : 1 - smooth((u - 0.45) / 0.12);
      const fwd = u < 0.45 ? 0 : u < 0.62 ? smooth((u - 0.45) / 0.17) : 1 - smooth((u - 0.62) / 0.38);
      R(p, SPINE, -0.2 + back * 0.35 - fwd * 0.35, 0, 0);
      R(p, CHEST, -0.2 + back * 0.3 - fwd * 0.3, 0, 0);
      R(p, NECK, back * 0.5 - fwd * 0.6, 0, 0);
      R(p, HEAD, back * 0.4 - fwd * 0.15, 0, 0);
      R(p, JAW, -0.2 - back * 0.3 - fwd * 0.75, 0, 0);
      arm(p, 0, 0.3 + back * 0.4, 0.5 * back, 0, 0.6, 0.3);
      arm(p, 1, 0.3 + back * 0.4, 0.5 * back, 0, 0.6, 0.3);
      z.sacPulse = 0.18 * back + 0.1 * fwd;
      return;
    }
    case ZTYPE.LEAPER: {
      // deep crouch windup, trembling
      clearPose(p, z.nb);
      const k = smooth(t / 0.35);
      const tr = Math.sin(t * 50) * 0.02 * k;
      legsStatic(z, p, st.baseT + 0.35 * k, -st.baseK - 0.45 * k, st.baseT + 0.35 * k, -st.baseK - 0.45 * k, 0.2);
      R(p, SPINE, -0.6 - 0.15 * k + tr, 0, 0);
      R(p, CHEST, -0.5 - 0.1 * k, 0, 0);
      arm(p, 0, 0.15 + tr, 0.35, 0.2, 0.9 + 0.3 * k, 1.0);
      arm(p, 1, 0.15 - tr, 0.35, 0.2, 0.9 + 0.3 * k, 1.0);
      headLook(p, 0.45, 0, 0, 0.5);
      R(p, JAW, -0.45 * k, 0, 0);
      return;
    }
    case ZTYPE.ROPER: {
      // mouth wide open, head forward, right arm extended
      clearPose(p, z.nb);
      const k = smooth(t / 0.3);
      const q = Math.sin(t * 30) * 0.02 * k;
      legsStatic(z, p, 0.3 * k, -0.25 * k, -0.2 * k, -0.08, 0.06);
      R(p, SPINE, -0.15 - 0.15 * k, 0.1 * k, 0);
      R(p, CHEST, -0.1 - 0.1 * k, 0.15 * k, 0);
      A(p, NECK, -0.35 * k, 0, 0);
      headLook(p, 0.15 * k + q, 0, 0, 0);
      A(p, NECK, -0.3 * k, 0, 0);
      R(p, JAW, -1.1 * k, 0, 0);
      arm(p, 1, 1.5 * k + 0.1, 0.05, -0.2, 0.05, 0.1);
      arm(p, 0, 0.3, 0.3, 0, 0.8 * k, 0.3);
      return;
    }
    case ZTYPE.BOOMER: {
      poseIdle(z, p);
      z.bellyPulse = 0.12;
      A(p, SPINE, 0.12, 0, 0);
      A(p, HEAD, 0.25, 0, 0);
      R(p, JAW, -0.6, 0, 0);
      arm(p, 0, 0.4, 0.7, 0, 0.3);
      arm(p, 1, 0.4, 0.7, 0, 0.3);
      return;
    }
    case ZTYPE.BOSS_ABOMINATION: {
      // two-arm ground slam, loops
      const u = (t % 1.6) / 1.6;
      clearPose(p, z.nb);
      legsStatic(z, p, 0.35, -0.45, -0.1, -0.2, 0.12);
      const up = u < 0.5 ? smooth(u / 0.5) : u < 0.62 ? 1 - smooth((u - 0.5) / 0.12) * 1.4 : -0.4 * (1 - smooth((u - 0.62) / 0.38));
      R(p, SPINE, -0.25 + up * 0.35, 0, 0);
      R(p, CHEST, -0.2 + up * 0.3, 0, 0);
      arm(p, 0, 0.5 + up * 2.3, 0.2, 0.2, 0.3 + 0.3 * Math.max(0, up), 0.2);
      arm(p, 1, 0.5 + up * 2.3, 0.2, 0.2, 0.3 + 0.3 * Math.max(0, up), 0.2);
      headLook(p, 0.3 + up * 0.3, 0, 0, 0.3);
      R(p, JAW, -0.3 - 0.6 * Math.max(0, up), 0, 0);
      return;
    }
    case ZTYPE.BOSS_BRUTE: {
      // the enrage roar: rears up, chest out, fists spread wide and trembling, head thrown back
      clearPose(p, z.nb);
      const k = smooth(t / 0.35) * (1 - smooth((t - 1.05) / 0.3));
      const sh = Math.sin(t * 38) * 0.035 * k;
      legsStatic(z, p, 0.28 * k, -0.4 * k, -0.12 * k, -0.18 * k, 0.16);
      z.standOn = true;
      R(p, SPINE, -0.1 + 0.2 * k, 0, 0);
      R(p, CHEST, 0.18 * k + sh, 0, 0);
      arm(p, 0, 0.35 + 0.35 * k + sh, 0.15 + 1.05 * k, 0.3, 0.3 + 0.9 * k, 0.2);
      arm(p, 1, 0.35 + 0.35 * k - sh, 0.15 + 1.05 * k, 0.3, 0.3 + 0.9 * k, 0.2);
      headLook(p, 0.1 + 0.55 * k + sh, 0, 0, 0.4);
      R(p, JAW, -0.25 - 0.75 * k, 0, 0);
      z.bellyPulse = 0.1 * k;
      return;
    }
    case ZTYPE.BOSS_BLOATER: {
      // heaving bile: rears back with the gut swelling (0..0.45), then pitches forward and retches it out, loops ~0.8 s
      const u = (t % 0.8) / 0.8;
      clearPose(p, z.nb);
      legsStatic(z, p, 0.3, -0.3, -0.12, -0.12, 0.16);
      z.standOn = true;
      const back = u < 0.45 ? smooth(u / 0.45) : 1 - smooth((u - 0.45) / 0.12);
      const fwd = u < 0.45 ? 0 : u < 0.6 ? smooth((u - 0.45) / 0.15) : 1 - smooth((u - 0.6) / 0.4) * 0.7;
      const q = Math.sin(t * 34) * 0.025 * fwd;
      R(p, SPINE, 0.05 + back * 0.28 - fwd * 0.32 + q, 0, 0);
      R(p, CHEST, back * 0.2 - fwd * 0.28, 0, 0);
      R(p, NECK, back * 0.3 - fwd * 0.45, 0, 0);
      R(p, HEAD, back * 0.25 - fwd * 0.15 + q, 0, 0);
      R(p, JAW, -0.2 - back * 0.25 - fwd * 0.85, 0, 0);
      arm(p, 0, 0.35 + back * 0.3 + fwd * 0.5, 0.45 + back * 0.5, 0, 0.5 - fwd * 0.2, 0.3);
      arm(p, 1, 0.35 + back * 0.3 + fwd * 0.5, 0.45 + back * 0.5, 0, 0.5 - fwd * 0.2, 0.3);
      z.bellyPulse = 0.14 * back + 0.2 * fwd;
      return;
    }
    case ZTYPE.BOSS_HIVEQUEEN: {
      // spit barrage: rapid head recoils
      clearPose(p, z.nb);
      legsStatic(z, p, 0.2, -0.3, -0.05, -0.2, 0.1);
      const u = (t % 0.32) / 0.32;
      const rec = u < 0.15 ? smooth(u / 0.15) : 1 - smooth((u - 0.15) / 0.85);
      R(p, SPINE, -0.2 + rec * 0.08, 0, 0);
      R(p, CHEST, -0.15 + rec * 0.1, 0, 0);
      headLook(p, 0.25 + rec * 0.45, Math.sin(t * 3) * 0.3, 0, 0.4);
      R(p, JAW, -0.2 - 0.5 * rec, 0, 0);
      arm(p, 0, 0.9, 0.5, 0.3, 2.0, 0.4);
      arm(p, 1, 0.9, 0.5, 0.3, 2.0, 0.4);
      z.abdPulse = 0.08 * rec;
      return;
    }
    default:
      // walker/runner: lunge bite
      return poseAttack(z, p);
  }
}

/** Standing over the prey between swipes: braced like the attack, arms up clutching at it, heaving, jaw snapping. */
function poseMenace(z, p) {
  const st = z.st;
  if (st.quad || st.knuckle || st.mantis || st.waddle || z.def.boss) return poseIdle(z, p);
  const t = z.time + z.off;
  legsStatic(z, p, 0.35, -0.35, -0.15, -0.1, st.legSplay || 0.05);
  z.standOn = true;
  const heave = Math.sin(t * 3.4 * z.rate);
  const tw = twitch(z, t, st.twitchy ? 2.2 : 1.1);
  const sway = n1(t * 0.7, z.seed + 13);
  R(p, SPINE, -0.21 + 0.035 * heave - 0.08 * Math.abs(tw), 0.12 * sway, 0.05 * sway);
  R(p, CHEST, -0.21 + 0.03 * heave, 0.08 * sway + 0.1 * tw, 0);
  p[z.nb * 4] = 0.03 * sway;
  posture(z, p);
  for (let s = 0; s < 2; s++) {
    // each hand grabs on its own slow rhythm: reach out, clutch, pull back
    const g = Math.sin(t * (2.1 + 0.4 * s) * z.rate + s * 2.3 + z.seed);
    const n = n1(t * 1.3, z.seed + 20 + s);
    arm(p, s, 1.3 + 0.18 * g + 0.1 * n + 0.2 * tw, 0.24 - 0.06 * g, 0.3, 0.25 + 0.35 * Math.max(0, -g), 0.55 + 0.25 * Math.max(0, g));
  }
  headLook(p, 0.05 + 0.04 * heave + tw * 0.25, n1(t * 0.9, z.seed + 6) * 0.2 + tw * 0.35, z.tilt * 0.2 + tw * 0.2, 0.5);
  R(p, JAW, -0.3 - 0.35 * Math.max(0, Math.sin(t * 6.3 + 0.7 * n1(t, z.seed))) - 0.2 * Math.abs(tw), 0, 0);
}

/** Hit reaction: torso and head snap back, arms jerk out, then it recovers (additive, upper body only). */
function poseFlinch(z, p) {
  const t = z.flinchT, s = z.flinchSide;
  const e = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 7);
  A(p, SPINE, 0.12 * e, 0.12 * s * e, 0.06 * s * e);
  A(p, CHEST, 0.1 * e, 0.1 * s * e, 0);
  A(p, NECK, 0.1 * e, 0, 0);
  A(p, HEAD, 0.3 * e, 0.25 * s * e, 0.22 * s * e);
  A(p, JAW, -0.3 * e, 0, 0);
  A(p, UARM_L, 0.25 * e, 0, -0.35 * e);
  A(p, UARM_R, 0.25 * e, 0, 0.35 * e);
  A(p, FARM_L, 0.3 * e, 0, 0);
  A(p, FARM_R, 0.3 * e, 0, 0);
}

// growl / scream / roar: jaw gape, head lift or thrust, chest heave
const VOX = [
  { dur: 1.4, jaw: 0.5, head: 0.14, chest: 0.04 },
  { dur: 1.0, jaw: 0.95, head: -0.2, chest: -0.08 },
  { dur: 1.6, jaw: 0.85, head: 0.35, chest: 0.12 },
];
function poseVocal(z, p) {
  const V = VOX[z.voxKind], u = z.voxT / V.dur, t = z.time + z.off;
  const e = smooth(u / 0.12) * (1 - smooth((u - 0.75) / 0.25)) * (0.8 + 0.2 * Math.sin(u * 23 + z.seed));
  A(p, JAW, -V.jaw * e - 0.05 * e * Math.sin(t * 37), 0, 0);
  A(p, NECK, V.head * 0.4 * e, 0, 0);
  A(p, HEAD, V.head * 0.6 * e, 0, z.tilt * 0.1 * e);
  A(p, CHEST, V.chest * e, 0, 0);
}

// ------------------------------------------------------------------ gaze: nearby zombies turn their heads to stare at the viewer
const viewer = { x: 0, y: 0, z: 0, on: false };
/** Camera position the zombies may stare at this frame (call once per frame). */
export function setZombieViewer(x, y, z) {
  viewer.x = x;
  viewer.y = y;
  viewer.z = z;
  viewer.on = true;
}
const GAZE_NEAR = 13, GAZE_FAR = 19;
/** Updates the instance's smoothed gaze (yaw/pitch relative to its facing, weight). */
function updateGaze(z, dt) {
  const st = z.state;
  let want = 0, yaw = z.gazeYaw, pitch = z.gazePitch;
  if (viewer.on && st !== ZANIM.DEAD && st !== ZANIM.STAGGER && st !== ZANIM.AIRBORNE && st !== ZANIM.SPECIAL) {
    const o = z.object.position;
    const dx = viewer.x - o.x, dz = viewer.z - o.z;
    const d = Math.hypot(dx, dz);
    const c = Math.cos(z.wyaw), sn = Math.sin(z.wyaw);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c; // viewer in the body's frame (front = -z)
    const a = Math.atan2(-lx, -lz);
    // feeding zombies only look up when someone gets close
    const range = st === ZANIM.EAT ? 7 : GAZE_FAR;
    if (d < range && Math.abs(a) < 1.9) {
      want = clamp((range - d) / (range - (st === ZANIM.EAT ? 5 : GAZE_NEAR)), 0, 1) * (st === ZANIM.RUN ? 0.6 : 1);
      yaw = clamp(a, -1.15, 1.15);
      pitch = clamp(Math.atan2(viewer.y - (o.y + z.def.headY), Math.max(d, 0.5)), -0.75, 0.6);
    }
  }
  // the head follows in quick jerks (fast when far off, settling slowly), not a smooth servo
  const ky = Math.min(1, dt * (Math.abs(yaw - z.gazeYaw) > 0.35 ? 9 : 3));
  z.gazeYaw += (yaw - z.gazeYaw) * ky;
  z.gazePitch += (pitch - z.gazePitch) * Math.min(1, dt * 4);
  z.gazeW += (want - z.gazeW) * Math.min(1, dt * (want > z.gazeW ? 2.5 : 1.5));
}
/** Turns neck + head (and a little chest) so the face points along the gaze. */
function applyGaze(z, p) {
  const w = z.gazeW;
  const curYaw = p[HIPS * 4 + 1] + p[SPINE * 4 + 1] + p[CHEST * 4 + 1] + p[NECK * 4 + 1] + p[HEAD * 4 + 1];
  const curPitch = chestPitch(p) + p[NECK * 4] + p[HEAD * 4];
  const dy = (z.gazeYaw - curYaw) * w, dp = (z.gazePitch - curPitch) * w;
  p[CHEST * 4 + 1] += dy * 0.15;
  p[NECK * 4 + 1] += dy * 0.35;
  p[HEAD * 4 + 1] += dy * 0.5;
  p[NECK * 4] += dp * 0.4;
  p[HEAD * 4] += dp * 0.6;
  p[HEAD * 4 + 2] += z.tilt * 0.12 * w; // head cocked while it stares
}

function poseAir(z, p) {
  const t = z.stateT, st = z.st, type = z.type;
  if (type === ZTYPE.LEAPER || st.quad) {
    // pounce: limbs spread forward
    const k = smooth(t / 0.2);
    legsStatic(z, p, 0.2 - 0.6 * k, -0.4 - 0.6 * k, 0.1 - 0.5 * k, -0.5 - 0.5 * k, 0.25);
    p[z.nb * 4 + 1] = 0;
    R(p, SPINE, -0.55, 0, 0);
    R(p, CHEST, -0.3, 0, 0);
    arm(p, 0, 1.7 + Math.sin(t * 20) * 0.08, 0.7, 0.2, 0.3, 0.5);
    arm(p, 1, 1.7 - Math.sin(t * 20) * 0.08, 0.7, 0.2, 0.3, 0.5);
    headLook(p, 0.1, 0, 0, 0.4);
    R(p, JAW, -0.8, 0, 0);
    return;
  }
  const f = Math.sin(t * 9);
  R(p, SPINE, -0.1, 0, 0);
  R(p, CHEST, 0.05, 0, 0);
  R(p, THIGH_L, 0.7 + 0.2 * f, 0, -0.1);
  R(p, SHIN_L, -1.0, 0, 0);
  R(p, THIGH_R, 0.3 - 0.2 * f, 0, 0.1);
  R(p, SHIN_R, -0.6, 0, 0);
  arm(p, 0, 1.9 + 0.3 * f, 0.7, 0, 0.4, 0.3);
  arm(p, 1, 1.9 - 0.3 * f, 0.7, 0, 0.4, 0.3);
  headLook(p, 0.2, 0, 0);
  R(p, JAW, -0.6, 0, 0);
}

function poseStagger(z, p) {
  const t = z.stateT, st = z.st;
  const e = Math.exp(-t * 4.5);
  const w = Math.sin(t * 9) * Math.exp(-t * 3);
  const lean = st.quad ? -0.8 : st.knuckle ? -0.3 : -0.1;
  legsStatic(z, p, -0.25 * e + (st.baseT || 0) * 0.7, -0.35 - (st.baseK || 0) * 0.7, 0.3 * e + (st.baseT || 0) * 0.7, -0.3 * e - (st.baseK || 0) * 0.7, 0.1);
  R(p, SPINE, lean * 0.5 + 0.35 * e + 0.05 * w, 0.2 * w, 0.1 * w);
  R(p, CHEST, lean * 0.5 + 0.3 * e, 0.1 * w, 0);
  arm(p, 0, 0.8 * e + 0.2, 0.6 * e + 0.15, 0, 0.5, 0.3);
  arm(p, 1, 0.9 * e + 0.2, 0.7 * e + 0.15, 0, 0.6, 0.3);
  headLook(p, 0.6 * e + 0.1 + 0.1 * w, 0.2 * w, 0.3 * w);
  R(p, JAW, -0.5 * e - 0.1, 0, 0);
  p[z.nb * 4 + 2] += 0.12 * (1 - e);
}

function poseDead(z, p) {
  const t = z.stateT;
  const dir = z.deadDir; // 1 = fall forward (face down), -1 = backward (face up)
  const P = z.P;
  const buckle = smooth(t / 0.28);
  const k = clamp((t - 0.08) / 0.55, 0, 1);
  const fall = k * k;
  const settle = t > 0.63 ? Math.exp(-(t - 0.63) * 10) * Math.sin((t - 0.63) * 25) * 0.04 : 0;
  const up = 1 - fall;
  // legs: knees buckle, then lie flat (face-up: one knee raised)
  const bentL = z.seed & 2 ? 1 : 0;
  if (dir > 0) {
    R(p, THIGH_L, 0.55 * buckle * up, 0, -0.1 * fall);
    R(p, SHIN_L, -0.9 * buckle * up - (bentL ? 0.9 : 0.15) * fall, 0, 0);
    R(p, FOOT_L, 0.6 * fall, 0, 0);
    R(p, THIGH_R, 0.4 * buckle * up, 0, 0.18 * fall);
    R(p, SHIN_R, -0.7 * buckle * up - 0.1 * fall, 0, 0);
    R(p, FOOT_R, 0.7 * fall, 0, 0);
  } else {
    R(p, THIGH_L, 0.55 * buckle * up + (bentL ? 0.7 : 0.05) * fall, 0, -0.12 * fall);
    R(p, SHIN_L, -0.9 * buckle * up - (bentL ? 1.2 : 0.05) * fall, 0, 0);
    R(p, FOOT_L, -0.3 * fall, 0, 0);
    R(p, THIGH_R, 0.4 * buckle * up + 0.05 * fall, 0, 0.2 * fall);
    R(p, SHIN_R, -0.7 * buckle * up - 0.05 * fall, 0, 0);
    R(p, FOOT_R, -0.4 * fall, 0, 0);
  }
  // straighten the spine as the body lands
  const sp = (z.st.idleLean || 0) * up;
  R(p, SPINE, sp * 0.5, 0.12 * fall * dir, 0.05 * fall);
  R(p, CHEST, sp * 0.5, 0.1 * fall * dir, 0);
  R(p, NECK, 0, 0, 0);
  R(p, HEAD, 0, (z.seed & 4 ? 1 : -1) * 1.2 * fall, 0);
  R(p, JAW, -0.35, 0, 0);
  // arms flop out in the ground plane (abduction, not pitch, so they rest on the ground)
  const as = z.seed & 8 ? 1 : 0;
  R(p, UARM_L, 0.4 * up, 0, -(0.25 * up + (as ? 2.6 : 0.6) * fall));
  R(p, FARM_L, 0.35 * up + 0.12 * fall, 0, 0);
  R(p, HAND_L, 0, 0, 0);
  R(p, UARM_R, 0.4 * up, 0, 0.25 * up + (as ? 0.5 : 2.3) * fall);
  R(p, FARM_R, 0.3 * up + 0.12 * fall, 0, 0);
  R(p, HAND_R, 0, 0, 0);
  // topple the whole body around the feet
  R(p, ROOT, -dir * (HALF * fall + settle), 0, 0);
  const n = z.nb * 4;
  const drop = (P.thighLen + P.shinLen) * (1 - Math.cos(0.55)) * buckle * up * 0.6;
  p[n + 1] = -drop + (P.depth || 0.12) * 1.15 * fall;
  p[n + 2] = dir * 0.45 * fall * (P.hipY / 0.93);
}

function poseEat(z, p) {
  const t = z.time + z.off;
  const P = z.P;
  // kneel
  const th = 0.3;
  R(p, THIGH_L, th, 0, -0.15);
  R(p, SHIN_L, -(HALF + th) - 0.05, 0, 0);
  R(p, FOOT_L, 0.5, 0, 0);
  R(p, THIGH_R, th + 0.25, 0, 0.12);
  R(p, SHIN_R, -(HALF + th + 0.25) - 0.05, 0, 0);
  R(p, FOOT_R, 0.5, 0, 0);
  const hipH = P.thighLen * Math.cos(th) + (z.st.knuckle ? 0.12 : 0.06);
  p[z.nb * 4 + 1] = hipH - P.thighY;
  const tear = Math.max(0, Math.sin(t * 2.4));
  const chew = Math.sin(t * 9);
  R(p, SPINE, -0.55 + 0.1 * tear, 0, 0);
  R(p, CHEST, -0.5 + 0.12 * tear, 0.1 * Math.sin(t * 1.2), 0);
  headLook(p, -0.45 + 0.35 * tear, 0.25 * Math.sin(t * 5) * tear, 0.2 * tear);
  R(p, JAW, -0.25 - 0.2 * chew, 0, 0);
  const pl = Math.sin(t * 2.4 + 1);
  arm(p, 0, 0.45 + 0.25 * pl, 0.3, 0.3, 0.7 + 0.5 * Math.max(0, pl), 0.6);
  arm(p, 1, 0.45 - 0.25 * pl, 0.3, 0.3, 0.7 + 0.5 * Math.max(0, -pl), 0.6);
}

/**
 * Climbing out of a grave (ZANIM.RISE). The server brings its feet up from a body's height under the grass in two
 * heaves (riseDepth in shared/cemetery.js: the ground hides what is not out yet); this is what the body does
 * meanwhile. It claws its way up with its arms over its head, plants its hands on the grass with its chest out,
 * then gets a knee over the lip and stands.
 */
function poseRise(z, p) {
  const st = z.st, t = z.time + z.off;
  if (st.quad || st.knuckle) return poseIdle(z, p);
  const u = clamp(z.stateT / CEMETERY.RISE, 0, 1);
  const up = 1 - smooth((u - 0.28) / 0.2); // clawing up through the earth
  const stand = smooth((u - 0.55) / 0.45); // straightening up at the end
  const haul = 1 - stand; // (and between the two: hands planted, hauling)
  const claw = Math.sin(t * 8.5), shake = Math.sin(t * 31) * 0.03 * haul;
  const lean = lerp(lerp(-0.72, -0.12, up), st.idleLean || 0, stand);
  // a knee comes up over the lip of the grave half way through the second heave
  const step = Math.sin(PI * clamp((u - 0.55) / 0.4, 0, 1));
  const kL = z.limpSide ? 0 : step, kR = z.limpSide ? step : 0;
  legsStatic(z, p, 1.05 * kL, -1.5 * kL, 1.05 * kR, -1.5 * kR, 0.06);
  R(p, SPINE, lean * 0.55 + shake, 0.12 * claw * up, 0.05 * claw * up);
  R(p, CHEST, lean * 0.45, 0.1 * claw * up, 0);
  posture(z, p);
  // overhead, one hand after the other; then forward and down onto the grass; then hanging as they always do
  for (let side = 0; side < 2; side++) {
    const c = side ? -claw : claw;
    const pitch = lerp(lerp(1.0, 2.7 + 0.3 * c, up), side ? 0.14 : 0.18, stand);
    const elbow = lerp(lerp(0.3, 0.7 - 0.45 * c, up), 0.4, stand);
    arm(p, side, pitch, lerp(0.3, 0.1 + (st.armOut || 0), stand), 0.25, elbow, lerp(0.65, 0.35, stand));
  }
  headLook(p, lerp(lerp(0.35, 0.75, up), st.headPitch, stand), 0.3 * Math.sin(t * 2.3) * haul, z.tilt * st.headTilt + 0.2 * claw * up, 0.3);
  R(p, JAW, -st.jaw - 0.45 * haul - 0.1 * claw * up, 0, 0);
}

// ------------------------------------------------------------------ legs shot off (ZombieInstance.setLegs)
// A shot in the leg trips it (ZANIM.STUMBLE). With one leg gone it hops along on the other, with both gone it lies
// prone and drags itself forward by its arms. The server's speeds (HOBBLE_SPEED, CRAWL_SPEED in constants.js) and its
// crawler hitbox (CRAWL_HEAD_FWD) are what these poses are drawn to.
const HOP_MIN = 0.42, HOP_MAX = 1.0; // ground one hop covers (m), by speed
const CRAWL_CYCLE = 0.95; // ground one crawl cycle covers (m): a pull of each arm
const CRAWL_REACH = 2.75, CRAWL_TUCK = 1.05; // upper arm swung out ahead of the shoulder / drawn back beside the ribs (rad)

/** Ground covered by one cycle of the phase for a zombie that has lost legs. */
function legCycleLen(z, speed) {
  return z.legs === 3 ? CRAWL_CYCLE : clamp(0.34 + 0.2 * speed, HOP_MIN, HOP_MAX);
}

/** Tripped by a shot in the leg: that knee gives, the body pitches forward over it and the arms fly out to catch it. */
function poseStumble(z, p) {
  if (z.legs) return poseHobble(z, p);
  const st = z.st, P = z.P, n = z.nb * 4, t = z.stateT;
  const k = smooth(t / 0.1) * Math.exp(-Math.max(0, t - 0.1) * 3.4); // snaps in, then it catches itself
  const w = Math.sin(t * 12) * Math.exp(-t * 3.5);
  const b = z.limpSide; // the leg that gives way
  const lean = (st.idleLean || 0) * 0.5;
  const tB = 0.75 * k, kB = -1.35 * k - 0.1; // buckled: the knee drops forward
  const tC = -0.3 * k, kC = -0.45 * k - 0.08; // the other is left behind, bent
  if (b) legsStatic(z, p, tC, kC, tB, kB, 0.07);
  else legsStatic(z, p, tB, kB, tC, kC, 0.07);
  p[n + 1] -= (P.thighLen + P.shinLen) * 0.16 * k; // (legsStatic grounds the straighter leg; the trip drops it further)
  R(p, HIPS, 0, (b ? -1 : 1) * 0.2 * k, (b ? 1 : -1) * 0.14 * k);
  R(p, SPINE, lean - 0.38 * k + 0.05 * w, 0.14 * w, (b ? -1 : 1) * 0.12 * k);
  R(p, CHEST, lean - 0.3 * k, 0.1 * w, 0);
  posture(z, p);
  arm(p, 0, 0.35 + 0.95 * k, 0.2 + 0.5 * k, 0.1, 0.45 - 0.2 * k, 0.4);
  arm(p, 1, 0.3 + 1.1 * k, 0.2 + 0.4 * k, 0.1, 0.5 - 0.25 * k, 0.4);
  headLook(p, st.headPitch - 0.35 * k + 0.12 * w, 0.2 * w, z.tilt * st.headTilt + 0.25 * w, 0.3);
  R(p, JAW, -st.jaw - 0.45 * k, 0, 0);
}

/**
 * One leg left: it hops. Each cycle of the phase is one hop - the foot lands ahead, the body vaults over it, the knee
 * sinks and shoves off - while the stump swings and the arms flail for balance. A fresh hit (ZANIM.STUMBLE) nearly
 * has it over.
 */
function poseHobble(z, p) {
  const st = z.st, P = z.P, n = z.nb * 4, t = z.time + z.off;
  const side = z.legs === 1 ? 1 : 0; // the leg it has left (legs: bit 0 = the left is gone)
  const sg = side ? 1 : -1;
  const good = side ? THIGH_R : THIGH_L, gone = side ? THIGH_L : THIGH_R;
  const u = frac(z.phase / TAU);
  const trip = z.state === ZANIM.STUMBLE ? smooth(z.stateT / 0.1) * Math.exp(-Math.max(0, z.stateT - 0.1) * 3.2) : 0;
  const hops = Math.floor(z.phase / TAU);
  if (z.hopN !== undefined && hops !== z.hopN) z.footfalls++;
  z.hopN = hops;
  z.hopOn = true;
  // On the ground for the first ST of the cycle, in the air for the rest. The ankle is placed and the leg fitted to
  // it: planted, it is left behind by exactly the ground the body covers meanwhile, so the foot does not skate
  const ST = 0.62, L1 = P.thighLen, L2 = P.shinLen, L = L1 + L2;
  const half = Math.min(L * 0.45, (legCycleLen(z, z.speed) * ST) / (2 * (z.rate || 1) * (z.gScale || 1))); // half the planted stretch (rig units)
  const top = Math.sqrt(L * L * 0.96 - half * half); // hip height with the leg all but straight at either end of it
  let fz, hip, foot = 0, toe = 0;
  if (u < ST) {
    const s = u / ST;
    fz = -half * (1 - 2 * s); // lands ahead, is left behind
    hip = top - L * (0.07 + 0.05 * trip) * Math.sin(PI * Math.min(1, s * 1.3)); // sinks on landing, straightens to shove off
  } else {
    const f = (u - ST) / (1 - ST), arc = Math.sin(PI * f);
    fz = half * (1 - 2 * smooth(f));
    hip = top + L * (0.045 + 0.03 * Math.min(1, z.speed / 2.5)) * arc;
    foot = L * 0.09 * arc;
    toe = 0.5 * arc;
  }
  // (the two-bone fit of legsIK, in the plane the leg swings in)
  const vy = -(hip - foot);
  const d = clamp(Math.hypot(fz, vy), Math.abs(L1 - L2) + 0.02, L * 0.9995);
  const ck = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
  const kn = -Math.acos(ck);
  let th = Math.atan2(fz, vy) - Math.atan2(-L2 * Math.sin(kn), -(L1 + L2 * ck));
  if (th > PI) th -= TAU;
  else if (th < -PI) th += TAU;
  R(p, good, th, 0, sg * 0.04);
  R(p, good + 1, kn, 0, 0);
  R(p, good + 2, toe - (th + kn), 0, 0);
  // the stump: held up in front, pumping against the hop
  const pump = Math.sin(z.phase);
  R(p, gone, 0.5 + 0.28 * pump, 0, -sg * 0.1);
  R(p, gone + 1, -0.3, 0, 0);
  p[n + 1] += hip - L;
  // the weight is over the one foot: the hips shift across, the shoulders lean back out to balance
  p[n] -= sg * P.hipW * 0.8;
  const land = u < 0.25 ? Math.sin((u / 0.25) * PI) : 0; // the jolt of each landing
  const lean = st.walkLean * 0.55;
  R(p, HIPS, 0.04 * land, -sg * 0.1 + 0.08 * pump, -sg * (0.1 + 0.05 * land));
  R(p, SPINE, lean * 0.5 - 0.06 * land - 0.3 * trip, 0.08 * pump, sg * (0.12 + 0.04 * land));
  R(p, CHEST, lean * 0.5 - 0.05 * land - 0.25 * trip, 0.06 * pump, sg * 0.06);
  posture(z, p);
  const wave = n1(t * 1.6, z.seed + 17) * 0.2;
  arm(p, side, 0.45 + 0.3 * pump + 0.6 * trip, 0.5 + 0.15 * land + wave, 0.1, 0.5 + 0.2 * land, 0.3);
  arm(p, 1 - side, 0.75 - 0.3 * pump + 0.7 * trip, 0.75 + 0.2 * land - wave, 0.1, 0.35, 0.3);
  headLook(p, st.headPitch - 0.08 * land - 0.3 * trip, n1(t * 0.5, z.seed + 4) * 0.25, z.tilt * st.headTilt - sg * 0.08, 0.3);
  R(p, JAW, -st.jaw * (0.6 + 0.4 * Math.abs(Math.sin(t * 2.1))) - 0.3 * trip, 0, 0);
}

/** Standing (not hopping) on the one leg it has left: the hips shift across over that foot, the shoulders back out. */
function oneLegged(z, p) {
  if (z.hopOn) return;
  const P = z.P, n = z.nb * 4, t = z.time + z.off;
  const sg = z.legs === 1 ? 1 : -1;
  const wob = n1(t * 0.9, z.seed + 31);
  p[n] -= sg * P.hipW * 0.8 + wob * 0.02;
  A(p, HIPS, 0, 0, -sg * 0.08);
  A(p, SPINE, 0, 0, sg * (0.1 + 0.03 * wob));
  A(p, UARM_L, 0, 0, -0.18 - 0.08 * wob);
  A(p, UARM_R, 0, 0, 0.18 - 0.08 * wob);
}

/** Head centre (y up, z back) of the spine chain bent only about X, in the root's frame: rig units. */
const _hc = { y: 0, z: 0 };
function headYZ(z, p) {
  const P = z.P;
  let th = p[HIPS * 4];
  let y = P.hipY + Math.cos(th) * P.spineLen, zz = Math.sin(th) * P.spineLen;
  th += p[SPINE * 4];
  y += Math.cos(th) * P.chestLen;
  zz += Math.sin(th) * P.chestLen;
  th += p[CHEST * 4];
  y += Math.cos(th) * P.neckOff - Math.sin(th) * P.neckZ;
  zz += Math.sin(th) * P.neckOff + Math.cos(th) * P.neckZ;
  th += p[NECK * 4];
  y += Math.cos(th) * P.neckLen - Math.sin(th) * (P.headZ - P.neckZ);
  zz += Math.sin(th) * P.neckLen + Math.cos(th) * (P.headZ - P.neckZ);
  th += p[HEAD * 4];
  _hc.y = y + Math.cos(th) * P.headR * 0.9;
  _hc.z = zz + Math.sin(th) * P.headR * 0.9;
  return _hc;
}

/** Height over the entity's ground (rig units) of the point (0, ly, 0) of a bone, from the pose alone. */
function boneHeight(z, p, b, ly) {
  const par = z.parent, lp = z.localPos, n = z.nb * 4;
  _v3.x = 0;
  _v3.y = ly;
  _v3.z = 0;
  for (let i = b; i > 0; i = par[i]) {
    rotXYZ(p[i * 4], p[i * 4 + 1], p[i * 4 + 2], false);
    if (i === ROOT) _v3.y += p[n + 1];
    else {
      _v3.x += lp[i * 3];
      _v3.y += lp[i * 3 + 1];
      _v3.z += lp[i * 3 + 2];
    }
  }
  return _v3.y;
}

/**
 * An arm of a body lying prone, from _arm[side * 6..]: swung `out` from the ribs towards straight ahead, lifted, the
 * elbow hitched `up` off the ground. The elbow then bends as far as it takes to put the hand `hand` above the ground
 * (0: flat on it), or by `elbow` when hand < 0 (in the air).
 */
const _arm = new Float32Array(12);
function crawlArm(z, p, side) {
  const o = side * 6, sg = side ? 1 : -1, ua = side ? UARM_R : UARM_L;
  const hand = _arm[o + 5];
  let elbow = _arm[o + 3];
  R(p, ua, _arm[o + 1], -sg * _arm[o + 2], sg * _arm[o]);
  R(p, ua + 2, _arm[o + 4], 0, 0);
  if (hand >= 0 && z.parent) {
    // the forearm swings down towards the ground as the elbow bends: bisect for the bend that lands the palm
    const tip = -z.P.handLen * 0.6, want = 0.035 + hand;
    let lo = 0.05, hi = 2.1;
    for (let i = 0; i < 9; i++) {
      elbow = (lo + hi) * 0.5;
      p[(ua + 1) * 4] = elbow;
      if (boneHeight(z, p, ua + 2, tip) > want) lo = elbow;
      else hi = elbow;
    }
  }
  R(p, ua + 1, elbow, 0, 0);
}

/**
 * Both legs gone: it lies on its front, chest propped up, and hauls itself along - one arm reaches out, plants and
 * drags the body past it while the other comes forward, the stumps trailing. Every state is played from the ground:
 * it rears and swipes to attack, drops flat when hit and goes limp when it dies. The root is placed so that the head
 * is CRAWL_HEAD_FWD ahead of the entity, where the server's hitbox for a crawler has it.
 */
function poseCrawl(z, p) {
  const st = z.st, P = z.P, n = z.nb * 4, t = z.time + z.off, s = z.state;
  const dead = s === ZANIM.DEAD;
  const limp = dead ? smooth(z.stateT / 0.5) : 0;
  const hit = s === ZANIM.STUMBLE || s === ZANIM.STAGGER ? Math.exp(-z.stateT * 3.5) : 0;
  const up = (1 - limp) * (1 - 0.75 * hit); // how much of its propped-up posture it is holding
  const attack = s === ZANIM.ATTACK;
  const drag = !dead && !attack && (s === ZANIM.WALK || s === ZANIM.RUN || z.speed > 0.3) ? Math.min(1, z.speed / 0.5) : 0;
  const ph = z.phase;
  const br = Math.sin(t * 1.5 * z.rate);
  // the pull of each arm: 0..1 from its reach to its tuck while planted (the first PULL of its cycle), then back
  const PULL = 0.58;
  let rear = 0, lunge = 0, bite = 0;
  if (attack) {
    const per = (z.def.rate || 1) / z.rate;
    const a = (z.stateT % per) / per;
    rear = a < 0.3 ? smooth(a / 0.3) : 1 - smooth((a - 0.3) / 0.14); // rears up on one arm...
    lunge = a < 0.3 ? 0 : a < 0.48 ? smooth((a - 0.3) / 0.18) : 1 - smooth((a - 0.48) / 0.4); // ...and throws itself at the ankles
    bite = Math.max(0, Math.sin(a * TAU * 2 + 1));
  }
  const special = s === ZANIM.SPECIAL ? smooth(z.stateT / 0.3) : 0;
  if (special) z.bellyPulse = 0.12;
  // torso: prone, arched up off the ground from the hips to the head
  const arch = (0.9 + 0.1 * br * (1 - drag) + 0.35 * rear - 0.25 * lunge + 0.2 * special) * up;
  const sway = Math.sin(ph) * drag; // +1 while the right arm pulls
  R(p, ROOT, -HALF, 0.1 * sway * up + 0.05 * limp * z.tilt, 0);
  R(p, HIPS, 0.04 * arch, 0, 0.1 * sway * up);
  R(p, SPINE, 0.14 * arch, 0.06 * sway, -0.12 * sway * up);
  R(p, CHEST, 0.2 * arch, 0.1 * sway, -0.06 * sway * up);
  const look = n1(t * 0.4, z.seed + 4) * 0.3 * up * (1 - drag * 0.5);
  R(p, NECK, 0.3 * arch, look * 0.3, look * 0.5 + 0.9 * limp * z.tilt);
  R(p, HEAD, 0.38 * arch + 0.1 * bite * up, look * 0.3, look * 0.6 + z.tilt * st.headTilt * 0.5 * up);
  R(p, JAW, -(st.jaw * (0.6 + 0.4 * Math.abs(Math.sin(t * 1.9))) + 0.45 * bite + 0.3 * hit + 0.25 * special) * (1 - 0.6 * limp) - 0.2 * limp, 0, 0);
  // the stumps trail behind, twitching with each pull
  const kick = Math.sin(ph + 0.6) * drag;
  R(p, THIGH_L, -0.06 - 0.1 * Math.max(0, kick) * up, 0, -0.1 - 0.05 * limp);
  R(p, THIGH_R, -0.06 - 0.1 * Math.max(0, -kick) * up, 0, 0.1 + 0.16 * limp);
  // arms
  for (let side = 0; side < 2; side++) {
    const a = frac(ph / TAU + (side ? 0 : 0.5));
    const pull = a < PULL ? a / PULL : 1 - smooth((a - PULL) / (1 - PULL)); // 0 at full reach, 1 tucked
    const swing = a < PULL ? 0 : Math.sin(((a - PULL) / (1 - PULL)) * PI); // off the ground on the way forward
    // at rest it is propped on both hands, elbows out
    let out = lerp(1.75 + 0.12 * br * (side ? 1 : -1), lerp(CRAWL_REACH, CRAWL_TUCK, pull), drag);
    let lift = lerp(0.12, 0.1 + 0.3 * swing, drag);
    let hitch = lerp(0.35, 0.5 * Math.sin(PI * pull) * (1 - swing), drag) * up; // elbows up and out, like a lizard's
    let wrist = lerp(-0.45, -0.45 + 0.4 * swing, drag);
    let hand = 0.16 * swing * drag; // how far off the ground the hand is carried
    let elbow = 0;
    if (attack && side === z.armSide) {
      // the swiping arm: drawn back and up as it rears, flung out at the ankles
      out = lerp(1.5, 2.7, lunge);
      lift = 0.75 * rear + 0.25 * lunge;
      hitch = 0;
      elbow = 1.2 * rear * (1 - lunge) + 0.25;
      wrist = 0.5 * lunge;
      hand = -1;
    } else if (attack) out = 1.6;
    // hit: the arms splay and it drops onto its chest; dead: they lie where they fall
    const o = side * 6;
    _arm[o] = lerp(out, side === (z.seed & 8 ? 1 : 0) ? 2.5 : 1.1, limp) + 0.35 * hit * (side ? 1 : -1) * (z.flinchSide || 1);
    _arm[o + 1] = lerp(lift, 0.02, limp);
    _arm[o + 2] = hitch;
    _arm[o + 3] = elbow;
    _arm[o + 4] = lerp(wrist, -0.1, limp);
    _arm[o + 5] = hand;
  }
  // on its belly, the hips on the ground; the head CRAWL_HEAD_FWD ahead of the entity
  const h = headYZ(z, p);
  p[n] = 0;
  p[n + 1] = (P.depth || 0.12) * 1.12 - 0.015 * Math.abs(sway) * up;
  p[n + 2] = -CRAWL_HEAD_FWD / (z.gScale || 1) + h.y - (z.cal ? z.cal.dz : 0);
  // (the hands go down once the body is where it will be)
  for (let side = 0; side < 2; side++) crawlArm(z, p, side);
}

function poseHumanoid(z) {
  const p = z.pose;
  clearPose(p, z.nb);
  z.sacPulse = 0;
  z.bellyPulse = 0;
  z.abdPulse = 0;
  z.gOn = false;
  z.standOn = false;
  z.hopOn = false;
  if (z.legs === 3) poseCrawl(z, p);
  else switch (z.state) {
    case ZANIM.STUMBLE: poseStumble(z, p); break;
    case ZANIM.WALK: poseLoco(z, p, false); break;
    case ZANIM.RUN: poseLoco(z, p, true); break;
    case ZANIM.ATTACK: poseAttack(z, p); break;
    case ZANIM.SPECIAL: poseSpecial(z, p); break;
    case ZANIM.AIRBORNE: poseAir(z, p); break;
    case ZANIM.STAGGER: poseStagger(z, p); break;
    case ZANIM.DEAD: poseDead(z, p); break;
    case ZANIM.EAT: poseEat(z, p); break;
    case ZANIM.RISE: poseRise(z, p); break;
    default: if (z.sub === 1) poseMenace(z, p); else poseIdle(z, p); break;
  }
  poseExtras(z, p);
  const jh = z.A ? z.A.jawHang : 0; // survivor zombie-mode state has no per-variant extras
  if (jh) A(p, JAW, -jh, 0, z.tilt * jh * 0.35); // dislocated jaw hangs open and askew
  const alive = z.state !== ZANIM.DEAD;
  if (alive && z.voxT < VOX[z.voxKind]?.dur) poseVocal(z, p);
  if (alive && z.state !== ZANIM.STAGGER && z.flinchT < 0.6) poseFlinch(z, p);
  if (z.legs === 3) return; // prone: poseCrawl has put the head where the server's hitbox has it
  if (z.legs && alive) oneLegged(z, p);
  if (z.gazeW > 0.01) applyGaze(z, p);
  if (z.state !== ZANIM.DEAD && z.state !== ZANIM.EAT) {
    // keep the head over the object origin (server head hitbox is centered on the entity axis)
    p[z.nb * 4 + 2] -= headForward(z, p);
  }
  if (z.gOn) solveLegs(z, p);
  else if (z.standOn && z.wScale) plantStatic(z, p);
}

/** 2D forward kinematics of the spine chain: head-center Z offset relative to the hips. */
function headForward(z, p) {
  const P = z.P;
  let th = p[HIPS * 4];
  let zz = Math.sin(th) * P.spineLen;
  th += p[SPINE * 4];
  zz += Math.sin(th) * P.chestLen;
  th += p[CHEST * 4];
  zz += Math.sin(th) * P.neckOff + Math.cos(th) * P.neckZ;
  th += p[NECK * 4];
  zz += Math.sin(th) * P.neckLen + Math.cos(th) * (P.headZ - P.neckZ);
  th += p[HEAD * 4];
  zz += Math.sin(th) * P.headR * 0.9;
  return zz;
}

function poseExtras(z, p) {
  const t = z.time + z.off;
  const X = z.X;
  const dead = z.state === ZANIM.DEAD;
  if (X.sac !== undefined) {
    const s = 1 + (dead ? -0.2 : 0.06 * Math.sin(t * 3.1) + z.sacPulse);
    p[X.sac * 4 + 3] = s;
  }
  if (X.belly !== undefined) {
    const idle = z.state === ZANIM.IDLE || z.state === ZANIM.SPECIAL;
    const s = 1 + (dead ? 0 : (idle ? 0.05 : 0.025) * Math.sin(t * (z.state === ZANIM.SPECIAL ? 9 : 2.6)) + z.bellyPulse * Math.max(0, Math.sin(t * 9)));
    p[X.belly * 4 + 3] = s;
  }
  if (X.abdomen !== undefined) {
    const walk = z.state === ZANIM.WALK || z.state === ZANIM.RUN;
    R(p, X.abdomen, 0.1 + (walk ? 0.06 * Math.sin(z.phase * 2) : 0.03 * Math.sin(t)), walk ? 0.08 * Math.sin(z.phase) : 0, 0);
    p[X.abdomen * 4 + 3] = 1 + 0.03 * Math.sin(t * 2.2) + z.abdPulse;
  }
  if (X.sleg0 !== undefined) {
    // spider legs: gait synced with phase, alternate pairs
    const walk = z.state === ZANIM.WALK || z.state === ZANIM.RUN || z.speed > 0.3;
    for (let i = 0; i < 4; i++) {
      const s = i % 2 ? 1 : -1;
      const ph = z.phase + (i === 0 || i === 3 ? 0 : PI) + i * 0.3;
      const lift = walk ? Math.max(0, Math.sin(ph)) * 0.35 : 0.05 * Math.sin(t * 1.5 + i);
      const swing = walk ? Math.cos(ph) * 0.35 : 0;
      const u = X['sleg' + i], l = X['slegb' + i];
      R(p, u, -chestPitch(p) * 0.8 + swing * 0.3 - lift * 0.2, swing, s * lift);
      R(p, l, lift * 0.6, 0, -s * lift * 0.5);
      if (dead) R(p, u, 0.6, 0, -s * 0.8);
    }
  }
  if (X.xarmL !== undefined) {
    for (let side = 0; side < 2; side++) {
      const u = side ? X.xarmR : X.xarmL, f = side ? X.xfarmR : X.xfarmL;
      const tw = n1(t * 1.3, z.seed + side * 5);
      R(p, u, 0.9 + 0.35 * tw - chestPitch(p), 0, (side ? 1 : -1) * (0.35 + 0.2 * n1(t * 0.9, side)));
      R(p, f, 0.9 + 0.5 * n1(t * 1.7, z.seed + side), 0, 0);
    }
  }
}

// ------------------------------------------------------------------ bat animation
function poseBat(z) {
  const p = z.pose;
  clearPose(p, z.nb);
  const t = z.time + z.off;
  const X = z.X;
  const st = z.state;
  const dead = st === ZANIM.DEAD;
  const dive = st === ZANIM.ATTACK;
  const f = 7 + clamp(z.speed, 0, 10) * 0.5;
  const ph = z.flapPh;
  const s = Math.sin(ph), c = Math.cos(ph);
  if (dead) {
    const k = smooth(z.stateT / 0.5);
    // down on the ground (land): over onto its back, the head thrown back so the ears lie flat, the elbows on the
    // ground and the hands up off it, the body the lowest of it (BAT_REST, entities.js)
    const g = z.landT < 0 ? 0 : smooth(z.landT / 0.15);
    R(p, X.body, 0.3 * k, 0, lerp(2.6 * k, PI, g) * (z.seed & 1 ? 1 : -1));
    R(p, X.head, -0.9 * g, 0, 0);
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      R(p, side ? X.w1R : X.w1L, 0, 0, sg * lerp(0.2 + 0.4 * k, 0.25, g));
      R(p, side ? X.w2R : X.w2L, 0, sg * 1.2 * k, 0);
      R(p, side ? X.w3R : X.w3L, 0, sg * 1.0 * k, 0);
    }
    p[z.nb * 4 + 1] = 0;
    return f;
  }
  const bob = dive ? 0 : -s * 0.035;
  p[z.nb * 4 + 1] = bob;
  R(p, X.body, dive ? -0.7 : -0.1 + 0.08 * c + (st === ZANIM.STAGGER ? 0.5 * Math.exp(-z.stateT * 5) : 0), 0, 0.05 * Math.sin(t * 1.3));
  R(p, X.head, dive ? 0.5 : 0.1 - 0.08 * c + 0.15 * n1(t * 1.5, z.seed), n1(t, z.seed) * 0.3, 0);
  R(p, X.jaw, dive ? -0.6 : -0.15 - 0.15 * Math.max(0, Math.sin(t * 5)), 0, 0);
  for (let side = 0; side < 2; side++) {
    const sg = side ? 1 : -1;
    const w1 = side ? X.w1R : X.w1L, w2 = side ? X.w2R : X.w2L, w3 = side ? X.w3R : X.w3L;
    if (dive) {
      // wings swept back
      const tr = Math.sin(t * 30) * 0.05;
      R(p, w1, 0, sg * -0.9, sg * (0.25 + tr));
      R(p, w2, 0, sg * -1.3, 0);
      R(p, w3, 0, sg * -0.6, sg * 0.1);
    } else {
      const flap = s * 0.95 + 0.1;
      const fold = Math.max(0, -c) * 0.5; // fold on the upstroke
      R(p, w1, 0.1 * c, sg * -fold * 0.4, sg * flap);
      R(p, w2, 0, sg * -fold * 0.9, sg * Math.sin(ph - 0.5) * 0.4);
      R(p, w3, 0, sg * -fold * 0.7, sg * Math.sin(ph - 1.0) * 0.35);
    }
  }
  return f;
}

// ------------------------------------------------------------------ calibration (head height)
const calib = new Map();
const _hv = new THREE.Vector3();
function calibrate(type, rig) {
  let c = calib.get(type);
  if (c) return c;
  const def = ZOMBIE_DEFS[type];
  if (type === ZTYPE.BAT) {
    c = { k: 1, dz: 0 };
    calib.set(type, c);
    return c;
  }
  const inst = new ZombieInstance(type, 12345, rig, { k: 1, dz: 0 });
  inst.body.scale.set(1, 1, 1);
  let sumY = 0, sumZ = 0;
  const N = 8;
  // calibrate on each type's dominant locomotion state
  const states = type === ZTYPE.RUNNER || type === ZTYPE.LEAPER || type === ZTYPE.SHADE ? [ZANIM.RUN, ZANIM.RUN] : [ZANIM.WALK, ZANIM.IDLE];
  for (let i = 0; i < N; i++) {
    inst.state = states[i & 1];
    inst.time = 0;
    inst.off = 0;
    inst.phase = (i / N) * TAU;
    inst.speed = def.speed;
    inst.tilt = 0;
    poseHumanoid(inst);
    inst.applyPose(inst.pose, true);
    inst.object.updateMatrixWorld(true);
    inst.anchorWorld(inst.headCenter, _hv);
    sumY += _hv.y;
    sumZ += _hv.z;
  }
  const hy = sumY / N, hz = sumZ / N;
  c = { k: def.headY / hy, dz: 0, hz };
  inst.dispose();
  calib.set(type, c);
  return c;
}

// ------------------------------------------------------------------ zombie instance

class ZombieInstance {
  constructor(type, seed, rig, cal) {
    this.type = type;
    this.def = ZOMBIE_DEFS[type];
    this.seed = seed >>> 0;
    this.rig = rig;
    this.P = rig.P;
    this.A = rig.A;
    this.st = ZS[type] || ZS[ZTYPE.WALKER];
    this.isBat = type === ZTYPE.BAT;
    this.landT = -1; // s since a dead bat hit the ground (land), -1 while it is still in the air
    const rnd = mulberry32(this.seed * 2654435761 + type);
    this.off = rnd() * 100;
    this.rate = 0.9 + rnd() * 0.2;
    this.limpSide = rnd() < 0.5 ? 0 : 1;
    this.armSide = rnd() < 0.5 ? 0 : 1;
    this.deadDir = rnd() < 0.5 ? 1 : -1;
    this.tilt = rnd() < 0.5 ? -1 : 1;
    this.cal = cal;
    const inst = instantiateRig(rig, getCharacterMaterial(), rig.sphere.radius * 1.6 + 0.4, true);
    this.mesh = inst.mesh;
    this.bones = inst.bones;
    this.skeleton = inst.skeleton;
    this.fx = inst.fx;
    this.boneRoot = inst.root;
    this.nb = this.bones.length;
    this.X = {};
    for (const [name, idx] of rig.names) this.X[name] = idx;
    this.pose = new Float32Array(this.nb * 4 + 3);
    this.snap = new Float32Array(this.nb * 4 + 3);
    this.out = new Float32Array(this.nb * 4 + 3);
    this.applied = new Float32Array(this.nb * 4 + 3);
    // Bone matrices come from a flat forward-kinematics pass over the pose array (see _solve) instead of
    // the Bone objects: the rig is rigid, bones are stored parents-first and bind poses are pure
    // translations. The Bone objects only carry the anchors (headCenter, mouth) and size the skeleton.
    const nb = this.nb;
    this.parent = new Int16Array(nb);
    this.bindPos = new Float64Array(nb * 3);
    this.localPos = new Float64Array(nb * 3);
    for (let i = 0; i < nb; i++) {
      const d = rig.bones[i];
      this.parent[i] = d.parent;
      this.bindPos.set(d.pos, i * 3);
      this.localPos[i * 3] = d.local.x;
      this.localPos[i * 3 + 1] = d.local.y;
      this.localPos[i * 3 + 2] = d.local.z;
    }
    this.world = new Float64Array(nb * 12); // per bone: 3x3 rotation*scale (column-major) + translation
    // bones scaled away to nothing: a head shot off (setHeadless), a shin and foot (setLegs) - or the stump under
    // each thigh, for as long as the shin is still there
    this.gone = new Uint8Array(nb);
    this.legs = 0;
    if (this.X.stumpL !== undefined) this.gone[this.X.stumpL] = this.gone[this.X.stumpR] = 1;
    // The renderer calls skeleton.update() for every drawn skinned mesh every frame, which re-uploads the
    // bone texture. The bones are mesh-local (detached rig), so only a new pose or fx value changes them:
    // solve + upload then, and only for zombies that are actually drawn.
    this.poseDirty = true;
    this.fxDirty = true;
    const skeleton = this.skeleton;
    skeleton.update = () => {
      let changed = false;
      if (this.poseDirty) {
        this._solve();
        changed = true;
      }
      if (this.fxDirty) {
        skeleton.boneMatrices.set(this.fx.matrixWorld.elements, 0);
        this.fxDirty = false;
        changed = true;
      }
      if (changed && skeleton.boneTexture) skeleton.boneTexture.needsUpdate = true;
    };
    this.object = new THREE.Group();
    this.object.name = 'zombie';
    this.body = new THREE.Group();
    const sw = 1 + (rnd() - 0.5) * 0.12, sh = 1 + (rnd() - 0.5) * 0.05;
    this.baseScale = cal.k;
    this.gScale = cal.k * sw; // ground distance per rig unit (planted-foot strides)
    this.wScale = 0; // set once the instance is placed in the world (calibration poses in place)
    this.wx = this.wz = this.wyaw = 0;
    this.body.scale.set(cal.k * sw, cal.k * sh, cal.k * sw);
    this.body.add(this.mesh);
    this.object.add(this.body);
    this.state = ZANIM.IDLE;
    this.sub = 0;
    this.lastAttack = -1e9;
    this.gazeYaw = 0;
    this.gazePitch = 0;
    this.gazeW = 0;
    this.flinchT = 9;
    this.flinchSide = 1;
    this.voxT = 9;
    this.voxKind = 0;
    this.footfalls = 0; // gait touchdowns so far (footstep sounds land with the feet)
    this.posedAt = -1;
    this.stateT = 0;
    this.fadeT = 1;
    this.fadeDur = 0.2;
    this.phase = rnd() * TAU;
    this.flapPh = rnd() * TAU;
    this.time = 0;
    this.speed = 0;
    this.hit = 0;
    this.headless = false;
    this.sacPulse = 0;
    this.bellyPulse = 0;
    this.abdPulse = 0;
    this._seen = true;
    this.mesh.onBeforeRender = () => {
      this._seen = true;
    };
    // In a crowd (render/crowd.js: the game's scene) it is not drawn by its own mesh: it is a row of the crowd's bone
    // texture and an instance of its geometry's batch. The crowd asks for the bones of those it draws.
    this.member = {
      root: this.object,
      body: this.body,
      mesh: this.mesh,
      geometry: rig.geometry,
      crowd: null,
      row: 0,
      fresh: false,
      solve: (out, at, force) => {
        let changed = force;
        if (this.poseDirty) {
          this._solve();
          changed = true;
        }
        if (this.fxDirty) {
          skeleton.boneMatrices.set(this.fx.matrixWorld.elements, 0);
          this.fxDirty = false;
          changed = true;
        }
        if (changed) out.set(skeleton.boneMatrices, at);
        return changed;
      },
      seen: () => {
        this._seen = true;
      },
    };
    // head center marker (for calibration/debug) + mouth anchor
    const headBone = this.bones[this.X.head];
    this.headCenter = new THREE.Object3D();
    if (!this.isBat) this.headCenter.position.set(0, this.P.headR * 0.9, 0);
    headBone.add(this.headCenter);
    this.mouth = new THREE.Object3D();
    const jawBone = this.bones[this.X.jaw];
    if (this.isBat) this.mouth.position.set(0, 0, -0.06);
    else this.mouth.position.set(0, -this.P.headR * 0.35, -this.P.headR * 0.85);
    jawBone.add(this.mouth);
    this.object.userData.mouth = this.mouth;
    this.object.userData.head = this.headCenter;
    this.object.userData.ztype = type;
    // initial pose
    this.computePose();
    this.out.set(this.pose);
    this.applyPose(this.out, true);
  }

  computePose() {
    if (this.isBat) {
      poseBat(this);
    } else {
      poseHumanoid(this);
    }
  }

  applyPose(p, force = false) {
    const a = this.applied;
    if (!force) {
      // settled poses (corpses at rest) repeat exactly: keep the bones already uploaded
      let same = true;
      for (let i = 0, n = p.length; i < n; i++) {
        if (a[i] !== p[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    a.set(p);
    this.poseDirty = true;
  }

  /**
   * Forward kinematics of the applied pose: bone i's local transform is T(offset) * R(euler XYZ) * S(scale)
   * (the root's offset is the pose translation), world = parent world * local, and the skinning matrix
   * is world * T(-bind position). Writes skeleton.boneMatrices[16..] (bone 0 is the fx bone).
   */
  _solve() {
    this.poseDirty = false;
    const p = this.applied;
    const nb = this.nb;
    const W = this.world;
    const par = this.parent;
    const lp = this.localPos;
    const bp = this.bindPos;
    const bm = this.skeleton.boneMatrices;
    const gone = this.gone;
    for (let i = 1; i < nb; i++) {
      const k = i * 4;
      const cx = Math.cos(p[k]), sx = Math.sin(p[k]);
      const cy = Math.cos(p[k + 1]), sy = Math.sin(p[k + 1]);
      const cz = Math.cos(p[k + 2]), sz = Math.sin(p[k + 2]);
      const s = gone[i] ? 0.001 : p[k + 3];
      // local rotation * scale, column-major (same as Matrix4.makeRotationFromEuler, order XYZ)
      const l0 = cy * cz * s, l1 = (cx * sz + sx * cz * sy) * s, l2 = (sx * sz - cx * cz * sy) * s;
      const l3 = -cy * sz * s, l4 = (cx * cz - sx * sz * sy) * s, l5 = (sx * cz + cx * sz * sy) * s;
      const l6 = sy * s, l7 = -sx * cy * s, l8 = cx * cy * s;
      let tx, ty, tz;
      if (i === 1) {
        tx = p[nb * 4];
        ty = p[nb * 4 + 1];
        tz = p[nb * 4 + 2] + this.cal.dz;
      } else {
        tx = lp[i * 3];
        ty = lp[i * 3 + 1];
        tz = lp[i * 3 + 2];
      }
      const o = i * 12;
      const pi = par[i];
      if (pi <= 0) {
        W[o] = l0; W[o + 1] = l1; W[o + 2] = l2;
        W[o + 3] = l3; W[o + 4] = l4; W[o + 5] = l5;
        W[o + 6] = l6; W[o + 7] = l7; W[o + 8] = l8;
        W[o + 9] = tx; W[o + 10] = ty; W[o + 11] = tz;
      } else {
        const q = pi * 12;
        const a0 = W[q], a1 = W[q + 1], a2 = W[q + 2], a3 = W[q + 3], a4 = W[q + 4], a5 = W[q + 5], a6 = W[q + 6], a7 = W[q + 7], a8 = W[q + 8];
        W[o] = a0 * l0 + a3 * l1 + a6 * l2;
        W[o + 1] = a1 * l0 + a4 * l1 + a7 * l2;
        W[o + 2] = a2 * l0 + a5 * l1 + a8 * l2;
        W[o + 3] = a0 * l3 + a3 * l4 + a6 * l5;
        W[o + 4] = a1 * l3 + a4 * l4 + a7 * l5;
        W[o + 5] = a2 * l3 + a5 * l4 + a8 * l5;
        W[o + 6] = a0 * l6 + a3 * l7 + a6 * l8;
        W[o + 7] = a1 * l6 + a4 * l7 + a7 * l8;
        W[o + 8] = a2 * l6 + a5 * l7 + a8 * l8;
        W[o + 9] = a0 * tx + a3 * ty + a6 * tz + W[q + 9];
        W[o + 10] = a1 * tx + a4 * ty + a7 * tz + W[q + 10];
        W[o + 11] = a2 * tx + a5 * ty + a8 * tz + W[q + 11];
      }
      // skinning matrix = world * T(-bind)
      const bx = bp[i * 3], by = bp[i * 3 + 1], bz = bp[i * 3 + 2];
      const m = i * 16;
      bm[m] = W[o]; bm[m + 1] = W[o + 1]; bm[m + 2] = W[o + 2]; bm[m + 3] = 0;
      bm[m + 4] = W[o + 3]; bm[m + 5] = W[o + 4]; bm[m + 6] = W[o + 5]; bm[m + 7] = 0;
      bm[m + 8] = W[o + 6]; bm[m + 9] = W[o + 7]; bm[m + 10] = W[o + 8]; bm[m + 11] = 0;
      bm[m + 12] = W[o + 9] - (W[o] * bx + W[o + 3] * by + W[o + 6] * bz);
      bm[m + 13] = W[o + 10] - (W[o + 1] * bx + W[o + 4] * by + W[o + 7] * bz);
      bm[m + 14] = W[o + 11] - (W[o + 2] * bx + W[o + 5] * by + W[o + 8] * bz);
      bm[m + 15] = 1;
    }
  }

  /** World position of an anchor object parented to one of the bones (headCenter, mouth). */
  anchorWorld(anchor, out) {
    if (this.poseDirty) this._solve();
    const o = this.bones.indexOf(anchor.parent) * 12;
    const W = this.world;
    const { x, y, z } = anchor.position;
    out.set(W[o] * x + W[o + 3] * y + W[o + 6] * z + W[o + 9], W[o + 1] * x + W[o + 4] * y + W[o + 7] * z + W[o + 10], W[o + 2] * x + W[o + 5] * y + W[o + 8] * z + W[o + 11]);
    this.mesh.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.mesh.matrixWorld);
  }

  /** World position of a knee (0 the left, 1 the right): where the shin parts from the leg when it is shot off. */
  kneeWorld(side, out) {
    if (this.poseDirty) this._solve();
    const o = (side ? SHIN_R : SHIN_L) * 12, W = this.world;
    this.mesh.updateWorldMatrix(true, false);
    return out.set(W[o + 9], W[o + 10], W[o + 11]).applyMatrix4(this.mesh.matrixWorld);
  }

  update(dt, anim, speed, time, inView = false) {
    if (dt > 0.1) dt = 0.1;
    if (anim === ZANIM.FROZEN) return this.hold(dt, time);
    // client-side sub-state, with hysteresis so a noisy speed can't flicker it:
    // ATTACK: 0 braced / 1 walking / 2 running; IDLE: 1 = menacing (it just attacked, the prey is still close)
    // the server picks IDLE from the zombie's own velocity; when the crowd or a survivor shoves it along, walk
    if (anim === ZANIM.IDLE && !this.isBat && speed > (this.state === ZANIM.WALK ? 0.35 : 0.8)) anim = ZANIM.WALK;
    let sub = 0;
    if (anim === ZANIM.ATTACK && !this.isBat) {
      const m = this.state === ZANIM.ATTACK ? this.sub : 0;
      sub = speed > (m === 2 ? 2.6 : 3.2) ? 2 : speed > (m ? 0.25 : 0.6) ? 1 : 0;
      this.lastAttack = time;
    } else if (anim === ZANIM.IDLE && time - this.lastAttack < 2.5) sub = 1;
    if (anim !== this.state || sub !== this.sub) {
      this.snap.set(this.out);
      const thawed = this.state === ZANIM.FROZEN; // a shade the light let go of snaps back into motion
      if (anim !== this.state) this.stateT = 0; // a sub-state change keeps the attack's swing timing
      this.state = anim;
      this.sub = sub;
      this.fadeT = 0;
      this.fadeDur = anim === ZANIM.DEAD ? 0.12 : anim === ZANIM.STAGGER || anim === ZANIM.STUMBLE || thawed ? 0.1 : 0.25;
    }
    if (this.fell) {
      // its second leg has just gone from under it (setLegs): it goes down onto its front rather than snapping there
      this.fell = false;
      this.snap.set(this.out);
      this.fadeT = 0;
      this.fadeDur = 0.42;
    }
    this.stateT += dt;
    if (this.landT >= 0) this.landT += dt;
    this.fadeT += dt;
    this.flinchT += dt;
    this.voxT += dt;
    this.time = time;
    this.speed = speed;
    if (this.isBat) {
      this.flapPh += dt * (7 + clamp(speed, 0, 10) * 0.5) * this.rate * (this.state === ZANIM.ATTACK ? 0 : 1);
    } else if (anim !== ZANIM.DEAD) {
      const cyc = this.legs ? legCycleLen(this, speed) : gaitLen(this, anim === ZANIM.RUN || (anim === ZANIM.ATTACK && sub === 2), speed);
      this.phase += (dt * speed * TAU * this.rate) / cyc;
      if (this.phase > 1e4) this.phase -= TAU * 1000;
    }
    if (this.hit > 0) {
      this.hit = Math.max(0, this.hit - dt * 5);
    }
    let glow = 1;
    if (this.type === ZTYPE.SPITTER || this.type === ZTYPE.BOSS_HIVEQUEEN) glow = 0.8 + 0.25 * Math.sin(time * 3.1 + this.off);
    if (this.type === ZTYPE.BOSS_BLOATER) glow = 0.75 + 0.35 * Math.sin(time * 1.9 + this.off); // the pustules throb
    if (this.type === ZTYPE.SHADE) glow = 0.5 + 0.15 * Math.sin(time * 2.3 + this.off); // barely there while it stalks
    if (anim === ZANIM.DEAD) glow = Math.max(0.15, 1 - this.stateT * 0.6);
    if (setFx(this.fx, this.hit, glow)) this.fxDirty = true;
    // skip posing when culled (not rendered last frame, not in view now); crossfades still time out correctly
    const seen = this._seen;
    this._seen = false;
    if (!seen && !inView && this.fadeT > this.fadeDur) return;
    // world placement (the entity view sets it before update) for pinning planted feet and the gaze
    this.wx = this.object.position.x;
    this.wz = this.object.position.z;
    this.wyaw = this.object.rotation.y;
    if (!this.isBat && this.wScale) updateGaze(this, dt);
    if (this.rigFar && viewer.on) {
      // the far copy past LOD_FAR, the near one again inside LOD_NEAR (the gap keeps one on the line from flickering)
      const dx = this.wx - viewer.x, dz = this.wz - viewer.z, d2 = dx * dx + dz * dz;
      const far = d2 > (this.far ? LOD_NEAR * LOD_NEAR : LOD_FAR * LOD_FAR);
      if (far !== this.far) {
        this.far = far;
        this.mesh.geometry = this.member.geometry = far ? this.rigFar.geometry : this.rig.geometry;
      }
    }
    this.posedAt = time;
    this.computePose();
    const p = this.pose, o = this.out;
    if (this.fadeT < this.fadeDur) {
      const w = smooth(this.fadeT / this.fadeDur);
      const s = this.snap;
      for (let i = 0, n = o.length; i < n; i++) o[i] = s[i] + (p[i] - s[i]) * w;
    } else {
      o.set(p);
    }
    this.applyPose(o);
  }

  flash(a) {
    this.hit = Math.max(this.hit, clamp(a, 0, 1));
    if (setFx(this.fx, this.hit, 1)) this.fxDirty = true;
  }

  /**
   * Shade pinned by light (ZANIM.FROZEN): it holds the pose it was caught in, perfectly still, while the light under
   * its skin flares. Seen for the first time already frozen, it strikes a mid-stride pose to hold.
   */
  hold(dt, time) {
    if (this.state !== ZANIM.FROZEN) {
      if (this.posedAt < 0) {
        this.state = ZANIM.RUN;
        this.speed = this.def.speed;
        this.time = time;
        this.computePose();
        this.out.set(this.pose);
        this.applyPose(this.out);
      }
      this.state = ZANIM.FROZEN;
      this.sub = 0;
      this.stateT = 0;
      this.fadeT = this.fadeDur; // no crossfade: it stops dead
    }
    this.stateT += dt;
    this.flinchT += dt;
    this.voxT += dt;
    this.time = time;
    this.speed = 0;
    if (this.hit > 0) this.hit = Math.max(0, this.hit - dt * 5);
    if (setFx(this.fx, this.hit, 2.2 + 1.2 * Math.exp(-this.stateT * 5))) this.fxDirty = true;
  }

  /** Took a hit: flinch (a fresh hit restarts it, toward a random side). */
  hurt() {
    this.flinchT = 0;
    this.flinchSide = Math.random() < 0.5 ? -1 : 1;
  }

  /** Vocalizing (0 growl, 1 scream, 2 roar): the jaw and head move with the sound. */
  vocalize(kind) {
    this.voxKind = kind;
    this.voxT = 0;
  }

  /** Gait touchdowns so far, or -1 when this frame's pose had no planted-foot gait (culled, other states). */
  footfallCount() {
    // knuckle walk (tank): legCycle puts a foot down each half cycle, as its thigh reaches the front of the swing
    if (this.st.knuckle) return this.state === ZANIM.WALK || this.state === ZANIM.RUN ? Math.floor(this.phase / PI - 0.5) : -1;
    return (this.gOn || this.hopOn) && this.posedAt === this.time ? this.footfalls : -1;
  }

  setHeadless(v) {
    this.headless = !!v;
    if (!this.isBat) this.gone[this.X.head] = v ? 1 : 0;
    this.poseDirty = true;
  }

  /** A dead bat has hit the ground: it settles there on its back (poseBat). */
  land() {
    if (this.landT < 0) this.landT = 0;
  }

  /**
   * Legs shot off at the knee (bit 0 the left, bit 1 the right): the shin and foot go, the stump shows. On one leg it
   * hops, with neither it crawls (poseHobble, poseCrawl). fall: it has just happened, so it goes down over a moment.
   */
  setLegs(bits, fall = false) {
    bits &= 3;
    if (bits === this.legs || this.X.stumpL === undefined) return;
    if (bits === 3 && fall) this.fell = true;
    this.legs = bits;
    const g = this.gone;
    g[SHIN_L] = bits & 1;
    g[SHIN_R] = (bits >> 1) & 1;
    g[this.X.stumpL] = bits & 1 ? 0 : 1;
    g[this.X.stumpR] = bits & 2 ? 0 : 1;
    this.poseDirty = true;
  }

  dispose() {
    this.member.crowd?.remove(this.member);
    this.skeleton.dispose();
    if (this.object.parent) this.object.parent.remove(this.object);
  }
}

/** Number of cached model variants for a zombie type (the seed passed to createZombie picks one). */
export function zombieVariants(ztype) {
  return VARIANTS[ztype] || 1;
}

/**
 * Create a zombie of the given ZTYPE. seed picks the variant + per-instance randomness.
 */
export function createZombie(ztype, seed = 0) {
  if (ztype === ZTYPE.DOG) return createZombieDog(seed); // quadruped: its own rig + animation (dog.js)
  if (ztype === ZTYPE.BOSS_ALPHA) return createZombieDog(seed, true); // the pack's leader: a dog, built heavier and drawn bigger
  const type = BUILDERS[ztype] ? ztype : ZTYPE.WALKER;
  const nv = VARIANTS[type] || 1;
  const variant = nv > 1 ? ((seed >>> 0) * 2654435761 >>> 0) % nv : 0;
  const rig = getRig(type, variant);
  const cal = calibrate(type, getRig(type, 0));
  const z = new ZombieInstance(type, seed, rig, cal);
  z.rigFar = getRig(type, variant, true); // the copy it is drawn with from LOD_FAR away (null: none)
  z.wScale = z.gScale;
  return {
    object: z.object,
    update: (dt, anim, speed, time, inView) => z.update(dt, anim, speed, time, inView),
    flash: (a) => z.flash(a),
    hurt: () => z.hurt(),
    vocalize: (kind) => z.vocalize(kind),
    footfalls: () => z.footfallCount(),
    setHeadless: (v) => z.setHeadless(v),
    setLegs: (bits, fall) => z.setLegs(bits, fall),
    land: () => z.land(),
    kneeWorld: (side, out) => z.kneeWorld(side, out),
    shin: rig.shin === undefined ? null : { color: rig.shin, len: rig.P.shinLen * cal.k, thick: 0.06 * cal.k }, // the piece a shot-off leg leaves (Effects.gibLeg)
    anchorWorld: (a, out) => z.anchorWorld(a, out),
    dispose: () => z.dispose(),
    member: z.member, // (for a Crowd to draw it: render/crowd.js)
    _inst: z,
  };
}

/** Debug info for the sandbox: triangle counts + calibration per type/variant. */
export function modelStats() {
  const out = [];
  for (const t of Object.values(ZTYPE)) {
    if (!BUILDERS[t]) continue;
    const nv = VARIANTS[t] || 1;
    for (let v = 0; v < nv; v++) {
      const r = getRig(t, v);
      out.push({ type: t, variant: v, tris: r.tris, bones: r.bones.length, cal: calibrate(t, getRig(t, 0)) });
    }
  }
  out.push(...dogStats());
  for (let v = 0; v < SURVIVOR_LOOKS; v++) {
    out.push({ type: 'survivor', variant: v, tris: getSurvivorRig(v, false).tris });
    out.push({ type: 'survivor-z', variant: v, tris: getSurvivorRig(v, true).tris });
  }
  return out;
}

// ======================================================================= SURVIVOR
const SURVIVOR_LOOKS = CHARACTER_COUNT;

const survivorRigs = new Map();
// where the worn backpack's back panel sits on the default body (chest-bone z of the jacket's back at the pack's
// pivot): each character's pack is moved back or in by how far their own back is from this
const PACK_BACK = 0.118;
// how far the front of the default chest is (chest-bone y 0.1, in its clothes): the holds of solveArms were made on it
const HOLD_FRONT = 0.125;
function getSurvivorRig(v, zombie) {
  const key = v + (zombie ? 'z' : 'h');
  let r = survivorRigs.get(key);
  if (r) return r;
  const look = LOOKS[v % LOOKS.length];
  const L = zombie ? deadLook(look, v) : { ...look, fist: true };
  const P = humanP(frameOf(look));
  const mb = new MeshBuilder();
  addHumanoidBones(mb, P);
  mb.dirt = L.dirt || { y0: 0.32, k: 0.3 };
  const built = buildPerson(mb, P, L);
  r = mb.build();
  r.P = P;
  r.mouth = mouthAnchor(built.H);
  const back = surfPoint(built.T, PI, P.chestY + PACK_PIVOT[1], built.pT)[2];
  r.packDZ = back - PACK_BACK;
  // the worn pack's straps on this body: a point of a strap (chest-bone space, the pack at WORN_AT) that would be
  // inside the chest, the shoulder or the side is moved out onto the clothes there, a strap's thickness proud. The
  // pack itself sits packDZ back, so a point is fitted where it ends up and handed back from where it started.
  const T = built.T, pT = built.pT;
  // ...and whatever is held comes forward as far as this chest is deeper than the one the holds were made on
  r.holdDZ = Math.min(0, HOLD_FRONT + surfPoint(T, 0, P.chestY + 0.1, pT)[2]);
  const strapOut = pT + 0.009;
  r.strapFit = (x, y, z) => {
    const ym = y + P.chestY, zm = z + r.packDZ;
    if (zm > 0.05 || ym > T.yHi + 0.02) return [x, y, z]; // (the back panel's own end, and over the top: as made)
    const ring = T.ring(Math.min(ym, T.yHi));
    const t = Math.atan2(x, -(zm - ring.cz));
    const s = surfPoint(T, t, Math.min(ym, T.yHi), strapOut);
    const rs = Math.hypot(s[0], s[2] - ring.cz), rp = Math.hypot(x, zm - ring.cz);
    if (rp >= rs) return [x, y, z];
    const k = rs / (rp || 1);
    return [x * k, y, (zm - ring.cz) * k + ring.cz - r.packDZ];
  };
  survivorRigs.set(key, r);
  return r;
}

// weapon holding categories
const HOLD_NONE = 0, HOLD_RIFLE = 1, HOLD_PISTOL = 2, HOLD_MELEE = 3, HOLD_THROW = 4, HOLD_RADIO = 5;
// what the swimming pose (SurvivorInstance.poseSwim) moves, blended over the rest: torso, head, arms, legs
const SWIM_BONES = [HIPS, SPINE, CHEST, NECK, HEAD, UARM_L, UARM_L + 1, UARM_L + 2, UARM_R, UARM_R + 1, UARM_R + 2, THIGH_L, THIGH_L + 1, THIGH_L + 2, THIGH_R, THIGH_R + 1, THIGH_R + 2];
function holdFor(item) {
  if (!item) return HOLD_NONE;
  if (item === ITEM.WALKIE) return HOLD_RADIO;
  const w = WEAPONS[item];
  if (w && !w.melee) return w.slot === 1 ? HOLD_PISTOL : HOLD_RIFLE;
  if (item === ITEM.MOLOTOV || item === ITEM.PIPEBOMB || item === ITEM.GRENADE || item === ITEM.DECOY) return HOLD_THROW;
  if (w && w.melee) return HOLD_MELEE;
  return HOLD_THROW; // generic held item
}

// preallocated temps for survivor IK
const _S = new THREE.Vector3();
const _T = new THREE.Vector3();
const _T2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _qW = new THREE.Quaternion();
const _qH = new THREE.Quaternion();
const _qU = new THREE.Quaternion();
const _qL = new THREE.Quaternion();
const _qTmp = new THREE.Quaternion();
// weapon mount under the right hand: guns/throwables Rx(-90deg) (barrel along the forearm),
// melee identity (handle through the fist, blade out of the thumb side) - see weapons.js conventions
const _qMountInvGun = new THREE.Quaternion().setFromEuler(new THREE.Euler(HALF, 0, 0));
const _qMountInvMelee = new THREE.Quaternion();
const _e = new THREE.Euler();
const _grip = new THREE.Vector3();
const _lh = new THREE.Vector3();
const _off = new THREE.Vector3();
const _reachM = new THREE.Matrix4();
const REACH_FIST = 0.075; // the middle of a closed fist, out from the wrist
const MOUNT_POS = new THREE.Vector3(-0.025, -0.08, 0);
const MOUNT_POS_L = new THREE.Vector3(0.025, -0.08, 0); // (the left fist's, for what a left hand holds: nunchucks)
let STOCK_POCKET = -0.14; // (chest-bone space, z) where a shouldered butt ends: the front of the shoulder, in its clothes (the lofted bodies' shoulders are 4 cm further out than the old boxes': measured on four of them, scripts/clip/survey.js)
let RPG_LIFT = 0.14; // the RPG's grip raised so the tube clears the top of the shoulder instead of running through it
// the throwables' radius across the palm (m), and where the survivor's fist's palm face is (x, hand-bone space; less a
// few mm where the fingers wrap)
const THROW_RADIUS = { [ITEM.GRENADE]: 0.032, [ITEM.MOLOTOV]: 0.0335, [ITEM.PIPEBOMB]: 0.0245, [ITEM.FLARE]: 0.017, [ITEM.DECOY]: 0.044 };
const FIST_PALM_X = -0.025;
const PACK_PIVOT = [0, 0.1, 0.145]; // (chest-bone space) the top of the worn pack's back panel, under the straps
const PACK_HANG = [1, 0.5]; // how much of the chest's bend (and of the spine's, times the chest's share) the pack undoes
const _mountW = new THREE.Vector3();

// Talking (s.voice: how loud they are on voice chat, Voice.mouthLevel). The mouth pops open on each syllable and
// relaxes shut a little slower; through the short gaps between words it stays a dark slit, and it goes 0.4 s after
// the last one. Loudness is the RMS of the speaker's own stream: about 0.05-0.15 in speech, under 0.01 when silent.
const MOUTH_FLOOR = 0.02; // the level the mouth starts to open at...
const MOUTH_RANGE = 0.12; // ...and how much louder than that it is wide open
const MOUTH_TALK = 0.03; // louder than this is a word: the mouth shows (for MOUTH_HOLD s after)
const MOUTH_HOLD = 0.4;
const MOUTH_SLIT = 0.08; // the mouth between words, as a fraction of wide open
const MOUTH_JAW = 0.2; // the jaw drops this far (rad) wide open...
const MOUTH_NOD = 0.04; // ...and the head lifts this much
let _mouthGeo = null;
/** The inside of the mouth, on the head bone: a thin dark lens laid on the face under the nose (bent round it and
 *  leaning back with it), the tongue at its bottom. No teeth: a pale line along the top read as a grimace between
 *  words. Its top edge is at the origin, so scaling it in Y opens it downward; the jaw (which drops with it) covers
 *  its lower part. It sits on the lip line of the head (humans.js headPoint: rig.mouth), just behind the lips, the
 *  face there sloping back about 0.5 per unit down and curving back 0.95 x^2 / hr to the sides. */
function createMouth(rig) {
  const hr = rig.P.headR;
  if (!_mouthGeo) {
    const mb = new MeshBuilder({ skinned: false });
    const ry = hr * 0.13;
    mb.ellip(0, [0, -ry, 0], [hr * 0.25, ry, hr * 0.025], {
      ws: 14, hs: 6, color: 0x1e0907, region: CR.PLAIN, ao: false, blood: false, mottle: 0,
      shape(v) {
        v.z += (0.95 * v.x * v.x) / hr;
      },
      tint(p, n, c) {
        if (-p.y > ry * 1.4) c.lerp(color(0x5a1c1a), 0.8); // the tongue
      },
    });
    _mouthGeo = mb.build().geometry;
  }
  const m = new THREE.Mesh(_mouthGeo, getCharacterMaterial());
  m.name = 'mouth';
  const a = rig.mouth;
  m.position.set(0, a.y + hr * 0.035, a.z + hr * 0.035);
  m.rotation.x = -Math.atan(0.5);
  m.visible = false;
  return m;
}

class SurvivorInstance {
  constructor(seed, character = -1) {
    this.seed = seed >>> 0;
    this.look = character >= 0 && character < SURVIVOR_LOOKS ? character | 0 : this.seed % SURVIVOR_LOOKS;
    this.character = CHARACTERS[this.look];
    const rnd = mulberry32(this.seed * 7 + 3);
    this.rigH = getSurvivorRig(this.look, false);
    this.rigZ = null;
    this.P = this.rigH.P;
    const inst = instantiateRig(this.rigH, getCharacterMaterial(), 1.6);
    this.mesh = inst.mesh;
    this.bones = inst.bones;
    this.skeleton = inst.skeleton;
    this.fx = inst.fx;
    this.nb = this.bones.length;
    this.X = {};
    for (const [n, i] of this.rigH.names) this.X[n] = i;
    this.object = new THREE.Group();
    this.object.name = 'survivor';
    this.body = new THREE.Group();
    this.body.add(this.mesh);
    this.object.add(this.body);
    this.pose = new Float32Array(this.nb * 4 + 3);
    this.snap = new Float32Array(this.nb * 4 + 3);
    this.out = new Float32Array(this.nb * 4 + 3);
    this.zombie = false;
    this.item = 0;
    this.hold = HOLD_NONE;
    this.weapon = null;
    this.stockZ = 0;
    this.mount = new THREE.Object3D();
    this.mount.position.copy(MOUNT_POS);
    this.mount.rotation.set(-HALF, 0, 0);
    this.bones[HAND_R].add(this.mount);
    this.flashlightAnchor = new THREE.Object3D();
    this.flashlightAnchor.position.set(0.16, this.P.shoulderY - this.P.chestY + 0.02, -0.16);
    this.bones[CHEST].add(this.flashlightAnchor);
    // the crafted backpack on the back of the chest, where the shoulder straps sit: shown while one is worn (setBackpack)
    this.pack = createBackpack(true, this.rigH.strapFit);
    this.packDZ = this.rigH.packDZ || 0;
    this.holdDZ = this.rigH.holdDZ || 0; // (how far this body's back is from the default one's)
    this.pack.position.set(WORN_AT[0], WORN_AT[1], WORN_AT[2] + this.packDZ);
    this.pack.visible = false;
    this.bones[CHEST].add(this.pack);
    this.packOn = false;
    this.headCenter = new THREE.Object3D();
    this.headCenter.position.set(0, this.P.headR * 0.9, 0);
    this.bones[HEAD].add(this.headCenter);
    this.object.userData.head = this.headCenter;
    this.mouth = createMouth(this.rigH);
    this.bones[HEAD].add(this.mouth);
    this.mouthOpen = 0; // 0 shut .. 1 wide open (updateMouth)
    this.talkT = 0; // the mouth shows while this runs down: MOUTH_HOLD from the last word
    this.phase = rnd() * TAU;
    this.time = 0;
    this.off = rnd() * 50;
    this.hit = 0;
    this.stateKey = -1;
    this.stateT = 0;
    this.fadeT = 1;
    this.fadeDur = 0.2;
    this.pulseFire = 9;
    this.pulseMelee = 9;
    this.pulseThrow = 9;
    this.meleeSide = 0;
    this.deadT = 0;
    this.crouchW = 0;
    this.sitW = 0; // seated (a ride at the fair): thighs level, shins hanging
    this.airW = 0;
    this.runW = 0;
    this.reloadW = 0;
    this.swimW = 0; // afloat in the water (shared/swim.js)
    this.swimPh = 0; // ...and the stroke's clock
    this.talkW = 0; // on the air with the walkie-talkie (s.talk): raised to the mouth
    this.s = null;
    // zombie-mode animation shim (reuses humanoid zombie pose code)
    this.z = {
      type: ZTYPE.WALKER, def: ZOMBIE_DEFS[ZTYPE.WALKER], st: ZS[ZTYPE.RUNNER], P: this.P, nb: this.nb, pose: this.pose,
      X: this.X, seed: this.seed, off: this.off, rate: 1, limpSide: 0, armSide: 1, deadDir: this.seed & 1 ? 1 : -1, tilt: 1,
      state: ZANIM.IDLE, stateT: 0, time: 0, phase: 0, speed: 0, sacPulse: 0, bellyPulse: 0, abdPulse: 0,
    };
    this.deadDir = this.seed & 1 ? 1 : -1;
    this._seen = true;
    this.mesh.onBeforeRender = () => {
      this._seen = true;
    };
  }

  setWeapon(item) {
    item = item | 0;
    if (item === this.item && (this.weapon || !item)) return;
    this.item = item;
    this.hold = holdFor(item);
    if (this.weapon) {
      if (this.weapon.parent === this.mount) this.mount.remove(this.weapon);
      this.weapon = null;
    }
    this.mount.rotation.set(this.hold === HOLD_MELEE ? 0 : -HALF, 0, 0);
    // a throwable is wider than the fist: held against the palm, not through it
    this.mount.position.copy(MOUNT_POS);
    if (THROW_RADIUS[item]) this.mount.position.x = FIST_PALM_X - THROW_RADIUS[item];
    if (this.nk) this.nk.group.visible = false;
    if (item === ITEM.NUNCHAKU && !this.zombie) {
      // nunchucks: nothing rides in the fist as a fixed model. Both handles and the chain are the simulation's
      // (models/nunchaku.js), drawn in the chest's space, and both arms are solved to where it has the hands
      if (!this.nk) {
        this.nk = new NunchakuTP(getNunchakuGeo(false), getPropMaterial(), this.P);
        this.bones[CHEST].add(this.nk.group);
      }
      this.nk.group.visible = true;
      this.nk.core.draw();
      this.weapon = this.nk.group;
      this.muzzle = null;
      this.leftGrip = null;
      this.stockZ = 0;
      return;
    }
    if (item && !this.zombie) {
      const w = createWorldWeapon(item);
      if (w) {
        this.weapon = w;
        this.mount.add(w);
        this.muzzle = w.getObjectByName('muzzle') || null;
        this.leftGrip = w.userData && w.userData.leftHand ? w.userData.leftHand : null;
        // how far the butt reaches behind the grip (weapon space +Z)
        const wm = w.getObjectByName('weaponMesh');
        if (wm && !wm.geometry.boundingBox) wm.geometry.computeBoundingBox();
        this.stockZ = wm ? Math.max(0, wm.geometry.boundingBox.max.z) : 0;
      }
    }
  }

  // wearing the crafted backpack (PFLAG.BACKPACK). (The dead carry none)
  setBackpack(on) {
    this.packOn = !!on;
    this.pack.visible = this.packOn && !this.zombie;
  }

  setZombie(v) {
    v = !!v;
    if (v === this.zombie) return;
    this.zombie = v;
    this.pack.visible = this.packOn && !v;
    if (v && !this.rigZ) this.rigZ = getSurvivorRig(this.look, true);
    this.mesh.geometry = v ? this.rigZ.geometry : this.rigH.geometry;
    if (this.weapon) this.weapon.visible = !v;
    if (!v && this.item && !this.weapon) this.setWeapon(this.item);
    this.z.state = -1;
  }

  fire() {
    this.pulseFire = 0;
  }
  melee() {
    this.pulseMelee = 0;
    this.meleeSide ^= 1;
    // (nunchucks: which move is not on the wire; the rig works it out the way the rules do)
    if (this.nk && this.item === ITEM.NUNCHAKU && !this.zombie) this.nk.swing(-1, this.s || {});
  }
  /** Nunchucks: a move begins, named (ours); a blow of it landed. */
  nkSwing(move) {
    if (this.nk && this.item === ITEM.NUNCHAKU) this.nk.swing(move, this.s || {});
  }
  nkHit(kind, power = 1) {
    if (this.nk && this.item === ITEM.NUNCHAKU) this.nk.core.hit(kind, 0, 0.1, 1, power);
  }
  throwAnim() {
    this.pulseThrow = 0;
  }
  flash(a) {
    this.hit = Math.max(this.hit, clamp(a, 0, 1));
    setFx(this.fx, this.hit, 1);
  }

  getMuzzleWorld(out) {
    if (this.weapon && this.muzzle && this.weapon.visible) return this.muzzle.getWorldPosition(out);
    return this.bones[HAND_R].getWorldPosition(out);
  }

  update(dt, s) {
    if (dt > 0.1) dt = 0.1;
    this.s = s;
    this._dt = dt;
    const time = s.time ?? this.time + dt;
    this.time = time;
    this.pulseFire += dt;
    this.pulseMelee += dt;
    this.pulseThrow += dt;
    if (this.hit > 0) this.hit = Math.max(0, this.hit - dt * 5);
    setFx(this.fx, this.hit, 1);
    const speed = s.speed || 0;
    // state key for crossfades (major pose changes only)
    const key = s.dead ? 3 : this.zombie ? 2 : 1;
    if (key !== this.stateKey) {
      this.captureSnap();
      this.stateKey = key;
      this.stateT = 0;
      this.fadeT = 0;
      this.fadeDur = s.dead ? 0.1 : 0.25;
    }
    this.stateT += dt;
    this.fadeT += dt;
    const k = 1 - Math.exp(-dt * 10);
    this.crouchW += ((s.crouch && !s.sit ? 1 : 0) - this.crouchW) * k;
    // (s.sitNow: how far into the seat they are, said outright - a vehicle's seat, where the body is moved in from
    // beside it as it folds: game/vehicles.js)
    if (s.sitNow !== undefined) this.sitW = s.sit ? s.sitNow : 0;
    else this.sitW += ((s.sit ? 1 : 0) - this.sitW) * k;
    this.airW += ((s.onGround === false ? 1 : 0) - this.airW) * (1 - Math.exp(-dt * 12));
    this.runW += ((s.sprint && speed > 4 ? 1 : 0) - this.runW) * k;
    this.reloadW += ((s.reloading ? 1 : 0) - this.reloadW) * k;
    this.swimW += ((s.swim ? 1 : 0) - this.swimW) * (1 - Math.exp(-dt * 5));
    this.swimPh += dt * (1.8 + 1.6 * clamp(speed / 2, 0, 1));
    this.talkW += ((s.talk ? 1 : 0) - this.talkW) * k;
    // talking on voice chat: nothing to do for anyone who is not (zombies and the dead are out of it)
    const voice = this.zombie || s.dead ? 0 : s.voice || 0;
    if (voice > 0 || this.talkT > 0) this.updateMouth(dt, voice);
    const z = this.z;
    let cyc = lerp(lerp(1.7, 2.5, clamp(speed / 7, 0, 1)), 1.1, this.crouchW);
    if (this.zombie) {
      z.st = ZS[ZTYPE.RUNNER];
      cyc = gaitLen(z, speed > 3, speed); // the runner gait plants its feet against this stride
    }
    this.phase += (dt * speed * TAU) / cyc;
    // zombie-mode / death state machine (advances even when culled)
    if (this.zombie || s.dead) {
      const anim = s.dead ? ZANIM.DEAD : s.onGround === false ? ZANIM.AIRBORNE : this.pulseMelee < 0.5 ? ZANIM.ATTACK : speed > 3 ? ZANIM.RUN : speed > 0.3 ? ZANIM.WALK : ZANIM.IDLE;
      if (anim !== z.state) {
        if (z.state >= 0 && this.fadeT > 0) {
          // crossfade between zombie-mode states too
          this.captureSnap();
          this.fadeT = 0;
          this.fadeDur = anim === ZANIM.DEAD ? 0.12 : 0.2;
        }
        z.state = anim;
        z.stateT = 0;
      }
      z.stateT += dt;
    }
    const seen = this._seen;
    this._seen = false;
    if (!seen && this.fadeT > this.fadeDur) return;

    const p = this.pose;
    let ik = false;
    if (this.zombie || s.dead) {
      const anim = z.state;
      z.time = time;
      z.speed = speed;
      z.phase = this.phase;
      z.st = this.zombie ? ZS[ZTYPE.RUNNER] : SURV_STYLE;
      z.deadDir = this.deadDir;
      poseHumanoid(z);
      if (anim === ZANIM.ATTACK && this.zombie) {
        const u = clamp(this.pulseMelee / 0.45, 0, 1);
        const sw = Math.sin(u * PI);
        arm(p, this.meleeSide, 1.2 + 0.9 * sw, 0.5 - 0.9 * sw, 0.2, 0.3, 0.4);
      }
    } else {
      this.poseHuman(p, s, speed, time);
      if (s.sitLean && this.sitW > 0) {
        // over the bars: the trunk forward, the head still up
        const l = s.sitLean * this.sitW;
        p[SPINE * 4] -= l * 0.5;
        p[CHEST * 4] -= l * 0.5;
        p[NECK * 4] += l * 0.45;
        p[HEAD * 4] += l * 0.35;
      }
      if (s.sitTwist && this.sitW > 0) {
        // carried, and aiming out of the side: the trunk comes round to it
        const t = s.sitTwist * this.sitW;
        p[SPINE * 4 + 1] += t * 0.4;
        p[CHEST * 4 + 1] += t * 0.45;
        p[HEAD * 4 + 1] += t * 0.15;
      }
      ik = this.hold !== HOLD_NONE;
    }
    const o = this.out;
    if (this.fadeT < this.fadeDur) {
      const w = smooth(this.fadeT / this.fadeDur);
      const sn = this.snap;
      for (let i = 0, n = o.length; i < n; i++) o[i] = sn[i] + (p[i] - sn[i]) * w;
    } else o.set(p);
    this.applyPose(o);
    if (ik) this.solveArms(s, time);
    if (s.reach && !this.zombie && !s.dead) this.solveReach(s.reach);
    if (s.feet && !this.zombie && !s.dead && this.sitW > 0.02) this.solveFeet(s.feet, this.sitW);
    if (this.hide) {
      // seen from our own eyes (in a vehicle's seat): no head in the way, and no arms where the view's own are
      this.bones[HEAD].scale.setScalar(0.001);
      if (this.hide > 1) {
        this.bones[UARM_L].scale.setScalar(0.001);
        this.bones[UARM_R].scale.setScalar(0.001);
      }
    }
    if (this.packOn) this.hangPack();
    // flashlight follows the full aim pitch (chest only carries part of it)
    const fl = this.flashlightAnchor;
    if (this.zombie || s.dead) fl.rotation.set(0, 0, 0);
    else fl.rotation.set(clamp(s.pitch || 0, -1.4, 1.4) - (o[HIPS * 4] + o[SPINE * 4] + o[CHEST * 4]), 0, 0);
  }

  /** Voice chat loudness to the mouth (see MOUTH_*): called while they talk and through the hold after. */
  updateMouth(dt, voice) {
    const want = clamp((voice - MOUTH_FLOOR) / MOUTH_RANGE, 0, 1);
    this.mouthOpen += (want - this.mouthOpen) * Math.min(1, dt * (want > this.mouthOpen ? 35 : 15));
    if (voice > MOUTH_TALK) this.talkT = MOUTH_HOLD;
    else this.talkT = Math.max(0, this.talkT - dt);
    if (this.zombie || this.s.dead) this.talkT = 0; // (shut at once, not after the hold)
    const on = this.talkT > 0;
    if (!on) this.mouthOpen = 0;
    this.mouth.visible = on;
    if (on) this.mouth.scale.set(1 - 0.2 * this.mouthOpen, MOUTH_SLIT + (1 - MOUTH_SLIT) * this.mouthOpen, 1);
  }

  /**
   * The worn pack hangs from its shoulder straps: it is on the chest bone, but its bottom sits at the small of the back,
   * where the chest's own bend doesn't reach. Turned with the chest, a look up or down (and the downed sprawl) swung
   * the bottom into the lower back by up to 15 cm, so it is turned back by PACK_HANG of the chest's and the spine's
   * bend, about the top of its back panel.
   */
  hangPack() {
    const b = this.bones;
    const a = -Math.max(0, b[CHEST].rotation.x + b[SPINE].rotation.x * PACK_HANG[1]) * PACK_HANG[0]; // (a lean forward takes the back with it)
    const c = Math.cos(a), sn = Math.sin(a);
    const dy = WORN_AT[1] - PACK_PIVOT[1], dz = WORN_AT[2] - PACK_PIVOT[2];
    this.pack.position.set(WORN_AT[0], PACK_PIVOT[1] + dy * c - dz * sn, PACK_PIVOT[2] + this.packDZ + dy * sn + dz * c);
    this.pack.rotation.x = a;
  }

  /** Snapshot the CURRENT bone pose (including IK-driven arms) for crossfading. */
  captureSnap() {
    const b = this.bones, sn = this.snap, nb = this.nb;
    for (let i = 1; i < nb; i++) {
      const k = i * 4, r = b[i].rotation;
      sn[k] = r.x;
      sn[k + 1] = r.y;
      sn[k + 2] = r.z;
      sn[k + 3] = b[i].scale.x;
    }
    sn[nb * 4] = b[1].position.x;
    sn[nb * 4 + 1] = b[1].position.y;
    sn[nb * 4 + 2] = b[1].position.z;
  }

  applyPose(p) {
    const b = this.bones;
    const nb = this.nb;
    for (let i = 1; i < nb; i++) {
      const k = i * 4;
      b[i].rotation.set(p[k], p[k + 1], p[k + 2]);
      const sc = p[k + 3];
      b[i].scale.set(sc, sc, sc);
    }
    b[1].position.set(p[nb * 4], p[nb * 4 + 1], p[nb * 4 + 2]);
  }

  /** Human locomotion + torso aim (arms solved by IK afterwards). */
  poseHuman(p, s, speed, time) {
    clearPose(p, this.nb);
    const z = this.z;
    z.phase = this.phase;
    const ph = this.phase;
    const mv = clamp(speed / 1.2, 0, 1);
    const run = this.runW;
    const cr = this.crouchW;
    const air = this.airW;
    const t = time + this.off;
    // legs
    const amp = mv * lerp(lerp(0.45, 0.75, run), 0.4, cr);
    const knee = mv * lerp(lerp(0.75, 1.3, run), 0.6, cr);
    const sit = this.sitW;
    // (seated: thighs level and shins hanging, unless the seat says how its legs go - s.sitT / sitK / sitSplay: the
    // thigh's and the knee's angles and how far the knees are apart, in a car or on a saddle: game/vehicles.js)
    const baseT = lerp(cr * 0.95, s.sitT ?? 1.5, sit);
    const baseK = lerp(0.06 + cr * 1.5, s.sitK ?? 1.45, sit);
    // nunchucks: the trunk and the legs go with the move (the rig's body track: twist, lean, bend, knees, step)
    const nb = this.nk && this.item === ITEM.NUNCHAKU && !this.zombie ? this.nk.core.bodyS : null;
    const nkDrop = nb ? clamp(nb[4] / 0.3, 0, 0.6) * (1 - cr) : 0;
    // (s.pedal: on a bicycle the legs go round with its cranks - their angle)
    const ped = s.pedal !== undefined && sit > 0.5;
    legCycle(z, p, ped ? s.pedal : ph, ped ? 0.3 : amp * (1 - sit), ped ? 0.55 : knee * (1 - sit), baseT + nkDrop * 0.95, baseK + nkDrop * 1.5, 0, 0.03 + (s.sitSplay ?? 0.1) * sit);
    // air: tuck legs
    if (air > 0.01) {
      for (let side = 0; side < 2; side++) {
        const th = side ? THIGH_R : THIGH_L;
        p[th * 4] = lerp(p[th * 4], side ? 0.3 : 0.75, air);
        p[(th + 1) * 4] = lerp(p[(th + 1) * 4], side ? -0.5 : -1.0, air);
      }
      p[this.nb * 4 + 1] *= 1 - air;
    }
    const bob = mv * 0.025 * Math.cos(ph * 2);
    p[this.nb * 4 + 1] += -Math.abs(bob) * 0.5;
    // torso: lean with speed, aim pitch split spine/chest
    const pitch = clamp(s.pitch || 0, -1.4, 1.4);
    const lean = -0.08 * mv - 0.22 * run - 0.25 * cr;
    R(p, HIPS, 0, -0.1 * Math.sin(ph) * mv, 0);
    R(p, SPINE, lean * 0.6 + pitch * 0.25, 0.1 * Math.sin(ph) * mv * (1 - (this.hold ? 0.7 : 0)), 0);
    R(p, CHEST, lean * 0.4 + pitch * 0.3 + (1 - mv) * 0.012 * Math.sin(t * 1.6), 0.06 * Math.sin(ph) * mv * (this.hold ? 0.2 : 1), 0);
    if (nb) {
      // (a left-handed driver's move is the mirror: the twist, the bend and the step turn round)
      const sd = this.nk.core.side, tw = nb[1] * sd, ln = nb[2], bd = nb[3] * sd, st = nb[5] * sd * (1 - mv * 0.8) * (1 - sit);
      A(p, HIPS, -ln * 0.15, tw * 0.15, 0);
      A(p, SPINE, -ln * 0.45, tw * 0.4, -bd * 0.5);
      A(p, CHEST, -ln * 0.4, tw * 0.45, -bd * 0.5);
      // a step into it: the leading leg forward and bent, the other back and straighter
      const lead = st > 0 ? THIGH_R : THIGH_L, rear = st > 0 ? THIGH_L : THIGH_R, a = Math.abs(st);
      A(p, lead, 0.5 * a, 0, 0);
      A(p, lead + 1, -0.6 * a, 0, 0);
      A(p, lead + 2, 0.1 * a, 0, 0);
      A(p, rear, -0.42 * a, 0, 0);
      A(p, rear + 1, -0.12 * a, 0, 0);
      A(p, rear + 2, 0.5 * a, 0, 0);
      p[this.nb * 4 + 1] -= 0.035 * a;
    }
    // head: rest of the pitch
    const cp = chestPitch(p);
    R(p, NECK, (pitch - cp) * 0.4, nb ? -(p[SPINE * 4 + 1] + p[CHEST * 4 + 1] + p[HIPS * 4 + 1]) * 0.4 : 0, 0);
    R(p, HEAD, (pitch - cp) * 0.6, nb ? -(p[SPINE * 4 + 1] + p[CHEST * 4 + 1] + p[HIPS * 4 + 1]) * 0.5 : 0, 0);
    // arms (FK baseline; IK overrides for held items)
    const aSw = mv * lerp(0.35, 0.8, run) * Math.sin(ph);
    arm(p, 0, 0.05 - aSw, 0.1, 0, 0.25 + run * 1.0 + 0.1 * mv, 0);
    arm(p, 1, 0.05 + aSw, 0.1, 0, 0.25 + run * 1.0 + 0.1 * mv, 0);
    if (air > 0.01) {
      A(p, UARM_L, 0.4 * air, 0, -0.3 * air);
      A(p, UARM_R, 0.4 * air, 0, 0.3 * air);
    }
    // both hands out on the grips of a mounted gun (s.grips, from Entities while this survivor mans one)
    if (s.grips) {
      arm(p, 0, 1.15, 0.1, 0, 0.45, 0);
      arm(p, 1, 1.15, 0.1, 0, 0.45, 0);
    }
    // ...or carrying it off: upper arms down along the body, forearms out level under its weight (s.carry)
    else if (s.carry) {
      arm(p, 0, 0.45, 0.02, 0, 1.15, 0);
      arm(p, 1, 0.45, 0.02, 0, 1.15, 0);
    }
    // throw pulse without IK hold
    if (this.hold === HOLD_NONE && this.pulseMelee < 0.4) {
      const u = this.pulseMelee / 0.4;
      arm(p, 1, 1.4 * Math.sin(u * PI), 0.2, 0, 0.4, 0);
    }
    if (this.swimW > 0.01) this.poseSwim(p, s, speed);
    // talking: the jaw drops with the mouth and the head lifts a touch on each syllable
    if (this.mouthOpen > 0) {
      R(p, JAW, -MOUTH_JAW * this.mouthOpen, 0, 0);
      A(p, HEAD, MOUTH_NOD * this.mouthOpen, 0, 0);
    }
  }

  /** Afloat (shared/swim.js), blended over the rest by swimW: upright treading water, sculling at the surface, and
   *  leaning into a breaststroke on the move. Only the head and shoulders are out of the water: what shows of it is
   *  the arms sweeping out and in at the surface. Nothing is in the hands (Entities puts the weapon away). */
  poseSwim(p, s, speed) {
    const w = this.swimW;
    const sv = this._swimSave || (this._swimSave = new Float32Array(SWIM_BONES.length * 3 + 1));
    for (let i = 0; i < SWIM_BONES.length; i++) {
      const k = SWIM_BONES[i] * 4;
      sv[i * 3] = p[k];
      sv[i * 3 + 1] = p[k + 1];
      sv[i * 3 + 2] = p[k + 2];
    }
    sv[SWIM_BONES.length * 3] = p[this.nb * 4 + 1];
    const mv = clamp(speed / 2, 0, 1);
    const u = this.swimPh;
    const sn = Math.sin(u), cs = Math.cos(u);
    // legs: a slow frog kick under the water
    for (let side = 0; side < 2; side++) {
      const th = side ? THIGH_R : THIGH_L;
      const sg = side ? 1 : -1;
      R(p, th, 0.3 + 0.25 * sn * (0.5 + mv), 0, sg * (0.25 + 0.15 * cs));
      R(p, th + 1, -0.7 - 0.5 * Math.max(0, cs), 0, 0);
      R(p, th + 2, 0.6, 0, 0);
    }
    // torso: upright, leaning into the stroke as it goes; the head keeps the face out whatever they look at
    R(p, HIPS, 0, 0, 0);
    R(p, SPINE, 0.12 + 0.2 * mv + 0.04 * sn * mv, 0, 0);
    R(p, CHEST, 0.06 + 0.1 * mv, 0, 0.03 * Math.sin(u * 0.5) * (1 - mv));
    const cp = chestPitch(p);
    const look = clamp(s.pitch || 0, -0.5, 0.6) - cp;
    R(p, NECK, look * 0.4, 0, 0);
    R(p, HEAD, look * 0.6, 0, 0);
    // arms: treading, a sweep out and back at the sides; swimming, the breaststroke - reach, sweep out, elbows in
    for (let side = 0; side < 2; side++) {
      const pitch = lerp(0.95 + 0.1 * cs, 1.35 + 0.15 * cs - 0.3 * Math.max(0, -sn), mv);
      const abd = lerp(0.75 + 0.25 * sn, 0.15 + 0.3 * (1 - cs), mv);
      const elbow = lerp(1.0 + 0.25 * cs, 0.25 + 1.25 * Math.max(0, -sn), mv);
      arm(p, side, pitch, abd, lerp(0.2 * sn, 0, mv), elbow, 0);
    }
    // the water holds the hips up: no foot on the ground to bend down to
    p[this.nb * 4 + 1] = 0;
    if (w >= 0.999) return;
    for (let i = 0; i < SWIM_BONES.length; i++) {
      const k = SWIM_BONES[i] * 4;
      p[k] = sv[i * 3] + (p[k] - sv[i * 3]) * w;
      p[k + 1] = sv[i * 3 + 1] + (p[k + 1] - sv[i * 3 + 1]) * w;
      p[k + 2] = sv[i * 3 + 2] + (p[k + 2] - sv[i * 3 + 2]) * w;
    }
    p[this.nb * 4 + 1] = sv[SWIM_BONES.length * 3] * (1 - w);
  }

  /** Nunchucks: the rig's frame, and both arms to where it has the hands (chest space, as solveArms). */
  solveNunchaku(s) {
    const P = this.P, b = this.bones, nk = this.nk;
    b[CHEST].updateWorldMatrix(true, false);
    nk.update(this._dt || 0, s, b[CHEST]);
    const cy = P.shoulderY - P.chestY;
    for (const side of [1, -1]) {
      const h = side > 0 ? nk.core.right : nk.core.left;
      const U = side > 0 ? UARM_R : UARM_L, clav = b[side > 0 ? CLAV_R : CLAV_L].quaternion;
      // the hand's frame is its handle's; the wrist is the grip less the fist's own offset to it
      _qH.copy(h.q);
      _mountW.copy(side > 0 ? MOUNT_POS : MOUNT_POS_L).applyQuaternion(_qH);
      _T.copy(h.p).sub(_mountW);
      _S.set(P.shoulderW * side, cy, 0);
      ikTwoBone(_S, _T, P.uarmLen, P.farmLen, h.pole, _qU, _qL);
      _qTmp.copy(clav).invert().multiply(_qU);
      b[U].quaternion.copy(_qTmp);
      b[U + 1].quaternion.copy(_qL);
      _qTmp.copy(clav).multiply(b[U].quaternion).multiply(_qL).invert().multiply(_qH);
      b[U + 2].quaternion.copy(_qTmp);
    }
  }

  /** Two-bone IK for weapon holds, in chest space. */
  solveArms(s, time) {
    if (this.nk && this.item === ITEM.NUNCHAKU) return this.solveNunchaku(s);
    const P = this.P;
    const b = this.bones;
    const hold = this.hold;
    const pitch = clamp(s.pitch || 0, -1.4, 1.4);
    const cp = b[HIPS].rotation.x + b[SPINE].rotation.x + b[CHEST].rotation.x;
    const aimRel = pitch - cp; // weapon pitch relative to the chest
    const cy = P.shoulderY - P.chestY; // shoulder height in chest space
    const run = this.runW * (hold === HOLD_RIFLE || hold === HOLD_PISTOL ? 1 : 0.5);
    const rl = this.reloadW;
    // fire pulse
    const fu = this.pulseFire;
    const kick = fu < 0.25 ? Math.exp(-fu * 18) * (1 - Math.exp(-fu * 80)) : 0;
    // weapon orientation (chest space)
    let wx = aimRel, wy = 0, wz = 0;
    _grip.set(0, 0, 0);
    if (hold === HOLD_RIFLE) {
      // far enough forward that the butt ends at the front of the shoulder (STOCK_POCKET) instead of inside the arm
      if (this.item === ITEM.RPG) _grip.set(0.1, cy - 0.12 + RPG_LIFT, -0.24); // (its tube rides on top of the shoulder)
      else _grip.set(0.1, cy - 0.12, Math.min(-0.24, STOCK_POCKET - this.stockZ));
      if (run > 0.01) {
        // low-ready while sprinting
        wx = lerp(wx, -0.7, run);
        wy = lerp(0, 0.6, run);
        _grip.x += 0.03 * run;
        _grip.y -= 0.1 * run;
        _grip.z += 0.1 * run;
      }
      wx += rl * -0.35;
      wz += rl * 0.5;
      _grip.z += kick * 0.05;
      wx += kick * 0.12;
    } else if (hold === HOLD_PISTOL) {
      _grip.set(0.04, cy - 0.06, -0.44);
      if (run > 0.01) {
        wx = lerp(wx, -0.9, run);
        _grip.y -= 0.22 * run;
        _grip.z += 0.2 * run;
      }
      wx += rl * -0.5;
      _grip.z += kick * 0.06;
      wx += kick * 0.3;
    } else if (hold === HOLD_MELEE) {
      // ready stance: weapon raised over the right shoulder, pointing up/back
      _grip.set(0.2, cy - 0.2, -0.2);
      wx = 1.2;
      wy = -0.2;
      wz = -0.3;
      const mu = this.pulseMelee;
      if (mu < 0.5) {
        const u = mu / 0.5;
        const sw = u < 0.3 ? -smooth(u / 0.3) * 0.4 : -0.4 + smooth((u - 0.3) / 0.25) * 1.4 - smooth((u - 0.55) / 0.45);
        // big diagonal swing from right-high to left-low
        _grip.x = lerp(0.2, -0.15, clamp(sw, 0, 1));
        _grip.y = cy - 0.2 - 0.25 * clamp(sw, 0, 1) + 0.12 * clamp(-sw, 0, 1);
        _grip.z = -0.2 - 0.25 * Math.sin(clamp(sw, 0, 1) * PI);
        wx = lerp(1.2, 0.1, clamp(sw, 0, 1)) + 0.4 * clamp(-sw, 0, 1);
        wy = lerp(-0.2, 1.2, clamp(sw, 0, 1));
        wz = lerp(-0.3, -1.4, clamp(sw, 0, 1));
      }
    } else if (hold === HOLD_RADIO) {
      // the walkie-talkie upright in front of the chest, its face turned in; keyed, it comes up beside the mouth
      const tk = smooth(this.talkW);
      _grip.set(lerp(0.17, 0.08, tk), cy + lerp(-0.14, 0.1, tk), lerp(-0.22, -0.14, tk));
      wx = lerp(0.25, 0.1, tk);
      wy = lerp(0.4, 1.0, tk);
    } else if (hold === HOLD_THROW) {
      _grip.set(0.2, cy - 0.12, -0.2);
      wx = 0.4;
      const tu = this.pulseThrow;
      if (tu < 0.6) {
        const u = tu / 0.6;
        const wind = u < 0.4 ? smooth(u / 0.4) : 1 - smooth((u - 0.4) / 0.2);
        const rel = u < 0.4 ? 0 : u < 0.6 ? smooth((u - 0.4) / 0.2) : 1 - smooth((u - 0.6) / 0.4);
        _grip.y += 0.25 * wind - 0.05 * rel;
        _grip.z += 0.3 * wind - 0.35 * rel;
        wx += 1.2 * wind - 0.6 * rel;
      }
    }
    // gun melee (bash)
    if ((hold === HOLD_RIFLE || hold === HOLD_PISTOL) && this.pulseMelee < 0.4) {
      const u = Math.sin((this.pulseMelee / 0.4) * PI);
      _grip.z -= 0.18 * u;
      _grip.x -= 0.08 * u;
      wy += 0.5 * u;
    }
    _grip.z += this.holdDZ; // (a deeper chest: everything held comes out in front of it)
    _e.set(wx, wy, wz, 'YXZ');
    _qW.setFromEuler(_e);
    // hand orientation = weapon * mount^-1 ; wrist target = grip - Qh * mountPos
    _qH.copy(_qW).multiply(hold === HOLD_MELEE ? _qMountInvMelee : _qMountInvGun);
    _mountW.copy(this.mount.position).applyQuaternion(_qH);
    _T.copy(_grip).sub(_mountW);
    // right arm
    _S.set(P.shoulderW, cy, 0);
    _pole.set(0.7, -1, 0.35);
    ikTwoBone(_S, _T, P.uarmLen, P.farmLen, _pole, _qU, _qL);
    const clavR = b[CLAV_R].quaternion;
    _qTmp.copy(clavR).invert().multiply(_qU);
    b[UARM_R].quaternion.copy(_qTmp);
    b[FARM_R].quaternion.copy(_qL);
    // hand local = (clav * upper * lower)^-1 * Qh
    _qTmp.copy(clavR).multiply(b[UARM_R].quaternion).multiply(_qL).invert().multiply(_qH);
    b[HAND_R].quaternion.copy(_qTmp);
    // left arm: support grip on two-handed weapons
    let twoHand = false;
    if (hold === HOLD_RIFLE || hold === HOLD_PISTOL) {
      twoHand = true;
      if (this.leftGrip) _lh.copy(this.leftGrip);
      else if (hold === HOLD_RIFLE) _lh.set(0, -0.03, -0.3);
      else _lh.set(0, -0.05, 0.02);
      if (rl > 0.01) {
        // reach for the magazine / ammo
        _lh.lerp(_off.set(0, -0.12, -0.12), rl * (0.5 + 0.5 * Math.sin(time * 6)));
      }
      _lh.applyQuaternion(_qW).add(_grip);
      _T2.copy(_lh);
      // offset from palm to wrist for the left hand (palm faces up/right)
      _T2.x -= 0.03;
      _T2.y -= 0.05;
      _T2.z += 0.05;
    } else if (hold === HOLD_THROW && this.pulseThrow < 0.6) {
      twoHand = true;
      _T2.set(-0.1, cy - 0.15, -0.35);
    }
    if (twoHand) {
      _S.set(-P.shoulderW, cy, 0);
      _pole.set(-0.8, -1, 0.1);
      ikTwoBone(_S, _T2, P.uarmLen, P.farmLen, _pole, _qU, _qL);
      const clavL = b[CLAV_L].quaternion;
      _qTmp.copy(clavL).invert().multiply(_qU);
      b[UARM_L].quaternion.copy(_qTmp);
      b[FARM_L].quaternion.copy(_qL);
      // left hand: palm up under the handguard
      _e.set(wx + HALF * 0.9, wy, wz - 1.2, 'YXZ');
      _qH.setFromEuler(_e);
      _qTmp.copy(clavL).multiply(b[UARM_L].quaternion).multiply(_qL).invert().multiply(_qH);
      b[HAND_L].quaternion.copy(_qTmp);
    } else if (hold === HOLD_MELEE) {
      // guard: left fist up near the chest
      b[UARM_L].rotation.set(0.5 - b[SPINE].rotation.x - b[CHEST].rotation.x, 0, -0.25);
      b[FARM_L].rotation.set(1.6, 0, 0);
    }
  }

  // Both hands out to two points of the world (s.reach: { l, r }, Vector3s or null): the grips of a moped's bars,
  // the rim of a steering wheel. The wrist stops a fist short of the point, so that the fist closes on it.
  solveReach(reach) {
    const P = this.P;
    const b = this.bones;
    const chest = b[CHEST];
    chest.updateWorldMatrix(true, false);
    _reachM.copy(chest.matrixWorld).invert();
    const cy = P.shoulderY - P.chestY;
    for (const side of [1, -1]) {
      const t = side > 0 ? reach.r : reach.l;
      if (!t) continue;
      _T.copy(t).applyMatrix4(_reachM);
      _S.set(side * P.shoulderW, cy, 0);
      _pole.set(side * 0.7, -1, 0.45);
      // (the wrist stops a fist short of the point, back along the forearm: where the forearm lies is found by
      // solving for the point itself first, then twice for the wrist)
      _lh.copy(_T);
      for (let it = 0; it < 3; it++) {
        ikTwoBone(_S, _T, P.uarmLen, P.farmLen, _pole, _qU, _qL, _off);
        if (it === 2) break;
        _off.sub(_lh).normalize(); // from the point back towards the elbow
        _T.copy(_lh).addScaledVector(_off, REACH_FIST);
      }
      const clav = b[side > 0 ? CLAV_R : CLAV_L].quaternion;
      b[side > 0 ? UARM_R : UARM_L].quaternion.copy(_qTmp.copy(clav).invert().multiply(_qU));
      b[side > 0 ? FARM_R : FARM_L].quaternion.copy(_qL);
      b[side > 0 ? HAND_R : HAND_L].quaternion.identity();
    }
  }

  // Both feet to two points of the world (s.feet: { l, r, pitch }: where the ankles go - a pedal, a footboard, the
  // floor of a car; pitch: the toes down by this much), by weight w of the pose's own legs.
  solveFeet(feet, w = 1) {
    const P = this.P;
    const b = this.bones;
    for (const side of [1, -1]) {
      const t = side > 0 ? feet.r : feet.l;
      if (!t) continue;
      const th = b[side > 0 ? THIGH_R : THIGH_L];
      const sh = b[side > 0 ? SHIN_R : SHIN_L];
      const ft = b[side > 0 ? FOOT_R : FOOT_L];
      th.parent.updateWorldMatrix(true, false);
      _reachM.copy(th.parent.matrixWorld).invert();
      _T.copy(t).applyMatrix4(_reachM);
      _S.copy(th.position);
      _pole.set(side * (feet.splay ?? 0.22), 0.45, -1); // the knee: forward and up, a little out
      ikLeg(_S, _T, P.thighLen, P.shinLen, _pole, _qU, _qL);
      _qTmp.copy(_qU).multiply(_qL).invert(); // (the sole level with the hips)
      if (feet.pitch) _qTmp.multiply(_qFoot.setFromAxisAngle(_XAX, feet.pitch));
      if (w >= 1) {
        th.quaternion.copy(_qU);
        sh.quaternion.copy(_qL);
        ft.quaternion.copy(_qTmp);
      } else {
        th.quaternion.slerp(_qU, w);
        sh.quaternion.slerp(_qL, w);
        ft.quaternion.slerp(_qTmp, w);
      }
    }
  }

  dispose() {
    this.skeleton.dispose();
    if (this.object.parent) this.object.parent.remove(this.object);
  }
}

const _qFoot = new THREE.Quaternion();
const _XAX = new THREE.Vector3(1, 0, 0);
const _kld = new THREE.Vector3(), _klp = new THREE.Vector3(), _klu = new THREE.Vector3(), _kle = new THREE.Vector3(), _klf = new THREE.Vector3(), _klw = new THREE.Vector3(), _klh = new THREE.Vector3();
const _klbm = new THREE.Matrix4();
// Two-bone IK for a leg (skinning.js ikTwoBone is an arm's: its hinge bends the other way): the bones' bind direction
// is -Y, the knee's hinge local +X, and a NEGATIVE turn of the shin about it folds it back. All in the thigh's
// parent's space: S the hip joint, T where the ankle goes, pole the way the knee points.
function ikLeg(S, T, L1, L2, pole, qUpper, qLower) {
  _kld.subVectors(T, S);
  let dist = _kld.length();
  if (dist < 1e-5) _kld.set(0, -1, 0);
  _kld.normalize();
  dist = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-3, dist));
  _klp.copy(pole).addScaledVector(_kld, -pole.dot(_kld));
  if (_klp.lengthSq() < 1e-8) _klp.set(0, 0, -1).addScaledVector(_kld, _kld.z);
  _klp.normalize();
  const a = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))));
  _klu.copy(_kld).multiplyScalar(Math.cos(a)).addScaledVector(_klp, Math.sin(a)).normalize();
  _kle.copy(S).addScaledVector(_klu, L1);
  _klf.copy(S).addScaledVector(_kld, dist).sub(_kle).normalize();
  _klw.copy(_klf).addScaledVector(_klu, -_klf.dot(_klu));
  if (_klw.lengthSq() < 1e-8) _klw.copy(_klp).multiplyScalar(-1);
  _klw.normalize();
  _klh.crossVectors(_klu, _klw).normalize();
  // the thigh's basis: X = -h, Y = -u, Z = w (so that the shin, turned by -beta about X, lies along f)
  _klbm.makeBasis(_klh.negate(), _kle.copy(_klu).negate(), _klw);
  qUpper.setFromRotationMatrix(_klbm);
  qLower.setFromAxisAngle(_XAX, -Math.acos(Math.min(1, Math.max(-1, _klu.dot(_klf)))));
}

const SURV_STYLE = Object.assign({}, ZS[ZTYPE.WALKER], { idleLean: 0, walkLean: -0.05, runLean: -0.2, limp: 0, headTilt: 0, jaw: 0 });

/** Create a survivor (player avatar). */
export function createSurvivor(seed = 0, character = -1) {
  const sv = new SurvivorInstance(seed, character);
  return {
    object: sv.object,
    character: sv.character,
    update: (dt, s) => sv.update(dt, s),
    setWeapon: (id) => sv.setWeapon(id),
    fire: () => sv.fire(),
    melee: () => sv.melee(),
    nkSwing: (move) => sv.nkSwing(move),
    nkHit: (kind, power) => sv.nkHit(kind, power),
    nkFlourish: () => !!(sv.nk && sv.item === ITEM.NUNCHAKU && sv.nk.core.flourish()),
    nk: () => (sv.item === ITEM.NUNCHAKU ? sv.nk : null),
    throwAnim: () => sv.throwAnim(),
    setZombie: (v) => sv.setZombie(v),
    setBackpack: (on) => sv.setBackpack(on),
    setHide: (m) => (sv.hide = m), // 0: all of them; 1: no head; 2: no head, no arms (our own body under our own eyes)
    headWorld: (out) => sv.bones[HEAD].getWorldPosition(out),
    shoulderWorld: (side, out) => sv.bones[side > 0 ? UARM_R : UARM_L].getWorldPosition(out),
    getMuzzleWorld: (out) => sv.getMuzzleWorld(out),
    flashlightAnchor: sv.flashlightAnchor,
    flash: (a) => sv.flash(a),
    dispose: () => sv.dispose(),
    _inst: sv,
  };
}

export { SURVIVOR_LOOKS };
/** Debug (models sandbox): where a shouldered butt ends. */
export function setStockPocket(z, rpgLift = RPG_LIFT) {
  STOCK_POCKET = z;
  RPG_LIFT = rpgLift;
}
/** Builds a character's rigs (alive and turned) ahead of need: Game.warmViews. */
export function warmSurvivor(v) {
  getSurvivorRig(v, false);
  getSurvivorRig(v, true);
}

/** Debug (models sandbox, scripts): a type's rig for a variant, its near or far copy. */
export function debugRig(type, variant = 0, far = false) {
  return getRig(type, variant, far);
}
