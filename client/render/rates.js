// How often things that need not be done every frame are done (docs/performance.md). Each is a ceiling in times a
// second, set above the frame rates people play at: below it the thing is done every frame, exactly as it was
// before there was a ceiling; above it, the frames in between reuse what the last one made.
import * as THREE from 'three';

// A zombie further off than POSE_NEAR m (where its far copy is drawn: models/characters.js LOD_FAR) is posed - its
// limbs worked out - at most POSE_HZ times a second. Where it stands and which way it faces is every frame's.
export const POSE_NEAR = 15, POSE_HZ = 80;

// The shadow maps are drawn again at most SHADOW_HZ times a second. A frame that comes sooner than that after the
// last one that drew them uses them as they are: a map and its matrices are of one moment, so its shadows stay where
// they fall in the world, only the casters that moved are a few milliseconds behind. A frame the camera has jumped
// SHADOW_JUMP m or swung SHADOW_SWING rad in (a cut, a teleport) always draws them.
export const SHADOW_HZ = 160, SHADOW_JUMP = 2, SHADOW_SWING = 0.12;

export class ShadowRate {
  constructor() {
    this.acc = 1;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
  }

  /** Whether this frame draws the shadow maps. dt: the frame's length (s; none: yes). lights: those that cast (one without a map yet: yes). */
  due(dt, camera, lights = []) {
    this.acc = dt > 0 ? this.acc + dt : 1;
    let due = this.acc >= 1 / SHADOW_HZ - 0.0003 || camera.position.distanceToSquared(this.pos) > SHADOW_JUMP * SHADOW_JUMP || camera.quaternion.angleTo(this.quat) > SHADOW_SWING;
    for (let i = 0; !due && i < lights.length; i++) due = lights[i].castShadow && !lights[i].shadow.map;
    if (due) {
      this.acc = 0;
      this.pos.copy(camera.position);
      this.quat.copy(camera.quaternion);
    }
    return due;
  }
}
