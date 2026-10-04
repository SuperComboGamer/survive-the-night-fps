// The world of an act (shared/acts.js): the island for act 1, the mainland for act 2, each from the run's one seed.
// The server and every client call this and get the same world, as they always have from createWorld.
import { createWorld } from './world.js';
import { createMainland } from './mainland.js';
import { WORLD } from './acts.js';

export const worldFor = (seed, act = WORLD.ISLAND) => (act === WORLD.MAINLAND ? createMainland(seed) : createWorld(seed));
