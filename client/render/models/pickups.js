// Ground item models (~0.2-0.6 m), resting on y = 0, centred on the origin.
// Geometry is cached per item; createPickup returns a new Group sharing geometry + shared materials.
import * as THREE from 'three';
import { ITEM, WEAPONS } from '../../../shared/defs.js';
import { MeshBuilder, partsToGroup, makeRng } from '../materials.js';
import { atlasUV } from '../textures.js';
import { createWorldWeapon } from './weapons.js'; // (static: a top-level await for it here holds every module up for one more request)
import { createBackpack } from './backpack.js';

const PI = Math.PI;

const cache = new Map();
const weaponXform = new Map();

/** @returns {THREE.Object3D} */
export function createPickup(itemId) {
  if (WEAPONS[itemId] || HELD_LAY[itemId]) return weaponPickup(itemId);
  if (itemId === ITEM.BACKPACK) return backpackPickup();
  let parts = cache.get(itemId);
  if (!parts) {
    const b = new MeshBuilder(itemId * 131 + 7, { ao: false });
    const fn = BUILD[itemId] || BUILD.fallback;
    fn(b, makeRng(itemId * 7 + 3), itemId);
    parts = b.build();
    cache.set(itemId, parts);
  }
  const g = partsToGroup(parts, `pickup_${itemId}`);
  g.userData.itemId = itemId;
  return g;
}

function weaponPickup(itemId) {
  const w = createWorldWeapon(itemId);
  const g = new THREE.Group();
  g.name = `pickup_${itemId}`;
  g.userData.itemId = itemId;
  // lay the weapon on its side, barrel along X, resting on the ground
  // (a crossbow lies flat instead, nose down on its stirrup, or it would stand on one limb)
  const flat = itemId === ITEM.CROSSBOW;
  const holder = new THREE.Group();
  holder.add(w);
  const lay = HELD_LAY[itemId];
  if (lay) holder.rotation.set(lay[0], lay[1], lay[2], 'YXZ');
  else if (flat) holder.rotation.set(-0.16, PI / 2 - 0.35, 0, 'YXZ');
  else holder.rotation.set(0, PI / 2 - 0.35, PI / 2);
  g.add(holder);
  let x = weaponXform.get(itemId);
  if (!x) {
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder, flat); // pitched: the loose (corner) bounds would reach below the model
    if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    x = new THREE.Vector3(-c.x, -box.min.y + 0.005, -c.z);
    weaponXform.set(itemId, x);
  }
  holder.position.copy(x);
  if (w.children.length === 0) {
    // weapons.js returned an empty group (unknown id): fall back to our own shape
    g.remove(holder);
    return fallbackWeapon(itemId);
  }
  return g;
}

// Throwables that lie on the ground as the same model as the one in the hand (weapons.js), and how (Euler YXZ): the
// frag grenade on its side, its spoon up; the noisemaker standing on its feet, its dial turned a little to one side
const HELD_LAY = { [ITEM.GRENADE]: [0, 0.55, PI / 2 - 0.12], [ITEM.DECOY]: [0, PI + 0.6, 0] };

// the backpack (backpack.js, the same model a survivor wears): stood on its base, leaning back a little against its
// shoulder straps
function backpackPickup() {
  const g = new THREE.Group();
  g.name = `pickup_${ITEM.BACKPACK}`;
  g.userData.itemId = ITEM.BACKPACK;
  const m = createBackpack(false);
  m.position.set(0, 0.004, -0.1);
  m.rotation.x = -0.12;
  g.add(m);
  return g;
}

function fallbackWeapon(itemId) {
  let parts = cache.get(`w${itemId}`);
  if (!parts) {
    const b = new MeshBuilder(itemId, { ao: false });
    FALLBACK_WEAPON(b, itemId);
    parts = b.build();
    cache.set(`w${itemId}`, parts);
  }
  const g = partsToGroup(parts, `pickup_${itemId}`);
  g.userData.itemId = itemId;
  return g;
}

// ------------------------------------------------------------------ helpers
/** cylinder whose side is textured with an atlas cell (labels wrap around) */
function labelCyl(b, cell, r, h, seg, o) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  const a = atlasUV(cell);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, a.u0 + uv.getX(i) * (a.u1 - a.u0), a.v0 + uv.getY(i) * (a.v1 - a.v0));
  return b.add('labels', g, { raw: true, ...o });
}
/** partial open cylinder (theta arc) textured with an atlas cell */
function labelArc(b, cell, r, h, seg, t0, tl, o) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true, t0, tl);
  const a = atlasUV(cell);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, a.u0 + uv.getX(i) * (a.u1 - a.u0), a.v0 + uv.getY(i) * (a.v1 - a.v0));
  return b.add('labels', g, { raw: true, ...o });
}
/** open cylinder along Y with an atlas cell mapped u = along the axis, v = around (rolled paper) */
function labelRoll(b, cell, r, h, seg, o) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  const a = atlasUV(cell);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, a.u0 + v * (a.u1 - a.u0), a.v0 + u * (a.v1 - a.v0));
  }
  return b.add('labels', g, { raw: true, ...o });
}
/** flat disc facing +Y textured with (the middle of) an atlas cell */
function labelDisc(b, cell, r, seg, o) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-PI / 2);
  const a = atlasUV(cell);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, a.u0 + (0.3 + uv.getX(i) * 0.4) * (a.u1 - a.u0), a.v0 + (0.1 + uv.getY(i) * 0.8) * (a.v1 - a.v0));
  return b.add('labels', g, { raw: true, ...o });
}
function labelOn(b, cell, w, h, p, r = [-PI / 2, 0, PI], mat = 'labels') {
  b.plane(mat, w, h, { atlas: cell, p, r });
}
const brass = [0.78, 0.6, 0.28];

// ------------------------------------------------------------------ items
const BUILD = {};

BUILD.fallback = (b) => b.box('cardboard', 0.25, 0.15, 0.2, { p: [0, 0.075, 0] });

BUILD[ITEM.WOOD] = (b, r) => {
  const t = [[0.95, 0.9, 0.85], [0.8, 0.74, 0.68], [0.7, 0.66, 0.62]];
  for (let k = 0; k < 4; k++) {
    const y = 0.014 + Math.floor(k / 2) * 0.03, z = (k % 2 ? 0.06 : -0.06) + (r() - 0.5) * 0.02;
    b.box('wood', 0.62, 0.028, 0.11, { grain: true, p: [(r() - 0.5) * 0.04, y, z], r: [0, (r() - 0.5) * 0.12, 0], c: t[k % 3] });
  }
  for (const x of [-0.18, 0.18]) b.torus('rope', 0.1, 0.008, 3, 10, PI * 2, { p: [x, 0.04, 0], r: [0, PI / 2, 0], s: [1, 0.55, 1] });
};

BUILD[ITEM.STICK] = (b, r) => {
  for (let k = 0; k < 7; k++) {
    const y = 0.02 + (k % 3) * 0.022, z = (k - 3) * 0.022;
    const L = 0.5 + r() * 0.12;
    b.cylBetween('bark_dead', [-L / 2, y, z], [L / 2, y + (r() - 0.5) * 0.02, z + (r() - 0.5) * 0.05], 0.011, 0.016, 5);
  }
  b.torus('rope', 0.06, 0.007, 3, 10, PI * 2, { p: [0.05, 0.04, 0], r: [0, PI / 2, 0] });
};

BUILD[ITEM.CLOTH] = (b, r) => {
  const cols = [[0.72, 0.68, 0.58], [0.45, 0.42, 0.5], [0.6, 0.3, 0.25]];
  for (let k = 0; k < 3; k++) b.box('cloth', 0.34 - k * 0.05, 0.03, 0.26 - k * 0.03, { p: [(r() - 0.5) * 0.04, 0.015 + k * 0.03, (r() - 0.5) * 0.04], r: [0, (r() - 0.5) * 0.6, (r() - 0.5) * 0.06], c: cols[k] });
  b.plane('cloth', 0.12, 0.2, { p: [0.19, 0.03, 0.02], r: [-PI / 2 + 0.25, 0, 0.3], c: cols[0] });
};

BUILD[ITEM.SCRAP] = (b, r) => {
  b.group({ p: [0, 0.02, 0], r: [0, 0.3, 0] }, () => {
    b.box('tin', 0.35, 0.012, 0.28, { p: [-0.08, 0.02, 0], r: [0, 0, 0.12] });
    b.box('tin', 0.22, 0.012, 0.28, { p: [0.16, 0.06, 0], r: [0, 0, -0.35] });
  });
  b.box('rust', 0.3, 0.01, 0.2, { p: [0.02, 0.03, 0.08], r: [0.1, -0.5, 0.05] });
  b.cylBetween('rust', [-0.2, 0.02, -0.12], [0.18, 0.03, -0.18], 0.01, 0.01, 5);
};

BUILD[ITEM.NAILS] = (b, r) => {
  b.box('cardboard', 0.14, 0.07, 0.09, { p: [0, 0.035, 0] });
  b.box('dark', 0.13, 0.002, 0.08, { p: [0, 0.066, 0] });
  for (let k = 0; k < 12; k++) {
    const a = r() * PI * 2, d = 0.06 + r() * 0.08;
    const x = Math.cos(a) * d + 0.04, z = Math.sin(a) * d;
    const an = r() * PI;
    b.cylBetween('steel', [x, 0.006, z], [x + Math.cos(an) * 0.06, 0.006, z + Math.sin(an) * 0.06], 0.003, 0.003, 3);
  }
  for (let k = 0; k < 5; k++) b.cyl('steel', 0.003, 0.003, 0.06, 3, { p: [-0.04 + k * 0.02, 0.08, (r() - 0.5) * 0.04], r: [(r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6] });
};

BUILD[ITEM.ROPE] = (b) => {
  for (let k = 0; k < 4; k++) b.torus('rope', 0.13 - k * 0.004, 0.014, 5, 16, PI * 2, { p: [0, 0.014 + k * 0.024, 0], r: [PI / 2, 0, k * 0.4] });
  b.tube('rope', [[0.13, 0.08, 0], [0.2, 0.04, -0.06], [0.26, 0.012, -0.12]], 0.013, 6, 5);
};

BUILD[ITEM.TAPE] = (b) => {
  b.lathe('chrome', [[0.035, -0.024], [0.06, -0.025], [0.062, 0.0], [0.06, 0.025], [0.035, 0.024]], 14, { p: [0, 0.025, 0] });
  b.cyl('cardboard', 0.036, 0.036, 0.05, 12, { p: [0, 0.025, 0], open: true, s: [-1, 1, 1] });
  b.box('chrome', 0.1, 0.002, 0.048, { p: [0.09, 0.001, 0.0] });
};

BUILD[ITEM.POWDER] = (b) => {
  b.cyl('metal', 0.06, 0.06, 0.12, 12, { p: [0, 0.06, 0] });
  b.cyl('steel', 0.062, 0.062, 0.02, 12, { p: [0, 0.125, 0] });
  labelCyl(b, 'hazard_small', 0.0605, 0.07, 12, { p: [0, 0.06, 0] });
  b.cyl('dark', 0.04, 0.05, 0.015, 8, { p: [0.12, 0.007, 0.03] }); // spilled powder
};

BUILD[ITEM.CHEM] = (b) => {
  const c = [0.72, 0.8, 0.62];
  b.box('paint', 0.16, 0.26, 0.1, { p: [0, 0.13, 0], c });
  b.frustum('paint', 0.16, 0.1, 0.05, 0.04, 0.26, 0.31, { p: [0.04, 0, 0], c });
  b.cyl('paint', 0.02, 0.02, 0.03, 8, { p: [0.06, 0.325, 0], c: [0.2, 0.5, 0.2] });
  b.torus('paint', 0.035, 0.01, 4, 8, PI, { p: [-0.04, 0.27, 0], r: [0, 0, 0], c });
  labelOn(b, 'hazard', 0.1, 0.1, [0, 0.12, -0.051], [0, PI, 0]);
};

BUILD[ITEM.HERB] = (b, r) => {
  // bundle of leafy stems tied with string
  for (let k = 0; k < 5; k++) {
    const z = (k - 2) * 0.02, ang = (k - 2) * 0.14;
    const L = 0.24 + r() * 0.06;
    const tip = [0.12 * Math.cos(ang) + 0.02, 0.02 + r() * 0.02, z + Math.sin(ang) * 0.15];
    b.cylBetween('wood', [-0.14, 0.012, z * 0.4], tip, 0.003, 0.004, 3, { c: [0.3, 0.42, 0.18] });
    for (let q = 0; q < 3; q++) {
      const t = 0.4 + q * 0.25;
      const px = -0.14 + (tip[0] + 0.14) * t, pz = z * 0.4 + (tip[2] - z * 0.4) * t;
      const side = q % 2 ? 1 : -1;
      b.sphere('cloth', 0.034, 4, 2, { p: [px, 0.02 + q * 0.004, pz + side * 0.018], s: [1.2, 0.18, 0.55], r: [0, ang + side * 0.6, 0], c: [0.28 + r() * 0.08, 0.42 + r() * 0.1, 0.18] });
    }
  }
  b.torus('rope', 0.022, 0.005, 3, 8, PI * 2, { p: [-0.1, 0.014, 0], r: [0, PI / 2, 0] });
};

BUILD[ITEM.ALCOHOL] = (b) => {
  b.group({ p: [0, 0.045, 0], r: [0, 0.4, PI / 2] }, () => {
    b.lathe('bottle_brown', [[0.0, -0.13], [0.045, -0.13], [0.045, 0.05], [0.02, 0.1], [0.015, 0.14], [0.0, 0.14]], 10);
    labelCyl(b, 'whiskey', 0.046, 0.08, 10, { p: [0, -0.04, 0] });
    b.cyl('chrome', 0.017, 0.017, 0.03, 8, { p: [0, 0.145, 0] });
  });
};

BUILD[ITEM.LEATHER] = (b) => {
  const v = [[-0.2, 0.01, -0.14], [0.05, 0.012, -0.18], [0.22, 0.01, -0.1], [0.18, 0.02, 0.12], [-0.02, 0.012, 0.18], [-0.24, 0.01, 0.08], [0, 0.03, 0]];
  b.poly('cloth', v, [[6, 1, 0], [6, 2, 1], [6, 3, 2], [6, 4, 3], [6, 5, 4], [6, 0, 5]], { c: [0.45, 0.3, 0.2] });
  b.box('cloth', 0.25, 0.03, 0.14, { p: [0.02, 0.035, 0.02], r: [0, 0.3, 0.05], c: [0.4, 0.26, 0.16] });
};

BUILD[ITEM.WIRE] = (b) => {
  for (let k = 0; k < 3; k++) b.torus('wire', 0.14 + k * 0.01, 0.004, 3, 18, PI * 2, { p: [0, 0.012 + k * 0.01, 0], r: [PI / 2 + (k - 1) * 0.12, 0, k * 0.5] });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * PI * 2;
    b.box('wire', 0.035, 0.005, 0.005, { p: [Math.cos(a) * 0.15, 0.02, Math.sin(a) * 0.15], r: [0, -a + 0.8, 0.5] });
  }
};

BUILD[ITEM.PLATE] = (b) => {
  b.group({ p: [0, 0.03, 0], r: [-PI / 2 + 0.1, 0, 0.2] }, () => {
    b.cyl('olive', 0.6, 0.6, 0.3, 10, { theta: [-0.22, 0.44], open: true, p: [0, 0, -0.6], r: [0, 0, 0] });
    b.box('olive', 0.25, 0.3, 0.02, { p: [0, 0, 0.005] });
  });
};

BUILD[ITEM.GUNPARTS] = (b) => {
  b.box('olive', 0.2, 0.06, 0.12, { p: [-0.04, 0.03, 0] });
  labelOn(b, 'gunparts', 0.18, 0.09, [-0.04, 0.061, 0]);
  const pts = [];
  for (let k = 0; k <= 40; k++) {
    const a = k * 0.8;
    pts.push([0.1 + k * 0.003, 0.018 + Math.cos(a) * 0.014, 0.05 + Math.sin(a) * 0.014]);
  }
  b.tube('steel', pts, 0.002, 40, 3);
  b.cyl('steel', 0.012, 0.012, 0.12, 8, { p: [0.12, 0.012, -0.04], r: [0, 0.3, PI / 2] });
  b.cyl('dark', 0.006, 0.006, 0.05, 5, { p: [0.08, 0.006, -0.08], r: [0, -0.4, PI / 2] });
};

BUILD[ITEM.BANDAGE] = (b) => {
  b.cyl('cloth', 0.045, 0.045, 0.07, 12, { p: [0, 0.045, 0], r: [0, 0, PI / 2], c: [0.92, 0.9, 0.84] });
  b.plane('cloth', 0.07, 0.14, { p: [0.0, 0.004, -0.1], r: [-PI / 2, 0, 0.1], c: [0.92, 0.9, 0.84] });
  b.box('labels', 0.09, 0.02, 0.09, { p: [0.1, 0.01, 0.06], r: [0, 0.4, 0] });
  labelOn(b, 'cross_mark', 0.085, 0.085, [0.1, 0.0205, 0.06], [-PI / 2, 0, 0.4]);
};

BUILD[ITEM.MEDKIT] = (b) => {
  b.box('paint', 0.36, 0.12, 0.24, { p: [0, 0.06, 0], c: [0.62, 0.12, 0.1] });
  b.box('dark', 0.365, 0.008, 0.245, { p: [0, 0.085, 0] });
  labelOn(b, 'medkit', 0.2, 0.2, [0, 0.1205, 0]);
  b.torus('rubber', 0.05, 0.01, 4, 8, PI, { p: [0, 0.075, -0.125], r: [PI / 2, 0, 0] });
  for (const x of [-0.14, 0.14]) b.box('steel', 0.03, 0.03, 0.01, { p: [x, 0.08, -0.123] });
};

BUILD[ITEM.PAINKILLERS] = (b) => {
  b.group({ p: [0, 0.035, 0], r: [0, 0.6, PI / 2] }, () => {
    b.cyl('paint', 0.032, 0.032, 0.08, 10, { c: [0.85, 0.45, 0.12] });
    labelCyl(b, 'pills', 0.0325, 0.05, 10, {});
    b.cyl('chrome', 0.035, 0.035, 0.022, 10, { p: [0, 0.05, 0] });
  });
  for (let k = 0; k < 4; k++) b.sphere('bone', 0.007, 5, 3, { p: [0.06 + k * 0.015, 0.005, 0.03 - k * 0.01], s: [1.5, 0.7, 1] });
};

BUILD[ITEM.BATTERY] = (b, r) => {
  for (let k = 0; k < 3; k++) {
    b.group({ p: [(k - 1) * 0.035, 0.015, (r() - 0.5) * 0.02], r: [PI / 2, 0, (r() - 0.5) * 0.3] }, () => {
      labelCyl(b, 'battery', 0.015, 0.05, 8, {});
      b.cyl('steel', 0.015, 0.015, 0.004, 8, { p: [0, 0.027, 0] });
      b.cyl('steel', 0.005, 0.005, 0.004, 6, { p: [0, 0.031, 0] });
      b.cyl('steel', 0.015, 0.015, 0.004, 8, { p: [0, -0.027, 0] });
    });
  }
};

// ring-pull tin: blue paper label with a yellow band, rolled rims
const TIN_UV = [0.2, 0.2]; // a clean patch of the metal texture (the default random offset can land on a rust chip)
function tunaTin(b, R, H) {
  b.cyl('chrome', R, R, H, 14, { p: [0, H / 2, 0], uvOff: TIN_UV });
  b.cyl('cloth', R + 0.0008, R + 0.0008, H * 0.68, 14, { p: [0, H / 2, 0], open: true, c: [0.16, 0.34, 0.56] });
  b.cyl('cloth', R + 0.0014, R + 0.0014, H * 0.18, 14, { p: [0, H * 0.56, 0], open: true, c: [0.86, 0.74, 0.3] });
  for (const y of [0.002, H - 0.002]) b.torus('chrome', R, 0.002, 4, 14, PI * 2, { p: [0, y, 0], r: [PI / 2, 0, 0], uvOff: TIN_UV });
  b.torus('steel', 0.011, 0.002, 4, 10, PI * 2, { p: [R * 0.45, H + 0.002, 0], r: [PI / 2, 0, 0] });
  b.box('steel', 0.014, 0.002, 0.008, { p: [R * 0.14, H + 0.001, 0] });
}
BUILD[ITEM.TUNA] = (b) => {
  const R = 0.055, H = 0.04;
  b.group({ p: [-0.012, 0, 0], r: [0, 0.4, 0] }, () => tunaTin(b, R, H));
  b.group({ p: [0.014, H, 0.01], r: [0, -0.9, 0] }, () => tunaTin(b, R, H));
};

// a cut of venison on the bone, raw and red or browned off the fire; what lies on the ground is two of them
function venisonCut(b, cooked) {
  b.sphere('paint', 0.07, 8, 6, { p: [0, 0.035, 0], s: [1.25, 0.5, 0.85], c: cooked ? [0.42, 0.24, 0.13] : [0.6, 0.16, 0.15] });
  b.sphere('paint', 0.045, 7, 5, { p: [-0.02, 0.05, 0.005], s: [1.1, 0.45, 0.8], c: cooked ? [0.52, 0.32, 0.17] : [0.72, 0.26, 0.24] });
  b.sphere('paint', 0.04, 6, 5, { p: [0.05, 0.036, 0], s: [0.9, 0.5, 1], c: cooked ? [0.3, 0.17, 0.09] : [0.86, 0.78, 0.7] }); // the seared edge, or the fat
  b.cylBetween('bone', [-0.07, 0.03, 0], [-0.15, 0.034, 0], 0.012, 0.014, 6);
  b.sphere('bone', 0.02, 6, 4, { p: [-0.155, 0.034, 0] });
}
for (const item of [ITEM.VENISON_RAW, ITEM.VENISON]) {
  BUILD[item] = (b) => {
    b.group({ p: [-0.03, 0, -0.04], r: [0, 0.5, 0] }, () => venisonCut(b, item === ITEM.VENISON));
    b.group({ p: [0.05, 0, 0.06], r: [0, -2.2, 0] }, () => venisonCut(b, item === ITEM.VENISON));
  };
}

BUILD[ITEM.TORCH] = (b) => {
  b.group({ p: [0, 0.03, 0], r: [0, 0.3, PI / 2 - 0.08] }, () => {
    b.cyl('wood', 0.018, 0.022, 0.5, 6, { p: [0, 0, 0], grain: true, c: [0.7, 0.62, 0.52] });
    b.cyl('cloth', 0.04, 0.035, 0.12, 7, { p: [0, 0.22, 0], c: [0.4, 0.36, 0.3] });
    b.torus('cloth', 0.036, 0.012, 4, 8, PI * 2, { p: [0, 0.17, 0], r: [PI / 2, 0, 0], c: [0.3, 0.26, 0.2] });
  });
};

BUILD[ITEM.MOLOTOV] = (b) => {
  b.group({ p: [0, 0.04, 0], r: [0, -0.4, PI / 2] }, () => {
    b.lathe('bottle', [[0.0, -0.12], [0.04, -0.12], [0.04, 0.04], [0.016, 0.09], [0.013, 0.13], [0.0, 0.13]], 10);
    b.cyl('cloth', 0.016, 0.02, 0.08, 6, { p: [0, 0.14, 0], c: [0.7, 0.62, 0.48] });
    b.plane('cloth', 0.06, 0.1, { p: [0.02, 0.19, 0], r: [0, 0, -0.5], c: [0.7, 0.62, 0.48] });
    b.torus('rope', 0.017, 0.004, 3, 6, PI * 2, { p: [0, 0.115, 0], r: [PI / 2, 0, 0] });
  });
};

BUILD[ITEM.PIPEBOMB] = (b) => {
  b.group({ p: [0, 0.032, 0], r: [0, 0.3, PI / 2] }, () => {
    b.cyl('steel', 0.028, 0.028, 0.2, 10, {});
    for (const y of [-0.105, 0.105]) b.cyl('rust', 0.034, 0.034, 0.03, 6, { p: [0, y, 0] });
    b.cyl('chrome', 0.0295, 0.0295, 0.05, 10, { p: [0, 0.02, 0], open: true });
    b.tube('dark', [[0, 0.12, 0], [0.01, 0.15, 0.01], [0.03, 0.17, 0.0]], 0.003, 5, 3);
    b.box('dark', 0.02, 0.04, 0.02, { p: [0.03, -0.02, 0] });
  });
};

BUILD[ITEM.FLARE] = (b) => {
  // red road flare lying on its side: paper tube, white band, black striker cap, wire stand at the tail
  const red = [0.72, 0.1, 0.07];
  b.group({ p: [0, 0.018, 0], r: [0, 0.5, PI / 2] }, () => {
    b.cyl('paint', 0.017, 0.017, 0.2, 10, { c: red });
    b.cyl('paint', 0.0175, 0.0175, 0.035, 10, { p: [0, 0.02, 0], c: [0.85, 0.82, 0.74] });
    labelCyl(b, 'hazard_small', 0.0176, 0.02, 10, { p: [0, 0.02, 0] });
    // cap pulled half off the striker end
    b.cyl('rubber', 0.019, 0.019, 0.035, 10, { p: [0, 0.112, 0] });
    b.cyl('rubber', 0.012, 0.019, 0.01, 10, { p: [0, 0.134, 0] });
    b.cyl('dark', 0.0172, 0.0172, 0.006, 10, { p: [0, 0.0985, 0] });
    b.cyl('paint', 0.016, 0.017, 0.012, 10, { p: [0, -0.106, 0], c: red.map((c) => c * 0.7) });
    for (const s of [-1, 1]) b.cylBetween('steel', [s * 0.008, -0.11, 0], [s * 0.03, -0.17, 0.004], 0.0015, 0.0015, 3);
  });
};

// rolled blueprint tied with string; tag colour + tint differ per schematic
const SCHEM_LOOK = {
  [ITEM.SCHEM_SHOTGUN]: { tag: [0.66, 0.14, 0.1], rot: 0.35 },
  [ITEM.SCHEM_RIFLE]: { tag: [0.28, 0.44, 0.22], rot: -0.25 },
  [ITEM.SCHEM_KEVLAR]: { tag: [0.42, 0.44, 0.3], rot: 0.9 },
  [ITEM.SCHEM_EXPLOSIVES]: { tag: [0.8, 0.46, 0.08], rot: -0.7 },
  [ITEM.SCHEM_METAL]: { tag: [0.5, 0.52, 0.55], rot: 0.1 },
};
function schematic(b, r, id) {
  const look = SCHEM_LOOK[id];
  const R = 0.034, L = 0.44;
  b.group({ p: [0, R, 0], r: [0, look.rot, PI / 2] }, () => {
    labelRoll(b, 'blueprint', R, L, 12, {});
    // rolled ends: paper spiral (light disc + dark core)
    for (const s of [-1, 1]) {
      labelDisc(b, 'blueprint', R, 12, { p: [0, s * L * 0.5, 0], r: [s < 0 ? PI : 0, 0, 0] });
      b.cyl('dark', R * 0.35, R * 0.35, 0.004, 8, { p: [0, s * (L * 0.5 + 0.001), 0] });
      b.torus('paint', R * 0.7, 0.0025, 3, 12, PI * 2, { p: [0, s * (L * 0.5 + 0.0015), 0], r: [PI / 2, 0, 0], c: [0.7, 0.78, 0.9] });
    }
    // loose outer flap curling off the roll
    labelArc(b, 'blueprint', R + 0.003, L * 0.9, 6, 0.3, 1.3, { s: [1.08, 1, 1.2] });
    // string ties
    for (const y of [-0.12, 0.12]) b.torus('rope', R + 0.002, 0.0022, 3, 12, PI * 2, { p: [0, y, 0], r: [PI / 2, 0, 0] });
    // string running off the tie to a cardboard tag lying on the ground (local +X is up, ground at x = -R)
    b.tube('rope', [[0, 0.12, R], [-R * 0.6, 0.13, R + 0.02], [-R + 0.003, 0.14, R + 0.045]], 0.0022, 5, 3);
    b.group({ p: [-R + 0.002, 0.16, R + 0.06], r: [0, 0, 0] }, () => {
      b.box('cardboard', 0.003, 0.075, 0.048, {});
      b.box('paint', 0.004, 0.022, 0.048, { p: [0.0005, 0.02, 0], c: look.tag });
      b.cyl('steel', 0.005, 0.005, 0.004, 6, { p: [0.001, -0.028, 0], r: [0, 0, PI / 2] });
    });
  });
}
for (const id of [ITEM.SCHEM_SHOTGUN, ITEM.SCHEM_RIFLE, ITEM.SCHEM_KEVLAR, ITEM.SCHEM_EXPLOSIVES, ITEM.SCHEM_METAL]) BUILD[id] = (b, r) => schematic(b, r, id);

BUILD[ITEM.JACKET] = (b) => {
  // folded padded jacket: quilted body, sleeves folded across, collar + zipper
  const c = [0.42, 0.33, 0.22];
  b.frustum('cloth', 0.4, 0.34, 0.37, 0.31, 0, 0.06, { c });
  for (let k = 0; k < 4; k++) b.box('dark', 0.37, 0.004, 0.006, { p: [0, 0.061, -0.12 + k * 0.08] });
  b.cylBetween('cloth', [-0.17, 0.075, -0.12], [0.12, 0.075, 0.09], 0.04, 0.045, 7, { c: c.map((x) => x * 0.92) });
  b.cylBetween('cloth', [0.17, 0.09, -0.1], [-0.1, 0.09, 0.1], 0.04, 0.045, 7, { c: c.map((x) => x * 0.86) });
  b.torus('cloth', 0.09, 0.025, 4, 8, PI, { p: [0, 0.05, 0.16], r: [PI / 2, 0, PI], s: [1.3, 1, 1], c: [0.3, 0.24, 0.16] });
  b.box('steel', 0.008, 0.004, 0.3, { p: [0.02, 0.0625, 0] });
};

BUILD[ITEM.KEVLAR] = (b) => {
  // body armour vest lying flat: torso panel, shoulder straps with neck gap, webbing + pouches
  const c = [0.32, 0.36, 0.26];
  b.box('paint', 0.4, 0.05, 0.36, { p: [0, 0.025, -0.02], c });
  for (const x of [-0.13, 0.13]) b.box('paint', 0.11, 0.045, 0.16, { p: [x, 0.023, 0.23], c });
  for (let k = 0; k < 3; k++) b.box('dark', 0.36, 0.006, 0.02, { p: [0, 0.052, -0.14 + k * 0.06] });
  for (const x of [-0.12, 0, 0.12]) b.box('paint', 0.09, 0.05, 0.08, { p: [x, 0.07, -0.13], c: c.map((v) => v * 0.85) });
  b.box('paint', 0.3, 0.012, 0.1, { p: [0, 0.056, 0.05], c: c.map((v) => v * 0.8) });
  labelOn(b, 'numbers', 0.26, 0.08, [0, 0.0625, 0.05], [-PI / 2, 0, PI], 'stencil');
};

// handset on its back: olive body, stub antenna and channel knob at the top, speaker grille, display, orange talk key
BUILD[ITEM.WALKIE] = (b) => {
  b.group({ p: [0, 0.019, 0.03], r: [0, 0.5, 0] }, () => {
    b.box('paint', 0.064, 0.036, 0.14, { c: [0.3, 0.36, 0.26] });
    b.box('dark', 0.044, 0.004, 0.05, { p: [0, 0.019, 0.03] });
    b.box('chrome', 0.04, 0.004, 0.022, { p: [0, 0.019, -0.03] });
    b.cyl('dark', 0.006, 0.008, 0.1, 6, { p: [-0.018, 0.004, -0.12], r: [PI / 2, 0, 0] });
    b.cyl('dark', 0.009, 0.009, 0.016, 8, { p: [0.016, 0.004, -0.078], r: [PI / 2, 0, 0] });
    b.box('paint', 0.006, 0.02, 0.04, { p: [-0.034, 0.002, 0], c: [0.8, 0.4, 0.1] });
  });
};

// loose rounds scattered around a box of width w
function looseRounds(b, r, w, rounds, roundR, roundL, shell = false) {
  for (let k = 0; k < rounds; k++) {
    const a = r() * PI * 2, dd = w * 0.6 + r() * 0.06;
    const x = Math.cos(a) * dd, z = Math.sin(a) * dd;
    b.group({ p: [x, roundR, z], r: [0, r() * PI, PI / 2] }, () => {
      if (shell) {
        b.cyl('paint', roundR, roundR, roundL * 0.75, 8, { p: [0, roundL * 0.12, 0], c: [0.6, 0.12, 0.1] });
        b.cyl('paint', roundR * 1.05, roundR * 1.05, roundL * 0.25, 8, { p: [0, -roundL * 0.37, 0], c: brass });
      } else {
        b.cyl('paint', roundR, roundR, roundL, 6, { c: brass });
        b.cyl('paint', roundR * 0.2, roundR * 0.95, roundL * 0.4, 6, { p: [0, roundL * 0.7, 0], c: [0.6, 0.4, 0.25] });
      }
    });
  }
}
function ammoBox(cell, w, h, d, rounds, roundR, roundL, shell = false) {
  return (b, r) => {
    b.box('cardboard', w, h, d, { p: [0, h / 2, 0], r: [0, 0.2, 0] });
    labelOn(b, cell, w * 0.98, d * 0.96, [0, h + 0.001, 0], [-PI / 2, 0, PI + 0.2]);
    b.plane('labels', w * 0.98, h * 0.9, { atlas: cell, p: [Math.sin(0.2) * -d * 0.51, h / 2, -Math.cos(0.2) * d * 0.51], r: [0, PI + 0.2, 0] });
    looseRounds(b, r, w, rounds, roundR, roundL, shell);
  };
}
BUILD[ITEM.AMMO_9MM] = ammoBox('ammo_9mm', 0.12, 0.045, 0.08, 3, 0.0048, 0.02);
BUILD[ITEM.AMMO_SHELLS] = ammoBox('ammo_shells', 0.14, 0.07, 0.1, 3, 0.0105, 0.07, true);
BUILD[ITEM.AMMO_762] = ammoBox('ammo_762', 0.16, 0.06, 0.1, 4, 0.0055, 0.045);
BUILD[ITEM.AMMO_308] = ammoBox('ammo_308', 0.14, 0.05, 0.09, 3, 0.006, 0.06);
BUILD[ITEM.AMMO_556] = (b, r) => {
  // olive-drab steel ammo can: lid with a carry handle, lot-number plate on the side
  const w = 0.17, h = 0.1, d = 0.07, ry = 0.2;
  b.box('olive', w, h, d, { p: [0, h / 2, 0], r: [0, ry, 0] });
  b.box('olive', w + 0.006, 0.014, d + 0.006, { p: [0, h + 0.004, 0], r: [0, ry, 0], c: [0.85, 0.85, 0.8] });
  b.box('dark', 0.07, 0.008, 0.014, { p: [0, h + 0.015, 0], r: [0, ry, 0] });
  b.box('steel', 0.02, 0.03, 0.012, { p: [Math.cos(ry) * (w / 2 + 0.006), h - 0.012, -Math.sin(ry) * (w / 2 + 0.006)], r: [0, ry, 0] }); // latch
  labelOn(b, 'numbers', w * 0.7, h * 0.35, [Math.sin(ry) * -d * 0.51, h * 0.5, -Math.cos(ry) * d * 0.51], [0, PI + ry, 0]);
  looseRounds(b, r, w, 4, 0.0045, 0.045);
};
// crossbow bolts: a handful bundled with cord, scrap heads all one way
BUILD[ITEM.AMMO_BOLTS] = (b, r) => {
  const L = 0.34, R = 0.0045;
  const spots = [[-0.011, R], [0, R], [0.011, R], [-0.0055, R * 2.8], [0.0055, R * 2.8]];
  for (const [z, y] of spots) {
    b.group({ p: [(r() - 0.5) * 0.03, y, z], r: [0, (r() - 0.5) * 0.06, 0] }, () => {
      b.cylBetween('wood', [-L / 2, 0, 0], [L / 2 - 0.035, 0, 0], R, R, 5, { c: [0.8, 0.66, 0.46] });
      b.cylBetween('steel', [L / 2 - 0.037, 0, 0], [L / 2 + 0.008, 0, 0], 0.0008, 0.0068, 5);
      b.box('paint', 0.06, 0.0014, 0.024, { p: [-L / 2 + 0.045, 0, 0], r: [r() * PI, 0, 0], c: [0.55, 0.1, 0.08] });
    });
  }
  for (const x of [-0.05, 0.06]) b.torus('rope', 0.0145, 0.0022, 4, 10, PI * 2, { p: [x, 0.0095, 0], r: [0, PI / 2, 0], s: [1, 0.8, 1] });
};
// flamethrower fuel: the red steel flask that screws in under the lance, lying on its side
BUILD[ITEM.AMMO_FUEL] = (b) => {
  b.group({ p: [0, 0.039, 0], r: [0, 0.5, PI / 2] }, () => {
    b.lathe('paint', [[0, -0.1], [0.03, -0.1], [0.038, -0.09], [0.038, 0.06], [0.032, 0.082], [0.015, 0.094], [0.015, 0.116], [0, 0.116]], 12, { c: [0.6, 0.14, 0.08] });
    b.cyl('paint', 0.0388, 0.0388, 0.046, 12, { p: [0, -0.015, 0], c: [0.85, 0.8, 0.66], open: true });
    b.cyl('dark', 0.018, 0.018, 0.014, 8, { p: [0, 0.118, 0] });
  });
};

BUILD[ITEM.CAR_BATTERY] = (b) => {
  b.box('plastic', 0.3, 0.2, 0.18, { p: [0, 0.1, 0] });
  labelOn(b, 'carbattery', 0.26, 0.13, [0, 0.12, -0.0905], [0, PI, 0]);
  b.box('plastic', 0.29, 0.02, 0.17, { p: [0, 0.21, 0] });
  b.cyl('paint', 0.015, 0.018, 0.03, 8, { p: [-0.1, 0.235, -0.04], c: [0.6, 0.12, 0.08] });
  b.cyl('steel', 0.015, 0.018, 0.03, 8, { p: [0.1, 0.235, -0.04] });
  b.tube('rubber', [[-0.12, 0.22, 0.04], [0, 0.29, 0.04], [0.12, 0.22, 0.04]], 0.008, 8, 4);
};

BUILD[ITEM.SPARE_TIRE] = (b) => {
  b.lathe('tire', [[0.19, -0.1], [0.28, -0.105], [0.32, -0.06], [0.32, 0.06], [0.28, 0.105], [0.19, 0.1]], 14, { p: [0, 0.105, 0] });
  b.cyl('chrome', 0.19, 0.19, 0.12, 12, { p: [0, 0.105, 0] });
  b.cyl('rust', 0.06, 0.06, 0.14, 6, { p: [0, 0.105, 0] });
};

BUILD[ITEM.SPARK_PLUGS] = (b, r) => {
  b.box('cardboard', 0.1, 0.04, 0.06, { p: [-0.06, 0.02, 0], r: [0, 0.3, 0] });
  for (let k = 0; k < 3; k++) {
    b.group({ p: [0.04 + k * 0.03, 0.011, (k - 1) * 0.03], r: [0, r() * PI, PI / 2] }, () => {
      b.cyl('bone', 0.009, 0.01, 0.04, 6, { p: [0, 0.02, 0] });
      b.cyl('steel', 0.011, 0.011, 0.015, 6, { p: [0, -0.008, 0] });
      b.cyl('chrome', 0.006, 0.006, 0.02, 5, { p: [0, -0.025, 0] });
      b.cyl('steel', 0.004, 0.004, 0.012, 4, { p: [0, 0.045, 0] });
    });
  }
};

BUILD[ITEM.FUEL_CAN] = (b) => {
  const c = [0.6, 0.1, 0.07];
  b.box('paint', 0.34, 0.44, 0.16, { p: [0, 0.22, 0], c });
  for (const s of [-1, 1]) {
    b.box('paint', 0.36, 0.02, 0.012, { p: [0, 0.22, s * 0.083], r: [0, 0, 0.9], c });
    b.box('paint', 0.36, 0.02, 0.012, { p: [0, 0.22, s * 0.083], r: [0, 0, -0.9], c });
  }
  for (const x of [-0.1, 0, 0.1]) b.box('paint', 0.025, 0.07, 0.03, { p: [x, 0.47, 0], c });
  b.box('paint', 0.26, 0.025, 0.035, { p: [0, 0.51, 0], c });
  b.cyl('paint', 0.025, 0.025, 0.06, 8, { p: [0.14, 0.47, 0], r: [0, 0, -0.6], c: [0.3, 0.3, 0.28] });
};

BUILD[ITEM.FAN_BELT] = (b) => {
  b.torus('rubber', 0.12, 0.008, 3, 20, PI * 2, { p: [0, 0.01, 0], r: [PI / 2, 0, 0], s: [1.4, 1, 1] });
  b.torus('rubber', 0.1, 0.008, 3, 20, PI * 2, { p: [0.03, 0.022, 0.01], r: [PI / 2 + 0.1, 0, 0.4], s: [1.3, 1, 1] });
};

// fallback weapon shapes (used only for a weapon weapons.js has no model for)
function FALLBACK_WEAPON(b, id) {
  const gun = (L, stock) => {
    b.box('steel', L, 0.05, 0.04, { p: [0, 0.03, 0] });
    b.cyl('steel', 0.01, 0.01, L * 0.5, 6, { p: [L * 0.6, 0.035, 0], r: [0, 0, PI / 2] });
    if (stock) b.box('wood', 0.3, 0.07, 0.04, { p: [-L * 0.6, 0.035, 0], c: [0.6, 0.45, 0.3] });
    b.box('steel', 0.04, 0.1, 0.03, { p: [-L * 0.2, 0.05, 0.03], r: [PI / 2, 0, 0.3] });
  };
  switch (id) {
    case ITEM.KNIFE:
      b.box('chrome', 0.18, 0.004, 0.03, { p: [0.08, 0.004, 0] });
      b.box('rubber', 0.11, 0.02, 0.025, { p: [-0.07, 0.01, 0] });
      break;
    case ITEM.BAT:
    case ITEM.SPIKED_BAT:
      b.cylBetween('wood', [-0.4, 0.03, 0], [0.4, 0.04, 0], 0.035, 0.018, 8, { c: [0.8, 0.65, 0.45] });
      if (id === ITEM.SPIKED_BAT) for (let k = 0; k < 8; k++) b.cyl('steel', 0.003, 0.003, 0.1, 3, { p: [0.2 + k * 0.025, 0.04, 0], r: [k, 0, 0] });
      break;
    case ITEM.MACHETE:
      b.box('chrome', 0.45, 0.004, 0.06, { p: [0.12, 0.004, 0] });
      b.box('rubber', 0.13, 0.025, 0.03, { p: [-0.18, 0.013, 0] });
      break;
    case ITEM.HAMMER:
      b.cylBetween('wood', [-0.18, 0.015, 0], [0.12, 0.015, 0], 0.014, 0.014, 6, { c: [0.7, 0.55, 0.4] });
      b.box('steel', 0.04, 0.03, 0.12, { p: [0.14, 0.018, 0] });
      break;
    case ITEM.PISTOL:
      gun(0.18, false);
      break;
    case ITEM.SHOTGUN:
      gun(0.6, true);
      break;
    default:
      gun(0.55, true);
  }
}
