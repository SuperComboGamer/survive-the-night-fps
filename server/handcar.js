// The handcars on the railway, server side (the rules both ends share, and where the cars stand: shared/handcar.js).
// Each is one entity, ENT.HANDCAR, made with every new game: where it is on the line (`s`, a point of rail.main),
// its speed (`v`) and who rides it are the run's state. While a survivor rides it the car is in their simulated
// state and goes where their commands take it: the entity only follows (update). Nobody on it, it rolls on here
// by itself until it stops. What their prediction cannot know of is settled here, and puts the rider's state
// right (a rebase, as a knockback is): two cars on one stretch of line running into each other, and the dead on
// the line - a car going at any speed knocks them out of its way, and a big one stops it dead.
import { SERVER_DT, INTERACT_REACH, INTERACT_SLACK, EYE_HEIGHT } from '../shared/constants.js';
import { SOUND } from '../shared/defs.js';
import { ENT } from '../shared/protocol.js';
import { HANDCAR, handcars, rollCar, cartCarry, carFrame } from '../shared/handcar.js';
import { canReach, groundAt } from '../shared/collision.js';
import { eyeHeight } from '../shared/playersim.js';

const BOARD_SLACK = 0.3; // seconds of a car's travel the client may have drawn it behind where it is ([E] on a moving car)
const MIN_GAP = HANDCAR.half * 2 + 0.05; // two cars on one stretch keep at least this far between their middles
const BOUNCE = 0.3; // what is left of the speed they met at, after two cars meet
const STRIKE = 3; // m/s: a car this fast knocks the dead out of its way...
const STRIKE_DMG = 9; // ...for this much damage per m/s
const STRIKE_SLOW = 0.85; // ...and is slowed to this much of its speed by each it hits
const STRIKE_AGAIN = 0.6; // seconds before the same car can strike the same body again
const _f = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

export class Handcars {
  constructor(game) {
    this.g = game;
    this.cars = []; // the ENT.HANDCAR entities, by car (handcars(world) order; null: no entity id was left for it)
  }

  // A new game: every car back where the section gang left it, standing, nobody on it.
  spawn() {
    const g = this.g;
    const m = g.world.rail?.main;
    this.cars = handcars(g.world).map((c, k) => {
      const e = { kind: ENT.HANDCAR, k, s: c.at, v: 0, rider: 0, x: 0, y: 0, z: 0 };
      this.place(e, m);
      return g.spawnEntity(e);
    });
  }

  // the handoff (gamestate.js): each car where it is on the line, its speed and its rider (null: no entity for it)
  save() {
    return this.cars.map((e) => (e && !e.removed ? { ...e } : null));
  }
  load(s) {
    this.cars = s.map((c) => (c ? this.g.spawnEntityAt({ ...c }, c.id) : null));
  }

  place(e, m) {
    carFrame(m, e.s, _f);
    e.x = _f.x;
    e.y = _f.y;
    e.z = _f.z;
  }

  // the rider of car e, if they are still on it
  riderOf(e) {
    if (!e.rider) return null;
    const p = this.g.players.get(e.rider);
    return p && p.alive && p.state.cart === e.k + 1 ? p : null;
  }

  // car e's place and speed into its rider's state: something other than their commands moved it
  push(e) {
    const p = this.riderOf(e);
    if (!p) return;
    const s = p.state;
    s.cartS = e.s;
    s.cartV = e.v;
    cartCarry(s, this.g.world);
  }

  // Once a tick, after the commands: a car with a rider follows them, the rest roll on; then what they run into.
  update() {
    const g = this.g;
    if (!this.cars.length) return;
    const world = g.world;
    const m = world.rail.main;
    const runs = handcars(world);
    for (const e of this.cars) {
      if (!e || e.removed) continue;
      const run = runs[e.k];
      const p = e.rider ? g.players.get(e.rider) : null;
      if (p && p.state.cart === e.k + 1) {
        const s = p.state;
        // (where they last had it: the moment they got off, or as of now)
        e.s = s.cartS;
        e.v = s.cartV;
        if (!p.alive) {
          // the dead are not simulated: the body comes down off the deck where it was, the car rolls on without it
          s.cart = 0;
          s.y = groundAt(world, s.x, s.z, s.y, 0.3);
          e.rider = 0;
        }
      } else {
        // they got off (with the speed it had, which it keeps), went down, turned or left
        if (p && !p.state.cart && e.rider) {
          e.s = p.state.cartS;
          e.v = p.state.cartV;
        }
        e.rider = 0;
        if (rollCar(m, run, e, 0, false, SERVER_DT)) g.sound(SOUND.METAL_HIT, e.x, e.y, e.z, 40);
      }
    }
    // a survivor whose state has them on a car that is not theirs (a new game under them) is off it
    for (const p of g.players.values()) {
      const s = p.state;
      if (s.cart && this.cars[s.cart - 1]?.rider !== p.id) {
        s.cart = 0;
        s.onGround = 0;
      }
    }
    this.meet(runs);
    for (const e of this.cars) {
      if (!e || e.removed) continue;
      this.strike(e, m);
      this.place(e, m);
    }
  }

  // Two cars on one stretch of line that have run into each other: they part at MIN_GAP, and the speed they met at
  // is shared out as between two equal weights that give back a little of it.
  meet(runs) {
    const g = this.g;
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        if (!a || !b || a.removed || b.removed || runs[a.k].run !== runs[b.k].run) continue;
        const [lo, hi] = a.s <= b.s ? [a, b] : [b, a];
        const gap = hi.s - lo.s;
        if (gap >= MIN_GAP) continue;
        const closing = lo.v - hi.v;
        if (closing > 0) {
          const mid = (lo.v + hi.v) / 2;
          lo.v = mid - (closing * BOUNCE) / 2;
          hi.v = mid + (closing * BOUNCE) / 2;
          if (closing > HANDCAR.bump) g.sound(SOUND.METAL_HIT, (lo.x + hi.x) / 2, lo.y, (lo.z + hi.z) / 2, 50);
        }
        // apart, each by half (or all of it, the one that has the end of the stretch behind it)
        const run = runs[lo.k];
        const back = Math.min((MIN_GAP - gap) / 2, lo.s - run.lo);
        lo.s -= back;
        hi.s = Math.min(run.hi, lo.s + MIN_GAP);
        if (hi.s - lo.s < MIN_GAP) lo.s = hi.s - MIN_GAP;
        this.push(lo);
        this.push(hi);
      }
    }
  }

  // The dead in the way of a moving car: knocked off the line to the side they stand on, and the car loses a
  // little speed to each one. Something as big as a Tank (or a boss) stops it dead and stands where it is.
  strike(e, m) {
    const speed = Math.abs(e.v);
    if (speed < STRIKE) return;
    const g = this.g;
    carFrame(m, e.s, _f);
    const tx = Math.sin(_f.yaw);
    const tz = Math.cos(_f.yaw);
    const dir = e.v > 0 ? 1 : -1;
    const rider = this.riderOf(e);
    let hit = false;
    for (const z of g.zombies) {
      if (z.dead || z.def.flying) continue;
      const dx = z.x - _f.x;
      const dz = z.z - _f.z;
      if (dx * dx + dz * dz > 16 || Math.abs(z.y - _f.y) > 2.2) continue;
      const along = (dx * tx + dz * tz) * dir;
      const lat = dx * tz - dz * tx;
      const r = z.def.radius;
      if (along < -HANDCAR.half || along > HANDCAR.half + r + 0.6 || Math.abs(lat) > HANDCAR.halfW + r) continue;
      if (z.cartT > g.time) continue;
      z.cartT = g.time + STRIKE_AGAIN;
      const side = lat >= 0 ? 1 : -1;
      const big = z.boss || z.def.radius > 0.8;
      g.combat.damageZombie(z, speed * STRIKE_DMG, rider, { melee: true, knock: big ? 0 : 6, dirX: tz * side * 0.8 + tx * dir * 0.6, dirZ: -tx * side * 0.8 + tz * dir * 0.6 });
      g.sound(SOUND.FLESH_HIT, z.x, z.y + 1, z.z, 30);
      e.v = big ? 0 : e.v * STRIKE_SLOW;
      hit = true;
      if (big) break;
    }
    if (hit) this.push(e);
  }

  // ACT.HANDCAR: onto car k, if nobody is on it and it is in reach (as the client offers it)
  board(p, k) {
    const g = this.g;
    const s = p.state;
    const e = this.cars[k];
    if (!e || e.removed || e.rider || s.cart || s.ride || s.pinned || s.pulled || s.hmg) return; // (hmg: arms full of the mounted gun)
    if (g.time - p.interactT < 0.15) return;
    p.interactT = g.time;
    carFrame(g.world.rail.main, e.s, _f);
    const ey = s.y + eyeHeight(s);
    const ty = _f.y + HANDCAR.pick.y;
    if (Math.hypot(_f.x - s.x, ty - ey, _f.z - s.z) > Math.hypot(INTERACT_REACH, HANDCAR.pick.r) + INTERACT_SLACK + Math.abs(e.v) * BOARD_SLACK) return;
    if (!canReach(g.world, s.x, ey, s.z, _f.x, ty, _f.z, s.y + EYE_HEIGHT)) return;
    this.seat(p, e);
    g.sound(SOUND.RIDE_BOARD, _f.x, _f.y + 0.5, _f.z, 25);
  }

  seat(p, e) {
    const s = p.state;
    p.hold = null;
    e.rider = p.id;
    s.cart = e.k + 1;
    s.cartS = e.s;
    s.cartV = e.v;
    cartCarry(s, this.g.world);
  }

  // /handcar [n]: onto car n (1, 2), or the first one nobody is on
  debug(p, arg) {
    const g = this.g;
    if (!this.cars.some(Boolean)) return g.systemChat('this valley has no handcar (no railway, or no stretch of it long enough)');
    const k = arg ? (parseInt(arg, 10) || 1) - 1 : this.cars.findIndex((e) => e && (!e.rider || e.rider === p.id));
    const e = this.cars[k];
    if (!e) return g.systemChat(`there ${this.cars.length === 1 ? 'is one handcar' : `are ${this.cars.length} handcars`} here`);
    if (e.rider && e.rider !== p.id) return g.systemChat(`${g.players.get(e.rider)?.name || 'somebody'} is on that one`);
    const s = p.state;
    const was = s.cart && s.cart !== e.k + 1 ? this.cars[s.cart - 1] : null;
    if (was) was.rider = 0;
    s.ride = 0;
    s.pinned = s.pulled = 0;
    s.stunT = 0;
    this.seat(p, e);
    g.fillHistory(p);
  }
}
