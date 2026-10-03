// FOLD SYNTHESIS for cloth meshes (CMesh): ridged crease displacement (crisp crest, soft valley) driven by zone fields —
// hanging folds on loose cloth, joint compression (elbow / knee / wrist / ankle stacking / belt gathers / armpit + crotch fans) — and
// properly constructed quilted baffles (pillows pinched at the stitch lines). Displacement is outward only (never into the layers
// underneath). All fields are analytic in rest space + the limb frames below, so LOD1 (2 cm) and LOD0 (1 cm) show the same folds.
import * as THREE from 'three';
import { NB, RIG } from './rig.js';

const V = THREE.Vector3;
// ------------------------------------------------------------------ noise + helpers
function h3(ix, iy, iz, s) { let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440670441) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
/** smooth value noise in [-1, 1] */
export function noise3(x, y, z, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = h3(ix, iy, iz, s), b = h3(ix + 1, iy, iz, s), c = h3(ix, iy + 1, iz, s), d = h3(ix + 1, iy + 1, iz, s), e = h3(ix, iy, iz + 1, s), f = h3(ix + 1, iy, iz + 1, s), g = h3(ix, iy + 1, iz + 1, s), h = h3(ix + 1, iy + 1, iz + 1, s);
  const x0 = a + (b - a) * ux, x1 = c + (d - c) * ux, x2 = e + (f - e) * ux, x3 = g + (h - g) * ux, y0 = x0 + (x1 - x0) * uy, y1 = x2 + (x3 - x2) * uy;
  return (y0 + (y1 - y0) * uz) * 2 - 1;
}
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ bone groups + limb frames
export const GROUPS = { torso: 0, head: 1, uaL: 2, uaR: 3, faL: 4, faR: 5, hdL: 6, hdR: 7, thL: 8, thR: 9, caL: 10, caR: 11, ftL: 12, ftR: 13 };
export const GROUP_OF = new Uint8Array(NB);
for (let i = 0; i < NB; i++) {
  const n = RIG.bones[i].name, s = n.endsWith('.L') ? 'L' : n.endsWith('.R') ? 'R' : ''; let g = 0;
  if (/^(neck|head|jaw)/.test(n)) g = 1; else if (/^upperarm/.test(n)) g = GROUPS['ua' + s]; else if (/^forearm/.test(n)) g = GROUPS['fa' + s]; else if (/^(hand|index|middle|ring|pinky|thumb)/.test(n)) g = GROUPS['hd' + s];
  else if (/^thigh/.test(n)) g = GROUPS['th' + s]; else if (/^calf/.test(n)) g = GROUPS['ca' + s]; else if (/^(foot|toe)/.test(n)) g = GROUPS['ft' + s];
  GROUP_OF[i] = g;
}
const FR = []; // frames by group id: origin o, axis a, front f, lateral l, offset L0 (chain coordinate at the origin)
function frame(g, o, a, L0 = 0) { const av = a.clone().normalize(); const fr0 = new V(0, 0, -1); const f = fr0.clone().addScaledVector(av, -fr0.dot(av)).normalize(); const l = new V().crossVectors(av, f).normalize(); FR[g] = { o, a: av, f, l, L0 }; }
{
  frame(GROUPS.torso, new V(0, 0, 0.02), new V(0, 1, 0), 0);
  for (const s of ['L', 'R']) {
    const A = RIG.arm[s], sh = new V(...A.sh), el = new V(...A.el), wr = new V(...A.wr); frame(GROUPS['ua' + s], sh, el.clone().sub(sh), 0); frame(GROUPS['fa' + s], el, wr.clone().sub(el), el.distanceTo(sh));
    const Lg = RIG.leg[s], hip = new V(...Lg.hip), kn = new V(...Lg.knee), an = new V(...Lg.ankle); frame(GROUPS['th' + s], hip, kn.clone().sub(hip), 0); frame(GROUPS['ca' + s], kn, an.clone().sub(kn), kn.distanceTo(hip));
  }
}
export const LIMB = { UA: 0.326, LEG_TH: 0.425 }; // chain lengths (upper arm, thigh) used by joint zones
const RHO = { 0: 0.13, 2: 0.05, 3: 0.05, 4: 0.037, 5: 0.037, 8: 0.07, 9: 0.07, 10: 0.048, 11: 0.048 }; // reference radii → fold counts
const LAM = { 0: 0.078, 2: 0.062, 3: 0.062, 4: 0.056, 5: 0.056, 8: 0.078, 9: 0.078, 10: 0.062, 11: 0.062 };

/** per-vertex limb frame data: dominant group g, dominance gw, axial coordinate s (chain), angle th (0 = front, radians), radius rho */
export function computeFrames(m) {
  const n = m.n, P = m.P; const g = new Uint8Array(n), gw = new Float32Array(n), s = new Float32Array(n), th = new Float32Array(n), rho = new Float32Array(n); const acc = new Float32Array(16);
  for (let i = 0; i < n; i++) {
    acc.fill(0); for (let k = 0; k < 4; k++) { const w = m.WW[i * 4 + k]; if (w > 0) acc[GROUP_OF[m.WI[i * 4 + k]]] += w; }
    let bg = 0, bw = 0; for (let q = 0; q < 14; q++) if (acc[q] > bw) { bw = acc[q]; bg = q; } g[i] = bg; gw[i] = bw;
    const fr = FR[bg]; if (!fr) { s[i] = 0; th[i] = 0; rho[i] = 0.05; continue; }
    const dx = P[i * 3] - fr.o.x, dy = P[i * 3 + 1] - fr.o.y, dz = P[i * 3 + 2] - fr.o.z; const along = dx * fr.a.x + dy * fr.a.y + dz * fr.a.z; s[i] = along + fr.L0;
    const rx = dx - fr.a.x * along, ry = dy - fr.a.y * along, rz = dz - fr.a.z * along; rho[i] = Math.hypot(rx, ry, rz); th[i] = Math.atan2(rx * fr.l.x + ry * fr.l.y + rz * fr.l.z, rx * fr.f.x + ry * fr.f.y + rz * fr.f.z);
  }
  return { g, gw, s, th, rho };
}
/** ridge profile: crisp crest, soft valley (0 in the valley, 1 on the crest) */
export function ridge(phi) { const t = phi - Math.floor(phi); const s = Math.abs(2 * t - 1); const k = 1 - s; const vs = k < 0.4 ? (k / 0.4) * (k / 0.4) * (3 - 2 * k / 0.4) : 1; return (1 - Math.pow(s, 0.6)) * vs; }

/**
 * applyFolds(m, N, opt): displace vertices outward along N by synthesised creases.
 * opt: { amp (overall, 0.4 tight … 1.6 loose), loose (0..1.5), seed, belt (y|null), stack (0..1: trousers piling on the boots), cuff (0..1: sleeve wrist bunching),
 *        elbow, knee (0..1), lod (0|1), fr (precomputed frames), noFold (Uint8Array: vertices to skip), stiff (0..1: stiff cloth = fewer, broader folds) }
 */
export function applyFolds(m, N, opt) {
  const n = m.n, P = m.P, fr = opt.fr || computeFrames(m); const { g, gw, s, th, rho } = fr; const seed = (opt.seed | 0) & 255, amp = opt.amp ?? 1, loose = opt.loose ?? 0.5, lodK = opt.lod ? 0.85 : 1, stiff = opt.stiff ?? 0.3; const wl = 1 + stiff * 0.5;
  // extents of the garment per group (hem / cuff positions along the limb chain)
  const smax = new Float32Array(16).fill(-1e9), smin = new Float32Array(16).fill(1e9);
  for (let i = 0; i < n; i++) { if (gw[i] < 0.75) continue; const q = g[i]; if (s[i] > smax[q]) smax[q] = s[i]; if (s[i] < smin[q]) smin[q] = s[i]; }
  const gap = (i) => m.C[i * 8 + 5]; const comp = (i) => m.C[i * 8 + 6]; const CV = m.cv; const disp = new Float32Array(n);
  const belt = opt.belt ?? null; const stack = opt.stack ?? 0, cuffB = opt.cuff ?? 0.5, elbowK = opt.elbow ?? 1, kneeK = opt.knee ?? 1;
  for (let i = 0; i < n; i++) {
    const q = g[i]; const F = FR[q]; if (q === GROUPS.ftL || q === GROUPS.ftR) { // leather / rubber boots: flex creases across the instep at the ball of the foot + a few at the ankle
      if (opt.boot && !(CV && CV[i])) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; const top = smooth(0.15, 0.6, N[i * 3 + 1]); const wz = noise3(x * 30, y * 30, z * 30, seed + 4) * 0.35; const cr = ridge((z + 0.088) / 0.0115 + wz) * smooth(-0.05, -0.085, z) * smooth(-0.135, -0.11, z) + 0.6 * ridge((z + 0.04) / 0.014 + wz) * smooth(0.0, -0.03, z) * smooth(-0.075, -0.05, z); disp[i] = opt.boot * 0.0034 * cr * top * (0.7 + 0.3 * smooth(-0.3, 0.5, noise3(x * 6, y * 6, z * 6, seed))); } continue; }
    if (!F || (CV && CV[i])) continue; if (q === GROUPS.head || q === GROUPS.hdL || q === GROUPS.hdR) continue;
    const dom = smooth(0.42, 0.85, gw[i]); if (dom <= 0) continue; if (opt.noFold && opt.noFold[i]) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; const S = s[i], T = th[i], R = rho[i];
    const free = 1 - Math.exp(-Math.max(0, gap(i)) / 0.012); // 0 = resting on the body, 1 = hanging free
    const cmp = Math.min(1, comp(i) * 40);
    const mask = 0.25 + 0.75 * smooth(-0.35, 0.55, noise3(x * 5.3, y * 5.3, z * 5.3, seed)); // creases come in patches
    const warp = 0.32 * noise3(x * 3.7 + 11, y * 3.7, z * 3.7, seed + 3);
    let d = 0;
    const isTorso = q === 0, isArm = q >= 2 && q <= 5, isLeg = q >= 8 && q <= 11; const side = (q & 1) ? 1 : -1;
    // 1. hanging folds (ridges run along the limb axis / down the torso)
    { const nf = Math.max(3, Math.round(TAU * RHO[q] / (LAM[q] * wl))); const phi = (T / TAU) * nf + warp * 1.4 + 0.3 * noise3(S * 9, T, 0, seed + 5);
      let zone = 1; if (isTorso) zone = smooth(1.36, 1.02, y) * (0.5 + 0.5 * smooth(1.2, 0.95, y)); else if (isArm) zone = smooth(0.07, 0.32, S); else if (isLeg) zone = q >= 10 ? 0.8 : smooth(0.02, 0.28, S) * 0.9 + 0.1;
      d += amp * (0.0055 + 0.0115 * loose) * (0.45 + 0.55 * free + 0.5 * cmp) * mask * zone * ridge(phi); }
    // 2. joint compression folds (rings around the limb)
    if (isArm) {
      const eZ = Math.exp(-(((S - LIMB.UA) / 0.05) ** 2)); const inner = 0.3 + 0.7 * Math.max(0, Math.cos(T)); // inner elbow faces forward
      if (eZ > 0.02) d += amp * elbowK * 0.0085 * eZ * inner * ridge((S - LIMB.UA) / (0.031 * wl) + warp) * (0.6 + 0.4 * mask);
      const cz = smooth(0.13, 0.015, smax[q] - S) * (q >= 4 ? 1 : 0); if (cz > 0) d += amp * cuffB * 0.0075 * cz * ridge((smax[q] - S) / (0.027 * wl) + warp * 0.6) * (0.5 + 0.5 * mask);
    }
    if (isLeg) {
      const kZ = Math.exp(-(((S - LIMB.LEG_TH) / 0.07) ** 2)); const back = 0.35 + 0.65 * Math.max(0, -Math.cos(T)), front = 0.3 + 0.7 * Math.max(0, Math.cos(T));
      if (kZ > 0.02) d += amp * kneeK * kZ * (0.0060 * front + 0.0085 * back) * ridge((S - LIMB.LEG_TH) / (0.034 * wl) + warp) * (0.6 + 0.4 * mask);
      if (q >= 10 && stack > 0) { const sz = smooth(0.17, 0.02, smax[q] - S); if (sz > 0) d += amp * stack * 0.0105 * sz * ridge((smax[q] - S) / (0.03 * wl) + warp * 0.8 + 0.15 * noise3(T * 3, S * 5, 0, seed + 9)) * (0.55 + 0.45 * mask) * (0.7 + 0.3 * Math.cos(T)); }
    }
    if (isTorso) {
      if (belt != null) { const bz = Math.exp(-(((y - (belt + 0.05)) / 0.045) ** 2)); if (bz > 0.02) d += amp * 0.0085 * bz * ridge((y - belt) / (0.032 * wl) + warp) * (0.55 + 0.45 * mask); }
      // armpit fans (both sides) — ridges radiate from the axilla across the chest / back and down the upper arm
      for (const sx of [-1, 1]) { const ax = sx * 0.155, ay = 1.3; const dx = (x - ax) * sx, dy = y - ay; const dist = Math.hypot(dx, dy, (z - 0.01) * 0.6); const az = smooth(0.13, 0.03, dist); if (az > 0) { const ang = Math.atan2(dy, dx * 1.0 + 0.0001); d += amp * 0.0065 * az * ridge(ang * 1.05 + warp) * (0.5 + 0.5 * mask) * (z < 0.02 ? 1 : 0.8); } }
      // crotch fan (trousers) + seat crease
      const cd = Math.hypot(x, (y - 0.79) * 1.1, (z - 0.0) * 0.8); const cz = smooth(0.17, 0.05, cd); if (cz > 0 && y < 0.95) d += amp * 0.0065 * cz * ridge(Math.atan2(y - 0.79, x * 1.0 + 0.0001) * 1.1 + warp) * (0.5 + 0.5 * mask);
      if (z > 0.03 && y < 0.95) d += amp * 0.0045 * Math.exp(-(((y - 0.85) / 0.02) ** 2)) * mask;
    }
    disp[i] = d * dom * lodK;
  }
  for (let i = 0; i < n; i++) { const d = disp[i]; if (d === 0) continue; P[i * 3] += N[i * 3] * d; P[i * 3 + 1] += N[i * 3 + 1] * d; P[i * 3 + 2] += N[i * 3 + 2] * d; }
  return disp;
}

/**
 * quilted baffles: horizontal channels every `period` metres, pinched at the stitch lines (crisp), pillows fuller toward the bottom of each
 * baffle (down settles), vertical box-quilting seams on the torso (front zip line, sides, centre back). opt: {period, bulge, seed, fr, sag}
 */
export function applyBaffles(m, N, opt) {
  const n = m.n, P = m.P, fr = opt.fr || computeFrames(m); const { g, gw, s, th, rho } = fr; const per = opt.period ?? 0.105, bulge = opt.bulge ?? 0.02, seed = (opt.seed | 0) & 255; const CV = m.cv; const disp = new Float32Array(n);
  const gph = [0.13, 0, 0.47, 0.71, 0.29, 0.83, 0, 0, 0.55, 0.2, 0.31, 0.64, 0, 0];
  for (let i = 0; i < n; i++) {
    const q = g[i]; if (CV && CV[i]) continue; const isTorso = q === 0, isArm = q >= 2 && q <= 5; if (!isTorso && !isArm) continue;
    const dom = smooth(0.42, 0.85, gw[i]); if (dom <= 0) continue; const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let c, zone = 1; if (isTorso) { c = -y; zone = smooth(1.41, 1.33, y) * smooth(0.82, 0.9, y); } else { c = s[i]; zone = smooth(0.05, 0.11, s[i]); if (q >= 4) zone *= smooth(0.66, 0.6, s[i]); }
    if (zone <= 0) continue;
    const u = c / per + gph[q] + 0.16 * noise3(x * 5.5, q * 1.3, z * 5.5, seed + 7) + 0.06 * noise3(x * 17, y * 4, z * 17, seed + 8); const band = Math.floor(u); let t = u - band; const bn = noise3(band * 1.7, q * 3.1, 0, seed);
    const tt = Math.pow(t, 0.82); const pil = Math.pow(Math.sin(Math.PI * tt), 0.55) * (0.94 + 0.06 * t);
    // box-quilting seams (torso): front centre, ±100° (side), back centre
    let seam = 1; if (isTorso) { const T = th[i]; const dd = Math.min(Math.abs(T), Math.abs(Math.abs(T) - 1.75), Math.PI - Math.abs(T)) * rho[i]; seam = 1 - 0.55 * Math.exp(-((dd / 0.011) ** 2)); } else { const T = th[i]; const dd = Math.abs(Math.abs(T) - 1.57) * rho[i]; seam = 1 - 0.4 * Math.exp(-((dd / 0.009) ** 2)); }
    const A = bulge * (0.88 + 0.16 * bn + 0.1 * (isTorso ? smooth(1.3, 0.9, y) : smooth(0.1, 0.5, s[i]))) * (0.9 + 0.1 * noise3(x * 4, y * 4, z * 4, seed + 1));
    disp[i] = A * pil * seam * zone * dom;
  }
  for (let i = 0; i < n; i++) { const d = disp[i]; if (d === 0) continue; P[i * 3] += N[i * 3] * d; P[i * 3 + 1] += N[i * 3 + 1] * d; P[i * 3 + 2] += N[i * 3 + 2] * d; }
  return disp;
}
