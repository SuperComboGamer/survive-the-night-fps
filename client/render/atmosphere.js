// Ambient atmosphere around the camera: low drifting ground-mist banks (big soft sprites that wrap
// around the player) and dust motes that only glint when caught in the flashlight beam.
import * as THREE from 'three';

const MIST_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform float uRange;
varying float vAlpha;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  // drift + wrap around the camera so the mist field is infinite
  p.x += uTime * (0.35 + aSeed * 0.3);
  p.z += uTime * (0.18 - aSeed * 0.25);
  vec2 rel = p.xz - uCam.xz;
  rel = mod(rel + uRange, uRange * 2.0) - uRange;
  p.xz = uCam.xz + rel;
  float d = length(rel);
  vAlpha = smoothstep(uRange, uRange * 0.55, d) * smoothstep(2.0, 9.0, d);
  vSeed = aSeed;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (900.0 + aSeed * 900.0) / max(1.0, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const MIST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uDensity;
varying float vAlpha;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  a *= a * vAlpha * uDensity * (0.6 + vSeed * 0.4);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
}`;

const DUST_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uFwd;
uniform float uLight;
varying float vA;
void main() {
  vec3 p = position;
  p += vec3(sin(uTime * 0.3 + aSeed * 40.0), sin(uTime * 0.21 + aSeed * 17.0) * 0.6, cos(uTime * 0.27 + aSeed * 23.0)) * 0.5;
  vec3 rel = p - uCam;
  rel = mod(rel + 6.0, 12.0) - 6.0;
  p = uCam + rel;
  vec3 dir = normalize(rel);
  float inBeam = smoothstep(0.86, 0.97, dot(dir, uFwd));
  float d = length(rel);
  vA = inBeam * uLight * smoothstep(7.0, 2.0, d) * smoothstep(0.4, 1.2, d) * (0.5 + 0.5 * sin(uTime * 2.0 + aSeed * 50.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(9.0 / max(0.3, -mv.z), 1.0, 4.0);
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = /* glsl */ `
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, r) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a * 0.8, a);
}`;

export class Atmosphere {
  constructor(scene) {
    const N = 90;
    const range = 70;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * range;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * range;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.mistBase = pos.slice();
    this.mistGeo = geo;
    this.mistMat = new THREE.ShaderMaterial({
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uRange: { value: range }, uColor: { value: new THREE.Color(0x888888) }, uDensity: { value: 0.12 } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mist = new THREE.Points(geo, this.mistMat);
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 3;
    scene.add(this.mist);

    const DN = 260;
    const dpos = new Float32Array(DN * 3);
    const dseed = new Float32Array(DN);
    for (let i = 0; i < DN; i++) {
      dpos[i * 3] = (Math.random() * 2 - 1) * 6;
      dpos[i * 3 + 1] = (Math.random() * 2 - 1) * 6;
      dpos[i * 3 + 2] = (Math.random() * 2 - 1) * 6;
      dseed[i] = Math.random();
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    dgeo.setAttribute('aSeed', new THREE.BufferAttribute(dseed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3(0, 0, -1) }, uLight: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dgeo, this.dustMat);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this._fwd = new THREE.Vector3();
  }

  // heightAt: world terrain function (mist hugs the ground)
  update(time, camera, fogColor, night, flashlightOn, heightAt) {
    const u = this.mistMat.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    u.uColor.value.copy(fogColor).multiplyScalar(1.25 + night * 0.4);
    u.uDensity.value = 0.07 + night * 0.12;
    // keep mist sprites hugging the terrain (update a few per frame)
    const pos = this.mistGeo.attributes.position;
    const base = this.mistBase;
    const n = pos.count;
    const start = (this._k = ((this._k || 0) + 9) % n);
    for (let j = 0; j < 9; j++) {
      const i = (start + j) % n;
      // approximate world position of this sprite this frame (same wrap as the shader)
      const range = u.uRange.value;
      const s = this.mistGeo.attributes.aSeed.array[i];
      let x = base[i * 3] + time * (0.35 + s * 0.3);
      let z = base[i * 3 + 2] + time * (0.18 - s * 0.25);
      let rx = ((((x - camera.position.x + range) % (range * 2)) + range * 2) % (range * 2)) - range;
      let rz = ((((z - camera.position.z + range) % (range * 2)) + range * 2) % (range * 2)) - range;
      x = camera.position.x + rx;
      z = camera.position.z + rz;
      pos.array[i * 3 + 1] = heightAt(x, z) + 0.6 + s * 1.2;
    }
    pos.needsUpdate = true;
    const d = this.dustMat.uniforms;
    d.uTime.value = time;
    d.uCam.value.copy(camera.position);
    camera.getWorldDirection(this._fwd);
    d.uFwd.value.copy(this._fwd);
    d.uLight.value += ((flashlightOn ? 0.9 : 0) - d.uLight.value) * 0.15;
  }
}
