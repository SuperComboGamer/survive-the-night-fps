// Procedural canvas textures (no asset files). All textures are generated lazily and cached.
//
// Conventions:
//  - Image row 0 is the TOP of the texture (v = 1), like a canvas. flipY is applied on upload.
//  - Building / prop surface textures are designed for METER UVs: each texture covers a known world size
//    (see TEXTURE_WORLD_SIZE); materials.js sets texture.repeat = 1 / worldSize.
//  - Ground textures are 512px and seamlessly tileable (periodic noise + wrapped drawing).
//  - fx_* sprites are white/grey on transparent (RGB is never black under transparent pixels -> premultiply-friendly).
//  - decal_* textures carry their own colour + alpha.
import * as THREE from 'three';

// ------------------------------------------------------------------ registry
const cache = new Map();
const derived = new Map();
const allTextures = new Set();
let maxAniso = 4;

// world size (meters) covered by one repeat of each surface texture (used by materials.js)
export const TEXTURE_WORLD_SIZE = {
  planks: 2, barn: 2, clapboard: 2, logwall: 2, concrete: 3, brick: 1, shingles: 2, tin: 2, rust: 1.5,
  metal: 1.5, stone: 2, dockwood: 2, glass: 1, door: [1, 2.1], hay: 1, canvas: 2, olive: 2, wood: 1,
  bark: [1, 2], bark_birch: [1, 2], bark_dead: [1, 2], rock: 2, tire: 1, paint: 1.5, carpaint: 2, cloth: 0.6,
  burlap: 0.6, bone: 0.3, charred: 1, skin: 0.6, mattress: 1, plastic: 1, pumpkin: 1, ash: 1, cardboard: 0.6,
  ground_grass: 4, ground_dirt: 4, ground_forest: 4, ground_road: 4, ground_asphalt: 4, ground_mud: 4, ground_sand: 4,
};

function registerTex(t) {
  allTextures.add(t);
  t.anisotropy = t.userData.noAniso ? 1 : maxAniso;
  return t;
}

/** Cached texture by name. Optional rx/ry return a cached clone with that repeat (shares the GPU image). */
export function getTexture(name, rx, ry) {
  let t = cache.get(name);
  if (!t) {
    const gen = GEN[name];
    if (!gen) throw new Error(`textures: unknown texture '${name}'`);
    t = finish(gen(), name);
    cache.set(name, t);
  }
  if (rx === undefined) return t;
  if (ry === undefined) ry = rx;
  const key = `${name}|${rx}|${ry}`;
  let d = derived.get(key);
  if (!d) {
    d = t.clone();
    d.repeat.set(rx, ry);
    d.needsUpdate = true;
    registerTex(d);
    derived.set(key, d);
  }
  return d;
}

export function setMaxAnisotropy(n) {
  maxAniso = Math.max(1, n | 0);
  for (const t of allTextures) {
    const a = t.userData.noAniso ? 1 : maxAniso;
    if (t.anisotropy !== a) {
      t.anisotropy = a;
      t.needsUpdate = true;
    }
  }
}

export const TEXTURE_NAMES = () => Object.keys(GEN);

function finish(out, name) {
  let t;
  if (out.canvas) {
    t = new THREE.CanvasTexture(out.canvas);
  } else {
    t = new THREE.DataTexture(out.d, out.w, out.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.flipY = true;
    t.unpackAlignment = 4;
  }
  t.name = name;
  t.colorSpace = THREE.SRGBColorSpace;
  const clampTex = out.clamp;
  t.wrapS = t.wrapT = clampTex ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (out.wrapT === 'repeat') t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.userData.noAniso = !!out.noAniso;
  t.needsUpdate = true;
  return registerTex(t);
}

// ------------------------------------------------------------------ math / noise
function rngf(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Periodic (tileable) value-noise fbm, normalised to 0..1. fx/fy = lattice cells across the image for octave 0. */
function fbm(w, h, fx, fy, oct, seed, gain = 0.5) {
  const out = new Float32Array(w * h);
  let amp = 1;
  const ix0 = new Int32Array(w), ix1 = new Int32Array(w), txs = new Float32Array(w);
  for (let o = 0; o < oct; o++) {
    const cx = Math.max(1, Math.round(fx * 2 ** o)), cy = Math.max(1, Math.round(fy * 2 ** o));
    const r = rngf(seed * 131 + o * 977 + 7);
    const g = new Float32Array(cx * cy);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let x = 0; x < w; x++) {
      const f = (x / w) * cx, i = Math.floor(f), t = f - i;
      ix0[x] = i % cx;
      ix1[x] = (i + 1) % cx;
      txs[x] = t * t * (3 - 2 * t);
    }
    for (let y = 0; y < h; y++) {
      const f = (y / h) * cy, j = Math.floor(f), t0 = f - j, ty = t0 * t0 * (3 - 2 * t0);
      const r0 = (j % cy) * cx, r1 = ((j + 1) % cy) * cx, row = y * w;
      for (let x = 0; x < w; x++) {
        const a = g[r0 + ix0[x]], b = g[r0 + ix1[x]], c = g[r1 + ix0[x]], d = g[r1 + ix1[x]];
        const tx = txs[x], top = a + (b - a) * tx, bot = c + (d - c) * tx;
        out[row + x] += (top + (bot - top) * ty) * amp;
      }
    }
    amp *= gain;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const s = 1 / (mx - mn || 1);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * s;
  return out;
}

/** Tileable worley noise. Returns {f1, f2, id} with distances in cell units. */
function worley(w, h, cx, cy, seed) {
  const r = rngf(seed);
  const n = cx * cy, ox = new Float32Array(n), oy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ox[i] = r();
    oy[i] = r();
  }
  const f1 = new Float32Array(w * h), f2 = new Float32Array(w * h), id = new Int32Array(w * h);
  const cw = w / cx, ch = h / cy;
  for (let y = 0; y < h; y++) {
    const gy = (y + 0.5) / ch, j = Math.floor(gy);
    for (let x = 0; x < w; x++) {
      const gx = (x + 0.5) / cw, i = Math.floor(gx);
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj, cj = ((jj % cy) + cy) % cy;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, ci = ((ii % cx) + cx) % cx, k = cj * cx + ci;
          const px = ii + ox[k] - gx, py = jj + oy[k] - gy;
          const d = px * px + py * py;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = k;
          } else if (d < d2) d2 = d;
        }
      }
      const p = y * w + x;
      f1[p] = Math.sqrt(d1);
      f2[p] = Math.sqrt(d2);
      id[p] = best;
    }
  }
  return { f1, f2, id };
}

// ------------------------------------------------------------------ canvas helpers
function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function ctx2d(c) {
  return c.getContext('2d', { willReadFrequently: true });
}
function newImg(w, h) {
  return { w, h, d: new Uint8ClampedArray(w * h * 4) };
}
function imgToCanvas(img, c) {
  c = c || mkCanvas(img.w, img.h);
  ctx2d(c).putImageData(new ImageData(img.d, img.w, img.h), 0, 0);
  return c;
}
function canvasToImg(c) {
  const id = ctx2d(c).getImageData(0, 0, c.width, c.height);
  return { w: c.width, h: c.height, d: id.data };
}
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const rgbA = (c, a = 1, k = 1) => rgb(c[0] * k, c[1] * k, c[2] * k, a);

/** calls fn(x,y) for the position and its wrapped copies when within r of an edge */
function wrapDraw(W, H, x, y, r, fn) {
  const xs = x - r < 0 ? [0, W] : x + r > W ? [0, -W] : [0];
  const ys = y - r < 0 ? [0, H] : y + r > H ? [0, -H] : [0];
  for (const ox of xs) for (const oy of ys) fn(x + ox, y + oy);
}

/** multiplies image by a per-pixel function returning a scalar or modifies directly */
function eachPx(img, fn) {
  const { w, h, d } = img;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) fn(x, y, i, d);
}

function colorRamp(stops) {
  return (t, out) => {
    t = clamp(t);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const a = stops[k], b = stops[k + 1];
    const f = clamp((t - a[0]) / (b[0] - a[0] || 1));
    out[0] = a[1] + (b[1] - a[1]) * f;
    out[1] = a[2] + (b[2] - a[2]) * f;
    out[2] = a[3] + (b[3] - a[3]) * f;
    return out;
  };
}

/** random crack polyline (random walk), drawn wrapped */
function drawCracks(ctx, W, H, r, count, { len = [40, 160], width = [0.8, 1.6], col = 'rgba(15,12,10,0.7)', light = null, branch = 0.3, step = 5, wander = 0.5 } = {}) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const paths = [];
  const walk = (x, y, ang, L, depth) => {
    const pts = [[x, y]];
    for (let s = 0; s < L; s += step) {
      ang += (r() - 0.5) * wander;
      x += Math.cos(ang) * step;
      y += Math.sin(ang) * step;
      pts.push([x, y]);
      if (depth < 2 && r() < branch * 0.06) walk(x, y, ang + (r() < 0.5 ? 1 : -1) * (0.5 + r()), L * 0.4, depth + 1);
    }
    paths.push({ pts, w: lerp(width[0], width[1], r()) * (depth ? 0.7 : 1) });
  };
  for (let i = 0; i < count; i++) walk(r() * W, r() * H, r() * Math.PI * 2, lerp(len[0], len[1], r()), 0);
  const stroke = (style, dx, dy, wmul) => {
    ctx.strokeStyle = style;
    for (const p of paths) {
      ctx.lineWidth = p.w * wmul;
      for (const ox of [-W, 0, W])
        for (const oy of [-H, 0, H]) {
          ctx.beginPath();
          ctx.moveTo(p.pts[0][0] + ox + dx, p.pts[0][1] + oy + dy);
          for (let k = 1; k < p.pts.length; k++) ctx.lineTo(p.pts[k][0] + ox + dx, p.pts[k][1] + oy + dy);
          ctx.stroke();
        }
    }
  };
  if (light) stroke(light, 0.8, 1, 1);
  stroke(col, 0, 0, 1);
}

// Shape recorder for alpha textures: draws the same shapes to a colour canvas and a mask canvas.
class Rec {
  constructor() {
    this.ops = [];
  }
  line(x0, y0, x1, y1, w, c) {
    this.ops.push({ k: 0, x0, y0, x1, y1, w, c });
  }
  quad(x0, y0, cx, cy, x1, y1, w, c) {
    this.ops.push({ k: 1, x0, y0, cx, cy, x1, y1, w, c });
  }
  ell(x, y, rx, ry, rot, c) {
    this.ops.push({ k: 2, x, y, rx, ry, rot, c });
  }
  poly(pts, c) {
    this.ops.push({ k: 3, pts, c });
  }
  render(ctx, mask) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const o of this.ops) {
      const col = mask ? '#fff' : o.c;
      if (o.k === 0 || o.k === 1) {
        ctx.strokeStyle = col;
        ctx.lineWidth = o.w;
        ctx.beginPath();
        ctx.moveTo(o.x0, o.y0);
        if (o.k === 0) ctx.lineTo(o.x1, o.y1);
        else ctx.quadraticCurveTo(o.cx, o.cy, o.x1, o.y1);
        ctx.stroke();
      } else if (o.k === 2) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, Math.max(0.1, o.rx), Math.max(0.1, o.ry), o.rot, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(o.pts[0], o.pts[1]);
        for (let k = 2; k < o.pts.length; k += 2) ctx.lineTo(o.pts[k], o.pts[k + 1]);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  /** returns alpha image; bg = rgb under transparent pixels (avoids dark fringes) */
  toImg(w, h, bg, { post, alphaPow = 1 } = {}) {
    const c = mkCanvas(w, h), m = mkCanvas(w, h);
    const cx = ctx2d(c), mx = ctx2d(m);
    cx.fillStyle = rgbA(bg);
    cx.fillRect(0, 0, w, h);
    mx.fillStyle = '#000';
    mx.fillRect(0, 0, w, h);
    this.render(cx, false);
    this.render(mx, true);
    if (post) post(cx);
    const ci = canvasToImg(c), mi = canvasToImg(m);
    for (let i = 0; i < ci.d.length; i += 4) {
      let a = mi.d[i] / 255;
      if (alphaPow !== 1) a = Math.pow(a, alphaPow);
      ci.d[i + 3] = a * 255;
    }
    return ci;
  }
}

// ------------------------------------------------------------------ shared wood field
function woodGrainImg(W, H, seed, light, dark, { rings = 24, streak = 0.6, lineDark = 0.28, fine = 0.08 } = {}) {
  const g1 = fbm(W, H, 1, 28, 4, seed, 0.55);
  const g2 = fbm(W, H, 2, 3, 3, seed + 1);
  const g3 = fbm(W, H, 4, 4, 4, seed + 2);
  const r = rngf(seed + 3);
  const img = newImg(W, H);
  const d = img.d;
  for (let y = 0, i = 0, p = 0; y < H; y++)
    for (let x = 0; x < W; x++, i += 4, p++) {
      const t = (y / H) * rings + g2[p] * 7 + g1[p] * 1.2;
      const s = Math.abs(Math.sin(t * Math.PI));
      const line = s ** 10;
      let v = 0.32 + (g1[p] - 0.5) * streak + 0.35 * g3[p] - line * lineDark + (r() - 0.5) * fine;
      v = clamp(v);
      d[i] = lerp(dark[0], light[0], v);
      d[i + 1] = lerp(dark[1], light[1], v);
      d[i + 2] = lerp(dark[2], light[2], v);
      d[i + 3] = 255;
    }
  return img;
}

/**
 * Board layout texture. Boards run along u (horizontal) unless vertical=true.
 * returns img plus the per-pixel "board local v" and edge info for further passes.
 */
function boardsImg({ W = 512, H = 512, n = 8, seed = 1, vertical = false, light, dark, tone = 0.16, gap = [18, 14, 11], joints = 2, grime = 0.35, warm = 0 }) {
  const grainW = 512, grainH = 512;
  const grain = woodGrainImg(grainW, grainH, seed, light, dark, { rings: 26 });
  const gd = grain.d;
  const gl = fbm(W, H, 5, 5, 5, seed + 9);
  const streaks = fbm(W, H, vertical ? 3 : 40, vertical ? 40 : 2, 4, seed + 11);
  const r = rngf(seed + 5);
  const L = vertical ? H : W; // board length axis size
  const A = vertical ? W : H; // across axis size
  const bw = A / n;
  const boards = [];
  for (let b = 0; b < n; b++) {
    const js = [];
    for (let k = 0; k < joints; k++) js.push(Math.floor(r() * L));
    js.sort((a, c) => a - c);
    const seg = [];
    for (let k = 0; k <= joints; k++) seg.push({ tone: 1 + (r() - 0.5) * 2 * tone, ox: Math.floor(r() * grainW), oy: Math.floor(r() * grainH), warm: (r() - 0.5) * 12 + warm });
    boards.push({ js, seg, w: bw });
  }
  const img = newImg(W, H);
  const d = img.d;
  for (let y = 0, i = 0, p = 0; y < H; y++)
    for (let x = 0; x < W; x++, i += 4, p++) {
      const u = vertical ? y : x, v = vertical ? x : y;
      const b = Math.min(n - 1, Math.floor(v / bw));
      const lv = v - b * bw;
      const B = boards[b];
      let cnt = 0;
      let nearJ = 99;
      for (const j of B.js) {
        if (u >= j) cnt++;
        const dj = Math.abs(u - j);
        if (dj < nearJ) nearJ = dj;
      }
      const S = B.seg[B.js.length ? cnt % B.js.length : 0];
      const gx = (u + S.ox) % grainW, gy = (Math.floor(lv) + S.oy) % grainH;
      const gi = (gy * grainW + gx) * 4;
      let k = S.tone * (1 - grime * 0.5 + grime * gl[p]) * (0.85 + 0.3 * streaks[p]);
      // edge shading across the board
      if (lv < 2.2) k *= 0.25;
      else if (lv < 4) k *= 1.12;
      else if (lv > bw - 3) k *= 0.6;
      if (nearJ < 1.2 && B.js.length) k *= 0.3;
      else if (nearJ < 2.5 && B.js.length) k *= 0.8;
      let R = gd[gi] * k + S.warm, G = gd[gi + 1] * k + S.warm * 0.4, Bc = gd[gi + 2] * k - S.warm * 0.3;
      if (lv < 2.2) {
        R = lerp(R, gap[0], 0.7);
        G = lerp(G, gap[1], 0.7);
        Bc = lerp(Bc, gap[2], 0.7);
      }
      d[i] = R;
      d[i + 1] = G;
      d[i + 2] = Bc;
      d[i + 3] = 255;
    }
  return { img, boards, bw, vertical, n };
}

function nailsOnBoards(ctx, W, H, info, r, { studs = 3, rust = 0.35 } = {}) {
  const { n, bw, vertical } = info;
  const L = vertical ? H : W;
  const off = r() * L;
  for (let b = 0; b < n; b++) {
    for (let s = 0; s < studs; s++) {
      const u = (off + (s * L) / studs + (r() - 0.5) * 6 + L) % L;
      for (const f of [0.3, 0.72]) {
        if (r() < 0.15) continue;
        const v = b * bw + bw * f + (r() - 0.5) * 3;
        const x = vertical ? v : u, y = vertical ? u : v;
        wrapDraw(W, H, x, y, 30, (px, py) => {
          if (r() < rust) {
            const g = ctx.createLinearGradient(px, py, px, py + 26);
            g.addColorStop(0, 'rgba(90,45,20,0.45)');
            g.addColorStop(1, 'rgba(90,45,20,0)');
            ctx.fillStyle = g;
            ctx.fillRect(px - 1.5, py, 3, 26);
          }
          ctx.fillStyle = 'rgba(20,16,14,0.9)';
          ctx.beginPath();
          ctx.arc(px, py, 2.1, 0, 7);
          ctx.fill();
          ctx.fillStyle = 'rgba(130,120,110,0.5)';
          ctx.fillRect(px - 1, py - 1.2, 1.2, 1);
        });
      }
    }
  }
}

/** darkening water streaks running down (vertical) */
function drips(ctx, W, H, r, count, col = [20, 16, 12], alpha = [0.05, 0.18], len = [30, 200], wdt = [2, 10]) {
  for (let i = 0; i < count; i++) {
    const x = r() * W, y = r() * H, l = lerp(len[0], len[1], r()), w = lerp(wdt[0], wdt[1], r());
    const a = lerp(alpha[0], alpha[1], r());
    wrapDraw(W, H, x, y + l / 2, Math.max(w, l), (px, py) => {
      const g = ctx.createLinearGradient(0, py - l / 2, 0, py + l / 2);
      g.addColorStop(0, rgbA(col, a));
      g.addColorStop(1, rgbA(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(px - w / 2, py - l / 2, w, l);
    });
  }
}

/** soft blotches (stains, moss), wrapped */
function blotches(ctx, W, H, r, count, col, alpha, rad) {
  for (let i = 0; i < count; i++) {
    const x = r() * W, y = r() * H, R = lerp(rad[0], rad[1], r()), a = lerp(alpha[0], alpha[1], r());
    const c = typeof col === 'function' ? col(r) : col;
    wrapDraw(W, H, x, y, R, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, R);
      g.addColorStop(0, rgbA(c, a));
      g.addColorStop(1, rgbA(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(px - R, py - R, R * 2, R * 2);
    });
  }
}

/** overlay an fbm-based tint: where mask(noise) -> mix toward colour */
function tintByNoise(img, noise, col, lo, hi, strength) {
  eachPx(img, (x, y, i, d) => {
    const t = sstep(lo, hi, noise[i >> 2]) * strength;
    if (t <= 0) return;
    d[i] = lerp(d[i], col[0], t);
    d[i + 1] = lerp(d[i + 1], col[1], t);
    d[i + 2] = lerp(d[i + 2], col[2], t);
  });
}
function mulByNoise(img, noise, lo, hi) {
  eachPx(img, (x, y, i, d) => {
    const k = lo + (hi - lo) * noise[i >> 2];
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  });
}

// ================================================================== GENERATORS
const GEN = {};

// ---------------------------------------------------------------- building surfaces
GEN.wood = () => {
  const W = 256;
  const img = woodGrainImg(W, W, 11, [128, 114, 97], [62, 53, 44], { rings: 14 });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  const r = rngf(12);
  drawCracks(ctx, W, W, r, 5, { len: [30, 120], width: [0.6, 1.2], wander: 0.12, step: 4, col: 'rgba(25,20,16,0.6)' });
  // knots
  for (let k = 0; k < 2; k++) {
    const x = r() * W, y = r() * W;
    wrapDraw(W, W, x, y, 12, (px, py) => {
      ctx.fillStyle = 'rgba(45,34,26,0.8)';
      ctx.beginPath();
      ctx.ellipse(px, py, 5 + r() * 3, 3, 0, 0, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,46,36,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(px, py, 9, 5, 0, 0, 7);
      ctx.stroke();
    });
  }
  return { canvas: c };
};

GEN.planks = () => {
  const W = 512;
  const r = rngf(21);
  const info = boardsImg({ W, H: W, n: 8, seed: 21, light: [134, 120, 102], dark: [66, 57, 48], tone: 0.14 });
  const moss = fbm(W, W, 6, 6, 4, 22);
  tintByNoise(info.img, moss, [52, 60, 34], 0.72, 0.9, 0.5);
  const c = imgToCanvas(info.img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 40, [18, 14, 10], [0.05, 0.16]);
  nailsOnBoards(ctx, W, W, info, r);
  drawCracks(ctx, W, W, r, 10, { len: [20, 90], wander: 0.1, step: 4, width: [0.6, 1.1], col: 'rgba(20,16,12,0.55)' });
  return { canvas: c };
};

GEN.barn = () => {
  const W = 512;
  const r = rngf(31);
  const info = boardsImg({ W, H: W, n: 10, seed: 31, vertical: true, light: [128, 120, 110], dark: [66, 60, 54], tone: 0.1, joints: 2 });
  const img = info.img;
  const pm = fbm(W, W, 4, 3, 6, 32, 0.55);
  const vs = fbm(W, W, 30, 2, 3, 33);
  const fade = fbm(W, W, 3, 3, 4, 34);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const m = pm[p] * 0.75 + vs[p] * 0.25;
    const lv = x % info.bw;
    if (lv < 2.2) return; // gaps stay dark
    const k = sstep(0.36, 0.4, m);
    if (k <= 0) return;
    const f = fade[p];
    let R = lerp(96, 138, f), G = lerp(30, 58, f), B = lerp(24, 48, f);
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 380; // let grain show through
    R *= 0.75 + lum * 0.35;
    G *= 0.75 + lum * 0.35;
    B *= 0.75 + lum * 0.35;
    const edge = 1 - sstep(0.4, 0.43, m);
    R += edge * 30;
    G += edge * 22;
    B += edge * 18;
    d[i] = lerp(d[i], R, k);
    d[i + 1] = lerp(d[i + 1], G, k);
    d[i + 2] = lerp(d[i + 2], B, k);
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 60, [22, 14, 10], [0.06, 0.2], [40, 260], [2, 12]);
  nailsOnBoards(ctx, W, W, info, r, { studs: 2 });
  return { canvas: c };
};

GEN.clapboard = () => {
  const W = 512, n = 8, bh = W / n;
  const r = rngf(41);
  const grain = woodGrainImg(W, W, 41, [120, 114, 104], [70, 66, 60], { rings: 20 });
  const pm = fbm(W, W, 5, 4, 6, 42, 0.55);
  const dirt = fbm(W, W, 4, 4, 5, 43);
  const vs = fbm(W, W, 36, 2, 4, 44);
  const mil = fbm(W, W, 12, 12, 4, 45);
  const img = newImg(W, W);
  const d = img.d, gd = grain.d;
  for (let y = 0, i = 0, p = 0; y < W; y++) {
    const lv = y % bh;
    let shade;
    if (lv < 3) shade = 0.35;
    else if (lv < 8) shade = lerp(0.6, 0.86, (lv - 3) / 5);
    else shade = lerp(0.86, 1.02, (lv - 8) / (bh - 8));
    if (lv > bh - 2) shade = 1.08;
    for (let x = 0; x < W; x++, i += 4, p++) {
      const paint = sstep(0.3, 0.34, pm[p] * 0.8 + vs[p] * 0.2);
      const pr = lerp(150, 186, dirt[p]), pg = lerp(146, 180, dirt[p]), pb = lerp(134, 164, dirt[p]);
      let R = lerp(gd[i], pr, paint), G = lerp(gd[i + 1], pg, paint), B = lerp(gd[i + 2], pb, paint);
      const grime = 0.72 + 0.28 * vs[p];
      const m = sstep(0.74, 0.86, mil[p]) * 0.6;
      R = lerp(R * grime, 48, m);
      G = lerp(G * grime, 54, m);
      B = lerp(B * grime, 40, m);
      d[i] = R * shade;
      d[i + 1] = G * shade;
      d[i + 2] = B * shade;
      d[i + 3] = 255;
    }
  }
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 70, [40, 34, 24], [0.06, 0.22], [40, 300], [2, 14]);
  // vertical butt joints
  for (let b = 0; b < n; b++) {
    const x = r() * W;
    ctx.fillStyle = 'rgba(30,26,20,0.6)';
    wrapDraw(W, W, x, b * bh + bh / 2, 4, (px) => ctx.fillRect(px, b * bh + 2, 1.5, bh - 2));
  }
  return { canvas: c };
};

GEN.logwall = () => {
  const W = 512, n = 8, bh = W / n;
  const r = rngf(51);
  const grain = woodGrainImg(W, W, 51, [118, 96, 72], [58, 44, 32], { rings: 34, streak: 0.8 });
  const ch = fbm(W, W, 16, 8, 4, 52);
  const dirt = fbm(W, W, 5, 5, 4, 53);
  const img = newImg(W, W);
  const d = img.d, gd = grain.d;
  const off = [];
  for (let b = 0; b < n; b++) off.push(Math.floor(r() * W));
  for (let y = 0, i = 0, p = 0; y < W; y++) {
    const b = Math.floor(y / bh), lv = y - b * bh;
    for (let x = 0; x < W; x++, i += 4, p++) {
      const wob = (ch[p] - 0.5) * 6;
      const chinkH = 6 + wob;
      if (lv < chinkH * 0.5 || lv > bh - chinkH * 0.5) {
        const v = 120 + ch[p] * 40 - 30 * dirt[p];
        d[i] = v;
        d[i + 1] = v * 0.95;
        d[i + 2] = v * 0.86;
      } else {
        const t = (lv - chinkH * 0.5) / (bh - chinkH);
        const s = Math.pow(Math.sin(Math.PI * t), 0.55) * (1 - 0.25 * t);
        const gi = (((y + off[b]) % W) * W + ((x + off[b] * 3) % W)) * 4;
        const k = (0.45 + 0.65 * s) * (0.8 + 0.3 * dirt[p]);
        d[i] = gd[gi] * k;
        d[i + 1] = gd[gi + 1] * k;
        d[i + 2] = gd[gi + 2] * k;
      }
      d[i + 3] = 255;
    }
  }
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  // checks (cracks along logs)
  drawCracks(ctx, W, W, r, 22, { len: [30, 140], wander: 0.08, step: 5, width: [0.8, 1.6], col: 'rgba(22,16,12,0.7)', branch: 0 });
  drips(ctx, W, W, r, 30, [20, 15, 10], [0.05, 0.14]);
  return { canvas: c };
};

GEN.concrete = () => {
  const W = 512;
  const r = rngf(61);
  const a = fbm(W, W, 4, 4, 6, 61, 0.55), b = fbm(W, W, 16, 16, 3, 62);
  const st = fbm(W, W, 26, 2, 4, 63), big = fbm(W, W, 2, 2, 3, 64);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    let v = 0.45 + (a[p] - 0.5) * 0.5 + (b[p] - 0.5) * 0.18 + (r() - 0.5) * 0.08;
    v *= 0.78 + 0.3 * st[p];
    v *= 0.85 + 0.25 * big[p];
    const R = lerp(52, 150, v), G = lerp(51, 147, v), B = lerp(48, 139, v);
    d[i] = R;
    d[i + 1] = G;
    d[i + 2] = B;
    d[i + 3] = 255;
  });
  const moss = fbm(W, W, 5, 5, 5, 65);
  tintByNoise(img, moss, [40, 48, 30], 0.75, 0.9, 0.55);
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 50, [20, 20, 16], [0.06, 0.2], [60, 300], [4, 18]);
  for (let k = 0; k < 400; k++) {
    const x = r() * W, y = r() * W, R = 0.6 + r() * 1.6;
    ctx.fillStyle = `rgba(20,20,18,${0.3 + r() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, 7);
    ctx.fill();
  }
  drawCracks(ctx, W, W, r, 7, { len: [80, 320], width: [0.9, 1.8], col: 'rgba(14,13,12,0.85)', light: 'rgba(170,165,155,0.25)', branch: 0.8, wander: 0.55, step: 6 });
  return { canvas: c };
};

GEN.brick = () => {
  const W = 512, rows = 16, rh = W / rows, cols = 4, cw = W / cols, mort = 4;
  const r = rngf(71);
  const tex = fbm(W, W, 24, 24, 3, 72);
  const soot = fbm(W, W, 4, 4, 5, 73);
  const chip = fbm(W, W, 32, 32, 3, 74);
  const efl = fbm(W, W, 30, 3, 3, 75);
  const bc = [];
  for (let k = 0; k < rows * cols; k++) {
    const t = r();
    const base = t < 0.12 ? [70, 40, 32] : t < 0.3 ? [140, 78, 52] : [lerp(98, 128, r()), lerp(46, 62, r()), lerp(34, 42, r())];
    bc.push(base);
  }
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const row = Math.floor(y / rh), ly = y - row * rh;
    const xo = (x + (row % 2) * (cw / 2)) % W;
    const col = Math.floor(xo / cw), lx = xo - col * cw;
    const e = Math.min(lx, cw - lx, ly, rh - ly) - (chip[p] - 0.5) * 3;
    let R, G, B;
    if (e < mort * 0.5) {
      const v = 108 + tex[p] * 30;
      R = v;
      G = v * 0.97;
      B = v * 0.9;
      if (ly < mort * 0.5 + 1 && ly >= 0) {
        R *= 0.8;
        G *= 0.8;
        B *= 0.8;
      }
    } else {
      const c0 = bc[row * cols + col];
      const k = 0.78 + tex[p] * 0.4 + (r() - 0.5) * 0.08;
      R = c0[0] * k;
      G = c0[1] * k;
      B = c0[2] * k;
      if (e < mort * 0.5 + 2) {
        R *= 0.85;
        G *= 0.85;
        B *= 0.85;
      }
    }
    const s = 0.6 + 0.45 * soot[p];
    R *= s;
    G *= s;
    B *= s;
    const ef = sstep(0.78, 0.95, efl[p]) * 0.35;
    d[i] = lerp(R, 180, ef);
    d[i + 1] = lerp(G, 176, ef);
    d[i + 2] = lerp(B, 166, ef);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  drips(ctx2d(c), W, W, r, 30, [15, 12, 10], [0.06, 0.2], [40, 200], [3, 12]);
  return { canvas: c };
};

GEN.shingles = () => {
  const W = 512, rows = 8, rh = W / rows, tabs = 6, tw = W / tabs;
  const r = rngf(81);
  const gran = fbm(W, W, 64, 64, 2, 82);
  const moss = fbm(W, W, 5, 5, 5, 83);
  const dirt = fbm(W, W, 3, 3, 4, 84);
  const tc = [];
  for (let k = 0; k < rows * tabs; k++) {
    const miss = r() < 0.05;
    const v = lerp(0.75, 1.2, r());
    tc.push({ miss, c: [58 * v, 54 * v, 51 * v + r() * 6], jag: r() * 3 });
  }
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const row = Math.floor(y / rh), ly = y - row * rh;
    const xo = (x + (row % 2) * (tw / 2)) % W;
    const col = Math.floor(xo / tw), lx = xo - col * tw;
    const T = tc[row * tabs + col];
    let R, G, B;
    if (T.miss) {
      R = 26;
      G = 22;
      B = 20;
    } else {
      const k = 0.78 + gran[p] * 0.45 + (r() - 0.5) * 0.2;
      R = T.c[0] * k;
      G = T.c[1] * k;
      B = T.c[2] * k;
    }
    // shadow under the row above + curled bottom edge highlight
    if (ly < 7) {
      const s = lerp(0.35, 1, ly / 7);
      R *= s;
      G *= s;
      B *= s;
    }
    if (ly > rh - 3) {
      R *= 1.2;
      G *= 1.2;
      B *= 1.2;
    }
    if (lx < 1.8 || lx > tw - 1) {
      R *= 0.4;
      G *= 0.4;
      B *= 0.4;
    }
    const m = sstep(0.62, 0.82, moss[p]) * 0.8;
    R = lerp(R, 46 + gran[p] * 20, m);
    G = lerp(G, 56 + gran[p] * 22, m);
    B = lerp(B, 30, m);
    const dd = 0.8 + 0.3 * dirt[p];
    d[i] = R * dd;
    d[i + 1] = G * dd;
    d[i + 2] = B * dd;
    d[i + 3] = 255;
  });
  return { canvas: imgToCanvas(img) };
};

GEN.tin = () => {
  const W = 512, period = 16;
  const r = rngf(91);
  const mot = fbm(W, W, 6, 6, 5, 92);
  const rustN = fbm(W, W, 4, 3, 6, 93, 0.55);
  const vs = fbm(W, W, 32, 3, 4, 94);
  const ox = fbm(W, W, 20, 20, 3, 95);
  const rr = colorRamp([[0, 44, 26, 16], [0.4, 92, 46, 22], [0.75, 132, 70, 32], [1, 150, 92, 50]]);
  const tmp = [0, 0, 0];
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const ph = (x / period) * Math.PI * 2;
    const sh = 0.74 + 0.2 * Math.sin(ph) + 0.1 * Math.max(0, Math.sin(ph - 0.6)) ** 8;
    const g = 96 + mot[p] * 46;
    let R = g, G = g * 1.01, B = g * 0.98;
    const rk = sstep(0.42, 0.6, rustN[p] * 0.7 + vs[p] * 0.4 - 0.05);
    rr(rustN[p] * 0.6 + vs[p] * 0.5 + (r() - 0.5) * 0.15, tmp);
    R = lerp(R, tmp[0], rk);
    G = lerp(G, tmp[1], rk);
    B = lerp(B, tmp[2], rk);
    const w = sstep(0.8, 0.95, ox[p]) * (1 - rk) * 0.4;
    R = lerp(R, 170, w);
    G = lerp(G, 170, w);
    B = lerp(B, 162, w);
    // sheet overlap seams every 256px horizontally (1m)
    const sx = x % 256;
    let k = sh * (0.85 + 0.2 * vs[p]);
    if (sx < 2) k *= 0.45;
    d[i] = R * k;
    d[i + 1] = G * k;
    d[i + 2] = B * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 40, [90, 40, 16], [0.08, 0.28], [30, 220], [2, 8]);
  for (const yy of [18, 274]) {
    for (let x = period / 2; x < W; x += period * 2) {
      ctx.fillStyle = 'rgba(30,26,24,0.9)';
      ctx.beginPath();
      ctx.arc(x + period / 4, yy, 2.4, 0, 7);
      ctx.fill();
      const g = ctx.createLinearGradient(0, yy, 0, yy + 40);
      g.addColorStop(0, 'rgba(110,50,20,0.5)');
      g.addColorStop(1, 'rgba(110,50,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + period / 4 - 2, yy, 4, 40);
    }
  }
  return { canvas: c };
};

GEN.rust = () => {
  const W = 512;
  const r = rngf(101);
  const a = fbm(W, W, 6, 6, 6, 101, 0.55), b = fbm(W, W, 24, 24, 3, 102);
  const wo = worley(W, W, 14, 14, 103);
  const rr = colorRamp([[0, 34, 20, 14], [0.35, 78, 38, 18], [0.6, 122, 60, 26], [0.8, 150, 80, 36], [1, 168, 104, 58]]);
  const tmp = [0, 0, 0];
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const edge = sstep(0.0, 0.12, wo.f2[p] - wo.f1[p]);
    const t = a[p] * 0.7 + b[p] * 0.3 + (r() - 0.5) * 0.12 - (1 - edge) * 0.25;
    rr(t, tmp);
    d[i] = tmp[0];
    d[i + 1] = tmp[1];
    d[i + 2] = tmp[2];
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  for (let k = 0; k < 500; k++) {
    ctx.fillStyle = `rgba(18,10,6,${0.3 + r() * 0.5})`;
    ctx.beginPath();
    ctx.arc(r() * W, r() * W, 0.6 + r() * 2, 0, 7);
    ctx.fill();
  }
  return { canvas: c };
};

function scratches(ctx, W, H, r, n, col, len = [4, 30]) {
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  for (let k = 0; k < n; k++) {
    const x = r() * W, y = r() * H, a = r() * Math.PI * 2, l = lerp(len[0], len[1], r());
    ctx.lineWidth = 0.5 + r() * 0.9;
    wrapDraw(W, H, x, y, l, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
      ctx.stroke();
    });
  }
}

function chips(ctx, W, H, r, n, col, rad = [1, 5]) {
  for (let k = 0; k < n; k++) {
    const x = r() * W, y = r() * H, R = lerp(rad[0], rad[1], r());
    const c = typeof col === 'function' ? col(r) : col;
    wrapDraw(W, H, x, y, R * 2, (px, py) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      for (let s = 0; s < 7; s++) {
        const an = (s / 7) * Math.PI * 2, rr = R * (0.5 + r() * 0.7);
        ctx.lineTo(px + Math.cos(an) * rr, py + Math.sin(an) * rr);
      }
      ctx.fill();
    });
  }
}

GEN.metal = () => {
  const W = 512;
  const r = rngf(111);
  const a = fbm(W, W, 5, 5, 6, 111), vs = fbm(W, W, 30, 2, 4, 112);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = (0.75 + a[p] * 0.4) * (0.82 + 0.25 * vs[p]) + (r() - 0.5) * 0.05;
    d[i] = 64 * k;
    d[i + 1] = 72 * k;
    d[i + 2] = 74 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  scratches(ctx, W, W, r, 260, 'rgba(150,152,150,0.35)');
  scratches(ctx, W, W, r, 80, 'rgba(20,20,20,0.35)');
  chips(ctx, W, W, r, 90, (rr) => (rr() < 0.5 ? 'rgba(110,56,26,0.85)' : 'rgba(70,38,20,0.9)'), [1, 5]);
  drips(ctx, W, W, r, 30, [60, 30, 14], [0.08, 0.22], [30, 160], [2, 7]);
  return { canvas: c };
};

GEN.stone = () => {
  const W = 512;
  const r = rngf(121);
  // courses
  const rows = [];
  let yy = 0;
  while (yy < W) {
    let hgt = Math.floor(lerp(48, 88, r()));
    if (W - yy - hgt < 48) hgt = W - yy;
    const cuts = [];
    let xx = 0;
    const off = Math.floor(r() * W);
    while (xx < W) {
      let wd = Math.floor(lerp(64, 150, r()));
      if (W - xx - wd < 50) wd = W - xx;
      cuts.push(xx);
      xx += wd;
    }
    rows.push({ y0: yy, h: hgt, cuts, off, cols: cuts.map(() => [lerp(88, 128, r()), 0, 0, r()]) });
    yy += hgt;
  }
  for (const row of rows)
    for (const c of row.cols) {
      const warm = c[3];
      c[1] = c[0] * (0.95 + warm * 0.03);
      c[2] = c[0] * (0.86 + (1 - warm) * 0.08);
      c[0] *= 1 + warm * 0.06;
    }
  const tex = fbm(W, W, 12, 12, 4, 122), big = fbm(W, W, 4, 4, 4, 123), mo = fbm(W, W, 6, 6, 5, 124);
  const img = newImg(W, W);
  let ri = 0;
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    while (ri < rows.length - 1 && y >= rows[ri].y0 + rows[ri].h) ri++;
    if (y < rows[ri].y0) ri = 0;
    while (y >= rows[ri].y0 + rows[ri].h) ri++;
    const row = rows[ri];
    const ly = y - row.y0;
    const xo = (x + row.off) % W;
    let s = 0;
    while (s < row.cuts.length - 1 && xo >= row.cuts[s + 1]) s++;
    const x0 = row.cuts[s], x1 = s < row.cuts.length - 1 ? row.cuts[s + 1] : W;
    const e = Math.min(xo - x0, x1 - xo, ly, row.h - ly) + (tex[p] - 0.5) * 7;
    let R, G, B;
    if (e < 3) {
      const v = 52 + tex[p] * 20;
      R = v;
      G = v * 0.96;
      B = v * 0.88;
    } else {
      const c0 = row.cols[s];
      const k = (0.72 + tex[p] * 0.45) * (0.85 + 0.25 * big[p]) * (e < 7 ? 0.8 : 1) + (r() - 0.5) * 0.06;
      R = c0[0] * k;
      G = c0[1] * k;
      B = c0[2] * k;
    }
    const m = sstep(0.68, 0.85, mo[p] + (e < 6 ? 0.08 : 0)) * 0.6;
    d[i] = lerp(R, 44, m);
    d[i + 1] = lerp(G, 54, m);
    d[i + 2] = lerp(B, 30, m);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  drips(ctx2d(c), W, W, r, 30, [15, 14, 12], [0.06, 0.18], [40, 200], [4, 14]);
  return { canvas: c };
};

GEN.dockwood = () => {
  const W = 512;
  const r = rngf(131);
  const info = boardsImg({ W, H: W, n: 8, seed: 131, light: [88, 70, 52], dark: [38, 30, 24], tone: 0.2, grime: 0.5, warm: 4 });
  const alg = fbm(W, W, 5, 5, 5, 132);
  eachPx(info.img, (x, y, i, d) => {
    const lv = y % info.bw;
    const nearEdge = lv < 8 || lv > info.bw - 8 ? 0.35 : 0;
    const t = clamp(sstep(0.6, 0.85, alg[i >> 2]) * 0.6 + nearEdge * alg[i >> 2]);
    d[i] = lerp(d[i], 36, t);
    d[i + 1] = lerp(d[i + 1], 44, t);
    d[i + 2] = lerp(d[i + 2], 26, t);
  });
  const c = imgToCanvas(info.img);
  const ctx = ctx2d(c);
  nailsOnBoards(ctx, W, W, info, r, { studs: 3, rust: 0.8 });
  drawCracks(ctx, W, W, r, 14, { len: [30, 140], wander: 0.08, step: 5, width: [0.8, 1.5], col: 'rgba(12,10,8,0.7)', branch: 0 });
  return { canvas: c };
};

GEN.glass = () => {
  const W = 256;
  const r = rngf(141);
  const a = fbm(W, W, 4, 4, 5, 141), b = fbm(W, W, 10, 10, 3, 142);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const refl = sstep(0.1, 0.0, Math.abs(((x + y * 0.6) / W) % 1 - 0.35)) * 0.5;
    const grime = sstep(0.45, 0.9, a[p]);
    let R = 20 + refl * 26, G = 26 + refl * 30, B = 30 + refl * 34;
    R = lerp(R, 64 + b[p] * 20, grime * 0.8);
    G = lerp(G, 60 + b[p] * 18, grime * 0.8);
    B = lerp(B, 48 + b[p] * 14, grime * 0.8);
    d[i] = R;
    d[i + 1] = G;
    d[i + 2] = B;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  // spiderweb crack
  const cx = lerp(60, 200, r()), cy = lerp(60, 200, r());
  ctx.strokeStyle = 'rgba(170,180,182,0.55)';
  ctx.lineWidth = 0.9;
  const rays = 9 + Math.floor(r() * 5);
  const pts = [];
  for (let k = 0; k < rays; k++) {
    let ang = (k / rays) * Math.PI * 2 + r() * 0.4, x = cx, y = cy;
    const ray = [[x, y]];
    const L = 60 + r() * 140;
    for (let s = 0; s < L; s += 8) {
      ang += (r() - 0.5) * 0.25;
      x += Math.cos(ang) * 8;
      y += Math.sin(ang) * 8;
      ray.push([x, y]);
    }
    pts.push(ray);
    ctx.beginPath();
    ray.forEach(([px, py], j) => (j ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  }
  for (const ringIdx of [2, 4, 7]) {
    ctx.beginPath();
    for (let k = 0; k <= rays; k++) {
      const ray = pts[k % rays];
      const q = ray[Math.min(ringIdx, ray.length - 1)];
      if (k === 0) ctx.moveTo(q[0], q[1]);
      else ctx.lineTo(q[0] + (r() - 0.5) * 3, q[1] + (r() - 0.5) * 3);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(200,205,205,0.4)';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, 7);
  ctx.fill();
  drips(ctx, W, W, r, 16, [70, 62, 48], [0.1, 0.3], [20, 90], [3, 10]);
  return { canvas: c };
};

GEN.door = () => {
  const W = 256, H = 512;
  const r = rngf(151);
  const grain = boardsImg({ W, H, n: 4, seed: 151, vertical: true, light: [112, 100, 86], dark: [58, 50, 42], tone: 0.1, joints: 0 });
  const pm = fbm(W, H, 4, 8, 5, 152);
  const dirt = fbm(W, H, 3, 6, 4, 153);
  const img = grain.img;
  // panel layout (px)
  const panels = [[28, 36, 90, 190], [138, 36, 90, 190], [28, 262, 90, 200], [138, 262, 90, 200]];
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const paint = sstep(0.34, 0.38, pm[p]);
    let R = lerp(d[i], 58 + dirt[p] * 22, paint), G = lerp(d[i + 1], 70 + dirt[p] * 22, paint), B = lerp(d[i + 2], 58 + dirt[p] * 16, paint);
    let k = 1;
    for (const [px, py, pw, ph] of panels) {
      if (x >= px && x < px + pw && y >= py && y < py + ph) {
        const ex = Math.min(x - px, px + pw - x), ey = Math.min(y - py, py + ph - y);
        const e = Math.min(ex, ey);
        if (e < 7) {
          const topLeft = x - px < 7 || y - py < 7;
          k = topLeft ? 0.55 : 1.25;
        } else k = 0.92;
      }
    }
    const bottom = sstep(360, 512, y) * 0.45;
    k *= 1 - bottom * (0.5 + dirt[p] * 0.5);
    d[i] = R * k;
    d[i + 1] = G * k;
    d[i + 2] = B * k;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  // knob + plate
  ctx.fillStyle = 'rgba(40,32,22,1)';
  ctx.fillRect(214, 236, 16, 44);
  ctx.fillStyle = 'rgba(110,86,40,1)';
  ctx.beginPath();
  ctx.arc(222, 250, 7, 0, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,130,70,0.8)';
  ctx.beginPath();
  ctx.arc(220, 248, 2.5, 0, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(10,8,6,1)';
  ctx.fillRect(220, 266, 4, 8);
  // claw scratches
  ctx.strokeStyle = 'rgba(140,120,96,0.7)';
  ctx.lineWidth = 1.6;
  const sx = 60 + r() * 60, sy = 250 + r() * 80;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(sx + k * 9, sy);
    ctx.quadraticCurveTo(sx + k * 9 + 12, sy + 60, sx + k * 9 + 6, sy + 120);
    ctx.stroke();
  }
  // bloody hand smear
  ctx.fillStyle = 'rgba(70,8,6,0.55)';
  const hx = 150 + r() * 40, hy = 200 + r() * 40;
  ctx.beginPath();
  ctx.ellipse(hx, hy, 14, 17, 0.2, 0, 7);
  ctx.fill();
  for (let f = 0; f < 4; f++) {
    ctx.beginPath();
    ctx.ellipse(hx - 12 + f * 8, hy - 26 - Math.abs(f - 1.5) * -3, 3.4, 11, (f - 1.5) * 0.12, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(60,6,4,0.4)';
  ctx.fillRect(hx - 8, hy, 16, 90 + r() * 60);
  drips(ctx, W, H, r, 30, [25, 20, 14], [0.08, 0.2], [30, 160], [2, 8]);
  return { canvas: c };
};

GEN.hay = () => {
  const W = 256;
  const r = rngf(161);
  const base = fbm(W, W, 6, 6, 4, 161);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const v = 0.6 + base[i >> 2] * 0.4;
    d[i] = 108 * v;
    d[i + 1] = 88 * v;
    d[i + 2] = 46 * v;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  ctx.lineCap = 'round';
  const cols = [[172, 150, 90], [150, 124, 64], [124, 100, 50], [190, 170, 110], [96, 78, 44], [80, 66, 40]];
  for (let pass = 0; pass < 2; pass++)
    for (const col of cols) {
      ctx.strokeStyle = rgbA(col, 0.85);
      ctx.lineWidth = pass ? 1 : 1.6;
      ctx.beginPath();
      for (let k = 0; k < 420; k++) {
        const x = r() * W, y = r() * W, a = (r() - 0.5) * 1.3 + (r() < 0.2 ? Math.PI / 2 : 0), l = 8 + r() * 26;
        wrapDraw(W, W, x, y, l, (px, py) => {
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + (r() - 0.5) * 4, py + Math.sin(a) * l * 0.5 + (r() - 0.5) * 4, px + Math.cos(a) * l, py + Math.sin(a) * l);
        });
      }
      ctx.stroke();
    }
  blotches(ctx, W, W, r, 14, [30, 24, 12], [0.2, 0.45], [10, 40]);
  return { canvas: c };
};

GEN.canvas = () => {
  const W = 512;
  const r = rngf(171);
  const a = fbm(W, W, 5, 5, 6, 171), st = fbm(W, W, 8, 8, 4, 172), vs = fbm(W, W, 28, 3, 3, 173);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const weave = 0.93 + 0.07 * Math.sin(x * 2.1) * Math.sin(y * 2.1) + ((x + y) % 3 === 0 ? -0.03 : 0.02);
    let k = (0.78 + a[p] * 0.35) * weave * (0.85 + 0.2 * vs[p]);
    const ring = Math.abs(st[p] - 0.62);
    if (ring < 0.015) k *= 0.72;
    else if (st[p] > 0.62) k *= 0.88;
    d[i] = 118 * k;
    d[i + 1] = 112 * k;
    d[i + 2] = 88 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  // sewn patches
  for (let k = 0; k < 3; k++) {
    const x = r() * W, y = r() * W, w = 40 + r() * 60, h = 30 + r() * 50;
    const v = 0.8 + r() * 0.3;
    wrapDraw(W, W, x + w / 2, y + h / 2, Math.max(w, h), (px, py) => {
      ctx.fillStyle = rgb(104 * v, 106 * v, 80 * v, 0.9);
      ctx.fillRect(px - w / 2, py - h / 2, w, h);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(40,36,26,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - w / 2 + 3, py - h / 2 + 3, w - 6, h - 6);
      ctx.setLineDash([]);
    });
  }
  blotches(ctx, W, W, r, 30, [30, 28, 20], [0.1, 0.3], [8, 40]);
  blotches(ctx, W, W, r, 40, [40, 46, 30], [0.1, 0.25], [3, 10]);
  drips(ctx, W, W, r, 30, [30, 28, 20], [0.05, 0.14], [40, 220], [4, 16]);
  return { canvas: c };
};

GEN.olive = () => {
  const W = 512;
  const r = rngf(181);
  const a = fbm(W, W, 5, 5, 6, 181), vs = fbm(W, W, 30, 2, 4, 182), b = fbm(W, W, 18, 18, 3, 183);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = (0.78 + a[p] * 0.32 + (b[p] - 0.5) * 0.1) * (0.84 + 0.22 * vs[p]) + (r() - 0.5) * 0.04;
    d[i] = 72 * k;
    d[i + 1] = 78 * k;
    d[i + 2] = 50 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  chips(ctx, W, W, r, 160, (rr) => (rr() < 0.6 ? 'rgba(46,48,40,0.9)' : 'rgba(100,60,30,0.8)'), [0.8, 4]);
  scratches(ctx, W, W, r, 120, 'rgba(120,122,100,0.3)');
  drips(ctx, W, W, r, 30, [25, 25, 16], [0.08, 0.2], [40, 180], [3, 10]);
  return { canvas: c };
};

// ---------------------------------------------------------------- props
function paintedMaskImg(W, seed, { rustAmt = 0.5, chipsN = 120, base = 222 } = {}) {
  // RGB: paint (light, to be tinted) or rust; A = paint mask
  const r = rngf(seed);
  const a = fbm(W, W, 4, 4, 6, seed, 0.55), vs = fbm(W, W, 26, 2, 4, seed + 1), mot = fbm(W, W, 8, 8, 4, seed + 2);
  const rs = fbm(W, W, 10, 10, 4, seed + 3);
  const rr = colorRamp([[0, 40, 24, 16], [0.45, 96, 48, 22], [0.8, 138, 72, 32], [1, 154, 96, 52]]);
  const tmp = [0, 0, 0];
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const m = a[p] * 0.7 + vs[p] * 0.3;
    const paint = 1 - sstep(1 - rustAmt - 0.02, 1 - rustAmt + 0.02, m);
    const k = (0.78 + mot[p] * 0.3) * (0.82 + 0.22 * vs[p]);
    rr(rs[p] + (r() - 0.5) * 0.2, tmp);
    const edge = paint > 0.02 && paint < 0.98 ? 0.6 : 1;
    d[i] = lerp(tmp[0], base * k, paint) * edge;
    d[i + 1] = lerp(tmp[1], base * 0.98 * k, paint) * edge;
    d[i + 2] = lerp(tmp[2], base * 0.93 * k, paint) * edge;
    d[i + 3] = 255 * paint;
  });
  // chips via canvas on a separate mask canvas
  const c = mkCanvas(W, W);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, W);
  chips(ctx, W, W, r, chipsN, '#fff', [1, 5]);
  const cm = canvasToImg(c);
  eachPx(img, (x, y, i, d) => {
    if (cm.d[i] > 128 && d[i + 3] > 0) {
      rr(0.35 + r() * 0.4, tmp);
      d[i] = tmp[0];
      d[i + 1] = tmp[1];
      d[i + 2] = tmp[2];
      d[i + 3] = 0;
    }
  });
  // dark grime streaks (applies to both)
  const gs = fbm(W, W, 30, 2, 4, seed + 7);
  eachPx(img, (x, y, i, d) => {
    const k = 0.7 + 0.3 * gs[i >> 2];
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  });
  return img;
}
GEN.paint = () => paintedMaskImg(512, 191, { rustAmt: 0.3, chipsN: 160 });
GEN.carpaint = () => paintedMaskImg(512, 201, { rustAmt: 0.36, chipsN: 90 });

GEN.tire = () => {
  const W = 256;
  const r = rngf(211);
  const a = fbm(W, W, 6, 6, 4, 211);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    // tread blocks: lateral grooves every 16px (u = around), zig-zag center groove
    const lx = x % 16;
    const zig = 128 + Math.abs(((x / 8) % 2) - 1) * 10 - 5;
    let k = 1;
    if (lx < 3) k = 0.45;
    if (Math.abs(y - zig) < 3 || Math.abs(y - 64) < 2 || Math.abs(y - 192) < 2) k = 0.45;
    const dust = sstep(0.5, 0.9, a[p]) * 0.5;
    const v = (30 + a[p] * 10 + (r() - 0.5) * 5) * k;
    d[i] = lerp(v, 78, dust);
    d[i + 1] = lerp(v, 70, dust);
    d[i + 2] = lerp(v, 60, dust);
    d[i + 3] = 255;
  });
  return { canvas: imgToCanvas(img) };
};

GEN.cloth = () => {
  const W = 256;
  const r = rngf(221);
  const a = fbm(W, W, 4, 4, 5, 221), f = fbm(W, W, 3, 10, 4, 222);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const weave = 0.92 + 0.08 * ((x + (y % 2)) % 2);
    const k = (0.7 + a[p] * 0.25 + (f[p] - 0.5) * 0.35) * weave;
    d[i] = 214 * k;
    d[i + 1] = 210 * k;
    d[i + 2] = 200 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  blotches(ctx, W, W, r, 20, (rr) => (rr() < 0.3 ? [70, 16, 10] : [60, 48, 30]), [0.15, 0.4], [6, 30]);
  chips(ctx, W, W, r, 8, 'rgba(10,8,6,0.9)', [1.5, 5]);
  return { canvas: c };
};

GEN.burlap = () => {
  const W = 256;
  const r = rngf(231);
  const a = fbm(W, W, 5, 5, 4, 231);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const tx = Math.abs(Math.sin((x + a[p] * 3) * 0.8)), ty = Math.abs(Math.sin((y + a[p] * 3) * 0.8));
    const thread = Math.max(tx * ((x >> 2) % 2 ? 1 : 0.6), ty * ((y >> 2) % 2 ? 0.6 : 1));
    const k = (0.35 + 0.65 * thread) * (0.75 + a[p] * 0.4) + (r() - 0.5) * 0.08;
    d[i] = 150 * k;
    d[i + 1] = 124 * k;
    d[i + 2] = 84 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  blotches(ctx2d(c), W, W, r, 14, [40, 30, 18], [0.15, 0.4], [8, 40]);
  return { canvas: c };
};

GEN.bone = () => {
  const W = 128;
  const r = rngf(241);
  const a = fbm(W, W, 4, 4, 5, 241);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const k = 0.7 + a[i >> 2] * 0.35 + (r() - 0.5) * 0.05;
    d[i] = 186 * k;
    d[i + 1] = 176 * k;
    d[i + 2] = 150 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  blotches(ctx, W, W, r, 10, [60, 44, 26], [0.2, 0.5], [4, 18]);
  drawCracks(ctx, W, W, r, 4, { len: [10, 40], width: [0.5, 0.9], col: 'rgba(40,30,20,0.6)', step: 3 });
  return { canvas: c };
};

GEN.charred = () => {
  const W = 256;
  const r = rngf(251);
  const wo = worley(W, W, 10, 16, 251);
  const a = fbm(W, W, 5, 5, 4, 252);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const e = wo.f2[p] - wo.f1[p];
    const crack = 1 - sstep(0.02, 0.09, e);
    const k = 16 + a[p] * 22 + (r() - 0.5) * 6;
    d[i] = lerp(k * 1.05, 64, crack * 0.5);
    d[i + 1] = lerp(k, 56, crack * 0.5);
    d[i + 2] = lerp(k * 0.92, 50, crack * 0.5);
    const ember = crack * sstep(0.7, 0.9, a[p]);
    d[i] = lerp(d[i], 110, ember * 0.5);
    d[i + 1] = lerp(d[i + 1], 40, ember * 0.4);
    d[i + 3] = 255;
  });
  return { canvas: imgToCanvas(img) };
};

GEN.endgrain = () => {
  const W = 128;
  const r = rngf(261);
  const a = fbm(W, W, 4, 4, 4, 261);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const dx = x - 64 + (a[i >> 2] - 0.5) * 6, dy = y - 64 + (a[i >> 2] - 0.5) * 6;
    const rr = Math.sqrt(dx * dx + dy * dy);
    const ring = 0.75 + 0.25 * Math.sin(rr * 1.3 + a[i >> 2] * 4);
    let R = 128 * ring, G = 104 * ring, B = 74 * ring;
    if (rr > 56) {
      R = 50;
      G = 38;
      B = 28;
    } else if (rr > 52) {
      R *= 0.7;
      G *= 0.7;
      B *= 0.7;
    }
    const k = 0.85 + (r() - 0.5) * 0.1;
    d[i] = R * k;
    d[i + 1] = G * k;
    d[i + 2] = B * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  ctx.strokeStyle = 'rgba(30,20,14,0.8)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    const an = r() * 6.28;
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(64 + Math.cos(an) * 50, 64 + Math.sin(an) * 50);
    ctx.stroke();
  }
  return { canvas: c };
};

GEN.skin = () => {
  const W = 256;
  const r = rngf(271);
  const a = fbm(W, W, 5, 5, 5, 271), b = fbm(W, W, 3, 3, 4, 272);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = 0.78 + a[p] * 0.3;
    const bruise = sstep(0.62, 0.85, b[p]) * 0.6;
    d[i] = lerp(150 * k, 80, bruise);
    d[i + 1] = lerp(142 * k, 70, bruise);
    d[i + 2] = lerp(120 * k, 82, bruise);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  blotches(ctx2d(c), W, W, r, 16, [70, 10, 8], [0.3, 0.7], [4, 22]);
  return { canvas: c };
};

GEN.mattress = () => {
  const W = 256;
  const r = rngf(281);
  const a = fbm(W, W, 4, 4, 5, 281);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const s = (x % 32) < 10 ? [96, 110, 124] : [196, 188, 170];
    const k = 0.72 + a[i >> 2] * 0.3;
    const quilt = (x % 64 < 1 || y % 64 < 1) ? 0.75 : 1;
    d[i] = s[0] * k * quilt;
    d[i + 1] = s[1] * k * quilt;
    d[i + 2] = s[2] * k * quilt;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  for (let k = 0; k < 6; k++) {
    const x = r() * W, y = r() * W, R = 20 + r() * 40;
    wrapDraw(W, W, x, y, R, (px, py) => {
      ctx.strokeStyle = 'rgba(110,84,30,0.5)';
      ctx.lineWidth = 3;
      ctx.fillStyle = 'rgba(150,120,50,0.25)';
      ctx.beginPath();
      ctx.ellipse(px, py, R, R * 0.8, r() * 3, 0, 7);
      ctx.fill();
      ctx.stroke();
    });
  }
  blotches(ctx, W, W, r, 5, [80, 8, 6], [0.5, 0.8], [8, 26]);
  return { canvas: c };
};

GEN.plastic = () => {
  const W = 256;
  const r = rngf(291);
  const a = fbm(W, W, 3, 8, 5, 291), b = fbm(W, W, 8, 3, 4, 292);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const wr = Math.abs(a[p] - 0.5) < 0.03 || Math.abs(b[p] - 0.5) < 0.025 ? 1.9 : 1;
    const v = (18 + a[p] * 12) * wr + (r() - 0.5) * 3;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v * 1.08;
    d[i + 3] = 255;
  });
  return { canvas: imgToCanvas(img) };
};

GEN.pumpkin = () => {
  const W = 256;
  const r = rngf(301);
  const a = fbm(W, W, 5, 5, 5, 301), rot = fbm(W, W, 4, 4, 5, 302);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const rib = 0.8 + 0.2 * Math.abs(Math.sin((x / W) * Math.PI * 8));
    const k = (0.75 + a[p] * 0.35) * rib;
    let R = 168 * k, G = 86 * k, B = 26 * k;
    const rt = sstep(0.6, 0.78, rot[p]);
    R = lerp(R, 40, rt);
    G = lerp(G, 32, rt);
    B = lerp(B, 18, rt);
    const mold = sstep(0.8, 0.9, rot[p]) * 0.7;
    d[i] = lerp(R, 110, mold);
    d[i + 1] = lerp(G, 112, mold);
    d[i + 2] = lerp(B, 96, mold);
    d[i + 3] = 255;
  });
  return { canvas: imgToCanvas(img) };
};

GEN.ash = () => {
  const W = 256;
  const r = rngf(311);
  const a = fbm(W, W, 6, 6, 5, 311);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const v = 44 + a[i >> 2] * 60 + (r() - 0.5) * 18;
    d[i] = v;
    d[i + 1] = v * 0.97;
    d[i + 2] = v * 0.94;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  chips(ctx2d(c), W, W, r, 160, (rr) => (rr() < 0.7 ? 'rgba(12,10,9,0.9)' : 'rgba(60,40,30,0.8)'), [1, 5]);
  return { canvas: c };
};

GEN.cardboard = () => {
  const W = 256;
  const r = rngf(321);
  const a = fbm(W, W, 4, 4, 5, 321);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const k = (0.78 + a[i >> 2] * 0.3) * (y % 6 < 1 ? 0.94 : 1);
    d[i] = 150 * k;
    d[i + 1] = 118 * k;
    d[i + 2] = 78 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  blotches(ctx, W, W, r, 12, [60, 44, 26], [0.2, 0.45], [8, 36]);
  ctx.fillStyle = 'rgba(170,160,130,0.55)';
  ctx.fillRect(0, 118, W, 20);
  return { canvas: c };
};

// ---------------------------------------------------------------- vegetation
GEN.bark = () => {
  const W = 256, H = 512;
  const r = rngf(401);
  const wo = worley(W, H, 7, 4, 401);
  const a = fbm(W, H, 20, 2, 4, 402), b = fbm(W, H, 4, 8, 4, 403), li = fbm(W, H, 8, 16, 4, 404);
  const fib = fbm(W, H, 48, 3, 3, 405);
  const img = newImg(W, H);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const e = wo.f2[p] - wo.f1[p] + (a[p] - 0.5) * 0.12;
    const crev = 1 - sstep(0.02, 0.1, e);
    const plateK = (0.72 + b[p] * 0.3 + (a[p] - 0.5) * 0.25 + (r() - 0.5) * 0.06) * (0.8 + 0.3 * fib[p]) * (0.8 + 0.25 * sstep(0.05, 0.3, e));
    let R = 78 * plateK, G = 62 * plateK, B = 52 * plateK;
    R = lerp(R, 20, crev);
    G = lerp(G, 15, crev);
    B = lerp(B, 12, crev);
    const l = sstep(0.72, 0.84, li[p]) * (1 - crev) * 0.55;
    d[i] = lerp(R, 104, l);
    d[i + 1] = lerp(G, 110, l);
    d[i + 2] = lerp(B, 88, l);
    d[i + 3] = 255;
  });
  return { canvas: imgToCanvas(img) };
};

GEN.bark_birch = () => {
  const W = 256, H = 512;
  const r = rngf(411);
  const a = fbm(W, H, 4, 8, 5, 411), b = fbm(W, H, 20, 6, 3, 412);
  const img = newImg(W, H);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = 0.8 + a[p] * 0.22 + (b[p] - 0.5) * 0.1;
    d[i] = 196 * k;
    d[i + 1] = 190 * k;
    d[i + 2] = 176 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  // lenticels
  for (let k = 0; k < 300; k++) {
    const x = r() * W, y = r() * H, l = 4 + r() * 22, h = 1 + r() * 1.8;
    ctx.fillStyle = `rgba(${40 + r() * 30},${36 + r() * 24},${34 + r() * 20},${0.5 + r() * 0.4})`;
    wrapDraw(W, H, x, y, l, (px, py) => ctx.fillRect(px - l / 2, py, l, h));
  }
  // black scars
  for (let k = 0; k < 7; k++) {
    const x = r() * W, y = r() * H, w = 10 + r() * 22, h = 6 + r() * 16;
    wrapDraw(W, H, x, y, w * 2, (px, py) => {
      ctx.fillStyle = 'rgba(20,18,16,0.92)';
      ctx.beginPath();
      ctx.moveTo(px - w, py);
      ctx.quadraticCurveTo(px, py - h, px + w, py);
      ctx.quadraticCurveTo(px, py + h * 1.4, px - w, py);
      ctx.fill();
    });
  }
  blotches(ctx, W, H, r, 12, [60, 56, 44], [0.15, 0.35], [10, 40]);
  blotches(ctx, W, H, r, 8, [150, 110, 90], [0.1, 0.3], [6, 20]);
  return { canvas: c };
};

GEN.bark_dead = () => {
  const W = 256, H = 512;
  const r = rngf(421);
  const g = fbm(W, H, 24, 2, 4, 421, 0.55), a = fbm(W, H, 4, 6, 5, 422), bp = fbm(W, H, 5, 7, 5, 423);
  const wo = worley(W, H, 5, 6, 424);
  const img = newImg(W, H);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = 0.7 + g[p] * 0.35 + (a[p] - 0.5) * 0.25 + (r() - 0.5) * 0.05;
    let R = 74 * k, G = 68 * k, B = 60 * k;
    const bark = sstep(0.5, 0.55, bp[p]);
    if (bark > 0) {
      const crev = 1 - sstep(0.03, 0.15, wo.f2[p] - wo.f1[p]);
      const bk = 0.8 + a[p] * 0.3;
      R = lerp(R, lerp(46 * bk, 16, crev), bark);
      G = lerp(G, lerp(38 * bk, 13, crev), bark);
      B = lerp(B, lerp(31 * bk, 11, crev), bark);
    }
    d[i] = R;
    d[i + 1] = G;
    d[i + 2] = B;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  // vertical deep cracks
  for (let k = 0; k < 16; k++) {
    let x = r() * W, y = r() * H;
    const L = 80 + r() * 300;
    ctx.strokeStyle = `rgba(20,18,16,${0.5 + r() * 0.4})`;
    ctx.lineWidth = 0.8 + r() * 1.6;
    const pts = [[x, y]];
    for (let s = 0; s < L; s += 6) {
      x += (r() - 0.5) * 2;
      y += 6;
      pts.push([x, y]);
    }
    for (const oy of [-H, 0, H])
      for (const ox of [-W, 0, W]) {
        ctx.beginPath();
        pts.forEach(([px, py], j) => (j ? ctx.lineTo(px + ox, py + oy) : ctx.moveTo(px + ox, py + oy)));
        ctx.stroke();
      }
  }
  return { canvas: c };
};

GEN.pine = () => {
  // 512x512 atlas. Left half (u 0..0.5): drooping branch spray card, base at the bottom (v=0), tip at the top.
  // Right half (u 0.5..1): whole-conifer silhouette (layered drooping tiers) for crown cores / far billboards.
  // Sprays are irregular bottlebrush branchlets (ragged envelope, gaps), needles drawn dark -> light so the
  // lighter, newer needles sit on top; tips pale.
  const W = 512, H = 512;
  const r = rngf(431);
  const layers = [[], [], [], []];
  const shades = [
    ['rgb(16,26,19)', 'rgb(20,31,22)', 'rgb(24,35,24)'],
    ['rgb(28,41,28)', 'rgb(33,47,31)', 'rgb(38,52,33)'],
    ['rgb(44,59,37)', 'rgb(50,66,40)', 'rgb(46,62,36)'],
    ['rgb(62,80,47)', 'rgb(70,86,50)', 'rgb(58,74,44)'],
  ];
  const twig = 'rgb(44,33,24)';
  const R = new Rec();
  const inX = (x, x0, x1) => Math.max(x0, Math.min(x1, x));
  // one bottlebrush branchlet; `lit` 0..1 shifts its needles towards the lighter layers
  const brush = (x0, y0, ang, len, nl, dens, lit, xr) => {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    layers[0].push(['l', x0, y0, inX(x0 + dx * len, ...xr), y0 + dy * len, 1.3, twig]);
    const steps = Math.max(2, Math.floor(len / dens));
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const px = x0 + dx * len * u, py = y0 + dy * len * u;
      for (let q = 0; q < 3; q++) {
        const side = r() < 0.5 ? -1 : 1;
        const na = ang + side * lerp(0.35, 1.35, r());
        const l = nl * (1 - u * 0.35) * lerp(0.65, 1.25, r());
        const v = clamp(lit * 1.6 + 0.35 + (r() - 0.5) * 1.4 + (u > 0.8 ? 0.9 : 0), 0, 3.49);
        const L = Math.floor(v);
        const c = shades[L][Math.floor(r() * 3)];
        layers[L].push(['l', px, py, inX(px + Math.cos(na) * l, ...xr), py + Math.sin(na) * l, 1.5, c]);
      }
    }
  };
  // ---- spray (x 0..256)
  const SW = 256;
  const xr = [5, SW - 5];
  const stem = (t) => [SW / 2 + Math.sin(t * 2.2) * 8, H - 4 - t * (H - 14)];
  for (let t = 0.02; t < 0.99; t += 0.024) {
    for (const side of [-1, 1]) {
      if (r() < 0.12) continue;
      const tt = t + (side > 0 ? 0.012 : 0) + (r() - 0.5) * 0.01;
      const env = Math.pow(Math.sin(Math.PI * clamp(tt * 0.82 + 0.12)), 0.55) * (0.5 + 0.5 * tt);
      const len = SW * 0.47 * env * lerp(0.55, 1.08, r());
      if (len < 8) continue;
      const [x0, y0] = stem(tt);
      const ang = -Math.PI / 2 + side * lerp(0.75, 1.15, r());
      const lit = r() * 0.8 + tt * 0.3;
      brush(x0, y0, ang, len, 11, 2.6, lit, xr);
      // secondary branchlets
      const n2 = Math.floor(len / 22);
      for (let k = 0; k < n2; k++) {
        if (r() < 0.25) continue;
        const u = (k + 0.5 + r() * 0.4) / (n2 + 0.6);
        const px = x0 + Math.cos(ang) * len * u, py = y0 + Math.sin(ang) * len * u;
        const a2 = ang + (r() < 0.5 ? -1 : 1) * lerp(0.35, 0.9, r());
        brush(px, py, a2, len * lerp(0.25, 0.45, r()) * (1 - u * 0.4), 9, 2.8, lit + 0.15, xr);
      }
    }
  }
  for (let t = 0.0; t < 1; t += 0.008) {
    const [x, y] = stem(t);
    for (const sd of [-1, 1]) {
      const na = -Math.PI / 2 + sd * lerp(0.4, 1.2, r());
      layers[t > 0.9 ? 3 : 1].push(['l', x, y, x + Math.cos(na) * 11, y + Math.sin(na) * 11, 1.5, t > 0.9 ? shades[3][0] : shades[1][Math.floor(r() * 3)]]);
    }
  }
  // ---- silhouette (x 256..512), apex at top, widest at the bottom: tiers of drooping brushes
  const cx = 384;
  const xs = [SW + 4, W - 4];
  for (let y = 12; y < H - 6; y += 6) {
    const t = (y - 12) / (H - 18);
    const hw = 6 + t * 114 * lerp(0.8, 1.05, r());
    for (const side of [-1, 1]) {
      const n = 1 + Math.floor(hw / 30);
      for (let k = 0; k < n; k++) {
        const L = hw * lerp(0.5, 1, r());
        const a = Math.PI / 2 - side * (Math.PI / 2 - lerp(0.25, 0.55, r()));
        brush(cx, y, a, L, 8, 3.4, r() * 0.7, xs);
      }
    }
  }
  layers[0].unshift(['l', cx, 6, cx, H - 2, 3, 'rgb(40,30,22)']);
  for (const layer of layers) for (const [, x0, y0, x1, y1, w, c] of layer) R.line(x0, y0, x1, y1, w, c);
  // clamped: with repeat, card edges sample the opposite edge of the atlas (dotted spokes above crowns)
  return { ...R.toImg(W, H, [26, 38, 27]), clamp: true };
};

GEN.leaves = () => {
  const W = 256;
  const r = rngf(441);
  const R = new Rec();
  const cols = ['rgb(150,110,40)', 'rgb(128,78,30)', 'rgb(106,84,40)', 'rgb(160,124,52)', 'rgb(90,60,28)', 'rgb(122,96,36)'];
  const twig = (x, y, ang, len, depth) => {
    const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
    R.line(x, y, x1, y1, depth === 0 ? 2.6 : 1.4, 'rgb(52,40,30)');
    const nLeaves = Math.floor(len / 14);
    for (let k = 0; k < nLeaves; k++) {
      const u = (k + 0.5) / nLeaves;
      const px = lerp(x, x1, u), py = lerp(y, y1, u);
      if (r() < 0.35) continue;
      const la = ang + (r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.9);
      const L = 9 + r() * 8;
      const cx = px + Math.cos(la) * L, cy = py + Math.sin(la) * L;
      R.line(px, py, cx, cy, 1, 'rgb(60,46,30)');
      R.ell(cx, cy, L * 0.55, L * 0.32, la, cols[Math.floor(r() * cols.length)]);
    }
    if (depth < 2)
      for (let k = 0; k < 2; k++) {
        const u = 0.3 + r() * 0.6;
        twig(lerp(x, x1, u), lerp(y, y1, u), ang + (r() - 0.5) * 1.8, len * 0.55, depth + 1);
      }
  };
  twig(W / 2, W - 4, -Math.PI / 2 + (r() - 0.5) * 0.3, W * 0.72, 0);
  twig(W / 2, W - 4, -Math.PI / 2 - 0.7, W * 0.45, 1);
  twig(W / 2, W - 4, -Math.PI / 2 + 0.7, W * 0.45, 1);
  return { ...R.toImg(W, W, [110, 84, 40]), clamp: true };
};

GEN.bush = () => {
  const W = 256;
  const r = rngf(451);
  const R = new Rec();
  const cols = ['rgb(28,40,24)', 'rgb(36,50,28)', 'rgb(46,58,30)', 'rgb(62,66,34)', 'rgb(74,64,36)', 'rgb(24,32,20)'];
  // twigs
  for (let k = 0; k < 14; k++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
    const l = 70 + r() * 110;
    R.line(W / 2 + (r() - 0.5) * 30, W - 2, W / 2 + Math.cos(a) * l, W - 2 + Math.sin(a) * l, 2, 'rgb(44,34,26)');
  }
  // leaves inside a dome
  for (let k = 0; k < 1100; k++) {
    const a = r() * Math.PI, rr = Math.sqrt(r()) * 0.98;
    const x = W / 2 + Math.cos(a) * rr * W * 0.48;
    const y = W - 4 - Math.sin(a) * rr * W * 0.9;
    const edge = rr > 0.85;
    if (edge && r() < 0.4) continue;
    const low = y > W * 0.75 ? 0.6 : 1;
    const c = low < 1 && r() < 0.6 ? cols[5] : cols[Math.floor(r() * 5)];
    R.ell(x, y, 3 + r() * 3.2, 1.6 + r() * 1.8, r() * 3.14, c);
  }
  return { ...R.toImg(W, W, [34, 44, 26]), clamp: true };
};

GEN.fern = () => {
  const W = 128, H = 512;
  const r = rngf(461);
  const R = new Rec();
  const cols = ['rgb(34,58,28)', 'rgb(42,66,32)', 'rgb(52,74,36)', 'rgb(30,48,26)'];
  const brown = ['rgb(96,74,40)', 'rgb(80,62,34)'];
  const bx = W / 2;
  R.line(bx, H - 2, bx, 10, 2.2, 'rgb(44,54,28)');
  for (let y = H - 30; y > 14; y -= 9) {
    const t = 1 - (y - 14) / (H - 44);
    const len = (W * 0.46) * Math.pow(Math.sin(Math.PI * clamp(1 - t * 0.95)), 0.6);
    for (const sd of [-1, 1]) {
      const ang = sd > 0 ? -0.35 : Math.PI + 0.35;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const x0 = bx, y0 = y + (sd > 0 ? 3 : 0);
      R.line(x0, y0, x0 + dx * len, y0 + dy * len, 1, 'rgb(40,54,28)');
      const nl = Math.max(2, Math.floor(len / 4));
      const brownTip = r() < 0.15;
      for (let k = 0; k < nl; k++) {
        const u = (k + 0.5) / nl;
        const px = x0 + dx * len * u, py = y0 + dy * len * u;
        const lobe = 3.4 * (1 - u * 0.6);
        const c = brownTip && u > 0.5 ? brown[Math.floor(r() * 2)] : cols[Math.floor(r() * 4)];
        R.ell(px, py - 2.5, lobe * 0.7, lobe, ang, c);
        R.ell(px, py + 2.5, lobe * 0.7, lobe, ang, c);
      }
    }
  }
  return { ...R.toImg(W, H, [38, 60, 30]), clamp: true };
};

GEN.grass_blade = () => {
  // dense clump card: a low layer of short blades fills the base, taller blades and a few straw ones on top
  // (base -> tip darkening and straw tips come from the vertex attributes)
  const W = 256;
  const r = rngf(471);
  const R = new Rec();
  const low = ['rgb(46,56,30)', 'rgb(54,64,33)', 'rgb(42,52,28)', 'rgb(60,68,36)'];
  const mid = ['rgb(66,76,39)', 'rgb(76,84,43)', 'rgb(86,92,48)', 'rgb(70,76,40)', 'rgb(94,96,52)'];
  const straw = ['rgb(124,114,72)', 'rgb(110,100,62)', 'rgb(138,124,80)'];
  const blade = (x0, h, lean, w, c) => {
    // keep every blade inside the card: clipped blades leave straight edges
    lean = Math.max(8 - x0, Math.min(W - 8 - x0, lean));
    const cx = x0 + lean * 0.3, cy = W - h * 0.55;
    const tx = x0 + lean, ty = W - h;
    const pts = [];
    const N = 8;
    const P = (t) => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * tx, (1 - t) * (1 - t) * W + 2 * (1 - t) * t * cy + t * t * ty];
    for (let s = 0; s <= N; s++) {
      const t = s / N, [px, py] = P(t);
      pts.push(px - w * (1 - t) * 0.5, py);
    }
    for (let s = N; s >= 0; s--) {
      const t = s / N, [px, py] = P(t);
      pts.push(px + w * (1 - t) * 0.5, py);
    }
    R.poly(pts, c);
  };
  for (let k = 0; k < 80; k++) blade(6 + r() * (W - 12), 50 + r() * 90, (r() - 0.5) * 70, 2.2 + r() * 2.6, low[Math.floor(r() * low.length)]);
  for (let k = 0; k < 64; k++) {
    const dry = r() < 0.22;
    const h = 110 + r() * 140;
    const x0 = 10 + r() * (W - 20);
    blade(x0, h, (r() - 0.5) * 100, 2.2 + r() * 3, dry ? straw[Math.floor(r() * straw.length)] : mid[Math.floor(r() * mid.length)]);
    if (dry && r() < 0.35) for (let s = 0; s < 6; s++) R.ell(x0 + (r() - 0.5) * 6 + (r() - 0.5) * 20, W - h + s * 4, 1.8, 3.2, 0.3, 'rgb(128,110,70)');
  }
  return { ...R.toImg(W, W, [62, 70, 38]), clamp: true };
};

GEN.rock = () => {
  const W = 512;
  const r = rngf(481);
  const a = fbm(W, W, 4, 4, 6, 481, 0.55), b = fbm(W, W, 20, 20, 3, 482), wo = worley(W, W, 6, 6, 483);
  const li = fbm(W, W, 10, 10, 4, 484);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const vein = 1 - sstep(0.0, 0.05, wo.f2[p] - wo.f1[p]);
    let k = 0.62 + a[p] * 0.45 + (b[p] - 0.5) * 0.15 + (r() - 0.5) * 0.12 - vein * 0.08;
    const sp = r();
    if (sp < 0.03) k *= 0.6;
    else if (sp > 0.98) k *= 1.25;
    let R = 108 * k, G = 106 * k, B = 100 * k;
    const l = sstep(0.74, 0.82, li[p]) * 0.6;
    R = lerp(R, 128, l);
    G = lerp(G, 132, l);
    B = lerp(B, 100, l);
    d[i] = R;
    d[i + 1] = G;
    d[i + 2] = B;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  drawCracks(ctx, W, W, r, 8, { len: [40, 200], width: [0.8, 1.6], col: 'rgba(22,20,18,0.8)', light: 'rgba(160,156,146,0.25)', wander: 0.4, step: 5 });
  chips(ctx, W, W, r, 60, (rr) => (rr() < 0.5 ? 'rgba(150,120,60,0.5)' : 'rgba(140,146,110,0.5)'), [1, 3]);
  return { canvas: c };
};

// ---------------------------------------------------------------- ground (512, seamless)
function strokesWrapped(ctx, W, H, r, n, cols, len, width, angFn, alpha = 0.9) {
  ctx.lineCap = 'round';
  const buckets = cols.map(() => []);
  for (let k = 0; k < n; k++) buckets[Math.floor(r() * cols.length)].push(k);
  cols.forEach((c, ci) => {
    ctx.strokeStyle = rgbA(c, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const _ of buckets[ci]) {
      const x = r() * W, y = r() * H, a = angFn ? angFn(r) : r() * Math.PI * 2, l = lerp(len[0], len[1], r());
      const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
      wrapDraw(W, H, x, y, l, (px, py) => {
        ctx.moveTo(px, py);
        ctx.lineTo(px + dx, py + dy);
      });
    }
    ctx.stroke();
  });
}
function pebbles(ctx, W, H, r, n, cols, rad) {
  for (let k = 0; k < n; k++) {
    const x = r() * W, y = r() * H, R = lerp(rad[0], rad[1], r()), a = r() * 3.14, e = 0.6 + r() * 0.4;
    const c = cols[Math.floor(r() * cols.length)];
    wrapDraw(W, H, x, y, R * 2, (px, py) => {
      ctx.fillStyle = 'rgba(10,8,6,0.45)';
      ctx.beginPath();
      ctx.ellipse(px + R * 0.25, py + R * 0.3, R, R * e, a, 0, 7);
      ctx.fill();
      ctx.fillStyle = rgbA(c);
      ctx.beginPath();
      ctx.ellipse(px, py, R, R * e, a, 0, 7);
      ctx.fill();
      ctx.fillStyle = rgbA(c, 0.6, 1.3);
      ctx.beginPath();
      ctx.ellipse(px - R * 0.25, py - R * 0.25, R * 0.45, R * 0.3 * e, a, 0, 7);
      ctx.fill();
    });
  }
}

GEN.ground_grass = () => {
  // meadow seen from above: dark olive thatch between layered blades, a little straw, soil in the gaps
  const W = 512;
  const r = rngf(501);
  const a = fbm(W, W, 8, 8, 5, 501, 0.55), b = fbm(W, W, 16, 16, 3, 502), c2 = fbm(W, W, 6, 6, 3, 503);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const soil = sstep(0.64, 0.84, a[p]) * 0.65;
    const k = 0.78 + b[p] * 0.3 + (r() - 0.5) * 0.08;
    d[i] = lerp(lerp(36, 46, c2[p]), 54, soil) * k;
    d[i + 1] = lerp(lerp(44, 50, c2[p]), 44, soil) * k;
    d[i + 2] = lerp(24, 31, soil) * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  strokesWrapped(ctx, W, W, r, 9000, [[42, 54, 29], [50, 60, 31], [38, 48, 27], [58, 64, 35]], [3, 7], 1.1, null, 0.8);
  strokesWrapped(ctx, W, W, r, 7000, [[64, 74, 39], [72, 78, 41], [80, 82, 45], [60, 70, 35]], [3, 6], 1, null, 0.7);
  strokesWrapped(ctx, W, W, r, 1200, [[98, 92, 58], [90, 84, 52], [108, 98, 64]], [3, 6], 0.9, null, 0.45);
  pebbles(ctx, W, W, r, 14, [[80, 74, 66], [66, 60, 52]], [1.2, 2.6]);
  const img2 = canvasToImg(c);
  mulByNoise(img2, fbm(W, W, 5, 5, 4, 504), 0.82, 1.1);
  return { canvas: imgToCanvas(img2, c) };
};

GEN.ground_dirt = () => {
  const W = 512;
  const r = rngf(511);
  const a = fbm(W, W, 8, 8, 5, 511, 0.55), b = fbm(W, W, 24, 24, 3, 512);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = 0.8 + a[p] * 0.25 + (b[p] - 0.5) * 0.2 + (r() - 0.5) * 0.12;
    const wet = sstep(0.62, 0.85, 1 - a[p]) * 0.18;
    d[i] = 80 * k * (1 - wet);
    d[i + 1] = 64 * k * (1 - wet);
    d[i + 2] = 48 * k * (1 - wet * 0.8);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  pebbles(ctx, W, W, r, 280, [[82, 74, 64], [70, 62, 52], [90, 82, 70], [58, 48, 40]], [1, 4]);
  strokesWrapped(ctx, W, W, r, 90, [[40, 30, 22], [60, 46, 32]], [10, 30], 1.6);
  drawCracks(ctx, W, W, r, 5, { len: [40, 140], width: [0.8, 1.4], col: 'rgba(30,22,16,0.6)', step: 5 });
  return { canvas: c };
};

GEN.ground_forest = () => {
  const W = 512;
  const r = rngf(521);
  const a = fbm(W, W, 4, 4, 6, 521, 0.55), mo = fbm(W, W, 5, 5, 5, 522);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = 0.7 + a[p] * 0.45 + (r() - 0.5) * 0.12;
    d[i] = 46 * k;
    d[i + 1] = 36 * k;
    d[i + 2] = 27 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  strokesWrapped(ctx, W, W, r, 6000, [[66, 46, 30], [82, 58, 36], [54, 40, 28], [94, 66, 40], [42, 32, 24]], [4, 9], 1.1, null, 0.8);
  // dead leaves
  const lc = [[96, 64, 34], [120, 82, 40], [78, 56, 34], [104, 70, 30], [66, 50, 34]];
  for (let k = 0; k < 320; k++) {
    const x = r() * W, y = r() * W, R = 3 + r() * 5, an = r() * 6.28;
    const col = lc[Math.floor(r() * lc.length)], sh = 0.7 + r() * 0.5;
    wrapDraw(W, W, x, y, R * 2, (px, py) => {
      ctx.fillStyle = 'rgba(12,8,6,0.4)';
      ctx.beginPath();
      ctx.ellipse(px + 1, py + 1.2, R, R * 0.5, an, 0, 7);
      ctx.fill();
      ctx.fillStyle = rgbA(col, 0.95, sh);
      ctx.beginPath();
      ctx.ellipse(px, py, R, R * 0.5, an, 0, 7);
      ctx.fill();
      ctx.strokeStyle = rgbA(col, 0.8, sh * 0.6);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(an) * R, py - Math.sin(an) * R);
      ctx.lineTo(px + Math.cos(an) * R, py + Math.sin(an) * R);
      ctx.stroke();
    });
  }
  strokesWrapped(ctx, W, W, r, 4000, [[58, 42, 28], [74, 52, 32], [46, 36, 26]], [3, 8], 1, null, 0.75);
  strokesWrapped(ctx, W, W, r, 60, [[34, 26, 20], [50, 38, 28]], [14, 40], 2.2);
  const img2 = canvasToImg(c);
  tintByNoise(img2, mo, [38, 44, 26], 0.66, 0.9, 0.4);
  return { canvas: imgToCanvas(img2, c) };
};

GEN.ground_road = () => {
  const W = 512;
  const r = rngf(531);
  const a = fbm(W, W, 4, 4, 6, 531, 0.55), b = fbm(W, W, 6, 3, 4, 532), gr = fbm(W, W, 10, 6, 4, 533);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const u = x / W;
    const rw = 0.09 + (b[p] - 0.5) * 0.03;
    const r1 = Math.abs(u - 0.28), r2 = Math.abs(u - 0.72);
    const rut = Math.max(1 - sstep(rw * 0.5, rw, r1), 1 - sstep(rw * 0.5, rw, r2));
    const ridge = Math.max(sstep(rw * 1.4, rw, r1) * sstep(rw * 0.8, rw, r1), 0);
    const center = 1 - sstep(0.06, 0.12, Math.abs(u - 0.5));
    const edge = sstep(0.1, 0.02, Math.min(u, 1 - u));
    let k = 0.75 + a[p] * 0.4 + (r() - 0.5) * (0.16 - rut * 0.1);
    k *= 1 - rut * 0.25;
    k *= 1 + ridge * 0.12;
    let R = 94 * k, G = 82 * k, B = 66 * k;
    const grass = clamp((center + edge) * sstep(0.45, 0.7, gr[p]));
    R = lerp(R, 54, grass * 0.8);
    G = lerp(G, 60, grass * 0.8);
    B = lerp(B, 34, grass * 0.8);
    const puddle = rut * sstep(0.7, 0.8, 1 - a[p]) * 0.45;
    R = lerp(R, 44, puddle);
    G = lerp(G, 40, puddle);
    B = lerp(B, 36, puddle);
    d[i] = R;
    d[i + 1] = G;
    d[i + 2] = B;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  pebbles(ctx, W, W, r, 1100, [[118, 112, 104], [96, 90, 82], [80, 74, 66], [134, 126, 114]], [0.8, 2.6]);
  // tread marks in ruts
  ctx.fillStyle = 'rgba(30,24,18,0.12)';
  for (const cu of [0.28, 0.72])
    for (let y = 0; y < W; y += 7) {
      ctx.fillRect(cu * W - 16, y, 12, 2.5);
      ctx.fillRect(cu * W + 4, y + 3, 12, 2.5);
    }
  strokesWrapped(ctx, W, W, r, 700, [[60, 70, 36], [80, 84, 44]], [4, 10], 1.2, (rr) => -Math.PI / 2 + (rr() - 0.5) * 1.8, 0.5);
  return { canvas: c };
};

GEN.ground_asphalt = () => {
  const W = 512;
  const r = rngf(541);
  const a = fbm(W, W, 4, 4, 6, 541, 0.55), m = fbm(W, W, 3, 3, 5, 542), wo = worley(W, W, 18, 18, 543);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    let k = 0.8 + a[p] * 0.3;
    const g = r();
    if (g < 0.08) k *= 0.6;
    else if (g > 0.9) k *= 1.45;
    else k *= 0.95 + (r() - 0.5) * 0.1;
    let v = 50 * k;
    const crackMask = sstep(0.55, 0.7, m[p]);
    const crack = (1 - sstep(0.0, 0.06, wo.f2[p] - wo.f1[p])) * crackMask;
    v = lerp(v, 14, crack * 0.9);
    const weed = crack * sstep(0.6, 0.8, a[p]);
    d[i] = lerp(v, 50, weed);
    d[i + 1] = lerp(v, 58, weed);
    d[i + 2] = lerp(v * 1.03, 32, weed);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  for (let k = 0; k < 2; k++) {
    const x = r() * W, y = r() * W, w = 40 + r() * 60, h = 30 + r() * 50;
    wrapDraw(W, W, x + w / 2, y + h / 2, Math.max(w, h), (px, py) => {
      ctx.fillStyle = 'rgba(34,34,36,0.4)';
      ctx.fillRect(px - w / 2, py - h / 2, w, h);
      ctx.strokeStyle = 'rgba(16,16,16,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px - w / 2, py - h / 2, w, h);
    });
  }
  blotches(ctx, W, W, r, 10, [14, 14, 16], [0.2, 0.45], [10, 36]);
  drawCracks(ctx, W, W, r, 6, { len: [100, 300], width: [1, 2.2], col: 'rgba(10,10,10,0.9)', branch: 1, step: 6, wander: 0.5 });
  return { canvas: c };
};

GEN.ground_mud = () => {
  const W = 512;
  const r = rngf(551);
  const a = fbm(W, W, 6, 6, 5, 551, 0.55), b = fbm(W, W, 18, 18, 4, 552), w2 = fbm(W, W, 8, 8, 4, 553);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    let k = 0.75 + a[p] * 0.35 + (b[p] - 0.5) * 0.3 + (r() - 0.5) * 0.05;
    const ridge = sstep(0.62, 0.72, b[p]) * 0.25;
    k += ridge;
    let R = 54 * k, G = 42 * k, B = 30 * k;
    const pud = sstep(0.66, 0.72, w2[p]) * 0.8;
    R = lerp(R, 30, pud);
    G = lerp(G, 29, pud);
    B = lerp(B, 28, pud);
    const rim = sstep(0.6, 0.66, w2[p]) * (1 - pud) * 0.2;
    d[i] = R * (1 - rim);
    d[i + 1] = G * (1 - rim);
    d[i + 2] = B * (1 - rim);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  pebbles(ctx, W, W, r, 120, [[70, 62, 54], [56, 48, 40]], [1, 3.5]);
  strokesWrapped(ctx, W, W, r, 200, [[70, 56, 40], [34, 26, 20]], [8, 20], 1.2);
  return { canvas: c };
};

GEN.ground_sand = () => {
  const W = 512;
  const r = rngf(561);
  const a = fbm(W, W, 6, 6, 5, 561, 0.55), b = fbm(W, W, 40, 6, 3, 562), w2 = fbm(W, W, 8, 8, 4, 563);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = 0.8 + a[p] * 0.28 + (b[p] - 0.5) * 0.1 + (r() - 0.5) * 0.14;
    const wet = sstep(0.58, 0.8, w2[p]) * 0.2;
    d[i] = 124 * k * (1 - wet);
    d[i + 1] = 114 * k * (1 - wet);
    d[i + 2] = 96 * k * (1 - wet * 0.9);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  pebbles(ctx, W, W, r, 260, [[110, 104, 96], [88, 82, 74], [140, 132, 120], [70, 64, 58]], [1, 4]);
  strokesWrapped(ctx, W, W, r, 60, [[50, 40, 30], [70, 60, 44]], [6, 20], 1.4);
  return { canvas: c };
};

// ---------------------------------------------------------------- fx sprites (grey on transparent)
function spriteImg(W, H, fn) {
  const img = newImg(W, H);
  const tmp = [1, 1];
  eachPx(img, (x, y, i, d) => {
    fn((x + 0.5) / W, (y + 0.5) / H, tmp, x, y);
    const g = clamp(tmp[0]) * 255;
    d[i] = g;
    d[i + 1] = g;
    d[i + 2] = g;
    d[i + 3] = clamp(tmp[1]) * 255;
  });
  return img;
}

GEN.fx_fire = () => {
  // 4x4 animated sheet, frame 0 top-left, row-major. Frames loop.
  const S = 128, N = 4, W = S * N;
  const nz = fbm(S, S * 4, 4, 16, 4, 601, 0.55);
  const nz2 = fbm(S, S * 4, 8, 32, 3, 602);
  const img = newImg(W, W);
  const d = img.d;
  for (let f = 0; f < 16; f++) {
    const fx = (f % N) * S, fy = Math.floor(f / N) * S;
    const off = f * ((S * 4) / 16);
    for (let y = 0; y < S; y++) {
      const ny = 1 - y / S; // 0 bottom .. 1 top
      const sy = Math.floor((y + off * 2) % (S * 4));
      for (let x = 0; x < S; x++) {
        const nx = (x - S / 2) / (S / 2);
        const n = nz[sy * S + x], n2 = nz2[sy * S + x];
        const width = 1.05 * Math.pow(Math.max(0, ny + 0.04), 0.3) * Math.pow(Math.max(0, 1 - ny), 0.75);
        const dx = Math.abs(nx + (n - 0.5) * 0.7 * ny);
        let v = 1 - dx / (width + 1e-3);
        v -= (n2 - 0.5) * 0.9 * ny + ny * 0.15;
        v = clamp(v * 1.5);
        const baseFade = sstep(0.0, 0.1, ny) * sstep(1.0, 0.9, Math.abs(nx));
        const a = sstep(0.0, 0.35, v) * baseFade;
        const g = 0.55 + 0.45 * sstep(0.3, 0.9, v);
        const i = ((fy + y) * W + fx + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = g * 255;
        d[i + 3] = a * 255;
      }
    }
  }
  return { ...img, clamp: true };
};

GEN.fx_smoke = () => {
  const S = 128;
  const n = fbm(S, S, 4, 4, 5, 611);
  return {
    ...spriteImg(S, S, (u, v, o, x, y) => {
      const dx = u - 0.5, dy = v - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 2;
      const nn = n[y * S + x];
      const a = Math.pow(clamp(1 - r), 1.4) * (0.35 + 0.9 * nn);
      o[0] = 0.75 + 0.25 * nn - dy * 0.2;
      o[1] = a * 0.9;
    }),
    clamp: true,
  };
};

GEN.fx_spark = () => ({
  ...spriteImg(64, 64, (u, v, o) => {
    const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2, r2 = dx * dx + dy * dy;
    o[0] = 1;
    o[1] = Math.exp(-r2 * 30) + 0.35 * Math.exp(-r2 * 5) + 0.25 * Math.exp(-(dx * dx * 40 + dy * dy * 1.5));
  }),
  clamp: true,
});

GEN.fx_glow = () => ({
  ...spriteImg(128, 128, (u, v, o) => {
    const r = Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2) * 2;
    o[0] = 1;
    o[1] = Math.pow(clamp(1 - r), 2.2);
  }),
  clamp: true,
});

GEN.fx_muzzle = () => {
  const r = rngf(621);
  const spikes = [];
  const n = 6;
  for (let k = 0; k < n; k++) spikes.push({ a: (k / n) * Math.PI * 2 + (r() - 0.5) * 0.3, l: 0.55 + r() * 0.45, w: 0.08 + r() * 0.06 });
  return {
    ...spriteImg(256, 256, (u, v, o) => {
      const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2, rr = Math.sqrt(dx * dx + dy * dy), an = Math.atan2(dy, dx);
      let s = 0;
      for (const sp of spikes) {
        let da = an - sp.a;
        da = Math.abs(((da % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        const wAt = sp.w * (1 - rr / sp.l);
        if (wAt > 0) s = Math.max(s, sstep(wAt, wAt * 0.2, da * rr * 1.2 + da * 0.05));
      }
      const core = Math.exp(-rr * rr * 14);
      o[0] = 0.8 + 0.2 * core;
      o[1] = Math.min(1, s * 0.9 + core * 1.1 + Math.exp(-rr * rr * 4) * 0.25);
    }),
    clamp: true,
  };
};

GEN.fx_blood = () => {
  const r = rngf(631);
  const S = 64;
  const blobs = [{ x: 0.5, y: 0.5, r: 0.17 }];
  for (let k = 0; k < 9; k++) {
    const a = r() * 6.28, dd = 0.14 + r() * 0.2;
    blobs.push({ x: 0.5 + Math.cos(a) * dd, y: 0.5 + Math.sin(a) * dd, r: 0.02 + r() * 0.045 });
  }
  const n = fbm(S, S, 4, 4, 3, 632);
  return {
    ...spriteImg(S, S, (u, v, o, x, y) => {
      let f = 0;
      for (const b of blobs) f += (b.r * b.r) / ((u - b.x) ** 2 + (v - b.y) ** 2 + 1e-4);
      o[0] = 0.8 + 0.2 * n[y * S + x];
      o[1] = sstep(0.8, 1.3, f + (n[y * S + x] - 0.5) * 0.6);
    }),
    clamp: true,
  };
};

function decal(W, seed, fn) {
  const img = newImg(W, W);
  const n = fbm(W, W, 5, 5, 5, seed);
  const n2 = fbm(W, W, 16, 16, 3, seed + 1);
  const tmp = [0, 0, 0, 0];
  eachPx(img, (x, y, i, d) => {
    const u = (x + 0.5) / W - 0.5, v = (y + 0.5) / W - 0.5;
    fn(u, v, Math.sqrt(u * u + v * v) * 2, n[i >> 2], n2[i >> 2], tmp, Math.atan2(v, u));
    d[i] = tmp[0];
    d[i + 1] = tmp[1];
    d[i + 2] = tmp[2];
    d[i + 3] = clamp(tmp[3]) * 255;
  });
  return img;
}

GEN.decal_blood = () => {
  const r = rngf(641);
  const drops = [];
  for (let k = 0; k < 26; k++) {
    const a = r() * 6.28, dd = 0.35 + r() * 0.55;
    drops.push([Math.cos(a) * dd * 0.5, Math.sin(a) * dd * 0.5, 0.008 + r() * 0.025]);
  }
  const lobes = [];
  for (let k = 0; k < 5; k++) lobes.push([r() * 6.28, 0.1 + r() * 0.15]);
  const img = decal(256, 642, (u, v, rr, n, n2, o, an) => {
    let rad = 0.55;
    for (const [la, ls] of lobes) rad += Math.max(0, Math.cos(an - la)) ** 6 * ls;
    rad += (n - 0.5) * 0.35;
    let a = sstep(rad, rad - 0.05, rr);
    for (const [dx, dy, dr] of drops) {
      const dd = Math.sqrt((u - dx) ** 2 + (v - dy) ** 2);
      a = Math.max(a, sstep(dr, dr * 0.6, dd));
    }
    const center = 1 - sstep(0, rad, rr);
    const k = 0.7 + n2 * 0.3;
    o[0] = lerp(92, 48, center) * k;
    o[1] = lerp(10, 4, center) * k;
    o[2] = lerp(8, 4, center) * k;
    o[3] = a * (0.82 + 0.15 * center);
  });
  return { ...img, clamp: true };
};

GEN.decal_acid = () => {
  const r = rngf(651);
  const bubbles = [];
  for (let k = 0; k < 40; k++) {
    const a = r() * 6.28, dd = Math.sqrt(r()) * 0.33;
    bubbles.push([Math.cos(a) * dd, Math.sin(a) * dd, 0.008 + r() * 0.03]);
  }
  const img = decal(256, 652, (u, v, rr, n, n2, o) => {
    const rad = 0.7 + (n - 0.5) * 0.5;
    let a = sstep(rad, rad - 0.08, rr);
    const center = 1 - sstep(0, rad, rr);
    let R = lerp(60, 150, center), G = lerp(110, 210, center), B = lerp(18, 40, center);
    const k = 0.75 + n2 * 0.35;
    R *= k;
    G *= k;
    B *= k;
    for (const [bx, by, br] of bubbles) {
      const dd = Math.sqrt((u - bx) ** 2 + (v - by) ** 2);
      if (dd < br) {
        const rim = sstep(br * 0.6, br, dd);
        R = lerp(R, 200, rim * 0.8);
        G = lerp(G, 250, rim * 0.8);
        B = lerp(B, 90, rim * 0.8);
        a = Math.max(a, 0.9);
      }
    }
    o[0] = R;
    o[1] = G;
    o[2] = B;
    o[3] = a * 0.9;
  });
  return { ...img, clamp: true };
};

GEN.decal_scorch = () => {
  const img = decal(256, 661, (u, v, rr, n, n2, o) => {
    const rad = 0.75 + (n - 0.5) * 0.4;
    const a = Math.pow(sstep(rad, 0.1, rr), 0.8);
    const k = n2 > 0.7 ? 50 : 14;
    o[0] = k;
    o[1] = k * 0.95;
    o[2] = k * 0.9;
    o[3] = a * (0.75 + n2 * 0.25);
  });
  return { ...img, clamp: true };
};

GEN.fx_cone = () => ({
  // bright at the top (v=1 = light source), fading to 0 at the bottom; soft on both u edges
  ...spriteImg(64, 256, (u, v, o) => {
    const across = Math.exp(-(((u - 0.5) / 0.26) ** 2));
    const along = Math.pow(1 - v, 1.6);
    o[0] = 1;
    o[1] = across * along;
  }),
  clamp: true,
});

GEN.fx_rope = () => {
  const W = 64, H = 256;
  const n = fbm(W, H, 4, 16, 3, 671);
  const r = rngf(672);
  const img = newImg(W, H);
  eachPx(img, (x, y, i, d) => {
    const u = (x + 0.5) / W;
    const across = (u - 0.5) * 2;
    const cyl = Math.sqrt(Math.max(0, 1 - across * across));
    const strand = 0.5 + 0.5 * Math.sin(((y / H) * 16 + u * 1.5) * Math.PI * 2);
    const k = (0.45 + 0.55 * cyl) * (0.7 + 0.3 * strand) * (0.8 + 0.3 * n[i >> 2]) + (r() - 0.5) * 0.1;
    d[i] = 176 * k;
    d[i + 1] = 158 * k;
    d[i + 2] = 124 * k;
    d[i + 3] = sstep(1.0, 0.8, Math.abs(across)) * 255;
  });
  return { ...img, noAniso: true };
};

GEN.fx_parachute = () => {
  const W = 512, H = 256, gores = 8;
  const n = fbm(W, H, 6, 3, 5, 681);
  const img = newImg(W, H);
  eachPx(img, (x, y, i, d) => {
    const g = Math.floor((x / W) * gores), lx = (x / W) * gores - g;
    const col = g % 2 ? [150, 144, 118] : [86, 92, 64];
    let k = 0.8 + n[i >> 2] * 0.3;
    if (lx < 0.02 || lx > 0.98) k *= 0.55;
    if (y < 6) k *= 0.4;
    const hem = y > H - 10 ? 0.7 : 1;
    d[i] = col[0] * k * hem;
    d[i + 1] = col[1] * k * hem;
    d[i + 2] = col[2] * k * hem;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  blotches(ctx2d(c), W, H, rngf(682), 20, [40, 36, 24], [0.15, 0.35], [8, 30]);
  return { canvas: c };
};

// ---------------------------------------------------------------- burlap scarecrow head (equirect, face at u=0.75)
GEN.scareface = () => {
  const W = 256, H = 128;
  const base = canvasToImg(GEN.burlap().canvas);
  const c = mkCanvas(W, H);
  const ctx = ctx2d(c);
  ctx.drawImage(imgToCanvas(base), 0, 0, 256, 256, 0, 0, W, H);
  ctx.drawImage(imgToCanvas(base), 0, 0, 256, 256, 0, 0, W, H);
  const cx = W * 0.75, cy = H * 0.5;
  ctx.strokeStyle = 'rgba(16,10,8,0.95)';
  ctx.lineCap = 'round';
  // X-stitched eyes (uneven)
  ctx.lineWidth = 3;
  for (const [ex, ey, s] of [[cx - 17, cy - 10, 8], [cx + 15, cy - 12, 6]]) {
    ctx.beginPath();
    ctx.moveTo(ex - s, ey - s);
    ctx.lineTo(ex + s, ey + s);
    ctx.moveTo(ex + s, ey - s);
    ctx.lineTo(ex - s, ey + s);
    ctx.stroke();
  }
  // dark hollow eye stains
  ctx.fillStyle = 'rgba(20,12,8,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx - 17, cy - 8, 12, 12, 0, 0, 7);
  ctx.ellipse(cx + 15, cy - 10, 10, 10, 0, 0, 7);
  ctx.fill();
  // stitched grin
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy + 12);
  ctx.quadraticCurveTo(cx, cy + 26, cx + 24, cy + 9);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const x = lerp(cx - 26, cx + 24, t), y = cy + 12 + Math.sin(t * Math.PI) * 9 - t * 3;
    ctx.beginPath();
    ctx.moveTo(x - 1, y - 5);
    ctx.lineTo(x + 1, y + 5);
    ctx.stroke();
  }
  // blood drip from mouth
  ctx.fillStyle = 'rgba(70,10,6,0.6)';
  ctx.fillRect(cx - 4, cy + 20, 3, 20);
  ctx.fillRect(cx + 6, cy + 19, 2, 12);
  return { canvas: c };
};

// ---------------------------------------------------------------- iteration 2 surfaces
// crushed grey quarry gravel (seamless)
GEN.gravel = () => {
  const W = 256;
  const r = rngf(911);
  const a = fbm(W, W, 5, 5, 4, 911);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const v = 84 + a[i >> 2] * 44 + (r() - 0.5) * 16;
    d[i] = v;
    d[i + 1] = v * 0.98;
    d[i + 2] = v * 0.95;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  const cols = [[118, 116, 110], [100, 98, 94], [128, 122, 112], [90, 88, 86], [112, 104, 94], [136, 132, 124]];
  pebbles(ctx, W, W, r, 700, cols, [1.6, 3.6]);
  pebbles(ctx, W, W, r, 500, cols, [0.8, 1.8]);
  chips(ctx, W, W, r, 140, 'rgba(24,22,20,0.5)', [0.8, 2]);
  return { canvas: c };
};

// chain-link fence mesh (alpha): 4x4 diamonds, galvanised wire with rust spots
GEN.chainlink = () => {
  const W = 128, cell = 32;
  const n = fbm(W, W, 4, 4, 3, 921);
  const img = newImg(W, W);
  const hw = 1.9;
  eachPx(img, (x, y, i, d) => {
    const u = (x + 0.5) / cell, v = (y + 0.5) / cell;
    const f1 = u + v, f2 = u - v;
    const d1 = (Math.abs(f1 - Math.round(f1)) * cell) / Math.SQRT2;
    const d2 = (Math.abs(f2 - Math.round(f2)) * cell) / Math.SQRT2;
    const dd = Math.min(d1, d2);
    const cov = clamp(hw + 0.5 - dd);
    // round-wire shading across the strand + knuckle highlight at crossings
    const across = clamp(dd / hw);
    const knuckle = Math.max(d1, d2) < 3 ? 1.15 : 1;
    const rust = sstep(0.66, 0.86, n[i >> 2]) * 0.8;
    const k = (0.72 + 0.35 * Math.sqrt(1 - across * across)) * knuckle;
    d[i] = lerp(150, 120, rust) * k;
    d[i + 1] = lerp(152, 78, rust) * k;
    d[i + 2] = lerp(150, 48, rust) * k;
    d[i + 3] = cov * 255;
  });
  return { ...img };
};

// ---------------------------------------------------------------- label / stencil atlas (1024)
// rect = [x, y, w, h] in pixels of the 1024 atlas (y from top). 'alpha' cells have transparent background.
export const ATLAS = {
  medkit: [0, 0, 256, 256],
  hazard: [256, 0, 256, 256],
  sign: [512, 0, 256, 256],
  moon: [768, 0, 128, 128],
  bullet: [896, 0, 128, 128],
  ammo_9mm: [0, 256, 256, 128],
  ammo_shells: [256, 256, 256, 128],
  ammo_762: [512, 256, 256, 128],
  ammo_308: [768, 256, 256, 128],
  army: [0, 384, 256, 128],
  supply: [256, 384, 256, 128],
  pump: [512, 384, 256, 256],
  grave: [768, 384, 256, 128],
  flammable: [768, 512, 256, 128],
  battery: [0, 512, 256, 128],
  pills: [256, 512, 256, 128],
  carbattery: [0, 640, 256, 128],
  plate: [256, 640, 256, 128],
  gunparts: [512, 640, 256, 128],
  cross_mark: [768, 640, 128, 128],
  hazard_small: [896, 640, 128, 128],
  numbers: [0, 768, 256, 128],
  whiskey: [256, 768, 256, 128],
  // iteration 2 (props / pickups)
  blueprint: [768, 128, 256, 128],
  billboard: [512, 768, 512, 256],
  motel: [0, 896, 256, 128],
  vacancy: [256, 896, 256, 64],
  bus_text: [256, 960, 256, 64],
};
export function atlasUV(name) {
  const [x, y, w, h] = ATLAS[name];
  return { u0: x / 1024, u1: (x + w) / 1024, v0: 1 - (y + h) / 1024, v1: 1 - y / 1024 };
}

GEN.atlas = () => {
  const S = 1024;
  const c = mkCanvas(S, S);
  const ctx = ctx2d(c);
  const m = mkCanvas(S, S); // alpha mask
  const mx = ctx2d(m);
  mx.fillStyle = '#fff';
  mx.fillRect(0, 0, S, S);
  const r = rngf(701);
  ctx.fillStyle = '#6a6a60';
  ctx.fillRect(0, 0, S, S);
  const font = (px, w = 'bold') => `${w} ${px}px "Arial Black", "Arial", sans-serif`;
  const grime = (x, y, w, h, n = 10, a = 0.25) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let k = 0; k < n; k++) {
      const px = x + r() * w, py = y + r() * h, R = 6 + r() * Math.min(w, h) * 0.3;
      const g = ctx.createRadialGradient(px, py, 0, px, py, R);
      g.addColorStop(0, `rgba(30,24,16,${a * (0.5 + r())})`);
      g.addColorStop(1, 'rgba(30,24,16,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - R, py - R, R * 2, R * 2);
    }
    ctx.restore();
  };
  const text = (t, x, y, px, col, align = 'center', wgt = 'bold') => {
    ctx.font = font(px, wgt);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    ctx.fillText(t, x, y);
  };
  const alphaCell = (name) => {
    const [x, y, w, h] = ATLAS[name];
    mx.fillStyle = '#000';
    mx.fillRect(x, y, w, h);
  };
  const box = (name, col) => {
    const [x, y, w, h] = ATLAS[name];
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
    return [x, y, w, h];
  };
  // medkit: red case face with white cross
  {
    const [x, y, w, h] = box('medkit', '#8e1d18');
    ctx.fillStyle = '#d8d2c4';
    ctx.fillRect(x + w * 0.38, y + h * 0.18, w * 0.24, h * 0.64);
    ctx.fillRect(x + w * 0.18, y + h * 0.38, w * 0.64, h * 0.24);
    grime(x, y, w, h, 16, 0.35);
  }
  // hazard label
  {
    const [x, y, w, h] = box('hazard', '#b8a24a');
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#d2b43a';
    ctx.fillRect(-78, -78, 156, 156);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#141210';
    ctx.strokeRect(-70, -70, 140, 140);
    ctx.restore();
    // skull
    ctx.fillStyle = '#141210';
    ctx.beginPath();
    ctx.arc(x + 128, y + 112, 30, 0, 7);
    ctx.fill();
    ctx.fillRect(x + 110, y + 126, 36, 26);
    ctx.fillStyle = '#d2b43a';
    ctx.beginPath();
    ctx.arc(x + 116, y + 110, 8, 0, 7);
    ctx.arc(x + 140, y + 110, 8, 0, 7);
    ctx.fill();
    ctx.fillRect(x + 118, y + 142, 4, 10);
    ctx.fillRect(x + 126, y + 142, 4, 10);
    ctx.fillRect(x + 134, y + 142, 4, 10);
    ctx.strokeStyle = '#141210';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x + 88, y + 158);
    ctx.lineTo(x + 168, y + 190);
    ctx.moveTo(x + 168, y + 158);
    ctx.lineTo(x + 88, y + 190);
    ctx.stroke();
    grime(x, y, w, h, 14, 0.3);
  }
  // road sign: yellow warning square (geometry rotates it into a diamond)
  {
    const [x, y, w, h] = box('sign', '#a88a1e');
    ctx.fillStyle = '#b89a2a';
    ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
    ctx.strokeStyle = '#141210';
    ctx.lineWidth = 8;
    ctx.strokeRect(x + 16, y + 16, w - 32, h - 32);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-Math.PI / 4);
    // deer silhouette-ish crossing / curve arrow
    ctx.strokeStyle = '#141210';
    ctx.lineWidth = 18;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(-10, 70);
    ctx.lineTo(-10, 0);
    ctx.quadraticCurveTo(-10, -30, 20, -40);
    ctx.stroke();
    ctx.fillStyle = '#141210';
    ctx.beginPath();
    ctx.moveTo(18, -70);
    ctx.lineTo(56, -40);
    ctx.lineTo(14, -12);
    ctx.fill();
    ctx.restore();
    // rust + bullet holes
    grime(x, y, w, h, 18, 0.45);
    for (let k = 0; k < 7; k++) {
      const px = x + 30 + r() * (w - 60), py = y + 30 + r() * (h - 60);
      ctx.fillStyle = 'rgba(110,55,20,0.6)';
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#0c0a08';
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,190,170,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, 7);
      ctx.stroke();
    }
  }
  // moon crescent (alpha)
  {
    const [x, y, w, h] = ATLAS.moon;
    alphaCell('moon');
    ctx.fillStyle = '#0a0806';
    ctx.fillRect(x, y, w, h);
    mx.fillStyle = '#fff';
    mx.beginPath();
    mx.arc(x + 64, y + 64, 48, 0, 7);
    mx.fill();
    mx.fillStyle = '#000';
    mx.beginPath();
    mx.arc(x + 88, y + 52, 44, 0, 7);
    mx.fill();
  }
  // bullet hole (alpha) - generic decal
  {
    const [x, y, w, h] = ATLAS.bullet;
    alphaCell('bullet');
    ctx.fillStyle = '#0a0806';
    ctx.fillRect(x, y, w, h);
    mx.fillStyle = '#fff';
    mx.beginPath();
    mx.arc(x + 64, y + 64, 24, 0, 7);
    mx.fill();
  }
  // ammo boxes
  const ammo = (name, bg, stripe, t1, t2, tc) => {
    const [x, y, w, h] = box(name, bg);
    ctx.fillStyle = stripe;
    ctx.fillRect(x, y + h * 0.62, w, h * 0.22);
    text(t1, x + w / 2, y + h * 0.36, 54, tc);
    text(t2, x + w / 2, y + h * 0.73, 22, bg);
    grime(x, y, w, h, 10, 0.35);
  };
  ammo('ammo_9mm', '#b3922e', '#2a2418', '9MM', 'LUGER  50 RDS', '#1c160e');
  ammo('ammo_shells', '#7e1f19', '#d8ceb4', '12 GA', 'BUCKSHOT  00', '#e0d6bc');
  ammo('ammo_762', '#3e4630', '#c8b870', '7.62x39', 'CARTRIDGES 440', '#d8cc90');
  ammo('ammo_308', '#6a4020', '#e2d2a8', '.308 WIN', 'SOFT POINT 20', '#f0e2b8');
  // stencils (alpha): army, supply, grave text, flammable
  const stencil = (name, lines, px, col) => {
    const [x, y, w, h] = ATLAS[name];
    alphaCell(name);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
    mx.font = font(px);
    mx.textAlign = 'center';
    mx.textBaseline = 'middle';
    mx.fillStyle = '#fff';
    lines.forEach((ln, k) => mx.fillText(ln, x + w / 2, y + h * ((k + 1) / (lines.length + 1)) + (lines.length > 1 ? (k ? -6 : 6) : 0)));
    // stencil breaks + wear
    mx.fillStyle = '#000';
    for (let k = 0; k < 90; k++) mx.fillRect(x + r() * w, y + r() * h, 1 + r() * 4, 1 + r() * 3);
  };
  stencil('army', ['U.S. ARMY', '4 AMMO 7.62'], 34, '#c8c09a');
  stencil('supply', ['▲ SUPPLY ▲', 'AIRDROP 24'], 34, '#d0c8a0');
  stencil('flammable', ['FLAMMABLE', 'DIESEL - NO SMOKING'], 30, '#8c1c14');
  // gravestone inscription: engraved text (alpha)
  {
    const [x, y, w, h] = ATLAS.grave;
    alphaCell('grave');
    ctx.fillStyle = '#26241f';
    ctx.fillRect(x, y, w, h);
    mx.font = font(40, 'bold');
    mx.textAlign = 'center';
    mx.textBaseline = 'middle';
    mx.fillStyle = '#fff';
    mx.fillText('R.I.P.', x + w / 2, y + 38);
    mx.font = font(20, 'bold');
    mx.fillText('BELOVED', x + w / 2, y + 74);
    mx.fillText('1931 - 1987', x + w / 2, y + 102);
    mx.fillStyle = '#000';
    for (let k = 0; k < 60; k++) mx.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 1 + r() * 3);
  }
  // gas pump display
  {
    const [x, y, w, h] = box('pump', '#7a1d16');
    ctx.fillStyle = '#d6cfb8';
    ctx.fillRect(x + 12, y + 12, w - 24, 50);
    text('GAS', x + w / 2, y + 38, 38, '#7a1d16');
    ctx.fillStyle = '#16140f';
    ctx.fillRect(x + 20, y + 80, w - 40, 64);
    ctx.fillRect(x + 20, y + 160, w - 40, 64);
    text('0 0 0 0', x + w / 2, y + 114, 38, '#c9c0a4', 'center', 'normal');
    text('8 . 9 9', x + w / 2, y + 194, 38, '#c9c0a4', 'center', 'normal');
    ctx.font = font(12);
    ctx.fillStyle = '#d6cfb8';
    ctx.fillText('GALLONS', x + w / 2, y + 152);
    ctx.fillText('SALE', x + w / 2, y + 234);
    ctx.strokeStyle = 'rgba(200,200,200,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 30, y + 90);
    ctx.lineTo(x + 120, y + 200);
    ctx.lineTo(x + 180, y + 150);
    ctx.stroke();
    grime(x, y, w, h, 20, 0.45);
  }
  // batteries (copper top)
  {
    const [x, y, w, h] = box('battery', '#141414');
    ctx.fillStyle = '#9a5a26';
    ctx.fillRect(x, y, w * 0.3, h);
    text('1.5V', x + w * 0.62, y + h * 0.4, 40, '#c8a050');
    text('ALKALINE', x + w * 0.62, y + h * 0.72, 20, '#8a8a8a');
    grime(x, y, w, h, 6, 0.3);
  }
  // pills label
  {
    const [x, y, w, h] = box('pills', '#d8d4c8');
    ctx.fillStyle = '#2d5d8a';
    ctx.fillRect(x, y, w, 30);
    text('Rx', x + 40, y + 70, 44, '#1c1c1c');
    ctx.fillStyle = '#3a3a3a';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 90, y + 50 + k * 16, 140 - k * 20, 6);
    grime(x, y, w, h, 8, 0.3);
  }
  // car battery label
  {
    const [x, y, w, h] = box('carbattery', '#1a1c20');
    ctx.fillStyle = '#23409a';
    ctx.fillRect(x, y + 20, w, 60);
    text('12V  HEAVY DUTY', x + w / 2, y + 50, 26, '#e0e0e0');
    text('+', x + 30, y + 104, 30, '#c03020');
    text('−', x + w - 30, y + 104, 30, '#d0d0d0');
    grime(x, y, w, h, 10, 0.35);
  }
  // license plate
  {
    const [x, y, w, h] = box('plate', '#c9c3ae');
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    text('OREGON', x + w / 2, y + 26, 18, '#2a4a7a');
    text('4KX 229', x + w / 2, y + 76, 58, '#1c1c1c');
    grime(x, y, w, h, 14, 0.45);
  }
  // gun parts box
  {
    const [x, y, w, h] = box('gunparts', '#3a3a34');
    text('PARTS KIT', x + w / 2, y + 46, 32, '#b0a888');
    text('M-16 / AR', x + w / 2, y + 90, 22, '#8a846c');
    grime(x, y, w, h, 10, 0.3);
  }
  // small red cross on white (for bandage wrappers)
  {
    const [x, y, w, h] = box('cross_mark', '#d6d0c2');
    ctx.fillStyle = '#9a1e18';
    ctx.fillRect(x + 50, y + 22, 28, 84);
    ctx.fillRect(x + 22, y + 50, 84, 28);
    grime(x, y, w, h, 6, 0.3);
  }
  // small hazard triangle
  {
    const [x, y, w, h] = box('hazard_small', '#c8b040');
    ctx.fillStyle = '#141210';
    ctx.beginPath();
    ctx.moveTo(x + 64, y + 16);
    ctx.lineTo(x + 116, y + 108);
    ctx.lineTo(x + 12, y + 108);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c8b040';
    ctx.beginPath();
    ctx.moveTo(x + 64, y + 36);
    ctx.lineTo(x + 100, y + 100);
    ctx.lineTo(x + 28, y + 100);
    ctx.closePath();
    ctx.fill();
    text('!', x + 64, y + 76, 44, '#141210');
  }
  // numbers (serial) stencil-ish
  {
    const [x, y, w, h] = box('numbers', '#3c4130');
    text('LOT 7-2231', x + w / 2, y + h / 2, 32, '#bdb48c');
  }
  // whiskey label
  {
    const [x, y, w, h] = box('whiskey', '#d8c9a0');
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(x, y + 8, w, 6);
    ctx.fillRect(x, y + h - 14, w, 6);
    text('OLD CROW', x + w / 2, y + 44, 34, '#3a1c10');
    text('KENTUCKY WHISKEY', x + w / 2, y + 80, 18, '#5a2a14');
    text('XXX', x + w / 2, y + 102, 16, '#7a1c10');
    grime(x, y, w, h, 14, 0.45);
  }
  // ---- iteration 2 cells
  // blueprint paper: blue with a fine grid and white technical line work (rolled schematics)
  {
    const [x, y, w, h] = box('blueprint', '#2a4a70');
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(150,185,230,0.28)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= w; k += 8) {
      ctx.beginPath();
      ctx.moveTo(x + k + 0.5, y);
      ctx.lineTo(x + k + 0.5, y + h);
      ctx.stroke();
    }
    for (let k = 0; k <= h; k += 8) {
      ctx.beginPath();
      ctx.moveTo(x, y + k + 0.5);
      ctx.lineTo(x + w, y + k + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(225,235,245,0.85)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    // parts: a long receiver + barrel, a circle (cylinder end), dimension lines
    ctx.strokeRect(x + 22, y + 34, 120, 26);
    ctx.strokeRect(x + 142, y + 42, 80, 10);
    ctx.beginPath();
    ctx.moveTo(x + 40, y + 60);
    ctx.lineTo(x + 34, y + 92);
    ctx.lineTo(x + 52, y + 92);
    ctx.lineTo(x + 60, y + 60);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 196, y + 88, 18, 0, 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 196, y + 88, 7, 0, 7);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 22, y + 24);
    ctx.lineTo(x + 222, y + 24);
    ctx.moveTo(x + 22, y + 20);
    ctx.lineTo(x + 22, y + 28);
    ctx.moveTo(x + 222, y + 20);
    ctx.lineTo(x + 222, y + 28);
    ctx.moveTo(x + 176, y + 88);
    ctx.lineTo(x + 150, y + 108);
    ctx.stroke();
    ctx.font = font(9, 'bold');
    ctx.fillStyle = 'rgba(225,235,245,0.85)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('SCHEMATIC  REV.3', x + 70, y + 100);
    ctx.fillText('412.5', x + 110, y + 17);
    // fold creases + age stains
    ctx.strokeStyle = 'rgba(10,20,40,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y);
    ctx.lineTo(x + w * 0.5, y + h);
    ctx.stroke();
    ctx.restore();
    grime(x, y, w, h, 10, 0.3);
  }
  // billboard poster: faded motel ad, torn strips showing boards, water streaks, red graffiti
  {
    const [x, y, w, h] = ATLAS.billboard;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#7f9aa0');
    g.addColorStop(0.55, '#b9b7a0');
    g.addColorStop(1, '#cbbf98');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // pines on the left + a moon
    ctx.fillStyle = '#3c5a44';
    for (const [px, ph] of [[40, 150], [78, 196], [118, 140]]) {
      ctx.beginPath();
      ctx.moveTo(x + px, y + h - 18 - ph);
      ctx.lineTo(x + px + ph * 0.32, y + h - 18);
      ctx.lineTo(x + px - ph * 0.32, y + h - 18);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#e8dfb8';
    ctx.beginPath();
    ctx.arc(x + 150, y + 52, 24, 0, 7);
    ctx.fill();
    text('PINE HOLLOW', x + 322, y + 58, 44, '#7a2418');
    text('MOTOR LODGE', x + 330, y + 108, 34, '#23364e');
    text('COLOR TV  ·  HEATED POOL', x + 330, y + 150, 18, '#3a3a34');
    ctx.fillStyle = '#7a2418';
    ctx.fillRect(x + 300, y + 170, 190, 36);
    text('NEXT EXIT  →', x + 395, y + 189, 22, '#e8dcc0');
    // sun fade
    ctx.fillStyle = 'rgba(230,226,205,0.28)';
    ctx.fillRect(x, y, w, h);
    // water streaks
    for (let k = 0; k < 40; k++) {
      const sx = x + r() * w, sl = 30 + r() * 200, sw = 1 + r() * 5;
      const gg = ctx.createLinearGradient(0, y, 0, y + sl);
      gg.addColorStop(0, 'rgba(40,36,26,0.35)');
      gg.addColorStop(1, 'rgba(40,36,26,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(sx, y, sw, sl);
    }
    // torn patches: boards showing through, pale paper edge
    const tear = (cx, cy, rw, rh) => {
      const pts = [];
      for (let s = 0; s < 14; s++) {
        const an = (s / 14) * Math.PI * 2;
        const k = 0.6 + r() * 0.55;
        pts.push([cx + Math.cos(an) * rw * k, cy + Math.sin(an) * rh * k]);
      }
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#ddd4b8';
      ctx.stroke();
      ctx.fillStyle = '#4a3a2a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,14,8,0.6)';
      ctx.lineWidth = 2;
      for (let k = 1; k < 5; k++) {
        ctx.beginPath();
        ctx.moveTo(cx - rw * 1.2, cy - rh + k * rh * 0.45);
        ctx.lineTo(cx + rw * 1.2, cy - rh + k * rh * 0.45);
        ctx.stroke();
      }
    };
    ctx.save();
    tear(x + 470, y + 40, 44, 50);
    tear(x + 200, y + 236, 70, 34);
    tear(x + 20, y + 120, 26, 60);
    ctx.restore();
    // graffiti
    ctx.save();
    ctx.translate(x + 168, y + 214);
    ctx.rotate(-0.08);
    ctx.shadowColor = 'rgba(120,10,6,0.9)';
    ctx.shadowBlur = 6;
    ctx.font = font(24, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8a1208';
    ctx.fillText('THEY COME AT NIGHT', 0, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(120,14,8,0.7)';
    for (let k = 0; k < 12; k++) ctx.fillRect(x + 20 + r() * 260, y + 226 + r() * 10, 2, 6 + r() * 16);
    ctx.restore();
    grime(x, y, w, h, 26, 0.35);
  }
  // motel sign face: red letters on teal board
  {
    const [x, y, w, h] = box('motel', '#2c6560');
    ctx.strokeStyle = '#d8ceb0';
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
    ctx.lineJoin = 'round';
    ctx.font = font(56);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#e2d6b4';
    ctx.strokeText('MOTEL', x + w / 2, y + h / 2 + 3);
    ctx.fillStyle = '#b8321c';
    ctx.fillText('MOTEL', x + w / 2, y + h / 2 + 3);
    for (let k = 0; k < 18; k++) {
      const gg = ctx.createLinearGradient(0, y, 0, y + h);
      gg.addColorStop(0, 'rgba(110,50,20,0.4)');
      gg.addColorStop(1, 'rgba(110,50,20,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(x + r() * w, y + r() * 30, 2 + r() * 4, 40 + r() * 80);
    }
    grime(x, y, w, h, 16, 0.4);
  }
  // NO VACANCY box
  {
    const [x, y, w, h] = box('vacancy', '#16130f');
    text('NO', x + 42, y + h / 2 + 2, 30, '#5a1a12');
    text('VACANCY', x + 150, y + h / 2 + 2, 30, '#a82a18');
    grime(x, y, w, h, 8, 0.35);
  }
  // SCHOOL BUS lettering (alpha stencil)
  {
    const [x, y, w, h] = ATLAS.bus_text;
    alphaCell('bus_text');
    ctx.fillStyle = '#121110';
    ctx.fillRect(x, y, w, h);
    mx.font = font(30);
    mx.textAlign = 'center';
    mx.textBaseline = 'middle';
    mx.fillStyle = '#fff';
    mx.fillText('SCHOOL BUS', x + w / 2, y + h / 2 + 2, w - 12);
    mx.fillStyle = '#000';
    for (let k = 0; k < 50; k++) mx.fillRect(x + r() * w, y + r() * h, 1 + r() * 4, 1 + r() * 3);
  }
  // compose alpha
  const ci = canvasToImg(c), mi = canvasToImg(m);
  for (let i = 0; i < ci.d.length; i += 4) ci.d[i + 3] = mi.d[i];
  return ci;
};
