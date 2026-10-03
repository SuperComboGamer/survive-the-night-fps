// The mounted gun, server side (the rules both ends share: shared/mountedgun.js).
// It is one entity, ENT.GUN, made with every new game on a map that has the Army Checkpoint: its belt, who mans it,
// who carries it and where it stands are the run's state and go with the run. It cannot be hurt, and the dead take
// no notice of it.
// The gunner is not held in place: they man it for as long as they stand at the grips on their feet. Their commands
// fire it (BTN.GUN, see Game.processInputs), each round through Combat.fire like a round from any gun in the
// hands - rewound to what the gunner had on screen, their kill, their hit marker - and louder than any of those.
// Anybody can lift it (HOLD.GUN_LIFT, from its grips or beside it, or from wherever it lies) and carry it off: while
// they do it is theirs (s.hmg in their simulated state, which slows them and empties their hands), the entity rides
// along with them, and it goes down again where they set it up (ACT.GUN_PUT), where they drop it (a weapon switch,
// [G]) or where they fall (down, dead, turned, pinned, roped, gone or dropped off the game).
import { BTN, INTERACT_SLACK, HOLD_SLACK, SLOT_BUILD, SLOT_THROW, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE, SLOT_RADIO } from '../shared/constants.js';
import { AMMO, SOUND } from '../shared/defs.js';
import { ENT, HOLD } from '../shared/protocol.js';
import { groundAt } from '../shared/collision.js';
import { swimming } from '../shared/swim.js';
import { GUN, GUN_FIRED, GUN_DRY, GUN_STANDS, GUN_CARRIED, GUN_LYING, gunNest, atGrips, gunAim, gunShot, stepGun, snapNest, setUpSpot, canLift } from '../shared/mountedgun.js';

const _shot = {};
const _aim = { yaw: 0, pitch: 0 };
const _spot = { x: 0, y: 0, z: 0, ry: 0 };

export class MountedGun {
  constructor(game) {
    this.g = game;
    this.nest = null; // where it stands or lies ({ x, y, z, ry }: snapped, see snapNest); null while it is carried
    this.ent = null;
  }

  // the gun while it exists (a cleared world takes the entity with it)
  get gun() {
    return this.ent && !this.ent.removed ? this.ent : null;
  }

  // A new game: the gun is back on its tripod at the checkpoint with a full belt and nobody at it.
  spawn() {
    const g = this.g;
    this.ent = null;
    const n = gunNest(g.world);
    this.nest = n && { ...n };
    if (!n) return;
    // (held / wait: the trigger as stepGun keeps it. feed: rounds owed to the belt by a feed under way. ry: the way
    // its tripod faces; yaw / pitch: where the gun on it was left pointing)
    const e = { kind: ENT.GUN, x: n.x, y: n.y + GUN.pivotY, z: n.z, mode: GUN_STANDS, belt: GUN.mag, gunner: 0, carrier: 0, ry: n.ry, yaw: n.ry, pitch: 0, wait: 0, held: 0, feeding: false, feed: 0, feedT: 0 };
    if (g.spawnEntity(e)) this.ent = e;
  }

  // can this player be at the gun at all, standing where they are? (slack: how far past the grips' reach)
  fit(p, slack) {
    const s = p.state;
    const e = this.gun;
    return !!e && e.mode === GUN_STANDS && p.alive && !p.zombie && !p.downed && !s.hmg && atGrips(this.nest, s.x, s.y, s.z, GUN.reach + slack);
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
    if (p && this.nest) {
      gunAim(this.nest, p.state.yaw, p.state.pitch, _aim);
      e.yaw = _aim.yaw;
      e.pitch = _aim.pitch;
    }
    e.gunner = 0;
    e.held = 0;
    e.feeding = false;
  }

  // ACT.GUN_FEED: the gunner starts or stops feeding the belt from their 7.62
  feed(p, on) {
    const e = this.gun;
    if (!e || e.gunner !== p.id) return;
    e.feeding = !!on && e.belt < GUN.mag && p.state.ammo[AMMO.R762] > 0;
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

  // ---------------------------------------------------------------- carrying it
  // can this player lift it from where they stand? (on their feet, hands free of anything that holds them)
  liftable(p, slack) {
    const e = this.gun;
    const s = p.state;
    if (!e || e.mode === GUN_CARRIED || (e.gunner && e.gunner !== p.id)) return false;
    if (!p.alive || p.zombie || p.downed || s.hmg || s.ride || s.cart || s.pinned || s.pulled || swimming(this.g.world, s)) return false;
    return canLift(this.nest, e.mode === GUN_LYING, s.x, s.y, s.z, slack);
  }

  // HOLD_BEGIN on the gun: [E] held at it starts lifting it (a gunner lets go of the grips to do it)
  holdBegin(p) {
    const e = this.gun;
    if (!e || p.useItem || !this.liftable(p, INTERACT_SLACK)) return;
    if (e.gunner === p.id) this.release();
    p.hold = { kind: HOLD.GUN_LIFT, target: e.id, t: 0, need: GUN.lift };
    this.g.sound(SOUND.METAL_HIT, e.x, e.y - GUN.pivotY + 0.5, e.z, 18);
  }

  // a lift under way carries on while they stay by it and nobody takes the grips (Game.updateHold)
  holdOk(p) {
    return this.liftable(p, INTERACT_SLACK + HOLD_SLACK);
  }

  // ...and done: it is in their arms, and whatever was in their hands is put away
  lift(p) {
    const e = this.gun;
    if (!e) return;
    const s = p.state;
    if (e.gunner) this.release();
    e.mode = GUN_CARRIED;
    e.carrier = p.id;
    e.feeding = false;
    e.feed = 0;
    this.nest = null;
    s.hmg = 1;
    s.reloadT = 0;
    s.recoil = 0;
    // (a hammer, a throwable or the walkie-talkie in the hand would still have the mouse: the hand goes back to a weapon)
    if (s.slot === SLOT_BUILD || s.slot === SLOT_THROW || s.slot === SLOT_RADIO) s.slot = s.weapons[SLOT_PRIMARY] ? SLOT_PRIMARY : s.weapons[SLOT_PISTOL] ? SLOT_PISTOL : SLOT_MELEE;
    this.follow(p);
    this.g.sound(SOUND.METAL_HIT, s.x, s.y + 1, s.z, 25);
  }

  // ACT.GUN_PUT: the carrier sets it up where they face (how = 1), or drops it where they stand (0)
  put(p, how) {
    const e = this.gun;
    if (!e || e.mode !== GUN_CARRIED || e.carrier !== p.id || !p.state.hmg) return;
    const s = p.state;
    if (how) {
      if (!setUpSpot(this.g.world, s, _spot)) return; // (the client only offers it where there is room)
      this.stand(_spot);
      s.hmg = 0;
      s.switchT = 0.42; // (the hands go back to the weapon they put away)
      this.g.sound(SOUND.GUN_MAN, e.x, e.y, e.z, 25);
      return;
    }
    s.hmg = 0;
    this.drop(p);
  }

  // A weapon switch let go of it (the simulation's 'gun_drop', s.hmg already cleared), or the carrier fell: it goes
  // down on its side where they stand, facing the way they did.
  drop(p) {
    const e = this.gun;
    if (!e || e.mode !== GUN_CARRIED || e.carrier !== p.id) return;
    const s = p.state;
    this.lay(s.x, s.y, s.z, s.yaw);
  }

  lay(x, y, z, ry) {
    const e = this.gun;
    const g = this.g;
    const n = (this.nest = snapNest({ x, y: groundAt(g.world, x, z, y + 0.1, 0.3), z, ry }));
    e.mode = GUN_LYING;
    e.carrier = 0;
    e.gunner = 0;
    e.x = n.x;
    e.y = n.y + GUN.pivotY;
    e.z = n.z;
    e.ry = n.ry;
    g.sound(SOUND.METAL_HIT, n.x, n.y + 0.3, n.z, 30);
  }

  // up on its tripod at a spot setUpSpot found, pointing the way the tripod faces
  stand(n) {
    const e = this.gun;
    this.nest = { x: n.x, y: n.y, z: n.z, ry: n.ry };
    e.mode = GUN_STANDS;
    e.carrier = 0;
    e.gunner = 0;
    e.held = 0;
    e.x = n.x;
    e.y = n.y + GUN.pivotY;
    e.z = n.z;
    e.ry = n.ry;
    e.yaw = n.ry;
    e.pitch = 0;
  }

  // the entity goes where its carrier does (for who sees it, and where it falls if they vanish)
  follow(p) {
    const e = this.ent;
    const s = p.state;
    e.x = s.x;
    e.y = s.y + GUN.pivotY;
    e.z = s.z;
    e.ry = s.yaw;
  }

  // once a tick: a gunner who went down, died, left or stepped away has let go; a feed under way moves its rounds;
  // a carrier who can no longer carry it has dropped it
  update(dt) {
    const e = this.gun;
    if (!e) return;
    const g = this.g;
    // nobody carries it but its carrier (a state left over from a run, a respawn or a rejoin)
    for (const p of g.players.values()) if (p.state.hmg && (e.mode !== GUN_CARRIED || e.carrier !== p.id)) p.state.hmg = 0;
    if (e.mode === GUN_CARRIED) {
      const p = g.players.get(e.carrier);
      const s = p?.state;
      if (!p || p.away || !p.alive || p.zombie || p.downed || !s.hmg || s.pinned || s.pulled || s.ride || s.cart || swimming(g.world, s)) {
        if (s) {
          s.hmg = 0;
          this.lay(s.x, s.y, s.z, s.yaw);
        } else this.lay(e.x, e.y - GUN.pivotY, e.z, e.ry);
        return;
      }
      this.follow(p);
      return;
    }
    if (!e.gunner) return;
    const p = g.players.get(e.gunner);
    // (held on to a little further out than it can be taken, like any hold)
    if (!p || !this.fit(p, INTERACT_SLACK + HOLD_SLACK)) return this.release();
    if (!e.feeding) return;
    e.feed += GUN.feed * dt;
    const n = Math.min(Math.floor(e.feed), GUN.mag - e.belt, p.state.ammo[AMMO.R762]);
    if (n > 0) {
      // out of the reserve, as a reload takes them (the client hears of it in its next snapshot)
      p.state.ammo[AMMO.R762] -= n;
      e.belt += n;
      e.feed -= n;
      if (g.time >= e.feedT) {
        e.feedT = g.time + 0.3;
        g.sound(SOUND.GUN_FEED, e.x, e.y, e.z, 20);
      }
    }
    if (e.belt >= GUN.mag || p.state.ammo[AMMO.R762] <= 0) {
      e.feeding = false;
      e.feed = 0;
    }
  }

  // /gun (debug): to the grips, or beside it where it lies, or beside whoever carries it. False on a map without it.
  teleport(p) {
    const e = this.gun;
    if (!e) return false;
    const s = p.state;
    const n = this.nest || { x: e.x, y: e.y - GUN.pivotY, z: e.z, ry: e.ry };
    const back = e.mode === GUN_STANDS ? GUN.back + 0.45 : 1.2;
    s.x = n.x + Math.sin(n.ry) * back;
    s.z = n.z + Math.cos(n.ry) * back;
    s.y = n.y;
    s.vx = s.vy = s.vz = 0;
    return true;
  }
}
