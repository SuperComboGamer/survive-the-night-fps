// Hair as GEOMETRY: tapered ribbon strands ("cards", 2–3 mm wide) rooted on the sampled head surface, combed from a crown whorl,
// falling with gravity and kept off the skull / ears by the head SDF. Scalp hair, brows, beard, moustache, sideburns and eyelashes are all
// emitted into the zombie's single skinned mesh (zero extra draw calls). Strands carry their TANGENT in the normal attribute: the shader
// (skinshade.js id 6) builds a view-facing cylinder normal from it and adds a two-lobe Kajiya-Kay highlight in the light loop.
// Each ribbon is emitted double-sided (shared vertices, two windings). Scalp strands live in REG.hair (hidden while headwear is worn,
// see shading.js: also hidden by a head pop), beard / brows / lashes in the head region. LOD0 ≈ 1100 scalp cards + 700 beard cards,
// LOD1 ≈ 250 fat cards, LOD2 none (painted scalp in the shader).
import * as THREE from 'three';
import { BI } from './rig.js';
import { matSpec, REG } from './mesh.js';
import { HEAD_CENTER } from './rig.js';
import { sdEll } from './face.js';
import { mulberry, zt } from './mouth.js';
import { headWeights, SPLIT } from './head.js';

const V = THREE.Vector3;
const C = HEAD_CENTER;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const LEN = { crop: 0.024, short: 0.038, medium: 0.07, long: 0.11, bald: 0 };

/** style of the scalp hair for this look (variant `hair.style`, or derived from the variant seed) */
function pickStyle(def, rr) {
  const h = def.hair || {}; if (h.bald) return 'bald'; if (h.style) return h.style;
  const w = def.layers?.wet ?? 0; if (w > 0.6) return 'matted'; const r = rr(); return r < 0.5 ? 'crop' : r < 0.82 ? 'short' : r < 0.95 ? 'medium' : 'long';
}
export function buildHair(...a) { const t0 = performance.now(); try { return buildHair0(...a); } finally { zt('hair', t0); } }
function buildHair0(o, hi, fp, opts = {}) {
  const lod = o.lod; if (lod >= 2) return; if (hi.a0 !== undefined) SPLIT.a0 = hi.a0; const buf = o.buf; const def = o.variant || {}; const hd = { ...(def.hair || {}), ...(o._hairStyle || {}) };
  const rr = mulberry(0x9e3779b1 ^ (fp.brow * 1e4 | 0) ^ (fp.jaw * 7e3 | 0) ^ (fp.nose * 3e3 | 0) ^ ((def.id || '').length * 977));
  const f = hi.sdf, G = hi.grid; const col = hd.color ?? 0x1a1512; const amount = hd.amount ?? 0.8; const style = pickStyle(def, rr); const wet = def.layers?.wet ?? 0;
  const grey = Math.max(0, Math.min(1, (fp.age - 0.45) * 1.4)) * (hd.grey ?? 1);
  const cR = (col >> 16) & 255, cG = (col >> 8) & 255, cB = col & 255;
  const specFor = (t) => matSpec({ mat: 'hair', color: t, rough: 0.5, wear: 0.3, dirt: 0.4 });
  const bank = []; for (let k = 0; k < 6; k++) { const v = 0.62 + k * 0.14; const g = Math.min(0.4, grey) * (k >= 4 ? 0.6 : 0.04) * rr(); let r = cR * v, gg = cG * v, b = cB * v; r += (176 - r) * g; gg += (172 - gg) * g; b += (166 - b) * g; bank.push(matSpec({ mat: 'hair', color: (Math.min(255, r) << 16) | (Math.min(255, gg) << 8) | Math.min(255, b), rough: 0.5, wear: 0.3, dirt: 0.4 })); }
  void specFor;
  const earC = [new V(0.0745, -0.027, 0.02), new V(-0.0745, -0.027, 0.02)];
  const sdfAll = (x, y, z) => { let d = f(x, y, z); for (const e of earC) d = Math.min(d, sdEll(x, y, z, e.x, e.y, e.z, 0.014, 0.034, 0.022)); return d; };
  const grad = (x, y, z, out) => { const e = 0.0007; out.set(sdfAll(x + e, y, z) - sdfAll(x - e, y, z), sdfAll(x, y + e, z) - sdfAll(x, y - e, z), sdfAll(x, y, z + e) - sdfAll(x, y, z - e)).normalize(); return out; };
  const gv = new V(), tmpA = new V(), tmpB = new V(), tmpC = new V();
  const gridPt = (i, j, u, v, outP, outN) => { // bilinear point / normal on the sampled head surface
    const nT = G.nT, nP = G.nP; const i1 = (i + 1) % nT, j1 = Math.min(nP - 1, j + 1); const P = G.pos, N = G.nrm;
    const a = P[j * nT + i], b = P[j * nT + i1], c = P[j1 * nT + i1], d = P[j1 * nT + i]; const na = N[j * nT + i], nb = N[j * nT + i1], nc = N[j1 * nT + i1], nd = N[j1 * nT + i];
    outP.set(0, 0, 0).addScaledVector(a, (1 - u) * (1 - v)).addScaledVector(b, u * (1 - v)).addScaledVector(c, u * v).addScaledVector(d, (1 - u) * v);
    outN.set(0, 0, 0).addScaledVector(na, (1 - u) * (1 - v)).addScaledVector(nb, u * (1 - v)).addScaledVector(nc, u * v).addScaledVector(nd, (1 - u) * v).normalize();
  };
  const whorl = new V(0.006 * (rr() - 0.5) * 2, 0.084, 0.03 + 0.01 * rr()), partSide = rr() < 0.5 ? -1 : 1, partAmt = 0.25 + rr() * 0.5;
  const receding = Math.max(0, Math.min(1, (hd.hairline ?? 0.3) * 0.0 + (1 - (hd.hairline ?? 0.3)) * 0.5 + (fp.age - 0.5) * 0.6));
  const cand = []; // grid cells by region
  const P = new V(), Nn = new V();
  let made = 0, triBudget = lod === 0 ? 1 : 0.22;

  /** emit one ribbon strand / card. pts: V[]; widths: number[]; region: REG id. card=true: the shader cuts sub-strands out of the ribbon (mat2.x = across u, .y = along v, .z = card id, .w = 255) */
  const strand = (pts, widths, w, spec, region, ao0 = 0.55, card = false) => {
    const n = pts.length; const ids = []; const tan = new V(), side = new V(), out = new V(); const cid = (rr() * 255) | 0;
    const mk = (u, v) => ({ ...spec, mat2: [Math.round((u * 0.5 + 0.5) * 255), Math.round(v * 255), cid, card ? 255 : 0] });
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)]; tan.subVectors(b, a); if (tan.lengthSq() < 1e-12) tan.set(0, -1, 0); tan.normalize();
      out.copy(pts[k]).sub(tmpC.set(0, -0.01, 0.01)).normalize(); side.crossVectors(tan, out); if (side.lengthSq() < 1e-8) side.set(1, 0, 0); side.normalize();
      const hw = widths[k] * 0.5; const ao = ao0 + (1 - ao0) * (k / (n - 1)); const v = k / (n - 1); const p = pts[k];
      const l = buf.vert([p.x + C.x + side.x * hw, p.y + C.y + side.y * hw, p.z + C.z + side.z * hw], tan, w, mk(-1, v), ao, region);
      const r = hw > 1e-5 ? buf.vert([p.x + C.x - side.x * hw, p.y + C.y - side.y * hw, p.z + C.z - side.z * hw], tan, w, mk(1, v), ao, region) : l; ids.push([l, r]);
    }
    for (let k = 0; k < n - 1; k++) { const [l0, r0] = ids[k], [l1, r1] = ids[k + 1]; if (r1 === l1) { buf.tri(l0, r0, l1); buf.tri(l0, l1, r0); } else { buf.quad(l0, r0, r1, l1); buf.quad(l0, l1, r1, r0); } }
    made++;
  };
  const wHead = (p) => { const hw = headWeights(p); return [[BI.head, hw.head], [BI.jaw, hw.jaw], [BI.neck, hw.neck]]; };

  // ------------------------------------------------------------------ scalp: wide cards, sub-strands cut out in the shader
  if (style !== 'bald' && amount > 0.02) {
    const L0 = (hd.length ?? LEN[style] ?? 0.04) * (style === 'matted' ? 1.1 : 1); const stiff = { crop: 0.62, short: 0.5, medium: 0.3, long: 0.18, matted: 0.1, combed: 0.35 }[style] ?? 0.4;
    const gk = { crop: 0.15, short: 0.3, medium: 0.85, long: 1.3, matted: 1.6, combed: 0.6 }[style] ?? 0.5;
    const nStr = Math.round((lod === 0 ? 640 : 110) * Math.min(1, 0.3 + amount * 0.8) * (style === 'crop' ? 1.15 : style === 'long' ? 0.85 : 1)); const width0 = (lod === 0 ? 0.0062 : 0.0115) * (style === 'matted' ? 1.35 : 1);
    const segsBase = lod === 0 ? (L0 > 0.08 ? 5 : L0 > 0.03 ? 4 : 3) : 2;
    const hairY = (th) => { const at = Math.abs(th); let y = 0.049 + receding * 0.03 - smooth(0.25, 0.95, at) * (0.062 - receding * 0.05); if (at > 1.25) y = Math.min(y, -0.026 - smooth(1.6, 3.0, at) * 0.058); return y; };
    let tries = 0;
    while (made < nStr && tries++ < nStr * 10) {
      const i = (rr() * G.nT) | 0, j = (rr() * (G.nP - 2)) | 0; gridPt(i, j, rr(), rr(), P, Nn); if (P.z > 0.08) continue;
      const th = Math.atan2(P.x, -P.z); if (P.y < hairY(th)) continue;
      if (hd.bald && Math.hypot(P.x, P.z - 0.02) < 0.05 && P.y > 0.06) continue; // bald crown patch
      if (rr() < receding * 0.5 * smooth(0.02, 0.09, P.y) * (Math.abs(th) < 1.2 ? 1 : 0.2)) continue; // thinning where receding / old
      const ck = ((Math.floor(P.x / 0.012) * 73856093) ^ (Math.floor(P.y / 0.012) * 19349663) ^ (Math.floor(P.z / 0.012) * 83492791)) >>> 0; const cr = mulberry(ck); const cA = cr() - 0.5, cB2 = cr() - 0.5, cL = 0.8 + 0.4 * cr();
      // comb direction: radial from the crown whorl, falling down the sides / back; the front is combed up-and-back (or to the part side)
      tmpA.copy(P).sub(whorl); const radial = tmpA.clone().addScaledVector(Nn, -tmpA.dot(Nn)).normalize();
      const down = new V(0, -1, 0).addScaledVector(Nn, Nn.y).normalize(); const wDown = smooth(0.06, -0.005, P.y) * (0.55 + 0.45 * Math.min(1.5, gk));
      const frontW = smooth(-0.04, -0.075, P.z) * smooth(0.0, 0.05, P.y); const comb = new V(partSide * partAmt * 0.9, 0.35, 0.85); comb.addScaledVector(Nn, -comb.dot(Nn)).normalize();
      const d0 = new V().addScaledVector(radial, 1 - wDown).addScaledVector(down, wDown); d0.lerp(comb, frontW * (style === 'matted' || style === 'long' ? 0.5 : 0.9)); d0.x += cA * 0.5; d0.z += cB2 * 0.5; d0.addScaledVector(Nn, -d0.dot(Nn)).normalize();
      let len = L0 * (0.65 + 0.7 * rr()) * cL * (P.y > 0.05 ? 1.0 : (style === 'crop' || style === 'short' ? 0.55 : 0.9)); len *= 1 + smooth(0.0, 0.06, P.z) * 0.15 * (style === 'medium' || style === 'long' ? 1 : 0); len = Math.min(0.11, len);
      const segs = Math.max(2, Math.min(segsBase, Math.ceil(len / 0.016))); const pts = [P.clone()]; const step = len / segs; const dir = new V().copy(d0).multiplyScalar(1 - stiff * 0.5).addScaledVector(Nn, stiff).normalize();
      const ph = rr() * 6.28, waves = (style === 'matted' ? 0.2 : 1) * 0.45 * (rr() - 0.35);
      for (let k = 1; k <= segs; k++) {
        const t = k / segs; const cur = pts[k - 1];
        dir.lerp(d0, 0.3).addScaledVector(gv.set(0, -1, 0), gk * 0.5 * t * t); dir.x += Math.sin(t * 5 + ph) * waves * 0.3; dir.z += Math.cos(t * 4 + ph) * waves * 0.22; dir.normalize();
        const np = cur.clone().addScaledVector(dir, step); const s = sdfAll(np.x, np.y, np.z); const clr = 0.0009 + 0.004 * t * (style === 'crop' ? 0.4 : 1); if (s < clr) { grad(np.x, np.y, np.z, tmpB); np.addScaledVector(tmpB, clr - s); dir.addScaledVector(tmpB, 0.25).normalize(); }
        pts.push(np);
      }
      const wArr = pts.map((_, k) => width0 * (1 - 0.55 * Math.pow(k / (pts.length - 1), 1.4)) * (0.8 + 0.4 * cr()));
      const lowHair = P.y < -0.005 && Math.abs(th) > 1.0; const region = lowHair ? -1 : REG.hair; const spec = bank[Math.min(5, Math.floor(rr() * 6))];
      strand(pts, wArr, wHead(P), spec, region, 0.5, true);
    }
  }
  // ------------------------------------------------------------------ brows (0..1 amount): short strands along the brow ridge, growing up-and-out
  const browAmt = hd.brows ?? 1;
  if (browAmt > 0.05 && lod === 0) {
    for (const sx of [-1, 1]) {
      const n = Math.round(46 * browAmt * (0.75 + 0.5 * rr())); const gap = rr() < 0.35 ? [0.3 + rr() * 0.5, 0.05 + rr() * 0.1] : null;
      for (let k = 0; k < n; k++) {
        const t = rr(); if (gap && Math.abs(t - gap[0]) < gap[1]) continue; const x = 0.010 + t * 0.043; const yc = 0.0025 + 0.0045 * Math.sin(t * 2.4) - t * 0.004 + (rr() - 0.5) * 0.0052 * (1.2 - t * 0.6);
        // surface z at (x, y): bisect the head SDF along z
        let lo = -0.14, hi2 = 0.0; for (let it = 0; it < 14; it++) { const m = (lo + hi2) * 0.5; if (f(sx * x, yc, m) > 0) lo = m; else hi2 = m; } const z = (lo + hi2) * 0.5; const p0 = new V(sx * x, yc, z - 0.0002);
        const dirv = new V(sx * (0.55 + 0.4 * t), 0.5 - 0.5 * t + 0.25, -0.15).normalize(); const len = (0.0065 + 0.004 * (1 - t)) * (0.7 + 0.6 * rr());
        grad(p0.x, p0.y, p0.z, tmpB); dirv.addScaledVector(tmpB, 0.35).normalize(); const p1 = p0.clone().addScaledVector(dirv, len * 0.5).addScaledVector(tmpB, 0.0009), p2 = p0.clone().addScaledVector(dirv, len).addScaledVector(tmpB, 0.0006);
        strand([p0, p1, p2], [0.0007, 0.0006, 0.00012], wHead(p0), bank[1 + Math.floor(rr() * 3)], -1, 0.75);
      }
    }
  }
  // ------------------------------------------------------------------ beard / moustache / sideburns (per look chances)
  const fc = def.facial || {}; const beard = hd.beard ?? 0.5; const moust = rr() < (fc.moustache ?? 0.3); const sideb = rr() < (fc.sideburns ?? 0.25);
  const nB = lod === 0 ? Math.round(520 * Math.max(0, beard - 0.28) * 1.4) : lod === 1 ? Math.round(160 * Math.max(0, beard - 0.28)) : 0;
  const lipOpen = (p) => Math.abs(p.x) < 0.027 && Math.abs(p.y + 0.0892) < 0.0075 && p.z < -0.085;
  const beardZone = (p) => p.y < -0.05 - smooth(0.0, 0.05, Math.abs(p.x)) * 0.006 && p.y > -0.145 && Math.abs(p.x) < 0.074 && p.z < 0.02 && p.z > -0.118 && !(Math.abs(p.x) < 0.03 && p.y > -0.062 && p.z < -0.09);
  const mustZone = (p) => Math.abs(p.x) < 0.025 && p.y > -0.0865 && p.y < -0.0745 && p.z < -0.088;
  const sideZone = (p) => Math.abs(p.x) > 0.058 && p.y > -0.055 && p.y < 0.006 && p.z > -0.05 && p.z < 0.004;
  const emitHair = (zoneFn, count, lenR, wid, downK, sideK, region, card = false) => {
    let m0 = made, tries = 0; while (made - m0 < count && tries++ < count * 14) {
      const i = (rr() * G.nT) | 0, j = (rr() * (G.nP - 2)) | 0; gridPt(i, j, rr(), rr(), P, Nn); if (!zoneFn(P) || lipOpen(P)) continue;
      const len = lenR[0] + (lenR[1] - lenR[0]) * rr(); const segs = lod === 0 ? (len > 0.02 ? 4 : 3) : 2; const step = len / segs; const pts = [P.clone()];
      const dir = new V().copy(Nn).multiplyScalar(0.16).add(gv.set(Math.sign(P.x) * sideK * (rr() - 0.3), -downK, -0.35 * downK)).normalize(); const curl = (rr() - 0.5) * 0.5;
      for (let k = 1; k <= segs; k++) { const np = pts[k - 1].clone().addScaledVector(dir, step); const s = sdfAll(np.x, np.y, np.z); const clr = 0.0007 + 0.0022 * k / segs; if (s < clr) { grad(np.x, np.y, np.z, tmpB); np.addScaledVector(tmpB, clr - s); dir.addScaledVector(tmpB, 0.3); } dir.y -= downK * 0.2; dir.x += curl * 0.35; dir.normalize(); pts.push(np); }
      const spec = bank[Math.min(5, Math.floor(rr() * 6))]; strand(pts, pts.map((_, k) => wid * (1 - (card ? 0.5 : 0.85) * k / (pts.length - 1))), wHead(P), spec, region, 0.55, card);
    }
  };
  if (nB > 0 && beard > 0.28) { const long = beard > 0.8; emitHair(beardZone, Math.round(nB * 0.62), long ? [0.014, 0.04] : [0.007, 0.018], lod === 0 ? 0.0046 : 0.0085, long ? 1.0 : 0.55, 0.5, -1, true); }
  if (moust && lod === 0) emitHair(mustZone, 60, [0.008, 0.02], 0.0034, 0.9, 0.7, -1, true);
  if (sideb && lod === 0) emitHair(sideZone, 90, [0.008, 0.03], 0.004, 0.8, 0.2, -1, true);
  // ------------------------------------------------------------------ eyelashes (from the lid-margin path the head builder recorded)
  if (lod === 0 && hi.lashPath) for (const side of hi.lashPath) {
    const P0 = side.pts; const n = P0.length; const lashSpec = matSpec({ mat: 'hair', color: (cR * 0.5 << 16) | (cG * 0.5 << 8) | (cB * 0.5), rough: 0.5 }); void lashSpec;
    for (let k = 0; k < n; k++) { const p = P0[k]; if (rr() < (p.side < 0 ? 0.65 : 0.35)) continue; const up = p.side > 0; const len = (up ? 0.0075 : 0.0042) * (0.6 + 0.8 * rr()) * (0.6 + 0.6 * Math.sin(Math.PI * (k / n))); if (len < 0.002) continue;
      const q0 = new V(p.x, p.y, p.z - 0.0004); const d = new V(side.sx * ((p.ex > 0.004 ? 0.3 : -0.1) + (rr() - 0.5) * 0.5), up ? 0.5 + rr() * 0.3 : -0.45, -0.6 - rr() * 0.3).normalize();
      const q1 = q0.clone().addScaledVector(d, len * 0.55), q2 = q1.clone().addScaledVector(d.clone().add(new V(0, up ? 0.35 : -0.15, -0.3)).normalize(), len * 0.5);
      strand([q0, q1, q2], [0.0004, 0.00032, 0.00008], wHead(q0), bank[0], -1, 0.6); }
  }
  void triBudget;
}
