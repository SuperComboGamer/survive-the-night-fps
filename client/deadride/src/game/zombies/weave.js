// Shared tileable fabric micro-structure (ONE 256×256 RGBA texture for every garment, mip-mapped + anisotropic): the cloth shader samples it once per pixel with a
// planar rest-space projection (2.5 cm tile = 8 threads ≈ 3 mm — deliberately coarse so it reads at 1-2 m and mip-fades naturally beyond that).
//   R plain weave (weave / canvas / stripes / check / nylon shells)   G 2/1 twill (denim)   B jersey knit (V stitches)   A fleece / nap noise
import * as THREE from 'three';

const N = 256;
function lattice(period, seed) { const g = new Float32Array(period * period); let s = seed >>> 0; for (let i = 0; i < g.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; g[i] = s / 4294967296; } return g; }
function vnoise(g, period, u, v) { const x = u * period, y = v * period; const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); const at = (i, j) => g[((j % period + period) % period) * period + ((i % period + period) % period)];
  return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy; }
function makeWeaveData() {
  const d = new Uint8Array(N * N * 4); const j8 = lattice(8, 7), n8 = lattice(8, 11), n16 = lattice(16, 13), n32 = lattice(32, 17), j10 = lattice(12, 5);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, o = (y * N + x) * 4;
    // R: plain weave, 8 × 8 threads, thread thickness irregularity
    { const tu = u * 8, tv = v * 8, iu = Math.floor(tu), iv = Math.floor(tv), fu = tu - iu, fv = tv - iv; const over = ((iu + iv) & 1) === 0; const warp = Math.sin(Math.PI * fu), weft = Math.sin(Math.PI * fv); const jit = 0.86 + 0.28 * j8[(iv % 8) * 8 + (iu % 8)];
      const h = over ? 0.52 + 0.48 * warp * (0.7 + 0.3 * weft) : 0.06 + 0.46 * weft * (0.7 + 0.3 * warp); d[o] = Math.max(0, Math.min(255, h * jit * 255)); }
    // G: twill, diagonal ridges (2 over 1 under) with a fine weft ripple
    { const t = u * 8 + v * 8; const f = t - Math.floor(t); const ridge = f < 0.66 ? 0.5 + 0.5 * Math.sin(Math.PI * f / 0.66 - 0.0) : 0.05; const rip = 0.1 * Math.sin(2 * Math.PI * v * 16); d[o + 1] = Math.max(0, Math.min(255, (ridge * 0.85 + rip + 0.08 * n8[((y >> 5) % 8) * 8 + ((x >> 5) % 8)]) * 255)); }
    // B: jersey knit, 10 wales × 12 courses of V stitches
    { const cu = u * 10, cv = v * 12; const fx = cu - Math.floor(cu), fy = cv - Math.floor(cv); const dd = Math.abs(fx - 0.5) - (0.34 * (1 - fy) + 0.06); const h = Math.exp(-dd * dd / 0.009) * (0.72 + 0.28 * Math.sin(Math.PI * fy)); const j = 0.9 + 0.2 * j10[(Math.floor(cv) % 12) * 12 + (Math.floor(cu) % 12)]; d[o + 2] = Math.max(0, Math.min(255, h * j * 255)); }
    // A: fleece / nap: periodic fbm
    { const h = 0.5 * vnoise(n8, 8, u, v) + 0.3 * vnoise(n16, 16, u, v) + 0.2 * vnoise(n32, 32, u, v); d[o + 3] = Math.max(0, Math.min(255, h * 255)); }
  }
  return d;
}
export function makeWeaveTexture() {
  const t = new THREE.DataTexture(makeWeaveData(), N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; t.name = 'zombie-weave'; return t;
}
let _tex = null;
/** shared uniform object ({ value: DataTexture }) — created on first use */
export const WEAVE = { get value() { return _tex || (_tex = makeWeaveTexture()); } };
