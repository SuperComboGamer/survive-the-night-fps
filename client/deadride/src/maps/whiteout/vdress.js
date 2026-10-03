// Village dressing: festoon light strings, the plaza Christmas tree, the Gluhwein stall, benches, barrels, luggage, a sled, and the terminal hall's
// parked-cabin garage + waiting-room furniture. Everything is Builder geometry (batched) + halos; a few pooled lights give the warm pools.
import * as THREE from 'three';
import { Frame, pineGeometry, quad } from './common.js';
import { signMaterial, canvasTexture } from '../../core/canvas2d.js';
import { makeRng } from '../../core/util.js';
import { std } from '../../core/mats.js';

const P = Math.PI;
/** parked cabins per World (stop-local poses + origin) so the vehicle (built after the stops) can instance them with the traffic cabins */
export const PARKED = new WeakMap();
const BULBS = [['W', 0xfff0d0], ['W', 0xffe2b0], ['R', 0xff3a2a], ['W', 0xfff0d0], ['G', 0x35ff6a], ['W', 0xffe2b0], ['B', 0x4a88ff], ['W', 0xfff0d0], ['Y', 0xffc020]];
let bulbGeo = null;
function bulbMats(B) {
  if (B._bulbs) return B._bulbs; const o = {}; for (const [k, c] of BULBS) if (!o[k]) o[k] = B.m('bulb' + k, std({ color: 0x0a0a0a, emissive: c, emissiveIntensity: 5.5, roughness: 0.3 }));
  return (B._bulbs = o);
}
/** one string of festoon bulbs on a catenary between a and b (stop-local points) */
export function festoon(B, M, halos, a, b, { sag = 0.8, n = 12, seed = 1, halo = 0.34, hI = 0.42 } = {}) {
  const mats = bulbMats(B); bulbGeo = bulbGeo || new THREE.IcosahedronGeometry(0.06, 1); B.cable(a, b, sag, 0.011, M.iron, { n: 18, seg: 4, cast: false });
  for (let i = 1; i < n; i++) {
    const t = i / n, pt = BULBS[(i + seed) % BULBS.length]; const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t) - 0.07, a[2] + (b[2] - a[2]) * t];
    B.instance('bulb' + pt[0], bulbGeo, mats[pt[0]], B.matrix(p, 0, 1), 0xffffff, { cast: false }); halos.add(p, pt[1], halo, hI, 0);
  }
}
export function festoonPole(B, M, x, z, h = 5.2) {
  const F = new Frame(B, x, z, 0, 0); F.cyl({ p: [0, 0, 0], r: [0.13, 0.09], h, seg: 8, mat: M.beam, col: 'wood' }); F.box({ p: [0, h - 0.5, 0], s: [0.9, 0.09, 0.09], mat: M.beam, col: false, cast: false });
  B.rock({ p: [x, 0.12, z], r: 0.5, squash: [1.2, 0.3, 1.2], amp: 0.3, seed: 7, detail: 1, mat: M.snow, cast: false });
}

/** a lit Christmas tree with a spiral garland, star and presents */
export function christmasTree(ctx, B, M, halos, x, z, h = 6.4) {
  const mats = bulbMats(B), rng = makeRng(91); bulbGeo = bulbGeo || new THREE.IcosahedronGeometry(0.06, 1);
  B.instance('xtree', pineGeometry({ h, tiers: 10, snow: 0.3, fans: 9, seed: 44 }), M.pine, B.matrix([x, 0, z], 0.3, 1), 0xffffff, { cast: true });
  B.colliders.addCyl({ x, z, r: 0.5, y0: 0, y1: h, surface: 'wood', walk: false });
  const rad = (y) => 2.05 * Math.pow(Math.max(0, 1 - y / (h + 0.4)), 0.95) + 0.06;
  for (let i = 0; i < 90; i++) { const t = i / 90, y = 0.9 + t * (h - 1.5), a = t * 6.283 * 6.5, r = rad(y) * 0.86; const p = [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; const pt = BULBS[(i * 5 + 3) % BULBS.length];
    B.instance('bulb' + pt[0], bulbGeo, mats[pt[0]], B.matrix(p, 0, 1.1), 0xffffff, { cast: false }); if (i % 2 === 0) halos.add(p, pt[1], 0.3, 0.42, 0); }
  const star = B.m('xstar', std({ color: 0x1a1204, emissive: 0xffd060, emissiveIntensity: 9 }));
  for (const rz of [0, P / 4]) B.box({ p: [x, h - 0.05, z], s: [0.5, 0.5, 0.09], mat: star, roll: rz, anchor: 'center', bevel: 0.01, col: false, cast: false }); halos.add([x, h - 0.05, z], 0xffd890, 1.5, 0.8, 0);
  const gift = ['paintRed', 'paintGreen', 'paintBlue', 'plaster']; for (let i = 0; i < 6; i++) { const a = 0.6 + i * 1.05 + rng() * 0.3, r = 1.15 + rng() * 0.7, w = 0.3 + rng() * 0.3, hh = 0.25 + rng() * 0.3; const gx = x + Math.cos(a) * r, gz = z + Math.sin(a) * r;
    B.box({ p: [gx, 0, gz], s: [w, hh, w], yaw: rng() * 3, mat: M[gift[i % 4]], bevel: 0.01, col: false, cast: false }); B.box({ p: [gx, hh, gz], s: [0.05, 0.02, w + 0.01], yaw: 0, mat: M.glowWhite, col: false, cast: false }); }
  B.rock({ p: [x, 0.1, z], r: 1.9, squash: [1, 0.12, 1], amp: 0.25, seed: 5, detail: 2, mat: M.snow, cast: false });
  ctx.light({ pos: [x, 3.2, z], color: 0xffc890, intensity: 12, distance: 11, decay: 2, flicker: 0.05, flickerSpeed: 5 });
}

/** open-fronted Gluhwein stall: timber hut, striped awning, glowing counter, sign, steaming pot */
export function stall(ctx, B, M, halos, x, z, yaw) {
  const F = new Frame(B, x, z, yaw, 0), W = 3.4, D = 2.4, H = 2.5; const t = 0.12;
  F.box({ p: [0, -0.02, 0], s: [W + 0.4, 0.16, D + 0.4], mat: M.beam, bevel: 0.02, col: false, cast: false });
  F.box({ p: [0, 0.14, D / 2 - t / 2], s: [W, H, t], mat: M.timberV, bevel: 0.01, col: 'wood' }); for (const sx of [-1, 1]) F.box({ p: [sx * (W / 2 - t / 2), 0.14, 0], s: [t, H, D], mat: M.timberV, bevel: 0.01, col: 'wood' });
  F.box({ p: [0, 0.14, D / 2 - t - 0.04], s: [W - 0.3, H - 0.3, 0.03], mat: M.glow, col: false, cast: false });                                                                     // warm glow on the back wall
  for (const sx of [-1, 1]) F.box({ p: [sx * (W / 2 - 0.05), 0.14, -D / 2 + 0.05], s: [0.16, H + 0.1, 0.16], mat: M.beam, bevel: 0.02, col: 'wood' });
  F.box({ p: [0, H + 0.14, 0.15], s: [W + 0.5, 0.14, D + 0.9], mat: M.shingle, pitch: -0.16, bevel: 0.02, col: false }); F.rock({ p: [0, H + 0.42, 0.25], r: 1.9, squash: [1.0, 0.13, 0.62], amp: 0.3, seed: 8, detail: 2, mat: M.snow, cast: false });
  F.box({ p: [0, 0.14, -D / 2 + 0.25], s: [W - 0.1, 0.95, 0.5], mat: M.timber, bevel: 0.02, col: 'wood' }); F.box({ p: [0, 1.09, -D / 2 + 0.22], s: [W + 0.08, 0.07, 0.62], mat: M.beam, bevel: 0.02, col: false, cast: false });   // counter
  F.box({ p: [0, 1.16, -D / 2 + 0.22], s: [W - 0.2, 0.06, 0.5], mat: M.snow, bevel: 0.03, col: false, cast: false });
  const stripes = 9, sw = (W + 0.4) / stripes; for (let i = 0; i < stripes; i++) F.box({ p: [-(W + 0.4) / 2 + sw * (i + 0.5), H - 0.34, -D / 2 - 0.42], s: [sw, 0.05, 1.05], pitch: 0.42, mat: i % 2 ? M.plaster : M.steelRed, bevel: 0.004, col: false, cast: false });   // awning
  for (let i = 0; i < stripes; i++) F.box({ p: [-(W + 0.4) / 2 + sw * (i + 0.5), H - 0.72, -D / 2 - 0.86], s: [sw, 0.22, 0.02], mat: i % 2 ? M.plaster : M.steelRed, bevel: 0.002, col: false, cast: false });
  const sign = signMaterial({ lines: ['GLUHWEIN', '& PUNSCH'], bg: '#2b120c', fg: '#ffd9a0', w: 512, h: 192, glow: 1.6, weather: 0.5, border: true });
  F.box({ p: [0, H + 0.34, -D / 2 - 0.02], s: [W * 0.62 + 0.08, 0.7, 0.05], mat: M.timber, bevel: 0.01, col: false, cast: false }); quad(B, sign, F.p(0, H + 0.69, -D / 2 - 0.06), W * 0.62, 0.62, F.yaw + P);
  // pot on the counter, mugs, warm light
  F.cyl({ p: [-0.7, 1.16, -D / 2 + 0.28], r: 0.24, h: 0.42, seg: 14, mat: M.steel, col: false, cast: false }); F.cyl({ p: [-0.7, 1.58, -D / 2 + 0.28], r: 0.26, h: 0.04, seg: 14, mat: M.iron, col: false, cast: false });
  const mug = new THREE.CylinderGeometry(0.045, 0.04, 0.1, 8); for (let i = 0; i < 8; i++) B.instance('mug', mug, M.plaster, F.m([0.1 + (i % 4) * 0.2, 1.24, -D / 2 + 0.16 + Math.floor(i / 4) * 0.2]), 0xffffff, { cast: false });
  F.box({ p: [0.9, 1.16, -D / 2 + 0.3], s: [0.5, 0.3, 0.3], mat: M.iron, bevel: 0.02, col: false, cast: false });
  const wp = F.p(0, 1.7, -D / 2 + 0.6); halos.add(wp, 0xffb060, 1.9, 0.5, 6); ctx.light({ pos: wp, color: 0xffa860, intensity: 13, distance: 10, decay: 2, flicker: 0.08, flickerSpeed: 6 });
  for (let i = 0; i < 6; i++) { const q = F.p(-W / 2 + 0.2 + i * (W - 0.4) / 5, H - 0.1, -D / 2 - 0.05); halos.add(q, 0xfff0d0, 0.28, 0.4, 0); }
  return { steam: F.p(-0.7, 1.7, -D / 2 + 0.28), F };
}

export function bench(B, M, x, z, yaw) {
  const F = new Frame(B, x, z, yaw, 0);
  for (const su of [-1, 1]) { F.box({ p: [su * 0.72, 0, 0], s: [0.06, 0.42, 0.44], mat: M.iron, bevel: 0.01, col: false, cast: false }); F.box({ p: [su * 0.72, 0.4, 0.2], s: [0.06, 0.55, 0.06], mat: M.iron, pitch: 0.1, bevel: 0.01, col: false, cast: false }); }
  for (let i = 0; i < 3; i++) F.box({ p: [0, 0.42, -0.16 + i * 0.16], s: [1.6, 0.04, 0.13], mat: M.timberV, bevel: 0.008, col: false, cast: false });
  for (let i = 0; i < 2; i++) F.box({ p: [0, 0.68 + i * 0.16, 0.2 + i * 0.03], s: [1.6, 0.04, 0.12], mat: M.timberV, bevel: 0.008, pitch: -0.12, col: false, cast: false });
  F.rock({ p: [0, 0.5, 0], r: 0.7, squash: [1.05, 0.11, 0.3], amp: 0.3, seed: 2, detail: 1, mat: M.snow, cast: false });
  B.colliders.addBox({ x, y: 0.45, z, hx: 0.85 * Math.abs(Math.cos(yaw)) + 0.3 * Math.abs(Math.sin(yaw)), hy: 0.45, hz: 0.85 * Math.abs(Math.sin(yaw)) + 0.3 * Math.abs(Math.cos(yaw)), yaw: 0, surface: 'wood', walk: false });
}
export function barrel(B, M, x, z, snow = true) {
  const F = new Frame(B, x, z, 0, 0); F.cyl({ p: [0, 0, 0], r: 0.29, h: 0.88, seg: 14, mat: M.steelRed, col: 'metal' }); for (const y of [0.12, 0.44, 0.74]) F.cyl({ p: [0, y, 0], r: 0.3, h: 0.04, seg: 14, mat: M.steel, col: false, cast: false });
  if (snow) F.rock({ p: [0, 0.9, 0], r: 0.3, squash: [1, 0.35, 1], amp: 0.3, seed: 3, detail: 1, mat: M.snow, cast: false });
}
/** a pile of luggage: suitcases with straps, a ski bag and a rucksack, half under snow */
export function luggage(B, M, x, z, yaw, seed = 1) {
  const F = new Frame(B, x, z, yaw, 0), rng = makeRng(seed * 5 + 1); const cols = [M.paintRed, M.paintBlue, M.paintGreen, M.rubber];
  for (let i = 0; i < 4; i++) { const w = 0.5 + rng() * 0.25, h = 0.34 + rng() * 0.2, d = 0.22 + rng() * 0.1, u = (i - 1.5) * 0.5 + (rng() - 0.5) * 0.15, y = i === 3 ? 0.4 : 0; F.box({ p: [u, y, (rng() - 0.5) * 0.3], s: [w, h, d], yaw: (rng() - 0.5) * 0.5, mat: cols[i % 4], bevel: 0.05, col: false });
    F.box({ p: [u, y + 0.02, 0], s: [0.04, h + 0.02, d + 0.02], yaw: 0, mat: M.iron, col: false, cast: false }); }
  F.cyl({ p: [-0.2, 0.2, 0.42], r: 0.11, h: 1.8, seg: 8, mat: M.steel, roll: P / 2 - 0.1, anchor: 'center', col: false });
  F.rock({ p: [0.1, 0.32, 0], r: 0.9, squash: [1.0, 0.16, 0.5], amp: 0.35, seed: 3 + seed, detail: 1, mat: M.snow, cast: false });
  B.colliders.addBox({ x, y: 0.3, z, hx: 1.0, hy: 0.3, hz: 0.5, yaw, surface: 'wood', walk: false });
}
export function sled(B, M, x, z, yaw, lean = 0.5) {
  const F = new Frame(B, x, z, yaw, 0);
  for (const su of [-1, 1]) { F.box({ p: [su * 0.24, 0.06, 0], s: [0.05, 0.05, 1.5], mat: M.iron, pitch: lean, bevel: 0.01, col: false, cast: false }); F.box({ p: [su * 0.24, 0.18, 0], s: [0.05, 0.16, 1.4], mat: M.beam, pitch: lean, bevel: 0.01, col: false, cast: false }); }
  for (let i = 0; i < 6; i++) { const v = -0.6 + i * 0.24; F.box({ p: [0, 0.28 + (v + 0.6) * Math.sin(lean) * 0.9, v * Math.cos(lean)], s: [0.56, 0.035, 0.18], mat: M.timberV, pitch: lean, bevel: 0.005, col: false, cast: false }); }
}

// ------------------------------------------------------------------ terminal hall: parked-cabin garage + waiting room furniture
function boardTexture(lines, { bg = '#07121d', fg = '#8fe6ff', w = 512, h = 192 } = {}) {
  return canvasTexture(w, h, (c) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.textBaseline = 'middle'; c.font = `700 ${Math.round(h / (lines.length + 0.9))}px "Courier New", monospace`; lines.forEach((l, i) => c.fillText(l, 22, (i + 0.75) * h / (lines.length + 0.6))); for (let y = 0; y < h; y += 3) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, y, w, 1); } });
}
function boardMat(B, key, lines, opts) { const t = boardTexture(lines, opts); return B.m(key, std({ color: 0x050a10, map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.5 })); }

/** hall furniture along the north wall + a garage rail with parked cabins along the south wall. Returns the parked cabin poses (stop-local) for the traffic instancer. */
export function hallDressing(ctx, B, M, halos, HALL) {
  const parked = []; const { x0, x1, z0, z1, eave } = HALL; const rng = makeRng(23);
  // ---- garage siding: a carrier rail on hangers along the south wall, six spare cabins hanging from it (floor 0.05 above the concrete)
  const gz = z1 - 2.75, gx0 = x0 + 21, gx1 = x1 - 2.5;
  B.box({ p: [(gx0 + gx1) / 2, 4.55, gz], s: [gx1 - gx0 + 2, 0.18, 0.22], mat: M.steel, bevel: 0.03, col: false, cast: false });
  for (let x = gx0; x <= gx1 + 0.1; x += 4.6) { B.beam([x, 4.6, gz], [x, eave + 1.7, gz - 0.2], 0.09, 0.09, { mat: M.iron, cast: false }); }
  const n = 6, step = (gx1 - gx0 - 2) / (n - 1); for (let i = 0; i < n; i++) parked.push({ x: gx0 + 1 + i * step, y: 0.02, z: gz, yaw: -P / 2, num: 20 + i });
  B.box({ p: [gx0 - 1.0, 0, gz + 0.9], s: [0.12, 0.9, 0.12], mat: M.steelRed, col: false, cast: false });   // buffer stop
  // a hazard-taped keep-out line + info board at the garage
  B.box({ p: [(gx0 + gx1) / 2, 0.005, gz - 2.3], s: [gx1 - gx0 + 2, 0.005, 0.16], mat: M.paintRed, col: false, cast: false });
  const info = boardMat(B, 'hallInfo', ['SPARE CABINS', 'IN SERVICE 00', 'RESERVE     06'], { fg: '#ffd070' }); B.box({ p: [gx0 + 3.5, 2.68, z1 - 0.6], s: [3.28, 1.04, 0.05], mat: M.iron, bevel: 0.01, col: false, cast: false }); quad(B, info, [gx0 + 3.5, 3.2, z1 - 0.64], 3.2, 1.0, P); halos.add([gx0 + 3.5, 2.9, z1 - 1.0], 0xffd890, 1.2, 0.18, 0);
  // ---- waiting area along the north wall: benches, ticket booth, lockers, notice boards, plants
  const nz = z0 + 1.9;
  for (let i = 0; i < 4; i++) bench(B, M, x0 + 10 + i * 3.2, nz, P);
  const F = new Frame(B, x0 + 6.5, z0 + 3.4, 0, 0);                                                                           // ticket booth: counter + glass + sign
  F.box({ p: [0, 0, 0], s: [3.4, 1.05, 0.9], mat: M.timber, bevel: 0.03, col: 'wood' }); F.box({ p: [0, 1.05, 0], s: [3.5, 0.06, 1.0], mat: M.beam, bevel: 0.02, col: false, cast: false });
  F.box({ p: [0, 1.1, 0.3], s: [3.2, 1.2, 0.05], mat: M.ice, bevel: 0.005, col: false, cast: false }); F.box({ p: [0, 2.3, 0.3], s: [3.3, 0.5, 0.2], mat: M.iron, bevel: 0.01, col: false, cast: false }); quad(B, boardMat(B, 'hallTickets', ['TICKETS   KASSE'], { fg: '#ff8a70', h: 96 }), F.p(0, 2.55, 0.41), 3.2, 0.44, 0);
  halos.add(F.p(0, 2.5, -0.3), 0xffb080, 1.0, 0.16, 0); ctx.light({ pos: F.p(0, 2.2, -1.0), color: 0xffd9a8, intensity: 9, distance: 9, decay: 2 });
  const L = new Frame(B, x0 + 25, z0 + 0.9, 0, 0); for (let i = 0; i < 8; i++) { L.box({ p: [(i - 3.5) * 0.52, 0, 0], s: [0.5, 2.0, 0.6], mat: i % 2 ? M.steel : M.steelRed, bevel: 0.015, col: i === 0 ? 'metal' : false }); L.box({ p: [(i - 3.5) * 0.52, 1.5, -0.31], s: [0.2, 0.08, 0.02], mat: M.iron, col: false, cast: false }); }
  B.colliders.addBox({ x: x0 + 25, y: 1, z: z0 + 0.9, hx: 2.1, hy: 1, hz: 0.3, yaw: 0, surface: 'metal', walk: false });
  const map = boardMat(B, 'hallMap', ['PISTEN', 'BLUE  02  04', 'RED   01  03', 'BLACK 05', 'CLOSED: WIND'], { fg: '#9fe0ff', h: 256, w: 512 }); B.box({ p: [x0 + 15, 1.2, z0 + 0.7], s: [2.68, 1.34, 0.05], mat: M.iron, bevel: 0.01, col: false, cast: false }); quad(B, map, [x0 + 15, 1.87, z0 + 0.74], 2.6, 1.3, 0); halos.add([x0 + 15, 2.0, z0 + 1.2], 0x9fdcff, 1.1, 0.18, 0);
  for (const px of [x0 + 2.4, x0 + 14, x0 + 35]) { const pf = new Frame(B, px, z0 + 1.2, 0, 0); pf.cyl({ p: [0, 0, 0], r: [0.3, 0.24], h: 0.5, seg: 10, mat: M.steel, col: false }); pf.cyl({ p: [0, 0.5, 0], r: 0.26, h: 0.1, seg: 10, mat: M.dark, col: false, cast: false });
    B.instance('hallPot', pineGeometry({ h: 2.4, tiers: 6, snow: 0.0, fans: 7, seed: 12 }), M.pine, B.matrix([px, 0.5, z0 + 1.2], 0, 1), 0xffffff, { cast: false }); }
  for (let i = 0; i < 3; i++) { luggage(B, M, x0 + 20 + i * 5.5, z1 - 1.6 - (i % 2) * 0.3, 0.1 * i, 30 + i); }
  return { parked };
}

// ------------------------------------------------------------------ parked vehicles (snow-buried resort SUV / ski bus) and roadside snow poles
/** kind 'suv' | 'bus'. Body, cabin glass, wheels, lights; snow heaped on the roof + hood, drift banked on the windward flank. */
export function parkedCar(B, M, x, z, yaw, { kind = 'suv', paint = null, snow = 1, H = null, sink = 0.1 } = {}) {
  const bus0 = kind === 'bus', L0 = bus0 ? 6.6 : 4.5; let y = 0; if (H) { y = 1e9; for (const [a, b] of [[0, 0], [0, 1], [0, -1], [0.9, 1], [-0.9, 1], [0.9, -1], [-0.9, -1]]) { const px = x + a * Math.cos(yaw) + b * L0 * 0.5 * Math.sin(yaw), pz = z - a * Math.sin(yaw) + b * L0 * 0.5 * Math.cos(yaw); y = Math.min(y, H(px, pz)); } y -= sink; }
  const F = new Frame(B, x, z, yaw, y); const bus = kind === 'bus'; const L = bus ? 6.6 : 4.5, W = bus ? 2.2 : 1.9, Hb = bus ? 1.15 : 0.95, Hc = bus ? 1.15 : 0.72; const body = paint || (bus ? M.paintBlue : M.paintRed);
  const glass = B.m('carGlass', std({ color: 0x0c1218, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.75, depthWrite: false }));
  F.box({ p: [0, 0.3, 0], s: [W, Hb, L], mat: body, bevel: 0.14, col: 'metal', walk: false });
  F.box({ p: [0, 0.3 + Hb, bus ? 0 : 0.25], s: [W - 0.16, Hc, bus ? L - 0.6 : L * 0.55], mat: body, bevel: 0.16, col: false });
  F.box({ p: [0, 0.3 + Hb + 0.12, bus ? 0 : 0.25], s: [W - 0.12, Hc - 0.3, bus ? L - 0.4 : L * 0.55 - 0.1], mat: glass, bevel: 0.05, col: false, cast: false, recv: false });
  for (const sx of [-1, 1]) for (const sz of bus ? [-2.2, 2.2] : [-1.4, 1.4]) { F.cyl({ p: [sx * (W / 2 - 0.05), 0.02, sz], r: 0.38, h: 0.28, seg: 14, mat: M.rubber, roll: P / 2, anchor: 'base', col: false, cast: false }); F.cyl({ p: [sx * (W / 2 + 0.08), 0.02, sz], r: 0.2, h: 0.04, seg: 10, mat: M.steel, roll: P / 2, col: false, cast: false }); }
  for (const sx of [-1, 1]) { F.box({ p: [sx * (W / 2 - 0.28), 0.62, -L / 2 - 0.01], s: [0.36, 0.16, 0.05], mat: M.glowWhite, col: false, cast: false }); F.box({ p: [sx * (W / 2 - 0.28), 0.62, L / 2 + 0.01], s: [0.3, 0.14, 0.05], mat: M.lampGlow, col: false, cast: false }); }
  F.box({ p: [0, 0.16, -L / 2 - 0.05], s: [W - 0.2, 0.22, 0.16], mat: M.steel, bevel: 0.03, col: false, cast: false });
  if (bus) { for (let i = 0; i < 6; i++) F.box({ p: [(i % 2 ? 1 : -1) * 0.0, 0.3 + Hb + 0.35, -2.4 + i * 0.95], s: [W - 0.06, 0.04, 0.05], mat: M.iron, col: false, cast: false }); F.box({ p: [0, 0.3 + Hb + Hc + 0.03, -L / 2 + 0.6], s: [0.9, 0.22, 0.05], mat: M.glow, col: false, cast: false }); }
  else { F.box({ p: [0, 0.3 + Hb + Hc + 0.02, 0.25], s: [1.3, 0.06, 0.06], mat: M.iron, col: false, cast: false }); F.box({ p: [0, 0.3 + Hb + Hc + 0.02, 0.25], s: [0.06, 0.06, 1.1], mat: M.iron, col: false, cast: false }); }   // roof rails
  const sh = 0.5 * snow;
  F.rock({ p: [0, 0.3 + Hb + Hc + 0.05, bus ? 0 : 0.25], r: 1, squash: [W * 0.56, sh * 0.5, (bus ? L - 0.6 : L * 0.55) * 0.56], amp: 0.3, seed: 4 + (x | 0), detail: 2, mat: M.snow, cast: false });
  F.rock({ p: [0, 0.3 + Hb + 0.05, bus ? -L * 0.42 : -L * 0.3], r: 1, squash: [W * 0.5, sh * 0.4, L * 0.22], amp: 0.3, seed: 9, detail: 1, mat: M.snow, cast: false });
  for (const sx of [-1, 1]) F.rock({ p: [sx * (W * 0.62), 0.02, 0.1], r: 1, squash: [0.95 * snow, 0.42 * snow, L * 0.56], amp: 0.28, seed: 13 + (z | 0) + sx, detail: 2, mat: M.snow, cast: false });     // low skirts of drifted snow along both flanks
  F.rock({ p: [0, 0.0, -L * 0.55], r: 1, squash: [W * 0.6, 0.4 * snow, 0.9], amp: 0.28, seed: 21 + (x | 0), detail: 2, mat: M.snow, cast: false });
}
/** reflective snow pole (the tall red/black stakes that mark roadsides under deep snow) */
export function snowPole(B, M, x, z, y = 0, h = 2.4) {
  B.cyl({ p: [x, y, z], r: 0.03, h, seg: 6, mat: M.iron, col: false, cast: true }); B.box({ p: [x, y + h - 0.45, z], s: [0.07, 0.4, 0.07], mat: M.steelRed, col: false, cast: false }); B.box({ p: [x, y + h - 0.13, z], s: [0.06, 0.1, 0.06], mat: M.glowWhite, col: false, cast: false });
}
