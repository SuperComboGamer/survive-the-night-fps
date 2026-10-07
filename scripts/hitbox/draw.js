// Pictures without a browser: a small software rasteriser (triangles with a depth buffer, see-through boxes, lines,
// a 5x7 font) and a PNG writer, for the hitbox instrument's overlays and maps (docs/hitboxes.md).
import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Canvas {
  constructor(w, h, bg = [24, 26, 30]) {
    this.w = w;
    this.h = h;
    this.rgb = new Uint8ClampedArray(w * h * 3);
    this.z = new Float32Array(w * h).fill(Infinity);
    for (let i = 0; i < w * h; i++) this.rgb.set(bg, i * 3);
  }
  px(x, y, c, a = 1) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.rgb[o] = this.rgb[o] * (1 - a) + c[0] * a;
    this.rgb[o + 1] = this.rgb[o + 1] * (1 - a) + c[1] * a;
    this.rgb[o + 2] = this.rgb[o + 2] * (1 - a) + c[2] * a;
  }
  rect(x0, y0, w, h, c, a = 1) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.px(x, y, c, a);
  }
  line2(x0, y0, x1, y1, c, a = 1, wide = 1) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      for (let d = 0; d < wide; d++) for (let e = 0; e < wide; e++) this.px(x + d, y + e, c, a);
    }
  }
  disc(x, y, r, c, a = 1) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) this.px(x + dx, y + dy, c, a);
  }
  text(s, x, y, c = [235, 235, 235], scale = 2, bg = null) {
    s = String(s);
    if (bg) this.rect(x - 2, y - 2, s.length * 6 * scale + 3, 7 * scale + 4, bg, 0.75);
    for (let i = 0; i < s.length; i++) {
      const g = FONT[s[i].toUpperCase()] || FONT['?'];
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r] & (16 >> q)) this.rect(x + (i * 6 + q) * scale, y + r * scale, scale, scale, c);
    }
  }
  // a triangle of screen points [x, y, depth], flat colour, depth tested (a: see-through, and then it writes no depth)
  tri(p0, p1, p2, c, a = 1, write = true) {
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))), maxX = Math.min(this.w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))), maxY = Math.min(this.h - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    const d = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (Math.abs(d) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5 - p0[0], py = y + 0.5 - p0[1];
        const s = (px * (p2[1] - p0[1]) - (p2[0] - p0[0]) * py) / d;
        const t = ((p1[0] - p0[0]) * py - px * (p1[1] - p0[1])) / d;
        if (s < 0 || t < 0 || s + t > 1) continue;
        const z = p0[2] + (p1[2] - p0[2]) * s + (p2[2] - p0[2]) * t;
        const k = y * this.w + x;
        if (z >= this.z[k]) continue;
        if (write && a >= 1) this.z[k] = z;
        this.px(x, y, c, a);
      }
    }
  }
  // a line in space: full where it is in front of what is drawn, faint where it is behind
  line3(p0, p1, c, wide = 1) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1]))));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const x = (p0[0] + (p1[0] - p0[0]) * f) | 0, y = (p0[1] + (p1[1] - p0[1]) * f) | 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const z = p0[2] + (p1[2] - p0[2]) * f;
      const front = z < this.z[y * this.w + x] + 0.02;
      for (let d = 0; d < wide; d++) for (let e = 0; e < wide; e++) this.px(x + d, y + e, c, front ? 1 : 0.28);
    }
  }
  blit(src, x0, y0) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      if (x + x0 >= this.w || y + y0 >= this.h) continue;
      const o = ((y + y0) * this.w + x + x0) * 3, s = (y * src.w + x) * 3;
      this.rgb[o] = src.rgb[s];
      this.rgb[o + 1] = src.rgb[s + 1];
      this.rgb[o + 2] = src.rgb[s + 2];
    }
  }
  save(file) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, png(this.w, this.h, this.rgb));
  }
}

/**
 * A camera looking at `at` from the direction (yaw about y, pitch down), orthographic, `span` metres across the
 * canvas' smaller side. Returns p(x, y, z) -> [sx, sy, depth].
 */
export function ortho(cv, at, yaw, pitch, span) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // camera axes: right r, up u, forward f (into the scene)
  const f = [-sy * cp, -sp, -cy * cp];
  const r = [cy, 0, -sy];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const k = Math.min(cv.w, cv.h) / span;
  const p = (x, y, z) => {
    const dx = x - at[0], dy = y - at[1], dz = z - at[2];
    return [cv.w / 2 + (dx * r[0] + dy * r[1] + dz * r[2]) * k, cv.h / 2 - (dx * u[0] + dy * u[1] + dz * u[2]) * k, dx * f[0] + dy * f[1] + dz * f[2]];
  };
  p.f = f;
  return p;
}

const SUN = (() => {
  const v = [0.45, 0.8, 0.35];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();
// a model's triangles (lib.js modelOf), lit from above
export function drawModel(cv, cam, model, skip = null) {
  const P = model.pos;
  for (let t = 0; t < P.length; t += 9) {
    const name = model.mat[t / 9];
    if (skip && skip(name)) continue;
    const ax = P[t + 3] - P[t], ay = P[t + 4] - P[t + 1], az = P[t + 5] - P[t + 2];
    const bx = P[t + 6] - P[t], by = P[t + 7] - P[t + 1], bz = P[t + 8] - P[t + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (nx * cam.f[0] + ny * cam.f[1] + nz * cam.f[2] > 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const lit = 0.38 + 0.62 * Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
    const g = (x) => Math.min(255, 255 * Math.pow(Math.max(0, x) * lit, 1 / 2.2) * 1.15 + 14);
    const o = (t / 9) * 3;
    cv.tri(cam(P[t], P[t + 1], P[t + 2]), cam(P[t + 3], P[t + 4], P[t + 5]), cam(P[t + 6], P[t + 7], P[t + 8]), [g(model.rgb[o]), g(model.rgb[o + 1]), g(model.rgb[o + 2])]);
  }
}

// colliders (lib.js collidersOf) over what is drawn: tinted faces and their edges
export function drawColliders(cv, cam, cols, color = [255, 70, 60], alpha = 0.22) {
  const quads = [];
  const edges = [];
  for (const c of cols) {
    let ring;
    if (c.box) ring = [[c.x0, c.z0], [c.x1, c.z0], [c.x1, c.z1], [c.x0, c.z1]];
    else {
      ring = [];
      for (let i = 0; i < 16; i++) ring.push([c.cx + Math.cos((i / 16) * Math.PI * 2) * c.r, c.cz + Math.sin((i / 16) * Math.PI * 2) * c.r]);
    }
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
      quads.push([[ax, c.y0, az], [bx, c.y0, bz], [bx, c.y1, bz], [ax, c.y1, az]]);
      edges.push([[ax, c.y0, az], [bx, c.y0, bz]], [[ax, c.y1, az], [bx, c.y1, bz]]);
      if (c.box || i % 4 === 0) edges.push([[ax, c.y0, az], [ax, c.y1, az]]);
    }
    for (const y of [c.y0, c.y1]) for (let i = 1; i < n - 1; i++) quads.push([[ring[0][0], y, ring[0][1]], [ring[i][0], y, ring[i][1]], [ring[i + 1][0], y, ring[i + 1][1]], null]);
  }
  for (const q of quads) {
    const a = cam(...q[0]), b = cam(...q[1]), c = cam(...q[2]);
    cv.tri(a, b, c, color, alpha, false);
    if (q[3]) cv.tri(a, c, cam(...q[3]), color, alpha, false);
  }
  for (const [a, b] of edges) cv.line3(cam(...a), cam(...b), color, 2);
}

// ---------------------------------------------------------------- PNG
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// 5x7 glyphs, a row a number (bit 4 the left pixel)
const G = (s) => s.split('/').map((r) => parseInt(r, 2));
const FONT = {
  ' ': G('0/0/0/0/0/0/0'), '?': G('01110/10001/00010/00100/00100/00000/00100'), '.': G('0/0/0/0/0/01100/01100'), ',': G('0/0/0/0/01100/00100/01000'),
  ':': G('0/01100/01100/0/01100/01100/0'), '-': G('0/0/0/11111/0/0/0'), '_': G('0/0/0/0/0/0/11111'), '+': G('0/00100/00100/11111/00100/00100/0'),
  '/': G('00001/00010/00010/00100/01000/01000/10000'), '(': G('00010/00100/01000/01000/01000/00100/00010'), ')': G('01000/00100/00010/00010/00010/00100/01000'),
  '=': G('0/0/11111/0/11111/0/0'), '%': G('11001/11010/00010/00100/01000/01011/10011'), '>': G('01000/00100/00010/00001/00010/00100/01000'), '<': G('00010/00100/01000/10000/01000/00100/00010'),
  '|': G('00100/00100/00100/00100/00100/00100/00100'), "'": G('00100/00100/0/0/0/0/0'), '#': G('01010/01010/11111/01010/11111/01010/01010'),
  0: G('01110/10001/10011/10101/11001/10001/01110'), 1: G('00100/01100/00100/00100/00100/00100/01110'), 2: G('01110/10001/00001/00010/00100/01000/11111'),
  3: G('11110/00001/00001/01110/00001/00001/11110'), 4: G('00010/00110/01010/10010/11111/00010/00010'), 5: G('11111/10000/11110/00001/00001/10001/01110'),
  6: G('00110/01000/10000/11110/10001/10001/01110'), 7: G('11111/00001/00010/00100/01000/01000/01000'), 8: G('01110/10001/10001/01110/10001/10001/01110'),
  9: G('01110/10001/10001/01111/00001/00010/01100'),
  A: G('01110/10001/10001/11111/10001/10001/10001'), B: G('11110/10001/10001/11110/10001/10001/11110'), C: G('01110/10001/10000/10000/10000/10001/01110'),
  D: G('11100/10010/10001/10001/10001/10010/11100'), E: G('11111/10000/10000/11110/10000/10000/11111'), F: G('11111/10000/10000/11110/10000/10000/10000'),
  G: G('01110/10001/10000/10111/10001/10001/01111'), H: G('10001/10001/10001/11111/10001/10001/10001'), I: G('01110/00100/00100/00100/00100/00100/01110'),
  J: G('00111/00010/00010/00010/00010/10010/01100'), K: G('10001/10010/10100/11000/10100/10010/10001'), L: G('10000/10000/10000/10000/10000/10000/11111'),
  M: G('10001/11011/10101/10101/10001/10001/10001'), N: G('10001/11001/10101/10011/10001/10001/10001'), O: G('01110/10001/10001/10001/10001/10001/01110'),
  P: G('11110/10001/10001/11110/10000/10000/10000'), Q: G('01110/10001/10001/10001/10101/10010/01101'), R: G('11110/10001/10001/11110/10100/10010/10001'),
  S: G('01111/10000/10000/01110/00001/00001/11110'), T: G('11111/00100/00100/00100/00100/00100/00100'), U: G('10001/10001/10001/10001/10001/10001/01110'),
  V: G('10001/10001/10001/10001/10001/01010/00100'), W: G('10001/10001/10001/10101/10101/11011/10001'), X: G('10001/10001/01010/00100/01010/10001/10001'),
  Y: G('10001/10001/01010/00100/00100/00100/00100'), Z: G('11111/00001/00010/00100/01000/10000/11111'),
};

// a PNG read back into a Canvas (8 bits a channel, RGB or RGBA, not interlaced: what a screenshot is)
export function readPng(buf) {
  let o = 8, w = 0, h = 0, type = 2;
  const parts = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), tag = buf.toString('ascii', o + 4, o + 8);
    if (tag === 'IHDR') {
      w = buf.readUInt32BE(o + 8);
      h = buf.readUInt32BE(o + 12);
      type = buf[o + 17];
      if (buf[o + 16] !== 8 || (type !== 2 && type !== 6) || buf[o + 20]) throw new Error('readPng: an 8-bit RGB or RGBA image that is not interlaced, please');
    } else if (tag === 'IDAT') parts.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(parts));
  const line = w * bpp;
  const cur = new Uint8Array(line), prev = new Uint8Array(line);
  const cv = new Canvas(w, h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (line + 1)];
    for (let i = 0; i < line; i++) {
      const x = raw[y * (line + 1) + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = x;
      if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      cv.rgb[(y * w + x) * 3] = cur[x * bpp];
      cv.rgb[(y * w + x) * 3 + 1] = cur[x * bpp + 1];
      cv.rgb[(y * w + x) * 3 + 2] = cur[x * bpp + 2];
    }
    prev.set(cur);
  }
  return cv;
}
// two pictures side by side under a title, each with its tag (BEFORE | AFTER)
export function pair(left, right, title, tags = ['BEFORE', 'AFTER']) {
  const cv = new Canvas(left.w + right.w + 6, Math.max(left.h, right.h) + 34, [0, 0, 0]);
  cv.blit(left, 0, 34);
  cv.blit(right, left.w + 6, 34);
  cv.text(title, 8, 9, [255, 255, 255], 2);
  cv.text(tags[0], 10, 44, [255, 110, 100], 3, [0, 0, 0]);
  cv.text(tags[1], left.w + 16, 44, [110, 240, 140], 3, [0, 0, 0]);
  return cv;
}
