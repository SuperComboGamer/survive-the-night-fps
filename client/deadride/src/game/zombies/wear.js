// WEAR / GRIME / COLOUR layer of the garments. Real worn clothing is faded, dirty and stained where a body and the world touch it — not a saturated flat colour.
// makeWear(...) returns a per-look function wear(px,py,pz, nx,ny,nz, col[3] (sRGB bytes, modified in place)) → AO multiplier, evaluated per VERTEX at build time
// (LOD0 ~1 cm, LOD1 ~2 cm) and baked into the vertex colour + AO attributes: zero per-pixel cost. Fields (rest space): splash dirt climbing from the hem / boots,
// sun-bleached shoulders (up-facing), rub-wear at knees / elbows / seat that lightens the fabric, sweat stains at the armpits and collar, sooty cuffs, oil / grease
// blotches, a wet waterline, and blood soaking round tears that drips down with gravity. garmentColor() pushes the palette toward muted, low-chroma tones.
import { noise3, smooth, clamp01 } from './folds.js';

export function muteColor(hex, k, dk = 1) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255; const l = 0.3 * r + 0.59 * g + 0.11 * b; const f = (c) => Math.max(0, Math.min(255, Math.round((l + (c - l) * (1 - k)) * dk)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
/** garment base colour, faded / desaturated / darkened by its wear + dirt (opts.mute overrides the amount, 0 = untouched) */
export function garmentColor(G) {
  const c = G.o.color; if (c == null || typeof c !== 'number') return c; const mat = G.o.mat ?? G.g.mat?.mat ?? 'cloth', pat = G.o.pattern ?? G.g.mat?.pattern;
  const wear = G.o.wear ?? G.g.wear ?? 0.3, dirt = G.o.dirt ?? G.g.dirt ?? 0.3; let k = 0.27 + 0.3 * wear + 0.14 * dirt; if (pat === 'hivis') k *= 0.5; if (mat === 'fur') k *= 0.5; else if (mat !== 'cloth') k *= 0.55; if (G.o.mute != null) k = G.o.mute;
  return muteColor(c, Math.min(0.64, k), 1 - 0.14 * dirt - 0.06 * wear);
}
function hash01(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); h = Math.imul(h ^ (h >>> 15), 2246822507); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; }

/** o = Outfit (variant def, seeds), G = garment record, prm = fitParams, cls = classify(sub), sites = tear sites [{c, r}], seedKey = string unique per (outfit signature, garment, look) */
export function makeWear(o, G, prm, cls, sites, seedKey) {
  const wear = clamp01(G.o.wear ?? G.g.wear ?? 0.3), dirt = clamp01(G.o.dirt ?? G.g.dirt ?? 0.3), wet = prm.wet || 0; const lay = o.variant?.layers || {}; const bloody = clamp01((lay.blood ?? 0) * 1.0);
  const s = [hash01(seedKey + 'a') * 200 | 0, hash01(seedKey + 'b') * 200 | 0, hash01(seedKey + 'c') * 200 | 0, hash01(seedKey + 'd') * 200 | 0]; const warm = (hash01(seedKey + 'w') - 0.5) * 0.06; const kind = prm.kind; const bottoms = cls.legs; const hivis = (G.o.pattern ?? G.g.mat?.pattern) === 'hivis';
  const burnK = clamp01((lay.burn ?? 0) * 1.1); const amt = G.o.grime ?? 1; const shine = kind === 'boots' || kind === 'wellies' || kind === 'gloves' ? 0.6 : 1; const tear = sites || [];
  return function wearAt(px, py, pz, nx, ny, nz, col) {
    let r = col[0], g = col[1], b = col[2]; const lum = 0.3 * r + 0.59 * g + 0.11 * b; const gray = Math.min(255, lum * 1.16 + 20);
    const n1 = 0.5 + 0.5 * noise3(px * 6 + s[0], py * 4, pz * 6, s[1]), n2 = 0.5 + 0.5 * noise3(px * 19, py * 19 + s[2], pz * 19, s[3]), n3 = 0.5 + 0.5 * noise3(px * 2.6, py * 2.2 + s[1], pz * 2.6, s[0]);
    let aoM = 1; const ax = Math.abs(px);
    // 1. sun bleach on up-facing shoulders / upper arms / hat-brim height, and generally on raised, exposed surfaces
    let t = 0; if (py > 1.2) { const bleach = smooth(0.2, 0.85, ny) * smooth(1.2, 1.44, py) * (0.45 + 0.55 * n3) * (0.35 + 0.65 * wear); t = 0.5 * bleach * amt; r += (gray - r) * t; g += (gray - g) * t; b += (gray - b) * t; }
    // 2. rub wear (lighter, thinner, slightly desaturated): knees, elbows, seat, cuffs' edges
    let rub = 0;
    if (py > 0.4 && py < 0.58 && nz < 0.4) { const kx = (ax - 0.097) / 0.062, ky = (py - 0.49) / 0.08; rub = clamp01(1 - (kx * kx + ky * ky)); }
    else if (py > 1.09 && py < 1.24 && ax > 0.33 && ax < 0.46) { const ex = (ax - 0.396) / 0.06, ey = (py - 1.163) / 0.06; rub = clamp01(1 - (ex * ex + ey * ey)) * (pz > 0 ? 1 : 0.55); }
    else if (py > 0.78 && py < 0.96 && nz > 0.1) { const sx = (ax - 0.07) / 0.09, sy = (py - 0.87) / 0.085; rub = clamp01(1 - (sx * sx + sy * sy)) * 0.9; }
    if (rub > 0) { t = rub * (0.25 + 0.75 * wear) * (0.5 + 0.5 * n2) * 0.85 * amt; r += (gray - r) * t; g += (gray - g) * t; b += (gray - b) * t; aoM *= 1 - 0.08 * rub; }
    // 3. splash dirt from the ground up (legs / boots), weaker on the torso hem
    let low; if (bottoms && py < 0.95 && ax < 0.24) low = 1 - smooth(0.04, 0.52 + 0.14 * (n1 - 0.5), py); else low = 0.4 * (1 - smooth(0.82, 1.12 + 0.05 * n1, py));
    const gate = smooth(0.25, 0.7, n1 * 0.7 + n2 * 0.3 + 0.25); t = low * (0.3 + 0.7 * dirt) * gate * 0.8 * amt * shine; const mr = 40 + lum * 0.12, mg = 34 + lum * 0.1, mb = 27 + lum * 0.08; r += (mr - r) * t; g += (mg - g) * t; b += (mb - b) * t; aoM *= 1 - 0.14 * t;
    // 4. sweat: armpits (rings) and the collar band
    if (py > 1.2) { const dxs2 = ((ax - 0.148) * (ax - 0.148) + (py - 1.29) * (py - 1.29)) / 0.005625; const arm = dxs2 < 1 ? (1 - dxs2) * (nx * (px < 0 ? -1 : 1) < 0.45 ? 1 : 0.5) : 0; const col2 = smooth(1.41, 1.47, py) * (1 - smooth(1.55, 1.62, py)); if (arm > 0 || col2 > 0) { t = (arm * 0.75 + col2 * 0.55) * (0.35 + 0.65 * dirt) * (0.55 + 0.45 * n2) * amt; r *= 1 - 0.22 * t; g *= 1 - 0.28 * t; b *= 1 - 0.42 * t; aoM *= 1 - 0.05 * t; } }
    // 5. cuff / hand soot: darker, greasy rims near the wrists
    if (ax > 0.42 && py > 0.85 && py < 1.1) { const dw2 = ((ax - 0.55) * (ax - 0.55) + (py - 0.97) * (py - 0.97)) / 0.0121; if (dw2 < 1) { t = (1 - dw2) * (0.3 + 0.7 * dirt) * 0.7 * amt; r += (34 - r) * t; g += (31 - g) * t; b += (28 - b) * t; } }
    // 6. oil / grease blotches (dark, slightly cool), mostly at hip height and forearms
    if (n3 > 0.55 && dirt > 0.08) { const gr = smooth(0.7, 0.84, 0.5 * n3 + 0.5 * noise3(px * 9, py * 9, pz * 9, s[2]) + 0.42) * dirt * 0.55 * (py < 1.25 ? 1 : 0.5) * amt; if (gr > 0) { const gl = lum * 0.42; r += (gl * 0.95 - r) * gr; g += (gl - g) * gr; b += (gl * 1.08 - b) * gr; } }
    // 7. wet: the waterline darkens and cools everything below it
    if (wet > 0) { const wl = wet * (1 - smooth(0.7 + 0.25 * n3, 1.3, py)) * 0.5; r *= 1 - 0.34 * wl; g *= 1 - 0.3 * wl; b *= 1 - 0.24 * wl; }
    // 8. blood: soak around tears + a drip that runs straight down (gravity), plus faint splatter proportional to the variant's blood layer
    let bl = 0; for (let i = 0; i < tear.length; i++) { const T = tear[i]; const dx = px - T.c[0], dy = py - T.c[1], dz = pz - T.c[2]; const d = Math.sqrt(dx * dx + dy * dy + dz * dz); const rad = T.r * 2.3; if (d < rad) bl = Math.max(bl, Math.pow(1 - d / rad, 1.4) * 0.8);
      const dd = T.c[1] - py; if (dd > 0 && dd < 0.3) { const lat = Math.sqrt(dx * dx + dz * dz); const w = 0.006 + 0.01 * n2; if (lat < w * 2.2) bl = Math.max(bl, (1 - lat / (w * 2.2)) * smooth(0.0, 0.03, dd) * (1 - smooth(0.12, 0.3, dd)) * 0.75); } }
    if (bloody > 0.05) bl = Math.max(bl, smooth(0.74, 0.86, n3 * 0.55 + 0.45 * noise3(px * 7, py * 5, pz * 7, s[3]) + 0.4) * bloody * 0.6 * smooth(0.95, 1.4, py));
    if (burnK > 0) for (let i = 0; i < tear.length; i++) { const T = tear[i]; const dx0 = px - T.c[0], dy0 = py - T.c[1], dz0 = pz - T.c[2]; const d = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0); const rad = T.r * 1.5; if (d < rad) { const k = Math.pow(1 - d / rad, 0.8) * burnK; r += (26 - r) * k; g += (22 - g) * k; b += (20 - b) * k; } } // charred rims
    if (bl > 0.01) { const k = Math.min(0.85, bl); r += (58 * (0.8 + 0.4 * n2) - r) * k; g += (7 - g) * k; b += (7 - b) * k; aoM *= 1 - 0.1 * k; }
    // 9. per-look warm / cool tint + hi-vis stays a little brighter (it is fluorescent, but filthy)
    const tint = warm; r *= 1 + tint; b *= 1 - tint; if (hivis) { r = Math.min(255, r * 1.04); g = Math.min(255, g * 1.04); }
    if (kind === 'boots' || kind === 'wellies') aoM *= 0.55 + 0.45 * smooth(0.004, 0.07, py); // contact shadow: the lowest centimetres of a boot sit in the ground's shadow
    col[0] = r < 0 ? 0 : r > 255 ? 255 : r; col[1] = g < 0 ? 0 : g > 255 ? 255 : g; col[2] = b < 0 ? 0 : b > 255 ? 255 : b; return aoM;
  };
}
