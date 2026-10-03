// LAST FERRY — round-3 set dressing. Repeated parts are INSTANCED (draws stay flat, the sky-visibility bake never sees them):
// fish-stall goods (crushed ice, fish rows, fish boxes, price stakes, tiled counter front, scalloped valance, hook rail with hanging fish, festoon bulbs),
// steam derrick (plinth, boarded winch house, lattice boom, sheaves, guys, winch drum + gear, hook block), lobster pots, quay cleats, bolts, 3D litter clusters.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { std } from '../../core/mats.js';
import { latticeBoom } from './arch.js';
const P = Math.PI;
const part = (g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => { g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ')), new THREE.Vector3(...s))); return g; };
const merge = (parts) => { const gs = parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }); const m = mergeGeometries(gs); m.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(m.attributes.position.count * 2), 2)); return m; };
const gc = (B, k, f) => ((B._d3g || (B._d3g = {}))[k] || (B._d3g[k] = f()));
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z), cyl = (r0, r1, h, s = 6) => new THREE.CylinderGeometry(r1, r0, h, s);
const mt = (B) => B._d3m || (B._d3m = {
  ice: B.m('d3Ice', std({ color: 0xcfe8f0, roughness: 0.16, metalness: 0, emissive: 0x16323c })), fish: B.m('d3Fish', std({ color: 0xffffff, roughness: 0.3, metalness: 0.12, emissive: 0x0c1418 })),
  plastic: B.m('d3Plastic', std({ color: 0xffffff, roughness: 0.5 })), tile: B.m('d3Tile', std({ color: 0xffffff, roughness: 0.2 })), litter: B.m('d3Litter', std({ color: 0xffffff, roughness: 0.6 })), pot: B.m('d3Pot', std({ color: 0x4a4030, roughness: 0.9 })) });

// ---------------------------------------------------------------- geometries (x = length axis, y up, origin on the ground / centre as noted)
const fishLite = () => merge([part(new THREE.SphereGeometry(0.5, 6, 3), [0, 0, 0], [0, 0, 0], [0.44, 0.11, 0.1]), part(new THREE.ConeGeometry(0.09, 0.17, 4), [-0.29, 0, 0], [0, 0, -P / 2], [1.35, 1, 0.16]),
  part(new THREE.ConeGeometry(0.035, 0.1, 3), [0.0, 0.1, 0], [0, 0, 0], [1.6, 1, 0.3])]);
const fishBoxGeo = () => { const W = 0.5, D = 0.32, H = 0.19, t = 0.016; return merge([part(box(W, 0.02, D), [0, 0.01, 0]), part(box(W, H, t), [0, H / 2, D / 2 - t / 2]), part(box(W, H, t), [0, H / 2, -D / 2 + t / 2]), part(box(t, H, D - 2 * t), [W / 2 - t / 2, H / 2, 0]),
  part(box(t, H, D - 2 * t), [-W / 2 + t / 2, H / 2, 0]), part(box(W + 0.02, 0.012, t + 0.014), [0, H - 0.006, D / 2 + 0.003]), part(box(W + 0.02, 0.012, t + 0.014), [0, H - 0.006, -D / 2 - 0.003])]); };
const fishBoxSolid = () => merge([part(box(0.5, 0.176, 0.32), [0, 0.088, 0]), part(box(0.52, 0.012, 0.334), [0, 0.184, 0])]);
const tabGeo = () => merge([part(box(0.236, 0.06, 0.008), [0, 0.03, 0]), part(new THREE.CylinderGeometry(0.118, 0.118, 0.008, 6, 1, false, -P / 2, P), [0, 0, 0], [P / 2, 0, 0])]);
const boltGeo = () => merge([part(cyl(0.03, 0.03, 0.024, 6), [0, 0.012, 0]), part(cyl(0.05, 0.05, 0.005, 8), [0, 0.0025, 0])]);
const cleatGeo = () => merge([part(box(0.34, 0.03, 0.12), [0, 0.015, 0]), part(box(0.08, 0.07, 0.05), [0, 0.065, 0]), part(box(0.26, 0.038, 0.05), [0, 0.1, 0]), part(box(0.12, 0.034, 0.045), [0.19, 0.088, 0], [0, 0, -0.35]), part(box(0.12, 0.034, 0.045), [-0.19, 0.088, 0], [0, 0, 0.35]),
  ...[[-0.13, -0.04], [0.13, -0.04], [-0.13, 0.04], [0.13, 0.04]].map(([x, z]) => part(cyl(0.014, 0.014, 0.014, 6), [x, 0.036, z]))]);
const potGeo = () => { const ps = []; for (let i = 0; i < 5; i++) ps.push(part(new THREE.TorusGeometry(0.35, 0.012, 4, 10, P), [-0.44 + i * 0.22, 0.03, 0], [0, P / 2, 0], [1, 1.55, 1]));
  for (let k = 1; k < 6; k++) { const a = k * P / 6; ps.push(part(box(1.0, 0.014, 0.014), [0, 0.03 + Math.sin(a) * 0.35 * 1.55, Math.cos(a) * 0.35])); }
  ps.push(part(box(1.0, 0.03, 0.06), [0, 0.015, 0.3]), part(box(1.0, 0.03, 0.06), [0, 0.015, -0.3]), part(box(1.0, 0.03, 0.5), [0, 0.012, 0]), part(new THREE.ConeGeometry(0.16, 0.26, 8, 1, true), [0.42, 0.22, 0], [0, 0, P / 2 + 0.0], [1, 1, 1]), part(new THREE.TorusGeometry(0.16, 0.014, 4, 8), [0.5, 0.22, 0], [0, P / 2, 0]));
  return merge(ps); };
const litA = () => merge([part(cyl(0.033, 0.033, 0.11, 6), [0, 0.033, 0], [0, 0, P / 2 + 0.2]), part(cyl(0.033, 0.033, 0.11, 6), [0.09, 0.033, 0.06], [0, 0.8, P / 2]), part(cyl(0.033, 0.033, 0.11, 6), [-0.07, 0.033, 0.09], [0, 2.1, P / 2]),
  part(cyl(0.04, 0.04, 0.17, 6), [0.02, 0.04, -0.09], [0, 0.4, P / 2]), part(cyl(0.017, 0.017, 0.07, 6), [0.02 - 0.12 * Math.cos(0.4), 0.036, -0.09 + 0.12 * Math.sin(0.4)], [0, 0.4, P / 2])]);
const litB = () => merge([part(new THREE.SphereGeometry(0.5, 7, 5), [0, 0.015, 0], [0, 0.3, 0], [0.36, 0.05, 0.26]), part(new THREE.SphereGeometry(0.5, 6, 4), [0.18, 0.03, 0.06], [0, 1, 0], [0.2, 0.06, 0.16]),
  part(box(0.36, 0.008, 0.26), [-0.4, 0.006, 0.1], [0, 0.3, 0]), part(box(0.3, 0.008, 0.22), [-0.28, 0.014, 0.16], [0.05, -0.5, 0.04]), part(new THREE.IcosahedronGeometry(0.04, 0), [-0.55, 0.04, -0.1])]);

// one InstancedMesh per key+material for the whole stop (the core Instancer splits every key into 28 m cells = many draws for scattered small items); flushed just before Builder.finish
const gi = (B) => { if (!B._d3i) { B._d3i = new Map(); const fin = B.finish.bind(B); B.finish = function () { flushInst(B); return fin(); }; } return B._d3i; };
export function instG(B, key, geo, mat, matrix, color = null) { const mm = B.mat(mat), M = gi(B), k = key + '|' + mm.uuid; let g = M.get(k); if (!g) { g = { geo, mat: mm, m: [], c: [] }; M.set(k, g); } g.m.push(matrix); g.c.push(color); }
export function flushInst(B) { const M = B._d3i; if (!M) return; const col = new THREE.Color(); for (const g of M.values()) { const im = new THREE.InstancedMesh(g.geo, g.mat, g.m.length), hasC = g.c.some((c) => c !== null);
  g.m.forEach((m, i) => { im.setMatrixAt(i, m); if (hasC) { col.set(g.c[i] ?? 0xffffff); im.setColorAt(i, col); } }); im.instanceMatrix.needsUpdate = true; im.castShadow = false; im.receiveShadow = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.updateMatrix(); B.inst.parent.add(im); B.inst.meshes.push(im); } M.clear(); }
// ---------------------------------------------------------------- shared small helpers
const bMat = (pos, dir, s) => { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize()); return new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q, new THREE.Vector3(s, s, s)); };
export const fishGeoLite = (B) => gc(B, 'fishL', fishLite), fishMatLite = (B) => mt(B).fish;
/** hex bolt head with washer at pos, standing along dir */
export function boltAt(B, mat, pos, dir = [0, 1, 0], s = 1) { instG(B, 'bolt', gc(B, 'bolt', boltGeo), mat, bMat(pos, dir, s), 0xffffff); }
/** iron cleat (base plate, pedestal, two horns, four bolts) lying along yaw */
export function cleatAt(B, mat, x, y, z, yaw) { instG(B, 'cleat', gc(B, 'cleat', cleatGeo), mat, B.matrix([x, y, z], yaw, 1), 0xffffff); }
/** lobster pots: list of [x, y, z, yaw, solid]; half-cylinder hoops + slats + base + entrance funnel */
export function lobsterPots(K, list) { const B = K.B, m = mt(B), g = gc(B, 'pot', potGeo); for (const [x, y, z, yaw, solid] of list) { instG(B, 'pot', g, m.pot, B.matrix([x, y, z], yaw, 1), [0xffffff, 0xe8d8b8, 0xc8b898][Math.abs((x * 7 + z * 3) | 0) % 3]); if (solid) B.colliders.addBox({ x, y: y + 0.3, z, hx: 0.5, hy: 0.3, hz: 0.35, yaw, surface: 'wood', walk: false }); } }
/** flat-lying clutter clusters (cans/bottle/ring, bags/cardboard/paper) scattered on the decal tiles within R m of the berth: instanced, no bake cost */
export function litter3D(K, tiles, o = {}) {
  const B = K.B, m = mt(B), rng = o.rng ?? K.rng, sl = K.st.stationLocal, R = o.radius ?? 34, per = o.per ?? 0.09;
  const set = [[gc(B, 'litA', litA), 'litA', [0x9a9ea2, 0x7a2a26, 0x2a4470, 0x2a5a3a, 0x8a7a34, 0x606468]], [gc(B, 'litB', litB), 'litB', [0xa4a4a0, 0x1c2024, 0x34486c, 0x80725a, 0x745838, 0x64482c]]];
  for (const tl of tiles) { const n = Math.min(420, Math.round(tl.w * tl.d * per * (tl.litter ?? 1))); for (let k = 0; k < n; k++) { const x = tl.x + rng() * tl.w, z = tl.z + rng() * tl.d; if (Math.hypot(x - sl[0], z - sl[2]) > R) continue;
    const [g, key, cols] = set[(rng() * 2) | 0]; instG(B, key, g, m.litter, B.matrix([x, (tl.y ?? o.y ?? 0) + 0.004, z], rng() * 6.3, 0.6 + rng() * 0.4), cols[(rng() * cols.length) | 0]); } }
}

// ---------------------------------------------------------------- fish stall goods
const AWN = [[0x2e9a94, 0xe8e4d0], [0xb8423a, 0xe8e4d0], [0x2f5aa0, 0xe8e4d0], [0xd8a838, 0xe8e4d0]];
/** goods on / around a stall built by wharfProps.stall(): st = its return value ({P_}); o = {face, w, d, rng, i} */
export function stallDress(K, M, st, o) {
  const B = K.B, m = mt(B), { face, w = 5, d = 3.4, rng, i = 0 } = o, sx = face === 'e' ? 1 : face === 'w' ? -1 : 0, sz = face === 's' ? 1 : face === 'n' ? -1 : 0, alongX = sz !== 0, P_ = st.P_, ny = Math.atan2(sx, sz), yU = alongX ? 0 : -P / 2;
  const I = (key, g, mat, u, v, h, yaw, sc, col, pitch = 0, roll = 0) => instG(B, key, g, mat, B.matrix(P_(u, v, h), yaw, sc, pitch, roll), col);
  const ice = gc(B, 'iceU', () => new THREE.TetrahedronGeometry(1)), fish = gc(B, 'fishL', fishLite), fb = gc(B, 'fbox', fishBoxGeo), fbs = gc(B, 'fboxS', fishBoxSolid), tile = gc(B, 'tileU', () => new THREE.PlaneGeometry(1, 1)), tab = gc(B, 'tab', tabGeo), bulb = gc(B, 'festoon', () => new THREE.SphereGeometry(0.035, 5, 3));
  const fc = [0xb8c4c8, 0x8ea0aa, 0xd8a0a0, 0x6a8aa0, 0xc86a3a, 0x9aa8a0, 0xe0d8c0, 0xd0d6d8], iceCol = [0xeef8fc, 0xd0e8f0, 0xffffff, 0xc0dce8];
  const iceC = (u, v, h, hu, hv, n) => { for (let k = 0; k < n; k++) { const s = 0.02 + rng() * 0.03; I('iceC', ice, m.ice, u + (rng() - 0.5) * hu, v + (rng() - 0.5) * hv, h + rng() * 0.025, rng() * 6.3, [s * (1 + rng() * 0.7), s * (0.6 + rng() * 0.5), s * (1 + rng() * 0.5)], iceCol[k & 3], (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9); } };
  const fishAt = (u, v, h, head, sc, roll = 0, pitch = rng() < 0.25 ? 1.2 : (rng() - 0.5) * 0.3) => I('fishL', fish, m.fish, u, v, h, yU + (head > 0 ? 0 : P) + (rng() - 0.5) * 0.3, sc, fc[(rng() * fc.length) | 0], pitch, roll);
  // crushed ice mounded on the tray, three rows of fish head-to-tail, price stakes
  iceC(0, 1.03, 1.02, 3.9, 0.55, 120);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 8; k++) { const u = -1.63 + k * 0.465 + (r === 1 ? 0.2 : 0) + (rng() - 0.5) * 0.06; if (u > 1.9) continue; fishAt(u, 0.86 + r * 0.17 + (rng() - 0.5) * 0.03, 1.075, (k + r) & 1 ? 1 : -1, 0.62 + rng() * 0.16); }
  // stacked fish boxes (street side under the awning line, and back-stock inside), top box iced and filled
  const bc = [0x1f5ea8, 0xe0e4e0, 0xd8681c, 0x2a7a4a];
  const stack = (u, v, n, col) => { for (let k = 0; k < n; k++) I(k === n - 1 ? 'fbox' : 'fboxS', k === n - 1 ? fb : fbs, m.plastic, u, v, k * 0.19, yU + (rng() - 0.5) * 0.06, 1, col); const top = n * 0.19; iceC(u, v, top - 0.08, 0.36, 0.2, 9); fishAt(u + (rng() - 0.5) * 0.1, v + (rng() - 0.5) * 0.06, top - 0.05, rng() < 0.5 ? 1 : -1, 0.56); if (rng() < 0.6) fishAt(u + (rng() - 0.5) * 0.1, v + (rng() - 0.5) * 0.06, top - 0.05, rng() < 0.5 ? 1 : -1, 0.5); };
  for (let k = 0; k < 4; k++) stack(-1.7 + k * 1.1 + (rng() - 0.5) * 0.15, 3.05 + (rng() - 0.5) * 0.12, 2 + (k & 1), bc[(i + k) & 3]);
  for (const s of [-1, 1]) stack(s * 1.95, -0.25, 3, bc[(i + s + 2) & 3]);
  // tiled counter front (single-sided tile quads, coloured band, dark grout showing between)
  for (let r = 0; r < 3; r++) for (let k = 0; k < 15; k++) I('tileU', tile, m.tile, -2.2 + 0.1467 + k * 0.2933, 1.452, 0.04 + r * 0.29 + 0.13, ny, [0.275, 0.27, 1], r === 1 && (k % 5 === 2) ? 0x3a70a0 : [0xe8ecea, 0xd6dcdc, 0xf2f2ee][(k + r * 2) % 3]);
  // scalloped awning valance (alternating stripe colours) + festoon wire with bulbs under the front beam
  { const ev = d / 2 + 0.55 + 0.7 * Math.cos(0.5), eh = 2.62 - 0.7 * Math.sin(0.5) - 0.03, nT = Math.round((w + 0.3) / 0.24), pc = AWN[i & 3]; for (let k = 0; k < nT; k++) I('tab', tab, m.plastic, -(w + 0.3) / 2 + 0.12 + k * ((w + 0.3) / nT), ev, eh, ny, 1, pc[k & 1]); }
  { const fh = 2.87, a = P_(-w / 2 - 0.05, d / 2 + 0.02, fh), b = P_(w / 2 + 0.05, d / 2 + 0.02, fh); B.cable(a, b, 0.14, 0.005, M.black ?? M.iron, { n: 8, cast: false }); for (let k = 0; k < 10; k++) { const t = (k + 0.5) / 10; I('festoon', bulb, M.bulb, -w / 2 - 0.05 + t * (w + 0.1), d / 2 + 0.02, fh - 0.14 * 4 * t * (1 - t) - 0.05, 0, 1, 0xffffff); } }
  // hook rail across the back wall with S-hooks; some hooks carry a fish hung by the tail
  { const rv = -d / 2 + 0.18, rh = 2.2; B.beam(P_(-w / 2 + 0.3, rv, rh), P_(w / 2 - 0.3, rv, rh), 0.03, 0.03, { mat: M.steel, bevel: 0, cast: false });
    for (let k = 0; k < 9; k++) { const u = -w / 2 + 0.55 + k * 0.5; if (k % 3 === 1) I('fishL', fish, m.fish, u, rv + 0.02, rh - 0.36, ny, 0.85, fc[(rng() * fc.length) | 0], 0, -P / 2); } }
}

// ---------------------------------------------------------------- steam derrick on the lighthouse jetty
/** DX,DZ = plinth west end; DY = deck. M needs iron, rustS, timber, granite, rope, black, litDim */
export function derrick(K, M, DX, DY, DZ) {
  const B = K.B, iron = M.iron, rust = M.rustS, wood = M.timber, y0 = DY + 0.28, L = (x, y, z) => [DX + x, y0 + y, DZ + z], bo = (x, y, z, dir, s = 1) => boltAt(B, iron, L(x, y, z), dir, s);
  B.box({ p: [DX + 1.0, DY, DZ], s: [5.3, 0.28, 3.1], mat: M.granite, bevel: 0.03, col: 'stone', cast: true });
  for (const jx of [-0.5, 1.1, 2.7]) B.box({ p: [DX + jx, DY + 0.275, DZ], s: [0.02, 0.012, 3.1], mat: M.black, bevel: 0, cast: false });
  for (const [x, z] of [[-1.35, -1.35], [-1.35, 1.35], [3.4, -1.35], [3.4, 1.35]]) { bo(x, 0, z, [0, 1, 0], 1.6); }
  B.colliders.addBox({ x: DX, y: y0 + 1.0, z: DZ, hx: 1.2, hy: 1.0, hz: 1.2, surface: 'wood', walk: false });
  // boarded winch house: corner posts, vertical cladding, plate, gable roof with ribs and ridge cap, stove pipe
  const HW = 2.3, HH = 2.05, nb = Math.round(HW / 0.19), bw = HW / nb;
  for (const [px, pz] of [[-1.15, -1.15], [1.15, -1.15], [1.15, 1.15], [-1.15, 1.15]]) B.box({ p: L(px, 0, pz), s: [0.13, HH, 0.13], mat: wood, bevel: 0.01, cast: true });
  for (let k = 0; k < nb; k++) { const u = -HW / 2 + bw / 2 + k * bw; for (const s of [-1, 1]) { B.box({ p: L(u, 0, s * 1.13), s: [bw - 0.008, HH, 0.04], mat: rust, bevel: 0, cast: true }); B.box({ p: L(s * 1.13, 0, u), s: [0.04, HH, bw - 0.008], mat: rust, bevel: 0, cast: true }); } }
  B.box({ p: L(0, HH, 0), s: [HW + 0.1, 0.1, HW + 0.1], mat: wood, bevel: 0.01, cast: true }); B.box({ p: L(0, 0, 0), s: [HW + 0.12, 0.12, HW + 0.12], mat: wood, bevel: 0.01, cast: false });
  const th = 0.446, rl = 1.35 / Math.cos(th), ridgeY = HH + 0.1 + 0.55;
  for (const s of [-1, 1]) { B.box({ p: L(0, HH + 0.1 + 0.55 - Math.sin(th) * rl / 2 - 0.025, s * 1.35 / 2), s: [HW + 0.4, 0.05, rl], pitch: s * th, mat: rust, bevel: 0.006, cast: true });
    for (let k = 0; k < 18; k++) { const x = -HW / 2 - 0.15 + k * ((HW + 0.3) / 17); B.beam(L(x, ridgeY + 0.03, s * 0.03), L(x, ridgeY - 1.32 * Math.tan(th) + 0.03, s * 1.32), 0.026, 0.02, { mat: rust, bevel: 0, cast: false }); } }
  B.box({ p: L(0, ridgeY - 0.02, 0), s: [HW + 0.44, 0.06, 0.2], mat: iron, bevel: 0.01, cast: true });
  B.cyl({ p: L(-0.6, HH + 0.35, 0.32), r: 0.075, h: 1.9, seg: 8, mat: iron, cast: true }); B.cyl({ p: L(-0.6, HH + 2.25, 0.32), r: [0.12, 0.03], h: 0.16, seg: 8, mat: iron, cast: false }); B.box({ p: L(-0.6, HH + 0.32, 0.32), s: [0.34, 0.03, 0.34], mat: iron, bevel: 0.005, cast: false });
  for (const hy of [0.9, 1.6]) B.cyl({ p: L(-0.6, HH + hy, 0.32), r: 0.09, h: 0.03, seg: 8, mat: iron, cast: false });
  // door (+z): frame, leaf with Z-brace, strap hinges, hasp + padlock, bulkhead lamp; window (-x)
  { const dz = 1.15, du = -0.35; B.box({ p: L(du, 0, dz + 0.03), s: [1.06, 1.86, 0.07], mat: wood, bevel: 0.01, cast: false }); B.box({ p: L(du, 0.06, dz + 0.075), s: [0.86, 1.74, 0.04], mat: wood, bevel: 0.006, cast: true });
    B.beam(L(du - 0.4, 0.2, dz + 0.105), L(du + 0.4, 1.7, dz + 0.105), 0.11, 0.02, { mat: wood, bevel: 0, cast: false }); for (const hy of [0.32, 1.3]) B.box({ p: L(du, hy, dz + 0.105), s: [0.8, 0.11, 0.02], mat: wood, bevel: 0, cast: false });
    for (const hy of [0.42, 1.4]) { B.box({ p: L(du - 0.2, hy, dz + 0.125), s: [0.5, 0.06, 0.012], mat: iron, bevel: 0, cast: false }); bo(du - 0.4, hy + 0.03, dz + 0.13, [0, 0, 1], 0.9); }
    B.box({ p: L(du + 0.36, 0.86, dz + 0.125), s: [0.08, 0.18, 0.012], mat: iron, bevel: 0, cast: false }); B.box({ p: L(du + 0.36, 0.72, dz + 0.14), s: [0.08, 0.1, 0.05], mat: M.brass ?? iron, bevel: 0.006, cast: false });
    const lp = L(du, HH - 0.25, dz + 0.16); B.box({ p: [lp[0] - 0.05, lp[1], lp[2] - 0.05], s: [0.1, 0.14, 0.1], mat: iron, bevel: 0.008, cast: false }); K.glare([lp[0], lp[1] + 0.05, lp[2] + 0.06], 0xffcf8a, 0.16, 0.7, { refl: 1.2, mist: 0.9 });
    B.box({ p: L(-1.16, 0.9, 0.0), s: [0.06, 0.5, 0.6], mat: wood, bevel: 0.006, cast: false }); B.box({ p: L(-1.19, 0.95, 0.0), s: [0.03, 0.4, 0.5], mat: M.litDim ?? iron, bevel: 0, cast: false }); B.box({ p: L(-1.22, 0.88, 0.0), s: [0.1, 0.05, 0.68], mat: wood, bevel: 0.006, cast: false }); }
  // winch: bed frame, drum with flanges + rope wrap, spoked gear wheel with teeth, pinion + crank, pawl
  { const wx = 1.9, wy = 0.62; for (const s of [-1, 1]) B.box({ p: L(wx, 0, s * 0.55), s: [0.8, 0.98, 0.06], mat: iron, bevel: 0.008, cast: true }); B.box({ p: L(wx, 0, 0), s: [0.8, 0.08, 1.16], mat: iron, bevel: 0.008, cast: false });
    B.cyl({ p: L(wx, wy, 0), r: 0.17, h: 1.12, seg: 12, mat: iron, pitch: P / 2, anchor: 'center', cast: true }); B.cyl({ p: L(wx, wy, 0), r: 0.215, h: 0.56, seg: 12, mat: M.rope, pitch: P / 2, anchor: 'center', cast: false });
    for (const s of [-1, 1]) B.cyl({ p: L(wx, wy, s * 0.36), r: 0.32, h: 0.035, seg: 16, mat: iron, pitch: P / 2, anchor: 'center', cast: false });
    const gz = 0.63; B.tube({ pts: Array.from({ length: 16 }, (_, k) => { const a = k / 16 * P * 2; return [DX + wx + Math.cos(a) * 0.42, y0 + wy + Math.sin(a) * 0.42, DZ + gz]; }), closed: true, r: 0.016, mat: iron, seg: 5, segs: 32, cast: false });
    for (let k = 0; k < 6; k++) { const a = k / 6 * P * 2; B.beam(L(wx, wy, gz), L(wx + Math.cos(a) * 0.41, wy + Math.sin(a) * 0.41, gz), 0.035, 0.02, { mat: iron, bevel: 0, cast: false }); }
    for (let k = 0; k < 22; k++) { const a = k / 22 * P * 2; B.box({ p: L(wx + Math.cos(a) * 0.445, wy + Math.sin(a) * 0.445 - 0.025, gz), s: [0.05, 0.05, 0.04], roll: a, mat: iron, bevel: 0, cast: false }); }
    B.cyl({ p: L(wx, wy, gz), r: 0.07, h: 0.07, seg: 8, mat: iron, pitch: P / 2, anchor: 'center', cast: false });
    const pa = -0.75, px = wx + Math.cos(pa) * 0.56, py = wy + Math.sin(pa) * 0.56; B.cyl({ p: L(px, py, gz), r: 0.13, h: 0.05, seg: 12, mat: iron, pitch: P / 2, anchor: 'center', cast: false }); B.beam(L(px, py, gz + 0.06), L(px + 0.28, py - 0.22, gz + 0.06), 0.03, 0.03, { mat: iron, bevel: 0, cast: false }); B.cyl({ p: L(px + 0.28, py - 0.22, gz + 0.06), r: 0.02, h: 0.14, seg: 6, mat: wood, pitch: P / 2, anchor: 'center', cast: false });
    B.beam(L(wx - 0.32, wy + 0.4, 0.6), L(wx - 0.22, wy + 0.1, 0.6), 0.03, 0.02, { mat: iron, bevel: 0, cast: false }); }
  // mast: tapered, collars, gudgeon plate with bolts, head cap; boom hinge lugs
  const mx = 3.0, MH = 7.4;
  B.cyl({ p: L(mx, 0, 0), r: [0.24, 0.13], h: MH, seg: 10, mat: iron, cast: true }); B.box({ p: L(mx, 0, 0), s: [0.72, 0.06, 0.72], mat: iron, bevel: 0.01, cast: true });
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bo(mx + a * 0.28, 0.06, b * 0.28, [0, 1, 0], 1.3);
  for (const hh of [1.4, 3.6, 6.0]) B.cyl({ p: L(mx, hh, 0), r: 0.245 - hh * 0.0155, h: 0.07, seg: 10, mat: iron, cast: false });
  B.cyl({ p: L(mx, MH, 0), r: 0.16, h: 0.1, seg: 10, mat: iron, cast: false }); for (const s of [-1, 1]) B.box({ p: L(mx - 0.18, MH - 0.05, s * 0.13), s: [0.38, 0.4, 0.03], mat: iron, bevel: 0.006, cast: false }); B.cyl({ p: L(mx - 0.0, MH + 0.16, 0), r: 0.16, h: 0.06, seg: 12, mat: iron, pitch: P / 2, anchor: 'center', cast: false });
  const hinge = L(mx + 0.16, 1.0, 0), head = L(mx + 4.6, 6.0, 0.7), mastHead = L(mx, MH + 0.16, 0);
  for (const s of [-1, 1]) B.box({ p: L(mx + 0.2, 0.7, s * 0.3), s: [0.2, 0.6, 0.04], mat: iron, bevel: 0.006, cast: false });
  latticeBoom(B, hinge, head, 0.52, iron, { bay: 0.9, chord: 0.05, diag: 0.03 });
  for (const s of [-1, 1]) B.box({ p: [head[0] - 0.14, head[1] - 0.16, head[2] + s * 0.14], s: [0.32, 0.34, 0.03], mat: iron, bevel: 0.006, cast: false }); B.cyl({ p: [head[0] - 0.02, head[1], head[2]], r: 0.15, h: 0.07, seg: 12, mat: iron, pitch: P / 2, anchor: 'center', cast: false });
  // rigging: topping lift (wire), hoist rope drum -> foot block -> masthead sheave -> boom-head sheave -> hook block, four guys with turnbuckles + ground plates
  B.cable([head[0], head[1] + 0.12, head[2]], [mastHead[0] + 0.05, mastHead[1] - 0.12, mastHead[2]], 0.05, 0.016, iron, { n: 10, cast: false });
  B.tube({ pts: [L(1.9, 0.83, 0), L(2.35, 0.72, 0), L(2.72, 0.62, 0)], r: 0.022, mat: M.rope, seg: 5, segs: 8, cast: false }); B.box({ p: L(2.66, 0.5, 0), s: [0.14, 0.24, 0.1], mat: iron, bevel: 0.01, cast: false });
  B.beam(L(2.72, 0.7, 0), L(mx - 0.02, MH + 0.28, 0), 0.04, 0.04, { mat: M.rope, bevel: 0, cast: false }); B.beam(L(mx - 0.02, MH + 0.28, 0), [head[0] - 0.02, head[1] + 0.15, head[2]], 0.04, 0.04, { mat: M.rope, bevel: 0, cast: false });
  const hb = [head[0] - 0.02, y0 + 2.75, head[2]]; B.beam([head[0] - 0.02, head[1] - 0.15, head[2]], hb, 0.04, 0.04, { mat: M.rope, bevel: 0, cast: false });
  B.box({ p: [hb[0] - 0.09, hb[1] - 0.3, hb[2] - 0.05], s: [0.18, 0.3, 0.1], mat: iron, bevel: 0.012, cast: false }); B.cyl({ p: [hb[0], hb[1] - 0.18, hb[2]], r: 0.07, h: 0.12, seg: 10, mat: iron, pitch: P / 2, anchor: 'center', cast: false });
  B.tube({ pts: [[hb[0], hb[1] - 0.3, hb[2]], [hb[0], hb[1] - 0.46, hb[2]], [hb[0] + 0.07, hb[1] - 0.58, hb[2]], [hb[0] + 0.16, hb[1] - 0.6, hb[2]], [hb[0] + 0.2, hb[1] - 0.5, hb[2]], [hb[0] + 0.14, hb[1] - 0.42, hb[2]]], r: 0.024, mat: iron, seg: 6, segs: 24, cast: false });
  for (const [ax, az] of [[-3.4, 3.6], [-3.4, -3.6], [mx, 6.5], [mx, -6.5]]) { const A = [DX + ax, DY + 0.16, DZ + az], t = [mastHead[0] - A[0], mastHead[1] - A[1], mastHead[2] - A[2]], tl = Math.hypot(t[0], t[1], t[2]); B.cable([mastHead[0], mastHead[1] - 0.04, mastHead[2]], A, 0.08, 0.012, iron, { n: 12, cast: false });
    B.box({ p: [A[0], DY, A[2]], s: [0.5, 0.03, 0.5], mat: iron, bevel: 0.006, cast: false }); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) boltAt(B, iron, [A[0] + a * 0.19, DY + 0.03, A[2] + b * 0.19], [0, 1, 0], 0.8); B.tube({ pts: Array.from({ length: 8 }, (_, k) => { const a = k / 8 * P * 2; return [A[0] + Math.cos(a) * 0.06, DY + 0.1 + Math.sin(a) * 0.06, A[2]]; }), closed: true, r: 0.012, mat: iron, seg: 5, segs: 16, cast: false });
    B.beam([A[0] + t[0] / tl * 0.12, A[1] + t[1] / tl * 0.12, A[2] + t[2] / tl * 0.12], [A[0] + t[0] / tl * 0.45, A[1] + t[1] / tl * 0.45, A[2] + t[2] / tl * 0.45], 0.05, 0.05, { mat: iron, bevel: 0, cast: false }); }
}
