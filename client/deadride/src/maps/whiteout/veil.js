// Ground blizzard: stacked horizontal sheets of wind-driven snow that follow the camera (one draw call).
// Streaky fbm noise is looked up in WORLD space along the wind, so the sheets race across the ground at wind speed while the quads themselves
// just re-centre on the camera. Nearby lamps (the pooled lights) light the streaks, so a lamp post throws a bright rag of blowing snow.
import * as THREE from 'three';
import { G, FOG_GLSL, NOISE_GLSL } from '../../core/mats.js';
import { damp } from '../../core/util.js';

const VS = /* glsl */`
attribute float aLayer; uniform vec3 uCam; uniform float uGround; uniform float uRadius;
varying vec3 vWPos; varying float vL;
void main(){
  vec3 wp = vec3(uCam.x + position.x * uRadius, uGround + position.y, uCam.z + position.z * uRadius);
  vWPos = wp; vL = aLayer; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const FS = /* glsl */`
precision highp float; varying vec3 vWPos; varying float vL;
uniform float uTime; uniform vec2 uWindDir; uniform float uWindSpd; uniform float uAlpha; uniform vec3 uColor; uniform float uRadius; uniform vec3 uCam; uniform float uCoverage; uniform float uStreak;
uniform vec4 uLP[4]; uniform vec3 uLC[4];
${FOG_GLSL}
${NOISE_GLSL}
void main(){
  vec2 xz = vWPos.xz; float d = length(vWPos - uCam);                                                        // 3D distance: sheets far below/above the camera vanish
  float above = vWPos.y - uCam.y;                                                                             // sheets well above the eye would read as speed lines
  float fade = smoothstep(uRadius, uRadius * 0.35, d) * smoothstep(2.0, 7.0, d) * smoothstep(0.7, -0.4, above);         // nothing right around the camera: no smear on the ground under the player
  float lay = pow(1.0 - vL, 2.0);
  float a0 = uAlpha * fade * lay; if (a0 < 0.004) discard;
  vec2 w = uWindDir; vec2 pp = vec2(-w.y, w.x);
  float along = dot(xz, w), across = dot(xz, pp);
  float t = uTime * uWindSpd * (1.0 - 0.45 * vL);                                     // low sheets race hardest
  float g = zfbm3(vec3((along - t * 0.55) * 0.05, across * 0.13, 1.7 + vL * 6.0));  // gust cells: slow, long, along the wind
  float s1 = zvn3(vec3((along - t) * 0.10 * uStreak, across * 0.5, vL * 7.3 + 3.1));                       // ribbons ~2 m wide and ~10 m long (real spindrift), not hair-thin lines
  float s2 = zvn3(vec3((along - t * 1.7) * 0.17 * uStreak, across * 1.1, vL * 3.7 + 9.7));
  float streaks = smoothstep(0.42, 0.8, 0.6 * s1 + 0.4 * s2);
  float grain = zvn3(vec3(along * 1.7 - t * 2.3, across * 3.2, vL * 11.0 + uTime * 0.6));                 // flake-scale grain inside the ribbons
  float dens = smoothstep(uCoverage, uCoverage + 0.34, g) * (0.3 + 0.7 * streaks) * (0.45 + 0.75 * smoothstep(0.3, 0.75, grain));
  float a = a0 * dens; if (a < 0.003) discard;
  vec3 lit = vec3(0.0);
  for (int i = 0; i < 4; i++) { vec3 L = uLP[i].xyz - vWPos; float d2 = dot(L, L); lit += uLC[i] * (uLP[i].w * 0.05 / (d2 * 0.5 + 4.0)); }
  vec3 rd = normalize(vWPos - cameraPosition);
  vec3 col = uColor * (0.3 + lit); float ff = fogFactor(vWPos);
  gl_FragColor = vec4(mix(col, fogColorDir(rd), ff * 0.6), a);
}`;

export class WindVeil {
  /** o: {heights[], radius, color[3], alpha, wind:[x,z] (m/s), coverage 0..0.6 (higher = sparser), streak (along-wind stretch)} */
  constructor(gfx, o = {}) {
    const c = this.cfg = Object.assign({ heights: [0.35, 0.7, 1.15, 1.7, 2.4, 3.3], radius: 46, color: [0.86, 0.92, 1], alpha: 0.5, wind: [3, 8], coverage: 0.3, streak: 1 }, o);
    this.gfx = gfx; const n = c.heights.length, pos = new Float32Array(n * 12), lay = new Float32Array(n * 4), idx = [];
    const hmax = c.heights[n - 1] * 1.25;
    c.heights.forEach((h, i) => {                     // ordered top -> bottom (back-to-front for a camera standing above the sheets)
      const k = n - 1 - i, hh = c.heights[k]; const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      q.forEach(([x, z], j) => { pos.set([x, hh, z], i * 12 + j * 3); lay[i * 4 + j] = hh / hmax; });
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aLayer', new THREE.BufferAttribute(lay, 1)); g.setIndex(idx);
    const wl = Math.hypot(c.wind[0], c.wind[1]) || 1;
    this.u = {
      uTime: G.uTime, uCam: { value: new THREE.Vector3() }, uGround: { value: 0 }, uRadius: { value: c.radius }, uWindDir: { value: new THREE.Vector2(c.wind[0] / wl, c.wind[1] / wl) }, uWindSpd: { value: wl }, uAlpha: { value: 0 },
      uColor: { value: new THREE.Color(...c.color) }, uCoverage: { value: c.coverage }, uStreak: { value: c.streak }, uLP: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uLC: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
      uFogColor: G.uFogColor, uFogScatter: G.uFogScatter, uFogParams: G.uFogParams, uSunDir: G.uSunDir, uNoise3: G.uNoise3,
    };
    const m = this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.u, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.blending = THREE.CustomBlending; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 14; this.mesh.name = 'wind-veil'; this.ground = null; this.lightGain = 1;
  }
  /** camPos: world camera; groundY: world ground height under the camera; k: 0..1 intensity multiplier (gusts, stop crossfade) */
  update(dt, camPos, groundY, k) {
    const u = this.u; u.uCam.value.copy(camPos); this.ground = this.ground === null ? groundY : damp(this.ground, groundY, 3, dt); u.uGround.value = this.ground;
    const hf = 1 - Math.min(1, Math.max(0, (camPos.y - groundY - 2.4) / 3.2)); u.uAlpha.value = this.cfg.alpha * k * hf; this.mesh.visible = k * hf > 0.01;
    // the four most influential pooled point lights
    const best = [[0, -1], [0, -1], [0, -1], [0, -1]]; const pl = this.gfx.pool.points;
    for (const l of pl) {
      if (l.intensity < 0.01) continue; const dx = l.position.x - camPos.x, dy = l.position.y - camPos.y, dz = l.position.z - camPos.z; const s = l.intensity / (dx * dx + dy * dy + dz * dz + 4);
      let w = 3; while (w >= 0 && best[w][1] < s) w--; if (w < 3) { best.splice(w + 1, 0, [l, s]); best.length = 4; }
    }
    for (let i = 0; i < 4; i++) { const l = best[i][0]; if (!l) { u.uLC.value[i].set(0, 0, 0); u.uLP.value[i].set(0, -999, 0, 0); continue; } u.uLP.value[i].set(l.position.x, l.position.y, l.position.z, l.intensity * this.lightGain); u.uLC.value[i].set(l.color.r, l.color.g, l.color.b); }
  }
}
