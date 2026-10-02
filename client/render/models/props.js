// Procedural world props. createProp(type, seed) -> THREE.Group of plain Meshes (shared geometry + shared
// materials from materials.js), origin at ground centre of the footprint, FRONT facing -Z.
// Footprints / sizes follow shared/props.js.
import * as THREE from 'three';
import { PROPS } from '../../../shared/props.js';
import { MeshBuilder, partsToGroup, makeRng } from '../materials.js';

const PI = Math.PI;
const cache = new Map();

// number of cached visual variants per prop (seed % n)
const VARIANTS = {
  car: 1, car_wreck: 4, pickup_truck: 2, gravestone: 4, grave_cross: 3, barrel: 4, crate: 3, crate_small: 3, chair: 3, fence: 3,
  campfire: 1, heli_wreck: 1, watchtower: 1, water_tower: 1, radio_mast: 1, tent: 2, corpse: 3, bones: 2, pumpkin: 3,
  power_pole: 2, road_sign: 2, tire_pile: 2, sandbags: 2, woodpile: 2, scarecrow: 1, boat: 2,
  // iteration 2
  duffel_bag: 3, locker: 2, cabinet: 2, toolbox: 1, fridge: 2, log_pile: 2, jersey_barrier: 2, camper: 2, school_bus: 2,
  dump_truck: 2, boom_gate: 2, saw_table: 1, gravel_pile: 2, hunting_stand: 1, billboard: 1, motel_sign: 1, satellite_dish: 1,
  fence_chain: 2,
  medicine_cabinet: 1, drug_locker: 1, wheelchair: 1, ambulance: 1,
  strongbox: 1,
};

export const PROP_TYPES = Object.keys(PROPS);

/** @returns {THREE.Group} */
export function createProp(type, seed = 0) {
  const fn = BUILD[type];
  if (!fn) throw new Error(`createProp: unknown prop '${type}'`);
  const n = VARIANTS[type] ?? 3;
  const v = (((seed | 0) % n) + n) % n;
  const key = `${type}:${v}`;
  let parts = cache.get(key);
  if (!parts) {
    const b = new MeshBuilder(hash(type) + v * 7919);
    fn(b, makeRng(hash(type) * 31 + v * 977 + 5), v);
    parts = b.build();
    cache.set(key, parts);
  }
  const g = partsToGroup(parts, type);
  g.userData.propType = type;
  return g;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}
const rr = (r, a, b) => a + (b - a) * r();
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// ------------------------------------------------------------------ shared parts
const WOODS = [[0.95, 0.9, 0.85], [0.8, 0.74, 0.68], [0.7, 0.66, 0.62], [1, 0.95, 0.88], [0.62, 0.56, 0.5]];

/** wheel: axis along X, centred at origin. flat: 0..0.3 squash */
function wheel(b, r, w, { flat = 0, rim = 'chrome', rimR = 0.62, spokes = 0 } = {}) {
  const ri = r * rimR, hw = w / 2;
  b.group({ p: [0, -flat * r * 0.5, 0], s: [1, 1 - flat * 0.5, 1] }, () => {
    const prof = [[ri, hw * 0.8], [r * 0.9, hw], [r, hw * 0.55], [r, -hw * 0.55], [r * 0.9, -hw], [ri, -hw * 0.8]];
    b.lathe('tire', prof, 12, { r: [0, 0, PI / 2] });
    b.cyl(rim, ri, ri, w * 0.72, 10, { r: [0, 0, PI / 2] });
    b.cyl('rust', ri * 0.35, ri * 0.35, w * 0.8, 6, { r: [0, 0, PI / 2] });
  });
}

/** stencil / label quad on a face. dir: 'z-' | 'z+' | 'x-' | 'x+' | 'y+' */
function label(b, mat, atlas, w, h, p, dir = 'z-', rot = 0) {
  const R = { 'z-': [0, PI, rot], 'z+': [0, 0, rot], 'x-': [0, -PI / 2, rot], 'x+': [0, PI / 2, rot], 'y+': [-PI / 2, 0, rot] }[dir];
  b.plane(mat, w, h, { atlas, p, r: R, order: dir === 'y+' ? 'XYZ' : 'YXZ' });
}

/** weeds: crossed alpha cards around points (no sway material) */
function weeds(b, r, pts, h = 0.5) {
  for (const [x, z] of pts) {
    const s = rr(r, 0.6, 1.2);
    for (let k = 0; k < 2; k++) b.plane('weeds', 0.55 * s, h * s, { raw: true, p: [x, (h * s) / 2, z], r: [0, r() * PI + (k * PI) / 2, 0], c: [0.8, 0.8, 0.75] });
  }
}

/** simple plank (grain along its longest axis) */
function plank(b, mat, sx, sy, sz, o = {}) {
  return b.box(mat, sx, sy, sz, { grain: true, ...o });
}

// ------------------------------------------------------------------ vehicles
const CAR_COLORS = [[0.36, 0.45, 0.55], [0.5, 0.36, 0.24], [0.66, 0.6, 0.46], [0.3, 0.4, 0.32], [0.5, 0.18, 0.15], [0.55, 0.55, 0.52]];

function sedan(b, r, o) {
  const col = o.color;
  const W = 1.8, hw = W / 2;
  const fa = -1.4, ra = 1.35, wr = 0.32;
  const sink = o.sink || 0;
  b.push([0, -sink, 0]);
  // lower body side profile (shape x = world z), extruded across the width
  const s = new THREE.Shape();
  s.moveTo(-2.25, 0.27);
  s.lineTo(fa - 0.4, 0.27);
  s.absarc(fa, 0.3, 0.4, PI, 0, true);
  s.lineTo(ra - 0.4, 0.27);
  s.absarc(ra, 0.3, 0.4, PI, 0, true);
  s.lineTo(2.25, 0.27);
  s.lineTo(2.3, 0.42);
  s.lineTo(2.3, 0.8);
  s.lineTo(2.22, 0.9);
  s.lineTo(1.25, 0.92);
  s.lineTo(-0.88, 0.92);
  if (o.hoodOpen) {
    s.lineTo(-0.88, 0.73);
    s.lineTo(-2.14, 0.73);
    s.lineTo(-2.14, 0.86);
  } else s.lineTo(-2.14, 0.88);
  s.lineTo(-2.27, 0.84);
  s.lineTo(-2.31, 0.7);
  s.lineTo(-2.31, 0.4);
  s.lineTo(-2.25, 0.27);
  b.extrude('carpaint', s, W, { r: [0, -PI / 2, 0], p: [hw, 0, 0], c: col });
  // wheel wells (dark chassis block filling the arch tunnel)
  for (const z of [fa, ra]) b.box('dark', W - 0.03, 0.44, 0.82, { p: [0, 0.49, z] });
  if (o.hoodOpen) {
    // fenders + engine bay
    for (const sx of [-1, 1]) b.box('carpaint', 0.12, 0.16, 1.26, { p: [sx * (hw - 0.06), 0.8, -1.51], c: col });
    b.box('dark', W - 0.26, 0.02, 1.24, { p: [0, 0.74, -1.51] });
    b.box('rust', 0.62, 0.3, 0.6, { p: [0.05, 0.86, -1.5] });
    b.box('metal', 0.5, 0.08, 0.5, { p: [0.05, 1.0, -1.5] });
    b.cyl('chrome', 0.2, 0.2, 0.08, 10, { p: [0.05, 1.08, -1.5] });
    b.box('metal', 1.4, 0.3, 0.06, { p: [0, 0.8, -2.08] });
    b.box('rust', 0.3, 0.04, 0.22, { p: [-0.55, 0.76, -1.2] }); // empty battery tray
    b.tube('rubber', [[0.4, 0.95, -1.3], [0.55, 0.9, -1.7], [0.45, 0.85, -2.0]], 0.025, 6, 4);
    b.tube('rubber', [[-0.3, 0.95, -1.6], [-0.45, 0.8, -1.9], [-0.35, 0.8, -2.04]], 0.03, 6, 4);
    // hood hinged at the cowl, propped open
    const ang = 1.05;
    b.group({ p: [0, 0.9, -0.9], r: [ang, 0, 0] }, () => {
      b.box('carpaint', W - 0.12, 0.045, 1.26, { p: [0, 0, -0.63], c: col });
    });
    b.cylBetween('steel', [0.6, 0.66, -2.0], [0.6, 0.9 + Math.sin(ang) * 1.05, -0.9 - Math.cos(ang) * 1.05], 0.008, 0.008, 4);
  } else {
    b.box('carpaint', W - 0.1, 0.04, 1.26, { p: [0, 0.9, -1.52], c: col });
  }
  // greenhouse (dark interior hull) + glass panes + pillars + roof
  const gb = 0.92, gt = 1.42;
  const B = { zf: -0.86, zr: 1.24, x: hw - 0.07 }, T = { zf: -0.12, zr: 0.94, x: hw - 0.2 };
  const C = [];
  for (let k = 0; k < 8; k++) {
    const X = k & 1 ? 1 : -1, top = k & 2, Z = k & 4;
    const q = top ? T : B;
    C.push([X * q.x, top ? gt : gb, Z ? q.zr : q.zf]);
  }
  b.hull('dark', C);
  const lerp3 = (a, c, t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
  const pane = (p0, p1, p2, p3, broken) => {
    // p0,p1 bottom; p3,p2 top (ccw from outside)
    if (broken === 'gone') return;
    b.poly('glass', [p0, p1, p2, p3], [[0, 1, 2], [0, 2, 3]]);
  };
  const out = (p, n, d = 0.006) => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
  const glass = o.glass || ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'];
  // windshield (front, facing -z)
  const wsN = [0, 0.55, -0.83];
  pane(out(lerp3(C[1], C[0], 0.04), wsN), out(lerp3(C[0], C[1], 0.04), wsN), out(lerp3(C[2], C[3], 0.04), wsN), out(lerp3(C[3], C[2], 0.04), wsN), glass[0]);
  // rear window (facing +z)
  const rwN = [0, 0.5, 0.86];
  pane(out(lerp3(C[4], C[5], 0.05), rwN), out(lerp3(C[5], C[4], 0.05), rwN), out(lerp3(C[7], C[6], 0.05), rwN), out(lerp3(C[6], C[7], 0.05), rwN), glass[1]);
  // side windows (front / rear per side)
  for (const sx of [-1, 1]) {
    const bf = sx > 0 ? C[1] : C[0], br = sx > 0 ? C[5] : C[4], tf = sx > 0 ? C[3] : C[2], tr = sx > 0 ? C[7] : C[6];
    const n = [sx, 0.22, 0];
    const bottomAt = (t) => lerp3(bf, br, t), topAt = (t) => lerp3(tf, tr, t);
    const segs = [[0.02, 0.47, 0.05, 0.47], [0.53, 0.97, 0.53, 0.96]];
    segs.forEach(([b0, b1, t0, t1], k) => {
      const q = [out(bottomAt(b0 + 0.06), n), out(bottomAt(b1), n), out(topAt(t1), n), out(topAt(t0 + 0.02), n)];
      const g = glass[2 + (sx > 0 ? 0 : 2) + k];
      if (sx > 0) pane(q[1], q[0], q[3], q[2], g);
      else pane(q[0], q[1], q[2], q[3], g);
    });
    // pillars
    b.beam('carpaint', out(bf, n, 0.01), out(tf, n, 0.01), 0.07, 0.05, { c: col, side: [0, 0, 1] });
    b.beam('carpaint', out(br, n, 0.01), out(tr, n, 0.01), 0.1, 0.05, { c: col, side: [0, 0, 1] });
    b.beam('carpaint', out(bottomAt(0.5), n, 0.01), out(topAt(0.5), n, 0.01), 0.07, 0.05, { c: col, side: [0, 0, 1] });
    // door seams + handles on lower body
    for (const z of [-0.86, 0.46, 1.22]) b.box('dark', 0.01, 0.56, 0.012, { p: [sx * (hw + 0.002), 0.6, z] });
    for (const z of [0.3, 1.05]) b.box('chrome', 0.03, 0.03, 0.12, { p: [sx * (hw + 0.012), 0.8, z] });
    b.box('dark', 0.012, 0.04, 4.3, { p: [sx * (hw + 0.002), 0.45, 0] }); // rub strip
  }
  b.box('carpaint', T.x * 2 + 0.06, 0.05, T.zr - T.zf + 0.08, { p: [0, gt + 0.02, (T.zf + T.zr) / 2], c: col });
  // mirror + antenna
  b.box('chrome', 0.1, 0.09, 0.05, { p: [-(hw + 0.02), 1.0, -0.72] });
  if (!o.noMirrorR) b.box('chrome', 0.1, 0.09, 0.05, { p: [hw + 0.02, 1.0, -0.72] });
  b.cylBetween('steel', [0.75, 0.9, 1.9], [0.8, 1.55, 2.0], 0.004, 0.006, 3);
  // bumpers, grille, lights, plates
  b.box('chrome', W + 0.04, 0.15, 0.12, { p: [0, 0.4, -2.35] });
  b.box('chrome', W + 0.04, 0.15, 0.12, { p: [0, 0.4, 2.35] });
  b.box('dark', 1.0, 0.2, 0.02, { p: [0, 0.64, -2.315] });
  for (let k = 0; k < 4; k++) b.box('chrome', 1.0, 0.018, 0.02, { p: [0, 0.56 + k * 0.05, -2.322] });
  for (const sx of [-1, 1]) {
    for (const k of [0, 1]) {
      const smashed = o.smashed && sx < 0 && k === 0;
      b.box('chrome', 0.2, 0.15, 0.03, { p: [sx * (0.62 + k * 0.2), 0.66, -2.31] });
      b.box(smashed ? 'dark' : 'glass', 0.16, 0.11, 0.02, { p: [sx * (0.62 + k * 0.2), 0.66, -2.327] });
    }
    b.box('taillight', 0.36, 0.14, 0.03, { p: [sx * 0.66, 0.68, 2.31] });
  }
  if (!o.noPlates) {
    label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.58, 2.316], 'z+');
    label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.4, -2.415], 'z-');
  }
  b.pop();
  // wheels
  const wheels = o.wheels || { fl: 'ok', fr: 'ok', rl: 'ok', rr: 'ok' };
  const wpos = { fl: [-0.8, fa], fr: [0.8, fa], rl: [-0.8, ra], rr: [0.8, ra] };
  for (const [k, [x, z]] of Object.entries(wpos)) {
    const st = wheels[k];
    if (st === 'gone') {
      b.cyl('rust', 0.14, 0.14, 0.12, 8, { p: [x * 0.9, 0.33 - sink, z], r: [0, 0, PI / 2] });
      continue;
    }
    if (st === 'rim') {
      b.group({ p: [x, 0.2, z] }, () => b.cyl('rust', 0.21, 0.21, 0.16, 10, { r: [0, 0, PI / 2], s: [1, 1, 1] }));
      continue;
    }
    b.group({ p: [x, wr, z] }, () => wheel(b, wr, 0.2, { flat: st === 'flat' ? 0.3 : 0 }));
  }
}

function cinderBlocks(b, x, z, h) {
  b.box('concrete', 0.4, 0.2, 0.2, { p: [x, 0.1, z], r: [0, 0.15, 0] });
  b.box('concrete', 0.4, 0.2, 0.2, { p: [x, 0.3, z - 0.02], r: [0, -0.1, 0] });
  plank(b, 'wood', 0.3, h - 0.4, 0.3, { p: [x, 0.4 + (h - 0.4) / 2, z], c: WOODS[1] });
}

const BUILD = {};

BUILD.car = (b, r) => {
  b.push([0, 0, 0], [0, 0, 0], [1, 1, 0.952]);
  sedan(b, r, {
    color: [0.34, 0.42, 0.52],
    hoodOpen: true,
    smashed: true,
    wheels: { fl: 'gone', fr: 'ok', rl: 'ok', rr: 'flat' },
    glass: ['ok', 'ok', 'ok', 'gone', 'gone', 'ok'],
  });
  cinderBlocks(b, -0.62, -1.4, 0.3);
  b.box('rust', 0.12, 0.2, 0.3, { p: [-0.72, 0.1, 0.6] }); // jack under the sill
  b.pop();
};

BUILD.car_wreck = (b, r, v) => {
  b.push([0, 0, 0], [0, 0, 0], [1, 1, 4.42 / 4.66]);
  const col = CAR_COLORS[(v + 1) % CAR_COLORS.length].map((c) => c * 0.85);
  sedan(b, r, {
    color: col,
    sink: 0.12,
    smashed: true,
    noPlates: v % 2 === 1,
    noMirrorR: true,
    wheels: v % 2 ? { fl: 'rim', fr: 'flat', rl: 'rim', rr: 'rim' } : { fl: 'flat', fr: 'rim', rl: 'flat', rr: 'rim' },
    glass: ['gone', 'ok', 'gone', 'gone', 'ok', 'gone'],
  });
  // an open door (driver side) and the doorway
  const hx = v % 2 ? 0.9 : -0.9, sg = Math.sign(hx);
  b.box('dark', 0.02, 0.5, 1.2, { p: [hx + sg * 0.003, 0.52, -0.25] });
  b.group({ p: [hx, 0.52, -0.84], r: [0, sg * -0.9, 0] }, () => {
    b.box('carpaint', 0.06, 0.52, 1.25, { p: [sg * 0.03, 0, 0.62], c: col });
    b.beam('carpaint', [sg * 0.03, 0.26, 0.05], [sg * 0.08, 0.72, 0.62], 0.04, 0.04, { c: col });
  });
  b.pop();
  weeds(b, r, [[0.75, -1.6], [-0.75, 1.2], [0.7, 1.9], [-0.7, -0.6], [0.2, 1.95]], 0.55);
};

BUILD.pickup_truck = (b, r, v) => {
  const col = v ? [0.52, 0.2, 0.16] : [0.33, 0.44, 0.42];
  const W = 1.96, hw = W / 2;
  const fa = -1.62, ra = 1.62, wr = 0.38;
  // front body (hood + fenders) profile
  const s = new THREE.Shape();
  s.moveTo(-2.62, 0.4);
  s.lineTo(fa - 0.48, 0.4);
  s.absarc(fa, 0.42, 0.48, PI, 0, true);
  s.lineTo(-0.9, 0.4);
  s.lineTo(-0.9, 1.16);
  s.lineTo(-2.55, 1.12);
  s.lineTo(-2.66, 1.0);
  s.lineTo(-2.66, 0.5);
  s.lineTo(-2.62, 0.4);
  b.extrude('carpaint', s, W, { r: [0, -PI / 2, 0], p: [hw, 0, 0], c: col });
  b.box('dark', W - 0.03, 0.5, 0.95, { p: [0, 0.62, fa] });
  // cab lower
  b.box('carpaint', W, 0.76, 1.42, { p: [0, 0.78, -0.2], c: col });
  // cab greenhouse
  const C = [];
  for (let k = 0; k < 8; k++) {
    const X = k & 1 ? 1 : -1, top = k & 2, Z = k & 4;
    C.push([X * (top ? hw - 0.16 : hw - 0.05), top ? 1.86 : 1.16, Z ? (top ? 0.42 : 0.48) : top ? -0.5 : -0.88]);
  }
  b.hull('dark', C);
  const n = (p, v2, d = 0.008) => [p[0] + v2[0] * d, p[1] + v2[1] * d, p[2] + v2[2] * d];
  // windshield + side windows
  const wsN = [0, 0.45, -0.9];
  b.poly('glass', [n(C[0], wsN), n(C[1], wsN), n(C[3], wsN), n(C[2], wsN)].map((p, i) => [p[0] * 0.94, p[1] + (i < 2 ? 0.03 : -0.03), p[2]]), [[1, 0, 2], [0, 3, 2]]);
  for (const sx of [-1, 1]) {
    const q = sx > 0 ? [C[1], C[5], C[7], C[3]] : [C[0], C[4], C[6], C[2]];
    const nn = [sx, 0.15, 0];
    const qq = q.map((p) => n(p, nn, 0.01)).map((p, i) => [p[0], p[1] + (i < 2 ? 0.05 : -0.04), p[2] + (i === 0 || i === 3 ? 0.08 : -0.08)]);
    if (!(v === 1 && sx < 0)) b.poly('glass', qq, sx > 0 ? [[0, 1, 2], [0, 2, 3]] : [[1, 0, 3], [1, 3, 2]]);
    b.beam('carpaint', n(q[0], nn, 0.012), n(q[3], nn, 0.012), 0.08, 0.05, { c: col });
    b.beam('carpaint', n(q[1], nn, 0.012), n(q[2], nn, 0.012), 0.1, 0.05, { c: col });
    b.box('dark', 0.01, 0.66, 0.012, { p: [sx * (hw + 0.002), 0.8, -0.88] });
    b.box('dark', 0.01, 0.66, 0.012, { p: [sx * (hw + 0.002), 0.8, 0.46] });
    b.box('chrome', 0.03, 0.03, 0.12, { p: [sx * (hw + 0.012), 1.05, 0.3] });
    b.box('chrome', 0.12, 0.16, 0.04, { p: [sx * (hw + 0.06), 1.28, -0.84] });
  }
  b.box('carpaint', W - 0.26, 0.05, 0.98, { p: [0, 1.88, -0.04], c: col });
  // bed
  const bz0 = 0.52, bz1 = 2.66, bl = bz1 - bz0, bzc = (bz0 + bz1) / 2;
  b.box('rust', W - 0.1, 0.06, bl, { p: [0, 0.74, bzc] });
  for (const sx of [-1, 1]) {
    b.box('carpaint', 0.08, 0.5, bl, { p: [sx * (hw - 0.04), 0.98, bzc], c: col });
    b.box('carpaint', 0.12, 0.06, bl, { p: [sx * (hw - 0.05), 1.24, bzc], c: col });
    b.box('carpaint', 0.08, 0.36, bl, { p: [sx * (hw - 0.04), 0.55, bzc], c: col });
    b.cyl('rust', 0.5, 0.5, 0.35, 8, { theta: [-PI / 2, PI], p: [sx * (hw - 0.25), 0.74, ra], r: [0, 0, PI / 2] });
  }
  b.box('carpaint', W - 0.1, 0.52, 0.07, { p: [0, 1.0, bz1 - 0.035], c: col, r: [v ? 0.35 : 0, 0, 0] });
  b.box('carpaint', W - 0.1, 0.5, 0.07, { p: [0, 1.0, bz0 + 0.04], c: col });
  // junk in the bed
  b.group({ p: [0.3, 0.9, 1.9], r: [PI / 2 - 0.15, 0, 0.2] }, () => wheel(b, 0.34, 0.2, { rim: 'rust' }));
  plank(b, 'wood', 0.18, 0.04, 1.9, { p: [-0.5, 0.8, 1.5], r: [0.05, 0.1, 0], c: WOODS[2] });
  b.box('paint', 0.3, 0.4, 0.18, { p: [-0.55, 0.97, 2.3], c: [0.6, 0.12, 0.1] });
  // front: bumper, grille, round headlights
  b.box('chrome', W + 0.06, 0.18, 0.14, { p: [0, 0.48, -2.72] });
  b.box('chrome', W + 0.06, 0.16, 0.12, { p: [0, 0.5, 2.72] });
  b.box('dark', 1.3, 0.38, 0.02, { p: [0, 0.8, -2.665] });
  for (let k = 0; k < 5; k++) b.box('chrome', 1.3, 0.02, 0.03, { p: [0, 0.64 + k * 0.08, -2.672] });
  for (const sx of [-1, 1]) {
    b.cyl('chrome', 0.1, 0.1, 0.05, 10, { p: [sx * 0.78, 0.84, -2.66], r: [PI / 2, 0, 0] });
    b.cyl(sx < 0 && v === 1 ? 'dark' : 'glass', 0.08, 0.08, 0.02, 10, { p: [sx * 0.78, 0.84, -2.69], r: [PI / 2, 0, 0] });
    b.box('taillight', 0.08, 0.26, 0.03, { p: [sx * (hw - 0.06), 1.0, 2.7] });
  }
  label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.72, 2.705], 'z+');
  // wheels
  for (const [x, z, st] of [[-0.86, fa, 'flat'], [0.86, fa, 'ok'], [-0.86, ra, 'ok'], [0.86, ra, v ? 'flat' : 'ok']]) {
    b.group({ p: [x, wr, z] }, () => wheel(b, wr, 0.24, { flat: st === 'flat' ? 0.28 : 0 }));
  }
  weeds(b, r, [[0.8, 0.2], [-0.75, 2.2], [0.7, -2.2]], 0.5);
};

BUILD.tractor = (b, r) => {
  const col = [0.46, 0.15, 0.1];
  // big rear wheels (tractor front faces -Z)
  for (const sx of [-1, 1]) {
    b.group({ p: [sx * 0.78, 0.78, 0.95] }, () => {
      const prof = [[0.5, 0.2], [0.72, 0.22], [0.78, 0.12], [0.78, -0.12], [0.72, -0.22], [0.5, -0.2]];
      b.lathe('tire', prof, 14, { r: [0, 0, PI / 2] });
      b.cyl('paint', 0.5, 0.5, 0.3, 12, { r: [0, 0, PI / 2], c: [0.55, 0.48, 0.25] });
      b.cyl('rust', 0.12, 0.12, 0.42, 6, { r: [0, 0, PI / 2] });
      // tread lugs
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * PI * 2;
        b.box('tire', 0.4, 0.06, 0.1, { p: [0, Math.cos(a) * 0.79, Math.sin(a) * 0.79], r: [a, 0, 0], s: [1, 1, 1] });
      }
    });
    // fender over rear wheel
    b.cyl('paint', 0.86, 0.86, 0.34, 10, { theta: [-PI / 2 - 0.2, PI * 0.8], open: true, p: [sx * 0.78, 0.8, 0.95], r: [0, 0, PI / 2], c: col });
    // front wheels
    b.group({ p: [sx * 0.62, 0.42, -1.25] }, () => wheel(b, 0.42, 0.2, { rim: 'rust', rimR: 0.55 }));
  }
  // chassis / engine hood (long box from front to the seat)
  b.box('rust', 0.5, 0.35, 2.6, { p: [0, 0.62, -0.5] });
  b.frustum('paint', 0.66, 1.9, 0.6, 1.84, 0.78, 1.42, { p: [0, 0, -0.75], c: col });
  b.box('metal', 0.62, 0.52, 0.06, { p: [0, 1.1, -1.72] }); // grille
  for (let k = 0; k < 6; k++) b.box('dark', 0.5, 0.025, 0.02, { p: [0, 0.9 + k * 0.08, -1.755] });
  b.cyl('glass', 0.07, 0.07, 0.04, 8, { p: [-0.2, 1.3, -1.72], r: [PI / 2, 0, 0] });
  b.cyl('dark', 0.07, 0.07, 0.04, 8, { p: [0.2, 1.3, -1.72], r: [PI / 2, 0, 0] });
  // front axle
  b.box('rust', 1.1, 0.12, 0.14, { p: [0, 0.42, -1.25] });
  // exhaust stack + air intake
  b.cyl('rust', 0.05, 0.06, 1.1, 6, { p: [0.2, 1.95, -1.2] });
  b.cyl('rust', 0.07, 0.05, 0.12, 6, { p: [0.2, 2.52, -1.2], r: [0.3, 0, 0] });
  b.cyl('paint', 0.07, 0.07, 0.4, 6, { p: [-0.18, 1.62, -1.3], c: col });
  // operator station: platform, seat, steering
  b.box('rust', 1.2, 0.08, 0.8, { p: [0, 0.82, 0.75] });
  b.box('metal', 0.2, 0.5, 0.3, { p: [0, 1.05, 0.95] });
  b.box('cloth', 0.44, 0.08, 0.4, { p: [0, 1.34, 0.98], c: [0.2, 0.18, 0.16] });
  b.box('cloth', 0.44, 0.35, 0.08, { p: [0, 1.52, 1.18], r: [-0.15, 0, 0], c: [0.2, 0.18, 0.16] });
  b.cylBetween('steel', [0, 1.3, 0.2], [0, 1.72, 0.55], 0.025, 0.025, 5);
  b.torus('dark', 0.19, 0.02, 4, 12, PI * 2, { p: [0, 1.74, 0.58], r: [PI / 2 - 0.6, 0, 0] });
  // roll bar
  for (const sx of [-1, 1]) b.box('paint', 0.08, 1.4, 0.08, { p: [sx * 0.55, 1.55, 1.4], c: [0.3, 0.3, 0.28] });
  b.box('paint', 1.18, 0.08, 0.08, { p: [0, 2.25, 1.4], c: [0.3, 0.3, 0.28] });
  // rear hitch
  b.box('rust', 0.3, 0.1, 0.4, { p: [0, 0.55, 1.65] });
  weeds(b, r, [[0.6, -1.5], [-0.3, 1.5], [-0.6, -0.2]], 0.6);
};

// ------------------------------------------------------------------ camp / outdoor
BUILD.campfire = (b, r) => {
  // ash bed + stones ring + charred teepee
  b.cyl('ash', 0.68, 0.72, 0.05, 14, { p: [0, 0.02, 0] });
  const n = 12;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * PI * 2 + rr(r, -0.1, 0.1);
    const R = 0.8 + rr(r, -0.04, 0.05);
    b.rock('stone_rough', rr(r, 0.14, 0.2), { detail: 0, seed: 40 + k, scale: [1.2, 0.8, 1], sink: 0.2, p: [Math.cos(a) * R, 0.08, Math.sin(a) * R], r: [0, r() * PI, 0] });
  }
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2 + 0.3;
    const L = 0.85;
    const base = [Math.cos(a) * 0.5, 0.06, Math.sin(a) * 0.5];
    const top = [Math.cos(a) * 0.06, 0.52, Math.sin(a) * 0.06];
    b.cylBetween('charred', base, top, 0.035, 0.065, 6);
  }
  // fallen log pieces and embers
  b.cylBetween('charred', [-0.35, 0.07, 0.25], [0.3, 0.07, 0.35], 0.06, 0.07, 6);
  b.cylBetween('charred', [0.25, 0.08, -0.35], [-0.2, 0.06, -0.25], 0.05, 0.06, 6);
  for (let k = 0; k < 7; k++) b.box('ember', 0.07, 0.03, 0.05, { p: [rr(r, -0.25, 0.25), 0.05, rr(r, -0.25, 0.25)], r: [0, r() * 3, 0] });
};

BUILD.tent = (b, r, v) => {
  // A-frame tent, ridge along Z; door at -Z with an open flap; one side sagging
  const L = 2.45, hw = 1.15, H = 1.45;
  const cols = 4, rows = 3;
  const sag = (x, z, side) => {
    const u = (z + L / 2) / L;
    const mid = Math.sin(u * PI);
    return side * mid * (side < 0 ? 0.28 : 0.08);
  };
  const ridgeY = (z) => H - Math.sin(((z + L / 2) / L) * PI) * 0.12;
  const verts = [], faces = [];
  for (const side of [-1, 1]) {
    const base = verts.length;
    for (let i = 0; i <= cols; i++) {
      const z = -L / 2 + (i / cols) * L;
      for (let j = 0; j <= rows; j++) {
        const t = j / rows; // 0 ridge .. 1 ground
        const y = ridgeY(z) * (1 - t) + 0.02;
        let x = side * hw * t;
        const inward = Math.sin(t * PI) * Math.sin((i / cols) * PI) * (side < 0 ? 0.3 : 0.1);
        x -= side * inward;
        verts.push([x, y - (side < 0 ? inward * 0.3 : 0), z]);
      }
    }
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const a = base + i * (rows + 1) + j, bb = a + 1, c = a + rows + 1, d = c + 1;
        if (side > 0) faces.push([a, c, bb], [bb, c, d]);
        else faces.push([a, bb, c], [bb, d, c]);
      }
  }
  b.poly('canvas', verts, faces);
  // back wall (+Z) triangle
  const zb = L / 2;
  b.poly('canvas', [[-hw, 0.02, zb], [hw, 0.02, zb], [0, ridgeY(zb), zb]], [[0, 1, 2]]);
  // front: door opening (dark interior) + flaps
  const zf = -L / 2;
  b.poly('dark', [[-hw * 0.9, 0.02, zb - 0.02], [hw * 0.9, 0.02, zb - 0.02], [0, H - 0.05, zb - 0.02]], [[0, 2, 1]]);
  b.poly('dark', [[-hw * 0.95, 0.01, 1.3], [hw * 0.95, 0.01, 1.3], [hw * 0.95, 0.01, -1.3], [-hw * 0.95, 0.01, -1.3]], [[0, 1, 2], [0, 2, 3]]);
  b.poly('canvas', [[0, ridgeY(zf), zf], [-hw, 0.02, zf], [-0.25, 0.02, zf - 0.02]], [[0, 1, 2]]);
  b.poly('canvas', [[0, ridgeY(zf), zf], [0.2, 0.3, zf - 0.12], [hw * 0.9, 0.02, zf - 0.1]], [[0, 1, 2]]);
  // poles, guy ropes, stakes
  b.cyl('wood', 0.02, 0.02, H, 5, { p: [0, H / 2, zf - 0.01], c: WOODS[2] });
  b.cyl('wood', 0.02, 0.02, H, 5, { p: [0, H / 2, zb + 0.01], c: WOODS[2] });
  b.cylBetween('rope', [0, ridgeY(zf), zf], [0, 0.02, zf - 0.15], 0.006, 0.006, 3);
  b.cylBetween('rope', [0, ridgeY(zb), zb], [0, 0.02, zb + 0.1], 0.006, 0.006, 3);
  for (const [x, z] of [[-hw - 0.06, -1.1], [hw + 0.06, -1.1], [-hw - 0.06, 1.1], [hw + 0.06, 1.1]]) b.cyl('wood', 0.015, 0.008, 0.14, 4, { p: [x, 0.05, z], c: WOODS[1] });
  // tear: dark rip on the sagging side
  b.poly('dark', [[-0.62, 0.62, 0.25], [-0.72, 0.5, 0.55], [-0.66, 0.66, 0.5]], [[0, 1, 2]]);
  if (v === 1) b.box('cloth', 0.9, 0.12, 0.6, { p: [0.3, 0.06, 0.4], c: [0.3, 0.35, 0.45] }); // sleeping bag inside
};

BUILD.log_bench = (b, r) => {
  b.cyl('bark', 0.21, 0.23, 2.1, 7, { p: [0, 0.22, 0], r: [PI / 2, 0, 0.1], grain: true });
  b.disc('woodend', 0.2, 7, { p: [0, 0.22, -1.052], r: [-PI / 2, 0, 0] });
  b.disc('woodend', 0.22, 7, { p: [0, 0.22, 1.052], r: [PI / 2, 0, 0] });
  b.cylBetween('bark', [0.12, 0.3, 0.4], [0.3, 0.42, 0.55], 0.03, 0.05, 5);
  // flattened seat plank on top
  plank(b, 'wood', 0.26, 0.05, 1.7, { p: [0, 0.43, 0], c: WOODS[1] });
};

BUILD.hay_round = (b, r) => {
  b.push([0, 0.75, 0], [0, 0, 0], [1, 1, 0.87]);
  b.cyl('hay', 0.74, 0.75, 1.36, 14, { r: [0, 0, PI / 2] });
  for (const x of [-0.35, 0.35]) b.cyl('rope', 0.755, 0.755, 0.03, 14, { p: [x, 0, 0], r: [0, 0, PI / 2], open: true });
  b.pop();
};

BUILD.hay_square = (b, r) => {
  b.box('hay', 1.18, 0.56, 0.58, { p: [0, 0.29, 0], r: [0, 0, 0.01] });
  for (const x of [-0.3, 0.3]) {
    b.box('rope', 0.02, 0.58, 0.02, { p: [x, 0.29, -0.3] });
    b.box('rope', 0.02, 0.58, 0.02, { p: [x, 0.29, 0.3] });
    b.box('rope', 0.02, 0.02, 0.6, { p: [x, 0.58, 0] });
  }
};

function crateBody(b, r, s, tint) {
  // inner box of planks + edge battens + diagonal braces on the sides
  const t = s * 0.07, h = s / 2;
  b.box('planks', s - 0.02, s - 0.02, s - 0.02, { p: [0, h, 0] });
  const bat = (sx, sy, sz, p, o = {}) => plank(b, 'wood', sx, sy, sz, { p, c: tint, ...o });
  for (const y of [t / 2, s - t / 2]) {
    for (const z of [-h + t / 2, h - t / 2]) bat(s, t, t, [0, y, z]);
    for (const x of [-h + t / 2, h - t / 2]) bat(t, t, s - 2 * t, [x, y, 0]);
  }
  for (const x of [-h + t / 2, h - t / 2]) for (const z of [-h + t / 2, h - t / 2]) bat(t, s - 2 * t, t, [x, h, z]);
  // diagonals on 4 sides
  const d = Math.hypot(s - 2 * t, s - 2 * t);
  for (const [dir, rot] of [['z', 0], ['x', PI / 2]])
    for (const sgn of [-1, 1]) {
      const off = sgn * (h - t / 2 + 0.005);
      b.group({ p: dir === 'z' ? [0, h, off] : [off, h, 0], r: [0, rot, 0] }, () => bat(d, t * 0.9, t * 0.6, [0, 0, 0], { r: [0, 0, PI / 4 * (sgn > 0 ? 1 : -1)] }));
    }
}

BUILD.crate = (b, r, v) => crateBody(b, r, 1, WOODS[v]);
BUILD.crate_small = (b, r, v) => {
  crateBody(b, r, 0.6, WOODS[v + 1]);
  if (v === 2) label(b, 'stencil', 'hazard_small', 0.2, 0.2, [0.1, 0.35, -0.31], 'z-');
};

BUILD.military_crate = (b, r) => {
  b.box('olive', 1.36, 0.58, 0.76, { p: [0, 0.31, 0] });
  b.box('olive', 1.4, 0.1, 0.8, { p: [0, 0.63, 0] }); // lid
  b.box('dark', 1.41, 0.012, 0.81, { p: [0, 0.58, 0] }); // lid seam
  for (const x of [-0.5, 0.5]) {
    b.box('olive', 0.08, 0.6, 0.8, { p: [x, 0.3, 0] });
    b.box('steel', 0.06, 0.08, 0.02, { p: [x, 0.57, -0.405] }); // latches
  }
  for (const sx of [-1, 1]) {
    b.box('steel', 0.02, 0.05, 0.3, { p: [sx * 0.69, 0.42, 0] });
    b.torus('rope', 0.07, 0.012, 4, 8, PI, { p: [sx * 0.71, 0.38, 0], r: [0, PI / 2, PI] });
  }
  label(b, 'stencil', 'army', 0.8, 0.36, [0, 0.33, -0.385], 'z-');
  label(b, 'stencil', 'numbers', 0.6, 0.18, [0.2, 0.685, 0.1], 'y+');
};

// the strongbox down the mine: a steel chest bound in iron, the padlock hanging open on its hasp (front: -z)
BUILD.strongbox = (b) => {
  const steel = [0.12, 0.13, 0.15];
  b.box('paint', 0.86, 0.4, 0.52, { p: [0, 0.2, 0], c: steel });
  b.box('paint', 0.9, 0.17, 0.56, { p: [0, 0.495, 0], c: steel.map((c) => c * 1.12) }); // lid
  b.box('dark', 0.905, 0.012, 0.565, { p: [0, 0.405, 0] }); // lid seam
  b.box('rust', 0.92, 0.04, 0.58, { p: [0, 0.02, 0] }); // skid
  for (const x of [-0.3, 0.3]) {
    b.box('rust', 0.07, 0.6, 0.585, { p: [x, 0.3, 0] }); // iron bands, over the lid and down both faces
    for (const y of [0.1, 0.3, 0.5]) b.cyl('steel', 0.012, 0.012, 0.6, 6, { p: [x, y, 0], r: [PI / 2, 0, 0] }); // rivets, through and through
  }
  for (const sx of [-1, 1]) b.torus('steel', 0.07, 0.012, 4, 8, PI, { p: [sx * 0.45, 0.3, 0], r: [0, PI / 2, PI] }); // drop handles
  b.box('steel', 0.1, 0.16, 0.02, { p: [0, 0.4, -0.29] }); // hasp
  b.group({ p: [0.02, 0.3, -0.31], r: [0, 0, 0.5] }, () => {
    b.box('chrome', 0.09, 0.08, 0.035, { p: [0, -0.04, 0] }); // padlock, sprung
    b.torus('steel', 0.03, 0.008, 4, 8, PI, { p: [0, 0.01, 0] });
  });
};

BUILD.barrel = (b, r, v) => {
  const cols = [[0.55, 0.14, 0.1], [0.2, 0.3, 0.45], [0.3, 0.34, 0.22], null];
  const c = cols[v];
  const mat = c ? 'paint' : 'rust';
  const tilt = v === 3 ? 0.06 : 0;
  b.group({ p: [0, 0, 0], r: [tilt, 0, tilt * 0.5] }, () => {
    b.cyl(mat, 0.3, 0.3, 0.94, 12, { p: [0, 0.47, 0], c });
    for (const y of [0.32, 0.64]) b.cyl(mat, 0.315, 0.315, 0.04, 12, { p: [0, y, 0], open: true, c });
    b.cyl(mat, 0.315, 0.315, 0.04, 12, { p: [0, 0.93, 0], open: true, c });
    b.cyl(mat, 0.315, 0.315, 0.04, 12, { p: [0, 0.02, 0], open: true, c });
    b.cyl('dark', 0.035, 0.035, 0.02, 6, { p: [0.15, 0.95, 0.05] });
    if (v === 0) label(b, 'labels', 'hazard_small', 0.22, 0.22, [0, 0.55, -0.305], 'z-');
  });
};

BUILD.sandbags = (b, r, v) => {
  // 4 staggered courses along a slight arc, bags ~0.62 x 0.2 x 0.55
  const rows = 4;
  for (let j = 0; j < rows; j++) {
    const n = j % 2 ? 3 : 4;
    for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * 0.6 + rr(r, -0.03, 0.03);
      const u = x / 1.2;
      const z = (u * u) * 0.12 - 0.04;
      b.sphere('burlap', 0.5, 6, 4, { p: [x, 0.11 + j * 0.205, z], s: [0.64, 0.24, 0.58 - j * 0.04], r: [0, -u * 0.25 + rr(r, -0.08, 0.08), rr(r, -0.04, 0.04)] });
    }
  }
};

BUILD.heli_wreck = (b, r) => {
  const dark = [0.2, 0.2, 0.18];
  const e = 0.62;
  const prof = (t) => {
    const a = t * PI * 2;
    const cs = Math.cos(a), sn = Math.sin(a);
    return [Math.sign(cs) * Math.abs(cs) ** e, Math.sign(sn) * Math.abs(sn) ** e];
  };
  const secs = [
    { z: -5.2, w: 0.5, h: 0.5, y: -0.35 },
    { z: -4.85, w: 1.6, h: 1.45, y: -0.15 },
    { z: -4.1, w: 2.25, h: 2.1, y: 0.0 },
    { z: -2.9, w: 2.5, h: 2.35, y: 0.05 },
    { z: 0.8, w: 2.5, h: 2.35, y: 0.05 },
    { z: 1.6, w: 1.8, h: 1.75, y: 0.3 },
    { z: 2.3, w: 0.95, h: 1.0, y: 0.55 },
  ];
  // point on the fuselage surface (local frame) at z and around-parameter t
  const fus = (z, t, out = 1.012) => {
    let k = 0;
    while (k < secs.length - 2 && z > secs[k + 1].z) k++;
    const A = secs[k], B = secs[k + 1], f = Math.min(1, Math.max(0, (z - A.z) / (B.z - A.z)));
    const w = A.w + (B.w - A.w) * f, h = A.h + (B.h - A.h) * f, y = A.y + (B.y - A.y) * f;
    const [px, py] = prof(t);
    return [px * w * 0.5 * out, py * h * 0.5 * out + y, z];
  };
  const panel = (mat, z0, z1, t0, t1, out = 1.012) => {
    const zm = (z0 + z1) / 2;
    const c = fus(zm, (t0 + t1) / 2, 0);
    b.quadOut(mat, [fus(z0, t0, out), fus(z1, t0, out), fus(z1, t1, out), fus(z0, t1, out)], [0, c[1], zm]);
  };
  // ---- fuselage, rolled onto its side (local +y now faces +X/up, local -x faces up-left)
  b.push([0.15, 1.28, 0], [0, 0, -0.95]);
  b.loft('olive', secs, prof, 14);
  b.sphere('olive', 0.26, 6, 4, { p: [0, -0.35, -5.2], s: [1, 1, 0.6] });
  b.cyl('charred', 0.47, 0.47, 0.04, 10, { p: [0, 0.55, 2.3], r: [PI / 2, 0, 0] });
  // cockpit glass (windshields, chin windows, doors)
  panel('glass', -4.95, -4.05, 0.03, 0.21);
  panel('glass', -4.95, -4.05, 0.29, 0.47);
  panel('glass', -5.1, -4.45, 0.55, 0.7);
  panel('glass', -5.1, -4.45, 0.8, 0.95);
  panel('glass', -3.9, -3.2, 0.44, 0.56);
  panel('glass', -3.9, -3.2, -0.06, 0.06);
  // open cabin doors (dark holes) + scorch patches
  panel('dark', -2.7, -0.7, 0.42, 0.6, 1.01);
  panel('dark', -2.7, -1.2, -0.08, 0.1, 1.01);
  panel('charred', -1.0, 1.4, 0.15, 0.36, 1.02);
  panel('charred', 0.4, 1.9, 0.6, 0.72, 1.02);
  panel('charred', -4.3, -3.5, 0.62, 0.75, 1.02);
  // engine housing + exhaust on top
  b.frustum('olive', 1.3, 2.6, 1.0, 2.2, 1.05, 1.55, { p: [0, 0, -0.5] });
  b.cylBetween('charred', [0, 1.35, 0.6], [0, 1.5, 1.4], 0.22, 0.26, 7);
  // mast + hub
  b.cyl('steel', 0.13, 0.15, 0.45, 6, { p: [0, 1.75, -0.9] });
  b.cyl('steel', 0.3, 0.3, 0.14, 8, { p: [0, 2.0, -0.9] });
  // skids: upper one intact on struts, lower one crushed
  b.cylBetween('steel', [-1.25, -1.4, -3.4], [-1.25, -1.4, 0.9], 0.055, 0.055, 6);
  b.cylBetween('steel', [-1.25, -1.4, -3.4], [-1.25, -1.2, -3.8], 0.055, 0.055, 6);
  for (const z of [-2.4, 0.1]) b.cylBetween('steel', [-0.95, -1.05, z], [-1.25, -1.4, z], 0.045, 0.045, 5);
  b.cylBetween('steel', [1.0, -1.1, -2.2], [1.15, -1.3, 0.2], 0.05, 0.05, 5);
  // attached tail boom (thin), broken at z~5
  b.loft('olive', [{ z: 2.2, w: 0.72, h: 0.8, y: 0.55 }, { z: 5.0, w: 0.46, h: 0.52, y: 0.5 }], prof, 8);
  b.cyl('charred', 0.24, 0.24, 0.03, 8, { p: [0, 0.5, 5.0], r: [PI / 2, 0, 0], s: [1, 1, 1.1] });
  label(b, 'stencil', 'army', 1.3, 0.5, fus(0.35, 0.5, 1.02), 'x-');
  b.pop();
  // ---- broken tail section lying on the ground, fin + tail rotor
  b.group({ p: [0.6, 0.0, 5.35], r: [-0.22, 0.16, 0] }, () => {
    b.loft('olive', [{ z: 0, w: 0.44, h: 0.5, y: 0.35 }, { z: 2.4, w: 0.32, h: 0.38, y: 0.35 }], prof, 8);
    b.cyl('charred', 0.22, 0.22, 0.03, 8, { p: [0, 0.35, 0], r: [PI / 2, 0, 0] });
    b.hull('olive', [[-0.03, 0.4, 2.0], [0.03, 0.4, 2.0], [-0.03, 1.6, 2.6], [0.03, 1.6, 2.6], [-0.03, 0.4, 2.6], [0.03, 0.4, 2.6], [-0.03, 1.6, 2.95], [0.03, 1.6, 2.95]]);
    b.cyl('steel', 0.07, 0.07, 0.14, 6, { p: [0.1, 1.25, 2.6], r: [0, 0, PI / 2] });
    b.box('paint', 0.03, 1.3, 0.12, { p: [0.18, 1.25, 2.6], r: [0.5, 0, 0], c: dark });
    b.box('olive', 0.9, 0.04, 0.3, { p: [0, 0.4, 1.6] });
  });
  // main rotor: one blade drooped from the hub to the ground, one broken piece nearby
  const hub = [1.3, 2.25, -0.9];
  b.beam('paint', hub, [2.1, 1.5, -2.6], 0.5, 0.05, { c: dark, side: [0, 1, 0] });
  b.beam('paint', [2.1, 1.5, -2.6], [2.3, 0.05, -5.2], 0.5, 0.05, { c: dark, side: [1, 0.3, 0] });
  b.beam('paint', [-1.4, 0.05, -4.8], [-2.2, 0.04, -1.0], 0.5, 0.05, { c: dark, side: [0, 1, 0] });
  b.beam('paint', [-1.2, 0.05, 1.8], [-1.9, 0.12, 5.6], 0.5, 0.05, { c: dark, side: [0.3, 1, 0] });
  // scorched debris
  for (let k = 0; k < 7; k++) b.box('charred', rr(r, 0.2, 0.6), 0.04, rr(r, 0.2, 0.5), { p: [rr(r, -2, 2), 0.02, rr(r, -5, 3)], r: [0, r() * 3, 0] });
  b.box('olive', 0.9, 0.05, 0.7, { p: [-1.8, 0.1, 2.8], r: [0.1, 0.5, 0.15] });
};

BUILD.military_tent = (b, r) => {
  const W = 3.9, L = 5.8, wallH = 1.55, H = 2.55;
  const hw = W / 2, hl = L / 2;
  // walls
  for (const sx of [-1, 1]) {
    b.poly('canvas_mil', [[sx * hw, 0, -hl], [sx * hw, 0, hl], [sx * (hw - 0.05), wallH, hl], [sx * (hw - 0.05), wallH, -hl]], sx > 0 ? [[0, 1, 2], [0, 2, 3]] : [[1, 0, 3], [1, 3, 2]]);
    // roof slopes (slight sag)
    const v = [];
    const f = [];
    for (let i = 0; i <= 4; i++) {
      const z = -hl + (i / 4) * L;
      const sagk = Math.sin((i / 4) * PI) * 0.08;
      v.push([sx * (hw - 0.05), wallH, z], [sx * 0.02, H - sagk, z]);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * 2;
      if (sx > 0) f.push([a, a + 2, a + 1], [a + 1, a + 2, a + 3]);
      else f.push([a, a + 1, a + 2], [a + 1, a + 3, a + 2]);
    }
    b.poly('canvas_mil', v, f);
  }
  // back gable (closed)
  b.poly('canvas_mil', [[-hw, 0, hl], [hw, 0, hl], [hw - 0.05, wallH, hl], [0, H, hl], [-hw + 0.05, wallH, hl]], [[0, 1, 2], [0, 2, 3], [0, 3, 4]]);
  // front gable: upper triangle closed, door open (dark interior back plane), rolled flap
  b.poly('canvas_mil', [[-hw + 0.05, wallH, -hl], [hw - 0.05, wallH, -hl], [0, H, -hl]], [[1, 0, 2]]);
  for (const sx of [-1, 1]) b.poly('canvas_mil', [[sx * hw, 0, -hl], [sx * 0.75, 0, -hl], [sx * 0.75, wallH, -hl], [sx * (hw - 0.05), wallH, -hl]], sx > 0 ? [[1, 0, 3], [1, 3, 2]] : [[0, 1, 2], [0, 2, 3]]);
  b.cyl('canvas_mil', 0.12, 0.12, 1.55, 8, { p: [0, wallH + 0.05, -hl - 0.05], r: [0, 0, PI / 2] });
  b.poly('dark', [[-hw + 0.1, 0.01, hl - 0.1], [hw - 0.1, 0.01, hl - 0.1], [hw - 0.1, 0.01, -hl + 0.1], [-hw + 0.1, 0.01, -hl + 0.1]], [[0, 1, 2], [0, 2, 3]]);
  b.poly('dark', [[-hw + 0.08, 0, hl - 0.06], [hw - 0.08, 0, hl - 0.06], [hw - 0.1, wallH, hl - 0.06], [0, H - 0.08, hl - 0.06], [-hw + 0.1, wallH, hl - 0.06]], [[1, 0, 2], [0, 3, 2], [0, 4, 3]]);
  // poles, ridge, guy lines, stakes
  b.cyl('wood', 0.04, 0.04, H, 6, { p: [0, H / 2, -hl + 0.05], c: WOODS[2] });
  b.cyl('wood', 0.04, 0.04, H, 6, { p: [0, H / 2, hl - 0.05], c: WOODS[2] });
  for (const sx of [-1, 1])
    for (const z of [-hl + 0.3, 0, hl - 0.3]) {
      b.cylBetween('rope', [sx * (hw - 0.05), wallH, z], [sx * (hw + 0.05) * 1.0, 0.02, z], 0.006, 0.006, 3);
    }
  // cot + crate inside the door
  b.box('olive', 0.7, 0.35, 1.9, { p: [-1.1, 0.2, 0.6] });
  b.box('olive', 0.8, 0.5, 0.6, { p: [1.1, 0.25, 1.9] });
};

BUILD.boat = (b, r, v) => {
  const col = v ? [0.5, 0.56, 0.52] : [0.62, 0.62, 0.58];
  const secs = [];
  const N = 7;
  for (let k = 0; k <= N; k++) {
    const t = k / N; // bow (-z) .. stern (+z)
    const z = -2 + t * 4;
    const w = 1.36 * Math.pow(Math.sin(Math.min(1, t * 1.6 + 0.02) * PI * 0.5), 0.8) * (t > 0.85 ? 0.95 : 1);
    const h = 0.62 - (t > 0.1 ? 0 : (0.1 - t) * -1.0);
    secs.push({ z, w: Math.max(0.02, w), h: h * 2, y: 0.64 + (t < 0.15 ? (0.15 - t) * 0.6 : 0), bot: t });
  }
  const hull = (t) => {
    // U-shape from left gunwale (t=0) down to keel and up to right gunwale (t=1)
    const a = (t - 0.5) * PI;
    return [Math.sin(a), -(Math.cos(a) ** 1.4)];
  };
  b.loft('paint', secs, hull, 8, { c: col, flip: true });
  const inner = secs.map((s) => ({ ...s, w: Math.max(0.01, s.w - 0.07), h: s.h - 0.1 }));
  b.loft('wood', inner, hull, 8, { c: WOODS[3] });
  // transom
  const st = secs[N];
  const tv = [];
  for (let k = 0; k <= 8; k++) {
    const [x, y] = hull(k / 8);
    tv.push([x * st.w * 0.5, y * st.h * 0.5 + st.y, st.z]);
  }
  const tf = [];
  for (let k = 1; k < 8; k++) tf.push([0, k, k + 1]);
  b.poly('wood', tv, tf, { c: WOODS[2] });
  // gunwale rails, thwarts, oars
  for (const sx of [-1, 1]) {
    for (let k = 1; k < N; k++) {
      const a = secs[k], c = secs[k + 1];
      b.beam('wood', [sx * a.w * 0.5, a.y + 0.01, a.z], [sx * c.w * 0.5, c.y + 0.01, c.z], 0.05, 0.04, { c: WOODS[1] });
    }
  }
  for (const z of [-0.5, 0.6]) plank(b, 'wood', 1.2, 0.04, 0.22, { p: [0, 0.45, z], c: WOODS[0] });
  plank(b, 'wood', 0.08, 0.03, 2.2, { p: [0.3, 0.2, 0.1], r: [0.05, 0.1, 0], c: WOODS[1] });
  b.box('wood', 0.14, 0.02, 0.5, { p: [0.36, 0.22, 1.2], r: [0.05, 0.1, 0], c: WOODS[1] });
  b.box('water_dark', 0.7, 0.01, 1.8, { p: [0, 0.14, 0.3] });
};

BUILD.gas_pump = (b, r) => {
  const col = [0.62, 0.16, 0.12];
  b.box('concrete', 0.8, 0.14, 0.6, { p: [0, 0.07, 0] });
  b.box('paint', 0.62, 1.3, 0.42, { p: [0, 0.79, 0.02], c: col });
  b.box('paint', 0.66, 0.36, 0.46, { p: [0, 1.62, 0.02], c: [0.8, 0.78, 0.72] });
  b.cyl('paint', 0.23, 0.23, 0.46, 12, { theta: [-PI / 2, PI], p: [0, 1.8, 0.02], r: [PI / 2, 0, 0], c: [0.8, 0.78, 0.72] });
  label(b, 'labels', 'pump', 0.5, 0.5, [0, 1.12, -0.205], 'z-');
  b.box('glass', 0.5, 0.26, 0.01, { p: [0, 1.62, -0.215] });
  // nozzle holster on the side + hose loop
  b.box('steel', 0.08, 0.2, 0.12, { p: [0.35, 1.05, -0.05] });
  b.cylBetween('steel', [0.38, 1.1, -0.08], [0.42, 0.95, -0.2], 0.018, 0.022, 5);
  b.tube('rubber', [[0.31, 0.55, 0.1], [0.38, 0.3, -0.05], [0.42, 0.25, -0.3], [0.4, 0.6, -0.28], [0.4, 0.95, -0.2]], 0.022, 14, 5);
  label(b, 'stencil', 'bullet', 0.04, 0.04, [-0.15, 0.7, -0.195], 'z-');
  label(b, 'stencil', 'bullet', 0.035, 0.035, [0.1, 0.55, -0.195], 'z-');
};

function gravestoneShape(b, r, v) {
  const tilt = [0.04, -0.06, 0.18, -0.1][v];
  b.box('gravestone', 0.62, 0.1, 0.24, { p: [0, 0.05, 0] });
  b.group({ p: [0, 0.1, 0], r: [tilt, 0, tilt * 0.4] }, () => {
    if (v === 0) {
      b.box('gravestone', 0.52, 0.55, 0.16, { p: [0, 0.275, 0] });
      b.cyl('gravestone', 0.26, 0.26, 0.16, 10, { theta: [-PI / 2, PI], p: [0, 0.55, 0], r: [PI / 2, 0, 0] });
      label(b, 'stencil', 'grave', 0.42, 0.21, [0, 0.45, -0.081], 'z-');
    } else if (v === 1) {
      b.box('gravestone', 0.16, 0.78, 0.13, { p: [0, 0.39, 0] });
      b.box('gravestone', 0.5, 0.15, 0.13, { p: [0, 0.56, 0] });
      b.box('gravestone', 0.32, 0.22, 0.18, { p: [0, 0.11, 0] });
    } else if (v === 2) {
      // broken slab: stump + fallen top piece
      b.box('gravestone', 0.5, 0.42, 0.15, { p: [0, 0.21, 0] });
      label(b, 'stencil', 'grave', 0.38, 0.19, [0, 0.24, -0.076], 'z-');
    } else {
      b.frustum('gravestone', 0.46, 0.18, 0.4, 0.15, 0, 0.7, {});
      b.frustum('gravestone', 0.4, 0.15, 0.02, 0.02, 0.7, 0.86, {});
      label(b, 'stencil', 'grave', 0.34, 0.17, [0, 0.46, -0.083], 'z-', 0);
    }
  });
  if (v === 2) b.box('gravestone', 0.5, 0.14, 0.4, { p: [0.08, 0.07, -0.02], r: [0, 0.4, 0.06] });
}
BUILD.gravestone = (b, r, v) => gravestoneShape(b, r, v);

BUILD.grave_cross = (b, r, v) => {
  const tint = WOODS[v + 1].map((c) => c * 0.8);
  b.group({ r: [rr(r, -0.1, 0.1), 0, [0.12, -0.08, 0.2][v]] }, () => {
    plank(b, 'wood', 0.09, 1.4, 0.07, { p: [0, 0.7, 0], c: tint });
    plank(b, 'wood', 0.56, 0.08, 0.06, { p: [0, 1.08, -0.01], r: [0, 0, [0.04, -0.1, 0.25][v]], c: tint });
    if (v === 1) b.torus('rope', 0.05, 0.012, 4, 8, PI * 2, { p: [0, 1.08, -0.02], r: [0, 0, PI / 4] });
    if (v === 2) b.plane('cloth', 0.1, 0.35, { p: [0.15, 0.9, -0.05], r: [0, 0, 0.1], c: [0.5, 0.1, 0.08] });
  });
};

BUILD.fence = (b, r, v) => {
  const tint = WOODS[(v + 2) % WOODS.length];
  for (const x of [-1.44, 1.44]) plank(b, 'wood', 0.12, 1.1 + rr(r, -0.05, 0.05), 0.12, { p: [x, 0.55, 0], r: [rr(r, -0.04, 0.04), 0, rr(r, -0.04, 0.04)], c: tint });
  plank(b, 'wood', 0.1, 1.0, 0.1, { p: [0, 0.5, 0], c: tint, r: [0, 0, 0.03] });
  const ys = [0.95, 0.62, 0.3];
  ys.forEach((y, k) => {
    if (v === 1 && k === 1) {
      // broken rail: two hanging halves
      plank(b, 'wood', 1.4, 0.1, 0.04, { p: [-0.75, y - 0.2, -0.08], r: [0, 0, 0.28], c: tint });
      plank(b, 'wood', 0.9, 0.1, 0.04, { p: [0.95, y - 0.12, -0.08], r: [0, 0, -0.3], c: tint });
      return;
    }
    plank(b, 'wood', 3.0, 0.1, 0.04, { p: [0, y + rr(r, -0.02, 0.02), -0.08], r: [0, 0, rr(r, -0.02, 0.02)], c: tint });
  });
  if (v === 2) weeds(b, r, [[-1.2, 0.1], [0.8, 0.05]], 0.6);
};

BUILD.picnic_table = (b, r) => {
  const t = WOODS[1];
  for (let k = 0; k < 5; k++) plank(b, 'wood', 1.8, 0.05, 0.14, { p: [0, 0.76, -0.3 + k * 0.15], c: t });
  for (const z of [-0.62, 0.62]) {
    plank(b, 'wood', 1.8, 0.05, 0.13, { p: [0, 0.45, z - 0.06], c: t });
    plank(b, 'wood', 1.8, 0.05, 0.13, { p: [0, 0.45, z + 0.08], c: t });
  }
  for (const x of [-0.7, 0.7]) {
    for (const s of [-1, 1]) b.beam('wood', [x, 0, s * 0.72], [x, 0.74, s * 0.05], 0.1, 0.05, { c: t, side: [1, 0, 0] });
    plank(b, 'wood', 0.06, 0.08, 1.5, { p: [x, 0.4, 0], c: t });
  }
};

BUILD.outhouse = (b, r) => {
  const t = WOODS[2];
  // walls (planks) with a slanted tin roof; door faces -Z with moon cutout
  b.box('planks', 1.1, 2.0, 0.05, { p: [0, 1.0, 0.53] });
  for (const sx of [-1, 1]) b.box('planks', 0.05, 2.0, 1.1, { p: [sx * 0.53, 1.0, 0] });
  b.box('planks', 1.1, 0.4, 0.05, { p: [0, 1.95, -0.53] });
  for (const sx of [-1, 1]) for (const z of [-0.53, 0.53]) plank(b, 'wood', 0.08, 2.15, 0.08, { p: [sx * 0.53, 1.07, z], c: t });
  // door slightly ajar
  b.group({ p: [-0.46, 0, -0.56], r: [0, 0.35, 0] }, () => {
    b.box('planks', 0.9, 1.72, 0.04, { p: [0.45, 0.92, 0] });
    for (const y of [0.3, 1.5]) plank(b, 'wood', 0.86, 0.1, 0.03, { p: [0.45, y, -0.03], c: t });
    b.beam('wood', [0.1, 0.35, -0.03], [0.8, 1.45, -0.03], 0.08, 0.03, { c: t });
    label(b, 'stencil', 'moon', 0.22, 0.22, [0.45, 1.6, -0.022], 'z-');
    b.box('rust', 0.04, 0.1, 0.03, { p: [0.8, 0.95, -0.03] });
  });
  b.box('dark', 1.0, 1.9, 0.01, { p: [0, 0.95, -0.5] });
  b.box('tin', 1.4, 0.04, 1.45, { p: [0, 2.2, -0.02], r: [-0.14, 0, 0] });
};

BUILD.water_tower = (b, r) => {
  const legX = 1.6, top = 8;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.box('rust', 0.26, top, 0.26, { p: [sx * legX, top / 2, sz * legX] });
  // cross bracing on each face, 2 levels
  const brace = (a, c) => b.cylBetween('steel', a, c, 0.03, 0.03, 4);
  for (const lvl of [[0.3, 4], [4, 7.7]]) {
    const [y0, y1] = lvl;
    for (const s of [-1, 1]) {
      brace([-legX, y0, s * legX], [legX, y1, s * legX]);
      brace([legX, y0, s * legX], [-legX, y1, s * legX]);
      brace([s * legX, y0, -legX], [s * legX, y1, legX]);
      brace([s * legX, y0, legX], [s * legX, y1, -legX]);
    }
    for (const s of [-1, 1]) {
      b.box('rust', 3.3, 0.12, 0.12, { p: [0, y1, s * legX] });
      b.box('rust', 0.12, 0.12, 3.3, { p: [s * legX, y1, 0] });
    }
  }
  // platform + tank (wooden staves + hoops) + conical roof
  b.box('dockwood', 3.9, 0.12, 3.9, { p: [0, top + 0.06, 0] });
  b.cyl('wood', 1.85, 1.85, 3.3, 16, { p: [0, top + 0.12 + 1.65, 0], grain: true, c: [0.62, 0.55, 0.48] });
  for (const y of [0.4, 1.2, 2.0, 2.8]) b.cyl('rust', 1.88, 1.88, 0.07, 16, { p: [0, top + 0.12 + y, 0], open: true });
  b.cyl('rust', 0.1, 2.05, 0.6, 16, { p: [0, top + 0.12 + 3.3 + 0.3, 0] });
  // railing around platform
  for (const s of [-1, 1]) {
    b.box('rust', 3.9, 0.05, 0.05, { p: [0, top + 1.0, s * 1.93] });
    b.box('rust', 0.05, 0.05, 3.9, { p: [s * 1.93, top + 1.0, 0] });
    for (const t of [-1, 0, 1]) {
      b.box('rust', 0.05, 0.9, 0.05, { p: [t * 1.9, top + 0.55, s * 1.93] });
      b.box('rust', 0.05, 0.9, 0.05, { p: [s * 1.93, top + 0.55, t * 1.9] });
    }
  }
  // ladder on the front leg
  for (const sx of [-0.2, 0.2]) b.box('rust', 0.04, top + 1, 0.04, { p: [legX * -0.2 + sx, (top + 1) / 2, -legX - 0.18] });
  for (let y = 0.4; y < top + 0.8; y += 0.4) b.box('rust', 0.44, 0.03, 0.03, { p: [-legX * 0.2, y, -legX - 0.18] });
  // outlet pipe
  b.cylBetween('rust', [0.4, top, 0.3], [0.5, 0.3, 0.6], 0.07, 0.07, 6);
};

BUILD.watchtower = (b, r) => {
  const L = 1.7, floor = 8;
  const t = WOODS[2];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) plank(b, 'wood', 0.32, floor, 0.32, { p: [sx * L, floor / 2, sz * L], c: t });
  const br = (a, c) => b.beam('wood', a, c, 0.12, 0.08, { c: WOODS[1] });
  for (const [y0, y1] of [[0.4, 4], [4, 7.6]]) {
    for (const s of [-1, 1]) {
      br([-L, y0, s * L], [L, y1, s * L]);
      br([L, y0, s * L], [-L, y1, s * L]);
      br([s * L, y0, -L], [s * L, y1, L]);
      br([s * L, y0, L], [s * L, y1, -L]);
      plank(b, 'wood', 3.6, 0.14, 0.1, { p: [0, y1, s * L], c: t });
      plank(b, 'wood', 0.1, 0.14, 3.6, { p: [s * L, y1, 0], c: t });
    }
  }
  // floor deck
  b.box('planks', 4.0, 0.16, 4.0, { p: [0, floor + 0.08, 0] });
  // cabin: posts, half walls, window frames, pyramid roof
  const cy = floor + 0.16, cH = 2.1, hw = 1.8;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) plank(b, 'wood', 0.14, cH, 0.14, { p: [sx * hw, cy + cH / 2, sz * hw], c: t });
  for (const s of [-1, 1]) {
    b.box('planks', 3.6, 0.95, 0.06, { p: [0, cy + 0.475, s * hw] });
    b.box('planks', 0.06, 0.95, 3.6, { p: [s * hw, cy + 0.475, 0] });
    plank(b, 'wood', 3.7, 0.08, 0.14, { p: [0, cy + 0.98, s * hw], c: t });
    plank(b, 'wood', 0.14, 0.08, 3.7, { p: [s * hw, cy + 0.98, 0], c: t });
    plank(b, 'wood', 3.7, 0.1, 0.1, { p: [0, cy + cH, s * hw], c: t });
    plank(b, 'wood', 0.1, 0.1, 3.7, { p: [s * hw, cy + cH, 0], c: t });
    // mullions + some glass
    for (const k of [-0.6, 0.6]) {
      plank(b, 'wood', 0.06, 1.1, 0.06, { p: [k * hw, cy + 1.55, s * hw], c: t });
      plank(b, 'wood', 0.06, 1.1, 0.06, { p: [s * hw, cy + 1.55, k * hw], c: t });
    }
    if (s > 0) b.box('glass', 1.1, 1.0, 0.02, { p: [0, cy + 1.55, s * hw] });
    b.box('glass', 0.02, 1.0, 0.9, { p: [s * hw, cy + 1.55, s * 1.2] });
  }
  // inner dark floor/back to read as interior
  b.box('dark', 3.4, 0.02, 3.4, { p: [0, cy + 0.01, 0] });
  const ry = cy + cH;
  b.frustum('shingles', 4.3, 4.3, 0.05, 0.05, ry + 0.05, ry + 0.95, {});
  b.box('trim', 4.3, 0.06, 4.3, { p: [0, ry + 0.04, 0] });
  // ladder up the front (-Z) to a trapdoor
  for (const sx of [-0.25, 0.25]) b.box('wood', 0.07, floor + 0.2, 0.07, { p: [sx, (floor + 0.2) / 2, -L - 0.35], r: [0.04, 0, 0], c: t });
  for (let y = 0.35; y < floor; y += 0.35) b.box('wood', 0.5, 0.04, 0.05, { p: [0, y, -L - 0.35 + (floor - y) * 0.02 - 0.16], c: t });
};

BUILD.power_pole = (b, r, v) => {
  const lean = v ? 0.03 : -0.02;
  b.group({ r: [lean, 0, lean * 0.5] }, () => {
    b.cyl('wood', 0.12, 0.16, 9, 8, { p: [0, 4.5, 0], grain: true, c: [0.55, 0.45, 0.38] });
    plank(b, 'wood', 2.0, 0.12, 0.1, { p: [0, 8.3, 0], c: [0.55, 0.47, 0.4] });
    for (const x of [-0.85, -0.3, 0.85]) {
      b.cyl('steel', 0.015, 0.015, 0.12, 4, { p: [x, 8.42, 0] });
      b.cyl('glass', 0.05, 0.06, 0.12, 6, { p: [x, 8.52, 0] });
    }
    b.beam('steel', [-0.6, 8.25, 0], [0, 7.8, 0], 0.03, 0.03);
    b.beam('steel', [0.6, 8.25, 0], [0, 7.8, 0], 0.03, 0.03);
    // transformer can
    if (v === 0) {
      b.cyl('metal', 0.22, 0.22, 0.65, 8, { p: [0, 7.1, -0.3] });
      b.box('rust', 0.1, 0.3, 0.1, { p: [0, 7.1, -0.1] });
    }
    // dangling broken wire
    b.tube('rubber', [[0.85, 8.52, 0], [0.9, 7.4, 0.1], [0.7, 5.6, 0.2], [0.5, 4.4, 0.1]], 0.01, 10, 3);
  });
};

BUILD.streetlight = (b, r) => {
  b.cyl('metal', 0.08, 0.11, 5.7, 8, { p: [0, 2.85, 0] });
  b.cyl('concrete', 0.18, 0.2, 0.25, 8, { p: [0, 0.12, 0] });
  b.tube('metal', [[0, 5.6, 0], [0, 5.85, -0.2], [0, 5.9, -0.8], [0, 5.85, -1.35]], 0.045, 8, 5);
  b.frustum('metal', 0.26, 0.5, 0.2, 0.44, 5.72, 5.9, { p: [0, 0, -1.4] });
  b.box('dark', 0.22, 0.02, 0.4, { p: [0, 5.71, -1.4] });
  b.poly('glass', [[-0.1, 5.7, -1.55], [0.1, 5.7, -1.55], [0.02, 5.62, -1.45]], [[0, 1, 2]]);
  b.cylBetween('rust', [0.1, 0.25, 0], [0.12, 1.5, 0.02], 0.02, 0.02, 4);
};

BUILD.road_sign = (b, r, v) => {
  const bend = v ? 0.12 : -0.08;
  b.cyl('steel', 0.03, 0.03, 2.3, 5, { p: [0, 1.15, 0] });
  b.group({ p: [0, 1.9, -0.035], r: [bend, 0, 0] }, () => {
    b.plane('labels', 0.62, 0.62, { atlas: 'sign', p: [0, 0, -0.012], r: [0, PI, PI / 4] });
    b.box('rust', 0.6, 0.6, 0.012, { p: [0, 0, 0], r: [0, 0, PI / 4] });
  });
};

BUILD.dumpster = (b, r) => {
  const col = [0.24, 0.36, 0.26];
  b.frustum('paint', 1.84, 1.1, 1.9, 1.16, 0.12, 1.2, { c: col });
  b.box('dark', 1.76, 0.02, 1.04, { p: [0, 1.19, 0] });
  for (const sx of [-1, 1]) {
    b.box('paint', 0.06, 0.12, 1.16, { p: [sx * 0.97, 0.9, 0], c: col });
    b.box('steel', 0.1, 0.12, 0.3, { p: [sx * 0.97, 0.5, 0], c: col });
  }
  for (const [x, z] of [[-0.8, -0.45], [0.8, -0.45], [-0.8, 0.45], [0.8, 0.45]]) b.cyl('rubber', 0.07, 0.07, 0.05, 8, { p: [x, 0.07, z], r: [PI / 2, 0, 0] });
  // lids: one closed, one propped open towards the back
  b.box('plastic', 0.92, 0.04, 1.2, { p: [-0.47, 1.22, 0] });
  b.group({ p: [0.47, 1.22, 0.58], r: [-1.2, 0, 0] }, () => b.box('plastic', 0.92, 0.04, 1.2, { p: [0, 0, -0.6] }));
  // garbage bags peeking out
  b.sphere('plastic', 0.3, 7, 5, { p: [0.4, 1.15, -0.15], s: [1, 0.7, 1] });
  b.sphere('plastic', 0.25, 7, 5, { p: [0.65, 1.2, 0.25], s: [1, 0.8, 0.9] });
};

BUILD.well = (b, r) => {
  b.cyl('stone', 0.75, 0.8, 0.85, 12, { p: [0, 0.425, 0], open: true });
  b.cyl('stone', 0.6, 0.6, 0.85, 12, { p: [0, 0.425, 0], open: true, s: [-1, 1, 1] });
  b.torus('stone', 0.68, 0.1, 5, 12, PI * 2, { p: [0, 0.86, 0], r: [PI / 2, 0, 0] });
  b.cyl('water_dark', 0.6, 0.6, 0.02, 10, { p: [0, 0.45, 0] });
  const t = WOODS[2];
  for (const sx of [-1, 1]) plank(b, 'wood', 0.12, 1.95, 0.12, { p: [sx * 0.72, 0.98, 0], c: t });
  // gable roof
  for (const sz of [-1, 1]) b.box('shingles', 1.7, 0.04, 0.72, { p: [0, 2.0, sz * 0.3], r: [sz * 0.6, 0, 0] });
  plank(b, 'wood', 1.7, 0.08, 0.08, { p: [0, 2.2, 0], c: t });
  // crank axle + handle, rope and bucket
  b.cyl('wood', 0.06, 0.06, 1.44, 6, { p: [0, 1.55, 0], r: [0, 0, PI / 2], c: t });
  b.cylBetween('steel', [0.76, 1.55, 0], [0.84, 1.55, 0], 0.015, 0.015, 4);
  b.cylBetween('steel', [0.84, 1.55, 0], [0.84, 1.3, -0.1], 0.015, 0.015, 4);
  b.cylBetween('wood', [0.84, 1.3, -0.1], [0.98, 1.3, -0.1], 0.025, 0.025, 5, { c: t });
  b.cyl('rope', 0.08, 0.08, 0.2, 8, { p: [0, 1.55, 0], r: [0, 0, PI / 2] });
  b.cylBetween('rope', [0, 1.49, 0], [0, 1.1, 0], 0.008, 0.008, 3);
  b.cyl('wood', 0.13, 0.1, 0.2, 8, { p: [0, 1.0, 0], c: WOODS[3] });
  b.torus('rust', 0.13, 0.008, 3, 8, PI, { p: [0, 1.1, 0] });
};

BUILD.woodpile = (b, r, v) => {
  // two end posts with stacked split logs
  const t = WOODS[1];
  for (const sx of [-1, 1]) for (const sz of [-0.3, 0.3]) plank(b, 'wood', 0.08, 1.1, 0.08, { p: [sx * 1.05, 0.55, sz], c: t, r: [0, 0, sx * 0.04] });
  plank(b, 'wood', 2.2, 0.08, 0.1, { p: [0, 0.04, -0.3], c: t });
  plank(b, 'wood', 2.2, 0.08, 0.1, { p: [0, 0.04, 0.3], c: t });
  const rows = v ? 3 : 4;
  for (let j = 0; j < rows; j++) {
    const n = 7 - (j % 2);
    for (let k = 0; k < n; k++) {
      const x = -0.84 + (k + (j % 2) * 0.5) * 0.28 + rr(r, -0.02, 0.02);
      const rad = rr(r, 0.1, 0.13);
      const y = 0.08 + rad + j * 0.23;
      const len = rr(r, 0.8, 0.95);
      const zo = rr(r, -0.05, 0.05);
      const rot = r() * PI;
      b.cyl('bark', rad, rad, len, 5, { p: [x, y, zo], r: [PI / 2, rot, 0], grain: true, open: true });
      for (const e of [-1, 1]) b.disc('woodend', rad, 5, { p: [x, y, zo + e * (len / 2 + 0.002)], r: [e * PI / 2, 0, rot] });
    }
  }
};

BUILD.scarecrow = (b, r) => {
  const t = WOODS[2];
  plank(b, 'wood', 0.09, 2.2, 0.09, { p: [0, 1.1, 0.05], c: t });
  plank(b, 'wood', 1.4, 0.07, 0.07, { p: [0, 1.52, 0.05], c: t });
  // burlap head (face texture wraps a sphere: face at -Z), tilted creepily
  b.group({ p: [0.02, 1.86, 0], r: [0.2, 0.15, 0.32] }, () => {
    b.sphere('scarecrow_head', 0.17, 10, 7, { raw: true, s: [0.95, 1.15, 0.95] });
    b.cyl('hay', 0.07, 0.1, 0.1, 6, { p: [0, -0.2, 0] });
    // hat
    b.cyl('cloth', 0.28, 0.3, 0.02, 12, { p: [0, 0.16, 0], c: [0.18, 0.15, 0.12] });
    b.cyl('cloth', 0.13, 0.15, 0.18, 10, { p: [0, 0.26, 0], c: [0.18, 0.15, 0.12] });
  });
  // tattered coat: torso + ragged hem + sleeves along the crossbar
  const coat = [0.3, 0.27, 0.22];
  b.frustum('cloth', 0.46, 0.26, 0.4, 0.2, 0.95, 1.6, { c: coat });
  for (let k = 0; k < 7; k++) {
    const x = -0.21 + k * 0.07;
    b.plane('cloth', 0.08, rr(r, 0.2, 0.42), { p: [x, 0.85, -0.135], c: coat, r: [0.1, 0, rr(r, -0.2, 0.2)] });
    b.plane('cloth', 0.08, rr(r, 0.2, 0.42), { p: [x, 0.85, 0.135], c: coat, r: [-0.1, PI, rr(r, -0.2, 0.2)] });
  }
  for (const sx of [-1, 1]) {
    b.cyl('cloth', 0.08, 0.1, 0.5, 7, { p: [sx * 0.42, 1.52, 0.03], r: [0, 0, PI / 2], c: coat });
    b.cyl('hay', 0.05, 0.08, 0.14, 5, { p: [sx * 0.72, 1.5, 0.03], r: [0, 0, sx * (PI / 2 + 0.4)] });
    b.plane('cloth', 0.12, 0.25, { p: [sx * 0.55, 1.36, 0.03], c: coat, r: [0, PI / 2, sx * 0.2] });
  }
  b.box('rope', 0.44, 0.03, 0.28, { p: [0, 1.06, 0] });
  b.plane('cloth', 0.12, 0.16, { p: [0.12, 1.3, -0.13], c: [0.4, 0.06, 0.05], r: [0, 0, 0.3] });
  // straw at feet
  b.cyl('hay', 0.2, 0.26, 0.08, 7, { p: [0, 0.04, 0.05] });
};

BUILD.shelf = (b, r) => {
  const hw = 0.88, hd = 0.23;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('steel', 0.04, 2.0, 0.04, { p: [sx * hw, 1.0, sz * hd] });
  const ys = [0.12, 0.6, 1.08, 1.56, 1.96];
  for (const y of ys) b.box('metal', 1.78, 0.03, 0.48, { p: [0, y, 0] });
  const junkCols = [[0.6, 0.12, 0.1], [0.2, 0.3, 0.45], [0.7, 0.6, 0.2], [0.3, 0.34, 0.22], [0.8, 0.78, 0.7]];
  for (let s = 0; s < 4; s++) {
    let x = -0.8;
    while (x < 0.75) {
      const kind = r();
      const y = ys[s] + 0.015;
      if (kind < 0.4) {
        const h = rr(r, 0.1, 0.16);
        b.cyl('paint', 0.045, 0.045, h, 7, { p: [x + 0.05, y + h / 2, rr(r, -0.1, 0.1)], c: pick(r, junkCols) });
        x += 0.12;
      } else if (kind < 0.75) {
        const w = rr(r, 0.2, 0.35), h = rr(r, 0.15, 0.3);
        b.box('cardboard', w, h, rr(r, 0.2, 0.34), { p: [x + w / 2, y + h / 2, 0], r: [0, rr(r, -0.2, 0.2), 0] });
        x += w + 0.04;
      } else if (kind < 0.88) {
        b.cyl('bottle', 0.035, 0.04, 0.2, 6, { p: [x + 0.04, y + 0.1, 0.05] });
        x += 0.1;
      } else x += 0.2;
    }
  }
  b.box('cardboard', 0.4, 0.3, 0.3, { p: [0.4, 0.15, 0.1], r: [0, 0.3, 0.3] });
};

BUILD.bed = (b, r) => {
  for (const sx of [-1, 1]) {
    b.box('steel', 0.04, 0.04, 1.98, { p: [sx * 0.48, 0.3, 0] });
    for (const sz of [-1, 1]) b.box('steel', 0.04, sz > 0 ? 0.95 : 0.55, 0.04, { p: [sx * 0.48, sz > 0 ? 0.475 : 0.275, sz * 0.97] });
  }
  for (const sz of [-1, 1]) b.box('steel', 0.96, 0.04, 0.04, { p: [0, sz > 0 ? 0.92 : 0.52, sz * 0.97] });
  for (let k = 0; k < 5; k++) b.box('steel', 0.02, 0.5, 0.02, { p: [-0.36 + k * 0.18, 0.62, 0.97] });
  b.box('mattress', 0.92, 0.2, 1.9, { p: [0, 0.42, 0], r: [0, 0, 0.02] });
  b.sphere('cloth', 0.28, 7, 4, { p: [0.05, 0.55, 0.72], s: [1.2, 0.3, 0.6], c: [0.7, 0.66, 0.58] });
  b.box('cloth', 0.95, 0.04, 0.9, { p: [0.05, 0.54, -0.35], r: [0, 0.1, 0.05], c: [0.3, 0.32, 0.28] });
  b.plane('cloth', 0.9, 0.4, { p: [0.5, 0.36, -0.35], r: [0, PI / 2, 0.1], c: [0.3, 0.32, 0.28] });
};

BUILD.table = (b, r) => {
  const t = WOODS[1];
  for (let k = 0; k < 5; k++) plank(b, 'wood', 1.5, 0.05, 0.18, { p: [0, 0.77, -0.36 + k * 0.18], c: t });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) plank(b, 'wood', 0.07, 0.74, 0.07, { p: [sx * 0.66, 0.37, sz * 0.36], c: t });
  for (const sz of [-1, 1]) plank(b, 'wood', 1.3, 0.08, 0.03, { p: [0, 0.68, sz * 0.36], c: t });
  b.cyl('bottle', 0.035, 0.04, 0.25, 6, { p: [0.4, 0.92, 0.1] });
  b.cyl('paint', 0.05, 0.05, 0.11, 7, { p: [-0.3, 0.85, -0.1], c: [0.7, 0.6, 0.2] });
  b.plane('blood_decal', 0.4, 0.4, { raw: true, p: [0.1, 0.8, 0.15], r: [-PI / 2, 0, 0.5] });
};

BUILD.chair = (b, r, v) => {
  const t = WOODS[(v + 1) % 5];
  const tipped = v === 2;
  b.group(tipped ? { p: [0, 0.25, 0.1], r: [-PI / 2 + 0.05, 0.4, 0] } : { p: [0, 0, 0], r: [0, v ? 0.3 : 0, 0] }, () => {
    b.push(tipped ? [0, -0.25, 0] : [0, 0, 0]);
    plank(b, 'wood', 0.44, 0.04, 0.42, { p: [0, 0.46, 0], c: t });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) plank(b, 'wood', 0.04, 0.46, 0.04, { p: [sx * 0.19, 0.23, sz * 0.18], c: t });
    for (const sx of [-1, 1]) plank(b, 'wood', 0.04, 0.46, 0.04, { p: [sx * 0.19, 0.69, 0.19], c: t });
    for (const y of [0.62, 0.78, 0.9]) plank(b, 'wood', 0.42, 0.06, 0.025, { p: [0, y, 0.19], c: t });
    b.pop();
  });
};

BUILD.pallet = (b, r) => {
  const t = WOODS[3];
  for (const z of [-0.45, 0, 0.45]) plank(b, 'wood', 1.2, 0.09, 0.1, { p: [0, 0.065, z], c: t });
  for (let k = 0; k < 7; k++) {
    if (k === 4) continue;
    plank(b, 'wood', 0.12, 0.025, 1.0, { p: [-0.54 + k * 0.18, 0.1375, 0], c: t });
  }
  for (let k = 0; k < 3; k++) plank(b, 'wood', 0.12, 0.02, 1.0, { p: [-0.5 + k * 0.5, 0.01, 0], c: t });
};

BUILD.tire_pile = (b, r, v) => {
  const n = v ? 3 : 4;
  for (let k = 0; k < n; k++) {
    const R = 0.36;
    const x = rr(r, -0.15, 0.15), z = rr(r, -0.15, 0.15);
    b.group({ p: [x, 0.11 + k * 0.2, z], r: [rr(r, -0.05, 0.05), 0, rr(r, -0.05, 0.05)] }, () => {
      const prof = [[0.2, -0.1], [0.3, -0.11], [R, -0.06], [R, 0.06], [0.3, 0.11], [0.2, 0.1]];
      b.lathe('tire', prof, 12, {});
    });
  }
  if (v) b.group({ p: [0.45, 0.35, -0.2], r: [0.2, 0.4, PI / 2 - 0.3] }, () => b.lathe('tire', [[0.2, -0.1], [0.3, -0.11], [0.35, -0.06], [0.35, 0.06], [0.3, 0.11], [0.2, 0.1]], 12, {}));
};

BUILD.pew = (b, r) => {
  const t = [0.55, 0.42, 0.34];
  plank(b, 'wood', 2.5, 0.05, 0.42, { p: [0, 0.45, -0.04], c: t });
  plank(b, 'wood', 2.5, 0.42, 0.04, { p: [0, 0.73, 0.2], r: [-0.12, 0, 0], c: t });
  plank(b, 'wood', 2.5, 0.06, 0.07, { p: [0, 0.94, 0.23], c: t });
  for (const sx of [-1, 1]) {
    b.box('wood', 0.06, 0.72, 0.5, { p: [sx * 1.27, 0.36, 0.02], c: t });
    b.cyl('wood', 0.25, 0.25, 0.06, 8, { theta: [0, PI], p: [sx * 1.27, 0.72, 0.02], r: [0, 0, PI / 2], c: t });
  }
  plank(b, 'wood', 2.4, 0.1, 0.03, { p: [0, 0.28, -0.24], c: t });
  if (r() < 2) b.box('cloth', 0.2, 0.03, 0.14, { p: [0.6, 0.485, -0.05], r: [0, 0.3, 0], c: [0.25, 0.1, 0.08] }); // hymn book
};

BUILD.altar = (b, r) => {
  b.box('stone', 1.6, 0.9, 0.62, { p: [0, 0.45, 0] });
  b.box('stone', 1.8, 0.1, 0.8, { p: [0, 0.95, 0] });
  b.box('cloth', 1.7, 0.02, 0.72, { p: [0, 1.01, 0], c: [0.7, 0.66, 0.56] });
  b.plane('cloth', 1.3, 0.55, { p: [0, 0.72, -0.365], r: [0, PI, 0], c: [0.7, 0.66, 0.56] });
  b.plane('blood_decal', 0.5, 0.5, { raw: true, p: [-0.3, 1.025, 0.05], r: [-PI / 2, 0, 1.2] });
  for (const [x, h] of [[-0.6, 0.22], [-0.45, 0.15], [0.55, 0.26], [0.68, 0.12], [0.2, 0.08]]) {
    b.cyl('bone', 0.025, 0.028, h, 6, { p: [x, 1.02 + h / 2, rr(r, -0.15, 0.2)] });
  }
  b.box('rust', 0.04, 0.4, 0.04, { p: [0, 1.22, 0.2] });
  b.box('rust', 0.24, 0.04, 0.04, { p: [0, 1.3, 0.2] });
};

BUILD.corpse = (b, r, v) => {
  const shirt = [[0.45, 0.4, 0.34], [0.3, 0.34, 0.42], [0.5, 0.22, 0.18]][v];
  const jeans = [0.24, 0.28, 0.36];
  b.plane('blood_decal', 1.4, 1.4, { raw: true, p: [0.1, 0.012, -0.3], r: [-PI / 2, 0, r() * 3] });
  // lying face down, head toward -Z
  b.sphere('cloth', 0.2, 8, 5, { p: [0, 0.13, -0.28], s: [1.05, 0.55, 1.6], c: shirt });
  b.sphere('cloth', 0.18, 7, 4, { p: [0, 0.11, 0.08], s: [0.95, 0.55, 0.9], c: jeans });
  b.sphere('flesh', 0.11, 8, 6, { p: [0.03, 0.12, -0.72], s: [0.9, 0.95, 1.05] });
  b.sphere('cloth', 0.115, 8, 5, { p: [0.03, 0.15, -0.72], s: [0.95, 0.85, 1.05], c: [0.12, 0.1, 0.08], thetaLen: PI * 0.55 });
  b.cylBetween('flesh', [0.04, 0.12, -0.6], [0.03, 0.12, -0.52], 0.05, 0.05, 6);
  // arms: one along the body, one reaching forward
  b.cylBetween('cloth', [0.2, 0.1, -0.46], [0.26, 0.08, -0.1], 0.05, 0.06, 6, { c: shirt });
  b.cylBetween('flesh', [0.26, 0.08, -0.1], [0.24, 0.06, 0.15], 0.04, 0.045, 6);
  b.cylBetween('cloth', [-0.2, 0.1, -0.46], [-0.3, 0.08, -0.78], 0.05, 0.06, 6, { c: shirt });
  b.cylBetween('flesh', [-0.3, 0.08, -0.78], [-0.24, 0.06, -1.02], 0.04, 0.045, 6);
  // legs
  b.cylBetween('cloth', [0.09, 0.1, 0.2], [0.14, 0.08, 0.68], 0.075, 0.08, 6, { c: jeans });
  b.cylBetween('cloth', [-0.09, 0.1, 0.2], [-0.2, 0.08, 0.66], 0.075, 0.08, 6, { c: jeans });
  b.box('dark', 0.1, 0.1, 0.24, { p: [0.15, 0.06, 0.8], r: [-0.3, 0, 0] });
  b.box('dark', 0.1, 0.1, 0.24, { p: [-0.21, 0.06, 0.77], r: [-0.3, 0, 0.3] });
  // exposed wound
  b.sphere('blood', 0.07, 6, 4, { p: [-0.06, 0.2, -0.32], s: [1.4, 0.5, 1] });
};

BUILD.body_bag = (b, r) => {
  const prof = (t) => {
    const a = t * PI * 2;
    return [Math.cos(a), Math.max(-0.7, Math.sin(a))];
  };
  const secs = [
    { z: -0.95, w: 0.28, h: 0.2, y: 0.1 },
    { z: -0.8, w: 0.44, h: 0.3, y: 0.14 },
    { z: -0.62, w: 0.36, h: 0.26, y: 0.13 },
    { z: -0.4, w: 0.56, h: 0.34, y: 0.15 },
    { z: 0.1, w: 0.52, h: 0.3, y: 0.14 },
    { z: 0.6, w: 0.42, h: 0.24, y: 0.12 },
    { z: 0.88, w: 0.36, h: 0.26, y: 0.13 },
    { z: 0.95, w: 0.2, h: 0.16, y: 0.09 },
  ];
  b.loft('plastic', secs, prof, 10, {});
  b.box('steel', 0.015, 0.012, 1.6, { p: [0.04, 0.3, -0.05], r: [0, 0.02, 0] });
  b.box('cloth', 0.06, 0.005, 0.1, { p: [0.08, 0.28, 0.9], c: [0.8, 0.7, 0.3] });
};

BUILD.lantern_post = (b, r) => {
  const t = WOODS[2];
  plank(b, 'wood', 0.1, 2.0, 0.1, { p: [0, 1.0, 0], c: t });
  plank(b, 'wood', 0.05, 0.05, 0.35, { p: [0, 1.9, -0.15], c: t });
  b.cylBetween('rust', [0, 1.9, -0.3], [0, 1.78, -0.3], 0.006, 0.006, 3);
  b.group({ p: [0, 1.52, -0.3] }, () => {
    b.cyl('rust', 0.07, 0.08, 0.04, 8, { p: [0, 0, 0] });
    b.cyl('glass', 0.06, 0.06, 0.16, 8, { p: [0, 0.1, 0] });
    b.cyl('rust', 0.02, 0.08, 0.06, 8, { p: [0, 0.21, 0] });
    b.torus('rust', 0.06, 0.006, 3, 10, PI, { p: [0, 0.24, 0] });
    for (const a of [0, PI / 2, PI, PI * 1.5]) b.box('rust', 0.01, 0.16, 0.01, { p: [Math.cos(a) * 0.065, 0.1, Math.sin(a) * 0.065] });
  });
};

BUILD.mailbox = (b, r) => {
  plank(b, 'wood', 0.09, 1.0, 0.09, { p: [0, 0.5, 0], c: WOODS[2], r: [0.03, 0, 0.04] });
  b.group({ p: [0, 1.02, 0], r: [0, 0, 0.04] }, () => {
    b.box('wood', 0.16, 0.04, 0.4, { p: [0, 0, 0.02], c: WOODS[1] });
    b.box('paint', 0.2, 0.12, 0.46, { p: [0, 0.08, 0], c: [0.5, 0.5, 0.48] });
    b.cyl('paint', 0.1, 0.1, 0.46, 8, { theta: [-PI / 2, PI], p: [0, 0.14, 0], r: [PI / 2, 0, 0], c: [0.5, 0.5, 0.48] });
    b.box('rust', 0.2, 0.22, 0.01, { p: [0, 0.14, -0.235], r: [0.4, 0, 0] });
    b.box('paint', 0.015, 0.14, 0.03, { p: [0.11, 0.2, 0.08], c: [0.6, 0.1, 0.08] });
    b.box('paint', 0.015, 0.05, 0.09, { p: [0.11, 0.26, 0.05], c: [0.6, 0.1, 0.08] });
  });
};

BUILD.pumpkin = (b, r, v) => {
  const g = new THREE.SphereGeometry(0.22, 12, 7);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.08 * Math.cos(a * 8);
    const cave = v === 2 && x > 0.1 && y > -0.05 ? 0.75 : 1;
    pos.setXYZ(i, x * k * cave, y * 0.72, z * k * cave);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * 0.5);
  b.add('pumpkin', g, { p: [0, 0.16, 0], raw: true, s: [1, 1, 1] });
  b.cylBetween('bark_dead', [0, 0.3, 0], [0.03, 0.38, 0.02], 0.02, 0.03, 5);
  if (v === 1) {
    // carved face, rotten
    b.poly('dark', [[-0.1, 0.22, -0.2], [-0.03, 0.22, -0.215], [-0.065, 0.28, -0.21]], [[0, 1, 2]]);
    b.poly('dark', [[0.03, 0.22, -0.215], [0.1, 0.22, -0.2], [0.065, 0.28, -0.21]], [[0, 1, 2]]);
    b.poly('dark', [[-0.11, 0.13, -0.2], [0.11, 0.13, -0.2], [0.06, 0.08, -0.205], [-0.06, 0.08, -0.205]], [[0, 1, 2], [0, 2, 3]]);
  }
};

BUILD.bones = (b, r, v) => {
  // skull
  b.group({ p: [0.12, 0.08, -0.15], r: [0.3, r() * 3, 0.2] }, () => {
    b.sphere('bone', 0.085, 8, 6, { s: [0.85, 0.9, 1.1] });
    b.box('bone', 0.1, 0.05, 0.08, { p: [0, -0.06, -0.06] });
    for (const sx of [-1, 1]) b.sphere('dark', 0.022, 5, 4, { p: [sx * 0.032, 0.0, -0.085] });
  });
  const bone = (a, c, rad = 0.018) => {
    b.cylBetween('bone', a, c, rad, rad, 5);
    b.sphere('bone', rad * 1.7, 4, 2, { p: a });
    b.sphere('bone', rad * 1.7, 4, 2, { p: c });
  };
  for (let k = 0; k < (v ? 4 : 6); k++) {
    const x = rr(r, -0.35, 0.35), z = rr(r, -0.3, 0.35), a = r() * PI, L = rr(r, 0.2, 0.42);
    bone([x, 0.025, z], [x + Math.cos(a) * L, 0.025, z + Math.sin(a) * L], rr(r, 0.012, 0.02));
  }
  // ribs
  for (let k = 0; k < 4; k++) b.torus('bone', 0.12, 0.008, 3, 6, PI * 0.8, { p: [-0.15 + k * 0.06, 0.03, 0.2], r: [PI / 2, 0.2, 0] });
};

BUILD.dock_post = (b, r) => {
  b.cyl('wood', 0.13, 0.15, 2.5, 8, { p: [0, 1.25, 0], grain: true, c: [0.55, 0.48, 0.4], cfn: (x, y, z, c) => (y < 0.8 ? c.multiply(new THREE.Color(0.6, 0.72, 0.5)) : c) });
  b.cyl('wood', 0.1, 0.13, 0.08, 8, { p: [0, 2.54, 0], c: [0.5, 0.44, 0.38] });
  b.torus('rope', 0.15, 0.025, 5, 10, PI * 2, { p: [0, 2.1, 0], r: [PI / 2, 0, 0] });
  b.torus('rope', 0.15, 0.025, 5, 10, PI * 2, { p: [0, 2.03, 0], r: [PI / 2, 0, 0.2] });
  b.tube('rope', [[0.15, 2.05, 0], [0.4, 1.4, -0.1], [0.3, 0.3, -0.2], [0.5, 0.02, -0.4]], 0.02, 8, 4);
};

BUILD.fuel_tank = (b, r) => {
  const col = [0.72, 0.72, 0.66];
  b.cyl('paint', 1.0, 1.0, 4.2, 14, { p: [0, 1.2, 0], r: [PI / 2, 0, 0], c: col });
  for (const sz of [-1, 1]) b.sphere('paint', 1.0, 14, 5, { thetaLen: PI / 2, p: [0, 1.2, sz * 2.1], r: [sz * PI / 2, 0, 0], s: [1, 0.35, 1], c: col });
  for (const z of [-1.4, 1.4]) {
    b.box('concrete', 1.8, 0.35, 0.4, { p: [0, 0.175, z] });
    b.cyl('rust', 1.03, 1.03, 0.14, 14, { theta: [PI / 2, PI], p: [0, 1.25, z], r: [PI / 2, 0, 0], open: true });
  }
  b.cyl('rust', 0.25, 0.25, 0.15, 8, { p: [0, 2.3, 0.8] });
  b.cylBetween('rust', [0.5, 2.1, -1.5], [0.5, 2.5, -1.5], 0.04, 0.04, 5);
  b.cylBetween('rust', [0.7, 0.6, 2.3], [0.7, 0.2, 2.5], 0.05, 0.05, 5);
  label(b, 'stencil', 'flammable', 1.6, 0.8, [1.005, 1.3, 0], 'x+');
  label(b, 'stencil', 'flammable', 1.6, 0.8, [-1.005, 1.3, 0], 'x-');
  for (let y = 0.5; y < 2.2; y += 0.35) b.box('rust', 0.4, 0.03, 0.03, { p: [0, y, -2.62] });
  for (const sx of [-0.2, 0.2]) b.box('rust', 0.03, 2.0, 0.03, { p: [sx, 1.1, -2.62] });
};

BUILD.radio_mast = (b, r) => {
  const H = 14.8, s0 = 0.55, s1 = 0.35;
  const half = (y) => s0 + (s1 - s0) * (y / H);
  const corners = (y) => {
    const h = half(y);
    return [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]];
  };
  for (let k = 0; k < 4; k++) b.cylBetween('steel', corners(0)[k], corners(H)[k], 0.035, 0.045, 4, { open: true });
  const step = 1.3;
  for (let y = 0; y < H - 0.1; y += step) {
    const a = corners(y), c = corners(Math.min(H, y + step));
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      b.cylBetween('steel', a[k], c[k2], 0.012, 0.012, 3, { open: true });
      b.cylBetween('steel', a[k], a[k2], 0.012, 0.012, 3, { open: true });
    }
  }
  b.box('concrete', 1.3, 0.2, 1.3, { p: [0, 0.1, 0] });
  // antennas + dead red light
  b.cyl('steel', 0.03, 0.03, 1.2, 4, { p: [0, H + 0.4, 0] });
  b.sphere('emissive_red', 0.07, 6, 4, { p: [0, H + 1.0, 0] });
  b.box('metal', 0.25, 0.9, 0.08, { p: [0.4, H - 1.2, 0], r: [0, 0.4, 0] });
  b.box('metal', 0.25, 0.9, 0.08, { p: [-0.4, H - 2.0, 0.1], r: [0, -0.5, 0] });
  b.box('paint', 0.5, 0.6, 0.3, { p: [0, 1.0, -0.6], c: [0.5, 0.5, 0.45] });
};

BUILD.generator = (b, r) => {
  const col = [0.75, 0.6, 0.15];
  // tube frame
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.cyl('steel', 0.025, 0.025, 0.9, 5, { p: [sx * 0.62, 0.55, sz * 0.38] });
  for (const y of [0.1, 1.0])
    for (const sz of [-1, 1]) {
      b.cyl('steel', 0.025, 0.025, 1.24, 5, { p: [0, y, sz * 0.38], r: [0, 0, PI / 2] });
    }
  for (const sx of [-1, 1]) for (const y of [0.1, 1.0]) b.cyl('steel', 0.025, 0.025, 0.76, 5, { p: [sx * 0.62, y, 0], r: [PI / 2, 0, 0] });
  // engine + alternator + tank
  b.box('paint', 0.55, 0.5, 0.5, { p: [-0.25, 0.38, 0], c: [0.2, 0.2, 0.2] });
  b.cyl('paint', 0.22, 0.22, 0.5, 10, { p: [0.3, 0.36, 0], r: [0, 0, PI / 2], c: col });
  b.box('paint', 0.9, 0.22, 0.55, { p: [0, 0.85, 0], c: col });
  b.cyl('chrome', 0.07, 0.07, 0.04, 8, { p: [-0.2, 0.98, 0] });
  b.box('dark', 0.2, 0.14, 0.02, { p: [0.4, 0.55, -0.26] });
  b.cyl('rust', 0.07, 0.07, 0.4, 6, { p: [-0.25, 0.4, 0.3], r: [0, 0, PI / 2] });
  for (const sx of [-1, 1]) b.group({ p: [0.62 * sx, 0.12, 0.44] }, () => wheel(b, 0.12, 0.08, { rim: 'steel' }));
};

BUILD.cart = (b, r) => {
  const t = WOODS[2];
  // bed
  for (let k = 0; k < 7; k++) plank(b, 'wood', 1.4, 0.05, 0.28, { p: [0, 0.72, -0.9 + k * 0.29], c: t });
  for (const sx of [-1, 1]) {
    plank(b, 'wood', 0.08, 0.1, 2.1, { p: [sx * 0.66, 0.67, 0], c: t });
    plank(b, 'wood', 0.05, 0.24, 2.0, { p: [sx * 0.68, 0.9, 0], c: t });
    for (const z of [-0.9, 0, 0.9]) plank(b, 'wood', 0.05, 0.4, 0.06, { p: [sx * 0.68, 0.9, z], c: t });
    // shafts toward -Z, tips resting on the ground
    b.beam('wood', [sx * 0.4, 0.66, -0.9], [sx * 0.34, 0.06, -1.3], 0.06, 0.06, { c: t });
  }
  plank(b, 'wood', 1.4, 0.24, 0.05, { p: [0, 0.9, 1.0], c: t });
  // spoked wheels
  for (const sx of [-1, 1]) {
    b.group({ p: [sx * 0.76, 0.55, 0.15] }, () => {
      b.torus('wood', 0.52, 0.04, 4, 14, PI * 2, { r: [0, PI / 2, 0], c: WOODS[1] });
      b.torus('rust', 0.55, 0.012, 3, 14, PI * 2, { r: [0, PI / 2, 0] });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * PI * 2;
        b.cylBetween('wood', [0, 0, 0], [0, Math.cos(a) * 0.5, Math.sin(a) * 0.5], 0.018, 0.022, 4, { c: WOODS[1] });
      }
      b.cyl('wood', 0.08, 0.08, 0.14, 8, { r: [0, 0, PI / 2], c: WOODS[1] });
    });
  }
  b.cyl('rust', 0.035, 0.035, 1.6, 6, { p: [0, 0.55, 0.15], r: [0, 0, PI / 2] });
  // hay in the bed
  b.sphere('hay', 0.5, 8, 5, { p: [0.1, 0.78, 0.2], s: [1.1, 0.5, 1.6] });
};

// ================================================================== iteration 2 props
/** close a loft end: fan from the ring of section `sec` to a (bulged) centre point */
function loftCap(b, mat, sec, profile, N, bulge, o = {}) {
  const ring = [];
  for (let k = 0; k <= N; k++) {
    const [px, py] = profile(k / N, sec);
    ring.push([px * sec.w * 0.5 + (sec.x || 0), py * sec.h * 0.5 + (sec.y || 0), sec.z]);
  }
  const c = [sec.x || 0, sec.y || 0, sec.z + bulge];
  const verts = [c, ...ring];
  const faces = [];
  for (let k = 1; k <= N; k++) faces.push(bulge < 0 ? [0, k + 1, k] : [0, k, k + 1]);
  b.poly(mat, verts, faces, o);
}

// ------------------------------------------------------------------ searchable containers
const BAG_COLS = [[0.36, 0.38, 0.24], [0.15, 0.15, 0.16], [0.2, 0.26, 0.38]];

BUILD.duffel_bag = (b, r, v) => {
  const col = BAG_COLS[v % 3];
  const trim = col.map((c) => c * 0.62);
  // soft padded body, built along Z then turned so the long axis runs along X
  const prof = (t) => {
    const a = t * PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    return [Math.sign(c) * Math.abs(c) ** 0.72, Math.max(-0.84, Math.sign(s) * Math.abs(s) ** 0.8)];
  };
  const L = 0.76, W0 = 0.38, H0 = 0.31, yc = 0.132;
  const ts = [0, 0.03, 0.1, 0.3, 0.5, 0.7, 0.9, 0.97, 1];
  const secs = ts.map((t) => {
    const e = Math.sqrt(Math.max(0, 1 - Math.abs(2 * t - 1) ** 6));
    const sag = 1 - 0.13 * Math.sin(t * PI) * (t > 0.4 ? 1.2 : 0.8); // half-empty: the middle slumps
    return { z: -L / 2 + t * L, w: Math.max(0.02, W0 * e * (1 + 0.05 * Math.sin(t * PI))), h: Math.max(0.02, H0 * e * sag), y: yc - (1 - sag) * 0.1 };
  });
  const N = 10;
  b.push([0, 0, 0], [0, PI / 2, 0]);
  b.loft('cloth', secs, prof, N, { c: col });
  loftCap(b, 'cloth', secs[0], prof, N, -0.012, { c: trim });
  loftCap(b, 'cloth', secs[secs.length - 1], prof, N, 0.012, { c: trim });
  // two webbing bands around the body
  for (const t of [0.3, 0.7]) {
    const s = secs[ts.indexOf(t)];
    b.loft('cloth', [-0.022, 0.022].map((dz) => ({ ...s, z: s.z + dz, w: s.w * 1.04, h: s.h * 1.04 })), prof, N, { c: trim });
  }
  const topAt = (t) => {
    const s = secs.reduce((a, c) => (Math.abs(c.z - (-L / 2 + t * L)) < Math.abs(a.z - (-L / 2 + t * L)) ? c : a));
    return s.y + s.h / 2;
  };
  // zipper: closed half + open slit showing the dark inside and a crumpled shirt
  const zipPts = [];
  for (const t of [0.1, 0.2, 0.3, 0.4, 0.5]) zipPts.push([0, topAt(t) + 0.002, -L / 2 + t * L]);
  b.tube('rubber', zipPts, 0.0045, 6, 3);
  b.box('steel', 0.018, 0.006, 0.03, { p: [0.012, topAt(0.5) + 0.004, -L / 2 + 0.5 * L], r: [0, 0.4, 0.2] });
  b.sphere('dark', 0.5, 8, 4, { p: [0, topAt(0.7) - 0.018, -L / 2 + 0.7 * L], s: [0.075, 0.03, 0.3] });
  b.sphere('cloth', 0.5, 7, 4, { p: [0.01, topAt(0.66) - 0.004, -L / 2 + 0.66 * L], s: [0.07, 0.035, 0.1], r: [0.2, 0.3, 0], c: v === 1 ? [0.5, 0.18, 0.14] : [0.62, 0.58, 0.5] });
  for (const sx of [-1, 1]) b.box('cloth', 0.012, 0.018, 0.2, { p: [sx * 0.04, topAt(0.7) - 0.004, -L / 2 + 0.7 * L], r: [0, 0, sx * 0.5], c: trim });
  // carry handles flopped over the top
  for (const z of [-0.07, 0.07]) {
    const y = topAt(0.5);
    b.tube('cloth', [[-0.13, y - 0.07, z], [-0.08, y + 0.01, z], [0.0, y + 0.035, z + 0.01], [0.07, y + 0.02, z], [0.12, y - 0.05, z]], 0.011, 8, 4, { c: trim });
  }
  // end loop + side pocket
  b.torus('cloth', 0.03, 0.007, 3, 8, PI, { p: [0, secs[1].y + 0.02, -L / 2 - 0.004], r: [0, PI / 2, 0], c: trim });
  b.box('cloth', 0.02, 0.1, 0.16, { p: [W0 / 2 - 0.004, yc, -0.1], r: [0, 0, -0.08], c: col.map((c) => c * 0.9) });
  b.pop();
  // shoulder strap lying on the ground
  b.tube('cloth', [[-0.36, 0.17, 0.03], [-0.34, 0.03, -0.14], [-0.15, 0.008, -0.22], [0.1, 0.008, -0.2], [0.3, 0.012, -0.18], [0.37, 0.12, -0.03]], 0.012, 14, 4, { c: trim, s: [1, 1, 1] });
};

const LOCKER_COLS = [[0.44, 0.5, 0.45], [0.34, 0.42, 0.52]];

BUILD.locker = (b, r, v) => {
  const col = LOCKER_COLS[v];
  const inner = col.map((c) => c * 0.42);
  const W = 0.94, H = 1.88, D = 0.48, y0 = 0.05, t = 0.02;
  const hy = y0 + (H - y0) / 2, hh = H - y0;
  const zf = -D / 2;
  b.box('dark', W - 0.06, y0, D - 0.06, { p: [0, y0 / 2, 0.01] }); // plinth
  // shell: back, sides, top, bottom, divider
  b.box('paint', W, hh, t, { p: [0, hy, D / 2 - t / 2], c: col });
  for (const sx of [-1, 1]) b.box('paint', t, hh, D, { p: [sx * (W / 2 - t / 2), hy, 0], c: col });
  b.box('paint', W, t, D, { p: [0, H - t / 2, 0], c: col });
  b.box('paint', W, t, D, { p: [0, y0 + t / 2, 0], c: col });
  b.box('paint', t, hh, D, { p: [0, hy, 0], c: col });
  // shadowed interior of the right compartment (door ajar)
  const cx = W / 4;
  b.box('paint', W / 2 - t * 1.5, hh - t * 2, 0.01, { p: [cx, hy, D / 2 - t - 0.006], c: inner });
  for (const sx of [-1, 1]) b.box('paint', 0.006, hh - t * 2, D - t, { p: [cx + sx * (W / 4 - t * 0.8), hy, 0], c: inner.map((c) => c * 1.2) });
  b.box('paint', W / 2 - t * 1.5, 0.006, D - t, { p: [cx, H - t - 0.004, 0], c: inner.map((c) => c * 0.7) });
  b.box('steel', W / 2 - t * 1.5, 0.015, D - 0.05, { p: [cx, 1.56, 0.01] }); // hat shelf
  b.box('cardboard', 0.22, 0.14, 0.26, { p: [cx + 0.04, 1.64, 0.04], r: [0, 0.2, 0] });
  // hanging jacket + boots on the floor
  b.cylBetween('steel', [cx, 1.5, 0.0], [cx, 1.44, -0.02], 0.006, 0.006, 3);
  b.group({ p: [cx - 0.02, 1.43, -0.02], r: [0.06, 0.25, 0.04] }, () => {
    b.frustum('cloth', 0.34, 0.1, 0.3, 0.09, -0.62, 0, { c: [0.3, 0.26, 0.18] });
    for (const sx of [-1, 1]) b.cylBetween('cloth', [sx * 0.14, -0.04, 0], [sx * 0.16, -0.5, 0.02], 0.045, 0.04, 5, { c: [0.27, 0.23, 0.16] });
  });
  for (const x of [cx - 0.08, cx + 0.08]) b.box('rubber', 0.1, 0.12, 0.26, { p: [x, y0 + t + 0.06, 0.02], r: [0, x > cx ? 0.2 : -0.1, 0] });
  // door: panel + louvres + handle + number plate. Built from its hinge (local x=0) toward dir.
  const dw = W / 2 - 0.02, dh = hh - 0.06;
  const door = (dir, hasLock) => {
    const cxl = (dir * dw) / 2;
    b.box('paint', dw, dh, 0.018, { p: [cxl, 0, 0], c: col.map((c) => c * 1.04) });
    b.box('paint', dw - 0.06, 0.012, 0.012, { p: [cxl, dh / 2 - 0.02, -0.012], c: col });
    b.box('paint', dw - 0.06, 0.012, 0.012, { p: [cxl, -dh / 2 + 0.02, -0.012], c: col });
    for (const vy of [dh / 2 - 0.12, -dh / 2 + 0.14])
      for (let k = 0; k < 5; k++) b.plane('dark', dw * 0.6, 0.011, { p: [cxl, vy - k * 0.028, -0.0095], r: [0, PI, 0] });
    const hx = dir * (dw - 0.05);
    b.box('chrome', 0.03, 0.12, 0.02, { p: [hx, 0.05, -0.018] });
    if (hasLock) {
      b.box('steel', 0.04, 0.05, 0.012, { p: [hx, -0.05, -0.014] });
      b.torus('steel', 0.018, 0.004, 3, 8, PI * 2, { p: [hx, -0.1, -0.026] });
    }
    b.plane('labels', 0.08, 0.04, { atlas: 'plate', p: [cxl, dh / 2 - 0.3, -0.0095], r: [0, PI, 0] });
    // the inside of the door (seen when it hangs open)
    b.box('paint', dw - 0.04, dh - 0.04, 0.01, { p: [cxl, 0, 0.012], c: inner.map((c) => c * 1.5) });
  };
  // left door closed (hinge on the outer left edge), slightly dented
  b.group({ p: [-W / 2 + 0.012, hy, zf - 0.012], r: [0.006, 0, 0.004] }, () => door(1, true));
  b.box('dark', 0.004, hh - 0.04, 0.004, { p: [0, hy, zf - 0.004] });
  // right door hanging ajar on its right-hand hinge
  b.group({ p: [W / 2 - 0.012, hy, zf - 0.01], r: [0, -1.05, 0] }, () => door(-1, false));
  for (const x of [-0.18, 0.2]) b.box('dark', 0.1, 0.004, 0.08, { p: [x, H + 0.002, 0.05], r: [0, r() * 2, 0] });
  if (v === 0) b.box('cardboard', 0.34, 0.14, 0.3, { p: [-0.18, H + 0.07, 0.02], r: [0, 0.25, 0] });
  else b.box('cloth', 0.3, 0.05, 0.3, { p: [0.2, H + 0.025, 0.04], r: [0, -0.4, 0], c: [0.3, 0.32, 0.26] });
};

BUILD.cabinet = (b, r, v) => {
  const col = v ? [0.5, 0.62, 0.52] : [0.8, 0.74, 0.58];
  const W = 1.2, H = 0.9, D = 0.55, kick = 0.08;
  const zf = -D / 2 + 0.03;
  b.box('dark', W - 0.1, kick, D - 0.1, { p: [0, kick / 2, 0.04] });
  b.box('paint', W, H - kick - 0.035, D - 0.03, { p: [0, kick + (H - kick - 0.035) / 2, 0.015], c: col });
  plank(b, 'wood', W + 0.03, 0.035, D + 0.02, { p: [0, H - 0.0175, 0], c: WOODS[4].map((c) => c * 0.9) });
  // shadowed openings behind the pulled drawer / open door
  b.box('dark', 0.54, 0.15, 0.004, { p: [0.29, 0.75, zf - 0.001] });
  b.box('dark', 0.54, 0.5, 0.004, { p: [-0.29, 0.36, zf - 0.001] });
  const face = (w, h, framed) => {
    b.box('paint', w, h, 0.02, { c: col.map((c) => c * 1.05) });
    if (framed) {
      const f = col.map((c) => c * 0.86);
      for (const sy of [-1, 1]) b.box('paint', w - 0.08, 0.025, 0.012, { p: [0, sy * (h / 2 - 0.05), -0.014], c: f });
      for (const sx of [-1, 1]) b.box('paint', 0.025, h - 0.08, 0.012, { p: [sx * (w / 2 - 0.05), 0, -0.014], c: f });
    }
  };
  const knob = (p) => b.cyl('chrome', 0.014, 0.012, 0.025, 6, { p, r: [PI / 2, 0, 0] });
  // drawers: left closed, right pulled out
  b.group({ p: [-0.29, 0.75, zf - 0.01] }, () => {
    face(0.55, 0.16, false);
    knob([0, 0, -0.022]);
  });
  const out = 0.16;
  b.group({ p: [0.29, 0.75, zf - 0.01 - out], r: [0, 0.03, 0] }, () => {
    face(0.55, 0.16, false);
    knob([0, 0, -0.022]);
    for (const sx of [-1, 1]) b.box('wood', 0.015, 0.12, 0.34, { p: [sx * 0.25, -0.01, 0.18], c: col.map((c) => c * 0.8) });
    b.box('dark', 0.48, 0.005, 0.3, { p: [0, -0.05, 0.17] });
    b.box('paint', 0.1, 0.04, 0.06, { p: [0.08, -0.03, 0.1], r: [0, 0.4, 0], c: [0.7, 0.62, 0.3] });
  });
  // doors: right closed, left ajar
  b.group({ p: [0.29, 0.36, zf - 0.01] }, () => {
    face(0.55, 0.5, true);
    knob([-0.22, 0.14, -0.022]);
  });
  b.group({ p: [-0.565, 0.36, zf - 0.01], r: [0, 0.55, 0] }, () => {
    b.group({ p: [0.275, 0, 0] }, () => {
      face(0.55, 0.5, true);
      knob([0.22, 0.14, -0.022]);
    });
  });
  // clutter on top
  b.cyl('paint', 0.06, 0.06, 0.14, 8, { p: [0.35, H + 0.07, 0.05], c: [0.62, 0.2, 0.12] });
  b.cyl('bottle', 0.035, 0.04, 0.24, 6, { p: [0.15, H + 0.12, 0.12] });
  b.box('cloth', 0.26, 0.012, 0.2, { p: [-0.3, H + 0.006, 0.0], r: [0, 0.4, 0], c: [0.55, 0.5, 0.4] });
  if (v === 0) b.box('cardboard', 0.3, 0.2, 0.26, { p: [-0.25, H + 0.1, 0.08], r: [0, -0.2, 0] });
};

BUILD.toolbox = (b, r) => {
  const red = [0.62, 0.11, 0.08];
  b.box('paint', 0.52, 0.17, 0.25, { p: [0, 0.09, 0], c: red });
  b.box('rust', 0.5, 0.008, 0.23, { p: [0, 0.004, 0] });
  b.frustum('paint', 0.53, 0.26, 0.49, 0.17, 0.176, 0.225, { c: red.map((c) => c * 1.05) });
  b.box('dark', 0.535, 0.008, 0.262, { p: [0, 0.174, 0] });
  for (const sx of [-1, 1]) {
    b.box('chrome', 0.035, 0.05, 0.012, { p: [sx * 0.17, 0.17, -0.131] });
    b.box('steel', 0.03, 0.05, 0.03, { p: [sx * 0.12, 0.245, 0] });
    b.box('rust', 0.02, 0.02, 0.255, { p: [sx * 0.255, 0.012, 0] }); // rusty feet rails
  }
  b.cyl('steel', 0.011, 0.011, 0.28, 6, { p: [0, 0.272, 0], r: [0, 0, PI / 2] });
  b.cyl('rubber', 0.017, 0.017, 0.15, 6, { p: [0, 0.272, 0], r: [0, 0, PI / 2] });
  // screwdriver + wrench on the lid
  b.cylBetween('steel', [-0.2, 0.232, 0.05], [-0.02, 0.232, 0.08], 0.004, 0.004, 4);
  b.cylBetween('paint', [-0.02, 0.232, 0.08], [0.07, 0.234, 0.095], 0.011, 0.011, 6, { c: [0.8, 0.62, 0.1] });
  b.box('steel', 0.2, 0.006, 0.022, { p: [0.08, 0.229, -0.05], r: [0, -0.3, 0] });
  b.torus('steel', 0.017, 0.006, 3, 7, PI * 1.5, { p: [0.175, 0.229, -0.08], r: [PI / 2, 0, 0.6] });
  label(b, 'stencil', 'bullet', 0.03, 0.03, [0.1, 0.1, -0.1255], 'z-');
};

BUILD.fridge = (b, r, v) => {
  const col = [0.8, 0.78, 0.68];
  const W = 0.78, D = 0.64, H = 1.78, y0 = 0.08;
  const zf = -D / 2 + 0.02;
  b.box('dark', W - 0.06, y0, D - 0.06, { p: [0, y0 / 2, 0.02] });
  for (let k = 0; k < 4; k++) b.box('steel', W - 0.1, 0.01, 0.01, { p: [0, 0.018 + k * 0.018, -D / 2 + 0.05] });
  const bh = H - y0 - 0.05, by = y0 + bh / 2;
  if (v === 1) {
    // hollow shell: the main compartment is open
    b.box('paint', W, bh, 0.03, { p: [0, by, D / 2 + 0.005], c: col });
    for (const sx of [-1, 1]) b.box('paint', 0.03, bh, D, { p: [sx * (W / 2 - 0.015), by, 0.02], c: col });
    b.box('paint', W, 0.04, D, { p: [0, y0 + 0.02, 0.02], c: col });
    b.box('paint', W, 0.48, D, { p: [0, 1.5, 0.02], c: col });
  } else b.box('paint', W, bh, D, { p: [0, by, 0.02], c: col });
  // rounded crown
  b.cyl('paint', 0.05, 0.05, W, 8, { p: [0, H - 0.05, zf + 0.05], r: [0, 0, PI / 2], c: col, theta: [PI, PI / 2] });
  b.box('paint', W, 0.05, D - 0.05, { p: [0, H - 0.025, 0.045], c: col });
  // coil grille on the back + power cord
  b.box('dark', W - 0.12, H - 0.4, 0.02, { p: [0, 0.95, D / 2 + 0.03] });
  b.tube('rubber', [[0.25, 0.3, D / 2 + 0.03], [0.3, 0.1, D / 2 + 0.08], [0.2, 0.01, D / 2 + 0.2]], 0.008, 6, 3);
  // freezer door (top) + fridge door
  const doorF = (h, handleY, handleL) => {
    b.box('paint', W - 0.01, h, 0.05, { p: [0, 0, -0.025], c: col.map((c) => c * 1.03) });
    b.box('rubber', W - 0.03, 0.012, 0.012, { p: [0, -h / 2 + 0.006, 0.003] });
    b.box('rubber', W - 0.03, 0.012, 0.012, { p: [0, h / 2 - 0.006, 0.003] });
    const hx = -W / 2 + 0.06;
    b.cylBetween('chrome', [hx, handleY - handleL / 2, -0.085], [hx, handleY + handleL / 2, -0.085], 0.014, 0.014, 6);
    for (const s of [-1, 1]) b.box('chrome', 0.03, 0.03, 0.04, { p: [hx, handleY + s * handleL * 0.4, -0.065] });
  };
  b.group({ p: [0, 1.5, zf] }, () => {
    doorF(0.46, -0.1, 0.18);
    b.box('chrome', 0.16, 0.035, 0.008, { p: [0.12, 0.15, -0.054] }); // badge
  });
  b.box('dark', W, 0.02, 0.03, { p: [0, 1.26, zf - 0.01] });
  if (v === 1) {
    // main door hanging open on its right hinge: rotten interior
    const iz = zf + 0.01;
    b.box('paint', W - 0.06, 1.1, 0.01, { p: [0, 0.68, D / 2 - 0.04], c: [0.3, 0.3, 0.26] });
    for (const sx of [-1, 1]) b.box('paint', 0.01, 1.1, D - 0.1, { p: [sx * (W / 2 - 0.035), 0.68, 0.02], c: [0.45, 0.44, 0.38] });
    b.box('paint', W - 0.06, 0.01, D - 0.1, { p: [0, 1.23, 0.02], c: [0.4, 0.4, 0.35] });
    b.box('paint', W - 0.06, 0.01, D - 0.1, { p: [0, 0.14, 0.02], c: [0.25, 0.24, 0.2] });
    for (const y of [0.5, 0.86]) b.box('steel', W - 0.08, 0.008, D - 0.14, { p: [0, y, 0.04] });
    b.cyl('bottle', 0.035, 0.035, 0.22, 6, { p: [-0.2, 0.62, 0.1] });
    b.cyl('paint', 0.05, 0.05, 0.1, 7, { p: [0.15, 0.56, 0.0], c: [0.6, 0.5, 0.2] });
    b.box('cardboard', 0.18, 0.2, 0.1, { p: [0.12, 0.97, 0.12] });
    b.sphere('blood', 0.06, 6, 3, { p: [-0.1, 0.9, -0.02], s: [1.6, 0.4, 1.2] });
    b.group({ p: [W / 2, 0.66, iz], r: [0, -1.25, 0] }, () => {
      b.group({ p: [-W / 2 + 0.005, 0, 0] }, () => doorF(1.12, 0.3, 0.3));
      b.box('paint', W - 0.08, 1.02, 0.02, { p: [-W / 2 + 0.005, 0, 0.012], c: [0.66, 0.64, 0.56] });
      for (const y of [-0.3, 0.1]) b.box('plastic', W - 0.12, 0.08, 0.07, { p: [-W / 2, y, 0.05] });
    });
  } else {
    b.group({ p: [0, 0.66, zf] }, () => doorF(1.12, 0.3, 0.3));
    b.plane('blood_decal', 0.34, 0.5, { raw: true, p: [0.12, 0.62, zf - 0.052], r: [0, PI, 0.3] });
  }
  // rust streaks creeping up from the base
  for (const x of [-0.3, 0.1, 0.33]) b.box('rust', 0.05 + r() * 0.04, 0.12 + r() * 0.12, 0.004, { p: [x, y0 + 0.08, -D / 2 + 0.018] });
  b.box('cardboard', 0.3, 0.02, 0.24, { p: [0.05, H + 0.01, 0.05], r: [0, 0.3, 0] });
};

// ---- Mercy Clinic (shared/clinic.js)
// medicine cabinet: white enamelled steel, drawers below, two doors above - one shut with a red cross on it, the
// other hanging open on what is left on the shelves (front: -z)
BUILD.medicine_cabinet = (b, r) => {
  const white = [0.86, 0.87, 0.82];
  const W = 0.9, H = 1.8, D = 0.45, zf = -D / 2;
  b.box('dark', W - 0.08, 0.08, D - 0.08, { p: [0, 0.04, 0.02] }); // plinth
  b.box('paint', W, 0.62, D, { p: [0, 0.39, 0], c: white });
  for (const y of [0.25, 0.55]) {
    b.box('paint', W - 0.08, 0.24, 0.02, { p: [0, y, zf - 0.008], c: white.map((c) => c * 1.04) });
    b.box('chrome', 0.3, 0.025, 0.03, { p: [0, y + 0.05, zf - 0.03] });
  }
  // upper case: back, sides, top, shelves
  const y0 = 0.7, dy = (y0 + H) / 2, dh = H - y0;
  b.box('paint', W, dh, 0.02, { p: [0, dy, D / 2 - 0.01], c: white });
  for (const sx of [-1, 1]) b.box('paint', 0.025, dh, D, { p: [sx * (W / 2 - 0.0125), dy, 0], c: white });
  b.box('paint', W, 0.03, D, { p: [0, H - 0.015, 0], c: white });
  b.box('dark', W - 0.06, dh - 0.04, 0.004, { p: [0, dy, D / 2 - 0.024] });
  for (const y of [1.02, 1.36]) b.box('steel', W - 0.05, 0.012, D - 0.06, { p: [0, y, 0.01] });
  // bottles, jars and cartons
  for (const [sy, n] of [[0.7, 4], [1.026, 5], [1.366, 4]]) {
    for (let k = 0; k < n; k++) {
      const x = -0.34 + ((k + r() * 0.6) * 0.7) / n;
      const z = rr(r, -0.06, 0.1);
      const what = r();
      if (what < 0.35) b.cyl('bottle_brown', 0.028, 0.032, 0.13, 6, { p: [x, sy + 0.065, z] });
      else if (what < 0.6) b.cyl('paint', 0.03, 0.03, 0.09, 7, { p: [x, sy + 0.045, z], c: [0.85, 0.85, 0.8] });
      else if (what < 0.8) b.box('cardboard', 0.1, 0.07, 0.06, { p: [x, sy + 0.035, z], r: [0, rr(r, -0.4, 0.4), 0] });
      else b.cyl('bottle', 0.03, 0.035, 0.16, 6, { p: [x, sy + 0.08, z] });
    }
  }
  const dw = W / 2 - 0.015, door = white.map((c) => c * 1.03);
  b.box('paint', dw, dh - 0.03, 0.02, { p: [-W / 4, dy, zf - 0.01], c: door });
  label(b, 'labels', 'cross_mark', 0.2, 0.2, [-W / 4, dy + 0.2, zf - 0.0215], 'z-');
  b.box('chrome', 0.02, 0.14, 0.025, { p: [-0.04, dy, zf - 0.03] });
  b.group({ p: [W / 2 - 0.012, dy, zf - 0.01], r: [0, -1.25, 0] }, () => {
    b.box('paint', dw, dh - 0.03, 0.02, { p: [-dw / 2, 0, 0], c: door });
    b.box('chrome', 0.02, 0.14, 0.025, { p: [-dw + 0.04, 0, -0.02] });
  });
  for (const x of [-0.3, 0.22]) b.box('rust', 0.05 + r() * 0.04, 0.1 + r() * 0.1, 0.004, { p: [x, 0.14, zf - 0.02] });
};

// the drug locker of the isolation ward: a squat steel cabinet for what was counted out under two keys, its heavy
// door standing open (front: -z)
BUILD.drug_locker = (b) => {
  const grey = [0.2, 0.23, 0.24];
  const W = 0.8, H = 1.25, D = 0.6, zf = -D / 2, t = 0.04;
  const hh = H - 0.06, hy = 0.06 + hh / 2;
  b.box('dark', W - 0.06, 0.06, D - 0.06, { p: [0, 0.03, 0] });
  b.box('paint', W, hh, t, { p: [0, hy, D / 2 - t / 2], c: grey });
  for (const sx of [-1, 1]) b.box('paint', t, hh, D, { p: [sx * (W / 2 - t / 2), hy, 0], c: grey });
  for (const y of [H - t / 2, 0.06 + t / 2]) b.box('paint', W, t, D, { p: [0, y, 0], c: grey });
  b.box('dark', W - t * 2, hh - t * 2, 0.004, { p: [0, hy, D / 2 - t - 0.004] });
  for (const y of [0.5, 0.86]) b.box('steel', W - t * 2, 0.012, D - 0.1, { p: [0, y, 0.02] });
  // what is in it: cartons with a red cross, jars, boxes of ampoules
  b.box('paint', 0.3, 0.2, 0.24, { p: [-0.16, 0.2, 0.02], c: [0.8, 0.8, 0.76] });
  label(b, 'labels', 'cross_mark', 0.14, 0.14, [-0.16, 0.2, -0.102], 'z-');
  b.box('paint', 0.24, 0.16, 0.2, { p: [0.17, 0.18, 0.04], r: [0, 0.3, 0], c: [0.8, 0.8, 0.76] });
  for (const [x, y] of [[-0.24, 0.506], [-0.12, 0.506], [0.02, 0.506], [0.22, 0.866], [0.1, 0.866]]) b.cyl('paint', 0.035, 0.035, 0.1, 7, { p: [x, y + 0.05, 0.03], c: [0.85, 0.85, 0.8] });
  b.box('cardboard', 0.22, 0.09, 0.16, { p: [0.2, 0.551, 0.04], r: [0, -0.2, 0] });
  b.box('cardboard', 0.2, 0.08, 0.14, { p: [-0.18, 0.906, 0.05], r: [0, 0.25, 0] });
  // the door, hung on the left: a wheel handle, two locks, the warning nobody heeded
  b.group({ p: [-W / 2 + 0.02, hy, zf - 0.03], r: [0, 1.15, 0] }, () => {
    b.box('paint', W - 0.04, hh - 0.04, 0.05, { p: [(W - 0.04) / 2, 0, 0], c: grey.map((c) => c * 1.08) });
    b.torus('chrome', 0.07, 0.012, 5, 10, PI * 2, { p: [0.5, 0.05, -0.06] });
    b.cyl('steel', 0.02, 0.02, 0.06, 6, { p: [0.5, 0.05, -0.04], r: [PI / 2, 0, 0] });
    for (const y of [0.3, -0.25]) b.cyl('chrome', 0.022, 0.022, 0.02, 8, { p: [0.64, y, -0.03], r: [PI / 2, 0, 0] });
    label(b, 'labels', 'hazard_small', 0.14, 0.14, [0.24, 0.3, -0.027], 'z-');
  });
};

// a folding hospital wheelchair, left where its last passenger got out of it (front: -z)
BUILD.wheelchair = (b) => {
  const vinyl = [0.16, 0.2, 0.26];
  for (const sx of [-1, 1]) {
    const x = sx * 0.24;
    b.cylBetween('chrome', [x, 0.5, 0.12], [x, 0.5, -0.3], 0.012, 0.012, 5); // seat rail
    b.cylBetween('chrome', [x, 0.3, 0.16], [x, 0.92, 0.22], 0.012, 0.012, 5); // back post
    b.cylBetween('chrome', [x, 0.92, 0.22], [x, 0.9, 0.34], 0.012, 0.012, 5);
    b.cylBetween('rubber', [x, 0.9, 0.3], [x, 0.9, 0.38], 0.018, 0.018, 5); // push handle
    b.cylBetween('chrome', [x, 0.5, -0.3], [x, 0.14, -0.38], 0.012, 0.012, 5); // down to the footrest
    b.box('steel', 0.14, 0.012, 0.1, { p: [x * 0.75, 0.13, -0.42] });
    b.cylBetween('chrome', [x, 0.68, 0.2], [x, 0.68, -0.18], 0.012, 0.012, 5); // armrest
    b.box('rubber', 0.04, 0.02, 0.26, { p: [x, 0.695, 0] });
    b.cylBetween('chrome', [x, 0.68, -0.18], [x, 0.5, -0.2], 0.012, 0.012, 5);
    // the big wheel with its push rim, and the caster in front of it
    b.group({ p: [sx * 0.3, 0.3, 0.14] }, () => {
      b.torus('rubber', 0.285, 0.016, 5, 14, PI * 2, { r: [0, PI / 2, 0] });
      b.torus('chrome', 0.25, 0.007, 4, 14, PI * 2, { p: [sx * 0.03, 0, 0], r: [0, PI / 2, 0] });
      for (let k = 0; k < 6; k++) b.cylBetween('steel', [0, 0, 0], [0, Math.cos((k / 6) * PI * 2) * 0.28, Math.sin((k / 6) * PI * 2) * 0.28], 0.004, 0.004, 3);
    });
    b.cyl('rubber', 0.06, 0.06, 0.03, 8, { p: [x, 0.06, -0.3], r: [0, 0, PI / 2] });
    b.cylBetween('chrome', [x, 0.06, -0.3], [x, 0.3, -0.3], 0.008, 0.008, 4);
  }
  b.cylBetween('chrome', [-0.3, 0.3, 0.14], [0.3, 0.3, 0.14], 0.01, 0.01, 5); // axle
  b.box('cloth', 0.46, 0.02, 0.42, { p: [0, 0.5, -0.09], c: vinyl });
  b.box('cloth', 0.46, 0.36, 0.02, { p: [0, 0.72, 0.21], c: vinyl });
};

BUILD.log_pile = (b, r) => {
  const rows = [
    { n: 4, rad: 0.27, z0: -0.825, dz: 0.55 },
    { n: 3, rad: 0.245, z0: -0.55, dz: 0.55 },
    { n: 2, rad: 0.22, z0: -0.27, dz: 0.54 },
  ];
  let y = 0;
  let prevR = 0;
  rows.forEach((row, j) => {
    y = j === 0 ? row.rad : y + Math.sqrt((prevR + row.rad) ** 2 - 0.275 ** 2) - 0.02;
    prevR = row.rad;
    for (let k = 0; k < row.n; k++) {
      const rad = row.rad * rr(r, 0.9, 1.08);
      const len = rr(r, 3.85, 4.15);
      const x = rr(r, -0.12, 0.12);
      const z = row.z0 + k * row.dz + rr(r, -0.02, 0.02);
      const yaw = rr(r, -0.03, 0.03);
      const taper = rr(r, 0.82, 0.92);
      const ly = y + (rad - row.rad);
      b.group({ p: [x, ly, z], r: [0, yaw, 0] }, () => {
        b.cyl('bark', rad * taper, rad, len, 9, { r: [0, 0, PI / 2], grain: true, open: true });
        b.disc('woodend', rad, 9, { p: [-len / 2 - 0.002, 0, 0], r: [0, 0, PI / 2], s: [1, 1, 1] });
        b.disc('woodend', rad * taper, 9, { p: [len / 2 + 0.002, 0, 0], r: [0, 0, -PI / 2] });
        // branch stubs
        if (r() < 0.6) {
          const bx = rr(r, -1.4, 1.4), a = r() * PI * 2;
          b.cylBetween('bark', [bx, Math.cos(a) * rad * 0.8, Math.sin(a) * rad * 0.8], [bx + 0.05, Math.cos(a) * (rad + 0.12), Math.sin(a) * (rad + 0.12)], 0.03, 0.045, 5);
        }
      });
    }
  });
  // stakes driven in along both long sides + chocks under the outer logs
  for (const sz of [-1, 1])
    for (const x of [-1.3, 1.2]) {
      const zz = sz * 1.13;
      b.cylBetween('wood', [x, -0.1, zz * 0.98], [x + rr(r, -0.05, 0.05), 1.0, zz * 1.04], 0.045, 0.05, 6, { c: WOODS[2] });
      b.cyl('wood', 0.005, 0.045, 0.06, 6, { p: [x, 1.02, zz * 1.04], c: WOODS[2] });
      b.frustum('wood', 0.22, 0.2, 0.22, 0.02, 0, 0.14, { p: [x + 0.2, 0, zz * 0.9], c: WOODS[1] });
    }
  // bark litter + sawdust
  for (let k = 0; k < 8; k++) b.box('bark', rr(r, 0.12, 0.3), 0.02, rr(r, 0.05, 0.12), { p: [rr(r, -2.2, 2.2), 0.01, (r() < 0.5 ? -1 : 1) * rr(r, 1.15, 1.35)], r: [0, r() * 3, 0.05] });
  for (const sx of [-1, 1]) b.sphere('wood', 0.3, 8, 3, { p: [sx * 2.2, 0, rr(r, -0.6, 0.6)], s: [1.4, 0.18, 1.1], c: [1.1, 0.95, 0.72], thetaLen: PI / 2 });
  weeds(b, r, [[-2.1, 1.3], [1.8, -1.3], [0.3, 1.35]], 0.5);
};

// ------------------------------------------------------------------ roadside / places
BUILD.jersey_barrier = (b, r, v) => {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0);
  s.lineTo(0.3, 0);
  s.lineTo(0.3, 0.075);
  s.lineTo(0.2, 0.26);
  s.lineTo(0.085, 0.82);
  s.lineTo(0.06, 0.85);
  s.lineTo(-0.06, 0.85);
  s.lineTo(-0.085, 0.82);
  s.lineTo(-0.2, 0.26);
  s.lineTo(-0.3, 0.075);
  s.lineTo(-0.3, 0);
  const L = 2.96;
  b.extrude('concrete', s, L, { r: [0, -PI / 2, 0], p: [L / 2, 0, 0] });
  // drain slot through the base + lifting loops on top
  b.box('dark', 0.36, 0.09, 0.605, { p: [0.4, 0.045, 0] });
  for (const x of [-1.0, 1.0]) b.torus('rust', 0.06, 0.012, 4, 8, PI, { p: [x, 0.85, 0] });
  // chipped end chunks + rubble
  b.rock('concrete', 0.12, { detail: 0, seed: 91 + v, scale: [1.3, 0.7, 1], p: [-1.62, 0.05, 0.28], r: [0, 0.4, 0] });
  b.rock('concrete', 0.07, { detail: 0, seed: 94, p: [1.4, 0.03, -0.42] });
  b.box('dark', 0.004, 0.2, 0.12, { p: [-L / 2 - 0.002, 0.6, 0.02], r: [0.3, 0, 0] });
  // faded painted stripes on the upper slope of both faces
  const slope = (side, x0, x1, c) => {
    // quad on the face between (z=0.2,y=0.26) and (z=0.085,y=0.82) mirrored by side
    const n = [side * 0.98, 0.2];
    const pt = (x, t) => {
      const z = 0.2 + (0.085 - 0.2) * t, y = 0.26 + (0.82 - 0.26) * t;
      return [x, y + n[1] * 0.004, side * z + n[0] * 0.004];
    };
    const k = 0.22;
    const pts = [pt(x0, 0.08), pt(x1, 0.08), pt(x1 + k, 0.92), pt(x0 + k, 0.92)];
    b.quadOut('paint', pts, [0, 0.5, 0], { c });
  };
  if (v === 1) {
    for (const side of [-1, 1])
      for (let k = 0; k < 9; k++) {
        const x0 = -1.38 + k * 0.3;
        slope(side, x0, x0 + 0.15, k % 2 ? [0.82, 0.8, 0.72] : [0.72, 0.2, 0.08]);
      }
  } else {
    for (const side of [-1, 1]) {
      slope(side, -1.46, -0.9, [0.8, 0.62, 0.12]);
      slope(side, 0.8, 1.2, [0.8, 0.62, 0.12]);
    }
    b.box('paint', 2.6, 0.004, 0.1, { p: [0.05, 0.852, 0], c: [0.8, 0.64, 0.14] });
  }
  weeds(b, r, [[-1.2, 0.36], [0.9, -0.36], [1.5, 0.3]], 0.4);
};

function rvWindow(b, x, z0, z1, y0, y1, side, o = {}) {
  const zc = (z0 + z1) / 2, yc = (y0 + y1) / 2, w = z1 - z0, h = y1 - y0;
  const R = [0, side * PI / 2, 0];
  b.box('dark', 0.02, h + 0.06, w + 0.06, { p: [x + side * 0.004, yc, zc] });
  b.box('chrome', 0.012, h + 0.08, 0.03, { p: [x + side * 0.012, yc, z0 - 0.03] });
  b.box('chrome', 0.012, h + 0.08, 0.03, { p: [x + side * 0.012, yc, z1 + 0.03] });
  b.box('chrome', 0.012, 0.03, w + 0.08, { p: [x + side * 0.012, y1 + 0.03, zc] });
  b.box('chrome', 0.012, 0.03, w + 0.08, { p: [x + side * 0.012, y0 - 0.03, zc] });
  if (!o.broken) b.plane('glass', w, h, { p: [x + side * 0.016, yc, zc], r: R });
  if (o.curtain) {
    const cw = w * o.curtain;
    const cz = o.broken ? zc - w / 2 + cw / 2 : zc + w / 2 - cw / 2;
    b.plane('cloth', cw, h * 0.98, { p: [x + side * (o.broken ? 0.03 : 0.018), yc - (o.broken ? 0.05 : 0), cz], r: [o.broken ? side * 0.15 : 0, side * PI / 2, 0], c: o.cc });
  }
}

BUILD.camper = (b, r, v) => {
  const body = v ? [0.8, 0.8, 0.76] : [0.8, 0.72, 0.56];
  const s1 = v ? [0.2, 0.3, 0.46] : [0.42, 0.25, 0.13];
  const s2 = v ? [0.36, 0.5, 0.62] : [0.66, 0.4, 0.14];
  const cab = v ? [0.72, 0.72, 0.68] : [0.74, 0.66, 0.5];
  const curt = v ? [0.4, 0.44, 0.5] : [0.62, 0.44, 0.22];
  const W = 2.34, hw = W / 2, CW = 2.04, chw = CW / 2;
  const fa = -2.45, ra = 1.75, wr = 0.4, sink = 0.06;
  b.push([0, -sink, 0]);
  // chassis
  for (const sx of [-1, 1]) b.box('dark', 0.12, 0.2, 5.8, { p: [sx * 0.45, 0.5, 0] });
  // ---- cab lower body (hood, fenders, doors)
  const c = new THREE.Shape();
  c.moveTo(-3.2, 0.4);
  c.lineTo(fa - 0.47, 0.4);
  c.absarc(fa, 0.42, 0.47, PI, 0, true);
  c.lineTo(-1.5, 0.4);
  c.lineTo(-1.5, 1.2);
  c.lineTo(-2.3, 1.2);
  c.lineTo(-2.55, 1.13);
  c.lineTo(-3.14, 1.04);
  c.lineTo(-3.26, 0.94);
  c.lineTo(-3.26, 0.5);
  c.lineTo(-3.2, 0.4);
  b.extrude('carpaint', c, CW, { r: [0, -PI / 2, 0], p: [chw, 0, 0], c: cab });
  b.box('dark', CW - 0.03, 0.5, 0.92, { p: [0, 0.64, fa] });
  // cab greenhouse
  const C = [];
  for (let k = 0; k < 8; k++) {
    const X = k & 1 ? 1 : -1, top = k & 2, Z = k & 4;
    C.push([X * (top ? chw - 0.1 : chw - 0.03), top ? 1.94 : 1.2, Z ? -1.5 : top ? -1.98 : -2.32]);
  }
  b.hull('dark', C);
  const nn = (p, d, k = 0.008) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
  const wsN = [0, 0.5, -0.86];
  b.poly('glass', [nn(C[0], wsN), nn(C[1], wsN), nn(C[3], wsN), nn(C[2], wsN)].map((p, i) => [p[0] * 0.93, p[1] + (i < 2 ? 0.03 : -0.02), p[2]]), [[1, 0, 2], [0, 3, 2]]);
  b.beam('carpaint', nn(C[0], [-1, 0.2, 0], 0.012), nn(C[2], [-1, 0.2, 0], 0.012), 0.07, 0.05, { c: cab });
  b.beam('carpaint', nn(C[1], [1, 0.2, 0], 0.012), nn(C[3], [1, 0.2, 0], 0.012), 0.07, 0.05, { c: cab });
  for (const sx of [-1, 1]) {
    const q = sx > 0 ? [C[1], C[5], C[7], C[3]] : [C[0], C[4], C[6], C[2]];
    const n = [sx, 0.1, 0];
    const qq = q.map((p) => nn(p, n, 0.01)).map((p, i) => [p[0], p[1] + (i < 2 ? 0.05 : -0.04), p[2] + (i === 0 || i === 3 ? 0.1 : -0.06)]);
    if (!(v === 1 && sx < 0)) b.poly('glass', qq, sx > 0 ? [[0, 1, 2], [0, 2, 3]] : [[1, 0, 3], [1, 3, 2]]);
    b.box('dark', 0.01, 0.74, 0.012, { p: [sx * (chw + 0.002), 0.8, -2.0] });
    b.box('chrome', 0.03, 0.03, 0.12, { p: [sx * (chw + 0.012), 1.05, -1.7] });
    b.cylBetween('steel', [sx * (chw + 0.01), 1.5, -2.2], [sx * (chw + 0.2), 1.62, -2.3], 0.012, 0.012, 4);
    b.box('chrome', 0.06, 0.26, 0.14, { p: [sx * (chw + 0.22), 1.55, -2.3] });
  }
  // front: grille, square lights, bumper, plate
  b.box('dark', 1.1, 0.34, 0.02, { p: [0, 0.76, -3.265] });
  for (let k = 0; k < 4; k++) b.box('chrome', 1.1, 0.02, 0.025, { p: [0, 0.64 + k * 0.08, -3.272] });
  for (const sx of [-1, 1]) {
    b.box('chrome', 0.3, 0.22, 0.03, { p: [sx * 0.76, 0.78, -3.265] });
    b.box(sx < 0 && v === 1 ? 'dark' : 'glass', 0.26, 0.18, 0.02, { p: [sx * 0.76, 0.78, -3.28] });
  }
  b.box('chrome', CW + 0.1, 0.18, 0.12, { p: [0, 0.46, -3.3] });
  label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.46, -3.362], 'z-');
  // ---- living box (overcab bunk + coach), extruded side profile
  const s = new THREE.Shape();
  s.moveTo(-1.5, 0.62);
  s.lineTo(-1.5, 1.96);
  s.lineTo(-2.42, 1.96);
  s.lineTo(-2.6, 2.1);
  s.lineTo(-2.64, 2.62);
  s.quadraticCurveTo(-2.64, 2.9, -2.36, 2.9);
  s.lineTo(3.16, 2.9);
  s.lineTo(3.24, 2.82);
  s.lineTo(3.24, 0.72);
  s.lineTo(3.14, 0.62);
  s.lineTo(ra + 0.5, 0.62);
  s.absarc(ra, 0.62, 0.5, 0, PI, false);
  s.lineTo(-1.5, 0.62);
  b.extrude('carpaint', s, W, { r: [0, -PI / 2, 0], p: [hw, 0, 0], c: body, curveSegments: 5 });
  b.box('dark', W - 0.04, 0.5, 1.0, { p: [0, 0.8, ra] }); // rear wheel well
  // stripes: straight bands along the coach + a sweep up onto the overcab
  for (const sx of [-1, 1]) {
    const x = sx * (hw + 0.004);
    const band = (y0, y1, zA, zB, col) => b.quadOut('carpaint', [[x, y0, zA], [x, y0, zB], [x, y1, zB], [x, y1, zA]], [0, (y0 + y1) / 2, (zA + zB) / 2], { c: col });
    band(1.34, 1.52, -1.2, 3.24, s1);
    band(1.25, 1.3, -1.2, 3.24, s2);
    b.quadOut('carpaint', [[x, 1.34, -1.2], [x, 1.52, -1.2], [x, 2.36, -2.58], [x, 2.18, -2.58]], [0, 1.9, -1.9], { c: s1 });
    b.quadOut('carpaint', [[x, 1.25, -1.2], [x, 1.3, -1.2], [x, 2.14, -2.54], [x, 2.09, -2.52]], [0, 1.7, -1.9], { c: s2 });
    // windows (some smashed), curtains half drawn
    rvWindow(b, sx * hw, -1.0, -0.3, 1.66, 2.3, sx, { curtain: 0.45, cc: curt, broken: sx < 0 && v === 0 });
    rvWindow(b, sx * hw, 2.2, 2.9, 1.66, 2.3, sx, { curtain: 0.6, cc: curt, broken: sx > 0 && v === 1 });
    if (sx < 0) rvWindow(b, sx * hw, 0.5, 1.3, 1.66, 2.3, sx, { curtain: 0.35, cc: curt });
    rvWindow(b, sx * hw, -2.3, -1.75, 2.28, 2.62, sx, { curtain: 0.5, cc: curt });
    // skirt rust + propane/storage hatch
    b.box('dark', 0.012, 0.36, 0.5, { p: [x + sx * 0.002, 0.95, -0.9] });
    b.box('carpaint', 0.012, 0.32, 0.46, { p: [x + sx * 0.006, 0.95, -0.9], c: body.map((q) => q * 0.9) });
  }
  // entry door (curb side +X) with window + step; hanging open on the second variant
  const dz0 = 0.15, dz1 = 0.78;
  b.box('dark', 0.02, 1.84, dz1 - dz0, { p: [hw - 0.006, 1.58, (dz0 + dz1) / 2] });
  const doorLeaf = () => {
    b.box('carpaint', 0.035, 1.8, dz1 - dz0 - 0.03, { p: [0, 0, 0], c: body.map((q) => q * 0.97) });
    b.box('carpaint', 0.004, 0.18, dz1 - dz0 - 0.03, { p: [0.02, -0.18, 0], c: s1 });
    b.box('glass', 0.004, 0.36, 0.38, { p: [0.02, 0.5, 0] });
    b.box('chrome', 0.04, 0.05, 0.1, { p: [0.03, 0.0, -0.2] });
  };
  if (v === 1) {
    b.group({ p: [hw + 0.02, 1.58, dz1], r: [0, -1.2, 0] }, () => b.group({ p: [0, 0, -(dz1 - dz0) / 2] }, doorLeaf));
    b.box('dark', 0.9, 0.01, 0.6, { p: [hw - 0.5, 0.7, (dz0 + dz1) / 2] });
  } else b.group({ p: [hw + 0.02, 1.58, (dz0 + dz1) / 2] }, doorLeaf);
  b.box('rust', 0.3, 0.05, 0.56, { p: [hw + 0.05, 0.42, (dz0 + dz1) / 2] });
  // overcab front window, rear window, roof gear, ladder, spare tyre, lights, bumper
  b.box('dark', 1.5, 0.3, 0.02, { p: [0, 2.36, -2.645] });
  b.box('glass', 1.44, 0.24, 0.01, { p: [0, 2.36, -2.66] });
  b.quadOut('carpaint', [[-hw + 0.02, 2.02, -2.62], [hw - 0.02, 2.02, -2.62], [hw - 0.02, 2.14, -2.645], [-hw + 0.02, 2.14, -2.645]], [0, 2.1, -2.2], { c: s1 });
  b.box('dark', 1.1, 0.5, 0.02, { p: [0, 2.1, 3.25] });
  b.box('glass', 1.04, 0.44, 0.01, { p: [0, 2.1, 3.262] });
  b.box('paint', 0.72, 0.18, 0.86, { p: [0.2, 2.99, 0.4], c: [0.78, 0.76, 0.7] });
  for (let k = 0; k < 5; k++) b.box('dark', 0.6, 0.01, 0.02, { p: [0.2, 3.0, 0.08 + k * 0.16] });
  b.box('dark', 0.44, 0.08, 0.44, { p: [-0.5, 2.94, -1.4] });
  b.box('glass', 0.38, 0.04, 0.38, { p: [-0.5, 2.98, 1.9], r: [0.15, 0, 0] });
  for (const x of [0.62, 1.0]) b.box('steel', 0.03, 2.3, 0.03, { p: [x, 1.8, 3.29] });
  for (let y = 0.9; y < 2.9; y += 0.3) b.box('steel', 0.4, 0.025, 0.025, { p: [0.81, y, 3.29] });
  b.group({ p: [-0.5, 1.1, 3.4] }, () => {
    b.lathe('tire', [[0.24, -0.1], [0.34, -0.11], [0.38, -0.05], [0.38, 0.05], [0.34, 0.11], [0.24, 0.1]], 12, { r: [PI / 2, 0, 0] });
    b.cyl('paint', 0.37, 0.37, 0.02, 12, { p: [0, 0, 0.11], r: [PI / 2, 0, 0], c: s1 });
  });
  for (const sx of [-1, 1]) {
    b.box('taillight', 0.14, 0.34, 0.03, { p: [sx * 0.98, 0.95, 3.25] });
    b.box('paint', 0.1, 0.06, 0.03, { p: [sx * 0.98, 2.84, 3.25], c: [0.8, 0.45, 0.1] });
  }
  b.box('chrome', W - 0.2, 0.14, 0.14, { p: [0, 0.58, 3.3] });
  label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.76, 3.262], 'z+');
  // grime streak down the nose
  b.box('rust', 0.3, 0.3, 0.004, { p: [0.5, 2.35, -2.66] });
  b.pop();
  // wheels: flat and cracked; rear duals
  for (const [x, z] of [[-0.86, fa], [0.86, fa]]) b.group({ p: [x, wr - sink * 0.5, z] }, () => wheel(b, wr, 0.24, { flat: 0.3, rim: 'steel' }));
  for (const sx of [-1, 1]) for (const x of [0.78, 1.02]) b.group({ p: [sx * x, wr - sink * 0.5, ra] }, () => wheel(b, wr, 0.22, { flat: x > 0.9 ? 0.32 : 0.18, rim: 'steel' }));
  weeds(b, r, [[1.3, -0.5], [-1.3, 1.0], [1.25, 2.6], [-1.2, -2.8], [0.4, 3.4]], 0.6);
};

// the ambulance on the clinic's car park: a box body on a van chassis, cab at -z, an orange stripe and red crosses,
// one rear door hanging open on the dark inside
BUILD.ambulance = (b, r) => {
  const white = [0.82, 0.82, 0.78], orange = [0.74, 0.3, 0.1];
  const W = 2.1, hw = W / 2, CW = 1.96, chw = CW / 2;
  const fa = -1.85, ra = 1.6, wr = 0.38;
  for (const sx of [-1, 1]) b.box('dark', 0.12, 0.2, 5.3, { p: [sx * 0.45, 0.48, 0] }); // chassis rails
  // cab: nose, cabin, windscreen and side glass
  b.box('carpaint', CW, 0.62, 1.05, { p: [0, 0.83, -2.32], c: white });
  b.box('dark', CW - 0.04, 0.5, 0.9, { p: [0, 0.62, fa] }); // front wheel well
  b.frustum('carpaint', CW, 1.3, CW - 0.16, 1.0, 1.14, 1.9, { p: [0, 0, -1.3], topOff: [0, 0.15], c: white });
  b.box('glass', CW - 0.3, 0.56, 0.02, { p: [0, 1.52, -1.812], r: [0.376, 0, 0] });
  for (const sx of [-1, 1]) {
    b.box('glass', 0.02, 0.44, 0.62, { p: [sx * (chw - 0.045), 1.52, -1.3] });
    b.box('carpaint', 0.012, 0.2, 2.2, { p: [sx * (chw + 0.004), 1.02, -1.75], c: orange });
    b.box('chrome', 0.06, 0.24, 0.14, { p: [sx * (chw + 0.16), 1.5, -1.86] }); // mirror
    b.box('chrome', 0.03, 0.03, 0.12, { p: [sx * (chw + 0.012), 1.08, -1.0] });
  }
  b.box('dark', 1.2, 0.3, 0.02, { p: [0, 0.86, -2.85] }); // grille
  for (let k = 0; k < 3; k++) b.box('chrome', 1.2, 0.02, 0.025, { p: [0, 0.76 + k * 0.09, -2.856] });
  for (const sx of [-1, 1]) b.box(sx < 0 ? 'dark' : 'glass', 0.26, 0.18, 0.02, { p: [sx * 0.78, 0.88, -2.855] });
  b.box('chrome', CW + 0.1, 0.18, 0.12, { p: [0, 0.5, -2.86] });
  label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.5, -2.922], 'z-');
  // the box: patient compartment from behind the cab to the rear doors
  b.box('carpaint', W, 1.95, 3.55, { p: [0, 1.6, 1.07], c: white });
  b.box('dark', W - 0.04, 0.5, 1.0, { p: [0, 0.66, ra] }); // rear wheel well
  for (const sx of [-1, 1]) {
    const x = sx * (hw + 0.005);
    b.box('carpaint', 0.012, 0.24, 3.55, { p: [x, 1.2, 1.07], c: orange });
    label(b, 'labels', 'cross_mark', 0.66, 0.66, [sx * (hw + 0.008), 1.92, 1.4], sx < 0 ? 'x-' : 'x+');
    b.box('glass', 0.012, 0.3, 0.5, { p: [x, 2.2, 0.1] });
    b.box('rust', 0.006, 0.3 + r() * 0.3, 0.4, { p: [sx * (hw + 0.012), 0.82, 0.3 + r()] });
  }
  // light bar and beacons, all dead
  b.box('dark', 1.5, 0.06, 0.3, { p: [0, 2.6, -0.45] });
  for (const sx of [-1, 1]) b.box('taillight', 0.5, 0.13, 0.24, { p: [sx * 0.46, 2.69, -0.45] });
  for (const sx of [-1, 1]) b.box('taillight', 0.16, 0.08, 0.1, { p: [sx * 0.8, 2.61, 2.72] });
  // the rear: the left door shut, the right one swung wide; a stretcher half out of the dark
  b.box('dark', 1.86, 1.7, 0.02, { p: [0, 1.6, 2.85] });
  const leaf = () => {
    b.box('carpaint', 0.93, 1.7, 0.04, { p: [0, 0, 0], c: white.map((q) => q * 0.97) });
    b.box('glass', 0.5, 0.4, 0.045, { p: [0, 0.4, 0] });
  };
  b.group({ p: [-0.47, 1.6, 2.87] }, leaf);
  label(b, 'labels', 'cross_mark', 0.36, 0.36, [-0.47, 1.35, 2.893], 'z+');
  b.group({ p: [0.95, 1.6, 2.87], r: [0, 1.95, 0] }, () => b.group({ p: [-0.465, 0, 0] }, leaf));
  b.box('steel', 0.56, 0.04, 1.5, { p: [0.4, 0.98, 2.6], r: [-0.08, 0, 0] });
  b.box('mattress', 0.52, 0.07, 1.4, { p: [0.4, 1.03, 2.6], r: [-0.08, 0, 0] });
  b.box('chrome', W, 0.12, 0.26, { p: [0, 0.58, 2.96] }); // step bumper
  for (const sx of [-1, 1]) b.box('taillight', 0.12, 0.3, 0.03, { p: [sx * 0.99, 1.0, 2.86] });
  for (const [x, z, flat] of [[-0.84, fa, 0.3], [0.84, fa, 0.05], [-0.88, ra, 0.1], [0.88, ra, 0.32]]) b.group({ p: [x, wr - flat * 0.1, z] }, () => wheel(b, wr, 0.24, { flat, rim: 'steel' }));
  weeds(b, r, [[1.2, -0.6], [-1.2, 1.2], [0.3, 3.2], [-1.1, -2.6]], 0.55);
};

BUILD.school_bus = (b, r, v) => {
  const yel = [0.82, 0.58, 0.12];
  const hw = 1.25, sink = 0.12;
  const fa = -4.3, ra = 2.35, wr = 0.5;
  const z0 = -3.95, z1 = 5.2;
  b.push([0, -sink, 0]);
  for (const sx of [-1, 1]) b.box('dark', 0.16, 0.24, 9.8, { p: [sx * 0.5, 0.58, 0.1] });
  // ---- hood + fenders (conventional nose)
  const h = new THREE.Shape();
  h.moveTo(-5.16, 0.52);
  h.lineTo(fa - 0.57, 0.52);
  h.absarc(fa, 0.54, 0.57, PI, 0, true);
  h.lineTo(z0, 0.52);
  h.lineTo(z0, 1.62);
  h.lineTo(-5.0, 1.5);
  h.lineTo(-5.2, 1.3);
  h.lineTo(-5.2, 0.62);
  h.lineTo(-5.16, 0.52);
  b.extrude('carpaint', h, 2.14, { r: [0, -PI / 2, 0], p: [1.07, 0, 0], c: yel });
  b.box('dark', 2.1, 0.56, 1.06, { p: [0, 0.8, fa] });
  b.box('dark', 1.3, 0.62, 0.02, { p: [0, 1.0, -5.205] });
  for (let k = 0; k < 6; k++) b.box('chrome', 1.3, 0.025, 0.03, { p: [0, 0.74 + k * 0.1, -5.212] });
  b.box('carpaint', 1.2, 0.02, 0.9, { p: [0, 1.62, -4.45], r: [-0.1, 0, 0], c: yel.map((c) => c * 0.95) }); // hood seam strip
  for (const sx of [-1, 1]) {
    b.cyl('chrome', 0.13, 0.13, 0.06, 10, { p: [sx * 0.78, 1.05, -5.19], r: [PI / 2, 0, 0] });
    b.cyl(sx < 0 ? 'glass' : 'dark', 0.1, 0.1, 0.02, 10, { p: [sx * 0.78, 1.05, -5.225], r: [PI / 2, 0, 0] });
    b.box('paint', 0.12, 0.08, 0.03, { p: [sx * 0.95, 1.3, -5.12], c: [0.8, 0.5, 0.1] });
  }
  b.box('dark', 2.4, 0.26, 0.16, { p: [0, 0.55, -5.28] });
  label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.55, -5.365], 'z-');
  // ---- body: lower box + window band + rounded roof
  const L = z1 - z0, zc = (z0 + z1) / 2;
  b.box('carpaint', hw * 2, 1.15, L, { p: [0, 0.55 + 0.575, zc], c: yel });
  b.box('dark', hw * 2 - 0.06, 0.78, L - 0.06, { p: [0, 2.09, zc] });
  const roof = new THREE.Shape();
  roof.moveTo(-hw, 2.46);
  roof.lineTo(hw, 2.46);
  roof.lineTo(hw, 2.62);
  roof.quadraticCurveTo(hw, 2.99, hw - 0.36, 3.0);
  roof.lineTo(-hw + 0.36, 3.0);
  roof.quadraticCurveTo(-hw, 2.99, -hw, 2.62);
  roof.lineTo(-hw, 2.46);
  b.extrude('carpaint', roof, L, { p: [0, 0, z0], c: yel, curveSegments: 4 });
  // front & rear caps above/below the windscreen
  for (const [z, s] of [[z0, -1], [z1, 1]]) {
    b.box('carpaint', hw * 2, 0.06, 0.04, { p: [0, 1.73, z + s * 0.02], c: yel });
    b.box('carpaint', hw * 2, 0.06, 0.04, { p: [0, 2.44, z + s * 0.02], c: yel });
    label(b, 'stencil', 'bus_text', 1.12, 0.28, [0, 2.7, z + s * 0.004], s < 0 ? 'z-' : 'z+');
    for (const sx of [-1, 1]) {
      b.cyl('paint', 0.065, 0.065, 0.05, 8, { p: [sx * 0.8, 2.78, z + s * 0.02], r: [PI / 2, 0, 0], c: [0.85, 0.5, 0.1] });
      b.cyl('taillight', 0.065, 0.065, 0.05, 8, { p: [sx * 1.0, 2.72, z + s * 0.02], r: [PI / 2, 0, 0] });
    }
  }
  // windscreen (2 panes, one smashed), entry door on the curb side (+X)
  b.plane('glass', 1.05, 0.64, { p: [-0.58, 2.08, z0 - 0.035], r: [0, PI, 0] });
  if (v !== 1) b.plane('glass', 1.05, 0.64, { p: [0.58, 2.08, z0 - 0.035], r: [0, PI, 0] });
  b.box('carpaint', 0.08, 0.72, 0.05, { p: [0, 2.08, z0 - 0.02], c: yel });
  for (const zz of [-3.72, -3.36]) {
    b.box('dark', 0.02, 1.8, 0.34, { p: [hw + 0.002, 1.5, zz] });
    b.plane('glass', 0.28, 0.72, { p: [hw + 0.014, 2.02, zz], r: [0, PI / 2, 0] });
    b.plane('glass', 0.28, 0.6, { p: [hw + 0.014, 1.12, zz], r: [0, PI / 2, 0] });
  }
  // side windows: pillars + split sash, some panes gone
  const nWin = 12, wz0 = -3.05, wz1 = 4.95, step = (wz1 - wz0) / nWin;
  for (const sx of [-1, 1]) {
    const x = sx * (hw - 0.012);
    for (let k = 0; k <= nWin; k++) b.box('carpaint', 0.04, 0.78, 0.1, { p: [x, 2.09, wz0 + k * step], c: yel });
    if (sx < 0) for (const zz of [-3.72, -3.36]) b.box('carpaint', 0.04, 0.78, 0.36, { p: [x, 2.09, zz], c: yel });
    b.box('chrome', 0.03, 0.035, wz1 - wz0, { p: [x + sx * 0.008, 2.1, (wz0 + wz1) / 2] });
    for (let k = 0; k < nWin; k++) {
      const zz = wz0 + (k + 0.5) * step;
      const R = [0, sx * PI / 2, 0];
      if (r() > 0.25) b.plane('glass', step - 0.1, 0.34, { p: [x + sx * 0.016, 1.9, zz], r: R });
      if (r() > 0.5) b.plane('glass', step - 0.1, 0.3, { p: [x + sx * 0.016, 2.29, zz], r: R });
    }
    // black rub rails + rust along the skirt
    for (const y of [0.95, 1.3, 1.62]) b.box('dark', 0.02, 0.05, L - 0.1, { p: [sx * (hw + 0.006), y, zc] });
    b.box('rust', 0.01, 0.16, L * 0.6, { p: [sx * (hw + 0.004), 0.62, zc + 0.8] });
    // crossview mirrors
    b.cylBetween('steel', [sx * 1.0, 1.55, -5.0], [sx * 1.25, 1.75, -5.15], 0.015, 0.015, 4);
    b.sphere('chrome', 0.1, 7, 5, { p: [sx * 1.27, 1.8, -5.16], s: [1, 1, 0.5] });
  }
  // stop arm (driver side), rear emergency door, bumper
  b.cyl('paint', 0.22, 0.22, 0.02, 8, { p: [-hw - 0.03, 1.85, -3.3], r: [0, 0, PI / 2], c: [0.62, 0.08, 0.06] });
  b.box('dark', 0.02, 1.8, 0.9, { p: [0, 1.5, z1 + 0.012], r: [0, PI / 2, 0] });
  b.plane('glass', 0.7, 0.62, { p: [0, 2.08, z1 + 0.03] });
  b.box('chrome', 0.14, 0.04, 0.05, { p: [0.3, 1.5, z1 + 0.03] });
  for (const sx of [-1, 1]) {
    b.plane('glass', 0.55, 0.6, { p: [sx * 0.85, 2.08, z1 + 0.02] });
    b.box('taillight', 0.18, 0.18, 0.04, { p: [sx * 1.0, 1.0, z1 + 0.02] });
  }
  b.box('dark', 2.44, 0.26, 0.16, { p: [0, 0.55, z1 + 0.08] });
  label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.8, z1 + 0.024], 'z+');
  // roof hatches + rust patches
  for (const z of [-1.5, 2.6]) b.box('metal', 0.7, 0.05, 0.7, { p: [0, 3.02, z] });
  b.pop();
  // wheels (flat, sunk) : single front, dual rear
  for (const sx of [-1, 1]) {
    b.group({ p: [sx * 1.0, wr - sink, fa] }, () => wheel(b, wr, 0.3, { flat: 0.3, rim: 'steel', rimR: 0.55 }));
    for (const x of [0.86, 1.12]) b.group({ p: [sx * x, wr - sink, ra] }, () => wheel(b, wr, 0.26, { flat: 0.28, rim: 'steel', rimR: 0.55 }));
  }
  weeds(b, r, [[1.4, -2.0], [-1.4, 0.5], [1.35, 3.6], [-1.3, 4.9], [0.6, -5.4], [-1.35, -3.9]], 0.7);
};

/** chunky off-road tyre with tread lugs, axis along X. lugs=false for hidden inner duals */
function bigTire(b, R, w, rimCol, flat = 0, lugs = true) {
  b.group({ p: [0, -flat * R * 0.5, 0], s: [1, 1 - flat * 0.5, 1] }, () => {
    const prof = [[R * 0.5, w * 0.36], [R * 0.9, w * 0.5], [R * 0.96, w * 0.4], [R * 0.96, -w * 0.4], [R * 0.9, -w * 0.5], [R * 0.5, -w * 0.36]];
    b.lathe('tire', prof, 12, { r: [0, 0, PI / 2] });
    if (!lugs) return;
    b.cyl('paint', R * 0.5, R * 0.5, w * 0.62, 10, { r: [0, 0, PI / 2], c: rimCol });
    b.cyl('rust', R * 0.2, R * 0.24, w * 0.74, 6, { r: [0, 0, PI / 2] });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * PI * 2;
      b.box('tire', w * 0.86, R * 0.07, R * 0.14, { p: [0, Math.cos(a) * R * 0.975, Math.sin(a) * R * 0.975], r: [a, 0, 0] });
    }
  });
}

BUILD.dump_truck = (b, r, v) => {
  const yel = [0.74, 0.5, 0.12];
  const fa = -2.3, ra = 1.95, wr = 0.72;
  // wheels
  for (const sx of [-1, 1]) {
    b.group({ p: [sx * 1.0, wr, fa] }, () => bigTire(b, wr, 0.52, yel, sx < 0 ? 0.12 : 0));
    for (const x of [0.76, 1.03]) b.group({ p: [sx * x, wr, ra] }, () => bigTire(b, wr, 0.46, yel, 0, x > 0.9));
  }
  // frame + axles + fuel tank
  for (const sx of [-1, 1]) b.box('rust', 0.2, 0.36, 6.6, { p: [sx * 0.45, 1.0, -0.2] });
  b.box('rust', 2.0, 0.2, 0.3, { p: [0, 0.72, fa] });
  b.box('rust', 2.0, 0.26, 0.4, { p: [0, 0.72, ra] });
  b.cyl('metal', 0.3, 0.3, 1.1, 10, { p: [-0.9, 1.1, -0.35], r: [PI / 2, 0, 0] });
  b.box('rust', 0.5, 0.36, 0.7, { p: [0.9, 1.05, -0.3] }); // battery/tool box
  // ---- engine hood + radiator + bumper
  b.frustum('carpaint', 1.7, 1.5, 1.6, 1.46, 1.05, 2.05, { p: [0, 0, -2.95], c: yel });
  b.box('dark', 1.4, 0.8, 0.03, { p: [0, 1.5, -3.71] });
  for (let k = 0; k < 7; k++) b.box('steel', 1.4, 0.03, 0.04, { p: [0, 1.17 + k * 0.11, -3.72] });
  b.box('rust', 2.5, 0.36, 0.34, { p: [0, 0.88, -3.52] });
  for (const sx of [-1, 1]) {
    b.box('steel', 0.24, 0.18, 0.08, { p: [sx * 0.9, 1.25, -3.72] });
    b.box(sx < 0 ? 'glass' : 'dark', 0.2, 0.14, 0.02, { p: [sx * 0.9, 1.25, -3.765] });
    // front fenders over the wheels
    b.cyl('carpaint', wr + 0.12, wr + 0.12, 0.6, 10, { theta: [-PI / 2 - 0.3, PI * 0.95], open: true, p: [sx * 1.0, wr, fa], r: [0, 0, PI / 2], c: yel });
    b.box('carpaint', 0.6, 0.05, 0.9, { p: [sx * 1.0, 1.58, fa - 0.6], c: yel, r: [0.25, 0, 0] });
  }
  // deck over the fenders + handrails + ladder up to the cab
  b.box('rust', 2.5, 0.06, 1.2, { p: [0, 1.6, -1.55] });
  for (const sx of [-1, 1]) {
    b.cylBetween('steel', [sx * 1.22, 1.6, -2.1], [sx * 1.22, 2.5, -2.1], 0.02, 0.02, 4);
    b.cylBetween('steel', [sx * 1.22, 2.5, -2.1], [sx * 1.22, 2.5, -1.1], 0.02, 0.02, 4);
  }
  for (let k = 0; k < 4; k++) b.box('rust', 0.4, 0.04, 0.2, { p: [-1.3, 0.35 + k * 0.33, -1.25 - k * 0.04] });
  b.cylBetween('rust', [-1.5, 0.3, -1.3], [-1.5, 1.6, -1.45], 0.02, 0.02, 4);
  b.cylBetween('rust', [-1.1, 0.3, -1.3], [-1.1, 1.6, -1.45], 0.02, 0.02, 4);
  // ---- cab
  const cabCol = yel.map((c) => c * 0.95);
  b.box('carpaint', 2.0, 1.2, 1.1, { p: [0, 2.23, -1.5], c: cabCol });
  b.box('dark', 1.7, 0.6, 0.02, { p: [0, 2.43, -2.056] });
  b.box('glass', 1.62, 0.54, 0.01, { p: [0, 2.43, -2.066] });
  b.box('carpaint', 0.06, 0.6, 0.03, { p: [0, 2.43, -2.07], c: cabCol });
  for (const sx of [-1, 1]) {
    b.box('dark', 0.02, 0.55, 0.9, { p: [sx * 1.001, 2.45, -1.5] });
    if (!(sx > 0 && v === 1)) b.box('glass', 0.01, 0.5, 0.84, { p: [sx * 1.012, 2.45, -1.5] });
    b.box('dark', 0.012, 1.1, 0.012, { p: [sx * 1.004, 2.2, -1.0] });
    b.box('chrome', 0.03, 0.04, 0.14, { p: [sx * 1.02, 2.0, -1.12] });
    b.cylBetween('steel', [sx * 1.0, 2.6, -2.0], [sx * 1.35, 2.5, -2.2], 0.015, 0.015, 4);
    b.box('dark', 0.05, 0.36, 0.2, { p: [sx * 1.37, 2.35, -2.2] });
  }
  b.cyl('rust', 0.07, 0.08, 1.5, 7, { p: [0.75, 2.3, -2.25] });
  b.cyl('charred', 0.08, 0.07, 0.1, 7, { p: [0.75, 3.07, -2.25] });
  // ---- dump bed: sides from extruded profile, sloped floor, head board + canopy over the cab
  const sp = new THREE.Shape();
  sp.moveTo(-0.9, 1.5);
  sp.lineTo(3.3, 1.28);
  sp.lineTo(3.58, 1.72);
  sp.lineTo(3.4, 2.78);
  sp.lineTo(-0.9, 2.96);
  sp.lineTo(-0.9, 1.5);
  for (const sx of [-1, 1]) {
    b.extrude('carpaint', sp, 0.08, { r: [0, -PI / 2, 0], p: [sx * 1.26 + 0.04, 0, 0], c: yel });
    for (const z of [-0.3, 0.6, 1.5, 2.4, 3.2]) b.box('carpaint', 0.08, 1.35 - z * 0.05, 0.12, { p: [sx * 1.32, 2.12 - z * 0.03, z], c: yel });
    b.box('carpaint', 0.12, 0.1, 4.4, { p: [sx * 1.3, 2.9, 1.25], r: [-0.042, 0, 0], c: yel });
    b.cylBetween('chrome', [sx * 0.35, 1.2, -0.7], [sx * 0.35, 1.55, -0.2], 0.07, 0.07, 6); // hoist rams
  }
  b.beam('rust', [0, 1.52, -0.9], [0, 1.3, 3.32], 2.5, 0.08, { side: [0, 1, 0.05] });
  b.beam('rust', [0, 1.3, 3.3], [0, 1.74, 3.58], 2.5, 0.08, { side: [0, 0.5, -1] });
  b.box('carpaint', 2.6, 1.55, 0.1, { p: [0, 2.24, -0.95], c: yel });
  b.box('carpaint', 2.6, 0.1, 1.45, { p: [0, 3.06, -1.65], c: yel });
  for (const x of [-0.8, 0, 0.8]) b.box('carpaint', 0.1, 0.14, 1.45, { p: [x, 2.97, -1.65], c: yel });
  // leftover gravel in the bed + rust patches
  b.sphere('gravel', 1, 10, 4, { p: [0.2, 1.4, 2.2], s: [1.1, 0.35, 1.3], thetaLen: PI / 2 });
  for (const [x, y, z] of [[0.6, 1.62, 1.4], [-0.5, 1.58, 2.8], [0.1, 1.72, 2.1]]) b.rock('stone_rough', 0.12, { detail: 0, seed: 400 + (x * 10) | 0, p: [x, y, z] });
  b.box('rust', 0.01, 0.8, 1.2, { p: [1.345, 2.0, 2.2] });
  weeds(b, r, [[1.4, 0.2], [-1.4, 3.3], [1.3, -3.3], [-0.6, -3.7]], 0.6);
};

BUILD.boom_gate = (b, r, v) => {
  const px = -2.1;
  const white = [0.82, 0.8, 0.72], red = [0.7, 0.12, 0.08];
  b.box('concrete', 0.55, 0.12, 0.5, { p: [px, 0.06, 0.02] });
  b.box('paint', 0.34, 0.92, 0.34, { p: [px, 0.58, 0.04], c: white });
  b.box('paint', 0.36, 0.14, 0.36, { p: [px, 0.9, 0.04], c: red });
  b.box('paint', 0.38, 0.03, 0.38, { p: [px, 1.055, 0.04], c: white });
  b.box('dark', 0.2, 0.3, 0.004, { p: [px, 0.5, -0.135] });
  b.box('steel', 0.04, 0.06, 0.02, { p: [px + 0.06, 0.48, -0.14] });
  b.cyl('taillight', 0.06, 0.07, 0.1, 8, { p: [px, 1.12, 0.04] });
  // pivot hub on the front face
  b.cyl('steel', 0.09, 0.09, 0.08, 10, { p: [px, 0.98, -0.17], r: [PI / 2, 0, 0] });
  const arm = (x0, x1, y, z, tilt) => {
    b.group({ p: [x0, y, z], r: [0, 0, tilt] }, () => {
      const L = x1 - x0, n = Math.max(1, Math.round(L / 0.42));
      const seg = L / n;
      for (let k = 0; k < n; k++) b.box('paint', seg, 0.09, 0.07, { p: [seg * (k + 0.5), 0, 0], c: k % 2 ? white : red });
      b.cyl('taillight', 0.035, 0.035, 0.02, 8, { p: [L - 0.1, 0, -0.04], r: [PI / 2, 0, 0] });
    });
  };
  // counterweight behind the pivot
  b.box('metal', 0.34, 0.2, 0.12, { p: [px - 0.22, 0.98, -0.2] });
  if (v === 1) {
    // arm snapped: stub on the hub + broken piece lying on the road
    arm(px + 0.05, 0.4, 0.98, -0.2, 0.0);
    b.box('rust', 0.06, 0.07, 0.06, { p: [0.44, 0.98, -0.2], r: [0, 0, 0.4] });
    b.group({ p: [0.9, 0.05, -0.1], r: [0, -0.25, 0.02] }, () => arm(0, 1.9, 0, 0, 0));
  } else arm(px + 0.05, 2.3, 0.98, -0.2, 0.0);
  // warning plate hanging from the arm
  b.plane('labels', 0.3, 0.3, { atlas: 'sign', p: [v === 1 ? -0.4 : 0.2, 0.74, -0.24], r: [0, PI, PI / 4] });
  b.cylBetween('wire', [v === 1 ? -0.4 : 0.2, 0.93, -0.22], [v === 1 ? -0.4 : 0.2, 0.84, -0.23], 0.004, 0.004, 3);
  weeds(b, r, [[px + 0.3, 0.3], [px - 0.2, -0.35]], 0.5);
};

BUILD.saw_table = (b, r) => {
  const top = 0.82;
  // welded frame
  for (const sx of [-1, 1]) {
    for (const z of [-1.6, -0.5, 0.5, 1.6]) b.box('rust', 0.1, top - 0.06, 0.1, { p: [sx * 0.7, (top - 0.06) / 2, z] });
    b.box('rust', 0.12, 0.16, 3.4, { p: [sx * 0.7, top - 0.08, 0] });
    b.box('rust', 0.08, 0.08, 3.3, { p: [sx * 0.7, 0.22, 0] });
  }
  for (const z of [-1.6, 1.6]) b.box('rust', 1.4, 0.08, 0.08, { p: [0, 0.22, z] });
  // roller bed (gap for the blade)
  for (let z = -1.55; z <= 1.56; z += 0.3) {
    if (Math.abs(z) < 0.4) continue;
    b.cyl('steel', 0.05, 0.05, 1.3, 7, { p: [0, top - 0.02, z], r: [0, 0, PI / 2] });
  }
  b.box('metal', 1.3, 0.04, 0.78, { p: [0, top - 0.01, 0] });
  b.box('dark', 0.03, 0.045, 0.9, { p: [0, top - 0.005, 0] });
  // blade housing under the table + motor + belt
  b.box('metal', 0.3, 0.55, 1.1, { p: [0, 0.48, 0] });
  b.box('paint', 0.4, 0.34, 0.5, { p: [0.45, 0.4, 0.6], c: [0.28, 0.36, 0.3] });
  b.cyl('paint', 0.16, 0.16, 0.5, 10, { p: [0.45, 0.4, 0.6], r: [0, 0, PI / 2], c: [0.3, 0.38, 0.32] });
  b.tube('rubber', [[0.2, 0.4, 0.6], [0.1, 0.55, 0.3], [0.05, 0.68, 0.0]], 0.02, 6, 4);
  b.box('paint', 0.12, 0.2, 0.08, { p: [0.76, 0.7, -1.6], c: [0.6, 0.12, 0.08] });
  b.cyl('dark', 0.03, 0.03, 0.04, 6, { p: [0.76, 0.72, -1.65], r: [PI / 2, 0, 0] });
  // big circular blade, axis along X, peeking ~0.35 m above the bed
  const R = 0.5, cy = 0.6;
  b.cyl('chrome', R, R, 0.01, 24, { p: [0, cy, 0], r: [0, 0, PI / 2] });
  b.cyl('rust', R * 0.72, R * 0.72, 0.012, 20, { p: [0, cy, 0], r: [0, 0, PI / 2], open: false });
  b.cyl('rust', 0.09, 0.09, 0.05, 8, { p: [0, cy, 0], r: [0, 0, PI / 2] });
  const teeth = 28, verts = [], faces = [];
  for (let k = 0; k < teeth; k++) {
    const a0 = (k / teeth) * PI * 2, a1 = ((k + 0.7) / teeth) * PI * 2;
    const p = (a, rr2) => [0, cy + Math.cos(a) * rr2, Math.sin(a) * rr2];
    const i = verts.length;
    verts.push(p(a0, R - 0.005), p(a1, R - 0.005), p(a0 + 0.03, R + 0.045));
    faces.push([i, i + 1, i + 2], [i, i + 2, i + 1]);
  }
  b.poly('chrome', verts, faces);
  // a log riding on the rollers toward the blade
  b.group({ p: [0.32, top + 0.17, -1.0], r: [PI / 2, 0, 0] }, () => {
    b.cyl('bark', 0.16, 0.17, 1.2, 8, { grain: true, open: true });
    b.disc('woodend', 0.16, 8, { p: [0, 0.6, 0] });
    b.disc('woodend', 0.17, 8, { p: [0, -0.6, 0], r: [PI, 0, 0] });
  });
  // sawdust, blood
  for (const [x, z, s] of [[0.1, 0.3, 0.5], [-0.3, -0.4, 0.35], [0.4, 1.2, 0.3]]) b.sphere('wood', s, 8, 3, { p: [x, 0, z], s: [1.3, 0.25, 1], c: [1.12, 0.96, 0.72], thetaLen: PI / 2 });
  b.plane('blood_decal', 0.5, 0.5, { raw: true, p: [0.18, top + 0.012, 0.25], r: [-PI / 2, 0, 1.1] });
  b.sphere('blood', 0.03, 5, 3, { p: [0.006, cy + 0.3, -0.25], s: [0.3, 1.4, 1.2] });
  weeds(b, r, [[0.8, 1.2], [-0.8, -0.9]], 0.5);
};

BUILD.gravel_pile = (b, r) => {
  // lumpy cone (lathe with periodic angular noise so the seam stays closed)
  const prof = [[2.56, -0.02], [2.5, 0.1], [2.3, 0.38], [1.95, 0.8], [1.5, 1.26], [0.95, 1.74], [0.4, 2.05], [0.0, 2.12]];
  const seg = 22;
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const rad = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const n = 0.09 * Math.sin(a * 2 + ph[0]) + 0.06 * Math.sin(a * 3 + ph[1]) + 0.04 * Math.sin(a * 5 + ph[2]) + 0.03 * Math.sin(a * 7 + y * 3 + ph[3]);
    const k = 1 + n * Math.min(1, rad / 1.2);
    const yy = y > 0.05 ? y * (1 + n * 0.35) : y;
    pos.setXYZ(i, x * k, yy, z * k);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 0.8 + pos.getY(i) * 0.3, pos.getZ(i) * 0.8 - pos.getY(i) * 0.3);
  b.add('gravel', g, { raw: true });
  // spilled skirt + a few boulders
  for (let k = 0; k < 9; k++) {
    const a = r() * PI * 2, d = rr(r, 2.3, 2.7);
    b.sphere('gravel', rr(r, 0.25, 0.45), 6, 3, { p: [Math.cos(a) * d, -0.02, Math.sin(a) * d], s: [1.6, 0.22, 1.1], thetaLen: PI / 2, r: [0, a, 0] });
  }
  for (let k = 0; k < 6; k++) {
    const a = r() * PI * 2, d = rr(r, 0.6, 2.6);
    const y = d > 2.3 ? 0.1 : 2.1 - d * 0.8;
    b.rock('stone_rough', rr(r, 0.12, 0.3), { detail: 0, seed: 600 + k, p: [Math.cos(a) * d, y, Math.sin(a) * d], r: [0, r() * 3, 0] });
  }
  weeds(b, r, [[2.4, 0.8], [-2.2, -1.2], [0.5, -2.5]], 0.5);
};

BUILD.hunting_stand = (b, r) => {
  const t = WOODS[2], L = 0.7, fl = 3.2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) plank(b, 'wood', 0.12, fl + 0.05, 0.12, { p: [sx * L, (fl + 0.05) / 2, sz * L], c: t });
  // X bracing + girts on all four sides
  const br = (a, c) => b.beam('wood', a, c, 0.08, 0.04, { c: WOODS[1] });
  for (const s of [-1, 1]) {
    br([-L, 0.35, s * (L + 0.07)], [L, 2.95, s * (L + 0.07)]);
    br([L, 0.35, s * (L + 0.08)], [-L, 2.95, s * (L + 0.08)]);
    br([s * (L + 0.07), 0.35, -L], [s * (L + 0.07), 2.95, L]);
    br([s * (L + 0.08), 0.35, L], [s * (L + 0.08), 2.95, -L]);
    plank(b, 'wood', 1.56, 0.1, 0.05, { p: [0, 1.6, s * (L + 0.085)], c: t });
    plank(b, 'wood', 0.05, 0.1, 1.56, { p: [s * (L + 0.085), 1.6, 0], c: t });
  }
  // platform deck + joists
  for (let k = 0; k < 8; k++) plank(b, 'wood', 1.62, 0.05, 0.19, { p: [0, fl + 0.025, -0.72 + k * 0.205 + rr(r, -0.01, 0.01)], c: WOODS[k % 2 ? 1 : 3] });
  for (const s of [-1, 1]) plank(b, 'wood', 0.08, 0.14, 1.6, { p: [s * 0.55, fl - 0.07, 0], c: t });
  // rail posts + rails
  const top = fl + 1.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) plank(b, 'wood', 0.08, top - fl, 0.08, { p: [sx * (L + 0.02), fl + (top - fl) / 2, sz * (L + 0.02)], c: t });
  for (const s of [-1, 1]) {
    plank(b, 'wood', 1.6, 0.06, 0.06, { p: [0, top - 0.03, s * (L + 0.04)], c: t });
    plank(b, 'wood', 0.06, 0.06, 1.6, { p: [s * (L + 0.04), top - 0.03, 0], c: t });
    plank(b, 'wood', 0.06, 0.06, 1.6, { p: [s * (L + 0.04), fl + 0.5, 0], c: t });
  }
  plank(b, 'wood', 1.6, 0.06, 0.06, { p: [0, fl + 0.5, L + 0.04], c: t });
  // camo tarp wrapped around the rail (3 sides + two front flaps), sagging between posts
  const tarp = (a, c, sag) => {
    const cols = 4, rows = 2, verts = [], faces = [];
    for (let i = 0; i <= cols; i++)
      for (let j = 0; j <= rows; j++) {
        const u = i / cols, w2 = j / rows;
        const x = a[0] + (c[0] - a[0]) * u, z = a[1] + (c[1] - a[1]) * u;
        const y = top - 0.05 - w2 * 0.85 - Math.sin(u * PI) * sag * (0.3 + w2);
        const bulge = Math.sin(u * PI) * sag * w2 * 0.6;
        const nx = -(c[1] - a[1]), nz = c[0] - a[0], nl = Math.hypot(nx, nz) || 1;
        verts.push([x + (nx / nl) * bulge, y + (j === rows && i % 2 ? -0.06 : 0), z + (nz / nl) * bulge]);
      }
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const q = i * (rows + 1) + j;
        faces.push([q, q + rows + 1, q + 1], [q + 1, q + rows + 1, q + rows + 2]);
      }
    b.poly('canvas_mil', verts, faces);
  };
  const e = L + 0.07;
  tarp([-e, e], [e, e], 0.06);
  tarp([e, e], [e, -e], 0.08);
  tarp([-e, -e], [-e, e], 0.05);
  tarp([-e, -e], [-0.3, -e], 0.03);
  tarp([0.35, -e], [e, -e], 0.03);
  for (const [x, z] of [[-e, e], [e, e], [e, -e], [-e, -e]]) b.torus('rope', 0.04, 0.008, 3, 6, PI * 2, { p: [x, top - 0.05, z], r: [PI / 2, 0, 0] });
  // seat + ladder on the -Z side
  plank(b, 'wood', 0.6, 0.05, 0.35, { p: [0, fl + 0.45, 0.4], c: WOODS[1] });
  plank(b, 'wood', 0.06, 0.4, 0.06, { p: [0, fl + 0.22, 0.4], c: t });
  for (const sx of [-0.23, 0.23]) b.beam('wood', [sx, 0, -1.25], [sx, fl + 0.3, -e - 0.03], 0.07, 0.05, { c: t });
  for (let k = 1; k < 11; k++) {
    const u = k / 11.3;
    b.box('wood', 0.5, 0.04, 0.06, { p: [0, u * (fl + 0.3), -1.25 + (1.25 - e - 0.03) * u - 0.03], c: WOODS[1] });
  }
  weeds(b, r, [[-0.7, -0.9], [0.8, 0.8], [0.9, -0.6]], 0.6);
};

BUILD.billboard = (b, r) => {
  const t = [0.58, 0.48, 0.4];
  for (const sx of [-1, 1]) {
    b.cyl('wood', 0.12, 0.15, 6.5, 8, { p: [sx * 2.0, 3.25, 0.1], grain: true, c: t });
    // knee braces to the board
    b.beam('wood', [sx * 2.0, 2.6, 0.12], [sx * 1.4, 3.7, 0.08], 0.1, 0.08, { c: WOODS[2] });
    b.beam('wood', [sx * 2.0, 2.6, 0.12], [sx * 2.6, 3.7, 0.08], 0.1, 0.08, { c: WOODS[2] });
  }
  // stringers + plank backing
  for (const y of [3.75, 4.9, 6.05]) plank(b, 'wood', 5.6, 0.14, 0.09, { p: [0, y, -0.02], c: WOODS[1] });
  b.box('planks', 5.4, 2.6, 0.04, { p: [0, 4.9, -0.085] });
  // painted frame + poster
  const fr = [0.3, 0.32, 0.3];
  plank(b, 'wood', 5.5, 0.1, 0.05, { p: [0, 6.2, -0.12], c: fr });
  plank(b, 'wood', 5.5, 0.1, 0.05, { p: [0, 3.6, -0.12], c: fr });
  for (const sx of [-1, 1]) plank(b, 'wood', 0.1, 2.7, 0.05, { p: [sx * 2.7, 4.9, -0.12], c: fr });
  b.plane('labels', 5.3, 2.5, { atlas: 'billboard', p: [0, 4.9, -0.108], r: [0, PI, 0] });
  // peeling strips
  b.plane('cloth', 0.35, 0.9, { p: [1.6, 4.1, -0.2], r: [0.35, PI + 0.2, 0.15], c: [0.76, 0.74, 0.64] });
  b.plane('cloth', 0.28, 0.6, { p: [-2.1, 5.6, -0.16], r: [0.2, PI - 0.3, -0.25], c: [0.66, 0.7, 0.72] });
  // catwalk + dead lamps
  b.box('metal', 5.2, 0.04, 0.34, { p: [0, 3.5, -0.3] });
  for (let k = 0; k < 14; k++) b.box('dark', 0.02, 0.041, 0.3, { p: [-2.5 + k * 0.38, 3.5, -0.3] });
  for (const x of [-2.2, 0, 2.2]) b.beam('rust', [x, 3.48, -0.45], [x, 3.0, -0.06], 0.05, 0.04, { side: [1, 0, 0] });
  b.box('rust', 5.2, 0.03, 0.03, { p: [0, 3.9, -0.46] });
  for (const x of [-2.4, -0.4, 1.6]) b.box('rust', 0.03, 0.4, 0.03, { p: [x, 3.7, -0.46] });
  for (const x of [-1.6, 0, 1.6]) {
    b.tube('rust', [[x, 6.2, -0.1], [x, 6.45, -0.3], [x, 6.4, -0.55]], 0.02, 5, 4);
    b.frustum('metal', 0.14, 0.22, 0.28, 0.34, 6.28, 6.38, { p: [x, 0, -0.56] });
  }
  // back: horizontal stiffeners visible from behind
  for (const y of [4.3, 5.5]) plank(b, 'wood', 5.2, 0.1, 0.06, { p: [0, y, -0.02], c: WOODS[2] });
  weeds(b, r, [[-2.0, -0.3], [2.1, 0.3], [0.4, -0.2]], 0.7);
};

BUILD.motel_sign = (b, r) => {
  const teal = [0.3, 0.6, 0.58], cream = [0.85, 0.8, 0.66];
  b.cyl('concrete', 0.36, 0.4, 0.3, 10, { p: [0, 0.15, 0.12] });
  b.cyl('metal', 0.13, 0.15, 6.9, 8, { p: [0, 3.45, 0.12] });
  b.cyl('rust', 0.16, 0.16, 0.3, 8, { p: [0, 0.45, 0.12] });
  // arrow board (extruded), front faces -Z
  const s = new THREE.Shape();
  s.moveTo(-0.72, 5.25);
  s.lineTo(1.2, 5.25);
  s.lineTo(1.2, 6.45);
  s.lineTo(-0.72, 6.45);
  s.lineTo(-0.72, 6.72);
  s.lineTo(-1.3, 5.85);
  s.lineTo(-0.72, 4.98);
  s.lineTo(-0.72, 5.25);
  const dz = 0.24;
  b.extrude('paint', s, dz, { p: [0, 0, -0.1], c: teal });
  b.plane('labels', 1.75, 0.86, { atlas: 'motel', p: [0.24, 5.85, -0.103], r: [0, PI, 0] });
  b.plane('labels', 1.75, 0.86, { atlas: 'motel', p: [0.24, 5.85, dz - 0.1 + 0.003] });
  // bulbs around the arrow edge
  const pts = [[-0.72, 6.72], [-1.3, 5.85], [-0.72, 4.98]];
  const edge = (a, c, n) => {
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      const x = a[0] + (c[0] - a[0]) * u, y = a[1] + (c[1] - a[1]) * u;
      b.sphere(r() < 0.25 ? 'dark' : 'glass', 0.035, 5, 3, { p: [x * 0.96 + 0.01, y + (y > 5.85 ? -0.05 : 0.05) * 0.6, -0.12] });
    }
  };
  edge(pts[0], pts[1], 4);
  edge(pts[1], pts[2], 4);
  for (let k = 0; k < 9; k++) {
    const x = -0.55 + k * 0.2;
    b.sphere(r() < 0.3 ? 'dark' : 'glass', 0.035, 5, 3, { p: [x, 6.38, -0.12] });
    b.sphere(r() < 0.3 ? 'dark' : 'glass', 0.035, 5, 3, { p: [x, 5.32, -0.12] });
  }
  // cream trim cap + star on top
  b.box('paint', 1.96, 0.06, 0.28, { p: [0.24, 6.47, 0.02], c: cream });
  const st = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * PI * 2 + PI / 2, R = k % 2 ? 0.12 : 0.28;
    const x = 0.8 + Math.cos(a) * R, y = 6.78 + Math.sin(a) * R;
    if (k === 0) st.moveTo(x, y);
    else st.lineTo(x, y);
  }
  b.extrude('paint', st, 0.08, { p: [0, 0, -0.02], c: [0.72, 0.58, 0.2] });
  b.cyl('metal', 0.02, 0.02, 0.28, 4, { p: [0.8, 6.55, 0.02] });
  // NO VACANCY box hung below
  b.box('paint', 1.3, 0.34, 0.18, { p: [0.3, 4.62, 0.02], c: [0.22, 0.22, 0.2] });
  b.plane('labels', 1.24, 0.3, { atlas: 'vacancy', p: [0.3, 4.62, -0.072], r: [0, PI, 0] });
  for (const x of [-0.2, 0.8]) b.cylBetween('steel', [x, 4.79, 0.02], [x, 5.25, 0.02], 0.012, 0.012, 4);
  // brace from the pole
  b.beam('metal', [0, 4.4, 0.12], [0.9, 5.25, 0.06], 0.06, 0.06);
  b.beam('metal', [0, 4.4, 0.12], [-0.6, 5.25, 0.06], 0.06, 0.06);
  // rust drips
  for (const x of [-0.4, 0.5, 1.0]) b.box('rust', 0.05, 0.3 + r() * 0.3, 0.004, { p: [x, 5.1, -0.104] });
  weeds(b, r, [[0.3, 0.4], [-0.35, -0.1]], 0.6);
};

BUILD.satellite_dish = (b, r) => {
  const white = [0.84, 0.84, 0.8];
  b.cyl('concrete', 0.42, 0.46, 0.34, 10, { p: [0, 0.17, 0] });
  b.cyl('metal', 0.11, 0.12, 1.4, 8, { p: [0, 1.04, 0] });
  b.box('paint', 0.22, 0.3, 0.12, { p: [0.14, 0.9, 0.08], c: [0.5, 0.52, 0.46] });
  b.tube('rubber', [[0.15, 0.8, 0.1], [0.3, 0.5, 0.2], [0.35, 0.2, 0.3], [0.5, 0.02, 0.5]], 0.018, 8, 4);
  // yoke + elevation jack
  b.box('metal', 0.3, 0.16, 0.3, { p: [0, 1.8, 0] });
  for (const sx of [-1, 1]) b.box('metal', 0.04, 0.4, 0.2, { p: [sx * 0.16, 1.95, -0.06] });
  b.cylBetween('chrome', [0, 1.5, 0.12], [0, 2.3, 0.25], 0.03, 0.03, 6);
  // dish tilted up toward -Z
  const f = 0.9, Rr = 1.25;
  const prof = [];
  for (let k = 0; k <= 7; k++) {
    const rr2 = (k / 7) * Rr;
    prof.push([Math.max(0.001, rr2), (rr2 * rr2) / (4 * f)]);
  }
  b.group({ p: [0, 2.02, -0.08], r: [-0.72, 0, 0] }, () => {
    b.lathe('paint', prof.slice().reverse(), 20, { c: white }); // concave face
    b.lathe('paint', prof.map(([x, y]) => [x, y - 0.014]), 20, { c: white.map((c) => c * 0.82) }); // convex back
    b.torus('paint', Rr, 0.025, 4, 20, PI * 2, { p: [0, (Rr * Rr) / (4 * f) - 0.006, 0], r: [PI / 2, 0, 0], c: white });
    // back frame: ring + ribs + hub
    b.torus('steel', 0.6, 0.02, 3, 12, PI * 2, { p: [0, 0.07, 0], r: [PI / 2, 0, 0] });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * PI * 2;
      b.cylBetween('steel', [0, -0.04, 0], [Math.cos(a) * 1.1, (1.1 * 1.1) / (4 * f) - 0.03, Math.sin(a) * 1.1], 0.015, 0.015, 3);
    }
    b.cyl('metal', 0.14, 0.18, 0.14, 8, { p: [0, -0.06, 0] });
    // feed horn on three struts
    const fy = f;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * PI * 2 + PI / 2;
      b.cylBetween('steel', [Math.cos(a) * Rr * 0.96, (Rr * Rr) / (4 * f), Math.sin(a) * Rr * 0.96], [0, fy - 0.05, 0], 0.014, 0.014, 4);
    }
    b.cyl('paint', 0.07, 0.05, 0.2, 8, { p: [0, fy, 0], c: [0.5, 0.5, 0.46] });
    b.cyl('dark', 0.05, 0.05, 0.02, 8, { p: [0, fy - 0.1, 0] });
    b.tube('rubber', [[0, fy + 0.08, 0], [0.1, fy - 0.1, -0.3], [Math.cos(PI / 2) * Rr * 0.9, 0.35, Math.sin(PI / 2) * Rr * 0.9]], 0.012, 8, 3);
  });
  weeds(b, r, [[0.5, 0.3], [-0.45, -0.3], [0.1, 0.55]], 0.5);
};

BUILD.fence_chain = (b, r, v) => {
  const H = 1.95;
  for (const x of [-1.5, 1.5]) {
    b.cyl('steel', 0.035, 0.035, H + 0.05, 6, { p: [x, (H + 0.05) / 2, 0] });
    b.cyl('steel', 0.045, 0.04, 0.05, 6, { p: [x, H + 0.05, 0] });
    b.cyl('concrete', 0.1, 0.12, 0.08, 6, { p: [x, 0.03, 0] });
    // barbed-wire arm leaning outward (-Z)
    b.beam('steel', [x, H + 0.02, 0], [x, 2.2, -0.14], 0.03, 0.03, { side: [1, 0, 0] });
  }
  b.cyl('steel', 0.022, 0.022, 3.0, 6, { p: [0, H - 0.02, 0], r: [0, 0, PI / 2] });
  b.cylBetween('wire', [-1.5, 0.08, 0.0], [1.5, 0.08, 0.0], 0.004, 0.004, 3);
  // sagging, bellied mesh
  const cols = 10, rows = 6, W = 2.96;
  const verts = [], uvs = [], idx = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const u = i / cols, w = j / rows;
      const x = -W / 2 + u * W;
      const mid = Math.sin(u * PI);
      let y = 0.06 + w * (H - 0.1) - mid * 0.06 * w;
      let z = -mid * 0.09 * (1 - w) ** 1.5 * (v === 1 ? 2.2 : 1);
      if (j === 0) y += mid * (v === 1 ? 0.35 : 0.08) * (r() * 0.5 + 0.75);
      if (v === 1 && i >= cols - 2 && j <= 1) {
        // peeled-up corner
        y += (i - (cols - 3)) * 0.12;
        z -= (i - (cols - 3)) * 0.12;
      }
      verts.push(x, y, z);
      uvs.push(x, y);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, c = a + cols + 1;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  b.add('chainlink', g, { raw: true });
  // three barbed strands on the arms
  for (let s = 0; s < 3; s++) {
    const t = (s + 1) / 3;
    const y = H + 0.02 + (2.2 - H - 0.02) * t, z = -0.14 * t;
    const sag = s === 1 && v === 1 ? -0.2 : -0.02;
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      pts.push([-1.5 + 3 * u, y + Math.sin(u * PI) * sag, z]);
    }
    b.tube('wire', pts, 0.004, 8, 3);
    for (let k = 0; k < 5; k++) {
      const u = (k + 0.5) / 5;
      const p = [-1.5 + 3 * u, y + Math.sin(u * PI) * sag, z];
      b.cylBetween('wire', [p[0] - 0.02, p[1] - 0.02, p[2]], [p[0] + 0.02, p[1] + 0.02, p[2]], 0.003, 0.003, 3);
      b.cylBetween('wire', [p[0], p[1] + 0.02, p[2] - 0.02], [p[0], p[1] - 0.02, p[2] + 0.02], 0.003, 0.003, 3);
    }
  }
  if (v === 1) b.plane('cloth', 0.2, 0.3, { p: [0.4, 2.02, -0.08], r: [0.1, 0, 0.3], c: [0.45, 0.2, 0.15] });
  weeds(b, r, [[-1.3, 0.05], [0.4, 0.0], [1.2, -0.05]], 0.5);
};
