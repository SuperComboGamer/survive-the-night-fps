// What the specials, the bosses and the animals are built from (characters.js, dog.js): the same lofted, two-bone
// skinned surfaces as the people (humans.js), for bodies that are not a person's - a hulk's trunk and limbs from a table
// of cross-sections, anything that runs along a path (a dog's barrel, a tail, a finger, a tongue), muscle and fat laid
// on as fields over a surface, and the injuries and oddments that say what a thing is: a flank torn open to the ribs,
// stitches, chains, straps, sacs, blisters, rags.
import * as THREE from 'three';
import { fbm3, mulberry32, clamp, lerp, smooth, color } from './skinning.js';
import { CR } from './charTextures.js';
import { sheet, surfPoint, ringTable } from './humans.js';

const PI = Math.PI;
const TAU = PI * 2;
const G = (x) => Math.exp(-x * x);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const mulC = (c, k) => color(c).multiplyScalar(k);

// ====================================================================== surfaces
/**
 * An upright surface from a table of cross-sections [y, w, df, db, n, cx, cz] (humans.js: a section's angle t runs from
 * the front, -Z, round by +X). o: x, z (its axis), wts(y, x) -> [bone, weight, bone, weight], dr(t, y) -> m out of the
 * surface (muscle, fat, ribs), bumps(y) -> a section's own bumps.
 */
export function vsurf(rows, o = {}) {
  const ring0 = ringTable(rows);
  const S = {
    x: o.x || 0, z: o.z || 0, yLo: rows[0][0], yHi: rows[rows.length - 1][0],
    ring: o.bumps ? (y) => { const r = ring0(y); r.bumps = o.bumps(y); return r; } : ring0,
    wts: o.wts, dr: o.dr || null,
  };
  return S;
}

/** The angle round S a point of the model is at (the inverse of a section's layout; the point's own height). */
export function angleOn(S, x, y, z) {
  const r = S.ring(y);
  const e = (r.n || 2) / 2;
  const dx = (x - S.x - r.cx) / r.w, dz = -(z - S.z - r.cz);
  const dzn = dz / (dz > 0 ? r.df : r.db);
  return Math.atan2(Math.sign(dx) * Math.pow(Math.abs(dx), e), Math.sign(dzn) * Math.pow(Math.abs(dzn), e));
}

/**
 * A field over a surface: a sum of soft lumps and grooves. Each is { t, y, st, sy, k } (an angle and a height, how
 * wide and tall, how far out in m; k < 0 a groove), sym: on both sides (t and -t), ridge: 'y' a band round the body at
 * that height (st ignored) or 't' a line up it (sy ignored), y0 / y1: only between these heights (soft ends).
 */
export function field(list, gain = 1) {
  const items = [];
  for (const m of list) {
    items.push(m);
    if (m.sym) items.push({ ...m, t: m.sym === 'back' ? TAU - m.t : -m.t });
  }
  return (t, y) => {
    let d = 0;
    for (const m of items) {
      let k = m.k;
      if (m.ridge !== 'y') k *= G(angDiff(t, m.t) / m.st);
      if (m.ridge !== 't') k *= G((y - m.y) / m.sy);
      else if (m.y0 !== undefined) k *= smooth((y - m.y0) / (m.fade || 0.05)) * smooth((m.y1 - y) / (m.fade || 0.05));
      d += k;
    }
    return d * gain;
  };
}

/**
 * humans.js's sheet, painted by where on the surface a vertex is: o.paint(t, y, c, p, n) sets its colour (after the
 * part's own), so a groove can be shaded, a wound's rim reddened, a vein drawn along the body.
 */
export function skin(mb, S, t0, t1, y0, y1, nu, nv, push, o = {}) {
  if (!o.paint) return sheet(mb, S, t0, t1, y0, y1, nu, nv, push, o);
  const ty = [];
  let i = 0;
  return sheet(mb, S, t0, t1, y0, y1, nu, nv, (t, y, u, v) => {
    ty.push(t, y);
    return typeof push === 'function' ? push(t, y, u, v) : push;
  }, {
    ...o,
    tint(p, n, c) {
      const k = Math.min(i++, ty.length / 2 - 1) * 2; // (the builder visits a part's vertices in the order the sheet made them)
      if (o.tint) o.tint(p, n, c);
      o.paint(ty[k], ty[k + 1], c, p, n);
    },
  });
}

/** Shades a surface by its own field: the grooves dark and raw, the lumps a little lighter. raw: the colour in a split. */
export function shadeBy(f, gain = 14, raw = null, at = -0.012) {
  const rc = raw ? color(raw) : null;
  return (t, y, c) => {
    const d = f(t, y);
    c.multiplyScalar(clamp(1 + d * gain, 0.55, 1.18));
    if (rc && d < at) c.lerp(rc, clamp((at - d) / Math.abs(at), 0, 0.85));
  };
}

// skin weights across a joint: bone a above y, b below, blended over +-h
export const jointW = (a, b, y, h = 0.05) => (yy) => (yy > y + h ? [a, 1, b, 0] : yy < y - h ? [b, 1, a, 0] : [a, (yy - y + h) / (2 * h), b, 1 - (yy - y + h) / (2 * h)]);

/**
 * Everything fn adds to mb is bound by w instead of to one bone: w = [bone, weight, bone, weight] for all of it, or
 * (x, y, z) => that for a vertex. fn's parts are given in model coordinates, on the 'root' bone.
 */
export function bound(mb, w, fn) {
  const geom = mb.geom;
  mb.geom = function (bone, geo, o = {}) {
    const b = this.bonePos(bone);
    if (b[0] || b[1] || b[2]) geo.translate(b[0], b[1], b[2]);
    const pa = geo.attributes.position;
    const wts = new Float32Array(pa.count * 4);
    for (let i = 0; i < pa.count; i++) wts.set(typeof w === 'function' ? w(pa.getX(i), pa.getY(i), pa.getZ(i)) : w, i * 4);
    return geom.call(this, 'root', geo, { ...o, wts });
  };
  try {
    fn();
  } finally {
    mb.geom = geom;
  }
}
/** ...bound as the surface S is where each vertex lies. */
export const onSurf = (mb, S, fn) => bound(mb, (x, y, z) => (S.wts3 ? S.wts3(clamp(y, S.yLo, S.yHi), x, z) : S.wts(clamp(y, S.yLo, S.yHi), x)), fn);

/** A tapered tube laid on S through [t, y, out] points (a vein, a strap's cord, a stitch), skinned as S is. */
export function surfTube(mb, S, tys, r0, r1, o = {}) {
  const pts = tys.map(([t, y, out]) => surfPoint(S, t, y, out ?? r0 * 0.6));
  onSurf(mb, S, () => mb.tube('root', pts, r0, r1 ?? r0, { rs: 4, cap: false, ...o }));
  return pts;
}

/** A flat strap on S through [t, y] points: w wide, h thick (a harness, an apron's tie, a bandage, a belt). */
export function strap(mb, S, tys, w, h, o = {}) {
  const pts = tys.map(([t, y, out]) => new THREE.Vector3(...surfPoint(S, t, y, (out ?? 0) + h)));
  const curve = new THREE.CatmullRomCurve3(pts);
  const segs = o.segs || Math.max(6, pts.length * 3), rad = 4;
  const geo = new THREE.TubeGeometry(curve, segs, 1, rad, false);
  const pa = geo.attributes.position;
  const q = new THREE.Vector3(), out = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, q);
    curve.getTangentAt(t, tan);
    out.set(q.x - S.x, 0, q.z - S.z).normalize();
    side.crossVectors(tan, out).normalize();
    out.crossVectors(side, tan).normalize();
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * TAU + PI / 4;
      const k = i * (rad + 1) + j;
      pa.setXYZ(k, q.x + side.x * Math.cos(a) * w * 0.7 + out.x * Math.sin(a) * h, q.y + side.y * Math.cos(a) * w * 0.7 + out.y * Math.sin(a) * h, q.z + side.z * Math.cos(a) * w * 0.7 + out.z * Math.sin(a) * h);
    }
  }
  geo.computeVertexNormals();
  onSurf(mb, S, () => mb.geom('root', geo, { region: CR.LEATHER, mottle: 0.15, ...o }));
}

// ====================================================================== lofts along a path
const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * A loft through rings along any path, in model coordinates: rings [{ c: [x, y, z], rx, ry (or ru / rd: above / below
 * the middle), n (2 round .. 4 squarer) }]. Round a ring the angle a runs from its top by its right. o: nu (round),
 * sub (rows between two rings, smoothed), up (the 'top' direction, default +Y; for an upright limb give the front,
 * [0, 0, -1]), wts(p, s, a) -> [bone, w, bone, w] (default: all on `bone`), dr(s, a) -> m out, paint(s, a, c, p, n),
 * cap0 / cap1: close an end with a point that far past it. s runs 0..1 along the rings given.
 */
export function ringLoft(mb, bone, rings, o = {}) {
  const nu = o.nu || 10, sub = o.sub || 2;
  const N = rings.length;
  const g = (i) => rings[clamp(i, 0, N - 1)];
  const val = (r, k) => (k === 'ru' ? r.ru ?? r.ry ?? r.rx : k === 'rd' ? r.rd ?? r.ry ?? r.rx : k === 'n' ? r.n ?? 2 : k === 'roll' ? r.roll ?? 0 : r[k]);
  const rows = [];
  for (let i = 0; i < N - 1; i++) {
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const a = g(i - 1), b = g(i), c = g(i + 1), d = g(i + 2);
      const row = { c: [0, 1, 2].map((m) => cr(a.c[m], b.c[m], c.c[m], d.c[m], t)), s: (i + t) / (N - 1) };
      for (const key of ['rx', 'ru', 'rd', 'n', 'roll']) row[key] = Math.max(key === 'roll' ? -1e9 : 1e-4, cr(val(a, key), val(b, key), val(c, key), val(d, key), t));
      rows.push(row);
    }
  }
  const last = g(N - 1);
  rows.push({ c: last.c.slice(), s: 1, rx: last.rx, ru: val(last, 'ru'), rd: val(last, 'rd'), n: val(last, 'n'), roll: val(last, 'roll') });
  const up0 = V(o.up || [0, 1, 0]);
  const pos = [], uv = [], sa = [], idx = [];
  const T = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), p = new THREE.Vector3();
  const M = rows.length;
  const frames = [];
  for (let j = 0; j < M; j++) {
    const a = rows[Math.max(0, j - 1)].c, b = rows[Math.min(M - 1, j + 1)].c;
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    right.crossVectors(T, up0);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    upv.crossVectors(right, T).normalize();
    if (rows[j].roll) {
      const cs = Math.cos(rows[j].roll), sn = Math.sin(rows[j].roll);
      const r2 = right.clone().multiplyScalar(cs).addScaledVector(upv, sn);
      upv.multiplyScalar(cs).addScaledVector(right, -sn);
      right.copy(r2);
    }
    frames.push([T.clone(), right.clone(), upv.clone()]);
    const r = rows[j], e = 2 / r.n;
    for (let i = 0; i <= nu; i++) {
      const ang = (i / nu) * TAU;
      const s = Math.sin(ang), c = Math.cos(ang);
      let sx = Math.sign(s) * Math.pow(Math.abs(s), e) * r.rx, sy = Math.sign(c) * Math.pow(Math.abs(c), e) * (c > 0 ? r.ru : r.rd);
      if (o.dr) {
        const d = o.dr(r.s, ang);
        const l = Math.hypot(sx, sy) || 1;
        sx += (sx / l) * d;
        sy += (sy / l) * d;
      }
      p.set(r.c[0], r.c[1], r.c[2]).addScaledVector(right, sx).addScaledVector(upv, sy);
      pos.push(p.x, p.y, p.z);
      uv.push((i / nu) * (o.uRep || 1), r.s * (o.vRep || 1));
      sa.push(r.s, ang);
    }
  }
  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (j, dist, flip) => {
    const ci = pos.length / 3;
    const [Tn] = frames[j];
    const c = rows[j].c;
    pos.push(c[0] + Tn.x * dist * (flip ? -1 : 1), c[1] + Tn.y * dist * (flip ? -1 : 1), c[2] + Tn.z * dist * (flip ? -1 : 1));
    uv.push(0.5, rows[j].s);
    sa.push(rows[j].s, 0);
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      if (flip) idx.push(a + 1, a, ci);
      else idx.push(a, a + 1, ci);
    }
  };
  if (o.cap0 !== undefined) cap(0, o.cap0, true);
  if (o.cap1 !== undefined) cap(M - 1, o.cap1, false);
  // the faces outward, whichever way the path and its 'up' turned out
  {
    const a = idx[0] * 3, b = idx[1] * 3, c = idx[2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const c0 = rows[0].c;
    const ox = (pos[a] + pos[b] + pos[c]) / 3 - c0[0], oy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 - c0[1], oz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3 - c0[2];
    if (nx * ox + ny * oy + nz * oz < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // the seam down the loft: one normal for both of its columns
  const nr = geo.attributes.normal;
  for (let j = 0; j < M; j++) {
    const a = j * (nu + 1), b = a + nu;
    const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nr.setXYZ(a, x / l, y / l, z / l);
    nr.setXYZ(b, x / l, y / l, z / l);
  }
  const nvt = pos.length / 3;
  const bi = mb.bi(bone);
  const wts = new Float32Array(nvt * 4);
  for (let i = 0; i < nvt; i++) wts.set(o.wts ? o.wts([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], sa[i * 2], sa[i * 2 + 1]) : [bi, 1, 0, 0], i * 4);
  let n = 0;
  const { paint, tint } = o;
  return mb.geom('root', geo, {
    mottle: 0.12, ...o, wts, keepNormals: true, shape: null, rot: null, q: null, at: null,
    tint: paint ? (pp, nn, c) => {
      const k = Math.min(n++, nvt - 1) * 2;
      if (tint) tint(pp, nn, c);
      paint(sa[k], sa[k + 1], c, pp, nn);
    } : tint,
  });
}

/** A round tapering limb through points (a tail, a finger, a tongue, a tentacle of gut): radii one per point. */
export function limb(mb, bone, pts, radii, o = {}) {
  return ringLoft(mb, bone, pts.map((c, i) => ({ c, rx: Array.isArray(radii) ? radii[i] : radii, ry: (Array.isArray(radii) ? radii[i] : radii) * (o.flat || 1) })), { nu: 6, sub: 2, ...o });
}

// ====================================================================== hands and feet
/**
 * A big hand on a hand bone (the bone at the wrist, the arm hanging down -Y, s = 1 the right: palm toward -X, thumb
 * toward -Z): a lofted palm, four fingers of three joints with their knuckles, a thumb. o: scale (1 = a person's),
 * curl (0 open .. 1 a claw .. 1.25 a fist), spread, claws (m), skin, region, tint, nail (colour), nu (round a finger).
 */
export function bigHand(mb, bone, s, o = {}) {
  const b = mb.bonePos(bone);
  const k = o.scale || 1;
  const curl = o.curl ?? 0.5, spread = o.spread ?? 1;
  const base = { color: o.skin, region: o.region ?? CR.ROT, mottle: 0.1, tint: o.tint, blood: o.blood };
  const at = (x, y, z) => [b[0] + x * k, b[1] + y * k, b[2] + z * k];
  // the palm: from the wrist down to the knuckles, flat across the hand, thicker at the heel
  ringLoft(mb, bone, [
    { c: at(0, 0.012, 0), rx: 0.03, ry: 0.024 },
    { c: at(-s * 0.002, -0.03, 0), rx: 0.04, ry: 0.02 },
    { c: at(-s * 0.003, -0.065, 0), rx: 0.046, ry: 0.017 },
    { c: at(-s * 0.004, -0.092, 0), rx: 0.044, ry: 0.014 },
  ].map((r) => ({ ...r, rx: r.rx * k, ry: r.ry * k, n: 2.6 })), { ...base, nu: 8, sub: 2, up: [s, 0, 0], cap0: 0.004 * k, cap1: 0.006 * k });
  const lens = [0.94, 1.0, 0.95, 0.78];
  const fl = (o.fingerMul || 1) * 0.088;
  for (let i = 0; i < 4; i++) {
    const z = (-0.0315 + i * 0.021) * spread;
    const len = fl * lens[i];
    const angs = [0.25 + 0.5 * curl, 0.2 + 1.5 * curl, 0.1 + 2.6 * curl];
    const seg = [0.46, 0.3, 0.24];
    const pts = [[0, -0.086, z * 0.92]];
    let x = 0, y = -0.086;
    const fan = z * 0.12 * (1 - Math.min(1, curl)); // open fingers splay
    for (let j = 0; j < 3; j++) {
      x -= s * Math.sin(angs[j]) * len * seg[j];
      y -= Math.cos(angs[j]) * len * seg[j];
      pts.push([x, y, z * 0.92 + fan * (j + 1)]);
    }
    const P = pts.map((p) => at(p[0], p[1], p[2]));
    // knuckles: the joints stand out, the phalanges waisted between them
    const rr = [0.0118, 0.0102, 0.0088, 0.0066].map((r) => r * k * (i === 3 ? 0.9 : 1) * (o.thick || 1));
    const rings = [];
    for (let j = 0; j < 4; j++) {
      rings.push({ c: P[j], rx: rr[j], ry: rr[j] * 0.92 });
      if (j < 3) rings.push({ c: [0, 1, 2].map((m) => lerp(P[j][m], P[j + 1][m], 0.5)), rx: lerp(rr[j], rr[j + 1], 0.5) * 0.84, ry: lerp(rr[j], rr[j + 1], 0.5) * 0.8 });
    }
    ringLoft(mb, bone, rings, { ...base, nu: o.nu || 5, sub: 1, up: [0, 0, 1], cap0: 0.002 * k, cap1: o.claws ? undefined : 0.004 * k });
    if (o.claws) {
      const tip = P[3], prev = P[2];
      const d = V(tip).sub(V(prev)).normalize();
      const cl = o.claws;
      bound(mb, [mb.bi(bone), 1, 0, 0], () => mb.spike('root', [tip[0] - d.x * 0.004 * k, tip[1] - d.y * 0.004 * k, tip[2] - d.z * 0.004 * k], [tip[0] + d.x * cl - s * cl * 0.25, tip[1] + d.y * cl - cl * 0.2, tip[2] + d.z * cl], rr[3] * 0.95, { rs: 4, color: o.nail ?? 0x2a2016, region: CR.BONE, mottle: 0.2, blood: false }));
    }
  }
  // the thumb, from the heel of the hand, across the front
  {
    const t = curl;
    const P = [[-s * 0.006, -0.02, -0.03], [-s * (0.016 + 0.012 * t), -0.05, -0.05], [-s * (0.026 + 0.03 * t), -0.078, -0.052 + 0.016 * t], [-s * (0.03 + 0.052 * t), -0.098, -0.046 + 0.034 * t]].map((p) => at(p[0], p[1], p[2] * spread));
    const rr = [0.0145, 0.0125, 0.0105, 0.0078].map((r) => r * k * (o.thick || 1));
    ringLoft(mb, bone, P.map((c, j) => ({ c, rx: rr[j], ry: rr[j] * 0.92 })), { ...base, nu: o.nu || 5, sub: 2, up: [0, 0, 1], cap0: 0.002 * k, cap1: o.claws ? undefined : 0.004 * k });
    if (o.claws) {
      const tip = P[3], d = V(tip).sub(V(P[2])).normalize(), cl = o.claws * 0.9;
      bound(mb, [mb.bi(bone), 1, 0, 0], () => mb.spike('root', tip, [tip[0] + d.x * cl, tip[1] + d.y * cl, tip[2] + d.z * cl], rr[3] * 0.95, { rs: 4, color: o.nail ?? 0x2a2016, region: CR.BONE, mottle: 0.2, blood: false }));
    }
  }
}

/**
 * A big bare foot on a foot bone (the bone at the ankle, the sole on y = 0): lofted from the heel to the ball, five
 * toes. o: w, l (x a person's), skin, region, tint, claws (m), toes (default 5).
 */
export function bigFoot(mb, bone, s, o = {}) {
  const b = mb.bonePos(bone);
  const w = o.w || 1, l = o.l || 1, h = o.h || Math.sqrt(w * l);
  const base = { color: o.skin, region: o.region ?? CR.ROT, mottle: 0.1, tint: o.tint };
  const at = (x, y, z) => [b[0] + x * w, y * h, b[2] + z * l];
  ringLoft(mb, bone, [
    { c: at(0, 0.03, 0.058), rx: 0.024 * w, ru: 0.03 * h, rd: 0.028 * h },
    { c: at(0, 0.04, 0.03), rx: 0.034 * w, ru: 0.05 * h, rd: 0.038 * h },
    { c: at(0, 0.036, -0.02), rx: 0.036 * w, ru: 0.046 * h, rd: 0.034 * h },
    { c: at(s * 0.004, 0.027, -0.075), rx: 0.042 * w, ru: 0.03 * h, rd: 0.025 * h },
    { c: at(s * 0.006, 0.019, -0.122), rx: 0.047 * w, ru: 0.018 * h, rd: 0.017 * h },
    { c: at(s * 0.006, 0.014, -0.146), rx: 0.044 * w, ru: 0.012 * h, rd: 0.012 * h },
  ].map((r) => ({ ...r, n: 2.5 })), { ...base, nu: 10, sub: 2, up: [0, 1, 0], cap0: 0.008 * l, cap1: 0.004 * l });
  const n = o.toes ?? 5;
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0.5;
    const x = s * (0.034 - u * 0.07), big = i === 0 ? 1.45 : 1 - u * 0.15;
    const z0 = -0.142 + Math.abs(u - 0.2) * 0.022;
    const r = 0.0085 * big;
    const P = [at(x, 0.016, z0), at(x * 1.04, 0.015, z0 - 0.017 * big), at(x * 1.06, 0.01, z0 - 0.03 * big)];
    ringLoft(mb, bone, P.map((c, j) => ({ c, rx: r * w * (1 - j * 0.12), ry: r * h * (1 - j * 0.15) })), { ...base, nu: 5, sub: 1, up: [0, 1, 0], cap1: o.claws ? undefined : 0.004 * l });
    if (o.claws) bound(mb, [mb.bi(bone), 1, 0, 0], () => mb.spike('root', P[2], [P[2][0], Math.max(0.002, P[2][1] - o.claws * 0.25), P[2][2] - o.claws], r * w * 0.75, { rs: 4, color: o.nail ?? 0x2a2016, region: CR.BONE, mottle: 0.2, blood: false }));
  }
}

// ====================================================================== injuries, growths, oddments
/**
 * A flank torn open to the bone, on S over the patch t0..t1, y0..y1: the raw cavity set into the body, the ribs across
 * it. Returns { fn, paint }: fn(x, y, z) is the hole to cut in what covers it (a part's tear.fn), paint(t, y, c) reddens
 * the skin round its edge. o: ribs (how many), r (a rib's radius), depth, flesh (colour), bone (colour), rag (how ragged).
 */
export function tornOpen(mb, S, t0, t1, y0, y1, o = {}) {
  const tc = (t0 + t1) / 2, yc = (y0 + y1) / 2, ht = (t1 - t0) / 2, hy = (y1 - y0) / 2;
  const depth = o.depth ?? 0.012;
  const rag = o.rag ?? 0.35;
  const seed = o.seed || 5;
  // how far inside the wound's edge (1 its middle, 0 the edge, < 0 outside), the edge ragged
  const inside = (t, y) => {
    const u = angDiff(t, tc) / ht, v = (y - yc) / hy;
    return 1 - Math.hypot(u, v) - (fbm3(u * 2.3 + seed, v * 2.3, seed * 0.7, 2, seed) - 0.5) * rag * 2;
  };
  skin(mb, S, t0 - ht * 0.25, t1 + ht * 0.25, y0 - hy * 0.2, y1 + hy * 0.2, o.nu || 8, o.nv || 8, (t, y) => -depth * clamp(inside(t, y) * 3 + 0.6, 0, 1) - 0.002, {
    color: o.flesh ?? 0x6a1512, region: o.glow ? CR.GLOW : CR.GORE, glow: o.glow || 0, mottle: 0.3, blood: false,
    paint: (t, y, c) => {
      const k = inside(t, y);
      if (o.glow) return;
      if (k > 0.45) c.lerp(color(0x1c0606), clamp((k - 0.45) * 2.2, 0, 0.8)); // the dark of the body's inside
      if (fbm3(t * 9, y * 30, 1, 2, seed + 3) > 0.62) c.lerp(color(0xa8483a), 0.5); // strands of muscle
    },
  });
  const n = o.ribs ?? 0;
  for (let i = 0; i < n; i++) {
    const y = lerp(y0 + hy * 0.25, y1 - hy * 0.25, n > 1 ? i / (n - 1) : 0.5);
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const t = lerp(t0 - ht * 0.1, t1 + ht * 0.1, k / 5);
      pts.push([t, y - (o.slope ?? 0.12) * hy * (k / 5 - 0.5) * 2 * Math.sign(tc || 1), -depth * 0.35 * clamp(inside(t, y) * 3, 0, 1)]);
    }
    surfTube(mb, S, pts, o.r ?? 0.008, (o.r ?? 0.008) * 0.85, { rs: 5, ts: 7, color: o.bone ?? 0xd8ccb0, region: CR.BONE, blood: false, mottle: 0.2 });
  }
  return {
    inside,
    fn: (x, y, z) => y > y0 - hy * 0.3 && y < y1 + hy * 0.3 && inside(angleOn(S, x, y, z), y) > 0.04,
    paint: (t, y, c) => {
      const k = inside(t, y);
      if (k > -0.5) c.lerp(color(o.rim ?? 0x4a0a08), clamp((k + 0.5) * 1.6, 0, 0.9));
    },
  };
}

/** A wound sewn shut on S: a dark line through [t, y] points with stitches across it. o: n (stitches), w, thread (colour). */
export function stitches(mb, S, tys, o = {}) {
  const pts = tys.map(([t, y]) => surfPoint(S, t, y, 0.0015));
  const curve = new THREE.CatmullRomCurve3(pts.map(V));
  const n = o.n || 8, w = o.w || 0.02;
  onSurf(mb, S, () => {
    mb.tube('root', pts, w * 0.16, w * 0.16, { rs: 4, ts: Math.max(6, n), color: o.scar ?? 0x4a1414, region: CR.FLESH, blood: false, cap: false });
    const q = new THREE.Vector3(), tan = new THREE.Vector3(), out = new THREE.Vector3(), side = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      curve.getPointAt(u, q);
      curve.getTangentAt(u, tan);
      out.set(q.x - S.x, 0, q.z - S.z).normalize();
      side.crossVectors(tan, out).normalize();
      const sk = (i % 2 ? 1 : -1) * 0.35; // each stitch a little askew
      const a = [q.x + (side.x + tan.x * sk) * w * 0.5, q.y + (side.y + tan.y * sk) * w * 0.5, q.z + (side.z + tan.z * sk) * w * 0.5];
      const b = [q.x - (side.x + tan.x * sk) * w * 0.5, q.y - (side.y + tan.y * sk) * w * 0.5, q.z - (side.z + tan.z * sk) * w * 0.5];
      const m = [q.x + out.x * w * 0.22, q.y + out.y * w * 0.22, q.z + out.z * w * 0.22];
      mb.tube('root', [a, m, b], w * 0.075, w * 0.075, { rs: 3, ts: 2, color: o.thread ?? 0x16100c, region: CR.PLAIN, blood: false, cap: false, mottle: 0.1 });
    }
  });
}

/** A chain through points (model coordinates), bound by w: links of radius r, every other one turned. */
export function chain(mb, w, pts, r, o = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map(V));
  const len = curve.getLength();
  const n = Math.max(2, Math.round(len / (r * 1.55)));
  const q = new THREE.Vector3(), tan = new THREE.Vector3(), m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  bound(mb, w, () => {
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      curve.getPointAt(u, q);
      curve.getTangentAt(u, tan);
      // a link: a flattened ring in a plane that holds the chain's direction, turned a quarter every other link
      const g = new THREE.TorusGeometry(r, r * 0.26, o.rs || 4, o.ts || 7);
      g.scale(1.25, 0.82, 1);
      X.copy(tan);
      Y.set(0.3, 1, 0.2).cross(X).normalize();
      Z.crossVectors(X, Y).normalize();
      if (i % 2) {
        const y2 = Y.clone();
        Y.copy(Z).negate();
        Z.copy(y2);
      }
      m.makeBasis(X, Y, Z).setPosition(q);
      g.applyMatrix4(m);
      mb.geom('root', g, { color: o.color ?? 0x4a4640, region: CR.PLAIN, mottle: 0.35, blood: o.blood ?? false });
    }
  });
}

/**
 * A blister, a sac or a growth standing out of S at (t, y): a dome whose base sits in the skin. r: its radius, h: how
 * proud (x r), o: the part's options plus rim (the colour of the inflamed skin round it).
 */
export function blister(mb, S, t, y, r, h, o = {}) {
  const c = surfPoint(S, t, y, -r * 0.25);
  const a = surfPoint(S, t, y, r);
  const nv = V(a).sub(V(c)).normalize();
  const rim = o.rim !== undefined ? color(o.rim) : null;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), nv);
  const { tint } = o;
  onSurf(mb, S, () => mb.ellip('root', c, [r, r * (o.tall || 1), r * h], {
    ws: 7, hs: 5, region: CR.GLOW, mottle: 0.15, blood: false, ...o, q,
    tint(p, n, cc) {
      if (tint) tint(p, n, cc);
      if (rim) cc.lerp(rim, clamp((0.72 - (n.x * nv.x + n.y * nv.y + n.z * nv.z)) * 1.7, 0, 0.9));
    },
  }));
  return c;
}

/**
 * A rag: a strip of cloth hanging from `top` ([x, y, z], model coordinates) on a bone, `len` long and `w` wide, facing
 * `yaw` round the body, its end frayed. Two-sided. o: color, region, sway (how far its end hangs out), tear.
 */
export function rag(mb, bone, top, len, w, yaw, o = {}) {
  const nu = 3, nv = o.nv || 5;
  const geo = new THREE.PlaneGeometry(1, 1, nu, nv);
  const pa = geo.attributes.position;
  const seed = o.seed || 1;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let i = 0; i < pa.count; i++) {
    const u = pa.getX(i), v = 0.5 - pa.getY(i); // v: 0 at the top .. 1 at the end
    const taper = 1 - (o.taper ?? 0.45) * v;
    const fray = v > 0.99 ? (fbm3(u * 6 + seed, seed, 0, 2, 3) - 0.3) * len * 0.3 : 0;
    const x = u * w * taper, y = -v * len - fray;
    const z = -(o.sway ?? 0.02) * v * v - Math.sin(u * 5 + seed + v * 4) * w * 0.12 * v;
    pa.setXYZ(i, top[0] + x * cy - z * sy, top[1] + y, top[2] - x * sy - z * cy);
  }
  geo.computeVertexNormals();
  bound(mb, [mb.bi(bone), 1, 0, 0], () => mb.geom('root', geo, { color: o.color ?? 0x2a2622, region: o.region ?? CR.CLOTH, mottle: 0.2, double: true, keepNormals: true, blood: o.blood, tint: o.tint, tear: o.tear ? { amt: o.tear, f: 30, seed } : null }));
}

/** A shard of bone grown out of the body: a three-sided blade from `a` to its tip `b` (model coordinates), bound by w. */
export function shard(mb, w, a, b, r, o = {}) {
  bound(mb, w, () => mb.spike('root', a, b, r, { rs: o.rs || 4, color: o.color ?? 0xcfc2a2, region: CR.BONE, mottle: 0.25, blood: o.blood ?? false, tint: o.tint }));
}

// ====================================================================== a hulk
const sstep = (a, b, x) => smooth((x - a) / (b - a));

/**
 * A body on the humanoid rig (characters.js addHumanoidBones) from tables of cross-sections, for what is too big or
 * too wrong to be a person: the trunk from the crotch to the base of the neck (hips -> spine -> chest, the shoulders'
 * tops a little with the collarbones, and a gut on its own bone if there is one), a neck, the arms from the shoulder's
 * cap to the wrist, the legs to the ankle. o:
 *   torso, arm(side), leg(side): rows [y, w, df, db, n, cx, cz]; neck: its radius (or [r at the chest, r at the head])
 *   skin { color, region, mottle, tint }, raw (the colour in a deep groove: a split in the skin)
 *   tf, af(side), lf(side): fields (m out of the surface) over the trunk, an arm, a leg; shade: how hard they are shaded
 *   belly { bone, y, sy, k }: the front of the trunk round height y goes this much (k) with the gut's bone
 *   paintT / paintA(side) / paintL(side) (t, y, c, p, n): paint over it; holeT / holeA / holeL (x, y, z): cut away
 *   nu, nvT, nuA, nvA, nuL, nvL: the grids
 * Returns { T, N, arms: [L, R], legs: [L, R] } (surfaces, to lay things on).
 */
export function hulk(mb, P, o) {
  const yH = P.hipY, yS = P.spineY, yC = P.chestY, ySh = P.shoulderY;
  const hips = mb.bi('hips'), spine = mb.bi('spine'), chest = mb.bi('chest'), clavL = mb.bi('clavL'), clavR = mb.bi('clavR');
  const sw = P.shoulderW;
  const bw = (a, b, t) => (t <= 0 ? [a, 1, b, 0] : t >= 1 ? [b, 1, a, 0] : [a, 1 - t, b, t]);
  const so = { color: o.skin.color, region: o.skin.region ?? CR.ROT, mottle: o.skin.mottle ?? 0.14, tint: o.skin.tint };
  const shade = o.shade ?? 10;
  const T = vsurf(o.torso, { dr: o.tf, bumps: o.bumpsT });
  T.yH = yH;
  T.yS = yS;
  T.yC = yC;
  T.ySh = ySh;
  const belly = o.belly ? { ...o.belly, bi: mb.bi(o.belly.bone) } : null;
  const base = (y, x) => {
    const a = (yS - yH) * 0.15;
    if (y <= yH + a) return [hips, 1, spine, 0];
    if (y <= yS) return bw(hips, spine, (y - yH - a) / (yS - yH - a));
    if (y <= yC) return bw(spine, chest, (y - yS) / (yC - yS));
    const c = sstep(sw * 0.55, sw * 0.95, Math.abs(x)) * sstep(ySh - (ySh - yC) * 0.3, ySh + 0.01, y) * 0.5;
    return c > 0 ? [chest, 1 - c, x < 0 ? clavL : clavR, c] : [chest, 1, spine, 0];
  };
  T.wts = base;
  // (the gut's own weights need a vertex's depth too)
  const tw = (y, x, z) => {
    const w = base(y, x);
    if (!belly) return w;
    const r = T.ring(clamp(y, T.yLo, T.yHi));
    const front = clamp(-(z - r.cz) / r.df, 0, 1.2);
    const k = belly.k * G((y - belly.y) / belly.sy) * smooth(front) * G(x / (belly.sx || r.w * 1.2));
    if (k < 0.02) return w;
    return [w[1] >= w[3] ? w[0] : w[2], 1 - k, belly.bi, k];
  };
  if (belly) T.wts3 = tw;
  if (o.prep) o.prep(T); // (what the trunk's own paint and holes need: a wound made on T before its skin is)
  const tfP = o.tf ? shadeBy(o.tf, shade, o.raw, o.rawAt) : null;
  const paintT = (t, y, c, p, n) => {
    if (tfP) tfP(t, y, c);
    if (o.paintT) o.paintT(t, y, c, p, n);
  };
  const nu = o.nu || 26, nvT = o.nvT || 22;
  skin(mb, T, 0, TAU, T.yLo, T.yHi, nu, nvT, 0, { ...so, cap0: (T.yHi - T.yLo) * 0.02, cap1: (T.yHi - T.yLo) * 0.02, paint: paintT, tear: o.holeT ? { amt: 0, fn: o.holeT } : null });
  if (belly) reweigh(mb, tw);
  // ---- the neck
  const nb = mb.bonePos('neck'), hb = mb.bonePos('head');
  const [r0, r1] = Array.isArray(o.neck) ? o.neck : [o.neck, o.neck * 0.88];
  const ny0 = nb[1] - (o.neckDown ?? r0 * 0.9), ny1 = hb[1] + r1 * 0.5;
  const nz = o.neckBack ?? 0.02;
  const N = vsurf([
    [ny0, r0 * 1.2, r0 * 1.05, r0 * 1.15, 2, 0, nb[2] + nz],
    [nb[1], r0, r0 * 0.95, r0 * 1.05, 2, 0, nb[2] + nz * 0.8],
    [lerp(nb[1], hb[1], 0.6), r1, r1 * 0.95, r1, 2, 0, lerp(nb[2], hb[2], 0.6) + r1 * 0.12],
    [ny1, r1 * 0.95, r1 * 0.88, r1 * 1.02, 2, 0, hb[2] + r1 * 0.3],
  ]);
  const neck = mb.bi('neck'), head = mb.bi('head');
  N.wts = (y) => (y < nb[1] ? bw(chest, neck, (y - ny0) / (nb[1] - ny0)) : y < hb[1] - 0.01 ? [neck, 1, head, 0] : bw(neck, head, ((y - hb[1] + 0.01) / (r1 * 0.9)) * 0.7));
  skin(mb, N, 0, TAU, N.yLo, N.yHi, o.nuN || 12, 4, 0, { ...so, cap1: 0.004, paint: o.paintN });
  // ---- arms
  const arms = [];
  for (const side of [-1, 1]) {
    const n = side < 0 ? 'L' : 'R';
    const ub = mb.bonePos('uarm' + n), fb = mb.bonePos('farm' + n), wb = mb.bonePos('hand' + n);
    const af = o.af ? o.af(side) : null;
    const A = vsurf(o.arm(side), { x: ub[0], z: ub[2], dr: af });
    const ua = mb.bi('uarm' + n), fa = mb.bi('farm' + n);
    A.wts = jointW(ua, fa, fb[1], (ub[1] - fb[1]) * 0.1);
    A.yS = ub[1];
    A.yE = fb[1];
    A.yW = wb[1];
    A.side = side;
    const afP = af ? shadeBy(af, shade, o.raw, o.rawAt) : null;
    const pa = o.paintA ? o.paintA(side) : null;
    const yEnd = (o.armEnd && o.armEnd(side)) ?? A.yLo;
    const hole = o.holeA ? o.holeA(side) : null;
    skin(mb, A, 0, TAU, yEnd, A.yHi, o.nuA || 14, o.nvA || 16, 0, {
      ...so, cap0: 0.004, cap1: (A.yHi - A.yLo) * 0.012,
      paint: (t, y, c, p, nn) => {
        if (afP) afP(t, y, c);
        if (pa) pa(t, y, c, p, nn);
      },
      tear: hole ? { amt: 0, fn: hole } : null,
    });
    arms.push(A);
  }
  // ---- legs
  const legs = [];
  for (const side of [-1, 1]) {
    const n = side < 0 ? 'L' : 'R';
    const tb = mb.bonePos('thigh' + n), sb = mb.bonePos('shin' + n), fb = mb.bonePos('foot' + n);
    const lf = o.lf ? o.lf(side) : null;
    const Lg = vsurf(o.leg(side), { x: tb[0], z: tb[2], dr: lf });
    const th = mb.bi('thigh' + n), sh = mb.bi('shin' + n);
    const kw = jointW(th, sh, sb[1], (tb[1] - sb[1]) * 0.1);
    Lg.wts = (y) => (y > tb[1] + 0.01 ? bw(th, hips, ((y - tb[1] - 0.01) / Math.max(0.01, Lg.yHi - tb[1])) * 0.6) : kw(y));
    Lg.yT = tb[1];
    Lg.yK = sb[1];
    Lg.yA = fb[1];
    Lg.side = side;
    const lfP = lf ? shadeBy(lf, shade, o.raw, o.rawAt) : null;
    const pl = o.paintL ? o.paintL(side) : null;
    const yEnd = (o.legEnd && o.legEnd(side)) ?? Lg.yLo;
    const hole = o.holeL ? o.holeL(side) : null;
    skin(mb, Lg, 0, TAU, yEnd, Lg.yHi, o.nuL || 14, o.nvL || 12, 0, {
      ...so, cap0: 0.004,
      paint: (t, y, c, p, nn) => {
        if (lfP) lfP(t, y, c);
        if (pl) pl(t, y, c, p, nn);
      },
      tear: hole ? { amt: 0, fn: hole } : null,
    });
    legs.push(Lg);
  }
  return { T, N, arms, legs };
}

/** The last part added to mb, bound again by w(y, x, z) (a surface whose weights need a vertex's depth too). */
export function reweigh(mb, w) {
  const part = mb.parts[mb.parts.length - 1];
  const pa = part.geo.attributes.position, b = mb.bones[part.bone].pos;
  for (let i = 0; i < pa.count; i++) part.o.wts.set(w(pa.getY(i) + b[1], pa.getX(i) + b[0], pa.getZ(i) + b[2]), i * 4);
}

/**
 * What is left of a pair of trousers on a hulk's surfaces: the seat round the hips (T from its bottom up to `rise`), a
 * leg each down to a ragged hem at hem(side) (a height). o: color, region, push (how far off the skin), tear, tint.
 */
export function ragPants(mb, B, rise, hem, o = {}) {
  const { T, legs } = B;
  const push = o.push ?? 0.012;
  const po = { color: o.color, region: o.region ?? CR.DENIM, mottle: 0.14, tint: o.tint };
  const fray = o.fray ?? 0.07;
  sheet(mb, T, 0, TAU, T.yLo, rise, o.nu || 22, o.nvT || 4, push, {
    ...po, cap0: 0.01,
    tear: { amt: o.tear ?? 0.06, f: o.tf || 6, seed: 71, fn: (x, y, z) => y > rise - fray * 0.5 * fbm3(x * 9, 0, z * 9, 2, 5) },
  });
  if (T.wts3) reweigh(mb, T.wts3);
  for (const Lg of legs) {
    const yb = hem(Lg.side);
    sheet(mb, Lg, 0, TAU, yb, Lg.yHi, o.nuL || 14, o.nvL || 6, push, {
      ...po,
      tear: { amt: o.tear ?? 0.06, f: o.tf || 6, seed: 81 + Lg.side, fn: (x, y, z) => y < yb + fray * fbm3(x * 9, y * 2, z * 9, 2, 11 + Lg.side) },
    });
  }
}

export { mulberry32, G, angDiff };
