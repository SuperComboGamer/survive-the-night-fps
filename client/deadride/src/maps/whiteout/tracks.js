// Tracks in the snow: boot-print trails, ski / snowmobile grooves and groomer tread bands, as terrain-conforming ribbons with a baked normal map
// (the dents catch the lamp light on their rims and fill with blue shade). Each texture is drawn as a depth map on a canvas, then turned into
// tangent-space normals + a soft alpha albedo, so the prints are real relief, not stickers.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { makeRng } from '../../core/util.js';

const cache = {}; const KINDS_SCALE = { 'trk-foot': 0.5, 'trk-ski': 0.5, 'trk-tread': 0.5 };
/** draw(g, W, H, rng) paints DEPTH (white = deep) on a canvas; returns {map (rgba albedo), normalMap} */
function relief(key, W, H, draw, { strength = 4.0, tint = [0.62, 0.7, 0.84], alphaK = 0.85 } = {}) {
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); { const k0 = KINDS_SCALE[key] || 1; g.save(); g.scale(k0, k0); draw(g, W / k0, H / k0, makeRng(key.length * 77 + 5)); g.restore(); }
  const d0 = g.getImageData(0, 0, W, H).data, dd = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) a += d0[(((y + j + H) % H) * W + ((x + i + W) % W)) * 4] * (i === 0 && j === 0 ? 4 : 1); dd[y * W + x] = a / (12 * 255); }      // 3x3 smoothing (replaces the slow canvas blur filter)
  const dep = (x, y) => dd[((y + H) % H) * W + ((x + W) % W)];
  const nc = document.createElement('canvas'); nc.width = W; nc.height = H; const ng = nc.getContext('2d'); const ni = ng.createImageData(W, H);
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H; const ag = ac.getContext('2d'); const ai = ag.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = dep(x + 1, y) - dep(x - 1, y), dy = -(dep(x, y + 1) - dep(x, y - 1)); let nx = dx * strength, ny = dy * strength; const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l; const nz = 1 / l; const i = (y * W + x) * 4;
    ni.data[i] = (nx * 0.5 + 0.5) * 255; ni.data[i + 1] = (ny * 0.5 + 0.5) * 255; ni.data[i + 2] = (nz * 0.5 + 0.5) * 255; ni.data[i + 3] = 255;
    const a = Math.min(1, dep(x, y) * alphaK * 1.15); const sh = 0.82 + 0.18 * (1 - dep(x, y)); ai.data[i] = tint[0] * 255 * sh; ai.data[i + 1] = tint[1] * 255 * sh; ai.data[i + 2] = tint[2] * 255 * sh; ai.data[i + 3] = a * 255;
  }
  ng.putImageData(ni, 0, 0); ag.putImageData(ai, 0, 0);
  const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  return (cache[key] = { map: mk(ac, true), normalMap: mk(nc, false) });
}
const soft = () => {};
const ell = (g, x, y, rx, ry, rot, v) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = `rgba(255,255,255,${v})`; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 7); g.fill(); g.restore(); };

/** kinds: width (m), tile (m along the trail), texture size */
const KINDS = {
  foot: { w: 0.8, tile: 1.6, W: 64, H: 128, draw: (g, W, H, rng) => {           // 160 px/m: two boots per tile, forefoot + heel, eroded edges
    soft(g, 1.4); for (const [u, v, rot] of [[0.30, 0.22, -0.05], [0.68, 0.72, 0.06]]) { const x = u * W + (rng() - 0.5) * 6, y = v * H; ell(g, x, y - 16, 9.5, 20, rot, 0.95); ell(g, x, y + 22, 7, 8, rot, 0.85); ell(g, x, y - 16, 5.5, 14, rot, 0.4); }
    g.filter = 'none'; g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(0,0,0,${0.15 + rng() * 0.3})`; g.fillRect(rng() * W, rng() * H, 3 + rng() * 8, 1 + rng() * 3); } g.globalCompositeOperation = 'source-over'; } },
  ski: { w: 1.6, tile: 1.4, W: 64, H: 64, draw: (g, W, H, rng) => {              // two grooves 1.0 m apart with a packed rib in the middle of each
    soft(g, 2); for (const cx of [W * 0.2, W * 0.8]) { g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(cx - 9, 0, 18, H); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(cx - 2, 0, 4, H); }
    g.filter = 'none'; for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(255,255,255,${0.1 + rng() * 0.2})`; g.fillRect(rng() * W, rng() * H, 4 + rng() * 10, 2); } } },
  tread: { w: 4.2, tile: 1.1, W: 128, H: 32, draw: (g, W, H, rng) => {              // two cleated bands (groomer) 2.6 m apart: chevron cleats
    soft(g, 1.1); for (const cx of [W * 0.16, W * 0.84]) { for (let k = 0; k < 4; k++) { const y = (k + 0.5) * H / 4; g.save(); g.translate(cx, y); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 5; g.beginPath(); g.moveTo(-26, -7); g.lineTo(0, 3); g.lineTo(26, -7); g.stroke(); g.restore(); }
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(cx - 30, 0, 60, H); }
    g.filter = 'none'; for (let i = 0; i < 24; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + rng() * 0.3})`; g.fillRect(rng() * W, rng() * H, 3 + rng() * 9, 2); } } },
};
export function trackMaterial(B, kind) {
  const K = KINDS[kind], t = relief('trk-' + kind, K.W, K.H, K.draw, { strength: kind === 'foot' ? 5 : 3.2 });
  const m = B.m('trk_' + kind, std({ map: t.map, normalMap: t.normalMap, normalScale: 1.0, roughness: 0.7, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.FrontSide, snow: 0.3 }));
  m.userData.kind = K; return m;
}

/** a smooth ribbon of tracks along control points [[x,z]..] (stop-local), lying on the terrain H(x,z) + lift */
export function trail(B, kind, pts, H, { lift = 0.03, step = 0.9, jitter = 0 } = {}) {
  const K = KINDS[kind], mat = trackMaterial(B, kind); const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
  const n = Math.max(4, Math.round(curve.getLength() / step)), P = [], N = [], U = [], I = []; let s = 0, prev = null; const rng = makeRng(pts.length * 13 + 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPoint(t), tg = curve.getTangent(t); const lx = -tg.z, lz = tg.x; if (prev) s += Math.hypot(p.x - prev.x, p.z - prev.z); prev = p;
    const jx = jitter ? (rng() - 0.5) * jitter : 0;
    for (const side of [-1, 1]) { const x = p.x + lx * side * K.w / 2 + lx * jx, z = p.z + lz * side * K.w / 2 + lz * jx; P.push(x, H(x, z) + lift, z); N.push(0, 1, 0); U.push(side < 0 ? 0 : 1, s / K.tile); }
    if (i > 0) { const a = (i - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4(), mat, { cast: false, recv: true });
}
