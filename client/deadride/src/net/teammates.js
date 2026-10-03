// Teammates as DEAD RIDE's own people: the zombie pipeline's body, 54-bone rig, cloth and skin shading, with the survivor
// outfits (game/zombies/variants/survivors.js), walked as network puppets (like a guest's copy of the host's zombies: planted
// feet, procedural gait) by a second, silent ZombieManager. They face where the player looks (strafe), hold the gun they carry
// (Survive the Night's world weapon models) in both hands by arm IK, crawl when downed, and ride the vehicle with it - their
// planted feet are carried with the moving floor. coop.js uses one through the same small interface as a Survive the Night
// survivor (object, setWeapon, fire, update, dispose), so it can fall back to those while the outfits are not built yet.
import * as THREE from 'three';
import { ZombieManager } from '../game/zombies/index.js';
import { REGISTRY, getVariantAssets } from '../game/zombies/factory.js';
import { SURVIVOR_VARIANTS } from '../game/zombies/variants/survivors.js';
import { BI } from '../game/zombies/rig.js';
import { createWorldWeapon } from '../../../render/models/weapons.js';

const V = THREE.Vector3;
const _d = new V(), _r = new V(), _u = new V(0, 1, 0), _g = new V(), _t = new V(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const FOOT_VECS = ['recFrom', 'heel', 'liftAnkle', 'tgtHeel', 'ankle', 'plantBall', 'plantHeel', 'corrFrom'];

export class Teammates {
  constructor({ gfx, world, fx, audio }) {
    this.gfx = gfx;
    this.mgr = new ZombieManager({ gfx, world, fx, audio, pool: 6, silent: true });
    this.mgr.puppet = true;
    this.mgr.mapId = 'survivors';
    this.mgr.group.name = 'teammates';
    this.ready = false;
    this.mates = new Set();
  }

  // build the four outfits (on the main thread, one per tick: a few hundred ms each; coop.js shows survivors until then)
  async prepare() {
    for (const d of SURVIVOR_VARIANTS) {
      getVariantAssets(REGISTRY.variants.get(d.id));
      await new Promise((r) => setTimeout(r, 0));
    }
    this.ready = true;
  }

  // a teammate in team slot `slot` (its outfit), null while the outfits are not built
  make(slot, seed) {
    if (!this.ready) return null;
    const def = SURVIVOR_VARIANTS[((slot % 4) + 4) % 4];
    const z = this.mgr.spawn(def.id, new V(0, -500, 0), 0, { force: true, kind: 'walk', speedClass: 'run', speed: 0, seed, look: 0, hp: 100 });
    if (!z) return null;
    const m = new Mate(this, z);
    this.mates.add(m);
    return m;
  }

  // after everyone's update() this frame: animate and skin them all (after the vehicle moved: they ride with it)
  update(dt, time) {
    if (this.mates.size) this.mgr.update(dt, time, null);
  }

  dispose() {
    for (const m of this.mates) m.dispose();
    this.mgr.clear();
    this.gfx.scene.remove(this.mgr.group);
  }
}

class Mate {
  constructor(team, z) {
    this.team = team;
    this.z = z;
    z.free = true; // (net/coop: their machine collided them; zombies/index.js _locomote)
    z.net = { x: 0, y: -500, z: 0, vx: 0, vz: 0, yaw: 0, t: performance.now() };
    const A = z.anim;
    A.strafe = true;
    A.arm.L.mode = A.arm.R.mode = 'swing';
    A.jawOpen = 0;
    this.hands = { L: new V(), R: new V() };
    this.object = new THREE.Object3D(); // (what coop.js positions, turns and shows; the body follows it)
    this.gun = null;
    this.item = -1;
    this.kick = 0;
    this.last = new V();
    this.vel = new V();
    this.fresh = true;
    this.prevFrame = null;
  }

  setWeapon(item) {
    if (item === this.item) return;
    this.item = item;
    if (this.gun) this.team.gfx.scene.remove(this.gun);
    this.gun = createWorldWeapon(item);
    this.leftHand = this.gun.userData.leftHand || null;
    this.gun.traverse((o) => {
      o.castShadow = true;
    });
    this.team.gfx.scene.add(this.gun);
  }

  fire() {
    this.kick = 1;
  }

  // s: { speed, sprint, crouch, pitch, dead, downed, riding, vehicle } (coop.updateRemotes)
  update(dt, s) {
    const z = this.z;
    const A = z.anim;
    const o = this.object;
    const shown = o.visible && !s.dead;
    z.body.mesh.visible = shown;
    if (this.gun) this.gun.visible = shown && !s.downed;
    if (!shown) {
      this.fresh = true;
      return;
    }
    const p = o.position;
    // riding: the vehicle moved since last frame - carry the body and its planted feet with the floor
    const v = s.riding ? s.vehicle : null;
    if (v) {
      v.frame.updateWorldMatrix(true, false);
      if (this.prevFrame && !this.fresh) {
        _m.copy(this.prevFrame).invert().premultiply(v.frame.matrixWorld);
        carry(A, _m);
        this.last.applyMatrix4(_m);
      }
      (this.prevFrame ||= new THREE.Matrix4()).copy(v.frame.matrixWorld);
    } else this.prevFrame = null;
    z.flat = !!v;
    // velocity over the ground (or the floor), smoothed
    if (this.fresh) {
      A.reset(p, o.rotation.y, z.pose.scale);
      this.last.copy(p);
      this.vel.set(0, 0, 0);
      this.fresh = false;
    }
    if (dt > 0) {
      _t.subVectors(p, this.last).divideScalar(dt);
      this.vel.lerp(_t, Math.min(1, dt * 10));
    }
    this.last.copy(p);
    const n = z.net;
    n.x = p.x;
    n.y = p.y;
    n.z = p.z;
    n.vx = s.downed ? 0 : this.vel.x;
    n.vz = s.downed ? 0 : this.vel.z;
    n.yaw = o.rotation.y;
    n.t = performance.now();
    A.mode = s.downed ? 'crawl' : 'loco';
    A.speedClass = s.sprint ? 'sprint' : 'run';
    A.crouch = s.crouch ? 0.22 : -0.035; // (upright: the run gait's own pelvis drop is taken back; crouching sinks the hips)
    // the gun, in both hands: from the shoulder along where they look (low and across the body when sprinting)
    this.kick = Math.max(0, this.kick - dt * 12);
    if (this.gun && !s.downed) {
      const P = z.pose;
      const sc = z.pose.scale;
      const yaw = o.rotation.y;
      const pistol = !this.leftHand;
      const pitch = s.sprint ? -0.75 : Math.max(-1.1, Math.min(1.1, s.pitch));
      const gy = s.sprint ? yaw + 0.55 : yaw;
      _d.set(-Math.sin(gy) * Math.cos(pitch), Math.sin(pitch), -Math.cos(gy) * Math.cos(pitch));
      _r.set(Math.cos(yaw), 0, -Math.sin(yaw));
      _g.copy(P.P[BI['upperarm.R']]);
      if (_g.y < -100) _g.set(p.x, p.y + 1.4 * sc, p.z); // (no pose yet)
      _g.addScaledVector(_d, (pistol ? 0.44 : 0.3) * sc - this.kick * 0.05).addScaledVector(_u, (pistol ? 0.0 : -0.1) * sc).addScaledVector(_r, (pistol ? -0.16 : -0.05) * sc);
      this.gun.position.copy(_g);
      _e.set(pitch + this.kick * 0.12, gy, 0);
      this.gun.quaternion.setFromEuler(_e);
      this.gun.updateMatrixWorld(true);
      // wrists: just behind and under the grip; the support hand under the fore-end (or cupping the pistol grip)
      this.hands.R.set(0, -0.035, 0.075).applyMatrix4(this.gun.matrixWorld);
      if (this.leftHand) this.hands.L.copy(this.leftHand).add(_t.set(-0.01, -0.04, 0.05)).applyMatrix4(this.gun.matrixWorld);
      else this.hands.L.set(-0.035, -0.06, 0.08).applyMatrix4(this.gun.matrixWorld);
      A.handPlant = this.hands;
    } else A.handPlant = null;
  }

  dispose() {
    if (this.gun) this.team.gfx.scene.remove(this.gun);
    this.team.mgr._release(this.z);
    this.team.mates.delete(this);
  }
}

// move an animator (its root, planted feet and every remembered foot point) by a rigid transform: standing on a moving floor
function carry(A, M) {
  const y0 = A.pos.y;
  A.pos.applyMatrix4(M);
  const dy = A.pos.y - y0;
  _q.setFromRotationMatrix(M);
  _t.set(0, 0, -1).applyQuaternion(_q);
  const dyaw = Math.atan2(-_t.x, -_t.z);
  A.yaw += dyaw;
  for (const f of A.feet) {
    for (const k of FOOT_VECS) if (f[k]) f[k].applyMatrix4(M);
    f.yaw += dyaw;
    f.tgtYaw += dyaw;
    if (f.corrYaw0 !== undefined) f.corrYaw0 += dyaw;
    f.groundY += dy;
  }
}
