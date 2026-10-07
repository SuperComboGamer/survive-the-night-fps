// The deer on the client: what Entities (entities.js) does for an ENT.DEER record. A deer is drawn from the same
// kind of sample ring a zombie is and at the same render time, so the server, which rewinds its deer to that time
// before it judges a shot (Combat.fire), has the animal where the shooter saw it.
import * as THREE from 'three';
import { SERVER_TICK_RATE } from '../../shared/constants.js';
import { SOUND } from '../../shared/defs.js';
import { DANIM, DEER } from '../../shared/deer.js';
import { createDeer } from '../render/models/deer.js';

const TAU = Math.PI * 2;
const HOOF_RANGE = 32; // hoofbeats are heard from this far (m)
const _sph = new THREE.Sphere();

function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

// Entities.onCreate
export function createDeerView(ents, e) {
  e.vx = e.vy = e.vz = 0; // rendered velocity (m/s) and the fading correction offset, as for a zombie
  e.ex = e.ey = e.ez = 0;
  e.sx = e.rx;
  e.sy = e.ry;
  e.sz = e.rz;
  e.falls = -1;
  e.dead = e.q[4] === DANIM.DEAD;
  const v = createDeer(e.variant, e.id);
  e.view = v;
  if (e.dead) v.settle(); // it died before it came into view: it lies there, it does not fall again
  ents.scene.add(v.object);
}

// Entities.onUpdate, when the animation state changed
export function deerAnimChanged(ents, e, initial) {
  if (e.q[4] !== DANIM.DEAD || e.dead) return;
  e.dead = true;
  // the body hits the ground a moment after the shot
  if (!initial) ents.g.audio.play(SOUND.BODY_FALL, { x: e.rx, y: e.ry + 0.2, z: e.rz, delay: 0.45, volume: 0.9, rate: 1.1 });
}

// Entities.onRemove: a dead one sinks into the ground with the other corpses (true), anything else just goes
export function removeDeerView(ents, e) {
  if (!e.dead || !e.view) return false;
  ents.corpses.push({ view: e.view, t: 7, x: e.rx, y: e.ry, z: e.rz, yaw: e.ryaw, burning: 0 });
  e.view = null;
  return true;
}

// Entities.update, once a frame
export function updateDeer(ents, e, dt, renderTick, time, camPos, frustum) {
  const g = ents.g;
  const tmp = ents.tmp;
  // (the zombie's path, step for step: a cubic through the samples, coasting through a late packet, a jump of the
  // path carried as an offset that fades)
  e.samples.sampleSmooth(renderTick, tmp, e.samples.lastTick() >= g.latestTick - 1 ? 2 : 0);
  const sp = Math.hypot(tmp.vx, tmp.vz) * SERVER_TICK_RATE;
  e.speed += (Math.min(sp, 14) - e.speed) * Math.min(1, dt * 6);
  const fade = Math.exp(-dt * 8);
  e.ex *= fade;
  e.ey *= fade;
  e.ez *= fade;
  const jx = tmp.x - (e.sx + e.vx * dt);
  const jy = tmp.y - (e.sy + e.vy * dt);
  const jz = tmp.z - (e.sz + e.vz * dt);
  e.sx = tmp.x;
  e.sy = tmp.y;
  e.sz = tmp.z;
  const jump = Math.hypot(jx, jy, jz);
  if (jump > 3) e.ex = e.ey = e.ez = 0;
  else if (jump > 0.02 + 40 * dt * dt) {
    e.ex -= jx;
    e.ey -= jy;
    e.ez -= jz;
  }
  e.vx = tmp.vx * SERVER_TICK_RATE;
  e.vy = tmp.vy * SERVER_TICK_RATE;
  e.vz = tmp.vz * SERVER_TICK_RATE;
  e.rx = tmp.x + e.ex;
  e.ry = tmp.y + e.ey;
  e.rz = tmp.z + e.ez;
  e.ryaw += wrapAngle(tmp.yaw - e.ryaw) * Math.min(1, dt * 12);
  const v = e.view;
  if (!v) return;
  v.object.position.set(e.rx, e.ry, e.rz);
  v.object.rotation.y = e.ryaw;
  const distC = (e.rx - camPos.x) ** 2 + (e.rz - camPos.z) ** 2;
  const anim = e.q[4];
  // far ones are posed on alternate frames
  if (distC < 60 * 60 || ((g.frame + e.id) & 1) === 0) {
    _sph.center.set(e.rx, e.ry + 0.7, e.rz);
    _sph.radius = 1.6;
    v.update(distC < 60 * 60 ? dt : dt * 2, anim, e.speed, time, frustum.intersectsSphere(_sph));
  }
  // hoofbeats when it runs close by: the hind pair, then the fore, of every bound (client-side, no bandwidth)
  if ((anim === DANIM.RUN || anim === DANIM.CHARGE) && e.speed > DEER.run * 0.4 && distC < HOOF_RANGE * HOOF_RANGE) {
    const falls = v.footfalls();
    if (e.falls >= 0 && falls !== e.falls) g.audio.play(SOUND.DEER_HOOF, { x: e.rx, y: e.ry + 0.1, z: e.rz, volume: falls & 1 ? 0.85 : 1 });
    e.falls = falls;
  } else e.falls = -1;
}
