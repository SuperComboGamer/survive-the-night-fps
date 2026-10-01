// Procedural zombie + survivor characters.
// Every character is ONE SkinnedMesh (one draw call) with rigid skinning. Geometry/material are shared
// per type+variant; each instance owns only its Skeleton + bones. Animation is fully procedural and
// writes bone rotations; state changes crossfade from a pose snapshot.
import * as THREE from 'three';
import { ZTYPE, ZOMBIE_DEFS, ZANIM, ITEM, WEAPONS } from '../../../shared/defs.js';
import {
  MeshBuilder, instantiateRig, setFx, getCharacterMaterial, ikTwoBone, mulberry32, fbm3, noise3,
  clamp, lerp, smooth, color,
} from './skinning.js';
import { CR } from './charTextures.js';
import { createWorldWeapon } from './weapons.js';

const PI = Math.PI;
const TAU = PI * 2;
const HALF = PI / 2;

// ------------------------------------------------------------------ humanoid bone layout
const ROOT = 1, HIPS = 2, SPINE = 3, CHEST = 4, NECK = 5, HEAD = 6, JAW = 7;
const CLAV_L = 8, UARM_L = 9, FARM_L = 10, HAND_L = 11;
const CLAV_R = 12, UARM_R = 13, FARM_R = 14, HAND_R = 15;
const THIGH_L = 16, SHIN_L = 17, FOOT_L = 18, THIGH_R = 19, SHIN_R = 20, FOOT_R = 21;

const C_SOCKET = color(0x0c0605);
const C_BLOOD = color(0x3a0303);
const C_MOUTH = color(0x1a0303);
const C_NAIL = color(0x2a2016);
const C_TEETH = color(0xb8ab84);
const C_BRUISE = color(0x3a1c22);

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

/** Resample control profile [[r,y],...] into n rows (linear). */
function resample(ctrl, n, rmul = 1) {
  const out = [];
  const y0 = ctrl[0][1], y1 = ctrl[ctrl.length - 1][1];
  for (let i = 0; i < n; i++) {
    const y = y0 + ((y1 - y0) * i) / (n - 1);
    let k = 0;
    while (k < ctrl.length - 2 && ctrl[k + 1][1] < y) k++;
    const a = ctrl[k], b = ctrl[k + 1];
    const t = clamp((y - a[1]) / (b[1] - a[1] || 1), 0, 1);
    out.push([(a[0] + (b[0] - a[0]) * t) * rmul, y]);
  }
  return out;
}

function mulColor(hex, k) {
  return color(hex).multiplyScalar(k);
}

// ------------------------------------------------------------------ body part builders
/** Zombie / survivor head on 'head' bone, jaw on 'jaw'. Features are explicit primitives so they read at distance. */
function buildHead(mb, P, L) {
  const hr = P.headR;
  const hb = mb.bonePos('head');
  const jb = mb.bonePos('jaw');
  const cy = hr * 0.9;
  const sx = hr * (L.headSX || 0.84), sy = hr * (L.headSY || 1.0), sz = hr * (L.headSZ || 1.06);
  const human = !!L.human;
  const skinReg = L.headRegion ?? L.skinRegion ?? CR.SKIN;
  const skin = color(L.skin);
  const skinD = skin.clone().multiplyScalar(0.8);
  const gaunt = L.gaunt || 0;
  const craniumShape = (v) => {
    const ny = v.y / sy, nz = v.z / sz;
    if (ny < -0.1) v.x *= 1 - (-0.1 - ny) * (human ? 0.28 : 0.4 + gaunt * 0.15); // narrow lower face
    if (nz < -0.4) v.z *= 0.93; // flatter face
    if (nz > 0.3 && ny < -0.3) v.z *= 0.86; // skull base
    if (ny < -0.55 && nz < 0) v.z *= 0.9; // recessed mouth area
  };
  // cranium
  mb.ellip('head', [0, cy, 0], [sx, sy, sz], {
    ws: L.headWS || 12, hs: L.headHS || 9, color: L.skin, region: skinReg, mottle: human ? 0.08 : 0.3, mf: 20,
    shape: craniumShape,
    tint(p, n, c) {
      const ly = (p.y - hb[1] - cy) / sy, lz = (p.z - hb[2]) / sz;
      if (!human) {
        const lx = (p.x - hb[0]) / sx;
        if (ly < -0.35 && lz < -0.45) c.lerp(C_BLOOD, 0.6);
        if (n.y < -0.5 && lz < -0.2) c.lerp(C_MOUTH, 0.85);
        if (L.cheekTear) {
          // raw flesh around the hole torn through the cheek
          const d = Math.hypot(lx - L.cheekTear * 0.72, (ly + 0.4) * 1.1, (lz + 0.5) * 0.8);
          if (d < 0.5) c.lerp(d < 0.36 ? C_WOUND : C_WOUND2, clamp((0.5 - d) * 6, 0, 0.9));
        }
        if (L.oneEye && Math.abs(lx - L.oneEye * 0.45) < 0.08 + 0.03 * ly && ly < 0.0 && ly > -0.75 && lz < -0.35) c.lerp(C_BLOOD, 0.85); // dried blood run from the empty socket
        if (L.noEar && L.noEar * lx > 0.8 && Math.abs(ly + 0.05) < 0.32 && Math.abs(lz - 0.05) < 0.3) c.lerp(C_WOUND, 0.8);
      } else {
        if (ly < -0.42 && ly > -0.58 && lz < -0.7) c.lerp(color(0x7a4038), 0.35);
        if (L.stubble && ly < -0.3 && lz < -0.1) c.multiplyScalar(0.8);
      }
      if (L.hair && L.hair.patchy && ly > 0.25 - (lz > 0 ? 0.5 : 0) && lz > -0.75) {
        const m = fbm3(p.x * 60, p.y * 60, p.z * 60, 2, 7);
        if (m > L.hair.patchy * 0.8) c.copy(color(L.hair.color)).multiplyScalar(0.7 + m * 0.6);
      }
      if (L.headTint) L.headTint((p.x - hb[0]) / sx, ly, lz, c);
    },
  });
  const fz = -sz * 0.9; // face plane
  // brow ridge
  mb.ellip('head', [0, cy + hr * 0.27, fz + hr * 0.2], [sx * 0.78, hr * (human ? 0.1 : 0.13), hr * 0.2], {
    ws: 7, hs: 3, color: human ? skin : skinD, region: skinReg, mottle: 0.2,
    tint(p, n, c) {
      if (human && n.y > 0.2 && n.z < -0.3) c.multiplyScalar(0.5); // eyebrows
    },
  });
  // nose
  if (human) {
    mb.ellip('head', [0, cy - hr * 0.1, fz - hr * 0.02], [hr * 0.075, hr * 0.17, hr * 0.09], { ws: 6, hs: 4, color: skin, region: skinReg, rot: [-0.3, 0, 0] });
  } else if ((L.nose ?? 1) > 0.3) {
    mb.ellip('head', [0, cy - hr * 0.08, fz - hr * 0.07], [hr * 0.09, hr * 0.2, hr * 0.1], { ws: 5, hs: 3, color: skinD, region: skinReg, rot: [-0.25, 0, 0] });
  }
  if (!human) {
    // rotted nasal cavity
    mb.ellip('head', [0, cy - hr * 0.2, fz - hr * 0.08], [hr * 0.08, hr * 0.09, hr * 0.05], { ws: 5, hs: 3, color: C_SOCKET, region: CR.FLESH, ao: false, blood: false, mottle: 0 });
  }
  // eye sockets + eyes
  const eyeX = sx * (human ? 0.36 : 0.4), eyeY = cy + hr * (human ? 0.08 : 0.1);
  for (const s of [-1, 1]) {
    if (!human) {
      // sunken, bruised socket: near-black at the centre, fading to purple-brown at the rim
      mb.ellip('head', [s * eyeX, eyeY, fz + hr * 0.08], [hr * 0.2, hr * 0.15, hr * 0.12], {
        ws: 7, hs: 5, color: C_SOCKET, region: CR.FLESH, rot: [0, 0, s * -0.2], ao: false, blood: false, mottle: 0,
        tint(p, n, c) {
          c.lerp(C_BRUISE, clamp((n.z + 0.55) * 2.2, 0, 0.8));
        },
      });
      if (L.oneEye !== s) {
        // clouded eyeball, half hidden under a drooping lid
        mb.ellip('head', [s * eyeX * 0.97, eyeY - hr * 0.045, fz - hr * 0.005], [hr * 0.085, hr * 0.068, hr * 0.05], {
          ws: 6, hs: 4, color: L.eye ?? 0x8a8460, glow: L.eyeGlow ?? 0.08, mottle: 0, ao: false, blood: false, region: CR.PLAIN,
          tint(p, n, c) {
            if (n.y > 0.35) c.copy(C_BRUISE);
          },
        });
      }
    } else {
      mb.ellip('head', [s * eyeX, eyeY, fz + hr * 0.01], [hr * 0.1, hr * 0.06, hr * 0.06], {
        ws: 6, hs: 4, color: L.eye ?? 0xd8d4cc, glow: L.eyeGlow || 0, mottle: 0, ao: false, blood: false, region: CR.PLAIN,
      });
      if (!L.eyeGlow) mb.ellip('head', [s * eyeX, eyeY, fz - hr * 0.045], [hr * 0.045, hr * 0.045, hr * 0.015], { ws: 5, hs: 3, color: 0x20140c, mottle: 0, ao: false, region: CR.PLAIN });
    }
  }
  // ears (one may be torn off)
  for (const s of [-1, 1]) {
    if (L.noEar === s) continue;
    mb.ellip('head', [s * sx * 0.97, cy - hr * 0.05, hr * 0.05], [hr * 0.09, hr * 0.24, hr * 0.16], {
      ws: 4, hs: 3, color: skinD, region: skinReg, rot: [0, s * 0.3, 0],
    });
  }
  if (!human && L.skullPatch) {
    // scalp torn away: bare, blood-rimmed skull showing through (bright at distance)
    const sp = L.skullPatch;
    const dl = Math.hypot(sp[0], sp[1], sp[2]);
    const dx = sp[0] / dl, dy = sp[1] / dl, dz = sp[2] / dl, cosR = Math.cos(sp[3]), cosRim = Math.cos(sp[3] * 0.72);
    const dot = (x, y, z) => {
      const lx = (x - hb[0]) / sx, ly = (y - hb[1] - cy) / sy, lz = (z - hb[2]) / sz;
      return (lx * dx + ly * dy + lz * dz) / (Math.hypot(lx, ly, lz) + 1e-6);
    };
    mb.ellip('head', [0, cy, 0], [sx * 1.03, sy * 1.03, sz * 1.03], {
      ws: 14, hs: 10, color: 0xcfc2a0, region: CR.BONE, mottle: 0.25, mf: 30, blood: false, shape: craniumShape,
      tear: { amt: 0, fn: (x, y, z) => dot(x, y, z) < cosR + 0.04 * fbm3(x * 80, y * 80, z * 80, 1, 5) },
      tint(p, n, c) {
        const d = dot(p.x, p.y, p.z);
        if (d < cosRim) c.lerp(C_WOUND, clamp((cosRim - d) / (cosRim - cosR), 0, 1) * 0.9);
      },
    });
  }
  if (!human && L.cheekTear) {
    // cheek torn open: dark cavity with the back teeth showing
    const s = L.cheekTear;
    mb.ellip('head', [s * sx * 0.66, cy - hr * 0.42, fz * 0.55], [hr * 0.13, hr * 0.14, hr * 0.26], {
      ws: 6, hs: 4, color: C_MOUTH, region: CR.FLESH, ao: false, blood: false, mottle: 0.2,
    });
    for (let i = 0; i < 3; i++) {
      mb.box('head', [s * sx * (0.7 - i * 0.03), cy - hr * 0.44, fz * (0.72 - i * 0.16)], [hr * 0.07, hr * 0.12, hr * 0.12], {
        color: C_TEETH.clone().multiplyScalar(0.75 + i * 0.08), region: CR.BONE, ao: false, blood: false, mottle: 0.3, rot: [0, s * 0.3, 0],
      });
    }
  }
  // jaw (lower mandible) relative to jaw bone
  const jy = hb[1] + cy - jb[1];
  const jz = hb[2] - jb[2];
  const jawS = L.jawScale || 1;
  mb.ellip('jaw', [0, jy - hr * 0.62, jz - sz * 0.38 * jawS], [sx * 0.7 * jawS, hr * 0.26, sz * 0.58 * jawS], {
    ws: 9, hs: 5, color: L.skin, region: skinReg, mottle: human ? 0.08 : 0.3,
    shape(v) {
      if (v.z < 0) v.x *= 1 + v.z / (sz * 2.0 * jawS); // narrower chin
    },
    tint(p, n, c) {
      if (!human && n.y > 0.3) c.lerp(C_MOUTH, 0.95);
      else if (!human) c.lerp(C_BLOOD, 0.35);
      else if (L.stubble) c.multiplyScalar(0.78);
    },
  });
  if (!human) {
    // teeth rows (upper on head, lower on jaw)
    const nT = 8;
    const trnd = mulberry32((L.missingTeeth || 0) + 17);
    for (let i = 0; i < nT; i++) {
      const a = ((i + 0.5) / nT - 0.5) * 2.0;
      const tx = Math.sin(a) * sx * 0.44 * jawS, tzU = fz * 0.93 + (1 - Math.cos(a)) * hr * 0.4;
      const fang = L.fang && (i === 1 || i === 6) ? 1.8 : 1;
      const tc = C_TEETH.clone().multiplyScalar(0.7 + trnd() * 0.4);
      if (!((L.missingTeeth || 0) & (1 << i))) {
        const h = hr * (0.1 + trnd() * 0.06) * fang;
        mb.box('jaw', [tx, jy - hr * 0.46 + h * 0.5, jz + tzU * jawS + hr * 0.05], [hr * 0.075, h, hr * 0.06], { color: tc, region: CR.BONE, ao: false, blood: false, rot: [0.1, a, (trnd() - 0.5) * 0.4], mottle: 0.3 });
      }
      if (!((L.missingTeeth || 0) & (1 << ((i + 3) % 8)))) {
        const h = hr * (0.1 + trnd() * 0.07) * fang;
        mb.box('head', [tx, cy - hr * 0.44 - h * 0.5, tzU], [hr * 0.075, h, hr * 0.06], { color: tc, region: CR.BONE, ao: false, blood: false, rot: [-0.1, a, (trnd() - 0.5) * 0.4], mottle: 0.3 });
      }
    }
  }
}

function hair(mb, P, L) {
  if (!L.hair || L.hair.patchy) return; // patchy zombie hair is painted onto the scalp (see buildHead)
  const hr = P.headR;
  const cy = hr * 0.9;
  const h = L.hair;
  const sx = hr * (L.headSX || 0.84), sy = hr * (L.headSY || 1.0), sz = hr * (L.headSZ || 1.06);
  mb.ellip('head', [0, cy + hr * 0.02, hr * 0.03], [sx * 1.07, sy * 1.06, sz * 1.07], {
    ws: 12, hs: 8, t0: 0, tl: PI * (h.cover || 0.52), color: h.color, region: CR.HAIR, mottle: 0.3,
    tear: h.ragged ? { amt: h.ragged, f: 30, seed: h.seed || 3 } : null,
    shape(v) {
      if (v.z < -sz * 0.5 && v.y < sy * 0.55) v.y += sy * 0.08; // hairline
    },
    blood: false,
  });
  if (h.long) {
    mb.ellip('head', [0, cy - hr * 0.35, hr * 0.45], [sx * 0.95, sy * 0.8, sz * 0.55], { ws: 8, hs: 6, color: h.color, region: CR.HAIR, tear: h.ragged ? { amt: h.ragged * 0.7, f: 30, seed: 9 } : null });
  }
  if (h.strands) {
    // lank, matted strands hanging from the back and sides of the scalp down to the shoulders
    const rnd = mulberry32(h.seed || 21);
    for (let i = 0; i < h.strands; i++) {
      const a = ((i + 0.5) / h.strands - 0.5) * 4.2 + (rnd() - 0.5) * 0.3; // 0 = back of the head
      const sa = Math.sin(a), ca = Math.cos(a);
      const len = hr * (2.1 + rnd() * 0.7);
      mb.tube('head', [
        [sa * sx * 0.9, cy + hr * 0.25, ca * sz * 0.85],
        [sa * sx * 1.08, cy - hr * 0.5, ca * sz * 1.02],
        [sa * sx * 1.12, cy - len * 0.7, ca * sz * 0.98 + hr * 0.1],
        [sa * sx * (1.05 + rnd() * 0.2), cy - len, ca * sz * 0.9 + hr * 0.18],
      ], hr * (0.2 + rnd() * 0.08), hr * 0.05, { rs: 5, ts: 5, color: mulColor(h.color, 0.8 + rnd() * 0.4), region: CR.HAIR, blood: false });
    }
  }
}

const C_WOUND = color(0x4a0806);
const C_WOUND2 = color(0x8a2a20);
function woundTint(L, p, c) {
  if (!L.wounds) return;
  for (const w of L.wounds) {
    const d = Math.hypot(p.x - w[0], p.y - w[1], p.z - w[2]) / w[3];
    if (d < 1.4) {
      const nn = fbm3(p.x * 30, p.y * 30, p.z * 30, 2, 13);
      const t = clamp((1.1 - d - (nn - 0.5) * 0.7) * 3, 0, 1);
      if (t > 0) c.lerp(nn > 0.5 ? C_WOUND2 : C_WOUND, t);
      if (t >= 1 && nn < 0.4) c.lerp(C_SOCKET, 0.6);
    }
  }
}

/** Torso: pelvis (hips), abdomen (spine), ribcage/chest (chest), neck. */
function buildTorso(mb, P, L) {
  const w = L.wide || 1;
  const g = L.gaunt ?? 0.4;
  const chestY = P.chestY;
  const sxC = 1.22 * w * (L.chestW || 1), szC = 0.78 * (L.chestD || 1);
  const sxA = 1.18 * w * (L.waistW || 1), szA = 0.8 * (L.bellyD || 1) * (1 - g * 0.12);
  const top = P.neckY - P.chestY + 0.02;
  const cr = L.chestR || 0.158;
  const chestCtrl = [
    [cr * 0.8, -0.11], [cr * 0.9, -0.04], [cr * 0.97, 0.03], [cr, top * 0.45], [cr * 0.96, top * 0.66],
    [cr * 0.82, top * 0.84], [cr * 0.52, top * 0.97], [cr * 0.3, top + 0.01],
  ];
  const ribs = L.ribs ?? g;
  const chestProf = resample(chestCtrl, 11);
  mb.lathe('chest', [0, 0, 0], chestProf, {
    rs: 12, sx: sxC, sz: szC, color: L.skin, region: L.skinRegion ?? CR.SKIN, mottle: 0.25,
    shape(v) {
      // ribs: horizontal ridges on front & sides, lower half of ribcage
      if (ribs > 0 && v.y > -0.08 && v.y < top * 0.6) {
        const fr = clamp((-v.z / (Math.hypot(v.x, v.z) + 1e-5)) * 0.5 + 0.6, 0, 1);
        const sternum = Math.abs(v.x) < 0.025 ? 0.3 : 1;
        const r = Math.abs(Math.sin(((v.y + 0.08) * PI) / 0.034));
        const k = 1 + ribs * 0.045 * r * r * fr * sternum - ribs * 0.02;
        v.x *= k;
        v.z *= k;
      }
      // shoulder blades / flatter back
      if (v.z > 0) v.z *= 0.92;
      // pecs / sunken chest
      if (v.z < 0 && v.y > top * 0.45 && v.y < top * 0.75) v.z *= 1 + (L.pecs || 0) * 0.08;
    },
    tint(p, n, c) {
      woundTint(L, p, c);
      if (ribs > 0) {
        const y = p.y - chestY;
        if (y > -0.08 && y < top * 0.6) {
          const r = Math.abs(Math.sin(((y + 0.08) * PI) / 0.034));
          c.multiplyScalar(1 - ribs * 0.35 * (1 - r));
        }
      }
      if (L.torsoTint) L.torsoTint(p, n, c);
    },
  });
  const abCtrl = [
    [0.128, -P.spineLen - 0.03], [0.126, -P.spineLen * 0.5], [0.12 - 0.012 * g, 0], [0.12 - 0.008 * g, 0.06],
    [cr * 0.85, 0.13], [cr * 0.88, P.chestLen - 0.02],
  ];
  mb.lathe('spine', [0, 0, 0], resample(abCtrl, 7), {
    rs: 12, sx: sxA, sz: szA, color: L.skin, region: L.skinRegion ?? CR.SKIN, mottle: 0.25,
    shape(v) {
      if (v.z < 0 && g > 0.3) v.z *= 1 - g * 0.1 * clamp(1 - Math.abs(v.y - 0.02) / 0.1, 0, 1); // sunken belly
    },
    tint(p, n, c) {
      woundTint(L, p, c);
      if (L.torsoTint) L.torsoTint(p, n, c);
    },
  });
  // pelvis (pants)
  const pc = L.pants ? L.pants.color : L.skin;
  const pr = L.pants ? L.pants.region ?? CR.DENIM : L.skinRegion ?? CR.SKIN;
  mb.lathe('hips', [0, 0, 0], resample([[0.05, -0.125], [0.1, -0.11], [0.122, -0.07], [0.13, -0.01], [0.128, 0.05], [0.124, 0.1]], 6), {
    rs: 12, sx: 1.14 * w * (L.hipsW || 1), sz: 0.82 * (L.hipsD || 1), color: pc, region: pr,
    shape(v) {
      if (v.z > 0) v.z *= 1 + 0.16 * clamp(1 - Math.abs(v.y + 0.05) / 0.07, 0, 1) * (v.z / (Math.hypot(v.x, v.z) + 1e-6)); // glutes
      else v.z *= 0.93; // flatter lower belly
    },
  });
  if (L.pants && L.belt !== false) {
    mb.lathe('hips', [0, 0, 0], [[0.131, 0.06], [0.131, 0.09]], { rs: 10, sx: 1.15 * w * (L.hipsW || 1), sz: 0.83 * (L.hipsD || 1), color: 0x2a2018, region: CR.LEATHER });
  }
  // neck
  const nl = P.neckLen + 0.05;
  mb.seg('neck', [0, -0.05, 0.005], [0, nl, P.headZ - P.neckZ + 0.005], L.neckR || 0.047, (L.neckR || 0.047) * 0.88, {
    rs: 8, hs: 2, caps: 1, capScale: 0.4, color: L.skin, region: L.skinRegion ?? CR.SKIN, sz: 0.92,
    tint(p, n, c) {
      if (n.y > 0.6 && p.y > P.neckY + nl * 0.6) c.lerp(color(0x5a0505), 0.9); // stump when headless
    },
  });
  // collarbones / trapezius
  for (const s of [-1, 1]) {
    const dm = (L.deltoid || 1) * (L.shirt && L.shirt.sleeves ? 0.92 : 1);
    // deltoid cap: tapers down into the upper arm instead of sitting on it like a ball
    if (!L.noDeltoid) mb.ellip('chest', [s * (P.shoulderW - 0.01), P.shoulderY - chestY - 0.004, 0.005], [0.057 * dm, 0.064 * dm, 0.06 * dm], {
      ws: 7, hs: 5, rot: [0, 0, s * 0.25],
      color: L.shoulderCol ?? (L.shirt && L.shirt.sleeves && L.shirt.type !== 'tank' ? L.shirt.color : L.skin),
      region: L.shoulderReg ?? (L.shirt && L.shirt.sleeves && L.shirt.type !== 'tank' ? L.shirt.region ?? CR.CLOTH : L.skinRegion ?? CR.SKIN),
    });
    if (g > 0.2 && !L.shirt) {
      mb.tube('chest', [[s * 0.025, top - 0.035, -0.075 * szC / 0.78], [s * 0.09, top - 0.03, -0.07 * szC / 0.78], [s * 0.15, top - 0.05, -0.05]], 0.011, 0.009, { rs: 4, ts: 3, color: L.skin, region: L.skinRegion ?? CR.SKIN, cap: false });
    }
  }
  return { chestProf, sxC, szC, abCtrl, sxA, szA, top };
}

/** Shirt / jacket shells over the torso. */
function buildShirt(mb, P, L, T) {
  const sh = L.shirt;
  if (!sh) return;
  const g = sh.thick || 1.07;
  const tear = sh.tear ?? 0.28;
  const reg = sh.region ?? CR.CLOTH;
  const chestY = P.chestY, spineY = P.spineY;
  const hemY = spineY - P.spineLen - (sh.hem ?? 0.04);
  const tank = sh.type === 'tank';
  const fnC = (x, y, z) => {
    if (tank && Math.abs(x) > 0.1 && y > chestY + 0.02) return true;
    if (sh.open && z < -0.05 && Math.abs(x) < 0.05 + (y - spineY) * 0.1) return true;
    if (sh.openBack && z > 0.04 && Math.abs(x) < 0.03 + (chestY + 0.1 - y) * 0.12) return true;
    return false;
  };
  const shellProf = T.chestProf.map(([r, y]) => [r * g + 0.004, y]);
  mb.lathe('chest', [0, 0, 0], shellProf.slice(0, 10), {
    rs: 12, sx: T.sxC, sz: T.szC, color: sh.color, region: reg, mottle: 0.2,
    tear: { amt: tear, f: 11, seed: sh.seed || 1, fn: fnC },
    tint: sh.tint,
  });
  const ab = T.abCtrl.map(([r, y]) => [r * g + 0.008, y]);
  ab[0] = [ab[0][0] * 1.05, hemY - spineY];
  mb.lathe('spine', [0, 0, 0], resample(ab, 7), {
    rs: 12, sx: T.sxA * (sh.loose || 1.02), sz: T.szA * (sh.loose || 1.04), color: sh.color, region: reg, mottle: 0.2,
    tear: {
      amt: tear, f: 11, seed: (sh.seed || 1) + 5,
      fn: (x, y, z) => fnC(x, y, z) || y < hemY + 0.06 * fbm3(x * 20, 0, z * 20, 2, 4),
    },
    tint: sh.tint,
  });
  // sleeves
  if (sh.sleeves && !tank) {
    for (const s of [-1, 1]) {
      const n = s < 0 ? 'L' : 'R';
      const long = sh.sleeves === 2;
      const len = long ? P.uarmLen + 0.02 : P.uarmLen * 0.45;
      // short sleeves hug the arm (a wide tube around a thin arm reads as a puffed sleeve)
      const r = long ? (L.armR || 0.045) * 1.22 + 0.006 : (L.armR || 0.045) * 1.12 + 0.005;
      mb.seg('uarm' + n, [0, 0.02, 0], [0, -len, 0], r * (long ? 1.08 : 1.03), r * (long ? 0.95 : 1.0), {
        rs: 8, hs: 2, caps: 0, color: sh.color, region: reg, mottle: 0.2, double: true, tint: sh.tint,
        tear: { amt: tear * 0.8, f: 14, seed: (sh.seed || 1) + s * 3, fn: (x, y) => y < P.shoulderY - len + 0.05 * fbm3(x * 30, y, 0, 1, 6) },
      });
      if (long && L.missingArm !== n) {
        mb.seg('farm' + n, [0, 0.03, 0], [0, -P.farmLen * 0.85, 0], r * 0.9, r * 0.78, {
          rs: 8, hs: 2, caps: 0, color: sh.color, region: reg, mottle: 0.2, double: true, tint: sh.tint,
          tear: { amt: tear * 0.9, f: 14, seed: (sh.seed || 1) + s * 5, fn: (x, y) => y < P.elbowY - P.farmLen * 0.85 + 0.06 * fbm3(x * 30, y * 3, 0, 1, 8) },
        });
      }
    }
  }
  // hanging rags
  if (sh.rags) {
    const rnd = mulberry32(sh.seed || 5);
    for (let i = 0; i < sh.rags; i++) {
      const a = rnd() * TAU;
      const x = Math.sin(a) * 0.15 * T.sxA, z = Math.cos(a) * 0.13 * T.szA;
      const len = 0.08 + rnd() * 0.12;
      mb.box('spine', [x, hemY - spineY - len * 0.4, z], [0.03 + rnd() * 0.03, len, 0.006], { rot: [rnd() * 0.3 - 0.15, a, rnd() * 0.3 - 0.15], color: sh.color, region: reg, mottle: 0.2 });
    }
  }
}

/** Arms + hands. L.missingArm ('L' | 'R') tears that arm off at the elbow. */
function buildArms(mb, P, L) {
  const r1 = L.armR || 0.045;
  const reg = L.skinRegion ?? CR.SKIN;
  const lean = clamp(L.gaunt ?? 0.4, 0, 1);
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    // biceps/triceps belly mid upper arm; forearm muscle just below the elbow, thin wrist
    mb.seg('uarm' + n, [0, 0.01, 0], [0, -P.uarmLen, 0], r1, r1 * 0.78, {
      rs: 7, hs: 4, color: L.armCol ?? L.skin, region: reg, sz: 0.92, noise: L.lumpy ? 0.006 : 0, nf: 30,
      prof: (t) => 1 + (0.12 - lean * 0.07) * Math.sin(clamp((t - 0.1) * 1.4, 0, 1) * PI),
    });
    if (L.missingArm === n) {
      stump(mb, 'farm' + n, r1 * 0.8, 0.02);
      continue;
    }
    mb.seg('farm' + n, [0, 0.015, 0], [0, -P.farmLen, 0], r1 * (L.farmMul || 0.84), r1 * (L.wristMul || 0.6), {
      rs: 7, hs: 4, color: L.skin, region: reg, sz: 0.82, noise: L.lumpy ? 0.005 : 0, nf: 30,
      prof: (t) => 1 + (0.14 - lean * 0.06) * Math.exp(-(((t - 0.22) / 0.22) ** 2)),
      tint: L.armTint,
    });
    // elbow knob
    mb.ellip('farm' + n, [0, 0.0, 0.012], [r1 * 0.75, r1 * 0.75, r1 * 0.75], { ws: 6, hs: 4, color: L.skin, region: reg });
    if (L.wristband === n) {
      mb.lathe('hand' + n, [0, 0.03, 0], [[r1 * 0.66, 0], [r1 * 0.68, 0.012], [r1 * 0.66, 0.024]], { rs: 8, sz: 0.85, color: 0xd8dcd4, region: CR.PLAIN, blood: false });
    }
    buildHand(mb, 'hand' + n, s, P, L);
  }
}

/** Ragged, bloody limb stump with the bone poking out, at the joint of `bone` (hangs along -Y). */
function stump(mb, bone, r, y) {
  mb.ellip(bone, [0, y, 0], [r * 1.05, r * 0.9, r * 1.0], {
    ws: 7, hs: 5, color: 0x5a1210, region: CR.FLESH, mottle: 0.3, noise: r * 0.12, nf: 60, blood: false,
  });
  mb.spike(bone, [0, y - r * 0.3, 0.003], [r * 0.12, y - r * 2.1, -0.004], r * 0.34, { rs: 5, color: 0xd8ccb0, region: CR.BONE, blood: false });
  // dangling sinew
  mb.tube(bone, [[-r * 0.4, y - r * 0.5, -r * 0.2], [-r * 0.5, y - r * 1.3, -r * 0.1], [-r * 0.3, y - r * 2.0, 0]], r * 0.13, r * 0.05, { rs: 4, ts: 3, color: 0x6a1a18, region: CR.FLESH, blood: false });
}

function buildHand(mb, bone, s, P, L) {
  const hl = P.handLen;
  const pl = hl * 0.48;
  const hs = L.handScale || 1;
  const reg = L.handRegion ?? L.skinRegion ?? CR.SKIN;
  const col = L.handCol ?? L.skin;
  if (L.fist) {
    mb.box(bone, [-s * 0.008 * hs, -pl * 0.62 * hs, 0], [0.042 * hs, pl * 1.35 * hs, 0.08 * hs], { round: 0.55, color: col, region: reg });
    mb.ellip(bone, [-s * 0.012 * hs, -pl * 0.35 * hs, -0.045 * hs], [0.014 * hs, 0.03 * hs, 0.014 * hs], { ws: 5, hs: 4, color: col, region: reg, rot: [0.4, 0, 0] });
    return;
  }
  mb.box(bone, [0, -pl * 0.5 - 0.004, 0], [0.026 * hs, pl * hs, 0.068 * hs], { round: 0.5, color: col, region: reg });
  const curl = L.curl ?? 0.45;
  const fm = (L.fingerMul || 1) * hs;
  const lens = [0.95, 1.0, 0.95, 0.78];
  for (let i = 0; i < 4; i++) {
    const z = (-0.025 + i * 0.0167) * hs;
    const len = hl * 0.5 * lens[i] * fm;
    const y0 = -pl * hs;
    const pts = [
      [0, y0 + 0.005, z],
      [-s * len * 0.18 * curl, y0 - len * 0.5, z * 1.02],
      [-s * len * 0.62 * curl, y0 - len * 0.88, z * 1.05],
    ];
    mb.tube(bone, pts, 0.0085 * hs, 0.0055 * hs, { rs: 4, ts: 2, color: col, region: reg, cap: false });
    if (L.claws) {
      const tip = pts[2];
      const cl = L.claws * hs;
      mb.spike(bone, tip, [tip[0] - s * cl * 0.7 * curl, tip[1] - cl * 0.8, tip[2] - cl * 0.1], 0.0055 * hs, { rs: 4, color: C_NAIL, region: CR.BONE, mottle: 0.2 });
    }
  }
  const tp = [[-s * 0.008, -0.02 * hs, -0.03 * hs], [-s * 0.022 * hs, -0.055 * hs, -0.046 * hs], [-s * 0.035 * hs, -0.08 * hs, -0.047 * hs]];
  mb.tube(bone, tp, 0.01 * hs, 0.007 * hs, { rs: 4, ts: 2, color: col, region: reg, cap: false });
}

/** Legs, knees, feet. */
function buildLegs(mb, P, L) {
  const pants = L.pants;
  const tr = L.thighR || 0.078;
  const skinReg = L.skinRegion ?? CR.SKIN;
  const lean = clamp(L.gaunt ?? 0.4, 0, 1); // wasted muscle on gaunt corpses
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const pc = pants ? pants.color : L.skin;
    const preg = pants ? pants.region ?? CR.DENIM : skinReg;
    const shorts = pants && pants.shorts;
    const tearY = pants ? (pants.tearY ?? 0) : 99;
    // quads bulge in the upper third, taper into the knee
    mb.seg('thigh' + n, [0, 0.05, 0], [0, -P.thighLen, 0], tr, tr * 0.68, {
      rs: 8, hs: 5, color: shorts ? L.skin : pc, region: shorts ? skinReg : preg, sz: 0.95, noise: L.lumpy ? 0.008 : 0, nf: 25,
      prof: (t) => 1 + (0.1 - lean * 0.05) * Math.sin(Math.min(1, t * 1.5) * PI) - 0.06 * smooth((t - 0.8) / 0.2),
      tint: shorts
        ? (p, nn, c) => {
            if (p.y > P.thighY - P.thighLen * 0.45 + 0.05 * fbm3(p.x * 30, 0, p.z * 30, 1, 2)) c.copy(color(pc)).multiplyScalar(0.9);
          }
        : pants && pants.tint,
    });
    const pantsLeg = pants && !shorts;
    const shinTint = (p, nn, c) => {
      if (pantsLeg && p.y < tearY + 0.07 * fbm3(p.x * 25, p.y * 4, p.z * 25, 2, 11 + s)) c.copy(color(L.skin)).multiplyScalar(0.62).lerp(C_BLOOD, 0.25 * fbm3(p.x * 40, p.y * 40, p.z * 40, 1, 3));
      if (pants && pants.tint) pants.tint(p, nn, c);
    };
    // calf muscle high on the back of the shin, slim ankle
    mb.seg('shin' + n, [0, 0.03, 0], [0, -P.shinLen + 0.03, 0], tr * (pantsLeg ? 0.72 : 0.62), tr * (pantsLeg ? 0.6 : 0.44), {
      rs: 8, hs: 5, color: pantsLeg ? pc : L.skin, region: pantsLeg ? preg : skinReg, sz: 0.95,
      prof: pantsLeg ? null : (t) => 1 + (0.1 - lean * 0.04) * Math.sin(Math.min(1, t * 2.2) * PI) - 0.08 * smooth((t - 0.75) / 0.25),
      shape(v) {
        if (v.z > 0 && v.y > -P.shinLen * 0.5) v.z *= 1.15; // calf
      },
      tint: shinTint,
    });
    // knee: kneecap on bare legs, a fabric knee on trousers (hides the thigh/shin seam when bent)
    if (!pantsLeg) mb.ellip('shin' + n, [0, 0.0, -0.02], [tr * 0.55, tr * 0.55, tr * 0.5], { ws: 6, hs: 4, color: L.skin, region: skinReg });
    else mb.ellip('shin' + n, [0, 0.01, 0], [tr * 0.72, tr * 0.8, tr * 0.7], { ws: 7, hs: 5, color: pc, region: preg, tint: shinTint });
    // foot
    if (L.shoes) {
      mb.box('foot' + n, [0, -P.ankleY * 0.45, -0.045], [0.1 * (L.footW || 1), P.ankleY * 1.1 + 0.015, 0.26 * (L.footL || 1)], {
        round: 0.45, seg: 2, color: L.shoes.color, region: L.shoes.region ?? CR.LEATHER,
        tint(p, nn, c) {
          if (p.y < 0.025) c.multiplyScalar(0.35);
        },
      });
    } else {
      const fh = Math.max(0.05, P.ankleY * 0.95);
      mb.box('foot' + n, [0, -P.ankleY + fh * 0.5, -0.05], [0.085 * (L.footW || 1), fh, 0.23 * (L.footL || 1)], { round: 0.45, seg: 2, color: L.skin, region: skinReg });
      for (let i = 0; i < 3; i++) {
        mb.ellip('foot' + n, [(i - 1) * 0.022 * (L.footW || 1), -P.ankleY * 0.75, -0.16 * (L.footL || 1)], [0.012, 0.012, 0.022], { ws: 5, hs: 3, color: L.skin, region: skinReg });
      }
    }
  }
}

// ------------------------------------------------------------------ zombie looks
const SKINS = [0x7d8a6e, 0x93968a, 0x7a7488, 0x9c9870, 0x66725c, 0x8a8f86];
const SHIRTS = [0xa8a290, 0x7a2a22, 0x3d4f6b, 0x4f5a3a, 0x6b6b66, 0x8a7440, 0x5a4632, 0x2a2a2a, 0x5b3a5e];
const PANTS = [0x3b4a63, 0x7d7055, 0x262626, 0x4a3a2a, 0x55555a, 0x2f3d52];
const HAIRC = [0x1d1510, 0x3a2a1a, 0x6a6258, 0x2a2420, 0x8a7a60];

function pick(rnd, arr) {
  return arr[(rnd() * arr.length) | 0];
}

// Per-variant injuries (see buildHead / buildArms): they change the silhouette and the face, so a
// horde of the same type still reads as individuals.
const WALKER_HURTS = [
  { cheekTear: -1 },
  { skullPatch: [0.5, 0.75, 0.25, 0.62] },
  { jawHang: 0.5, noEar: 1 },
  { oneEye: 1 },
  { missingArm: 'L' },
  { skullPatch: [-0.55, 0.6, -0.15, 0.55], noEar: -1 },
  { jawHang: 0.42, oneEye: -1 },
  { cheekTear: 1, missingArm: 'R' },
];

// Who they were: outfits from the valley's farms, motels, hospital and roads (walker variants 8+).
const WALKER_OUTFITS = ['farmer', 'hunter', 'patient', 'office', 'roadcrew', 'woman'];
const WALKER_VARIANTS = 8 + WALKER_OUTFITS.length;

function walkerLook(v) {
  if (v >= 8) return outfitLook(v, WALKER_OUTFITS[(v - 8) % WALKER_OUTFITS.length]);
  const rnd = mulberry32(1000 + v * 7919);
  const skin = SKINS[v % SKINS.length];
  const sleeveT = [1, 2, 0, 1, 2, 1, 2, 1][v % 8];
  return {
    ...WALKER_HURTS[v],
    skin, skinRegion: v % 3 === 1 ? CR.GORE : CR.SKIN, gaunt: 0.45 + rnd() * 0.35,
    shirt: v === 6 ? null : {
      color: SHIRTS[(v * 5 + 2) % SHIRTS.length], region: v % 4 === 3 ? CR.CANVAS : CR.CLOTH,
      sleeves: sleeveT, tear: 0.22 + rnd() * 0.18, seed: v * 13 + 1, rags: 3 + ((rnd() * 4) | 0),
      open: v === 4, type: v === 2 ? 'tank' : 'tee', hem: 0.02 + rnd() * 0.06,
    },
    pants: { color: PANTS[v % PANTS.length], region: v % 2 ? CR.DENIM : CR.CLOTH, tearY: v % 3 === 0 ? 0.3 : 0.02 + rnd() * 0.12 },
    shoes: v % 5 === 4 ? null : { color: v % 2 ? 0x2a2420 : 0x4a3a2c },
    hair: v % 4 === 2 ? null : { color: HAIRC[v % HAIRC.length], patchy: 0.35 + rnd() * 0.25, long: v === 5, cover: 0.5 },
    eye: v % 3 === 0 ? 0xd8d4b0 : 0xa8a078, eyeGlow: 0,
    ribs: v === 6 || v === 2 ? 0.9 : 0.4,
    missingTeeth: (rnd() * 64) | 0,
    blood: [
      [[0, 1.52, -0.1], 0.1, 1],
      [[(rnd() - 0.5) * 0.2, 1.25 + rnd() * 0.1, -0.14], 0.1 + rnd() * 0.06, 0.9],
      [[(rnd() - 0.5) * 0.3, 1.0, -0.12], 0.07, 0.8],
    ],
    wound: v % 3 === 0,
    dirt: { y0: 0.5, k: 0.9 },
  };
}

function outfitLook(v, outfit) {
  const rnd = mulberry32(1000 + v * 7919);
  const L = {
    skin: SKINS[(v * 5) % SKINS.length], skinRegion: v % 2 ? CR.GORE : CR.SKIN, gaunt: 0.45 + rnd() * 0.3,
    pants: { color: 0x3b4a63, region: CR.DENIM, tearY: 0.05 + rnd() * 0.1 },
    shoes: { color: 0x2e2218 },
    hair: { color: HAIRC[v % HAIRC.length], patchy: 0.4 + rnd() * 0.2, cover: 0.5 },
    eye: v % 2 ? 0xd8d4b0 : 0xa8a078, eyeGlow: 0,
    ribs: 0.4,
    missingTeeth: (rnd() * 64) | 0,
    blood: [
      [[0, 1.52, -0.1], 0.1, 1],
      [[(rnd() - 0.5) * 0.2, 1.25 + rnd() * 0.1, -0.14], 0.1 + rnd() * 0.06, 0.9],
      [[(rnd() - 0.5) * 0.3, 1.0, -0.12], 0.07, 0.8],
    ],
    dirt: { y0: 0.5, k: 0.9 },
  };
  switch (outfit) {
    case 'farmer': // red flannel under denim bib overalls, feed cap
      return Object.assign(L, {
        shirt: { color: 0x8a2622, region: CR.PLAID, sleeves: 2, tear: 0.2, seed: 401, rags: 1, hem: 0.02 },
        pants: { color: 0x34466a, region: CR.DENIM, tearY: 0.12 },
        shoes: { color: 0x3a2a1c }, overalls: true, cap: { color: 0x3a5a2a, peak: 0xd8d0b8 },
        hair: { color: 0x6a6258, patchy: 0.5, cover: 0.5 }, jawHang: 0.35,
      });
    case 'hunter': // olive shirt, blaze-orange vest + cap
      return Object.assign(L, {
        shirt: { color: 0x3e4430, region: CR.CANVAS, sleeves: 2, tear: 0.25, seed: 411, rags: 2, hem: 0.03 },
        vest: { color: 0xd8561a, region: CR.CANVAS, sleeves: 0, thick: 1.15, tear: 0.12, seed: 413, hem: 0.0, loose: 1.08 },
        pants: { color: 0x4a4434, region: CR.CANVAS, tearY: 0.2 }, shoes: { color: 0x3a2a1c },
        cap: { color: 0xd8561a }, oneEye: -1, cheekTear: 1,
      });
    case 'patient': // hospital gown, bare legs and feet, ID wristband
      return Object.assign(L, {
        skin: 0x939a8c, skinRegion: CR.SKIN, gaunt: 0.8,
        shirt: { color: 0x9ab8b4, region: CR.CLOTH, sleeves: 1, tear: 0.12, seed: 421, rags: 0, hem: -0.02, openBack: true },
        gown: true, pants: null, shoes: null, wristband: 'L',
        hair: { color: 0x2a2420, patchy: 0.75, cover: 0.45 }, eye: 0xe0e0d0,
        skullPatch: [0.1, 0.8, 0.45, 0.5], ribs: 0.6,
        blood: [[[0, 1.3, -0.14], 0.12, 0.9], [[0.05, 1.0, -0.13], 0.1, 0.8], [[-0.1, 0.55, -0.05], 0.08, 0.7]],
      });
    case 'office': // white shirt, tie, charcoal slacks, dress shoes
      return Object.assign(L, {
        shirt: {
          color: 0xc8c4b8, region: CR.CLOTH, sleeves: 2, tear: 0.16, seed: 431, rags: 1, hem: 0.0,
          tint(p, n, c) {
            if (Math.abs(p.x) < 0.008 && p.z < -0.08) c.multiplyScalar(0.7); // button placket
          },
        },
        tie: 0x5a1a24, collar: true,
        pants: { color: 0x2a2c30, region: CR.CLOTH, tearY: 0.06 }, shoes: { color: 0x141210 },
        hair: { color: 0x1d1510, patchy: 0.25, cover: 0.52 }, cheekTear: -1, noEar: 1,
        blood: [[[0, 1.5, -0.12], 0.14, 1], [[0.06, 1.28, -0.15], 0.14, 1], [[-0.08, 1.12, -0.14], 0.1, 0.9]],
      });
    case 'roadcrew': // grey tee, hi-vis vest with reflective tape, hard hat
      return Object.assign(L, {
        shirt: { color: 0x5a5a58, region: CR.CLOTH, sleeves: 1, tear: 0.25, seed: 441, rags: 2, hem: 0.03 },
        vest: { color: 0xb8d420, region: CR.CANVAS, sleeves: 0, thick: 1.15, tear: 0.1, seed: 443, hem: 0.0, loose: 1.08, stripes: true },
        pants: { color: 0x3b4a63, region: CR.DENIM, tearY: 0.1 }, shoes: { color: 0x3a2a1c },
        hardHat: 0xe0a818, hair: null, oneEye: 1,
      });
    case 'woman': // long lank hair, tank top, jeans, sneakers
      return Object.assign(L, {
        body: { shoulderW: 0.17, hipW: 0.1, headR: 0.098, uarmLen: 0.28, farmLen: 0.25 },
        chestR: 0.15, hipsW: 1.1, armR: 0.041, thighR: 0.076, neckR: 0.043,
        shirt: { color: 0x6a3a5a, region: CR.CLOTH, type: 'tank', tear: 0.2, seed: 451, rags: 2, hem: 0.0 },
        pants: { color: 0x4a5a7a, region: CR.DENIM, tearY: 0.25 }, shoes: { color: 0x9a968c, region: CR.CANVAS },
        hair: { color: 0x3a2418, cover: 0.56, long: true, ragged: 0.12, strands: 9, seed: 23 },
        jawHang: 0.4,
      });
  }
  return L;
}

/** Radius of a lathe profile [[r, y], ...] at height y (linear). */
function profR(prof, y) {
  if (y <= prof[0][1]) return prof[0][0];
  for (let i = 1; i < prof.length; i++) {
    if (y <= prof[i][1]) {
      const a = prof[i - 1], b = prof[i];
      return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1);
    }
  }
  return prof[prof.length - 1][0];
}

// ------------------------------------------------------------------ type builders
function addBlood(mb, L) {
  if (L.blood) for (const b of L.blood) mb.blood(b[0], b[1], b[2]);
  mb.dirt = L.dirt || { y0: 0.4, k: 0.5 };
}

function standardHumanoid(mb, P, L) {
  addHumanoidBones(mb, P);
  addBlood(mb, L);
  const T = buildTorso(mb, P, L);
  buildShirt(mb, P, L, T);
  buildHead(mb, P, L);
  hair(mb, P, L);
  buildArms(mb, P, L);
  buildLegs(mb, P, L);
  return T;
}

function exposedRibs(mb, P, side, y0, n, L, T) {
  // flesh cavity + bone ribs on one flank
  const chestY = P.chestY;
  for (let i = 0; i < n; i++) {
    const y = y0 + i * 0.034;
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const a = side * (0.5 + k * 0.28);
      const r = 0.155 * 1.03;
      pts.push([Math.sin(a) * r * T.sxC, y - k * 0.006, -Math.cos(a) * r * T.szC]);
    }
    mb.tube('chest', pts, 0.0085, 0.007, { rs: 4, ts: 4, color: 0xd8ccb0, region: CR.BONE, blood: false, cap: false });
  }
  (L.wounds || (L.wounds = [])).push([side * 0.14, chestY + y0 + n * 0.017, -0.07, 0.1]);
}

function buildWalker(v) {
  const L = walkerLook(v);
  const P = humanP({ headR: 0.102, neckLen: 0.1, ...L.body });
  const mb = new MeshBuilder();
  const T = standardHumanoid(mb, P, L);
  if (L.ribs > 0.8) exposedRibs(mb, P, v % 2 ? 1 : -1, -0.06, 4, L, T);
  if (L.wound) (L.wounds || (L.wounds = [])).push([0.07, P.spineY + 0.03, -0.1, 0.06]);
  outfitParts(mb, P, L, T);
  return { mb, P, A: L.jawHang ? { jawHang: L.jawHang } : null };
}

/** Outfit accessories layered over the standard body (walker outfits, see outfitLook). */
function outfitParts(mb, P, L, T) {
  const hr = P.headR;
  const sx = hr * (L.headSX || 0.84), sz = hr * (L.headSZ || 1.06);
  const chestY = P.chestY, spineY = P.spineY;
  if (L.vest) {
    buildShirt(mb, P, { ...L, shirt: L.vest }, T);
    if (L.vest.stripes) {
      // reflective tape: two bands around the vest, faintly self-lit so they catch the eye at night
      const g = L.vest.thick;
      const openFront = (x, y, z) => L.vest.open && z < -0.05 && Math.abs(x) < 0.05 + (y - spineY) * 0.1 + 0.012;
      const band = (bone, prof, y, sxk, szk, grow) => {
        const r = profR(prof, y) * g + grow;
        mb.lathe(bone, [0, 0, 0], [[r, y - 0.018], [r + 0.001, y], [r, y + 0.018]], {
          rs: 12, sx: sxk, sz: szk, color: 0xd8d8cc, region: CR.PLAIN, glow: 0.35, mottle: 0.1, blood: false, double: true,
          tear: { amt: 0, fn: openFront },
        });
      };
      band('chest', T.chestProf, 0.03, T.sxC, T.szC, 0.008);
      band('spine', resample(T.abCtrl, 7), 0.0, T.sxA * (L.vest.loose || 1.02), T.szA * (L.vest.loose || 1.04), 0.013);
    }
  }
  if (L.overalls) {
    // denim bib + straps; the trousers carry the rest of the overalls
    const col = L.pants.color, g = 1.13;
    const bib = (x, y, z) => z < -0.02 && Math.abs(x) < 0.1 + 0.01 * fbm3(x * 40, y * 40, 0, 1, 2) && y < chestY + 0.075;
    mb.lathe('chest', [0, 0, 0], T.chestProf.slice(0, 8).map(([r, y]) => [r * g + 0.006, y]), {
      rs: 12, sx: T.sxC, sz: T.szC, color: col, region: CR.DENIM, double: true, tear: { amt: 0, fn: (x, y, z) => !bib(x, y, z) },
    });
    const ab = resample(T.abCtrl, 7).map(([r, y]) => [r * g + 0.012, y]);
    mb.lathe('spine', [0, 0, 0], ab, {
      rs: 12, sx: T.sxA * 1.04, sz: T.szA * 1.06, color: col, region: CR.DENIM,
      tear: { amt: 0.12, f: 12, seed: 7, fn: (x, y, z) => y > spineY - 0.06 && !bib(x, y, z) },
    });
    const zf = -(profR(T.chestProf, 0.075) * g + 0.01) * T.szC;
    const zb = (profR(T.chestProf, 0.0) * g + 0.01) * T.szC;
    const top = T.top;
    for (const s of [-1, 1]) {
      mb.tube('chest', [
        [s * 0.085, 0.07, zf], [s * 0.1, top - 0.05, zf * 0.7], [s * 0.105, top - 0.02, 0.0], [s * 0.095, top - 0.06, zb * 0.8], [s * 0.06, -0.02, zb],
      ], 0.012, 0.012, { rs: 4, ts: 10, color: col, region: CR.DENIM, cap: false });
      mb.ellip('chest', [s * 0.085, 0.07, zf - 0.006], [0.012, 0.012, 0.006], { ws: 5, hs: 3, color: 0x8a8a80, region: CR.PLAIN, blood: false });
    }
  }
  if (L.collar) {
    mb.lathe('chest', [0, T.top - 0.035, 0.0], [[0.072, 0], [0.08, 0.028], [0.078, 0.05]], {
      rs: 10, sx: 1.2, sz: 1.08, color: L.shirt.color, region: CR.CLOTH, double: true,
      tear: { amt: 0, fn: (x, y, z) => z < -0.06 && Math.abs(x) < 0.015 },
    });
  }
  if (L.tie) {
    // knot at the collar, blade lying on the shirt front down to the sternum
    const g = L.shirt.thick || 1.07;
    const pts = [T.top - 0.04, 0.12, 0.03, -0.06].map((y) => [0, y, -(profR(T.chestProf, y) * g + 0.01) * T.szC - (y > 0.15 ? 0.012 : 0)]);
    mb.ellip('chest', [0, pts[0][1] - 0.004, pts[0][2] - 0.004], [0.012, 0.013, 0.01], { ws: 6, hs: 4, color: L.tie, region: CR.CLOTH });
    for (let i = 0; i < 3; i++) {
      mb.seg('chest', pts[i], pts[i + 1], 0.006 + i * 0.003, 0.008 + i * 0.003, { rs: 6, hs: 1, caps: i === 2 ? 1 : 0, capScale: 1.5, sx: 2.2, sz: 0.3, color: L.tie, region: CR.CLOTH });
    }
  }
  if (L.gown) {
    // gown skirt hangs from the pelvis, flared so striding thighs stay inside; open at the back
    mb.lathe('hips', [0, 0, 0], [[0.2, -0.3], [0.18, -0.14], [0.162, -0.02], [0.158, 0.06]], {
      rs: 12, sx: 1.14 * (L.hipsW || 1), sz: 0.98, color: L.shirt.color, region: CR.CLOTH, double: true, mottle: 0.2,
      tear: { amt: 0.12, f: 11, seed: 427, fn: (x, y, z) => (z > 0.05 && Math.abs(x) < 0.03 + (P.hipY - y) * 0.2) || y < P.hipY - 0.3 + 0.06 * fbm3(x * 20, 0, z * 20, 2, 4) },
    });
  }
  if (L.cap) {
    const c = L.cap.color;
    const front = L.cap.peak && color(L.cap.peak);
    mb.ellip('head', [0, hr * 1.02, 0.01], [sx * 1.1, hr * 0.8, sz * 0.95], {
      ws: 10, hs: 6, t0: 0, tl: PI * 0.5, color: c, region: CR.CANVAS, rot: [0.08, 0, 0.06],
      tint: front && ((p, n, cc) => { if (n.z < -0.5 && n.y < 0.8) cc.copy(front); }), // feed cap: pale front panel
    });
    mb.box('head', [0, hr * 1.1, -hr * 1.1], [hr * 1.3, 0.01, hr * 0.66], { color: mulColor(c, 0.85), region: CR.CANVAS, rot: [0.16, 0, 0.06] });
  }
  if (L.hardHat) {
    const c = L.hardHat;
    mb.ellip('head', [0, hr * 1.12, 0.005], [sx * 1.18, hr * 0.86, sz * 1.1], { ws: 12, hs: 6, t0: 0, tl: PI * 0.5, color: c, region: CR.PLAIN, mottle: 0.15, rot: [0.1, 0, -0.08] });
    mb.lathe('head', [0, hr * 1.1, -hr * 0.08], [[sx * 1.1, 0.0], [sx * 1.42, -0.008], [sx * 1.42, 0.0], [sx * 1.1, 0.012]], {
      rs: 14, sz: 1.14, color: mulColor(c, 0.9), region: CR.PLAIN, rot: [0.1, 0, -0.08],
    });
    mb.box('head', [0, hr * 1.95, 0.0], [hr * 0.22, hr * 0.12, sz * 1.8], { round: 0.5, color: mulColor(c, 0.95), region: CR.PLAIN, rot: [0.1, 0, -0.08] });
  }
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
  const T = standardHumanoid(mb, P, L);
  exposedRibs(mb, P, -1, -0.07, 4, L, T);
  return { mb, P, A: L.jawHang ? { jawHang: L.jawHang } : null };
}

function buildSpitter() {
  const P = humanP({ hipY: 1.0, thighLen: 0.47, shinLen: 0.46, spineLen: 0.14, chestLen: 0.2, neckOff: 0.17, neckLen: 0.24, headR: 0.1, shoulderW: 0.165, uarmLen: 0.34, farmLen: 0.31, handLen: 0.19, neckZ: 0.0, headZ: -0.02 });
  const L = {
    skin: 0x7e8a70, skinRegion: CR.SKIN, gaunt: 1, ribs: 1, armR: 0.036, thighR: 0.064, neckR: 0.036, chestR: 0.145,
    shirt: { color: 0x5a5a4c, type: 'tee', sleeves: 0, tear: 0.45, seed: 91, rags: 5, hem: -0.05 },
    pants: { color: 0x3a3a34, region: CR.CLOTH, tearY: 0.4 },
    shoes: null, hair: { color: 0x151210, patchy: 0.7, cover: 0.45 },
    eye: 0xb8ff60, eyeGlow: 0.9, socket: 0.22, fingerMul: 1.25, claws: 0.018, headSY: 1.12, jawScale: 1.1,
    blood: [[[0, 1.62, -0.12], 0.1, 0.6]],
    torsoTint(p, n, c) {
      // acid burns
      if (fbm3(p.x * 12, p.y * 12, p.z * 12, 2, 3) > 0.62) c.lerp(color(0x9ab040), 0.5);
    },
  };
  const mb = new MeshBuilder();
  standardHumanoid(mb, P, L);
  // swollen glowing throat sac on the neck (own bone for pulsing)
  mb.addBone('sac', 'neck', 0, P.neckY + P.neckLen * 0.5, -0.03);
  const sacTint = (p, n, c) => {
    const m = fbm3(p.x * 40, p.y * 40, p.z * 40, 2, 5);
    if (m < 0.4) c.lerp(color(0x3a5a18), 0.6);
  };
  mb.ellip('sac', [0, 0.0, -0.03], [0.056, 0.088, 0.056], {
    ws: 10, hs: 8, color: 0x9cff48, region: CR.GLOW, glow: 0.75, mottle: 0.2, blood: false, ao: false, noise: 0.007, nf: 40, tint: sacTint,
  });
  for (const s2 of [-1, 1]) {
    mb.ellip('sac', [s2 * 0.036, -0.025, -0.018], [0.036, 0.05, 0.04], { ws: 8, hs: 6, color: 0x8cf040, region: CR.GLOW, glow: 0.6, blood: false, ao: false, tint: sacTint });
  }
  // acid drool strands from the jaw
  const jb = mb.bonePos('jaw');
  const hb = mb.bonePos('head');
  const jy = hb[1] + P.headR * 0.9 - jb[1];
  for (let i = 0; i < 2; i++) {
    const x = (i - 0.5) * 0.03;
    const y0 = jy - P.headR * 0.75, z0 = hb[2] - jb[2] - P.headR * 0.8;
    mb.tube('jaw', [[x, y0, z0], [x * 1.2, y0 - 0.05 - i * 0.03, z0 - 0.005], [x * 1.3, y0 - 0.09 - i * 0.05, z0 + 0.005]], 0.004, 0.0015, { rs: 4, ts: 3, color: 0x9ae040, glow: 0.45, region: CR.GLOW, blood: false, ao: false });
    mb.ellip('jaw', [x * 1.3, y0 - 0.095 - i * 0.05, z0 + 0.005], [0.006, 0.009, 0.006], { ws: 5, hs: 3, color: 0xa8f048, glow: 0.5, region: CR.GLOW, blood: false, ao: false });
  }
  return { mb, P };
}

function buildLeaper() {
  const P = humanP({ hipY: 0.98, hipW: 0.1, thighLen: 0.46, shinLen: 0.46, spineLen: 0.13, chestLen: 0.19, neckOff: 0.18, neckLen: 0.1, headR: 0.1, shoulderW: 0.17, uarmLen: 0.36, farmLen: 0.35, handLen: 0.2 });
  const L = {
    skin: 0x8a8a80, skinRegion: CR.SKIN, gaunt: 0.9, ribs: 0.5, armR: 0.037, thighR: 0.066, neckR: 0.04, chestR: 0.145,
    shirt: { color: 0x2c3a2e, region: CR.CANVAS, sleeves: 2, tear: 0.2, seed: 131, rags: 6, hem: 0.1, loose: 1.05 },
    pants: { color: 0x2a2a2c, region: CR.CLOTH, tearY: 0.3 },
    shoes: null, eye: 0xffe070, eyeGlow: 0.8, socket: 0.2, fingerMul: 1.3, claws: 0.035, curl: 1.1,
    blood: [[[0, 1.5, -0.1], 0.1, 1], [[0.2, 0.7, -0.05], 0.1, 0.8]],
  };
  const mb = new MeshBuilder();
  standardHumanoid(mb, P, L);
  // hood (on head bone) + hood drape on chest
  const hr = P.headR;
  mb.ellip('head', [0, hr * 0.95, hr * 0.08], [hr * 1.18, hr * 1.2, hr * 1.25], {
    ws: 12, hs: 9, color: 0x2c3a2e, region: CR.CANVAS, double: true, mottle: 0.25,
    tear: { amt: 0.08, f: 20, seed: 5, fn: (x, y, z) => z < -0.05 + 0.02 && y < P.headY + hr * 1.5 && y > P.headY - 0.1 && Math.abs(x) < hr * 0.85 },
    shape(v) {
      if (v.z < 0 && v.y > hr * 0.6) v.z -= hr * 0.25 * ((v.y - hr * 0.6) / (hr * 0.6)); // pointed brim
    },
  });
  mb.lathe('neck', [0, 0, 0.01], [[0.09, -0.06], [0.1, 0.0], [0.085, 0.08]], { rs: 10, sx: 1.4, sz: 1.2, color: 0x2c3a2e, region: CR.CANVAS, double: true });
  return { mb, P };
}

function buildRoper() {
  const P = humanP({ hipY: 1.0, thighLen: 0.46, shinLen: 0.46, spineLen: 0.14, chestLen: 0.22, neckOff: 0.2, neckLen: 0.1, headR: 0.12, shoulderW: 0.2, uarmLen: 0.33, farmLen: 0.3, handLen: 0.19 });
  const L = {
    skin: 0x86806c, skinRegion: CR.GORE, gaunt: 0.4, ribs: 0.3, armR: 0.048, thighR: 0.08, lumpy: true,
    shirt: { color: 0x4a3f36, region: CR.CANVAS, sleeves: 1, tear: 0.35, seed: 151, rags: 4 },
    pants: { color: 0x2f3440, region: CR.DENIM, tearY: 0.25 },
    shoes: { color: 0x30261c },
    eye: 0xe0e0c0, eyeGlow: 0.2, socket: 0.18, jawScale: 1.45, fang: true, nose: 0.4,
    blood: [[[0, 1.6, -0.14], 0.14, 1], [[0, 1.4, -0.16], 0.12, 0.9]],
  };
  const mb = new MeshBuilder();
  standardHumanoid(mb, P, L);
  // tumor growths on the left side (shoulder, neck, arm, flank)
  const rnd = mulberry32(777);
  const tum = [
    ['chest', [-0.16, P.shoulderY - P.chestY + 0.06, 0.02], 0.1],
    ['chest', [-0.1, P.shoulderY - P.chestY + 0.1, 0.05], 0.08],
    ['neck', [-0.06, 0.05, 0.02], 0.065],
    ['head', [-0.08, P.headR * 0.6, 0.05], 0.06],
    ['uarmL', [-0.03, -0.1, 0.01], 0.07],
    ['uarmL', [-0.02, -0.22, -0.02], 0.055],
    ['spine', [-0.13, 0.05, -0.02], 0.08],
    ['chest', [-0.12, -0.02, -0.1], 0.07],
    ['farmL', [-0.02, -0.1, 0.0], 0.05],
    ['thighL', [-0.05, -0.1, 0.0], 0.06],
  ];
  for (const [b, c, r] of tum) {
    mb.ellip(b, c, [r * (0.9 + rnd() * 0.3), r * (0.8 + rnd() * 0.3), r * (0.9 + rnd() * 0.3)], { ws: 8, hs: 6, color: rnd() < 0.5 ? 0x7a5a5c : 0x6e5660, region: CR.TUMOR, noise: r * 0.15, nf: 30, mottle: 0.3 });
  }
  // mouth anchor: tongue tip inside oversized mouth
  mb.box('jaw', [0, -0.02, -P.headR * 0.8], [0.035, 0.015, 0.05], { color: 0x8a2030, region: CR.FLESH, blood: false });
  return { mb, P };
}

// The Shade: a starved, ash-dark silhouette that the night swallows whole (a beam shows it grey as a statue). What
// gives it away in the dark are the pale eyes and the veins of cold light under its skin - faint while it stalks,
// flaring when a light pins it (see ZombieInstance.hold).
function buildShade() {
  const P = humanP({ hipY: 1.06, hipW: 0.09, thighLen: 0.5, shinLen: 0.49, spineLen: 0.15, chestLen: 0.2, neckOff: 0.18, neckLen: 0.14, headR: 0.098, shoulderW: 0.16, uarmLen: 0.4, farmLen: 0.41, handLen: 0.23, headZ: -0.015 });
  const ash = color(0x5c5a68);
  const ashen = (p, n, c) => {
    if (fbm3(p.x * 16, p.y * 16, p.z * 16, 2, 9) > 0.6) c.lerp(ash, 0.55);
  };
  const L = {
    skin: 0x34323b, skinRegion: CR.SKIN, gaunt: 1, ribs: 1, armR: 0.031, thighR: 0.056, neckR: 0.033, chestR: 0.138,
    shirt: null, pants: { color: 0x131317, region: CR.CLOTH, tearY: 0.55 }, belt: false, shoes: null, hair: null,
    eye: 0xe6eeff, eyeGlow: 1.3, nose: 0, fingerMul: 1.7, claws: 0.06, curl: 0.8, headSX: 0.8, headSY: 1.14, jawScale: 1.15,
    fang: true, missingTeeth: 0x24, blood: [], dirt: { y0: 0, k: 0 },
    torsoTint: ashen, armTint: ashen, headTint: (lx, ly, lz, c) => ashen({ x: lx * 0.08, y: ly * 0.11, z: lz * 0.1 }, null, c),
  };
  const mb = new MeshBuilder();
  const T = standardHumanoid(mb, P, L);
  const light = { rs: 3, color: 0x9db4ff, region: CR.GLOW, glow: 0.55, blood: false, ao: false, cap: false };
  const vein = (bone, pts, r = 0.0045) => mb.tube(bone, pts, r, r * 0.35, { ...light, ts: pts.length * 2 });
  // on the chest surface: a = angle around the body (0 = sternum), y above the chest bone
  const onChest = (a, y) => {
    const r = profR(T.chestProf, y) + 0.004;
    return [Math.sin(a) * r * T.sxC, y, -Math.cos(a) * r * T.szC];
  };
  vein('chest', [onChest(0.06, -0.08), onChest(-0.05, 0.0), onChest(0.04, 0.08), onChest(-0.02, T.top * 0.7)], 0.006);
  for (const s of [-1, 1]) {
    vein('chest', [onChest(s * 0.05, 0.07), onChest(s * 0.45, 0.11), onChest(s * 0.85, 0.09), onChest(s * 1.2, 0.13)]);
    vein('chest', [onChest(s * 0.05, -0.01), onChest(s * 0.5, -0.04), onChest(s * 0.95, -0.02)]);
    const n = s < 0 ? 'L' : 'R';
    const ra = L.armR * 0.92 + 0.003;
    vein('uarm' + n, [[s * 0.004, -0.05, -ra], [-s * 0.006, -0.17, -ra * 1.04], [s * 0.005, -0.29, -ra * 0.92], [0, -P.uarmLen + 0.02, -ra * 0.85]]);
    const rf = L.armR * 0.7 + 0.003;
    vein('farm' + n, [[0, -0.04, -rf], [s * 0.006, -0.16, -rf * 0.95], [-s * 0.004, -0.28, -rf * 0.8], [0, -P.farmLen + 0.03, -rf * 0.7]]);
    // tear tracks of light running down from the eyes
    const hr = P.headR, cy = hr * 0.9, sx = hr * L.headSX, fz = -hr * 1.06 * 0.9;
    vein('head', [[s * sx * 0.42, cy - hr * 0.02, fz * 1.0], [s * sx * 0.55, cy - hr * 0.32, fz * 0.93], [s * sx * 0.5, cy - hr * 0.62, fz * 0.74]], 0.004);
  }
  // spine: a ridge of bone spurs down the back
  for (let i = 0; i < 5; i++) {
    const y = -0.05 + i * 0.055;
    const zb = profR(T.chestProf, y) * T.szC * 0.92;
    mb.spike('chest', [0, y, zb - 0.012], [0, y + 0.035, zb + 0.05 + (i === 2 ? 0.02 : 0)], 0.014, { rs: 4, color: 0x24232a, region: CR.BONE, mottle: 0.2, blood: false });
  }
  // rags hanging from the waist
  const rnd = mulberry32(4107);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rnd() * 0.4;
    const len = 0.22 + rnd() * 0.26;
    mb.box('hips', [Math.sin(a) * 0.14, 0.03 - len * 0.5, Math.cos(a) * 0.11], [0.035 + rnd() * 0.03, len, 0.006], { rot: [rnd() * 0.2 - 0.1, a, rnd() * 0.2 - 0.1], color: 0x0b0b0e, region: CR.CLOTH, mottle: 0.2, blood: false });
  }
  return { mb, P, A: { jawHang: 0.5 } };
}

function buildBoomer() {
  const P = humanP({ hipY: 0.88, hipW: 0.13, thighLen: 0.4, shinLen: 0.4, spineLen: 0.14, chestLen: 0.22, neckOff: 0.2, neckLen: 0.06, headR: 0.12, shoulderW: 0.27, uarmLen: 0.28, farmLen: 0.26, handLen: 0.17 });
  const L = {
    skin: 0xa8a468, skinRegion: CR.SKIN, gaunt: 0, ribs: 0, wide: 1.35, chestR: 0.2, chestD: 1.25, armR: 0.07, thighR: 0.12, neckR: 0.09, deltoid: 1.5, farmMul: 0.9, wristMul: 0.65,
    hipsW: 1.25, hipsD: 1.3, handScale: 1.15, footW: 1.3,
    shirt: { color: 0x8a8870, region: CR.CLOTH, sleeves: 0, tear: 0.5, seed: 171, type: 'tank', hem: -0.1, thick: 1.05 },
    pants: { color: 0x3b3a30, region: CR.CLOTH, tearY: 0.2 },
    shoes: null, eye: 0xd8d880, eyeGlow: 0.15, socket: 0.14, headSX: 0.92, jawScale: 1.1,
    blood: [[[0, 1.5, -0.2], 0.15, 0.7]],
    lumpy: true,
    torsoTint(p, n, c) {
      const m = fbm3(p.x * 8, p.y * 8, p.z * 8, 2, 21);
      if (m > 0.6) c.lerp(color(0x6a7a30), 0.5);
      if (m < 0.3) c.lerp(color(0x7a4a50), 0.3);
    },
  };
  const mb = new MeshBuilder();
  standardHumanoid(mb, P, L);
  // bloated belly (own bone for pulsing)
  mb.addBone('belly', 'spine', 0, P.spineY + 0.02, -0.08);
  mb.ellip('belly', [0, 0, -0.06], [0.36, 0.34, 0.33], {
    ws: 14, hs: 10, color: 0xb0a860, region: CR.SKIN, noise: 0.018, nf: 12, mottle: 0.3,
    tint(p, n, c) {
      const m = fbm3(p.x * 9, p.y * 9, p.z * 9, 2, 8);
      if (m > 0.58) c.lerp(color(0x5a7a28), 0.55);
      c.lerp(color(0x6a3a3a), clamp(0.2 - n.y * 0.25, 0, 0.35));
    },
  });
  mb.ellip('chest', [0, 0.02, 0.04], [0.3, 0.26, 0.26], { ws: 12, hs: 8, color: 0xa8a468, region: CR.SKIN, noise: 0.015, nf: 12, torso: true });
  // neck fat roll
  mb.lathe('neck', [0, 0, 0], [[0.1, -0.06], [0.14, 0.0], [0.13, 0.05], [0.09, 0.08]], { rs: 10, sx: 1.2, color: 0xa8a468, region: CR.SKIN });
  // pustules: swollen blisters facing out of the skin, pale shiny cap over an inflamed rim
  const rnd = mulberry32(99);
  const C_RIM = color(0x8a3024);
  const blister = (bone, c, nrm, r, cap) => {
    const nv = new THREE.Vector3(nrm[0], nrm[1], nrm[2]).normalize();
    mb.ellip(bone, c, [r, r, r * 0.62], {
      ws: 7, hs: 5, color: cap, region: CR.GLOW, glow: 0.12, mottle: 0.15, blood: false,
      q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), nv),
      tint(p, n, cc) {
        cc.lerp(C_RIM, clamp((0.75 - (n.x * nv.x + n.y * nv.y + n.z * nv.z)) * 1.6, 0, 0.85));
      },
    });
  };
  for (let i = 0; i < 7; i++) {
    const a = (rnd() - 0.5) * 2.8, y = (rnd() - 0.5) * 0.5;
    const r = 0.025 + rnd() * 0.04;
    const k = Math.sqrt(1 - (y / 0.36) ** 2 * 0.5);
    const x = Math.sin(a) * 0.36 * k, z = -Math.cos(a) * 0.33 * k - 0.06;
    blister('belly', [x, y, z], [x / 0.36, y / 0.34, (z + 0.06) / 0.33], r, rnd() < 0.5 ? 0xc8c070 : 0xb8b468);
  }
  for (let i = 0; i < 5; i++) {
    const a = (rnd() - 0.5) * 3.5, y = 0.05 + rnd() * 0.2, r = 0.02 + rnd() * 0.025;
    const x = Math.sin(a) * 0.3, z = -Math.cos(a) * 0.25;
    blister('chest', [x, y, z], [x / 0.3, 0.2, z / 0.25], r, 0xb8b060);
  }
  return { mb, P };
}

/** Heavy muscular arm (tank/boss): deltoid, bulging bicep, huge forearm. */
function bruteArm(mb, P, s, o) {
  const n = s < 0 ? 'L' : 'R';
  const sy = P.shoulderY - P.chestY;
  const col = o.skin, reg = o.region ?? CR.GORE;
  mb.ellip('chest', [s * (P.shoulderW - o.ur * 0.2), sy + o.ur * 0.15, 0], [o.ur * 1.25, o.ur * 1.15, o.ur * 1.25], { ws: 10, hs: 8, color: col, region: reg, noise: o.ur * 0.06, nf: 6, tint: o.tint });
  mb.seg('uarm' + n, [0, 0.0, 0], [0, -P.uarmLen, 0], o.ur, o.ur * 0.8, {
    rs: 10, hs: 6, color: col, region: reg, noise: o.ur * 0.05, nf: 7, tint: o.tint,
    prof: (t) => 1 + 0.2 * Math.sin(Math.min(1, t * 1.3) * PI),
  });
  mb.seg('farm' + n, [0, 0.03, 0], [0, -P.farmLen + 0.02, 0], o.fr, o.fr * 0.72, {
    rs: 10, hs: 6, color: col, region: reg, noise: o.fr * 0.05, nf: 7, tint: o.tint,
    prof: (t) => 1 + 0.32 * Math.exp(-(((t - 0.3) / 0.25) ** 2)),
  });
}

function buildTank() {
  const P = humanP({
    hipY: 1.0, hipW: 0.22, thighLen: 0.46, shinLen: 0.45, spineLen: 0.3, chestLen: 0.45, neckOff: 0.5, neckLen: 0.08,
    headR: 0.15, shoulderW: 0.62, shoulderDrop: 0.06, uarmLen: 0.8, farmLen: 0.78, handLen: 0.3, headZ: -0.3, neckZ: -0.18, depth: 0.42,
  });
  const skin = 0x8a7c76;
  const torsoTint = (p, n, c) => {
    const m = fbm3(p.x * 5, p.y * 5, p.z * 5, 2, 31);
    if (m > 0.62) c.lerp(color(0x5a1a14), 0.55);
    if (m < 0.33) c.lerp(color(0x5a5a6a), 0.35);
  };
  const L = {
    skin, skinRegion: CR.GORE, gaunt: 0, ribs: 0, wide: 2.1, chestR: 0.31, chestD: 1.35, waistW: 0.82, bellyD: 1.3,
    thighR: 0.24, neckR: 0.2, noDeltoid: true, hipsW: 1.6, hipsD: 1.5, footW: 1.9, footL: 1.5,
    pants: { color: 0x2a303a, region: CR.DENIM, tearY: 0.55 }, belt: false,
    shoes: null, eye: 0xff6020, eyeGlow: 0.8, jawScale: 1.35, fang: true, headSX: 1.05, nose: 0.3,
    blood: [[[0, 2.2, -0.35], 0.3, 0.8], [[0.45, 1.8, -0.3], 0.25, 0.6]],
    wounds: [[-0.35, 1.45, -0.3, 0.14], [0.3, 1.9, 0.35, 0.16]],
    torsoTint, dirt: { y0: 0.6, k: 0.6 },
  };
  const mb = new MeshBuilder();
  addHumanoidBones(mb, P);
  addBlood(mb, L);
  buildTorso(mb, P, L);
  buildHead(mb, P, L);
  buildLegs(mb, P, L);
  const sy = P.shoulderY - P.chestY;
  // hump + trapezius mass rising behind the sunken head
  mb.ellip('chest', [0, sy + 0.05, 0.2], [0.62, 0.5, 0.46], { ws: 14, hs: 10, color: skin, region: CR.GORE, noise: 0.05, nf: 4, mottle: 0.3, tint: torsoTint });
  mb.ellip('chest', [0, sy - 0.28, -0.16], [0.52, 0.3, 0.26], { ws: 12, hs: 8, color: skin, region: CR.GORE, noise: 0.025, nf: 6, tint: torsoTint }); // pecs
  mb.ellip('spine', [0, 0.1, -0.1], [0.46, 0.34, 0.36], { ws: 12, hs: 8, color: skin, region: CR.GORE, noise: 0.03, nf: 6, tint: torsoTint }); // gut
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    bruteArm(mb, P, s, { skin, ur: 0.22, fr: 0.25, tint: torsoTint });
    // fist + knuckles
    mb.box('hand' + n, [0, -0.14, 0], [0.3, 0.28, 0.32], { round: 0.6, seg: 2, color: mulColor(skin, 0.9), region: CR.GORE });
    for (let k = 0; k < 4; k++) mb.ellip('hand' + n, [-s * 0.02, -0.27, -0.12 + k * 0.08], [0.07, 0.05, 0.045], { ws: 6, hs: 4, color: mulColor(skin, 0.75), region: CR.GORE });
    // bone shards
    mb.spike('farm' + n, [s * 0.18, -0.25, 0.12], [s * 0.36, -0.12, 0.3], 0.055, { color: 0xd8ccb0, region: CR.BONE });
    mb.spike('farm' + n, [s * 0.16, -0.45, 0.14], [s * 0.3, -0.36, 0.34], 0.045, { color: 0xd8ccb0, region: CR.BONE });
    mb.spike('chest', [s * 0.5, sy + 0.25, 0.25], [s * 0.7, sy + 0.55, 0.45], 0.06, { color: 0xd8ccb0, region: CR.BONE });
  }
  // spine ridge spikes on hump
  for (let i = 0; i < 5; i++) {
    const y = sy - 0.25 + i * 0.13;
    mb.spike('chest', [0, y, 0.5 - i * 0.02], [0, y + 0.12, 0.75 - i * 0.02], 0.05, { color: 0xd8ccb0, region: CR.BONE });
  }
  return { mb, P };
}

function buildAbomination() {
  const P = humanP({
    hipY: 1.5, hipW: 0.32, thighLen: 0.72, shinLen: 0.68, spineLen: 0.42, chestLen: 0.6, neckOff: 0.72, neckLen: 0.14,
    headR: 0.3, shoulderW: 0.9, shoulderDrop: 0.08, uarmLen: 1.05, farmLen: 1.0, handLen: 0.5, headZ: -0.42, neckZ: -0.22, depth: 0.6,
  });
  const skin = 0x8e6c64;
  const torsoTint = (p, n, c) => {
    const m = fbm3(p.x * 2.5, p.y * 2.5, p.z * 2.5, 3, 41);
    if (m > 0.6) c.lerp(color(0x8a1a18), 0.6);
    if (m < 0.34) c.lerp(color(0x5a5268), 0.4);
  };
  const L = {
    skin, skinRegion: CR.GORE, gaunt: 0.3, ribs: 0, wide: 2.9, chestR: 0.36, chestD: 1.55, waistW: 0.78, bellyD: 1.35,
    thighR: 0.32, neckR: 0.28, noDeltoid: true, hipsW: 2.3, hipsD: 2.0, footW: 2.8, footL: 2.3, shoes: null,
    eye: 0xff3010, eyeGlow: 1, jawScale: 1.55, fang: true, headSX: 0.95, nose: 0.2,
    handScale: 3.0, fingerMul: 1.5, claws: 0.13, curl: 0.55, lumpy: true,
    blood: [[[0, 3.4, -0.6], 0.5, 0.9], [[0.5, 2.6, -0.6], 0.45, 0.8], [[-0.6, 2.1, -0.5], 0.4, 0.8]],
    wounds: [[0.75, 2.45, -0.3, 0.35], [-0.3, 2.0, -0.55, 0.25], [0.2, 2.9, 0.6, 0.3]],
    torsoTint, dirt: { y0: 0.9, k: 0.6 },
  };
  const mb = new MeshBuilder();
  addHumanoidBones(mb, P);
  addBlood(mb, L);
  buildTorso(mb, P, L);
  buildHead(mb, P, L);
  buildLegs(mb, P, L);
  const sy = P.shoulderY - P.chestY;
  const hr = P.headR;
  // extra glowing eyes
  for (const [x, y] of [[-0.12, 1.3], [0.14, 1.28], [0.0, 1.45]]) {
    mb.ellip('head', [x * hr * 3, hr * y, -hr * 0.82], [hr * 0.07, hr * 0.06, hr * 0.05], { ws: 5, hs: 3, color: 0xff4020, glow: 1, region: CR.PLAIN, ao: false, blood: false, mottle: 0 });
  }
  // colossal hunched back mass
  mb.ellip('chest', [0.05, sy - 0.05, 0.32], [0.95, 0.72, 0.62], { ws: 16, hs: 12, color: skin, region: CR.GORE, noise: 0.08, nf: 2.5, mottle: 0.3, tint: torsoTint });
  mb.ellip('chest', [0, sy - 0.42, -0.22], [0.72, 0.42, 0.38], { ws: 12, hs: 8, color: skin, region: CR.GORE, noise: 0.04, nf: 4, tint: torsoTint });
  mb.ellip('spine', [0, 0.1, -0.12], [0.66, 0.5, 0.52], { ws: 12, hs: 9, color: mulColor(skin, 1.05), region: CR.GORE, noise: 0.05, nf: 3, tint: torsoTint });
  // exposed ribcage on the right flank
  for (let i = 0; i < 5; i++) {
    const y = -0.45 + i * 0.11;
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const a = 0.35 + k * 0.28;
      pts.push([Math.sin(a) * 0.72, y - k * 0.02, -Math.cos(a) * 0.58]);
    }
    mb.tube('chest', pts, 0.035, 0.026, { rs: 5, ts: 6, color: 0xd6c8a8, region: CR.BONE, blood: false, cap: false });
  }
  // flesh growth cluster on the left shoulder
  const rnd = mulberry32(4242);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * PI - PI * 0.2;
    const r = 0.18 + rnd() * 0.16;
    mb.ellip('chest', [-0.75 + Math.cos(a) * 0.25, sy + 0.15 + rnd() * 0.35, Math.sin(a) * 0.3 + 0.1], [r, r * 0.9, r], { ws: 8, hs: 6, color: 0xb08878, region: CR.TUMOR, noise: r * 0.12, nf: 10 });
  }
  // glowing weak spots on the back and the growth
  for (let i = 0; i < 6; i++) {
    const a = (rnd() - 0.5) * 2.4, y = sy - 0.3 + rnd() * 0.6;
    mb.ellip('chest', [Math.sin(a) * 0.9, y, Math.cos(a) * 0.6 + 0.3], [0.08, 0.08, 0.06], { ws: 7, hs: 5, color: 0xffa040, glow: 1, region: CR.GLOW, blood: false, ao: false });
  }
  // bone spikes along the back (two rows)
  for (let i = 0; i < 8; i++) {
    const sd = i % 2 ? 1 : -1;
    const x = sd * (0.2 + rnd() * 0.25), y = sy - 0.5 + i * 0.12;
    mb.spike('chest', [x, y, 0.75], [x * 1.4, y + 0.35 + rnd() * 0.2, 1.25 + rnd() * 0.25], 0.08, { color: 0xd6c8a8, region: CR.BONE, rs: 5 });
  }
  // massive arms with clawed hands
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    bruteArm(mb, P, s, { skin, ur: s > 0 ? 0.28 : 0.24, fr: s > 0 ? 0.3 : 0.25, tint: torsoTint });
    buildHand(mb, 'hand' + n, s, P, { ...L, skin: mulColor(skin, 0.85), handScale: s > 0 ? 3.4 : 2.8 });
    mb.spike('uarm' + n, [s * 0.2, -0.1, 0.12], [s * 0.4, 0.15, 0.35], 0.06, { color: 0xd6c8a8, region: CR.BONE });
  }
  // withered extra arms from the lower chest: xarm -> xfarm
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    const sy2 = P.chestY - 0.3;
    mb.addBone('xarm' + n, 'chest', s * 0.55, sy2, -0.35);
    mb.addBone('xfarm' + n, 'xarm' + n, s * 0.55, sy2 - 0.55, -0.35);
    mb.seg('xarm' + n, [0, 0.05, 0], [0, -0.55, 0], 0.08, 0.06, { rs: 7, color: 0x9a7a70, region: CR.GORE });
    mb.seg('xfarm' + n, [0, 0.02, 0], [0, -0.5, 0], 0.06, 0.045, { rs: 7, color: 0x9a7a70, region: CR.GORE });
    for (let f = 0; f < 3; f++) {
      mb.spike('xfarm' + n, [0, -0.48, (f - 1) * 0.04], [-s * 0.05, -0.72, (f - 1) * 0.07 - 0.05], 0.022, { rs: 4, color: 0x2a2016, region: CR.BONE });
    }
  }
  // belly mouth with teeth
  mb.ellip('spine', [0, 0.05, -0.62], [0.3, 0.1, 0.1], { ws: 8, hs: 5, color: C_MOUTH, region: CR.FLESH, blood: false });
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 0.075;
    mb.spike('spine', [x, 0.13, -0.66], [x, 0.03, -0.69], 0.022, { rs: 4, color: C_TEETH, region: CR.BONE, blood: false });
    mb.spike('spine', [x + 0.035, -0.03, -0.66], [x + 0.035, 0.07, -0.69], 0.02, { rs: 4, color: C_TEETH, region: CR.BONE, blood: false });
  }
  return { mb, P };
}

function buildHiveQueen() {
  const P = humanP({
    hipY: 1.4, hipW: 0.16, thighLen: 0.68, shinLen: 0.64, spineLen: 0.34, chestLen: 0.42, neckOff: 0.4, neckLen: 0.26,
    headR: 0.24, shoulderW: 0.4, shoulderDrop: 0.08, uarmLen: 0.82, farmLen: 0.86, handLen: 0.34, headZ: -0.06, depth: 0.3,
  });
  const chit = 0x3a4030;
  const L = {
    skin: 0x56604a, skinRegion: CR.SKIN, gaunt: 0.8, ribs: 0.8, wide: 1.5, chestR: 0.2, chestD: 1.1, waistW: 0.6,
    armR: 0.06, farmMul: 0.9, wristMul: 0.55, thighR: 0.1, neckR: 0.07, deltoid: 1.3, handScale: 1.8, fingerMul: 1.8, claws: 0.12, curl: 0.35,
    hipsW: 1.1, footW: 1.2, footL: 1.4, shoes: null,
    eye: 0x80ff40, eyeGlow: 1, socket: 0.28, headSX: 0.8, headSY: 0.95, headSZ: 1.6, jawScale: 1.2, fang: true, nose: 0,
    headTint(lx, ly, lz, c) {
      if (lz > 0.2) c.lerp(color(chit), 0.6);
    },
    blood: [[[0, 3.0, -0.3], 0.2, 0.5]],
    dirt: { y0: 0.5, k: 0.5 },
  };
  const mb = new MeshBuilder();
  mb.bloodColor = color(0x2a4a08);
  addHumanoidBones(mb, P);
  addBlood(mb, L);
  buildTorso(mb, P, L);
  buildHead(mb, P, L);
  buildArms(mb, P, L);
  buildLegs(mb, P, L);
  const hr = P.headR;
  // elongated crest on the head
  mb.ellip('head', [0, hr * 1.25, hr * 0.9], [hr * 0.5, hr * 0.55, hr * 1.4], { ws: 10, hs: 7, color: chit, region: CR.CHITIN, rot: [0.45, 0, 0] });
  for (const s of [-1, 1]) mb.spike('head', [s * hr * 0.5, hr * 1.2, hr * 0.6], [s * hr * 1.2, hr * 1.9, hr * 1.9], 0.03, { color: chit, region: CR.CHITIN });
  // mandibles
  for (const s of [-1, 1]) mb.tube('jaw', [[s * hr * 0.4, 0, -hr * 0.5], [s * hr * 0.6, -hr * 0.3, -hr * 1.0], [s * hr * 0.25, -hr * 0.35, -hr * 1.35]], 0.025, 0.006, { rs: 5, ts: 4, color: 0x2a2a20, region: CR.CHITIN });
  // chitin shoulder plates
  for (const s of [-1, 1]) mb.ellip('chest', [s * 0.36, P.shoulderY - P.chestY + 0.08, 0.02], [0.2, 0.1, 0.18], { ws: 8, hs: 6, color: chit, region: CR.CHITIN, rot: [0, 0, s * 0.4] });
  mb.ellip('chest', [0, 0.1, 0.12], [0.32, 0.4, 0.2], { ws: 10, hs: 8, color: chit, region: CR.CHITIN });
  // blade forearms
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    mb.spike('farm' + n, [0, -0.1, 0.05], [s * 0.02, 0.35, 0.2], 0.05, { color: chit, region: CR.CHITIN });
  }
  // abdomen egg sac (own bone, child of hips): bulbous, tilted up behind the queen
  mb.addBone('abdomen', 'hips', 0, P.hipY + 0.08, 0.22);
  const ab = mb.bonePos('abdomen');
  const tilt = -0.35, ac = [0, 0.18, 0.78];
  const ca = Math.cos(-tilt), sa = Math.sin(-tilt);
  mb.ellip('abdomen', ac, [0.58, 0.52, 0.9], {
    ws: 16, hs: 12, color: 0x8aff58, region: CR.GLOW, glow: 0.6, noise: 0.035, nf: 5, mottle: 0.3, rot: [tilt, 0, 0],
    tint(p, n, c) {
      // local coords along the sac axis -> dark chitin bands + mottled patches
      const y = p.y - ab[1] - ac[1], z = p.z - ab[2] - ac[2];
      const lz = z * ca - y * sa;
      const band = Math.abs(Math.sin(lz * 5.2 + 0.4));
      if (band < 0.22) c.lerp(color(0x1e2418), 0.9);
      const m = fbm3(p.x * 6, p.y * 6, p.z * 6, 2, 3);
      c.lerp(color(0x2a3a1a), clamp((m - 0.5) * 2.5, 0, 0.7));
      if (n.y > 0.5) c.lerp(color(0x2e3424), 0.5); // armored top
    },
  });
  mb.ellip('abdomen', [0, 0.0, 0.08], [0.24, 0.24, 0.3], { ws: 8, hs: 6, color: chit, region: CR.CHITIN });
  // egg nodules
  const ern = mulberry32(606);
  for (let i = 0; i < 9; i++) {
    const a = (ern() - 0.5) * 2.4, lz = 0.3 + ern() * 0.9;
    const x = Math.sin(a) * 0.5, y = -Math.cos(a) * 0.3 + 0.1;
    mb.ellip('abdomen', [x, y + (lz - 0.3) * 0.35, lz + 0.3], [0.08, 0.08, 0.08], { ws: 6, hs: 4, color: 0xc8ff90, glow: 0.8, region: CR.GLOW, ao: false, blood: false });
  }
  // 4 spindly spider legs from the back: sleg{i} (upper) -> slegb{i} (lower)
  const legs = [
    [-1, 0.0], [1, 0.0], [-1, 0.25], [1, 0.25],
  ];
  for (let i = 0; i < 4; i++) {
    const [s, zo] = legs[i];
    const by = P.chestY - 0.05 - zo * 0.8, bz = 0.2 + zo;
    mb.addBone('sleg' + i, 'chest', s * 0.2, by, bz);
    const kx = s * 0.95, ky = by + 0.75, kz = bz + 0.35 + zo;
    mb.addBone('slegb' + i, 'sleg' + i, kx, ky, kz);
    mb.seg('sleg' + i, [0, 0, 0], [kx - s * 0.2, ky - by, kz - bz], 0.06, 0.04, { rs: 6, hs: 2, color: chit, region: CR.CHITIN });
    mb.ellip('slegb' + i, [0, 0, 0], [0.065, 0.065, 0.065], { ws: 6, hs: 4, color: chit, region: CR.CHITIN });
    const fx = s * 0.55, fy = -ky + 0.02, fz = 0.25 + zo * 1.5;
    mb.seg('slegb' + i, [0, 0, 0], [fx, fy, fz], 0.045, 0.012, { rs: 6, hs: 2, color: 0x2a3020, region: CR.CHITIN });
  }
  return { mb, P };
}

// ------------------------------------------------------------------ bat
function buildBat() {
  const mb = new MeshBuilder();
  mb.addBone('root', null, 0, 0, 0);
  mb.addBone('body', 'root', 0, 0, 0);
  mb.addBone('head', 'body', 0, 0.03, -0.13);
  mb.addBone('jaw', 'head', 0, -0.01, -0.03);
  const fur = 0x2a2220, skin = 0x3a2a2a, mem = 0x5a3a36;
  mb.ellip('body', [0, 0, 0.02], [0.07, 0.065, 0.14], { ws: 7, hs: 5, color: fur, region: CR.HAIR, noise: 0.006, nf: 40 });
  mb.ellip('body', [0, -0.01, 0.15], [0.045, 0.04, 0.075], { ws: 5, hs: 4, color: fur, region: CR.HAIR });
  // head: snout, ears, glowing eyes, fangs
  mb.ellip('head', [0, 0.01, -0.02], [0.058, 0.052, 0.062], { ws: 7, hs: 5, color: fur, region: CR.HAIR });
  mb.ellip('head', [0, -0.005, -0.075], [0.03, 0.025, 0.04], { ws: 5, hs: 3, color: skin, region: CR.MEMBRANE });
  for (const s of [-1, 1]) {
    mb.spike('head', [s * 0.03, 0.04, -0.01], [s * 0.07, 0.14, 0.02], 0.025, { rs: 4, color: skin, region: CR.MEMBRANE });
    mb.ellip('head', [s * 0.025, 0.02, -0.065], [0.011, 0.011, 0.008], { ws: 4, hs: 3, color: 0xff2010, glow: 1, region: CR.PLAIN, ao: false, mottle: 0 });
    mb.spike('jaw', [s * 0.012, 0.0, -0.06], [s * 0.012, -0.03, -0.062], 0.005, { rs: 4, color: 0xe8e0c8, region: CR.BONE });
  }
  mb.ellip('jaw', [0, -0.012, -0.04], [0.024, 0.01, 0.035], { ws: 5, hs: 3, color: 0x3a0a0a, region: CR.FLESH });
  // wings: w1 (arm) -> w2 (forearm) -> w3 (fingers); membranes attached per bone
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    mb.addBone('w1' + n, 'body', s * 0.06, 0.02, -0.04);
    mb.addBone('w2' + n, 'w1' + n, s * 0.24, 0.03, -0.02);
    mb.addBone('w3' + n, 'w2' + n, s * 0.44, 0.02, 0.02);
    mb.seg('w1' + n, [0, 0, 0], [s * 0.18, 0.01, 0.02], 0.016, 0.012, { rs: 4, hs: 1, color: skin, region: CR.MEMBRANE });
    mb.seg('w2' + n, [0, 0, 0], [s * 0.2, -0.01, 0.04], 0.012, 0.008, { rs: 4, hs: 1, color: skin, region: CR.MEMBRANE });
    // claw thumb
    mb.spike('w2' + n, [s * 0.2, 0, 0.04], [s * 0.23, 0.02, -0.02], 0.006, { rs: 4, color: 0x1a1410, region: CR.BONE });
    const fingers = [[0.18, -0.02, -0.02], [0.16, -0.01, 0.14], [0.06, 0.0, 0.24]];
    for (const f of fingers) mb.seg('w3' + n, [0, 0, 0], [s * f[0], f[1], f[2]], 0.007, 0.003, { rs: 4, hs: 1, color: skin, region: CR.MEMBRANE });
    // membranes (double sided flat meshes)
    const memb = (bone, poly) => {
      const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
      const g = new THREE.ShapeGeometry(shape, 2);
      g.rotateX(HALF); // XY -> XZ plane (y -> z)
      mb.geom(bone, g, { color: mem, region: CR.MEMBRANE, double: true, mottle: 0.25, keepNormals: false });
    };
    // coords: [x, z] in bone-relative space
    memb('w1' + n, orient(s, [[-0.02, -0.02], [0.2, -0.01], [0.21, 0.22], [0.12, 0.2], [0.03, 0.25], [-0.05, 0.2]]));
    memb('w2' + n, orient(s, [[-0.01, -0.01], [0.2, 0.02], [0.22, 0.26], [0.13, 0.19], [0.05, 0.27], [-0.01, 0.22]]));
    memb('w3' + n, orient(s, [[-0.01, 0.0], [0.18, -0.02], [0.16, 0.14], [0.1, 0.1], [0.06, 0.24], [0.02, 0.15], [-0.01, 0.22]]));
  }
  // legs + tail
  for (const s of [-1, 1]) {
    mb.seg('body', [s * 0.03, -0.03, 0.12], [s * 0.05, -0.05, 0.24], 0.012, 0.008, { rs: 4, color: skin, region: CR.MEMBRANE });
    mb.spike('body', [s * 0.05, -0.05, 0.24], [s * 0.05, -0.08, 0.26], 0.008, { rs: 4, color: 0x1a1410, region: CR.BONE });
  }
  mb.dirt = null;
  mb.aoStrength = 0.15;
  return { mb, P: null };
}

function orient(s, poly) {
  // ShapeGeometry lies in XY; rotateX(+90deg) maps y -> z. Mirror x for the left wing (keep CCW winding).
  const pts = poly.map(([x, z]) => [s * x, z]);
  if (s < 0) pts.reverse();
  return pts;
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
};
const VARIANTS = { [ZTYPE.WALKER]: WALKER_VARIANTS, [ZTYPE.RUNNER]: 3 };
const NO_EXTRAS = {};

const rigCache = new Map();
function getRig(type, variant) {
  const key = type + ':' + variant;
  let r = rigCache.get(key);
  if (!r) {
    const { mb, P, A } = BUILDERS[type](variant);
    r = mb.build();
    r.P = P;
    r.A = A || NO_EXTRAS; // per-variant animation quirks (e.g. dislocated jaw)
    r.type = type;
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
  if (type === ZTYPE.TANK) return tankSmash(z, p, u);
  if (type === ZTYPE.BOSS_ABOMINATION) return abomSweep(z, p, u);
  if (type === ZTYPE.BOSS_HIVEQUEEN) return queenSlash(z, p, u);
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

function poseHumanoid(z) {
  const p = z.pose;
  clearPose(p, z.nb);
  z.sacPulse = 0;
  z.bellyPulse = 0;
  z.abdPulse = 0;
  z.gOn = false;
  z.standOn = false;
  switch (z.state) {
    case ZANIM.WALK: poseLoco(z, p, false); break;
    case ZANIM.RUN: poseLoco(z, p, true); break;
    case ZANIM.ATTACK: poseAttack(z, p); break;
    case ZANIM.SPECIAL: poseSpecial(z, p); break;
    case ZANIM.AIRBORNE: poseAir(z, p); break;
    case ZANIM.STAGGER: poseStagger(z, p); break;
    case ZANIM.DEAD: poseDead(z, p); break;
    case ZANIM.EAT: poseEat(z, p); break;
    default: if (z.sub === 1) poseMenace(z, p); else poseIdle(z, p); break;
  }
  poseExtras(z, p);
  const jh = z.A ? z.A.jawHang : 0; // survivor zombie-mode state has no per-variant extras
  if (jh) A(p, JAW, -jh, 0, z.tilt * jh * 0.35); // dislocated jaw hangs open and askew
  const alive = z.state !== ZANIM.DEAD;
  if (alive && z.voxT < VOX[z.voxKind]?.dur) poseVocal(z, p);
  if (alive && z.state !== ZANIM.STAGGER && z.flinchT < 0.6) poseFlinch(z, p);
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
    R(p, X.body, 0.3 * k, 0, 2.6 * k * (z.seed & 1 ? 1 : -1));
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      R(p, side ? X.w1R : X.w1L, 0, 0, sg * (0.2 + 0.4 * k));
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
    const head = this.headless && !this.isBat ? this.X.head : -1;
    for (let i = 1; i < nb; i++) {
      const k = i * 4;
      const cx = Math.cos(p[k]), sx = Math.sin(p[k]);
      const cy = Math.cos(p[k + 1]), sy = Math.sin(p[k + 1]);
      const cz = Math.cos(p[k + 2]), sz = Math.sin(p[k + 2]);
      const s = i === head ? 0.001 : p[k + 3];
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
      this.fadeDur = anim === ZANIM.DEAD ? 0.12 : anim === ZANIM.STAGGER || thawed ? 0.1 : 0.25;
    }
    this.stateT += dt;
    this.fadeT += dt;
    this.flinchT += dt;
    this.voxT += dt;
    this.time = time;
    this.speed = speed;
    if (this.isBat) {
      this.flapPh += dt * (7 + clamp(speed, 0, 10) * 0.5) * this.rate * (this.state === ZANIM.ATTACK ? 0 : 1);
    } else if (anim !== ZANIM.DEAD) {
      const cyc = gaitLen(this, anim === ZANIM.RUN || (anim === ZANIM.ATTACK && sub === 2), speed);
      this.phase += (dt * speed * TAU * this.rate) / cyc;
      if (this.phase > 1e4) this.phase -= TAU * 1000;
    }
    if (this.hit > 0) {
      this.hit = Math.max(0, this.hit - dt * 5);
    }
    let glow = 1;
    if (this.type === ZTYPE.SPITTER || this.type === ZTYPE.BOSS_HIVEQUEEN) glow = 0.8 + 0.25 * Math.sin(time * 3.1 + this.off);
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
    return this.gOn && this.posedAt === this.time ? this.footfalls : -1;
  }

  setHeadless(v) {
    this.headless = !!v;
    this.applyPose(this.out, true);
  }

  dispose() {
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
  const type = BUILDERS[ztype] ? ztype : ZTYPE.WALKER;
  const nv = VARIANTS[type] || 1;
  const variant = nv > 1 ? ((seed >>> 0) * 2654435761 >>> 0) % nv : 0;
  const rig = getRig(type, variant);
  const cal = calibrate(type, getRig(type, 0));
  const z = new ZombieInstance(type, seed, rig, cal);
  z.wScale = z.gScale;
  return {
    object: z.object,
    update: (dt, anim, speed, time, inView) => z.update(dt, anim, speed, time, inView),
    flash: (a) => z.flash(a),
    hurt: () => z.hurt(),
    vocalize: (kind) => z.vocalize(kind),
    footfalls: () => z.footfallCount(),
    setHeadless: (v) => z.setHeadless(v),
    anchorWorld: (a, out) => z.anchorWorld(a, out),
    dispose: () => z.dispose(),
    _inst: z,
  };
}

/** Debug info for the sandbox: triangle counts + calibration per type/variant. */
export function modelStats() {
  const out = [];
  for (const t of Object.values(ZTYPE)) {
    const nv = VARIANTS[t] || 1;
    for (let v = 0; v < nv; v++) {
      const r = getRig(t, v);
      out.push({ type: t, variant: v, tris: r.tris, bones: r.bones.length, cal: calibrate(t, getRig(t, 0)) });
    }
  }
  for (let v = 0; v < SURVIVOR_LOOKS; v++) {
    out.push({ type: 'survivor', variant: v, tris: getSurvivorRig(v, false).tris });
    out.push({ type: 'survivor-z', variant: v, tris: getSurvivorRig(v, true).tris });
  }
  return out;
}

// ======================================================================= SURVIVOR
const SURVIVOR_LOOKS = 10;
const JACKETS = [0x4a5236, 0x5a4330, 0x283246, 0x55585a, 0x3d4a3a, 0x6a5238, 0x2a2e36, 0x5a2a26, 0x4a4a3e, 0x33413f];
const SPANTS = [0x2f3d55, 0x4a4234, 0x262626, 0x3e4a3a, 0x3a3f4a];
const SKIN_TONES = [0xd8b090, 0xc09070, 0x8a5a3e, 0x5a3a28, 0xe0bca0, 0xb08060];

function survivorLook(v, zombie) {
  const rnd = mulberry32(5000 + v * 131);
  const skinH = SKIN_TONES[v % SKIN_TONES.length];
  const zskin = color(skinH).lerp(color(0x8a9a80), 0.75).getHex();
  const jacket = JACKETS[v % JACKETS.length];
  const headwear = ['beanie', 'cap', 'hair', 'hood', 'bald', 'hair', 'beanie', 'cap', 'hair', 'long'][v % 10];
  return {
    human: !zombie,
    skin: zombie ? zskin : skinH,
    skinRegion: zombie ? CR.GORE : CR.PLAIN,
    headRegion: zombie ? CR.SKIN : CR.PLAIN,
    gaunt: zombie ? 0.4 : 0,
    ribs: 0,
    socket: zombie ? 0.14 : 0.05,
    eye: zombie ? 0xff2a10 : 0xe8e4dc,
    eyeGlow: zombie ? 0.9 : 0,
    stubble: v % 3 === 0,
    chestR: 0.162,
    armR: 0.05,
    thighR: 0.082,
    shirt: {
      color: jacket, region: CR.CANVAS, sleeves: 2, tear: zombie ? 0.25 : 0, seed: 300 + v, thick: 1.1, hem: 0.0,
      open: false, rags: zombie ? 3 : 0, loose: 1.06,
      tint(p, n, c) {
        // zipper line + pockets
        if (Math.abs(p.x) < 0.012 && p.z < -0.08) c.multiplyScalar(0.55);
        if (zombie && fbm3(p.x * 9, p.y * 9, p.z * 9, 2, v) > 0.6) c.lerp(C_BLOOD, 0.7);
      },
    },
    pants: {
      color: SPANTS[v % SPANTS.length], region: v % 2 ? CR.DENIM : CR.CANVAS, tearY: zombie ? 0.3 : -1,
      tint: zombie ? (p, n, c) => { if (fbm3(p.x * 10, p.y * 10, p.z * 10, 2, v + 3) > 0.62) c.lerp(C_BLOOD, 0.6); } : null,
    },
    shoes: { color: v % 2 ? 0x2a2018 : 0x3a2c20 },
    hair: headwear === 'hair' || headwear === 'long' ? { color: HAIRC[(v + 1) % HAIRC.length], cover: 0.5, long: headwear === 'long', patchy: zombie ? 0.3 : 0 } : headwear === 'cap' ? { color: HAIRC[v % HAIRC.length], cover: 0.45 } : null,
    headwear,
    backpack: v % 3 !== 1,
    hands: zombie ? null : v % 2 ? 0x2a2622 : null, // gloves
    handCol: zombie ? zskin : v % 2 ? 0x2a2622 : skinH,
    handRegion: zombie ? CR.GORE : v % 2 ? CR.LEATHER : CR.PLAIN,
    claws: zombie ? 0.035 : 0,
    curl: zombie ? 0.8 : 0.9,
    fist: !zombie,
    blood: zombie ? [[[0, 1.52, -0.12], 0.12, 1], [[0.05, 1.3, -0.16], 0.16, 0.9], [[0.2, 0.85, 0.0], 0.12, 0.8]] : null,
    dirt: { y0: 0.35, k: zombie ? 0.6 : 0.35 },
    rnd,
  };
}

const survivorRigs = new Map();
function getSurvivorRig(v, zombie) {
  const key = v + (zombie ? 'z' : 'h');
  let r = survivorRigs.get(key);
  if (r) return r;
  const P = humanP({ hipY: 0.96, thighLen: 0.45, shinLen: 0.43, spineLen: 0.13, chestLen: 0.2, neckOff: 0.2, neckLen: 0.08, headR: 0.105, shoulderW: 0.19, uarmLen: 0.29, farmLen: 0.26, handLen: 0.17, depth: 0.13 });
  const L = survivorLook(v, zombie);
  const mb = new MeshBuilder();
  addHumanoidBones(mb, P);
  addBlood(mb, L);
  const T = buildTorso(mb, P, L);
  buildShirt(mb, P, L, T);
  buildHead(mb, P, L);
  hair(mb, P, L);
  buildArms(mb, P, L);
  buildLegs(mb, P, L);
  const hr = P.headR;
  const hw = L.headwear;
  const jc = L.shirt.color;
  // jacket collar
  mb.lathe('chest', [0, T.top - 0.03, 0.005], [[0.075, 0], [0.085, 0.03], [0.082, 0.06]], { rs: 10, sx: 1.25, sz: 1.1, color: mulColor(jc, 0.85), region: CR.CANVAS, double: true });
  // chest pockets
  for (const s of [-1, 1]) mb.box('chest', [s * 0.09, 0.04, -0.125], [0.08, 0.07, 0.02], { color: mulColor(jc, 0.9), region: CR.CANVAS, rot: [0.15, 0, 0] });
  if (hw === 'beanie') {
    mb.ellip('head', [0, hr * 1.0, 0.005], [hr * 0.93, hr * 0.9, hr * 1.0], { ws: 10, hs: 6, t0: 0, tl: PI * 0.52, color: [0x3a2a24, 0x2a3a4a, 0x4a4a4a][v % 3], region: CR.KNIT });
    mb.lathe('head', [0, hr * 0.92, 0.005], [[hr * 0.94, 0], [hr * 0.97, hr * 0.12], [hr * 0.93, hr * 0.24]], { rs: 10, sx: 0.9, sz: 1.08, color: [0x3a2a24, 0x2a3a4a, 0x4a4a4a][v % 3], region: CR.KNIT });
  } else if (hw === 'cap') {
    mb.ellip('head', [0, hr * 1.02, 0.01], [hr * 0.9, hr * 0.78, hr * 0.98], { ws: 10, hs: 6, t0: 0, tl: PI * 0.5, color: [0x3a4a30, 0x6a2a24, 0x2a2a2a][v % 3], region: CR.CANVAS });
    mb.box('head', [0, hr * 1.12, -hr * 1.1], [hr * 1.25, 0.01, hr * 0.62], { color: [0x3a4a30, 0x6a2a24, 0x2a2a2a][v % 3], region: CR.CANVAS, rot: [0.18, 0, 0] });
  } else if (hw === 'hood') {
    mb.ellip('head', [0, hr * 0.92, hr * 0.12], [hr * 1.15, hr * 1.18, hr * 1.22], {
      ws: 12, hs: 8, color: mulColor(jc, 0.9), region: CR.CANVAS, double: true,
      tear: { amt: 0, fn: (x, y, z) => z < -0.02 && y < P.headY + hr * 1.55 && y > P.headY - 0.08 && Math.abs(x) < hr * 0.8 },
    });
  }
  if (L.backpack) {
    const bc = [0x3a3a2a, 0x2a3040, 0x4a3a28][v % 3];
    mb.box('chest', [0, 0.02, 0.17], [0.3, 0.4, 0.15], { round: 0.3, seg: 2, color: bc, region: CR.CANVAS });
    mb.box('chest', [0, -0.06, 0.26], [0.22, 0.16, 0.06], { round: 0.3, seg: 2, color: mulColor(bc, 0.85), region: CR.CANVAS });
    mb.seg('chest', [-0.16, 0.25, 0.17], [0.16, 0.25, 0.17], 0.06, 0.06, { rs: 8, color: 0x5a4a30, region: CR.CANVAS, caps: 1 }); // bedroll
    for (const s of [-1, 1]) {
      mb.box('chest', [s * 0.11, 0.1, -0.12], [0.035, 0.26, 0.012], { color: 0x1e1e1a, region: CR.LEATHER, rot: [0.25, 0, 0] });
      mb.box('chest', [s * 0.12, 0.2, 0.0], [0.035, 0.012, 0.24], { color: 0x1e1e1a, region: CR.LEATHER });
    }
  }
  // belt pouch / holster
  mb.box('hips', [0.16, -0.02, 0.02], [0.05, 0.12, 0.09], { color: 0x2a2018, region: CR.LEATHER });
  r = mb.build();
  r.P = P;
  survivorRigs.set(key, r);
  return r;
}

// weapon holding categories
const HOLD_NONE = 0, HOLD_RIFLE = 1, HOLD_PISTOL = 2, HOLD_MELEE = 3, HOLD_THROW = 4;
function holdFor(item) {
  if (!item) return HOLD_NONE;
  const w = WEAPONS[item];
  if (w && !w.melee) return w.slot === 1 ? HOLD_PISTOL : HOLD_RIFLE;
  if (item === ITEM.MOLOTOV || item === ITEM.PIPEBOMB) return HOLD_THROW;
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
const MOUNT_POS = new THREE.Vector3(-0.025, -0.08, 0);
const _mountW = new THREE.Vector3();

class SurvivorInstance {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.look = this.seed % SURVIVOR_LOOKS;
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
    this.mount = new THREE.Object3D();
    this.mount.position.copy(MOUNT_POS);
    this.mount.rotation.set(-HALF, 0, 0);
    this.bones[HAND_R].add(this.mount);
    this.flashlightAnchor = new THREE.Object3D();
    this.flashlightAnchor.position.set(0.16, this.P.shoulderY - this.P.chestY + 0.02, -0.16);
    this.bones[CHEST].add(this.flashlightAnchor);
    this.headCenter = new THREE.Object3D();
    this.headCenter.position.set(0, this.P.headR * 0.9, 0);
    this.bones[HEAD].add(this.headCenter);
    this.object.userData.head = this.headCenter;
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
    this.airW = 0;
    this.runW = 0;
    this.reloadW = 0;
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
      this.mount.remove(this.weapon);
      this.weapon = null;
    }
    this.mount.rotation.set(this.hold === HOLD_MELEE ? 0 : -HALF, 0, 0);
    if (item && !this.zombie) {
      const w = createWorldWeapon(item);
      if (w) {
        this.weapon = w;
        this.mount.add(w);
        this.muzzle = w.getObjectByName('muzzle') || null;
        this.leftGrip = w.userData && w.userData.leftHand ? w.userData.leftHand : null;
      }
    }
  }

  setZombie(v) {
    v = !!v;
    if (v === this.zombie) return;
    this.zombie = v;
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
    this.crouchW += ((s.crouch ? 1 : 0) - this.crouchW) * k;
    this.airW += ((s.onGround === false ? 1 : 0) - this.airW) * (1 - Math.exp(-dt * 12));
    this.runW += ((s.sprint && speed > 4 ? 1 : 0) - this.runW) * k;
    this.reloadW += ((s.reloading ? 1 : 0) - this.reloadW) * k;
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
    // flashlight follows the full aim pitch (chest only carries part of it)
    const fl = this.flashlightAnchor;
    if (this.zombie || s.dead) fl.rotation.set(0, 0, 0);
    else fl.rotation.set(clamp(s.pitch || 0, -1.4, 1.4) - (o[HIPS * 4] + o[SPINE * 4] + o[CHEST * 4]), 0, 0);
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
    const baseT = cr * 0.95;
    const baseK = 0.06 + cr * 1.5;
    legCycle(z, p, ph, amp, knee, baseT, baseK, 0, 0.03);
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
    // head: rest of the pitch
    const cp = chestPitch(p);
    R(p, NECK, (pitch - cp) * 0.4, 0, 0);
    R(p, HEAD, (pitch - cp) * 0.6, 0, 0);
    // arms (FK baseline; IK overrides for held items)
    const aSw = mv * lerp(0.35, 0.8, run) * Math.sin(ph);
    arm(p, 0, 0.05 - aSw, 0.1, 0, 0.25 + run * 1.0 + 0.1 * mv, 0);
    arm(p, 1, 0.05 + aSw, 0.1, 0, 0.25 + run * 1.0 + 0.1 * mv, 0);
    if (air > 0.01) {
      A(p, UARM_L, 0.4 * air, 0, -0.3 * air);
      A(p, UARM_R, 0.4 * air, 0, 0.3 * air);
    }
    // throw pulse without IK hold
    if (this.hold === HOLD_NONE && this.pulseMelee < 0.4) {
      const u = this.pulseMelee / 0.4;
      arm(p, 1, 1.4 * Math.sin(u * PI), 0.2, 0, 0.4, 0);
    }
  }

  /** Two-bone IK for weapon holds, in chest space. */
  solveArms(s, time) {
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
      _grip.set(0.1, cy - 0.12, -0.24);
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
    _e.set(wx, wy, wz, 'YXZ');
    _qW.setFromEuler(_e);
    // hand orientation = weapon * mount^-1 ; wrist target = grip - Qh * mountPos
    _qH.copy(_qW).multiply(hold === HOLD_MELEE ? _qMountInvMelee : _qMountInvGun);
    _mountW.copy(MOUNT_POS).applyQuaternion(_qH);
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

  dispose() {
    this.skeleton.dispose();
    if (this.object.parent) this.object.parent.remove(this.object);
  }
}

const SURV_STYLE = Object.assign({}, ZS[ZTYPE.WALKER], { idleLean: 0, walkLean: -0.05, runLean: -0.2, limp: 0, headTilt: 0, jaw: 0 });

/** Create a survivor (player avatar). */
export function createSurvivor(seed = 0) {
  const sv = new SurvivorInstance(seed);
  return {
    object: sv.object,
    update: (dt, s) => sv.update(dt, s),
    setWeapon: (id) => sv.setWeapon(id),
    fire: () => sv.fire(),
    melee: () => sv.melee(),
    throwAnim: () => sv.throwAnim(),
    setZombie: (v) => sv.setZombie(v),
    getMuzzleWorld: (out) => sv.getMuzzleWorld(out),
    flashlightAnchor: sv.flashlightAnchor,
    flash: (a) => sv.flash(a),
    dispose: () => sv.dispose(),
    _inst: sv,
  };
}

export { SURVIVOR_LOOKS };
