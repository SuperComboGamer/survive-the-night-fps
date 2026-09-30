// Sky dome (procedural day/night: hazy sun, blood-red dusk, moon, stars, drifting clouds),
// hemisphere + sun/moon light (cascaded shadows via three's SunLight), distance fog + valley mist
// with sun in-scattering (globals.js), and the sun-shaft parameters for the post passes - all driven
// by the server's day/night phase.
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { PHASE, DAY_LENGTH, FIRST_DAY_LENGTH, NIGHT_LENGTH } from '../../shared/constants.js';
import { G, FOG_FUNCS } from './globals.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uTime;
uniform float uCloud;
uniform vec3 uFog;
${FOG_FUNCS}
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  // below horizon: fade to fog-ish ground color
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
  // sun glow along the horizon (dusk)
  float sd = max(dot(d, uSunDir), 0.0);
  col += uGlow * pow(sd, 6.0) * 0.9 * (1.0 - uNight * 0.7);
  col += uGlow * pow(sd, 90.0) * 1.2 * (1.0 - uNight);
  col += vec3(1.0, 0.92, 0.8) * smoothstep(0.9993, 0.9997, sd) * (1.0 - uNight) * 2.0;
  // moon
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.55, 0.62, 0.75) * pow(md, 300.0) * uNight * 0.6;
  col += vec3(0.85, 0.88, 0.95) * smoothstep(0.99955, 0.99975, md) * uNight * 1.6;
  // stars
  if (uNight > 0.01 && h > 0.0) {
    vec3 sp = d * 420.0;
    float s = hash(floor(sp));
    float star = smoothstep(0.9975, 1.0, s) * (0.5 + 0.5 * sin(uTime * 3.0 + s * 100.0));
    col += vec3(star) * uNight * smoothstep(0.0, 0.3, h) * 0.9;
  }
  // clouds: fbm deck with cheap self-shadowing (density one step towards the light) and a
  // forward-scattering silver lining around the sun/moon
  if (h > -0.05) {
    vec3 cp = vec3(d.xz / (h + 0.15), 0.0) * 1.3 + vec3(uTime * 0.004, uTime * 0.002, uTime * 0.01);
    float c = fbm(cp);
    float cov = smoothstep(0.42 - uCloud * 0.25, 0.85, c);
    vec2 toL = uSunDirW.xz / max(length(uSunDirW.xz), 1e-3);
    float c2 = fbm(cp + vec3(toL * 0.22, 0.0));
    float lit = clamp(0.55 + (c - c2) * 4.0, 0.0, 1.0);
    float thick = smoothstep(0.55, 0.95, c);
    vec3 shade = mix(uHorizon * 1.02, uZenith * 0.75 + uGlow * 0.12, 0.4) * (0.62 + 0.5 * lit) * (1.0 - thick * 0.3);
    float fwd = pow(max(dot(d, uSunDirW), 0.0), 5.0);
    vec3 cloudCol = shade + uGlow * (lit * 0.18 + fwd * (1.0 - thick) * 0.9) * (1.0 - uNight * 0.7);
    cloudCol *= 1.0 - uNight * 0.6;
    col = mix(col, cloudCol, cov * smoothstep(-0.05, 0.25, h) * 0.88);
  }
  // melt into the (sun-lit) haze at the horizon so distant terrain has no seam
  col = mix(col, stnFogColor(uFog, d), smoothstep(0.16, -0.02, h));
  gl_FragColor = vec4(col, 1.0);
}
`;

const C = (hex) => new THREE.Color(hex);
// palette keyframes by "sun height" (-1 night .. 1 noon)
// dirI: direct sun/moon · hemi: sky/ground ambient · fogD: FogExp2 density · mist: valley mist density at its base
// scatter: haze glow towards the light (0..1) · rays: sun-shaft strength
const KEYS = [
  { s: -1.0, zenith: C(0x03060f), horizon: C(0x0e1320), glow: C(0x141a30), hemiSky: C(0x4d6694), hemiGround: C(0x11131c), hemi: 0.5, dir: C(0x9ab4e4), dirI: 1.0, fog: C(0x0b0f19), fogD: 0.022, mist: 0.016, scatter: 0.5, rays: 0.6, exposure: 1.6 },
  { s: -0.12, zenith: C(0x05070f), horizon: C(0x151218), glow: C(0x3a1a1a), hemiSky: C(0x3e4660), hemiGround: C(0x100e10), hemi: 0.46, dir: C(0x8fa8d8), dirI: 0.7, fog: C(0x0b0b10), fogD: 0.021, mist: 0.016, scatter: 0.4, rays: 0.3, exposure: 1.4 },
  { s: 0.02, zenith: C(0x1d1a2a), horizon: C(0x6a2a1c), glow: C(0xc2401a), hemiSky: C(0x6a5360), hemiGround: C(0x1d1512), hemi: 0.5, dir: C(0xff7038), dirI: 1.25, fog: C(0x2e1f1e), fogD: 0.0145, mist: 0.014, scatter: 0.95, rays: 1.1, exposure: 1.1 },
  { s: 0.18, zenith: C(0x4a5260), horizon: C(0x8e7f76), glow: C(0xd98a5a), hemiSky: C(0x9aa0a8), hemiGround: C(0x2e2a21), hemi: 0.82, dir: C(0xffc998), dirI: 2.0, fog: C(0x6f6c67), fogD: 0.0086, mist: 0.008, scatter: 0.8, rays: 0.9, exposure: 0.95 },
  { s: 0.55, zenith: C(0x5a6778), horizon: C(0x8e9594), glow: C(0xbcb3a2), hemiSky: C(0xadb6ba), hemiGround: C(0x33302a), hemi: 0.86, dir: C(0xf6e6cf), dirI: 2.15, fog: C(0x7e8584), fogD: 0.0074, mist: 0.004, scatter: 0.6, rays: 0.6, exposure: 0.92 },
  { s: 1.0, zenith: C(0x5a6778), horizon: C(0x8e9594), glow: C(0xbcb3a2), hemiSky: C(0xadb6ba), hemiGround: C(0x33302a), hemi: 0.88, dir: C(0xf6e6cf), dirI: 2.2, fog: C(0x7e8584), fogD: 0.0072, mist: 0.003, scatter: 0.55, rays: 0.55, exposure: 0.92 },
];
const COLOR_KEYS = ['zenith', 'horizon', 'glow', 'hemiSky', 'hemiGround', 'dir', 'fog'];
const NUM_KEYS = ['hemi', 'dirI', 'fogD', 'mist', 'scatter', 'rays', 'exposure'];

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uCloud: { value: 0.5 },
      uFog: { value: new THREE.Color() },
      ...G,
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(480, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    scene.add(sky);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
    scene.add(this.hemi);
    // sun / moon: cascaded shadow maps (2 cascades in one atlas, texel-snapped bounding spheres,
    // Vogel-disc PCF) fitted to the view frustum up to shadow.camera.far
    this.sun = new SunLight(0xffffff, 1);
    const sh = this.sun.shadow;
    sh.mapSize.set(2048, 2048);
    sh.camera.far = 120;
    sh.bias = -0.0003;
    sh.normalBias = 0.045;
    sh.radius = 2.2;
    this.sun.castShadow = false;
    scene.add(this.sun);
    this.dir = this.sun;
    this.fog = new THREE.FogExp2(0x888888, 0.01);
    scene.fog = this.fog;

    this.cur = { hemi: 1, dirI: 1, fogD: 0.01, mist: 0, scatter: 0.5, rays: 0, exposure: 1 };
    for (const k of COLOR_KEYS) this.cur[k] = new THREE.Color();
    this.night = 0;
    this.cycle = 0.46;
    this.sunHeight = 0;
    this.fogVisibility = 200;
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.adaptRef = 0.1;
    // sun-shaft parameters for the post passes (renderer reads post.rays)
    this.rays = { sunDir: this.lightDir, color: new THREE.Color(), strength: 0, sigma: 0.02 };
  }

  // quality: renderer.q (shadows, shadowMapSize, shadowDist)
  setShadows(q) {
    const on = typeof q === 'object' ? !!q.shadows : !!q;
    this.sun.castShadow = on;
    if (!on || typeof q !== 'object') return;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== q.shadowMapSize) {
      sh.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      sh.map?.dispose();
      sh.map = null;
    }
    sh.camera.far = q.shadowDist;
    // wider kernel on coarse maps, a little tighter on big ones (penumbra stays ~10 cm near the camera)
    sh.radius = q.shadowMapSize >= 3072 ? 2.6 : q.shadowMapSize >= 2048 ? 2.2 : 1.6;
  }

  // cycle position in [0,1): day = [0, 0.5), night = [0.5, 1)
  static cycleFor(phase, timeLeft, day, phaseLen) {
    if (phase === PHASE.DAY) {
      const len = phaseLen || (day <= 1 ? FIRST_DAY_LENGTH : DAY_LENGTH);
      const p = 1 - Math.max(0, Math.min(1, timeLeft / len));
      return 0.055 + p * 0.43;
    }
    if (phase === PHASE.NIGHT) {
      const p = 1 - Math.max(0, Math.min(1, timeLeft / (phaseLen || NIGHT_LENGTH)));
      return 0.5 + p * 0.49;
    }
    if (phase === PHASE.VICTORY) return 0.04;
    if (phase === PHASE.GAMEOVER) return 0.75;
    return 0.47; // menu / waiting: dusk
  }

  update(dt, targetCycle, camPos, time, overrides = {}) {
    // smooth cycle (handles wrap)
    let d = targetCycle - this.cycle;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    this.cycle = (this.cycle + d * Math.min(1, dt * 2) + 1) % 1;
    const a = this.cycle * Math.PI * 2;
    // sun path: rises east (+x), sets west, low arc (northern forest in autumn)
    const sunH = Math.sin(a);
    this.sunHeight = sunH;
    const sunDir = this.uniforms.uSunDir.value.set(Math.cos(a), Math.sin(a) * 0.75 + 0.02, 0.35).normalize();
    const moonDir = this.uniforms.uMoonDir.value.set(-Math.cos(a) * 0.8, -Math.sin(a) * 0.8 + 0.25, -0.4).normalize();
    // interpolate palette
    const s = Math.max(-1, Math.min(1, sunH));
    let k = 0;
    while (k < KEYS.length - 2 && KEYS[k + 1].s < s) k++;
    const A = KEYS[k];
    const B = KEYS[k + 1];
    const t = Math.max(0, Math.min(1, (s - A.s) / (B.s - A.s)));
    const c = this.cur;
    for (const key of COLOR_KEYS) c[key].copy(A[key]).lerp(B[key], t);
    for (const key of NUM_KEYS) c[key] = A[key] + (B[key] - A[key]) * t;
    if (overrides.fogMul) c.fogD *= overrides.fogMul;
    this.night = 1 - Math.max(0, Math.min(1, (sunH + 0.12) / 0.3));

    const u = this.uniforms;
    u.uZenith.value.copy(c.zenith);
    u.uHorizon.value.copy(c.horizon);
    u.uGlow.value.copy(c.glow);
    u.uNight.value = this.night;
    u.uTime.value = time;
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    // physically based light units (r155+): Lambert divides by PI
    this.hemi.intensity = c.hemi * Math.PI;
    // the key light hands over from the sun to the moon just after sunset; fade through zero so the
    // shadows don't jump direction
    const useSun = sunH > -0.05;
    const handover = Math.min(1, Math.abs(sunH + 0.05) / 0.06);
    this.lightDir.copy(useSun ? sunDir : moonDir);
    this.lightDir.y = Math.max(0.12, this.lightDir.y);
    this.lightDir.normalize();
    this.sun.color.copy(c.dir);
    this.sun.intensity = c.dirI * Math.PI * handover;
    this.sun.position.copy(this.lightDir);
    this.fog.color.copy(c.fog);
    u.uFog.value.copy(c.fog);
    this.fog.density = c.fogD;
    this.fogVisibility = Math.sqrt(3) / c.fogD; // ~95% fogged
    this.exposure = c.exposure;
    this.sky.position.copy(camPos);

    // global haze: valley mist + glow towards the key light
    G.uSunDirW.value.copy(useSun ? sunDir : moonDir);
    G.uMist.value.set(c.mist * (overrides.mistMul ?? 1), -1.0, 0.28, c.scatter);
    G.uFogSun.value.copy(c.dir).multiplyScalar(c.dirI * 0.3 * handover).add(c.fog);
    G.uWind.value.x = time;

    // log-average luminance an open scene has at this light level (calibrated on open ground at
    // noon/dawn/dusk): the eye-adaptation reference, so only unusually dark/bright views adapt
    const lum = (col) => 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
    this.adaptRef = 0.0267 * (c.hemi * lum(c.hemiSky) + 0.45 * this.sun.intensity / Math.PI * lum(c.dir));

    // sun shafts: strongest with a low sun, faded while the light hands over
    const r = this.rays;
    r.color.copy(c.dir).multiplyScalar(c.dirI * 0.3);
    r.strength = c.rays * handover * (useSun ? 1 : 0.5);
    r.sigma = Math.max(0.006, c.fogD * 2.2);
  }
}
