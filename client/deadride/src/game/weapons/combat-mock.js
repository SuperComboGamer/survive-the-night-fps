// Stand-in for the integrator's combat module (same surface): hitscan vs world colliders + simple dummy targets,
// surface-correct impact FX (fx.impact), tracers from the muzzle, blood on targets, damage falloff, explosive splash, melee.
import * as THREE from 'three';

const D = new THREE.Vector3(), R = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
export class CombatMock {
  constructor({ world, fx, audio, targets = [] }) {
    this.world = world; this.fx = fx; this.audio = audio; this.targets = targets; this.hw = { t: 0, nx: 0, ny: 0, nz: 0, surface: '' };
    this.out = { hits: 0, kills: 0, headshots: 0, point: new THREE.Vector3(), surface: null }; this.log = []; this.shots = 0;
    this.zombies = { explode: (pos, radius, damage) => { for (const T of this.targets) { const d = T.pos.distanceTo(pos); if (d < radius) T.hit(T.pos, R.subVectors(T.pos, pos).normalize(), damage * (1 - d / radius), 8); } } }; // splash damage only (like the game's zombies.explode)
  }
  /** spec: {origin, dir, damage, range, pellets, spread, weaponId, tracer, muzzle, isShotgun, caliber, headshotMul, falloff, explosive, impulse} */
  shoot(spec) {
    const out = this.out; out.hits = out.kills = out.headshots = 0; const n = spec.pellets || 1; this.shots++;
    for (let i = 0; i < n; i++) {
      D.copy(spec.dir);
      if (spec.spread > 0) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spec.spread; R.set(0, 1, 0); if (Math.abs(D.y) > 0.99) R.set(1, 0, 0); N.crossVectors(D, R).normalize(); R.crossVectors(N, D); D.addScaledVector(N, Math.cos(a) * Math.tan(r)).addScaledVector(R, Math.sin(a) * Math.tan(r)).normalize(); }
      this._trace(spec, D, i === 0 || n < 4 || i % 3 === 0);
    }
    return out;
  }
  _trace(spec, dir, tracer) {
    const o = spec.origin, range = spec.range || 300, out = this.out; let tMax = range, hitW = false;
    if (this.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, range, this.hw)) { tMax = this.hw.t; hitW = true; }
    // targets: vertical capsules approximated by cylinder + head sphere
    let tgt = null, part = 'torso';
    for (const T of this.targets) { const t = T.ray(o, dir, tMax); if (t > 0 && t < tMax) { tMax = t; tgt = T; part = T.lastPart; } }
    let dmg = spec.damage; if (spec.falloff) { const [a, b, m] = spec.falloff; const k = Math.min(1, Math.max(0, (tMax - a) / (b - a))); dmg *= 1 - k * (1 - m); }
    P.set(o.x + dir.x * tMax, o.y + dir.y * tMax, o.z + dir.z * tMax);
    if (tracer && spec.tracer) { const tr = spec.tracer; this.fx.tracers.add(spec.muzzle || o, P, this.fx.time, { speed: tr.speed, len: tr.len, width: tr.width, color: tr.color, a: tr.a ?? 1 }); }
    if (tgt) { out.hits++; out.point.copy(P); const head = part === 'head'; if (head) out.headshots++; const k = tgt.hit(P, dir, dmg * (head ? spec.headshotMul || 2 : 1), spec.impulse || 3); if (k) out.kills++; N.copy(dir).negate(); this.fx.blood(P, N, dir, head ? 1.4 : 0.8); this.audio?.play?.(head ? 'flesh.head' : 'flesh.hit', { pos: P, vol: 0.8 }); if (spec.explosive) this.explode(P, spec.explosive.radius, spec.explosive.damage); }
    else if (hitW) { out.hits++; out.point.copy(P); out.surface = this.hw.surface; N.set(this.hw.nx, this.hw.ny, this.hw.nz); this.fx.impact(this.hw.surface, P, N, dir, { caliber: spec.caliber || 1, isShotgun: !!spec.isShotgun }); this.audio?.play?.('impact.' + this.hw.surface, { pos: P, vol: 0.7 }); if (spec.explosive) this.explode(P, spec.explosive.radius, spec.explosive.damage); }
    else out.point.copy(P);
  }
  explode(pos, radius, damage) {
    this.fx.explosion(pos, radius, Math.min(2, radius / 4)); this.audio?.play?.('explosion', { pos, vol: 1 });
    for (const T of this.targets) { const d = T.pos.distanceTo(pos); if (d < radius) T.hit(T.pos, R.subVectors(T.pos, pos).normalize(), damage * (1 - d / radius), 8); }
  }
  melee({ origin, dir, range = 1.9, damage = 150 }) {
    let best = null, bt = range; for (const T of this.targets) { const t = T.ray(origin, dir, bt + 0.3); if (t > 0 && t < bt + 0.3) { bt = t; best = T; } }
    if (best) { P.copy(origin).addScaledVector(dir, bt); best.hit(P, dir, damage, 6); N.copy(dir).negate(); this.fx.blood(P, N, dir, 1); this.audio?.play?.('flesh.hit', { pos: P, vol: 1 }); return true; }
    if (this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, this.hw)) { P.copy(origin).addScaledVector(dir, this.hw.t); N.set(this.hw.nx, this.hw.ny, this.hw.nz); this.fx.impact(this.hw.surface, P, N, dir, { caliber: 0.6 }); return true; }
    return false;
  }
}

/** shootable training dummy: post + torso + head, sways back on hits (spring) */
export class Dummy {
  constructor(scene, pos, mat, headMat) {
    this.pos = new THREE.Vector3(...pos); this.g = new THREE.Group(); this.g.position.copy(this.pos); scene.add(this.g); this.hp = 1000; this.tilt = 0; this.tv = 0; this.lastPart = 'torso'; this.hits = 0;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 10), mat); post.position.y = 0.5; post.castShadow = true;
    this.body = new THREE.Group(); this.body.position.y = 0.95; this.g.add(post, this.body);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 6, 14), mat); torso.scale.set(1, 1, 0.65); torso.position.y = 0.33; torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), headMat); head.position.y = 0.82; head.castShadow = true; this.body.add(torso, head);
  }
  ray(o, d, maxT) { // cylinder r 0.24 from y 0.95..1.65 (+tilt ignored) and head sphere
    const rx = o.x - this.pos.x, rz = o.z - this.pos.z; let best = -1;
    const hy = this.pos.y + 0.95 + 0.82; { const cx = o.x - this.pos.x, cy = o.y - hy, cz = o.z - this.pos.z; const b = cx * d.x + cy * d.y + cz * d.z, c = cx * cx + cy * cy + cz * cz - 0.13 * 0.13; const disc = b * b - c; if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < maxT) { best = t; this.lastPart = 'head'; } } }
    const a = d.x * d.x + d.z * d.z; if (a > 1e-9) { const b = rx * d.x + rz * d.z, c = rx * rx + rz * rz - 0.23 * 0.23; const disc = b * b - a * c; if (disc > 0) { const t = (-b - Math.sqrt(disc)) / a; const y = o.y + d.y * t - this.pos.y; if (t > 0 && t < maxT && y > 0.95 && y < 1.62 && (best < 0 || t < best)) { best = t; this.lastPart = 'torso'; } } }
    return best;
  }
  hit(p, dir, dmg, imp) { this.hits++; this.hp -= dmg; this.tv += imp * 0.4 * (dir.z < 0 ? 1 : -1); return this.hp <= 0 && (this.hp = 1000, true); }
  update(dt) { this.tv += (-this.tilt * 60 - this.tv * 6) * dt; this.tilt += this.tv * dt; this.body.rotation.x = -this.tilt; }
}
