// Fixed-size light pool (the scene's light count never changes -> no shader recompiles).
// Local flashlight (optionally shadow casting), 2 remote flashlights, 4 fire lights (built campfires,
// torches, molotov fires, flares, burning barrels), 1 muzzle flash light, 1 explosion light.
// Pooled lights are assigned to the nearest / brightest sources each frame.
import * as THREE from 'three';

export class Lights {
  constructor(scene, camera, quality) {
    this.scene = scene;
    // local flashlight follows the camera
    const fl = new THREE.SpotLight(0xfff0d8, 0, 58, 0.5, 0.55, 0.55);
    fl.position.set(0.25, -0.2, 0.1);
    fl.target.position.set(0.15, -0.1, -10);
    camera.add(fl);
    camera.add(fl.target);
    fl.castShadow = !!quality.flashShadows;
    fl.shadow.mapSize.set(1024, 1024);
    fl.shadow.camera.near = 0.3;
    fl.shadow.camera.far = 55;
    fl.shadow.bias = -0.0005;
    this.flashlight = fl;

    this.remote = [];
    for (let i = 0; i < 2; i++) {
      const s = new THREE.SpotLight(0xfff0d8, 0, 45, 0.45, 0.6, 0.6);
      scene.add(s);
      scene.add(s.target);
      this.remote.push(s);
    }
    this.fires = [];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.PointLight(0xff8a3a, 0, 16, 1.6);
      scene.add(p);
      this.fires.push(p);
    }
    this._fireCol = new THREE.Color(0xff8a3a);
    this.muzzle = new THREE.PointLight(0xffb060, 0, 14, 1.8);
    scene.add(this.muzzle);
    this.muzzleT = 0;
    this.fx = new THREE.PointLight(0xff9040, 0, 40, 1.5);
    scene.add(this.fx);
    this.fxT = 0;
    this.fxMax = 1;
    this.fxPower = 0;
    this._tmp = [];
  }

  setShadows(on) {
    this.flashlight.castShadow = on;
  }

  flashMuzzle(pos, power = 1, time = 0.05) {
    this.muzzle.position.copy(pos);
    this.muzzle.intensity = 22 * power;
    this.muzzleT = time;
  }

  flashFx(x, y, z, power, duration) {
    this.fx.position.set(x, y + 1, z);
    this.fxPower = power;
    this.fxT = duration;
    this.fxMax = duration;
  }

  // sources: [{x,y,z, intensity, color?, big?}] fire-ish point sources (campfires, torches, fires, flares)
  // remoteFlash: [{pos: Vector3, dir: Vector3}] remote players with flashlight on (sorted by distance)
  update(dt, time, camPos, localFlashOn, sources, remoteFlash, night) {
    this.flashlight.intensity = localFlashOn ? 16 + night * 8 : 0;
    // a dark flashlight lights nothing, so its shadow map (high / ultra) is not rendered either. This runs
    // before the frame is drawn, so the frame it comes on has a fresh map; castShadow stays as it is
    // (toggling that would recompile every program). The map has to exist though: with none, three binds
    // a placeholder its shadow samplers reject, and every lit draw fails.
    const sh = this.flashlight.shadow;
    sh.autoUpdate = localFlashOn || !sh.map;
    // nearest (big fires count as closer) fire sources
    const tmp = this._tmp;
    tmp.length = 0;
    for (const s of sources) {
      if (!(s.intensity > 0)) continue;
      s.d = ((s.x - camPos.x) ** 2 + (s.z - camPos.z) ** 2) / (s.big ? 2.2 : 1);
      tmp.push(s);
    }
    tmp.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.fires.length; i++) {
      const L = this.fires[i];
      const s = tmp[i];
      if (s && s.d < 100 * 100) {
        const f = 0.82 + Math.sin(time * 11 + i * 3) * 0.07 + Math.sin(time * 23.7 + i) * 0.06 + Math.sin(time * 5.3 + i * 2) * 0.06;
        L.position.set(s.x, s.y + (s.big ? 0.9 : 1.2), s.z);
        L.intensity = (s.big ? 42 : 18) * s.intensity * f;
        L.distance = s.big ? 14 + 14 * s.intensity : 10 + 8 * s.intensity;
        L.color.set(s.color ?? 0xff8a3a);
      } else L.intensity = 0;
    }
    for (let i = 0; i < this.remote.length; i++) {
      const L = this.remote[i];
      const r = remoteFlash[i];
      if (r) {
        L.position.copy(r.pos);
        L.target.position.set(r.pos.x + r.dir.x * 10, r.pos.y + r.dir.y * 10, r.pos.z + r.dir.z * 10);
        L.intensity = 11;
      } else L.intensity = 0;
    }
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) this.muzzle.intensity = 0;
    }
    if (this.fxT > 0) {
      this.fxT -= dt;
      this.fx.intensity = Math.max(0, this.fxT / this.fxMax) * this.fxPower;
      if (this.fxT <= 0) this.fx.intensity = 0;
    }
  }
}
