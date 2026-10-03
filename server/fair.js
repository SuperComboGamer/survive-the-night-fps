// The Tri-County Fair on the server (the place itself and the ride geometry: shared/fair.js).
// Its generator is a fixture of the shed there. A survivor holds [E] on it to start it: it runs on Flamethrower
// Fuel poured in from what they carry, and holding [E] again shuts it off. While it runs the rides turn, the fair's
// lights hold Shades the way torchlight does (Zombies.isLit asks `lit`), and the music is a standing noise: every
// few seconds the dead with nobody to chase hear it from NOISE.FAIR metres off and come to the midway.
// The state the clients need rides in one entity (ENT.FAIR) that is in everybody's area of interest.
import { SERVER_TICK_RATE, CMD_RATE, NOISE, INTERACT_REACH, INTERACT_SLACK, HOLD_SLACK, EYE_HEIGHT } from '../shared/constants.js';
import { AMMO, NOTIFY, SOUND } from '../shared/defs.js';
import { ENT, HOLD, FAIR_GEN_ID } from '../shared/protocol.js';
import { GEN, RIDE_SEATS, SEAT_PICK, seatPos, seatLow, rideCarry } from '../shared/fair.js';
import { canReach, raycastWorld, COL } from '../shared/collision.js';
import { eyeHeight } from '../shared/playersim.js';

const CMDS_PER_TICK = CMD_RATE / SERVER_TICK_RATE;
const BURN = GEN.burn * SERVER_TICK_RATE; // ticks a portion of fuel runs it for
const TANK = GEN.tank * SERVER_TICK_RATE; // ...and the most the tank holds
// A rider's reading of the ride clock moves with their commands, the wheel's with the server's ticks. They stay
// together while the commands keep coming; a link that stalls, or a client running fast, lets them drift, and past
// this many commands (half a second: 0.6 m at the rim of the wheel) the rider is put back where their seat is.
const DRIFT = CMD_RATE / 2;
// A seat is on the move, and the client that offered [E] on it drew it where it was a moment ago: it is in reach
// this much further out than something standing still, and still low enough to get into this much higher up
const SEAT_SLACK = 1.3;
const RISE_SLACK = 0.35;
const BODY_AT = [0.9, 0.55, 0.2]; // head, chest, shins (as Zombies.isLit: light on any of them counts)
const _seat = { x: 0, y: 0, z: 0 };
const _ray = { t: -1, col: null, terrain: false };

export class Fair {
  constructor(game) {
    this.g = game;
    this.ent = null; // the ENT.FAIR entity (null: this valley has no fair, or the game has not started)
    this.running = false;
    this.clock = 0; // the ride clock, in commands: it only moves while the generator runs
    this.fuel = 0; // ticks of running left in the tank
    this.noiseT = 0;
  }

  // A new game: the generator is off, the tank dry.
  reset() {
    const g = this.g;
    const f = g.world.fair;
    this.ent = null;
    this.running = false;
    this.clock = 0;
    this.fuel = 0;
    this.noiseT = 0;
    if (!f) return;
    const e = { kind: ENT.FAIR, x: f.gen.x, y: f.gen.y, z: f.gen.z, running: 0, clock: 0, fuel: 0 };
    if (g.spawnEntity(e)) this.ent = e;
  }

  // The entity's fields as the wire wants them (FRF in protocol.js): while the generator runs, the tick at which
  // the clock read zero and the tick the tank runs dry at - both stand still, so a running fair costs no traffic.
  sync() {
    const e = this.ent;
    const ticks = Math.floor(this.clock / CMDS_PER_TICK);
    e.running = this.running ? 1 : 0;
    e.clock = (this.running ? this.g.tick - ticks : ticks) & 0xffffff;
    e.fuel = (this.running ? this.g.tick + this.fuel : this.fuel) & 0xffff;
  }

  update() {
    const g = this.g;
    if (!this.ent) return;
    if (this.running) {
      this.clock += CMDS_PER_TICK;
      if (--this.fuel <= 0) {
        this.fuel = 0;
        this.stop(null);
        g.notify(NOTIFY.FAIR_DRY, 0);
      } else if (--this.noiseT <= 0) {
        this.noiseT = GEN.noiseEvery * SERVER_TICK_RATE;
        const f = g.world.fair;
        g.zm.noise(f.x, f.z, NOISE.FAIR, f.y);
      }
    }
    for (const p of g.players.values()) {
      const s = p.state;
      if (!s.ride) continue;
      if (!p.alive) {
        // the dead stay slumped in their seat, and go round with it, until they rise somewhere else
        s.rideT = this.clock;
        rideCarry(s, g.world);
      } else if (s.rideGo && Math.abs(s.rideT - this.clock) > DRIFT) s.rideT = this.clock;
    }
  }

  // who sits in a seat
  rider(seat) {
    for (const p of this.g.players.values()) if (p.state.ride === seat + 1) return p;
    return null;
  }

  // ACT.RIDE: onto a seat that is free, low enough to get into and within reach (as the client offers it)
  board(p, seat) {
    const g = this.g;
    const s = p.state;
    if (!this.ent || !(seat < RIDE_SEATS) || s.ride || s.cart || s.pinned || s.pulled || s.hmg) return; // (hmg: arms full of the mounted gun)
    if (g.time - p.interactT < 0.15) return;
    p.interactT = g.time;
    const f = g.world.fair;
    if (this.rider(seat) || !seatLow(f, seat, this.clock, RISE_SLACK)) return;
    seatPos(f, seat, this.clock, _seat);
    const ey = s.y + eyeHeight(s);
    const ty = _seat.y + SEAT_PICK.y;
    if (Math.hypot(_seat.x - s.x, ty - ey, _seat.z - s.z) > Math.hypot(INTERACT_REACH, SEAT_PICK.r) + INTERACT_SLACK + SEAT_SLACK) return;
    if (!canReach(g.world, s.x, ey, s.z, _seat.x, ty, _seat.z, s.y + EYE_HEIGHT)) return;
    p.hold = null;
    s.ride = seat + 1;
    s.rideT = this.clock;
    s.rideGo = this.running ? 1 : 0;
    rideCarry(s, g.world);
    g.sound(SOUND.RIDE_BOARD, s.x, s.y + 0.5, s.z, 25);
  }

  // is p at one of the fixtures in the shed (pt: world.fair.gen or .tank), as near as the client offers [E] on it
  near(p, pt, r, slack = 0) {
    const s = p.state;
    if (!this.ent || s.ride) return false;
    const ey = s.y + eyeHeight(s);
    if (Math.hypot(pt.x - s.x, pt.z - s.z) > Math.hypot(INTERACT_REACH, r) + INTERACT_SLACK + slack || Math.abs(pt.y - ey) > INTERACT_REACH + r) return false;
    return canReach(this.g.world, s.x, ey, s.z, pt.x, pt.y, pt.z, s.y + EYE_HEIGHT);
  }

  // HOLD_BEGIN on the generator: start it, or shut it off
  holdBegin(p) {
    const g = this.g;
    if (!this.near(p, g.world.fair.gen, GEN.pick)) return;
    if (!this.running && this.fuel <= 0 && p.state.ammo[AMMO.FUEL] < GEN.portion) return g.notify(NOTIFY.NOT_ENOUGH, 0, p.id);
    p.hold = { kind: this.running ? HOLD.FAIR_STOP : HOLD.FAIR_START, target: FAIR_GEN_ID, t: 0, need: GEN.hold };
  }

  // the hold goes on while they stay at it, and while it is still the thing to do (nobody else got there first)
  holdOk(p, h) {
    return this.near(p, this.g.world.fair.gen, GEN.pick, HOLD_SLACK) && (h.kind === HOLD.FAIR_STOP) === this.running;
  }

  holdDone(p, h) {
    if (h.kind === HOLD.FAIR_STOP) this.stop(p);
    else this.start(p);
  }

  // A portion of the fuel p carries into the tank. False if they have not got one.
  pour(p) {
    if (p.state.ammo[AMMO.FUEL] < GEN.portion) return false;
    p.state.ammo[AMMO.FUEL] -= GEN.portion;
    this.fuel = Math.min(TANK, this.fuel + BURN);
    return true;
  }

  // INTERACT on the drum: top the tank up, running or not
  topUp(p) {
    const g = this.g;
    if (!this.near(p, g.world.fair.tank, GEN.tankPick)) return;
    if (this.fuel + BURN > TANK) return g.notify(NOTIFY.FAIR_FULL, 0, p.id);
    if (!this.pour(p)) return g.notify(NOTIFY.NOT_ENOUGH, 0, p.id);
    const t = g.world.fair.tank;
    g.sound(SOUND.FAIR_FUEL, t.x, t.y, t.z, 25);
    this.sync();
  }

  // p: who started it (null: a debug command). With a dry tank it takes its first portion from their backpack.
  start(p) {
    const g = this.g;
    if (!this.ent || this.running) return;
    if (this.fuel <= 0) {
      if (!p) this.fuel = BURN;
      else if (!this.pour(p)) return g.notify(NOTIFY.NOT_ENOUGH, 0, p.id);
    }
    this.running = true;
    this.noiseT = 0;
    this.turn(1);
    const gen = g.world.fair.gen;
    g.sound(SOUND.FAIR_START, gen.x, gen.y, gen.z, 70);
    g.notify(NOTIFY.FAIR_ON, p ? p.id : 0);
    this.sync();
  }

  // p: who shut it off (null: it ran dry). What is left in the tank stays in it.
  stop(p) {
    const g = this.g;
    if (!this.ent || !this.running) return;
    this.running = false;
    this.turn(0);
    const gen = g.world.fair.gen;
    g.sound(SOUND.FAIR_STOP, gen.x, gen.y, gen.z, 70);
    if (p) g.notify(NOTIFY.FAIR_OFF, p.id);
    this.sync();
  }

  // the rides start or stop under everyone sitting on them, each at the wheel's own reading of the clock
  turn(go) {
    for (const p of this.g.players.values()) {
      const s = p.state;
      if (!s.ride) continue;
      s.rideGo = go;
      s.rideT = this.clock;
    }
  }

  // Is the fair's light on this zombie? (One of the things Zombies.isLit asks about a Shade.) The lights are the
  // generator's: within reach of one of the fair's lamps, with a clear line from it to the head, the chest or the
  // shins, the way a torch counts - so the stalls and the shed cast shadows it can stand in.
  lit(z, height) {
    if (!this.running) return false;
    const g = this.g;
    const f = g.world.fair;
    if ((z.x - f.x) ** 2 + (z.z - f.z) ** 2 > 60 * 60) return false;
    for (const l of f.lamps) {
      if ((z.x - l.x) ** 2 + (z.y + height * 0.5 - l.y) ** 2 + (z.z - l.z) ** 2 > l.r * l.r) continue;
      for (let k = 0; k < BODY_AT.length; k++) {
        let dx = z.x - l.x;
        let dy = z.y + height * BODY_AT[k] - l.y;
        let dz = z.z - l.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len;
        dy /= len;
        dz /= len;
        raycastWorld(g.world, l.x, l.y, l.z, dx, dy, dz, len - 0.5, _ray, COL.NOBLOCK | COL.NOBULLET);
        if (_ray.t < 0) return true;
      }
    }
    return false;
  }

  // /fair: to the gate of the fair. /fair on | off: the generator, with a full tank. /fair wheel | carousel: into
  // a seat of that ride. /fair shed: to the door of the generator shed.
  debug(p, arg) {
    const g = this.g;
    const f = g.world.fair;
    if (!f || !this.ent) return g.systemChat('this valley has no fair');
    const s = p.state;
    const go = (lx, lz) => {
      s.ride = 0;
      s.x = f.x + f.c * lx + f.s * lz;
      s.z = f.z - f.s * lx + f.c * lz;
      s.y = g.world.heightAt(s.x, s.z) + 0.4;
      s.vx = s.vy = s.vz = 0;
      g.fillHistory(p);
    };
    if (arg === 'on') {
      this.fuel = TANK;
      if (this.running) this.sync();
      else this.start(null);
    } else if (arg === 'off') this.stop(p);
    else if (arg === 'wheel' || arg === 'carousel') {
      const first = arg === 'wheel' ? 0 : RIDE_SEATS / 2;
      for (let seat = first; seat < first + RIDE_SEATS / 2; seat++) {
        if (this.rider(seat)) continue;
        s.ride = seat + 1;
        s.rideT = this.clock;
        s.rideGo = this.running ? 1 : 0;
        rideCarry(s, g.world);
        g.fillHistory(p);
        break;
      }
    } else if (arg === 'shed') go(13, 9);
    else go(0, -31);
  }
}
