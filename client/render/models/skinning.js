// Helpers for procedural, rigidly-skinned character meshes.
//
// A MeshBuilder collects bones (bind pose = pure translations, identity rotations) and body parts
// built from primitives relative to their bone's bind position. build() merges everything into ONE
// indexed BufferGeometry with vertex colors, atlas UVs, a glow attribute and rigid skinning
// (skinIndex = part bone, skinWeight = 1). Each instance gets its own THREE.Skeleton while geometry
// and material are shared.
//
// Per-instance shader parameters (hit flash, glow multiplier) are passed through a hidden bone at
// skeleton index 0 ("fx bone"): it is not part of the scene graph, its matrixWorld is written directly
// and the skinning vertex shader reads getBoneMatrix(0.0)[3].xyz. No material clones, no per-draw
// uniform uploads (MeshLambertMaterial does not honor uniformsNeedUpdate).
import * as THREE from 'three';
import { regionUV, getCharAtlas, getWeaponAtlas, fbm3, noise3, mulberry32 } from './charTextures.js';

export { fbm3, noise3, mulberry32 };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Matrix4();

export function color(hex) {
  if (hex && hex.isColor) return hex.clone();
  if (Array.isArray(hex)) return new THREE.Color(hex[0], hex[1], hex[2]);
  return new THREE.Color(hex);
}

// ------------------------------------------------------------------ primitive geometry
/** Tapered capsule-ish lathe along +Y from y=0 (radius r0) to y=len (radius r1). */
function capsuleGeo(r0, r1, len, rs, hs, caps, capScale) {
  const pts = [];
  const cs = capScale;
  if (caps >= 2) {
    pts.push(new THREE.Vector2(0, -r0 * cs));
    pts.push(new THREE.Vector2(r0 * 0.72, -r0 * cs * 0.7));
  } else if (caps === 1) {
    pts.push(new THREE.Vector2(0, -r0 * cs));
  }
  for (let i = 0; i <= hs; i++) {
    const t = i / hs;
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * t, len * t));
  }
  if (caps >= 2) {
    pts.push(new THREE.Vector2(r1 * 0.72, len + r1 * cs * 0.7));
    pts.push(new THREE.Vector2(0, len + r1 * cs));
  } else if (caps === 1) {
    pts.push(new THREE.Vector2(0, len + r1 * cs));
  }
  return new THREE.LatheGeometry(pts, rs);
}

function applyShape(geo, shape) {
  if (!shape) return;
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    shape(_v);
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
}

function roundBox(geo, sx, sy, sz, round) {
  const p = geo.attributes.position;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    // project onto ellipsoid and blend
    _v2.set(_v.x / hx, _v.y / hy, _v.z / hz).normalize();
    _v2.set(_v2.x * hx * 1.15, _v2.y * hy * 1.15, _v2.z * hz * 1.15);
    _v.lerp(_v2, round);
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
}

// ------------------------------------------------------------------ builder
/**
 * Collects bones + parts. All part coordinates are relative to the bone's bind position
 * (bind rotations are identity, so bone-local axes == model axes).
 */
export class MeshBuilder {
  constructor({ skinned = true, atlas = 'char' } = {}) {
    this.skinned = skinned;
    this.atlas = atlas;
    this.bones = skinned ? [{ name: '__fx', parent: -1, pos: [0, 0, 0] }] : [{ name: '__origin', parent: -1, pos: [0, 0, 0] }];
    this.names = new Map();
    this.names.set(skinned ? '__fx' : '__origin', 0);
    this.parts = [];
    this.bloodSpots = [];
    this.dirt = null; // {y0, k}
    this.aoStrength = 0.3;
    this.bloodColor = color(0x3d0404);
  }

  addBone(name, parent, x, y, z) {
    const pi = parent == null ? (this.skinned ? -1 : 0) : this.bi(parent);
    const idx = this.bones.length;
    this.bones.push({ name, parent: pi, pos: [x, y, z] });
    this.names.set(name, idx);
    return idx;
  }

  bi(b) {
    if (typeof b === 'number') return b;
    const i = this.names.get(b);
    if (i === undefined) throw new Error('unknown bone ' + b);
    return i;
  }

  bonePos(b) {
    return this.bones[this.bi(b)].pos;
  }

  /** Add an arbitrary geometry (consumed) positioned relative to bone. */
  geom(bone, geo, o = {}) {
    if (geo.index === null) {
      // make indexed for uniform processing
      const n = geo.attributes.position.count;
      const idx = new Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(idx);
    }
    if (o.shape) applyShape(geo, o.shape);
    if (o.rot || o.q) {
      if (o.q) _m.makeRotationFromQuaternion(o.q);
      else _m.makeRotationFromEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2], o.order || 'XYZ'));
      geo.applyMatrix4(_m);
    }
    if (o.at) geo.translate(o.at[0], o.at[1], o.at[2]);
    if (o.noise) {
      const p = geo.attributes.position;
      geo.computeVertexNormals();
      const nr = geo.attributes.normal;
      const f = o.nf || 8, s = o.nseed || 0;
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i);
        _n.fromBufferAttribute(nr, i);
        const d = (fbm3(_v.x * f + 3.1, _v.y * f, _v.z * f, 2, s) - 0.5) * 2 * o.noise;
        p.setXYZ(i, _v.x + _n.x * d, _v.y + _n.y * d, _v.z + _n.z * d);
      }
    }
    if (!o.keepNormals) geo.computeVertexNormals();
    this.parts.push({ bone: this.bi(bone), geo, o });
    return geo;
  }

  /** Tapered limb from a to b (bone-relative). */
  seg(bone, a, b, r0, r1, o = {}) {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    const geo = capsuleGeo(r0, r1 ?? r0, len, o.rs || 8, o.hs || 2, o.caps ?? 1, o.capScale ?? 0.6);
    if (o.prof) {
      // radial multiplier along the length: prof(t) with t in [0,1]
      const pa = geo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const t = Math.min(1, Math.max(0, pa.getY(i) / len));
        const m = o.prof(t);
        pa.setX(i, pa.getX(i) * m);
        pa.setZ(i, pa.getZ(i) * m);
      }
    }
    if (o.sx || o.sz) geo.scale(o.sx || 1, 1, o.sz || 1);
    if (o.twist) geo.rotateY(o.twist);
    if (o.shape) {
      applyShape(geo, o.shape);
    }
    _q.setFromUnitVectors(UP, dir.normalize());
    geo.applyQuaternion(_q);
    geo.translate(a[0], a[1], a[2]);
    return this.geom(bone, geo, { ...o, shape: null });
  }

  /** Ellipsoid centered at c with radii r = [rx, ry, rz]. */
  ellip(bone, c, r, o = {}) {
    const geo = new THREE.SphereGeometry(1, o.ws || 10, o.hs || 7, 0, Math.PI * 2, o.t0 || 0, o.tl || Math.PI);
    geo.scale(r[0], r[1], r[2]);
    if (o.shape) applyShape(geo, o.shape);
    if (o.rot || o.q) {
      if (o.q) _m.makeRotationFromQuaternion(o.q);
      else _m.makeRotationFromEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2], o.order || 'XYZ'));
      geo.applyMatrix4(_m);
    }
    geo.translate(c[0], c[1], c[2]);
    return this.geom(bone, geo, { ...o, shape: null, rot: null, q: null });
  }

  /** Box centered at c. o.round in [0,1] rounds it toward an ellipsoid (needs segments o.seg). */
  box(bone, c, s, o = {}) {
    const sg = o.seg || (o.round ? 2 : 1);
    const geo = new THREE.BoxGeometry(s[0], s[1], s[2], o.sgx || sg, o.sgy || sg, o.sgz || sg);
    if (o.round) roundBox(geo, s[0], s[1], s[2], o.round);
    if (o.shape) applyShape(geo, o.shape);
    if (o.rot || o.q) {
      if (o.q) _m.makeRotationFromQuaternion(o.q);
      else _m.makeRotationFromEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2], o.order || 'XYZ'));
      geo.applyMatrix4(_m);
    }
    geo.translate(c[0], c[1], c[2]);
    return this.geom(bone, geo, { ...o, shape: null, rot: null, q: null, flat: o.flat ?? !o.round });
  }

  /** Lathe around the Y axis from profile [[r, y], ...] (bottom to top), centered at c. */
  lathe(bone, c, profile, o = {}) {
    const pts = profile.map((p) => new THREE.Vector2(Math.max(0, p[0]), p[1]));
    const geo = new THREE.LatheGeometry(pts, o.rs || 10);
    if (o.sx || o.sz) geo.scale(o.sx || 1, 1, o.sz || 1);
    if (o.shape) applyShape(geo, o.shape);
    if (o.rot || o.q) {
      if (o.q) _m.makeRotationFromQuaternion(o.q);
      else _m.makeRotationFromEuler(new THREE.Euler(o.rot[0], o.rot[1], o.rot[2], o.order || 'XYZ'));
      geo.applyMatrix4(_m);
    }
    geo.translate(c[0], c[1], c[2]);
    return this.geom(bone, geo, { ...o, shape: null, rot: null, q: null });
  }

  /** Curved tapered tube through points (bone-relative). */
  tube(bone, pts, r0, r1, o = {}) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const ts = o.ts || Math.max(3, pts.length * 2);
    const rs = o.rs || 6;
    const geo = new THREE.TubeGeometry(curve, ts, 1, rs, false);
    // taper: radius 1 -> lerp(r0, r1)
    const p = geo.attributes.position;
    for (let i = 0; i <= ts; i++) {
      const t = i / ts;
      const r = r0 + ((r1 ?? r0) - r0) * t;
      curve.getPointAt(t, _v2);
      for (let j = 0; j <= rs; j++) {
        const k = i * (rs + 1) + j;
        _v.fromBufferAttribute(p, k).sub(_v2).multiplyScalar(r).add(_v2);
        p.setXYZ(k, _v.x, _v.y, _v.z);
      }
    }
    if (o.cap !== false) {
      // close the tip with a small cone to avoid holes
      const end = curve.getPointAt(1);
      const tan = curve.getTangentAt(1);
      const cone = new THREE.ConeGeometry(Math.max(r1 ?? r0, 0.001), Math.max(r1 ?? r0, 0.002) * 1.5, rs, 1, false);
      cone.translate(0, (Math.max(r1 ?? r0, 0.002) * 1.5) / 2, 0);
      cone.applyQuaternion(_q.setFromUnitVectors(UP, tan));
      cone.translate(end.x, end.y, end.z);
      this.geom(bone, cone, { ...o, shape: null, rot: null, q: null, at: null, noise: 0 });
    }
    return this.geom(bone, geo, { ...o, shape: null, rot: null, q: null });
  }

  /** Cone spike from a (base, radius r) to tip b. */
  spike(bone, a, b, r, o = {}) {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _v.length();
    const geo = new THREE.ConeGeometry(r, len, o.rs || 5, 1, o.open ?? false);
    geo.translate(0, len / 2, 0);
    _q.setFromUnitVectors(UP, _v.normalize());
    geo.applyQuaternion(_q);
    geo.translate(a[0], a[1], a[2]);
    return this.geom(bone, geo, { ...o, shape: null, rot: null, q: null });
  }

  /** Add a world-space blood splatter sphere (applied to parts with blood !== false). */
  blood(c, r, k = 1) {
    this.bloodSpots.push({ c, r, k });
  }

  /**
   * Merge everything.
   * Returns { geometry, bones, inverses, names, sphere, tris }
   */
  build() {
    const pos = [], nor = [], uvs = [], col = [], glow = [], si = [], idx = [];
    const world = this.bones.map(() => new THREE.Vector3());
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      world[i].set(b.pos[0], b.pos[1], b.pos[2]);
    }
    const P = new THREE.Vector3(), N = new THREE.Vector3(), C = new THREE.Color();
    let vbase = 0;
    for (const part of this.parts) {
      const { geo, o } = part;
      const bw = world[part.bone];
      const reg = regionUV(o.region ?? 15);
      const uvScale = o.uv || [1, 1, 0, 0];
      const base = color(o.color ?? 0xffffff);
      const mottle = o.mottle ?? 0.18;
      const mf = o.mf || 9;
      const gl = o.glow || 0;
      const p = geo.attributes.position;
      const n = geo.attributes.normal;
      const uv = geo.attributes.uv;
      let index = geo.index.array;
      if (MeshBuilder.debugNaN) {
        for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) { console.warn('NaN part', geo.type, this.bones[part.bone].name, JSON.stringify(Object.keys(o))); break; }
      }
      // tear: drop triangles with noisy centroid mask
      if (o.tear) {
        const keep = [];
        const t = o.tear;
        for (let i = 0; i < index.length; i += 3) {
          let cx = 0, cy = 0, cz = 0;
          for (let k = 0; k < 3; k++) {
            cx += p.getX(index[i + k]);
            cy += p.getY(index[i + k]);
            cz += p.getZ(index[i + k]);
          }
          cx = cx / 3 + bw.x;
          cy = cy / 3 + bw.y;
          cz = cz / 3 + bw.z;
          let drop = fbm3(cx * (t.f || 9), cy * (t.f || 9), cz * (t.f || 9), 2, t.seed || 0) < (t.amt || 0.3);
          if (t.fn && t.fn(cx, cy, cz)) drop = true;
          if (!drop) keep.push(index[i], index[i + 1], index[i + 2]);
        }
        index = keep;
      }
      for (let i = 0; i < p.count; i++) {
        P.set(p.getX(i) + bw.x, p.getY(i) + bw.y, p.getZ(i) + bw.z);
        N.set(n.getX(i), n.getY(i), n.getZ(i));
        pos.push(P.x, P.y, P.z);
        nor.push(N.x, N.y, N.z);
        const u = uv ? uv.getX(i) : 0, v = uv ? uv.getY(i) : 0;
        const uu = (u * uvScale[0] + uvScale[2]) % 1.0001, vv = (v * uvScale[1] + uvScale[3]) % 1.0001;
        uvs.push(reg[0] + (reg[2] - reg[0]) * uu, reg[1] + (reg[3] - reg[1]) * vv);
        // vertex color
        C.copy(base);
        if (mottle > 0) {
          const m = 1 + (fbm3(P.x * mf, P.y * mf, P.z * mf, 2, 99) - 0.5) * 2 * mottle;
          C.multiplyScalar(m);
        }
        if (o.tint) o.tint(P, N, C);
        if (o.blood !== false && this.bloodSpots.length) {
          for (const s of this.bloodSpots) {
            const dx = P.x - s.c[0], dy = P.y - s.c[1], dz = P.z - s.c[2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / s.r;
            if (d < 1.3) {
              const nn = fbm3(P.x * 14, P.y * 14, P.z * 14, 2, 7);
              const t = Math.min(1, Math.max(0, (1.15 - d - (nn - 0.5) * 0.9) * 2.2)) * s.k;
              if (t > 0) C.lerp(this.bloodColor, Math.min(1, t));
            }
          }
        }
        if (this.dirt && o.dirt !== false && P.y < this.dirt.y0) {
          const t = (1 - P.y / this.dirt.y0) * this.dirt.k * 0.5 * (0.5 + noise3(P.x * 11, P.y * 11, P.z * 11, 5));
          C.lerp(_c.setRGB(0.09, 0.065, 0.04), Math.min(0.45, t));
        }
        if (o.ao !== false) {
          const a = 1 - this.aoStrength * (0.5 - N.y * 0.5);
          C.multiplyScalar(a);
        }
        col.push(C.r, C.g, C.b);
        glow.push(gl);
        si.push(this.skinned ? part.bone : 0);
      }
      if (MeshBuilder.debugStats) {
        const k = this.bones[part.bone].name + ':' + geo.type.replace('Geometry', '');
        (this.stats || (this.stats = {}))[k] = ((this.stats && this.stats[k]) || 0) + index.length / 3 * (o.double ? 2 : 1);
      }
      for (let i = 0; i < index.length; i++) idx.push(index[i] + vbase);
      if (o.double) {
        // back faces: duplicate vertices with flipped normals
        const off = pos.length / 3;
        for (let i = 0; i < p.count; i++) {
          const k = (vbase + i) * 3;
          pos.push(pos[k], pos[k + 1], pos[k + 2]);
          nor.push(-nor[k], -nor[k + 1], -nor[k + 2]);
          const ku = (vbase + i) * 2;
          uvs.push(uvs[ku], uvs[ku + 1]);
          col.push(col[k] * 0.8, col[k + 1] * 0.8, col[k + 2] * 0.8);
          glow.push(glow[vbase + i]);
          si.push(si[vbase + i]);
        }
        for (let i = 0; i < index.length; i += 3) idx.push(index[i] + off, index[i + 2] + off, index[i + 1] + off);
        vbase = off + p.count;
      } else {
        vbase += p.count;
      }
      geo.dispose();
    }
    const nv = pos.length / 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1));
    if (this.skinned) {
      const skinIndex = new Uint16Array(nv * 4);
      const skinWeight = new Float32Array(nv * 4);
      for (let i = 0; i < nv; i++) {
        skinIndex[i * 4] = si[i];
        skinWeight[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    }
    g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const bones = this.bones.map((b) => {
      const local = new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]);
      if (b.parent >= 0) {
        const pp = this.bones[b.parent].pos;
        local.x -= pp[0];
        local.y -= pp[1];
        local.z -= pp[2];
      }
      return { name: b.name, parent: b.parent, pos: b.pos, local };
    });
    const inverses = this.bones.map((b, i) => (i === 0 && this.skinned ? new THREE.Matrix4() : new THREE.Matrix4().makeTranslation(-b.pos[0], -b.pos[1], -b.pos[2])));
    if (MeshBuilder.debugStats) console.log('tri stats', JSON.stringify(this.stats));
    return {
      geometry: g,
      bones,
      inverses,
      names: this.names,
      sphere: g.boundingSphere.clone(),
      tris: idx.length / 3,
    };
  }
}

// ------------------------------------------------------------------ instances
/**
 * Create a SkinnedMesh + per-instance skeleton for a built rig.
 * Returns { mesh, bones, skeleton, fx } where bones[i] matches rig.bones[i]; fx = bones[0].
 */
export function instantiateRig(rig, material, sphereRadius) {
  const bones = new Array(rig.bones.length);
  bones[0] = new THREE.Bone();
  bones[0].name = '__fx';
  bones[0].matrixAutoUpdate = false;
  bones[0].matrixWorldAutoUpdate = false;
  const fxe = bones[0].matrixWorld.elements;
  fxe[12] = 0; // hit
  fxe[13] = 1; // glow multiplier
  fxe[14] = 0;
  for (let i = 1; i < rig.bones.length; i++) {
    const d = rig.bones[i];
    const b = new THREE.Bone();
    b.name = d.name;
    b.position.copy(d.local);
    bones[i] = b;
    if (d.parent > 0) bones[d.parent].add(b);
  }
  const mesh = new THREE.SkinnedMesh(rig.geometry, material);
  for (let i = 1; i < bones.length; i++) if (rig.bones[i].parent <= 0) mesh.add(bones[i]);
  const skeleton = new THREE.Skeleton(bones, rig.inverses);
  mesh.bind(skeleton, IDENTITY);
  mesh.boundingSphere = new THREE.Sphere(rig.sphere.center.clone(), sphereRadius || rig.sphere.radius * 1.35);
  mesh.frustumCulled = true;
  return { mesh, bones, skeleton, fx: bones[0] };
}

/** Write per-instance shader params into the fx bone. */
export function setFx(fxBone, hit, glowMul) {
  const e = fxBone.matrixWorld.elements;
  e[12] = hit;
  e[13] = glowMul;
}

// ------------------------------------------------------------------ materials
function patchShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying vec3 vFx;'
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vGlow = aGlow;
      #ifdef USE_SKINNING
        mat4 fxM = getBoneMatrix( 0.0 );
        vFx = fxM[3].xyz;
      #else
        vFx = vec3( 0.0, 1.0, 0.0 );
      #endif`
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vGlow;\nvarying vec3 vFx;')
    .replace(
      '#include <opaque_fragment>',
      `outgoingLight += diffuseColor.rgb * vGlow * vFx.y * 2.2;
      outgoingLight = mix( outgoingLight, vec3( 1.0, 0.18, 0.12 ), clamp( vFx.x, 0.0, 1.0 ) * 0.5 );
      #include <opaque_fragment>`
    );
}

function makeMat(map, fog) {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, fog });
  m.onBeforeCompile = patchShader;
  m.customProgramCacheKey = () => 'stn-char-fx-v1';
  return m;
}

let _charMat = null, _propMat = null, _vmArmMat = null, _vmWeaponMat = null;
/** Shared material for all skinned characters (char atlas). */
export function getCharacterMaterial() {
  if (!_charMat) _charMat = makeMat(getCharAtlas(), true);
  return _charMat;
}
/** Shared material for world weapons/props (weapon atlas). */
export function getPropMaterial() {
  if (!_propMat) _propMat = makeMat(getWeaponAtlas(), true);
  return _propMat;
}
/** Viewmodel arms material (char-style skin/sleeves live in the weapon atlas too). No fog. */
export function getViewArmMaterial() {
  if (!_vmArmMat) _vmArmMat = makeMat(getWeaponAtlas(), false);
  return _vmArmMat;
}
/** Viewmodel weapon material, no fog. */
export function getViewWeaponMaterial() {
  if (!_vmWeaponMat) _vmWeaponMat = makeMat(getWeaponAtlas(), false);
  return _vmWeaponMat;
}
/** Viewmodel claws/zombie arms material (char atlas), no fog. */
let _vmCharMat = null;
export function getViewCharMaterial() {
  if (!_vmCharMat) _vmCharMat = makeMat(getCharAtlas(), false);
  return _vmCharMat;
}

// ------------------------------------------------------------------ two-bone IK
const _d = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h = new THREE.Vector3();
const _e = new THREE.Vector3();
const _negU = new THREE.Vector3();
const _negW = new THREE.Vector3();
const _bm = new THREE.Matrix4();
const XAXIS = new THREE.Vector3(1, 0, 0);

/**
 * Analytic two-bone IK for limbs whose bind direction is -Y and whose hinge is local +X
 * (positive X rotation of the lower bone bends it toward local -Z).
 * All vectors in the same (parent) space. S = upper joint, T = target for the end joint.
 * Writes qUpper (rotation of the upper bone in parent space) and qLower (local rotation of the lower bone).
 * Returns the reach ratio (>1 means target out of reach).
 */
export function ikTwoBone(S, T, L1, L2, pole, qUpper, qLower, elbowOut) {
  _d.subVectors(T, S);
  let dist = _d.length();
  const reach = dist / (L1 + L2);
  const minD = Math.abs(L1 - L2) + 1e-3, maxD = L1 + L2 - 1e-4;
  if (dist < 1e-5) _d.set(0, -1, 0);
  _d.normalize();
  dist = Math.min(maxD, Math.max(minD, dist));
  // pole projected perpendicular to d
  _pp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_pp.lengthSq() < 1e-8) _pp.set(0, 0, -1).addScaledVector(_d, -_d.z);
  _pp.normalize();
  const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
  const a = Math.acos(Math.min(1, Math.max(-1, cosA)));
  _u.copy(_d).multiplyScalar(Math.cos(a)).addScaledVector(_pp, Math.sin(a)).normalize();
  _e.copy(S).addScaledVector(_u, L1);
  if (elbowOut) elbowOut.copy(_e);
  _f.copy(S).addScaledVector(_d, dist).sub(_e).normalize();
  // w: direction the lower bone deviates from u
  _w.copy(_f).addScaledVector(_u, -_f.dot(_u));
  if (_w.lengthSq() < 1e-8) _w.copy(_pp).multiplyScalar(-1);
  _w.normalize();
  // hinge axis h = u x w ; basis columns X->h, Y->-u, Z->-w
  _h.crossVectors(_u, _w).normalize();
  _negU.copy(_u).negate();
  _negW.copy(_w).negate();
  _bm.makeBasis(_h, _negU, _negW);
  qUpper.setFromRotationMatrix(_bm);
  const beta = Math.acos(Math.min(1, Math.max(-1, _u.dot(_f))));
  qLower.setFromAxisAngle(XAXIS, beta);
  return reach;
}

// small math helpers used by animation code
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
