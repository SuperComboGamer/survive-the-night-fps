// Props that react to a blow: a wreck that is taken apart, and anything light enough to rock (a barrel, a crate).
//
// The static world is merged and its vertices are on the card: a prop that is to change is lifted out of it
// (StaticWorld.lift) and drawn from the LiftBatch instead, its triangles rebuilt and kept here. A light prop rocks
// on its base, settles, and goes back as it was. A wreck stays out until dawn:
//
//   - its triangles are sorted into the solid pieces the model was built from (wreckgeo.js islands), and those into
//     parts by where they are and what they are made of: panes and lamps, wheels, lids (a bonnet), a tailgate, a
//     door that stands ajar, and whatever is small and on the outside - bumpers, mirrors, trim, lights;
//   - every blow on record (shared/wrecks.js: where, which way, with what) does the same thing on every client: a
//     dent pressed into the panel and a mark on it, and the part it landed on or beside takes a step - glass crazes
//     and then falls out, a tyre stabbed goes down and the car settles on that corner, a lid lifts on its hinge and
//     then comes away, trim is knocked askew and then off. A blow that took salvage strips the nearest part that is
//     still on; when nothing is left to take the wreck is picked clean: no glass, no trim, lids off, on its rims;
//   - what comes off is thrown clear, bounces and comes to rest on the ground beside the wreck (worked out ahead,
//     step by step, so that a client that was not there finds each piece where the others saw it land).
//
// What is not on record is cosmetic and each client's own: the rocking on the springs (from EVT.STRIKE), the sparks,
// the sounds, the marks that fade. Nothing here runs for a wreck at rest: only the ones in `active` are updated.
import * as THREE from 'three';
import { PROPS } from '../../shared/props.js';
import { COL, footprintContains } from '../../shared/collision.js';
import { dqpos } from '../../shared/protocol.js';
import { SURF, BLOW, MARK, LIGHT_PROPS, surfaceOfMat, markFor, blowForce, NO_SURFACE, GLASS_MATS, CABIN_MATS } from '../../shared/surfaces.js';
import { HITF, WRECK_SALVAGE, wreckOf, wreckLocal } from '../../shared/wrecks.js';
import { LiftBatch } from './liftbatch.js';
import { markCorners } from './marks.js';
import { refine, islands, boxDist, rayPieces, dent, PANEL } from './wreckgeo.js';

const PAINTED = new Set(['carpaint', 'paint', 'aircraft']);
const TRIM = new Set(['chrome', 'steel', 'taillight', 'metal', 'rust', 'wood', 'plastic', 'iron', 'olive', 'tin', 'rubber', 'wire', 'emissive_red', 'cloth']);
const FINE = 0.27; // m: no edge of a panel is longer (a dent has vertices to move)
const LOOSE_MAX = 14;
const SIM_DT = 1 / 60;
const BUILD_NEAR = 170; // m: a wreck on record is built when the eye is this near
const PRY_UP = 1.08; // rad: how far a boot's lid stands open once it has been forced (shared/trunk.js)

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _ray = { t: -1, piece: 0, vert: 0, name: '', nx: 0, ny: 0, nz: 0 };
const _in = { t: -1, piece: 0, vert: 0, name: '', nx: 0, ny: 0, nz: 0 };
// what lies behind a panel, that a dent must not be pushed through: the black of an arch or an engine bay, and
// whatever is inside the cabin (its lining, a seat)
const BEHIND = new Set(['dark', ...CABIN_MATS]);
const SKIN = new Set([...PANEL, 'dark']); // what a dent moves: the panels, and the seams drawn on them
const _l = [0, 0, 0];

function seeded(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// a hinge swinging to where it stops: past it a little, and back
const swing = (t) => (t >= 1 ? 1 : 1 - Math.exp(-5.5 * t) * Math.cos(9 * t));

// ---------------------------------------------------------------- a prop out of the static world
class Lifted {
  // heavy: a vehicle on its springs (otherwise something light on its base). fine: its panels cut finer, to dent
  constructor(sys, prop, heavy, fine = false) {
    const wreck = heavy;
    this.sys = sys;
    this.prop = prop;
    this.wreck = fine; // (a Wreck: taken apart, out of the static world until dawn)
    const def = PROPS[prop.type];
    const size = def.size;
    this.half = [size[0] / 2, size[1], size[2] / 2];
    this.W = new THREE.Matrix4().compose(_v.set(prop.x, prop.y, prop.z), _q.setFromAxisAngle(Y, prop.ry), _one);
    this.Wi = this.W.clone().invert();
    const pieces = (this.pieces = sys.staticWorld.pieces(prop));
    if (fine) for (const p of pieces) refine(p, Math.max(FINE, Math.hypot(size[0], size[2]) * 0.062));
    this.orig = pieces.map((p) => p.pos);
    this.origN = pieces.map((p) => p.nrm);
    this.rest = pieces.map((p) => p.pos.slice());
    this.restN = pieces.map((p) => p.nrm.slice());
    this.cur = pieces.map((p) => new Float32Array(p.count * 3));
    this.grp = pieces.map((p) => new Uint8Array(p.count)); // 1: stands on the ground (does not rock)
    this.sphere = [prop.x, prop.y + size[1] / 2, prop.z, Math.hypot(size[0], size[1], size[2]) / 2 + 1.5];
    this.handles = null;
    // the springs: a turn about the prop's own x and z through `pivot`, and a heave
    const vol = size[0] * size[1] * size[2];
    const light = LIGHT_PROPS[prop.type];
    this.mass = wreck ? Math.min(8, Math.max(0.5, vol / 12.5)) ** 0.7 : (light || 1.5) * 0.3;
    this.freq = wreck ? 13.5 / Math.max(1, this.mass) ** 0.25 : 19;
    this.damp = wreck ? 0.2 : 0.13;
    this.limit = wreck ? 0.09 : 0.17;
    this.pivotY = wreck ? Math.min(0.35, size[1] * 0.25) : 0;
    this.ax = this.az = this.hy = 0;
    this.vx = this.vz = this.vy = 0;
    this.tx = this.tz = this.ty = 0; // where it settles (a flat tyre: down on that corner)
    this.rocking = false;
    this.shape = true; // the shape itself changed: normals want sending too
    this.anims = []; // what is moving of its own: { t, dur, step(k), done() }
    this.heavy = heavy;
    this.rockM = new THREE.Matrix4();
    this.quiet = 0; // s at rest (a light prop goes back into the static world after a moment)
  }

  lift() {
    if (this.handles) return;
    this.handles = this.pieces.map((p) => this.sys.batch.add(p, this.sphere));
    this.sys.staticWorld.lift(this.prop);
    this.flush();
  }
  drop() {
    if (!this.handles) return;
    for (const h of this.handles) this.sys.batch.remove(h);
    this.handles = null;
    this.sys.staticWorld.drop(this.prop);
    this.sys.marks?.pool.moveOwner(this.prop, null);
  }

  local(x, y, z, out = _l) {
    return wreckLocal(this.prop, x, y, z, out);
  }

  // a blow at p going d (the world's): the springs take it. k: how hard (blowForce)
  push(px, py, pz, dx, dy, dz, k) {
    const c = Math.cos(this.prop.ry), s = Math.sin(this.prop.ry);
    const p = this.local(px, py, pz);
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const ry = p[1] - this.pivotY;
    const g = ((this.heavy ? 1.05 : 2.6) * k) / this.mass;
    this.vx += (ry * lz - p[2] * dy) * g;
    this.vz += (p[0] * dy - ry * lx) * g;
    this.vy += dy * g * 0.25;
    this.rocking = true;
    this.sys.active.add(this);
  }

  // one frame: the springs, and whatever is moving of its own. Returns false once everything is at rest.
  update(dt) {
    let busy = false;
    if (this.rocking) {
      const w2 = this.freq * this.freq, c = 2 * this.damp * this.freq;
      for (let left = dt; left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        this.vx += (-w2 * (this.ax - this.tx) - c * this.vx) * h;
        this.vz += (-w2 * (this.az - this.tz) - c * this.vz) * h;
        this.vy += (-w2 * 1.6 * (this.hy - this.ty) - c * 1.4 * this.vy) * h;
        this.ax += this.vx * h;
        this.az += this.vz * h;
        this.hy += this.vy * h;
      }
      const L = this.limit;
      // (no further off where it rests than its springs travel)
      this.ax = this.tx + Math.max(-L, Math.min(L, this.ax - this.tx));
      this.az = this.tz + Math.max(-L, Math.min(L, this.az - this.tz));
      this.hy = this.ty + Math.max(-0.05, Math.min(0.05, this.hy - this.ty));
      const e = Math.abs(this.ax - this.tx) + Math.abs(this.az - this.tz) + Math.abs(this.hy - this.ty) * 4 + (Math.abs(this.vx) + Math.abs(this.vz) + Math.abs(this.vy) * 4) * 0.06;
      if (e < 0.0006) {
        this.ax = this.tx;
        this.az = this.tz;
        this.hy = this.ty;
        this.vx = this.vz = this.vy = 0;
        this.rocking = false;
      } else busy = true;
    }
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      a.step(Math.min(1, a.t / a.dur), a.t);
      if (a.t >= a.dur) {
        this.anims.splice(i, 1);
        a.done?.();
      } else busy = true;
    }
    this.flush();
    return busy;
  }
  finish() {
    // (a client that was not there: everything where it ends up, at once)
    for (const a of this.anims.splice(0)) {
      a.step(1, a.dur);
      a.done?.();
    }
    this.ax = this.tx;
    this.az = this.tz;
    this.hy = this.ty;
    this.vx = this.vz = this.vy = 0;
    this.rocking = false;
  }

  // The shape as it stands now, into the batch: what rocks turned about the pivot, what stands on the ground as it is.
  flush() {
    if (!this.handles) return;
    const tilted = this.ax !== 0 || this.az !== 0 || this.hy !== 0;
    let e = null;
    if (tilted) {
      _m.makeTranslation(0, this.pivotY + this.hy, 0);
      _m.multiply(_m2.makeRotationZ(this.az)).multiply(_m2.makeRotationX(this.ax)).multiply(_m2.makeTranslation(0, -this.pivotY, 0));
      this.rockM.multiplyMatrices(this.W, _m).multiply(this.Wi);
      e = this.rockM.elements;
    }
    for (let pi = 0; pi < this.pieces.length; pi++) {
      const R = this.rest[pi];
      let out = R;
      if (e) {
        out = this.cur[pi];
        const G = this.grp[pi];
        for (let v = 0, o = 0; v < G.length; v++, o += 3) {
          const x = R[o], y = R[o + 1], z = R[o + 2];
          if (G[v]) {
            out[o] = x;
            out[o + 1] = y;
            out[o + 2] = z;
          } else {
            out[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
            out[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
            out[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          }
        }
      }
      this.sys.batch.write(this.handles[pi], out, this.shape ? this.restN[pi] : null);
    }
    this.shape = false;
    if (tilted || this.wasTilted) this.sys.marks?.pool.moveOwner(this.prop, e);
    this.wasTilted = tilted;
  }

  // a ray (the world's) against the shape as it stands at rest
  ray(ox, oy, oz, dx, dy, dz, maxT, out = _ray) {
    return rayPieces(this.pieces, (pi) => this.rest[pi], ox, oy, oz, dx, dy, dz, maxT, out);
  }
}

// ---------------------------------------------------------------- a wreck
class Wreck extends Lifted {
  constructor(sys, prop) {
    super(sys, prop, true, true);
    this.left = WRECK_SALVAGE;
    this.hits = [];
    this.kept = []; // its marks: { i (the pool's slot), isle, c (corners as made, before the island moved) }
    this.debris = new Set(); // ...the slots of what a pane left when it went (the next pane to go does not sweep those away)
    this.clean = false;
    this.rnd = seeded((prop.seed + 1) * 7919 + Math.round(prop.x * 13 + prop.z * 7));
    this.sort();
  }

  // ---- the model's solid pieces, sorted into parts
  sort() {
    const is = (this.isles = islands(this.pieces, (x, y, z, o) => this.local(x, y, z, o)));
    this.isleOf = this.pieces.map((p) => new Int32Array(p.count).fill(-1));
    is.forEach((s, i) => {
      s.i = i;
      s.op = null;
      s.part = null;
      s.gone = false;
      const map = this.isleOf[s.piece];
      for (const v of s.verts) map[v] = i;
    });
    const hx = this.half[0], hz = this.half[2];
    const parts = (this.parts = []);
    const part = (kind, isles, o = {}) => {
      const p = { kind, isles, state: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], ...o };
      for (const s of isles) {
        s.part = p;
        for (let c = 0; c < 3; c++) {
          p.min[c] = Math.min(p.min[c], s.min[c]);
          p.max[c] = Math.max(p.max[c], s.max[c]);
        }
      }
      p.mid = [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2];
      p.size = Math.hypot(p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]);
      parts.push(p);
      return p;
    };
    const body = is[0];
    const ground = (s) => {
      const G = this.grp[s.piece];
      for (const v of s.verts) G[v] = 1;
      s.ground = true;
    };
    // wheels: a tyre and what sits in it. They stand on the ground while the body rocks over them
    for (const s of is) {
      if (s.name !== 'tire' || s.part) continue;
      const mem = is.filter((o) => o !== s && o !== body && !o.part && o.size < s.size && boxDist(s, o.mid[0], o.mid[1], o.mid[2]) < 0.06);
      part('wheel', [s, ...mem]);
    }
    for (const s of is) {
      if (s === body || s.part) continue;
      const ext = [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]];
      if (NO_SURFACE.has(s.name) || s.min[1] < 0.035) ground(s);
      else if (GLASS_MATS.has(s.name)) part(s.size >= 0.35 ? 'pane' : 'lamp', [s]);
      else if (PAINTED.has(s.name) && ext[1] <= 0.1 && ext[0] >= hx * 1.2 && s.min[1] > 0.5 && Math.abs(s.mid[2]) > hz * 0.42) {
        // a lid: hinged along the edge nearer the middle of the car
        const front = s.mid[2] < 0;
        part('lid', [s], { hinge: [0, s.mid[1], front ? s.max[2] : s.min[2]], axis: X, open: front ? 1 : -1, stops: [0.22, 0.95] });
      } else if (PAINTED.has(s.name) && ext[2] <= 0.1 && ext[0] >= hx * 1.2 && ext[1] >= 0.3 && Math.abs(s.mid[2]) > hz * 0.8) {
        part('gate', [s], { hinge: [0, s.min[1], s.mid[2]], axis: X, open: s.mid[2] > 0 ? 1 : -1, stops: [0.45, 1.5] });
      } else if (PAINTED.has(s.name) && ext[1] >= 0.4 && ext[1] <= 0.8 && s.min[1] < 0.45 && ext[0] > 0.35 && ext[2] > 0.35 && s.size > 1.05 && s.size < 1.75) {
        // a door that stands ajar: hinged at the corner of its box that is on the body's side and has the door's edge in it
        const side = s.mid[0] < 0 ? -1 : 1;
        const hxx = Math.abs(s.min[0] - side * hx) < Math.abs(s.max[0] - side * hx) ? s.min[0] : s.max[0];
        const P = this.orig[s.piece];
        let n0 = 0, n1 = 0;
        for (const v of s.verts) {
          const l = this.local(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          if (Math.abs(l[0] - hxx) > 0.12) continue;
          if (Math.abs(l[2] - s.min[2]) < 0.12) n0++;
          if (Math.abs(l[2] - s.max[2]) < 0.12) n1++;
        }
        part('door', [s], { hinge: [hxx, s.mid[1], n0 >= n1 ? s.min[2] : s.max[2]], axis: Y, open: 0, stops: [0.45, 0.9] });
      }
    }
    // (a door's window frame swings with it)
    for (const d of parts.filter((p) => p.kind === 'door')) {
      for (const s of is) {
        if (s.part || s === body || !PAINTED.has(s.name) || s.size > 1.2) continue;
        // (a corner of its box at the hinge, above the door, and lying the door's way: a pillar of the body does not)
        const corner = Math.min(Math.hypot(s.min[0] - d.hinge[0], s.min[2] - d.hinge[2]), Math.hypot(s.max[0] - d.hinge[0], s.min[2] - d.hinge[2]), Math.hypot(s.min[0] - d.hinge[0], s.max[2] - d.hinge[2]), Math.hypot(s.max[0] - d.hinge[0], s.max[2] - d.hinge[2]));
        if (corner < 0.14 && s.min[1] >= d.max[1] - 0.1 && s.max[0] - s.min[0] > 0.3 && s.max[2] - s.min[2] > 0.3) {
          d.isles.push(s);
          s.part = d;
        }
      }
    }
    // trim: what is small, on the outside and not part of the body - bumpers, mirrors, lights, handles. Pieces of
    // one material that touch come off together (the bars of a grille)
    const loose = [];
    for (const s of is) {
      if (s === body || s.part || s.ground || !TRIM.has(s.name) || s.size > 2.3 || s.size < 0.1) continue;
      const ext = [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]];
      if (ext[0] * ext[1] * ext[2] > 0.06) continue;
      const edge = Math.min(hx - Math.abs(s.mid[0]), hz - Math.abs(s.mid[2]), this.half[1] - s.mid[1]);
      if (edge > 0.3) continue;
      loose.push(s);
    }
    const used = new Set();
    for (const s of loose) {
      if (used.has(s) || parts.filter((p) => p.kind === 'loose').length >= LOOSE_MAX) continue;
      const group = [s];
      used.add(s);
      for (const o of loose) {
        if (used.has(o) || o.name !== s.name) continue;
        if (group.some((g) => g.min[0] - 0.02 <= o.max[0] && o.min[0] - 0.02 <= g.max[0] && g.min[1] - 0.07 <= o.max[1] && o.min[1] - 0.07 <= g.max[1] && g.min[2] - 0.02 <= o.max[2] && o.min[2] - 0.02 <= g.max[2])) {
          group.push(o);
          used.add(o);
        }
      }
      const p = part('loose', group);
      p.hp = p.hp0 = 0.35 + p.size * 0.45;
    }
    // a lamp goes with the housing it is set in
    for (const l of parts.filter((p) => p.kind === 'lamp')) {
      l.on = parts.find((p) => p.kind === 'loose' && boxDist(p, l.mid[0], l.mid[1], l.mid[2]) < 0.05) || null;
    }
    this.wheels = parts.filter((p) => p.kind === 'wheel');
    for (const w of this.wheels) for (const s of w.isles) ground(s);
  }

  // ---- islands that move
  // an island's vertices from its op (null: where the model has them)
  place(s) {
    const O = this.orig[s.piece], N = this.origN[s.piece], R = this.rest[s.piece], RN = this.restN[s.piece];
    const e = s.op ? s.op.elements : null;
    for (const v of s.verts) {
      const o = v * 3;
      const x = O[o], y = O[o + 1], z = O[o + 2];
      if (!e) {
        R[o] = x;
        R[o + 1] = y;
        R[o + 2] = z;
        RN[o] = N[o];
        RN[o + 1] = N[o + 1];
        RN[o + 2] = N[o + 2];
        continue;
      }
      R[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      R[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      R[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (s.gone) continue;
      const nx = N[o], ny = N[o + 1], nz = N[o + 2];
      RN[o] = e[0] * nx + e[4] * ny + e[8] * nz;
      RN[o + 1] = e[1] * nx + e[5] * ny + e[9] * nz;
      RN[o + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
    }
    if (s.down) {
      // a wheel on a flat tyre: all of it lower by `drop`, and what would be under the ground flat on it - the
      // rim stays round, the tyre's foot spreads
      const floor = this.prop.y + s.down.y0 + 0.004;
      for (const v of s.verts) {
        const o = v * 3 + 1;
        R[o] = Math.max(floor, R[o] - s.down.drop);
      }
    }
    this.shape = true;
    // its marks go where it goes
    for (const k of this.kept) {
      if (k.isle !== s) continue;
      const pool = this.sys.marks.pool;
      for (let c = 0; c < 12; c += 3) {
        const x = k.c[c], y = k.c[c + 1], z = k.c[c + 2];
        const o = k.i * 12 + c;
        pool.rest[o] = e ? e[0] * x + e[4] * y + e[8] * z + e[12] : x;
        pool.rest[o + 1] = e ? e[1] * x + e[5] * y + e[9] * z + e[13] : y;
        pool.rest[o + 2] = e ? e[2] * x + e[6] * y + e[10] * z + e[14] : z;
      }
      pool.pos.set(pool.rest.subarray(k.i * 12, k.i * 12 + 12), k.i * 12);
      pool.touch(k.i);
    }
  }
  setOp(part, m) {
    for (const s of part.isles) {
      if (s.gone) continue;
      (s.op ||= new THREE.Matrix4()).copy(m);
      this.place(s);
    }
  }
  // gone for good: glass that has fallen out. Its triangles close up to nothing
  vanish(s) {
    s.gone = true;
    (s.op ||= new THREE.Matrix4()).makeScale(0, 0, 0).setPosition(this.worldOf(s.mid, _v));
    this.place(s);
  }
  worldOf(l, out) {
    return out.set(l[0], l[1], l[2]).applyMatrix4(this.W);
  }
  // a turn by `a` about an axis of the wreck's own through `h` (its own frame), as a matrix of the world
  hingeM(h, axis, a, out) {
    _m.makeTranslation(h[0], h[1], h[2]).multiply(_m2.makeRotationAxis(axis, a)).multiply(_m2.makeTranslation(-h[0], -h[1], -h[2]));
    return out.multiplyMatrices(this.W, _m).multiply(this.Wi);
  }

  // ---- marks that stay
  keep(cell, corners, nx, ny, nz, isle, tint = 1, alpha = 1) {
    const pool = this.sys.marks?.pool;
    if (!pool) return;
    let i = pool.keep(corners, nx, ny, nz, cell, tint, tint, tint, alpha, this.prop);
    if (i < 0) i = pool.add(corners, nx, ny, nz, cell, tint, tint, tint, alpha, this.prop, this.sys.time); // (the kept ones are all taken: one that fades)
    // (as made: where the island stood then - its op undone)
    const c = Float32Array.from(corners);
    if (isle?.op) {
      const e = _m.copy(isle.op).invert().elements;
      for (let k = 0; k < 12; k += 3) {
        const x = c[k], y = c[k + 1], z = c[k + 2];
        c[k] = e[0] * x + e[4] * y + e[8] * z + e[12];
        c[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        c[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
    }
    const k = { i, isle, c };
    this.kept.push(k);
    return k;
  }
  // (a mark that is what a pane left behind it: see `debris`)
  debrisOf(k) {
    if (k && k.i >= this.sys.marks.pool.ring) this.debris.add(k.i);
  }
  unkeep(k) {
    const i = this.kept.indexOf(k);
    if (i < 0) return;
    this.kept.splice(i, 1);
    this.sys.marks.pool.kill(k.i);
  }

  // ---- one blow on record
  // live: it is happening now (things move, and are heard); otherwise everything is where it ends up
  apply(hit, live) {
    const sys = this.sys;
    const px = dqpos(hit[0]), py = dqpos(hit[1]), pz = dqpos(hit[2]);
    const yaw = (hit[3] / 256) * Math.PI * 2, pitch = (hit[4] / 127) * (Math.PI / 2);
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
    const blow = hit[5] & HITF.BLOW, heavy = !!(hit[5] & HITF.HEAVY), took = !!(hit[5] & HITF.TOOK);
    const force = blowForce(blow, heavy);
    const n = this.hits.length;
    this.hits.push(hit);
    // What a blow does is judged on the wreck as it will stand once everything still moving has come to rest - the
    // wreck a client that was not watching has: so whatever is in the air is put where it lands for the judging, and
    // back where it was for the eye (probe: without a sound)
    for (const a of this.anims) a.step(1, a.dur, true);
    // (...and a boot that was forced open is not on the record at all - it is the container's state, which a client
    // may learn before or after any blow: the lid is put where the record has it for the judging)
    const boot = this.pried ? this.bootLid() : null;
    this.judging = true; // (...and whatever moves it meanwhile moves it from there: lidShown)
    if (boot && boot.state < 3) this.setOp(boot, this.hingeM(boot.hinge, boot.axis, boot.angle || 0, _m2));
    const r = seeded(hit[0] * 31 + hit[1] * 131 + hit[2] * 17 + n * 977);
    // what the blow landed on: the triangle, the island it is of, the part that is of
    this.ray(px - dx * 0.7, py - dy * 0.7, pz - dz * 0.7, dx, dy, dz, 2.2, _ray);
    const struck = _ray.t >= 0;
    const hx = struck ? px + dx * (_ray.t - 0.7) : px, hy = struck ? py + dy * (_ray.t - 0.7) : py, hz = struck ? pz + dz * (_ray.t - 0.7) : pz;
    const nx = struck ? _ray.nx : -dx, ny = struck ? _ray.ny : -dy, nz = struck ? _ray.nz : -dz;
    const isle = struck ? this.isles[this.isleOf[_ray.piece][_ray.vert]] : null;
    const l = this.local(hx, hy, hz, [0, 0, 0]);
    let part = isle?.part || null;
    const reach = blow === BLOW.BLAST ? 1.7 : blow === BLOW.SLASH ? 0.1 : blow === BLOW.BLUNT ? 0.34 : 0.24;
    if (blow === BLOW.BLAST) {
      // everything on that side: the glass goes, the trim is thrown off, the body is stove in
      if (struck) this.markAt(blow, isle, hx, hy, hz, nx, ny, nz, dx, dy, dz, r, 1.1, 0.13);
      this.dent(hx, hy, hz, dx, dy, dz, 1.1, 0.13);
      for (const p of this.parts) {
        if (boxDist(p, l[0], l[1], l[2]) > reach) continue;
        if (p.kind === 'pane' || p.kind === 'lamp') this.breakGlass(p, 2, live, dx, dy, dz);
        else if (p.kind === 'loose' && r() < 0.7) this.knock(p, 9, live, dx, dy, dz, 1, r);
        else if (p.kind === 'wheel' && r() < 0.5) this.deflate(p, live);
        else if (p.kind === 'lid' || p.kind === 'gate' || p.kind === 'door') this.hingeStep(p, live, l, dx, dy, dz, r, 2);
      }
      if (live) this.push(hx, hy, hz, dx, dy, dz, 2.2);
    } else {
      if (!part) {
        // beside something: the nearest part within the weapon's reach of where it landed
        let best = reach;
        for (const p of this.parts) {
          if (p.kind === 'wheel' && blow !== BLOW.SLASH && blow !== BLOW.CHOP) continue;
          // (glass has to be struck, or all but: a blow on the door under a window leaves the window)
          const d = boxDist(p, l[0], l[1], l[2]) * (p.kind === 'pane' ? 3 : 1);
          if (d < best && !this.spent(p)) {
            best = d;
            part = p;
          }
        }
      }
      const glass = isle && GLASS_MATS.has(isle.name);
      const tyre = isle && (isle.name === 'tire' || isle.name === 'rubber');
      // (through an opening and onto a seat: a mark on it, and nothing bent - the panels round it are not what was hit)
      const inside = isle && CABIN_MATS.has(isle.name);
      if (struck && !glass) {
        // a bat stoves a panel in a hand's depth across half a metre; a machete leaves a crease, a hammer a deep small pit
        const radius = blow === BLOW.BLUNT ? 0.36 : blow === BLOW.CHOP ? 0.24 : 0.2;
        const depth = tyre || inside || blow === BLOW.SLASH ? 0 : (blow === BLOW.BLUNT ? 0.085 : blow === BLOW.CHOP ? 0.05 : 0.06) * (heavy ? 1.35 : 1);
        // (the mark first, on the panel while it is still flat; then the hollow, and the mark let down into it)
        this.markAt(blow, isle, hx, hy, hz, nx, ny, nz, dx, dy, dz, r, radius, depth);
        if (depth) this.dent(hx, hy, hz, dx, dy, dz, radius, depth);
      }
      if (part) this.react(part, blow, heavy, force, live, l, dx, dy, dz, r);
    }
    // a blow that took salvage takes something off: the nearest part that is still on
    if (took) {
      let best = Infinity, pick = null;
      for (const p of this.parts) {
        if (p === part || this.spent(p) || p.kind === 'wheel' || p.kind === 'door') continue;
        // (trim first; glass is not worth taking, and goes when there is nothing else in arm's reach)
        const d = boxDist(p, l[0], l[1], l[2]) + (p.kind === 'pane' ? 1.6 : 0) + (p.kind === 'lamp' ? 1 : 0);
        if (d < best) {
          best = d;
          pick = p;
        }
      }
      if (pick) this.strip(pick, live, dx, dy, dz, r, 0.25 + n * 0.05);
      if (live) sys.on.scrap?.(hx, hy, hz, nx, ny, nz);
    }
    this.judging = false;
    if (boot && boot.state < 3) this.setOp(boot, this.hingeM(boot.hinge, boot.axis, this.lidShown(boot, boot.angle || 0), _m2));
    for (const a of this.anims) a.step(Math.min(1, a.t / a.dur), a.t, true);
  }

  // ---- the boot, forced open (shared/trunk.js: the container behind the car has been searched)
  // its lid: the one behind the cabin (a bonnet is the other), or null - a pickup, a van
  bootLid() {
    if (this._boot === undefined) this._boot = this.parts.find((p) => p.kind === 'lid' && p.mid[2] > 0) || null;
    return this._boot;
  }
  // the angle a lid is drawn at: a forced boot's stands up at least PRY_UP, whatever blows have done to it
  lidShown(p, a) {
    return this.pried && !this.judging && p === this.bootLid() ? p.open * Math.max(Math.abs(a), PRY_UP) : a;
  }
  // on: it stands open (off: the container was filled again - shut). live: it is being forced now - the lid
  // strains, lets go with a bang and swings up; otherwise it is simply there
  pry(on, live) {
    const p = this.bootLid();
    const was = !!this.pried;
    const from = p ? this.lidShown(p, p.angle || 0) : 0;
    this.pried = !!on;
    if (!p || p.state >= 3 || was === !!on) return;
    this.settle(p);
    const to = this.lidShown(p, p.angle || 0);
    const set = (a) => this.setOp(p, this.hingeM(p.hinge, p.axis, a, _m2));
    if (!live || !on) return set(to);
    const c = this.worldOf(p.mid, _v);
    const [cx, cy, cz] = [c.x, c.y, c.z];
    let banged = false;
    this.anim(p, 1.25, (k, t, probe) => {
      // a moment of it lifting a finger's width against its catch, then free
      if (t < 0.22) return set(from + p.open * 0.035 * Math.abs(Math.sin(t * 40)));
      if (!banged && !probe) {
        banged = true;
        this.sys.on.sound?.('metal_bang', cx, cy, cz, 0.9);
        this.sys.on.sound?.('hinge_creak', cx, cy, cz, 1);
        this.sys.on.puff?.(cx, cy, cz);
      }
      // (to where it is shown now: a blow that lands meanwhile is judged with it where the record has it)
      const up = this.lidShown(p, p.angle || 0);
      set(from + (up - from) * swing((t - 0.22) / 1.03));
    });
    this.push(cx, cy, cz, 0, 1, 0, 0.5);
  }

  spent(p) {
    return p.kind === 'pane' || p.kind === 'lamp' ? p.state >= 2 : p.kind === 'wheel' ? p.state >= 1 : p.state >= 3;
  }

  dent(x, y, z, dx, dy, dz, radius, depth) {
    // (into the panel: mostly the way the blow went, never out of it)
    // (no further in than what is behind the skin: the black of the wheel arches and the cabin are solids of the
    // model a finger's width inside it, and a panel pushed through one shows as a black patch)
    // (a solid of black: not the hair's breadth of a seam drawn on the panel)
    const thin = (s) => Math.min(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]) < 0.06;
    // (...and the cabin's lining, which is a sheet and still what is behind the panel)
    const solid = (pi, v) => {
      const s = this.isles[this.isleOf[pi][v]];
      return CABIN_MATS.has(s.name) || !thin(s);
    };
    // (...asked at the vertex and a triangle's reach to each side of it: a triangle with one corner held back by
    // the wheel arch behind it and the others pushed in would cut through the arch's corner)
    let ax = -dz, ay = 0, az = dx;
    const al = Math.hypot(ax, az);
    if (al < 0.3) {
      ax = 1;
      az = 0;
    } else {
      ax /= al;
      az /= al;
    }
    const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
    const reach = FINE * 0.9;
    const inner = (vx, vy, vz, h) => {
      let room = h;
      for (let i = 0; i < 5 && room > 0; i++) {
        const u = i === 1 ? reach : i === 2 ? -reach : 0, w = i === 3 ? reach : i === 4 ? -reach : 0;
        rayPieces(this.pieces, (pi) => this.orig[pi], vx + ax * u + bx * w - dx * 0.03, vy + ay * u + by * w - dy * 0.03, vz + az * u + bz * w - dz * 0.03, dx, dy, dz, room + 0.05, _in, BEHIND, solid);
        if (_in.t >= 0) room = Math.min(room, Math.max(0, _in.t - 0.03 - 0.012));
      }
      return room;
    };
    const moved = dent(this.pieces, (pi) => this.orig[pi], (pi) => this.origN[pi], (pi, v) => {
      const s = this.isles[this.isleOf[pi][v]];
      // (the black of a door's seam is drawn on the panel, and goes in with it)
      return s && !s.ground && !(s.part && s.part.kind === 'loose') && (s.name !== 'dark' || thin(s));
    }, x, y, z, dx, dy, dz, radius, depth, inner, SKIN);
    if (!moved) return;
    // (the islands it bent, as they stand now)
    const seen = new Set();
    const r2 = (radius + 0.05) ** 2;
    for (let pi = 0; pi < this.pieces.length; pi++) {
      const P = this.orig[pi], map = this.isleOf[pi];
      for (const nm of this.pieces[pi].names) {
        if (!SKIN.has(nm.name)) continue;
        for (let v = nm.first; v < nm.first + nm.count; v++) {
          const s = this.isles[map[v]];
          if (seen.has(s)) continue;
          if ((P[v * 3] - x) ** 2 + (P[v * 3 + 1] - y) ** 2 + (P[v * 3 + 2] - z) ** 2 < r2) seen.add(s);
        }
      }
    }
    for (const s of seen) if (s) this.place(s);
  }

  // the mark a blow leaves where it landed (it stays: part of what the wreck looks like)
  // radius, depth: of the dent about to be pressed in there - the mark is let down to the hollow's depth at its own edge
  markAt(blow, isle, x, y, z, nx, ny, nz, dx, dy, dz, r, radius = 1, depth = 0) {
    const surf = isle ? surfaceOfMat(isle.name) : SURF.METAL;
    if (surf === SURF.GLASS) return;
    const m = markFor(surf, blow);
    const half = Math.max(m.w, m.h) / 2;
    const room = roomAt((...a) => this.ray(...a), x, y, z, nx, ny, nz, half);
    const k0 = 0.85 + r() * 0.3, spin = r(), turn = r();
    if (room <= 0) return; // (no face there big enough to carry it: the dent itself is the mark)
    const k = k0 * (room / half);
    if (depth) {
      const e = Math.min(1, (room * 0.8) / radius);
      const sink = depth * (1 - e * e) ** 2;
      x += dx * sink;
      y += dy * sink;
      z += dz * sink;
    }
    const c = m.along ? strokeCorners(x, y, z, nx, ny, nz, m.w * k, m.h * k, dx, dy, dz, spin) : markCorners(x, y, z, nx, ny, nz, m.w * k, m.h * k, null, 0, 0, turn * 6.283);
    this.keep(m.cell, c, nx, ny, nz, isle, 1, blow === BLOW.BLAST ? 0.7 : 1);
  }

  // ---- parts
  react(p, blow, heavy, force, live, l, dx, dy, dz, r) {
    const blade = blow === BLOW.SLASH || blow === BLOW.CHOP;
    if (p.kind === 'pane') this.breakGlass(p, heavy && !blade ? 2 : 1, live, dx, dy, dz);
    else if (p.kind === 'lamp') this.breakGlass(p, 2, live, dx, dy, dz);
    else if (p.kind === 'wheel') {
      if (blade) this.deflate(p, live);
    } else if (p.kind === 'loose') this.knock(p, force, live, dx, dy, dz, 0.6, r);
    else if (blow !== BLOW.SLASH) this.hingeStep(p, live, l, dx, dy, dz, r, heavy ? 2 : 1);
  }
  // taken off for its metal: whatever state it was in, it ends on the ground (or, glass, gone)
  strip(p, live, dx, dy, dz, r, delay = 0) {
    if (p.kind === 'pane' || p.kind === 'lamp') this.breakGlass(p, 2, live, dx, dy, dz);
    else if (p.kind === 'loose') this.knock(p, 9, live, dx, dy, dz, 0.25, r, delay);
    else this.throwOff(p, live, dx, dy, dz, 0.25, r, delay);
  }

  quad(p) {
    // a pane's four corners (the world's), and its normal: its box, flattened along its thinnest way through the body
    const s = p.isles[0];
    const P = this.rest[s.piece];
    const v0 = s.verts[0] * 3;
    const ax = P[v0 + 3] - P[v0], ay = P[v0 + 4] - P[v0 + 1], az = P[v0 + 5] - P[v0 + 2];
    const bx = P[v0 + 6] - P[v0], by = P[v0 + 7] - P[v0 + 1], bz = P[v0 + 8] - P[v0 + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // (outward: away from the middle of the wreck)
    const c = this.worldOf(s.mid, _v);
    const out = (c.x - this.prop.x) * nx + (c.y - (this.prop.y + this.half[1] * 0.5)) * ny + (c.z - this.prop.z) * nz;
    if (out < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    // across it: level, and up its slope
    let ux = -nz, uy = 0, uz = nx;
    const ul = Math.hypot(ux, uz);
    if (ul < 0.2) {
      ux = Math.cos(this.prop.ry);
      uz = -Math.sin(this.prop.ry);
    } else {
      ux /= ul;
      uz /= ul;
    }
    const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const v of s.verts) {
      const x = P[v * 3] - c.x, y = P[v * 3 + 1] - c.y, z = P[v * 3 + 2] - c.z;
      const u = x * ux + y * uy + z * uz, w = x * wx + y * wy + z * wz;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      w0 = Math.min(w0, w);
      w1 = Math.max(w1, w);
    }
    const q = new Float32Array(12);
    const at = (u, w, o) => {
      q[o] = c.x + ux * u + wx * w + nx * 0.012;
      q[o + 1] = c.y + uy * u + wy * w + ny * 0.012;
      q[o + 2] = c.z + uz * u + wz * w + nz * 0.012;
    };
    at(u0, w0, 0);
    at(u1, w0, 3);
    at(u1, w1, 6);
    at(u0, w1, 9);
    // `fit`: the opening itself, where the pane is a plain four-sided one that is not square to its box (a screen
    // narrower at the top, a quarter light): its own corners, in the same order - what is left in the frame is
    // drawn to those, not to the box
    let fit = q;
    const cs = [];
    for (const v of s.verts) {
      const x = P[v * 3] - c.x, y = P[v * 3 + 1] - c.y, z = P[v * 3 + 2] - c.z;
      const u = x * ux + y * uy + z * uz, w = x * wx + y * wy + z * wz;
      if (!cs.some((k) => Math.abs(k[0] - u) < 1e-3 && Math.abs(k[1] - w) < 1e-3)) cs.push([u, w]);
      if (cs.length > 4) break;
    }
    if (cs.length === 4) {
      fit = new Float32Array(12);
      const um = (u0 + u1) / 2, wm = (w0 + w1) / 2;
      const pick = (su, sw) => cs.reduce((best, k) => ((k[0] - um) * su + (k[1] - wm) * sw > (best[0] - um) * su + (best[1] - wm) * sw ? k : best));
      [pick(-1, -1), pick(1, -1), pick(1, 1), pick(-1, 1)].forEach((k, i) => {
        fit[i * 3] = c.x + ux * k[0] + wx * k[1] + nx * 0.012;
        fit[i * 3 + 1] = c.y + uy * k[0] + wy * k[1] + ny * 0.012;
        fit[i * 3 + 2] = c.z + uz * k[0] + wz * k[1] + nz * 0.012;
      });
    }
    return { q, fit, nx, ny, nz, c: c.clone() };
  }
  breakGlass(p, steps, live, dx, dy, dz) {
    if (p.state >= 2) return;
    const was = p.state;
    p.state = Math.min(2, p.state + steps);
    const s = p.isles[0];
    const g = this.quad(p);
    if (p.kind === 'pane' && p.state === 1) {
      p.crack = this.keep(MARK.CRACK_PANE, g.q, g.nx, g.ny, g.nz, s, 1, 0.95);
      if (live) this.sys.on.sound?.('glass_crack', g.c.x, g.c.y, g.c.z, 0.9);
      return;
    }
    if (p.crack) this.unkeep(p.crack);
    p.crack = null;
    this.sys.marks?.pool.removeNear?.(this.prop, g.c.x, g.c.y, g.c.z, p.size * 0.55, false, this.debris);
    this.vanish(s);
    if (p.kind === 'pane') {
      // what is left of it lies under where it was, on the outside
      const ox = g.c.x + g.nx * 0.45, oz = g.c.z + g.nz * 0.45;
      const gy = this.sys.world.heightAt(ox, oz);
      const k = Math.min(1.5, 0.6 + p.size * 0.5);
      this.debrisOf(this.keep(MARK.SHARDS, markCorners(ox, gy, oz, 0, 1, 0, k, k, null, 0, 0, s.mid[0] * 3 + s.mid[2]), 0, 1, 0, null, 1, 0.9));
      // ...teeth of it stand in the frame all round the opening
      this.debrisOf(this.keep(MARK.REMNANT, g.fit, g.nx, g.ny, g.nz, null, 1.25, 0.95));
      // ...and the rest went in: on the seat or the floor inside, under the opening (a vehicle that has an inside)
      const ix = g.c.x - g.nx * 0.3, iy = g.c.y - g.ny * 0.3, iz = g.c.z - g.nz * 0.3;
      // (on something level in there - a cushion, the floor, a load: not balanced on the wheel or on whoever sits
      // there. Straight down from just inside the opening, or a hand's width to either side along it)
      const ax = -g.nz, az = g.nx, al = Math.hypot(ax, az) || 1;
      let sx = ix, sz = iz, best = null;
      for (const k of [0, 0.22, -0.22]) {
        const px = ix + (ax / al) * k, pz = iz + (az / al) * k;
        rayPieces(this.pieces, (pi) => this.rest[pi], px, iy, pz, 0, -1, 0, 1.6, _in, CABIN_MATS);
        if (_in.t < 0 || (best && _in.ny <= best.ny)) continue;
        best = { t: _in.t, nx: _in.nx, ny: _in.ny, nz: _in.nz };
        sx = px;
        sz = pz;
        if (best.ny > 0.6) break;
      }
      // (...or, with somebody sat under every one of them, in their lap)
      if (best && best.ny > 0.25) {
        Object.assign(_in, best);
        const ki = Math.min(0.7, 0.35 + p.size * 0.25);
        this.debrisOf(this.keep(MARK.SHARDS, markCorners(sx, iy - _in.t, sz, _in.nx, _in.ny, _in.nz, ki, ki, null, 0, 0, s.mid[2] * 5 + s.mid[0]), _in.nx, _in.ny, _in.nz, null, 1.2, 0.95));
      }
    }
    if (live) {
      this.sys.on.shatter?.(g.q, g.nx, g.ny, g.nz, dx, dy, dz, p.kind === 'pane' ? 30 : 8);
      this.sys.on.sound?.(p.kind === 'pane' ? 'glass_break' : 'glass_crack', g.c.x, g.c.y, g.c.z, p.kind === 'pane' ? 1 : 0.8);
    }
    void was;
  }

  deflate(p, live) {
    if (p.state) return;
    this.settle(p);
    p.state = 1;
    const tyre = p.isles[0];
    const side = Math.sign(tyre.mid[0]) || 1, end = Math.sign(tyre.mid[2]) || 1;
    // how far the wheel comes down: most of the depth of the tyre's wall (its radius less the rim's)
    const R = (tyre.max[1] - tyre.min[1]) / 2;
    let rim = 0;
    for (const s of p.isles) if (s !== tyre) rim = Math.max(rim, (s.max[1] - s.min[1]) / 2);
    if (!rim || rim > R * 0.85) rim = R * 0.62;
    const drop = 0.62 * (R - rim);
    // ...and the body with it: it leans to that side and that end by what the corner lost
    const from = { tx: this.tx, tz: this.tz, ty: this.ty };
    const to = { tx: from.tx + end * Math.min(0.05, (drop * 0.5) / Math.max(1, this.half[2])), tz: from.tz - side * Math.min(0.11, (drop * 0.5) / Math.max(0.5, this.half[0])), ty: from.ty - drop * 0.2 };
    const y0 = tyre.min[1];
    const set = (k) => {
      for (const s of p.isles) {
        s.down = { y0, drop: drop * k };
        this.place(s);
      }
      this.tx = from.tx + (to.tx - from.tx) * k;
      this.tz = from.tz + (to.tz - from.tz) * k;
      this.ty = from.ty + (to.ty - from.ty) * k;
      if (!this.rocking) {
        this.ax = this.tx;
        this.az = this.tz;
        this.hy = this.ty;
      }
    };
    if (!live) return set(1);
    const c = this.worldOf(tyre.mid, _v);
    this.sys.on.sound?.('tyre_hiss', c.x, c.y, c.z, 1);
    this.sys.on.puff?.(c.x, c.y - 0.15, c.z);
    this.anim(p, 1.6, (k) => set(ease(k)));
  }

  hingeStep(p, live, l, dx, dy, dz, r, steps = 1) {
    if (p.state >= 3) return;
    this.settle(p);
    const c = Math.cos(this.prop.ry), s = Math.sin(this.prop.ry);
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    let dir = p.open;
    if (p.kind === 'door') {
      // pushed the way the blow turns it about its hinge
      const rx = l[0] - p.hinge[0], rz = l[2] - p.hinge[2];
      dir = rz * lx - rx * lz >= 0 ? 1 : -1;
      if (p.state > 0 && dir !== p.dir) {
        // knocked back the way it came: a stop nearer shut
        p.state = Math.max(0, p.state - steps);
        return this.swingTo(p, p.state ? p.dir * p.stops[p.state - 1] : 0, live);
      }
      p.dir = dir;
    }
    // two stops; wide open it takes two more blows to tear it off its hinges
    if (p.state >= 2) {
      p.wear = (p.wear || 0) + steps;
      if (p.wear >= 2) {
        p.state = 3;
        return this.throwOff(p, live, dx, dy, dz, 0.7, r);
      }
      // (it shudders on its hinges)
      const a = p.angle || 0;
      if (live) this.anim(p, 0.5, (k) => this.setOp(p, this.hingeM(p.hinge, p.axis, a + Math.sin(k * Math.PI * 3) * 0.07 * (1 - k), _m2)));
      return;
    }
    p.state = Math.min(2, p.state + steps);
    this.swingTo(p, dir * p.stops[p.state - 1], live);
  }
  swingTo(p, to, live) {
    const from = p.angle || 0;
    p.angle = to;
    const set = (a) => this.setOp(p, this.hingeM(p.hinge, p.axis, this.lidShown(p, a), _m2));
    if (!live) return set(to);
    const c = this.worldOf(p.mid, _v);
    this.sys.on.sound?.('hinge_creak', c.x, c.y, c.z, 0.9);
    this.anim(p, 0.9, (k) => set(from + (to - from) * swing(k)));
  }

  // trim: knocked askew (the long ones hang by an end), then off
  knock(p, force, live, dx, dy, dz, vigour, r, delay = 0) {
    if (p.state >= 3) return;
    this.settle(p);
    p.hp -= force;
    if (p.hp > 0) {
      if (p.state >= 1) return;
      p.state = 1;
      // down at one end, or just out of true
      const ext = [p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]];
      const long = ext[0] >= ext[2] ? 0 : 2;
      const end = r() < 0.5 ? -1 : 1;
      const h = [p.mid[0], p.mid[1], p.mid[2]];
      h[long] += (end * ext[long]) / 2;
      const a = (long === 0 ? -end : end) * Math.min(0.5, 0.12 + 0.2 / Math.max(0.3, ext[long]));
      const axis = long === 0 ? Z : X;
      const set = (k) => this.setOp(p, this.hingeM(h, axis, a * k, _m2));
      if (!live) return set(1);
      const c = this.worldOf(p.mid, _v);
      this.sys.on.sound?.('trim_rattle', c.x, c.y, c.z, 0.8);
      return this.anim(p, 0.5, (k) => set(swing(k)));
    }
    this.throwOff(p, live, dx, dy, dz, vigour, r, delay);
  }

  // A part comes away: thrown clear of the wreck, to bounce and lie on the ground beside it. Where it lands is
  // worked out here and now, so it is the same for everyone; live, it is then watched getting there.
  throwOff(p, live, dx, dy, dz, vigour, r, delay = 0) {
    if (p.state >= 3) return;
    this.settle(p);
    p.state = 3;
    const world = this.sys.world;
    const isles = p.isles.filter((s) => !s.gone);
    if (!isles.length) return;
    // as it stands now (askew, or open on its hinge)
    const pre = isles[0].op ? isles[0].op.clone() : new THREE.Matrix4();
    const c0 = this.worldOf(p.mid, new THREE.Vector3()).applyMatrix4(pre); // (its middle, where it stands)
    const ext = [p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]];
    const thin = ext[0] <= ext[1] && ext[0] <= ext[2] ? 0 : ext[1] <= ext[2] ? 1 : 2;
    // lying flat: its thinnest way up, turned any way round
    const qRest = new THREE.Quaternion().setFromAxisAngle(Y, this.prop.ry + (r() - 0.5) * 2.4);
    if (thin === 0) qRest.multiply(_q.setFromAxisAngle(Z, (r() < 0.5 ? -1 : 1) * Math.PI / 2));
    else if (thin === 2) qRest.multiply(_q.setFromAxisAngle(X, (r() < 0.5 ? -1 : 1) * Math.PI / 2));
    const q0 = new THREE.Quaternion().setFromRotationMatrix(pre).multiply(_q.setFromAxisAngle(Y, this.prop.ry));
    const back = new THREE.Matrix4().makeRotationFromQuaternion(_q.copy(q0).invert());
    const lie = ext[thin] / 2 + 0.01;
    // out from the middle of the wreck, and on the way the blow went
    let ox = c0.x - this.prop.x, oz = c0.z - this.prop.z;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol;
    oz /= ol;
    const v = new THREE.Vector3((ox * (1.3 + r() * 0.9) + dx * 1.6) * (0.5 + vigour), 1.4 + 1.8 * vigour * r(), (oz * (1.3 + r() * 0.9) + dz * 1.6) * (0.5 + vigour));
    // (the ground under the whole of it as it will lie, not only its middle: a bonnet on a slope rests on the high
    // side, it does not sink into it)
    const flatR = Math.hypot(...[ext[0], ext[1], ext[2]].filter((_, i) => i !== thin)) * 0.35;
    // (the ground: the terrain, or what is laid on it there - a forecourt's slab, a platform a step high. Only
    // what the world was built with: something a survivor nailed up is not where everybody's copy has it)
    const near = world.staticGrid.query(c0.x, c0.z, 9, []).filter((col) => !(col.flags & (COL.NOBLOCK | COL.TREE)));
    const ground = (x, z, y) => {
      let h = world.floorAt ? world.floorAt(x, z, y + 0.3) : world.heightAt(x, z);
      const base = h;
      for (const col of near) if (col.y1 > h && col.y1 <= base + 0.45 && col.tag !== this.prop && footprintContains(col, x, z, 0)) h = col.y1;
      return h;
    };
    const floor = (x, z, y) => Math.max(ground(x, z, y), ground(x + flatR, z, y), ground(x - flatR, z, y), ground(x, z + flatR, y), ground(x, z - flatR, y)) + lie;
    const path = [c0.x, c0.y, c0.z];
    const pos = c0.clone();
    let bounces = 0, land = -1;
    for (let i = 0; i < 300; i++) {
      v.y -= 13 * SIM_DT;
      pos.addScaledVector(v, SIM_DT);
      const g = floor(pos.x, pos.z, pos.y);
      let stop = false;
      if (pos.y <= g) {
        pos.y = g;
        if (land < 0) land = i;
        if (v.y < -1.6 && bounces < 2) {
          bounces++;
          v.y *= -0.34;
          v.x *= 0.55;
          v.z *= 0.55;
        } else {
          v.y = 0;
          v.x *= 0.78;
          v.z *= 0.78;
          stop = Math.hypot(v.x, v.z) < 0.12;
        }
      }
      path.push(pos.x, pos.y, pos.z);
      if (stop) break;
    }
    // not inside anything: its own wreck, a wall, the next car. Back along the way it came until it is clear
    const end = pos.clone();
    const flat = [ext[0], ext[1], ext[2]].filter((_, i) => i !== thin);
    const rad = Math.min(1.3, Math.hypot(flat[0], flat[1]) / 2); // (how far it reaches as it lies)
    // in its own wreck (all of it clear of the wreck's box), or in anything else (its middle in a wall, a crate, the next car)
    const inOwn = (x, z) => near.some((col) => col.tag === this.prop && footprintContains(col, x, z, rad + 0.06));
    const inOther = (x, z, y) => near.some((col) => col.tag !== this.prop && col.y1 > y + 0.02 && col.y0 < y + 0.3 && footprintContains(col, x, z, 0.12));
    // (the nearest place out from the wreck where it is clear of the wreck: there, at the worst)
    const safe = new THREE.Vector3(c0.x, 0, c0.z);
    for (let k = 0; k < 60 && inOwn(safe.x, safe.z); k++) {
      safe.x += ox * 0.12;
      safe.z += oz * 0.12;
    }
    for (let k = 0; k < 60 && inOwn(end.x, end.z); k++) {
      end.x += ox * 0.12;
      end.z += oz * 0.12;
    }
    const far = end.clone();
    for (let k = 1; k <= 6 && inOther(end.x, end.z, floor(end.x, end.z, end.y)); k++) {
      end.x = far.x + (safe.x - far.x) * (k / 6);
      end.z = far.z + (safe.z - far.z) * (k / 6);
    }
    end.y = floor(end.x, end.z, end.y);
    const steps = path.length / 3 - 1;
    const fix = new THREE.Vector3().subVectors(end, pos);
    const axis = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    const rate = (5 + r() * 7) * (0.5 + vigour);
    const landAt = land < 0 ? steps : land;
    const at = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4();
    const set = (t) => {
      // t: steps along the way
      const i = Math.min(steps - 1, Math.max(0, Math.floor(t))), f = Math.min(1, Math.max(0, t - i));
      const k = steps > 0 ? Math.min(1, t / steps) : 1;
      at.set(path[i * 3] + (path[i * 3 + 3] - path[i * 3]) * f, path[i * 3 + 1] + (path[i * 3 + 4] - path[i * 3 + 1]) * f, path[i * 3 + 2] + (path[i * 3 + 5] - path[i * 3 + 2]) * f);
      at.addScaledVector(fix, ease(k));
      q.setFromAxisAngle(axis, rate * Math.min(t, landAt) * SIM_DT).multiply(q0);
      if (t > landAt) q.slerp(qRest, ease((t - landAt) / Math.max(1, steps - landAt)));
      // about its own middle: out of the wreck's frame, turned, put where it is
      m.compose(at, q, _one).multiply(back).multiply(_m2.makeTranslation(-c0.x, -c0.y, -c0.z)).multiply(pre);
      for (const s of isles) {
        (s.op ||= new THREE.Matrix4()).copy(m);
        this.place(s);
      }
    };
    for (const s of isles) {
      // (off the springs: it lies on the ground now)
      const G = this.grp[s.piece];
      for (const vv of s.verts) G[vv] = 1;
      s.ground = true;
    }
    this.sys.marks?.pool.removeNear?.(this.prop, c0.x, c0.y, c0.z, Math.min(0.5, p.size * 0.5), true);
    if (!live) return set(steps);
    const sound = p.size > 1 ? 'part_drop_big' : 'part_drop';
    let heard = false;
    this.anim(p, steps * SIM_DT + delay, (k, t, probe) => {
      const st = Math.max(0, t - delay) / SIM_DT;
      set(Math.min(steps, st));
      if (!heard && !probe && st >= landAt) {
        heard = true;
        this.sys.on.sound?.(sound, at.x, at.y, at.z, 1);
        this.sys.on.puff?.(at.x, at.y, at.z);
      }
    });
    if (delay <= 0) this.sys.on.sound?.('trim_rattle', c0.x, c0.y, c0.z, 0.7);
  }

  // part: what it moves. A part moves one way at a time: whatever it was still doing is finished first (settle),
  // so that what is seen ends where a client that was not watching puts it
  anim(part, dur, step, done) {
    this.anims.push({ t: 0, dur, step, done, part });
    this.sys.active.add(this);
  }
  settle(part) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      if (a.part !== part) continue;
      this.anims.splice(i, 1);
      a.step(1, a.dur);
      a.done?.();
    }
  }

  // nothing left to take: every part that is still on comes off, the glass is out, it is down on its rims
  pickClean(live) {
    if (this.clean) return;
    this.clean = true;
    const r = seeded(this.prop.seed * 131 + 7);
    let k = 0;
    for (const p of this.parts) {
      if (this.spent(p)) continue;
      if (p.kind === 'wheel') this.deflate(p, live);
      else if (p.kind === 'pane' || p.kind === 'lamp') this.breakGlass(p, 2, live, 0, 0, 0);
      else if (p.kind === 'door') {
        if (p.state < 2) {
          p.dir ||= 1;
          p.state = 2;
          this.swingTo(p, p.dir * p.stops[1], live);
        }
      } else this.strip(p, live, 0, 0, 0, r, 0.15 + 0.12 * k++);
    }
    // its paint has had the day: duller, rustier
    for (let pi = 0; pi < this.pieces.length; pi++) {
      const piece = this.pieces[pi];
      if (!piece.col) continue;
      const h = this.handles?.[pi];
      for (const nm of piece.names) {
        if (!PAINTED.has(nm.name)) continue;
        for (let o = nm.first * 3; o < (nm.first + nm.count) * 3; o += 3) {
          piece.col[o] = piece.col[o] * 0.72 + 0.05;
          piece.col[o + 1] *= 0.62;
          piece.col[o + 2] *= 0.54;
        }
      }
      if (h?.slot.arrays.col) {
        h.slot.arrays.col.set(piece.col, h.run.first * 3);
        h.slot.sent(h.run, 'col');
      }
    }
  }

  setLeft(left, live) {
    this.left = left;
    if (left <= 0) this.pickClean(live);
  }

  // where its lamps are, front and back (the world's): what blinks when its alarm goes
  lamps() {
    if (this._lamps) return this._lamps;
    const out = [];
    for (const s of this.isles) if ((s.name === 'taillight' || (GLASS_MATS.has(s.name) && s.size < 0.35)) && !s.ground) out.push(this.worldOf(s.mid, new THREE.Vector3()));
    if (!out.length) for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(this.worldOf([sx * this.half[0] * 0.8, this.half[1] * 0.45, sz * this.half[2]], new THREE.Vector3()));
    return (this._lamps = out);
  }
}

/**
 * How big a mark a model has room for at p (normal n): the half-size, of `half` or less, at which the four points
 * round p still lie on the same face - a dent's mark must not hang off the edge of a pillar or float over a wheel
 * arch. ray(ox, oy, oz, dx, dy, dz, maxT, out): the model's. 0: not even a third of it fits.
 */
const _probe = { t: -1, piece: 0, vert: 0, name: '', nx: 0, ny: 0, nz: 0 };
export function roomAt(ray, px, py, pz, nx, ny, nz, half) {
  let ax = -nz, ay = 0, az = nx;
  let l = Math.hypot(ax, az);
  if (l < 0.3) {
    ax = 1;
    az = 0;
    l = 1;
  }
  ax /= l;
  az /= l;
  const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
  for (const k of [1, 0.7, 0.45, 0.3]) {
    const s = half * k * 0.85;
    let ok = true;
    for (let i = 0; i < 4 && ok; i++) {
      const u = i < 2 ? (i ? s : -s) : 0, v = i < 2 ? 0 : i === 2 ? s : -s;
      ray(px + nx * 0.12 + ax * u + bx * v, py + ny * 0.12 + ay * u + by * v, pz + nz * 0.12 + az * u + bz * v, -nx, -ny, -nz, 0.3, _probe);
      ok = _probe.t >= 0 && Math.abs(_probe.t - 0.12) < 0.06 && _probe.nx * nx + _probe.ny * ny + _probe.nz * nz > 0.7; // (a panel already bent is still a panel)
    }
    if (ok) return half * k;
  }
  return 0;
}

// a stroke's mark: its long side the way the weapon was drawn across the surface - across the swing's line, a
// little up or down (no two alike)
const _t = [0, 0, 0];
export function strokeCorners(x, y, z, nx, ny, nz, w, h, dx, dy, dz, r) {
  // to the attacker's right (the blow's direction across the horizon), tilted
  let rx = -dz, rz = dx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const a = (r - 0.5) * 1.5;
  _t[0] = rx * Math.cos(a);
  _t[1] = Math.sin(a);
  _t[2] = rz * Math.cos(a);
  return markCorners(x, y, z, nx, ny, nz, w, h, _t[0], _t[1], _t[2]);
}

// ---------------------------------------------------------------- all of them
export class Wrecks {
  // on: { sound(name, x, y, z, vol), shatter(corners, n..., d..., count), puff(x, y, z), scrap(...), flash(x, y, z, k) }
  constructor(scene, on = {}) {
    this.scene = scene;
    this.on = on;
    this.batch = new LiftBatch(scene);
    this.world = null;
    this.staticWorld = null;
    this.marks = null;
    this.time = 0;
    this.live = new Map(); // prop -> Lifted (a Wreck, or a light prop while it rocks)
    this.records = new Map(); // wreck collider -> { left, hits, prop }: what the server has said of it
    this.pending = []; // records whose wreck is not built yet (too far off to matter)
    this.active = new Set();
    this.alarms = new Map(); // prop -> { until, blink, chirp }
    this.cache = []; // the last few props a ray was cast at: [prop, pieces]
    this.scanT = 0;
    this.pried = new Set(); // the cars whose boot stands open (Wrecks.pry)
  }
  setWorld(world, staticWorld, marks) {
    this.clear();
    this.world = world;
    this.staticWorld = staticWorld;
    this.marks = marks;
  }
  clear() {
    for (const l of this.live.values()) {
      l.drop();
      this.marks?.pool.removeOwner(l.prop);
    }
    this.live.clear();
    this.records.clear();
    this.pending.length = 0;
    this.active.clear();
    this.alarms.clear();
    this.cache.length = 0;
    this.pried.clear();
  }
  // dawn (EVT.REGROWN): every wreck is whole again, as the trees stand again
  reset() {
    const world = this.world, sw = this.staticWorld, marks = this.marks;
    this.clear();
    this.world = world;
    this.staticWorld = sw;
    this.marks = marks;
  }
  setShadows(on) {
    this.batch.setShadows(on);
  }

  get(prop) {
    return this.live.get(prop) || null;
  }
  wreck(prop) {
    let w = this.live.get(prop);
    if (w && !w.wreck) {
      // (it was rocking as a light prop would: it is a wreck now)
      w.drop();
      this.active.delete(w);
      w = null;
    }
    if (!w) {
      if (!this.staticWorld.lifts.has(prop)) return null;
      w = new Wreck(this, prop);
      this.live.set(prop, w);
      w.lift();
      if (this.pried.has(prop)) w.pry(true, false);
    }
    return w;
  }
  // A car's boot has been forced (its container is searched), or is shut again (the container was refilled). The
  // car leaves the static world for it, as one that is hit does. live: it is happening now, in front of us.
  // Returns whether there was a lid to move.
  pry(prop, on, live = false) {
    if (this.pried.has(prop) === on && (!on || this.live.get(prop)?.wreck)) return false;
    const w = on ? this.wreck(prop) : this.live.get(prop);
    if (on) this.pried.add(prop);
    else this.pried.delete(prop);
    if (!w || !w.wreck) return false;
    w.pry(on, live);
    if (live) this.active.add(w);
    else w.flush();
    return !!w.bootLid();
  }
  // whether a car's boot is shut by its lid still: false once it is forced, lifted by a blow or off
  bootShut(prop) {
    const w = this.live.get(prop);
    if (!w || !w.wreck) return !this.pried.has(prop);
    const p = w.bootLid();
    return !!p && p.state === 0 && !w.pried;
  }

  // EVT.WRECK: what is left in a wreck and the blows on its record. replay: `hits` is the whole record (and nothing
  // is seen or heard happening); otherwise they are new ones, on top of what is known
  record(col, left, hits, replay, eye) {
    const prop = wreckOf(col);
    if (!prop || !this.staticWorld?.lifts.has(prop)) return;
    let rec = this.records.get(col);
    if (!rec) this.records.set(col, (rec = { col, prop, left: WRECK_SALVAGE, hits: [], built: 0 }));
    if (replay) {
      rec.hits = hits.slice();
      rec.built = 0;
      const old = this.live.get(prop);
      if (old) {
        // (told all over again: from the beginning)
        old.drop();
        this.marks?.pool.removeOwner(prop);
        this.live.delete(prop);
        this.active.delete(old);
      }
    } else rec.hits.push(...hits);
    rec.left = left;
    const near = !eye || Math.hypot(eye.x - prop.x, eye.z - prop.z) < BUILD_NEAR;
    if (near) this.build(rec, !replay);
    else if (!this.pending.includes(rec)) this.pending.push(rec);
  }
  build(rec, live) {
    const w = this.wreck(rec.prop);
    if (!w) return;
    // (a wreck of several colliders - a lorry and its trailer - is one wreck here: every collider's blows land on it)
    while (rec.built < rec.hits.length) w.apply(rec.hits[rec.built++], live);
    let left = 0, n = 0;
    for (const r of this.records.values()) {
      if (r.prop !== rec.prop) continue;
      left += r.left;
      n++;
    }
    w.setLeft(n ? left / n < 0.5 ? 0 : Math.ceil(left / n) : rec.left, live);
    if (live) this.active.add(w);
    else {
      w.finish();
      w.flush();
    }
  }

  // EVT.WRECK_ALARM: say 0 quiet, 1 chirp, 2 ringing for secs
  alarm(col, say, secs) {
    const prop = wreckOf(col);
    if (!prop) return;
    if (say === 0) return void this.alarms.delete(prop);
    this.alarms.set(prop, { until: say === 2 ? this.time + secs : this.time + 0.75, ring: say === 2, blink: 0, whoop: 0, n: 0 });
    if (say === 1) this.on.sound?.('car_chirp', prop.x, prop.y + 0.9, prop.z, 1);
  }
  ringing(prop) {
    return !!this.alarms.get(prop)?.ring;
  }
  // where a wreck's lamps are (a wreck that was never hit has no parts sorted out: the corners of its box)
  lampsOf(prop) {
    const w = this.live.get(prop);
    if (w?.wreck) return w.lamps();
    const s = PROPS[prop.type].size;
    const out = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(new THREE.Vector3(sx * s[0] * 0.4, s[1] * 0.45, (sz * s[2]) / 2).applyAxisAngle(Y, prop.ry).add(_v2.set(prop.x, prop.y, prop.z)));
    return out;
  }

  // A blow (not on record: any melee swing, a bullet) on a prop: it rocks. Light props are lifted for as long as
  // they move; a wreck that has never been on record rocks the same way and goes back.
  push(prop, px, py, pz, dx, dy, dz, k) {
    if (!this.staticWorld?.lifts.has(prop)) return;
    let l = this.live.get(prop);
    if (!l) {
      l = new Lifted(this, prop, !!PROPS[prop.type].salvage);
      l.heavy = !!PROPS[prop.type].salvage;
      this.live.set(prop, l);
      l.temp = true;
      l.lift();
    }
    l.quiet = 0;
    l.push(px, py, pz, dx, dy, dz, k);
  }

  /**
   * A ray (the world's) against a prop's own triangles - as it stands now if it has been lifted, otherwise the
   * model's. out: { t (-1: it went through), name (the material struck), nx, ny, nz }.
   */
  ray(prop, ox, oy, oz, dx, dy, dz, maxT, out) {
    const l = this.live.get(prop);
    if (l) return l.ray(ox, oy, oz, dx, dy, dz, maxT, out);
    let c = this.cache.find((e) => e[0] === prop);
    if (!c) {
      const pieces = this.staticWorld.pieces(prop);
      if (!pieces) {
        out.t = -2; // (no model to ask: the caller goes by the collider)
        return out;
      }
      c = [prop, pieces];
      this.cache.push(c);
      if (this.cache.length > 6) this.cache.shift();
    }
    return rayPieces(c[1], (pi) => c[1][pi].pos, ox, oy, oz, dx, dy, dz, maxT, out);
  }

  update(dt, time, eye) {
    this.time = time;
    for (const l of this.active) {
      const busy = l.update(dt);
      if (busy) continue;
      this.active.delete(l);
      if (l.temp) {
        // a light prop at rest goes back into the static world
        l.drop();
        this.live.delete(l.prop);
      }
    }
    // alarms: the lamps blink, the horn sounds
    for (const [prop, a] of this.alarms) {
      if (time >= a.until) {
        this.alarms.delete(prop);
        continue;
      }
      if (time >= a.blink) {
        a.blink = time + (a.ring ? 0.42 : 0.28);
        if (a.n++ % 2 === 0) for (const p of this.lampsOf(prop)) this.on.flash?.(p.x, p.y, p.z, a.ring ? 1 : 0.6);
      }
      if (a.ring && time >= a.whoop) {
        a.whoop = time + 0.84;
        this.on.sound?.('car_alarm', prop.x, prop.y + 0.9, prop.z, 1);
      }
    }
    // wrecks on record that were too far off to build: one at a time as the eye comes near
    if (this.pending.length && (this.scanT -= dt) <= 0 && eye) {
      this.scanT = 0.25;
      const i = this.pending.findIndex((r) => Math.hypot(eye.x - r.prop.x, eye.z - r.prop.z) < BUILD_NEAR);
      if (i >= 0) this.build(this.pending.splice(i, 1)[0], false);
    }
  }

  dispose() {
    this.clear();
    this.batch.dispose();
  }
}
