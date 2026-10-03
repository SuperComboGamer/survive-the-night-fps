// Wall-buy chalk outline + HUD icon, generated from the real model. The side view (muzzle LEFT) of every triangle is
// rasterised painter-style (far flank first) into a region map where each (material, moving part) pair has its own id,
// so the drawing gets the silhouette AND the interior lines between parts (slide / frame, stock / receiver, magazine ...).
// Chalk: rough silhouette band + thinner interior strokes with grain, streaks and gaps; icon: flat silhouette with shading.
import { gfx as GFX } from '../../core/gfx.js';
import { gunMats } from './materials.js';
import { modelData } from './rig.js';
import { MODELS } from './models/index.js';

const cacheO = new Map(), cacheI = new Map(), cacheM = new Map();
const WOODISH = /walnut|laminate|plum|bakelite|polymer|rubber|glove|leather/;

function mask(id, W) {
  const k = id + ':' + W; if (cacheM.has(k)) return cacheM.get(k);
  const def = MODELS[id]; if (!def) return null; const data = modelData(def, gunMats(GFX.renderer));
  const b = data.box; const L = b.max.z - b.min.z, Hh = b.max.y - b.min.y; const pad = Math.round(W * 0.04); const s = (W - pad * 2) / L; const H = Math.ceil(Hh * s + pad * 2);
  const X = (z) => pad + (z - b.min.z) * s, Y = (y) => pad + (b.max.y - y) * s;
  // exact z-buffered rasteriser (no canvas anti-aliasing: region ids stay exact). Muzzle left + y up => the viewer is on
  // the -x side (left flank): smaller x = nearer. One region id per (material, moving part).
  const m = new Uint8Array(W * H), reg = new Uint16Array(W * H), zb = new Float32Array(W * H).fill(1e9), regions = new Map(), soft = [0];
  for (const [mk, geo] of data.geos) {
    const P = geo.attributes.position.array, I = geo.index.array, SI = geo.attributes.skinIndex ? geo.attributes.skinIndex.array : null;
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i] * 3, c = I[i + 1] * 3, d = I[i + 2] * 3; const bone = SI ? SI[I[i] * 4] : 0; const rk = mk + '|' + bone;
      let r = regions.get(rk); if (r === undefined) { r = regions.size + 1; regions.set(rk, r); soft[r] = WOODISH.test(mk) ? 1 : 0; }
      const x0 = X(P[a + 2]), y0 = Y(P[a + 1]), x1 = X(P[c + 2]), y1 = Y(P[c + 1]), x2 = X(P[d + 2]), y2 = Y(P[d + 1]);
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if (Math.abs(area) < 1e-9) continue;
      const z0 = P[a], z1 = P[c], z2 = P[d];
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2))), minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
        const qx = px + 0.5, qy = py + 0.5; // pixel centre, barycentrics (either winding)
        const w0 = ((x1 - qx) * (y2 - qy) - (x2 - qx) * (y1 - qy)) / area, w1 = ((x2 - qx) * (y0 - qy) - (x0 - qx) * (y2 - qy)) / area, w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2, o = py * W + px; if (z < zb[o]) { zb[o] = z; reg[o] = r; m[o] = 1; }
      }
    }
  }
  const r = { m, reg, soft, W, H, s }; cacheM.set(k, r); return r;
}
function hash(x, y) { let n = (x * 374761393 + y * 668265263) | 0; n = (n ^ (n >> 13)) * 1274126177 | 0; return ((n ^ (n >> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) { const X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return (hash(X, Y) * (1 - sx) + hash(X + 1, Y) * sx) * (1 - sy) + (hash(X, Y + 1) * (1 - sx) + hash(X + 1, Y + 1) * sx) * sy; }
/** per pixel: 2 = silhouette edge band, 1 = interior boundary between regions, 0 = none */
function lines(M, R, Ri) {
  const { m, reg, W, H } = M; const out = new Uint8Array(W * H);
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : m[y * W + x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let inside = 0, outside = 0; for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { if (i * i + j * j > R * R) continue; if (at(x + i, y + j)) inside++; else outside++; }
    if (inside && outside) { out[y * W + x] = 2; continue; }
    if (!inside) continue; const r0 = reg[y * W + x]; if (!r0) continue;
    for (let j = -Ri; j <= Ri && !out[y * W + x]; j++) for (let i = -Ri; i <= Ri; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const r1 = reg[yy * W + xx]; if (r1 && r1 !== r0) { out[y * W + x] = 1; break; } }
  }
  return out;
}

/** chalk outline canvas (white on transparent, muzzle left), width = size px */
export function getOutline(id, size = 640) {
  const k = id + ':' + size; if (cacheO.has(k)) return cacheO.get(k); const M = mask(id, size); if (!M) return null; const { m, W, H } = M;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); const img = g.createImageData(W, H); const d = img.data;
  const R = Math.max(2, Math.round(W / 240)), Ri = Math.max(1, Math.round(R * 0.5)); const L = lines(M, R, Ri);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, l = L[i]; const i4 = i * 4;
    if (l) { // chalk stroke: grainy, streaky along the drag direction, with the odd skip
      const grain = hash(x, y), streak = vnoise(x * 0.09, y * 0.45), gap = vnoise(x * 0.03 + 3, y * 0.03);
      let a = (l === 2 ? 1 : 0.72) * (grain > 0.2 ? 1 : 0.2) * (0.5 + 0.5 * streak) * (gap < 0.18 ? 0.2 : 1);
      d[i4] = 238; d[i4 + 1] = 236; d[i4 + 2] = 228; d[i4 + 3] = Math.round(255 * Math.min(1, a)); continue;
    }
    if (!m[i]) continue; // faint smudged fill with sparse chalk dust + diagonal hatching on the metal
    const hatch = ((x + y) % 9 === 0 && !M.soft[M.reg[i]] && vnoise(x * 0.02, y * 0.02) > 0.55) ? 0.22 : 0;
    const f = vnoise(x * 0.05, y * 0.05) * 0.09 + (hash(x, y) > 0.99 ? 0.4 : 0) + hatch;
    if (f > 0.04) { d[i4] = 230; d[i4 + 1] = 228; d[i4 + 2] = 220; d[i4 + 3] = Math.round(Math.min(1, f) * 255); }
  }
  g.putImageData(img, 0, 0); cacheO.set(k, cv); return cv;
}
/** HUD icon: white silhouette, soft parts slightly darker, thin interior lines, bright rim; width px */
export function getIcon(id, width = 256) {
  const k = id + ':' + width; if (cacheI.has(k)) return cacheI.get(k); const M = mask(id, width); if (!M) return null; const { m, reg, W, H } = M;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); const img = g.createImageData(W, H); const d = img.data; const L = lines(M, 1, 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!m[i]) continue; const i4 = i * 4; const l = L[i];
    const v = l === 2 ? 255 : l === 1 ? 150 : (M.soft[reg[i]] ? 196 : 226) + 22 * (1 - y / H);
    d[i4] = d[i4 + 1] = d[i4 + 2] = v; d[i4 + 3] = l === 2 ? 255 : 240;
  }
  g.putImageData(img, 0, 0); cacheI.set(k, cv); return cv;
}
