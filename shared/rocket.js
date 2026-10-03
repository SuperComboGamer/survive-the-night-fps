// An RPG grenade's flight (WEAPONS[ITEM.RPG].rocket), as the server flies it (Combat.updateProjectiles) and as the
// shooter's client draws its own (client/game/rockets.js). The two step it differently (a server tick, a frame), so
// what it strikes is judged here, the same way for both: a shot skimming the ground comes down where it really does.
import { raycastWorld } from './collision.js';

const FLOOR_STEP = 0.5; // m: how often along its path the ground under it is looked at

// How far along the segment from (ox,oy,oz) along (dx,dy,dz), `len` long, it strikes the world: a collider or the
// terrain (raycastWorld into `ray`), or whatever is walked on under it (world.floorAt), -1 if nothing
export function rocketStrikesWorld(world, ox, oy, oz, dx, dy, dz, len, ray) {
  raycastWorld(world, ox, oy, oz, dx, dy, dz, len, ray);
  const hit = ray.t >= 0 ? ray.t : len;
  const n = Math.max(1, Math.ceil(len / FLOOR_STEP));
  for (let i = 1; i <= n; i++) {
    const s = (i / n) * len;
    if (s > hit) break;
    if (oy + dy * s < world.floorAt(ox + dx * s, oz + dz * s, oy)) return s;
  }
  return ray.t;
}
