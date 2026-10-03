// AFTER HOURS — Haunted Castle, the parts above the reach of the player: coursed masonry on the keep, its porch, the side halls and the front turrets (only the faces that can be seen from the
// courtyard are modelled), machicolations (stepped corbels with open floor slots), timber hoardings on the curtain walls, gargoyles as crouching winged creatures with water spouts,
// and stone tracery in the rose window. References: keep block 0.9 x 0.33 m, machicolation corbel stack 3 courses projecting 0.2 / 0.35 / 0.5 m every 1.1 m, hoarding gallery 1.3 m deep with
// 0.3 m plank wall and arrow slits every 2 m, gargoyle 2.4 m tip to tail, rose window 8.6 m across with 12 radial mullions and foliated outer ring.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { toRaw } from '../../core/build.js';
import { makeRng } from '../../core/util.js';
import { torus, pipe, TAU, PI } from './common.js';
import { ashlar, ashlarRing } from './real.js';

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3();
const gp = (g0, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { const g = g0.index ? g0.toNonIndexed() : g0.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); E.set(rx, ry, rz, 'XYZ'); Q.setFromEuler(E); g.applyMatrix4(M4.compose(V3.set(x, y, z), Q, S3.set(sx, sy, sz))); return g; };
const limbG = (a, b, r0, r1, seg = 6) => { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = new THREE.Vector3().subVectors(Bv, A), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, false); g.translate(0, L / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(A.x, A.y, A.z); return g.toNonIndexed(); };
const triG = (a, b, c) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3)); g.computeVertexNormals(); const f = new THREE.BufferGeometry(); f.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...c, ...b], 3)); f.computeVertexNormals(); return [g, f]; };

let GARG = null;
/** one crouching gargoyle, facing +z, base at y = 0, ~2.4 m long / 1.9 m high, merged + indexed (few vertices) */
function gargoyleRaw() {
  if (GARG) return GARG; const P = [];
  P.push(gp(new THREE.SphereGeometry(0.42, 8, 6), 0, 0.52, 0.05, 0, 0, 0, 0.95, 0.85, 1.55), gp(new THREE.SphereGeometry(0.4, 8, 6), 0, 0.68, 0.62, 0, 0, 0, 0.95, 1.05, 0.9));                  // torso, chest
  for (const sx of [-1, 1]) { P.push(gp(new THREE.SphereGeometry(0.3, 6, 5), sx * 0.36, 0.4, -0.3), limbG([sx * 0.36, 0.35, -0.3], [sx * 0.38, 0.05, 0.12], 0.17, 0.09, 6), gp(new THREE.SphereGeometry(0.1, 5, 4), sx * 0.38, 0.05, 0.2, 0, 0, 0, 1, 0.6, 1.6),   // haunch, hind leg, foot
      limbG([sx * 0.3, 0.6, 0.6], [sx * 0.3, 0.3, 1.0], 0.14, 0.09, 6), limbG([sx * 0.3, 0.3, 1.0], [sx * 0.31, 0.03, 1.02], 0.09, 0.075, 5), gp(new THREE.SphereGeometry(0.1, 5, 4), sx * 0.31, 0.03, 1.12, 0, 0, 0, 1, 0.6, 1.5));   // fore leg, forearm, claws
    for (const k of [-1, 0, 1]) P.push(gp(new THREE.ConeGeometry(0.022, 0.14, 4), sx * 0.31 + k * 0.05, 0.03, 1.24, PI / 2, 0, 0));                                                              // claw tips
    P.push(gp(new THREE.ConeGeometry(0.07, 0.4, 5), sx * 0.15, 1.5, 1.12, -0.5, 0, sx * 0.25), gp(new THREE.ConeGeometry(0.05, 0.22, 4), sx * 0.24, 1.36, 0.95, -0.2, 0, sx * 1.0));                  // horns, ears
    const root = [sx * 0.3, 0.95, 0.3], t1 = [sx * 0.95, 1.85, -0.3], t2 = [sx * 1.4, 1.35, -0.55], t3 = [sx * 1.2, 0.7, -0.75], t4 = [sx * 0.45, 0.55, -0.55];                                   // bat wing (folded up along the back)
    for (const t of [t1, t2, t3]) P.push(limbG(root, t, 0.045, 0.015, 5)); P.push(...triG(root, t1, t2), ...triG(root, t2, t3), ...triG(root, t3, t4)); }
  P.push(limbG([0, 0.85, 0.75], [0, 1.2, 1.05], 0.24, 0.17, 7), gp(new THREE.SphereGeometry(0.26, 8, 6), 0, 1.24, 1.15, 0, 0, 0, 1, 0.9, 1.1), gp(new THREE.BoxGeometry(0.42, 0.09, 0.2), 0, 1.4, 1.28, -0.12, 0, 0),   // neck, head, brow ridge
    gp(new THREE.BoxGeometry(0.26, 0.16, 0.34), 0, 1.13, 1.5), gp(new THREE.BoxGeometry(0.22, 0.07, 0.3), 0, 0.98, 1.44, 0.42, 0, 0));                                                              // snout, lower jaw hanging open
  for (let i = 0; i < 6; i++) { const x = -0.1 + i * 0.04; P.push(gp(new THREE.ConeGeometry(0.014, 0.07, 3), x, 1.045, 1.6 + (i % 2) * 0.02, PI, 0, 0), gp(new THREE.ConeGeometry(0.014, 0.06, 3), x, 1.0, 1.55, 0, 0, 0)); }   // fangs
  P.push(limbG([0, 1.06, 1.42], [0, 1.02, 1.95], 0.07, 0.06, 6), gp(new THREE.TorusGeometry(0.075, 0.018, 4, 8), 0, 1.02, 1.96));                                                                     // water spout in the mouth
  P.push(limbG([0, 0.35, -0.6], [0, 0.25, -1.0], 0.13, 0.08, 6), limbG([0, 0.25, -1.0], [0.1, 0.5, -1.3], 0.08, 0.05, 5), gp(new THREE.ConeGeometry(0.11, 0.22, 4), 0.14, 0.68, -1.4, -0.4, 0, 0.3));   // tail with spade
  P.push(gp(new THREE.BoxGeometry(1.2, 0.34, 2.9), 0, -0.17, 0.2));                                                                                                                                 // stone plinth
  const m = mergeVertices(mergeGeometries(P.map((g) => { const c = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal') c.deleteAttribute(k); return c; }))); GARG = toRaw(m, 'box'); return GARG;
}

export function keepReal(K) {
  const { B, ashlarM, stoneD, wood, iron, voidM, glowG } = K, rng = makeRng(90210), bx = (p, s, mat, o = {}) => B.box({ p, s, mat, anchor: 'center', bevel: 0, cast: o.cast ?? false, yaw: o.yaw, pitch: o.pitch, roll: o.roll });
  // ---- keep front face (visible above the curtain wall), porch face, side-hall faces, front turrets
  const lancets = [[15, 5.5, 1.5], [23.5, 5.0, 1.4], [30, 3.6, 1.3]];
  ashlar(B, { p: [-11.2, 0, -9], yaw: 0, w: 22.4, h: 33.6, y0: 8, mat: ashlarM, rng, skip: (u, v) => { const x = -11.2 + u; if (Math.abs(x) < 5.4 && v > 20.2) return true; for (const sx of [-1, 1]) for (const [y, h, w] of lancets) if (Math.abs(x - sx * 6.4) < w / 2 + 0.55 && v > y - 0.5 && v < y + h + 0.7) return true; return false; } });
  ashlar(B, { p: [-5, 0, -7.35], yaw: 0, w: 10, h: 34.4, y0: 20.6, mat: ashlarM, rng, skip: (u, v) => Math.hypot(-5 + u, v - 24) < 5.0 });
  for (const sx of [-1, 1]) ashlar(B, { p: [sx * 22.5 - 8, 0, -8], yaw: 0, w: 16, h: 17.7, y0: 9.2, mat: ashlarM, rng, skip: (u, v) => { const x = u - 8; for (const dx of [-4, 0, 4]) if (Math.abs(x - dx) < 1.35 && v > 8 && v < 14.3) return true; return false; } });
  for (const sx of [-1, 1]) ashlarRing(B, { c: [sx * 14.6, -8.6], r: 3.4, y0: 7.6, y1: 39.6, a0: 0.05, a1: PI - 0.05, mat: ashlarM, rng, bw: [0.6, 1.0], skip: (x, y, z) => Math.abs(x) < 11.4 && z < -8.0 && false });
  // ---- machicolations: stepped corbels + open slots under the gatehouse ledge and the keep parapet
  const mach = (x0, x1, y, z, faceZ) => { for (let x = x0; x <= x1; x += 1.1) { for (const [k, pr, hh] of [[0, 0.5, 0.42], [1, 0.36, 0.4], [2, 0.22, 0.38]]) bx([x, y - k * 0.4 - hh / 2, z + pr / 2], [0.52, hh, pr + 0.06], stoneD, { cast: k === 0 }); }
    for (let x = x0 + 0.55; x < x1; x += 1.1) bx([x, y + 0.02, z + 0.3], [0.5, 0.03, 0.52], voidM); };   // dark floor slots between the corbels
  mach(-7.7, 7.7, 12.4, 2.15, 2.1); mach(-10.6, 10.6, 33.9, -8.9, -9);
  for (const sx of [-1, 1]) { const cx = sx * 14.6, cz = -8.6;   // round turrets: three stepped rings under the crown plus a corbel-table of small dentil blocks
    for (const [k, r] of [[0, 3.62], [1, 3.76], [2, 3.9]]) B.cyl({ p: [cx, 39.2 + k * 0.28, cz], r, h: 0.3, seg: 28, mat: stoneD, cast: k === 2 });
    for (let a = 0.05; a <= PI - 0.05; a += 0.16) bx([cx + Math.cos(a) * 3.98, 39.05, cz + Math.sin(a) * 3.98], [0.2, 0.26, 0.28], stoneD, { yaw: -a }); }
  // ---- timber hoardings on the curtain walls: floor, braces, posts, plank wall with slits, lean-to roof
  for (const [x0, x1] of [[-38, -30], [-24, -16], [16, 24], [30, 38]]) { const cx = (x0 + x1) / 2, L = x1 - x0, zW = -0.5, yF = 10.35;
    bx([cx, yF, zW + 0.6], [L, 0.14, 1.3], wood, { cast: true });
    for (let x = x0 + 0.8; x <= x1 - 0.5; x += 2) { bx([x, yF - 0.5, zW + 0.6], [0.14, 0.14, 1.4], wood, { pitch: -0.6, cast: false }); bx([x, yF + 0.95, zW + 1.2], [0.16, 1.85, 0.16], wood); bx([x, yF + 1.85, zW + 0.6], [0.14, 0.14, 1.3], wood); }
    for (let x = x0 + 0.15; x < x1 - 0.1; x += 0.31) { const slit = Math.abs(((x - x0) % 2) - 1.2) < 0.16; if (slit) { bx([x, yF + 0.35, zW + 1.2], [0.28, 0.5, 0.06], wood); bx([x, yF + 1.55, zW + 1.2], [0.28, 0.5, 0.06], wood); } else bx([x, yF + 0.95, zW + 1.2], [0.29 - (rng() * 0.02), 1.7, 0.06 + rng() * 0.02], wood, { cast: false }); }   // planks (slits every 2 m)
    bx([cx, yF + 2.05, zW + 0.75], [L + 0.3, 0.08, 1.7], wood, { pitch: 0.13, cast: true });                                                                                                           // roof
  }
  // ---- gargoyles: gatehouse ledge corners, porch top corners, hall corners
  const G = gargoyleRaw();
  for (const sx of [-1, 1]) for (const [x, y, z, sc] of [[sx * 8.0, 13.3, 2.0, 1.15], [sx * 5.2, 34.5, -7.4, 1.05], [sx * 14.0, 18.3, -7.6, 1.0], [sx * 30.0, 18.3, -7.6, 1.0]]) { B.addRaw(G, B.matrix([x, y, z], 0, sc), stoneD, { cast: true }); B.sphere({ p: [x - 0.09 * sc, y + 1.3 * sc, z + 1.32 * sc], r: 0.05 * sc, seg: 6, mat: glowG, cast: false }); B.sphere({ p: [x + 0.09 * sc, y + 1.3 * sc, z + 1.32 * sc], r: 0.05 * sc, seg: 6, mat: glowG, cast: false }); }
  // ---- rose window tracery (stone mullions over the glowing glass): 12 radial bars, three rings, 12 foils
  { const cx = 0, cy = 24, cz = -7.2, rr = 4.3; for (let i = 0; i < 6; i++) bx([cx, cy, cz], [0.11, 2 * rr, 0.16], stoneD, { roll: i * PI / 6 });
    for (const r of [rr * 0.22, rr * 0.5, rr * 0.78]) torus(B, { p: [cx, cy, cz], R: r, r: 0.05, seg: 4, tube: 40, pitch: PI / 2, mat: stoneD, cast: false });
    for (let i = 0; i < 12; i++) { const a = (i + 0.5) / 12 * TAU; torus(B, { p: [cx + Math.cos(a) * rr * 0.9, cy + Math.sin(a) * rr * 0.9, cz], R: rr * 0.12, r: 0.035, seg: 4, tube: 12, pitch: PI / 2, mat: stoneD, cast: false }); } }
}
