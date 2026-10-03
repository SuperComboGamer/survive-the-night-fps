// Fixed-size light pool (the scene's light count never changes -> no shader recompiles).
// Local flashlight (optionally shadow casting), 2 remote flashlights, 4 fire lights (built campfires,
// torches, molotov fires, flares, burning barrels), 1 muzzle flash light, 1 explosion light, and 1 for a flare gun's
// flare high overhead (lighting the ground for tens of metres round under it: client/game/skyflares.js; shadow casting
// with the sun's).
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
    // The sky flare: a lamp shining straight down from high up. Decay 1, so that it lights a wide circle with the ground
    // under it only a little brighter than its edge. A spot, so that on the qualities with sun shadows it casts one
    // too: roofs and walls keep its light out of where the team boards up, and everything under it throws a shadow that
    // swings with it. Its map is drawn only while one burns (setSky)
    const sk = new THREE.SpotLight(0xffd6c8, 0, 100, 1.2, 0.5, 1);
    sk.castShadow = !!quality.shadows;
    sk.shadow.mapSize.set(1024, 1024);
    // (its near plane follows it down, setSky: from 80 m up with it at 1 m, the depth a bias of this size stands for
    // is metres, and a roof 2.5 m over a floor casts nothing)
    sk.shadow.bias = -0.0002;
    sk.shadow.normalBias = 0.05;
    scene.add(sk);
    scene.add(sk.target);
    this.sky = sk;
    this.skyFrame = 0;
    this.fxT = 0;
    this.fxMax = 1;
    this.fxPower = 0;
    this._tmp = [];
  }

  // flash: the flashlight casts shadows (quality.flashShadows); sky: the sky flare does (quality.shadows)
  setShadows(flash, sky = flash) {
    this.flashlight.castShadow = flash;
    this.sky.castShadow = sky;
  }

  flashMuzzle(pos, power = 1, time = 0.05) {
    this.muzzle.position.copy(pos);
    this.muzzle.intensity = 22 * power;
    this.muzzleT = time;
  }

  // The sky flare light: at (x,y,z), lighting the ground straight under it, `h` m down, to `ground` (at 1 about what a
  // standing torch throws on the ground 5 m off), out to `reach` m across the ground; ground 0 puts it out
  setSky(x, y, z, h, ground, reach, color) {
    const L = this.sky;
    // Its shadow map is only drawn while it burns, and then every other frame: drawing it costs about a quarter more
    // triangles than the frame has without it, and the flare comes down at a walking pace. (The map has to exist
    // though, as the flashlight's: see update. Between two drawings the old map goes with its old matrix)
    L.shadow.autoUpdate = !L.shadow.map;
    this.skyFrame = (this.skyFrame + 1) & 1;
    if (ground > 0 && this.skyFrame === 0) L.shadow.needsUpdate = true;
    if (!(ground > 0)) {
      L.intensity = 0;
      return;
    }
    h = Math.max(1, h);
    L.position.set(x, y, z);
    L.target.position.set(x, y - h, z);
    L.target.updateMatrixWorld();
    L.intensity = ground * h; // (decay 1: what reaches the ground under it is intensity / h)
    L.distance = Math.hypot(h, reach) * 1.4; // (the falloff window of three's lights: well past the circle it lights)
    L.angle = Math.min(1.35, Math.atan2(reach, h));
    // the shadow's depth range starts well down towards the ground: its precision goes where the roofs and walls are
    // (what stands higher than 0.4 h right under it casts nothing)
    const cam = L.shadow.camera;
    const near = Math.max(1, h * 0.6);
    if (Math.abs(cam.near - near) > 0.5) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    if (color != null) L.color.set(color);
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
