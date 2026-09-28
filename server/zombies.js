// Zombie AI: targeting, flow-field navigation, melee, structure breaking, and special abilities
// (spitter acid, leaper pounce/pin, roper rope-pull, boomer explosion, bat swarms, tank charge, bosses).
import { MAP_HALF, PHASE, PLAYER_RADIUS, EYE_HEIGHT, MAX_ENTITIES, HORDE_SPAWN_MIN, HORDE_SPAWN_MAX } from '../shared/constants.js';
import { ZTYPE, ZOMBIE_DEFS, ZANIM, SOUND, KILLER, PROJ, EVT, IMPACT, STRUCT_DEFS } from '../shared/defs.js';
import { ENT, qpos } from '../shared/protocol.js';
import { resolveBody, groundAt, raycastWorld, footprintContains, COL } from '../shared/collision.js';

const GRAV = 16;
const CELL = 4;
const HN = Math.ceil((MAP_HALF * 2) / CELL);
const _pos = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, z: 0, cost: 0 };
const _ray = { t: -1, col: null, terrain: false };

export class Zombies {
  constructor(game) {
    this.g = game;
    this.head = new Int32Array(HN * HN).fill(-1);
    this.next = new Int32Array(MAX_ENTITIES).fill(-1);
    this.fieldRR = 0;
    this.maintainT = 0;
    this.humansCache = [];
  }

  // ---------------------------------------------------------------- spawning
  spawn(type, x, z, opts = {}) {
    const g = this.g;
    const def = ZOMBIE_DEFS[type];
    if (!def) return null;
    const w = g.world;
    const lim = MAP_HALF - 6;
    x = Math.max(-lim, Math.min(lim, x));
    z = Math.max(-lim, Math.min(lim, z));
    if (w.isDeepWater(x, z) || g.nav.isBlocked(x, z)) {
      // nudge to a free spot
      let ok = false;
      for (let i = 0; i < 12 && !ok; i++) {
        const nx = x + (g.rng() - 0.5) * 10;
        const nz = z + (g.rng() - 0.5) * 10;
        if (!w.isDeepWater(nx, nz) && !g.nav.isBlocked(nx, nz)) {
          x = nx;
          z = nz;
          ok = true;
        }
      }
      if (!ok) return null;
    }
    let y = groundAt(w, x, z, 200, 0.2, false);
    if (def.flying) y += 3 + g.rng() * 2;
    const hp = def.hp * (opts.hpMul || 1);
    const e = {
      kind: ENT.ZOMBIE,
      ztype: type,
      def,
      variant: Math.floor(g.rng() * 256),
      x,
      y,
      z,
      yaw: g.rng() * Math.PI * 2,
      vx: 0,
      vy: 0,
      vz: 0,
      kx: 0,
      kz: 0,
      hp,
      maxHp: hp,
      anim: ZANIM.IDLE,
      animT: 0,
      horde: !!opts.horde,
      boss: !!opts.boss || !!def.boss,
      target: 0,
      targetT: 0,
      aggroId: 0,
      aggroT: 0,
      alertX: 0,
      alertZ: 0,
      alertT: 0,
      lureX: 0,
      lureZ: 0,
      lureT: 0,
      attackCd: 0.5 + g.rng(),
      specialCd: 2 + g.rng() * 3,
      rockCd: 3,
      summonCd: 8,
      pendingHit: 0,
      pendingKind: 0,
      pendingTarget: 0,
      state: 0, // 0 move, 1 windup, 2 air, 3 pin, 4 rope-flying, 5 pulling, 6 charge, 7 retreat
      stateT: 0,
      stateAct: 0,
      chargeX: 0,
      chargeZ: 0,
      link: 0,
      linkDmg: 0,
      linkT: 0,
      losT: 0,
      los: false,
      blockStruct: 0,
      stuckT: 0,
      lastX: x,
      lastZ: z,
      detourT: 0,
      detourX: 0,
      detourZ: 0,
      wanderX: x,
      wanderZ: z,
      wanderT: 0,
      idleEat: g.rng() < 0.25,
      farT: 0,
      dead: false,
      deadT: 0,
      burning: 0,
      onFire: false,
      trapSlow: 1,
      hx: new Float32Array(16),
      hy: new Float32Array(16),
      hz: new Float32Array(16),
      hitStruct: null,
    };
    if (!g.spawnEntity(e)) return null;
    g.fillHistory(e);
    g.zombies.push(e);
    return e;
  }

  spawnInitial() {
    const g = this.g;
    const w = g.world;
    // zone guards (bigger places, bigger crowds)
    for (const zn of w.zones) {
      if (zn.id === 0) continue;
      const n = Math.round(zn.flat / 12) + Math.floor(g.rng() * 3) + (zn.id === 6 ? 3 : 0);
      for (let i = 0; i < n; i++) {
        const a = g.rng() * Math.PI * 2;
        const r = 4 + g.rng() * (zn.flat * 0.8);
        const type = g.rng() < 0.75 ? ZTYPE.WALKER : ZTYPE.RUNNER;
        this.spawn(type, zn.x + Math.sin(a) * r, zn.z + Math.cos(a) * r);
      }
    }
    // the car supplies are guarded
    for (const sp of g.supplySpots || []) {
      for (let i = 0; i < 3; i++) {
        const a = g.rng() * Math.PI * 2;
        const r = 3 + g.rng() * 6;
        this.spawn(i === 2 ? ZTYPE.RUNNER : ZTYPE.WALKER, sp.x + Math.sin(a) * r, sp.z + Math.cos(a) * r, { hpMul: 1.15 });
      }
    }
    // roaming dead in the woods
    for (let i = 0; i < 22; i++) this.spawnRoamer([]);
  }

  spawnRoamer(humans) {
    const g = this.g;
    // 35%: repopulate a named place (guards) if nobody is there
    if (g.rng() < 0.35) {
      const zones = g.world.zones.filter((z) => z.id !== 0);
      const zn = zones[Math.floor(g.rng() * zones.length)];
      let ok = true;
      for (const h of humans) if (Math.hypot(h.state.x - zn.x, h.state.z - zn.z) < zn.flat + 60) ok = false;
      if (ok) {
        const a = g.rng() * Math.PI * 2;
        const r = 4 + g.rng() * zn.flat * 0.8;
        const type = g.rng() < 0.7 ? ZTYPE.WALKER : g.day >= 3 && g.rng() < 0.4 ? ZTYPE.LEAPER : ZTYPE.RUNNER;
        return this.spawn(type, zn.x + Math.sin(a) * r, zn.z + Math.cos(a) * r, { hpMul: 1 + 0.05 * g.day });
      }
    }
    // wanderers along the roads and in the woods (never right on top of the start)
    const pts = g.rng() < 0.5 ? g.world.sites : g.world.resourceSpawns;
    const car = g.world.car;
    for (let tries = 0; tries < 10; tries++) {
      const p = pts[Math.floor(g.rng() * pts.length)];
      if (!p || Math.hypot(p.x - car.x, p.z - car.z) < 55) continue;
      let ok = true;
      for (const h of humans) if (Math.hypot(h.state.x - p.x, h.state.z - p.z) < 75) ok = false;
      if (!ok) continue;
      let type = ZTYPE.WALKER;
      const r = g.rng();
      if (r < 0.2) type = ZTYPE.RUNNER;
      else if (g.day >= 3 && r < 0.26) type = ZTYPE.SPITTER;
      else if (g.day >= 3 && r < 0.3) type = ZTYPE.LEAPER;
      else if (g.day >= 4 && r < 0.33) type = ZTYPE.BOOMER;
      return this.spawn(type, p.x + (g.rng() - 0.5) * 4, p.z + (g.rng() - 0.5) * 4, { hpMul: 1 + 0.05 * g.day });
    }
    return null;
  }

  pickSpawnPoint(humans, minDist) {
    const g = this.g;
    const pts = g.world.hordeSpawns;
    let best = null;
    let bestD = -1;
    for (let i = 0; i < 24; i++) {
      const p = pts[Math.floor(g.rng() * pts.length)];
      let md = Infinity;
      for (const h of humans) md = Math.min(md, Math.hypot(h.state.x - p.x, h.state.z - p.z));
      if (md >= minDist) return p;
      if (md > bestD) {
        bestD = md;
        best = p;
      }
    }
    return best;
  }

  // a walkable spot HORDE_SPAWN_MIN..MAX metres from (x,z) that no survivor is standing close to
  pickSpawnAround(x, z, humans, minD = HORDE_SPAWN_MIN, maxD = HORDE_SPAWN_MAX) {
    const g = this.g;
    const w = g.world;
    const lim = MAP_HALF - 14;
    for (let tries = 0; tries < 18; tries++) {
      const a = g.rng() * Math.PI * 2;
      const d = minD + g.rng() * (maxD - minD);
      const sx = x + Math.sin(a) * d;
      const sz = z + Math.cos(a) * d;
      if (Math.abs(sx) > lim || Math.abs(sz) > lim) continue;
      if (w.isDeepWater(sx, sz) || g.nav.isBlocked(sx, sz)) continue;
      let ok = true;
      for (const h of humans) if (Math.hypot(h.state.x - sx, h.state.z - sz) < minD * 0.75) ok = false;
      if (ok) return { x: sx, z: sz };
    }
    return this.pickSpawnPoint(humans, minD);
  }

  // the night horde comes to wherever the survivors are
  pickHordeSpawn(humans) {
    const g = this.g;
    if (!humans.length) return this.pickSpawnPoint(humans, 0);
    const h = humans[Math.floor(g.rng() * humans.length)];
    return this.pickSpawnAround(h.state.x, h.state.z, humans);
  }

  // ---------------------------------------------------------------- spatial hash
  rebuildHash() {
    this.head.fill(-1);
    const zs = this.g.zombies;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      const ci = Math.max(0, Math.min(HN - 1, Math.floor((z.x + MAP_HALF) / CELL)));
      const cj = Math.max(0, Math.min(HN - 1, Math.floor((z.z + MAP_HALF) / CELL)));
      const c = cj * HN + ci;
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }
  // iterate zombie indices near (x,z) within r
  forNear(x, z, r, fn) {
    const zs = this.g.zombies;
    const i0 = Math.max(0, Math.floor((x - r + MAP_HALF) / CELL));
    const i1 = Math.min(HN - 1, Math.floor((x + r + MAP_HALF) / CELL));
    const j0 = Math.max(0, Math.floor((z - r + MAP_HALF) / CELL));
    const j1 = Math.min(HN - 1, Math.floor((z + r + MAP_HALF) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (let k = this.head[j * HN + i]; k >= 0; k = this.next[k]) {
          const e = zs[k];
          if (e) fn(e);
        }
      }
    }
  }

  // ---------------------------------------------------------------- main update
  update(dt) {
    const g = this.g;
    const humans = g.humans();
    this.humansCache = humans;
    this.rebuildHash();

    // flow fields: refresh 2 per tick round-robin
    if (humans.length) {
      for (let k = 0; k < Math.min(2, humans.length); k++) {
        const h = humans[this.fieldRR++ % humans.length];
        g.nav.computeField(h.id, h.state.x, h.state.z);
      }
    }

    // day population maintenance
    if (g.phase === PHASE.DAY) {
      this.maintainT -= dt;
      if (this.maintainT <= 0) {
        this.maintainT = 4;
        let alive = 0;
        for (const z of g.zombies) if (!z.dead && !z.horde) alive++;
        const target = Math.min(62, 22 + g.day * 4 + humans.length * 2);
        if (alive < target) this.spawnRoamer(humans);
      }
    }

    // horde stragglers stuck far from every survivor are brought back into the fight
    if ((g.phase === PHASE.NIGHT || g.escape.active) && g.tick % 40 === 0 && humans.length) {
      for (const z of g.zombies) {
        if (z.dead || !z.horde || z.boss) continue;
        let md = Infinity;
        for (const h of humans) md = Math.min(md, Math.hypot(h.state.x - z.x, h.state.z - z.z));
        if (md > 125) z.farT += 2;
        else z.farT = 0;
        if (z.farT > 14) {
          const sp = this.pickHordeSpawn(humans);
          if (sp) {
            z.x = sp.x;
            z.z = sp.z;
            z.y = groundAt(g.world, sp.x, sp.z, 200, 0.2, false) + (z.def.flying ? 4 : 0);
            z.vx = z.vz = z.vy = 0;
            z.state = 0;
            g.fillHistory(z);
          }
          z.farT = 0;
        }
      }
    }

    const zs = g.zombies;
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      if (z.dead) {
        z.deadT += dt;
        if (z.deadT > 1.6) {
          zs.splice(i, 1);
          g.removeEntity(z);
        }
        continue;
      }
      this.updateOne(z, dt, humans);
    }
  }

  updateOne(z, dt, humans) {
    const g = this.g;
    const def = z.def;
    const w = g.world;
    // timers
    z.attackCd -= dt;
    z.specialCd -= dt;
    z.rockCd -= dt;
    z.summonCd -= dt;
    z.targetT -= dt;
    z.aggroT -= dt;
    z.alertT -= dt;
    z.lureT -= dt;
    z.losT -= dt;
    if (z.animT > 0) z.animT -= dt;
    z.trapSlow = Math.min(1, z.trapSlow + dt * 2);

    // dawn: horde burns
    if (z.burning > 0) {
      z.burning -= dt;
      if (z.burning <= 0) z.onFire = true;
    }
    if (z.onFire) {
      const dmg = z.maxHp * (z.boss ? 0.035 : 0.35) * dt;
      if (g.tick % 6 === 0) g.impact(IMPACT.SPARK, z.x, z.y + 1, z.z);
      g.combat.damageZombie(z, dmg, null, { fire: true });
      if (z.dead) return;
    }

    // pending melee hit resolution
    if (z.pendingHit > 0) {
      z.pendingHit -= dt;
      if (z.pendingHit <= 0) this.resolveHit(z);
    }

    // retarget
    if (z.targetT <= 0) {
      z.targetT = 0.35 + g.rng() * 0.3;
      this.chooseTarget(z, humans);
    }
    const tp = z.target ? g.players.get(z.target) : null;
    const target = tp && tp.alive && !tp.zombie ? tp : null;
    if (!target) z.target = 0;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let dist = Infinity;
    if (target) {
      tx = target.state.x;
      ty = target.state.y;
      tz = target.state.z;
      dist = Math.hypot(tx - z.x, tz - z.z);
      if (z.losT <= 0) {
        z.losT = 0.3;
        z.los = this.hasLOS(z, tx, ty + 1.4, tz, dist);
      }
    }

    // type specific behaviour (may take over movement this tick)
    if (def.flying) return this.updateBat(z, dt, target, tx, ty, tz, dist);
    if (this.special(z, dt, target, tx, ty, tz, dist)) return;

    // ------------------------------------------------ desired direction
    let dx = 0;
    let dz = 0;
    let speed = def.speed;
    let chasing = false;
    if (z.lureT > 0 && !(target && dist < 7)) {
      dx = z.lureX - z.x;
      dz = z.lureZ - z.z;
      chasing = true;
    } else if (target) {
      chasing = true;
      // steer straight at a visible survivor; otherwise follow the flow field (around walls to a way in)
      if (z.los && dist < 12) {
        dx = tx - z.x;
        dz = tz - z.z;
      } else if (g.nav.flowDir(target.id, z.x, z.z, _dir)) {
        dx = _dir.x;
        dz = _dir.z;
      } else {
        dx = tx - z.x;
        dz = tz - z.z;
      }
      // spitters keep their distance
      if (z.ztype === ZTYPE.SPITTER && z.los && dist < 11) {
        const l = dist || 1;
        dx = -(tz - z.z) / l;
        dz = (tx - z.x) / l;
        speed *= 0.6;
      }
    } else if (z.alertT > 0) {
      dx = z.alertX - z.x;
      dz = z.alertZ - z.z;
      if (Math.hypot(dx, dz) < 3) z.alertT = 0;
      chasing = true;
      speed *= 0.8;
    } else {
      // wander
      z.wanderT -= dt;
      if (z.wanderT <= 0) {
        z.wanderT = 5 + g.rng() * 9;
        if (g.rng() < 0.4) {
          z.wanderX = z.x;
          z.wanderZ = z.z;
        } else {
          z.wanderX = z.x + (g.rng() - 0.5) * 30;
          z.wanderZ = z.z + (g.rng() - 0.5) * 30;
        }
      }
      dx = z.wanderX - z.x;
      dz = z.wanderZ - z.z;
      if (Math.hypot(dx, dz) < 1) {
        dx = 0;
        dz = 0;
      }
      speed = Math.min(speed, 1.1) * 0.8;
    }
    if (!chasing && z.ztype === ZTYPE.RUNNER) speed = 1.2;
    speed *= z.trapSlow;
    if ((g.phase === PHASE.NIGHT || g.escape.active) && z.horde) speed *= 1.06 + Math.min(0.2, 0.015 * g.day);

    // stop to attack
    let attacking = false;
    if (target && dist <= def.range + PLAYER_RADIUS && Math.abs(ty - z.y) < 2.3 && this.canReach(z, target)) {
      attacking = true;
      dx = tx - z.x;
      dz = tz - z.z;
      if (z.attackCd <= 0 && z.pendingHit <= 0) {
        z.attackCd = def.rate;
        z.pendingHit = 0.32;
        z.pendingKind = 1;
        z.pendingTarget = target.id;
        z.anim = ZANIM.ATTACK;
        z.animT = 0.6;
        if (g.rng() < 0.5) g.sound(z.ztype === ZTYPE.TANK ? SOUND.TANK_ROAR : SOUND.ZOMBIE_ATTACK, z.x, z.y + 1.6, z.z, 35);
      }
    }
    // boomer: detonate near humans
    if (z.ztype === ZTYPE.BOOMER && target && dist < 2.4 && z.state === 0) {
      z.state = 1;
      z.stateT = 0.55;
      z.stateAct = 99;
      z.anim = ZANIM.SPECIAL;
      g.sound(SOUND.BOOMER_GURGLE, z.x, z.y + 1.4, z.z, 30);
    }

    // detour when stuck
    if (z.detourT > 0) {
      z.detourT -= dt;
      dx = z.detourX;
      dz = z.detourZ;
    }
    let len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      dx /= len;
      dz /= len;
    }
    const moveSpeed = attacking ? 0 : len > 1e-4 ? speed : 0;

    this.integrate(z, dt, dx * moveSpeed, dz * moveSpeed, humans);

    // attack blocking structure
    if (!attacking && z.blockStruct && moveSpeed > 0 && def.structDmg > 0) {
      const s = g.ents[z.blockStruct];
      if (s && s.kind === ENT.STRUCTURE && z.attackCd <= 0 && z.pendingHit <= 0) {
        z.attackCd = def.rate;
        z.pendingHit = 0.35;
        z.pendingKind = 2;
        z.pendingTarget = s.id;
        z.anim = ZANIM.ATTACK;
        z.animT = 0.6;
      }
    } else if (!attacking && moveSpeed > 0) {
      // stuck detection
      const moved = Math.hypot(z.x - z.lastX, z.z - z.lastZ);
      if (moved < moveSpeed * dt * 0.2 && z.animT <= 0) z.stuckT += dt;
      else z.stuckT = Math.max(0, z.stuckT - dt * 0.5);
      if (z.stuckT > 0.8 && z.detourT <= 0) {
        z.stuckT = 0;
        z.detourT = 0.8 + g.rng() * 0.8;
        const side = g.rng() < 0.5 ? 1 : -1;
        z.detourX = -dz * side + dx * 0.2;
        z.detourZ = dx * side + dz * 0.2;
      }
    }
    z.lastX = z.x;
    z.lastZ = z.z;

    // facing & anim
    if (attacking || (target && dist < 4)) z.yaw = turn(z.yaw, Math.atan2(-(tx - z.x), -(tz - z.z)), dt * 8);
    else if (Math.hypot(z.vx, z.vz) > 0.2) z.yaw = turn(z.yaw, Math.atan2(-z.vx, -z.vz), dt * 5);
    if (z.animT <= 0) {
      const sp = Math.hypot(z.vx, z.vz);
      z.anim = sp > 3.2 ? ZANIM.RUN : sp > 0.25 ? ZANIM.WALK : !chasing && z.idleEat ? ZANIM.EAT : ZANIM.IDLE;
    }
  }

  chooseTarget(z, humans) {
    const g = this.g;
    const night = g.phase === PHASE.NIGHT;
    let best = null;
    let bd = Infinity;
    for (const h of humans) {
      const s = h.state;
      const d = Math.hypot(s.x - z.x, s.z - z.z);
      let range = z.horde ? 600 : night ? 55 : 26;
      if (h.downed) range *= 0.5;
      else if (s.crouch) range *= 0.6;
      if (night && h.flashlight) range *= 1.5;
      if (s.sprinting) range *= 1.3;
      if (z.aggroId === h.id && z.aggroT > 0) range = 600;
      if (z.target === h.id) range *= 1.6; // hysteresis
      if (d < range && d < bd) {
        bd = d;
        best = h;
      }
    }
    z.target = best ? best.id : 0;
  }

  hasLOS(z, tx, ty, tz, dist) {
    const ox = z.x;
    const oy = z.y + z.def.headY;
    const oz = z.z;
    let dx = tx - ox;
    let dy = ty - oy;
    let dz = tz - oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    raycastWorld(this.g.world, ox, oy, oz, dx, dy, dz, l - 0.5, _ray, COL.NOBLOCK | COL.NOBULLET);
    return _ray.t < 0;
  }

  // melee reach: a clear torso-to-torso line, so the dead can't swipe through walls, boarded doors
  // or waist-high barricades. Terrain is ignored so a bump in the ground never shields a downed survivor.
  canReach(z, p) {
    const s = p.state;
    const ox = z.x;
    const oy = z.y + z.def.height * 0.55;
    const oz = z.z;
    let dx = s.x - ox;
    let dy = s.y + (s.downed ? 0.3 : s.crouch ? 0.6 : 0.9) - oy;
    let dz = s.z - oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    raycastWorld(this.g.world, ox, oy, oz, dx, dy, dz, l, _ray);
    const c = _ray.col;
    // a survivor standing inside a gate / door boards they're squeezing through is still in reach
    return !c || (c.flags & COL.HUMANPASS && footprintContains(c, s.x, s.z));
  }

  integrate(z, dt, dvx, dvz, humans) {
    const g = this.g;
    const def = z.def;
    const accel = Math.min(1, dt * (def.speed > 4 ? 7 : 5));
    z.vx += (dvx - z.vx) * accel;
    z.vz += (dvz - z.vz) * accel;
    // separation
    const rad = def.radius;
    let sx = 0;
    let sz = 0;
    this.forNear(z.x, z.z, rad + 1.6, (o) => {
      if (o === z || o.dead || o.def.flying) return;
      const ddx = z.x - o.x;
      const ddz = z.z - o.z;
      const d2 = ddx * ddx + ddz * ddz;
      const min = (rad + o.def.radius) * 0.9;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (min - d) / min;
        sx += (ddx / d) * push;
        sz += (ddz / d) * push;
      }
    });
    const ox = z.x;
    const oz = z.z;
    _pos.x = z.x + (z.vx + sx * 2.2 + z.kx) * dt;
    _pos.y = z.y;
    _pos.z = z.z + (z.vz + sz * 2.2 + z.kz) * dt;
    z.kx *= 0.82;
    z.kz *= 0.82;
    // keep off players (players are not pushed - keeps client prediction exact)
    for (const h of humans) {
      const ddx = _pos.x - h.state.x;
      const ddz = _pos.z - h.state.z;
      const min = rad + PLAYER_RADIUS + 0.28;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < min * min && Math.abs(h.state.y - z.y) < 1.8) {
        const d = Math.sqrt(d2) || 0.01;
        _pos.x = h.state.x + (ddx / d) * min;
        _pos.z = h.state.z + (ddz / d) * min;
      }
    }
    const hit = resolveBody(g.world, _pos, Math.min(rad, 0.65), def.height, false);
    z.blockStruct = hit && hit.flags & COL.STRUCT ? hit.id : 0;
    if (g.world.isDeepWater(_pos.x, _pos.z)) {
      _pos.x = ox;
      _pos.z = oz;
    }
    const lim = MAP_HALF - 4;
    z.x = Math.max(-lim, Math.min(lim, _pos.x));
    z.z = Math.max(-lim, Math.min(lim, _pos.z));
    const gy = groundAt(g.world, z.x, z.z, z.y, 0.2, false);
    if (z.y > gy + 0.05) {
      z.vy -= GRAV * dt;
      z.y = Math.max(gy, z.y + z.vy * dt);
      if (z.y <= gy) z.vy = 0;
    } else {
      z.y = gy;
      z.vy = 0;
    }
  }

  resolveHit(z) {
    const g = this.g;
    const def = z.def;
    const dmgMul = 1 + 0.07 * (g.day - 1);
    if (z.pendingKind === 1) {
      const p = g.players.get(z.pendingTarget);
      if (!p || !p.alive || p.zombie) return;
      const s = p.state;
      const d = Math.hypot(s.x - z.x, s.z - z.z);
      if (d > def.range + PLAYER_RADIUS + 0.9 || Math.abs(s.y - z.y) > 2.5 || !this.canReach(z, p)) return;
      g.damagePlayer(p, def.dmg * dmgMul, { kind: KILLER.ZOMBIE, ztype: z.ztype, x: z.x, z: z.z });
      g.impact(IMPACT.BLOOD, s.x, s.y + 1.2, s.z);
      if (def.knock) this.knock(p, z.x, z.z, def.knock, 4, 0.35);
    } else if (z.pendingKind === 2) {
      const s = g.ents[z.pendingTarget];
      if (s && s.kind === ENT.STRUCTURE) g.damageStructure(s, def.structDmg * dmgMul);
    }
  }

  knock(p, fromX, fromZ, power, up, stun) {
    const s = p.state;
    let dx = s.x - fromX;
    let dz = s.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    s.vx += dx * power;
    s.vz += dz * power;
    s.vy = Math.max(s.vy, up);
    s.onGround = 0;
    s.stunT = Math.max(s.stunT, stun || 0);
  }

  releaseLink(z) {
    const g = this.g;
    if (!z.link) return;
    const p = g.players.get(z.link);
    if (p) {
      if (z.ztype === ZTYPE.LEAPER) p.state.pinned = 0;
      else p.state.pulled = 0;
      p.pinnedBy = 0;
      p.ropedBy = 0;
    }
    z.link = 0;
    z.linkDmg = 0;
    if (z.state === 3 && !z.dead) {
      // leaper hops off
      const yaw = z.yaw;
      z.vx = Math.sin(yaw) * 5;
      z.vz = Math.cos(yaw) * 5;
      z.vy = 5;
      z.state = 2;
      z.anim = ZANIM.AIRBORNE;
    } else if (z.state === 5 || z.state === 4) {
      z.state = 0;
      z.anim = ZANIM.IDLE;
      z.animT = 0;
    }
    z.specialCd = 6 + this.g.rng() * 3;
  }

  // ---------------------------------------------------------------- specials
  // returns true if the special fully handled this zombie's tick
  special(z, dt, target, tx, ty, tz, dist) {
    const g = this.g;
    const def = z.def;
    const t = z.ztype;
    const face = () => {
      if (target) z.yaw = turn(z.yaw, Math.atan2(-(tx - z.x), -(tz - z.z)), dt * 10);
    };
    const hold = () => {
      z.vx *= 0.7;
      z.vz *= 0.7;
      this.integrate(z, dt, 0, 0, this.humansCache);
    };

    // windup common: state 1
    if (z.state === 1) {
      z.stateT -= dt;
      z.anim = ZANIM.SPECIAL;
      face();
      hold();
      if (z.stateT <= 0) {
        z.state = 0;
        this.fireSpecial(z, target, tx, ty, tz, dist);
      }
      return true;
    }
    // leaper airborne / tank charge / pins / ropes
    if (z.state === 2) {
      z.anim = ZANIM.AIRBORNE;
      z.vy -= GRAV * dt;
      _pos.x = z.x + z.vx * dt;
      _pos.y = z.y;
      _pos.z = z.z + z.vz * dt;
      resolveBody(g.world, _pos, 0.35, 1.2, false);
      if (!g.world.isDeepWater(_pos.x, _pos.z)) {
        z.x = _pos.x;
        z.z = _pos.z;
      }
      z.y += z.vy * dt;
      const gy = groundAt(g.world, z.x, z.z, z.y, 0.2, false);
      // pounce on a human
      if (t === ZTYPE.LEAPER && z.vy < 3) {
        for (const h of this.humansCache) {
          const s = h.state;
          if (Math.hypot(s.x - z.x, s.z - z.z) < 1.5 && Math.abs(s.y + 0.8 - z.y) < 1.6 && !s.pinned && !s.pulled && this.canReach(z, h)) {
            z.state = 3;
            z.link = h.id;
            z.linkDmg = 0;
            z.linkT = 0;
            s.pinned = 1;
            s.vx = s.vz = 0;
            h.pinnedBy = z.id;
            g.sound(SOUND.LEAPER_SCREECH, z.x, z.y + 1, z.z, 40);
            g.damagePlayer(h, 10, { kind: KILLER.ZOMBIE, ztype: t, x: z.x, z: z.z });
            return true;
          }
        }
      }
      if (z.y <= gy) {
        z.y = gy;
        z.vy = 0;
        z.vx *= 0.3;
        z.vz *= 0.3;
        z.state = 0;
        z.anim = ZANIM.IDLE;
        z.animT = 0.3;
      }
      return true;
    }
    if (z.state === 3) {
      // pinning
      const p = g.players.get(z.link);
      if (!p || !p.alive || p.zombie) {
        this.releaseLink(z);
        return true;
      }
      const s = p.state;
      z.linkT += dt;
      z.x = s.x - Math.sin(s.yaw) * 0.55;
      z.z = s.z - Math.cos(s.yaw) * 0.55;
      z.y = s.y;
      z.yaw = s.yaw + Math.PI;
      z.anim = ZANIM.ATTACK;
      z.animT = 0.2;
      s.pinned = 1;
      if (z.attackCd <= 0) {
        z.attackCd = 0.45;
        g.damagePlayer(p, 5.5 * (1 + 0.05 * g.day), { kind: KILLER.ZOMBIE, ztype: t, x: z.x, z: z.z });
        g.impact(IMPACT.BLOOD, s.x, s.y + 1, s.z);
      }
      if (z.linkT > 5 || z.linkDmg > z.maxHp * 0.45) this.releaseLink(z);
      return true;
    }
    if (z.state === 4) {
      // rope in flight - stand and wait
      z.anim = ZANIM.SPECIAL;
      face();
      hold();
      z.stateT -= dt;
      if (z.stateT <= 0) z.state = 0;
      return true;
    }
    if (z.state === 5) {
      // pulling a victim
      const p = g.players.get(z.link);
      if (!p || !p.alive || p.zombie) {
        this.releaseLink(z);
        return true;
      }
      const s = p.state;
      z.linkT += dt;
      z.anim = ZANIM.SPECIAL;
      face();
      hold();
      s.pulled = 1;
      s.pullX = z.x;
      s.pullY = z.y;
      s.pullZ = z.z;
      const d = Math.hypot(s.x - z.x, s.z - z.z);
      if (d < 2 && z.attackCd <= 0 && this.canReach(z, p)) {
        z.attackCd = 0.5;
        g.damagePlayer(p, 6 * (1 + 0.05 * g.day), { kind: KILLER.ZOMBIE, ztype: t, x: z.x, z: z.z });
      }
      if (z.losT <= 0) {
        z.losT = 0.3;
        z.los = this.hasLOS(z, s.x, s.y + 1.2, s.z, d);
        if (!z.los) z.linkT += 3;
      }
      if (z.linkT > 9 || z.linkDmg > 55) this.releaseLink(z);
      return true;
    }
    if (z.state === 6) {
      // tank charge
      z.stateT -= dt;
      z.anim = ZANIM.RUN;
      _pos.x = z.x + z.chargeX * 10 * dt;
      _pos.y = z.y;
      _pos.z = z.z + z.chargeZ * 10 * dt;
      const hit = resolveBody(g.world, _pos, 0.65, 2.5, false);
      z.x = _pos.x;
      z.z = _pos.z;
      z.y = groundAt(g.world, z.x, z.z, z.y, 0.2, false);
      z.vx = z.chargeX * 10;
      z.vz = z.chargeZ * 10;
      let end = z.stateT <= 0;
      if (hit && hit.flags & COL.STRUCT) {
        const s = g.ents[hit.id];
        if (s) g.damageStructure(s, 700);
        g.sound(SOUND.SLAM, z.x, z.y, z.z, 60);
        end = true;
      } else if (hit) end = true;
      for (const h of this.humansCache) {
        const s = h.state;
        if (Math.hypot(s.x - z.x, s.z - z.z) < 1.8 && Math.abs(s.y - z.y) < 2 && this.canReach(z, h)) {
          g.damagePlayer(h, 32, { kind: KILLER.ZOMBIE, ztype: t, x: z.x, z: z.z });
          this.knock(h, z.x, z.z, 15, 6, 0.8);
          end = true;
        }
      }
      if (end) {
        z.state = 0;
        z.vx = z.vz = 0;
        z.specialCd = 8 + g.rng() * 4;
      }
      return true;
    }
    if (z.state === 7) return false;

    // ---- trigger specials (state 0)
    if (!target) return false;
    const windup = (time, act, snd) => {
      z.state = 1;
      z.stateT = time;
      z.stateAct = act;
      z.anim = ZANIM.SPECIAL;
      if (snd) g.sound(snd, z.x, z.y + def.headY, z.z, t >= ZTYPE.BOSS_ABOMINATION ? 120 : 45);
    };
    switch (t) {
      case ZTYPE.SPITTER:
        if (z.specialCd <= 0 && z.los && dist < def.spitRange && dist > 4) {
          windup(0.6, 1, SOUND.SPITTER_SPIT);
          return true;
        }
        break;
      case ZTYPE.LEAPER:
        if (z.specialCd <= 0 && z.los && dist < def.leapRange && dist > 3.5 && z.vy === 0) {
          windup(0.5, 2, SOUND.LEAPER_SCREECH);
          return true;
        }
        break;
      case ZTYPE.ROPER:
        if (z.specialCd <= 0 && z.los && dist < def.ropeRange && dist > 5 && !target.state.pulled && !target.state.pinned) {
          windup(0.7, 3, SOUND.ROPER_SHOOT);
          return true;
        }
        break;
      case ZTYPE.TANK:
        if (z.specialCd <= 0 && z.los && dist > 7 && dist < 24) {
          windup(0.9, 4, SOUND.TANK_ROAR);
          return true;
        }
        break;
      case ZTYPE.BOSS_ABOMINATION:
        if (z.specialCd <= 0 && dist < 7) {
          windup(1.0, 5, SOUND.BOSS_ROAR);
          return true;
        }
        if (z.rockCd <= 0 && z.los && dist > 10 && dist < 48) {
          windup(0.9, 6, null);
          return true;
        }
        break;
      case ZTYPE.BOSS_HIVEQUEEN:
        if (z.specialCd <= 0 && z.los && dist < def.spitRange) {
          windup(0.8, 7, SOUND.BOSS_ROAR);
          return true;
        }
        if (z.summonCd <= 0 && g.zombies.length < 125) {
          z.summonCd = 14;
          for (let i = 0; i < 3; i++) this.spawn(ZTYPE.BAT, z.x + (g.rng() - 0.5) * 3, z.z + (g.rng() - 0.5) * 3, { horde: true });
          g.sound(SOUND.BAT_SCREECH, z.x, z.y + 3, z.z, 60);
        }
        break;
    }
    return false;
  }

  fireSpecial(z, target, tx, ty, tz, dist) {
    const g = this.g;
    const def = z.def;
    const c = g.combat;
    switch (z.stateAct) {
      case 1: {
        // spit acid
        if (!target) return;
        const s = target.state;
        const T = Math.max(0.6, dist / 15);
        c.lob(PROJ.ACID, z, z.x, z.y + def.headY, z.z, s.x + s.vx * T * 0.5, s.y + 0.3, s.z + s.vz * T * 0.5, T, 12);
        z.specialCd = def.spitRate + g.rng() * 2;
        break;
      }
      case 2: {
        // leap
        if (!target) return;
        const s = target.state;
        const T = Math.max(0.45, Math.min(1.1, dist / 11));
        const aimX = s.x + s.vx * T * 0.4;
        const aimZ = s.z + s.vz * T * 0.4;
        z.vx = (aimX - z.x) / T;
        z.vz = (aimZ - z.z) / T;
        z.vy = (s.y + 0.6 - z.y + 0.5 * GRAV * T * T) / T;
        z.state = 2;
        z.anim = ZANIM.AIRBORNE;
        z.specialCd = 5 + g.rng() * 3;
        g.sound(SOUND.LEAP, z.x, z.y + 1, z.z, 30);
        break;
      }
      case 3: {
        // rope
        if (!target) return;
        const s = target.state;
        c.rope(z, s.x, s.y + 1.2, s.z, target.id);
        z.state = 4;
        z.stateT = (dist + 3) / 30 + 0.2;
        z.specialCd = 4;
        break;
      }
      case 4: {
        // tank charge
        if (!target) return;
        const l = Math.hypot(tx - z.x, tz - z.z) || 1;
        z.chargeX = (tx - z.x) / l;
        z.chargeZ = (tz - z.z) / l;
        z.state = 6;
        z.stateT = 1.7;
        break;
      }
      case 5: {
        // abomination ground slam
        g.sound(SOUND.SLAM, z.x, z.y, z.z, 150);
        g.emit(
          (w) => {
            w.u8(EVT.EXPLOSION);
            w.i16(qpos(z.x));
            w.i16(qpos(z.y));
            w.i16(qpos(z.z));
            w.u8(70);
            w.u8(1); // slam (dust, no fire)
          },
          { x: z.x, z: z.z, r: 200 },
        );
        for (const h of this.humansCache) {
          const s = h.state;
          const d = Math.hypot(s.x - z.x, s.z - z.z);
          if (d < 7.5 && Math.abs(s.y - z.y) < 3) {
            g.damagePlayer(h, 12 + 38 * (1 - d / 7.5), { kind: KILLER.ZOMBIE, ztype: z.ztype, x: z.x, z: z.z });
            this.knock(h, z.x, z.z, 12, 7, 0.6);
          }
        }
        for (const s of [...g.structures]) {
          const d = Math.hypot(s.x - z.x, s.z - z.z);
          if (d < 6.5) g.damageStructure(s, 450 * (1 - d / 8));
        }
        z.specialCd = 5 + g.rng() * 2;
        break;
      }
      case 6: {
        // boulder throw
        if (!target) return;
        const s = target.state;
        const T = Math.max(0.8, dist / 18);
        c.lob(PROJ.ROCK, z, z.x, z.y + 3.8, z.z, s.x + s.vx * T * 0.6, s.y, s.z + s.vz * T * 0.6, T, GRAV);
        z.rockCd = 6 + g.rng() * 2;
        break;
      }
      case 7: {
        // hive queen acid barrage
        if (!target) return;
        const s = target.state;
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.14;
          const dx = s.x - z.x;
          const dz = s.z - z.z;
          const rx = dx * Math.cos(a) - dz * Math.sin(a);
          const rz = dx * Math.sin(a) + dz * Math.cos(a);
          const T = Math.max(0.7, dist / 16) * (1 + Math.abs(i) * 0.05);
          c.lob(PROJ.ACID, z, z.x, z.y + def.headY, z.z, z.x + rx, s.y, z.z + rz, T, 12);
        }
        z.specialCd = def.spitRate + 2 + g.rng() * 2;
        break;
      }
      case 99:
        // boomer detonation
        g.combat.killZombie(z, null, { explode: true });
        break;
    }
  }

  // ---------------------------------------------------------------- bats
  updateBat(z, dt, target, tx, ty, tz, dist) {
    const g = this.g;
    const def = z.def;
    const time = g.time + z.variant;
    let gx;
    let gy;
    let gz;
    const ground = g.world.heightAt(z.x, z.z);
    if (z.state === 7) {
      z.stateT -= dt;
      if (z.stateT <= 0) z.state = 0;
    }
    if (target && z.state !== 7) {
      const d3 = Math.hypot(tx - z.x, ty + 1.3 - z.y, tz - z.z);
      gx = tx + Math.sin(time * 2.1) * 1.5;
      gz = tz + Math.cos(time * 1.7) * 1.5;
      gy = d3 < 8 ? ty + 1.3 : Math.max(ty + 3, ground + 3.5);
      if (d3 < 1.6 && z.attackCd <= 0 && this.canReach(z, target)) {
        z.attackCd = def.rate + g.rng() * 0.5;
        z.anim = ZANIM.ATTACK;
        z.animT = 0.4;
        g.damagePlayer(target, def.dmg * (1 + 0.05 * g.day), { kind: KILLER.ZOMBIE, ztype: z.ztype, x: z.x, z: z.z });
        g.sound(SOUND.BAT_SCREECH, z.x, z.y, z.z, 30);
        z.state = 7;
        z.stateT = 0.8 + g.rng() * 0.8;
        const a = g.rng() * Math.PI * 2;
        z.detourX = Math.sin(a);
        z.detourZ = Math.cos(a);
      }
    } else if (z.state === 7) {
      gx = z.x + z.detourX * 10;
      gz = z.z + z.detourZ * 10;
      gy = ground + 6;
    } else {
      // circle
      const c = { x: z.wanderX, z: z.wanderZ };
      gx = c.x + Math.sin(time * 0.4) * 20;
      gz = c.z + Math.cos(time * 0.4) * 20;
      gy = ground + 7 + Math.sin(time) * 2;
    }
    let dx = gx - z.x;
    let dy = gy - z.y;
    let dz = gz - z.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = def.speed * (z.state === 7 ? 1.2 : 1);
    const k = Math.min(1, dt * 3);
    z.vx += ((dx / l) * sp - z.vx) * k;
    z.vy += ((dy / l) * sp - z.vy) * k;
    z.vz += ((dz / l) * sp - z.vz) * k;
    z.x += z.vx * dt;
    z.y += z.vy * dt + Math.sin(time * 9) * 0.03;
    z.z += z.vz * dt;
    const lim = MAP_HALF - 4;
    z.x = Math.max(-lim, Math.min(lim, z.x));
    z.z = Math.max(-lim, Math.min(lim, z.z));
    const gr = g.world.heightAt(z.x, z.z);
    if (z.y < gr + 0.6) z.y = gr + 0.6;
    if (Math.hypot(z.vx, z.vz) > 0.3) z.yaw = turn(z.yaw, Math.atan2(-z.vx, -z.vz), dt * 6);
    if (z.animT <= 0) z.anim = ZANIM.WALK;
  }
}

function turn(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > maxStep) d = maxStep;
  if (d < -maxStep) d = -maxStep;
  return a + d;
}

export { STRUCT_DEFS, EYE_HEIGHT };
