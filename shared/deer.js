// The valley's deer: what the server (server/deer.js) and the client (client/game/deer.js, the model in
// client/render/models/deer.js) have to agree on. A deer is an entity kind of its own (ENT.DEER), not a zombie:
// nothing that walks the zombie list ever meets one. On the mainland (map 2) every deer is undead (DEER_UNDEAD):
// the same entity, in packs that roam, fear nothing, and charge a survivor who comes near (UNDEAD).
import { ITEM } from './defs.js';

// Animation states (on the wire). The numbers are the zombies' (ZANIM) for the states the two have in common, so a
// dead deer can lie in the client's corpse list beside the dead.
export const DANIM = {
  IDLE: 0, // standing with its head up: looking about, or watching what startled it
  WALK: 1,
  RUN: 2, // bounding
  ATTACK: 3, // (undead) the ram: the antlers driven into a survivor and tossed up
  CHARGE: 4, // (undead) head down, antlers first: pawing the ground before it goes (standing), or the charge itself
  DEAD: 7,
  GRAZE: 8, // head down in the grass
};

// the bit of the variant byte (sent in the create) that makes a deer undead; the rest is the coat as before
export const DEER_UNDEAD = 0x80;

export const DEER = {
  hp: 70,
  groups: 20, // groups in the valley
  cap: 64, // ...and deer, at most
  groupMin: 2,
  groupMax: 4,
  // how near a survivor may come before the group bolts (m), and what crouching, lying wounded or sprinting does to
  // it: the numbers the dead notice a survivor by (Zombies.chooseTarget)
  notice: 12, // (was 22)
  crouch: 0.6,
  downed: 0.5,
  sprint: 1.3,
  dread: 16, // the dead this close send them running (m)
  walk: 1.2, // m/s grazing from tuft to tuft, or drifting to new ground
  run: 9, // m/s bolting: a sprinting survivor does 7.5
  flee: 60, // how far a bolt takes them (m)
  radius: 0.4, // the body it moves through the world with
  height: 1.25,
  corpse: 45, // s a dead one lies there
};

// The undead deer of the mainland: a pack roams the woods and the plain at a walk and turns on a survivor who comes
// within `notice` (the same crouch / sprint multipliers; a survivor lying downed is not hunted). Each of the pack
// closes at `run`, stops `chargeFrom` m out and lowers its antlers for `windup` s (the telegraph: step aside), then
// charges at `charge` m/s for `chargeT` s at most, turning `steer` rad/s after its prey. One that gets home rams for
// `dmg` (x the day's claw multiplier, x the difficulty) and knocks the survivor `knock` m/s back (not again while they
// are still off their feet from the last: the shoves of a pack do not add up); hit or miss it
// carries on past by `overrun` m, wheels and comes again after `cd` s. No two of a pack go within `gap` s of each
// other. A pack gives up on a survivor who gets `leash` m from it (or is out of its reach for `lose` s), and turns on
// whoever shoots one of it, or fires a gun within `leash` m. Numbers are a first guess.
export const UNDEAD = {
  ...DEER,
  hp: 90,
  groups: 18,
  cap: 80,
  groupMin: 3,
  groupMax: 5,
  notice: 20,
  walk: 1.3,
  run: 8.4, // m/s closing in: a sprinting survivor does 7.5
  charge: 12,
  chargeFrom: 11,
  windup: 0.6,
  chargeT: 1.4,
  steer: 0.25,
  hitAhead: 1.7, // a charge gets home on a survivor this far ahead of its middle (m)...
  hitSide: 0.8, // ...and this far to either side of its line
  dmg: 18,
  knock: 5,
  up: 2.5,
  stun: 0.2,
  overrun: [6, 10],
  cd: [2, 3.5],
  gap: 1.2,
  leash: 60,
  lose: 8,
  start: 130, // no pack is put down nearer than this to where a run on the map begins (m)
};

// The shapes a shot is judged against (shared/hitbox.js: rayHitbox takes them as it takes a zombie's): a body
// cylinder, and the head as a sphere ahead of it - up on the neck, or down in the grass while it grazes.
const BODY_R = 0.46;
const BODY_TOP = 1.02;
const HEAD_R = 0.2;
// [height, how far ahead] of the middle of the skull, as the model carries it (measured in the models sandbox). The
// undead's charge: 0.94 m standing with the antlers down, 0.94-1.17 m through a bound at a charge's pace
export const DEER_HEAD = { up: [1.21, 0.76], run: [1.16, 0.86], graze: [0.36, 0.79], charge: [1.0, 0.93] };
export function deerHitbox(yaw, anim) {
  const h = anim === DANIM.GRAZE ? DEER_HEAD.graze : anim === DANIM.RUN ? DEER_HEAD.run : anim === DANIM.CHARGE ? DEER_HEAD.charge : DEER_HEAD.up;
  return { r: BODY_R, top: BODY_TOP, headY: h[0], headR: HEAD_R, hx: -Math.sin(yaw) * h[1], hz: -Math.cos(yaw) * h[1] };
}

// what a kill leaves on the ground, every time: [item, min, max]. An undead one's meat is not fit to eat
export const DEER_LOOT = [
  [ITEM.LEATHER, 1, 2],
  [ITEM.VENISON_RAW, 2, 2],
];
export const UNDEAD_LOOT = [[ITEM.LEATHER, 1, 2]];
