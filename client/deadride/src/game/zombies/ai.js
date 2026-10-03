// Zombie steering: nav flow field (world.flow) with direct pursuit when there is line of sight, crowd separation,
// surround spread near the target, stuck recovery, attack decisions with reach/facing tests. Expensive queries (line of sight,
// flow lookups) are staggered per zombie; nothing allocates per frame.
import { clamp, angleDelta } from '../../core/util.js';

const _flow = { x: 0, z: 0 };
export class ZombieAI {
  constructor() { this.reset(Math.random()); }
  reset(seed) {
    this.losT = seed * 0.3; this.los = false; this.fx = 0; this.fz = 0; this.flowT = seed * 0.2; this.slot = seed * Math.PI * 2; this.stuckT = 0; this.lastX = 0; this.lastZ = 0; this.jitter = 0; this.jitterT = 0; this.attackCd = 0.6 + seed * 0.6; this.think = seed * 0.1; this.distToTarget = 99; this.wantAttack = false;
  }
  /**
   * z: zombie (anim, pos, speed, crawler), target: {x,y,z (feet), eyeY}, all: zombie list (for separation), world.
   * Writes z.anim.want (velocity + look) and returns true if an attack should start now.
   */
  update(z, dt, target, all, world, reach) {
    const a = z.anim, p = a.pos; const dx = target.x - p.x, dz = target.z - p.z; const dist = Math.hypot(dx, dz); this.distToTarget = dist;
    // ---- line of sight (staggered, 4 Hz)
    this.losT -= dt; if (this.losT <= 0) { this.losT = 0.25; this.los = dist < 26 && world.clear(p.x, p.y + 1.3, p.z, target.x, target.y + 1.2, target.z); }
    // ---- route direction
    let ux = 0, uz = 0;
    if (this.los || dist < 1.6) { ux = dx / (dist || 1); uz = dz / (dist || 1); }
    else {
      this.flowT -= dt; if (this.flowT <= 0) {
        this.flowT = 0.12; const d = world.flow(p.x, p.z, _flow); let fx, fz; if (d >= 0 && (_flow.x || _flow.z)) { fx = _flow.x; fz = _flow.z; } else { fx = dx / (dist || 1); fz = dz / (dist || 1); }
        // corridor centring: probe free space to both sides and ahead; steer away from the blocked side (keeps zombies off walls / props)
        const px = -fz, pz = fx; const l = world.isFree(p.x + px * 0.55, p.z + pz * 0.55), r = world.isFree(p.x - px * 0.55, p.z - pz * 0.55);
        if (l && !r) { fx += px * 0.45; fz += pz * 0.45; } else if (r && !l) { fx -= px * 0.45; fz -= pz * 0.45; }
        const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
        this.fx += (fx - this.fx) * 0.5; this.fz += (fz - this.fz) * 0.5; const n = Math.hypot(this.fx, this.fz) || 1; this.fx /= n; this.fz /= n;
      }
      ux = this.fx; uz = this.fz;
    }
    // ---- surround spread near the target: aim for a slot on a ring around it instead of the centre
    if (dist < 3.5 && dist > reach * 0.8) { const tx = -uz, tz = ux; const side = Math.sin(this.slot) * clamp((3.5 - dist) / 2.5, 0, 1) * 0.55; ux += tx * side; uz += tz * side; }
    // ---- separation from other zombies (and from the target when inside reach)
    let sx = 0, sz = 0; const R = 0.75;
    for (let i = 0; i < all.length; i++) {
      const o = all[i]; if (o === z || o.dead || o.state === 'spawning') continue; const ox = p.x - o.anim.pos.x, oz = p.z - o.anim.pos.z; const d2 = ox * ox + oz * oz; if (d2 > R * R || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), k = (R - d) / R; sx += ox / d * k; sz += oz / d * k;
    }
    ux += sx * 1.6; uz += sz * 1.6;
    // ---- stuck recovery
    this.stuckT += dt; if (this.stuckT > 1.5) { const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ); if (moved < 0.25 && dist > reach * 1.3) { this.jitter = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.6); this.jitterT = 1.1; } this.lastX = p.x; this.lastZ = p.z; this.stuckT = 0; }
    if (this.jitterT > 0) { this.jitterT -= dt; const c = Math.cos(this.jitter), s = Math.sin(this.jitter); const nx = ux * c - uz * s, nz = ux * s + uz * c; ux = nx; uz = nz; }
    const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    // ---- speed: slow into the attack range; stop while attacking
    let spd = z.speed; if (z.crawler) spd = z.crawlSpeed;
    const stopAt = reach * 0.78; if (dist < stopAt + 0.9) spd *= clamp((dist - stopAt) / 0.9, 0, 1);
    if (a.attack) spd *= a.attack.type === 2 ? 0.1 : 0.3;
    a.want.vx = ux * spd; a.want.vz = uz * spd;
    a.want.hasLook = true;
    if (this.los || dist < 3) { a.want.look.set(target.x, target.y + target.eyeY, target.z); a.want.faceYaw = Math.atan2(-dx, -dz); }
    else { a.want.look.set(p.x + ux * 4, p.y + 1.45, p.z + uz * 4); a.want.faceYaw = Math.atan2(-ux, -uz); } // no line of sight: look where it is going
    // ---- attack decision
    this.attackCd -= dt;
    if (this.attackCd <= 0 && !a.attack && dist < reach && z.state === 'alive') {
      const facing = Math.abs(angleDelta(a.yaw, Math.atan2(-dx, -dz))); if (facing < 0.9) { this.attackCd = 1.25 + Math.random() * 0.7; return true; }
    }
    return false;
  }
}
