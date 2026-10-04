// The chapel bell and the Relay Station's radio (shared/fixtures.js): two things in the world a survivor works by
// holding [E]. Neither is an entity; Game.holdBegin / updateHold hand their holds over to this.
//
// The bell: three tolls, each a noise at the chapel that carries further than any other in the game (NOISE.BELL), so
// the idle dead and the wandering herd leave where they are and come to it. A way to empty a place before searching
// it, or to bring everything onto the chapel.
// The radio: two batteries and a supply plane drops its crate where the caller stands - the scheduled planes'
// machinery (Game.flySupplyDrop), aimed. Once a day, and by day: no plane flies at night.
import { PHASE, NOISE, HOLD_SLACK, EYE_HEIGHT, MAP_HALF } from '../shared/constants.js';
import { ITEM, SOUND, NOTIFY, ZONE } from '../shared/defs.js';
import { HOLD, BELL_ID, RADIO_ID } from '../shared/protocol.js';
import { canReach, resolveBody, groundAt } from '../shared/collision.js';
import { eyeHeight } from '../shared/playersim.js';
import { mulberry32 } from '../shared/rng.js';
import { fixtureSpots, placePoint, FIXTURE_REACH, RADIO_AT, BELL_HOLD_TIME, BELL_TOLLS, BELL_TOLL_GAP, BELL_COOLDOWN, RADIO_HOLD_TIME, RADIO_BATTERIES, RADIO_NO } from '../shared/fixtures.js';
import { countItem, removeItem } from './inventory.js';

const CRATE_ROOM = 0.75; // a called crate comes down this clear of whatever stands next to the caller (m)
const _pos = { x: 0, y: 0, z: 0 };

export class Fixtures {
  constructor(g) {
    this.g = g;
    this.reset();
  }

  // a new run (Game.clearWorld)
  reset() {
    this.bellReadyAt = 0; // game time the rope can be pulled again
    this.tolls = 0; // tolls still to come of the pull under way...
    this.tollT = 0; // ...and the time to the next one
    this.calledDay = 0; // the day a plane was last called on the radio (one a day: a new day is a new number)
  }

  // the handoff (gamestate.js)
  save() {
    return { bellReadyAt: this.bellReadyAt, tolls: this.tolls, tollT: this.tollT, calledDay: this.calledDay };
  }
  load(s) {
    Object.assign(this, s);
  }

  owns(id) {
    return id === BELL_ID || id === RADIO_ID;
  }

  // where the hand goes for target `id` on this map (null: the map has no such place)
  spot(id) {
    const f = fixtureSpots(this.g.world);
    return id === BELL_ID ? f.bell && f.bell.rope : id === RADIO_ID ? f.radio : null;
  }

  // within arm's length of the spot, and no wall between it and the eye (as Game.reachOf / canReachEnt for an entity)
  inReach(p, sp, slack) {
    const s = p.state;
    const ey = s.y + eyeHeight(s);
    const reach = FIXTURE_REACH + slack;
    if (Math.hypot(sp.x - s.x, sp.z - s.z) > reach || Math.abs(sp.y - ey) > reach) return false;
    return canReach(this.g.world, s.x, ey, s.z, sp.x, sp.y, sp.z, s.y + EYE_HEIGHT);
  }

  // why the radio will not call a plane for p right now (RADIO_NO), 0 when it will
  radioRefusal(p) {
    const g = this.g;
    if (this.calledDay === g.day) return RADIO_NO.CALLED;
    if (g.phase !== PHASE.DAY) return RADIO_NO.NIGHT;
    if (countItem(p.inv, ITEM.BATTERY) < RADIO_BATTERIES) return RADIO_NO.BATTERIES;
    return 0;
  }

  // ACT.HOLD_BEGIN on one of ours. A refusal is said (to p alone): the prompt offered [E], or p's client did not
  // know better (it joined after the bell was rung, or after the day's call went out)
  holdBegin(p, id) {
    const g = this.g;
    const sp = this.spot(id);
    if (!sp || !this.inReach(p, sp, 0)) return;
    if (id === BELL_ID) {
      const wait = this.bellReadyAt - g.time;
      if (wait > 0) return g.notify(NOTIFY.BELL_WAIT, Math.ceil(wait), p.id);
      p.hold = { kind: HOLD.BELL, target: id, t: 0, need: BELL_HOLD_TIME };
      g.sound(SOUND.BELL_ROPE, sp.x, sp.y, sp.z, 25);
      return;
    }
    const why = this.radioRefusal(p);
    if (why) return g.notify(NOTIFY.RADIO_NO, why, p.id);
    p.hold = { kind: HOLD.RADIO, target: id, t: 0, need: RADIO_HOLD_TIME };
    g.sound(SOUND.RADIO_TUNE, sp.x, sp.y, sp.z, 30);
  }

  // is the hold h still good? (Game.updateHold, every tick of it)
  holdOk(p, h) {
    const sp = this.spot(h.target);
    if (!sp || !this.inReach(p, sp, HOLD_SLACK)) return false;
    // somebody else rang it, or made the day's call, while this one was still holding
    return h.target === BELL_ID ? this.g.time >= this.bellReadyAt : !this.radioRefusal(p);
  }

  holdDone(p, h) {
    if (h.target === BELL_ID) {
      if (!this.ringBell()) return;
      this.g.track?.bell(p);
      this.g.ach?.bell(p, this.g.phase === PHASE.NIGHT);
    } else this.callPlane(p);
  }

  // The rope is pulled: the tolls follow from update, the first one at once
  ringBell() {
    const g = this.g;
    if (!fixtureSpots(g.world).bell) return false;
    this.bellReadyAt = g.time + BELL_COOLDOWN;
    this.tolls = BELL_TOLLS;
    this.tollT = 0;
    g.notify(NOTIFY.BELL, BELL_COOLDOWN);
    return true;
  }

  // p's call goes out: the batteries are spent and a plane is on its way to where p stands at this moment
  callPlane(p) {
    const g = this.g;
    const sp = this.spot(RADIO_ID);
    const s = p.state;
    removeItem(p.inv, ITEM.BATTERY, RADIO_BATTERIES);
    p.invDirty = true;
    this.calledDay = g.day;
    // (a step clear of the radio's cabinet, the mast and any wall the caller leans on: the crate is a metre across)
    _pos.x = s.x;
    _pos.y = s.y;
    _pos.z = s.z;
    resolveBody(g.world, _pos, CRATE_ROOM, 1.2);
    const lim = MAP_HALF - 2;
    // the plane's heading comes off a stream of its own: the game's is not drawn from, so nothing else moves
    const heading = mulberry32((g.seed ^ 0x7ad10) + g.tick)() * Math.PI * 2;
    g.flySupplyDrop(Math.max(-lim, Math.min(lim, _pos.x)), Math.max(-lim, Math.min(lim, _pos.z)), heading, s.y);
    g.sound(SOUND.RADIO_CALL, sp.x, sp.y, sp.z, 70);
    g.zm.noise(sp.x, sp.z, NOISE.RADIO);
    g.notify(NOTIFY.RADIO_CALL, p.id);
    g.track?.radioCall(p);
    g.ach?.radioCall(p);
  }

  // every tick: the tolls of a pull under way
  update(dt) {
    if (!this.tolls) return;
    this.tollT -= dt;
    if (this.tollT > 0) return;
    this.tollT += BELL_TOLL_GAP;
    this.tolls--;
    const g = this.g;
    const f = fixtureSpots(g.world).bell;
    if (!f) return;
    // heard by every survivor wherever they are (no radius), and by the dead for NOISE.BELL around
    g.sound(SOUND.BELL_TOLL, f.bell.x, f.bell.y, f.bell.z, 0);
    g.zm.noise(f.bell.x, f.bell.z, NOISE.BELL);
  }

  // /bell and /radio (debug commands). true: the command was one of ours
  debug(p, args) {
    const g = this.g;
    const s = p.state;
    if (args[0] === 'bell') {
      // ring it now, from anywhere and whatever the rope says
      this.ringBell();
      return true;
    }
    if (args[0] !== 'radio') return false;
    // to the radio, a step in front of it, with the batteries a call costs
    const zone = g.world.zoneById[ZONE.RELAY];
    if (!zone) {
      g.systemChat('this valley has no Relay Station (the radio is only on maps that drew one)');
      return true;
    }
    const st = placePoint(zone, [RADIO_AT[0], 0, RADIO_AT[2] - 1.2]);
    s.x = st.x;
    s.z = st.z;
    s.y = groundAt(g.world, s.x, s.z, 200, 0.3);
    s.vx = s.vy = s.vz = 0;
    g.fillHistory(p);
    const short = RADIO_BATTERIES - countItem(p.inv, ITEM.BATTERY);
    if (short > 0) {
      g.giveItem(p, ITEM.BATTERY, short);
      p.invDirty = true;
    }
    g.systemChat(`at the Relay Station's radio, with ${RADIO_BATTERIES} Batteries: turn round to it and hold [E]`);
    return true;
  }
}
