// Visual effects: pooled CPU-simulated particles rendered as two Points draw calls (additive + alpha)
// sharing a sprite atlas, ground decals (instanced), bullet tracers, muzzle flashes, explosions and
// continuous emitters (campfire, torches, molotov fires, acid pools, supply-drop smoke).
import * as THREE from 'three';
import { IMPACT } from '../../shared/defs.js';
import { getTexture } from './textures.js';

// atlas cells (3x3)
export const TEX = { FIRE: 0, SMOKE: 1, SPARK: 2, BLOOD: 3, GLOW: 4, MUZZLE: 5, DUST: 6 };
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
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vTex = aTex;
  vRot = aRot;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float depth = -mvPosition.z;
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
#include <fog_pars_fragment>
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float c = cos(vRot); float s = sin(vRot);
  pc = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y) + 0.5;
  if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) discard;
  float cell = floor(vTex + 0.5);
  vec2 uv = (vec2(mod(cell, 3.0), 2.0 - floor(cell / 3.0)) + vec2(pc.x, 1.0 - pc.y)) / 3.0;
  vec4 t = texture2D(uAtlas, uv);
  vec4 col = t * vColor;
  col.rgb *= uTint;
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
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null }, uScale: { value: 600 }, uTint: { value: 1 } }]),
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
  impact(kind, x, y, z, nx, ny, nz) {
    const A = this.alpha;
    const D = this.add;
    switch (kind) {
      case IMPACT.BLOOD:
      case IMPACT.GREEN_BLOOD: {
        const g = kind === IMPACT.GREEN_BLOOD;
        for (let i = 0; i < 10; i++) {
          const s = this.rnd(1, 4);
          A.emit(x, y, z, nx * s + this.rnd(-1.5, 1.5), ny * s + this.rnd(0, 2.5), nz * s + this.rnd(-1.5, 1.5), this.rnd(0.35, 0.8), this.rnd(0.12, 0.25), this.rnd(0.25, 0.45), g ? 0.25 : 0.45, g ? 0.45 : 0.02, g ? 0.05 : 0.02, 0.95, g ? 0.15 : 0.25, g ? 0.3 : 0.0, 0.02, 0, 9, 1.5, TEX.BLOOD, this.rnd(-3, 3));
        }
        A.emit(x, y, z, nx * 0.5, 0.4, nz * 0.5, 0.5, 0.3, 0.9, g ? 0.25 : 0.35, g ? 0.4 : 0.02, 0.03, 0.55, 0.2, g ? 0.3 : 0.0, 0.0, 0, 0, 3, TEX.SMOKE);
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
        D.emit(x, y, z, 0, 0, 0, 0.07, 0.6, 0.2, 1, 0.8, 0.5, 1, 1, 0.6, 0.3, 0, 0, 0, 0, TEX.GLOW);
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
    D.emit(x, y, z, 0, 0, 0, 0.18, radius * 2.5, radius * 4, 1, green ? 1 : 0.85, green ? 0.5 : 0.5, 1, 1, 0.4, 0.1, 0, 0, 0, 0, TEX.GLOW);
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
    for (let i = 0; i < 26; i++) {
      const s = this.rnd(1, 5);
      this.alpha.emit(x, y, z, this.rnd(-1, 1) * s, this.rnd(0, 1.2) * s, this.rnd(-1, 1) * s, this.rnd(0.5, 1.1), this.rnd(0.12, 0.3), 0.35, green ? 0.3 : 0.5, green ? 0.5 : 0.02, 0.02, 1, green ? 0.2 : 0.25, green ? 0.3 : 0, 0, 0.1, 12, 1, TEX.BLOOD, this.rnd(-4, 4));
    }
    const gy = this.world.heightAt(x, z);
    (green ? this.acid : this.blood).add(x, gy + 0.03, z, 1.6);
  }

  burnPuff(x, y, z) {
    this.add.emit(x + this.rnd(-0.3, 0.3), y + this.rnd(0, 1.2), z + this.rnd(-0.3, 0.3), 0, this.rnd(1, 2.5), 0, this.rnd(0.3, 0.6), this.rnd(0.5, 0.9), 0.1, 1, 0.55, 0.2, 0.9, 0.9, 0.2, 0.05, 0, -2, 1, TEX.FIRE, 2);
    this.alpha.emit(x, y + 1.3, z, this.rnd(-0.3, 0.3), 1.5, this.rnd(-0.3, 0.3), 1.6, 0.5, 1.8, 0.1, 0.09, 0.08, 0.6, 0.15, 0.15, 0.15, 0, -0.2, 0.8, TEX.SMOKE);
  }

  // tracer from (x,y,z) along (dx,dy,dz) for dist meters
  tracer(x, y, z, dx, dy, dz, dist, bright = 1) {
    if (this.tracers.length >= this.tracerMax) this.tracers.shift();
    this.tracers.push({ x, y, z, dx, dy, dz, dist, t: 0, bright });
  }

  vmMuzzle(pos, scale = 1) {
    this.vmFlash.position.copy(pos);
    this.vmFlash.scale.setScalar(this.rnd(0.18, 0.28) * scale);
    this.vmFlash.material.rotation = Math.random() * 6.28;
    this.vmFlash.visible = true;
    this.vmFlashT = 0.05;
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

  // night: smoke / dust are lit only by the fire, so darken them
  setAmbient(night) {
    this.alpha.material.uniforms.uTint.value = 1 - night * 0.7;
  }

  update(dt, camera, viewportHeight) {
    this.time += dt;
    for (const em of this.emitters) this._runEmitter(em, dt);
    const pixelScale = (viewportHeight * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    this.add.update(dt, pixelScale);
    this.alpha.update(dt, pixelScale);
    this.blood.update(dt);
    this.acid.update(dt);
    this.scorch.update(dt);
    // tracers
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      const head = t.t * 380;
      if (head - 5 > t.dist) {
        this.tracers.splice(i, 1);
        continue;
      }
      const a = Math.max(0, head - 5);
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
      this.tCol[o + 1] = 0.2 * k;
      this.tCol[o + 2] = 0.12 * k;
      this.tCol[o + 3] = 1 * k;
      this.tCol[o + 4] = 0.85 * k;
      this.tCol[o + 5] = 0.55 * k;
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
