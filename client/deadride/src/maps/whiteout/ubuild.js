// SUMMIT OBSERVATORY parts: the ice-glazed 1930s stone observatory (drum + copper dome with an open slit + brass refractor), stone annex,
// stone lift hut around the bullwheel, radio lattice mast with guy wires and red beacons, basalt spires, cornices, rime feathers.
import * as THREE from 'three';
import { Builder } from '../../core/build.js';
import { Frame, addIcicles } from './common.js';
import { skyOccluder, windowQuad, roofSnow } from './snowkit.js';
import { wall } from './chalets.js';
import { std } from '../../core/mats.js';
import { makeRng, clamp } from '../../core/util.js';
import { angularSpire } from './urock.js';
import { makeBeam } from '../../core/glow.js';

const P = Math.PI;

/** dome shell with a constant-width slit running horizon -> zenith -> a little past it; built from two x-patches + a back shutter */
function domeShell(r, w) {
  const Pp = [], N = [], U = [], I = []; const patch = (xa, xb, nx, pa, pb, np, flip) => {
    const base = Pp.length / 3;
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= np; j++) {
      const x = xa + (xb - xa) * (i / nx), psi = pa + (pb - pa) * (j / np); const R = Math.sqrt(Math.max(r * r - x * x, 0)); const y = R * Math.cos(psi), z = R * Math.sin(psi);
      Pp.push(x, y, z); const l = Math.hypot(x, y, z) || 1; N.push(x / l, y / l, z / l); U.push(x, psi * r);
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < np; j++) { const a = base + i * (np + 1) + j, b = a + 1, c = a + np + 1, d = c + 1; if (flip) I.push(a, b, c, b, d, c); else I.push(a, c, b, b, c, d); }
  };
  const phi0 = Math.asin(w / 2 / r); const rows = 22; const arc = (sgn) => { const base = 0; void base; };
  // right patch x from w/2 to r (param by angle so the rows bunch towards the pole), left patch mirrored
  const mk = (sgn, flip) => { const xs = []; for (let i = 0; i <= rows; i++) xs.push(sgn * r * Math.sin(phi0 + (P / 2 - phi0) * i / rows)); const np = 34; const base = Pp.length / 3;
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= np; j++) { const x = xs[i], psi = -P / 2 + P * j / np; const R = Math.sqrt(Math.max(r * r - x * x, 0)); const y = R * Math.cos(psi), z = R * Math.sin(psi); Pp.push(x, y, z); const l = Math.hypot(x, y, z) || 1; N.push(x / l, y / l, z / l); U.push(x, psi * r); }
    for (let i = 0; i < rows; i++) for (let j = 0; j < np; j++) { const a = base + i * (np + 1) + j, b = a + 1, c = a + np + 1, d = c + 1; if (flip) I.push(a, b, c, b, d, c); else I.push(a, c, b, b, c, d); } };
  mk(1, false); mk(-1, true); patch(-w / 2, w / 2, 3, -P / 2, -0.28, 12, false);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeBoundingSphere(); return g;
}

/** Observatory. Returns {dome (rotating group), doorPos, F, top} */
export function buildObservatory(ctx, B, M, halos, x, z, yaw, H) {
  const F = new Frame(B, x, z, yaw, 0); const R0 = 4.9, hDrum = 6.0; const out = { F };
  // stone terrace + drum (16 wall segments with a door gap facing -v), string course, cornice ring
  F.cyl({ p: [0, -0.5, 0], r: 8.2, h: 0.5, seg: 40, mat: M.concrete, col: 'concrete' }); F.cyl({ p: [0, 0.0, 0], r: R0 - 0.9, h: 0.06, seg: 24, mat: M.floor, col: false, cast: false });
  const seg = 16, chord = 2 * R0 * Math.sin(P / seg) + 0.12;
  for (let i = 0; i < seg; i++) { const a = i / seg * P * 2; const cx = Math.sin(a) * (R0 - 0.45), cz = -Math.cos(a) * (R0 - 0.45); const isDoor = i === 0;   // segment 0 faces -v: opening
    if (isDoor) { const yawS = a; for (const sg of [-1, 1]) F.box({ p: [cx * 1 + Math.cos(yawS) * sg * 1.05, 0, cz + Math.sin(yawS) * sg * 1.05], s: [chord / 2 - 0.65, hDrum, 0.9], yaw: -yawS, mat: M.granite, bevel: 0.03, col: 'rock' }); F.box({ p: [cx, 2.2, cz], s: [chord, hDrum - 2.2, 0.9], yaw: -a, mat: M.granite, bevel: 0.03, col: false });
      continue; }
    F.box({ p: [cx, 0, cz], s: [chord, hDrum, 0.9], yaw: -a, mat: i % 2 ? M.granite : M.graniteDark, bevel: 0.03, col: 'rock' });
    if (i % 4 === 2) { const wp = F.p(Math.sin(a) * (R0 + 0.03), 3.0, -Math.cos(a) * (R0 + 0.03)); windowQuad(B, M.winDim, wp, [Math.sin(a) * F.c - Math.cos(a) * F.s, -Math.sin(a) * F.s - Math.cos(a) * F.c], 0.9, 2.6, (i >> 2) % 4); }         // tall lit window: atlas pane in the masonry
  }
  F.cyl({ p: [0, 3.4, 0], r: R0 + 0.12, h: 0.3, seg: 32, mat: M.granite, col: false, cast: false }); F.cyl({ p: [0, hDrum - 0.1, 0], r: R0 + 0.35, h: 0.5, seg: 32, mat: M.granite, col: false }); F.cyl({ p: [0, hDrum + 0.4, 0], r: R0 + 0.4, h: 0.25, seg: 32, mat: M.snow, col: false, cast: false });
  F.cyl({ p: [0, 0, 0], r: R0 + 0.2, h: hDrum + 0.4, seg: 32, mat: M.ice, col: false, cast: false });                                                       // ice glaze over the masonry
  // door: heavy iron-strapped door leaf ajar (dark room behind), lintel + steps + iron rail
  F.box({ p: [0, 1.9, -R0 + 0.45], s: [2.3, 0.7, 1.1], mat: M.graniteDark, bevel: 0.04, col: false });
  for (const su of [-1, 1]) F.box({ p: [su * 1.3, 0, -R0 - 0.5], s: [0.16, 0.9, 1.5], mat: M.iron, col: 'metal' });
  for (let i = 0; i < 3; i++) F.box({ p: [0, 0, -R0 - 1.0 - i * 0.5], s: [2.8, 0.18 * (3 - i), 0.5], mat: M.granite, bevel: 0.02, col: 'rock' });
  // dome: rotating group (copper shell + ribs + refractor telescope)
  const dome = new THREE.Group(); const dp = F.p(0, hDrum + 0.55, 0); dome.position.set(dp[0], dp[1], dp[2]); dome.rotation.y = F.yaw; B.group.add(dome);
  const shell = new THREE.Mesh(domeShell(4.75, 1.5), M.copper); shell.castShadow = true; shell.receiveShadow = true; dome.add(shell);
  const DB = new Builder({ synth: ctx.synth, group: dome, seed: 12 }); const dm = DB.m('uCopper', M.copper), dbr = DB.m('uBrass', M.brass), dst = DB.m('uSteelP', M.steelPaint), dir = DB.m('uIron', M.iron), dgl = DB.m('uIceD', M.ice);
  for (const sg of [-1, 1]) for (let k = 0; k < 5; k++) { const xr = sg * (0.75 + k * 0.72 + (k > 2 ? 0.5 : 0)); const Rr = Math.sqrt(Math.max(4.78 * 4.78 - xr * xr, 0.01)); const pts = []; for (let j = 0; j <= 24; j++) { const psi = -P / 2 + P * j / 24; pts.push([xr, Rr * Math.cos(psi), Rr * Math.sin(psi)]); } DB.tube({ pts, r: 0.05, mat: dm, seg: 5, segs: 30, cast: false }); }
  for (const yy of [0.05, 0.9]) { const pts = []; const rr = Math.sqrt(4.8 * 4.8 - yy * yy); for (let j = 0; j <= 48; j++) { const a = j / 48 * P * 2; pts.push([Math.cos(a) * rr, yy, Math.sin(a) * rr]); } DB.tube({ pts, r: 0.09, mat: dm, seg: 6, segs: 96, closed: true, cast: false }); }
  // refractor: pier, equatorial head, tube with dew shield + objective cell, finder, counterweight
  DB.cyl({ p: [0, -0.5, -0.4], r: [0.5, 0.36], h: 1.7, seg: 14, mat: dst }); DB.box({ p: [0, 1.15, -0.4], s: [0.9, 0.5, 0.9], mat: dst, bevel: 0.05 });
  const tube = new THREE.Group(); tube.position.set(0, 1.9, -0.4); tube.rotation.x = -0.72; dome.add(tube); const TB = new Builder({ synth: ctx.synth, group: tube, seed: 13 }); const tm = TB.m('uSteelP', M.steelPaint), tb = TB.m('uBrass', M.brass), ti = TB.m('uIron', M.iron);
  TB.cyl({ p: [0, 0, 0.0], r: 0.25, h: 6.2, seg: 20, mat: tm, pitch: P / 2, anchor: 'center', cast: false }); TB.cyl({ p: [0, 0, -3.3], r: [0.34, 0.3], h: 1.2, seg: 20, mat: tm, pitch: P / 2, anchor: 'center', cast: false });
  TB.cyl({ p: [0, 0, -3.95], r: 0.36, h: 0.14, seg: 20, mat: tb, pitch: P / 2, anchor: 'center', cast: false }); TB.cyl({ p: [0, 0, -3.98], r: 0.28, h: 0.06, seg: 20, mat: TB.m('uGlowB', M.glowBlue), pitch: P / 2, anchor: 'center', cast: false });
  TB.cyl({ p: [0.36, 0.32, -1.1], r: 0.07, h: 2.2, seg: 10, mat: tm, pitch: P / 2, anchor: 'center', cast: false }); for (const zz of [-2.0, -0.3]) TB.box({ p: [0.24, 0.18, zz], s: [0.1, 0.24, 0.1], mat: ti, cast: false });
  TB.cyl({ p: [0, 0, 3.2], r: 0.3, h: 0.5, seg: 14, mat: tb, pitch: P / 2, anchor: 'center', cast: false }); TB.cyl({ p: [0, -0.5, 3.75], r: 0.4, h: 0.6, seg: 14, mat: ti, pitch: P / 2, anchor: 'center', cast: false });
  TB.finish(); DB.finish(); out.tube = tube; out.dome = dome;
  // observatory red night lamp inside the slit
  { const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), M.glowRed); lamp.position.set(0.6, 3.2, 1.2); dome.add(lamp);
    const spill = makeBeam({ length: 26, r0: 0.7, r1: 3.6, color: 0xff3020, intensity: 0.22, dust: 0.9, near: 2 }); spill.position.set(0, 4.2, 1.0); spill.lookAt(0, 4.2 + 10, 1.0 + 6); dome.add(spill); }   // red darkroom light spilling out of the open slit
  out.door = F.p(0, 0, -R0 - 0.1); out.top = hDrum + 0.55 + 4.75;
  return out;
}

/** stone annex (workshop / dormitory) with a pitched copper roof and a chimney */
export function buildAnnex(ctx, B, M, halos, F2) {
  const w = 8.6, d = 5.6, h = 3.4, t = 0.7; const out = { F: F2 };
  F2.box({ p: [0, -0.5, 0], s: [w + 1.0, 0.5, d + 1.0], mat: M.concrete, bevel: 0.03, col: 'concrete' }); F2.box({ p: [0, 0, 0], s: [w - 0.4, 0.05, d - 0.4], mat: M.floor, col: false, cast: false });
  wall(F2, 'u', -d / 2 + t / 2, -w / 2, w / 2, 0, h, t, M.granite, [{ c: -2.2, w: 1.5, y0: 0, y1: 1.9 }, { c: 1.4, w: 1.2, y0: 1.0, y1: 2.5 }], 'rock'); wall(F2, 'u', d / 2 - t / 2, -w / 2, w / 2, 0, h, t, M.granite, [{ c: 0, w: 1.2, y0: 1.0, y1: 2.5 }], 'rock');
  wall(F2, 'v', -w / 2 + t / 2, -d / 2, d / 2, 0, h, t, M.graniteDark, [], 'rock'); wall(F2, 'v', w / 2 - t / 2, -d / 2, d / 2, 0, h, t, M.graniteDark, [], 'rock');
  { const nF = [-F2.s, -F2.c], nB = [F2.s, F2.c]; windowQuad(B, M.winWarm, F2.p(1.4, 1.75, -d / 2 + 0.34), nF, 1.2, 1.5, 0); windowQuad(B, M.winWarm, F2.p(0, 1.75, d / 2 - 0.34), nB, 1.2, 1.5, 2); }
  skyOccluder(B, F2, -w / 2 - 0.5, w / 2 + 0.5, -d / 2 - 0.5, d / 2 + 0.5, h, h + 0.6); F2.prism({ p: [0, h, 0], s: [w + 1.4, 2.6, d + 1.4], mat: M.copper }); F2.prism({ p: [0, h + 0.02, 0], s: [w + 0.3, 2.3, d + 0.2], mat: M.graniteDark });
  { const RH = 2.6, hdr = (d + 1.4) / 2; roofSnow(B, M.snow, F2, { w: w + 0.4, d, ridgeY: h + RH, pitch: Math.atan2(RH, hdr), ov: 0.7, seed: 8, depth: 0.4 }); }
  F2.box({ p: [2.6, h, 0.6], s: [0.9, 4.2, 0.9], mat: M.granite, bevel: 0.03, col: false }); F2.box({ p: [2.6, h + 4.2, 0.6], s: [1.1, 0.16, 1.1], mat: M.concrete, col: false, cast: false });
  addIcicles(B, M.iceSolid, [F2.p(-w / 2 - 0.5, 0, -d / 2 - 0.55)[0], F2.p(-w / 2 - 0.5, 0, -d / 2 - 0.55)[2]], [F2.p(w / 2 + 0.5, 0, -d / 2 - 0.55)[0], F2.p(w / 2 + 0.5, 0, -d / 2 - 0.55)[2]], { every: 0.18, seed: 7, y: h + 0.02, minLen: 0.2, maxLen: 1.1 });
  out.chimney = F2.p(2.6, h + 4.4, 0.6); out.doorPos = [-2.2, -d / 2]; return out;
}

/** radio lattice mast (triangular section), guy wires, beacons, antennas, platform */
export function buildMast(ctx, B, M, far, x, z, y0, h = 30) {
  const legs = (yy) => { const r = 1.5 - 1.05 * (yy / h); return [0, 1, 2].map((k) => [x + Math.cos(k * P * 2 / 3) * r, y0 + yy, z + Math.sin(k * P * 2 / 3) * r]); };
  for (let k = 0; k < 3; k++) B.beam(legs(0)[k], legs(h)[k], 0.16, 0.16, { mat: M.steelPaint, cast: true, col: k === 0 ? false : false });
  B.colliders.addCyl({ x, z, r: 1.4, y0, y1: y0 + 12, surface: 'metal', walk: false });
  const n = Math.round(h / 2.6);
  for (let i = 0; i < n; i++) { const a = legs(i * h / n), b = legs((i + 1) * h / n); for (let k = 0; k < 3; k++) { const k2 = (k + 1) % 3; B.beam(a[k], b[k2], 0.06, 0.06, { mat: M.steel, cast: false }); B.beam(a[k2], b[k], 0.06, 0.06, { mat: M.steel, cast: false }); B.beam(b[k], b[k2], 0.06, 0.06, { mat: M.steel, cast: false }); } }
  B.box({ p: [x, y0 + h * 0.62, z], s: [3.4, 0.12, 3.4], mat: M.steel, col: false, cast: false }); B.box({ p: [x, y0 - 0.5, z], s: [4.2, 0.6, 4.2], mat: M.concrete, bevel: 0.05, col: 'concrete', walk: false });
  for (let k = 0; k < 3; k++) { const a = k * P * 2 / 3 + 0.5; B.box({ p: [x + Math.cos(a) * 1.9, y0 + h * 0.62 + 0.55, z + Math.sin(a) * 1.9], s: [0.06, 1.0, 0.06], mat: M.steel, cast: false }); }
  // antennas: yagi booms + a dish
  for (const [yy, an, l] of [[h * 0.72, 0.4, 3.2], [h * 0.82, 2.4, 2.6], [h * 0.9, 4.4, 3.0]]) { const px = x + Math.cos(an) * 1.0, pz = z + Math.sin(an) * 1.0; B.beam([px - Math.sin(an) * l / 2, y0 + yy, pz + Math.cos(an) * l / 2], [px + Math.sin(an) * l / 2, y0 + yy, pz - Math.cos(an) * l / 2], 0.05, 0.05, { mat: M.steel, cast: false }); for (let e = -2; e <= 2; e++) B.beam([px + Math.sin(an) * e * l / 5 - Math.cos(an) * 0.5, y0 + yy, pz - Math.cos(an) * e * l / 5 - Math.sin(an) * 0.5], [px + Math.sin(an) * e * l / 5 + Math.cos(an) * 0.5, y0 + yy, pz - Math.cos(an) * e * l / 5 + Math.sin(an) * 0.5], 0.02, 0.02, { mat: M.steel, cast: false }); }
  B.sphere({ p: [x + 1.6, y0 + h * 0.5, z - 0.6], r: 0.85, seg: 14, ps: 0.5, mat: M.steelPaint, pitch: -1.2, roll: 0.3, cast: false });
  // beacons (steady red) at top and mid + far glow
  const beacons = []; for (const yy of [h + 0.3, h * 0.5]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), std({ color: 0x220404, emissive: 0xff2412, emissiveIntensity: 8 })); m.position.set(x, y0 + yy, z); B.group.add(m); beacons.push(m); far.add([x, y0 + yy, z], 0xff3018, 1.8, 1.5, 2.0); }
  // guy wires from three levels to anchors on the plateau edge
  const anchors = [[x - 18, z + 3], [x + 4, z + 19], [x + 14, z - 12]]; const heightAt = (px, pz) => y0;
  for (const [ax, az] of anchors) { const gy = y0 + 0.2; B.box({ p: [ax, gy - 0.6, az], s: [1.6, 1.2, 1.6], mat: M.concrete, bevel: 0.05, col: 'concrete' }); for (const lv of [0.35, 0.65, 0.95]) { const px = x + (ax - x) * 0.02, pz = z + (az - z) * 0.02; const p0 = [px, y0 + h * lv, pz]; const p1 = [ax, gy + 0.5, az]; const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 0.4, (p0[2] + p1[2]) / 2]; B.tube({ pts: [p0, mid, p1], r: 0.014, mat: M.wire, seg: 4, segs: 10, cast: false }); } }
  void heightAt; return { beacons, top: [x, y0 + h, z] };
}

/** rime feathers: thin spikes growing INTO the wind from a set of points; dir = wind travel direction (spikes point against it) */
export function rimeFeathers(B, M, pts, wind = [0.35, 0.94], { n = 4, len = [0.25, 1.1], seed = 1 } = {}) {
  const rng = makeRng(seed); const g = new THREE.ConeGeometry(0.022, 1, 4, 1, true); g.translate(0, 0.5, 0); g.rotateX(P / 2);    // points along +z
  for (const p of pts) for (let i = 0; i < n; i++) {
    const yaw = Math.atan2(-wind[0], -wind[1]) + P + (rng() - 0.5) * 0.9; const pitch = (rng() - 0.3) * 0.5; const l = len[0] + (len[1] - len[0]) * Math.pow(rng(), 1.7);
    B.instance('rime', g, M.rimeSpike, B.matrix([p[0] + (rng() - 0.5) * 0.25, p[1] + (rng() - 0.5) * 0.25, p[2] + (rng() - 0.5) * 0.25], yaw + P, [1 + rng() * 1.5, 1 + rng() * 1.5, l], pitch, 0), 0xffffff, { cast: false });
  }
}

/** basalt crags on the summit bench rim: a big blade-like gendarme per site (angular faceted rock, urock.js) with a smaller companion, a lumpy boulder apron and talus */
export function spires(B, M, H, list, seed = 3) {
  const rng = makeRng(seed);
  for (const [x, z, hgt, r] of list) { const y = H(x, z);
    angularSpire(B, M.rock, x, y, z, { h: hgt, r: r * 1.15, sides: 8 + ((rng() * 2) | 0), rings: 6 + ((rng() * 2) | 0), lean: [(rng() - 0.5) * 0.16, (rng() - 0.5) * 0.16], twist: 0.2 + rng() * 0.6, seed: (x * 3.1 + z * 1.7) | 0, tips: 3 + ((rng() * 2) | 0), crown: 0.15 + rng() * 0.2, squash: 0.45 + rng() * 0.3, taper: 0.4 + rng() * 0.25 });
    if (rng() < 0.85) angularSpire(B, M.rock, x + (rng() - 0.5) * r * 2.6, y, z + (rng() - 0.5) * r * 2.6, { h: hgt * (0.35 + rng() * 0.3), r: r * 0.7, sides: 7, rings: 4, lean: [(rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25], seed: (x * 7 + z) | 0, tips: 2, squash: 0.6, taper: 0.35, col: false });
    for (let k = 0; k < 3; k++) { const a = rng() * 6.28, d = r * (1.2 + rng() * 1.3); B.rock({ p: [x + Math.cos(a) * d, y + 0.1, z + Math.sin(a) * d], r: r * (0.22 + rng() * 0.3), squash: [1.3, 0.6, 1], amp: 0.5, seed: 90 + ((x * 3 + z + k) | 0) % 9, detail: 2, mat: M.rock, col: false, cast: true }); }
  }
}
