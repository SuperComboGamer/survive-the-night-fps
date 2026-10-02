// Supply-drop flyover (EVT.FLYOVER): the cargo plane crossing the valley on the server's line, the smoke its
// engines trail and its drone. The smoke hangs in the sky for a couple of minutes, spreading and drifting with
// the wind (older = wider and fainter), so the trail still shows where the plane came from and where it dropped
// the crate long after it has gone. Things in the sky get a thinner haze than the ground (SKY_FOG_*) so the plane
// reads overhead yet still melts into the distance.
import * as THREE from 'three';
import { PLANE_SPEED, PLANE_LEAD, INTERP_DELAY } from '../../shared/constants.js';
import { createCargoPlane, ENGINE_X, ENGINE_Y } from './models/plane.js';

// share of the ground haze's optical depth applied to the plane and to its smoke
const SKY_FOG_PLANE = 0.15;
const SKY_FOG_SMOKE = 0.25;
const SMOKE_LIFE = 150; // s
const SMOKE_STEP = 1.6; // metres flown between puffs, per wing
const SMOKE_MAX = 6144; // puff ring buffer (two overlapping flyovers)
// each wing trails one band of smoke from its pair of engines
const TRAILS = [(ENGINE_X[0] + ENGINE_X[1]) / 2, (ENGINE_X[2] + ENGINE_X[3]) / 2];
const TRAIL_SPREAD = Math.abs(ENGINE_X[1] - ENGINE_X[0]);
const CLIMB = 0.05; // after the drop the plane eases into a climb (m gained per m flown, eventually)
const SOUND_SPEED = 343;
const EXHAUST_Z = 3.4; // behind the nacelles (plane space)

// three's fog chunk (as replaced by globals.js) with the distance haze scaled by k
const skyFogFragment = (k) => THREE.ShaderChunk.fog_fragment.replace('fogL * fogL;', `fogL * fogL * ${k.toFixed(3)};`);

const SMOKE_VERT = /* glsl */ `
attribute vec4 aP; // spawn position, birth time
attribute vec4 aV; // prop-wash velocity, seed
attribute vec2 aD; // wind drift at birth
uniform float uTime;
uniform float uLife;
uniform vec2 uDrift;
uniform vec3 uAmb;
uniform vec3 uSun;
uniform vec3 uSunDirW;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vCol;
#include <fog_pars_vertex>
float hg01(float c, float g) {
  float g2 = g * g;
  return pow((1.0 + g2 - 2.0 * g) / max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5);
}
void main() {
  float age = uTime - aP.w;
  if (age < 0.0 || age > uLife) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float seed = aV.w;
  float r1 = fract(seed * 7.13);
  float r2 = fract(seed * 3.71);
  float r3 = fract(seed * 11.9);
  // thrown out by the prop wash, then it hangs in the air: sags a little, billows, rides the wind
  vec3 p = aP.xyz + aV.xyz * (1.0 - exp(-age * 0.6)) / 0.6;
  p.xz += uDrift - aD;
  p.y -= age * 0.05;
  float wob = min(age * 0.05, 2.5);
  p += vec3(sin(seed * 61.0 + age * 0.23), 0.5 * sin(seed * 37.0 + age * 0.19), cos(seed * 53.0 + age * 0.21)) * wob;
  float size = (5.5 + 3.5 * (1.0 - exp(-age / 1.5)) + 9.0 * (1.0 - exp(-age / 20.0)) + age * 0.02) * (0.8 + 0.4 * r1);
  float rot = seed * 6.2832 + age * 0.08 * (r2 - 0.5);
  float c = cos(rot);
  float s = sin(rot);
  vec2 q = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * size;
  gl_Position = projectionMatrix * mvPosition;
  vUv = q + 0.5;
  // the smoke thins as it spreads; it fades in behind the engines and out at the end of its life
  float t = age / uLife;
  vAlpha = min(0.5, 0.36 * pow(5.5 / size, 1.15)) * smoothstep(0.0, 0.35, age) * (1.0 - smoothstep(0.6, 1.0, t)) * (0.7 + 0.3 * r3);
  // lit by the sky and the sun; glows when it hangs between you and the sun
  float fwd = hg01(dot(normalize(p - cameraPosition), uSunDirW), 0.65);
  vCol = 0.8 * (uAmb + uSun * (0.35 + 1.1 * fwd));
  #include <fog_vertex>
}`;

const SMOKE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vCol;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uAtlas, (vec2(1.0, 2.0) + vUv) / 3.0); // effects atlas cell 1: smoke
  float a = t.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * (0.75 + 0.25 * t.g), a);
  SKY_FOG_FRAGMENT
}`;

export class Flyover {
  /** atlas: the Effects particle atlas (its smoke cell shapes the puffs) */
  constructor(scene, atlas) {
    this.scene = scene;
    this.planes = [];
    this.mats = new Map();
    this.drift = new THREE.Vector2(); // wind drift integrated over time (m)
    this._v = new THREE.Vector3();
    // smoke puffs: one instanced camera-facing quad each, animated entirely on the GPU from its birth state
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_MAX * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aP = attr(4);
    this.aV = attr(4);
    this.aD = attr(2);
    geo.setAttribute('aP', this.aP);
    geo.setAttribute('aV', this.aV);
    geo.setAttribute('aD', this.aD);
    geo.instanceCount = 0;
    this.geo = geo;
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uAtlas: { value: null }, uTime: { value: 0 }, uLife: { value: SMOKE_LIFE }, uDrift: { value: new THREE.Vector2() }, uAmb: { value: new THREE.Color() }, uSun: { value: new THREE.Color() } },
    ]);
    this.uniforms.uAtlas.value = atlas;
    const mat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG.replace('SKY_FOG_FRAGMENT', skyFogFragment(SKY_FOG_SMOKE)),
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.smoke = new THREE.Mesh(geo, mat);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 3;
    scene.add(this.smoke);
    this.head = 0;
    this.count = 0;
    this.lo = SMOKE_MAX;
    this.hi = -1;
  }

  // the plane's materials with the thinner sky haze (shared by every flyover)
  skyMaterial(src) {
    let m = this.mats.get(src);
    if (!m) {
      m = src.clone();
      m.side = THREE.DoubleSide;
      const base = src.onBeforeCompile;
      const key = src.customProgramCacheKey();
      m.onBeforeCompile = (sh, r) => {
        base.call(m, sh, r);
        sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', skyFogFragment(SKY_FOG_PLANE));
      };
      m.customProgramCacheKey = () => key + '|skyfog';
      this.mats.set(src, m);
    }
    return m;
  }

  /** EVT.FLYOVER: the plane's origin will be at (x,y,z) heading `heading` in `eta` s (when the crate leaves the ramp) */
  start(x, y, z, heading, eta, now, audio) {
    const obj = createCargoPlane();
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const lit = !o.material.isMeshBasicMaterial;
      o.material = this.skyMaterial(o.material);
      o.castShadow = lit;
    });
    obj.rotation.order = 'YXZ';
    this.scene.add(obj);
    const tRel = now + eta + INTERP_DELAY; // the crate is drawn INTERP_DELAY in the past too
    const sMin = (now - tRel) * PLANE_SPEED;
    const p = {
      obj,
      x,
      y,
      z,
      heading,
      fx: -Math.sin(heading),
      fz: -Math.cos(heading),
      tRel,
      sMin,
      next: TRAILS.map((_, i) => sMin + (i * SMOKE_STEP) / TRAILS.length),
      loop: null,
      phase: Math.random() * 10,
    };
    const at = this.pos(p, sMin, this._v);
    p.loop = audio?.createLoop?.('plane', at.x, at.y, at.z) ?? null;
    this.planes.push(p);
  }

  // height gained after the drop (the plane eases into a gentle climb)
  climb(s) {
    return s > 0 ? (CLIMB * s * s) / (s + 120) : 0;
  }

  pos(p, s, out) {
    return out.set(p.x + p.fx * s, p.y + this.climb(s), p.z + p.fz * s);
  }

  _puff(p, s, x) {
    const rng = Math.random;
    const c = Math.cos(p.heading), sn = Math.sin(p.heading);
    const lx = x + (rng() - 0.5) * TRAIL_SPREAD;
    const lz = EXHAUST_Z;
    const i = this.head;
    this.head = (i + 1) % SMOKE_MAX;
    this.count = Math.min(SMOKE_MAX, this.count + 1);
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
    const P = this.aP.array, V = this.aV.array, D = this.aD.array;
    P[i * 4] = p.x + p.fx * s + lx * c + lz * sn;
    P[i * 4 + 1] = p.y + this.climb(s) + ENGINE_Y + (rng() - 0.5) * 0.4;
    P[i * 4 + 2] = p.z + p.fz * s - lx * sn + lz * c;
    P[i * 4 + 3] = p.tRel + s / PLANE_SPEED;
    V[i * 4] = (rng() - 0.5) * 2.4;
    V[i * 4 + 1] = (rng() - 0.5) * 1.2 - 0.5;
    V[i * 4 + 2] = (rng() - 0.5) * 2.4;
    V[i * 4 + 3] = rng();
    D[i * 2] = this.drift.x;
    D[i * 2 + 1] = this.drift.y;
  }

  /** cam: the camera (listener + smoke lighting) · env: Environment · weather: Weather.state */
  update(dt, time, cam, env, weather) {
    // the smoke rides the wind
    const ws = 0.25 + 0.6 * (weather?.wind ?? 0.4);
    this.drift.x += (weather?.windX ?? 0) * ws * dt;
    this.drift.y += (weather?.windZ ?? 0) * ws * dt;
    const u = this.uniforms;
    u.uTime.value = time;
    u.uDrift.value.copy(this.drift);
    // what the smoke's underside sees: mostly sky, a little ground bounce
    u.uAmb.value.copy(env.hemi.color).lerp(env.hemi.groundColor, 0.2).multiplyScalar(env.hemi.intensity / Math.PI);
    u.uSun.value.copy(env.sun.color).multiplyScalar(env.sun.intensity / Math.PI);

    const L = cam.position;
    const v = this._v;
    for (let k = this.planes.length - 1; k >= 0; k--) {
      const p = this.planes[k];
      const s = (time - p.tRel) * PLANE_SPEED;
      // smoke: evenly spaced puffs along the path flown so far, whatever the frame rate
      const sEnd = Math.min(s, PLANE_LEAD);
      for (let e = 0; e < TRAILS.length; e++)
        while (p.next[e] <= sEnd) {
          this._puff(p, p.next[e], TRAILS[e]);
          p.next[e] += SMOKE_STEP;
        }
      // the plane: level flight, a lazy wobble, nose up once it climbs away
      const o = p.obj;
      o.visible = s <= PLANE_LEAD;
      if (o.visible) {
        const t = time + p.phase;
        this.pos(p, s, o.position);
        o.position.y += Math.sin(t * 0.37) * 0.6;
        o.rotation.y = p.heading;
        o.rotation.x = Math.atan(s > 0 ? (CLIMB * (s * s + 240 * s)) / ((s + 120) * (s + 120)) : 0) + Math.sin(t * 0.31) * 0.012;
        o.rotation.z = Math.sin(t * 0.43) * 0.025;
        for (const pr of o.userData.props) pr.rotation.z -= dt * 52;
        const blink = (time * 1.1) % 1;
        o.userData.beacons[0].visible = blink < 0.12;
        o.userData.beacons[1].visible = blink > 0.5 && blink < 0.62;
      }
      // sound: heard from where the plane was when the sound left it, doppler-shifted along the line of sight
      let sr = s;
      for (let it = 0; it < 3; it++) {
        this.pos(p, sr, v);
        sr = s - (v.distanceTo(L) / SOUND_SPEED) * PLANE_SPEED;
      }
      this.pos(p, sr, v);
      if (p.loop) {
        const d = Math.max(1, v.distanceTo(L));
        const away = (p.fx * (v.x - L.x) + p.fz * (v.z - L.z)) / d; // cosine between flight and line of sight
        p.loop.setPosition(v.x, v.y, v.z);
        p.loop.setRate(1 / (1 + (away * PLANE_SPEED) / SOUND_SPEED));
        p.loop.setVolume(Math.min(1, Math.max(0, (sr - p.sMin) / 150)) * Math.min(1, Math.max(0, (PLANE_LEAD + 300 - sr) / 150)));
      }
      if (sr > PLANE_LEAD + 300) {
        p.loop?.stop();
        this.scene.remove(o);
        this.planes.splice(k, 1);
      }
    }
    this._flush();
  }

  _flush() {
    if (this.hi < this.lo) return;
    for (const a of [this.aP, this.aV, this.aD]) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.lo * a.itemSize, (this.hi - this.lo + 1) * a.itemSize);
      a.needsUpdate = true;
    }
    this.geo.instanceCount = this.count;
    this.lo = SMOKE_MAX;
    this.hi = -1;
  }

  clear() {
    for (const p of this.planes) {
      p.loop?.stop();
      this.scene.remove(p.obj);
    }
    this.planes.length = 0;
    this.head = this.count = 0;
    this.geo.instanceCount = 0;
    this.lo = SMOKE_MAX;
    this.hi = -1;
  }
}
