// What stands and lies in the streets of Port Calder (shared/props-street.js): street furniture, the traffic that
// never left, what the army put up and abandoned, what people dropped. Builders as in props.js: (b, r, v) with b a
// MeshBuilder, r a seeded rng, v the variant; origin at ground centre of the footprint, front to -Z.
import * as THREE from 'three';
import { rr, pick, WOODS, wheel, label, weeds, plank, CAR_COLORS, sedan } from './props.js';
import { boxShell, profShell, leaf, seat, dash, steering, mirror, sitter, luggage, rubbish, bloodPatch, burntSeat, deck, busRows, paneLook, LINING, CHAR, SEATS } from './cabin.js';

const PI = Math.PI;

export const STREET_VARIANTS = {};
export const STREET_PROPS = {};

// ------------------------------------------------------------------ shared parts
const RUSTC = [0.3, 0.17, 0.1];
const PAPERS = [[0.74, 0.72, 0.64], [0.6, 0.56, 0.46], [0.5, 0.52, 0.5], [0.66, 0.5, 0.4]];
const mul = (c, k) => c.map((q) => q * k);

/** a vertex-colour function: paint gone to rust in blotches (amt), and the more the nearer the ground (below `low`) */
const worn = (amt = 0.4, low = 0, to = RUSTC) => (x, y, z, c) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  const k = Math.min(1, (h - Math.floor(h)) * amt + (low ? Math.max(0, 1 - y / low) * 0.55 : 0));
  c.r += (to[0] - c.r) * k;
  c.g += (to[1] - c.g) * k;
  c.b += (to[2] - c.b) * k;
  return c;
};

/** a flat sheet through pts (a fan from the first), wound to face n; both: a face each way (one-sided materials) */
function sheet(b, mat, pts, n, o = {}, both = false) {
  const [p, q, s] = pts;
  const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [s[0] - p[0], s[1] - p[1], s[2] - p[2]];
  const d = (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2];
  const faces = [];
  for (let k = 1; k < pts.length - 1; k++) {
    if (d > 0 || both) faces.push([0, k, k + 1]);
    if (d <= 0 || both) faces.push([0, k + 1, k]);
  }
  return b.poly(mat, pts, faces, o);
}

/** a closed solid from its corners and its faces (loops of corners), each face wound to look away from the middle */
function solid(b, mat, verts, loops, o = {}) {
  const c = [0, 0, 0];
  for (const p of verts) for (let k = 0; k < 3; k++) c[k] += p[k] / verts.length;
  const faces = [];
  for (const f of loops) {
    const [p, q, s] = [verts[f[0]], verts[f[1]], verts[f[2]]];
    const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [s[0] - p[0], s[1] - p[1], s[2] - p[2]];
    const out = (e1[1] * e2[2] - e1[2] * e2[1]) * (p[0] - c[0]) + (e1[2] * e2[0] - e1[0] * e2[2]) * (p[1] - c[1]) + (e1[0] * e2[1] - e1[1] * e2[0]) * (p[2] - c[2]) > 0;
    for (let k = 1; k < f.length - 1; k++) faces.push(out ? [f[0], f[k], f[k + 1]] : [f[0], f[k + 1], f[k]]);
  }
  return b.poly(mat, verts, faces, o);
}

/** a side profile [[z, y], ...] extruded across the width w, centred on x = cx (as sedan's body) */
function sideProf(b, mat, pts, w, o = {}, cx = 0) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], k) => (k ? s.lineTo(z, y) : s.moveTo(z, y)));
  return b.extrude(mat, s, w, { ...o, r: [0, -PI / 2, 0], p: [cx + w / 2, 0, 0] });
}

/** a cross-section [[x, y], ...] extruded along z from z0 over len */
function crossProf(b, mat, pts, z0, len, o = {}) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], k) => (k ? s.lineTo(x, y) : s.moveTo(x, y)));
  return b.extrude(mat, s, len, { ...o, p: [0, 0, z0] });
}

/** the points of a wheel arch cut up out of a side profile's bottom edge at y0 (z rising) */
const arch = (zc, y0, R, n = 6) => Array.from({ length: n + 1 }, (_, k) => [zc - R * Math.cos((k / n) * PI), y0 + R * Math.sin((k / n) * PI)]);

/** a pane or a panel on an upright face. dir: 'z-' | 'z+' | 'x-' | 'x+' */
function pane(b, mat, w, h, p, dir, o = {}) {
  b.plane(mat, w, h, { ...o, p, r: { 'z-': [0, PI, 0], 'z+': [0, 0, 0], 'x-': [0, -PI / 2, 0], 'x+': [0, PI / 2, 0] }[dir] });
}

/** a road wheel, axis along X, lighter than props.js's: for what has six or eight of them */
function roadWheel(b, R, w, { flat = 0, rim = 'steel', rimR = 0.58, seg = 10, hub = true } = {}) {
  const ri = R * rimR, hw = w / 2;
  b.group({ p: [0, -flat * R * 0.5, 0], s: [1, 1 - flat * 0.5, 1] }, () => {
    // (phiStart: a vertex of the tread straight down, so the tyre stands on the ground whatever seg is)
    b.lathe('tire', [[ri, hw * 0.8], [R * 0.9, hw], [R, hw * 0.55], [R, -hw * 0.55], [R * 0.9, -hw], [ri, -hw * 0.8]], seg, { r: [0, 0, PI / 2], phiStart: (1.5 * PI) % ((2 * PI) / seg) });
    b.cyl(rim, ri, ri, w * 0.7, 8, { r: [0, 0, PI / 2] });
    if (hub) b.cyl('rust', ri * 0.36, ri * 0.36, w * 0.8, 6, { r: [0, 0, PI / 2] });
  });
}

/** a filled sack, squashed: sx along, sy high, sz across, round-shouldered (sandbags) */
function bag(b, sx, sy, sz, o = {}) {
  const pos = [], uv = [];
  for (const [k, y] of [[0.62, 0.5], [1, 0.06], [0.74, -0.5]])
    for (const [X, Z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push((X * k * sx) / 2, y * sy, (Z * k * sz) / 2);
      uv.push((X * k * sx) / 2 + y * sy * 0.7, (Z * k * sz) / 2 + y * sy * 0.7);
    }
  const idx = [0, 3, 2, 0, 2, 1, 8, 9, 10, 8, 10, 11];
  for (const ring of [0, 4])
    for (let i = 0; i < 4; i++) {
      const a = ring + i, c = ring + ((i + 1) % 4);
      idx.push(a, c, c + 4, a, c + 4, a + 4);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return b.add('burlap', g, o);
}

/** cloth hung over a grid: P(u, w) -> [x, y, z] for u, w in 0..1, nu by nw panels, smooth */
function drape(b, mat, P, nu, nw, o = {}) {
  const pos = [], uv = [], idx = [];
  const p00 = P(0, 0), d = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
  const lu = d(P(1, 0), p00), lw = d(P(0, 1), p00);
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nw; j++) {
      pos.push(...P(i / nu, j / nw));
      uv.push((i / nu) * lu, (j / nw) * lw);
    }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nw; j++) {
      const a = i * (nw + 1) + j, c = a + nw + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return b.add(mat, g, o);
}

// ------------------------------------------------------------------ street furniture
// A fire hydrant: the barrel and its bonnet, a hose cap each side and the pumper cap to the street, a chain, the
// bolts of its flange. Red or yellow, both a long way gone.
STREET_VARIANTS.fire_hydrant = 2;
STREET_PROPS.fire_hydrant = (b, r, v) => {
  const col = v ? [0.66, 0.54, 0.16] : [0.5, 0.15, 0.11], capc = v ? [0.36, 0.4, 0.36] : mul(col, 0.8);
  const w = worn(0.45, 0.3);
  b.lathe('paint', [[0, 0], [0.135, 0], [0.135, 0.035], [0.085, 0.05], [0.085, 0.57], [0.108, 0.6], [0.07, 0.7], [0, 0.725]], 8, { c: col, cfn: w });
  b.cyl('rust', 0.02, 0.024, 0.05, 4, { p: [0, 0.745, 0] }); // the operating nut
  for (const sx of [-1, 1]) {
    b.cyl('paint', 0.045, 0.045, 0.07, 6, { p: [sx * 0.115, 0.44, 0], r: [0, 0, PI / 2], c: capc, cfn: w });
    b.cyl('rust', 0.026, 0.026, 0.03, 4, { p: [sx * 0.165, 0.44, 0], r: [0, 0, PI / 2] });
  }
  b.cyl('paint', 0.06, 0.06, 0.08, 8, { p: [0, 0.4, -0.12], r: [PI / 2, 0, 0], c: capc, cfn: w });
  b.box('rust', 0.04, 0.04, 0.04, { p: [0, 0.4, -0.175], r: [0, 0, 0.5] });
  b.cylBetween('rust', [0.15, 0.42, 0], [0.09, 0.3, -0.03], 0.004, 0.004, 3); // what is left of a cap's chain
  for (let k = 0; k < 4; k++) {
    const a = (k + 0.5) * (PI / 2);
    b.cyl('rust', 0, 0.014, 0.022, 3, { p: [Math.sin(a) * 0.112, 0.046, Math.cos(a) * 0.112] });
  }
  weeds(b, r, [[0.08, 0.1]], 0.3);
};

// The blue collection box: a round-topped steel box on four legs, the pull-down chute at the front, what is left of
// its lettering, rust coming up from the feet. One of them has been driven into.
STREET_VARIANTS.mail_dropbox = 2;
STREET_PROPS.mail_dropbox = (b, r, v) => {
  const blue = v ? [0.17, 0.23, 0.36] : [0.2, 0.28, 0.44];
  const W = 0.5, hd = 0.24, y0 = 0.13, ys = 0.94; // its width, half its depth, its underside, where the top springs
  const w = worn(0.3, 0.5);
  b.group({ r: [0, 0, v ? 0.025 : 0] }, () => {
    const pts = [[-hd, y0], [hd, y0], [hd, ys]];
    for (let k = 1; k < 6; k++) pts.push([hd * Math.cos((k * PI) / 6), ys + hd * Math.sin((k * PI) / 6)]);
    pts.push([-hd, ys]);
    sideProf(b, 'paint', pts, W, { c: blue, cfn: w });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('paint', 0.05, y0 + 0.01, 0.05, { p: [sx * 0.21, (y0 + 0.01) / 2, sz * 0.2], c: mul(blue, 0.7), cfn: w });
    b.box('paint', W + 0.012, 0.035, hd * 2 + 0.012, { p: [0, y0 + 0.03, 0], c: mul(blue, 0.8), cfn: w }); // the skirt band
    // the chute door lying back on the curve of the top, and its handle
    b.box('paint', 0.42, 0.17, 0.03, { p: [0, 1.0, -0.232], r: [0.3, 0, 0], c: mul(blue, 1.12), cfn: w });
    b.box('steel', 0.22, 0.025, 0.03, { p: [0, 1.055, -0.252], r: [0.3, 0, 0] });
    b.box('paint', 0.3, 0.12, 0.006, { p: [0, 0.74, -hd - 0.002], c: [0.6, 0.6, 0.56] }); // the lettering, gone pale
    b.box('paint', 0.13, 0.09, 0.006, { p: [-0.08, 0.52, -hd - 0.002], c: [0.66, 0.64, 0.56] }); // the hours card
    // the lock door at the back
    b.box('paint', 0.36, 0.5, 0.008, { p: [0, 0.5, hd + 0.003], c: mul(blue, 0.88), cfn: w });
    b.box('steel', 0.035, 0.035, 0.012, { p: [0.13, 0.52, hd + 0.01] });
    b.box('rust', 0.3, 0.09, 0.006, { p: [0.06, y0 + 0.09, -hd - 0.002] });
    b.box('rust', 0.006, 0.14, 0.3, { p: [-W / 2 - 0.002, y0 + 0.12, 0.04] });
    if (v) b.box('paint', 0.03, 0.34, 0.26, { p: [W / 2 - 0.012, 0.62, -0.04], r: [0, 0.14, 0.09], c: mul(blue, 0.74), cfn: w }); // stove in
  });
  weeds(b, r, [[0.02, 0.02]], 0.28);
};

// A park bench: two cast-iron ends, wooden slats along the seat and the back, some of them gone.
STREET_VARIANTS.street_bench = 2;
STREET_PROPS.street_bench = (b, r, v) => {
  // an end, from the side: front foot, the rail under the seat, the back leg running up into the back
  const end = [[-0.3, 0], [-0.24, 0], [-0.2, 0.37], [0.14, 0.37], [0.24, 0], [0.3, 0], [0.21, 0.42], [0.31, 0.87], [0.26, 0.88], [0.15, 0.44], [-0.26, 0.44], [-0.3, 0.4]];
  for (const sx of [-1, 1]) {
    sideProf(b, 'iron', end, 0.05, {}, sx * 0.8);
    b.box('iron', 0.05, 0.03, 0.5, { p: [sx * 0.8, 0.64, -0.03] }); // the armrest and its post
    b.box('iron', 0.04, 0.2, 0.04, { p: [sx * 0.8, 0.54, -0.25] });
  }
  b.box('rust', 0.04, 0.04, 0.42, { p: [0, 0.415, -0.04] });
  const tint = (k) => { const c = WOODS[k % WOODS.length]; return [c[0] * 0.72, c[1] * 0.8, c[2] * 0.7]; };
  const gone = v ? [1, 2] : [2];
  for (let k = 0; k < 4; k++) {
    if (gone.includes(k)) continue;
    plank(b, 'wood', 1.66, 0.03, 0.09, { p: [0, 0.456, -0.22 + k * 0.11], r: [0, 0, rr(r, -0.004, 0.004)], c: tint(k) });
  }
  const lean = Math.atan2(0.11, 0.44);
  for (let k = 0; k < 3; k++) {
    const t = 0.25 + k * 0.3, y = 0.44 + 0.44 * t, z = 0.15 + 0.11 * t - 0.016;
    if (v && k === 2) continue;
    if (k === 1) plank(b, 'wood', 0.78, 0.09, 0.026, { p: [v ? 0.44 : -0.44, y - 0.02, z], r: [lean, 0, v ? 0.04 : -0.05], c: tint(k + 2) }); // snapped off short
    else plank(b, 'wood', 1.66, 0.09, 0.026, { p: [0, y, z], r: [lean, 0, 0], c: tint(k + 2) });
  }
  if (v) plank(b, 'wood', 1.5, 0.03, 0.09, { p: [0.12, 0.016, -0.262], r: [0, 0.01, 0], c: tint(1) }); // a slat, where it dropped
  weeds(b, r, [[-0.5, 0.05], [0.45, -0.05]], 0.34);
};

// A litter bin: a slatted drum on a foot under a domed lid, or an open wire one with its bag; rubbish round both.
STREET_VARIANTS.trash_bin = 2;
STREET_PROPS.trash_bin = (b, r, v) => {
  b.cyl('metal', 0.2, 0.22, 0.07, 6, { p: [0, 0.035, 0] });
  if (!v) {
    const green = [0.2, 0.3, 0.22], w = worn(0.5, 0.4);
    b.cyl('metal', 0.215, 0.215, 0.76, 8, { p: [0, 0.45, 0] });
    for (let k = 0; k < 8; k++) {
      const a = (k + 0.5) * (PI / 4);
      b.box('paint', 0.09, 0.76, 0.018, { p: [Math.sin(a) * 0.243, 0.46, Math.cos(a) * 0.243], r: [0, a, 0], c: green, cfn: w });
    }
    for (const y of [0.14, 0.78]) b.cyl('steel', 0.273, 0.273, 0.03, 8, { p: [0, y, 0] });
    b.lathe('metal', [[0, 0.84], [0.275, 0.84], [0.275, 0.875], [0.15, 0.98], [0, 1.01]], 8);
  } else {
    b.cyl('chainlink', 0.25, 0.25, 0.74, 8, { p: [0, 0.45, 0], open: true });
    for (const y of [0.09, 0.82]) b.cyl('steel', 0.262, 0.262, 0.03, 8, { p: [0, y, 0] });
    for (let k = 0; k < 4; k++) {
      const a = (k + 0.5) * (PI / 2);
      b.box('steel', 0.03, 0.74, 0.012, { p: [Math.sin(a) * 0.236, 0.45, Math.cos(a) * 0.236], r: [0, a, 0] });
    }
    b.cyl('plastic', 0.23, 0.2, 0.62, 8, { p: [0, 0.4, 0] }); // the bag, and what was heaped on it
    b.sphere('plastic', 0.2, 6, 3, { p: [0.02, 0.8, -0.02], s: [1, 0.8, 1] });
  }
  b.sphere('plastic', 0.11, 5, 3, { p: [-0.12, 0.07, -0.2], s: [1, 0.65, 0.8] });
  for (let k = 0; k < 2; k++) {
    const a = rr(r, 0, PI * 2);
    b.box('cloth', 0.16, 0.006, 0.12, { p: [Math.sin(a) * 0.2, 0.006 + k * 0.004, Math.cos(a) * 0.2], r: [0, a, 0], c: pick(r, PAPERS) });
  }
};

// A coin-operated newspaper box on its pedestal: the window smashed, the door hanging down off one hinge.
STREET_VARIANTS.newspaper_box = 2;
STREET_PROPS.newspaper_box = (b, r, v) => {
  const col = v ? [0.2, 0.3, 0.46] : [0.5, 0.16, 0.12];
  const w = worn(0.4, 0.3);
  const zf = -0.18; // its front
  b.box('metal', 0.38, 0.03, 0.34, { p: [0, 0.015, 0.02] });
  b.box('paint', 0.1, 0.44, 0.1, { p: [0, 0.245, 0.02], c: mul(col, 0.8), cfn: w });
  sideProf(b, 'paint', [[zf, 0.46], [0.22, 0.46], [0.22, 1.08], [-0.04, 1.08], [zf, 0.94]], 0.46, { c: col, cfn: w });
  b.box('dark', 0.36, 0.33, 0.012, { p: [0, 0.735, zf - 0.002] }); // the window, and the last papers in it
  b.box('cloth', 0.3, 0.1, 0.008, { p: [0.01, 0.63, zf - 0.008], r: [0, 0, -0.06], c: PAPERS[0] });
  sheet(b, 'glass', [[-0.18, 0.57, zf - 0.014], [-0.03, 0.57, zf - 0.014], [-0.18, 0.74, zf - 0.014]], [0, 0, -1]);
  sheet(b, 'glass', [[0.18, 0.9, zf - 0.014], [0.18, 0.78, zf - 0.014], [0.07, 0.9, zf - 0.014]], [0, 0, -1]);
  b.box('paint', 0.34, 0.07, 0.006, { p: [0, 0.515, zf - 0.002], c: [0.66, 0.64, 0.56] });
  // the door: its frame, swung down and hanging skew
  b.group({ p: [0, 0.56, zf - 0.02], r: [0, 0, 0.08] }, () => {
    for (const sx of [-1, 1]) b.box('paint', 0.03, 0.36, 0.016, { p: [sx * 0.185, -0.18, 0], c: col, cfn: w });
    for (const y of [-0.015, -0.345]) b.box('paint', 0.4, 0.03, 0.016, { p: [0, y, 0], c: col, cfn: w });
  });
  b.box('chrome', 0.2, 0.02, 0.02, { p: [0, 1.02, -0.118], r: [-0.78, 0, 0] });
  b.box('steel', 0.12, 0.06, 0.1, { p: [0.13, 1.11, 0.06] }); // the coin head
  b.box('dark', 0.012, 0.03, 0.006, { p: [0.13, 1.115, 0.008] });
  b.box('rust', 0.006, 0.2, 0.24, { p: [0.232, 0.58, 0.03] });
  weeds(b, r, [[0.05, 0.05]], 0.26);
};

// A phone booth, open to the street: an aluminium frame on a plate, kick panels and glass on three sides (some of
// it out on the floor), the light box round the top, the phone on the back wall with its handset down on the cord.
STREET_VARIANTS.phone_booth = 1;
STREET_PROPS.phone_booth = (b, r) => {
  const q = 0.47; // the walls' centre line
  b.box('metal', 0.98, 0.04, 0.98, { p: [0, 0.02, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('steel', 0.06, 2.02, 0.06, { p: [sx * q, 1.05, sz * q] });
  b.box('paint', 0.99, 0.2, 0.99, { p: [0, 2.14, 0], c: [0.2, 0.3, 0.42], cfn: worn(0.25) }); // the light box
  b.box('plastic', 0.62, 0.12, 0.01, { p: [0, 2.14, -0.494] });
  for (const sx of [-1, 1]) b.box('plastic', 0.01, 0.12, 0.62, { p: [sx * 0.494, 2.14, 0] });
  b.box('metal', 1.0, 0.06, 1.0, { p: [0, 2.27, 0] });
  // the back, then the two sides: a kick panel, a rail, the pane (the right side's is out)
  b.box('steel', 0.88, 0.5, 0.02, { p: [0, 0.3, q] });
  b.box('steel', 0.88, 0.04, 0.04, { p: [0, 0.57, q] });
  pane(b, 'carglass', 0.88, 1.45, [0, 1.315, q], 'z+', { c: paneLook(0.6, 1) });
  for (const sx of [-1, 1]) {
    b.box('steel', 0.02, 0.5, 0.88, { p: [sx * q, 0.3, 0] });
    b.box('steel', 0.04, 0.04, 0.88, { p: [sx * q, 0.57, 0] });
    if (sx < 0) pane(b, 'carglass', 0.88, 1.45, [sx * q, 1.315, 0], 'x-', { c: paneLook(0.6, 2) });
  }
  sheet(b, 'carglass', [[q, 0.59, -0.44], [q, 0.59, -0.1], [q, 0.84, -0.44]], [1, 0, 0], { c: paneLook(0.6, 3) });
  sheet(b, 'carglass', [[q, 2.04, 0.44], [q, 2.04, 0.2], [q, 1.7, 0.44]], [1, 0, 0], { c: paneLook(0.6, 4) });
  for (let k = 0; k < 4; k++) {
    const x = rr(r, 0.05, 0.36), z = rr(r, -0.38, 0.3), s = rr(r, 0.05, 0.1);
    sheet(b, 'glass', [[x - s, 0.044, z], [x + s * 0.6, 0.046, z + s * 0.5], [x, 0.045, z + s]], [0, 1, 0]);
  }
  // the phone on its board, the shelf, the handset at the end of its cord
  b.box('metal', 0.5, 0.9, 0.02, { p: [0, 1.25, q - 0.025] });
  b.box('dark', 0.26, 0.36, 0.1, { p: [0, 1.3, 0.385] });
  b.box('chrome', 0.18, 0.13, 0.012, { p: [0.02, 1.33, 0.331] });
  b.box('steel', 0.07, 0.03, 0.014, { p: [0.05, 1.44, 0.331] });
  b.box('steel', 0.08, 0.05, 0.02, { p: [0.06, 1.17, 0.329] });
  b.box('chrome', 0.03, 0.05, 0.04, { p: [-0.15, 1.4, 0.38] });
  b.tube('rubber', [[-0.15, 1.38, 0.38], [-0.19, 0.95, 0.34], [-0.2, 0.42, 0.3]], 0.006, 4, 3);
  b.group({ p: [-0.2, 0.32, 0.3], r: [0.1, 0, 0.16] }, () => {
    b.box('dark', 0.04, 0.2, 0.04);
    for (const sy of [-1, 1]) b.box('dark', 0.055, 0.05, 0.06, { p: [0, sy * 0.09, -0.012] });
  });
  b.box('steel', 0.5, 0.02, 0.2, { p: [0.1, 0.95, 0.35] });
  b.box('cardboard', 0.2, 0.05, 0.15, { p: [0.18, 0.985, 0.36], r: [0, 0.2, 0] }); // what is left of the directory
  weeds(b, r, [[0.1, -0.15]], 0.4);
};

// A parking meter, one head or two on the pole, leaning a little.
STREET_VARIANTS.parking_meter = 2;
STREET_PROPS.parking_meter = (b, r, v) => {
  const grey = [0.4, 0.42, 0.42], w = worn(0.5);
  b.group({ r: [0.005, 0, v ? 0.006 : 0.018] }, () => {
    b.cyl('metal', 0.024, 0.03, 1.2, 5, { p: [0, 0.6, 0] });
    b.cyl('rust', 0.045, 0.055, 0.04, 4, { p: [0, 0.02, 0] });
    b.box('metal', v ? 0.2 : 0.06, 0.03, 0.05, { p: [0, 1.205, 0] });
    for (const x of v ? [-0.062, 0.062] : [0]) {
      const pts = [[x - 0.05, 1.22], [x + 0.05, 1.22], [x + 0.05, 1.38]];
      for (let k = 1; k < 4; k++) pts.push([x + 0.05 * Math.cos((k * PI) / 4), 1.38 + 0.05 * Math.sin((k * PI) / 4)]);
      pts.push([x - 0.05, 1.38]);
      crossProf(b, 'paint', pts, -0.045, 0.09, { c: grey, cfn: w });
      b.box(v && x > 0 ? 'dark' : 'glass', 0.07, 0.045, 0.008, { p: [x, 1.385, -0.047] });
      b.box('dark', 0.012, 0.035, 0.008, { p: [x + 0.02, 1.29, -0.047] });
    }
  });
};

// A wooden utility pole leaning out over the street (+X) with its crossarm and a transformer can, the three wires
// off the crossarm hanging to the ground and trailing away (-Z). Only the pole stops anybody.
STREET_VARIANTS.pole_leaning = 1;
STREET_PROPS.pole_leaning = (b, r) => {
  const lean = 0.13, L = 8.0, s = Math.sin(lean), c = Math.cos(lean);
  const at = (x, y, z) => [x * c + y * s, -x * s + y * c, z]; // a point of the pole's own frame, in the prop's
  b.group({ r: [0, 0, -lean] }, () => {
    b.cyl('bark_dead', 0.1, 0.15, L, 8, { p: [0, L / 2 + 0.005, 0] });
    b.box('wood', 0.09, 0.11, 1.8, { p: [0.12, 7.5, 0], c: WOODS[4] });
    b.beam('rust', [0.12, 7.45, 0.6], [0.1, 6.9, 0.02], 0.03, 0.008);
    for (const dz of [-0.8, 0.05, 0.8]) b.cyl('bone', 0.03, 0.045, 0.12, 4, { p: [0.12, 7.615, dz] });
    b.cyl('metal', 0.2, 0.2, 0.62, 8, { p: [-0.3, 6.5, 0] }); // the transformer, on its bracket
    b.box('rust', 0.16, 0.3, 0.08, { p: [-0.13, 6.5, 0] });
    b.cyl('bone', 0.025, 0.035, 0.14, 4, { p: [-0.3, 6.88, 0.08] });
  });
  [-0.8, 0.05, 0.8].forEach((dz, k) => {
    const a = at(0.12, 7.66, dz);
    b.tube('wire', [a, [1.13, 3.6 - k * 0.3, dz * 0.8 - 0.1], [1.12, 0.5, dz * 0.6 - 0.25], [1.02 - k * 0.1, 0.02, dz * 0.4 - 0.55], [0.75 - k * 0.2, 0.015, -0.9 + k * 0.06]], 0.012, 6, 3);
  });
  weeds(b, r, [[0.1, 0.25]], 0.5);
};

// Traffic cones, left where the road was closed: some standing, some over on their sides, a barricade lamp.
STREET_VARIANTS.traffic_cones = 2;
STREET_PROPS.traffic_cones = (b, r, v) => {
  const orange = [0.74, 0.3, 0.08], w = worn(0.3, 0, [0.3, 0.26, 0.22]);
  const tilt = PI / 2 + 0.208; // on its side: the edge of its foot and its tip both on the ground
  const cone = (x, z, yaw, down, band) => {
    b.group(down ? { p: [x, 0.182, z], r: [tilt, yaw, 0], order: 'YXZ' } : { p: [x, 0, z], r: [0, yaw, 0] }, () => {
      b.box('rubber', 0.36, 0.03, 0.36, { p: [0, 0.015, 0] });
      b.cyl('paint', 0.03, 0.14, 0.68, 6, { p: [0, 0.37, 0], c: orange, cfn: w });
      if (band) b.cyl('paint', 0.073, 0.096, 0.14, 6, { p: [0, 0.4, 0], c: [0.72, 0.7, 0.64], cfn: w });
    });
  };
  if (!v) {
    cone(-0.62, -0.5, 0.2, false, true);
    cone(0.08, -0.12, 1.1, false, true);
    cone(0.2, 0.22, 0.7, true, true);
    cone(-0.25, 0.62, -2.2, true, true);
  } else {
    cone(-0.7, 0.55, 0.5, false, true);
    cone(0.6, -0.6, 0.1, false, true);
    cone(-0.05, -0.2, 2.4, true, true);
    cone(0.3, 0.3, 0.2, true, false);
    cone(-0.3, -0.72, 0.9, false, false);
  }
  // the lamp off a barricade, on its back
  b.group({ p: v ? [0.7, 0, 0.2] : [0.62, 0, -0.55], r: [0, v ? 0.6 : -0.4, 0] }, () => {
    b.box('paint', 0.16, 0.07, 0.18, { p: [0, 0.035, 0], c: [0.7, 0.56, 0.12], cfn: w });
    b.cyl('paint', 0.085, 0.085, 0.075, 6, { p: [0, 0.04, -0.17], c: [0.7, 0.4, 0.06] });
  });
};

// Broken glass over the ground under a shop window or a car: shards lying flat, a few bits of frame among them.
STREET_VARIANTS.glass_shards = 3;
STREET_PROPS.glass_shards = (b, r, v) => {
  const n = 26 + v * 5;
  for (let k = 0; k < n; k++) {
    const a = r() * PI * 2, d = Math.sqrt(r()) * 1.0, yaw = r() * PI * 2, s = rr(r, 0.05, 0.15);
    const cx = Math.cos(a) * d * (v === 1 ? 0.6 : 1), cz = Math.sin(a) * d;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const shape = k % 3 ? [[-1, -0.4], [0.9, -0.25], [0.1, 0.7]] : [[-0.8, -0.5], [0.7, -0.6], [1, 0.3], [-0.3, 0.6]];
    sheet(b, 'glass', shape.map(([x, z]) => [cx + (x * cs - z * sn) * s, rr(r, 0.005, 0.018), cz + (x * sn + z * cs) * s]), [0, 1, 0]);
  }
  for (let k = 0; k < 3 + (v === 2 ? 1 : 0); k++) b.box('metal', rr(r, 0.25, 0.55), 0.018, 0.025, { p: [rr(r, -0.7, 0.7), 0.011, rr(r, -0.7, 0.7)], r: [0, r() * PI, 0] });
};

// A bicycle on its side where it was dropped, lying on a handlebar end and a pedal; one with the front wheel gone.
STREET_VARIANTS.bicycle = 2;
STREET_PROPS.bicycle = (b, r, v) => {
  const col = v ? [0.2, 0.32, 0.3] : [0.46, 0.16, 0.12], w = worn(0.6);
  const al = 0.267; // how far its plane is off the ground: a bar end down, the top of the wheels up
  const tb = (a, c, rad = 0.013) => b.cylBetween('paint', a, c, rad, rad, 3, { c: col, cfn: w });
  // (built upright: x along it, y up, z across; then laid over on its +z side)
  b.group({ p: [-0.01, 0.02, -0.438], r: [PI / 2 - al, 0, 0] }, () => {
    const A = [-0.5, 0.33, 0], F = [0.52, 0.33, 0], BB = [-0.08, 0.28, 0], ST = [-0.2, 0.72, 0], HT = [0.36, 0.78, 0], HB = [0.39, 0.62, 0];
    for (const X of v ? [A] : [A, F]) {
      b.torus(v ? 'rust' : 'tire', 0.31, v ? 0.012 : 0.02, 4, 10, PI * 2, { p: X });
      for (const a of [0.4, 1.97]) b.box('steel', 0.006, 0.6, 0.004, { p: X, r: [0, 0, a] });
      b.cyl('steel', 0.02, 0.02, 0.1, 5, { p: X, r: [PI / 2, 0, 0] });
    }
    tb(ST, HT);
    tb(BB, HB, 0.016);
    tb(BB, [-0.215, 0.78, 0], 0.014);
    tb(HB, [0.35, 0.84, 0], 0.015);
    for (const sz of [-1, 1]) {
      tb([BB[0], BB[1], sz * 0.03], [A[0], A[1], sz * 0.05], 0.009);
      tb([ST[0], ST[1], sz * 0.02], [A[0], A[1], sz * 0.05], 0.008);
      tb([HB[0], HB[1], sz * 0.03], [F[0], F[1], sz * 0.05], 0.01);
    }
    b.cylBetween('steel', [0.34, 0.84, -0.23], [0.34, 0.84, 0.23], 0.011, 0.011, 4);
    b.box('rubber', 0.24, 0.04, 0.13, { p: [-0.23, 0.8, 0] });
    b.cyl('steel', 0.09, 0.09, 0.006, 8, { p: [BB[0], BB[1], -0.05], r: [PI / 2, 0, 0] });
    b.box('steel', 0.02, 0.17, 0.012, { p: [BB[0], BB[1] + 0.085, 0.07] }); // cranks: the one underneath stands up
    b.box('steel', 0.02, 0.17, 0.012, { p: [BB[0], BB[1] - 0.085, -0.07] });
    b.box('rubber', 0.09, 0.02, 0.07, { p: [BB[0], BB[1] + 0.17, 0.11] });
    b.box('rubber', 0.09, 0.02, 0.07, { p: [BB[0], BB[1] - 0.17, -0.11] });
  });
};

// A pram, standing where it was left: the tub on its sprung frame, the hood torn back to a bare bow, a blanket
// half out of it.
STREET_VARIANTS.stroller = 1;
STREET_PROPS.stroller = (b, r) => {
  const navy = [0.16, 0.18, 0.24];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl('rubber', 0.13, 0.13, 0.03, 8, { p: [sx * 0.25, 0.13, sz * 0.3], r: [0, sx > 0 && sz < 0 ? 0.18 : 0, PI / 2], order: 'YXZ' });
      b.cyl('steel', 0.09, 0.09, 0.036, 5, { p: [sx * 0.25, 0.13, sz * 0.3], r: [0, 0, PI / 2] });
    }
    b.cylBetween('steel', [sx * 0.2, 0.13, -0.3], [sx * 0.2, 0.42, 0.25], 0.01, 0.01, 3);
    b.cylBetween('steel', [sx * 0.2, 0.13, 0.3], [sx * 0.2, 0.42, -0.25], 0.01, 0.01, 3);
    b.cylBetween('steel', [sx * 0.2, 0.42, 0.28], [sx * 0.2, 1.0, 0.46], 0.01, 0.01, 3); // the handle
  }
  for (const z of [-0.3, 0.3]) b.cylBetween('steel', [-0.25, 0.13, z], [0.25, 0.13, z], 0.008, 0.008, 3);
  b.cylBetween('rubber', [-0.2, 1.0, 0.46], [0.2, 1.0, 0.46], 0.013, 0.013, 3);
  sideProf(b, 'cloth', [[-0.38, 0.52], [-0.33, 0.4], [0.3, 0.4], [0.36, 0.52], [0.36, 0.68], [-0.38, 0.66]], 0.42, { c: navy, cfn: worn(0.3, 0, [0.3, 0.28, 0.24]) });
  b.box('dark', 0.36, 0.01, 0.68, { p: [0, 0.673, -0.01], r: [-0.027, 0, 0] });
  // the hood: a fan of bows about the pivots; the back of it still covered, the front bow bare
  const py = 0.66, pz = 0.12, R = 0.27;
  const bow = (u, th) => [-0.215 * Math.cos(u * PI), py + R * Math.sin(u * PI) * Math.sin(th), pz + R * Math.sin(u * PI) * Math.cos(th)];
  drape(b, 'cloth', (u, t) => bow(u, 0.1 + t * 1.3), 3, 2, { c: navy });
  for (let k = 0; k < 3; k++) b.cylBetween('steel', bow(k / 3, 2.2), bow((k + 1) / 3, 2.2), 0.006, 0.006, 3);
  sheet(b, 'cloth', [bow(0.5, 1.4), bow(0.75, 1.4), [0.02, py + 0.08, pz - 0.2]], [0, 1, 0], { c: navy });
  sheet(b, 'cloth', [[-0.2, 0.675, -0.3], [0.1, 0.675, -0.2], [0.24, 0.5, -0.22], [0.26, 0.3, -0.33]], [0, 1, -1], { c: [0.52, 0.46, 0.42] }); // the blanket
};

// What is left of somebody, years on: bones in rags. On its back; sat slumped against what is behind it (+Z); face
// down with an arm out ahead (-Z).
// (built standing in the body's own frame - the pelvis at the origin, +Y to the head, facing -Z - then laid down)
function skeleton(b, P) {
  const bone = (a, c, ra, rc) => b.cylBetween('bone', a, c, rc, ra, 4);
  for (const sx of [-1, 1]) b.sphere('bone', 0.07, 5, 3, { p: [sx * 0.065, 0.005, 0.015], s: [1, 1, 0.45], r: [0, sx * -0.45, 0] });
  b.box('bone', 0.06, 0.1, 0.035, { p: [0, 0, 0.05] });
  bone([0, 0.02, 0.06], [0, 0.5, 0.055], 0.02, 0.016);
  bone([0, 0.5, 0.055], P.head, 0.014, 0.014);
  [0.115, 0.135, 0.135, 0.11].forEach((rad, k) => b.group({ p: [0, 0.2 + k * 0.075, -0.005], s: [1, 1, 0.7] }, () => b.torus('bone', rad, 0.009, 3, 7, PI * 2, { r: [PI / 2, 0, 0] })));
  b.box('bone', 0.035, 0.19, 0.014, { p: [0, 0.33, -0.094] });
  b.box('bone', 0.32, 0.014, 0.014, { p: [0, 0.47, -0.02] });
  b.group({ p: P.head, r: P.headR }, () => {
    b.sphere('bone', 0.09, 6, 4, { s: [0.86, 1, 1.05] });
    b.box('bone', 0.085, 0.035, 0.07, { p: [0, -0.085, -0.04] });
    for (const sx of [-1, 1]) b.box('dark', 0.026, 0.022, 0.016, { p: [sx * 0.03, 0.005, -0.086] });
  });
  for (const [sh, el, wr, hand] of P.arms) {
    bone(sh, el, 0.016, 0.012);
    bone(el, wr, 0.012, 0.009);
    bone(wr, hand, 0.018, 0.008);
  }
  for (const [hip, knee, ankle, toe] of P.legs) {
    bone(hip, knee, 0.021, 0.017);
    bone(knee, ankle, 0.017, 0.012);
    bone(ankle, toe, 0.022, 0.012);
    b.cylBetween('cloth', hip, knee, 0.05, 0.06, 5, { open: true, c: P.cloth }); // a trouser leg
  }
}
STREET_VARIANTS.skeleton = 3;
STREET_PROPS.skeleton = (b, r, v) => {
  const cloth = [[0.2, 0.22, 0.26], [0.26, 0.2, 0.16], [0.2, 0.24, 0.2]][v], shirt = [[0.36, 0.34, 0.3], [0.3, 0.3, 0.34], [0.34, 0.26, 0.22]][v];
  if (v === 0) {
    // on its back, the head to +Z: the ground is the body's z = +0.1
    b.group({ p: [0, 0.1, 0.125], r: [PI / 2, 0, 0] }, () => {
      skeleton(b, {
        cloth, head: [0, 0.615, 0.01], headR: [0.1, 0.5, 0],
        arms: [[[-0.17, 0.46, 0.03], [-0.27, 0.2, 0.08], [-0.22, -0.04, 0.085], [-0.2, -0.13, 0.085]], [[0.17, 0.46, 0.03], [0.31, 0.22, 0.08], [0.28, -0.03, 0.085], [0.3, -0.12, 0.085]]],
        legs: [[[-0.085, -0.03, 0.03], [-0.12, -0.46, 0.045], [-0.14, -0.87, 0.085], [-0.2, -0.93, 0.03]], [[0.085, -0.03, 0.03], [0.13, -0.45, 0.045], [0.11, -0.86, 0.085], [0.17, -0.94, 0.04]]],
      });
      b.box('cloth', 0.42, 0.56, 0.008, { p: [0.01, 0.22, 0.094], r: [0, 0, 0.06], c: shirt });
      sheet(b, 'cloth', [[-0.13, 0.45, -0.06], [0.03, 0.47, -0.105], [0.0, 0.24, -0.108], [-0.13, 0.2, -0.07]], [0, 0, -1], { c: shirt });
    });
  } else if (v === 1) {
    // sat against what is behind it, the legs out in front
    b.group({ p: [0, 0.09, 0.16] }, () => {
      skeleton(b, {
        cloth, head: [0.03, 0.6, -0.05], headR: [-0.5, 0.15, 0.25],
        arms: [[[-0.17, 0.46, 0.02], [-0.22, 0.17, 0.04], [-0.24, -0.06, -0.06], [-0.25, -0.075, -0.15]], [[0.17, 0.46, 0.02], [0.21, 0.18, 0.0], [0.14, -0.02, -0.16], [0.08, -0.04, -0.24]]],
        legs: [[[-0.085, -0.03, -0.02], [-0.13, -0.05, -0.45], [-0.17, -0.07, -0.86], [-0.25, -0.03, -0.9]], [[0.085, -0.03, -0.02], [0.12, 0.0, -0.44], [0.14, -0.07, -0.85], [0.14, 0.03, -0.9]]],
      });
      b.box('cloth', 0.42, 0.008, 0.44, { p: [0, -0.084, -0.12], r: [0, 0.1, 0], c: shirt });
      sheet(b, 'cloth', [[-0.14, 0.46, 0.0], [-0.02, 0.47, -0.1], [-0.04, 0.2, -0.108], [-0.14, 0.14, -0.04]], [-1, 0, -1], { c: shirt });
      sheet(b, 'cloth', [[0.14, 0.44, 0.04], [0.14, 0.2, 0.07], [0.0, 0.16, 0.095], [0.02, 0.4, 0.096]], [0, 0, 1], { c: shirt });
    });
  } else {
    // face down, the head to -Z, the right arm out ahead: the ground is the body's z = -0.1
    b.group({ p: [0, 0.1, 0.014], r: [-PI / 2, 0, 0] }, () => {
      skeleton(b, {
        cloth, head: [0.02, 0.61, -0.005], headR: [0, 1.0, 0],
        arms: [[[-0.17, 0.46, -0.02], [-0.3, 0.3, -0.08], [-0.26, 0.52, -0.085], [-0.22, 0.6, -0.085]], [[0.17, 0.46, -0.02], [0.3, 0.66, -0.08], [0.22, 0.85, -0.085], [0.19, 0.92, -0.085]]],
        legs: [[[-0.085, -0.03, -0.03], [-0.2, -0.42, -0.045], [-0.12, -0.8, -0.085], [-0.13, -0.9, -0.07]], [[0.085, -0.03, -0.03], [0.12, -0.45, -0.045], [0.2, -0.84, -0.085], [0.24, -0.9, -0.07]]],
      });
      b.box('cloth', 0.44, 0.5, 0.008, { p: [-0.01, 0.2, -0.094], r: [0, 0, -0.08], c: shirt });
      sheet(b, 'cloth', [[-0.14, 0.46, 0.05], [0.12, 0.47, 0.075], [0.13, 0.22, 0.1], [-0.1, 0.16, 0.085]], [0, 0, 1], { c: shirt });
    });
  }
};

// ------------------------------------------------------------------ the traffic that never left
// A sedan somebody got out of and ran: doors standing open, down on its tyres. A civilian car with bags roped to the
// roof; a taxi; a police car; a civilian car with the boot up and its cases out on the road behind.
// (eight: the four kinds (v % 4), and what is in the cabin by the rest of v)
STREET_VARIANTS.car_open = 8;
STREET_PROPS.car_open = (b, r, v0) => {
  const v = v0 % 4, w = v0 >> 2;
  const taxi = v === 1, police = v === 2, boot = v === 3;
  const white = [0.72, 0.72, 0.68];
  const col = taxi ? [0.7, 0.54, 0.12] : police ? [0.09, 0.09, 0.1] : mul(CAR_COLORS[boot ? 4 : 0], 0.85);
  const hw = 0.9, sink = 0.13;
  // the doors left open: [side, front 0 | rear 1, how far]
  const doors = taxi ? [[-1, 0, 0.7], [1, 1, 0.95]] : police ? [[-1, 0, 0.72], [1, 0, 0.55]] : boot ? [[-1, 0, 0.45], [-1, 1, 0.9]] : [[-1, 0, 0.72], [1, 0, 0.66]];
  const glass = boot ? ['ok', 'gone', 'ok', 'ok', 'ok', 'ok'] : taxi ? ['gone', 'ok', 'ok', 'ok', 'ok', 'gone'] : ['ok', 'ok', 'ok', 'gone', 'ok', 'ok'];
  for (const [sx, k] of doors) glass[2 + (sx > 0 ? 0 : 2) + k] = 'gone';
  // what is in it: cases and a child's seat, or the driver; the fare, dead in the taxi's front seat; the police car's
  // cage; the car with its boot up stripped
  const cabin = [[2, 1], [0, 3], [5, 5], [2, 4]][v][w];
  if (cabin === 3) glass[2] = 'blood';
  const wheels = [{ fl: 'flat', fr: 'flat', rl: 'flat', rr: 'rim' }, { fl: 'rim', fr: 'flat', rl: 'flat', rr: 'flat' }, { fl: 'flat', fr: 'flat', rl: 'flat', rr: 'flat' }, { fl: 'flat', fr: 'rim', rl: 'rim', rr: 'flat' }][v];
  b.push([0, 0, police ? 0.03 : 0], [0, 0, 0], [0.975, 1, 0.92]); // (inside its collider, mirrors and bumpers too)
  sedan(b, r, { color: col, sink, smashed: !police, noPlates: v === 0, wheels, glass, cabin, bootOpen: boot, bodySide: 1, seats: v * 2 + w, dirt: [0.35, 0.6, 0.3, 0.5][v] + w * 0.15, doorsOff: doors.map((d) => [d[0], d[1]]) });
  b.push([0, -sink, 0]);
  if (police) {
    // the cage between the front seats and the back, and the gun that stood in its clip
    for (let k = 0; k < 7; k++) b.box('cabin_fine', 0.014, 0.46, 0.014, { p: [-0.63 + k * 0.21, 1.14, 0.26], c: [0.1, 0.1, 0.1] });
    for (const y of [0.92, 1.36]) b.box('cabin_fine', 1.4, 0.02, 0.02, { p: [0, y, 0.26], c: [0.1, 0.1, 0.1] });
    if (!w) b.box('cabin_fine', 0.03, 0.62, 0.035, { p: [0.04, 0.82, -0.3], r: [0.2, 0, 0.06], c: [0.09, 0.09, 0.1] });
    else sitter(b, [0.34, 0.46, 0.64], { lean: 0.7, side: 1, shirt: [0.5, 0.3, 0.12], legs: [0.5, 0.3, 0.12] }); // somebody they had picked up, still in the back
  }
  if (taxi) b.box('cabin_fine', 0.12, 0.08, 0.06, { p: [0.1, 0.99, -0.6], c: [0.1, 0.1, 0.1] }); // the meter
  for (const [sx, k, ang] of doors) {
    const hinge = k ? 0.47 : -0.85, L = k ? 0.74 : 1.3, top = k ? 0.42 : L, dc = police ? white : col;
    if (k) b.box('dark', 0.012, 0.56, 0.3, { p: [sx * (hw + 0.002), 0.62, 1.06] }); // (the back door's shut line runs on over the arch)
    b.group({ p: [sx * hw, 0.6, hinge], r: [0, sx * ang, 0] }, () => {
      b.box('carpaint', 0.05, 0.6, L, { p: [sx * 0.02, 0, L / 2], c: dc });
      b.box('dark', 0.02, 0.5, L - 0.12, { p: [-sx * 0.012, -0.02, L / 2] });
      b.box('dark', 0.05, 0.05, 0.3, { p: [-sx * 0.04, 0.04, L * 0.55] }); // the armrest
      // the window frame: up the pillar, along the top, down again
      const f0 = [0, 0.3, 0.02], f1 = [-sx * 0.13, 0.8, k ? 0.02 : 0.72], f2 = [-sx * 0.13, 0.8, top], f3 = [0, 0.3, L - 0.02];
      b.beam('carpaint', f0, f1, 0.035, 0.035, { c: dc });
      b.beam('carpaint', f1, f2, 0.035, 0.035, { c: dc });
      b.beam('carpaint', f2, f3, 0.035, 0.035, { c: dc });
    });
  }
  if (v === 0) {
    // what would not go in the boot, roped to the roof
    b.box('cloth', 0.95, 0.09, 0.52, { p: [-0.05, 1.51, 0.32], r: [0, 0.06, 0], c: [0.3, 0.32, 0.26] });
    b.box('cloth', 0.52, 0.075, 0.36, { p: [0.18, 1.5, 0.76], r: [0, -0.12, 0], c: [0.36, 0.26, 0.2] });
    for (const z of [0.2, 0.74]) b.box('dark', 1.5, 0.012, 0.03, { p: [0, 1.56 - (z > 0.5 ? 0.014 : 0), z] });
  }
  if (taxi) {
    b.box('dark', 0.46, 0.02, 0.18, { p: [0, 1.475, 0.35] });
    b.box('paint', 0.42, 0.085, 0.14, { p: [0, 1.527, 0.35], c: [0.78, 0.7, 0.34] });
    for (const sx of [-1, 1]) for (let k = 0; k < 10; k++) b.box('dark', 0.008, 0.05, 0.1, { p: [sx * (hw + 0.003), 0.74 + (k % 2) * 0.05, -1.8 + k * 0.4] });
  }
  if (police) {
    for (const sx of [-1, 1])
      for (const [za, zb, k] of [[-0.84, 0.44, 0], [0.48, 1.2, 1]]) {
        if (doors.some((d) => d[0] === sx && d[1] === k)) continue;
        b.box('carpaint', 0.008, 0.56, zb - za, { p: [sx * (hw + 0.002), 0.6, (za + zb) / 2], c: white });
      }
    b.box('carpaint', 1.48, 0.012, 1.16, { p: [0, 1.471, 0.41], c: white });
    b.box('dark', 1.1, 0.02, 0.16, { p: [0, 1.487, 0.2] }); // the light bar
    b.box('taillight', 0.44, 0.06, 0.14, { p: [-0.3, 1.527, 0.2] });
    b.box('paint', 0.44, 0.06, 0.14, { p: [0.3, 1.527, 0.2], c: [0.1, 0.15, 0.42] });
    b.box('chrome', 0.14, 0.055, 0.12, { p: [0, 1.524, 0.2] });
    for (const sx of [-1, 1]) b.box('dark', 0.06, 0.5, 0.05, { p: [sx * 0.4, 0.56, -2.44] }); // the push bumper
    for (const y of [0.42, 0.74]) b.box('dark', 1.0, 0.05, 0.04, { p: [0, y, -2.45] });
  }
  if (boot) {
    b.group({ p: [0, 0.93, 1.27], r: [-0.68, 0, 0] }, () => b.box('carpaint', 1.56, 0.04, 0.95, { p: [0, 0, 0.475], c: col }));
    b.box('plastic', 0.5, 0.3, 0.2, { p: [0.3, 0.9, 1.75], r: [0.3, 0.2, 0] }); // a case still in it
  }
  b.pop();
  b.pop();
  if (boot) {
    b.box('plastic', 0.52, 0.2, 0.36, { p: [-0.35, 0.1, 2.56], r: [0, 0.4, 0] });
    b.box('cloth', 0.56, 0.18, 0.38, { p: [0.4, 0.09, 2.52], r: [0, -0.3, 0], c: [0.4, 0.2, 0.16] });
    b.box('cloth', 0.56, 0.02, 0.38, { p: [0.45, 0.2, 2.34], r: [-1.1, -0.3, 0], order: 'YXZ', c: [0.4, 0.2, 0.16] }); // its lid, thrown back
    for (let k = 0; k < 3; k++) b.box('cloth', rr(r, 0.2, 0.3), 0.016, rr(r, 0.16, 0.24), { p: [rr(r, -0.1, 0.5), 0.01 + k * 0.004, rr(r, 2.45, 2.7)], r: [0, r() * PI, 0], c: pick(r, PAPERS) });
  }
  weeds(b, r, [[0.5, -1.7], [-0.5, 1.3], [0.45, 1.85], [-0.4, -0.5]], 0.5);
};

// A transit bus, stopped for good: a flat front and a deep windscreen, two double doors folded open on the kerb
// side (+X) with their step wells, most of its windows out, a stripe down it, an engine grille across the back.
STREET_VARIANTS.city_bus = 2;
STREET_PROPS.city_bus = (b, r, v) => {
  const base = v ? [0.58, 0.62, 0.56] : [0.7, 0.68, 0.6], stripe = v ? [0.52, 0.2, 0.1] : [0.16, 0.3, 0.44], trim = [0.24, 0.25, 0.26], yel = [0.62, 0.5, 0.1];
  const W = 2.5, hw = W / 2, z0 = -5.9, z1 = 5.9, yb = 0.38, yw = 1.43, yt = 2.43, sink = 0.12; // skirt, sill, window head
  const fa = -3.4, ra = 3.3, wr = 0.5, ym = (yw + yt) / 2;
  const w = worn(0.22, 0.9);
  const look = (k) => paneLook(v ? 0.72 : 0.5, k), FLOORC = [0.11, 0.11, 0.11];
  let np = 0;
  b.push([0, -sink, 0]);
  // the body in lengths along it: plain ones, the two over the axles (with their arches), the two with a door well
  for (const [za, zb, what] of [[z0, -5.45], [-5.45, -4.25, 'door'], [-4.25, 0.3, fa], [0.3, 1.5, 'door'], [1.5, z1, ra]]) {
    const L = zb - za, zc = (za + zb) / 2;
    if (what === 'door') {
      b.box('carpaint', W - 0.5, yw - yb, L, { p: [-0.25, (yb + yw) / 2, zc], c: base, cfn: w });
      deck(b, -0.25, yw + 0.012, zc, W - 0.56, L, FLOORC);
      b.box('dark', 0.01, yw - yb - 0.22, L, { p: [hw - 0.495, (yb + 0.22 + yw) / 2, zc] });
      b.box('metal', 0.5, 0.22, L, { p: [hw - 0.25, yb + 0.11, zc] }); // the step, its edge, the pole
      b.box('paint', 0.03, 0.026, L, { p: [hw - 0.015, yb + 0.222, zc], c: yel });
      b.cyl('paint', 0.02, 0.02, yt - yb - 0.22, 5, { p: [hw - 0.3, (yb + 0.22 + yt) / 2, zc + 0.02], c: yel });
      for (const z of [za + 0.03, zb - 0.03]) {
        // a leaf, folded back: its light still in it, or not
        const lit = r() < 0.6;
        b.group({ p: [hw - 0.25, (yb + 0.24 + yt) / 2, z] }, () => leaf(b, 'carpaint', 0.46, yt - yb - 0.26, 0.04, [-0.17, 0.17, 1.33 - (yb + 0.24 + yt) / 2, 2.23 - (yb + 0.24 + yt) / 2], { c: trim, pane: lit ? undefined : 'gone', look: look(np++) }));
      }
      continue;
    }
    if (what) {
      sideProf(b, 'carpaint', [[za, yb], ...arch(what, yb, 0.66, 8), [zb, yb], [zb, yw], [za, yw]], W, { c: base, cfn: w });
      b.box('dark', W - 0.04, 0.64, 1.3, { p: [0, yb + 0.32, what] });
    } else b.box('carpaint', W, yw - yb, L, { p: [0, (yb + yw) / 2, zc], c: base, cfn: w });
    deck(b, 0, yw + 0.012, zc, W - 0.06, L, FLOORC);
  }
  // (the window band is open from side to side: the floor above, a ceiling, and what is in between) seats in pairs
  // each side of the aisle, none where a door's well is; the driver's, the wheel, the fare box; rails overhead
  b.box('cabin', W - 0.1, 0.012, z1 - z0 - 0.1, { p: [0, yt - 0.008, 0], c: LINING });
  const blue = v ? [0.34, 0.2, 0.14] : [0.16, 0.24, 0.34];
  const well = (z) => (z > -5.6 && z < -4.0) || (z > 0.1 && z < 1.75);
  busRows(b, [-0.8, 0.8], yw + 0.012, -3.9, 0.82, 11, 0.82, { c: blue, bh: 0.48, skip: (k, x) => (x > 0 && well(-3.9 + k * 0.82)) || (k * 5 + (x > 0 ? 2 : 0)) % 13 === 4 });
  seat(b, -0.78, yw + 0.012, -5.2, { w: 0.5, h: 0.14, bh: 0.5, d: 0.42, c: blue, heads: 0 });
  b.box('cabin_fine', 1.3, 0.24, 0.26, { p: [-0.55, yw + 0.13, -5.7], c: [0.1, 0.1, 0.1] });
  steering(b, [-0.78, yw + 0.44, -5.52], { R: 0.23, tilt: 1.0 });
  b.box('cabin_fine', 0.2, 0.5, 0.2, { p: [0.2, yw + 0.26, -5.35], c: [0.3, 0.3, 0.3] });
  for (const sx of [-1, 1]) b.box('cabin_fine', 0.025, 0.025, 8.6, { p: [sx * 0.42, yt - 0.14, -0.2], c: [0.52, 0.44, 0.14] });
  for (const z of [-3.2, -1.2, 2.6, 4.4]) b.cylBetween('cabin_fine', [-0.42, yw + 0.02, z], [-0.42, yt - 0.14, z], 0.016, 0.016, 4, { c: [0.52, 0.44, 0.14] });
  if (v) {
    sitter(b, [-0.78, yw + 0.15, -5.2], { wheel: true, lean: 0.25, side: -1, flesh: true, shirt: [0.2, 0.24, 0.3] });
    bloodPatch(b, [-0.6, yw + 0.02, -4.6], 0.5, 0.9, 0.3);
    luggage(b, [0.8, yw + 0.12, 2.66], 2, { r: 1.5 });
  } else {
    sitter(b, [-0.76, yw + 0.115, 1.02], { lean: 0.8, side: -1, shirt: [0.36, 0.3, 0.24] });
    sitter(b, [0.6, yw + 0.115, 3.48], { lean: 0.5, side: 1, shirt: [0.24, 0.3, 0.26], legs: [0.3, 0.26, 0.2] });
    luggage(b, [-0.8, yw + 0.12, -2.26], 0, { r: 1.6 });
    rubbish(b, [0, yw + 0.014, 0.5], 0.4, 7, 9, 3);
  }
  crossProf(b, 'carpaint', [[-hw, yt], [hw, yt], [hw, 2.72], [hw - 0.09, 2.92], [hw - 0.35, 2.99], [-hw + 0.35, 2.99], [-hw + 0.09, 2.92], [-hw, 2.72]], z0, z1 - z0, { c: mul(base, 0.96), cfn: worn(0.15) });
  // a side: the solid lengths of the window band, then bay by bay a pillar each end, the sash bar, what glass is left
  const side = (sx, bays, solids) => {
    const x = sx * (hw - 0.02), gx = sx * (hw - 0.012), dir = sx < 0 ? 'x-' : 'x+', seen = new Set();
    for (const [za, zb] of solids) b.box('carpaint', 0.04, yt - yw, zb - za, { p: [x, ym, (za + zb) / 2], c: base, cfn: w });
    for (const [za, zb] of bays) {
      for (const z of [za, zb]) {
        if (seen.has(z)) continue;
        seen.add(z);
        b.box('carpaint', 0.04, yt - yw, 0.1, { p: [x, ym, z], c: trim });
      }
      const L = zb - za - 0.1, zc = (za + zb) / 2;
      b.box('steel', 0.02, 0.03, L, { p: [gx, yw + 0.645, zc] });
      const q = r();
      if (q < 0.3) pane(b, 'carglass', L, 0.58, [gx, yw + 0.33, zc], dir, { c: look(np++) });
      else if (q < 0.65) sheet(b, 'carglass', [[gx, yw + 0.04, zc - L / 2], [gx, yw + 0.04, zc - L / 2 + rr(r, 0.25, 0.6)], [gx, yw + rr(r, 0.2, 0.5), zc - L / 2]], [sx, 0, 0], { c: look(np++) });
      if (r() < 0.5) pane(b, 'carglass', L, 0.3, [gx, yw + 0.82, zc], dir, { c: look(np++) });
    }
    b.box('carpaint', 0.1, yt - yw, 0.1, { p: [sx * (hw - 0.05), ym, z0 + 0.05], c: base });
  };
  side(-1, [[-5.8, -4.45], [-4.25, -2.95], [-2.95, -1.65], [-1.65, -0.35], [-0.35, 0.95], [0.95, 2.25], [2.25, 3.55]], [[-4.45, -4.25], [3.55, z1]]);
  side(1, [[-4.25, -2.95], [-2.95, -1.65], [-1.65, -0.35], [1.5, 2.525], [2.525, 3.55]], [[-5.8, -5.45], [-0.35, 0.3], [3.55, z1]]);
  // the livery: a stripe under the windows (broken at the doors), a dark line over it, rust along the skirt
  for (const [sx, runs] of [[-1, [[z0 + 0.05, z1 - 0.3]]], [1, [[z0 + 0.05, -5.5], [-4.2, 0.25], [1.55, z1 - 0.3]]]]) {
    for (const [za, zb] of runs) {
      b.box('carpaint', 0.01, 0.26, zb - za, { p: [sx * (hw + 0.003), 1.22, (za + zb) / 2], c: stripe, cfn: worn(0.3, 0, base) });
      b.box('dark', 0.012, 0.03, zb - za, { p: [sx * (hw + 0.004), 1.4, (za + zb) / 2] });
    }
    for (const z of sx < 0 ? [-1.6, 0.7, 5.0] : [-2.0, 2.06, 5.0]) b.box('rust', 0.008, rr(r, 0.12, 0.3), rr(r, 0.4, 0.8), { p: [sx * (hw + 0.002), yb + 0.16, z] });
  }
  b.box('dark', 0.01, 0.5, 1.3, { p: [-hw - 0.003, 0.95, 4.75] }); // the engine's louvres
  for (let k = 0; k < 4; k++) b.box('steel', 0.014, 0.03, 1.3, { p: [-hw - 0.006, 0.78 + k * 0.12, 4.75] });
  // the front: the windscreen in two panes (one out), its pillar and wipers, the destination box, lamps, bumper
  b.box('dark', 2.3, 0.22, 0.02, { p: [0, 1.33, z0 - 0.006] });
  pane(b, 'carglass', 1.1, 1.17, [-0.58, 1.845, z0 - 0.02], 'z-', { c: v ? [0.6, 0.2, 0.85] : look(40) });
  if (v) pane(b, 'carglass', 1.1, 1.17, [0.58, 1.845, z0 - 0.02], 'z-', { c: look(41) });
  else sheet(b, 'carglass', [[0.04, 1.26, z0 - 0.02], [0.7, 1.26, z0 - 0.02], [0.04, 1.9, z0 - 0.02]], [0, 0, -1], { c: look(41) });
  b.box('carpaint', 0.07, 1.22, 0.05, { p: [0, 1.83, z0], c: trim });
  b.box('dark', 1.5, 0.24, 0.02, { p: [0, 2.6, z0 - 0.008] });
  b.box('paint', 1.3, 0.14, 0.01, { p: [0, 2.6, z0 - 0.02], c: [0.42, 0.36, 0.14] });
  for (const sx of [-1, 1]) {
    b.cylBetween('dark', [sx * 0.3, 1.27, z0 - 0.03], [sx * 0.78, 1.72, z0 - 0.03], 0.008, 0.008, 3);
    b.box('chrome', 0.34, 0.16, 0.03, { p: [sx * 0.9, 0.86, z0 - 0.01] });
    b.box(sx < 0 ? 'dark' : 'glass', 0.3, 0.12, 0.02, { p: [sx * 0.9, 0.86, z0 - 0.026] });
    b.box('paint', 0.1, 0.08, 0.02, { p: [sx * 1.14, 0.86, z0 - 0.008], c: [0.66, 0.4, 0.08] });
    // a mirror on its arm, down from the corner of the roof
    b.cylBetween('dark', [sx * (hw - 0.02), 2.3, z0 + 0.1], [sx * (hw + 0.025), 2.0, z0 + 0.06], 0.012, 0.012, 3);
    b.box('dark', 0.03, 0.34, 0.16, { p: [sx * (hw + 0.028), 1.86, z0 + 0.06] });
  }
  b.box('dark', 2.52, 0.24, 0.14, { p: [0, 0.5, z0 + 0.04] });
  label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.5, z0 - 0.032], 'z-');
  // the back: closed in but for a small window, the engine door and its grille, lamps, bumper
  b.group({ p: [0, ym, z1 - 0.025] }, () => leaf(b, 'carpaint', W, yt - yw, 0.05, [-0.67, 0.67, 2.05 - ym - 0.22, 2.05 - ym + 0.22], { c: base, cfn: w, pane: v ? 'gone' : undefined, look: look(42) }));
  b.box('dark', 1.6, 0.6, 0.02, { p: [0, 0.95, z1 + 0.004] });
  for (let k = 0; k < 5; k++) b.box('steel', 1.6, 0.03, 0.03, { p: [0, 0.72 + k * 0.115, z1 + 0.012] });
  for (const sx of [-1, 1]) b.box('taillight', 0.14, 0.36, 0.03, { p: [sx * 1.05, 1.1, z1 + 0.01] });
  b.box('dark', 2.52, 0.22, 0.14, { p: [0, 0.5, z1 - 0.04] });
  label(b, 'labels', 'plate', 0.32, 0.16, [0.7, 0.5, z1 + 0.032], 'z+');
  b.cyl('rust', 0.04, 0.04, 0.3, 5, { p: [-0.9, 0.36, z1 - 0.2], r: [PI / 2, 0, 0] });
  // the roof: two hatches (one sprung), the air conditioner's pod
  b.box('metal', 0.8, 0.06, 0.8, { p: [0, 3.0, -2.5] });
  b.box('metal', 0.8, 0.05, 0.8, { p: [0, 3.04, 1.8], r: [0.14, 0, 0] });
  b.box('carpaint', 1.7, 0.13, 2.2, { p: [0, 3.04, 4.3], c: mul(base, 0.9), cfn: worn(0.3) });
  b.pop();
  // wheels: all of them flat. Singles at the front, twins at the back
  for (const z of [fa, ra]) b.box('dark', 2.2, 0.14, 0.14, { p: [0, 0.42, z] });
  for (const sx of [-1, 1]) {
    b.group({ p: [sx * 1.08, wr, fa] }, () => wheel(b, wr, 0.3, { flat: 0.3, rim: 'steel', rimR: 0.55 }));
    for (const x of [0.84, 1.1]) b.group({ p: [sx * x, wr, ra] }, () => wheel(b, wr, 0.26, { flat: 0.28, rim: 'steel', rimR: 0.55 }));
  }
  weeds(b, r, [[0.8, -2.0], [-0.8, 0.5], [0.85, 3.6], [-0.8, 4.9], [0.3, -5.4], [-0.85, -3.9]], 0.7);
};

// A delivery truck: a cab ahead of a box body, the name on its sides faded to a panel of colour, the roll-up door
// at the back stuck half way up over the last of its load, a flat tyre.
STREET_VARIANTS.box_truck = 2;
STREET_PROPS.box_truck = (b, r, v) => {
  const cab = v ? [0.42, 0.16, 0.12] : [0.62, 0.62, 0.58], body = v ? [0.66, 0.64, 0.56] : [0.7, 0.7, 0.66], logo = v ? [0.2, 0.36, 0.26] : [0.56, 0.3, 0.1];
  const hw = 1.1, fa = -2.7, ra = 1.9, wr = 0.45, w = worn(0.25, 1.0);
  for (const sx of [-1, 1]) b.box('rust', 0.12, 0.2, 5.4, { p: [sx * 0.42, 0.82, 1.0] });
  for (const z of [fa, ra]) b.box('dark', 2.0, 0.14, 0.14, { p: [0, wr, z] });
  // the cab: a short nose, a raked screen
  // (a shell: the raked screen - what is left of it on the second truck - and a window in each door, the kerb side's gone)
  profShell(b, 'carpaint', [[-3.6, 0.6], ...arch(fa, 0.6, 0.58), [-1.62, 0.6], [-1.62, 2.4], [-2.72, 2.4], [-3.2, 1.62], [-3.56, 1.52], [-3.6, 1.3]], hw * 2, {
    c: cab, cfn: w, look: (k) => paneLook(v ? 0.7 : 0.4, k),
    edges: [{ at: [[-2.72, 2.4], [-3.2, 1.62]], holes: [[-0.98, 0.98, 0.08, 0.92, v ? 'shard' : undefined]] }],
    sides: { L: [[-2.6, -1.8, 1.675, 2.225, v ? 'gone' : undefined]], R: [[-2.6, -1.8, 1.675, 2.225, 'gone']] },
  });
  b.box('dark', hw * 2 - 0.1, 0.56, 1.14, { p: [0, 0.88, fa] });
  // in the cab: a floor over the engine, two seats, the dash - and on the second one the driver
  deck(b, 0, 1.3, -2.36, hw * 2 - 0.1, 1.4);
  for (const sx of [-1, 1]) seat(b, sx * 0.55, 1.3, -2.1, { w: 0.54, h: 0.3, bh: 0.5, d: 0.44, c: SEATS[v ? 5 : 0] });
  dash(b, 1.66, -3.12, hw * 2 - 0.14, { d: 0.3, h: 0.3, wheelX: -0.55 });
  steering(b, [-0.55, 1.8, -2.62], { R: 0.2, tilt: 0.75 });
  mirror(b, [0, 2.26, -2.74]);
  if (v) sitter(b, [-0.55, 1.6, -2.1], { wheel: true, lean: 0.3, side: -1, shirt: [0.42, 0.16, 0.12] });
  else {
    b.box('cabin_fine', 0.24, 0.012, 0.32, { p: [0.5, 1.61, -2.1], r: [0, 0.4, 0], c: [0.62, 0.6, 0.5] }); // the round's sheet, on the other seat
    b.cyl('cabin_fine', 0.04, 0.035, 0.12, 6, { p: [0.2, 1.72, -3.0], c: [0.6, 0.58, 0.5] });
  }
  for (const sx of [-1, 1]) {
    for (const z of [-2.66, -1.72]) b.box('dark', 0.008, 1.1, 0.012, { p: [sx * (hw + 0.002), 1.75, z] });
    b.box('chrome', 0.03, 0.03, 0.12, { p: [sx * (hw + 0.012), 1.5, -1.85] });
    b.box('metal', 0.2, 0.14, 0.5, { p: [sx * 1.0, 0.54, -1.9] }); // the step
    b.cylBetween('dark', [sx * hw, 2.1, -2.75], [sx * (hw + 0.1), 2.05, -2.9], 0.012, 0.012, 3);
    b.box('dark', 0.03, 0.32, 0.16, { p: [sx * (hw + 0.11), 1.98, -2.92] });
    b.box('chrome', 0.3, 0.2, 0.03, { p: [sx * 0.88, 1.05, -3.6] });
    b.box(sx > 0 ? 'dark' : 'glass', 0.24, 0.14, 0.02, { p: [sx * 0.88, 1.05, -3.618] });
  }
  b.box('dark', 1.4, 0.42, 0.02, { p: [0, 1.05, -3.602] });
  for (let k = 0; k < 3; k++) b.box('chrome', 1.4, 0.025, 0.02, { p: [0, 0.93 + k * 0.12, -3.612] });
  b.box('steel', 2.26, 0.22, 0.12, { p: [0, 0.66, -3.67] });
  label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.66, -3.732], 'z-');
  for (const x of [-0.4, 0, 0.4]) b.box('paint', 0.08, 0.04, 0.06, { p: [x, 2.42, -2.66], c: [0.66, 0.4, 0.08] });
  // the box: closed along its length, open at the back behind the door
  const bx = 1.22, by0 = 0.98, by1 = 3.18, bz0 = -1.5, bz1 = 3.6, bzs = 3.3, bym = (by0 + by1) / 2;
  // (a shell, open at the back under the door: the load space, and what is left of the load)
  boxShell(b, 'paint', bx * 2, by1 - by0, bzs - bz0, { p: [0, bym, (bz0 + bzs) / 2], c: body, cfn: worn(0.18), t: 0.05, lining: [0.25, 0.22, 0.18], holes: { zp: [[-1.14, 1.14, by0 + 0.08 - bym, 2.1 - bym, 'gone']] } });
  const cy = by0 + 0.06;
  const crate = (x, z, sx, sy, sz, ry, y = 0, k = 1) => b.box('cabin_fine', sx, sy, sz, { p: [x, cy + y + sy / 2, z], r: [0, ry, 0], c: [0.46 * k, 0.38 * k, 0.26 * k] });
  crate(-0.6, -0.6, 0.9, 0.9, 1.0, 0.05, 0, 0.9);
  crate(0.55, -0.7, 0.8, 0.6, 0.8, -0.1);
  crate(0.5, -0.66, 0.6, 0.5, 0.6, 0.2, 0.6, 1.1);
  crate(-0.5, 0.9, 1.0, 0.5, 0.8, 0.1, 0, 1.05);
  crate(0.6, 1.2, 0.7, 0.7, 0.7, -0.2, 0, 0.85);
  crate(-0.2, 2.3, 0.6, 0.4, 0.5, 0.5);
  b.box('cabin_fine', 1.1, 0.12, 0.9, { p: [0.5, cy + 0.06, 2.4], r: [0, 0.3, 0], c: [0.36, 0.28, 0.18] }); // a pallet
  rubbish(b, [0, cy, 1.8], 1.6, 2.0, 6, 11);
  b.box('paint', bx * 2, 0.08, bz1 - bzs, { p: [0, by0 + 0.04, (bzs + bz1) / 2], c: body });
  b.box('paint', bx * 2, 0.1, bz1 - bzs, { p: [0, by1 - 0.05, (bzs + bz1) / 2], c: body });
  for (const sx of [-1, 1]) {
    b.box('paint', 0.08, by1 - by0 - 0.18, bz1 - bzs, { p: [sx * (bx - 0.04), bym - 0.01, (bzs + bz1) / 2], c: body });
    b.box('paint', 0.008, 0.95, 2.7, { p: [sx * (bx + 0.003), 2.3, 0.8], c: logo, cfn: worn(0.4, 0, body) }); // where the name was
    b.box('paint', 0.01, 0.2, 1.9, { p: [sx * (bx + 0.006), 2.3, 0.8], c: [0.7, 0.68, 0.6] });
    b.box('metal', 0.02, 0.08, bz1 - bz0, { p: [sx * (bx + 0.004), by0 + 0.04, (bz0 + bz1) / 2] });
    b.box('metal', 0.05, by1 - by0, 0.05, { p: [sx * (bx - 0.012), bym, bz0 + 0.012] });
    for (let k = 0; k < 3; k++) {
      const h = rr(r, 0.3, 0.8);
      b.box('rust', 0.006, h, rr(r, 0.5, 1.3), { p: [sx * (bx + 0.002), by0 + 0.1 + h / 2, rr(r, -0.7, 2.5)] });
    }
    b.box('taillight', 0.14, 0.1, 0.03, { p: [sx * 1.0, 0.92, 3.58] });
    b.box('rubber', 0.52, 0.42, 0.02, { p: [sx * 0.95, 0.62, 2.55] });
    b.box('rust', 0.08, 0.3, 0.08, { p: [sx * 0.6, 0.84, 3.6] });
  }
  for (let k = 0; k < 5; k++) b.box('steel', bx * 2 - 0.16, 0.19, 0.03, { p: [0, 2.2 + k * 0.196, bz1 - 0.06] }); // the door, half way up
  b.box('rust', bx * 2 - 0.16, 0.06, 0.05, { p: [0, 2.08, bz1 - 0.06] });
  b.box('cloth', 0.03, 0.4, 0.004, { p: [0.3, 1.86, bz1 - 0.06], c: [0.2, 0.18, 0.16] });
  b.box('cardboard', 0.5, 0.4, 0.26, { p: [-0.5, 1.26, 3.44], r: [0, 0.1, 0] });
  b.box('cardboard', 0.36, 0.26, 0.22, { p: [-0.52, 1.59, 3.44], r: [0, -0.2, 0] });
  b.box('cardboard', 0.4, 0.3, 0.24, { p: [0.15, 1.21, 3.45], r: [0, -0.15, 0] });
  b.box('rust', 2.3, 0.1, 0.14, { p: [0, 0.72, 3.66] });
  label(b, 'labels', 'plate', 0.32, 0.16, [-0.3, 0.72, 3.732], 'z+');
  b.cyl('metal', 0.24, 0.24, 0.8, 8, { p: [-0.86, 0.72, -0.5], r: [PI / 2, 0, 0] });
  b.box('rust', 0.4, 0.34, 0.5, { p: [0.86, 0.74, -0.5] });
  for (const sx of [-1, 1]) {
    b.group({ p: [sx * 0.98, wr, fa] }, () => wheel(b, wr, 0.26, { flat: v && sx < 0 ? 0.3 : 0.04, rim: 'steel', rimR: 0.55 }));
    for (const x of [0.82, 1.07]) b.group({ p: [sx * x, wr, ra] }, () => wheel(b, wr, 0.24, { flat: !v && sx > 0 ? 0.3 : 0.05, rim: 'steel', rimR: 0.55 }));
  }
  weeds(b, r, [[0.8, -0.6], [-0.85, 1.4], [0.3, 3.3], [-0.7, -3.2]], 0.55);
};

// A panel van down on its rims, the side door (+X) slid back on the load space. The second one burnt out.
STREET_VARIANTS.van_wreck = 2;
STREET_PROPS.van_wreck = (b, r, v) => {
  const burnt = v === 1;
  const col = burnt ? [0.11, 0.1, 0.09] : [0.64, 0.65, 0.62];
  const hw = 0.92, W = hw * 2, sink = 0.1, fa = -1.5, ra = 1.45;
  const w = burnt ? worn(0.8) : worn(0.25, 0.7);
  const o = { c: col, cfn: w };
  b.push([0, -sink, 0]);
  // the body in three lengths: the cab, the load space open at the door, the back
  // (the cab a shell: the screen, a window in the driver's door, the other gone; the back a shell open to the load
  // space, a light in each of its doors, one gone. Burnt: no glass anywhere)
  const lin = burnt ? CHAR : LINING, look = (k) => paneLook(0.55, k), gw = burnt ? 'gone' : undefined;
  profShell(b, 'carpaint', [[-2.4, 0.32], ...arch(fa, 0.32, 0.42), [-0.6, 0.32], [-0.6, 2.0], [-1.25, 2.0], [-1.95, 1.28], [-2.36, 1.14], [-2.44, 0.95], [-2.44, 0.42]], W, {
    ...o, lining: lin, look,
    edges: [{ at: [[-1.25, 2.0], [-1.95, 1.28]], holes: [[-0.8, 0.8, 0.08, 0.92, gw]] }],
    sides: { L: [[-1.29, -0.71, 1.39, 1.85, gw]], R: [[-1.29, -0.71, 1.39, 1.85, 'gone']] },
  });
  profShell(b, 'carpaint', [[0.6, 0.32], ...arch(ra, 0.32, 0.42), [2.42, 0.32], [2.45, 0.5], [2.45, 1.9], [2.38, 2.0], [0.6, 2.0]], W, {
    ...o, lining: burnt ? CHAR : [0.2, 0.2, 0.19], look, pane0: 4, open: [[[0.6, 2.0], [0.6, 0.32]]],
    edges: [{ at: [[2.45, 0.5], [2.45, 1.9]], holes: [[-0.65, -0.19, 0.657, 0.914, 'gone'], [0.19, 0.65, 0.657, 0.914, gw]] }],
  });
  for (const z of [fa, ra]) b.box('dark', W - 0.1, 0.4, 0.82, { p: [0, 0.52, z] });
  // the cab: a floor, two seats, the dash; what a fire left of them
  deck(b, 0, 0.95, -1.3, W - 0.1, 1.36, burnt ? CHAR : undefined);
  if (burnt) {
    for (const sx of [-1, 1]) burntSeat(b, sx * 0.45, 0.95, -1.0, { h: 0.3, bh: 0.46 });
    b.box('cabin_fine', W - 0.2, 0.26, 0.24, { p: [0, 1.16, -1.76], c: CHAR });
  } else {
    for (const sx of [-1, 1]) seat(b, sx * 0.45, 0.95, -1.0, { w: 0.5, h: 0.3, bh: 0.44, d: 0.44, c: SEATS[0] });
    dash(b, 1.3, -1.88, W - 0.16, { d: 0.26, h: 0.3, wheelX: -0.45 });
    steering(b, [-0.45, 1.42, -1.48], { R: 0.19, tilt: 0.6 });
    mirror(b, [0, 1.84, -1.44]);
    rubbish(b, [0.45, 1.255, -1.0], 0.3, 0.3, 3, 2);
  }
  // the back of the load space, behind the doors: what nobody carried off
  deck(b, 0, 0.44, 1.5, W - 0.1, 1.84, burnt ? CHAR : [0.2, 0.2, 0.2]);
  if (!burnt) {
    b.box('cabin_fine', 0.7, 0.5, 0.6, { p: [-0.45, 0.99, 1.45], r: [0, 0.1, 0], c: [0.44, 0.36, 0.24] });
    b.box('cabin_fine', 0.5, 0.36, 0.5, { p: [-0.45, 1.42, 1.42], r: [0, -0.2, 0], c: [0.5, 0.42, 0.3] });
    b.box('cabin_fine', 0.6, 0.4, 0.5, { p: [0.4, 0.64, 2.1], r: [0, 0.3, 0], c: [0.4, 0.34, 0.24] });
    b.cyl('cabin_fine', 0.16, 0.16, 0.4, 8, { p: [0.5, 0.64, 1.0], c: [0.2, 0.3, 0.4] });
  } else b.box('cabin_fine', 1.2, 0.08, 1.2, { p: [0, 0.48, 1.5], c: CHAR });
  b.box('carpaint', 0.05, 1.68, 1.2, { p: [-hw + 0.025, 1.16, 0], ...o });
  b.box(burnt ? 'charred' : 'metal', W, 0.1, 1.2, { p: [0, 0.37, 0] });
  b.box('carpaint', W, 0.08, 1.2, { p: [0, 1.96, 0], ...o });
  b.box('dark', 0.012, 1.5, 1.2, { p: [-hw + 0.056, 1.17, 0] });
  b.box('dark', W - 0.12, 1.5, 0.012, { p: [0.01, 1.17, -0.593] }); // (the bulkhead behind the cab; the other end runs on into the back)
  if (burnt) {
    b.box('ash', 1.3, 0.1, 0.9, { p: [0.1, 0.46, 0] });
    b.box('charred', 0.5, 0.3, 0.4, { p: [0.25, 0.56, -0.2], r: [0, 0.4, 0.1] });
  } else {
    b.box('cardboard', 0.5, 0.4, 0.5, { p: [0.3, 0.62, -0.26], r: [0, 0.2, 0] });
    b.box('cardboard', 0.4, 0.3, 0.4, { p: [0.42, 0.57, 0.3], r: [0, -0.3, 0] });
    b.box('plastic', 0.34, 0.5, 0.3, { p: [-0.3, 0.67, 0.2] });
  }
  // the door on its rail, slid back along the side
  b.box('carpaint', 0.04, 1.5, 1.16, { p: [hw + 0.04, 1.17, 1.24], ...o });
  b.box('dark', 0.02, 0.03, 1.9, { p: [hw + 0.01, 1.55, 1.3] });
  b.box(burnt ? 'rust' : 'chrome', 0.02, 0.04, 0.14, { p: [hw + 0.066, 1.1, 0.8] });
  for (const sx of [-1, 1]) {
    for (const z of [-1.38, -0.64]) b.box('dark', 0.008, 1.3, 0.012, { p: [sx * (hw + 0.002), 1.25, z] });
    if (!burnt) b.box('dark', 0.05, 0.2, 0.12, { p: [sx * (hw + 0.045), 1.5, -1.55] }); // mirrors
    b.box('taillight', 0.1, 0.34, 0.02, { p: [sx * 0.84, 1.0, 2.455] });
    b.box(burnt ? 'rust' : 'chrome', 0.26, 0.18, 0.03, { p: [sx * 0.66, 0.84, -2.44] });
    b.box(burnt || sx > 0 ? 'dark' : 'glass', 0.2, 0.13, 0.02, { p: [sx * 0.66, 0.84, -2.458] });
    for (let k = 0; k < 2; k++) {
      const h = rr(r, 0.2, 0.5);
      b.box('rust', 0.006, h, rr(r, 0.4, 0.9), { p: [sx * (hw + 0.002), 0.4 + h / 2, sx < 0 ? rr(r, -0.6, 0.7) : -1.0 + k * 3.2] });
    }
  }
  b.box('dark', 0.012, 1.5, 0.01, { p: [0, 1.15, 2.452] });
  b.box(burnt ? 'rust' : 'chrome', 0.03, 0.14, 0.03, { p: [0.05, 1.1, 2.462] });
  b.box('dark', 1.1, 0.22, 0.02, { p: [0, 0.8, -2.447] });
  b.box('dark', 1.86, 0.16, 0.1, { p: [0, 0.45, -2.42] });
  b.box('dark', 1.86, 0.14, 0.08, { p: [0, 0.42, 2.44] });
  if (!burnt) label(b, 'labels', 'plate', 0.32, 0.16, [0, 0.45, -2.472], 'z-');
  for (const z of [0.9, 2.0]) b.box('steel', W - 0.1, 0.03, 0.04, { p: [0, 2.025, z] }); // a roof rack and a length of pipe on it
  b.cylBetween('rust', [0.4, 2.07, 0.7], [0.43, 2.07, 2.25], 0.03, 0.03, 5);
  b.pop();
  for (const sx of [-1, 1])
    for (const z of [fa, ra]) {
      b.cyl('rust', 0.22, 0.22, 0.16, 10, { p: [sx * 0.78, 0.22, z], r: [0, 0, PI / 2] });
      b.cyl('dark', 0.08, 0.08, 0.18, 6, { p: [sx * 0.78, 0.22, z], r: [0, 0, PI / 2] });
      if (!burnt) b.box('tire', 0.22, 0.03, 0.52, { p: [sx * 0.78, 0.015, z], r: [0, rr(r, -0.15, 0.15), 0] }); // what is left of the tyre
    }
  if (burnt) {
    b.box('charred', 1.9, 0.012, 4.6, { p: [0, 0.006, 0] });
    for (let k = 0; k < 4; k++) b.box('ash', rr(r, 0.2, 0.5), 0.03, rr(r, 0.15, 0.4), { p: [rr(r, -0.6, 0.6), 0.02, rr(r, -1.9, 1.9)], r: [0, r() * 3, 0] });
  } else weeds(b, r, [[0.5, -1.2], [-0.55, 1.6], [0.2, 2.0], [-0.5, -0.3]], 0.5);
};

// ------------------------------------------------------------------ the army's last stand
// An eight-wheeled armoured carrier, knocked out: a welded hull (a wedge of a nose, the sides sloped in over the
// wheels), a small turret with its autocannon slewed and hanging, hatches open, the ramp down at the back. One wheel
// burnt to the rim, the hull black above it.
STREET_VARIANTS.apc_wreck = 1;
STREET_PROPS.apc_wreck = (b, r) => {
  const zr = 2.6, top = 2.1, slope = Math.atan2(0.3, 0.85); // the back plate, the roof, how far the sides lean in
  b.hull('olive', [[-0.72, 0.48, -2.9], [0.72, 0.48, -2.9], [-0.76, 1.26, -3.4], [0.76, 1.26, -3.4], [-0.72, 0.48, zr], [0.72, 0.48, zr], [-0.76, 1.26, zr], [0.76, 1.26, zr]]);
  solid(
    b,
    'olive',
    [[-1.35, 1.25, -2.3], [1.35, 1.25, -2.3], [-1.05, top, -2.1], [1.05, top, -2.1], [-1.35, 1.25, zr], [1.35, 1.25, zr], [-1.05, top, zr], [1.05, top, zr], [-1.1, 1.25, -3.5], [1.1, 1.25, -3.5]],
    [[2, 3, 7, 6], [2, 3, 9, 8], [0, 2, 8], [1, 3, 9], [0, 2, 6, 4], [1, 3, 7, 5], [4, 5, 7, 6], [0, 1, 5, 4], [0, 1, 9, 8]]
  );
  // on a side plate: x at height y, and a thin panel lying on it
  const sideX = (y) => 1.35 - ((y - 1.25) / 0.85) * 0.3;
  const onSide = (mat, sx, y, z, h, len, t = 0.012, o = {}) => b.box(mat, t, h, len, { ...o, p: [sx * (sideX(y) + (t / 2 + 0.002) * 0.943), y + (t / 2 + 0.002) * 0.333, z], r: [0, 0, sx * slope] });
  // wheels: four axles, the second on the left burnt out
  const axles = [-2.5, -1.25, 0.25, 1.5];
  for (const z of axles) b.box('dark', 2.3, 0.14, 0.14, { p: [0, 0.55, z] });
  for (const sx of [-1, 1])
    axles.forEach((z, k) => {
      if (sx < 0 && k === 1) {
        b.cyl('rust', 0.32, 0.32, 0.3, 10, { p: [sx * 1.12, 0.55, z], r: [0, 0, PI / 2] });
        b.cyl('dark', 0.12, 0.12, 0.32, 6, { p: [sx * 1.12, 0.55, z], r: [0, 0, PI / 2] });
        b.box('charred', 0.5, 0.04, 1.1, { p: [sx * 1.1, 0.02, z], r: [0, 0.1, 0] });
        return;
      }
      b.group({ p: [sx * 1.12, 0.55, z] }, () => roadWheel(b, 0.55, 0.36, { flat: (k + (sx > 0 ? 1 : 0)) % 3 === 0 ? 0.26 : 0.06, rim: 'olive' }));
    });
  onSide('charred', -1, 1.68, -1.25, 0.84, 1.6);
  b.box('charred', 0.5, 0.01, 1.3, { p: [-0.8, top + 0.004, -1.25] });
  b.box('charred', 0.05, 0.5, 1.2, { p: [-0.76, 0.95, -1.25] });
  // the turret, slewed off to one side, the gun down
  b.group({ p: [0, top, -0.5], r: [0, 0.3, 0] }, () => {
    b.cyl('olive', 0.46, 0.6, 0.4, 8, { p: [0, 0.2, 0] });
    b.box('olive', 0.34, 0.26, 0.3, { p: [0, 0.2, -0.6] });
    b.cylBetween('dark', [0, 0.22, -0.7], [0, 0.06, -2.5], 0.03, 0.04, 6);
    b.cylBetween('dark', [0, 0.078, -2.28], [0, 0.06, -2.5], 0.05, 0.05, 6);
    b.cylBetween('dark', [0.13, 0.2, -0.7], [0.13, 0.14, -1.3], 0.015, 0.015, 4);
    b.box('olive', 0.18, 0.14, 0.2, { p: [0.24, 0.47, -0.1] }); // the sight
    b.box('glass', 0.12, 0.08, 0.01, { p: [0.24, 0.48, -0.204] });
    b.cyl('dark', 0.2, 0.2, 0.012, 8, { p: [-0.12, 0.405, 0.12] }); // its hatch, thrown right back
    b.cyl('olive', 0.21, 0.21, 0.04, 8, { p: [-0.12, 0.4, 0.53], r: [0.2, 0, 0] });
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) b.cyl('olive', 0.035, 0.035, 0.18, 5, { p: [sx * 0.56, 0.24, -0.2 + k * 0.1], r: [-1.1, 0, sx * -0.4] });
  });
  // hatches: the driver's standing open, two over the troops folded out
  b.cyl('dark', 0.26, 0.26, 0.012, 8, { p: [-0.55, top + 0.005, -1.72] });
  b.cyl('olive', 0.26, 0.26, 0.04, 8, { p: [-0.55, top + 0.24, -1.42], r: [-1.25, 0, 0] });
  for (const x of [-0.75, -0.55, -0.35]) b.box('dark', 0.12, 0.06, 0.05, { p: [x, top + 0.03, -2.02] });
  for (const sx of [-1, 1]) {
    b.box('dark', 0.5, 0.012, 0.9, { p: [sx * 0.4, top + 0.005, 1.5] });
    b.group({ p: [sx * 0.66, top, 1.5], r: [0, 0, sx * -1.84] }, () => b.box('olive', 0.5, 0.04, 0.9, { p: [sx * -0.25, 0.02, 0] }));
  }
  // the nose: the trim vane lying on the glacis, lamps, towing eyes
  const gl = Math.atan2(top - 1.25, 1.4);
  b.box('olive', 1.6, 0.03, 0.8, { p: [0, 1.675 + 0.02, -2.8 - 0.012], r: [-gl, 0, 0] });
  for (const sx of [-1, 1]) {
    b.box('dark', 0.2, 0.16, 0.14, { p: [sx * 0.85, 1.4, -3.3] });
    b.box(sx > 0 ? 'glass' : 'dark', 0.14, 0.1, 0.012, { p: [sx * 0.85, 1.4, -3.374] });
    b.box('rust', 0.08, 0.14, 0.12, { p: [sx * 0.45, 0.95, -3.22] });
    for (const z of [0.3, 1.0, 1.7]) b.box('dark', 0.03, 0.07, 0.2, { p: [sx * (sideX(1.98) + 0.004), 1.98, z], r: [0, 0, sx * slope] }); // vision blocks
    b.box('taillight', 0.12, 0.08, 0.02, { p: [sx * 1.15, 1.45, zr + 0.01] });
    b.cylBetween('wire', [sx * 0.69, 1.6, zr + 0.02], [sx * 0.69, 0.1, 3.42], 0.008, 0.008, 3); // the ramp's cables
    onSide('rust', sx, 1.42, sx * 0.6 + 0.3, 0.3, rr(r, 0.6, 1.2), 0.006);
  }
  onSide('olive', -1, 1.6, 1.25, 0.34, 0.9, 0.12); // a stowage bin, and the pioneer tools on the other side
  b.cylBetween('wood', [sideX(1.45) + 0.03, 1.46, -1.9], [sideX(1.75) + 0.03, 1.76, -0.95], 0.016, 0.016, 4, { c: WOODS[2] });
  onSide('rust', 1, 1.42, -2.02, 0.22, 0.2, 0.015);
  b.cyl('rust', 0.07, 0.07, 1.3, 6, { p: [1.21, 1.88, 1.3], r: [PI / 2, 0, 0] }); // the exhaust
  b.cylBetween('steel', [0.8, top, 2.2], [0.86, top + 0.25, 2.24], 0.012, 0.012, 3); // the stub of an aerial, bent
  b.cylBetween('steel', [0.86, top + 0.25, 2.24], [1.1, top + 0.5, 2.4], 0.008, 0.008, 3);
  // the back: the doorway and the ramp down out of it
  b.box('dark', 1.4, 1.05, 0.03, { p: [0, 1.125, zr] });
  b.group({ p: [0, 0.6, zr + 0.02], r: [0.585, 0, 0] }, () => {
    b.box('olive', 1.4, 0.07, 1.05, { p: [0, 0, 0.525] });
    for (let k = 0; k < 4; k++) b.box('metal', 1.2, 0.015, 0.04, { p: [0, 0.04, 0.2 + k * 0.22] });
  });
  weeds(b, r, [[0.4, -2.0], [-0.5, 0.9], [0.3, 2.0], [-0.3, -0.4]], 0.6);
};

// A 6x6 army cargo truck: a square cab behind a long bonnet and flat mudguards, the bed under a canvas tilt on its
// bows (torn open down one side), benches along it, the tailgate down. The second one's cab burnt out, down on its
// front rims.
STREET_VARIANTS.army_truck = 2;
STREET_PROPS.army_truck = (b, r, v) => {
  const burnt = v === 1, cabMat = burnt ? 'charred' : 'olive';
  const fa = -2.65, rear = [1.55, 2.8], wr = 0.55;
  const slats = [0.42, 0.44, 0.32];
  const body = () => {
    for (const sx of [-1, 1]) b.box('rust', 0.14, 0.24, 6.9, { p: [sx * 0.42, 0.95, 0.15] });
    b.box('olive', 2.3, 0.22, 0.12, { p: [0, 0.9, -3.66] });
    for (const sx of [-1, 1]) b.box('rust', 0.06, 0.1, 0.1, { p: [sx * 0.7, 0.9, -3.7] });
    // bonnet, grille, mudguards
    sideProf(b, cabMat, [[-3.55, 1.05], [-2.2, 1.05], [-2.2, 1.84], [-3.5, 1.74], [-3.55, 1.66]], 1.3);
    b.box('dark', 0.74, 0.5, 0.02, { p: [0, 1.38, -3.555] });
    for (let k = 0; k < 5; k++) b.box(cabMat, 0.04, 0.5, 0.03, { p: [-0.28 + k * 0.14, 1.38, -3.565] });
    for (const sx of [-1, 1]) {
      b.box(cabMat, 0.5, 0.05, 1.15, { p: [sx * 0.95, 1.22, -2.775] });
      b.box(cabMat, 0.5, 0.05, 0.3, { p: [sx * 0.95, 1.15, -3.46], r: [-0.55, 0, 0] });
      b.box(cabMat, 0.06, 0.2, 1.15, { p: [sx * 0.68, 1.12, -2.775] });
      b.cyl('steel', 0.09, 0.09, 0.08, 8, { p: [sx * 0.52, 1.46, -3.56], r: [PI / 2, 0, 0] });
      b.cyl(burnt || sx > 0 ? 'dark' : 'glass', 0.07, 0.07, 0.02, 8, { p: [sx * 0.52, 1.46, -3.605], r: [PI / 2, 0, 0] });
    }
    // the cab
    // (a shell: the split screen - the driver's light whole, a tooth of the other - and a window in each door, one
    // gone. Burnt: no glass, and what the fire left inside)
    const gw = burnt ? 'gone' : undefined;
    profShell(b, cabMat, [[-2.2, 0.95], [-1.1, 0.95], [-1.1, 2.5], [-2.02, 2.5], [-2.2, 1.84]], 2.3, {
      lining: burnt ? CHAR : [0.2, 0.22, 0.16], look: (k) => paneLook(0.6, k),
      edges: [{ at: [[-2.02, 2.5], [-2.2, 1.84]], holes: [[-1.0, -0.08, 0.12, 0.9, gw], [0.08, 1.0, 0.12, 0.9, burnt ? 'gone' : 'shard']] }],
      sides: { L: [[-2.0, -1.3, 1.895, 2.345, gw]], R: [[-2.0, -1.3, 1.895, 2.345, 'gone']] },
    });
    deck(b, 0, 1.5, -1.65, 2.2, 1.0, burnt ? CHAR : [0.14, 0.15, 0.12]);
    if (burnt) {
      for (const sx of [-1, 1]) burntSeat(b, sx * 0.55, 1.5, -1.5, { h: 0.3, bh: 0.46 });
      b.box('cabin_fine', 2.1, 0.24, 0.2, { p: [0, 1.74, -2.02], c: CHAR });
    } else {
      seat(b, 0, 1.5, -1.5, { w: 1.9, h: 0.3, bh: 0.46, d: 0.44, heads: 0, c: [0.27, 0.3, 0.2], rake: 0.08 });
      dash(b, 1.86, -2.13, 2.16, { d: 0.2, h: 0.3, wheelX: -0.55, c: [0.16, 0.18, 0.13] });
      steering(b, [-0.55, 1.98, -1.82], { R: 0.22, tilt: 0.85 });
      b.sphere('cabin_fine', 0.13, 7, 4, { p: [0.4, 1.8, -1.5], thetaLen: PI / 2, c: [0.24, 0.27, 0.18] }); // a helmet on the bench
      b.box('cabin_fine', 0.05, 0.9, 0.06, { p: [0.8, 1.9, -1.34], r: [0.25, 0, -0.1], c: [0.1, 0.1, 0.1] }); // a rifle stood against the door
    }
    for (const sx of [-1, 1]) {
      for (const z of [-2.1, -1.2]) b.box('dark', 0.008, 0.9, 0.012, { p: [sx * 1.152, 1.4, z] });
      b.box('rust', 0.3, 0.04, 0.5, { p: [sx * 1.02, 0.76, -1.65] }); // the step, on its hangers
      for (const z of [-1.86, -1.44]) b.box('rust', 0.03, 0.2, 0.03, { p: [sx * 1.02, 0.86, z] });
      if (!burnt) {
        b.cylBetween('dark', [sx * 1.15, 2.2, -2.1], [sx * 1.21, 2.15, -2.22], 0.01, 0.01, 3);
        b.box('dark', 0.03, 0.26, 0.14, { p: [sx * 1.22, 2.1, -2.24] });
      }
    }
    b.cyl('rust', 0.05, 0.05, 1.9, 6, { p: [1.0, 1.95, -1.02] }); // the exhaust stack
    b.cyl('olive', 0.26, 0.26, 0.9, 8, { p: [-0.92, 0.88, -0.35], r: [PI / 2, 0, 0] }); // tank, locker
    b.box('olive', 0.4, 0.4, 0.8, { p: [0.92, 0.88, -0.3] });
    // the bed: floor, sides and their slatted racks, the headboard, benches, the tailgate hanging down
    b.box('olive', 2.4, 0.1, 4.6, { p: [0, 1.32, 1.38] });
    for (const z of [-0.5, 1.4, 3.3]) b.box('rust', 2.2, 0.1, 0.1, { p: [0, 1.22, z] });
    b.box('olive', 2.4, 0.9, 0.05, { p: [0, 1.82, -0.9] });
    for (const sx of [-1, 1]) {
      b.box('olive', 0.05, 0.42, 4.6, { p: [sx * 1.175, 1.58, 1.38] });
      for (const y of [1.98, 2.24]) plank(b, 'wood', 0.03, 0.12, 4.55, { p: [sx * 1.175, y, 1.38], c: slats });
      plank(b, 'wood', 0.4, 0.04, 4.2, { p: [sx * 0.92, 1.82, 1.45], c: slats });
      for (const z of [-0.4, 1.45, 3.3]) b.box('olive', 0.04, 0.45, 0.04, { p: [sx * 0.76, 1.595, z] });
    }
    b.box('olive', 2.36, 0.44, 0.05, { p: [0, 1.04, 3.705] });
    for (const sx of [-1, 1]) b.cylBetween('wire', [sx * 1.17, 1.7, 3.68], [sx * 1.1, 1.2, 3.74], 0.008, 0.008, 3);
    // the bows, and the tilt over them: whole on the right, torn off two bays of the left
    const bows = [-0.8, 0.3, 1.4, 2.5, 3.6];
    for (const z of bows) {
      for (const sx of [-1, 1]) {
        b.box('steel', 0.04, 1.08, 0.04, { p: [sx * 1.14, 2.32, z] });
        b.beam('steel', [sx * 1.14, 2.85, z], [sx * 0.75, 3.08, z], 0.04, 0.04);
      }
      b.box('steel', 1.5, 0.04, 0.04, { p: [0, 3.08, z] });
    }
    const CS = [[-1.17, 1.85], [-1.17, 2.87], [-0.77, 3.11], [0.77, 3.11], [1.17, 2.87], [1.17, 1.85]];
    const cs = (t) => { const k = Math.min(4, Math.floor(t)), f = t - k; return [CS[k][0] + (CS[k + 1][0] - CS[k][0]) * f, CS[k][1] + (CS[k + 1][1] - CS[k][1]) * f]; };
    for (let k = 0; k < 4; k++) {
      const i0 = k === 1 || k === 2 ? 2 : 0, sag = rr(r, 0.03, 0.06);
      drape(b, 'canvas_mil', (u, t) => {
        const [x, y] = cs(i0 + u * (5 - i0)), s = Math.sin(t * PI) * sag;
        return [x * (1 - s * 0.5), y - (y > 2.9 ? s : s * 0.3), bows[k] + t * (bows[k + 1] - bows[k])];
      }, 5 - i0, 2);
    }
    sheet(b, 'canvas_mil', CS.map(([x, y]) => [x, y, bows[0] - 0.03]), [0, 0, -1]);
    sheet(b, 'canvas_mil', [[-1.16, 2.86, 0.32], [-0.8, 3.09, 0.34], [-0.86, 2.7, 0.7], [-1.12, 2.3, 0.5]], [-1, 0, 0]); // what hangs of the torn side
    sheet(b, 'canvas_mil', [[-0.78, 3.1, 2.48], [-1.15, 2.87, 2.48], [-1.13, 2.2, 2.3], [-0.95, 2.6, 2.0]], [-1, 0, 0]);
    b.cyl('canvas_mil', 0.07, 0.07, 1.5, 6, { p: [0, 3.0, 3.6], r: [0, 0, PI / 2] }); // the back flap, rolled up
    // what is in it
    for (const [x, z, a] of [[0.55, 3.2, 0.1], [0.75, 3.24, -0.2], [-0.5, 0.2, 0.5]]) {
      b.group({ p: [x, 1.37, z], r: [0, a, 0] }, () => {
        b.box('olive', 0.16, 0.4, 0.32, { p: [0, 0.2, 0] });
        b.box('olive', 0.04, 0.04, 0.2, { p: [0, 0.43, 0.02] });
        b.cyl('rust', 0.025, 0.025, 0.04, 5, { p: [0, 0.42, -0.13] });
      });
    }
    b.box('wood', 0.8, 0.35, 0.5, { p: [-0.3, 1.545, 1.6], r: [0, 0.2, 0], c: [0.4, 0.42, 0.3] });
    label(b, 'stencil', 'army', 0.5, 0.25, [-1.202, 1.58, 1.4], 'x-');
    label(b, 'stencil', 'army', 0.5, 0.25, [1.202, 1.58, 1.4], 'x+');
  };
  // (burnt: the nose is down on the rims - the body pitched about the back axles, the wheels left on the ground)
  if (burnt) b.group({ p: [0, 0.95, 2.2], r: [-0.053, 0, 0] }, () => b.group({ p: [0, -0.95, -2.2] }, body));
  else body();
  for (const sx of [-1, 1]) {
    if (burnt) {
      b.cyl('rust', 0.3, 0.3, 0.3, 10, { p: [sx * 1.0, 0.3, fa], r: [0, 0, PI / 2] });
      b.cyl('dark', 0.11, 0.11, 0.32, 6, { p: [sx * 1.0, 0.3, fa], r: [0, 0, PI / 2] });
      b.box('charred', 0.4, 0.04, 1.0, { p: [sx * 0.98, 0.02, fa], r: [0, sx * 0.05, 0] });
    } else b.group({ p: [sx * 1.0, wr, fa] }, () => roadWheel(b, wr, 0.36, { flat: sx > 0 ? 0.28 : 0.05, rim: 'olive' }));
    for (const z of rear) b.group({ p: [sx * 1.0, wr, z] }, () => roadWheel(b, wr, 0.36, { flat: 0.06, rim: 'olive' }));
  }
  for (const z of burnt ? rear : [fa, ...rear]) b.box('dark', 2.0, 0.16, 0.16, { p: [0, wr, z] });
  if (burnt) b.box('charred', 2.3, 0.012, 2.6, { p: [0, 0.006, -2.4] });
  weeds(b, r, [[0.6, 0.3], [-0.7, 2.2], [0.3, 3.3], [-0.4, -1.0]], 0.6);
};

// A sandbag position: a U of walls, bag on bag in running bond, open at the back (+Z), a firing notch in the middle
// of the front wall; an ammunition can and brass on the ground inside, a tarp over one wall.
STREET_VARIANTS.sandbag_nest = 2;
STREET_PROPS.sandbag_nest = (b, r, v) => {
  const put = (x, y, z, len, yaw) => b.group({ p: [x + rr(r, -0.008, 0.008), y, z + rr(r, -0.008, 0.008)], r: [0, yaw + rr(r, -0.025, 0.025), rr(r, -0.03, 0.03)] }, () => bag(b, len, 0.225, 0.54));
  for (let j = 0; j < 6; j++) {
    const y = 0.105 + j * 0.2, odd = j % 2;
    // the front wall (the top two courses broken by the notch)
    let front = odd ? [-1.2, -0.6, 0, 0.6, 1.2].map((x) => [x, 0.6]) : [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((k) => [k * 0.69, 0.7]);
    if (j === 4) front = [[-1.725, 0.7], [-1.04, 0.68], [-0.525, 0.35], [0.525, 0.35], [1.04, 0.68], [1.725, 0.7]];
    if (j === 5) front = [[-1.22, 0.56], [-0.64, 0.58], [0.64, 0.58], [1.22, 0.56]];
    for (const [x, len] of front) put(x, y, -1.3, len, 0);
    // the sides: on the odd courses they run through the corners
    for (const sx of [-1, 1])
      for (let k = 0; k < 4; k++) {
        if (v && j === 5 && sx > 0 && k > 1) continue; // (the top of a wall come down)
        put(sx * 1.8, y, odd ? -1.18 + k * 0.785 : -0.69 + k * 0.645, odd ? 0.785 : 0.645, PI / 2);
      }
  }
  if (v) {
    b.group({ p: [1.2, 0.11, 0.9], r: [0, 0.5, 0.05] }, () => bag(b, 0.7, 0.22, 0.56));
    b.group({ p: [1.15, 0.11, 0.2], r: [0, -0.3, 0] }, () => bag(b, 0.66, 0.22, 0.56));
    b.group({ p: [1.28, 0.3, 0.55], r: [0.12, 1.2, 0.2] }, () => bag(b, 0.66, 0.22, 0.54));
  }
  plank(b, 'wood', 0.82, 0.03, 0.5, { p: [0, 0.82, -1.3], c: WOODS[2] }); // the sill of the notch
  // an ammunition can, its lid open; brass
  b.group({ p: [v ? -0.7 : 0.8, 0, -0.72], r: [0, v ? 0.5 : -0.3, 0] }, () => {
    b.box('olive', 0.3, 0.18, 0.15, { p: [0, 0.09, 0] });
    b.box('olive', 0.3, 0.015, 0.15, { p: [0, 0.2, 0.11], r: [-1.0, 0, 0] });
    b.box('dark', 0.26, 0.004, 0.11, { p: [0, 0.181, 0] });
    label(b, 'labels', 'ammo_762', 0.24, 0.12, [0, 0.09, -0.077], 'z-');
  });
  for (let k = 0; k < 6; k++) b.cyl('paint', 0.006, 0.006, 0.05, 3, { p: [rr(r, -0.6, 0.6), 0.006, rr(r, -0.9, -0.3)], r: [PI / 2, r() * PI, 0], order: 'YXZ', c: [0.6, 0.48, 0.2] });
  // the tarp: over the top of a side wall and down its inner face, torn
  const tx = v ? -1 : 1;
  drape(b, 'canvas_mil', (u, t) => {
    const z = -0.5 + t * 1.5, s = u * 1.5; // s: metres from its outer edge, over the wall and down
    return s < 0.62 ? [tx * (2.09 - s), 1.235 + 0.01 * Math.sin(t * 7), z] : [tx * (1.47 - 0.02 * Math.sin(t * 5 + u * 3)), 1.235 - (s - 0.62) * (0.7 + 0.3 * t), z];
  }, 5, 3);
  sheet(b, 'canvas_mil', [[tx * 1.47, 1.23, 1.0], [tx * 1.45, 0.5, 1.15], [tx * 1.46, 0.85, 1.4], [tx * 1.47, 1.23, 1.3]], [-tx, 0, 0]);
};

// Triple concertina: two coils on the ground and one on top of them, strung along X between pickets, rags in it.
STREET_VARIANTS.concertina = 1;
STREET_PROPS.concertina = (b, r) => {
  const x0 = -2.9, x1 = 2.9, turns = 9;
  for (let k = 0; k < 5; k++) b.box('rust', 0.045, 0.9, 0.045, { p: [x0 + (k * (x1 - x0)) / 4, 0.44, k % 2 ? 0.02 : -0.02], r: [0, 0.3, 0] });
  b.cylBetween('wire', [x0, 0.845, 0], [x1, 0.845, 0], 0.005, 0.005, 3);
  b.cylBetween('wire', [x0, 0.46, 0], [x1, 0.46, 0], 0.005, 0.005, 3);
  // a coil: a helix round (cy, cz), a little out of true; barbs on it as short cross pieces
  const coil = (cy, cz, R, phase) => {
    const pts = [], n = turns * 8;
    for (let k = 0; k <= n; k++) {
      const t = k / n, a = t * turns * PI * 2 + phase, rad = R * (1 - 0.06 * (0.5 + 0.5 * Math.sin(t * 23 + phase)));
      pts.push([x0 + t * (x1 - x0), cy + Math.sin(a) * rad, cz + Math.cos(a) * rad]);
    }
    b.tube('wire', pts, 0.007, turns * 7, 3);
    for (let k = 1; k < n; k += 3) {
      const [x, y, z] = pts[k], a = r() * PI, c = Math.cos(a) * 0.006, s = Math.sin(a) * 0.006, d = 0.024;
      sheet(b, 'wire', [[x - d, y - c, z - s], [x + d, y - c, z - s], [x + d * 0.5, y + c, z + s], [x - d * 0.5, y + c, z + s]], [0, 1, 0], {}, true);
    }
  };
  coil(0.235, -0.21, 0.215, 0);
  coil(0.235, 0.21, 0.215, 2.1);
  coil(0.6, 0, 0.22, 4.0);
  for (const [x, y, z, c] of [[-1.7, 0.66, 0.16, [0.36, 0.34, 0.3]], [0.6, 0.4, -0.36, [0.3, 0.2, 0.16]], [2.1, 0.74, -0.08, [0.26, 0.28, 0.3]]])
    sheet(b, 'cloth', [[x, y, z], [x + 0.2, y - 0.03, z + 0.03], [x + 0.16, y - 0.3, z + 0.02], [x + 0.03, y - 0.22, z - 0.02]], [0, 0, 1], { c });
};

// A diesel light tower on its trailer: the generator's housing behind the mast, outriggers down, the mast run up
// with four floodlights on its bar, all dead and two of them smashed; the hitch (-Z) on its jockey wheel.
STREET_VARIANTS.floodlight_tower = 1;
STREET_PROPS.floodlight_tower = (b, r) => {
  const yel = [0.68, 0.54, 0.12], w = worn(0.3, 0.6);
  b.box('rust', 1.0, 0.08, 1.56, { p: [0, 0.36, 0.38] });
  // the housing: louvres each side, a door and its handle, the panel at the back, the exhaust
  b.box('paint', 1.0, 0.72, 1.02, { p: [0, 0.76, 0.65], c: yel, cfn: w });
  b.box('paint', 1.04, 0.05, 1.06, { p: [0, 1.14, 0.65], c: mul(yel, 0.9), cfn: w });
  for (const sx of [-1, 1]) {
    b.box('dark', 0.012, 0.3, 0.5, { p: [sx * 0.502, 0.86, 0.82] });
    for (let k = 0; k < 2; k++) b.box('paint', 0.02, 0.03, 0.5, { p: [sx * 0.508, 0.81 + k * 0.1, 0.82], c: yel, cfn: w });
    b.box('paint', 0.28, 0.03, 0.66, { p: [sx * 0.63, 0.6, 0.6], c: yel, cfn: w }); // mudguards
    b.group({ p: [sx * 0.66, 0.28, 0.6] }, () => roadWheel(b, 0.28, 0.17, { flat: sx > 0 ? 0.3 : 0.04, seg: 8, hub: false }));
    // outriggers: an arm out and a jack leg down, front and back
    for (const z of [-0.3, 1.1]) {
      b.box('rust', 0.3, 0.05, 0.05, { p: [sx * 0.61, 0.36, z] });
      b.box('steel', 0.04, 0.4, 0.04, { p: [sx * 0.74, 0.19, z] });
    }
  }
  b.box('dark', 0.5, 0.3, 0.012, { p: [0.1, 0.84, 1.162] });
  b.box('chrome', 0.03, 0.1, 0.03, { p: [-0.515, 0.8, 0.4] });
  b.cyl('rust', 0.03, 0.03, 0.12, 5, { p: [0.3, 1.22, 0.95] });
  b.box('rust', 0.012, rr(r, 0.2, 0.4), rr(r, 0.3, 0.6), { p: [0.503, 0.52, 0.4] });
  // the drawbar, its coupling, the jockey wheel
  b.beam('rust', [0, 0.36, -0.4], [0, 0.4, -1.1], 0.08, 0.06);
  b.box('rust', 0.1, 0.07, 0.12, { p: [0, 0.42, -1.13] });
  b.cyl('steel', 0.02, 0.02, 0.5, 4, { p: [0.06, 0.36, -0.8] });
  b.cyl('rubber', 0.09, 0.09, 0.05, 8, { p: [0.06, 0.09, -0.8], r: [0, 0, PI / 2] });
  // the mast in three sections, its foot and winch, the cable down it
  b.box('rust', 0.3, 0.26, 0.26, { p: [0, 0.52, 0] });
  b.cyl('steel', 0.075, 0.075, 1.9, 6, { p: [0, 1.35, 0] });
  b.cyl('steel', 0.058, 0.058, 1.4, 6, { p: [0, 3.0, 0] });
  b.cyl('steel', 0.042, 0.042, 1.07, 6, { p: [0, 4.22, 0] });
  b.box('rust', 0.14, 0.14, 0.12, { p: [0.1, 1.0, -0.06] });
  b.tube('rubber', [[0.04, 4.6, 0.05], [-0.07, 3.6, 0.06], [0.08, 2.5, -0.04], [-0.06, 1.6, 0.09], [0, 1.16, 0.3]], 0.012, 5, 3);
  // the bar and its four heads: dull lenses on two, black holes on two, one of those hanging by its cable
  b.box('steel', 1.5, 0.05, 0.05, { p: [0, 4.75, 0] });
  [-0.6, -0.2, 0.2, 0.6].forEach((x, k) => {
    const hang = k === 2;
    b.group({ p: [x, hang ? 4.58 : 4.93, hang ? -0.06 : 0], r: hang ? [1.3, 0.3, 0.5] : [-0.45 - (k - 1) * 0.08, (k - 1.5) * -0.12, 0] }, () => {
      b.box('paint', 0.34, 0.26, 0.12, { c: yel, cfn: w });
      b.box(k === 0 || hang ? 'dark' : 'glass', 0.3, 0.22, 0.012, { p: [0, 0, -0.064] });
    });
    if (!hang) b.box('steel', 0.04, 0.12, 0.04, { p: [x, 4.82, 0.02] });
  });
  weeds(b, r, [[0.2, 0.2], [-0.2, 0.8]], 0.5);
};

// A checkpoint's sign: two plywood boards hinged at the top to stand as an A, a hazard border and a stencilled
// panel on the front one, shot at; a sandbag over each foot.
STREET_VARIANTS.checkpoint_sign = 2;
STREET_PROPS.checkpoint_sign = (b, r, v) => {
  const th = Math.atan2(0.23, 1.55), ply = [0.66, 0.6, 0.46], yel = [0.7, 0.58, 0.12];
  for (const sz of [-1, 1]) {
    // (a board in its own frame: its feet at the origin, leaning in to the hinge; its face to sz)
    b.group({ p: [0, 0, sz * 0.25], r: [-sz * th, 0, 0] }, () => {
      for (const sx of [-1, 1]) plank(b, 'wood', 0.07, 1.57, 0.045, { p: [sx * 0.56, 0.785, 0], c: WOODS[4] });
      plank(b, 'wood', 1.05, 0.07, 0.045, { p: [0, 0.12, 0], c: WOODS[4] });
      b.box('wood', 1.24, 1.15, 0.018, { p: [0, 0.92, sz * 0.032], c: ply, r: [0, 0, v && sz > 0 ? 0.03 : 0] });
      const z = sz * 0.0435, n = [0, 0, sz];
      if (sz > 0) {
        label(b, 'labels', v ? 'hazard_small' : 'hazard', 0.6, 0.6, [0, 0.95, z + 0.002], 'z+');
        return;
      }
      for (const y of [0.39, 1.45]) {
        b.box('paint', 1.24, 0.09, 0.004, { p: [0, y, z], c: yel });
        for (let k = 0; k < 5; k++) {
          const x = -0.6 + k * 0.25;
          sheet(b, 'dark', [[x, y - 0.045, z - 0.003], [x + 0.1, y - 0.045, z - 0.003], [x + 0.17, y + 0.045, z - 0.003], [x + 0.07, y + 0.045, z - 0.003]], n);
        }
      }
      for (const sx of [-1, 1]) {
        b.box('paint', 0.09, 0.97, 0.004, { p: [sx * 0.575, 0.92, z], c: yel });
        for (let k = 0; k < 4; k++) {
          const x = sx * 0.575, y = 0.46 + k * 0.24;
          sheet(b, 'dark', [[x - 0.045, y, z - 0.003], [x + 0.045, y + 0.07, z - 0.003], [x + 0.045, y + 0.17, z - 0.003], [x - 0.045, y + 0.1, z - 0.003]], n);
        }
      }
      if (v) label(b, 'labels', 'hazard', 0.72, 0.72, [0, 0.92, z - 0.002], 'z-');
      else {
        label(b, 'labels', 'hazard_small', 0.3, 0.3, [0, 1.2, z - 0.002], 'z-');
        label(b, 'stencil', 'army', 0.96, 0.48, [0, 0.76, z - 0.002], 'z-');
      }
      for (let k = 0; k < 5; k++) label(b, 'stencil', 'bullet', 0.07, 0.07, [rr(r, -0.45, 0.45), rr(r, 0.55, 1.3), z - 0.005], 'z-');
    });
  }
  b.box('rust', 1.0, 0.03, 0.06, { p: [0, 1.535, 0] }); // the hinge
  b.cylBetween('wire', [0.5, 0.6, -0.16], [0.5, 0.58, 0.16], 0.005, 0.005, 3);
  b.group({ p: [-0.28, 0.09, -0.27], r: [0, 0.05, 0] }, () => bag(b, 0.56, 0.17, 0.28));
  b.group({ p: [0.25, 0.09, 0.27], r: [0, -0.05, 0] }, () => bag(b, 0.56, 0.17, 0.28));
  if (v) b.group({ p: [0.3, 0.09, -0.27], r: [0, -0.1, 0] }, () => bag(b, 0.5, 0.17, 0.28));
};

// A czech hedgehog: three lengths of I-beam welded across one another, standing on three of its six ends.
STREET_VARIANTS.tank_trap = 1;
STREET_PROPS.tank_trap = (b, r) => {
  const L = 1.8, el = 0.72; // a beam's length, and how steeply it stands
  for (let k = 0; k < 3; k++) {
    b.group({ p: [0, 0.655, 0], r: [0, (k * PI * 2) / 3 + 0.2, el], order: 'YXZ' }, () => {
      b.box('rust', L, 0.14, 0.012, { p: [0, 0, 0.075] });
      for (const sy of [-1, 1]) b.box('rust', L, 0.012, 0.12, { p: [0, sy * 0.07, 0.075] });
    });
  }
  for (const a of [0.4, 2.5]) b.box('rust', 0.3, 0.3, 0.014, { p: [0, 0.655, 0], r: [0.6, a, 0.4] }); // gussets at the weld
  weeds(b, r, [[0.1, 0.1], [-0.2, -0.15]], 0.4);
};

// A frame medical tent, both ends open: steel frames and a ridge, white canvas sagging between them on the roof and
// down the walls, a red cross on each wall and gable, one roof panel torn and hanging in, ropes and pegs along the
// walls, a dead string of lamps under the ridge, stains.
STREET_VARIANTS.triage_tent = 2;
STREET_PROPS.triage_tent = (b, r, v) => {
  const xe = 2.44, xf = 2.41, ye = 2.0, yr = 2.8, fz = [-3.4, -1.7, 0, 1.7, 3.4];
  for (const z of fz) {
    for (const sx of [-1, 1]) {
      b.box('steel', 0.05, ye, 0.05, { p: [sx * xf, ye / 2, z] });
      b.beam('steel', [sx * xf, ye, z], [0, yr - 0.02, z], 0.05, 0.05);
    }
  }
  b.box('steel', 0.05, 0.05, 6.85, { p: [0, yr - 0.02, 0] });
  for (const sx of [-1, 1]) b.box('steel', 0.05, 0.05, 6.85, { p: [sx * xf, ye, 0] });
  const torn = v ? [-1, 1] : [1, 2]; // [side, bay] of the roof panel that has gone
  for (let k = 0; k < 4; k++) {
    const za = k ? fz[k] : -3.45, zb = k < 3 ? fz[k + 1] : 3.45;
    for (const sx of [-1, 1]) {
      const sag = rr(r, 0.06, 0.12), bulge = rr(r, -0.03, 0.03);
      if (!(sx === torn[0] && k === torn[1]))
        drape(b, 'canvas', (u, t) => [sx * xe * (1 - u), ye + 0.02 + (yr + 0.03 - ye - 0.02) * u - sag * Math.sin(u * PI) * Math.sin(t * PI), za + t * (zb - za)], 3, 2);
      if (!(v && sx > 0 && k === 3))
        drape(b, 'canvas', (u, t) => [sx * (xe + bulge * Math.sin(u * PI) * Math.sin(t * PI)), ye + 0.02 - u * (ye - 0.01), za + t * (zb - za)], 2, 2);
      else {
        // (this wall panel rolled up under the eave)
        b.cyl('canvas', 0.07, 0.07, zb - za - 0.1, 6, { p: [sx * (xe - 0.06), ye - 0.08, (za + zb) / 2], r: [PI / 2, 0, 0] });
      }
    }
  }
  // what is left of the torn panel: a strip still on the ridge, another hanging in from the eave
  {
    const [sx, k] = torn, za = fz[k], zb = fz[k + 1];
    sheet(b, 'canvas', [[0, yr + 0.02, za], [0, yr + 0.02, zb], [sx * 0.5, yr - 0.16, zb - 0.1], [sx * 0.35, yr - 0.4, za + 0.7], [sx * 0.6, yr - 0.2, za + 0.2]], [0, 1, 0]);
    sheet(b, 'canvas', [[sx * xe, ye + 0.02, za + 0.1], [sx * xe, ye + 0.02, zb - 0.2], [sx * (xe - 0.25), ye - 0.9, zb - 0.5], [sx * (xe - 0.12), ye - 0.5, za + 0.4]], [-sx, 0, 0]);
  }
  for (const sz of [-1, 1]) {
    sheet(b, 'canvas', [[-xe, ye + 0.02, sz * 3.45], [xe, ye + 0.02, sz * 3.45], [0, yr + 0.03, sz * 3.45]], [0, 0, sz]);
    label(b, 'labels', 'cross_mark', 0.44, 0.44, [0, 2.3, sz * 3.47], sz < 0 ? 'z-' : 'z+');
  }
  for (const sx of [-1, 1]) {
    for (const z of [-2.55, 0.85]) label(b, 'labels', 'cross_mark', 0.8, 0.8, [sx * (xe + 0.036), 1.25, z], sx < 0 ? 'x-' : 'x+');
    // guy ropes down the wall line to their pegs
    for (const [z, dz] of [[-3.4, 0.6], [0, -0.6], [3.4, -0.6]]) {
      b.cylBetween('rope', [sx * 2.46, ye, z], [sx * 2.47, 0.08, z + dz], 0.008, 0.008, 3);
      b.box('rust', 0.03, 0.26, 0.03, { p: [sx * 2.47, 0.115, z + dz * 1.02], r: [dz > 0 ? -0.3 : 0.3, 0, 0] });
    }
    // damp coming up the walls
    for (let k = 0; k < 2; k++) {
      const z = rr(r, -3, 2), h = rr(r, 0.25, 0.6), L = rr(r, 0.6, 1.2);
      sheet(b, 'cloth', [[sx * (xe + 0.034), 0.03, z], [sx * (xe + 0.034), 0.03, z + L], [sx * (xe + 0.034), h, z + L * 0.7], [sx * (xe + 0.034), h * 0.8, z + L * 0.2]], [sx, 0, 0], { c: [0.3, 0.3, 0.24] });
    }
  }
  b.plane('blood_decal', 1.3, 1.3, { raw: true, p: [v ? 0.6 : -0.7, 0.012, v ? 1.2 : -1.0], r: [-PI / 2, 0, r() * 3], order: 'YXZ' });
  b.plane('blood_decal', 0.9, 0.9, { raw: true, p: [(v ? -1 : 1) * (xe - 0.045), 0.75, v ? -0.8 : 1.9], r: [0, (v ? 1 : -1) * (PI / 2), 0] });
  // the string of lamps along the ridge
  b.tube('rubber', [[0, yr - 0.07, -3.3], [0.02, yr - 0.2, -1.7], [0, yr - 0.1, 0], [-0.02, yr - 0.24, 1.6], [0, yr - 0.07, 3.3]], 0.008, 8, 3);
  for (const z of [-1.7, 1.6]) b.cyl(z < 0 ? 'glass' : 'dark', 0.045, 0.03, 0.1, 5, { p: [z < 0 ? 0.02 : -0.02, yr - 0.3, z] });
  weeds(b, r, [[-1.6, -2.4], [1.2, 2.6]], 0.4);
};

// An army folding cot: two rails on three crossed pairs of legs, canvas between. With a blanket left on it; with
// somebody under a sheet; tipped over on its side.
function cot(b) {
  for (const sx of [-1, 1]) plank(b, 'wood', 0.035, 0.035, 1.9, { p: [sx * 0.32, 0.36, 0], c: [0.5, 0.5, 0.4] });
  for (const z of [-0.8, 0, 0.8]) {
    b.beam('steel', [-0.32, 0.345, z - 0.014], [0.28, 0.0, z - 0.014], 0.025, 0.025);
    b.beam('steel', [0.32, 0.345, z + 0.014], [-0.28, 0.0, z + 0.014], 0.025, 0.025);
  }
  for (const sz of [-1, 1]) b.box('steel', 0.64, 0.03, 0.03, { p: [0, 0.36, sz * 0.93] });
  drape(b, 'canvas_mil', (u, t) => [-0.31 + u * 0.62, 0.372 - 0.03 * Math.sin(u * PI) * Math.sin(t * PI), -0.92 + t * 1.84], 2, 4);
}
STREET_VARIANTS.field_cot = 3;
STREET_PROPS.field_cot = (b, r, v) => {
  const blanket = [0.34, 0.36, 0.3];
  if (v === 0) {
    cot(b);
    b.box('cloth', 0.68, 0.02, 0.9, { p: [0.01, 0.376, 0.42], r: [0, 0.04, 0], c: blanket, cfn: worn(0.5, 0, [0.2, 0.14, 0.1]) });
    b.box('cloth', 0.015, 0.24, 0.8, { p: [0.348, 0.265, 0.44], c: blanket, cfn: worn(0.5, 0, [0.2, 0.14, 0.1]) });
    b.box('cloth', 0.4, 0.07, 0.25, { p: [0, 0.385, -0.74], r: [0, -0.1, 0], c: [0.56, 0.54, 0.48] });
    b.plane('blood_decal', 0.42, 0.42, { raw: true, p: [-0.05, 0.36, -0.25], r: [-PI / 2, 0, 0.7], order: 'YXZ' });
  } else if (v === 1) {
    cot(b);
    // the body under its sheet, head to -Z
    const prof = (t) => { const a = t * PI * 2, s = Math.sin(a); return [Math.cos(a), s > 0 ? s : s * 0.08]; };
    const secs = [[-0.87, 0.14, 0.04], [-0.82, 0.24, 0.32], [-0.7, 0.26, 0.36], [-0.56, 0.3, 0.22], [-0.42, 0.56, 0.34], [-0.1, 0.52, 0.36], [0.25, 0.46, 0.28], [0.6, 0.4, 0.22], [0.8, 0.34, 0.32], [0.9, 0.3, 0.06]].map(([z, w, h]) => ({ z, w, h, y: 0.365 }));
    const stain = (x, y, z, c) => { const k = Math.max(0, 1 - Math.hypot(x - 0.05, (z + 0.1) * 0.6) / 0.3) * 0.7; c.r += (0.3 - c.r) * k; c.g += (0.12 - c.g) * k; c.b += (0.1 - c.b) * k; return c; };
    b.loft('cloth', secs, prof, 8, { c: [0.6, 0.58, 0.52], cfn: stain, flip: true });
    for (const sec of [secs[0], secs[secs.length - 1]]) {
      const ring = [];
      for (let k = 0; k < 8; k++) { const [px, py] = prof(k / 8); ring.push([px * sec.w * 0.5, py * sec.h * 0.5 + sec.y, sec.z]); }
      sheet(b, 'cloth', ring, [0, 0, sec.z], { c: [0.6, 0.58, 0.52] });
    }
    sheet(b, 'cloth', [[0.28, 0.37, -0.3], [0.28, 0.37, 0.5], [0.345, 0.16, 0.42], [0.34, 0.22, -0.2]], [1, 0, 0], { c: [0.56, 0.54, 0.48] });
  } else {
    // over on its side: lying on a rail and the feet of that side
    const th = -Math.atan2(0.3425, 0.0575), c = Math.cos(th), s = Math.sin(th);
    const y0 = Math.min(0.29 * s, 0.3375 * s + 0.3425 * c); // its lowest corners, turned
    b.group({ p: [-0.28, -y0 + 0.004, 0], r: [0, 0, th] }, () => cot(b));
    b.box('cloth', 0.16, 0.05, 0.8, { p: [0.25, 0.025, 0.2], r: [0, 0.06, 0], c: blanket, cfn: worn(0.5, 0, [0.2, 0.14, 0.1]) });
    b.box('cloth', 0.2, 0.06, 0.2, { p: [0.25, 0.03, -0.62], r: [0, -0.2, 0], c: [0.56, 0.54, 0.48] });
  }
};

// An IV pole on its wheeled foot, an empty bag still hung on it, the line trailing. The second one knocked over.
STREET_VARIANTS.iv_stand = 2;
STREET_PROPS.iv_stand = (b, r, v) => {
  const stand = () => {
    for (const a of [PI / 4, -PI / 4]) b.box('steel', 0.46, 0.02, 0.03, { p: [0, 0.06, 0], r: [0, a, 0] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('rubber', 0.025, 0.025, 0.02, 5, { p: [sx * 0.163, 0.025, sz * 0.163], r: [0, sx * sz * (PI / 4), PI / 2], order: 'YXZ' });
    b.cyl('chrome', 0.011, 0.011, 1.66, 5, { p: [0, 0.89, 0] });
    b.box('chrome', 0.22, 0.012, 0.012, { p: [0, 1.72, 0] });
  };
  if (!v) {
    stand();
    b.box('glass', 0.11, 0.2, 0.012, { p: [0.1, 1.61, 0], r: [0, 0.3, 0.05] });
    b.tube('rubber', [[0.1, 1.51, 0], [0.11, 1.1, 0.02], [0.07, 0.6, 0.05], [0.12, 0.3, 0.02], [0.16, 0.42, -0.03]], 0.004, 5, 3);
    b.box('plastic', 0.02, 0.05, 0.02, { p: [0.105, 1.3, 0.01] });
  } else {
    // down along +Z: on two wheels of its foot and the end of its bar
    const tilt = 0.108;
    b.group({ p: [0, 0.196, -0.85], r: [PI / 2 + tilt, 0, 0] }, stand);
    b.box('glass', 0.11, 0.012, 0.2, { p: [0.14, 0.008, 0.62], r: [0, 0.5, 0] });
    b.tube('rubber', [[0.1, 0.02, 0.85], [0.13, 0.008, 0.7], [0.2, 0.006, 0.4], [0.12, 0.006, 0.1], [0.18, 0.006, -0.1]], 0.004, 5, 3);
    b.box('plastic', 0.02, 0.02, 0.05, { p: [0.2, 0.01, 0.4] });
  }
};

