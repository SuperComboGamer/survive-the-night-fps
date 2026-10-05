// Instanced vegetation with camera-centered dynamic culling: trees, bushes, rocks and wind-swayed grass.
// Only instances near the camera are uploaded (rebuilt when the camera moves a few meters), so the
// GPU draws ~1-2k trees instead of the whole forest, in one draw call per variant part and LOD.
// Trees: near LOD within uTreeLod, far LOD beyond, dither cross-faded in the shaders. Shadow casters are
// written first in every instance buffer and the shadow passes draw only those (onBeforeShadow).
import * as THREE from 'three';
import { WATER_LEVEL } from '../../shared/constants.js';
import { hash2 } from '../../shared/rng.js';
import { getTreeVariants, getBushVariants, getRockVariants, getGrassPatch } from './models/vegetation.js';
import { VEG } from './materials.js';
import { G } from './globals.js';
import { groundFields } from './terrain.js';
import { grassRadius } from './renderer.js';
import { FallingTrees } from './fallingtrees.js';
import { isShadowFrustum } from './multimesh.js';

const CELL = 32;
const CELL_OFF = 1024; // added to a coordinate before it is put in a cell, so that none is negative (the mainland reaches +-640 m)

// The view the instance buffers were last filled for, padded: what is outside it is not drawn at all (two thirds of
// a forest is behind the eye or beside it, and was being drawn). The buffers are filled again when the eye has
// turned VIEW_TURN of the VIEW_PAD the frustum is widened by, or moved VIEW_MOVE (every bounding sphere is that
// much bigger), so nothing that could be in the picture is ever missing from them.
const VIEW_PAD = (14 * Math.PI) / 180, VIEW_TURN = 0.6 * VIEW_PAD, VIEW_MOVE = 2.5;
const _pm = new THREE.Matrix4();
const BINS = 96; // the rings by distance the instances are put in order by (InstancedSet.update)

class ViewCull {
  constructor() {
    this.frustum = new THREE.Frustum();
    this.quat = new THREE.Quaternion();
    this.pos = new THREE.Vector3(1e9, 0, 0);
    this.fov = 0;
    this.aspect = 0;
    this.on = false;
    this.stamp = 0; // (goes up when the frustum is made anew: who fills buffers from it does so again)
  }

  // the frustum for this camera, made anew if the camera has left what the last one covers. camera: null for none
  // (everything within range is drawn, as before)
  update(camera) {
    const was = this.on;
    // (a frustum that is off-centre - the splash's - is not worth the arithmetic: no culling there)
    this.on = !!camera && !camera.view?.enabled;
    if (!this.on) {
      if (was) this.stamp++;
      return;
    }
    camera.updateMatrixWorld();
    const q = camera.quaternion, p = camera.position;
    if (was && this.quat.angleTo(q) < VIEW_TURN && this.pos.distanceToSquared(p) < VIEW_MOVE * VIEW_MOVE && camera.fov <= this.fov + 0.5 && camera.aspect === this.aspect) return;
    this.quat.copy(q);
    this.pos.copy(p);
    this.fov = camera.fov;
    this.aspect = camera.aspect;
    const v = (camera.fov * Math.PI) / 360;
    const top = Math.tan(Math.min(1.53, v + VIEW_PAD));
    const right = Math.tan(Math.min(1.53, Math.atan(Math.tan(v) * camera.aspect) + VIEW_PAD));
    _pm.makePerspective(-right, right, top, -top, 1, 2000);
    this.frustum.setFromProjectionMatrix(_pm.multiply(camera.matrixWorldInverse));
    this.stamp++;
  }

  // is a sphere (in the padded view, allowing for the eye's moving) in it? The far plane is left to the caller's range.
  sees(x, y, z, r) {
    if (!this.on) return true;
    const pl = this.frustum.planes;
    r += VIEW_MOVE;
    for (let i = 0; i < 4; i++) if (pl[i].normal.x * x + pl[i].normal.y * y + pl[i].normal.z * z + pl[i].constant < -r) return false;
    return true;
  }
}

// an instanced mesh that is only ever in shadow maps (the casters near the eye, whichever way it looks)
class VegCaster extends THREE.InstancedMesh {
  intersectsFrustum(frustum) {
    return this.count > 0 && isShadowFrustum(this, frustum);
  }
}

const upload = (mesh, n) => {
  mesh.count = n;
  mesh.visible = n > 0;
  if (!n) return;
  const im = mesh.instanceMatrix;
  im.clearUpdateRanges();
  im.addUpdateRange(0, n * 16);
  im.needsUpdate = true;
};

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
    this.stamp = -1;
    this.cells = new Map();
    for (let i = 0; i < this.n; i++) {
      const key = Math.floor((data[i * 6] + CELL_OFF) / CELL) * 1000 + Math.floor((data[i * 6 + 2] + CELL_OFF) / CELL);
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
    const stretch = (i) => (opts.stretch ? 0.9 + ((i * 7919) % 100) / 400 : 1);
    for (let i = 0; i < this.n; i++) {
      const o = i * 6;
      q.setFromAxisAngle(up, data[o + 4]);
      p.set(data[o], data[o + 1], data[o + 2]);
      const sc = data[o + 3];
      s.set(sc, sc * stretch(i), sc);
      m.compose(p, q, s);
      m.toArray(this.mats, i * 16);
    }
    // how far a variant's model reaches from its foot, at scale 1 (an instance's bounding sphere is about its foot)
    this.reach = variants.map((v) => {
      let r = 0;
      for (const parts of [v.parts, ...(opts.lod && v.far ? [v.far] : [])]) {
        for (const part of parts) {
          const g = part.geometry;
          if (!g.boundingSphere) g.computeBoundingSphere();
          r = Math.max(r, g.boundingSphere.center.length() + g.boundingSphere.radius);
        }
      }
      return r * (opts.stretch ? 1.15 : 1);
    });
    const counts = new Array(variants.length).fill(0);
    for (let i = 0; i < this.n; i++) counts[data[i * 6 + 5] | 0]++;
    const make = (Cls, part, cap) => {
      const mesh = new Cls(part.geometry, part.material, Math.max(1, cap));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = !!opts.receive;
      if (part.material.userData.depth) mesh.customDepthMaterial = part.material.userData.depth;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      return mesh;
    };
    // meshes[variant][lod] = one InstancedMesh per part: what the view draws
    this.meshes = variants.map((v, vi) => [v.parts, ...(opts.lod && v.far ? [v.far] : [])].map((parts) => parts.map((part) => make(THREE.InstancedMesh, part, counts[vi]))));
    // casters[variant] = one more per part of the copy that casts (trees cast from the far copy only): what the
    // shadow maps draw - the instances near the eye, in view or not
    this.casters = variants.map((v, vi) =>
      (opts.lod && v.far ? v.far : v.parts).map((part) => {
        const mesh = make(VegCaster, part, counts[vi]);
        mesh.frustumCulled = true; // (so that three asks: only in a shadow map's frustum)
        mesh.castShadow = true;
        mesh.visible = false;
        return mesh;
      }),
    );
    this._idx = new Int32Array(this.n);
    this._d2 = new Float32Array(this.n);
    this._order = new Int32Array(this.n);
    this._bins = new Int32Array(BINS + 1);
    this._k = variants.map(() => [0, 0, 0]);
    this.gone = null; // per instance: 1 while it is left out (a felled tree)
  }

  // leave instance i out (on: true) or draw it again; the buffers are rebuilt with the next update
  hide(i, on = true) {
    if (!this.gone) this.gone = new Uint8Array(this.n);
    this.gone[i] = on ? 1 : 0;
    this.lastX = 1e9;
  }

  showAll() {
    if (!this.gone) return;
    this.gone.fill(0);
    this.lastX = 1e9;
  }

  // view: the ViewCull of this frame (what is outside it is left out of the view's meshes)
  update(cx, cz, radius, view, force = false) {
    if (radius !== this.radius) {
      this.radius = radius;
      force = true;
    }
    const moved = Math.hypot(cx - this.lastX, cz - this.lastZ) >= this.rebuildDist;
    if (!force && !moved && view.stamp === this.stamp) return;
    this.stamp = view.stamp;
    // (who is in range, in which copy and whether it casts is settled where the eye stood at the last full
    // rebuild, as before: the shaders fade by the live distance, with a margin of one rebuild step)
    if (force || moved) {
      this.lastX = cx;
      this.lastZ = cz;
    } else {
      cx = this.lastX;
      cz = this.lastZ;
    }
    const r = this.radius;
    const r2 = r * r;
    const data = this.data;
    const gone = this.gone;
    let nc = 0;
    const c0 = Math.floor((cx - r + CELL_OFF) / CELL);
    const c1 = Math.floor((cx + r + CELL_OFF) / CELL);
    const d0 = Math.floor((cz - r + CELL_OFF) / CELL);
    const d1 = Math.floor((cz + r + CELL_OFF) / CELL);
    for (let i = c0; i <= c1; i++) {
      for (let j = d0; j <= d1; j++) {
        const arr = this.cells.get(i * 1000 + j);
        if (!arr) continue;
        for (const idx of arr) {
          if (gone && gone[idx]) continue;
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
    for (const k of this._k) k[0] = k[1] = k[2] = 0;
    const reach = this.reach;
    // nearest first: what is behind a nearer tree is then not shaded at all (they are opaque where they are not cut
    // away, so the picture is the same whatever the order). A counting sort into rings by distance.
    const order = this._order, bins = this._bins;
    bins.fill(0);
    const ringOf = (BINS - 1) / (r || 1);
    for (let c = 0; c < nc; c++) bins[Math.min(BINS - 1, (Math.sqrt(this._d2[c]) * ringOf) | 0) + 1]++;
    for (let i = 1; i <= BINS; i++) bins[i] += bins[i - 1];
    for (let c = 0; c < nc; c++) order[bins[Math.min(BINS - 1, (Math.sqrt(this._d2[c]) * ringOf) | 0)]++] = c;
    for (let n = 0; n < nc; n++) {
      const c = order[n];
      const dd = this._d2[c];
      const idx = this._idx[c];
      const o = idx * 6;
      const v = data[o + 5] | 0;
      const lods = this.meshes[v];
      const src = this.mats.subarray(idx * 16, idx * 16 + 16);
      const k = this._k[v];
      // into the shadow maps: every one near enough, wherever the eye looks
      if (dd <= cast2) {
        const at = k[2]++ * 16;
        for (const mesh of this.casters[v]) mesh.instanceMatrix.array.set(src, at);
      }
      // into the view: those it can see, the near copy inside the band, the far one outside it
      if (!view.sees(data[o], data[o + 1], data[o + 2], reach[v] * data[o + 3])) continue;
      for (let l = 0; l < lods.length; l++) {
        if (lods.length > 1 && (l === 0 ? dd > nearMax : dd < farMin)) continue;
        const at = k[l]++ * 16;
        for (const mesh of lods[l]) mesh.instanceMatrix.array.set(src, at);
      }
    }
    for (let v = 0; v < this.meshes.length; v++) {
      for (let l = 0; l < this.meshes[v].length; l++) for (const mesh of this.meshes[v][l]) upload(mesh, this._k[v][l]);
      for (const mesh of this.casters[v]) upload(mesh, this._k[v][2]);
    }
  }

  // (geometries and materials belong to the shared variants: only the instance buffers go)
  dispose() {
    for (const mesh of [...this.meshes.flat(2), ...this.casters.flat()]) {
      mesh.removeFromParent();
      mesh.dispose();
    }
  }
}

// ------------------------------------------------------------------ grass
// Clumps on a jittered 0.78 m grid, density from the ground layers (meadows, road verges; sparse under
// canopy). Generated per 8 m chunk once and cached, so a rebuild is only a few bulk copies. The shader thins
// them out by seed towards uGrassFade (no hard edge) and widens the survivors.
// Within GNEAR of the eye a second clump per cell (the infill, its own mesh) closes the cover: one clump a cell
// looks full from a distance, where the clumps overlap, but leaves bare ground showing at your feet.
const GCH = 8;
const GSTEP = 0.78;
const GMAX_CHUNKS = 1500;
const GNEAR = 30;
const GNEAR_CAP = 12288;

class GrassField {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.fields = groundFields(world);
    this.patch = getGrassPatch();
    this.chunks = new Map();
    this.mesh = null;
    this.cap = 0;
    this.near = this._mesh(this.patch.nearMaterial, GNEAR_CAP);
    this.R = 30;
    this.lastX = 1e9;
    this.lastZ = 1e9;
    this.stamp = -1;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._f = {};
  }

  // mul: the grass distance setting
  setQuality(q, mul = 1) {
    this.R = grassRadius(q, mul);
    // (rounded up so dragging the slider does not reallocate the buffer at every step)
    const cap = Math.ceil(((Math.PI * (this.R + GCH) ** 2) / (GSTEP * GSTEP)) * 0.75 / 2048) * 2048;
    if (cap > this.cap) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.dispose();
      }
      this.cap = cap;
      this.mesh = this._mesh(this.patch.material, cap);
    }
    VEG.uGrassFade.value.set(this.R * 0.5, this.R);
    this.nearR = Math.min(GNEAR, this.R);
    VEG.uGrassNear.value.set(this.nearR * 0.5, this.nearR);
    this.lastX = 1e9;
  }

  _mesh(material, cap) {
    const mesh = new THREE.InstancedMesh(this.patch.geometry, material, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    return mesh;
  }

  dispose() {
    for (const mesh of [this.mesh, this.near]) {
      mesh?.removeFromParent();
      mesh?.dispose();
    }
    this.mesh = this.near = null;
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

  // { base, near }: the clumps' instance matrices, one clump a cell and the near infill's second one
  chunk(ci, cj) {
    const key = ci * 8192 + cj;
    let c = this.chunks.get(key);
    if (c) return c;
    const base = [], near = [];
    const x0 = ci * GCH, z0 = cj * GCH;
    const gi0 = Math.ceil(x0 / GSTEP), gi1 = Math.ceil((x0 + GCH) / GSTEP);
    const gj0 = Math.ceil(z0 / GSTEP), gj1 = Math.ceil((z0 + GCH) / GSTEP);
    for (let gi = gi0; gi < gi1; gi++) {
      for (let gj = gj0; gj < gj1; gj++) {
        this.clump(base, gi, gj, 0, (gi + hash2(gi, gj, 3) * 0.85) * GSTEP, (gj + hash2(gi, gj, 7) * 0.85) * GSTEP);
        // (the infill sits half a cell over, between the clumps)
        this.clump(near, gi, gj, 100, (gi + 0.5 + hash2(gi, gj, 23) * 0.85) * GSTEP, (gj + 0.5 + hash2(gi, gj, 29) * 0.85) * GSTEP);
      }
    }
    c = { base: new Float32Array(base), near: new Float32Array(near) };
    this.chunks.set(key, c);
    return c;
  }

  // one clump at x, z (if the ground there grows one) onto out; salt keeps the infill's dice apart from the base's
  clump(out, gi, gj, salt, x, z) {
    const w = this.world;
    if (Math.abs(x) > w.half - 2 || Math.abs(z) > w.half - 2) return;
    const dens = this.density(x, z);
    if (hash2(gi, gj, 91 + salt) > dens) return;
    const y = w.heightAt(x, z);
    if (y < WATER_LEVEL + 0.25) return;
    if (Math.hypot(x - w.car.x, z - w.car.z) < 4) return;
    // skip building floors / props footprints
    const cell = w.staticGrid.cellAt(x, z);
    if (cell) {
      for (const c of cell) {
        if (c.flags & 16) continue; // trees fine
        if (c.y1 < y - 0.5) continue; // (what stands down in the mine is not in the grass's way)
        const lx = c.c * (x - c.x) - c.s * (z - c.z);
        const lz = c.s * (x - c.x) + c.c * (z - c.z);
        if (c.type === 0 ? Math.abs(lx) < c.hx + 0.2 && Math.abs(lz) < c.hz + 0.2 : lx * lx + lz * lz < (c.r + 0.2) ** 2) return;
      }
    }
    const lush = Math.min(1, dens * 1.3);
    // rank patches: taller grass in broad swathes
    const tall = 0.5 + 0.5 * Math.sin(x * 0.13 + Math.sin(z * 0.09) * 1.9) * Math.cos(z * 0.12 - x * 0.04);
    const sc = (0.7 + hash2(gi, gj, 13 + salt) * 0.5) * (0.72 + 0.3 * lush) * (0.85 + 0.35 * tall);
    this._q.setFromAxisAngle(this._up, hash2(gi, gj, 17 + salt) * 6.283);
    this._p.set(x, y - 0.03, z);
    this._s.set(sc, sc * (0.75 + hash2(gi, gj, 19 + salt) * 0.6) * (0.8 + 0.3 * lush), sc);
    this._m.compose(this._p, this._q, this._s);
    const o = out.length;
    out.length += 16;
    this._m.toArray(out, o);
  }

  update(cx, cz, view) {
    if (!this.mesh || (Math.hypot(cx - this.lastX, cz - this.lastZ) < 2 && view.stamp === this.stamp)) return;
    this.stamp = view.stamp;
    const R = this.R + 3;
    const list = [];
    const ci0 = Math.floor((cx - R) / GCH), ci1 = Math.floor((cx + R) / GCH);
    const cj0 = Math.floor((cz - R) / GCH), cj1 = Math.floor((cz + R) / GCH);
    for (let ci = ci0; ci <= ci1; ci++) {
      for (let cj = cj0; cj <= cj1; cj++) {
        const dx = Math.max(0, Math.abs(cx - (ci + 0.5) * GCH) - GCH / 2);
        const dz = Math.max(0, Math.abs(cz - (cj + 0.5) * GCH) - GCH / 2);
        const d2 = dx * dx + dz * dz;
        // (a chunk the view cannot see is not drawn; one never made yet is still made, in its turn, so that
        // turning round finds it there)
        if (d2 < R * R) list.push([d2, ci, cj, view.sees((ci + 0.5) * GCH, this.world.heightAt((ci + 0.5) * GCH, (cj + 0.5) * GCH), (cj + 0.5) * GCH, GCH * 0.75 + 1.5)]);
      }
    }
    list.sort((a, b) => a[0] - b[0]);
    // forget the chunks far behind (key = ci * 8192 + cj, |cj| < 4096), not the whole cache: clearing it all
    // emptied the grass around you for a few frames
    if (this.chunks.size > GMAX_CHUNKS) {
      for (const key of this.chunks.keys()) {
        const ci = Math.round(key / 8192), cj = key - ci * 8192;
        if (Math.hypot((ci + 0.5) * GCH - cx, (cj + 0.5) * GCH - cz) > R + 4 * GCH) this.chunks.delete(key);
      }
    }
    // generate at most a few new chunks per frame (nearest first) so walking never hitches; only the world's
    // first fill makes them all at once (a bigger radius from the settings fills in over a few frames)
    let budget = this.chunks.size ? 10 : 1e9;
    let pending = false;
    const nearR2 = (this.nearR + 3) ** 2;
    const fill = { base: [this.mesh, this.cap, 0], near: [this.near, GNEAR_CAP, 0] };
    for (const [d2, ci, cj, seen] of list) {
      const key = ci * 8192 + cj;
      if (!this.chunks.has(key)) {
        if (budget <= 0) {
          pending = true;
          continue;
        }
        budget--;
      }
      const c = this.chunk(ci, cj);
      if (!seen) continue;
      for (const layer of d2 < nearR2 ? ['base', 'near'] : ['base']) {
        const f = fill[layer], src = c[layer];
        const k = Math.min(src.length / 16, f[1] - f[2]);
        if (k <= 0) continue;
        f[0].instanceMatrix.array.set(k * 16 === src.length ? src : src.subarray(0, k * 16), f[2] * 16);
        f[2] += k;
      }
    }
    if (!pending) {
      this.lastX = cx;
      this.lastZ = cz;
    }
    for (const [mesh, , n] of Object.values(fill)) upload(mesh, n);
  }
}

export class Foliage {
  // grassMul: the grass distance setting
  constructor(scene, world, quality, grassMul = 1) {
    this.world = world;
    this.scene = scene;
    this.view = new ViewCull();
    this.trees = new InstancedSet(scene, world.trees, getTreeVariants(), { radius: quality.treeDist, rebuildDist: 8, stretch: true, lod: true, receive: true });
    this.bushes = new InstancedSet(scene, world.bushes, getBushVariants(), { radius: 85, rebuildDist: 6, receive: true });
    this.rocks = new InstancedSet(scene, world.rocks, getRockVariants(), { radius: quality.treeDist, rebuildDist: 10, receive: true });
    this.grass = new GrassField(scene, world);
    this.falling = new FallingTrees(scene, world, this.trees);
    this.setQuality(quality, grassMul);
  }

  dispose() {
    this.falling.dispose();
    for (const set of [this.trees, this.bushes, this.rocks]) set.dispose();
    this.grass.dispose();
  }

  // Tree i felled (Game.fellTree): out of the forest - crashing down first, toward yaw, when that is given
  fell(i, yaw = null) {
    this.trees.hide(i);
    if (yaw !== null) this.falling.fell(i, yaw, VEG.uVegCam.value.x, VEG.uVegCam.value.z);
  }

  // dawn: every felled tree stands again
  regrow() {
    this.falling.clear();
    this.trees.showAll();
  }

  setQuality(q, grassMul = 1) {
    this.quality = q;
    const sd = q.shadows ? q.shadowDist : 0;
    // tall trees just outside the shadow range still throw shadows into it
    this.trees.castDist = sd ? sd + 25 : 0;
    this.bushes.castDist = sd && q.foliageShadows ? Math.min(sd, 40) : 0;
    this.rocks.castDist = sd && q.foliageShadows ? Math.min(sd, 90) : 0;
    const mid = Math.max(35, q.treeDist * 0.25);
    this.trees.lodBand = [mid - 7, mid + 7];
    VEG.uTreeLod.value.set(mid - 7, mid + 7);
    this.grass.setQuality(q, grassMul);
    this.trees.lastX = this.bushes.lastX = this.rocks.lastX = 1e9;
  }

  // weather: { wind, windX, windZ } (optional). Drives the global wind: 0.3 is the everyday breeze, ~1.2 a gale
  // (gusts included); the sway clock runs faster in strong wind.
  // camera: what is drawn is culled to its view (none: everything within range, as the sandbox pages draw it)
  update(camPos, fogVisibility, time, weather, camera = null) {
    VEG.uVegCam.value.copy(camPos);
    const view = this.view;
    view.update(camera);
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
    this.trees.update(camPos.x, camPos.z, Math.round(treeR / 10) * 10, view);
    this.bushes.update(camPos.x, camPos.z, Math.min(85, fogVisibility + 10), view);
    this.rocks.update(camPos.x, camPos.z, Math.round(treeR / 10) * 10, view);
    this.grass.update(camPos.x, camPos.z, view);
    this.falling.update(dt);
  }
}
