// AFTER HOURS — Main Street shopfronts as REAL construction (no more paintings on a flat wall):
//   * the facade is a 1.0 m thick "skin" of wall boxes with true openings (display bays, panelled doors, upper windows) in front of a solid rear mass -> deep reveals, you see INTO the bay
//   * display bays: painted back wall (interior depth), wooden floor, ceiling light strip, shelves + brackets, real merchandise geometry per shop kind (plush bears, gift boxes, candy jars,
//     lollipops, cake stands, hats, mannequins, arcade cabinets, diner stools), price tags, glass pane with sky reflection
//   * upper windows: reveal 0.75 m deep, lit curtain panel at the back, pleated drapes each side, sash bars, glass; lit windows get furniture silhouettes (lamp, armchair, plant)
//   * doors: recessed panelled leaf (stiles, rails, raised lower panel, glazed upper), brass pull handle + kick plate, stone threshold step
// Reference sizes: shop window 2.3 m high above a 1.0 m stall-riser, shelf spacing 0.75 m, plush bear 0.32 m, candy jar 0.26 m, mannequin 1.7 m, door leaf 1.0 x 2.3 m, window opening 1.64 x 1.94 m.
// All merchandise shares ONE palette-textured material (UV -> colour swatch) and is merged into the static batch, so it costs one draw for the whole street.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { toRaw } from '../../core/build.js';
import { std } from '../../core/mats.js';
import { quad, pipe, torus, PI } from './common.js';

const PAL = ['#f0ece0', '#e6d4a8', '#b03830', '#e48ca0', '#3a5fb0', '#88b4dc', '#e2be30', '#dc7a2a', '#3c964a', '#1f5a2c', '#7a4aa4', '#86583a', '#48301e', '#161616', '#d0a63c', '#b6bcc2', '#d6a888', '#781e1e', '#2a8682', '#b4a0d4', '#9cd4b4', '#787c82', '#1c2a58', '#88304a'];
let MATS = null;
export function merchMats() {
  if (MATS) return MATS;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'); const mute = (h) => { const r = parseInt(h.slice(1, 3), 16), gg = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16), L = 0.3 * r + 0.59 * gg + 0.11 * b, k = 0.3; return `rgb(${Math.round((r * (1 - k) + L * k) * 0.92)},${Math.round((gg * (1 - k) + L * k) * 0.9)},${Math.round((b * (1 - k) + L * k) * 0.86)})`; };   // believable, slightly warm, less saturated
  PAL.forEach((c, i) => { g.fillStyle = mute(c); g.fillRect((i % 8) * 8, Math.floor(i / 8) * 8, 8, 8); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  MATS = { lit: std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.55, metalness: 0 }), dim: std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.6, metalness: 0 }),
    glass: std({ color: 0xb8d4f0, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.11, depthWrite: false, envMapIntensity: 2.4 }) };
  MATS.lit.name = 'merch'; MATS.dim.name = 'merchDim'; MATS.glass.name = 'bayGlass'; return MATS;
}

// ------------------------------------------------------------------ tiny part DSL -> merged raw with palette UVs
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3();
const part = (g0, pal, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const g = g0.index ? g0.toNonIndexed() : g0.clone(); const n = g.attributes.position.count, uv = new Float32Array(n * 2), u = ((pal % 8) + 0.5) / 8, v = 1 - (Math.floor(pal / 8) + 0.5) / 8;
  for (let i = 0; i < n; i++) { uv[i * 2] = u; uv[i * 2 + 1] = v; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  E.set(rx, ry, rz, 'XYZ'); Q.setFromEuler(E); g.applyMatrix4(M4.compose(V3.set(x, y, z), Q, S3.set(sx, sy, sz))); return g;
};
const sph = (r, w = 6, h = 4) => new THREE.SphereGeometry(r, w, h), cyl = (rb, rt, h, s = 7) => new THREE.CylinderGeometry(rt, rb, h, s), box = (x, y, z) => new THREE.BoxGeometry(x, y, z), cone = (r, h, s = 7) => new THREE.ConeGeometry(r, h, s), tor = (R, r, s = 3, t = 9) => new THREE.TorusGeometry(R, r, s, t);
/** zig-zag pleated drape: n folds, width w, height h, fold depth amp (+z toward the room front) */
const pleat = (w, h, n, amp) => { const P = [], I = []; for (let i = 0; i <= n; i++) { const x = -w / 2 + w * i / n, z = (i % 2) * amp; P.push(x, 0, z, x, h, z); } for (let i = 0; i < n; i++) { const a = i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); const d = g.toNonIndexed(); return d; };
const dbl = (g) => { const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array, n = P.length / 3, p2 = new Float32Array(P.length), n2 = new Float32Array(N.length), u2 = new Float32Array(U.length);   // back-face copy (winding + normals flipped) so a thin drape is visible from both sides
  for (let t = 0; t < n; t += 3) for (let k = 0; k < 3; k++) { const src = t + (k === 0 ? 0 : k === 1 ? 2 : 1); for (let c = 0; c < 3; c++) { p2[(t + k) * 3 + c] = P[src * 3 + c]; n2[(t + k) * 3 + c] = -N[src * 3 + c]; } u2[(t + k) * 2] = U[src * 2]; u2[(t + k) * 2 + 1] = U[src * 2 + 1]; }
  const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.BufferAttribute(p2, 3)); b.setAttribute('normal', new THREE.BufferAttribute(n2, 3)); b.setAttribute('uv', new THREE.BufferAttribute(u2, 2)); return mergeGeometries([g, b]); };

// ------------------------------------------------------------------ item library (each returns an array of part geometries; +z = the side facing the street, y up from 0)
const ITEMS = {
  bear: (a, b) => [part(sph(0.085), a, 0, 0.115, 0, 0, 0, 0, 1, 1.15, 0.9), part(sph(0.062), a, 0, 0.255, 0.01), part(sph(0.026, 4, 3), a, -0.05, 0.31), part(sph(0.026, 4, 3), a, 0.05, 0.31), part(sph(0.03, 4, 3), 1, 0, 0.245, 0.058, 0, 0, 0, 1, 0.8, 0.8), part(sph(0.03, 4, 3), a, -0.1, 0.14, 0.03), part(sph(0.03, 4, 3), a, 0.1, 0.14, 0.03), part(sph(0.036, 4, 3), a, -0.05, 0.035, 0.05, 0, 0, 0, 1, 0.9, 1.3), part(sph(0.036, 4, 3), a, 0.05, 0.035, 0.05, 0, 0, 0, 1, 0.9, 1.3), part(box(0.08, 0.02, 0.02), b, 0, 0.19, 0.075)],
  bigBear: (a, b) => ITEMS.bear(a, b).map((g) => g.clone().scale(2.6, 2.6, 2.6)),
  giftbox: (a, b) => [part(box(0.17, 0.13, 0.17), a, 0, 0.065), part(box(0.18, 0.035, 0.18), a, 0, 0.145), part(box(0.022, 0.135, 0.18), b, 0, 0.068), part(box(0.18, 0.135, 0.022), b, 0, 0.068), part(sph(0.03, 4, 3), b, -0.03, 0.185), part(sph(0.03, 4, 3), b, 0.03, 0.185)],
  globe: (a) => [part(cyl(0.07, 0.06, 0.05, 8), 13, 0, 0.025), part(sph(0.085, 8, 6), a, 0, 0.13), part(cone(0.03, 0.09, 5), 8, 0, 0.11)],
  mug: (a) => [part(cyl(0.04, 0.045, 0.1, 8), a, 0, 0.05), part(tor(0.03, 0.009, 3, 8), a, 0.055, 0.055, 0, 0, 0, 0)],
  jar: (a) => [part(cyl(0.075, 0.08, 0.27, 8), a, 0, 0.135), part(cyl(0.085, 0.085, 0.03, 8), 14, 0, 0.285), part(sph(0.022, 4, 3), 14, 0, 0.315)],
  lollies: (a, b) => { const o = []; for (let i = 0; i < 5; i++) { const t = (i - 2) * 0.055; o.push(part(cyl(0.006, 0.006, 0.3, 4), 1, t, 0.15, 0, 0, 0, t * 1.2), part(cyl(0.05, 0.05, 0.014, 8), i % 2 ? a : b, t * 1.6, 0.3, 0.005, PI / 2, 0, 0)); } o.push(part(cyl(0.06, 0.05, 0.07, 8), 12, 0, 0.035)); return o; },
  cakestand: (a, b) => [part(cyl(0.025, 0.02, 0.16, 6), 15, 0, 0.08), part(cyl(0.17, 0.17, 0.014, 10), 15, 0, 0.165), part(cyl(0.13, 0.13, 0.085, 10), a, 0, 0.215), part(sph(0.03, 4, 3), b, 0, 0.27), part(cyl(0.13, 0.13, 0.012, 10), b, 0, 0.24)],
  icecone: (a, b) => [part(cone(0.042, 0.15, 6), 11, 0, 0.075, 0, PI, 0, 0), part(sph(0.052, 6, 4), a, 0, 0.17), part(sph(0.042, 5, 4), b, 0, 0.235)],
  cabinet: (a, b) => [part(box(0.72, 1.7, 0.58), 22, 0, 0.85), part(box(0.56, 0.4, 0.03), b, 0, 1.28, 0.3), part(box(0.66, 0.06, 0.34), 13, 0, 0.95, 0.3, -0.25), part(cyl(0.012, 0.012, 0.09, 5), 15, -0.12, 1.0, 0.3), part(sph(0.028, 5, 4), 2, -0.12, 1.06, 0.3), part(cyl(0.02, 0.02, 0.012, 6), 6, 0.06, 0.965, 0.34), part(cyl(0.02, 0.02, 0.012, 6), 3, 0.13, 0.965, 0.34), part(cyl(0.02, 0.02, 0.012, 6), 5, 0.2, 0.965, 0.34), part(box(0.72, 0.26, 0.6), a, 0, 1.83), part(box(0.6, 0.14, 0.03), 0, 0, 0.7, 0.3)],
  topHat: (a) => [part(cyl(0.09, 0.09, 0.2, 8), 13, 0, 0.1), part(cyl(0.16, 0.16, 0.014, 10), 13, 0, 0.007), part(cyl(0.092, 0.092, 0.035, 8), a, 0, 0.05)],
  witchHat: (a) => [part(cone(0.13, 0.38, 8), a, 0, 0.19), part(cyl(0.22, 0.22, 0.012, 10), a, 0, 0.006), part(cyl(0.13, 0.13, 0.04, 8), 6, 0, 0.04)],
  pirateHat: (a) => [part(sph(0.17, 8, 5), 13, 0, 0.05, 0, 0, 0, 0, 1.25, 0.42, 0.85), part(sph(0.03, 4, 3), 0, 0, 0.09, 0.14)],
  mannequin: (a, b) => [part(cyl(0.2, 0.2, 0.03, 8), 13, 0, 0.015), part(cyl(0.012, 0.012, 1.15, 5), 15, 0, 0.6), part(cyl(0.11, 0.17, 0.62, 8), a, 0, 1.0), part(sph(0.17, 7, 4), a, 0, 1.31, 0, 0, 0, 0, 1, 0.5, 0.75), part(cyl(0.05, 0.05, 0.06, 6), 16, 0, 1.4), part(sph(0.085, 7, 5), 16, 0, 1.52), part(pleat(0.5, 0.7, 6, 0.05), b, 0, 0.75, -0.14)],
  stool: (a) => [part(cyl(0.18, 0.18, 0.06, 10), a, 0, 0.62), part(cyl(0.025, 0.025, 0.58, 5), 15, 0, 0.3), part(cyl(0.21, 0.21, 0.025, 8), 15, 0, 0.012)],
  cup: (a) => [part(cyl(0.16, 0.16, 0.012, 8), 0, 0, 0.006), part(cyl(0.036, 0.046, 0.065, 8), a, 0, 0.045), part(tor(0.026, 0.008, 3, 6), a, 0.05, 0.05)],
  pie: (a) => [part(cyl(0.135, 0.135, 0.016, 10), 15, 0, 0.008), part(cyl(0.12, 0.12, 0.05, 10), a, 0, 0.04), part(cyl(0.09, 0.09, 0.012, 8), 6, 0, 0.07)],
  tag: (a) => [part(box(0.07, 0.045, 0.006), 0, 0, 0.022), part(box(0.04, 0.012, 0.007), 2, 0, 0.03, 0.001)],
  lamp: () => [part(cyl(0.09, 0.07, 0.03, 8), 13, 0, 0.015), part(cyl(0.012, 0.012, 0.42, 5), 12, 0, 0.23), part(cone(0.14, 0.22, 8), 6, 0, 0.55, 0, PI, 0, 0)],
  armchair: (a) => [part(box(0.72, 0.24, 0.66), a, 0, 0.3), part(box(0.72, 0.5, 0.16), a, 0, 0.62, -0.25), part(box(0.14, 0.34, 0.66), a, -0.36, 0.44), part(box(0.14, 0.34, 0.66), a, 0.36, 0.44), part(box(0.05, 0.16, 0.05), 12, -0.3, 0.08, 0.26), part(box(0.05, 0.16, 0.05), 12, 0.3, 0.08, 0.26)],
  plant: () => [part(cyl(0.11, 0.09, 0.22, 7), 17, 0, 0.11), part(sph(0.17, 6, 4), 9, 0, 0.36, 0, 0, 0, 0, 1, 1.2, 1), part(sph(0.11, 5, 4), 8, 0.1, 0.55), part(sph(0.1, 5, 4), 8, -0.09, 0.5)],
  bookcase: () => [part(box(0.6, 1.3, 0.28), 12, 0, 0.65), part(box(0.5, 0.05, 0.3), 2, 0, 1.0), part(box(0.5, 0.05, 0.3), 4, 0, 0.7), part(box(0.5, 0.05, 0.3), 8, 0, 0.4)],
  drape: (a) => [dbl(part(pleat(0.3, 1.95, 6, 0.06), a, 0, 0, 0))],
};
const RAWS = new Map();
/** merged raw for an item; `v` = palette variant args */
function rawOf(name, ...args) {
  const k = name + ':' + args.join(','); let r = RAWS.get(k); if (r) return r;
  const gs = ITEMS[name](...args); const m = gs.length > 1 ? mergeGeometries(gs) : gs[0]; r = toRaw(mergeVertices(m), 'keep'); RAWS.set(k, r); return r;   // indexed: shared vertices (3-6x fewer than triangle soup)
}
const put = (B, mat, raw, x, y, z, yaw = 0, sc = 1) => B.addRaw(raw, B.matrix([x, y, z], yaw, sc), mat, { cast: false });

// ------------------------------------------------------------------ facade skin
/** axis-aligned strip decomposition of the wall front `[zc-ww/2, zc+ww/2] x [0, H]` minus the openings -> boxes of thickness SK. open: [{z0,z1,y0,y1}] */
export function shopSkin(B, wallMat, { xF, s, zc, ww, H, dep, open, SK = 1.0 }) {
  B.colliders.addBox({ x: xF + s * dep / 2, y: H / 2, z: zc, hx: dep / 2, hy: H / 2, hz: ww / 2, surface: 'brick' });   // one solid collision mass, exactly as before
  B.box({ p: [xF + s * (SK + (dep - SK) / 2), 0, zc], s: [dep - SK, H, ww], mat: wallMat, bevel: 0.05, cast: true });   // rear mass (its front face is the back wall of every opening)
  const zs = new Set([zc - ww / 2, zc + ww / 2]); for (const o of open) { zs.add(o.z0); zs.add(o.z1); } const Z = [...zs].sort((a, b) => a - b);
  for (let i = 0; i < Z.length - 1; i++) { const za = Z[i], zb = Z[i + 1]; if (zb - za < 0.02) continue; const zm = (za + zb) / 2, cover = open.filter((o) => o.z0 <= zm && o.z1 >= zm).sort((a, b) => a.y0 - b.y0); let y = 0;
    const piece = (y0, y1) => { if (y1 - y0 < 0.02) return; B.box({ p: [xF + s * SK / 2, y0, zm], s: [SK, y1 - y0, zb - za], mat: wallMat, bevel: 0, cast: (y1 - y0) * (zb - za) > 1.2 }); };
    for (const o of cover) { piece(y, o.y0); y = Math.max(y, o.y1); } piece(y, H); }
}

// ------------------------------------------------------------------ display bay
const KIND_MENU = {
  gifts: { shelf: [['bear', 3], ['giftbox', 3], ['globe', 2], ['mug', 2]], floor: ['bigBear', 'giftbox'], tiers: 3 },
  souv: { shelf: [['bear', 2], ['mug', 4], ['globe', 3], ['giftbox', 2]], floor: ['bigBear'], tiers: 3 },
  candy: { shelf: [['jar', 5], ['lollies', 2], ['cakestand', 1]], floor: ['cakestand'], tiers: 3 },
  ice: { shelf: [['icecone', 4], ['cakestand', 2], ['jar', 1]], floor: ['cakestand'], tiers: 2 },
  arcade: { shelf: [], floor: ['cabinet'], tiers: 0 },
  costume: { shelf: [['topHat', 3], ['witchHat', 2], ['pirateHat', 2]], floor: ['mannequin'], tiers: 2 },
  diner: { shelf: [['cup', 4], ['pie', 3], ['cakestand', 1]], floor: ['stool'], tiers: 2 },
};
const VARIANT = { bear: () => [[0, 1], [3, 2], [11, 2], [10, 6], [16, 4], [7, 0]], bigBear: () => [[11, 2], [1, 3], [16, 4]], giftbox: () => [[2, 14], [4, 14], [8, 6], [10, 14], [3, 0], [6, 2]], globe: () => [[5], [19], [20]], mug: () => [[2], [4], [6], [18], [0], [3]], jar: () => [[2], [6], [3], [8], [7], [10], [18]], lollies: () => [[2, 6], [3, 4], [8, 7], [10, 0]], cakestand: () => [[3, 2], [1, 3], [11, 6], [0, 2]], icecone: () => [[3, 6], [1, 2], [11, 20], [0, 3]], cabinet: () => [[3, 5], [10, 6], [2, 20], [18, 3]], topHat: () => [[2], [10], [14]], witchHat: () => [[10], [13], [8]], pirateHat: () => [[13]], mannequin: () => [[2, 6], [10, 14], [18, 3], [23, 0], [4, 14]], stool: () => [[2], [4], [8]], cup: () => [[0], [0], [1], [15]], pie: () => [[11], [1], [16], [6]] };
/** o: { X, s, yawF, zb, wwin, kind, lit, rng, disp, K: { wood, trim, winLit2 } } — d < 0 is inside the building, the glass sits at d = -0.02, the back wall at d = -0.97 */
export function bayInterior(B, o) {
  const { X, yawF, zb, wwin, kind, rng, disp, K } = o, MM = merchMats(), MAT = o.lit || kind === 'arcade' ? MM.lit : MM.dim, menu = KIND_MENU[kind] || KIND_MENU.gifts, zL = zb - wwin / 2, zR = zb + wwin / 2;
  quad(B, { p: [X(-0.965), 2.15, zb], w: wwin, h: 2.3, yaw: yawF, mat: disp });                                                     // painted / lit back wall: interior depth
  B.box({ p: [X(-0.5), 1.0, zb], s: [1.0, 0.035, wwin], mat: K.wood, bevel: 0, cast: false });                                       // display floor
  B.box({ p: [X(-0.5), 3.22, zb], s: [0.08, 0.05, wwin - 0.2], mat: K.winLit2, bevel: 0, cast: false }); B.box({ p: [X(-0.2), 3.24, zb], s: [0.08, 0.05, wwin - 0.2], mat: K.winLit2, bevel: 0, cast: false });   // ceiling light strips
  quad(B, { p: [X(-0.02), 2.15, zb], w: wwin, h: 2.3, yaw: yawF, mat: MM.glass });                                                    // glass pane (sky reflection)
  const wtot = menu.shelf.reduce((a, b) => a + b[1], 0), pickShelf = () => { let t = rng() * wtot; for (const [n, w] of menu.shelf) { t -= w; if (t <= 0) return n; } return menu.shelf[0][0]; };
  const vary = (n) => { const list = VARIANT[n](); return list[Math.floor(rng() * list.length)]; };
  const tierY = [1.66, 2.36, 3.0];
  for (let t = 0; t < menu.tiers; t++) { const y = tierY[t];
    B.box({ p: [X(-0.8), y, zb], s: [0.34, 0.03, wwin - 0.12], mat: K.wood, bevel: 0.004, cast: false });
    for (let z = zL + 0.6; z < zR - 0.4; z += 1.5) B.box({ p: [X(-0.86), y - 0.14, z], s: [0.2, 0.14, 0.035], mat: K.trim, bevel: 0, cast: false });   // brackets
    for (let z = zL + 0.3; z < zR - 0.25;) { const n = pickShelf(), a = vary(n), raw = rawOf(n, ...a), wd = { bear: 0.24, giftbox: 0.2, globe: 0.2, mug: 0.13, jar: 0.2, lollies: 0.34, cakestand: 0.38, icecone: 0.17, topHat: 0.36, witchHat: 0.46, pirateHat: 0.4, cup: 0.36, pie: 0.3 }[n] || 0.25;
      if (rng() < 0.9) { put(B, MAT, raw, X(-0.8 + (rng() - 0.5) * 0.06), y + 0.03, z + wd / 2, yawF + (rng() - 0.5) * 0.5); if (rng() < 0.4) put(B, MAT, rawOf('tag', 0), X(-0.6), y + 0.03, z + wd / 2 + 0.04, yawF + (rng() - 0.5) * 0.3); }
      z += wd + 0.03 + rng() * 0.14; } }
  const fl = menu.floor, step = kind === 'arcade' ? 1.0 : kind === 'costume' ? 1.7 : kind === 'diner' ? 0.9 : 2.3, big = kind === 'arcade' || kind === 'costume' || kind === 'gifts' || kind === 'souv';
  for (let z = zL + 0.8, i = 0; z < zR - 0.6; z += step, i++) { const n = fl[i % fl.length], a = vary(n), raw = rawOf(n, ...a); if (kind === 'diner') { put(B, MAT, raw, X(-0.3), 1.035, z, yawF + (rng() - 0.5) * 0.4); continue; } if (!big && rng() < 0.4) continue;
    put(B, MAT, raw, X(kind === 'arcade' ? -0.55 : -0.42 - rng() * 0.15), 1.035, z, yawF + (rng() - 0.5) * (kind === 'arcade' ? 0.15 : 0.5)); }
  if (kind === 'diner') { B.box({ p: [X(-0.58), 1.035, zb], s: [0.38, 0.55, wwin - 0.6], mat: K.wood, bevel: 0.01, cast: false }); B.box({ p: [X(-0.58), 1.6, zb], s: [0.44, 0.04, wwin - 0.5], mat: K.trim, bevel: 0.01, cast: false }); }   // counter
}

// ------------------------------------------------------------------ door
/** recessed panelled door. d = -0.55 leaf plane. o: { X, s, yawF, dz, lit, glass (panel material), sign (open-sign panel), K: { trim, gold, iron, concrete, dark } } */
export function doorReal(B, o) {
  const { X, dz, K } = o, bx = (d, y, z, sd, sy, sz, m, e = {}) => B.box({ p: [X(d), y, z], s: [sd, sy, sz], mat: m, anchor: 'center', bevel: 0, cast: false, ...e });
  for (const e of [-1, 1]) { bx(0.06, 1.22, dz + e * 0.56, 0.16, 2.46, 0.11, K.trim); bx(-0.55, 1.15, dz + e * 0.44, 0.05, 2.3, 0.1, K.trim); }   // frame jambs + leaf stiles
  bx(0.06, 2.46, dz, 0.16, 0.12, 1.24, K.trim); bx(-0.55, 2.26, dz, 0.05, 0.13, 0.98, K.trim); bx(-0.55, 1.05, dz, 0.05, 0.16, 0.9, K.trim); bx(-0.55, 0.13, dz, 0.05, 0.26, 0.9, K.trim);   // head, top rail, lock rail, bottom rail
  bx(-0.52, 0.56, dz, 0.03, 0.68, 0.72, K.trim); bx(-0.5, 0.56, dz, 0.03, 0.5, 0.54, K.trim);                                                                                                 // raised lower panel (two steps)
  quad(B, { p: [X(-0.6), 1.68, dz], w: 0.8, h: 1.06, yaw: o.yawF, mat: o.glass }); quad(B, { p: [X(-0.5), 1.68, dz], w: 0.8, h: 1.06, yaw: o.yawF, mat: merchMats().glass });   // glazed upper leaf: warm interior + glass
  bx(-0.53, 1.68, dz, 0.03, 1.06, 0.03, K.trim); bx(-0.53, 1.68, dz, 0.03, 0.03, 0.8, K.trim);                                                                                                // glazing bars
  quad(B, { p: [X(-0.49), 2.0, dz - 0.12], w: 0.5, h: 0.24, yaw: o.yawF, mat: o.sign });                                                                                                        // OPEN sign hung on the glass
  const hz = dz + 0.34; pipe(B, [X(-0.44), 0.85, hz], [X(-0.44), 1.3, hz], 0.014, K.gold, { seg: 6, cast: false }); for (const y of [0.9, 1.25]) pipe(B, [X(-0.5), y, hz], [X(-0.43), y, hz], 0.008, K.gold, { seg: 4, cast: false });   // brass pull bar + standoffs
  bx(-0.5, 0.15, dz, 0.012, 0.26, 0.82, K.gold); bx(-0.5, 0.95, dz - 0.3, 0.012, 0.03, 0.14, K.gold);                                                                                          // kick plate, letter-box
  B.box({ p: [X(-0.15), 0, dz], s: [0.9, 0.11, 1.3], mat: K.concrete, bevel: 0.01, cast: false });                                                                                             // stone threshold step
}

// ------------------------------------------------------------------ upper window
/** recessed lit window: opening 1.64 x 1.94 (already cut in the skin). o: { X, s, yawF, z, y0, lit, back (panel material), rng, K: { trim } } */
export function upperWindow(B, o) {
  const { X, z, y0, K, rng } = o, hw = 0.82, MM = merchMats(), MAT = o.lit ? MM.dim : MM.dim, cy = y0 + 1.0, bx = (d, y, zz, sd, sy, sz, m = K.trim) => B.box({ p: [X(d), y, zz], s: [sd, sy, sz], mat: m, anchor: 'center', bevel: 0, cast: false });
  quad(B, { p: [X(-0.74), cy, z], w: 2 * hw - 0.02, h: 1.92, yaw: o.yawF, mat: o.back });                                  // curtain / room wall at the back of the reveal
  quad(B, { p: [X(-0.03), cy, z], w: 2 * hw, h: 1.94, yaw: o.yawF, mat: MM.glass });
  bx(-0.05, cy, z, 0.045, 1.94, 0.045); bx(-0.05, cy + 0.32, z, 0.045, 0.04, 2 * hw); bx(-0.05, cy - 0.4, z, 0.045, 0.04, 2 * hw);   // sash mullion + two glazing bars
  for (const e of [-1, 1]) { bx(-0.05, cy, z + e * (hw - 0.02), 0.06, 1.96, 0.05); bx(-0.03, y0 + 0.035, z, 0.07, 0.05, 2 * hw); bx(-0.03, y0 + 1.955, z, 0.07, 0.05, 2 * hw); }   // sash frame
  if (rng() < 0.9) for (const e of [-1, 1]) { const dr = rawOf('drape', [3, 23, 1, 18, 19, 20][Math.floor(rng() * 6)]); put(B, MM.lit, dr, X(-0.16), y0 + 0.02, z + e * (hw - 0.17), o.yawF); }   // pleated drapes
  bx(-0.12, y0 + 1.92, z, 0.03, 0.03, 2 * hw - 0.1, K.iron || K.trim);                                                        // curtain rod
  if (o.lit) { const k = rng(); const items = k < 0.34 ? [['lamp', 0.3, 1.02]] : k < 0.67 ? [['armchair', -0.15, 0], ['lamp', 0.42, 0.62]] : [['plant', -0.28, 0.04], ['bookcase', 0.4, 0]]; for (const [n, dz2, hy] of items) { const raw = n === 'armchair' ? rawOf(n, [12, 17, 22][Math.floor(rng() * 3)]) : rawOf(n); put(B, MAT, raw, X(-0.42), y0 + 0.05 + hy * (n === 'lamp' ? 0.9 : 0), z + dz2, o.yawF + (rng() - 0.5) * 0.4); } }
}
