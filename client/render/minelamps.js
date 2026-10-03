// The dead miners' helmet lamps: for every lamp-wearing zombie in view, a hard hat on its head, a bright lens and a beam
// of light ahead of it, drawn as three instanced batches (3 draw calls whatever the crowd), positioned each frame from the
// head bone's matrix. Nothing is allocated per frame. The lamps also hand the scene's light pool a source each, so a
// miner that gets close lights the wall beside you.
import * as THREE from 'three';
import { ENT } from '../../shared/protocol.js';
import { Mesher, col } from './minegeo.js';
import { glowTexture } from './minegeo.js';

const MAX = 48;
const _m = new THREE.Matrix4();
const _off = new THREE.Matrix4();
const _v = new THREE.Vector3();

export class MinerLamps {
  constructor(scene) {
    // the hat: a dome with a brim, and the lamp housing on the front
    const M = new Mesher();
    const hat = col(0xc8a020);
    M.cyl(0, 0.0, 0, 0.145, 0.12, 0.09, 10, hat, false);
    M.cyl(0, 0.09, 0, 0.12, 0.05, 0.07, 10, hat, true);
    M.box(0, 0.015, -0.01, 0.34, 0.012, 0.3, hat.clone().multiplyScalar(0.8));
    M.box(0, 0.085, -0.15, 0.07, 0.06, 0.05, col(0x2a2a2a));
    const helmGeo = M.build();
    this.helm = new THREE.InstancedMesh(helmGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX);
    // the beam: apex at the lamp, 7 m out, fading to nothing
    const cone = new THREE.ConeGeometry(1.5, 7, 14, 1, true);
    cone.translate(0, -3.5, 0);
    cone.rotateX(Math.PI / 2);
    const pos = cone.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, -pos.getZ(i) / 7);
      const k = (1 - t) * (1 - t) * 0.5;
      colors[i * 3] = k * 1.0;
      colors[i * 3 + 1] = k * 0.86;
      colors[i * 3 + 2] = k * 0.5;
    }
    cone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.beam = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }), MAX);
    this.beam.renderOrder = 6;
    // the lens flare
    const g = new THREE.BufferGeometry();
    this.flarePos = new Float32Array(MAX * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.flarePos, 3));
    this.flare = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffe6a8, size: 0.7, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flare.renderOrder = 7;
    for (const o of [this.helm, this.beam, this.flare]) {
      o.frustumCulled = false;
      o.visible = false;
      scene.add(o);
    }
    this.n = 0;
    this.sources = Array.from({ length: MAX }, () => ({ x: 0, y: 0, z: 0, intensity: 0.5, base: 0.5, color: 0xffd890 }));
    this.live = [];
    _off.makeTranslation(0, 0.02, 0);
  }

  // entities: Entities.ents (a Map). Returns the list of light sources of the lamps shown this frame.
  update(entities, time) {
    let n = 0;
    for (const e of entities.values()) {
      if (e.kind !== ENT.ZOMBIE || e.dead || !e.view || n >= MAX) continue;
      if ((e.id * 7 + e.variant) % 5 >= 3) continue; // two in five went down without one
      const head = e.view.object.userData.head;
      if (!head) continue;
      _m.copy(head.matrixWorld);
      _m.multiply(_off);
      this.helm.setMatrixAt(n, _m);
      this.beam.setMatrixAt(n, _m);
      _v.setFromMatrixPosition(_m);
      // (the lens sits a little ahead of the head: along the hat's front, -z)
      _v.set(0, 0.1, -0.16).applyMatrix4(_m);
      this.flarePos[n * 3] = _v.x;
      this.flarePos[n * 3 + 1] = _v.y;
      this.flarePos[n * 3 + 2] = _v.z;
      const s = this.sources[n];
      s.x = _v.x;
      s.y = _v.y - 1.0; // (the pool lifts a source by 1.2 m)
      s.z = _v.z;
      s.base = s.intensity = 0.34 * (0.85 + 0.15 * Math.sin(time * 8 + e.id));
      n++;
    }
    this.n = n;
    this.helm.count = this.beam.count = n;
    this.helm.instanceMatrix.needsUpdate = this.beam.instanceMatrix.needsUpdate = n > 0;
    this.flare.geometry.setDrawRange(0, n);
    this.flare.geometry.attributes.position.needsUpdate = n > 0;
    this.helm.visible = this.beam.visible = this.flare.visible = n > 0;
    this.live.length = n;
    for (let i = 0; i < n; i++) this.live[i] = this.sources[i];
    return this.live;
  }

  setVisible(v) {
    if (!v) this.helm.visible = this.beam.visible = this.flare.visible = false;
  }

  dispose(scene) {
    for (const o of [this.helm, this.beam, this.flare]) {
      scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}
