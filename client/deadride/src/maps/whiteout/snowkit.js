// Detail kit: textured warm windows (atlas of curtains / muntins / frost), draped roof snow with a rolled eave, lamp light cones, ground spindrift.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { makeBeam } from '../../core/glow.js';
import { makeRng, noise2, clamp, smoothstep } from '../../core/util.js';

// ------------------------------------------------------------------ window atlas: 4 lit interiors in a 1024x256 canvas
const _winTex = {};
export function windowAtlas(theme = 'warm') {
  if (_winTex[theme]) return _winTex[theme]; const W = 1024, Hh = 256, c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d'); const rng = makeRng(17);
  if (theme !== 'warm') return (_winTex[theme] = coolAtlas(c, g, theme, rng));
  for (let k = 0; k < 4; k++) {
    const x0 = k * 256; g.save(); g.beginPath(); g.rect(x0, 0, 256, 256); g.clip();
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, ['#ffd58a', '#ffe1a6', '#ffc878', '#ffdca0'][k]); gr.addColorStop(1, ['#ff9a3c', '#ffb050', '#f58a30', '#ffa444'][k]); g.fillStyle = gr; g.fillRect(x0, 0, 256, 256);
    const hs = g.createRadialGradient(x0 + 60 + rng() * 140, 60 + rng() * 60, 5, x0 + 128, 128, 170); hs.addColorStop(0, 'rgba(255,250,220,0.9)'); hs.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = hs; g.fillRect(x0, 0, 256, 256);
    if (k !== 2) { // curtains: darker warm drapes with folds
      for (const side of [0, 1]) { const cw = 46 + rng() * 22, bx = side ? x0 + 256 - cw : x0; const cg = g.createLinearGradient(bx, 0, bx + cw, 0); cg.addColorStop(0, 'rgba(120,52,20,0.85)'); cg.addColorStop(0.5, 'rgba(170,82,34,0.75)'); cg.addColorStop(1, 'rgba(110,46,18,0.85)'); g.fillStyle = cg; g.beginPath(); g.moveTo(bx, 0); g.lineTo(bx + cw, 0); g.lineTo(bx + cw * (side ? 0.7 : 1.0), 256); g.lineTo(bx + cw * (side ? 0 : 0.3), 256); g.closePath(); g.fill();
        for (let f = 1; f < 5; f++) { g.strokeStyle = 'rgba(70,28,10,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx + cw * f / 5, 0); g.lineTo(bx + cw * f / 5 + (side ? -5 : 5), 256); g.stroke(); } }
    }
    if (k === 2 || k === 3) { g.fillStyle = 'rgba(60,24,8,0.85)'; g.beginPath(); g.ellipse(x0 + 70, 226, 26, 18, 0, 0, 7); g.fill(); g.fillRect(x0 + 62, 170, 16, 50); g.beginPath(); g.ellipse(x0 + 70, 160, 34, 26, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(70,30,10,0.9)'; g.fillRect(x0 + 168, 150, 8, 106); g.beginPath(); g.moveTo(x0 + 150, 152); g.lineTo(x0 + 194, 152); g.lineTo(x0 + 184, 118); g.lineTo(x0 + 160, 118); g.closePath(); g.fill(); }
    // muntins (dark timber): 2x2 grid for k=0,1; 3x2 for k=2; 2x3 for k=3
    g.fillStyle = '#231206'; const vs = k === 2 ? 2 : 1, hz = k === 3 ? 2 : 1; for (let i = 1; i <= vs; i++) g.fillRect(x0 + 256 * i / (vs + 1) - 5, 0, 10, 256); for (let i = 1; i <= hz; i++) g.fillRect(x0, 256 * i / (hz + 1) - 5, 256, 10);
    g.lineWidth = 14; g.strokeStyle = '#1b0e05'; g.strokeRect(x0 + 7, 7, 242, 242);
    // frost creeping from the corners / bottom edge
    for (let i = 0; i < 260; i++) { const cx = x0 + rng() * 256, cy = rng() < 0.6 ? 256 - Math.pow(rng(), 2.2) * 90 : rng() * 256; const near = Math.min(Math.min(cx - x0, x0 + 256 - cx), Math.min(cy, 256 - cy)); if (near > 40 && rng() < 0.85) continue; g.fillStyle = `rgba(235,244,255,${0.12 + rng() * 0.3})`; g.beginPath(); g.arc(cx, cy, 2 + rng() * 9, 0, 7); g.fill(); }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; _winTex[theme] = t; return t;
}
function coolAtlas(c, g, theme, rng) {
  const pal = theme === 'dim' ? { top: '#9fb4ff', bot: '#5f7ad8', mull: '#0c1020', lamp: 'rgba(230,240,255,0.9)' } : { top: '#f1fff8', bot: '#bfe2d4', mull: '#1a2622', lamp: 'rgba(255,255,255,0.95)' };
  for (let k = 0; k < 4; k++) { const x0 = k * 256; g.save(); g.beginPath(); g.rect(x0, 0, 256, 256); g.clip();
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, pal.top); gr.addColorStop(1, pal.bot); g.fillStyle = gr; g.fillRect(x0, 0, 256, 256);
    // pendant lamps + ceiling strip
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(x0, 0, 256, 18); for (let i = 0; i < 3; i++) { const lx = x0 + 40 + i * 85 + rng() * 14; g.fillStyle = pal.lamp; g.beginPath(); g.arc(lx, 52, 13, 0, 7); g.fill(); g.strokeStyle = 'rgba(30,40,36,0.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(lx, 18); g.lineTo(lx, 40); g.stroke(); }
    // tables + chairs silhouettes
    g.fillStyle = 'rgba(28,38,34,0.85)'; for (let i = 0; i < 3; i++) { const tx = x0 + 22 + i * 82 + rng() * 10, ty = 176 + rng() * 10; g.fillRect(tx, ty, 50, 7); g.fillRect(tx + 22, ty + 7, 6, 44); g.fillRect(tx - 12, ty + 12, 12, 40); g.fillRect(tx + 50, ty + 12, 12, 40); g.fillRect(tx - 12, ty + 4, 6, 28); g.fillRect(tx + 56, ty + 4, 6, 28); }
    if (k % 2) { g.fillStyle = 'rgba(28,38,34,0.8)'; g.beginPath(); g.ellipse(x0 + 128, 122, 9, 12, 0, 0, 7); g.fill(); g.fillRect(x0 + 120, 130, 16, 40); }
    g.fillStyle = pal.mull; g.fillRect(x0, 0, 256, 6); g.fillRect(x0, 250, 256, 6); g.fillRect(x0 + 125, 0, 6, 256); g.fillRect(x0, 0, 6, 256); g.fillRect(x0 + 250, 0, 6, 256);
    for (let i = 0; i < 300; i++) { const cx = x0 + rng() * 256, cy = rng() < 0.55 ? 256 - Math.pow(rng(), 2.0) * 110 : rng() * 256; const near = Math.min(Math.min(cx - x0, x0 + 256 - cx), Math.min(cy, 256 - cy)); if (near > 46 && rng() < 0.85) continue; g.fillStyle = `rgba(240,250,255,${0.15 + rng() * 0.35})`; g.beginPath(); g.arc(cx, cy, 2 + rng() * 10, 0, 7); g.fill(); }
    g.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// ------------------------------------------------------------------ interior mapping: every lit window is a real little room seen with parallax
const _roomTex = {};
/** 1024x256 atlas of 4 room back walls (one per window cell): wall, furniture silhouettes, lamp glow, pictures. theme 'warm' (chalets) | 'cool' (restaurant/hall) | 'dim' (observatory) */
export function roomAtlas(theme = 'warm') {
  if (_roomTex[theme]) return _roomTex[theme]; const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d'); const rng = makeRng(31 + theme.length * 7);
  const pal = theme === 'cool' ? { w0: '#e9f6f0', w1: '#b7d6cb', dark: 'rgba(28,44,40,0.85)', lamp: 'rgba(255,255,255,0.95)', pic: ['#5a8fa8', '#c8a060', '#8ab070'] }
    : theme === 'dim' ? { w0: '#8fa0d8', w1: '#4a5a9a', dark: 'rgba(12,16,40,0.85)', lamp: 'rgba(225,235,255,0.9)', pic: ['#c8d4ff', '#6a7ac0', '#a0b0e8'] }
    : { w0: '#ffd08a', w1: '#e0873a', dark: 'rgba(52,24,10,0.88)', lamp: 'rgba(255,248,214,0.95)', pic: ['#8a3a2a', '#3a5a7a', '#c8a050', '#5a7a4a'] };
  for (let k = 0; k < 4; k++) {
    const x0 = k * 256; g.save(); g.beginPath(); g.rect(x0, 0, 256, 256); g.clip();
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, pal.w0); gr.addColorStop(1, pal.w1); g.fillStyle = gr; g.fillRect(x0, 0, 256, 256);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + rng() * 0.05})`; g.fillRect(x0 + rng() * 256, 0, 2 + rng() * 6, 256); }                            // wallpaper stripes
    const lx = x0 + 60 + rng() * 140, ly = 40 + rng() * 40; const hs = g.createRadialGradient(lx, ly, 4, lx, ly, 150); hs.addColorStop(0, pal.lamp); hs.addColorStop(1, 'rgba(255,220,160,0)'); g.fillStyle = hs; g.fillRect(x0, 0, 256, 256);
    for (let n = 0; n < 2 + (k % 2); n++) { const fw = 34 + rng() * 40, fh = 30 + rng() * 40, fx = x0 + 14 + rng() * (228 - fw), fy = 20 + rng() * 60; g.fillStyle = pal.dark; g.fillRect(fx - 3, fy - 3, fw + 6, fh + 6); g.fillStyle = pal.pic[(rng() * pal.pic.length) | 0]; g.fillRect(fx, fy, fw, fh); }   // framed pictures
    g.fillStyle = pal.dark; if (k % 2 === 0) { g.fillRect(x0 + 8, 92, 70, 164); for (let b = 0; b < 26; b++) { g.fillStyle = `hsl(${(rng() * 360) | 0},45%,${30 + rng() * 25}%)`; g.fillRect(x0 + 12 + (b % 6) * 10.5, 100 + Math.floor(b / 6) * 22, 8, 18); } }    // bookshelf
    else { g.fillRect(x0 + 150, 120, 96, 136); g.fillStyle = pal.lamp; g.fillRect(x0 + 168, 132, 22, 30); }                                                                  // cabinet with a lit shelf
    g.fillStyle = pal.dark; g.fillRect(x0 + 84, 196, 84, 8); g.fillRect(x0 + 92, 204, 6, 52); g.fillRect(x0 + 154, 204, 6, 52); g.beginPath(); g.ellipse(x0 + 126, 186, 14, 8, 0, 0, 7); g.fill();  // table + lamp
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return (_roomTex[theme] = t);
}
const ROOM_FRAG = /* glsl */`
{
  vec3 Nw = normalize(vWN); vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw)); vec3 Vd = normalize(vWPos - cameraPosition);
  float cellK = floor(vMapUv.x * 4.0); vec2 cuv = vec2(fract(vMapUv.x * 4.0), clamp(vMapUv.y, 0.0, 1.0));
  const float WW = 1.3, HH = 1.4, RW = 3.5, RH = 2.7, DD = 3.3, X0 = (RW - WW) * 0.5, Y0 = 0.95;
  vec3 rd = vec3(dot(Vd, Tw), Vd.y, -dot(Vd, Nw)); rd.z = max(rd.z, 0.05); vec3 ro = vec3(X0 + cuv.x * WW, Y0 + cuv.y * HH, 0.0);
  float tb = (DD - ro.z) / rd.z, ts = rd.x > 0.0 ? (RW - ro.x) / rd.x : (0.0 - ro.x) / rd.x, tv = rd.y > 0.0 ? (RH - ro.y) / rd.y : (0.0 - ro.y) / rd.y; float tm = min(tb, min(ts, tv));
  vec3 hp = ro + rd * tm; float h = fract(sin(dot(floor(vWPos.xz * 0.9 + vWPos.y * 0.31), vec2(12.9898, 78.233)) + cellK * 3.1) * 43758.5453);
  vec3 col; if (tm == tb) { col = texture2D(map, vec2((cellK + clamp(hp.x / RW, 0.01, 0.99)) * 0.25, clamp(hp.y / RH, 0.0, 1.0))).rgb; }
  else if (tm == tv) { col = rd.y > 0.0 ? vec3(0.86, 0.82, 0.74) : vec3(0.42, 0.27, 0.15) * (0.7 + 0.3 * step(0.5, fract(hp.z * 2.4 + h))); }
  else { col = mix(vec3(0.88, 0.62, 0.38), vec3(0.7, 0.78, 0.86), step(0.5, h * 2.0 - floor(h * 2.0) + 0.5 * step(0.7, h))) * (0.8 + 0.2 * sin(hp.z * 9.0)); }
  vec3 lampP = vec3(RW * 0.5 + (h - 0.5) * 1.0, RH - 0.35, DD * 0.42); float lit = 0.32 + 1.25 / (1.0 + 0.55 * dot(hp - lampP, hp - lampP)); lit *= 0.65 + 0.55 * step(0.16, fract(h * 7.3 + 0.37));   // some rooms are dimmer
  vec3 room = col * lit;
  float edge = min(min(cuv.x, 1.0 - cuv.x), min(cuv.y, 1.0 - cuv.y));
  float curt = smoothstep(0.26 + 0.1 * h, 0.12, min(cuv.x, 1.0 - cuv.x)) * step(0.35, fract(h * 3.7)); vec3 curCol = mix(vec3(0.62, 0.16, 0.1), vec3(0.75, 0.68, 0.5), step(0.5, fract(h * 5.1))) * (0.7 + 0.3 * sin(cuv.x * 70.0));
  room = mix(room, curCol * lit * 0.9, curt * 0.92);
  float frost = smoothstep(0.2, 0.0, edge + (zvn3(vWPos * 6.0) - 0.5) * 0.12) * 0.55 + smoothstep(0.35, 0.0, cuv.y) * 0.16; room = mix(room, vec3(0.86, 0.92, 1.0) * lit * 0.9, clamp(frost, 0.0, 0.85));
  float bar = max(step(abs(cuv.x - 0.5), 0.017), step(abs(cuv.y - 0.55), 0.017)) + step(edge, 0.045); bar = clamp(bar, 0.0, 1.0);
  totalEmissiveRadiance = mix(room * emissive.r, vec3(0.0), bar); diffuseColor.rgb = mix(vec3(0.02), vec3(0.16, 0.1, 0.06), bar);
}`;
export function windowMaterial(intensity = 3.2, theme = 'warm') {
  const t = roomAtlas(theme); return std({ color: 0x140a04, map: t, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.25, metalness: 0, frag: ROOM_FRAG });
}
/** window quad with an atlas cell k (0..3); n = outward normal (x,z); c = centre [x,y,z]; w,h metres */
export function windowQuad(B, mat, c, n, w, h, k) {
  const q = Math.atan2(n[0], n[1]); const hx = w / 2, hy = h / 2; const u0 = k * 0.25 + 0.002, u1 = (k + 1) * 0.25 - 0.002;
  const raw = { p: new Float32Array([-hx, -hy, 0, hx, -hy, 0, hx, hy, 0, -hx, hy, 0]), n: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), u: new Float32Array([u0, 0, u1, 0, u1, 1, u0, 1]), i: new Uint32Array([0, 1, 2, 0, 2, 3]) };
  B.addRaw(raw, B.matrix(c, q), mat, { cast: false, recv: false });
}

// ------------------------------------------------------------------ draped roof snow: a displaced grid over each roof plane with a rolled, sagging eave
/** F = Frame at the building centre; ridge along u at height ridgeY; slopes fall towards +/- v; w = wall length (u), d = wall depth (v), pitch (rad), ov = eave overhang (m) */
export function roofSnow(B, mat, F, { w, d, ridgeY, pitch, ov = 1.0, seed = 1, depth = 0.34 }) {
  const hd = d / 2 + ov, len = hd / Math.cos(pitch); const W = w + 2 * ov * 0.55; const nu = Math.max(10, Math.round(W / 0.7)), ns = 12; const rng = makeRng(seed * 7 + 1);
  for (const sv of [-1, 1]) {
    const P = [], N = [], U = [], I = []; const hgt = (u, s) => { // height above the roof plane at (u along ridge, s down the slope)
      const su = s / len, eu = 1 - Math.abs(u) / (W / 2); const ridgeBulge = 0.16 * (1 - smoothstep(0, 0.3, su)); const rake = smoothstep(0, 0.12, eu);
      const n = 0.5 + 0.5 * noise2(u * 0.55 + seed * 3.3 + sv * 7, s * 0.5 + seed); let t = depth * (0.55 + 0.7 * n) * rake + ridgeBulge * rake;
      const curl = smoothstep(0.86, 1.0, su); return t * (1 - 0.6 * curl); };
    const pos = (u, s) => { const y = ridgeY - s * Math.sin(pitch) + hgt(u, s) * Math.cos(pitch) - (s > len * 0.9 ? Math.pow((s - len * 0.9) / (len * 0.1), 2) * 0.16 : 0); const v = sv * s * Math.cos(pitch) - sv * hgt(u, s) * Math.sin(pitch); return F.p(u, y, v); };
    for (let j = 0; j <= ns; j++) for (let i = 0; i <= nu; i++) { const u = (i / nu - 0.5) * W, s = len * j / ns; const p = pos(u, s); P.push(p[0], p[1], p[2]); U.push(p[0], p[2]);
      const e = 0.12, a = pos(u + e, s), b = pos(u - e, s), c = pos(u, s + e), dd = pos(u, s - e); const t1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], t2 = [c[0] - dd[0], c[1] - dd[1], c[2] - dd[2]]; let nx = t1[1] * t2[2] - t1[2] * t2[1], ny = t1[2] * t2[0] - t1[0] * t2[2], nz = t1[0] * t2[1] - t1[1] * t2[0]; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } const l = Math.hypot(nx, ny, nz) || 1; N.push(nx / l, ny / l, nz / l); }
    for (let j = 0; j < ns; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d2 = c + 1; I.push(a, c, b, b, c, d2, a, b, c, b, d2, c); }
    B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4(), mat, { cast: true, recv: true });
  }
  void rng;
}

// ------------------------------------------------------------------ lamp light cone (volumetric look in falling snow)
export function lampCone(group, pos, { len = 6, r1 = 1.7, color = 0xffb060, intensity = 0.22 } = {}) {
  const b = makeBeam({ length: len, r0: 0.12, r1, color, intensity, dust: 1, near: 1.0 }); b.position.set(pos[0], pos[1], pos[2]); b.lookAt(pos[0], pos[1] - 10, pos[2]); group.add(b); return b;
}

/** flat roof / canopy snow: heightfield with noise thickness, wind-packed edges that roll over the rim. F frame, rect u0..u1 x v0..v1 at height y (top of roof) */
export function slabSnow(B, mat, F, { u0, u1, v0, v1, y, depth = 0.4, seed = 1, curl = 0.16 }) {
  const w = u1 - u0, d = v1 - v0; const nu = Math.max(8, Math.round(w / 0.7)), nv = Math.max(8, Math.round(d / 0.7)); const P = [], N = [], U = [], I = [];
  const hgt = (u, v) => { const eu = Math.min(u - u0, u1 - u) / 0.45, ev = Math.min(v - v0, v1 - v) / 0.45; const e = clamp(Math.min(eu, ev), 0, 1); const n = 0.5 + 0.5 * noise2(u * 0.5 + seed * 3.1, v * 0.5 - seed); const th = depth * (0.5 + 0.9 * n); return e <= 0 ? 0 : th * Math.pow(smoothstep(0, 1, e), 0.6) + 0.0; };
  const pos = (u, v) => { const e = Math.min(Math.min(u - u0, u1 - u), Math.min(v - v0, v1 - v)); const drop = e < 0.18 ? (1 - Math.max(e, 0) / 0.18) * curl : 0; return F.p(u, y + hgt(u, v) - drop, v); };
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const u = u0 + w * i / nu, v = v0 + d * j / nv; const p = pos(u, v); P.push(p[0], p[1], p[2]); U.push(p[0], p[2]);
    const e = 0.12, a = pos(u + e, v), b = pos(u - e, v), c = pos(u, v + e), dd = pos(u, v - e); const t1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], t2 = [c[0] - dd[0], c[1] - dd[1], c[2] - dd[2]]; let nx = t1[1] * t2[2] - t1[2] * t2[1], ny = t1[2] * t2[0] - t1[0] * t2[2], nz = t1[0] * t2[1] - t1[1] * t2[0]; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } const l = Math.hypot(nx, ny, nz) || 1; N.push(nx / l, ny / l, nz / l); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, e2 = c + 1; I.push(a, c, b, b, c, e2, a, b, c, b, e2, c); }
  B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4(), mat, { cast: true, recv: true });
}
/** invisible collider that only serves the baked sky-visibility (roofs / canopies darken the ambient underneath) */
export function skyOccluder(B, F, u0, u1, v0, v1, y0, y1) {
  B.colliders.addBox({ x: F.p((u0 + u1) / 2, 0, (v0 + v1) / 2)[0], y: (y0 + y1) / 2, z: F.p((u0 + u1) / 2, 0, (v0 + v1) / 2)[2], hx: (u1 - u0) / 2, hy: (y1 - y0) / 2, hz: (v1 - v0) / 2, yaw: F.yaw, surface: 'metal', walk: false, solid: false, shootable: false });
}
