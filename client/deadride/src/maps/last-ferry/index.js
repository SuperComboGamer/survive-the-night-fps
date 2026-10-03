// LAST FERRY — map definition. A harbour on a foggy night: a ferry carries you across rolling water from the city pier to a fish-market wharf,
// an island prison dock and a lighthouse rock. Zombies climb the pier ladders out of the water.
import pier from './pier.js';
import wharf from './wharf.js';
import prison from './prison.js';
import lighthouse from './lighthouse.js';
import { buildRoute } from './route.js';
import { buildFerry } from './vehicle.js';
import './zombies.js';   // registers the Harbour Dead variant set with the zombie factory (must run before the game calls zombies.prepare('last-ferry'))

export default {
  id: 'last-ferry', name: 'Last Ferry', tagline: 'One more crossing.', accent: '#ff9a4a',
  blurb: 'A harbour on a foggy night. The ferry carries you across rolling black water from the city pier to a fish-market wharf, an island prison dock and a lighthouse rock. The drowned harbour dead climb the pier ladders out of the water.',
  vehicleName: 'Harbour Ferry', zombieName: 'Harbour Dead', threat: 3,
  stops: [pier, wharf, prison, lighthouse],
  buildRoute, buildVehicle: buildFerry,
  zombies: { variants: ['ferry_dockworker', 'ferry_drowned', 'ferry_sailor', 'ferry_fishmonger', 'ferry_guard', 'ferry_inmate', 'ferry_keeper'] },
};
