// Zombie AI: targeting, flow-field navigation, melee, structure breaking, and special abilities
// (spitter acid, leaper pounce/pin, roper rope-pull, boomer explosion, bat swarms, tank charge, bosses,
// zombie dog packs that den in the thick woods, flank and lunge, the shade that only moves in darkness).
// The herd that wanders the roads by day is in herd.js.
import { MAP_HALF, PHASE, PLAYER_RADIUS, EYE_HEIGHT, MAX_ENTITIES, HORDE_SPAWN_MIN, HORDE_SPAWN_MAX, FLASHLIGHT_RANGE, FLASHLIGHT_CONE, FIRE_LIGHT_MARGIN, NOISE_RUSH, NOISE_SPEED_MIN, NOISE_MEMORY, NOISE_MEMORY_MAX } from '../shared/constants.js';
import { HISTORY_TICKS, LEG_HP, STUMBLE_SPEED, HOBBLE_SPEED, CRAWL_SPEED, CRAWL_SPEED_MIN, CRAWL_SPEED_MAX, CRAWL_SLOW, CRAWL_HEIGHT, CRAWL_HEAD_Y } from '../shared/constants.js';
import { ZTYPE, ZOMBIE_DEFS, ZANIM, SOUND, KILLER, PROJ, AREA, EVT, IMPACT, ITEM, STRUCT_DEFS, THROWABLES, ZONE, BURN } from '../shared/defs.js';
import { ENT, qpos } from '../shared/protocol.js';
import { resolveBody, groundAt, deepWaterAt, raycastWorld, footprintContains, COL } from '../shared/collision.js';
import { eyeHeight } from '../shared/playersim.js';
import { Herds, HERD_RUSH } from './herd.js';
import { Wards, WARD_DARK } from './clinic.js';
import { ColliderGrid, makeBox, rayCollider, CYL } from '../shared/collision.js'; // (bat flight: flyCollide, roofBoxes)

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
// the client's distance haze: fog density by sun height (KEYS s / fogD in client/render/environment.js), see sightRange()
const HAZE_SUN = [-1, -0.12, 0.02, 0.18, 0.55, 1];
const HAZE_DENSITY = [0.025, 0.025, 0.0195, 0.0108, 0.0074, 0.0072];
// a zombie is lost in the haze once it has swallowed this much of it: what the dark of the night does at
// HORDE_SPAWN_MIN, the nearest the horde has always appeared (so in full darkness the whole spawn band stays hidden)
const HAZE_HIDES = 0.88;
const SPAWN_TRIES = 18; // candidates a horde spawn pick looks at before settling for the least exposed one
const SPAWN_HEAD = 1.7; // a zombie at a spot is in view when a survivor's eyes have a clear line to this far above its ground (m)
const SPAWN_SPREAD = 4; // a horde group is scattered this far round the spot picked for it (Game.spawnHordeGroup)
const SPAWN_VIEW_COS = Math.cos(1.13); // a survivor is looking at what lies within ~65 deg of dead ahead (the default FOV on a wide screen, and a margin)

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
    this.spawnPicks = 0; // horde spawn positions picked around the survivors (pickSpawnAround)...
    this.spawnsScreened = 0; // ...how many of them found nowhere wholly out of sight and took a spot with only its middle hidden...
    this.spawnsInView = 0; // ...and how many found nothing but spots in plain view
    this.treeGrid = null;
    this.dens = null;
    this.herds = new Herds(game, this);
    this.wards = new Wards(game, this); // the dead of Mercy Clinic's wards (clinic.js)
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
    const down = opts.y !== undefined; // a spot down in the mine: given with its floor, and the valley's grid is not asked
    if (!down && (w.isDeepWater(x, z) || g.nav.isBlocked(x, z))) {
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
    let y = down ? opts.y : groundAt(w, x, z, 200, 0.2, false);
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
      alertU: false, // ...and it came from down in the mine
      under: down, // down in the mine (updateOne keeps it)
      den: !!opts.den, // it lives down there: it keeps to the workings, and goes back when it has been led out
      spared: false, // one of the horde that was down there at sunrise: it burns when it comes up into the day
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
      breachT: 0, // boomers: how long a structure has been holding it up
      breachId: 0, // boomers: the structure it is winding up to burst against
      stuckT: 0,
      lastX: x,
      lastZ: z,
      detourT: 0,
      detourX: 0,
      detourZ: 0,
      sunk: false, // in the lake with nothing underfoot: wading back up the bed (wadeOut)
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
      legs: 0, // legs shot off (Combat.hitLeg): bit 0 the left, bit 1 the right. One gone it hobbles, both gone it crawls
      legHp: def.legs ? [hp * LEG_HP, hp * LEG_HP] : null, // what each leg still takes (left, right)
      stumbleT: 0, // tripped by a shot in the leg: seconds until it has caught itself
      hx: new Float32Array(HISTORY_TICKS),
      hy: new Float32Array(HISTORY_TICKS),
      hz: new Float32Array(HISTORY_TICKS),
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
    // ...and the ones that never came up out of the mine
    this.stockMine([]);
    // ...nor out of the wards of the clinic
    this.wards.stock([]);
  }

  // The dead that live down in the mine: one to a den (world.mine.dens: the rooms, the drift between them), topped
  // up at every sunrise. They stand about in the dark until somebody comes down; some never got their legs back.
  // Not while a survivor is down there to see them appear.
  stockMine(humans) {
    const g = this.g;
    const mine = g.world.mine;
    if (!mine || humans.some((h) => mine.under(h.state.x, h.state.y + 0.3, h.state.z))) return 0;
    const free = mine.dens.filter((d) => !g.zombies.some((z) => z.den && !z.dead && Math.hypot(z.homeX - d.x, z.homeZ - d.z) < 0.5));
    let n = 0;
    for (const d of free) {
      const r = g.rng();
      const type = r < 0.2 ? ZTYPE.RUNNER : g.day >= 2 && r < 0.3 ? ZTYPE.SHADE : g.day >= 3 && r < 0.38 ? ZTYPE.LEAPER : ZTYPE.WALKER;
      const z = this.spawn(type, d.x, d.z, { y: d.y, den: true, hpMul: 1.1 + 0.05 * g.day });
      if (!z) continue;
      // (a crawler from the start: both legs gone, as Combat.hitLeg leaves them)
      if (type === ZTYPE.WALKER && z.legHp && g.rng() < 0.25) {
        z.legs = 3;
        z.legHp = [0, 0];
      }
      n++;
    }
    return n;
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

  // How far off a survivor could make out a zombie right now (m): where the client's distance haze (FogExp2,
  // 1 - exp(-(density * d)^2)) has swallowed HAZE_HIDES of it. The haze follows the sun and the sun follows the
  // phase clock (Environment.cycleFor, mirrored here): ~200 m at noon, ~72 m as the night falls, 58 m in the dark.
  // The weather is not known here (clients derive it from the seed); a fog bank or rain only ever shortens this,
  // so leaving it out errs towards calling a spot visible.
  sightRange() {
    const g = this.g;
    const night = g.phase === PHASE.NIGHT;
    const len = night ? g.nightLen : g.day <= 1 ? g.firstDayLen : g.dayLen;
    const left = Math.max(0, Math.min(len, g.timeLeft));
    const el = len - left;
    let c; // position in the day/night cycle: the day on [0, 0.5), the night on [0.5, 1)
    if (night) {
      // 30 s of nightfall, the long dark, then 60 s of dawn
      const tin = Math.min(30, len * 0.25);
      const tout = Math.min(60, len * 0.35);
      c = el < tin ? 0.5 + 0.02 * (el / tin) : left < tout ? 1.04 - 0.065 * (left / tout) : 0.52 + 0.455 * ((el - tin) / (len - tin - tout));
    } else {
      // light morning to late afternoon, then 75 s of dusk
      const tout = Math.min(75, len * 0.35);
      c = left < tout ? 0.5 - 0.05 * (left / tout) : 0.04 + 0.41 * (el / (len - tout));
    }
    const s = Math.sin(c * Math.PI * 2);
    let k = 0;
    while (k < HAZE_SUN.length - 2 && HAZE_SUN[k + 1] < s) k++;
    const t = Math.max(0, Math.min(1, (s - HAZE_SUN[k]) / (HAZE_SUN[k + 1] - HAZE_SUN[k])));
    return Math.sqrt(-Math.log(1 - HAZE_HIDES)) / (HAZE_DENSITY[k] + (HAZE_DENSITY[k + 1] - HAZE_DENSITY[k]) * t);
  }

  // Would the survivors watch a group of zombies appear around (x,z)? 2: one of them, within `sight` m, has a clear
  // line to head height at the spot (in plain view). 1: nobody does, but someone has one SPAWN_SPREAD m to either
  // side of it as they look at it - the group is scattered that far, so whatever hides its middle (a tree trunk,
  // the corner of a house) does not hide all of it. 0: neither, the whole group comes up out of sight.
  spawnExposure(x, z, humans, sight) {
    const w = this.g.world;
    const y = groundAt(w, x, z, 200, 0.2, false) + SPAWN_HEAD;
    for (const h of humans) {
      const s = h.state;
      if (Math.hypot(x - s.x, z - s.z) > sight) continue;
      if (this.clearLine(s.x, s.y + eyeHeight(s), s.z, x, y, z)) return 2;
    }
    for (const h of humans) {
      const s = h.state;
      const dx = x - s.x;
      const dz = z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > sight) continue;
      for (let side = -1; side <= 1; side += 2) {
        const px = x - (dz / d) * SPAWN_SPREAD * side;
        const pz = z + (dx / d) * SPAWN_SPREAD * side;
        if (this.clearLine(s.x, s.y + eyeHeight(s), s.z, px, groundAt(w, px, pz, 200, 0.2, false) + SPAWN_HEAD, pz)) return 1;
      }
    }
    return 0;
  }

  // a walkable spot HORDE_SPAWN_MIN..MAX metres from (x,z) that no survivor is standing close to, and that none of
  // them can see (spawnExposure): the first candidate wholly out of sight is taken. Failing that, after SPAWN_TRIES
  // candidates (1-3 rays per survivor each), the first whose middle at least is hidden; and when every one of them
  // is in plain view (open ground, a team looking all ways) the farthest of those nobody is facing, or else the
  // farthest. spawnsScreened / spawnsInView count those two fallbacks.
  // (forest: the most wooded of the candidates - dog packs come out of the trees)
  pickSpawnAround(x, z, humans, minD = HORDE_SPAWN_MIN, maxD = HORDE_SPAWN_MAX, forest = false) {
    const g = this.g;
    const w = g.world;
    const lim = MAP_HALF - 14;
    const sight = this.sightRange();
    let best = null;
    let bestF = -1;
    let part = null;
    let partF = -1;
    let seen = null;
    let seenD = -1;
    this.spawnPicks++;
    for (let tries = 0; tries < SPAWN_TRIES; tries++) {
      const a = g.rng() * Math.PI * 2;
      const d = minD + g.rng() * (maxD - minD);
      const sx = x + Math.sin(a) * d;
      const sz = z + Math.cos(a) * d;
      if (Math.abs(sx) > lim || Math.abs(sz) > lim) continue;
      if (w.isDeepWater(sx, sz) || g.nav.isBlocked(sx, sz)) continue;
      let ok = true;
      let md = Infinity; // distance to the nearest survivor
      let faced = false; // some survivor is looking this way (forward is (-sin yaw, -cos yaw))
      for (const h of humans) {
        const s = h.state;
        const hd = Math.hypot(s.x - sx, s.z - sz);
        if (hd < minD * 0.75) ok = false;
        if (hd < md) md = hd;
        if ((s.x - sx) * Math.sin(s.yaw) + (s.z - sz) * Math.cos(s.yaw) > hd * SPAWN_VIEW_COS) faced = true;
      }
      if (!ok) continue;
      const f = forest ? this.forestAt(sx, sz) : 0;
      if (f <= bestF) continue; // no more wooded than the hidden one in hand: not worth the rays
      const v = this.spawnExposure(sx, sz, humans, sight);
      if (v === 0) {
        if (!forest) return { x: sx, z: sz };
        bestF = f;
        best = { x: sx, z: sz };
        if (f >= FOREST_DENS) break;
      } else if (v === 1) {
        if (f > partF) {
          partF = f;
          part = { x: sx, z: sz };
        }
      } else {
        if (!faced) md += 1000;
        if (md > seenD) {
          seenD = md;
          seen = { x: sx, z: sz };
        }
      }
    }
    if (best) return best;
    if (part) this.spawnsScreened++;
    else if (seen) this.spawnsInView++;
    return part || seen || this.pickSpawnPoint(humans, minD);
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
  // y (optional): the height it was made at, which tells a noise down in the mine from one on the ground above it.
  // Between the two levels a noise carries by way of the nearer portal, not through the rock.
  noise(x, z, loud, y) {
    const g = this.g;
    const mn = g.mineNav;
    const su = !!mn && y !== undefined && mn.mine.under(x, y + 0.3, z);
    g.dm.hear(x, z, loud, y); // the deer hear it too, and run the other way
    let heard = 0;
    let calls = 0;
    for (const e of g.zombies) {
      if (e.dead || e.target || e.def.flying) continue;
      let d = Math.hypot(e.x - x, e.z - z);
      if (mn && (su || e.under)) d = su && e.under ? Math.max(d, mn.dist(e.x, e.z, x, z)) : su ? mn.between(x, z, e.x, e.z).d : mn.between(e.x, e.z, x, z).d;
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
      e.alertU = su;
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
    // Sweep the corpses before the hash is built: it stores indices into g.zombies, so a splice any later would
    // leave everything that asks forNear this tick (a blast, a fire, a trap, the crowd's own spacing) looking at
    // the wrong zombies, or at none.
    const zs = g.zombies;
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      if (!z.dead) continue;
      z.deadT += dt;
      if (z.deadT > 1.6) {
        zs.splice(i, 1);
        g.removeEntity(z);
      }
    }
    this.rebuildHash();

    // who is down in the mine (the survivors here, each zombie in updateOne)
    const mn = g.mineNav;
    for (const h of humans) h.under = !!mn && mn.under(h.state);
    if (mn) mn.refresh();
    // flow fields: refresh 2 per tick round-robin (to a survivor down in the mine the valley's grid leads nowhere:
    // the way to them is by a portal, steerLevels)
    if (humans.length) {
      for (let k = 0; k < Math.min(2, humans.length); k++) {
        const h = humans[this.fieldRR++ % humans.length];
        if (!h.under) g.nav.computeField(h.id, h.state.x, h.state.z);
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
          if (z.dead || z.horde || z.den || z.ward) continue;
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

    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      if (!z.dead) this.updateOne(z, dt, humans);
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
    if (z.stumbleT > 0) z.stumbleT -= dt;
    z.trapSlow = Math.min(1, z.trapSlow + dt * 2);
    const mn = g.mineNav;
    const zu = (z.under = !!mn && !def.flying && mn.under(z));
    // the horde that was down in the mine at sunrise did not burn (z.spared, Game.startDay): the sun gets it when
    // it comes up, if that is before the next nightfall (the same for what the sunrise found in the clinic's wards)
    if (z.spared && (!(zu || this.inDark(z)) || g.phase !== PHASE.DAY)) {
      z.spared = false;
      if (g.phase === PHASE.DAY && !z.onFire && z.burning <= 0) z.burning = 0.3 + g.rng() * 1.5;
    }

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

    // climbing out of a grave (cemetery.js): it does nothing else until it is out
    if (z.riseT > 0) return g.cemetery.climb(z, dt);

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
        // (down in the mine: no rock, and nothing that stands in the drift)
        if (zu || target.under) z.direct = zu && target.under && z.los && dist < 12 && mn.segClear(z.x, z.z, tx, tz);
        else z.direct = z.los && dist < (z.pack ? 18 : 12) && g.nav.segClear(z.x, z.z, tx, tz);
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
      // (a pipe bomb down in the mine only draws what is down there with it: along the drift)
      if (zu && mn.dir(z.x, z.z, z.lureX, z.lureZ, _dir)) {
        dx = _dir.x;
        dz = _dir.z;
      }
      chasing = true;
    } else if (target) {
      chasing = true;
      if (z.herd) speed = Math.max(speed, HERD_RUSH); // a roused herd comes at a run, walkers and all
      // steer straight at a visible survivor; otherwise follow the flow field (around walls to a way in)
      if (zu || target.under) {
        // one of the two is down in the mine: along the drifts, and by a portal from one level to the other
        if (z.direct || !this.steerLevels(z, tx, tz, target.under)) {
          dx = tx - z.x;
          dz = tz - z.z;
        } else {
          dx = _dir.x;
          dz = _dir.z;
        }
      } else if (z.pack && z.direct && dist < 18) {
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
      } else if (g.nav.flowDir(target.id, z.x, z.z, _dir, z.y)) {
        dx = _dir.x;
        dz = _dir.z;
      } else {
        dx = tx - z.x;
        dz = tz - z.z;
      }
      // spitters keep their distance
      if (z.ztype === ZTYPE.SPITTER && z.los && dist < 11 && z.legs !== 3) {
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
      if (Math.hypot(dx, dz) < 3 && zu === z.alertU) z.alertT = 0;
      else if ((zu || z.alertU) && this.steerLevels(z, z.alertX, z.alertZ, z.alertU)) {
        dx = _dir.x;
        dz = _dir.z;
      }
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
        const spot = zu && g.rng() < (z.den ? 0.35 : 0.6) ? mn.randomSpot(z.x, z.z, 14, g.rng) : null;
        if (zu) {
          // down in the mine: about the drifts, or nowhere
          z.wanderX = spot ? spot.x : z.x;
          z.wanderZ = spot ? spot.z : z.z;
        } else if (g.rng() < 0.4) {
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
      if (z.den && !zu) {
        // led up out of the mine and left there: back down to its den
        if (this.steerLevels(z, z.homeX, z.homeZ, true)) {
          dx = _dir.x;
          dz = _dir.z;
        }
      } else if (z.ward && this.wards.steer(z, _dir)) {
        // one of the clinic's: about its wards, and back to them when it was led out
        dx = _dir.x;
        dz = _dir.z;
      } else if (Math.hypot(dx, dz) < 1) {
        dx = 0;
        dz = 0;
      } else if (zu && mn.dir(z.x, z.z, z.wanderX, z.wanderZ, _dir)) {
        dx = _dir.x;
        dz = _dir.z;
      }
      speed = z.pack ? 1.5 : Math.min(speed, 1.1) * 0.8;
    }
    if (!chasing && z.ztype === ZTYPE.RUNNER && !z.herd) speed = 1.2;
    // legs (Combat.hitLeg): on one it hobbles, on none it drags itself along by its arms, and a fresh hit trips it
    if (z.legs === 3) speed = crawlSpeed(def) * (chasing ? 1 : CRAWL_SLOW);
    else if (z.legs) speed *= HOBBLE_SPEED;
    if (z.stumbleT > 0) speed *= STUMBLE_SPEED;
    speed *= z.trapSlow;
    if ((g.phase === PHASE.NIGHT || g.escape.active) && z.horde) speed *= 1.06 + Math.min(0.2, 0.015 * g.day);

    // stop to attack
    let attacking = false;
    if (target && z.state !== 7 && dist <= def.range + PLAYER_RADIUS && ((Math.abs(ty - z.y) < 2.3 && this.canReach(z, target)) || this.canReachUp(z, target))) {
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
    // in the lake (see wadeOut): nothing else matters until it has climbed the bed back to the shallows
    if (z.sunk && (z.sunk = deepWaterAt(w, z.x, z.z, z.y, 0.2, false))) {
      dx = w.heightAt(z.x + 1, z.z) - w.heightAt(z.x - 1, z.z);
      dz = w.heightAt(z.x, z.z + 1) - w.heightAt(z.x, z.z - 1);
      attacking = false;
    }
    let len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      dx /= len;
      dz /= len;
    }
    const moveSpeed = attacking ? 0 : len > 1e-4 ? speed : 0;

    this.integrate(z, dt, dx * moveSpeed, dz * moveSpeed, humans);

    // boomer: it also detonates against what the survivors built. It cannot claw through a structure (structDmg 0),
    // so brought to a stop by one with a survivor close behind it, it swells up and bursts there. blockStruct is only
    // ever a player-built piece, never the static world; the range keeps a fence across the map from spending it;
    // sliding along a fence toward its end is not being stopped. The longer windup is the survivors' cue to shoot
    // it (then the piece only takes the blast) or step back.
    if (def.breachHold && z.state === 0) {
      const held = z.blockStruct && moveSpeed > 0 && dist < def.breachRange && Math.hypot(z.x - z.lastX, z.z - z.lastZ) < moveSpeed * dt * 0.5;
      if (held) z.breachT += dt;
      else z.breachT = Math.max(0, z.breachT - dt * 0.5);
      if (z.breachT >= def.breachHold) {
        z.breachT = 0;
        z.breachId = z.blockStruct;
        z.state = 1;
        z.stateT = def.breachWindup;
        z.stateAct = 99;
        z.anim = ZANIM.SPECIAL;
        g.sound(SOUND.BOOMER_GURGLE, z.x, z.y + 1.4, z.z, 30);
      }
    }

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

    // facing & anim (a crawler hauls itself round slowly: its head leads its body, and the hitbox with it)
    const swing = z.legs === 3 ? 0.4 : 1;
    if ((attacking || (target && dist < 4)) && z.state !== 7) z.yaw = turn(z.yaw, Math.atan2(-(tx - z.x), -(tz - z.z)), dt * 8 * swing);
    else if (Math.hypot(z.vx, z.vz) > 0.2) z.yaw = turn(z.yaw, Math.atan2(-z.vx, -z.vz), dt * 5 * swing);
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
    const mn = g.mineNav;
    for (const h of humans) {
      const s = h.state;
      let d = Math.hypot(s.x - z.x, s.z - z.z);
      // a survivor on the other level is as far off as the walk round by a portal; one down the same drifts as far
      // as the drifts make it (not the few metres of rock between two galleries)
      if (mn && (z.under || h.under)) d = z.under && h.under ? Math.max(d, mn.dist(z.x, z.z, s.x, s.z)) : z.under ? mn.between(z.x, z.z, s.x, s.z).d : mn.between(s.x, s.z, z.x, z.z).d;
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

  // The way for z to (tx,tz) when either is down in the mine (tu: the spot is). Down there it follows the mine's own
  // fields; between the levels it goes by the portal that makes the shortest trip: to the spot outside its mouth by
  // the valley's flow field, straight through the mouth, and on down the drift. Writes _dir; false when a straight
  // line is all there is (same cell, no field out here, no way).
  steerLevels(z, tx, tz, tu) {
    const g = this.g;
    const mn = g.mineNav;
    if (!mn) return false;
    if (z.under && tu) return mn.dir(z.x, z.z, tx, tz, _dir);
    const p = z.under ? mn.between(z.x, z.z, tx, tz).portal : mn.between(tx, tz, z.x, z.z).portal;
    // the leg it is on: up the drift to the spot inside the mouth and out, or to the spot outside it and in
    const [near, far] = z.under ? [p.in, p.out] : [p.out, p.in];
    let ax = far.x;
    let az = far.z;
    // (between the two spots, in the mouth itself, it walks straight through)
    const q = p.p;
    const s = (z.x - q.x) * q.dx + (z.z - q.z) * q.dz;
    if (s < -3.6 || s > 3.1 || Math.abs((z.z - q.z) * q.dx - (z.x - q.x) * q.dz) > 2.2) {
      if (z.under ? mn.dir(z.x, z.z, near.x, near.z, _dir) : g.nav.flowDir(p.key, z.x, z.z, _dir, z.y)) return true;
      ax = near.x;
      az = near.z;
    }
    const l = Math.hypot(ax - z.x, az - z.z) || 1;
    _dir.x = (ax - z.x) / l;
    _dir.z = (az - z.z) / l;
    return true;
  }

  hasLOS(z, tx, ty, tz, dist) {
    return this.clearLine(z.x, z.y + (z.legs === 3 ? CRAWL_HEAD_Y : z.def.headY), z.z, tx, ty, tz);
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
    if (g.phase !== PHASE.NIGHT && !z.under && !this.inDark(z)) return true; // (no daylight gets down the mine, or into a boarded-up ward)
    const h = bodyHeight(z);
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

  // Does z stand in one of the world's dark interiors (world.darks: the wards of Mercy Clinic), where it is dark at
  // noon? No daylight pins a Shade there, and the sunrise burns nothing in there.
  inDark(z) {
    return this.g.world.darkAt(z.x, z.y + 1, z.z) >= WARD_DARK;
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
    const oy = z.y + bodyHeight(z) * 0.55;
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

  // melee reach at a survivor standing on something (a car roof, a dumpster), where the torso line above runs
  // into the perch itself: the arms go up beside it and across at the survivor's shins, so what the survivor
  // stands on is not in the way, and a wall or a ceiling between the two still is. Feet up to 2.5 m above the
  // zombie's own are in reach: what a survivor gets onto with one hop off a barricade (1.15 + 0.9 jump + 0.45
  // step), so the roof of a car, a pickup (1.9) or a tractor (2.2), and no camper (3.0), bus or building roof
  // (2.7 and up). A short body stretches 0.75 m above its head at most: a dog gets at a car roof, not a truck's.
  // slack: extra height allowed to a swing already on its way (the survivor jumped).
  canReachUp(z, p, slack = 0) {
    const s = p.state;
    const up = s.y - z.y;
    // feet within a step of the zombie's are on its own footing: the torso line alone decides
    if (up < 0.5 || up > Math.min(2.5, bodyHeight(z) + 0.75) + slack) return false;
    const w = this.g.world;
    const oy = z.y + bodyHeight(z) * 0.55;
    const ty = s.y + 0.35;
    raycastWorld(w, z.x, oy, z.z, 0, ty > oy ? 1 : -1, 0, Math.abs(ty - oy), _ray);
    if (_ray.col) return false;
    const l = Math.hypot(s.x - z.x, s.z - z.z) || 1;
    raycastWorld(w, z.x, ty, z.z, (s.x - z.x) / l, 0, (s.z - z.z) / l, l, _ray);
    const c = _ray.col;
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
    if (deepWaterAt(g.world, _pos.x, _pos.z, z.y, 0.2, false) && !this.wadeOut(z, ox, oz)) {
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

  // integrate is about to refuse a step into the lake. One that is already in it (dropped off a deck by a
  // pounce, shoved off the edge) may take the step if it climbs the lake bed: it wades back to the shallows
  // instead of standing on the bottom all night. updateOne steers it up the bed while z.sunk is set.
  wadeOut(z, ox, oz) {
    const w = this.g.world;
    z.sunk = deepWaterAt(w, ox, oz, z.y, 0.2, false);
    return z.sunk && w.heightAt(_pos.x, _pos.z) > w.heightAt(ox, oz);
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
      if (d > def.range + PLAYER_RADIUS + 0.9 || ((Math.abs(s.y - z.y) > 2.5 || !this.canReach(z, p)) && !this.canReachUp(z, p, 0.9))) return;
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
      if (!deepWaterAt(g.world, _pos.x, _pos.z, z.y, 0.2, false)) {
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
      // the lake ahead and no deck over it: the charge pulls up at the edge instead of carrying it in
      if (deepWaterAt(g.world, z.x + z.chargeX * 10 * dt, z.z + z.chargeZ * 10 * dt, z.y, 0.2, false)) {
        z.chargeX = z.chargeZ = 0;
        z.stateT = 0;
      }
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

    // ---- trigger specials (state 0). A crawler has none left: it cannot rear up to spit or to throw its rope
    if (!target || z.legs === 3) return false;
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
      case 99: {
        // boomer detonation. Bursting against a structure, that piece takes the brunt: the blast alone falls off so
        // gently that a number big enough to open a wall would level its neighbours too
        const s = z.breachId ? g.ents[z.breachId] : null;
        if (s && s.kind === ENT.STRUCTURE && Math.hypot(s.x - z.x, s.z - z.z) < def.blastRadius) g.damageStructure(s, def.breachDmg);
        g.combat.killZombie(z, null, { explode: true });
        break;
      }
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
    if (z.state === BAT_SHUT_OUT && !target) z.state = 0;
    // s a shut-out bat spends on a pass over the roofs (each bat its own: a flock does not come down as one)
    const pass = 1.5 + (z.variant % 16) * 0.1;
    if (target && z.state !== 7) {
      const d3 = Math.hypot(tx - z.x, ty + 1.3 - z.y, tz - z.z);
      gx = tx + Math.sin(time * 2.1) * 1.5;
      gz = tz + Math.cos(time * 1.7) * 1.5;
      gy = d3 < 8 ? ty + 1.3 : Math.max(ty + 3, ground + 3.5);
      if (z.state === BAT_SHUT_OUT) {
        // Something solid stopped it on the way in, and it has no path-finding. It wheels round the survivor instead:
        // a tight pass high over the roofs (detourT), then a wider one low, between window height and the eaves, and
        // round again. The moment it has a clear line - through a doorway or a window, down past the top of a wall
        // with no roof over it, or because they stepped outside - it comes down it. A bite puts it back on the hunt.
        z.detourT -= dt;
        z.wanderT -= dt;
        z.stateT -= dt;
        if (z.detourT < -BAT_LOW_PASS && z.stateT <= 0 && z.wanderT <= 0) z.detourT = pass;
        // Its own look, every third tick and not the whole flock at once (the one in updateOne, every 0.3 s, is too
        // stale for a bat crossing the view through a window at full speed). None on the way up: a bat that was just
        // stopped does not turn straight back into the same wall.
        if (z.detourT < 0.8 && z.stateT <= 0 && dist < 30 && (g.tick + z.id) % 3 === 0 && this.batSees(z, tx, ty + 1.4, tz)) {
          // it turns on the spot (round a slow curve it would be out of the view again) and commits for a while
          z.stateT = 2.5;
          z.detourT = Math.min(z.detourT, 0);
          z.wanderT = 0;
          const l = d3 || 1;
          z.vx = ((tx - z.x) / l) * def.speed;
          z.vy = ((ty + 1.3 - z.y) / l) * def.speed;
          z.vz = ((tz - z.z) / l) * def.speed;
        }
        if (z.detourT > 0) {
          gx = tx + Math.sin(time * 1.25) * 6;
          gz = tz + Math.cos(time * 1.25) * 6;
          gy = Math.max(ground, ty) + 7 + Math.sin(time) * 2;
        } else if (z.stateT > 0) {
          gx = tx;
          gz = tz;
          gy = ty + 1.3;
        } else if (z.wanderT > 0) {
          // (it could not climb: it is under a roof or an eave itself) off along the walls at door height
          gx = z.x + z.detourX * 10;
          gz = z.z + z.detourZ * 10;
          gy = ground + 1.3;
        } else {
          gx = tx + Math.sin(time * 0.8) * 10;
          gz = tz + Math.cos(time * 0.8) * 10;
          gy = Math.max(ty + 2.8 + Math.sin(time * 0.7) * 1.8, ground + 1.5);
        }
      }
      if (d3 < 1.6 && z.attackCd <= 0 && this.canReach(z, target) && !roofBetween(g.world, z.x, z.y + def.headY, z.z, tx, ty + 0.9, tz)) {
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
    const px = z.x;
    const py = z.y;
    const pz = z.z;
    z.x += z.vx * dt;
    z.y += z.vy * dt + Math.sin(time * 9) * 0.03;
    z.z += z.vz * dt;
    const lim = MAP_HALF - 4;
    z.x = Math.max(-lim, Math.min(lim, z.x));
    z.z = Math.max(-lim, Math.min(lim, z.z));
    const gr = g.world.heightAt(z.x, z.z);
    if (z.y < gr + 0.6) z.y = gr + 0.6;
    const hit = this.flyCollide(z, px, py, pz);
    // held up: pressed against something it cannot get round (sliding along a wall is not being held up)
    if (hit && Math.hypot(z.x - px, z.y - py, z.z - pz) < sp * dt * 0.3) z.stuckT += dt;
    else z.stuckT = Math.max(0, z.stuckT - dt * 0.5);
    const shut = z.state === BAT_SHUT_OUT;
    if (z.state === 7 || (shut && z.detourT <= 0 && z.wanderT > 0)) {
      // peeling off indoors, or off along the walls: turn the corner instead of hanging in it
      if (z.stuckT > 0.15) {
        z.stuckT = 0;
        const t = z.detourX;
        z.detourX = -z.detourZ;
        z.detourZ = t;
        // In a room it cannot get the distance that spaces its bites out in the open: it takes the time instead
        // (not for ever: attackCd has been running down since the bite)
        if (z.state === 7 && z.attackCd > -1.5) z.stateT += BAT_TURN;
      }
    } else if (!target) z.stuckT = 0;
    else if (z.stuckT > 0.4) {
      // on the hunt, low round the survivor or coming down a line: break off, up and over. Held up on the way up:
      // off along the walls instead.
      z.stuckT = 0;
      z.state = BAT_SHUT_OUT;
      z.stateT = 0;
      if (shut && z.detourT > 0) {
        z.detourT = 0;
        z.wanderT = 2;
        z.detourX = Math.sin(time * 2.4);
        z.detourZ = Math.cos(time * 2.4);
      } else z.detourT = pass;
    }
    if (Math.hypot(z.vx, z.vz) > 0.3) z.yaw = turn(z.yaw, Math.atan2(-z.vx, -z.vz), dt * 6);
    if (z.animT <= 0) z.anim = ZANIM.WALK;
  }

  // A clear line from a bat to a point on a survivor, roofs counted, and clear all the way there: hasLOS stops half
  // a metre short, which is enough to see a survivor through the wall they are leaning on.
  batSees(z, tx, ty, tz) {
    const w = this.g.world;
    const oy = z.y + z.def.headY;
    if (roofBetween(w, z.x, oy, z.z, tx, ty, tz)) return false;
    const dx = tx - z.x;
    const dy = ty - oy;
    const dz = tz - z.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    raycastWorld(w, z.x, oy, z.z, dx / l, dy / l, dz / l, l, _ray, COL.NOBLOCK | COL.NOBULLET);
    return _ray.t < 0;
  }

  // Flight is stopped by everything solid: walls, floors and ceilings, props, tree trunks, player-built structures and
  // roofs (roofBoxes). The bat flew from (px,py,pz) this tick: whatever it now overlaps puts it back on the side it
  // came in from and takes the speed that carried it in, so it slides along a wall, over a roof or under a lintel
  // instead of stopping dead. One small grid query per grid, nothing swept: a tick's flight (under half a metre) is
  // shorter than the thinnest wall plus the bat's own width. Returns true if anything stopped it.
  flyCollide(z, px, py, pz) {
    const w = this.g.world;
    const r = z.def.radius;
    let any = false;
    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      for (let gi = 0; gi < 3; gi++) {
        // (a box is grown squarely: its corners reach r * sqrt 2 past the circle the grid tests)
        const list = (gi === 0 ? w.staticGrid : gi === 1 ? w.structGrid : roofBoxes(w)).query(z.x, z.z, r * 1.42, _fq);
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c.flags & COL.NOBLOCK) continue;
          // the body spans y - BAT_BELLY .. y + height, and is r wide: the collider grown by that much, against a point
          const y0 = c.y0 - z.def.height;
          const y1 = c.y1 + BAT_BELLY;
          if (z.y <= y0 || z.y >= y1) continue;
          const dx = z.x - c.x;
          const dz = z.z - c.z;
          let nx = 0;
          let nz = 0;
          if (c.type === CYL) {
            const rr = c.r + r;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            if (py < y1 && py > y0) {
              const pd = Math.hypot(px - c.x, pz - c.z);
              if (pd < rr) continue; // it was already inside (spawned there): let it fly out
              // out along the radius it is on (dead centre: the way it came)
              const d = Math.sqrt(d2);
              nx = d > 1e-4 ? dx / d : (px - c.x) / pd;
              nz = d > 1e-4 ? dz / d : (pz - c.z) / pd;
              z.x = c.x + nx * (rr + BAT_SKIN);
              z.z = c.z + nz * (rr + BAT_SKIN);
            }
          } else {
            const lx = c.c * dx - c.s * dz;
            const lz = c.s * dx + c.c * dz;
            const ex = c.hx + r;
            const ez = c.hz + r;
            if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
            if (py < y1 && py > y0) {
              // which face it came in through: where it was, in the box's frame
              const plx = c.c * (px - c.x) - c.s * (pz - c.z);
              const plz = c.s * (px - c.x) + c.c * (pz - c.z);
              const outX = Math.abs(plx) >= ex;
              const outZ = Math.abs(plz) >= ez;
              if (!outX && !outZ) continue; // it was already inside (spawned there): let it fly out
              // (round a corner, both: the face it has gone the least way past)
              let ox = lx;
              let oz = lz;
              if (outX && (!outZ || ex - Math.abs(lx) < ez - Math.abs(lz))) {
                nx = plx > 0 ? 1 : -1;
                ox = nx * (ex + BAT_SKIN);
              } else {
                nz = plz > 0 ? 1 : -1;
                oz = nz * (ez + BAT_SKIN);
              }
              // back to world, as pushCircle does
              z.x = c.x + c.c * ox + c.s * oz;
              z.z = c.z - c.s * ox + c.c * oz;
              const wx = c.c * nx + c.s * nz;
              nz = -c.s * nx + c.c * nz;
              nx = wx;
            }
          }
          hit = true;
          if (nx || nz) {
            const vn = z.vx * nx + z.vz * nz;
            if (vn < 0) {
              z.vx -= vn * nx;
              z.vz -= vn * nz;
            }
          } else if (py >= y1) {
            // it came down onto it
            z.y = y1;
            if (z.vy < 0) z.vy = 0;
          } else {
            // it came up under it
            z.y = y0;
            if (z.vy > 0) z.vy = 0;
          }
        }
      }
      if (!hit) return any;
      any = true;
    }
    // wedged between things that push it into each other: stay where it was
    z.x = px;
    z.y = py;
    z.z = pz;
    return true;
  }
}

const BAT_SHUT_OUT = 8; // a bat's state, next to 0 (hunting) and 7 (peeling off after a bite): walls are in its way
const BAT_LOW_PASS = 8; // s a shut-out bat spends low round the building between passes over the top
const BAT_TURN = 0.25; // s each wall it meets adds to its peeling off after a bite
const BAT_BELLY = 0.1; // how far a bat's body hangs below its position
const BAT_SKIN = 0.001; // it is put back this far clear of a wall, so rounding never leaves it counted as inside
const _fq = [];
const _roofs = new WeakMap();

// Gable roofs and shelter tops are drawn but have no collider (a collision box cannot slope), so a ray goes straight
// through them. For bats each roof is a solid block from the eaves to the ridge over its footprint, the same box the
// client keeps the rain out of (world.roofs). Built once per world.
function roofBoxes(w) {
  let grid = _roofs.get(w);
  if (!grid) {
    grid = new ColliderGrid(MAP_HALF + 20, 8);
    for (const r of w.roofs) grid.add(makeBox(r.x, r.z, r.y, r.y + Math.abs(r.rise), r.hx * 2, r.hz * 2, Math.atan2(r.s, r.c)));
    _roofs.set(w, grid);
  }
  return grid;
}

// is one of those roofs on the straight line between two points
function roofBetween(w, ox, oy, oz, tx, ty, tz) {
  let dx = tx - ox;
  let dy = ty - oy;
  let dz = tz - oz;
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  const list = roofBoxes(w).query((ox + tx) / 2, (oz + tz) / 2, Math.hypot(tx - ox, tz - oz) / 2, _fq);
  for (let i = 0; i < list.length; i++) if (rayCollider(list[i], ox, oy, oz, dx, dy, dz, l) >= 0) return true;
  return false;
}

// how fast a zombie of this kind drags itself along once both legs are gone (m/s)
export function crawlSpeed(def) {
  return Math.max(CRAWL_SPEED_MIN, Math.min(CRAWL_SPEED_MAX, def.speed * CRAWL_SPEED));
}

// how tall it stands, or lies: what its reach is measured from
function bodyHeight(z) {
  return z.legs === 3 ? CRAWL_HEIGHT : z.def.height;
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
