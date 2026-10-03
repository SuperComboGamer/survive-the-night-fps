// MID-MOUNTAIN STATION building: concrete/steel/glass station block with the glazed bullwheel hall (ground floor) and the panoramic restaurant
// (first floor), the platform canopy over the exit arm, rail gantries out to the rope gate, rooftop mast with red beacon. Frame axes: u right, v back, forward = -v.
import * as THREE from 'three';
import { Frame, addIcicles, quad } from './common.js';
import { windowQuad, slabSnow, skyOccluder } from './snowkit.js';
import { wall } from './chalets.js';
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { makeBullwheel } from './wheel.js';
import { stationRope, LAND } from './line.js';

const L = LAND;
export const SBLOCK = { u0: -1.5, u1: 10.5, v0: 1.5, v1: 19.5, h1: 5.8, h2: 3.6 };
export const SSLAB = { u0: -9.8, u1: 10.9, v0: -16, v1: 19.9 };

export function buildStationHall(ctx, B, M, st, far) {
  const F = new Frame(B, 0, 0, st.yaw, 0); const out = { wheel: null, flick: [], beacon: null, lamps: [] };
  const { u0, u1, v0, v1, h1, h2 } = SBLOCK; const t = 0.5; const top = h1 + h2;
  // ---- slab (flush with the cabin floor)
  F.box({ p: [(SSLAB.u0 + SSLAB.u1) / 2, -0.7, (SSLAB.v0 + SSLAB.v1) / 2], s: [SSLAB.u1 - SSLAB.u0, 0.7, SSLAB.v1 - SSLAB.v0], mat: M.concreteDark, bevel: 0.03, col: 'concrete' });
  F.box({ p: [(SSLAB.u0 + SSLAB.u1) / 2, 0, (SSLAB.v0 + SSLAB.v1) / 2], s: [SSLAB.u1 - SSLAB.u0 - 0.4, 0.015, SSLAB.v1 - SSLAB.v0 - 0.4], mat: M.floor, bevel: 0.002, col: false, cast: false });
  // ---- ground-floor block: concrete right/back walls with the rope portal and a service door; glazed front and left (the wheel shows through)
  wall(F, 'v', u1 - t / 2, v0, v1, 0, h1, t, M.concrete, [{ c: 14.6, w: 7.2, y0: 0, y1: 5.6 }, { c: 5.0, w: 1.5, y0: 0, y1: 1.9 }], 'concrete');
  wall(F, 'u', v1 - t / 2, u0, u1, 0, h1, t, M.concrete, [], 'concrete');
  wall(F, 'u', v0 + t / 2, u0, u1, 0, 1.0, t, M.concrete, [], 'concrete'); wall(F, 'v', u0 + t / 2, v0, v1, 0, 1.0, t, M.concrete, [], 'concrete');                    // plinths under the glass
  for (const [fixed, ax, a, b] of [[v0 + t / 2, 'u', u0, u1], [u0 + t / 2, 'v', v0, v1 - 6]]) {
    const n = Math.round((b - a) / 3); for (let i = 0; i <= n; i++) { const c = a + (b - a) * i / n; if (ax === 'u') F.box({ p: [c, 0, fixed], s: [0.4, h1, 0.5], mat: M.steel, bevel: 0.03, col: 'metal' }); else F.box({ p: [fixed, 0, c], s: [0.5, h1, 0.4], mat: M.steel, bevel: 0.03, col: 'metal' }); }
    for (let i = 0; i < n; i++) { const c = a + (b - a) * (i + 0.5) / n, l = (b - a) / n - 0.4; if (ax === 'u') F.box({ p: [c, 1.0, fixed], s: [l, h1 - 1.0, 0.05], mat: M.glassFrost, col: false, cast: false, recv: false }); else F.box({ p: [fixed, 1.0, c], s: [0.05, h1 - 1.0, l], mat: M.glassFrost, col: false, cast: false, recv: false }); F.box({ p: ax === 'u' ? [c, 3.6, fixed] : [fixed, 3.6, c], s: ax === 'u' ? [l, 0.06, 0.1] : [0.1, 0.06, l], mat: M.steelDark, col: false, cast: false }); }
  }
  wall(F, 'v', u0 + t / 2, v1 - 6, v1, 0, h1, t, M.concrete, [], 'concrete');
  F.box({ p: [(u0 + u1) / 2, h1, (v0 + v1) / 2], s: [u1 - u0 + 0.6, 0.35, v1 - v0 + 0.6], mat: M.concrete, bevel: 0.04, col: false }); skyOccluder(B, F, u0 - 0.3, u1 + 0.3, v0 - 0.3, v1 + 0.3, h1, h1 + 0.4);                            // first-floor slab
  // ---- restaurant level: concrete band + panoramic ribbon windows (lit, frosted); the lit glass is emissive
  const wins = (a, b, n, w2) => Array.from({ length: n }, (_, i) => ({ c: a + (b - a) * (i + 0.5) / n, w: w2, y0: h1 + 0.75, y1: h1 + 3.0 }));
  const fronts = wins(u0 + 0.6, u1 - 0.6, 5, 1.9), lefts = wins(v0 + 0.8, v1 - 0.8, 6, 1.9);
  wall(F, 'u', v0 + t / 2, u0, u1, h1 + 0.17, top, t, M.concrete, fronts.map((o) => ({ ...o })), 'concrete'); wall(F, 'v', u0 + t / 2, v0, v1, h1 + 0.17, top, t, M.concrete, lefts.map((o) => ({ ...o })), 'concrete');
  wall(F, 'v', u1 - t / 2, v0, v1, h1 + 0.17, top, t, M.concrete, wins(v0 + 2, v1 - 2, 3, 1.9), 'concrete'); wall(F, 'u', v1 - t / 2, u0, u1, h1 + 0.17, top, t, M.concrete, wins(u0 + 2, u1 - 2, 2, 1.9), 'concrete');
  const nU = [F.c, -F.s], nV = [F.s, F.c]; let winK = 0;
  const litWin = (ax, fixed, o, face) => {
    const n = ax === 'u' ? (face > 0 ? [-nV[0], -nV[1]] : nV) : (face > 0 ? [-nU[0], -nU[1]] : nU);
    const p = F.p(...(ax === 'u' ? [o.c, (o.y0 + o.y1) / 2, fixed - face * 0.06] : [fixed - face * 0.06, (o.y0 + o.y1) / 2, o.c])); windowQuad(B, M.winCool, p, n, o.w, o.y1 - o.y0, (winK++) % 4);
    F.box({ p: ax === 'u' ? [o.c, o.y0 - 0.12, fixed - face * 0.2] : [fixed - face * 0.2, o.y0 - 0.12, o.c], s: ax === 'u' ? [o.w + 0.3, 0.12, 0.4] : [0.4, 0.12, o.w + 0.3], mat: M.concrete, col: false, cast: false, bevel: 0.02 });
    F.box({ p: ax === 'u' ? [o.c, o.y0 - 0.02, fixed - face * 0.3] : [fixed - face * 0.3, o.y0 - 0.02, o.c], s: ax === 'u' ? [o.w, 0.08, 0.3] : [0.3, 0.08, o.w], mat: M.snow, col: false, cast: false, bevel: 0.03 }); };
  for (const o of fronts) litWin('u', v0 + t / 2, o, 1); for (const o of lefts) litWin('v', u0 + t / 2, o, 1);
  for (const o of wins(v0 + 2, v1 - 2, 3, 1.9)) litWin('v', u1 - t / 2, o, -1); for (const o of wins(u0 + 2, u1 - 2, 2, 1.9)) litWin('u', v1 - t / 2, o, -1);
  // ---- roof-edge sign facing the platform / approach: MITTELSTATION 2 150 m (backlit letters on the parapet)
  { const tex = canvasTexture(2048, 160, (c) => { c.fillStyle = '#04120e'; c.fillRect(0, 0, 2048, 160); c.fillStyle = '#c8ffe4'; c.font = '900 118px Impact, "Arial Black", sans-serif'; c.textBaseline = 'middle'; if ('letterSpacing' in c) c.letterSpacing = '18px'; c.fillText('MITTELSTATION', 40, 84); c.fillStyle = '#7dffb8'; c.font = '700 96px "Arial Narrow", Arial, sans-serif'; c.fillText('2 150 m', 1500, 84); c.fillStyle = '#ff5a3c'; c.fillRect(1440, 26, 8, 110);
      for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(200,240,225,${Math.random() * 0.2})`; c.fillRect(Math.random() * 2048, Math.random() * 160, Math.random() * 22, 2); } });
    const sm = B.m('sRoofSign', std({ color: 0x03100c, map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.35, roughness: 0.5 }));
    quad(B, sm, F.p(u0 - 0.395, top + 0.72, (v0 + v1) / 2), 13.0, 0.56, F.yaw - Math.PI / 2); }
  // ---- roof deck: slab, parapet, snow load, mast + beacon, dish, plant
  F.box({ p: [(u0 + u1) / 2, top, (v0 + v1) / 2], s: [u1 - u0 + 0.8, 0.4, v1 - v0 + 0.8], mat: M.concrete, bevel: 0.04, col: false });
  for (const [c, l, hz] of [[v0 - 0.2, u1 - u0 + 0.8, false], [v1 + 0.2, u1 - u0 + 0.8, false]]) F.box({ p: [(u0 + u1) / 2, top + 0.4, c], s: [l, 0.6, 0.35], mat: M.concreteDark, bevel: 0.03, col: false });
  for (const c of [u0 - 0.2, u1 + 0.2]) F.box({ p: [c, top + 0.4, (v0 + v1) / 2], s: [0.35, 0.6, v1 - v0 + 0.8], mat: M.concreteDark, bevel: 0.03, col: false });
  slabSnow(B, M.snow, F, { u0: u0 - 0.1, u1: u1 + 0.1, v0: v0 - 0.1, v1: v1 + 0.1, y: top + 0.42, depth: 0.5, seed: 4 }); skyOccluder(B, F, u0 - 0.5, u1 + 0.5, v0 - 0.5, v1 + 0.5, h1 - 0.1, top + 0.3);
  F.box({ p: [7.5, top + 0.4, 8], s: [3.2, 1.6, 2.4], mat: M.corr, bevel: 0.04, col: false }); F.box({ p: [7.5, top + 2.0, 8], s: [3.4, 0.5, 2.6], mat: M.snow, bevel: 0.2, col: false, cast: false });   // plant room
  const mast = F.p(2.5, top + 0.4, 16.5); B.cyl({ p: mast, r: [0.28, 0.14], h: 15, seg: 12, mat: M.steel, col: false }); for (let k = 0; k < 4; k++) B.cyl({ p: [mast[0], mast[1] + 3 + k * 3, mast[2]], r: 0.3, h: 0.2, seg: 12, mat: k % 2 ? M.steel : M.red, col: false, cast: false });
  for (const [du, dv] of [[-2, -2], [3, -2], [0, 3]]) { const g = F.p(2.5 + du * 2.4, top + 0.6, 16.5 + dv * 2.4); B.tube({ pts: [[mast[0], mast[1] + 12, mast[2]], [(mast[0] + g[0]) / 2, mast[1] + 6, (mast[2] + g[2]) / 2], g], r: 0.012, mat: M.wire, seg: 4, segs: 8 }); }
  const mb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), std({ color: 0x220404, emissive: 0xff2412, emissiveIntensity: 8 })); mb.position.set(mast[0], mast[1] + 15.25, mast[2]); B.group.add(mb); out.beacon = mb; far.add([mast[0], mast[1] + 15.25, mast[2]], 0xff3018, 1.6, 1.4, 2.2);
  const dish = F.p(9.0, top + 1.0, 17.5); B.sphere({ p: dish, r: 0.9, seg: 14, ps: 0.5, mat: M.galv, pitch: 0.9, cast: false });
  // ---- bullwheel + drive + tensioner (the landmark: seen through the glass front)
  const C = st.C; const wheelHot = B.m('sWheelHot', std({ color: 0xc4581a, metalness: 0.5, roughness: 0.45, emissive: 0xff5a10, emissiveIntensity: 0.2 }));      // lit by the floods: reads as the glowing landmark through the frosted glass
  const wheel = makeBullwheel(ctx, { R: L.RAIL_R, mats: { steel: M.steel, steelRed: wheelHot, iron: M.iron }, spokes: 16 }); wheel.position.set(C[0], L.PIVOT_H, C[1]); B.group.add(wheel); out.wheel = wheel;
  B.cyl({ p: [C[0], 0, C[1]], r: 4.3, h: 0.9, seg: 36, mat: M.concreteDark, col: 'concrete' }); B.cyl({ p: [C[0], 0.9, C[1]], r: 3.8, h: 0.05, seg: 36, mat: M.grating, col: false, cast: false });
  for (let i = 0; i < 28; i++) { const a = i / 28 * 6.283; B.cyl({ p: [C[0] + Math.cos(a) * 4.2, 0.9, C[1] + Math.sin(a) * 4.2], r: 0.03, h: 1.05, seg: 5, mat: M.galv, col: false, cast: false }); }
  const drv = F.p(6.2, 0, 15.2); B.box({ p: drv, s: [3.4, 3.0, 2.6], yaw: F.yaw, mat: M.orange, bevel: 0.08, col: 'metal', walk: false }); B.cyl({ p: [drv[0], 3.0, drv[2]], r: 0.5, h: 0.6, seg: 14, mat: M.steelDark, col: false });
  // big vertical flywheel/gear of the drive train (visible through the glass, rotates slowly)
  const fly = new THREE.Group(); const fb = F.p(1.6, 2.6, 16.2); fly.position.set(fb[0], fb[1], fb[2]); fly.rotation.y = F.yaw; B.group.add(fly);
  { const torus = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.26, 10, 40), M.orange); torus.castShadow = true; fly.add(torus); for (let i = 0; i < 10; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.0, 0.22), M.steel); sp.rotation.z = i * Math.PI / 5; fly.add(sp); } const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.6, 16), M.steelDark); hub.rotation.x = Math.PI / 2; fly.add(hub); }
  out.fly = fly;
  // ---- hall interior: fluorescent battens under the first-floor slab (they glow through the frosted glass), cold pooled light on the wheel
  for (const [u, v] of [[1.0, 4.4], [5.6, 4.4], [1.0, 9.6], [5.6, 9.6], [1.0, 14.8], [5.6, 14.8]]) F.box({ p: [u, h1 - 0.13, v], s: [0.14, 0.07, 2.4], mat: M.lampG, col: false, cast: false });
  out.hallLamps = [F.p(3.4, 4.7, 7), F.p(3.4, 4.7, 13)];
  for (const u of [0.4, 2.5, 4.6, 6.7, 8.8]) { F.box({ p: [u, 1.5, v1 - t - 0.06], s: [1.7, 1.9, 0.06], mat: M.lampG, col: false, cast: false }); F.box({ p: [u, 0.35, v1 - t - 0.06], s: [1.7, 0.5, 0.06], mat: M.lampAmber, col: false, cast: false }); }     // wall-washer panels on the hall's back wall: the wheel reads as a dark machine against a lit wall
  // ---- ropes through the station + rail on hangers
  const rp = stationRope(1); B.tube({ pts: rp, r: 0.03, mat: M.wire, seg: 5, segs: rp.length * 2 });
  const rail = rp.filter((_, i) => i % 2 === 0).map((p) => [p[0], p[1] + 0.34, p[2]]); B.tube({ pts: rail, r: 0.06, mat: M.steelDark, seg: 6, segs: rail.length, cast: true });
  for (let i = 0; i < rp.length; i += 8) B.beam([rp[i][0], rp[i][1] + 0.34, rp[i][2]], [rp[i][0], rp[i][1] + 1.2, rp[i][2]], 0.06, 0.06, { mat: M.iron, cast: false });
  // ---- platform canopy over the exit arm (u -9.6 .. +2.6, v -14.5 .. 1.5): portal frames, frosted roof panels, heavy snow, emergency lamps
  const frames = [1.0, -3.5, -8, -12.5];
  for (const v of frames) {
    for (const u of [-9.3, 2.9]) F.cyl({ p: [u, 0, v], r: 0.2, h: 5.6, seg: 12, mat: M.steel, col: 'metal' });
    F.beam([-9.3, 5.1, v], [2.9, 6.3, v], 0.34, 0.5, { mat: M.steel }); F.box({ p: [-9.3, 4.9, v], s: [0.6, 0.5, 0.5], mat: M.steel, bevel: 0.04, col: false });
  }
  const cl = 14.4, sl = Math.atan2(1.2, 12.2); F.box({ p: [-3.2, 5.62, -6.5], s: [12.4, 0.14, cl + 1.0], roll: sl, mat: M.steelDark, col: false, cast: true });
  for (let k = 0; k < 8; k++) F.beam([-9.4 + k * 1.75, 5.05 + k * 0.16, -14.2], [-9.4 + k * 1.75, 5.05 + k * 0.16, 1.5], 0.12, 0.2, { mat: M.steel });
  F.beam([-9.5, 5.2, 1.3], [-9.5, 5.2, -14.0], 0.2, 0.3, { mat: M.steel }); F.beam([2.9, 6.4, 1.3], [2.9, 6.4, -14.0], 0.2, 0.3, { mat: M.steel });
  slabSnow(B, M.snow, F, { u0: -9.9, u1: 3.3, v0: -14.4, v1: 1.6, y: 5.72, depth: 0.5, seed: 9 }); skyOccluder(B, F, -9.8, 3.2, -14.3, 1.5, 5.0, 6.3);
  addIcicles(B, M.ice, [F.p(-9.6, 0, -14.3)[0], F.p(-9.6, 0, -14.3)[2]], [F.p(-9.6, 0, 1.4)[0], F.p(-9.6, 0, 1.4)[2]], { every: 0.16, seed: 11, y: 5.05, minLen: 0.15, maxLen: 0.9 });
  addIcicles(B, M.ice, [F.p(-9.6, 0, -14.3)[0], F.p(-9.6, 0, -14.3)[2]], [F.p(2.9, 0, -14.3)[0], F.p(2.9, 0, -14.3)[2]], { every: 0.16, seed: 12, y: 5.5, minLen: 0.15, maxLen: 0.8 });
  // emergency fluorescent lamps under the canopy (flicker) + hazard strip at the door edge + platform furniture
  for (const v of [-11, -6.8, -2.6, 0.2]) { F.box({ p: [-4.6, 5.0, v], s: [0.12, 0.08, 2.1], mat: M.lampG, col: false, cast: false }); out.flick.push(F.p(-4.6, 4.95, v)); out.lampMats = out.lampMats || []; }
  F.box({ p: [-1.36, 0.0, -6.5], s: [0.4, 0.012, 16.4], mat: M.hazard, bevel: 0.002, col: false, cast: false });
  F.box({ p: [-9.4, 0, -6.5], s: [0.1, 1.1, 16.2], mat: M.steelDark, bevel: 0.02, col: 'metal' });
  for (const v of [-11, -4.2]) { F.box({ p: [-8.0, 0, v], s: [0.55, 0.5, 2.2], mat: M.steel, bevel: 0.03, col: 'metal' }); F.box({ p: [-8.25, 0.5, v], s: [0.1, 0.55, 2.2], mat: M.steel, bevel: 0.03, col: false }); }
  F.box({ p: [-5.2, 3.9, 1.42], s: [1.3, 0.38, 0.06], mat: M.exit, col: false, cast: false }); for (const uu of [-8.8, -7.2]) F.box({ p: [uu, 0, -0.4], s: [0.08, 1.5, 0.08], mat: M.steelDark, col: 'metal' }); F.box({ p: [-8.0, 0.9, -0.4], s: [1.6, 0.5, 0.06], mat: M.hazard, col: false, cast: false }); F.box({ p: [-8.0, 1.5, -0.4], s: [1.7, 0.06, 0.1], mat: M.steel, col: false, cast: false });      // platform-end barrier: hazard board on two posts
  for (const v of [-13.6, -0.7]) F.box({ p: [-1.5, 3.9, v], s: [0.3, 0.4, 0.06], mat: M.exit, col: false, cast: false });
  // ---- open-air rail gantries carrying the rope out to the gate (v -14.5 .. -28)
  for (const v of [-17.5, -22.5, -27.5]) { F.cyl({ p: [3.3, 0, v], r: [0.3, 0.18], h: 5.6, seg: 10, mat: M.steel, col: 'metal' }); F.beam([3.3, 5.2, v], [0.3, 5.05, v], 0.16, 0.22, { mat: M.steel }); F.box({ p: [0, 4.75, v], s: [0.5, 0.28, 0.5], mat: M.steelDark, bevel: 0.04, col: false }); }
  return out;
}
