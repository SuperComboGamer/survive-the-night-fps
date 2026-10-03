// AFTER HOURS — weathering as decals: streaks under sills and cornices, rust bleeding from fixings, efflorescence, peeling paint, cracks, moss, base splash, soot, mildew.
// One 4x4 alpha atlas per stop (one extra transparent draw), thousands of vertical quads scattered on wall faces with the physical logic of water running down and dirt collecting low.
import * as THREE from 'three';
import { makeRng } from '../../core/util.js';
import { decalAtlas, placeVertical, flushVertical, blob, soft } from './detail.js';
import { TAU, PI } from './common.js';

const rgba = (c, a) => c.replace('A', String(a));
/** tone: { dirt:'rgba(38,30,24,A)', damp:'rgba(20,26,22,A)', rust:'rgba(140,70,30,A)', salt:'rgba(220,220,205,A)', moss:'rgba(50,80,36,A)', paint:'rgba(200,190,170,A)', crack:'rgba(6,6,8,0.85)' } */
export function grimeAtlas(name, T, seed = 5) {
  const P = [
    (c, w, h, r) => { const x = w / 2 + (r() - 0.5) * 8; for (let k = 0; k < 2; k++) { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, rgba(T.dirt, 0.7)); g.addColorStop(0.5, rgba(T.dirt, 0.5)); g.addColorStop(1, rgba(T.dirt, 0)); c.fillStyle = g; c.beginPath(); c.moveTo(x - 7 + k * 3, 0); c.lineTo(x + 7 - k * 3, 0); c.bezierCurveTo(x + 5 + r() * 6, h * 0.4, x - 6 + r() * 12, h * 0.7, x + (r() - 0.5) * 10, h); c.bezierCurveTo(x - 6 + r() * 12, h * 0.7, x - 5, h * 0.4, x - 7 + k * 3, 0); c.fill(); } },        // drip streak
    (c, w, h, r) => { for (const dx of [-20, -6, 12, 26]) { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, rgba(T.dirt, 0.42)); g.addColorStop(1, rgba(T.dirt, 0)); c.fillStyle = g; c.fillRect(w / 2 + dx + (r() - 0.5) * 4, 0, 2.5 + r() * 3, h * (0.5 + r() * 0.5)); } },                                                                                                                           // thin parallel runs
    (c, w, h, r) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, rgba(T.damp, 0.0)); g.addColorStop(0.35, rgba(T.damp, 0.32)); g.addColorStop(0.92, rgba(T.damp, 0.42)); g.addColorStop(1, rgba(T.salt, 0.32)); c.fillStyle = g; c.beginPath(); c.moveTo(6, 0); c.lineTo(w - 6, 0); for (let i = 0; i <= 8; i++) c.lineTo(w - 6 - (r() * 8), h * i / 8); for (let i = 8; i >= 0; i--) c.lineTo(6 + r() * 8, h * i / 8); c.fill(); },   // damp stain with a tide line
    (c, w, h, r) => { c.strokeStyle = rgba(T.rust, 0.6); c.lineCap = 'round'; c.lineWidth = 1.6 + r() * 1.4; c.beginPath(); c.moveTo(w / 2, 6); c.bezierCurveTo(w / 2 + 6, h * 0.3, w / 2 - 5, h * 0.6, w / 2 + (r() - 0.5) * 8, h - 4); c.stroke(); blob(c, w / 2, 8, 4, rgba(T.rust, 0.9), 0.85, 8, r, 0.3); const g = c.createLinearGradient(0, 8, 0, h); g.addColorStop(0, rgba(T.rust, 0.28)); g.addColorStop(1, rgba(T.rust, 0)); c.fillStyle = g; c.fillRect(w / 2 - 9, 8, 18, h - 8); },   // rust bleed from a fixing
    (c, w, h, r) => { const g = c.createLinearGradient(0, h, 0, 0); g.addColorStop(0, rgba(T.dirt, 0.6)); g.addColorStop(0.5, rgba(T.dirt, 0.22)); g.addColorStop(1, rgba(T.dirt, 0)); c.fillStyle = g; c.fillRect(0, 0, w, h); for (let i = 0; i < 26; i++) blob(c, r() * w, h * (0.55 + r() * 0.45), 2 + r() * 5, rgba(T.dirt, 0.6), 0.4, 6, r); },      // base splash / grime band
    (c, w, h, r) => { for (let k = 0; k < 22; k++) blob(c, w * (0.1 + r() * 0.8), h * (0.15 + r() * 0.85), 3 + r() * 9, rgba(T.moss, 0.85), 0.5, 7, r, 0.5); },     // moss patches
    (c, w, h, r) => { c.fillStyle = rgba(T.paint, 0.9); blob(c, w / 2, h / 2, 26 + r() * 10, rgba(T.paint, 0.9), 0.85, 11, r, 0.55); c.strokeStyle = 'rgba(20,16,12,0.55)'; c.lineWidth = 2; c.beginPath(); for (let i = 0; i <= 11; i++) { const a = i / 11 * TAU, rr = 27 + r() * 9; c.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr); } c.closePath(); c.stroke(); },   // peeled paint patch
    (c, w, h, r) => { soft(c, w / 2, h * 0.55, w * 0.46, rgba('rgba(10,8,8,A)', 0.55), 0.55); },                                                                       // soot
    (c, w, h, r) => { c.strokeStyle = 'rgba(230,226,214,0.5)'; c.lineWidth = 1; for (let i = 0; i < 14; i++) { const x = w * (0.15 + r() * 0.7), y = h * (0.1 + r() * 0.6); c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 6, y + 10 + r() * 34); c.stroke(); } },   // scratches
    (c, w, h, r) => { c.strokeStyle = T.crack; c.lineCap = 'round'; const br = (x, y, a, len, wd) => { if (len < 5 || wd < 0.4) return; c.lineWidth = wd; c.beginPath(); c.moveTo(x, y); let px = x, py = y; for (let s = 0; s < 6; s++) { px += Math.cos(a) * len / 6 + (r() - 0.5) * 3; py += Math.sin(a) * len / 6 + (r() - 0.5) * 2; c.lineTo(px, py); } c.stroke(); if (r() < 0.7) br(px, py, a + (r() - 0.5) * 1.2, len * 0.6, wd * 0.6); if (r() < 0.4) br(x + (px - x) * 0.5, y + (py - y) * 0.5, a + (r() < 0.5 ? 1 : -1) * 0.9, len * 0.4, wd * 0.5); }; br(w / 2, 6, PI / 2 + (r() - 0.5) * 0.4, 96, 2.2); },   // crack
    (c, w, h, r) => { for (let i = 0; i < 60; i++) { c.fillStyle = rgba(T.moss, 0.6 * r()); c.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); } for (let k = 0; k < 6; k++) blob(c, r() * w, r() * h, 6 + r() * 8, rgba(T.damp, 0.5), 0.3, 7, r); },   // mildew speckle
    (c, w, h, r) => { for (let k = 0; k < 8; k++) blob(c, w * (0.15 + r() * 0.7), h * (0.1 + r() * 0.5), 5 + r() * 10, rgba(T.salt, 0.8), 0.4, 8, r, 0.5); const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, rgba(T.salt, 0.3)); g.addColorStop(1, rgba(T.salt, 0)); c.fillStyle = g; c.fillRect(w * 0.2, 0, w * 0.6, h); },   // efflorescence
    (c, w, h, r) => { c.fillStyle = rgba(T.paint, 0.5); c.fillRect(w * 0.22, h * 0.15, w * 0.56, h * 0.7); c.fillStyle = rgba(T.dirt, 0.35); for (let i = 0; i < 40; i++) c.fillRect(w * (0.22 + r() * 0.56), h * (0.15 + r() * 0.7), 2 + r() * 4, 1 + r() * 2); },   // old poster / paste remnant
    (c, w, h, r) => { for (let i = 0; i < 90; i++) { c.fillStyle = 'rgba(200,196,180,' + (0.3 + 0.5 * r()) + ')'; c.beginPath(); c.arc(r() * w, r() * h, 1 + r() * 2.4, 0, TAU); c.fill(); } },   // barnacles / grit
    (c, w, h, r) => { const g = c.createRadialGradient(w / 2, h, 0, w / 2, h, w * 0.7); g.addColorStop(0, rgba(T.dirt, 0.45)); g.addColorStop(1, rgba(T.dirt, 0)); c.fillStyle = g; c.fillRect(0, 0, w, h); },   // corner dirt
  ];
  return decalAtlas(name, P, { rough: 0.95, seed, env: 0.4 });
}

const KINDS = [ // [cell, wMin, wMax, hMin, hMax, weight, bias]   bias: 0 = uniform, 1 = low on the wall, -1 = high
  [0, 0.28, 0.42, 1.0, 2.8, 6, 0], [1, 0.4, 0.55, 0.9, 2.2, 3, 0], [2, 0.7, 1.5, 1.0, 2.6, 2, 0], [3, 0.2, 0.4, 0.7, 1.7, 3, 0], [4, 1.6, 3.4, 0.5, 1.1, 4, 1], [5, 0.7, 1.7, 0.7, 1.7, 2, 1], [6, 0.4, 1.1, 0.4, 1.1, 2, 0], [7, 0.6, 1.3, 0.6, 1.3, 1, -1],
  [8, 0.4, 0.9, 0.6, 1.4, 2, 0], [9, 0.3, 0.7, 0.9, 2.0, 2, 0], [10, 0.5, 1.2, 0.5, 1.2, 2, 0], [11, 0.5, 1.3, 0.7, 1.7, 2, 0], [12, 0.3, 0.6, 0.4, 0.8, 1, 0], [13, 0.5, 1.4, 0.4, 1.1, 2, 1], [14, 0.8, 1.6, 0.8, 1.6, 2, 1],
];
/** scatter `n` weathering decals on a wall face. p = bottom-left corner seen from outside, yaw so local +Z is the outward normal (u runs along the wall). `kinds` limits the atlas cells used. */
export function grimeFace(B, atlas, rng, { p, yaw = 0, w, h, n, y0 = 0, kinds = null, lift = 0.012 }) {
  const list = kinds ? KINDS.filter((k) => kinds.includes(k[0])) : KINDS, tot = list.reduce((a, k) => a + k[5], 0), c = Math.cos(yaw), s = Math.sin(yaw), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), m = new THREE.Matrix4(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) { let t = rng() * tot, k = list[0]; for (const e of list) { t -= e[5]; if (t <= 0) { k = e; break; } }
    const dw = k[1] + rng() * (k[2] - k[1]), dh = k[3] + rng() * (k[4] - k[3]); const u = dw / 2 + rng() * Math.max(0.01, w - dw); let vv = y0 + (h - y0) * (k[6] > 0 ? Math.pow(rng(), 2.2) : k[6] < 0 ? 1 - Math.pow(rng(), 2.2) : rng());
    if (k[0] === 0 || k[0] === 1 || k[0] === 3 || k[0] === 8 || k[0] === 9) vv = Math.min(h, vv + dh / 2);   // drips start at a source and run down
    v.set(p[0] + u * c + lift * s, p[1] + vv - dh / 2 * (k[6] === 0 ? 1 : 0.2), p[2] - u * s + lift * c); m.compose(v, q, one); placeVertical(B, atlas, k[0], m, null, [dw, dh, 0, 0]); }
}
/** merge every decal placed so far into ONE mesh (call once per stop, after all faces) */
export const grimeFlush = flushVertical;
