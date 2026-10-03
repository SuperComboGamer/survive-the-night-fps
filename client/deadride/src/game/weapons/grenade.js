// Thrown frag grenades: world-space projectiles (layer 0) with gravity, substepped swept collisions against world.raycast,
// ground via world.groundAt, restitution/friction bounces with clonk sounds, rolling, the spoon flying off, fuse -> combat.explode.
import * as THREE from 'three';
import { modelData, GunRig } from './rig.js';
import { grenade as GRENADE_MODEL } from './models/props.js';
import { GRENADE } from './specs.js';

const HIT = { t: 0, nx: 0, ny: 0, nz: 0, surface: 'concrete' }, G = { y: 0, surface: 'concrete', col: null };
const _v = new THREE.Vector3(), _ax = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export class Grenades {
  constructor(scene, mats, { fx, audio, combat, world }) {
    this.fx = fx; this.audio = audio; this.combat = combat; this.world = world; this.list = [];
    const data = modelData(GRENADE_MODEL, mats);
    for (let i = 0; i < GRENADE.max; i++) {
      const rig = new GunRig(data, mats, { layer: 0, skinned: true, shadow: true }); rig.group.visible = false; scene.add(rig.group);
      for (const m of rig.meshes) { m.frustumCulled = false; }
      this.list.push({ rig, pos: new THREE.Vector3(), vel: new THREE.Vector3(), w: new THREE.Vector3(), q: new THREE.Quaternion(), fuse: 0, live: false, spoonT: 0, spoonV: new THREE.Vector3(), rest: 0, lastSnd: 0 });
    }
  }
  throw(pos, vel, fuse = GRENADE.fuse) {
    const g = this.list.find((x) => !x.live) || this.list[0]; g.live = true; g.pos.copy(pos); g.vel.copy(vel); g.fuse = fuse; g.q.set(0, 0, 0, 1); g.w.set(8 + Math.random() * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6); g.spoonT = 0; g.rest = 0;
    g.spoonV.set((Math.random() - 0.5) * 2, 2.5, 1.5); g.rig.reset(); g.rig.scale('pin', 0.0001); g.rig.group.visible = true; return g;
  }
  update(dt, time) {
    const w = this.world; if (dt <= 0) return;
    for (let gi = 0; gi < this.list.length; gi++) {
      const g = this.list[gi]; if (!g.live) continue; g.fuse -= dt;
      const r = 0.032; const n = Math.max(1, Math.ceil(g.vel.length() * dt / 0.04)); const h = dt / n;
      for (let s = 0; s < n; s++) {
        g.vel.y -= 9.81 * h; const sp = g.vel.length(); if (sp < 1e-4) break;
        if (w && w.raycast(g.pos.x, g.pos.y, g.pos.z, g.vel.x / sp, g.vel.y / sp, g.vel.z / sp, sp * h + r, HIT)) {
          const t = Math.max(0, HIT.t - r); g.pos.x += g.vel.x / sp * t; g.pos.y += g.vel.y / sp * t; g.pos.z += g.vel.z / sp * t;
          const vn = g.vel.x * HIT.nx + g.vel.y * HIT.ny + g.vel.z * HIT.nz; if (vn < 0) { g.vel.x -= vn * HIT.nx; g.vel.y -= vn * HIT.ny; g.vel.z -= vn * HIT.nz; g.vel.multiplyScalar(0.72); g.vel.x -= vn * 0.34 * HIT.nx; g.vel.y -= vn * 0.34 * HIT.ny; g.vel.z -= vn * 0.34 * HIT.nz; this._bounce(g, -vn, HIT.surface, time); g.w.multiplyScalar(0.6).add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6)); }
        } else { g.pos.x += g.vel.x * h; g.pos.y += g.vel.y * h; g.pos.z += g.vel.z * h; }
        const gr = w ? w.groundAt(g.pos.x, g.pos.z, g.pos.y + 0.3, G) : null;
        if (gr && g.pos.y - r < gr.y) { g.pos.y = gr.y + r; if (g.vel.y < 0) { const vy = -g.vel.y; g.vel.y = vy > 1.2 ? vy * 0.34 : 0; g.vel.x *= 0.72; g.vel.z *= 0.72; if (vy > 0.8) this._bounce(g, vy, gr.surface, time); } g.vel.x *= 1 - 2.2 * h; g.vel.z *= 1 - 2.2 * h; // rolling resistance
          _ax.set(g.vel.z, 0, -g.vel.x); const vs = _ax.length(); if (vs > 1e-3) { g.w.copy(_ax).multiplyScalar(1 / r); } else g.w.multiplyScalar(0.9); }
      }
      const ang = g.w.length() * dt; if (ang > 1e-6) { _q.setFromAxisAngle(_ax.copy(g.w).normalize(), ang); g.q.premultiply(_q); }
      g.rig.group.position.copy(g.pos); g.rig.group.quaternion.copy(g.q);
      // spoon flies off during the first 0.6 s
      if (g.spoonT < 0.7) { g.spoonT += dt; const t = g.spoonT; g.rig.set('spoon', g.spoonV.x * t, g.spoonV.y * t - 4.9 * t * t, g.spoonV.z * t, t * 18, t * 7, 0); if (g.spoonT >= 0.7) g.rig.scale('spoon', 0.0001); }
      if (g.fuse <= 0) this._explode(g);
    }
  }
  _bounce(g, v, surface, time) { if (time - g.lastSnd < 0.06 || !this.audio?.ready) return; g.lastSnd = time; const o = this._bo || (this._bo = { pos: null, vol: 1, bus: 'sfx', minDist: 2, maxDist: 40 }); o.pos = g.pos; o.vol = Math.min(1, 0.25 + v * 0.12); this.audio.play('wpn.grenade.bounce', o); }
  _explode(g) {
    g.live = false; g.rig.group.visible = false; _v.copy(g.pos); _v.y += 0.05;
    if (this.combat?.explode) this.combat.explode(_v, GRENADE.radius, GRENADE.damage, { source: 'grenade' });
    else { this.fx.explosion(_v, GRENADE.radius, 1.3); this.audio?.play?.('explosion', { pos: _v, vol: 1 }); }
  }
  get active() { let n = 0; for (const g of this.list) if (g.live) n++; return n; }
}
