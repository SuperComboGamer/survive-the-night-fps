// The survivors' looks (the roster: shared/characters.js), the look of a custom survivor (the character creator:
// shared/wardrobe.js, shared/appearance.js), and what turns one into a corpse. people.js builds them.
import { color, fbm3, clamp, lerp } from './skinning.js';
import { CR } from './charTextures.js';
import { APPEARANCE } from '../../../shared/appearance.js';

const G = (x) => Math.exp(-x * x);

// stubble, a buzz cut, freckles, age: painted onto the head as vertex tint (lx, ly, lz: about the cranium's middle)
function headPaint(o) {
  const hair = o.hair ? color(o.hair) : null;
  const stub = o.stubble ? color(o.stubble) : null;
  const fn = (lx, ly, lz, c) => {
    const r = Math.hypot(lx, ly, lz) || 1;
    const lam = Math.asin(clamp(ly / r, -1, 1));
    const phi = Math.atan2(lx, -lz);
    const ap = Math.abs(phi);
    if (hair && o.buzz) {
      // a buzz cut: the scalp darkened to the hair's colour where it grows
      const front = 0.45 + 0.12 * (ap / 0.9) ** 2;
      const grows = ap < 0.95 ? lam > front : ap < 1.35 ? lam > 0.12 : lam > -0.4;
      if (grows) c.lerp(hair, o.buzz);
    }
    if (stub) {
      const mouth = ap < 0.24 && lam > -0.52 && lam < -0.36;
      const on = !mouth && ap < 1.45 && (lam < (ap < 0.5 ? -0.3 : ap < 1.2 ? -0.18 + (ap - 0.5) * 0.25 : 0.05));
      if (on) c.lerp(stub, o.stubbleK ?? 0.35);
    }
    if (o.freckles && ap < 0.9 && lam > -0.35 && lam < 0.1) {
      const f = fbm3(lx * 900, ly * 900, lz * 900, 1, 7);
      if (f > 0.72) c.multiplyScalar(0.86);
    }
    if (o.age && ap < 1.0) {
      // lines: the forehead, the crow's feet
      if (lam > 0.26 && lam < 0.42 && Math.abs(Math.sin(lam * 90)) > 0.85) c.multiplyScalar(1 - 0.08 * o.age);
      if (ap > 0.5 && ap < 0.7 && lam > 0.02 && lam < 0.16 && Math.abs(Math.sin(lam * 120)) > 0.8) c.multiplyScalar(1 - 0.1 * o.age);
    }
  };
  fn.paint = o; // (what it paints: appearanceOfRoster reads it back)
  return fn;
}

// grease and dirt on work clothes
const grimy = (k, seed) => {
  const fn = (p, n, c) => {
    const m = fbm3(p.x * 14, p.y * 14, p.z * 14, 2, seed);
    if (m > 0.62) c.multiplyScalar(1 - k * (m - 0.62) * 3);
  };
  fn.grimy = k;
  return fn;
};

/**
 * The roster's looks, by character id. frame: the body's proportions against the default (height: lengths, head:
 * the head's size), the rest as people.js reads it.
 */
export const LOOKS = [
  // 0 Dale Hutchins, park ranger: khaki shirt with the sleeves rolled, olive trousers, the flat-brimmed hat, a badge
  {
    sex: 'm', frame: { height: 1.01 }, build: { w: 1.04, belly: 0.3, arm: 1.04 },
    skin: 0xcf9c78, eye: 0x4a5a40, face: { jaw: 1.1, chin: 1.05, brow: 1.15, noseL: 1.1 },
    hair: { style: 'short', color: 0x6a5642 }, beard: { style: 'mustache', color: 0x5a4834 }, brows: 0x4a3a2a,
    headTint: headPaint({ stubble: 0x7a5a48, stubbleK: 0.18, age: 0.5 }),
    top: { kind: 'shirt', color: 0x9a8a5e, region: CR.TWILL, sleeves: 'rolled', buttons: true, pockets: 'both', collar: 'shirt', tucked: true },
    pants: { color: 0x4c5438, region: CR.TWILL }, shoes: { kind: 'boot', color: 0x4a3220 },
    hat: { kind: 'ranger', color: 0x6e5c3c, band: 0x2a2018 },
    gear: { badge: 'chest', belt: { color: 0x3a2a1a, buckle: 0xb0a070 }, knife: true, watch: true },
  },
  // 1 Rosa Delgado, mechanic: a navy coverall with its sleeves rolled, a red bandana, a ponytail, grease
  {
    sex: 'f', frame: { height: 0.97 }, build: { w: 0.98, arm: 1.08, bust: 0.5 },
    skin: 0xb07a58, eye: 0x3a2618, face: { fem: 1, w: 0.96, jaw: 0.95, chin: 0.95, lips: 1.15, cheek: 1.1 },
    hair: { style: 'ponytail', color: 0x2e2018, length: 0.24 }, brows: 0x22180e,
    top: { kind: 'shirt', color: 0x2e3e5c, region: CR.TWILL, sleeves: 'rolled', zip: true, pockets: 'one', collar: 'shirt', hem: -0.075, tint: grimy(0.5, 3) },
    pants: { color: 0x2e3e5c, region: CR.TWILL, tint: grimy(0.5, 5) }, coverall: true,
    shoes: { kind: 'work', color: 0x3a2c20 },
    hat: { kind: 'bandana', color: 0xa82c22 },
    gear: { patch: 0xe8e4d8, watch: true },
  },
  // 2 Grace Okafor, ER nurse: teal scrubs, white shoes, her hair up in a bun, the hospital lanyard
  {
    sex: 'f', frame: { height: 0.985 }, build: { hips: 1.06, bust: 0.7 },
    skin: 0x6e4632, eye: 0x1e140c, face: { fem: 1, lips: 1.35, nose: 0.95, noseW: 1.5, cheek: 1.15, chin: 0.95 },
    hair: { style: 'bun', color: 0x2a221c, size: 1.25 }, brows: 0x221a14,
    top: { kind: 'tee', color: 0x2f8584, region: CR.COTTON, sleeves: 'short', collar: 'v', hem: 0.075, loose: 0.006 },
    pants: { color: 0x2f8584, region: CR.COTTON, loose: 0.007, belt: false }, shoes: { kind: 'sneaker', color: 0xe6e4de, sole: 0xd2cec6 },
    gear: { lanyard: 0x2a4a8a, watch: true },
  },
  // 3 Walt Brennan, farmer: red flannel under bib overalls, a straw cowboy hat, a grey beard
  {
    sex: 'm', frame: { height: 0.995 }, build: { w: 0.96, sh: 0.98, arm: 0.94, leg: 0.95 },
    skin: 0xd6a080, eye: 0x5a7080, face: { gaunt: 0.35, cheek: 1.15, brow: 1.2, nose: 1.15, ear: 1.12, jaw: 1.05 },
    hair: { style: 'short', color: 0xa8a49c }, beard: { style: 'short', color: 0xb4b0a8 }, brows: 0x9a968e,
    headTint: headPaint({ age: 1 }),
    top: { kind: 'flannel', color: 0x9c2c24, region: CR.PLAID, sleeves: 'long', buttons: true, collar: 'shirt' },
    overalls: { color: 0x3c5276 }, pants: { color: 0x3c5276, region: CR.DENIM, rise: 0.09 },
    shoes: { kind: 'boot', color: 0x4a3020 },
    hat: { kind: 'cowboy', color: 0xc8b07a, band: 0x5a3a20 },
  },
  // 4 Earl 'Bear' Tucker, trucker: big, a full beard, a mesh trucker cap, a canvas jacket open over a black tee
  {
    sex: 'm', frame: { height: 1.02, head: 1.04 }, build: { w: 1.2, d: 1.14, belly: 0.6, arm: 1.1, leg: 1.16, neck: 1.25, sh: 1.06 },
    skin: 0xdcae92, eye: 0x4a3a2a, face: { w: 1.08, jaw: 1.2, cheek: 1.2, nose: 1.15, noseW: 1.3 },
    hair: { style: 'balding', color: 0x3e2e20 }, beard: { style: 'full', color: 0x3e2e20 }, brows: 0x3e2e20,
    hat: { kind: 'trucker', color: 0x2c3c5e, front: 0xe2ded2, bill: 0x2c3c5e },
    top: { kind: 'jacket', color: 0x8e6c44, region: CR.CANVAS, sleeves: 'long', open: 0.36, collar: 'jacket', under: { color: 0x262626, region: CR.COTTON }, pockets: 'both' },
    pants: { color: 0x36486c, region: CR.DENIM }, shoes: { kind: 'work', color: 0x5a4028 },
    gear: { belt: { color: 0x2a1e14, buckle: 0xb8b0a0 } },
  },
  // 5 Maya Chen, student: a maroon hoodie, light jeans, white sneakers, a black bob and glasses
  {
    sex: 'f', frame: { height: 0.945, head: 0.97 }, build: { w: 0.9, sh: 0.94, arm: 0.88, leg: 0.92, bust: 0.4 },
    skin: 0xe0b894, eye: 0x1a1008, face: { fem: 1, w: 0.95, chin: 0.88, nose: 0.75, brow: 0.7, lips: 1.05, cheek: 1.05 },
    hair: { style: 'bob', color: 0x282220 }, brows: 0x1e1a18,
    top: { kind: 'hoodie', color: 0x7c2c3a, region: CR.FLEECE, sleeves: 'long', collar: 'hood', hem: 0.09, loose: 0.006 },
    pants: { color: 0x6680a4, region: CR.DENIM }, shoes: { kind: 'sneaker', color: 0xdedcd4, sole: 0xf0eee8 },
    gear: { glasses: 0x1a1a1a, watch: true },
  },
  // 6 Marcus Reed, sheriff's deputy, off duty: a navy duty jacket, khakis, his badge and holster on his belt
  {
    sex: 'm', frame: { height: 1.04 }, build: { w: 1.06, sh: 1.08, arm: 1.12, leg: 1.04 },
    skin: 0x6a4230, eye: 0x1e120a, face: { jaw: 1.15, chin: 1.1, brow: 1.1, lips: 1.2, noseW: 1.25 },
    hair: { style: 'fade', color: 0x241c16 }, beard: { style: 'goatee', color: 0x241c16 }, brows: 0x1a1410,
    headTint: headPaint({ hair: 0x1a120c, buzz: 0.75 }),
    top: { kind: 'jacket', color: 0x2e3a56, region: CR.CANVAS, sleeves: 'long', zip: true, collar: 'jacket', pockets: 'both', hem: 0.045 },
    pants: { color: 0x9a8a66, region: CR.TWILL }, shoes: { kind: 'boot', color: 0x161412 },
    gear: { holster: true, badge: 'belt', radio: true, belt: { color: 0x141210, buckle: 0x9a9aa0 } },
  },
  // 7 Hank Sorensen, hunter: a camo jacket under a blaze-orange vest and cap, cargo trousers, a red beard
  {
    sex: 'm', frame: { height: 1.02 }, build: { w: 1.1, sh: 1.06, arm: 1.08, leg: 1.04 },
    skin: 0xdeaa86, eye: 0x5a6a7a, face: { jaw: 1.1, brow: 1.1, nose: 1.05 },
    hair: { style: 'short', color: 0x8a4a24 }, beard: { style: 'full', color: 0x8c4624 }, brows: 0x7a3e20,
    hat: { kind: 'cap', color: 0xdc5a1c, bill: 0xc8501a },
    top: { kind: 'jacket', color: 0x6a6444, region: CR.CAMO, sleeves: 'long', zip: true, collar: 'jacket' },
    vest: { kind: 'blaze', color: 0xe8621e, open: 0.14 },
    pants: { color: 0x5c4c36, region: CR.TWILL, cargo: true }, shoes: { kind: 'boot', color: 0x4a3522 },
    gear: { knife: true },
  },
  // 8 Jess Whitaker, hiker: a red shell jacket, grey trail trousers, a beanie over a strawberry-blonde braid, freckles
  {
    sex: 'f', frame: { height: 0.975 }, build: { w: 0.93, arm: 0.95, bust: 0.45 },
    skin: 0xeec8ac, eye: 0x4a7a5a, face: { fem: 1, chin: 0.95, nose: 0.9, lips: 1.05 },
    hair: { style: 'braid', color: 0xc07c3c, length: 0.25 }, brows: 0x9a5a2a,
    headTint: headPaint({ freckles: true }),
    hat: { kind: 'beanie', color: 0x5c6470 },
    top: { kind: 'jacket', color: 0xb83a2c, region: CR.COTTON, sleeves: 'long', zip: true, collar: 'high', hem: 0.05 },
    pants: { color: 0x5a5e62, region: CR.TWILL, cargo: true }, shoes: { kind: 'boot', color: 0x6a4a30, sole: 0x2a2a2a },
    gear: { watch: true },
  },
  // 9 Luis Ortega, road crew foreman: a hard hat, a hi-vis vest over a grey tee, a tool belt, a mustache
  {
    sex: 'm', frame: { height: 0.99 }, build: { w: 1.05, arm: 1.14, belly: 0.15 },
    skin: 0xa86e4a, eye: 0x2a1a0e, face: { jaw: 1.1, cheek: 1.1, noseW: 1.2 },
    hair: { style: 'crop', color: 0x261e1a }, beard: { style: 'mustache', color: 0x261e1a }, brows: 0x1e1814,
    headTint: headPaint({ hair: 0x1a1410, buzz: 0.55, stubble: 0x5a3a28, stubbleK: 0.3 }),
    hat: { kind: 'hardhat', color: 0xe2b21a },
    top: { kind: 'tee', color: 0x6c6c6a, region: CR.COTTON, sleeves: 'short', collar: 'crew', hem: 0.03 },
    vest: { kind: 'hivis', color: 0xc6e032, open: 0.1 },
    pants: { color: 0x3a4a6a, region: CR.DENIM }, shoes: { kind: 'work', color: 0x9a7040 },
    gear: { toolbelt: true, gloves: { color: 0x9a8458 }, belt: { color: 0x3a2818 } },
  },
];

// the dead: the colour drained to a grey-green bruise, the eyes clouded, the clothes torn and bloodied
const DEAD_SKIN = color(0x8a9a80);
/** The corpse of a look (a turned survivor keeps their clothes, hair and kit; the skin and eyes are the dead's). */
export function deadLook(L, seed = 0) {
  const skin = color(L.skin).lerp(DEAD_SKIN, 0.7).getHex();
  const bloody = (t, s) => (p, n, c) => {
    if (t) t(p, n, c);
    if (fbm3(p.x * 9, p.y * 9, p.z * 9, 2, s) > 0.6) c.lerp(color(0x3a0303), 0.65);
  };
  const out = {
    ...L,
    dead: true,
    skin,
    eye: 0xc8c4a4,
    eyeGlow: 0.25,
    face: { ...(L.face || {}), sockets: 1.5, gaunt: Math.max(0.5, L.face?.gaunt || 0), rot: 0.6, lips: 0.7 },
    gaunt: 0.15,
    gear: L.gear ? { ...L.gear, glasses: null, watch: null } : null,
    fist: false,
    curl: 0.8,
    claws: 0.02,
    missingTeeth: (seed * 37 + 11) & 0x5a,
    top: L.top ? { ...L.top, tear: 0.22, tint: bloody(L.top.tint, seed + 1) } : null,
    pants: L.pants ? { ...L.pants, tear: 0.16, tint: bloody(L.pants.tint, seed + 2) } : null,
    vest: L.vest ? { ...L.vest, tear: 0.2 } : null,
    blood: [[[0, 1.5, -0.12], 0.12, 1], [[0.05, 1.28, -0.16], 0.16, 0.9], [[0.2, 0.85, 0.0], 0.12, 0.8]],
    dirt: { y0: 0.4, k: 0.6 },
  };
  return out;
}

/** humanP's options for a look's frame (characters.js survivorP). */
export function frameOf(L) {
  const k = L.frame?.height ?? 1;
  const hk = (L.frame?.head ?? 1) * (1 + (k - 1) * 0.3) * (L.sex === 'f' ? 0.96 : 1);
  return {
    hipY: 0.96 * k, thighLen: 0.45 * k, shinLen: 0.43 * k, spineLen: 0.13 * k, chestLen: 0.2 * k, neckOff: 0.2 * k, neckLen: 0.08 * k,
    headR: 0.105 * hk, shoulderW: 0.19 * (L.sex === 'f' ? 0.93 : 1) * (L.build?.sh ?? 1), uarmLen: 0.29 * k, farmLen: 0.26 * k, handLen: 0.17, depth: 0.13,
    hipW: 0.095 * (L.sex === 'f' ? 1.05 : 1) * (L.build?.hips ?? 1) * (L.build?.w ?? 1) ** 0.5,
  };
}

// ---------------------------------------------------------------- a custom survivor (the character creator)
const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, path, x) {
  const ks = path.split('.');
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] && typeof a[ks[i]] === 'object' ? a[ks[i]] : (a[ks[i]] = {});
  a[ks[ks.length - 1]] = x;
}
function merge(dst, src) {
  for (const [k, x] of Object.entries(src)) {
    if (x && typeof x === 'object' && !Array.isArray(x)) merge(dst[k] && typeof dst[k] === 'object' ? dst[k] : (dst[k] = {}), x);
    else dst[k] = x;
  }
  return dst;
}
// a fabric named in the wardrobe ('DENIM') is an atlas region here (CR.DENIM)
function regions(o) {
  for (const [k, x] of Object.entries(o)) {
    if (k === 'region' && typeof x === 'string') o[k] = CR[x] ?? CR.COTTON;
    else if (x && typeof x === 'object' && typeof x !== 'function') regions(x);
  }
  return o;
}
const hexMix = (a, b, t) => color(a).lerp(color(b), t).getHex();

/**
 * The look of a custom survivor (values: shared/appearance.js, by name): the roster's kind of look object, made from
 * the wardrobe's fields. A field goes where its `path` says (a pick's name, a swatch's colour, a slider's value; an
 * option's `look` is merged in), so a new part needs nothing here; what follows the loop are the few things worked
 * out from more than one field.
 */
export function lookFromAppearance(values) {
  const A = APPEARANCE;
  const v = A.canonical(values);
  const hexOf = (key) => {
    const f = A.byKey.get(key);
    const x = v[key];
    if (x === 'same') return hexOf(f.same.field);
    return A.choice(f, x)?.hex;
  };
  const opt = (key) => A.choice(A.byKey.get(key), v[key]) || {};
  const L = { sex: v.body, frame: {}, build: {}, face: {}, gear: {} };
  for (const f of A.fields) {
    if (!A.relevant(v, f)) continue;
    const x = v[f.key];
    if (f.kind === 'slider') {
      if (f.path) setPath(L, f.path, x);
      continue;
    }
    const o = A.choice(f, x);
    if (f.kind === 'swatch') {
      if (f.path && x !== 'none') setPath(L, f.path, hexOf(f.key));
      continue;
    }
    if (f.path && x !== 'none') setPath(L, f.path, o.region ? o.region : x === 'on' ? true : x);
    if (o.look) merge(L, structuredClone(o.look));
  }
  // the trunk deepens with its width (Earl: 1.2 wide, 1.14 deep)
  L.build.d = 1 + (L.build.w - 1) * 0.7;
  L.top ||= {};
  L.pants ||= {};
  // hair: none at all, how long or big, its brows
  const hair = opt('hair');
  if (v.hair === 'none') delete L.hair;
  else if (hair.size) setPath(L, hair.size.path, lerp(hair.size.range[0], hair.size.range[1], v.hairSize));
  L.brows = opt('hairColor').brow ?? hexOf('hairColor');
  // what is painted on the head: a buzz cut, stubble, freckles, lines
  const paint = {};
  if (hair.paint?.buzz) Object.assign(paint, { hair: hexMix(hexOf('hairColor'), 0x000000, 0.28), buzz: hair.paint.buzz });
  const stub = opt('stubble').paint;
  if (stub) Object.assign(paint, { stubble: hexMix(L.skin, v.beard !== 'none' ? hexOf('beardColor') : hexOf('hairColor'), 0.5), stubbleK: stub.stubbleK });
  if (v.freckles === 'on') paint.freckles = true;
  if (v.age > 0.02) paint.age = v.age;
  if (Object.keys(paint).length) L.headTint = headPaint(paint);
  // the hat's trim: its band, its front panel or its bill
  const trim = opt('hat').trim;
  if (L.hat && trim && v.hatTrim !== 'none') L.hat[trim] = hexOf('hatTrim');
  // what is worn over the top takes its own colour; overalls and a coverall are the trousers too
  if (L.vest) L.vest.color = hexOf('layerColor');
  if (L.overalls) {
    L.overalls.color = hexOf('layerColor');
    L.pants.color = L.overalls.color;
  }
  if (L.coverall) {
    L.pants.color = L.top.color;
    L.pants.region = L.top.region;
  }
  if (L.top?.under) L.top.under.region = 'COTTON';
  if (v.grime === 'grimy') {
    L.top.tint = grimy(0.5, 3);
    L.pants.tint = grimy(0.5, 5);
  }
  // no belt: the trousers' own goes too
  if (v.belt === 'none') L.pants.belt = false;
  return regions(L);
}

// how a roster look reads back as the wardrobe's values: the fields that are not simply at a path
const READ = {
  body: (L) => L.sex || 'm',
  front: (L) => (L.top?.open ? 'open' : L.top?.zip ? 'zip' : L.top?.buttons ? 'buttons' : 'closed'),
  fit: (L) => (L.top?.tucked ? 'tucked' : (L.top?.hem ?? 0) >= 0.07 ? 'long' : 'regular'),
  grime: (L) => (L.top?.tint?.grimy ? 'grimy' : 'clean'),
  layer: (L) => (L.coverall ? 'coverall' : L.overalls ? 'overalls' : L.vest ? L.vest.kind : 'none'),
  layerColor: (L) => L.vest?.color ?? L.overalls?.color,
  trousers: (L) => (L.pants?.cargo ? 'cargo' : L.pants?.shorts ? 'shorts' : L.pants?.belt === false && L.pants?.loose ? 'scrub' : 'plain'),
  stubble: (L) => (!L.headTint?.paint?.stubble ? 'none' : L.headTint.paint.stubbleK <= 0.2 ? 'light' : 'heavy'),
  freckles: (L) => (L.headTint?.paint?.freckles ? 'on' : 'none'),
  age: (L) => L.headTint?.paint?.age ?? 0,
  belt: (L) => (L.pants?.belt === false ? 'none' : L.gear?.belt?.color ?? 0x2a1f16),
  beardColor: (L) => (L.beard && L.beard.color !== undefined && L.beard.color !== L.hair?.color ? L.beard.color : 'same'),
  hatTrim: (L) => {
    const t = A_().choice(A_().byKey.get('hat'), L.hat?.kind)?.trim;
    return (t && L.hat?.[t]) ?? 'none';
  },
  hairSize: (L) => {
    const s = A_().choice(A_().byKey.get('hair'), L.hair?.style)?.size;
    const x = s ? getPath(L, s.path) : undefined;
    return s && x !== undefined ? (x - s.range[0]) / (s.range[1] - s.range[0]) : 0.5;
  },
  hair: (L) => L.hair?.style ?? 'none',
};
const A_ = () => APPEARANCE;
// the nearest swatch to a colour
function nearestSwatch(f, hex) {
  const A = APPEARANCE;
  const c = color(hex);
  let best = null, bd = Infinity;
  for (const o of A.offered(f)) {
    if (o.hex === undefined) continue;
    const s = color(o.hex);
    const dd = (s.r - c.r) ** 2 + (s.g - c.g) ** 2 + (s.b - c.b) ** 2;
    if (dd < bd) (bd = dd), (best = o.name);
  }
  return best ?? f.default;
}

/** A roster survivor as the wardrobe's values: where the creator's "Make one like Dale" starts. */
export function appearanceOfRoster(id) {
  const A = APPEARANCE;
  const L = LOOKS[((id | 0) % LOOKS.length + LOOKS.length) % LOOKS.length];
  const v = {};
  for (const f of A.fields) {
    let x = READ[f.key] ? READ[f.key](L) : f.path ? getPath(L, f.path) : undefined;
    if (f.kind === 'slider') {
      if (x === undefined && f.key === 'bust') x = L.sex === 'f' ? 0.6 : 0;
      if (x === undefined && f.key === 'features') x = L.face?.fem ?? 0;
      v[f.key] = typeof x === 'number' ? x : f.default;
    } else if (f.kind === 'swatch') {
      if (x === 'none' || x === 'same') v[f.key] = x;
      else if (typeof x === 'number') v[f.key] = A.offered(f).find((o) => o.hex === x)?.name ?? nearestSwatch(f, x);
    } else if (x !== undefined) {
      // a pick: its name, or the option whose fabric it is, or on / none
      const o = A.choices.get(f.key).find((c) => c.name === x || (c.region !== undefined && CR[c.region] === x));
      v[f.key] = o ? o.name : x === true ? 'on' : x === false || x === null ? 'none' : f.default;
    } else v[f.key] = A.choices.get(f.key).some((c) => c.name === 'none') ? 'none' : f.default;
  }
  if (v.trouserFabric === undefined || !L.pants?.region) v.trouserFabric = 'denim';
  return A.normalize(v);
}

let rosterLooks = null;
// how much a difference in each field counts toward "looks like": the shape of them first
const LIKE = { body: 3, top: 2, layer: 2, hat: 2, hair: 1.5, beard: 1.5, skin: 1.5, topColor: 1, hairColor: 1, trousers: 0.5, shoes: 0.5 };
/** The roster survivor most like a custom one: who an older client (or this one, until the model is built) draws. */
export function nearestRoster(values) {
  const A = APPEARANCE;
  rosterLooks ||= LOOKS.map((_, i) => appearanceOfRoster(i));
  const v = A.clean(values);
  let best = 0, bd = Infinity;
  rosterLooks.forEach((r, i) => {
    let d = 0;
    for (const [k, w] of Object.entries(LIKE)) if (r[k] !== v[k]) d += w;
    d += Math.abs(r.height - v.height) * 10 + Math.abs(r.build - v.build) * 5;
    if (d < bd) (bd = d), (best = i);
  });
  return best;
}

void G;
