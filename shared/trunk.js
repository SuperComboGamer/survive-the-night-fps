// A car's boot is forced, not just searched. The container is what it always was (CONT.TRUNK: the same hold, the
// same loot, the same one-in-ten alarm - Game.searchCache); what is new is how long the hold takes, by what is in
// the hand, the blows the lever makes on the way (EVT.STRIKE, as any swing that lands on a wreck) and that the lid
// then stands open for everybody (the container's own searched state: client/render/wrecks.js `pry`).
// Every number of it is here.
import { ITEM, CONT } from './defs.js';
import { COL } from './collision.js';

export const PRY = {
  // seconds to get it open, by the melee weapon in the hand (a plain search is SEARCH_TIME, 1 s): a claw or a long
  // blade is a better lever than a short one; the search perk shortens all of them as it shortens a search
  time: { [ITEM.HAMMER]: 1.2, [ITEM.MACHETE]: 1.3, [ITEM.SPIKED_BAT]: 1.5, [ITEM.BAT]: 1.5, [ITEM.NUNCHAKU]: 1.6, [ITEM.KNIFE]: 1.8 },
  hand: 2.8, // ...and with no melee weapon in the hand: fingers under the lid, slowly. Nobody is locked out of a boot
  lever: 0.4, // s between heaves: each is a blow on the lid's edge that those near see and hear
  noise: 26, // m each heave carries to the dead (a swing at a wreck for scrap is 35, a gunshot 70)
  // the cars that have a boot lid. Everything else with a "trunk" to search (a pickup's bed, a camper's locker) is
  // searched as before
  types: ['car', 'car_wreck', 'car_open', 'car_burnt'],
};
export const pryTime = (weapon) => PRY.time[weapon] ?? PRY.hand;
// the weapon that does the prying: the one in the hand, when it is one a boot can be levered with
export const pryWeapon = (weapon) => (PRY.time[weapon] ? weapon : 0);

// how far behind a wreck its boot's container was put (shared/worldkit.js Builder.wreck)
const backOf = (type) => (type === 'pickup_truck' ? 2.9 : type === 'camper' ? 3.5 : 2.45);
const _near = [];
/**
 * The car a boot's container belongs to: the wreck the world put it behind (or null - a container on its own, a car
 * the game draws itself). c: the container ({ ctype, x, z }).
 */
export function trunkCar(world, c) {
  if (c.ctype !== CONT.TRUNK) return null;
  let best = null, bd = 0.6;
  for (const col of world.staticGrid.query(c.x, c.z, 4.5, _near)) {
    const p = col.tag;
    if (!(col.flags & COL.SALVAGE) || !p || typeof p !== 'object' || p.bare || p.live) continue;
    const back = backOf(p.type);
    const d = Math.hypot(p.x + Math.sin(p.ry) * back - c.x, p.z + Math.cos(p.ry) * back - c.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
// a car whose boot is shut by a lid that can be forced (the fourth sedan left in the street has its boot up already)
export const hasBootLid = (prop) => !!prop && PRY.types.includes(prop.type) && !(prop.type === 'car_open' && (((prop.seed | 0) % 4) + 4) % 4 === 3);
