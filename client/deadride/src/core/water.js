// Gerstner-wave water: same wave function on GPU (rendering) and CPU (buoyancy physics / splashes). PBR lit (sun/moon, lamps) + IBL reflection.
import * as THREE from 'three';
import { std, G, NOISE_GLSL } from './mats.js';

const GRAV = 9.81;
/** waves: [{dir:[x,z], len (m), amp (m), steep 0..1}] */
export class Water {
  constructor({ size = 900, waves, color = 0x0a1a24, deep = 0x02080c, roughness = 0.12, rings = 90, segs = 160, level = 0, foam = 0.5, clarity = 0.35, ripple = 1 } = {}) {
    this.waves = waves; this.level = level; this.time = 0; this.amp = 1; this._k = waves.map((w) => { const d = new THREE.Vector2(...w.dir).normalize(); const k = 2 * Math.PI / w.len; return { dx: d.x, dz: d.y, k, w: Math.sqrt(GRAV * k), amp: w.amp, steep: w.steep ?? 0.6, ph: w.phase ?? 0 }; });
    // radial mesh: dense near the centre, sparse far. Centre follows the camera in grid-snapped steps.
    const pos = [], idx = []; const R0 = 2.0;
    for (let r = 0; r <= rings; r++) {
      const rr = r === 0 ? 0 : R0 * Math.pow(size / R0, r / rings);
      for (let s = 0; s < segs; s++) { const a = s / segs * Math.PI * 2; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); }
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) { const a = r * segs + s, b = r * segs + (s + 1) % segs, c = (r + 1) * segs + s, d = (r + 1) * segs + (s + 1) % segs; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size * 2);
    this.uniforms = { uWaveA: { value: this._k.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.w)) }, uWaveB: { value: this._k.map((w) => new THREE.Vector4(w.amp, w.steep, w.ph, 0)) }, uWaveAmp: { value: 1 }, uCenter: { value: new THREE.Vector3() }, uDeep: { value: new THREE.Color(deep) }, uShallow: { value: new THREE.Color(color) }, uFoam: { value: foam }, uClarity: { value: clarity }, uRipple: { value: ripple }, uLevel: { value: level } };
    const NW = waves.length;
    const m = std({ color: 0xffffff, roughness, metalness: 0.0, envMapIntensity: 1.2, key: 'water' + NW, fog: true });
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (shader) => {
      base(shader); Object.assign(shader.uniforms, this.uniforms, { uReflTex: G.uReflTex, uReflVP: G.uReflVP, uReflOn: G.uReflOn });
      const decl = `#define NW ${NW}
uniform vec4 uWaveA[NW]; uniform vec4 uWaveB[NW]; uniform float uWaveAmp; uniform vec3 uCenter; uniform float uLevel; uniform float uFoam;
varying vec3 vWaveN; varying float vFoam; varying float vHgt;
vec3 gerstner(vec2 xz, float dist, out vec3 nrm, out float foam){
  vec3 dP = vec3(0.0); float nx = 0.0, nz = 0.0, ny = 0.0; foam = 0.0;
  for (int i = 0; i < NW; i++) {
    vec4 A = uWaveA[i], B = uWaveB[i]; float k = A.z; float lf = 1.0 - smoothstep(25.0, 80.0, k * dist);
    float amp = B.x * uWaveAmp * lf; float S = min(B.y * uWaveAmp, 0.92) * lf;
    float ph = k * dot(A.xy, xz) - A.w * uTime + B.z; float c = cos(ph), s = sin(ph);
    dP.x += A.x * (S / (k * float(NW))) * c; dP.z += A.y * (S / (k * float(NW))) * c; dP.y += amp * s;
    nx += A.x * k * amp * c; nz += A.y * k * amp * c; ny += S / float(NW) * s * 1.0; foam += max(0.0, s - 0.62) * S;
  }
  nrm = normalize(vec3(-nx, max(0.25, 1.0 - ny), -nz)); return vec3(xz.x, 0.0, xz.y) + dP;
}`;
      shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\n' + decl)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec2 base = position.xz + uCenter.xz; float dc = length(position.xz); vec3 gn; float gf; vec3 gp = gerstner(base, dc, gn, gf);
          float fadeFar = 1.0 - smoothstep(180.0, 700.0, dc); gp.y *= fadeFar; gn = normalize(mix(vec3(0.0, 1.0, 0.0), gn, fadeFar));
          transformed = vec3(gp.x - uCenter.x, gp.y + uLevel, gp.z - uCenter.z); vWaveN = gn; vFoam = clamp(gf * uFoam * 2.2, 0.0, 1.0); vHgt = gp.y;`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = vec3(0.0, 1.0, 0.0);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uReflTex; uniform mat4 uReflVP; uniform float uReflOn; vec3 zWN = vec3(0.0, 1.0, 0.0);\nvarying vec3 vWaveN; varying float vFoam; varying float vHgt;\nuniform vec3 uDeep; uniform vec3 uShallow; uniform float uFoam; uniform float uClarity; uniform float uRipple;\n' + '')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float hf = clamp(vHgt * 0.35 + 0.5, 0.0, 1.0); diffuseColor.rgb = mix(uDeep, uShallow, hf * uClarity * 2.0);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { vec3 wp = vWPos; float t = uTime;
            vec2 q1 = wp.xz * 0.55 + vec2(t * 0.32, t * 0.21), q2 = wp.xz * 1.3 + vec2(-t * 0.4, t * 0.33), q3 = wp.xz * 3.7 + vec2(t * 0.9, -t * 0.7);
            float e = 0.12; float n0 = zfbm3(vec3(q1, 0.0)); vec2 g1 = vec2(zfbm3(vec3(q1 + vec2(e, 0.0), 0.0)) - n0, zfbm3(vec3(q1 + vec2(0.0, e), 0.0)) - n0) / e;
            float n1 = zvn3(vec3(q2, t * 0.2)); vec2 g2 = vec2(zvn3(vec3(q2 + vec2(e, 0.0), t * 0.2)) - n1, zvn3(vec3(q2 + vec2(0.0, e), t * 0.2)) - n1) / e;
            float n2 = zvn3(vec3(q3, t * 0.5)); vec2 g3 = vec2(zvn3(vec3(q3 + vec2(e, 0.0), t * 0.5)) - n2, zvn3(vec3(q3 + vec2(0.0, e), t * 0.5)) - n2) / e;
            float dist = length(wp - cameraPosition); float lodK = 1.0 / (1.0 + dist * 0.03);
            vec3 wn = normalize(vWaveN + vec3(g1.x * 0.25 + g2.x * 0.16 * lodK + g3.x * 0.08 * lodK, 0.0, g1.y * 0.25 + g2.y * 0.16 * lodK + g3.y * 0.08 * lodK) * uRipple);
            zWN = wn; normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { float fo = smoothstep(0.35, 0.9, vFoam) * (0.5 + 0.5 * zvn3(vWPos * 2.3 + vec3(0.0, uTime * 0.5, 0.0))); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.8, 0.82), fo * 0.8); roughnessFactor = mix(roughnessFactor, 0.85, fo); }`)
        .replace('#include <opaque_fragment>', `
          if (uReflOn > 0.5) { // planar reflection: last frame's mirrored scene (gfx.js splat pass), reprojected with that frame's matrices
            vec3 Vw = normalize(cameraPosition - vWPos); float cosT = clamp(dot(Vw, zWN), 0.0, 1.0); float Fr = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
            vec4 pv = uReflVP * vec4(vWPos, 1.0); vec2 ruv = pv.xy / pv.w * 0.5 + 0.5;
            float dist = length(cameraPosition - vWPos); vec2 wob = zWN.xz * (0.10 / (1.0 + dist * 0.02));
            float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uTime * 7.0);
            vec3 racc = vec3(0.0); float rcov = 0.0;
            for (int i = 0; i < 6; i++) { // smear along the vertical: rippled water turns point lights into streaks
              float fi = (float(i) + jit) / 6.0; vec2 ouv = ruv + wob + vec2((jit - 0.5) * 0.004, (fi - 0.3) * (0.006 + 0.03 * roughnessFactor) * (1.0 + 4.0 * length(wob)));
              vec4 rs = texture2D(uReflTex, clamp(ouv, vec2(0.002), vec2(0.998))); racc += rs.rgb; rcov += rs.a;
            }
            rcov /= 6.0; vec3 rcol = racc / max(rcov * 6.0, 1e-3);
            float edge = smoothstep(0.0, 0.06, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));
            outgoingLight = mix(outgoingLight, rcol, clamp(Fr * rcov * edge * 1.15, 0.0, 0.97));
          }
          #include <opaque_fragment>`)
        .replace('gl_FragColor.a *= (1.0 - uVM);', 'gl_FragColor.a = 0.95 * (1.0 - uVM); /* alpha code 0.95 = water surface (excluded from the reflection splat) */');
      // the water mesh has no cameraPosition-based world position uniform for vWPos in vertex: patch() computed it from mvPosition (already displaced) — good.
    };
    m.customProgramCacheKey = () => 'water' + NW; m.side = THREE.FrontSide;
    this.mat = m; this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 0;
    this.mesh.onBeforeRender = () => { G.reflReq = true; G.reflLevel = this.level; };
  }
  /** call every frame: centre follows the camera, snapped to keep the mesh stable */
  update(time, camPos, amp = this.amp) { this.time = time; this.amp = amp; this.uniforms.uWaveAmp.value = amp; const s = 1.0; this.uniforms.uCenter.value.set(Math.round(camPos.x / s) * s, 0, Math.round(camPos.z / s) * s); this.mesh.position.set(this.uniforms.uCenter.value.x, 0, this.uniforms.uCenter.value.z); }
  /** CPU wave height at world x,z (same function as the shader) */
  height(x, z, t = this.time, out = null) {
    const n = this._k.length, A = this.amp; let px = x, pz = z;
    for (let it = 0; it < 3; it++) { let dx = 0, dz = 0; for (const w of this._k) { const S = Math.min(w.steep * A, 0.92); const ph = w.k * (w.dx * px + w.dz * pz) - w.w * t + w.ph; const c = S / (w.k * n) * Math.cos(ph); dx += w.dx * c; dz += w.dz * c; } px = x - dx; pz = z - dz; }
    let y = 0, nx = 0, nz = 0, ny = 0; for (const w of this._k) { const S = Math.min(w.steep * A, 0.92); const ph = w.k * (w.dx * px + w.dz * pz) - w.w * t + w.ph; const a = w.amp * A; y += a * Math.sin(ph); nx += w.dx * w.k * a * Math.cos(ph); nz += w.dz * w.k * a * Math.cos(ph); ny += S / n * Math.sin(ph); }
    if (out) { const l = Math.hypot(nx, Math.max(0.25, 1 - ny), nz); out.set(-nx / l, Math.max(0.25, 1 - ny) / l, -nz / l); } return y + this.level;
  }
}
