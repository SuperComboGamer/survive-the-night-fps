// Visible light: volumetric beams (cones), instanced halos (lamp glare), lens streak sprites. All additive, fog-aware.
import * as THREE from 'three';
import { G, FOG_GLSL, NOISE_GLSL } from './mats.js';

// ------------------------------------------------------------ volumetric beam (cone/cylinder along +Z from the apex)
const BEAM_VS = /* glsl */`
varying vec3 vWPos; varying vec3 vWN; varying float vAlong; uniform float uLen;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWPos = wp.xyz; vWN = normalize(mat3(modelMatrix) * normal); vAlong = clamp(position.z / uLen, 0.0, 1.0); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const BEAM_FS = /* glsl */`
precision highp float; varying vec3 vWPos; varying vec3 vWN; varying float vAlong;
uniform sampler2D uExpoTex; uniform vec3 uColor; uniform float uIntensity; uniform float uTime; uniform float uFlick; uniform float uDust; uniform float uNear; uniform float uFar;
${FOG_GLSL}${NOISE_GLSL}
void main(){
  vec3 dv = cameraPosition - vWPos; float d = max(length(dv), 1e-3); vec3 V = dv / d;
  float nl = dot(vWN, vWN); vec3 N = nl > 1e-8 ? vWN * inversesqrt(nl) : vec3(0.0, 1.0, 0.0);
  float ndv = clamp(abs(dot(N, V)), 1e-4, 1.0);
  float body = ndv * ndv * sqrt(ndv) * 1.0;
  float dust = 0.65 + 0.7 * zfbm3(vWPos * 0.9 + vec3(0.0, uTime * 0.15, uTime * 0.05)) * uDust;
  float al = clamp(1.0 - vAlong, 1e-4, 1.0); float fadeAlong = al * sqrt(al) * smoothstep(0.0, 0.04, vAlong);
  float near = smoothstep(uNear, uNear * 3.0, d) * (1.0 - smoothstep(uFar * 0.6, uFar, d));
  float a = body * fadeAlong * dust * near * uIntensity * uFlick / max(1.0, texture2D(uExpoTex, vec2(0.5)).r);
  vec3 c = uColor * a * (1.0 - fogFactor(vWPos) * 0.85);
  if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)) c = vec3(0.0);
  gl_FragColor = vec4(min(c, vec3(8.0)), 0.0);
}`;
const _beamMats = new Map();
/** Beam mesh: apex at local origin, opens along +Z. length m, radius at far end r1, near radius r0 (default small). */
export function makeBeam({ length = 12, r0 = 0.04, r1 = 1.6, color = 0xfff2d0, intensity = 0.5, dust = 1, seg = 20, near = 0.6 } = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, length, seg, 6, true); g.rotateX(Math.PI / 2); g.translate(0, 0, length / 2);
  const m = new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { uExpoTex: G.uExpoTex, uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uTime: G.uTime, uFlick: { value: 1 }, uDust: { value: dust }, uLen: { value: length }, uNear: { value: near }, uFar: { value: length * 2.5 }, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir, uNoise3: G.uNoise3 } });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 18; mesh.userData.beam = true;
  mesh.setLength = (L) => { mesh.scale.z = L / length; m.uniforms.uLen.value = length; };
  return mesh;
}

// ------------------------------------------------------------ halo batch (many lamp glares, one draw call)
const HALO_VS = /* glsl */`
attribute vec3 aPos; attribute vec4 aCol; attribute vec3 aPar; // aPar: size, flicker speed, phase
uniform float uTime; varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos;
void main(){
  vec4 vp = viewMatrix * vec4(aPos, 1.0); float fl = 1.0; if (aPar.y > 0.0) fl = 0.72 + 0.28 * sin(uTime * aPar.y + aPar.z) * sin(uTime * aPar.y * 2.7 + aPar.z * 3.1);
  float dist = length(vp.xyz); float sz = aPar.x * (1.0 + dist * 0.012);
  vp.xy += position.xy * sz; gl_Position = projectionMatrix * vp; vUv = position.xy; vCol = vec4(aCol.rgb * fl, aCol.a); vWPos = aPos;
}`;
const HALO_FS = /* glsl */`
precision highp float; varying vec2 vUv; varying vec4 vCol; varying vec3 vWPos; uniform sampler2D uExpoTex; ${FOG_GLSL}
void main(){ float r = length(vUv); if (r > 1.0) discard; float core = exp(-r * r * 16.0), glow = pow(1.0 - r, 3.0) * 0.5, star = pow(max(0.0, 1.0 - abs(vUv.x) * 9.0), 2.0) * pow(1.0 - abs(vUv.y), 3.0) * 0.25 + pow(max(0.0, 1.0 - abs(vUv.y) * 9.0), 2.0) * pow(1.0 - abs(vUv.x), 3.0) * 0.25;
  float a = (core * 3.0 + glow + star) * vCol.a / max(1.0, texture2D(uExpoTex, vec2(0.5)).r); gl_FragColor = vec4(vCol.rgb * a * (1.0 - fogFactor(vWPos) * 0.9), 0.0); }`;
export class HaloBatch {
  constructor(max = 256) {
    this.max = max; this.n = 0; const g = new THREE.InstancedBufferGeometry(); g.instanceCount = 0;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.par = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    g.setAttribute('aPos', this.pos); g.setAttribute('aCol', this.col); g.setAttribute('aPar', this.par); this.geo = g;
    this.mat = new THREE.ShaderMaterial({ vertexShader: HALO_VS, fragmentShader: HALO_FS, transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, uniforms: { uExpoTex: G.uExpoTex, uTime: G.uTime, uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 19;
  }
  /** position (local to the mesh's parent), colour, size (m radius), intensity, flicker speed (0=steady) */
  add(p, color = 0xffd9a0, size = 0.6, intensity = 1, flicker = 0) {
    const i = this.n++; const c = new THREE.Color(color); this.pos.setXYZ(i, p[0], p[1], p[2]); this.col.setXYZW(i, c.r, c.g, c.b, intensity); this.par.setXYZ(i, size, flicker, Math.random() * 100);
    this.geo.instanceCount = this.n; this.pos.needsUpdate = this.col.needsUpdate = this.par.needsUpdate = true; return i;
  }
  set(i, color, intensity) { const c = new THREE.Color(color); this.col.setXYZW(i, c.r, c.g, c.b, intensity); this.col.needsUpdate = true; }
}
