// LAST FERRY — shared runtime pieces used by all four stops, the route and the ferry:
//   * Sea: the ONE Water instance (stops + ferry share it), per-stop sea state blended by camera position, water.update() once per frame.
//   * lampReg: registry of bright emitters -> "virtual lamp specular" streaks on water and wet ground (patched into materials' fragment shader).
//   * Glows: fog-aware lamp glare billboards (core + flare + mist lobe that grows in fog) with blink patterns. One draw call.
//   * Foam: ribbons lying ON the Gerstner surface (shader evaluates the same wave function) for quay lapping, pile rings, hull collar, wake.
import * as THREE from 'three';
import { Water } from '../../core/water.js';
import { G, FOG_GLSL, NOISE_GLSL, visVariant } from '../../core/mats.js';
import { STOPS } from './layout.js';

const V3 = THREE.Vector3, V4 = THREE.Vector4, Col = THREE.Color;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

// ------------------------------------------------------------------------------------------------ waves + sea state
/** base waves at amp 1 (water.amp scales them). dir = propagation direction. Swell comes from the open sea in the north-west. */
export const WAVES = [
  { dir: [1, 0.35], len: 58, amp: 0.62, steep: 0.5 },
  { dir: [0.6, 1], len: 31, amp: 0.30, steep: 0.55 },
  { dir: [-0.3, 0.9], len: 17, amp: 0.13, steep: 0.6 },
  { dir: [0.9, -0.5], len: 9.5, amp: 0.055, steep: 0.55 },
  { dir: [-0.8, -0.45], len: 5.2, amp: 0.024, steep: 0.5 },
];
/** sea state per stop: amplitude multiplier, colours, foam, roughness. Rises leg by leg: sheltered pier -> harbour -> channel -> storm swell. */
export const SEA = [
  { amp: 0.28, shallow: 0x123d4a, deep: 0x04161e, foam: 0.22, ripple: 1.0, rough: 0.075, glow: 0x08222c, sky: 0x24365a, gk: 0.85 },    // City Pier: dark blue-green harbour glass
  { amp: 0.38, shallow: 0x0b3a3c, deep: 0x03151a, foam: 0.3, ripple: 1.1, rough: 0.09, glow: 0x062a26, sky: 0x1c4c4e, gk: 0.42 },      // Wharf: green-teal, slimy
  { amp: 0.60, shallow: 0x143844, deep: 0x04121a, foam: 0.5, ripple: 1.0, rough: 0.10, glow: 0x08262e, sky: 0x24444e, gk: 0.6 },      // Prison channel: cold chop
  { amp: 1.05, shallow: 0x0c2640, deep: 0x02101c, foam: 0.72, ripple: 1.3, rough: 0.14, glow: 0x072034, sky: 0x2a486a, gk: 0.5 },     // Lighthouse: storm swell, whitecaps
];

// ------------------------------------------------------------------------------------------------ lamp reflections
export const LAMP_N = 14;
export const lampU = { P: { value: Array.from({ length: LAMP_N }, () => new V4(0, -9999, 0, 1)) }, C: { value: Array.from({ length: LAMP_N }, () => new V4(0, 0, 0, 0)) } };
const LAMP_DECL = /* glsl */`
#define NLAMP ${LAMP_N}
uniform vec4 uLampP[NLAMP]; uniform vec4 uLampC[NLAMP]; uniform float uLampGain; uniform float uLampMaxR; uniform float uLampPatchy;
float lHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(lHash(i), lHash(i + vec2(1.0, 0.0)), f.x), mix(lHash(i + vec2(0.0, 1.0)), lHash(i + vec2(1.0, 1.0)), f.x), f.y); }
// virtual specular of bright emitters: gaussian lobe around the mirror direction, width from roughness + glare size
vec3 lampRefl(vec3 P, vec3 N, vec3 V, float rough){
  vec3 R = reflect(-V, N); float a = rough * rough; float nv = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.035 + 0.965 * pow(1.0 - nv, 5.0); vec3 acc = vec3(0.0);
  for (int i = 0; i < NLAMP; i++) {
    vec4 c = uLampC[i]; if (c.a < 0.01) continue;
    vec3 L = uLampP[i].xyz - P; float d = length(L); L /= max(d, 0.01);
    float th2 = 2.0 * (1.0 - clamp(dot(R, L), -1.0, 1.0)); float rho = uLampP[i].w / max(d, 1.0);
    float s2 = 4.0 * a * a + rho * rho + 0.0009; float k = exp(-th2 / (2.0 * s2)) * min(1.0, 0.0016 / s2);
    acc += c.rgb * (c.a * k);
  }
  return acc * F;
}`;
const LAMP_APPLY = /* glsl */`
{ float lrR = clamp(roughnessFactor, 0.02, 1.0); float lrK = 1.0 - smoothstep(uLampMaxR * 0.6, uLampMaxR, lrR);
  if (lrK > 0.001) { vec3 lrN = inverseTransformDirection(normal, viewMatrix); vec3 lrV = normalize(cameraPosition - vWPos); float lrP = 1.0; if (uLampPatchy > 0.0) { float pn = lNoise(vWPos.xz * 0.31) * 0.55 + lNoise(vWPos.xz * 1.17 + 7.0) * 0.3 + lNoise(vWPos.xz * 4.3 + 19.0) * 0.15; lrP = mix(1.0, smoothstep(0.38, 0.62, pn), uLampPatchy); } totalEmissiveRadiance += lampRefl(vWPos, lrN, lrV, lrR) * (uLampGain * lrK * lrP); } }
`;
/** Patch a (already patched via std()) material so bright registered lamps reflect on it (wet ground, water, deck plates). */
export function withLampRefl(mat, { gain = 1, maxRough = 0.6, patchy = 0 } = {}) {
  const g = { value: gain }, mr = { value: maxRough }, pt = { value: patchy }; mat.userData.lamp = { g, mr, pt };
  // StaticBatch draws a baked-visibility VARIANT of every patched material (visVariant), so the injection must be applied to both
  const wrap = (m) => {
    const prev = m.onBeforeCompile, key0 = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
    m.onBeforeCompile = (shader, r) => {
      if (prev) prev(shader, r);
      shader.uniforms.uLampP = lampU.P; shader.uniforms.uLampC = lampU.C; shader.uniforms.uLampGain = g; shader.uniforms.uLampMaxR = mr; shader.uniforms.uLampPatchy = pt;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + LAMP_DECL).replace('#include <lights_physical_fragment>', LAMP_APPLY + '\n#include <lights_physical_fragment>');
    };
    m.customProgramCacheKey = () => key0 + 'LR'; m.needsUpdate = true;
  };
  wrap(mat); const v = visVariant(mat); if (v && v !== mat) wrap(v);
  return mat;
}

class LampRegistry {
  constructor() { this.list = []; this._sel = []; }
  /** world position, colour hex, reflection strength (~1..6), glare radius (m). Returns a mutable entry {x,y,z,on}. */
  add(x, y, z, color = 0xffaa55, strength = 3, size = 0.35, stop = -1) { const c = new Col(color); const e = { x, y, z, r: c.r, g: c.g, b: c.b, k: strength, size, stop, on: 1 }; this.list.push(e); return e; }
  clear() { this.list.length = 0; }
  update(cam) {
    const sel = this._sel; sel.length = 0;
    for (const e of this.list) { if (e.on <= 0) continue; const dx = e.x - cam.x, dy = e.y - cam.y, dz = e.z - cam.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > 240 * 240) continue; e._s = e.k * e.on / (d2 + 300); e._d = Math.sqrt(d2); sel.push(e); }
    sel.sort((a, b) => b._s - a._s);
    for (let i = 0; i < LAMP_N; i++) { const e = sel[i], P = lampU.P.value[i], C = lampU.C.value[i]; if (!e) { C.w = 0; continue; } const fade = 1 - clamp((e._d - 90) / 130); P.set(e.x, e.y, e.z, e.size); C.set(e.r * e.k, e.g * e.k, e.b * e.k, fade * e.on); }
  }
}
export const lampReg = new LampRegistry();
/** lighthouse beam state (shared by the route-level cones, the lantern on the rock and the audio/ambience): 2 opposite beams, one revolution every LH.period s */
export const LH = { world: [0, 0, 0], period: 9.5, angle(t) { return (t / this.period) * Math.PI * 2; } };
/** per-frame animation hooks registered by route.js (buoys, lighthouse beam, gulls, ...); driven from the ferry's simulate() and from any visible stop */
export const anim = { hooks: [], t: -1, run(dt, t, cam) { if (t === this.t) return; this.t = t; for (const h of this.hooks) h(dt, t, cam); } };

// ------------------------------------------------------------------------------------------------ Sea (shared Water)
class Sea {
  constructor() {
    const s = SEA[0];
    this.water = new Water({ size: 1500, waves: WAVES, color: s.shallow, deep: s.deep, roughness: s.rough, level: 0, foam: s.foam, clarity: 0.3, ripple: s.ripple, rings: 96, segs: 176 });
    withLampRefl(this.water.mat, { gain: 0.4, maxRough: 0.05 });   // the planar reflection mirrors the lamps now; the 14-lamp virtual-specular loop (dynamic branch) is switched off on the sea to save ~2 ms
    // the radial mesh is wound clockwise seen from above in some core versions (culled with FrontSide): make it face up regardless
    { const g = this.water.mesh.geometry, ix = g.index.array, ps = g.attributes.position.array; let k = 0; for (let i = 0; i < ix.length; i += 3) { const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3; const ny = (ps[b + 2] - ps[a + 2]) * (ps[c] - ps[a]) - (ps[b] - ps[a]) * (ps[c + 2] - ps[a + 2]); if (Math.abs(ny) > 1e-3) { k = ny; break; } } if (k < 0) { for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.index.needsUpdate = true; } }
    this.mesh = this.water.mesh; this.origins = STOPS.map((st) => new V3(...st.origin));
    this.t = -1; this.shelter = 0; this.amp = s.amp; this.state = { ...s }; this.tint = new Col(0x8a99a4); this.weights = [1, 0, 0, 0]; this.nearest = 0; this._c = new Col();
    this.foamTint = { value: new Col(0.55, 0.6, 0.64) };
    this.cols = SEA.map((S) => ({ sh: new Col(S.shallow), dp: new Col(S.deep), gl: new Col(S.glow), sk: new Col(S.sky) }));
    this.glowU = { value: new Col() }; this.skyU = { value: new Col() }; this.water.uniforms.uClarity.value = 0.5;
    // scattered body light + fresnel sky sheen: keeps the sea a dark blue-green glass instead of black where the planar reflection has no coverage (the reflection pass only mirrors opaque scene pixels, not the sky)
    { const m = this.water.mat, prev = m.onBeforeCompile, key0 = m.customProgramCacheKey();
      m.onBeforeCompile = (shader, r) => { if (prev) prev(shader, r); shader.uniforms.uSeaGlow = this.glowU; shader.uniforms.uSeaSky = this.skyU;
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSeaGlow; uniform vec3 uSeaSky;')
          .replace('#include <lights_physical_fragment>', '{ vec3 sgV = normalize(cameraPosition - vWPos); float sgC = clamp(dot(sgV, zWN), 0.0, 1.0); float sgF = 0.03 + 0.97 * pow(1.0 - sgC, 3.0); totalEmissiveRadiance += uSeaGlow * (0.4 + 0.6 * (1.0 - sgC)) + uSeaSky * sgF; }\n#include <lights_physical_fragment>'); };
      m.customProgramCacheKey = () => key0 + 'SG'; m.needsUpdate = true; }
  }
  attach(root) { if (this.mesh.parent !== root) root.add(this.mesh); }
  /** call every frame (idempotent per time value): centres the water on the camera and blends the sea state by position */
  tick(t, cam, gfx) {
    if (t === this.t) return; this.t = t;
    const w = this.weights; let sum = 0, best = 0;
    for (let i = 0; i < 4; i++) { const o = this.origins[i], d = Math.hypot(cam.x - o.x, cam.z - o.z); const wi = 1 / (1 + Math.pow(d / 120, 4)); w[i] = wi; sum += wi; if (wi > w[best]) best = i; }
    this.nearest = best; const st = this.state; st.amp = st.foam = st.ripple = st.rough = 0;
    let sr = 0, sg = 0, sb = 0, dr = 0, dg = 0, db = 0, gr = 0, gg = 0, gb = 0, kr = 0, kg = 0, kb = 0;
    for (let i = 0; i < 4; i++) { const k = w[i] / sum, S = SEA[i], C = this.cols[i]; st.amp += S.amp * k; st.foam += S.foam * k; st.ripple += S.ripple * k; st.rough += S.rough * k; sr += C.sh.r * k; sg += C.sh.g * k; sb += C.sh.b * k; dr += C.dp.r * k; dg += C.dp.g * k; db += C.dp.b * k; const kk = k * S.gk; gr += C.gl.r * kk; gg += C.gl.g * kk; gb += C.gl.b * kk; kr += C.sk.r * kk; kg += C.sk.g * kk; kb += C.sk.b * kk; }
    const u = this.water.uniforms; u.uShallow.value.setRGB(sr, sg, sb); u.uDeep.value.setRGB(dr, dg, db); u.uFoam.value = st.foam; u.uRipple.value = st.ripple; this.water.mat.roughness = st.rough; this.glowU.value.setRGB(gr, gg, gb); this.skyU.value.setRGB(kr, kg, kb);
    this.amp = st.amp * (1 - 0.55 * this.shelter); this.water.update(t, cam, this.amp);   // shelter: the lee of the quay while the ferry is docked (the mirrored deck colliders are static)
    if (gfx && gfx.atmo) { const a = gfx.atmo; this.foamTint.value.copy(a.fog.scatter).lerp(this._c.set(0xffffff), 0.35).multiplyScalar(0.5 + 0.5 * Math.min(1, a.sun.intensity)); }
    lampReg.update(cam);
  }
  height(x, z, t, out) { return this.water.height(x, z, t ?? this.t, out); }
}
let _sea = null;
export const getSea = () => (_sea || (_sea = new Sea()));

// ------------------------------------------------------------------------------------------------ Glows (lamp glare with fog mist, blink patterns)
const GLOW_VS = /* glsl */`
attribute vec3 aPos; attribute vec4 aCol; attribute vec4 aPar; attribute vec4 aBlink;   // aPar: size, flickerSpeed, phase, mist ; aBlink: period, duty, phase, 0
uniform float uTime; varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos; varying float vMist;
void main(){
  vec4 wp = modelMatrix * vec4(aPos, 1.0); vec4 vp = viewMatrix * wp; float fl = 1.0; if (aPar.y > 0.0) fl = 0.78 + 0.22 * sin(uTime * aPar.y + aPar.z) * sin(uTime * aPar.y * 2.7 + aPar.z * 3.1);
  float bl = 1.0; if (aBlink.x > 0.0) { float ph = fract((uTime + aBlink.z) / aBlink.x); bl = smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(aBlink.y, aBlink.y + 0.08, ph)); }
  float dist = length(vp.xyz); float sz = aPar.x * (1.0 + dist * 0.006);
  vp.xy += position.xy * sz * 4.0; gl_Position = projectionMatrix * vp; vUv = position.xy; vCol = vec4(aCol.rgb * fl * bl, aCol.a); vWPos = wp.xyz; vMist = aPar.w;
}`;
const GLOW_FS = /* glsl */`
precision highp float; varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos; varying float vMist; ${FOG_GLSL}
void main(){
  float r1 = length(vUv); if (r1 > 1.0) discard; float r = r1 * 4.0; float fg = fogFactor(vWPos);
  float core = exp(-r * r * 4.5) * 3.0, mid = exp(-r * 2.1) * 0.2;
  float star = (pow(max(0.0, 1.0 - abs(vUv.x) * 7.0), 2.0) * pow(1.0 - abs(vUv.y), 3.0) + pow(max(0.0, 1.0 - abs(vUv.y) * 7.0), 2.0) * pow(1.0 - abs(vUv.x), 3.0)) * 0.3;
  float mistK = vMist * mix(0.2, 1.3, fg); float mist = exp(-r * r * 0.24) * 0.11 * mistK;
  float edge = smoothstep(1.0, 0.7, r1);
  float a = (core + mid + star + mist) * edge * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a * (1.0 - fg * 0.5), 0.0);
}`;
export class Glows {
  constructor(max = 512) {
    this.max = max; this.n = 0; this.sizeScale = 1; const g = this.geo = new THREE.InstancedBufferGeometry(); g.instanceCount = 0;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.pos = mk('aPos', 3); this.col = mk('aCol', 4); this.par = mk('aPar', 4); this.blk = mk('aBlink', 4);
    this.mat = new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, uniforms: { uTime: G.uTime, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 19; this._c = new Col();
  }
  /** p [x,y,z] (LOCAL to the mesh's parent: the model matrix is applied), color hex, size = core radius (m), intensity, flicker speed (0 = steady), opts {mist:1, blink:[period,duty,phase]} */
  add(p, color = 0xffd9a0, size = 0.5, intensity = 1, flicker = 0, o = {}) {
    if (this.n >= this.max) return -1; const i = this.n++; const c = this._c.set(color); this.pos.setXYZ(i, p[0], p[1], p[2]); this.col.setXYZW(i, c.r, c.g, c.b, intensity);
    this.par.setXYZW(i, size * this.sizeScale, flicker, Math.random() * 100, o.mist ?? 1); const b = o.blink; this.blk.setXYZW(i, b ? b[0] : 0, b ? b[1] : 0, b ? (b[2] ?? Math.random() * b[0]) : 0, 0);
    this.geo.instanceCount = this.n; this.pos.needsUpdate = this.col.needsUpdate = this.par.needsUpdate = this.blk.needsUpdate = true; return i;
  }
  setPos(i, x, y, z) { this.pos.setXYZ(i, x, y, z); this.pos.needsUpdate = true; }
  setLevel(i, k) { this.col.setW(i, k); this.col.needsUpdate = true; }
  setColor(i, hex, k) { const c = this._c.set(hex); this.col.setXYZW(i, c.r, c.g, c.b, k ?? this.col.getW(i)); this.col.needsUpdate = true; }
}

// ------------------------------------------------------------------------------------------------ Spills: additive soft light pools on ground/walls under lamps (stand-ins for the lamps beyond the 6-light pool; fade out near the camera where the real light works)
const SPILL_VS = /* glsl */`
attribute vec3 aC; attribute vec3 aU; attribute vec3 aV; attribute vec4 aCol; varying vec2 vUv; varying vec4 vCol; varying vec3 vW;
void main(){ vec3 n = normalize(cross(aU, aV)); vec3 wp = (modelMatrix * vec4(aC + aU * position.x + aV * position.y + n * 0.03, 1.0)).xyz; vUv = position.xy; vCol = aCol; vW = wp; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`;
const SPILL_FS = /* glsl */`
precision highp float; varying vec2 vUv; varying vec4 vCol; varying vec3 vW; ${FOG_GLSL}
void main(){ float r2 = dot(vUv, vUv); if (r2 > 1.0) discard; float f = exp(-r2 * 3.4) * (1.0 - r2); float d = length(cameraPosition - vW); float nf = 0.25 + 0.75 * smoothstep(8.0, 30.0, d);
  gl_FragColor = vec4(vCol.rgb * (vCol.a * f * nf * (1.0 - fogFactor(vW) * 0.8)), 0.0); }`;
export class Spills {
  constructor(max = 256) {
    this.max = max; this.n = 0; const g = this.geo = new THREE.InstancedBufferGeometry(); g.instanceCount = 0;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n, sz) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * sz), sz); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.C = mk('aC', 3); this.U = mk('aU', 3); this.V = mk('aV', 3); this.col = mk('aCol', 4);
    this.mat = new THREE.ShaderMaterial({ vertexShader: SPILL_VS, fragmentShader: SPILL_FS, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, uniforms: { uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir, uTime: G.uTime } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 17; this._c = new Col();
  }
  _add(c, u, v, color, k) { if (this.n >= this.max) return -1; const i = this.n++, cc = this._c.set(color); this.C.setXYZ(i, c[0], c[1], c[2]); this.U.setXYZ(i, u[0], u[1], u[2]); this.V.setXYZ(i, v[0], v[1], v[2]); this.col.setXYZW(i, cc.r, cc.g, cc.b, k);
    this.geo.instanceCount = this.n; this.C.needsUpdate = this.U.needsUpdate = this.V.needsUpdate = this.col.needsUpdate = true; return i; }
  /** pool on a horizontal surface at world-local (x,y,z), radius r */
  ground(x, y, z, r, color, k = 0.2) { return this._add([x, y, z], [r, 0, 0], [0, 0, -r], color, k); }
  /** wash on a vertical surface facing horizontal normal (nx,nz): centre (x,y,z), radius r (elliptical: rh wide, rv tall) */
  wall(x, y, z, nx, nz, rh, rv, color, k = 0.2) { return this._add([x, y, z], [nz * rh, 0, -nx * rh], [0, rv, 0], color, k); }
}

// ------------------------------------------------------------------------------------------------ Soft beam: camera-facing ribbon along an axis with a gaussian cross-section (no hard edges, no cone artefacts)
const SBEAM_VS = /* glsl */`
attribute float aSide; attribute float aS; uniform float uL, uW0, uW1; varying float vSide; varying float vS; varying vec3 vW;
void main(){
  float z = aS * uL; vec3 ap = (modelMatrix * vec4(0.0, 0.0, z, 1.0)).xyz; vec3 dir = normalize((modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  vec3 sd = cross(dir, cameraPosition - ap); float l = length(sd); sd = l > 1e-4 ? sd / l : vec3(1.0, 0.0, 0.0);
  vec3 wp = ap + sd * aSide * mix(uW0, uW1, aS); vSide = aSide; vS = aS; vW = wp; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const SBEAM_FS = /* glsl */`
precision highp float; varying float vSide; varying float vS; varying vec3 vW; uniform vec3 uColor; uniform float uIntensity, uFall, uNear, uL, uDust, uTime, uProf; ${FOG_GLSL}${NOISE_GLSL}
void main(){
  float prof = exp(-vSide * vSide * uProf) * (1.0 - smoothstep(0.75, 1.0, abs(vSide)));
  float along = smoothstep(0.0, 0.035, vS) * exp(-vS * uL * uFall);
  float d = length(cameraPosition - vW); float nearF = smoothstep(uNear, uNear * 3.0, d);
  float dust = 0.62 + 0.75 * zfbm3(vW * 0.22 + vec3(0.0, uTime * 0.18, uTime * 0.05)) * uDust;
  float a = prof * along * nearF * dust * uIntensity;
  vec3 c = uColor * a * (1.0 - fogFactor(vW) * 0.8);
  if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)) c = vec3(0.0);
  gl_FragColor = vec4(min(c, vec3(4.0)), 0.0);
}`;
/** Beam apex at the local origin along +Z. w0/w1 = half-width (m) of the visible shaft at apex / far end (the gaussian sigma is ~w/2.3). Returns a mesh; set mesh.material.uniforms.{uIntensity,uNear}. */
export function makeSoftBeam({ length = 300, w0 = 0.3, w1 = 12, color = 0xfff0c8, intensity = 0.5, seg = 32, fall = 0.0014, dust = 0.6, near = 12, prof = 5.2 } = {}) {
  const pos = [], side = [], ss = [], idx = [];
  for (let i = 0; i <= seg; i++) { const t = i / seg, u = t * t * 0.5 + t * 0.5; for (const sd of [-1, 1]) { pos.push(0, 0, u * length); side.push(sd); ss.push(u); } }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1)); g.setAttribute('aS', new THREE.Float32BufferAttribute(ss, 1)); g.setIndex(idx);
  const m = new THREE.ShaderMaterial({ vertexShader: SBEAM_VS, fragmentShader: SBEAM_FS, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { uColor: { value: new Col(color) }, uIntensity: { value: intensity }, uFall: { value: fall }, uNear: { value: near }, uL: { value: length }, uW0: { value: w0 }, uW1: { value: w1 }, uDust: { value: dust }, uProf: { value: prof }, uTime: G.uTime, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir, uNoise3: G.uNoise3 } });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 18; return mesh;
}

// ------------------------------------------------------------------------------------------------ Foam ribbons lying on the wave surface
const FOAM_VS = (NW) => /* glsl */`
#define NW ${NW}
uniform vec4 uWaveA[NW]; uniform vec4 uWaveB[NW]; uniform float uWaveAmp; uniform vec3 uCenter; uniform float uLevel; uniform float uLift; uniform float uTime;
attribute vec4 aFoam; varying vec4 vF; varying vec3 vWP;
float surfH(vec2 xz){
  vec2 b = xz;
  for (int it = 0; it < 3; it++) { float dist = length(b - uCenter.xz); vec2 dp = vec2(0.0);
    for (int i = 0; i < NW; i++) { vec4 A = uWaveA[i], B = uWaveB[i]; float k = A.z; float lf = 1.0 - smoothstep(25.0, 80.0, k * dist); float S = min(B.y * uWaveAmp, 0.92) * lf; float ph = k * dot(A.xy, b) - A.w * uTime + B.z; dp += A.xy * (S / (k * float(NW))) * cos(ph); }
    b = xz - dp; }
  float dist = length(b - uCenter.xz); float y = 0.0;
  for (int i = 0; i < NW; i++) { vec4 A = uWaveA[i], B = uWaveB[i]; float k = A.z; float lf = 1.0 - smoothstep(25.0, 80.0, k * dist); float ph = k * dot(A.xy, b) - A.w * uTime + B.z; y += B.x * uWaveAmp * lf * sin(ph); }
  return y * (1.0 - smoothstep(180.0, 700.0, dist)) + uLevel;
}
void main(){ vec3 w0 = (modelMatrix * vec4(position, 1.0)).xyz; vec2 xz = w0.xz; float h = surfH(xz); vec3 wp = vec3(xz.x, h + uLift, xz.y); vWP = wp; vF = aFoam; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`;
const FOAM_FS = /* glsl */`
precision highp float; varying vec4 vF; varying vec3 vWP; uniform float uTime; uniform vec3 uTint; uniform float uLampGain;
uniform vec4 uLampP[NLAMP]; uniform vec4 uLampC[NLAMP];
${FOG_GLSL}${NOISE_GLSL}
void main(){
  float u = vF.x, v = vF.y, alpha = vF.z, seed = abs(vF.w);
  float edge = (vF.w < 0.0 ? 1.0 : smoothstep(0.0, 0.14, v)) * (1.0 - smoothstep(0.45, 1.0, v));
  float n = zfbm3(vec3(u * 0.85, v * 3.0, uTime * 0.32 + seed * 7.0)), n2 = zvn3(vec3(u * 3.3, v * 8.0, uTime * 0.7 + seed));
  float lap = 0.5 + 0.5 * sin(uTime * 1.05 + u * 0.33 + seed * 9.0);
  float f = smoothstep(0.34, 0.78, n * 0.85 + n2 * 0.35) * edge * mix(0.45, 1.0, lap) * alpha;
  if (f < 0.01) discard;
  vec3 col = uTint * (0.72 + 0.55 * n2) * 0.5;
  for (int i = 0; i < NLAMP; i++) { vec4 c = uLampC[i]; if (c.a < 0.01) continue; vec3 L = uLampP[i].xyz - vWP; float d2 = dot(L, L); col += c.rgb * c.a * 0.11 / (1.0 + d2 * 0.05); }
  float fg = fogFactor(vWP); col = mix(col, fogColorDir(normalize(vWP - cameraPosition)), fg);
  gl_FragColor = vec4(col, f * (1.0 - fg * 0.45));
}`;
export function makeFoamMaterial(water, foamTint) {
  const NW = water._k.length; const u = water.uniforms;
  const m = new THREE.ShaderMaterial({ vertexShader: FOAM_VS(NW), fragmentShader: `#define NLAMP ${LAMP_N}\n` + FOAM_FS, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    uniforms: { uWaveA: u.uWaveA, uWaveB: u.uWaveB, uWaveAmp: u.uWaveAmp, uCenter: u.uCenter, uLevel: u.uLevel, uLift: { value: 0.045 }, uTime: G.uTime, uTint: foamTint, uLampGain: { value: 1 }, uLampP: lampU.P, uLampC: lampU.C, uNoise3: G.uNoise3, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir } });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; return m;
}
let _foamMat = null;
export const foamMaterial = () => { const sea = getSea(); return _foamMat || (_foamMat = makeFoamMaterial(sea.water, sea.foamTint)); };

/** Static foam ribbons: strips along polylines. strip = {pts:[[x,z]...], width, alpha, side:+1|-1 (which side of the polyline the foam spreads), seed}. Coordinates are LOCAL to the parent group of the returned mesh. */
export function buildFoamStrips(strips) {
  const P = [], F = [], I = []; let base = 0;
  for (const s of strips) {
    const pts = s.pts, n = pts.length; let u = 0; const side = s.side ?? 1;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; const nx = -tz * side, nz = tx * side;
      if (i > 0) u += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      P.push(pts[i][0], 0, pts[i][1], pts[i][0] + nx * s.width, 0, pts[i][1] + nz * s.width); F.push(u, 0, s.alpha ?? 1, s.seed ?? 0, u, 1, s.alpha ?? 1, s.seed ?? 0);
      if (i < n - 1) { const k = base + i * 2; I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    base += n * 2;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aFoam', new THREE.Float32BufferAttribute(F, 4)); g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); const m = new THREE.Mesh(g, foamMaterial()); m.frustumCulled = false; m.renderOrder = 2; return m;
}
/** Ring foam (piles, buoys, rocks): closed circle of radius r around (x,z) */
export function ringStrip(x, z, r, width, alpha = 1, seed = 0, n = 14) { const pts = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } return { pts, width, alpha, side: -1, seed }; }

/** Dynamic ribbon: 2 vertices per sample; positions in WORLD xz (y comes from the wave function in the shader). */
export class DynRibbon {
  constructor(maxSamples = 64) {
    this.max = maxSamples; this.n = 0; const g = this.geo = new THREE.BufferGeometry(); this.pos = new THREE.BufferAttribute(new Float32Array(maxSamples * 6), 3); this.fo = new THREE.BufferAttribute(new Float32Array(maxSamples * 8), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage); this.fo.setUsage(THREE.DynamicDrawUsage); g.setAttribute('position', this.pos); g.setAttribute('aFoam', this.fo);
    const I = []; for (let i = 0; i < maxSamples - 1; i++) { const k = i * 2; I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } g.setIndex(I); g.setDrawRange(0, 0); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.Mesh(g, foamMaterial()); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
  }
  /** i: sample index; inner (x0,z0) at v=0, outer (x1,z1) at v=1; u = distance along; a0/a1 alpha at inner/outer */
  set(i, x0, z0, x1, z1, u, a0, a1, seed = 0) {
    const p = this.pos.array, f = this.fo.array, k = i * 6, q = i * 8; p[k] = x0; p[k + 1] = 0; p[k + 2] = z0; p[k + 3] = x1; p[k + 4] = 0; p[k + 5] = z1;
    f[q] = u; f[q + 1] = 0; f[q + 2] = a0; f[q + 3] = seed; f[q + 4] = u; f[q + 5] = 1; f[q + 6] = a1; f[q + 7] = seed;
  }
  finish(n) { this.n = n; this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6)); this.pos.needsUpdate = true; this.fo.needsUpdate = true; }
}
