// Instanced vegetation with camera-centered dynamic culling: trees, bushes, rocks and wind-swayed grass.
// Only instances near the camera are uploaded (rebuilt when the camera moves a few meters), so the
// GPU draws ~1-2k trees instead of the whole forest, in one draw call per variant part.
import * as THREE from 'three';
import { MAP_HALF, WATER_LEVEL } from '../../shared/constants.js';
import { hash2 } from '../../shared/rng.js';
import { getTreeVariants, getBushVariants, getRockVariants, getGrassPatch, vegetationTime } from './models/vegetation.js';
import { vegetationWind, trunkMaterial } from './materials.js';

// trees bend in the wind as a whole: swap each variant's bark for its wind-bent copy (foliage already bends)
function windBentTrees(variants) {
  return variants.map((v) => ({ ...v, parts: v.parts.map((p) => (p.material.userData.sway ? p : { ...p, material: trunkMaterial(p.material) })) }));
}

const CELL = 32;

class InstancedSet {
  // data: Float32Array stride 6 [x,y,z,scale,rot,variant]
  constructor(scene, data, variants, opts) {
    this.data = data;
    this.n = data.length / 6;
    this.variants = variants;
    this.radius = opts.radius;
    this.rebuildDist = opts.rebuildDist || 8;
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
    this.meshes = variants.map((v, vi) =>
      v.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, counts[vi]));
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = !!opts.shadows;
        mesh.receiveShadow = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(mesh);
        return mesh;
      }),
    );
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
    const c0 = Math.floor((cx - r + MAP_HALF) / CELL);
    const c1 = Math.floor((cx + r + MAP_HALF) / CELL);
    const d0 = Math.floor((cz - r + MAP_HALF) / CELL);
    const d1 = Math.floor((cz + r + MAP_HALF) / CELL);
    const counts = this._counts || (this._counts = new Int32Array(this.variants.length));
    counts.fill(0);
    const data = this.data;
    for (let i = c0; i <= c1; i++) {
      for (let j = d0; j <= d1; j++) {
        const arr = this.cells.get(i * 1000 + j);
        if (!arr) continue;
        for (const idx of arr) {
          const dx = data[idx * 6] - cx;
          const dz = data[idx * 6 + 2] - cz;
          if (dx * dx + dz * dz > r2) continue;
          const v = data[idx * 6 + 5] | 0;
          const k = counts[v]++;
          for (const mesh of this.meshes[v]) mesh.instanceMatrix.array.set(this.mats.subarray(idx * 16, idx * 16 + 16), k * 16);
        }
      }
    }
    for (let v = 0; v < this.meshes.length; v++) {
      for (const mesh of this.meshes[v]) {
        mesh.count = counts[v];
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

export class Foliage {
  constructor(scene, world, quality) {
    this.world = world;
    this.scene = scene;
    this.quality = quality;
    const trees = windBentTrees(getTreeVariants());
    this.trees = new InstancedSet(scene, world.trees, trees, { radius: quality.treeDist, rebuildDist: 8, shadows: quality.shadows, stretch: true });
    this.bushes = new InstancedSet(scene, world.bushes, getBushVariants(), { radius: 85, rebuildDist: 6 });
    this.rocks = new InstancedSet(scene, world.rocks, getRockVariants(), { radius: quality.treeDist, rebuildDist: 10 });
    // grass
    const gp = getGrassPatch();
    this.grassMax = Math.round(2600 * quality.grass);
    this.grass = new THREE.InstancedMesh(gp.geometry, gp.material, Math.max(1, this.grassMax));
    this.grass.count = 0;
    this.grass.frustumCulled = false;
    this.grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.grass);
    this.grassLast = { x: 1e9, z: 1e9 };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._q2 = [];
  }

  setQuality(q) {
    this.quality = q;
  }

  updateGrass(cx, cz) {
    if (Math.hypot(cx - this.grassLast.x, cz - this.grassLast.z) < 3) return;
    this.grassLast.x = cx;
    this.grassLast.z = cz;
    const w = this.world;
    const R = 34 * Math.sqrt(this.quality.grass);
    const step = 1.35;
    let n = 0;
    const arr = this.grass.instanceMatrix.array;
    const gx0 = Math.floor((cx - R) / step);
    const gx1 = Math.floor((cx + R) / step);
    const gz0 = Math.floor((cz - R) / step);
    const gz1 = Math.floor((cz + R) / step);
    for (let gi = gx0; gi <= gx1 && n < this.grassMax; gi++) {
      for (let gj = gz0; gj <= gz1 && n < this.grassMax; gj++) {
        const h1 = hash2(gi, gj, 91);
        const x = (gi + hash2(gi, gj, 3)) * step;
        const z = (gj + hash2(gi, gj, 7)) * step;
        const dx = x - cx;
        const dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > R * R) continue;
        // density: thin out with distance, near roads and in the deep forest
        const rd = w.roadDistAt(x, z);
        if (rd < 3.2) continue;
        const y = w.heightAt(x, z);
        if (y < WATER_LEVEL + 0.25) continue;
        const carD = Math.hypot(x - w.car.x, z - w.car.z);
        if (carD < 4) continue;
        const dens = 0.55 + 0.45 * Math.sin(x * 0.07 + Math.cos(z * 0.05) * 2);
        if (h1 > dens) continue;
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
        const sc = 0.65 + hash2(gi, gj, 13) * 0.75;
        this._q.setFromAxisAngle(this._up, hash2(gi, gj, 17) * 6.283);
        this._p.set(x, y - 0.03, z);
        this._s.set(sc, sc * (0.8 + hash2(gi, gj, 19) * 0.6), sc);
        this._m.compose(this._p, this._q, this._s);
        this._m.toArray(arr, n * 16);
        n++;
      }
    }
    this.grass.count = n;
    this.grass.instanceMatrix.needsUpdate = true;
  }

  // weather: { wind, windX, windZ } (optional)
  update(camPos, fogVisibility, time, weather) {
    const dt = Math.min(0.1, Math.max(0, time - (this.lastTime ?? time)));
    this.lastTime = time;
    vegetationTime.value = time;
    const w = vegetationWind.value;
    const strength = weather ? weather.wind : 0.3;
    w.x = weather ? weather.windX : 0;
    w.y = weather ? weather.windZ : 1;
    w.z = strength;
    w.w = (w.w + dt * (0.75 + 1.25 * strength)) % 6283.1853; // sway clock speeds up with the wind (wraps on a whole cycle count)
    const treeR = Math.min(this.quality.treeDist, fogVisibility + 30);
    this.trees.update(camPos.x, camPos.z, Math.round(treeR / 10) * 10);
    this.bushes.update(camPos.x, camPos.z, Math.min(85, fogVisibility + 10));
    this.rocks.update(camPos.x, camPos.z, Math.round(treeR / 10) * 10);
    this.updateGrass(camPos.x, camPos.z);
  }
}
