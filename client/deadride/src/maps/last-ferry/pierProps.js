// CITY PIER props: 1950s trucks, the portal (gantry) crane, shipping containers, rail wagons. All axis-aligned (yaw multiples of 90 deg) so colliders are exact.
import * as THREE from 'three';
import { containerReal, latticeLeg } from './real.js';
import { truckDetail, latticeBoom, rope3 } from './arch.js';
const P = Math.PI;

/** local frame helper: u forward, v right (starboard of the vehicle), w up. yaw 0 => vehicle faces +x; yaw = P/2 => faces -z ... (three convention: local +x -> (cos, -sin)) */
export function frame(x, y, z, yaw) { const c = Math.round(Math.cos(yaw) * 1e6) / 1e6, s = Math.round(Math.sin(yaw) * 1e6) / 1e6; return (u, w, v) => [x + u * c + v * s, y + w, z - u * s + v * c]; }

/** 1950s truck. kind: 'van' (box body) | 'flat' (stake bed). m = materials {paint, paint2, chrome, black, glass, tyre, wood, lampOn, lampRed, steel} */
export function truck(K, m, o) {
  const B = K.B, { x, z, yaw = 0, y = K.st.quayY, kind = 'van', on = false } = o; const F = frame(x, y, z, yaw); const alongX = Math.abs(Math.cos(yaw)) > 0.5;
  const box = (u0, u1, w0, w1, v0, v1, mat, bevel = 0.03, col = false) => { const a = F((u0 + u1) / 2, w0, (v0 + v1) / 2); B.box({ p: a, s: alongX ? [Math.abs(u1 - u0), w1 - w0, Math.abs(v1 - v0)] : [Math.abs(v1 - v0), w1 - w0, Math.abs(u1 - u0)], mat, bevel, col, cast: true }); };
  const wheel = (u, v) => { const c = F(u, 0.5, v); B.cyl({ p: c, r: 0.5, h: 0.26, seg: 18, mat: m.tyre, roll: alongX ? 0 : P / 2, pitch: alongX ? P / 2 : 0, anchor: 'center', cast: true }); B.cyl({ p: F(u, 0.5, v + Math.sign(v) * 0.14), r: 0.24, h: 0.03, seg: 14, mat: m.chrome, roll: alongX ? 0 : P / 2, pitch: alongX ? P / 2 : 0, anchor: 'center', cast: false }); };
  // chassis + axles
  box(-3.0, 2.7, 0.5, 0.76, -0.45, 0.45, m.black, 0.02); for (const u of [-1.95, 1.75]) box(u - 0.06, u + 0.06, 0.45, 0.58, -1.0, 1.0, m.black, 0.01);
  for (const v of [-0.98, 0.98]) { wheel(-1.95, v); wheel(-1.95, v * 0.78 * 0.98 - Math.sign(v) * 0.0); wheel(1.75, v); }
  // fenders + running board + hood + grille
  for (const v of [-1, 1]) { box(1.05, 2.45, 0.78, 0.98, v * 0.66, v * 1.12, m.paint2, 0.06); box(1.05, 2.45, 0.98, 1.06, v * 0.7, v * 1.08, m.paint2, 0.05); box(0.1, 1.1, 0.55, 0.62, v * 0.98, v * 1.18, m.black, 0.01); box(-0.05, 1.2, 0.7, 0.8, v * 1.02, v * 1.1, m.paint2, 0.02); }
  box(1.4, 2.72, 0.86, 1.5, -0.62, 0.62, m.paint, 0.08); box(1.6, 2.7, 1.5, 1.6, -0.5, 0.5, m.paint, 0.03); box(2.7, 2.78, 0.82, 1.4, -0.52, 0.52, m.chrome, 0.02);
  for (let i = -2; i <= 2; i++) box(2.78, 2.82, 0.86, 1.36, i * 0.18 - 0.02, i * 0.18 + 0.02, m.chrome, 0.005); box(2.78, 2.83, 0.84, 0.9, -0.5, 0.5, m.chrome, 0.005); box(2.78, 2.83, 1.34, 1.4, -0.5, 0.5, m.chrome, 0.005);
  box(2.78, 3.0, 0.42, 0.62, -1.02, 1.02, m.chrome, 0.05); // bumper
  for (const v of [-1, 1]) { const c = F(2.7, 1.12, v * 0.62); B.cyl({ p: c, r: 0.15, h: 0.12, seg: 12, mat: m.chrome, roll: alongX ? P / 2 : 0, pitch: alongX ? 0 : P / 2, anchor: 'center', cast: false }); const g = F(2.78, 1.12, v * 0.62); B.sphere({ p: g, r: 0.11, mat: on ? m.lampOn : m.glass, seg: 8, cast: false }); if (on) K.glare(F(2.85, 1.12, v * 0.62), 0xffe2a8, 0.32, 1.2, { refl: 2.4 }); }
  // cab: lower body, glass band (windshield + sides), roof
  box(0.25, 1.62, 0.84, 1.52, -0.98, 0.98, m.paint, 0.06, 'metal'); box(0.25, 1.62, 1.52, 2.14, -0.95, 0.95, m.paint, 0.05); box(0.22, 1.66, 2.1, 2.2, -1.02, 1.02, m.paint, 0.04);
  box(1.55, 1.66, 1.56, 2.08, -0.9, 0.9, m.glass, 0.005); box(0.24, 1.6, 1.56, 2.06, -0.99, 0.99, m.glass, 0.005); box(0.24, 0.3, 1.56, 2.08, -0.9, 0.9, m.glass, 0.005);
  for (const v of [-1, 1]) { box(1.53, 1.7, 1.5, 2.12, v * 0.02 - 0.03, v * 0.02 + 0.03, m.chrome, 0.005); box(0.2, 1.6, 1.53, 2.09, v * 0.99 - 0.02, v * 0.99 + 0.02, m.black, 0.005); box(0.24, 0.29, 1.5, 2.1, v * 0.96 - 0.04, v * 0.96 + 0.04, m.black, 0.005); }
  for (const v of [-1, 1]) { B.beam(F(1.5, 1.72, v * 1.0), F(1.5, 1.72, v * 1.32), 0.03, 0.03, { mat: m.chrome, bevel: 0, cast: false }); box(1.5, 1.56, 1.5, 1.85, v * 1.28 - 0.02, v * 1.28 + 0.02, m.chrome, 0.005); }
  // body
  if (kind === 'van') { box(-3.02, 0.2, 0.78, 2.6, -1.05, 1.05, m.paint2, 0.06, 'metal'); box(-3.05, 0.22, 2.55, 2.66, -1.08, 1.08, m.paint2, 0.04); for (let i = 0; i < 4; i++) box(-3.02 + i * 0.95, -3.0 + i * 0.95 + 0.04, 0.8, 2.55, -1.075, 1.075, m.black, 0.003); box(-3.06, -3.02, 0.9, 2.4, -0.98, 0.98, m.black, 0.003); }
  else { box(-3.0, 0.2, 0.76, 0.9, -1.05, 1.05, m.wood, 0.02, 'wood'); for (const v of [-1, 1]) { box(-3.0, 0.2, 0.9, 1.4, v * 1.03 - 0.03, v * 1.03 + 0.03, m.wood, 0.01); for (let i = 0; i < 6; i++) box(-3.0 + i * 0.6 - 0.04, -3.0 + i * 0.6 + 0.04, 0.9, 1.9, v * 1.05 - 0.04, v * 1.05 + 0.04, m.black, 0.005); } box(-3.05, -3.0, 0.9, 1.4, -1.05, 1.05, m.wood, 0.01); if (o.load) for (const [u, v, w, h, d] of o.load) K.crate(...F(u, 0.9 + h / 2 - h / 2, v), alongX ? w : d, h, alongX ? d : w, m.wood, { yaw: 0 }); }
  // tail lights, fuel tank, exhaust, spare, mirrors
  for (const v of [-0.85, 0.85]) { const c = F(-3.06, 0.95, v); B.box({ p: c, s: alongX ? [0.05, 0.16, 0.2] : [0.2, 0.16, 0.05], mat: on ? m.lampRed : m.glass, bevel: 0, cast: false }); if (on) K.glare(F(-3.12, 1.03, v), 0xff2010, 0.2, 0.9, { refl: 1.6 }); }
  B.cyl({ p: F(-0.9, 0.62, 0.62), r: 0.2, h: 0.9, seg: 10, mat: m.steel, roll: alongX ? 0 : P / 2, pitch: alongX ? P / 2 : 0, anchor: 'center', cast: false }); B.cyl({ p: F(0.4, 0.6, -0.55), r: 0.05, h: 1.0, seg: 6, mat: m.steel, roll: alongX ? P / 2 : 0, pitch: alongX ? 0 : P / 2, anchor: 'center', cast: false });
  // collider (one solid box)
  truckDetail(K, m, F, alongX, kind, y);
  const c0 = F(-0.15, 0, 0), hl = 3.0, hw = 1.1; B.colliders.addBox({ x: c0[0], y: y + 1.2, z: c0[2], hx: alongX ? hl : hw, hy: 1.2, hz: alongX ? hw : hl, surface: 'metal', walk: false });
}

/** shipping container (6.05 x 2.6 x 2.44 along the given axis) — instance-friendly boxes with painted corrugation texture material */
export function container(K, x, y, z, alongX, mat, o = {}) { containerReal(K, x, y, z, alongX, mat, o); }

/** portal (gantry) crane straddling two rail tracks; jib over the water (-z). cx,cz = centre; legs at cx +-3.6 (wagons pass through along x), rails at z = cz +-3.6. */
export function portalCrane(K, m, cx, cz, o = {}) {
  const B = K.B, y0 = o.y ?? K.st.quayY; const lx = 3.7, lz = 3.8, ph = 8.4;
  // legs (box girders) with X bracing, portal beams
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { latticeLeg(B, cx + sx * lx, y0, cz + sz * lz, ph, 0.75, m.body); B.box({ p: [cx + sx * lx, y0 - 0.02, cz + sz * lz], s: [1.5, 0.5, 1.5], mat: m.dark, bevel: 0.03, cast: false }); // bogie
    for (const dz of [-0.55, 0.55]) B.cyl({ p: [cx + sx * lx, y0 - 0.02, cz + sz * lz + dz], r: 0.22, h: 0.7, seg: 10, mat: m.dark, roll: P / 2, anchor: 'center', cast: false }); }
  for (const sz of [-1, 1]) { B.box({ p: [cx, y0 + ph - 0.7, cz + sz * lz], s: [lx * 2 + 0.75, 1.1, 0.8], mat: m.body, bevel: 0.03, cast: true }); for (const y of [2.2]) B.box({ p: [cx, y0 + y, cz + sz * lz], s: [lx * 2, 0.4, 0.5], mat: m.body, bevel: 0.02, cast: false }); B.beam([cx - lx, y0 + 0.4, cz + sz * lz], [cx + lx, y0 + ph - 0.7, cz + sz * lz], 0.22, 0.3, { mat: m.body, bevel: 0, cast: false }); B.beam([cx + lx, y0 + 0.4, cz + sz * lz], [cx - lx, y0 + ph - 0.7, cz + sz * lz], 0.22, 0.3, { mat: m.body, bevel: 0, cast: false }); }
  for (const sx of [-1, 1]) B.box({ p: [cx + sx * lx, y0 + ph - 0.7, cz], s: [0.8, 1.1, lz * 2 + 0.8], mat: m.body, bevel: 0.03, cast: true });
  B.box({ p: [cx, y0 + ph - 0.2, cz], s: [lx * 2, 0.5, lz * 2], mat: m.dark, bevel: 0.03, cast: true });
  // turntable + machinery house + cab
  const hy = y0 + ph + 0.3; B.cyl({ p: [cx, hy - 0.1, cz], r: 3.1, h: 0.7, seg: 20, mat: m.dark, cast: true }); B.cyl({ p: [cx, hy + 0.6, cz], r: 2.7, h: 0.3, seg: 20, mat: m.body, cast: false });
  B.box({ p: [cx + 0.4, hy + 0.9, cz + 0.6], s: [5.2, 3.6, 4.2], mat: m.cream, bevel: 0.05, col: 'metal', walk: false, cast: true }); B.box({ p: [cx + 0.4, hy + 4.5, cz + 0.6], s: [5.4, 0.25, 4.4], mat: m.dark, bevel: 0.03, cast: true });
  B.box({ p: [cx - 1.9, hy + 1.6, cz - 1.85], s: [1.8, 2.3, 1.8], mat: m.cream, bevel: 0.05, cast: true }); // cab (front-left, toward the water)
  for (const [ux, uy, uz, w, h, d] of [[cx - 1.9, hy + 2.2, cz - 2.76, 1.5, 1.2, 0.05], [cx - 2.8, hy + 2.2, cz - 1.85, 0.05, 1.2, 1.5], [cx + 3.0, hy + 2.3, cz + 0.6, 0.05, 1.0, 3.0], [cx + 0.4, hy + 2.3, cz + 2.72, 3.5, 1.0, 0.05]]) B.box({ p: [ux, uy, uz], s: [w, h, d], mat: m.lit, bevel: 0, cast: false });
  K.lamp([cx - 1.9, hy + 2.8, cz - 1.9], { color: 0xffc070, cd: 14, dist: 10, size: 0.35, refl: 1.5, mist: 1.2 });
  // counterweight (concrete blocks) at the back
  B.box({ p: [cx + 1.0, hy + 0.9, cz + 4.1], s: [4.2, 2.6, 2.4], mat: m.conc, bevel: 0.05, cast: true }); for (let i = 0; i < 3; i++) B.box({ p: [cx - 0.7 + i * 1.4, hy + 3.5, cz + 4.1], s: [1.3, 0.9, 2.2], mat: m.conc, bevel: 0.05, cast: false });
  // A-frame + jib (luffing) over the water, tie rods, hook block
  const ax = cx, az = cz - 0.8, ay = hy + 4.6, apex = [ax, ay + 10.5, az + 1.6]; for (const sx of [-1, 1]) { latticeBoom(B, [ax + sx * 1.9, ay, az + 2.6], [apex[0] + sx * 0.25, apex[1], apex[2]], 0.62, m.body, { bay: 0.95 }); latticeBoom(B, [ax + sx * 1.9, ay, az - 0.6], [apex[0] + sx * 0.25, apex[1], apex[2]], 0.5, m.body, { bay: 0.95 }); }
  B.box({ p: [apex[0], apex[1] - 0.1, apex[2]], s: [1.1, 0.5, 0.6], mat: m.dark, bevel: 0.03, cast: false });
  const piv = [cx, hy + 1.4, cz - 2.8], ang = 0.7, JL = 25; const tip = [piv[0], piv[1] + Math.sin(ang) * JL, piv[2] - Math.cos(ang) * JL];
  for (const sx of [-1, 1]) { latticeBoom(B, [piv[0] + sx * 0.7, piv[1], piv[2]], [tip[0] + sx * 0.32, tip[1], tip[2]], 0.36, m.jib, { bay: 0.85, chord: 0.045 }); }
  const n = 16; for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, w0 = 0.7 - 0.38 * t0, w1 = 0.7 - 0.38 * t1; const p0 = [piv[0], piv[1] + (tip[1] - piv[1]) * t0, piv[2] + (tip[2] - piv[2]) * t0], p1 = [piv[0], piv[1] + (tip[1] - piv[1]) * t1, piv[2] + (tip[2] - piv[2]) * t1]; const sd = i % 2 ? -1 : 1; B.beam([p0[0] + sd * w0, p0[1], p0[2]], [p1[0] - sd * w1, p1[1], p1[2]], 0.07, 0.09, { mat: m.jib, bevel: 0, cast: false }); if (i % 4 === 0) B.beam([p0[0] - w0, p0[1], p0[2]], [p0[0] + w0, p0[1], p0[2]], 0.09, 0.09, { mat: m.jib, bevel: 0, cast: false }); }
  rope3(B, [[apex[0] - 0.3, apex[1], apex[2]], [(apex[0] + tip[0]) / 2 - 0.3, (apex[1] + tip[1]) / 2 + 0.6, (apex[2] + tip[2]) / 2], [tip[0] - 0.3, tip[1], tip[2]]], 0.07, m.rope, { n: 30 }); rope3(B, [[apex[0] + 0.3, apex[1], apex[2]], [(apex[0] + tip[0]) / 2 + 0.3, (apex[1] + tip[1]) / 2 + 0.6, (apex[2] + tip[2]) / 2], [tip[0] + 0.3, tip[1], tip[2]]], 0.07, m.rope, { n: 30 });
  B.cyl({ p: [tip[0], tip[1] - 0.2, tip[2]], r: 0.6, h: 0.4, seg: 12, mat: m.dark, roll: P / 2, anchor: 'center', cast: false });
  const hookY = tip[1] - 13; B.tube({ pts: [[tip[0] - 0.1, tip[1] - 0.6, tip[2]], [tip[0] - 0.1, tip[1] - 6, tip[2]], [tip[0] - 0.1, hookY + 0.7, tip[2]]], r: 0.03, mat: m.rope, seg: 4, segs: 10, cast: false }); B.tube({ pts: [[tip[0] + 0.1, tip[1] - 0.6, tip[2]], [tip[0] + 0.1, tip[1] - 6, tip[2]], [tip[0] + 0.1, hookY + 0.7, tip[2]]], r: 0.03, mat: m.rope, seg: 4, segs: 10, cast: false });
  B.box({ p: [tip[0], hookY, tip[2]], s: [0.7, 0.75, 0.5], mat: m.jib, bevel: 0.04, cast: true }); B.cyl({ p: [tip[0], hookY - 0.4, tip[2]], r: [0.08, 0.05], h: 0.5, seg: 6, mat: m.dark, cast: false });
  // warning lights: tip + A-frame apex (blinking red), floodlight on the jib
  K.glare([tip[0], tip[1] + 0.5, tip[2]], 0xff2010, 0.45, 1.5, { blink: [1.4, 0.35], refl: 2.5, mist: 1.4 }); K.glare([apex[0], apex[1] + 0.6, apex[2]], 0xff2010, 0.45, 1.5, { blink: [1.4, 0.35, 0.7], refl: 2.5, mist: 1.4 });
  K.glare([tip[0], tip[1] - 1.4, tip[2] + 0.3], 0xffd9a0, 0.6, 1.0, { refl: 2 });
  // ladder up one leg
  for (let y = 0.5; y < ph; y += 0.32) B.box({ p: [cx - lx - 0.42, y0 + y, cz + lz + 0.05], s: [0.05, 0.03, 0.5], mat: m.dark, bevel: 0, cast: false }); for (const dz of [-0.24, 0.24]) B.box({ p: [cx - lx - 0.42, y0, cz + lz + 0.05 + dz], s: [0.05, ph, 0.03], mat: m.dark, bevel: 0, cast: false });
  return { tip, apex, hook: [tip[0], hookY, tip[2]] };
}
