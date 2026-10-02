// The mounted gun at the Army Checkpoint, server side (the rules both ends share: shared/mountedgun.js).
// It is one entity, ENT.GUN, made with every new game on a map that has the nest: its belt and who mans it are the
// run's state and go with the run. It cannot be hurt or moved, and the dead take no notice of it.
// The gunner is not held in place: they man it for as long as they stand at the grips on their feet. Their commands
// fire it (BTN.GUN, see Game.processInputs), each round through Combat.fire like a round from any gun in the
// hands - rewound to what the gunner had on screen, their kill, their hit marker - and louder than any of those.
import { BTN, INTERACT_SLACK, HOLD_SLACK } from '../shared/constants.js';
import { ITEM, SOUND } from '../shared/defs.js';
import { ENT } from '../shared/protocol.js';
import { GUN, GUN_FIRED, GUN_DRY, gunNest, atGrips, gunAim, gunShot, stepGun } from '../shared/mountedgun.js';
import { countItem, removeItem } from './inventory.js';

const _shot = {};
const _aim = { yaw: 0, pitch: 0 };

export class MountedGun {
  constructor(game) {
    this.g = game;
    this.nest = null; // where it stands on this map (null: no checkpoint here)
    this.ent = null;
  }

  // the gun while it stands (a cleared world takes the entity with it)
  get gun() {
    return this.ent && !this.ent.removed ? this.ent : null;
  }

  // A new game: the gun is back on its tripod with a full belt and nobody at it.
  spawn() {
    const g = this.g;
    this.ent = null;
    const n = (this.nest = gunNest(g.world));
    if (!n) return;
    // (held / wait: the trigger as stepGun keeps it. feed: rounds owed to the belt by a feed under way)
    const e = { kind: ENT.GUN, x: n.x, y: n.y + GUN.pivotY, z: n.z, belt: GUN.mag, gunner: 0, yaw: n.ry, pitch: 0, wait: 0, held: 0, feeding: false, feed: 0, feedT: 0 };
    if (g.spawnEntity(e)) this.ent = e;
  }

  // can this player be at the gun at all, standing where they are? (slack: how far past the grips' reach)
  fit(p, slack) {
    const s = p.state;
    return p.alive && !p.zombie && !p.downed && atGrips(this.nest, s.x, s.y, s.z, GUN.reach + slack);
  }

  // ACT.GUN_MAN: take the grips (one gunner at a time), or let go of them
  man(p, on) {
    const e = this.gun;
    if (!e) return;
    if (!on) {
      if (e.gunner === p.id) this.release();
      return;
    }
    // (a prompt on screen is never refused for distance: the reach, and what the player moved since it was offered)
    if (e.gunner || !this.fit(p, INTERACT_SLACK)) return;
    e.gunner = p.id;
    e.held = 0;
    e.feeding = false;
    this.g.sound(SOUND.GUN_MAN, e.x, e.y, e.z, 25, p.id);
  }

  // the gunner lets go, or is made to: the gun stays pointing where they left it
  release() {
    const e = this.gun;
    if (!e || !e.gunner) return;
    const p = this.g.players.get(e.gunner);
    if (p) {
      gunAim(this.nest, p.state.yaw, p.state.pitch, _aim);
      e.yaw = _aim.yaw;
      e.pitch = _aim.pitch;
    }
    e.gunner = 0;
    e.held = 0;
    e.feeding = false;
  }

  // ACT.GUN_FEED: the gunner starts or stops feeding the belt from their backpack
  feed(p, on) {
    const e = this.gun;
    if (!e || e.gunner !== p.id) return;
    e.feeding = !!on && e.belt < GUN.mag && countItem(p.inv, ITEM.AMMO_762) > 0;
    if (!e.feeding) e.feed = 0;
  }

  // One command of a player's has been simulated (Game.processInputs). The gunner's are the gun's trigger; a hand
  // that is feeding the belt is not on it.
  command(p, cmd) {
    const e = this.ent;
    if (!e || e.gunner !== p.id || e.removed) return;
    const fired = stepGun(e, e.feeding ? cmd.buttons & ~BTN.GUN : cmd.buttons);
    if (fired === GUN_FIRED) this.g.combat.fire(p, gunShot(this.nest, p.state, cmd, _shot));
    else if (fired === GUN_DRY) this.g.sound(SOUND.DRY_FIRE, e.x, e.y, e.z, 20, p.id);
  }

  // once a tick: a gunner who went down, died, left or stepped away has let go; a feed under way moves its rounds
  update(dt) {
    const e = this.gun;
    if (!e || !e.gunner) return;
    const g = this.g;
    const p = g.players.get(e.gunner);
    // (held on to a little further out than it can be taken, like any hold)
    if (!p || !this.fit(p, INTERACT_SLACK + HOLD_SLACK)) return this.release();
    if (!e.feeding) return;
    e.feed += GUN.feed * dt;
    const n = Math.min(Math.floor(e.feed), GUN.mag - e.belt, countItem(p.inv, ITEM.AMMO_762));
    if (n > 0) {
      // out of the backpack, last stack first, as a reload takes them (Game.syncAmmo then has the reserve follow)
      removeItem(p.inv, ITEM.AMMO_762, n);
      p.invDirty = true;
      e.belt += n;
      e.feed -= n;
      if (g.time >= e.feedT) {
        e.feedT = g.time + 0.3;
        g.sound(SOUND.GUN_FEED, e.x, e.y, e.z, 20);
      }
    }
    if (e.belt >= GUN.mag || countItem(p.inv, ITEM.AMMO_762) <= 0) {
      e.feeding = false;
      e.feed = 0;
    }
  }

  // /gun (debug): to the grips. False on a map without the nest.
  teleport(p) {
    const n = this.nest;
    if (!this.gun || !n) return false;
    const s = p.state;
    s.x = n.x + Math.sin(n.ry) * (GUN.back + 0.45);
    s.z = n.z + Math.cos(n.ry) * (GUN.back + 0.45);
    s.y = n.y;
    s.vx = s.vy = s.vz = 0;
    return true;
  }
}
