// Where the props that have left the static world are drawn (StaticWorld.lift): a wreck being taken apart, a barrel
// rocking from a blow. All of them share one mesh per material - one draw call a material however many wrecks have
// been hit, culled wreck by wreck as the static world's chunks are (a MultiMesh) - and one more per shadow side for
// their shadows. A prop is a run of each mesh's buffers; whoever owns it writes the run when its shape changes and
// at no other time, so a valley of damaged wrecks at rest costs a handful of draw calls and no work at all.
// Nothing exists until the first prop is lifted.
import * as THREE from 'three';
import { MultiMesh } from './multimesh.js';

const CUTOUT = 3, NOSHADOW = 4; // (StaticWorld's shadow sides)
const CASTER_MAT = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].map((side) => new THREE.MeshBasicMaterial({ shadowSide: side, colorWrite: false, depthWrite: false }));
const CHANS = [['pos', 'position', 3], ['nrm', 'normal', 3], ['uv', 'uv', 2], ['col', 'color', 3], ['ground', 'aGround', 1], ['tint', 'aTint', 3]];

class Slot {
  constructor(batch, mat, shadowOnly) {
    this.batch = batch;
    this.mat = mat;
    this.shadowOnly = shadowOnly;
    this.cap = 0;
    this.used = 0;
    this.free = []; // [first, count] stretches given back
    this.runs = [];
    this.arrays = {};
    this.attrs = {};
    this.mesh = null;
  }
  grow(need) {
    const cap = Math.max(4096, this.cap * 2, this.used + need);
    const g = new THREE.BufferGeometry();
    for (const [k, name, w] of CHANS) {
      if (this.shadowOnly ? k !== 'pos' : (k === 'col' && !this.mat.vertexColors) || (k === 'ground' && !this.mat.userData.staticGrime) || (k === 'tint' && !this.mat.userData.staticPaint)) continue;
      const a = new Float32Array(cap * w);
      if (this.arrays[k]) a.set(this.arrays[k]);
      this.arrays[k] = a;
      g.setAttribute(name, (this.attrs[k] = new THREE.BufferAttribute(a, w).setUsage(THREE.DynamicDrawUsage)));
    }
    this.cap = cap;
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = g;
      g.setDrawRange(0, 0);
      g.boundingSphere = new THREE.Sphere();
    } else {
      const m = (this.mesh = new MultiMesh(g, this.mat, this.runs, { casts: (run) => this.shadowOnly || run.side === CUTOUT, shadowOnly: this.shadowOnly }));
      m.name = this.shadowOnly ? 'lifted-shadow-caster' : 'lifted';
      m.receiveShadow = !this.shadowOnly;
      m.castShadow = this.shadowOnly;
      this.batch.group.add(m);
    }
  }
  alloc(count, run) {
    let first = -1;
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i];
      if (f[1] < count) continue;
      first = f[0];
      if (f[1] === count) this.free.splice(i, 1);
      else {
        f[0] += count;
        f[1] -= count;
      }
      break;
    }
    if (first < 0) {
      if (this.used + count > this.cap) this.grow(count);
      first = this.used;
      this.used += count;
    }
    run.first = first;
    run.count = count;
    this.runs.push(run);
    this.refresh();
    return run;
  }
  release(run) {
    const i = this.runs.indexOf(run);
    if (i < 0) return;
    this.runs.splice(i, 1);
    this.free.push([run.first, run.count]);
    if (!this.runs.length) {
      this.free.length = 0;
      this.used = 0;
    }
    this.refresh();
  }
  refresh() {
    this.mesh.setRuns(this.runs);
    this.mesh.visible = this.runs.length > 0 && (!this.shadowOnly || this.batch.shadows);
    if (!this.shadowOnly) this.mesh.castShadow = this.runs.some((r) => r.side === CUTOUT);
  }
  // k: 'pos', 'nrm', 'col'...: the run's stretch of that channel wants sending
  sent(run, k) {
    const a = this.attrs[k];
    if (!a) return;
    a.addUpdateRange(run.first * a.itemSize, run.count * a.itemSize);
    a.needsUpdate = true;
  }
}

export class LiftBatch {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'lifted-props';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    this.slots = new Map(); // material -> Slot
    this.shadows = true;
  }
  slot(mat, shadowOnly = false) {
    let s = this.slots.get(mat);
    if (!s) this.slots.set(mat, (s = new Slot(this, mat, shadowOnly)));
    return s;
  }
  /**
   * A place for a piece (StaticWorld.pieces): its vertex data copied in, drawn from now on by the rule its stretch
   * of the static world was. sphere: [x, y, z, r] round the whole prop. Returns the handle: { slot, run, pos (the
   * slot's positions, to write the run's stretch of), cast: the same for its shadow, or null }.
   */
  add(piece, sphere) {
    const mk = () => ({ first: 0, count: 0, chunk: piece.chunk, maxDist: piece.maxDist, side: piece.side, x: sphere[0], y: sphere[1], z: sphere[2], r: sphere[3] });
    const slot = this.slot(piece.mat);
    const run = slot.alloc(piece.count, mk());
    for (const [k] of CHANS) {
      if (!slot.arrays[k]) continue;
      if (piece[k]) slot.arrays[k].set(piece[k], run.first * slot.attrs[k].itemSize);
      slot.sent(run, k);
    }
    let cast = null;
    if (piece.side < CUTOUT) {
      const cs = this.slot(CASTER_MAT[piece.side], true);
      cast = { slot: cs, run: cs.alloc(piece.count, mk()) };
      cs.arrays.pos.set(piece.pos, cast.run.first * 3);
      cs.sent(cast.run, 'pos');
    }
    return { slot, run, cast };
  }
  // the run's shape as it is now: pos (and nrm, when the shape itself changed, not just where it stands)
  write(h, pos, nrm = null) {
    h.slot.arrays.pos.set(pos, h.run.first * 3);
    h.slot.sent(h.run, 'pos');
    if (nrm) {
      h.slot.arrays.nrm.set(nrm, h.run.first * 3);
      h.slot.sent(h.run, 'nrm');
    }
    if (h.cast) {
      h.cast.slot.arrays.pos.set(pos, h.cast.run.first * 3);
      h.cast.slot.sent(h.cast.run, 'pos');
    }
  }
  remove(h) {
    h.slot.release(h.run);
    if (h.cast) h.cast.slot.release(h.cast.run);
  }
  setShadows(on) {
    this.shadows = on;
    for (const s of this.slots.values()) if (s.shadowOnly && s.mesh) s.mesh.visible = on && s.runs.length > 0;
  }
  get drawn() {
    let n = 0;
    for (const s of this.slots.values()) if (s.runs.length) n++;
    return n;
  }
  dispose() {
    this.scene.remove(this.group);
    for (const s of this.slots.values()) s.mesh?.geometry.dispose();
    this.slots.clear();
  }
}
export { NOSHADOW };
