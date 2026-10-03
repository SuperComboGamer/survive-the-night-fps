// Mid-Mountain Station dressing: cold LED flood masts, radiant heaters and the arrival board under the canopy, the altitude sign, avalanche warning signs,
// snow fences, hazard tape and flags whipping in the storm, pallets/drums, a parked patrol snowmobile and a Pisten-Bully groomer.
// All positions are in the station's frame F (u right, v back) unless a function takes world-local x/z.
import * as THREE from 'three';
import { Frame, quad } from './common.js';
import { lampCone } from './snowkit.js';
import { signMaterial, canvasTexture } from '../../core/canvas2d.js';
import { makeRng } from '../../core/util.js';
import { std } from '../../core/mats.js';
import { clothMaterial, stripedTexture, addFlag, flagPole } from './flags.js';

const P = Math.PI;
export function ledBoard(B, key, lines, { fg = '#7dffb8', bg = '#031008', w = 512, h = 192, k = 1.7 } = {}) {
  const t = canvasTexture(w, h, (c) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.textBaseline = 'middle'; c.font = `700 ${Math.round(h / (lines.length + 0.9))}px "Courier New", monospace`; lines.forEach((l, i) => c.fillText(l, 20, (i + 0.72) * h / (lines.length + 0.5))); for (let y = 0; y < h; y += 3) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, y, w, 1); } for (let x = 0; x < w; x += 4) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x, 0, 1, h); } });
  return B.m(key, std({ color: 0x040806, map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: k, roughness: 0.5 }));
}

export function lightMast(ctx, B, M, halos, x, z, yaw, { h = 8.5, intensity = 26, dist = 26, cone = true, tilt = 0.9, y0 = 0 } = {}) {
  const F = new Frame(B, x, z, yaw, y0);
  F.cyl({ p: [0, 0, 0], r: [0.2, 0.13], h, seg: 10, mat: M.steel, col: 'metal' }); F.cyl({ p: [0, 0, 0], r: 0.3, h: 0.35, seg: 10, mat: M.concreteDark, col: false });
  F.box({ p: [0, h - 0.05, 0.3], s: [1.6, 0.09, 0.09], mat: M.steel, col: false, cast: false });
  for (const su of [-0.6, 0.6]) { F.box({ p: [su, h - 0.4, 0.62], s: [0.52, 0.32, 0.12], mat: M.steelDark, pitch: tilt * 0.5, bevel: 0.02, col: false }); F.box({ p: [su, h - 0.4, 0.7], s: [0.46, 0.26, 0.03], mat: M.lampG, pitch: tilt * 0.5, col: false, cast: false }); }
  const hp = F.p(0, h - 0.3, 0.9); halos.add(hp, 0xdcfff0, 1.5, 0.5, 0);
  if (cone) lampCone(B.group, [hp[0], hp[1], hp[2]], { len: h, r1: 3.4, color: 0xb8e8d8, intensity: 0.04 });
  { const d = F.p(0, 0, 1.0), o0 = F.p(0, 0, 0); ctx.light({ kind: 'spot', pos: [hp[0], hp[1] - 0.2, hp[2]], dir: [(d[0] - o0[0]) * 0.55, -1, (d[2] - o0[2]) * 0.55], angle: 0.95, penumbra: 0.7, color: 0xcfffe8, intensity: intensity * 4.5, distance: dist * 1.3, decay: 2, flicker: 0.03, flickerSpeed: 3, shadow: true }); }
  return hp;
}

/** canopy interior: radiant heater panels (warm orange), arrival board, speaker horns, cameras, extinguisher, sand bin */
export function canopyDressing(ctx, B, M, halos, F) {
  const heat = B.m('sHeater', std({ color: 0x1a0a04, emissive: 0xff6a24, emissiveIntensity: 2.6, roughness: 0.5 }));
  const grill = B.m('sHeaterG', std({ color: 0x1a0d08, emissive: 0xff8a34, emissiveIntensity: 1.0, roughness: 0.6 }));
  for (const v of [-9.4, -4.6]) for (const u of [-6.6, -3.4]) { F.box({ p: [u, 4.55, v], s: [1.7, 0.09, 0.5], mat: M.steelDark, bevel: 0.01, col: false, cast: false }); F.box({ p: [u, 4.5, v], s: [1.6, 0.03, 0.42], mat: heat, col: false, cast: false }); halos.add(F.p(u, 4.35, v), 0xff8a40, 0.75, 0.16, 0); }
  ctx.light({ pos: F.p(-5, 4.2, -7), color: 0xff8a40, intensity: 7, distance: 8, decay: 2 });
  const board = ledBoard(B, 'sBoard', ['MITTELSTATION', 'NEXT CABIN  00:38', 'WIND 74 KM/H  GUSTS'], { fg: '#7dffb8', k: 1.6 }); F.box({ p: [-9.18, 2.35, -6.8], s: [0.08, 0.94, 2.54], mat: M.steelDark, bevel: 0.01, col: false, cast: false }); quad(B, board, F.p(-9.13, 2.82, -6.8), 2.5, 0.9, F.yaw + P / 2); halos.add(F.p(-8.9, 2.8, -6.8), 0x7dffb8, 1.0, 0.16, 0);
  F.box({ p: [-9.3, 2.0, -6.8], s: [0.12, 0.08, 2.7], mat: M.steelDark, col: false, cast: false }); for (const v of [-8.0, -5.6]) F.beam([-9.25, 2.0, v], [-9.25, 3.2, v], 0.06, 0.06, { mat: M.steel, cast: false });
  for (const [u, v] of [[-8.6, -13], [-2.2, -1.4]]) { F.box({ p: [u, 4.3, v], s: [0.18, 0.2, 0.3], mat: M.steelDark, bevel: 0.02, col: false, cast: false }); F.box({ p: [u, 4.27, v], s: [0.08, 0.08, 0.3], mat: M.lampR, col: false, cast: false }); }   // CCTV domes
  for (const v of [-11.6, -2.2]) { F.cyl({ p: [-9.05, 3.6, v], r: 0.12, h: 0.35, seg: 10, mat: M.steelDark, roll: P / 2, anchor: 'center', col: false, cast: false }); }
  F.box({ p: [-1.7, 0, -1.2], s: [0.5, 0.6, 0.4], mat: M.orange, bevel: 0.03, col: 'metal' }); F.box({ p: [-1.7, 0.6, -1.2], s: [0.55, 0.08, 0.45], mat: M.snow, bevel: 0.03, col: false, cast: false });       // sand bin
  F.cyl({ p: [-9.0, 0.9, -2.5], r: 0.09, h: 0.45, seg: 8, mat: M.red, col: false, cast: false }); F.box({ p: [-9.15, 1.4, -2.5], s: [0.08, 0.3, 0.3], mat: M.red, col: false, cast: false });
}

/** snow fence: slatted timber fence on posts with the drift it builds on its lee side */
export function snowFence(B, M, H, a, b, seed = 1) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(L / 2.2)), yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  const rng = makeRng(seed * 3 + 1); const pts = []; for (let i = 0; i <= n; i++) { const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; pts.push([x, H(x, z), z]); }
  for (const p of pts) B.box({ p: [p[0], p[1] - 0.1, p[2]], s: [0.1, 1.9, 0.1], mat: M.timber, bevel: 0.01, col: false });
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[i + 1]; for (const yy of [0.35, 0.72, 1.1, 1.48]) { B.beam([p[0], p[1] + yy, p[2]], [q[0], q[1] + yy + (rng() - 0.5) * 0.04, q[2]], 0.05, 0.1, { mat: M.timber, cast: false }); } }
  // crested drift on the lee side (wind ~ +z): a low mound behind the fence
  const mx = (a[0] + b[0]) / 2 + 1.2, mz = (a[1] + b[1]) / 2 + 2.0; B.rock({ p: [mx, H(mx, mz) + 0.05, mz], r: 1, squash: [L / 2 * 0.9, 0.55, 1.5], amp: 0.28, seed: 5 + seed, detail: 2, mat: M.snow, yaw, cast: true, col: false });
}

/** warning signs on posts (pictograms drawn on canvas) */
export function warnSign(B, M, x, z, yaw, kind = 'avalanche', H = null, y0 = 0) {
  const F = new Frame(B, x, z, yaw, y0); const w = 1.0, h = 1.0;
  const tex = canvasTexture(256, 256, (c) => {
    c.fillStyle = kind === 'closed' ? '#b3161c' : '#111'; c.fillRect(0, 0, 256, 256);
    if (kind === 'avalanche') { c.fillStyle = '#ffcc00'; c.fillRect(14, 14, 228, 228); c.fillStyle = '#111'; c.font = '700 40px Arial'; c.textAlign = 'center'; c.fillText('AVALANCHE', 128, 62); c.fillStyle = '#c0161c'; c.beginPath(); c.moveTo(128, 88); c.lineTo(214, 222); c.lineTo(42, 222); c.fill(); c.fillStyle = '#fff'; c.font = '700 120px Arial'; c.fillText('5', 128, 196); }
    else if (kind === 'closed') { c.fillStyle = '#fff'; c.fillRect(14, 14, 228, 228); c.fillStyle = '#b3161c'; c.beginPath(); c.arc(128, 128, 96, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(128, 128, 76, 0, 7); c.fill(); c.fillStyle = '#b3161c'; c.font = '700 44px Arial'; c.textAlign = 'center'; c.fillText('CLOSED', 128, 144); }
    else { c.fillStyle = '#0a6a34'; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#fff'; c.lineWidth = 8; c.strokeRect(10, 10, 236, 236); c.fillStyle = '#fff'; c.font = '700 40px Arial'; c.textAlign = 'center'; c.fillText('ASSEMBLY', 128, 100); c.fillText('POINT', 128, 150); c.font = '700 70px Arial'; c.fillText('E', 128, 224); }
    for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(230,240,250,${Math.random() * 0.2})`; c.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 20, 2); } c.fillStyle = 'rgba(210,230,240,0.35)'; c.fillRect(0, 0, 256, 18); });
  const sm = B.m('sSign' + kind, std({ map: tex, roughness: 0.55, metalness: 0.2 }));
  F.cyl({ p: [0, 0, 0], r: 0.045, h: 2.4, seg: 8, mat: M.steel, col: 'metal' }); F.box({ p: [0, 1.4, 0.0], s: [w, h, 0.04], mat: M.steel, bevel: 0.01, col: false, cast: false }); quad(B, sm, F.p(0, 1.9, -0.075), w, h, F.yaw + P);
  F.box({ p: [0, 2.4, -0.05], s: [w + 0.06, 0.12, 0.09], mat: M.snow, bevel: 0.04, col: false, cast: false });
  void H;
}

export function palletStack(B, M, x, z, yaw, n = 3, seed = 1) {
  const F = new Frame(B, x, z, yaw, 0), rng = makeRng(seed);
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) F.box({ p: [0, i * 0.16, (k - 1) * 0.45], s: [1.2, 0.05, 0.14], mat: M.timber, bevel: 0.005, col: false, cast: false }); F.box({ p: [0, i * 0.16 + 0.05, 0], s: [1.2, 0.03, 1.0], mat: M.timber, bevel: 0.005, col: false, cast: false }); }
  F.box({ p: [0, n * 0.16 + 0.03, 0], s: [1.05, 0.6 + rng() * 0.3, 0.9], mat: rng() < 0.5 ? M.corr : M.orange, bevel: 0.03, col: 'metal' }); F.rock({ p: [0, n * 0.16 + 0.9, 0], r: 0.6, squash: [1, 0.22, 0.85], amp: 0.3, seed: 2 + seed, detail: 1, mat: M.snow, cast: false });
}
export function drum(B, M, x, z, mat, snow = true) {
  B.cyl({ p: [x, 0, z], r: 0.3, h: 0.9, seg: 14, mat, col: 'metal' }); for (const y of [0.15, 0.45, 0.75]) B.cyl({ p: [x, y, z], r: 0.31, h: 0.035, seg: 14, mat: M.steelDark, col: false, cast: false });
  if (snow) B.rock({ p: [x, 0.92, z], r: 0.3, squash: [1, 0.3, 1], amp: 0.3, seed: 4, detail: 1, mat: M.snow, cast: false });
}

/** ski-patrol snowmobile (orange + red cross), parked */
export function patrolSled(B, M, x, y, z, yaw) {
  const F = new Frame(B, x, z, yaw, y);
  F.box({ p: [0, 0.34, 0.0], s: [0.72, 0.16, 2.0], mat: M.steelDark, bevel: 0.04, col: false }); F.box({ p: [0, 0.3, 0.2], s: [0.9, 0.5, 2.5], mat: M.rubber, col: false, cast: false, bevel: 0.2 });
  F.sphere({ p: [0, 0.7, -0.55], r: 0.5, scale: [0.85, 0.62, 1.55], mat: M.orange, seg: 14 }); F.box({ p: [0, 0.62, 0.35], s: [0.62, 0.3, 1.15], mat: M.orange, bevel: 0.1, col: false });
  F.box({ p: [0, 0.9, 0.55], s: [0.48, 0.16, 1.0], mat: M.rubber, bevel: 0.06, col: false }); F.box({ p: [0, 0.98, -0.35], s: [0.5, 0.38, 0.05], mat: M.ice, pitch: -0.5, bevel: 0.01, col: false, cast: false });
  F.box({ p: [0.36, 0.86, -0.4], s: [0.02, 0.3, 0.3], mat: M.red, col: false, cast: false }); F.box({ p: [0, 1.1, 1.05], s: [0.9, 0.26, 0.5], mat: M.red, bevel: 0.04, col: false });                 // rescue toboggan on the rack
  F.box({ p: [0, 0.7, -1.28], s: [0.34, 0.12, 0.06], mat: M.lampG, bevel: 0.02, col: false, cast: false }); F.box({ p: [0, 1.28, 0.6], s: [0.5, 0.1, 0.14], mat: M.lampAmber, col: false, cast: false });
  for (const su of [-1, 1]) F.box({ p: [su * 0.5, 0.06, -0.75], s: [0.16, 0.06, 1.5], mat: M.iron, pitch: 0.12, bevel: 0.02, col: false, cast: false });
  F.rock({ p: [0, 1.05, 0.55], r: 0.4, squash: [0.9, 0.2, 1.5], amp: 0.3, seed: 6, detail: 1, mat: M.snow, cast: false });
  B.colliders.addBox({ x, y: y + 0.55, z, hx: 0.5, hy: 0.55, hz: 1.4, yaw, surface: 'metal', walk: false });
}
/** Pisten-Bully style groomer: track units, cab, blade, tiller, amber beacon, worklights */
export function groomer(ctx, B, M, halos, x, y, z, yaw) {
  const F = new Frame(B, x, z, yaw, y); const body = M.orange;
  for (const su of [-1, 1]) { F.box({ p: [su * 1.3, 0, 0.3], s: [0.9, 1.0, 5.0], mat: M.rubber, bevel: 0.36, col: false }); for (const sv of [-1.8, -0.6, 0.6, 1.8, 2.6]) F.cyl({ p: [su * 1.3, 0.5, sv + 0.3], r: 0.4, h: 0.8, seg: 12, mat: M.steelDark, roll: P / 2, anchor: 'center', col: false, cast: false }); }
  F.box({ p: [0, 0.8, 0.2], s: [2.4, 0.9, 4.4], mat: body, bevel: 0.1, col: false }); F.box({ p: [0, 1.65, -1.0], s: [2.2, 1.5, 1.9], mat: body, bevel: 0.08, col: false }); F.box({ p: [0, 1.9, -1.0], s: [2.16, 1.05, 1.86], mat: M.glassFrost, bevel: 0.03, col: false, cast: false });
  for (const su of [-1, 1]) F.box({ p: [su * 1.0, 1.9, -1.0], s: [0.08, 1.15, 1.9], mat: body, col: false }); F.box({ p: [0, 3.1, -1.0], s: [2.3, 0.14, 2.0], mat: body, bevel: 0.05, col: false }); F.box({ p: [0, 3.24, -1.0], s: [1.9, 0.2, 1.7], mat: M.snow, bevel: 0.1, col: false, cast: false });
  F.box({ p: [0, 1.2, 1.6], s: [2.2, 1.0, 1.4], mat: body, bevel: 0.08, col: false }); F.box({ p: [0, 0.75, -2.8], s: [3.9, 1.0, 0.24], mat: M.steel, pitch: 0.18, bevel: 0.05, col: false }); F.box({ p: [0, 0.35, 3.15], s: [3.6, 0.5, 0.8], mat: M.steel, bevel: 0.05, col: false });
  F.cyl({ p: [-0.8, 3.3, -0.4], r: 0.12, h: 0.22, seg: 10, mat: M.lampAmber, col: false, cast: false }); halos.add(F.p(-0.8, 3.55, -0.4), 0xffa020, 1.6, 0.7, 2.0);
  F.box({ p: [0, 3.18, -1.95], s: [1.4, 0.1, 0.16], mat: M.lampG, col: false, cast: false }); halos.add(F.p(0, 3.2, -2.05), 0xdcfff0, 1.0, 0.4, 0);
  F.rock({ p: [0, 2.5, 1.6], r: 1.0, squash: [1.2, 0.2, 1.3], amp: 0.3, seed: 3, detail: 1, mat: M.snow, cast: false });
  B.colliders.addBox({ x, y: y + 1.6, z, hx: 1.9, hy: 1.6, hz: 3.0, yaw, surface: 'metal', walk: false });
  ctx.light({ pos: F.p(-0.8, 3.5, -0.4), color: 0xffa020, intensity: 5, distance: 9, decay: 2, flicker: 0.2, flickerSpeed: 2 });
}

/** everything with cloth: flags on the roof, tape lines, windsock; wind direction angle from the atmosphere wind vector */
export function clothAndTape(B, M, H, F, wind) {
  const ang = Math.atan2(wind[2], wind[0]);
  const red = clothMaterial(B, 'sFlagRed', { map: stripedTexture(['#c0161c', '#c0161c'], { n: 2 }) }), hazard = clothMaterial(B, 'sTape', { map: stripedTexture(['#f1c40f', '#111'], { n: 10, angle: 0.5, w: 256, h: 32 }), roughness: 0.7 });
  const white = clothMaterial(B, 'sFlagW', { map: stripedTexture(['#e8eef0', '#c0161c', '#e8eef0'], { n: 3 }) });
  const top = 9.4; const rp = [[3.0, 0.4, 1.2], [8.6, 0.4, 19.0]]; rp.forEach(([u, y, v], i) => { const p = F.p(u, top + y, v); flagPole(B, M, i ? white : red, p[0], p[1], p[2], 3.4, ang, { len: 2.0, hgt: 1.2 }); });
  // hazard tape between stakes along two cordon lines
  const line = (a, b, n) => { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; pts.push([x, H(x, z), z]); }
    for (const p of pts) B.cyl({ p: [p[0], p[1], p[2]], r: 0.03, h: 1.35, seg: 6, mat: M.steelDark, col: false, cast: false });
    for (let i = 0; i < n; i++) for (const yy of [1.2, 0.9]) { const p = pts[i], q = pts[i + 1], sg = 0; void sg; const L = Math.hypot(q[0] - p[0], q[2] - p[2]); const segAng = Math.atan2(q[2] - p[2], q[0] - p[0]);
      // a tape span hangs between two stakes and flutters: model it as a flag from the first stake toward the next
      addFlag(B, hazard, [p[0], p[1] + yy, p[2]], segAng, L, 0.07, { segs: 8, rows: 1 }); } };
  line(F.p(-9.0, 0, -18.5).filter((_, i) => i !== 1), F.p(3.0, 0, -18.5).filter((_, i) => i !== 1), 5);
  line(F.p(12.4, 0, -2).filter((_, i) => i !== 1), F.p(12.4, 0, 14).filter((_, i) => i !== 1), 6);
  return {};
}

/** LED ring + rim lamps on the bullwheel (children of the rotating wheel group: the landmark reads as a lit, turning machine through the glass) */
export function wheelLeds(wheel, M, R) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.16, 0.05, 6, 64), M.lampAmber); ring.rotation.x = P / 2; ring.position.y = 0.06; wheel.add(ring);
  const g = new THREE.SphereGeometry(0.11, 8, 6); for (let i = 0; i < 16; i++) { const a = i / 16 * P * 2, m = new THREE.Mesh(g, i % 2 ? M.lampAmber : M.lampG); m.position.set(Math.cos(a) * (R + 0.16), 0.06, Math.sin(a) * (R + 0.16)); wheel.add(m); }
}
/** orange safety netting on posts along the plateau edge: fluttering cloth sheets (wind shader) between steel posts */
export function netting(B, M, H, a, b, ang, seed = 1) {
  const net = clothMaterial(B, 'sNet', { map: stripedTexture(['#ff7a12', '#ff7a12', '#ffb060', '#ff7a12'], { n: 8, w: 128, h: 32, worn: 0.6 }), roughness: 0.8 }); const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(L / 3)); const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  for (let i = 0; i <= n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, z = a[1] + (b[1] - a[1]) * i / n, y = H(x, z); B.cyl({ p: [x, y - 0.1, z], r: 0.045, h: 2.0, seg: 6, mat: M.steelDark, col: false, cast: true }); if (i < n) addFlag(B, net, [x + dx * 0.05, y + 1.85, z + dz * 0.05], Math.atan2(dz, dx), L / n - 0.1, 1.35, { segs: 6, rows: 2 }); }
  void ang; void seed;
}
/** avalanche-control gas exploder: red/white banded tube on a tripod aimed at the slope, with a beacon */
export function gazex(ctx, B, M, halos, x, y, z, yaw) {
  const F = new Frame(B, x, z, yaw, y);
  for (const s of [-1, 1]) F.beam([s * 0.9, 0, 0.6], [s * 0.15, 2.4, -0.1], 0.14, 0.14, { mat: M.steelDark }); F.beam([0, 0, -0.9], [0, 2.3, -0.1], 0.14, 0.14, { mat: M.steelDark });
  for (let i = 0; i < 6; i++) F.cyl({ p: [0, 2.5, -0.1 - i * 0.62], r: 0.42, h: 0.62, seg: 14, mat: i % 2 ? M.red : M.galv, pitch: P / 2, anchor: 'base', col: false });
  F.cyl({ p: [0, 2.5, -3.75], r: 0.44, h: 0.1, seg: 14, mat: M.steelDark, pitch: P / 2, col: false, cast: false }); F.box({ p: [0.7, 0.0, 0.7], s: [0.5, 1.0, 0.4], mat: M.orange, bevel: 0.03, col: 'metal', walk: false });
  const bp = F.p(0, 3.2, 0.2); halos.add(bp, 0xff3018, 0.7, 0.9, 2.4); ctx.light({ pos: bp, color: 0xff3018, intensity: 6, distance: 10, decay: 2, flicker: 0.3, flickerSpeed: 3 });
}
