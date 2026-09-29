// Weather visuals around the camera, driven by client/game/weather.js:
//  - rain: instanced streaks in a box that wraps around the camera, slanted by the wind, kept out from
//    under roofs, caught by the flashlight beam and lit up by lightning
//  - splashes: little ripples popping on the ground nearby
//  - leaves: debris tumbling past on the wind in a gale
//  - lightning bolts: jagged ribbons from the cloud deck down to the strike point
// Every system is a single draw call with fixed-size buffers; nothing is allocated per frame.
import * as THREE from 'three';
import { pulseEnvelope } from '../game/weather.js';

const ROOFS = 8;
const ROOF_GLSL = /* glsl */ `
uniform vec4 uRoofA[${ROOFS}]; // x, z, cos, sin (world -> roof-local like the world builder)
uniform vec4 uRoofB[${ROOFS}]; // half x, half z, eave height, ridge rise (+ slopes along local x, - along z)
bool underRoof(vec3 p) {
  for (int i = 0; i < ${ROOFS}; i++) {
    vec4 A = uRoofA[i];
    vec4 B = uRoofB[i];
    vec2 d = p.xz - A.xy;
    float lx = A.z * d.x - A.w * d.y;
    float lz = A.w * d.x + A.z * d.y;
    if (abs(lx) < B.x && abs(lz) < B.y) {
      float top = B.z + (B.w >= 0.0 ? B.w * (1.0 - abs(lx) / B.x) : -B.w * (1.0 - abs(lz) / B.y));
      if (p.y < top + 0.15) return true;
    }
  }
  return false;
}`;

const RAIN_VERT = /* glsl */ `
attribute vec4 aDrop; // xyz: spot in the unit box, w: random
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uOff; // integrated fall (m)
uniform vec3 uDir; // fall direction (wind-slanted)
uniform float uLen;
uniform float uWidth;
uniform float uPx; // meters per pixel at 1 m
uniform vec3 uFwd;
uniform float uBeam;
varying float vA;
varying float vB;
varying vec2 vQ;
${ROOF_GLSL}
#include <fog_pars_vertex>
void main() {
  float sp = 0.8 + 0.4 * aDrop.w;
  vec3 p = aDrop.xyz * uBox + uOff * sp;
  vec3 hb = uBox * vec3(0.5, 0.42, 0.5);
  vec3 rel = mod(p - uCam + hb, uBox) - hb;
  vec3 wp = uCam + rel;
  float dist = length(rel);
  vA = smoothstep(0.9, 3.0, dist)
    * (1.0 - smoothstep(0.6, 0.98, length(rel.xz) / hb.x))
    * smoothstep(-hb.y, 3.0 - hb.y, rel.y) * smoothstep(uBox.y - hb.y, uBox.y - hb.y - 3.0, rel.y);
  if (vA <= 0.0 || underRoof(wp)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 dir = rel / max(dist, 1e-3);
  vec3 side = normalize(cross(uDir, dir) + vec3(1e-4, 0.0, 0.0));
  // never thinner than a pixel; far drops fade instead
  float w = max(uWidth, dist * uPx * 1.1);
  vA *= clamp(uWidth / w, 0.3, 1.0);
  vec3 q = wp + side * (position.x * w) - uDir * (position.y * uLen * sp);
  vQ = position.xy;
  vB = smoothstep(0.88, 0.975, dot(dir, uFwd)) * uBeam * smoothstep(26.0, 2.0, dist);
  vec4 mvPosition = viewMatrix * vec4(q, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uBeamColor;
uniform float uOpacity;
varying float vA;
varying float vB;
varying vec2 vQ;
#include <fog_pars_fragment>
void main() {
  float x = vQ.x * 2.0;
  float a = vA * uOpacity * smoothstep(0.0, 0.2, vQ.y) * smoothstep(1.0, 0.35, vQ.y) * (1.0 - x * x);
  a *= 1.0 + vB * 2.2;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor + uBeamColor * vB, min(a, 1.0));
  #include <fog_fragment>
}`;

const SPLASH_VERT = /* glsl */ `
attribute float aBirth;
uniform float uTime;
uniform float uLife;
uniform float uScale;
varying float vAge;
#include <fog_pars_vertex>
void main() {
  vAge = (uTime - aBirth) / uLife;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float size = 0.06 + 0.08 * fract(aBirth * 91.7);
  gl_PointSize = vAge >= 0.0 && vAge < 1.0 ? uScale * size / max(0.3, -mvPosition.z) : 0.0;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SPLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAge;
#include <fog_pars_fragment>
void main() {
  // a ripple on the ground: a flattened ring that widens and fades
  vec2 c = (gl_PointCoord - 0.5) * 2.0;
  c.y *= 2.4;
  float r = length(c);
  float a = smoothstep(0.3, 0.0, abs(r - (0.1 + vAge * 0.85))) * (1.0 - vAge) * (1.0 - vAge) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
}`;

const LEAF_VERT = /* glsl */ `
attribute vec4 aLeaf;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uOff;
uniform float uTime;
uniform float uAmount;
uniform float uScale;
varying float vRot;
varying float vSeed;
${ROOF_GLSL}
#include <fog_pars_vertex>
void main() {
  float s = aLeaf.w;
  vec3 p = aLeaf.xyz * uBox + uOff * (0.7 + 0.6 * s);
  // tumble: bob and weave on the way past
  p.y += sin(uTime * (1.3 + s * 2.0) + s * 40.0) * 0.9;
  p.x += sin(uTime * (0.9 + s) + s * 17.0) * 0.7;
  vec3 hb = uBox * vec3(0.5, 0.2, 0.5);
  vec3 rel = mod(p - uCam + hb, uBox) - hb;
  vec3 wp = uCam + rel;
  float fade = smoothstep(0.7, 1.6, length(rel)) * (1.0 - smoothstep(0.6, 1.0, length(rel.xz) / hb.x));
  if (s > uAmount || fade < 0.3 || underRoof(wp)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vRot = uTime * (3.0 + s * 7.0) + s * 20.0;
  vSeed = s;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_PointSize = uScale * (0.08 + 0.09 * fract(s * 7.3)) * fade / max(0.2, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const LEAF_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vRot;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float cs = cos(vRot);
  float sn = sin(vRot);
  c = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);
  c.x /= max(0.15, abs(sin(vRot * 0.63 + vSeed * 9.0))); // flipping over
  if (length(c * vec2(1.0, 2.1)) > 0.5) discard;
  gl_FragColor = vec4(uColor * (0.6 + 0.8 * fract(vSeed * 13.7)), 1.0);
  #include <fog_fragment>
}`;

const QUALITY_DROPS = { low: 4000, medium: 8000, high: 12000 };
const SPLASHES = 200;
const SPLASH_LIFE = 0.28;
const LEAVES = 420;
const BOLT_SHAPES = 6;
const BOLT_POOL = 3;
const BOLT_HEIGHT = 170; // cloud base above the strike point (m)
const BOLT_REACH = 400; // bolts farther than this are drawn at this distance, scaled to keep their size

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a jagged channel from the cloud base (y = 1) to the ground (y = 0) with a few forks, as flat ribbons
// in the XY plane (the mesh is turned to face the camera). Each ribbon vertex carries its centre point and
// its offset direction, so the shader can keep the channel a couple of pixels wide at any distance; a wide
// dim ribbon under each stroke is the glow.
function boltGeometry(seed) {
  const rng = rngFrom(seed);
  const pos = [];
  const off = [];
  const col = [];
  const ribbon = (pts, w, b) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l = Math.hypot(dx, dy) || 1;
      const nx = (-dy / l) * w;
      const ny = (dx / l) * w;
      // two triangles: (p0-, p0+, p1+) (p0-, p1+, p1-)
      for (const [x, y, s] of [[x0, y0, -1], [x0, y0, 1], [x1, y1, 1], [x0, y0, -1], [x1, y1, 1], [x1, y1, -1]]) {
        pos.push(x, y, 0);
        off.push(nx * s, ny * s);
        col.push(b, b, b);
      }
    }
  };
  const channel = (x, y, ex, ey, n, jag) => {
    const pts = [[x, y]];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([x + (ex - x) * t + (rng() - 0.5) * jag, y + (ey - y) * t + (rng() - 0.5) * jag * 0.3]);
    }
    pts.push([ex, ey]);
    return pts;
  };
  const main = channel(0, 1, (rng() - 0.5) * 0.3, 0, 22, 0.07);
  ribbon(main, 7, 0.05);
  ribbon(main, 1, 1);
  const forks = 2 + Math.floor(rng() * 3);
  for (let f = 0; f < forks; f++) {
    const k = 2 + Math.floor(rng() * 12);
    const [x, y] = main[k];
    const side = rng() < 0.5 ? -1 : 1;
    const len = 0.15 + rng() * 0.3;
    const pts = channel(x, y, x + side * len * (0.4 + rng() * 0.6), y - len, 7, 0.05);
    ribbon(pts, 4, 0.035);
    ribbon(pts, 0.55, 0.6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const BOLT_VERT = /* glsl */ `
attribute vec2 aOff;
attribute vec3 color;
uniform float uWidth; // half-width of the core stroke, in the bolt's unit space
varying vec3 vColor;
void main() {
  vColor = color;
  vec3 p = position + vec3(aOff * uWidth, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const BOLT_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(uColor * vColor, 1.0);
}`;

export class WeatherFX {
  constructor(scene, quality = 'medium') {
    this.scene = scene;
    this.roofA = [];
    this.roofB = [];
    for (let i = 0; i < ROOFS; i++) {
      this.roofA.push(new THREE.Vector4());
      this.roofB.push(new THREE.Vector4(0, 0, -1e5, 0));
    }
    const roofUniforms = { uRoofA: { value: this.roofA }, uRoofB: { value: this.roofB } };

    // ---- rain
    const maxDrops = QUALITY_DROPS.high;
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const drops = new Float32Array(maxDrops * 4);
    for (let i = 0; i < drops.length; i++) drops[i] = Math.random();
    quad.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 4));
    quad.instanceCount = 0;
    this.rainGeo = quad;
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uCam: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(30, 20, 30) },
          uOff: { value: new THREE.Vector3() },
          uDir: { value: new THREE.Vector3(0, -1, 0) },
          uLen: { value: 0.55 },
          uWidth: { value: 0.011 },
          uPx: { value: 0.001 },
          uFwd: { value: new THREE.Vector3(0, 0, -1) },
          uBeam: { value: 0 },
          uColor: { value: new THREE.Color() },
          uBeamColor: { value: new THREE.Color(0.55, 0.52, 0.46) },
          uOpacity: { value: 0.3 },
        },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    Object.assign(this.rainMat.uniforms, roofUniforms);
    this.rain = new THREE.Mesh(quad, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 4;
    this.rain.visible = false;
    scene.add(this.rain);
    this.rainOff = this.rainMat.uniforms.uOff.value;

    // ---- splashes
    const spos = new Float32Array(SPLASHES * 3);
    const sbirth = new Float32Array(SPLASHES).fill(-100);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3).setUsage(THREE.DynamicDrawUsage));
    sgeo.setAttribute('aBirth', new THREE.BufferAttribute(sbirth, 1).setUsage(THREE.DynamicDrawUsage));
    this.splashGeo = sgeo;
    this.splashMat = new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uLife: { value: SPLASH_LIFE }, uScale: { value: 600 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.5 } },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.splashes = new THREE.Points(sgeo, this.splashMat);
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 4;
    this.splashes.visible = false;
    scene.add(this.splashes);
    this.splashK = 0;
    this.splashAcc = 0;

    // ---- leaves
    const leaf = new Float32Array(LEAVES * 4);
    for (let i = 0; i < leaf.length; i++) leaf[i] = Math.random();
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LEAVES * 3), 3));
    lgeo.setAttribute('aLeaf', new THREE.BufferAttribute(leaf, 4));
    this.leafMat = new THREE.ShaderMaterial({
      vertexShader: LEAF_VERT,
      fragmentShader: LEAF_FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uCam: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(40, 14, 40) },
          uOff: { value: new THREE.Vector3() },
          uTime: { value: 0 },
          uAmount: { value: 0 },
          uScale: { value: 600 },
          uColor: { value: new THREE.Color() },
        },
      ]),
      fog: true,
    });
    Object.assign(this.leafMat.uniforms, roofUniforms);
    this.leaves = new THREE.Points(lgeo, this.leafMat);
    this.leaves.frustumCulled = false;
    this.leaves.visible = false;
    scene.add(this.leaves);
    this.leafOff = this.leafMat.uniforms.uOff.value;

    // ---- lightning bolts
    this.boltShapes = [];
    for (let i = 0; i < BOLT_SHAPES; i++) this.boltShapes.push(boltGeometry(1013 + i * 7919));
    this.bolts = [];
    for (let i = 0; i < BOLT_POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: BOLT_VERT,
        fragmentShader: BOLT_FRAG,
        uniforms: { uWidth: { value: 0.003 }, uColor: { value: new THREE.Color() } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(this.boltShapes[i], mat);
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 5;
      scene.add(m);
      this.bolts.push({ mesh: m, strike: null, t0: 0, gain: 0 });
    }
    this.boltK = 0;

    this._fwd = new THREE.Vector3();
    this._c = new THREE.Color();
    this.roofAt = { x: 1e9, z: 1e9 };
    this.setQuality(quality);
  }

  setQuality(q) {
    this.maxDrops = QUALITY_DROPS[q] || QUALITY_DROPS.medium;
  }

  setWorld(world, weather) {
    this.world = world;
    this.weather = weather;
    this.roofAt.x = 1e9;
  }

  // the roofs nearest the camera go to the shaders (re-picked every few meters)
  _pickRoofs(cam) {
    if (Math.hypot(cam.x - this.roofAt.x, cam.z - this.roofAt.z) < 4) return;
    this.roofAt.x = cam.x;
    this.roofAt.z = cam.z;
    const roofs = this.world?.roofs || [];
    const near = this._near || (this._near = []);
    near.length = 0;
    for (const r of roofs) {
      const d = Math.hypot(r.x - cam.x, r.z - cam.z) - Math.hypot(r.hx, r.hz);
      if (d < 36) near.push([d, r]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < ROOFS; i++) {
      const r = near[i]?.[1];
      if (r) {
        this.roofA[i].set(r.x, r.z, r.c, r.s);
        this.roofB[i].set(r.hx, r.hz, r.y, r.rise);
      } else {
        this.roofA[i].set(0, 0, 1, 0);
        this.roofB[i].set(0, 0, -1e5, 0);
      }
    }
  }

  // a strike's light arrived: show its bolt (cloud-to-ground strikes only)
  strike(s, camPos) {
    if (!s.bolt || !this.world) return;
    const b = this.bolts[this.boltK];
    this.boltK = (this.boltK + 1) % this.bolts.length;
    b.mesh.geometry = this.boltShapes[s.seed % BOLT_SHAPES];
    b.strike = s;
    b.t0 = this._time;
    const dx = s.x - camPos.x;
    const dz = s.z - camPos.z;
    const d = Math.hypot(dx, dz);
    const gy = this.world.heightAt(s.x, s.z);
    const k = d > BOLT_REACH ? BOLT_REACH / d : 1;
    b.mesh.position.set(camPos.x + dx * k, camPos.y + (gy - camPos.y) * k, camPos.z + dz * k);
    b.mesh.scale.setScalar(BOLT_HEIGHT * k);
    b.mesh.rotation.set(0, Math.atan2(-dx, -dz), 0);
    // about the same few pixels wide near or far (the unit-space width grows with distance)
    b.mesh.material.uniforms.uWidth.value = (Math.max(60, d) * 0.0018) / BOLT_HEIGHT;
    b.dist = d;
    b.mesh.visible = true;
  }

  // w: weather state. env: Environment. flashOn: local flashlight. viewH: drawing-buffer height (px).
  update(dt, time, camera, w, env, flashOn, viewH) {
    this._time = time;
    const cam = camera.position;
    const fovK = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const scale = viewH / fovK;
    camera.getWorldDirection(this._fwd);
    const cur = env.cur;
    const rainOn = w.rain > 0.01;
    const leavesOn = w.wind > 0.55;
    if (rainOn || leavesOn) this._pickRoofs(cam);
    const flashTint = Math.min(1.2, w.flash);

    // ---- rain
    this.rain.visible = rainOn;
    if (rainOn) {
      const u = this.rainMat.uniforms;
      const fall = 10.5;
      const wx = w.windX * w.wind * 7;
      const wz = w.windZ * w.wind * 7;
      this.rainOff.x += wx * dt;
      this.rainOff.y -= fall * dt;
      this.rainOff.z += wz * dt;
      const speed = Math.hypot(wx, fall, wz);
      u.uDir.value.set(wx / speed, -fall / speed, wz / speed);
      u.uLen.value = speed * 0.052;
      u.uCam.value.copy(cam);
      u.uPx.value = fovK / viewH;
      u.uFwd.value.copy(this._fwd);
      u.uBeam.value = flashOn ? 1 : 0;
      // drops pick up the sky's light; lightning makes every one of them flare
      u.uColor.value.copy(cur.horizon).multiplyScalar(1.1).add(this._c.copy(cur.hemiSky).multiplyScalar(cur.hemi * 0.02));
      u.uColor.value.r += 0.5 * flashTint;
      u.uColor.value.g += 0.54 * flashTint;
      u.uColor.value.b += 0.66 * flashTint;
      u.uOpacity.value = 0.3 + 0.14 * w.rain;
      this.rainGeo.instanceCount = Math.ceil(this.maxDrops * Math.min(1, w.rain));
    } else {
      this.rainOff.set(0, 0, 0); // restart the clock while dry (keeps the float offsets small)
    }

    // ---- splashes
    const spl = rainOn && this.world && this.weather;
    this.splashes.visible = !!spl;
    if (spl) {
      const u = this.splashMat.uniforms;
      u.uTime.value = time;
      u.uScale.value = scale;
      u.uColor.value.copy(this.rainMat.uniforms.uColor.value).multiplyScalar(0.8);
      u.uOpacity.value = 0.18 + 0.14 * w.rain;
      this.splashAcc += (SPLASHES / SPLASH_LIFE) * Math.min(1, w.rain) * dt;
      const pos = this.splashGeo.attributes.position;
      const birth = this.splashGeo.attributes.aBirth;
      let n = 0;
      while (this.splashAcc >= 1 && n < 40) {
        this.splashAcc -= 1;
        n++;
        const i = this.splashK;
        this.splashK = (i + 1) % SPLASHES;
        // mostly ahead of the camera, where they can be seen
        const a = Math.atan2(this._fwd.x, this._fwd.z) + (Math.random() - 0.5) * 2.4;
        const r = 1.5 + Math.random() * 12;
        const x = cam.x + Math.sin(a) * r;
        const z = cam.z + Math.cos(a) * r;
        const y = this.world.heightAt(x, z) + 0.03;
        pos.array[i * 3] = x;
        pos.array[i * 3 + 1] = y;
        pos.array[i * 3 + 2] = z;
        birth.array[i] = this.weather.coverAt(x, y + 0.5, z) ? -100 : time - Math.random() * 0.05;
      }
      if (n) {
        pos.needsUpdate = true;
        birth.needsUpdate = true;
      }
    }

    // ---- leaves
    this.leaves.visible = leavesOn;
    if (leavesOn) {
      const u = this.leafMat.uniforms;
      const v = 3 + w.wind * 8;
      this.leafOff.x += w.windX * v * dt;
      this.leafOff.z += w.windZ * v * dt;
      this.leafOff.y -= 0.4 * dt;
      u.uCam.value.copy(cam);
      u.uTime.value = time;
      u.uScale.value = scale;
      u.uAmount.value = Math.min(1, (w.wind - 0.55) / 0.5);
      // dry leaves and needles, lit like everything else
      u.uColor.value.setRGB(0.16, 0.12, 0.06).multiply(this._c.copy(cur.hemiSky).multiplyScalar(cur.hemi * 1.1));
      u.uColor.value.r += 0.2 * flashTint;
      u.uColor.value.g += 0.21 * flashTint;
      u.uColor.value.b += 0.26 * flashTint;
    }

    // ---- lightning bolts: flicker with their strike's return strokes
    for (const b of this.bolts) {
      if (!b.mesh.visible) continue;
      const age = time - b.t0;
      if (age > 1.2) {
        b.mesh.visible = false;
        continue;
      }
      // haze swallows distant bolts, but never completely
      const e = pulseEnvelope(b.strike.pulseList || [[0, 1]], age);
      const att = Math.max(0.3, Math.exp(-b.dist * env.fog.density * 0.12));
      b.mesh.material.uniforms.uColor.value.setRGB(7, 7.4, 9).multiplyScalar(e * att);
    }
  }
}
