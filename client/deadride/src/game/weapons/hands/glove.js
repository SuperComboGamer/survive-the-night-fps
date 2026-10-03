// Full-finger tactical glove, right hand rest pose (left = mirror). Real geometry, all bone-weighted:
//  * hull: 4 fingers (3 phalanges, joint knuckles, palmar pads + flexion creases, lateral seam welts, cap seam, tip patch), thumb, palm/back loft with
//    thenar / hypothenar pads, metacarpal heads and tendons, cuff;
//  * overlays: TPR knuckle plate + 3 accordion segments per finger, palm pads, thumb saddle, velcro wrist strap with pull tab, elastic cuff bead;
//  * stitch rows: one raised thread lozenge per stitch (topstitch around panels, cap seams, cuff seams).
import * as THREE from 'three';
import { GB, Surf, surfGrid, panel, stitchLine, welt, clamp, sm, lerp, gs, spow, TAU, lin } from './kit.js';
import { FING, THUMB, B, NB } from './anat.js';

const V3 = THREE.Vector3;
export const COL = { tpr: lin(0x1a1c1f), tprHi: lin(0x24272b), thread: lin(0x9b8a66), threadDk: lin(0x4a4a44), hook: lin(0x1d1e1f), loop: lin(0x2a2b2b), white: [1, 1, 1], tab: lin(0x7d6a4c) };
const rowsFor = (s0, s1, base, feats) => { const out = [s0]; let s = s0; while (s < s1 - 1e-6) { let st = base; for (const [p, r, d] of feats) st = Math.min(st, lerp(d, base, sm(r * 0.6, r * 1.6, Math.abs(s - p)))); s = Math.min(s1, s + st); out.push(s); } return out; };
const M = 8; // columns per half turn for digits (dorsal half then palmar half, the seam column is duplicated => hard zone edge)
const DIG_VS = (() => { const v = []; for (let k = 0; k <= M; k++) v.push(k / M * Math.PI); for (let k = 0; k <= M; k++) v.push(Math.PI + k / M * Math.PI); return v; })();

// ------------------------------------------------------------------ digit (finger / thumb) shape
const _loc = { x: 0, y: 0, se: 0, sc: 1 };
/** local ring point of a digit at param s, angle th: theta 0 = lateral seam (+X), pi/2 = dorsal (+Y), pi = medial seam, 3pi/2 = pulp side */
function digitLocal(F, s, th, thumb, o) {
  const L = F.L, j1 = F.len[0], j2 = j1 + F.len[1], rt = F.r[1], cap0 = L - rt;
  let se = s, sc = 1; if (s > cap0) { const q = clamp((s - cap0) / (L - cap0)); const ph = q * Math.PI / 2; se = cap0 + rt * Math.sin(ph) * 0.95; sc = Math.max(0.0, Math.cos(ph)); }
  const t = clamp(se / L); let base = lerp(F.r[0], F.r[1], t); if (thumb && se < j1) base += 0.004 * Math.sin(Math.max(0, se) / j1 * Math.PI);
  const web = thumb ? sm(0.006, -0.004, se) * 0.12 : sm(0.014, -0.006, se);
  const c = Math.cos(th), sn = Math.sin(th); const rx = base * (thumb ? 1.04 : 1.07) * (1 + (thumb ? 1 : 0.24) * web) * sc, ry = base * (thumb ? 0.92 : 0.93) * (1 + 0.08 * web) * sc; const ex = 2 / 2.45;
  let x = rx * spow(c, ex), y = ry * (sn > 0 ? 1.04 : 0.94) * spow(sn, ex);
  const dors = Math.max(0, sn), pal = Math.max(0, -sn), dth = Math.acos(Math.min(1, Math.abs(c)));
  const J1 = gs(se - j1, 0.0042), J2 = gs(se - j2, 0.0036); const tip = L - rt * 1.25; const sk = thumb ? 1.35 : 1;
  let d = 0;
  d += dors * dors * (0.00095 * J1 + 0.0006 * J2) * sk; // dorsal knuckles
  d += dors * 0.00028 * (gs(se - j1 - 0.0036, 0.0008) + gs(se - j1 + 0.0036, 0.0008) + 0.7 * (gs(se - j2 - 0.003, 0.0007) + gs(se - j2 + 0.003, 0.0007))); // fabric bunching ridges over the joints
  d += pal * (0.00075 * gs(se - j1 * 0.5, 0.011) + 0.0006 * gs(se - (j1 + j2) * 0.5, 0.0075) + 0.0009 * sk * gs(se - tip, 0.0065)); // pads
  d -= pal * (0.00085 * gs(se - j1, 0.0013) + 0.0006 * gs(se - j2, 0.0011)) * sk; // flexion creases
  const capF = 1 - sm(cap0 - 0.002, cap0 + 0.004, se);
  d += 0.00034 * gs(dth, 0.11) * capF * sm(0.006, 0.013, se); d -= 0.00012 * gs(dth - 0.24, 0.09) * capF * sm(0.006, 0.013, se); // lateral seam welt + seam allowance
  const cs = L - 0.0165; d += 0.0003 * gs(se - cs, 0.0008) - 0.0001 * (gs(se - cs - 0.0022, 0.0007) + gs(se - cs + 0.0022, 0.0007)); // cap seam
  const edge = sm(L - 0.0186, L - 0.0181, se) * sm(0.05, 0.5, pal + 0.15 * sc); d += 0.0004 * edge; // tip patch (0.4 mm step)
  d *= Math.min(1, sc * 2);
  o.x = x + d * c; o.y = y + d * sn; o.se = se; o.sc = sc; o.dth = dth; o.J1 = J1; o.J2 = J2; return o;
}
const digitAttr = (F, fi, thumb) => { const L = F.L, j1 = F.len[0], j2 = j1 + F.len[1], rt = F.r[1], cap0 = L - rt; const jb = thumb ? 13 : 1 + fi * 3;
  return (i, j, s, th, p) => { const pal = j > M ? 1 : 0; const se = s > cap0 ? cap0 + rt * Math.sin(clamp((s - cap0) / (L - cap0)) * Math.PI / 2) * 0.95 : s; const sn = Math.sin(th), c = Math.cos(th); const dth = Math.acos(Math.min(1, Math.abs(c)));
    const tipW = pal * (0.75 * sm(L - 0.024, L - 0.006, se) + 0.3 * gs(se - j1 * 0.5, 0.012)); const dors = Math.max(0, sn); const J1 = gs(se - j1, 0.0045), J2 = gs(se - j2, 0.004);
    const wear = pal ? tipW : 0.35 * dors * (J1 + J2) + 0.25 * sm(L - 0.016, L, se) * dors; const dirt = 0.5 * (1 - sm(0.0, 0.02, se + 0.006)) + 0.25 * (J1 + J2) * pal + 0.3 * gs(dth, 0.06);
    const perf = pal ? gs(dth - 0.55, 0.32) * sm(0.02, 0.03, se) * (1 - sm(cap0 - 0.006, cap0 - 0.001, se)) : 0; const web = sm(0.02, -0.006, se);
    const ao = clamp(1 - 0.45 * web * gs(dth, 0.7) - 0.16 * (J1 + J2) * pal, 0.3, 1);
    const jid = J1 > J2 ? jb + 1 : jb + 2; const prox = Math.max(J1, J2); const ax = clamp(J1 > J2 ? se - j1 : se - j2, -0.012, 0.012);
    return { z: [pal, 0, 0, 0], x: [wear, dirt, perf, ao], j: [jid, prox, sn, ax] }; }; };
function digitSurf(F, thumb, frame) {
  const b0 = new V3(...(thumb ? THUMB.cmc : F.mcp)); const w = digitWeights(F, thumb);
  const f = (s, th, out) => { digitLocal(F, s, th, thumb, _loc); if (thumb) return out.copy(b0).addScaledVector(frame.X, _loc.x).addScaledVector(frame.Y, _loc.y).addScaledVector(frame.Z, _loc.se); return out.set(b0.x + _loc.x, b0.y + _loc.y, b0.z - _loc.se); };
  const c = (s, out) => { const se = s; return thumb ? out.copy(b0).addScaledVector(frame.Z, se) : out.set(b0.x, b0.y, b0.z - se); };
  return new Surf(f, c, w, { du: 1.5e-4, dv: 2e-3 });
}
function digitWeights(F, thumb) {
  const j1 = F.len[0], j2 = j1 + F.len[1]; const fi = thumb ? -1 : FING.indexOf(F); const bones = thumb ? [B.hand, B.t1, B.t2, B.t3] : [B.hand, B['f' + fi + '0'], B['f' + fi + '1'], B['f' + fi + '2']];
  return (s) => { const t0 = thumb ? sm(0.004, 0.02, s) : sm(-0.005, 0.005, s), t1 = thumb ? sm(j1 - 0.005, j1 + 0.004, s) : sm(j1 - 0.004, j1 + 0.003, s), t2 = thumb ? sm(j2 - 0.004, j2 + 0.003, s) : sm(j2 - 0.0035, j2 + 0.0025, s); return [[bones[0], 1 - t0], [bones[1], t0 - t1], [bones[2], t1 - t2], [bones[3], t2]]; };
}
function buildDigit(gb, F, fi, thumb, frame) {
  const S = digitSurf(F, thumb, frame); const L = F.L, j1 = F.len[0], j2 = j1 + F.len[1], rt = F.r[1], cap0 = L - rt; const s0 = thumb ? -0.006 : -0.012;
  const us = rowsFor(s0, cap0, 0.0030, [[j1, 0.0045, 0.0009], [j2, 0.004, 0.0009], [L - 0.0165, 0.003, 0.0008], [L - 0.0184, 0.0025, 0.0007]]); for (let k = 1; k <= 6; k++) us.push(cap0 + (L - cap0) * k / 6);
  const A = digitAttr(F, fi, thumb); const col = (pal) => (pal ? [1, 1, 1] : [1, 1, 1]);
  surfGrid(gb, S, us, DIG_VS, (i, j, u, v, p) => { const a = A(i, j, u, v, p); a.c = col(a.z[0]); return a; }, { cap: true });
  return S;
}
// ------------------------------------------------------------------ palm / back / cuff loft
const PK = [ // z, half-width a, dorsal half-height, palmar half-height, x offset
  [-0.095, 0.0330, 0.0080, 0.0080, 0.001], [-0.088, 0.0405, 0.0110, 0.0110, 0.002], [-0.076, 0.0432, 0.0122, 0.0128, 0.002], [-0.060, 0.0425, 0.0130, 0.0145, 0.001], [-0.042, 0.0400, 0.0132, 0.0158, -0.001],
  [-0.022, 0.0360, 0.0130, 0.0165, -0.002], [-0.004, 0.0300, 0.0140, 0.0156, -0.001], [0.012, 0.0284, 0.0158, 0.0158, 0.0], [0.030, 0.0296, 0.0180, 0.0176, 0.0], [0.045, 0.0312, 0.0195, 0.0190, 0.0],
  [0.060, 0.0324, 0.0210, 0.0205, 0.0], [0.075, 0.0334, 0.0225, 0.0220, 0.0]];
const _pk = [0, 0, 0, 0];
function palmSec(z) { let i = 0; while (i < PK.length - 2 && z > PK[i + 1][0]) i++; const k0 = PK[Math.max(0, i - 1)], k1 = PK[i], k2 = PK[i + 1], k3 = PK[Math.min(PK.length - 1, i + 2)]; const h = k2[0] - k1[0]; const t = clamp((z - k1[0]) / h); const t2 = t * t, t3 = t2 * t;
  for (let c = 1; c < 5; c++) { const m1 = (k2[c] - k0[c]) / ((k2[0] - k0[0]) || 1) * h, m2 = (k3[c] - k1[c]) / ((k3[0] - k1[0]) || 1) * h; _pk[c - 1] = (2 * t3 - 3 * t2 + 1) * k1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[c] + (t3 - t2) * m2; } return _pk; }
const PALM_M = 16; const PALM_VS = (() => { const v = []; for (let k = 0; k <= PALM_M; k++) v.push(k / PALM_M * Math.PI); for (let k = 0; k <= PALM_M; k++) v.push(Math.PI + k / PALM_M * Math.PI); return v; })();
function palmFn(z, th, out) {
  const s = palmSec(z), a = s[0], bt = s[1], bb = s[2], cx = s[3]; const c = Math.cos(th), sn = Math.sin(th); const ex = 2 / 2.7; const xl = a * spow(c, ex);
  let x = cx + xl, y = (sn >= 0 ? bt : bb) * spow(sn, ex); const dors = Math.max(0, sn), pal = Math.max(0, -sn), dth = Math.acos(Math.min(1, Math.abs(c))); const xw = cx + xl;
  let d = 0;
  d += 0.0058 * pal * gs(xw + 0.021, 0.016) * gs(z + 0.030, 0.024); // thenar eminence
  d += 0.0032 * pal * gs(xw - 0.030, 0.011) * gs(z + 0.035, 0.022); // hypothenar
  d -= 0.0011 * pal * gs(xw - 0.004, 0.016) * gs(z + 0.046, 0.02); // palm hollow
  let kh = 0, tr = 0; for (const f of FING) { kh += gs(xw - f.mcp[0], 0.0062) * gs(z - (f.mcp[2] + 0.005), 0.0085); const xr = f.mcp[0] * clamp((0.005 - z) / 0.09); tr += gs(xw - xr, 0.0034); }
  d += dors * (0.0013 * kh + 0.0006 * tr * sm(-0.012, -0.05, z) * (1 - sm(-0.08, -0.09, z)));
  d += 0.0003 * gs(dth, 0.07) * sm(-0.09, -0.07, z) * (1 - sm(0.02, 0.05, z)); d -= 0.0001 * gs(dth - 0.16, 0.05) * sm(-0.09, -0.07, z) * (1 - sm(0.02, 0.05, z)); // side seam welt
  d += 0.0004 * (gs(z - 0.0765, 0.0008) * 0) + 0.00045 * gs(z - 0.0725, 0.0012) * sm(0.07, 0.074, z); // elastic cuff edge bead
  d += 0.00028 * (gs(z - 0.0255, 0.0007) + gs(z - 0.0145, 0.0007)) * dors; // gather seams across the back of the wrist
  return out.set(x + d * c, y + d * sn, z);
}
function palmWeights(z, th, p) { const tf = sm(0.004, 0.040, p.z); const tb = Math.max(0, -p.x - 0.012) / 0.02 * sm(0.0, -0.03, p.z) * sm(-0.07, -0.045, p.z) * (p.y < 0 ? 1 : 0.3); const tbc = Math.min(0.45, tb); return [[B.hand, (1 - tf) * (1 - tbc)], [B.fore, tf], [B.t1, (1 - tf) * tbc]]; }
function palmSurf() { return new Surf(palmFn, (z, out) => { const s = palmSec(z); return out.set(s[3], (s[1] - s[2]) * 0.5, z); }, palmWeights, { du: 3e-4, dv: 3e-3 }); }
function palmAttr(i, j, z, th, p) {
  const pal = j > PALM_M ? 1 : 0; const dors = 1 - pal; const cuff = sm(0.036, 0.05, z); const back = sm(-0.09, -0.07, z);
  const grip = pal * (0.55 * Math.exp(-(((p.x - 0.0) / 0.03) ** 2)) * gs(z + 0.055, 0.02) + 0.5 * gs(p.x + 0.02, 0.014) * gs(z + 0.03, 0.02)); // grip-point polish: thenar + finger-base line
  const wear = pal ? grip : 0.3 * dors * back * sm(-0.06, -0.09, z); const dirt = 0.25 + 0.35 * (1 - sm(-0.03, 0.03, z)) * dors + 0.2 * gs(p.x + 0.045, 0.01);
  const perf = pal ? clamp(gs(p.x - 0.031, 0.011) * gs(z + 0.034, 0.02) * 1.3 + gs(z + 0.0805, 0.0035) * gs(p.x, 0.032) * 1.0 + gs(p.x + 0.03, 0.014) * gs(z + 0.02, 0.012) * 0.9, 0, 1) : 0; const rib = cuff * (dors + pal) * 1; const ao = 1 - 0.25 * gs(z - 0.0145, 0.002) - 0.25 * gs(z - 0.0255, 0.002);
  return { z: [pal, 0, 0, 0], x: [wear, dirt, rib + perf, ao], j: [0, 0, 0, 0] };
}
// ------------------------------------------------------------------ build
export function buildGlove() {
  const gb = new GB(); const R = {}; R.fingers = [];
  // thumb frame (right hand)
  const dir = new V3(...THUMB.dir).normalize(), up0 = new V3(...THUMB.up); const Zt = dir.clone(); const Yt = up0.clone().addScaledVector(Zt, -up0.dot(Zt)).normalize(); const Xt = new V3().crossVectors(Yt, Zt); const frame = { X: Xt, Y: Yt, Z: Zt };
  const st = R.stats = []; const mark = (n) => st.push([n, gb.I.length / 3 | 0]);
  FING.forEach((F, fi) => R.fingers.push(buildDigit(gb, F, fi, false, null))); mark('fingers'); R.thumb = buildDigit(gb, THUMB, -1, true, frame); R.thumbFrame = frame; mark('thumb');
  const P = R.palm = palmSurf(); const zs = rowsFor(-0.095, 0.075, 0.0042, [[-0.084, 0.008, 0.0014], [0.0255, 0.003, 0.0011], [0.0145, 0.003, 0.0011], [0.0725, 0.003, 0.001]]).reverse();
  surfGrid(gb, P, zs, PALM_VS, (i, j, u, v, p) => { const a = palmAttr(i, j, u, v, p); a.c = [1, 1, 1]; return a; }, { cap: true });
  mark('palm'); overlays(gb, R, P); mark('overlays');
  return { gb, R };
}
const tprAttr = (wear = 0.4) => () => ({ c: COL.tpr, z: [0, 1, 0, 0], x: [wear, 0.3, 0, 0.9] });
function overlays(gb, R, P) {
  // ---- TPR knuckle plate across the four MCP heads (palm surface: u = z, v = angle)
  panel(gb, P, { uc: -0.0795, vc: 1.53, hu: 0.0148, hv: 0.98, p: 3.6, H: 0.0026, K: 32, prof: [[1.0, -0.0006], [0.99, 0.28], [0.955, 0.6], [0.9, 0.86], [0.8, 1.0], [0.55, 1.08], [0.25, 1.12]], attr: tprAttr(0.55), mu: 1, mv: 0.04 });
  const mk = (n) => R.stats.push([n, gb.I.length / 3 | 0]); mk('plate');
  // ---- accordion TPR segments on the proximal phalanges (3 per finger) + PIP cap
  R.fingers.forEach((S, fi) => { const F = FING[fi]; const j1 = F.len[0]; for (let k = 0; k < 2; k++) { const uc = 0.0105 + k * 0.0158 + (fi === 3 ? 0 : 0.001); const len = 0.0064; if (uc + len > j1 - 0.001) continue;
    panel(gb, S, { uc, vc: Math.PI / 2, hu: len, hv: 0.62, p: 4, H: 0.0013, K: 14, attr: tprAttr(0.5), mu: 1, mv: 0.01 }); } });
  mk('segments');
  // ---- palm pads (raised stitched foam pads) and thumb saddle: leather zone
  const leath = (wear) => () => ({ c: [1, 1, 1], z: [1, 0, 0, 0], x: [wear, 0.15, 0, 0.9] });
  panel(gb, P, { uc: -0.0605, vc: 4.71 - 0.0, hu: 0.0075, hv: 0.62, p: 3.4, H: 0.0011, K: 20, attr: leath(0.5), mu: 1, mv: 0.04, prof: [[1.0, -0.0004], [0.98, 0.4], [0.93, 0.85], [0.8, 1.0], [0.5, 1.06], [0.2, 1.1]] });
  panel(gb, P, { uc: -0.0605, vc: 4.71 - 0.9, hu: 0.0075, hv: 0.5, p: 3.4, H: 0.0011, K: 20, attr: leath(0.5), mu: 1, mv: 0.04, prof: [[1.0, -0.0004], [0.98, 0.4], [0.93, 0.85], [0.8, 1.0], [0.5, 1.06], [0.2, 1.1]] });
  panel(gb, P, { uc: -0.0605, vc: 4.71 + 0.9, hu: 0.0075, hv: 0.5, p: 3.4, H: 0.0011, K: 20, attr: leath(0.5), mu: 1, mv: 0.04, prof: [[1.0, -0.0004], [0.98, 0.4], [0.93, 0.85], [0.8, 1.0], [0.5, 1.06], [0.2, 1.1]] });
  mk('pads');
  const patch = (uc, vc, hu, hv, rot, wear) => { panel(gb, P, { uc, vc, hu, hv, p: 3.0, H: 0.0009, K: 26, rot, attr: leath(wear), mu: 1, mv: 0.04, prof: [[1.0, -0.0004], [0.98, 0.4], [0.93, 0.85], [0.8, 1.0], [0.5, 1.04], [0.2, 1.06]] });
    const o = []; const n = 10; for (let k = 0; k < n * 4; k++) { const t = k / (n * 4) * TAU; const a = spow(Math.cos(t), 2 / 3.0), b = spow(Math.sin(t), 2 / 3.0); const x = (hu + 0.0018) * a, y = (hv + 0.06) * b; o.push([uc + x * Math.cos(rot) - y * Math.sin(rot) * 0 , vc + y]); }
    stitchLine(gb, P, o, { closed: true, lift: 0.0001, col: COL.thread, pitch: 0.0030 }); };
  patch(-0.030, 4.03, 0.019, 0.42, 0, 0.7); patch(-0.040, 5.65, 0.016, 0.3, 0, 0.6); patch(-0.002, 4.71, 0.010, 0.55, 0, 0.5);
  // ---- velcro wrist strap (wraps ulnar side -> back -> radial side) + pull tab
  const us = []; for (let k = 0; k <= 10; k++) us.push(0.0205 + k / 10 * 0.0355); const vs = []; for (let k = 0; k <= 34; k++) vs.push(-0.75 + k / 34 * 4.55);
  const edge = (x, a, b, bev) => clamp(Math.min(x - a, b - x) / bev);
  surfGrid(gb, P, us, vs, (i, j, u, v) => { const onTail = v > 3.0; return { c: onTail ? COL.hook : COL.loop, z: [0, 0, onTail ? 2 : 1, 0], x: [0.15, 0.3, 0, 0.85], j: [0, 0, 0, 0] }; },
    { off: (u, v) => 0.0016 * Math.pow(edge(u, 0.0205, 0.056, 0.0016), 0.4) * Math.pow(edge(v, -0.75, 3.8, 0.12), 0.4) - 0.0003 });
  panel(gb, P, { uc: 0.0385, vc: 4.0, hu: 0.0085, hv: 0.2, p: 3.4, H: 0.0013, K: 26, attr: () => ({ c: COL.tab, z: [0, 0, 0, 1], x: [0.2, 0.3, 0, 0.9] }), mu: 1, mv: 0.04, hfn: (a, b) => 0.0035 * sm(-0.3, 1, b) });
  mk('strap');
  // ---- stitch rows
  const sw = { thread: COL.thread };
  const rect = (uc, vc, hu, hv, n = 8) => { const o = []; const q = (a, b) => o.push([uc + a * hu, vc + b * hv]); for (let k = 0; k < n; k++) q(-1 + 2 * k / n, -1); for (let k = 0; k < n; k++) q(1, -1 + 2 * k / n); for (let k = 0; k < n; k++) q(1 - 2 * k / n, 1); for (let k = 0; k < n; k++) q(-1, 1 - 2 * k / n); return o; };
  stitchLine(gb, P, rect(-0.0795, 1.53, 0.0148 + 0.0022, 0.98 + 0.05, 14), { closed: true, lift: 0.0002, col: COL.thread });
  for (const [vc, hv] of [[4.71, 0.62], [4.71 - 0.9, 0.5], [4.71 + 0.9, 0.5]]) stitchLine(gb, P, rect(-0.0605, vc, 0.0075 + 0.0018, hv + 0.06, 8), { closed: true, lift: 0.0001, col: COL.thread, pitch: 0.0034 });
  const ring = (z, v0 = 0, v1 = TAU, n = 60) => { const o = []; for (let k = 0; k <= n; k++) o.push([z, v0 + (v1 - v0) * k / n]); return o; };
  stitchLine(gb, P, ring(0.0195, -0.75, 3.8), { lift: 0.0002, col: COL.threadDk }); stitchLine(gb, P, ring(0.0565, -0.75, 3.8), { lift: 0.0002, col: COL.threadDk });
  stitchLine(gb, P, ring(0.0765, 0.03, TAU - 0.03), { lift: 0.0003, col: COL.thread, pitch: 0.0028 }); // cuff hem
  R.fingers.forEach((S, fi) => { const F = FING[fi]; const L = F.L, cs = L - 0.0165; stitchLine(gb, S, Array.from({ length: 41 }, (_, k) => [cs, k / 40 * TAU]), { closed: false, lift: 0.0001, col: COL.threadDk, pitch: 0.0030, len: 0.0019 });
    const j1 = F.len[0]; stitchLine(gb, S, rect(0.0195, Math.PI / 2, 0.0135, 0.84, 6), { closed: true, lift: 0.0001, col: COL.thread, pitch: 0.0034 }); });
  stitchLine(gb, R.thumb, Array.from({ length: 41 }, (_, k) => [THUMB.L - 0.0165, k / 40 * TAU]), { lift: 0.0001, col: COL.threadDk, pitch: 0.0030 });
}
export { rowsFor };
