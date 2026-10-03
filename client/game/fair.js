// The Tri-County Fair in the client (the place and the ride geometry: shared/fair.js; what is drawn:
// render/fair.js). It reads the fair's entity (ENT.FAIR: does the generator run, the ride clock, the fuel left),
// decides what reading of the ride clock this frame is drawn at, and puts everything that depends on it there:
// the rides, the riders other players see, and the view of a player who is riding. It also offers [E] on the
// generator, its fuel drum and the seats, and plays the music.
//
// The clock that is drawn. A player in a seat sees the rides where their own prediction has them: their commands
// have moved their reading of the ride clock on ahead of what the server has confirmed, and their own seat must be
// under them. A player on foot sees them at the same moment - the server's clock, plus the lead their own commands
// have on it - so that the seat they get into is already where it will be once they sit in it, and nothing lurches
// as they board or get off. Either way it is one clock for the whole fair: the rides, the local rider and every
// other rider (drawn in their seat, not at their interpolated position) are locked to each other, and no link,
// however bad, can shake a rider in their seat. When that clock does have to step (the generator starting or dying
// under a rider, which their prediction cannot know of in advance; a correction after a stall) the step is carried
// as an offset that fades, so the rides glide to where they belong instead of jumping.
import { BTN, CMD_RATE, SERVER_TICK_RATE, INTERACT_REACH, EYE_HEIGHT } from '../../shared/constants.js';
import { ITEM, NOTIFY, ZONE } from '../../shared/defs.js';
import { ACT, ENT, FAIR_GEN_ID, FAIR_TANK_ID, playerRide } from '../../shared/protocol.js';
import { GEN, RIDE_SEATS, SEAT_PICK, seatPos, seatLow, isWheelSeat } from '../../shared/fair.js';
import { canReach } from '../../shared/collision.js';
import { FairView } from '../render/fair.js';
import { bindTag } from './binds.js';

const CMDS_PER_TICK = CMD_RATE / SERVER_TICK_RATE;
const M24 = 1 << 24;
const STEP = 2; // commands: the clock moving this much more or less than the frame is a step, not jitter
const FADE = 2.5; // 1/s: how fast a step's offset fades
const LAMP = 0xffc27a;
const _p = { x: 0, y: 0, z: 0 };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class FairClient {
  constructor(game) {
    this.g = game;
    this.fair = null; // world.fair (null: this valley has none)
    this.view = null;
    this.ent = null; // the ENT.FAIR entity
    this.running = false;
    this.fuel = 0; // seconds of running left in the tank
    this.clock = 0; // the ride clock as drawn this frame (commands, with a fraction)
    this.raw = 0; // ...before the fading offset
    this.res = 0; // ...and the offset
    this.stopped = 0; // the clock as the server last had it standing still
    this.lead = 0; // commands our own are ahead of the server as it is drawn (smoothed)
    this.lit = 0; // 0 dark .. 1 lit: the bulbs come up and die with the generator
    this.press = 0; // BTN.JUMP for a moment after [E] on "Get off": getting out of a seat is the simulation's jump
    this.pressT = 0;
    this.seated = 0; // 0..1: the view easing from where the player stood into the seat...
    this.from = { x: 0, y: 0, z: 0 }; // ...which is here
    this.lights = []; // the fair's lamps as light sources for the pool (Lights.update), while it is lit
    this.lamps = [];
    this.music = null;
    this.hum = null;
    this.target = { fair: '', seat: 0 }; // the look target handed to Game (interact)
  }

  setWorld(world) {
    this.stopLoops();
    this.view?.dispose();
    this.view = null;
    this.ent = null;
    this.fair = world?.fair || null;
    this.lights.length = 0;
    this.lamps.length = 0;
    this.clock = this.raw = this.res = this.stopped = this.lit = 0;
    this.running = false;
    if (!this.fair) return;
    this.view = new FairView(this.g.scene, world);
    // three of its lamps go to the light pool: over the midway, the carousel and the wheel
    for (const i of [1, 4, 5]) {
      const l = this.fair.lamps[i];
      this.lamps.push({ x: l.x, y: l.y - 0.9, z: l.z, intensity: 0, color: LAMP, big: true });
    }
  }

  stopLoops() {
    this.music?.stop();
    this.hum?.stop();
    this.music = this.hum = null;
  }

  // Once a frame, after the prediction has stepped and before anything is placed: the fair's state and the ride
  // clock for this frame.
  update(dt, time) {
    const g = this.g;
    const f = this.fair;
    if (!f) return;
    let e = this.ent;
    if (!e || g.entities.ents.get(e.id) !== e) {
      e = this.ent = null;
      this.stopped = 0;
      for (const x of g.entities.ents.values()) {
        if (x.kind !== ENT.FAIR) continue;
        e = this.ent = x;
        break;
      }
    }
    // How far our own commands run ahead of the server as it is drawn: the ones it has not acknowledged, and the
    // time the rest of the screen is drawn in the past by. It only changes with the link, so it is smoothed hard.
    const pred = g.prediction;
    const ahead = g.self.alive && pred.hasServerState ? pred.pending.length + pred.alpha + (g.latestTick - g.renderTick) * CMDS_PER_TICK : 0;
    this.lead += (ahead - this.lead) * Math.min(1, dt * 2);
    // the ride clock as the server has it, moved on by that lead
    let server = this.stopped;
    this.running = !!e && e.q[3] === 1;
    if (e) {
      const q = e.q;
      const v = q[4] | (q[5] << 8) | (q[6] << 16);
      const fu = q[7] | (q[8] << 8);
      if (this.running) {
        let d = (g.renderTick - v) % M24;
        if (d < 0) d += M24;
        if (d > M24 / 2) d = 0; // (our clock is still a moment before it was started)
        server = Math.max(this.stopped, d * CMDS_PER_TICK + this.lead);
        const left = (fu - g.net.tick) & 0xffff;
        this.fuel = left > 0xf000 ? 0 : left / SERVER_TICK_RATE;
      } else {
        server = this.stopped = v * CMDS_PER_TICK;
        this.fuel = fu / SERVER_TICK_RATE;
      }
    }
    // ...or as our own prediction has it, while we sit on a ride
    const s = pred.state;
    const mine = !!g.self.alive && s.ride > 0 && pred.prev.ride === s.ride;
    const want = mine ? pred.prev.rideT + (s.rideT - pred.prev.rideT) * pred.alpha : server;
    const go = mine ? s.rideGo : this.running;
    const step = want - (this.raw + (go ? dt * CMD_RATE : 0));
    this.raw = want;
    if (Math.abs(step) > STEP) this.res -= step;
    if (Math.abs(this.res) > 4 * CMD_RATE) this.res = 0; // (not a step: the first sight of it, another game)
    this.res *= Math.exp(-dt * FADE);
    this.clock = Math.max(0, want + this.res);
    this.seated = mine ? Math.min(1, this.seated + dt * 4) : 0;
    if (this.press && (!s.ride || (this.pressT -= dt) <= 0)) this.press = 0;

    // lights and sound follow the generator
    this.lit += ((this.running ? 1 : 0) - this.lit) * Math.min(1, dt * 4);
    if (this.lit < 0.003) this.lit = 0;
    this.lights.length = 0;
    if (this.lit > 0) {
      for (const l of this.lamps) {
        l.intensity = this.lit * 0.9;
        this.lights.push(l);
      }
    }
    if (this.running && !this.music) {
      const c = f.lamps[4];
      this.music = g.audio.createLoop?.('calliope', c.x, c.y + 1, c.z) || null;
      this.hum = g.audio.createLoop?.('generator', f.gen.x, f.gen.y, f.gen.z) || null;
    } else if (!this.running && this.music) this.stopLoops();
    this.view.update(this.clock, this.lit, time, g.camera.position);
  }

  // where a seat is drawn this frame
  seatAt(seat, out) {
    return seatPos(this.fair, seat, this.clock, out);
  }

  // moves `out` k of the way (0..1) to where that seat is drawn: another player getting into it, or out of it
  seatBlend(seat, out, k) {
    if (!this.fair) return;
    const u = k * k * (3 - 2 * k);
    seatPos(this.fair, seat, this.clock, _p);
    out.x += (_p.x - out.x) * u;
    out.y += (_p.y - out.y) * u;
    out.z += (_p.z - out.z) * u;
  }

  // The local player's view while they ride: where their seat is drawn. rp: their smoothed position, rewritten.
  // Getting on, the view eases from where they last stood on foot into the seat (the prediction itself jumps there
  // when the server seats them, by as far as the seat has gone round in the meantime).
  carry(rp) {
    const k = this.seated;
    const from = this.from;
    if (!k) {
      from.x = rp.x;
      from.y = rp.y;
      from.z = rp.z;
      return;
    }
    seatPos(this.fair, this.g.prediction.state.ride - 1, this.clock, _p);
    const u = k * k * (3 - 2 * k);
    rp.x = from.x + (_p.x - from.x) * u;
    rp.y = from.y + (_p.y - from.y) * u;
    rp.z = from.z + (_p.z - from.z) * u;
  }

  // who is drawn in a seat (0: nobody), ourselves included
  rider(seat) {
    const g = this.g;
    if (g.self.alive && g.prediction.state.ride === seat + 1) return g.myId;
    for (const e of g.entities.ents.values()) if (e.kind === ENT.PLAYER && playerRide(e.q[5]) === seat + 1) return e.id;
    return 0;
  }

  // The prompt of a player in a seat: [E] gets them out where the seat is at the ground, Space anywhere.
  rideLook(s) {
    const g = this.g;
    const f = this.fair;
    if (!f) return;
    if (seatLow(f, s.ride - 1, s.rideT)) {
      this.target.fair = 'off';
      g.lookTarget = this.target;
      g.prompt = `${bindTag('interact')} Get off`;
    } else g.prompt = `${bindTag('jump')} Jump out · ${Math.round(s.y - g.world.heightAt(s.x, s.z))} m down`;
  }

  // What of the fair the view ray (from o along d) is on, for a player on foot: the generator, its fuel drum, a
  // seat that can be got into. Sets Game.lookTarget / prompt and returns true if there is something.
  look(ox, oy, oz, dx, dy, dz, counts) {
    const g = this.g;
    const f = this.fair;
    if (!f || !this.ent) return false;
    const rp = g.renderPos;
    if ((rp.x - f.x) ** 2 + (rp.z - f.z) ** 2 > 60 * 60) return false;
    const reachTop = rp.y + EYE_HEIGHT;
    let best = '';
    let seat = 0;
    let bestT = INTERACT_REACH;
    // (the same test Entities.pick makes: the ray passes within r of the point, inside reach, with no wall between)
    const aim = (x, y, z, r) => {
      const rx = x - ox;
      const ry = y - oy;
      const rz = z - oz;
      const t = rx * dx + ry * dy + rz * dz;
      if (t < 0 || t > bestT + r) return false;
      const px = rx - dx * t;
      const py = ry - dy * t;
      const pz = rz - dz * t;
      if (px * px + py * py + pz * pz > r * r || t >= bestT || !canReach(g.world, ox, oy, oz, x, y, z, reachTop)) return false;
      bestT = t;
      return true;
    };
    if (aim(f.gen.x, f.gen.y, f.gen.z, GEN.pick)) best = 'gen';
    if (aim(f.tank.x, f.tank.y, f.tank.z, GEN.tankPick)) best = 'tank';
    for (let k = 0; k < RIDE_SEATS; k++) {
      if (!seatLow(f, k, this.clock)) continue;
      this.seatAt(k, _p);
      if (aim(_p.x, _p.y + SEAT_PICK.y, _p.z, SEAT_PICK.r)) {
        best = 'seat';
        seat = k;
      }
    }
    if (!best) return false;
    const have = counts[ITEM.AMMO_FUEL] || 0;
    const t = this.target;
    t.fair = best;
    t.seat = seat;
    g.lookTarget = t;
    if (best === 'gen') {
      if (this.running) g.prompt = `${bindTag('interact')} Hold to shut the generator off · ${mmss(this.fuel)} of fuel left`;
      else if (this.fuel > 0) g.prompt = `${bindTag('interact')} Hold to start the generator · ${mmss(this.fuel)} of fuel in the tank`;
      else if (have >= GEN.portion) g.prompt = `${bindTag('interact')} Hold to start the generator (${GEN.portion} Flamethrower Fuel)`;
      else {
        g.lookTarget = null;
        g.prompt = `The generator is dry · it burns Flamethrower Fuel, ${GEN.portion} for ${mmss(GEN.burn)}`;
      }
    } else if (best === 'tank') {
      if (this.fuel + GEN.burn > GEN.tank) {
        g.lookTarget = null;
        g.prompt = `Fuel drum · full (${mmss(this.fuel)})`;
      } else if (have >= GEN.portion) g.prompt = `${bindTag('interact')} Pour in ${GEN.portion} Flamethrower Fuel (+${mmss(GEN.burn)}, you carry ${have})`;
      else {
        g.lookTarget = null;
        g.prompt = `Fuel drum · ${mmss(this.fuel)} in the tank · a portion is ${GEN.portion} Flamethrower Fuel${have ? ` (you carry ${have})` : ''}`;
      }
    } else if (this.rider(seat)) {
      g.lookTarget = null;
      g.prompt = `${g.name(this.rider(seat))} has this seat`;
    } else g.prompt = isWheelSeat(seat) ? `${bindTag('interact')} Ride the Ferris wheel` : `${bindTag('interact')} Ride the carousel`;
    return true;
  }

  // [E] on what `look` or `rideLook` found
  interact(t) {
    const g = this.g;
    if (t.fair === 'off') {
      this.press = BTN.JUMP;
      this.pressT = 0.3;
      return;
    }
    if (t.fair === 'seat') return g.conn.action(ACT.RIDE, t.seat);
    g.askedCost = { [ITEM.AMMO_FUEL]: GEN.portion }; // (for NOTIFY.NOT_ENOUGH, should the server refuse)
    if (t.fair === 'gen') g.beginHold(FAIR_GEN_ID);
    else g.conn.action(ACT.INTERACT, FAIR_TANK_ID);
  }

  // The HUD's context panel while the player is at the fair: is the generator running, and for how long yet.
  hud() {
    const g = this.g;
    const zn = this.fair && this.ent ? g.world.zoneById[ZONE.FAIR] : null;
    if (!zn || Math.hypot(g.renderPos.x - zn.x, g.renderPos.z - zn.z) > zn.flat + 8) return null;
    const c = (this.ctx ||= { type: 'fair', running: false, fuel: 0, max: GEN.tank });
    c.running = this.running;
    c.fuel = this.fuel;
    return c;
  }

  // the fair's own notices. Returns true if msg was one.
  onNotify(msg, arg) {
    const ui = this.g.ui;
    const who = arg ? (arg === this.g.myId ? 'You' : this.g.name(arg)) : 'Somebody';
    if (msg === NOTIFY.FAIR_ON) {
      ui.notify(`${who} started the generator at the Tri-County Fair`, 'warning', 5);
      ui.notify('Its lights hold Shades. Its music brings every corpse that hears it to the midway.', 'toast', 7);
    } else if (msg === NOTIFY.FAIR_OFF) ui.notify(`${who} shut the fair's generator off`, 'toast', 4);
    else if (msg === NOTIFY.FAIR_DRY) ui.notify('The fair goes dark: its generator has run dry', 'warning', 5);
    else if (msg === NOTIFY.FAIR_FULL) ui.notify('The tank is full', 'toast', 2);
    else return false;
    return true;
  }
}
