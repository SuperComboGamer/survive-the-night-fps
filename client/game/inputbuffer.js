// Input buffering: a press of fire, reload or jump that comes a moment too early is performed as soon as it can
// be, instead of being lost.
// The player simulation acts on the press itself (the button going down), so a click during the pistol's cooldown,
// R while the weapon is still being drawn or Space just before touchdown did nothing at all. Here the button mask
// of every command is shaped before it is simulated and sent: an early press is left out of the mask - for the
// simulation it is still to come - until the first command it can act on, for a short while. The server only ever
// sees an ordinary mask in which that press starts a few commands later, so the shared simulation and the protocol
// know nothing of this and the prediction stays exact.
import { BTN, CMD_DT, SLOT_PRIMARY } from '../../shared/constants.js';
import { WEAPONS } from '../../shared/defs.js';
import { createPlayerState, copyPlayerState, simulatePlayer, currentWeapon } from '../../shared/playersim.js';

// The buttons that are buffered and how long a press of each is held, in commands (60 a second).
// Fire and jump, 150 ms: enough for any click made during the pistol's cooldown (10 commands, and the next click
// cannot come sooner than 2 after the shot) and for Space on the way down, and short enough that what comes out is
// still the press the player made - held longer, a click would become a shot at wherever the crosshair has
// wandered since. So the slow guns (pump 0.85 s, rifle 1.2 s) forgive the last 150 ms of their cycle, no more.
// Reload, as long as the weapon draw lasts (0.42 s, 30 commands cover it): the draw is the one thing a reload
// waits for and nothing else can be done with the gun meanwhile, so the R of "2, R" counts wherever in the draw it
// falls. It is not held past the draw (`early` below): once the gun is up, an R that starts nothing is an R on a
// full magazine, and it must not come back as a reload after the next shot.
const BUFFERED = [BTN.ATTACK, BTN.JUMP, BTN.RELOAD];
const HOLD = [9, 9, 30];

// Whether a press acts is asked of the simulation itself, not worked out from its rules: the command is run on a
// scratch copy of the state with the press and without, and it acts when that makes something else happen (the
// simulation's events: a shot, a swing, a throw, a dry click, a reload, a jump).
const _with = createPlayerState();
const _without = createPlayerState();
const _evWith = [];
const _evWithout = [];
const _cmd = { seq: 0, buttons: 0, yaw: 0, pitch: 0, slot: 255 };

function tryCommand(out, events, s, cmd, buttons, world) {
  copyPlayerState(out, s);
  events.length = 0;
  _cmd.seq = cmd.seq;
  _cmd.buttons = buttons;
  _cmd.yaw = cmd.yaw;
  _cmd.pitch = cmd.pitch;
  _cmd.slot = cmd.slot;
  simulatePlayer(out, _cmd, world, events);
}

function sameEvents(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) for (const k in a[i]) if (a[i][k] !== b[i][k]) return false;
  return true;
}

// What a press was made for: the weapon in hand (not for a jump), whether an item is in the hands instead, and being
// up, down or turned. A held press is dropped when this changes under it, so a click never comes out of another
// weapon, and one made before an item came out does not put it away.
function context(s, bit) {
  return (bit === BTN.JUMP ? 0 : s.slot + 1 + (currentWeapon(s) << 3) + (s.using ? 1 << 22 : 0)) | (s.downed ? 1 << 20 : 0) | (s.zombie ? 1 << 21 : 0);
}

export class InputBuffer {
  constructor() {
    this.raw = 0; // the buttons really held at the previous command
    // per buffered button: > 0 commands its early press is still held for, -1 the press was dropped (too early
    // after all, or no longer what it was pressed for) and its button is still down, 0 nothing: the real button
    this.left = [0, 0, 0];
    this.ctx = [0, 0, 0]; // what each held press was made for
  }

  // nothing held may act later (death, a menu or the chat taking the input)
  clear() {
    this.raw = 0;
    this.left.fill(0);
  }

  // The buttons command `cmd` goes out with, given the real ones in cmd.buttons and the state `s` it will run on.
  // Called once for every command, in order, before it is simulated.
  shape(cmd, s, world) {
    const raw = cmd.buttons;
    const fresh = raw & ~this.raw; // pressed since the previous command
    this.raw = raw;
    let b = raw;
    let open = 0; // the buttons to decide on in this command
    for (let i = 0; i < BUFFERED.length; i++) {
      const bit = BUFFERED[i];
      // (a second early press takes the place of the first: one action comes of the two)
      if (fresh & bit) this.left[i] = HOLD[i] + 1;
      else if (this.left[i] > 0 && context(s, bit) !== this.ctx[i]) this.left[i] = -1;
      if (this.left[i] < 0 && !(raw & bit)) this.left[i] = 0;
      if (this.left[i]) open |= bit;
    }
    if (open) {
      b &= ~open;
      const base = b;
      tryCommand(_without, _evWithout, s, cmd, base, world);
      for (let i = 0; i < BUFFERED.length; i++) {
        const bit = BUFFERED[i];
        if (!(open & bit)) continue;
        tryCommand(_with, _evWith, s, cmd, base | bit, world);
        const acts = !sameEvents(_evWith, _evWithout);
        if (this.left[i] > 0) {
          if (acts) {
            // this is the command the press goes into (at once, if it was not early at all)
            b |= bit;
            this.left[i] = 0;
            continue;
          }
          if (fresh & bit) this.ctx[i] = context(_without, bit);
          // a reload only waits for the weapon to be up; fire and jump wait out their time
          const early = bit !== BTN.RELOAD || _without.switchT > 0;
          if (early && --this.left[i] > 0) continue;
          this.left[i] = -1;
        }
        // A dropped press: the mask goes back to the real button, on a command in which that does nothing - a
        // button that stays down from there on is not a press. Until then (or until it is let go) it stays out.
        if (!acts) {
          b |= raw & bit;
          this.left[i] = 0;
        }
      }
    }
    // An automatic that runs dry with the trigger held. The simulation reloads an empty magazine on a new pull of
    // the trigger and that is not coming, so the reload is asked for here, on the first command that can start it
    // (the conditions are the simulation's own for a reload; lastBtn: R has to go down in this command to count).
    if (b & s.lastBtn & BTN.ATTACK && !((b | s.lastBtn) & BTN.RELOAD)) {
      const def = WEAPONS[currentWeapon(s)];
      if (def && def.auto && s.mags[s.slot === SLOT_PRIMARY ? 0 : 1] === 0 && s.ammo[def.ammo] > 0 && s.reloadT <= 0 && s.switchT - CMD_DT <= 0) b |= BTN.RELOAD;
    }
    return b;
  }
}
