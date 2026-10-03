// AFTER HOURS — a retro-futuristic amusement park after closing. A monorail carries you over the park from the entrance plaza to a space-age land,
// a haunted castle and a pirate cove. Zombies are the park's guests and staff in the park's own mascot suits.
import plaza from './plaza.js';
import space from './space.js';
import castle from './castle.js';
import cove from './cove.js';
import { buildRoute } from './route.js';
import { Monorail } from './vehicle.js';
import { AFTER_HOURS_VARIANTS } from './zombies.js';   // registers the eight costumed variants with the zombie factory (registerVariants('after-hours', …))

// per-stop zombie flavour: ZombieManager.spawn opts.layers (multiplies/overrides the variant's own layers) — set on every stop spawn def so game.js can hand it through
const FLAVOUR = { plaza: { dust: 0.05 }, space: { dust: 0.18, wet: 0.1 }, castle: { dust: 0.25, wet: 0.2, blood: 0.7 }, cove: { wet: 0.55, dust: 0.12 } };
for (const st of [plaza, space, castle, cove]) { const b = st.build; if (b && !st._flav) { st._flav = true; st.build = async function (ctx) { const d = await b.call(this, ctx); if (d && d.spawns) for (const sp of d.spawns) sp.layers = { ...FLAVOUR[st.id], ...(sp.layers || {}) }; return d; }; } }

export default {
  id: 'after-hours', name: 'After Hours', tagline: 'The rides never stopped. Neither did the guests.', accent: '#ff4fa8',
  blurb: 'A 1960s space-age amusement park after closing time: half the neon dead, calliope music boxes still playing. A retro monorail hums you over the rides from the entrance plaza to the space-age land, the haunted castle and the pirate cove — and every land is crawling with guests and staff in the park\'s own mascot suits.',
  vehicleName: 'Monorail', zombieName: 'Guests & Mascots', threat: 3,
  stops: [plaza, space, castle, cove],
  async buildRoute(ctx) { return buildRoute(ctx); },
  async buildVehicle(ctx) { const v = new Monorail(ctx.world); await v.build(ctx.synth); return v; },
  zombies: { variants: AFTER_HOURS_VARIANTS },   // (definitions, not id strings: boot.js hands them to zombies.registerVariants(mapId, …))
};
