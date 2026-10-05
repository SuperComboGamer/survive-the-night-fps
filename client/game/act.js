// Which of the run's two acts this client is in (shared/acts.js), and what that changes on screen: the list of
// supplies the escape takes (the car's on the island, the plane's parts on the mainland) and the words for the thing
// they go into. SUPPLIES / SUPPLY_NEED here are live: the HUD, the map and the prompts import them from this file
// instead of shared/defs.js, and read the act's list whichever is being played. Game.loadWorld sets the act.
import { suppliesOf } from '../../shared/defs.js';
import { WORLD } from '../../shared/acts.js';

export let ACT_NOW = WORLD.ISLAND;
export let SUPPLIES = suppliesOf(ACT_NOW).items;
export let SUPPLY_NEED = suppliesOf(ACT_NOW).need;
const WORDS = {
  [WORLD.ISLAND]: { thing: 'car', The: 'The car', your: 'Your car', glyph: 'car', supplies: 'supplies', parts: 'car supplies', start: 'start the engine', go: 'drive away', getIn: 'Get in the car!', where: 'the valley' },
  [WORLD.MAINLAND]: { thing: 'plane', The: 'The plane', your: 'The plane', glyph: 'plane', supplies: 'parts', parts: 'plane parts', start: 'fuel it, warm it up', go: 'take off', getIn: 'Get in the plane!', where: 'the mainland' },
};
// the words for this act's vehicle
export let W = WORDS[ACT_NOW];

export function setAct(act) {
  ACT_NOW = act === WORLD.MAINLAND ? WORLD.MAINLAND : WORLD.ISLAND;
  ({ items: SUPPLIES, need: SUPPLY_NEED } = suppliesOf(ACT_NOW));
  W = WORDS[ACT_NOW];
}
