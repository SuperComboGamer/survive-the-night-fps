// Hands and feet: anatomical relief pushed into the subdivided skin cage before emission (extensor tendons on the back of the hand,
// metacarpal knuckle heads, finger joint bulges + palmar pads + pulp, thenar / hypothenar pads, ulnar + radial styloids), curved nail
// plates with a cuticle-to-free-edge coordinate for the shader (lunula, ridges, dirt, broken tips), and bare feet with five toes + nails.
// Fine creases / wrinkles / veins are painted per pixel in skinshade.js from the same rest-space finger geometry.
import * as THREE from 'three';
import { RIG, BI } from './rig.js';
import { matSpec } from './mesh.js';
import { gridMesh, mulberry, zt } from './mouth.js';

const V = THREE.Vector3;
const FN = ['index', 'middle', 'ring', 'pinky', 'thumb'];
const g2 = (x, s) => Math.exp(-(x * x) / (s * s));

/** displace hand / finger / foot vertices of a subdivided skin Cage along their normals (in place). gaunt 0..1 sharpens tendons + bones */
export function sculptHands(...a) { const t0 = performance.now(); try { return sculptHands0(...a); } finally { zt('hands', t0); } }
function sculptHands0(cage, gaunt = 0.4, lod = 0) {
  if (lod >= 2) return; const N = cage.normals(); const F = cage.F, T = cage.T, R = cage.R; const seen = new Uint8Array(cage.nv); const tagOf = new Array(cage.nv);
  for (let fi = 0; fi < F.length; fi++) { const t = T[fi]; if (t.part !== 'hand' && t.part !== 'finger' && t.part !== 'thumb' && t.part !== 'foot') continue; for (const v of F[fi]) { if (!seen[v]) { seen[v] = 1; tagOf[v] = t; } } }
  const gk = 0.55 + gaunt * 0.9;
  const A = { L: RIG.arm.L, R: RIG.arm.R }; const p = new V(), d = new V(), a = new V(), b = new V(), ab = new V(), nrm = new V();
  for (let v = 0; v < cage.nv; v++) {
    if (!seen[v]) continue; const tag = tagOf[v]; const r = R[v]; p.set(r[0], r[1], r[2]); nrm.set(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    if (tag.part === 'foot') continue;
    const AR = A[tag.side]; const H = new V(...AR.h), P = new V(...AR.p), Tt = new V(...AR.t), W = new V(...AR.wr);
    const hd = d.copy(p).sub(W); const ha = hd.dot(H), hb = hd.dot(P), hc = hd.dot(Tt); const dors = Math.max(0, Math.min(1, -nrm.dot(P) * 1.6 + 0.2)), palm = Math.max(0, Math.min(1, nrm.dot(P) * 1.6 + 0.2));
    let disp = 0;
    if (tag.part === 'hand') {
      // metacarpal knuckle heads (dorsal) at the MCP line, extensor tendon ridges from the wrist toward each knuckle
      const cs = [0.027, 0.008, -0.011, -0.028];
      for (let i = 0; i < 4; i++) { const cx = cs[i] * (0.8 + 0.2 * (ha / 0.09)); disp += dors * 0.00135 * gk * g2(hc - cs[i], 0.0034) * Math.max(0, Math.min(1, ha / 0.03)) * (ha < 0.098 ? 1 : 0.4); disp += dors * 0.0016 * g2(ha - 0.088, 0.008) * g2(hc - cs[i], 0.0085); void cx; }
      disp -= dors * 0.0006 * gk * Math.max(0, 1 - Math.abs(hc) / 0.05) * Math.max(0, Math.min(1, ha / 0.03)) * 0.5;               // valley between the tendons
      // thenar (thumb ball) + hypothenar pads and the palm hollow
      disp += palm * (0.0042 * g2(ha - 0.036, 0.02) * g2(hc - 0.028, 0.02) + 0.0032 * g2(ha - 0.044, 0.024) * g2(hc + 0.028, 0.014) - 0.0016 * g2(ha - 0.05, 0.02) * g2(hc, 0.018));
      // wrist bones: ulnar styloid (pinky side, dorsal), radial styloid, pisiform
      disp += dors * 0.0018 * gk * g2(ha + 0.004, 0.009) * g2(hc - 0.028, 0.008); // radial styloid (the ulnar one is sculptSkin's)
    } else {
      // fingers: nearest segment of this finger → arc length s, joints at the segment ends
      const fn = tag.finger || 'thumb'; const F0 = AR.fingers[fn]; if (!F0) continue; let best = 1e9, bs = 0, bt = 0, acc = 0; const rad = F0.rad;
      for (let k = 0; k < 3; k++) { a.set(...F0.pts[k]); b.set(...F0.pts[k + 1]); ab.copy(b).sub(a); const L = ab.length(); const t = Math.max(0, Math.min(1, d.copy(p).sub(a).dot(ab) / (L * L))); const dd = d.copy(p).sub(a).addScaledVector(ab, -t).length(); if (dd < best) { best = dd; bs = acc + t * L; bt = t; } acc += L; }
      const l0 = F0.len[0], l1 = F0.len[1], l2 = F0.len[2]; const j1 = bs - l0, j2 = bs - l0 - l1, tot = l0 + l1 + l2; void bt;
      const isT = fn === 'thumb';
      disp += dors * gk * (0.0011 * g2(bs - (isT ? 0.004 : 0.0), 0.007) + 0.0010 * g2(j1, 0.0068) + 0.0006 * g2(j2, 0.0055));            // knuckles (dorsal)
      disp += palm * (0.0007 * Math.sin(Math.PI * Math.max(0, Math.min(1, (bs - 0.0) / Math.max(1e-4, l0)))) * (bs < l0 ? 1 : 0) + 0.0006 * Math.sin(Math.PI * Math.max(0, Math.min(1, j1 / l1))) * (j1 > 0 && j2 < 0 ? 1 : 0)); // proximal + middle pads
      disp += palm * 0.0009 * g2(bs - (tot - 0.006), 0.008);                                                                            // fingertip pulp
      disp -= palm * 0.0004 * (g2(j1, 0.0009) + g2(j2, 0.0008));                                                                        // flexion crease (geometric part)
      disp -= dors * 0.0004 * gk * Math.max(0, Math.min(1, (bs - (tot - 0.011)) / 0.005)) * 0.5;                                        // nail-bed flat
    }
    if (disp !== 0) { r[0] += nrm.x * disp; r[1] += nrm.y * disp; r[2] += nrm.z * disp; }
  }
}

/** curved nail plates. spec colour = nails; params per row give the shader the cuticle→edge coordinate. per-look variation: length, ragged tips, torn-off nails */
export function buildNails(...a) { const t0 = performance.now(); try { return buildNails0(...a); } finally { zt('nails', t0); } }
function buildNails0(o, baseColor) {
  const rr = mulberry(0x1234567 + (o.variant?.id || '').length * 131); const nu = o.lod === 0 ? 7 : 4, nv = o.lod === 0 ? 6 : 3; const buf = o.buf;
  for (const side of ['L', 'R']) for (const fn of FN) {
    const F = RIG.arm[side].fingers[fn]; const pa = new V(...F.pts[2]), pb = new V(...F.pts[3]); const dvec = new V().subVectors(pb, pa); const Ld = dvec.length(); const dd = dvec.clone().normalize(); const fa = new V(...F.flexAxis);
    const dorsal = new V().crossVectors(dd, fa).normalize(); const lat = new V().crossVectors(dd, dorsal).normalize(); if (dorsal.dot(new V(...RIG.arm[side].p)) > 0) dorsal.negate();
    const tipR = F.rad * (fn === 'thumb' ? 0.8 : 0.72); const torn = rr() < 0.12; const broken = rr() < 0.4; const lenK = torn ? 0.4 : (0.62 + rr() * 0.42) * (fn === 'thumb' ? 1.25 : fn === 'pinky' ? 0.85 : 1);
    const start = 0.22, end = 0.9 + 0.1 * lenK; const wN = tipR * (fn === 'thumb' ? 0.9 : 0.8); const rows = [];
    const specs = []; for (let i = 0; i < nv; i++) { const t = i / (nv - 1); specs.push(matSpec({ mat: 'nail', color: torn ? 0x6a2a24 : baseColor ?? 0x6a6450, rough: 0.4, param: t, dirt: 0.4 + rr() * 0.5 })); }
    for (let i = 0; i < nv; i++) {
      const t = i / (nv - 1); const row = []; for (let j = 0; j < nu; j++) {
        const s = -1 + 2 * j / (nu - 1); const along = Ld * (start + (end - start) * t) ; const w = wN * (1 - 0.08 * t); const across = s * w; const cur = -Math.abs(s) * Math.abs(s) * tipR * 0.42;
        let raise = tipR * 1.0 + 0.0011 + 0.0004 * Math.sin(Math.PI * t) - Math.max(0, t - 0.88) * Ld * 0.2; // plate follows the finger, the free edge lifts away
        let al = along; if (broken && t > 0.8) al -= Math.abs(Math.sin(s * 5 + fn.length)) * 0.0022 * (1 + rr());
        row.push(new V().copy(pa).addScaledVector(dd, al).addScaledVector(lat, across).addScaledVector(dorsal, raise + cur * 0.55));
      } rows.push(row);
    }
    if (torn) continue; // torn-off nail: the bed shows through the (shader-coloured) skin
    gridMesh(buf, rows, { flip: false, w: [[BI[fn + '3.' + side], 1]], spec: (i) => specs[i], ao: 0.95 });
  }
}

/** bare foot: five toes (chains of tapered capsules) + nails; called only when no garment covers the foot */
export function buildToes(...a) { const t0 = performance.now(); try { return buildToes0(...a); } finally { zt('toes', t0); } }
function buildToes0(o, skinSpec, nailColor) {
  const rr = mulberry(0x777 + (o.variant?.id || '').length * 71); const nu = o.lod === 0 ? 10 : 6; const buf = o.buf;
  for (const side of ['L', 'R']) {
    const L = RIG.leg[side], sx = L.sx; const cx = L.ankle[0] + sx * 0.006; const zf = L.ankle[2] - 0.150; const tb = 'toe.' + side;
    const spec = skinSpec; const W = [[BI[tb], 1]];
    const lens = [[0.026, 0.021], [0.021, 0.014], [0.019, 0.013], [0.017, 0.012], [0.014, 0.010]], rad = [0.0108, 0.0078, 0.0072, 0.0066, 0.006];
    for (let k = 0; k < 5; k++) {
      const x0 = cx + sx * (-0.0225 + 0.0112 * k) * (1 + 0.0 * k); const splay = (k - 1.2) * 0.05 * sx; const droop = 0.0; const y0 = 0.0138 - (k === 0 ? 0 : 0.0015) + rr() * 0.001; const pts = [new V(x0, y0, zf + 0.012)]; let dir = new V(splay + (rr() - 0.5) * 0.06, -0.03, -1).normalize();
      for (let s = 0; s < 2; s++) { const prev = pts[s]; dir = dir.clone().add(new V(0, s === 1 ? -0.16 : 0.0, 0)).normalize(); pts.push(prev.clone().addScaledVector(dir, lens[k][s] * (0.95 + 0.1 * rr()))); }
      pts.push(pts[2].clone().addScaledVector(new V(dir.x, dir.y - 0.25, dir.z).normalize(), 0.006 * (k === 0 ? 1.4 : 1)));
      // ring loft along the chain
      const rows = []; const nseg = 4; const rs = [rad[k], rad[k] * 0.98, rad[k] * 0.92, rad[k] * 0.62];
      for (let i = 0; i < pts.length; i++) { const tan = new V().subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize(); const up = new V(0, 1, 0); const sd = new V().crossVectors(up, tan).normalize(); const u2 = new V().crossVectors(tan, sd).normalize(); const ring = [];
        for (let j = 0; j < nu; j++) { const a = (j / nu) * Math.PI * 2; const c = Math.cos(a), s2 = Math.sin(a); const flat = s2 < 0 ? 0.62 : 1; ring.push(new V().copy(pts[i]).addScaledVector(sd, c * rs[i] * 1.05).addScaledVector(u2, s2 * rs[i] * flat)); } rows.push(ring); }
      const last = pts[pts.length - 1]; const cap = []; for (let j = 0; j < nu; j++) cap.push(last.clone().addScaledVector(new V(0, 0, -1), 0.0004)); rows.push(cap);
      gridMesh(buf, rows, { wrapJ: true, flip: sx < 0, w: W, spec, ao: 0.9 - (k > 0 ? 0.05 : 0), poles: [[0, 0, -1], [0, 0, -1]] });
      // nail
      const pn = pts[2], tn = new V().subVectors(pts[3], pts[1]).normalize(); const sdn = new V().crossVectors(new V(0, 1, 0), tn).normalize(); const un = new V().crossVectors(tn, sdn).normalize(); const rowsN = [];
      for (let i = 0; i < 4; i++) { const t = i / 3; const row = []; for (let j = 0; j < 5; j++) { const s = -1 + j / 2; row.push(new V().copy(pn).addScaledVector(tn, -0.004 + t * (0.0085 + (k === 0 ? 0.004 : 0))).addScaledVector(sdn, s * rad[k] * 0.72).addScaledVector(un, rad[k] * 0.98 + 0.0003 - s * s * rad[k] * 0.16)); } rowsN.push(row); }
      const nspec = [0, 1, 2, 3].map((i) => matSpec({ mat: 'nail', color: nailColor ?? 0x6a6450, rough: 0.4, param: i / 3, dirt: 0.5 }));
      gridMesh(buf, rowsN, { flip: sx > 0, w: W, spec: (i) => nspec[i], ao: 0.95 });
    }
  }
}
