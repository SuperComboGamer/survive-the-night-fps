// LAST FERRY — ground decal atlas (round 3): ONE transparent lit plane set per stop (a single draw) carrying hand-painted wear that a real working harbour has everywhere:
// oil stains with dark cores, tar / bitumen patches with lifted edges, crack networks, worn paint marks, wet footprints along the walking routes, tyre arcs, rust + salt streak fans below bolts,
// standing-water rings, and dense litter (paper, leaves, cigarette butts, bottle caps, plastic, fish scales, rope offcuts, wood chips, feathers, bird droppings, seaweed).
// Every tile is a rectangle in stop-local metres painted at ~2 cm / texel. Deterministic per stop seed.
import * as THREE from 'three';
import { litter3D } from './detail3.js';
import { std } from '../../core/mats.js';

const TAU = Math.PI * 2;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function paintTile(c, T, tl, r) {
  const sx = T / tl.w, sz = T / tl.d, area = tl.w * tl.d, kind = tl.kind || 'deck', X = (x) => (x - tl.x) * sx, Z = (z) => (z - tl.z) * sz;
  const rr = (a, b) => a + (b - a) * r();
  const blob = (x, z, rx, rz, rot, rgb, a, soft = true) => { c.save(); c.translate(X(x), Z(z)); c.rotate(rot); c.scale(rx * sx, rz * sz); const g = c.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(soft ? 0.55 : 0.9, `rgba(${rgb},${a * 0.8})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill(); c.restore(); };
  const poly = (x, z, w, d, rot, rgb, a, jag = 0.08) => { c.save(); c.translate(X(x), Z(z)); c.rotate(rot); c.fillStyle = `rgba(${rgb},${a})`; c.beginPath(); const n = 10; for (let i = 0; i < n; i++) { const t = i / n; let px, pz; if (t < 0.25) { px = -w / 2 + w * t * 4; pz = -d / 2; } else if (t < 0.5) { px = w / 2; pz = -d / 2 + d * (t - 0.25) * 4; } else if (t < 0.75) { px = w / 2 - w * (t - 0.5) * 4; pz = d / 2; } else { px = -w / 2; pz = d / 2 - d * (t - 0.75) * 4; } px += (r() - 0.5) * jag * w; pz += (r() - 0.5) * jag * d; c.lineTo(px * sx, pz * sz); } c.closePath(); c.fill(); c.strokeStyle = `rgba(150,150,145,${a * 0.22})`; c.lineWidth = 1.5; c.stroke(); c.restore(); };
  const walk = (x, z, len, rgb, a, wpx) => { c.strokeStyle = `rgba(${rgb},${a})`; c.lineWidth = wpx; c.lineCap = 'round'; let ang = r() * TAU, px = x, pz = z; c.beginPath(); c.moveTo(X(px), Z(pz)); for (let i = 0; i < len / 0.12; i++) { ang += (r() - 0.5) * 1.1; px += Math.cos(ang) * 0.12; pz += Math.sin(ang) * 0.12; c.lineTo(X(px), Z(pz)); if (r() < 0.06) { const sa = ang + (r() < 0.5 ? 1 : -1) * 0.9; let qx = px, qz = pz; c.moveTo(X(qx), Z(qz)); for (let k = 0; k < 4; k++) { qx += Math.cos(sa + (r() - 0.5) * 0.6) * 0.1; qz += Math.sin(sa + (r() - 0.5) * 0.6) * 0.1; c.lineTo(X(qx), Z(qz)); } c.moveTo(X(px), Z(pz)); } } c.stroke(); };
  const spot = () => [tl.x + r() * tl.w, tl.z + r() * tl.d];
  // --- standing-water rings + oil (dark, soft) + tar patches
  for (let i = 0; i < area / 22; i++) { const [x, z] = spot(), s = rr(0.25, 0.9), rot = r() * TAU; blob(x, z, s, s * rr(0.5, 0.9), rot, '6,7,9', rr(0.28, 0.55)); blob(x + rr(-0.1, 0.1), z + rr(-0.1, 0.1), s * 0.45, s * 0.3, rot + 0.5, '3,3,4', rr(0.3, 0.6)); }
  if (kind !== 'jetty') for (let i = 0; i < area / 70; i++) { const [x, z] = spot(); poly(x, z, rr(0.5, 2.4), rr(0.4, 1.4), (r() < 0.5 ? 0 : Math.PI / 2) + rr(-0.05, 0.05), '18,18,20', rr(0.45, 0.7)); }
  for (let i = 0; i < area / 55; i++) { const [x, z] = spot(), s = rr(0.4, 1.3); c.strokeStyle = 'rgba(190,200,205,0.17)'; c.lineWidth = 2; c.beginPath(); c.ellipse(X(x), Z(z), s * sx * 0.5, s * sz * 0.33, r() * TAU, 0, TAU); c.stroke(); blob(x, z, s * 0.5, s * 0.33, 0, '4,6,8', 0.22); }
  // --- cracks (random walks with branches) and paint marks
  for (let i = 0; i < area / 7; i++) { const [x, z] = spot(); walk(x, z, rr(0.7, 3), '0,0,0', rr(0.45, 0.75), rr(1.2, 3.2)); }
  for (let i = 0; i < area / 26; i++) { const [x, z] = spot(); c.save(); c.translate(X(x), Z(z)); c.rotate(kind === 'deck' ? 0 : (r() < 0.5 ? 0 : Math.PI / 2)); c.fillStyle = r() < 0.5 ? 'rgba(214,190,60,0.55)' : 'rgba(216,214,200,0.5)'; c.fillRect(0, 0, rr(0.5, 2.2) * sx, rr(0.06, 0.16) * sz); c.restore(); }
  // --- tyre arcs (concrete / cobble) and wear paths
  if (kind === 'concrete' || kind === 'cobble') for (let i = 0; i < area / 60; i++) { const [x, z] = spot(), R = rr(2, 7), a0 = r() * TAU; c.strokeStyle = 'rgba(8,8,9,0.3)'; c.lineWidth = rr(6, 10); c.beginPath(); c.arc(X(x), Z(z), R * sx, a0, a0 + rr(0.4, 1.1)); c.stroke(); }
  // --- kind specific: slime / ice water / seaweed / salt
  if (kind === 'cobble') for (let i = 0; i < area / 18; i++) { const [x, z] = spot(); blob(x, z, rr(0.3, 0.8), rr(0.2, 0.5), r() * TAU, '24,64,52', rr(0.22, 0.4)); if (r() < 0.5) blob(x, z, rr(0.2, 0.5), rr(0.15, 0.3), r() * TAU, '150,170,178', rr(0.1, 0.2)); }
  if (kind === 'jetty') { for (let i = 0; i < area / 10; i++) { const [x, z] = spot(); walk(x, z, rr(0.3, 1.0), '40,58,34', rr(0.5, 0.85), rr(2, 4)); } for (let i = 0; i < area / 20; i++) { const [x, z] = spot(); blob(x, z, rr(0.4, 1.1), rr(0.3, 0.7), r() * TAU, '196,198,188', rr(0.1, 0.22)); } }
  // --- rust + salt streak fans below fixings, dripping toward +z / water side
  for (const [bx, bz] of (tl.rust || [])) { if (bx < tl.x || bx > tl.x + tl.w || bz < tl.z || bz > tl.z + tl.d) continue; for (let k = 0; k < 7; k++) { const a = (tl.rustDir ?? Math.PI / 2) + rr(-0.5, 0.5), L = rr(0.25, 0.9); const g = c.createLinearGradient(X(bx), Z(bz), X(bx + Math.cos(a) * L), Z(bz + Math.sin(a) * L)); g.addColorStop(0, 'rgba(120,58,24,0.6)'); g.addColorStop(1, 'rgba(120,58,24,0)'); c.strokeStyle = g; c.lineWidth = rr(3, 7); c.beginPath(); c.moveTo(X(bx), Z(bz)); c.lineTo(X(bx + Math.cos(a) * L), Z(bz + Math.sin(a) * L)); c.stroke(); } blob(bx, bz, 0.12, 0.12, 0, '90,44,20', 0.5); }
  // --- wet footprints along the walking routes (dark soles + heels, alternating feet)
  for (const path of (tl.paths || [])) { let carry = 0, foot = 1; for (let i = 0; i < path.length - 1; i++) { const [x0, z0] = path[i], [x1, z1] = path[i + 1], L = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0); for (let d = carry; d < L; d += 0.72) { const px = x0 + Math.cos(ang) * d + Math.cos(ang + Math.PI / 2) * 0.11 * foot + (r() - 0.5) * 0.06, pz = z0 + Math.sin(ang) * d + Math.sin(ang + Math.PI / 2) * 0.11 * foot + (r() - 0.5) * 0.06; if (px > tl.x && px < tl.x + tl.w && pz > tl.z && pz < tl.z + tl.d) { const fade = 0.5 + r() * 0.4; c.save(); c.translate(X(px), Z(pz)); c.rotate(ang + (r() - 0.5) * 0.25); c.fillStyle = `rgba(6,8,10,${0.3 * fade})`; c.beginPath(); c.ellipse(0.06 * sx, 0, 0.13 * sx, 0.048 * sz, 0, 0, TAU); c.fill(); c.beginPath(); c.ellipse(-0.14 * sx, 0, 0.05 * sx, 0.04 * sz, 0, 0, TAU); c.fill(); c.restore(); } foot = -foot; carry = d + 0.72 - L; } } }
  // --- litter: dense (about one item per m2 or more)
  const nLit = Math.floor(area * (tl.litter ?? 1.1));
  for (let i = 0; i < nLit; i++) { const [x, z] = spot(), t = r(); c.save(); c.translate(X(x), Z(z)); c.rotate(r() * TAU);
    if (t < 0.24) { c.fillStyle = `rgba(${196 + r() * 40 | 0},${192 + r() * 36 | 0},${176 + r() * 30 | 0},${0.7 + r() * 0.25})`; c.beginPath(); const w = rr(0.05, 0.16) * sx, h = rr(0.04, 0.12) * sz; c.moveTo(-w / 2, -h / 2); c.lineTo(w / 2, -h * (0.3 + r() * 0.3)); c.lineTo(w * (0.3 + r() * 0.3), h / 2); c.lineTo(-w / 2, h * (0.2 + r() * 0.3)); c.closePath(); c.fill(); }
    else if (t < 0.38) { c.fillStyle = `rgba(${40 + r() * 40 | 0},${34 + r() * 30 | 0},${16 + r() * 16 | 0},0.85)`; c.beginPath(); c.ellipse(0, 0, rr(0.03, 0.07) * sx, rr(0.015, 0.032) * sz, 0, 0, TAU); c.fill(); }
    else if (t < 0.48) { c.fillStyle = 'rgba(224,222,212,0.95)'; c.fillRect(0, 0, 0.05 * sx, 0.011 * sz); c.fillStyle = 'rgba(210,110,40,0.95)'; c.fillRect(0.038 * sx, 0, 0.012 * sx, 0.011 * sz); }
    else if (t < 0.56) { c.fillStyle = 'rgba(150,152,146,0.95)'; c.beginPath(); c.arc(0, 0, 0.015 * sx, 0, TAU); c.fill(); c.strokeStyle = 'rgba(40,40,40,0.8)'; c.lineWidth = 1; c.stroke(); }
    else if (t < 0.66) { c.fillStyle = `rgba(${60 + r() * 30 | 0},${100 + r() * 60 | 0},${130 + r() * 60 | 0},0.5)`; c.beginPath(); c.ellipse(0, 0, rr(0.04, 0.11) * sx, rr(0.03, 0.08) * sz, 0, 0, TAU); c.fill(); }
    else if (t < 0.74) { c.strokeStyle = `rgba(${120 + r() * 30 | 0},${96 + r() * 20 | 0},${60},0.9)`; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(0.05 * sx, -0.05 * sz, 0.1 * sx, 0.05 * sz, 0.16 * sx, 0); c.stroke(); }
    else if (t < 0.81) { c.fillStyle = 'rgba(110,84,52,0.95)'; c.fillRect(0, 0, rr(0.05, 0.16) * sx, rr(0.012, 0.03) * sz); }
    else if (t < 0.87) { c.fillStyle = kind === 'cobble' ? 'rgba(200,216,224,0.9)' : 'rgba(230,230,224,0.85)'; for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(rr(-0.06, 0.06) * sx, rr(-0.05, 0.05) * sz, rr(0.006, 0.012) * sx, 0, TAU); c.fill(); } }
    else if (t < 0.93) { c.strokeStyle = 'rgba(230,230,224,0.85)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(0.05 * sx, -0.03 * sz, 0.1 * sx, 0.01 * sz); c.stroke(); }
    else { c.fillStyle = 'rgba(232,232,226,0.9)'; c.beginPath(); c.ellipse(0, 0, rr(0.02, 0.05) * sx, rr(0.015, 0.035) * sz, 0, 0, TAU); c.fill(); c.fillStyle = 'rgba(180,180,170,0.6)'; c.beginPath(); c.arc(rr(-0.03, 0.03) * sx, rr(-0.03, 0.03) * sz, 0.01 * sx, 0, TAU); c.fill(); }
    c.restore(); }
  // --- final scuff: erase random specks so nothing reads as a clean stamp
  c.globalCompositeOperation = 'destination-out'; for (let i = 0; i < area * 3; i++) { c.fillStyle = `rgba(0,0,0,${r() * 0.6})`; c.fillRect(r() * T, r() * T, r() * 5 + 1, r() * 4 + 1); } c.globalCompositeOperation = 'source-over';
}

/** tiles: [{x, z, w, d (metres, stop-local), kind:'deck'|'cobble'|'concrete'|'jetty', y (optional), rust:[[x,z]...], paths:[[[x,z]...]], litter (items / m2)}]. o: {y, seed, tex (px per tile, default 1024)} */
export function decalAtlas(K, tiles, o = {}) {
  const B = K.B, T = o.tex ?? 1024, cols = 2, rows = Math.ceil(tiles.length / cols), W = T * cols, H = T * rows, r = mulberry(o.seed ?? 5);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d', { willReadFrequently: true }); c.clearRect(0, 0, W, H);
  tiles.forEach((tl, i) => { const ox = (i % cols) * T, oy = Math.floor(i / cols) * T; c.save(); c.beginPath(); c.rect(ox, oy, T, T); c.clip(); c.translate(ox, oy); paintTile(c, T, tl, r); c.restore(); });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const mat = B.m('decalAtlas' + (o.seed ?? 5), std({ map: tex, transparent: true, depthWrite: false, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const P = [], N = [], U = [], I = [];
  tiles.forEach((tl, i) => { const ox = (i % cols) * T, oy = Math.floor(i / cols) * T, y = tl.y ?? o.y, k = P.length / 3; const u0 = ox / W, u1 = (ox + T) / W, v0 = 1 - (oy + T) / H, v1 = 1 - oy / H;
    P.push(tl.x, y, tl.z, tl.x + tl.w, y, tl.z, tl.x + tl.w, y, tl.z + tl.d, tl.x, y, tl.z + tl.d); for (let q = 0; q < 4; q++) N.push(0, 1, 0); U.push(u0, v1, u1, v1, u1, v0, u0, v0); I.push(k, k + 3, k + 2, k, k + 2, k + 1); });
  B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4(), mat, { cast: false });
  if (o.litter3D !== false) litter3D(K, tiles, { y: o.y, rng: K.rng });
  return mat;
}
