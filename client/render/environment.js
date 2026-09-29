// Sky dome (procedural day/night: overcast sun, blood-red dusk, moon, stars, drifting clouds),
// hemisphere + sun/moon light, and exponential fog - all driven by the server's day/night phase, with the
// weather (client/game/weather.js) on top: fog banks, a storm deck that hides the moon, wind-driven
// clouds and lightning that lights the clouds, the fog and the whole scene for a moment.
import * as THREE from 'three';
import { PHASE, DAY_LENGTH, FIRST_DAY_LENGTH, NIGHT_LENGTH } from '../../shared/constants.js';

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
uniform float uOvercast;
uniform vec3 uCloudOff;
uniform float uFlash;
uniform vec3 uFlashDir;
uniform vec3 uFog;
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
  // moon + stars (hidden behind a storm deck)
  float clear = 1.0 - uOvercast * 0.94;
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.55, 0.62, 0.75) * pow(md, 300.0) * uNight * 0.6 * clear;
  col += vec3(0.85, 0.88, 0.95) * smoothstep(0.99955, 0.99975, md) * uNight * 1.6 * clear;
  // stars
  if (uNight > 0.01 && h > 0.0) {
    vec3 sp = d * 420.0;
    float s = hash(floor(sp));
    float star = smoothstep(0.9975, 1.0, s) * (0.5 + 0.5 * sin(uTime * 3.0 + s * 100.0));
    col += vec3(star) * uNight * smoothstep(0.0, 0.3, h) * 0.9 * clear;
  }
  // clouds (drift with the wind; a storm closes them into a low, dark deck)
  float cov = 0.0;
  if (h > -0.05) {
    vec3 cp = vec3(d.xz / (h + 0.15), 0.0) * 1.3 + uCloudOff;
    float c = fbm(cp);
    cov = smoothstep(0.42 - uCloud * 0.25, 0.85, c);
    cov = max(cov, uOvercast * (0.5 + 0.5 * smoothstep(0.25, 0.75, c)));
    vec3 cloudCol = mix(uHorizon * 1.05, uZenith * 0.7 + uGlow * 0.15, 0.4) * (1.0 - uNight * 0.6) * (1.0 - uOvercast * (0.3 + 0.25 * c));
    col = mix(col, cloudCol, cov * smoothstep(-0.05, 0.25, h) * 0.9);
  }
  // lightning: the deck lights up from inside, brightest around the strike
  if (uFlash > 0.001) {
    float fd = max(dot(d, uFlashDir), 0.0);
    col += vec3(0.6, 0.66, 0.85) * uFlash * (0.1 + 0.45 * cov + (0.35 + cov) * 1.4 * pow(fd, 5.0)) * smoothstep(-0.12, 0.15, h);
  }
  // melt into the fog at the horizon so distant terrain has no seam
  col = mix(col, uFog, smoothstep(0.16, -0.02, h));
  gl_FragColor = vec4(col, 1.0);
}
`;

const C = (hex) => new THREE.Color(hex);
const FLASH_SKY = C(0xb8c6ff);
const FLASH_GROUND = C(0x4a5068);
const FLASH_FOG = C(0x5a6278);
// palette keyframes by "sun height" (-1 night .. 1 noon). The fog thickens through golden hour and dusk
// and the night keeps a faint moonlit haze, so the treeline melts away rather than just going black.
const KEYS = [
  { s: -1.0, zenith: C(0x02040c), horizon: C(0x0a0e16), glow: C(0x101428), hemiSky: C(0x4a6290), hemiGround: C(0x10111a), hemi: 0.5, dir: C(0x9ab4e4), dirI: 0.55, fog: C(0x0b0f18), fogD: 0.027, exposure: 1.45 },
  { s: -0.12, zenith: C(0x05070f), horizon: C(0x151218), glow: C(0x3a1a1a), hemiSky: C(0x3e4660), hemiGround: C(0x100e10), hemi: 0.46, dir: C(0x8fa8d8), dirI: 0.42, fog: C(0x0e0e14), fogD: 0.026, exposure: 1.3 },
  { s: 0.02, zenith: C(0x1d1a2a), horizon: C(0x6a2a1c), glow: C(0xc2401a), hemiSky: C(0x6a5360), hemiGround: C(0x1d1512), hemi: 0.55, dir: C(0xff7a40), dirI: 0.8, fog: C(0x2e1f1e), fogD: 0.0195, exposure: 1.1 },
  { s: 0.18, zenith: C(0x4a5260), horizon: C(0x8e7f76), glow: C(0xd98a5a), hemiSky: C(0x9aa0a8), hemiGround: C(0x2e2a21), hemi: 1.05, dir: C(0xffd2a8), dirI: 1.3, fog: C(0x6f6c67), fogD: 0.0108, exposure: 1.0 },
  { s: 0.55, zenith: C(0x5a6778), horizon: C(0x8e9594), glow: C(0xbcb3a2), hemiSky: C(0xadb6ba), hemiGround: C(0x33302a), hemi: 1.12, dir: C(0xf4e8d6), dirI: 1.3, fog: C(0x7e8584), fogD: 0.0074, exposure: 0.98 },
  { s: 1.0, zenith: C(0x5a6778), horizon: C(0x8e9594), glow: C(0xbcb3a2), hemiSky: C(0xadb6ba), hemiGround: C(0x33302a), hemi: 1.16, dir: C(0xf4e8d6), dirI: 1.35, fog: C(0x7e8584), fogD: 0.0072, exposure: 0.98 },
];

// Twilight pacing (seconds). The sun lingers near the horizon so dusk and dawn each play out over about a
// minute, and every phase ends on the sun position the next one starts from (no jump at the phase change).
// Sunrise happens at the end of the night, so each day opens in light morning rather than red dawn.
const MORNING = 0.04; // cycle position where every day starts: the sun is up and the sky is light
const DUSK_SECS = 75; // end of the day: golden hour into blood-red dusk (the horde horn lands mid-way)
const NIGHTFALL_SECS = 30; // start of the night: the last light drains away
const DAWN_SECS = 60; // end of the night: the sky greys and the sun rises (the last wave lands at the start)

// piecewise-linear sun path through one phase: c0 at the start, c1 after the lead-in, c2 when the
// lead-out begins, c3 at the end. Short (test) phases shrink the twilight windows to fit.
function phaseCycle(timeLeft, len, c0, c1, c2, c3, inSecs, outSecs) {
  const left = Math.max(0, Math.min(len, timeLeft));
  const elapsed = len - left;
  const tin = Math.min(inSecs, len * 0.25);
  const tout = Math.min(outSecs, len * 0.35);
  if (elapsed < tin) return c0 + (c1 - c0) * (elapsed / tin);
  if (left < tout) return c3 - (c3 - c2) * (left / tout);
  return c1 + (c2 - c1) * ((elapsed - tin) / (len - tin - tout));
}

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
      uOvercast: { value: 0 },
      uCloudOff: { value: new THREE.Vector3() },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(0, 1, 0) },
      uFog: { value: new THREE.Color() },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(480, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    sky.frustumCulled = false;
    // drawn after the opaque world: the dome sits exactly on the far plane (xyww), so the depth test
    // rejects every sky pixel already covered by terrain / trees / buildings before the cloud noise runs
    sky.renderOrder = 1000;
    this.sky = sky;
    scene.add(sky);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
    scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight(0xffffff, 1);
    this.dir.position.set(50, 100, 30);
    // sun / moon shadows (high quality): a 140 m box that follows the camera, snapped to its texels
    const sh = this.dir.shadow;
    sh.mapSize.set(2048, 2048);
    sh.camera.left = -70;
    sh.camera.right = 70;
    sh.camera.top = 70;
    sh.camera.bottom = -70;
    sh.camera.near = 10;
    sh.camera.far = 320;
    sh.bias = -0.0008;
    sh.normalBias = 0.05;
    this.dir.castShadow = false;
    scene.add(this.dir);
    scene.add(this.dir.target);
    this.fog = new THREE.FogExp2(0x888888, 0.01);
    scene.fog = this.fog;

    this.cur = {
      zenith: new THREE.Color(),
      horizon: new THREE.Color(),
      glow: new THREE.Color(),
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      dir: new THREE.Color(),
      fog: new THREE.Color(),
      hemi: 1,
      dirI: 1,
      fogD: 0.01,
      exposure: 1,
    };
    this.night = 0;
    this.cycle = 0.46;
    this.sunHeight = 0;
    this.fogVisibility = 200;
    this._grey = new THREE.Color();
  }

  setShadows(on) {
    this.dir.castShadow = !!on;
  }

  // cycle position in [0,1): day = [0, 0.5), night = [0.5, 1)
  static cycleFor(phase, timeLeft, day, phaseLen) {
    if (phase === PHASE.DAY) {
      const len = phaseLen || (day <= 1 ? FIRST_DAY_LENGTH : DAY_LENGTH);
      return phaseCycle(timeLeft, len, MORNING, MORNING, 0.45, 0.5, 0, DUSK_SECS);
    }
    if (phase === PHASE.NIGHT) {
      return phaseCycle(timeLeft, phaseLen || NIGHT_LENGTH, 0.5, 0.52, 0.975, 1 + MORNING, NIGHTFALL_SECS, DAWN_SECS) % 1;
    }
    if (phase === PHASE.VICTORY) return MORNING;
    if (phase === PHASE.GAMEOVER) return 0.75;
    return 0.47; // menu / waiting: dusk
  }

  // w: weather state (client/game/weather.js), optional
  update(dt, targetCycle, camPos, time, w = null) {
    // smooth cycle (handles wrap)
    let d = targetCycle - this.cycle;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    this.cycle = (this.cycle + d * Math.min(1, dt * 2) + 1) % 1;
    const a = this.cycle * Math.PI * 2;
    // sun path: rises east (+x), sets west, low arc (overcast northern forest)
    const sunH = Math.sin(a);
    this.sunHeight = sunH;
    const sunDir = this.uniforms.uSunDir.value.set(Math.cos(a), Math.sin(a) * 0.75 + 0.02, 0.35).normalize();
    this.uniforms.uMoonDir.value.set(-Math.cos(a) * 0.8, -Math.sin(a) * 0.8 + 0.25, -0.4).normalize();
    // interpolate palette
    const s = Math.max(-1, Math.min(1, sunH));
    let k = 0;
    while (k < KEYS.length - 2 && KEYS[k + 1].s < s) k++;
    const A = KEYS[k];
    const B = KEYS[k + 1];
    const t = Math.max(0, Math.min(1, (s - A.s) / (B.s - A.s)));
    const c = this.cur;
    for (const key of ['zenith', 'horizon', 'glow', 'hemiSky', 'hemiGround', 'dir', 'fog']) c[key].copy(A[key]).lerp(B[key], t);
    for (const key of ['hemi', 'dirI', 'fogD', 'exposure']) c[key] = A[key] + (B[key] - A[key]) * t;
    this.night = 1 - Math.max(0, Math.min(1, (sunH + 0.12) / 0.3));
    const u = this.uniforms;
    if (w) this.applyWeather(dt, w);

    u.uZenith.value.copy(c.zenith);
    u.uHorizon.value.copy(c.horizon);
    u.uGlow.value.copy(c.glow);
    u.uNight.value = this.night;
    u.uTime.value = time;
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    // physically based light units (r155+): Lambert divides by PI
    this.hemi.intensity = c.hemi * Math.PI;
    this.dir.color.copy(c.dir);
    this.dir.intensity = c.dirI * Math.PI;
    const lightDir = sunH > -0.05 ? sunDir : u.uMoonDir.value;
    const snap = 140 / 2048;
    const cx = Math.round(camPos.x / snap) * snap;
    const cz = Math.round(camPos.z / snap) * snap;
    const cy = Math.round(camPos.y / snap) * snap;
    const ly = Math.max(0.25, lightDir.y);
    this.dir.position.set(cx + lightDir.x * 160, cy + ly * 160, cz + lightDir.z * 160);
    this.dir.target.position.set(cx, cy, cz);
    this.fog.color.copy(c.fog);
    u.uFog.value.copy(c.fog);
    this.fog.density = c.fogD;
    this.fogVisibility = Math.sqrt(3) / c.fogD; // ~95% fogged
    this.exposure = c.exposure;
    this.sky.position.copy(camPos);
  }

  // weather on top of the time-of-day palette (mutates this.cur before it reaches the lights and fog)
  applyWeather(dt, w) {
    const c = this.cur;
    const u = this.uniforms;
    const oc = w.cloud;
    // overcast: the sun is gone, the sky and the fog go flat and grey
    c.fogD = Math.min(0.042, c.fogD * w.fog);
    c.dirI *= 1 - 0.6 * oc;
    c.hemi *= 1 - 0.2 * oc;
    c.glow.multiplyScalar(1 - 0.75 * oc);
    for (const k of ['zenith', 'horizon', 'fog']) {
      const col = c[k];
      const l = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
      col.lerp(this._grey.setRGB(l, l, l * 1.06), 0.55 * oc).multiplyScalar(1 - 0.22 * oc);
    }
    u.uOvercast.value = oc;
    u.uCloud.value = 0.5 + 0.5 * oc;
    // clouds ride the wind (the noise domain moves against the drift)
    const cs = (0.003 + 0.012 * w.wind) * dt;
    u.uCloudOff.value.x -= w.windX * cs;
    u.uCloudOff.value.y -= w.windZ * cs;
    u.uCloudOff.value.z = (u.uCloudOff.value.z + dt * (0.006 + 0.01 * w.wind)) % 1000;
    // lightning: a blue-white flash through the sky, the fog and every lit surface
    const f = w.flash;
    u.uFlash.value = f;
    u.uFlashDir.value.set(w.flashX, w.flashY, w.flashZ);
    if (f > 0.002) {
      const k = Math.min(1, f);
      c.hemiSky.lerp(FLASH_SKY, k * 0.85);
      c.hemiGround.lerp(FLASH_GROUND, k * 0.5);
      c.hemi += f * (0.7 + this.night * 1.1);
      c.dir.lerp(FLASH_SKY, k);
      c.dirI += f * (0.4 + this.night * 0.6);
      c.fog.lerp(FLASH_FOG, k * (0.35 + 0.3 * this.night));
    }
  }
}
