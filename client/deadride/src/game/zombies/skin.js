// Pooled render body: one THREE.SkinnedMesh per zombie (1 draw call + 1 per shadow-casting light), bone matrices written by
// our own FK (Pose.writeSkin) straight into the skeleton's bone texture — no Object3D bone hierarchy is updated. The mesh sits
// at the zombie's root position (so three's frustum culling — incl. shadow frusta — works with a fixed bounding sphere), and
// the shared variant geometry holds 3 LODs as index ranges: onBeforeRender / onBeforeShadow pick the range per pass.
import * as THREE from 'three';
import { NB } from './rig.js';
import { createZombieMaterial, createDepthMaterial, makeUniforms } from './shading.js';

const _id = new THREE.Matrix4();
/** triangles / draws issued by zombie bodies since the last ZombieManager.update (main view, sun shadow, spot/point shadows) */
export const DRAW = { tris: 0, calls: 0, sunTris: 0, sunCalls: 0, spotTris: 0, spotCalls: 0 };
export class ZombieBody {
  constructor() {
    const bones = []; for (let i = 0; i < NB; i++) bones.push(new THREE.Bone());
    this.skeleton = new THREE.Skeleton(bones); this.skeleton.computeBoneTexture();
    this.skeleton.update = () => {}; // we write boneMatrices ourselves
    this.u = makeUniforms(); this.material = createZombieMaterial(this.u); this.matFar = createZombieMaterial(this.u, true); this.depth = createDepthMaterial(this.u); // matFar: LOD2 shader
    this.mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), this.material);
    this.mesh.bindMode = THREE.DetachedBindMode; this.mesh.bind(this.skeleton, _id);
    this.mesh.customDepthMaterial = this.depth; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true; this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.75);
    this.mesh.matrixAutoUpdate = true; this.mesh.visible = false; this.mesh.name = 'zombie';
    this.lod = 0; this.shadowLod = 2; this.lods = null;
    const self = this;
    this.mesh.onBeforeRender = function (r, s, c, geometry) { const l = self.lods[self.lod]; geometry.drawRange.start = l.start; geometry.drawRange.count = l.count; DRAW.tris += l.count / 3; DRAW.calls++; };
    // sun (orthographic) shadow: LOD1 for LOD0 bodies else LOD2; spot / point light shadows (perspective): always LOD2
    this.mesh.onBeforeShadow = function (r, o, c, sc, geometry) { const persp = sc && sc.isPerspectiveCamera; const l = self.lods[persp ? 2 : self.shadowLod]; geometry.drawRange.start = l.start; geometry.drawRange.count = l.count;
      if (persp) { DRAW.spotTris += l.count / 3; DRAW.spotCalls++; } else { DRAW.sunTris += l.count / 3; DRAW.sunCalls++; } };
  }
  setGeometry(fin) { this.mesh.geometry = fin.geometry; this.lods = fin.lods; this.mesh.boundingSphere.set(new THREE.Vector3(0, 0.9, 0), 1.75); }
  /** write pose skin matrices; origin = mesh position (world) */
  writePose(pose) { this.mesh.position.copy(pose.rootPos); pose.writeSkin(this.skeleton.boneMatrices, pose.rootPos); this.skeleton.boneTexture.needsUpdate = true; }
  writePoseAt(pose, origin) { this.mesh.position.copy(origin); pose.writeSkin(this.skeleton.boneMatrices, origin); this.skeleton.boneTexture.needsUpdate = true; }
}
