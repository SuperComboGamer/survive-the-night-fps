// The valley's deer: what the server (server/deer.js) and the client (client/game/deer.js, the model in
// client/render/models/deer.js) have to agree on. A deer is an entity kind of its own (ENT.DEER), not a zombie:
// nothing that walks the zombie list ever meets one.
import { ITEM } from './defs.js';

// Animation states (on the wire). The numbers are the zombies' (ZANIM) for the states the two have in common, so a
// dead deer can lie in the client's corpse list beside the dead.
export const DANIM = {
  IDLE: 0, // standing with its head up: looking about, or watching what startled it
  WALK: 1,
  RUN: 2, // bounding
  DEAD: 7,
  GRAZE: 8, // head down in the grass
};

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

// The shapes a shot is judged against (shared/hitbox.js: rayHitbox takes them as it takes a zombie's): a body
// cylinder, and the head as a sphere ahead of it - up on the neck, or down in the grass while it grazes.
const BODY_R = 0.46;
const BODY_TOP = 1.02;
const HEAD_R = 0.2;
// [height, how far ahead] of the middle of the skull, as the model carries it (measured in the models sandbox)
export const DEER_HEAD = { up: [1.21, 0.76], run: [1.16, 0.86], graze: [0.36, 0.79] };
export function deerHitbox(yaw, anim) {
  const h = anim === DANIM.GRAZE ? DEER_HEAD.graze : anim === DANIM.RUN ? DEER_HEAD.run : DEER_HEAD.up;
  return { r: BODY_R, top: BODY_TOP, headY: h[0], headR: HEAD_R, hx: -Math.sin(yaw) * h[1], hz: -Math.cos(yaw) * h[1] };
}

// what a kill leaves on the ground, every time: [item, min, max]
export const DEER_LOOT = [
  [ITEM.LEATHER, 1, 2],
  [ITEM.VENISON_RAW, 2, 2],
];
