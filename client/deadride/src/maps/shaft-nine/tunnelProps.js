// Set dressing for the Timbered Tunnels: bell gantry + signal board (landmark), mezzanine stage with stairs and ore chute, pit-pony stalls,
// miners' lamp room, dynamite magazine, ventilation fan and brattice curtain, boarded bulkheads (barricade openings), pipes, cables, spoil.
import * as THREE from 'three';
import { Parts, hewn, bolt } from './parts.js';
import { std } from '../../core/mats.js';
import { signMaterial, canvasTexture } from '../../core/canvas2d.js';
import { makeRng, TAU } from '../../core/util.js';
import { PI, at, cylBetween, pipeRun, barrel, sack, crateBox, handrail, steelLadder, signQuad, lightPool, lin, bulbLamp, stairCheeks } from './kit.js';

export function addTunnelProps(T) {
  const { B, E, m, ctx, halos } = T; const R = makeRng(77); const upd = []; const out = { update: null, ringBell: null };
  const { post, board, planks, steel, steelRaw, iron, brass, coal, ore, sackM, hay, cord, olive, canvas, locker, lampGlowG, lampGlowY } = m;
  const sign = (p, w, h, yaw, lines, o = {}) => signQuad(B, signMaterial({ lines, bg: o.bg || '#1d1d1b', fg: o.fg || '#e9dcae', w: 512, h: Math.round(512 * h / w), weather: o.weather ?? 0.9, border: o.border ?? true, fontSize: o.fs }), p, w, h, yaw);
  const col = (x, y, z, hx, hy, hz, yaw = 0, surface = 'wood', walk = false) => B.colliders.addBox({ x, y, z, hx, hy, hz, yaw, surface, walk });

  // ================================================================== bell gantry + signal board over the landing deck (landmark)
  const GZ = 4.2;
  { const PG = new Parts(B, makeRng(31)), MM = { post, board, iron: steelRaw };     // real hewn timbers: posts on sill blocks, bowed top beam, raking braces, tie bolts with washers
    for (const s of [-1, 1]) { hewn(PG, post, [s * 3.2, 0.06, GZ], [s * 3.2 + s * 0.02, 4.1, GZ], 0.4, 0.4, { bow: 0.03, chamfer: 0.035, taper: 0.06 }); hewn(PG, post, [s * 3.2, 0.03, GZ - 0.4], [s * 3.2, 0.03, GZ + 0.4], 0.7, 0.12, { bow: 0.004, chamfer: 0.02, taper: 0, up: [0, 1, 0] }); col(s * 3.2, 2.1, GZ, 0.22, 2.1, 0.22);
      for (const dz of [-0.2, 0.2]) hewn(PG, post, [s * 3.2, 3.15, GZ + dz], [s * 2.3, 4.05, GZ + dz], 0.14, 0.17, { bow: 0.006, chamfer: 0.012 });
      for (const y of [3.6, 3.9]) bolt(PG, steelRaw, [s * 3.2 - s * 0.204, y, GZ], [-s, 0, 0], 1.2); }
    hewn(PG, post, [-3.75, 4.06, GZ], [3.75, 4.06, GZ], 0.46, 0.44, { bow: 0.035, chamfer: 0.04, up: [0, 1, 0], taper: 0.02 }); for (let k = -3; k <= 3; k += 1.5) bolt(PG, steelRaw, [k, 4.29, GZ + 0.05], [0, 1, 0], 1.3); PG.flush(); }
  // signal board hung from the beam (facing +z), lamps above it, bell to the left of centre
  const brd = new THREE.MeshStandardMaterial(); const btex = canvasTexture(1024, 512, (g, w, h) => {
    g.fillStyle = '#e5dcc2'; g.fillRect(0, 0, w, h); g.strokeStyle = '#151513'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = '#151513'; g.textAlign = 'center'; g.font = '900 64px Impact, "Arial Black", sans-serif'; g.fillText('SHAFT No.9  ·  90 m LEVEL', w / 2, 84);
    g.font = '700 40px "Courier New", monospace'; g.textAlign = 'left'; const L = ['1  STOP', '2  HOIST MEN', '3  LOWER MEN', '4  HOIST COAL', '5  LOWER COAL', '9  DANGER — ALL STOP']; L.forEach((t, i) => g.fillText(t, 60 + (i % 2) * 470, 180 + Math.floor(i / 2) * 78));
    g.font = '700 30px "Courier New", monospace'; g.fillText('BELL CODES — ONSETTER ONLY', 60, 462); for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(30,22,12,${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 4 + 1, Math.random() * 40 + 4); }
  }); const bm = std({ map: btex, roughness: 0.7, metalness: 0.0, key: 'sigBoard' });
  B.box({ p: [0, 2.35, GZ + 0.05], s: [2.5, 1.32, 0.06], mat: post, bevel: 0.015, cast: true }); signQuad(B, bm, [0, 2.35 + 0.66, GZ + 0.09], 2.36, 1.18, 0, { cast: false }); B.box({ p: [0, 3.65, GZ + 0.05], s: [0.05, 0.4, 0.05], mat: steel, cast: false });
  for (const [x, mm] of [[-0.6, lampGlowY], [-0.2, lampGlowG], [0.2, lampGlowY], [0.6, lampGlowG]]) { B.cyl({ p: [x, 3.98, GZ + 0.22], r: 0.07, h: 0.06, seg: 12, mat: steelRaw, pitch: PI / 2, anchor: 'center', cast: false }); B.sphere({ p: [x, 3.98, GZ + 0.27], r: 0.05, seg: 8, mat: mm, cast: false }); halos.add([x, 3.98, GZ + 0.3], mm === lampGlowG ? 0x40ff70 : 0xffb040, 0.35, 0.6, 0); }
  // the bell (dynamic mesh: swings when the cage arrives / departs)
  const bellPivot = new THREE.Group(); bellPivot.position.set(-2.1, 3.8, GZ + 0.05); B.group.add(bellPivot);
  const bellMat = new THREE.MeshStandardMaterial({ color: 0xa8873a, metalness: 1, roughness: 0.32, side: THREE.DoubleSide });
  const bg = new THREE.LatheGeometry([[0.18, 0.0], [0.12, 0.06], [0.085, 0.14], [0.06, 0.21], [0.03, 0.27], [0.0, 0.285], [0.0, 0.31], [0.04, 0.30], [0.075, 0.25], [0.10, 0.18], [0.13, 0.09], [0.19, 0.02], [0.205, 0.0]].map(([r, y]) => new THREE.Vector2(r * 1.5, y * 1.5)), 28); const bell = new THREE.Mesh(bg, bellMat); bell.position.y = -0.62; bell.castShadow = true; bellPivot.add(bell);
  const clap = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), bellMat); clap.position.y = -0.62; bellPivot.add(clap); const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), steelRaw); yoke.position.y = -0.03; bellPivot.add(yoke);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 5), cord); rope.position.set(0.12, -1.4, 0.05); bellPivot.add(rope);
  let bellT = 99; out.ringBell = (amp = 1) => { bellT = 0; bellAmp = amp; }; let bellAmp = 1;
  upd.push((dt, t, active) => { bellT += dt; const a = bellT < 9 ? Math.exp(-bellT * 0.5) * Math.sin(bellT * 9.0) * 0.5 * bellAmp : 0; bellPivot.rotation.z = a; clap.position.x = Math.sin(bellT * 11.5) * 0.06 * (bellT < 9 ? Math.exp(-bellT * 0.4) : 0); });
  // deck furniture: onsetter's table + ledger + lamp, lockers, sand buckets, notice board, fire axe
  B.box({ p: [-5.6, 0.06, 2.6], s: [1.5, 0.78, 0.8], mat: planks, bevel: 0.015, col: 'wood' }); B.box({ p: [-5.6, 0.84, 2.6], s: [1.6, 0.06, 0.9], mat: board, bevel: 0.01, cast: true }); B.box({ p: [-5.7, 0.9, 2.55], s: [0.4, 0.03, 0.3], mat: m.paper, bevel: 0.004, cast: false });
  B.cyl({ p: [-5.2, 0.9, 2.6], r: 0.07, h: 0.2, seg: 10, mat: brass, cast: false }); B.sphere({ p: [-5.2, 1.12, 2.6], r: 0.06, seg: 8, mat: lampGlowY, cast: false }); halos.add([-5.2, 1.12, 2.6], 0xffb050, 0.5, 0.8, 4);
  for (let i = 0; i < 4; i++) { B.box({ p: [10.6 + i * 0.62, 0, 9.55], s: [0.58, 1.85, 0.5], mat: locker, bevel: 0.01, col: 'metal' }); B.box({ p: [10.6 + i * 0.62, 1.0, 9.29], s: [0.16, 0.06, 0.02], mat: steelRaw, cast: false }); }
  for (let i = 0; i < 3; i++) { B.cyl({ p: [-6.7, 1.15, 5.3 + i * 0.45], r: 0.13, h: 0.28, seg: 12, mat: m.bucket, cast: false }); } B.box({ p: [-7.28, 1.1, 11.6], s: [0.04, 0.8, 1.4], mat: board, cast: false }); sign([-7.24, 1.55, 11.6], 1.1, 0.5, PI / 2, ['NO NAKED LIGHTS', 'BEYOND THIS POINT'], { bg: '#8c1a14', fg: '#f4efe0' });
  sign([-7.24, 1.75, 9.9], 1.1, 0.55, PI / 2, ['HARD HATS', 'MUST BE WORN'], { bg: '#c9a227', fg: '#181818' });

  // ================================================================== mezzanine stage (NE of hall) with stairs, ore chute, rail
  const SX0 = 2.6, SX1 = 7.2, SZ0 = 10.9, SZ1 = 15.9, SY = 2.4, STX = 3.2;
  B.box({ p: [(SX0 + SX1) / 2, SY - 0.12, (SZ0 + SZ1) / 2], s: [SX1 - SX0, 0.12, SZ1 - SZ0], mat: planks, bevel: 0.01, col: 'wood', tag: 'deck' });
  for (const [x, z] of [[SX0 + 0.2, SZ0 + 0.2], [SX1 - 0.2, SZ0 + 0.2], [SX0 + 0.2, SZ1 - 0.2], [SX1 - 0.2, SZ1 - 0.2], [SX0 + 0.2, (SZ0 + SZ1) / 2], [SX1 - 0.2, (SZ0 + SZ1) / 2]]) { B.beam([x, 0, z], [x, SY - 0.12, z], 0.3, 0.3, { mat: post, bevel: 0.02 }); col(x, 1.1, z, 0.16, 1.1, 0.16); }
  for (const x of [SX0 + 0.2, SX1 - 0.2]) B.box({ p: [x, SY - 0.34, (SZ0 + SZ1) / 2], s: [0.3, 0.22, SZ1 - SZ0], mat: post, bevel: 0.02 }); for (let z = SZ0 + 0.6; z < SZ1; z += 1.4) B.box({ p: [(SX0 + SX1) / 2, SY - 0.3, z], s: [SX1 - SX0, 0.16, 0.26], mat: post, bevel: 0.02, cast: false });
  B.stairs({ p: [STX, 0, 7.0], n: 14, rise: 0.1714, run: 0.28, w: 1.2, yaw: -PI / 2, mat: planks, col: 'wood' }); stairCheeks(B, post, { p: [STX, 0, 7.0], yaw: -PI / 2, n: 14, rise: 0.1714, run: 0.28, w: 1.2 });
  // boarded skirt under the stage (the flow field is 2D: without it, cells under the deck would connect to the ground around it)
  for (const [x, z, sx, sz] of [[(SX0 + SX1) / 2, SZ1 - 0.06, SX1 - SX0, 0.1], [SX0 + 0.06, (SZ0 + SZ1) / 2, 0.1, SZ1 - SZ0], [SX1 - 0.06, (SZ0 + SZ1) / 2, 0.1, SZ1 - SZ0], [(STX + 0.75 + SX1) / 2, SZ0 + 0.06, SX1 - STX - 0.75, 0.1], [(SX0 + STX - 0.75) / 2 + 0.0, SZ0 + 0.06, Math.max(0.05, STX - 0.75 - SX0), 0.1]]) B.box({ p: [x, 0, z], s: [sx, SY - 0.13, sz], mat: board, bevel: 0.008, col: 'wood', cast: true });
  for (const s of [-1, 1]) { cylBetween(B, [STX + s * 0.62, 0.95, 7.0], [STX + s * 0.62, SY + 0.95, SZ0], 0.025, steelRaw, { seg: 6, cast: false }); for (let i = 0; i <= 14; i += 3) B.cyl({ p: [STX + s * 0.62, i * 0.1714, 7.0 + i * 0.28], r: 0.02, h: 0.95, seg: 5, mat: steelRaw, cast: false }); }
  handrail(B, steelRaw, [SX0, SY, SZ0], [SX0, SY, SZ1], { posts: 1.8 }); handrail(B, steelRaw, [SX0, SY, SZ1], [SX1, SY, SZ1], { posts: 1.8 }); handrail(B, steelRaw, [SX1, SY, SZ0], [SX1, SY, SZ1], { posts: 1.8 }); handrail(B, steelRaw, [STX + 0.65, SY, SZ0], [SX1, SY, SZ0], { posts: 1.8 });
  for (const [x, z, hx, hz] of [[SX0, (SZ0 + SZ1) / 2, 0.04, (SZ1 - SZ0) / 2], [(SX0 + SX1) / 2, SZ1, (SX1 - SX0) / 2, 0.04], [SX1, (SZ0 + SZ1) / 2, 0.04, (SZ1 - SZ0) / 2], [(STX + 0.65 + SX1) / 2, SZ0, (SX1 - STX - 0.65) / 2, 0.04]]) B.colliders.addBox({ x, y: SY + 0.5, z, hx, hy: 0.5, hz, surface: 'metal', walk: false });
  // ore chute: timber trough from the ceiling opening to a bin on the stage
  const c0 = [5.4, 5.05, 14.6], c1 = [5.4, SY + 1.0, 13.1]; for (const dx of [-0.42, 0.42]) cylBetween(B, [c0[0] + dx, c0[1], c0[2]], [c1[0] + dx, c1[1], c1[2]], 0.05, post, { seg: 6 }); B.beam([c0[0], c0[1] - 0.07, c0[2]], [c1[0], c1[1] - 0.07, c1[2]], 0.9, 0.06, { mat: planks, bevel: 0.01 });
  B.box({ p: [5.4, SY, 12.4], s: [1.3, 0.9, 1.0], mat: planks, bevel: 0.02, col: 'wood' }); for (let i = 0; i < 9; i++) B.rock({ p: [5.4 + (R() - 0.5) * 0.8, SY + 0.86 + R() * 0.12, 12.4 + (R() - 0.5) * 0.6], r: 0.13 + R() * 0.08, squash: [1.2, 0.6, 1], amp: 0.5, seed: 30 + i, detail: 1, mat: coal });
  bulbLamp(E, [4.2, SY + 1.55, 13.9], { cageMat: steelRaw, cordMat: cord, I: 2.2, R: 8, size: 0.8, pool: 2.6, floorY: SY - 0.05, hang: 0.5 });
  crateBox(B, planks, [3.8, SY, 15.0], [0.8, 0.6, 0.7], { yaw: 0.2, batten: post }); crateBox(B, olive, [6.5, SY, 14.9], [0.9, 0.5, 0.6], { yaw: -0.1, batten: post }); barrel(B, m.drum, [6.7, SY, 11.6]);

  // ================================================================== cover in the hall: crates, timber stacks, spare props, tubs, sacks
  for (let i = 0; i < 4; i++) for (let j = 0; j < 5 - i; j++) B.box({ p: [-3.0 + (j - (4 - i) / 2) * 0.3, i * 0.24, 6.9], s: [0.27, 0.24, 2.6], mat: board, yaw: 0.05, bevel: 0.01, col: i === 0 ? 'wood' : false, cast: true });
  B.colliders.addBox({ x: -3.0, y: 0.48, z: 6.9, hx: 0.85, hy: 0.5, hz: 1.3, yaw: 0.05, surface: 'wood', walk: true });
  crateBox(B, planks, [-2.0, 0, 13.2], [1.0, 0.9, 0.9], { yaw: 0.3, batten: post }); crateBox(B, planks, [-1.1, 0, 13.0], [0.8, 0.7, 0.8], { yaw: -0.2, batten: post }); crateBox(B, olive, [-1.55, 0.9, 13.15], [0.7, 0.5, 0.6], { yaw: 0.6, batten: post });
  for (let i = 0; i < 5; i++) { sack(B, sackM, [-6.4 + (i % 3) * 0.5, i > 2 ? 0.26 : 0, 11.4 + (i > 2 ? 0.2 : 0)], { yaw: R() * 3, seed: i }); } B.colliders.addBox({ x: -6.0, y: 0.3, z: 11.5, hx: 0.8, hy: 0.3, hz: 0.35, surface: 'fabric', walk: true });
  barrel(B, m.drum, [-6.9, 0, 12.3]); barrel(B, m.drum, [-6.9, 0, 12.95]); barrel(B, m.drum, [-6.3, 0.0, 12.7], { tilt: PI / 2 - 0.05, yaw: 0.4 });
  for (let i = 0; i < 6; i++) { const a = -2.2 + i * 0.28; cylBetween(B, [6.6 + i * 0.09, 0, 15.2], [6.2 + i * 0.09, 2.1 + R() * 0.3, 15.5], 0.09, post, { seg: 8 }); }

  // ================================================================== pipes + cables along the main drift and hall
  const pm = m.pipe; pipeRun(B, [[-1.67, 2.35, 16.4], [-1.67, 2.35, 50]], 0.055, pm, { flange: 4.8, seg: 10 }); for (let z = 17.5; z < 50; z += 4.8) B.box({ p: [-1.72, 2.2, z], s: [0.14, 0.05, 0.08], mat: steel, cast: false });
  pipeRun(B, [[-1.67, 2.6, 16.4], [-1.67, 2.6, 33], [-1.4, 2.85, 34], [-1.4, 2.85, 50]], 0.028, m.pipeB, { flange: 6, seg: 8 });
  for (let z = 16.5; z < 50; z += 1.6) B.cable([1.55, 2.55, z], [1.55, 2.55, z + 1.6], 0.09, 0.011, cord, { n: 5, cast: false });
  pipeRun(B, [[-6.9, 3.9, 2.2], [-6.9, 3.9, 14.8], [-4.9, 4.3, 15.1], [-1.67, 2.35, 16.4]], 0.055, pm, { flange: 4.4, seg: 10 });

  // ================================================================== ventilation door (leaves swung open) + brattice curtain + fan in the east refuge niche
  const VZ = 30.5; for (const s of [-1, 1]) { B.box({ p: [s * 1.62, 0, VZ], s: [0.3, 2.75, 0.34], mat: post, bevel: 0.02, col: 'wood' }); }
  B.box({ p: [0, 2.72, VZ], s: [3.6, 0.36, 0.36], mat: post, bevel: 0.02 });
  for (const s of [-1, 1]) { const th = 1.15, yaw = Math.atan2(-Math.sin(th), -s * Math.cos(th)); const hx = s * 1.47; B.box({ p: [hx + 0.72 * Math.cos(yaw), 0.02, VZ - 0.72 * Math.sin(yaw)], s: [1.44, 2.55, 0.09], mat: planks, yaw, bevel: 0.01, col: false });
    for (const y of [0.4, 1.3, 2.1]) B.box({ p: [hx + 0.72 * Math.cos(yaw), y, VZ - 0.72 * Math.sin(yaw) + 0.0], s: [1.46, 0.1, 0.12], mat: iron, yaw, bevel: 0.01, cast: false }); }
  sign([-1.42, 1.9, VZ + 0.19], 0.9, 0.45, 0, ['KEEP DOOR', 'CLOSED']);
  B.box({ p: [0, 0.0, 38.2], s: [0.1, 0.1, 0.1], mat: post, cast: false });
  for (const s of [-1, 1]) B.box({ p: [s * 0.62, 0.05, 37.6], s: [1.2, 2.55, 0.02], mat: canvas, roll: 0.0, pitch: 0, yaw: s * 0.32, bevel: 0.0, cast: true, col: false });
  B.box({ p: [0, 2.62, 37.6], s: [3.3, 0.06, 0.06], mat: steelRaw, cast: false });
  const fanDuct = [2.65, 1.0, 29.0]; B.cyl({ p: [2.9, 1.0, 29.0], r: 0.55, h: 1.0, seg: 20, mat: steel, roll: PI / 2, anchor: 'center', open: true, cast: true }); const fan = new THREE.Group(); fan.position.set(2.9, 1.0, 29.0); B.group.add(fan);
  for (let i = 0; i < 6; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.16), steelRaw); bl.position.set(0, 0.26, 0); bl.rotation.x = 0.0; const g = new THREE.Group(); g.rotation.x = i * PI / 3; g.add(bl); bl.rotation.z = 0.5; fan.add(g); } fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 10).rotateZ(PI / 2), steel));
  upd.push((dt) => { fan.rotation.x += dt * 9; });

  // ================================================================== west gallery: pit-pony stalls (z 4.1..6.5), gates, hay, troughs, name plates
  const names = ['BESS', 'DUKE', 'MOLLY', 'JACK'];
  [-12.6, -15.2, -17.8, -20.4].forEach((x, i) => {
    B.box({ p: [x, 0.0, 6.42], s: [1.5, 0.98, 0.08], mat: planks, bevel: 0.01, col: 'wood' }); B.box({ p: [x, 1.1, 6.42], s: [1.5, 0.07, 0.09], mat: post, bevel: 0.01, cast: false });
    for (const s of [-1, 1]) B.beam([x + s * 0.78, 0, 6.42], [x + s * 0.78, 2.05, 6.42], 0.14, 0.14, { mat: post });
    B.box({ p: [x, 0.0, 4.2], s: [1.0, 0.5, 0.42], mat: board, bevel: 0.01, col: 'wood' }); B.box({ p: [x, 0.5, 4.2], s: [0.86, 0.04, 0.34], mat: m.water, bevel: 0.0, cast: false });
    B.rock({ p: [x + 0.2, 0.08, 5.3], r: 0.6, squash: [1.2, 0.28, 1.0], amp: 0.5, seed: 40 + i, detail: 2, mat: hay, cast: false }); B.rock({ p: [x - 0.3, 0.06, 5.6], r: 0.4, squash: [1.2, 0.3, 0.9], amp: 0.5, seed: 50 + i, detail: 2, mat: hay, cast: false });
    signQuad(B, signMaterial({ lines: [names[i]], bg: '#3a2a1a', fg: '#e8d8b0', w: 256, h: 96, weather: 0.9 }), [x, 1.55, 6.375], 0.5, 0.2, PI); B.cyl({ p: [x + 0.55, 1.5, 4.05], r: 0.02, h: 0.3, seg: 5, mat: steelRaw, cast: false });
  });
  barrel(B, m.drum, [-9.4, 0, 6.7]); barrel(B, m.drum, [-9.4, 0, 7.3]); crateBox(B, planks, [-10.4, 0, 6.8], [0.8, 0.8, 0.7], { yaw: 0.2, batten: post }); for (let i = 0; i < 4; i++) sack(B, sackM, [-10.2 + i * 0.35, 0, 9.0], { yaw: R() * 3, seed: i + 9 });
  B.colliders.addBox({ x: -9.9, y: 0.2, z: 9.0, hx: 0.9, hy: 0.2, hz: 0.3, surface: 'fabric', walk: true });

  // ================================================================== lamp room (x -32..-25.8, z 3.8..12.2): shelves of lamps, tag board, desk, sign
  const LX0 = -32.0, LX1 = -25.9;
  for (const z of [4.05, 11.95]) { const s = z < 8 ? 1 : -1;
    for (let sh = 0; sh < 5; sh++) B.box({ p: [(LX0 + LX1) / 2 + 0.4, 0.5 + sh * 0.42, z], s: [4.6, 0.05, 0.5], mat: board, bevel: 0.006, cast: false });
    for (let k = 0; k <= 5; k++) B.box({ p: [LX0 + 1.2 + k * 0.92, 0, z], s: [0.07, 2.4, 0.5], mat: post, bevel: 0.006, cast: false });
    B.colliders.addBox({ x: (LX0 + LX1) / 2 + 0.4, y: 1.2, z: z + s * 0.12, hx: 2.4, hy: 1.2, hz: 0.28, surface: 'wood', walk: false });
    for (let sh = 0; sh < 5; sh++) for (let k = 0; k < 11; k++) { const lx = LX0 + 1.4 + k * 0.42, ly = 0.53 + sh * 0.42; if (R() < 0.1) continue; B.cyl({ p: [lx, ly, z + s * 0.02], r: 0.045, h: 0.14, seg: 8, mat: steelRaw, cast: false }); B.sphere({ p: [lx, ly + 0.15, z + s * 0.02 + 0], r: 0.03, seg: 6, mat: R() < 0.7 ? lampGlowG : lampGlowY, cast: false }); }
  }
  halos.add([-29, 1.2, 4.3], 0x40ff80, 2.2, 0.28, 0); halos.add([-29, 1.2, 11.7], 0xffc060, 2.2, 0.25, 0);
  B.box({ p: [-28.9, 0, 8.2], s: [2.2, 0.8, 0.9], mat: planks, bevel: 0.015, col: 'wood' }); B.box({ p: [-28.9, 0.8, 8.2], s: [2.4, 0.06, 1.0], mat: board, bevel: 0.01 }); for (let i = 0; i < 3; i++) B.box({ p: [-29.6 + i * 0.32, 0.86, 8.1], s: [0.22, 0.03, 0.3], mat: m.paper, bevel: 0.003, cast: false });
  B.box({ p: [-32.05, 0.9, 6.1], s: [0.06, 1.3, 1.6], mat: board, cast: false }); for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) B.cyl({ p: [-32.0 + 0.03, 1.15 + r * 0.24, 5.5 + c * 0.16], r: 0.032, h: 0.012, seg: 8, mat: brass, roll: PI / 2, anchor: 'center', cast: false });
  sign([-29.0, 2.3, 3.95], 1.8, 0.5, 0, ['MINERS\' LAMP ROOM'], { bg: '#20241f', fg: '#e0d0a0' }); B.box({ p: [-26.5, 0, 9.9], s: [0.6, 0.55, 0.6], mat: m.stove, bevel: 0.02, col: 'metal' }); cylBetween(B, [-26.5, 0.55, 9.9], [-26.5, 2.7, 9.9], 0.05, m.stove, { seg: 8 });

  // ================================================================== east gallery: dynamite magazine (iron door, shelving, crates), cave-in timbers
  const MX = 15;
  B.box({ p: [MX - 1.6, 0, 9.5], s: [0.3, 2.6, 0.4], mat: iron, bevel: 0.02, col: 'metal' }); B.box({ p: [MX + 1.6, 0, 9.5], s: [0.3, 2.6, 0.4], mat: iron, bevel: 0.02, col: 'metal' }); B.box({ p: [MX, 2.42, 9.5], s: [3.5, 0.4, 0.4], mat: iron, bevel: 0.02 });
  B.box({ p: [MX - 1.75 + 0.62, 0, 9.05], s: [1.4, 2.4, 0.1], mat: iron, yaw: 1.15, bevel: 0.015, col: false }); sign([MX, 2.1, 9.28], 1.8, 0.5, 0, ['DANGER', 'EXPLOSIVES'], { bg: '#a3140f', fg: '#f6f0e0' });
  for (const z of [12.4, 17.3]) { for (let sh = 0; sh < 4; sh++) B.box({ p: [MX, 0.45 + sh * 0.5, z], s: [4.4, 0.05, 0.55], mat: board, cast: false }); const s = z < 15 ? 1 : -1; for (let sh = 0; sh < 4; sh++) for (let k = 0; k < 4; k++) if (R() > 0.15) B.box({ p: [MX - 1.7 + k * 1.1, 0.5 + sh * 0.5, z + s * 0.02], s: [0.6, 0.32, 0.4], mat: olive, bevel: 0.01, cast: false }); B.colliders.addBox({ x: MX, y: 1.1, z: z + s * 0.1, hx: 2.2, hy: 1.1, hz: 0.3, surface: 'wood', walk: false }); }
  for (let i = 0; i < 6; i++) sack(B, sackM, [MX + 1.5 + (i % 3) * 0.45, i > 2 ? 0.26 : 0, 15.6 + (i > 2 ? 0.2 : 0)], { yaw: R() * 3, seed: i + 20 }); B.box({ p: [MX - 0.8, 0, 14.7], s: [0.7, 0.4, 0.5], mat: m.redbox, bevel: 0.015, col: 'wood' });
  for (let i = 0; i < 5; i++) cylBetween(B, [23.2 + i * 0.35, 0.05 + i * 0.3, 6.4 + i * 0.1], [21.2 + i * 0.45, 2.3, 9.4 - i * 0.5], 0.13, post, { seg: 8 }); tubTip(B, m);

  // ================================================================== boarded bulkheads with real openings (barricade spawns): main drift z=47, lamp room west wall x=-32.3
  const bulkZ = 47.0;
  for (const [x0, x1] of [[-1.9, -0.75], [0.75, 1.9]]) B.box({ p: [(x0 + x1) / 2, 0, bulkZ], s: [x1 - x0, 3.1, 0.16], mat: planks, bevel: 0.01, col: 'wood' }); B.box({ p: [0, 1.9, bulkZ], s: [1.5, 1.2, 0.16], mat: planks, bevel: 0.01, col: false });
  for (const s of [-1, 1]) B.beam([s * 0.86, 0, bulkZ - 0.1], [s * 0.86, 1.95, bulkZ - 0.1], 0.14, 0.14, { mat: post }); B.box({ p: [0, 1.9, bulkZ - 0.1], s: [1.75, 0.14, 0.14], mat: post, bevel: 0.01 });
  for (const [x0, x1] of [[-1.9, -0.75], [0.75, 1.9]]) for (let k = 0; k < 4; k++) B.box({ p: [(x0 + x1) / 2, 0.55 + k * 0.7, bulkZ - 0.11], s: [x1 - x0 + 0.1, 0.09, 0.05], mat: board, roll: (R() - 0.5) * 0.06, cast: false });
  for (let i = 0; i < 3; i++) B.box({ p: [0, 0.3 + i * 0.55, bulkZ + 0.11], s: [1.5, 0.11, 0.04], mat: board, roll: (R() - 0.5) * 0.08, cast: false }); // a few boards already ripped down show as leftovers
  const bx = -32.3;
  for (const [z0, z1] of [[6.5, 7.25], [8.75, 9.5]]) B.box({ p: [bx, 0, (z0 + z1) / 2], s: [0.16, 3.0, z1 - z0], mat: planks, bevel: 0.01, col: 'wood' }); B.box({ p: [bx, 1.9, 8], s: [0.16, 1.1, 1.5], mat: planks, bevel: 0.01, col: false }); B.box({ p: [bx, 0, 5.2], s: [0.16, 3.0, 2.6], mat: planks, bevel: 0.01, col: 'wood' }); B.box({ p: [bx, 0, 10.8], s: [0.16, 3.0, 2.6], mat: planks, bevel: 0.01, col: 'wood' });
  for (const [z0, z1] of [[6.5, 7.25], [8.75, 9.5]]) for (let k = 0; k < 4; k++) B.box({ p: [bx + 0.11, 0.5 + k * 0.7, (z0 + z1) / 2], s: [0.05, 0.09, z1 - z0 + 0.1], mat: board, roll: (R() - 0.5) * 0.06, cast: false });

  // ================================================================== scree along the walls
  for (let i = 0; i < 60; i++) { const side = R() < 0.5 ? -1 : 1, z = 16 + R() * 33; const x = side * (1.35 + R() * 0.35); const rr = 0.08 + R() * 0.22; B.rock({ p: [x, rr * 0.2, z], r: rr, squash: [1.4, 0.6, 1.2], amp: 0.6, seed: 300 + i, detail: 1, mat: R() < 0.5 ? coal : ore, cast: true }); }
  for (let i = 0; i < 40; i++) { const x = (R() - 0.5) * 12, z = 2.6 + R() * 12.4; if (Math.abs(x) < 2 && z < 6) continue; const rr = 0.06 + R() * 0.16; B.rock({ p: [x, rr * 0.2, z], r: rr, squash: [1.4, 0.6, 1.2], amp: 0.6, seed: 400 + i, detail: 1, mat: coal, cast: false }); }
  // ================================================================== spoil, coal, puddles, misc floor detail
  for (const [x, z, r] of [[-1.4, 24, 0.5], [1.2, 40, 0.6], [0.8, 18.5, 0.4], [-1.3, 34, 0.45], [-22, 8.9, 0.5], [21, 6.8, 0.55], [-1.2, 15.7, 0.4]]) for (let i = 0; i < 5; i++) B.rock({ p: [x + (R() - 0.5) * r * 2, 0.05, z + (R() - 0.5) * r * 2], r: 0.08 + R() * 0.16, squash: [1.3, 0.6, 1.1], amp: 0.5, seed: i * 3 + 1, detail: 1, mat: coal, cast: false });
  for (const [x, z, s] of [[0.3, 23, 1.6], [-0.6, 33, 1.3], [1.0, 19, 1.0], [6, 8, 1.7], [-6, 8.5, 1.5], [0, 42, 1.4], [-18, 8.2, 1.2], [18, 7.8, 1.3], [-3, 4.2, 1.1]]) signQuad(B, m.puddle, [x, 0.012, z], s * 1.5, s, R() * PI, { pitch: -PI / 2 });
  return { ...out, update(dt, t, active) { for (const f of upd) f(dt, t, active); } };
}
function tubTip(B, m) { B.box({ p: [22.6, 0.1, 9.9], s: [1.2, 0.68, 0.6], mat: m.steel, yaw: 0.5, roll: PI / 2.2, bevel: 0.02, col: 'metal' }); }
