// Variant sets shipped with the zombie system. boot.js calls registerAll(zombies) after the map's own registration
// (map definition `zombies.variants` / `zombies.register`, or a src/maps/<id>/zombies.js module imported by the map).
import { REGISTRY, registerVariants } from '../factory.js';
import { SHAFT_NINE_VARIANTS } from './shaft-nine.js';
import { EXAMPLES_BY_MAP } from './examples.js';

export { SHAFT_NINE_VARIANTS, EXAMPLES_BY_MAP };
/** Register the built-in sets; maps that have no variants of their own get their example variant. Returns the map ids. */
export async function registerAll() {
  for (const [id, defs] of Object.entries(EXAMPLES_BY_MAP)) if (!(REGISTRY.maps.get(id) || []).length) registerVariants(id, defs);
  void SHAFT_NINE_VARIANTS; // (registered by its module)
  return [...REGISTRY.maps.keys()];
}
