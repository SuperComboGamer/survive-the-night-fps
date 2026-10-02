// The wandering herd: a crowd of the dead that shuffles along the valley's roads together by day. It keeps to a slow
// walk until one of them notices a survivor, or a noise reaches any of them (Zombies.noise) - then the whole herd
// comes at a run. Lose them and they search the spot for a while, then drift back to the road.
import { MAP_HALF, PHASE } from '../shared/constants.js';
import { ZTYPE, SOUND, NOTIFY } from '../shared/defs.js';

export const HERD_RUSH = 5; // m/s roused: faster than a survivor walks, slower than a sprint
const HERD_MIN = 10; // zombies in a herd
const HERD_MAX = 15;
const DISBAND = 4; // fewer than this left (and nobody to chase): the stragglers wander off on their own
const PACE = 0.9; // m/s the herd wanders at
const SPREAD = 5.5; // the crowd stands within this of the herd's waypoint (m)
const STEP = 12; // road points (~2 m apart) the waypoint leads the herd by
const REACH = 9; // the waypoint moves on once the middle of the herd is this close to it (m)
const STALL = 75; // ...or after this long without getting there (s): something is in the way
const FAR = 48; // a member further than this from its place follows the flow field instead of walking straight at it
const ROUSE = 20; // s the whole herd stays on a survivor one of them noticed (then only those still sensing them)
const SEARCH = 12; // s it mills about where the noise came from / where it lost its quarry
const RESPAWN = 90; // s of daylight after the last of a herd is gone before another one turns up
const CAR_CLEAR = 60; // the herd's route keeps this far from the survivors' car (m)
const SPAWN_CLEAR = 110; // a herd turns up at least this far from the car and from every survivor (m)
const LIM = MAP_HALF - 20;

export class Herds {
  constructor(game, zm) {
    this.g = game;
    this.zm = zm;
    this.list = new Map(); // id -> herd
    this.seq = 0;
    this.spawnT = 0; // s of daylight until the next herd may turn up
  }

  // new game: the old world's herds are gone with its zombies
  reset() {
    for (const h of this.list.values()) this.g.nav.removeField(h.key);
    this.list.clear();
    this.spawnT = 0;
  }

  first() {
    for (const h of this.list.values()) return h;
    return null;
  }

  // ---------------------------------------------------------------- spawning
  // a herd on a road, far from the car and out of every survivor's sight
  spawn(humans) {
    const g = this.g;
    const roads = g.world.roads;
    const car = g.world.car;
    for (let tries = 0; tries < 40; tries++) {
      const road = Math.floor(g.rng() * roads.length);
      const pts = roads[road].pts;
      const at = Math.floor(g.rng() * (pts.length / 2));
      const x = pts[at * 2];
      const z = pts[at * 2 + 1];
      if (!this.routeOk(x, z) || Math.hypot(x - car.x, z - car.z) < SPAWN_CLEAR || g.nav.isBlocked(x, z)) continue;
      let ok = true;
      for (const p of humans) if (Math.hypot(p.state.x - x, p.state.z - z) < SPAWN_CLEAR) ok = false;
      if (!ok) continue;
      const id = ++this.seq;
      const h = {
        id,
        key: 'herd' + id, // its flow field (nav.js)
        road,
        at,
        dir: this.pickDir(road, at) || 1,
        prev: -1, // the road it came off (it does not turn straight back onto it)
        x, // waypoint
        z,
        gx: x, // where the crowd is heading: the waypoint, or (ax,az) while roused
        gz: z,
        cx: x, // middle of the herd
        cz: z,
        members: [],
        prey: 0, // survivor the herd is after
        rouseT: 0,
        ax: x, // where the noise came from / where its quarry was last seen
        az: z,
        searchT: 0,
        hot: false, // roused: running at someone or searching, instead of wandering
        restT: 2 + g.rng() * 6,
        stallT: 0,
        fieldT: 0,
      };
      const n = HERD_MIN + Math.floor(g.rng() * (HERD_MAX - HERD_MIN + 1));
      for (let i = 0; i < n * 3 && h.members.length < n; i++) {
        const a = g.rng() * Math.PI * 2;
        const r = Math.sqrt(g.rng()) * SPREAD;
        const e = this.zm.spawn(g.rng() < 0.8 ? ZTYPE.WALKER : ZTYPE.RUNNER, x + Math.sin(a) * r, z + Math.cos(a) * r, { hpMul: 1 + 0.05 * g.day });
        if (!e) continue;
        e.herd = id;
        e.herdX = Math.sin(a) * r;
        e.herdZ = Math.cos(a) * r;
        h.members.push(e);
      }
      if (!h.members.length) return null; // no room for more zombies
      this.list.set(id, h);
      return h;
    }
    return null;
  }

  // ---------------------------------------------------------------- route
  // may the herd walk here? Inside the map and clear of the car (a herd trampling the base every lap is no fun)
  routeOk(x, z) {
    const car = this.g.world.car;
    return Math.abs(x) < LIM && Math.abs(z) < LIM && Math.hypot(x - car.x, z - car.z) > CAR_CLEAR;
  }

  // road points the herd can walk from point `at` of a road in direction dir (counted up to max)
  ahead(road, at, dir, max) {
    const pts = this.g.world.roads[road].pts;
    const n = pts.length / 2;
    let k = 0;
    for (let j = at + dir; j >= 0 && j < n && k < max && this.routeOk(pts[j * 2], pts[j * 2 + 1]); j += dir) k++;
    return k;
  }

  // a direction with a good stretch of road left (either one, at random, when both have): 1, -1, or 0 for none
  pickDir(road, at) {
    const fwd = this.ahead(road, at, 1, STEP * 2) >= STEP * 2;
    const back = this.ahead(road, at, -1, STEP * 2) >= STEP * 2;
    if (fwd && back) return this.g.rng() < 0.5 ? 1 : -1;
    return fwd ? 1 : back ? -1 : 0;
  }

  setWaypoint(h, x, z) {
    h.x = x;
    h.z = z;
    h.stallT = 0;
    h.fieldT = 0;
  }

  // onto another road that passes within `reach` m of the waypoint (not the one it is on or just came off)
  turnOff(h, reach) {
    const g = this.g;
    const roads = g.world.roads;
    let pick = -1;
    let pickAt = 0;
    let pickDir = 0;
    let seen = 0;
    for (let road = 0; road < roads.length; road++) {
      if (road === h.road || road === h.prev) continue;
      const pts = roads[road].pts;
      let bd = reach;
      let at = -1;
      for (let k = 0; k < pts.length; k += 2) {
        const d = Math.hypot(pts[k] - h.x, pts[k + 1] - h.z);
        if (d < bd) {
          bd = d;
          at = k >> 1;
        }
      }
      if (at < 0 || !this.routeOk(pts[at * 2], pts[at * 2 + 1])) continue;
      const dir = this.pickDir(road, at);
      if (!dir || g.rng() * ++seen >= 1) continue; // each candidate is as likely as the next
      pick = road;
      pickAt = at;
      pickDir = dir;
    }
    if (pick < 0) return false;
    h.prev = h.road;
    h.road = pick;
    h.at = pickAt;
    h.dir = pickDir;
    const pts = roads[pick].pts;
    this.setWaypoint(h, pts[pickAt * 2], pts[pickAt * 2 + 1]);
    return true;
  }

  // the herd reached its waypoint: on along the road. At the road's end it stands around a while, then takes
  // another road from there (or turns back); now and then it turns off at a junction on the way.
  advance(h) {
    const g = this.g;
    if (g.rng() < 0.2 && this.turnOff(h, 12)) return;
    const k = this.ahead(h.road, h.at, h.dir, STEP);
    if (k < 4) {
      h.restT = 10 + g.rng() * 20;
      if (!this.turnOff(h, 40)) {
        h.dir = -h.dir;
        h.prev = -1;
        h.stallT = 0;
      }
      return;
    }
    h.at += h.dir * k;
    const pts = g.world.roads[h.road].pts;
    this.setWaypoint(h, pts[h.at * 2], pts[h.at * 2 + 1]);
  }

  // back to the nearest road from wherever the chase ended
  rejoin(h) {
    const g = this.g;
    const roads = g.world.roads;
    let bd = Infinity;
    for (let road = 0; road < roads.length; road++) {
      const pts = roads[road].pts;
      for (let k = 0; k < pts.length; k += 2) {
        const d = Math.hypot(pts[k] - h.cx, pts[k + 1] - h.cz);
        if (d >= bd || !this.routeOk(pts[k], pts[k + 1])) continue;
        bd = d;
        h.road = road;
        h.at = k >> 1;
      }
    }
    h.prev = -1;
    h.dir = this.pickDir(h.road, h.at) || h.dir;
    const pts = roads[h.road].pts;
    this.setWaypoint(h, pts[h.at * 2], pts[h.at * 2 + 1]);
    h.restT = 4 + g.rng() * 6;
  }

  // ---------------------------------------------------------------- update
  update(dt, humans) {
    const g = this.g;
    if (g.phase === PHASE.DAY && !this.list.size) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) this.spawnT = this.spawn(humans) ? RESPAWN : 10;
    }
    if (!this.list.size) return;
    for (const h of this.list.values()) h.members.length = 0;
    for (const z of g.zombies) {
      if (!z.herd || z.dead) continue;
      const h = this.list.get(z.herd);
      // nightfall / the final stand turns them into horde: from then on they hunt like the rest of it
      if (!h || z.horde) z.herd = 0;
      else h.members.push(z);
    }
    for (const h of this.list.values()) {
      if (h.members.length >= DISBAND || (h.hot && h.members.length)) this.tick(h, dt);
      else {
        // what is left of it is no herd any more: they roam like any other of the dead, and a new herd is due
        for (const z of h.members) z.herd = 0;
        g.nav.removeField(h.key);
        this.list.delete(h.id);
        this.spawnT = RESPAWN;
      }
    }
  }

  tick(h, dt) {
    const g = this.g;
    const ms = h.members;
    let cx = 0;
    let cz = 0;
    let prey = null;
    let heard = null;
    for (const z of ms) {
      cx += z.x;
      cz += z.z;
      if (z.target) {
        const p = prey ? null : g.players.get(z.target);
        if (p && p.alive && !p.zombie) prey = p;
      } else if (z.alertT > 0) {
        // a noise is the herd's business, not this one zombie's: the lot of them go (see hear)
        heard = z;
        z.alertT = 0;
      }
    }
    h.cx = cx / ms.length;
    h.cz = cz / ms.length;
    h.rouseT -= dt;
    h.searchT -= dt;
    if (prey) {
      if (h.rouseT <= 0) this.rouse(h, prey);
      h.ax = prey.state.x;
      h.az = prey.state.z;
      h.searchT = SEARCH;
    } else if (heard) this.hear(h, heard.alertX, heard.alertZ);

    const hot = h.searchT > 0;
    if (h.hot && !hot) this.rejoin(h); // nobody there any more: back to the road
    h.hot = hot;
    if (hot) {
      h.gx = h.ax;
      h.gz = h.az;
    } else {
      if (h.restT > 0) h.restT -= dt;
      else {
        h.stallT += dt;
        if (Math.hypot(h.cx - h.x, h.cz - h.z) < REACH || h.stallT > STALL) this.advance(h);
      }
      h.gx = h.x;
      h.gz = h.z;
    }
    // flow field to the goal, for members that are far from it or stuck behind something
    h.fieldT -= dt;
    if (h.fieldT <= 0) {
      h.fieldT = hot ? 1 : 2;
      g.nav.computeField(h.key, h.gx, h.gz);
    }
  }

  // One of them has a survivor: every other one that has nobody goes for the same survivor. Their aggro runs out
  // before the next rouse is due, so the herd only stays on someone that some of them can still sense by then.
  rouse(h, p) {
    const g = this.g;
    h.rouseT = ROUSE;
    for (const z of h.members) {
      if (z.target) continue;
      z.target = p.id;
      z.aggroId = p.id;
      z.aggroT = ROUSE - 1.5;
    }
    if (h.hot && h.prey === p.id) return;
    h.prey = p.id;
    g.notify(NOTIFY.HERD, h.members.length, p.id);
    this.cry(h, 3, 90);
  }

  // a noise reached one of them: the whole herd runs to where it came from and looks around
  hear(h, x, z) {
    if (!h.hot) this.cry(h, 2, 70);
    h.prey = 0;
    h.ax = x;
    h.az = z;
    h.searchT = SEARCH + Math.hypot(h.cx - x, h.cz - z) / HERD_RUSH;
    h.fieldT = 0;
  }

  // a few of them call out: the survivors hear what they woke
  cry(h, n, r) {
    const g = this.g;
    const ms = h.members;
    for (let i = 0; i < n; i++) {
      const z = ms[Math.floor(g.rng() * ms.length)];
      g.sound(z.ztype === ZTYPE.RUNNER ? SOUND.RUNNER_SCREAM : SOUND.ZOMBIE_GROWL, z.x, z.y + z.def.headY, z.z, r);
    }
  }

  // ---------------------------------------------------------------- members
  // Where a herd member with nobody to chase heads this tick: its place in the crowd around the herd's waypoint (or
  // around the noise / the spot the herd last saw someone). Writes the direction to out, returns the speed.
  steer(z, dt, out) {
    const h = this.list.get(z.herd);
    out.x = 0;
    out.z = 0;
    if (!h) return 0;
    const dx = h.gx + z.herdX - z.x;
    const dz = h.gz + z.herdZ - z.z;
    const d = Math.hypot(dx, dz);
    // got stuck on the way (the stuck detour kicked in): follow the flow field around whatever it was for a while
    if (z.detourT > 0) z.herdNav = 6;
    else if (z.herdNav > 0) z.herdNav -= dt;
    if (d >= 1 && !((z.herdNav > 0 || d > FAR) && this.g.nav.flowDir(h.key, z.x, z.z, out))) {
      out.x = dx / d;
      out.z = dz / d;
    }
    if (h.hot) return Math.max(z.def.speed, HERD_RUSH);
    // keep together: the ones out in front dawdle, stragglers hurry
    const lead = Math.hypot(h.cx - h.gx, h.cz - h.gz) - Math.hypot(z.x - h.gx, z.z - h.gz);
    return PACE * Math.max(0.45, Math.min(1.7, 1 - lead / 8));
  }
}
