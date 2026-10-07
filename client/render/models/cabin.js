// What a vehicle is like behind its glass: bodies built as shells with window openings in them (not as solids with a
// black panel where a window would be), the panes that stand in those openings, and what is inside - seats, a dash,
// a wheel, whatever was left there. Used by every vehicle builder (props.js, props-street.js).
//
// Three materials (materials.js):
//   carglass    a pane. Its vertex colour is what it is like, not a colour: [how dirty, its tint, blood on it]
//   cabin       the lining of a shell: seen as far as the vehicle is, and what casts the body's shadow from inside
//   cabin_fine  everything in it (seats, a dash, a wheel, a load, bones, rubbish): the static world draws that from
//               near only (55 m), and it casts no shadow - a street of several hundred cars is lined, not furnished
// A shell's lining is what casts the body's shadow from the inside, so the sun comes in at the windows.
//
// Everything is in the builder's current frame (front to -Z), and nothing here draws a random number that the
// builder did not hand it: what a vehicle carries is its variant's (createProp: the seed picks the variant).
import * as THREE from 'three';

const PI = Math.PI;
export const LINING = [0.2, 0.19, 0.17]; // a headliner gone grey
export const CHAR = [0.06, 0.055, 0.05]; // the same after a fire
export const SEATS = [[0.3, 0.27, 0.23], [0.34, 0.2, 0.13], [0.2, 0.25, 0.32], [0.27, 0.29, 0.24], [0.4, 0.36, 0.28], [0.3, 0.12, 0.1]];
const DASH = [0.11, 0.11, 0.11], FLOOR = [0.13, 0.12, 0.11], BONE = [0.7, 0.66, 0.54], BLOOD = [0.2, 0.03, 0.025];
const mul = (c, k) => c.map((q) => q * k);

// ------------------------------------------------------------------ a soup of faces, each wound to face a way
class Soup {
  constructor() {
    this.v = [];
    this.f = [];
  }
  tri(a, b, c, n) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const d = (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2];
    const i = this.v.length;
    this.v.push(a, b, c);
    this.f.push(d >= 0 ? [i, i + 1, i + 2] : [i, i + 2, i + 1]);
  }
  quad(a, b, c, d, n) {
    this.tri(a, b, c, n);
    this.tri(a, c, d, n);
  }
  emit(b, mat, o) {
    if (this.f.length) b.poly(mat, this.v, this.f, o);
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const bil = (R, u, v) => mix3(mix3(R[0], R[1], u), mix3(R[3], R[2], u), v);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const uniq = (list) => [...new Set(list.map((x) => +x.toFixed(5)))].sort((a, b) => a - b);

/**
 * A pane in an opening is one of: undefined (glass, as the vehicle's look has it), 'gone' / false (none), 'shard' /
 * 'shard2' (a tooth of it left in a bottom corner), 'blood' (smeared from inside), or [dirt, tint, blood] itself.
 * What a pane is like: [dirt, tint, blood] for `carglass`. base: the vehicle's own (0 clean .. 1 caked), k: which
 * pane of it (no two alike, and none of it random: the same on every client).
 */
export function paneLook(base = 0.45, k = 0, blood = 0) {
  const h = Math.sin(k * 12.9898 + base * 78.233) * 43758.5453;
  const f = h - Math.floor(h);
  return [Math.min(1, Math.max(0.04, base + (f - 0.5) * 0.5)), (f * 7.13) % 1 > 0.6 ? 0.8 : 0.15, blood];
}

// a pane in an opening: 'gone' / false: none; 'shard': what is left of one, a tooth in a corner; an array: its look
function pane(b, q, n, g, look) {
  if (g === false || g === 'gone') return;
  const c = Array.isArray(g) ? g : g === 'blood' ? [Math.min(1, look[0] + 0.2), look[1], 0.9] : look;
  const s = new Soup();
  if (g === 'shard' || g === 'shard2') {
    const [a, d] = g === 'shard' ? [q[0], q[1]] : [q[1], q[0]];
    const up = g === 'shard' ? q[3] : q[2];
    s.tri(a, mix3(a, d, 0.62), mix3(a, up, 0.7), n);
    s.tri(mix3(a, d, 0.62), mix3(a, d, 0.9), mix3(mix3(a, d, 0.8), up, 0.24), n);
  } else s.quad(q[0], q[1], q[2], q[3], n);
  s.emit(b, 'carglass', { c });
}

// ------------------------------------------------------------------ shells
const FACES = { xn: [0, 4, 6, 2], xp: [1, 5, 7, 3], zn: [0, 1, 3, 2], zp: [4, 5, 7, 6], yn: [0, 1, 5, 4], yp: [2, 3, 7, 6] };

/**
 * A hollow six-sided body with openings in its faces. C: its 8 corners, indexed (x>0) + 2 (y>0) + 4 (z>0) as
 * MeshBuilder.hull's. Faces: xn, xp (the sides), zn (the front), zp (the back), yn, yp.
 * o.holes: { face: [[u0, u1, v0, v1, pane]] } - an opening in a face, as fractions of it: u along it (a side: front
 *   to back; the front and the back: -x to +x), v up it (the roof and the floor: u across, v front to back).
 *   pane: see `pane` above (default: glass).
 * o.skip: faces left out altogether (a cab open underneath into the body it stands on); o.bare: faces with no skin
 * outside (the lining only: a roof that is a separate lid); o.unlined: faces with no lining.
 * o.t: how thick its walls are; o.c / o.cfn: the paint; o.lining: the lining's colour (false: none); o.look: its panes.
 */
export function hullShell(b, mat, C, o = {}) {
  const t = o.t ?? 0.04, lining = o.lining === undefined ? LINING : o.lining;
  const ctr = [0, 0, 0];
  for (const p of C) for (let k = 0; k < 3; k++) ctr[k] += p[k] / 8;
  const skip = o.skip || [];
  // (the walls run on through a face that is left out: only their ends show there, as a rim)
  const In = C.map((p) => p.map((q, k) => (skip.includes('xyz'[k] + (q > ctr[k] ? 'p' : 'n')) ? q : q - Math.sign(q - ctr[k]) * t)));
  const skin = new Soup(), line = new Soup();
  let np = o.pane0 || 0;
  for (const [name, idx] of Object.entries(FACES)) {
    const P = idx.map((k) => C[k]), Q = idx.map((k) => In[k]);
    let n = cross(sub(P[1], P[0]), sub(P[3], P[0]));
    const mid = bil(P, 0.5, 0.5);
    if (n[0] * (mid[0] - ctr[0]) + n[1] * (mid[1] - ctr[1]) + n[2] * (mid[2] - ctr[2]) < 0) n = [-n[0], -n[1], -n[2]];
    if (skip.includes(name)) {
      for (let k = 0; k < 4; k++) skin.quad(P[k], P[(k + 1) % 4], Q[(k + 1) % 4], Q[k], n);
      continue;
    }
    const back = [-n[0], -n[1], -n[2]];
    const holes = (o.holes && o.holes[name]) || [];
    const us = uniq([0, 1, ...holes.flatMap((h) => [h[0], h[1]])]), vs = uniq([0, 1, ...holes.flatMap((h) => [h[2], h[3]])]);
    const bare = o.bare && o.bare.includes(name), unlined = lining === false || (o.unlined && o.unlined.includes(name));
    // (band by band up the face, each run of it between two openings one piece: a strip under the windows, one over
    // them, the posts between - a jam in a street is several hundred of these shells)
    for (let j = 0; j < vs.length - 1; j++) {
      const vm = (vs[j] + vs[j + 1]) / 2;
      const open = (i) => holes.some((h) => (us[i] + us[i + 1]) / 2 > h[0] && (us[i] + us[i + 1]) / 2 < h[1] && vm > h[2] && vm < h[3]);
      for (let i = 0; i < us.length - 1; i++) {
        if (open(i)) continue;
        let k = i;
        while (k + 1 < us.length - 1 && !open(k + 1)) k++;
        const at = (R) => [bil(R, us[i], vs[j]), bil(R, us[k + 1], vs[j]), bil(R, us[k + 1], vs[j + 1]), bil(R, us[i], vs[j + 1])];
        if (!bare) skin.quad(...at(P), n);
        if (!unlined) line.quad(...at(Q), back);
        i = k;
      }
    }
    for (const h of holes) {
      const cn = (R) => [bil(R, h[0], h[2]), bil(R, h[1], h[2]), bil(R, h[1], h[3]), bil(R, h[0], h[3])];
      const a = cn(P), c = cn(Q);
      const hc = mix3(bil(P, (h[0] + h[1]) / 2, (h[2] + h[3]) / 2), bil(Q, (h[0] + h[1]) / 2, (h[2] + h[3]) / 2), 0.5);
      // the reveal: the wall's thickness, round the opening
      for (let k = 0; k < 4; k++) {
        const k1 = (k + 1) % 4;
        const m = mix3(mix3(a[k], a[k1], 0.5), mix3(c[k], c[k1], 0.5), 0.5);
        skin.quad(a[k], a[k1], c[k1], c[k], sub(hc, m));
      }
      pane(b, a.map((p, k) => mix3(p, c[k], 0.4)), n, h[4], o.look ? o.look(np) : paneLook(0.45, np));
      np++;
    }
  }
  skin.emit(b, mat, { c: o.c, cfn: o.cfn });
  if (lining !== false) line.emit(b, 'cabin', { c: lining });
  return np;
}

/** hullShell for a box: sx by sy by sz about p. o.holes in metres about the box's middle: [a0, a1, b0, b1, pane]. */
export function boxShell(b, mat, sx, sy, sz, o = {}) {
  const [px, py, pz] = o.p || [0, 0, 0];
  const C = [];
  for (let k = 0; k < 8; k++) C.push([px + ((k & 1 ? 1 : -1) * sx) / 2, py + ((k & 2 ? 1 : -1) * sy) / 2, pz + ((k & 4 ? 1 : -1) * sz) / 2]);
  const dims = { xn: [sz, sy], xp: [sz, sy], zn: [sx, sy], zp: [sx, sy], yn: [sx, sz], yp: [sx, sz] };
  const holes = {};
  for (const [f, list] of Object.entries(o.holes || {})) holes[f] = list.map(([a0, a1, b0, b1, g]) => [a0 / dims[f][0] + 0.5, a1 / dims[f][0] + 0.5, b0 / dims[f][1] + 0.5, b1 / dims[f][1] + 0.5, g]);
  return hullShell(b, mat, C, { ...o, holes });
}

/**
 * A side profile [[z, y], ...] across the width W (as an extruded body), hollow, with openings.
 * o.sides: { L: [[z0, z1, y0, y1, pane]], R: [...] } - windows in its two flat sides (L: -x).
 * o.edges: [{ at: [[z, y], [z, y]] (an edge of the profile, by its two ends), holes: [[x0, x1, t0, t1, pane]] }] -
 *   openings in the face across that edge: x across the body (metres), t along the edge from its lower end (0..1; a
 *   level edge: from its front end).
 * o.cx: where its middle is; o.t, o.c, o.cfn, o.lining, o.look: as hullShell's. o.open: edges left out (by their ends).
 */
export function profShell(b, mat, pts, W, o = {}) {
  const t = o.t ?? 0.04, hw = W / 2, cx = o.cx || 0, lining = o.lining === undefined ? LINING : o.lining;
  const same = (p, q) => Math.abs(p[0] - q[0]) < 2e-3 && Math.abs(p[1] - q[1]) < 2e-3;
  // the profile, with a corner put in wherever an opening in a face begins or ends along it
  const P = [], cut = []; // cut[i]: the openings of the stretch from P[i] to P[i + 1]: [[x0, x1, pane]], or 'open'
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    if (same(a, c)) continue;
    const isE = (e) => (same(e.at[0], a) && same(e.at[1], c)) || (same(e.at[0], c) && same(e.at[1], a));
    const e = (o.edges || []).find(isE);
    const gone = (o.open || []).some((q) => isE({ at: q }));
    if (!e) {
      P.push(a);
      cut.push(gone ? 'open' : null);
      continue;
    }
    // t runs from the lower end (a level edge: from the front)
    const flip = Math.abs(a[1] - c[1]) > 1e-4 ? a[1] > c[1] : a[0] > c[0];
    const ts = uniq([0, 1, ...e.holes.flatMap((h) => [h[2], h[3]])]);
    const seq = flip ? ts.map((q) => 1 - q).reverse() : ts;
    for (let k = 0; k < seq.length - 1; k++) {
      P.push([a[0] + (c[0] - a[0]) * seq[k], a[1] + (c[1] - a[1]) * seq[k]]);
      const tm = flip ? 1 - (seq[k] + seq[k + 1]) / 2 : (seq[k] + seq[k + 1]) / 2;
      cut.push(e.holes.filter((h) => tm > h[2] && tm < h[3]).map((h) => [h[0], h[1], h[4]]));
    }
  }
  const n = P.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += P[i][0] * P[(i + 1) % n][1] - P[(i + 1) % n][0] * P[i][1];
  const sg = area > 0 ? 1 : -1;
  // each edge's way out, and the profile drawn in by the wall's thickness
  const out = P.map((a, i) => {
    const c = P[(i + 1) % n], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    return [(sg * (c[1] - a[1])) / l, (-sg * (c[0] - a[0])) / l];
  });
  const I = P.map((a, i) => {
    const n0 = out[(i + n - 1) % n], n1 = out[i];
    const mx = n0[0] + n1[0], my = n0[1] + n1[1];
    const k = t / Math.max(0.35, (mx * n1[0] + my * n1[1]) / 2) / 2;
    return [a[0] - mx * k, a[1] - my * k];
  });
  const skin = new Soup(), line = new Soup();
  const X = (p, x) => [cx + x, p[1], p[0]];
  let np = o.pane0 || 0;
  const look = () => (o.look ? o.look(np++) : paneLook(0.45, np++));
  for (let i = 0; i < n; i++) {
    if (cut[i] === 'open') continue;
    const j = (i + 1) % n, nrm = [0, out[i][1], out[i][0]], back = [0, -nrm[1], -nrm[2]];
    const holes = cut[i] || [];
    const xs = uniq([-hw, hw, ...holes.flatMap((h) => [h[0], h[1]])]);
    for (let k = 0; k < xs.length - 1; k++) {
      const xm = (xs[k] + xs[k + 1]) / 2;
      const h = holes.find((q) => xm > q[0] && xm < q[1]);
      const xi = (x) => Math.max(-hw + t, Math.min(hw - t, x));
      const a = [X(P[i], xs[k]), X(P[i], xs[k + 1]), X(P[j], xs[k + 1]), X(P[j], xs[k])];
      const c = [X(I[i], xi(xs[k])), X(I[i], xi(xs[k + 1])), X(I[j], xi(xs[k + 1])), X(I[j], xi(xs[k]))];
      if (!h) {
        skin.quad(...a, nrm);
        if (lining !== false) line.quad(...c, back);
        continue;
      }
      const hc = mix3(mix3(a[0], a[2], 0.5), mix3(c[0], c[2], 0.5), 0.5);
      for (let q = 0; q < 4; q++) {
        const q1 = (q + 1) % 4;
        skin.quad(a[q], a[q1], c[q1], c[q], sub(hc, mix3(mix3(a[q], a[q1], 0.5), mix3(c[q], c[q1], 0.5), 0.5)));
      }
      pane(b, a.map((p, q) => mix3(p, c[q], 0.4)), nrm, h[2], look());
    }
  }
  // the two flat sides: the profile's face, its windows cut out of it
  for (const sx of [-1, 1]) {
    const wins = (o.sides && o.sides[sx < 0 ? 'L' : 'R']) || [];
    const face = (poly, x, nx, soup) => {
      const s = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
      for (const [z0, z1, y0, y1] of wins) s.holes.push(new THREE.Path([new THREE.Vector2(z0, y0), new THREE.Vector2(z1, y0), new THREE.Vector2(z1, y1), new THREE.Vector2(z0, y1)]));
      const g = new THREE.ShapeGeometry(s);
      const pos = g.attributes.position, idx = g.index;
      for (let f = 0; f < idx.count; f += 3) soup.tri(...[0, 1, 2].map((k) => [cx + x, pos.getY(idx.getX(f + k)), pos.getX(idx.getX(f + k))]), [nx, 0, 0]);
      g.dispose();
    };
    face(P, sx * hw, sx, skin);
    if (lining !== false) face(I, sx * (hw - t), -sx, line);
    for (const [z0, z1, y0, y1, g] of wins) {
      const at = (x) => [[cx + x, y0, z0], [cx + x, y0, z1], [cx + x, y1, z1], [cx + x, y1, z0]];
      const a = at(sx * hw), c = at(sx * (hw - t));
      const hc = [cx + sx * (hw - t / 2), (y0 + y1) / 2, (z0 + z1) / 2];
      for (let q = 0; q < 4; q++) {
        const q1 = (q + 1) % 4;
        skin.quad(a[q], a[q1], c[q1], c[q], sub(hc, mix3(mix3(a[q], a[q1], 0.5), mix3(c[q], c[q1], 0.5), 0.5)));
      }
      pane(b, at(sx * (hw - t * 0.4)), [sx, 0, 0], g, look());
    }
  }
  skin.emit(b, mat, { c: o.c, cfn: o.cfn });
  if (lining !== false) line.emit(b, 'cabin', { c: lining });
  return np;
}

/** a flat leaf with a window through it (a door, a wall): w by h by t about p, facing along `axis` ('x' | 'z'). win: [a0, a1, y0, y1] about its middle */
export function leaf(b, mat, w, h, t, win, o = {}) {
  const [a0, a1, y0, y1] = win;
  const x = o.axis === 'x';
  const bx = (cw, ch, ca, cy) => b.box(mat, x ? t : cw, ch, x ? cw : t, { p: x ? [0, cy, ca] : [ca, cy, 0], c: o.c, cfn: o.cfn });
  bx(w, h / 2 + y0, 0, (-h / 2 + y0) / 2);
  bx(w, h / 2 - y1, 0, (h / 2 + y1) / 2);
  bx(a0 + w / 2, y1 - y0, (-w / 2 + a0) / 2, (y0 + y1) / 2);
  bx(w / 2 - a1, y1 - y0, (w / 2 + a1) / 2, (y0 + y1) / 2);
  if (o.pane === false) return;
  const q = x ? [[0, y0, a0], [0, y0, a1], [0, y1, a1], [0, y1, a0]] : [[a0, y0, 0], [a1, y0, 0], [a1, y1, 0], [a0, y1, 0]];
  pane(b, q, x ? [1, 0, 0] : [0, 0, 1], o.pane, o.look || paneLook(0.5, 3));
}

// ------------------------------------------------------------------ what is in it
/**
 * A seat on the floor at y, its cushion's middle at (x, z), facing -Z (o.back: -1 faces +Z). o.w across, o.d deep,
 * o.h: the cushion's top above the floor, o.bh: the back's height, o.heads: headrests (0, 1, 2), o.c: its cover.
 */
export function seat(b, x, y, z, o = {}) {
  const w = o.w ?? 0.5, d = o.d ?? 0.48, h = o.h ?? 0.1, bh = o.bh ?? 0.6, s = o.back ?? 1, c = o.c || SEATS[0];
  const rake = (o.rake ?? 0.17) * s;
  b.box('cabin_fine', w, Math.min(0.13, h), d, { p: [x, y + h - Math.min(0.13, h) / 2, z], c });
  if (h > 0.16) b.box('cabin_fine', w * 0.8, h - 0.13, d * 0.7, { p: [x, y + (h - 0.13) / 2, z], c: mul(c, 0.5) });
  const zb = z + s * (d / 2 + 0.02);
  b.group({ p: [x, y + h - 0.03, zb], r: [rake, 0, 0] }, () => {
    b.box('cabin_fine', w, bh, 0.1, { p: [0, bh / 2, 0], c });
    const n = o.heads ?? 1;
    for (let k = 0; k < n; k++) b.box('cabin_fine', Math.min(0.26, w * 0.5), 0.16, 0.08, { p: [n === 1 ? 0 : (k - 0.5) * w * 0.52, bh + 0.11, 0], c: mul(c, 0.9) });
  });
}

/** the dash across a cab: its top at y, its edge towards the screen at z (it comes back d from there), w across */
export function dash(b, y, z, w, o = {}) {
  const d = o.d ?? 0.3, h = o.h ?? 0.26, c = o.c || DASH;
  b.box('cabin_fine', w, h, d, { p: [0, y - h / 2, z + d / 2], c });
  if (o.bare) return;
  const wx = o.wheelX ?? -w * 0.25;
  b.box('cabin_fine', 0.34, 0.07, d * 0.6, { p: [wx, y + 0.035, z + d * 0.5], c: mul(c, 0.8) }); // the binnacle
  b.box('cabin_fine', 0.28, 0.008, 0.012, { p: [wx, y + 0.05, z + d * 0.8 + 0.004], r: [0.3, 0, 0], c: [0.42, 0.44, 0.4] }); // its dials, grey with dust
  if (!o.noGlove) b.box('cabin_fine', 0.32, 0.1, 0.012, { p: [-wx, y - 0.13, z + d + 0.004], r: [o.gloveOpen ? 0.9 : 0, 0, 0], c: mul(c, 1.5) });
}

/** a steering wheel and its column: the wheel's middle at p, the column coming up to it from the dash ahead */
export function steering(b, p, o = {}) {
  const R = o.R ?? 0.17, tilt = o.tilt ?? 0.42;
  b.cylBetween('cabin_fine', [p[0], p[1] - Math.cos(tilt) * 0.3, p[2] - Math.sin(tilt) * 0.3 - 0.06], [p[0], p[1] - 0.01, p[2] - 0.005], 0.022, 0.026, 5, { c: DASH });
  b.torus('cabin_fine', R, R * 0.11, 4, 9, PI * 2, { p, r: [-(PI / 2 - tilt), 0, 0], c: [0.07, 0.07, 0.07] });
  b.box('cabin_fine', R * 1.9, 0.03, 0.02, { p, r: [-(PI / 2 - tilt), 0, 0], c: [0.09, 0.09, 0.09] });
}

/** the mirror on the screen */
export function mirror(b, p) {
  b.box('cabin_fine', 0.2, 0.055, 0.02, { p, c: [0.3, 0.33, 0.34] });
  b.box('cabin_fine', 0.016, 0.07, 0.016, { p: [p[0], p[1] + 0.055, p[2] - 0.01], c: DASH });
}

/**
 * Somebody who never got out, sat on a seat: bones in what they wore, the head fallen forward or to one side.
 * at: the middle of the seat's cushion top; facing -Z (o.back: -1). o.lean: 0 forward on the wheel .. 1 sideways.
 * o.flesh: not bones yet (a body, the head dark).
 */
export function sitter(b, at, o = {}) {
  const s = o.back ?? 1, [x, y, z] = at;
  const shirt = o.shirt || [0.3, 0.3, 0.26], legs = o.legs || [0.16, 0.17, 0.2], skin = o.flesh ? [0.26, 0.2, 0.15] : BONE;
  const side = o.side ?? 1, lean = o.lean ?? 0;
  // thighs along the cushion, shins down in front of it
  for (const sx of [-1, 1]) {
    b.cylBetween('cabin_fine', [x + sx * 0.09, y + 0.07, z + s * 0.12], [x + sx * 0.11, y + 0.09, z - s * 0.24], 0.06, 0.055, 5, { c: legs });
    b.cylBetween('cabin_fine', [x + sx * 0.11, y + 0.09, z - s * 0.24], [x + sx * 0.1, y - 0.22, z - s * 0.36], 0.045, 0.04, 4, { c: legs });
  }
  // the trunk, slumped: forward over the wheel, or over to one side against the door
  const hip = [x, y + 0.08, z + s * 0.12];
  const sh = [x + side * lean * 0.2, y + 0.5 - lean * 0.06, z + s * (0.12 - (1 - lean) * 0.22)];
  b.group({ p: hip }, () => {
    const d = sub(sh, hip);
    const rx = Math.atan2(d[2], d[1]), rz = -Math.atan2(d[0], Math.hypot(d[1], d[2]));
    b.group({ p: [0, 0, 0], r: [rx, 0, rz] }, () => {
      b.box('cabin_fine', 0.34, 0.46, 0.17, { p: [0, 0.25, 0], c: shirt });
      b.box('cabin_fine', 0.4, 0.07, 0.15, { p: [0, 0.47, 0], c: mul(shirt, 0.85) }); // the shoulders
    });
  });
  const head = [sh[0] + side * (0.05 + lean * 0.1), sh[1] + 0.1, sh[2] - s * (0.1 - lean * 0.06)];
  b.sphere('cabin_fine', 0.095, 6, 4, { p: head, s: [0.88, 1, 1.05], c: skin });
  b.box('cabin_fine', 0.08, 0.04, 0.07, { p: [head[0], head[1] - 0.085, head[2] - s * 0.04], c: mul(skin, 0.85) });
  if (!o.flesh) for (const sx of [-1, 1]) b.box('cabin_fine', 0.028, 0.026, 0.02, { p: [head[0] + sx * 0.032, head[1] + 0.005, head[2] - s * 0.09], c: [0.03, 0.03, 0.03] });
  // arms: one hand still on the wheel or the door, the other in the lap
  const arm = (sx, hand) => {
    const a = [sh[0] + sx * 0.19, sh[1] - 0.03, sh[2]];
    const el = [a[0] + sx * 0.03, a[1] - 0.2, a[2] - s * 0.1];
    b.cylBetween('cabin_fine', a, el, 0.036, 0.04, 4, { c: shirt });
    b.cylBetween('cabin_fine', el, hand, o.flesh ? 0.03 : 0.014, o.flesh ? 0.034 : 0.016, 4, { c: o.flesh ? shirt : skin });
  };
  arm(-1, o.wheel ? [x - 0.1, y + 0.5, z - s * 0.42] : [x - 0.14, y + 0.12, z - s * 0.12]);
  arm(1, [x + 0.16, y + 0.12, z - s * 0.1]);
}

/** a case, a holdall and a box, stacked on a seat or a floor at p (its footprint about 0.9 by 0.45) */
export function luggage(b, p, k = 0, o = {}) {
  const [x, y, z] = p, r = o.r || 0;
  b.group({ p: [x, y, z], r: [0, r, 0] }, () => {
    b.box('cabin_fine', 0.5, 0.2, 0.34, { p: [-0.18, 0.1, 0], r: [0, 0.12, 0], c: [[0.4, 0.2, 0.16], [0.2, 0.26, 0.34], [0.34, 0.3, 0.2]][k % 3] });
    b.box('cabin_fine', 0.5, 0.02, 0.03, { p: [-0.18, 0.21, 0], r: [0, 0.12, 0], c: [0.09, 0.09, 0.09] });
    b.box('cabin_fine', 0.36, 0.18, 0.26, { p: [0.26, 0.09, 0.02], r: [0, -0.2, 0.06], c: [[0.24, 0.27, 0.2], [0.42, 0.34, 0.2], [0.22, 0.22, 0.24]][k % 3] });
    if (k % 2 === 0) b.box('cabin_fine', 0.3, 0.16, 0.24, { p: [-0.14, 0.29, 0.02], r: [0, -0.3, 0], c: [0.5, 0.42, 0.3] });
  });
}

/** a child's seat strapped to a seat's cushion at p */
export function childSeat(b, p, o = {}) {
  const [x, y, z] = p, c = o.c || [0.44, 0.24, 0.26];
  b.box('cabin_fine', 0.36, 0.1, 0.36, { p: [x, y + 0.05, z], c });
  b.box('cabin_fine', 0.36, 0.5, 0.09, { p: [x, y + 0.3, z + 0.2], r: [0.2, 0, 0], c });
  for (const sx of [-1, 1]) b.box('cabin_fine', 0.05, 0.3, 0.26, { p: [x + sx * 0.19, y + 0.24, z + 0.1], r: [0.2, 0, 0], c: mul(c, 0.8) });
  b.box('cabin_fine', 0.2, 0.012, 0.3, { p: [x, y + 0.11, z - 0.02], c: [0.5, 0.5, 0.44] }); // a blanket left in it
}

/** what collects on a floor or a seat: papers, a bottle, a can. n of them about p, spread sx by sz. pat: any numbers */
export function rubbish(b, p, sx, sz, n = 5, pat = 0) {
  const [x, y, z] = p;
  for (let k = 0; k < n; k++) {
    const u = Math.sin((k + 1) * 91.7 + pat * 7.3) * 0.5, w = Math.sin((k + 1) * 47.3 + pat * 3.1) * 0.5;
    const px = x + u * sx, pz = z + w * sz;
    if (k % 3 === 0) b.cyl('cabin_fine', 0.03, 0.035, 0.2, 5, { p: [px, y + 0.035, pz], r: [0, k, PI / 2], c: k % 2 ? [0.16, 0.26, 0.14] : [0.3, 0.2, 0.1] });
    else b.box('cabin_fine', 0.2 + (k % 2) * 0.08, 0.008, 0.16, { p: [px, y + 0.006 + k * 0.002, pz], r: [0, k * 1.3, 0], c: k % 2 ? [0.66, 0.64, 0.56] : [0.5, 0.48, 0.4] });
  }
}

/** blood dried on a seat or a floor: a dark patch about p, w by d, lying on it (ry) */
export function bloodPatch(b, p, w, d, ry = 0, tilt = 0) {
  b.box('cabin_fine', w, 0.006, d, { p, r: [tilt, ry, 0], c: BLOOD });
}

/** what a fire leaves of a seat: the frame of its back and the springs of its cushion, on the floor at y */
export function burntSeat(b, x, y, z, o = {}) {
  const w = o.w ?? 0.5, h = o.h ?? 0.12, bh = o.bh ?? 0.56, c = [0.2, 0.12, 0.08], s = o.back ?? 1;
  for (const sx of [-1, 1]) {
    b.box('cabin_fine', 0.03, 0.03, 0.46, { p: [x + sx * (w / 2 - 0.015), y + h, z], c });
    b.box('cabin_fine', 0.03, bh, 0.03, { p: [x + sx * (w / 2 - 0.015), y + h + bh / 2, z + s * 0.24], r: [0.17 * s, 0, 0], c });
  }
  b.box('cabin_fine', w, 0.03, 0.03, { p: [x, y + h + bh, z + s * (0.24 + bh * 0.085)], c });
  for (let k = 0; k < 4; k++) b.box('cabin_fine', w - 0.06, 0.012, 0.012, { p: [x, y + h + 0.01, z - 0.18 + k * 0.12], c: mul(c, 0.8) }); // springs
  for (let k = 0; k < 3; k++) b.box('cabin_fine', w - 0.06, 0.012, 0.012, { p: [x, y + h + 0.14 + k * 0.14, z + s * (0.25 + k * 0.024)], c: mul(c, 0.8) });
}

/** a floor (and nothing under it): w by d about (x, z), its top at y */
export function deck(b, x, y, z, w, d, c = FLOOR) {
  b.box('cabin', w, 0.02, d, { p: [x, y - 0.01, z], c }); // (with the lining: a floor is seen as far as the vehicle is)
}

/**
 * A row of seats down a bus: `rows` of them from z0, `pitch` apart, each a bench w wide at x (one each side of the
 * aisle when x is a pair), on the floor at y. Just the backs and the cushions: low, and a great many.
 */
export function busRows(b, xs, y, z0, pitch, rows, w, o = {}) {
  const c = o.c || SEATS[3], bh = o.bh ?? 0.5, skip = o.skip || (() => false);
  for (let k = 0; k < rows; k++)
    for (const x of xs) {
      if (skip(k, x)) continue;
      const z = z0 + k * pitch;
      b.box('cabin_fine', w, 0.1, 0.4, { p: [x, y + 0.05 + (o.h ?? 0), z], c });
      b.box('cabin_fine', w, bh, 0.07, { p: [x, y + (o.h ?? 0) + bh / 2, z + 0.23], r: [0.1, 0, 0], c: (k + (x > 0 ? 1 : 0)) % 4 === 0 ? mul(c, 0.7) : c });
    }
}

export { FLOOR, DASH, BONE, BLOOD, mul };
