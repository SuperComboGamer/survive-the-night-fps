// Wounds and stumps as GEOMETRY. applyWounds(): the variant's story wounds (variantDef.wounds / extraWounds / facial.cheekWound, decided
// per look with a seeded rng) are cut out of the emitted mesh (every layer near the spot: skin, shirt, jacket…): triangles inside the
// cylinder are dropped and a polar patch is laid over the hole — torn skin rim (raised, blood-dark), rolled skin edge, yellow fat, red
// striated muscle, tendon / bone / mouth floor — projected onto the original outer surface and sunk with a ragged profile. Open chest
// wounds get real rib arcs. buildCaps(): dismemberment stumps with a ragged skin edge, fat, muscle, protruding bone with marrow, and
// skin flaps, used by the existing severed-limb system (regions capShoulder…, gib…, capNeck). Painted decals (uWounds) remain for
// bullet hits and bandages. Wounds are baked into the geometry of each look, so the spawn code's random story wounds are switched off.
import * as THREE from 'three';
import { BI, RIG, restAt, restTail, restPos } from './rig.js';
import { matSpec, REG } from './mesh.js';
import { mulberry, zt } from './mouth.js';

const V = THREE.Vector3; const TAU = Math.PI * 2;
const SPOTS = { neck: [0.058, 1.53, 0.0], shoulder: [0.15, 1.44, -0.05], forearm: [0.47, 1.07, -0.1], chest: [0.07, 1.27, -0.125], belly: [0.05, 1.05, -0.115], thigh: [0.12, 0.7, -0.09], calf: [0.1, 0.33, -0.07], back: [0.08, 1.25, 0.12], cheek: [0.05, 1.575, -0.07], scalp: [0.03, 1.735, -0.03] };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const specRaw = (id, col, rough = 0.3, extra = {}) => ({ _packed: true, id, col, mat: [id, Math.round(rough * 255), 0, Math.round((extra.param ?? 0) * 255)], mat2: [Math.round((extra.wear ?? 0.3) * 255), Math.round((extra.dirt ?? 0.3) * 255), 0, Math.round((extra.scale ?? 0.5) * 255)], ao: 1, sway: 0, frost: 1 });

/** Moller-Trumbore ray / triangle (returns t or -1) */
function rayTri(o, d, a, b, c) { const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z, e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z; const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x; const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) return -1; const inv = 1 / det; const tx = o.x - a.x, ty = o.y - a.y, tz = o.z - a.z; const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-4 || u > 1.0001) return -1; const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x; const v = (d.x * qx + d.y * qy + d.z * qz) * inv; if (v < -1e-4 || u + v > 1.0001) return -1; return (e2x * qx + e2y * qy + e2z * qz) * inv; }

/**
 * Shared banded polar mesh: rings of M vertices around a centre, bands share positions but get their own vertices (one material per band).
 * rings: [{rho, pos(theta) → V, band}] ordered outside → in (ring 0 outermost); the last ring may be a single centre point (M = 1).
 */
function polarBands(buf, o, P, bands, weightsAt, regionOf, nrm0 = null) {
  // P[i][k] positions (V) for ring i, angular index k (M columns; ring with length 1 = centre); bands[i] describes ring i→i+1 quads: {spec, col(i,k)→[r,g,b]|null, ao(i,k)}
  const nR = P.length; const M = P[0].length; const N = P.map((row) => row.map(() => new V()));
  for (let i = 0; i < nR - 1; i++) { const A = P[i], B = P[i + 1]; const ma = A.length, mb = B.length;
    for (let k = 0; k < M; k++) { const k1 = (k + 1) % M; const a = A[k], b = A[k1], c = mb === 1 ? B[0] : B[k1], d = mb === 1 ? B[0] : B[k]; const n = new V().subVectors(b, a).cross(new V().subVectors(d, a)); if (n.lengthSq() < 1e-16) continue; n.normalize(); for (const [ri, ci, v] of [[i, k, 0], [i, k1, 0], [i + 1, mb === 1 ? 0 : k1, 0], [i + 1, mb === 1 ? 0 : k, 0]]) { N[ri][ci].add(n); void v; } } void ma; }
  for (const row of N) for (const n of row) if (n.lengthSq() > 0) n.normalize(); else n.set(0, 0, 1);
  if (nrm0) for (let k = 0; k < M; k++) { N[0][k].copy(nrm0[k]); if (P.length > 2) N[1][k].lerp(nrm0[k], 0.6).normalize(); }
  for (let i = 0; i < nR - 1; i++) {
    const bd = bands[i]; const A = P[i], B = P[i + 1]; const mb = B.length; const ia = [], ib = [];
    for (let k = 0; k < M; k++) ia.push(buf.vert(A[k], N[i][k], weightsAt(A[k]), bd.spec, bd.ao ? bd.ao(i, k) : 1, regionOf ? regionOf(A[k]) : -1, bd.col ? bd.col(i, k) : null));
    for (let k = 0; k < mb; k++) ib.push(buf.vert(B[k], N[i + 1][k], weightsAt(B[k]), bd.spec, bd.ao ? bd.ao(i + 1, k) : 1, regionOf ? regionOf(B[k]) : -1, bd.col ? bd.col(i + 1, k) : null));
    for (let k = 0; k < M; k++) { const k1 = (k + 1) % M; if (mb === 1) buf.tri(ia[k], ia[k1], ib[0]); else buf.quad(ia[k], ia[k1], ib[k1], ib[k]); }
  }
  void o;
}

// ---------------------------------------------------------------- wounds
function resolveWounds(o) {
  const def = o.variant || {}; if (!def._w0) { def._w0 = (def.wounds || []).map((w) => ({ ...w })); def._x0 = def.extraWounds; def._c0 = def.facial?.cheekWound; }
  const rr = mulberry(0x51ed ^ (def.id || 'x').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) ^ ((o._garmentSig || '').length * 7919));
  const list = []; const keys = ['neck', 'shoulder', 'forearm', 'chest', 'belly', 'thigh', 'calf', 'back'];
  const at = (spot, side) => { const p0 = Array.isArray(spot) ? spot : SPOTS[spot] || SPOTS.chest; const sx = side ?? (rr() < 0.5 ? -1 : 1); return [p0[0] * (Array.isArray(spot) ? 1 : sx), p0[1], p0[2]]; };
  for (const w of def._w0) { const roll = rr(); if (w.type === 'bandage') continue; if (roll < (w.chance ?? 0.85)) list.push({ type: w.type === 'ribs' ? 'open' : w.type, p: at(w.p || w.at, w.side), r: w.r ?? 0.05, at: w.at }); }
  const nx = Math.min(def._x0 ?? ((rr() < 0.6 ? 1 : 0) + (rr() < 0.3 ? 1 : 0)), Math.max(0, 2 - list.length)); for (let k = 0; k < nx; k++) { const t = rr(); list.push({ type: t < 0.45 ? 'bite' : t < 0.8 ? 'gash' : 'open', p: at(keys[(rr() * keys.length) | 0]), r: t < 0.45 ? 0.04 : t < 0.8 ? 0.03 + rr() * 0.02 : 0.05 }); }
  if ((def._c0 ?? 0.12) > 0 && rr() < (def._c0 ?? 0.12)) list.push({ type: 'cheek', p: at('cheek'), r: 0.02 });
  // story wounds live in the geometry now: switch the spawn-time painted ones off (bandages stay painted)
  def.wounds = (def._w0 || []).filter((w) => w.type === 'bandage'); def.extraWounds = 0; if (def.facial) def.facial = { ...def.facial, cheekWound: 0 }; else def.facial = { cheekWound: 0 };
  return { list, rr };
}
export function applyWounds(...a) { const t0 = performance.now(); try { return applyWounds0(...a); } finally { zt('wounds', t0); } }
function applyWounds0(o) {
  let { list, rr } = resolveWounds(o); if (globalThis.__ZWOUNDS) list = globalThis.__ZWOUNDS.map((w) => ({ type: w.type, p: [...(Array.isArray(w.at) ? w.at : SPOTS[w.at]).slice(0, 3)].map((x, i) => (i === 0 ? x * (w.side ?? 1) : x)), r: w.r ?? 0.05 }));
  if (!list.length || o.lod >= 2) return; const buf = o.buf; const lod = o.lod;
  const P = Float64Array.from(buf.P), I = Int32Array.from(buf.I); const nTri = I.length / 3; const nI0 = I.length;
  // spatial hash of triangle centroids (5 cm cells): every wound only touches the triangles around it
  const CELL = 0.05, inv = 1 / CELL; const grid = new Map(); const kk = (i, j, k) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  for (let t = 0; t < nTri; t++) { const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; const key = kk(Math.floor((P[a] + P[b] + P[c]) / 3 * inv), Math.floor((P[a + 1] + P[b + 1] + P[c + 1]) / 3 * inv), Math.floor((P[a + 2] + P[b + 2] + P[c + 2]) / 3 * inv)); let arr = grid.get(key); if (!arr) grid.set(key, (arr = [])); arr.push(t); }
  const removedFlag = new Uint8Array(nTri); let anyRemoved = false;
  const query = (cx, cy, cz, r) => { const out = []; const r2 = r * r; const i0 = Math.floor((cx - r) * inv), i1 = Math.floor((cx + r) * inv), j0 = Math.floor((cy - r) * inv), j1 = Math.floor((cy + r) * inv), k0 = Math.floor((cz - r) * inv), k1 = Math.floor((cz + r) * inv);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) { const arr = grid.get(kk(i, j, k)); if (!arr) continue; for (const t of arr) { if (removedFlag[t]) continue; const a = I[t * 3] * 3; const dx = P[a] - cx, dy = P[a + 1] - cy, dz = P[a + 2] - cz; if (dx * dx + dy * dy + dz * dz < r2) out.push(t); } } return out; };
  for (const wd of list) {
    let _l = performance.now(); const lap = (k) => { const n2 = performance.now(); zt('w.' + k + lod, _l); _l = n2; };
    const c0 = new V(...wd.p);
    const axis = new V(0, c0.y + (Math.abs(c0.x) > 0.3 ? 0.1 : 0), Math.abs(c0.x) > 0.3 ? c0.z : (wd.type === 'cheek' ? 0.004 : 0.02)); if (Math.abs(c0.x) > 0.3) axis.x = c0.x * 0.7;
    const out0 = new V().subVectors(c0, axis); if (wd.type !== 'cheek' && wd.type !== 'neck') out0.y = 0; out0.normalize();
    let near = query(c0.x, c0.y, c0.z, 0.105); let nn = near.length; if (!nn) continue;
    let TV = new Float64Array(nn * 9); for (let q = 0; q < nn; q++) for (let k = 0; k < 3; k++) { const vi = I[near[q] * 3 + k] * 3; TV[q * 9 + k * 3] = P[vi]; TV[q * 9 + k * 3 + 1] = P[vi + 1]; TV[q * 9 + k * 3 + 2] = P[vi + 2]; }
    let hitTri = -1, hitU = 0, hitV = 0; const ray = (ox, oy, oz, dx, dy, dz) => { let best = 1e9; hitTri = -1; for (let q = 0; q < nn; q++) { const b0 = q * 9; const e1x = TV[b0 + 3] - TV[b0], e1y = TV[b0 + 4] - TV[b0 + 1], e1z = TV[b0 + 5] - TV[b0 + 2], e2x = TV[b0 + 6] - TV[b0], e2y = TV[b0 + 7] - TV[b0 + 1], e2z = TV[b0 + 8] - TV[b0 + 2]; const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x; const det = e1x * px + e1y * py + e1z * pz; if (det > -1e-13 && det < 1e-13) continue; const inv2 = 1 / det; const tx = ox - TV[b0], ty = oy - TV[b0 + 1], tz = oz - TV[b0 + 2]; const u = (tx * px + ty * py + tz * pz) * inv2; if (u < -1e-4 || u > 1.0001) continue; const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x; const v = (dx * qx + dy * qy + dz * qz) * inv2; if (v < -1e-4 || u + v > 1.0001) continue; const th = (e2x * qx + e2y * qy + e2z * qz) * inv2; if (th > 0 && th < best) { best = th; hitTri = q; hitU = u; hitV = v; } } return hitTri < 0 ? -1 : best; };
    const ox = c0.x + out0.x * 0.16, oy = c0.y + out0.y * 0.16, oz = c0.z + out0.z * 0.16;
    const th0 = ray(ox, oy, oz, -out0.x, -out0.y, -out0.z); if (th0 < 0) continue; const bestQ = hitTri;
    const surf = new V(ox - out0.x * th0, oy - out0.y * th0, oz - out0.z * th0); const b0 = bestQ * 9;
    const n = new V(TV[b0 + 3] - TV[b0], TV[b0 + 4] - TV[b0 + 1], TV[b0 + 5] - TV[b0 + 2]).cross(new V(TV[b0 + 6] - TV[b0], TV[b0 + 7] - TV[b0 + 1], TV[b0 + 8] - TV[b0 + 2])).normalize(); if (n.dot(out0) < 0) n.negate(); n.lerp(out0, 0.35).normalize();
    const up = Math.abs(n.y) > 0.85 ? new V(0, 0, -1) : new V(0, 1, 0); const e1 = new V().crossVectors(up, n).normalize(), e2 = new V().crossVectors(n, e1).normalize();
    const ang = wd.type === 'gash' ? (rr() - 0.5) * 1.6 + Math.PI / 2 : wd.type === 'open' ? (rr() - 0.5) * 0.3 : rr() * TAU; const ca = Math.cos(ang), sa = Math.sin(ang); const u = e1.clone().multiplyScalar(ca).addScaledVector(e2, sa), v = e1.clone().multiplyScalar(-sa).addScaledVector(e2, ca);
    const T = { bite: { R: 1.0, asp: 1.0, D: 0.011 + wd.r * 0.35, rag: 0.24 }, gash: { R: 1.7, asp: 0.34, D: 0.009 + wd.r * 0.15, rag: 0.16 }, open: { R: 1.35, asp: 1.05, D: 0.045, rag: 0.2 }, bullet: { R: 0.32, asp: 1, D: 0.02, rag: 0.15 }, cheek: { R: 1.0, asp: 1.15, D: 0.017, rag: 0.2 } }[wd.type] || { R: 1, asp: 1, D: 0.012, rag: 0.2 };
    const Rh = wd.r * T.R * (0.9 + rr() * 0.2); const Ru = Rh, Rv = Rh * T.asp; const Rout = Math.max(Ru, Rv) * 1.62 + 0.012; const phases = [rr() * 6.3, rr() * 6.3, rr() * 6.3, rr() * 6.3];
    // outer shell around the hole only (the ray tests below need the outermost layers)
    { const keepQ = []; for (let q = 0; q < nn; q++) { const b = q * 9; const cx = (TV[b] + TV[b + 3] + TV[b + 6]) / 3 - surf.x, cy = (TV[b + 1] + TV[b + 4] + TV[b + 7]) / 3 - surf.y, cz = (TV[b + 2] + TV[b + 5] + TV[b + 8]) / 3 - surf.z; const h = cx * n.x + cy * n.y + cz * n.z; if (h > -0.03 && h < 0.03 && cx * cx + cy * cy + cz * cz < (Rout * 1.3) ** 2) keepQ.push(q); }
      if (keepQ.length > 0 && keepQ.length < nn) { const TV2 = new Float64Array(keepQ.length * 9); const near2 = []; keepQ.forEach((q, i) => { TV2.set(TV.subarray(q * 9, q * 9 + 9), i * 9); near2.push(near[q]); }); TV = TV2; near = near2; nn = near.length; } }
    lap('near');
    // 1. remove every triangle whose centroid falls inside the cut cylinder (all layers), outer shell only, facing the wound
    const lim = (1.12 + T.rag * 0.4) ** 2; let removed = 0; const cand = query(surf.x, surf.y, surf.z, Rout * 1.25);
    for (const t of cand) { const ia = I[t * 3] * 3, ib = I[t * 3 + 1] * 3, ic = I[t * 3 + 2] * 3; const cx = (P[ia] + P[ib] + P[ic]) / 3 - surf.x, cy = (P[ia + 1] + P[ib + 1] + P[ic + 1]) / 3 - surf.y, cz = (P[ia + 2] + P[ib + 2] + P[ic + 2]) / 3 - surf.z;
      const a = (cx * u.x + cy * u.y + cz * u.z) / Ru, b = (cx * v.x + cy * v.y + cz * v.z) / Rv, h = cx * n.x + cy * n.y + cz * n.z; if (a * a + b * b < lim && h > -0.05 && h < 0.03) { const e1x = P[ib] - P[ia], e1y = P[ib + 1] - P[ia + 1], e1z = P[ib + 2] - P[ia + 2], e2x = P[ic] - P[ia], e2y = P[ic + 1] - P[ia + 1], e2z = P[ic + 2] - P[ia + 2]; const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x; if (fx * n.x + fy * n.y + fz * n.z > -1e-12) { removedFlag[t] = 1; removed++; anyRemoved = true; } } }
    lap('remove'); if (!removed) continue;
    // 2. patch rings (outside → in)
    const M = lod === 0 ? 34 : 16; const rings = lod === 0 ? [1.5, 1.3, 1.14, 1.04, 0.98, 0.9, 0.74, 0.52, 0.3, 0.1, 0] : [1.5, 1.2, 1.02, 0.94, 0.7, 0.4, 0.12, 0];
    const ragged = (th, k) => 1 + T.rag * (0.5 * Math.sin(th * 3 + phases[0]) + 0.35 * Math.sin(th * 5 + phases[1]) + 0.25 * Math.sin(th * 9 + phases[2])) * smooth(0.5, 1.0, k);
    const nv = []; { const seen = new Set(); for (let q = 0; q < nn * 3; q++) { const vi = I[near[(q / 3) | 0] * 3 + (q % 3)]; if (!seen.has(vi)) { seen.add(vi); nv.push(vi); } } }
    const nearestVert = (px, py, pz) => { let bv = nv[0], bd = 1e9; for (let q = 0; q < nv.length; q++) { const vi = nv[q]; const dx = P[vi * 3] - px, dy = P[vi * 3 + 1] - py, dz = P[vi * 3 + 2] - pz; const dd = dx * dx + dy * dy + dz * dz; if (dd < bd) { bd = dd; bv = vi; } } return bv; };
    const wOf = (vi) => { const w = []; for (let k = 0; k < 4; k++) if (buf.SW[vi * 4 + k] > 0) w.push([buf.SI[vi * 4 + k], buf.SW[vi * 4 + k] / 255]); return w; };
    const centreV = nearestVert(surf.x, surf.y, surf.z); const outerSpec = { _packed: true, id: buf.MAT[centreV * 4], col: [buf.COL[centreV * 4], buf.COL[centreV * 4 + 1], buf.COL[centreV * 4 + 2]], mat: [buf.MAT[centreV * 4], buf.MAT[centreV * 4 + 1], buf.MAT[centreV * 4 + 2], buf.MAT[centreV * 4 + 3]], mat2: [buf.MAT2[centreV * 4], buf.MAT2[centreV * 4 + 1], buf.MAT2[centreV * 4 + 2], buf.MAT2[centreV * 4 + 3]], ao: 1, sway: 0, frost: 1 };
    const vCache = new Map(); const vAt = (p) => { const key = Math.round(p.x / 0.008) * 73856093 ^ Math.round(p.y / 0.008) * 19349663 ^ Math.round(p.z / 0.008) * 83492791; let vi = vCache.get(key); if (vi === undefined) { vi = nearestVert(p.x, p.y, p.z); vCache.set(key, vi); } return vi; };
    const wCache = new Map(); const weightsAt = (p) => { const vi = vAt(p); let w = wCache.get(vi); if (!w) { w = wOf(vi); wCache.set(vi, w); } return w; };
    const regionOf = (p) => buf.REGV[vAt(p)];
    const heightExact = (a, b) => { const px = surf.x + u.x * a + v.x * b + n.x * 0.12, py = surf.y + u.y * a + v.y * b + n.y * 0.12, pz = surf.z + u.z * a + v.z * b + n.z * 0.12; const th = ray(px, py, pz, -n.x, -n.y, -n.z); return th < 0 ? Number.NaN : 0.12 - th; };
    // inner rings use a quadratic fit of the outer surface (25 exact rays instead of one per vertex); the outer rings stay exact so the rim always meets the real surface
    let fit = null; { const S = [], Hs = []; const ext = Math.max(Ru, Rv) * 1.5; for (let ia = -2; ia <= 2; ia++) for (let ib = -2; ib <= 2; ib++) { const a = ia * ext / 2, b = ib * ext / 2; const h = heightExact(a, b); if (!Number.isNaN(h)) { S.push([1, a, b, a * a, a * b, b * b]); Hs.push(h); } }
      if (S.length >= 8) { const A = Array.from({ length: 6 }, () => new Float64Array(6)), Bv = new Float64Array(6); for (let r = 0; r < S.length; r++) for (let i = 0; i < 6; i++) { Bv[i] += S[r][i] * Hs[r]; for (let j = 0; j < 6; j++) A[i][j] += S[r][i] * S[r][j]; } for (let i = 0; i < 6; i++) A[i][i] += 1e-9;
        for (let i = 0; i < 6; i++) { let piv = i; for (let r = i + 1; r < 6; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r; [A[i], A[piv]] = [A[piv], A[i]]; [Bv[i], Bv[piv]] = [Bv[piv], Bv[i]]; for (let r = i + 1; r < 6; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < 6; c++) A[r][c] -= f * A[i][c]; Bv[r] -= f * Bv[i]; } }
        const x = new Float64Array(6); for (let i = 5; i >= 0; i--) { let sum = Bv[i]; for (let j = i + 1; j < 6; j++) sum -= A[i][j] * x[j]; x[i] = sum / A[i][i]; } fit = x; } }
    const heightAt = (a, b, exact) => { if (exact || !fit) { const h = heightExact(a, b); return Number.isNaN(h) ? 0 : h; } return fit[0] + fit[1] * a + fit[2] * b + fit[3] * a * a + fit[4] * a * b + fit[5] * b * b; };
    const skinDark = hex(0x3a1414), fatC = hex(0xa89058), muscC = hex(0x4a0d10), floorC = hex(0x1c0508), boneC = hex(0xc9bb98), mouthC = hex(0x2a0a0e);
    const sRim = specRaw(0, skinDark, 0.35, { dirt: 0.6, wear: 0.5 }), sFat = specRaw(9, fatC, 0.3), sMus = specRaw(9, muscC, 0.22), sFloor = specRaw(9, wd.type === 'cheek' ? mouthC : floorC, 0.2), sBone = specRaw(10, boneC, 0.55);
    const depthAt = (rho, th) => { const r = rho / ragged(th, rho); if (r >= 1.0) return 0; const wall = smooth(1.0, 0.86, r); const floor = T.D * (0.5 + 0.5 * smooth(0.86, 0.1, r)); return wall * floor * (1 + 0.16 * Math.sin(th * 7 + r * 9 + phases[3])); };
    const Prg = []; const bandsSpec = []; const cO = outerSpec.col; const nrm0 = []; const aoO = buf.AUX[centreV * 4] / 255; const ringCol = [], ringAO = [], ringN = [];
    for (let i = 0; i < rings.length; i++) {
      const rho = rings[i]; const row = []; const cnt = rho === 0 ? 1 : M;
      for (let k = 0; k < cnt; k++) { const th = (k / M) * TAU; const rg = rho < 1.0 ? ragged(th, rho) : 1; const rr2 = rho * rg; const a = Math.cos(th) * Ru * rr2, b = Math.sin(th) * Rv * rr2; const h0 = heightAt(a, b, i <= 1);
        const dp = rho === 0 ? T.D : depthAt(rho, th); const lift = rho >= 1.0 && rho < 1.16 ? 0.0009 * smooth(1.16, 1.0, rho) : 0;
        const pp = surf.clone().addScaledVector(u, a).addScaledVector(v, b).addScaledVector(n, h0 - dp + lift); row.push(pp);
        if (rho > 1.0) { let vi0 = vAt(pp), vi1 = vi0, vi2 = vi0, w0 = 1, w1 = 0, w2 = 0; if (i <= 3 && hitTri >= 0) { const t3 = near[hitTri] * 3; vi0 = I[t3]; vi1 = I[t3 + 1]; vi2 = I[t3 + 2]; w1 = hitU; w2 = hitV; w0 = 1 - hitU - hitV; }
          const mixv = (arr, s, k2) => arr[vi0 * s + k2] * w0 + arr[vi1 * s + k2] * w1 + arr[vi2 * s + k2] * w2;
          (ringCol[i] ||= [])[k] = [mixv(buf.COL, 4, 0), mixv(buf.COL, 4, 1), mixv(buf.COL, 4, 2)]; (ringAO[i] ||= [])[k] = mixv(buf.AUX, 4, 0) / 255; if (i === 0) nrm0[k] = new V(mixv(buf.N, 3, 0), mixv(buf.N, 3, 1), mixv(buf.N, 3, 2)).normalize(); } }
      Prg.push(row);
      if (i < rings.length - 1) { const r0 = rings[i], r1 = rings[i + 1]; let sp = outerSpec; let colFn = null;
        if (r0 <= 1.0 && r1 >= 0.9) sp = sRim; else if (r1 >= 0.82 && r0 <= 0.94) sp = sFat; else if (r0 <= 0.86 && r1 >= 0.28) sp = sMus; else if (r0 <= 0.3) sp = sFloor;
        if (r0 > 1.0 && r1 > 1.0) { colFn = (ii, kk3) => { const t = smooth(1.3, 1.0, rings[ii]) * 0.8; const c = ringCol[ii][kk3] || cO; return [c[0] + (skinDark[0] - c[0]) * t, c[1] + (skinDark[1] - c[1]) * t, c[2] + (skinDark[2] - c[2]) * t]; }; }
        else if (r0 > 1.0 && r1 <= 1.0) sp = sRim;
        bandsSpec.push({ spec: sp, col: colFn || (sp === sFat ? (ii, kk2) => [fatC[0] * (0.85 + 0.3 * Math.sin(kk2 * 1.7 + ii)), fatC[1] * (0.85 + 0.3 * Math.sin(kk2 * 1.7 + ii)), fatC[2]] : null), ao: (ii, kk4) => (rings[ii] > 1.0 ? (ringAO[ii] && ringAO[ii][kk4] !== undefined ? ringAO[ii][kk4] : aoO) * (0.8 + 0.2 * smooth(1.0, 1.5, rings[ii])) : Math.max(0.12, 0.14 + 0.72 * smooth(0.0, 1.0, rings[ii]))) }); }
    }
    lap('rings'); polarBands(buf, o, Prg, bandsSpec, weightsAt, regionOf, nrm0); lap('emit');
    if (wd.type === 'open' && lod === 0) { // exposed ribs across the cavity
      const nr = 5; const cut = surf.clone().addScaledVector(n, -T.D * 0.58);
      for (let rI = 0; rI < nr; rI++) {
        const off = (rI - (nr - 1) / 2) * 0.027 + (rr() - 0.5) * 0.006; const tilt = (rr() - 0.5) * 0.25; const pts = []; const seg = 9; for (let s2 = 0; s2 <= seg; s2++) { const t = (s2 / seg) * 2 - 1; const a = t * Rh * 1.05, b = off + t * 0.012 + tilt * t * 0.02; const p = cut.clone().addScaledVector(v, b).addScaledVector(u, a); const hb = heightAt(a, b, false); p.addScaledVector(n, hb * 0.35 - 0.009 * t * t - T.D * 0.02); pts.push(p); }
        const rows = []; for (let s2 = 0; s2 <= seg; s2++) { const p = pts[s2]; const tan = new V().subVectors(pts[Math.min(seg, s2 + 1)], pts[Math.max(0, s2 - 1)]).normalize(); const sd = new V().crossVectors(tan, n).normalize(); const nn2 = new V().crossVectors(sd, tan).normalize(); const rr3 = 0.0056 * (1 - 0.3 * Math.abs(s2 / seg * 2 - 1)) * (1 + 0.08 * Math.sin(s2 * 2.1 + rI)); const ring = []; for (let q = 0; q < 8; q++) { const a = (q / 8) * TAU; ring.push(new V().copy(p).addScaledVector(sd, Math.cos(a) * rr3 * 1.15).addScaledVector(nn2, Math.sin(a) * rr3 * 0.85)); } rows.push(ring); }
        boneTube(buf, rows, sBone, weightsAt, regionOf); }
    }
  }
  if (anyRemoved) { const out = []; for (let t = 0; t < nTri; t++) if (!removedFlag[t]) out.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]); for (let i = nI0; i < buf.I.length; i++) out.push(buf.I[i]); buf.I = out; }
}
function boneTube(buf, rows, spec, weightsAt, regionOf) {
  const nR = rows.length, M = rows[0].length; const ids = [];
  for (let i = 0; i < nR; i++) { const row = []; const c = rows[i].reduce((a, p) => a.add(p), new V()).multiplyScalar(1 / M); for (let k = 0; k < M; k++) { const p = rows[i][k]; const nn = new V().subVectors(p, c).normalize(); row.push(buf.vert(p, nn, weightsAt(p), spec, 0.9, regionOf(p))); } ids.push(row); }
  for (let i = 0; i < nR - 1; i++) for (let k = 0; k < M; k++) { const k1 = (k + 1) % M; buf.quad(ids[i][k], ids[i][k1], ids[i + 1][k1], ids[i + 1][k]); }
}

// ---------------------------------------------------------------- stumps (dismemberment caps)
export function buildCaps(...a) { const t0 = performance.now(); try { return buildCaps0(...a); } finally { zt('caps', t0); } }
function buildCaps0(o, skinSpec) {
  const buf = o.buf; const lod = o.lod; const rr = mulberry(0xcafe + (o.variant?.id || '').length * 13);
  const flesh = specRaw(9, hex(0x5a0c0c), 0.22), fat = specRaw(9, hex(0xb0985a), 0.3), mus = specRaw(9, hex(0x74161a), 0.2), bone = specRaw(10, hex(0xd8cdb0), 0.6), marrow = specRaw(9, hex(0x8a2a30), 0.25), edge = specRaw(0, hex(0x3a1a18), 0.35, { dirt: 0.5 });
  const n = [12, 8, 6][lod]; const skin = skinSpec;
  const cap = (bone0, t, dir, r, region, bindBone, stub = 0.008, elong = 1.0) => {
    const c = restAt(bone0, t); const d = new V(...(Array.isArray(dir) ? dir : [dir.x, dir.y, dir.z])).normalize(); const up = Math.abs(d.y) < 0.95 ? new V(0, 1, 0) : new V(1, 0, 0); const x = new V().crossVectors(up, d).normalize(), y = new V().crossVectors(d, x).normalize(); const ph = [rr() * 6.3, rr() * 6.3, rr() * 6.3];
    const rag = (a) => 1 + 0.1 * Math.sin(a * 4 + ph[0]) + 0.07 * Math.sin(a * 7 + ph[1]) + 0.05 * Math.sin(a * 11 + ph[2]);
    const RIN = [[1.02, -0.002, skin, edge], [0.97, -0.006, flesh], [0.9, -0.009, fat], [0.82, -0.008, mus], [0.6, -0.001, mus], [0.4, 0.005, mus], [0.27, 0.011, bone], [0.2, 0.013 + stub, bone], [0.12, 0.011 + stub, marrow], [0.0, 0.008 + stub, marrow]];
    const P = []; const specs = []; for (let i = 0; i < RIN.length; i++) { const [k, h] = RIN[i]; const cnt = k === 0 ? 1 : n; const row = []; for (let q = 0; q < cnt; q++) { const a = (q / n) * TAU; const jag = k > 0.9 ? rag(a) : k > 0.5 ? 1 + 0.04 * Math.sin(a * 6 + ph[1]) : 1; const rad = r * k * jag; row.push(new V().copy(c).addScaledVector(x, Math.cos(a) * rad * elong).addScaledVector(y, Math.sin(a) * rad).addScaledVector(d, h + (k > 0.95 ? 0.004 * Math.sin(a * 3 + ph[2]) : 0))); } P.push(row); }
    const bands = []; for (let i = 0; i < RIN.length - 1; i++) { const sp = i === 0 ? skin : RIN[i + 1][2] === skin ? flesh : RIN[i + 1][2]; bands.push({ spec: i === 0 ? edge : sp, col: null, ao: (ii) => 0.55 + 0.4 * (ii / RIN.length) }); }
    const w = [[BI[bindBone], 1]]; const dn = d;
    // emit (custom normals: rings face `d`)
    for (let i = 0; i < P.length - 1; i++) { const bd = bands[i]; const A = P[i], B = P[i + 1]; const ia = A.map((p) => buf.vert(p, dn, w, bd.spec, bd.ao(i), region)), ib = B.map((p) => buf.vert(p, dn, w, bd.spec, bd.ao(i + 1), region));
      for (let k = 0; k < A.length; k++) { const k1 = (k + 1) % A.length; if (B.length === 1) buf.tri(ia[k], ia[k1], ib[0]); else buf.quad(ia[k], ia[k1], ib[k1], ib[k]); } }
    // torn skin flaps hanging off the rim
    if (lod === 0) for (let f = 0; f < 3; f++) { const a = rr() * TAU; const base = new V().copy(c).addScaledVector(x, Math.cos(a) * r * 1.02).addScaledVector(y, Math.sin(a) * r * 1.02); const tip = base.clone().addScaledVector(d, 0.02 + rr() * 0.02).addScaledVector(x, Math.cos(a) * 0.012).addScaledVector(y, Math.sin(a) * 0.012); const s = new V().crossVectors(d, new V().subVectors(base, c)).normalize().multiplyScalar(0.006); const nn = new V().subVectors(base, c).normalize();
      const v0 = buf.vert(base.clone().add(s), nn, w, skin, 0.7, region), v1 = buf.vert(base.clone().sub(s), nn, w, skin, 0.7, region), v2 = buf.vert(tip, nn, w, edge, 0.6, region); buf.tri(v0, v1, v2); buf.tri(v0, v2, v1); }
  };
  for (const s of ['L', 'R']) {
    const up = 'upperarm.' + s, fo = 'forearm.' + s, th = 'thigh.' + s, ca = 'calf.' + s;
    const uaDir = new V().subVectors(restTail(up), restPos(up)).normalize(), faDir = new V().subVectors(restTail(fo), restPos(fo)).normalize();
    const thDir = new V().subVectors(restTail(th), restPos(th)).normalize(), caDir = new V().subVectors(restTail(ca), restPos(ca)).normalize();
    const g = o._body.girth;
    cap(up, 0.06, uaDir.clone().negate(), 0.06 * g, REG['capShoulder' + s], 'clavicle.' + s, 0.0, 1.0);
    cap(up, 0.94, uaDir, 0.045 * g, REG['capElbow' + s], up, 0.012);
    cap(th, 0.1, thDir.clone().negate(), 0.085 * g, REG['capHip' + s], 'pelvis', 0.0);
    cap(th, 0.95, thDir, 0.056 * g, REG['capKnee' + s], th, 0.012);
    cap(up, 0.07, uaDir.clone().negate(), 0.06 * g, REG['gibUarm' + s], up, 0.014);
    cap(fo, 0.02, faDir.clone().negate(), 0.043 * g, REG['gibLarm' + s], fo, 0.012);
    cap(th, 0.11, thDir.clone().negate(), 0.085 * g, REG['gibThigh' + s], th, 0.014);
    cap(ca, 0.02, caDir.clone().negate(), 0.054 * g, REG['gibLleg' + s], ca, 0.012);
  }
  cap('neck', 0.62, [0, 1, 0.1], 0.056, REG.capNeck, 'neck', 0.014);
}
void RIG;
