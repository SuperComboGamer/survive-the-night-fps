// Parametric human body control cage (canonical 1.75 m, A-pose). One closed quad cage: torso rings → arm sockets → arms →
// wrists → palms → finger tubes sharing web edges (so Catmull-Clark gives real finger webs) → thumbs; crotch split → legs →
// bent-tube feet; neck rings end inside the head. Faces carry tags {part, side, seg, zone} that garments select from.
import * as THREE from 'three';
import { RIG, BI, NB } from './rig.js';
import { Cage, bridge, capRing } from './mesh.js';

const V = THREE.Vector3;
const D2R = Math.PI / 180;

// Torso stations: y, z-centre, half-width, front depth, back depth, superellipse exponent. Values are CAGE values (≈ 6 % larger
// than the smooth limit surface).  Canonical lean adult male, 1.75 m.
const TORSO = [
  ['R0', 0.800, 0.014, 0.155, 0.072, 0.092, 2.4],
  ['R1', 0.900, 0.018, 0.170, 0.086, 0.122, 2.6],
  ['R2', 0.982, 0.014, 0.163, 0.099, 0.104, 2.4],
  ['R3', 1.068, 0.010, 0.158, 0.110, 0.099, 2.2],
  ['R4', 1.160, 0.008, 0.157, 0.113, 0.102, 2.3],
  ['R5', 1.250, 0.006, 0.165, 0.129, 0.116, 2.5],
  ['R6', 1.330, 0.010, 0.172, 0.125, 0.117, 2.7],
  ['R7', 1.392, 0.014, 0.190, 0.095, 0.100, 3.0],
  ['R8', 1.446, 0.020, 0.192, 0.056, 0.070, 2.9],
  ['N0', 1.490, 0.030, 0.070, 0.058, 0.062, 2.2],
  ['N1', 1.532, 0.026, 0.058, 0.054, 0.058, 2.0],
  ['N2', 1.572, 0.022, 0.056, 0.052, 0.058, 2.0],
  ['N3', 1.612, 0.016, 0.050, 0.046, 0.052, 2.0],
];
// torso vertex k (0..11): angle a = 30k; direction (−sin a, 0, −cos a) → 0 front, 3 left (−X), 6 back, 9 right (+X)
const ARM_COLS = { L: [2, 3, 4], R: [8, 9, 10] };
const SOCKET_RINGS = [6, 7, 8]; // R6 (armpit), R7, R8 (shoulder top)

const sgnPow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
function weightsTorso(ri, k) {
  // blend by height, plus shoulder / hip influence near the sockets
  const W = {};
  const add = (b, w) => { W[b] = (W[b] || 0) + w; };
  const side = (k >= 1 && k <= 5) ? 'L' : (k >= 7 && k <= 11) ? 'R' : '';
  switch (ri) {
    case 0: add('pelvis', 0.62); if (side) add('thigh.' + side, 0.38); else { add('thigh.L', 0.19); add('thigh.R', 0.19); } break;
    case 1: add('pelvis', 0.86); if (side) add('thigh.' + side, 0.14); break;
    case 2: add('pelvis', 0.72); add('spine1', 0.28); break;
    case 3: add('spine1', 0.62); add('pelvis', 0.18); add('spine2', 0.2); break;
    case 4: add('spine2', 0.62); add('spine1', 0.24); add('chest', 0.14); break;
    case 5: add('chest', 0.58); add('spine2', 0.42); break;
    case 6: add('chest', 0.86); add('spine2', 0.14); break;
    case 7: add('chest', 0.7); if (side) add('clavicle.' + side, 0.3); break;
    case 8: add('chest', 0.45); if (side) add('clavicle.' + side, 0.45); add('neck', 0.1); break;
    case 9: add('chest', 0.55); add('neck', 0.45); break;
    case 10: add('neck', 1); break;
    case 11: add('neck', 0.7); add('head', 0.3); break;
    default: add('head', 0.75); add('neck', 0.25);
  }
  // arm socket neighbourhood follows the shoulder
  if (side && ri >= 6 && ri <= 8) { const cols = ARM_COLS[side]; if (cols.includes(k)) { const s = ri === 6 ? 0.22 : ri === 7 ? 0.3 : 0.25; for (const b in W) W[b] *= 1 - s; add('upperarm.' + side, s * 0.6); add('clavicle.' + side, s * 0.4); } }
  return W;
}

/** Newell normal of a loop */
function loopNormal(cage, L) { let nx = 0, ny = 0, nz = 0; for (let k = 0; k < L.length; k++) { const a = cage.R[L[k]], b = cage.R[L[(k + 1) % L.length]]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); } return new V(nx, ny, nz); }
/** orient loop so its Newell normal points along dir (so bridge(A,B) toward dir produces outward faces) */
function orient(cage, L, dir) { return loopNormal(cage, L).dot(dir) < 0 ? L.slice().reverse() : L; }
/** rotate loop start to the vertex closest to point p */
function startAt(cage, L, p) { let bi = 0, bd = Infinity; L.forEach((v, i) => { const r = cage.R[v]; const d = (r[0] - p.x) ** 2 + (r[1] - p.y) ** 2 + (r[2] - p.z) ** 2; if (d < bd) { bd = d; bi = i; } }); return L.slice(bi).concat(L.slice(0, bi)); }

/**
 * Build the body cage.
 * opts: { girth 0.8..1.3 (overall width), belly 0..1, muscle 0..1, gaunt 0..1 (emaciation), rng (for small asymmetries),
 *         skinPaint: fn(pos, part) → [r,g,b] multipliers }
 */
export function buildBodyCage(opts = {}) {
  const girth = opts.girth ?? 1, belly = opts.belly ?? 0, muscle = opts.muscle ?? 0.4, gaunt = opts.gaunt ?? 0.3, rng = opts.rng || Math.random;
  const fat = opts.fat ?? 0, sex = opts.sex ?? 0, age = opts.age ?? 0; // fat 0..1 (where it sits), sex 0 male … 1 female proportions, age 0..1 (elderly)
  const cage = new Cage();
  const T = []; // torso rings (vertex indices)
  const paint = (r = 1, g = 1, b = 1, ao = 1) => [r, g, b, ao, 1];
  // ---------------- torso
  TORSO.forEach(([name, y, zc, hw, fd, bd, ex], ri) => {
    const ring = [];
    const isNeck = ri >= 9;
    const wmul = isNeck ? 1 + (girth - 1) * 0.4 : girth;
    for (let k = 0; k < 12; k++) {
      const a = k * 30 * D2R, s = Math.sin(a), c = Math.cos(a);
      let rx = hw * wmul, rf = fd * (isNeck ? 1 : 1 + (girth - 1) * 0.8), rb = bd * (isNeck ? 1 : 1 + (girth - 1) * 0.7);
      let m = 1;
      // anatomy tweaks
      if (name === 'R1' && (k === 5 || k === 7)) m *= 1.05; if (name === 'R1' && k === 6) m *= 0.96;
      if ((name === 'R2' || name === 'R3') && c > 0.5) m *= 1 + belly * 0.28 - gaunt * 0.14;
      if (name === 'R4' && c > 0.5) m *= 1 + belly * 0.18 - gaunt * 0.06;
      if (name === 'R3' && k === 6) m *= 0.95;
      if ((name === 'R5') && (k === 1 || k === 11)) m *= 1.07 + muscle * 0.06 - gaunt * 0.04;
      if ((name === 'R4') && (k === 1 || k === 11 || k === 0)) m *= 0.97;
      if ((name === 'R8' || name === 'N0') && (k >= 4 && k <= 8)) m *= 1.06; // trapezius mass at the back
      if (name === 'R5' && k === 0) m *= 0.985;
      if ((name === 'R6' || name === 'R7') && (k === 5 || k === 7)) m *= 1.03;
      if (name === 'R7' && (k === 3 || k === 9)) m *= 1 + muscle * 0.06;
      if (name === 'N1' && k === 0) m *= 1.04 - sex * 0.03; // larynx
      // fat: belly (front), love handles / flanks (sides of R2-R3), chest, nape; sex: shoulders ↓, waist ↓, hips ↑; age: chest flattens, belly sags
      const front = c > 0.55, flank = Math.abs(s) > 0.75 && c > -0.4;
      if (ri >= 2 && ri <= 4 && front) m *= 1 + fat * (ri === 3 ? 0.3 : 0.22) + age * (ri === 2 ? 0.06 : 0);
      if ((ri === 2 || ri === 3) && flank) m *= 1 + fat * 0.14;
      if ((ri === 5 || ri === 6) && front) m *= 1 + fat * 0.1 - age * 0.04 + sex * (ri === 5 && Math.abs(s) > 0.2 && Math.abs(s) < 0.75 ? 0.14 : 0.03);
      if (ri >= 7 && ri <= 8) m *= 1 - sex * 0.08; if (ri === 3) m *= 1 - sex * 0.1; if (ri <= 1) m *= 1 + sex * 0.08 + fat * 0.06;
      if (isNeck) m *= 1 + fat * 0.12 - sex * 0.08;
      m *= 1 + (rng() - 0.5) * 0.012;
      const x = -sgnPow(s, 2 / ex) * rx * m, z = zc - sgnPow(c, 2 / ex) * (c > 0 ? rf : rb) * m;
      let yy = y; if (name === 'R8') yy += Math.abs(s) * 0.004 - (c > 0.8 ? 0.012 : 0); // clavicle notch lower at the front
      if (name === 'R0' && Math.abs(s) < 0.3) yy += 0.02; // pubic mound / sacrum sit a bit higher than the thigh line
      const pc = paint(1, 1, 1, 1);
      ring.push(cage.v([x, yy, z], weightsTorso(ri, k), pc));
    }
    T.push(ring);
  });
  // face k spans columns k → k+1 (centre angle 30k + 15°): zones are symmetric about the midline — front = ±60° (faces 10, 11,
  // 0, 1), back = 120..240° (faces 4..7); the two faces flanking the front midline are 11 and 0 (openings / necklines use them)
  const tagT = (ri, k) => ({ part: ri >= 9 ? 'neck' : 'torso', side: '', seg: ri, zone: (k <= 1 || k >= 10) ? 'front' : (k >= 4 && k <= 7) ? 'back' : 'side', col: k });
  const inSocket = (ri, k) => { for (const s of ['L', 'R']) { const c = ARM_COLS[s]; if (ri >= 6 && ri < 8 && (k === c[0] || k === c[1])) return s; } return null; };
  for (let ri = 0; ri < T.length - 1; ri++) {
    const A = T[ri], B = T[ri + 1];
    for (let k = 0; k < 12; k++) {
      if (inSocket(ri, k)) continue;
      const k1 = (k + 1) % 12; cage.f([A[k], A[k1], B[k1], B[k]], tagT(ri, k)); // ring order is CCW from above → outward
    }
  }
  // ---------------- legs (crotch split)
  const crotch = cage.v([0, 0.792, 0.012], { pelvis: 0.5, 'thigh.L': 0.25, 'thigh.R': 0.25 }, paint(0.95, 0.95, 0.95, 0.55)); // crotch height ≈ 0.80-0.82
  const R0 = T[0];
  const legLoops = { L: [R0[0], R0[1], R0[2], R0[3], R0[4], R0[5], R0[6], crotch], R: [R0[6], R0[7], R0[8], R0[9], R0[10], R0[11], R0[0], crotch] };
  const legs = {}, arms = {}, hands = {}, feet = {};
  for (const side of ['L', 'R']) legs[side] = buildLeg(cage, side, legLoops[side], { girth, muscle, gaunt, rng, feet, fat, sex, age });
  // ---------------- arms
  for (const side of ['L', 'R']) {
    const c = ARM_COLS[side]; const [r6, r7, r8] = SOCKET_RINGS.map((i) => T[i]);
    const loop = [r6[c[0]], r6[c[1]], r6[c[2]], r7[c[2]], r8[c[2]], r8[c[1]], r8[c[0]], r7[c[0]]];
    arms[side] = buildArm(cage, side, loop, { girth, muscle, gaunt, rng, hands, fat, sex, age });
  }
  cage.fit(2, 4, 1.0); // limit surface interpolates the authored (anatomical) positions
  bakeCageAO(cage);
  return { cage, torso: T, legs, arms, hands, feet, crotch, build: { girth, belly, muscle, gaunt, fat, sex, age } };
}

// ------------------------------------------------------------------ limb ring helper
/** ring of n verts around centre c, axis d, front f (⟂ d); radii {front, back, lat, med}; latDir: unit ⟂ d pointing away from body */
function limbRing(cage, n, c, d, f, latDir, rad, w, pnt, shape = null) {
  const e2 = new V().crossVectors(d, f).normalize(); const ring = [];
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2; const dir = new V().copy(f).multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
    const cf = dir.dot(f), cl = dir.dot(latDir); const rF = cf >= 0 ? rad.front : rad.back, rL = cl >= 0 ? rad.lat : rad.med;
    let r = 1 / Math.sqrt((cf / rF) ** 2 + (cl / rL) ** 2 + 1e-12); if (shape) r *= shape(cf, cl, j);
    const p = new V().copy(c).addScaledVector(dir, r);
    ring.push(cage.v(p, typeof w === 'function' ? w(cf, cl) : w, pnt ? (typeof pnt === 'function' ? pnt(cf, cl) : pnt) : null));
  }
  return ring;
}

// ------------------------------------------------------------------ legs
function buildLeg(cage, side, loop, { girth, muscle, gaunt, rng, feet, fat = 0, sex = 0, age = 0 }) {
  const L = RIG.leg[side], sx = L.sx; const hip = new V(...L.hip), knee = new V(...L.knee), ankle = new V(...L.ankle);
  const down = new V(0, -1, 0); const lat = new V(sx, 0, 0);
  const g = girth * (1 - age * 0.05), th = (1 - gaunt * 0.18 + muscle * 0.05) * (1 + fat * 0.12 + sex * 0.04); const kn = 1.06, cf = 1.06 * (1 - sex * 0.04);
  const tag = (seg) => ({ part: seg < 4 ? 'thigh' : 'shin', side, seg, limb: 'leg' });
  const along = (a, b, t) => new V().copy(a).lerp(b, t);
  // stations along the leg: [y-fraction position, centre, radii, weights]
  const thighAt = (t) => along(hip, knee, t), shinAt = (t) => along(knee, ankle, t);
  const atY = (y) => { const t = y >= knee.y ? (hip.y - y) / (hip.y - knee.y) : 1 + (knee.y - y) / (knee.y - ankle.y); return t <= 1 ? thighAt(t) : shinAt(t - 1); };
  const ringDefs = [
    { c: atY(0.752).add(new V(sx * 0.006, 0, 0.004)), r: { front: 0.082 * g * th, back: 0.086 * g * th, lat: 0.084 * g, med: 0.072 * g * th }, w: { ['thigh.' + side]: 0.8, pelvis: 0.2 }, seg: 1 },
    { c: atY(0.655), r: { front: 0.078 * g * th, back: 0.079 * g * th, lat: 0.079 * g, med: 0.07 * g * th }, w: { ['thigh.' + side]: 1 }, seg: 2 },
    { c: atY(0.572), r: { front: 0.068 * g * th, back: 0.064 * g * th, lat: 0.064 * g, med: 0.067 * g * th }, w: { ['thigh.' + side]: 1 }, seg: 3 },
    { c: atY(0.498).add(new V(0, 0, -0.004)), r: { front: 0.058 * kn, back: 0.054 * g * kn, lat: 0.055 * g * kn, med: 0.059 * g * kn }, w: { ['thigh.' + side]: 0.55, ['calf.' + side]: 0.45 }, seg: 4 },
    { c: atY(0.425), r: { front: 0.048, back: 0.071 * g * th * cf, lat: 0.056 * g * cf, med: 0.06 * g * cf }, w: { ['calf.' + side]: 0.88, ['thigh.' + side]: 0.12 }, seg: 5 },
    { c: atY(0.335), r: { front: 0.046, back: 0.064 * g * th * cf, lat: 0.052 * g * cf, med: 0.055 * g * cf }, w: { ['calf.' + side]: 1 }, seg: 6 },
    { c: atY(0.215), r: { front: 0.036, back: 0.043 * g * th, lat: 0.039 * g, med: 0.04 * g }, w: { ['calf.' + side]: 1 }, seg: 7 },
    { c: atY(0.15), r: { front: 0.033, back: 0.033, lat: 0.034, med: 0.035 }, w: { ['calf.' + side]: 0.9, ['foot.' + side]: 0.1 }, seg: 8 },
  ];

  let prev = orient(cage, loop, down); const rings = [prev];
  for (const d of ringDefs) {
    const f = new V(0, 0, -1); const ring = limbRing(cage, 8, d.c, down, f, lat, d.r, d.w, null);
    const oriented = orient(cage, ring, down); bridge(cage, prev, oriented, tag(d.seg - 1)); prev = oriented; rings.push(oriented);
  }
  feet[side] = buildFoot(cage, side, prev, { girth, rng });
  return rings;
}

// ------------------------------------------------------------------ feet (bent tube: ankle → heel/instep → mid → ball → toes)
function buildFoot(cage, side, prevRing, { girth }) {
  const L = RIG.leg[side], sx = L.sx, ax = L.ankle[0];
  const w = (a, b, t) => { const o = {}; o[a] = 1 - t; if (b) o[b] = (o[b] || 0) + t; return o; };
  const fb = 'foot.' + side, tb = 'toe.' + side, cb = 'calf.' + side;
  // station: centre (rel x to ankle x), tube dir, top dir, half-width lat/med, top, bottom, weights
  const S = [
    { c: [0, 0.112, 0.020], d: [0, -1, 0], t: [0, 0, -1], wl: 0.037, wm: 0.036, h1: 0.034, h2: 0.033, w: w(cb, fb, 0.45), ml: 1.06 },
    { c: [0, 0.052, 0.014], d: [0, -0.7, -0.7], t: [0, 0.7, -0.7], wl: 0.043, wm: 0.042, h1: 0.05, h2: 0.078, w: w(fb, null, 0) },
    { c: [sx * 0.003, 0.03, -0.048], d: [0, -0.1, -1], t: [0, 1, -0.1], wl: 0.046, wm: 0.044, h1: 0.034, h2: 0.03, w: w(fb, null, 0) },
    { c: [sx * 0.006, 0.022, -0.112], d: [0, 0, -1], t: [0, 1, 0], wl: 0.049, wm: 0.05, h1: 0.024, h2: 0.022, w: w(fb, tb, 0.4) },
    { c: [sx * 0.004, 0.016, -0.162], d: [0, 0, -1], t: [0, 1, 0], wl: 0.044, wm: 0.048, h1: 0.017, h2: 0.016, w: w(tb, null, 0) },
  ];
  let prev = prevRing; const rings = [];
  S.forEach((s, si) => {
    const c = new V(ax + s.c[0], s.c[1], L.ankle[2] + s.c[2] - 0.004); const d = new V(...s.d).normalize(), t = new V(...s.t).normalize();
    const lat = new V().crossVectors(d, t).normalize(); if (lat.x * sx < 0) lat.negate();
    const ring = [];
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2; const ct = Math.cos(a), cl = Math.sin(a);
      const e2 = new V().crossVectors(d, t).normalize(); const dir = new V().copy(t).multiplyScalar(ct).addScaledVector(e2, cl);
      const cT = dir.dot(t), cL = dir.dot(lat);
      const rT = cT >= 0 ? s.h1 : s.h2, rL = cL >= 0 ? s.wl : s.wm;
      let r = 1 / Math.sqrt((cT / rT) ** 2 + (cL / rL) ** 2 + 1e-12); if (s.ml && Math.abs(cL) > 0.7) r *= s.ml; // malleoli
      const p = new V().copy(c).addScaledVector(dir, r);
      if (si >= 1 && p.y < 0.004) p.y = 0.004; // flat sole
      ring.push(cage.v(p, s.w, [1, 1, 1, 1, 1]));
    }
    const o = orient(cage, ring, d); bridge(cage, prev, o, { part: 'foot', side, seg: si, limb: 'leg' }); prev = o; rings.push(o);
  });
  capRing(cage, prev, new V(ax + sx * 0.004, 0.015, L.ankle[2] - 0.2), { [tb]: 1 }, { part: 'foot', side, seg: 5, limb: 'leg' }, [0.92, 0.9, 0.9, 1, 1]);
  return rings;
}

// ------------------------------------------------------------------ arms + hands
function buildArm(cage, side, socket, { girth, muscle, gaunt, rng, hands, fat = 0, sex = 0, age = 0 }) {
  const A = RIG.arm[side], sx = A.sx; const sh = new V(...A.sh), el = new V(...A.el), wr = new V(...A.wr);
  const u = new V(...A.u), fa = new V(...A.f); const g = girth * (1 - sex * 0.1 - age * 0.05), th = (1 - gaunt * 0.2 + muscle * 0.08) * (1 + fat * 0.14);
  const ua = 1.09, fo1 = 1.05; // survey: upper arm circ 0.30, forearm 0.27
  const front = (d) => new V(0, 0, -1).addScaledVector(d, d.z).normalize(); // −Z projected ⟂ d
  const latOf = (d) => { const l = new V(sx, 0.25, 0).addScaledVector(d, -(sx * d.x + 0.25 * d.y)); return l.normalize(); };
  const up = 'upperarm.' + side, fo = 'forearm.' + side, ha = 'hand.' + side, cl = 'clavicle.' + side;
  const at = (a, b, t) => new V().copy(a).lerp(b, t);
  const tag = (seg, part) => ({ part, side, seg, limb: 'arm' });
  const defs = [
    { c: at(sh, el, 0.12).addScaledVector(latOf(u), 0.012).add(new V(0, 0.008, 0)), d: u, r: { front: 0.056 * g * th, back: 0.058 * g * th, lat: 0.065 * g * th, med: 0.046 * g }, w: { [up]: 0.7, [cl]: 0.18, chest: 0.12 }, part: 'upperarm', seg: 0 },
    { c: at(sh, el, 0.36), d: u, r: { front: 0.047 * g * th * ua, back: 0.049 * g * th * ua, lat: 0.05 * g * th * ua, med: 0.042 * g * ua }, w: { [up]: 1 }, part: 'upperarm', seg: 1 },
    { c: at(sh, el, 0.63), d: u, r: { front: 0.048 * g * th * ua, back: 0.047 * g * th * ua, lat: 0.043 * g * ua, med: 0.043 * g * ua }, w: { [up]: 1 }, part: 'upperarm', seg: 2 },
    { c: at(sh, el, 0.93), d: u, r: { front: 0.039 * g, back: 0.044 * g, lat: 0.043 * g, med: 0.043 * g }, w: { [up]: 0.58, [fo]: 0.42 }, part: 'upperarm', seg: 3 },
    { c: at(el, wr, 0.17), d: fa, r: { front: 0.044 * g * th * fo1, back: 0.04 * g * fo1, lat: 0.046 * g * th * fo1, med: 0.042 * g * fo1 }, w: { [fo]: 0.88, [up]: 0.12 }, part: 'forearm', seg: 4 },
    { c: at(el, wr, 0.48), d: fa, r: { front: 0.036 * g * th, back: 0.034 * g, lat: 0.036 * g, med: 0.034 * g }, w: { [fo]: 1 }, part: 'forearm', seg: 5 },
    { c: at(el, wr, 0.8), d: fa, r: { front: 0.03, back: 0.028, lat: 0.031, med: 0.031 }, w: { [fo]: 1 }, part: 'forearm', seg: 6 },
  ];

  let prev = orient(cage, socket, u); const rings = [prev];
  defs.forEach((d, i) => {
    const ring = limbRing(cage, 8, d.c, d.d, front(d.d), latOf(d.d), d.r, d.w, null);
    const o = orient(cage, ring, d.d); bridge(cage, prev, o, tag(i, i <= 3 ? 'upperarm' : 'forearm')); prev = o; rings.push(o);
  });
  hands[side] = buildHand(cage, side, prev, rings);
  return rings;
}

function buildHand(cage, side, wristPrev, armRings) {
  const A = RIG.arm[side], sx = A.sx; const h = new V(...A.h), p = new V(...A.p), t = new V(...A.t); const W0 = new V(...A.wr);
  const P = (a, b, c) => new V().copy(W0).addScaledVector(h, a).addScaledVector(p, b).addScaledVector(t, c);
  const ha = 'hand.' + side, fo = 'forearm.' + side;
  const tag = (seg, part = 'hand') => ({ part, side, seg, limb: 'arm' });
  // wrist ring (8, flattened ellipse: wide along t, thin along p) at the joint
  const wristC = P(0.0, 0.002, 0.002);
  const wr = []; const e2 = new V().crossVectors(h, t).normalize();
  for (let j = 0; j < 8; j++) { const a = (j / 8) * Math.PI * 2; const dir = new V().copy(t).multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a)); const ct = dir.dot(t), cp = dir.dot(p); const r = 1 / Math.sqrt((ct / 0.031) ** 2 + (cp / (cp > 0 ? 0.021 : 0.019)) ** 2); wr.push(cage.v(new V().copy(wristC).addScaledVector(dir, r), { [fo]: 0.55, [ha]: 0.45 }, [1, 1, 1, 1, 1])); }
  let wrist = orient(cage, wr, h); bridge(cage, wristPrev, wrist, tag(7, 'forearm'));
  // palm rings: 10 verts = 5 dorsal columns + 5 palmar columns (thumb side → pinky side)
  const cols = [0.041, 0.019, -0.002, -0.021, -0.037];
  const palm = [
    { a: 0.018, w: [0.83, 0.86, 0.9, 0.9, 0.84], td: -0.012, tp: 0.016, wt: { [ha]: 0.8, [fo]: 0.2 } },
    { a: 0.05, w: [0.98, 1, 1, 1, 0.94], td: -0.014, tp: 0.017, wt: { [ha]: 1 } },
    { a: 0.084, w: [1.0, 1, 1, 1, 0.97], td: -0.012, tp: 0.012, wt: { [ha]: 1 } },
  ];
  const knA = [0.089, 0.093, 0.089, 0.080]; // knuckle arc (per finger) for the distal ring columns
  const colA = [knA[0] - 0.004, (knA[0] + knA[1]) / 2 - 0.002, (knA[1] + knA[2]) / 2 - 0.002, (knA[2] + knA[3]) / 2 - 0.002, knA[3] - 0.006];
  const mkPalmRing = (pr, distal) => {
    const d = [], q = [];
    for (let c = 0; c < 5; c++) {
      const a = distal ? colA[c] : pr.a; const cw = cols[c] * pr.w[c];
      const bulgeP = (c === 3 || c === 4) && !distal ? 0.003 : 0; // hypothenar
      d.push(cage.v(P(a, pr.td - (c === 1 || c === 2 ? 0.001 : 0), cw), distal ? { [ha]: 0.9, ...fingerW(side, c) } : pr.wt, [1, 1, 1, 1, 1]));
      q.push(cage.v(P(a + (distal ? -0.004 : 0), pr.tp + bulgeP, cw), distal ? { [ha]: 0.9, ...fingerW(side, c) } : pr.wt, [1.04, 1.02, 1.0, 1, 1]));
    }
    return { d, q, loop: [...d, ...q.slice().reverse()] };
  };
  const rings = palm.map((pr) => mkPalmRing(pr, false)); rings.push(mkPalmRing({ td: -0.011, tp: 0.009, w: [1, 1, 1, 1, 1] }, true));
  // orient palm loops toward h; remember whether reversed so the column bookkeeping stays right
  const loops = rings.map((r) => r.loop); const rev = loopNormal(cage, loops[0]).dot(h) < 0;
  const L = loops.map((l) => (rev ? l.slice().reverse() : l));
  // wrist → first palm ring (8 → 10, aligned at the dorsal thumb corner)
  const W = startAt(cage, wrist, cage.pos(rings[0].d[0])); const L0 = startAt(cage, L[0], cage.pos(rings[0].d[0]));
  bridge(cage, W, L0, tag(0), { align: false });
  // palm quads, leaving the thumb socket (thumb-edge quad between palm ring 0 and 1)
  const thumbEdge = new Set([rings[0].d[0], rings[0].q[0], rings[1].d[0], rings[1].q[0]]);
  for (let i = 0; i < L.length - 1; i++) {
    const A1 = L[i], B1 = L[i + 1], n = A1.length;
    for (let k = 0; k < n; k++) { const a = A1[k], b = A1[(k + 1) % n], c = B1[(k + 1) % n], d = B1[k]; if (i === 0 && thumbEdge.has(a) && thumbEdge.has(b) && thumbEdge.has(c) && thumbEdge.has(d)) continue; cage.f([a, b, c, d], tag(i + 1)); }
  }
  // fingers: sockets on the distal ring
  const dist = rings[3]; const FN = ['index', 'middle', 'ring', 'pinky'];
  const fingerRings = {};
  FN.forEach((fn, j) => {
    const socket = [dist.d[j], dist.d[j + 1], dist.q[j + 1], dist.q[j]];
    fingerRings[fn] = buildFinger(cage, side, fn, socket, false);
  });
  // thumb
  const tsock = [rings[0].d[0], rings[1].d[0], rings[1].q[0], rings[0].q[0]];
  fingerRings.thumb = buildFinger(cage, side, 'thumb', tsock, true);
  return { palm: rings, fingers: fingerRings };
}
function fingerW(side, c) { // distal palm column c is shared by fingers c-1 and c
  const FN = ['index', 'middle', 'ring', 'pinky']; const o = {};
  if (c > 0) o[FN[c - 1] + '1.' + side] = 0.05; if (c < 4) o[FN[c] + '1.' + side] = 0.05; return o;
}
function buildFinger(cage, side, fn, socket, isThumb) {
  const F = RIG.arm[side].fingers[fn]; const pts = F.pts.map((q) => new V(...q)); const A = RIG.arm[side]; const p0 = new V(...A.p);
  const b1 = fn + '1.' + side, b2 = fn + '2.' + side, b3 = fn + '3.' + side, ha = 'hand.' + side;
  const rad = F.rad * 1.0; // limit radius (cage is fitted)
  const tag = (seg) => ({ part: isThumb ? 'thumb' : 'finger', side, seg, limb: 'arm', finger: fn });
  // stations: [segment, fraction, radius scale, weights]
  const S = isThumb ? [
    [0, 0.45, 1.25, { [b1]: 0.8, [ha]: 0.2 }], [0, 1.0, 1.0, { [b1]: 0.5, [b2]: 0.5 }], [1, 0.55, 0.92, { [b2]: 1 }], [1, 1.0, 0.86, { [b2]: 0.5, [b3]: 0.5 }], [2, 0.6, 0.8, { [b3]: 1 }],
  ] : [
    [0, 0.42, 1.0, { [b1]: 0.8, [ha]: 0.2 }], [0, 1.0, 0.92, { [b1]: 0.5, [b2]: 0.5 }], [1, 0.5, 0.86, { [b2]: 1 }], [1, 1.0, 0.8, { [b2]: 0.5, [b3]: 0.5 }], [2, 0.6, 0.72, { [b3]: 1 }],
  ];
  const dir0 = new V().subVectors(pts[1], pts[0]).normalize();
  let prev = orient(cage, socket, dir0);
  // match ring corner order to the socket: socket corners in order → compute their local (lat, dorsal) signs
  const sc = prev.map((v) => cage.pos(v)); const cen = sc.reduce((a, b) => a.add(b), new V()).multiplyScalar(0.25);
  let lastDir = dir0;
  for (let i = 0; i < S.length; i++) {
    const [seg, fr, rs, w] = S[i]; const a = pts[seg], b = pts[seg + 1]; const c = new V().copy(a).lerp(b, fr); const d = new V().subVectors(b, a).normalize();
    // corner directions: take socket corner offsets, re-project ⟂ current axis, rescale to the finger radius (keeps winding + alignment)
    const ring = sc.map((q) => { const off = new V().subVectors(q, cen); off.addScaledVector(d, -off.dot(d)); const l = off.length() || 1; const dorsal = off.dot(p0) < 0; return new V().copy(c).addScaledVector(off.multiplyScalar(1 / l), rad * rs * (dorsal ? 1.0 : 1.08)); });
    const idx = ring.map((q) => cage.v(q, w, [1, 1, 1, 1, 1]));
    bridge(cage, prev, idx, tag(i), { align: false }); prev = idx; lastDir = d;
  }
  const tip = new V().copy(pts[3]).addScaledVector(lastDir, -0.002);
  const cap = cage.v(tip, { [b3]: 1 }, [0.9, 0.86, 0.86, 1, 1]); // (single centre → 4 triangles; CC rounds it into a fingertip)
  for (let k = 0; k < 4; k++) cage.f([prev[k], prev[(k + 1) % 4], cap], tag(9));
  return prev;
}

// ------------------------------------------------------------------ cage ambient occlusion (hemisphere rays vs body capsules)
const _dirs = (() => { const out = []; const n = 24; for (let i = 0; i < n; i++) { const y = 1 - (i + 0.5) / n * 2; const r = Math.sqrt(1 - y * y), phi = i * 2.399963; out.push(new V(Math.cos(phi) * r, y, Math.sin(phi) * r)); } return out; })();
export function bodyCapsules() {
  const caps = [];
  for (const b of RIG.bones) {
    if (!(b.r > 0)) continue; const n = b.name;
    const k = /^(pelvis|spine|chest|clavicle)/.test(n) ? 0.62 : n === 'neck' ? 0.8 : n === 'head' ? 0.0 : 0.88; if (k === 0) continue;
    caps.push({ a: b.pos.clone(), b: b.tail.clone(), r: b.r * k, bone: b.index });
  }
  caps.push({ a: new V(0, 1.62, 0.0), b: new V(0, 1.7, 0.0), r: 0.085, bone: BI.head });
  return caps;
}
function rayCapsule(o, d, c, maxT) { // returns t or -1 (approximate: sample closest approach)
  const ab = new V().subVectors(c.b, c.a); const ao = new V().subVectors(o, c.a);
  const abab = ab.dot(ab), abd = ab.dot(d), abao = ab.dot(ao);
  const A = abab - abd * abd, B = abab * ao.dot(d) - abao * abd, C = abab * ao.dot(ao) - abao * abao - c.r * c.r * abab;
  const h = B * B - A * C; if (h < 0 || Math.abs(A) < 1e-12) return -1;
  const t = (-B - Math.sqrt(h)) / A; const y = abao + t * abd; if (y > 0 && y < abab && t > 0 && t < maxT) return t;
  return -1;
}
export function bakeCageAO(cage, extra = []) {
  const caps = bodyCapsules().concat(extra); const N = cage.normals();
  for (let v = 0; v < cage.nv; v++) {
    const r = cage.R[v]; const n = new V(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); const o = new V(r[0], r[1], r[2]).addScaledVector(n, 0.012);
    // skip capsules of the vertex's own dominant bone (it would self-occlude)
    let dom = 0, dw = 0; for (let b = 0; b < NB; b++) if (r[3 + b] > dw) { dw = r[3 + b]; dom = b; }
    let occ = 0, tot = 0;
    for (const d of _dirs) { const c = d.dot(n); if (c <= 0.05) continue; tot += c; for (const cap of caps) { if (cap.bone === dom) continue; const t = rayCapsule(o, d, cap, 0.3); if (t > 0) { occ += c * (1 - t / 0.3) * 1.2; break; } } }
    const ao = tot > 0 ? Math.max(0.25, 1 - occ / tot) : 1; r[3 + NB + 3] *= ao;
  }
}

// ------------------------------------------------------------------ skin sculpt (anatomy as GEOMETRY on the subdivided skin)
// Displaces the LOD0/LOD1 skin along its normals with anatomical masses, bones and tendons (rest space, canonical 1.75 m male,
// A-pose; mirrored with |x|): clavicles + sternal notch, sternocleidomastoids, larynx, pecs + lower pec fold, deltoid caps,
// biceps / triceps, olecranon + epicondyles, brachioradialis, ulnar styloid, scapulae + medial borders, spinal groove +
// vertebral knuckles (gaunt), costal margin + iliac crest (gaunt), rectus abdominis (lean), vastus medialis, rectus femoris,
// patella + tuberosity, tibia crest, gastrocnemius heads, malleoli. Muscle raises masses; gaunt raises bones; fat softens both.
const _sa = new V(), _sb = new V(), _sp = new V();
function segDist(p, ax, ay, az, bx, by, bz) { _sa.set(ax, ay, az); _sb.set(bx - ax, by - ay, bz - az); const L2 = _sb.lengthSq() || 1; const t = Math.max(0, Math.min(1, _sp.copy(p).sub(_sa).dot(_sb) / L2)); return _sp.copy(_sa).addScaledVector(_sb, t).distanceTo(p); }
const bump = (q) => { const k = 1 - q * q; return k > 0 ? k * k : 0; };
const sstep = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
export function sculptSkin(cage, build = {}) {
  const muscle = build.muscle ?? 0.4, gaunt = build.gaunt ?? 0.3, fat = build.fat ?? 0, sex = build.sex ?? 0; const soft = 1 - fat * 0.7;
  const A = RIG.arm.R; const sh = new V(...A.sh), el = new V(...A.el), wr = new V(...A.wr), u = new V(...A.u), f = new V(...A.f);
  const back = new V(0, 0, 1), lat = new V(1, 0.1, 0).normalize();
  const bicep = sh.clone().lerp(el, 0.55).add(new V(0, 0, -0.036)), tricep = sh.clone().lerp(el, 0.42).add(new V(0.01, 0, 0.036)), olec = el.clone().add(new V(0.004, 0.012, 0.034));
  const epiL = el.clone().addScaledVector(lat, 0.028), epiM = el.clone().addScaledVector(lat, -0.03).add(new V(0, 0.012, 0)), brach = el.clone().lerp(wr, 0.22).addScaledVector(lat, 0.026).add(new V(0, 0, -0.018)), styl = wr.clone().add(new V(0.008, 0.012, 0.022));
  const N = cage.normals(); const p = new V();
  const K = {
    pec: 0.0075 * (0.4 + muscle) * (1 - gaunt * 0.6) * (1 - sex) * soft, fold: -0.003 * (0.3 + muscle) * (1 - sex) * soft, clav: 0.0035 + gaunt * 0.004 - fat * 0.003, notch: -0.006 * (0.6 + gaunt * 0.6),
    scm: 0.0028 * soft + gaunt * 0.0015, lar: 0.004 * (1 - sex), delt: 0.0065 * (0.5 + muscle) * (1 - gaunt * 0.4) * soft, bi: 0.0045 * (0.3 + muscle) * soft, tri: 0.0035 * (0.3 + muscle) * soft,
    olec: 0.0045 + gaunt * 0.003, epi: 0.0022 + gaunt * 0.002, brach: 0.0035 * (0.3 + muscle) * soft, styl: 0.0025 + gaunt * 0.002,
    scap: 0.004 + gaunt * 0.004, scapB: gaunt * 0.004, groove: -0.003 * (1 - gaunt * 0.4) * soft, erect: 0.003 * (0.4 + muscle) * (1 - gaunt * 0.5) * soft, vert: gaunt * 0.0035 * soft, costal: gaunt * 0.004 * soft, iliac: gaunt * 0.005 * soft, abs: 0.002 * muscle * (1 - fat) * (1 - gaunt * 0.5),
    vm: 0.0045 * (0.4 + muscle) * soft, rf: 0.0022 * (0.3 + muscle) * soft, pat: 0.005, tub: 0.003, tib: 0.002 + gaunt * 0.0015, gas: 0.0055 * (0.4 + muscle) * (1 - gaunt * 0.3), mal: 0.004 + gaunt * 0.002,
  };
  for (let v = 0; v < cage.nv; v++) {
    const r = cage.R[v]; const x = Math.abs(r[0]), y = r[1], z = r[2]; p.set(x, y, z); let d = 0;
    if (y > 1.2 && y < 1.66) { // shoulders, clavicles, neck
      d += K.clav * bump(segDist(p, 0.018, 1.447, -0.066, 0.16, 1.466, -0.02) / 0.014);
      d += K.notch * bump(Math.hypot(x / 0.022, (y - 1.448) / 0.018, (z + 0.068) / 0.02));
      if (y > 1.44) d += K.scm * bump(segDist(p, 0.05, 1.6, 0.004, 0.014, 1.462, -0.058) / 0.012);
      d += K.lar * bump(Math.hypot(x / 0.014, (y - 1.515) / 0.016, (z + 0.058) / 0.014));
      d += K.delt * bump(Math.hypot((x - 0.205) / 0.052, (y - 1.36) / 0.07, z / 0.06));
    }
    if (y > 1.15 && y < 1.4 && z < -0.03) { d += K.pec * bump(Math.hypot((x - 0.078) / 0.078, (y - 1.29) / 0.058, (z + 0.12) / 0.06)); d += K.fold * bump((y - 1.232) / 0.016) * bump((x - 0.085) / 0.07); }
    if (y > 0.9 && y < 1.5 && z > 0.03) { // back
      d += K.scap * bump(Math.hypot((x - 0.095) / 0.06, (y - 1.34) / 0.08, (z - 0.1) / 0.05)) + K.scapB * bump(segDist(p, 0.058, 1.42, 0.1, 0.074, 1.255, 0.1) / 0.014);
      // spinal furrow between the erector spinae columns: wide + shallow, deepest in the lumbar region, fading at sacrum and C7
      const wy = sstep(0.92, 1.0, y) * (1 - sstep(1.36, 1.47, y)), lum = 1 - 0.5 * sstep(1.1, 1.3, y);
      if (x < 0.075) d += (K.groove * lum * bump(x / 0.032) + K.erect * lum * bump((x - 0.042) / 0.032) + K.vert * bump(x / 0.016) * Math.max(0, Math.cos((y - 1.0) / 0.028 * Math.PI * 2))) * wy;
    }
    if (y > 0.98 && y < 1.36 && N[v * 3 + 2] < -0.35) { // front landmarks: navel pit (deeper with fat), nipples + areolae, breasts (sex)
      d -= (0.005 + fat * 0.008) * bump(Math.hypot(x / (0.011 + fat * 0.004), (y - 1.043) / (0.013 + fat * 0.004))) - 0.0015 * soft * bump(Math.hypot(x / 0.026, (y - 1.05) / 0.024)); // (level-2 skin: ~1.3 cm vertex spacing)
      if (y > 1.12) { const nd = Math.hypot((x - 0.097 + sex * 0.005) / 1, (y - 1.292 + sex * 0.05) / 1); d += 0.0009 * bump(nd / 0.018) + 0.0018 * bump(nd / 0.009) + sex * 0.036 * bump(Math.hypot((x - 0.092) / 0.075, (y - 1.262) / 0.07)); }
    }
    if (y > 0.9 && y < 1.25 && z < -0.02) { d += K.costal * bump(segDist(p, 0.02, 1.2, -0.115, 0.13, 1.1, -0.07) / 0.01) + K.iliac * bump(segDist(p, 0.13, 1.0, -0.03, 0.085, 0.935, -0.095) / 0.012); if (x > 0.015 && x < 0.07 && y > 0.98) d += K.abs * Math.max(0, Math.cos((y - 1.0) / 0.055 * Math.PI * 2)) * bump((x - 0.042) / 0.028); }
    if (x > 0.2 && y > 0.75 && y < 1.45) { // arms (A-pose, right side mirrored)
      d += K.bi * bump(p.distanceTo(bicep) / 0.048) + K.tri * bump(p.distanceTo(tricep) / 0.05) + K.olec * bump(p.distanceTo(olec) / 0.018) + K.epi * (bump(p.distanceTo(epiL) / 0.013) + bump(p.distanceTo(epiM) / 0.015));
      d += K.brach * bump(p.distanceTo(brach) / 0.04) + K.styl * bump(p.distanceTo(styl) / 0.012);
    }
    if (y < 0.85 && x > 0.02 && x < 0.2) { // legs
      d += K.vm * bump(Math.hypot((x - 0.074) / 0.034, (y - 0.57) / 0.05, (z + 0.055) / 0.04)) + K.rf * bump(segDist(p, 0.095, 0.8, -0.085, 0.097, 0.56, -0.074) / 0.02);
      d += K.pat * bump(Math.hypot((x - 0.097) / 0.028, (y - 0.5) / 0.033, (z + 0.07) / 0.022)) + K.tub * bump(Math.hypot((x - 0.097) / 0.015, (y - 0.438) / 0.015, (z + 0.06) / 0.015));
      d += K.tib * bump(segDist(p, 0.098, 0.43, -0.056, 0.1, 0.17, -0.036) / 0.02);
      d += K.gas * (bump(Math.hypot((x - 0.112) / 0.028, (y - 0.37) / 0.07, (z - 0.048) / 0.04)) + bump(Math.hypot((x - 0.085) / 0.03, (y - 0.36) / 0.075, (z - 0.048) / 0.04)));
      d += K.mal * (bump(Math.hypot((x - 0.133) / 0.014, (y - 0.083) / 0.016, (z - 0.02) / 0.016)) + bump(Math.hypot((x - 0.071) / 0.014, (y - 0.095) / 0.016, (z - 0.02) / 0.016)));
    }
    if (d !== 0) { r[0] += N[v * 3] * d; r[1] += N[v * 3 + 1] * d; r[2] += N[v * 3 + 2] * d; }
  }
  void back; void u; void f;
}
