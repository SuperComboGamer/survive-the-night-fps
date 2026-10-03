// GPU-baked macro structure of the Surface Yard ground (haul roads + tyre ruts, foot paths, coal dust, oil, gravel / rust mottling, yard-vs-natural mask, grass, puddles).
// The terrain fragment shader used to evaluate ~30 noise fetches per pixel for this (0.86 ms GPU, the most expensive material of the stop); it is now two RGBA8 textures
// rendered once at build time from the same functions (2 fetches per pixel at run time).  A: road, rut, dark stains, mottling(0.5 = neutral, >0.5 pale gravel, <0.5 rust)
// B: yard mask, grass, puddle mask, mid-frequency noise.
import * as THREE from 'three';
import { G, NOISE_GLSL } from '../../core/mats.js';

const VS = `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const f2 = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const v4 = (a) => `vec4(${a.map(f2).join(', ')})`; const v3 = (a) => `vec3(${a.map(f2).join(', ')})`;

export const YARD_ROADS = [[[2, 66], [0, 12], 2.3, 1], [[48, 1], [18, 6], 2.0, 1], [[18, 6], [5, 6], 1.6, 1], [[0, -6], [0, -13.8], 1.1, 0], [[-6, -6], [-24, -6.5], 0.85, 0], [[-40, 0.5], [-8, 3], 1.2, 0], [[-15, 9], [-6, 6], 0.8, 0], [[-8, -34], [-6, -14], 1.0, 0]];
export const YARD_OIL = [[34, -20, 2.4], [-10, -12.4, 1.7], [12, -12.6, 1.6], [-21.5, -1.5, 1.3], [16, 2, 1.6]];
export const YARD_COAL = [[25, 16, 4, 11], [31, 21, 3, 9], [-30, -20, 4, 10]];

function fragment() {
  return `precision highp float; varying vec2 vUv; uniform float uPass; uniform vec3 uMacro;
${NOISE_GLSL}
const vec4 SG[8] = vec4[8](${YARD_ROADS.map((r) => v4([r[0][0], r[0][1], r[1][0], r[1][1]])).join(', ')});
const float SW[8] = float[8](${YARD_ROADS.map((r) => f2(r[2])).join(', ')});
const float SR[8] = float[8](${YARD_ROADS.map((r) => f2(r[3])).join(', ')});
const vec3 OS[5] = vec3[5](${YARD_OIL.map(v3).join(', ')});
float n3(vec2 p, float s, float o){ return zfbm3(vec3(p.x, 0.0, p.y) * s + o); }
void main(){
  vec2 P = uMacro.xy + vUv * uMacro.z;
  float n2 = zfbm3(vec3(P.x * 0.7, 0.0, P.y * 0.7) + 3.0);
  float yardM = 1.0 - smoothstep(0.72, 1.0, length(P / vec2(40.0, 33.0)) + 0.3 * (n2 - 0.5));
  if (uPass > 0.5) {
    float grass = smoothstep(0.5, 0.72, n2) * (1.0 - yardM);
    float pud = smoothstep(0.7, 0.8, zfbm3(vec3(P.x * 0.5, 0.05, P.y * 0.5) + 3.0)) * yardM;
    gl_FragColor = vec4(yardM, grass, pud, n2); return;
  }
  float road = 0.0, rut = 0.0;
  for (int i = 0; i < 8; i++) { vec4 sg = SG[i]; vec2 pa = P - sg.xy, ba = sg.zw - sg.xy; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); float d = length(pa - ba * t); float w = SW[i] * (0.85 + 0.3 * n2);
    float m = 1.0 - smoothstep(w * 0.7, w * 1.15, d); road = max(road, m);
    if (SR[i] > 0.5) { float side = (ba.x * pa.y - ba.y * pa.x) / (length(ba) + 1e-4); rut = max(rut, m * exp(-pow((abs(side) - w * 0.42) / 0.21, 2.0))); } }
  float cd = 0.0;
  ${YARD_COAL.map((c, i) => `cd = max(cd, 1.0 - smoothstep(${f2(c[2])}, ${f2(c[3])}, length(P - vec2(${f2(c[0])}, ${f2(c[1])})) + 2.0 * (n2 - 0.5)));`).join('\n  ')}
  cd = max(cd, (1.0 - smoothstep(0.6, 2.4, abs(P.y - 9.0) + 0.8 * (n2 - 0.5))) * step(-38.0, P.x) * step(P.x, 30.0) * 0.8);
  float oil = 0.0; for (int i = 0; i < 5; i++) oil = max(oil, 1.0 - smoothstep(OS[i].z * 0.5, OS[i].z, length(P - OS[i].xy) + 0.5 * (n2 - 0.5)));
  float gp = smoothstep(0.52, 0.64, n3(P, 0.31, 7.0)), dp = smoothstep(0.52, 0.66, n3(P, 0.23, 19.0)), rp = smoothstep(0.56, 0.7, n3(P, 0.4, 31.0));
  float dark = 1.0 - (1.0 - 0.72 * dp * yardM) * (1.0 - 0.85 * cd) * (1.0 - 0.7 * oil);
  float mot = 0.5 + 0.5 * clamp(gp * 0.6 * yardM - rp * 0.55 * yardM, -1.0, 1.0);
  gl_FragColor = vec4(road, rut, dark, mot);
}`;
}

/** Render the two macro textures. gfx: the Gfx (needs .renderer). Returns {texA, texB, o:[x0,z0,size]} (world/stop-local metres). */
export function bakeGroundMacro(gfx, { half = 96, size = 1024 } = {}) {
  const r = gfx.renderer; const t0 = performance.now();
  const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fragment(), uniforms: { uNoise3: G.uNoise3, uPass: { value: 0 }, uMacro: { value: new THREE.Vector3(-half, -half, 2 * half) } }, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; const scene = new THREE.Scene(); scene.add(quad); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mk = () => new THREE.WebGLRenderTarget(size, size, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  const rts = [mk(), mk()]; const prev = r.getRenderTarget(), ac = r.autoClear; r.autoClear = true;
  for (let i = 0; i < 2; i++) { mat.uniforms.uPass.value = i; r.setRenderTarget(rts[i]); r.render(scene, cam); rts[i].texture.anisotropy = 8; }
  r.setRenderTarget(prev); r.autoClear = ac; mat.dispose(); quad.geometry.dispose();
  console.log(`[macro] ground macro bake ${(performance.now() - t0).toFixed(0)} ms (${size}^2 x2)`);
  return { texA: rts[0].texture, texB: rts[1].texture, o: new THREE.Vector3(-half, -half, 2 * half) };
}
