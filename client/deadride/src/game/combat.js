// Combat resolution: hitscan vs world + zombies, surface-correct impacts, tracers, points, explosions.
import * as THREE from 'three';
import { rand, clamp, TAU } from '../core/util.js';

const V = new THREE.Vector3(), D = new THREE.Vector3(), P = new THREE.Vector3(), N = new THREE.Vector3(), R = new THREE.Vector3();
export class Combat {
  constructor({ world, fx, zombies, audio, game }) {
    this.world = world; this.fx = fx; this.zombies = zombies; this.audio = audio; this.game = game;
    this._sid = 0; this.hw = {}; this.hz = {}; this.tmp = { hits: 0, kills: 0, headshots: 0, point: new THREE.Vector3(), surface: null };
  }
  /** spec: {origin:Vector3, dir:Vector3 (unit), damage, range=300, pellets=1, spread(rad)=0, weaponId, tracer:{color,speed,len,width}|null, muzzle:Vector3, isShotgun, caliber, headshotMul, falloff:[nearM,farM,minMul], explosive:{radius,damage}, pierce=0} */
  shoot(spec) {
    const out = this.tmp; out.hits = out.kills = out.headshots = 0; const t = this.fx.time; const n = spec.pellets || 1; spec._sid = ++this._sid;
    this.net?.localShot(spec); // (co-op: the others see and hear it)
    for (let i = 0; i < n; i++) {
      D.copy(spec.dir);
      if (spec.spread > 0) { const a = rand() * TAU, r = Math.sqrt(rand()) * spec.spread; V.set(0, 1, 0); if (Math.abs(D.y) > 0.99) V.set(1, 0, 0); R.crossVectors(D, V).normalize(); N.crossVectors(D, R); D.addScaledVector(R, Math.cos(a) * Math.tan(r)).addScaledVector(N, Math.sin(a) * Math.tan(r)).normalize(); }
      this._trace(spec, D, out, t, i === 0 || n < 4 || i % 3 === 0);
    }
    return out;
  }
  _trace(spec, dir, out, t, drawTracer) {
    const o = spec.origin, range = spec.range || 300, w = this.world; let tMax = range, hitWorld = false, hitZ = false;
    const hw = this.hw, hz = this.hz;
    if (w.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, range, hw)) { tMax = hw.t; hitWorld = true; }
    let zh = false; if (this.zombies) zh = this.zombies.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, tMax, hz);
    if (zh) { tMax = hz.t; hitZ = true; hitWorld = false; }
    let dmg = spec.damage * (this.insta ? 1000 : 1); if (spec.falloff) { const [a, b, m] = spec.falloff; const k = clamp((tMax - a) / (b - a)); dmg *= 1 - k * (1 - m); }
    P.set(o.x + dir.x * tMax, o.y + dir.y * tMax, o.z + dir.z * tMax);
    if (drawTracer && spec.tracer !== null) { const tr = spec.tracer || {}; const from = spec.muzzle || o; this.fx.tracers.add(from, P, t, { speed: tr.speed || 900, len: tr.len || 7, width: tr.width || 0.014, color: tr.color || [1, 0.72, 0.3], a: tr.a ?? 1 }); }
    if (hitZ) {
      out.hits++; out.point.copy(hz.point);
      const info = this._damage(hz.zombie, { amount: dmg, part: hz.part, dir: dir, point: hz.point, normal: hz.normal, impulse: spec.impulse ?? (spec.isShotgun ? 5 : 3), weapon: spec.weaponId, headshotMul: spec.headshotMul, _bi: hz._bi }, spec);
      if (info) { if (info.headshot) out.headshots++; if (info.killed) out.kills++; this.game?.onZombieHit?.(hz.zombie, info, spec); }
      this.audio?.play?.(info?.headshot ? 'flesh.head' : 'flesh.hit', { pos: hz.point, vol: 0.8 });
      if (spec.explosive) this.explode(hz.point, spec.explosive.radius, spec.explosive.damage, { source: spec });
    } else if (hitWorld) {
      out.hits++; out.point.copy(P); out.surface = hw.surface; N.set(hw.nx, hw.ny, hw.nz);
      this.fx.impact(hw.surface, P, N, dir, { caliber: spec.caliber || 1, isShotgun: !!spec.isShotgun });
      this.audio?.play?.('impact.' + (hw.surface || 'concrete'), { pos: P, vol: spec.isShotgun ? 0.5 : 0.8 });
      if (this.audio && dir.dot(N) < -0.9 === false && rand() < 0.35) this.audio.play('ricochet', { pos: P, vol: 0.5 });
      if (spec.explosive) this.explode(P, spec.explosive.radius, spec.explosive.damage, { source: spec });
    }
    // near-miss whiz for the player (only for zombie/world traces that pass close is not needed for hitscan from the player)
  }
  /** a hit on a zombie: applied here, or (co-op, not the host) claimed with the host, which applies it for everyone */
  _damage(z, o, spec) {
    if (!this.net?.client) return this.zombies.damage(z, o);
    this.net.claimHit(z, o, spec); this.fx.blood(o.point, o.normal || o.dir, o.dir, 0.6); this.game?.hud?.hitmarker(false);
    return null;
  }
  explode(pos, radius, damage, o = {}) {
    this.fx.explosion(pos, radius, Math.min(2, radius / 4));
    this.audio?.explosion?.(pos, radius) ?? this.audio?.play?.('explosion', { pos, vol: 1 });
    if (this.net?.client) this.net.claimExplosion(pos, radius, damage, o.source?.weaponId); else this.zombies?.explode(pos, radius, damage, o);
    const pl = this.game?.player; if (pl && o.hurtPlayer !== false) { const d = pl.eye.distanceTo(pos); if (d < radius * 1.2) { const k = 1 - d / (radius * 1.2); if (this.world.clear(pos.x, pos.y + 0.5, pos.z, pl.eye.x, pl.eye.y, pl.eye.z)) pl.damage(Math.round(k * (o.playerDamage ?? damage * 0.5)), pos); } }
  }
  melee({ origin, dir, range = 1.9, damage = 150 }) {
    const h = this.hz; this.lastMelee = true; if (this.zombies && this.zombies.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, h)) {
      const info = this._damage(h.zombie, { amount: damage * (this.insta ? 1000 : 1), part: h.part, dir, point: h.point, normal: h.normal, impulse: 6, weapon: 'knife', melee: true, _bi: h._bi }, { weaponId: 'knife', melee: true });
      this.lastMelee = false; if (info) this.game?.onZombieHit?.(h.zombie, info, { weaponId: 'knife', melee: true }); this.audio?.play?.('flesh.hit', { pos: h.point, vol: 1 }); return true;
    }
    this.lastMelee = false; if (this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, this.hw)) { P.set(origin.x + dir.x * this.hw.t, origin.y + dir.y * this.hw.t, origin.z + dir.z * this.hw.t); N.set(this.hw.nx, this.hw.ny, this.hw.nz); this.fx.impact(this.hw.surface, P, N, dir, { caliber: 0.6 }); this.audio?.play?.('impact.' + this.hw.surface, { pos: P, vol: 0.6 }); return true; }
    return false;
  }
}
