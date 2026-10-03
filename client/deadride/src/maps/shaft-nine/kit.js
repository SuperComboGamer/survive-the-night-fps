// Shared building kit for Shaft Nine: constants, light pools / lamp fixtures, timber sets, rails, ore carts, pipes, grating & mesh shaders,
// handrails, stairs and small props. All functions take the stop's Builder B (stop-local metres).
import * as THREE from 'three';
import { pipe as pipeReal } from './parts2.js';
import { Parts, timberSet as tsReal, lagging as lgReal, railLine as rlReal, oreCart, drum as drumReal, crate as crateReal } from './parts.js';
import { boxRaw, toRaw } from '../../core/build.js';
import { std, G, FOG_GLSL, NOISE_GLSL } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { HaloBatch, makeBeam } from '../../core/glow.js';
import { makeRng, TAU } from '../../core/util.js';

export const PI = Math.PI;
export const STOP_Y = [0, -90, -180, -285, -400];
export const SHAFT = { hx: 2.1, hz: 1.5 };               // clear shaft interior half extents (x, z)
export const CAGE = { hx: 1.5, hz: 1.15, h: 2.5 };        // cage half extents / interior height; the frame origin is the floor centre
export const OPEN = { hw: 1.7, h: 2.9, z: 1.5 };          // landing opening half width / height / plane z (front of the shaft)
export const SHEAVE_Y = 34.3;                              // headframe sheave centre height above the surface stop origin

const M4 = new THREE.Matrix4(), V3 = new THREE.Vector3(), Q4 = new THREE.Quaternion(), E4 = new THREE.Euler();
export const mat4 = (p, yaw = 0, pitch = 0, roll = 0, s = 1) => { E4.set(pitch, yaw, roll, 'YXZ'); Q4.setFromEuler(E4); return new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), Q4.clone(), Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s)); };
/** local (lx,lz) rotated by yaw (Builder convention: local +x -> (cos, -sin), local +z -> (sin, cos)) */
export const rot = (lx, lz, yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [lx * c + lz * s, -lx * s + lz * c]; };
export const at = (p, lx, ly, lz, yaw) => { const [x, z] = rot(lx, lz, yaw); return [p[0] + x, p[1] + ly, p[2] + z]; };

// ------------------------------------------------------------------ cylinder / tube between two points (arbitrary orientation)
const cylCache = new Map();
export function cylBetween(B, a, b, r, mat, { seg = 12, cast = true, open = false, rt = null } = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); if (L < 1e-4) return;
  const rb = r, rtop = rt ?? r; const key = `${rb.toFixed(3)},${rtop.toFixed(3)},${L.toFixed(3)},${seg},${open ? 1 : 0}`; let raw = cylCache.get(key);
  if (!raw) { const g = new THREE.CylinderGeometry(rtop, rb, L, seg, 1, open); raw = toRaw(g, 'cyl', Math.PI * (rb + rtop), L); g.dispose(); cylCache.set(key, raw); }
  Q4.setFromUnitVectors(V3.set(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L)); const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), Q4.clone(), new THREE.Vector3(1, 1, 1));
  B.addRaw(raw, m, mat, { cast });
}

// ------------------------------------------------------------------ light pools (additive glow decals, one instanced draw call per stop)
const POOL_VS = /* glsl */`
varying vec2 vP; varying vec3 vC; varying vec3 vWP; varying float vI;
void main(){ vP = position.xz * 2.0; mat4 m = modelMatrix * instanceMatrix; vI = length(instanceMatrix[1].xyz);
  #ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
  #else
  vC = vec3(1.0);
  #endif
  vec4 wp = m * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const POOL_FS = /* glsl */`
precision highp float; varying vec2 vP; varying vec3 vC; varying vec3 vWP; varying float vI; ${FOG_GLSL}
void main(){ float r2 = dot(vP, vP); if (r2 > 1.0) discard; float f = (1.0 - r2); f = f * f / (1.0 + 5.0 * r2); vec3 c = vC * vI * f * (1.0 - fogFactor(vWP) * 0.9); gl_FragColor = vec4(c, 0.0); }`;
let poolMatShared = null, poolGeo = null;
export function poolMaterial() {
  if (!poolMatShared) poolMatShared = new THREE.ShaderMaterial({ vertexShader: POOL_VS, fragmentShader: POOL_FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, uniforms: { uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return poolMatShared;
}
/** additive light pool on a surface. p centre (already offset above the surface), radius r (m), intensity k (linear), colour hex; normal 'up' (floor) or orientation via pitch/roll/yaw */
export function lightPool(B, p, r, k, color = 0xffa550, { yaw = 0, pitch = 0, roll = 0 } = {}) {
  if (!poolGeo) { poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2); }
  B.instance('pool', poolGeo, poolMaterial(), mat4(p, yaw, pitch, roll, [r * 2, k, r * 2]), color, { cast: false, recv: false });
}

// ------------------------------------------------------------------ materials shared by several stops
/** dark caged-bulb emissive, warm */
export const glowMat = (B, name, color = 0xffb060, k = 10) => B.m(name, std({ color: 0x000000, emissive: color, emissiveIntensity: k, roughness: 0.4, key: 'glow' + name }));
export function steelRawMat(B, tint = [0x62666b, 0x4c5054, 0x202224]) {
  return B.m('steelRaw', { pattern: 'plates', size: 512, tile: 2, colors: tint, params: { cols: 1, rows: 1, seam: 0.008, rivets: 0, brushed: 0.7 }, bump: 2, metal: 1, rough: [0.32, 0.62], layers: { rust: 0.14, scratch: 0.6, grime: 0.35, edge: 0.4 }, rustColor: 0x4a2a16 });
}
export function steelRustMat(B, colors = [0x4a3a33, 0x3a2b25, 0x18100d]) {
  return B.m('steelRust', { pattern: 'plates', size: 512, tile: 2, colors, rustColor: 0x5a2e18, params: { cols: 2, rows: 2, seam: 0.012, rivets: 8, brushed: 0.2, panelVar: 0.5 }, bump: 3, metal: 1, rough: [0.45, 0.82], layers: { rust: 0.2, grime: 0.6, edge: 0.3, scratch: 0.3, streak: 0.6 } }, { breakup: 0.5 });
}

// ------------------------------------------------------------------ grating & mesh (procedural see-through surfaces)
/** steel grating: bar/cross-bar mask by world position, discards the holes. up-facing surfaces only (uses world xz). */
export function gratingMaterial({ color = 0x55595e, rust = 0.4, pitch = 0.0305, cross = 0.1, bar = 0.0045, metal = 1, rough = 0.5 } = {}) {
  const m = std({ color, roughness: rough, metalness: metal, key: 'grating', frag: `
    { vec3 wn = normalize(vWN); vec2 q = abs(wn.y) > 0.5 ? vWPos.xz : (abs(wn.x) > abs(wn.z) ? vWPos.zy : vWPos.xy);
      float a = abs(fract(q.x / ${pitch.toFixed(4)}) - 0.5) * ${pitch.toFixed(4)}, b = abs(fract(q.y / ${cross.toFixed(4)}) - 0.5) * ${cross.toFixed(4)};
      float band = min(abs(fract(q.y / 0.19) - 0.5) * 0.19, 1.0);
      float bars = step(a, ${(bar).toFixed(4)}) ; float xb = step(b, 0.0045) ; float frame = step(band, 0.0) ;
      float solid = max(bars, xb);
      if (solid < 0.5) discard;
      float n = zfbm3(vWPos * 3.0); diffuseColor.rgb *= 0.55 + 0.9 * n; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.16, 0.07) * (0.5 + n), smoothstep(${(1 - rust).toFixed(2)}, 1.0, n) * 0.85); roughnessFactor = mix(roughnessFactor, 0.85, smoothstep(0.5, 0.9, n)); }` });
  m.side = THREE.DoubleSide; return m;
}
/** expanded-metal / welded-mesh look through an alpha canvas (UVs are metres) */
export function meshTexture({ cell = 0.05, wire = 3, color = '#6a6f75', kind = 'diamond', tile = 0.5 } = {}) {
  const S = 256; const t = canvasTexture(S, S, (g) => {
    g.clearRect(0, 0, S, S); g.strokeStyle = color; g.lineWidth = wire; g.lineCap = 'round';
    const n = Math.round(tile / cell); const st = S / n;
    if (kind === 'diamond') { for (let i = -n; i <= n * 2; i++) { g.beginPath(); g.moveTo(i * st, 0); g.lineTo(i * st + S, S); g.stroke(); g.beginPath(); g.moveTo(i * st, S); g.lineTo(i * st + S, 0); g.stroke(); } }
    else { for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * st, 0); g.lineTo(i * st, S); g.stroke(); g.beginPath(); g.moveTo(0, i * st); g.lineTo(S, i * st); g.stroke(); } }
  }, { srgb: true, repeat: true }); t.repeat.set(1 / tile, 1 / tile); return t;
}
export function meshMaterial(o = {}) { const t = meshTexture(o); return std({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.9, key: 'mesh' + (o.kind || 'diamond') }); }

// ------------------------------------------------------------------ lamps
/**
 * Caged mining bulb on a hanging cable. E = {ctx, B, halos, bake (BakedBatch|null)}. p = bulb centre. Returns the pooled light source.
 * opts: color, I (cd), R (light distance), size (halo m), glowK, pool (floor pool radius, 0 = none), poolK, floorY, hang (cable length up to the ceiling), flicker
 */
export function bulbLamp(E, p, o = {}) {
  const { B, ctx, halos, bake } = E; const { color = 0xffb670, I = 18, R = 9, size = 0.8, glowK = 14, pool = 3.4, poolK = 0.03, floorY = 0, hang = 0.5, flicker = 0.02, cageMat, cordMat, real = true, halo = 1.0 } = o;
  const bulb = B.m('bulbGlow', std({ color: 0x000000, emissive: color, emissiveIntensity: glowK, roughness: 0.3, key: 'bulbGlow' }));
  B.sphere({ p: [p[0], p[1], p[2]], r: 0.055, seg: 8, mat: bulb, cast: false });
  if (cordMat) { cylBetween(B, [p[0], p[1] + 0.08, p[2]], [p[0], p[1] + hang, p[2]], 0.009, cordMat, { seg: 5, cast: false }); B.cyl({ p: [p[0], p[1] + 0.07, p[2]], r: 0.03, h: 0.05, seg: 8, mat: cageMat || cordMat, cast: false }); }
  if (cageMat) for (let i = 0; i < 6; i++) { const a = i * TAU / 6; cylBetween(B, [p[0] + Math.cos(a) * 0.07, p[1] - 0.07, p[2] + Math.sin(a) * 0.07], [p[0] + Math.cos(a) * 0.045, p[1] + 0.08, p[2] + Math.sin(a) * 0.045], 0.0028, cageMat, { seg: 4, cast: false }); }
  if (cageMat) { B.cyl({ p: [p[0], p[1] - 0.075, p[2]], r: 0.065, h: 0.008, seg: 10, mat: cageMat, cast: false }); B.cyl({ p: [p[0], p[1] + 0.05, p[2]], r: [0.05, 0.07], h: 0.03, seg: 10, mat: cageMat, cast: false }); }
  if (halos && halo > 0) halos.add(p, color, size, halo, flicker > 0 ? 7 : 0);
  if (E.gloss) E.gloss.push({ p: [p[0], p[1], p[2]], c: lin(color).map((v) => v * glowK * 0.45), s: 0.16 });
  if (pool > 0) lightPool(B, [p[0], floorY + 0.02, p[2]], pool, poolK, color);
  if (bake) bake.light({ p, c: lin(color), I: I * 0.3, R: R * 1.5, s: 0.5, shadow: true });
  return real ? ctx.light({ pos: p, color, intensity: I, distance: R, decay: 2, flicker, flickerSpeed: 9, kind: 'point' }) : null;
}
export const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// ------------------------------------------------------------------ timber
/** Timber set across a drift: two leaning posts, cap beam with wedges, foot blocks, optional diagonal brace. p = centre of set on the floor, yaw = drift direction rotation, w = clear width at floor. */
function timberSetOld(B, m, { p, yaw = 0, w = 3.0, h = 2.6, t = 0.3, lean = 0.06, brace = false, seed = 1, colPosts = true, dark = 1 }) {
  const r = makeRng(seed * 977 + 13); const hw = w / 2;
  const post = (side) => {
    const tx = side * (hw - lean), bx = side * hw; const a = at(p, bx + side * t / 2, 0, 0, yaw), b = at(p, tx + side * t / 2, h, 0, yaw);
    B.beam(a, b, t, t * (0.92 + r() * 0.16), { mat: m.post, bevel: 0.02 });
    const f = at(p, bx + side * t / 2, 0.05, 0, yaw); B.box({ p: [f[0], 0, f[2]], s: [t + 0.16, 0.1, t + 0.16], yaw, mat: m.post, bevel: 0.02, cast: false }); // foot block
    if (colPosts) B.colliders.addBox({ x: f[0], y: h / 2, z: f[2], hx: t / 2, hy: h / 2, hz: t / 2, yaw, surface: 'wood', walk: false });
  };
  post(-1); post(1);
  const c = at(p, 0, h + t / 2 - 0.02, 0, yaw); B.box({ p: [c[0], h - 0.02, c[2]], s: [w + 2 * t + 0.5 + r() * 0.3, t, t * (0.95 + r() * 0.1)], yaw, mat: m.post, bevel: 0.02 });
  for (const s of [-1, 1]) { const q = at(p, s * (hw - lean + 0.1), h - 0.06, 0, yaw); B.beam([q[0], q[1] - 0.35, q[2]], [q[0], q[1] + 0.05, q[2]], 0.08, 0.1, { mat: m.post, bevel: 0.01 }); }
  if (brace) { const a = at(p, -hw + 0.1, h - 0.1, 0, yaw), b = at(p, -0.2, h - 0.05, 0, yaw); B.beam([a[0], a[1] - 0.7, a[2]], [b[0] - (b[0] - a[0]) * 0.0, b[1], b[2]], 0.14, 0.14, { mat: m.post, bevel: 0.01 }); }
}
/** lagging boards laid between two sets (along the drift) on both walls and roof; gaps let the rock show. Boards are 5 cm thick. */
function laggingOld(B, m, { p, yaw = 0, len = 2.4, w = 3.0, h = 2.6, gap = 0.18, seed = 1, sides = true, roof = true, t = 0.05, bh = 0.27 }) {
  const r = makeRng(seed * 311 + 7); const hw = w / 2 + 0.02;
  if (sides) for (const s of [-1, 1]) {
    const n = Math.floor(h / bh); for (let i = 0; i < n; i++) {
      if (r() < gap) continue; const y = p[1] + i * bh + 0.02, c = at(p, s * (hw + t / 2 + 0.28), i * bh + 0.02, 0, yaw); const ln = len * (0.8 + r() * 0.2);
      B.box({ p: [c[0], y, c[2]], s: [t, bh - 0.01, ln], yaw, roll: 0, pitch: (r() - 0.5) * 0.03, mat: m.board, bevel: 0.004, cast: false });
    }
  }
  if (roof) { const n = Math.floor((w + 0.6) / bh); for (let i = 0; i < n; i++) { if (r() < gap * 0.6) continue; const lx = -w / 2 - 0.3 + (i + 0.5) * bh; const c = at(p, lx, p[1] + h + 0.34, 0, yaw); B.box({ p: [c[0], c[1], c[2]], s: [bh - 0.012, t, len * (0.85 + r() * 0.15)], yaw, pitch: (r() - 0.5) * 0.02, mat: m.board, bevel: 0.004, cast: false }); } }
}

// ------------------------------------------------------------------ rails
/** Mine rail line (T-rail profile) from a to b (y = floor). Gauge 0.61 m for tubs / 0.9 for hoist tracks. Sleepers every 0.75 m, fishplates every 6 m. */
function railLineOld(B, m, a, b, { gauge = 0.61, spacing = 0.72, sleeperLen = null, y = 0, ballast = true, seed = 3, height = 0.09 } = {}) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx), ux = dx / L, uz = dz / L, nx = -uz, nz = ux; const r = makeRng(seed);
  const sl = sleeperLen ?? gauge + 0.42;
  if (ballast && m.ballast) B.box({ p: [(a[0] + b[0]) / 2, y - 0.01, (a[2] + b[2]) / 2], s: [L, 0.09, sl + 0.5], yaw, mat: m.ballast, bevel: 0.03, cast: false });
  for (let s = 0.25; s < L; s += spacing) { const x = a[0] + ux * s, z = a[2] + uz * s; B.box({ p: [x, y + 0.03, z], s: [0.11, 0.095, sl * (0.96 + r() * 0.06)], yaw: yaw + (r() - 0.5) * 0.03, pitch: 0, roll: (r() - 0.5) * 0.02, mat: m.sleeper, bevel: 0.012, cast: false, swap: true }); }
  for (const k of [-1, 1]) {
    const cx = (a[0] + b[0]) / 2 + nx * k * gauge / 2, cz = (a[2] + b[2]) / 2 + nz * k * gauge / 2;
    B.box({ p: [cx, y + 0.075, cz], s: [L, 0.014, 0.085], yaw, mat: m.rail, bevel: 0.003, cast: false });
    B.box({ p: [cx, y + 0.089, cz], s: [L, 0.058, 0.014], yaw, mat: m.rail, bevel: 0.002, cast: false });
    B.box({ p: [cx, y + 0.147, cz], s: [L, 0.022, 0.048], yaw, mat: m.rail, bevel: 0.006, cast: false });
    for (let s = 3; s < L; s += 6) { const x = a[0] + ux * s + nx * k * gauge / 2, z = a[2] + uz * s + nz * k * gauge / 2; B.box({ p: [x, y + 0.09, z], s: [0.36, 0.06, 0.11], yaw, mat: m.rail, bevel: 0.006, cast: false }); }
  }
}
/** mine tub / ore cart. p = base centre on the rails' level, yaw = along the rails, load: 'coal'|'ore'|null */
function tubOld(B, m, { p, yaw = 0, load = null, seed = 1, tilt = 0, rustMat = null }) {
  const r = makeRng(seed * 71); const L = 1.35, W = 0.72, H = 0.72;
  const put = (lx, ly, lz, sx, sy, sz, mat = m.tub, o = {}) => { const q = at(p, lx, ly, lz, yaw); B.box({ p: [q[0], q[1], q[2]], s: [sx, sy, sz], yaw, mat, bevel: 0.012, cast: true, ...o }); };
  put(0, 0.26, 0, L, 0.04, W - 0.06);
  for (const s of [-1, 1]) { const q = at(p, 0, 0.26, s * (W / 2 - 0.02), yaw); const q2 = at(p, 0, 0.26 + H - 0.05, s * (W / 2 + 0.06), yaw); B.beam([q[0], q[1], q[2]], [q2[0], q2[1], q2[2]], L - 0.02 * 0, 0.035, { mat: m.tub, bevel: 0.01 }); }
  for (const s of [-1, 1]) { const q = at(p, s * (L / 2 - 0.02), 0.26, 0, yaw); const q2 = at(p, s * (L / 2 + 0.05), 0.26 + H - 0.05, 0, yaw); B.beam([q[0], q[1], q[2]], [q2[0], q2[1], q2[2]], W - 0.04, 0.035, { mat: m.tub, bevel: 0.01 }); }
  // rim band + corner bosses + bolts
  put(0, 0.26 + H - 0.03, W / 2 + 0.05, L + 0.06, 0.06, 0.05, m.rim); put(0, 0.26 + H - 0.03, -W / 2 - 0.05, L + 0.06, 0.06, 0.05, m.rim); put(L / 2 + 0.06, 0.26 + H - 0.03, 0, 0.05, 0.06, W + 0.12, m.rim); put(-L / 2 - 0.06, 0.26 + H - 0.03, 0, 0.05, 0.06, W + 0.12, m.rim);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(sx * (L / 2 - 0.05), 0.26 + H * 0.45, sz * (W / 2 - 0.02), 0.06, H * 0.9, 0.06, m.rim, { cast: false });
  // chassis, axles, wheels
  put(0, 0.2, 0, L + 0.1, 0.06, 0.09, m.rim, { cast: false });
  for (const sx of [-0.38, 0.38]) { const q = at(p, sx, 0.13, 0, yaw); B.cyl({ p: [q[0], q[1], q[2]], r: 0.014, h: gauge2 + 0.2, seg: 6, mat: m.rim, roll: PI / 2, yaw, anchor: 'center', cast: false }); for (const sz of [-1, 1]) { const w = at(p, sx, 0.13, sz * gauge2 / 2, yaw); B.cyl({ p: [w[0], w[1], w[2]], r: 0.13, h: 0.05, seg: 14, mat: m.wheel, roll: PI / 2, yaw, anchor: 'center', cast: true }); B.cyl({ p: [w[0] + Math.sin(yaw) * 0 , w[1], w[2]], r: 0.05, h: 0.075, seg: 8, mat: m.rim, roll: PI / 2, yaw, anchor: 'center', cast: false }); } }
  // coupling hooks
  for (const s of [-1, 1]) { const q = at(p, s * (L / 2 + 0.16), 0.3, 0, yaw); B.box({ p: [q[0], q[1], q[2]], s: [0.16, 0.03, 0.05], yaw, mat: m.rim, cast: false }); }
  if (load) { const mm = load === 'coal' ? m.coal : m.ore; for (let i = 0; i < 6; i++) { const q = at(p, (r() - 0.5) * (L - 0.35), 0.26 + H - 0.08 + r() * 0.08, (r() - 0.5) * (W - 0.3), yaw); B.rock({ p: [q[0], q[1], q[2]], r: 0.16 + r() * 0.1, squash: [1.3, 0.6, 1.1], amp: 0.5, seed: seed * 7 + i, detail: 1, mat: mm, cast: true }); } }
  B.colliders.addBox({ x: p[0], y: p[1] + 0.5, z: p[2], hx: L / 2 + 0.1, hy: 0.5, hz: W / 2 + 0.06, yaw, surface: 'metal', walk: true });
}
const gauge2 = 0.61;

// ------------------------------------------------------------------ pipes, valves, handrails, ladders
/** Pipe run through points with flanges and hangers. r radius; flange every ~n m. */
function pipeRunOld(B, pts, r, mat, { flangeMat = mat, flange = 4, bracket = 0, bracketMat = mat, seg = 14, joint = 'sphere', cast = true } = {}) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; cylBetween(B, a, b, r, mat, { seg, cast }); const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (i > 0 && joint === 'sphere') B.sphere({ p: a, r: r * 1.001, seg: Math.max(10, seg), mat, cast });
    if (flange > 0) for (let s = flange / 2; s < L; s += flange) { const t = s / L; const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; const d = 0.05 / L; cylBetween(B, [q[0] - (b[0] - a[0]) * d, q[1] - (b[1] - a[1]) * d, q[2] - (b[2] - a[2]) * d], [q[0] + (b[0] - a[0]) * d, q[1] + (b[1] - a[1]) * d, q[2] + (b[2] - a[2]) * d], r * 1.22, flangeMat, { seg, cast: false }); }
    acc += L;
  }
}
/** handrail along a→b at 1.05 m with mid rail, posts every ~1.6 m, toe board. y = floor height. */
export function handrail(B, mat, a, b, { h = 1.05, posts = 1.6, toe = true, r = 0.021, gapAt = null } = {}) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz); const n = Math.max(1, Math.round(L / posts));
  for (let i = 0; i <= n; i++) { const t = i / n; B.cyl({ p: [a[0] + dx * t, a[1], a[2] + dz * t], r: 0.019, h: h + 0.02, seg: 6, mat, cast: false }); }
  for (const hh of [h, h * 0.52]) cylBetween(B, [a[0], a[1] + hh, a[2]], [b[0], b[1] + hh, b[2]], r, mat, { seg: 6, cast: false });
  if (toe) { const yaw = Math.atan2(-dz, dx); B.box({ p: [(a[0] + b[0]) / 2, a[1] + 0.01, (a[2] + b[2]) / 2], s: [L, 0.11, 0.012], yaw, mat, bevel: 0.002, cast: false }); }
}
/** vertical steel ladder with rungs (wall-mounted): base centre p, facing yaw (rungs on the +z-local side), height h */
export function steelLadder(B, mat, p, h, yaw = 0, { width = 0.46, rung = 0.28, cage = false } = {}) {
  for (const s of [-1, 1]) { const q = at(p, s * width / 2, 0, 0, yaw); B.box({ p: [q[0], p[1], q[2]], s: [0.04, h, 0.07], yaw, mat, bevel: 0.004, cast: false }); }
  for (let y = 0.22; y < h - 0.05; y += rung) { const q = at(p, 0, y, 0.02, yaw); B.cyl({ p: [q[0], q[1], q[2]], r: 0.013, h: width, seg: 6, mat, roll: PI / 2, yaw, anchor: 'center', cast: false }); }
  if (cage) for (let y = 2.2; y < h; y += 0.9) for (let k = 0; k < 6; k++) { const a0 = -PI / 2 + k * PI / 5 - 0.0; const q = at(p, Math.sin(a0 - PI / 2 + PI / 2) * 0.35, y, 0.35 + Math.cos(a0 + PI / 2) * 0.35 * 0, yaw); }
}

// ------------------------------------------------------------------ small props
function barrelOld(B, mat, p, { h = 0.88, r = 0.29, yaw = 0, tilt = 0, hoops = true } = {}) { B.cyl({ p, r, h, seg: 16, mat, yaw, pitch: tilt, col: tilt ? false : 'metal' }); if (hoops) for (const y of [0.12, h * 0.5, h - 0.12]) B.cyl({ p: [p[0], p[1] + y, p[2]], r: r + 0.008, h: 0.035, seg: 16, mat, cast: false }); }
export function sack(B, mat, p, { yaw = 0, s = 1, seed = 1 } = {}) { const r = makeRng(seed); B.sphere({ p: [p[0], p[1] + 0.13 * s, p[2]], r: 0.22 * s, seg: 10, scale: [1.3, 0.62, 0.9], yaw, mat, cast: true }); }
function crateBoxOld(B, mat, p, s = [0.6, 0.4, 0.4], { yaw = 0, batten = null, col = 'wood', label = null } = {}) { B.box({ p, s, yaw, mat, bevel: 0.01, col }); if (batten) { const [w, h, d] = s; for (const k of [-1, 1]) { const q = at(p, k * (w / 2 - 0.03), 0, 0, yaw); B.box({ p: [q[0], p[1], q[2]], s: [0.05, h + 0.01, d + 0.012], yaw, mat: batten, bevel: 0.004, cast: false }); } } }

// ------------------------------------------------------------------ misc shared
export function makeHalos(B, n = 160) { const h = new HaloBatch(n); B.group.add(h.mesh); return h; }
export { makeBeam };

/** flat quad with UV 0..1 (for sign/canvas materials). p = centre, facing local +z rotated by yaw/pitch/roll. */
const quadRaw = (w, h) => ({ p: new Float32Array([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0]), n: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), u: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), i: new Uint32Array([0, 1, 2, 0, 2, 3]) });
export function signQuad(B, mat, p, w, h, yaw = 0, { pitch = 0, roll = 0, cast = false } = {}) { B.addRaw(quadRaw(w, h), mat4(p, yaw, pitch, roll), mat, { cast }); }

let _pt = null;
/** soft-edged dark puddle: alpha blob, glossy (use with signQuad pitch -PI/2) */
export function puddleMaterial(color = 0x0b0a09) {
  if (!_pt) _pt = canvasTexture(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); const r = makeRng(9); for (let k = 0; k < 7; k++) { const cx = 128 + (r() - 0.5) * 90, cy = 128 + (r() - 0.5) * 70, rr = 40 + r() * 46; const gr = g.createRadialGradient(cx, cy, rr * 0.2, cx, cy, rr); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, rr * 1.15, rr * 0.8, r() * 3, 0, TAU); g.fill(); } }, { srgb: true });
  return std({ color, alphaMap: _pt, transparent: true, depthWrite: false, roughness: 0.03, metalness: 0.0, opacity: 0.94, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, key: 'puddle' });
}

// ------------------------------------------------------------------ fluorescent / emergency tube light
/** tube fixture: housing + emissive tube along local x (yaw), halo dots, pooled light, bake. p = centre. */
export function tubeLamp(E, p, o = {}) {
  const { B, ctx, halos, bake } = E; const { yaw = 0, len = 1.2, color = 0xb8f4ff, I = 9, R = 10, glowK = 9, size = 0.6, flicker = 0, real = true, housingMat = null, dir = [0, -1, 0], pool = 0, floorY = 0 } = o;
  const tube = B.m('tubeGlow' + color, std({ color: 0x000000, emissive: color, emissiveIntensity: glowK, roughness: 0.3, key: 'tubeGlow' + color }));
  if (housingMat) B.box({ p: [p[0], p[1] - 0.05, p[2]], s: [len + 0.06, 0.06, 0.15], yaw, mat: housingMat, bevel: 0.01, cast: false });
  B.box({ p: [p[0], p[1] - 0.075, p[2]], s: [len, 0.028, 0.045], yaw, mat: tube, bevel: 0.008, cast: false });
  const n = Math.max(2, Math.round(len / 0.5)); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n - 0.5; const q = at(p, t * len, -0.09, 0, yaw); halos.add(q, color, size * 0.6, 0.5 / Math.sqrt(n / 2), flicker > 0 ? 6 : 0); }
  if (E.gloss) E.gloss.push({ p: [p[0], p[1] - 0.09, p[2]], c: lin(color).map((v) => v * glowK * 0.5), s: Math.max(0.2, len * 0.32) });
  if (pool > 0) lightPool(B, [p[0], floorY + 0.02, p[2]], pool, 0.12, color);
  if (bake) bake.light({ p: [p[0], p[1] - 0.2, p[2]], c: lin(color), I: I * 0.3, R: R * 1.4, s: 0.6, shadow: !!o.bakeShadow });
  return real ? ctx.light({ pos: [p[0], p[1] - 0.25, p[2]], color, intensity: I, distance: R, decay: 2, flicker, flickerSpeed: 13, kind: 'point' }) : null;
}

// ------------------------------------------------------------------ transparent still water with ripple normals, fresnel alpha and analytic emitter reflections
/**
 * Water surface material: dark tint, transparent by fresnel, animated ripple normals (uTime), and reflections of a list of point emitters
 * [{p:[x,y,z] world, c:[r,g,b] radiance, s: radius(m)}] evaluated analytically in the fragment shader (streaks on the ripples).
 */
export function waterMaterial({ color = 0x03100f, emitters = [], alphaBase = 0.86, ripple = 1, scale = 1, key = 'water', alphaMap = null, decal = false, shade = '' } = {}) {
  const N = 24; const P = new Array(N).fill(0).map(() => new THREE.Vector4(0, -9999, 0, 0.1)), C = new Array(N).fill(0).map(() => new THREE.Vector4(0, 0, 0, 0));
  emitters.slice(0, N).forEach((e, i) => { P[i].set(e.p[0], e.p[1], e.p[2], e.s ?? 0.3); C[i].set(e.c[0], e.c[1], e.c[2], 1); });
  const m = std({ color, roughness: 0.035, metalness: 0.0, transparent: true, depthWrite: false, opacity: 1, key: key + 'M', envMapIntensity: 1.0, alphaMap, ...(decal ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}), frag: `
    { float amk = diffuseColor.a; vec3 wp = vWPos; float t = uTime * ${(0.7 * ripple).toFixed(3)};
      vec2 q1 = wp.xz * ${(0.9 * scale).toFixed(3)} + vec2(t * 0.11, t * 0.07), q2 = wp.xz * ${(2.6 * scale).toFixed(3)} + vec2(-t * 0.19, t * 0.13), q3 = wp.xz * ${(7.0 * scale).toFixed(3)} + vec2(t * 0.3, -t * 0.21); float e = 0.07;
      float n1 = zfbm3(vec3(q1, t * 0.2)); vec2 g1 = vec2(zfbm3(vec3(q1 + vec2(e, 0.0), t * 0.2)) - n1, zfbm3(vec3(q1 + vec2(0.0, e), t * 0.2)) - n1) / e;
      float n2 = zvn3(vec3(q2, t * 0.3)); vec2 g2 = vec2(zvn3(vec3(q2 + vec2(e, 0.0), t * 0.3)) - n2, zvn3(vec3(q2 + vec2(0.0, e), t * 0.3)) - n2) / e;
      float n3 = zvn3(vec3(q3, t * 0.5)); vec2 g3 = vec2(zvn3(vec3(q3 + vec2(e, 0.0), t * 0.5)) - n3, zvn3(vec3(q3 + vec2(0.0, e), t * 0.5)) - n3) / e;
      vec2 gr = (g1 * 0.035 + g2 * 0.02 + g3 * 0.008) * ${ripple.toFixed(2)}; vec3 wn = normalize(vec3(-gr.x, 1.0, -gr.y)); normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
      vec3 V = normalize(cameraPosition - wp); float ndv = clamp(dot(wn, V), 0.0, 1.0); float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
      vec3 R = reflect(-V, wn); vec3 refl = vec3(0.0);
      for (int i = 0; i < ${N}; i++) { vec4 pe = uEmP[i]; if (pe.y < -9000.0) break; vec3 L = pe.xyz - wp; float tt = dot(L, R); if (tt <= 0.0) continue; float d2 = dot(L, L) - tt * tt; float a2 = pe.w * pe.w / (tt * tt); float ang2 = d2 / (tt * tt); refl += uEmC[i].rgb * exp(-ang2 / (a2 * 2.0 + 0.0005)) * (a2 + 0.0004) * 12.0; }
      totalEmissiveRadiance += refl * (0.25 + 0.75 * F) * 2.0;
      ${shade}
      diffuseColor.a = amk * clamp(${alphaBase.toFixed(2)} - 0.15 + 0.15 * (1.0 - F) - F * 0.9, 0.03, 0.97); }` });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => { base(shader, r); shader.uniforms.uEmP = { value: P }; shader.uniforms.uEmC = { value: C }; shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform vec4 uEmP[${N}]; uniform vec4 uEmC[${N}];`); };
  m.customProgramCacheKey = () => 'waterEm' + key + N + (ripple * 100 | 0) + (scale * 100 | 0);
  m.userData.emitters = { P, C };
  return m;
}
/** flat water rectangle mesh (world-space plane in the stop group). p centre (y = surface). */
export function waterRect(B, mat, p, w, d) { const g = new THREE.PlaneGeometry(w, d, 1, 1); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.set(p[0], p[1], p[2]); m.renderOrder = 4; B.group.add(m); return m; }

// ------------------------------------------------------------------ drips: falling droplets + ripple rings at the impact point
export class Drips {
  constructor(fx, points) { this.fx = fx; this.pts = points.map((q) => ({ p: q.p, y: q.y ?? 0, rate: q.rate ?? 1.5, t: Math.random() * 3, h: q.h ?? 3, ring: q.ring ?? true })); }
  update(dt, active) {
    if (!active) return; const fx = this.fx;
    for (const q of this.pts) { q.t -= dt; if (q.t > 0) continue; q.t = q.rate * (0.5 + Math.random()); const fall = Math.sqrt(2 * q.h / 9.81);
      fx.alpha.emit({ p: q.p, v: [0, 0, 0], life: fall, size: [0.012, 0.012], c0: [0.75, 0.85, 0.9, 0.55], c1: [0.75, 0.85, 0.9, 0.55], gravity: 1, cell: 7, stretch: 0.0 }, fx.time);
      if (q.ring) fx.schedule(fall, () => { fx.alpha.emit({ p: [q.p[0], q.y + 0.01, q.p[2]], v: [0, 0, 0], life: 1.3, size: [0.03, 0.55], c0: [0.7, 0.85, 0.9, 0.5], c1: [0.7, 0.85, 0.9, 0], cell: 14, rot: 0 }, fx.time); fx.alpha.emit({ p: [q.p[0], q.y + 0.02, q.p[2]], v: [0, 0.5, 0], life: 0.35, size: [0.02, 0.03], c0: [0.8, 0.9, 0.95, 0.5], c1: [0.8, 0.9, 0.95, 0], gravity: 1, cell: 7 }, fx.time); });
    }
  }
}
export const _tmpV = new THREE.Vector3();

/** wall with rectangular holes. p = centre of the wall base, yaw, w (along local x), h, t (thickness). holes: [{x0,x1,y0,y1}] in local coords (x from -w/2..w/2). */
export function wallHoles(B, mat, { p, yaw = 0, w, h, t, holes = [], col = 'brick', bevel = 0.02, cast = true }) {
  const xs = new Set([-w / 2, w / 2]); for (const q of holes) { xs.add(Math.max(-w / 2, q.x0)); xs.add(Math.min(w / 2, q.x1)); } const xv = [...xs].sort((a, b) => a - b);
  for (let i = 0; i < xv.length - 1; i++) {
    const xa = xv[i], xb = xv[i + 1]; if (xb - xa < 0.01) continue; const cover = holes.filter((q) => q.x0 <= xa + 1e-4 && q.x1 >= xb - 1e-4).sort((a, b) => a.y0 - b.y0); let y = 0;
    const seg = (ya, yb) => { if (yb - ya < 0.01) return; const q = at(p, (xa + xb) / 2, ya, 0, yaw); B.box({ p: [q[0], q[1], q[2]], s: [xb - xa, yb - ya, t], yaw, mat, bevel, col, cast }); };
    for (const c of cover) { seg(y, c.y0); y = Math.max(y, c.y1); } seg(y, h);
  }
}

/**
 * Cheek walls for a B.stairs() run (same params): sloped stringer beams (visual) + full-height side colliders. The colliders make nav cells beside the
 * stairs unreachable from the side (the flow field is 2D, so without them zombies would try to walk sideways into a step that is a wall for them).
 */
export function stairCheeks(B, mat, { p, yaw = 0, n, rise = 0.18, run = 0.28, w, t = 0.1, surface = 'wood', col = true, sides = [-1, 1] }) {
  for (const s of sides) {
    const lz = s * (w / 2 + t / 2), a = at(p, 0, 0.02, lz, yaw), b = at(p, n * run, n * rise + 0.02, lz, yaw);
    B.beam([a[0], a[1] + 0.12, a[2]], [b[0], b[1] + 0.12, b[2]], t, 0.26, { mat, bevel: 0.01, cast: true });
    if (col) { const c = at(p, n * run / 2, n * rise / 2, lz, yaw); B.colliders.addBox({ x: c[0], y: c[1], z: c[2], hx: n * run / 2, hy: n * rise / 2 + 0.05, hz: t / 2, yaw, surface, walk: false }); }
  }
}

/**
 * Nav helper (2D flow fields cannot see cliffs): returns blockedFn(x, z, gy) that forbids LOW cells that have a walkable *deck* (a collider tagged 'deck')
 * more than `thr` metres higher within `r` metres — i.e. the foot of every platform/ledge edge — while stairs (rise < thr over r) stay open.
 * Tag platform boxes with `tag: 'deck'` in B.box. `extra` composes another fn.
 */
export function cliffBlocker(colliders, { r = 0.72, thr = 0.72, extra = null } = {}) {
  const o1 = { y: 0, col: null }, D = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
  return (x, z, gy) => {
    if (extra && extra(x, z, gy)) return true;
    for (const [dx, dz] of D) for (const k of [1, 0.5]) { colliders.ground(x + dx * r * k, z + dz * r * k, 1e6, 0, o1); if (o1.y > gy + thr && o1.col && o1.col.tag === 'deck') return true; }
    return false;
  };
}

/** Overview aid: when the camera floats high above an underground stop (inside solid rock, e.g. tools/capture overview shots) a soft work light
 *  switches on so the layout can be judged. Never active in play (the player cannot leave the cavity). Returns update(active). */
export function cutawayFill(ctx, { pos, color = 0xffc890, intensity = 700, distance = 70, ceil = 7.5, minZ = 4 }) {
  const src = ctx.light({ pos, color, intensity: 0, distance, decay: 2, kind: 'point' }); const oy = ctx.origin.y, cam = ctx.gfx.camera.position, ox = ctx.origin.x, oz = ctx.origin.z;
  return (active) => { const on = active && cam.y - oy > ceil && cam.z - oz > minZ && Math.abs(cam.x - ox) < 70; src.intensity = on ? intensity : 0; if (on) src.pos.set(cam.x, cam.y + 1.0, cam.z); };   // a work light that follows the (out-of-bounds) overview camera
}

// ------------------------------------------------------------------ analytic lamp reflections on smooth / wet materials
/**
 * Fake area-light specular for every glossy material of a Builder: streaks of the given emitters ([{p: STOP-LOCAL, c: [r,g,b] linear radiance, s: radius m}], max 24)
 * are added to the emission along the mirror direction, with a lobe that widens with roughness and a Fresnel term (F0 from albedo for metals).
 * Wet floors, pipes and pump casings then pick up long lamp streaks that the 4-8 pooled real lights alone could never provide.
 */
export function lampGloss(B, oy, emitters, { k = 1.0, skip = (m) => false } = {}) {
  const N = 24; const P = Array.from({ length: N }, () => new THREE.Vector4(0, -9999, 0, 0.1)), C = Array.from({ length: N }, () => new THREE.Vector4());
  emitters.slice(0, N).forEach((e, i) => { P[i].set(e.p[0], e.p[1] + oy, e.p[2], e.s ?? 0.3); C[i].set(e.c[0], e.c[1], e.c[2], 1); });
  const code = `
  { vec3 gV = normalize(cameraPosition - vWPos); vec3 gN = normalize((vec4(normal, 0.0) * viewMatrix).xyz); float gnv = clamp(dot(gN, gV), 0.0, 1.0);
    float gr = clamp(roughnessFactor, 0.03, 1.0); float gk = smoothstep(0.86, 0.28, gr);
    if (gk > 0.001) { vec3 F0 = mix(vec3(0.04), diffuseColor.rgb, metalnessFactor); vec3 gF = F0 + (vec3(1.0) - F0) * pow(1.0 - gnv, 5.0);
      vec3 gR = reflect(-gV, gN); vec3 acc = vec3(0.0); float r2 = gr * gr; float lobe = r2 * r2 * 0.5 + 0.0004;
      for (int i = 0; i < ${N}; i++) { vec4 pe = uGlP[i]; if (pe.y < -9000.0) break; vec3 L = pe.xyz - vWPos; float tt = dot(L, gR); if (tt <= 0.05) continue;
        float d2 = dot(L, L) - tt * tt; float a2 = pe.w * pe.w / (tt * tt); float sig2 = a2 + lobe; float ang2 = d2 / (tt * tt);
        acc += uGlC[i].rgb * exp(-ang2 / (2.0 * sig2)) * (a2 + 0.0004) * (a2 / sig2) * 12.0; }
      totalEmissiveRadiance += acc * gF * gk * ${k.toFixed(3)}; } }
  `;
  let n = 0;
  for (const m of B.mats.values()) {
    if (!m.isMeshStandardMaterial || m.transparent || (m.emissive && m.emissive.getHex() !== 0) || skip(m)) continue;
    const base = m.onBeforeCompile, key = (m.customProgramCacheKey ? m.customProgramCacheKey() : '') + '|lg' + (k * 100 | 0);
    m.onBeforeCompile = (shader, renderer) => {
      if (base) base(shader, renderer); shader.uniforms.uGlP = { value: P }; shader.uniforms.uGlC = { value: C };
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform vec4 uGlP[${N}]; uniform vec4 uGlC[${N}];`).replace('#include <lights_physical_fragment>', code + '\n#include <lights_physical_fragment>');
    };
    m.customProgramCacheKey = () => key; n++;
  }
  return { P, C, count: n };
}

/** a puddle decal that reflects the stop's lamps (same analytic emitter reflections as the water); fill it later with setEmitters(mat, list, oy) */
export function puddleWater(color = 0x040a0a) {
  const puddle = puddleMaterial(color); const m = waterMaterial({ color, emitters: [], alphaBase: 0.98, ripple: 0.12, scale: 1.4, key: 'pud', alphaMap: puddle.alphaMap, decal: true }); m.opacity = 0.96; return m;
}
export function setEmitters(mat, emitters, oy = 0) { const { P, C } = mat.userData.emitters; for (let i = 0; i < P.length; i++) { const e = emitters[i]; if (e) { P[i].set(e.p[0], e.p[1] + oy, e.p[2], e.s ?? 0.3); C[i].set(e.c[0], e.c[1], e.c[2], 1); } else { P[i].set(0, -9999, 0, 0.1); C[i].set(0, 0, 0, 0); } } }

/** tiny build profiler: const ph = phaser('crystal'); ph('cavity bake'); ...; ph.done() logs "[crystal] cavity bake 812 ms | ..." */
export function phaser(name) { let t = performance.now(); const t0 = t, rows = []; const f = (label) => { const n = performance.now(); rows.push(`${label} ${(n - t).toFixed(0)}`); t = n; }; f.done = () => console.log(`[${name}] phases (ms): ${rows.join(' | ')} | total ${(performance.now() - t0).toFixed(0)}`); return f; }

/** dev: ?bakebench=1 re-runs a cavity bake 4x and logs the fastest run (wall-clock is noisy on a shared machine) */
export function bakeBench(name, run) { try { if (!new URLSearchParams(location.search).get('bakebench')) return; let best = 1e9; for (let i = 0; i < 4; i++) { const t = performance.now(); run(); best = Math.min(best, performance.now() - t); } console.log(`[${name}] bake best-of-4 ${best.toFixed(0)} ms`); } catch (e) { /* not in a browser */ } }

// ------------------------------------------------------------------ program / draw-call hygiene
const _hs = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
/** canonical program cache key of a patched material: the patch flags + every numeric constant the patch bakes into the shader source, WITHOUT the cosmetic `key` name
 *  (std({key}) made every plain material its own program). Tags appended by bakeable()/lampGloss()/extendMaterial() ('|bk', '|lg100', ...) are kept. */
function canonKey(m) { return null; } // (core patch() keys programs canonically now — snow/breakup/wet/triplanar/detail strengths are runtime uniforms; nothing to recompute here)
/**
 * Call once per stop AFTER the Builder finished (data.onReady): (1) gives every patched material its canonical program key so look-alike materials share ONE GPU program,
 * (2) sorts the opaque static draws by program (renderOrder = program rank) so the renderer switches programs once per program instead of once per material.
 * Returns {programs, meshes}.
 */
export function unifyPrograms(group, { sort = true } = {}) {
  const done = new Set(); const sig = new Map(); let meshes = 0;
  group.traverse((o) => {
    if (!o.isMesh || !o.material || o.userData.shadowProxy) return; const m = o.material; meshes++;
    if (!done.has(m)) { done.add(m); const k = canonKey(m); if (k) m.customProgramCacheKey = () => k; }
    if (!sort || m.transparent || o.renderOrder !== 0 || !m.customProgramCacheKey) return;
    const g = o.geometry, a = g && g.attributes; const s = m.customProgramCacheKey() + '|' + (m.map ? 1 : 0) + (m.normalMap ? 1 : 0) + (m.aoMap ? 1 : 0) + (m.roughnessMap ? 1 : 0) + (m.alphaTest > 0 ? 1 : 0) + m.side + (o.isInstancedMesh ? 'I' : '') + (a && a.aVis ? 'V' : '') + (a && a.aBake ? 'K' : '') + (o.isInstancedMesh && o.instanceColor ? 'C' : '');
    let l = sig.get(s); if (!l) { l = []; sig.set(s, l); } l.push(o);
  });
  const names = [...sig.keys()].sort(); names.forEach((n, i) => { for (const o of sig.get(n)) o.renderOrder = 1 + i; });
  return { programs: names.length, meshes };
}
/** add uniforms + declarations to a patched material's fragment shader (survives the Builder's vis-variant cloning when applied in data.onReady) */
export function extendMaterial(mat, { uniforms = {}, decl = '', tag = 'ext' }) {
  const base = mat.onBeforeCompile, cur = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '', key = cur + '|' + tag;
  mat.onBeforeCompile = (shader, renderer) => { if (base) base(shader, renderer); Object.assign(shader.uniforms, uniforms); shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${decl}`); };
  mat.customProgramCacheKey = () => key; return mat;
}
/** box-filter the baked sky-visibility (aVis.y) of a static ground mesh over `cell` metres: removes the vertex-lattice pattern of the per-vertex horizon scan */
export function smoothVis(geo, cell = 3) {
  const pos = geo.attributes.position, vis = geo.attributes.aVis; if (!pos || !vis) return; const n = pos.count, st = vis.itemSize, arr = vis.array; const sum = new Map(), cnt = new Map();
  const key = (i, j) => i * 65537 + j; const cx = new Int32Array(n), cz = new Int32Array(n);
  for (let v = 0; v < n; v++) { const i = Math.floor(pos.getX(v) / cell), j = Math.floor(pos.getZ(v) / cell); cx[v] = i; cz[v] = j; const k = key(i, j); sum.set(k, (sum.get(k) || 0) + arr[v * st + 1]); cnt.set(k, (cnt.get(k) || 0) + 1); }
  for (let v = 0; v < n; v++) { let s = 0, c = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const k = key(cx[v] + a, cz[v] + b); const q = cnt.get(k); if (q) { s += sum.get(k); c += q; } } arr[v * st + 1] = arr instanceof Uint8Array ? Math.round(s / c) : s / c; }
  vis.needsUpdate = true;
}
/**
 * Make look-alike materials share one program: patch() bakes the breakup amount / wet flag of every material into its shader source, so materials that differ only by a
 * cosmetic constant (0.4 vs 0.6) are separate programs. Call at the end of a stop's build (before Builder.finish clones vis variants).
 * o: {breakup: common amount, addBreakup: also give textured materials without one the flag, wet: true|false (textured materials), skip(mat)}. Materials with frag/vertex/wind code are untouched.
 */
export function normalizePatch(B, { breakup = 0.5, addBreakup = false, wet = null, skip = () => false } = {}) {
  let n = 0;
  for (const m of B.mats.values()) {
    const o = m.userData && m.userData.patchOpts; if (!o || o.frag || o.vertex || o.wind || skip(m)) continue;
    if (o.breakup || (addBreakup && m.map)) o.breakup = breakup; if (wet !== null && (m.map || o.wet)) o.wet = wet ? true : undefined; n++;
  }
  return n;
}

// ------------------------------------------------------------------ real-construction props (parts.js) behind the original kit signatures
const _prng = (seed, k = 17) => makeRng(((seed | 0) * 7919 + k) >>> 0);
const _iron = (B, m) => m.iron || m.steelRaw || B.mats.get('steelRaw') || B.mats.get('tIron') || m.rail || m.post;
export function timberSet(B, m, o) { const P = new Parts(B, _prng(o.seed ?? 1, 13)); tsReal(P, { post: m.post, board: m.board || m.post, iron: _iron(B, m) }, { ...o, col: o.colPosts ?? true }); P.flush(); }
export function lagging(B, m, o) { const P = new Parts(B, _prng(o.seed ?? 1, 7)); lgReal(P, { board: m.board || m.post, post: m.post }, o); P.flush(); }
export function railLine(B, m, a, b, o = {}) { const P = new Parts(B, _prng(o.seed ?? 3, 5)); rlReal(P, { sleeper: m.sleeper, rail: m.rail, ballast: m.ballast, iron: _iron(B, m) }, a, b, o); P.flush(); }
export function tub(B, m, o) { const P = new Parts(B, _prng(o.seed ?? 1, 71)); oreCart(P, { tub: m.tub, rim: m.rim, wheel: m.wheel, iron: m.rim || m.tub, coal: m.coal, ore: m.ore }, o); P.flush(); B.colliders.addBox({ x: o.p[0], y: o.p[1] + 0.5, z: o.p[2], hx: 0.775, hy: 0.5, hz: 0.42, yaw: o.yaw || 0, surface: 'metal', walk: true }); }
export function barrel(B, mat, p, { yaw = 0, tilt = 0 } = {}) { const P = new Parts(B, _prng(Math.round(p[0] * 31 + p[2] * 17), 3)); drumReal(P, mat, mat, p, { yaw: yaw || P.rnd() * 6.283, tilt }); P.flush(); if (!tilt) B.colliders.addCyl({ x: p[0], z: p[2], r: 0.3, y0: p[1], y1: p[1] + 0.87, surface: 'metal', walk: true }); }
export function crateBox(B, mat, p, s = [0.6, 0.4, 0.4], { yaw = 0, col = 'wood' } = {}) { const P = new Parts(B, _prng(Math.round(p[0] * 31 + p[2] * 17), 5)); crateReal(P, mat, B.mats.get('steelRaw') || B.mats.get('tIron') || mat, p, s, yaw); P.flush(); if (col) B.colliders.addBox({ x: p[0], y: p[1] + s[1] / 2, z: p[2], hx: s[0] / 2, hy: s[1] / 2, hz: s[2] / 2, yaw, surface: col, walk: true }); }
export function pipeRun(B, pts, r, mat, { flangeMat = mat, flange = 4, seg = 14 } = {}) { const P = new Parts(B, _prng(Math.round(pts[0][0] * 13 + pts[0][1] * 5 + pts[0][2] * 7), 9)); pipeReal(P, mat, flangeMat, pts, r, { every: Math.max(1.4, flange), seg: Math.min(Math.max(seg, 8), 16) }); P.flush(); }
