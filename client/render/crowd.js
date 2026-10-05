// The dead as a crowd: every zombie that shares a body (a rig's geometry: a type, a variant, the near or the far
// copy) is drawn in ONE instanced draw call, and the bones of all of them are in one texture uploaded once a frame.
//
// Drawn each as a SkinnedMesh of its own (models/characters.js), a horde of two hundred is six hundred draw calls a
// frame - the view and the two shadow cascades - and two hundred small texture uploads, and the time that takes is
// spent on the CPU issuing them, not on the card. Here a zombie is a "member": it keeps its own skeleton pose
// (ZombieInstance computes it as before, only for those that are drawn), and
//   - its bone matrices are a row of the crowd's bone texture (RGBA float, four texels a bone, MAX_BONES bones);
//   - the batch of its geometry holds, per instance, its world matrix and its row; the vertex shader skins from that
//     row. The skinning is three's own sum (two bones a vertex, as every rig here has), written out for a row;
//   - who is drawn is decided here once a frame: in the view those whose bounding sphere is in the frustum, in the
//     shadow maps those that cast and are within the shadows' range of the eye (each batch has a second mesh that is
//     only in shadow maps, with its own list).
// A zombie that is not in a crowd (a sandbox page, the survivor picker) is drawn by its own mesh, as before.
import * as THREE from 'three';
import { isShadowFrustum } from './multimesh.js';

export const MAX_BONES = 32; // (the Hive Queen has 31)
const ROWS = 64; // the bone texture grows by this many rows
const ROW = MAX_BONES * 16; // floats in a row

const CROWD_PARS = /* glsl */ `
attribute float aRow;
uniform highp sampler2D uCrowdBones;
mat4 crowdBone( const in float i ) {
  int x = int( i ) * 4;
  int y = int( aRow );
  return mat4( texelFetch( uCrowdBones, ivec2( x, y ), 0 ), texelFetch( uCrowdBones, ivec2( x + 1, y ), 0 ), texelFetch( uCrowdBones, ivec2( x + 2, y ), 0 ), texelFetch( uCrowdBones, ivec2( x + 3, y ), 0 ) );
}
`;

/**
 * Makes a material (or a depth material) skin from the crowd's bone texture: call from its onBeforeCompile, after
 * anything else that patches it. The rigs are bound detached with identity bind matrices (skinning.js
 * instantiateRig), so three's skinning is just the weighted sum of the bone matrices.
 */
export function patchCrowdShader(shader, bones) {
  shader.uniforms.uCrowdBones = bones;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute vec4 skinIndex;\nattribute vec4 skinWeight;\n${CROWD_PARS}`)
    .replace('#include <skinbase_vertex>', '#include <skinbase_vertex>\nmat4 crowdX = crowdBone( skinIndex.x );\nmat4 crowdY = crowdBone( skinIndex.y );')
    .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\nobjectNormal = ( ( skinWeight.x * crowdX + skinWeight.y * crowdY ) * vec4( objectNormal, 0.0 ) ).xyz;')
    .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n{ vec4 crowdV = vec4( transformed, 1.0 ); transformed = ( crowdX * crowdV * skinWeight.x + crowdY * crowdV * skinWeight.y ).xyz; }');
}

const _sphere = new THREE.Sphere();
const _m = new THREE.Matrix4();
// one more instance of a batch's mesh: its matrix and its row
function put(t, e, row) {
  const k = t.count++;
  const a = t.instanceMatrix.array;
  for (let i = 0, o = k * 16; i < 16; i++) a[o + i] = e[i];
  t.geometry.attributes.aRow.array[k] = row;
}
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();

function inScene(o, scene) {
  while (o.parent) o = o.parent;
  return o === scene;
}

// a batch's mesh that is only ever in shadow maps
class CrowdCaster extends THREE.InstancedMesh {
  intersectsFrustum(frustum) {
    return this.count > 0 && isShadowFrustum(this, frustum);
  }
}

class Batch {
  constructor(crowd, geometry) {
    this.crowd = crowd;
    this.source = geometry;
    this.members = new Set();
    this.cap = 0;
    this.view = null;
    this.cast = null;
    this.grow(16);
  }

  // one of the two meshes: the rig's own vertex and index buffers, and this mesh's rows
  make(Cls, material, cap) {
    const g = new THREE.BufferGeometry();
    for (const name in this.source.attributes) g.setAttribute(name, this.source.attributes[name]);
    g.setIndex(this.source.index);
    g.setAttribute('aRow', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(); // (the crowd culls its members itself)
    const m = new Cls(g, material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.matrixAutoUpdate = false;
    m.name = 'crowd';
    return m;
  }

  grow(cap) {
    const { crowd } = this;
    for (const m of [this.view, this.cast]) {
      if (!m) continue;
      crowd.group.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    this.cap = cap;
    this.view = this.make(THREE.InstancedMesh, crowd.material, cap);
    this.view.frustumCulled = false;
    this.view.receiveShadow = false;
    this.cast = this.make(CrowdCaster, crowd.material, cap);
    this.cast.customDepthMaterial = crowd.depthMaterial;
    this.cast.castShadow = true;
    this.cast.frustumCulled = true; // (so that three asks: only a shadow map's frustum is it in)
    crowd.group.add(this.view, this.cast);
  }
}

export class Crowd {
  /**
   * scene: where the dead are drawn. material: the characters' material, made to skin from `bones` (the uniform
   * { value } this crowd fills: getCrowdMaterial in models/skinning.js). castRange(): how far from the eye a body
   * still casts into a shadow map (m).
   */
  constructor(scene, material, bones, castRange = () => 120) {
    this.scene = scene;
    this.material = material;
    this.bones = bones;
    this.castRange = castRange;
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (sh) => patchCrowdShader(sh, bones);
    this.depthMaterial.customProgramCacheKey = () => 'stn-crowd-depth-v1';
    this.group = new THREE.Group();
    this.group.name = 'crowd';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    // Where the members' own objects are kept: out of the scene. Nothing of them is drawn from there (the batches
    // are), so the renderer need not walk three objects a zombie every frame to find that out; where each stands is
    // read here from its root's position and facing.
    this.holder = new THREE.Group();
    this.holder.name = 'crowd-members';
    this.batches = new Map(); // geometry -> Batch
    this.members = new Set();
    this.rows = []; // row -> member (or undefined: free)
    this.data = null;
    this.texture = null;
    this.resize(ROWS);
    this.drawn = 0;
    // three calls this as a frame of the scene begins, its matrices made and nothing culled yet
    this.prev = scene.onBeforeRender;
    scene.onBeforeRender = (renderer, sc, camera, target) => {
      this.prev?.call(sc, renderer, sc, camera, target);
      this.build(camera);
    };
  }

  resize(rows) {
    const data = new Float32Array(rows * ROW);
    if (this.data) data.set(this.data);
    this.texture?.dispose();
    this.data = data;
    this.texture = new THREE.DataTexture(data, MAX_BONES * 4, rows, THREE.RGBAFormat, THREE.FloatType);
    this.texture.needsUpdate = true;
    this.bones.value = this.texture;
  }

  /** The batch of a rig's geometry, made if need be (Game.warmViews makes one before play: its programs are built with the scene's). */
  batch(geometry) {
    let b = this.batches.get(geometry);
    if (!b) this.batches.set(geometry, (b = new Batch(this, geometry)));
    return b;
  }

  /**
   * A zombie joins: { root (the object the game moves and turns), body (its scale), mesh (its SkinnedMesh: its
   * bounding sphere, whether it casts), geometry (what it
   * is drawn with now: the near or the far copy), solve(out, offset) (writes its bone matrices if they changed,
   * returns whether they did), seen() (told when it is drawn) }. Its own mesh is no longer drawn.
   */
  add(member) {
    if (member.crowd === this) return;
    member.crowd = this;
    let row = this.rows.indexOf(undefined);
    if (row < 0) row = this.rows.length;
    if ((row + 1) * ROW > this.data.length) this.resize(this.data.length / ROW + ROWS);
    this.rows[row] = member;
    member.row = row;
    member.fresh = true; // (its row holds nothing of its own yet)
    member.mesh.visible = false;
    if (member.root.parent === this.scene) this.holder.add(member.root);
    this.members.add(member);
  }

  remove(member) {
    if (member.crowd !== this) return;
    this.members.delete(member);
    this.rows[member.row] = undefined;
    while (this.rows.length && this.rows[this.rows.length - 1] === undefined) this.rows.pop();
    member.crowd = null;
    member.mesh.visible = true;
    if (member.root.parent === this.holder) this.scene.add(member.root);
  }

  // who is drawn this frame, and their bones
  build(camera) {
    for (const b of this.batches.values()) b.view.count = b.cast.count = 0;
    if (!this.members.size) return;
    _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const planes = _frustum.planes;
    const ce = camera.matrixWorld.elements;
    const range = this.castRange();
    const r2 = range * range;
    let dirty = false;
    let drawn = 0;
    for (const m of this.members) {
      const mesh = m.mesh;
      // (its own mesh is hidden; whether the zombie is shown is its parents' say)
      let shown = true;
      for (let o = mesh.parent; o && shown; o = o.parent) shown = o.visible;
      // (out of the scene it has no say in: a root taken from the holder by other hands is not drawn)
      if (m.root.parent !== this.holder && !inScene(mesh, this.scene)) shown = false;
      if (!shown) continue;
      // where it stands: its root's position and turn about the vertical, its body's scale (a zombie has no other
      // transform); anything else is worked out the long way
      const root = m.root, body = m.body;
      const rot = root.rotation, pos = root.position, bs = body.scale;
      const e = _m.elements;
      if (rot.x === 0 && rot.z === 0 && root.parent === this.holder) {
        const cy = Math.cos(rot.y), sy = Math.sin(rot.y);
        e[0] = cy * bs.x; e[1] = 0; e[2] = -sy * bs.x; e[3] = 0;
        e[4] = 0; e[5] = bs.y; e[6] = 0; e[7] = 0;
        e[8] = sy * bs.z; e[9] = 0; e[10] = cy * bs.z; e[11] = 0;
        e[12] = pos.x; e[13] = pos.y; e[14] = pos.z; e[15] = 1;
      } else {
        mesh.updateWorldMatrix(true, false);
        _m.copy(mesh.matrixWorld);
      }
      _sphere.copy(mesh.boundingSphere).applyMatrix4(_m);
      const c = _sphere.center, r = _sphere.radius;
      let inView = true;
      for (let p = 0; p < 6 && inView; p++) inView = planes[p].normal.x * c.x + planes[p].normal.y * c.y + planes[p].normal.z * c.z + planes[p].constant >= -r;
      const dx = c.x - ce[12], dy = c.y - ce[13], dz = c.z - ce[14];
      const casts = mesh.castShadow && r2 > 0 && dx * dx + dy * dy + dz * dz < (range + r) * (range + r);
      if (!inView && !casts) continue;
      if (m.solve(this.data, m.row * ROW, m.fresh)) dirty = true;
      m.fresh = false;
      m.seen();
      drawn++;
      const b = this.batch(m.geometry);
      if (b.view.count >= b.cap || b.cast.count >= b.cap) {
        // (rare: a batch outgrown mid-frame. Its lists so far are kept)
        const [nv, nc] = [b.view, b.cast];
        b.grow(b.cap * 2);
        for (const [from, to] of [[nv, b.view], [nc, b.cast]]) {
          to.instanceMatrix.array.set(from.instanceMatrix.array.subarray(0, from.count * 16));
          to.geometry.attributes.aRow.array.set(from.geometry.attributes.aRow.array.subarray(0, from.count));
          to.count = from.count;
        }
      }
      if (inView) put(b.view, e, m.row);
      if (casts) put(b.cast, e, m.row);
    }
    this.drawn = drawn;
    for (const b of this.batches.values()) {
      for (const t of [b.view, b.cast]) {
        t.visible = t.count > 0;
        if (!t.count) continue;
        t.instanceMatrix.clearUpdateRanges();
        t.instanceMatrix.addUpdateRange(0, t.count * 16);
        t.instanceMatrix.needsUpdate = true;
        const rows = t.geometry.attributes.aRow;
        rows.clearUpdateRanges();
        rows.addUpdateRange(0, t.count);
        rows.needsUpdate = true;
      }
    }
    if (dirty) this.texture.needsUpdate = true;
  }

  dispose() {
    this.scene.onBeforeRender = this.prev || (() => {});
    this.scene.remove(this.group);
    for (const m of [...this.members]) this.remove(m);
    for (const b of this.batches.values()) {
      for (const t of [b.view, b.cast]) {
        t.geometry.dispose();
        t.dispose();
      }
    }
    this.texture.dispose();
    this.depthMaterial.dispose();
  }
}
