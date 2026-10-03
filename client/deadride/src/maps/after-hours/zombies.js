// AFTER HOURS — the park's undead: eight costumed variants built with the Outfit API (src/game/zombies/README.md).
// Silhouettes read from 10 m: guest (souvenir ears + balloon), staff (boater / pith helmet), usher (peaked cap + swinging torch beam), clown (wig, ruff, giant shoes),
// and four mascot suits with hand-built oversized heads: sun (ray crown), rocket (nose-cone helmet + fins, glowing visor), ghost (bed sheet), parrot (hooked beak + crest).
import * as THREE from 'three';
import { registerVariants } from '../../game/zombies/factory.js';
import '../../game/zombies/gear.js';                       // installs o.beanie / o.belt / o.neckerchief … on the Outfit
import { BI, RIG, HEAD_CENTER, restAt } from '../../game/zombies/rig.js';

const V = THREE.Vector3, PI = Math.PI, TAU = PI * 2, HC = HEAD_CENTER, UP = new V(0, 1, 0);

// ------------------------------------------------------------------ small construction kit (all positions are rest model space, facing -Z)
/** fist centre + hand axes of a side ('L' | 'R'): h along the hand, p palm normal, t thumb side (forward-up when the arm hangs) */
const grip = (side) => { const A = RIG.arm[side]; const h = new V(...A.h), p = new V(...A.p), t = new V(...A.t), w = new V(...A.wr); return { c: w.clone().addScaledVector(h, 0.068).addScaledVector(p, 0.026), h, p, t }; };
/** quaternion whose local +Y is `dir` and whose local +X is as close to `side` as possible */
const orient = (dir, side = new V(1, 0, 0)) => { const y = dir.clone().normalize(); const x = side.clone().addScaledVector(y, -side.dot(y)); if (x.lengthSq() < 1e-6) { x.set(0, 0, 1); x.addScaledVector(y, -y.z); } x.normalize(); const z = new V().crossVectors(x, y); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); };
/** flat ellipsoid blade (feather, ray, fin) from point a along dir: length len, half-width w, half-thickness th */
const blade = (o, bone, a, dir, len, w, th, mat, side, seg = 10) => { const d = dir.clone().normalize(); o.parts.sphere({ bone, p: [a.x + d.x * len / 2, a.y + d.y * len / 2, a.z + d.z * len / 2], scale: [w, len / 2, th], rot: orient(d, side), seg, ...mat }); };
/** star polygon (CCW) with n points */
const star = (n, r0, r1, phase = 0) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = phase + (i / (n * 2)) * TAU; pts.push([Math.cos(a) * (i % 2 ? r0 : r1), Math.sin(a) * (i % 2 ? r0 : r1)]); } return pts; };
/** star with per-ray outer radii (broken rays are short): lens[i] multiplies r1 */
const starIrr = (n, r0, r1, lens) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU; const r = i % 2 ? r0 : r1 * lens[(i >> 1) % lens.length]; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } return pts; };
/** outermost surface point in front of (x, y) on the head/torso (z of the clothed body), so decals sit on the skin / cloth instead of floating */
const front = (o, x, y, z0 = -0.4) => o.snap([x, y, z0], [0, 0, 1], -z0 - 0.1, 0.02, 0.5);
/** headband-style arc of the head's outline in the XY plane (ear to ear over the crown) */
const crownArc = (rx, ry, cz, a0 = 0.12, a1 = PI - 0.12, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return new V(Math.cos(a) * rx, HC.y + Math.sin(a) * ry, cz); });
const SUN_PROFILE = [[0.001, -0.09], [0.2, -0.085], [0.29, -0.05], [0.31, 0.0], [0.28, 0.04], [0.18, 0.07], [0.001, 0.085]];   // sun face-disc profile (r, y) — +y is the direction the face looks
/** make an outline counter-clockwise (the extruder assumes CCW) */
const ccw = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; } return a < 0 ? pts.slice().reverse() : pts; };

// ------------------------------------------------------------------ 1. Park Guest — casual wear, souvenir ears or sun visor, face paint, balloon, candy floss
const GUEST = {
  id: 'guest', name: 'Park Guest', looks: 2, height: [1.55, 1.9], hp: 1,
  body: { gaunt: 0.3, girthRange: [0.95, 1.2] }, skin: { tint: [1.0, 0.97, 0.94], variation: 0.14 },
  layers: { blood: 0.65 }, eyes: { glow: 0, cataract: 0.75 }, hair: { color: 0x3a2818, amount: 0.8, beard: 0.15, hairline: 0.3 },
  speedClasses: { walk: 1.2, run: 1, sprint: 0.7 }, voice: { kind: 'guest', f0: [115, 235], formants: [640, 1200, 2600], rasp: 0.4, wet: 0.3, muffle: 0 },
  balloon: { hand: 'L', color: 0xff4fa8, length: 1.15, r: 0.17 }, arms: { reach: 0.55 }, idiosyncrasy: { limpChance: 0.3, hunch: [0.05, 0.3] },
  build(o, rng, look) {
    o.body({ skin: look ? 0x86887a : 0x7c8074, girth: 1.04, belly: 0.25, gaunt: 0.3, decay: 0.55, dirt: 0.5, face: { gaunt: 0.4, bloat: 0.15 } });
    const shirt = look ? 0xff8a3a : 0x1fb5b0, pants = look ? 0xc9b98a : 0x4a6a9a;
    if (look) { o.garment('shirt', { color: 0xff8a3a, pattern: 'check', dirt: 0.6, wear: 0.7, sleeve: 4, vneck: 0.05 }); o.garment('pants', { color: pants, pattern: 'canvas', dirt: 0.65, wear: 0.6, hem: 6, detail: 8 }); }
    else { o.garment('tshirt', { color: shirt, pattern: 'knit', dirt: 0.55, wear: 0.65 }); o.garment('shorts', { color: pants, pattern: 'denim', dirt: 0.6, wear: 0.6, detail: 8 }); }
    o.garment('socks', { color: 0xeeeeea, dirt: 0.5 });
    o.garment('boots', { color: look ? 0xf0f0ec : 0x22a0d8, mat: 'rubber', height: 8, dirt: 0.55, wear: 0.5, soleColor: 0xf2f2ee });   // sneakers
    // souvenir gear: mouse-ear headband (look 0) or sun visor (look 1)
    if (!look) {
      const c = 0xff4fa8;
      o.parts.tube(crownArc(0.094, 0.122, HC.z + 0.004), 0.0055, { mat: 'plastic', color: 0x1a1a1e, rough: 0.4 }, { bone: 'head', seg: 6, sub: 1, caps: true });
      for (const sx of [-1, 1]) o.parts.sphere({ bone: 'head', p: [sx * 0.062, HC.y + 0.118, HC.z - 0.004], scale: [0.058, 0.058, 0.012], rot: [-0.25, sx * 0.3, sx * -0.35], seg: 14, mat: 'plastic', color: c, rough: 0.35, wear: 0.5, dirt: 0.5, param: 0.3 });
    } else {
      o.parts.band({ y: HC.y + 0.055, height: 0.028, thick: 0.004, lift: 0.004, center: [0, HC.z + 0.012], seg: 26, mat: 'plastic', color: 0xf4f4f0, rough: 0.5, tilt: 0.02 });
      o.parts.lathe({ bone: 'head', p: [0, HC.y + 0.055, HC.z + 0.008], profile: [[0.095, 0.0], [0.16, 0.014], [0.165, 0.018], [0.095, 0.014]], arc: 2.3, arc0: -PI / 2 - 1.15, seg: 22, double: true, mat: 'plastic', color: 0x2ab8e8, rough: 0.4, wear: 0.4, dirt: 0.5 });
    }
    // star face paint on both cheeks
    o.parts.custom((o) => { for (const sx of [-1, 1]) { const p = front(o, sx * 0.054, HC.y - 0.02); o._extrude({ bone: 'head', p: [p.x, p.y, p.z - 0.0015], outline: star(5, 0.009, 0.022, sx * 0.3), depth: 0.003, mat: 'plastic', color: sx > 0 ? 0xff4fa8 : 0x40d8ff, rough: 0.5 }); } });
    // chest print (sun badge) snapped onto the shirt
    o.parts.custom((o) => { const p = front(o, 0.02, 1.29); o._extrude({ bind: 'auto', p: [p.x, p.y, p.z - 0.002], outline: star(9, 0.016, 0.036), depth: 0.003, mat: 'cloth', color: 0xffd83a, dirt: 0.4 }); });
    if (look) {   // camera on a neck strap
      o.parts.tube([new V(-0.085, 1.475, -0.01), new V(-0.06, 1.4, -0.1), new V(-0.03, 1.315, -0.125)], 0.005, { mat: 'rubber', color: 0x14141a, rough: 0.7 }, { bone: 'chest', seg: 5, sub: 2 });
      o.parts.tube([new V(0.085, 1.475, -0.01), new V(0.06, 1.4, -0.1), new V(0.03, 1.315, -0.125)], 0.005, { mat: 'rubber', color: 0x14141a, rough: 0.7 }, { bone: 'chest', seg: 5, sub: 2 });
      o.parts.box({ bone: 'chest', p: [0, 1.29, -0.15], s: [0.115, 0.072, 0.06], mat: 'plastic', color: 0x22242a, rough: 0.35, wear: 0.5, dirt: 0.5, bevel: 0.008 });
      o.parts.lathe({ bone: 'chest', p: [0.008, 1.29, -0.18], rot: [-PI / 2, 0, 0], profile: [[0.001, 0.0], [0.024, 0.0], [0.026, 0.02], [0.02, 0.03], [0.001, 0.03]], seg: 12, mat: 'metal', color: 0x14141a, rough: 0.3 });
      o.belt({ y: 0.985, color: 0x3a2a1c, buckle: false }); o.parts.box({ bone: 'pelvis', p: [0.0, 0.97, -0.115], s: [0.2, 0.1, 0.075], mat: 'cloth', pattern: 'ripstop', color: 0x2a4a3a, dirt: 0.5, wear: 0.4, bevel: 0.012 }); }   // camera + fanny pack
    else {   // candy floss on a paper cone in the right hand
      const g = grip('R'), ax = g.t.clone().multiplyScalar(0.55).add(new V(0, 0.85, -0.1)).normalize(), b = g.c.clone().addScaledVector(ax, -0.09), tip = g.c.clone().addScaledVector(ax, 0.2);
      o.parts.capsuleBetween(b, tip, 0.008, 0.0125, { mat: 'rope', color: 0xe8e0d0, rough: 0.9 }, { bone: 'hand.R', rigid: true, seg: 8 });
      o.parts.sphere({ bone: 'hand.R', p: [tip.x + ax.x * 0.07, tip.y + ax.y * 0.07, tip.z + ax.z * 0.07], scale: [0.085, 0.095, 0.085], seg: 14, mat: 'fur', pattern: 'plush', color: 0xff8ac8, rough: 1, dirt: 0.35 });
    }
  },
};

// ------------------------------------------------------------------ 2. Park Staff — vest, name badge, keys, radio, straw boater or pith helmet
const STAFF = {
  id: 'staff', name: 'Park Staff', looks: 2, height: [1.64, 1.9], hp: 1.05,
  body: { gaunt: 0.35, girthRange: [0.96, 1.12] }, skin: { tint: [1.0, 0.98, 0.95], variation: 0.1 },
  layers: { blood: 0.6, dust: 0.1 }, eyes: { glow: 0, cataract: 0.8 }, hair: { color: 0x2a2018, amount: 0.7, beard: 0.4, hairline: 0.5 },
  speedClasses: { walk: 1, run: 1.1, sprint: 0.8 }, voice: { kind: 'male', f0: [95, 140], formants: [590, 1120, 2500], rasp: 0.5, wet: 0.25, muffle: 0 },
  arms: { reach: 0.4 }, helmetY: 1.78, helmetSurface: 'plastic', idiosyncrasy: { limpChance: 0.2, hunch: [0.1, 0.35] },
  build(o, rng, look) {
    o.body({ skin: 0x767a6c, girth: 1.02, gaunt: 0.35, belly: 0.15, decay: 0.6, dirt: 0.55, face: { gaunt: 0.5, jaw: 0.1 } });
    o.garment('shirt', { color: 0xe8e4d8, pattern: 'weave', dirt: 0.7, wear: 0.65, sleeve: 4, collar: 'fold' });
    o.garment('pants', { color: look ? 0x2a2f3a : 0x36302a, pattern: 'canvas', dirt: 0.55, wear: 0.5, detail: 8 });
    o.garment('vest', { color: look ? 0x7a1a24 : 0x1d7a78, pattern: 'weave', dirt: 0.6, wear: 0.65, offset: 0.024 });
    o.garment('boots', { color: 0x1a1612, dirt: 0.6, height: 6 });
    o.belt({ y: 0.99, color: 0x2a1c12 }); o.neckerchief({ color: look ? 0xe0b030 : 0xb82a2a });
    // name badge on the vest + key ring and walkie-talkie on the belt
    o.parts.custom((o) => { const p = o.snap([-0.09, 1.31, 0.02], [0, 0, -1], 0.13); o._box({ bind: 'auto', p: [p.x, p.y, p.z - 0.003], s: [0.075, 0.028, 0.004], mat: 'plastic', color: 0xf0ead0, wear: 0.4, dirt: 0.5 }); o._box({ bind: 'auto', p: [p.x, p.y + 0.004, p.z - 0.0055], s: [0.06, 0.008, 0.002], mat: 'plastic', color: 0xb82a2a }); });
    o.parts.torusRing({ bone: 'pelvis', p: [-0.16, 0.93, -0.06], R: 0.018, r: 0.003, rot: [PI / 2, 0.4, 0], seg: 10, tseg: 4, mat: 'metal', color: 0xb0a890, rough: 0.35 });
    o.parts.box({ bone: 'pelvis', p: [-0.165, 0.895, -0.062], s: [0.008, 0.045, 0.018], mat: 'metal', color: 0xb0a890, rough: 0.35 });
    o.parts.box({ bone: 'pelvis', p: [0.15, 0.985, -0.05], s: [0.05, 0.13, 0.03], rot: [0, -0.2, 0], mat: 'plastic', color: 0x1e1e22, rough: 0.5, dirt: 0.6, wear: 0.5, bevel: 0.006 });
    o.parts.capsuleBetween(new V(0.155, 1.05, -0.05), new V(0.16, 1.14, -0.05), 0.004, 0.003, { mat: 'rubber', color: 0x101010 }, { bone: 'pelvis', rigid: true, seg: 5, caps: true });
    if (!look) {   // vendor tray on a neck strap (candy floss + popcorn): a wide horizontal plate at waist height is the staff's silhouette
      const ty = 1.06, tz = -0.31;
      o.parts.box({ bone: 'chest', p: [0, ty, tz], s: [0.56, 0.028, 0.32], rot: [0.06, 0, 0], mat: 'plastic', color: 0xe9e2cf, rough: 0.45, wear: 0.5, dirt: 0.6, bevel: 0.006 });
      for (const [x, z, sx, sz] of [[0, tz - 0.16, 0.56, 0.02], [0, tz + 0.16, 0.56, 0.02], [-0.28, tz, 0.02, 0.32], [0.28, tz, 0.02, 0.32]]) o.parts.box({ bone: 'chest', p: [x, ty + 0.024, z], s: [sx, 0.024, sz], rot: [0.06, 0, 0], mat: 'plastic', color: 0xb82a2a, rough: 0.45, dirt: 0.5 });
      for (const sx of [-1, 1]) o.parts.tube([new V(sx * 0.1, 1.48, -0.03), new V(sx * 0.15, 1.3, -0.13), new V(sx * 0.25, 1.12, -0.44), new V(sx * 0.27, ty + 0.01, -0.46)], 0.0065, { mat: 'rubber', color: 0x3a2a1c, rough: 0.7 }, { bone: 'chest', seg: 5, sub: 2 });
      [[-0.16, 0xd82828], [0.02, 0xf0e8d0], [0.18, 0xd82828]].forEach(([x, col], i) => { o.parts.box({ bone: 'chest', p: [x, ty + 0.085, tz + 0.03], s: [0.1, 0.13, 0.085], rot: [0.06, 0, 0], mat: 'cloth', pattern: 'stripes', color: col, rough: 0.8, dirt: 0.5, wear: 0.4 }); o.parts.sphere({ bone: 'chest', p: [x, ty + 0.17, tz + 0.03], scale: [0.058, 0.04, 0.05], seg: 10, mat: 'fur', pattern: 'plush', color: i === 1 ? 0xff9ad0 : 0xf5e8b8, rough: 1, dirt: 0.4 }); });
    } else {   // tour-guide megaphone in the right hand (forward-pointing cone: reads as an arm silhouette)
      const g = grip('R'), a = g.h.clone().multiplyScalar(0.72).addScaledVector(g.t, 0.69).normalize(), b = g.c.clone().addScaledVector(a, -0.02), q = orient(a);
      o.parts.lathe({ bone: 'hand.R', p: [b.x, b.y, b.z], rot: q, profile: [[0.028, 0.0], [0.04, 0.05], [0.085, 0.18], [0.135, 0.34], [0.14, 0.352]], seg: 18, double: true, mat: 'plastic', color: 0xe2dccb, rough: 0.4, wear: 0.5, dirt: 0.6 });
      o.parts.torusRing({ bone: 'hand.R', p: [b.x + a.x * 0.33, b.y + a.y * 0.33, b.z + a.z * 0.33], R: 0.138, r: 0.0085, rot: q, seg: 18, tseg: 4, mat: 'plastic', color: 0xc42d33, rough: 0.4 });
      o.parts.capsuleBetween(b.clone().addScaledVector(a, -0.05), b.clone().addScaledVector(g.p, -0.09).addScaledVector(a, 0.02), 0.018, 0.016, { mat: 'plastic', color: 0x202226, rough: 0.5, dirt: 0.5 }, { bone: 'hand.R', rigid: true, seg: 8 });
    }
    if (!look) {   // straw boater: flat crown, wide flat brim, band
      const c = [0, HC.y + 0.03, HC.z + 0.006], straw = { mat: 'cloth', pattern: 'weave', color: 0xd8c078, rough: 0.9, dirt: 0.5, wear: 0.45 };
      o.parts.lathe({ bone: 'head', p: c, profile: [[0.092, 0.0], [0.094, 0.05], [0.091, 0.088], [0.05, 0.092], [0.001, 0.092]], scale: [0.88, 1.08], seg: 26, ...straw });
      o.parts.lathe({ bone: 'head', p: [c[0], c[1] + 0.002, c[2]], profile: [[0.085, -0.002], [0.16, -0.004], [0.166, 0.004], [0.16, 0.009], [0.085, 0.008]], scale: [0.92, 1.06], seg: 28, double: true, ...straw });
      o.parts.torusRing({ bone: 'head', p: [c[0], c[1] + 0.02, c[2]], R: 0.092, r: 0.0085, scale: [0.88, 1.08], seg: 26, tseg: 5, flat: 1.4, mat: 'cloth', pattern: 'stripes', color: 0xb82a2a, rough: 0.7 });
    } else {   // pith helmet: white dome, sloping brim, pugaree band, top button
      const c = [0, HC.y + 0.01, HC.z + 0.008], wh = { mat: 'cloth', pattern: 'canvas', color: 0xe8e2cc, rough: 0.85, dirt: 0.5, wear: 0.4 };
      const prof = []; for (let i = 0; i <= 10; i++) { const a = (i / 10) * PI / 2; prof.push([Math.max(0.002, Math.cos(a) * 0.118), Math.sin(a) * 0.13 + 0.015]); }
      o.parts.lathe({ bone: 'head', p: c, profile: prof, scale: [0.9, 1.08], seg: 28, ...wh });
      o.parts.lathe({ bone: 'head', p: [c[0], c[1], c[2]], profile: [[0.108, 0.02], [0.17, -0.02], [0.18, -0.016], [0.17, -0.012], [0.11, 0.028]], scale: [0.96, 1.1], seg: 28, double: true, ...wh });
      o.parts.torusRing({ bone: 'head', p: [c[0], c[1] + 0.028, c[2]], R: 0.116, r: 0.012, scale: [0.9, 1.08], seg: 26, tseg: 5, flat: 1.3, mat: 'cloth', pattern: 'stripes', color: 0x7a5a2a, rough: 0.8 });
      o.parts.sphere({ bone: 'head', p: [c[0], c[1] + 0.148, c[2]], r: 0.014, seg: 8, mat: 'metal', color: 0xb0a070, rough: 0.4 });
    }
  },
};

// ------------------------------------------------------------------ 3. Usher — braided frock coat, peaked cap, white gloves, torch (real swinging beam)
const USHER_TORCH = (() => { const g = grip('R'), t = g.t.clone().normalize(), tip = g.c.clone().addScaledVector(t, 0.2); return { bone: 'hand.R', pos: [tip.x, tip.y, tip.z], dir: [t.x, t.y, t.z] }; })();
const USHER = {
  id: 'usher', name: 'Usher', looks: 2, height: [1.72, 1.94], hp: 1.15,
  body: { gaunt: 0.5, girthRange: [0.92, 1.02] }, skin: { tint: [0.96, 0.98, 1.0], variation: 0.1 },
  layers: { blood: 0.55, dust: 0.15 }, eyes: { glow: 0, cataract: 0.9 }, hair: { color: 0x141210, amount: 0.6, beard: 0.1, hairline: 0.6 },
  speedClasses: { walk: 1.4, run: 0.8, sprint: 0.4 }, voice: { kind: 'guard', f0: [80, 125], formants: [520, 1000, 2350], rasp: 0.6, wet: 0.2, muffle: 0.1 },
  lamp: { ...USHER_TORCH, color: 0xfff0d8, intensity: 24, range: 15 }, emissiveColor: 0xfff0d8, arms: { reach: 0.2 }, helmetY: 1.77, helmetSurface: 'plastic', idiosyncrasy: { limpChance: 0.15, hunch: [0.02, 0.15] },
  build(o, rng, look) {
    o.body({ skin: 0x707468, girth: 0.96, gaunt: 0.5, decay: 0.6, dirt: 0.5, face: { gaunt: 0.75 } });
    const coat = look ? 0x1a2444 : 0x6a1420, braid = look ? 0xc0c8d0 : 0xd4b04a;
    o.garment('pants', { color: 0x14141a, pattern: 'weave', dirt: 0.5, wear: 0.4, detail: 8 });
    o.garment('jacket', { color: coat, pattern: 'weave', dirt: 0.6, wear: 0.65, offset: 0.028, loose: 0.014, collar: 'stand', collarHeight: 0.07, detail: 1 | 4 });
    o.garment('boots', { color: 0x0e0e10, mat: 'leather', dirt: 0.5, height: 5 }); o.garment('gloves', { color: 0xe8e4dc, mat: 'leather', dirt: 0.55, wear: 0.4 });
    // coat skirt (flared frock) hugging the pelvis + thighs
    o.parts.lathe({ bind: 'auto', p: [0, 1.03, 0.012], profile: [[0.27, -0.56], [0.275, -0.52], [0.235, -0.28], [0.19, -0.1], [0.165, 0.0]], scale: [1.0, 0.9], seg: 28, double: true, mat: 'cloth', pattern: 'weave', color: coat, rough: 0.85, dirt: 0.5, wear: 0.55, sway: 0.3 });
    o.parts.torusRing({ bind: 'auto', p: [0, 0.49, 0.012], R: 0.272, r: 0.007, scale: [1, 1], seg: 28, tseg: 4, flat: 1, mat: 'metal', color: braid, rough: 0.3, metal: 1 });   // gold hem braid
    // braid: epaulettes + a gold aiguillette across the chest + a shoulder sash button row
    for (const sx of [-1, 1]) o.parts.box({ bone: 'chest', p: [sx * 0.168, 1.448, 0.012], s: [0.105, 0.012, 0.055], rot: [0, 0, sx * 0.24], mat: 'metal', color: braid, rough: 0.35, metal: 1, bevel: 0.003 });
    o.parts.strap([[0.135, 1.435, -0.03], [0.1, 1.36, -0.1], [0.045, 1.26, -0.125], [-0.02, 1.17, -0.115]], 0.014, 0.004, { mat: 'metal', color: braid, rough: 0.3, metal: 1 }, { lift: 0.005 });
    o.parts.strap([[-0.135, 1.435, -0.03], [-0.1, 1.36, -0.1], [-0.045, 1.26, -0.125], [-0.02, 1.17, -0.115]], 0.014, 0.004, { mat: 'metal', color: braid, rough: 0.3, metal: 1 }, { lift: 0.005 });
    // peaked cap: tall flared crown, gold band, glossy visor, badge
    const c = [0, HC.y + 0.03, HC.z + 0.006], cap = { mat: 'cloth', pattern: 'weave', color: coat, rough: 0.85, dirt: 0.45, wear: 0.45 };
    o.parts.lathe({ bone: 'head', p: c, profile: [[0.1, 0.0], [0.103, 0.035], [0.118, 0.075], [0.128, 0.09], [0.1, 0.098], [0.001, 0.1]], scale: [0.9, 1.1], seg: 26, ...cap });
    o.parts.torusRing({ bone: 'head', p: [c[0], c[1] + 0.018, c[2]], R: 0.104, r: 0.0065, scale: [0.9, 1.1], seg: 26, tseg: 4, mat: 'metal', color: braid, rough: 0.3, metal: 1 });
    o.parts.lathe({ bone: 'head', p: [c[0], c[1] + 0.006, c[2]], profile: [[0.1, 0.0], [0.17, -0.02], [0.176, -0.016], [0.1, 0.006]], scale: [0.94, 1.08], arc: 2.4, arc0: -PI / 2 - 1.2, seg: 22, double: true, mat: 'plastic', color: 0x0c0c0e, rough: 0.2 });
    o.parts.sphere({ bone: 'head', p: [0, c[1] + 0.05, c[2] - 0.117], scale: [0.022, 0.022, 0.006], seg: 10, mat: 'metal', color: braid, rough: 0.3, metal: 1 });
    // the torch: 22 cm barrel with a flared head and a glowing lens (the variant `lamp` casts a real beam from the hand)
    const g = grip('R'), t = g.t.clone().normalize(), a = g.c.clone().addScaledVector(t, -0.06), b = g.c.clone().addScaledVector(t, 0.13), lens = g.c.clone().addScaledVector(t, 0.2);
    o.parts.capsuleBetween(a, b, 0.021, 0.024, { mat: 'metal', color: 0x1e1e22, rough: 0.35, wear: 0.4, dirt: 0.5 }, { bone: 'hand.R', rigid: true, seg: 10, rings: 2 });
    o.parts.lathe({ bone: 'hand.R', p: [b.x, b.y, b.z], profile: [[0.024, 0.0], [0.036, 0.03], [0.038, 0.062], [0.03, 0.066], [0.001, 0.066]], rot: orient(t), seg: 16, mat: 'metal', color: 0x2c2c30, rough: 0.3, wear: 0.5 });
    o.parts.lathe({ bone: 'hand.R', p: [lens.x - t.x * 0.004, lens.y - t.y * 0.004, lens.z - t.z * 0.004], profile: [[0.001, 0.0], [0.031, 0.0], [0.0305, 0.004]], rot: orient(t), seg: 16, mat: 'emissive', color: 0xfff2d8, emissive: 10 });
  },
};

// ------------------------------------------------------------------ 4. Clown — tufted wig, ruff, gingham baggy suit, pompoms, painted smile, giant shoes, balloon
const CLOWN = {
  id: 'clown', name: 'Clown', looks: 2, height: [1.62, 1.86], hp: 1.1,
  body: { gaunt: 0.2, girthRange: [1.0, 1.16] }, skin: { tint: [1, 1, 1], variation: 0.06 },
  layers: { blood: 0.6 }, eyes: { glow: 0, cataract: 0.4 }, hair: { color: 0x1a1512, amount: 0.05, bald: 1, beard: 0, brows: 0 },
  speedClasses: { walk: 0.8, run: 1.3, sprint: 1.3 }, voice: { kind: 'clown', f0: [165, 300], formants: [700, 1350, 2800], rasp: 0.45, wet: 0.35, muffle: 0.1 },
  balloon: { hand: 'R', color: 0xffd020, length: 1.35, r: 0.18 }, arms: { reach: 0.25 }, idiosyncrasy: { limpChance: 0.25, hunch: [0.02, 0.2], tilt: 0.7 },
  build(o, rng, look) {
    o.body({ skin: 0xdcd8cc, girth: 1.06, gaunt: 0.2, decay: 0.4, dirt: 0.55, face: { gaunt: 0.35, lipsGone: 0.3 } });
    const c1 = look ? 0x2a9de0 : 0xe0388a, c2 = look ? 0xf4c020 : 0x42b07a, wig = look ? 0x36c060 : 0xff7a1a;
    o.garment('coveralls', { color: c1, pattern: 'check', dirt: 0.7, wear: 0.6, offset: 0.05, loose: 0.05, sleeve: 6 });
    o.garment('gloves', { color: 0xf4f0e8, mat: 'cloth', dirt: 0.5, wear: 0.4 });
    // giant shoes (rigid on the feet): long ellipsoid + toe cap + big pompom
    for (const s of ['L', 'R']) { const f = s === 'L' ? -1 : 1, bn = 'foot.' + s;
      o.parts.sphere({ bone: bn, p: [f * 0.108, 0.058, -0.075], scale: [0.078, 0.062, 0.22], seg: 16, mat: 'rubber', color: c2, rough: 0.35, dirt: 0.55, wear: 0.5 });
      o.parts.sphere({ bone: bn, p: [f * 0.108, 0.072, -0.245], scale: [0.062, 0.05, 0.075], seg: 12, mat: 'rubber', color: 0xd82a2a, rough: 0.3, dirt: 0.5 });
      o.parts.sphere({ bone: bn, p: [f * 0.108, 0.135, -0.02], r: 0.024, seg: 8, mat: 'fur', pattern: 'plush', color: 0xf4f0e8, rough: 1 });
    }
    // ruff collar: two frilly rings
    for (const [dy, R, col] of [[0, 0.118, 0xf4f0e8], [-0.024, 0.132, c2]]) o.parts.torusRing({ bone: 'neck', p: [0, 1.5 + dy, 0.03], R, r: 0.03, rot: [0.12, 0, 0], seg: 22, tseg: 6, flat: 1.2, mat: 'cloth', pattern: 'knit', color: col, rough: 0.9, dirt: 0.4, wear: 0.3 });
    // wig: tufts left / right and a top knot
    for (const [x, y, z, r] of [[-0.13, 0.03, 0.02, 0.078], [0.13, 0.03, 0.02, 0.078], [-0.115, 0.108, 0.02, 0.06], [0.115, 0.108, 0.02, 0.06], [0, 0.128, 0.0, 0.05], [-0.128, -0.04, 0.03, 0.05], [0.128, -0.04, 0.03, 0.05]]) o.parts.sphere({ bone: 'head', p: [x, HC.y + y, HC.z + z], r, seg: 12, mat: 'fur', pattern: 'plush', color: wig, rough: 1, dirt: 0.3, wear: 0.3 });
    // face paint: red nose, red smile, blue diamond eyes
    o.parts.custom((o) => {
      const n = front(o, 0, HC.y - 0.025); o._sphere({ bone: 'head', p: [n.x, n.y, n.z + 0.004], r: 0.03, seg: 12, mat: 'plastic', color: 0xd82020, rough: 0.3 });
      const pts = []; for (let i = 0; i <= 12; i++) { const x = -0.068 + 0.136 * i / 12, p = front(o, x, HC.y - 0.068 - 0.03 * (1 - Math.pow(x / 0.068, 2))); pts.push(new V(x, p.y, p.z - 0.002)); }
      o._tubeRaw(pts, pts.map(() => 0.0055), o._spec({ mat: 'plastic', color: 0xc41818, rough: 0.35 }), { bone: 'head', seg: 5, sub: 1, weights: 'head' });
      for (const sx of [-1, 1]) { const p = front(o, sx * 0.038, HC.y + 0.014); o._extrude({ bone: 'head', p: [p.x, p.y, p.z - 0.0015], outline: [[0, 0.03], [0.014, 0], [0, -0.03], [-0.014, 0]], depth: 0.003, mat: 'plastic', color: 0x2a70d8, rough: 0.4 }); }
    });
    // pompoms down the front
    o.parts.custom((o) => { for (const y of [1.3, 1.16, 1.02]) { const p = front(o, 0, y); o._sphere({ bind: 'auto', p: [p.x, p.y, p.z - 0.018], r: 0.03, seg: 10, mat: 'fur', pattern: 'plush', color: c2, rough: 1 }); } });
  },
};

// ------------------------------------------------------------------ mascot suits: plush bodies + hand-built oversized heads (o.parts.*), hit sphere enlarged via hitHeadR / hitHeadDY
const plush = (color, extra = {}) => ({ mat: 'fur', pattern: 'plush', color, offset: 0.034, loose: 0.02, dirt: 0.7, wear: 0.7, ...extra });
const shell = (color, extra = {}) => ({ mat: 'plastic', color, rough: 0.45, wear: 0.5, dirt: 0.65, param: 0.4, ...extra });
const neckCollar = (o, color, bone = 'neck') => o.parts.torusRing({ bone, p: [0, 1.5, 0.034], R: 0.128, r: 0.024, rot: [0.1, 0, 0], seg: 22, tseg: 6, weights: { neck: 0.6, head: 0.4 }, mat: 'fur', pattern: 'plush', color, rough: 1, dirt: 0.5 });

// 5. Sunny the Sun — flat face-disc with a 14-ray crown
const SUN_CY = HC.y + 0.17, SUN_FZ = HC.z - 0.09;
const sunDomeZ = (r) => { const pr = SUN_PROFILE.slice(3); let y = pr[pr.length - 1][1]; for (let i = 0; i < pr.length - 1; i++) if (r <= pr[i][0] && r >= pr[i + 1][0]) { const t = (pr[i][0] - r) / (pr[i][0] - pr[i + 1][0]); y = pr[i][1] + t * (pr[i + 1][1] - pr[i][1]); break; } return SUN_FZ - y; };   // z of the front dome at radius r
const MASCOT_SUN = {
  id: 'mascot_sun', name: 'Sunny', looks: 2, height: [1.66, 1.9], hp: 1.45,
  body: { gaunt: 0.15, girthRange: [1.0, 1.14] }, skin: { tint: [1, 0.95, 0.9] }, layers: { blood: 0.6, dust: 0.1 }, eyes: { glow: 0, cataract: 0.9 }, hair: { color: 0x2a1c14, amount: 0.2, bald: 1 },
  speedClasses: { walk: 1.3, run: 0.9, sprint: 0.4 }, voice: { kind: 'mascot', f0: [180, 280], formants: [560, 1150, 2600], rasp: 0.5, wet: 0.3, muffle: 0.75 },
  hitHeadR: 0.33, hitHeadDY: 0.17, arms: { reach: 0.4 }, idiosyncrasy: { limpChance: 0.3, hunch: [0.02, 0.12], tilt: 0.5 },
  build(o, rng, look) {
    o.body({ skin: 0x80806e });
    const fur = look ? 0xff6a2a : 0xffae1c, rays = look ? 0xe83a1a : 0xff8a1c, disc = look ? 0xffc040 : 0xffd83a;
    o.garment('coveralls', plush(fur)); o.garment('mittens', plush(0xfff0d8, { offset: 0.022 })); o.garment('boots', plush(look ? 0xd83a1a : 0xe07a18, { offset: 0.03, loose: 0.03, height: 7 }));
    neckCollar(o, fur);
    const lens = Array.from({ length: 14 }, (_, i) => (i === 3 || i === 9) ? 0.62 : 0.85 + rng() * 0.15);   // two broken rays
    o.parts.extrudeOutline({ bone: 'head', p: [0, SUN_CY, HC.z + 0.03], outline: starIrr(14, 0.29, 0.53, lens), depth: 0.06, ...shell(rays, { param: 0.18 }) });          // the ray crown
    o.parts.lathe({ bone: 'head', p: [0, SUN_CY, SUN_FZ], rot: [-PI / 2, 0, 0], profile: SUN_PROFILE, seg: 34, ...shell(disc, { param: 0.42 }) });                     // the face disc (looks toward -Z)
    o.parts.sphere({ bone: 'head', p: [0, SUN_CY - 0.05, HC.z + 0.05], scale: [0.2, 0.22, 0.17], seg: 16, mat: 'fur', pattern: 'plush', color: fur, rough: 1, dirt: 0.5 });   // plush back of the head
    for (const sx of [-1, 1]) {   // big black eyes with highlights, rosy cheeks — the character's right eye hangs out of its socket on a thread
      const ex = sx * 0.1, ey = SUN_CY + 0.07, ez = sunDomeZ(Math.hypot(ex, 0.07));
      if (sx > 0) {
        o.parts.sphere({ bone: 'head', p: [ex, ey, ez - 0.002], scale: [0.05, 0.072, 0.02], seg: 14, mat: 'mouth', color: 0x060404, rough: 0.9 });
        o.parts.tube([new V(ex, ey - 0.03, ez - 0.006), new V(ex + 0.012, ey - 0.09, ez - 0.02), new V(ex + 0.02, ey - 0.15, ez - 0.03)], [0.004, 0.0035, 0.0035], { mat: 'rope', color: 0x3a2c22, rough: 0.8 }, { bone: 'head', seg: 4, sub: 2 });
        o.parts.sphere({ bone: 'head', p: [ex + 0.022, ey - 0.175, ez - 0.036], r: 0.038, seg: 12, mat: 'plastic', color: 0xefe8d4, rough: 0.3, dirt: 0.5 });
        o.parts.sphere({ bone: 'head', p: [ex + 0.022, ey - 0.178, ez - 0.071], scale: [0.017, 0.017, 0.006], seg: 8, mat: 'plastic', color: 0x14110e, rough: 0.2 });
      } else {
        o.parts.sphere({ bone: 'head', p: [ex, ey, ez - 0.004], scale: [0.048, 0.07, 0.022], seg: 14, mat: 'plastic', color: 0x14110e, rough: 0.2 });
        o.parts.sphere({ bone: 'head', p: [ex - sx * 0.012, ey + 0.026, ez - 0.02], scale: [0.014, 0.018, 0.008], seg: 8, mat: 'plastic', color: 0xf8f4e8, rough: 0.2 });
      }
      const cx = sx * 0.18, cy = SUN_CY - 0.06; o.parts.sphere({ bone: 'head', p: [cx, cy, sunDomeZ(Math.hypot(cx, 0.06)) - 0.002], scale: [0.05, 0.036, 0.012], seg: 10, mat: 'plastic', color: 0xff6a6a, rough: 0.5, wear: 0.2 });
    }
    { const cr = [[-0.2, 0.17], [-0.13, 0.11], [-0.11, 0.05], [-0.05, 0.02], [-0.03, -0.04], [0.02, -0.08]].map(([x, y]) => new V(x, SUN_CY + y, sunDomeZ(Math.hypot(x, y)) - 0.002)); o.parts.tube(cr, 0.0035, { mat: 'plastic', color: 0x1a1008, rough: 0.5 }, { bone: 'head', seg: 4, sub: 2 }); }   // a big crack across the face
    const sm = []; for (let i = 0; i <= 10; i++) { const x = -0.14 + 0.28 * i / 10, y = SUN_CY - 0.075 - 0.075 * (1 - Math.pow(x / 0.14, 2)) * 1.0; sm.push(new V(x, y, sunDomeZ(Math.hypot(x, y - SUN_CY)) - 0.004)); }   // stitched smile
    o.parts.tube(sm, sm.map((p, i) => 0.011 - 0.003 * Math.abs(i - 5) / 5), { mat: 'plastic', color: 0x5a1010, rough: 0.4 }, { bone: 'head', seg: 6, sub: 1, caps: true });
  },
};

// 6. Rocket mascot — nose-cone helmet with fins, glowing visor, emissive trim, back-pack thrusters
const MASCOT_ROCKET = {
  id: 'mascot_rocket', name: 'Rocky the Rocket', looks: 2, height: [1.68, 1.9], hp: 1.5,
  body: { gaunt: 0.1, girthRange: [1.02, 1.14] }, skin: { tint: [0.95, 0.98, 1.02] }, layers: { blood: 0.4, dust: 0.1 }, eyes: { glow: 0, cataract: 0.9 }, hair: { color: 0x2a2a2a, amount: 0.2, bald: 1 },
  emissiveColor: 0x50e8ff, speedClasses: { walk: 1.1, run: 1.1, sprint: 0.6 }, voice: { kind: 'mascot', f0: [130, 200], formants: [520, 1000, 2400], rasp: 0.4, wet: 0.1, muffle: 0.9 },
  hitHeadR: 0.3, hitHeadDY: 0.13, arms: { reach: 0.3 }, helmetY: 1.8, helmetSurface: 'plastic', idiosyncrasy: { limpChance: 0.25, hunch: [0.02, 0.1], tilt: 0.4 },
  build(o, rng, look) {
    o.body({ skin: 0x767a7e });
    const suit = look ? 0xd8dce2 : 0xb8bec8, trim = look ? 0xff6ad0 : 0x40e8ff, nose = look ? 0x2a70d8 : 0xd83a2a;
    o.garment('coveralls', { color: suit, mat: 'plastic', rough: 0.35, offset: 0.03, loose: 0.02, dirt: 0.5, wear: 0.4, param: 0.1 });
    o.garment('gloves', { color: nose, mat: 'rubber', dirt: 0.5 }); o.garment('boots', { color: 0xe8ecf0, mat: 'rubber', height: 6, offset: 0.028, loose: 0.03, dirt: 0.5, soleColor: nose });
    const hc = [0, HC.y + 0.04, HC.z + 0.002];
    o.parts.sphere({ bone: 'head', p: hc, scale: [0.25, 0.275, 0.26], seg: 24, ...shell(0xeef0f2, { param: 0.3 }) });                                          // helmet shell
    o.parts.lathe({ bone: 'head', p: [0, hc[1] + 0.185, hc[2]], profile: [[0.2, 0.0], [0.19, 0.05], [0.16, 0.13], [0.11, 0.23], [0.055, 0.33], [0.001, 0.43]], seg: 26, ...shell(nose, { param: 0.2 }) });   // ogive nose cone
    o.parts.torusRing({ bone: 'head', p: [0, hc[1] + 0.182, hc[2]], R: 0.2, r: 0.014, seg: 24, tseg: 5, mat: 'metal', color: 0xc8ccd2, rough: 0.3, metal: 1 });
    [0, PI, PI / 2].forEach((a, i) => {   // three swept fins around the helmet's lower rim (left, right, back); the left one is bent off short
      const L = i === 0 ? 0.55 : 1;
      o.parts.extrudeOutline({ bone: 'head', p: [Math.cos(a) * 0.2, hc[1] - 0.1, hc[2] + Math.sin(a) * 0.2], rot: [0, -a, i === 0 ? -0.12 : 0], outline: ccw([[-0.02, 0.06], [0.05, 0.02], [0.05 + 0.15 * L, -0.12 * L + 0.0], [0.06 + 0.15 * L, -0.2 * L], [0.03, -0.08], [-0.02, -0.05]]), depth: 0.022, ...shell(nose, { param: 0.4 }) });
    });
    // chest emblem: a little rocket on a round patch
    o.parts.custom((o) => { const p = front(o, 0, 1.3); o._sphere({ bind: 'auto', p: [p.x, p.y, p.z - 0.004], scale: [0.045, 0.045, 0.008], seg: 14, mat: 'plastic', color: nose, rough: 0.4 }); o._extrude({ bind: 'auto', p: [p.x, p.y, p.z - 0.011], outline: ccw([[0, 0.035], [0.011, 0.012], [0.011, -0.02], [0.024, -0.036], [0.004, -0.028], [-0.004, -0.028], [-0.024, -0.036], [-0.011, -0.02], [-0.011, 0.012]]), depth: 0.004, mat: 'plastic', color: 0xf4f4f0, rough: 0.35 }); });
    o.parts.sphere({ bone: 'head', p: [0, hc[1] + 0.005, hc[2] - 0.23], scale: [0.135, 0.09, 0.05], seg: 16, mat: 'metal', color: 0x1e2226, rough: 0.3, metal: 1 });               // visor rim
    o.parts.sphere({ bone: 'head', p: [0, hc[1] + 0.005, hc[2] - 0.245], scale: [0.115, 0.07, 0.04], seg: 16, mat: 'emissive', color: trim, emissive: 3.5 });                       // glowing visor
    for (const cr of [[[-0.09, 0.05], [-0.04, 0.01], [-0.02, -0.03], [0.03, -0.055]], [[0.1, 0.045], [0.06, 0.02], [0.065, -0.02]]]) o.parts.tube(cr.map(([x, y]) => new V(x, hc[1] + 0.005 + y, hc[2] - 0.283 + 0.06 * (1 - Math.min(1, Math.hypot(x / 0.115, y / 0.07))) - 0.0)), 0.0032, { mat: 'plastic', color: 0x14181c, rough: 0.4 }, { bone: 'head', seg: 4, sub: 2 });   // cracks across the visor
    o.parts.band({ y: 1.335, height: 0.03, thick: 0.004, lift: 0.006, seg: 28, center: [0, 0.02], mat: 'emissive', color: trim, emissive: 5 });                                      // emissive trim: chest, belt
    o.parts.band({ y: 1.0, height: 0.026, thick: 0.004, lift: 0.006, seg: 28, center: [0, 0.015], mat: 'emissive', color: trim, emissive: 5 });
    for (const s of ['L', 'R']) { const a = restAt('forearm.' + s, 0.82), b = restAt('forearm.' + s, 1); o.parts.torusRing({ bone: 'forearm.' + s, p: [a.x, a.y, a.z], R: 0.06, r: 0.008, rot: orient(b.clone().sub(a)), seg: 14, tseg: 4, mat: 'emissive', color: trim, emissive: 5 }); }
    for (const sx of [-1, 1]) {   // back-pack thrusters with glowing nozzles
      o.parts.lathe({ bone: 'chest', p: [sx * 0.095, 1.06, 0.15], profile: [[0.03, -0.05], [0.05, -0.02], [0.062, 0.0], [0.064, 0.28], [0.05, 0.3], [0.035, 0.32], [0.001, 0.33]], seg: 14, mat: 'metal', color: 0xc8ccd2, rough: 0.3, metal: 0.8, wear: 0.4, dirt: 0.5 });
      o.parts.lathe({ bone: 'chest', p: [sx * 0.095, 1.008, 0.15], rot: [PI, 0, 0], profile: [[0.001, 0.0], [0.03, 0.0], [0.024, 0.03]], seg: 10, mat: 'emissive', color: 0xffa040, emissive: 6 });
    }
  },
};

// 7. Ghost mascot — a bed-sheet suit: draped bell with wavy hem, sleeves, eye holes with a green glint; drifts slowly with dragging feet
const SHEET = [[1.83, 0.02], [1.815, 0.07], [1.78, 0.115], [1.72, 0.148], [1.66, 0.16], [1.58, 0.165], [1.5, 0.18], [1.43, 0.235], [1.35, 0.27], [1.2, 0.285], [1.0, 0.3], [0.75, 0.33], [0.5, 0.37], [0.3, 0.41], [0.16, 0.44]];
const SHEET_Z0 = 0.02, sheetFrontZ = (y, x = 0) => { const r = sheetR(y); return SHEET_Z0 - Math.sqrt(Math.max(0, r * r - x * x)) * 1.02; };
const sheetR = (y) => { for (let i = 0; i < SHEET.length - 1; i++) if (y <= SHEET[i][0] && y >= SHEET[i + 1][0]) { const t = (SHEET[i][0] - y) / (SHEET[i][0] - SHEET[i + 1][0]); return SHEET[i][1] + t * (SHEET[i + 1][1] - SHEET[i][1]); } return SHEET[SHEET.length - 1][1]; };
const MASCOT_GHOST = {
  id: 'mascot_ghost', name: 'Boo the Ghost', looks: 2, height: [1.66, 1.9], hp: 1.25,
  body: { gaunt: 0.2, girthRange: [1.0, 1.1] }, skin: { tint: [0.92, 0.98, 1.0] }, layers: { blood: 0.35, dust: 0.05 }, eyes: { glow: 0, cataract: 1 }, hair: { color: 0x202020, amount: 0.1, bald: 1 },
  speedClasses: { walk: 1.8, run: 0.4, sprint: 0.05 }, voice: { kind: 'mascot', f0: [210, 330], formants: [440, 900, 2300], rasp: 0.55, wet: 0.5, muffle: 0.7 },
  hitHeadR: 0.2, hitHeadDY: 0.05, arms: { reach: 1 }, idiosyncrasy: { limpChance: 0, dragChance: 1, hunch: [0.0, 0.06], tilt: 0.9, armHangChance: 0 },
  build(o, rng, look) {
    o.body({ skin: 0x8a929a });
    const cloth = { mat: 'cloth', pattern: 'weave', color: look ? 0xd8e4e0 : 0xe4e2dc, rough: 0.92, dirt: 0.6, wear: 0.85 };
    o.parts.custom((o) => {   // draped bell: rings from the crown to a ragged hem, radial folds growing towards the bottom, weights follow head / chest / pelvis
      const NT = o.seg(30), N = 15, rows = [], spec = o._spec(cloth);
      const hemAt = (a) => 0.16 + 0.05 * Math.sin(5 * a + 1) + 0.035 * Math.sin(9 * a + 2);
      for (let j = 0; j <= N; j++) {
        const t = j / N, y0 = 1.83 - (1.83 - 0.15) * Math.pow(t, 0.9), row = [], sp = t < 0.35 ? spec : o._spec({ ...cloth, sway: Math.min(1, Math.pow((t - 0.3) / 0.7, 1.6)) });   // hem flutters, shoulders stay put
        for (let k = 0; k < NT; k++) {
          const a = (k / NT) * TAU, hem = hemAt(a), y = j === N ? hem : Math.max(y0, hem + 0.02 * (N - j));
          const fold = 1 + (0.015 + 0.09 * Math.pow(t, 1.6)) * Math.sin(7 * a + 1.3 + t * 2) + 0.03 * Math.pow(t, 2) * Math.sin(13 * a);
          const r = sheetR(y) * fold, p = new V(Math.sin(a) * r, y, SHEET_Z0 - Math.cos(a) * r * 1.02);
          const dr = (sheetR(Math.min(1.83, y + 0.05)) - sheetR(Math.max(0.15, y - 0.05))) / 0.1, nn = new V(Math.sin(a), Math.max(-0.6, Math.min(0.6, -dr)), -Math.cos(a)).normalize();
          let w; if (y > 1.52) w = [[BI.head, 0.7], [BI.neck, 0.3]]; else if (y > 1.34) w = [[BI.neck, 0.3], [BI.chest, 0.7]]; else if (y > 1.1) w = [[BI.chest, 0.6], [BI.spine2, 0.4]]; else if (y > 0.85) w = [[BI.spine1, 0.5], [BI.pelvis, 0.5]]; else w = [[BI.pelvis, 0.75], [Math.sin(a) > 0 ? BI['thigh.R'] : BI['thigh.L'], 0.25]];
          row.push(o.buf.vert(p, nn, w, sp, 0.9 + 0.1 * t));
        } rows.push(row);
      }
      for (let j = 0; j < N; j++) for (let k = 0; k < NT; k++) { const k1 = (k + 1) % NT; o.buf.quad(rows[j][k], rows[j + 1][k], rows[j + 1][k1], rows[j][k1]); o.buf.quad(rows[j][k], rows[j][k1], rows[j + 1][k1], rows[j + 1][k]); }
    });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.4 + rng() * 0.3, r = sheetR(0.2) * 0.98; blade(o, 'pelvis', new V(Math.sin(a) * r, 0.24, SHEET_Z0 - Math.cos(a) * r * 1.02), new V(Math.sin(a) * 0.25, -1, -Math.cos(a) * 0.25), 0.16 + rng() * 0.14, 0.03, 0.004, { ...cloth, sway: 1 }, new V(Math.cos(a), 0, Math.sin(a)), 6); }   // ragged tatters at the hem
    for (const s of ['L', 'R']) {   // draped sleeves over the arms
      o.parts.capsuleBetween('upperarm.' + s, 'forearm.' + s, 0.088, 0.074, cloth, { seg: 12, rings: 3 });
      o.parts.capsuleBetween('forearm.' + s, 'hand.' + s, 0.074, 0.058, cloth, { seg: 12, rings: 3 });
    }
    // eye holes (black), a glint in each, and a wailing mouth
    for (const sx of [-1, 1]) {
      const ez = sheetFrontZ(HC.y + 0.025, sx * 0.058); o.parts.sphere({ bone: 'head', p: [sx * 0.058, HC.y + 0.025, ez - 0.002], scale: [0.034, 0.05, 0.012], seg: 14, mat: 'mouth', color: 0x050505, rough: 0.9 });
      o.parts.sphere({ bone: 'head', p: [sx * 0.058, HC.y + 0.018, ez - 0.008], r: 0.0095, seg: 8, mat: 'emissive', color: look ? 0x9affc0 : 0xc0f0ff, emissive: 7 });
    }
    o.parts.sphere({ bone: 'head', p: [0, HC.y - 0.06, sheetFrontZ(HC.y - 0.06) - 0.002], scale: [0.03, 0.046, 0.012], seg: 14, mat: 'mouth', color: 0x050505, rough: 0.9 });
  },
};

// 8. Parrot mascot — hooked beak, fan crest, white eye patches, wing cape and tail feathers (cove: a little sea-damp)
const MASCOT_PARROT = {
  id: 'mascot_parrot', name: 'Polly the Parrot', looks: 2, height: [1.66, 1.9], hp: 1.3,
  body: { gaunt: 0.15, girthRange: [1.0, 1.12] }, skin: { tint: [1, 0.95, 0.92] }, layers: { blood: 0.5, wet: 0.2, dust: 0.1 }, eyes: { glow: 0, cataract: 0.9 }, hair: { color: 0x2a1c14, amount: 0.2, bald: 1 },
  speedClasses: { walk: 1, run: 1.2, sprint: 0.8 }, voice: { kind: 'mascot', f0: [230, 380], formants: [620, 1300, 2800], rasp: 0.6, wet: 0.4, muffle: 0.6 },
  hitHeadR: 0.3, hitHeadDY: 0.1, arms: { reach: 0.35 }, idiosyncrasy: { limpChance: 0.3, hunch: [0.05, 0.2], tilt: 0.6 },
  build(o, rng, look) {
    o.body({ skin: 0x807a6a });
    const body = look ? 0x2a70d8 : 0xd8281c, wing2 = look ? 0xf4c020 : 0x2a70d8, wing3 = look ? 0x3cc060 : 0xf4c020, feat = { mat: 'fur', pattern: 'plush', rough: 1, dirt: 0.45, wear: 0.4, sway: 0.55 };
    o.garment('coveralls', plush(body)); o.garment('mittens', plush(0xf4c020, { offset: 0.022 })); o.garment('boots', plush(0xf4c020, { offset: 0.03, loose: 0.03, height: 7 }));
    neckCollar(o, body);
    const hc = [0, HC.y + 0.03, HC.z + 0.005];
    o.parts.sphere({ bone: 'head', p: hc, scale: [0.235, 0.25, 0.245], seg: 22, mat: 'fur', pattern: 'plush', color: body, rough: 1, dirt: 0.5, wear: 0.5 });
    for (const sx of [-1, 1]) {   // white eye patches with black eyes
      o.parts.sphere({ bone: 'head', p: [sx * 0.1, hc[1] + 0.03, hc[2] - 0.185], scale: [0.062, 0.072, 0.03], seg: 14, mat: 'plastic', color: 0xf0ecdc, rough: 0.5, dirt: 0.4 });
      o.parts.sphere({ bone: 'head', p: [sx * 0.1, hc[1] + 0.03, hc[2] - 0.208], scale: [0.026, 0.03, 0.014], seg: 10, mat: 'plastic', color: 0x0c0a08, rough: 0.2 });
    }
    // hooked beak: upper mandible sweeping down over a smaller lower one
    o.parts.tube([new V(0, hc[1] - 0.005, hc[2] - 0.17), new V(0, hc[1] - 0.025, hc[2] - 0.27), new V(0, hc[1] - 0.085, hc[2] - 0.335), new V(0, hc[1] - 0.175, hc[2] - 0.34)], [0.088, 0.078, 0.05, 0.006], { mat: 'plastic', color: 0xf0d090, rough: 0.35, wear: 0.4, dirt: 0.5, param: 0.25 }, { bone: 'head', seg: 12, sub: 3, flat: 0.92 });
    o.parts.tube([new V(0, hc[1] - 0.075, hc[2] - 0.17), new V(0, hc[1] - 0.105, hc[2] - 0.26), new V(0, hc[1] - 0.13, hc[2] - 0.305)], [0.06, 0.04, 0.008], { mat: 'plastic', color: 0x2a2622, rough: 0.35, wear: 0.4, dirt: 0.5 }, { bone: 'head', seg: 10, sub: 3, flat: 0.85 });
    // crest: five feathers fanning up and back
    const cols = [wing2, wing3, body, wing3, wing2], dirs = [[-0.6, 0.8, 0.25], [-0.3, 0.92, 0.3], [0, 0.94, 0.34], [0.3, 0.92, 0.3], [0.6, 0.8, 0.25]], lens = [0.34, 0.44, 0.5, 0.44, 0.34];
    dirs.forEach((d, i) => blade(o, 'head', new V(0, hc[1] + 0.2, hc[2] + 0.02), new V(...d), lens[i], 0.055, 0.012, { ...feat, color: cols[i] }, new V(0.5 * Math.sign(d[0] || 1), 0, 1)));
    for (const s of [-1, 1]) {   // wing capes on the back + tail feathers
      const dm = s > 0 ? 0.72 : 1;   // the character's right wing is torn short
      const pts = [[0, 0.02], [0.11, 0.05], [0.26, 0.03], [0.4, -0.06], [0.46, -0.2], [0.44, -0.36], [0.37, -0.5], [0.3, -0.6], [0.22, -0.66], [0.13, -0.54], [0.06, -0.3]].map(([x, y]) => [s * x * (0.6 + 0.4 * dm), y * dm]);
      o.parts.extrudeOutline({ bone: 'chest', p: [s * 0.1, 1.4, 0.15], rot: [0.12, 0, s * -0.35], outline: ccw(pts), depth: 0.014, ...feat, color: wing2 });
      o.parts.extrudeOutline({ bone: 'chest', p: [s * 0.13, 1.33, 0.166], rot: [0.12, 0, s * -0.35], outline: ccw(pts.map(([x, y]) => [x * 0.66, y * 0.7 - 0.02])), depth: 0.014, ...feat, color: wing3 });
    }
    [[-0.22, -0.9, 0.5, wing2, 0.62], [0, -0.85, 0.55, body, 0.72], [0.22, -0.9, 0.5, wing2, 0.62]].forEach(([x, y, z, c, L]) => blade(o, 'pelvis', new V(x * 0.15, 1.0, 0.11), new V(x, y, z), L * 1.15, 0.07, 0.012, { ...feat, color: c }, new V(1, 0, 0)));
  },
};

export const AFTER_HOURS_VARIANTS = [GUEST, STAFF, USHER, CLOWN, MASCOT_SUN, MASCOT_ROCKET, MASCOT_GHOST, MASCOT_PARROT];
registerVariants('after-hours', AFTER_HOURS_VARIANTS);
