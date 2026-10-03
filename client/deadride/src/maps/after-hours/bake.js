// AFTER HOURS — canvas-baked tileable materials. The GPU `synth` compiles a whole new uber-shader for every custom-GLSL pattern (0.3 – 1.5 s each on this box,
// 5 of them cost ~8 s of the map build), so the special surfaces (awning stripes, glowing grid floor, star-field canopy, terrazzo) are painted with the 2D canvas
// instead: ~10-40 ms each, no shader compile, textures tile seamlessly (blobs are drawn at wrap offsets) and use real-world UV metres like the synth ones.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { makeRng } from '../../core/util.js';

const TAU = Math.PI * 2;
const css = (hex, k = 1) => { const c = new THREE.Color(hex); c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k); const s = c.clone().convertLinearToSRGB(); return `rgb(${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)})`; };
/** tiling texture: `size` px covers `tileM` metres */
export function tileTex(size, tileM, draw, { srgb = true, aniso = 8 } = {}) {
  const t = canvasTexture(size, size, draw, { srgb, repeat: true, aniso }); t.repeat.set(1 / tileM, 1 / tileM); return t;
}
/** run `f(dx, dy)` at the 9 wrap offsets so anything drawn near an edge continues on the opposite side */
const wrap = (w, h, f) => { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) f(dx, dy); };
/** soft round blob (radial gradient) that tiles */
const blob = (c, w, h, x, y, r, rgb, a) => wrap(w, h, (dx, dy) => { const X = x + dx, Y = y + dy; if (X + r < 0 || X - r > w || Y + r < 0 || Y - r > h) return; const g = c.createRadialGradient(X, Y, 0, X, Y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.fillRect(X - r, Y - r, r * 2, r * 2); });

/** striped canvas awning / canopy fabric: n stripe pairs across the tile, woven texture, sun-fade and grime streaks */
export function stripeMat(B, name, { c0, c1, n = 6, tile = 1.5, size = 512, rough = 0.82, side = THREE.FrontSide }) {
  const map = tileTex(size, tile, (c, w, h) => {
    const sw = w / n; for (let i = 0; i < n; i++) { c.fillStyle = css(c0); c.fillRect(i * sw, 0, sw / 2, h); c.fillStyle = css(c1); c.fillRect(i * sw + sw / 2, 0, sw / 2, h); }
    const r = makeRng(n * 31 + (c0 & 255)); c.globalAlpha = 0.12; c.fillStyle = '#000'; for (let x = 0; x < w; x += 3) c.fillRect(x, 0, 1, h); for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);   // weave
    c.globalAlpha = 0.08; for (let i = 0; i < 900; i++) { c.fillStyle = r() < 0.5 ? '#000' : '#fff'; c.fillRect(r() * w, r() * h, 1 + r() * 2, 2 + r() * 10); }
    c.globalAlpha = 0.16; for (let i = 0; i < 40; i++) { c.fillStyle = '#1a120a'; const x = r() * w; c.fillRect(x, 0, 1 + r() * 4, h * (0.2 + r() * 0.6)); }                                  // rain streaks
    c.globalAlpha = 1; blob(c, w, h, w * 0.3, h * 0.6, w * 0.5, '40,30,20', 0.10); blob(c, w, h, w * 0.85, h * 0.2, w * 0.4, '250,240,220', 0.06);
  });
  return B.m(name, std({ map, roughness: rough, metalness: 0, side }));
}

/** glowing floor grid: dark glossy navy with 1 m cyan-neon cells (16 % of the cells are dead) and a faint 25 cm sub-grid; 4 m tile */
export function gridFloorMat(B, name = 'gridFloor', { neon = 0x30e8ff, tile = 4, size = 1024, intensity = 2.0 } = {}) {
  const r = makeRng(41); const cells = 4, cs = size / cells; const state = []; for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) { const ph = r(); state.push(ph < 0.16 ? 0 : ph > 0.35 ? 1 : 0.5); }
  const map = tileTex(size, tile, (c, w, h) => {
    c.fillStyle = css(0x101d34); c.fillRect(0, 0, w, h); const q = makeRng(7); for (let i = 0; i < 260; i++) blob(c, w, h, q() * w, q() * h, 30 + q() * 90, q() < 0.5 ? '40,66,110' : '8,12,24', 0.10 + q() * 0.08);
    c.strokeStyle = 'rgba(0,0,0,0.42)'; c.lineWidth = 8; for (let k = 0; k <= cells; k++) { c.beginPath(); c.moveTo(k * cs, 0); c.lineTo(k * cs, h); c.moveTo(0, k * cs); c.lineTo(w, k * cs); c.stroke(); }
  });
  const emis = tileTex(size, tile, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) { const k = state[j * cells + i]; if (!k) continue; const x = i * cs, y = j * cs;
      c.strokeStyle = css(neon, k); c.lineWidth = 3; for (let f = 1; f < 4; f++) { c.beginPath(); c.moveTo(x + f * cs / 4, y); c.lineTo(x + f * cs / 4, y + cs); c.moveTo(x, y + f * cs / 4); c.lineTo(x + cs, y + f * cs / 4); c.stroke(); }   // sub-grid
      c.strokeStyle = css(neon, k); c.lineWidth = 9; c.beginPath(); c.rect(x + 4, y + 4, cs - 8, cs - 8); c.stroke(); c.lineWidth = 5; c.strokeStyle = css(neon, k * 1.25); c.beginPath(); c.rect(x + 4, y + 4, cs - 8, cs - 8); c.stroke(); }
  });
  return B.m(name, std({ map, emissiveMap: emis, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.2, metalness: 0.05, refl: 0.7 }));
}

/** painted night sky with a soft nebula and sparse multi-size stars; 12 m tile */
export function starCanopyMat(B, name = 'starCanopy', { tile = 12, size = 1024, intensity = 3.9 } = {}) {
  const r = makeRng(53);
  const stars = []; for (let i = 0; i < 64; i++) stars.push({ x: r() * size, y: r() * size, s: i < 6 ? 1 : i < 30 ? 0.6 : 0.36, tint: r() });
  const map = tileTex(size, tile, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, css(0x050a1a)); g.addColorStop(1, css(0x0e1a38)); c.fillStyle = g; c.fillRect(0, 0, w, h);
    const q = makeRng(9); for (let i = 0; i < 70; i++) { const teal = q() < 0.55; blob(c, w, h, q() * w, q() * h, 60 + q() * 160, teal ? '20,90,120' : '110,30,120', 0.05 + q() * 0.07); }
  });
  const emis = tileTex(size, tile, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h); const q = makeRng(9); for (let i = 0; i < 70; i++) { const teal = q() < 0.55; blob(c, w, h, q() * w, q() * h, 60 + q() * 160, teal ? '10,55,78' : '70,18,80', 0.05 + q() * 0.07); q(); }
    for (const s of stars) { const col = s.tint < 0.5 ? '190,225,255' : '255,225,245'; blob(c, w, h, s.x, s.y, 16 * s.s + 4, col, 0.55); blob(c, w, h, s.x, s.y, 6 * s.s + 1.6, '255,255,255', 1); }
  });
  return B.m(name, std({ map, emissiveMap: emis, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.35, metalness: 0 }));
}

/** 1960s terrazzo: dark navy binder with irregular teal / mauve / pale marble chips (3 – 6 cm) in three scales; 3 m tile; wet-look patches come from the core `wet` patch */
export function terrazzoMat(B, name = 'terrazzo', { tile = 3, size = 1024 } = {}) {
  const map = tileTex(size, tile, (c, w, h) => {
    c.fillStyle = css(0x16233c); c.fillRect(0, 0, w, h); const q = makeRng(17); for (let i = 0; i < 140; i++) blob(c, w, h, q() * w, q() * h, 20 + q() * 70, q() < 0.5 ? '40,62,96' : '6,10,20', 0.10 + q() * 0.07);
    const pal = [0x5f8fa0, 0x9a6e94, 0xaebbc6]; const r = makeRng(23);
    for (const [sc, dens] of [[15, 0.5], [26, 0.5], [37, 0.5]]) {
      const cell = w / sc; for (let j = 0; j < sc; j++) for (let i = 0; i < sc; i++) {
        if (r() > dens) continue; const id = r(); const col = id < 0.72 ? pal[0] : id < 0.86 ? pal[1] : pal[2]; const k = 0.5 + 0.45 * r();
        const cx = (i + 0.3 + r() * 0.4) * cell, cy = (j + 0.3 + r() * 0.4) * cell, rad = cell * (0.16 + r() * 0.16) * 1.1; const nv = 5 + Math.floor(r() * 3), rot = r() * TAU;
        c.fillStyle = css(col, k * 1.3); c.beginPath(); for (let v = 0; v < nv; v++) { const a = rot + (v / nv) * TAU, rr = rad * (0.7 + r() * 0.5); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (v) c.lineTo(x, y); else c.moveTo(x, y); } c.closePath(); c.fill();
      }
    }
  });
  return B.m(name, std({ map, roughness: 0.24, metalness: 0, wet: true, breakup: 0.5, refl: 0.55 }));
}
