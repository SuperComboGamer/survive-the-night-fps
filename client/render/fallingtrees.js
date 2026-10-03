// Felled trees coming down. A tree chopped to its last (EVT.FELL) leaves the instanced forest (Foliage hides its
// instance) and falls here as a mesh of its own: it tips about its foot away from whoever cut it, slowly at first
// and then ever faster, as a toppling pole does, and hits the ground FALL_T after the event - where every take of
// the recording (SOUND.TREE_FALL) has its crash. A bounce, a few seconds lying there, and it dithers away.
import * as THREE from 'three';
import { vegFellMaterial } from './materials.js';

export const FALL_T = 2.55; // s from the event to the ground: where the crash sits in each take of tree_fall.ogg
const REST_T = 3; // s it lies there...
const FADE_T = 1.5; // ...and takes to fade away
const SINK = 0.35; // m it settles into the ground as it fades
const LEAN0 = 0.05; // rad over when it starts to go (the hinge of uncut wood holding it a moment)
const LIFT = 0.07; // rad short of the ground it comes to rest: its limbs hold the trunk up off it
const BOUNCE = 0.06; // rad it bounces back up off the ground
const DRAW_DIST = 260; // m: further off a tree just goes (nobody sees it fall through that much forest)

// The toppling of a pole about its foot, theta'' = sin(theta) (a time scale of its own), from LEAN0 at rest: theta
// every DT. A tree's fall plays this out at the pace that brings it down where it lands at exactly FALL_T.
const DT = 1 / 500;
const PROFILE = (() => {
  const out = [];
  let th = LEAN0;
  let w = 0;
  while (th < 2.4) {
    out.push(th);
    w += Math.sin(th) * DT;
    th += w * DT;
  }
  out.push(th);
  return Float32Array.from(out);
})();
// time on the profile at which it is `th` over
function profileTime(th) {
  let lo = 0;
  let hi = PROFILE.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PROFILE[mid] < th) lo = mid;
    else hi = mid;
  }
  return (lo + (th - PROFILE[lo]) / (PROFILE[hi] - PROFILE[lo])) * DT;
}
function profileAt(t) {
  const f = t / DT;
  const i = Math.min(PROFILE.length - 2, Math.floor(f));
  return PROFILE[i] + (PROFILE[i + 1] - PROFILE[i]) * (f - i);
}

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class FallingTrees {
  // trees: Foliage's InstancedSet of them (its data, per-instance matrices and variants)
  constructor(scene, world, trees) {
    this.scene = scene;
    this.world = world;
    this.trees = trees;
    this.active = [];
    this.pool = trees.variants.map(() => []); // finished ones, per variant, to fall again
  }

  // A tree of variant v in a group of its own, every part in materials of its own (they fade on their own)
  _make(v) {
    const gone = { value: 0 };
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    for (const part of this.trees.variants[v].parts) {
      const mesh = new THREE.Mesh(part.geometry, vegFellMaterial(part.material, gone));
      mesh.customDepthMaterial = mesh.material.userData.depth;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // (it leaves its bounds as it falls)
      group.add(mesh);
    }
    return { v, group, gone };
  }

  // Instance i comes down toward yaw (the game's: -sin, -cos) - from where the camera is at (cx, cz), if it is near
  // enough to be seen. False when it is not drawn falling.
  fell(i, yaw, cx, cz) {
    const D = this.trees.data;
    const o = i * 6;
    const x = D[o];
    const y = D[o + 1];
    const z = D[o + 2];
    if (Math.hypot(x - cx, z - cz) > DRAW_DIST) return false;
    const v = D[o + 5] | 0;
    const f = this.pool[v].pop() || this._make(v);
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    new THREE.Matrix4().fromArray(this.trees.mats, i * 16).decompose(pos, rot, scale);
    // over toward d about the horizontal axis across it
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const axis = new THREE.Vector3().crossVectors(_up, new THREE.Vector3(dx, 0, dz)).normalize();
    // where it lands: the crown (some 60% up) comes down on the ground out there, held off it by its limbs. Steep
    // ground falling away lets it go past level, a bank rising in front stops it short
    const reach = 0.6 * this.trees.variants[v].height * scale.y;
    const drop = y - this.world.heightAt(x + dx * reach, z + dz * reach);
    const land = Math.min(1.95, Math.max(1.15, Math.PI / 2 + Math.atan2(drop, reach) - LIFT));
    Object.assign(f, { t: 0, pos, rot, scale, axis, land, pace: profileTime(land) / FALL_T });
    f.gone.value = 0;
    const cast = this.trees.castDist > 0; // (as the forest's own: shadows on at this quality)
    for (const m of f.group.children) m.castShadow = cast;
    this._pose(f);
    this.scene.add(f.group);
    this.active.push(f);
    return true;
  }

  _pose(f) {
    const t = f.t;
    let th;
    let sink = 0;
    if (t < FALL_T) th = profileAt(t * f.pace);
    else {
      const s = t - FALL_T;
      th = f.land - BOUNCE * Math.exp(-5 * s) * Math.abs(Math.sin(11 * s));
      const k = (s - REST_T) / FADE_T;
      if (k > 0) {
        f.gone.value = Math.min(1, k);
        sink = SINK * k;
      }
    }
    _q.setFromAxisAngle(f.axis, th).multiply(f.rot);
    _p.copy(f.pos);
    _p.y -= sink;
    f.group.matrix.compose(_p, _q, f.scale);
    f.group.matrixWorldNeedsUpdate = true;
  }

  update(dt) {
    for (let k = this.active.length - 1; k >= 0; k--) {
      const f = this.active[k];
      f.t += dt;
      if (f.t >= FALL_T + REST_T + FADE_T) {
        this._drop(f);
        this.active.splice(k, 1);
        continue;
      }
      this._pose(f);
    }
  }

  _drop(f) {
    this.scene.remove(f.group);
    this.pool[f.v].push(f);
  }

  // every tree falling now is gone (dawn: the forest stands again)
  clear() {
    for (const f of this.active) this._drop(f);
    this.active.length = 0;
  }

  // One falling tree of every variant, for the warm-up (Game.warmViews): their programs are not the forest's
  warmViews() {
    return this.trees.variants.map((_, v) => {
      const f = this._make(v);
      for (const m of f.group.children) m.castShadow = true;
      f.group.matrixAutoUpdate = true;
      return f.group;
    });
  }

  dispose() {
    this.clear();
    for (const list of this.pool) {
      for (const f of list) {
        for (const m of f.group.children) {
          m.material.dispose();
          m.customDepthMaterial.dispose();
        }
      }
    }
    this.pool = this.trees.variants.map(() => []);
  }
}
