import surface from './surface.js';
import tunnels from './tunnels.js';
import flooded from './flooded.js';
import crystal from './crystal.js';
import magma from './magma.js';
import { buildRoute } from './route.js';
import { CageElevator } from './vehicle.js';
export default {
  id: 'shaft-nine', name: 'Shaft Nine', tagline: 'Down the mine. Past the lamps.', accent: '#ff9a3c',
  blurb: 'A cage elevator drops you shaft-deep from the surface yard through timbered tunnels, a flooded level and a glowing crystal cavern to the magma chamber at the bottom. The dead miners still wear their working lamps.',
  vehicleName: 'Cage Elevator', zombieName: 'Dead Miners', threat: 4,
  stops: [surface, tunnels, flooded, crystal, magma],
  async buildRoute(ctx) { const t = performance.now(); const r = await buildRoute(ctx); console.log(`[route] build ms ${(performance.now() - t).toFixed(0)}`); return r; },
  async buildVehicle(ctx) { const t = performance.now(); const v = new CageElevator(ctx.world, ctx); console.log(`[vehicle] build ms ${(performance.now() - t).toFixed(0)}`); return v; },
};
