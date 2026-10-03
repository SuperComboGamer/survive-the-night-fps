// Props of the MID-MOUNTAIN STATION: wrecked chairlift with hanging chairs, snow cannons, avalanche barriers, ski-patrol hut with the red cross,
// crashed rescue sled, generator shed, drifts. Everything cold, hard-edged and rimed.
import * as THREE from 'three';
import { Frame, addIcicles, quad } from './common.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { std } from '../../core/mats.js';
import { makeRng } from '../../core/util.js';
import { wall } from './chalets.js';
import { skyOccluder, windowQuad } from './snowkit.js';
import { latticeTower } from './sdetail.js';

export function drift(B, M, x, y, z, len, h, wid, yaw = 0, seed = 1) { B.rock({ p: [x, y + h * 0.12, z], r: 1, squash: [len / 2, h, wid / 2], amp: 0.3, seed, detail: 2, mat: M.snow, yaw, cast: true, col: false }); }

/** One chairlift chair (local: hanger top at y=0, hanging down): 4-seat, safety bar, footrest. Returns THREE.BufferGeometry parts merged by material key. */
export function chairParts(M) {
  const g = []; // [{geo, mat}]
  const box = (w, h, d, x, y, z, mat, rx = 0) => { const geo = new THREE.BoxGeometry(w, h, d); if (rx) geo.rotateX(rx); geo.translate(x, y, z); g.push({ geo, mat }); };
  const cyl = (r, h, x, y, z, mat, rz = 0, rx = 0) => { const geo = new THREE.CylinderGeometry(r, r, h, 8); if (rz) geo.rotateZ(rz); if (rx) geo.rotateX(rx); geo.translate(x, y, z); g.push({ geo, mat }); };
  cyl(0.03, 2.6, 0, -1.3, 0, M.steel); cyl(0.05, 0.3, 0, 0.05, 0, M.iron);                                     // hanger rod + grip
  box(1.9, 0.08, 0.22, 0, -2.6, 0, M.steel);                                                                     // seat frame beam
  box(1.7, 0.09, 0.5, 0, -2.66, 0.28, M.chairPaint); box(1.7, 0.7, 0.09, 0, -2.3, 0.05, M.chairPaint, -0.12);   // seat + back rest
  cyl(0.02, 1.75, 0, -2.0, 0.6, M.steel, Math.PI / 2); cyl(0.02, 0.9, -0.86, -2.2, 0.6, M.steel); cyl(0.02, 0.9, 0.86, -2.2, 0.6, M.steel); // safety bar
  cyl(0.02, 1.7, 0, -3.1, 0.65, M.steel, Math.PI / 2);                                                            // footrest
  for (const sx of [-0.85, 0.85]) box(0.05, 0.6, 0.05, sx, -2.35, 0.55, M.steel, 0.1);
  return g;
}

/** Chairlift: n towers (T-heads) along a line, rope + chairs; the tower at index `wreck` is toppled. Returns instanced chair matrices count. */
export function chairlift(B, M, ctx, H, a, b, { towers = 4, wreck = 2, chairs = 12, seed = 3 } = {}) {
  const rng = makeRng(seed); const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, yaw = Math.atan2(-ux, -uz);
  const parts = chairParts(M); const pos = [];
  const towerPts = []; for (let i = 0; i < towers; i++) { const t = i / (towers - 1); towerPts.push([a[0] + dx * t, a[1] + dz * t]); }
  const topY = (i) => H(towerPts[i][0], towerPts[i][1]) + 11 + i * 0.6;
  towerPts.forEach((p, i) => {
    const F = new Frame(B, p[0], p[1], yaw, H(p[0], p[1])); const h = 11 + i * 0.6;
    if (i === wreck) { // toppled: lies across the slope, snapped at the base, crossarm buried, rope slack
      const g = new Frame(B, p[0], p[1], yaw + 0.5, H(p[0], p[1]) + 0.5);
      g.cyl({ p: [0, 0, 0], r: [0.34, 0.22], h: 10, seg: 12, mat: M.steel, pitch: 1.36, anchor: 'base', col: 'metal', cast: true }); g.box({ p: [0, 0.8, -8.2], s: [4.6, 0.32, 0.4], mat: M.steel, roll: 0.2, col: false });
      B.box({ p: [p[0], H(p[0], p[1]) - 0.5, p[1]], s: [2.2, 1.0, 2.2], mat: M.concrete, bevel: 0.05, col: 'concrete', walk: false }); B.cyl({ p: [p[0], H(p[0], p[1]) + 0.4, p[1]], r: [0.4, 0.34], h: 0.7, seg: 10, mat: M.steel, col: false });
      B.rock({ p: [p[0] + 1.5, H(p[0], p[1]) + 0.1, p[1] - 3], r: 1, squash: [3, 0.5, 1.4], amp: 0.3, seed: 9, detail: 2, mat: M.snow, cast: false });
      return;
    }
    B.box({ p: [p[0], H(p[0], p[1]) - 0.6, p[1]], s: [2.6, 1.1, 2.6], mat: M.concrete, bevel: 0.05, col: 'concrete', walk: false });
    { const Fa = new Frame(B, p[0], p[1], yaw, H(p[0], p[1]) + 0.4); latticeTower(B, M, Fa, h); F.box({ p: [0, h + 0.75, 0], s: [4.8, 0.3, 0.6], mat: M.snow, bevel: 0.12, col: false, cast: false }); }         // lattice-tube tower + snow on the head
    B.sphere({ p: F.p(0, h + 0.5, 0), r: 0.14, mat: M.lampR, seg: 6, cast: false });
  });
  // ropes (two strands: up / down side) with sag; break the rope beside the wrecked tower (it lies on the snow)
  for (const side of [-2, 2]) for (let i = 0; i < towers - 1; i++) {
    const p0 = towerPts[i], p1 = towerPts[i + 1]; const sx = -uz * side, sz = ux * side; const ya = topY(i) + 0.4, yb = topY(i + 1) + 0.4; const broken = (i === wreck || i + 1 === wreck);
    const pts = []; const n = 12; for (let k = 0; k <= n; k++) { const t = k / n; const x = p0[0] + (p1[0] - p0[0]) * t + sx, z = p0[1] + (p1[1] - p0[1]) * t + sz; let y = ya + (yb - ya) * t - 4 * (broken ? 9 : 2.8) * t * (1 - t); if (broken) { const g = H(x, z) + 0.25; if (i === wreck && t > 0.35) y = Math.max(g, ya - (ya - g) * Math.min(1, (t - 0.35) * 3)); else if (i + 1 === wreck && t < 0.65) y = Math.max(g, yb - (yb - g) * Math.min(1, (0.65 - t) * 3)); } pts.push([x, y, z]); }
    B.tube({ pts, r: 0.025, mat: M.wire, seg: 5, segs: n * 2 });
    if (!broken && side < 0) for (let c = 0; c < 4; c++) { const t = (c + 0.5) / 4 + (rng() - 0.5) * 0.08; const x = p0[0] + (p1[0] - p0[0]) * t + sx, z = p0[1] + (p1[1] - p0[1]) * t + sz; const y = ya + (yb - ya) * t - 4 * 2.8 * t * (1 - t); pos.push({ x, y: y - 0.05, z, yaw: yaw + (rng() < 0.5 ? 0 : Math.PI), sway: (rng() - 0.5) * 0.2, swing: (rng() - 0.5) * 0.25, fallen: false }); }
  }
  // fallen chairs half buried near the wreck
  for (let k = 0; k < 3; k++) { const p = towerPts[wreck]; const x = p[0] + (rng() - 0.5) * 8, z = p[1] + 3 + rng() * 6; pos.push({ x, y: H(x, z) + 2.75, z, yaw: rng() * 6, sway: 0, swing: 0, fallen: true, tilt: 0.5 + rng() * 0.6, roll: (rng() - 0.5) * 1.0 }); }
  // instance chair parts (merged per material into instanced meshes)
  const byMat = new Map(); for (const { geo, mat } of parts) { let e = byMat.get(mat); if (!e) byMat.set(mat, (e = [])); e.push(geo); }
  for (const [mat, geos] of byMat) {
    const merged = geos.length > 1 ? mergeAll(geos) : geos[0];
    pos.forEach((c, i) => { const pitch = c.fallen ? c.tilt : c.swing, roll = c.fallen ? c.roll : c.sway; B.instance('chair' + mat.name, merged, mat, B.matrix([c.x, c.y, c.z], c.yaw, 1, pitch, roll), 0xffffff, { cast: true }); });
  }
  return { towers: towerPts, count: pos.length };
}
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
function mergeAll(geos) { return mergeGeometries(geos.map((g) => { const c = g.index ? g.toNonIndexed() : g; return c; }), false); }

/** Fan-type snow cannon on a pole: gun body, fan ring, nozzle ring, control box, ice crust. */
export function snowCannon(B, M, x, y, z, yaw, { h = 4.6, beacon = true } = {}) {
  const F = new Frame(B, x, z, yaw, y);
  F.box({ p: [0, -0.3, 0], s: [1.6, 0.5, 1.6], mat: M.concreteDark, bevel: 0.03, col: 'concrete' }); F.cyl({ p: [0, 0.2, 0], r: [0.2, 0.15], h: h - 0.2, seg: 10, mat: M.steel, col: 'metal', walk: false });
  F.box({ p: [0, h - 0.1, 0], s: [0.5, 0.4, 0.5], mat: M.steelDark, bevel: 0.04, col: false });
  F.cyl({ p: [0, h + 0.25, -0.55], r: [0.56, 0.5], h: 1.5, seg: 18, mat: M.orange, pitch: Math.PI / 2, anchor: 'center', cast: true });                 // gun barrel (points -v)
  F.cyl({ p: [0, h + 0.25, -1.35], r: [0.62, 0.62], h: 0.16, seg: 18, mat: M.steelDark, pitch: Math.PI / 2, anchor: 'center', cast: false });         // nozzle ring
  F.cyl({ p: [0, h + 0.25, -1.44], r: [0.42, 0.42], h: 0.05, seg: 14, mat: M.dark, pitch: Math.PI / 2, anchor: 'center', cast: false });
  F.box({ p: [0, h + 0.85, 0.05], s: [0.4, 0.3, 0.9], mat: M.orange, bevel: 0.05, col: false }); F.box({ p: [0.55, h + 0.15, 0.4], s: [0.3, 0.4, 0.3], mat: M.steelDark, bevel: 0.03, col: false });
  F.rock({ p: [0, h + 1.05, 0.05], r: 0.55, squash: [0.9, 0.22, 1.5], amp: 0.3, seed: 8, detail: 1, mat: M.snow, cast: false });
  F.rock({ p: [0, h - 0.7, -0.5], r: 0.3, squash: [1, 1.6, 1], amp: 0.5, seed: 4, detail: 1, mat: M.rime, cast: false });
  if (beacon) B.sphere({ p: F.p(0, h + 1.2, 0.4), r: 0.1, mat: M.lampAmber, seg: 6, cast: false });
  F.box({ p: [0.35, 0, 0.6], s: [0.7, 1.1, 0.25], mat: M.galv, bevel: 0.03, col: false });                                                                // hydrant cabinet
  addIcicles(B, M.ice, [F.p(-0.5, 0, -0.9)[0], F.p(-0.5, 0, -0.9)[2]], [F.p(0.5, 0, -0.9)[0], F.p(0.5, 0, -0.9)[2]], { every: 0.12, seed: 5, y: y + h - 0.2, minLen: 0.1, maxLen: 0.5 });
}

/** Avalanche snow-bridge: galvanised A-frame supports with a slatted retaining surface, standing on a slope (yaw = across-slope direction). */
export function snowBridge(B, M, H, x, z, yaw, w = 7, seed = 1) {
  const F = new Frame(B, x, z, yaw, 0); const rng = makeRng(seed); const y0 = (u, v) => { const p = F.p(u, 0, v); return H(p[0], p[2]); };
  const n = Math.round(w / 2.4); for (let i = 0; i <= n; i++) { const u = -w / 2 + i * w / n; const gy = y0(u, 0);
    const a = F.p(u, gy - F.y0 + 0.0, 0), c = F.p(u, gy - F.y0 + 2.6, -0.9), e = F.p(u, y0(u, 2.2), 2.2);
    B.beam(a, c, 0.12, 0.16, { mat: M.galv, cast: true }); B.beam(e.map((q, k) => (k === 1 ? q : q)), c, 0.1, 0.12, { mat: M.galv, cast: true }); }
  const gyc = y0(0, 0);
  for (let k = 0; k < 5; k++) { const yy = 0.4 + k * 0.5; F.beam([-w / 2, gyc - F.y0 + yy, -0.02 - k * 0.19], [w / 2, gyc - F.y0 + yy, -0.02 - k * 0.19], 0.05, 0.22, { mat: M.galv, cast: true }); }
  const ap = F.p(0, gyc - F.y0, 0.5); B.rock({ p: [ap[0], gyc + 0.2, ap[2]], r: 1, squash: [w * 0.5, 0.9, 1.3], amp: 0.3, seed: 40 + Math.floor(rng() * 5), detail: 2, mat: M.snow, yaw, cast: false });
}

/** Ski-patrol hut: steel-and-timber container with the illuminated red cross, a green beacon, a barricadable door; hollow (dark room). */
export function patrolHut(B, M, ctx, x, z, yaw, { barricade = true } = {}) {
  const F = new Frame(B, x, z, yaw, 0); const w = 6.4, d = 4.6, h = 2.9, t = 0.3;
  F.box({ p: [0, -0.3, 0], s: [w + 0.6, 0.3, d + 0.6], mat: M.concreteDark, bevel: 0.03, col: 'concrete' }); F.box({ p: [0, 0.0, 0], s: [w - 0.2, 0.05, d - 0.2], mat: M.timber, col: false, cast: false });
  wall(F, 'u', -d / 2 + t / 2, -w / 2, w / 2, 0, h, t, M.timber, [{ c: 1.4, w: 1.5, y0: 0, y1: 1.9 }, { c: -1.9, w: 1.6, y0: 1.0, y1: 2.2 }], 'wood');
  wall(F, 'u', d / 2 - t / 2, -w / 2, w / 2, 0, h, t, M.timber, [], 'wood'); wall(F, 'v', -w / 2 + t / 2, -d / 2, d / 2, 0, h, t, M.timber, [], 'wood'); wall(F, 'v', w / 2 - t / 2, -d / 2, d / 2, 0, h, t, M.timber, [], 'wood');
  F.box({ p: [0, h, 0], s: [w + 0.8, 0.3, d + 0.8], mat: M.red, bevel: 0.05, col: false }); F.box({ p: [0, h + 0.3, 0], s: [w + 0.5, 0.5, d + 0.5], mat: M.snow, bevel: 0.2, col: false, cast: true }); skyOccluder(B, F, -w / 2 - 0.4, w / 2 + 0.4, -d / 2 - 0.4, d / 2 + 0.4, h - 0.1, h + 0.6);
  windowQuad(B, M.winCool, F.p(-1.9, 1.6, -d / 2 - 0.03), [-F.s, -F.c], 1.6, 1.2, 1);                                                              // desk lamp, radio glow behind the frosted pane
  for (const dx of [-1, 1]) F.box({ p: [-1.9 + dx * 0.85, 0.96, -d / 2 - 0.06], s: [0.1, 1.3, 0.1], mat: M.red, col: false, cast: false }); F.box({ p: [-1.9, 2.25, -d / 2 - 0.06], s: [1.8, 0.1, 0.1], mat: M.red, col: false, cast: false }); F.box({ p: [-1.9, 0.9, -d / 2 - 0.06], s: [1.8, 0.1, 0.1], mat: M.red, col: false, cast: false });
  F.box({ p: [1.4, 1.95, -d / 2 - 0.5], s: [1.0, 0.3, 0.15], mat: M.steelDark, col: false, cast: false }); F.box({ p: [1.4, 1.95, -d / 2 - 0.6], s: [0.92, 0.22, 0.03], mat: M.lampG, col: false, cast: false });   // lamp over the door
  F.cyl({ p: [-2.6, h + 0.3, 1.2], r: 0.03, h: 3.2, seg: 6, mat: M.steel, col: false, cast: false });                                                       // radio whip
  const cross = canvasTexture(256, 256, (c) => { c.fillStyle = '#e8ece6'; c.fillRect(0, 0, 256, 256); c.fillStyle = '#c4201a'; c.fillRect(96, 30, 64, 196); c.fillRect(30, 96, 196, 64); for (let i = 0; i < 200; i++) { c.fillStyle = `rgba(30,40,36,${Math.random() * 0.12})`; c.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 30 + 2, 2); } });
  const cm = B.m('sCross', std({ map: cross, emissiveMap: cross, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.5 }));
  F.box({ p: [0.2, 2.0, -d / 2 - 0.35], s: [0.06, 1.7, 0.06], mat: M.steel, col: false }); F.box({ p: [0.2, 2.0, -d / 2 - 0.05], s: [0.05, 0.05, 0.6], mat: M.steel, col: false });
  quad(B, cm, F.p(2.2, 2.05, -d / 2 - 0.05), 1.3, 1.3, F.yaw + Math.PI);                                                                                 // red cross board (faces -v)
  const gb = B.sphere({ p: F.p(-2.6, h + 0.95, 0), r: 0.13, mat: M.lampG, seg: 6, cast: false }); void gb;
  for (const su of [-1, 1]) F.box({ p: [su * 1.6, 0, d / 2 + 0.3], s: [0.9, 0.9, 0.5], mat: M.orange, bevel: 0.04, col: 'metal' });                        // stretcher boxes on the back
  return { door: F.p(1.4, 0, -d / 2), F };
}

/** Rescue sled ("akja"): crashed on its side, half buried; handles, straps, red shell. */
export function rescueSled(B, M, x, y, z, yaw) {
  const F = new Frame(B, x, z, yaw, y);
  F.box({ p: [0, 0.35, 0], s: [0.8, 0.35, 2.7], mat: M.red, bevel: 0.14, roll: 0.9, pitch: 0.12, col: 'plastic' });
  F.box({ p: [0.25, 0.65, 0.2], s: [0.7, 0.14, 2.2], mat: M.red, bevel: 0.06, roll: 0.9, pitch: 0.12, col: false, cast: false });
  for (const sz of [-1, 1]) F.cyl({ p: [-0.2, 0.7, sz * 1.15], r: 0.018, h: 0.9, seg: 6, mat: M.steel, roll: 0.5, col: false, cast: false });
  F.box({ p: [0.1, 0.42, -1.4], s: [0.06, 0.06, 1.0], mat: M.orange, col: false, cast: false, yaw: 0.3 });
  F.rock({ p: [0.6, 0.15, 0.4], r: 1, squash: [1.4, 0.35, 1.9], amp: 0.3, seed: 14, detail: 1, mat: M.snow, cast: false });
  B.colliders.addBox({ x, y: y + 0.35, z, hx: 0.55, hy: 0.4, hz: 1.4, yaw: F.yaw, surface: 'plastic', walk: false });
}

/** Generator shed: corrugated shed with an orange gen-set, diesel tank, exhaust stack (steam), barricadable door; hollow. */
export function generatorShed(B, M, ctx, x, z, yaw) {
  const F = new Frame(B, x, z, yaw, 0); const w = 5.6, d = 4.4, h = 3.0, t = 0.25;
  F.box({ p: [0, -0.3, 0], s: [w + 0.5, 0.3, d + 0.5], mat: M.concreteDark, bevel: 0.03, col: 'concrete' });
  wall(F, 'u', -d / 2 + t / 2, -w / 2, w / 2, 0, h, t, M.corr, [{ c: -0.9, w: 1.5, y0: 0, y1: 1.9 }], 'metal'); wall(F, 'u', d / 2 - t / 2, -w / 2, w / 2, 0, h, t, M.corr, [], 'metal');
  wall(F, 'v', -w / 2 + t / 2, -d / 2, d / 2, 0, h, t, M.corr, [], 'metal'); wall(F, 'v', w / 2 - t / 2, -d / 2, d / 2, 0, h, t, M.corr, [], 'metal');
  F.box({ p: [0, h, 0.3], s: [w + 0.6, 0.18, d + 1.0], mat: M.corr, pitch: 0.12, bevel: 0.03, col: false }); F.box({ p: [0, h + 0.3, 0.3], s: [w + 0.4, 0.42, d + 0.8], mat: M.snow, pitch: 0.12, bevel: 0.18, col: false, cast: true }); skyOccluder(B, F, -w / 2 - 0.3, w / 2 + 0.3, -d / 2 - 0.5, d / 2 + 0.8, h - 0.1, h + 0.7);
  F.box({ p: [1.0, 0, 0.6], s: [2.2, 1.4, 1.1], mat: M.orange, bevel: 0.06, col: 'metal' }); F.box({ p: [1.0, 1.4, 0.6], s: [1.9, 0.2, 0.9], mat: M.steelDark, col: false });
  F.cyl({ p: [-1.7, 0, 1.4], r: 0.62, h: 1.7, seg: 16, mat: M.orange, pitch: 0, roll: Math.PI / 2, anchor: 'base', col: false });
  F.cyl({ p: [2.3, h - 0.1, 0.6], r: 0.13, h: 1.6, seg: 8, mat: M.steelDark, col: false }); F.cyl({ p: [2.3, h + 1.5, 0.6], r: 0.2, h: 0.1, seg: 8, mat: M.steelDark, col: false, cast: false });
  F.box({ p: [-0.9 + 0.6, 1.2, -d / 2 - 0.02], s: [0.06, 0.06, 0.06], mat: M.lampAmber, col: false, cast: false });
  return { stack: F.p(2.3, h + 1.6, 0.6), F, d };
}
