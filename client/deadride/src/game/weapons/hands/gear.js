// Wrist gear (left arm): steel field watch (40 mm case with polished bevel, fluted bezel with minute ticks, knurled crown + guards, four lugs with
// spring bars, dial with 12 raised lume indices, three hands) on a stitched leather strap with real keeper loops, punched holes and a buckle.
// Built in the LEFT arm frame (thumb side +X, back of hand +Y); watch-local axes: +X = 3 o'clock (toward the hand, arm -Z), +Z = 6 o'clock (arm +X).
import * as THREE from 'three';
import { GB, Surf, surfGrid, stitchLine, clamp, sm, lerp, gs, spow, TAU, lin } from './kit.js';
import { B, NB } from './anat.js';

const V3 = THREE.Vector3;
const FORE_L = B.fore + NB;
const ZC = 0.108;                      // watch centre along the forearm
const skinA = (z) => 0.0272 + 0.0105 * sm(0, 0.25, z), skinB = (z) => 0.0190 + 0.0085 * sm(0, 0.25, z);
const YC = skinB(ZC) + 0.0022;         // case back sits on the strap (2.2 mm above the skin)
const W1 = [[FORE_L, 1]];
// zones for the hardware material: aZ = [dial, leather strap, lume, keeper/buckle steel]; aX = [wear, dirt, brushed, ao]
const STEEL = lin(0x8a8d92), POL = lin(0xb4b7bc), BLK = lin(0x0d0e10), LUME = lin(0xcfe8b8), LEATH = lin(0x241d17), HANDS = lin(0xe6e8ea);
const mv = (x, y, z, out) => out.set(z, y + YC, -x + ZC);          // local -> arm frame
const mn = (x, y, z, out) => out.set(z, y, -x);
const _p = new V3(), _n = new V3();
function vtx(gb, p, n, u, v, col, z, x) { mv(p[0], p[1], p[2], _p); mn(n[0], n[1], n[2], _n); return gb.vert(_p, _n, u, v, col, W1, z, x, null); }
/** revolve a profile [[r, y], ...] around local Y; hard edges where the profile turns more than `sharp` degrees */
function lathe(gb, prof, seg, col, zone, x, { cx = 0, cy = 0, cz = 0, sharp = 50, uvDial = false, r0 = 0, r1 = 1, ax = 'y' } = {}) {
  const n = prof.length; const S = []; const nor = (i) => { const a = prof[i], b = prof[i + 1]; const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1; return [dy / l, -dr / l]; };
  for (let i = 0; i < n; i++) { const nin = i > 0 ? nor(i - 1) : null, nout = i < n - 1 ? nor(i) : null; if (nin && nout) { const cs = nin[0] * nout[0] + nin[1] * nout[1]; if (Math.acos(clamp(cs, -1, 1)) * 180 / Math.PI > sharp) { S.push({ p: prof[i], n: nin }); S.push({ p: prof[i], n: nout, brk: true }); continue; } const l = Math.hypot(nin[0] + nout[0], nin[1] + nout[1]) || 1; S.push({ p: prof[i], n: [(nin[0] + nout[0]) / l, (nin[1] + nout[1]) / l] }); } else S.push({ p: prof[i], n: nin || nout }); }
  const rows = []; for (const s of S) { const r = []; for (let k = 0; k <= seg; k++) { const a = k / seg * TAU, ca = Math.cos(a), sa = Math.sin(a); const p = ax === 'x' ? [cx + s.p[1], cy + s.p[0] * ca, cz + s.p[0] * sa] : [cx + s.p[0] * ca, cy + s.p[1], cz + s.p[0] * sa], nn = ax === 'x' ? [s.n[1], s.n[0] * ca, s.n[0] * sa] : [s.n[0] * ca, s.n[1], s.n[0] * sa]; r.push(vtx(gb, p, nn, uvDial ? 0.5 + p[0] / (2 * r1) : k / seg, uvDial ? 0.5 - p[2] / (2 * r1) : s.p[1] * 20, col, zone, x)); } rows.push(r); }
  for (let i = 0; i < S.length - 1; i++) { if (S[i + 1].brk) continue; for (let k = 0; k < seg; k++) gb.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]); }
}
/** small bevelled box (local frame) centred at c with size s, rotated about Y by ry */
function box(gb, c, s, ry, col, zone, x, bev = 0.0002) {
  const ca = Math.cos(ry), sa = Math.sin(ry); const hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2; const P = [], N = [];
  const corner = (sx, sy, sz) => [sx * hx, sy * hy, sz * hz]; const rot = (v) => [c[0] + v[0] * ca + v[2] * sa, c[1] + v[1], c[2] - v[0] * sa + v[2] * ca]; const rn = (v) => [v[0] * ca + v[2] * sa, v[1], -v[0] * sa + v[2] * ca];
  const faces = [[[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]], [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]], [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]]];
  for (const [nr, cs] of faces) { const ids = cs.map((q, i) => { const cc = corner(q[0], q[1], q[2]); const bb = [q[0] * bev * 0.7 + nr[0] * 0.3, q[1] * bev * 0.7 + nr[1] * 0.3, q[2] * bev * 0.7 + nr[2] * 0.3]; const nn = [nr[0] + q[0] * 0.35, nr[1] + q[1] * 0.35, nr[2] + q[2] * 0.35]; const l = Math.hypot(...nn); const pp = rot(cc); return vtx(gb, pp, rn([nn[0] / l, nn[1] / l, nn[2] / l]), i * 0.001, 0, col, zone, x); }); gb.quad(ids[0], ids[1], ids[2], ids[3]); }
}
const SW = [0, 0, 0, 1];
export function buildWatch() {
  const gb = new GB(); const st = (br = 0.7) => [0.1, 0.2, br, 1];
  // ---- case: mid-case, polished bevels, bezel
  lathe(gb, [[0, 0.0], [0.0180, 0.0], [0.0190, 0.0005], [0.0198, 0.0016], [0.0200, 0.0024], [0.0200, 0.0070], [0.0198, 0.0078], [0.0199, 0.0083]], 64, STEEL, [0, 0, 0, 0], st(0.8), { sharp: 40 });
  lathe(gb, [[0.0199, 0.0083], [0.0201, 0.0088], [0.0201, 0.0102], [0.0198, 0.0106], [0.0192, 0.0108], [0.0182, 0.0104], [0.0176, 0.0096], [0.0176, 0.0088]], 64, POL, [0, 0, 0, 0], [0.05, 0.1, 0.0, 1], { sharp: 40 });
  for (let i = 0; i < 60; i++) { const a = i / 60 * TAU; const r = 0.0201; box(gb, [Math.cos(a) * r, 0.0095, Math.sin(a) * r], [0.0007, 0.0012, 0.0011], -a, STEEL, [0, 0, 0, 0], st(0.9), 0.00008); } // coin-edge flutes (60 real ridges)
  for (let i = 0; i < 60; i++) { const a = i / 60 * TAU; const big = i % 5 === 0; const r = 0.0188; box(gb, [Math.cos(a) * r, 0.0106, Math.sin(a) * r], [big ? 0.0016 : 0.0006, 0.0003, big ? 0.0005 : 0.0003], -a + Math.PI / 2, big ? LUME : BLK, big ? [0, 0, 1, 0] : [0, 0, 0, 0], [0, 0.1, 0, 1], 0.00005); } // bezel minute ticks / 5-min lume dots
  // ---- dial (textured disc, glossy under an implied sapphire crystal) + hour indices + hands
  lathe(gb, [[0, 0.0089], [0.0170, 0.0089]], 48, BLK, [1, 0, 0, 0], [0, 0, 0, 1], { uvDial: true, r1: 0.0176 });
  lathe(gb, [[0.0170, 0.0089], [0.0172, 0.0094], [0.0180, 0.0098]], 48, POL, [0, 0, 0, 0], [0.02, 0.05, 0.0, 1], {});
  for (let h = 0; h < 12; h++) { const a = h / 12 * TAU; const r = 0.0142; const q = h % 3 === 0; box(gb, [Math.sin(a) * r, 0.0092, -Math.cos(a) * r], q ? [0.0034, 0.0007, 0.0021] : [0.0011, 0.0007, 0.0038], -a, STEEL, [0, 0, 0, 0], st(0.9), 0.00006); box(gb, [Math.sin(a) * r, 0.0096, -Math.cos(a) * r], q ? [0.0026, 0.0005, 0.0014] : [0.0007, 0.0005, 0.0031], -a, LUME, [0, 0, 1, 0], [0, 0, 0, 1], 0.00005); }
  const hand = (len, w, ang, y, tail, col, zone) => { const dx = Math.sin(ang), dz = -Math.cos(ang); const cx = dx * (len - tail) / 2, cz = dz * (len - tail) / 2; box(gb, [cx, y, cz], [w, 0.0004, len + tail], -ang, col, zone, [0, 0, 0.5, 1], 0.00006); };
  hand(0.0088, 0.0021, (10 + 8 / 60) / 12 * TAU, 0.0100, 0.0012, HANDS, [0, 0, 0, 0]); hand(0.0088, 0.0011, (10 + 8 / 60) / 12 * TAU, 0.0104, 0.0012, LUME, [0, 0, 1, 0]);
  hand(0.0136, 0.0016, 8 / 60 * TAU, 0.0106, 0.0016, HANDS, [0, 0, 0, 0]); hand(0.0128, 0.0008, 8 / 60 * TAU, 0.0110, 0.0016, LUME, [0, 0, 1, 0]);
  hand(0.0150, 0.0005, 36 / 60 * TAU, 0.0113, 0.0035, [0.5, 0.05, 0.03], [0, 0, 0, 0]); lathe(gb, [[0, 0.0111], [0.0016, 0.0113], [0.0016, 0.0116], [0, 0.0117]], 16, STEEL, [0, 0, 0, 0], st(0.9), {});
  // ---- crown (3 o'clock) with guards, knurl and a gasket ring
  for (const s of [-1, 1]) box(gb, [0.0206, 0.0076, s * 0.0062], [0.0058, 0.0056, 0.0026], 0, STEEL, [0, 0, 0, 0], st(0.8), 0.0004);
  lathe(gb, [[0, 0.0000], [0.0028, 0.0000], [0.0032, 0.0004], [0.0032, 0.0034], [0.0029, 0.0038], [0, 0.0038]], 20, STEEL, [0, 0, 0, 0], st(0.8), { ax: 'x', cx: 0.0198, cy: 0.0076, cz: 0 });
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; box(gb, [0.0198 + 0.0022, 0.0076 + Math.sin(a) * 0.0031, Math.cos(a) * 0.0031], [0.0034, 0.0005, 0.0005], 0, STEEL, [0, 0, 0, 0], st(0.9), 0.00006); }
  // ---- lugs + spring bars (12 and 6 o'clock = local -Z / +Z)
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) { box(gb, [sx * 0.0121, 0.0032, sz * 0.0228], [0.0034, 0.0064, 0.0086], 0, STEEL, [0, 0, 0, 0], st(0.8), 0.0004); box(gb, [sx * 0.0121, 0.0017, sz * 0.0274], [0.0034, 0.0032, 0.0022], 0, STEEL, [0, 0, 0, 0], st(0.8), 0.0005); }
  // ---- strap: rounded-rectangle loft around the forearm, from the right lug, under the wrist, to the left lug
  const skin = (z, th, out) => { const c = Math.cos(th), sn = Math.sin(th); return out.set(skinA(z) * spow(c, 2 / 2.3), skinB(z) * spow(sn, 2 / 2.3), z); };
  const T0 = 0.66, T1 = Math.PI - 0.66 - TAU; const W = 0.022, TH = 0.0026; const tmpA = new V3(), tmpB = new V3(), tmpC = new V3();
  const strapF = (phi, v, out) => { const c = Math.cos(phi), sn = Math.sin(phi); const ax = 0.0022, ay = skinB(ZC); /* centre line offset from the skin surface */
    skin(ZC, phi, tmpA); skin(ZC, phi + 0.01, tmpB); tmpB.sub(tmpA); const nx = tmpB.y, ny = -tmpB.x; const l = Math.hypot(nx, ny) || 1; let ox = nx / l, oy = ny / l; if (ox * tmpA.x + oy * tmpA.y < 0) { ox = -ox; oy = -oy; }
    const lift = 0.0104 * Math.pow(sm(T0 - 0.62, T0, phi) + sm(T1 + 0.62, T1, phi) * 0, 1.0) + 0.0104 * sm(T1 + 0.62, T1, phi); const g = 0.0016 + lift; const cz = W / 2 * spow(Math.cos(v), 2 / 5), cn = TH / 2 * spow(Math.sin(v), 2 / 5);
    return out.set(tmpA.x + ox * (g + cn), tmpA.y + oy * (g + cn), ZC + cz); };
  const strap = new Surf(strapF, (phi, out) => skin(ZC, phi, out).multiplyScalar(0.0), () => W1, { du: 3e-3, dv: 3e-3 });
  const us = []; { const n = 56; for (let k = 0; k <= n; k++) us.push(T0 + (T1 - T0) * k / n); } const vs = []; for (let k = 0; k <= 12; k++) vs.push(k / 16 * TAU);
  surfGrid(gb, strap, us, vs, (i, j, u, v) => ({ c: LEATH, z: [0, 1, 0, 0], x: [0.35, 0.3, 0, 0.95], j: [0, 0, 0, 0] }), { uvScale: 1 });
  // keeper loops (two) + punched holes + edge stitching + buckle at the underside
  for (const k of [-1.55, -1.95]) { const k0 = k, us2 = [k0 - 0.09, k0 - 0.075, k0 - 0.05, k0, k0 + 0.05, k0 + 0.075, k0 + 0.09]; surfGrid(gb, strap, us2, vs, () => ({ c: LEATH, z: [0, 1, 0, 0], x: [0.4, 0.3, 0, 0.9], j: [0, 0, 0, 0] }), { off: (u) => 0.0007 * Math.pow(clamp(Math.min(u - (k0 - 0.09), k0 + 0.09 - u) / 0.02), 0.5) }); }
  for (let h = 0; h < 6; h++) { const hp = new V3(), hn = new V3(); const ph2 = -0.30 - h * 0.13; strap.pos(ph2, Math.PI / 2, hp); strap.nrm(ph2, Math.PI / 2, hn); const t1 = new V3().crossVectors(hn, new V3(0, 0, 1)).normalize(), t2 = new V3().crossVectors(hn, t1).normalize();
    const ring = (r, dy, col) => { const ids = []; for (let k = 0; k <= 12; k++) { const a = k / 12 * TAU; const q = hp.clone().addScaledVector(hn, dy).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r); ids.push(gb.vert(q, hn, k * 0.001, 0, col, W1, [0, 1, 0, 0], [0.5, 0.6, 0, 0.6])); } return ids; };
    const o = ring(0.0024, 0.0002, LEATH), m = ring(0.0018, 0.0003, LEATH), i = ring(0.0016, -0.0010, [0.004, 0.003, 0.003]), c = ring(0.0004, -0.0011, [0.004, 0.003, 0.003]); for (let k = 0; k < 12; k++) { gb.quad(o[k], o[k + 1], m[k + 1], m[k]); gb.quad(m[k], m[k + 1], i[k + 1], i[k]); gb.quad(i[k], i[k + 1], c[k + 1], c[k]); } }
  for (const v of [0.35, Math.PI - 0.35]) { const path = []; for (let k = 0; k <= 60; k++) path.push([T0 - 0.1 + (T1 - T0 + 0.2) * k / 60, v]); stitchLine(gb, strap, path, { lift: 0.0001, col: lin(0x8f846a), pitch: 0.0030, len: 0.0022, w: 0.0006, h: 0.0004, z: [0, 1, 0, 1], x: [0.1, 0, 0, 1] }); }
  const bp = -Math.PI / 2 - 0.05; const bq = new V3(); strap.pos(bp, Math.PI / 2, bq); // buckle frame (underside; rarely visible)
  for (const s of [-1, 1]) { const q0 = new V3(), n0 = new V3(); strap.pos(bp, Math.PI / 2, q0); strap.nrm(bp, Math.PI / 2, n0); const c0 = q0.clone().addScaledVector(n0, 0.0012); const z0 = ZC + s * (W / 2 + 0.0008); const ids = []; for (const dy of [0, 0.0008]) { const r = []; for (let k = 0; k <= 10; k++) { const a = k / 10 * TAU; const p = c0.clone(); p.z = z0; p.x += Math.cos(a) * 0.0006; p.y += Math.sin(a) * 0.0006 + dy; r.push(gb.vert(p, new V3(Math.cos(a), Math.sin(a), 0), k * 0.001, 0, STEEL, W1, [0, 0, 0, 1], [0.1, 0.2, 0.9, 1])); } ids.push(r); } for (let k = 0; k < 10; k++) gb.quad(ids[0][k], ids[0][k + 1], ids[1][k + 1], ids[1][k]); }
  return { gb };
}
