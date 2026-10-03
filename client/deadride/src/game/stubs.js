// Minimal stand-ins so the game loop is testable before the real zombie / weapon systems land. Same public surface as docs/API.md.
import * as THREE from 'three';
import { std } from '../core/mats.js';
import { rand, clamp, TAU } from '../core/util.js';

export class StubZombies {
  constructor({ gfx, world, fx, audio }) { this.gfx = gfx; this.world = world; this.fx = fx; this.alive = []; this.round = 1; this.mat = std({ color: 0x6d7a5a, roughness: 0.8, key: 'stubZ' }); this.headMat = std({ color: 0x8a8f6a, roughness: 0.7, key: 'stubZh' }); this.flow = { x: 0, z: 0 }; this.navT = 0; this.g = new THREE.Group(); gfx.scene.add(this.g); }
  get count() { return this.alive.length; }
  registerVariants() {}
  setRound(r) { this.round = r; }
  spawn(variant, pos, yaw, opts = {}) {
    const z = { id: variant, hp: opts.hp || 150, maxHp: opts.hp || 150, pos: pos.clone(), yaw, speed: opts.speed || 1.0, group: new THREE.Group(), dead: 0, atk: 0, kind: opts.kind || 'walk', spawnDef: opts.spawnDef, state: 'walk', crawl: false, vy: 0 };
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.95, 4, 10), this.mat); body.position.y = 0.95; body.castShadow = true; const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), this.headMat); head.position.y = 1.72; head.castShadow = true; z.group.add(body, head);
    z.group.position.copy(pos); z.group.rotation.y = yaw; this.g.add(z.group); this.alive.push(z); return z;
  }
  update(dt, time, player) {
    this.navT -= dt; if (this.navT <= 0) { this.navT = 0.3; this.world.navTarget(player.pos.x, player.pos.z); }
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const z = this.alive[i];
      if (z.dead) { z.dead += dt; z.group.rotation.x = Math.min(Math.PI / 2, z.dead * 4); if (z.dead > 5) { this.g.remove(z.group); this.alive.splice(i, 1); } continue; }
      const dx = player.pos.x - z.pos.x, dz = player.pos.z - z.pos.z, d = Math.hypot(dx, dz);
      let vx = dx / (d || 1), vz = dz / (d || 1);
      if (d > 3) { if (this.world.flow(z.pos.x, z.pos.z, this.flow) >= 0 && (this.flow.x || this.flow.z)) { vx = this.flow.x; vz = this.flow.z; } }
      if (z.kind === 'barricade' && z.spawnDef?.barricade && z.spawnDef.barricade.boards > 0) { z.atk += dt; if (z.atk > 1.2) { z.atk = 0; z.spawnDef.barricade.tearNext(1); } continue; }
      if (d > 1.0) { z.pos.x += vx * z.speed * dt; z.pos.z += vz * z.speed * dt; z.yaw = Math.atan2(-vx, -vz); this.world.push(z.pos, 0.3, z.pos.y, 1.8); const g = this.world.groundAt(z.pos.x, z.pos.z, z.pos.y + 0.5); z.pos.y = g.y; } else { z.atk += dt; if (z.atk > 0.9) { z.atk = 0; this.onAttackPlayer?.(z, 45); } }
      z.group.position.copy(z.pos); z.group.rotation.y = z.yaw;
    }
  }
  raycast(ox, oy, oz, dx, dy, dz, maxT, out) {
    let best = maxT, hz = null, part = 'torso';
    for (const z of this.alive) { if (z.dead) continue; const rx = ox - z.pos.x, rz = oz - z.pos.z; const a = dx * dx + dz * dz; if (a < 1e-9) continue; const b = rx * dx + rz * dz, c = rx * rx + rz * rz - 0.3 * 0.3; const disc = b * b - a * c; if (disc < 0) continue; const t = (-b - Math.sqrt(disc)) / a; if (t < 0 || t > best) continue; const y = oy + dy * t - z.pos.y; if (y < 0 || y > 1.9) continue; best = t; hz = z; part = y > 1.5 ? 'head' : y < 0.8 ? 'leg' : 'torso'; }
    if (!hz) return false; out.zombie = hz; out.part = part; out.t = best; out.point = out.point || new THREE.Vector3(); out.point.set(ox + dx * best, oy + dy * best, oz + dz * best); out.normal = out.normal || new THREE.Vector3(); out.normal.set(-dx, 0, -dz).normalize(); return true;
  }
  damage(z, { amount, part, dir, point }) { const head = part === 'head'; z.hp -= amount * (head ? 2 : 1); this.fx.blood(point, new THREE.Vector3(0, 0, 0).sub(dir), dir, head ? 1.4 : 0.8); const killed = z.hp <= 0 && !z.dead; if (killed) { z.dead = 0.001; this.onKill?.(z, { headshot: head, killed: true, part }); } else this.onHit?.(z, { headshot: head }); return { killed, headshot: head, dismembered: false }; }
  explode(pos, radius, dmg) { for (const z of this.alive) { if (z.dead) continue; const d = z.pos.distanceTo(pos); if (d < radius) { z.hp -= dmg * (1 - d / radius); if (z.hp <= 0) { z.dead = 0.001; this.onKill?.(z, { killed: true, explosion: true }); } } } }
  clear() { for (const z of this.alive) this.g.remove(z.group); this.alive.length = 0; }
  killAll() { for (const z of this.alive) if (!z.dead) { z.dead = 0.001; this.onKill?.(z, { killed: true, nuke: true }); } }
}
export const STUB_WEAPONS = {
  m1911: { id: 'm1911', name: 'M1911', class: 'pistol', wallPrice: 0, ammoPrice: 250, box: false, mag: 8, reserve: 80, rpm: 400, damage: 40, reloadTime: 1.9 },
  mp5: { id: 'mp5', name: 'MP5', class: 'smg', wallPrice: 1000, ammoPrice: 500, box: true, mag: 30, reserve: 120, rpm: 800, damage: 30, reloadTime: 2.4 },
  olympia: { id: 'olympia', name: 'Olympia', class: 'shotgun', wallPrice: 500, ammoPrice: 250, box: true, mag: 2, reserve: 38, rpm: 240, damage: 120, reloadTime: 2.8 },
  m14: { id: 'm14', name: 'M14', class: 'rifle', wallPrice: 500, ammoPrice: 250, box: true, mag: 8, reserve: 80, rpm: 500, damage: 70, reloadTime: 2.6 },
  ak74u: { id: 'ak74u', name: 'AK74u', class: 'smg', wallPrice: 1200, ammoPrice: 600, box: true, mag: 30, reserve: 120, rpm: 700, damage: 34, reloadTime: 2.3 },
  remington870: { id: 'remington870', name: 'Remington 870 MCS', class: 'shotgun', wallPrice: 1500, ammoPrice: 750, box: true, mag: 6, reserve: 56, rpm: 70, damage: 150, reloadTime: 4 },
  raygun: { id: 'raygun', name: 'Ray Gun', class: 'wonder', wallPrice: 0, ammoPrice: 5000, box: true, mag: 20, reserve: 160, rpm: 190, damage: 250, reloadTime: 3 },
};
export class StubWeapons {
  constructor({ gfx, fx, audio, world, player, input, combat }) { Object.assign(this, { gfx, fx, audio, world, player, input, combat }); this.slots = []; this.cur = 0; this.state = {}; this.perks = {}; this.fireT = 0; this.reloadT = 0; this.events = {}; this.WEAPONS = STUB_WEAPONS; this.mz = new THREE.Vector3(); this.d = new THREE.Vector3(); this.o = new THREE.Vector3(); this.grenades = 4; }
  get current() { const id = this.slots[this.cur]; return id ? { ...this.state[id], id, def: STUB_WEAPONS[id] } : null; }
  has(id) { return this.slots.includes(id); }
  give(id) { if (!this.has(id)) { if (this.slots.length < 2) this.slots.push(id); else this.slots[this.cur] = id; } this.state[id] = { mag: STUB_WEAPONS[id].mag, reserve: STUB_WEAPONS[id].reserve }; this.cur = this.slots.indexOf(id); }
  refillAll() { for (const id of this.slots) this.state[id] = { mag: STUB_WEAPONS[id].mag, reserve: STUB_WEAPONS[id].reserve }; this.grenades = 4; }
  addAmmo(id) { const s = this.state[id]; if (s) s.reserve = STUB_WEAPONS[id].reserve; }
  setPerks(p) { this.perks = p; }
  update(dt) {
    const c = this.current; if (!c) return; const p = this.player, inp = this.input; this.fireT -= dt; const st = this.state[c.id];
    if (inp.pressed('Digit1')) this.cur = 0; if (inp.pressed('Digit2') && this.slots.length > 1) this.cur = 1; if (inp.wheel && this.slots.length > 1) this.cur = (this.cur + 1) % this.slots.length;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const need = c.def.mag - st.mag, take = Math.min(need, st.reserve); st.mag += take; st.reserve -= take; } return; }
    if (inp.pressed('KeyR') && st.mag < c.def.mag && st.reserve > 0) { this.reloadT = c.def.reloadTime * (this.perks.speedCola ? 0.5 : 1); return; }
    const auto = c.def.class === 'smg'; p.adsK += ((inp.mouse(2) ? 1 : 0) - p.adsK) * Math.min(1, dt * 12);
    if ((auto ? inp.mouse(0) : inp.mousePressed(0)) && this.fireT <= 0 && !p.sprinting) {
      if (st.mag <= 0) { if (st.reserve > 0) this.reloadT = c.def.reloadTime; return; }
      st.mag--; this.fireT = 60 / c.def.rpm / (this.perks.doubleTap ? 1.33 : 1); this.o.copy(p.eye); this.d.copy(p.forward);
      this.mz.copy(p.eye).addScaledVector(p.forward, 0.6).addScaledVector(p.right, 0.12); this.mz.y -= 0.12;
      const shot = c.def.class === 'shotgun';
      this.combat.shoot({ origin: this.o, dir: this.d, damage: c.def.damage * (this.perks.doubleTap ? 1.33 : 1) / (shot ? 8 : 1), pellets: shot ? 8 : 1, spread: shot ? 0.05 : 0.004 + (1 - p.adsK) * 0.006, weaponId: c.id, muzzle: this.mz, isShotgun: shot, caliber: 1 });
      p.addKick(0.025 + Math.random() * 0.01, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02); p.addAim(0.004, 0); this.fx.muzzleBlast(this.mz, this.d, 1, true); this.fx.pulseLight(this.mz, 0xffb060, 250, 0.05, 12);
      this.audio?.play?.('gun.' + c.id + '.fire', { pos: null, vol: 1, bus: 'weapon' }); this.events.onShot?.(c.id);
    }
  }
  getOutline() { return null; } buildWorldModel() { return null; } getIcon() { return null; }
}
