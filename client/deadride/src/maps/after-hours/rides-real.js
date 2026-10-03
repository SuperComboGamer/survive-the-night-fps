// AFTER HOURS — the rides as real construction: ferris-wheel gondola (open carriage with window openings, benches, curved roof, A-frame hanger), roller-coaster cross-ties + lift chain +
// braced A-frame supports with footings, log-flume boat (hollow half-pipe hull, upturned prow, benches, gunwale rails).
// References: gondola 1.6 x 2.2 x 1.7 m; coaster tie plate 1.5 x 0.2 m every ~0.65 m, lift chain link 14 cm, support leg 0.26 m dia with 0.8 m footing; flume boat 2.8 m long, 1.2 m beam.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxRaw } from '../../core/build.js';
import { pipe, PI } from './common.js';

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
const gp = (g0, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { const g = g0.index ? g0.toNonIndexed() : g0.clone(); E.set(rx, ry, rz, 'XYZ'); Q.setFromEuler(E); g.applyMatrix4(M4.compose(V.set(x, y, z), Q, S.set(sx, sy, sz))); return g; };
const limb = (a, b, r0, r1, seg = 5) => { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = new THREE.Vector3().subVectors(Bv, A), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, false); g.translate(0, L / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(A.x, A.y, A.z); return g.toNonIndexed(); };
const bxg = (x, y, z) => new THREE.BoxGeometry(x, y, z);
/** duplicate with flipped winding so an open shell is visible from both sides */
const both = (g) => { const n = g.index ? g.toNonIndexed() : g, P = n.attributes.position.array, N = n.attributes.normal.array, p2 = new Float32Array(P.length), n2 = new Float32Array(N.length); for (let t = 0; t < P.length / 3; t += 3) for (let k = 0; k < 3; k++) { const s = t + (k === 0 ? 0 : k === 1 ? 2 : 1); for (let c = 0; c < 3; c++) { p2[(t + k) * 3 + c] = P[s * 3 + c]; n2[(t + k) * 3 + c] = -N[s * 3 + c]; } } const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.BufferAttribute(p2, 3)); b.setAttribute('normal', new THREE.BufferAttribute(n2, 3)); return [n, b]; };
const clean = (g) => { const c = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal') c.deleteAttribute(k); return c; };
const merge = (parts) => { const m = mergeGeometries(parts.flat().map(clean)); m.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(m.attributes.position.count * 2), 2)); return m; };

/** ferris-wheel gondola: pivot at the origin, carriage hangs below (z = wheel axis) */
export function gondolaGeometry() {
  const P = [];
  P.push(gp(bxg(1.6, 0.1, 2.2), 0, -2.85, 0));                                                                                             // floor
  for (const sx of [-1, 1]) { P.push(gp(bxg(0.06, 0.7, 2.2), sx * 0.8, -2.45, 0)); P.push(gp(bxg(0.08, 0.05, 2.28), sx * 0.8, -2.08, 0)); }   // waist walls + rail
  for (const sz of [-1, 1]) { P.push(gp(bxg(1.6, 0.7, 0.06), 0, -2.45, sz * 1.1)); P.push(gp(bxg(1.68, 0.05, 0.08), 0, -2.08, sz * 1.1)); }
  for (const sx of [-1, 1]) for (const z of [-1.1, -0.37, 0.37, 1.1]) P.push(gp(bxg(0.06, 0.9, 0.06), sx * 0.8, -1.6, z));                  // window posts (open between them)
  for (const sz of [-1, 1]) for (const x of [-0.8, 0.8]) P.push(gp(bxg(0.06, 0.9, 0.06), x, -1.6, sz * 1.1));
  P.push(gp(bxg(1.75, 0.07, 2.35), 0, -1.13, 0)); P.push(both(gp(new THREE.CylinderGeometry(0.88, 0.88, 2.35, 12, 1, true, -PI / 2, PI), 0, -1.1, 0, PI / 2, 0, PI / 2)).flat());   // roof deck + curved canopy (half cylinder along z)
  P.push(gp(new THREE.CylinderGeometry(0.1, 0.13, 0.12, 8), 0, -0.2, 0.2), gp(new THREE.SphereGeometry(0.11, 8, 4), 0, -0.14, 0.2));       // vent
  for (const sx of [-1, 1]) { P.push(gp(bxg(0.34, 0.06, 2.0), sx * 0.52, -2.5, 0), gp(bxg(0.05, 0.42, 2.0), sx * 0.7, -2.27, 0)); }         // benches + backs
  P.push(limb([0, -0.05, 0], [0, -1.12, 1.0], 0.032, 0.03), limb([0, -0.05, 0], [0, -1.12, -1.0], 0.032, 0.03), gp(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), 0, -0.02, 0, PI / 2, 0, 0));   // A-frame hanger + pin
  return merge(P);
}

/** log-flume boat: hollow half-pipe hull, upturned prow, benches, raised floor slats, gunwale rails; nose at -z */
export function boatGeometry() {
  const P = [];
  P.push(both(gp(new THREE.CylinderGeometry(0.62, 0.55, 2.6, 14, 1, true, -PI / 2, PI), 0, 0.3, 0, PI / 2, 0, 0, 1, 1, 0.85)).flat());        // hull shell
  P.push(gp(new THREE.CircleGeometry(0.6, 12, PI, PI), 0, 0.3, 1.3, 0, 0, 0, 1, 0.85, 1), gp(new THREE.CircleGeometry(0.6, 12, PI, PI), 0, 0.3, 1.3, 0, PI, 0, 1, 0.85, 1));   // transom (both faces)
  P.push(limb([0, -0.05, -1.3], [0, 0.35, -1.85], 0.32, 0.14, 8), limb([0, 0.35, -1.85], [0, 0.85, -2.0], 0.14, 0.07, 6), gp(new THREE.SphereGeometry(0.09, 6, 4), 0, 0.88, -2.02));   // upturned prow
  for (const sx of [-1, 1]) P.push(limb([sx * 0.61, 0.56, -1.3], [sx * 0.63, 0.56, 1.3], 0.04, 0.04, 5));                                       // gunwale rails
  for (const z of [-0.55, 0.3, 1.0]) { P.push(gp(bxg(1.05, 0.06, 0.34), 0, 0.42, z), gp(bxg(1.05, 0.34, 0.05), 0, 0.6, z + 0.19)); }             // bench seats + backs
  for (let i = 0; i < 6; i++) P.push(gp(bxg(0.9, 0.025, 0.36), 0, 0.02, -1.1 + i * 0.44));                                                        // floor slats
  return merge(P);
}

/** coaster: cross-ties, lift chain, braced A-frame supports with footings. P/T/Up/spine: per-sample track frames; peakU = normalised u of the lift crest */
export function coasterExtras(B, M, { P, T, Up, spine, N }) {
  const tie = boxRaw(1.5, 0.06, 0.2, 0), m = new THREE.Matrix4(), r = new THREE.Vector3(), t = new THREE.Vector3(), u = new THREE.Vector3();
  for (let i = 0; i < N; i++) { t.copy(T[i]); u.copy(Up[i]); r.crossVectors(t, u).normalize(); m.makeBasis(r, u, t.clone().negate().negate()); m.setPosition(P[i].x + u.x * 0.03, P[i].y + u.y * 0.03, P[i].z + u.z * 0.03); B.addRaw(tie, m.clone(), M.steel, { cast: false }); }   // cross-ties under the rails
  let pk = 0; for (let i = 0; i < N * 0.4; i++) if (P[i].y > P[pk].y) pk = i;
  const link = new THREE.TorusGeometry(0.04, 0.009, 3, 6); const link2 = link.clone(); link2.rotateX(PI / 2); link2.translate(0.05, 0, 0); const cg = mergeGeometries([link.toNonIndexed(), link2.toNonIndexed()]); cg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cg.attributes.position.count * 2), 2));
  const cm = new THREE.Matrix4(), q = new THREE.Quaternion(), pp = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  for (let i = Math.floor(N * 0.03); i < pk; i++) for (let j = 0; j < 4.6; j++) { const f = j / 4.6, a = P[i], b = P[i + 1] || P[i]; pp.set(a.x + (b.x - a.x) * f + Up[i].x * 0.13, a.y + (b.y - a.y) * f + Up[i].y * 0.13, a.z + (b.z - a.z) * f + Up[i].z * 0.13); r.crossVectors(T[i], Up[i]).normalize(); cm.makeBasis(T[i], Up[i], r); cm.setPosition(pp.x, pp.y, pp.z); B.instance('chainlink', cg, M.steel, cm.clone(), null, { cast: false }); }   // lift chain (instanced links)
  for (let i = 0; i < N; i += 22) { const c = spine[i]; if (c.y < 3.2 || Up[i].y < 0.2) continue; r.crossVectors(T[i], Up[i]).normalize(); const h = c.y - 0.2, sp = 0.55 + 0.11 * h;
    const legs = [-1, 1].map((sd) => [[c.x + r.x * sd * 0.5, c.y - 0.25, c.z + r.z * sd * 0.5], [c.x + r.x * sd * sp, 0, c.z + r.z * sd * sp]]);
    for (const [a, b] of legs) { pipe(B, a, b, 0.13, M.white, { seg: 6, r2: 0.16, cast: false }); B.box({ p: [b[0], -0.1, b[2]], s: [0.8, 0.35, 0.8], mat: M.conc, bevel: 0.03, cast: false }); }
    const at = (leg, f) => [leg[0][0] + (leg[1][0] - leg[0][0]) * f, leg[0][1] + (leg[1][1] - leg[0][1]) * f, leg[0][2] + (leg[1][2] - leg[0][2]) * f];
    pipe(B, at(legs[0], 0.35), at(legs[1], 0.7), 0.06, M.white, { seg: 4, cast: false }); pipe(B, at(legs[1], 0.35), at(legs[0], 0.7), 0.06, M.white, { seg: 4, cast: false }); pipe(B, at(legs[0], 0.5), at(legs[1], 0.5), 0.07, M.white, { seg: 5, cast: false }); }   // A-frame legs, X bracing, cross beam
}
