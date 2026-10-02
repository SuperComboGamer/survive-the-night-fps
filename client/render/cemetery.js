// St. Agnes Cemetery on the client: what a grave does when one of the dead comes up out of it (EVT.GRAVE; the
// place itself is static world, built by shared/cemetery.js, and the zombie is an ordinary zombie in ZANIM.RISE).
// The earth heaves for CEMETERY.STIR, with the sound of it, before anything shows: that is the warning. Then it
// breaks open, dirt flies, and the grave stays broken for the rest of the run.
// The broken earth of every grave is one instanced mesh, in the scene from the moment the valley is loaded (so its
// program is built behind the splash with the rest), an instance scaled to nothing until its grave stirs.
import * as THREE from 'three';
import { SOUND, ZONE, ZONE_NAMES } from '../../shared/defs.js';
import { CEMETERY } from '../../shared/cemetery.js';
import { mulberry32 } from '../../shared/rng.js';
import { TEX } from './effects.js';

const MAX_GRAVES = 96;
const OPEN = 0.8; // how high the broken earth of an opened grave stands, of its height as it bursts
const SHAKE_REACH = 12; // a grave heaving this close is felt underfoot (m)

// The earth of one grave, broken open: a dark hole and the clods thrown up round it. Local space: the grave lies
// along Z, its middle at the origin, the grass at y = 0.
function brokenEarth() {
  const rnd = mulberry32(0x9ea7e);
  const ico = new THREE.IcosahedronGeometry(1, 0).toNonIndexed().getAttribute('position').array;
  const pos = [];
  const col = [];
  const lump = (x, y, z, sx, sy, sz, rot, shade) => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i < ico.length; i += 3) {
      const lx = ico[i] * sx;
      const lz = ico[i + 2] * sz;
      pos.push(x + c * lx + s * lz, y + ico[i + 1] * sy, z - s * lx + c * lz);
      col.push(0.056 * shade, 0.039 * shade, 0.026 * shade); // (vertex colours are linear: a dark, damp brown)
    }
  };
  // the hole: a ragged dark patch just over the ridge of the mound
  const N = 9;
  const rim = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.85 + rnd() * 0.3;
    rim.push([Math.sin(a) * 0.42 * r, Math.cos(a) * 0.8 * r]);
  }
  for (let i = 0; i < N; i++) {
    const [ax, az] = rim[i];
    const [bx, bz] = rim[(i + 1) % N];
    pos.push(0, 0.3, 0, ax, 0.27, az, bx, 0.27, bz);
    for (let k = 0; k < 3; k++) col.push(0.005, 0.004, 0.003);
  }
  // the clods round it, the biggest along its sides
  for (let i = 0; i < 15; i++) {
    const a = ((i + rnd() * 0.6) / 15) * Math.PI * 2;
    const r = 0.95 + rnd() * 0.3;
    const size = 0.13 + rnd() * 0.14;
    lump(Math.sin(a) * 0.5 * r, 0.16 + rnd() * 0.1, Math.cos(a) * 0.9 * r, size * (1 + rnd() * 0.5), size * (0.6 + rnd() * 0.5), size * (1 + rnd() * 0.5), rnd() * 3, 0.7 + rnd() * 0.6);
  }
  // ...and what was thrown further
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 1.0 + rnd() * 0.7;
    const size = 0.05 + rnd() * 0.07;
    lump(Math.sin(a) * r, size * 0.5, Math.cos(a) * (r + 0.3), size, size * 0.8, size, rnd() * 3, 0.8 + rnd() * 0.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

export class Graves {
  constructor(game) {
    this.g = game;
    this.cem = null;
    this.mesh = new THREE.InstancedMesh(brokenEarth(), new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_GRAVES);
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1); // (set for the valley in setWorld)
    this.t = new Float32Array(MAX_GRAVES).fill(-1); // seconds since each grave stirred (-1: it is not moving)
    this.open = new Uint8Array(MAX_GRAVES); // it has given up one of the dead this run
    this.live = 0; // graves in motion
    this.puff = new Float32Array(MAX_GRAVES); // time to each one's next spit of dirt
    this._o = new THREE.Object3D();
    game.scene.add(this.mesh);
  }

  // a new valley: its graves, all closed
  setWorld(world) {
    this.cem = world.cemetery;
    this.mesh.count = Math.min(MAX_GRAVES, this.cem ? this.cem.graves.length : 0);
    if (this.cem) this.mesh.boundingSphere.set(new THREE.Vector3(this.cem.x, this.cem.y, this.cem.z), 80);
    this.reset();
  }

  // a new run: every grave is whole again
  reset() {
    this.t.fill(-1);
    this.open.fill(0);
    this.live = 0;
    this.mesh.visible = false; // (not drawn at all until a grave stirs: hidden, it is still warmed up with the scene)
    for (let i = 0; i < this.mesh.count; i++) this.place(i, 0, 0);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // instance i: the broken earth of grave i, this wide and this high (0: nothing shows)
  place(i, wide, high) {
    const gr = this.cem.graves[i];
    const o = this._o;
    o.position.set(gr.x, gr.y, gr.z);
    o.rotation.y = gr.yaw;
    o.scale.set(wide, high, wide);
    o.updateMatrix();
    this.mesh.setMatrixAt(i, o.matrix);
  }

  // dirt thrown up out of grave i: n clods, the fastest this fast (m/s), and the dust of it
  spray(i, n, up) {
    const gr = this.cem.graves[i];
    const A = this.g.effects.alpha;
    const c = Math.cos(gr.yaw);
    const s = Math.sin(gr.yaw);
    for (let k = 0; k < n; k++) {
      const lx = (Math.random() - 0.5) * 0.7;
      const lz = (Math.random() - 0.5) * 1.5;
      const out = 0.6 + Math.random() * 1.6;
      A.emit(gr.x + c * lx + s * lz, gr.y + 0.25, gr.z - s * lx + c * lz, (c * lx + s * lz * 0.4) * out * 2, 1.2 + Math.random() * up, (-s * lx + c * lz * 0.4) * out * 2, 0.5 + Math.random() * 0.6, 0.09, 0.13, 0.2, 0.17, 0.13, 1, 0.2, 0.17, 0.13, 0, 13, 0.6, TEX.BLOOD);
    }
    A.emit(gr.x, gr.y + 0.3, gr.z, 0, 0.5, 0, 1.4, 0.5, 1.7, 0.36, 0.32, 0.27, 0.45, 0.33, 0.3, 0.26, 0, 0, 2, TEX.SMOKE, 0.5);
  }

  // EVT.GRAVE: grave i heaves, and CEMETERY.STIR from now one of the dead breaks out of it
  stir(i) {
    if (!this.cem || i >= this.mesh.count) return;
    const g = this.g;
    const gr = this.cem.graves[i];
    if (this.t[i] < 0) this.live++;
    this.t[i] = 0;
    this.puff[i] = 0;
    this.mesh.visible = true;
    g.audio.play(SOUND.GRAVE_STIR, { x: gr.x, y: gr.y + 0.2, z: gr.z });
  }

  update(dt) {
    const g = this.g;
    const cem = this.cem;
    if (!cem) return;
    const rp = g.renderPos;
    // the name of the place, the first time a survivor walks in through its railings
    if (!g.discovered.has(ZONE.CEMETERY) && g.self.alive && !g.prediction.state.zombie && cem.inside(rp.x, rp.z)) {
      g.discovered.add(ZONE.CEMETERY);
      g.ui.notify(`Discovered · ${ZONE_NAMES[ZONE.CEMETERY]}`, 'toast', 3.5);
    }
    if (!this.live) return;
    const end = CEMETERY.STIR + CEMETERY.RISE;
    for (let i = 0; i < this.mesh.count; i++) {
      const was = this.t[i];
      if (was < 0) continue;
      const t = (this.t[i] = was + dt);
      const gr = cem.graves[i];
      const base = this.open[i] ? OPEN : 0;
      if (t < CEMETERY.STIR) {
        // heaving: the earth swells and shudders, spitting dirt, and the ground carries it to whoever stands near
        const u = t / CEMETERY.STIR;
        const shudder = 0.06 * Math.sin(t * 43) + 0.04 * Math.sin(t * 71 + i);
        this.place(i, 0.75 + 0.25 * u + shudder * 0.5, Math.max(base, 0.2 + 0.5 * u) + shudder);
        if ((this.puff[i] -= dt) <= 0) {
          this.puff[i] = 0.1 + Math.random() * 0.12;
          this.spray(i, 2 + (u * 4) | 0, 1.5 + u * 2);
        }
        const near = 1 - Math.hypot(gr.x - rp.x, gr.z - rp.z) / SHAKE_REACH;
        if (near > 0) g.quake = Math.min(1, g.quake + near * dt * 5);
      } else {
        if (was < CEMETERY.STIR) {
          // it breaks open
          this.open[i] = 1;
          this.spray(i, 26, 5.5);
          g.audio.play(SOUND.GRAVE_BURST, { x: gr.x, y: gr.y + 0.3, z: gr.z });
        }
        // the clods fall back and settle while it climbs out, a little more dirt coming with every heave of it
        const u = Math.min(1, (t - CEMETERY.STIR) / 0.5);
        this.place(i, 1 + 0.12 * (1 - u), OPEN + (1.25 - OPEN) * (1 - u) * (1 - u));
        if (t < end && (this.puff[i] -= dt) <= 0) {
          this.puff[i] = 0.25 + Math.random() * 0.3;
          this.spray(i, 3, 2);
        }
        if (t >= end) {
          this.t[i] = -1;
          this.live--;
          this.place(i, 1, OPEN);
        }
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
