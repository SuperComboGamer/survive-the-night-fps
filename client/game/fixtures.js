// The chapel bell and the Relay Station's radio (shared/fixtures.js) on the client: when [E] is offered on them, what
// the prompt says, and what the team is told. The rules are the server's (server/fixtures.js). What this file knows
// of their state - the bell still swinging, today's call already made - it has from the notices it was sent, so it
// can be out of date (a client that joined since). That only costs a prompt: [E] is sent whatever it believes, and
// the server answers a pull or a call it refuses with the reason.
import { PHASE, INTERACT_REACH } from '../../shared/constants.js';
import { ITEM, NOTIFY } from '../../shared/defs.js';
import { HOLD, BELL_ID, RADIO_ID } from '../../shared/protocol.js';
import { canReach } from '../../shared/collision.js';
import { fixtureSpots, FIXTURE_PICK, RADIO_BATTERIES, RADIO_NO } from '../../shared/fixtures.js';

export class FixtureUI {
  constructor(game) {
    this.g = game;
    this.bellUntil = 0; // (game.time) the rope can be pulled again
    this.calledDay = -1; // the day the radio's one call was made
  }

  // does the view ray pass within FIXTURE_PICK of sp, inside INTERACT_REACH of the eye, with no wall in between?
  // (what Entities.pick asks of an entity)
  aimed(sp, ox, oy, oz, dx, dy, dz, reachTop) {
    const rx = sp.x - ox;
    const ry = sp.y - oy;
    const rz = sp.z - oz;
    const t = rx * dx + ry * dy + rz * dz;
    if (t < 0 || t >= INTERACT_REACH) return false;
    const px = rx - dx * t;
    const py = ry - dy * t;
    const pz = rz - dz * t;
    if (px * px + py * py + pz * pz > FIXTURE_PICK * FIXTURE_PICK) return false;
    return canReach(this.g.world, ox, oy, oz, sp.x, sp.y, sp.z, reachTop);
  }

  // Game.updateLookTarget, with nothing nearer to pick up: the look target ('bell' / 'radio') and the prompt for the
  // fixture in the crosshair. counts: what the backpack holds. false: neither is.
  look(ox, oy, oz, dx, dy, dz, reachTop, counts) {
    const g = this.g;
    const f = fixtureSpots(g.world);
    if (f.bell && this.aimed(f.bell.rope, ox, oy, oz, dx, dy, dz, reachTop)) {
      const wait = Math.ceil(this.bellUntil - g.time);
      g.lookTarget = 'bell';
      g.prompt = wait > 0 ? `Bell rope · the bell is still swinging (${wait} s)` : '[E] Hold to ring the chapel bell';
      return true;
    }
    if (f.radio && this.aimed(f.radio, ox, oy, oz, dx, dy, dz, reachTop)) {
      const have = counts[ITEM.BATTERY] || 0;
      g.lookTarget = 'radio';
      if (this.calledDay === g.global.day) g.prompt = 'Radio · a supply drop was already called today';
      else if (g.global.phase !== PHASE.DAY) g.prompt = 'Radio · no plane flies at night';
      else if (have < RADIO_BATTERIES) g.prompt = `Radio · a supply drop needs ${RADIO_BATTERIES} Batteries (you have ${have})`;
      else g.prompt = `[E] Hold to call a supply drop to where you stand (${RADIO_BATTERIES} Batteries)`;
      return true;
    }
    return false;
  }

  // [E] on look target `t`
  interact(t) {
    this.g.beginHold(t === 'bell' ? BELL_ID : RADIO_ID);
  }

  // the progress ring's label while one of our holds runs ('' for any other kind)
  holdLabel(kind) {
    return kind === HOLD.BELL ? 'Ringing the bell…' : kind === HOLD.RADIO ? 'Calling for a supply drop…' : '';
  }

  // Game.onNotify: true when the notice was one of ours
  notify(msg, arg) {
    const g = this.g;
    const ui = g.ui;
    switch (msg) {
      case NOTIFY.NEW_GAME:
        this.bellUntil = 0;
        this.calledDay = -1;
        return false; // (the game's own business too)
      case NOTIFY.BELL:
        this.bellUntil = g.time + arg;
        ui.notify('The chapel bell is ringing. The dead are coming to it.', 'warning', 6);
        return true;
      case NOTIFY.BELL_WAIT:
        this.bellUntil = g.time + arg;
        ui.notify(`The bell is still swinging: ${arg} s before the rope will pull again`, 'toast', 2.5);
        return true;
      case NOTIFY.RADIO_CALL:
        this.calledDay = g.global.day;
        ui.notify(arg === g.myId ? 'The call is through. The crate comes down where you stood.' : `${g.name(arg)} called a supply drop to the Relay Station.`, 'good', 6);
        return true;
      case NOTIFY.RADIO_NO:
        if (arg === RADIO_NO.CALLED) this.calledDay = g.global.day;
        ui.notify(arg === RADIO_NO.CALLED ? 'A supply drop was already called today. The radio answers again after sunrise.' : arg === RADIO_NO.NIGHT ? 'No plane flies at night. Call again after sunrise.' : `The radio needs ${RADIO_BATTERIES} Batteries to call a supply drop`, 'warning', 3.5);
        g.audio.playLocal('build_fail');
        return true;
    }
    return false;
  }
}
