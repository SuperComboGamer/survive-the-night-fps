// The valley's deer. Small groups graze the woods and clearings away from the places and the roads, all game, day
// and night. A group bolts as one from a survivor who comes close (closer if they crouch), from a noise that reaches
// it (Zombies.noise hands every noise on to hear) and from the dead; it outruns a sprint, runs a good way and
// settles. They can be hunted: a shot at one goes through the same lag-compensated path as a shot at a zombie
// (Combat.forTargets / hitbox / damageZombie), and a kill leaves leather and venison (DEER_LOOT).
//
// A deer is an entity kind of its own (ENT.DEER, in game.deer), not a zombie: nothing that walks game.zombies - the
// horde's size and waves, the night summary, kills and the leaderboard, the killfeed, the dawn sun, what a noise
// draws, /spawn - ever meets one. Zombies ignore deer; nothing eats anything.
//
// Everything random here comes off the deer's own stream (this.rng), the scatter of a kill's drops included: the
// game's stream is the same with deer in the valley as without.
import { MAP_HALF, PLAYER_RADIUS, HISTORY_TICKS, WATER_LEVEL } from '../shared/constants.js';
import { SOUND, ZONE } from '../shared/defs.js';
import { ENT } from '../shared/protocol.js';
import { resolveBody, groundAt, deepWaterAt } from '../shared/collision.js';
import { mulberry32 } from '../shared/rng.js';
import { DEER, DANIM, DEER_LOOT } from '../shared/deer.js';

const GRAV = 16;
const TAU = Math.PI * 2;
const LIM = MAP_HALF - 10; // as near the edge of the map as a deer goes
const SPREAD = 7; // a group grazes within this of the middle of its ground (m)
const APART = 90; // groups are put down this far from each other (m)
const CAR_CLEAR = 70; // ...and from the survivors' car
const ROAD_CLEAR = 22; // ...their ground from the roads
const SITE_CLEAR = 18; // ...from the wrecks, camps and stashes between the places
const PORTAL_CLEAR = 26; // ...from the mouths of the mine
const UNSEEN = 75; // none turns up nearer than this to a survivor (m)
const RIM = 12; // newcomers walk in from this far inside the edge of the map (m)
const WALK_IN = 62; // ...to ground no further than this from where they come in (the reach of a flow field)
const LOOK = 0.25; // s between a group's looks around for what it fears
const WARY = 1.25; // a group that is already running or watching startles from this much further off
const SNORT_EVERY = 5; // s between snorts of one group
const TURNS = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2]; // how far off "straight away from it" a bolt looks for somewhere to go (rad)
const MODE = { GRAZE: 0, DRIFT: 1, BOLT: 2, WARY: 3 };
const _pos = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, z: 0, cost: 0 };

function turn(a, b, max) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + Math.max(-max, Math.min(max, d));
}

export class Deer {
  constructor(game) {
    this.g = game;
    this.groups = [];
    this.seq = 0;
    this.rng = mulberry32(0);
    this.spots = null; // ground a group may graze (grounds), for this.spotsOf
    this.spotsOf = null;
  }

  // new game: the old valley's deer went with its entities (Game.clearWorld)
  reset() {
    const g = this.g;
    for (const gr of this.groups) g.nav.removeField(gr.key);
    this.groups.length = 0;
    this.rng = mulberry32((g.seed ^ 0xdee4) >>> 0);
  }

  // ---------------------------------------------------------------- ground
  // somewhere a deer can stand: inside the map, dry, clear of walls, trunks and rocks, not in a mouth of the mine
  open(x, z) {
    const g = this.g;
    const w = g.world;
    if (Math.abs(x) > LIM || Math.abs(z) > LIM) return false;
    if (w.isDeepWater(x, z) || g.nav.isBlocked(x, z)) return false;
    return !(w.mine && w.mine.inHole(x, z));
  }

  // ground a group would graze: woods or a clearing, away from every place, road, roadside site and mine mouth, with
  // room around it
  fair(x, z) {
    const w = this.g.world;
    if (!this.open(x, z) || w.zoneAt(x, z) !== ZONE.FOREST || w.roadDistAt(x, z) < ROAD_CLEAR) return false;
    if (w.heightAt(x, z) < WATER_LEVEL + 0.5) return false;
    for (let k = 0; k < 4; k++) if (!this.open(x + (k & 1 ? 2.5 : -2.5), z + (k & 2 ? 2.5 : -2.5))) return false;
    for (const s of w.sites) if (Math.hypot(s.x - x, s.z - z) < SITE_CLEAR) return false;
    for (const p of w.mine?.portals || []) if (Math.hypot(p.x - x, p.z - z) < PORTAL_CLEAR) return false;
    return true;
  }

  // every such spot on a 14 m grid (built once per valley)
  grounds() {
    const w = this.g.world;
    if (this.spotsOf === w) return this.spots;
    const out = [];
    const lim = LIM - 20;
    for (let z = -lim; z <= lim; z += 14) for (let x = -lim; x <= lim; x += 14) if (this.fair(x, z)) out.push({ x, z });
    this.spotsOf = w;
    this.spots = out;
    return out;
  }

  // nothing between two points that a deer would have to go round: no wall, trunk or rock the nav grid knows, no
  // deep water, no mine mouth
  clearWay(x0, z0, x1, z1, d) {
    if (!this.g.nav.segClear(x0, z0, x1, z1)) return false;
    for (let t = 1; t < d; t += 1) if (!this.open(x0 + ((x1 - x0) * t) / d, z0 + ((z1 - z0) * t) / d)) return false;
    return true;
  }

  // is ground (x,z) far enough from the car, every survivor and every other group for a group to be put down on it
  apart(x, z, humans, apart) {
    const g = this.g;
    const car = g.world.car;
    if (Math.hypot(x - car.x, z - car.z) < CAR_CLEAR) return false;
    for (const h of humans) if (Math.hypot(h.state.x - x, h.state.z - z) < UNSEEN) return false;
    for (const gr of this.groups) if (Math.hypot(gr.x - x, gr.z - z) < apart) return false;
    return true;
  }

  count() {
    let n = 0;
    for (const gr of this.groups) n += gr.members.length;
    return n;
  }

  // ---------------------------------------------------------------- spawning
  // n deer as a group on ground (x,z). from: where they stand to begin with (newcomers at the rim), else on the
  // ground itself. Returns the group, or null if not one of them found room.
  spawnGroup(x, z, n, from = null) {
    const g = this.g;
    const rng = this.rng;
    const id = ++this.seq;
    const gr = {
      id,
      key: 'deer' + id, // its flow field (nav.js), while it is going somewhere
      x, // the middle of its ground: where it grazes, or where it is headed
      z,
      cx: from ? from.x : x, // the middle of the group itself
      cz: from ? from.z : z,
      members: [],
      mode: MODE.GRAZE,
      t: 0, // s in this mode
      limit: 0, // s this mode lasts at most
      driftT: 150 + rng() * 300, // s of grazing until it moves on to new ground
      lookT: rng() * LOOK,
      boltCd: 0,
      snortCd: 0,
      calm: 0, // s it lets a survivor stand close (/deer spawn)
      fromX: x, // what it last ran from
      fromZ: z,
    };
    const buck = rng() < 0.6; // at most one to a group
    for (let i = 0; i < n * 4 && gr.members.length < n; i++) {
      const a = (gr.members.length / n) * TAU + rng() * 1.5;
      const r = 1.5 + rng() * 3.5;
      const ox = Math.sin(a) * r;
      const oz = Math.cos(a) * r;
      const sx = gr.cx + (from ? ox * 0.6 : ox);
      const sz = gr.cz + (from ? oz * 0.6 : oz);
      if (!this.open(sx, sz)) continue;
      const e = {
        kind: ENT.DEER,
        variant: (Math.floor(rng() * 128) << 1) | (buck && !gr.members.length ? 1 : 0), // bit 0: a buck (antlers); the rest: its coat and build
        x: sx,
        y: groundAt(g.world, sx, sz, g.world.heightAt(sx, sz) + 0.5, 0.2, false), // (the ground, not a roof over it)
        z: sz,
        yaw: rng() * TAU,
        vx: 0,
        vy: 0,
        vz: 0,
        hp: DEER.hp,
        maxHp: DEER.hp,
        anim: DANIM.GRAZE,
        dead: false,
        deadT: 0,
        group: gr,
        ox, // its place around the middle of the group's ground
        oz,
        tx: sx, // where it is stepping to while it grazes
        tz: sz,
        moving: false,
        pause: 2 + rng() * 9, // s until it next does something
        look: 0, // s it keeps its head up
        arrived: false, // (going somewhere) it is where it was going, or has given up getting there
        direct: false, // ...the straight line there is clear
        losT: rng() * 0.4,
        dx: 0, // ...the heading it is on (smoothed: a flow field turns in steps of 45 degrees)
        dz: 0,
        stuckT: 0,
        stucks: 0,
        detourT: 0,
        detourX: 0,
        detourZ: 0,
        hx: new Float32Array(HISTORY_TICKS),
        hy: new Float32Array(HISTORY_TICKS),
        hz: new Float32Array(HISTORY_TICKS),
      };
      if (!g.spawnEntity(e)) break;
      g.fillHistory(e);
      g.deer.push(e);
      gr.members.push(e);
    }
    if (!gr.members.length) return null;
    this.groups.push(gr);
    if (from) this.setOut(gr, MODE.DRIFT, x, z, DEER.walk * 1.5);
    return gr;
  }

  // the valley's groups for a new game, each on ground of its own
  spawnInitial() {
    this.reset();
    const rng = this.rng;
    const spots = this.grounds().filter((s) => Math.max(Math.abs(s.x), Math.abs(s.z)) < MAP_HALF - WALK_IN); // (the rim is where newcomers turn up: dawn)
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    // (a small or crowded valley: the groups stand closer rather than there being fewer of them)
    for (const apart of [APART, APART * 0.6]) {
      for (const s of spots) {
        if (this.groups.length >= DEER.groups) return;
        if (!this.apart(s.x, s.z, [], apart)) continue;
        // (never so many in one group that the cap leaves the groups still to come short)
        const room = DEER.cap - this.count() - (DEER.groups - this.groups.length - 1) * DEER.groupMin;
        this.spawnGroup(s.x, s.z, Math.min(DEER.groupMin + Math.floor(rng() * (DEER.groupMax - DEER.groupMin + 1)), room));
      }
    }
  }

  // Sunrise: what was hunted is replaced. New groups walk in from the edge of the map, out of every survivor's
  // sight, until the valley has its groups again or its cap of deer. (What is left of a group, a single deer
  // included, stays where it is; a single one does not count as a group.)
  dawn(humans) {
    const rng = this.rng;
    const full = () => this.groups.reduce((n, gr) => n + (gr.members.length >= DEER.groupMin ? 1 : 0), 0);
    const near = this.grounds().filter((s) => Math.max(Math.abs(s.x), Math.abs(s.z)) > MAP_HALF - WALK_IN + RIM);
    let made = 0;
    for (let tries = 0; tries < 40 && near.length && full() < DEER.groups && this.count() + DEER.groupMin <= DEER.cap; tries++) {
      const s = near[Math.floor(rng() * near.length)];
      if (!this.apart(s.x, s.z, humans, APART * 0.6)) continue;
      // the nearest point of the rim, and a little along it if that one is in the water or in the rock
      const edge = MAP_HALF - RIM;
      const alongX = Math.abs(s.x) < Math.abs(s.z);
      let from = null;
      for (let k = 0; k < 6 && !from; k++) {
        const off = (rng() - 0.5) * 30;
        const x = alongX ? s.x + off : Math.sign(s.x) * edge;
        const z = alongX ? Math.sign(s.z) * edge : s.z + off;
        if (this.open(x, z) && humans.every((h) => Math.hypot(h.state.x - x, h.state.z - z) > UNSEEN)) from = { x, z };
      }
      if (!from) continue;
      const n = Math.min(DEER.groupMin + Math.floor(rng() * (DEER.groupMax - DEER.groupMin + 1)), DEER.cap - this.count());
      if (this.spawnGroup(s.x, s.z, n, from)) made++;
    }
    return made;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.g;
    const list = g.deer;
    if (!list.length) return;
    // a dead one lies where it fell for a while
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (!d.dead) continue;
      d.deadT += dt;
      if (d.deadT > DEER.corpse) {
        list[i] = list[list.length - 1];
        list.pop();
        g.removeEntity(d);
      }
    }
    const humans = g.humans();
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const gr = this.groups[i];
      if (gr.members.length) this.tick(gr, dt, humans);
      else {
        g.nav.removeField(gr.key);
        this.groups.splice(i, 1);
      }
    }
  }

  tick(gr, dt, humans) {
    const ms = gr.members;
    let cx = 0;
    let cz = 0;
    let there = 0;
    for (const m of ms) {
      cx += m.x;
      cz += m.z;
      if (m.arrived) there++;
    }
    gr.cx = cx / ms.length;
    gr.cz = cz / ms.length;
    gr.t += dt;
    gr.boltCd -= dt;
    gr.snortCd -= dt;
    gr.calm -= dt;
    gr.lookT -= dt;
    if (gr.lookT <= 0) {
      gr.lookT = LOOK;
      const th = this.threat(gr, humans);
      if (th) this.bolt(gr, th.x, th.z);
    }
    switch (gr.mode) {
      case MODE.BOLT:
        // far enough: they stop, heads up, and watch where it came from
        if (there === ms.length || gr.t > gr.limit) {
          gr.mode = MODE.WARY;
          gr.t = 0;
          gr.limit = 4 + this.rng() * 5;
        }
        break;
      case MODE.WARY:
        // (a bolt ends wherever it ends: from a road or the edge of a place they are soon on to better ground)
        if (gr.t > gr.limit) this.graze(gr, this.fair(gr.x, gr.z) ? 150 + this.rng() * 300 : 6 + this.rng() * 10);
        break;
      case MODE.DRIFT:
        if (there === ms.length || gr.t > gr.limit) this.graze(gr, 240 + this.rng() * 300);
        break;
      default:
        gr.driftT -= dt;
        if (gr.driftT <= 0) this.drift(gr, humans);
    }
    for (const m of ms) this.move(m, gr, dt, humans);
  }

  graze(gr, driftT) {
    const rng = this.rng;
    gr.mode = MODE.GRAZE;
    gr.t = 0;
    gr.driftT = driftT;
    this.g.nav.removeField(gr.key);
    for (const m of gr.members) {
      m.moving = false;
      m.pause = rng() * 5;
      m.look = rng() < 0.4 ? 1 + rng() * 3 : 0;
    }
  }

  // the group heads for (x,z) together: at a walk to new ground, or at a run from something
  setOut(gr, mode, x, z, speed) {
    gr.mode = mode;
    gr.t = 0;
    gr.x = x;
    gr.z = z;
    gr.limit = Math.hypot(x - gr.cx, z - gr.cz) / speed + (mode === MODE.BOLT ? 5 : 20);
    this.g.nav.computeField(gr.key, x, z);
    for (const m of gr.members) {
      m.arrived = false;
      m.moving = false;
      m.losT = 0;
      m.dx = m.dz = 0;
      m.stuckT = 0;
      m.stucks = 0;
      m.detourT = 0;
    }
  }

  // can the group walk from where it is to (x,z)? Asks a flow field to the spot (left in place: setOut uses it)
  reaches(gr, x, z) {
    const g = this.g;
    const m = gr.members[0];
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < 25 && this.clearWay(m.x, m.z, x, z, d)) return true;
    g.nav.computeField(gr.key, x, z);
    return g.nav.flowDir(gr.key, m.x, m.z, _dir, m.y);
  }

  // on to new ground a little way off, now and then
  drift(gr, humans) {
    const rng = this.rng;
    for (let tries = 0; tries < 6; tries++) {
      const a = rng() * TAU;
      const d = 18 + rng() * 24;
      const x = gr.x + Math.sin(a) * d;
      const z = gr.z + Math.cos(a) * d;
      if (!this.fair(x, z)) continue;
      if (humans.some((h) => Math.hypot(h.state.x - x, h.state.z - z) < DEER.notice * 2)) continue;
      if (this.groups.some((o) => o !== gr && Math.hypot(o.x - x, o.z - z) < APART * 0.5)) continue;
      if (!this.reaches(gr, x, z)) continue;
      return this.setOut(gr, MODE.DRIFT, x, z, DEER.walk * 1.5);
    }
    this.g.nav.removeField(gr.key);
    gr.driftT = 15 + rng() * 15;
  }

  // ---------------------------------------------------------------- what they fear
  // the nearest thing the group would run from, as { x, z }: a survivor who has come too close, or one of the dead
  threat(gr, humans) {
    const g = this.g;
    const ms = gr.members;
    const wary = gr.mode === MODE.BOLT || gr.mode === MODE.WARY ? WARY : 1;
    let best = null;
    let bd = Infinity;
    const see = (x, z, r) => {
      for (const m of ms) {
        const d = Math.hypot(m.x - x, m.z - z);
        if (d < r && d < bd) {
          bd = d;
          best = { x, z };
        }
      }
    };
    if (gr.calm <= 0) {
      for (const h of humans) {
        if (h.under) continue; // (down in the mine, under their hooves)
        const s = h.state;
        let r = DEER.notice * wary;
        if (h.downed) r *= DEER.downed;
        else if (s.crouch) r *= DEER.crouch;
        if (s.sprinting) r *= DEER.sprint;
        see(s.x, s.z, r);
      }
    }
    const dread = DEER.dread * wary;
    g.zm.forNear(gr.cx, gr.cz, dread + SPREAD * 2, (z) => {
      if (!z.dead && !z.under) see(z.x, z.z, dread);
    });
    for (const p of g.players.values()) if (p.alive && p.zombie) see(p.state.x, p.state.z, dread);
    return best;
  }

  // A noise at (x,z) that carries `loud` metres (Zombies.noise, the one entry point for every noise in the game):
  // every group it reaches bolts away from it. y: the height it was made at; one down in the mine stays down there.
  hear(x, z, loud, y) {
    const mine = this.g.world.mine;
    if (mine && y !== undefined && mine.under(x, y + 0.3, z)) return;
    for (const gr of this.groups) {
      for (const m of gr.members) {
        if (Math.hypot(m.x - x, m.z - z) < loud) {
          this.bolt(gr, x, z);
          break;
        }
      }
    }
  }

  // The whole group runs from (fx,fz). One that is running already keeps its course unless what startled it now
  // lies ahead (or `hurt`: one of them was hit).
  bolt(gr, fx, fz, hurt = false) {
    const g = this.g;
    const ms = gr.members;
    if (!ms.length || gr.boltCd > 0) return;
    if (gr.mode === MODE.BOLT && !hurt && (fx - gr.cx) * (gr.x - gr.cx) + (fz - gr.cz) * (gr.z - gr.cz) <= 0) return;
    gr.boltCd = 1.5;
    gr.fromX = fx;
    gr.fromZ = fz;
    const to = this.refuge(gr, fx, fz);
    this.setOut(gr, MODE.BOLT, to.x, to.z, DEER.run);
    // each a moment after the other, the one nearest to it first
    for (const m of ms) m.pause = Math.min(0.45, Math.hypot(m.x - fx, m.z - fz) * 0.004) + this.rng() * 0.15;
    if (gr.snortCd <= 0) {
      gr.snortCd = SNORT_EVERY;
      const m = ms[0];
      g.sound(SOUND.DEER_SNORT, m.x, m.y + 1.1, m.z, 75);
    }
  }

  // Where a bolt from (fx,fz) takes the group: straight away from it if that is somewhere a deer can go - open
  // woods it can get to, with no survivor standing there - and otherwise the nearest heading to either side that is.
  refuge(gr, fx, fz) {
    const g = this.g;
    const w = g.world;
    const rng = this.rng;
    let ax = gr.cx - fx;
    let az = gr.cz - fz;
    if (Math.hypot(ax, az) < 0.5) {
      const a = rng() * TAU;
      ax = Math.sin(a);
      az = Math.cos(a);
    }
    const base = Math.atan2(ax, az);
    const side = rng() < 0.5 ? 1 : -1;
    let solves = 0;
    let spare = null; // somewhere open that is not woods, or that no field was spent on
    for (const t of TURNS) {
      const a = base + t * side + (rng() - 0.5) * 0.3;
      for (const k of [1, 0.7, 0.45]) {
        const d = DEER.flee * k;
        const x = gr.cx + Math.sin(a) * d;
        const z = gr.cz + Math.cos(a) * d;
        if (!this.open(x, z)) continue;
        let taken = false;
        for (const p of g.players.values()) if (p.alive && Math.hypot(p.state.x - x, p.state.z - z) < DEER.notice * 1.5) taken = true;
        if (taken) continue;
        const woods = w.zoneAt(x, z) === ZONE.FOREST && w.roadDistAt(x, z) > 6;
        if (!woods || solves >= 3) {
          spare = spare || { x, z };
          continue;
        }
        solves++;
        if (this.reaches(gr, x, z)) return { x, z };
      }
    }
    if (spare) return spare;
    // cornered: as far straight away as the map goes
    return { x: Math.max(-LIM, Math.min(LIM, gr.cx + Math.sin(base) * 25)), z: Math.max(-LIM, Math.min(LIM, gr.cz + Math.cos(base) * 25)) };
  }

  // ---------------------------------------------------------------- one deer
  move(m, gr, dt, humans) {
    const rng = this.rng;
    m.pause -= dt;
    m.losT -= dt;
    let dx = 0;
    let dz = 0;
    let speed = 0;
    let face = null; // what it turns to look at while it stands
    let rest = DANIM.IDLE; // what it does while it stands
    const going = gr.mode === MODE.BOLT || gr.mode === MODE.DRIFT;
    if (going) {
      const run = gr.mode === MODE.BOLT;
      if (!m.arrived && m.pause <= 0) {
        // its own place around the middle of where the group is going (the middle itself if something stands there)
        let tx = gr.x + m.ox;
        let tz = gr.z + m.oz;
        if (!this.open(tx, tz)) {
          tx = gr.x;
          tz = gr.z;
        }
        dx = tx - m.x;
        dz = tz - m.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) m.arrived = true;
        else {
          speed = run ? Math.min(DEER.run, 1.2 + d * 0.9) : DEER.walk * 1.5; // (pulling up over the last few metres)
          if (m.losT <= 0) {
            m.losT = 0.4;
            m.direct = d < 25 && this.clearWay(m.x, m.z, tx, tz, d);
          }
          // round whatever is in the way by the group's flow field (straight on where it has no answer)
          if (!m.direct && this.g.nav.flowDir(gr.key, m.x, m.z, _dir, m.y)) {
            dx = _dir.x;
            dz = _dir.z;
          } else {
            dx /= d;
            dz /= d;
          }
          m.dx += (dx - m.dx) * (run ? 0.45 : 0.6);
          m.dz += (dz - m.dz) * (run ? 0.45 : 0.6);
          dx = m.dx;
          dz = m.dz;
        }
      }
      if (m.arrived) {
        speed = 0;
        if (!run) rest = DANIM.GRAZE;
      }
    } else if (gr.mode === MODE.WARY) {
      face = Math.atan2(-(gr.fromX - m.x), -(gr.fromZ - m.z));
    } else {
      // grazing: head down, a few steps to the next tuft, a look around now and then
      m.look -= dt;
      if (m.moving) {
        dx = m.tx - m.x;
        dz = m.tz - m.z;
        if (Math.hypot(dx, dz) < 0.35) {
          m.moving = false;
          m.pause = 10 + rng() * 22; // (a deer that stands still costs nothing on the wire)
          m.look = rng() < 0.3 ? 1.5 + rng() * 3 : 0;
        } else speed = DEER.walk;
      } else if (m.pause <= 0) this.step(m, gr);
      if (m.look <= 0) rest = DANIM.GRAZE;
    }
    if (m.detourT > 0) {
      m.detourT -= dt;
      dx = m.detourX;
      dz = m.detourZ;
    }
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      dx /= len;
      dz /= len;
    } else speed = 0;
    this.integrate(m, dt, dx * speed, dz * speed, humans);

    // held up by something (a fence, a wall somebody built, a rock): never push at it
    const sp = Math.hypot(m.vx, m.vz);
    if (speed > 0) {
      if (sp < speed * 0.25) m.stuckT += dt;
      else m.stuckT = Math.max(0, m.stuckT - dt * 0.5);
      if (m.stuckT > 0.6) {
        m.stuckT = 0;
        if (!going) {
          // (grazing) that tuft is not worth it
          m.moving = false;
          m.pause = 1 + rng() * 3;
        } else if (++m.stucks > 3) m.arrived = true; // no way on: it stops where it is
        else {
          // a few strides to one side, then the flow field again
          const side = rng() < 0.5 ? 1 : -1;
          m.detourT = 0.5 + rng() * 0.5;
          m.detourX = -dz * side + dx * 0.2;
          m.detourZ = dx * side + dz * 0.2;
          m.direct = false;
          m.losT = 2;
        }
      }
    }
    // facing: the way it goes; standing, what it is watching
    if (sp > 0.3) m.yaw = turn(m.yaw, Math.atan2(-m.vx, -m.vz), dt * (sp > 4 ? 9 : 4));
    else if (face !== null) m.yaw = turn(m.yaw, face, dt * 3);
    // (hysteresis: a speed that hovers at a threshold must not flicker the gait)
    const was = m.anim;
    m.anim = sp > (was === DANIM.RUN ? 2.6 : 3.2) ? DANIM.RUN : sp > (was === DANIM.WALK || was === DANIM.RUN ? 0.12 : 0.3) ? DANIM.WALK : rest;
  }

  // a grazing deer's next few steps: a spot on the group's ground with a clear walk to it
  step(m, gr) {
    const rng = this.rng;
    for (let tries = 0; tries < 5; tries++) {
      const a = rng() * TAU;
      const d = 1 + rng() * 2.5;
      const x = m.x + Math.sin(a) * d;
      const z = m.z + Math.cos(a) * d;
      if (Math.hypot(x - gr.x, z - gr.z) > SPREAD || !this.open(x, z) || !this.clearWay(m.x, m.z, x, z, d)) continue;
      if (gr.members.some((o) => o !== m && Math.hypot((o.moving ? o.tx : o.x) - x, (o.moving ? o.tz : o.z) - z) < 1.4)) continue;
      m.tx = x;
      m.tz = z;
      m.moving = true;
      return;
    }
    // off the group's ground (it strayed, or a bolt left it behind), or nothing near: back towards the others
    const d = Math.hypot(gr.x - m.x, gr.z - m.z);
    if (d > SPREAD) {
      const k = Math.min(1, 10 / d);
      const x = m.x + (gr.x - m.x) * k;
      const z = m.z + (gr.z - m.z) * k;
      if (this.open(x, z)) {
        m.tx = x;
        m.tz = z;
        m.moving = true;
        return;
      }
    }
    m.pause = 2 + rng() * 4;
  }

  // the collision the dogs use (resolveBody against everything that stops the dead, door boards and gates
  // included), never into the lake, never down a mouth of the mine
  integrate(m, dt, dvx, dvz, humans) {
    const g = this.g;
    const w = g.world;
    const accel = Math.min(1, dt * (Math.hypot(dvx, dvz) > 3 ? 8 : 5));
    m.vx += (dvx - m.vx) * accel;
    m.vz += (dvz - m.vz) * accel;
    if (Math.abs(m.vx) < 1e-3 && Math.abs(m.vz) < 1e-3) m.vx = m.vz = 0;
    const ox = m.x;
    const oz = m.z;
    if (m.vx !== 0 || m.vz !== 0) {
      _pos.x = m.x + m.vx * dt;
      _pos.y = m.y;
      _pos.z = m.z + m.vz * dt;
      // round survivors (players are never pushed: their prediction stays exact)
      for (const h of humans) {
        const ddx = _pos.x - h.state.x;
        const ddz = _pos.z - h.state.z;
        const min = DEER.radius + PLAYER_RADIUS + 0.2;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < min * min && Math.abs(h.state.y - m.y) < 1.8) {
          const d = Math.sqrt(d2) || 0.01;
          _pos.x = h.state.x + (ddx / d) * min;
          _pos.z = h.state.z + (ddz / d) * min;
        }
      }
      resolveBody(w, _pos, DEER.radius, DEER.height, false);
      if (deepWaterAt(w, _pos.x, _pos.z, m.y, 0.2, false) || (w.mine && w.mine.inHole(_pos.x, _pos.z))) {
        _pos.x = ox;
        _pos.z = oz;
      }
      m.x = Math.max(-LIM, Math.min(LIM, _pos.x));
      m.z = Math.max(-LIM, Math.min(LIM, _pos.z));
      // what it really moved (after collisions) drives the gait and the stuck test
      m.vx = (m.x - ox) / dt;
      m.vz = (m.z - oz) / dt;
    }
    const gy = groundAt(w, m.x, m.z, m.y, 0.2, false);
    if (m.y > gy + 0.05) {
      m.vy -= GRAV * dt;
      m.y = Math.max(gy, m.y + m.vy * dt);
      if (m.y <= gy) m.vy = 0;
    } else {
      m.y = gy;
      m.vy = 0;
    }
  }

  // ---------------------------------------------------------------- hunting
  // Combat.damageZombie hands a hit on a deer here (a bullet, a bolt, a blade, flame, a blast). Returns true if it
  // killed it. Nothing is counted: no kill on anybody's record, nothing in the killfeed or the night's summary.
  damage(d, amount, attacker, opts = {}) {
    const g = this.g;
    if (d.dead) return false;
    const gr = d.group;
    d.hp -= amount;
    // the group runs from whoever did it, or back along the blow
    const from = attacker && attacker.state ? attacker.state : { x: d.x - (opts.dirX || 0) * 12, z: d.z - (opts.dirZ || 0) * 12 };
    if (d.hp <= 0) this.kill(d);
    else if (!opts.dot || this.rng() < 0.05) g.sound(SOUND.DEER_BLEAT, d.x, d.y + 1, d.z, 45);
    gr.calm = 0;
    this.bolt(gr, from.x, from.z, true);
    return d.dead;
  }

  // It drops where it stood and leaves what DEER_LOOT says, every time. The body lies there for DEER.corpse seconds.
  kill(d) {
    const g = this.g;
    if (d.dead) return;
    d.dead = true;
    d.hp = 0;
    d.deadT = 0;
    d.anim = DANIM.DEAD;
    d.vx = d.vz = 0;
    const ms = d.group.members;
    ms.splice(ms.indexOf(d), 1);
    g.sound(SOUND.DEER_BLEAT, d.x, d.y + 0.8, d.z, 45);
    // (Game.dropItem scatters what it drops by game.rng: for the length of these drops that is the deer's stream)
    const rng = g.rng;
    g.rng = this.rng;
    try {
      for (const [item, lo, hi] of DEER_LOOT) g.dropItem(item, lo + Math.floor(this.rng() * (hi - lo + 1)), d.x, d.y, d.z, { spread: 0.5 + this.rng() * 0.6, life: 240 });
    } finally {
      g.rng = rng;
    }
  }

  // an explosion (Combat.explode, with what it does to zombies): the same to every deer inside it
  blast(x, y, z, radius, dmg, owner, weapon) {
    for (const d of [...this.g.deer]) {
      if (d.dead) continue;
      const dist = Math.hypot(d.x - x, d.y + 0.8 - y, d.z - z);
      if (dist > radius) continue;
      const dl = Math.hypot(d.x - x, d.z - z) || 1;
      this.damage(d, dmg * (0.35 + 0.65 * (1 - dist / radius)), owner || null, { weapon, dirX: (d.x - x) / dl, dirZ: (d.z - z) / dl });
    }
  }

  // burning ground (Combat.updateAreas): what stands in it burns
  scorch(a, dt) {
    for (const d of this.g.deer) {
      if (d.dead || Math.abs(d.y - a.y) > 2 || Math.hypot(d.x - a.x, d.z - a.z) > a.radius) continue;
      const dl = Math.hypot(d.x - a.x, d.z - a.z) || 1;
      this.damage(d, a.dps * dt, a.owner && a.owner.kind === ENT.PLAYER ? a.owner : null, { fire: true, dot: true, dirX: (d.x - a.x) / dl, dirZ: (d.z - a.z) / dl });
    }
  }

  // ---------------------------------------------------------------- debug (/deer, /deer spawn)
  // the group nearest (x,z)
  nearest(x, z) {
    let best = null;
    for (const gr of this.groups) if (gr.members.length && (!best || Math.hypot(gr.cx - x, gr.cz - z) < Math.hypot(best.cx - x, best.cz - z))) best = gr;
    return best;
  }

  // a group `dist` m from (x,z) along yaw, on the nearest open ground to that spot. For `calm` seconds it lets a
  // survivor stand that close; a noise or a hit still sends it off.
  spawnAhead(x, z, yaw, dist = 20, calm = 10) {
    const rng = this.rng;
    const tx = x - Math.sin(yaw) * dist;
    const tz = z - Math.cos(yaw) * dist;
    for (let ring = 0; ring < 12; ring++) {
      for (let k = 0; k < (ring ? 8 : 1); k++) {
        const sx = tx + Math.sin(k * 0.785) * ring * 1.5;
        const sz = tz + Math.cos(k * 0.785) * ring * 1.5;
        if (!this.open(sx, sz)) continue;
        const gr = this.spawnGroup(sx, sz, DEER.groupMin + Math.floor(rng() * (DEER.groupMax - DEER.groupMin + 1)));
        if (gr) gr.calm = calm;
        return gr;
      }
    }
    return null;
  }
}
