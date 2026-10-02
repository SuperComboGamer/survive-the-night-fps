// Visual effects: pooled CPU-simulated particles rendered as two Points draw calls (additive + alpha)
// sharing a sprite atlas, ground decals (instanced), gibs (instanced), bullet tracers, muzzle flashes, explosions and
// continuous emitters (campfire, torches, molotov fires, acid pools, supply-drop smoke).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { IMPACT } from '../../shared/defs.js';
import { raycastWorld } from '../../shared/collision.js';
import { getTexture } from './textures.js';

// atlas cells (3x3)
export const TEX = { FIRE: 0, SMOKE: 1, SPARK: 2, BLOOD: 3, GLOW: 4, MUZZLE: 5, DUST: 6 };
// added to a cell: the particle is lit like a body (by the sky's light level, or by the local flashlight when its beam
// is on it) instead of getting the smoke's night tint. Blood uses it: under that tint it glowed in the dark and went
// a dull grey-pink in the beam
const LIT = 16;
const TORCH_GAIN = 0.3; // how much of the flashlight a drop of blood throws back, next to a matt surface facing the lamp
const isSpot = (o) => o.isSpotLight;
const ATLAS_NAMES = ['fx_fire', 'fx_smoke', 'fx_spark', 'fx_blood', 'fx_glow', 'fx_muzzle', 'fx_smoke'];

function buildAtlas() {
  const size = 768;
  const cell = size / 3;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ATLAS_NAMES.forEach((name, i) => {
    const x = (i % 3) * cell;
    const y = Math.floor(i / 3) * cell;
    let img = null;
    try {
      img = getTexture(name)?.image;
    } catch {
      img = null;
    }
    if (img && img.data && !(img instanceof HTMLCanvasElement)) {
      // DataTexture ({data,width,height}, row 0 = top): blit through a temp canvas
      const tc = document.createElement('canvas');
      tc.width = img.width;
      tc.height = img.height;
      const tctx = tc.getContext('2d');
      tctx.putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height), 0, 0);
      img = tc;
    }
    if (img && (img.width || img.naturalWidth)) {
      const w = img.width || img.naturalWidth;
      const h = img.height || img.naturalHeight;
      // fx_fire is a 4x4 animated sheet: take frame 0 (top-left)
      if (name === 'fx_fire') ctx.drawImage(img, 0, 0, w / 4, h / 4, x, y, cell, cell);
      else ctx.drawImage(img, x, y, cell, cell);
    } else {
      const g = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 0, x + cell / 2, y + cell / 2, cell / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

const PVERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aTex;
attribute float aRot;
varying vec4 vColor;
varying float vTex;
varying float vRot;
varying float vLit;
uniform float uScale;
uniform float uLit;
uniform vec4 uTorch;
uniform float uTorchDecay;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vTex = aTex;
  vRot = aRot;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float depth = -mvPosition.z;
  // light on a LIT particle: the sky's level or the local flashlight's beam, whichever is the stronger (cone and
  // falloff as three's SpotLight; the lamp is taken to sit at the eye, looking straight ahead).
  // uTorch: strength, cos(cone), cos(inner cone), reach (m)
  float dist = max(0.3, length(mvPosition.xyz));
  float reach = clamp(1.0 - pow(dist / uTorch.w, 4.0), 0.0, 1.0);
  vLit = max(uLit, uTorch.x * smoothstep(uTorch.y, uTorch.z, depth / dist) * pow(dist, -uTorchDecay) * reach * reach);
  // particles right in front of the lens fade out instead of filling the screen
  vColor.a *= smoothstep(0.35, 1.6, depth);
  gl_PointSize = min(aSize * uScale / max(0.1, depth), 420.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const PFRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTint;
varying vec4 vColor;
varying float vTex;
varying float vRot;
varying float vLit;
#include <fog_pars_fragment>
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float c = cos(vRot); float s = sin(vRot);
  pc = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y) + 0.5;
  if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) discard;
  float cell = floor(vTex + 0.5);
  float lit = step(${LIT - 0.5}, cell);
  cell -= ${LIT}.0 * lit;
  vec2 uv = (vec2(mod(cell, 3.0), 2.0 - floor(cell / 3.0)) + vec2(pc.x, 1.0 - pc.y)) / 3.0;
  vec4 t = texture2D(uAtlas, uv);
  vec4 col = t * vColor;
  col.rgb *= mix(uTint, vLit, lit);
  if (col.a < 0.004) discard;
  gl_FragColor = col;
  #include <fog_fragment>
}`;

class ParticlePool {
  constructor(max, additive, atlas, scene) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.tex = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aTex = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aTex', this.aTex);
    geo.setAttribute('aRot', this.aRot);
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: PVERT,
      fragmentShader: PFRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null }, uScale: { value: 600 }, uTint: { value: 1 }, uLit: { value: 1 }, uTorch: { value: new THREE.Vector4(0, 0.9, 1, 50) }, uTorchDecay: { value: 1 } }]),
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.material.uniforms.uAtlas.value = atlas;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    this.geo = geo;
    scene.add(this.points);
  }

  // p: {x,y,z, vx,vy,vz, life, size, size1, r,g,b,a, r1,g1,b1,a1, grav, drag, tex, spin}
  // 20 positional arguments, then the optional spin. One number too many still runs: it takes the tex slot (0 = FIRE)
  // and the TEX.* constant lands in spin, so count them
  emit(x, y, z, vx, vy, vz, life, size, size1, r, g, b, a, r1, g1, b1, a1, grav, drag, tex, spin = 0) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size1[i] = size1;
    this.c0[i * 4] = r;
    this.c0[i * 4 + 1] = g;
    this.c0[i * 4 + 2] = b;
    this.c0[i * 4 + 3] = a;
    this.c1[i * 4] = r1;
    this.c1[i * 4 + 1] = g1;
    this.c1[i * 4 + 2] = b1;
    this.c1[i * 4 + 3] = a1;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.tex[i] = tex;
    this.rot[i] = Math.random() * 6.283;
    this.spin[i] = spin;
  }

  update(dt, pixelScale) {
    this.material.uniforms.uScale.value = pixelScale;
    let n = this.count;
    const P = this.pos;
    const V = this.vel;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        if (i !== n) this._move(n, i);
        i--;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      V[i * 3] *= d;
      V[i * 3 + 1] = V[i * 3 + 1] * d - this.grav[i] * dt;
      V[i * 3 + 2] *= d;
      P[i * 3] += V[i * 3] * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += V[i * 3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    this.count = n;
    const ap = this.aPos.array;
    const as = this.aSize.array;
    const ac = this.aColor.array;
    const at = this.aTex.array;
    const ar = this.aRot.array;
    for (let i = 0; i < n; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];
      ap[i * 3] = P[i * 3];
      ap[i * 3 + 1] = P[i * 3 + 1];
      ap[i * 3 + 2] = P[i * 3 + 2];
      as[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      for (let c = 0; c < 4; c++) ac[i * 4 + c] = this.c0[i * 4 + c] + (this.c1[i * 4 + c] - this.c0[i * 4 + c]) * t;
      at[i] = this.tex[i];
      ar[i] = this.rot[i];
    }
    this.geo.setDrawRange(0, n);
    if (n) {
      this.aPos.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.aColor.needsUpdate = true;
      this.aTex.needsUpdate = true;
      this.aRot.needsUpdate = true;
    }
  }

  _move(from, to) {
    for (let c = 0; c < 3; c++) {
      this.pos[to * 3 + c] = this.pos[from * 3 + c];
      this.vel[to * 3 + c] = this.vel[from * 3 + c];
    }
    for (let c = 0; c < 4; c++) {
      this.c0[to * 4 + c] = this.c0[from * 4 + c];
      this.c1[to * 4 + c] = this.c1[from * 4 + c];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
    this.tex[to] = this.tex[from];
    this.rot[to] = this.rot[from];
    this.spin[to] = this.spin[from];
  }
}

class DecalPool {
  constructor(scene, texName, max, color, opacity, blending = THREE.NormalBlending) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    let map = null;
    try {
      map = getTexture(texName);
    } catch {
      map = null;
    }
    const mat = new THREE.MeshLambertMaterial({ map, color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, blending });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.max = max;
    this.next = 0;
    this.ages = new Float32Array(max);
    this.scales = new Float32Array(max);
    this.data = new Float32Array(max * 4); // x,y,z,rot
    this.life = 60;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }
  add(x, y, z, size) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    this.ages[i] = 0;
    this.scales[i] = size;
    this.data[i * 4] = x;
    this.data[i * 4 + 1] = y;
    this.data[i * 4 + 2] = z;
    this.data[i * 4 + 3] = Math.random() * 6.283;
    this._write(i, 0.3);
  }
  _write(i, grow) {
    const s = this.scales[i] * grow;
    this._q.setFromAxisAngle(this._up, this.data[i * 4 + 3]);
    this._p.set(this.data[i * 4], this.data[i * 4 + 1], this.data[i * 4 + 2]);
    this._s.set(s, 1, s);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    for (let i = 0; i < this.mesh.count; i++) {
      const a = this.ages[i];
      if (a > this.life + 5) continue;
      this.ages[i] = a + dt;
      if (a < 0.6) this._write(i, 0.3 + (a / 0.6) * 0.7);
      else if (a > this.life) this._write(i, Math.max(0.001, 1 - (a - this.life) / 5));
    }
  }
}

// ---------------------------------------------------------------- gibs
// What is left of a body blown apart by an overkill hit: instanced pieces that tumble, bounce off the world, come to
// rest lying flat and then sink away like the corpses do. Unit-sized shapes, vertex colours for the gore; the
// instance colour gives a piece its hue (blood or acid for the meat, skin / cloth / bone for a limb).
const GIB_GRAV = 20;
const GIB_SINK = 1.5; // seconds a piece takes to sink away once its time is up
const _gray = { t: -1, col: null, terrain: false };

function paintVerts(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) fn(pos.getX(i), pos.getY(i), pos.getZ(i), col, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
const paint = (col, o, r, g, b) => {
  col[o] = r;
  col[o + 1] = g;
  col[o + 2] = b;
};

// a ragged lump of meat, flatter than it is wide
function lumpGeometry() {
  let g = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.2 * Math.sin(x * 3.1 + 1.3) * Math.sin(z * 2.7 + 0.4) + 0.14 * Math.sin(y * 4.3 + x * 2.1);
    p.setXYZ(i, x * k, y * k * 0.6, z * k);
  }
  g.computeVertexNormals();
  return paintVerts(g, (x, y, z, col, o) => {
    const s = 0.6 + 0.4 * Math.sin(x * 5.3 + y * 3.9 + z * 4.7);
    paint(col, o, s, s, s);
  });
}

// a torn-off length of limb along X: a knuckle of hand / foot (or the head of a bone) at +X, a raw stump with the
// bone showing at -X
function limbGeometry() {
  const g = new THREE.CylinderGeometry(0.72, 1, 1, 7, 3);
  g.rotateZ(-Math.PI / 2);
  paintVerts(g, (x, y, z, col, o) => {
    if (x < -0.4) paint(col, o, 1.1, 0.1, 0.08);
    else if (x < -0.1) paint(col, o, 1, 0.5, 0.45);
    else paint(col, o, 1, 1, 1);
  });
  const bone = new THREE.CylinderGeometry(0.3, 0.34, 0.26, 5);
  bone.rotateZ(Math.PI / 2);
  bone.translate(-0.58, 0, 0);
  paintVerts(bone, (x, y, z, col, o) => paint(col, o, 1.7, 1.6, 1.4));
  const end = new THREE.SphereGeometry(1, 7, 5);
  end.scale(0.2, 1.05, 1.3);
  end.translate(0.56, 0, 0);
  paintVerts(end, (x, y, z, col, o) => paint(col, o, 0.9, 0.9, 0.9));
  return mergeGeometries([g, bone, end]);
}

// a severed head: face towards -Z, a raw neck underneath
function headGeometry() {
  const g = new THREE.SphereGeometry(1, 12, 7);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setXYZ(i, p.getX(i) * 0.82 * (y < 0 ? 1 + y * 0.25 : 1), y, p.getZ(i) * 0.95);
  }
  g.computeVertexNormals();
  return paintVerts(g, (x, y, z, col, o) => {
    if (y < -0.75) paint(col, o, 1.1, 0.1, 0.08); // neck
    else if (y > 0.5 || (z > 0.25 && y > 0)) paint(col, o, 0.22, 0.2, 0.18); // hair
    else if (z < -0.6 && y > 0.1 && Math.abs(x) > 0.2) paint(col, o, 0.1, 0.08, 0.08); // eye sockets
    else if (z < -0.6 && y < -0.5 && Math.abs(x) < 0.2) paint(col, o, 0.35, 0.05, 0.05); // mouth
    else paint(col, o, 1, 1, 1);
  });
}

class GibPool {
  // sit: how much of a piece's half thickness stays above the ground when it lies there
  constructor(scene, geo, material, max, sit = 0.75) {
    this.sit = sit;
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.max = max;
    this.next = 0;
    this.state = new Uint8Array(max); // 0 free, 1 flying, 2 landed
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3); // roll about its length, yaw, pitch (applied yaw * pitch * roll)
    this.spin = new Float32Array(max * 3);
    this.scale = new Float32Array(max * 3);
    this.rad = new Float32Array(max); // half its thickness: how high its centre rests above the ground
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.rest = new Float32Array(max); // seconds since it landed for good
    this.trail = new Float32Array(max);
    this.bounces = new Uint8Array(max);
    this.green = new Uint8Array(max);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, this._c);
    }
    scene.add(this.mesh);
  }

  // a piece at (x,y,z) thrown with velocity v: sx = length, sy/sz = thickness, (r,g,b) its hue (sRGB)
  add(x, y, z, vx, vy, vz, sx, sy, sz, r, g, b, green) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    const k = i * 3;
    this.state[i] = 1;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    for (let c = 0; c < 3; c++) {
      this.rot[k + c] = Math.random() * 6.283;
      this.spin[k + c] = (Math.random() - 0.5) * 22;
    }
    this.scale[k] = sx;
    this.scale[k + 1] = sy;
    this.scale[k + 2] = sz;
    this.rad[i] = Math.min(sy, sz) * this.sit;
    this.age[i] = 0;
    this.life[i] = 8 + Math.random() * 3;
    this.rest[i] = 0;
    this.trail[i] = Math.random() * 0.07;
    this.bounces[i] = 0;
    this.green[i] = green ? 1 : 0;
    this.mesh.setColorAt(i, this._c.setRGB(r, g, b, THREE.SRGBColorSpace));
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt, fx) {
    const world = fx.world;
    const P = this.pos, V = this.vel, R = this.rot, W = this.spin;
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      const st = this.state[i];
      if (!st) continue;
      const k = i * 3;
      const rad = this.rad[i];
      const age = (this.age[i] += dt);
      let size = 1;
      let sink = 0;
      if (st === 1) {
        V[k + 1] -= GIB_GRAV * dt;
        const mx = V[k] * dt, my = V[k + 1] * dt, mz = V[k + 2] * dt;
        const len = Math.hypot(mx, my, mz);
        let floor = null; // height of what it came down on
        let wall = false;
        if (len > 1e-6) {
          raycastWorld(world, P[k], P[k + 1] - rad, P[k + 2], mx / len, my / len, mz / len, len, _gray);
          const c = _gray.col;
          // (the ground is checked below; a piece that starts inside something just falls out of it)
          if (c && _gray.t > 1e-3) {
            const hy = P[k + 1] - rad + (my / len) * _gray.t;
            if (my < 0 && hy > c.y1 - 0.08) {
              floor = hy;
              P[k] += mx * (_gray.t / len);
              P[k + 2] += mz * (_gray.t / len);
            } else wall = true;
          }
        }
        if (wall) {
          V[k] *= -0.3;
          V[k + 2] *= -0.3;
          P[k + 1] += my;
        } else if (floor === null) {
          P[k] += mx;
          P[k + 1] += my;
          P[k + 2] += mz;
        }
        const gy = world.heightAt(P[k], P[k + 2]);
        if (floor === null && P[k + 1] - rad <= gy) floor = gy;
        for (let c = 0; c < 3; c++) R[k + c] += W[k + c] * dt;
        if (age < 0.9 && (this.trail[i] -= dt) <= 0) {
          this.trail[i] = 0.07;
          fx.gibDrip(P[k], P[k + 1], P[k + 2], this.green[i]);
        }
        if (floor !== null) {
          P[k + 1] = floor + rad;
          if (!this.bounces[i]) fx.gibSplat(P[k], floor, P[k + 2], this.green[i]);
          if (V[k + 1] < -3 && this.bounces[i] < 2) {
            this.bounces[i]++;
            V[k] *= 0.55;
            V[k + 1] *= -0.32;
            V[k + 2] *= 0.55;
            for (let c = 0; c < 3; c++) W[k + c] *= 0.5;
          } else {
            this.state[i] = 2;
          }
        }
      } else {
        const over = age - this.life[i];
        if (over >= GIB_SINK) {
          this.state[i] = 0;
          size = 0;
        } else if (over > 0) {
          size = 1 - (over / GIB_SINK) * 0.6;
          sink = over * 0.2;
        } else if (this.rest[i] > 0.4) continue; // lying still
        else {
          // it flops over onto its side
          this.rest[i] += dt;
          const e = Math.min(1, dt * 16);
          R[k] += (Math.round(R[k] / Math.PI) * Math.PI - R[k]) * e;
          R[k + 2] += (Math.round(R[k + 2] / Math.PI) * Math.PI - R[k + 2]) * e;
        }
      }
      this._q.setFromEuler(this._e.set(R[k], R[k + 1], R[k + 2], 'YZX'));
      this._p.set(P[k], P[k + 1] - sink, P[k + 2]);
      this._s.set(this.scale[k] * size, this.scale[k + 1] * size, this.scale[k + 2] * size);
      this.mesh.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, vmScene, world) {
    this.scene = scene;
    this.world = world;
    this.atlas = buildAtlas();
    this.add = new ParticlePool(2000, true, this.atlas, scene);
    this.alpha = new ParticlePool(3000, false, this.atlas, scene);
    this.blood = new DecalPool(scene, 'decal_blood', 90, 0x7a0a0a, 0.95);
    this.acid = new DecalPool(scene, 'decal_acid', 24, 0x6aff3a, 0.85);
    this.acid.life = 7;
    this.scorch = new DecalPool(scene, 'decal_scorch', 30, 0x111111, 0.85);
    // gibs: meat, limbs (and bare bones), heads
    const gibMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.gibLumps = new GibPool(scene, lumpGeometry(), gibMat, 110);
    this.gibLimbs = new GibPool(scene, limbGeometry(), gibMat, 70);
    this.gibHeads = new GibPool(scene, headGeometry(), gibMat, 14, 0.95);
    this.gibLoad = 0; // bodies blown apart lately: a crowd going up at once throws fewer pieces each
    // tracers
    this.tracerMax = 64;
    const tg = new THREE.BufferGeometry();
    this.tPos = new Float32Array(this.tracerMax * 6);
    this.tCol = new Float32Array(this.tracerMax * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo = tg;
    this.tracerLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    this.tracerLines.frustumCulled = false;
    scene.add(this.tracerLines);
    this.tracers = [];
    // viewmodel muzzle flash sprite
    let muzzleTex = null;
    try {
      muzzleTex = getTexture('fx_muzzle');
    } catch {
      muzzleTex = null;
    }
    this.vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzleTex, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    this.vmFlash.visible = false;
    this.vmFlash.renderOrder = 10;
    vmScene.add(this.vmFlash);
    this.vmFlashT = 0;
    // world muzzle flashes (remote players)
    this.wFlashes = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzleTex, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
      s.visible = false;
      scene.add(s);
      this.wFlashes.push({ s, t: 0 });
    }
    this.emitters = new Set();
    this.shake = 0;
    this.time = 0;
  }

  rnd(a, b) {
    return a + Math.random() * (b - a);
  }

  // ---------------------------------------------------------------- one-shots
  // one drop of blood (green: acid blood): dark, each its own shade, lit like the body it left. It shrinks away rather
  // than fading out, so it is red to the end instead of going pink over whatever is behind it
  drop(x, y, z, vx, vy, vz, life, size, green, grav, drag) {
    const k = this.rnd(0.6, 1);
    this.alpha.emit(x, y, z, vx, vy, vz, life, size, size * 0.3, (green ? 0.15 : 0.34) * k, (green ? 0.3 : 0.006) * k, (green ? 0.035 : 0.008) * k, 1, green ? 0.08 : 0.16, green ? 0.16 : 0, 0, 0.8, grav, drag, TEX.BLOOD + LIT, this.rnd(-4, 4));
  }
  // the red (green) haze a burst of it leaves hanging for a moment
  mist(x, y, z, vx, vy, vz, life, size, size1, green) {
    this.alpha.emit(x, y, z, vx, vy, vz, life, size, size1, green ? 0.06 : 0.12, green ? 0.12 : 0.003, green ? 0.015 : 0.004, 0.55, green ? 0.03 : 0.06, green ? 0.06 : 0, 0, 0, 0, 3, TEX.SMOKE + LIT);
  }

  impact(kind, x, y, z, nx, ny, nz) {
    const A = this.alpha;
    const D = this.add;
    switch (kind) {
      case IMPACT.BLOOD:
      case IMPACT.GREEN_BLOOD: {
        const g = kind === IMPACT.GREEN_BLOOD;
        // a spit of small drops back out of the wound (the normal points back along the shot), a splash and a puff of
        // mist where it struck: gone in under half a second, and never big enough to hide what was hit. Past 5 m the
        // drops are drawn bigger (twice the size by 15 m): at their true size a hit across the road is a pixel or two
        const e = this.eye;
        const far = e ? 1 + Math.min(1, Math.max(0, (Math.hypot(x - e.x, y - e.y, z - e.z) - 5) / 10)) : 1;
        for (let i = 0; i < 9; i++) {
          const s = this.rnd(0.8, 4);
          const vx = nx * s + this.rnd(-1.1, 1.1), vy = ny * s + this.rnd(-0.4, 1.8), vz = nz * s + this.rnd(-1.1, 1.1);
          const t = this.rnd(0, 0.03); // a head start, so the very first frame is a spray and not a dot
          this.drop(x + vx * t, y + vy * t, z + vz * t, vx, vy, vz, this.rnd(0.22, 0.45), this.rnd(0.06, 0.13) * far, g, 11, 3);
        }
        this.drop(x, y, z, nx * 0.5, ny * 0.5, nz * 0.5, 0.14, 0.26 * far, g, 0, 0);
        this.mist(x, y, z, nx * 0.8, 0.3, nz * 0.8, 0.28, 0.2, 0.55, g);
        if (Math.random() < 0.55) {
          const gy = this.world.heightAt(x, z);
          if (y - gy < 2.2) (g ? this.acid : this.blood).add(x + this.rnd(-0.5, 0.5), gy + 0.03, z + this.rnd(-0.5, 0.5), this.rnd(0.5, 1.3));
        }
        break;
      }
      case IMPACT.DIRT:
        for (let i = 0; i < 7; i++) A.emit(x, y, z, nx * 2 + this.rnd(-1, 1), this.rnd(1, 3.5), nz * 2 + this.rnd(-1, 1), this.rnd(0.4, 0.9), 0.08, 0.12, 0.25, 0.2, 0.15, 1, 0.2, 0.17, 0.12, 0, 12, 1, TEX.BLOOD);
        A.emit(x, y, z, nx * 0.6, 0.5, nz * 0.6, 1.2, 0.3, 1.2, 0.42, 0.38, 0.32, 0.5, 0.4, 0.37, 0.33, 0, 0, 2, TEX.SMOKE, 0.5);
        break;
      case IMPACT.WOOD:
        for (let i = 0; i < 8; i++) A.emit(x, y, z, nx * 3 + this.rnd(-1.5, 1.5), this.rnd(0.5, 3), nz * 3 + this.rnd(-1.5, 1.5), this.rnd(0.4, 0.8), 0.08, 0.06, 0.45, 0.33, 0.2, 1, 0.3, 0.22, 0.14, 0.5, 12, 1, TEX.SPARK, 10);
        A.emit(x, y, z, nx * 0.5, 0.3, nz * 0.5, 0.9, 0.2, 0.8, 0.4, 0.35, 0.28, 0.45, 0.35, 0.3, 0.25, 0, 0, 2, TEX.SMOKE);
        break;
      case IMPACT.METAL:
      case IMPACT.SPARK:
        for (let i = 0; i < 12; i++) D.emit(x, y, z, nx * 4 + this.rnd(-3, 3), this.rnd(0, 4), nz * 4 + this.rnd(-3, 3), this.rnd(0.15, 0.4), 0.06, 0.02, 1, 0.8, 0.4, 1, 1, 0.4, 0.1, 0, 14, 0.5, TEX.SPARK);
        D.emit(x, y, z, 0, 0, 0, 0.07, 0.6, 0.2, 1, 0.8, 0.5, 1, 1, 0.6, 0.3, 0, 0, 0, TEX.GLOW);
        break;
      case IMPACT.ACID:
        for (let i = 0; i < 14; i++) A.emit(x, y, z, this.rnd(-2, 2), this.rnd(1, 4), this.rnd(-2, 2), this.rnd(0.4, 0.9), 0.12, 0.2, 0.4, 0.95, 0.2, 0.95, 0.2, 0.6, 0.1, 0, 10, 1, TEX.BLOOD);
        this.acid.add(x, this.world.heightAt(x, z) + 0.04, z, 4.6);
        break;
    }
  }

  explosion(x, y, z, radius, kind) {
    const A = this.alpha;
    const D = this.add;
    if (kind === 1 || kind === 3) {
      // slam / rock: dust ring, debris
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const s = this.rnd(3, 8);
        A.emit(x, y + 0.3, z, Math.cos(a) * s, this.rnd(0.5, 2), Math.sin(a) * s, this.rnd(1, 2), 0.8, 3, 0.35, 0.31, 0.27, 0.7, 0.3, 0.28, 0.25, 0, -0.2, 2, TEX.SMOKE, 0.4);
      }
      for (let i = 0; i < 16; i++) A.emit(x, y + 0.3, z, this.rnd(-5, 5), this.rnd(3, 9), this.rnd(-5, 5), this.rnd(0.6, 1.2), 0.15, 0.1, 0.2, 0.17, 0.13, 1, 0.2, 0.17, 0.13, 1, 14, 0.5, TEX.BLOOD);
      this.shake = Math.max(this.shake, 0.6);
      return;
    }
    const green = kind === 2;
    // flash
    D.emit(x, y, z, 0, 0, 0, 0.18, radius * 2.5, radius * 4, 1, green ? 1 : 0.85, green ? 0.5 : 0.5, 1, 1, 0.4, 0.1, 0, 0, 0, TEX.GLOW);
    for (let i = 0; i < 36; i++) {
      const vx = this.rnd(-1, 1);
      const vy = this.rnd(0.2, 1.2);
      const vz = this.rnd(-1, 1);
      const s = this.rnd(3, 9);
      if (green) A.emit(x, y, z, vx * s, vy * s, vz * s, this.rnd(0.5, 1.2), 0.4, 1.2, 0.5, 0.75, 0.15, 0.9, 0.3, 0.5, 0.1, 0, 6, 2, TEX.BLOOD, 2);
      else D.emit(x, y, z, vx * s, vy * s, vz * s, this.rnd(0.3, 0.8), this.rnd(0.8, 1.6), 0.2, 1, 0.7, 0.3, 1, 0.8, 0.2, 0.05, 0, -1, 2.5, TEX.FIRE, 3);
    }
    for (let i = 0; i < 26; i++) {
      const s = this.rnd(1, 4);
      A.emit(x + this.rnd(-1, 1), y + this.rnd(0, 1), z + this.rnd(-1, 1), this.rnd(-1, 1) * s, this.rnd(0.5, 2) * s * 0.6, this.rnd(-1, 1) * s, this.rnd(2, 4), this.rnd(1, 2), this.rnd(4, 7), green ? 0.25 : 0.12, green ? 0.3 : 0.11, green ? 0.12 : 0.1, 0.75, 0.2, 0.2, 0.2, 0, -0.4, 1.2, TEX.SMOKE, 0.3);
    }
    for (let i = 0; i < 20; i++) D.emit(x, y, z, this.rnd(-12, 12), this.rnd(2, 12), this.rnd(-12, 12), this.rnd(0.5, 1.3), 0.08, 0.04, 1, 0.7, 0.3, 1, 1, 0.3, 0.05, 0, 12, 0.3, TEX.SPARK);
    const gy = this.world.heightAt(x, z);
    if (y - gy < 3) (green ? this.acid : this.scorch).add(x, gy + 0.05, z, radius * 1.1);
    this.shake = Math.max(this.shake, green ? 0.5 : 1);
  }

  structBreak(x, y, z) {
    for (let i = 0; i < 26; i++) this.alpha.emit(x + this.rnd(-1.4, 1.4), y + this.rnd(0.2, 2), z + this.rnd(-1.4, 1.4), this.rnd(-4, 4), this.rnd(1, 6), this.rnd(-4, 4), this.rnd(0.8, 1.6), 0.25, 0.15, 0.4, 0.3, 0.2, 1, 0.3, 0.22, 0.15, 0.8, 14, 0.5, TEX.BLOOD, 6);
    for (let i = 0; i < 10; i++) this.alpha.emit(x + this.rnd(-1.4, 1.4), y + this.rnd(0, 1.5), z + this.rnd(-1.4, 1.4), this.rnd(-1, 1), this.rnd(0.3, 1.2), this.rnd(-1, 1), 1.5, 0.8, 2.4, 0.35, 0.32, 0.28, 0.6, 0.3, 0.3, 0.28, 0, 0, 1.5, TEX.SMOKE);
  }

  // headshot kill: gory burst
  gib(x, y, z, green) {
    // bigger drops, thrown wider and longer in the air than a body hit's: the burst that says the head is gone
    for (let i = 0; i < 24; i++) {
      const s = this.rnd(1, 5);
      this.drop(x, y, z, this.rnd(-1, 1) * s, this.rnd(0, 1.2) * s, this.rnd(-1, 1) * s, this.rnd(0.45, 0.95), this.rnd(0.08, 0.2), green, 12, 1);
    }
    for (let i = 0; i < 2; i++) this.mist(x, y, z, this.rnd(-0.5, 0.5), this.rnd(0.3, 0.9), this.rnd(-0.5, 0.5), 0.45, 0.3, 0.9, green);
    const gy = this.world.heightAt(x, z);
    (green ? this.acid : this.blood).add(x, gy + 0.03, z, 1.6);
  }

  // overkill: the whole body comes apart. (x,y,z) = its feet, h / r = its height and radius, (dx,dz) = the way the blow
  // was travelling. opts: green (acid blood), head (it still had one to lose), limbs, fur (limbs are a dog's legs)
  gibBody(x, y, z, h, r, dx, dz, opts = {}) {
    const green = !!opts.green;
    const mass = Math.max(0.2, Math.min(3, (h / 1.75) * (r / 0.38)));
    const s = Math.sqrt(mass); // size of the pieces
    const few = this.gibLoad > 4 ? 0.5 : 1;
    this.gibLoad++;
    // blood: a burst thrown along the blow, a mist that hangs, a pool where it stood
    for (let i = Math.round((16 + 20 * Math.min(mass, 1.5)) * few); i > 0; i--) {
      const sp = this.rnd(1.5, 7);
      this.drop(x + this.rnd(-r, r) * 0.5, y + this.rnd(0.2, 1) * h, z + this.rnd(-r, r) * 0.5, (dx * 0.6 + this.rnd(-0.6, 0.6)) * sp, this.rnd(0, 1.1) * sp, (dz * 0.6 + this.rnd(-0.6, 0.6)) * sp, this.rnd(0.6, 1.3), this.rnd(0.12, 0.3) * s, green, 11, 0.8);
    }
    for (let i = 0; i < 5; i++) {
      this.mist(x + this.rnd(-r, r), y + this.rnd(0.3, 0.85) * h, z + this.rnd(-r, r), dx * this.rnd(0.4, 2) + this.rnd(-0.6, 0.6), this.rnd(0.2, 1), dz * this.rnd(0.4, 2) + this.rnd(-0.6, 0.6), this.rnd(0.7, 1.2), 0.6 * s, 2 * s, green);
    }
    const gy = this.world.heightAt(x, z);
    if (y - gy < 3) (green ? this.acid : this.blood).add(x + dx * 0.4, gy + 0.03, z + dz * 0.4, this.rnd(1.8, 2.6) * s);
    // the pieces: thrown along the blow, scattered sideways and up
    const toss = (pool, at, sx, sy, sz, cr, cg, cb, lift = 1) => {
      const sp = this.rnd(2, 6.5);
      pool.add(x + this.rnd(-r, r) * 0.6, y + at * h, z + this.rnd(-r, r) * 0.6, dx * sp + this.rnd(-2.6, 2.6), this.rnd(2, 6.5) * lift, dz * sp + this.rnd(-2.6, 2.6), sx, sy, sz, cr, cg, cb, green);
    };
    for (let i = Math.round(Math.min(16, 3 + 5 * mass) * few); i > 0; i--) {
      const size = this.rnd(0.08, 0.16) * s;
      const fat = !green && Math.random() < 0.15; // a paler, fattier piece
      toss(this.gibLumps, this.rnd(0.25, 0.95), size * this.rnd(1, 1.5), size, size * this.rnd(0.8, 1.2), green ? this.rnd(0.17, 0.25) : fat ? 0.42 : this.rnd(0.26, 0.4), green ? this.rnd(0.3, 0.42) : fat ? 0.25 : this.rnd(0.025, 0.045), green ? 0.07 : fat ? 0.2 : 0.03);
    }
    if (opts.limbs) {
      for (let i = 0; i < 4; i++) {
        const leg = i > 1; // a dog's four are all legs
        const len = (opts.fur ? 0.26 : leg ? 0.42 : 0.34) * s;
        const thick = (opts.fur ? 0.035 : leg ? 0.065 : 0.045) * s;
        if (opts.fur) toss(this.gibLimbs, this.rnd(0.2, 0.6), len, thick, thick, 0.2, 0.17, 0.14);
        else if (leg) toss(this.gibLimbs, this.rnd(0.15, 0.45), len, thick, thick, 0.17, 0.18, 0.22); // trouser leg
        else toss(this.gibLimbs, this.rnd(0.6, 0.85), len, thick, thick, 0.4, 0.42, 0.34); // bare, rotten arm
      }
    }
    for (let i = Math.round((1 + 2 * Math.min(mass, 2)) * few); i > 0; i--) {
      const thick = this.rnd(0.016, 0.026) * s;
      toss(this.gibLimbs, this.rnd(0.3, 0.9), this.rnd(0.14, 0.3) * s, thick, thick, 0.6, 0.57, 0.47); // bone
    }
    if (opts.head) {
      const hr = 0.115 * s;
      toss(this.gibHeads, 0.9, hr, hr, hr, 0.4, 0.42, 0.34, 1.2);
    }
  }

  // a flying gib: the drops it trails, the smear where it lands
  gibDrip(x, y, z, green) {
    this.drop(x, y, z, this.rnd(-0.4, 0.4), this.rnd(-0.2, 0.6), this.rnd(-0.4, 0.4), this.rnd(0.35, 0.6), this.rnd(0.08, 0.15), green, 9, 1);
  }
  gibSplat(x, y, z, green) {
    for (let i = 0; i < 3; i++) this.drop(x, y + 0.05, z, this.rnd(-1.2, 1.2), this.rnd(0.6, 2), this.rnd(-1.2, 1.2), this.rnd(0.3, 0.5), this.rnd(0.08, 0.14), green, 10, 1);
    if (Math.random() < (green ? 0.2 : 0.45)) (green ? this.acid : this.blood).add(x, y + 0.03, z, this.rnd(0.35, 0.8));
  }

  // a body on fire: flames licking up it, smoke off the top. h / r = how tall and how wide it is
  burnPuff(x, y, z, h = 1.2, r = 0.3) {
    const s = Math.max(1, r / 0.4);
    this.add.emit(x + this.rnd(-r, r), y + this.rnd(0, h), z + this.rnd(-r, r), 0, this.rnd(1, 2.5), 0, this.rnd(0.3, 0.6), this.rnd(0.5, 0.9) * s, 0.1, 1, 0.55, 0.2, 0.9, 0.9, 0.2, 0.05, 0, -2, 1, TEX.FIRE, 2);
    this.alpha.emit(x, y + h + 0.1, z, this.rnd(-0.3, 0.3), 1.5, this.rnd(-0.3, 0.3), 1.6, 0.5 * s, 1.8 * s, 0.1, 0.09, 0.08, 0.6, 0.15, 0.15, 0.15, 0, -0.2, 0.8, TEX.SMOKE);
  }

  // flamethrower: one puff of the stream leaving (x,y,z) along (dx,dy,dz). dist = how far it gets before it hits
  // something (the puffs die there and the fire splashes off it), cone = the stream's half-angle (rad)
  flameJet(x, y, z, dx, dy, dz, dist, cone = 0.2) {
    const D = this.add;
    const SPEED = 20; // m/s at the nozzle, shed at 1/s: a puff has flown SPEED * (1 - e^-t) after t seconds
    const FULL = SPEED * 0.52; // how far the stream runs in the open
    const reach = Math.min(dist, FULL);
    const life = Math.max(0.12, -Math.log(1 - reach / SPEED));
    const j = cone * 0.6;
    for (let i = 0; i < 7; i++) {
      const s = SPEED * this.rnd(0.82, 1.08);
      // puffs come several times a second: spread each one's fire along the stretch it covers, so the stream is unbroken
      const o = Math.min(reach * 0.5, this.rnd(0, 1.7));
      // white-hot where it overlaps at the nozzle, billowing out orange, gone dark red
      D.emit(x + dx * o, y + dy * o, z + dz * o, (dx + this.rnd(-j, j)) * s, (dy + this.rnd(-j, j)) * s, (dz + this.rnd(-j, j)) * s, life * (1 - (0.6 * o) / reach) * this.rnd(0.75, 1.05), this.rnd(0.14, 0.22) + o * 0.2, this.rnd(1.2, 2.1) * (0.35 + (0.65 * reach) / FULL), 1, 0.6, 0.2, 0.9, 0.8, 0.13, 0.02, 0, -1.6, 1, TEX.FIRE, this.rnd(-3, 3));
    }
    D.emit(x + dx * 0.25, y + dy * 0.25, z + dz * 0.25, dx * SPEED * 0.5, dy * SPEED * 0.5, dz * SPEED * 0.5, 0.12, 0.3, 0.7, 1, 0.9, 0.6, 0.7, 1, 0.5, 0.1, 0, 0, 1, TEX.GLOW);
    const ex = x + dx * reach;
    const ey = y + dy * reach;
    const ez = z + dz * reach;
    if (dist < FULL - 0.3) {
      for (let i = 0; i < 2; i++) D.emit(ex - dx * 0.15, ey - dy * 0.15, ez - dz * 0.15, this.rnd(-2.5, 2.5), this.rnd(0.5, 3), this.rnd(-2.5, 2.5), this.rnd(0.25, 0.5), this.rnd(0.5, 0.9), 0.15, 1, 0.6, 0.2, 0.8, 0.8, 0.14, 0.02, 0, -2, 1.5, TEX.FIRE, this.rnd(-3, 3));
      if (Math.random() < 0.06) {
        const gy = this.world.heightAt(ex, ez);
        if (ey - gy < 0.5) this.scorch.add(ex, gy + 0.05, ez, this.rnd(0.9, 1.6));
      }
    }
    if (Math.random() < 0.3) this.alpha.emit(ex, ey + 0.3, ez, dx * 1.5 + this.rnd(-0.4, 0.4), this.rnd(0.8, 1.6), dz * 1.5 + this.rnd(-0.4, 0.4), this.rnd(1.4, 2.2), 0.7, 2.6, 0.08, 0.07, 0.06, 0.4, 0.12, 0.12, 0.12, 0, -0.2, 0.6, TEX.SMOKE, 0.3);
  }

  // tracer from (x,y,z) along (dx,dy,dz) for dist meters
  tracer(x, y, z, dx, dy, dz, dist, bright = 1) {
    if (this.tracers.length >= this.tracerMax) this.tracers.shift();
    this.tracers.push({ x, y, z, dx, dy, dz, dist, t: 0, bright });
  }

  // crossbow bolt: a short, slow, pale streak instead of a hot tracer
  boltTrail(x, y, z, dx, dy, dz, dist) {
    if (this.tracers.length >= this.tracerMax) this.tracers.shift();
    this.tracers.push({ x, y, z, dx, dy, dz, dist, t: 0, bright: 0.5, speed: 150, len: 1.6, bolt: true });
  }

  vmMuzzle(pos, scale = 1, time = 0.05) {
    this.vmFlash.position.copy(pos);
    this.vmFlash.scale.setScalar(this.rnd(0.18, 0.28) * scale);
    this.vmFlash.material.rotation = Math.random() * 6.28;
    this.vmFlash.visible = true;
    this.vmFlashT = time;
  }

  worldMuzzle(pos, scale = 1) {
    const f = this.wFlashes.find((w) => w.t <= 0) || this.wFlashes[0];
    f.s.position.copy(pos);
    f.s.scale.setScalar(this.rnd(0.5, 0.8) * scale);
    f.s.material.rotation = Math.random() * 6.28;
    f.s.visible = true;
    f.t = 0.06;
    this.add.emit(pos.x, pos.y, pos.z, 0, 0.6, 0, 0.5, 0.3, 1.1, 0.4, 0.4, 0.4, 0.25, 0.3, 0.3, 0.3, 0, 0, 1, TEX.SMOKE);
  }

  // ---------------------------------------------------------------- emitters
  // kind: 'campfire' | 'torch' | 'fire' | 'acid' | 'smoke_red' | 'embers' | 'flare' | 'barrel'
  createEmitter(kind, x, y, z, opts = {}) {
    const em = { kind, x, y, z, acc: 0, intensity: opts.intensity ?? 1, radius: opts.radius ?? 1, active: true };
    this.emitters.add(em);
    return em;
  }
  removeEmitter(em) {
    this.emitters.delete(em);
  }

  _runEmitter(em, dt) {
    if (!em.active || em.intensity <= 0) return;
    const A = this.alpha;
    const D = this.add;
    const I = em.intensity;
    let rate;
    switch (em.kind) {
      case 'campfire':
        rate = 55 * I;
        break;
      case 'torch':
        rate = 20;
        break;
      case 'fire':
        rate = 30 * em.radius * I;
        break;
      case 'acid':
        rate = 8 * em.radius;
        break;
      case 'smoke_red':
        rate = 14;
        break;
      case 'embers':
        rate = 6;
        break;
      case 'flare':
        rate = 34;
        break;
      case 'barrel':
        rate = 22;
        break;
      default:
        rate = 10;
    }
    em.acc += dt * rate;
    while (em.acc >= 1) {
      em.acc -= 1;
      const r = Math.random();
      switch (em.kind) {
        case 'campfire': {
          const s = 0.35 + 0.6 * I;
          if (r < 0.62) D.emit(em.x + this.rnd(-0.35, 0.35) * s, em.y + this.rnd(0, 0.2), em.z + this.rnd(-0.35, 0.35) * s, this.rnd(-0.2, 0.2), this.rnd(1.2, 2.4) * s, this.rnd(-0.2, 0.2), this.rnd(0.35, 0.75), this.rnd(0.55, 0.95) * s, 0.12, 0.95, 0.45, 0.14, 0.75, 0.8, 0.14, 0.03, 0, -1.2, 1.2, TEX.FIRE, this.rnd(-2, 2));
          else if (r < 0.9) A.emit(em.x + this.rnd(-0.3, 0.3), em.y + 0.9 * s, em.z + this.rnd(-0.3, 0.3), this.rnd(-0.2, 0.2), this.rnd(0.8, 1.5), this.rnd(-0.2, 0.2), this.rnd(2.5, 4), 0.5, 2.6, 0.12, 0.11, 0.1, 0.35, 0.18, 0.18, 0.18, 0, -0.1, 0.4, TEX.SMOKE, 0.3);
          else D.emit(em.x + this.rnd(-0.3, 0.3), em.y + 0.3, em.z + this.rnd(-0.3, 0.3), this.rnd(-0.8, 0.8), this.rnd(1.5, 3.5), this.rnd(-0.8, 0.8), this.rnd(1, 2.5), 0.05, 0.02, 1, 0.6, 0.2, 1, 1, 0.3, 0.05, 0, -0.3, 0.6, TEX.SPARK);
          break;
        }
        case 'torch':
          if (r < 0.8) D.emit(em.x + this.rnd(-0.05, 0.05), em.y, em.z + this.rnd(-0.05, 0.05), this.rnd(-0.1, 0.1), this.rnd(0.6, 1.1), this.rnd(-0.1, 0.1), this.rnd(0.22, 0.42), this.rnd(0.22, 0.34), 0.04, 0.9, 0.42, 0.12, 0.6, 0.7, 0.12, 0.02, 0, -1, 1, TEX.FIRE, 2);
          else A.emit(em.x, em.y + 0.4, em.z, this.rnd(-0.1, 0.1), 0.8, this.rnd(-0.1, 0.1), 2, 0.2, 1, 0.1, 0.1, 0.1, 0.3, 0.2, 0.2, 0.2, 0, -0.1, 0.5, TEX.SMOKE);
          break;
        case 'fire': {
          const a = Math.random() * 6.283;
          const d = Math.sqrt(Math.random()) * em.radius;
          const px = em.x + Math.cos(a) * d;
          const pz = em.z + Math.sin(a) * d;
          const py = this.world.heightAt(px, pz);
          if (r < 0.75) D.emit(px, py + 0.1, pz, 0, this.rnd(1.5, 3), 0, this.rnd(0.35, 0.7), this.rnd(0.7, 1.3), 0.2, 0.95, 0.36, 0.08, 0.75, 0.7, 0.1, 0.02, 0, -1.5, 1.2, TEX.FIRE, 2);
          else A.emit(px, py + 1.2, pz, 0, 1.6, 0, 2.5, 0.8, 3, 0.08, 0.07, 0.06, 0.55, 0.12, 0.12, 0.12, 0, -0.2, 0.4, TEX.SMOKE, 0.3);
          break;
        }
        case 'acid': {
          const a = Math.random() * 6.283;
          const d = Math.sqrt(Math.random()) * em.radius * 0.9;
          const px = em.x + Math.cos(a) * d;
          const pz = em.z + Math.sin(a) * d;
          A.emit(px, em.y + 0.05, pz, 0, this.rnd(0.3, 0.8), 0, this.rnd(0.4, 0.9), 0.08, 0.25, 0.4, 1, 0.2, 0.9, 0.3, 0.8, 0.1, 0, 0, 1, TEX.GLOW);
          break;
        }
        case 'smoke_red':
          A.emit(em.x + this.rnd(-0.2, 0.2), em.y + 0.6, em.z + this.rnd(-0.2, 0.2), this.rnd(-0.3, 0.3) + 0.4, this.rnd(2.5, 3.5), this.rnd(-0.3, 0.3), this.rnd(6, 9), 0.6, 5.5, 0.85, 0.12, 0.1, 0.75, 0.35, 0.18, 0.18, 0, -0.25, 0.15, TEX.SMOKE, 0.2);
          if (r < 0.3) D.emit(em.x, em.y + 0.6, em.z, 0, 0.5, 0, 0.2, 0.5, 0.3, 1, 0.2, 0.1, 1, 1, 0.1, 0.1, 0, 0, 0, TEX.GLOW);
          break;
        case 'embers':
          D.emit(em.x + this.rnd(-2, 2), em.y + this.rnd(0, 1), em.z + this.rnd(-2, 2), this.rnd(-0.3, 0.3), this.rnd(0.5, 1.5), this.rnd(-0.3, 0.3), this.rnd(1.5, 3), 0.06, 0.02, 1, 0.5, 0.15, 1, 0.8, 0.2, 0.05, 0, -0.2, 0.3, TEX.SPARK);
          if (r < 0.3) A.emit(em.x + this.rnd(-1, 1), em.y + 0.5, em.z + this.rnd(-1, 1), 0, 0.8, 0, 3, 0.8, 3, 0.1, 0.1, 0.1, 0.4, 0.15, 0.15, 0.15, 0, -0.1, 0.3, TEX.SMOKE);
          break;
        case 'flare':
          // road flare: hot red core, sputtering sparks, thick pink smoke
          if (r < 0.5) D.emit(em.x + this.rnd(-0.03, 0.03), em.y + 0.05, em.z + this.rnd(-0.03, 0.03), this.rnd(-0.1, 0.1), this.rnd(0.4, 0.9), this.rnd(-0.1, 0.1), this.rnd(0.12, 0.25), this.rnd(0.25, 0.4), 0.05, 1, 0.25, 0.18, 0.9, 1, 0.1, 0.08, 0, -0.5, 1, TEX.FIRE, 3);
          else if (r < 0.78) D.emit(em.x, em.y + 0.05, em.z, this.rnd(-1.4, 1.4), this.rnd(1, 3), this.rnd(-1.4, 1.4), this.rnd(0.3, 0.8), 0.04, 0.01, 1, 0.55, 0.3, 1, 1, 0.3, 0.1, 0, -4, 0.3, TEX.SPARK);
          else A.emit(em.x + this.rnd(-0.1, 0.1), em.y + 0.3, em.z + this.rnd(-0.1, 0.1), this.rnd(-0.2, 0.2) + 0.2, this.rnd(0.8, 1.4), this.rnd(-0.2, 0.2), this.rnd(3, 5), 0.3, 2.6, 0.9, 0.35, 0.35, 0.45, 0.4, 0.2, 0.2, 0, -0.15, 0.3, TEX.SMOKE, 0.3);
          break;
        case 'barrel':
          if (r < 0.75) D.emit(em.x + this.rnd(-0.22, 0.22), em.y, em.z + this.rnd(-0.22, 0.22), this.rnd(-0.1, 0.1), this.rnd(0.9, 1.7), this.rnd(-0.1, 0.1), this.rnd(0.3, 0.55), this.rnd(0.4, 0.6), 0.08, 0.95, 0.42, 0.12, 0.7, 0.75, 0.12, 0.02, 0, -1.1, 1.1, TEX.FIRE, 2);
          else A.emit(em.x, em.y + 0.8, em.z, this.rnd(-0.1, 0.1), 1.1, this.rnd(-0.1, 0.1), 3, 0.3, 1.8, 0.1, 0.1, 0.1, 0.4, 0.15, 0.15, 0.15, 0, -0.1, 0.4, TEX.SMOKE, 0.3);
          break;
      }
    }
  }

  // night: smoke / dust are lit only by the fire, so darken them; blood (LIT) gets the little the night sky gives a body
  setAmbient(night) {
    this.alpha.material.uniforms.uTint.value = 1 - night * 0.7;
    this.alpha.material.uniforms.uLit.value = 1 - night * 0.75;
  }

  update(dt, camera, viewportHeight) {
    this.time += dt;
    this.eye = camera.position; // (impact sizes a far hit by its distance from here)
    // what the local flashlight throws on blood: the lamp is the spot light riding on the camera (render/lights.js)
    const torch = this.torch || (this.torch = camera.children.find(isSpot));
    if (torch) {
      const u = this.alpha.material.uniforms;
      u.uTorch.value.set((torch.intensity * TORCH_GAIN) / Math.PI, Math.cos(torch.angle), Math.cos(torch.angle * (1 - torch.penumbra)), torch.distance);
      u.uTorchDecay.value = torch.decay;
    }
    for (const em of this.emitters) this._runEmitter(em, dt);
    const pixelScale = (viewportHeight * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    this.add.update(dt, pixelScale);
    this.alpha.update(dt, pixelScale);
    this.blood.update(dt);
    this.acid.update(dt);
    this.scorch.update(dt);
    this.gibLumps.update(dt, this);
    this.gibLimbs.update(dt, this);
    this.gibHeads.update(dt, this);
    this.gibLoad = Math.max(0, this.gibLoad - dt * 3);
    // tracers
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      const len = t.len || 5;
      const head = t.t * (t.speed || 380);
      if (head - len > t.dist) {
        this.tracers.splice(i, 1);
        continue;
      }
      const a = Math.max(0, head - len);
      const b = Math.min(t.dist, head);
      const o = n * 6;
      this.tPos[o] = t.x + t.dx * a;
      this.tPos[o + 1] = t.y + t.dy * a;
      this.tPos[o + 2] = t.z + t.dz * a;
      this.tPos[o + 3] = t.x + t.dx * b;
      this.tPos[o + 4] = t.y + t.dy * b;
      this.tPos[o + 5] = t.z + t.dz * b;
      const k = 0.9 * t.bright;
      this.tCol[o] = 0.25 * k;
      this.tCol[o + 1] = (t.bolt ? 0.25 : 0.2) * k;
      this.tCol[o + 2] = (t.bolt ? 0.25 : 0.12) * k;
      this.tCol[o + 3] = 1 * k;
      this.tCol[o + 4] = (t.bolt ? 0.97 : 0.85) * k;
      this.tCol[o + 5] = (t.bolt ? 0.9 : 0.55) * k;
      n++;
    }
    this.tracerGeo.setDrawRange(0, n * 2);
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
    // flashes
    if (this.vmFlashT > 0) {
      this.vmFlashT -= dt;
      if (this.vmFlashT <= 0) this.vmFlash.visible = false;
    }
    for (const f of this.wFlashes) {
      if (f.t > 0) {
        f.t -= dt;
        if (f.t <= 0) f.s.visible = false;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }
}
