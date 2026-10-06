// What flies off a blow: the sparks, the dust and the bits (shared/surfaces.js bitsFor). The sparks and the dust are
// particles of the pools Effects already draws; the bits - splinters, grit, flakes of paint, clods, shards, the scrap
// a wreck gives up - are small solid pieces of one instanced mesh (Chips) that fall, bounce, lie a while and go.
// Nothing here runs while nothing is in the air: Chips.update returns at once, and its mesh is not drawn.
import * as THREE from 'three';
import { TEX, LIT } from './effects.js';
import { SURF, BLOW, bitsFor } from '../../shared/surfaces.js';

const CHIP_MAX = 220;
const GRAV = 16;
// [length, thickness, width (m), r, g, b (sRGB), spin]
const KINDS = {
  splinter: [0.09, 0.012, 0.02, 0.82, 0.7, 0.48, 18],
  grit: [0.035, 0.022, 0.03, 0.62, 0.59, 0.54, 14],
  flake: [0.04, 0.005, 0.032, 0.5, 0.3, 0.2, 22],
  clod: [0.08, 0.045, 0.065, 0.22, 0.15, 0.09, 8],
  shard: [0.07, 0.005, 0.045, 0.72, 0.84, 0.86, 16],
  thread: [0.06, 0.004, 0.008, 0.7, 0.68, 0.6, 10],
  scrap: [0.085, 0.02, 0.06, 0.46, 0.44, 0.42, 14],
  nail: [0.06, 0.006, 0.006, 0.62, 0.62, 0.64, 24],
};

class Chips {
  constructor(scene, world) {
    this.world = world;
    // a chip: a flat little wedge, so that it catches the light as it turns
    const g = new THREE.BufferGeometry();
    const p = [-0.5, -0.5, -0.5, 0.5, -0.5, -0.35, 0.35, -0.5, 0.5, -0.5, -0.5, 0.4, -0.3, 0.5, -0.3, 0.4, 0.5, -0.2, 0.2, 0.5, 0.35, -0.4, 0.5, 0.25];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    const flat = g.toNonIndexed();
    flat.computeVertexNormals();
    g.dispose();
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.material.name = 'chips';
    const m = (this.mesh = new THREE.InstancedMesh(flat, this.material, CHIP_MAX));
    m.name = 'chips';
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = true;
    m.visible = false;
    this._m = new THREE.Matrix4().makeScale(0, 0, 0);
    this._c = new THREE.Color();
    for (let i = 0; i < CHIP_MAX; i++) {
      m.setMatrixAt(i, this._m);
      m.setColorAt(i, this._c);
    }
    scene.add(m);
    this.scene = scene;
    const n = CHIP_MAX;
    this.state = new Uint8Array(n); // 0 free, 1 in the air, 2 lying, 3 flying to someone's hand
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 3);
    this.size = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.next = 0;
    this.busy = 0; // how many are not free
    this.home = null; // where the ones flying to a hand are going ({x, y, z}, read as they fly)
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  // one bit of `kind` at x,y,z thrown with v. k: its size next to the kind's own. tint: darker or lighter (x)
  // home: it flies on into the hand of whoever earned it (Chips.home) instead of landing
  add(kind, x, y, z, vx, vy, vz, k = 1, tint = 1, home = false, color = null) {
    const d = KINDS[kind];
    if (!d) return;
    const i = this.next;
    this.next = (i + 1) % CHIP_MAX;
    if (!this.state[i]) this.busy++;
    const o = i * 3;
    this.state[i] = home ? 3 : 1;
    this.pos.set([x, y, z], o);
    this.vel.set([vx, vy, vz], o);
    for (let c = 0; c < 3; c++) {
      this.rot[o + c] = Math.random() * 6.283;
      this.spin[o + c] = (Math.random() - 0.5) * 2 * d[6];
    }
    const s = k * (0.7 + Math.random() * 0.6);
    this.size.set([d[0] * s, d[1] * s, d[2] * s], o);
    this.age[i] = 0;
    this.life[i] = 9 + Math.random() * 6;
    if (color) this._c.setRGB(color[0] * tint, color[1] * tint, color[2] * tint);
    else this._c.setRGB(d[3] * tint, d[4] * tint, d[5] * tint, THREE.SRGBColorSpace);
    this.mesh.setColorAt(i, this._c);
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }

  update(dt) {
    if (!this.busy) return;
    const P = this.pos, V = this.vel, R = this.rot, W = this.spin, S = this.size;
    const world = this.world;
    let dirty = false;
    for (let i = 0; i < CHIP_MAX; i++) {
      const st = this.state[i];
      if (!st) continue;
      const o = i * 3;
      const age = (this.age[i] += dt);
      let k = 1;
      if (st === 3) {
        // to the hand: thrown clear of the wreck first, then drawn in faster and faster
        const h = this.home;
        const dx = h ? h.x - P[o] : 0, dy = h ? h.y - 0.35 - P[o + 1] : 0, dz = h ? h.z - P[o + 2] : 0;
        const d = Math.hypot(dx, dy, dz);
        if (!h || d < 0.35 || age > 1.6) {
          this.state[i] = 0;
          this.busy--;
          k = 0;
        } else {
          const pull = Math.min(1, Math.max(0, (age - 0.16) * 4));
          const sp = 3 + age * 16;
          V[o] += ((dx / d) * sp - V[o]) * pull * Math.min(1, dt * 14);
          V[o + 1] += ((dy / d) * sp - V[o + 1]) * pull * Math.min(1, dt * 14) - GRAV * dt * (1 - pull);
          V[o + 2] += ((dz / d) * sp - V[o + 2]) * pull * Math.min(1, dt * 14);
          P[o] += V[o] * dt;
          P[o + 1] += V[o + 1] * dt;
          P[o + 2] += V[o + 2] * dt;
          for (let c = 0; c < 3; c++) R[o + c] += W[o + c] * dt;
          k = Math.min(1, d / 0.8);
        }
      } else if (st === 1) {
        V[o + 1] -= GRAV * dt;
        P[o] += V[o] * dt;
        P[o + 1] += V[o + 1] * dt;
        P[o + 2] += V[o + 2] * dt;
        for (let c = 0; c < 3; c++) R[o + c] += W[o + c] * dt;
        const gy = world.floorAt(P[o], P[o + 2], P[o + 1] + 0.3) + S[o + 1] * 0.5;
        if (P[o + 1] <= gy) {
          P[o + 1] = gy;
          if (V[o + 1] < -2.2) {
            V[o] *= 0.45;
            V[o + 1] *= -0.3;
            V[o + 2] *= 0.45;
            for (let c = 0; c < 3; c++) W[o + c] *= 0.5;
          } else {
            this.state[i] = 2;
            R[o] = 0;
            R[o + 2] = 0; // (flat on the ground)
          }
        }
      } else {
        const over = age - this.life[i];
        if (over < 0) continue; // lying still: nothing to do
        if (over >= 1) {
          this.state[i] = 0;
          this.busy--;
          k = 0;
        } else k = 1 - over;
      }
      this._q.setFromEuler(this._e.set(R[o], R[o + 1], R[o + 2], 'YXZ'));
      this._p.set(P[o], P[o + 1], P[o + 2]);
      this._s.set(S[o] * k, S[o + 1] * k, S[o + 2] * k);
      this.mesh.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
    if (!this.busy) this.mesh.visible = false;
  }

  clear() {
    this._m.makeScale(0, 0, 0);
    for (let i = 0; i < CHIP_MAX; i++) {
      if (this.state[i]) this.mesh.setMatrixAt(i, this._m);
      this.state[i] = 0;
    }
    this.busy = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = false;
  }
}

export class StrikeFx {
  constructor(effects, scene, world) {
    this.fx = effects;
    this.chips = new Chips(scene, world);
  }
  setWorld(world) {
    this.chips.world = world;
    this.chips.clear();
  }
  update(dt) {
    this.chips.update(dt);
  }

  /**
   * A blow at p on a surface with normal n, going d (unit): sparks and dust the way of the stroke and back off the
   * surface, and the bits. force 0..1. tint: the colour of what comes off a painted thing ([r, g, b] linear), if any.
   */
  strike(surf, blow, px, py, pz, nx, ny, nz, dx, dy, dz, force = 0.6, tint = null) {
    const fx = this.fx;
    const A = fx.alpha, D = fx.add;
    const r = (a, b) => a + Math.random() * (b - a);
    const b = bitsFor(surf);
    const shot = blow === BLOW.SHOT;
    // off the surface: back along its normal, and on along the stroke where that runs across it
    const dn = dx * nx + dy * ny + dz * nz;
    let tx = dx - nx * dn, ty = dy - ny * dn, tz = dz - nz * dn;
    const k = 0.5 + force;
    // the way a bit leaves: mostly the normal, a share of the stroke
    const out = (sp, spread) => {
      _o[0] = (nx * 0.9 + tx * 0.8) * sp + r(-spread, spread);
      _o[1] = (ny * 0.9 + ty * 0.8) * sp + r(-spread * 0.5, spread) + 0.6;
      _o[2] = (nz * 0.9 + tz * 0.8) * sp + r(-spread, spread);
      return _o;
    };
    const x = px + nx * 0.03, y = py + ny * 0.03, z = pz + nz * 0.03;
    if (b.sparks > 0 && blow !== BLOW.BLAST) {
      const n = Math.round((shot ? 7 : 5 + 12 * force) * b.sparks);
      for (let i = 0; i < n; i++) {
        const v = out(r(2, 6) * k, 2.4);
        D.emit(x, y, z, v[0], v[1], v[2], r(0.14, 0.42), 0.055, 0.015, 1, 0.82, 0.45, 1, 1, 0.4, 0.1, 0, 13, 0.6, TEX.SPARK);
      }
      D.emit(x, y, z, 0, 0, 0, 0.06, 0.25 + 0.5 * force, 0.1, 1, 0.8, 0.5, 0.9, 1, 0.6, 0.3, 0, 0, 0, TEX.GLOW);
    }
    if (b.dust > 0) {
      // a puff the colour of what was struck
      const c = DUST[surf];
      const n = shot ? 1 : 1 + Math.round(force * 2);
      for (let i = 0; i < n; i++) {
        const v = out(r(0.3, 1.1), 0.5);
        A.emit(x, y, z, v[0], v[1] * 0.6, v[2], r(0.7, 1.3), 0.14 + 0.2 * force, (0.5 + 0.9 * force) * b.dust, c[0], c[1], c[2], 0.42 * b.dust, c[0], c[1], c[2], 0, -0.1, 2.2, TEX.SMOKE + LIT, r(-0.6, 0.6));
      }
    }
    if (b.n && blow !== BLOW.BLAST) {
      const n = Math.max(1, Math.round(b.n * (shot ? 0.35 : 0.4 + force * 0.8)));
      for (let i = 0; i < n; i++) {
        const v = out(r(1.2, 3.6) * k, 1.6);
        const paint = tint && surf === SURF.METAL && Math.random() < 0.6;
        this.chips.add(b.bits, x, y, z, v[0], v[1] + r(0.5, 2), v[2], shot ? 0.7 : 1, r(0.7, 1.1), false, paint ? tint : null);
      }
    }
  }

  // a pane going: shards thrown out of it both ways, to fall and lie under where it was. corners: its four (12 numbers)
  shatter(corners, nx, ny, nz, dx, dy, dz, n = 26) {
    const r = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random();
      const x = (corners[0] * (1 - u) + corners[3] * u) * (1 - v) + (corners[9] * (1 - u) + corners[6] * u) * v;
      const y = (corners[1] * (1 - u) + corners[4] * u) * (1 - v) + (corners[10] * (1 - u) + corners[7] * u) * v;
      const z = (corners[2] * (1 - u) + corners[5] * u) * (1 - v) + (corners[11] * (1 - u) + corners[8] * u) * v;
      const s = r(0.4, 2.6) * (Math.random() < 0.3 ? -0.6 : 1);
      this.chips.add('shard', x, y, z, dx * s + nx * r(-0.6, 0.6) + r(-0.7, 0.7), r(-0.5, 1.6), dz * s + nz * r(-0.6, 0.6) + r(-0.7, 0.7), r(0.7, 1.7), r(0.8, 1.1));
    }
    for (let i = 0; i < 6; i++) this.fx.add.emit((corners[0] + corners[6]) / 2 + r(-0.3, 0.3), (corners[1] + corners[7]) / 2 + r(-0.2, 0.2), (corners[2] + corners[8]) / 2 + r(-0.3, 0.3), dx * r(0.5, 2), r(0, 1.5), dz * r(0.5, 2), r(0.15, 0.3), 0.05, 0.02, 0.9, 0.95, 1, 0.8, 0.8, 0.9, 1, 0, 9, 1, TEX.SPARK);
  }

  // the scrap a wreck gives up: n bits (and nails) popped off at p, away from the wreck. home: to the hand of
  // whoever earned it (the camera, { x, y, z }); otherwise they fall
  scrap(px, py, pz, nx, ny, nz, n, nails, home) {
    const r = (a, b) => a + Math.random() * (b - a);
    this.chips.home = home || this.chips.home;
    for (let i = 0; i < n + nails; i++) {
      const kind = i < n ? 'scrap' : 'nail';
      this.chips.add(kind, px + nx * 0.05, py + ny * 0.05, pz + nz * 0.05, nx * r(1.2, 2.6) + r(-1.2, 1.2), r(1.6, 3.4), nz * r(1.2, 2.6) + r(-1.2, 1.2), 1, r(0.75, 1.15), !!home);
    }
  }
}
const _o = [0, 0, 0];
// the dust each surface gives off (linear rgb): earth, wood, stone, metal (rust), glass, cloth, rubber
const DUST = [[0.2, 0.15, 0.1], [0.34, 0.27, 0.18], [0.5, 0.48, 0.44], [0.3, 0.2, 0.14], [0.6, 0.65, 0.66], [0.4, 0.38, 0.33], [0.1, 0.1, 0.1]];
