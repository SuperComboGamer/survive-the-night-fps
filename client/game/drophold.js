// Dropping the weapon in your hands takes a hold of the drop key, not a press. G sits among the keys a fight keeps the
// left hand on (WASD, R, E, F): one stray press used to throw your gun on the ground with the horde on you. Held for
// DROP_HOLD it goes; let go sooner and nothing happens but a word on the HUD about holding it. (Settings > Controls >
// "Hold to drop weapon": off, a press drops it at once, as it always did. Dropping from the inventory screen - a right
// click on a weapon - is a deliberate act with the game paused around you, and stays a click.)
export const DROP_HOLD = 0.4; // seconds the drop key has to be held
export const TAP_HINT = 1.6; // seconds "Hold G to drop" stays up after a press too short to drop

export class DropHold {
  constructor() {
    this.t = -1; // seconds held so far, -1: not holding
    this.slot = -1; // the weapon slot the hold is for: switching weapons calls it off
    this.hint = 0; // seconds the tap hint is still up
  }

  get holding() {
    return this.t >= 0;
  }
  // 0..1 of the way to dropping, -1 when not holding
  get progress() {
    return this.t < 0 ? -1 : Math.min(1, this.t / DROP_HOLD);
  }

  // the drop key went down, for the weapon in this slot
  start(slot) {
    this.t = 0;
    this.slot = slot;
    this.hint = 0;
  }

  // the drop key came up (cancelled: let go of by the game, a menu taking over - no hint for that). -> 'tap' when it
  // was let go too soon (the hint is up now), null otherwise
  release(cancelled = false) {
    if (this.t < 0) return null;
    const short = this.t < DROP_HOLD;
    this.cancel();
    if (!short || cancelled) return null;
    this.hint = TAP_HINT;
    return 'tap';
  }

  cancel() {
    this.t = -1;
    this.slot = -1;
  }

  // once a frame: slot is the one in the hands now, able whether a drop can still happen (alive, not downed, the
  // controls live). -> 'drop' on the frame the hold is long enough (the hold is then over: one drop a hold)
  update(dt, slot, able = true) {
    if (this.hint > 0) this.hint = Math.max(0, this.hint - dt);
    if (this.t < 0) return null;
    if (!able || slot !== this.slot) {
      this.cancel();
      return null;
    }
    this.t += dt;
    if (this.t < DROP_HOLD) return null;
    this.cancel();
    return 'drop';
  }
}
