// Mouth interior: lip pouch (vestibule → palate / floor → throat), 32 individually shaped teeth (incisors, canines, premolars,
// molars with cusps, crowding, wear, breaks, stains, gaps) on gum bands, tongue with a median groove. Upper half is skinned to the
// head bone, lower half to the jaw bone (the mouth really opens). Also exports gridMesh() — smooth-normal emitter for parametric grids.
import * as THREE from 'three';
import { BI } from './rig.js';
import { matSpec } from './mesh.js';
import { MOUTH_Y } from './face.js';

const V = THREE.Vector3;
const TAU = Math.PI * 2;
export const ZT = (globalThis.__ZT = globalThis.__ZT || {});
export function zt(name, t0) { ZT[name] = (ZT[name] || 0) + (performance.now() - t0); }
export function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * Emit a parametric grid G[i][j] (i rows, j columns; Vector3 or [x,y,z]) with smooth normals from central differences.
 * opt: {wrapJ (columns wrap), wrapI, flip, w: weights | (i,j,p)=>weights, spec | (i,j)=>spec, ao | (i,j)=>ao, col: (i,j)=>[r,g,b] bytes, off: [x,y,z] added to positions, region}
 * returns the index grid.
 */
export function gridMesh(buf, G, opt = {}) {
  const ni = G.length, nj = G[0].length; const P = (i, j) => G[Math.max(0, Math.min(ni - 1, i))][((j % nj) + nj) % nj]; const at = (i, j) => { if (opt.wrapI) i = ((i % ni) + ni) % ni; else i = Math.max(0, Math.min(ni - 1, i)); if (!opt.wrapJ) j = Math.max(0, Math.min(nj - 1, j)); else j = ((j % nj) + nj) % nj; const p = G[i][j]; return p.x !== undefined ? p : { x: p[0], y: p[1], z: p[2] }; };
  const off = opt.off || [0, 0, 0]; const idx = new Array(ni);
  for (let i = 0; i < ni; i++) { idx[i] = new Array(nj); for (let j = 0; j < nj; j++) {
    const a = at(i, j - 1), b = at(i, j + 1), c = at(i - 1, j), d = at(i + 1, j);
    let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z, ux = d.x - c.x, uy = d.y - c.y, uz = d.z - c.z; // du = along j, dv = along i
    let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux; let l = Math.hypot(nx, ny, nz); if (l < 1e-12 && opt.poles) { const pn = opt.poles[i === 0 ? 0 : 1]; nx = pn[0]; ny = pn[1]; nz = pn[2]; l = 1; } else if (l < 1e-12) { l = 1; ny = 1; } const s = (opt.flip && !(opt.poles && Math.hypot(nx, ny, nz) === 1 && l === 1)) ? -1 / l : 1 / l; nx *= s; ny *= s; nz *= s;
    const p = at(i, j); const w = typeof opt.w === 'function' ? opt.w(i, j, p) : opt.w; const sp = typeof opt.spec === 'function' ? opt.spec(i, j) : opt.spec; const ao = typeof opt.ao === 'function' ? opt.ao(i, j) : (opt.ao ?? 1); const col = opt.col ? opt.col(i, j) : null;
    idx[i][j] = buf.vert([p.x + off[0], p.y + off[1], p.z + off[2]], [nx, ny, nz], w, sp, ao, opt.region ?? -1, col);
  } }
  const ii = opt.wrapI ? ni : ni - 1, jj = opt.wrapJ ? nj : nj - 1;
  for (let i = 0; i < ii; i++) for (let j = 0; j < jj; j++) { const a = idx[i][j], b = idx[i][(j + 1) % nj], c = idx[(i + 1) % ni][(j + 1) % nj], d = idx[(i + 1) % ni][j]; if (opt.flip) buf.quad(a, d, c, b); else buf.quad(a, b, c, d); }
  return idx;
}

// ---------------------------------------------------------------- teeth
// [name, width (mesio-distal), depth (labio-lingual), crown height, kind] in metres, upper / lower arch
const UP = [['i', 0.0086, 0.0072, 0.0105], ['i', 0.0066, 0.0062, 0.0092], ['c', 0.0076, 0.0082, 0.0102], ['p', 0.0068, 0.0092, 0.0086], ['p', 0.0066, 0.0092, 0.0080], ['m', 0.0100, 0.0106, 0.0074], ['m', 0.0095, 0.0102, 0.0070], ['m', 0.0088, 0.0096, 0.0064]];
const LO = [['i', 0.0055, 0.0060, 0.0090], ['i', 0.0062, 0.0064, 0.0092], ['c', 0.0068, 0.0076, 0.0098], ['p', 0.0068, 0.0084, 0.0084], ['p', 0.0068, 0.0090, 0.0082], ['m', 0.0108, 0.0102, 0.0074], ['m', 0.0102, 0.0098, 0.0070], ['m', 0.0096, 0.0094, 0.0064]];
function archCurve(a, b, z0, n = 240) { // half arch (x ≥ 0): x = a sin s, z = z0 + b (1 − cos s); returns cumulative-length sampler
  const pts = [], cum = [0]; for (let i = 0; i <= n; i++) { const s = (i / n) * 1.5; pts.push([a * Math.sin(s), z0 + b * (1 - Math.cos(s)), s]); if (i) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
  return (len) => { let k = 1; while (k < n && cum[k] < len) k++; const t = (len - cum[k - 1]) / Math.max(1e-9, cum[k] - cum[k - 1]); const p0 = pts[k - 1], p1 = pts[k]; return { x: p0[0] + (p1[0] - p0[0]) * t, z: p0[1] + (p1[1] - p0[1]) * t, s: p0[2] + (p1[2] - p0[2]) * t }; };
}
const ENAMEL = [0xdcd0ae, 0xcfc39c, 0xc0b283, 0xa89568], STAIN = 0x8a7648, CARIES = 0x2c2116;
const hexBytes = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** one tooth: crown lofted from superellipse rings (root stub → neck → contact bulge → occlusal), cusp-shaped occlusal cap */
function tooth(buf, T) {
  const { kind, W, D, H, origin, ax, up, fw, bone, spec, rng, broken, lod, tint, decay } = T; // frame: ax = mesio-distal, up = toward the bite plane, fw = labial
  const nseg = lod === 0 ? 10 : 6; const rings = lod === 0 ? [[-0.0025, 0.74, 0.8], [0.0, 0.84, 0.86], [0.22, 0.97, 0.98], [0.55, 1.0, 1.0], [0.82, 0.93, 0.92], [1.0, 0.8, 0.78]] : [[0.0, 0.84, 0.86], [0.55, 1.0, 1.0], [1.0, 0.8, 0.78]];
  const expo = kind === 'i' ? 3.4 : 2.5; const brokenH = broken ? 0.4 + rng() * 0.3 : 1;
  const cusps = kind === 'm' ? [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] : kind === 'p' ? [[0, -0.22], [0, 0.22]] : kind === 'c' ? [[0, 0]] : [];
  const P = new V(), C0 = hexBytes(ENAMEL[Math.min(3, Math.floor(tint * 4))]), ST = hexBytes(STAIN), CA = hexBytes(CARIES);
  const rows = [];
  for (let r = 0; r < rings.length; r++) {
    const [tt, sc, sd] = rings[r]; const yy = tt < 0 ? tt : tt * H * brokenH; const row = [];
    for (let k = 0; k < nseg; k++) {
      const a = (k / nseg) * TAU, ca = Math.cos(a), sa = Math.sin(a); const ex = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / expo), ez = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / expo);
      let x = ex * W * 0.5 * sc, z = ez * D * 0.5 * sd; let y = yy;
      // occlusal shaping on the last ring: incisor edges are thin blades; canines pointed; broken teeth ragged
      if (tt >= 1) { if (kind === 'i') { z *= 0.55; y -= Math.max(0, -z) * 0.25; } else if (kind === 'c') { x *= 0.55; z *= 0.6; } if (broken) y -= rng() * 0.0025 * (0.4 + Math.abs(ex)); }
      // labial face bulges a little (crown convexity), lingual side has the cingulum
      z += (z > 0 ? 0.0004 : 0) * (1 - Math.abs(tt - 0.5));
      P.copy(origin).addScaledVector(ax, x).addScaledVector(up, y).addScaledVector(fw, z);
      // colour: cervical stain → enamel → worn / translucent edge; decay darkens random patches
      let c = tt < 0.3 ? mixC(ST, C0, tt / 0.3) : tt > 0.9 ? mixC(C0, [C0[0] * 0.96, C0[1] * 0.97, C0[2] * 1.0], 0.5) : C0; if (decay > 0 && (rng() < decay * 0.25)) c = mixC(c, CA, 0.55 + rng() * 0.4);
      row.push({ x: P.x, y: P.y, z: P.z, c });
    }
    rows.push(row);
  }
  // occlusal cap: two shrinking rings + centre with cusp heights
  const top = rows[rows.length - 1]; const cx = top.reduce((s, p) => s + p.x, 0) / nseg, cy = top.reduce((s, p) => s + p.y, 0) / nseg, cz = top.reduce((s, p) => s + p.z, 0) / nseg;
  const cap = [top]; const cuspH = (u, v) => { let h = 0; for (const [cu, cv] of cusps) { const du = u / W - cu, dv = v / D - cv; h += Math.exp(-(du * du + dv * dv) / 0.05); } return kind === 'm' ? (h - 0.35) * 0.0016 : kind === 'p' ? (h - 0.3) * 0.0022 : kind === 'c' ? h * 0.0032 : 0; };
  for (const k2 of [0.6, 0.0]) {
    const row = []; for (let k = 0; k < nseg; k++) { const p = top[k]; const x = cx + (p.x - cx) * k2, y = cy + (p.y - cy) * k2, z = cz + (p.z - cz) * k2; const lu = (x - origin.x) * ax.x + (y - origin.y) * ax.y + (z - origin.z) * ax.z, lv = (x - origin.x) * fw.x + (y - origin.y) * fw.y + (z - origin.z) * fw.z; const h = brokenH < 1 ? -rng() * 0.0012 : cuspH(lu, lv) * (1 - k2 * 0.3); row.push({ x: x + up.x * h, y: y + up.y * h, z: z + up.z * h, c: top[k].c }); }
    cap.push(row);
  }
  const allRows = rows.concat(cap.slice(1)); const w = [[BI[bone], 1]];
  // outward-facing winding depends on the arch side; gridMesh normals are recomputed and consistent, winding fixed by `flip` from the caller
  const flip = T.flip;
  const idx = gridMesh(buf, allRows, { wrapJ: true, flip, w, spec, ao: (i) => (i <= 1 ? 0.55 : 0.85), col: (i, j) => allRows[i][j].c });
  // close the centre of the cap (last row collapses to a point ring: fan the final row)
  const last = allRows.length - 1; void idx; void last;
}
/** gum strip along an arch: labial side + fornix + lingual side */
function gumBand(buf, curve, len, sign, arch, bone, spec, lod, C) {
  const n = lod === 0 ? 30 : 12; const G = [];
  const prof = [[-0.0035, 0.0002], [0.0, 0.0012], [0.0032, 0.0016], [0.0065, 0.0004], [0.0075, -0.004], [0.006, -arch.D - 0.0008], [0.0, -arch.D - 0.0004], [-0.0035, -arch.D]]; // [height toward the gum (+ away from the bite plane), labial offset] cross-section
  for (let i = 0; i <= n; i++) {
    const s = -1 + (2 * i) / n; const L = Math.abs(s) * len; const p = curve(L); const sx = s < 0 ? -1 : 1; const q = curve(Math.min(len, L + 0.0004)); const q0 = curve(Math.max(0, L - 0.0004)); let tx = (q.x - q0.x) * sx, tz = q.z - q0.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl; // tangent along the arch
    const nxL = tz, nzL = -tx; // labial (outward from the arch centre): the arch curves toward +z with x, outward is the −x·… → pick the side that faces away from the arch centre
    const cxw = p.x * sx, czw = p.z; const outX = -(-nxL) , outZ = nzL; void outX; void outZ;
    const nrm = new V(nxL, 0, nzL); const toC = new V(-cxw, 0, arch.zc - czw); if (nrm.dot(toC) > 0) nrm.negate(); // labial normal points away from the arch centre
    const row = prof.map(([h, off]) => { const o = -off; return new V(cxw + nrm.x * (arch.D * 0.5 + o), arch.y + sign * (h + 0), czw + nrm.z * (arch.D * 0.5 + o)); });
    G.push(row);
  }
  return gridMesh(buf, G, { w: [[BI[bone], 1]], spec, ao: 0.6, flip: sign > 0, off: [C.x, C.y, C.z] });
}

export function buildMouth(buf, ctx) {
  const { pos, nT, mRow, thetas, inMouth, fp, lod, C, headWeights } = ctx;
  const mouthSpec = matSpec({ mat: 'mouth', color: 0x34121a, rough: 0.4, ao: 0.6 }), gumSpec = matSpec({ mat: 'mouth', color: 0x6a3838 - 0x080808 * Math.round(fp.age * 3), rough: 0.45, dirt: 0.3 });
  const tongueSpec = matSpec({ mat: 'mouth', color: 0x683838, rough: 0.4, dirt: 0.5, scale: 0.95 });
  const cols = []; for (let i = 0; i < nT; i++) if (inMouth(i)) cols.push(i);
  const first = (cols[0] - 1 + nT) % nT, last = (cols[cols.length - 1] + 1) % nT; const all = [first, ...cols, last];
  const up = [], lo = []; const hw = (p) => headWeights(p);
  const SU = [[0, 0, 0, 1], [0, 0.0022, 0.0045, 0.98], [0, 0.006, 0.0105, 1.0], [0, 0.0125, 0.026, 1.28], [0, 0.0165, 0.044, 1.36], [0, 0.0155, 0.062, 0.9], [0, 0.008, 0.078, 0.5]];
  all.forEach((i, k) => {
    const U = pos[(mRow + 1) * nT + i], L = pos[mRow * nT + i]; const edge = k === 0 || k === all.length - 1; const x = (U.x + L.x) * 0.5; const dk = Math.max(0.15, 1 - Math.pow(Math.abs(x) / 0.0265, 2) * 0.62);
    const US = SU.map(([, dy, dz, sx], s) => (s === 0 ? U : new V(s === 1 ? U.x * sx : x * sx, U.y + dy * dk, U.z + dz * dk)));
    const LS = SU.map(([, dy, dz, sx], s) => (s === 0 ? L : new V(s === 1 ? L.x * sx : x * sx, L.y - dy * dk * 1.05, L.z + dz * dk)));
    if (edge) for (let s = 1; s < SU.length; s++) { const m = new V().addVectors(US[s], LS[s]).multiplyScalar(0.5); US[s] = m; LS[s] = m.clone(); }
    up.push(US.map((p, s) => { const wt = s === 0 ? hw(p) : { head: 1, jaw: 0, neck: 0 }; return buf.vert([p.x + C.x, p.y + C.y, p.z + C.z], [0, -1, 0.2], [[BI.head, wt.head], [BI.jaw, wt.jaw], [BI.neck, wt.neck]], mouthSpec, Math.max(0.12, 0.6 - s * 0.1)); }));
    lo.push(LS.map((p, s) => { const wt = s === 0 ? hw(p) : s >= SU.length - 1 ? { head: 0.5, jaw: 0.5, neck: 0 } : { head: 0, jaw: 1, neck: 0 }; return buf.vert([p.x + C.x, p.y + C.y, p.z + C.z], [0, 1, 0.2], [[BI.head, wt.head], [BI.jaw, wt.jaw], [BI.neck, wt.neck]], mouthSpec, Math.max(0.12, 0.6 - s * 0.1)); }));
  });
  const ns = SU.length - 1;
  for (let k = 0; k < all.length - 1; k++) for (let s = 0; s < ns; s++) { buf.quad(up[k][s], up[k][s + 1], up[k + 1][s + 1], up[k + 1][s]); buf.quad(lo[k][s], lo[k + 1][s], lo[k + 1][s + 1], lo[k][s + 1]); }
  for (let k = 0; k < all.length - 1; k++) buf.quad(up[k][ns], lo[k][ns], lo[k + 1][ns], up[k + 1][ns]);
  // ---- teeth
  const rng = mulberry(Math.floor(fp.teethMissing * 1000) + 7 + Math.floor(fp.age * 100));
  const my = MOUTH_Y; const specE = (t) => matSpec({ mat: 'teeth', color: ENAMEL[t], rough: 0.32, wear: 0.4 + fp.age * 0.4, dirt: 0.3 + fp.age * 0.4 });
  const spec = specE(1);
  for (const upper of [true, false]) {
    const TB = upper ? UP : LO; const bone = upper ? 'head' : 'jaw'; const a = upper ? 0.0312 : 0.0292, b = upper ? 0.043 : 0.040, z0 = upper ? -0.0885 : -0.0868;
    const curve = archCurve(a, b, z0); const sign = upper ? 1 : -1; const total = TB.reduce((s, t) => s + t[1], 0) * 1.0;
    // gum bands
    const arch = { D: 0.0075, y: my + sign * 0.0088, zc: z0 + b * 0.5 };
    if (lod <= 1) gumBand(buf, (L) => { const p = curve(L); return { x: p.x, z: p.z }; }, total, sign, arch, upper ? 'head' : 'jaw', gumSpec, lod, C);
    for (const side of [-1, 1]) {
      let cum = 0;
      TB.forEach(([kind, W, D, H], ti) => {
        const c0 = cum + W * 0.5; cum += W * 1.0; if (lod >= 1 && ti >= 5) return; const p = curve(c0); const nxt = curve(c0 + 0.0008), prv = curve(Math.max(0, c0 - 0.0008));
        // missing / broken / crowded
        const miss = fp.teethMissing * (kind === 'i' ? 1.3 : kind === 'm' ? 1.0 : 0.7); if (rng() < miss * 0.55 && (upper ? true : true)) return;
        const broken = rng() < fp.teethMissing * 0.7 + fp.age * 0.12; const jit = (rng() - 0.5) * 0.3 * (0.4 + fp.teethMissing), tilt = (rng() - 0.5) * 0.2;
        const tx = (nxt.x - prv.x) * side, tz = nxt.z - prv.z; const tl = Math.hypot(tx, tz) || 1; const ax = new V(tx / tl, 0, tz / tl);
        const cxw = p.x * side; const fw = new V(ax.z, 0, -ax.x); const toC = new V(-cxw, 0, arch.zc - p.z); if (fw.dot(toC) > 0) fw.negate(); // labial faces away from the arch centre
        ax.applyAxisAngle(new V(0, 1, 0), jit); fw.applyAxisAngle(new V(0, 1, 0), jit);
        const upv = new V(0, -sign, 0).addScaledVector(fw, tilt).normalize(); const H2 = H * fp.teethLen * (0.9 + rng() * 0.2) * (kind === 'i' && upper ? 1 : 1);
        // teeth sit with their gum line 0.5 mm below the lip level: crown tips meet at the bite plane
        const origin = new V(cxw, my + sign * (H2 + 0.0003), p.z - fw.z * 0.0 + 0); origin.x = cxw; origin.z = p.z; origin.y = my + sign * (H2 * (upper ? 1 : 0.94) + 0.0004);
        // crowns extend from the gum line toward the bite plane: rebuild the frame with `up` pointing to the bite plane
        const frame = { kind, W, D, H: H2, origin: origin.clone().add(new V(C.x, C.y, C.z)), ax, up: new V(0, -sign, 0).addScaledVector(fw, tilt * 0.6).normalize(), fw: fw.clone(), bone, spec: kind === 'i' || kind === 'c' ? specE(rng() < 0.6 ? 1 : 2) : specE(rng() < 0.5 ? 1 : 2), rng, broken, lod, tint: Math.min(1, rng() * 0.6 + fp.age * 0.5), decay: fp.age * 0.7 + fp.teethMissing, flip: upper !== (side > 0) };
        tooth(buf, frame);
      });
    }
  }
  // ---- tongue: lofted along z, jaw-bound, median groove, flat dorsum
  {
    const n = lod === 0 ? 14 : 7, m = lod === 0 ? 14 : 8; const G = []; const z0 = -0.0835, z1 = -0.036; const W = (u) => 0.0195 * Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * (1 - u))), 0.55) * (0.6 + 0.4 * u) + 0.002;
    for (let i = 0; i < n; i++) { const u = i / (n - 1); const z = z0 + (z1 - z0) * u; const w = W(u), h = 0.0058 + 0.0038 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ; const row = [];
      for (let j = 0; j < m; j++) { const a = (j / m) * TAU; const ca = Math.cos(a), sa = Math.sin(a); let y = sa * h * (sa > 0 ? 1 : 0.7); const x = ca * w; if (sa > 0.4) y -= Math.exp(-(x * x) / 4e-6) * 0.0008; row.push(new V(x + C.x, my - 0.0115 + y + 0.0005 * u + C.y + 0.001, z + C.z)); }
      G.push(row); }
    // cap the tip: converge the last row
    gridMesh(buf, G, { wrapJ: true, flip: false, w: [[BI.jaw, 1]], spec: tongueSpec, ao: 0.6 });
  }
}

// ---------------------------------------------------------------- build cache: geometry that only depends on (variant, face, LOD) is generated once and replayed into every look's GeoBuf
const CACHE = new Map();
export function cachedBuild(buf, key, fn) {
  const c = CACHE.get(key);
  if (c) { const n0 = buf.n; for (const k of ['P', 'N', 'SI', 'SW', 'COL', 'MAT', 'MAT2', 'AUX', 'REGV']) { const src = c.blob[k], dst = buf[k]; for (let i = 0; i < src.length; i++) dst.push(src[i]); } for (let i = 0; i < c.I.length; i++) buf.I.push(c.I[i] + n0); buf.n += c.count; ZT.hits = (ZT.hits || 0) + 1; return c.ret; }
  const n0 = buf.n, i0 = buf.I.length; const ret = fn(); const blob = {}; for (const k of ['P', 'N']) blob[k] = buf[k].slice(n0 * 3); for (const k of ['SI', 'SW', 'COL', 'MAT', 'MAT2', 'AUX']) blob[k] = buf[k].slice(n0 * 4); blob.REGV = buf.REGV.slice(n0);
  ZT.miss = (ZT.miss || 0) + 1; const I = buf.I.slice(i0).map((v) => v - n0); CACHE.set(key, { blob, I, count: buf.n - n0, ret }); return ret;
}
export function clearBuildCache() { CACHE.clear(); }
