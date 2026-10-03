// LAST FERRY — route scenery (world space): the bay between the four stops. Channel buoys with blinking lights, a suspension bridge, anchored ships (rocking on the swell),
// a passing ship, container terminal cranes, the city skyline glow, land tiles, the lighthouse beams sweeping across water and fog, gulls, distant headlands.
// Everything animated is driven from anim.hooks (called every frame by the ferry's simulate() and by any visible stop).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { makeBeam } from '../../core/glow.js';
import { StaticBatch, Builder } from '../../core/build.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { makeRng } from '../../core/util.js';
import { STOPS, leg, RIDE } from './layout.js';
import { getSea, anim, lampReg, Glows, LH, makeSoftBeam } from './shared.js';
import { makeBoat } from './boats.js';
import { towerTexture } from './kit.js';
import { makeGulls } from './wharfProps.js';
import { modelTower, latticeBoom } from './arch.js';
import { latticeLeg } from './real.js';

const P = Math.PI;

export async function buildRoute(ctx) {
  const { B, world, gfx } = ctx; const sea = getSea(); sea.attach(world.root); anim.hooks.length = 0; const rng = makeRng(404);
  B.batch.cell = 600; B.batch.cellY = 300; B.inst.cell = 600;
  const glows = new Glows(900); glows.sizeScale = 0.5; B.group.add(glows.mesh);
  // ------------------------------------------------------------------ materials
  const M = {};
  M.land = B.m('rLand', { pattern: 'noise', size: 256, tile: 6, colors: [0x2c2a28, 0x1c1b1a, 0x0a0908, 0x44403a], params: { scale: 6, contrast: 2, fine: 64, speckle: 0.05, pores: 0.2 }, bump: 3, rough: [0.5, 0.9], layers: { wet: 0.6, grime: 0.6 } }, { wet: true });
  M.black = B.m('rBlack', { pattern: 'plates', size: 256, tile: 6, colors: [0x14181c, 0x0e1216, 0x06080a], rustColor: 0x4a2a1c, params: { cols: 4, rows: 2, seam: 0.008, rivets: 6, brushed: 0.3, panelVar: 0.3 }, bump: 2, metal: 0.45, rough: [0.4, 0.8], layers: { rust: 0.35, grime: 0.6, streak: 0.8, edge: 0.3 } }, { wet: true });
  M.bottom = B.m('rBottom', { pattern: 'plates', size: 256, tile: 6, colors: [0x5a1a14, 0x40100c, 0x1a0806], mossColor: 0x2c4a1e, params: { cols: 4, rows: 2, seam: 0.008, rivets: 2, brushed: 0.2, panelVar: 0.3 }, bump: 2, metal: 0.45, rough: [0.5, 0.85], layers: { moss: 0.5, rust: 0.2, grime: 0.5 } }, { wet: true });
  M.deck = B.m('rDeck', { pattern: 'plates', size: 256, tile: 4, colors: [0x3a4a3e, 0x2c3a30, 0x141c16], params: { cols: 3, rows: 3, seam: 0.01, rivets: 4, brushed: 0.3, panelVar: 0.5 }, bump: 2, metal: 0.45, rough: [0.45, 0.85], layers: { rust: 0.3, grime: 0.6, streak: 0.5 } });
  M.white = B.m('rWhite', { pattern: 'plates', size: 256, tile: 4, colors: [0xd0ccc0, 0xb8b4a6, 0x707064], rustColor: 0x6a3a1c, params: { cols: 4, rows: 2, seam: 0.006, rivets: 0, brushed: 0.2, panelVar: 0.3 }, bump: 2, metal: 0.3, rough: [0.45, 0.85], layers: { rust: 0.25, grime: 0.6, streak: 0.9 } }, { wet: true });
  M.steel = B.m('rSteel', { pattern: 'plates', size: 256, tile: 4, colors: [0x4a5460, 0x38414c, 0x1a1f26], rustColor: 0x5a3018, params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.4, panelVar: 0.4 }, bump: 2, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.3, grime: 0.6, streak: 0.5, edge: 0.3 } }, { wet: true });
  M.craneR = B.m('rCrane', { pattern: 'plates', size: 256, tile: 4, colors: [0xa8321f, 0x852416, 0x3a100a], rustColor: 0x5a2a14, params: { cols: 2, rows: 2, seam: 0.008, rivets: 6, brushed: 0.3, panelVar: 0.4 }, bump: 2, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.35, grime: 0.5, streak: 0.6 } });
  M.trim = B.m('rTrim', std({ color: 0x20262c, roughness: 0.5, metalness: 0.7 })); M.dark = B.m('rDark', std({ color: 0x05080a, roughness: 0.08, metalness: 0.2 })); M.rope = B.m('rRope', std({ color: 0x5a4e36, roughness: 0.9 }));
  M.lit = B.m('rLit', std({ color: 0x000000, emissive: 0xffd08a, emissiveIntensity: 1.4, roughness: 0.4 })); M.litC = B.m('rLitC', std({ color: 0x000000, emissive: 0xdff4ff, emissiveIntensity: 1.6, roughness: 0.4 }));
  const ctn = (n, c0, c1) => B.m(n, { pattern: 'corrugated', size: 256, tile: 2, colors: [c0, c1], rustColor: 0x5a2f18, params: { ribs: 20, depth: 1, vertical: 1, dents: 1.2 }, bump: 10, metal: 0.45, rough: [0.4, 0.75], layers: { rust: 0.5, grime: 0.6, streak: 0.8 } }, { wet: true });
  const CT = [ctn('rc0', 0x6a2a20, 0x4a1c14), ctn('rc1', 0x2a4a5a, 0x1e3642), ctn('rc2', 0x8a6a2a, 0x64491c), ctn('rc3', 0x3a5a3a, 0x284028), ctn('rc4', 0x5a5a5e, 0x3c3c40)];
  const towerTex = towerTexture(31, 0.2, 0.9);
  M.tower = B.m('rTower', std({ map: towerTex, emissiveMap: towerTex, emissive: 0xffffff, emissiveIntensity: 1.9, roughness: 0.8 }));
  // ------------------------------------------------------------------ land tiles (city west/east of the pier, SE corner) + skyline blocks with lit windows
  B.box({ p: [-305, -3, 152], s: [430, 4.9, 335], mat: M.land, bevel: 0, col: false, cast: false }); B.box({ p: [225, -3, 152], s: [30, 4.9, 335], mat: M.land, bevel: 0, col: false, cast: false }); B.box({ p: [380, -3.6, 150], s: [280, 4.95, 320], mat: M.land, bevel: 0, col: false, cast: false });
  const skyline = (x0, x1, z0, z1, n, hMin, hMax) => { for (let i = 0; i < n; i++) { const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0), w = 16 + rng() * 26, d = 16 + rng() * 26, h = hMin + Math.pow(rng(), 1.6) * (hMax - hMin); modelTower(B, M.tower, M.trim, x, z, w, d, h, rng); if (h > 90 && rng() < 0.7) glows.add([x, h + 1.5, z], 0xff2010, 1.2, 1.4, 0, { mist: 1.5, blink: [1.9, 0.3, rng() * 2] }); } };
  skyline(-520, -100, 30, 300, 26, 25, 140); skyline(-95, 215, 150, 320, 20, 40, 170); skyline(215, 520, 20, 320, 22, 20, 100);
  // warm city-glow domes (huge soft glare sprites) above the districts
  for (const [x, y, z, c, s, k] of [[60, 50, 230, 0xff9040, 7, 0.16], [-260, 40, 190, 0xff9040, 6, 0.14], [400, 30, 150, 0xff3fb0, 5, 0.12], [340, 30, 40, 0x22e6ff, 4, 0.1]]) glows.add([x, y, z], c, s, k, 0, { mist: 1 });
  // ------------------------------------------------------------------ container terminal on the SE quay: stacks + ship-to-shore cranes (red lights)
  { const zq = 14; for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) { const x = 238 - c * 2.6 + 40, z = 40 + r * 6.4; for (let lv = 0; lv < 1 + ((c + r) % 3); lv++) B.box({ p: [x, 1.9 + lv * 2.62, z], s: [2.44, 2.6, 6.05], mat: CT[(c * 3 + r + lv) % 5], bevel: 0.03, col: false, cast: false }); }
    for (const cx of [262, 300]) { const cz = 10; for (const sx of [-1, 1]) for (const sz of [-1, 1]) latticeLeg(B, cx + sx * 8, 1.9, cz + sz * 6, 32, 1.6, M.craneR, { chord: 0.12, bay: 2.4, noCol: true }); B.box({ p: [cx, 33.5, cz], s: [18, 1.4, 14], mat: M.craneR, bevel: 0.03, col: false, cast: false }); latticeBoom(B, [cx, 34, cz + 6], [cx, 34, cz - 40], 1.7, M.craneR, { bay: 2.4, chord: 0.1, diag: 0.08 }); for (const sx of [-1, 1]) latticeBoom(B, [cx + sx * 8, 32, cz - 6], [cx + sx * 2, 55, cz - 3], 0.8, M.craneR, { bay: 2.2, chord: 0.09, diag: 0.07 }); glows.add([cx, 56, cz - 3], 0xff2010, 1.2, 1.5, 0, { mist: 1.5, blink: [1.6, 0.3, cx * 0.01] }); glows.add([cx, 35, cz - 38], 0xff2010, 1.0, 1.3, 0, { mist: 1.2, blink: [1.6, 0.3, 0.6] }); for (let i = 0; i < 6; i++) glows.add([cx - 8 + i * 3.2, 34.6, cz + 7.2], 0xdff4ff, 0.5, 0.8, 0, { mist: 1 }); } }
  // ------------------------------------------------------------------ ships in the bay (rocking on the swell): anchored bulk carrier + tanker; each with anchor/deck lights
  const shipMats = { top: M.black, bottom: M.bottom, deck: M.deck, cabin: M.white, trim: M.trim, dark: M.dark, lit: M.lit };
  const ships = []; const addShip = (x, z, yaw, spec, sway) => { const s = makeBoat(ctx, { ...spec, mats: shipMats }, ({ B: b, halos, W, zAt, spec: sp }) => { const L = sp.L; // bridge castle aft with lit windows, funnel, hatches, cranes
      const cz = zAt(0.82); b.box({ p: [0, 0, cz], s: [sp.HB * 1.5, sp.free * 2.4, L * 0.1], mat: M.white, bevel: 0.1, cast: true }); for (let f = 0; f < 4; f++) { b.box({ p: [0, sp.free * 2.4 + f * 3.0, cz + 0.4], s: [sp.HB * 1.4 - f * 0.4, 3.0, L * 0.085], mat: M.white, bevel: 0.05, cast: true }); for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) b.box({ p: [sd * (sp.HB * 0.7 - f * 0.2 + 0.02), sp.free * 2.4 + f * 3.0 + 1.2, cz - L * 0.036 + k * (L * 0.014)], s: [0.04, 0.9, 1.4], mat: rng() < 0.6 ? M.lit : M.dark, bevel: 0, cast: false }); b.box({ p: [0, sp.free * 2.4 + f * 3.0 + 1.2, cz - L * 0.043 - 0.02], s: [sp.HB * 1.1, 0.9, 0.05], mat: M.lit, bevel: 0, cast: false }); }
      b.cyl({ p: [0, sp.free * 2.4 + 6, cz + L * 0.03], r: [2.2, 1.8], h: 7, seg: 12, mat: M.craneR, cast: true }); b.cyl({ p: [0, sp.free * 2.4 + 13, cz + L * 0.03], r: 1.8, h: 1.2, seg: 12, mat: M.black, cast: false });
      for (let h = 0; h < 5; h++) { const hz = zAt(0.12 + h * 0.12); b.box({ p: [0, 0, hz], s: [sp.HB * 1.35, 1.1, L * 0.09], mat: M.deck, bevel: 0.08, cast: true }); if (h % 2 === 0 && sp.cranes) { b.cyl({ p: [sp.HB * 0.9, 0, hz], r: 0.6, h: 12, seg: 8, mat: M.craneR, cast: true }); b.beam([sp.HB * 0.9, 12, hz], [sp.HB * 0.4, 9, hz + 12], 0.5, 0.5, { mat: M.craneR, bevel: 0, cast: false }); } }
      b.cyl({ p: [0, 0, zAt(0.06)], r: 0.3, h: 22, seg: 8, mat: M.white, cast: true }); halos.add([0, 22.5, zAt(0.06)], 0xffffff, 1.2, 1.2, 0, { mist: 1.6 }); halos.add([0, sp.free * 2.4 + 13.5, cz], 0xffffff, 1.0, 1.1, 0, { mist: 1.4 }); halos.add([-sp.HB, 5, zAt(0.8)], 0xff2010, 0.7, 1.2, 0, { mist: 1.2 }); halos.add([sp.HB, 5, zAt(0.8)], 0x20ff50, 0.7, 1.2, 0, { mist: 1.2 });
      for (let i = 0; i < 10; i++) halos.add([(rng() - 0.5) * sp.HB * 1.4, 5 + rng() * 3, zAt(0.15 + i * 0.07)], 0xdff4ff, 0.6, 0.7, 0, { mist: 1.3 }); });
    s.setBase(x, z, yaw); s.sway = sway; s.group.position.set(x, 0, z); B.group.add(s.group); ships.push(s); s.tick = 0; return s; };
  addShip(108, -196, 0.5, { L: 118, HB: 9.5, free: 6.5, draft: 7.5, bow: 0.8, stern: 0.8, bulwark: 1.1, sheer: 1.2, cranes: true, seed: 5 }, 0.35);
  addShip(176, -262, -1.9, { L: 92, HB: 7.5, free: 4.2, draft: 6.2, bow: 0.7, stern: 0.75, bulwark: 1.0, sheer: 0.8, seed: 6 }, 0.4);
  addShip(-2, -300, 2.5, { L: 64, HB: 5.6, free: 3.0, draft: 4.2, bow: 0.75, stern: 0.72, bulwark: 1.0, sheer: 0.7, seed: 8, cranes: true }, 0.5);
  // passing cargo ship in the open water west of the lighthouse (moves along a lane; loops)
  const pass = makeBoat(ctx, { L: 150, HB: 11, free: 7.5, draft: 8.5, bow: 0.85, stern: 0.8, bulwark: 1.2, sheer: 1.4, seed: 7, mats: shipMats }, ({ B: b, halos, zAt, spec: sp }) => { const cz = zAt(0.85); b.box({ p: [0, 0, cz], s: [sp.HB * 1.6, sp.free * 2.6, sp.L * 0.09], mat: M.white, bevel: 0.1, cast: true }); for (let f = 0; f < 5; f++) { b.box({ p: [0, sp.free * 2.6 + f * 3.2, cz], s: [sp.HB * 1.5, 3.2, sp.L * 0.08], mat: M.white, bevel: 0.05, cast: true }); for (const sd of [-1, 1]) for (let k = 0; k < 8; k++) b.box({ p: [sd * (sp.HB * 0.76), sp.free * 2.6 + f * 3.2 + 1.3, cz - sp.L * 0.03 + k * (sp.L * 0.0085)], s: [0.04, 1.0, 1.6], mat: M.lit, bevel: 0, cast: false }); } b.cyl({ p: [0, sp.free * 2.6 + 8, cz + 6], r: [2.4, 2], h: 8, seg: 12, mat: M.craneR, cast: true }); for (let h = 0; h < 6; h++) { const hz = zAt(0.1 + h * 0.11); for (let c = 0; c < 3; c++) for (let lv = 0; lv < 4; lv++) b.box({ p: [(c - 1) * 2.6, 0.5 + lv * 2.62, hz], s: [2.44, 2.6, 6.05], mat: CT[(h + c + lv) % 5], bevel: 0.03, cast: false }); } halos.add([0, 26, zAt(0.05)], 0xffffff, 1.4, 1.2, 0, { mist: 1.5 }); halos.add([-sp.HB, 8, zAt(0.8)], 0xff2010, 0.8, 1.2, 0, { mist: 1.2 }); halos.add([sp.HB, 8, zAt(0.8)], 0x20ff50, 0.8, 1.2, 0, { mist: 1.2 }); for (let i = 0; i < 14; i++) halos.add([(rng() - 0.5) * 6, 20, zAt(0.12 + i * 0.05)], 0xdff4ff, 0.6, 0.8, 0, { mist: 1.3 }); });
  pass.group.userData.pass = true; B.group.add(pass.group);
  // ------------------------------------------------------------------ channel buoys (instanced cans/cones, blinking lights, bobbing) along both sides of every leg
  const buoys = []; const canGeo = new THREE.CylinderGeometry(0.7, 0.85, 1.6, 10); canGeo.translate(0, 0.5, 0); const coneGeo = new THREE.ConeGeometry(0.95, 2.2, 10); coneGeo.translate(0, 0.9, 0);
  const topGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.5, 6); topGeo.translate(0, 2.0, 0);
  const redM = std({ color: 0x8a1a14, roughness: 0.55, metalness: 0.3 }), grnM = std({ color: 0x136a2c, roughness: 0.55, metalness: 0.3 });
  const buoyList = []; const o2 = [0, 0, 0]; for (let l = 0; l < 4; l++) { const lg = leg(l); for (let s = 50; s < lg.L - 40; s += 46) { const p0 = [0, 0, 0], p1 = [0, 0, 0]; lg.ref(s, p0); lg.ref(s + 2, p1); const dx = p1[0] - p0[0], dz = p1[1] - p0[1], dl = Math.hypot(dx, dz) || 1; const nx = -dz / dl, nz = dx / dl; /* left normal (screen-left of travel) */ buoyList.push({ x: p0[0] + nx * 26, z: p0[1] + nz * 26, red: true, ph: rng() * 6 }); buoyList.push({ x: p0[0] - nx * 22, z: p0[1] - nz * 22, red: false, ph: rng() * 6 }); } }
  const reds = buoyList.filter((b) => b.red), grns = buoyList.filter((b) => !b.red);
  const imR = new THREE.InstancedMesh(canGeo, redM, reds.length), imG = new THREE.InstancedMesh(coneGeo, grnM, grns.length), imTR = new THREE.InstancedMesh(topGeo, M.trim, reds.length), imTG = new THREE.InstancedMesh(topGeo, M.trim, grns.length); for (const im of [imR, imG, imTR, imTG]) { im.frustumCulled = false; im.castShadow = false; B.group.add(im); }
  reds.forEach((b, i) => { b.gi = glows.add([b.x, 3, b.z], 0xff2818, 0.5, 1.3, 0, { mist: 1.6, blink: [4.0, 0.22, b.ph] }); b.im = imR; b.imT = imTR; b.i = i; }); grns.forEach((b, i) => { b.gi = glows.add([b.x, 3, b.z], 0x18ff50, 0.5, 1.3, 0, { mist: 1.6, blink: [3.0, 0.2, b.ph] }); b.im = imG; b.imT = imTG; b.i = i; });
  const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), be = new THREE.Euler(), bp = new THREE.Vector3(), bs = new THREE.Vector3(1, 1, 1);
  // ------------------------------------------------------------------ suspension bridge across the NW opening (two towers, deck with lights + moving traffic, cables, suspenders)
  const BR = { a: [-215, -338], b: [88, -448], deckY: 30 }; const bdx = BR.b[0] - BR.a[0], bdz = BR.b[1] - BR.a[1], blen = Math.hypot(bdx, bdz), bux = bdx / blen, buz = bdz / blen, byaw = Math.atan2(-bdz, bdx);
  { const at = (t, y, off = 0) => [BR.a[0] + bdx * t - buz * off, y, BR.a[1] + bdz * t + bux * off]; const deckSeg = (t0, t1) => { const a = at(t0, BR.deckY), b = at(t1, BR.deckY); B.beam(a, b, 13, 1.6, { mat: M.steel, bevel: 0, cast: false }); for (const sd of [-1, 1]) B.beam(at(t0, BR.deckY + 1.1, sd * 6.4), at(t1, BR.deckY + 1.1, sd * 6.4), 0.2, 1.0, { mat: M.trim, bevel: 0, cast: false }); }; deckSeg(0, 1);
    for (const sd of [-1, 1]) { const NB = 44; for (let i = 0; i < NB; i++) { const t0 = i / NB, t1 = (i + 1) / NB, up = i % 2 === 0; B.beam(at(t0, up ? BR.deckY - 1.0 : BR.deckY + 1.0, sd * 6.5), at(t1, up ? BR.deckY + 1.0 : BR.deckY - 1.0, sd * 6.5), 0.28, 0.28, { mat: M.trim, bevel: 0, cast: false }); if (i % 2 === 0) B.beam(at(t0, BR.deckY + 1.0, sd * 6.5), at(t0, BR.deckY + 4.0, sd * 6.6), 0.16, 0.16, { mat: M.trim, bevel: 0, cast: false }); } B.beam(at(0, BR.deckY - 1.0, sd * 6.5), at(1, BR.deckY - 1.0, sd * 6.5), 0.4, 0.4, { mat: M.trim, bevel: 0, cast: false }); }
    const T = [0.3, 0.72]; const tops = []; for (const t of T) { for (const sd of [-1, 1]) latticeBoom(B, at(t, -2, sd * 8), at(t, 92, sd * 8), 3.2, M.craneR, { bay: 7, chord: 0.24, diag: 0.16 }); for (let k = 0; k < 3; k++) { const ya = [-2, 40, 70][k], yb = [40, 70, 92][k]; B.beam(at(t, ya, -8), at(t, yb, 8), 0.45, 0.45, { mat: M.craneR, bevel: 0, cast: false }); B.beam(at(t, ya, 8), at(t, yb, -8), 0.45, 0.45, { mat: M.craneR, bevel: 0, cast: false }); } for (const y of [40, 70, 92]) B.beam(at(t, y, -8), at(t, y, 8), 3.2, 2.6, { mat: M.craneR, bevel: 0, cast: false }); tops.push(at(t, 92, 0)); glows.add([...at(t, 95, -8)], 0xff2010, 1.4, 1.5, 0, { mist: 1.6, blink: [1.7, 0.3, t] }); glows.add([...at(t, 95, 8)], 0xff2010, 1.4, 1.5, 0, { mist: 1.6, blink: [1.7, 0.3, t + 0.85] }); }
    // main cables (catenary between tower tops, plus back-stays to the ends) + suspenders every 9 m + deck lights every 14 m
    for (const sd of [-1, 1]) { const cab = []; const add = (t0, t1, yTop0, yTop1, sag) => { const n = 24; const pts = []; for (let i = 0; i <= n; i++) { const u = i / n, t = t0 + (t1 - t0) * u; const y = yTop0 + (yTop1 - yTop0) * u - 4 * sag * u * (1 - u); pts.push(at(t, y, sd * 8)); } B.tube({ pts, r: 0.55, mat: M.trim, seg: 6, segs: 40, cast: false }); const m = 16; for (let i = 1; i < m; i++) { const u = i / m, t = t0 + (t1 - t0) * u; const yc = yTop0 + (yTop1 - yTop0) * u - 4 * sag * u * (1 - u); B.beam(at(t, yc, sd * 8), at(t, BR.deckY + 1, sd * 6.4), 0.12, 0.12, { mat: M.trim, bevel: 0, cast: false }); } }; add(T[0], T[1], 90, 90, 60); add(0.0, T[0], BR.deckY + 8, 90, 4); add(T[1], 1.0, 90, BR.deckY + 8, 4); }
    for (let i = 0; i <= 26; i++) { const t = i / 26; for (const sd of [-1, 1]) glows.add([...at(t, BR.deckY + 4, sd * 6.6)], 0xffb060, 0.7, 0.9, 0, { mist: 1.2 }); }
    // bridge anchor rocks
    for (const [x, z, r] of [[BR.a[0] - 14, BR.a[1] + 6, 32], [BR.b[0] + 10, BR.b[1] - 8, 36]]) B.rock({ p: [x, r * 0.15, z], r, squash: [1.3, 0.85, 1.2], amp: 0.5, seed: Math.floor(Math.abs(x)) % 17, detail: 3, mat: M.land, col: false, cast: false }); }
  // moving traffic on the bridge (headlights white one way, taillights red the other)
  const cars = []; for (let i = 0; i < 22; i++) cars.push({ t: rng(), v: (0.012 + rng() * 0.01) * (i % 2 ? 1 : -1), lane: (i % 2 ? 1 : -1) * (2.2 + rng() * 1.6), gi: glows.add([0, BR.deckY + 2.3, 0], i % 2 ? 0xffe8c0 : 0xff2010, 0.4, 1.0, 0, { mist: 1.2 }) });
  // waterfront boulevards on the west and east shores: street lamps + moving headlights / taillights; a helicopter with strobes circling the skyline
  const roads = [{ x0: -505, z0: -6, x1: -110, z1: -6 }, { x0: 246, z0: -2, x1: 505, z1: -2 }]; const traffic = [];
  for (const r of roads) { const L = Math.hypot(r.x1 - r.x0, r.z1 - r.z0); for (let s = 0; s <= L; s += 24) glows.add([r.x0 + (r.x1 - r.x0) * s / L, 8.5, r.z0 + (r.z1 - r.z0) * s / L], 0xffb868, 0.6, 0.85, 0, { mist: 1.0 }); for (let i = 0; i < 14; i++) traffic.push({ r, L, t: rng(), v: (5 + rng() * 6) * (i % 2 ? 1 : -1), off: (i % 2 ? 1 : -1) * 2.0, gi: glows.add([0, 2.6, 0], i % 2 ? 0xffe8c0 : 0xff2010, 0.32, 0.9, 0, { mist: 0.9 }) }); }
  const heli = { g1: glows.add([0, 95, 0], 0xff3020, 0.9, 1.4, 0, { mist: 1.5, blink: [1.1, 0.12, 0] }), g2: glows.add([0, 95, 0], 0xffffff, 0.7, 1.1, 0, { mist: 1.2, blink: [2.2, 0.08, 0.4] }) };
  // ------------------------------------------------------------------ lighthouse beams (2 cones, opposite), visible for kilometres in the fog; plus gulls over the bay
  const lhBase = [STOPS[3].origin[0] + 22, 9.4 + 2.3 + 31 * 0.97 + 1.9, STOPS[3].origin[2] - 14]; LH.world = lhBase.slice();
  const beams = [0, 1].map(() => { const m = makeSoftBeam({ length: 560, w0: 0.4, w1: 15, color: 0xfff0c8, intensity: 0.45, dust: 0.8, fall: 0.0012 }); m.position.set(lhBase[0], lhBase[1], lhBase[2]); B.group.add(m); return m; });
  const gulls = makeGulls(B, 12, { cx: 60, cz: -140, rx: 260, rz: 260, perched: 0, rng });
  // ------------------------------------------------------------------ per-frame hook
  const passLane = { x0: -520, x1: -260, z: -110, speed: 4.2 }; let passX = passLane.x0 + 90;
  anim.hooks.push((dt, t, cam) => {
    // buoys bob + tilt on the swell
    for (const b of buoyList) { const y = sea.height(b.x, b.z, t), yx = sea.height(b.x + 1.2, b.z, t), yz = sea.height(b.x, b.z + 1.2, t); be.set(Math.atan2(yz - y, 1.2) * 0.7, b.ph, -Math.atan2(yx - y, 1.2) * 0.7); bq.setFromEuler(be); bp.set(b.x, y, b.z); bm.compose(bp, bq, bs); b.im.setMatrixAt(b.i, bm); b.imT.setMatrixAt(b.i, bm); glows.setPos(b.gi, b.x, y + 3.0, b.z); }
    for (const im of [imR, imG, imTR, imTG]) im.instanceMatrix.needsUpdate = true;
    for (const s of ships) s.update(t, 0, 0, s.sway);
    // passing ship
    passX += passLane.speed * dt; if (passX > passLane.x1) passX = passLane.x0; pass.setBase(passX, passLane.z, P / 2); pass.update(t, 0, 0, 0.5);
    // lighthouse beams
    const a = LH.angle(t); const dl = Math.hypot(cam.x - lhBase[0], cam.z - lhBase[2]); const nearK = Math.min(40, Math.max(3, dl * 0.1)), inten = 0.45; for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; beams[i].lookAt(lhBase[0] + Math.cos(a) * s * 100, lhBase[1] - 4, lhBase[2] + Math.sin(a) * s * 100); beams[i].material.uniforms.uNear.value = nearK; beams[i].material.uniforms.uIntensity.value = inten; }
    // bridge traffic
    for (const c of cars) { c.t += c.v * dt; if (c.t > 1) c.t -= 1; if (c.t < 0) c.t += 1; const x = BR.a[0] + bdx * c.t - buz * c.lane, z = BR.a[1] + bdz * c.t + bux * c.lane; glows.setPos(c.gi, x, BR.deckY + 2.3, z); }
    for (const c of traffic) { c.t += c.v / c.L * dt; if (c.t > 1) c.t -= 1; if (c.t < 0) c.t += 1; const r = c.r; glows.setPos(c.gi, r.x0 + (r.x1 - r.x0) * c.t, 2.7, r.z0 + (r.z1 - r.z0) * c.t + c.off); }
    { const ha = t * 0.05, hx = -120 + Math.cos(ha) * 330, hz = 60 + Math.sin(ha) * 150, hy = 95 + Math.sin(t * 0.3) * 4; glows.setPos(heli.g1, hx, hy, hz); glows.setPos(heli.g2, hx + 2.5, hy - 1, hz + 1); }
    gulls.update(t);
  });
  return { sea, ships, pass, buoys: buoyList };
}
