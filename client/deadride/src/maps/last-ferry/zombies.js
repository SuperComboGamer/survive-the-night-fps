// LAST FERRY — the Harbour Dead: seven variants built with the zombie Outfit API (src/game/zombies/README.md).
//   Pier: dockhands, drowned, seamen     Wharf: fishmongers, drowned, dockhands     Prison: guards, inmates, drowned     Lighthouse: keepers, drowned, seamen
// Every variant is built only from body/garment/gear primitives; the few custom pieces (caps, cuffs, cleaver, lantern, barnacles, rope) use o.parts.* with rest-space positions.
import * as THREE from 'three';
import { registerVariants } from '../../game/zombies/factory.js';
import '../../game/zombies/gear.js';
import { RIG, HEAD_CENTER, restAt, restPos, restTail } from '../../game/zombies/rig.js';

const V = THREE.Vector3, HC = HEAD_CENTER, TAU = Math.PI * 2;
const qUp = (d) => new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.clone().normalize());
/** hand grip frame (same convention as the built-in tools): c = grip centre, h = along the hand, p = palm normal, t = thumb side */
function grip(side) { const A = RIG.arm[side]; const h = new V(...A.h), p = new V(...A.p), t = new V(...A.t), w = new V(...A.wr); return { c: w.clone().addScaledVector(h, 0.068).addScaledVector(p, 0.026), h, p, t }; }

// ------------------------------------------------------------------------------------------------ headwear
/** docker's flat cap: squashed wool dome + stiff peak. */
function flatCap(o, { color = 0x3a3a3c, pattern = 'check', dirt = 0.6, wear = 0.5 } = {}) {
  const m = { mat: 'cloth', pattern, color, rough: 0.95, dirt, wear };
  const c = [HC.x, HC.y + 0.036, HC.z + 0.012], prof = []; for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; prof.push([Math.max(0.002, Math.cos(a) * 0.116), Math.sin(a) * 0.052 - 0.004]); }
  o.parts.lathe({ bone: 'head', p: c, profile: prof, scale: [0.92, 1.1], seg: 24, ...m });
  o.parts.torusRing({ bone: 'head', p: [c[0], c[1] - 0.006, c[2]], R: 0.112, r: 0.011, scale: [0.92, 1.1], seg: 24, tseg: 5, ...m });
  o.parts.box({ bone: 'head', p: [0, c[1] - 0.012, c[2] - 0.125], s: [0.135, 0.008, 0.062], rot: [0.2, 0, 0], bevel: 0.002, ...m });
  o.info.helmetY = HC.y + 0.09;
}
/** prison-officer peaked cap: banded cylindrical crown with a saucer top, patent visor, cap badge. */
function peakedCap(o, { color = 0x1a1e26, band = 0x0c0c0e, badge = 0xb8a050 } = {}) {
  const m = { mat: 'cloth', pattern: 'weave', color, rough: 0.9, dirt: 0.45, wear: 0.4 };
  const c = [HC.x, HC.y + 0.028, HC.z + 0.014];
  o.parts.lathe({ bone: 'head', p: c, profile: [[0.106, 0], [0.108, 0.05], [0.126, 0.075], [0.122, 0.088], [0.0, 0.09]], scale: [0.9, 1.1], seg: 26, ...m });
  o.parts.torusRing({ bone: 'head', p: [c[0], c[1] + 0.012, c[2]], R: 0.109, r: 0.012, scale: [0.9, 1.1], seg: 26, tseg: 5, mat: 'cloth', color: band, rough: 0.7, pattern: 'weave' });
  o.parts.box({ bone: 'head', p: [0, c[1] + 0.004, c[2] - 0.13], s: [0.15, 0.006, 0.07], rot: [0.32, 0, 0], bevel: 0.002, mat: 'leather', color: 0x0a0a0c, rough: 0.2, wear: 0.4 });
  o.parts.sphere({ bone: 'head', p: [0, c[1] + 0.05, c[2] - 0.113], scale: [0.013, 0.015, 0.005], seg: 8, mat: 'metal', color: badge, rough: 0.3, wear: 0.5 });
  o.info.helmetY = HC.y + 0.13;
}
/** fishmonger's white cap: a low fluted band with a flat pill-box top. */
function fishCap(o, { color = 0xe6e2d4 } = {}) {
  const m = { mat: 'cloth', pattern: 'weave', color, rough: 0.9, dirt: 0.75, wear: 0.35 };
  const c = [HC.x, HC.y + 0.02, HC.z + 0.012];
  o.parts.lathe({ bone: 'head', p: c, profile: [[0.1, 0], [0.104, 0.04], [0.108, 0.07], [0.098, 0.088], [0.0, 0.09]], scale: [0.92, 1.1], seg: 24, ...m });
  o.parts.torusRing({ bone: 'head', p: [c[0], c[1] + 0.004, c[2]], R: 0.1, r: 0.01, scale: [0.92, 1.1], seg: 24, tseg: 5, ...m });
  o.info.helmetY = HC.y + 0.11;
}

// ------------------------------------------------------------------------------------------------ hand gear (bound to the hand bone; a held tool switches the zombie to the tool-swing attack)
function cleaver(o, side = 'R') {
  const g = grip(side), hb = 'hand.' + side;
  o.parts.capsuleBetween(g.c.clone().addScaledVector(g.t, -0.05), g.c.clone().addScaledVector(g.t, 0.055), 0.016, 0.016, { mat: 'rope', color: 0x6a4a2a, rough: 0.8, wear: 0.5, dirt: 0.6 }, { bone: hb, rigid: true, seg: 8 });
  const base = g.c.clone().addScaledVector(g.t, 0.06);
  o.parts.box({ bone: hb, p: [base.x, base.y, base.z], s: [0.03, 0.012, 0.03], rot: qUp(g.t), mat: 'metal', color: 0x5a5a5a, rough: 0.4, wear: 0.7 });
  const bc = base.clone().addScaledVector(g.t, 0.09).addScaledVector(g.h, 0.02);
  o.parts.box({ bone: hb, p: [bc.x, bc.y, bc.z], s: [0.007, 0.19, 0.12], rot: qUp(g.t), bevel: 0.002, mat: 'metal', color: 0x9aa0a4, rough: 0.28, wear: 0.6, dirt: 0.75 });
  o.info.tools.push({ kind: 'cleaver', hand: side });
}
function boatHook(o, side = 'R') {
  const g = grip(side), hb = 'hand.' + side; const ax = g.h.clone().multiplyScalar(0.72).addScaledVector(g.t, 0.69).normalize();
  const bot = g.c.clone().addScaledVector(ax, -0.2), top = g.c.clone().addScaledVector(ax, 0.9);
  o.parts.capsuleBetween(bot, top, 0.016, 0.014, { mat: 'rope', color: 0x8a6a3a, rough: 0.7, wear: 0.55, dirt: 0.5 }, { bone: hb, rigid: true, seg: 8, rings: 3 });
  const pd = g.p.clone().negate(); const tip = top.clone().addScaledVector(ax, 0.06);
  o.parts.tube([top, tip.clone().addScaledVector(pd, 0.02), tip.clone().addScaledVector(pd, 0.085).addScaledVector(ax, 0.045), tip.clone().addScaledVector(pd, 0.11).addScaledVector(ax, -0.02)], [0.012, 0.009, 0.007, 0.002], { mat: 'metal', color: 0x5a5852, rough: 0.5, wear: 0.9 }, { bone: hb, seg: 7, sub: 3 });
  o.info.tools.push({ kind: 'boathook', hand: side });
}
function baton(o, side = 'R') {
  const g = grip(side), hb = 'hand.' + side; const ax = g.h.clone().multiplyScalar(0.7).addScaledVector(g.t, 0.7).normalize();
  o.parts.capsuleBetween(g.c.clone().addScaledVector(ax, -0.1), g.c.clone().addScaledVector(ax, 0.42), 0.02, 0.023, { mat: 'rubber', color: 0x101012, rough: 0.5, wear: 0.4, dirt: 0.4 }, { bone: hb, rigid: true, seg: 8 });
  o.parts.capsuleBetween(g.c.clone().addScaledVector(ax, -0.1), g.c.clone().addScaledVector(ax, -0.02), 0.024, 0.021, { mat: 'leather', color: 0x2a2a2c, rough: 0.6, wear: 0.4 }, { bone: hb, rigid: true, seg: 8 });
  o.info.tools.push({ kind: 'baton', hand: side });
}
/** storm lantern: brass cage, glowing glass, ring handle. The emissive glass is what reads in the dark. */
function lantern(o, side = 'L', { glow = 5, color = 0xffc070 } = {}) {
  const g = grip(side), hb = 'hand.' + side; const c = g.c.clone().addScaledVector(g.t, -0.19).addScaledVector(g.p, 0.03);
  o.parts.tube([g.c.clone().addScaledVector(g.t, -0.02), g.c.clone().addScaledVector(g.t, -0.09), c.clone().addScaledVector(g.t, 0.075)], [0.006, 0.005, 0.005], { mat: 'metal', color: 0x6a5a30, rough: 0.4, wear: 0.6 }, { bone: hb, seg: 6, sub: 2 });
  o.parts.lathe({ bone: hb, p: [c.x, c.y - 0.08, c.z], profile: [[0.0, 0.0], [0.044, 0.0], [0.046, 0.012], [0.038, 0.02], [0.0, 0.022]], seg: 12, mat: 'metal', color: 0x6a5a30, rough: 0.4, wear: 0.6 });
  o.parts.lathe({ bone: hb, p: [c.x, c.y - 0.06, c.z], profile: [[0.028, 0.0], [0.042, 0.04], [0.042, 0.1], [0.03, 0.14]], seg: 12, mat: 'emissive', color: color, emissive: glow });
  o.parts.lathe({ bone: hb, p: [c.x, c.y + 0.076, c.z], profile: [[0.0, 0.0], [0.05, 0.0], [0.04, 0.02], [0.012, 0.038], [0.0, 0.04]], seg: 12, mat: 'metal', color: 0x6a5a30, rough: 0.4, wear: 0.6 });
  o.info.tools.push({ kind: 'lantern', hand: side }); o.info.emissive.push(color);
}

// ------------------------------------------------------------------------------------------------ body gear
/** hanging cuffs (steel rings) on wrists and ankles with a short broken chain */
function cuffs(o, { wrists = true, ankles = true } = {}) {
  const ring = (bone, t, R, r) => { const a = restAt(bone, t), d = restTail(bone).sub(restPos(bone)); o.parts.torusRing({ bone, p: [a.x, a.y, a.z], R, r, rot: qUp(d), seg: 12, tseg: 6, mat: 'metal', color: 0x6a6e70, rough: 0.35, wear: 0.7, dirt: 0.5 }); return a; };
  const link = (bone, a, n, w = 0.018) => { const d = restTail(bone).sub(restPos(bone)).normalize().negate(); for (let i = 1; i <= n; i++) { const p = a.clone().addScaledVector(d, -0.012 * i).add(new V(0, 0, 0.015 * i)); o.parts.torusRing({ bone, p: [p.x, p.y - 0.018 * i, p.z], R: w, r: 0.0035, rot: [i % 2 ? 0 : Math.PI / 2, 0, 0.5], seg: 8, tseg: 4, mat: 'metal', color: 0x5a5e60, rough: 0.4, wear: 0.8 }); } };
  if (wrists) for (const s of ['L', 'R']) { const a = ring('forearm.' + s, 0.88, 0.036, 0.0075); link('forearm.' + s, a, 3); }
  if (ankles) for (const s of ['L', 'R']) { const a = ring('calf.' + s, 0.86, 0.05, 0.0085); link('calf.' + s, a, s === 'L' ? 4 : 2, 0.02); }
}
/** duty belt kit: baton ring, key ring with keys, radio, holster pouch (boxes snapped on the hip line) */
function dutyKit(o) {
  o.parts.custom((oo) => {
    const put = (x, y, s, mat, extra = {}) => { const p = oo.snap(new V(x, y, 0.0), new V(x, 0, -0.05).normalize(), 0.16, 0.02, 0.02); oo._box({ bind: 'auto', p: [p.x + (x < 0 ? -0.004 : 0.004), p.y, p.z - 0.008], s, mat: mat.mat, color: mat.color, rough: mat.rough ?? 0.6, wear: 0.6, dirt: 0.5, bevel: 0.006, ...extra }); };
    put(-0.15, 0.96, [0.05, 0.11, 0.06], { mat: 'leather', color: 0x141416 });           // radio
    put(0.15, 0.95, [0.045, 0.13, 0.055], { mat: 'leather', color: 0x121214 });           // pouch
    put(0.11, 0.985, [0.03, 0.035, 0.03], { mat: 'metal', color: 0x8a8a70, rough: 0.35 }); // key ring
    for (let i = 0; i < 4; i++) { const p = oo.snap(new V(0.115 + i * 0.006, 0.96, 0), new V(0.1, 0, -0.05).normalize(), 0.16, 0.02, 0.02); oo._box({ bind: 'auto', p: [p.x + 0.006, p.y - 0.03 - i * 0.008, p.z - 0.01 - i * 0.003], s: [0.008, 0.045, 0.004], mat: 'metal', color: i % 2 ? 0xb0a070 : 0x9a9a9a, rough: 0.35, wear: 0.6 }); }
  });
}
/** a coil of heavy rope worn across the chest (bandolier) */
function ropeBandolier(o, { color = 0x8a7a54, turns = 3 } = {}) {
  const pts = [], rad = []; const n = 26;
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * Math.PI * 2 * turns; pts.push(new V(-0.14 + t * 0.27 + Math.cos(a) * 0.012, 1.42 - t * 0.44 + Math.sin(a) * 0.012, -0.135 * (1 - Math.abs(t * 2 - 1) * 0.15) + (t > 0.5 ? 0.05 : 0))); rad.push(0.014); }
  const back = []; for (let i = 0; i <= 12; i++) { const t = i / 12; back.push(new V(0.13 - t * 0.27, 0.98 + t * 0.44, 0.13)); }
  o.parts.tube(pts.map((p) => new V(p.x, p.y, Math.max(p.z, -0.15))), rad, { mat: 'rope', color, rough: 0.9, wear: 0.5, dirt: 0.6 }, { bind: 'auto', seg: 8, sub: 2 });
  o.parts.tube(back, back.map(() => 0.013), { mat: 'rope', color, rough: 0.9, wear: 0.5, dirt: 0.6 }, { bind: 'auto', seg: 8, sub: 2 });
}
/** barnacle clusters + limpets crusting a shoulder / back / knee (tiny grey-white cones and spheres) */
function barnacles(o, rng, spots) {
  for (const [bone, x, y, z, n, s] of spots) for (let k = 0; k < n; k++) {
    const ax = x + (rng() - 0.5) * 0.07, ay = y + (rng() - 0.5) * 0.07, az = z + (rng() - 0.5) * 0.03, r = (0.011 + rng() * 0.012) * s;
    o.parts.lathe({ bone, p: [ax, ay, az], profile: [[0.0, 0.0], [r * 1.05, 0.0], [r * 0.9, r * 0.9], [r * 0.5, r * 1.5], [r * 0.32, r * 1.6], [0.0, r * 1.5]], rot: [(rng() - 0.5) * 0.8, 0, (rng() - 0.5) * 0.8], seg: 7, mat: 'bone', color: 0xb0aa98, rough: 0.9, dirt: 0.7 });
  }
}
/** rubber butcher's apron: front of the torso (chest to knees) */
function apron(o, color = 0xd8d4c4) {
  o.garment({ sel: (t) => t.part === 'torso' && t.seg >= 1 && t.seg <= 7 && t.zone === 'front', offset: 0.024, loose: 0.008, mat: { mat: 'rubber', rough: 0.4 } }, { color, wear: 0.4, dirt: 0.7 });
  o.parts.strap([[-0.07, 1.36, -0.125], [-0.09, 1.44, -0.06], [-0.05, 1.5, 0.0], [0.05, 1.5, 0.0], [0.09, 1.44, -0.06], [0.07, 1.36, -0.125]], 0.016, 0.003, { mat: 'rubber', color: color, rough: 0.5, dirt: 0.8 }, {});
}
/** a herring / cod slung over the shoulder by a hook (small fish silhouette) */
function fishOverShoulder(o, { color = 0x8a9aa0 } = {}) {
  const m = { mat: 'flesh', color, rough: 0.35, wear: 0.4, dirt: 0.5 };
  o.parts.sphere({ bone: 'chest', p: [0.16, 1.28, 0.1], scale: [0.045, 0.05, 0.2], rot: [0.5, 0.25, 0.3], seg: 10, ...m });
  o.parts.lathe({ bone: 'chest', p: [0.145, 1.13, 0.235], profile: [[0.0, 0.0], [0.028, 0.035], [0.002, 0.11]], rot: [0.55, 0.2, 0.25], scale: [0.35, 1.0], seg: 6, ...m });
}



/** ankle chain: a short run of loose steel links whose material sways in the shader (they swing and jiggle while the zombie walks) */
function swingChain(o, bone, t, n = 6) {
  const a = restAt(bone, t);
  for (let i = 0; i < n; i++) o.parts.torusRing({ bone, p: [a.x + (i % 2 ? 0.006 : -0.006), a.y - 0.03 - i * 0.026, a.z + 0.03 + i * 0.018], R: 0.016, r: 0.0034, rot: [i % 2 ? 0 : Math.PI / 2, 0, (i % 3) * 0.6], scale: [0.7, 1.15], seg: 8, tseg: 4, mat: 'metal', color: 0x8a9092, rough: 0.35, wear: 0.7, dirt: 0.5, sway: Math.min(1, 0.35 + i * 0.16) });
}
/** hand torch: black rubber body with a bright cold lens (reads as a moving point of light in the dark) */
function torch(o, side = 'L', { glow = 9, color = 0xdfeeff } = {}) {
  const g = grip(side), hb = 'hand.' + side; const ax = g.h.clone().multiplyScalar(0.8).addScaledVector(g.t, 0.6).normalize();
  const a = g.c.clone().addScaledVector(ax, -0.06), b = g.c.clone().addScaledVector(ax, 0.2);
  o.parts.capsuleBetween(a, b, 0.021, 0.026, { mat: 'rubber', color: 0x1a1a1c, rough: 0.5, wear: 0.4, dirt: 0.4 }, { bone: hb, rigid: true, seg: 8 });
  o.parts.lathe({ bone: hb, p: [b.x, b.y, b.z], profile: [[0.0, 0.0], [0.026, 0.0], [0.032, 0.03], [0.034, 0.05], [0.0, 0.05]], rot: qUp(ax), seg: 10, mat: 'metal', color: 0x2a2a2c, rough: 0.35, wear: 0.5 });
  o.parts.lathe({ bone: hb, p: [b.x + ax.x * 0.048, b.y + ax.y * 0.048, b.z + ax.z * 0.048], profile: [[0.0, 0.0], [0.03, 0.0], [0.0, 0.002]], rot: qUp(ax), seg: 10, mat: 'emissive', color, emissive: glow });
  o.info.tools.push({ kind: 'torch', hand: side }); o.info.emissive.push(color);
}
/** donkey-jacket yoke: black leatherette shoulder panel over the wool jacket */
function yoke(o, color = 0x14161a) {
  o.garment({ sel: (t) => (t.part === 'torso' && t.seg >= 7) || (t.part === 'upperarm' && t.seg <= 0), offset: 0.036, loose: 0.004, mat: { mat: 'leather', rough: 0.55 } }, { color, wear: 0.55, dirt: 0.5 });
}
/** long coat skirt (hip to knee) for oilskin coats / overcoats */
function coatSkirt(o, { color, pattern = 'oilskin', wear = 0.6, dirt = 0.5 } = {}) {
  o.garment({ sel: (t) => t.part === 'thigh' && t.seg <= 3, offset: 0.05, loose: 0.03, mat: { mat: 'cloth', pattern, rough: 0.4 } }, { color, wear, dirt });
}
/** body-armour plates: chest + back trauma plates and shoulder pads over the vest */
function armourPlates(o, color = 0x22262a) {
  o.parts.custom((oo) => {
    const front = oo.snap(new V(0, 1.25, 0), new V(0, 0, -1), 0.16, 0.02, 0.02), back = oo.snap(new V(0, 1.27, 0), new V(0, 0, 1), 0.16, 0.02, 0.02);
    oo._box({ bind: 'auto', p: [front.x, front.y, front.z - 0.007], s: [0.19, 0.23, 0.012], mat: 'plastic', color, rough: 0.55, wear: 0.5, dirt: 0.4, bevel: 0.01 });
    oo._box({ bind: 'auto', p: [back.x, back.y, back.z + 0.007], s: [0.2, 0.25, 0.012], mat: 'plastic', color, rough: 0.55, wear: 0.5, dirt: 0.4, bevel: 0.01 });
    for (const sx of [-1, 1]) { const p = oo.snap(new V(sx * 0.055, 1.08, 0), new V(0, 0, -1), 0.16, 0.02, 0.02); oo._box({ bind: 'auto', p: [p.x, p.y, p.z - 0.012], s: [0.075, 0.09, 0.03], mat: 'cloth', pattern: 'canvas', color: 0x2a3038, rough: 0.8, wear: 0.4, dirt: 0.4, bevel: 0.012 }); }   // magazine pouches
    for (const sx of [-1, 1]) { const p = oo.snap(new V(sx * 0.18, 1.43, 0.01), new V(sx, 0.4, 0).normalize(), 0.12, 0.02, 0.02); oo._box({ bind: 'auto', p: [p.x + sx * 0.006, p.y + 0.004, p.z], s: [0.08, 0.025, 0.11], mat: 'plastic', color, rough: 0.55, wear: 0.5, dirt: 0.4, bevel: 0.01 }); }
  });
}
const pick = (rng, arr) => arr[(rng() * arr.length) | 0];

export const LAST_FERRY_VARIANTS = [
  // ---------------------------------------------------------------------------------------------- PIER / WHARF: dockhand (donkey jacket with leather yoke, flat cap, hi-vis scraps, cargo hook)
  {
    id: 'ferry_dockworker', name: 'Dockhand', looks: 2, height: [1.66, 1.92], hp: 1.15,
    body: { gaunt: 0.15, girthRange: [1.06, 1.2] }, skin: { tint: [1.0, 0.96, 0.92], variation: 0.12 },
    layers: { dust: 0.2, blood: 0.5, wet: 0.12 }, eyes: { glow: 0, cataract: 0.75 }, hair: { color: 0x2a2018, amount: 0.7, beard: 0.85, hairline: 0.4 },
    speedClasses: { walk: 1.1, run: 1.0, sprint: 0.55 }, voice: { f0: 84, formants: [520, 980, 2300], rasp: 0.7, wet: 0.25, muffle: 0, kind: 'male' },
    arms: { reach: 0.35 }, idiosyncrasy: { hunch: [0.1, 0.35], limpChance: 0.3 }, helmetY: 1.78, helmetSurface: 'cloth',
    build(o, rng, look) {
      o.body({ skin: 0x8a8474, girth: 1.1, belly: 0.5, muscle: 0.6, gaunt: 0.1, decay: 0.45, dirt: 0.5, face: { gaunt: 0.4 } });
      o.garment('shirt', { color: look ? 0xc0bca4 : 0x9aa2ae, pattern: look ? 'check' : 'weave', dirt: 0.4, wear: 0.55, sleeve: 4, collar: false, vneck: 0.09 });
      o.garment('pants', { color: look ? 0x9a8462 : 0x6a7684, pattern: 'canvas', dirt: 0.4, wear: 0.6, detail: 8 });
      o.garment('boots', { color: 0x4a3420, dirt: 0.55, wear: 0.65, height: 6 });
      o.garment('jacket', { color: look ? 0x5a6a80 : 0x74624a, pattern: 'weave', offset: 0.028, loose: 0.018, dirt: 0.4, wear: 0.6, collar: 'stand', collarHeight: 0.05, detail: 1 | 2 | 4 });   // donkey jacket
      yoke(o, 0x2a2c32);
      if (look === 0) o.garment('vest', { color: 0xf08a1c, pattern: 'hivis', layer: 0.06, offset: 0.046, loose: 0.006, dirt: 0.3, wear: 0.3 });          // torn hi-vis vest (layer: garments sort by preset offset unless layer is given)
      o.belt({ y: 1.0, color: 0x241a10 });
      if (look) flatCap(o, { color: 0x6a665e, pattern: 'check' }); else o.beanie({ color: 0x2a3a58, fold: true });
      o.neckerchief({ color: look ? 0xa03a2a : 0x4a6a8a });
      o.cargoHook({ hand: 'R' });
    },
  },
  // ---------------------------------------------------------------------------------------------- everywhere: the harbour drowned (bloated, barefoot, weed, barnacles) — slow lurchers that climb the ladders
  {
    id: 'ferry_drowned', name: 'Harbour Drowned', looks: 2, height: [1.58, 1.86], hp: 1.05,
    body: { gaunt: 0.1, girthRange: [1.1, 1.26] }, skin: { tint: [0.86, 1.0, 1.02], variation: 0.1 },
    layers: { wet: 1.0, blood: 0.15, dust: 0 }, eyes: { glow: 0, cataract: 1.0 }, hair: { color: 0x1a2018, amount: 0.35, beard: 0.3, hairline: 0.7 },
    speedClasses: { walk: 1.7, run: 0.5, sprint: 0.1 }, voice: { f0: 76, formants: [440, 860, 2100], rasp: 0.35, wet: 1.0, muffle: 0.3, kind: 'male' },
    wet: true, arms: { reach: 0.85 }, idiosyncrasy: { hunch: [0.15, 0.45], dragChance: 0.3 },
    build(o, rng, look) {
      o.body({ skin: 0x86988e, girth: 1.14, belly: 0.75, muscle: 0.15, gaunt: 0.0, decay: 0.85, dirt: 0.5, face: { bloat: 0.95, gaunt: 0.1, lipsGone: 0.7 } });
      o.garment('pants', { color: look ? 0x7a868c : 0x8a8a6a, pattern: 'canvas', dirt: 0.35, wear: 0.95, loose: 0.03, hem: 6 });
      if (look) o.garment('vest', { color: 0xd8621c, pattern: 'canvas', layer: 0.06, offset: 0.052, loose: 0.02, puff: { period: 0.1, depth: 0.012, bulge: 0.01 }, dirt: 0.55, wear: 0.9 });   // waterlogged life jacket
      else o.garment('shirt', { color: 0xa4b0a6, pattern: 'weave', dirt: 0.3, wear: 0.98, sleeve: 4, loose: 0.03 });
      barnacles(o, rng, [['chest', 0.15, 1.4, -0.02, 3, 1.2], ['chest', -0.04, 1.3, 0.13, 3, 1.1], ['upperarm.R', 0.24, 1.32, 0.0, 2, 1.0], ['thigh.L', -0.11, 0.78, -0.07, 2, 1.1], ['calf.R', 0.09, 0.52, -0.04, 2, 1.0]]);
      o.seaweed({ color: 0x2a3e1c, anchors: [[0.12, 1.45, -0.06], [-0.1, 1.46, 0.06], [0.2, 1.08, -0.06], [-0.28, 1.28, 0.02], [0.05, 1.47, 0.1], [-0.16, 1.02, 0.1], [0.26, 1.3, 0.04]] });
      if (rng() < 0.5) o.parts.tube([new V(0.15, 1.42, -0.06), new V(0.0, 1.3, -0.16), new V(-0.15, 1.1, -0.12), new V(-0.2, 0.9, -0.02)], [0.008, 0.008, 0.008, 0.008], { mat: 'rope', color: 0x4a4c3c, rough: 0.95, wear: 0.7, dirt: 0.8 }, { bind: 'auto', seg: 6, sub: 2 }); // fishing line trailing across the chest
    },
  },
  // ---------------------------------------------------------------------------------------------- PIER / WHARF / LIGHTHOUSE: merchant seaman (yellow oilskin + sou'wester, or navy pea coat + watch cap; rope coil, boat hook)
  {
    id: 'ferry_sailor', name: 'Merchant Seaman', looks: 2, height: [1.66, 1.9], hp: 1.0,
    body: { gaunt: 0.3, girthRange: [0.98, 1.08] }, skin: { tint: [0.95, 0.97, 1.02], variation: 0.12 },
    layers: { wet: 0.45, blood: 0.55, dust: 0 }, eyes: { glow: 0, cataract: 0.8 }, hair: { color: 0x3a2c1c, amount: 0.8, beard: 1.0, hairline: 0.3 },
    speedClasses: { walk: 0.9, run: 1.2, sprint: 0.9 }, voice: { f0: 96, formants: [560, 1060, 2450], rasp: 0.6, wet: 0.5, muffle: 0, kind: 'male' },
    wet: true, arms: { reach: 0.5 }, helmetY: 1.78, helmetSurface: 'cloth',
    build(o, rng, look) {
      o.body({ skin: 0x828680, girth: 1.02, belly: 0.25, muscle: 0.45, gaunt: 0.3, decay: 0.5, dirt: 0.45, face: { gaunt: 0.55 } });
      o.garment('shirt', { color: 0xc8c4b4, pattern: 'weave', dirt: 0.6, wear: 0.6, sleeve: 6, collar: false, vneck: 0.06 });
      if (look) o.garment('pants', { color: 0x38445c, pattern: 'canvas', dirt: 0.4, wear: 0.6, detail: 8 }); else o.garment('pants', { color: 0xe0b020, pattern: 'oilskin', rough: 0.55, dirt: 0.4, wear: 0.5 });
      o.garment('boots', { color: 0x3a3a34, mat: 'rubber', dirt: 0.5, height: 6 });
      if (look) o.garment('jacket', { color: 0x44587e, pattern: 'weave', offset: 0.03, loose: 0.022, dirt: 0.4, wear: 0.55, collar: 'stand', collarHeight: 0.07, detail: 1 | 2 | 4 });   // pea coat
      else o.garment('jacket', { color: 0xe0b020, pattern: 'oilskin', rough: 0.55, offset: 0.03, loose: 0.026, dirt: 0.4, wear: 0.5, collar: 'stand', collarHeight: 0.07, detail: 1 | 4 });   // oilskin jacket
      o.belt({ y: 1.02, color: 0x2a1c12 });
      if (look) o.beanie({ color: 0x1c2434, fold: true }); else o.souwester({ color: 0xe0b020 });
      ropeBandolier(o, { color: 0xa89468, turns: 3 }); if (look) boatHook(o, 'R');
      o.neckerchief({ color: 0xa02a20 });
    },
  },
  // ---------------------------------------------------------------------------------------------- WHARF: fishmonger (PVC apron, long yellow gloves, white boots and cap, cleaver, fish over the shoulder)
  {
    id: 'ferry_fishmonger', name: 'Fishmonger', looks: 2, height: [1.6, 1.86], hp: 1.0,
    body: { gaunt: 0.15, girthRange: [1.02, 1.16] }, skin: { tint: [1.0, 0.98, 0.96], variation: 0.12 },
    layers: { wet: 0.6, blood: 0.9, dust: 0 }, eyes: { glow: 0, cataract: 0.7 }, hair: { color: 0x3a3028, amount: 0.5, beard: 0.5, hairline: 0.55 },
    speedClasses: { walk: 1.0, run: 1.1, sprint: 0.9 }, voice: { f0: 106, formants: [580, 1120, 2500], rasp: 0.5, wet: 0.7, muffle: 0, kind: 'male' },
    wet: true, arms: { reach: 0.3 }, idiosyncrasy: { hunch: [0.05, 0.25] }, helmetY: 1.78, helmetSurface: 'cloth',
    build(o, rng, look) {
      o.body({ skin: 0x8c8a80, girth: 1.08, belly: 0.45, muscle: 0.4, gaunt: 0.1, decay: 0.5, dirt: 0.55, face: { gaunt: 0.35 } });
      o.garment('shirt', { color: look ? 0xd8d4c4 : 0xb8c4cc, pattern: look ? 'stripes' : 'weave', dirt: 0.4, wear: 0.5, sleeve: 4, collar: false, vneck: 0.08 });
      o.garment('pants', { color: look ? 0x8a8c82 : 0x3a3c40, pattern: look ? 'check' : 'canvas', dirt: 0.65, wear: 0.5, detail: 8 });
      o.garment('wellies', { color: look ? 0xe8e6de : 0x2a6a3a, dirt: 0.65, wear: 0.4 });
      o.garment('gloves', { color: 0xe0c020, mat: 'rubber', dirt: 0.7, wear: 0.35 });
      apron(o, look ? 0xd8b830 : 0x3a6ab8);
      fishCap(o, { color: look ? 0xe6e2d4 : 0xd8d4c0 });
      cleaver(o, 'R'); if (rng() < 0.7) fishOverShoulder(o, { color: pick(rng, [0x8a9aa0, 0xa08a70, 0x6a7a80]) });
    },
  },
  // ---------------------------------------------------------------------------------------------- PRISON: guard (uniform, body armour, peaked cap, duty belt + keys, baton, torch)
  {
    id: 'ferry_guard', name: 'Prison Guard', looks: 2, height: [1.7, 1.94], hp: 1.3,
    body: { gaunt: 0.2, girthRange: [1.04, 1.16] }, skin: { tint: [0.97, 0.98, 1.0], variation: 0.1 },
    layers: { blood: 0.6, dust: 0.1, wet: 0.1 }, eyes: { glow: 0, cataract: 0.65 }, hair: { color: 0x2a2620, amount: 0.5, beard: 0.4, hairline: 0.6 },
    speedClasses: { walk: 1.0, run: 1.1, sprint: 0.7 }, voice: { f0: 92, formants: [540, 1010, 2380], rasp: 0.6, wet: 0.3, muffle: 0.1, kind: 'male' },
    arms: { reach: 0.3 }, helmetY: 1.82, helmetSurface: 'cloth',
    build(o, rng, look) {
      o.body({ skin: 0x828680, girth: 1.1, belly: 0.35, muscle: 0.55, gaunt: 0.15, decay: 0.45, dirt: 0.4, face: { gaunt: 0.4 } });
      o.garment('shirt', { color: 0xc8d2e0, pattern: 'weave', dirt: 0.3, wear: 0.4, sleeve: look ? 4 : 6 });
      o.garment('pants', { color: 0x38404c, pattern: 'canvas', dirt: 0.35, wear: 0.4, detail: 8 });
      o.garment('boots', { color: 0x1c1c1e, dirt: 0.35, wear: 0.4, height: 6 });
      o.garment('gloves', { color: 0x1c1c1e, mat: 'leather', dirt: 0.3 });
      o.garment('jacket', { color: look ? 0x566478 : 0x4a5870, pattern: 'canvas', offset: 0.026, loose: 0.012, dirt: 0.35, wear: 0.45, collar: 'stand', collarHeight: 0.05, detail: 1 | 2 | 4 });
      o.garment('vest', { color: look ? 0x3a4450 : 0x2e3640, pattern: 'canvas', layer: 0.06, offset: 0.05, loose: 0.006, dirt: 0.3, wear: 0.4 });                    // body armour
      armourPlates(o, look ? 0x2a3038 : 0x22282e);
      o.belt({ y: 1.0, color: 0x1a1a1c, buckle: true }); dutyKit(o);
      peakedCap(o, { color: look ? 0x566478 : 0x4a5870, band: 0x1c1c20 });
      if (look) baton(o, 'R'); else torch(o, 'R', { glow: 10, color: 0xdfeeff });
    },
  },
  // ---------------------------------------------------------------------------------------------- PRISON: inmate (orange or striped uniform, shaved head, cuffs and a swinging ankle chain) — fast
  {
    id: 'ferry_inmate', name: 'Inmate', looks: 2, height: [1.62, 1.9], hp: 0.9,
    body: { gaunt: 0.7, girthRange: [0.9, 1.0] }, skin: { tint: [0.96, 0.94, 0.92], variation: 0.14 },
    layers: { blood: 0.4, dust: 0.1, wet: 0.15 }, eyes: { glow: 0, cataract: 0.6 }, hair: { color: 0x1a1612, amount: 0.15, bald: 0.85, beard: 0.3, brows: 0.6 },
    speedClasses: { walk: 0.6, run: 1.3, sprint: 1.5 }, voice: { f0: 116, formants: [620, 1180, 2600], rasp: 0.75, wet: 0.3, muffle: 0, kind: 'male' },
    arms: { reach: 0.6 }, idiosyncrasy: { hunch: [0.15, 0.4], tilt: 0.45, limpChance: 0.5 },
    build(o, rng, look) {
      o.body({ skin: 0x86847a, girth: 0.94, belly: 0.05, muscle: 0.5, gaunt: 0.7, decay: 0.5, dirt: 0.55, nails: 0x6a6050, face: { gaunt: 0.9 } });
      if (look) o.garment('coveralls', { color: 0xb8b8b0, pattern: 'stripes', dirt: 0.65, wear: 0.65, sleeve: 6, detail: 1 | 2 | 4 | 8 });      // grey / black striped uniform
      else o.garment('coveralls', { color: 0xe06a1a, pattern: 'canvas', dirt: 0.6, wear: 0.65, sleeve: 6, detail: 1 | 2 | 4 | 8 });               // orange
      o.garment('boots', { color: look ? 0x1a1a1a : 0xd8d6cc, mat: look ? 'leather' : 'rubber', dirt: 0.75, wear: 0.7, height: 8 });
      cuffs(o, { wrists: true, ankles: true }); swingChain(o, 'calf.' + (rng() < 0.5 ? 'L' : 'R'), 0.86, 6);
      o.parts.custom((oo) => { const p = oo.snap(new V(-0.09, 1.3, 0.0), new V(0, 0, -1), 0.12); oo._box({ bind: 'auto', p: [p.x, p.y, p.z - 0.004], s: [0.085, 0.045, 0.004], mat: 'plastic', color: 0xe8e4d4, rough: 0.6, wear: 0.5, dirt: 0.6 }); });  // ID plate on the chest
    },
  },
  // ---------------------------------------------------------------------------------------------- LIGHTHOUSE: keeper (knee-length oilskin coat, sou'wester, storm lantern that glows) — big white beard
  {
    id: 'ferry_keeper', name: 'Lighthouse Keeper', looks: 2, height: [1.62, 1.84], hp: 1.25,
    body: { gaunt: 0.4, girthRange: [1.0, 1.1] }, skin: { tint: [0.94, 0.97, 1.02], variation: 0.1 },
    layers: { wet: 0.85, blood: 0.3, dust: 0 }, eyes: { glow: 1.6, color: 0xffc070, cataract: 0.5 }, hair: { color: 0xd4d0c8, amount: 0.85, beard: 1.0, hairline: 0.5 },
    speedClasses: { walk: 1.2, run: 1.0, sprint: 0.5 }, voice: { f0: 88, formants: [500, 940, 2250], rasp: 0.65, wet: 0.7, muffle: 0.15, kind: 'male' },
    wet: true, arms: { reach: 0.45 }, idiosyncrasy: { hunch: [0.2, 0.45] }, emissiveColor: 0xffc070, helmetY: 1.78, helmetSurface: 'cloth',
    build(o, rng, look) {
      o.body({ skin: 0x848a86, girth: 1.04, belly: 0.3, muscle: 0.3, gaunt: 0.4, decay: 0.55, dirt: 0.45, face: { gaunt: 0.65, bloat: 0.2 } });
      o.garment('shirt', { color: 0xa0a09a, pattern: 'check', dirt: 0.4, wear: 0.6, sleeve: 6 });
      const coat = look ? 0xdca420 : 0x36603f;
      o.garment('pants', { color: look ? 0x54585e : coat, pattern: look ? 'canvas' : 'oilskin', rough: 0.55, dirt: 0.45, wear: 0.6, detail: look ? 8 : 0 });
      o.garment('jacket', { color: coat, pattern: 'oilskin', rough: 0.55, offset: 0.034, loose: 0.034, dirt: 0.45, wear: 0.65, collar: 'stand', collarHeight: 0.08, detail: 1 | 4 });
      o.garment('wellies', { color: 0x2a2c2a, dirt: 0.5, wear: 0.5 });
      o.souwester({ color: coat });
      o.belt({ y: 1.02, color: 0x2a1c12 }); o.neckerchief({ color: 0x9a7a30 });
      lantern(o, 'L', { glow: 6, color: 0xffc070 });
    },
  },
];

registerVariants('last-ferry', LAST_FERRY_VARIANTS, { aliases: { dockworker: 'ferry_dockworker', drowned: 'ferry_drowned', sailor: 'ferry_sailor', fishmonger: 'ferry_fishmonger', guard: 'ferry_guard', inmate: 'ferry_inmate', keeper: 'ferry_keeper', drowned_docker: 'ferry_drowned' } });
