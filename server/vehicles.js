// Ground transport, server side (the rules both ends share, the physics and where they stand: shared/vehicles.js).
// Only the mainland has any. Each is one entity, ENT.VEHICLE: where it is and points, how it moves, its tank and its
// health, the parts it still wants, who sits in it. While a survivor drives, the vehicle is in their simulated state
// and goes where their commands take it: the entity only follows (update). Nobody at the wheel, it is stepped here
// until it stands, and standing empty it is a box in the world (vehicleGrid) that everything walks round.
// What a driver's prediction cannot know of is settled here and written into their state, which rebases their
// client: the dead in its way (strike), a blow on it (damage), fuel poured in, a breakdown.
import { SERVER_DT, CMD_DT, INTERACT_REACH, INTERACT_SLACK, PLAYER_RADIUS, PLAYER_HEIGHT, NOISE, PHASE, BTN, WATER_LEVEL } from '../shared/constants.js';
import { SOUND, NOTIFY, ITEM, AMMO, AMMO_MAX, KILLER, VEH_NO, VEH_OFFS, IMPACT, SCHEM_BIT } from '../shared/defs.js';
import { ENT, HOLD, VACT, VFLAG, SIPHON_ID, qpos, dqpos, qangle16, dqangle16 } from '../shared/protocol.js';
import { WORLD } from '../shared/acts.js';
import { CROWD_SLOW, VEH, VSTATE, VEHICLES, VEH_NAMES, FIX, fixMask, REPAIR, REPAIR_HP, FIX_TIME, STARTER_TIME, FIX_FREE, REPAIR_TIME, FUEL_TIME, FUEL_POUR, SIPHON_TIME, STARTERS, QUEST_FUEL, QUEST_HP, COL_VEHICLE, HORN, stepVehicle, seatAt, seatFeet, vehicleSpots, starterSpots, questCar, vehicleGrid, parkedCollider, siphonOf } from '../shared/vehicles.js';
import { COL, resolveBody, groundAt, pushCircle } from '../shared/collision.js';
import { mulberry32 } from '../shared/rng.js';
import { countItem, removeItem } from './inventory.js';

const SEATS = 4;
const QUEST_SEATS = VEHICLES[VEH.CAR].seats.length;
const STRIKE = CROWD_SLOW; // m/s: one going this fast knocks the dead down instead of pushing at them
const STRIKE_AGAIN = 0.7; // s before the same vehicle strikes the same body again
// what running one of the dead over does, by kind: damage to it per m/s, what is left of the vehicle's speed, the
// damage the vehicle takes (flat + per m/s), and from what speed it throws a rider on two wheels
const RAM = {
  [VEH.CAR]: { dmg: 14, keep: 0.86, hurt: 6, hurtV: 1.5, throwAt: 0 },
  [VEH.MOPED]: { dmg: 7, keep: 0.5, hurt: 10, hurtV: 2, throwAt: 9.5 },
  [VEH.BIKE]: { dmg: 4, keep: 0.4, hurt: 6, hurtV: 1.2, throwAt: 7 },
};
const CRASH_FROM = 3; // m/s into something solid before it costs anything...
const CRASH_DMG = { [VEH.CAR]: 1.5, [VEH.MOPED]: 1.2, [VEH.BIKE]: 0.8 }; // ...then this x (m/s over it)^2
const CRASH_HURT_FROM = 11; // m/s: who is in a car is hurt by a crash from here...
const CRASH_HURT = 4; // ...by this per m/s over it; a rider thrown: THROWN_HURT per m/s over the throw
const THROWN_HURT = 5;
const SHELL = 0.5; // a car keeps the dead off who is in it while it has this share of its health; under it they get in
const WRECK_POOL = 0.6; // broken down, it takes this share of its health again before it is burnt out for good
const NOISE_EVERY = 1.3; // s between the engine's calls on the dead
const START_FUEL = [0.12, 0.3]; // of a tank: what one that has just been fixed has in it
const STARTER_FUEL = 0.4;
const STARTER_CAN = 40; // Fuel left on the ground beside each of the first ones
const JUMP_HURT_FROM = 8; // m/s: getting out of one going faster than this hurts...
const JUMP_HURT = 4; // ...this per m/s over
const _seat = { x: 0, y: 0, z: 0 };
const _pos = { x: 0, y: 0, z: 0 };
const _ev = [];
const _push = { x: 0, z: 0, nx: 0, nz: 0 };
const MASS = { [VEH.CAR]: 1200, [VEH.MOPED]: 170, [VEH.BIKE]: 95 }; // kg, with somebody on it: who gives way to whom
// what of each stops a round, as slabs of its height (m over its wheels' ground): [from, to]
const SHOT_BOX = { [VEH.CAR]: [[0.22, 0.93], [1.36, 1.47]], [VEH.MOPED]: [[0.15, 0.8]], [VEH.BIKE]: [[0.15, 0.75]] };
// a ray against the box |x| <= hx, y0 <= y <= y1, |z| <= hz: where it enters (0: from inside), or -1
function rayBox(ox, oy, oz, dx, dy, dz, hx, y0, y1, hz, maxT) {
  let t0 = 0, t1 = maxT;
  for (let k = 0; k < 3; k++) {
    const o = k === 0 ? ox : k === 1 ? oy : oz, d = k === 0 ? dx : k === 1 ? dy : dz;
    const lo = k === 0 ? -hx : k === 1 ? y0 : -hz, hi = k === 0 ? hx : k === 1 ? y1 : hz;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  return t0;
}

export class Vehicles {
  constructor(game) {
    this.g = game;
    this.list = []; // the ENT.VEHICLE entities
    this.rng = mulberry32(1); // its own stream: nothing here draws from the game's
    this.siphoned = new Set(); // the wrecks whose tanks have been drawn off ("qx,qz" of the prop)
    this.props = null; // "qx,qz" -> the prop, of every wreck with something in its tank (by world)
    this.propsOf = null;
    this.starters = 0; // how many of the bridgehead's are out
  }

  // ---------------------------------------------------------------- the run
  // The world is being cleared (a new game, the crossing): every box out of it.
  clear() {
    for (const e of this.list) this.unpark(e);
    this.list.length = 0;
    this.siphoned.clear();
    this.starters = 0;
  }

  // A map is being stocked (Game.populate, last of all, so that nothing else's ids or random draws move). The island
  // has none. The mainland: the car the team crossed in, running; the broken ones about the map; and near the
  // bridgehead what the team needs beyond that car's seats (provide).
  spawn(team) {
    const g = this.g;
    const w = g.world;
    vehicleGrid(w);
    const q = questCar(w); // (also takes the parked prop's own collider out of the world: the vehicle has its box)
    this.rng = mulberry32((g.seed ^ 0x0ca75) >>> 0);
    if (w.kind !== WORLD.MAINLAND) return;
    if (q) {
      const P = VEHICLES[VEH.CAR];
      this.make(VEH.CAR, q.x, q.z, q.yaw, { state: VSTATE.OK, need: 0, fuel: P.tank * QUEST_FUEL, hp: P.hp * QUEST_HP, tint: 7, quest: true });
    }
    let manuals = 0;
    for (const s of vehicleSpots(w)) {
      const e = this.make(s.kind, s.x, s.z, s.yaw, { tint: s.tint });
      // the workshop manual (a moped and a bicycle built at a bench: defs.js RECIPES) lies by the first two broken
      // mopeds of the map - it is the mainland's, and found where what it is about stands
      if (e && s.kind === VEH.MOPED && manuals < 2 && !(g.unlocked & (1 << SCHEM_BIT[ITEM.SCHEM_VEHICLES]))) {
        manuals++;
        const P = VEHICLES[s.kind];
        const mx = s.x - Math.cos(s.yaw) * (P.halfW + 0.6), mz = s.z + Math.sin(s.yaw) * (P.halfW + 0.6);
        const swap = g.rng;
        g.rng = this.rng;
        g.spawnItem(ITEM.SCHEM_VEHICLES, 1, mx, groundAt(w, mx, mz, s.y + 1, 0.2), mz, { permanent: true });
        g.rng = swap;
      }
    }
    this.provide(team);
  }

  // A vehicle made at a workbench (Game.craft): stood on the nearest clear ground round whoever made it, running,
  // with a splash of fuel in it. dry: only say whether it can be (0), or why not (a VEH_NO).
  build(p, kind, dry = false) {
    const g = this.g;
    const w = g.world;
    if (w.kind !== WORLD.MAINLAND) return VEH_NO.NOT_HERE;
    const P = VEHICLES[kind];
    const s = p.state;
    const grid = vehicleGrid(w);
    const clear = (x, z, yaw) => {
      const y = groundAt(w, x, z, s.y + 1.2, 0.3, false);
      if (Math.abs(y - s.y) > 1.2 || y < WATER_LEVEL + 0.05) return false;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      for (const c of P.circles) {
        const px = x - fx * c[0], pz = z - fz * c[0];
        for (const gr of [w.staticGrid, w.structGrid, grid.parked]) {
          for (const col of gr.query(px, pz, c[1] + 0.25, [])) {
            if (col.flags & COL.NOBLOCK || col.y1 <= y + P.step || col.y0 >= y + P.h) continue;
            if (pushCircle(col, px, pz, c[1] + 0.15, _push)) return false;
          }
        }
        for (const q of g.players.values()) if (q.alive && Math.hypot(q.state.x - px, q.state.z - pz) < c[1] + 0.45) return false;
      }
      for (const e of this.list) if (!e.removed && Math.hypot(e.x - x, e.z - z) < P.half + VEHICLES[e.vk].half + 0.2) return false;
      return true;
    };
    for (const d of [P.half + 1.3, P.half + 2.4, P.half + 3.6]) {
      for (let k = 0; k < 12; k++) {
        const a = s.yaw + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 6);
        const x = s.x - Math.sin(a) * d, z = s.z - Math.cos(a) * d;
        const yaw = a + Math.PI / 2;
        if (!clear(x, z, yaw)) continue;
        if (dry) return 0;
        const e = this.make(kind, x, z, yaw, { state: VSTATE.OK, need: 0, fuel: P.tank * START_FUEL[0], hp: P.hp, tint: (g.tick + p.id) % 6, built: true });
        if (e) g.notify(NOTIFY.VEH_FIXED, p.id);
        return e ? 0 : VEH_NO.NO_ROOM;
      }
    }
    return VEH_NO.NO_ROOM;
  }

  // Seats for everybody near where the team is put down: the car it came in has four, and for every survivor past
  // that the next of the bridgehead's vehicles is stood out. Those want no parts, only a few seconds' work ([E] held:
  // nothing a passing teammate can walk off with stands between a survivor and a seat), and a can of fuel lies
  // beside each. Always the first of them, as a spare. Called as the map is stocked and again whenever somebody joins.
  provide(team = this.g.players.size) {
    const g = this.g;
    const w = g.world;
    if (w.kind !== WORLD.MAINLAND) return;
    const spots = starterSpots(w);
    let seats = QUEST_SEATS;
    for (let i = 0; i < this.starters; i++) seats += VEHICLES[spots[i].kind].seats.length;
    while (this.starters < spots.length && (this.starters < 1 || seats < team)) {
      const s = spots[this.starters++];
      const P = VEHICLES[s.kind];
      const e = this.make(s.kind, s.x, s.z, s.yaw, { tint: s.tint, need: 0, fuel: P.tank * STARTER_FUEL, hp: P.hp * 0.8, starter: true });
      if (!e) break;
      seats += P.seats.length;
      // fuel beside it
      const sx = s.x + Math.cos(s.yaw) * (P.halfW + 0.7);
      const sz = s.z - Math.sin(s.yaw) * (P.halfW + 0.7);
      const swap = g.rng;
      g.rng = this.rng;
      if (P.tank) g.spawnItem(ITEM.AMMO_FUEL, STARTER_CAN, sx, groundAt(w, sx, sz, s.y + 1, 0.2), sz, { life: 1e6 });
      g.rng = swap;
    }
  }

  // one more of them, standing at (x, z). opts: state, need, fuel, hp, tint, starter, quest
  make(vk, x, z, yaw, opts = {}) {
    const g = this.g;
    const P = VEHICLES[vk];
    const e = {
      kind: ENT.VEHICLE,
      vk,
      tint: opts.tint ?? 0,
      x,
      y: groundAt(g.world, x, z, 200, 0.25, false),
      z,
      yaw,
      vx: 0,
      vz: 0,
      vf: 0,
      steer: 0,
      fuel: opts.fuel ?? P.tank * (START_FUEL[0] + this.rng() * (START_FUEL[1] - START_FUEL[0])),
      hp: opts.hp ?? P.hp * (0.55 + this.rng() * 0.3),
      state: opts.state ?? VSTATE.BROKEN,
      need: opts.need ?? fixMask(vk),
      lights: 0,
      horn: 0,
      brake: 0,
      thr: 0,
      skidT: 0,
      wreckHp: 0,
      seats: [0, 0, 0, 0],
      starter: !!opts.starter,
      quest: !!opts.quest,
      built: !!opts.built, // made at a workbench (Game.craft)
      noiseT: 0,
      hornT: 0,
      run: false, // (stepVehicle's: its engine can turn. Rolling on empty it cannot)
      running: false, // somebody at the wheel with an engine that turns
      flags: 0,
      fuelQ: 0,
      hpQ: 0,
      col: null,
    };
    if (!g.spawnEntity(e)) return null;
    this.list.push(e);
    this.rest(e);
    return e;
  }

  // ---------------------------------------------------------------- the handoff (gamestate.js)
  save() {
    return { list: this.list.filter((e) => !e.removed).map((e) => ({ ...e, seats: [...e.seats], col: null, shotCol: null })), siphoned: [...this.siphoned], starters: this.starters };
  }
  load(s) {
    const g = this.g;
    vehicleGrid(g.world);
    questCar(g.world);
    this.rng = mulberry32((g.seed ^ g.tick ^ 0x0ca75) >>> 0);
    this.list = [];
    for (const se of s?.list || []) {
      const e = g.spawnEntityAt({ ...se, seats: [...se.seats], col: null }, se.id);
      if (!e) continue;
      this.list.push(e);
      if (this.empty(e) && e.vx === 0 && e.vz === 0) this.park(e);
      this.wire(e);
    }
    this.siphoned = new Set(s?.siphoned || []);
    this.starters = s?.starters || 0;
  }

  // ---------------------------------------------------------------- who is where
  // the vehicle player p is in (at the wheel or carried), or null
  of(p) {
    const s = p.state;
    const id = s.drive || s.pass;
    const e = id ? this.g.ents[id] : null;
    return e && e.kind === ENT.VEHICLE && !e.removed ? e : null;
  }
  driver(e) {
    const p = e.seats[0] ? this.g.players.get(e.seats[0]) : null;
    return p && p.alive && p.state.drive === e.id ? p : null;
  }
  empty(e) {
    return !e.seats[0] && !e.seats[1] && !e.seats[2] && !e.seats[3];
  }
  speed(e) {
    return Math.hypot(e.vx, e.vz);
  }

  // what goes on the wire of it, kept as the snapshot wants it (snapshot.js quant)
  wire(e) {
    const P = VEHICLES[e.vk];
    e.vf = -e.vx * Math.sin(e.yaw) - e.vz * Math.cos(e.yaw);
    e.flags = e.state | (e.need << VFLAG.NEED_SHIFT) | (e.lights ? VFLAG.LIGHTS : 0) | (e.horn ? VFLAG.HORN : 0) | (e.brake ? VFLAG.BRAKE : 0) | (e.thr ? VFLAG.THROTTLE : 0) | (e.skidT > 0 ? VFLAG.SKID : 0) | (e.starter ? VFLAG.STARTER : 0) | (e.quest ? VFLAG.QUEST : 0);
    e.fuelQ = P.tank ? e.fuel / P.tank : 0;
    e.hpQ = e.state === VSTATE.WRECK ? 0 : Math.max(0, e.hp) / P.hp;
  }

  // standing empty: it is put exactly where the wire says it is (so every client's box is ours), and is a box
  rest(e) {
    e.vx = e.vz = 0;
    e.steer = 0;
    e.x = dqpos(qpos(e.x));
    e.z = dqpos(qpos(e.z));
    e.yaw = dqangle16(qangle16(e.yaw));
    if (e.yaw > Math.PI) e.yaw -= Math.PI * 2;
    e.y = groundAt(this.g.world, e.x, e.z, e.y + 0.5, 0.25, false);
    if (this.empty(e)) this.park(e);
    this.wire(e);
  }
  park(e) {
    if (e.col) return;
    const g = this.g;
    e.col = parkedCollider(e.vk, e.id, e.x, e.y, e.z, e.yaw);
    vehicleGrid(g.world).parked.add(e.col);
    g.nav.addStructure(e.col);
  }
  unpark(e) {
    if (!e.col) return;
    const g = this.g;
    vehicleGrid(g.world).parked.remove(e.col);
    g.nav.removeStructure(e.col);
    e.col = null;
  }

  // ---------------------------------------------------------------- the tick
  // Once a tick, after the commands: one with a driver follows them, the rest roll on; who is carried is put in
  // their seat; then what they run into, and what the dead hear.
  update() {
    const g = this.g;
    if (!this.list.length) return;
    const world = g.world;
    this.collide(); // (as they stood after the last tick's commands)
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.removed) {
        this.list.splice(i, 1);
        continue;
      }
      const P = VEHICLES[e.vk];
      this.checkSeats(e);
      const p = this.driver(e);
      const was = e.running;
      if (p) {
        const s = p.state;
        e.x = s.x;
        e.y = s.y;
        e.z = s.z;
        e.vx = s.vx;
        e.vz = s.vz;
        e.yaw = s.dyaw;
        e.steer = s.dsteer;
        e.fuel = s.dfuel;
        const b = s.lastBtn;
        e.thr = b & BTN.FWD ? 1 : 0;
        e.brake = b & (BTN.BACK | BTN.JUMP) ? 1 : 0;
        const horn = b & HORN ? 1 : 0;
        if (horn && !e.horn) {
          if (P.pedal) g.sound(SOUND.BIKE_BELL, e.x, e.y + 1, e.z, 40);
          this.noise(e, P.pedal ? 25 : NOISE.HORN);
          e.hornT = g.time + 1;
        } else if (horn && !P.pedal && g.time >= e.hornT) {
          this.noise(e, NOISE.HORN);
          e.hornT = g.time + 1;
        }
        e.horn = horn && !P.pedal ? 1 : 0;
        e.running = !P.pedal && e.state === VSTATE.OK && e.fuel > 0;
      } else {
        e.thr = e.horn = 0;
        e.running = false;
        if (e.vx !== 0 || e.vz !== 0) {
          // nobody at the wheel: it rolls on, the brake on if nobody is in it at all
          e.run = false;
          e.brake = this.empty(e) ? 1 : 0;
          _ev.length = 0;
          for (let k = 0; k < 3; k++) stepVehicle(e, 0, 0, !!e.brake, false, world, CMD_DT, _ev);
          for (const ev of _ev) if (ev.type === 'veh_crash') this.crash(e, ev.v, ev.col);
          if (e.removed) continue;
          if (Math.hypot(e.vx, e.vz) < 0.15) this.rest(e);
        } else if (!e.col && this.empty(e)) this.rest(e);
      }
      if (e.running !== was) g.sound(e.running ? SOUND.VEH_START : SOUND.VEH_STOP, e.x, e.y + 0.6, e.z, 45);
      if (e.skidT > 0) e.skidT -= SERVER_DT;
      // the carried, in their seats
      for (let k = 1; k < SEATS; k++) {
        const q = e.seats[k] ? g.players.get(e.seats[k]) : null;
        if (q) this.carry(q, e, k);
      }
      if (!this.empty(e) || e.vx !== 0 || e.vz !== 0) {
        this.strike(e, p);
        if (e.removed) continue;
        this.shove(e, p);
      }
      // the engine, to the dead: louder the harder it is worked
      if (e.running) {
        e.noiseT -= SERVER_DT;
        if (e.noiseT <= 0) {
          e.noiseT = NOISE_EVERY;
          const k = Math.min(1, Math.hypot(e.vx, e.vz) / P.top) * 0.6 + (e.thr ? 0.4 : 0);
          this.noise(e, P.idle + (P.noise - P.idle) * k);
        }
      }
      this.wire(e);
    }
  }

  // a noise at the vehicle, with the module's own random stream in the game's place for the call (the noise scatters
  // where each of the dead heads for: a vehicle must not shift what the rest of a seeded run rolls)
  noise(e, loud) {
    const g = this.g;
    const swap = g.rng;
    g.rng = this.rng;
    g.zm.noise(e.x, e.z, loud, e.y);
    g.rng = swap;
  }

  // Two of them that are not standing empty (those are boxes: stepVehicle), come together: put apart by their weights,
  // what they were closing at shared out the same way, and each damaged as by a crash at its share of it. A rider on
  // two wheels is thrown by a share over their vehicle's throwAt. Nothing of this is in a driver's prediction (the
  // other is somebody else's): their state is rewritten, as when they strike the dead.
  collide() {
    const g = this.g;
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.removed || a.col) continue;
      const PA = VEHICLES[a.vk];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.removed || b.col) continue;
        const PB = VEHICLES[b.vk];
        const far = PA.half + PB.half + 0.4;
        if (Math.abs(a.x - b.x) > far || Math.abs(a.z - b.z) > far || Math.abs(a.y - b.y) > 1.6) continue;
        // the deepest of their circles into each other
        let deep = 0, nx = 0, nz = 0;
        const fax = -Math.sin(a.yaw), faz = -Math.cos(a.yaw), fbx = -Math.sin(b.yaw), fbz = -Math.cos(b.yaw);
        for (const ca of PA.circles) {
          const ax = a.x - fax * ca[0], az = a.z - faz * ca[0];
          for (const cb of PB.circles) {
            const dx = ax - (b.x - fbx * cb[0]), dz = az - (b.z - fbz * cb[0]);
            const d = Math.hypot(dx, dz);
            const o = ca[1] + cb[1] - d;
            if (o > deep) {
              deep = o;
              nx = d > 1e-4 ? dx / d : 1;
              nz = d > 1e-4 ? dz / d : 0;
            }
          }
        }
        if (deep <= 0) continue;
        const ma = MASS[a.vk], mb = MASS[b.vk];
        const sa = mb / (ma + mb), sb = ma / (ma + mb); // (the lighter one gives way)
        const pa = this.driver(a), pb = this.driver(b);
        const A = pa ? pa.state : a, B = pb ? pb.state : b;
        A.x += nx * deep * sa;
        A.z += nz * deep * sa;
        B.x -= nx * deep * sb;
        B.z -= nz * deep * sb;
        const closing = -((A.vx - B.vx) * nx + (A.vz - B.vz) * nz);
        if (closing > 0) {
          const jn = closing * 1.15; // (a little bounce)
          A.vx += nx * jn * sa;
          A.vz += nz * jn * sa;
          B.vx -= nx * jn * sb;
          B.vz -= nz * jn * sb;
          if (closing > 1.5 && g.time - (a.hitT || 0) > 0.4) {
            a.hitT = b.hitT = g.time;
            for (const [e, p, share, dir] of [[a, pa, sa, 1], [b, pb, sb, -1]]) {
              const v = closing * (0.25 + 0.75 * share); // (the heavier one feels it too)
              this.crash(e, v, null);
              const P = VEHICLES[e.vk];
              if (!e.removed && p && P.throwAt && v > P.throwAt) {
                // off it, the way it was knocked
                const st = p.state;
                e.seats[0] = 0;
                this.leaveWheel(p, e);
                st.vx = nx * dir * Math.min(6, v * 0.5);
                st.vz = nz * dir * Math.min(6, v * 0.5);
                st.vy = 3.2;
                st.y += 0.5;
                st.onGround = 0;
                st.stunT = 0.7;
                g.damagePlayer(p, Math.min(45, 6 + (v - P.throwAt) * THROWN_HURT), { kind: KILLER.WORLD, x: e.x, z: e.z }); // (never the whole of a life: it may be a teammate's doing)
                g.notify(NOTIFY.VEH_OFF, VEH_OFFS.THROWN, p.id);
              }
            }
          }
        }
        for (const [e, p] of [[a, pa], [b, pb]]) {
          if (e.removed) continue;
          const st = p && p.state.drive === e.id ? p.state : null;
          if (st) {
            e.x = st.x;
            e.z = st.z;
            e.vx = st.vx;
            e.vz = st.vz;
          } else if (e.vx !== 0 || e.vz !== 0) e.run = false;
        }
      }
    }
  }

  // A shot along (dx, dy, dz) from (ox, oy, oz), no further than max: the nearest vehicle with somebody in it that it
  // meets ({ t, col }: col stands for it as a parked one's box does), or null. (One standing empty is a box in the
  // world already.) What stops a round: a car's body up to its window sills and its roof - between them it is open,
  // and who sits there shoots out and can be hit; of a moped or a bicycle the frame, low - its rider is in the open.
  // skip: the vehicle of whoever fired is not in their own way.
  rayHit(ox, oy, oz, dx, dy, dz, max, skip) {
    let best = null;
    for (const e of this.list) {
      if (e.removed || e.col || e === skip) continue;
      const P = VEHICLES[e.vk];
      const rx = e.x - ox, rz = e.z - oz;
      const along = rx * dx + rz * dz;
      if (along < -P.half - 1 || along > max + P.half + 1) continue;
      const c = Math.cos(e.yaw), sn = Math.sin(e.yaw);
      // into its own frame: x across, z along it
      const lox = -rx * c + rz * sn, loz = -rx * sn - rz * c, loy = oy - e.y;
      const ldx = dx * c - dz * sn, ldz = dx * sn + dz * c;
      for (const [y0, y1] of SHOT_BOX[e.vk]) {
        const t = rayBox(lox, loy, loz, ldx, dy, ldz, P.halfW, y0, y1, P.half, max);
        if (t >= 0 && (!best || t < best.t)) best = { t, col: e.shotCol || (e.shotCol = { flags: COL_VEHICLE, id: e.id, x: 0, z: 0 }) };
      }
    }
    return best;
  }

  // Every seat's holder is still somebody who can sit there: alive, a survivor, on their feet, and in this vehicle
  // by their own state. Who is not is out of it (their body beside it, unless the simulation has thrown it already).
  checkSeats(e) {
    const g = this.g;
    for (let k = 0; k < SEATS; k++) {
      const id = e.seats[k];
      if (!id) continue;
      const p = g.players.get(id);
      const s = p?.state;
      const there = s && (k === 0 ? s.drive === e.id : s.pass === e.id && s.passN === k);
      if (p && there && p.alive && !p.zombie && !p.downed && !(k === 0 && p.away)) continue;
      e.seats[k] = 0;
      if (!p) continue;
      if (there && k === 0 && p.away && p.alive && !p.zombie && !p.downed) {
        // dropped at the wheel: the vehicle keeps what it was doing, and they are carried in another seat if there is
        // one (somebody else can drive), else left beside it
        this.leaveWheel(p, e);
        const free = this.freeSeat(e, 1);
        if (free > 0) {
          this.sit(p, e, free);
          continue;
        }
      }
      if (there) {
        if (k === 0) this.leaveWheel(p, e);
        s.pass = s.passN = 0;
        this.putOut(p, e);
      } else if (s) {
        // (their state has them elsewhere: nothing of theirs is touched)
      }
    }
    // a survivor whose state has them in a vehicle that does not have them (a new game under them) is out of it
    if (e === this.list[0]) {
      for (const p of g.players.values()) {
        const s = p.state;
        if (s.drive && this.g.ents[s.drive]?.seats?.[0] !== p.id) {
          s.drive = s.driveK = 0;
          s.vx = s.vz = 0;
        }
        if (s.pass && this.g.ents[s.pass]?.seats?.[s.passN] !== p.id) s.pass = s.passN = 0;
      }
    }
  }

  // the driver's state gives the vehicle back to itself: where it is, how it moves
  leaveWheel(p, e) {
    const s = p.state;
    if (s.drive !== e.id) return;
    e.x = s.x;
    e.y = s.y;
    e.z = s.z;
    e.vx = s.vx;
    e.vz = s.vz;
    e.yaw = s.dyaw;
    e.steer = s.dsteer;
    e.fuel = s.dfuel;
    s.drive = s.driveK = 0;
    s.vx = s.vz = 0;
  }

  // 'veh_off' from the simulation (processInputs): the driver left it on their own command - thrown over the bars by
  // a crash, pulled off, gone down. Where it was left is in the event.
  left(p, ev) {
    const g = this.g;
    const e = g.ents[ev.id];
    if (!e || e.kind !== ENT.VEHICLE || e.seats[0] !== p.id) return;
    e.seats[0] = 0;
    e.x = ev.x;
    e.y = ev.y;
    e.z = ev.z;
    e.yaw = ev.yaw;
    e.vx = ev.vx;
    e.vz = ev.vz;
    e.steer = ev.steer;
    e.fuel = ev.fuel;
    if (ev.thrown) {
      g.damagePlayer(p, 6 + Math.max(0, ev.v - VEHICLES[e.vk].throwAt) * THROWN_HURT, { kind: KILLER.WORLD, x: e.x, z: e.z });
      g.notify(NOTIFY.VEH_OFF, VEH_OFFS.THROWN, p.id);
    } else if (!p.state.pinned && !p.state.pulled) this.putOut(p, e); // (a leaper or a rope has them where it has them)
  }

  // p's body carried in seat k of e
  carry(p, e, k) {
    const s = p.state;
    seatAt(e.vk, k, e.x, e.y, e.z, e.yaw, _seat);
    s.x = _seat.x;
    s.y = seatFeet(e.vk, _seat.y);
    s.z = _seat.z;
    s.vx = s.vy = s.vz = 0;
    s.onGround = 1;
    // (where they are is the seat's and not their simulation's: it is no reason to send them their state)
    p.shadow.x = s.x;
    p.shadow.y = s.y;
    p.shadow.z = s.z;
    p.shadow.vx = p.shadow.vy = p.shadow.vz = 0;
    p.shadow.onGround = 1;
  }

  freeSeat(e, from = 0) {
    const n = VEHICLES[e.vk].seats.length;
    for (let k = from; k < n; k++) if (!e.seats[k]) return k;
    return -1;
  }

  // p into seat k of e
  sit(p, e, k) {
    const g = this.g;
    const s = p.state;
    p.hold = null;
    g.endUse(p);
    s.ride = s.cart = 0;
    this.unpark(e);
    e.seats[k] = p.id;
    if (k === 0) {
      s.pass = s.passN = 0;
      s.drive = e.id;
      s.driveK = e.vk;
      s.x = e.x;
      s.y = e.y;
      s.z = e.z;
      s.vx = e.vx;
      s.vz = e.vz;
      s.vy = 0;
      s.dyaw = e.yaw;
      s.dsteer = e.steer;
      s.dfuel = e.fuel;
      s.ddead = e.state === VSTATE.OK ? 0 : 1;
      s.onGround = 1;
      s.crouch = 0;
    } else {
      s.drive = s.driveK = 0;
      s.pass = e.id;
      s.passN = k;
      s.crouch = 0;
      this.carry(p, e, k);
    }
    p.selfSync = true;
    g.fillHistory(p);
  }

  // p's body beside e, where there is room for it: either side of it, behind it, ahead of it
  putOut(p, e) {
    const g = this.g;
    const w = g.world;
    const s = p.state;
    const P = VEHICLES[e.vk];
    const c = Math.cos(e.yaw);
    const sn = Math.sin(e.yaw);
    const side = P.halfW + PLAYER_RADIUS + 0.3;
    const end = P.half + PLAYER_RADIUS + 0.3;
    // (the driver's side first; for whoever sat on the right, the right)
    const first = s.passN === 1 || s.passN === 3 ? 1 : -1;
    // (whoever sat in the back, beside the back door)
    const back = s.passN >= 2 ? 0.9 : P.shell ? -0.3 : 0;
    const tries = [[first * side, back], [-first * side, back], [first * side, back + 1], [-first * side, back + 1], [first * side, back - 1], [-first * side, back - 1], [0, end], [0, -end], [first * (side + 0.8), 0], [-first * (side + 0.8), 0], [first * (side + 0.8), 1.2], [-first * (side + 0.8), 1.2]];
    let best = null;
    for (const [lx, lz] of tries) {
      const x = e.x + lx * c + lz * sn;
      const z = e.z - lx * sn + lz * c;
      const y = groundAt(w, x, z, e.y + 0.6, 0.3);
      if (Math.abs(y - e.y) > 1.3 || (y < WATER_LEVEL - 0.9 && w.isDeepWater(x, z))) continue;
      _pos.x = x;
      _pos.y = y;
      _pos.z = z;
      resolveBody(w, _pos, PLAYER_RADIUS, PLAYER_HEIGHT, true);
      if (Math.hypot(_pos.x - x, _pos.z - z) > 0.05) continue;
      if (!g.zm.clearLine(e.x, e.y + 1.2, e.z, x, y + 1.2, z)) continue;
      // (not where somebody stands already: four out of a car are four places)
      let taken = false;
      for (const q of g.players.values()) if (q !== p && q.alive && !q.state.drive && !q.state.pass && Math.hypot(q.state.x - x, q.state.z - z) < 0.75) taken = true;
      if (taken) continue;
      best = { x, y, z };
      break;
    }
    if (!best) best = { x: e.x, y: e.y + P.tall + 0.05, z: e.z }; // (walled in on every side: onto it)
    s.x = best.x;
    s.y = best.y;
    s.z = best.z;
    s.vx = s.vy = s.vz = 0;
    s.onGround = 1;
    s.drive = s.driveK = 0;
    s.pass = s.passN = 0;
    p.selfSync = true;
    g.fillHistory(p);
  }

  // ---------------------------------------------------------------- getting in and out (ACT.VEHICLE)
  act(p, what, id) {
    const g = this.g;
    if (what === VACT.EXIT) return this.exit(p);
    if (what === VACT.LIGHTS) {
      const e = this.of(p);
      if (e && VEHICLES[e.vk].tank) e.lights = e.lights ? 0 : 1;
      return;
    }
    if (what !== VACT.ENTER) return;
    const e = g.ents[id];
    const s = p.state;
    if (!e || e.kind !== ENT.VEHICLE || e.removed) return;
    if (p.zombie || p.downed || s.drive || s.pass || s.ride || s.cart || s.hmg || s.pinned || s.pulled) return;
    if (g.time - p.interactT < 0.15) return;
    p.interactT = g.time;
    if (e.state === VSTATE.BROKEN) return g.notify(NOTIFY.VEH_NEED, VEH_NO.BROKEN, p.id);
    if (e.state === VSTATE.WRECK) return g.notify(NOTIFY.VEH_NEED, VEH_NO.WRECK, p.id);
    if (!this.near(p, e, Math.hypot(e.vx, e.vz) * 0.3)) return;
    const k = this.freeSeat(e);
    if (k < 0) return g.notify(NOTIFY.VEH_NEED, VEH_NO.SEATS, p.id);
    if (g.gun.ent && g.gun.ent.gunner === p.id) g.gun.ent.gunner = 0;
    this.sit(p, e, k);
    g.sound(VEHICLES[e.vk].shell ? SOUND.VEH_DOOR : SOUND.VEH_MOUNT, e.x, e.y + 0.8, e.z, 25);
  }

  // is p close enough to e to lay a hand on it (as the client offers it)?
  near(p, e, slack = 0) {
    const s = p.state;
    const P = VEHICLES[e.vk];
    const c = Math.cos(e.yaw);
    const sn = Math.sin(e.yaw);
    const dx = s.x - e.x;
    const dz = s.z - e.z;
    const lx = Math.abs(dx * c - dz * sn) - P.halfW;
    const lz = Math.abs(dx * sn + dz * c) - P.half;
    const d = Math.hypot(Math.max(0, lx), Math.max(0, lz));
    return d <= INTERACT_REACH + INTERACT_SLACK + slack && Math.abs(s.y - e.y) < 2.6;
  }

  exit(p) {
    const g = this.g;
    const e = this.of(p);
    const s = p.state;
    if (!e) {
      s.drive = s.driveK = s.pass = s.passN = 0;
      return;
    }
    const k = e.seats.indexOf(p.id);
    if (k >= 0) e.seats[k] = 0;
    const sp = Math.hypot(e.vx, e.vz);
    if (k === 0) this.leaveWheel(p, e);
    this.putOut(p, e);
    // out of one that is going: they go on with some of its speed, and hit the ground
    if (sp > 2) {
      s.vx = e.vx * 0.6;
      s.vz = e.vz * 0.6;
      if (sp > JUMP_HURT_FROM) g.damagePlayer(p, (sp - JUMP_HURT_FROM) * JUMP_HURT, { kind: KILLER.WORLD, x: e.x, z: e.z });
    }
    g.sound(VEHICLES[e.vk].shell ? SOUND.VEH_DOOR : SOUND.VEH_MOUNT, e.x, e.y + 0.8, e.z, 25);
    if (this.empty(e) && e.vx === 0 && e.vz === 0) this.rest(e);
  }

  // p is off or out of whatever they are in, where they are (a death, a new world): nothing is asked of the vehicle
  drop(p) {
    const e = this.of(p);
    const s = p.state;
    if (e) {
      const k = e.seats.indexOf(p.id);
      if (k === 0) this.leaveWheel(p, e);
      if (k >= 0) e.seats[k] = 0;
    }
    s.drive = s.driveK = s.pass = s.passN = 0;
  }

  // ---------------------------------------------------------------- fixing, fuelling, patching ([E] held)
  // What holding [E] on e would do for p now: { kind, slot } or a VEH_NO reason.
  job(p, e) {
    const P = VEHICLES[e.vk];
    const s = p.state;
    if (e.state === VSTATE.WRECK) return VEH_NO.WRECK;
    if (e.state === VSTATE.BROKEN) {
      const fix = FIX[e.vk];
      if (!e.need) return { kind: HOLD.VEH_FIX, slot: FIX_FREE, need: STARTER_TIME }; // (one of the bridgehead's: it wants only the work)
      for (let i = 0; i < fix.length; i++) if (e.need & (1 << i) && countItem(p.inv, fix[i][0]) >= fix[i][1]) return { kind: HOLD.VEH_FIX, slot: i, need: FIX_TIME };
      return VEH_NO.NO_PARTS;
    }
    const canPatch = Object.keys(REPAIR).every((k) => countItem(p.inv, +k) >= REPAIR[k]);
    const hurt = e.hp < P.hp - 1;
    const low = P.tank > 0 && e.fuel < P.tank - 1;
    if (e.state === VSTATE.DEAD) return canPatch ? { kind: HOLD.VEH_REPAIR, need: REPAIR_TIME } : VEH_NO.NO_PARTS;
    if (low && s.ammo[AMMO.FUEL] > 0) return { kind: HOLD.VEH_FUEL, need: FUEL_TIME };
    if (hurt && canPatch) return { kind: HOLD.VEH_REPAIR, need: REPAIR_TIME };
    if (low) return VEH_NO.NO_FUEL;
    if (hurt) return VEH_NO.NO_PARTS;
    return P.tank ? VEH_NO.FULL : VEH_NO.FINE;
  }

  // ACT.HOLD_BEGIN on a vehicle
  holdBegin(p, e) {
    const g = this.g;
    if (this.of(p) || !this.near(p, e)) return;
    const j = this.job(p, e);
    if (typeof j === 'number') return g.notify(NOTIFY.VEH_NEED, j, p.id);
    p.hold = { kind: j.kind, target: e.id, t: 0, need: j.need, slot: j.slot ?? 0 };
  }
  holdOk(p, h) {
    const e = this.g.ents[h.target];
    if (!e || e.kind !== ENT.VEHICLE || e.removed || this.of(p) || !this.near(p, e, 0.4)) return false;
    const j = this.job(p, e);
    return typeof j !== 'number' && j.kind === h.kind && (j.slot ?? 0) === h.slot;
  }
  holdDone(p, h) {
    const g = this.g;
    const e = g.ents[h.target];
    if (!e) return;
    const P = VEHICLES[e.vk];
    const s = p.state;
    const d = this.driver(e);
    if (h.kind === HOLD.VEH_FIX) {
      if (h.slot !== FIX_FREE) {
        const [item, n] = FIX[e.vk][h.slot];
        if (countItem(p.inv, item) < n) return;
        removeItem(p.inv, item, n);
        p.invDirty = true;
        e.need &= ~(1 << h.slot);
      }
      g.sound(SOUND.VEH_FIX, e.x, e.y + 0.7, e.z, 30);
      if (!e.need) {
        e.state = VSTATE.OK;
        g.notify(NOTIFY.VEH_FIXED, p.id);
        g.track.event?.('vehicle_fixed', p, { kind: VEH_NAMES[e.vk], starter: e.starter });
      }
    } else if (h.kind === HOLD.VEH_FUEL) {
      const n = Math.min(FUEL_POUR, s.ammo[AMMO.FUEL], Math.ceil(P.tank - e.fuel));
      if (n <= 0) return;
      s.ammo[AMMO.FUEL] -= n;
      e.fuel = Math.min(P.tank, e.fuel + n);
      if (d) d.state.dfuel = e.fuel;
      g.sound(SOUND.VEH_FUEL, e.x, e.y + 0.7, e.z, 25);
    } else if (h.kind === HOLD.VEH_REPAIR) {
      for (const k in REPAIR) if (countItem(p.inv, +k) < REPAIR[k]) return;
      for (const k in REPAIR) removeItem(p.inv, +k, REPAIR[k]);
      p.invDirty = true;
      e.hp = Math.min(P.hp, Math.max(0, e.hp) + P.hp * REPAIR_HP);
      if (e.state === VSTATE.DEAD) {
        e.state = VSTATE.OK;
        if (d) d.state.ddead = 0;
      }
      g.sound(SOUND.VEH_FIX, e.x, e.y + 0.7, e.z, 30);
    }
    this.wire(e);
    // [E] still held: on with the next thing it wants, if there is one this survivor can do
    const j = this.job(p, e);
    if (typeof j !== 'number') p.hold = { kind: j.kind, target: e.id, t: 0, need: j.need, slot: j.slot ?? 0 };
  }

  // ---------------------------------------------------------------- siphoning a wreck (ACT.SIPHON, HOLD.SIPHON)
  wrecks() {
    const w = this.g.world;
    if (this.propsOf !== w) {
      this.propsOf = w;
      this.props = new Map();
      if (w.kind === WORLD.MAINLAND) for (const pr of w.props) if (siphonOf(pr) > 0) this.props.set(`${qpos(pr.x)},${qpos(pr.z)}`, pr);
    }
    return this.props;
  }
  siphonBegin(p, qx, qz) {
    const g = this.g;
    const key = `${qx},${qz}`;
    const pr = this.wrecks().get(key);
    if (!pr || this.of(p) || p.useItem) return;
    if (Math.hypot(pr.x - p.state.x, pr.z - p.state.z) > INTERACT_REACH + INTERACT_SLACK + 3.2) return;
    if (this.siphoned.has(key)) return g.notify(NOTIFY.SIPHONED, 0, p.id);
    p.hold = { kind: HOLD.SIPHON, target: SIPHON_ID, t: 0, need: SIPHON_TIME, key };
    g.sound(SOUND.SIPHON, pr.x, pr.y + 0.6, pr.z, 20);
  }
  siphonOk(p, h) {
    const pr = this.wrecks().get(h.key);
    return !!pr && !this.siphoned.has(h.key) && Math.hypot(pr.x - p.state.x, pr.z - p.state.z) <= INTERACT_REACH + INTERACT_SLACK + 3.6;
  }
  siphonDone(p, h) {
    const g = this.g;
    const pr = this.wrecks().get(h.key);
    if (!pr || this.siphoned.has(h.key)) return;
    this.siphoned.add(h.key);
    const n = siphonOf(pr);
    const s = p.state;
    const fit = Math.min(n, AMMO_MAX[AMMO.FUEL] - s.ammo[AMMO.FUEL]);
    s.ammo[AMMO.FUEL] += fit;
    if (n > fit) g.dropItem(ITEM.AMMO_FUEL, n - fit, s.x, s.y, s.z, { spread: 0.6 });
    g.notify(NOTIFY.SIPHONED, n, p.id);
    g.pickupEvent(p, ITEM.AMMO_FUEL, fit);
  }

  // ---------------------------------------------------------------- damage
  // amount of damage to e. Broken down by it, it rolls to a stop; broken down already, enough more burns it out.
  damage(e, amount) {
    const g = this.g;
    if (!(amount > 0) || e.state === VSTATE.WRECK || e.state === VSTATE.BROKEN) return;
    const P = VEHICLES[e.vk];
    if (e.state === VSTATE.DEAD) {
      e.wreckHp -= amount;
      if (e.wreckHp > 0) return;
      e.state = VSTATE.WRECK;
      e.hp = 0;
      e.lights = 0;
      for (let k = 0; k < SEATS; k++) {
        const q = e.seats[k] ? g.players.get(e.seats[k]) : null;
        if (!q) continue;
        g.notify(NOTIFY.VEH_WRECKED, 0, q.id);
        if (k === 0) this.leaveWheel(q, e);
        e.seats[k] = 0;
        this.putOut(q, e);
      }
      g.sound(SOUND.VEH_BREAK, e.x, e.y + 0.8, e.z, 90);
      g.impact(IMPACT.SPARK, e.x, e.y + 0.8, e.z);
      this.wire(e);
      return;
    }
    const shell = P.shell && e.hp > P.hp * SHELL;
    e.hp -= amount;
    if (shell && e.hp <= P.hp * SHELL) g.sound(SOUND.VEH_GLASS, e.x, e.y + 1, e.z, 50);
    if (e.hp > 0) return;
    e.hp = 0;
    e.state = VSTATE.DEAD;
    e.wreckHp = P.hp * WRECK_POOL;
    const d = this.driver(e);
    if (d) d.state.ddead = 1;
    for (const id of e.seats) if (id) g.notify(NOTIFY.VEH_BROKE, 0, id);
    g.sound(SOUND.VEH_BREAK, e.x, e.y + 0.8, e.z, 70);
    this.wire(e);
  }

  // 'veh_crash' from a driver's command (or from one rolling on empty): it struck something solid at v m/s
  crashEvent(p, ev) {
    const e = this.g.ents[ev.id];
    if (e && e.kind === ENT.VEHICLE && !e.removed) this.crash(e, ev.v, ev.col);
  }
  crash(e, v, col) {
    const g = this.g;
    if (v > CRASH_FROM) {
      const d = (v - CRASH_FROM) * (v - CRASH_FROM) * CRASH_DMG[e.vk];
      this.damage(e, d);
      // what it struck, if that is one of them standing
      const other = col && col.flags & COL_VEHICLE ? g.ents[col.id] : null;
      if (other && other !== e && other.kind === ENT.VEHICLE) this.damage(other, d * 0.6);
      g.sound(SOUND.VEH_CRASH, e.x, e.y + 0.6, e.z, 80);
      this.noise(e, NOISE.CRASH);
    }
    if (VEHICLES[e.vk].shell && v > CRASH_HURT_FROM) {
      for (const id of e.seats) {
        const q = id ? g.players.get(id) : null;
        if (q) g.damagePlayer(q, (v - CRASH_HURT_FROM) * CRASH_HURT, { kind: KILLER.WORLD, x: e.x, z: e.z });
      }
    }
  }

  // 'veh_skid': the tyres let go (others hear and see it off the flag)
  skid(p) {
    const e = this.of(p);
    if (e) e.skidT = 0.25;
  }

  // Something of the dead's has hurt survivor p (Game.damagePlayer): how much of it gets to them. In a car that still
  // has its glass, none - the car takes it; in one whose windows are in, half. On two wheels all of it, and it drags
  // at the rider: slowed, and at a crawl pulled off.
  shield(p, amount) {
    const e = this.of(p);
    if (!e) return amount;
    const g = this.g;
    const P = VEHICLES[e.vk];
    if (P.shell) {
      if (e.state !== VSTATE.WRECK && e.hp > P.hp * SHELL) {
        this.damage(e, amount * 0.6);
        return 0;
      }
      this.damage(e, amount * 0.4);
      return amount * 0.5;
    }
    if (p.state.drive === e.id) {
      const s = p.state;
      s.vx *= 0.55;
      s.vz *= 0.55;
      if (Math.hypot(s.vx, s.vz) < 3.5) {
        g.notify(NOTIFY.VEH_OFF, VEH_OFFS.PULLED, p.id);
        this.exit(p);
        p.state.stunT = Math.max(p.state.stunT, 0.35);
      }
    }
    return amount;
  }

  // A blow that would knock survivor p off their feet (Zombies.knock). In a car it shoves the car and they keep
  // their seat (true: the knock is not theirs). On two wheels they are off it, and knocked as anyone.
  onKnock(p, fromX, fromZ, power) {
    const e = this.of(p);
    if (!e) return false;
    const g = this.g;
    if (VEHICLES[e.vk].shell) {
      const dx = e.x - fromX;
      const dz = e.z - fromZ;
      const l = Math.hypot(dx, dz) || 1;
      const d = this.driver(e);
      const t = d ? d.state : e;
      t.vx += (dx / l) * power * 0.3;
      t.vz += (dz / l) * power * 0.3;
      if (!d) this.unpark(e);
      this.damage(e, power * 9);
      return true;
    }
    g.notify(NOTIFY.VEH_OFF, VEH_OFFS.KNOCKED, p.id);
    this.exit(p);
    return false;
  }

  // a blast at (x, y, z)
  blast(x, y, z, radius, amount) {
    for (const e of this.list) {
      const d = Math.hypot(e.x - x, e.z - z) - VEHICLES[e.vk].half * 0.6;
      if (d < radius && Math.abs(e.y - y) < radius + 2) this.damage(e, amount * (1 - Math.max(0, d) / radius));
    }
  }

  // a bullet stopped by the box of one standing empty (Combat.fire)
  shot(col, dmg) {
    const e = this.g.ents[col.id];
    if (e && e.kind === ENT.VEHICLE) this.damage(e, dmg * 0.35);
  }

  // how much further (x) the dead notice survivor p for what they are in (Zombies.chooseTarget): a running engine is
  // heard, and its headlamp is seen at night
  notice(p) {
    const s = p.state;
    if (!s.drive && !s.pass) return 1;
    const e = this.of(p);
    if (!e) return 1;
    return (e.running ? 1.35 : 1) * (e.lights && this.g.phase === PHASE.NIGHT ? 1.4 : 1);
  }

  // The headlamps that are on, for the light that pins a Shade (Zombies.isLit): [x, y, z, fx, fz, reach] each
  lamps(out) {
    out.length = 0;
    for (const e of this.list) {
      if (!e.lights || e.state === VSTATE.WRECK || e.state === VSTATE.BROKEN) continue;
      const P = VEHICLES[e.vk];
      const fx = -Math.sin(e.yaw);
      const fz = -Math.cos(e.yaw);
      out.push(e.x + fx * P.half, e.y + 0.75, e.z + fz * P.half, fx, fz, 30);
    }
    return out;
  }

  // ---------------------------------------------------------------- what is in its way
  // e's frame for a point: out.x to its right, out.z ahead of it
  local(e, x, z, out) {
    const c = Math.cos(e.yaw);
    const sn = Math.sin(e.yaw);
    const dx = x - e.x;
    const dz = z - e.z;
    out.x = dx * c - dz * sn;
    out.z = -(dx * sn + dz * c);
    return out;
  }

  // How far the dead are from survivor p for a blow (Zombies: what their reach is measured against): p's own
  // distance d, or - in a vehicle - the distance to its body, as if p stood at its nearest side. The dead cannot get
  // into it (keepOff), so from its nose or its tail whoever sits in the middle of it would be out of every reach.
  reachTo(p, x, z, d) {
    const s = p.state;
    if (!s.drive && !s.pass) return d;
    const e = this.of(p);
    if (!e) return d;
    const P = VEHICLES[e.vk];
    const dx = x - e.x;
    const dz = z - e.z;
    const c = Math.cos(e.yaw);
    const sn = Math.sin(e.yaw);
    const ox = Math.max(0, Math.abs(dx * c - dz * sn) - P.halfW);
    const oz = Math.max(0, Math.abs(dx * sn + dz * c) - P.half);
    return Math.min(d, Math.hypot(ox, oz) + PLAYER_RADIUS);
  }

  // One of the dead moving to pos (radius r, feet at y) is kept out of every vehicle that is not a box of the world
  // already: one that is moving, or has somebody in it (Zombies.integrate, after it has kept it off the survivors).
  keepOff(pos, r, y) {
    for (const e of this.list) {
      if (e.col) continue;
      const P = VEHICLES[e.vk];
      const dx = pos.x - e.x;
      const dz = pos.z - e.z;
      const reach = P.half + r + 0.2;
      if (dx * dx + dz * dz > reach * reach || Math.abs(y - e.y) > 2) continue;
      const c = Math.cos(e.yaw);
      const sn = Math.sin(e.yaw);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      const px = P.halfW + r * 0.8 - Math.abs(lx);
      const pz = P.half + r * 0.8 - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      // out by the nearer face
      let ox = 0;
      let oz = 0;
      if (px < pz) ox = lx >= 0 ? px : -px;
      else oz = lz >= 0 ? pz : -pz;
      pos.x += ox * c + oz * sn;
      pos.z += -ox * sn + oz * c;
    }
  }

  // The dead in the way of e. Going fast it knocks them down and aside, at a cost: speed, and damage to itself; a
  // rider on two wheels is thrown by it. Something as big as a Tank stops it dead. Going slowly it pushes at them,
  // and a crowd holds it.
  strike(e, p) {
    const g = this.g;
    const P = VEHICLES[e.vk];
    const ram = RAM[e.vk];
    const s = p ? p.state : e;
    const sp = Math.hypot(s.vx, s.vz);
    if (sp < 0.3 && !(p && p.state.lastBtn & (BTN.FWD | BTN.BACK))) {
      if (p) p.state.dhold = 0;
      return;
    }
    const c = Math.cos(e.yaw);
    const sn = Math.sin(e.yaw);
    // (which end leads)
    const fwd = -s.vx * sn - s.vz * c >= 0 ? 1 : -1;
    const want = p ? (p.state.lastBtn & BTN.FWD ? 1 : p.state.lastBtn & BTN.BACK ? -1 : 0) : 0;
    const lead = sp > 0.5 ? fwd : want || fwd;
    let keep = 1;
    let hurt = 0;
    let crowd = 0;
    let stop = false;
    let thrown = false;
    g.zm.forNear(e.x, e.z, P.half + 2.5, (z) => {
      if (z.dead || z.def.flying || stop) return;
      if (Math.abs(z.y - e.y) > 2.2) return;
      const dx = z.x - e.x;
      const dz = z.z - e.z;
      const lx = dx * c - dz * sn;
      const lf = -(dx * sn + dz * c) * lead; // how far ahead of its middle, the way it is going
      const r = Math.min(z.def.radius, 0.9);
      if (Math.abs(lx) > P.halfW + r || lf < 0 || lf > P.half + r + 0.25) return;
      if (sp < STRIKE) {
        crowd++;
        return;
      }
      if ((z.vehT || 0) > g.time) return;
      z.vehT = g.time + STRIKE_AGAIN;
      const big = z.boss || z.def.radius > 0.8;
      const side = lx >= 0 ? 1 : -1;
      const fx = -sn * lead;
      const fz = -c * lead;
      g.combat.damageZombie(z, sp * ram.dmg * (big ? 0.5 : 1), p, { melee: true, knock: big ? 0 : 4 + sp * 0.35, dirX: c * side * 0.7 + fx * 0.7, dirZ: -sn * side * 0.7 + fz * 0.7 });
      g.sound(SOUND.VEH_THUMP, z.x, z.y + 1, z.z, 45);
      g.impact(z.def.acid ? IMPACT.GREEN_BLOOD : IMPACT.BLOOD, z.x, z.y + 1, z.z);
      hurt += big ? 110 + sp * 6 : ram.hurt + sp * ram.hurtV;
      if (big) stop = true;
      else keep *= ram.keep;
      if (ram.throwAt && sp > ram.throwAt) thrown = true;
    });
    // a crowd on its nose holds it: for a driver, by the count in their own state (their prediction slows with it:
    // driveStep); one that rolls with nobody at the wheel is slowed here
    if (p) p.state.dhold = Math.min(3, crowd);
    else if (crowd) keep *= Math.max(0.3, 1 - 0.25 * crowd);
    if (stop) keep = 0;
    if (keep < 1) {
      s.vx *= keep;
      s.vz *= keep;
    }
    if (hurt) this.damage(e, hurt);
    if (thrown && p && p.state.drive === e.id) {
      // over the bars: as a crash throws them (the simulation's own way off, done here)
      const st = p.state;
      e.seats[0] = 0;
      this.leaveWheel(p, e);
      e.vx *= 0.3;
      e.vz *= 0.3;
      st.vx = -sn * lead * Math.min(7, sp * 0.55);
      st.vz = -c * lead * Math.min(7, sp * 0.55);
      st.vy = 3.4;
      st.y += 0.5;
      st.onGround = 0;
      st.stunT = 0.7;
      g.damagePlayer(p, 6 + (sp - ram.throwAt) * THROWN_HURT, { kind: KILLER.WORLD, x: e.x, z: e.z });
      g.notify(NOTIFY.VEH_OFF, VEH_OFFS.THROWN, p.id);
    }
  }

  // Survivors on foot in the way of one that is moving are put aside, unhurt, and it loses speed to them: nobody is
  // run down by a teammate.
  shove(e, p) {
    const g = this.g;
    const P = VEHICLES[e.vk];
    const s = p ? p.state : e;
    const sp = Math.hypot(s.vx, s.vz);
    if (sp < 1) return;
    const c = Math.cos(e.yaw);
    const sn = Math.sin(e.yaw);
    for (const q of g.players.values()) {
      const t = q.state;
      if (!q.alive || t.drive || t.pass || q.away) continue;
      const dx = t.x - e.x;
      const dz = t.z - e.z;
      if (Math.abs(dx) > P.half + 1 || Math.abs(dz) > P.half + 1 || Math.abs(t.y - e.y) > 1.6) continue;
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      const px = P.halfW + PLAYER_RADIUS - Math.abs(lx);
      const pz = P.half + PLAYER_RADIUS - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      // aside, whichever side of its middle they are on
      const ox = (lx >= 0 ? 1 : -1) * (px + 0.05);
      _pos.x = t.x + ox * c;
      _pos.y = t.y;
      _pos.z = t.z - ox * sn;
      resolveBody(g.world, _pos, PLAYER_RADIUS, PLAYER_HEIGHT, true);
      t.x = _pos.x;
      t.z = _pos.z;
      s.vx *= 0.7;
      s.vz *= 0.7;
    }
  }

  // ---------------------------------------------------------------- debug (admin chat)
  // /veh [list | moped | car | bike | fix | fuel | break | wreck | hp <n> | tp <n> | in <n> | out | starters]
  debug(p, args) {
    const g = this.g;
    const s = p.state;
    const say = (t) => g.sendChat(p, 0, 1, t);
    const near = () => {
      let best = this.of(p);
      let bd = 30;
      if (!best) {
        for (const e of this.list) {
          const d = Math.hypot(e.x - s.x, e.z - s.z);
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
      }
      return best;
    };
    const what = args[1] || 'list';
    const kind = { moped: VEH.MOPED, car: VEH.CAR, bike: VEH.BIKE, bicycle: VEH.BIKE }[what];
    if (kind) {
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      const P = VEHICLES[kind];
      // (/veh car at <x> <z> <yaw in degrees> [broken] [tint]: exactly there)
      const at = args[2] === 'at';
      const broken = args[at ? 6 : 2] === 'broken';
      const [x, z, yaw] = at ? [+args[3], +args[4], ((+args[5] || 0) * Math.PI) / 180] : [s.x + fx * (P.half + 1.6), s.z + fz * (P.half + 1.6), s.yaw + Math.PI / 2];
      const e = this.make(kind, x, z, yaw, { state: broken ? VSTATE.BROKEN : VSTATE.OK, need: broken ? fixMask(kind) : 0, fuel: P.tank, hp: P.hp, tint: +args[at ? 7 : 3] || 0 });
      return say(e ? `a ${VEH_NAMES[kind]} (${e.id})` : 'no entity id left for it');
    }
    if (what === 'list') return say(this.list.map((e, i) => `${i}:${VEH_NAMES[e.vk]}${e.quest ? '*' : e.starter ? '+' : ''}@${Math.round(e.x)},${Math.round(e.z)} ${['broken', 'ok', 'dead', 'wreck'][e.state]}`).join('  ') || 'this map has no vehicles (only the mainland has)');
    if (what === 'starters') {
      const n = Math.max(1, +args[2] || STARTERS.length);
      const spots = starterSpots(g.world);
      for (let team = g.players.size; this.starters < Math.min(n, spots.length) && team < 64; team++) this.provide(team); // (as for a bigger team)
      return say(`${this.starters} of the bridgehead's vehicles are out`);
    }
    if (what === 'tp' || what === 'in') {
      const e = this.list[+args[2] || 0];
      if (!e) return say('no such vehicle (/veh list)');
      if (this.of(p)) this.exit(p);
      if (what === 'in') {
        if (e.state !== VSTATE.OK) {
          e.state = VSTATE.OK;
          e.need = 0;
        }
        const k = this.freeSeat(e, args[3] ? +args[3] : 0);
        if (k < 0) return say('no seat free');
        s.ride = s.cart = 0;
        s.pinned = s.pulled = 0;
        this.sit(p, e, k);
        return;
      }
      const P = VEHICLES[e.vk];
      s.x = e.x + Math.cos(e.yaw) * -(P.halfW + 1.2);
      s.z = e.z - Math.sin(e.yaw) * -(P.halfW + 1.2);
      s.y = groundAt(g.world, s.x, s.z, e.y + 1, 0.3);
      s.vx = s.vy = s.vz = 0;
      s.yaw = Math.atan2(-(e.x - s.x), -(e.z - s.z));
      p.selfSync = true;
      g.fillHistory(p);
      return;
    }
    if (what === 'out') return this.exit(p);
    const e = near();
    if (!e) return say('no vehicle within 30 m');
    const P = VEHICLES[e.vk];
    const d = this.driver(e);
    if (what === 'fix') {
      e.state = VSTATE.OK;
      e.need = 0;
      e.hp = P.hp;
      if (d) d.state.ddead = 0;
    } else if (what === 'fuel') {
      e.fuel = args[2] !== undefined ? Math.max(0, Math.min(P.tank, +args[2] || 0)) : P.tank;
      if (d) d.state.dfuel = e.fuel;
    } else if (what === 'hp') {
      e.hp = Math.max(1, Math.min(P.hp, (+args[2] || 100) * 0.01 * P.hp));
    } else if (what === 'break') {
      if (e.state === VSTATE.BROKEN) e.state = VSTATE.OK;
      this.damage(e, e.hp + 1);
    } else if (what === 'wreck') {
      if (e.state === VSTATE.BROKEN) e.state = VSTATE.OK;
      this.damage(e, e.hp + 1);
      this.damage(e, P.hp);
    } else if (what === 'remove') {
      for (const id of e.seats) if (id && g.players.get(id)) this.exit(g.players.get(id));
      this.unpark(e);
      g.removeEntity(e);
      return;
    } else if (what === 'lights') {
      e.lights = e.lights ? 0 : 1;
    } else return say('Usage: /veh [list | moped | car | bike [broken] | fix | fuel [n] | hp <percent> | break | wreck | lights | remove | tp <n> | in <n> [seat] | out | starters [n]]');
    this.wire(e);
  }
}
