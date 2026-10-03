// The generator and the floodlights it feeds (STRUCT.GENERATOR, STRUCT.FLOODLIGHT; numbers in shared/power.js).
// A generator burns Flamethrower Fuel out of its tank (e.burnLeft, in seconds) while its switch is on (e.off), and
// while it runs it does two things: every floodlight within GEN_RANGE is powered, and it hums - a noise raised
// through Zombies.noise every few seconds, so the idle dead drift towards it. A powered floodlight pins a Shade
// inside its cone the way a flashlight beam does (floodLit, the floodlights' clause of Zombies.isLit).
// Both are ordinary structures otherwise: they block, so the dead that walk into them break them, and a generator
// that is broken, switched off or dry takes its lights with it on the next tick.
import { SLOT_BUILD } from '../shared/constants.js';
import { ITEM, AMMO, STRUCT, STRUCT_DEFS, SOUND, NOTIFY } from '../shared/defs.js';
import { ENT } from '../shared/protocol.js';
import { mulberry32 } from '../shared/rng.js';
import { eyeHeight } from '../shared/playersim.js';
import { GEN_RANGE, GEN_FUEL_UNIT, GEN_TANK, GEN_LOW, GEN_HUM, GEN_HUM_EVERY, GEN_TOLD, FLOOD_RANGE, genState, genPour, floodAim, inFloodCone } from '../shared/power.js';

const BODY_AT = [0.9, 0.55, 0.2]; // head, chest, shins: light on any of them counts (as for every other light, zombies.js)
const _aim = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };

export class Power {
  constructor(game) {
    this.g = game;
    this.running = []; // this tick's running generators
    this.cones = []; // this tick's powered floodlights, flat [x, y, z, dx, dy, dz, ...]: lens and axis
    // The hum goes through Zombies.noise, which scatters where each zombie thinks a noise came from. That scatter is
    // drawn from this stream, never from the game's: a generator must not change what the rest of a seeded run rolls.
    this.rng = mulberry32(game.seed ^ 0x6e5e7);
  }

  // ---------------------------------------------------------------- every tick (Game.updateStructures)
  update(dt) {
    const g = this.g;
    const running = this.running;
    const cones = this.cones;
    running.length = 0;
    cones.length = 0;
    for (const e of g.structures) {
      if (e.stype !== STRUCT.GENERATOR) continue;
      if (!e.off && e.burnLeft > 0) {
        const was = e.burnLeft;
        e.burnLeft = Math.max(0, was - dt);
        if (was > GEN_LOW && e.burnLeft <= GEN_LOW) this.tell(e, NOTIFY.GEN_LOW);
        if (e.burnLeft <= 0) {
          g.sound(SOUND.GEN_STOP, e.x, e.y + 0.6, e.z, 40);
          this.tell(e, NOTIFY.GEN_OUT);
        } else {
          running.push(e);
          e.humT = (e.humT || 0) - dt;
          if (e.humT <= 0) {
            e.humT = GEN_HUM_EVERY;
            this.hum(e);
          }
        }
      }
      e.state = genState(!e.off, e.burnLeft);
    }
    for (const e of g.structures) {
      if (e.stype !== STRUCT.FLOODLIGHT) continue;
      e.state = 0;
      for (const s of running) {
        if ((s.x - e.x) ** 2 + (s.y - e.y) ** 2 + (s.z - e.z) ** 2 > GEN_RANGE * GEN_RANGE) continue;
        e.state = 1;
        floodAim(e.x, e.y, e.z, e.rot8, _aim);
        cones.push(_aim.x, _aim.y, _aim.z, _aim.dx, _aim.dy, _aim.dz);
        break;
      }
    }
  }

  // the price of the light: the idle dead within GEN_HUM of a running generator head for it
  hum(e) {
    const g = this.g;
    const main = g.rng;
    g.rng = this.rng;
    try {
      g.zm.noise(e.x, e.z, GEN_HUM, e.y);
    } finally {
      g.rng = main;
    }
  }

  tell(e, msg) {
    const g = this.g;
    for (const p of g.humans()) if (Math.hypot(p.state.x - e.x, p.state.z - e.z) <= GEN_TOLD) g.notify(msg, 0, p.id);
  }

  // ---------------------------------------------------------------- the Shade
  // The floodlights' clause of Zombies.isLit: the zombie (body height h) stands in the cone of a powered floodlight
  // with a clear line from the lens to its head, chest or shins. Walls, trees and hills cast shadows it can move in,
  // exactly as they do in a flashlight's beam. zm: the Zombies that asks (its clearLine is the shadow test).
  floodLit(zm, z, h) {
    const cones = this.cones;
    for (let i = 0; i < cones.length; i += 6) {
      const lx = cones[i];
      const lz = cones[i + 2];
      if ((z.x - lx) ** 2 + (z.z - lz) ** 2 > (FLOOD_RANGE + 1) * (FLOOD_RANGE + 1)) continue;
      _aim.x = lx;
      _aim.y = cones[i + 1];
      _aim.z = lz;
      _aim.dx = cones[i + 3];
      _aim.dy = cones[i + 4];
      _aim.dz = cones[i + 5];
      for (let k = 0; k < BODY_AT.length; k++) {
        const ty = z.y + h * BODY_AT[k];
        if (inFloodCone(_aim, z.x, ty, z.z, z.def.radius) && zm.clearLine(_aim.x, _aim.y, _aim.z, z.x, ty, z.z)) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- [E]
  // Game.interact on a structure: true when this was a generator's to handle. A tap of [E] pours fuel in. With the
  // hammer out a damaged one is mended like anything else (the client's prompt offers the same).
  interact(p, e) {
    if (e.stype !== STRUCT.GENERATOR) return false;
    if (p.state.slot === SLOT_BUILD && e.hp < e.maxHp * 0.99) return false;
    this.pour(p, e);
    return true;
  }

  // GEN_POUR units of the fuel carried into the tank, or as many as the survivor has or the tank has room for.
  // The switch is not touched: fuel into a dry tank with the switch on starts it, into one switched off does not.
  pour(p, e) {
    const g = this.g;
    const have = p.state.ammo[AMMO.FUEL];
    if (!have) return g.notify(NOTIFY.NOT_ENOUGH, ITEM.AMMO_FUEL, p.id);
    const n = genPour(have, e.burnLeft);
    if (n <= 0) return; // (full)
    p.state.ammo[AMMO.FUEL] -= n;
    const dry = e.burnLeft <= 0;
    e.burnLeft = Math.min(GEN_TANK, e.burnLeft + n * GEN_FUEL_UNIT);
    g.sound(SOUND.GEN_FUEL, e.x, e.y + 0.8, e.z, 20);
    if (dry && !e.off) this.started(e);
  }

  // ACT.GEN_SWITCH ([E] held): the switch, from where [E] reaches a structure. Off, the fuel stays in the tank.
  flip(p, id) {
    const g = this.g;
    const e = g.ents[id];
    if (!e || e.removed || e.kind !== ENT.STRUCTURE || e.stype !== STRUCT.GENERATOR) return;
    if (g.time - p.interactT < 0.3) return;
    const s = p.state;
    const reach = g.reachOf(e);
    if (Math.hypot(e.x - s.x, e.z - s.z) > reach || Math.abs(g.pickY(e) - s.y - eyeHeight(s)) > reach || !g.canReachEnt(p, e)) return;
    p.interactT = g.time;
    e.off = !e.off;
    if (e.burnLeft <= 0) g.sound(SOUND.SWITCH, e.x, e.y + 0.8, e.z, 12); // (a dry tank: the switch clicks, nothing else)
    else if (e.off) g.sound(SOUND.GEN_STOP, e.x, e.y + 0.6, e.z, 40);
    else this.started(e);
  }

  started(e) {
    this.g.sound(SOUND.GEN_START, e.x, e.y + 0.6, e.z, 45);
    e.humT = 0; // heard at once
  }

  // Game.demolish: a generator taken down gives back the fuel left in its tank (in whole units), so a team that
  // moves on and builds again by the next night's shelter loses only what it burnt
  demolished(p, e) {
    if (e.stype !== STRUCT.GENERATOR) return;
    const n = Math.floor(e.burnLeft / GEN_FUEL_UNIT);
    if (n > 0) this.g.giveOrDrop(p, ITEM.AMMO_FUEL, n);
  }

  // ---------------------------------------------------------------- /floodlight (debug commands)
  // what one generator and two floodlights cost, and a full tank of fuel
  give(p) {
    const g = this.g;
    const kit = { [ITEM.AMMO_FUEL]: Math.round(GEN_TANK / GEN_FUEL_UNIT) };
    for (const [type, n] of [[STRUCT.GENERATOR, 1], [STRUCT.FLOODLIGHT, 2]]) {
      const cost = STRUCT_DEFS[type].cost;
      for (const k in cost) kit[k] = (kit[k] || 0) + cost[k] * n;
    }
    for (const k in kit) g.giveOrDrop(p, +k, kit[k]);
  }
}
