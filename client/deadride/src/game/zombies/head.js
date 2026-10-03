// Head generator. face.js holds the identity parameters + the signed-distance sculpt; here it is sampled on a TENSOR grid (radial
// rays from the head centre, sphere-traced) whose rows / columns are dense over the eyes, nose, mouth and chin, cut along the lip
// line (the mouth is a real slit into a pouch with palate, 32 teeth, gums and tongue — mouth.js). Ears are anatomical height-field
// shells (helix, scapha, antihelix, concha, tragus, antitragus, lobule). Skin weights: head / jaw / neck with a wide stretch band
// over the cheeks and a sharp split at the lips. Painted eyes / lips / wrinkles / hair colour live in the shader (skinshade.js).
import * as THREE from 'three';
import { HEAD_CENTER, BI } from './rig.js';
import { EYE, MOUTH_Y, EAR, FIS, faceParams, makeFaceSDF, fissureL, asymWarp } from './face.js';
import { matSpec } from './mesh.js';
import { buildMouth, gridMesh, zt } from './mouth.js';
export { EYE, MOUTH_Y, faceParams };

const V = THREE.Vector3;
const C = HEAD_CENTER;
const TAU = Math.PI * 2;
function gradN(f, x, y, z, out) { const e = 0.0005; const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e); out.set(a - b - c + d, -a - b + c + d, -a + b - c + d).normalize(); return out; } // tetrahedral gradient (4 taps)
function sphereTrace(f, dx, dy, dz, rMax = 0.26, guess = 0) {
  // march inward from outside; if a step lands inside the solid (SDF is only approximately Lipschitz after the carves) bisect back to the surface
  let r = rMax, rOut = rMax;
  if (guess > 0) { r = guess + 0.008; let k = 0; while (f(dx * r, dy * r, dz * r) < 0 && k++ < 10) r += 0.012; if (k >= 10) r = rMax; rOut = r; }
  for (let i = 0; i < 120; i++) {
    const d = f(dx * r, dy * r, dz * r);
    if (d > 1e-4) { rOut = r; r -= Math.max(d * 0.9, 2.5e-4); if (r < 0.003) return 0.003; continue; }
    if (d < -2e-4 && rOut > r) { let lo = r, hi = rOut; for (let k = 0; k < 9; k++) { const m = (lo + hi) * 0.5; if (f(dx * m, dy * m, dz * m) > 0) hi = m; else lo = m; } return (lo + hi) * 0.5; }
    return r;
  }
  return r;
}

// ---------------------------------------------------------------- skin weights on the head surface
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const HINGE = { y: -0.045, z: -0.004 };
export const SPLIT = { a0: 24.8 }; // hinge angle (deg) of the lip slit of the head being built (set by buildHead from its own slit rows)
export function headWeights(q) {
  const dy = q.y - HINGE.y, dz = q.z - HINGE.z; const alpha = Math.atan2(-dy, -dz) * 180 / Math.PI; // angle below "forward" around the jaw hinge
  const nearMouth = 1 - smooth(0.018, 0.034, Math.abs(q.x)); const a0 = SPLIT.a0;
  const sharp = smooth(a0 - 0.15, a0 + 0.15, alpha), soft = smooth(a0 - 9.8, a0 + 9.2, alpha);
  let jaw = (sharp * nearMouth + soft * (1 - nearMouth)) * smooth(0.03, -0.02, dz);
  jaw *= 1 - 0.62 * smooth(0.008, 0.062, Math.abs(q.x)); // mouth corners / cheeks follow the jaw only partly: the opening is an oval, not a plate
  jaw *= 1 - smooth(-0.1, -0.14, q.y) * smooth(-0.05, 0.0, q.z) * 0.85; // under-jaw skin stretches to the throat
  const neckBack = smooth(-0.05, -0.1, q.y) * smooth(-0.005, 0.03, q.z) * 0.7;
  const neckLow = smooth(-0.1, -0.16, q.y) * 0.85;
  const neck = Math.max(neckBack, neckLow) * (1 - jaw);
  const head = Math.max(0, 1 - jaw - neck);
  return { head, jaw, neck };
}

// ---------------------------------------------------------------- tensor grid distribution
function distribute(n, lo, hi, dens) { // n+1 samples of [lo, hi] with density dens(x)
  const M = 3000, cdf = new Float64Array(M + 1); for (let i = 1; i <= M; i++) cdf[i] = cdf[i - 1] + dens(lo + (hi - lo) * (i - 0.5) / M);
  const tot = cdf[M], out = []; let k = 0; for (let i = 0; i <= n; i++) { const t = (i / n) * tot; while (k < M - 1 && cdf[k + 1] < t) k++; const f = (t - cdf[k]) / Math.max(1e-12, cdf[k + 1] - cdf[k]); out.push(lo + (hi - lo) * (k + f) / M); }
  return out;
}
const G = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));
const RES = [{ nt: 116, np: 78, dens: 1 }, { nt: 44, np: 30, dens: 0.55 }, { nt: 24, np: 18, dens: 0.2 }];

/**
 * Emit the head into GeoBuf `buf`. fp = faceParams. o: {skin spec, lod}
 * Returns {sdf, center, grid} — the SDF (head space) for accessory / hair fitting and the sampled surface grid.
 */
export function buildHead(...a) { const t0 = performance.now(); try { return buildHead0(...a); } finally { zt('head', t0); } }
function buildHead0(buf, fp, o) {
  const lod = o.lod ?? 0; const res = RES[lod]; const f = makeFaceSDF(fp); const skin = o.skin; const _t0 = buf.triCount;
  const fk = res.dens; // face-density boost fades with the LOD
  const half = distribute(res.nt / 2, 0, Math.PI, (t) => 1 + fk * 1.9 * G(t, 0, 0.75) + fk * 1.3 * (G(t, 0.38, 0.14)) + fk * 1.0 * G(t, 0, 0.2)); const thetas = []; for (let i = 0; i < res.nt / 2; i++) thetas.push(-half[res.nt / 2 - i]); for (let i = 0; i < res.nt / 2; i++) thetas.push(half[i]); // exactly symmetric: index nt/2 = 0
  const PMIN = -86 * Math.PI / 180, PMAX = 84 * Math.PI / 180;
  const phis = distribute(res.np, PMIN, PMAX, (p) => 1 + fk * (1.4 * G(p, 0.04, 0.16) + 2.2 * G(p, -0.22, 0.12) + 1.5 * G(p, -0.5, 0.15) + 2.2 * G(p, -0.75, 0.13) + 1.0 * G(p, -0.95, 0.14)));
  const phiMouth = Math.atan2(MOUTH_Y, 0.1062); const eps = lod === 0 ? 0.0042 : 0.0055;
  const mi = phis.findIndex((p) => p > phiMouth); phis.splice(mi, 0, phiMouth - eps, phiMouth + eps); phis.sort((a, b) => a - b);
  const mRow = phis.findIndex((p) => Math.abs(p - (phiMouth - eps)) < 1e-9); // lower-lip row (mRow), upper = mRow + 1
  const nT = thetas.length, nP = phis.length; const pos = new Array(nT * nP), nrm = new Array(nT * nP); const q = new V(), nn = new V(); let _l = performance.now(); const lap = (k) => { const n2 = performance.now(); zt('head.' + k + lod, _l); _l = n2; };
  const half0 = nT / 2; const warp = asymWarp(fp);
  const traceCol = (j, i, guess) => { const th = thetas[i], ph = phis[j]; const dx = Math.sin(th) * Math.cos(ph), dy = Math.sin(ph), dz = -Math.cos(th) * Math.cos(ph); const r = sphereTrace(f, dx, dy, dz, 0.26, guess); q.set(dx * r, dy * r, dz * r); gradN(f, q.x, q.y, q.z, nn); pos[j * nT + i] = q.clone(); nrm[j * nT + i] = nn.clone(); };
  for (let j = 0; j < nP; j++) { // trace theta = -pi (behind) and the right half (theta >= 0); the left half is its mirror image
    traceCol(j, 0, j > 0 ? pos[(j - 1) * nT].length() : 0);
    for (let i = half0; i < nT; i++) traceCol(j, i, i > half0 ? pos[j * nT + i - 1].length() : j > 0 ? pos[(j - 1) * nT + half0].length() : 0);
  }
  for (let j = 0; j < nP; j++) for (let i = 1; i < half0; i++) { const s = pos[j * nT + nT - i], sn = nrm[j * nT + nT - i]; pos[j * nT + i] = new V(-s.x, s.y, s.z); nrm[j * nT + i] = new V(-sn.x, sn.y, sn.z); }
  for (let k = 0; k < pos.length; k++) warp(pos[k]);
  { const ang = (p) => Math.atan2(-(p.y - HINGE.y), -(p.z - HINGE.z)) * 180 / Math.PI; SPLIT.a0 = (ang(pos[mRow * nT + half0]) + ang(pos[(mRow + 1) * nT + half0])) * 0.5; }
  lap('rays'); const mouthHalf = Math.atan2(0.0215, 0.1); const inMouth = (i) => Math.abs(thetas[i]) < mouthHalf * (lod === 2 ? 0.8 : 1);
  // ---- emit grid (vertex AO from two SDF taps: sockets, nostrils, folds, ear canals read dark even before the shader runs)
  const idx = new Int32Array(nT * nP); const pp = new V();
  for (let j = 0; j < nP; j++) for (let i = 0; i < nT; i++) {
    const p = pos[j * nT + i], n = nrm[j * nT + i]; const hw = headWeights(p); const wt = [[BI.head, hw.head], [BI.jaw, hw.jaw], [BI.neck, hw.neck]];
    let ao = 1;
    if (lod <= 1 && p.z < -0.02 && p.y > -0.15 && Math.abs(p.x) < 0.075) { let occ = 0; for (const [h, w] of [[0.006, 0.6], [0.016, 0.4]]) { pp.copy(p).addScaledVector(n, h); occ += w * Math.max(0, Math.min(1, (h - f(pp.x, pp.y, pp.z)) / h)); } ao = Math.max(0.3, 1 - occ * 0.85); }
    if ((j === mRow || j === mRow + 1) && inMouth(i)) ao = Math.min(ao, 0.5);
    idx[j * nT + i] = buf.vert([p.x + C.x, p.y + C.y, p.z + C.z], nrm[j * nT + i], wt, skin, ao);
  }
  lap('emit'); const hi0 = {}; const cutEyes = lod <= 1;
  for (let j = 0; j < nP - 1; j++) for (let i = 0; i < nT; i++) {
    const i1 = (i + 1) % nT; if (j === mRow && inMouth(i) && inMouth(i1)) continue; // the lip slit
    if (cutEyes) { // palpebral opening: quads whose centre lies inside the almond are left out (the eyeball patch + lid-margin tube fill it)
      const p0 = pos[j * nT + i], p1 = pos[j * nT + i1], p2 = pos[(j + 1) * nT + i1], p3 = pos[(j + 1) * nT + i]; const cx = (p0.x + p1.x + p2.x + p3.x) * 0.25, cy = (p0.y + p1.y + p2.y + p3.y) * 0.25, cz = (p0.z + p1.z + p2.z + p3.z) * 0.25;
      if (cz < EYE.z + 0.003 && fissureL(fp, Math.abs(cx) - EYE.x, cy - EYE.y) < -0.0002) continue; }
    const a = idx[j * nT + i], b = idx[j * nT + i1], c = idx[(j + 1) * nT + i1], d = idx[(j + 1) * nT + i];
    buf.quad(a, d, c, b);
  }
  { const top = new V(0, sphereTrace(f, 0, 1, 0), 0); gradN(f, top.x, top.y, top.z, nn); const t = buf.vert([top.x + C.x, top.y + C.y, top.z + C.z], nn, 'head', skin, 1); const j = nP - 1; for (let i = 0; i < nT; i++) buf.tri(idx[j * nT + i], t, idx[j * nT + (i + 1) % nT]); }
  lap('quads'); if (lod <= 1) { buildMouth(buf, { pos, nT, mRow, thetas, inMouth, fp, lod, C, headWeights }); lap('mouth'); hi0.lashPath = buildEyes(buf, fp, f, skin, lod, o.eyes || {}); lap('eyes'); }
  const _t1 = buf.triCount; for (const sx of [-1, 1]) if (!((fp.earsGone | 0) & (sx < 0 ? 1 : 2))) buildEar(buf, sx, fp, skin, lod);
  if (typeof process !== 'undefined' && process.env.ZDEBUG) console.log('   head lod' + lod + ' tris grid+mouth', _t1 - _t0, 'ears', buf.triCount - _t1, 'grid', nT + 'x' + nP);
  return { sdf: f, center: C.clone(), grid: { pos, nrm, nT, nP, thetas, phis, mRow }, lashPath: hi0.lashPath || null, a0: SPLIT.a0 };
}

// ---------------------------------------------------------------- ears (height-field shells)
const gauss = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));
const angD = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
function buildEar(buf, sx, fp, skin, lod) {
  const S = fp.earSize * 0.94, nA = [28, 12, 10][lod], nR = [12, 6, 5][lod];
  const stick = fp.earStick, up = new V(0, 1, 0.08).normalize();
  const e1 = new V(sx * Math.sin(stick), 0, Math.cos(stick)); // posterior + outward
  let e3 = new V().crossVectors(up, e1); if (e3.x * sx < 0) e3.negate(); e3.normalize();
  const root = new V(sx * 0.0680, EAR.y + 0.0005, 0.0035), W = 0.0335 * S, ac = W * 0.5;
  const lobeSize = fp.earLobe;
  const R = (a) => { const s = Math.sin(a), c = Math.cos(a); const lobeK = Math.max(0, Math.min(1, (-s - 0.3) / 0.5)); return [0.0168 * S * (1 + 0.08 * Math.max(0, s)) * (1 - 0.28 * lobeK) * (c > 0.6 ? 0.92 : 1), 0.0315 * S * (s < 0 ? (0.92 + 0.12 * lobeSize * lobeK) : 1)]; };
  const earH = (r, a) => {
    const s = Math.sin(a), lobeK = Math.max(0, Math.min(1, (-s - 0.35) / 0.4)); let h = 0;
    h += 0.0038 * gauss(r, 0.92, 0.08) * (1 - lobeK * 0.85); h -= 0.0010 * gauss(r, 0.73, 0.07) * (1 - lobeK);
    h += 0.0030 * gauss(r, 0.54, 0.08) * gauss(angD(a, 1.9), 0, 1.5); h += 0.0015 * gauss(r, 0.42, 0.07) * gauss(angD(a, 2.9), 0, 0.5); // antihelix + crus
    h -= 0.0056 * gauss(r, 0.13, 0.20) * gauss(angD(a, -0.6), 0, 1.6);                                            // concha
    h += 0.0046 * gauss(r, 0.5, 0.11) * gauss(angD(a, 0.1), 0, 0.42);                                                // tragus
    h += 0.0030 * gauss(r, 0.45, 0.09) * gauss(angD(a, -2.35), 0, 0.5);                                              // antitragus
    return (h + lobeK * 0.0012) * S;
  };
  const pt = (r, a, hOff, rim = 0) => { const [rs, rt] = R(a); const s = r * (rs + rim) * Math.cos(a), t = r * (rt + rim) * Math.sin(a); const h = hOff(r, a); return new V().copy(root).addScaledVector(e1, ac - s).addScaledVector(up, t).addScaledVector(e3, h); };
  const rowsG = []; const rs = []; for (let i = 0; i < nR; i++) rs.push(i / (nR - 1)); const back = (r, a) => earH(r, a) - 0.0026 * S - 0.0012 * (1 - r) * S;
  for (let i = 0; i < nR; i++) { const r = Math.max(1e-4, rs[i]); const row = []; for (let k = 0; k < nA; k++) { const a = (k / nA) * TAU; row.push(pt(r, a, earH)); } rowsG.push(row); }
  for (const [rimK, hk] of [[0.0007, 0.0], [0.0008, -0.0016]]) { const row = []; for (let k = 0; k < nA; k++) { const a = (k / nA) * TAU; row.push(pt(1, a, (r2, a2) => earH(r2, a2) * 0.4 + (back(1, a2) - earH(1, a2)) * (hk === 0 ? 0.25 : 0.75), rimK)); } rowsG.push(row); }
  for (let i = nR - 1; i >= 0; i--) { const r = Math.max(1e-4, rs[i]); const row = []; for (let k = 0; k < nA; k++) { const a = (k / nA) * TAU; row.push(pt(r, a, back)); } rowsG.push(row); }
  const flip = sx < 0; const nfront = e3.clone(), nback = e3.clone().negate();
  gridMesh(buf, rowsG, { wrapJ: true, flip, w: [[BI.head, 1]], spec: skin, ao: (i) => (i < nR ? 0.7 + 0.3 * (i / nR) : 0.55), off: [C.x, C.y, C.z], poles: [[nfront.x, nfront.y, nfront.z], [nback.x, nback.y, nback.z]] });
}

// ---------------------------------------------------------------- eyes: eyeball patch (sclera + cornea height-field over the almond) + lid-margin tube
/** z of the SDF surface at (x, y) (bisection along z through the eye region) */
function surfaceZ(f, x, y) { let lo = -0.14, hi = 0.0; for (let k = 0; k < 16; k++) { const m = (lo + hi) * 0.5; if (f(x, y, m) > 0) lo = m; else hi = m; } return (lo + hi) * 0.5; }
function buildEyes(buf, fp, f, skin, lod, eyeOpt) {
  const lash = [];
  const nu = lod === 0 ? 19 : 9, nv = lod === 0 ? 9 : 5; const gx = fp.gaze[0], gy = fp.gaze[1]; const ER = EYE.r;
  const iris = eyeOpt.iris ?? [0x5a3a22, 0x6a4a2a, 0x3a5a7a, 0x5a6a52, 0x7a6a4a, 0x2a2a2c][Math.floor(((fp.brow * 7.31 + fp.nose * 3.7 + fp.jaw * 5.1) % 1) * 6)];
  const eyeSpec = matSpec({ mat: 'eye', color: iris, rough: 0.05, wear: Math.max(0, Math.min(1, gx * 6 + 0.5)), dirt: Math.max(0, Math.min(1, gy * 6 + 0.5)), param: 0.35 + fp.age * 0.3 });
  const sclera = (ex, ey) => { const r2 = Math.min(ex * ex + ey * ey, (ER * 0.985) ** 2); return EYE.z - Math.sqrt(ER * ER - r2); };
  const gzn = -Math.sqrt(Math.max(0.5, 1 - gx * gx - gy * gy)), cx0 = gx * 0.0070, cy0 = gy * 0.0070, cz0 = EYE.z + gzn * 0.0070, Rc = 0.0078;
  const zEye = (ex, ey) => { let z = sclera(ex, ey); const dx = ex - cx0 - 0, dy = ey - cy0; const q2 = dx * dx + dy * dy; if (q2 < Rc * Rc) { const zc = cz0 - Math.sqrt(Rc * Rc - q2); const k = 0.0007, h = Math.max(k - Math.abs(zc - z), 0) / k; z = Math.min(z, zc) - h * h * k * 0.25; } return z; };
  const yU = (u, ex) => FIS.up * Math.pow(Math.max(0, 1 - u * u), 0.85) + FIS.tilt * ex - fp.lidDrop * 0.0008 * (ex > 0 ? 1 : 0.3), yL = (u, ex) => -FIS.dn * Math.pow(Math.max(0, 1 - u * u), 0.85) + FIS.tilt * ex - fp.lidDrop * 0.0008 * (ex > 0 ? 1 : 0.3);
  for (const sx of [-1, 1]) {
    // eyeball patch: columns across the fissure, rows between the margins (extended 30 % under the lids)
    const rows = []; for (let v = 0; v < nv; v++) { const tv = v / (nv - 1); const row = []; for (let u = 0; u < nu; u++) { const uu = -1 + 2 * u / (nu - 1); const ex = FIS.cx + uu * FIS.hw * 0.995; const a = yL(uu, ex), b = yU(uu, ex); const h = (b - a); const ey = a - h * 0.3 + (tv) * h * 1.6; row.push(new V(sx * (EYE.x + ex) + 0, EYE.y + ey, zEye(ex, ey))); } rows.push(row); }
    const flip = sx > 0; gridMesh(buf, rows, { flip, w: [[BI.head, 1]], spec: eyeSpec, ao: 0.9, off: [C.x, C.y, C.z] });
    // lid-margin tube (upper margin medial → lateral, lower margin back): centre on the almond curve at the skin surface, radius 1.15 mm
    const path = []; const n1 = lod === 0 ? 22 : 10; for (let k = 0; k <= n1; k++) { const uu = -1 + 2 * k / n1, ex = FIS.cx + uu * FIS.hw; path.push([ex, yU(uu, ex), 1]); } for (let k = n1 - 1; k >= 1; k--) { const uu = -1 + 2 * k / n1, ex = FIS.cx + uu * FIS.hw; path.push([ex, yL(uu, ex), -1]); }
    const P = path.map(([ex, ey, side]) => { const x = sx * (EYE.x + ex), y = EYE.y + ey; const z = surfaceZ(f, x, y); return { x, y, z, ex, ey, side }; });
    const nSide = lod === 0 ? 7 : 5, r0 = 0.00082; const tube = [];
    for (let k = 0; k < P.length; k++) {
      const p = P[k], q0 = P[(k + P.length - 1) % P.length], q1 = P[(k + 1) % P.length]; const t = new V(q1.x - q0.x, q1.y - q0.y, q1.z - q0.z).normalize(); const inward = new V(0, -p.side, 0); inward.addScaledVector(t, -inward.dot(t)).normalize(); // toward the eye centre in the fissure plane
      const nrm = new V().crossVectors(t, inward).normalize(); if (nrm.z > 0) nrm.negate(); // outward (toward the viewer, −z)
      const ring = []; for (let m = 0; m < nSide; m++) { const a = (m / nSide) * TAU; const c = Math.cos(a), s = Math.sin(a); const off = new V().copy(inward).multiplyScalar(c * r0).addScaledVector(nrm, s * r0 * 0.9); ring.push(new V(p.x + off.x, p.y + off.y, p.z + off.z - 0.0002)); }
      tube.push(ring);
    }
    const lidCol = (i, j) => { const a = (j / nSide) * TAU; const k = 0.5 + 0.5 * Math.cos(a); const base = skin.col; return [base[0] * (1 - 0.25 * k) + 46 * 0.25 * k, base[1] * (1 - 0.3 * k) + 22 * 0.3 * k, base[2] * (1 - 0.3 * k) + 22 * 0.3 * k]; };
    gridMesh(buf, tube, { wrapI: true, wrapJ: true, flip: sx < 0, w: [[BI.head, 1]], spec: skin, ao: 0.85, col: lidCol, off: [C.x, C.y, C.z] });
    lash.push({ sx, pts: P });
  }
  return lash;
}
