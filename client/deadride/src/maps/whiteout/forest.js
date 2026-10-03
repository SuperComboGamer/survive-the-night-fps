// The pine forest as a DYNAMIC 3-level LOD instancing system: ~4600 trees live in flat Float32Arrays; a handful of pre-allocated InstancedMeshes
// (one per near species + one mid + one far = ~8 draw calls for the whole forest, whatever the view) are refilled whenever the camera has moved / turned enough.
//   near  (< R0, ~3 k tris)   full conifer, 6 species (spruces, fir, stone pine, snag, broken top)
//   mid   (R0..R1, ~450 tris) one shared boughs-only geometry
//   far   (R1..fog limit)     ~70 tri cone silhouette; the limit follows the live fog density (5 % transmittance), so the storm at the summit culls earlier
// Trees clearly behind the camera are skipped, so a hero view submits a few hundred trees instead of thousands. Refill cost: one pass over the tree arrays
// (0.05 ms) + copying <= ~1500 matrices; uploads use update ranges. No per-frame allocation.
import * as THREE from 'three';
import { G } from '../../core/mats.js';

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), CC = new THREE.Color();

export class Forest {
  /** geos: {near:[geo..species], mid, far}; heights {near:[h..], mid}; caps per LOD */
  constructor(parent, { geos, heights, mat, R0 = 32, R1 = 95, capNear = 240, capMid = 1800, capFar = 4200 }) {
    this.parent = parent; this.geos = geos; this.h = heights; this.mat = mat; this.R0 = R0; this.R1 = R1; this.cap = { near: capNear, mid: capMid, far: capFar };
    this.list = []; this.n = 0; this.far = 500; this._cam = new THREE.Vector3(1e9, 0, 1e9); this._yaw = 1e9; this._dens = -1; this._inited = false; this.stats = null;
  }
  /** one tree: position, yaw, tilt, scale (sx,sy,sz), tint, species */
  add(x, y, z, yaw, tx, tz, sx, sy, sz, tint, sp) { this.list.push({ x, y, z, yaw, tx, tz, sx, sy, sz, tint, sp }); this.n++; }
  finish() {
    const n = this.n; this.X = new Float32Array(n * 3); this.sp = new Uint8Array(n); this.mn = new Float32Array(n * 16); this.mm = new Float32Array(n * 16); this.col = new Float32Array(n * 3);
    this.list.forEach((t, i) => { this.X[i * 3] = t.x; this.X[i * 3 + 1] = t.y; this.X[i * 3 + 2] = t.z; this.sp[i] = t.sp; E.set(t.tx, t.yaw, t.tz, 'YXZ'); Q.setFromEuler(E); P.set(t.x, t.y, t.z);
      S.set(t.sx, t.sy, t.sz); M4.compose(P, Q, S); M4.toArray(this.mn, i * 16); const k = this.h.near[t.sp] / this.h.mid; S.set(t.sx * k, t.sy * k, t.sz * k); M4.compose(P, Q, S); M4.toArray(this.mm, i * 16);
      CC.setRGB(t.tint, t.tint * 0.98, t.tint); this.col[i * 3] = CC.r; this.col[i * 3 + 1] = CC.g; this.col[i * 3 + 2] = CC.b; });
    this.list = null;
    const mk = (geo, cap, name) => { const im = new THREE.InstancedMesh(geo, this.mat, cap); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; im.matrixAutoUpdate = false; im.name = name; im.count = 1; this.parent.add(im); return im; };   // count 1 until the first update(): world.warm() then compiles the program
    this.near = this.geos.near.map((g, i) => mk(g, this.cap.near, 'forest-near' + i)); this.mid = mk(this.geos.mid, this.cap.mid, 'forest-mid'); this.farM = mk(this.geos.far, this.cap.far, 'forest-far');
    return this;
  }
  /** call every frame with the camera position and forward direction; refills only when the camera moved > 4 m or turned > 10 deg (or the fog changed) */
  update(cam, dir) {
    if (!this.X) return; const dens = G.uFogParams.value.x, yaw = Math.atan2(dir.x, dir.z);
    if (this._inited && cam.distanceToSquared(this._cam) < 16 && Math.abs(Math.atan2(Math.sin(yaw - this._yaw), Math.cos(yaw - this._yaw))) < 0.17 && Math.abs(dens - this._dens) < 0.002) return;
    this._cam.copy(cam); this._yaw = yaw; this._dens = dens; this._inited = true; this.far = Math.min(520, Math.max(110, 4.2 / Math.max(dens, 0.004)));
    const R0s = this.R0 * this.R0, R1s = this.R1 * this.R1, Fs = this.far * this.far, cx = cam.x, cz = cam.z, dl = Math.hypot(dir.x, dir.z) || 1, fx = dir.x / dl, fz = dir.z / dl;
    const cnt = this._cnt || (this._cnt = this.near.map(() => 0)); cnt.fill(0); let nm = 0, nf = 0; const X = this.X, sp = this.sp, capN = this.cap.near, capM = this.cap.mid, capF = this.cap.far;
    for (let i = 0, n = this.n; i < n; i++) {
      const dx = X[i * 3] - cx, dz = X[i * 3 + 2] - cz, d2 = dx * dx + dz * dz; if (d2 > Fs) continue;
      if (d2 > 900 && (dx * fx + dz * fz) < -0.3 * Math.sqrt(d2)) continue;                                                       // clearly behind the camera
      if (d2 < R0s) { const k = sp[i], im = this.near[k], c = cnt[k]; if (c < capN) { im.instanceMatrix.array.set(this.mn.subarray(i * 16, i * 16 + 16), c * 16); im.instanceColor.array.set(this.col.subarray(i * 3, i * 3 + 3), c * 3); cnt[k] = c + 1; } }
      else if (d2 < R1s) { if (nm < capM) { this.mid.instanceMatrix.array.set(this.mm.subarray(i * 16, i * 16 + 16), nm * 16); this.mid.instanceColor.array.set(this.col.subarray(i * 3, i * 3 + 3), nm * 3); nm++; } }
      else if (nf < capF) { this.farM.instanceMatrix.array.set(this.mm.subarray(i * 16, i * 16 + 16), nf * 16); this.farM.instanceColor.array.set(this.col.subarray(i * 3, i * 3 + 3), nf * 3); nf++; }
    }
    const fin = (im, c) => { im.count = c; im.instanceMatrix.clearUpdateRanges(); im.instanceColor.clearUpdateRanges(); if (c > 0) { im.instanceMatrix.addUpdateRange(0, c * 16); im.instanceColor.addUpdateRange(0, c * 3); } im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.visible = c > 0; };
    for (let k = 0; k < this.near.length; k++) fin(this.near[k], cnt[k]); fin(this.mid, nm); fin(this.farM, nf);
    this.stats = { near: cnt.reduce((a, b) => a + b, 0), mid: nm, far: nf };
  }
}
