// Summit dressing: storm guide-ropes with orange pennants, the summit cross on its cairn, the weather station (spinning anemometer cups, wind vane,
// Stevenson screen, snow stake), the observatory's iron terrace rail and a snowcat buried to its roof.
import * as THREE from 'three';
import { Frame } from './common.js';
import { clothMaterial, stripedTexture, addFlag } from './flags.js';
import { groomer } from './sdress.js';
import { makeRng } from '../../core/util.js';

const P = Math.PI;

/** A storm guide-rope: iron poles every ~5.5 m with a sagging rope and a fluttering orange reflective pennant on each pole. pts = [[x,z]..] stop-local; H = ground fn */
export function guideRope(B, M, H, pts, { wind = [8, 0, 21], seed = 1, tall = 1.9, halos = null } = {}) {
  const rng = makeRng(seed * 31 + 7); const ang = Math.atan2(wind[2], wind[0]);
  const pen = clothMaterial(B, 'uPennant', { map: stripedTexture(['#ff6a10', '#f4f0e6'], { n: 4, angle: 0.45, w: 128, h: 64 }), roughness: 0.6, emissive: 0xff5a10, emissiveIntensity: 0.22 });
  const path = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 5.5)); for (let k = 0; k < n; k++) path.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } path.push(pts[pts.length - 1]);
  const post = path.map(([x, z]) => [x, H(x, z), z]);
  for (const [x, y, z] of post) { B.cyl({ p: [x, y - 0.15, z], r: 0.03, h: tall + 0.15, seg: 6, mat: M.iron, col: false, cast: true }); B.cyl({ p: [x, y + tall - 0.05, z], r: 0.045, h: 0.1, seg: 6, mat: M.rime2 || M.iron, col: false, cast: false });
    addFlag(B, pen, [x, y + tall - 0.08, z], ang + (rng() - 0.5) * 0.2, 1.15 + rng() * 0.3, 0.55, { segs: 8, rows: 2, tail: 0.45 }); if (halos) halos.add([x, y + tall + 0.12, z], 0xffb060, 0.5, 0.55, 2 + rng() * 3); }
  for (let i = 0; i < post.length - 1; i++) { const a = post[i], b = post[i + 1]; B.cable([a[0], a[1] + tall - 0.35, a[2]], [b[0], b[1] + tall - 0.35, b[2]], 0.18, 0.009, M.wire, { n: 6, seg: 4, cast: false }); }
}

/** the summit cross: 4.2 m timber cross on a stacked-stone cairn, rimed, with a tin plaque */
export function summitCross(B, M, halos, x, y, z, yaw = 0) {
  const F = new Frame(B, x, z, yaw, y);
  B.rock({ p: [x, y + 0.3, z], r: 1.5, squash: [1.2, 0.55, 1.2], amp: 0.5, seed: 12, detail: 2, mat: M.rock, col: 'rock', cast: true });
  for (let i = 0; i < 9; i++) { const a = i * 0.7 + 0.3, r = 0.9 + (i % 3) * 0.2; B.rock({ p: [x + Math.cos(a) * r, y + 0.55 + (i % 2) * 0.12, z + Math.sin(a) * r], r: 0.34 + (i % 4) * 0.05, squash: [1, 0.7, 1], amp: 0.35, seed: 20 + i, detail: 1, mat: M.granite, cast: true, col: false }); }
  F.box({ p: [0, 0.75, 0], s: [0.2, 4.2, 0.2], mat: M.timber, bevel: 0.02, col: 'wood' }); F.box({ p: [0, 3.05, 0], s: [0.16, 0.16, 1.5], mat: M.timber, bevel: 0.02, col: false }); F.box({ p: [0, 3.3, 0], s: [0.24, 0.4, 0.06], mat: M.dark, col: false, cast: false });
  F.box({ p: [0.12, 1.5, 0], s: [0.02, 0.28, 0.4], mat: M.steelPaint, col: false, cast: false });
  F.rock({ p: [0, 4.95, 0], r: 0.3, squash: [0.4, 0.2, 1.4], amp: 0.3, seed: 3, detail: 1, mat: M.snow, cast: false });
  return { top: F.p(0, 5, 0) };
}

/** weather station: Stevenson screen on legs, snow stake, anemometer (rotating cups) + wind vane on a 6 m mast. returns {rotor, vane} to animate */
export function weatherStation(B, M, H, x, z, yaw = 0) {
  const y = H(x, z), F = new Frame(B, x, z, yaw, y);
  F.box({ p: [0, 0, 0], s: [1.6, 0.4, 1.6], mat: M.concrete, bevel: 0.04, col: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box({ p: [sx * 0.34, 0.4, sz * 0.3], s: [0.06, 1.1, 0.06], mat: M.steelPaint, col: false, cast: false });
  F.box({ p: [0, 1.5, 0], s: [0.9, 0.5, 0.7], mat: M.steelPaint, bevel: 0.02, col: 'metal' });
  for (let i = 0; i < 7; i++) F.box({ p: [0, 1.53 + i * 0.062, -0.36], s: [0.86, 0.02, 0.05], mat: M.steelPaint, pitch: 0.35, col: false, cast: false });                      // louvres
  F.box({ p: [0, 2.03, 0], s: [1.0, 0.08, 0.8], mat: M.steelPaint, bevel: 0.02, col: false }); F.rock({ p: [0, 2.12, 0], r: 0.5, squash: [1.0, 0.25, 0.8], amp: 0.3, seed: 6, detail: 1, mat: M.snow, cast: false });
  // snow stake: 3 m red/white banded pole
  for (let i = 0; i < 10; i++) F.box({ p: [1.6, 0.0 + i * 0.3, 0.3], s: [0.06, 0.3, 0.06], mat: i % 2 ? M.redPaint : M.steelPaint, col: false, cast: false });
  // mast + instruments
  F.cyl({ p: [-1.3, 0, 0.2], r: [0.07, 0.04], h: 6, seg: 8, mat: M.steel, col: 'metal' }); F.box({ p: [-1.3, 5.6, 0.2], s: [1.2, 0.05, 0.05], mat: M.steel, col: false, cast: false });
  const rotor = new THREE.Group(); const rp = F.p(-1.3, 6.05, 0.2); rotor.position.set(rp[0], rp[1], rp[2]); B.group.add(rotor);
  const cupG = new THREE.SphereGeometry(0.075, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55); const stem = new THREE.CylinderGeometry(0.008, 0.008, 0.36, 5); stem.rotateZ(Math.PI / 2);
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; const arm = new THREE.Mesh(stem, M.steel); arm.position.set(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18); arm.rotation.y = -a; rotor.add(arm);
    const cup = new THREE.Mesh(cupG, M.steelPaint); cup.position.set(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36); cup.rotation.set(Math.PI / 2, 0, -a + Math.PI / 2); rotor.add(cup); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8), M.iron); rotor.add(hub);
  const vane = new THREE.Group(); const vp = F.p(-1.3, 5.6, 0.2); vane.position.set(vp[0], vp[1], vp[2]); B.group.add(vane);
  const vb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.03), M.steel); vb.position.x = 0.0; vane.add(vb); const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.012), M.redPaint); tail.position.set(0.42, 0.02, 0); vane.add(tail);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 6), M.steel); nose.rotation.z = Math.PI / 2; nose.position.x = -0.42; vane.add(nose);
  for (const m of [...rotor.children, ...vane.children]) m.castShadow = true;
  B.colliders.addCyl({ x: F.p(-1.3, 0, 0.2)[0], z: F.p(-1.3, 0, 0.2)[2], r: 0.12, y0: y, y1: y + 6, surface: 'metal', walk: false });
  return { rotor, vane };
}

/** iron terrace rail around the observatory (posts + 2 rails, gap at the door), rimed */
export function terraceRail(B, M, F, { R = 7.9, gap = [P - 0.35, P + 0.35] } = {}) {
  const n = 40; let prev = null;
  for (let i = 0; i <= n; i++) { const a = i / n * P * 2; if (a > gap[0] && a < gap[1]) { prev = null; continue; } const p = [Math.sin(a) * R, Math.cos(a) * R];
    F.cyl({ p: [p[0], 0, -p[1]], r: 0.03, h: 1.1, seg: 6, mat: M.iron, col: false, cast: false });
    if (prev) for (const yy of [0.55, 1.05]) F.beam([prev[0], yy, -prev[1]], [p[0], yy, -p[1]], 0.035, 0.035, { mat: M.iron, cast: false }); prev = p; }
}

/** snowcat buried to the cab roof: only the amber beacon, light bar, roof rack and antenna stick out of a drift */
export function buriedCat(ctx, B, M, halos, H, x, z, yaw) {
  const y = H(x, z); groomer(ctx, B, M, halos, x, y - 1.9, z, yaw);
  B.rock({ p: [x, y + 0.1, z], r: 1, squash: [3.6, 1.2, 2.6], amp: 0.35, seed: 31, detail: 3, mat: M.snow, yaw, cast: true, col: false });
}
