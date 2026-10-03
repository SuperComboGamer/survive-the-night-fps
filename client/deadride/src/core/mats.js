// Material factory + shader patching.  Every world material goes through patch() so that it shares
// (a) analytic height fog with sun in-scatter, (b) optional triplanar mapping, (c) snow/wet accumulation,
// (d) sky-visibility (baked per vertex) that masks image-based ambient light so interiors stay dark.
import * as THREE from 'three';

// ---- tileable 3D noise texture (baked once): replaces per-pixel hash noise in shaders (1 fetch per octave)
function makeNoise3D(size = 64, cells = 8) {
  const N = size, d = new Uint8Array(N * N * N * 4); let seed = 0x9e3779b9;
  const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sm = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let c = 0; c < 4; c++) {
    const L = new Float32Array(cells * cells * cells); for (let i = 0; i < L.length; i++) L[i] = rnd();
    const at = (x, y, z) => L[((z % cells) * cells + (y % cells)) * cells + (x % cells)];
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * cells, fy = y / N * cells, fz = z / N * cells, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz), tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz);
      const l = (a, b, t) => a + (b - a) * t;
      const v = l(l(l(at(ix, iy, iz), at(ix + 1, iy, iz), tx), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty), l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty), tz);
      d[((z * N + y) * N + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  const t = new THREE.Data3DTexture(d, N, N, N); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true; return t;
}
/** Tileable micro-surface texture shared by every world material (close-range detail layer, see patch()): R = fine height (grain + pits + faint scratches),
 *  G = mottling (albedo variation), B = roughness variation (correlated with the pits). 256² RGBA8, mipmapped, anisotropic. */
function makeDetailTexture(N = 256) {
  const d = new Uint8Array(N * N * 4); let seed = 0x51ed270b;
  const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sm = (t) => t * t * (3 - 2 * t);
  const lattice = (cells) => { const L = new Float32Array(cells * cells); for (let i = 0; i < L.length; i++) L[i] = rnd(); return (x, y) => { const fx = x * cells, fy = y * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy); const a = (i, j) => L[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)]; return (a(ix, iy) * (1 - tx) + a(ix + 1, iy) * tx) * (1 - ty) + (a(ix, iy + 1) * (1 - tx) + a(ix + 1, iy + 1) * tx) * ty; }; };
  const n8 = lattice(8), n16 = lattice(16), n32 = lattice(32), n64 = lattice(64), n128 = lattice(128), m4 = lattice(4), m9 = lattice(9);
  // worley pits: 24x24 cells, one jittered point per cell (tileable)
  const W = 24, pts = new Float32Array(W * W * 2); for (let i = 0; i < W * W; i++) { pts[i * 2] = rnd(); pts[i * 2 + 1] = rnd(); }
  const worley = (x, y) => { const fx = x * W, fy = y * W, ix = Math.floor(fx), iy = Math.floor(fy); let best = 9; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const cx = (ix + i + W) % W, cy = (iy + j + W) % W; const px = ix + i + pts[(cy * W + cx) * 2], py = iy + j + pts[(cy * W + cx) * 2 + 1]; const dx = fx - px, dy = fy - py; best = Math.min(best, dx * dx + dy * dy); } return Math.sqrt(best); };
  // a few tileable scratches (thin lines with random angle)
  const scr = []; for (let i = 0; i < 26; i++) scr.push({ x: rnd(), y: rnd(), a: rnd() * Math.PI, l: 0.08 + rnd() * 0.22, w: 0.0015 + rnd() * 0.0015, s: 0.4 + rnd() * 0.6 });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    let h = 0.30 * n8(u, v) + 0.26 * n16(u, v) + 0.22 * n32(u, v) + 0.14 * n64(u, v) + 0.08 * n128(u, v);
    const w = worley(u, v); const pit = Math.max(0, 1 - w * 2.4); h -= pit * pit * 0.28;
    let sc = 0; for (const c of scr) { for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const dx = u - (c.x + ox), dy = v - (c.y + oy); const ca = Math.cos(c.a), sa = Math.sin(c.a); const along = dx * ca + dy * sa, perp = -dx * sa + dy * ca; if (Math.abs(along) < c.l) sc = Math.max(sc, c.s * Math.max(0, 1 - Math.abs(perp) / c.w) * (1 - Math.abs(along) / c.l)); } }
    h -= sc * 0.22;
    const i4 = (y * N + x) * 4; d[i4] = Math.max(0, Math.min(255, Math.round((h * 0.9 + 0.12) * 255)));
    d[i4 + 1] = Math.max(0, Math.min(255, Math.round((0.55 * m4(u, v) + 0.45 * m9(u, v)) * 255)));
    d[i4 + 2] = Math.max(0, Math.min(255, Math.round((0.5 + 0.5 * (pit - 0.5) + 0.25 * (n32(u, v) - 0.5)) * 255))); d[i4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}
/** Gravel/dirt micro-texture (tileable, 256² = one tile of 25 cm in patch()): rounded pebbles from jittered Voronoi cells with per-pebble brightness, dark gaps (AO), smoother pebble / dusty gap roughness. */
function makeGravelTexture(N = 256) {
  const d = new Uint8Array(N * N * 4); let seed = 0x2f6e2b1;
  const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const W = 20, P = new Float32Array(W * W * 4); for (let i = 0; i < W * W; i++) { P[i * 4] = 0.15 + 0.7 * rnd(); P[i * 4 + 1] = 0.15 + 0.7 * rnd(); P[i * 4 + 2] = rnd(); P[i * 4 + 3] = rnd(); }
  const sm = (t) => t * t * (3 - 2 * t); const L = new Float32Array(64 * 64); for (let i = 0; i < L.length; i++) L[i] = rnd();
  const grain = (x, y) => { const fx = x * 64, fy = y * 64, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy); const a = (i, j) => L[((j % 64 + 64) % 64) * 64 + ((i % 64 + 64) % 64)]; return (a(ix, iy) * (1 - tx) + a(ix + 1, iy) * tx) * (1 - ty) + (a(ix, iy + 1) * (1 - tx) + a(ix + 1, iy + 1) * tx) * ty; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, fx = u * W, fy = v * W, ix = Math.floor(fx), iy = Math.floor(fy);
    let bestT = 0, bestH = 0, bestC = 0.5, best = 1e9, bestSm = 0; // pebble whose dome is highest at this pixel
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = (ix + i + W) % W, cy = (iy + j + W) % W, k = (cy * W + cx) * 4; const px = ix + i + P[k], py = iy + j + P[k + 1]; const dx = fx - px, dy = fy - py;
      const rad = 0.36 + 0.24 * P[k + 2]; const dd = Math.sqrt(dx * dx * (0.85 + 0.3 * P[k + 3]) + dy * dy * (1.15 - 0.3 * P[k + 3])); const t = Math.max(0, 1 - dd / rad);
      const hgt = Math.sqrt(t) * (0.55 + 0.45 * P[k + 3]); if (hgt > bestH) { bestH = hgt; bestT = t; bestC = 0.25 + 0.75 * P[k + 2]; bestSm = P[k + 3]; }
      best = Math.min(best, dd);
    }
    const gr = grain(u, v); const gap = 1 - Math.min(1, bestT * 3.0);
    const h = bestH * 0.85 + gr * 0.10 * (0.3 + gap) + 0.04;
    const alb = gap * (0.22 + 0.25 * gr) + (1 - gap) * (bestC * 0.85 + 0.15 * gr);
    const rough = gap * 0.85 + (1 - gap) * (0.30 + 0.35 * bestSm);
    const i4 = (y * N + x) * 4; d[i4] = Math.max(0, Math.min(255, Math.round(h * 255))); d[i4 + 1] = Math.max(0, Math.min(255, Math.round(alb * 255))); d[i4 + 2] = Math.max(0, Math.min(255, Math.round(rough * 255))); d[i4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}
// ---- global shared uniforms (values are updated by gfx.js each frame; all patched shaders reference the same objects)
export const G = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color(0x0b0f14) },
  uFogScatter: { value: new THREE.Color(0x1a2430) },
  uFogParams: { value: new THREE.Vector4(0.02, 0.0, 0.0, 6.0) }, // x density/m at base height, y height falloff 1/m, z base height, w scatter power
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uWind: { value: new THREE.Vector3(0, 0, 0) },
  uSnow: { value: 0 },
  uWet: { value: 0 },
  uFrost: { value: 0 },
  uNoise3: { value: makeNoise3D(64, 8) },
  uDetail: { value: makeDetailTexture(256) }, // shared micro-surface (see patch(): detail layer + specular AA)
  uDetailG: { value: makeGravelTexture(256) }, // gravel/dirt variant (patch option detail:'gravel')
  uPartLight: { value: new THREE.Color(1, 1, 1) }, // irradiance seen by unlit alpha particles (smoke/dust/blood colours are albedos)
  uVM: { value: 0 }, // 1 while the viewmodel pass renders: patched materials write alpha 0 (TAA mask)
  uAmbOcc: { value: 1 }, // how strongly sky-visibility masks IBL (0 = ignore)
  // planar water reflection (gfx.js screen-space splat pass, sampled by water.js): mirrored copy of last frame's opaque scene
  uReflTex: { value: null }, uReflVP: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
  uExpoTex: { value: (() => { const t = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; })() }, // 1x1 adapted exposure (gfx.js publishes the live one each frame)
  uReflLevelU: { value: 0 }, // world y of the reflection plane (set by gfx from reflLevel)
  reflReq: false, reflWant: null, reflLevel: 0, // reflWant: level requested by the active stop (`data.reflect.level`) — Water overrides it while the sea is drawn // set by Water.mesh.onBeforeRender each frame the sea is drawn (plain JS fields, not uniforms)
};

export const FOG_GLSL = /* glsl */`
uniform vec3 uFogColor; uniform vec3 uFogScatter; uniform vec4 uFogParams; uniform vec3 uSunDir;
float fogFactor(vec3 wpos){
  vec3 d = wpos - cameraPosition; float t = length(d); vec3 rd = d / max(t, 1e-4);
  float k = uFogParams.y; float y0 = cameraPosition.y - uFogParams.z;
  float a = k * rd.y;
  float integ = abs(a) < 1e-4 ? t : (1.0 - exp(-clamp(a * t, -20.0, 20.0))) / a;
  float fog = uFogParams.x * exp(clamp(-k * y0, -20.0, 20.0)) * integ;
  return 1.0 - exp(-max(fog, 0.0));
}
vec3 fogColorDir(vec3 rd){ float s = pow(max(dot(rd, uSunDir), 0.0), uFogParams.w); return mix(uFogColor, uFogScatter, s); }
vec3 applyFog(vec3 col, vec3 wpos){
  vec3 rd = normalize(wpos - cameraPosition);
  return mix(col, fogColorDir(rd), fogFactor(wpos));
}
`;

// cheap 3D value noise for in-shader breakup (texture free)
export const NOISE_GLSL = /* glsl */`
uniform highp sampler3D uNoise3;
float zvn3(vec3 x){ return texture(uNoise3, x * 0.125).r; }
float zfbm3(vec3 p){ return 0.5 * texture(uNoise3, p * 0.125).r + 0.25 * texture(uNoise3, p * 0.2537 + vec3(0.37, 0.11, 0.53)).g + 0.125 * texture(uNoise3, p * 0.5013 + vec3(0.71, 0.23, 0.19)).b + 0.0625 * texture(uNoise3, p * 1.0061 + vec3(0.13, 0.79, 0.41)).a; }
`;

const TRI_FRAG = /* glsl */`
vec4 triSample(sampler2D s, vec3 p, vec3 w, float sc){
  return texture2D(s, p.zy*sc)*w.x + texture2D(s, p.xz*sc)*w.y + texture2D(s, p.xy*sc)*w.z;
}
`;

/** planar-reflection sampling (last frame's mirrored scene from gfx.js): returns rgb (blurred along the vertical for rough surfaces) and coverage in .a */
export const REFL_GLSL = /* glsl */`
uniform sampler2D uReflTex; uniform mat4 uReflVP; uniform float uReflOn; uniform float uReflLevel;
vec4 zPlanarRefl(vec3 wp, vec3 wn, float rough){
  vec3 Vw = normalize(cameraPosition - wp); float cosT = clamp(dot(Vw, wn), 0.0, 1.0); float Fr = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec4 pv = uReflVP * vec4(wp, 1.0); vec2 ruv = pv.xy / pv.w * 0.5 + 0.5; float dist = length(cameraPosition - wp); vec2 wob = wn.xz * (0.08 / (1.0 + dist * 0.03));
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uTime * 7.0); vec3 acc = vec3(0.0); float cov = 0.0;
  for (int i = 0; i < 6; i++) { float fi = (float(i) + jit) / 6.0; vec2 ouv = ruv + wob + vec2((jit - 0.5) * 0.004, (fi - 0.3) * (0.004 + 0.035 * rough)); vec4 rs = texture2D(uReflTex, clamp(ouv, vec2(0.002), vec2(0.998))); acc += rs.rgb; cov += rs.a; }
  cov /= 6.0; float edge = smoothstep(0.0, 0.06, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));
  return vec4(acc / max(cov * 6.0, 1e-3), clamp(Fr * cov * edge * 1.15, 0.0, 0.97));
}`;

/** close-range micro-surface: derivative bump from the shared detail texture (world-space, dominant-axis projection, 1 fetch) + roughness/albedo breakup + specular anti-aliasing */
const DETAIL_GLSL = /* glsl */`
uniform sampler2D uDetail;
vec3 zBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos)); vec3 R1 = cross(vSigmaY, surf_norm); vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection; vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2); return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

/**
 * Patch a MeshStandard/Physical material.
 * opts: { triplanar: scale(1/m) | {scale, sharp}, snow: bool|number, wet: bool, breakup: 0..1, vis: bool (aVis attribute present),
 *         wind: {amp, freq, stiff:'y'|'none'}, vertex: 'glsl injected after begin_vertex', frag: 'glsl injected after emissive', key: string }
 */
const NO_DETAIL = typeof location !== 'undefined' && /[?&]nodetail=1/.test(location.search);
export function patch(mat, opts = {}) {
  const o = Object.assign({}, opts);
  if (NO_DETAIL) o.detail = false; // ?nodetail=1 for A/B comparisons
  mat.userData.patchOpts = o;
  // detail kind is resolved lazily (the material's name is assigned after patch(): Builder.m sets it) and must be the same in the cache key and in onBeforeCompile
  const dkind = () => (o.detail === 'gravel' || (o.detail && o.detail.kind === 'gravel') || (o.detail === undefined && /^(dirt|gravel|ground|sand|asphalt|road|path|mud)/i.test(mat.name || ''))) ? 'gravel' : 'micro';
  const detailAmp = o.detail === false ? 0 : (typeof o.detail === 'number' ? o.detail : (o.detail && o.detail.amp) || 1);
  // UBER PROGRAM: triplanar / snow / wet / breakup / detail / refl strength are RUNTIME uniforms (uPM, uPM2 below), not compile-time constants, so materials that differ only in those
  // share ONE GPU program. Every distinct program costs ~55 uniform calls per frame (three re-uploads the whole light block, shadow + view matrices per program): fewer programs = fewer GL calls.
  // The key only carries what really changes the shader code: attribute/varying presence (vis), instancing/skinning/maps (three adds those itself), wind stiffness mode, refl on/off,
  // custom vertex/frag snippets (hashed) and the detail sampler kind.
  const wnd = o.wind;
  const keyBase = 'pu' + (o.vis ? 'v' : '') + (o.refl ? 'R' : '') + (wnd ? 'W' + (wnd.stiff || '') : '') + (o.vertex ? 'V' + hashStr(o.vertex) : '') + (o.frag ? 'F' + hashStr(o.frag) : '');
  mat.customProgramCacheKey = () => keyBase + (dkind() === 'gravel' ? 'DG' : '');
  const triS = o.triplanar ? (typeof o.triplanar === 'number' ? o.triplanar : o.triplanar.scale) : 0, triSh = o.triplanar ? (typeof o.triplanar === 'number' ? 4 : (o.triplanar.sharp ?? 4)) : 4;
  const snowA = o.snow ? (typeof o.snow === 'number' ? o.snow : 1) : 0;
  mat.onBeforeCompile = (shader) => {
    const detailKind = dkind();
    Object.assign(shader.uniforms, { uTime: G.uTime, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir, uWind: G.uWind, uSnow: G.uSnow, uWet: G.uWet, uFrost: G.uFrost, uAmbOcc: G.uAmbOcc, uVM: G.uVM, uNoise3: G.uNoise3 });
    // per-material values of the uber features: uPM = (triplanar scale [0 = UV mapped], triplanar sharpness, snow amount [0 = off], breakup amount [0 = off]); uPM2 = (wet flag, detail amplitude [0 = off], refl strength, spec-AA flag)
    shader.uniforms.uPM = { value: new THREE.Vector4(triS, triSh, snowA, o.breakup || 0) };
    shader.uniforms.uPM2 = { value: new THREE.Vector4(o.wet ? 1 : 0, detailAmp, o.refl ? (typeof o.refl === 'number' ? o.refl : 1) : 0, o.detail === false ? 0 : 1) };
    if (o.wind) { const w = o.wind; shader.uniforms.uWindP = { value: new THREE.Vector4(w.amp ?? 0.05, w.freq ?? 1.6, w.scale ?? 1, 0) }; }
    shader.uniforms[detailKind === 'gravel' ? 'uDetailG' : 'uDetail'] = detailKind === 'gravel' ? G.uDetailG : G.uDetail;
    if (o.refl) Object.assign(shader.uniforms, { uReflTex: G.uReflTex, uReflVP: G.uReflVP, uReflOn: G.uReflOn, uReflLevel: G.uReflLevelU });
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    // ---------- vertex
    let vpars = 'varying vec3 vWPos; varying vec3 vWN;\nuniform float uTime; uniform vec3 uWind;\n';
    if (o.vis) vpars += 'attribute vec2 aVis; varying vec2 vVis;\n';
    if (o.wind) vpars += 'uniform vec4 uWindP;\n';
    vs = vs.replace('#include <common>', '#include <common>\n' + vpars);
    vs = vs.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ vec3 wn = objectNormal;\n#ifdef USE_INSTANCING\n wn = mat3(instanceMatrix) * wn;\n#endif\n vWN = normalize(mat3(modelMatrix) * wn); }');
    if (o.wind) {
      const w = o.wind;
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 wp0 = modelMatrix * vec4(transformed,1.0);
        #ifdef USE_INSTANCING
        wp0 = modelMatrix * instanceMatrix * vec4(transformed,1.0);
        #endif
        float ph = wp0.x*0.35 + wp0.z*0.27;
        float hgt = ${w.stiff === 'uv' ? 'uv.y' : 'max(transformed.y, 0.0)'};
        float gust = sin(uTime*uWindP.y + ph) + 0.5*sin(uTime*uWindP.y*2.3 + ph*1.7);
        vec3 wdir = uWind; float ws = length(wdir);
        transformed.xz += (ws > 0.01 ? wdir.xz/ws : vec2(1.0,0.0)) * gust * uWindP.x * (0.35 + ws*0.15) * hgt * hgt * uWindP.z;
      }`);
    }
    if (o.vertex) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + o.vertex);
    vs = vs.replace('#include <fog_vertex>', '#include <fog_vertex>\n vWPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;' + (o.vis ? ' vVis = aVis;' : ''));
    // ---------- fragment
    let fpars = 'varying vec3 vWPos; varying vec3 vWN;\nuniform float uVM; uniform float uTime; uniform float uSnow; uniform float uWet; uniform float uFrost; uniform float uAmbOcc; uniform vec3 uWind; uniform vec4 uPM; uniform vec4 uPM2;\n' + FOG_GLSL + NOISE_GLSL;
    if (o.vis) fpars += 'varying vec2 vVis;\n';
    if (o.refl) fpars += REFL_GLSL;
    fpars += (detailKind === 'gravel' ? DETAIL_GLSL.replace('uniform sampler2D uDetail;', 'uniform sampler2D uDetailG;') : DETAIL_GLSL);
    fpars += TRI_FRAG;
    fs = fs.replace('#include <common>', '#include <common>\n' + fpars);
    fs = fs.replace('#include <map_fragment>', `
      vec3 triW = vec3(0.0, 1.0, 0.0); if (uPM.x > 0.0) { triW = pow(abs(normalize(vWN)), vec3(uPM.y)); triW /= (triW.x + triW.y + triW.z); }
      if (uPM.x > 0.0) {
        #ifdef USE_MAP
        { vec4 sampledDiffuseColor = triSample(map, vWPos, triW, uPM.x); diffuseColor *= sampledDiffuseColor; }
        #endif
      } else {
        #include <map_fragment>
      }`);
    fs = fs.replace('#include <roughnessmap_fragment>', `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
      { vec4 texelRoughness = (uPM.x > 0.0) ? triSample(roughnessMap, vWPos, triW, uPM.x) : texture2D(roughnessMap, vRoughnessMapUv); roughnessFactor *= texelRoughness.g; }
      #endif`);
    fs = fs.replace('#include <metalnessmap_fragment>', `
      float metalnessFactor = metalness;
      #ifdef USE_METALNESSMAP
      { vec4 texelMetalness = (uPM.x > 0.0) ? triSample(metalnessMap, vWPos, triW, uPM.x) : texture2D(metalnessMap, vMetalnessMapUv); metalnessFactor *= texelMetalness.b; }
      #endif`);
    fs = fs.replace('#include <normal_fragment_maps>', `
      #ifdef USE_NORMALMAP_TANGENTSPACE
      if (uPM.x > 0.0) {
        vec3 wn = normalize(vWN);
        vec3 nx = texture2D(normalMap, vWPos.zy*uPM.x).xyz*2.0-1.0; vec3 ny = texture2D(normalMap, vWPos.xz*uPM.x).xyz*2.0-1.0; vec3 nz = texture2D(normalMap, vWPos.xy*uPM.x).xyz*2.0-1.0;
        nx.xy *= normalScale; ny.xy *= normalScale; nz.xy *= normalScale;
        // whiteout blend
        vec3 tx = vec3(nx.xy + wn.zy, abs(nx.z) * wn.x); vec3 ty = vec3(ny.xy + wn.xz, abs(ny.z) * wn.y); vec3 tz = vec3(nz.xy + wn.xy, abs(nz.z) * wn.z);
        vec3 wnb = normalize(tx.zyx * triW.x + ty.xzy * triW.y + tz.xyz * triW.z);
        normal = normalize((viewMatrix * vec4(wnb, 0.0)).xyz);
        #ifdef DOUBLE_SIDED
        normal *= faceDirection;
        #endif
      } else {
        vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
        #if defined( USE_PACKED_NORMALMAP )
        mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
        #endif
        mapN.xy *= normalScale;
        normal = normalize( tbn * mapN );
      }
      #else
      #include <normal_fragment_maps>
      #endif`);
    if (o.vis) { // baked per-vertex sky visibility (y) masks image-based ambient; ao (x) masks indirect diffuse
      const lfm = THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', 'iblIrradiance += getIBLIrradiance( geometryNormal ) * mix(1.0, vVis.y, uAmbOcc);').replace('radiance += iblRadiance;', 'radiance += iblRadiance * mix(1.0, vVis.y, uAmbOcc);');
      fs = fs.replace('#include <lights_fragment_maps>', lfm);
      fs = fs.replace('#include <aomap_fragment>', THREE.ShaderChunk.aomap_fragment + '\n reflectedLight.indirectDiffuse *= mix(1.0, vVis.x, uAmbOcc);');
    }
    const gr = detailKind === 'gravel'; const AB = gr ? '0.0045' : '0.0016', DS = gr ? '4.0' : '8.3', SAM = gr ? 'uDetailG' : 'uDetail';
    let post = `{ // detail layer (see DETAIL_GLSL) + specular AA; both are skipped by uniform branches for materials that opted out; the viewmodel pass (uVM) never gets the world-space bump
        if (uPM2.y > 0.0 && uVM < 0.5) {
          float dd = length(vViewPosition); float dfade = 1.0 - smoothstep(4.0, 16.0, dd);
          if (dfade > 0.002) {
            vec3 aw = abs(vWN); vec2 duv = (aw.y > aw.x && aw.y > aw.z) ? vWPos.xz : ((aw.x > aw.z) ? vWPos.zy : vWPos.xy);
${gr ? `            vec4 dtx = texture2D(${SAM}, duv * ${DS});
            // gravel: a second, 3.7x larger tile (rotated, offset) breaks the 25 cm repeat and adds stone-size variety (the base textures alone read as carpet at 1 m)
            vec2 duv2 = vec2(duv.x * 0.94 - duv.y * 0.34, duv.x * 0.34 + duv.y * 0.94) * ${DS} * 0.27 + vec2(0.37, 0.61); vec4 dtx2 = texture2D(${SAM}, duv2);
            float hC = dtx.r + 0.75 * dtx2.r * (1.0 - smoothstep(6.0, 26.0, dd));
            vec2 dH = vec2(dFdx(hC), dFdy(hC)); vec2 px = vec2(max(length(dFdx(vWPos)), 1e-5), max(length(dFdy(vWPos)), 1e-5));
            vec2 slope = clamp(uPM2.y * ${AB} * dH / px, vec2(-0.9), vec2(0.9)) * dfade;
            normal = zBump(-vViewPosition, normal, slope, faceDirection);
            float tone = mix(dtx.g, dtx2.g, 0.35); float cav = smoothstep(0.10, 0.55, dtx.r * 0.7 + dtx2.r * 0.5);
            diffuseColor.rgb *= (1.0 + (tone - 0.55) * 0.62 * dfade) * mix(1.0, mix(0.70, 1.0, cav), dfade); diffuseColor.rgb *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), (dtx2.b - 0.5) * 0.9 * dfade);
            roughnessFactor = clamp(roughnessFactor * (1.0 + (dtx.b - 0.5) * 0.42 * dfade) + (1.0 - cav) * 0.10 * dfade, 0.04, 1.0);` : `            vec4 dtx = texture2D(${SAM}, duv * ${DS});
            vec2 dH = vec2(dFdx(dtx.r), dFdy(dtx.r)); vec2 px = vec2(max(length(dFdx(vWPos)), 1e-5), max(length(dFdy(vWPos)), 1e-5));
            vec2 slope = clamp(uPM2.y * ${AB} * dH / px, vec2(-0.9), vec2(0.9)) * dfade;
            normal = zBump(-vViewPosition, normal, slope, faceDirection);
            diffuseColor.rgb *= 1.0 + (dtx.g - 0.5) * 0.14 * dfade; roughnessFactor = clamp(roughnessFactor * (1.0 + (dtx.b - 0.5) * 0.42 * dfade), 0.04, 1.0);`}
          }
        }
        if (uPM2.w > 0.5) {
          vec3 nDx = dFdx(normal), nDy = dFdy(normal); float nVar = 0.25 * (dot(nDx, nDx) + dot(nDy, nDy)); float kR = min(2.0 * nVar, 0.18);
          float aR = roughnessFactor * roughnessFactor; roughnessFactor = sqrt(sqrt(aR * aR + kR));
        }
      }\n`;
    post += `if (uPM.w > 0.0) { float bn = zfbm3(vWPos*0.21); diffuseColor.rgb *= 1.0 + (bn-0.5)*uPM.w*0.9; roughnessFactor = clamp(roughnessFactor + (bn-0.5)*uPM.w*0.3, 0.04, 1.0); }\n`;
    post += `if (uPM2.x > 0.5) { float wn = smoothstep(0.35, 0.75, zfbm3(vWPos*0.9)); float wet = uWet * (0.55 + 0.45*wn); diffuseColor.rgb *= mix(1.0, 0.62, wet); roughnessFactor = mix(roughnessFactor, roughnessFactor*0.32, wet); }\n`;
    post += `if (uPM.z > 0.0 && uSnow > 0.001) { vec3 wnorm = normalize(vWN); vec3 wnMap = normalize((vec4(normal,0.0) * viewMatrix).xyz);
        float up = smoothstep(0.35, 0.85, mix(wnorm.y, wnMap.y, 0.6));
        float n1 = zfbm3(vWPos*1.7); float n2 = zvn3(vWPos*11.0);
        float cov = clamp(up * uSnow * uPM.z * (0.72 + 0.6*n1) , 0.0, 1.0); cov = smoothstep(0.25, 0.6, cov);
        vec3 snowCol = mix(vec3(0.80,0.85,0.92), vec3(0.95,0.97,1.0), n1);
        float glint = step(0.972, zvn3(vWPos*38.0 + vec3(0.0, 0.0, 0.0))) * 0.9;
        diffuseColor.rgb = mix(diffuseColor.rgb, snowCol + glint*0.3, cov);
        roughnessFactor = mix(roughnessFactor, 0.62 - glint*0.4, cov); metalnessFactor = mix(metalnessFactor, 0.0, cov);
        totalEmissiveRadiance *= (1.0 - cov); }\n`;
    if (o.frag) post += o.frag + '\n';
    fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + post);
    if (o.refl) fs = fs.replace('#include <opaque_fragment>', `
      if (uReflOn > 0.5 && uPM2.z > 0.0) { // glossy horizontal surface on the reflection plane: real mirrored scene (screen-space splat of the previous frame)
        float onPlane = 1.0 - smoothstep(0.03, 0.10, abs(vWPos.y - uReflLevel)); vec3 wnR = normalize((vec4(normal, 0.0) * viewMatrix).xyz); float upR = smoothstep(0.75, 0.95, wnR.y);
        float glossy = 1.0 - smoothstep(0.30, 0.85, roughnessFactor);
        if (onPlane * upR * glossy > 0.01) { vec4 rr = zPlanarRefl(vWPos, wnR, roughnessFactor); outgoingLight = mix(outgoingLight, rr.rgb, rr.a * onPlane * upR * glossy * uPM2.z); }
      }
      #include <opaque_fragment>`);
    fs = fs.replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWPos); gl_FragColor.a *= (1.0 - uVM);');
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  mat.userData.patchFn = mat.onBeforeCompile; // (visVariant refuses to clone materials whose onBeforeCompile was wrapped afterwards: the wrapper would be lost -> undeclared identifiers)
  return mat;
}
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

/** Clone of a patched material that reads the baked aVis attribute (used only for StaticBatch meshes, which always carry it). */
export function visVariant(mat) {
  if (!mat.userData.patchOpts) return mat; if (mat.userData.visVariant) return mat.userData.visVariant; if (mat.onBeforeCompile !== mat.userData.patchFn) return mat;
  const m = mat.clone(); m.userData = { ...mat.userData, patchOpts: undefined, visVariant: null }; patch(m, { ...mat.userData.patchOpts, vis: true }); mat.userData.visVariant = m; return m;
}
/** Standard PBR material with patches. o: three material params + patch options (triplanar, snow, wet, breakup, vis, wind, vertex, frag) */
export function std(o = {}) {
  const { triplanar, snow, wet, breakup, vis, wind, vertex, frag, key, physical, refl, detail, ...mp } = o;
  if (mp.roughness === undefined) mp.roughness = 0.8;
  if (mp.metalness === undefined) mp.metalness = 0;
  if (mp.normalScale && !(mp.normalScale instanceof THREE.Vector2)) mp.normalScale = new THREE.Vector2(mp.normalScale, mp.normalScale);
  const m = (physical ? new THREE.MeshPhysicalMaterial(mp) : new THREE.MeshStandardMaterial(mp));
  return patch(m, { triplanar, snow, wet, breakup, vis, wind, vertex, frag, key, refl, detail });
}
export const phys = (o) => std({ ...o, physical: true });

/** Unlit additive/alpha material with fog (glows, beams, sprites). */
export function glowMaterial({ color = 0xffffff, map = null, opacity = 1, blending = THREE.AdditiveBlending, depthWrite = false, side = THREE.DoubleSide, fog = true, fresnel = 0 } = {}) {
  const m = new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, blending, depthWrite, side, fog: false });
  m.userData.isGlow = true;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <fog_vertex>', '#include <fog_vertex>\n vWPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + FOG_GLSL)
      .replace('#include <fog_fragment>', fog ? (blending === THREE.AdditiveBlending ? 'gl_FragColor.rgb *= 1.0 - fogFactor(vWPos);' : 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWPos);') : '');
  };
  m.customProgramCacheKey = () => 'glow' + (fog ? 1 : 0) + (blending === THREE.AdditiveBlending ? 'a' : 'n');
  return m;
}
