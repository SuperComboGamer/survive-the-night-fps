// Gun rig: skinned instance of a model built with the kit (geo.js). Bones = rigid parts (identity rotation at rest),
// one SkinnedMesh per material sharing one skeleton. Sockets (muzzle, ejection port, sights, hand grips...) are evaluated
// in rig space from the bone chain without allocations.
import * as THREE from 'three';
import { Kit } from './geo.js';

const ZERO = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _id = new THREE.Matrix4();
const cache = new Map();

/** Build (once) the geometry + metadata for a model definition { id, build(K, mats) -> meta }. */
export function modelData(def, mats) {
  let d = cache.get(def.id); if (d) return d;
  const t0 = performance.now(); const K = new Kit(def.id); const meta = def.build(K, mats) || {};
  const t1 = performance.now(); const { geos, box, tris } = K.geometry();
  const t2 = performance.now(); bakeCavity(geos);
  d = { def, K, geos, box, tris, meta, ms: performance.now() - t0, msBuild: t1 - t0, msMerge: t2 - t1, msBake: performance.now() - t2 }; cache.set(def.id, d); return d;
}

/**
 * Build-time baked detail (zero runtime cost): per-vertex attribute aCav = (ambient occlusion, convexity) computed once on the final
 * rest-pose geometry of the whole gun (all materials together, so the stock occludes the receiver, the guard occludes the trigger...).
 * AO: disk-to-point occlusion (Bunnell): every other vertex is a small disk of its area; occlusion += area * cos_i * |cos_j| / (pi r^2 + area)
 * for occluders above the tangent plane within 16 mm. Convexity: neighbours within 2.5 mm lying below the tangent plane => an outside edge
 * (where handling wears the finish to bare metal / raw wood). Uniform grid (counting sort) => ~O(V * k), a few ms per thousand vertices.
 */
export function bakeCavity(geos) {
  const list = [...geos.values()]; let N = 0; for (const g of list) N += g.attributes.position.count;
  const P = new Float32Array(N * 3), Nn = new Float32Array(N * 3), A = new Float32Array(N); let o = 0;
  for (const g of list) {
    const pa = g.attributes.position.array, n = g.attributes.position.count; P.set(pa, o * 3); Nn.set(g.attributes.normal.array, o * 3);
    const I = g.index.array; for (let k = 0; k < I.length; k += 3) { const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ux = pa[b] - pa[a], uy = pa[b + 1] - pa[a + 1], uz = pa[b + 2] - pa[a + 2], vx = pa[c] - pa[a], vy = pa[c + 1] - pa[a + 1], vz = pa[c + 2] - pa[a + 2];
      const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3; A[o + I[k]] += ar; A[o + I[k + 1]] += ar; A[o + I[k + 2]] += ar; }
    o += n;
  }
  // occluders = surface area lumped into 3 mm voxels (area-weighted centroid) => a few hundred occluders per vertex neighbourhood, not thousands.
  // Dense typed-array voxel grid (dense typed-array voxel grid replaces the old Map keyed by cell: the high-density gun models made the Map version the dominant build cost).
  const V = 0.003, RC = 3, R2 = (RC * V) * (RC * V); let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < N; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z; if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z; }
  const GX = Math.floor((mxx - mnx) / V) + 1, GY = Math.floor((mxy - mny) / V) + 1, GZ = Math.floor((mxz - mnz) / V) + 1;
  const head = new Int32Array(GX * GY * GZ).fill(-1), CX = new Float64Array(N), CY = new Float64Array(N), CZ = new Float64Array(N), CA = new Float64Array(N); let nc = 0;
  for (let i = 0; i < N; i++) { const ix = Math.floor((P[i * 3] - mnx) / V), iy = Math.floor((P[i * 3 + 1] - mny) / V), iz = Math.floor((P[i * 3 + 2] - mnz) / V), id = (iz * GY + iy) * GX + ix;
    let k = head[id]; if (k < 0) k = head[id] = nc++; const a = A[i] + 1e-9; CX[k] += P[i * 3] * a; CY[k] += P[i * 3 + 1] * a; CZ[k] += P[i * 3 + 2] * a; CA[k] += a; }
  for (let k = 0; k < nc; k++) { CX[k] /= CA[k]; CY[k] /= CA[k]; CZ[k] /= CA[k]; }
  const out = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2], nx = Nn[i * 3], ny = Nn[i * 3 + 1], nz = Nn[i * 3 + 2];
    const cx = Math.floor((px - mnx) / V), cy = Math.floor((py - mny) / V), cz = Math.floor((pz - mnz) / V); let ao = 0, cv = 0, cn = 0;
    const x0 = Math.max(0, cx - RC), x1 = Math.min(GX - 1, cx + RC), y0 = Math.max(0, cy - RC), y1 = Math.min(GY - 1, cy + RC), z0 = Math.max(0, cz - RC), z1 = Math.min(GZ - 1, cz + RC);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) { let id = (z * GY + y) * GX + x0;
      for (let x = x0; x <= x1; x++, id++) { const k = head[id]; if (k < 0) continue;
        const ux = CX[k] - px, uy = CY[k] - py, uz = CZ[k] - pz, r2 = ux * ux + uy * uy + uz * uz; if (r2 > R2 || r2 < 1e-10) continue;
        const r = Math.sqrt(r2), ci = (ux * nx + uy * ny + uz * nz) / r;
        if (r < 0.0035) { cv += ci; cn++; }
        if (ci > 0.15) ao += CA[k] * (ci - 0.15) / (Math.PI * r2 + CA[k]);
      } }
    out[i * 2] = Math.min(1, ao * 0.9); out[i * 2 + 1] = cn ? Math.max(0, Math.min(1, -cv / cn * 2)) : 0;
  }
  o = 0; for (const g of list) { const n = g.attributes.position.count; g.setAttribute('aCav', new THREE.BufferAttribute(out.slice(o * 2, (o + n) * 2), 2)); o += n; }
}
export function resolveMat(mats, key) { return mats.lib.get(key) || mats.get(key); }

export class GunRig {
  /** data: modelData(); layer: 1 = viewmodel, 0 = world. skinned=false => static meshes (rest pose), no bones. */
  constructor(data, mats, { layer = 1, skinned = true, shadow = false } = {}) {
    this.data = data; this.id = data.def.id; this.meta = data.meta; this.group = new THREE.Group(); this.group.name = 'gun:' + this.id; this.meshes = [];
    this.bones = {}; this.boneList = []; this.parentIdx = []; this.rel = []; this.restPos = [];
    const K = data.K;
    if (skinned) {
      for (const part of K.parts) {
        const b = new THREE.Bone(); b.name = part.name; const pp = part.parent ? part.parent.pivot : ZERO; b.position.copy(part.pivot).sub(pp);
        this.restPos.push(b.position.clone()); (part.parent ? this.bones[part.parent.name] : this.group).add(b);
        this.bones[part.name] = b; this.boneList.push(b); this.parentIdx.push(part.parent ? part.parent.index : -1); this.rel.push(new THREE.Matrix4());
      }
      this.group.updateMatrixWorld(true); this.skeleton = new THREE.Skeleton(this.boneList);
    }
    for (const [mk, g] of data.geos) {
      const mat = resolveMat(mats, mk); const m = skinned ? new THREE.SkinnedMesh(g, mat) : new THREE.Mesh(g, mat);
      if (skinned) m.bind(this.skeleton, _id); m.frustumCulled = !skinned; m.castShadow = shadow; m.receiveShadow = true; m.layers.set(layer); m.name = this.id + ':' + mk; this.group.add(m); this.meshes.push(m);
    }
    // sockets: precompute local matrix (inverse rest pivot x socket frame)
    this.sockets = {};
    for (const [name, s] of Object.entries(K.sockets)) {
      const part = K.byName[s.part]; const loc = new THREE.Matrix4().compose(s.pos, s.quat, new THREE.Vector3(1, 1, 1)); loc.premultiply(new THREE.Matrix4().makeTranslation(-part.pivot.x, -part.pivot.y, -part.pivot.z));
      this.sockets[name] = { bone: part.index, local: loc, pos: s.pos.clone(), quat: s.quat.clone() };
    }
    this.layer = layer;
  }
  /** set a part pose relative to rest: translation (parent space, metres) + euler radians (XYZ) */
  set(name, tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0) {
    const b = this.bones[name]; if (!b) return; const i = this.boneList.indexOf(b); const r = this.restPos[i];
    b.position.set(r.x + tx, r.y + ty, r.z + tz); _e.set(rx, ry, rz, 'XYZ'); b.quaternion.setFromEuler(_e);
  }
  /** fast variant by bone index */
  setI(i, tx, ty, tz, rx, ry, rz) { const b = this.boneList[i], r = this.restPos[i]; b.position.set(r.x + tx, r.y + ty, r.z + tz); _e.set(rx, ry, rz, 'XYZ'); b.quaternion.setFromEuler(_e); }
  scale(name, s) { const b = this.bones[name]; if (b) b.scale.setScalar(Math.max(s, 1e-4)); }
  index(name) { const b = this.bones[name]; return b ? this.boneList.indexOf(b) : -1; }
  reset() { for (let i = 0; i < this.boneList.length; i++) { const b = this.boneList[i]; b.position.copy(this.restPos[i]); b.quaternion.identity(); b.scale.set(1, 1, 1); } }
  /** recompute rig-space bone matrices (call after setting bones, before socket queries) */
  solve() { for (let i = 0; i < this.boneList.length; i++) { const b = this.boneList[i]; b.updateMatrix(); const p = this.parentIdx[i]; if (p < 0) this.rel[i].copy(b.matrix); else this.rel[i].multiplyMatrices(this.rel[p], b.matrix); } }
  /** socket frame in rig space -> out (Matrix4) */
  socket(name, out) { const s = this.sockets[name]; if (!s) return out.identity(); return out.multiplyMatrices(this.rel[s.bone], s.local); }
  has(name) { return !!this.sockets[name]; }
  setVisible(v) { this.group.visible = v; }
}
