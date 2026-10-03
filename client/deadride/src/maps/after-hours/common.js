// AFTER HOURS — shared building kit for the four lands: station frame maths, emissive/neon/bulb materials with in-shader flicker, canvas art,
// vertical-plane extrusions, lofts, pipes, tori, lamp/bulb strings, litter, balloons. Everything goes through the core Builder (batched/instanced).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { toRaw, SkyVis } from '../../core/build.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STATION_LOCAL, STATION_YAW } from './track.js';

export const PI = Math.PI, TAU = Math.PI * 2;
const _geo = new Map();
/** cached shared THREE geometry (instancing) */
export const geo = (key, make) => { let g = _geo.get(key); if (!g) { g = make(); _geo.set(key, g); } return g; };
export const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ------------------------------------------------------------------ station frame: x = right (platform side), y up (0 = platform level), z = back (the train's forward is -z)
export function stationFrame(k) {
  const [sx, sy, sz] = STATION_LOCAL[k], yaw = STATION_YAW[k], c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    k, yaw, pos: [sx, sy, sz], level: sy,
    P: (x, y, z) => [sx + c * x + s * z, sy + y, sz - s * x + c * z],      // station frame (y relative to the platform level) -> stop-local
    G: (x, y, z) => [sx + c * x + s * z, y, sz - s * x + c * z],           // same but y is absolute (ground referenced)
    dir: (x, z) => [c * x + s * z, -s * x + c * z],                         // rotate a horizontal direction
    /** yaw of a station-frame box whose local x runs along station-frame direction (dx,dz) */
    yawOf: (dx, dz) => { const w = [c * dx + s * dz, -s * dx + c * dz]; return Math.atan2(-w[1], w[0]); },
  };
}

// ------------------------------------------------------------------ emissive materials
// "Dying neon" flicker: per world-space cell (metres) each segment blinks/blacks out; a share of cells is dead. The parameters are packed into ordinary material
// values (which survive the core's material re-patching/cloning) so ALL flickering emissives share just two shader programs:
//   untextured tube: diffuse.rgb = (flicker, cell/16, dead), roughness = seed/100      textured panel: metalness = flicker, roughness = cell/16, opacity = dead
const FLICK_BODY = (fl, cl, dd0, sd) => `float h = fract(sin(dot(floor(vWPos / max(${cl}, 0.05)), vec3(12.9898, 78.233, 37.719)) + ${sd}) * 43758.5453); float t = uTime * (0.6 + h * 2.4) + h * 47.0;
  float f = 0.88 + 0.12 * sin(t * 9.0) * sin(t * 4.3); float drop = step(1.0 - ${fl}, fract(t * 0.21 + h * 3.0));
  f *= 1.0 - drop * (0.94 - 0.6 * step(0.5, fract(t * 17.0))); float dd = step(h, ${dd0}); totalEmissiveRadiance *= mix(f, 0.035, dd);`;
const FLICK_TUBE = `{ float fl0 = diffuseColor.r, cl0 = diffuseColor.g * 16.0, dd1 = diffuseColor.b, sd0 = roughnessFactor * 100.0; diffuseColor.rgb = vec3(0.03); roughnessFactor = 0.4; ${FLICK_BODY('fl0', 'cl0', 'dd1', 'sd0')} }`;
const FLICK_PANEL = `{ float fl0 = metalnessFactor, cl0 = roughnessFactor * 16.0, dd1 = diffuseColor.a; metalnessFactor = 0.1; roughnessFactor = 0.5; ${FLICK_BODY('fl0', 'cl0', 'dd1', '0.0')} }`;
// Marquee bulbs: per-instance seed = instance colour R; chase speed / frequency / base level are packed into opacity / metalness / roughness so every bulb material shares ONE program.
const BULB_FRAG = `{ float sd = 0.5;
#ifdef USE_COLOR
 sd = vColor.r;
#endif
  float spd = diffuseColor.a * 4.0, frq = metalnessFactor * 2.0, bs = roughnessFactor; metalnessFactor = 0.0; roughnessFactor = 0.3;
  float ph = dot(vWPos.xz, vec2(0.8, 0.6)) * frq - uTime * spd; float on = mix(1.0, smoothstep(0.30, 0.55, fract(ph)) * (1.0 - smoothstep(0.85, 1.0, fract(ph))), step(bs, 0.999));
  float alive = step(0.12, fract(sd * 7.31)); totalEmissiveRadiance *= alive * (bs + (1.0 - bs) * on) + (1.0 - alive) * 0.02; }`;
/** Emissive tube / lit panel with optional in-shader "dying neon" flicker. */
export function glowMat(color, intensity = 9, { flicker = 0, cell = 6, dead = 0, seed = 0, rough = 0.35, base = 0x060606, map = null, emissiveMap = null, transparent = false, opacity = 1, side } = {}) {
  if (!map && !emissiveMap) return memoMat(`glow${color}|${intensity}|${flicker}|${cell}|${dead}|${seed}|${rough}|${base}|${transparent}|${opacity}|${side}`, () => glowMat0(color, intensity, { flicker, cell, dead, seed, rough, base, transparent, opacity, side }));
  return glowMat0(color, intensity, { flicker, cell, dead, seed, rough, base, map, emissiveMap, transparent, opacity, side });
}
function glowMat0(color, intensity, { flicker, cell, dead, seed, rough, base, map = null, emissiveMap = null, transparent, opacity, side }) {
  const on = flicker > 0 || dead > 0; const o = { color: base, emissive: color, emissiveIntensity: intensity, roughness: rough, metalness: 0, frag: on ? FLICK_TUBE : undefined };
  if (map) o.map = map; if (emissiveMap) { o.emissiveMap = emissiveMap; o.emissive = 0xffffff; }
  if (transparent) { o.transparent = true; o.opacity = opacity; o.depthWrite = false; } if (side !== undefined) o.side = side;
  const m = std(o); if (on) { m.color.setRGB(flicker, cell / 16, dead, THREE.LinearSRGBColorSpace); m.roughness = (seed % 1000) / 100; } return m;
}
const _mats = new Map(); const memoMat = (k, make) => { let m = _mats.get(k); if (!m) _mats.set(k, m = make()); return m; };   // identical emissive requests share ONE material (fewer draws / state changes)
/** Chasing marquee bulbs (instanced with per-instance colour R channel as random seed). speed = chase cycles/s, freq = chase cycles per metre, base = level between pulses (1 = steady). */
export function bulbMat(color, intensity = 10, { speed = 1.6, freq = 0.6, base = 0.22, steady = false } = {}) {
  return memoMat(`bulb${color}|${intensity}|${speed}|${freq}|${steady ? 1 : base}`, () => std({ color: 0x0a0a0a, emissive: color, emissiveIntensity: intensity, roughness: steady ? 1 : base, metalness: Math.min(1, freq / 2), opacity: Math.min(1, speed / 4), frag: BULB_FRAG }));
}
export const plain = (color, rough = 0.6, metal = 0, o = {}) => std({ color, roughness: rough, metalness: metal, ...o });

// ------------------------------------------------------------------ canvas art
/** neon lettering: outline tube with a bright core, like channel-letter neon. */
export function neonText(ctx, text, cx, cy, size, color = '#ff4fa8', { core = '#fff4fb', font = '"Liberation Serif", "DejaVu Serif", serif', style = 'italic 700', tube = 0.06, spacing = 0 } = {}) {
  ctx.save(); ctx.font = `${style} ${size}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; if (spacing) ctx.letterSpacing = spacing + 'px';
  ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.lineWidth = size * tube; ctx.shadowColor = color; ctx.shadowBlur = size * 0.16; ctx.strokeText(text, cx, cy);
  ctx.shadowBlur = 0; ctx.strokeStyle = core; ctx.lineWidth = size * tube * 0.36; ctx.strokeText(text, cx, cy); ctx.restore();
}
/** panel material with separate albedo/emissive canvases. draw(ctxBase, ctxEmis, w, h).
 *  Inside a stop (after `coarseBatches(B)`) small panels are NOT separate materials: they are packed into a few shared atlas materials (one draw call for every sign / poster /
 *  display / window of the same class) and this returns a handle that `B.addRaw` (quad / extrudeXY / box) understands. `atlas: false` opts out. */
let _panels = null;
export function neonPanel(w, h, draw, { intensity = 8, rough = 0.5, metal = 0.1, aniso = 8, flicker = 0, cell = 6, dead = 0, atlas = true } = {}) {
  if (_panels && !_panels.done && atlas && w * h <= 600000 && intensity <= 12.5) return _panels.alloc(w, h, draw, { intensity, rough, metal, aniso, flicker, cell, dead });
  const emi = canvasTexture(w, h, (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); }, { aniso }); const ec = emi.image.getContext('2d');
  const base = canvasTexture(w, h, (c) => { c.fillStyle = '#222'; c.fillRect(0, 0, w, h); draw(c, ec, w, h); }, { aniso });
  emi.needsUpdate = true; base.needsUpdate = true;
  const on = flicker > 0 || dead > 0; const m = std({ map: base, emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: intensity, roughness: rough, metalness: metal, frag: on ? FLICK_PANEL : undefined });
  if (on) { m.metalness = flicker; m.roughness = cell / 16; m.opacity = dead; }
  return m;
}
const PANEL_EI = 10;   // emissiveIntensity of every atlas material; a panel's own intensity becomes a brightness gain baked into its emissive pixels
class PanelSet {
  constructor(B) { this.B = B; this.cls = new Map(); this.done = false; }
  /** returns a REAL material (safe for raw THREE.Mesh use too). If the Builder batches it, the panel is packed into the class atlas instead; otherwise it gets its own textures at finalize. */
  alloc(w, h, draw, o) {
    const on = o.flicker > 0 || o.dead > 0, key = `${on ? `F${o.cell < 1 ? 'x' : ''}${o.dead > 0.2 ? 'd' : ''}` : 'S'}|${o.rough.toFixed(1)}|${o.metal.toFixed(1)}`;
    let c = this.cls.get(key);
    if (!c) { const m = std({ emissive: 0xffffff, emissiveIntensity: PANEL_EI, roughness: o.rough, metalness: o.metal, frag: on ? FLICK_PANEL : undefined }); if (on) { m.metalness = o.flicker; m.roughness = o.cell / 16; m.opacity = o.dead; } m.name = 'panels ' + key; c = { mat: m, items: [], aniso: o.aniso }; this.cls.set(key, c); }
    const mk = (fill) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.fillStyle = fill; g.fillRect(0, 0, w, h); return [cv, g]; };
    const [bc, bx] = mk('#222'), [ec, ex] = mk('#000'); draw(bx, ex, w, h);
    const m = std({ emissive: 0xffffff, emissiveIntensity: o.intensity, roughness: o.rough, metalness: o.metal, frag: on ? FLICK_PANEL : undefined }); if (on) { m.metalness = o.flicker; m.roughness = o.cell / 16; m.opacity = o.dead; }
    const it = { w, h, bc, ec, gain: Math.min(1, o.intensity / PANEL_EI), rect: null, batched: false, mat: m, aniso: o.aniso }; c.items.push(it); m.userData.panel = { cls: c, it }; return m;
  }
  /** shelf-pack every batched panel of each class into one albedo + one emissive atlas, remap the UVs already merged into the static batch; panels used by raw meshes get their own textures */
  finalize() {
    if (this.done) return; this.done = true; if (_panels === this) _panels = null;
    const PAD = 4, MAXW = 4096;
    for (const c of this.cls.values()) {
      for (const it of c.items) if (!it.batched) { const tb = new THREE.CanvasTexture(it.bc), te = new THREE.CanvasTexture(it.ec); for (const t of [tb, te]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = it.aniso; } it.mat.map = tb; it.mat.emissiveMap = te; it.mat.needsUpdate = true; }
      const items = c.items.filter((it) => it.batched).sort((a, b) => b.h - a.h || b.w - a.w); if (!items.length) continue; let x = 0, y = 0, rowH = 0, W = 0;
      for (const it of items) { const iw = it.w + 2 * PAD, ih = it.h + 2 * PAD; if (x + iw > MAXW) { x = 0; y += rowH; rowH = 0; } it.x = x + PAD; it.y = y + PAD; x += iw; rowH = Math.max(rowH, ih); W = Math.max(W, x); }
      const AW = W, AH = y + rowH; const mk = (fill) => { const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH; const g = cv.getContext('2d'); g.fillStyle = fill; g.fillRect(0, 0, AW, AH); return [cv, g]; };
      const [ab, ag] = mk('#222'), [ae, eg] = mk('#000');
      const blit = (g, src, it, alpha) => { g.globalAlpha = alpha; g.drawImage(src, it.x, it.y);
        g.drawImage(src, 0, 0, it.w, 1, it.x, it.y - PAD, it.w, PAD); g.drawImage(src, 0, it.h - 1, it.w, 1, it.x, it.y + it.h, it.w, PAD); g.drawImage(src, 0, 0, 1, it.h, it.x - PAD, it.y, PAD, it.h); g.drawImage(src, it.w - 1, 0, 1, it.h, it.x + it.w, it.y, PAD, it.h);
        for (const [sx, sy, dx, dy] of [[0, 0, -PAD, -PAD], [it.w - 1, 0, it.w, -PAD], [0, it.h - 1, -PAD, it.h], [it.w - 1, it.h - 1, it.w, it.h]]) g.drawImage(src, sx, sy, 1, 1, it.x + dx, it.y + dy, PAD, PAD); g.globalAlpha = 1; };
      for (const it of items) { blit(ag, it.bc, it, 1); blit(eg, it.ec, it, it.gain); it.rect = [it.x / AW, 1 - (it.y + it.h) / AH, (it.x + it.w) / AW, 1 - it.y / AH]; it.bc.width = it.bc.height = it.ec.width = it.ec.height = 0; it.mat.dispose(); }
      const tb = new THREE.CanvasTexture(ab), te = new THREE.CanvasTexture(ae); for (const t of [tb, te]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = c.aniso; }
      c.mat.map = tb; c.mat.emissiveMap = te; c.mat.needsUpdate = true;
    }
    for (const a of this.B.batch.map.values()) if (a.H) for (const { h, s, n } of a.H) { const r = h.it.rect, U = a.U; for (let k = s; k < s + n; k += 2) { U[k] = r[0] + Math.min(1, Math.max(0, U[k])) * (r[2] - r[0]); U[k + 1] = r[1] + Math.min(1, Math.max(0, U[k + 1])) * (r[3] - r[1]); } }
  }
}

// ------------------------------------------------------------------ geometry helpers (all through B)
/** Extrude a 2D profile in the local XY plane along local Z (centred), then place with yaw/pitch/roll. pts [[x,y]..], holes [[[x,y]..]..] */
export function extrudeXY(B, { p, yaw = 0, pitch = 0, roll = 0, pts, holes = [], depth = 0.2, bevel = 0, mat, cast = true, curve = 8, scale = null, uv = 'box' }) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))); for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: curve }); g.translate(0, 0, -depth / 2);
  const raw = toRaw(g, 'box'); g.dispose();
  if (uv === 'bbox') { // front/back faces map the texture 0..1 over the profile's bounding box (back face mirrored so text reads correctly); side faces sample the corner texel
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let i = 0; i < raw.p.length / 3; i++) { const nz = raw.n[i * 3 + 2]; if (Math.abs(nz) > 0.9) { let u = (raw.p[i * 3] - x0) / (x1 - x0); if (nz < 0) u = 1 - u; raw.u[i * 2] = u; raw.u[i * 2 + 1] = (raw.p[i * 3 + 1] - y0) / (y1 - y0); } else { raw.u[i * 2] = 0.002; raw.u[i * 2 + 1] = 0.002; } }
  }
  B.addRaw(raw, B.matrix(p, yaw, scale || 1, pitch, roll), mat, { cast });
}
/** flat quad with 0..1 UVs (signs, decals, fabric), facing +Z in local space; size w x h, centred at p (its centre). */
export function quad(B, { p, w, h, yaw = 0, pitch = 0, roll = 0, mat, cast = false, flip = false, uMax = 1 }) {
  const hx = w / 2, hy = h / 2, raw = { p: new Float32Array([-hx, -hy, 0, hx, -hy, 0, hx, hy, 0, -hx, hy, 0]), n: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), u: new Float32Array(flip ? [uMax, 0, 0, 0, 0, 1, uMax, 1] : [0, 0, uMax, 0, uMax, 1, 0, 1]), i: new Uint32Array([0, 1, 2, 0, 2, 3]) };
  B.addRaw(raw, B.matrix(p, yaw, 1, pitch, roll), mat, { cast });
}
/** Torus (ring). axis: default ring lies in the XZ plane (horizontal); use pitch=PI/2 for a vertical ring facing +Z. */
export function torus(B, { p, R, r, seg = 10, tube = 32, yaw = 0, pitch = 0, roll = 0, mat, cast = true, arc = TAU }) {
  const g = new THREE.TorusGeometry(R, r, seg, tube, arc); g.rotateX(PI / 2); const raw = toRaw(g, 'keep', TAU * R, TAU * r); g.dispose(); B.addRaw(raw, B.matrix(p, yaw, 1, pitch, roll), mat, { cast });
}
/** cylinder between two points */
export function pipe(B, a, b, r, mat, { seg = 8, cast = true, r2 = null } = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); if (L < 1e-4) return;
  const tilt = Math.acos(Math.max(-1, Math.min(1, dy / L))), yaw = Math.hypot(dx, dz) < 1e-6 ? 0 : Math.atan2(dz, -dx);
  B.cyl({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r: r2 === null ? r : [r, r2], h: L, seg, mat, roll: tilt, yaw, anchor: 'center', cast });
}
/** polyline of pipes with spheres at the joints (rails, neon frames) */
export function pipes(B, pts, r, mat, { seg = 8, closed = false, cast = true } = {}) { const n = pts.length; for (let i = 0; i < n - (closed ? 0 : 1); i++) pipe(B, pts[i], pts[(i + 1) % n], r, mat, { seg, cast }); }
/** Loft rings [[x,y,z]...] (equal length) into a smooth-shaded strip mesh with metre UVs. closed: ring wraps; caps: close the ends with fans. Returns raw. */
export function loftRaw(rings, { closed = true, capStart = false, capEnd = false, flip = false, uvScale = 1 } = {}) {
  const n = rings[0].length, m = rings.length, P = [], U = [], I = [];
  let vAcc = 0; for (let j = 0; j < m; j++) {
    if (j > 0) { const a = rings[j - 1], b = rings[j]; let cx0 = 0, cy0 = 0, cz0 = 0, cx1 = 0, cy1 = 0, cz1 = 0; for (let i = 0; i < n; i++) { cx0 += a[i][0]; cy0 += a[i][1]; cz0 += a[i][2]; cx1 += b[i][0]; cy1 += b[i][1]; cz1 += b[i][2]; } vAcc += Math.hypot(cx1 - cx0, cy1 - cy0, cz1 - cz0) / n; }
    let uAcc = 0; for (let i = 0; i < n + (closed ? 1 : 0); i++) { const q = rings[j][i % n]; if (i > 0) { const pq = rings[j][(i - 1) % n]; uAcc += Math.hypot(q[0] - pq[0], q[1] - pq[1], q[2] - pq[2]); } P.push(q[0], q[1], q[2]); U.push(uAcc * uvScale, vAcc * uvScale); }
  }
  const w = n + (closed ? 1 : 0);
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < w - 1; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; if (flip) I.push(a, b, c, b, d, c); else I.push(a, c, b, b, c, d); }
  const addCap = (ring, reverse) => { const base = P.length / 3; let cx = 0, cy = 0, cz = 0; for (const q of ring) { cx += q[0]; cy += q[1]; cz += q[2]; } cx /= n; cy /= n; cz /= n; P.push(cx, cy, cz); U.push(0, 0); for (const q of ring) { P.push(q[0], q[1], q[2]); U.push(q[0], q[1]); } for (let i = 0; i < n; i++) { const a = base + 1 + i, b = base + 1 + (i + 1) % n; if (reverse !== flip) I.push(base, b, a); else I.push(base, a, b); } };
  if (capStart) addCap(rings[0], false); if (capEnd) addCap(rings[m - 1], true);
  const p = new Float32Array(P), nn = new Float32Array(P.length), idx = new Uint32Array(I);
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3; const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const o of [a, b, c]) { nn[o] += nx; nn[o + 1] += ny; nn[o + 2] += nz; } }
  for (let i = 0; i < nn.length; i += 3) { const l = Math.hypot(nn[i], nn[i + 1], nn[i + 2]) || 1; nn[i] /= l; nn[i + 1] /= l; nn[i + 2] /= l; }
  return { p, n: nn, u: new Float32Array(U), i: idx };
}
/** points on an arc */
export const arc = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
/** superellipse ring in the XY plane (rounded rect) at z: half sizes hx, hy, exponent e */
export const superRing = (hx, hy, e, z, n = 32, ox = 0, oy = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * TAU, c = Math.cos(a), s = Math.sin(a); return [ox + hx * Math.sign(c) * Math.pow(Math.abs(c), 2 / e), oy + hy * Math.sign(s) * Math.pow(Math.abs(s), 2 / e), z]; });

// ------------------------------------------------------------------ dressing helpers
/** festoon: cable with sag + instanced bulbs (+ optional halos). bulbs: instanced sphere with per-instance seed colour. */
export function festoon(B, halos, a, b, { sag = 0.7, n = 14, mat, bulb, cable, color = 0xffc070, rng, size = 0.5, haloEvery = 2, r = 0.05, cast = false }) {
  const g = geo('bulb' + r, () => new THREE.SphereGeometry(r, 7, 5)); const pt = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t), a[2] + (b[2] - a[2]) * t];
  if (cable) B.cable(a, b, sag, 0.008, cable, { n: 10, seg: 4, cast: false });
  for (let i = 1; i < n; i++) { const t = i / n, p = pt(t); const seed = rng ? rng() : Math.random(); B.instance('bulb' + r, g, bulb, B.matrix([p[0], p[1] - r * 0.9, p[2]]), (Math.floor(seed * 255) << 16) | 0x808080, { cast }); if (halos && i % haloEvery === 0 && seed > 0.1) halos.add([p[0], p[1] - r, p[2]], color, size, 0.6, 0); }
}
/** scatter helper: rng-driven placement inside a rectangle avoiding a predicate */
export function scatter(rng, n, [x0, z0, x1, z1], ok = () => true) { const out = []; let g = 0; while (out.length < n && g++ < n * 30) { const x = x0 + (x1 - x0) * rng(), z = z0 + (z1 - z0) * rng(); if (ok(x, z)) out.push([x, z]); } return out; }
/** instanced litter (cups, papers, popcorn boxes, cans...) lying on a floor */
export function litter(B, rng, pts, { mat, kind = 'cup', y = 0.0, colors = [0xffffff], scale = 1 }) {
  const g = kind === 'cup' ? geo('litCup', () => new THREE.CylinderGeometry(0.045, 0.033, 0.12, 8)) : kind === 'paper' ? geo('litPaper', () => new THREE.BoxGeometry(0.22, 0.004, 0.16)) : kind === 'box' ? geo('litBox', () => new THREE.BoxGeometry(0.11, 0.16, 0.08)) : geo('litCan', () => new THREE.CylinderGeometry(0.033, 0.033, 0.12, 8));
  for (const [x, z] of pts) { const yaw = rng() * TAU, lay = kind === 'cup' || kind === 'can' ? (rng() < 0.6 ? PI / 2 : 0) : 0; const h = kind === 'paper' ? 0.005 : kind === 'cup' ? (lay ? 0.045 : 0.06) : kind === 'box' ? 0.08 : 0.04; B.instance('lit' + kind, g, mat, B.matrix([x, y + h * scale, z], yaw, scale, 0, lay), colors[Math.floor(rng() * colors.length)], { cast: false }); }
}
/** balloon (instanced): body + knot; colours per instance. */
export const balloonGeo = () => geo('balloon', () => { const g = new THREE.SphereGeometry(0.17, 12, 9); g.scale(1, 1.22, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -0.1) { const k = 1 - Math.min(1, (-0.1 - y) / 0.13) * 0.6; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } } g.computeVertexNormals(); return g; });
export function fromRawMesh(B, raw, p, yaw, mat, opt) { B.addRaw(raw, B.matrix(p, yaw), mat, opt); }
/** vertical stripes / checker / etc. custom synth pattern GLSL helpers */
export const GLSL_STRIPES = (n = 8) => `S p_custom(vec2 uv){ S s = mk(); float st = step(.5, fract(uv.x * ${n.toFixed(1)})); float w1 = sin(uv.x * 900.) * sin(uv.y * 900.);
  float wv = .5 + .5 * sin(uv.y * 500.) * sin(uv.x * 500.); vec3 c = mix(uC0, uC1, st) * (.9 + .12 * wv) * (.88 + .24 * fbmU(uv, 9., 3));
  s.a = c; s.h = .4 + .12 * wv + .05 * st; s.r = mix(uRough.x, uRough.y, wv); s.m = 0.; s.ao = mix(.75, 1., wv); return s; }`;

/** flat annulus (r0 = 0 gives a disc) facing up (or down), metre UVs. */
export function disc(B, { p, r0 = 0, r1, seg = 48, up = true, mat, cast = true, yaw = 0 }) {
  const g = new THREE.RingGeometry(r0, r1, seg, 1); g.rotateX(up ? -PI / 2 : PI / 2); const raw = toRaw(g, 'box'); g.dispose(); B.addRaw(raw, B.matrix(p, yaw), mat, { cast });
}
/** merge a list of {geo, matrix} (THREE.BufferGeometry + Matrix4) into ONE mesh with the given material, added to `group`. Returns the mesh (animate it as a unit). */
export function mergedMesh(group, list, material, { cast = true, recv = true } = {}) {
  const gs = list.map(({ geo: g, matrix }) => { const c = g.clone(); if (matrix) c.applyMatrix4(matrix); return c.index ? c.toNonIndexed() : c; });
  for (const g of gs) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
  const m = new THREE.Mesh(mergeGeometries(gs), material); m.castShadow = cast; m.receiveShadow = recv; group.add(m); return m;
}

/** Coarser static batching for open-air stops. The default 28 m chunks split every material into a dozen meshes (each a draw call in the main pass) while a whole stop is
 *  usually in view anyway. Here the main batches / instanced groups use big `main` m cells whose grid origin is shifted by `off` so a land that straddles x = 0 / z = 0 still
 *  falls into ONE chunk (fewer draws: plaza gate view 330 -> ~180); the depth-only shadow proxies keep fine `proxy` m cells so the sun shadow pass still culls.
 *  (`add` below mirrors core StaticBatch.add / Instancer.add — only the chunk key differs.) */
const proxySafe = (mat) => !mat.transparent && !mat.alphaTest && !mat.alphaMap && !(mat.userData.patchOpts && (mat.userData.patchOpts.wind || mat.userData.patchOpts.vertex)) && mat.side !== THREE.BackSide;
/** SkyVis.at is 64 height taps per vertex (~5 us) and dominates Builder.finish (>50 % of a stop's build). Neighbouring vertices of detail geometry share the same 0.3 m cell, and the value varies over metres
 *  (the nearest horizon sample is 1.2 m away), so it is cached per cell and only the cheap hemisphere factor (normal.y) is re-applied per vertex. */
function memoSkyAt(orig) {
  const cache = new Map(), Q = 1 / 0.3, H = (ny) => Math.min(1, (0.55 + 0.45 * Math.max(-0.2, ny)) * 1.1);
  return function (px, py, pz, nx, ny, nz) {
    const ix = Math.round((px + nx * 0.25) * Q) + 4096, iz = Math.round((pz + nz * 0.25) * Q) + 4096, iy = Math.round((py + ny * 0.25) * Q) + 64, key = (ix * 8192 + iz) * 512 + iy; let b = cache.get(key);
    if (b === undefined) { b = orig.call(this, px, py, pz, nx, ny, nz) / H(ny); cache.set(key, b); }
    return b * H(ny);
  };
}
export function coarseBatches(B, main = 200, proxy = 32, off = [0, 0, 0]) {
  const b = B.batch, ins = B.inst, cy = 1000; b.cell = main; b.cellY = cy; ins.cell = main; const fp = b._proxyAdd.bind(b); const N3 = new THREE.Matrix3();
  const canon = new Map(); const set = new PanelSet(B); _panels = set; const fin = B.finish.bind(B); B.finish = (...a) => { set.finalize(); const orig = SkyVis.prototype.at; SkyVis.prototype.at = memoSkyAt(orig); try { return fin(...a); } finally { SkyVis.prototype.at = orig; } };   // lit panels -> shared atlases (see neonPanel); the vertex sky-visibility bake is memoised per 0.3 m cell only while THIS builder finishes
  b._proxyAdd = (raw, e, ne, cx, cyy, cz, dbl) => fp(raw, e, ne, Math.floor(e[12] / proxy), Math.floor(e[13] / 60), Math.floor(e[14] / proxy), dbl);
  b.add = function (raw, matrix, mat, { cast = true, recv = true } = {}) {
    let H = null; const pn = mat.userData && mat.userData.panel; if (pn) { H = pn; pn.it.batched = true; mat = pn.cls.mat; }
    const nrm = N3.getNormalMatrix(matrix), e = matrix.elements, ne = nrm.elements;
    const kx = Math.floor((e[12] + off[0]) / main), ky = Math.floor((e[13] + off[1]) / cy), kz = Math.floor((e[14] + off[2]) / main);
    if (cast && this.proxy && proxySafe(mat)) { this._proxyAdd(raw, e, ne, kx, ky, kz, mat.side === THREE.DoubleSide); cast = false; }
    const key = `${mat.uuid}|${cast ? 1 : 0}${recv ? 1 : 0}|${kx},${ky},${kz}`;
    let a = this.map.get(key); if (!a) { a = { mat, cast, recv, P: [], N: [], U: [], I: [], nv: 0 }; this.map.set(key, a); }
    const n = raw.p.length / 3, base = a.nv; if (H) (a.H || (a.H = [])).push({ h: H, s: a.U.length, n: n * 2 });
    for (let k = 0; k < n; k++) {
      const x = raw.p[k * 3], y = raw.p[k * 3 + 1], z = raw.p[k * 3 + 2];
      a.P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      const nx = raw.n[k * 3], ny = raw.n[k * 3 + 1], nz = raw.n[k * 3 + 2];
      const tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz; const l = Math.hypot(tx, ty, tz) || 1;
      a.N.push(tx / l, ty / l, tz / l); a.U.push(raw.u[k * 2], raw.u[k * 2 + 1]);
    }
    for (let k = 0; k < raw.i.length; k++) a.I.push(raw.i[k] + base);
    a.nv += n;
  };
  ins.add = function (key, geo, mat, matrix, color = null, { cast = true, recv = true } = {}) {
    const pk = geo.uuid + '|' + mat.uuid; let ck = canon.get(pk); if (ck === undefined) canon.set(pk, ck = key);   // one group (= one draw) per geometry+material pair, whatever key the call site invented
    const e = matrix.elements; const k = `${ck}|${Math.floor((e[12] + off[0]) / main)},${Math.floor((e[13] + off[1]) / cy)},${Math.floor((e[14] + off[2]) / main)}`;
    let g = this.groups.get(k); if (!g) { g = { geo, mat, cast, recv, m: [], c: [] }; this.groups.set(k, g); }
    g.m.push(matrix.clone()); g.c.push(color);
  };
}
/** invisible, non-shootable perimeter colliders around [minX,minZ,maxX,maxZ] (keeps the player inside the land). */
export function boundary(B, [x0, z0, x1, z1], { h = 12, t = 0.5 } = {}) {
  const add = (x, z, hx, hz) => B.colliders.addBox({ x, y: h / 2, z, hx, hy: h / 2, hz, surface: 'metal', walk: false, shootable: false });
  add((x0 + x1) / 2, z0 - t, (x1 - x0) / 2 + t, t); add((x0 + x1) / 2, z1 + t, (x1 - x0) / 2 + t, t); add(x0 - t, (z0 + z1) / 2, t, (z1 - z0) / 2 + t); add(x1 + t, (z0 + z1) / 2, t, (z1 - z0) / 2 + t);
}

/** visual retaining skirt around a land's rectangle so its ground meets the (lower) route lawn cleanly. */
export function skirt(B, [x0, z0, x1, z1], mat, { depth = 1.0, t = 0.5 } = {}) {
  const d = depth; B.box({ p: [(x0 + x1) / 2, -d, z0 - t / 2], s: [x1 - x0 + 2 * t, d, t], mat, bevel: 0.03, cast: false }); B.box({ p: [(x0 + x1) / 2, -d, z1 + t / 2], s: [x1 - x0 + 2 * t, d, t], mat, bevel: 0.03, cast: false });
  B.box({ p: [x0 - t / 2, -d, (z0 + z1) / 2], s: [t, d, z1 - z0], mat, bevel: 0.03, cast: false }); B.box({ p: [x1 + t / 2, -d, (z0 + z1) / 2], s: [t, d, z1 - z0], mat, bevel: 0.03, cast: false });
}

/** Clipped-hedge wall: a displaced grid (real relief: lumpy leaf mass, pilaster bays, scalloped top) facing +Z, metre UVs. Base plane at p, w wide, h tall. */
export function hedgeWall(B, { p, w, h, mat, cell = 0.5, amp = 0.3, bay = 6.5, seed = 3, cast = false }) {
  const vn = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, hh = (i, j) => { const t = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return t - Math.floor(t); }; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return hh(xi, yi) * (1 - u) * (1 - v) + hh(xi + 1, yi) * u * (1 - v) + hh(xi, yi + 1) * (1 - u) * v + hh(xi + 1, yi + 1) * u * v; };
  const nx = Math.round(w / cell), ny = Math.round(h / cell), W = nx + 1, P = new Float32Array(W * (ny + 1) * 3), U = new Float32Array(W * (ny + 1) * 2), Z = new Float32Array(W * (ny + 1));
  const zAt = (x, y) => { const f = 0.62 * vn(x * 1.1, y * 1.1, seed) + 0.28 * vn(x * 2.7, y * 2.7, seed + 5) + 0.10 * vn(x * 6.1, y * 6.1, seed + 9); const t = Math.abs(((x / bay) % 1 + 1) % 1 - 0.5) * 2, pil = Math.pow(Math.max(0, 1 - t / 0.16), 1.5) * 0.22;   // pilaster bay every `bay` m
    return (f - 0.5) * 2 * amp + pil - 0.06 * Math.max(0, 1 - y / 0.6); };                                                                                                                       // the foot tucks in
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = -w / 2 + i * cell, top = j === ny ? 0.32 * Math.sin(x * 1.7) * Math.sin(x * 0.55 + 1.0) - 0.15 : 0, y = j * cell + top, k = j * W + i; P[k * 3] = x; P[k * 3 + 1] = y; Z[k] = zAt(x, y); P[k * 3 + 2] = Z[k]; U[k * 2] = x; U[k * 2 + 1] = y; }
  const N = new Float32Array(P.length), I = new Uint32Array(nx * ny * 6);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const k = j * W + i, a = Z[j * W + Math.max(0, i - 1)], b = Z[j * W + Math.min(nx, i + 1)], c = Z[Math.max(0, j - 1) * W + i], d = Z[Math.min(ny, j + 1) * W + i]; const sx = (b - a) / (cell * (Math.min(nx, i + 1) - Math.max(0, i - 1))), sy = (d - c) / (cell * (Math.min(ny, j + 1) - Math.max(0, j - 1))); const l = Math.hypot(sx, sy, 1); N[k * 3] = -sx / l; N[k * 3 + 1] = -sy / l; N[k * 3 + 2] = 1 / l; }
  let q = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; I[q++] = a; I[q++] = b; I[q++] = c; I[q++] = b; I[q++] = d; I[q++] = c; }
  B.addRaw({ p: P, n: N, u: U, i: I }, B.matrix(p), mat, { cast });
}

/** GPU-flipbook flames (fx.fire) and smoke wisps (fx.smoke) for a list of fire spots [x,y,z,(r,g,b)] in stop-local metres. Only the `max` spots nearest to the camera emit; descriptors are
 *  preallocated (no per-frame garbage of our own). Spots with a non-orange colour (r < g) are skipped: the baked fireball is orange, keep the old coloured sparks for those.
 *  update(dt, origin, cameraPosition) */
export function makeFlames(fx, list, { max = 7, hz = 9, smokeHz = 1.3, size = [0.2, 0.44], life = 0.7, range = 32, smoke = true, fire = true, smokeC = [0.14, 0.13, 0.12, 0.28], smokeSize = [0.25, 1.2], smokeLife = 3.0, rise = 1.0 } = {}) {
  const n = list.length, acc = new Float32Array(n * 2), near = new Int16Array(max), nd = new Float32Array(max), R2 = range * range;
  const F = { p: [0, 0, 0], v: [0, 0, 0], life, size: [size[0], size[1]], c0: [2.7, 1.55, 0.7, 1], c1: [1.5, 0.55, 0.14, 0], rot: 0, rotVel: 0, drag: 0.35 };
  const S = { p: [0, 0, 0], v: [0, 0, 0], life: smokeLife, size: [smokeSize[0], smokeSize[1]], c0: [smokeC[0], smokeC[1], smokeC[2], smokeC[3]], c1: [smokeC[0], smokeC[1], smokeC[2], 0], rot: 0, rotVel: 0.12, drag: 0.5 };
  return (dt, O, cam) => {
    let m = 0;
    for (let i = 0; i < n; i++) { const f = list[i]; if (f[3] !== undefined && f[3] < f[4]) continue; const dx = O.x + f[0] - cam.x, dy = O.y + f[1] - cam.y, dz = O.z + f[2] - cam.z, d = dx * dx + dy * dy + dz * dz; if (d > R2 || (m === max && d >= nd[max - 1])) continue;
      let j = m < max ? m++ : max - 1; while (j > 0 && nd[j - 1] > d) { nd[j] = nd[j - 1]; near[j] = near[j - 1]; j--; } nd[j] = d; near[j] = i; }
    for (let k = 0; k < m; k++) { const i = near[k], f = list[i];
      if (fire) { acc[i * 2] += dt * hz; while (acc[i * 2] >= 1) { acc[i * 2] -= 1; F.p[0] = O.x + f[0] + (Math.random() - 0.5) * 0.12; F.p[1] = O.y + f[1]; F.p[2] = O.z + f[2] + (Math.random() - 0.5) * 0.12; F.v[0] = (Math.random() - 0.5) * 0.25; F.v[1] = (0.9 + Math.random() * 0.5) * rise; F.v[2] = (Math.random() - 0.5) * 0.25; F.life = life * (0.8 + Math.random() * 0.4); F.rot = Math.random() * 6.283; F.rotVel = (Math.random() - 0.5) * 0.8; fx.fire.emit(F, fx.time); } }
      if (smoke) { acc[i * 2 + 1] += dt * smokeHz; while (acc[i * 2 + 1] >= 1) { acc[i * 2 + 1] -= 1; S.p[0] = O.x + f[0]; S.p[1] = O.y + f[1] + 0.35; S.p[2] = O.z + f[2]; S.v[0] = (Math.random() - 0.3) * 0.3; S.v[1] = 0.55 + Math.random() * 0.4; S.v[2] = (Math.random() - 0.5) * 0.3; S.rot = Math.random() * 6.283; fx.smoke.emit(S, fx.time); } } }
  };
}

/** Canvas awning with real relief: a gridded strip that slopes from the wall down to the front bar and sags between the support ribs (scalloped shading), stripes run down the slope.
 *  p = top edge at the wall (centre), yaw so local +X points away from the wall, `width` along the wall. */
export function awningMesh(B, { p, yaw, out = 2.7, drop = 0.8, width, mat, rib = 0.9, sag = 0.07, cast = true }) {
  const cols = Math.max(4, Math.round(width / 0.3)), rows = 5, W = cols + 1, P = new Float32Array(W * (rows + 1) * 3), U = new Float32Array(W * (rows + 1) * 2), N = new Float32Array(P.length), I = new Uint32Array(cols * rows * 6);
  const yAt = (u, z) => -drop * (u / out) - sag * Math.sin(Math.PI * ((((z + width / 2) / rib) % 1) + 1) % 1) * Math.min(1, u / (out * 0.5)) * (0.55 + 0.45 * u / out);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { const u = out * j / rows, z = -width / 2 + width * i / cols, k = j * W + i; P[k * 3] = u; P[k * 3 + 1] = yAt(u, z); P[k * 3 + 2] = z; U[k * 2] = z; U[k * 2 + 1] = u; }
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { const k = j * W + i, e = 0.05, dyu = (yAt(Math.min(out, out * j / rows + e), P[k * 3 + 2]) - yAt(Math.max(0, out * j / rows - e), P[k * 3 + 2])) / (2 * e), dyz = (yAt(out * j / rows, P[k * 3 + 2] + e) - yAt(out * j / rows, P[k * 3 + 2] - e)) / (2 * e), l = Math.hypot(dyu, 1, dyz); N[k * 3] = -dyu / l; N[k * 3 + 1] = 1 / l; N[k * 3 + 2] = -dyz / l; }
  let q = 0; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; I[q++] = a; I[q++] = c; I[q++] = b; I[q++] = b; I[q++] = c; I[q++] = d; }
  B.addRaw({ p: P, n: N, u: U, i: I }, B.matrix(p, yaw), mat, { cast });
}
