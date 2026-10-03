// Anthropometric measuring helper (rest pose, in-engine). Slices the built LOD0 skin of a variant and compares girths / widths /
// lengths with a reference 1.75 m adult male (values from anthropometric surveys; the task brief's table):
//   head 0.23 tall / 0.155 wide / 0.19 deep · neck Ø 0.12 · biacromial 0.40, bideltoid 0.47-0.50 · chest breadth 0.32 / depth 0.24
//   (circ ≈ 1.00) · waist circ 0.85 · hip circ 1.00 · upper arm circ 0.30 (Ø 0.095) · forearm max Ø 0.085 · wrist Ø 0.055 ·
//   hand 0.19 × 0.085 · thigh (gluteal) Ø 0.185 · mid-thigh circ 0.54 · knee circ 0.38 · calf Ø 0.118 · ankle Ø 0.073 ·
//   foot 0.265 × 0.10 · crotch height 0.82 · shoulder height 1.43
import * as THREE from 'three';
import { RIG, BI } from './rig.js';
import { getVariantAssets, resolveVariant } from './factory.js';

export const REF = {
  headH: 0.23, headW: 0.155, headD: 0.19, neckCirc: 0.377, biacromial: 0.40, bideltoid: 0.485, chestW: 0.32, chestD: 0.24, chestCirc: 1.0,
  waistCirc: 0.85, hipCirc: 1.0, upperArmCirc: 0.30, forearmCirc: 0.267, wristCirc: 0.173, handL: 0.19, handW: 0.085,
  thighCirc: 0.58, midThighCirc: 0.54, kneeCirc: 0.38, calfCirc: 0.37, ankleCirc: 0.229, footL: 0.265, footW: 0.10, crotchH: 0.82, shoulderH: 1.43,
};
const V = THREE.Vector3;
function hullPerimeter(pts) { // 2D convex hull (monotone chain) perimeter
  if (pts.length < 3) return 0; const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1)); let L = 0; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; L += Math.hypot(a[0] - b[0], a[1] - b[1]); } return L;
}
/** measure a variant's bare body (skin + everything, LOD0, look 0). Returns {rows:[{k, v, ref, err}], raw} */
export function measureVariant(id = 'debug_body', look = 0) {
  const def = resolveVariant(id); const a = getVariantAssets(def); const g = a.geos[Math.min(look, a.geos.length - 1)]; const G = g.geometry, L0 = g.lods[0];
  const P = G.attributes.position.array, SI = G.attributes.skinIndex.array, SW = G.attributes.skinWeight.array, IDX = G.index.array;
  const dom = (v) => { let b = 0, w = -1; for (let k = 0; k < 4; k++) if (SW[v * 4 + k] > w) { w = SW[v * 4 + k]; b = SI[v * 4 + k]; } return b; };
  // slice: intersect LOD0 triangle edges with a plane (point c, normal n); keep hits within `rad` of c (and filter fn); return 2D coords
  const slice = (c, n, rad, filt = null) => {
    const e1 = Math.abs(n.y) < 0.9 ? new V(0, 1, 0).cross(n).normalize() : new V(1, 0, 0).cross(n).normalize(), e2 = new V().crossVectors(n, e1);
    const out = []; const pa = new V(), pb = new V(), hit = new V();
    for (let i = L0.start; i < L0.start + L0.count; i += 3) for (let k = 0; k < 3; k++) {
      const ia = IDX[i + k], ib = IDX[i + ((k + 1) % 3)]; pa.fromArray(P, ia * 3); pb.fromArray(P, ib * 3);
      const da = pa.clone().sub(c).dot(n), db = pb.clone().sub(c).dot(n); if (da * db > 0 || da === db) continue;
      hit.copy(pa).lerp(pb, da / (da - db)); const r = hit.clone().sub(c); if (r.length() > rad) continue; if (filt && !filt(hit, ia)) continue;
      out.push([r.dot(e1), r.dot(e2)]);
    }
    return out;
  };
  const circ = (c, n, rad, filt) => hullPerimeter(slice(c, n, rad, filt));
  const ext = (pts, ax) => { let lo = 1e9, hi = -1e9; for (const p of pts) { lo = Math.min(lo, p[ax]); hi = Math.max(hi, p[ax]); } return hi - lo; };
  const up = new V(0, 1, 0); const bone = (n, t) => { const b = RIG.bones[BI[n]]; return b.pos.clone().lerp(b.tail, t); }; const axis = (n) => { const b = RIG.bones[BI[n]]; return b.tail.clone().sub(b.pos).normalize(); };
  const torso = (y) => (h) => Math.abs(h.x) < 0.205 && Math.abs(h.y - y) < 0.01;
  // chest at the nipple line, waist = narrowest between 0.98 and 1.15, hips = widest between 0.84 and 0.98
  let waist = 1e9, wy = 0; for (let y = 0.98; y <= 1.16; y += 0.01) { const c = circ(new V(0, y, 0.01), up, 0.3, torso(y)); if (c > 0.3 && c < waist) { waist = c; wy = y; } }
  let hip = 0, hy = 0; for (let y = 0.84; y <= 0.98; y += 0.01) { const c = circ(new V(0, y, 0.01), up, 0.3, (h) => Math.abs(h.y - y) < 0.01 && Math.abs(h.x) < 0.22); if (c > hip) { hip = c; hy = y; } }
  const chestPts = slice(new V(0, 1.27, 0.01), up, 0.3, torso(1.27));
  // head bounds (head / jaw dominated vertices), hand & foot bounds
  const hb = [BI.head, BI.jaw]; let hmin = new V(1e9, 1e9, 1e9), hmax = new V(-1e9, -1e9, -1e9); const handPts = [], footPts = [];
  const nv = P.length / 3; const isHand = new Set(), isFoot = new Set(); for (const b of RIG.bones) { if (/^(hand|index|middle|ring|pinky|thumb)/.test(b.name) && b.name.endsWith('.R')) isHand.add(b.index); if (/^(foot|toe)/.test(b.name) && b.name.endsWith('.R')) isFoot.add(b.index); }
  let hwA = 1e9, hw1b = -1e9, hd0 = 1e9, hd1 = -1e9; for (let v = 0; v < nv; v++) { const d = dom(v); const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (hb.includes(d) && y > 1.5) { hmin.min(new V(x, y, z)); hmax.max(new V(x, y, z)); if (Math.abs(y - 1.712) < 0.012) { hwA = Math.min(hwA, x); hw1b = Math.max(hw1b, x); } if (Math.abs(y - 1.675) < 0.01 && Math.abs(x) < 0.03) { hd0 = Math.min(hd0, z); hd1 = Math.max(hd1, z); } } if (isHand.has(d)) handPts.push(new V(x, y, z)); if (isFoot.has(d) && y < 0.12) footPts.push([x, z]); }
  const A = RIG.arm.R; const hAx = new V(...A.h), hW = new V(...A.t), wr = new V(...A.wr); let hl = 0, hw0 = 1e9, hw1 = -1e9; for (const p of handPts) { const r = p.clone().sub(wr); hl = Math.max(hl, r.dot(hAx)); const s = r.dot(hW); if (r.dot(hAx) > 0.03 && r.dot(hAx) < 0.1) { hw0 = Math.min(hw0, s); hw1 = Math.max(hw1, s); } }
  let bidel = 0; for (let v = 0; v < nv; v++) { const y = P[v * 3 + 1]; if (y > 1.37 && y < 1.42) bidel = Math.max(bidel, Math.abs(P[v * 3])); }
  let crotch = 1e9; for (let v = 0; v < nv; v++) { const x = P[v * 3], y = P[v * 3 + 1]; if (Math.abs(x) < 0.015 && y > 0.6 && y < 1.0 && dom(v) !== BI['thigh.L'] && dom(v) !== BI['thigh.R']) crotch = Math.min(crotch, y); }
  let shH = 0; for (let v = 0; v < nv; v++) { const x = Math.abs(P[v * 3]); if (x > 0.16 && x < 0.2) shH = Math.max(shH, P[v * 3 + 1]); }
  const m = {
    headH: hmax.y - hmin.y, headW: hw1b - hwA, headD: hd1 - hd0,
    neckCirc: circ(new V(0, 1.53, 0.024), up, 0.09, (h, i) => Math.abs(h.y - 1.53) < 0.01 && Math.abs(h.x) < 0.075 && !hb.includes(dom(i))),
    biacromial: 2 * 0.178 + 0.04, bideltoid: 2 * bidel, chestW: ext(chestPts, 1), chestD: ext(chestPts, 0), chestCirc: hullPerimeter(chestPts),
    waistCirc: waist, hipCirc: hip,
    upperArmCirc: circ(bone('upperarm.R', 0.5), axis('upperarm.R'), 0.1), forearmCirc: circ(bone('forearm.R', 0.25), axis('forearm.R'), 0.09), wristCirc: circ(bone('forearm.R', 0.96), axis('forearm.R'), 0.07),
    handL: hl, handW: hw1 - hw0,
    thighCirc: circ(bone('thigh.R', 0.12), axis('thigh.R'), 0.15, (h) => h.x > 0.0), midThighCirc: circ(bone('thigh.R', 0.5), axis('thigh.R'), 0.13), kneeCirc: circ(bone('thigh.R', 0.99), axis('thigh.R'), 0.1),
    calfCirc: circ(bone('calf.R', 0.3), axis('calf.R'), 0.1), ankleCirc: circ(bone('calf.R', 0.9), axis('calf.R'), 0.08),
    footL: footPts.length ? ext(footPts, 1) : 0, footW: footPts.length ? ext(footPts, 0) : 0, crotchH: crotch, shoulderH: shH,
  };
  const rows = Object.keys(REF).map((k) => ({ k, v: +m[k].toFixed(3), ref: REF[k], err: +(((m[k] - REF[k]) / REF[k]) * 100).toFixed(1) }));
  return { rows, waistY: wy, hipY: hy, tris: g.tris };
}
