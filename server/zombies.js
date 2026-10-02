// Zombie AI: targeting, flow-field navigation, melee, structure breaking, and special abilities
// (spitter acid, leaper pounce/pin, roper rope-pull, boomer explosion, bat swarms, tank charge, bosses,
// zombie dog packs that den in the thick woods, flank and lunge, the shade that only moves in darkness).
// The herd that wanders the roads by day is in herd.js.
import { MAP_HALF, PHASE, PLAYER_RADIUS, EYE_HEIGHT, MAX_ENTITIES, HORDE_SPAWN_MIN, HORDE_SPAWN_MAX, FLASHLIGHT_RANGE, FLASHLIGHT_CONE, FIRE_LIGHT_MARGIN, NOISE_RUSH, NOISE_SPEED_MIN, NOISE_MEMORY, NOISE_MEMORY_MAX } from '../shared/constants.js';
import { ZTYPE, ZOMBIE_DEFS, ZANIM, SOUND, KILLER, PROJ, AREA, EVT, IMPACT, ITEM, STRUCT_DEFS, THROWABLES, ZONE, BURN } from '../shared/defs.js';
import { ENT, qpos } from '../shared/protocol.js';
import { resolveBody, groundAt, raycastWorld, footprintContains, COL } from '../shared/collision.js';
import { eyeHeight } from '../shared/playersim.js';
import { Herds, HERD_RUSH } from './herd.js';

const GRAV = 16;
const CELL = 4;
const HN = Math.ceil((MAP_HALF * 2) / CELL);
// forest: trees are counted per FCELL m cell; a spot's density is the tree count of the 3x3 cells around it
const FCELL = 8;
const FN = Math.ceil((MAP_HALF * 2) / FCELL);
const FOREST_DENS = 13; // ~ the densest 20% of the woods (median 9 trees per 24 m square)
const _pos = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, z: 0, cost: 0 };
const _ray = { t: -1, col: null, terrain: false };
const SHADE_THAW = 0.15; // unbroken darkness (s) before a lit shade moves again, so a beam flickering across it still holds it
const BEAM_TAN = Math.tan(FLASHLIGHT_CONE);
const BODY_AT = [0.9, 0.55, 0.2]; // head, chest, shins (fractions of the body height) - light on any of them counts

export class Zombies {
  constructor(game) {
    this.g = game;
    this.head = new Int32Array(HN * HN).fill(-1);
    this.next = new Int32Array(MAX_ENTITIES).fill(-1);
    this.fieldRR = 0;
    this.maintainT = 0;
    this.humansCache = [];
    this.lights = []; // this tick's burning point lights, flat [x, y, z, radius, ...]
    this.lightTick = -1;
    this.packSeq = 0;
    this.treeGrid = null;
    this.dens = null;
    this.herds = new Herds(game, this);
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
      alertLvl: 0, // how loud the noise it is heading for was where it stood (m of carry left)
      alertRush: 1, // 0 ambling over .. 1 at a full run
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
      direct: false,
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
      idleEat: g.rng() < (def.pack ? 0.5 : 0.25),
      pack: def.pack ? opts.pack || this.newPack() : 0, // dogs: pack id (packmates share a target)
      homeX: x, // dogs: the den they roam around by day
      homeZ: z,
      flank: def.pack ? (g.rng() - 0.5) * 1.5 : 0, // dogs: approach angle offset (rad) so a pack fans out
      howlT: 0,
      bit: false, // dogs: this lunge already bit someone
      herd: 0, // wandering herd it walks with (herd.js)
      herdX: 0, // its place in the crowd, relative to the herd's waypoint
      herdZ: 0,
      herdNav: 0,
      farT: 0,
      dead: false,
      deadT: 0,
      burning: 0,
      onFire: false,
      burnT: 0, // set alight (Combat.ignite): seconds of burning left
      burnBy: 0, // player who lit it (gets the kill)
      burnWeapon: 0,
      lit: false, // shade: frozen by light
      darkT: 1,
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
    // zombie dog packs in the thick woods
    for (let i = 0; i < 3; i++) this.spawnForestPack([]);
    // a herd wandering the roads
    this.herds.reset();
    this.herds.spawn([]);
  }

  newPack() {
    this.packSeq = (this.packSeq % 0xffffff) + 1;
    return this.packSeq;
  }

  // n dogs around a den, spread over the pack's flanks
  spawnPack(x, z, n, opts = {}) {
    const g = this.g;
    const pack = this.newPack();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + g.rng();
      const r = 1 + g.rng() * 2.5;
      const d = this.spawn(ZTYPE.DOG, x + Math.sin(a) * r, z + Math.cos(a) * r, { ...opts, pack });
      if (!d) continue;
      d.homeX = x;
      d.homeZ = z;
      if (n > 1) d.flank = (i / (n - 1) - 0.5) * 1.5;
      k++;
    }
    return k;
  }

  // a pack at a forest den out of sight of every survivor (and away from the car and other packs)
  spawnForestPack(humans) {
    const g = this.g;
    const dens = this.forestDens();
    if (!dens.length) return 0;
    const car = g.world.car;
    for (let tries = 0; tries < 12; tries++) {
      const d = dens[Math.floor(g.rng() * dens.length)];
      if (Math.hypot(d.x - car.x, d.z - car.z) < 80) continue;
      let ok = true;
      for (const h of humans) if (Math.hypot(h.state.x - d.x, h.state.z - d.z) < 80) ok = false;
      if (!ok) continue;
      for (const o of g.zombies) if (o.pack && !o.dead && Math.hypot(o.homeX - d.x, o.homeZ - d.z) < 40) ok = false;
      if (!ok) continue;
      const n = 2 + Math.floor(g.rng() * (g.day >= 3 ? 3 : g.day >= 2 ? 2 : 1));
      return this.spawnPack(d.x, d.z, n, { hpMul: 1 + 0.05 * g.day });
    }
    return 0;
  }

  // ---------------------------------------------------------------- forest
  // trees in the 24 m square around (x,z)
  forestAt(x, z) {
    if (!this.treeGrid) {
      const t = this.g.world.trees;
      this.treeGrid = new Uint16Array(FN * FN);
      for (let i = 0; i < t.length; i += 6) {
        const ci = Math.max(0, Math.min(FN - 1, Math.floor((t[i] + MAP_HALF) / FCELL)));
        const cj = Math.max(0, Math.min(FN - 1, Math.floor((t[i + 2] + MAP_HALF) / FCELL)));
        this.treeGrid[cj * FN + ci]++;
      }
    }
    const ci = Math.floor((x + MAP_HALF) / FCELL);
    const cj = Math.floor((z + MAP_HALF) / FCELL);
    let n = 0;
    for (let j = Math.max(0, cj - 1); j <= Math.min(FN - 1, cj + 1); j++) {
      for (let i = Math.max(0, ci - 1); i <= Math.min(FN - 1, ci + 1); i++) n += this.treeGrid[j * FN + i];
    }
    return n;
  }

  // walkable spots in dense forest, away from places and roads (built once per world)
  forestDens() {
    if (this.dens) return this.dens;
    const g = this.g;
    const w = g.world;
    const out = [];
    const lim = MAP_HALF - 24;
    for (let z = -lim; z <= lim; z += 12) {
      for (let x = -lim; x <= lim; x += 12) {
        if (this.forestAt(x, z) < FOREST_DENS) continue;
        if (w.zoneAt(x, z) !== ZONE.FOREST || w.roadDistAt(x, z) < 10) continue;
        if (w.isDeepWater(x, z) || g.nav.isBlocked(x, z)) continue;
        out.push({ x, z });
      }
    }
    this.dens = out;
    return out;
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
  // (forest: the most wooded of the candidates - dog packs come out of the trees)
  pickSpawnAround(x, z, humans, minD = HORDE_SPAWN_MIN, maxD = HORDE_SPAWN_MAX, forest = false) {
    const g = this.g;
    const w = g.world;
    const lim = MAP_HALF - 14;
    let best = null;
    let bestF = -1;
    for (let tries = 0; tries < 18; tries++) {
      const a = g.rng() * Math.PI * 2;
      const d = minD + g.rng() * (maxD - minD);
      const sx = x + Math.sin(a) * d;
      const sz = z + Math.cos(a) * d;
      if (Math.abs(sx) > lim || Math.abs(sz) > lim) continue;
      if (w.isDeepWater(sx, sz) || g.nav.isBlocked(sx, sz)) continue;
      let ok = true;
      for (const h of humans) if (Math.hypot(h.state.x - sx, h.state.z - sz) < minD * 0.75) ok = false;
      if (!ok) continue;
      if (!forest) return { x: sx, z: sz };
      const f = this.forestAt(sx, sz);
      if (f > bestF) {
        bestF = f;
        best = { x: sx, z: sz };
      }
      if (f >= FOREST_DENS) break;
    }
    return best || this.pickSpawnPoint(humans, minD);
  }

  // the night horde comes to wherever the survivors are
  pickHordeSpawn(humans, forest = false) {
    const g = this.g;
    if (!humans.length) return this.pickSpawnPoint(humans, 0);
    const h = humans[Math.floor(g.rng() * humans.length)];
    return this.pickSpawnAround(h.state.x, h.state.z, humans, HORDE_SPAWN_MIN, HORDE_SPAWN_MAX, forest);
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

  // ---------------------------------------------------------------- noise
  // A noise at (x,z) that carries `loud` metres. Every zombie inside that radius with nobody to chase heads for
  // it, so a louder noise draws a bigger crowd, and the louder it was where a zombie stood the harder it runs.
  // A much fainter noise does not pull a zombie off the one it is already heading for. Returns how many heard it.
  noise(x, z, loud) {
    const g = this.g;
    let heard = 0;
    let calls = 0;
    for (const e of g.zombies) {
      if (e.dead || e.target || e.def.flying) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      const lvl = loud - d; // how much further the noise would have carried past this zombie
      if (lvl <= 0) continue;
      const fresh = e.alertT <= 0;
      if (!fresh && lvl < e.alertLvl * 0.5) continue;
      const rush = Math.min(1, lvl / NOISE_RUSH);
      // it only knows roughly where the noise came from: the crowd spreads out over the spot instead of stacking on it
      const off = Math.min(5, 1 + d * 0.06);
      e.alertX = x + (g.rng() - 0.5) * 2 * off;
      e.alertZ = z + (g.rng() - 0.5) * 2 * off;
      e.alertLvl = lvl;
      e.alertRush = rush;
      e.alertT = Math.min(NOISE_MEMORY_MAX, NOISE_MEMORY + d / (e.def.speed * (NOISE_SPEED_MIN + (1 - NOISE_SPEED_MIN) * rush)));
      heard++;
      // a couple of them answer: the survivors hear what they woke
      if (fresh && calls < 2 && rush > 0.3 && g.rng() < 0.5) {
        calls++;
        g.sound(e.ztype === ZTYPE.RUNNER ? SOUND.RUNNER_SCREAM : e.ztype === ZTYPE.DOG ? SOUND.DOG_BARK : e.ztype === ZTYPE.TANK ? SOUND.TANK_ROAR : SOUND.ZOMBIE_GROWL, e.x, e.y + e.def.headY, e.z, 70);
      }
    }
    return heard;
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

    // day population maintenance (not during the final stand: its zombies are counted, and need the room under the cap)
    if (g.phase === PHASE.DAY && !g.escape.active) {
      this.maintainT -= dt;
      if (this.maintainT <= 0) {
        this.maintainT = 4;
        let alive = 0;
        let dogs = 0;
        for (const z of g.zombies) {
          if (z.dead || z.horde) continue;
          if (z.pack) dogs++;
          else if (!z.herd) alive++;
        }
        const target = Math.min(62, 22 + g.day * 4 + humans.length * 2);
        if (alive < target) this.spawnRoamer(humans);
        if (dogs < Math.min(18, 4 + g.day * 2)) this.spawnForestPack(humans);
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

    this.herds.update(dt, humans);

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
    z.howlT -= dt;
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
    // set alight (Combat.ignite): it keeps burning for a while after the fire that lit it
    if (z.burnT > 0) {
      z.burnT -= dt;
      g.combat.damageZombie(z, BURN.dps * dt, g.players.get(z.burnBy) || null, { weapon: z.burnWeapon, fire: true, dot: true });
      if (z.dead) return;
    }

    // the shade only moves in darkness: any light on it and it stands frozen where it was caught
    if (def.shade && this.holdShade(z, dt)) return;

    // pending melee hit resolution
    if (z.pendingHit > 0) {
      z.pendingHit -= dt;
      if (z.pendingHit <= 0) this.resolveHit(z);
    }

    // retarget
    if (z.targetT <= 0) {
      z.targetT = 0.35 + g.rng() * 0.3;
      const had = z.target;
      this.chooseTarget(z, humans);
      if (z.pack && z.target && !had) this.alertPack(z);
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
        // seeing a survivor through a window is not a way in: walk straight only when no wall is in between
        z.direct = z.los && dist < (z.pack ? 18 : 12) && g.nav.segClear(z.x, z.z, tx, tz);
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
    if (z.state === 7) {
      // dog hit-and-run: peel off to one side after a lunge, then come back in
      z.stateT -= dt;
      if (z.stateT <= 0 || !target) z.state = 0;
      if (target) {
        const l = dist || 1;
        const side = z.flank >= 0 ? 1 : -1;
        dx = (-(tz - z.z) * side - (tx - z.x) * 0.5) / l;
        dz = ((tx - z.x) * side - (tz - z.z) * 0.5) / l;
        chasing = true;
      }
    } else if (z.lureT > 0 && !def.shade && !(target && dist < 7)) {
      dx = z.lureX - z.x;
      dz = z.lureZ - z.z;
      chasing = true;
    } else if (target) {
      chasing = true;
      if (z.herd) speed = Math.max(speed, HERD_RUSH); // a roused herd comes at a run, walkers and all
      // steer straight at a visible survivor; otherwise follow the flow field (around walls to a way in)
      if (z.pack && z.direct && dist < 18) {
        // a pack fans out and closes in from the sides, straightening up for the last few metres
        const a = z.flank * Math.min(1, Math.max(0, (dist - 3) / 8));
        const ex = tx - z.x;
        const ez = tz - z.z;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        dx = ex * c - ez * sn;
        dz = ex * sn + ez * c;
      } else if (z.direct && dist < 12) {
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
    } else if (z.herd) {
      // wandering herd: it keeps its place in the crowd, at a shuffle or (the herd roused) at a run
      speed = this.herds.steer(z, dt, _dir);
      dx = _dir.x;
      dz = _dir.z;
      chasing = speed >= HERD_RUSH;
    } else if (z.alertT > 0) {
      dx = z.alertX - z.x;
      dz = z.alertZ - z.z;
      if (Math.hypot(dx, dz) < 3) z.alertT = 0;
      chasing = true;
      speed *= NOISE_SPEED_MIN + (1 - NOISE_SPEED_MIN) * z.alertRush;
      // whether it gets there or gives up, it mills about where the noise led it instead of trekking back
      z.wanderX = z.x;
      z.wanderZ = z.z;
      z.wanderT = 3;
    } else {
      // wander
      z.wanderT -= dt;
      if (z.wanderT <= 0) {
        z.wanderT = 5 + g.rng() * 9;
        if (g.rng() < 0.4) {
          z.wanderX = z.x;
          z.wanderZ = z.z;
        } else if (z.pack && !z.horde) {
          // dogs keep to their patch of woods
          const a = g.rng() * Math.PI * 2;
          const r = g.rng() * 16;
          z.wanderX = z.homeX + Math.sin(a) * r;
          z.wanderZ = z.homeZ + Math.cos(a) * r;
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
      speed = z.pack ? 1.5 : Math.min(speed, 1.1) * 0.8;
    }
    if (!chasing && z.ztype === ZTYPE.RUNNER && !z.herd) speed = 1.2;
    speed *= z.trapSlow;
    if ((g.phase === PHASE.NIGHT || g.escape.active) && z.horde) speed *= 1.06 + Math.min(0.2, 0.015 * g.day);

    // stop to attack
    let attacking = false;
    if (target && z.state !== 7 && dist <= def.range + PLAYER_RADIUS && Math.abs(ty - z.y) < 2.3 && this.canReach(z, target)) {
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
        if (g.rng() < 0.5) g.sound(z.ztype === ZTYPE.TANK ? SOUND.TANK_ROAR : z.ztype === ZTYPE.DOG ? SOUND.DOG_SNARL : SOUND.ZOMBIE_ATTACK, z.x, z.y + Math.min(1.6, def.height), z.z, 35);
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
    if ((attacking || (target && dist < 4)) && z.state !== 7) z.yaw = turn(z.yaw, Math.atan2(-(tx - z.x), -(tz - z.z)), dt * 8);
    else if (Math.hypot(z.vx, z.vz) > 0.2) z.yaw = turn(z.yaw, Math.atan2(-z.vx, -z.vz), dt * 5);
    if (z.animT <= 0) {
      // hysteresis: a speed hovering at a threshold (crowd shoves, easing into an attack) must not flicker the gait
      const sp = Math.hypot(z.vx, z.vz);
      const was = z.anim;
      const run = sp > (was === ZANIM.RUN ? 2.7 : 3.2);
      const walk = sp > (was === ZANIM.WALK || was === ZANIM.RUN ? 0.12 : 0.3);
      z.anim = run ? ZANIM.RUN : walk ? ZANIM.WALK : !chasing && z.idleEat ? ZANIM.EAT : ZANIM.IDLE;
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
      if (!z.horde && z.def.sense) range *= z.def.sense; // dogs catch the scent from further off
      if (z.aggroId === h.id && z.aggroT > 0) range = 600;
      if (z.target === h.id) range *= 1.6; // hysteresis
      if (d < range && d < bd) {
        bd = d;
        best = h;
      }
    }
    z.target = best ? best.id : 0;
  }

  // a dog that picks up a scent sets the rest of its pack onto the same survivor (and howls, once)
  alertPack(z) {
    const g = this.g;
    let howl = z.howlT <= 0;
    this.forNear(z.x, z.z, 45, (o) => {
      if (o === z || o.dead || o.pack !== z.pack) return;
      if (o.howlT > 0) howl = false;
      if (!o.target) {
        o.target = z.target;
        o.aggroId = z.target;
        o.aggroT = 12;
      }
    });
    if (howl) {
      z.howlT = 25;
      g.sound(SOUND.DOG_HOWL, z.x, z.y + 0.7, z.z, 110);
    }
  }

  hasLOS(z, tx, ty, tz, dist) {
    return this.clearLine(z.x, z.y + z.def.headY, z.z, tx, ty, tz);
  }

  // nothing solid (walls, structures, trees, terrain) on the straight line between two points
  clearLine(ox, oy, oz, tx, ty, tz) {
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

  // ---------------------------------------------------------------- light (what pins a shade)
  // every burning point light this tick: torches, campfires, road flares, burning ground
  lightSources() {
    const g = this.g;
    const out = this.lights;
    if (this.lightTick === g.tick) return out;
    this.lightTick = g.tick;
    out.length = 0;
    for (const s of g.structures) {
      const def = STRUCT_DEFS[s.stype];
      if (def.light && s.burnLeft > 0) out.push(s.x, s.y + def.sy, s.z, def.light);
    }
    for (const e of g.projectiles) if (e.ptype === PROJ.FLARE) out.push(e.x, e.y + 0.35, e.z, THROWABLES[ITEM.FLARE].light);
    for (const a of g.areas) if (a.atype === AREA.FIRE) out.push(a.x, a.y + 0.6, a.z, a.radius + FIRE_LIGHT_MARGIN);
    return out;
  }

  // Is there light on this zombie? Daylight, a burning torch / campfire / flare / fire close enough, or a survivor's
  // flashlight beam. Walls, trees and hills cast shadows: the light needs a clear line to some part of the body.
  isLit(z) {
    const g = this.g;
    if (g.phase !== PHASE.NIGHT) return true;
    const h = z.def.height;
    const lights = this.lightSources();
    for (let i = 0; i < lights.length; i += 4) {
      const lx = lights[i];
      const ly = lights[i + 1];
      const lz = lights[i + 2];
      const r = lights[i + 3];
      if ((z.x - lx) ** 2 + (z.y + h * 0.5 - ly) ** 2 + (z.z - lz) ** 2 > r * r) continue;
      for (let k = 0; k < BODY_AT.length; k++) if (this.clearLine(lx, ly, lz, z.x, z.y + h * BODY_AT[k], z.z)) return true;
    }
    for (const p of this.humansCache) {
      if (!p.flashlight) continue;
      const s = p.state;
      const ox = s.x;
      const oy = s.y + eyeHeight(s);
      const oz = s.z;
      const cp = Math.cos(s.pitch);
      const fx = -Math.sin(s.yaw) * cp;
      const fy = Math.sin(s.pitch);
      const fz = -Math.cos(s.yaw) * cp;
      for (let k = 0; k < BODY_AT.length; k++) {
        const ty = z.y + h * BODY_AT[k];
        const dx = z.x - ox;
        const dy = ty - oy;
        const dz = z.z - oz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > FLASHLIGHT_RANGE * FLASHLIGHT_RANGE) continue;
        // inside the beam's cone, allowing for the width of the body
        const along = dx * fx + dy * fy + dz * fz;
        if (along <= 0 || Math.sqrt(Math.max(0, d2 - along * along)) > along * BEAM_TAN + z.def.radius) continue;
        if (this.clearLine(ox, oy, oz, z.x, ty, z.z)) return true;
      }
    }
    return false;
  }

  // Shade: returns true while light pins it (it does nothing else this tick). Bodies part around it like a post,
  // blows don't move it, and a swing it had started is lost.
  holdShade(z, dt) {
    if (this.isLit(z)) z.darkT = 0;
    else z.darkT += dt;
    const was = z.lit;
    z.lit = z.darkT < SHADE_THAW;
    if (!z.lit) {
      if (was) z.targetT = 0; // the light is gone: straight back on the hunt
      return false;
    }
    z.vx = z.vz = 0;
    z.kx = z.kz = 0;
    z.pendingHit = 0;
    z.stuckT = 0;
    z.detourT = 0;
    z.anim = ZANIM.FROZEN;
    z.animT = 0;
    // caught off the ground (a ledge, a broken floor): it still drops
    const gy = groundAt(this.g.world, z.x, z.z, z.y, 0.2, false);
    if (z.y > gy + 0.05) {
      z.vy -= GRAV * dt;
      z.y = Math.max(gy, z.y + z.vy * dt);
    } else {
      z.y = gy;
      z.vy = 0;
    }
    return true;
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
    const hit = resolveBody(g.world, _pos, def.moveR ?? Math.min(rad, 0.65), def.moveH ?? def.height, false);
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
      if (def.lungeRange && z.state === 0 && g.rng() < 0.3) {
        // dog hit-and-run: snap, peel away, come back in with a lunge
        z.state = 7;
        z.stateT = 0.6 + g.rng() * 0.5;
      }
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
      // dog lunge: bite whoever it slams into, once
      if (t === ZTYPE.DOG && !z.bit) {
        for (const h of this.humansCache) {
          const s = h.state;
          if (Math.hypot(s.x - z.x, s.z - z.z) < 1.3 && z.y > s.y - 0.4 && z.y < s.y + 1.3 && this.canReach(z, h)) {
            z.bit = true;
            z.vx *= 0.25;
            z.vz *= 0.25;
            g.damagePlayer(h, def.dmg * 1.5 * (1 + 0.07 * (g.day - 1)), { kind: KILLER.ZOMBIE, ztype: t, x: z.x, z: z.z });
            g.impact(IMPACT.BLOOD, s.x, s.y + 0.7, s.z);
            g.sound(SOUND.DOG_SNARL, z.x, z.y + 0.6, z.z, 30);
            break;
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
        if (t === ZTYPE.DOG) {
          z.animT = 0.15;
          z.attackCd = Math.max(z.attackCd, 0.35);
          if (z.bit) {
            z.state = 7;
            z.stateT = 0.5 + g.rng() * 0.6;
          }
        }
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
      // the body it walks with (moveR / moveH): a charge at an open doorway carries on inside
      const hit = resolveBody(g.world, _pos, def.moveR ?? 0.65, def.moveH ?? 2.5, false);
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
        // what the blow breaks (a barricade, door boards) it ploughs straight through; anything that holds stops it
        if (s && !s.removed) end = true;
      } else if (hit) end = true;
      for (const h of this.humansCache) {
        const s = h.state;
        if (Math.hypot(s.x - z.x, s.z - z.z) < 1.8 && Math.abs(s.y - z.y) < 2 && this.canReach(z, h)) {
          g.damagePlayer(h, 32, { kind: KILLER.ZOMBIE, ztype: t, x: z.x, z: z.z });
          g.impact(IMPACT.BLOOD, s.x, s.y + 1.2, s.z);
          g.sound(SOUND.MELEE_HIT, s.x, s.y + 1.2, s.z, 40);
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
    if (z.state === 7) return false; // dog hit-and-run: normal movement

    // ---- trigger specials (state 0)
    if (!target) return false;
    const windup = (time, act, snd) => {
      z.state = 1;
      z.stateT = time;
      z.stateAct = act;
      z.anim = ZANIM.SPECIAL;
      if (snd) g.sound(snd, z.x, z.y + def.headY, z.z, def.boss ? 120 : 45);
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
      case ZTYPE.DOG:
        if (z.specialCd <= 0 && z.los && dist < def.lungeRange && dist > 2.4 && z.vy > -1 && Math.abs(ty - z.y) < 2.5) {
          windup(0.3, 8, SOUND.DOG_BARK);
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
      case 8: {
        // dog lunge: a low, fast leap that lands at the survivor's feet
        if (!target) return;
        const s = target.state;
        const T = Math.max(0.28, Math.min(0.5, dist / 11));
        let ax = s.x + s.vx * T * 0.5 - z.x;
        let az = s.z + s.vz * T * 0.5 - z.z;
        const l = Math.hypot(ax, az) || 1;
        const k = Math.max(0, l - 0.6) / l;
        ax *= k;
        az *= k;
        z.vx = ax / T;
        z.vz = az / T;
        z.vy = (s.y - z.y + 0.5 * GRAV * T * T) / T;
        z.yaw = Math.atan2(-ax, -az);
        z.state = 2;
        z.anim = ZANIM.AIRBORNE;
        z.bit = false;
        z.specialCd = 3 + g.rng() * 2.5;
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
