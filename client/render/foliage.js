// Instanced vegetation with camera-centered dynamic culling: trees, bushes, rocks and wind-swayed grass.
// Only instances near the camera are uploaded (rebuilt when the camera moves a few meters), so the
// GPU draws ~1-2k trees instead of the whole forest, in one draw call per variant part and LOD.
// Trees: near LOD within uTreeLod, far LOD beyond, dither cross-faded in the shaders. Shadow casters are
// written first in every instance buffer and the shadow passes draw only those (onBeforeShadow).
import * as THREE from 'three';
import { MAP_HALF, WATER_LEVEL } from '../../shared/constants.js';
import { hash2 } from '../../shared/rng.js';
import { getTreeVariants, getBushVariants, getRockVariants, getGrassPatch } from './models/vegetation.js';
import { VEG } from './materials.js';
import { G } from './globals.js';
import { groundFields } from './terrain.js';

const CELL = 32;

function limitShadowCasters(mesh) {
  mesh.castCount = 0;
  mesh.onBeforeShadow = function () {
    this._drawCount = this.count;
    this.count = this.castCount;
  };
  mesh.onAfterShadow = function () {
    this.count = this._drawCount;
  };
}

class InstancedSet {
  // data: Float32Array stride 6 [x,y,z,scale,rot,variant]
  constructor(scene, data, variants, opts) {
    this.data = data;
    this.n = data.length / 6;
    this.variants = variants;
    this.radius = opts.radius;
    this.rebuildDist = opts.rebuildDist || 8;
    this.castDist = 0;
    this.lodBand = null;
    this.lastX = 1e9;
    this.lastZ = 1e9;
    this.cells = new Map();
    for (let i = 0; i < this.n; i++) {
      const key = Math.floor((data[i * 6] + MAP_HALF) / CELL) * 1000 + Math.floor((data[i * 6 + 2] + MAP_HALF) / CELL);
      let arr = this.cells.get(key);
      if (!arr) this.cells.set(key, (arr = []));
      arr.push(i);
    }
    // per-instance matrices
    this.mats = new Float32Array(this.n * 16);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const o = i * 6;
      q.setFromAxisAngle(up, data[o + 4]);
      p.set(data[o], data[o + 1], data[o + 2]);
      const sc = data[o + 3];
      s.set(sc, sc * (opts.stretch ? 0.9 + ((i * 7919) % 100) / 400 : 1), sc);
      m.compose(p, q, s);
      m.toArray(this.mats, i * 16);
    }
    const counts = new Array(variants.length).fill(0);
    for (let i = 0; i < this.n; i++) counts[data[i * 6 + 5] | 0]++;
    // meshes[variant][lod] = one InstancedMesh per part
    this.meshes = variants.map((v, vi) =>
      [v.parts, ...(opts.lod && v.far ? [v.far] : [])].map((parts) =>
        parts.map((part) => {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, counts[vi]));
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.castShadow = false;
          mesh.receiveShadow = !!opts.receive;
          if (part.material.userData.depth) mesh.customDepthMaterial = part.material.userData.depth;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          limitShadowCasters(mesh);
          scene.add(mesh);
          return mesh;
        }),
      ),
    );
    this._idx = new Int32Array(this.n);
    this._d2 = new Float32Array(this.n);
    this._k = variants.map(() => [0, 0]);
  }

  update(cx, cz, radius, force = false) {
    if (radius !== this.radius) {
      this.radius = radius;
      force = true;
    }
    if (!force && Math.hypot(cx - this.lastX, cz - this.lastZ) < this.rebuildDist) return;
    this.lastX = cx;
    this.lastZ = cz;
    const r = this.radius;
    const r2 = r * r;
    const data = this.data;
    let nc = 0;
    const c0 = Math.floor((cx - r + MAP_HALF) / CELL);
    const c1 = Math.floor((cx + r + MAP_HALF) / CELL);
    const d0 = Math.floor((cz - r + MAP_HALF) / CELL);
    const d1 = Math.floor((cz + r + MAP_HALF) / CELL);
    for (let i = c0; i <= c1; i++) {
      for (let j = d0; j <= d1; j++) {
        const arr = this.cells.get(i * 1000 + j);
        if (!arr) continue;
        for (const idx of arr) {
          const dx = data[idx * 6] - cx;
          const dz = data[idx * 6 + 2] - cz;
          const dd = dx * dx + dz * dz;
          if (dd > r2) continue;
          this._idx[nc] = idx;
          this._d2[nc++] = dd;
        }
      }
    }
    // LOD membership with a margin of one rebuild step: the shaders fade by the live camera distance
    const m = this.rebuildDist + 1;
    const nearMax = this.lodBand ? (this.lodBand[1] + m) ** 2 : Infinity;
    const farMin = this.lodBand ? Math.max(0, this.lodBand[0] - m) ** 2 : Infinity;
    const cast2 = this.castDist > 0 ? (this.castDist + m) ** 2 : -1;
    for (const k of this._k) k[0] = k[1] = 0;
    // pass 0 writes the shadow casters, pass 1 the rest: the shadow passes draw only the first castCount.
    // Trees cast from the far LOD only (its shader collapses the near-range copies in the main pass).
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < nc; c++) {
        const dd = this._d2[c];
        const caster = dd <= cast2;
        if (caster !== (pass === 0)) continue;
        const idx = this._idx[c];
        const v = data[idx * 6 + 5] | 0;
        const lods = this.meshes[v];
        const src = this.mats.subarray(idx * 16, idx * 16 + 16);
        for (let l = 0; l < lods.length; l++) {
          if (lods.length > 1 && (l === 0 ? dd > nearMax : dd < farMin && !caster)) continue;
          const k = this._k[v][l]++;
          for (const mesh of lods[l]) mesh.instanceMatrix.array.set(src, k * 16);
        }
      }
      if (pass === 0) {
        for (let v = 0; v < this.meshes.length; v++) {
          const lods = this.meshes[v];
          for (let l = 0; l < lods.length; l++) for (const mesh of lods[l]) mesh.castCount = lods.length > 1 && l === 0 ? 0 : this._k[v][l];
        }
      }
    }
    for (let v = 0; v < this.meshes.length; v++) {
      for (let l = 0; l < this.meshes[v].length; l++) {
        for (const mesh of this.meshes[v][l]) {
          mesh.count = this._k[v][l];
          mesh.castShadow = mesh.castCount > 0;
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ grass
// Clumps on a jittered 0.78 m grid, density from the ground layers (meadows, road verges; sparse under
// canopy). Generated per 8 m chunk once and cached, so a rebuild is only a few bulk copies. The shader thins
// them out by seed towards uGrassFade (no hard edge) and widens the survivors.
const GCH = 8;
const GSTEP = 0.78;
const GMAX_CHUNKS = 1500;

class GrassField {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.fields = groundFields(world);
    this.patch = getGrassPatch();
    this.chunks = new Map();
    this.mesh = null;
    this.cap = 0;
    this.R = 30;
    this.lastX = 1e9;
    this.lastZ = 1e9;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._f = {};
  }

  setQuality(q) {
    this.R = 30 * Math.sqrt(q.grass);
    const cap = Math.ceil(((Math.PI * (this.R + GCH) ** 2) / (GSTEP * GSTEP)) * 0.75);
    if (cap > this.cap) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.dispose();
      }
      this.cap = cap;
      this.mesh = new THREE.InstancedMesh(this.patch.geometry, this.patch.material, cap);
      this.mesh.count = 0;
      this.mesh.frustumCulled = false;
      this.mesh.receiveShadow = true;
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(this.mesh);
    }
    VEG.uGrassFade.value.set(this.R * 0.5, this.R);
    this.lastX = 1e9;
  }

  density(x, z) {
    const w = this.world;
    const rd = w.roadDistAt(x, z);
    if (rd < 2.5) return 0;
    const f = this.fields.sample(x, z, this._f);
    let d = f.grass * 0.95 + f.forest * 0.1 + f.mud * 0.25;
    // road verges: a band of rank grass along every road
    d = Math.max(d, 0.9 * (1 - Math.abs(rd - 4) / 2.2));
    d *= 1 - f.rock;
    // patchiness: clumped meadows with thinner gaps
    const n = Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2.3) * Math.cos(z * 0.097 - x * 0.03 + Math.sin(x * 0.05));
    const n2 = Math.sin(x * 0.41 + Math.cos(z * 0.33) * 1.7) * Math.sin(z * 0.37 + x * 0.12);
    return d * (0.8 + 0.22 * n + 0.12 * n2);
  }

  chunk(ci, cj) {
    const key = ci * 8192 + cj;
    let c = this.chunks.get(key);
    if (c) return c;
    const w = this.world;
    const out = [];
    const x0 = ci * GCH, z0 = cj * GCH;
    const gi0 = Math.ceil(x0 / GSTEP), gi1 = Math.ceil((x0 + GCH) / GSTEP);
    const gj0 = Math.ceil(z0 / GSTEP), gj1 = Math.ceil((z0 + GCH) / GSTEP);
    for (let gi = gi0; gi < gi1; gi++) {
      for (let gj = gj0; gj < gj1; gj++) {
        const x = (gi + hash2(gi, gj, 3) * 0.85) * GSTEP;
        const z = (gj + hash2(gi, gj, 7) * 0.85) * GSTEP;
        if (Math.abs(x) > MAP_HALF - 2 || Math.abs(z) > MAP_HALF - 2) continue;
        const dens = this.density(x, z);
        if (hash2(gi, gj, 91) > dens) continue;
        const y = w.heightAt(x, z);
        if (y < WATER_LEVEL + 0.25) continue;
        if (Math.hypot(x - w.car.x, z - w.car.z) < 4) continue;
        // skip building floors / props footprints
        const cell = w.staticGrid.cellAt(x, z);
        let blocked = false;
        if (cell) {
          for (const c of cell) {
            if (c.flags & 16) continue; // trees fine
            const lx = c.c * (x - c.x) - c.s * (z - c.z);
            const lz = c.s * (x - c.x) + c.c * (z - c.z);
            if (c.type === 0 ? Math.abs(lx) < c.hx + 0.2 && Math.abs(lz) < c.hz + 0.2 : lx * lx + lz * lz < (c.r + 0.2) ** 2) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) continue;
        const lush = Math.min(1, dens * 1.3);
        // rank patches: taller grass in broad swathes
        const tall = 0.5 + 0.5 * Math.sin(x * 0.13 + Math.sin(z * 0.09) * 1.9) * Math.cos(z * 0.12 - x * 0.04);
        const sc = (0.7 + hash2(gi, gj, 13) * 0.5) * (0.72 + 0.3 * lush) * (0.85 + 0.35 * tall);
        this._q.setFromAxisAngle(this._up, hash2(gi, gj, 17) * 6.283);
        this._p.set(x, y - 0.03, z);
        this._s.set(sc, sc * (0.75 + hash2(gi, gj, 19) * 0.6) * (0.8 + 0.3 * lush), sc);
        this._m.compose(this._p, this._q, this._s);
        const o = out.length;
        out.length += 16;
        this._m.toArray(out, o);
      }
    }
    c = new Float32Array(out);
    if (this.chunks.size > GMAX_CHUNKS) this.chunks.clear();
    this.chunks.set(key, c);
    return c;
  }

  update(cx, cz) {
    if (!this.mesh || Math.hypot(cx - this.lastX, cz - this.lastZ) < 2) return;
    const R = this.R + 3;
    const list = [];
    const ci0 = Math.floor((cx - R) / GCH), ci1 = Math.floor((cx + R) / GCH);
    const cj0 = Math.floor((cz - R) / GCH), cj1 = Math.floor((cz + R) / GCH);
    for (let ci = ci0; ci <= ci1; ci++) {
      for (let cj = cj0; cj <= cj1; cj++) {
        const dx = Math.max(0, Math.abs(cx - (ci + 0.5) * GCH) - GCH / 2);
        const dz = Math.max(0, Math.abs(cz - (cj + 0.5) * GCH) - GCH / 2);
        const d2 = dx * dx + dz * dz;
        if (d2 < R * R) list.push([d2, ci, cj]);
      }
    }
    list.sort((a, b) => a[0] - b[0]);
    // generate at most a few new chunks per frame (nearest first) so walking never hitches
    let budget = this.mesh.count ? 10 : 1e9;
    let pending = false;
    const arr = this.mesh.instanceMatrix.array;
    let n = 0;
    for (const [, ci, cj] of list) {
      const key = ci * 8192 + cj;
      if (!this.chunks.has(key)) {
        if (budget <= 0) {
          pending = true;
          continue;
        }
        budget--;
      }
      const c = this.chunk(ci, cj);
      const k = Math.min(c.length / 16, this.cap - n);
      if (k <= 0) break;
      arr.set(k * 16 === c.length ? c : c.subarray(0, k * 16), n * 16);
      n += k;
    }
    if (!pending) {
      this.lastX = cx;
      this.lastZ = cz;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Foliage {
  constructor(scene, world, quality) {
    this.world = world;
    this.scene = scene;
    this.trees = new InstancedSet(scene, world.trees, getTreeVariants(), { radius: quality.treeDist, rebuildDist: 8, stretch: true, lod: true, receive: true });
    this.bushes = new InstancedSet(scene, world.bushes, getBushVariants(), { radius: 85, rebuildDist: 6, receive: true });
    this.rocks = new InstancedSet(scene, world.rocks, getRockVariants(), { radius: quality.treeDist, rebuildDist: 10, receive: true });
    this.grass = new GrassField(scene, world);
    this.setQuality(quality);
  }

  setQuality(q) {
    this.quality = q;
    const sd = q.shadows ? q.shadowDist : 0;
    // tall trees just outside the shadow range still throw shadows into it
    this.trees.castDist = sd ? sd + 25 : 0;
    this.bushes.castDist = sd && q.foliageShadows ? Math.min(sd, 40) : 0;
    this.rocks.castDist = sd && q.foliageShadows ? Math.min(sd, 90) : 0;
    const mid = Math.max(35, q.treeDist * 0.25);
    this.trees.lodBand = [mid - 7, mid + 7];
    VEG.uTreeLod.value.set(mid - 7, mid + 7);
    this.grass.setQuality(q);
    this.trees.lastX = this.bushes.lastX = this.rocks.lastX = 1e9;
  }

  // weather: { wind, windX, windZ } (optional). Drives the global wind: 0.3 is the everyday breeze, ~1.2 a gale
  // (gusts included); the sway clock runs faster in strong wind.
  update(camPos, fogVisibility, time, weather) {
    VEG.uVegCam.value.copy(camPos);
    const dt = Math.min(0.1, Math.max(0, time - (this.lastTime ?? time)));
    this.lastTime = time;
    const wind = weather ? weather.wind : 0.3;
    const W = G.uWind.value;
    W.x += dt * (0.8 + 0.7 * wind);
    W.y = 0.2 + 0.8 * wind;
    if (weather) {
      W.z = weather.windX;
      W.w = weather.windZ;
    }
    const treeR = Math.min(this.quality.treeDist, fogVisibility + 30);
    this.trees.update(camPos.x, camPos.z, Math.round(treeR / 10) * 10);
    this.bushes.update(camPos.x, camPos.z, Math.min(85, fogVisibility + 10));
    this.rocks.update(camPos.x, camPos.z, Math.round(treeR / 10) * 10);
    this.grass.update(camPos.x, camPos.z);
  }
}
