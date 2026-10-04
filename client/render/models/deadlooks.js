// The dead who were people: the walkers' variants (who they were: the valley's farms, motels, hospital, roads and
// homes), and the specials' bodies, as looks for people.js. Every one is dead (L.dead): its skin and face rotting,
// its clothes torn and bloodied, its injuries its own.
import { color, fbm3, mulberry32 } from './skinning.js';
import { CR } from './charTextures.js';

// dead skin, from the pale and grey to the livid and the dark: everyone turned
const DEAD_SKINS = [0x9aa290, 0x8a9480, 0xa49c90, 0x7e8a74, 0x90887e, 0x6e6658, 0x5e5448, 0x9c9a7c, 0x887c84];
const C_BLOOD = color(0x3a0303);

const bloodied = (seed, k = 0.6, base = null) => (p, n, c) => {
  if (base) base(p, n, c);
  const m = fbm3(p.x * 8, p.y * 8, p.z * 8, 2, seed);
  if (m > 0.6) c.lerp(C_BLOOD, Math.min(1, (m - 0.6) * 4) * k);
  // grime up from the ground, and down the front from the mouth
  if (p.y < 0.6) c.multiplyScalar(1 - 0.35 * (0.6 - p.y));
};

// the injuries that change the silhouette and the face, so a crowd of walkers reads as people
const HURTS = [
  { cheekTear: -1 },
  { skullPatch: [0.5, 0.75, 0.25, 0.62] },
  { jawHang: 0.5, noEar: 1 },
  { oneEye: 1 },
  { missingArm: 'L' },
  { skullPatch: [-0.55, 0.6, -0.15, 0.55], noEar: -1 },
  { jawHang: 0.42, oneEye: -1 },
  { cheekTear: 1, missingArm: 'R' },
];

/** A walker's look by variant: who they were, how they died, how far gone they are. */
export function walkerLook(v) {
  const rnd = mulberry32(1000 + v * 7919);
  const skin = DEAD_SKINS[(v * 5 + 1) % DEAD_SKINS.length];
  const hurt = HURTS[v % HURTS.length];
  const base = {
    dead: true, skin, eye: rnd() < 0.5 ? 0xd0ccb0 : 0xa8a078, eyeGlow: 0.12,
    face: { sockets: 1.6, gaunt: 0.5 + rnd() * 0.4, rot: 0.5 + rnd() * 0.5, lips: 0.7 },
    gaunt: 0.25 + rnd() * 0.35, curl: 0.55 + rnd() * 0.3, missingTeeth: (rnd() * 255) | 0,
    blood: [[[0, 1.52, -0.1], 0.1, 1], [[(rnd() - 0.5) * 0.2, 1.25 + rnd() * 0.1, -0.14], 0.1 + rnd() * 0.06, 0.9], [[(rnd() - 0.5) * 0.3, 1.0, -0.12], 0.07, 0.8]],
    dirt: { y0: 0.55, k: 0.9 },
    ...hurt,
  };
  const pants = (c, r = CR.DENIM, extra = {}) => ({ color: c, region: r, tear: 0.14 + rnd() * 0.1, tearY: rnd() < 0.4 ? 0.12 + rnd() * 0.2 : undefined, tint: bloodied(v * 3 + 2, 0.5), ...extra });
  const top = (o) => ({ tear: 0.2 + rnd() * 0.15, tint: bloodied(v * 3 + 1, 0.7, o.tint), ...o });
  switch (v) {
    case 0: // a gaunt man in a torn grey tee and jeans, barefoot
      return { ...base, gaunt: 0.7, top: top({ kind: 'tee', color: 0x8a8a84, region: CR.COTTON, sleeves: 'short' }), pants: pants(0x3b4a63), hair: { style: 'patchy', color: 0x2a2018 } };
    case 1: // a woman in a cardigan over a dress
      return { ...base, sex: 'f', top: top({ kind: 'tee', color: 0x7a5a6a, region: CR.KNIT, sleeves: 'long', hem: 0.36, open: 0.3, under: { color: 0x9a8a70, region: CR.COTTON } }), pants: null, shoes: { kind: 'dress', color: 0x2a1a14 }, hair: { style: 'long', color: 0x4a3424, ragged: 0.15, length: 0.2 } };
    case 2: // shirtless, ribs and all, in work trousers
      return { ...base, gaunt: 0.95, top: null, pants: pants(0x4a4234, CR.TWILL), shoes: { kind: 'work', color: 0x3a2a1c }, hair: { style: 'balding', color: 0x6a6258 } };
    case 3: // a man in a flannel shirt hanging open over a vest
      return { ...base, top: top({ kind: 'flannel', color: 0x3a5a3a, region: CR.PLAID, sleeves: 'long', open: 0.4, under: { color: 0xb8b4a8, region: CR.COTTON }, collar: 'shirt' }), pants: pants(0x34466a), shoes: { kind: 'boot', color: 0x3a2a1c }, hair: { style: 'short', color: 0x3a2a1a }, beard: { style: 'short', color: 0x3a2a1a } };
    case 4: // a teenager in a hoodie, one arm gone
      return { ...base, build: { w: 0.92, arm: 0.9 }, top: top({ kind: 'hoodie', color: 0x3a4a5a, region: CR.FLEECE, sleeves: 'long', collar: 'hood', hem: 0.08 }), pants: pants(0x2a2a2a, CR.DENIM), shoes: { kind: 'sneaker', color: 0x8a8a84, sole: 0xb0aca4 }, hair: { style: 'short', color: 0x1e1610 } };
    case 5: // bloated: swollen and split, a stained undershirt, the skin gone green and purple
      return {
        ...base, gaunt: 0, build: { bloat: 0.75, belly: 0.9, neck: 1.2 }, skin: 0x9a9c6a, face: { ...base.face, gaunt: 0, w: 1.12, rot: 0.3 },
        top: top({ kind: 'tank', color: 0xb8b0a0, region: CR.COTTON, hem: -0.02 }), pants: pants(0x3a3a34, CR.TWILL), hair: { style: 'patchy', color: 0x1e1610 },
        skinTint: (p, n, c) => {
          const m = fbm3(p.x * 7, p.y * 7, p.z * 7, 2, 21);
          if (m > 0.58) c.lerp(color(0x5a6a2a), 0.5);
          if (m < 0.32) c.lerp(color(0x6a3a4a), 0.4);
        },
      };
    case 6: // a woman in a blouse and slacks, her hair pinned up, half the scalp torn off
      return { ...base, sex: 'f', top: top({ kind: 'shirt', color: 0xb8a8a0, region: CR.COTTON, sleeves: 'long', buttons: true, collar: 'shirt' }), pants: pants(0x2a2c30, CR.TWILL), shoes: { kind: 'dress', color: 0x1a1210 }, hair: { style: 'bun', color: 0x6a4a2a } };
    case 7: // a big man in a work jacket, gut and all
      return { ...base, gaunt: 0, build: { w: 1.15, belly: 0.7, arm: 1.1 }, top: top({ kind: 'jacket', color: 0x5a4a3a, region: CR.CANVAS, sleeves: 'long', open: 0.34, under: { color: 0x7a2a22, region: CR.COTTON }, collar: 'jacket' }), pants: pants(0x34466a), shoes: { kind: 'work', color: 0x4a3420 }, hair: { style: 'balding', color: 0x2a2018 }, beard: { style: 'full', color: 0x2a2018 } };
    case 8: // the farmer: red flannel under bib overalls, a feed cap
      return { ...base, top: top({ kind: 'flannel', color: 0x8a2622, region: CR.PLAID, sleeves: 'long', buttons: true, collar: 'shirt' }), overalls: { color: 0x34466a }, pants: pants(0x34466a, CR.DENIM, { rise: 0.09 }), shoes: { kind: 'boot', color: 0x3a2a1c }, hat: { kind: 'cap', color: 0x3a5a2a, front: 0xd8d0b8 }, hair: { style: 'short', color: 0x6a6258 }, jawHang: 0.35 };
    case 9: // the hunter: an olive shirt under a blaze-orange vest and cap
      return { ...base, top: top({ kind: 'shirt', color: 0x4a5034, region: CR.TWILL, sleeves: 'long', collar: 'shirt' }), vest: { kind: 'blaze', color: 0xd8561a, tear: 0.12 }, pants: pants(0x4a4434, CR.TWILL, { cargo: true }), shoes: { kind: 'boot', color: 0x3a2a1c }, hat: { kind: 'cap', color: 0xd8561a }, hair: { style: 'short', color: 0x4a3420 }, oneEye: -1, cheekTear: 1 };
    case 10: // the patient: a hospital gown, bare legs and feet, an ID band
      return {
        ...base, skin: 0xa0a698, gaunt: 0.75,
        top: top({ kind: 'tee', color: 0x9ab8b4, region: CR.COTTON, sleeves: 'short', hem: 0.36, tear: 0.12, collar: 'crew', backOpen: true }),
        pants: null, shoes: null, gear: { wristband: 'L' }, hair: { style: 'patchy', color: 0x2a2420 }, eye: 0xe0e0d0, skullPatch: [0.1, 0.8, 0.45, 0.5],
        blood: [[[0, 1.3, -0.14], 0.12, 0.9], [[0.05, 1.0, -0.13], 0.1, 0.8], [[-0.1, 0.55, -0.05], 0.08, 0.7]],
      };
    case 11: // the office worker: white shirt, tie, charcoal slacks, dress shoes
      return { ...base, top: top({ kind: 'shirt', color: 0xc8c4b8, region: CR.COTTON, sleeves: 'long', buttons: true, collar: 'shirt', tucked: true }), gear: { tie: 0x5a1a24 }, pants: pants(0x2a2c30, CR.TWILL), shoes: { kind: 'dress', color: 0x141210 }, hair: { style: 'short', color: 0x1d1510 }, cheekTear: -1, noEar: 1, blood: [[[0, 1.5, -0.12], 0.14, 1], [[0.06, 1.28, -0.15], 0.14, 1], [[-0.08, 1.12, -0.14], 0.1, 0.9]] };
    case 12: // the road crew: a grey tee, a hi-vis vest with its tape, a hard hat
      return { ...base, top: top({ kind: 'tee', color: 0x5a5a58, region: CR.COTTON, sleeves: 'short' }), vest: { kind: 'hivis', color: 0xb8d420, tear: 0.1 }, pants: pants(0x3b4a63), shoes: { kind: 'work', color: 0x8a6a3a }, hat: { kind: 'hardhat', color: 0xe0a818 }, hair: null, oneEye: 1 };
    case 13: // the woman in a tank top and jeans, long lank hair
      return { ...base, sex: 'f', top: top({ kind: 'tank', color: 0x6a3a5a, region: CR.COTTON, hem: 0.0 }), pants: pants(0x4a5a7a, CR.DENIM, { tearY: 0.25 }), shoes: { kind: 'sneaker', color: 0x9a968c, sole: 0xa8a49c }, hair: { style: 'long', color: 0x3a2418, ragged: 0.12, length: 0.26 }, jawHang: 0.4 };
    case 14: // the waitress: a diner dress and apron
      return { ...base, sex: 'f', top: top({ kind: 'shirt', color: 0x5a8a9a, region: CR.COTTON, sleeves: 'short', buttons: true, collar: 'shirt', hem: 0.3 }), gear: { apron: 0xd8d0c0 }, pants: null, shoes: { kind: 'dress', color: 0x1a1a1a }, hair: { style: 'ponytail', color: 0x8a6a3a, length: 0.18 } };
    default: // 15: bloated, in a sodden coat
      return {
        ...base, gaunt: 0, build: { bloat: 0.6, belly: 0.7 }, skin: 0x8e9468, face: { ...base.face, gaunt: 0, w: 1.08 },
        top: top({ kind: 'coat', color: 0x3a3a3a, region: CR.CLOTH, sleeves: 'long', open: 0.3, hem: 0.2, under: { color: 0x6a6a5a, region: CR.COTTON } }), pants: pants(0x3a3a34, CR.TWILL), shoes: { kind: 'boot', color: 0x2a2018 }, hair: { style: 'patchy', color: 0x3a3028 },
        skinTint: (p, n, c) => {
          const m = fbm3(p.x * 7, p.y * 7, p.z * 7, 2, 29);
          if (m > 0.6) c.lerp(color(0x4a5a2a), 0.5);
        },
      };
  }
}
export const WALKER_VARIANTS = 16;

/**
 * The specials' looks as characters.js wrote them before people.js: their keys turned into a look (shirt -> top,
 * shoes -> shoes, armR -> build.arm, ...), dead.
 */
export function oldLook(o) {
  const sleeves = ['none', 'short', 'long'];
  const L = {
    dead: true,
    sex: o.sex,
    skin: o.skin,
    eye: o.eye, eyeGlow: o.eyeGlow,
    face: { sockets: 1.4 + (o.socket || 0.15) * 2, gaunt: Math.min(1, (o.gaunt ?? 0.4) + 0.2), rot: 0.6, w: o.headSX ? o.headSX / 0.84 : 1, h: o.headSY || 1, d: o.headSZ ? o.headSZ / 1.06 : 1, d: o.headSZ ? o.headSZ / 1.06 : 1, d: o.headSZ ? o.headSZ / 1.06 : 1, jaw: o.jawScale || 1, nose: o.nose ?? 1, noNose: (o.nose ?? 1) < 0.3, lips: 0.7, ...(o.face || {}) },
    gaunt: o.gaunt ?? 0.4,
    build: {
      w: (o.wide || 1) * (o.chestR || 0.158) / 0.158, d: o.chestD || 1, hips: o.hipsW || 1,
      belly: o.bellyD ? Math.max(0, o.bellyD - 1) * 1.5 : 0, arm: (o.armR || 0.045) / 0.045, leg: (o.thighR || 0.078) / 0.078, neck: (o.neckR || 0.047) / 0.047,
    },
    fingerMul: o.fingerMul, claws: o.claws, curl: o.curl, handScale: o.handScale, footW: o.footW, footL: o.footL,
    blood: o.blood, wounds: o.wounds, dirt: o.dirt,
    cheekTear: o.cheekTear, skullPatch: o.skullPatch, oneEye: o.oneEye, noEar: o.noEar, missingArm: o.missingArm, missingTeeth: o.missingTeeth, fang: o.fang, jawScale: o.jawScale,
    skinTint: o.torsoTint || o.armTint || null,
    headTint: o.headTint || null,
    noBrows: true,
  };
  if (o.shirt) {
    L.top = { kind: o.shirt.type === 'tank' ? 'tank' : 'tee', color: o.shirt.color, region: o.shirt.region === CR.CANVAS ? CR.CANVAS : CR.COTTON, sleeves: sleeves[o.shirt.sleeves || 0], tear: o.shirt.tear ?? 0.28, hem: o.shirt.hem ?? 0.04, open: o.shirt.open ? 0.3 : 0, tint: bloodied(7, 0.6, o.shirt.tint) };
  }
  if (o.pants) L.pants = { color: o.pants.color, region: o.pants.region ?? CR.DENIM, tear: 0.15, tearY: o.pants.tearY, belt: o.belt !== false, tint: bloodied(9, 0.5) };
  L.shoes = o.shoes ? { kind: 'boot', color: o.shoes.color } : null;
  if (o.hair && !o.hair.patchy) L.hair = { style: o.hair.long ? 'long' : 'short', color: o.hair.color, ragged: o.hair.ragged, length: 0.24 };
  else if (o.hair) L.hair = { style: 'patchy', color: o.hair.color, patchy: o.hair.patchy };
  return L;
}

export { bloodied, DEAD_SKINS };
