// Bare forearm (skin: wrist gap between the glove cuff and the pushed-up sleeve) and the field-jacket sleeve: two-turn rolled cuff with real
// hem thickness, compression folds above the roll, diagonal drape folds, sag, topstitch rows and a cuff tab + button.
import * as THREE from 'three';
import { GB, Surf, surfGrid, panel, stitchLine, clamp, sm, lerp, gs, spow, TAU, lin } from './kit.js';
import { B, FORE } from './anat.js';
import { rowsFor } from './glove.js';

const V3 = THREE.Vector3;
const smax = (a, b, k) => { const h = clamp(0.5 + 0.5 * (a - b) / k); return lerp(b, a, h) + k * h * (1 - h); };

// ------------------------------------------------------------------ forearm skin
const skinA = (z) => 0.0272 + 0.0105 * sm(0, 0.25, z), skinB = (z) => 0.0190 + 0.0085 * sm(0, 0.25, z);
function skinFn(z, th, out) {
  const c = Math.cos(th), sn = Math.sin(th); const a = skinA(z), b = skinB(z); const ex = 2 / 2.3; let x = a * spow(c, ex), y = b * spow(sn, ex);
  const dors = Math.max(0, sn), pal = Math.max(0, -sn); let d = 0;
  for (const xt of [-0.0105, -0.0035, 0.0035, 0.0105]) d += 0.0005 * dors * gs(x - xt * (1 + 0.5 * sm(0.05, 0.2, z)), 0.0034) * sm(0.04, 0.09, z) * (1 - sm(0.13, 0.19, z)); // extensor tendons
  d += 0.0007 * dors * gs(x + 0.02, 0.008) * sm(0.05, 0.2, z) - 0.0006 * dors * gs(x - 0.002, 0.007) * sm(0.08, 0.2, z); // brachioradialis / ulna groove
  d += 0.0012 * pal * sm(0.08, 0.22, z) * gs(x, 0.02); d += 0.0011 * gs(z - 0.03, 0.012) * dors * gs(x - 0.02, 0.008); // flexor mass, ulnar head
  return out.set(x + d * c, y + d * sn, z);
}
const skinW = (z) => { const t = sm(0.004, 0.040, z); return [[B.hand, 1 - t], [B.fore, t]]; };
export function buildSkin() {
  const gb = new GB(); const S = new Surf(skinFn, (z, out) => out.set(0, 0, z), (z) => skinW(z), { du: 3e-4, dv: 4e-3 });
  const zs = rowsFor(0.045, 0.19, 0.0075, []); const vs = []; const K = 36; for (let k = 0; k <= K; k++) vs.push(k / K * TAU);
  surfGrid(gb, S, zs, vs, (i, j, z, th) => { const dors = Math.max(0, Math.sin(th)); return { c: [1, 1, 1], z: [0, 0, 0, 0], x: [0.1, 0.2 + 0.3 * sm(0.1, 0.19, z), 0, 1 - 0.35 * sm(0.14, 0.19, z)], j: [0, 0, 0, 0] }; }, { cap: false });
  return { gb, S };
}

// ------------------------------------------------------------------ sleeve
const HEM = 0.108;
const roll = (z, zc, hh, amp) => { const x = Math.abs((z - zc) / hh); return x >= 1 ? 0 : amp * Math.pow(1 - Math.pow(x, 3.4), 1 / 3.4); };
function sleeveFn(z, th, out) {
  const c = Math.cos(th), sn = Math.sin(th);
  const r1 = roll(z, 0.1265, 0.0192, 0.0268), r2 = roll(z, 0.1635, 0.0192, 0.0278); const loose = (0.0100 + 0.0100 * sm(0.20, 0.34, z) + 0.006 * sm(0.34, 0.5, z) + 0.003 * sm(0.5, 0.62, z)) * sm(0.15, 0.19, z);
  let T = smax(smax(r1, r2, 0.0025), loose, 0.004);
  // roll irregularity + wrinkles, compression folds above the roll, diagonal drape folds, sag, elbow bunching
  const inRoll = sm(0.104, 0.112, z) * (1 - sm(0.18, 0.2, z));
  let d = inRoll * (0.0018 * Math.sin(th * 3 + 1.1) + 0.0011 * Math.sin(th * 9 + z * 150 + 2.0) + 0.0007 * Math.sin(th * 15 - z * 90));
  d += 0.0035 * sm(0.175, 0.19, z) * (1 - sm(0.27, 0.36, z)) * (0.5 + 0.5 * Math.sin(z * 235 + 1.9 * Math.sin(th * 2 + 0.6) + th)) * (0.6 + 0.4 * Math.sin(th * 3.7));
  d += 0.0048 * Math.sin(3 * th + z * 38 + 0.7) * sm(0.19, 0.25, z) * (1 - sm(0.42, 0.58, z)) + 0.0025 * Math.sin(5 * th - z * 51 + 2.1) * sm(0.2, 0.26, z) * (1 - sm(0.4, 0.5, z));
  d += 0.0075 * Math.max(0, -sn) * sm(0.19, 0.32, z) + 0.004 * Math.sin(th * 3 + z * 23) * Math.exp(-(((z - FORE) / 0.05) ** 2)) + 0.0015 * Math.sin(th * 7 + z * 70) * sm(0.2, 0.3, z);
  T = Math.max(0.0022, T + d * clamp(T / 0.012));
  const a = skinA(z) + T, b = skinB(z) + T * 0.97; const ex = 2 / 2.2;
  return out.set(a * spow(c, ex), b * spow(sn, ex), z);
}
const sleeveW = (z) => { const t = sm(FORE - 0.05, FORE + 0.03, z); return [[B.fore, 1 - t], [B.upper, t]]; };
export function buildSleeve() {
  const gb = new GB(); const S = new Surf(sleeveFn, (z, out) => out.set(0, 0, z), (z) => sleeveW(z), { du: 3e-4, dv: 4e-3 });
  const zs = rowsFor(0.1, 0.3, 0.0092, [[HEM + 0.001, 0.006, 0.0009], [0.1265, 0.02, 0.0034], [0.1445, 0.004, 0.0011], [0.1625, 0.02, 0.0034], [0.181, 0.006, 0.0011]]); for (let z = 0.3 + 0.018; z < 0.62; z += 0.032) zs.push(z); zs.push(0.62);
  const K = 40; const vs = []; for (let k = 0; k <= K; k++) vs.push(-Math.PI / 2 + k / K * TAU);
  surfGrid(gb, S, zs, vs, (i, j, z, th) => { const lip = 1 - sm(0.106, 0.116, z); const inside = sm(0.108, 0.11, z) * 0; const e = 1 - sm(0.104, 0.108, z); const wear = 0.5 * lip + 0.2 * Math.max(0, -Math.sin(th)); const dirt = 0.25 + 0.4 * lip + 0.25 * gs(z - FORE, 0.06) + 0.2 * (1 - sm(0.1, 0.3, z)) * 0;
    const tone = 1 - 0.1 * lip; return { c: [tone, tone, tone * 0.98], z: [0, 0, 0, 0], x: [wear, dirt, 0, 1 - 0.3 * gs(z - 0.1445, 0.003) - 0.3 * gs(z - 0.181, 0.004) - 0.4 * e], j: [0, 0, 0, 0] }; }, { cap: true });
  // topstitch: two rows on roll 1, one on roll 2, one at the hem lip
  const ring = (z, n = 70) => { const o = []; for (let k = 0; k <= n; k++) o.push([z, -Math.PI / 2 + 0.05 + (TAU - 0.1) * k / n]); return o; };
  const thr = lin(0x8a8163); stitchLine(gb, S, ring(0.117), { lift: 0.0002, col: thr, pitch: 0.0041, len: 0.0030, w: 0.0007, h: 0.0005 }); stitchLine(gb, S, ring(0.1215), { lift: 0.0002, col: thr, pitch: 0.0041, len: 0.0030, w: 0.0007, h: 0.0005 });
  stitchLine(gb, S, ring(0.1725), { lift: 0.0002, col: lin(0x7d765b), pitch: 0.0043, len: 0.0031, w: 0.0007, h: 0.0005 });
  // cuff tab with button on the outer (ulnar) side of the roll
  panel(gb, S, { uc: 0.1265, vc: 0.55, hu: 0.0085, hv: 0.16, p: 3.2, H: 0.0018, K: 18, attr: () => ({ c: [0.95, 0.95, 0.9], z: [0, 0, 0, 0], x: [0.35, 0.3, 0, 0.9] }), mu: 1, mv: 0.05 });
  stitchLine(gb, S, (() => { const o = []; const n = 6; const q = (a, b) => o.push([0.1265 + a * 0.0105, 0.55 + b * 0.19]); for (let k = 0; k < n; k++) q(-1 + 2 * k / n, -1); for (let k = 0; k < n; k++) q(1, -1 + 2 * k / n); for (let k = 0; k < n; k++) q(1 - 2 * k / n, 1); for (let k = 0; k < n; k++) q(-1, 1 - 2 * k / n); return o; })(), { closed: true, lift: 0.0002, col: thr, pitch: 0.0034 });
  panel(gb, S, { uc: 0.1265, vc: 0.55, hu: 0.0056, hv: 0.115, p: 2.0, H: 0.0025, K: 16, prof: [[1.0, -0.0004], [0.97, 0.5], [0.85, 0.9], [0.6, 1.0], [0.25, 0.9]], attr: () => ({ c: lin(0x4a4536), z: [0, 0, 0, 1], x: [0.3, 0.2, 0, 0.9] }), mu: 1, mv: 0.05 });
  return { gb, S };
}
export function buildArmParts() {
  return { skin: buildSkin().gb, sleeve: buildSleeve().gb };
}
