// LAST FERRY — building helpers: walls with window/door dressing, gable roofs (with brick gable ends), sawtooth roofs, fire escapes, hoist beams, downpipes.
// Footprint boxes are axis-aligned (colliders stay exact). Facade directions: 'n' (-z), 's' (+z), 'w' (-x), 'e' (+x).
import * as THREE from 'three';
import { rawToGeometry } from '../../core/build.js';

const P = Math.PI;
/** triangular gable end: base w (along axis), height h, thickness t; centred at (x, y, z) on the ground plane of the wall top. axis 'x' => triangle lies in the XY plane */
export function gableRaw(w, h, t, axis = 'x') {
  const hw = w / 2, ht = t / 2; const p = [], n = [], u = [], i = []; const quad = (a, b, c, d, nn, uv) => { const k = p.length / 3; for (const q of [a, b, c, d]) p.push(...q); for (let j = 0; j < 4; j++) n.push(...nn); u.push(...uv); i.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  const tri = (a, b, c, nn, uv) => { const k = p.length / 3; for (const q of [a, b, c]) p.push(...q); for (let j = 0; j < 3; j++) n.push(...nn); u.push(...uv); i.push(k, k + 1, k + 2); };
  // front face (+z), back face (-z), two slopes (soffit-like thin), base skipped
  tri([-hw, 0, ht], [hw, 0, ht], [0, h, ht], [0, 0, 1], [-hw, 0, hw, 0, 0, h]); tri([hw, 0, -ht], [-hw, 0, -ht], [0, h, -ht], [0, 0, -1], [hw, 0, -hw, 0, 0, h]);
  const sl = Math.hypot(hw, h), nx = h / sl, ny = hw / sl; quad([hw, 0, ht], [hw, 0, -ht], [0, h, -ht], [0, h, ht], [nx, ny, 0], [0, 0, t, 0, t, sl, 0, sl]); quad([-hw, 0, -ht], [-hw, 0, ht], [0, h, ht], [0, h, -ht], [-nx, ny, 0], [0, 0, t, 0, t, sl, 0, sl]);
  const raw = { p: new Float32Array(p), n: new Float32Array(n), u: new Float32Array(u), i: new Uint32Array(i) };
  if (axis === 'z') { for (let k = 0; k < raw.p.length; k += 3) { const x = raw.p[k], z = raw.p[k + 2]; raw.p[k] = z; raw.p[k + 2] = -x; const nx_ = raw.n[k], nz = raw.n[k + 2]; raw.n[k] = nz; raw.n[k + 2] = -nx_; } }
  return raw;
}
const M4 = new THREE.Matrix4();

export function makeBuilding(K, mats) {
  const B = K.B;
  /** gable roof over footprint [x0,z0,x1,z1] with ridge along `ridge` ('x' or 'z'), wall top at y, ridge height h, overhang o. Gable ends use mats.wall. */
  const gableRoof = (x0, z0, x1, z1, y, h, ridge = 'x', o = 0.35, roofMat = mats.roof, wallMat = mats.wall) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, L = ridge === 'x' ? x1 - x0 : z1 - z0, W = ridge === 'x' ? z1 - z0 : x1 - x0; const ang = Math.atan2(h, W / 2), sl = Math.hypot(W / 2, h) + o;
    for (const sd of [-1, 1]) { const off = sd * (W / 4 + o * 0.25); const yy = y + h / 2 - 0.02;
      if (ridge === 'x') B.box({ p: [cx, yy, cz + off], s: [L + o * 2, 0.08, sl], mat: roofMat, roll: 0, pitch: sd * ang, bevel: 0, col: false, cast: true }); else B.box({ p: [cx + off, yy, cz], s: [sl, 0.08, L + o * 2], mat: roofMat, roll: -sd * ang, bevel: 0, col: false, cast: true }); }
    // ridge cap
    if (ridge === 'x') B.box({ p: [cx, y + h - 0.02, cz], s: [L + o * 2, 0.12, 0.22], mat: mats.trim, bevel: 0.01, cast: false }); else B.box({ p: [cx, y + h - 0.02, cz], s: [0.22, 0.12, L + o * 2], mat: mats.trim, bevel: 0.01, cast: false });
    // brick gable ends
    const raw = gableRaw(W, h, 0.4, ridge === 'x' ? 'x' : 'x'); const ends = ridge === 'x' ? [[x0 + 0.2, 'z'], [x1 - 0.2, 'z']] : [[z0 + 0.2, 'x'], [z1 - 0.2, 'x']];
    for (const [c, ax] of ends) { const r2 = gableRaw(W, h, 0.4, ridge === 'x' ? 'z' : 'x'); const m = M4.clone().makeTranslation(ridge === 'x' ? c : cx, y, ridge === 'x' ? cz : c); B.addRaw(r2, m, wallMat, { cast: true }); }
  };
  /** flat roof with parapet */
  const flatRoof = (x0, z0, x1, z1, y, par = 0.5) => { B.box({ p: [(x0 + x1) / 2, y, (z0 + z1) / 2], s: [x1 - x0 + 0.3, 0.3, z1 - z0 + 0.3], mat: mats.trim, bevel: 0.02, cast: true, col: false, walk: false }); for (const [a, b] of [[[x0, z0], [x1, z0]], [[x0, z1], [x1, z1]]]) B.box({ p: [(a[0] + b[0]) / 2, y + 0.3, a[1]], s: [x1 - x0 + 0.3, par, 0.3], mat: mats.wall, bevel: 0.02, cast: true }); for (const x of [x0, x1]) B.box({ p: [x, y + 0.3, (z0 + z1) / 2], s: [0.3, par, z1 - z0 + 0.3], mat: mats.wall, bevel: 0.02, cast: true }); };
  /** window with reveal, frame and sill on a facade. face: 'n'|'s'|'w'|'e'; (u,y): position along the wall from its origin, wall origin & length defined by fx/fz. lit: emissive material or dark glass */
  const windowAt = (face, x, z, y, w, h, o = {}) => {
    const glass = o.lit ? (o.litMat || mats.lit) : mats.dark; const dx = face === 'e' ? 1 : face === 'w' ? -1 : 0, dz = face === 's' ? 1 : face === 'n' ? -1 : 0; const alongX = dz !== 0;
    const at = (a, b, hh, ww, dd, m, ys = y) => B.box({ p: [x + dx * dd + (alongX ? a : 0), ys + b, z + dz * dd + (alongX ? 0 : a)], s: alongX ? [ww, hh, 0.04] : [0.04, hh, ww], mat: m, bevel: 0, cast: false, col: false });
    at(0, 0, h, w, 0.03, mats.reveal); at(0, 0.03, h - 0.06, w - 0.08, 0.045, glass);
    if (o.arch) { const r = w / 2; B.cyl({ p: [x + dx * 0.05 + 0, y + h + 0.0, z + dz * 0.05], r: r - 0.02, h: 0.03, seg: 12, mat: glass, pitch: alongX ? P / 2 : 0, roll: alongX ? 0 : P / 2, anchor: 'center', cast: false }); }
    // frame bars
    const fw = 0.05; at(0, h / 2 - 0.02, fw, w, 0.06, mats.frame); at(0, 0.0, fw, w, 0.06, mats.frame); at(-w / 2 + 0.03, 0.02, h - 0.04, fw, 0.06, mats.frame); at(w / 2 - 0.03, 0.02, h - 0.04, fw, 0.06, mats.frame); at(0, 0.02, h - 0.04, fw * 0.7, 0.06, mats.frame);
    if (o.bars) { for (let k = -1; k <= 1; k++) at(k * w * 0.28, 0.02, h - 0.04, 0.025, 0.08, mats.iron); at(0, h * 0.35, 0.025, w, 0.08, mats.iron); at(0, h * 0.7, 0.025, w, 0.08, mats.iron); }
    // sill + lintel (stone)
    at(0, -0.06, 0.09, w + 0.28, 0.12, mats.stone); at(0, h + 0.02, 0.14, w + 0.2, 0.08, mats.stone);
  };
  /** window grid along a facade. face 'n'|'s': wall spans x from a to b at z=c; 'w'|'e': spans z from a to b at x=c. */
  const windowGrid = (face, a, b, c, y0, rows, cols, ww, wh, gap, o = {}) => {
    const len = b - a, step = len / cols, rng = K.rng; for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { const u = a + step * (k + 0.5); const lit = o.litP != null ? rng() < o.litP : false; const hh = o.hs ? wh * o.hs[r] : wh;
      const x = face === 'n' || face === 's' ? u : c, z = face === 'n' || face === 's' ? c : u; windowAt(face, x, z, y0 + r * gap, ww, hh, { lit, arch: o.arch && r === rows - 1 ? true : o.arch === 'all', bars: o.bars, litMat: o.litMats ? o.litMats[(rng() * o.litMats.length) | 0] : undefined }); }
  };
  /** iron fire escape (zigzag stairs + landings) on facade 'n'/'s' at x, wall plane z, from y0 to y1 */
  const fireEscape = (x, z, dir, y0, y1, iron, o = {}) => {
    const flights = Math.max(1, Math.round((y1 - y0) / 3)), fh = (y1 - y0) / flights, w = 1.0, run = 2.4;
    for (let f = 0; f < flights; f++) { const yb = y0 + f * fh; const sd = f % 2 ? -1 : 1;
      B.box({ p: [x, yb + fh - 0.06, z + dir * 0.6], s: [run + 0.4, 0.06, 1.2], mat: iron, bevel: 0.005, cast: true, col: false }); // landing
      const a = [x - sd * run / 2, yb, z + dir * 1.25], b2 = [x + sd * run / 2, yb + fh - 0.06, z + dir * 1.25]; for (const dz of [-0.5, 0.5]) B.beam([a[0], a[1], a[2] + dz * dir], [b2[0], b2[1], b2[2] + dz * dir], 0.06, 0.12, { mat: iron, bevel: 0, cast: false });
      const n = 10; for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; B.box({ p: [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t, a[2]], s: [0.28, 0.03, w], mat: iron, bevel: 0, cast: false }); }
      for (const dz of [-0.5, 0.5]) { B.beam([a[0], a[1] + 0.95, a[2] + dz * dir], [b2[0], b2[1] + 0.95, b2[2] + dz * dir], 0.03, 0.03, { mat: iron, bevel: 0, cast: false }); }
      for (const dx2 of [-run / 2 - 0.18, run / 2 + 0.18]) B.box({ p: [x + dx2, yb + fh - 0.06, z + dir * 0.6], s: [0.04, 1.0, 1.2], mat: iron, bevel: 0, cast: false }); }
    B.box({ p: [x, y0, z + dir * 0.1], s: [0.06, y1 - y0, 0.06], mat: iron, bevel: 0, cast: false });
  };
  /** hoist beam with pulley and hanging hook + rope at a gable apex/wall. p = wall attach (x,y,z), dir = outward unit (dx,dz) */
  const hoist = (x, y, z, dx, dz, iron, rope) => {
    B.beam([x, y, z], [x + dx * 1.8, y + 0.05, z + dz * 1.8], 0.12, 0.18, { mat: iron, bevel: 0.01, cast: true }); B.beam([x + dx * 0.15, y - 0.7, z + dz * 0.15], [x + dx * 1.6, y, z + dz * 1.6], 0.05, 0.05, { mat: iron, bevel: 0, cast: false });
    B.cyl({ p: [x + dx * 1.7, y - 0.25, z + dz * 1.7], r: 0.15, h: 0.05, seg: 12, mat: iron, pitch: dz !== 0 ? 0 : P / 2, roll: dz !== 0 ? P / 2 : 0, anchor: 'center', cast: false });
    B.tube({ pts: [[x + dx * 1.7, y - 0.3, z + dz * 1.7], [x + dx * 1.72, y - 2.5, z + dz * 1.72], [x + dx * 1.72, y - 4.4, z + dz * 1.72]], r: 0.018, mat: rope, seg: 4, segs: 8, cast: false }); B.box({ p: [x + dx * 1.72, y - 4.7, z + dz * 1.72], s: [0.12, 0.3, 0.12], mat: iron, bevel: 0.02, cast: false });
  };
  /** downpipe */ const downpipe = (x, z, y0, y1, iron) => B.cyl({ p: [x, y0, z], r: 0.055, h: y1 - y0, seg: 6, mat: iron, cast: false });
  return { gableRoof, flatRoof, windowAt, windowGrid, fireEscape, hoist, downpipe };
}
