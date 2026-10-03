// Small canvas helpers: signs, painted lettering, posters, noise textures. Everything drawn in code.
import * as THREE from 'three';
import { std } from './mats.js';

export function canvasTexture(w, h, draw, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
/** Sign material. opts: {w,h (px), bg, fg, text|lines[], font, border, glow(emissive intensity), rough, metal, weather(0..1 grime), stripes} */
export function signMaterial(o = {}) {
  const w = o.w || 512, h = o.h || 256, lines = o.lines || [o.text || 'SIGN'];
  const tex = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = o.bg || '#1b3a5a'; ctx.fillRect(0, 0, w, h);
    if (o.stripes) { ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = '#fff'; for (let i = -h; i < w; i += 24) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 12, 0); ctx.lineTo(i + 12 + h, h); ctx.lineTo(i + h, h); ctx.fill(); } ctx.restore(); }
    if (o.border !== false) { ctx.strokeStyle = o.fg || '#f2f2f2'; ctx.lineWidth = Math.round(h * 0.035); ctx.strokeRect(ctx.lineWidth * 1.6, ctx.lineWidth * 1.6, w - ctx.lineWidth * 3.2, h - ctx.lineWidth * 3.2); }
    ctx.fillStyle = o.fg || '#f2f2f2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const n = lines.length, fs = o.fontSize || Math.floor(Math.min(h / (n + 0.6), w / (Math.max(...lines.map((l) => l.length)) * 0.62)));
    ctx.font = `${o.weight || '700'} ${fs}px ${o.font || 'Impact, "Arial Narrow", Arial, sans-serif'}`;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (n - 1) / 2) * fs * 1.08));
    if (o.weather) { const r = Math.random; ctx.globalAlpha = 0.5 * o.weather; for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(20,14,8,${r() * 0.5})`; ctx.fillRect(r() * w, r() * h, r() * 5 + 1, r() * 30 + 2); } ctx.globalAlpha = 1; for (let i = 0; i < 90 * o.weather; i++) { ctx.fillStyle = `rgba(${120 + r() * 60},${50 + r() * 30},20,${r() * 0.45})`; ctx.beginPath(); ctx.arc(r() * w, r() * h, r() * 9 + 2, 0, 7); ctx.fill(); } }
  });
  const emissive = o.glow ? tex : null;
  const m = std({ map: tex, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.1, emissiveMap: emissive, emissive: o.glow ? 0xffffff : 0x000000, emissiveIntensity: o.glow || 0, key: 'sign' });
  return m;
}
export function noiseCanvas(w, h, fn) { return canvasTexture(w, h, (ctx) => { const img = ctx.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fn(x / w, y / h); const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255; img.data[i + 3] = 255; } ctx.putImageData(img, 0, 0); }, { srgb: false, repeat: true }); }
