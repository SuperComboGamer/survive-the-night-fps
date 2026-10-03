// GEAR KIT: detailed replacements for the worn / carried gear helpers of gear.js (installed on the Outfit prototype by gear.js).
// Helmets (fibre miner's hat, hard hat) with shell thickness, rolled brims, comb + rivets, chin straps; cap lamp with reflector + lens + cable + battery;
// rib-knit beanies; stitched leather belts with a real buckle; backpacks with lid, pockets, straps and buckles; pickaxe with forged head and wrapped grip;
// ski poles with baskets and straps; ragged tatters with frayed threads; knee pads; belt canisters.
import * as THREE from 'three';
import { BI, RIG, HEAD_CENTER, restPos } from './rig.js';
import { REG, matSpec } from './mesh.js';
import { noise3 } from './folds.js';
const _unused = 0; void _unused;

const V = THREE.Vector3, TAU = Math.PI * 2, PI = Math.PI; const HC = HEAD_CENTER;
const sq = Math.sqrt; const smoothS = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm3 = (a) => { const l = sq(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hatOn = (o) => { o.info.hasHat = true; o._later(() => { o.buf.forceRegion = REG.hat; }); }, hatOff = (o) => o._later(() => { o.buf.forceRegion = -1; });

/** loft closed rings (arrays of [x,y,z], all the same length, ordered low → high, points CCW seen from above with x = sin θ, z = −cos θ) into quads with smooth normals.
 *  opt: {spec, w (weights), ao, flip, cap: 'fan' closes the top ring with a centroid vertex, wrapV: last ring joins the first} */
export function loft(o, rings, opt) {
  const buf = o.buf, R = rings.length, n = rings[0].length; const { spec, w } = opt; const ao = opt.ao ?? 1; const wf = typeof w === 'function' ? w : () => w; const idx = [];
  for (let i = 0; i < R; i++) { const row = []; for (let k = 0; k < n; k++) {
    const p = rings[i][k]; const a = rings[i][opt.open ? Math.min(n - 1, k + 1) : (k + 1) % n], b = rings[i][opt.open ? Math.max(0, k - 1) : (k + n - 1) % n]; const up = rings[Math.min(R - 1, i + 1)][k], dn = rings[Math.max(0, i - 1)][k]; const du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv = [up[0] - dn[0], up[1] - dn[1], up[2] - dn[2]];
    let nn = cross(dv, du); if (nn[0] === 0 && nn[1] === 0 && nn[2] === 0) nn = [0, 1, 0]; nn = norm3(nn); if (opt.flip) nn = [-nn[0], -nn[1], -nn[2]];
    row.push(buf.vert(p, nn, wf(p), spec, typeof ao === 'function' ? ao(i / Math.max(1, R - 1)) : ao)); } idx.push(row); }
  const wrap = opt.wrapV; for (let i = 0; i < R - 1 + (wrap ? 1 : 0); i++) { const A = idx[i], B = idx[(i + 1) % R]; for (let k = 0; k < (opt.open ? n - 1 : n); k++) { const k1 = (k + 1) % n; if (opt.flip) buf.quad(A[k], A[k1], B[k1], B[k]); else buf.quad(A[k], B[k], B[k1], A[k1]); } }
  if (opt.cap) { const top = rings[R - 1]; let c = [0, 0, 0]; for (const p of top) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; } const cv = buf.vert(c, opt.flip ? [0, -1, 0] : [0, 1, 0], wf(c), spec, 1); const A = idx[R - 1]; for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; if (opt.flip) buf.tri(A[k], A[k1], cv); else buf.tri(A[k1], A[k], cv); } }
  return idx;
}
const ringArc = (n, a0, a1, fn) => { const r = []; for (let k = 0; k < n; k++) { const a = a0 + (a1 - a0) * k / (n - 1); r.push(fn(a, Math.sin(a), -Math.cos(a), k)); } return r; };
const ringAt = (n, fn) => { const r = []; for (let k = 0; k < n; k++) { const a = k / n * TAU; r.push(fn(a, Math.sin(a), -Math.cos(a), k)); } return r; };
/** rounded dome shell of an elliptical helmet: outer + inner surface + rolled rim. Returns {rimY, radius(a)} for brims. */
function domeShell(o, spec, c, rx, rz, ry, { n = 44, m = 14, thick = 0.0042, dent = 0.0008, seed = 1, boxy = 0.9, lift = 0 } = {}) {
  const w = [['head', 1]]; const outer = [], inner = []; const surf = (t, off) => ringAt(n, (a, sa, ca) => { const ph = t * PI / 2 * 0.985; const f = Math.pow(Math.cos(ph), boxy); const rr = 1 + 0.02 * noise3(sa * 2 + seed, ca * 2, t * 3, seed);
    const x = c[0] + sa * (rx * f * rr - off * f), z = c[2] + ca * (rz * f * rr - off * f), y = c[1] + Math.sin(ph) * (ry - off * 0.6) + lift * smoothS(0.6, 1, t); const d = dent * (noise3(x * 26, y * 26, z * 26, seed + 2) + 0.7 * noise3(x * 9, y * 9, z * 9, seed + 5)); return [x + sa * d, y + d * 0.5, z + ca * d]; });
  for (let j = 0; j <= m; j++) outer.push(surf(j / m, 0)); const nn = Math.max(4, Math.round(m * 0.7)); for (let j = 0; j <= nn; j++) inner.push(surf(j / m * 0.8, thick));
  loft(o, outer, { spec, w, cap: 'fan', ao: (t) => 0.85 + 0.15 * t });
  // rolled rim: outer bottom → tip → inner bottom, then the inner surface (facing down / inward)
  const y0 = c[1]; const rim = [ringAt(n, (a, sa, ca) => [c[0] + sa * rx, y0, c[2] + ca * rz]), ringAt(n, (a, sa, ca) => [c[0] + sa * (rx - thick * 0.25), y0 - thick * 0.75, c[2] + ca * (rz - thick * 0.25)]), ringAt(n, (a, sa, ca) => [c[0] + sa * (rx - thick * 0.8), y0 - thick * 0.6, c[2] + ca * (rz - thick * 0.8)])];
  loft(o, rim.concat([inner[0]]), { spec, w, ao: 0.6 }); loft(o, inner, { spec, w, flip: true, cap: 'fan', ao: 0.45 });
  return { y0, rx, rz };
}
/** brim: a closed loft around the dome with thickness, sloping down at the front peak. ext(a) = brim width at angle a (0 = front). */
function brim(o, spec, c, rx, rz, ext, { n = 44, drop = 0.008, tilt = 0.012, th = 0.0035, lipUp = 0 } = {}) {
  const w = [['head', 1]]; const y0 = c[1]; const at = (a, sa, ca, e, dy) => { const front = Math.max(0, Math.cos(a)); return [c[0] + sa * (rx + e), y0 + dy - tilt * Math.pow(front, 1.5) * (e > 0 ? 1 : 0) - drop * (e / Math.max(0.001, ext(0))) * 0 - drop * Math.min(1, e / 0.03) * 0.5, c[2] + ca * (rz + e)]; };
  const E = (a) => ext(a); const rings = [ringAt(n, (a, sa, ca) => at(a, sa, ca, -0.002, -0.001)), ringAt(n, (a, sa, ca) => at(a, sa, ca, E(a) * 0.55, 0.0006 + lipUp * 0.2)), ringAt(n, (a, sa, ca) => at(a, sa, ca, E(a) * 0.98, 0.0008 + lipUp)), ringAt(n, (a, sa, ca) => at(a, sa, ca, E(a) * 1.0 + 0.0008, -th * 0.35 + lipUp * 0.5)), ringAt(n, (a, sa, ca) => at(a, sa, ca, E(a) * 0.98, -th)), ringAt(n, (a, sa, ca) => at(a, sa, ca, E(a) * 0.55, -th - 0.001)), ringAt(n, (a, sa, ca) => at(a, sa, ca, -0.004, -th - 0.0015))];
  loft(o, rings, { spec, w, ao: 0.8 });
}
/** chin strap: leather ribbon from each side of the helmet down the cheek and under the chin, with a buckle on the left */
function chinStrap(o, col, y0, halfW, zc) {
  o._tubeRaw2 = null; const spec = o._spec({ mat: 'leather', color: col, rough: 0.6, wear: 0.5, dirt: 0.5 });
  for (const sx of [-1, 1]) { const top = new V(sx * halfW, y0 - 0.006, zc + 0.012), mid1 = o.snap([0, y0 - 0.05, 0.0], [sx * 0.9, -0.08, -0.35], 0.16, 0.02, 0.05).addScaledVector(new V(sx, 0, -0.2).normalize(), 0.004), mid2 = o.snap([0, y0 - 0.095, -0.02], [sx * 0.55, -0.35, -0.6], 0.13, 0.02, 0.05).addScaledVector(new V(sx, 0, -0.4).normalize(), 0.004);
    const under = new V(sx * 0.018, y0 - 0.135, zc - 0.075); o._tubeRaw([top, mid1, mid2, under], [0.0065, 0.0065, 0.0065, 0.0065], spec, { seg: 6, flat: 0.28, sub: 3, bone: 'head', caps: true }); }
  const bk = o.snap([-0.04, y0 - 0.12, -0.05], [-0.3, -0.2, -0.4], 0.12, 0.03, 0.05); o._box({ bone: 'head', p: [bk.x, bk.y, bk.z], s: [0.02, 0.016, 0.006], mat: 'metal', color: 0x9a9890, rough: 0.35, wear: 0.5, bevel: 0.0015 });
}

export function installGearKit(P) {
  // every helper falls back to the simple version (kept in gear.js) when globalThis.__ZCLOTH_OFF is set (A/B measurements)
  const OLD = {}; for (const k of ['minerHelmet', 'capLamp', 'hardHat', 'beanie', 'belt', 'backpack', 'kneePads', 'beltCanister', 'pickaxe', 'skiPoles', 'tatters']) OLD[k] = P[k];
  const NEWF = {}; const wrap = () => { for (const k in OLD) { const nf = P[k]; if (nf === OLD[k] || NEWF[k]) continue; NEWF[k] = nf; P[k] = function (...a) { return globalThis.__ZCLOTH_OFF ? OLD[k].apply(this, a) : nf.apply(this, a); }; } };
  setTimeout(() => {}, 0); void wrap;
  // ---------------------------------------------------------------- helmets
  P.minerHelmet = function (opts = {}) {
    hatOn(this); const hi = this.lod === 0;
    const m = { mat: opts.mat || 'paint', color: opts.color ?? 0x2a2a28, rough: opts.rough ?? 0.4, wear: opts.wear ?? 0.55, dirt: opts.dirt ?? 0.55, param: opts.metalBase ? 1 : 0 };
    const c = [HC.x, HC.y + 0.002, HC.z + 0.012]; const rx = 0.098, rz = 0.12, ry = 0.118;
    this.parts.custom((o) => {
      const spec = o._spec(m); const n = o.seg(44), mm = o.seg(14);
      domeShell(o, spec, c, rx, rz, ry, { n, m: mm, thick: 0.0045, dent: hi ? 0.0019 : 0, seed: 3 });
      if (hi) { const lsp = o._spec({ mat: 'leather', color: 0x4a3018, rough: 0.75, wear: 0.5, dirt: 0.6 }), wsp = o._spec({ mat: 'cloth', pattern: 'weave', color: 0xb8ab8a, rough: 0.9, dirt: 0.6 }); // suspension: leather sweatband + crossed webbing straps inside the shell
        const rowsB = []; for (const [dy, dr] of [[-0.001, 0.0], [0.0, 0.0], [0.022, 0.001], [0.027, 0.0035]]) rowsB.push(ringAt(n, (a, sa, ca) => [c[0] + sa * (rx - 0.0075 - dr), c[1] + dy, c[2] + ca * (rz - 0.0075 - dr)])); loft(o, rowsB, { spec: lsp, w: [['head', 1]], flip: true, ao: 0.5 });
        for (const ax of [0, 1]) { const pts = []; for (let i = 0; i <= 10; i++) { const ph = (i / 10 - 0.5) * PI; pts.push(new V(c[0] + (ax ? 0 : Math.sin(ph) * (rx - 0.011)), c[1] + Math.cos(ph) * (ry - 0.013) * 0.98 + 0.002, c[2] + (ax ? Math.sin(ph) * (rz - 0.011) : 0))); } o._tubeRaw(pts, pts.map(() => 0.0045), wsp, { seg: 5, flat: 0.22, sub: 1, bone: 'head', caps: true }); } }
      const bw = opts.brim ?? 0.03, pk = opts.peak ?? 0.05; brim(o, spec, c, rx, rz, (a) => bw + pk * Math.pow(Math.max(0, Math.cos(a)), 3) - 0.008 * Math.max(0, -Math.cos(a)), { n, tilt: 0.014, th: 0.0038 });
      if (opts.ridge !== false) { // comb: tapered rounded rib along the crown (front → back), riveted at both ends
        const pts = [], rad = []; for (let i = 0; i <= 14; i++) { const t = -0.44 + i / 14 * 0.88; const a = t * PI; const y = c[1] + Math.cos(a) * ry * 0.985 + 0.003, z = c[2] + Math.sin(a) * rz * 0.96 * (1 - 0.0); pts.push(new V(c[0], y, z)); rad.push(0.0085 * (0.55 + 0.45 * Math.sin(i / 14 * PI))); }
        o._tubeRaw(pts, rad, spec, { seg: hi ? 8 : 5, flat: 0.62, sub: 1, bone: 'head', caps: true }); }
      if (hi) { const rv = o._spec({ mat: 'metal', color: 0x6a665c, rough: 0.4, wear: 0.7, dirt: 0.5 }); for (const [x, y, z] of [[0.099, 0.03, 0.0], [-0.099, 0.03, 0.0], [0.09, 0.05, 0.05], [-0.09, 0.05, 0.05]]) o._sphere({ bone: 'head', p: [c[0] + x, c[1] + y, c[2] + z], scale: [0.0032, 0.0048, 0.0048], seg: 7, mat: 'metal', color: 0x6a665c, rough: 0.4, wear: 0.7 }); void rv;
        for (const sx of [-1, 1]) o._sphere({ bone: 'head', p: [c[0] + sx * 0.0, c[1] + 0.118 * 0.98, c[2] - 0.075 + 0.0], scale: [0.004, 0.003, 0.004], seg: 7, mat: 'metal', color: 0x6a665c, rough: 0.4 }); }
      if (hi && opts.strap !== false) chinStrap(o, 0x2a2018, c[1], rx + 0.002, c[2]);
    });
    // lamp bracket plate at the front
    this.parts.box({ bone: 'head', p: [0, c[1] + 0.056, c[2] - 0.117], s: [0.052, 0.05, 0.007], rot: [-0.38, 0, 0], mat: 'metal', color: 0x4a4640, rough: 0.5, wear: 0.7, bevel: 0.003 });
    for (const sx of [-1, 1]) this.parts.sphere({ bone: 'head', p: [sx * 0.018, c[1] + 0.066, c[2] - 0.121], scale: [0.0045, 0.0045, 0.003], seg: 7, mat: 'metal', color: 0x8a8476, rough: 0.35, wear: 0.4 });
    this.info.helmetY = HC.y + 0.035;
    if (opts.lamp !== false) this.capLamp({ ...(opts.lamp || {}) });
    hatOff(this); return this;
  };
  P.capLamp = function (opts = {}) {
    const lp = new V(0, HC.y + 0.075, HC.z - 0.127); const dir = new V(0, -0.2, -1).normalize(); const hi = this.lod === 0;
    const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), dir); const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); const rot = [e.x, e.y, e.z];
    const house = { mat: 'metal', color: opts.housing ?? 0x3c3a36, rough: 0.35, wear: 0.6, dirt: 0.5 };
    // housing: rear cap → tube with cooling rings → bezel; reflector cone inside; lens (emissive) + glass rim
    this.parts.lathe({ bone: 'head', p: lp.clone().addScaledVector(dir, -0.05), profile: [[0.006, 0], [0.02, 0.003], [0.027, 0.01], [0.029, 0.03], [0.031, 0.048], [0.036, 0.052], [0.037, 0.058]], rot, seg: 20, ...house });
    if (hi) for (const t of [0.012, 0.02, 0.028]) this.parts.torusRing({ bone: 'head', p: lp.clone().addScaledVector(dir, -0.05 + t + 0.002), R: 0.0285 + t * 0.06, r: 0.0025, rot, seg: 20, tseg: 5, mat: 'metal', color: 0x2c2a26, rough: 0.4, wear: 0.6 });
    this.parts.torusRing({ bone: 'head', p: lp.clone().addScaledVector(dir, 0.007), R: 0.0355, r: 0.0042, rot, seg: 20, tseg: 6, mat: 'metal', color: 0x8a8476, rough: 0.3, wear: 0.5 });
    this.parts.lathe({ bone: 'head', p: lp.clone().addScaledVector(dir, 0.004), profile: [[0.033, 0], [0.024, -0.007], [0.012, -0.011], [0.004, -0.012]], rot, seg: 20, double: true, mat: 'metal', color: 0xb8b4aa, rough: 0.2, metal: 1, wear: 0.3 });
    this.parts.lathe({ bone: 'head', p: lp.clone().addScaledVector(dir, 0.0), profile: [[0.031, 0], [0.019, 0.004], [0.0, 0.006]], rot, seg: 20, mat: 'emissive', color: opts.lensColor ?? 0xfff0d0, emissive: opts.emissive ?? 9 });
    const cable = { mat: 'rubber', color: 0x161514, rough: 0.6 };
    if (opts.cable !== false) this.parts.custom((o) => {
      const pts = [lp.clone().addScaledVector(dir, -0.055), new V(0.03, HC.y + 0.062, HC.z - 0.1), new V(0.085, HC.y + 0.035, HC.z + 0.0), new V(0.08, HC.y + 0.01, HC.z + 0.09), new V(0.055, 1.56, 0.088), new V(0.07, 1.42, 0.125), new V(0.09, 1.25, 0.14), new V(0.105, 1.1, 0.14), new V(0.11, 1.02, 0.145)];
      for (let i = 4; i < pts.length; i++) { const core = new V(0, pts[i].y, 0.02); const d = new V().subVectors(pts[i], core).normalize(); pts[i] = o.snap(core, d, 0.14).addScaledVector(d, 0.0085); }
      const bones = ['head', 'head', 'head', 'head', 'neck', 'chest', 'spine2', 'spine1', 'pelvis'];
      o._tubeRaw(pts, pts.map(() => 0.0062), o._spec(cable), { seg: 7, sub: 3, bindFn: (t) => { const f = t * (bones.length - 1); const i = Math.floor(f), u = f - i; const a = BI[bones[i]], b = BI[bones[Math.min(bones.length - 1, i + 1)]]; return [[a, 1 - u], [b, u]]; } });
    });
    if (opts.battery !== false) { // Wheat-lamp style battery: rounded case on a leather belt loop, carry handle, small indicator
      this.parts.box({ bind: 'auto', p: [0.11, 1.0, 0.165], s: [0.14, 0.11, 0.05], rot: [0, 0.35, 0], mat: 'metal', color: 0x2e2c28, rough: 0.5, wear: 0.6, dirt: 0.7, bevel: 0.009 });
      if (hi) { this.parts.box({ bind: 'auto', p: [0.112, 1.0, 0.19], s: [0.11, 0.075, 0.006], rot: [0, 0.35, 0], mat: 'metal', color: 0x3a3833, rough: 0.45, wear: 0.7, dirt: 0.6, bevel: 0.003 });
        this.parts.box({ bind: 'auto', p: [0.108, 1.058, 0.166], s: [0.05, 0.012, 0.012], rot: [0, 0.35, 0], mat: 'leather', color: 0x2a1c12, rough: 0.6, wear: 0.5, bevel: 0.004 });
        this.parts.sphere({ bind: 'auto', p: [0.13, 1.03, 0.19], r: 0.0045, seg: 8, mat: 'emissive', color: 0xff5a20, emissive: 2.5 });
        this.parts.box({ bind: 'auto', p: [0.11, 1.0, 0.135], s: [0.06, 0.045, 0.02], rot: [0, 0.35, 0], mat: 'leather', color: 0x2a1c12, rough: 0.6, wear: 0.6, bevel: 0.004 }); } }
    this.info.lamp = { bone: 'head', pos: [lp.x, lp.y, lp.z], dir: [dir.x, dir.y, dir.z] };
    return this;
  };
  P.hardHat = function (opts = {}) {
    hatOn(this); const hi = this.lod === 0; const col = opts.color ?? 0xe8e4d8;
    const m = { mat: 'plastic', color: col, rough: 0.34, wear: opts.wear ?? 0.5, dirt: opts.dirt ?? 0.5, param: opts.cracked ?? 0 };
    const c = [HC.x, HC.y + 0.006, HC.z + 0.01]; const rx = 0.098, rz = 0.122, ry = 0.128;
    this.parts.custom((o) => {
      const spec = o._spec(m); const n = o.seg(44), mm = o.seg(14);
      domeShell(o, spec, c, rx, rz, ry, { n, m: mm, thick: 0.0032, dent: hi ? 0.0011 : 0, seed: 7, boxy: 0.8 });
      // full brim with an upturned gutter lip and a longer front peak
      brim(o, spec, c, rx, rz, (a) => 0.026 + 0.03 * Math.pow(Math.max(0, Math.cos(a)), 2) + 0.012 * Math.max(0, -Math.cos(a)), { n, tilt: 0.008, th: 0.0032, lipUp: 0.0032 });
      for (const x of [-0.036, 0, 0.036]) { const pts = [], rad = []; for (let i = 0; i <= 12; i++) { const a = -PI * 0.4 + i / 12 * PI * 0.8; const R = sq(Math.max(0, 1 - (x / (rx * 0.98)) ** 2)); pts.push(new V(c[0] + x, c[1] + Math.cos(a) * ry * R * 0.985 + 0.0025, c[2] + Math.sin(a) * rz * R * 0.98)); rad.push(0.0058 * (0.4 + 0.6 * Math.sin(i / 12 * PI))); } o._tubeRaw(pts, rad, spec, { seg: hi ? 7 : 5, flat: 0.6, sub: 1, bone: 'head', caps: true }); }
      if (hi) { const sl = { mat: 'plastic', color: 0x1a1a1a, rough: 0.6, dirt: 0.5 }; for (const sx of [-1, 1]) o._box({ bone: 'head', p: [c[0] + sx * (rx - 0.001), c[1] + 0.012, c[2] + 0.005], s: [0.004, 0.011, 0.028], mat: sl.mat, color: sl.color, rough: 0.6, bevel: 0.001 });
        // harness: webbing band visible inside the rim + nape ratchet
        o._band({ y: c[1] - 0.012, height: 0.014, thick: 0.002, lift: -0.012, center: [c[0], c[2]], seg: 32, mat: 'plastic', color: 0xd0c8b0, rough: 0.6, dirt: 0.5, window: 0.02 });
        o._box({ bone: 'head', p: [c[0], c[1] - 0.01, c[2] + rz + 0.004], s: [0.05, 0.026, 0.014], mat: 'plastic', color: 0x1e1e1e, rough: 0.5, bevel: 0.004 }); o._sphere({ bone: 'head', p: [c[0], c[1] - 0.008, c[2] + rz + 0.014], scale: [0.011, 0.011, 0.004], seg: 8, mat: 'plastic', color: 0xd0c8b0, rough: 0.5 });
        if (opts.strap !== false) chinStrap(o, 0x1e1e1e, c[1], rx + 0.001, c[2]); }
    });
    this.info.helmetY = HC.y + 0.04; hatOff(this); return this;
  };
  // ---------------------------------------------------------------- beanie (rib knit)
  P.beanie = function (opts = {}) {
    hatOn(this); const hi = this.lod === 0; const col = opts.color ?? 0x7a2a22; const m = { mat: 'cloth', pattern: 'knit', color: col, rough: 0.95, dirt: 0.3, wear: opts.wear ?? 0.3 };
    const c = [HC.x, HC.y + 0.0, HC.z + 0.01];
    this.parts.custom((o) => {
      const spec = o._spec(m), n = o.seg(hi ? 64 : 40), mm = o.seg(14), w = [['head', 1]]; const ribs = hi ? 32 : 0; const rx = 0.099, rz = 0.115, ry = 0.106, y0 = c[1] + 0.012;
      const rows = []; for (let j = 0; j <= mm; j++) { const t = j / mm, ph = t * PI / 2 * 0.99; const f = Math.cos(ph); rows.push(ringAt(n, (a, sa, ca, k) => { const rib = ribs ? 1 + 0.03 * Math.cos(k / n * ribs * TAU) * (1 - t * 0.5) : 1; const sag = 1 + 0.03 * noise3(sa * 1.5, t * 2, ca * 1.5, 5); return [c[0] + sa * rx * f * rib * sag, y0 + Math.sin(ph) * ry - 0.006 * Math.max(0, -ca) * t * 0, c[2] + ca * rz * f * rib * sag]; })); }
      loft(o, rows, { spec, w, cap: 'fan', ao: (t) => 0.75 + 0.25 * t });
      // folded cuff: a thick rib-knit roll (outer wall, rolled top, inner wall)
      if (opts.fold !== false) { const y1 = y0 + 0.001, th = 0.011; const cuff = []; for (let j = 0; j < 9; j++) { const t = j / 8; const ph = t * PI; const yy = y1 - 0.03 + t * 0.055 - Math.sin(ph) * 0.0; const out = 1 + (Math.sin(ph) * th) / rx; cuff.push(ringAt(n, (a, sa, ca, k) => { const rib = ribs ? 1 + 0.028 * Math.cos(k / n * ribs * TAU) : 1; return [c[0] + sa * (rx + 0.004 + Math.sin(ph) * th) * rib, yy, c[2] + ca * (rz + 0.004 + Math.sin(ph) * th) * rib]; })); void out; }
        loft(o, cuff, { spec, w, ao: 0.85 }); const inner = []; for (let j = 0; j < 4; j++) { const t = j / 3; inner.push(ringAt(n, (a, sa, ca) => [c[0] + sa * (rx + 0.003 - t * 0.0), y1 - 0.03 + t * 0.004, c[2] + ca * (rz + 0.003)])); } void inner; }
      if (opts.pompom) o._sphere({ bone: 'head', p: [c[0], y0 + ry + 0.014, c[2]], r: 0.032, seg: hi ? 16 : 8, mat: 'fur', color: opts.pompom, rough: 1, dirt: 0.3 });
    });
    hatOff(this); return this;
  };
  // ---------------------------------------------------------------- belt with stitched edges, keepers and a proper buckle
  P.belt = function (opts = {}) {
    const y = opts.y ?? 1.0; this.info.belt = y; const hi = this.lod === 0; const col = opts.color ?? 0x2e2016; const H = opts.height ?? 0.042;
    this.parts.custom((o) => {
      const spec = o._spec({ mat: 'leather', color: col, rough: 0.55, wear: 0.6, dirt: 0.5 }), n = o.seg(56), thread = o._spec({ mat: 'cloth', color: 0xb9a070, rough: 0.8, wear: 0.3, pattern: 'none' });
      const rows = []; const ring = (dy, off, nrm) => ringAt(n, (a, sa, ca) => { const dir = new V(sa, 0, -ca); const s = o.snap(new V(0, y, 0.015), dir, 0.15, 0.02, 0.06); return [s.x + dir.x * off, s.y + dy, s.z + dir.z * off]; });
      const H2 = H / 2, t = 0.0055; // outer face + rounded edges + inner face
      rows.push(ring(-H2 + 0.0015, 0.002)); rows.push(ring(-H2, 0.0035)); rows.push(ring(-H2 + 0.0012, t + 0.001)); rows.push(ring(0, t + 0.002)); rows.push(ring(H2 - 0.0012, t + 0.001)); rows.push(ring(H2, 0.0035)); rows.push(ring(H2 - 0.0015, 0.002));
      const w = (p) => o.weightsAt(new V(p[0], p[1], p[2])); loft(o, rows, { spec, w, ao: 0.9 });
      if (hi) { // stitching rows along both edges (dashes on the outer face)
        for (const dy of [-H2 + 0.0055, H2 - 0.0055]) { const r0 = ring(dy, t + 0.0022), r1 = ring(dy, t + 0.0022); void r1; const wi = 0.0011; for (let k = 0; k < n; k += 1) { if (k % 2) continue; const A = r0[k], B = r0[(k + 1) % n]; const nn = norm3([A[0] - 0, 0, A[2] - 0.02]); const ids = [[A, -1], [B, -1], [B, 1], [A, 1]].map(([p, sg]) => o.buf.vert([p[0], p[1] + sg * wi, p[2]], nn, w(p), thread, 1)); o.buf.quad(ids[0], ids[1], ids[2], ids[3]); } }
        // keepers (two belt loops) + hole row on the free end
        for (const deg of [-58, 118]) { const a = deg * PI / 180, dir = new V(Math.sin(a), 0, -Math.cos(a)); const s = o.snap(new V(0, y, 0.015), dir, 0.15, 0.02, 0.06); o._box({ bind: 'auto', p: [s.x + dir.x * (t + 0.004), s.y, s.z + dir.z * (t + 0.004)], s: [0.006, H + 0.008, 0.024], rot: [0, -a + PI / 2 * 0, 0], mat: 'leather', color: col, rough: 0.55, wear: 0.6, bevel: 0.002 }); } }
    });
    if (opts.buckle !== false) this.parts.custom((o) => { // frame (4 bars), prong, tongue-end of the belt
      const p = o.snap(new V(0, y, 0.015), new V(0, 0, -1), 0.15, 0.02, 0.06).add(new V(0, 0, -0.0085)); const bm = { mat: 'metal', color: opts.buckleColor ?? 0x8a7a52, rough: 0.35, wear: 0.7, dirt: 0.5 }; const fw = 0.05, fh = H + 0.012; const bx = (px, py, sx, sy) => o._box({ bind: 'auto', p: [p.x + px, p.y + py, p.z - 0.002], s: [sx, sy, 0.0055], bevel: 0.0014, ...bm });
      bx(-fw / 2, 0, 0.007, fh); bx(fw / 2, 0, 0.007, fh); bx(0, fh / 2 - 0.0035, fw, 0.007); bx(0, -fh / 2 + 0.0035, fw, 0.007); o._box({ bind: 'auto', p: [p.x - 0.003, p.y, p.z - 0.0055], s: [0.004, fh - 0.006, 0.0032], bevel: 0.001, ...bm });
      o._box({ bind: 'auto', p: [p.x - 0.026, p.y, p.z + 0.001], s: [0.06, H - 0.004, 0.0075], mat: 'leather', color: col, rough: 0.55, wear: 0.6, bevel: 0.002 }); // the free end lying over the belt
    });
    return this;
  };
  // ---------------------------------------------------------------- backpack
  P.backpack = function (opts = {}) {
    const col = opts.color ?? 0x4a4a32, hi = this.lod === 0; const m = { mat: 'cloth', pattern: opts.pattern || 'canvas', color: col, rough: 0.9, dirt: 0.6, wear: 0.5 }; const dk = { ...m, color: 0x1e1e1c, pattern: 'weave', rough: 0.85 };
    this.parts.custom((o) => { const p = o.snap(new V(0, 1.22, 0.02), new V(0, 0, 1), 0.14); const z = p.z + 0.075;
      o._box({ bone: 'chest', weights: { chest: 0.6, spine2: 0.4 }, p: [p.x, p.y, z], s: [0.3, 0.38, 0.14], mat: m.mat, pattern: m.pattern, color: m.color, rough: 0.9, dirt: 0.6, bevel: 0.032 });
      o._box({ bone: 'chest', p: [p.x, p.y + 0.2, z + 0.004], s: [0.284, 0.07, 0.15], mat: m.mat, pattern: m.pattern, color: m.color, rough: 0.9, dirt: 0.6, bevel: 0.024 }); // lid
      o._box({ bone: 'chest', p: [p.x, p.y - 0.06, z + 0.088], s: [0.24, 0.2, 0.05], mat: m.mat, pattern: m.pattern, color: m.color, rough: 0.9, dirt: 0.6, bevel: 0.018 }); // front pocket
      if (hi) { for (const sx of [-1, 1]) { o._box({ bone: 'chest', p: [p.x + sx * 0.05, p.y + 0.02, z + 0.078], s: [0.026, 0.42, 0.006], mat: dk.mat, pattern: dk.pattern, color: dk.color, rough: 0.85, bevel: 0.0015 }); o._box({ bone: 'chest', p: [p.x + sx * 0.05, p.y + 0.145, z + 0.084], s: [0.03, 0.03, 0.01], mat: 'plastic', color: 0x14141a, rough: 0.5, bevel: 0.003 }); }
        o._box({ bone: 'chest', p: [p.x, p.y - 0.005, z + 0.114], s: [0.2, 0.004, 0.003], mat: 'metal', color: 0x8a8a84, rough: 0.35, wear: 0.4 }); // zip line of the front pocket
        o._sphere({ bone: 'chest', p: [p.x, p.y - 0.005, z + 0.117], scale: [0.012, 0.012, 0.004], seg: 8, mat: 'metal', color: 0x8a8a84, rough: 0.35 });
        for (const sx of [-1, 1]) o._lathe({ bone: 'chest', p: [p.x + sx * 0.165, p.y - 0.13, z + 0.01], profile: [[0.0, 0], [0.04, 0], [0.043, 0.02], [0.043, 0.2], [0.036, 0.215], [0.0, 0.216]], seg: 12, mat: m.mat, pattern: m.pattern, color: 0x2a2a28, rough: 0.9, dirt: 0.5 }); } });
    for (const sx of [-1, 1]) this.parts.strap([[sx * 0.1, 1.4, 0.12], [sx * 0.112, 1.46, 0.0], [sx * 0.112, 1.36, -0.112], [sx * 0.122, 1.2, -0.1], [sx * 0.135, 1.1, 0.06]], 0.052, 0.014, { mat: 'cloth', pattern: 'weave', color: 0x24241e, rough: 0.9, dirt: 0.5 }, {});
    if (hi) { this.parts.strap([[-0.11, 1.3, -0.113], [-0.05, 1.3, -0.135], [0.05, 1.3, -0.135], [0.11, 1.3, -0.113]], 0.02, 0.005, { mat: 'cloth', pattern: 'weave', color: 0x24241e, rough: 0.9 }, {}); this.parts.band({ y: 0.985, height: 0.052, thick: 0.012, lift: 0.006, center: [0, 0.015], seg: 26, mat: 'cloth', pattern: 'weave', color: 0x24241e, rough: 0.9 }); }
    return this;
  };
  // ---------------------------------------------------------------- knee pads / belt canister
  P.kneePads = function (opts = {}) {
    const hi = this.lod === 0; for (const s of ['L', 'R']) { const k = restPos('calf.' + s); this.parts.custom((o) => { const p = o.snap(new V(k.x, k.y + 0.01, k.z + 0.02), new V(0, 0, -1), 0.1); const mat = opts.mat || 'rubber', col = opts.color ?? 0x2a2622;
      o._sphere({ bind: 'auto', p: [p.x, p.y, p.z + 0.004], scale: [0.052, 0.068, 0.02], seg: hi ? 16 : 10, mat, color: col, rough: 0.8, dirt: 0.7 });
      if (hi) { for (const dy of [-0.024, 0, 0.024]) o._torus({ bind: 'auto', p: [p.x, p.y + dy, p.z + 0.008], R: 0.03, r: 0.0035, rot: [PI / 2, 0, 0], seg: 12, tseg: 4, arc: PI, arc0: PI / 2, mat, color: col, rough: 0.8, dirt: 0.7, flat: 1 });
        for (const dy of [0.05, -0.05]) o._band({ y: p.y + dy, height: 0.02, thick: 0.004, lift: 0.006, center: [k.x, k.z], seg: 16, mat: 'leather', color: 0x2a1e14, rough: 0.6, dirt: 0.7 }); } }); }
    return this;
  };
  P.beltCanister = function (opts = {}) {
    const x = opts.x ?? -0.12, y = opts.y ?? 0.96, hi = this.lod === 0; this.parts.custom((o) => { const p = o.snap(new V(x, y, 0.01), new V(x, 0, -0.05).normalize(), 0.15); const col = opts.color ?? 0x5a5a4a; const b = { mat: 'metal', color: col, rough: 0.45, wear: 0.7, dirt: 0.6 };
      o._lathe({ bind: 'auto', p: [p.x, p.y - 0.06, p.z - 0.034], profile: [[0, 0], [0.032, 0], [0.035, 0.004], [0.035, 0.02], [0.033, 0.024], [0.035, 0.028], [0.035, 0.104], [0.037, 0.108], [0.037, 0.112], [0.033, 0.114], [0.028, 0.114], [0.0, 0.116]], seg: 16, ...b });
      if (hi) { for (const dy of [0.045, 0.06, 0.075]) o._torus({ bind: 'auto', p: [p.x, p.y - 0.06 + dy, p.z - 0.034], R: 0.0355, r: 0.0022, rot: [0, 0, 0], seg: 18, tseg: 4, ...b }); o._box({ bind: 'auto', p: [p.x, p.y + 0.0, p.z - 0.005], s: [0.052, 0.014, 0.012], mat: 'leather', color: 0x2a1c12, rough: 0.6, wear: 0.6, bevel: 0.004 }); o._sphere({ bind: 'auto', p: [p.x, p.y + 0.056, p.z - 0.034], scale: [0.014, 0.014, 0.008], seg: 8, mat: 'rubber', color: 0x1c1c1a, rough: 0.7 }); } });
    return this;
  };
  // ---------------------------------------------------------------- held tools
  const gripFrame = (side) => { const A = RIG.arm[side]; const h = new V(...A.h), p = new V(...A.p), t = new V(...A.t); const w = new V(...A.wr); const c = w.clone().addScaledVector(h, 0.068).addScaledVector(p, 0.026); return { c, h, p, t }; };
  P.pickaxe = function (opts = {}) {
    const side = opts.hand || 'R'; const g = gripFrame(side); const hb = 'hand.' + side; const hi = this.lod === 0;
    const ax = g.h.clone().multiplyScalar(0.72).addScaledVector(g.t, 0.69).normalize(); const bot = g.c.clone().addScaledVector(ax, -0.13), top = g.c.clone().addScaledVector(ax, 0.66);
    const wood = { mat: 'rope', color: opts.handle ?? 0x5a3e24, rough: 0.7, wear: 0.5, dirt: 0.5, param: 0.6 };
    // hickory handle: oval section, swelling toward the butt, wrapped grip, metal collar under the head
    this.parts.tube([bot, bot.clone().addScaledVector(ax, 0.05), g.c.clone(), top.clone().addScaledVector(ax, -0.08), top], [0.0225, 0.0175, 0.0165, 0.0175, 0.019], wood, { bone: hb, seg: hi ? 10 : 6, flat: 0.86, sub: 3, caps: true });
    if (hi) for (let i = 0; i < 9; i++) this.parts.torusRing({ bone: hb, p: g.c.clone().addScaledVector(ax, -0.05 + i * 0.0085), R: 0.0178, r: 0.0034, rot: new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), ax), 'YXZ').toArray().slice(0, 3), seg: 12, tseg: 4, mat: 'leather', color: 0x2a2018, rough: 0.7, dirt: 0.6 });
    const pd = g.h.clone().addScaledVector(ax, -g.h.dot(ax)); if (pd.lengthSq() < 1e-6) pd.copy(g.p); pd.normalize(); const eye = top.clone().addScaledVector(ax, -0.02); const qq = new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), pd);
    const steel = { mat: 'metal', color: 0x3a3632, rough: 0.5, wear: 0.85, dirt: 0.6 };
    this.parts.box({ bone: hb, p: [eye.x, eye.y, eye.z], s: [0.046, 0.082, 0.04], rot: qq, bevel: 0.006, ...steel });
    for (const sgn of [-1, 1]) { const tip = eye.clone().addScaledVector(pd, sgn * 0.27).addScaledVector(ax, -0.052), mid = eye.clone().addScaledVector(pd, sgn * 0.15).addScaledVector(ax, -0.004), m2 = eye.clone().addScaledVector(pd, sgn * 0.075).addScaledVector(ax, 0.0); this.parts.tube([eye, m2, mid, tip], [0.021, 0.0175, 0.012, 0.0022], { ...steel, color: 0x403c36 }, { bone: hb, seg: hi ? 6 : 4, flat: 0.78, sub: 3, caps: true }); }
    if (hi) { this.parts.box({ bone: hb, p: [eye.x + ax.x * 0.048, eye.y + ax.y * 0.048, eye.z + ax.z * 0.048], s: [0.018, 0.022, 0.03], rot: qq, bevel: 0.003, ...steel }); this.parts.torusRing({ bone: hb, p: top.clone().addScaledVector(ax, -0.052), R: 0.0225, r: 0.004, rot: new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), ax), 'YXZ').toArray().slice(0, 3), seg: 12, tseg: 4, mat: 'metal', color: 0x5a544c, rough: 0.4, wear: 0.7 }); }
    this.info.tools.push({ kind: 'pickaxe', hand: side }); return this;
  };
  P.skiPoles = function (opts = {}) {
    const hi = this.lod === 0;
    for (const side of ['L', 'R']) { const g = gripFrame(side); const hb = 'hand.' + side; const ax = g.h.clone().multiplyScalar(0.62).addScaledVector(g.t, -0.78).normalize(); const rotE = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), ax), 'YXZ').toArray().slice(0, 3);
      this.parts.capsuleBetween(g.c.clone().addScaledVector(ax, -0.06), g.c.clone().addScaledVector(ax, 1.05), 0.0085, 0.0062, { mat: 'metal', color: opts.color ?? 0x9aa0a8, rough: 0.3, wear: 0.4 }, { bone: hb, rigid: true, seg: hi ? 8 : 5 });
      this.parts.tube([g.c.clone().addScaledVector(ax, -0.075), g.c.clone().addScaledVector(ax, -0.03), g.c.clone().addScaledVector(ax, 0.04), g.c.clone().addScaledVector(ax, 0.085)], [0.0135, 0.0185, 0.0175, 0.012], { mat: 'rubber', color: 0x1a1a1a, rough: 0.6, wear: 0.5, dirt: 0.5 }, { bone: hb, seg: hi ? 10 : 6, sub: 2, caps: true });
      if (hi) { for (let i = 0; i < 4; i++) this.parts.torusRing({ bone: hb, p: g.c.clone().addScaledVector(ax, -0.03 + i * 0.018), R: 0.0175, r: 0.0022, rot: rotE, seg: 12, tseg: 4, mat: 'rubber', color: 0x101010, rough: 0.6 });
        this.parts.tube([g.c.clone().addScaledVector(ax, 0.075).addScaledVector(g.p, 0.02), g.c.clone().addScaledVector(ax, 0.02).addScaledVector(g.p, 0.055), g.c.clone().addScaledVector(ax, -0.05).addScaledVector(g.p, 0.03)], [0.005, 0.005, 0.005], { mat: 'cloth', pattern: 'weave', color: 0x202028, rough: 0.9 }, { bone: hb, seg: 4, flat: 0.4, sub: 3 }); }
      // basket (ring + disc + spokes) and carbide tip
      const tipP = g.c.clone().addScaledVector(ax, 0.93); this.parts.torusRing({ bone: hb, p: tipP, R: 0.046, r: 0.0055, rot: rotE, seg: hi ? 20 : 10, tseg: 4, mat: 'plastic', color: 0x222222, rough: 0.5 });
      this.parts.lathe({ bone: hb, p: tipP.clone().addScaledVector(ax, -0.004), profile: [[0.0, 0.0], [0.012, 0.0], [0.042, -0.005], [0.046, -0.012]], rot: rotE, seg: hi ? 20 : 10, double: true, mat: 'plastic', color: 0x1a1a1a, rough: 0.5, wear: 0.5 });
      this.parts.lathe({ bone: hb, p: tipP.clone().addScaledVector(ax, 0.02), profile: [[0.0075, -0.02], [0.0075, 0.0], [0.004, 0.06], [0.0, 0.066]], rot: rotE, seg: 8, mat: 'metal', color: 0x50504e, rough: 0.4, wear: 0.6 }); }
    return this;
  };
  // ---------------------------------------------------------------- goggles (frame, foam, lens, vents, strap with adjuster) + respirator (half mask, canisters with threads, valve, straps)
  const OLDG = P.goggles, OLDR = P.respirator; P.goggles = function (opts = {}) {
    if (globalThis.__ZCLOTH_OFF) return OLDG.call(this, opts); const hi = this.lod === 0; const where = opts.on || 'forehead'; const dy = where === 'eyes' ? -0.02 : where === 'helmet' ? 0.048 : 0.032; const dz = where === 'eyes' ? -0.095 : where === 'helmet' ? -0.118 : -0.098;
    const up = where === 'eyes' ? 0 : -0.45; const frame = { mat: 'rubber', color: opts.frame ?? 0x1c1c1c, rough: 0.7, dirt: 0.5 }; const foam = { mat: 'cloth', pattern: 'fleece', color: 0x262626, rough: 0.95, dirt: 0.5 };
    for (const sx of [-1, 1]) { const p = [sx * 0.034, HC.y + dy, HC.z + dz]; const rot = [-Math.PI / 2 + up, sx * 0.18, 0];
      this.parts.lathe({ bone: 'head', p, profile: [[0.0, 0.0], [0.026, 0.0], [0.029, 0.008], [0.028, 0.02], [0.024, 0.026]], rot, seg: hi ? 18 : 10, ...frame }); // cup
      this.parts.torusRing({ bone: 'head', p, R: 0.0275, r: hi ? 0.0052 : 0.004, rot, seg: hi ? 18 : 10, tseg: 5, ...foam }); // foam seal against the face
      this.parts.lathe({ bone: 'head', p: [p[0], p[1] + (where === 'eyes' ? 0 : 0.008), p[2] - 0.019], profile: [[0.0, 0.004], [0.022, 0.0025], [0.026, 0.0]], rot, seg: hi ? 18 : 10, mat: 'glass', color: opts.lens ?? 0x202830, wear: 0.4, dirt: 0.5 }); // domed lens
      if (hi) { this.parts.torusRing({ bone: 'head', p: [p[0], p[1] + (where === 'eyes' ? 0 : 0.008), p[2] - 0.0185], R: 0.0255, r: 0.0022, rot, seg: 18, tseg: 4, ...frame }); for (const k of [-1, 0, 1]) this.parts.box({ bone: 'head', p: [p[0] + sx * 0.006 + k * 0.009, p[1] + (where === 'eyes' ? 0.026 : 0.034), p[2] - 0.012], s: [0.006, 0.0022, 0.004], rot, mat: 'plastic', color: 0x0c0c0c, rough: 0.6 }); } }
    this.parts.box({ bone: 'head', p: [0, HC.y + dy + 0.004, HC.z + dz + 0.002], s: [0.024, 0.014, 0.012], mat: 'rubber', color: opts.frame ?? 0x1c1c1c, rough: 0.7, bevel: 0.003 });
    this.parts.band({ y: HC.y + dy + 0.005, height: 0.024, thick: 0.004, lift: where === 'helmet' ? 0.005 : 0.004, center: [0, HC.z + 0.01], seg: 26, mat: 'cloth', pattern: 'stripes', color: opts.strap ?? 0x2a2a2a, rough: 0.85, tilt: where === 'eyes' ? 0.0 : 0.01, window: 0.02 });
    if (hi) this.parts.box({ bone: 'head', p: [0.098, HC.y + dy + 0.005, HC.z + 0.0], s: [0.012, 0.028, 0.007], mat: 'plastic', color: 0x111111, rough: 0.5, bevel: 0.002 }); // strap adjuster
    return this; };
  P.respirator = function (opts = {}) {
    if (globalThis.__ZCLOTH_OFF) return OLDR.call(this, opts); const hi = this.lod === 0; const m = { mat: 'rubber', color: opts.color ?? 0x232322, rough: 0.72, dirt: 0.5 }; const c = [0, HC.y - 0.078, HC.z - 0.095];
    this.parts.lathe({ bone: 'head', p: c, profile: [[0.046, -0.022], [0.049, -0.012], [0.045, 0.004], [0.036, 0.022], [0.02, 0.034], [0.0, 0.037]], rot: [-Math.PI / 2 + 0.25, 0, 0], scale: [1.1, 0.96], seg: hi ? 26 : 14, ...m });
    if (hi) this.parts.torusRing({ bone: 'head', p: [c[0], c[1] + 0.003, c[2] + 0.012], R: 0.047, r: 0.0045, rot: [-Math.PI / 2 + 0.25, 0, 0], scale: [1.1, 0.96], seg: 26, tseg: 5, ...m }); // sealing lip
    const n = opts.canisters ?? 2; const f = { mat: 'metal', color: opts.filterColor ?? 0x6a6240, rough: 0.45, wear: 0.6, dirt: 0.6 };
    const can = (p, rot, r, L) => { this.parts.lathe({ bone: 'head', p, profile: [[0.0, 0], [r, 0], [r * 1.06, 0.004], [r * 1.06, L], [r * 0.9, L + 0.004], [0, L + 0.005]], rot, seg: hi ? 18 : 10, ...f }); if (hi) { for (let k = 0; k < 4; k++) this.parts.torusRing({ bone: 'head', p: [p[0] + Math.sin(rot[1]) * (0.003 + k * 0.0032) * -1, p[1] + 0.0, p[2] - Math.cos(rot[0] + Math.PI / 2) * 0.0 - (0.003 + k * 0.0032) * 0.9], R: r * 1.07, r: 0.0012, rot, seg: 16, tseg: 3, mat: 'metal', color: 0x3a3830, rough: 0.5, wear: 0.6 }); this.parts.lathe({ bone: 'head', p: [p[0], p[1], p[2]], profile: [[r * 1.0, L * 0.5], [r * 1.09, L * 0.52], [r * 1.09, L * 0.6], [r * 1.0, L * 0.62]], rot, seg: 16, mat: 'plastic', color: 0xb8a030, rough: 0.5, wear: 0.4, dirt: 0.5 }); } };
    if (n === 1) can([0, c[1] - 0.012, c[2] - 0.04], [-Math.PI / 2 - 0.25, 0, 0], 0.036, 0.052); else for (const sx of [-1, 1]) can([sx * 0.04, c[1] - 0.01, c[2] - 0.012], [-Math.PI / 2 - 0.2, sx * 0.9, 0], 0.03, 0.036);
    if (hi) { this.parts.lathe({ bone: 'head', p: [0, c[1] - 0.026, c[2] - 0.05], profile: [[0.0, 0], [0.011, 0], [0.012, 0.004], [0.009, 0.01], [0, 0.011]], rot: [-Math.PI / 2 - 0.1, 0, 0], seg: 12, mat: 'plastic', color: 0x9a9a92, rough: 0.4 }); for (const k of [-1, 0, 1]) this.parts.box({ bone: 'head', p: [k * 0.004, c[1] - 0.026, c[2] - 0.062], s: [0.003, 0.0015, 0.004], mat: 'plastic', color: 0x101010 }); } // exhale valve
    this.parts.band({ y: HC.y - 0.05, height: 0.02, thick: 0.003, center: [0, HC.z + 0.01], seg: 24, mat: 'rubber', color: 0x1e1e1e, tilt: -0.02, window: 0.02 });
    this.parts.band({ y: HC.y + 0.025, height: 0.018, thick: 0.003, center: [0, HC.z + 0.01], seg: 24, mat: 'rubber', color: 0x1e1e1e, tilt: 0.045, window: 0.02 });
    if (hi) for (const sx of [-1, 1]) this.parts.box({ bone: 'head', p: [sx * 0.086, HC.y - 0.052, HC.z - 0.02], s: [0.012, 0.018, 0.008], mat: 'plastic', color: 0x14141a, rough: 0.5, bevel: 0.002 }); // strap buckles
    return this; };
  // ---------------------------------------------------------------- sou'wester + hood (real construction: shell thickness, rolled edges, drawstring, fur trim)
  const OLDS = P.souwester, OLDH = P.hood; const smooth01 = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  P.souwester = function (opts = {}) {
    if (globalThis.__ZCLOTH_OFF) return OLDS.call(this, opts); hatOn(this); const hi = this.lod === 0; const m = { mat: 'cloth', pattern: 'oilskin', color: opts.color ?? 0xc8a020, rough: 0.5, dirt: 0.5, wear: 0.45 }; const c = [HC.x, HC.y + 0.004, HC.z + 0.012];
    this.parts.custom((o) => { const spec = o._spec(m), n = o.seg(44), mm = o.seg(12); domeShell(o, spec, c, 0.099, 0.121, 0.104, { n, m: mm, thick: 0.003, dent: hi ? 0.0013 : 0, seed: 21, boxy: 1.0 });
      brim(o, spec, c, 0.099, 0.121, (a) => 0.034 + 0.062 * Math.pow(Math.max(0, -Math.cos(a)), 1.4) + 0.012 * Math.max(0, Math.cos(a)), { n, tilt: 0.026, th: 0.0034 });
      if (hi) { chinStrap(o, 0x2a2214, c[1], 0.1, c[2]); const rib = o._spec({ mat: 'cloth', pattern: 'oilskin', color: opts.color ?? 0xc8a020, rough: 0.5, dirt: 0.5 }); const pts = []; for (let i = 0; i <= 12; i++) { const a = -PI * 0.5 + i / 12 * PI; pts.push(new V(c[0] + Math.sin(a) * 0.05, c[1] + 0.07 + Math.cos(a) * 0.03, c[2] + 0.02 + Math.cos(a) * 0.09)); } } });
    hatOff(this); return this; };
  P.hood = function (opts = {}) {
    if (globalThis.__ZCLOTH_OFF) return OLDH.call(this, opts); const hi = this.lod === 0; const m = { mat: 'cloth', pattern: opts.pattern || 'ripstop', color: opts.color ?? 0x2a4a7a, rough: 0.8, dirt: 0.4, wear: 0.35 }; const fur = opts.fur;
    this.parts.custom((o) => { const spec = o._spec(m), n = o.seg(28);
      if (opts.up) { // hood up: shell lofted over the skull, open face, rolled binding, drawstring, fur ruff
        const c = [HC.x, HC.y - 0.004, HC.z + 0.024]; const rows = []; const nu = o.seg(12); for (let j = 0; j <= nu; j++) { const t = j / nu, ph = t * Math.PI * 0.5 * 0.98; rows.push(ringArc(n, PI * 0.3, PI * 1.7, (a, sa, ca) => { const front = Math.max(0, -ca); const f = Math.cos(ph); const puck = 1 + 0.035 * noise3(sa * 2.2, t * 3, ca * 2.2, 31); return [c[0] + sa * 0.135 * f * puck, c[1] + Math.sin(ph) * 0.15 - front * 0.018 * (1 - t), c[2] + ca * 0.152 * f * puck]; })); }
        loft(o, rows.slice(0, -1), { spec, w: [['head', 1]], ao: 0.8, open: true });
        { const lin = o._spec({ mat: 'cloth', pattern: 'weave', color: 0x22262c, rough: 0.9, dirt: 0.6 }); const inner = rows.slice(0, -1).map((rw) => rw.map((p) => [c[0] + (p[0] - c[0]) * 0.955, c[1] + (p[1] - c[1]) * 0.955, c[2] + (p[2] - c[2]) * 0.955])); loft(o, inner, { spec: lin, w: [['head', 1]], ao: 0.45, open: true, flip: true }); } // lining (the hood is seen from inside, behind the face)
        const bind = o._spec({ mat: 'cloth', pattern: 'weave', color: opts.color ?? 0x2a4a7a, rough: 0.8, dirt: 0.5 });
        o._torus({ bone: 'head', p: [0, HC.y - 0.024, HC.z - 0.09], R: 0.104, r: 0.0085, rot: [PI / 2 - 0.22, 0, 0], seg: hi ? 26 : 14, tseg: 5, mat: 'cloth', pattern: 'weave', color: opts.color ?? 0x2a4a7a, rough: 0.8, dirt: 0.5, wear: 0.4 });
        if (hi) { o._torus({ bone: 'head', p: [0, HC.y - 0.024, HC.z - 0.099], R: 0.098, r: 0.0026, rot: [PI / 2 - 0.22, 0, 0], seg: 26, tseg: 4, mat: 'rubber', color: 0x161616, rough: 0.7 }); for (const sx of [-1, 1]) { o._tubeRaw([new V(sx * 0.052, HC.y - 0.128, HC.z - 0.07), new V(sx * 0.056, HC.y - 0.17, HC.z - 0.078), new V(sx * 0.05, HC.y - 0.21, HC.z - 0.07)], [0.0026, 0.0026, 0.0026], o._spec({ mat: 'rubber', color: 0x161616, rough: 0.7 }), { seg: 5, sub: 2, bone: 'neck' }); o._box({ bone: 'neck', p: [sx * 0.05, HC.y - 0.216, HC.z - 0.07], s: [0.011, 0.016, 0.011], mat: 'plastic', color: 0x1c1c1c, rough: 0.5, bevel: 0.003 }); } }
        if (fur) { o._torus({ bone: 'head', p: [0, HC.y - 0.02, HC.z - 0.085], R: 0.1, r: 0.024, rot: [PI / 2 - 0.25, 0, 0], seg: hi ? 26 : 14, tseg: 7, mat: 'fur', color: fur, rough: 1, dirt: 0.35 }); if (hi) o._torus({ bone: 'head', p: [0.002, HC.y - 0.018, HC.z - 0.09], R: 0.108, r: 0.015, rot: [PI / 2 - 0.3, 0.05, 0], seg: 26, tseg: 6, mat: 'fur', color: fur, rough: 1, dirt: 0.5 }); }
      } else { // hood down: bunched cowl round the back of the neck (rolled, folded, with a stitched seam)
        const rows = []; for (let j = 0; j < 7; j++) { const t = j / 6; const yy = 1.435 + Math.sin(t * PI) * 0.035 + (t - 0.5) * 0.05; rows.push(ringAt(n, (a, sa, ca, k) => { const back = 0.5 + 0.5 * ca; const R = 0.118 + Math.sin(t * PI) * (0.038 + 0.02 * back) * (1 + 0.14 * noise3(sa * 3.1, t * 2, ca * 3.1, 51)); return [sa * R * 0.98, yy + back * 0.012 * Math.sin(t * PI), 0.048 + ca * R * 0.95]; })); }
        loft(o, rows, { spec, w: [['chest', 0.6], ['neck', 0.4]], ao: (t) => 0.7 + 0.3 * Math.sin(t * PI) });
        if (fur) o._torus({ bone: 'chest', p: [0, 1.5, 0.058], R: 0.09, r: 0.022, rot: [0.25, 0, 0], arc: PI * 1.25, arc0: -PI * 0.12, seg: 22, tseg: 7, weights: { chest: 0.6, neck: 0.4 }, mat: 'fur', color: fur, rough: 1 }); } });
    return this; };
  // ---------------------------------------------------------------- tatters: ragged strips, forked ends, frayed threads
  P.tatters = function (opts = {}) {
    const rng = this.rng, m = { mat: 'cloth', pattern: opts.pattern || 'canvas', color: opts.color ?? 0x2a2a28, rough: 0.9, dirt: 0.7, wear: 0.6 }; const y0 = opts.y ?? 0.93, n = opts.count ?? 5; const hi = this.lod === 0;
    for (let i = 0; i < n; i++) {
      const a = opts.side === 'back' ? PI * (0.6 + rng() * 0.8) : opts.side === 'front' ? PI * (-0.35 + rng() * 0.7) : rng() * TAU; const L = (opts.length ?? 0.12) * (0.6 + rng() * 0.8), W = (opts.width ?? 0.035) * (0.7 + rng() * 0.6); const seed = rng() * 50, fork = rng() < 0.6;
      this.parts.custom((o) => {
        const dir = new V(Math.sin(a), 0, -Math.cos(a)); const top = o.snap(new V(0, y0, 0.015), dir, 0.18, 0.02).addScaledVector(dir, 0.002); const w0 = o.weightsAt(top); const side = new V(-dir.z, 0, dir.x); const segs = o.seg(6); const prongs = fork && hi ? 2 : 1; const th = 0.0016;
        for (let pr = 0; pr < prongs; pr++) { const off = prongs === 1 ? 0 : (pr - 0.5) * W * 0.5; const Lp = L * (pr ? 0.62 + 0.3 * noise3(seed, pr, 0, 1) * 0 : 1) * (prongs === 2 ? (pr ? 0.72 : 1) : 1); const ww = prongs === 2 ? W * 0.5 : W; let pl = -1, pr2 = -1, pl2 = -1, pr3 = -1;
          for (let k = 0; k <= segs; k++) { const t = k / segs; const jag = 1 - 0.25 * (noise3(seed + pr * 7, t * 5, 0, 2) * 0.5 + 0.5) * t; const p = top.clone().add(new V(0, -t * Lp, 0)).addScaledVector(dir, t * 0.012 + Math.sin(t * 3 + a) * 0.006 + t * t * 0.01).addScaledVector(side, off * (1 + t * 0.4) + noise3(seed, t * 4, pr, 3) * 0.006 * t); const hw = ww * 0.5 * (1 - t * 0.55) * jag; const spec = o._spec({ ...m, sway: t * 0.9 }); const spec2 = o._spec({ ...m, sway: t * 0.9, dirt: 0.9, color: 0x101010 });
            const l = o.buf.vert(p.clone().addScaledVector(side, hw), dir, w0, spec, 0.8), r = o.buf.vert(p.clone().addScaledVector(side, -hw), dir, w0, spec, 0.8); const l2 = o.buf.vert(p.clone().addScaledVector(side, hw).addScaledVector(dir, -th), dir.clone().negate(), w0, spec2, 0.5), r2 = o.buf.vert(p.clone().addScaledVector(side, -hw).addScaledVector(dir, -th), dir.clone().negate(), w0, spec2, 0.5);
            if (pl >= 0) { o.buf.quad(pl, pr2, r, l); o.buf.quad(pl2, l2, r2, pr3); o.buf.quad(pl, l, l2, pl2); o.buf.quad(pr2, pr3, r2, r); } pl = l; pr2 = r; pl2 = l2; pr3 = r2; }
          if (hi) for (let f = 0; f < 4; f++) { const t = 1, base = top.clone().add(new V(0, -Lp, 0)).addScaledVector(dir, 0.012 + 0.01).addScaledVector(side, off + (f - 1.5) * ww * 0.22); const tip = base.clone().add(new V((noise3(seed, f, 0, 4)) * 0.006, -0.012 - 0.02 * (0.5 + 0.5 * noise3(seed, f, 1, 5)), 0)); const s3 = o._spec({ ...m, sway: 1 }); const q0 = o.buf.vert(base.clone().addScaledVector(side, 0.0012), dir, w0, s3, 0.7), q1 = o.buf.vert(base.clone().addScaledVector(side, -0.0012), dir, w0, s3, 0.7), q2 = o.buf.vert(tip, dir, w0, s3, 0.7); o.buf.tri(q0, q1, q2); o.buf.tri(q1, q0, q2); void t; } }
      });
    }
    return this;
  };
  wrap();
}
