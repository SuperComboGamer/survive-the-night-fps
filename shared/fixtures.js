// Fixtures: things a survivor works by holding [E] that are neither an entity nor the car - the bell rope in
// St. Agnes Chapel and the radio set at the Relay Station. World generation builds both (the CHURCH and RELAY
// builders in world.js, at the spots below); the rules are in server/fixtures.js, the prompt in
// client/game/fixtures.js. Their interaction targets are BELL_ID / RADIO_ID in protocol.js.
import { ZONE, ITEM } from './defs.js';
import { INTERACT_REACH, INTERACT_SLACK } from './constants.js';

// Where they are, in their place's own frame: [x, height above the place's floor, z]. world.js puts the rope, the
// bell and the radio at numbers of its own (its builders take no imports): scripts/test-fixtures.js holds the two
// together, so move them together.
export const BELL_ROPE = [-1.05, 1.45, -1.3]; // where a hand takes the rope, just inside the chapel door
export const BELL_AT = [0, 10, -1.3]; // the bell it rings, in the belfry over the door: what is heard comes from here
export const RADIO_AT = [9.54, 1.04, 4.1]; // the face of the radio set beside the foot of the mast, under open sky

// The bell: hold [E] on the rope and it tolls. Every toll is a noise (NOISE.BELL) at the chapel.
export const BELL_HOLD_TIME = 1.5; // s
export const BELL_TOLLS = 3;
export const BELL_TOLL_GAP = 2.6; // s between tolls: three of them take a little over five, and ring out past six
export const BELL_COOLDOWN = 45; // s from the pull until the rope can be pulled again

// The radio: hold [E] with batteries in the backpack and a supply plane drops its crate where the caller stands.
export const RADIO_HOLD_TIME = 4; // s
export const RADIO_BATTERIES = 2;
export const RADIO_COST = { [ITEM.BATTERY]: RADIO_BATTERIES };
// why a call is refused (the arg of NOTIFY.RADIO_NO)
export const RADIO_NO = { BATTERIES: 1, CALLED: 2, NIGHT: 3 };

// What a fixture costs, for the item guide's "Used in" lines (client/game/itemguide.js)
export const FIXTURE_USES = [{ name: 'Supply drop (Relay Station radio)', cost: RADIO_COST }];

// Reach: the client offers [E] when its view ray passes within FIXTURE_PICK of the spot, inside INTERACT_REACH of
// the eye; the server allows the same and INTERACT_SLACK on top, as for an entity (Game.reachOf).
export const FIXTURE_PICK = 0.6;
export const FIXTURE_REACH = Math.hypot(INTERACT_REACH, FIXTURE_PICK) + INTERACT_SLACK;

const cache = new WeakMap();
// a spot [x, height, z] of a place's own frame, in the world (as the Builder in world.js puts it there)
export function placePoint(zone, [lx, ly, lz]) {
  const c = Math.cos(zone.ry);
  const s = Math.sin(zone.ry);
  return { x: zone.x + c * lx + s * lz, y: zone.h + ly, z: zone.z - s * lx + c * lz };
}

// Where this world's fixtures are: { bell: { rope: {x,y,z}, bell: {x,y,z} } | null, radio: {x,y,z} | null }.
// null: this map has no such place (the Relay Station is not on every one).
export function fixtureSpots(world) {
  let f = cache.get(world);
  if (!f) {
    const church = world.zoneById[ZONE.CHURCH];
    const relay = world.zoneById[ZONE.RELAY];
    f = { bell: church ? { rope: placePoint(church, BELL_ROPE), bell: placePoint(church, BELL_AT) } : null, radio: relay ? placePoint(relay, RADIO_AT) : null };
    cache.set(world, f);
  }
  return f;
}
