// AFTER HOURS — real construction helpers: coursed masonry, chains, branching trees. Everything is geometry pushed through the Builder into EXISTING materials (static batches: no new draws).
// Reference sizes (metres): ashlar course 0.26-0.40, block length 0.5-1.15, mortar joint 1.4 cm, block face proud of the wall by 3-9 cm; chain link pitch 9 cm, wire 2.4 cm.
import * as THREE from 'three';
import { pipe, torus, TAU, PI } from './common.js';

const q = (v, s = 200) => Math.round(v * s) / s;
const slabC = new Map();
/** masonry block with only the faces that can ever be seen: front (+z), top, left, right (no back / bottom) = 16 verts instead of 24; texture units are metres (boxUV convention) */
function slabRaw(w, h, d) {
  const k = `${w}|${h}|${d}`; let r = slabC.get(k); if (r) return r;
  const hx = w / 2, hy = h / 2, hz = d / 2, P = [-hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz,  -hx, hy, -hz, -hx, hy, hz, hx, hy, hz, hx, hy, -hz,  -hx, -hy, -hz, -hx, -hy, hz, -hx, hy, hz, -hx, hy, -hz,  hx, -hy, hz, hx, -hy, -hz, hx, hy, -hz, hx, hy, hz];
  const N = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,  -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,  1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], U = new Float32Array(32);
  for (let f = 0; f < 4; f++) for (let v = 0; v < 4; v++) { const i = (f * 4 + v) * 3, px = P[i], py = P[i + 1], pz = P[i + 2]; const o = (f * 4 + v) * 2; if (f === 0) { U[o] = px; U[o + 1] = py; } else if (f === 1) { U[o] = px; U[o + 1] = -pz; } else if (f === 2) { U[o] = pz; U[o + 1] = py; } else { U[o] = -pz; U[o + 1] = py; } }
  const I = []; for (let f = 0; f < 4; f++) I.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  r = { p: new Float32Array(P), n: new Float32Array(N), u: U, i: new Uint32Array(I) }; slabC.set(k, r); return r;
}
const capC = new Map();
/** paving setts: top + four sides only (20 verts) */
function capRaw(w, h, d) {
  const k = `${w}|${h}|${d}`; let r = capC.get(k); if (r) return r;
  const hx = w / 2, hy = h / 2, hz = d / 2, P = [], N = [], U = [], I = []; const face = (pts, n, uf) => { const b = P.length / 3; for (const p of pts) { P.push(...p); N.push(...n); U.push(...uf(p)); } I.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  face([[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]], [0, 1, 0], (p) => [p[0], -p[2]]);
  face([[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], [0, 0, 1], (p) => [p[0], p[1]]); face([[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], [0, 0, -1], (p) => [-p[0], p[1]]);
  face([[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], [-1, 0, 0], (p) => [p[2], p[1]]); face([[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], [1, 0, 0], (p) => [-p[2], p[1]]);
  r = { p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }; capC.set(k, r); return r;
}
/** one masonry block: cached raw + a random texture offset so neighbouring blocks never show the same patch of the material */
function blk(B, rng, p, yaw, pitch, roll, w, h, d, mat, cast, cap = false) {
  const r = (cap ? capRaw : slabRaw)(q(w), q(h, 100), q(d, 100)), u = new Float32Array(r.u), ou = rng() * 5, ov = rng() * 5;
  for (let k = 0; k < u.length; k += 2) { u[k] += ou; u[k + 1] += ov; }
  B.addRaw({ p: r.p, n: r.n, u, i: r.i }, B.matrix(p, yaw, 1, pitch, roll), mat, { cast });
}

/** Coursed ashlar on a vertical face. p = bottom-left corner seen from outside, yaw so local +Z is the outward normal (yaw 0 = faces +z, u runs +x), w x h metres.
 *  Running bond, random course heights and block lengths, per-block protrusion + slight tilt. skip(u, v, bw, bh) removes blocks (openings). */
export function ashlar(B, { p, yaw = 0, w, h, y0 = 0, mat, rng, ch = [0.26, 0.4], bw = [0.5, 1.15], gap = 0.014, prot = 0.06, depth = 0.34, jit = 0.014, skip = null, cast = false }) {
  const c = Math.cos(yaw), s = Math.sin(yaw); let v = y0, row = 0;
  while (v < h - 0.05) {
    const hh = Math.min(h - v, q(ch[0] + rng() * (ch[1] - ch[0]), 50)); let u = row % 2 ? -0.5 * rng() * bw[1] : 0;
    while (u < w - 0.02) {
      const ww = q(bw[0] + rng() * (bw[1] - bw[0]), 20), u0 = Math.max(0, u), u1 = Math.min(w, u + ww);
      if (u1 - u0 > 0.14) { const cu = (u0 + u1) / 2, cv = v + hh / 2;
        if (!skip || !skip(cu, cv, u1 - u0, hh)) { const n = prot + (rng() - 0.5) * 0.06 - depth / 2;
          blk(B, rng, [p[0] + cu * c + n * s, p[1] + cv, p[2] - cu * s + n * c], yaw + (rng() - 0.5) * jit, (rng() - 0.5) * jit, (rng() - 0.5) * jit, u1 - u0 - gap, hh - gap, depth, mat, cast); } }
      u += ww;
    }
    v += hh; row++;
  }
}

/** Coursed ashlar on a round tower: angles a0..a1 (x = cx + r cos a, z = cz + r sin a; a = PI/2 faces +z). skip(x, y, z) removes blocks. */
export function ashlarRing(B, { c, r, y0 = 0, y1, a0 = 0, a1 = PI, mat, rng, ch = [0.26, 0.4], bw = [0.5, 1.1], prot = 0.06, depth = 0.34, gap = 0.014, skip = null, cast = false }) {
  let v = y0, row = 0;
  while (v < y1 - 0.05) {
    const hh = Math.min(y1 - v, q(ch[0] + rng() * (ch[1] - ch[0]), 50)); let a = a0 - (row % 2 ? 0.5 * rng() * bw[1] / r : 0);
    while (a < a1) {
      const da = q(bw[0] + rng() * (bw[1] - bw[0]), 20) / r, th = a + da / 2;
      if (th > a0 && th < a1) { const R = r + prot + (rng() - 0.5) * 0.06 - depth / 2, x = c[0] + R * Math.cos(th), z = c[1] + R * Math.sin(th);
        if (!skip || !skip(x, v + hh / 2, z)) blk(B, rng, [x, v + hh / 2, z], PI / 2 - th + (rng() - 0.5) * 0.02, (rng() - 0.5) * 0.014, (rng() - 0.5) * 0.014, 2 * r * Math.sin(da / 2) - gap, hh - gap, depth, mat, cast); }
      a += da;
    }
    v += hh; row++;
  }
}

/** iron chain between two points: alternating flat / edge-on torus links with optional sag (hangs like a catenary) */
export function chain(B, a, b, mat, { sag = 0, pitch = 0.085, r = 0.024, wire = 0.009, cast = false } = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(2, Math.round(L / pitch)), yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
  for (let i = 0; i <= n; i++) { const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t);
    torus(B, { p: [x, y, z], R: r, r: wire, seg: 4, tube: 8, yaw, pitch: i % 2 ? 0 : PI / 2, roll: 0, mat, cast, arc: TAU }); }
}

/** Real branching dead tree: tapered trunk with root flare, then 3-4 generations of forking limbs (each a tapered cylinder), gnarled and asymmetric. Returns the top of the trunk. */
export function branchTree(B, rng, mat, [x, y0, z], { h = 4.6, r = 0.3, lean = 0.4, levels = 4, kids = [2, 3], curl = 0.55, fork = 0.62, cast = true } = {}) {
  const top = [x + lean, y0 + h, z + (rng() - 0.5) * 0.6];
  for (let i = 0; i < 4; i++) { const a = i * 1.6 + rng(), rr = r * (2.2 + rng()); pipe(B, [x + Math.cos(a) * rr, y0 - 0.1, z + Math.sin(a) * rr], [x, y0 + 0.9, z], r * 0.5, mat, { seg: 5, r2: r * 0.85, cast: false }); }   // buttress roots
  pipe(B, [x, y0, z], [x + lean * 0.5, y0 + h * 0.55, z], r * 1.15, mat, { seg: 8, r2: r * 0.8, cast }); pipe(B, [x + lean * 0.5, y0 + h * 0.55, z], top, r * 0.8, mat, { seg: 7, r2: r * 0.5, cast });
  const grow = (a, dx, dy, dz, len, rad, lvl) => {
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; const b = [a[0] + dx * len, a[1] + dy * len, a[2] + dz * len];
    pipe(B, a, b, rad, mat, { seg: lvl < 2 ? 6 : 4, r2: rad * 0.62, cast: cast && lvl < 2 });
    if (lvl >= levels) return;
    const n = kids[0] + Math.floor(rng() * (kids[1] - kids[0] + 1));
    for (let k = 0; k < n; k++) { const ang = (k / n + rng() * 0.3) * TAU; const nx = dx * 0.55 + Math.cos(ang) * curl * (0.6 + rng() * 0.6), nz = dz * 0.55 + Math.sin(ang) * curl * (0.6 + rng() * 0.6), ny = dy * 0.55 + 0.25 + rng() * 0.35;
      grow(b, nx, ny, nz, len * (fork + rng() * 0.16), rad * 0.66, lvl + 1); }
  };
  const nMain = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < nMain; i++) { const t = 0.42 + 0.5 * i / nMain, a0 = i * 2.4 + rng(), base = [x + lean * t * 0.8, y0 + h * t, z]; grow(base, Math.cos(a0), 0.55 + rng() * 0.5, Math.sin(a0), h * (0.42 + rng() * 0.25), r * (0.55 - 0.2 * t), 1); }
  return top;
}

/** ring of radially oriented voussoirs following a polyline (arch), on a wall whose local +Z is outward. pts [[u,v]..] boundary of the opening; blocks sit outside it. */
export function voussoirs(B, { p, yaw = 0, pts, center, mat, rng, out = 0.42, depth = 0.5, prot = 0.09, cast = false }) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < pts.length - 1; i++) { const [u0, v0] = pts[i], [u1, v1] = pts[i + 1], sl = Math.hypot(u1 - u0, v1 - v0); if (sl < 0.05) continue; const tx = (u1 - u0) / sl, ty = (v1 - v0) / sl;
    const mx = (u0 + u1) / 2 - center[0], my = (v0 + v1) / 2 - center[1]; let nx = ty, ny = -tx; if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
    const cu = (u0 + u1) / 2 + nx * out / 2, cv = (v0 + v1) / 2 + ny * out / 2, n = prot - depth / 2 + (rng() - 0.5) * 0.03;
    blk(B, rng, [p[0] + cu * c + n * s, p[1] + cv, p[2] - cu * s + n * c], yaw, 0, Math.atan2(ty, tx) + (rng() - 0.5) * 0.03, Math.max(0.2, sl - 0.02), out - 0.02, depth, mat, cast); }
}

/** cobbled paving as real stones: rounded-ish setts 0.16-0.28 m, 3-6 cm proud, random tilt and texture offset, skipping rectangles in `skip` ([x0,z0,x1,z1]) */
export function cobbles(B, { x0, z0, x1, z1, mat, rng, sz = [0.3, 0.46], skip = [], cast = false }) {
  const step = 0.36; for (let z = z0; z < z1; z += step) { const off = (Math.round((z - z0) / step) % 2) * 0.18; for (let x = x0 + off; x < x1; x += step) {
    const w = q(sz[0] + rng() * (sz[1] - sz[0]), 100), d = q(sz[0] + rng() * (sz[1] - sz[0]), 100), px = x + (rng() - 0.5) * 0.08, pz = z + (rng() - 0.5) * 0.08; if (skip.some((k) => px > k[0] && px < k[2] && pz > k[1] && pz < k[3])) continue;
    const h = q(0.1 + rng() * 0.06, 100); blk(B, rng, [px, h / 2 - 0.085 + rng() * 0.02, pz], rng() * PI, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08, w * 0.97, h, d * 0.97, mat, cast, true); } }
}
