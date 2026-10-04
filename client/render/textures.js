// Procedural canvas textures (no asset files). All textures are generated lazily and cached.
//
// Conventions:
//  - Image row 0 is the TOP of the texture (v = 1), like a canvas. flipY is applied on upload.
//  - Building / prop surface textures are designed for METER UVs: each texture covers a known world size
//    (see TEXTURE_WORLD_SIZE); materials.js sets texture.repeat = 1 / worldSize.
//  - Surface generators may also return `height` (Float32Array, 0..1, same size) and `relief` (the depth in
//    meters that 0..1 spans): getNormalMap(name) bakes the tangent-space normal map from it.
//  - Weathered surfaces keep their top layer OUT of the texture: RGB is the clean / bare material and the
//    alpha channel a tileable "wear" detail field. materials.js lays the paint, rust or moss over it in the
//    shader, driven by world-space noise, so no wall repeats its damage (see `surfacePatch` there).
//  - Ground textures are 512px and seamlessly tileable (periodic noise + wrapped drawing).
//  - fx_* sprites are white/grey on transparent (RGB is never black under transparent pixels -> premultiply-friendly).
//  - decal_* textures carry their own colour + alpha.
import * as THREE from 'three';

// ------------------------------------------------------------------ registry
const cache = new Map();
const derived = new Map();
const heights = new Map(); // height fields waiting to be baked into normal maps
const allTextures = new Set();
let maxAniso = 4;

// world size (meters) covered by one repeat of each surface texture (used by materials.js)
export const TEXTURE_WORLD_SIZE = {
  planks: 2, barn: 2, clapboard: 2, logwall: 2, concrete: 3, brick: 2, shingles: 2, tin: 2, rust: 1.5, chrome: 1,
  metal: 1.5, stone: 2, dockwood: 2, glass: 2, sash: 1, door: [1, 2.1], hay: 1, canvas: 2, olive: 2, wood: 1,
  bark: [1, 2], bark_birch: [1, 2], bark_dead: [1, 2], rock: 2, tire: 1, paint: 1.5, carpaint: 2, cloth: 0.6,
  burlap: 0.6, bone: 0.3, charred: 1, skin: 0.6, mattress: 1, plastic: 1, pumpkin: 1, ash: 1, cardboard: 0.6,
  ground_grass: 4, ground_dirt: 4, ground_forest: 4, ground_road: 4, ground_asphalt: 4, ground_mud: 4, ground_sand: 4,
  aircraft: 4,
  // the city's (citykit.js)
  plaster: 2, lino: 2.4, ceiling: 4.8, roofing: 4,
};

function registerTex(t) {
  allTextures.add(t);
  t.anisotropy = t.userData.noAniso ? 1 : maxAniso;
  return t;
}

function repeated(t, key, rx, ry) {
  if (rx === undefined) return t;
  if (ry === undefined) ry = rx;
  key = `${key}|${rx}|${ry}`;
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

/** Cached texture by name. Optional rx/ry return a cached clone with that repeat (shares the GPU image). */
export function getTexture(name, rx, ry) {
  let t = cache.get(name);
  if (!t) {
    const gen = GEN[name];
    if (!gen) throw new Error(`textures: unknown texture '${name}'`);
    const out = gen();
    if (out.height) heights.set(name, { h: out.height, w: out.canvas ? out.canvas.width : out.w, ht: out.canvas ? out.canvas.height : out.h, relief: out.relief ?? 0.01 });
    t = finish(out, name);
    cache.set(name, t);
  }
  return repeated(t, name, rx, ry);
}

/**
 * Tangent-space normal map baked from the height field of a surface texture, or null when its generator
 * leaves none. Same repeat convention as getTexture.
 */
export function getNormalMap(name, rx, ry) {
  const key = `${name}#n`;
  let t = cache.get(key);
  if (t === undefined) {
    getTexture(name);
    const hf = heights.get(name);
    heights.delete(name);
    t = hf ? finish(normalFromHeight(hf, TEXTURE_WORLD_SIZE[name] ?? 1), key) : null;
    cache.set(key, t);
  }
  return t && repeated(t, key, rx, ry);
}

// slopes are true to scale: `relief` meters of depth over a texture covering `size` meters
function normalFromHeight({ h, w, ht, relief }, size) {
  const [sx, sy] = Array.isArray(size) ? size : [size, size];
  const kx = (relief * w) / sx / 2, ky = (relief * ht) / sy / 2;
  const d = new Uint8ClampedArray(w * ht * 4);
  for (let y = 0, i = 0; y < ht; y++) {
    const up = ((y + ht - 1) % ht) * w, dn = ((y + 1) % ht) * w, row = y * w;
    for (let x = 0; x < w; x++, i += 4) {
      // image rows run down while v runs up
      const nx = (h[row + ((x + w - 1) % w)] - h[row + ((x + 1) % w)]) * kx;
      const ny = (h[dn + x] - h[up + x]) * ky;
      const inv = 127.5 / Math.sqrt(nx * nx + ny * ny + 1);
      d[i] = 127.5 + nx * inv;
      d[i + 1] = 127.5 + ny * inv;
      d[i + 2] = 127.5 + inv;
      d[i + 3] = 255;
    }
  }
  return { w, h: ht, d, linear: true };
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
  t.colorSpace = out.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
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
function drawCracks(ctx, W, H, r, count, { len = [40, 160], width = [0.8, 1.6], col = 'rgba(15,12,10,0.7)', light = null, branch = 0.3, step = 5, wander = 0.5, along = null } = {}) {
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
  // `along`: every crack starts within 0.12 rad of that direction (checks follow the grain)
  for (let i = 0; i < count; i++) walk(r() * W, r() * H, along === null ? r() * Math.PI * 2 : along + (r() < 0.5 ? Math.PI : 0) + (r() - 0.5) * 0.24, lerp(len[0], len[1], r()), 0);
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
// Grain runs along u: gently wavy growth lines that pinch around a few knots. `wave` = how far the lines
// wander (large values give the looping figure of plywood), `knots` per image.
function woodGrainImg(W, H, seed, light, dark, { rings = 24, streak = 0.6, lineDark = 0.28, fine = 0.08, wave = 2.2, knots = 3 } = {}) {
  const g1 = fbm(W, H, 1, 28, 4, seed, 0.55);
  const g2 = fbm(W, H, 2, 6, 3, seed + 1);
  const g3 = fbm(W, H, 4, 4, 4, seed + 2);
  const r = rngf(seed + 3);
  const kn = [];
  for (let k = 0; k < knots; k++) kn.push([r() * W, r() * H, 5 + r() * 7]);
  const img = newImg(W, H);
  const d = img.d;
  for (let y = 0, i = 0, p = 0; y < H; y++)
    for (let x = 0; x < W; x++, i += 4, p++) {
      // each knot lifts the lines over itself and leaves a dark eye
      let bulge = 0, eye = 0;
      for (const [kx, ky, kr] of kn) {
        let dx = Math.abs(x - kx), dy = Math.abs(y - ky);
        if (dx > W / 2) dx = W - dx;
        if (dy > H / 2) dy = H - dy;
        const q = (dx * dx) / (kr * kr * 9) + (dy * dy) / (kr * kr);
        if (q < 9) {
          bulge += Math.exp(-q) * 2.6;
          eye = Math.max(eye, Math.exp(-q * 3.2));
        }
      }
      const t = (y / H) * rings + g2[p] * wave + g1[p] * 1.2 + bulge;
      const s = Math.abs(Math.sin(t * Math.PI));
      const line = s ** 10;
      let v = 0.32 + (g1[p] - 0.5) * streak + 0.35 * g3[p] - line * lineDark + (r() - 0.5) * fine - eye * 0.3;
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
  const height = new Float32Array(W * H);
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
      // gaps and butt joints are cut in, each board is slightly cupped and its grain stands out
      let hgt = 0.62 + 0.12 * Math.sin((Math.PI * lv) / bw) + ((gd[gi] + gd[gi + 1] + gd[gi + 2]) / 765) * 0.26;
      if (lv < 2.2 || (nearJ < 1.2 && B.js.length)) hgt = 0;
      else if (lv < 4 || lv > bw - 2) hgt *= 0.7;
      height[p] = hgt;
    }
  return { img, boards, bw, vertical, n, height };
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

/** height field from an image's luminance (dark = cut in): cracks, chips, pits and scratches for free */
function lumHeight(img, gain = 1) {
  const { w, h, d } = img;
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = clamp(((d[i] + d[i + 1] + d[i + 2]) / 765) * gain);
  return out;
}

/** the canvas as raw pixels with a wear field (0..1) written to its alpha - never premultiplied */
function withField(c, field) {
  const img = canvasToImg(c);
  for (let p = 0; p < field.length; p++) img.d[p * 4 + 3] = clamp(field[p]) * 255;
  return img;
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
  drawCracks(ctx, W, W, r, 5, { len: [30, 120], width: [0.6, 1.2], wander: 0.12, step: 4, col: 'rgba(25,20,16,0.6)', along: 0 });
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
  const info = boardsImg({ W, H: W, n: 8, seed: 21, light: [134, 120, 102], dark: [66, 57, 48], tone: 0.14, joints: 1 });
  const c = imgToCanvas(info.img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 40, [18, 14, 10], [0.05, 0.16]);
  nailsOnBoards(ctx, W, W, info, r);
  drawCracks(ctx, W, W, r, 10, { len: [20, 90], wander: 0.1, step: 4, width: [0.6, 1.1], col: 'rgba(20,16,12,0.55)', along: 0 });
  return { canvas: c, height: info.height, relief: 0.012 };
};

// barn boards, bare: grey weathered wood, nails and their rust runs. A = how well paint holds - it wears
// through along the grain and lets go first at the board edges. The red is laid on in the shader.
GEN.barn = () => {
  const W = 512;
  const r = rngf(31);
  const info = boardsImg({ W, H: W, n: 10, seed: 31, vertical: true, light: [128, 120, 110], dark: [66, 60, 54], tone: 0.1, joints: 1 });
  const streak = fbm(W, W, 30, 3, 4, 32, 0.6);
  const fine = fbm(W, W, 48, 16, 3, 35, 0.6);
  const field = new Float32Array(W * W);
  for (let p = 0; p < field.length; p++) {
    const lv = (p % W) % info.bw;
    field[p] = 1 - (streak[p] * 0.62 + fine[p] * 0.38) - (lv < 6 || lv > info.bw - 5 ? 0.14 : 0);
  }
  const c = imgToCanvas(info.img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 50, [26, 16, 12], [0.05, 0.16], [40, 260], [2, 10]);
  nailsOnBoards(ctx, W, W, info, r, { studs: 2 });
  return { ...withField(c, field), height: info.height, relief: 0.012 };
};

// lap siding, bare: weathered grey boards with the shadow of each lap, butt joints and nail heads. A = how
// well paint holds: small flakes, and water sits on the lower edge of every board, where it lets go first.
// The paint, in each building's own colour, is laid on in the shader.
GEN.clapboard = () => {
  const W = 512, n = 16, bh = W / n;
  const r = rngf(41);
  const grain = woodGrainImg(W, W, 41, [150, 144, 132], [104, 98, 90], { rings: 40, streak: 0.5, wave: 1, knots: 2, lineDark: 0.2 });
  const fine = fbm(W, W, 40, 20, 4, 42, 0.6);
  const flake = fbm(W, W, 16, 12, 4, 46, 0.55);
  const vs = fbm(W, W, 36, 2, 4, 44);
  const tone = [], off = [];
  for (let b = 0; b < n; b++) {
    tone.push(0.92 + r() * 0.14);
    off.push(Math.floor(r() * W));
  }
  const img = newImg(W, W);
  const field = new Float32Array(W * W), height = new Float32Array(W * W);
  const d = img.d, gd = grain.d;
  for (let y = 0, i = 0, p = 0; y < W; y++) {
    const b = Math.floor(y / bh), lv = y % bh;
    // the board above casts a shadow on the top of this one; its own butt edge is in shade
    let shade = lv < 1.5 ? 0.34 : lv < 6 ? lerp(0.6, 0.96, (lv - 1.5) / 4.5) : 1;
    if (lv >= bh - 1.5) shade = 0.76;
    const edgeBias = sstep(bh * 0.5, bh - 1, lv) * 0.2 + (lv < 5 ? 0.06 : 0);
    for (let x = 0; x < W; x++, i += 4, p++) {
      const gi = (y * W + ((x + off[b]) % W)) * 4;
      const g = (0.86 + 0.14 * vs[p]) * shade * tone[b];
      d[i] = gd[gi] * g;
      d[i + 1] = gd[gi + 1] * g;
      d[i + 2] = gd[gi + 2] * g;
      d[i + 3] = 255;
      field[p] = 1 - (flake[p] * 0.6 + fine[p] * 0.4) - edgeBias;
      // each board leans out toward its lower edge, then steps back under the next
      height[p] = lv < 1.5 ? 0 : 0.12 + (lv / bh) * 0.8 + (gd[gi] / 255 - 0.5) * 0.12;
    }
  }
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 40, [50, 44, 34], [0.04, 0.12], [40, 260], [2, 10]);
  // butt joints and nail heads (with the odd rust run)
  for (let b = 0; b < n; b++) {
    const x = r() * W;
    ctx.fillStyle = 'rgba(30,26,22,0.7)';
    wrapDraw(W, W, x, b * bh + bh / 2, 4, (px) => ctx.fillRect(px, b * bh + 1.5, 1.4, bh - 2));
    for (let s = 0; s < 5; s++) {
      const nx = ((s + 0.5) / 5) * W + (r() - 0.5) * 8, ny = b * bh + bh - 6;
      if (r() < 0.3) {
        const gg = ctx.createLinearGradient(0, ny, 0, ny + 26);
        gg.addColorStop(0, 'rgba(96,52,24,0.4)');
        gg.addColorStop(1, 'rgba(96,52,24,0)');
        ctx.fillStyle = gg;
        ctx.fillRect(nx - 1.2, ny, 2.4, 26);
      }
      ctx.fillStyle = 'rgba(40,34,28,0.85)';
      ctx.fillRect(nx - 1, ny - 1, 2, 2);
    }
  }
  return { ...withField(c, field), height, relief: 0.014 };
};

GEN.logwall = () => {
  const W = 512, n = 8, bh = W / n;
  const r = rngf(51);
  const grain = woodGrainImg(W, W, 51, [116, 90, 64], [52, 38, 27], { rings: 30, streak: 0.8, wave: 1.4, knots: 5 });
  const ch = fbm(W, W, 16, 8, 4, 52);
  const dirt = fbm(W, W, 5, 5, 4, 53);
  const img = newImg(W, W);
  const height = new Float32Array(W * W);
  const d = img.d, gd = grain.d;
  const off = [];
  for (let b = 0; b < n; b++) off.push(Math.floor(r() * W));
  for (let y = 0, i = 0, p = 0; y < W; y++) {
    const b = Math.floor(y / bh), lv = y - b * bh;
    for (let x = 0; x < W; x++, i += 4, p++) {
      const wob = (ch[p] - 0.5) * 7;
      const chinkH = 9 + wob;
      if (lv < chinkH * 0.5 || lv > bh - chinkH * 0.5) {
        // mortar chinking, set back between the logs: dirty, and dark under the log above
        const v = (84 + ch[p] * 36 - 30 * dirt[p]) * (lv < bh / 2 ? 0.62 : 1);
        d[i] = v;
        d[i + 1] = v * 0.94;
        d[i + 2] = v * 0.84;
        height[p] = 0.1 + ch[p] * 0.08;
      } else {
        const t = (lv - chinkH * 0.5) / (bh - chinkH);
        const s = Math.pow(Math.sin(Math.PI * t), 0.55);
        const gi = (((y + off[b]) % W) * W + ((x + off[b] * 3) % W)) * 4;
        const k = (0.56 + 0.52 * s * (1 - 0.2 * t)) * (0.8 + 0.3 * dirt[p]);
        d[i] = gd[gi] * k;
        d[i + 1] = gd[gi + 1] * k;
        d[i + 2] = gd[gi + 2] * k;
        height[p] = 0.2 + s * 0.74 + (gd[gi] / 255 - 0.3) * 0.12;
      }
      d[i + 3] = 255;
    }
  }
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  // checks (cracks along logs)
  drawCracks(ctx, W, W, r, 22, { len: [30, 140], wander: 0.08, step: 5, width: [0.8, 1.6], col: 'rgba(22,16,12,0.7)', branch: 0, along: 0 });
  drips(ctx, W, W, r, 30, [20, 15, 10], [0.05, 0.14]);
  return { canvas: c, height, relief: 0.05 };
};

GEN.concrete = () => {
  const W = 512;
  const r = rngf(61);
  const a = fbm(W, W, 6, 6, 6, 61, 0.55), b = fbm(W, W, 16, 16, 3, 62);
  const st = fbm(W, W, 26, 2, 4, 63), agg = fbm(W, W, 96, 96, 2, 66);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    // cement with a fine aggregate grain and a little run-off streaking
    let v = 0.46 + (a[p] - 0.5) * 0.3 + (b[p] - 0.5) * 0.14 + (agg[p] - 0.5) * 0.16 + (r() - 0.5) * 0.06;
    v *= 0.9 + 0.12 * st[p];
    d[i] = lerp(48, 132, v);
    d[i + 1] = lerp(47, 129, v);
    d[i + 2] = lerp(44, 121, v);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  blotches(ctx, W, W, r, 14, [30, 28, 24], [0.05, 0.13], [16, 50]);
  drips(ctx, W, W, r, 24, [24, 24, 20], [0.04, 0.12], [60, 260], [4, 16]);
  // bug holes left by air against the formwork
  for (let k = 0; k < 220; k++) {
    const x = r() * W, y = r() * W, R = 0.6 + r() * 1.5;
    ctx.fillStyle = `rgba(26,26,24,${0.2 + r() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, 7);
    ctx.fill();
  }
  drawCracks(ctx, W, W, r, 3, { len: [50, 150], width: [0.5, 1], col: 'rgba(22,21,20,0.42)', light: 'rgba(150,146,138,0.12)', branch: 0.5, wander: 0.5, step: 6 });
  // a control joint along each edge of the 3 m pour
  for (const [x, y, w, h] of [[0, 0, W, 2], [0, 0, 2, W]]) {
    ctx.fillStyle = 'rgba(20,20,18,0.6)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(160,156,148,0.14)';
    ctx.fillRect(x + (w < h ? 2 : 0), y + (w < h ? 0 : 2), w < h ? 1.5 : w, w < h ? h : 1.5);
  }
  return { canvas: c, height: lumHeight(canvasToImg(c), 2), relief: 0.006 };
};

// running bond, 2 m: 28 courses of 9 bricks. Red-brown stock with dark clinkers, pale salmon ones and the odd
// spalled face; recessed mortar in the shadow of the brick above; salt runs from a few joints.
GEN.brick = () => {
  const W = 1024, rows = 28, rh = W / rows, cols = 9, cw = W / cols, mort = 5;
  const r = rngf(71);
  const tex = fbm(W, W, 48, 48, 3, 72);
  const body = fbm(W, W, 18, 36, 3, 76);
  const chip = fbm(W, W, 64, 64, 3, 74);
  const bc = [];
  for (let k = 0; k < rows * cols; k++) {
    const t = r();
    const base = t < 0.06 ? [86, 54, 46] : t < 0.14 ? [136, 92, 72] : t < 0.18 ? [104, 82, 72] : [lerp(108, 124, r()), lerp(62, 70, r()), lerp(50, 57, r())];
    bc.push({ c: base, spall: r() < 0.05, sx: r(), sy: r(), k: 0.94 + r() * 0.12 });
  }
  const img = newImg(W, W);
  const height = new Float32Array(W * W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const row = Math.floor(y / rh), ly = y - row * rh;
    const xo = (x + (row % 2) * (cw / 2)) % W;
    const col = Math.floor(xo / cw), lx = xo - col * cw;
    const e = Math.min(lx, cw - lx, ly, rh - ly) - (chip[p] - 0.5) * 4;
    const face = sstep(mort * 0.5 - 0.8, mort * 0.5 + 1.2, e);
    // mortar: sandy grey, darker under the brick above
    let v = 122 + tex[p] * 30 + (r() - 0.5) * 10;
    if (ly < mort * 0.5 + 1.5) v *= 0.7;
    let R = v, G = v * 0.97, B = v * 0.9, h = 0.22 + tex[p] * 0.1;
    if (face > 0) {
      const b = bc[row * cols + col];
      let k = b.k * (0.8 + tex[p] * 0.24 + body[p] * 0.16) + (r() - 0.5) * 0.07;
      // the top arris catches the light, the bottom one is in shadow
      if (e < mort * 0.5 + 3) k *= ly < rh / 2 ? 1.1 : 0.84;
      let fr = b.c[0] * k, fg = b.c[1] * k, fb = b.c[2] * k, fh = 0.86 + tex[p] * 0.14;
      if (b.spall) {
        // the fired face has flaked off: a paler, rougher core
        const sp = sstep(0.34, 0.26, Math.hypot(lx / cw - 0.2 - b.sx * 0.6, (ly / rh - 0.2 - b.sy * 0.6) * 0.5) + (chip[p] - 0.5) * 0.2);
        fr = lerp(fr, 150 * (0.8 + tex[p] * 0.3), sp * 0.8);
        fg = lerp(fg, 106 * (0.8 + tex[p] * 0.3), sp * 0.8);
        fb = lerp(fb, 84 * (0.8 + tex[p] * 0.3), sp * 0.8);
        fh -= sp * 0.3;
      }
      R = lerp(R, fr, face);
      G = lerp(G, fg, face);
      B = lerp(B, fb, face);
      h = lerp(h, fh, face);
    }
    d[i] = R;
    d[i + 1] = G;
    d[i + 2] = B;
    d[i + 3] = 255;
    height[p] = h;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 26, [30, 22, 18], [0.04, 0.12], [80, 400], [6, 24]);
  return { canvas: c, height, relief: 0.012 };
};

// weathered white-painted wood for window casings and sashes
GEN.sash = () => {
  const W = 256;
  const r = rngf(151);
  const img = woodGrainImg(W, W, 151, [184, 180, 170], [148, 142, 132], { rings: 12, streak: 0.4, lineDark: 0.14 });
  const worn = fbm(W, W, 24, 12, 3, 152);
  eachPx(img, (x, y, i, d) => {
    const t = sstep(0.76, 0.8, worn[i >> 2]);
    d[i] = lerp(d[i], 118, t);
    d[i + 1] = lerp(d[i + 1], 110, t);
    d[i + 2] = lerp(d[i + 2], 98, t);
  });
  const c = imgToCanvas(img);
  drips(ctx2d(c), W, W, r, 12, [60, 54, 44], [0.06, 0.16], [20, 120], [2, 8]);
  return { canvas: c };
};

// asphalt shingles, 2 m: 12 courses of three-tab strips, granules worn thin in places. A = where moss takes
// hold (the slots between tabs and the damp lower edge of each course); the moss is laid on in the shader.
GEN.shingles = () => {
  const W = 512, rows = 12, rh = W / rows, tabs = 6, tw = W / tabs;
  const r = rngf(81);
  const gran = fbm(W, W, 96, 96, 2, 82);
  const worn = fbm(W, W, 12, 12, 4, 84);
  const mo = fbm(W, W, 10, 10, 4, 83);
  const tc = [];
  for (let k = 0; k < rows * tabs; k++) {
    const v = lerp(0.8, 1.16, r());
    tc.push({ c: [60 * v, 56 * v, 53 * v + r() * 6], curl: r() < 0.1 ? 1 : 0, off: (r() - 0.5) * 2 });
  }
  const img = newImg(W, W);
  const field = new Float32Array(W * W), height = new Float32Array(W * W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const row = Math.floor(y / rh), ly = y - row * rh;
    const xo = (x + (row % 2) * (tw / 2)) % W;
    const col = Math.floor(xo / tw), lx = xo - col * tw;
    const T = tc[row * tabs + col];
    let k = 0.8 + gran[p] * 0.42 + (r() - 0.5) * 0.2;
    // granules gone: the darker mat shows through
    k *= 1 - sstep(0.62, 0.8, worn[p]) * 0.28;
    // shadow under the course above, a lighter lifted lower edge, dark slots between the tabs
    if (ly < 6) k *= lerp(0.38, 1, ly / 6);
    if (ly > rh - 2.5) k *= 1.16 + T.curl * 0.2;
    const slot = lx < 1.8 || lx > tw - 0.8;
    if (slot) k *= 0.42;
    d[i] = T.c[0] * k;
    d[i + 1] = T.c[1] * k;
    d[i + 2] = T.c[2] * k;
    d[i + 3] = 255;
    field[p] = mo[p] * 0.8 + (slot ? 0.3 : 0) + sstep(rh - 9, rh, ly) * 0.16 + (ly < 6 ? 0.16 : 0);
    height[p] = slot || ly < 1.5 ? 0 : 0.2 + (ly / rh) * (0.55 + T.curl * 0.25) + gran[p] * 0.2;
  });
  return { ...withField(imgToCanvas(img), field), height, relief: 0.008 };
};

// corrugated galvanised sheet, 2 m, clean: mottled zinc spangle, an overlap every metre and two rows of
// fasteners. A = where rust starts: in the valleys, along the laps and in the run below each fastener. The
// rust itself is laid on in the shader (SURF.tin / SURF.tin_rust share this tile).
GEN.tin = () => {
  const W = 512, period = 16;
  const r = rngf(91);
  const mot = fbm(W, W, 10, 10, 4, 92);
  const spang = fbm(W, W, 64, 64, 2, 93);
  const vs = fbm(W, W, 40, 3, 4, 94);
  const rustN = fbm(W, W, 14, 10, 4, 95, 0.6);
  const img = newImg(W, W);
  const field = new Float32Array(W * W), height = new Float32Array(W * W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const ph = (x / period) * Math.PI * 2;
    const s = Math.sin(ph);
    const lap = x % 256;
    const g = 120 + mot[p] * 30 + (spang[p] - 0.5) * 18;
    let k = (0.84 + 0.12 * s + 0.07 * Math.max(0, Math.sin(ph - 0.6)) ** 8) * (0.88 + 0.16 * vs[p]);
    if (lap < 2) k *= 0.5;
    else if (lap < 5) k *= 1.1;
    d[i] = g * 0.97 * k;
    d[i + 1] = g * k;
    d[i + 2] = g * 1.01 * k;
    d[i + 3] = 255;
    field[p] = rustN[p] * 0.58 + vs[p] * 0.3 + sstep(0.2, -0.8, s) * 0.12 + (lap < 12 ? 0.14 : 0);
    height[p] = 0.5 + 0.5 * s + (lap < 3 ? 0.2 : 0);
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 26, [34, 32, 30], [0.04, 0.1], [40, 220], [2, 7]);
  drips(ctx, W, W, r, 16, [206, 208, 204], [0.04, 0.1], [30, 160], [2, 6]);
  for (const yy of [18, 274]) {
    for (let x = period / 2; x < W; x += period * 2) {
      const fx = x + period / 4;
      ctx.fillStyle = 'rgba(70,68,66,0.9)';
      ctx.beginPath();
      ctx.arc(fx, yy, 3, 0, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(30,28,26,0.95)';
      ctx.beginPath();
      ctx.arc(fx, yy, 1.7, 0, 7);
      ctx.fill();
      // water runs down from every screw hole
      const L = 30 + r() * 170;
      for (let dy = 0; dy < L; dy++) {
        const row = ((yy + dy) % W) * W, a = 0.5 * (1 - dy / L);
        for (let dx = -2; dx <= 2; dx++) field[row + Math.round(fx) + dx] += a * (1 - Math.abs(dx) / 3);
      }
    }
  }
  return { ...withField(c, field), height, relief: 0.018 };
};

// steel rusted through: dark scale with orange bloom in patches, pitted, flaking along faint plates
GEN.rust = () => {
  const W = 512;
  const r = rngf(101);
  const a = fbm(W, W, 8, 8, 6, 101, 0.6), b = fbm(W, W, 28, 28, 4, 102, 0.6), c2 = fbm(W, W, 72, 72, 3, 104);
  const vs = fbm(W, W, 30, 3, 3, 105);
  const wo = worley(W, W, 18, 18, 103);
  const rr = colorRamp([[0, 30, 21, 17], [0.3, 58, 37, 25], [0.55, 88, 56, 32], [0.78, 114, 76, 42], [1, 134, 98, 60]]);
  const tmp = [0, 0, 0];
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const edge = sstep(0.0, 0.1, wo.f2[p] - wo.f1[p]);
    const t = a[p] * 0.5 + b[p] * 0.3 + c2[p] * 0.2 + (vs[p] - 0.5) * 0.16 + (r() - 0.5) * 0.1 - (1 - edge) * 0.09;
    rr(t, tmp);
    d[i] = tmp[0];
    d[i + 1] = tmp[1];
    d[i + 2] = tmp[2];
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  for (let k = 0; k < 700; k++) {
    ctx.fillStyle = `rgba(20,12,8,${0.25 + r() * 0.45})`;
    ctx.beginPath();
    ctx.arc(r() * W, r() * W, 0.5 + r() * 1.7, 0, 7);
    ctx.fill();
  }
  drips(ctx, W, W, r, 22, [24, 14, 10], [0.06, 0.16], [30, 180], [2, 8]);
  return { canvas: c, height: lumHeight(canvasToImg(c), 2.2), relief: 0.005 };
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

// bare dark steel: mill scale, scratches down to bright metal and a few dings. A = where rust takes first.
GEN.metal = () => {
  const W = 512;
  const r = rngf(111);
  const a = fbm(W, W, 8, 8, 5, 111), vs = fbm(W, W, 30, 2, 4, 112), rs = fbm(W, W, 18, 18, 4, 113, 0.6);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = (0.78 + a[p] * 0.36) * (0.84 + 0.22 * vs[p]) + (r() - 0.5) * 0.05;
    d[i] = 64 * k;
    d[i + 1] = 72 * k;
    d[i + 2] = 74 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  scratches(ctx, W, W, r, 260, 'rgba(150,152,150,0.35)');
  scratches(ctx, W, W, r, 80, 'rgba(20,20,20,0.35)');
  chips(ctx, W, W, r, 50, 'rgba(26,26,26,0.7)', [1, 4]);
  drips(ctx, W, W, r, 24, [20, 20, 18], [0.06, 0.16], [30, 160], [2, 7]);
  const field = new Float32Array(W * W);
  for (let p = 0; p < field.length; p++) field[p] = rs[p] * 0.7 + vs[p] * 0.3;
  return { ...withField(c, field), height: lumHeight(canvasToImg(c), 2.4), relief: 0.003 };
};

// coursed rubble, 2 m: rough-faced blocks of uneven size in recessed mortar. A = where moss takes hold
// (the joints and the block edges first); the moss is laid on in the shader.
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
    rows.push({ y0: yy, h: hgt, cuts, off, cols: cuts.map(() => [lerp(88, 128, r()), 0, 0, r(), r() - 0.5, r() - 0.5]) });
    yy += hgt;
  }
  for (const row of rows)
    for (const c of row.cols) {
      const warm = c[3];
      c[1] = c[0] * (0.95 + warm * 0.03);
      c[2] = c[0] * (0.86 + (1 - warm) * 0.08);
      c[0] *= 1 + warm * 0.06;
    }
  const tex = fbm(W, W, 12, 12, 4, 122), fine = fbm(W, W, 48, 48, 3, 123), mo = fbm(W, W, 9, 9, 5, 124);
  const img = newImg(W, W);
  const field = new Float32Array(W * W), height = new Float32Array(W * W);
  let ri = 0;
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    if (y < rows[ri].y0) ri = 0;
    while (y >= rows[ri].y0 + rows[ri].h) ri++;
    const row = rows[ri];
    const ly = y - row.y0;
    const xo = (x + row.off) % W;
    let s = 0;
    while (s < row.cuts.length - 1 && xo >= row.cuts[s + 1]) s++;
    const x0 = row.cuts[s], x1 = s < row.cuts.length - 1 ? row.cuts[s + 1] : W;
    const e = Math.min(xo - x0, x1 - xo, ly, row.h - ly) + (tex[p] - 0.5) * 7;
    const c0 = row.cols[s];
    // each block's face is split a little out of true: one side stands prouder than the other
    const tilt = ((xo - x0) / (x1 - x0) - 0.5) * c0[4] + (ly / row.h - 0.5) * c0[5];
    let R, G, B;
    if (e < 3) {
      const v = 52 + tex[p] * 20;
      R = v;
      G = v * 0.96;
      B = v * 0.88;
      height[p] = 0.12 + fine[p] * 0.1;
    } else {
      const k = (0.74 + tex[p] * 0.4 + (fine[p] - 0.5) * 0.2) * (e < 7 ? 0.82 : 1) * (1 + tilt * 0.2) + (r() - 0.5) * 0.06;
      R = c0[0] * k;
      G = c0[1] * k;
      B = c0[2] * k;
      height[p] = clamp(0.3 + sstep(3, 12, e) * 0.34 + tex[p] * 0.22 + (fine[p] - 0.5) * 0.12 + tilt * 0.3);
    }
    d[i] = R;
    d[i + 1] = G;
    d[i + 2] = B;
    d[i + 3] = 255;
    field[p] = mo[p] * 0.84 + (e < 3 ? 0.22 : e < 8 ? 0.1 : 0);
  });
  const c = imgToCanvas(img);
  drips(ctx2d(c), W, W, r, 30, [15, 14, 12], [0.06, 0.18], [40, 200], [4, 14]);
  return { ...withField(c, field), height, relief: 0.035 };
};

GEN.dockwood = () => {
  const W = 512;
  const r = rngf(131);
  const info = boardsImg({ W, H: W, n: 8, seed: 131, light: [88, 70, 52], dark: [38, 30, 24], tone: 0.2, grime: 0.5, warm: 4 });
  const alg = fbm(W, W, 8, 8, 5, 132);
  eachPx(info.img, (x, y, i, d) => {
    const lv = y % info.bw;
    const nearEdge = lv < 8 || lv > info.bw - 8 ? 0.35 : 0;
    const t = clamp(sstep(0.6, 0.85, alg[i >> 2]) * 0.5 + nearEdge * alg[i >> 2]);
    d[i] = lerp(d[i], 36, t);
    d[i + 1] = lerp(d[i + 1], 44, t);
    d[i + 2] = lerp(d[i + 2], 26, t);
  });
  const c = imgToCanvas(info.img);
  const ctx = ctx2d(c);
  nailsOnBoards(ctx, W, W, info, r, { studs: 3, rust: 0.8 });
  drawCracks(ctx, W, W, r, 14, { len: [30, 140], wander: 0.08, step: 5, width: [0.8, 1.5], col: 'rgba(12,10,8,0.7)', branch: 0, along: 0 });
  return { canvas: c, height: info.height, relief: 0.014 };
};

// window glass, 2 m: a dark room behind dusty panes - rain-streaked dirt, one starred impact and a couple
// of long cracks in the whole tile (the static world shifts every pane to a different part of it).
GEN.glass = () => {
  const W = 512;
  const r = rngf(141);
  const a = fbm(W, W, 5, 5, 5, 141), b = fbm(W, W, 14, 14, 3, 142), vs = fbm(W, W, 30, 3, 4, 143);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const grime = sstep(0.42, 0.88, a[p] * 0.65 + vs[p] * 0.35);
    d[i] = lerp(15, 60 + b[p] * 22, grime * 0.7);
    d[i + 1] = lerp(19, 58 + b[p] * 20, grime * 0.7);
    d[i + 2] = lerp(22, 48 + b[p] * 16, grime * 0.7);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  drips(ctx, W, W, r, 34, [74, 68, 54], [0.05, 0.16], [30, 180], [2, 9]);
  // starred impact
  const cx = 150, cy = 330;
  ctx.strokeStyle = 'rgba(170,180,182,0.5)';
  ctx.lineWidth = 0.8;
  const rays = 11;
  const pts = [];
  for (let k = 0; k < rays; k++) {
    let ang = (k / rays) * Math.PI * 2 + r() * 0.4, x = cx, y = cy;
    const ray = [[x, y]];
    const L = 30 + r() * 80;
    for (let s = 0; s < L; s += 7) {
      ang += (r() - 0.5) * 0.25;
      x += Math.cos(ang) * 7;
      y += Math.sin(ang) * 7;
      ray.push([x, y]);
    }
    pts.push(ray);
    ctx.beginPath();
    ray.forEach(([px, py], j) => (j ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  }
  for (const ringIdx of [2, 4]) {
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
  ctx.arc(cx, cy, 2.5, 0, 7);
  ctx.fill();
  drawCracks(ctx, W, W, r, 3, { len: [120, 300], width: [0.6, 1], col: 'rgba(170,180,182,0.42)', branch: 0.4, wander: 0.22, step: 7 });
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

// military drab paint: chalky and scuffed. A = where rust breaks through (the rust is laid on in the shader).
GEN.olive = () => {
  const W = 512;
  const r = rngf(181);
  const a = fbm(W, W, 8, 8, 5, 181), vs = fbm(W, W, 30, 2, 4, 182), b = fbm(W, W, 18, 18, 3, 183), rs = fbm(W, W, 14, 14, 4, 184, 0.6);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = (0.8 + a[p] * 0.28 + (b[p] - 0.5) * 0.1) * (0.86 + 0.2 * vs[p]) + (r() - 0.5) * 0.04;
    d[i] = 72 * k;
    d[i + 1] = 78 * k;
    d[i + 2] = 50 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  chips(ctx, W, W, r, 110, 'rgba(46,48,40,0.9)', [0.8, 4]);
  scratches(ctx, W, W, r, 120, 'rgba(120,122,100,0.3)');
  drips(ctx, W, W, r, 30, [25, 25, 16], [0.08, 0.2], [40, 180], [3, 10]);
  const field = new Float32Array(W * W);
  for (let p = 0; p < field.length; p++) field[p] = rs[p] * 0.75 + vs[p] * 0.25;
  return withField(c, field);
};

// ---------------------------------------------------------------- props
// Painted sheet metal, clean. RGB: light neutral paint (tinted by vertex colour) - faintly mottled, scuffed,
// dulled in patches where the gloss has gone. A = where rust breaks through: broad weak spots plus the stone
// chips and scratches that always go first. The rust itself is laid on in the shader (SURF.paint / carpaint),
// by world-space noise, so no two cars corrode alike.
function paintedImg(W, seed, { streaks = 0.5, chipsN = 120, scuffs = 160 } = {}) {
  const r = rngf(seed);
  const a = fbm(W, W, 6, 6, 5, seed, 0.55), dull = fbm(W, W, 12, 12, 4, seed + 2), vs = fbm(W, W, 26, 2, 4, seed + 1);
  const rs = fbm(W, W, 10, 10, 5, seed + 3, 0.6), fine = fbm(W, W, 40, 40, 3, seed + 4);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    // gloss gone in patches: flatter and a touch paler
    const flat = sstep(0.5, 0.75, dull[p]);
    const k = (0.9 + a[p] * 0.14) * (1 - streaks * 0.16 + streaks * 0.2 * vs[p]) * (1 + flat * 0.05) + (fine[p] - 0.5) * 0.05;
    d[i] = 216 * k;
    d[i + 1] = 214 * k;
    d[i + 2] = lerp(208, 198, flat) * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  scratches(ctx, W, W, r, scuffs, 'rgba(250,250,246,0.16)', [6, 40]);
  scratches(ctx, W, W, r, scuffs / 2, 'rgba(40,38,34,0.2)', [4, 26]);
  blotches(ctx, W, W, r, 26, [60, 54, 44], [0.04, 0.1], [10, 46]);
  // chips and deep scratches, as a mask
  const m = mkCanvas(W, W);
  const mx = ctx2d(m);
  mx.fillStyle = '#000';
  mx.fillRect(0, 0, W, W);
  chips(mx, W, W, r, chipsN, '#fff', [0.8, 3.6]);
  scratches(mx, W, W, r, chipsN / 4, '#fff', [6, 30]);
  const cm = canvasToImg(m).d;
  const field = new Float32Array(W * W);
  for (let p = 0; p < field.length; p++) field[p] = Math.max(rs[p] * 0.72 + fine[p] * 0.28, (cm[p * 4] / 255) * 1.1);
  return withField(c, field);
}
GEN.paint = () => paintedImg(512, 191, { streaks: 0.7, chipsN: 150 });
// brightwork: bumpers, handles, rims. Pitted where the plating has failed; A = where rust takes first.
GEN.chrome = () => {
  const W = 256;
  const r = rngf(205);
  const a = fbm(W, W, 5, 5, 5, 205), pit = fbm(W, W, 40, 40, 3, 206), rs = fbm(W, W, 12, 12, 4, 207, 0.6);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const k = (0.84 + a[p] * 0.2) * (1 - sstep(0.62, 0.8, pit[p]) * 0.3) + (r() - 0.5) * 0.03;
    d[i] = 150 * k;
    d[i + 1] = 153 * k;
    d[i + 2] = 156 * k;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  scratches(ctx, W, W, r, 120, 'rgba(236,238,240,0.3)', [4, 30]);
  scratches(ctx, W, W, r, 50, 'rgba(30,30,32,0.3)', [4, 20]);
  const field = new Float32Array(W * W);
  for (let p = 0; p < field.length; p++) field[p] = rs[p] * 0.6 + pit[p] * 0.4;
  return withField(c, field);
};
// aircraft skin (4 m): light neutral paint - tinted by vertex colour - with riveted panel seams, a slightly
// different tone per panel and faint streaks of weathering. Tileable (seams wrap).
GEN.aircraft = () => {
  const W = 512;
  const r = rngf(733);
  const a = fbm(W, W, 4, 4, 5, 733), st = fbm(W, W, 36, 3, 4, 734);
  const ROWS = 4;
  const rh = W / ROWS;
  const cuts = [];
  for (let k = 0; k < ROWS; k++) {
    const row = [];
    let x = Math.floor(r() * 120);
    while (x < W) {
      row.push(x);
      x += 96 + Math.floor(r() * 110);
    }
    cuts.push(row);
  }
  const tone = [];
  for (let k = 0; k < ROWS * 16; k++) tone.push(0.955 + r() * 0.09);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const row = Math.floor(y / rh);
    const cs = cuts[row];
    let col = 0;
    let dc = W;
    for (let c = 0; c < cs.length; c++) {
      if (cs[c] <= x) col = c + 1;
      const dd = Math.abs(x - cs[c]);
      dc = Math.min(dc, dd, W - dd);
    }
    const dr = Math.min(y % rh, rh - (y % rh));
    let k = (0.88 + 0.16 * a[p]) * (0.93 + 0.1 * st[p]) * tone[row * 16 + (col % cs.length)];
    if (dr < 1.5 || dc < 1.5) k *= 0.8; // seam
    else if ((dr > 4 && dr < 6 && x % 9 < 2) || (dc > 4 && dc < 6 && y % 9 < 2)) k *= 0.92; // rivet rows
    d[i] = 214 * k;
    d[i + 1] = 212 * k;
    d[i + 2] = 207 * k;
    d[i + 3] = 255;
  });
  return img;
};
GEN.carpaint = () => paintedImg(512, 201, { streaks: 0.15, chipsN: 110, scuffs: 220 });

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

// compacted dirt road surface. Isotropic on purpose: ruts, the grassy crown and the verge are drawn by the
// terrain shader along the road itself, so this tiles in any direction.
GEN.ground_road = () => {
  const W = 512;
  const r = rngf(531);
  const a = fbm(W, W, 4, 4, 6, 531, 0.55), b = fbm(W, W, 12, 12, 4, 532), gr = fbm(W, W, 64, 64, 2, 533);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    // packed fines with a sandy grain, darker damp patches and paler dry, dusty ones
    let k = 0.84 + (a[p] - 0.5) * 0.3 + (b[p] - 0.5) * 0.16 + (gr[p] - 0.5) * 0.3 + (r() - 0.5) * 0.16;
    const dry = sstep(0.55, 0.8, a[p]) * 0.14;
    const damp = sstep(0.62, 0.85, 1 - b[p]) * 0.12;
    k *= 1 - damp;
    d[i] = lerp(96, 112, dry) * k;
    d[i + 1] = lerp(82, 100, dry) * k;
    d[i + 2] = lerp(64, 82, dry) * k * (1 + damp * 0.1);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  // gravel pressed into the surface (each stone casts a small shadow): mostly the dirt's own tones, a
  // share of paler grey stones, never white
  pebbles(ctx, W, W, r, 700, [[92, 82, 68], [78, 68, 56], [104, 94, 80], [66, 58, 48]], [0.7, 1.8]);
  pebbles(ctx, W, W, r, 260, [[124, 116, 104], [110, 106, 98], [132, 122, 106]], [0.8, 2.2]);
  pebbles(ctx, W, W, r, 40, [[112, 104, 94], [96, 90, 82]], [2.2, 3.6]);
  // clods and small ruts of loose dirt
  blotches(ctx, W, W, r, 60, [58, 46, 34], [0.12, 0.28], [3, 9]);
  strokesWrapped(ctx, W, W, r, 90, [[58, 46, 34], [70, 58, 42]], [8, 24], 1.2, null, 0.5);
  drawCracks(ctx, W, W, r, 6, { len: [30, 110], width: [0.6, 1.1], col: 'rgba(40,30,22,0.5)', step: 4 });
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

// wet soil: dark, glossy where it is wettest, a few smooth-edged puddles, clods, tracks and straw
GEN.ground_mud = () => {
  const W = 512;
  const r = rngf(551);
  const a = fbm(W, W, 6, 6, 5, 551, 0.55), b = fbm(W, W, 40, 40, 3, 552), w2 = fbm(W, W, 5, 5, 5, 553), cl = fbm(W, W, 20, 20, 3, 554);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const wet = sstep(0.45, 0.8, w2[p]);
    let k = 0.86 + (a[p] - 0.5) * 0.3 + (b[p] - 0.5) * 0.18 + (r() - 0.5) * 0.05;
    // clumpy texture where it is drier
    k += (cl[p] - 0.5) * 0.24 * (1 - wet);
    k *= 1 - wet * 0.22;
    let R = 60 * k, G = 47 * k, B = 34 * k;
    // puddles: rare, smooth rims, a dull grey sheen of sky
    const pud = sstep(0.8, 0.84, w2[p] + (a[p] - 0.5) * 0.06);
    R = lerp(R, 33, pud);
    G = lerp(G, 31, pud);
    B = lerp(B, 29, pud);
    const rim = sstep(0.76, 0.8, w2[p]) * (1 - pud) * 0.18;
    d[i] = R * (1 - rim);
    d[i + 1] = G * (1 - rim);
    d[i + 2] = B * (1 - rim);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  pebbles(ctx, W, W, r, 160, [[72, 58, 44], [58, 46, 34], [80, 68, 54]], [1, 3.2]);
  strokesWrapped(ctx, W, W, r, 110, [[96, 84, 52], [80, 68, 44]], [8, 20], 1.1, null, 0.55);
  strokesWrapped(ctx, W, W, r, 80, [[30, 22, 16], [40, 30, 22]], [6, 16], 1.4, null, 0.5);
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

// independent tileable noise fields in R / G / B (linear data, sampled by the terrain at several scales)
GEN.ground_noise = () => {
  const W = 256;
  const f = [fbm(W, W, 4, 4, 5, 571, 0.5), fbm(W, W, 4, 4, 5, 572, 0.5), fbm(W, W, 5, 5, 5, 573, 0.5)];
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    d[i] = f[0][p] * 255;
    d[i + 1] = f[1][p] * 255;
    d[i + 2] = f[2][p] * 255;
    d[i + 3] = 255;
  });
  return { ...img, linear: true };
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

// ================================================================== the city (citykit.js)
// Walls and ceilings of a room that was lived in: plaster under paint or paper, 2 m to the tile. Pale and neutral
// (the kit tints it per room by vertex colour): hairline cracks, flakes off down to the render and the lath, damp
// tide marks.
GEN.plaster = () => {
  const W = 512;
  const r = rngf(1301);
  const a = fbm(W, W, 5, 5, 5, 1301), b = fbm(W, W, 22, 22, 3, 1302), fl = fbm(W, W, 9, 9, 4, 1303), fine = fbm(W, W, 90, 90, 2, 1304);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const v = 0.78 + (a[p] - 0.5) * 0.22 + (b[p] - 0.5) * 0.1 + (fine[p] - 0.5) * 0.06;
    // paint flaked off: the grey-brown render under it, lath showing through the worst of it
    const flake = sstep(0.62, 0.66, fl[p] * 0.75 + b[p] * 0.25);
    const lath = flake * sstep(0.74, 0.78, fl[p]) * (y % 14 < 9 ? 1 : 0.2);
    let R = 226 * v, G = 222 * v, B = 208 * v;
    R = lerp(R, 138 + b[p] * 30, flake);
    G = lerp(G, 128 + b[p] * 26, flake);
    B = lerp(B, 112 + b[p] * 22, flake);
    R = lerp(R, 84, lath * 0.8);
    G = lerp(G, 66, lath * 0.8);
    B = lerp(B, 46, lath * 0.8);
    d[i] = R;
    d[i + 1] = G;
    d[i + 2] = B;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  blotches(ctx, W, W, r, 22, [96, 86, 58], [0.08, 0.2], [20, 70]); // damp
  blotches(ctx, W, W, r, 10, [40, 46, 34], [0.08, 0.2], [10, 36]); // mould
  drips(ctx, W, W, r, 30, [70, 58, 38], [0.06, 0.2], [60, 300], [3, 14]);
  drawCracks(ctx, W, W, r, 7, { len: [60, 240], width: [0.5, 1.1], col: 'rgba(40,34,28,0.6)', light: 'rgba(240,236,224,0.2)', branch: 0.6, wander: 0.6, step: 6 });
  return { canvas: c };
};

// Vinyl tile, 0.3 m squares (2.4 m to the repeat): two faded colours laid chequered, lifted and missing tiles down
// to the black adhesive, ground-in dirt along the joints, stains.
GEN.lino = () => {
  const W = 512, n = 8, cs = W / n;
  const r = rngf(1311);
  const a = fbm(W, W, 6, 6, 4, 1311), b = fbm(W, W, 40, 40, 3, 1312);
  const state = [];
  for (let k = 0; k < n * n; k++) state.push({ gone: r() < 0.07, k: 0.9 + r() * 0.2 });
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
    const t = state[cy * n + cx];
    const lx = x - cx * cs, ly = y - cy * cs;
    const e = Math.min(lx, cs - lx, ly, cs - ly);
    const v = ((cx + cy) % 2 ? 0.56 : 0.68) * t.k * (0.84 + a[p] * 0.3) * (0.92 + b[p] * 0.16);
    let R = v * 190, G = v * 186, B = v * 168;
    if (t.gone) {
      const k2 = 0.16 + b[p] * 0.1;
      R = 255 * k2 * 0.8;
      G = 255 * k2 * 0.74;
      B = 255 * k2 * 0.64;
    }
    const joint = 1 - sstep(0.4, 2.2, e);
    d[i] = R * (1 - joint * 0.55);
    d[i + 1] = G * (1 - joint * 0.55);
    d[i + 2] = B * (1 - joint * 0.55);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  blotches(ctx, W, W, r, 26, [38, 32, 24], [0.1, 0.3], [14, 60]);
  blotches(ctx, W, W, r, 6, [60, 18, 12], [0.1, 0.25], [10, 30]);
  drawCracks(ctx, W, W, r, 5, { len: [30, 120], width: [0.6, 1.2], col: 'rgba(20,18,16,0.6)', branch: 0.4, step: 5 });
  return { canvas: c };
};

// Ceiling tiles on a grid, 0.6 m (4.8 m to the repeat): stained, some gone to the dark void above.
GEN.ceiling = () => {
  const W = 512, n = 8, cs = W / n;
  const r = rngf(1321);
  const a = fbm(W, W, 5, 5, 4, 1321), b = fbm(W, W, 60, 60, 2, 1322);
  const gone = [];
  for (let k = 0; k < n * n; k++) gone.push(r() < 0.13);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
    const lx = x - cx * cs, ly = y - cy * cs;
    const e = Math.min(lx, cs - lx, ly, cs - ly);
    const v = 0.74 + (a[p] - 0.5) * 0.24 + (b[p] - 0.5) * 0.1;
    let R = 214 * v, G = 210 * v, B = 196 * v;
    if (gone[cy * n + cx] && e > 3) {
      R = 16 + b[p] * 10;
      G = 15 + b[p] * 9;
      B = 14 + b[p] * 8;
    }
    if (e < 3) {
      R = 122;
      G = 120;
      B = 112;
    }
    d[i] = R;
    d[i + 1] = G;
    d[i + 2] = B;
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  const ctx = ctx2d(c);
  blotches(ctx, W, W, r, 16, [110, 82, 40], [0.12, 0.34], [18, 64]); // water through the roof
  blotches(ctx, W, W, r, 8, [30, 30, 24], [0.1, 0.24], [8, 30]);
  return { canvas: c };
};

// A flat roof, 4 m: felt and tar with its gravel worn off, a seam every metre, ponding stains, moss in the low places.
GEN.roofing = () => {
  const W = 512;
  const r = rngf(1331);
  const a = fbm(W, W, 4, 4, 5, 1331), b = fbm(W, W, 70, 70, 2, 1332), m = fbm(W, W, 7, 7, 4, 1333);
  const img = newImg(W, W);
  eachPx(img, (x, y, i, d) => {
    const p = i >> 2;
    let v = 0.3 + (a[p] - 0.5) * 0.2 + (b[p] - 0.5) * 0.14;
    if (x % 128 < 2) v *= 0.6;
    const moss = sstep(0.7, 0.86, m[p]);
    d[i] = lerp(200 * v, 44 + b[p] * 22, moss * 0.6);
    d[i + 1] = lerp(194 * v, 50 + b[p] * 24, moss * 0.6);
    d[i + 2] = lerp(182 * v, 32 + b[p] * 14, moss * 0.6);
    d[i + 3] = 255;
  });
  const c = imgToCanvas(img);
  blotches(ctx2d(c), W, W, r, 14, [20, 20, 18], [0.1, 0.3], [20, 80]);
  return { canvas: c };
};

// ---------------------------------------------------------------- the city's atlas (2048)
// One sheet for everything that is laid on a wall of Port Calder: the boards over its shops and what was painted on
// its buildings (opaque cells), what was sprayed on them and what has grown up them since (cut out), and what the
// years ran down them (soft: soot over a burnt-out window, rust under a fixing, damp). The cells are packed in rows; CITY_ATLAS[name] = [x, y, w, h] in pixels. citykit.js lays them on with two materials of
// materials.js: 'citysign' (cut out at half alpha) and 'citygrime' (blended).
const CITY_CELLS = [
  // boards over the shops: [name, w, h, text, board colour, lettering colour]
  ['shop_grocery', 400, 100, 'CALDER FOOD MARKET', '#7a2a1e', '#e2d8bc'],
  ['shop_diner', 400, 100, 'HARBOUR DINER', '#2a5a62', '#e6dcc0'],
  ['shop_pharmacy', 400, 100, 'PORT PHARMACY', '#d0c8b0', '#1f6a3a'],
  ['shop_hardware', 400, 100, 'KESSLER HARDWARE', '#34424e', '#e0c060'],
  ['shop_aero', 400, 100, 'CALDER AERO SUPPLY', '#c8c2ae', '#243a6a'],
  ['shop_liquor', 400, 100, 'LIQUOR', '#1c1a18', '#c8402a'],
  ['shop_pawn', 400, 100, 'PAWN & LOAN', '#b89a2a', '#1a1612'],
  ['shop_laundry', 400, 100, 'COIN LAUNDRY', '#8fb0b8', '#f0ece0'],
  ['shop_bakery', 400, 100, 'BAKERY', '#b8a078', '#4a2a1a'],
  ['shop_bar', 400, 100, 'DOCKSIDE BAR', '#3a1e1a', '#d8b060'],
  ['shop_books', 400, 100, 'BOOKS', '#2e4a34', '#e0d8b8'],
  ['shop_hotel', 400, 100, 'HOTEL MERIDIAN', '#4a4038', '#d8c8a0'],
  ['police', 400, 100, 'POLICE', '#1c2a44', '#e8e4d8'],
  ['depot', 400, 100, 'BUS DEPOT', '#c4b890', '#20303a'],
  ['parking', 400, 100, 'PARKING', '#1e3a5a', '#f0ecdc'],
  ['subway', 400, 100, 'HARBOUR ST', '#101010', '#e8e6de'],
  ['hospital', 804, 100, 'CALDER GENERAL HOSPITAL', '#c8c6bc', '#1a3458'],
  ['terminal', 804, 100, 'CALDER FIELD', '#b8b4a4', '#22303c'],
  ['emergency', 400, 100, 'EMERGENCY', '#9a1a14', '#f0ece0'],
  ['gas', 400, 100, 'GAS', '#b02a1c', '#f0e8d0'],
  ['church', 400, 100, "ST. BRENDAN'S", '#2a2622', '#c8b070'],
  ['rialto', 128, 512, 'RIALTO', '#5a1410', '#e8d070'],
  ['marquee', 768, 192],
  ['gasprice', 256, 512],
  ['quarantine', 448, 224],
  ['evac', 448, 224],
  ['billboard_a', 448, 224],
  ['billboard_b', 448, 224],
  ['poster_a', 112, 168],
  ['poster_b', 112, 168],
  ['poster_c', 112, 168],
  ['poster_d', 112, 168],
  ['redcross', 128, 128],
  ['stained_a', 112, 224],
  ['stained_b', 112, 224],
  // cut out
  ['graf_help', 384, 144],
  ['graf_dead', 384, 144],
  ['graf_room', 384, 144],
  ['graf_god', 384, 144],
  ['graf_bridge', 384, 144],
  ['graf_night', 384, 144],
  ['graf_names', 320, 192],
  ['graf_tag', 224, 168],
  ['xcode_a', 168, 168],
  ['xcode_b', 168, 168],
  ['ivy_a', 288, 512],
  ['ivy_b', 288, 512],
  ['ghost', 400, 288],
  // soft
  ['soot_a', 176, 448],
  ['soot_b', 176, 448],
  ['rust_a', 96, 512],
  ['rust_b', 96, 512],
  ['stain_a', 128, 384],
  ['stain_b', 128, 384],
  ['damp_a', 168, 168],
  ['damp_b', 168, 168],
  ['crack_a', 168, 168],
  ['crack_b', 168, 168],
  ['bullets', 168, 168],
  ['blood', 168, 168],
  ['scorch', 168, 168],
];
export const CITY_ATLAS = (() => {
  const S = 2048, PAD = 4;
  const out = {};
  let x = PAD, y = PAD, rowH = 0;
  // (the tallest first: rows of one height waste nothing)
  for (const [name, w, h] of CITY_CELLS.slice().sort((a, b) => b[2] - a[2] || b[1] - a[1])) {
    if (x + w + PAD > S) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    out[name] = [x, y, w, h];
    x += w + PAD;
    rowH = Math.max(rowH, h);
    if (y + h + PAD > S) throw new Error(`textures: the city's atlas is full at '${name}'`);
  }
  return out;
})();
export function cityUV(name) {
  const [x, y, w, h] = CITY_ATLAS[name];
  // (half a texel in from the edge: a neighbour's colour never bleeds in under mip-mapping)
  return { u0: (x + 0.5) / 2048, u1: (x + w - 0.5) / 2048, v0: 1 - (y + h - 0.5) / 2048, v1: 1 - (y + 0.5) / 2048, w, h };
}

GEN.city = () => {
  const S = 2048;
  const c = mkCanvas(S, S);
  const ctx = ctx2d(c);
  ctx.clearRect(0, 0, S, S);
  const r = rngf(1401);
  const sans = (px) => `bold ${px}px "Arial Black", "Arial", sans-serif`;
  const serif = (px) => `bold ${px}px "Georgia", "Times New Roman", serif`;
  const hand = (px) => `bold ${px}px "Segoe Print", "Comic Sans MS", "Marker Felt", cursive`;
  const cell = (g, name, fn) => {
    const [x, y, w, h] = CITY_ATLAS[name];
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.translate(x, y);
    fn(w, h);
    g.restore();
  };
  // what years do to a painted board: rust runs from the top, the paint gone in patches, dirt
  const weather = (w, h, amt = 1) => {
    for (let k = 0; k < 14 * amt; k++) {
      const px = r() * w, py = r() * h, R = 8 + r() * Math.min(w, h) * 0.4;
      const g = ctx.createRadialGradient(px, py, 0, px, py, R);
      g.addColorStop(0, `rgba(34,26,18,${0.22 + r() * 0.3})`);
      g.addColorStop(1, 'rgba(34,26,18,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - R, py - R, R * 2, R * 2);
    }
    for (let k = 0; k < 22 * amt; k++) {
      const px = r() * w, l = h * (0.3 + r() * 0.7), wd = 2 + r() * 7;
      const g = ctx.createLinearGradient(0, 0, 0, l);
      g.addColorStop(0, `rgba(118,62,26,${0.25 + r() * 0.3})`);
      g.addColorStop(1, 'rgba(118,62,26,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px, 0, wd, l);
    }
    // flaked to the primer
    for (let k = 0; k < 26 * amt; k++) {
      ctx.fillStyle = `rgba(${150 + r() * 40},${140 + r() * 36},${120 + r() * 30},${0.5 + r() * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 2 + r() * 10, 1.5 + r() * 6, r() * 3, 0, 7);
      ctx.fill();
    }
  };
  const fit = (t, w, px, fontOf) => {
    ctx.font = fontOf(px);
    const m = ctx.measureText(t).width;
    if (m > w) ctx.font = fontOf(Math.floor((px * w) / m));
  };
  for (const [name, w, h, text, board, ink] of CITY_CELLS) {
    if (!text) continue;
    cell(ctx, name, () => {
      ctx.fillStyle = board;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 4;
      ctx.strokeRect(9, 9, w - 18, h - 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (h > w) {
        // letters down a blade sign
        const n = text.length;
        ctx.font = sans(Math.floor(Math.min(w * 0.72, (h / n) * 0.8)));
        for (let k = 0; k < n; k++) ctx.fillText(text[k], w / 2, ((k + 0.5) * (h - 30)) / n + 15);
      } else {
        fit(text, w - 44, Math.floor(h * 0.6), name === 'church' || name === 'shop_hotel' || name === 'shop_books' ? serif : sans);
        ctx.fillText(text, w / 2, h / 2 + 3);
      }
      // a letter or two gone from it
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = board;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(30 + r() * (w - 60), 16 + r() * (h - 50), 8 + r() * 22, 10 + r() * 22);
        ctx.globalAlpha = 1;
      }
      weather(w, h, w / 512);
    });
  }
  // the picture house's letter board: black letters on white rails, half of them fallen
  cell(ctx, 'marquee', (w, h) => {
    ctx.fillStyle = '#cfcab8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(40,36,30,0.5)';
    for (let k = 1; k < 3; k++) ctx.fillRect(0, (k * h) / 3 - 2, w, 3);
    ctx.fillStyle = '#16130f';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ['NOW SHOWING', 'THE LAST TRAIN OUT', 'CLOSED UNTIL FURTHER NOTICE'].forEach((t, k) => {
      const cw = Math.min(54, (w - 80) / t.length);
      for (let j = 0; j < t.length; j++) {
        if (t[j] === ' ' || r() < 0.24) continue;
        ctx.save();
        ctx.translate(w / 2 + (j - (t.length - 1) / 2) * cw, ((k + 0.5) * h) / 3 + 2);
        ctx.rotate(r() < 0.12 ? (r() - 0.5) * 1.2 : 0);
        ctx.font = sans(Math.floor(Math.min(60, cw * 1.25)));
        ctx.fillText(t[j], 0, 0);
        ctx.restore();
      }
    });
    weather(w, h, 1.4);
  });
  cell(ctx, 'gasprice', (w, h) => {
    ctx.fillStyle = '#b8b2a0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#a02418';
    ctx.fillRect(0, 0, w, 120);
    ctx.fillStyle = '#f0e8d4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = sans(84);
    ctx.fillText('GAS', w / 2, 64);
    ctx.fillStyle = '#141210';
    [['REGULAR', '9.99'], ['PLUS', '--.--'], ['DIESEL', 'NONE']].forEach(([a, b], k) => {
      ctx.textAlign = 'left';
      ctx.font = sans(24);
      ctx.fillText(a, 16, 170 + k * 116);
      ctx.textAlign = 'center';
      ctx.font = sans(62);
      ctx.fillText(b, w / 2, 222 + k * 116);
    });
    weather(w, h, 1.2);
  });
  const stencilBoard = (name, lines, bg, ink) =>
    cell(ctx, name, (w, h) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach(([t, px], k) => {
        fit(t, w - 40, px, sans);
        ctx.fillText(t, w / 2, ((k + 0.5) * (h - 20)) / lines.length + 10);
      });
      ctx.strokeStyle = ink;
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      weather(w, h, 1);
      // shot at
      for (let k = 0; k < 7; k++) {
        const px = 20 + r() * (w - 40), py = 20 + r() * (h - 40);
        ctx.fillStyle = '#0c0b0a';
        ctx.beginPath();
        ctx.arc(px, py, 4 + r() * 3, 0, 7);
        ctx.fill();
        ctx.strokeStyle = 'rgba(150,84,40,0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  stencilBoard('quarantine', [['QUARANTINE ZONE', 64], ['NO ENTRY BEYOND THIS POINT', 40], ['LETHAL FORCE AUTHORIZED', 40]], '#c9c4b2', '#8a1a12');
  stencilBoard('evac', [['EVACUATION ROUTE', 60], ['CALDER FIELD  9 MI  >>>', 50]], '#1e5a34', '#e8e4d4');
  // hoardings: what was being sold when it stopped
  const hoarding = (name, top, big, sub, bg, ink) =>
    cell(ctx, name, (w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, bg[0]);
      g.addColorStop(1, bg[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = sans(30);
      ctx.fillText(top, w / 2, 40);
      fit(big, w - 50, 96, serif);
      ctx.fillText(big, w / 2, h / 2 + 6);
      ctx.font = sans(26);
      ctx.fillText(sub, w / 2, h - 36);
      // the paper torn off in strips, the last advert under it
      for (let k = 0; k < 9; k++) {
        ctx.fillStyle = `rgba(${170 + r() * 50},${160 + r() * 50},${130 + r() * 40},0.92)`;
        const px = r() * w, wd = 16 + r() * 60;
        ctx.beginPath();
        ctx.moveTo(px, r() * h * 0.4);
        ctx.lineTo(px + wd, r() * h * 0.3);
        ctx.lineTo(px + wd * (0.6 + r() * 0.6), h * (0.5 + r() * 0.5));
        ctx.lineTo(px - wd * 0.2, h * (0.5 + r() * 0.5));
        ctx.fill();
      }
      weather(w, h, 1.6);
    });
  hoarding('billboard_a', 'FLY THE COAST', 'Pacific & Northern', 'DAILY FROM CALDER FIELD', ['#3a6a8a', '#c8b890'], '#f4ecd8');
  hoarding('billboard_b', 'STAY INDOORS  -  STAY CALM', 'HELP IS COMING', 'CIVIL DEFENSE AUTHORITY', ['#b8b4a8', '#8a867a'], '#7a1812');
  // notices pasted up: the missing, the orders
  ['poster_a', 'poster_b', 'poster_c', 'poster_d'].forEach((name, n) =>
    cell(ctx, name, (w, h) => {
      ctx.fillStyle = ['#d8d2bc', '#c8c0a4', '#dcd8cc', '#b8b29a'][n];
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1a1612';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = sans(n % 2 ? 20 : 22);
      ctx.fillText(['MISSING', 'CURFEW', 'HAVE YOU SEEN', 'NOTICE'][n], w / 2, 20, w - 8);
      if (n % 2 === 0) {
        ctx.fillStyle = '#6a665a';
        ctx.fillRect(w * 0.2, 38, w * 0.6, 78);
        ctx.fillStyle = '#3a3630';
        ctx.beginPath();
        ctx.arc(w / 2, 68, 18, 0, 7);
        ctx.fill();
        ctx.fillRect(w * 0.32, 88, w * 0.36, 28);
      }
      ctx.fillStyle = 'rgba(30,26,20,0.75)';
      for (let k = 0; k < (n % 2 ? 11 : 5); k++) ctx.fillRect(12, (n % 2 ? 44 : 128) + k * 12, (w - 24) * (0.6 + r() * 0.4), 4);
      weather(w, h, 0.5);
      // a corner torn away
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(w, h);
      ctx.lineTo(w - 20 - r() * 40, h);
      ctx.lineTo(w, h - 20 - r() * 50);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }),
  );
  cell(ctx, 'redcross', (w, h) => {
    ctx.fillStyle = '#d6d2c6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9a1c16';
    ctx.fillRect(w * 0.38, h * 0.14, w * 0.24, h * 0.72);
    ctx.fillRect(w * 0.14, h * 0.38, w * 0.72, h * 0.24);
    weather(w, h, 0.5);
  });
  // leaded glass: panes of colour between black cames, a figure in the middle of it, panes knocked out
  ['stained_a', 'stained_b'].forEach((name, n) =>
    cell(ctx, name, (w, h) => {
      ctx.fillStyle = '#0c0b0a';
      ctx.fillRect(0, 0, w, h);
      const cols = n ? ['#8a2a22', '#b8902a', '#2a4a7a', '#4a7a4a', '#7a3a6a'] : ['#24467a', '#9a2a20', '#c0a030', '#3a6a5a', '#6a4a8a'];
      for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 5; i++) {
          if (r() < 0.14) continue; // (knocked out)
          ctx.fillStyle = cols[Math.floor(r() * cols.length)];
          ctx.globalAlpha = 0.55 + r() * 0.4;
          ctx.beginPath();
          const cx = ((i + (j % 2) * 0.5) * w) / 4.5, cy = ((j + 0.5) * h) / 10;
          ctx.moveTo(cx, cy - h / 20 + 1.5);
          ctx.lineTo(cx + w / 9 - 1.5, cy);
          ctx.lineTo(cx, cy + h / 20 - 1.5);
          ctx.lineTo(cx - w / 9 + 1.5, cy);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = n ? '#c8b060' : '#d0c8a0';
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.36, w * 0.16, h * 0.07, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = n ? '#2a4a7a' : '#8a2a22';
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.42);
      ctx.lineTo(w * 0.76, h * 0.86);
      ctx.lineTo(w * 0.24, h * 0.86);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#0c0b0a';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
      weather(w, h, 0.25);
    }),
  );
  // ---- sprayed on a wall: by hand, dripping
  const spray = (name, lines, col, runs = 34) =>
    cell(ctx, name, (w, h) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((t, k) => {
        const cy = ((k + 0.5) * h * 0.86) / lines.length + h * 0.04;
        fit(t, w - 36, Math.floor(((h * 0.86) / lines.length) * 0.78), hand);
        ctx.save();
        ctx.translate(w / 2, cy);
        ctx.rotate((r() - 0.5) * 0.06);
        // (the can's soft edge, then the line)
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.25;
        for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) ctx.fillText(t, dx, dy);
        ctx.globalAlpha = 0.95;
        ctx.fillText(t, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 0.8;
        for (let j = 0; j < 7; j++) ctx.fillRect(30 + r() * (w - 60), cy + 6 + r() * 10, 2 + r() * 2.5, 10 + r() * runs);
        ctx.globalAlpha = 1;
      });
    });
  spray('graf_help', ['HELP US'], '#b8b4a6');
  spray('graf_dead', ['DEAD INSIDE', 'DO NOT OPEN'], '#8a1810');
  spray('graf_room', ['NO MORE ROOM', 'AT THE HOSPITAL'], '#16140f');
  spray('graf_god', ['GOD FORGIVE US'], '#c0bcae');
  spray('graf_bridge', ['BRIDGE IS OUT', 'GO TO THE AIRFIELD ->'], '#b8902a');
  spray('graf_night', ['THEY COME', 'AT NIGHT'], '#8a1810', 60);
  spray('graf_names', ['MARIA + KIDS', 'GONE TO', 'CALDER FIELD', 'WAIT FOR US'], '#d0ccbe', 12);
  spray('graf_tag', ['KSR 9'], '#2a5a7a');
  // the searchers' mark: a cross, the date, the count of the dead
  ['xcode_a', 'xcode_b'].forEach((name, n) =>
    cell(ctx, name, (w, h) => {
      ctx.strokeStyle = n ? '#c05a1c' : '#b8b4a6';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(22, 22);
      ctx.lineTo(w - 22, h - 22);
      ctx.moveTo(w - 22, 22);
      ctx.lineTo(22, h - 22);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = hand(30);
      ctx.fillText(n ? '9-14' : '9-11', w / 2, 26);
      ctx.fillText(n ? '7 D' : '0', w / 2, h - 24);
      ctx.fillText(n ? 'NG' : 'TF2', 30, h / 2);
      ctx.fillText(n ? 'X' : 'NE', w - 30, h / 2);
    }),
  );
  // ivy up a wall: a thick sheet of leaves from the ground, thinning to runners at its top and edges
  ['ivy_a', 'ivy_b'].forEach((name, n) =>
    cell(ctx, name, (w, h) => {
      // (how high it has got at x: three tongues of it of their own heights, ragged)
      const tongues = [[0.22 + r() * 0.12, 0.5 + r() * 0.45, 0.2], [0.5 + r() * 0.1, 0.6 + r() * 0.4, 0.26], [0.78 - r() * 0.12, 0.35 + r() * 0.5, 0.18]];
      const reach = (x) => h * Math.min(0.98, 0.1 + tongues.reduce((m, [c, top, wd]) => Math.max(m, top * Math.exp(-(((x / w - c) / wd) ** 2))), 0) * (0.85 + 0.15 * Math.sin(x * 0.11 + n * 2)));
      ctx.strokeStyle = '#2a2014';
      ctx.lineWidth = 3;
      for (let k = 0; k < 9; k++) {
        let x = w * (0.1 + r() * 0.8), y = h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const top = h - reach(x) * (0.8 + r() * 0.3);
        while (y > top) {
          x += (r() - 0.5) * 26;
          y -= 14 + r() * 20;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let k = 0; k < 2600; k++) {
        const x = r() * w;
        const y = h - Math.pow(r(), 1.5) * reach(x);
        const s = 6 + r() * 9;
        const dead = n === 1 && r() < 0.35;
        const sh = 0.55 + r() * 0.6;
        ctx.fillStyle = dead ? rgb(82 * sh, 62 * sh, 32 * sh) : rgb(24 * sh + r() * 14, 52 * sh + r() * 20, 20 * sh);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(r() * 6.3);
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.quadraticCurveTo(s * 0.9, -s * 0.5, s * 0.75, s * 0.2);
        ctx.quadraticCurveTo(s * 0.3, s * 0.3, 0, s);
        ctx.quadraticCurveTo(-s * 0.3, s * 0.3, -s * 0.75, s * 0.2);
        ctx.quadraticCurveTo(-s * 0.9, -s * 0.5, 0, -s);
        ctx.fill();
        ctx.restore();
      }
    }),
  );
  // a wall painted with an advertisement before anyone here was born: all but gone
  cell(ctx, 'ghost', (w, h) => {
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#d8d0b8';
    ctx.fillRect(10, 10, w - 20, h - 20);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#1e2a3a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = serif(70);
    ctx.fillText('KESSLER', w / 2, 96);
    ctx.font = sans(44);
    ctx.fillText('IRON & STEEL', w / 2, 190);
    ctx.font = serif(34);
    ctx.fillText('PORT CALDER  EST. 1894', w / 2, 290, w - 30);
    ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 500; k++) {
      ctx.globalAlpha = 0.5 + r() * 0.5;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 3 + r() * 16, 2 + r() * 8, 0, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  });
  // ---- soft: read back and written per pixel (noise shapes them; a canvas gradient is too clean)
  const img = canvasToImg(c);
  const D = img.d;
  const NW = 256;
  const soft = (name, seed, fn) => {
    const [x0, y0, w, h] = CITY_ATLAS[name];
    const n1 = fbm(NW, NW, 4, 4, 4, seed), n2 = fbm(NW, NW, 18, 18, 3, seed + 1), n3 = fbm(NW, NW, 24, 3, 4, seed + 2);
    const o = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (((y * NW) / h) | 0) * NW + (((x * NW) / w) | 0);
        const kk = (y & 255) * NW + (x & 255);
        fn(x / w, y / h, n1[k], n2[kk], n3[kk], o);
        // (soft to nothing at the cell's edge, whatever the shape)
        const e = Math.min(x, w - 1 - x, y, h - 1 - y);
        const i = ((y0 + y) * S + x0 + x) * 4;
        D[i] = o[0];
        D[i + 1] = o[1];
        D[i + 2] = o[2];
        D[i + 3] = clamp(o[3] * sstep(0, 10, e)) * 255;
      }
    }
  };
  // soot from a window that burnt: densest at the lintel (the foot of the cell), spreading and thinning upward
  for (const [name, seed] of [['soot_a', 1411], ['soot_b', 1421]]) {
    soft(name, seed, (u, v, a, b, st, o) => {
      const up = 1 - v; // (0 at the foot)
      const side = Math.abs(u - 0.5 + (a - 0.5) * 0.3 * up) / (0.2 + up * 0.26);
      const dens = (1 - sstep(0.35, 1, side)) * Math.pow(1 - up, 1.25) * (0.75 + st * 0.5);
      const k = 10 + b * 14;
      o[0] = k;
      o[1] = k * 0.95;
      o[2] = k * 0.9;
      o[3] = clamp(dens * 1.5) * 0.94;
    });
  }
  // rust run down from a fixing at the head of the cell
  for (const [name, seed] of [['rust_a', 1431], ['rust_b', 1441]]) {
    soft(name, seed, (u, v, a, b, st, o) => {
      const side = Math.abs(u - 0.5 + (a - 0.5) * 0.25) / (0.14 + v * 0.3);
      const dens = (1 - sstep(0.2, 1, side)) * Math.pow(1 - v, 0.8) * (0.4 + st * 0.9);
      o[0] = 92 + b * 30;
      o[1] = 52 + b * 18;
      o[2] = 28 + b * 10;
      o[3] = clamp(dens) * 0.62;
    });
  }
  // what the rain has run down a wall from a sill or a coping: dark streaks
  for (const [name, seed] of [['stain_a', 1451], ['stain_b', 1461]]) {
    soft(name, seed, (u, v, a, b, st, o) => {
      const streak = sstep(0.42, 0.7, st) * (1 - sstep(0.5, 1, Math.abs(u - 0.5) * 2));
      const dens = streak * Math.pow(1 - v, 0.6) * (0.6 + a * 0.6);
      o[0] = 26 + b * 16;
      o[1] = 30 + b * 20;
      o[2] = 22 + b * 10;
      o[3] = clamp(dens) * 0.78;
    });
  }
  for (const [name, seed, col] of [['damp_a', 1471, [30, 40, 24]], ['damp_b', 1481, [22, 20, 18]]]) {
    soft(name, seed, (u, v, a, b, st, o) => {
      const dens = sstep(0.95, 0.2, Math.hypot(u - 0.5, v - 0.5) * 2 + (a - 0.5) * 0.9) * (0.5 + b * 0.7);
      o[0] = col[0] + b * 20;
      o[1] = col[1] + b * 24;
      o[2] = col[2] + b * 10;
      o[3] = clamp(dens) * 0.72;
    });
  }
  soft('scorch', 1491, (u, v, a, b, st, o) => {
    const k = 8 + b * 12;
    o[0] = k;
    o[1] = k;
    o[2] = k;
    o[3] = clamp(sstep(1, 0.1, Math.hypot(u - 0.5, v - 0.5) * 2 + (a - 0.5) * 0.7)) * 0.92;
  });
  const c2 = imgToCanvas(img, c);
  const g2 = ctx2d(c2);
  for (const name of ['crack_a', 'crack_b']) {
    cell(g2, name, (w, h) => {
      const rc = rngf(name === 'crack_a' ? 1501 : 1502);
      drawCracks(g2, w, h, () => 0.15 + rc() * 0.7, 3, { len: [120, 260], width: [1.2, 2.6], col: 'rgba(14,12,10,0.86)', light: 'rgba(190,184,170,0.25)', branch: 2.4, wander: 0.7, step: 6 });
    });
  }
  cell(g2, 'bullets', (w, h) => {
    for (let k = 0; k < 16; k++) {
      const px = 24 + r() * (w - 48), py = 24 + r() * (h - 48), R = 3 + r() * 5;
      const g = g2.createRadialGradient(px, py, R * 0.5, px, py, R * 2.6);
      g.addColorStop(0, 'rgba(150,146,136,0.85)');
      g.addColorStop(1, 'rgba(150,146,136,0)');
      g2.fillStyle = g;
      g2.fillRect(px - R * 3, py - R * 3, R * 6, R * 6);
      g2.fillStyle = 'rgba(10,9,8,0.95)';
      g2.beginPath();
      g2.arc(px, py, R, 0, 7);
      g2.fill();
    }
  });
  cell(g2, 'blood', (w, h) => {
    g2.fillStyle = 'rgba(70,10,6,0.85)';
    // a hand dragged down the wall, twice
    for (const [hx, hy] of [[70, 50], [160, 90]]) {
      for (let f = 0; f < 4; f++) {
        g2.beginPath();
        g2.ellipse(hx + f * 9 - 14, hy - 16 + Math.abs(f - 1.5) * 4, 3.5, 11, 0, 0, 7);
        g2.fill();
        g2.globalAlpha = 0.5;
        g2.fillRect(hx + f * 9 - 16, hy - 6, 4, 60 + r() * 70);
        g2.globalAlpha = 1;
      }
      g2.beginPath();
      g2.ellipse(hx, hy + 8, 17, 15, 0, 0, 7);
      g2.fill();
    }
    for (let k = 0; k < 30; k++) {
      g2.beginPath();
      g2.arc(r() * w, h * 0.3 + r() * h * 0.6, 1 + r() * 5, 0, 7);
      g2.fill();
    }
  });
  return { canvas: c2, clamp: true };
};
