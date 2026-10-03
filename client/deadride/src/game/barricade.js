// Window/door barricade: 5 planks zombies tear off one by one and the player repairs (+10 points each) — BO2 style.
import * as THREE from 'three';
import { rand } from '../core/util.js';
import { boxRaw, rawToGeometry } from '../core/build.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);
export class Barricade {
  /** pos: world position of the opening's base centre; yaw: facing (direction the zombie comes FROM inside->outside irrelevant; planks are across the opening perpendicular to yaw) */
  constructor(scene, mat, { pos, yaw = 0, boards = 5, width = 1.5, height = 1.9 }) {
    this.pos = new THREE.Vector3(...pos); this.yaw = yaw; this.max = boards; this.boards = boards; this.group = new THREE.Group(); this.group.position.copy(this.pos); this.group.rotation.y = yaw; scene.add(this.group);
    this.planks = []; const geo = rawToGeometry(boxRaw(width * 1.08, 0.2, 0.05, 0.006));
    for (let i = 0; i < boards; i++) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
      m.userData = { home: new THREE.Vector3((rand() - 0.5) * 0.05, 0.3 + i * (height - 0.5) / Math.max(1, boards - 1), 0.08 + (i % 2) * 0.05), rz: (rand() - 0.5) * 0.1, vel: new THREE.Vector3(), av: new THREE.Vector3(), fly: 0, state: 'on' };
      m.position.copy(m.userData.home); m.rotation.z = m.userData.rz; this.group.add(m); this.planks.push(m);
    }
    this.tearTimer = 0; this.repairing = 0; this.onEvent = null;
  }
  get intact() { return this.boards === this.max; } get open() { return this.boards === 0; }
  /** zombie rips the next plank (topmost on first): returns true if there was one */
  tearNext(fromDir) {
    if (this.boards <= 0) return false; const k = this.boards - 1; const p = this.planks[k]; p.userData.state = 'fly'; p.userData.fly = 2.2; this.boards--;
    p.userData.vel.set((rand() - 0.5) * 3, 1.5 + rand() * 2, (fromDir || 1) * (2 + rand() * 2)); p.userData.av.set((rand() - 0.5) * 8, (rand() - 0.5) * 8, (rand() - 0.5) * 12); this.onEvent?.('tear', this); return true;
  }
  repairNext() { if (this.boards >= this.max) return false; const p = this.planks[this.boards]; p.userData.state = 'on'; p.userData.fly = 0; p.position.copy(p.userData.home); p.rotation.set(0, 0, p.userData.rz); this.boards++; this.onEvent?.('repair', this); return true; }
  reset() { while (this.boards < this.max) this.repairNext(); }
  update(dt) {
    for (const p of this.planks) { const u = p.userData; if (u.state !== 'fly') continue; u.fly -= dt; u.vel.y -= 9.81 * dt; p.position.addScaledVector(u.vel, dt); p.rotation.x += u.av.x * dt; p.rotation.y += u.av.y * dt; p.rotation.z += u.av.z * dt; if (p.position.y < 0.05 + 0.0) { p.position.y = 0.05; u.vel.multiplyScalar(0.3); u.av.multiplyScalar(0.3); } if (u.fly <= 0) { u.state = 'off'; p.visible = true; } }
  }
}
