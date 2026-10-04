// What is in the rooms of Port Calder (shared/props-interior.js): the furniture of flats, shops, offices, the
// hospital, the police station and the picture house, as it was left. Builders as in props.js: (b, r, v) with b a
// MeshBuilder, r a seeded rng, v the variant; origin at floor centre of the footprint, front to -Z.
import * as THREE from 'three';
import { rr, pick, WOODS, wheel, label, weeds, plank } from './props.js';

const PI = Math.PI;

export const INTERIOR_VARIANTS = {
  sofa: 3, armchair: 2, kitchen_counter: 2, stove: 2, kitchen_table: 2, tv_set: 2, bookshelf: 2, wardrobe: 2, dresser: 2, double_bed: 3,
  bathtub: 2, toilet: 1, rug: 3, blood_pool: 3, ceiling_debris: 3, ceiling_lamp: 3,
  shop_gondola: 3, checkout_counter: 2, display_fridge: 2, vending_machine: 2, stock_spill: 3,
  office_desk: 3, office_chair: 2, filing_cabinet: 2, paper_scatter: 3, reception_desk: 2, waiting_chairs: 2, cell_bars: 1, cell_bunk: 2,
  hospital_bed: 3, privacy_curtain: 2, gurney: 2, medical_cart: 1, cinema_seats: 2, turnstiles: 1, door_barricade: 2,
};
export const INTERIOR_PROPS = {};

// ------------------------------------------------------------------ shared parts
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const _eu = new THREE.Euler(), _pt = new THREE.Vector3();

/** a closed solid of stacked rectangles, bottom to top: rings [[w, d, y, cx = 0, cz = 0], ...] */
function stack(b, mat, rings, o = {}) {
  const verts = [], faces = [[0, 1, 2], [0, 2, 3]];
  for (const [w, d, y, cx = 0, cz = 0] of rings) verts.push([cx - w / 2, y, cz - d / 2], [cx + w / 2, y, cz - d / 2], [cx + w / 2, y, cz + d / 2], [cx - w / 2, y, cz + d / 2]);
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, L = k * 4, U = L + 4;
      faces.push([L + i, U + i, U + j], [L + i, U + j, L + j]);
    }
  const T = (rings.length - 1) * 4;
  faces.push([T, T + 3, T + 2], [T, T + 2, T + 1]);
  return b.poly(mat, verts, faces, o);
}

/** how far below their origin a set of points reaches once turned by rot */
function reach(pts, rot, order = 'XYZ') {
  _eu.set(rot[0], rot[1], rot[2], order);
  let lo = Infinity;
  for (const p of pts) lo = Math.min(lo, _pt.set(p[0], p[1], p[2]).applyEuler(_eu).y);
  return -lo;
}
const restY = (sx, sy, sz, rot, order) => reach([0, 1, 2, 3, 4, 5, 6, 7].map((k) => [(k & 1 ? 0.5 : -0.5) * sx, (k & 2 ? 0.5 : -0.5) * sy, (k & 4 ? 0.5 : -0.5) * sz]), rot, order);
/** a box lying on the surface at height y, however it is turned: its lowest corner touches */
function lay(b, mat, sx, sy, sz, x, y, z, rot = [0, 0, 0], o = {}) {
  return b.box(mat, sx, sy, sz, { ...o, p: [x, y + restY(sx, sy, sz, rot, o.order), z], r: rot });
}

/** a broken sheet: the convex outline pts [[x, z], ...] (clockwise seen from above), t thick, lying on y however turned */
function plate(b, mat, pts, t, x, y, z, rot = [0, 0, 0], o = {}) {
  const n = pts.length, verts = [], faces = [];
  for (const [px, pz] of pts) verts.push([px, t / 2, pz]);
  for (const [px, pz] of pts) verts.push([px, -t / 2, pz]);
  for (let i = 1; i < n - 1; i++) faces.push([0, i, i + 1], [n, n + i + 1, n + i]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, n + i, n + j], [i, n + j, j]);
  }
  return b.poly(mat, verts, faces, { ...o, p: [x, y + reach(verts, rot, o.order), z], r: rot });
}
/** a ragged outline for plate(): n corners round a w by d oval */
function ragged(r, n, w, d) {
  const out = [], a0 = r() * PI * 2;
  for (let k = 0; k < n; k++) {
    const a = a0 - ((k + rr(r, -0.25, 0.25)) / n) * PI * 2, m = rr(r, 0.7, 1);
    out.push([(Math.cos(a) * w * m) / 2, (Math.sin(a) * d * m) / 2]);
  }
  return out;
}

/** a draped sheet: an nx by nz grid through fn(u, v) -> [x, y, z] (u along +X and v along +Z for the top to face up) */
function sheet(b, mat, nx, nz, fn, o = {}) {
  const verts = [], faces = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) verts.push(fn(i / nx, j / nz, i, j));
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, c = a + nx + 1;
      faces.push([a, c, a + 1], [a + 1, c, c + 1]);
    }
  return b.poly(mat, verts, faces, o);
}

/** a point of the rounded plan (a superellipse, half-axes a by c, exponent n) at angle f */
function planAt(f, a, c, n) {
  const cs = Math.cos(f), sn = Math.sin(f), e = 2 / n;
  return [Math.sign(cs) * Math.abs(cs) ** e * a, Math.sign(sn) * Math.abs(sn) ** e * c];
}
/**
 * a smooth shell turned on a rounded plan: prof [[inset, y, colour?], ...] runs from the underside up the outside,
 * over the rim and down the inside; the first and last rings are closed across, so the shell is closed.
 */
function bowl(b, mat, prof, seg, a, c, n, o = {}) {
  const pos = [], col = [], uv = [], idx = [];
  const K = prof.length, base = o.c || [1, 1, 1];
  let run = 0;
  for (let k = 0; k < K; k++) {
    const [d, y, cc = base] = prof[k];
    if (k) run += Math.hypot(d - prof[k - 1][0], y - prof[k - 1][1]);
    for (let i = 0; i <= seg; i++) {
      const [x, z] = planAt(((i % seg) / seg) * PI * 2, Math.max(0, a - d), Math.max(0, c - d), n);
      pos.push(x, y, z);
      col.push(cc[0], cc[1], cc[2]);
      uv.push((i / seg) * PI * (a + c), run);
    }
  }
  const at = (k, i) => k * (seg + 1) + i;
  for (let k = 0; k < K - 1; k++) for (let i = 0; i < seg; i++) idx.push(at(k, i), at(k + 1, i), at(k + 1, i + 1), at(k, i), at(k + 1, i + 1), at(k, i + 1));
  const c0 = pos.length / 3;
  for (const k of [0, K - 1]) {
    pos.push(0, prof[k][1], 0);
    col.push(...(prof[k][2] || base));
    uv.push(0, 0);
  }
  for (let i = 0; i < seg; i++) idx.push(c0, at(0, i), at(0, i + 1), c0 + 1, at(K - 1, i + 1), at(K - 1, i));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nr = g.attributes.normal;
  for (let k = 0; k < K; k++) {
    // (the seam: one normal for the two vertices that meet there)
    const i0 = at(k, 0), i1 = at(k, seg);
    _pt.set(nr.getX(i0) + nr.getX(i1), nr.getY(i0) + nr.getY(i1), nr.getZ(i0) + nr.getZ(i1)).normalize();
    nr.setXYZ(i0, _pt.x, _pt.y, _pt.z);
    nr.setXYZ(i1, _pt.x, _pt.y, _pt.z);
  }
  return b.add(mat, g, { ...o, keepColor: true });
}

const TINS = [[0.62, 0.2, 0.14], [0.75, 0.68, 0.3], [0.3, 0.42, 0.3], [0.78, 0.76, 0.7], [0.25, 0.33, 0.5], [0.5, 0.5, 0.48]];
/** a tin standing on y, or lying on its side there */
function tin(b, r, x, y, z, lie = false, seg = 6, R = 0.036, h = 0.11, c = pick(r, TINS)) {
  if (!lie) return b.cyl('paint', R, R, h, seg, { p: [x, y + h / 2, z], r: [0, r() * PI, 0], c });
  let lo = 0;
  for (let k = 0; k < seg; k++) lo = Math.min(lo, Math.sin((k / seg) * PI * 2));
  return b.cyl('paint', R, R, h, seg, { p: [x, y - lo * R, z], r: [0, r() * PI, PI / 2], order: 'YXZ', c });
}
/** a bottle (body and neck) standing on y, or lying there */
function bottle(b, r, x, y, z, lie = false, mat = 'bottle', h = 0.24, R = 0.033) {
  b.group(lie ? { p: [x, y + R * 0.866, z], r: [0, r() * PI * 2, PI / 2], order: 'YXZ' } : { p: [x, y, z] }, () => {
    b.cyl(mat, R, R, h * 0.62, 6, { p: [0, h * 0.31, 0] });
    b.cyl(mat, R * 0.36, R * 0.9, h * 0.38, 5, { p: [0, h * 0.81, 0] });
  });
}

/** a drawer where it has been pulled to: its front (w by h, facing -Z) at the origin, the box of it running back len */
function drawer(b, mat, w, h, len, c, pull = 'chrome') {
  const dim = mul(c, 0.62);
  b.box(mat, w, h, 0.02, { c });
  if (len > 0) {
    for (const sx of [-1, 1]) b.box(mat, 0.012, h - 0.05, len, { p: [sx * (w / 2 - 0.012), -0.01, 0.01 + len / 2], c: dim });
    b.box(mat, w - 0.03, 0.008, len, { p: [0, -h / 2 + 0.02, 0.01 + len / 2], c: dim });
  }
  if (pull) b.box(pull, Math.min(0.14, w * 0.4), 0.014, 0.022, { p: [0, 0.01, -0.021] });
}

/** a cushion: a slab with its edges turned in, centred on its middle */
function cushion(b, w, h, d, c, o = {}) {
  const i = 0.06, e = Math.min(0.03, h / 3);
  return stack(b, 'cloth', [[w - i, d - i, -h / 2], [w, d, -h / 2 + e], [w, d, h / 2 - e], [w - i, d - i, h / 2]], { ...o, c });
}

// ================================================================== homes
const FABRICS = [[0.44, 0.34, 0.27], [0.3, 0.37, 0.33], [0.5, 0.46, 0.38], [0.4, 0.22, 0.2]];
const STUFFING = [0.8, 0.77, 0.68];

/**
 * an upholstered seat W wide for n: feet, a base, arms, a back, loose seat and back cushions. st.seat[k]: 'ok', 'cut'
 * (slashed, the stuffing out), 'up' (pulled up against the back), 'fell' (for a sofa on its back) or '' (gone);
 * st.back[k]: there or not.
 */
function couch(b, r, W, n, col, st) {
  const D = 0.84, aw = W > 1.2 ? 0.2 : 0.17, sw = W - aw * 2, deck = 0.28;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.06, 0.06, 0.06, { p: [sx * (W / 2 - 0.07), 0.03, sz * (D / 2 - 0.07)], c: mul(WOODS[4], 0.6) });
  b.box('cloth', W - 0.03, deck - 0.06, D - 0.03, { p: [0, (deck + 0.06) / 2, 0], c: mul(col, 0.8) });
  for (const sx of [-1, 1]) stack(b, 'cloth', [[aw, D, deck], [aw, D, 0.56], [aw - 0.05, D - 0.04, 0.62]].map(([w, d, y]) => [w, d, y, sx * (W / 2 - aw / 2), 0]), { c: col });
  stack(b, 'cloth', [[sw + 0.02, 0.2, deck, 0, 0.32], [sw + 0.02, 0.2, 0.6, 0, 0.32], [sw + 0.02, 0.13, 0.84, 0, 0.355]], { c: col });
  const cw = sw / n - 0.008, cd = 0.5, ch = 0.15, bh = 0.44, bt = 0.12;
  for (let k = 0; k < n; k++) {
    const x = -sw / 2 + (k + 0.5) * (sw / n), cc = mul(col, rr(r, 0.9, 1.08)), seat = st.seat[k];
    if (seat === 'up') {
      const rot = [-0.6, 0, 0];
      cushion(b, cw, ch, cd, cc, { p: [x, deck + restY(cw, ch, cd, rot), -0.03], r: rot });
    } else if (seat === 'fell') cushion(b, cw, ch, cd, cc, { p: [x, 0.52, 0.02], r: [PI / 2, 0, 0.22], order: 'ZYX' });
    else if (seat) {
      cushion(b, cw, ch, cd, cc, { p: [x, deck + ch / 2, -0.15] });
      const top = deck + ch;
      if (seat === 'cut') {
        b.box('dark', cw * 0.62, 0.004, 0.014, { p: [x, top + 0.001, -0.15], r: [0, 0.5, 0] });
        b.box('dark', cw * 0.4, 0.004, 0.012, { p: [x + 0.04, top + 0.001, -0.2], r: [0, -0.5, 0] });
        b.sphere('cloth', 0.06, 5, 3, { p: [x + 0.02, top + 0.012, -0.13], s: [1.4, 0.5, 1], c: STUFFING });
        b.sphere('cloth', 0.045, 5, 3, { p: [x - 0.1, top + 0.01, -0.2], s: [1.2, 0.5, 1.3], c: STUFFING });
      } else b.plane('cloth', 0.24, 0.18, { p: [x - 0.03, top + 0.002, -0.2], r: [-PI / 2, 0, rr(r, 0, 2)], c: mul(col, 0.5) });
    }
    if (st.back[k]) stack(b, 'cloth', [[cw - 0.06, bt - 0.04, 0], [cw, bt, 0.04], [cw, bt, bh - 0.04], [cw - 0.06, bt - 0.04, bh]], { p: [x, deck, 0.16], r: [0.1, 0, 0], c: cc });
  }
}

// A three-seater. 0, 1: as it stands, a cushion slashed for what might be sewn into it; 2: thrown onto its back.
INTERIOR_PROPS.sofa = (b, r, v) => {
  const W = 1.98;
  if (v < 2) return couch(b, r, W, 3, FABRICS[v], v ? { seat: ['up', 'ok', 'cut'], back: [0, 1, 1] } : { seat: ['ok', 'cut', 'ok'], back: [1, 1, 1] });
  b.group({ p: [0, 0.42, -0.42], r: [PI / 2, 0, 0] }, () => {
    couch(b, r, W, 3, FABRICS[2], { seat: ['', 'fell', ''], back: [1, 1, 0] });
    b.box('dark', W - 0.2, 0.004, 0.64, { p: [0, 0.058, 0] }); // the dust cover under it
  });
};

INTERIOR_PROPS.armchair = (b, r, v) => couch(b, r, 0.86, 1, FABRICS[v ? 1 : 3], v ? { seat: ['up'], back: [0] } : { seat: ['cut'], back: [1] });

// Kitchen base units under a worktop, the sink at the left end: doors gone or ajar on what was not worth taking.
INTERIOR_PROPS.kitchen_counter = (b, r, v) => {
  const col = v ? [0.42, 0.5, 0.46] : [0.74, 0.68, 0.52], dim = mul(col, 0.5), lam = v ? [0.62, 0.6, 0.54] : [0.4, 0.4, 0.38];
  const W = 1.96, zf = -0.21, zb = 0.31, kick = 0.1, top = 0.82, tt = 0.04, t = 0.018;
  const y0 = kick, y1 = top - tt, hy = (y0 + y1) / 2, hh = y1 - y0, D = zb - zf, cz = (zf + zb) / 2, bay = W / 4;
  const bx = (k) => -W / 2 + (k + 0.5) * bay;
  b.box('dark', W - 0.04, kick, D - 0.06, { p: [0, kick / 2, cz + 0.03] });
  b.box('paint', W, hh, t, { p: [0, hy, zb - t / 2], c: dim });
  b.box('paint', W, t, D, { p: [0, y0 + t / 2, cz], c: dim });
  for (let k = 0; k <= 4; k++) b.box('paint', t, hh, D, { p: [-W / 2 + k * bay + (k === 0 ? t / 2 : k === 4 ? -t / 2 : 0), hy, cz], c: k % 4 ? dim : col });
  // the worktop, in four pieces round the sink
  const wz0 = -0.25, wz1 = 0.31, sx0 = bx(0) - 0.19, sx1 = bx(0) + 0.19, sz0 = -0.14, sz1 = 0.2, ty = top - tt / 2;
  b.box('paint', sx0 + 0.995, tt, wz1 - wz0, { p: [(sx0 - 0.995) / 2, ty, (wz0 + wz1) / 2], c: lam });
  b.box('paint', 0.995 - sx1, tt, wz1 - wz0, { p: [(sx1 + 0.995) / 2, ty, (wz0 + wz1) / 2], c: lam });
  b.box('paint', sx1 - sx0, tt, sz0 - wz0, { p: [bx(0), ty, (wz0 + sz0) / 2], c: lam });
  b.box('paint', sx1 - sx0, tt, wz1 - sz1, { p: [bx(0), ty, (sz1 + wz1) / 2], c: lam });
  b.box('paint', 1.99, 0.06, 0.015, { p: [0, top + 0.03, wz1 - 0.0075], c: lam });
  // the sink: a steel bowl let into it, its tap
  const yb = top - 0.17, mid = [bx(0), top, (sz0 + sz1) / 2];
  b.quadOut('steel', [[sx0, yb, sz0], [sx1, yb, sz0], [sx1, yb, sz1], [sx0, yb, sz1]], [mid[0], yb - 1, mid[2]]);
  b.quadOut('steel', [[sx0, yb, sz0], [sx1, yb, sz0], [sx1, top, sz0], [sx0, top, sz0]], [mid[0], top, sz0 - 1]);
  b.quadOut('steel', [[sx0, yb, sz1], [sx1, yb, sz1], [sx1, top, sz1], [sx0, top, sz1]], [mid[0], top, sz1 + 1]);
  b.quadOut('steel', [[sx0, yb, sz0], [sx0, yb, sz1], [sx0, top, sz1], [sx0, top, sz0]], [sx0 - 1, top, mid[2]]);
  b.quadOut('steel', [[sx1, yb, sz0], [sx1, yb, sz1], [sx1, top, sz1], [sx1, top, sz0]], [sx1 + 1, top, mid[2]]);
  b.box('rust', 0.12, 0.003, 0.2, { p: [bx(0) + 0.05, yb + 0.0015, 0.04], r: [0, 0.3, 0] });
  b.cylBetween('chrome', [bx(0), top, 0.255], [bx(0), top + 0.085, 0.255], 0.012, 0.014, 5);
  b.cylBetween('chrome', [bx(0), top + 0.075, 0.255], [bx(0), top + 0.055, 0.1], 0.009, 0.01, 5);
  for (const sx of [-1, 1]) b.box('chrome', 0.035, 0.035, 0.035, { p: [bx(0) + sx * 0.075, top + 0.0175, 0.255], r: [0, 0.4 * sx, 0] });
  // doors and drawers
  const dw = bay - 0.012, dh = hh - 0.012, zd = zf - 0.01;
  const door = (k, ang) =>
    b.group({ p: [bx(k) - dw / 2, hy, zd], r: [0, ang, 0] }, () => {
      b.box('paint', dw, dh, 0.02, { p: [dw / 2, 0, 0], c: mul(col, rr(r, 0.92, 1.05)) });
      b.box('chrome', 0.014, 0.1, 0.02, { p: [dw - 0.05, dh / 2 - 0.12, -0.02] });
    });
  const stock = (k) => {
    // what a missing door shows: a shelf, and what was left on it
    b.box('paint', bay - t, t, D - 0.08, { p: [bx(k), hy, cz + 0.03], c: dim });
    for (const [dx, y, lie] of v ? [[0.08, y0 + t, true]] : [[-0.14, hy + t / 2, false], [-0.04, hy + t / 2, false], [0.1, hy + t / 2, true], [-0.1, y0 + t, true]]) tin(b, r, bx(k) + dx, y, cz + rr(r, -0.1, 0.1), lie, 5);
    if (!v) bottle(b, r, bx(k) + 0.14, y0 + t, cz + 0.08, false, 'bottle_brown');
  };
  const rows = (hh - 0.012) / 3;
  const drw = (k, row, out) => b.group({ p: [bx(k), y0 + 0.006 + (row + 0.5) * rows, zd - out], r: [0, out ? 0.03 : 0, 0] }, () => drawer(b, 'paint', dw, rows - 0.008, out ? 0.4 : 0, mul(col, 1.02)));
  if (v) {
    door(0, 0);
    door(1, 0.12);
    drw(2, 1, 0.055);
    drw(2, 0, 0);
    stock(3);
  } else {
    door(0, 0.12);
    stock(1);
    drw(2, 2, 0.055);
    drw(2, 0, 0);
    door(3, 0);
  }
  // left on the worktop
  b.cyl('paint', 0.11, 0.1, 0.03, 8, { p: [0.3, top + 0.015, 0.02], c: [0.8, 0.79, 0.74] });
  tin(b, r, v ? 0.75 : -0.15, top, 0.1, true);
  for (const x of [0.12, 0.36]) b.box('rust', 0.04 + r() * 0.04, 0.06 + r() * 0.08, 0.004, { p: [x, y0 + 0.06, zf - 0.021] });
};

// An enamel cooker: four rings, the oven door ajar (0) or torn off (1).
INTERIOR_PROPS.stove = (b, r, v) => {
  const col = v ? [0.62, 0.56, 0.42] : [0.82, 0.82, 0.77];
  const W = 0.66, zf = -0.17, zb = 0.32, y0 = 0.04, hob = 0.86, D = zb - zf, cz = (zf + zb) / 2;
  const ov0 = 0.2, ov1 = 0.66, body = hob - 0.03;
  b.box('dark', W - 0.06, y0, D - 0.06, { p: [0, y0 / 2, cz] });
  if (v) {
    // the oven open to the room: its floor, walls and one rack
    b.box('paint', W, ov0 - y0, D, { p: [0, (y0 + ov0) / 2, cz], c: col });
    b.box('paint', W, body - ov1, D, { p: [0, (ov1 + body) / 2, cz], c: col });
    for (const sx of [-1, 1]) b.box('paint', 0.03, ov1 - ov0, D, { p: [sx * (W / 2 - 0.015), (ov0 + ov1) / 2, cz], c: col });
    b.box('paint', W - 0.06, ov1 - ov0, 0.02, { p: [0, (ov0 + ov1) / 2, zb - 0.01], c: [0.12, 0.11, 0.1] });
    b.box('steel', W - 0.06, 0.008, D - 0.08, { p: [0, 0.42, cz + 0.02], r: [0, 0, 0.05] });
  } else {
    b.box('paint', W, body - y0, D, { p: [0, (y0 + body) / 2, cz], c: col });
    b.box('dark', W - 0.1, ov1 - ov0 - 0.06, 0.004, { p: [0, (ov0 + ov1) / 2, zf - 0.002] });
    b.group({ p: [0, ov0, zf - 0.006], r: [-0.18, 0, 0] }, () => {
      const dh = ov1 - ov0 - 0.01;
      b.box('paint', W - 0.02, dh, 0.03, { p: [0, dh / 2, -0.015], c: mul(col, 1.03) });
      b.box('dark', 0.36, 0.2, 0.006, { p: [0, 0.24, -0.032] });
      b.box('chrome', 0.5, 0.02, 0.02, { p: [0, 0.4, -0.06] });
      for (const sx of [-1, 1]) b.box('chrome', 0.02, 0.02, 0.03, { p: [sx * 0.22, 0.4, -0.04] });
    });
  }
  // fascia and knobs, the hob, the splash panel
  b.box('paint', W, 0.14, 0.02, { p: [0, 0.75, zf - 0.01], c: mul(col, 0.94) });
  for (const x of v ? [-0.24, -0.12, 0.24] : [-0.24, -0.12, 0.12, 0.24]) b.cyl('dark', 0.02, 0.024, 0.025, 5, { p: [x, 0.75, zf - 0.0325], r: [PI / 2, 0, 0] });
  b.box('paint', W, 0.03, D, { p: [0, hob - 0.015, cz], c: [0.13, 0.13, 0.13] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) if (!(v && sx > 0 && sz < 0)) b.cyl('rust', sz < 0 ? 0.085 : 0.07, sz < 0 ? 0.085 : 0.07, 0.008, 6, { p: [sx * 0.16, hob + 0.004, cz + sz * 0.12] });
  b.box('paint', W, 0.09, 0.025, { p: [0, hob + 0.045, zb - 0.0125], c: col });
  // a pan left on it, rust creeping up from the floor
  b.cyl('steel', 0.085, 0.075, 0.06, 7, { p: [-0.16, hob + 0.038, cz + 0.12] });
  b.box('steel', 0.14, 0.012, 0.02, { p: [-0.02, hob + 0.058, cz + 0.2], r: [0, -0.6, 0] });
  for (const x of [-0.24, 0.05, 0.26]) b.box('rust', 0.05 + r() * 0.05, 0.08 + r() * 0.08, 0.004, { p: [x, v ? 0.1 : 0.12, zf - (v ? 0.002 : 0.004)] });
};

// A laminate kitchen table on tube legs, a last meal on it (0); or thrown on its side, its top to -Z (1).
INTERIOR_PROPS.kitchen_table = (b, r, v) => {
  const top = 0.7, lam = [0.72, 0.66, 0.5];
  const table = () => {
    b.box('paint', 1.36, 0.03, 0.8, { p: [0, top - 0.015, 0], c: lam });
    b.box('chrome', 1.37, 0.014, 0.81, { p: [0, top - 0.015, 0] });
    for (const sz of [-1, 1]) b.box('steel', 1.2, 0.04, 0.02, { p: [0, top - 0.05, sz * 0.31] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylBetween('chrome', [sx * 0.63, 0.003, sz * 0.36], [sx * 0.58, top - 0.03, sz * 0.31], 0.014, 0.016, 5);
  };
  const plate = (x, y, z) => b.cyl('paint', 0.1, 0.07, 0.014, 8, { p: [x, y + 0.007, z], c: [0.82, 0.8, 0.74] });
  if (v) {
    b.group({ p: [0, 0.405, 0.35], r: [-PI / 2, 0, 0] }, table);
    plate(0.2, 0, 0.05);
    tin(b, r, -0.25, 0, -0.1, true);
    b.box('paint', 0.1, 0.006, 0.07, { p: [0.36, 0.003, -0.12], r: [0, 0.7, 0], c: [0.82, 0.8, 0.74] }); // a piece of the other plate
  } else {
    table();
    plate(-0.3, top, -0.12);
    plate(0.28, top, 0.14);
    b.cyl('paint', 0.035, 0.03, 0.07, 6, { p: [-0.1, top + 0.035, 0.2], c: [0.5, 0.56, 0.62] });
    tin(b, r, 0.05, top, -0.2, true);
    bottle(b, r, 0.42, top, -0.15, true);
    b.box('steel', 0.16, 0.003, 0.014, { p: [-0.42, top + 0.0015, 0.02], r: [0, 0.3, 0] });
    b.plane('blood_decal', 0.3, 0.3, { raw: true, p: [0.1, top + 0.002, 0.05], r: [-PI / 2, 0, 1.1] });
  }
};

// A television on a low stand: a wood-grain case, a bulged tube (1: put in with something heavy), a rabbit-ear aerial.
INTERIOR_PROPS.tv_set = (b, r, v) => {
  const wood = mul(WOODS[4], 0.75), case_ = [0.5, 0.36, 0.24];
  // the stand: splayed legs, an open shelf with the video recorder
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.frustum('wood', 0.03, 0.03, 0.05, 0.05, 0, 0.1, { p: [sx * 0.42, 0, sz * 0.16], c: wood });
  for (const y of [0.1125, 0.4375]) b.box('wood', 0.96, 0.025, 0.44, { p: [0, y, 0], c: wood });
  for (const sx of [-1, 1]) b.box('wood', 0.02, 0.3, 0.42, { p: [sx * 0.46, 0.275, 0], c: wood });
  b.box('wood', 0.9, 0.3, 0.012, { p: [0, 0.275, 0.2], c: mul(wood, 0.6) });
  b.box('dark', 0.4, 0.09, 0.3, { p: [-0.2, 0.17, 0.02] });
  b.box('chrome', 0.3, 0.012, 0.004, { p: [-0.2, 0.18, -0.132] });
  lay(b, 'plastic', 0.19, 0.025, 0.1, 0.25, 0.125, -0.02, [0, 0.5, 0]);
  lay(b, 'plastic', 0.19, 0.025, 0.1, 0.22, 0.15, 0.0, [0, -0.2, 0]);
  // the set
  b.box('wood', 0.7, 0.5, 0.34, { p: [0, 0.7, -0.02], c: case_ });
  stack(b, 'plastic', [[0.5, 0.36, 0], [0.3, 0.22, 0.09]], { p: [0, 0.7, 0.15], r: [PI / 2, 0, 0] });
  b.box('plastic', 0.7, 0.5, 0.02, { p: [0, 0.7, -0.2] });
  const sx = -0.09, sy = 0.71, zs = -0.21;
  if (v) {
    b.box('dark', 0.42, 0.32, 0.004, { p: [sx, sy, zs - 0.002] });
    // what is left of the glass round the edge of the hole, and on the stand
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * PI * 2 + 0.3, ex = Math.cos(a) * 0.21, ey = Math.sin(a) * 0.16, t = [-Math.sin(a) * 0.05, Math.cos(a) * 0.05], m = rr(r, 0.45, 0.75);
      const z = zs - 0.006;
      b.poly('glass', [[sx + ex + t[0], sy + ey + t[1], z], [sx + ex - t[0], sy + ey - t[1], z], [sx + ex * m, sy + ey * m, z - 0.004]], [[0, 1, 2], [0, 2, 1]]);
    }
    for (const [x, z] of [[0.41, -0.12], [0.39, 0.05], [-0.42, -0.1]]) plate(b, 'glass', ragged(r, 3, 0.07, 0.05), 0.004, x, 0.45, z, [0, r() * 3, 0]);
  } else stack(b, 'paint', [[0.44, 0.34, 0], [0.38, 0.28, 0.018]], { p: [sx, sy, zs], r: [-PI / 2, 0, 0], c: [0.1, 0.12, 0.11] });
  for (const y of [0.84, 0.74]) b.cyl('chrome', 0.026, 0.03, 0.025, 6, { p: [0.25, y, zs - 0.0125], r: [PI / 2, 0, 0] });
  for (let k = 0; k < 4; k++) b.plane('dark', 0.12, 0.008, { p: [0.25, 0.52 + k * 0.03, zs - 0.001], r: [0, PI, 0] });
  // the aerial
  b.cyl('plastic', 0.04, 0.055, 0.03, 6, { p: [0.1, 0.965, 0] });
  b.cylBetween('chrome', [0.1, 0.975, 0], [-0.2, 1.14, 0.05], 0.003, 0.004, 3);
  b.cylBetween('chrome', [0.1, 0.975, 0], v ? [0.44, 1.0, -0.06] : [0.36, 1.13, -0.04], 0.003, 0.004, 3);
};

const BOOKS = [[0.45, 0.16, 0.14], [0.2, 0.28, 0.4], [0.24, 0.36, 0.26], [0.6, 0.52, 0.36], [0.3, 0.24, 0.2], [0.55, 0.5, 0.46], [0.5, 0.3, 0.14]];
// A tall bookcase at the back of its footprint, the floor in front of it for what was pulled out: 0 half its books
// still on the shelves, 1 nearly emptied onto the floor.
INTERIOR_PROPS.bookshelf = (b, r, v) => {
  const wood = mul(WOODS[v ? 2 : 4], 0.8), W = 0.93, H = 1.94, zf = 0.105, zb = 0.445, D = zb - zf, cz = (zf + zb) / 2;
  for (const sx of [-1, 1]) b.box('wood', 0.02, H, D, { p: [sx * (W / 2 - 0.01), H / 2, cz], c: wood });
  b.box('wood', W, 0.02, D, { p: [0, H - 0.01, cz], c: wood });
  b.box('wood', W - 0.04, H - 0.1, 0.01, { p: [0, H / 2 + 0.03, zb - 0.005], c: mul(wood, 0.6) });
  b.box('wood', W - 0.04, 0.08, 0.02, { p: [0, 0.04, zf + 0.02], c: wood });
  const ys = [0.09, 0.46, 0.83, 1.2, 1.57];
  for (const y of ys) b.box('wood', W - 0.04, 0.02, D - 0.02, { p: [0, y, cz - 0.005], c: wood });
  let left = v ? 9 : 40;
  const book = () => ({ t: rr(r, 0.025, 0.06), h: rr(r, 0.19, 0.31), d: rr(r, 0.15, 0.21), c: pick(r, BOOKS) });
  for (const y of ys) {
    const sy = y + 0.01;
    let x = -0.43 + rr(r, 0, v ? 0.5 : 0.12), run = 0;
    let quota = v ? 2 + (r() < 0.5 ? 1 : 0) : 8;
    while (left > 0 && quota > 0) {
      const { t, h, d, c } = book(), z = zf + 0.012 + rr(r, 0, 0.03) + d / 2;
      const a = rr(r, 0.2, 0.36), lean = run > 1 && r() < 0.22;
      const need = lean ? h * Math.sin(a) + t * Math.cos(a) : t;
      if (x + need > 0.43) break;
      if (lean) {
        b.box('paint', t, h, d, { p: [x + h * Math.sin(a) + (t / 2) * Math.cos(a) - (h / 2) * Math.sin(a), sy + (t / 2) * Math.sin(a) + (h / 2) * Math.cos(a), z], r: [0, 0, a], c });
        x += need + rr(r, 0.06, 0.2);
        run = 0;
      } else {
        b.box('paint', t, h, d, { p: [x + t / 2, sy + h / 2, z], c });
        x += t + 0.002;
        run++;
        if (r() < (v ? 0.5 : 0.14)) {
          x += rr(r, 0.07, 0.22);
          run = 0;
        }
      }
      left--;
      quota--;
    }
  }
  // on the floor: a few dropped (0), or the heap of what was thrown down (1)
  const flat = (x, y, z, yaw, tilt = 0) => {
    const { t, c } = book();
    lay(b, 'paint', 0.15, v ? 0.04 : t, 0.21, x, y, z, [tilt, yaw, 0], { c });
  };
  if (v) {
    for (const z of [-0.3, -0.05]) for (const x of [-0.33, -0.11, 0.11, 0.33]) flat(x + rr(r, -0.015, 0.015), 0, z + rr(r, -0.01, 0.01), rr(r, -0.35, 0.35));
    flat(0, 0.04, -0.175, rr(r, -0.25, 0.25));
    flat(0.02, 0.08, -0.175, rr(r, 0.5, 1));
    // two lying open, face down
    for (const [x, z, yaw] of [[-0.27, -0.175, 0.12], [0.27, -0.18, -0.1]])
      b.group({ p: [x, 0.04, z], r: [0, yaw, 0] }, () => {
        for (const s of [-1, 1]) lay(b, 'paint', 0.14, 0.012, 0.2, s * 0.068, 0, 0, [0, 0, s * 0.22], { c: pick(r, BOOKS) });
      });
  } else for (const [x, z] of [[-0.25, -0.2], [0.2, -0.05], [0.3, -0.3]]) flat(x, 0, z, r() * 3);
};

const CLOTHES = [[0.3, 0.33, 0.4], [0.46, 0.4, 0.3], [0.42, 0.2, 0.18], [0.24, 0.3, 0.24], [0.6, 0.58, 0.52], [0.16, 0.16, 0.18]];
// A wardrobe with two sliding doors: one slid across on what is left on the rail (0), or both doors gone (1).
INTERIOR_PROPS.wardrobe = (b, r, v) => {
  const wood = mul(WOODS[v ? 1 : 4], v ? 0.8 : 0.7), dim = mul(wood, 0.55);
  const W = 1.08, H = 1.98, D = 0.58, t = 0.02, y0 = 0.08, hh = H - y0, hy = y0 + hh / 2, iw = W - t * 2;
  b.box('wood', W - 0.04, y0, D - 0.06, { p: [0, y0 / 2, 0.01], c: dim });
  for (const sx of [-1, 1]) b.box('wood', t, hh, D, { p: [sx * (W / 2 - t / 2), hy, 0], c: wood });
  b.box('wood', W, t, D, { p: [0, H - t / 2, 0], c: wood });
  b.box('wood', iw, t, D, { p: [0, y0 + t / 2, 0], c: wood });
  b.box('wood', iw, hh, 0.012, { p: [0, hy, D / 2 - 0.006], c: dim });
  b.box('wood', iw, 0.05, 0.06, { p: [0, H - t - 0.025, -D / 2 + 0.03], c: wood });
  b.box('wood', iw, 0.018, D - 0.1, { p: [0, 1.8, 0.03], c: dim });
  b.cylBetween('chrome', [-iw / 2, 1.72, 0.02], [iw / 2, 1.72, 0.02], 0.012, 0.012, 5);
  const hook = (x) => b.cylBetween('steel', [x, 1.735, 0.02], [x, 1.665, 0.02], 0.004, 0.004, 3);
  const garment = (x, len) => {
    hook(x);
    stack(b, 'cloth', [[0.05, 0.34, 1.66 - len], [0.08, 0.42, 1.5], [0.06, 0.38, 1.62], [0.03, 0.1, 1.668]].map(([w, d, y]) => [w, d, y, x, 0.02]), { c: pick(r, CLOTHES) });
  };
  const heap = (x, s) => b.sphere('cloth', 0.2, 6, 4, { p: [x, y0 + t + 0.07 * s, 0.02], s: [1.2 * s, 0.4 * s, 0.9], r: [0, r() * 3, 0], c: pick(r, CLOTHES) });
  if (v) {
    garment(-0.3, 0.75);
    garment(0.34, 0.6);
    for (const x of [-0.1, 0.05, 0.2]) hook(x);
    heap(-0.2, 1.2);
    heap(0.24, 0.9);
    lay(b, 'cardboard', 0.3, 0.12, 0.3, 0.2, 1.809, 0.04, [0, 0.9, 0]);
    // the door track, torn down at one end
    b.box('chrome', 0.9, 0.012, 0.03, { p: [-0.02, 1.6, -0.25], r: [0, 0, 0.82] });
  } else {
    for (const [x, len] of [[-0.42, 0.7], [-0.3, 0.55], [-0.16, 0.75]]) garment(x, len);
    heap(-0.25, 1);
    lay(b, 'cardboard', 0.3, 0.12, 0.3, -0.2, 1.809, 0.04, [0, 0.3, 0]);
    lay(b, 'rubber', 0.09, 0.07, 0.24, 0.1, y0 + t, 0.0, [0, 0.5, 0]);
    // the doors: the right one shut on the back track, the left one slid across in front of it
    const dw = 0.55, dh = 1.78, dy = 1.02;
    for (const [x, z, k] of [[iw / 2 - dw / 2, -0.245, 0], [0.19, -0.268, 1]]) {
      b.box('wood', dw, dh, 0.018, { p: [x, dy, z], c: mul(wood, k ? 1.05 : 0.95) });
      if (k) {
        b.box('wood', dw - 0.12, dh - 0.24, 0.006, { p: [x, dy, z - 0.011], c: wood });
        b.box('dark', 0.03, 0.16, 0.004, { p: [x - dw / 2 + 0.04, dy, z - 0.01] });
      }
    }
    b.box('wood', iw, 0.02, 0.06, { p: [0, y0 + t + 0.01, -D / 2 + 0.03], c: wood });
  }
};

// A chest of drawers at the back of its footprint, the floor in front for the drawers pulled out of it.
INTERIOR_PROPS.dresser = (b, r, v) => {
  const wood = mul(WOODS[v ? 0 : 4], v ? 0.62 : 0.8), dim = mul(wood, 0.55);
  const zf = -0.025, zb = 0.445, D = zb - zf, cz = (zf + zb) / 2, y0 = 0.1, top = 0.76, iw = 0.94, len = 0.38;
  b.box('wood', 0.9, 0.08, D - 0.08, { p: [0, 0.04, cz], c: dim });
  b.box('wood', 0.99, 0.03, D + 0.02, { p: [0, top + 0.015, cz - 0.008], c: wood });
  for (const sx of [-1, 1]) b.box('wood', 0.02, top - 0.08, D, { p: [sx * 0.48, (top + 0.08) / 2, cz], c: wood });
  b.box('wood', iw, top - 0.08, 0.012, { p: [0, (top + 0.08) / 2, zb - 0.006], c: dim });
  b.box('wood', iw, 0.02, D, { p: [0, 0.09, cz], c: dim });
  const rh = (top - y0) / 3, fh = rh - 0.012, ry = (k) => y0 + (k + 0.5) * rh;
  for (const k of [1, 2]) b.box('wood', iw, 0.014, 0.03, { p: [0, y0 + k * rh, zf + 0.015], c: wood });
  const put = (x, row, w, out, pull = 'chrome') => b.group({ p: [x, ry(row), zf - 0.01 - out], r: [0, out ? rr(r, -0.03, 0.03) : 0, 0] }, () => drawer(b, 'wood', w, fh, out ? len : 0, wood, pull));
  const spill = (x, row, out, w) => {
    // clothes over the lip of a pulled drawer
    const z0 = zf - 0.01 - out, y = ry(row), c = pick(r, CLOTHES);
    stack(b, 'cloth', [[w + 0.1, 0.16, 0], [w + 0.2, 0.24, 0.05], [w, 0.14, 0.1]].map(([sx, sz, sy]) => [sx, sz, sy, x + 0.05, z0 + 0.17]), { p: [0, y - fh / 2 + 0.025, 0], c: pick(r, CLOTHES) });
    sheet(b, 'cloth', 2, 2, (u, vv, i, j) => [x - w / 2 + u * w + (j === 2 ? rr(r, -0.03, 0.03) : 0), j === 0 ? y + fh / 2 - 0.03 : j === 1 ? y + fh / 2 + 0.004 : y - rr(r, 0.02, 0.1), j === 0 ? z0 + 0.12 : j === 1 ? z0 - 0.012 : z0 - 0.016], { c });
  };
  const half = iw / 2 - 0.004, wide = iw - 0.004;
  if (v) {
    put(0.235, 2, half, 0.25);
    spill(0.2, 2, 0.25, 0.2);
    put(0, 0, wide, 0);
    // the middle drawer upside down on the floor, a shirt over it
    b.group({ p: [0, fh / 2, -0.43], r: [0, 0, PI] }, () => drawer(b, 'wood', wide, fh, len, wood, null));
    sheet(b, 'cloth', 2, 2, (u, vv, i, j) => [-0.3 + u * 0.4 + rr(r, -0.02, 0.02), i === 1 && j === 1 ? fh + 0.01 : fh - 0.012, -0.36 + vv * 0.26], { c: pick(r, CLOTHES) });
  } else {
    put(-0.235, 2, half, 0.12);
    put(0.235, 2, half, 0);
    put(0, 1, wide, 0.3);
    spill(-0.15, 1, 0.3, 0.3);
    put(0, 0, wide, 0.16);
  }
  // left on top: a picture face down, a bottle on its side
  lay(b, 'wood', 0.2, 0.015, 0.26, -0.28, top + 0.03, cz, [0, 0.4, 0], { c: dim });
  bottle(b, r, 0.25, top + 0.03, cz + 0.05, true, 'bottle_brown', 0.16, 0.025);
};

// A double bed, the headboard to +Z: 0 made up after a fashion, 1 the mattress down through the slats on one side,
// 2 stripped to the slats.
INTERIOR_PROPS.double_bed = (b, r, v) => {
  const wood = mul(WOODS[v === 1 ? 2 : 4], 0.72);
  for (const sx of [-1, 1]) {
    b.box('wood', 0.06, 0.74, 0.06, { p: [sx * 0.72, 0.37, 0.99], c: wood });
    b.box('wood', 0.06, 0.46, 0.06, { p: [sx * 0.72, 0.23, -0.99], c: wood });
    b.box('wood', 0.03, 0.16, 1.92, { p: [sx * 0.72, 0.26, 0], c: wood });
  }
  b.box('wood', 1.38, 0.44, 0.03, { p: [0, 0.5, 0.99], c: mul(wood, 0.9) });
  b.box('wood', 1.49, 0.05, 0.07, { p: [0, 0.725, 0.985], c: wood });
  b.box('wood', 1.38, 0.24, 0.03, { p: [0, 0.3, -0.99], c: mul(wood, 0.9) });
  b.box('wood', 1.49, 0.04, 0.07, { p: [0, 0.45, -0.985], c: wood });
  const mattress = (o) => stack(b, 'mattress', [[1.36, 1.88, -0.1], [1.4, 1.92, -0.06], [1.4, 1.92, 0.06], [1.36, 1.88, 0.1]], o);
  const slat = (z, x0 = -0.705, x1 = 0.705, drop = 0, free = 1) => {
    const L = x1 - x0, a = Math.asin(drop / L);
    b.box('wood', L, 0.02, 0.09, { p: [(x0 + x1) / 2 - free * (L / 2) * (1 - Math.cos(a)), 0.27 - drop / 2, z], r: [0, 0, -free * a], c: WOODS[3] });
  };
  if (v === 0) {
    mattress({ p: [0, 0.38, 0] });
    stack(b, 'cloth', [[0.5, 0.3, 0], [0.56, 0.36, 0.05], [0.5, 0.3, 0.1]], { p: [-0.32, 0.48, 0.72], r: [0, 0.15, 0], c: [0.7, 0.68, 0.6] });
    // the blanket, half thrown back and hanging over the side
    const xs = [-0.745, -0.715, -0.42, -0.12, 0.18, 0.42, 0.56], bump = [];
    for (let k = 0; k < 42; k++) bump.push(r());
    sheet(b, 'cloth', 6, 5, (u, vv, i, j) => [xs[i] + (i > 4 ? bump[j] * 0.1 : 0), i === 0 ? 0.2 + bump[j + 6] * 0.08 : i === 1 || i === 6 ? 0.49 : 0.492 + bump[i * 6 + j] * 0.05, -0.93 + vv * 1.2 + (i > 1 ? bump[i + j * 6] * 0.06 : 0)], { c: [0.3, 0.34, 0.4] });
    b.plane('blood_decal', 0.5, 0.5, { raw: true, p: [0.3, 0.483, 0.55], r: [-PI / 2, 0, 0.7] });
  } else if (v === 1) {
    for (const z of [-0.75, -0.4, -0.05, 0.3, 0.65]) slat(z, 0.3 + r() * 0.1, 0.705);
    b.group({ p: [0, 0.303, 0], r: [0, 0, 0.3] }, () => {
      mattress({});
      b.plane('blood_decal', 0.6, 0.6, { raw: true, p: [-0.1, 0.103, 0.2], r: [-PI / 2, 0, 2] });
      b.sphere('cloth', 0.22, 6, 4, { p: [-0.42, 0.15, -0.6], s: [1.2, 0.35, 1.5], c: [0.42, 0.36, 0.28] });
    });
  } else {
    for (const [k, z] of [-0.85, -0.64, -0.42, -0.2, 0.02, 0.23, 0.45, 0.66, 0.86].entries()) {
      if (k === 3) slat(z, -0.705, 0.2, 0.26);
      else if (k === 6) slat(z, -0.1, 0.705, 0.25, -1);
      else if (k !== 4) slat(z);
    }
    b.sphere('cloth', 0.25, 6, 4, { p: [0.2, 0.075, -0.3], s: [1.4, 0.3, 1.1], c: [0.3, 0.34, 0.4] });
    lay(b, 'cardboard', 0.4, 0.2, 0.3, -0.3, 0, 0.5, [0, 0.4, 0]);
  }
};

// A cast-iron roll-top bath on claw feet, the taps at the +Z end: a tide line of years (0), or what bled out in it (1).
INTERIOR_PROPS.bathtub = (b, r, v) => {
  const A = 0.39, C = 0.84, N = 2.7;
  const ext = [0.5, 0.5, 0.46], rim = [0.8, 0.79, 0.72], in_ = [0.7, 0.68, 0.6], scum = v ? [0.3, 0.14, 0.1] : [0.36, 0.29, 0.2];
  bowl(b, 'paint', [
    [0.2, 0.1, ext], [0.07, 0.17, ext], [0.02, 0.34, ext], [0.015, 0.48, ext], [0, 0.515, rim], [0.02, 0.54, rim], [0.045, 0.52, rim],
    [0.06, 0.31, in_], [0.0605, 0.305, scum], [0.1, 0.19, scum], [0.2, 0.14, mul(scum, 0.7)],
  ], 12, A, C, N);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) stack(b, 'rust', [[0.08, 0.08, 0], [0.05, 0.05, 0.06], [0.09, 0.09, 0.14]].map(([w, d, y]) => [w, d, y, sx * 0.21, sz * 0.55]));
  for (const sx of [-1, 1]) {
    const x = sx * 0.085;
    b.cyl('chrome', 0.014, 0.017, 0.045, 5, { p: [x, 0.5575, 0.795] });
    b.box('chrome', 0.05, 0.012, 0.012, { p: [x, 0.586, 0.795], r: [0, 0.5 * sx, 0] });
    b.cylBetween('chrome', [x, 0.568, 0.795], [x, 0.55, 0.72], 0.008, 0.01, 4);
  }
  b.cyl('dark', 0.025, 0.025, 0.004, 6, { p: [0, 0.142, 0.5] });
  if (v) {
    const pts = [];
    for (let k = 0; k < 12; k++) pts.push([...planAt((k / 12) * PI * 2, A - 0.094, C - 0.094, N)]);
    const verts = [[0, 0.205, 0], ...pts.map(([x, z]) => [x, 0.205, z])], faces = [];
    for (let k = 0; k < 12; k++) faces.push([0, 1 + ((k + 1) % 12), 1 + k]);
    b.poly('blood', verts, faces);
  } else b.box('paint', 0.09, 0.03, 0.06, { p: [0.1, 0.155, -0.3], r: [0, 0.6, 0], c: [0.7, 0.66, 0.5] });
};

// A lavatory: the seat up against a cracked cistern that has lost half its lid.
INTERIOR_PROPS.toilet = (b, r) => {
  const cer = [0.8, 0.8, 0.75], stain = [0.42, 0.34, 0.22];
  bowl(b, 'paint', [
    [0.07, 0, cer], [0.1, 0.12, cer], [0.08, 0.25, cer], [0.005, 0.35, cer], [0, 0.395, cer], [0.02, 0.405, cer], [0.045, 0.39, cer],
    [0.07, 0.3, mul(cer, 0.8)], [0.12, 0.21, stain],
  ], 10, 0.19, 0.25, 2.3, { p: [0, 0, -0.09] });
  b.box('paint', 0.16, 0.24, 0.14, { p: [0, 0.31, 0.19], c: cer });
  b.box('paint', 0.4, 0.34, 0.17, { p: [0, 0.59, 0.255], c: cer });
  b.box('dark', 0.36, 0.004, 0.13, { p: [0, 0.762, 0.255] });
  b.box('paint', 0.21, 0.03, 0.17, { p: [-0.1, 0.775, 0.255], r: [0, 0.06, 0], c: mul(cer, 1.04) });
  b.box('chrome', 0.07, 0.014, 0.014, { p: [0.13, 0.7, 0.164] });
  b.torus('plastic', 0.13, 0.02, 4, 10, PI * 2, { p: [0, 0.59, 0.145], r: [-0.06, 0, 0], s: [1.1, 1.2, 0.6] });
  // the crack down the cistern, the rust under the handle
  b.box('dark', 0.004, 0.14, 0.003, { p: [-0.06, 0.66, 0.169], r: [0, 0, 0.35] });
  b.box('rust', 0.03, 0.12, 0.003, { p: [0.13, 0.62, 0.169] });
};

// keep of a convex outline [[x, z], ...] what lies on the inner side of the line through p with normal n
function clip2(poly, p, n) {
  const out = [], side = (q) => (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length], sa = side(a), sc = side(c);
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sc >= 0) {
      const t = sa / (sa - sc);
      out.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]);
    }
  }
  return out;
}
const RUGS = [
  [[0.36, 0.14, 0.12], [0.62, 0.54, 0.4], [0.16, 0.18, 0.28]],
  [[0.2, 0.28, 0.3], [0.6, 0.56, 0.46], [0.42, 0.26, 0.16]],
  [[0.42, 0.36, 0.26], [0.26, 0.2, 0.16], [0.5, 0.2, 0.14]],
];
// A worn carpet: a field inside two borders, a medallion, one corner turned over, what was spilled on it.
INTERIOR_PROPS.rug = (b, r, v) => {
  const W = 2.56, D = 1.76, f = 0.42, [c0, c1, c2] = RUGS[v];
  const flat = (pts, y, c) => {
    if (pts.length < 3) return;
    const faces = [];
    for (let i = 1; i < pts.length - 1; i++) faces.push([0, i, i + 1]);
    b.poly('cloth', pts.map(([x, z]) => [x, y, z]), faces, { c });
  };
  // the corner at (+X, -Z) is folded back along the line from A to B
  const A = [W / 2 - f, -D / 2], B = [W / 2, -D / 2 + f], n = [-Math.SQRT1_2, Math.SQRT1_2];
  const rect = (i) => clip2([[-W / 2 + i, -D / 2 + i], [-W / 2 + i, D / 2 - i], [W / 2 - i, D / 2 - i], [W / 2 - i, -D / 2 + i]], A, n);
  flat(rect(0), 0.006, c0);
  flat(rect(0.1), 0.008, c1);
  flat(rect(0.16), 0.01, c0);
  flat(rect(0.4), 0.012, c2);
  flat(rect(0.46), 0.014, mul(c0, 0.85));
  flat([[-0.5, 0], [0, 0.34], [0.5, 0], [0, -0.34]], 0.016, c1);
  flat([[-0.22, 0], [0, 0.15], [0.22, 0], [0, -0.15]], 0.017, c2);
  flat([A, B, [W / 2 - f, -D / 2 + f]], 0.019, [0.5, 0.44, 0.34]);
  for (let k = 0; k < 2; k++) {
    const x = rr(r, -0.9, 0.5), z = rr(r, -0.2, 0.55);
    flat(ragged(r, 5, rr(r, 0.4, 0.7), rr(r, 0.3, 0.5)).map(([px, pz]) => [x + px, z + pz]), 0.018 + k * 0.0005, mul(c0, 0.35));
  }
};

// Blood dried on a floor: 0 a pool, 1 a pool and where somebody was dragged from it, 2 two pools and two drags.
INTERIOR_PROPS.blood_pool = (b, r, v) => {
  const pool = (x, z, s, k) => b.plane('blood_decal', s, s, { raw: true, p: [x, 0.004 + k * 0.0006, z], r: [-PI / 2, 0, rr(r, -0.3, 0.3)] });
  const drag = (x, z, w, l, yaw, k) => b.plane('blood_decal', w, l, { raw: true, p: [x, 0.004 + k * 0.0006, z], r: [-PI / 2, 0, yaw] });
  if (v === 0) {
    pool(-0.1, 0.05, 1.1, 0);
    pool(0.4, -0.35, 0.5, 1);
  } else if (v === 1) {
    pool(-0.24, 0.22, 0.8, 0);
    drag(0.15, -0.2, 0.3, 0.8, -0.8, 1);
    drag(0.5, -0.5, 0.24, 0.5, -0.75, 2);
  } else {
    pool(-0.35, -0.3, 0.75, 0);
    pool(0.35, 0.3, 0.6, 1);
    drag(0.0, 0.0, 0.26, 0.9, 0.85, 2);
    drag(0.2, 0.55, 0.2, 0.4, 1.4, 3);
    pool(-0.5, 0.45, 0.3, 4);
  }
};

// What a ceiling comes down as: plasterboard and tiles broken on the floor, the battens they hung from, a strip light.
INTERIOR_PROPS.ceiling_debris = (b, r, v) => {
  const board = () => mul([0.76, 0.74, 0.68], rr(r, 0.75, 1));
  const tilt = (m) => [rr(r, -m, m), r() * PI * 2, rr(r, -m, m)];
  // big sheets, some flat, some propped on the rest
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2 + r(), d = rr(r, 0.25, 0.7), w = rr(r, 0.55, 0.95), dd = rr(r, 0.4, 0.7);
    plate(b, 'paint', ragged(r, 5, w, dd), 0.013, Math.cos(a) * d, 0, Math.sin(a) * d, tilt(k < 2 + v ? 0.38 : 0.06), { order: 'YXZ', c: board() });
  }
  // ceiling tiles and the bits of them
  for (let k = 0; k < 4; k++) {
    const s = rr(r, 0.3, 0.58);
    plate(b, 'paint', ragged(r, 4, s, s), 0.016, rr(r, -0.85, 0.85), 0, rr(r, -0.85, 0.85), tilt(0.12), { order: 'YXZ', c: mul([0.62, 0.6, 0.55], rr(r, 0.8, 1)) });
  }
  for (let k = 0; k < 5; k++) plate(b, 'paint', ragged(r, 3, rr(r, 0.08, 0.2), rr(r, 0.08, 0.2)), 0.013, rr(r, -1.05, 1.05), 0, rr(r, -1.05, 1.05), tilt(0.3), { order: 'YXZ', c: board() });
  // battens
  for (let k = 0; k < 4; k++) {
    const len = rr(r, 0.7, 1.5), rot = [0, r() * PI, k < 2 ? rr(r, 0.1, 0.28) : 0], reachX = (len / 2) * 1.02;
    lay(b, 'wood', len, 0.022, 0.045, rr(r, -1.15 + reachX, 1.15 - reachX), 0, rr(r, -1.15 + reachX, 1.15 - reachX), rot, { order: 'YXZ', grain: true, c: WOODS[k % 5] });
  }
  // the strip light: its tray on the floor, what is left of its tubes
  b.group({ p: [v === 1 ? -0.3 : 0.25, 0, v === 2 ? 0.5 : -0.4], r: [0, 0.5 + v * 1.1, 0] }, () => {
    b.box('paint', 1.2, 0.045, 0.13, { p: [0, 0.0225, 0], c: [0.74, 0.74, 0.7] });
    for (const sx of [-1, 1]) b.box('plastic', 0.025, 0.035, 0.1, { p: [sx * 0.57, 0.0625, 0] });
    b.cyl('paint', 0.014, 0.014, 0.22, 5, { p: [0.45, 0.064, 0.035], r: [0, 0, PI / 2], c: [0.85, 0.85, 0.82] });
    tin(b, r, 0.2, 0, 0.16, true, 5, 0.014, 0.3, [0.85, 0.85, 0.82]);
  });
};

// A strip light on a ceiling (the origin is the ceiling: it hangs down from y = 0): 0 a twin-tube batten as fitted,
// 1 the same hanging by one end, 2 a bare flex and a broken bulb.
INTERIOR_PROPS.ceiling_lamp = (b, r, v) => {
  const k = 1.8, white = mul([0.74, 0.74, 0.7], k), tube = mul([0.86, 0.86, 0.82], k); // (the builder shades what is below y = 0 as if in a corner)
  const batten = (L, tubes) => {
    b.box('paint', L, 0.045, 0.11, { p: [L / 2, -0.0225, 0], c: white });
    for (const sz of [-1, 1]) {
      for (const x of [0.03, L - 0.03]) b.box('plastic', 0.02, 0.04, 0.03, { p: [x, -0.064, sz * 0.03] });
      const t = tubes[(sz + 1) / 2];
      if (t) b.cyl('paint', 0.015, 0.015, (L - 0.08) * t, 6, { p: [0.04 + ((L - 0.08) * t) / 2, -0.068, sz * 0.03], r: [0, 0, PI / 2], c: tube });
    }
  };
  if (v === 0) b.group({ p: [-0.62, 0, 0] }, () => batten(1.24, [1, 1]));
  else if (v === 1) {
    b.group({ p: [-0.6, -0.004, 0], r: [0, 0, -0.34] }, () => batten(1.22, [0, 0.45]));
    b.cylBetween('rubber', [0.5, 0, 0.02], [0.47, -0.2, 0.02], 0.004, 0.004, 3);
    b.cylBetween('rubber', [0.47, -0.2, 0.02], [0.44, -0.365, 0.015], 0.004, 0.004, 3);
  } else {
    b.cyl('plastic', 0.035, 0.045, 0.02, 6, { p: [0, -0.01, 0] });
    b.cylBetween('rubber', [0, -0.02, 0], [0.012, -0.18, 0.004], 0.004, 0.004, 4);
    b.cylBetween('rubber', [0.012, -0.18, 0.004], [0.005, -0.33, 0], 0.004, 0.004, 4);
    b.cyl('plastic', 0.018, 0.02, 0.05, 6, { p: [0.005, -0.355, 0] });
    b.cyl('chrome', 0.013, 0.013, 0.012, 5, { p: [0.005, -0.386, 0] });
    // what is left of the glass
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2 + 0.4, c = Math.cos(a), s = Math.sin(a);
      b.poly('glass', [[0.005 + c * 0.012, -0.392, s * 0.012], [0.005 - s * 0.012, -0.392, c * 0.012], [0.005 + (c - s) * 0.016, -0.392 - rr(r, 0.02, 0.05), (s + c) * 0.016]], [[0, 1, 2], [0, 2, 1]]);
    }
  }
};

// ================================================================== shops
/** what is left of the stock along a shelf: n things between x0 and x1 standing on y, z0 the shelf's front and z1 its back; mess 0..1 of them knocked over */
function stockRow(b, r, y, x0, x1, z0, z1, n, mess) {
  const zc = (z0 + z1) / 2, zr = Math.abs(z1 - z0) / 2 - 0.13;
  for (let k = 0; k < n; k++) {
    const x = x0 + ((k + rr(r, 0.3, 0.7)) / n) * (x1 - x0), z = zc + rr(r, -zr, zr), what = r(), lie = r() < mess;
    if (what < 0.45) tin(b, r, x, y, z, lie, 5);
    else if (what < 0.87) {
      const w = rr(r, 0.08, 0.15), h = rr(r, 0.12, 0.2), d = rr(r, 0.05, 0.09);
      lay(b, r() < 0.5 ? 'cardboard' : 'paint', w, h, d, x, y, z, lie ? [PI / 2, rr(r, -0.25, 0.25), 0] : [0, rr(r, -0.3, 0.3), 0], { order: 'YXZ', c: pick(r, TINS) });
    } else bottle(b, r, x, y, z, false, r() < 0.5 ? 'bottle' : 'bottle_brown', 0.2, 0.03);
  }
}

// A double-sided supermarket shelving bay along X: 0 a remnant of stock, 1 nearly stripped and a shelf hanging by one
// end, 2 the whole bay racked over toward -Z and the shelves of that side down.
INTERIOR_PROPS.shop_gondola = (b, r, v) => {
  const cream = [0.7, 0.68, 0.6], rail = [0.74, 0.68, 0.3], L = 2.28, SD = 0.34, base = 0.15;
  b.box('paint', 2.36, base, 0.86, { p: [0, base / 2, 0], c: [0.3, 0.3, 0.3] });
  for (const sz of [-1, 1]) b.box('paint', L, 0.035, 0.008, { p: [0, base - 0.02, sz * 0.434], c: rail });
  // a shelf with its price rail, hooked to the spine on the side sz; built with its back edge on the group's origin
  const shelf = (sz) => {
    b.box('paint', L, 0.025, SD, { p: [0, -0.0125, (sz * SD) / 2], c: cream });
    b.box('paint', L, 0.035, 0.008, { p: [0, -0.012, sz * (SD + 0.004)], c: rail });
  };
  const levels = [0.37, 0.72, 1.07]; // (above the base)
  b.group({ p: [0, base, 0], r: [v === 2 ? -0.12 : 0, 0, 0] }, () => {
    for (const sx of [-1, 1]) b.box('steel', 0.04, 1.42, 0.1, { p: [sx * 1.16, 0.71, 0] });
    b.box('paint', L, 1.36, 0.02, { p: [0, 0.68, 0], c: [0.55, 0.52, 0.45] });
    b.box('paint', 2.36, 0.03, 0.12, { p: [0, 1.435, 0], c: cream });
    for (const sz of [-1, 1])
      levels.forEach((y, k) => {
        if (v === 1 && sz > 0 && k === 2) return; // gone
        if (v === 1 && sz < 0 && k === 1) return b.group({ p: [-L / 2, y, sz * 0.01], r: [0, 0, -0.138] }, () => b.group({ p: [L / 2, 0, 0] }, () => shelf(sz)));
        if (v === 2 && sz < 0) {
          // unhooked: hanging flat against the spine, or (the top one) fallen: see below
          if (k < 2) b.group({ p: [0, y - 0.02, -0.04], r: [-PI / 2 + 0.04, 0, 0] }, () => shelf(sz));
          return;
        }
        b.group({ p: [0, y, sz * 0.01] }, () => {
          shelf(sz);
          const n = v === 0 ? [4, 3, 3][k] : v === 1 ? (sz < 0 && k === 0 ? 2 : 0) : sz > 0 && k === 0 ? 3 : 0;
          if (n) stockRow(b, r, 0, v === 1 ? 0.5 : -1.05, 1.05, sz * 0.02, sz * SD, n, v === 0 ? 0.35 : 0.8);
        });
      });
  });
  // the base deck's own stock
  for (const sz of [-1, 1]) {
    const n = v === 0 ? 4 : v === 1 ? (sz > 0 ? 2 : 1) : sz > 0 ? 5 : 0;
    if (n) stockRow(b, r, base, -1.05, 1.05, sz * 0.06, sz * 0.42, n, v === 0 ? 0.4 : 0.9);
  }
  if (v === 2) lay(b, 'paint', L, 0.025, SD, 0.02, base, -0.25, [-0.3, 0.02, 0], { c: cream }); // the top shelf, down on the deck
};

// A supermarket till: a belt, a scanner, a bag rack, the register on the cashier's side (+Z) with its drawer open
// and empty, a sweet rack knocked over on the belt. 1: the register ripped out, the belt torn.
INTERIOR_PROPS.checkout_counter = (b, r, v) => {
  const col = v ? [0.36, 0.42, 0.5] : [0.56, 0.54, 0.47], top = 0.85, zc = -0.12;
  b.box('dark', 2.1, 0.08, 0.54, { p: [0, 0.04, zc] });
  b.box('paint', 2.16, 0.74, 0.6, { p: [0, 0.45, zc], c: col });
  b.box('steel', 2.18, 0.03, 0.62, { p: [0, top - 0.015, zc] });
  b.box('rubber', 2.16, 0.05, 0.02, { p: [0, 0.5, zc - 0.31] });
  // the belt between its rails, the scanner's window
  if (v) {
    b.box('rubber', 0.5, 0.006, 0.42, { p: [-0.78, top + 0.003, zc] });
    b.box('dark', 0.65, 0.004, 0.42, { p: [-0.2, top + 0.002, zc] });
    sheet(b, 'cloth', 2, 1, (u, vv) => [-0.55 + u * 0.3, top + 0.006 + (u === 0.5 ? 0.05 : u ? 0.012 : 0), zc - 0.2 + vv * 0.4], { c: [0.12, 0.12, 0.12] }); // the belt, torn and curled back
  } else b.box('rubber', 1.15, 0.006, 0.42, { p: [-0.45, top + 0.003, zc] });
  for (const sz of [-1, 1]) b.box('chrome', 1.2, 0.03, 0.02, { p: [-0.45, top + 0.015, zc + sz * 0.225] });
  b.box('chrome', 0.03, 0.012, 0.44, { p: [0.145, top + 0.006, zc] });
  b.box('dark', 0.2, 0.004, 0.2, { p: [0.3, top + 0.002, zc] });
  // the bag rack at the end
  for (const sz of [-1, 1]) b.cylBetween('chrome', [1.0, top, zc + sz * 0.16], [1.0, top + 0.16, zc + sz * 0.16], 0.006, 0.006, 4);
  b.cylBetween('chrome', [1.0, top + 0.155, zc - 0.17], [1.0, top + 0.155, zc + 0.17], 0.006, 0.006, 4);
  sheet(b, 'cloth', 1, 2, (u, vv, i, j) => [0.985 - (j === 1 ? 0.03 : 0) - u * 0.004, top + 0.155 - vv * 0.15, zc - 0.13 + u * 0.26 + (j === 2 ? 0.03 : 0)], { c: [0.8, 0.8, 0.78] });
  // the card reader on its stalk
  b.cylBetween('steel', [0.42, top, zc - 0.25], [0.42, top + 0.16, zc - 0.25], 0.012, 0.012, 5);
  b.box('plastic', 0.085, 0.03, 0.15, { p: [0.42, top + 0.17, zc - 0.25], r: [v ? -0.9 : 0.5, v ? 0.5 : 0, 0] });
  // the cashier's side: the till pedestal and the register
  b.box('paint', 0.5, top, 0.26, { p: [0.72, top / 2, 0.31], c: mul(col, 0.9) });
  if (v) {
    b.box('dark', 0.3, 0.004, 0.26, { p: [0.72, top + 0.002, 0.12] });
    for (const [x, z] of [[0.66, 0.1], [0.8, 0.16]]) b.cylBetween('rubber', [x, top, z], [x + 0.08, top + 0.01, z + 0.16], 0.006, 0.006, 3);
    lay(b, 'steel', 0.3, 0.05, 0.3, -0.75, top + 0.006, zc, [0, 0.5, 0]); // its drawer, left on the belt
  } else {
    b.box('paint', 0.36, 0.11, 0.34, { p: [0.72, top + 0.055, 0.1], c: [0.56, 0.55, 0.5] });
    stack(b, 'paint', [[0.34, 0.22, 0, 0, 0.02], [0.34, 0.06, 0.07, 0, -0.06]], { p: [0.72, top + 0.11, 0.1], c: [0.56, 0.55, 0.5] });
    b.box('dark', 0.3, 0.005, 0.12, { p: [0.72, top + 0.148, 0.115], r: [0.41, 0, 0] });
    b.box('plastic', 0.2, 0.06, 0.03, { p: [0.72, top + 0.21, 0.02] });
    // the drawer, out and empty
    const dz = 0.27, out = 0.16;
    b.box('steel', 0.3, 0.005, out, { p: [0.72, top + 0.02, dz + out / 2] });
    b.box('plastic', 0.32, 0.055, 0.012, { p: [0.72, top + 0.04, dz + out - 0.006] });
    for (const dx of [-0.146, -0.05, 0.05, 0.146]) b.box('steel', 0.006, 0.035, out - 0.012, { p: [0.72 + dx, top + 0.038, dz + (out - 0.012) / 2] });
    // the sweet rack, over on its side on the belt, and what was on it
    b.group({ p: [-0.62, top + 0.006 + 0.1075, zc - 0.02], r: [0, 0.35, PI / 2], order: 'YXZ' }, () => {
      for (const sx of [-1, 1]) b.box('paint', 0.015, 0.3, 0.14, { p: [sx * 0.1, 0.15, 0], c: [0.6, 0.14, 0.1] });
      for (let k = 0; k < 3; k++) b.box('paint', 0.2, 0.012, 0.1, { p: [0, 0.04 + k * 0.1, -0.02 + k * 0.015], r: [0.3, 0, 0], c: [0.6, 0.14, 0.1] });
    });
    for (let k = 0; k < 6; k++) lay(b, 'paint', 0.07, 0.018, 0.035, -0.95 + k * 0.1 + rr(r, -0.02, 0.02), top + 0.006, zc + rr(r, -0.15, 0.15), [0, r() * PI, 0], { c: pick(r, TINS) });
  }
  for (const x of [-0.8, 0.1, 0.7]) b.box('rust', 0.06 + r() * 0.05, 0.1 + r() * 0.1, 0.004, { p: [x, 0.16, zc - 0.302] });
};

// An upright drinks chiller with two glass doors and a dead light box on top: 0 one door hanging open and one smashed,
// a few bottles left; 1 a door gone, the shelves down, mould.
INTERIOR_PROPS.display_fridge = (b, r, v) => {
  const col = v ? [0.5, 0.15, 0.12] : [0.16, 0.26, 0.42], white = [0.66, 0.67, 0.62], mould = [0.1, 0.14, 0.08];
  const W = 1.26, zf = -0.175, zb = 0.375, D = zb - zf, cz = (zf + zb) / 2, y0 = 0.2, y1 = 1.72, hy = (y0 + y1) / 2, hh = y1 - y0;
  b.box('paint', W, y0, D, { p: [0, y0 / 2, cz], c: [0.2, 0.2, 0.2] });
  for (const y of [0.07, 0.13]) b.box('dark', W - 0.2, 0.025, 0.004, { p: [0, y, zf - 0.002] });
  for (const sx of [-1, 1]) b.box('paint', 0.03, hh, D, { p: [sx * (W / 2 - 0.015), hy, cz], c: col });
  b.box('paint', W - 0.06, hh, 0.03, { p: [0, hy, zb - 0.015], c: white });
  b.box('paint', 0.04, hh, 0.04, { p: [0, hy, zf + 0.02], c: mul(col, 0.8) });
  b.box('paint', W, 1.98 - y1, D, { p: [0, (1.98 + y1) / 2, cz], c: col });
  b.box('paint', W - 0.1, 0.18, 0.006, { p: [0, 1.85, zf - 0.003], c: [0.7, 0.7, 0.62] });
  b.box('paint', W - 0.3, 0.04, 0.004, { p: [0, 1.82, zf - 0.008], c: mul(col, 1.3) });
  // wire shelves, and the mould on the back wall
  const iw = W - 0.06;
  [0.55, 0.9, 1.25].forEach((y, k) => {
    const rot = v ? [0, 0, k === 1 ? -0.5 : k ? 0.12 : 0] : [0, 0, 0], w = v && k === 1 ? iw * 0.62 : iw, x = v && k === 1 ? -0.2 : 0, yy = v && k === 1 ? y - 0.18 : y;
    b.group({ p: [x, yy, cz], r: rot }, () => {
      b.plane('chainlink', w, D - 0.1, { r: [-PI / 2, 0, 0] });
      b.box('steel', w, 0.014, 0.012, { p: [0, 0, -(D - 0.1) / 2] });
    });
  });
  for (const [x, y, w, h] of [[-0.3, 0.5, 0.36, 0.5], [0.34, 1.3, 0.3, 0.34], [0.1, 0.32, 0.5, 0.2]]) b.plane('paint', w, h, { p: [x, y, zb - 0.031], r: [0, PI, 0], c: mould });
  b.plane('paint', 0.5, 0.3, { p: [0.2, y0 + 0.002, cz], r: [-PI / 2, 0, 0.3], c: mould });
  if (!v) {
    bottle(b, r, -0.42, 0.55, cz + 0.05);
    bottle(b, r, 0.36, 0.9, cz + 0.08, false, 'bottle_brown');
    bottle(b, r, 0.2, y0, cz, true);
  } else bottle(b, r, 0.3, y0, cz, true);
  // the doors
  const dw = 0.6, dh = 1.5;
  const door = (dir, glass) => {
    for (const sy of [-1, 1]) b.box('steel', dw, 0.04, 0.04, { p: [(dir * dw) / 2, sy * (dh / 2 - 0.02), -0.02] });
    for (const x of [0.02, dw - 0.02]) b.box('steel', 0.04, dh - 0.08, 0.04, { p: [dir * x, 0, -0.02] });
    b.box('chrome', 0.02, 0.3, 0.03, { p: [dir * (dw - 0.02), 0, -0.055] });
    if (glass) b.box('glass', dw - 0.08, dh - 0.08, 0.006, { p: [(dir * dw) / 2, 0, -0.02] });
    else
      for (const [cx, cy] of [[0.04, -dh / 2 + 0.04], [dw - 0.04, -dh / 2 + 0.04], [dw - 0.04, dh / 2 - 0.04]]) {
        // what glass is left in the corners
        const ix = cx < dw / 2 ? 1 : -1, iy = cy < 0 ? 1 : -1;
        b.poly('glass', [[dir * cx, cy, -0.02], [dir * (cx + ix * rr(r, 0.12, 0.3)), cy, -0.02], [dir * cx, cy + iy * rr(r, 0.15, 0.4), -0.02]], [[0, 1, 2], [0, 2, 1]]);
      }
  };
  if (v) b.group({ p: [-0.62, hy, zf] }, () => door(1, false));
  else {
    b.group({ p: [-0.62, hy, zf], r: [0, 0.2, 0] }, () => door(1, true));
    b.group({ p: [0.62, hy, zf] }, () => door(-1, false));
  }
  for (const sy of [-1, 1]) if (v) b.box('steel', 0.03, 0.06, 0.03, { p: [0.61, hy + sy * 0.6, zf - 0.015] }); // the hinges the other hung on
  for (const x of [-0.45, 0.3]) b.box('rust', 0.06 + r() * 0.05, 0.08 + r() * 0.08, 0.004, { p: [x, 0.1, zf - 0.004] });
};

// A snack machine: the glass put in and the coils emptied (0), the whole front prised open on its hinges (1).
INTERIOR_PROPS.vending_machine = (b, r, v) => {
  const col = v ? [0.2, 0.3, 0.5] : [0.55, 0.15, 0.12];
  const W = 0.93, H = 1.83, zf = -0.2, zb = 0.42, D = zb - zf, cz = (zf + zb) / 2, y0 = 0.04, hh = H - y0, hy = y0 + hh / 2;
  for (const sz of [-1, 1]) b.box('dark', W - 0.08, y0, 0.08, { p: [0, y0 / 2, cz + sz * 0.22] });
  b.box('paint', W, hh, 0.02, { p: [0, hy, zb - 0.01], c: col });
  for (const sx of [-1, 1]) b.box('paint', 0.02, hh, D, { p: [sx * (W / 2 - 0.01), hy, cz], c: col });
  for (const y of [y0 + 0.01, H - 0.01]) b.box('paint', W, 0.02, D, { p: [0, y, cz], c: col });
  b.plane('dark', W - 0.04, hh - 0.04, { p: [0, hy, zb - 0.021], r: [0, PI, 0] });
  // trays and their coils
  for (const y of [0.8, 1.12, 1.44]) {
    b.box('steel', 0.6, 0.012, 0.42, { p: [-0.14, y, cz + 0.04] });
    for (const x of [-0.34, -0.14, 0.06]) b.cylBetween('chrome', [x, y + 0.02, cz - 0.16], [x, y + 0.02, cz + 0.24], 0.022, 0.022, 3);
  }
  lay(b, 'paint', 0.1, 0.03, 0.14, -0.3, 0.806, cz - 0.05, [0, 0.4, 0], { c: [0.7, 0.6, 0.2] });
  tin(b, r, 0.02, y0 + 0.02, cz - 0.1, true, 5, 0.033, 0.12);
  // the front: a frame round the window, the coin panel at the right, the flap at the bottom; hinged on the right
  b.group({ p: [W / 2, 0, zf], r: [0, v ? -0.15 : 0, 0] }, () => {
    b.box('paint', W, 0.5, 0.06, { p: [-W / 2, y0 + 0.25, -0.03], c: col });
    b.box('dark', 0.5, 0.14, 0.006, { p: [-W / 2 - 0.1, 0.26, -0.062] });
    b.box('paint', W, 0.1, 0.06, { p: [-W / 2, H - 0.05, -0.03], c: col });
    b.box('paint', 0.06, H - 0.1 - y0 - 0.5, 0.06, { p: [-W + 0.03, (H - 0.1 + y0 + 0.5) / 2, -0.03], c: col });
    b.box('paint', 0.28, H - 0.1 - y0 - 0.5, 0.06, { p: [-0.14, (H - 0.1 + y0 + 0.5) / 2, -0.03], c: mul(col, 0.85) });
    b.box('steel', 0.1, 0.14, 0.006, { p: [-0.14, 1.2, -0.062] });
    b.box('dark', 0.012, 0.05, 0.006, { p: [-0.14, 1.38, -0.062] });
    b.box('dark', 0.08, 0.07, 0.006, { p: [-0.14, 0.86, -0.062] });
    // the glass left round the window
    const x0 = -W + 0.06, x1 = -0.28, wy0 = y0 + 0.5, wy1 = H - 0.1;
    for (const [cx, cy, ix, iy] of [[x0, wy0, 1, 1], [x1, wy0, -1, 1], [x0, wy1, 1, -1], [x1, wy1, -1, -1], [x0, 1.1, 1, 1]])
      b.poly('glass', [[cx, cy, -0.03], [cx + ix * rr(r, 0.1, 0.26), cy, -0.03], [cx, cy + iy * rr(r, 0.12, 0.4), -0.03]], [[0, 1, 2], [0, 2, 1]]);
  });
  for (const x of [-0.3, 0.2]) b.box('rust', 0.05 + r() * 0.05, 0.08 + r() * 0.1, 0.003, { p: [x, 0.16, zb + 0.0015] });
};

// Stock swept off the shelves onto the floor: tins, boxes, packets, a bottle or two, a burst sack.
INTERIOR_PROPS.stock_spill = (b, r, v) => {
  const kinds = [];
  const add = (k, n) => {
    for (let i = 0; i < n; i++) kinds.push(k);
  };
  add('tin', [7, 5, 9][v]);
  add('box', [11, 15, 7][v]);
  add('packet', [6, 7, 4][v]);
  add('bottle', [1, 0, 2][v]);
  add('carton', [2, 3, 1][v]);
  const cells = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (!((i === 0 || i === 5) && (j === 0 || j === 5)) && !(i === 2 + (v % 2) && j === 3)) cells.push([-0.75 + i * 0.3, -0.75 + j * 0.3]);
  for (let k = cells.length - 1; k > 0; k--) {
    const j = Math.floor(r() * (k + 1));
    [cells[k], cells[j]] = [cells[j], cells[k]];
  }
  kinds.forEach((kind, k) => {
    const [cx, cz] = cells[k % cells.length], x = cx + rr(r, -0.05, 0.05), z = cz + rr(r, -0.05, 0.05), yaw = r() * PI * 2;
    if (kind === 'tin') tin(b, r, x, 0, z, r() < 0.75, 5);
    else if (kind === 'box') {
      const w = rr(r, 0.08, 0.15), h = rr(r, 0.12, 0.19), d = rr(r, 0.04, 0.09);
      lay(b, r() < 0.5 ? 'cardboard' : 'paint', w, h, d, x, 0, z, [r() < 0.8 ? PI / 2 : 0, yaw, 0], { order: 'YXZ', c: pick(r, TINS) });
    } else if (kind === 'packet') stack(b, 'cloth', [[0.1, 0.14, 0], [0.15, 0.19, 0.022], [0.1, 0.14, 0.045]], { p: [x, 0, z], r: [0, yaw, 0], c: pick(r, TINS) });
    else if (kind === 'bottle') bottle(b, r, x * 0.7, 0, z * 0.7, true, r() < 0.5 ? 'bottle' : 'bottle_brown', 0.22, 0.03);
    else b.hull('cardboard', [[-0.09, 0, -0.06], [0.09, 0, -0.06], [-0.1, 0.05, -0.05], [0.07, 0.09, -0.07], [-0.09, 0, 0.06], [0.09, 0, 0.06], [-0.08, 0.07, 0.07], [0.1, 0.04, 0.05]], { p: [x, 0, z], r: [0, yaw, 0] });
  });
  // the sack, split, and what ran out of it
  const sx = -0.75 + (2 + (v % 2)) * 0.3, sz = 0.15;
  stack(b, 'burlap', [[0.22, 0.34, 0], [0.3, 0.42, 0.05], [0.24, 0.36, 0.11]], { p: [sx, 0, sz], r: [0, 0.4 + v, 0] });
  plate(b, 'paint', ragged(r, 5, 0.34, 0.26), 0.006, sx + 0.12, 0, sz - 0.2, [0, 0, 0], { c: v === 1 ? [0.7, 0.66, 0.5] : [0.82, 0.8, 0.74] });
};

// ================================================================== offices, the police station
/** a dead monitor standing on y = 0, its screen to -Z (0.38 wide, 0.4 high) */
function crt(b, r, smashed) {
  const c = [0.62, 0.6, 0.52];
  b.box('paint', 0.24, 0.03, 0.24, { p: [0, 0.015, 0.06], c });
  b.box('paint', 0.1, 0.05, 0.1, { p: [0, 0.055, 0.06], c });
  b.box('paint', 0.38, 0.32, 0.3, { p: [0, 0.24, 0.06], c });
  stack(b, 'paint', [[0.32, 0.26, 0], [0.2, 0.16, 0.1]], { p: [0, 0.24, 0.21], r: [PI / 2, 0, 0], c });
  if (smashed) b.box('dark', 0.3, 0.24, 0.004, { p: [0, 0.245, -0.091] });
  else stack(b, 'paint', [[0.32, 0.26, 0], [0.27, 0.21, 0.012]], { p: [0, 0.245, -0.09], r: [-PI / 2, 0, 0], c: [0.1, 0.12, 0.11] });
}
const PAPERS = [[0.8, 0.79, 0.72], [0.72, 0.7, 0.62], [0.76, 0.72, 0.6], [0.66, 0.66, 0.62]];
/** sheets of paper lying on y, n of them round (x, z) within rx by rz, each a hair above the last */
function papers(b, r, n, x, y, z, rx, rz) {
  for (let k = 0; k < n; k++) b.plane('paint', 0.21, 0.297, { p: [x + rr(r, -rx, rx), y + 0.002 + k * 0.0004, z + rr(r, -rz, rz)], r: [-PI / 2, 0, r() * PI * 2], c: pick(r, PAPERS) });
}

// A steel-and-laminate desk (who sits at it sits at -Z), a drawer pedestal on the right: 0 as it was left, a dead
// monitor and a phone off the hook; 1 swept clean, the monitor on its side; 2 thrown on its side as a barricade, its
// top to -Z.
INTERIOR_PROPS.office_desk = (b, r, v) => {
  const steel = [0.36, 0.38, 0.38], lam = [0.62, 0.56, 0.44], top = 0.74;
  const px = 0.54, pw = 0.44, pz0 = -0.2, pz1 = 0.36, pd = pz1 - pz0, pcz = (pz0 + pz1) / 2, py0 = 0.06, py1 = top - 0.03;
  const desk = () => {
    b.box('paint', 1.58, 0.03, 0.78, { p: [0, top - 0.015, 0], c: lam });
    b.box('paint', 0.03, top - 0.03, 0.7, { p: [-0.76, (top - 0.03) / 2, 0], c: steel });
    b.box('paint', 1.06, 0.4, 0.02, { p: [-0.215, 0.5, 0.35], c: steel });
    // the pedestal: a shell, its drawers where they were left
    for (const sx of [-1, 1]) b.box('paint', 0.015, py1 - py0, pd, { p: [px + sx * (pw / 2 - 0.0075), (py0 + py1) / 2, pcz], c: steel });
    b.box('paint', pw, py1 - py0, 0.015, { p: [px, (py0 + py1) / 2, pz1 - 0.0075], c: mul(steel, 0.6) });
    b.box('paint', pw, 0.015, pd, { p: [px, py0 + 0.0075, pcz], c: steel });
    for (const sz of [-1, 1]) b.box('dark', pw - 0.06, py0, 0.04, { p: [px, py0 / 2, pcz + sz * 0.2] });
    const rows = [[0.07, 0.4], [0.41, 0.55], [0.56, 0.705]]; // (bottom to top)
    const outs = [[0.08, 0, 0.15], [0, 0.12, -1], [0, 0, -1]][v];
    rows.forEach(([y0, y1], k) => {
      if (outs[k] < 0) return;
      b.group({ p: [px, (y0 + y1) / 2, pz0 - 0.01 - outs[k]] }, () => drawer(b, 'paint', pw - 0.02, y1 - y0 - 0.008, outs[k] ? 0.5 : 0, mul(steel, 1.1)));
    });
  };
  if (v === 2) {
    b.group({ p: [0, 0.39, 0.37], r: [-PI / 2, 0, 0] }, desk);
    b.group({ p: [-0.3, 0.19, -0.12], r: [0, 0.3, PI / 2], order: 'YXZ' }, () => crt(b, r, true));
    papers(b, r, 5, -0.2, 0, 0.05, 0.3, 0.14);
    return;
  }
  desk();
  if (v === 1) {
    b.group({ p: [-0.3, top + 0.19, -0.1], r: [0, 0.2, PI / 2], order: 'YXZ' }, () => crt(b, r, true));
    papers(b, r, 2, 0.4, top, 0, 0.2, 0.2);
    return;
  }
  b.group({ p: [-0.28, top, 0.02], r: [0, 0.12, 0] }, () => crt(b, r, false));
  stack(b, 'paint', [[0.42, 0.15, 0], [0.42, 0.13, 0.025, 0, 0.008]], { p: [-0.26, top, -0.25], r: [0, 0.08, 0], c: [0.62, 0.6, 0.52] });
  b.cylBetween('rubber', [-0.1, top + 0.006, -0.18], [-0.16, top + 0.006, 0.0], 0.005, 0.005, 3);
  // the phone, off the hook
  stack(b, 'dark', [[0.16, 0.2, 0, 0, 0], [0.16, 0.18, 0.05, 0, 0.01]], { p: [0.52, top, 0.14], r: [0, -0.2, 0] });
  b.group({ p: [0.34, top, -0.06], r: [0, 0.7, 0] }, () => {
    b.box('dark', 0.19, 0.022, 0.04, { p: [0, 0.035, 0] });
    for (const sx of [-1, 1]) b.box('dark', 0.05, 0.03, 0.05, { p: [sx * 0.075, 0.015, 0] });
  });
  b.cylBetween('rubber', [0.4, top + 0.005, -0.0], [0.5, top + 0.02, 0.06], 0.005, 0.005, 3);
  b.cyl('paint', 0.04, 0.035, 0.09, 6, { p: [0.14, top + 0.045, 0.22], c: [0.6, 0.6, 0.56] });
  papers(b, r, 6, 0.2, top, -0.05, 0.38, 0.12);
};

// A swivel chair on a five-star base with castors, armrests: standing (0), or on its side (1).
INTERIOR_PROPS.office_chair = (b, r, v) => {
  const cloth = v ? [0.3, 0.22, 0.18] : [0.2, 0.24, 0.3];
  b.group(v ? { p: [0.49, 0.315, 0], r: [0, 0, PI / 2] } : { p: [0, 0, 0], r: [0, 0.2, 0] }, () => {
    b.cyl('dark', 0.035, 0.04, 0.06, 5, { p: [0, 0.095, 0] });
    for (let k = 0; k < 5; k++) {
      const a = PI + (k / 5) * PI * 2, c = Math.cos(a), s = Math.sin(a);
      b.beam('dark', [0, 0.1, 0], [c * 0.28, 0.07, s * 0.28], 0.035, 0.024);
      b.cyl('rubber', 0.03, 0.03, 0.03, 5, { p: [c * 0.28, 0.03, s * 0.28], r: [0, -a, PI / 2], order: 'YXZ' });
    }
    b.cyl('chrome', 0.02, 0.022, 0.31, 5, { p: [0, 0.265, 0] });
    b.box('plastic', 0.44, 0.03, 0.42, { p: [0, 0.435, 0] });
    cushion(b, 0.46, 0.07, 0.44, cloth, { p: [0, 0.485, 0] });
    b.beam('steel', [0, 0.43, 0.2], [0, 0.66, 0.27], 0.05, 0.02);
    cushion(b, 0.42, 0.06, 0.4, cloth, { p: [0, 0.74, 0.235], r: [PI / 2 + 0.12, 0, 0] });
    b.box('plastic', 0.4, 0.36, 0.015, { p: [0, 0.735, 0.272], r: [0.12, 0, 0] });
    for (const sx of [-1, 1]) {
      b.beam('plastic', [sx * 0.24, 0.44, 0.04], [sx * 0.29, 0.665, 0.04], 0.04, 0.02);
      b.box('plastic', 0.05, 0.03, 0.26, { p: [sx * 0.29, 0.675, 0.01] });
    }
  });
};

// A four-drawer filing cabinet at the back of its footprint, the floor in front for its drawers and what came out.
INTERIOR_PROPS.filing_cabinet = (b, r, v) => {
  const col = v ? [0.34, 0.4, 0.36] : [0.5, 0.48, 0.42];
  const W = 0.48, H = 1.34, zf = -0.03, zb = 0.6, D = zb - zf, cz = (zf + zb) / 2, y0 = 0.04, rh = (H - 0.06) / 4;
  for (const sx of [-1, 1]) b.box('paint', 0.015, H, D, { p: [sx * (W / 2 - 0.0075), H / 2, cz], c: col });
  b.box('paint', W, H, 0.015, { p: [0, H / 2, zb - 0.0075], c: mul(col, 0.5) });
  b.box('paint', W, 0.02, D, { p: [0, H - 0.01, cz], c: col });
  const outs = v ? [0.1, 0, 0.5, -1] : [0, 0.25, 0, 0.45];
  outs.forEach((out, k) => {
    if (out < 0) return;
    const y = y0 + (k + 0.5) * rh;
    b.group({ p: [0, y, zf - 0.01 - out], r: [0, out ? rr(r, -0.02, 0.02) : 0, out ? 0 : rr(r, -0.012, 0.012)] }, () => {
      drawer(b, 'paint', W - 0.02, rh - 0.01, out ? 0.55 : 0, mul(col, 1.08));
      b.plane('paint', 0.1, 0.05, { p: [0, 0.08, -0.0105], r: [0, PI, 0], c: [0.8, 0.78, 0.7] });
      // the hanging files in what shows of it
      if (out > 0.2) for (let i = 0; i < 3; i++) b.box('cardboard', W - 0.06, 0.24, 0.004, { p: [0, 0.01 + r() * 0.02, 0.06 + ((i + r() * 0.6) * (out - 0.1)) / 3], r: [rr(r, -0.3, 0.3), 0, rr(r, -0.05, 0.05)] });
    });
  });
  if (v) lay(b, 'cardboard', 0.24, 0.02, 0.32, 0.04, 0, -0.38, [0, 0.4, 0]);
  papers(b, r, v ? 8 : 6, 0, 0, -0.33, 0.06, 0.08);
};

// Paper over a floor: loose sheets and a few folders.
INTERIOR_PROPS.paper_scatter = (b, r, v) => {
  const n = [30, 38, 26][v];
  for (let k = 0; k < n; k++) {
    const a = r() * PI * 2, d = Math.sqrt(r()) * 0.9;
    b.plane('paint', 0.21, 0.297, { p: [Math.cos(a) * d, 0.003 + k * 0.0002, Math.sin(a) * d], r: [-PI / 2, 0, r() * PI * 2], c: pick(r, PAPERS) });
  }
  for (let k = 0; k < 3 + v; k++) b.plane('cardboard', 0.24, 0.32, { p: [rr(r, -0.8, 0.8), 0.011 + k * 0.0003, rr(r, -0.8, 0.8)], r: [-PI / 2, 0, r() * PI * 2] });
};

// A front desk: a raised public counter along -Z, the lower work surface behind it, drawers on the staff side (+Z).
// 0: a town office's, a glass screen on it partly put in, a bell, a ledger; 1: the police station's, steel, a mesh
// grille, a dead radio.
INTERIOR_PROPS.reception_desk = (b, r, v) => {
  const col = v ? [0.26, 0.3, 0.34] : mul(WOODS[4], 0.8), mat = v ? 'paint' : 'wood', topc = v ? [0.2, 0.22, 0.24] : mul(WOODS[1], 0.7);
  const ct = 1.1, wt = 0.75; // the tops of the counter and of the work surface
  b.box('dark', 3.3, 0.08, 0.06, { p: [0, 0.04, -0.41] });
  b.box(mat, 3.36, ct - 0.04 - 0.08, 0.06, { p: [0, (ct - 0.04 + 0.08) / 2, -0.42], c: col });
  b.box(mat, 3.39, 0.04, 0.34, { p: [0, ct - 0.02, -0.32], c: topc });
  b.box(mat, 3.3, 0.03, 0.6, { p: [0, wt - 0.015, 0.13], c: topc });
  b.box(mat, 3.3, ct - 0.04 - wt, 0.02, { p: [0, (ct - 0.04 + wt) / 2, -0.16], c: col });
  for (const sx of [-1, 1]) {
    b.box(mat, 0.04, wt - 0.03, 0.9, { p: [sx * 1.66, (wt - 0.03) / 2, -0.02], c: col });
    b.box(mat, 0.04, ct - 0.04 - wt + 0.03, 0.3, { p: [sx * 1.66, (ct - 0.04 + wt - 0.03) / 2, -0.3], c: col });
  }
  // the front: slats or a steel band, the plaque
  if (v) b.box('steel', 3.3, 0.1, 0.01, { p: [0, 0.6, -0.455] });
  else for (const x of [-1.4, -0.9, 0.9, 1.4]) b.box('wood', 0.06, 0.86, 0.012, { p: [x, 0.55, -0.456], c: mul(col, 0.8) });
  b.box('paint', 0.8, 0.18, 0.012, { p: [0, 0.82, -0.456], c: v ? [0.12, 0.16, 0.26] : [0.5, 0.42, 0.2] });
  // the drawer pedestal under the work surface, its drawers out toward whoever sat here
  b.box(mat, 0.45, wt - 0.03 - 0.06, 0.4, { p: [1.2, (wt - 0.03 + 0.06) / 2, 0.1], c: mul(col, 0.9) });
  [0, 0.14, 0.04].forEach((out, k) => b.group({ p: [1.2, 0.17 + k * 0.2, 0.31 + out], r: [0, PI, 0] }, () => drawer(b, mat, 0.43, 0.19, out ? 0.3 : 0, col)));
  // the screen on the counter: four posts and a rail; glass, or mesh
  const sz = -0.32, y0 = ct, y1 = 1.6;
  for (const x of [-1.5, -0.5, 0.5, 1.5]) b.box(v ? 'steel' : 'chrome', 0.03, y1 - y0, 0.03, { p: [x, (y0 + y1) / 2, sz] });
  b.box(v ? 'steel' : 'chrome', 3.03, 0.03, 0.03, { p: [0, y1 + 0.015, sz] });
  for (let k = 0; k < 3; k++) {
    const x = -1 + k, w = 0.97, gy0 = y0 + (k === 1 ? 0.14 : 0.04), h = y1 - gy0;
    if (v) {
      if (k === 2) b.plane('chainlink', w * 0.7, h, { p: [x - 0.1, gy0 + h / 2 - 0.06, sz + 0.03], r: [0.12, 0, 0.2] }); // torn out of its frame at one side
      else b.plane('chainlink', w, h, { p: [x, gy0 + h / 2, sz] });
      if (k === 1) b.box('steel', w, 0.025, 0.025, { p: [x, gy0, sz] });
    } else if (k === 1) {
      for (const [cx, ix] of [[x - w / 2, 1], [x + w / 2, -1]])
        for (const [cy, iy] of [[gy0, 1], [y1, -1]]) b.poly('glass', [[cx, cy, sz], [cx + ix * rr(r, 0.12, 0.35), cy, sz], [cx, cy + iy * rr(r, 0.1, 0.3), sz]], [[0, 1, 2], [0, 2, 1]]);
    } else b.box('glass', w, h, 0.006, { p: [x, gy0 + h / 2, sz] });
  }
  // what was on it
  b.group({ p: [0.45, ct, -0.3], r: [0, 0.2, 0] }, () => {
    for (const s of [-1, 1]) lay(b, 'paint', 0.16, 0.018, 0.24, s * 0.081, 0, 0, [0, 0, s * 0.08], { c: [0.2, 0.14, 0.1] });
    b.plane('paint', 0.3, 0.22, { p: [0, 0.033, 0], r: [-PI / 2, 0, 0], c: PAPERS[0] });
  });
  if (v) {
    b.box('dark', 0.24, 0.09, 0.18, { p: [-0.9, wt + 0.045, 0.2] });
    b.box('steel', 0.2, 0.05, 0.004, { p: [-0.9, wt + 0.05, 0.292] });
    lay(b, 'dark', 0.05, 0.035, 0.09, -0.62, wt, 0.3, [0, 0.6, 0]);
    b.cylBetween('rubber', [-0.8, wt + 0.03, 0.29], [-0.64, wt + 0.02, 0.3], 0.005, 0.005, 3);
  } else {
    b.sphere('chrome', 0.04, 6, 3, { p: [-0.35, ct, -0.34], thetaLen: PI / 2 });
    b.cyl('chrome', 0.008, 0.008, 0.02, 4, { p: [-0.35, ct + 0.045, -0.34] });
    b.group({ p: [-0.7, wt, 0.16], r: [0, PI - 0.2, 0] }, () => crt(b, r, false));
  }
  papers(b, r, 4, 0.2, wt, 0.14, 0.5, 0.1);
};

// A row of three moulded seats on a beam: one broken off its bracket (0: gone; 1: lying under the row).
INTERIOR_PROPS.waiting_chairs = (b, r, v) => {
  const col = v ? [0.24, 0.34, 0.44] : [0.66, 0.34, 0.12];
  b.box('steel', 1.7, 0.05, 0.08, { p: [0, 0.36, 0.04] });
  for (const sx of [-1, 1]) {
    b.box('steel', 0.05, 0.335, 0.06, { p: [sx * 0.72, 0.1675, 0.04] });
    b.box('steel', 0.06, 0.03, 0.52, { p: [sx * 0.72, 0.015, 0] });
  }
  const pan = () => stack(b, 'paint', [[0.44, 0.38, 0], [0.5, 0.44, 0.02], [0.5, 0.44, 0.035]], { p: [0, 0, -0.07], r: [0.06, 0, 0], c: col });
  const back = (o) => stack(b, 'paint', [[0.46, 0.03, 0], [0.5, 0.035, 0.2], [0.44, 0.03, 0.38]], { ...o, c: col });
  [-0.56, 0, 0.56].forEach((x, k) => {
    b.box('steel', 0.3, 0.03, 0.3, { p: [x, 0.4, -0.02] });
    const broken = k === (v ? 1 : 2);
    if (broken && !v) return b.box('paint', 0.2, 0.012, 0.12, { p: [x + 0.03, 0.421, -0.05], r: [0, 0.3, 0], c: col }); // what stayed bolted down
    b.group({ p: [x, 0.415, 0] }, () => {
      pan();
      if (!broken) back({ p: [0, 0.02, 0.15], r: [0.2, 0, 0] });
    });
  });
  if (v) back({ p: [0.04, 0.0175, 0.11], r: [-PI / 2, 0.1, 0], order: 'YXZ' }); // the back that snapped off, on the floor under the row
  b.plane('blood_decal', 0.3, 0.3, { raw: true, p: [-0.56, 0.4555, -0.08], r: [-PI / 2 + 0.06, 0, 1] });
};

// The front of a cell along X: bars, a lock, the gate (between x = -0.2 and 0.9) standing open into +Z.
INTERIOR_PROPS.cell_bars = (b, r) => {
  const H = 2.4, R = 0.011;
  const bar = (x, y0, y1) => b.cyl('iron', R, R, y1 - y0, 6, { p: [x, (y0 + y1) / 2, 0], open: true });
  const panel = (x0, x1) => {
    for (const x of [x0 + 0.025, x1 - 0.025]) b.box('iron', 0.05, H, 0.06, { p: [x, H / 2, 0] });
    for (const y of [0.12, 1.2, 2.3]) b.box('iron', x1 - x0 - 0.1, 0.06, 0.03, { p: [(x0 + x1) / 2, y, 0] });
    for (let x = x0 + 0.14; x < x1 - 0.1; x += 0.12) bar(x, 0.12, 2.3);
  };
  panel(-1.5, -0.2);
  panel(0.9, 1.5);
  b.box('iron', 1.1, 0.07, 0.05, { p: [0.35, 2.3, 0] }); // over the gate
  for (const x of [-0.08, 0.04, 0.16, 0.28, 0.4, 0.52, 0.64, 0.76]) bar(x, 2.3, H - 0.005);
  b.box('iron', 1.1, 0.03, 0.03, { p: [0.35, H - 0.015, 0] });
  // the gate, hung at x = 0.9
  b.group({ p: [0.875, 0, 0.03], r: [0, 2.1, 0] }, () => {
    const w = 1.02, top = 2.24;
    for (const x of [-0.02, -w + 0.02]) b.box('iron', 0.04, top - 0.03, 0.04, { p: [x, (top + 0.03) / 2, 0] });
    for (const y of [0.07, 1.1, top - 0.03]) b.box('iron', w - 0.08, 0.05, 0.03, { p: [-w / 2, y, 0] });
    for (let x = -0.14; x > -w + 0.1; x -= 0.12) bar(x, 0.07, top - 0.03);
    b.box('steel', 0.12, 0.2, 0.07, { p: [-w + 0.08, 1.1, 0] });
    b.box('dark', 0.012, 0.04, 0.074, { p: [-w + 0.08, 1.08, 0] });
    b.box('steel', 0.06, 0.03, 0.03, { p: [-w - 0.005, 1.14, 0] });
  });
  for (const y of [0.45, 1.85]) b.cyl('steel', 0.018, 0.018, 0.1, 5, { p: [0.878, y, 0.035] });
  for (const x of [-1.2, -0.5, 1.3]) b.box('rust', 0.03, 0.2 + r() * 0.2, 0.062, { p: [x < 0 ? -1.475 + (x === -0.5 ? 1.25 : 0) : 1.475, 0.2, 0] });
};

// A steel bunk hung off the wall at +X on two struts, two legs at its outer edge: a thin stained mattress and a
// blanket (0), or stripped to the plate (1).
INTERIOR_PROPS.cell_bunk = (b, r, v) => {
  b.box('steel', 0.76, 0.03, 1.9, { p: [0, 0.385, 0] });
  for (const sx of [-1, 1]) b.box('steel', 0.02, 0.06, 1.9, { p: [sx * 0.37, 0.4, 0] });
  for (const sz of [-1, 1]) {
    b.box('steel', 0.76, 0.06, 0.02, { p: [0, 0.4, sz * 0.94] });
    b.box('steel', 0.04, 0.37, 0.04, { p: [-0.36, 0.185, sz * 0.8] });
    b.beam('steel', [0.385, 0.08, sz * 0.8], [0.12, 0.375, sz * 0.8], 0.04, 0.02);
  }
  if (v) {
    for (let k = 0; k < 3; k++) b.box('rust', 0.2 + r() * 0.2, 0.002, 0.2 + r() * 0.3, { p: [rr(r, -0.2, 0.2), 0.401, -0.6 + k * 0.6] });
    b.sphere('cloth', 0.2, 5, 4, { p: [0.05, 0.44, 0.6], s: [1.3, 0.28, 1.2], c: [0.3, 0.3, 0.28] });
    b.cyl('steel', 0.035, 0.03, 0.07, 6, { p: [-0.2, 0.435, -0.5] });
  } else {
    stack(b, 'mattress', [[0.66, 1.8, 0], [0.7, 1.84, 0.02], [0.7, 1.84, 0.06], [0.66, 1.8, 0.08]], { p: [0, 0.4, 0] });
    const bump = [];
    for (let k = 0; k < 16; k++) bump.push(r());
    sheet(b, 'cloth', 3, 3, (u, vv, i, j) => [-0.34 + u * 0.6 + bump[j] * 0.06, 0.483 + (i % 3 && j % 3 ? bump[i + j * 4] * 0.015 : 0), -0.9 + vv * 0.8 + bump[i + 4] * 0.08], { c: [0.3, 0.3, 0.28] });
    b.plane('blood_decal', 0.45, 0.45, { raw: true, p: [0.05, 0.482, 0.45], r: [-PI / 2, 0, 0.6] });
  }
};

// ================================================================== the hospital
// A wheeled hospital bed, its head to +Z: one side rail up and one down. 0 flat, the sheet dragged half off; 1 the
// head section cranked up; 2 somebody under the sheet.
INTERIOR_PROPS.hospital_bed = (b, r, v) => {
  const white = [0.74, 0.74, 0.7], sheetc = [0.7, 0.7, 0.64], deck = 0.495, mt = 0.1, top = deck + mt;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      b.cyl('rubber', 0.05, 0.05, 0.035, 5, { p: [sx * 0.4, 0.05, sz * 0.98], r: [0, 0, PI / 2] });
      b.cylBetween('chrome', [sx * 0.4, 0.07, sz * 0.98], [sx * 0.4, sz > 0 ? 1.1 : 0.84, sz * 0.98], 0.016, 0.016, 5);
    }
  b.cylBetween('chrome', [-0.4, 1.1, 0.98], [0.4, 1.1, 0.98], 0.016, 0.016, 5);
  b.cylBetween('chrome', [-0.4, 0.84, -0.98], [0.4, 0.84, -0.98], 0.016, 0.016, 5);
  b.box('paint', 0.76, 0.42, 0.02, { p: [0, 0.82, 0.98], c: white });
  b.box('paint', 0.76, 0.28, 0.02, { p: [0, 0.64, -0.98], c: white });
  for (const sx of [-1, 1]) b.box('paint', 0.03, 0.05, 1.94, { p: [sx * 0.4, 0.45, 0], c: white });
  for (const z of [-0.29, 0.69]) b.box('paint', 0.9, 0.04, 0.04, { p: [0, 0.45, z], c: white });
  b.box('paint', 0.78, 0.05, 0.03, { p: [0, 0.45, -0.955], c: white });
  // the deck and the mattress: in two sections, the head one hinged at z = 0.2
  const pad = (len, o) => {
    b.group(o, () => {
      b.box('steel', 0.78, 0.02, len, { p: [0, 0.01, len / 2] });
      stack(b, 'mattress', [[0.76, len - 0.04, 0.02], [0.8, len, 0.04], [0.8, len, mt], [0.76, len - 0.04, mt + 0.02]].map(([w, d, y]) => [w, d, y, 0, len / 2]));
    });
  };
  const hz = 0.2, up = v === 1 ? 0.5 : 0;
  pad(1.14, { p: [0, deck - 0.02, -0.94] });
  pad(0.74, { p: [0, deck - 0.02, hz], r: [-up, 0, 0] });
  const mtop = top + 0.002;
  if (v === 2) {
    // the shape of somebody under the sheet: feet, knees, hips, chest, head
    const zs = [-0.9, -0.72, -0.5, -0.25, 0, 0.25, 0.45, 0.66, 0.86], hs = [0, 0.19, 0.1, 0.12, 0.17, 0.19, 0.12, 0.2, 0];
    const xs = [-0.425, -0.4, -0.2, 0, 0.2, 0.4, 0.425], ws = [0, 0.05, 0.75, 1, 0.75, 0.05, 0];
    sheet(b, 'cloth', 6, 8, (u, vv, i, j) => [xs[i], i === 0 || i === 6 ? top - 0.07 - ((i + j * 3) % 4) * 0.02 : mtop + hs[j] * ws[i], zs[j]], {
      c: sheetc,
      cfn: (x, y, z, c) => {
        const d = Math.hypot(x - 0.08, (z - 0.3) * 0.7);
        return d < 0.2 ? c.setRGB(0.3, 0.1, 0.08) : c;
      },
    });
  } else {
    // the sheet: dragged down toward the foot and off the side with the lowered rail
    const bump = [];
    for (let k = 0; k < 30; k++) bump.push(r());
    const xs = [-0.39, -0.15, 0.12, 0.405, 0.43];
    sheet(b, 'cloth', 4, 4, (u, vv, i, j) => [xs[i] + (i === 0 ? bump[j] * 0.1 : 0), i === 4 ? top - 0.12 - bump[j + 5] * 0.14 : mtop + (i % 4 && j % 4 ? bump[i * 5 + j] * 0.035 : 0.003), -0.92 + vv * (v ? 0.95 : 1.25) + bump[i + 20] * 0.05], {
      c: sheetc,
      cfn: (x, y, z, c) => (Math.hypot(x + 0.05, (z + 0.3) * 0.8) < 0.22 ? c.setRGB(0.34, 0.16, 0.1) : c),
    });
    b.group({ p: [0, deck - 0.02, hz], r: [-up, 0, 0] }, () => stack(b, 'cloth', [[0.4, 0.24, 0], [0.46, 0.3, 0.04], [0.4, 0.24, 0.085]], { p: [0.03, mt + 0.022, 0.5], r: [0, 0.1, 0], c: [0.72, 0.72, 0.68] }));
  }
  // the side rails: up on -X, down on +X
  for (const [x, y] of [[-0.445, 0.9], [0.445, 0.5]]) {
    for (const yy of [y, y - 0.24]) b.cylBetween('chrome', [x, yy, -0.3], [x, yy, 0.7], 0.011, 0.011, 4);
    for (const z of [-0.29, 0.69]) b.cylBetween('chrome', [x, Math.min(y - 0.24, 0.45), z], [x, y, z], 0.009, 0.009, 3);
  }
  b.cylBetween('steel', [0.2, 0.45, -0.96], [0.2, 0.45, -1.06], 0.01, 0.01, 3);
  b.cylBetween('steel', [0.2, 0.455, -1.055], [0.2, 0.36, -1.055], 0.01, 0.01, 3);
};

// A hospital screen: 0 a curtain on a wheeled frame, torn and off half its hooks; 1 three folding panels.
INTERIOR_PROPS.privacy_curtain = (b, r, v) => {
  const col = v ? [0.5, 0.62, 0.66] : [0.52, 0.66, 0.56];
  const stain = (x, y, z, c) => {
    const d = Math.min(Math.hypot(x + 0.4, y - 1.0), Math.hypot(x - 0.3, (y - 0.6) * 0.6));
    return d < 0.26 ? c.multiplyScalar(0.5) : c;
  };
  if (v) {
    const P = [[-1.02, -0.1], [-0.34, 0.12], [0.34, -0.12], [1.02, 0.1]];
    for (const [x, z] of P) {
      b.cylBetween('chrome', [x, 0.02, z], [x, 1.8, z], 0.012, 0.012, 5);
      b.box('rubber', 0.03, 0.02, 0.03, { p: [x, 0.01, z] });
    }
    for (let k = 0; k < 3; k++) {
      const [x0, z0] = P[k], [x1, z1] = P[k + 1], L = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / L, nz = (x1 - x0) / L;
      for (const y of [0.22, 1.74]) b.cylBetween('chrome', [x0, y, z0], [x1, y, z1], 0.008, 0.008, 4);
      const torn = k === 2, drop = [];
      for (let i = 0; i <= 4; i++) drop.push(torn ? 0.25 + r() * 0.75 : r() * 0.05);
      sheet(b, 'cloth', 4, 2, (u, vv, i, j) => {
        const t = 0.015 + u * 0.97, p = (i % 4 ? (i % 2 ? 0.02 : -0.02) : 0) * (j === 0 ? 0.3 : 1);
        return [x0 + (x1 - x0) * t + nx * p, 1.735 - vv * (1.505 - drop[i]), z0 + (z1 - z0) * t + nz * p];
      }, { c: col, cfn: stain });
    }
    return;
  }
  for (const sx of [-1, 1]) {
    b.cylBetween('chrome', [sx, 0.09, 0], [sx, 1.9, 0], 0.014, 0.014, 5);
    b.cylBetween('chrome', [sx, 0.09, -0.21], [sx, 0.09, 0.21], 0.014, 0.014, 4);
    for (const sz of [-1, 1]) b.cyl('rubber', 0.04, 0.04, 0.03, 5, { p: [sx, 0.04, sz * 0.2], r: [0, 0, PI / 2] });
  }
  b.cylBetween('chrome', [-1, 1.88, 0], [1, 1.88, 0], 0.012, 0.012, 5);
  b.cylBetween('chrome', [-1, 0.3, 0], [1, 0.3, 0], 0.012, 0.012, 5);
  // the curtain: pleats, the far end fallen off its hooks, the hem in rags
  const N = 14, hem = [];
  for (let i = 0; i <= N; i++) hem.push(r() < 0.35 ? rr(r, 0.1, 0.45) : rr(r, 0, 0.05));
  sheet(b, 'cloth', N, 3, (u, vv, i, j) => {
    const off = Math.max(0, u - 0.68) / 0.32, sag = off * off * 0.62, y0 = 1.84 - sag, y1 = 0.42 + hem[i] * (1 - off);
    return [-0.95 + u * 1.9 - off * 0.12, y0 + (y1 - y0) * vv, (i % 2 ? 0.035 : -0.035) * (j === 0 && !off ? 0.5 : 1) + off * 0.05 * vv];
  }, { c: col, cfn: stain });
  for (let i = 0; i <= 9; i += 2) b.box('chrome', 0.008, 0.05, 0.008, { p: [-0.95 + (i / N) * 1.9, 1.86, 0] });
};

// An ambulance stretcher on its scissor legs, the straps hanging (0); or folded flat and thrown on its side (1).
INTERIOR_PROPS.gurney = (b, r, v) => {
  const H = v ? 0.3 : 0.7, pad = v ? [0.2, 0.2, 0.22] : [0.6, 0.26, 0.1];
  const build = () => {
    for (const sx of [-1, 1]) {
      const x = sx * 0.26;
      b.cylBetween('steel', [x, 0.13, -0.78], [x, 0.13, 0.78], 0.014, 0.014, 4);
      for (const sz of [-1, 1]) {
        b.cyl('rubber', 0.06, 0.06, 0.035, 5, { p: [x, 0.06, sz * 0.78], r: [0, 0, PI / 2] });
        b.cylBetween('steel', [x, 0.13, sz * 0.7], [x, H - 0.01, -sz * 0.6], 0.013, 0.013, 4);
      }
      b.cylBetween('chrome', [sx * 0.29, H, -0.93], [sx * 0.29, H, 0.93], 0.014, 0.014, 5);
      // the side rail, folded down beside the frame
      if (!v) {
        b.cylBetween('chrome', [sx * 0.31, H - 0.16, -0.4], [sx * 0.31, H - 0.16, 0.3], 0.009, 0.009, 3);
        for (const z of [-0.4, 0.3]) b.cylBetween('chrome', [sx * 0.31, H - 0.16, z], [sx * 0.3, H, z], 0.009, 0.009, 3);
      }
    }
    for (const sz of [-1, 1]) {
      b.cylBetween('steel', [-0.26, 0.13, sz * 0.5], [0.26, 0.13, sz * 0.5], 0.014, 0.014, 4);
      b.cylBetween('chrome', [-0.29, H, sz * 0.93], [0.29, H, sz * 0.93], 0.014, 0.014, 5);
    }
    // the deck and its pads: the back section raised a little (0)
    const section = (len, o) =>
      b.group(o, () => {
        b.box('paint', 0.56, 0.02, len, { p: [0, 0.01, len / 2], c: [0.2, 0.2, 0.2] });
        stack(b, 'cloth', [[0.5, len - 0.06, 0.02], [0.54, len - 0.02, 0.04], [0.54, len - 0.02, 0.07], [0.5, len - 0.06, 0.09]].map(([w, d, y]) => [w, d, y, 0, len / 2]), { c: pad });
      });
    section(1.26, { p: [0, H, -0.9] });
    section(0.54, { p: [0, H, 0.36], r: [v ? 0 : -0.2, 0, 0] });
    // the straps
    for (const z of [-0.6, -0.1]) {
      sheet(b, 'cloth', 4, 1, (u, vv, i) => [[-0.3, -0.275, 0, 0.275, 0.3][i], H + (i % 4 ? 0.094 : v ? 0.06 : -0.2 + r() * 0.1), z + vv * 0.05 + (i % 4 ? 0 : rr(r, -0.03, 0.03))], { c: [0.1, 0.1, 0.1] });
      b.box('chrome', 0.05, 0.012, 0.06, { p: [0.08, H + 0.1, z + 0.025] });
    }
  };
  if (v) b.group({ p: [0.2, 0.31, 0], r: [0, 0, PI / 2] }, build);
  else build();
};

// A crash cart: drawers pulled, one gone, bottles and a dish left on top.
INTERIOR_PROPS.medical_cart = (b, r) => {
  const red = [0.55, 0.15, 0.12], cx = -0.03, zf = -0.08, zb = 0.21, D = zb - zf, cz = (zf + zb) / 2, y0 = 0.1, top = 0.76;
  b.box('paint', 0.5, top - 0.02 - y0, D, { p: [cx, (top - 0.02 + y0) / 2, cz], c: red });
  b.box('steel', 0.52, 0.02, D + 0.02, { p: [cx, top - 0.01, cz] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('rubber', 0.05, 0.05, 0.03, 5, { p: [cx + sx * 0.2, 0.05, cz + sz * 0.1], r: [0, 0, PI / 2] });
  const rh = (top - 0.02 - y0 - 0.02) / 4;
  [0, -1, 0.09, 0].forEach((out, k) => {
    const y = y0 + 0.01 + (k + 0.5) * rh;
    if (out < 0) return b.box('dark', 0.46, rh - 0.01, 0.004, { p: [cx, y, zf - 0.002] });
    b.group({ p: [cx, y, zf - 0.01 - out] }, () => {
      drawer(b, 'paint', 0.46, rh - 0.01, out ? 0.26 : 0, mul(red, 1.1), null);
      b.plane('dark', 0.16, 0.02, { p: [0, 0.035, -0.0105], r: [0, PI, 0] });
    });
  });
  b.cylBetween('chrome', [cx + 0.24, 0.66, zf + 0.04], [cx + 0.3, 0.72, zf + 0.04], 0.009, 0.009, 3);
  b.cylBetween('chrome', [cx + 0.3, 0.72, zf + 0.035], [cx + 0.3, 0.72, zb - 0.03], 0.009, 0.009, 3);
  b.cylBetween('chrome', [cx + 0.3, 0.72, zb - 0.035], [cx + 0.24, 0.66, zb - 0.035], 0.009, 0.009, 3);
  b.cyl('bottle_brown', 0.03, 0.035, 0.13, 6, { p: [cx - 0.14, top + 0.065, cz + 0.06] });
  b.cyl('paint', 0.028, 0.028, 0.09, 6, { p: [cx - 0.03, top + 0.045, cz + 0.02], c: [0.85, 0.85, 0.8] });
  lay(b, 'steel', 0.2, 0.03, 0.1, cx + 0.13, top, cz - 0.03, [0, 0.4, 0]);
};

// ================================================================== the picture house, the subway
// A row of four tip-up cinema seats on a floor rail: some down, a back ripped off its frame.
INTERIOR_PROPS.cinema_seats = (b, r, v) => {
  const red = v ? [0.36, 0.1, 0.1] : [0.46, 0.12, 0.1], arm = mul(WOODS[4], 0.5);
  b.box('iron', 2.13, 0.04, 0.1, { p: [0, 0.02, 0.1] });
  for (let k = 0; k < 5; k++) {
    const x = -1.04 + k * 0.52;
    b.box('iron', 0.05, 0.56, 0.3, { p: [x, 0.32, 0.1] });
    b.box('wood', 0.07, 0.035, 0.36, { p: [x, 0.6175, 0.06], c: arm });
  }
  const seats = v ? ['down', 'up', '', 'up'] : ['up', 'down', 'up', 'cut'], backs = v ? [1, 0, 1, 1] : [1, 1, 0, 1];
  for (let k = 0; k < 4; k++) {
    const x = -0.78 + k * 0.52, c = mul(red, rr(r, 0.85, 1.05));
    if (backs[k])
      b.group({ p: [x, 0.42, 0.2], r: [0.18, 0, 0] }, () => {
        stack(b, 'cloth', [[0.42, 0.06, 0], [0.46, 0.1, 0.06], [0.46, 0.1, 0.44], [0.42, 0.06, 0.5]], { c });
        b.box('plastic', 0.46, 0.5, 0.012, { p: [0, 0.25, 0.056] });
      });
    else for (const sx of [-1, 1]) b.box('iron', 0.03, 0.2, 0.02, { p: [x + sx * 0.2, 0.52, 0.22], r: [0.18, 0, sx * 0.1] }); // the brackets it was torn from
    if (seats[k])
      b.group({ p: [x, 0.42, 0.14], r: [seats[k] === 'up' ? 1.35 : -0.04, 0, 0] }, () => {
        cushion(b, 0.46, 0.09, 0.42, c, { p: [0, 0.01, -0.21] });
        b.box('plastic', 0.46, 0.015, 0.42, { p: [0, -0.042, -0.21] });
        if (seats[k] === 'cut') {
          b.box('dark', 0.26, 0.004, 0.012, { p: [0, 0.057, -0.2], r: [0, 0.6, 0] });
          b.sphere('cloth', 0.05, 5, 3, { p: [0.03, 0.065, -0.18], s: [1.4, 0.5, 1], c: STUFFING });
        }
      });
  }
};

// A line of three subway turnstile housings, the two lanes between them open: the tripod arms hang or are gone.
INTERIOR_PROPS.turnstiles = (b, r) => {
  for (const x of [-1.1, 0, 1.1]) {
    b.box('dark', 0.31, 0.05, 1.14, { p: [x, 0.025, 0] });
    stack(b, 'steel', [[0.33, 1.16, 0.05], [0.33, 1.16, 0.9], [0.25, 1.08, 0.98]].map(([w, d, y]) => [w, d, y, x, 0]));
    b.box('chrome', 0.18, 0.006, 0.6, { p: [x, 0.983, 0.1] });
    // the coin unit at the way in, its slot
    b.box('paint', 0.2, 0.1, 0.2, { p: [x, 1.03, -0.4], c: [0.5, 0.42, 0.14] });
    b.box('dark', 0.05, 0.004, 0.012, { p: [x, 1.082, -0.4] });
    b.box('dark', 0.12, 0.07, 0.004, { p: [x, 0.8, -0.582] });
    b.box('rust', 0.08 + r() * 0.1, 0.1 + r() * 0.15, 0.004, { p: [x + rr(r, -0.08, 0.08), 0.15, -0.582] });
  }
  [-1.1, 0].forEach((x, k) => {
    const hx = x + 0.165, h = [hx + 0.045, 0.82, -0.05];
    b.cyl('chrome', 0.07, 0.08, 0.09, 6, { p: h, r: [0, 0, -PI / 2] });
    const arm = (a, len) => b.cylBetween('chrome', [h[0] + 0.03, h[1] + Math.cos(a) * 0.04, h[2] + Math.sin(a) * 0.04], [h[0] + 0.03 + len * 0.25, h[1] + Math.cos(a) * (0.04 + len), h[2] + Math.sin(a) * (0.04 + len)], 0.016, 0.018, 4);
    if (k === 0) arm(PI, 0.42); // one arm left, hanging
    else tin(b, r, x + 0.5, 0, 0.25, true, 5, 0.017, 0.42, [0.6, 0.6, 0.6]); // on the floor of the lane
    arm(PI / 3, 0.07);
    arm(-PI / 3, 0.06);
    if (k) arm(PI, 0.05);
  });
};

/** a plain wooden chair standing on y = 0, its back at +Z (0.9 high) */
function woodChair(b, c) {
  b.box('wood', 0.42, 0.03, 0.4, { p: [0, 0.45, 0], c });
  for (const sx of [-1, 1]) {
    b.box('wood', 0.036, 0.435, 0.036, { p: [sx * 0.19, 0.2175, -0.18], c });
    b.box('wood', 0.036, 0.9, 0.036, { p: [sx * 0.19, 0.45, 0.18], c });
  }
  for (const y of [0.63, 0.81]) b.box('wood', 0.38, 0.06, 0.02, { p: [0, y, 0.18], c });
  b.box('wood', 0.38, 0.03, 0.02, { p: [0, 0.2, -0.18], c });
}

// A doorway (behind it, at +Z) blocked from this side: 0 a table on its side against the door, a cupboard shoved
// against that, chairs, planks nailed across; 1 a mattress stood against it, a bookcase on its side, chairs, a brace.
INTERIOR_PROPS.door_barricade = (b, r, v) => {
  const t = WOODS[1], dark = mul(WOODS[4], 0.7);
  if (v === 0) {
    b.group({ p: [-0.14, 0.4, -0.38], r: [PI / 2, 0, 0] }, () => {
      b.box('wood', 1.3, 0.04, 0.8, { p: [0, 0.74, 0], c: t });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('wood', 0.06, 0.72, 0.06, { p: [sx * 0.59, 0.36, sz * 0.34], c: t });
      for (const sz of [-1, 1]) b.box('wood', 1.12, 0.08, 0.025, { p: [0, 0.68, sz * 0.34], c: t });
    });
    // the cupboard between its legs, a chair thrown up on that, another jammed in beside it
    b.box('wood', 0.8, 0.7, 0.38, { p: [-0.14, 0.35, -0.12], c: dark });
    for (const y of [0.2, 0.5]) b.group({ p: [-0.14, y, -0.32] }, () => drawer(b, 'wood', 0.74, 0.27, 0, mul(dark, 1.1)));
    b.group({ p: [-0.14, 0.7, -0.12], r: [0, 0.12, 0] }, () => woodChair(b, WOODS[3]));
    b.group({ p: [0.56, 0, -0.12], r: [0, PI, 0] }, () => woodChair(b, WOODS[0]));
    for (const [y, a, w] of [[1.0, 0.05, 0.14], [1.3, -0.04, 0.12], [1.56, 0.03, 0.15]]) plank(b, 'wood', 1.56, w, 0.025, { p: [0, y, 0.385], r: [0, 0, a], c: pick(r, WOODS) });
    return;
  }
  stack(b, 'mattress', [[1.36, 1.56, -0.09], [1.4, 1.6, -0.05], [1.4, 1.6, 0.05], [1.36, 1.56, 0.09]], { p: [0, 0.805, 0.24], r: [-PI / 2 + 0.07, 0, 0] });
  // a bookcase on its side, open to the room
  const L = 1.5, bh = 0.42, bz = -0.1, bd = 0.34;
  for (const y of [0.01, bh - 0.01]) b.box('wood', L, 0.02, bd, { p: [0, y, bz], c: dark });
  for (const x of [-L / 2 + 0.01, -0.25, 0.25, L / 2 - 0.01]) b.box('wood', 0.02, bh - 0.04, bd, { p: [x, bh / 2, bz], c: dark });
  b.box('wood', L, bh - 0.04, 0.01, { p: [0, bh / 2, bz + bd / 2 - 0.005], c: mul(dark, 0.6) });
  for (const [x, yaw] of [[-0.5, 0.3], [0.1, -0.4]]) lay(b, 'paint', 0.15, 0.04, 0.21, x, 0.02, bz - 0.02, [0, yaw, 0], { c: pick(r, BOOKS) });
  b.group({ p: [0.3, bh, bz - 0.01], r: [0, -0.15, 0] }, () => woodChair(b, WOODS[3]));
  b.group({ p: [-0.4, bh, bz - 0.01], r: [0, PI + 0.2, 0] }, () => woodChair(b, WOODS[0]));
  plank(b, 'wood', 0.1, 1.2, 0.04, { p: [0.72, 0.56, -0.1], r: [0.44, 0, 0], c: WOODS[2] });
  plank(b, 'wood', 1.5, 0.12, 0.025, { p: [0, 1.5, 0.1], r: [0, 0, 0.05], c: WOODS[4] });
};
