// Swimming in the lake and the ponds. Where the water is deeper than a survivor stands, it holds them up with their
// eyes just clear of the surface: to the simulation (playersim.js) the water is a floor at floatY, under the feet of
// anyone over a bed deeper than that, so walking in, floating off the bottom and finding it again on the way out
// are one smooth slope. Afloat, both hands are swimming (nothing in them works), the stride is a stroke, and stamina
// only goes: treading water, swimming, harder on sprint. Out of it the survivor is exhausted and starts to drown
// (the server, Game.updatePlayers) until their feet touch the bottom again - the lake is a way across and a way out
// of a tight spot, never somewhere to sit out a night. The dead don't swim (zombies.js keeps them out of deep water,
// and a turned survivor too: playersim.js).
import { WATER_LEVEL, EYE_HEIGHT, EYE_HEIGHT_CROUCH, EYE_HEIGHT_DOWNED, BTN } from './constants.js';

export const SWIM_CLEAR = 0.26; // eyes this far above the surface, afloat
export const SWIM_SPEED = 2.4; // m/s (walking 4.6)
export const SWIM_FAST = 3.6; // sprint held: hard strokes, on stamina at the sprinting rate
export const SWIM_DOWNED = 0.6; // downed in the water: barely keeping their head up
export const SWIM_ACCEL = 5; // (GROUND_ACCEL 11): a stroke takes a moment to get going...
export const SWIM_DRAG = 2.4; // (FRICTION 7) ...and the body glides on a metre after the last one
export const SWIM_TREAD = 1.2; // stamina a second treading water (100 of it: ~80 s)
export const SWIM_DRAIN = 2; // ...and swimming (~50 s, 120 m: the lake is ~80 m across where it is deep)
export const WADE_FROM = 0.3; // feet this deep and a survivor wades: slower the deeper they go...
export const WADE_SLOW = 0.45; // ...down to this much off their speed just before they float
export const DROWN_DPS = 12; // hp a second out of stamina afloat
export const SWIM_HANDS = BTN.ATTACK | BTN.ALT | BTN.RELOAD; // what the hands do, and can't while they swim

// the height a survivor's feet float at: eyes SWIM_CLEAR above the surface (downed, they float on their face with the
// head barely out, much higher in the water)
export const floatY = (s) => WATER_LEVEL + SWIM_CLEAR - (s.downed ? EYE_HEIGHT_DOWNED : EYE_HEIGHT);

// The floor the water makes under a survivor with their feet at y over (x, z): floatY where the lake or a pond is
// deeper than that, else -Infinity. Down in the mine (feet far under the terrain) there is no lake over them.
export function waterFloor(world, s, x, z, y = s.y) {
  const f = floatY(s);
  const h = world.heightAt(x, z);
  return h < f && y > h - 0.5 ? f : -Infinity;
}

// how deep in the water the feet are: 0 on dry ground, on a deck over the water and down in the mine
export function wadeDepth(world, x, y, z) {
  if (y >= WATER_LEVEL) return 0;
  const h = world.heightAt(x, z);
  return h < WATER_LEVEL && y > h - 0.5 ? WATER_LEVEL - y : 0;
}

// afloat: feet at the float height with the bed further down (a survivor; a turned one never swims). Down in the
// mine the feet are far under the terrain, and so not over it
export function swimming(world, s) {
  return !s.zombie && s.y <= floatY(s) + 0.01 && world.heightAt(s.x, s.z) < s.y - 0.01;
}

// how deep the feet are afloat, standing (where wading turns to swimming)...
export const SWIM_DEPTH = EYE_HEIGHT - SWIM_CLEAR;
// ...and the depth a crouch would put the eyes under: no ducking under the water
export const CROUCH_WADE = EYE_HEIGHT_CROUCH - SWIM_CLEAR;

// For a drawn survivor (the client knows their feet, not their state): out in the water and not on the bottom.
// Uses the standing float height, the downed one is checked by the caller where it matters.
export function afloatAt(world, x, y, z) {
  return y < WATER_LEVEL - 0.5 && wadeDepth(world, x, y, z) > 0 && world.heightAt(x, z) < y - 0.05;
}
