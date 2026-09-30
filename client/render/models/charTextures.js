// Procedural canvas textures for characters and weapons.
// Two 1024x1024 atlases (4x4 cells of 256px) are generated lazily and cached:
//   - character atlas: skin, gore, cloth, denim, knit, leather, flesh, bone, hair, membrane, ...
//   - weapon atlas:    wood, walnut, gunmetal, steel, polymer, tape, rust, glass, rag, ...
// Most cells are near-neutral detail maps; hue comes from per-vertex colors (multiplied).
import * as THREE from 'three';

// ------------------------------------------------------------------ noise / rng (shared helpers)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

/** 3D value noise in [0,1]. */
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const a = hash3(xi, yi, zi, seed), b = hash3(xi + 1, yi, zi, seed);
  const c = hash3(xi, yi + 1, zi, seed), d = hash3(xi + 1, yi + 1, zi, seed);
  const e = hash3(xi, yi, zi + 1, seed), f = hash3(xi + 1, yi, zi + 1, seed);
  const g = hash3(xi, yi + 1, zi + 1, seed), h = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return y1 + (y2 - y1) * w;
}

export function fbm3(x, y, z, oct = 3, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f, seed + i * 17);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// ------------------------------------------------------------------ atlas bookkeeping
const CELL = 256;
const GRID = 4;
const SIZE = CELL * GRID;
const INSET = 4 / SIZE;

/** Character atlas regions. */
export const CR = {
  SKIN: 0, GORE: 1, CLOTH: 2, DENIM: 3,
  KNIT: 4, LEATHER: 5, FLESH: 6, BONE: 7,
  HAIR: 8, MEMBRANE: 9, CANVAS: 10, CHITIN: 11,
  GLOW: 12, PLAID: 13, TUMOR: 14, PLAIN: 15,
};
/** Weapon atlas regions. */
export const WR = {
  WOOD: 0, WALNUT: 1, GUNMETAL: 2, STEEL: 3,
  POLYMER: 4, TAPE: 5, RUST: 6, GLASS: 7,
  RAG: 8, LEATHER: 9, ASH: 10, BLOOD: 11,
  SKIN: 12, SLEEVE: 13, GLOVE: 14, PLAIN: 15,
};

/** UV rectangle [u0, v0, u1, v1] of an atlas cell (with a small inset against bleeding). */
export function regionUV(region) {
  const col = region % GRID, row = (region / GRID) | 0;
  const u0 = col / GRID + INSET, u1 = (col + 1) / GRID - INSET;
  const v1 = 1 - row / GRID - INSET, v0 = 1 - (row + 1) / GRID + INSET;
  return [u0, v0, u1, v1];
}

let maxAniso = 4;
const allTextures = [];
export function setMaxAnisotropy(n) {
  maxAniso = Math.max(1, n | 0);
  for (const t of allTextures) {
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finishTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  allTextures.push(tex);
  return tex;
}

// ------------------------------------------------------------------ cell painting helpers
function pixelFill(ctx, fn) {
  const img = ctx.createImageData(CELL, CELL);
  const d = img.data;
  const out = [0, 0, 0];
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      fn(x, y, out);
      const i = (y * CELL + x) * 4;
      d[i] = out[0] < 0 ? 0 : out[0] > 255 ? 255 : out[0];
      d[i + 1] = out[1] < 0 ? 0 : out[1] > 255 ? 255 : out[1];
      d[i + 2] = out[2] < 0 ? 0 : out[2] > 255 ? 255 : out[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function splat(ctx, rnd, x, y, r, color, drips = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const n = 4 + ((rnd() * 8) | 0);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const dd = r * (0.8 + rnd() * 1.6);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * dd, y + Math.sin(a) * dd, r * (0.1 + rnd() * 0.35), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < drips; i++) {
    const dx = x + (rnd() - 0.5) * r * 1.4;
    const len = r * (1 + rnd() * 3);
    ctx.fillRect(dx - 1, y, 1.5 + rnd() * 1.5, len);
    ctx.beginPath();
    ctx.arc(dx, y + len, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function veins(ctx, rnd, count, color, width, len = 60) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = rnd() * CELL, y = rnd() * CELL, a = rnd() * Math.PI * 2;
    let w = width * (0.6 + rnd() * 0.8);
    const steps = 8 + ((rnd() * len) / 6) | 0;
    for (let s = 0; s < steps; s++) {
      const nx = x + Math.cos(a) * 5, ny = y + Math.sin(a) * 5;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      x = nx;
      y = ny;
      a += (rnd() - 0.5) * 0.9;
      w *= 0.94;
      if (rnd() < 0.12 && w > 0.4) {
        // branch
        let bx = x, by = y, ba = a + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.6), bw = w * 0.7;
        for (let k = 0; k < 5; k++) {
          const nbx = bx + Math.cos(ba) * 4, nby = by + Math.sin(ba) * 4;
          ctx.lineWidth = bw;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(nbx, nby);
          ctx.stroke();
          bx = nbx;
          by = nby;
          ba += (rnd() - 0.5) * 0.8;
          bw *= 0.85;
        }
      }
    }
  }
}

function scratches(ctx, rnd, count, color, maxLen = 40, width = 0.8) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let i = 0; i < count; i++) {
    const x = rnd() * CELL, y = rnd() * CELL, a = rnd() * Math.PI, l = 4 + rnd() * maxLen;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

function blotches(ctx, rnd, count, rgb, alpha, rmin, rmax) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * CELL, y = rnd() * CELL, r = rmin + rnd() * (rmax - rmin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

const n2 = (x, y, f, s, o = 3) => fbm3(x * f, y * f, 0.5, o, s);

// ------------------------------------------------------------------ character atlas cells
const CHAR_PAINTERS = {
  [CR.SKIN](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.035, 1, 4);
      const m = n2(x, y, 0.012, 7, 2);
      const pore = noise3(x * 0.6, y * 0.6, 3, 5) > 0.83 ? -18 : 0;
      const v = 175 + (n - 0.5) * 90 + pore;
      o[0] = v + (m - 0.5) * 30;
      o[1] = v + 4 - (m - 0.5) * 10;
      o[2] = v - 6 + (m - 0.5) * 24;
    });
    blotches(ctx, rnd, 14, '90,50,95', 0.28, 12, 40); // bruises
    blotches(ctx, rnd, 10, '70,95,55', 0.2, 10, 35); // sickly green
    veins(ctx, rnd, 18, 'rgba(55,40,85,0.55)', 1.6, 70);
    veins(ctx, rnd, 10, 'rgba(90,30,40,0.45)', 1.1, 40);
    for (let i = 0; i < 6; i++) splat(ctx, rnd, rnd() * CELL, rnd() * CELL, 2 + rnd() * 5, 'rgba(80,6,6,0.75)', 1);
    scratches(ctx, rnd, 12, 'rgba(110,20,20,0.6)', 20, 1.2);
  },
  [CR.GORE](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.04, 11, 4);
      const v = 160 + (n - 0.5) * 80;
      o[0] = v + 10;
      o[1] = v - 5;
      o[2] = v - 5;
    });
    blotches(ctx, rnd, 10, '110,20,25', 0.5, 20, 50);
    for (let i = 0; i < 26; i++) splat(ctx, rnd, rnd() * CELL, rnd() * CELL, 3 + rnd() * 10, `rgba(${70 + rnd() * 50 | 0},4,6,${0.7 + rnd() * 0.3})`, 2);
    // open wounds
    for (let i = 0; i < 5; i++) {
      const x = rnd() * CELL, y = rnd() * CELL, rx = 6 + rnd() * 14, ry = 2 + rnd() * 5, a = rnd() * Math.PI;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(160,40,40,0.9)';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx + 3, ry + 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(40,0,2,0.95)';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    veins(ctx, rnd, 8, 'rgba(50,20,60,0.5)', 1.4, 50);
  },
  [CR.CLOTH](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const weave = (Math.sin(x * 1.9) * Math.sin(y * 1.9)) * 8;
      const n = n2(x, y, 0.03, 21, 4);
      const st = n2(x, y, 0.012, 23, 2);
      const v = 185 + weave + (n - 0.5) * 60 - (st > 0.6 ? (st - 0.6) * 200 : 0);
      o[0] = v;
      o[1] = v - 2;
      o[2] = v - 8;
    });
    blotches(ctx, rnd, 10, '70,55,35', 0.35, 15, 45); // grime
    for (let i = 0; i < 10; i++) splat(ctx, rnd, rnd() * CELL, rnd() * CELL, 3 + rnd() * 9, `rgba(${60 + rnd() * 40 | 0},5,5,0.8)`, 3);
    // small holes / frayed spots
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = 'rgba(20,12,10,0.8)';
      ctx.beginPath();
      ctx.ellipse(rnd() * CELL, rnd() * CELL, 2 + rnd() * 5, 1 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    scratches(ctx, rnd, 30, 'rgba(40,30,25,0.25)', 18, 1);
  },
  [CR.DENIM](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const tw = ((x + y) % 4 < 2 ? 1 : -1) * 9;
      const n = n2(x, y, 0.025, 31, 4);
      const fadeL = n2(x, y, 0.01, 33, 2);
      const v = 170 + tw + (n - 0.5) * 50 + (fadeL - 0.5) * 60;
      o[0] = v - 6;
      o[1] = v;
      o[2] = v + 10;
    });
    blotches(ctx, rnd, 12, '60,45,30', 0.4, 12, 40);
    for (let i = 0; i < 6; i++) splat(ctx, rnd, rnd() * CELL, rnd() * CELL, 3 + rnd() * 8, 'rgba(60,5,5,0.75)', 2);
    ctx.strokeStyle = 'rgba(200,170,90,0.5)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const x = 20 + rnd() * 200;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 6, CELL);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  },
  [CR.KNIT](ctx) {
    pixelFill(ctx, (x, y, o) => {
      const cx = x % 8, cy = y % 10;
      const vShape = Math.abs(cx - 4) - cy * 0.4;
      const k = Math.sin(vShape * 1.2) * 18 + (cy < 2 ? -20 : 0);
      const n = n2(x, y, 0.05, 41, 3);
      const v = 170 + k + (n - 0.5) * 40;
      o[0] = v;
      o[1] = v;
      o[2] = v;
    });
  },
  [CR.LEATHER](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.18, 51, 3);
      const m = n2(x, y, 0.02, 53, 3);
      const v = 150 + (n - 0.5) * 50 + (m - 0.5) * 60;
      o[0] = v;
      o[1] = v - 6;
      o[2] = v - 14;
    });
    scratches(ctx, rnd, 25, 'rgba(30,20,15,0.5)', 30, 1.2);
    scratches(ctx, rnd, 15, 'rgba(220,200,180,0.25)', 20, 0.8);
  },
  [CR.FLESH](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.04, 61, 4);
      const fib = Math.sin(y * 0.9 + n2(x, y, 0.03, 63, 2) * 12) * 0.5 + 0.5;
      const dark = n2(x, y, 0.015, 65, 2);
      const r = 120 + fib * 50 + (n - 0.5) * 60 - dark * 40;
      o[0] = r;
      o[1] = r * 0.18 + fib * 10;
      o[2] = r * 0.2 + 6;
    });
    blotches(ctx, rnd, 10, '220,190,120', 0.35, 4, 12); // fat
    blotches(ctx, rnd, 14, '30,0,0', 0.5, 8, 26); // dark crevices
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,180,180,${0.2 + rnd() * 0.3})`;
      ctx.fillRect(rnd() * CELL, rnd() * CELL, 1 + rnd() * 3, 1);
    }
  },
  [CR.BONE](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.05, 71, 4);
      const v = 210 + (n - 0.5) * 50;
      o[0] = v;
      o[1] = v - 8;
      o[2] = v - 30;
    });
    blotches(ctx, rnd, 12, '120,80,40', 0.35, 10, 30);
    blotches(ctx, rnd, 8, '110,20,15', 0.45, 8, 22);
    scratches(ctx, rnd, 20, 'rgba(80,60,40,0.6)', 25, 0.9);
  },
  [CR.HAIR](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x * 4, y * 0.2, 0.1, 81, 3);
      const v = 120 + (n - 0.5) * 120;
      o[0] = v;
      o[1] = v;
      o[2] = v;
    });
    ctx.strokeStyle = 'rgba(20,15,10,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = rnd() * CELL;
      ctx.beginPath();
      ctx.moveTo(x, rnd() * CELL);
      ctx.lineTo(x + (rnd() - 0.5) * 12, rnd() * CELL);
      ctx.stroke();
    }
  },
  [CR.MEMBRANE](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.03, 91, 4);
      const v = 150 + (n - 0.5) * 70;
      o[0] = v + 10;
      o[1] = v - 5;
      o[2] = v;
    });
    veins(ctx, rnd, 14, 'rgba(40,10,20,0.7)', 2.2, 90);
    veins(ctx, rnd, 12, 'rgba(150,60,70,0.4)', 1.2, 50);
    blotches(ctx, rnd, 8, '20,10,10', 0.4, 10, 30);
  },
  [CR.CANVAS](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const weave = (x % 3 === 0 ? -10 : 0) + (y % 3 === 0 ? -10 : 0);
      const n = n2(x, y, 0.03, 101, 4);
      const v = 185 + weave + (n - 0.5) * 55;
      o[0] = v;
      o[1] = v;
      o[2] = v - 4;
    });
    ctx.strokeStyle = 'rgba(30,25,20,0.45)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const y = 30 + rnd() * 200;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CELL, y + (rnd() - 0.5) * 10);
      ctx.stroke();
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y + 4);
      ctx.lineTo(CELL, y + 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    blotches(ctx, rnd, 12, '60,50,35', 0.35, 15, 40);
    for (let i = 0; i < 4; i++) splat(ctx, rnd, rnd() * CELL, rnd() * CELL, 2 + rnd() * 6, 'rgba(70,8,8,0.6)', 1);
  },
  [CR.CHITIN](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const band = (y % 32) / 32;
      const edge = band < 0.12 ? -70 : 0;
      const hi = Math.pow(1 - Math.abs(band - 0.45) * 2, 3) * 40;
      const n = n2(x, y, 0.04, 111, 3);
      const v = 130 + hi + edge + (n - 0.5) * 40;
      o[0] = v;
      o[1] = v + 5;
      o[2] = v - 5;
    });
    scratches(ctx, rnd, 20, 'rgba(10,10,5,0.6)', 20, 1);
  },
  [CR.GLOW](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.05, 121, 3);
      const v = 200 + (n - 0.5) * 100;
      o[0] = v;
      o[1] = v;
      o[2] = v;
    });
    veins(ctx, rnd, 16, 'rgba(20,30,10,0.8)', 3, 80);
    blotches(ctx, rnd, 10, '255,255,255', 0.5, 6, 20);
  },
  [CR.PLAID](ctx, rnd) {
    // grey flannel check (hue comes from the vertex color): 8 columns x 4 rows because lathe UVs wrap
    // once around the torso but only span its height
    pixelFill(ctx, (x, y, o) => {
      const u = (x % 32) / 32, v = (y % 64) / 64;
      const bu = u < 0.42 ? 1 : 0, bv = v < 0.42 ? 1 : 0;
      const line = (Math.abs(u - 0.71) < 0.035 ? 1 : 0) + (Math.abs(v - 0.71) < 0.02 ? 1 : 0);
      const weave = (x + y) % 3 === 0 ? -8 : 0;
      const n = n2(x, y, 0.03, 131, 3);
      const k = 215 - bu * 60 - bv * 60 - bu * bv * 25 + line * 25 + weave + (n - 0.5) * 36;
      o[0] = k + 4;
      o[1] = k;
      o[2] = k - 4;
    });
    blotches(ctx, rnd, 10, '60,45,30', 0.35, 12, 40); // grime
    for (let i = 0; i < 8; i++) splat(ctx, rnd, rnd() * CELL, rnd() * CELL, 3 + rnd() * 8, `rgba(${60 + rnd() * 40 | 0},5,5,0.8)`, 3);
  },
  [CR.TUMOR](ctx, rnd) {
    // voronoi-ish bumps
    const pts = [];
    for (let i = 0; i < 40; i++) pts.push([rnd() * CELL, rnd() * CELL, 0.5 + rnd() * 0.5]);
    pixelFill(ctx, (x, y, o) => {
      let d1 = 1e9, d2 = 1e9, w = 1;
      for (const p of pts) {
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
        if (d < d1) { d2 = d1; d1 = d; w = p[2]; } else if (d < d2) d2 = d;
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      const bump = Math.sqrt(Math.min(1, e / 16));
      const n = n2(x, y, 0.05, 141, 3);
      o[0] = 80 + bump * 150 * w + (n - 0.5) * 30;
      o[1] = 22 + bump * 170 * w + (n - 0.5) * 26;
      o[2] = 30 + bump * 160 * w + (n - 0.5) * 20;
    });
    veins(ctx, rnd, 10, 'rgba(70,10,30,0.55)', 1.6, 50);
    for (let i = 0; i < 6; i++) {
      const x = rnd() * CELL, y = rnd() * CELL, r = 2 + rnd() * 4;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, 'rgba(240,235,180,0.9)');
      g.addColorStop(0.6, 'rgba(190,170,90,0.7)');
      g.addColorStop(1, 'rgba(120,30,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  },
  [CR.PLAIN](ctx) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.05, 151, 2);
      const v = 225 + (n - 0.5) * 30;
      o[0] = v;
      o[1] = v;
      o[2] = v;
    });
  },
};

// ------------------------------------------------------------------ weapon atlas cells
function woodGrain(x, y, seed, base, ring, dark) {
  // grain runs along X (u direction)
  const w = n2(x * 0.15, y, 0.06, seed, 3);
  const g = Math.sin((y + w * 40) * 0.55) * 0.5 + 0.5;
  const fine = noise3(x * 0.05, y * 1.2, 1, seed + 5);
  const k = g * ring + fine * 0.15;
  return [base[0] - k * dark[0], base[1] - k * dark[1], base[2] - k * dark[2]];
}

const WEAPON_PAINTERS = {
  [WR.WOOD](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const c = woodGrain(x, y, 201, [176, 96, 52], 0.9, [70, 40, 25]);
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    scratches(ctx, rnd, 30, 'rgba(40,20,10,0.4)', 25, 1);
    blotches(ctx, rnd, 10, '40,20,10', 0.3, 10, 30);
  },
  [WR.WALNUT](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const c = woodGrain(x, y, 211, [120, 72, 42], 1, [60, 38, 24]);
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    scratches(ctx, rnd, 25, 'rgba(200,160,120,0.25)', 20, 0.8);
    blotches(ctx, rnd, 8, '20,10,5', 0.35, 10, 30);
  },
  [WR.GUNMETAL](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.03, 221, 4);
      const br = noise3(x * 0.8, y * 0.04, 2, 223) * 10;
      const v = 62 + (n - 0.5) * 30 + br;
      o[0] = v;
      o[1] = v + 2;
      o[2] = v + 6;
    });
    scratches(ctx, rnd, 60, 'rgba(170,175,180,0.35)', 20, 0.7);
    blotches(ctx, rnd, 12, '140,140,145', 0.2, 8, 30); // edge wear
    blotches(ctx, rnd, 5, '90,50,30', 0.25, 6, 18); // rust specks
  },
  [WR.STEEL](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const br = noise3(x * 0.02, y * 1.5, 3, 231) * 30;
      const n = n2(x, y, 0.03, 233, 3);
      const v = 170 + br + (n - 0.5) * 40;
      o[0] = v;
      o[1] = v + 2;
      o[2] = v + 6;
    });
    scratches(ctx, rnd, 50, 'rgba(60,60,65,0.4)', 25, 0.7);
    blotches(ctx, rnd, 6, '100,55,30', 0.35, 6, 20);
  },
  [WR.POLYMER](ctx) {
    pixelFill(ctx, (x, y, o) => {
      const st = noise3(x * 0.9, y * 0.9, 4, 241) > 0.55 ? 12 : -6;
      const n = n2(x, y, 0.03, 243, 3);
      const v = 48 + st + (n - 0.5) * 16;
      o[0] = v;
      o[1] = v;
      o[2] = v + 2;
    });
  },
  [WR.TAPE](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const wr = n2(x * 0.3, y * 3, 0.05, 251, 3);
      const band = (y % 22) < 2 ? -30 : 0;
      const v = 150 + (wr - 0.5) * 70 + band;
      o[0] = v;
      o[1] = v;
      o[2] = v + 3;
    });
    blotches(ctx, rnd, 10, '40,30,20', 0.4, 8, 25);
  },
  [WR.RUST](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.04, 261, 4);
      const r = n2(x, y, 0.02, 263, 3);
      const t = r > 0.5 ? Math.min(1, (r - 0.5) * 4) : 0;
      const base = 80 + (n - 0.5) * 40;
      o[0] = base * (1 - t) + (150 + n * 60) * t;
      o[1] = base * (1 - t) + (70 + n * 30) * t;
      o[2] = base * (1 - t) + (35 + n * 15) * t + 4;
    });
    scratches(ctx, rnd, 20, 'rgba(180,180,180,0.3)', 15, 0.8);
  },
  [WR.GLASS](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.02, 271, 3);
      const streak = Math.pow(Math.max(0, Math.sin(x * 0.05 + 1)), 18) * 120;
      const v = 150 + (n - 0.5) * 40 + streak;
      o[0] = v;
      o[1] = v;
      o[2] = v;
    });
    blotches(ctx, rnd, 10, '60,50,30', 0.3, 10, 30);
  },
  [WR.RAG](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const weave = Math.sin(x * 1.7) * Math.sin(y * 1.7) * 10;
      const n = n2(x, y, 0.03, 281, 4);
      const burn = Math.max(0, (y / CELL) * 1.4 - 0.6 + (n - 0.5));
      const v = 190 + weave + (n - 0.5) * 50;
      o[0] = v * (1 - burn * 0.85);
      o[1] = (v - 10) * (1 - burn * 0.9);
      o[2] = (v - 30) * (1 - burn * 0.95);
    });
    blotches(ctx, rnd, 8, '120,80,30', 0.4, 10, 30);
  },
  [WR.LEATHER](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const strip = ((x + y * 0.8) % 28) < 3 ? -40 : 0;
      const n = n2(x, y, 0.15, 291, 3);
      const v = 120 + strip + (n - 0.5) * 40;
      o[0] = v;
      o[1] = v - 25;
      o[2] = v - 50;
    });
    scratches(ctx, rnd, 20, 'rgba(20,10,5,0.5)', 15, 1);
  },
  [WR.ASH](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const c = woodGrain(x, y, 301, [214, 180, 130], 0.6, [70, 60, 45]);
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    blotches(ctx, rnd, 12, '70,50,30', 0.35, 10, 35);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = 'rgba(90,60,40,0.5)';
      ctx.beginPath();
      ctx.ellipse(rnd() * CELL, rnd() * CELL, 3 + rnd() * 6, 1 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 6; i++) splat(ctx, rnd, rnd() * CELL, rnd() * CELL, 2 + rnd() * 6, 'rgba(90,10,8,0.7)', 1);
  },
  [WR.BLOOD](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.04, 311, 3);
      const v = 200 + (n - 0.5) * 40;
      o[0] = v; o[1] = v; o[2] = v;
    });
    for (let i = 0; i < 22; i++) splat(ctx, rnd, rnd() * CELL, rnd() * CELL, 3 + rnd() * 11, `rgba(${70 + rnd() * 60 | 0},6,6,${0.7 + rnd() * 0.3})`, 2);
  },
  [WR.SKIN](ctx, rnd) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.05, 321, 4);
      const v = 205 + (n - 0.5) * 36;
      o[0] = v + 6;
      o[1] = v;
      o[2] = v - 4;
    });
    blotches(ctx, rnd, 14, '80,60,40', 0.28, 8, 26); // dirt
    scratches(ctx, rnd, 10, 'rgba(150,50,40,0.5)', 12, 1); // scratches
    scratches(ctx, rnd, 30, 'rgba(90,70,60,0.18)', 8, 0.8); // creases
  },
  [WR.SLEEVE](ctx, rnd) {
    // jacket twill: diagonal weave, soft creases across the arm (v = along it) and a seam down one side
    pixelFill(ctx, (x, y, o) => {
      const twill = ((x + y) % 4 < 2 ? -5 : 3) + (x % 2 === 0 ? -2 : 0);
      const n = n2(x, y, 0.03, 331, 4);
      const crease = Math.max(0, Math.sin(y * 0.11 + n * 5)) ** 3 * -16;
      const seam = Math.abs(x - 200) < 2 ? -30 : Math.abs(x - 200) < 4 ? 10 : 0;
      const v = 178 + twill + crease + seam + (n - 0.5) * 34;
      o[0] = v; o[1] = v; o[2] = v;
    });
    blotches(ctx, rnd, 10, '50,40,30', 0.3, 10, 30);
    for (let i = 0; i < 3; i++) splat(ctx, rnd, rnd() * CELL, rnd() * CELL, 2 + rnd() * 5, 'rgba(70,8,8,0.55)', 1);
  },
  [WR.GLOVE](ctx, rnd) {
    // synthetic tactical-glove fabric: fine cross weave, soft mottling, a few scuffs
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.06, 341, 3);
      const weave = ((x + y) & 3) === 0 ? -7 : ((x - y) & 3) === 0 ? -4 : 0;
      const v = 120 + weave + (n - 0.5) * 26;
      o[0] = v; o[1] = v - 2; o[2] = v - 5;
    });
    scratches(ctx, rnd, 14, 'rgba(210,200,180,0.14)', 12, 0.7);
    blotches(ctx, rnd, 6, '40,32,24', 0.25, 8, 20);
  },
  [WR.PLAIN](ctx) {
    pixelFill(ctx, (x, y, o) => {
      const n = n2(x, y, 0.05, 351, 2);
      const v = 225 + (n - 0.5) * 24;
      o[0] = v; o[1] = v; o[2] = v;
    });
  },
};

function buildAtlas(painters, seed) {
  const canvas = makeCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const cell = makeCanvas(CELL, CELL);
  const cctx = cell.getContext('2d');
  for (let r = 0; r < GRID * GRID; r++) {
    const p = painters[r];
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.globalAlpha = 1;
    cctx.fillStyle = '#ccc';
    cctx.fillRect(0, 0, CELL, CELL);
    if (p) p(cctx, mulberry32(seed + r * 7919));
    ctx.drawImage(cell, (r % GRID) * CELL, ((r / GRID) | 0) * CELL);
  }
  return finishTexture(canvas);
}

let charAtlas = null;
let weaponAtlas = null;

/** Shared character atlas (skin/cloth/flesh/...). Created lazily. */
export function getCharAtlas() {
  if (!charAtlas) charAtlas = buildAtlas(CHAR_PAINTERS, 1337);
  return charAtlas;
}

/** Shared weapon atlas (wood/gunmetal/steel/...). Created lazily. */
export function getWeaponAtlas() {
  if (!weaponAtlas) weaponAtlas = buildAtlas(WEAPON_PAINTERS, 4242);
  return weaponAtlas;
}
