// Effects: GPU-driven particles (ring buffers, motion evaluated in the vertex shader), instanced PBR decals, tracers,
// shell casings, camera-volume weather, and a surface-aware impact table. All textures are generated in code.
import * as THREE from 'three';
import { G, FOG_GLSL, std } from './mats.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { makeRng, rand, clamp, lerp, TAU } from './util.js';

const V = new THREE.Vector3();

// ------------------------------------------------------------------ procedural sprite atlas (4x4 cells of 128px)
function cellNoise(w) { const r = makeRng(99); const g = new Float32Array((w + 1) * (w + 1)); for (let i = 0; i < g.length; i++) g[i] = r(); return g; }
export function makeSpriteAtlas() {
  const S = 512, C = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S); const d = img.data; const rng = makeRng(7);
  const vn = (x, y, f, seed) => { const X = Math.floor(x * f), Y = Math.floor(y * f), fx = x * f - X, fy = y * f - Y; const h = (a, b) => { let n = (a * 374761393 + b * 668265263 + seed * 1442695041) | 0; n = (n ^ (n >> 13)) * 1274126177 | 0; return ((n ^ (n >> 16)) >>> 0) / 4294967296; }; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return lerp(lerp(h(X, Y), h(X + 1, Y), sx), lerp(h(X, Y + 1), h(X + 1, Y + 1), sx), sy); };
  const fbm = (x, y, seed) => 0.5 * vn(x, y, 3, seed) + 0.25 * vn(x, y, 6, seed + 1) + 0.15 * vn(x, y, 12, seed + 2) + 0.1 * vn(x, y, 24, seed + 3);
  const put = (cell, fn) => { const ox = (cell % 4) * C, oy = Math.floor(cell / 4) * C; for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const u = x / (C - 1) * 2 - 1, v = y / (C - 1) * 2 - 1; const a = clamp(fn(u, v, x / C, y / C)) * sm(1, 0.72, Math.abs(u)) * sm(1, 0.72, Math.abs(v)); const i = ((oy + y) * S + ox + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255); } };
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  put(0, (u, v) => Math.pow(clamp(1 - Math.hypot(u, v)), 1.6));                                              // 0 soft round
  put(1, (u, v, x, y) => { const r = Math.hypot(u, v); const n = fbm(x, y, 11); return sm(1, 0.15, r + (n - 0.5) * 0.9) * (0.6 + 0.4 * n); }); // 1 smoke puff
  put(2, (u, v) => Math.pow(clamp(1 - Math.abs(u)), 6) * Math.pow(clamp(1 - Math.abs(v) * 7), 1.4));         // 2 streak (x-axis)
  put(3, (u, v) => sm(0.42, 0.0, Math.hypot(u, v)) + 0.4 * Math.pow(clamp(1 - Math.hypot(u, v)), 3));       // 3 flake
  put(4, (u, v) => { const a = Math.atan2(v, u), r = Math.hypot(u, v); const ray = Math.pow(Math.abs(Math.cos(a * 4.5 + 0.6)), 8) * 0.9 + Math.pow(Math.abs(Math.cos(a * 2)), 24) * 0.5; return clamp(ray * sm(1, 0.05, r) + sm(0.35, 0, r)); }); // 4 muzzle star
  put(5, (u, v) => { const r = Math.hypot(u, v); return sm(0.12, 0, Math.abs(r - 0.75)) * 0.9; });           // 5 ring
  put(6, (u, v) => { const k = Math.abs(u) * 1.9 + Math.abs(v) * 0.75; return sm(1.0, 0.85, k); });          // 6 shard
  put(7, (u, v) => sm(0.5, 0.42, Math.hypot(u, v) * 1.25 + (u * u * 0.0)));                                  // 7 droplet (hard-ish)
  put(8, (u, v, x, y) => { const r = Math.hypot(u * 1.0, v * 0.8 + 0.15); const n = fbm(x, y - 0.0, 21); return sm(0.95, 0.1, r + (n - 0.5) * 0.7) * (0.75 + 0.5 * n); }); // 8 fire blob
  put(9, (u, v, x, y) => { const r = Math.hypot(u, v); const n = fbm(x, y, 31); return sm(1, 0.3, r + (n - 0.5) * 1.1) * 0.65; }); // 9 dust
  put(10, (u, v) => Math.exp(-Math.hypot(u, v) * 3.6));                                                       // 10 glow
  put(11, (u, v) => Math.max(Math.pow(clamp(1 - Math.abs(u)), 9) * Math.pow(clamp(1 - Math.abs(v) * 14), 2), Math.pow(clamp(1 - Math.abs(v)), 9) * Math.pow(clamp(1 - Math.abs(u) * 14), 2)) + sm(0.3, 0, Math.hypot(u, v)) * 0.6); // 11 flare cross
  put(12, (u, v, x, y) => { const n = fbm(x, y, 5); return sm(0.8, 0.5, Math.hypot(u, v) + (n - 0.5) * 0.9); });  // 12 chunk
  put(13, (u, v) => Math.pow(clamp(1 - Math.abs(u) * 8), 1.3) * Math.pow(clamp(1 - Math.abs(v)), 0.6));     // 13 rain streak (y-axis)
  put(14, (u, v) => { const r = Math.hypot(u, v); return sm(0.16, 0, Math.abs(r - 0.6)) * 0.7 + sm(0.5, 0.4, r) * 0.08; }); // 14 bubble
  put(15, (u, v, x, y) => { const a = Math.atan2(v, u), r = Math.hypot(u, v); const n = 0.55 + 0.45 * vn(Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 + 0.5, 7, 3); return sm(n, n - 0.15, r) * (0.6 + 0.4 * fbm(x, y, 41)); }); // 15 splat
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4; tex.premultiplyAlpha = false;
  return tex;
}

// ------------------------------------------------------------------ GPU-baked flipbooks (fire + smoke): 8x8 frames of a turbulent fireball / billowing smoke puff, evolving over the particle's life
const FLIP_N = 8, FLIP_PX = 144;
const FLIP_BAKE_FS = /* glsl */`
precision highp float; varying vec2 vUv; uniform float uKind; // 0 = fire (rgb = emission colour, a = coverage), 1 = smoke (rgb = shading, a = coverage)
float h13(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y), mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
void main(){
  vec2 g = vUv * ${FLIP_N}.0; vec2 cell = floor(g); vec2 q = fract(g) * 2.0 - 1.0; float fi = cell.y * ${FLIP_N}.0 + cell.x; float t = fi / ${FLIP_N * FLIP_N - 1}.0;
  float edge = 1.0 - smoothstep(0.86, 1.0, length(q));                         // hard zero at the quad edge
  if (uKind < 0.5) {
    float R = mix(0.24, 0.8, pow(t, 0.5));
    vec3 pp = vec3(q * 1.25, t * 1.6);
    float w = fbm(pp * 1.7 + vec3(0.0, -t * 1.4, 0.0));
    float wp = fbm(pp * 3.3 + vec3(w * 1.6, w * 1.2, 0.0) - vec3(0.0, t * 2.0, 0.0));
    float r = length(q * vec2(1.0, 0.92) + vec2(0.0, 0.10 * t)) + (wp - 0.5) * (0.42 + 0.3 * t) + (w - 0.5) * 0.25;
    float d = smoothstep(R * 1.05, R * 0.12, r);
    float life = 1.0 - smoothstep(0.5, 1.0, t);
    float T = d * (1.0 - 0.9 * t) * (0.62 + 0.6 * wp);
    vec3 col = mix(vec3(0.35, 0.03, 0.0), vec3(1.0, 0.42, 0.06), smoothstep(0.10, 0.55, T));
    col = mix(col, vec3(1.0, 0.86, 0.45), smoothstep(0.55, 0.95, T)); col = mix(col, vec3(1.0, 0.96, 0.82), smoothstep(0.95, 1.3, T));
    float a = clamp(d * 1.5, 0.0, 1.0) * life * edge; a *= smoothstep(0.0, 0.05, d);
    gl_FragColor = vec4(col, a);
  } else {
    float R = mix(0.34, 0.86, pow(t, 0.45));
    vec3 pp = vec3(q * 1.3, t * 0.9);
    float w = fbm(pp * 1.6), w2 = fbm(pp * 3.6 + vec3(w * 1.4, 0.0, w * 0.8) + vec3(0.0, t * 0.7, 0.0));
    float r = length(q) + (w2 - 0.5) * 0.5 + (w - 0.5) * 0.3;
    float d = smoothstep(R * 1.05, R * 0.15, r);
    float dl = smoothstep(R * 1.05, R * 0.15, length(q - vec2(-0.10, 0.12)) + (w2 - 0.5) * 0.5 + (w - 0.5) * 0.3);   // density seen from the light side
    float shade = clamp(0.52 + (dl - d) * 1.8 + (w2 - 0.5) * 0.45, 0.12, 1.0) * (0.7 + 0.3 * smoothstep(0.0, 0.6, d));
    float a = d * 0.92 * (1.0 - smoothstep(0.7, 1.0, t)) * edge;
    gl_FragColor = vec4(vec3(shade), a);
  }
}`;
function bakeFlipbook(renderer, kind) {
  const S = FLIP_N * FLIP_PX; const rt = new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true });
  const mat = new THREE.ShaderMaterial({ vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FLIP_BAKE_FS, uniforms: { uKind: { value: kind } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const q = new FullScreenQuad(mat); const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); q.render(renderer); renderer.setRenderTarget(prev); mat.dispose(); q.dispose();
  rt.texture.anisotropy = 4; return rt.texture;
}

// ------------------------------------------------------------------ GPU particle system
const P_VS = /* glsl */`
attribute vec3 aP0; attribute vec3 aV0; attribute vec2 aLife; attribute vec2 aSize; attribute vec4 aC0; attribute vec4 aC1; attribute vec2 aRot; attribute vec4 aPar;
uniform float uTime; uniform vec3 uGravity; uniform float uStretchMax; uniform vec3 uWind;
varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos; varying float vFrame;
void main(){
  float age = uTime - aLife.x; float t01 = age / aLife.y;
  if (age < 0.0 || t01 > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  float k = aPar.y; // linear drag
  vec3 disp = k > 1e-3 ? aV0 * (1.0 - exp(-k * age)) / k : aV0 * age;
  vec3 wp = aP0 + disp + 0.5 * uGravity * aPar.x * age * age + uWind * aPar.w * age * age * 0.5;
  vec3 vel = (k > 1e-3 ? aV0 * exp(-k * age) : aV0) + uGravity * aPar.x * age + uWind * aPar.w * age;
  float size = mix(aSize.x, aSize.y, sqrt(t01));
  vec4 vp = viewMatrix * vec4(wp, 1.0);
  float nz = max(-vp.z, 0.05); size = min(size, 0.3 * nz + 0.01);   // never let one sprite cover more than ~30 % of the view (muzzle smoke drifting into the lens)
  vec2 q = position.xy; vec2 off;
  float stretch = aPar.z;
  if (stretch > 0.0) { // align quad's x axis with projected velocity
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz; vec2 dir = normalize(vv.xy + vec2(1e-5, 0.0)); float sp = length(vel);
    float len = min(size * (1.0 + stretch * sp), uStretchMax);
    off = dir * q.x * len + vec2(-dir.y, dir.x) * q.y * size;
  } else { float rot = aRot.x + aRot.y * age; float c = cos(rot), s = sin(rot); off = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * size; }
  vp.xy += off; gl_Position = projectionMatrix * vp;
  float fi = min(1.0, t01 * 14.0); float fo = 1.0 - smoothstep(0.55, 1.0, t01);
  vCol = mix(aC0, aC1, t01) * vec4(1.0, 1.0, 1.0, fi * fo * smoothstep(0.2, 0.9, nz)); // soft near fade
  vWPos = wp; vFrame = t01;
  vUv = q * 0.5 + 0.5;
}`;
const P_FS = /* glsl */`
precision highp float;
uniform sampler2D uAtlas; uniform float uAdd; uniform float uFogOn; uniform vec3 uPartLight;
varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos; varying float vFrame;
uniform vec4 uFrames; // unused
${FOG_GLSL}
flat varying float vCell;
void main(){
  float cell = vCell; vec2 co = vec2(mod(cell, 4.0), floor(cell / 4.0));
  vec2 uv = (co + clamp(vUv, 0.002, 0.998)) / 4.0; uv.y = 1.0 - uv.y;
  float a = texture2D(uAtlas, uv).a; vec4 c = vCol; c.a *= a; if (c.a < 0.003) discard;
  float ff = fogFactor(vWPos);
  if (uAdd > 0.5) gl_FragColor = vec4(c.rgb * c.a * (1.0 - ff), 0.0);
  else gl_FragColor = vec4(mix(c.rgb * uPartLight, fogColorDir(normalize(vWPos - cameraPosition)), ff), c.a);
}`;
// flipbook variant: frame = particle life fraction (two frames blended); vCell unused. Additive (fire) or alpha (smoke).
const P_FS_FLIP = /* glsl */`
precision highp float;
uniform sampler2D uFlip; uniform float uAdd; uniform vec3 uPartLight;
varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos; varying float vFrame;
${FOG_GLSL}
flat varying float vCell;
vec4 fb(float k){ float N = ${FLIP_N}.0; vec2 co = vec2(mod(k, N), floor(k / N)); return texture2D(uFlip, (co + clamp(vUv, 0.003, 0.997)) / N); }
void main(){
  float f = clamp(vFrame, 0.0, 1.0) * ${FLIP_N * FLIP_N - 1}.0; float f0 = floor(f), m = f - f0; vec4 s = mix(fb(f0), fb(min(f0 + 1.0, ${FLIP_N * FLIP_N - 1}.0)), m);
  vec4 c = vCol; c.a *= s.a; if (c.a < 0.004) discard; float ff = fogFactor(vWPos);
  if (uAdd > 0.5) gl_FragColor = vec4(c.rgb * s.rgb * c.a * (1.0 - ff), 0.0);
  else gl_FragColor = vec4(mix(c.rgb * s.rgb * uPartLight, fogColorDir(normalize(vWPos - cameraPosition)), ff), c.a);
}`;

/** One ring-buffered particle batch. additive => additive blending (fire, sparks, glows), else alpha (smoke, dust, blood). */
export class Particles {
  constructor(atlas, { max = 4096, additive = false, stretchMax = 3.0, flip = null } = {}) {
    this.max = max; this.i = 0; this.count = 0; this.dirtyMin = 1e9; this.dirtyMax = -1;
    const g = this.geo = new THREE.InstancedBufferGeometry(); g.instanceCount = max;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n, itemSize) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * itemSize), itemSize); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.a = { p0: mk('aP0', 3), v0: mk('aV0', 3), life: mk('aLife', 2), size: mk('aSize', 2), c0: mk('aC0', 4), c1: mk('aC1', 4), rot: mk('aRot', 2), par: mk('aPar', 4) };
    this.cellAttr = mk('aCell', 1);
    for (let k = 0; k < max; k++) this.a.life.array[k * 2] = -1e9;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: P_VS.replace('varying float vFrame;', 'varying float vFrame; attribute float aCell; flat varying float vCell;').replace('vUv = q * 0.5 + 0.5;', 'vUv = q * 0.5 + 0.5; vCell = aCell;'),
      fragmentShader: flip ? P_FS_FLIP : P_FS, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      uniforms: { uFlip: { value: flip }, uTime: G.uTime, uGravity: { value: new THREE.Vector3(0, -9.81, 0) }, uWind: G.uWind, uAtlas: { value: atlas }, uAdd: { value: additive ? 1 : 0 }, uStretchMax: { value: stretchMax }, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir, uFrames: { value: new THREE.Vector4() }, uFogOn: { value: 1 }, uPartLight: G.uPartLight },
    });
    if (!additive) { this.mat.blending = THREE.CustomBlending; this.mat.blendSrc = THREE.SrcAlphaFactor; this.mat.blendDst = THREE.OneMinusSrcAlphaFactor; this.mat.blendSrcAlpha = THREE.OneFactor; this.mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor; }
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 20 : 10; this.mesh.layers.set(0);
  }
  /** o: {p:[x,y,z]|Vector3, v, life, size:[s0,s1]|s, c0:[r,g,b,a] , c1, rot, rotVel, gravity(0..1 multiplier), drag, stretch, cell, wind(0..1)} */
  emit(o, time) {
    const k = this.i, A = this.a; this.i = (this.i + 1) % this.max;
    const p = o.p, v = o.v || [0, 0, 0];
    A.p0.array.set([p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]], k * 3); A.v0.array.set([v.x ?? v[0], v.y ?? v[1], v.z ?? v[2]], k * 3);
    A.life.array[k * 2] = time; A.life.array[k * 2 + 1] = o.life ?? 1;
    const sz = o.size ?? 0.2; A.size.array[k * 2] = Array.isArray(sz) ? sz[0] : sz; A.size.array[k * 2 + 1] = Array.isArray(sz) ? sz[1] : sz;
    const c0 = o.c0 || [1, 1, 1, 1], c1 = o.c1 || c0; A.c0.array.set(c0, k * 4); A.c1.array.set(c1, k * 4);
    A.rot.array[k * 2] = o.rot ?? rand() * TAU; A.rot.array[k * 2 + 1] = o.rotVel ?? 0;
    A.par.array[k * 4] = o.gravity ?? 0; A.par.array[k * 4 + 1] = o.drag ?? 0; A.par.array[k * 4 + 2] = o.stretch ?? 0; A.par.array[k * 4 + 3] = o.wind ?? 0;
    this.cellAttr.array[k] = o.cell ?? 0;
    if (k < this.dirtyMin) this.dirtyMin = k; if (k > this.dirtyMax) this.dirtyMax = k;
    if (this.dirtyMax - this.dirtyMin > this.max * 0.5 || k === 0) { this.dirtyMin = 0; this.dirtyMax = this.max - 1; }
  }
  flush() {
    if (this.dirtyMax < 0) return; const n = this.dirtyMax - this.dirtyMin + 1;
    for (const a of [...Object.values(this.a), this.cellAttr]) { a.clearUpdateRanges(); a.addUpdateRange(this.dirtyMin * a.itemSize, n * a.itemSize); a.needsUpdate = true; }
    this.dirtyMin = 1e9; this.dirtyMax = -1;
  }
}

// ------------------------------------------------------------------ volume weather (snow / rain / embers / dust ...): fully GPU, wraps around camera
const W_VS = /* glsl */`
attribute vec4 aSeed; uniform float uTime; uniform vec3 uBox; uniform vec3 uWind; uniform float uFall; uniform float uSize; uniform float uTurb; uniform float uStreak; uniform float uTwinkle; uniform float uRise; uniform vec3 uOrigin;
varying vec2 vUv; varying float vA; varying vec3 vWPos;
void main(){
  vec3 seed = aSeed.xyz; float sv = aSeed.w;
  float fall = uFall * (0.6 + 0.8 * sv);
  vec3 vel = vec3(uWind.x, -fall + uRise, uWind.z) + uTurb * vec3(sin(uTime * 0.9 + seed.x * 40.0), 0.3 * sin(uTime * 1.3 + seed.y * 30.0), cos(uTime * 0.7 + seed.z * 50.0));
  vec3 base = seed * uBox;
  vec3 p = base + vel * uTime;
  p = mod(p - uOrigin + uBox * 0.5, uBox) - uBox * 0.5 + uOrigin;
  vec4 vp = viewMatrix * vec4(p, 1.0);
  float dist = length(vp.xyz);
  float size = uSize * (0.55 + 0.9 * sv);
  vec2 q = position.xy; vec2 off;
  if (uStreak > 0.0) { vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz; vec2 dir = normalize(vv.xy + vec2(1e-5)); float len = size * uStreak; off = dir * q.y * len + vec2(dir.y, -dir.x) * q.x * size; }
  else off = q * size;
  vp.xy += off; gl_Position = projectionMatrix * vp;
  float fade = smoothstep(uBox.x * 0.5, uBox.x * 0.32, dist) * smoothstep(0.15, 0.6, dist);
  vA = fade * (1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (2.0 + sv * 5.0) + seed.x * 99.0)));
  vUv = q * 0.5 + 0.5; vWPos = p;
}`;
const W_FS = /* glsl */`
precision highp float; uniform sampler2D uAtlas; uniform vec3 uColor; uniform float uAlpha; uniform float uCell; uniform float uAdd;
varying vec2 vUv; varying float vA; varying vec3 vWPos; ${FOG_GLSL}
void main(){
  vec2 co = vec2(mod(uCell, 4.0), floor(uCell / 4.0)); vec2 uv = (co + clamp(vUv, 0.002, 0.998)) / 4.0; uv.y = 1.0 - uv.y;
  float a = texture2D(uAtlas, uv).a * vA * uAlpha; if (a < 0.004) discard;
  float ff = fogFactor(vWPos);
  vec3 c = uColor;
  if (uAdd > 0.5) gl_FragColor = vec4(c * a * (1.0 - ff * 0.85), 0.0); else gl_FragColor = vec4(mix(c, fogColorDir(normalize(vWPos - cameraPosition)), ff * 0.6), a);
}`;
export class VolumeWeather {
  /** cfg: {count, box:[x,y,z], fall, wind:[x,y,z]|null(uses global), size, turb, streak, twinkle, rise, color, alpha, cell, additive} */
  constructor(atlas, cfg) {
    const c = this.cfg = Object.assign({ count: 4000, box: [40, 26, 40], fall: 1.2, size: 0.03, turb: 0.4, streak: 0, twinkle: 0, rise: 0, color: [1, 1, 1], alpha: 0.8, cell: 3, additive: false }, cfg);
    const g = new THREE.InstancedBufferGeometry(); g.instanceCount = c.count;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const r = makeRng(cfg.seed || 5), s = new Float32Array(c.count * 4); for (let i = 0; i < s.length; i++) s[i] = r(); g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 4));
    this.u = { uTime: G.uTime, uBox: { value: new THREE.Vector3(...c.box) }, uWind: c.wind ? { value: new THREE.Vector3(...c.wind) } : G.uWind, uFall: { value: c.fall }, uSize: { value: c.size }, uTurb: { value: c.turb }, uStreak: { value: c.streak }, uTwinkle: { value: c.twinkle }, uRise: { value: c.rise }, uOrigin: { value: new THREE.Vector3() }, uAtlas: { value: atlas }, uColor: { value: new THREE.Color(...c.color) }, uAlpha: { value: c.alpha }, uCell: { value: c.cell }, uAdd: { value: c.additive ? 1 : 0 }, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir };
    this.mat = new THREE.ShaderMaterial({ vertexShader: W_VS, fragmentShader: W_FS, uniforms: this.u, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    if (c.additive) { this.mat.blending = THREE.CustomBlending; this.mat.blendSrc = THREE.OneFactor; this.mat.blendDst = THREE.OneFactor; } else { this.mat.blending = THREE.CustomBlending; this.mat.blendSrc = THREE.SrcAlphaFactor; this.mat.blendDst = THREE.OneMinusSrcAlphaFactor; this.mat.blendSrcAlpha = THREE.OneFactor; this.mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor; }
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 15;
    this.intensity = 1;
  }
  update(camPos, k = 1) { this.u.uOrigin.value.copy(camPos); this.u.uAlpha.value = this.cfg.alpha * k; this.mesh.visible = k > 0.01; }
}

// ------------------------------------------------------------------ tracers (instanced additive ribbons travelling at bullet speed)
const T_VS = /* glsl */`
attribute vec3 aA; attribute vec3 aB; attribute vec4 aT; attribute vec4 aCol; // aT: birth, speed, length, width
uniform float uTime; varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos;
void main(){
  float age = uTime - aT.x; vec3 d = aB - aA; float L = length(d); vec3 dir = d / max(L, 1e-4);
  float head = age * aT.y; float tail = head - aT.z; float h = clamp(head, 0.0, L), t = clamp(tail, 0.0, L);
  if (age < 0.0 || tail > L || h - t < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = aA + dir * mix(t, h, position.x * 0.5 + 0.5);
  vec4 vp = viewMatrix * vec4(p, 1.0); vec3 vd = normalize((viewMatrix * vec4(dir, 0.0)).xyz); vec3 sd0 = cross(vd, normalize(vp.xyz)); float sl = dot(sd0, sd0); vec3 side = sl > 1e-10 ? sd0 * inversesqrt(sl) : vec3(0.0, 1.0, 0.0);
  float w = aT.w * (1.0 + 0.0002 * length(vp.xyz) * length(vp.xyz)); w = min(w, 0.35);
  vp.xyz += side * position.y * w; gl_Position = projectionMatrix * vp;
  vUv = vec2(position.x * 0.5 + 0.5, position.y * 0.5 + 0.5); vCol = aCol; vCol.a *= smoothstep(0.0, 0.02, age); vWPos = p;
}`;
const T_FS = /* glsl */`
precision highp float; varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos; ${FOG_GLSL}
void main(){
  float core = pow(clamp(1.0 - abs(vUv.y * 2.0 - 1.0), 0.0, 1.0), 2.5); float along = pow(clamp(vUv.x, 0.0, 1.0), 0.6);
  vec3 c = mix(vCol.rgb, vec3(1.0, 0.97, 0.9), core * 0.8) * (0.25 + 2.6 * core) * along * vCol.a;
  gl_FragColor = vec4(c * (1.0 - fogFactor(vWPos) * 0.7), 0.0);
}`;
export class Tracers {
  constructor(max = 96) {
    this.max = max; this.i = 0; const g = new THREE.InstancedBufferGeometry(); g.instanceCount = max;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.aA = mk('aA', 3); this.aB = mk('aB', 3); this.aT = mk('aT', 4); this.aC = mk('aCol', 4); for (let k = 0; k < max; k++) this.aT.array[k * 4] = -1e9;
    this.mat = new THREE.ShaderMaterial({ vertexShader: T_VS, fragmentShader: T_FS, uniforms: { uTime: G.uTime, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 25;
  }
  /** from/to: world points. speed m/s (visual), len m streak length, width m, color [r,g,b] */
  add(from, to, time, { speed = 700, len = 6, width = 0.012, color = [1, 0.75, 0.35], a = 1 } = {}) {
    const k = this.i; this.i = (this.i + 1) % this.max; speed = Math.min(speed, 520); // visual speed cap: real tracers read as streaks through persistence of vision (>=5 frames visible)
    this.aA.array.set([from.x, from.y, from.z], k * 3); this.aB.array.set([to.x, to.y, to.z], k * 3); this.aT.array.set([time, speed, len, width], k * 4); this.aC.array.set([color[0], color[1], color[2], a], k * 4);
    for (const at of [this.aA, this.aB, this.aT, this.aC]) { at.clearUpdateRanges(); at.addUpdateRange(k * at.itemSize, at.itemSize); at.needsUpdate = true; }
  }
}

// ------------------------------------------------------------------ decals (instanced quads, lit PBR, atlas of hole/blood/scorch types)
export const DECAL = { hole: 0, holeMetal: 1, holeWood: 2, holeSnow: 3, holeIce: 4, crackGlass: 5, scorch: 6, blood0: 7, blood1: 8, blood2: 9, blood3: 10, slash: 11, puddle: 12, ember: 13, frost: 14, chip: 15 };
function makeDecalAtlas() {
  const S = 512, C = 128, hc = document.createElement('canvas'); hc.width = hc.height = S; const hx = hc.getContext('2d'); const ac = document.createElement('canvas'); ac.width = ac.height = S; const ax = ac.getContext('2d');
  const H = new Float32Array(S * S), A = new Float32Array(S * S), R = new Float32Array(S * S * 3); // height, alpha, rgb
  const rng = makeRng(31); const vn = (x, y, f, seed) => { const X = Math.floor(x * f), Y = Math.floor(y * f), fx = x * f - X, fy = y * f - Y; const h = (a, b) => { let n = (a * 374761393 + b * 668265263 + seed * 1442695041) | 0; n = (n ^ (n >> 13)) * 1274126177 | 0; return ((n ^ (n >> 16)) >>> 0) / 4294967296; }; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return lerp(lerp(h(X, Y), h(X + 1, Y), sx), lerp(h(X, Y + 1), h(X + 1, Y + 1), sx), sy); };
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const put = (cell, fn) => { const ox = (cell % 4) * C, oy = Math.floor(cell / 4) * C; for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const u = x / (C - 1) * 2 - 1, v = y / (C - 1) * 2 - 1; const o = fn(u, v, x / C, y / C, cell); const i = (oy + y) * S + ox + x; H[i] = o[0]; A[i] = o[1]; R[i * 3] = o[2]; R[i * 3 + 1] = o[3]; R[i * 3 + 2] = o[4]; } };
  const hole = (dark, rim, soft) => (u, v, x, y, cell) => { const r = Math.hypot(u, v) ; const n = vn(x, y, 9, cell); const rr = r + (n - 0.5) * 0.25; const inner = sm(0.28, 0.2, rr); const ring = sm(0.62, 0.3, rr) * (1 - inner * 0.0); const a = ring * (soft ? 0.85 : 1); return [-inner * 0.9 + sm(0.55, 0.3, rr) * rim * 0.4, a, dark * (1 - inner * 0.8), dark * (1 - inner * 0.8), dark * (1 - inner * 0.8)]; };
  put(0, hole(0.12, 0.6));                                   // concrete/stone hole (chipped)
  put(1, (u, v, x, y, c) => { const r = Math.hypot(u, v); const n = vn(x, y, 7, c); const inner = sm(0.2, 0.14, r + (n - .5) * .08); const petals = sm(0.5, 0.2, r + (Math.pow(Math.abs(Math.cos(Math.atan2(v, u) * 5)), 6) * 0.25)); return [-inner + petals * 0.5, petals * 0.95, 0.35 * (1 - inner) + .1, 0.36 * (1 - inner) + .1, 0.38 * (1 - inner) + .1]; }); // metal punch
  put(2, (u, v, x, y, c) => { const r = Math.hypot(u * 1.0, v * 1.0); const n = vn(x * 3, y * 9, 4, c); const inner = sm(0.22, 0.14, r + (n - .5) * .15); const spl = sm(0.6, 0.15, r + (n - .5) * .5) * (0.6 + 0.4 * vn(x, y, 20, c)); return [-inner * .9 + spl * 0.3, Math.max(spl * 0.8, inner), 0.32 * (1 - inner * .9) + .04, 0.2 * (1 - inner * .9) + .02, 0.1 * (1 - inner * .9) + .01]; }); // wood splinters
  put(3, (u, v, x, y, c) => { const r = Math.hypot(u, v); const n = vn(x, y, 8, c); const dent = sm(0.55, 0.05, r + (n - .5) * .3); return [-dent * 0.7, dent * 0.75, 0.75, 0.82, 0.9]; }); // snow crater
  put(4, (u, v, x, y, c) => { const r = Math.hypot(u, v), a = Math.atan2(v, u); const cr = Math.pow(Math.abs(Math.cos(a * 5.5 + vn(x, y, 5, c) * 3)), 24) * sm(0.85, 0.1, r); const inner = sm(0.15, 0.08, r); return [-cr * 0.6 - inner, Math.max(cr * 0.9, inner * 0.8), 0.85, 0.93, 1.0]; }); // ice star crack
  put(5, (u, v, x, y, c) => { const r = Math.hypot(u, v), a = Math.atan2(v, u); const cr = Math.pow(Math.abs(Math.cos(a * 7 + vn(x, y, 6, c) * 2.5)), 30) * sm(0.95, 0.05, r) + Math.pow(Math.abs(Math.cos(a * 3.1 + 1.0)), 60) * sm(0.7, 0.05, r); const inner = sm(0.1, 0.05, r); return [-cr * .4 - inner, Math.max(cr * .8, inner), 0.9, 0.95, 1.0]; }); // glass star
  put(6, (u, v, x, y, c) => { const r = Math.hypot(u, v); const n = vn(x, y, 6, c); const a = sm(0.95, 0.2, r + (n - .5) * .5); return [-a * .2, a * 0.9, 0.02, 0.02, 0.02]; }); // scorch
  for (let b = 0; b < 4; b++) put(7 + b, (u, v, x, y, c) => { const ang = Math.atan2(v, u), r = Math.hypot(u, v); const lobe = 0.45 + 0.55 * vn(Math.cos(ang) * .5 + .5 + b * 3.3, Math.sin(ang) * .5 + .5, 5, c + b); const drops = vn(x * 2, y * 2, 14, c + 9) > 0.78 ? sm(1, 0.55, r) * 0.9 : 0; const a = Math.max(sm(lobe, lobe - 0.12, r), drops) * (0.7 + 0.3 * vn(x, y, 12, c)); return [a * 0.25, a * 0.92, 0.28, 0.0, 0.005]; }); // blood splats
  put(11, (u, v, x, y, c) => { const a = sm(0.10, 0.02, Math.abs(v * 1.0 + u * 0.06)) * sm(1, 0.7, Math.abs(u)); return [-a * 0.5, a * 0.9, 0.06, 0.005, 0.005]; }); // claw slash
  put(12, (u, v, x, y, c) => { const r = Math.hypot(u, v) ; const n = vn(x, y, 5, c); const a = sm(0.95, 0.7, r + (n - .5) * .5) * 0.6; return [0, a, 0.02, 0.03, 0.04]; }); // puddle
  put(13, (u, v, x, y, c) => { const r = Math.hypot(u, v); const a = sm(0.6, 0.0, r); return [0, a, 1, 0.3, 0.05]; });
  put(14, (u, v, x, y, c) => { const r = Math.hypot(u, v); const n = vn(x, y, 14, c); const a = sm(0.9, 0.3, r + (n - .5) * .6) * 0.6; return [a * .2, a, 0.9, 0.95, 1.0]; });
  put(15, (u, v, x, y, c) => { const r = Math.hypot(u, v); const n = vn(x, y, 10, c); const a = sm(0.5, 0.2, r + (n - .5) * .5); return [-a * .5, a * .8, 0.4, 0.4, 0.4]; });
  const alb = new Uint8ClampedArray(S * S * 4), nrm = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x; const hL = H[y * S + Math.max(0, x - 1)], hR = H[y * S + Math.min(S - 1, x + 1)], hU = H[Math.max(0, y - 1) * S + x], hD = H[Math.min(S - 1, y + 1) * S + x];
    let nx = (hL - hR) * 2.4, ny = (hU - hD) * 2.4, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    nrm[i * 4] = (nx * .5 + .5) * 255; nrm[i * 4 + 1] = (ny * .5 + .5) * 255; nrm[i * 4 + 2] = (nz * .5 + .5) * 255; nrm[i * 4 + 3] = A[i] * 255;
    alb[i * 4] = R[i * 3] * 255; alb[i * 4 + 1] = R[i * 3 + 1] * 255; alb[i * 4 + 2] = R[i * 3 + 2] * 255; alb[i * 4 + 3] = A[i] * 255;
  }
  const mkTex = (data, srgb) => { const c = document.createElement('canvas'); c.width = c.height = S; const cx = c.getContext('2d'); cx.putImageData(new ImageData(data, S, S), 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; return t; };
  return { map: mkTex(alb, true), normalMap: mkTex(nrm, false) };
}
export class Decals {
  constructor(max = 700) {
    this.max = max; this.i = 0; const atlas = makeDecalAtlas();
    const g = new THREE.PlaneGeometry(1, 1); const info = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); info.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aInfo', info); this.info = info; // x atlas cell, y birth, z lifetime, w roughness
    const m = std({ map: atlas.map, normalMap: atlas.normalMap, roughness: 0.6, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, alphaTest: 0.01, side: THREE.FrontSide, normalScale: 1.2, key: 'decal',
      vertex: 'vDecalInfo = aInfo;', });
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (shader) => {
      base(shader);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aInfo; varying vec4 vDecalInfo;\n#define USE_DECAL').replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
        { float cell = aInfo.x; vec2 co = vec2(mod(cell, 4.0), floor(cell / 4.0)); vMapUv = (uv * 0.25 + vec2(co.x, 3.0 - co.y) * 0.25); }
        #endif
        #ifdef USE_NORMALMAP
        { float cell = aInfo.x; vec2 co = vec2(mod(cell, 4.0), floor(cell / 4.0)); vNormalMapUv = (uv * 0.25 + vec2(co.x, 3.0 - co.y) * 0.25); }
        #endif`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vDecalInfo;').replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vDecalInfo.w;').replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.a *= smoothstep(0.0, 1.0, clamp(vDecalInfo.z, 0.0, 1.0));`);
    };
    m.customProgramCacheKey = () => 'decalMat';
    this.mesh = new THREE.InstancedMesh(g, m, max); this.mesh.count = max; this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.receiveShadow = true;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._rq = new THREE.Quaternion(); this._z = new THREE.Vector3(0, 0, 1); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < max; k++) this.mesh.setMatrixAt(k, this.zero); this.mesh.instanceMatrix.needsUpdate = true; this.n = new Array(max).fill(null);
  }
  /** Stick a decal on a surface: pos, normal (world), cell (DECAL.*), size m, rough (0..1), roll radians */
  add(pos, normal, cell, size = 0.15, rough = 0.6, roll = null, life = 1) {
    const k = this.i; this.i = (this.i + 1) % this.max;
    this._q.setFromUnitVectors(this._z, normal); this._rq.setFromAxisAngle(this._z, roll ?? rand() * TAU); this._q.multiply(this._rq);
    this._p.copy(pos).addScaledVector(normal, 0.004 + (k % 7) * 0.0006); this._s.set(size, size, 1); this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(k, this._m); this.info.setXYZW(k, cell, 0, life, rough);
    this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(k * 16, 16); this.mesh.instanceMatrix.needsUpdate = true;
    this.info.clearUpdateRanges(); this.info.addUpdateRange(k * 4, 4); this.info.needsUpdate = true;
  }
  clear() { for (let k = 0; k < this.max; k++) this.mesh.setMatrixAt(k, this.zero); this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.needsUpdate = true; }
}

// ------------------------------------------------------------------ shell casings (CPU physics, instanced)
export class Casings {
  constructor(max = 40) {
    this.max = max; this.i = 0; const g = new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 8); g.rotateZ(Math.PI / 2);
    const m = std({ color: 0xc8a24a, metalness: 1, roughness: 0.28, key: 'brass' }); this.mesh = new THREE.InstancedMesh(g, m, max); this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.p = Array.from({ length: max }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Quaternion(), av: new THREE.Vector3(), life: 0, bounces: 0, scale: 1 }));
    this.dummy = new THREE.Object3D(); this.hit = {}; this.onBounce = null; for (let k = 0; k < max; k++) { this.dummy.scale.setScalar(0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(k, this.dummy.matrix); }
  }
  spawn(pos, vel, scale = 1, shotgun = false) {
    const c = this.p[this.i]; this.i = (this.i + 1) % this.max; c.pos.copy(pos); c.vel.copy(vel); c.rot.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)); c.av.set((rand() - 0.5) * 60, (rand() - 0.5) * 60, (rand() - 0.5) * 60); c.life = 6; c.bounces = 0; c.scale = scale; c.shotgun = shotgun;
  }
  update(dt, world) {
    const d = this.dummy, q = new THREE.Quaternion(), ax = new THREE.Vector3();
    for (let k = 0; k < this.max; k++) {
      const c = this.p[k]; if (c.life <= 0) continue; c.life -= dt;
      if (c.life <= 0) { d.scale.setScalar(0); d.updateMatrix(); this.mesh.setMatrixAt(k, d.matrix); continue; }
      if (c.bounces < 5) {
        c.vel.y -= 9.81 * dt; const nx = c.pos.x + c.vel.x * dt, ny = c.pos.y + c.vel.y * dt, nz = c.pos.z + c.vel.z * dt;
        const g = world ? world.groundAt(nx, nz, c.pos.y + 0.05) : null; const gy = g ? g.y : -1e9;
        if (ny < gy + 0.006 && c.vel.y < 0) { c.pos.y = gy + 0.006; c.vel.y *= -0.38; c.vel.x *= 0.6; c.vel.z *= 0.6; c.av.multiplyScalar(0.5); c.bounces++; if (this.onBounce && Math.abs(c.vel.y) > 0.4 || (this.onBounce && c.bounces === 1)) this.onBounce(c.pos, g ? g.surface : 'concrete', c.shotgun, c.bounces); if (c.bounces >= 4 || Math.abs(c.vel.y) < 0.25) { c.bounces = 9; c.vel.set(0, 0, 0); c.av.set(0, 0, 0); } }
        else c.pos.set(nx, ny, nz);
        ax.copy(c.av); const ang = ax.length() * dt; if (ang > 1e-5) { q.setFromAxisAngle(ax.normalize(), ang); c.rot.premultiply(q); }
      }
      d.position.copy(c.pos); d.quaternion.copy(c.rot); d.scale.setScalar(c.scale); d.updateMatrix(); this.mesh.setMatrixAt(k, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ facade
export class FX {
  constructor(gfx) {
    this.gfx = gfx; this.atlas = makeSpriteAtlas(); this.time = 0;
    this.alpha = new Particles(this.atlas, { max: 3072, additive: false }); this.add = new Particles(this.atlas, { max: 3072, additive: true, stretchMax: 4 });
    this.fireTex = bakeFlipbook(gfx.renderer, 0); this.smokeTex = bakeFlipbook(gfx.renderer, 1);
    this.fire = new Particles(this.atlas, { max: 192, additive: true, flip: this.fireTex }); this.smoke = new Particles(this.atlas, { max: 384, additive: false, flip: this.smokeTex });
    this.tracers = new Tracers(96); this.decals = new Decals(700); this.casings = new Casings(40);
    this.root = new THREE.Group(); this.root.name = 'fx'; this.root.add(this.alpha.mesh, this.add.mesh, this.smoke.mesh, this.fire.mesh, this.tracers.mesh, this.decals.mesh, this.casings.mesh);
    gfx.scene.add(this.root); gfx.vmSkip?.add(this.root); this.weather = []; this.world = null; this.shake = 0; this.shakeT = 0; this.flashLight = null; this.hitCb = null;
    this.flashLights = []; for (let i = 0; i < 4; i++) this.flashLights.push({ src: null, t: 1, dur: 0.06, peak: 0 });
    this.events = []; // {t, fn}
  }
  setWorld(w) { this.world = w; }
  clearWorldFX() { this.decals.clear(); } // decals only: weather volumes are owned (and toggled) by their stops
  addWeather(cfg) { const w = new VolumeWeather(this.atlas, cfg); this.root.add(w.mesh); this.weather.push(w); return w; }
  removeWeather(w) { this.root.remove(w.mesh); const i = this.weather.indexOf(w); if (i >= 0) this.weather.splice(i, 1); }
  /** short-lived point light (muzzle flash, explosions, sparks) via the pooled light system */
  pulseLight(pos, color, intensity, dur = 0.07, distance = 10) {
    const f = this.flashLights.find((f) => f.t >= f.dur) || this.flashLights[0]; f.t = 0; f.dur = dur; f.peak = intensity;
    if (!f.src) f.src = this.gfx.addLight({ kind: 'point', pos: new THREE.Vector3(), color: new THREE.Color(), intensity: 0, distance, decay: 2, priority: 6 });
    f.src.pos.copy(pos); f.src.color.set(color); f.src.distance = distance; f.src.intensity = intensity; f.src.enabled = true;
  }
  addShake(a) { this.shake = Math.min(1, this.shake + a); }
  schedule(delay, fn) { this.events.push({ t: this.time + delay, fn }); }

  // ---- particle helpers (all positions world space; dir/normal are unit Vector3)
  spark(pos, dir, n = 8, speed = 6, size = 0.02, color = [1, 0.7, 0.3], life = 0.5) {
    for (let i = 0; i < n; i++) { const s = speed * (0.4 + rand()); this.add.emit({ p: pos, v: [dir.x * s + (rand() - 0.5) * s, dir.y * s + (rand() - 0.2) * s * 0.8, dir.z * s + (rand() - 0.5) * s], life: life * (0.5 + rand()), size: [size, size * 0.4], c0: [color[0] * 3, color[1] * 3, color[2] * 3, 1], c1: [color[0], color[1] * 0.4, 0, 0], gravity: 1, drag: 1.2, stretch: 0.045, cell: 2 }, this.time); }
  }
  puff(pos, dir, n, { speed = 1.5, size = [0.1, 0.5], life = 1, color = [0.5, 0.5, 0.5, 0.4], cell = 1, rise = 0.5, drag = 2.5, spread = 1, grav = 0 } = {}) {
    for (let i = 0; i < n; i++) this.alpha.emit({ p: [pos.x + (rand() - 0.5) * 0.06, pos.y + (rand() - 0.5) * 0.06, pos.z + (rand() - 0.5) * 0.06], v: [dir.x * speed * (0.5 + rand()) + (rand() - 0.5) * spread, dir.y * speed * (0.5 + rand()) + rise * (0.3 + rand()), dir.z * speed * (0.5 + rand()) + (rand() - 0.5) * spread], life: life * (0.6 + rand() * 0.8), size: [size[0] * (0.7 + rand() * 0.6), size[1] * (0.7 + rand() * 0.6)], c0: color, c1: [color[0], color[1], color[2], 0], rotVel: (rand() - 0.5) * 2, drag, cell, gravity: grav }, this.time);
  }
  chunks(pos, dir, n, { speed = 4, size = 0.03, color = [0.4, 0.4, 0.4, 1], life = 0.7, grav = 1 } = {}) {
    for (let i = 0; i < n; i++) { const s = speed * (0.3 + rand()); this.alpha.emit({ p: pos, v: [dir.x * s + (rand() - 0.5) * s, dir.y * s + rand() * s * 0.6, dir.z * s + (rand() - 0.5) * s], life: life * (0.6 + rand() * 0.8), size: [size * (0.6 + rand()), size * 0.8], c0: color, c1: [color[0], color[1], color[2], 0.9], gravity: grav, drag: 0.4, rotVel: (rand() - 0.5) * 20, cell: 12 }, this.time); }
  }
  /** Surface-specific bullet impact. hit = {point, normal, surface}, dir = incoming bullet direction (unit) */
  impact(surface, point, normal, dir, { caliber = 1, isShotgun = false, size = 1 } = {}) {
    const n = normal, refl = V.copy(dir).addScaledVector(n, -2 * dir.dot(n)); const big = caliber;
    const dcl = (cell, s, r, life = 1) => this.decals.add(point, n, cell, s * size, r, null, life);
    const sc = isShotgun ? 0.55 : 1;
    switch (surface) {
      case 'metal': dcl(DECAL.holeMetal, 0.075 * big, 0.35); this.spark(point, refl, 10 * sc | 0 || 3, 7, 0.018, [1, 0.72, 0.32], 0.45); this.puff(point, n, 1, { size: [0.03, 0.14], life: 0.4, color: [0.7, 0.7, 0.7, 0.18], speed: 0.4 }); this.pulseLight(V.copy(point).addScaledVector(n, 0.08), 0xffb050, 3, 0.05, 4); break;
      case 'wood': dcl(DECAL.holeWood, 0.09 * big, 0.85); this.chunks(point, n, 6 * sc | 0 || 2, { speed: 3, size: 0.02, color: [0.55, 0.38, 0.2, 1], life: 0.6 }); this.puff(point, n, 2, { size: [0.03, 0.2], life: 0.6, color: [0.5, 0.4, 0.28, 0.3], speed: 0.6 }); break;
      case 'snow': dcl(DECAL.holeSnow, 0.16 * big, 0.9); this.puff(point, n, 3, { size: [0.05, 0.26], life: 0.95, color: [0.9, 0.94, 1, 0.3], speed: 1.0, rise: 0.3, drag: 2.4, cell: 9 }); for (let i = 0; i < 14 * sc; i++) this.alpha.emit({ p: point, v: [n.x * 2.2 + (rand() - 0.5) * 2.4, n.y * 2.2 + rand() * 1.8, n.z * 2.2 + (rand() - 0.5) * 2.4], life: 0.5 + rand() * 0.5, size: [0.012, 0.008], c0: [0.95, 0.97, 1, 0.9], c1: [0.95, 0.97, 1, 0], gravity: 0.6, drag: 1.0, cell: 3 }, this.time); break;
      case 'ice': dcl(DECAL.holeIce, 0.14 * big, 0.12); for (let i = 0; i < 7 * sc; i++) this.alpha.emit({ p: point, v: [n.x * 3 + (rand() - 0.5) * 3, n.y * 3 + rand() * 2, n.z * 3 + (rand() - 0.5) * 3], life: 0.7, size: [0.03, 0.02], c0: [0.85, 0.95, 1, 1], c1: [0.8, 0.9, 1, 0], gravity: 1, rotVel: (rand() - 0.5) * 30, cell: 6, drag: 0.3 }, this.time); this.puff(point, n, 2, { size: [0.04, 0.17], life: 0.7, color: [0.9, 0.96, 1, 0.22], speed: 0.8, cell: 9 }); break;
      case 'water': this.splash(point, n, big * sc); break;
      case 'glass': dcl(DECAL.crackGlass, 0.24 * big, 0.05); for (let i = 0; i < 8 * sc; i++) this.alpha.emit({ p: point, v: [dir.x * 2 + (rand() - 0.5) * 3, dir.y * 2 + (rand() - 0.5) * 3, dir.z * 2 + (rand() - 0.5) * 3], life: 0.8, size: [0.03, 0.02], c0: [0.85, 0.95, 1, 0.9], c1: [0.85, 0.95, 1, 0], gravity: 1, rotVel: (rand() - 0.5) * 30, cell: 6 }, this.time); break;
      case 'crystal': dcl(DECAL.chip, 0.09 * big, 0.2); for (let i = 0; i < 9 * sc; i++) this.add.emit({ p: point, v: [n.x * 3 + (rand() - 0.5) * 4, n.y * 3 + (rand() - 0.5) * 4, n.z * 3 + (rand() - 0.5) * 4], life: 0.7, size: [0.03, 0.02], c0: [0.6, 0.4, 3, 1], c1: [0.3, 0.6, 1.5, 0], gravity: 0.6, rotVel: (rand() - 0.5) * 30, cell: 6 }, this.time); this.pulseLight(point, 0xa070ff, 2.5, 0.09, 4); break;
      case 'lava': this.add.emit({ p: point, v: [0, 1.6, 0], life: 0.35, size: [0.05, 0.22], c0: [2.2, 0.9, 0.15, 0.9], c1: [0.8, 0.15, 0, 0], cell: 8 }, this.time); for (let i = 0; i < 6; i++) this.add.emit({ p: point, v: [(rand() - 0.5) * 3, 3 + rand() * 3, (rand() - 0.5) * 3], life: 0.9, size: [0.05, 0.02], c0: [3, 1.2, 0.2, 1], c1: [1, 0.15, 0, 0], gravity: 1, cell: 0 }, this.time); break;
      case 'fabric': dcl(DECAL.hole, 0.05 * big, 0.95); this.puff(point, n, 3, { size: [0.03, 0.14], life: 0.5, color: [0.6, 0.6, 0.6, 0.25], speed: 0.4, cell: 9 }); break;
      case 'dirt': case 'grass': case 'gravel': dcl(DECAL.holeSnow, 0.13 * big, 0.95); this.puff(point, n, 3, { size: [0.05, 0.22], life: 0.8, color: surface === 'gravel' ? [0.5, 0.48, 0.45, 0.28] : [0.36, 0.28, 0.2, 0.32], speed: 1.3, cell: 9 }); this.chunks(point, n, 4, { speed: 3, size: 0.02, color: [0.35, 0.28, 0.2, 1] }); break;
      case 'flesh': this.blood(point, n, dir, 1); break;
      case 'plastic': dcl(DECAL.hole, 0.06 * big, 0.6); this.chunks(point, n, 3, { speed: 2, size: 0.015, color: [0.8, 0.8, 0.8, 1] }); break;
      default: /* concrete brick rock tile */ dcl(DECAL.hole, 0.11 * big, 0.9); this.puff(point, n, 2, { size: [0.04, 0.17], life: 0.75, color: [0.36, 0.34, 0.31, 0.22], speed: 0.8, cell: 9 }); this.chunks(point, n, 5 * sc | 0 || 2, { speed: 3.5, size: 0.02, color: [0.55, 0.53, 0.5, 1] }); if (rand() < 0.5) this.spark(point, refl, 3, 5, 0.012, [1, 0.8, 0.5], 0.25);
    }
  }
  splash(point, n, k = 1) {
    // crown of droplets thrown up and out + a short water column + a little mist (billboard rings read as hoops, so no ring)
    for (let i = 0; i < 14 * k + 6; i++) { const a = rand() * TAU, sp = 0.4 + rand() * 1.4; this.alpha.emit({ p: point, v: [Math.cos(a) * sp, 2.2 + rand() * 3.2, Math.sin(a) * sp], life: 0.7 + rand() * 0.3, size: [0.022, 0.012], c0: [0.85, 0.92, 1, 0.85], c1: [0.8, 0.9, 1, 0], gravity: 1, drag: 0.15, cell: 7 }, this.time); }
    this.alpha.emit({ p: [point.x, point.y + 0.12, point.z], v: [0, 2.2, 0], life: 0.45, size: [0.04, 0.22 * k], c0: [0.9, 0.95, 1, 0.26], c1: [0.9, 0.95, 1, 0], drag: 3.5, cell: 9 }, this.time);
    for (let i = 0; i < 3; i++) this.alpha.emit({ p: [point.x + (rand() - 0.5) * 0.15, point.y + 0.05, point.z + (rand() - 0.5) * 0.15], v: [(rand() - 0.5) * 0.8, 0.6 + rand() * 0.6, (rand() - 0.5) * 0.8], life: 0.9, size: [0.04, 0.2 * k], c0: [0.85, 0.9, 0.95, 0.12], c1: [0.85, 0.9, 0.95, 0], drag: 2.5, cell: 9 }, this.time);
  }
  /** blood: spray at wound + mist + decals on nearby surfaces along the shot direction */
  blood(point, normal, dir, k = 1, color = [0.32, 0.01, 0.01]) {
    for (let i = 0; i < 9 * k + 3; i++) { const s = 2.5 + rand() * 4; this.alpha.emit({ p: point, v: [dir.x * s * 0.6 + normal.x * s * 0.5 + (rand() - 0.5) * 2, dir.y * s * 0.6 + normal.y * s * 0.5 + rand() * 1.6, dir.z * s * 0.6 + normal.z * s * 0.5 + (rand() - 0.5) * 2], life: 0.7 + rand() * 0.5, size: [0.028, 0.02], c0: [color[0], color[1], color[2], 0.95], c1: [color[0], color[1], color[2], 0.9], gravity: 1, drag: 0.8, stretch: 0.03, cell: 7 }, this.time); }
    this.puff(point, normal, 2 + k | 0, { size: [0.04, 0.16], life: 0.45, color: [0.3, 0.015, 0.015, 0.3], speed: 0.9, cell: 9, rise: 0.1 });
    if (this.world && k > 0) { // decal behind the target (exit splatter) and on floor
      const o = {}; const w = this.world;
      if (w.raycast(point.x, point.y, point.z, dir.x, dir.y, dir.z, 4, o) && o.t < 3.5) { this.decals.add(new THREE.Vector3(point.x + dir.x * o.t, point.y + dir.y * o.t, point.z + dir.z * o.t), new THREE.Vector3(o.nx, o.ny, o.nz), DECAL.blood0 + (rand() * 4 | 0), (0.25 + rand() * 0.35) * Math.min(1.4, k), 0.14); }
      const g = w.groundAt(point.x + dir.x * 0.8, point.z + dir.z * 0.8, point.y); if (g && point.y - g.y < 2.4) this.decals.add(new THREE.Vector3(point.x + dir.x * 0.8 + (rand() - 0.5) * 0.4, g.y, point.z + dir.z * 0.8 + (rand() - 0.5) * 0.4), new THREE.Vector3(0, 1, 0), DECAL.blood0 + (rand() * 4 | 0), 0.25 + rand() * 0.45, 0.12);
    }
  }
  gore(point, dir, k = 1) { // bigger burst (headshot / limb loss)
    this.blood(point, V.set(0, 1, 0), dir, 2 * k);
    for (let i = 0; i < 14 * k; i++) { const s = 3 + rand() * 5; this.alpha.emit({ p: point, v: [dir.x * s + (rand() - 0.5) * 3, dir.y * s + rand() * 3, dir.z * s + (rand() - 0.5) * 3], life: 1 + rand() * 0.6, size: [0.05 + rand() * 0.04, 0.04], c0: [0.25, 0.01, 0.01, 1], c1: [0.2, 0.01, 0.01, 0.9], gravity: 1, drag: 0.5, rotVel: (rand() - 0.5) * 10, cell: 12 }, this.time); }
  }
  muzzleBlast(pos, dir, k = 1, smoke = true) { // world-space particles for a shot (the view-model flash is separate)
    this.add.emit({ p: pos, v: [dir.x * 4, dir.y * 4, dir.z * 4], life: 0.07, size: [0.18 * k, 0.5 * k], c0: [3, 2, 1, 1], c1: [2, 0.8, 0.2, 0], cell: 8, drag: 8 }, this.time);
    if (smoke) this.puff(pos, dir, 2, { size: [0.05 * k, 0.32 * k], life: 1.2, color: [0.6, 0.6, 0.6, 0.22], speed: 1.8, cell: 1, rise: 0.4, drag: 2.5, spread: 0.25 });
    this.spark(pos, dir, 4, 9, 0.014, [1, 0.8, 0.4], 0.3);
  }
  /** explosion: fireball, shock ring, smoke, sparks, light, shake */
  explosion(pos, radius = 5, power = 1) {
    const t = this.time, r = radius, cy = pos.y;
    const dirRand = (yBias = 0.5) => V.set(rand() - 0.5, rand() * yBias + 0.1, rand() - 0.5).normalize();
    // 1) hot core flash: brief, small, saturated (the flipbook fireball carries the volume)
    this.add.emit({ p: pos, v: [0, 0, 0], life: 0.07, size: [r * 0.22, r * 0.6], c0: [2.4, 1.6, 0.7, 0.7], c1: [1.0, 0.4, 0.1, 0], cell: 10 }, t);
    // 2) fireball: turbulent flipbook sprites (fire colours are baked; c0/c1 only scale the HDR emission)
    const nf = 8; for (let i = 0; i < nf; i++) {
      const d = dirRand(0.9), o = r * (0.05 + rand() * 0.3); const sz = r * (0.85 + rand() * 0.75);
      this.fire.emit({ p: [pos.x + d.x * o, pos.y + Math.max(0.15, d.y * o) + sz * 0.25, pos.z + d.z * o], v: [d.x * r * 0.6, 0.4 + d.y * r * 0.9, d.z * r * 0.6], life: 0.55 + rand() * 0.55, size: [sz * 0.55, sz * 1.25], c0: [1.9, 1.6, 1.25, 1], c1: [1.2, 1.0, 0.8, 1], rot: rand() * TAU, rotVel: (rand() - 0.5) * 1.2, drag: 3.0 }, t);
    }
    // 3) dark billowing smoke column (lit by the scene: the baked shading is grey, colour is albedo)
    const ns = 10; for (let i = 0; i < ns; i++) {
      const d = dirRand(1.4), o = r * (0.1 + rand() * 0.35); const sz = r * (0.9 + rand() * 0.9);
      this.smoke.emit({ p: [pos.x + d.x * o, pos.y + 0.3 + d.y * o + sz * 0.3, pos.z + d.z * o], v: [d.x * r * 0.35, 0.8 + rand() * 1.6 + d.y * r * 0.5, d.z * r * 0.35], life: 3.4 + rand() * 2.2, size: [sz * 0.5, sz * 1.9], c0: [0.10, 0.09, 0.085, 0.9], c1: [0.42, 0.40, 0.38, 0.0], rot: rand() * TAU, rotVel: (rand() - 0.5) * 0.4, drag: 1.4, gravity: -0.03 }, t);
    }
    // 4) ground dust / shock ring (only when near the ground)
    const g = this.world ? this.world.groundAt(pos.x, pos.z, pos.y + 1) : null; const gy = g ? g.y : cy - 0.3; const low = clamp(1 - (cy - gy) / (r * 0.8), 0, 1);
    if (low > 0.05) for (let i = 0; i < 12; i++) { const a = (i / 12 + rand() * 0.06) * TAU, sp = r * (1.8 + rand() * 0.9); this.smoke.emit({ p: [pos.x + Math.cos(a) * 0.3, gy + 0.25, pos.z + Math.sin(a) * 0.3], v: [Math.cos(a) * sp, 0.25 + rand() * 0.5, Math.sin(a) * sp], life: 1.6 + rand() * 1.2, size: [r * 0.3, r * 1.15], c0: [0.62, 0.52, 0.40, 0.55 * low], c1: [0.5, 0.42, 0.33, 0], rot: rand() * TAU, rotVel: (rand() - 0.5), drag: 2.4 }, t); }
    this.add.emit({ p: [pos.x, gy + 0.08, pos.z], v: [0, 0, 0], life: 0.32, size: [r * 0.3, r * 2.2], c0: [1.0, 0.8, 0.55, 0.28 * low], c1: [0.5, 0.35, 0.2, 0], cell: 5, rot: 0 }, t);   // shock ring (horizontal look via the ground-hugging quad size)
    // 5) sparks + glowing embers + debris chunks (gravity, bounce-free)
    for (let i = 0; i < 46; i++) { const d = dirRand(1.1); const s2 = r * (1.4 + rand() * 2.8); this.add.emit({ p: pos, v: [d.x * s2, d.y * s2 + 2, d.z * s2], life: 0.45 + rand() * 1.0, size: [0.05, 0.015], c0: [3.2, 1.6, 0.5, 1], c1: [1.2, 0.3, 0.06, 0], cell: 2, gravity: 0.8, drag: 0.5, stretch: 0.12 }, t); }
    for (let i = 0; i < 24; i++) { const d = dirRand(1.0); const s2 = r * (0.9 + rand() * 1.7); this.alpha.emit({ p: pos, v: [d.x * s2, d.y * s2 + 2.5, d.z * s2], life: 1.1 + rand() * 1.0, size: [0.07 + rand() * 0.1, 0.05 + rand() * 0.07], c0: [0.22, 0.19, 0.16, 1], c1: [0.22, 0.19, 0.16, 0.9], cell: 12, gravity: 1, drag: 0.15, rot: rand() * TAU, rotVel: (rand() - 0.5) * 12 }, t); }
    this.pulseLight(V.set(pos.x, pos.y + 1, pos.z), 0xff8a35, 300 * power, 0.55, r * 5.5);
    this.addShake(Math.min(1, 0.4 + power * 0.25) * clamp(1 - 0.03 * (this.camPos ? this.camPos.distanceTo(pos) : 0), 0.2, 1));
    if (g) this.decals.add(new THREE.Vector3(pos.x, g.y, pos.z), new THREE.Vector3(0, 1, 0), DECAL.scorch, r * 1.6, 0.9);
  }

  update(dt, time, camPos) {
    this.time = time; this.camPos = camPos;
    this.alpha.flush(); this.add.flush(); this.smoke.flush(); this.fire.flush();
    for (const w of this.weather) w.update(camPos, w.intensity);
    this.casings.update(dt, this.world);
    { let boost = 0; for (const f of this.flashLights) if (f.src && f.t < f.dur) boost += f.src.intensity; const b = this.gfx.partLightBase; if (b) G.uPartLight.value.copy(b).addScalar(Math.min(1.5, boost * 0.0028)); }
    for (const f of this.flashLights) if (f.src && f.t < f.dur) { f.t += dt; const k = Math.max(0, 1 - f.t / f.dur); f.src.intensity = f.peak * k * k; if (f.t >= f.dur) { f.src.intensity = 0; f.src.enabled = false; } }
    if (this.events.length) { for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].t <= time) { const e = this.events.splice(i, 1)[0]; e.fn(); } }
    this.shake = Math.max(0, this.shake - dt * 1.6);
  }
}
