// WHITEOUT: a ski resort at night in a blizzard. A gondola carries you over a dark valley: Base Village -> Mid-Mountain Station -> Summit Observatory.
import village from './village.js';
import station from './station.js';
import summit from './summit.js';
import { buildRoute } from './route.js';
import { Gondola } from './vehicle.js';
import './zombies.js';               // registers the seven Whiteout variants (patrol, tourist, instructor, guide, snowboarder, tourist_skier, frozen)

export default {
  id: 'whiteout', name: 'Whiteout', tagline: 'Ride up. Nothing rides back.', accent: '#8fd0ff',
  blurb: 'A ski resort at night in a blizzard. A gondola carries you over a dark valley from the base village to a mid-mountain station to a summit observatory — colder and stormier at every stop. The dead are ski patrol and tourists in frost-caked parkas.',
  vehicleName: 'Gondola', zombieName: 'Ski Patrol & Tourists', threat: 4,
  stops: [village, station, summit],
  buildRoute,
  async buildVehicle(ctx) {
    const v = new Gondola(ctx.world, ctx); ctx.group.add(v.trafficGroup);
    return v;
  },
};
