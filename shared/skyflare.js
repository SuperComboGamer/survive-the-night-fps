// A flare gun's parachute flare (PROJ.SKYFLARE). The shot climbs along the aim like anything thrown; at the top of the
// climb (never sooner than SKYFLARE.openMin after the shot, so one fired flat still flies a way) it bursts alight and
// its chute opens, and it drifts back down on it, swinging, lighting the ground under it, until it burns out
// SKYFLARE.burn seconds after the shot - in the air if it was fired high, or on the ground for whatever is left of
// its burn if it came down first.
//
// The server flies it (Combat.updateProjectiles) and so does the shooter's client for its own (client/game/
// skyflares.js), each by its own clock and step. So where it is comes from the time since the shot alone (flarePos):
// the two put it in the same place whatever their step. Only what it comes down on is found by stepping along that
// path (flareStep), the same way for both.
import { raycastWorld } from './collision.js';
import { mulberry32 } from './rng.js';

export const SKYFLARE = {
  speed: 42, // m/s off the muzzle: straight up it tops out ~90 m above the gun
  grav: 9.8, // m/s^2 until the chute opens
  openMin: 1.0, // s: the chute opens at the top of the climb, and never sooner than this after the shot
  catch: 0.55, // s: how fast the open chute takes the flare from its flight to its drift (time constant)
  fall: 1.5, // m/s down under the open chute: from the top of a shot straight up it burns out ~8 m off the ground
  drift: 0.35, // m/s: the air it drifts in (each shot a way of its own)
  sway: 1.2, // m: how far it swings round under the chute
  swayT: 8, // s: one swing
  burn: 60, // s from the shot to burnout
  fade: 4, // s: it sputters out over the last of them
  reach: 40, // m: in the air, the ground this far out from under it is lit (what pins a Shade: Zombies.lightSources)
  groundReach: 16, // m: lying on the ground, burning (a road flare lights 14)
};

const FLOOR_STEP = 0.5; // m: how often along a step the ground under it is looked at
const _p = { x: 0, y: 0, z: 0 };

// A flare fired from (x,y,z) along the unit vector (dx,dy,dz); seed: the shot's (the way it drifts and swings)
export function launchFlare(x, y, z, dx, dy, dz, seed) {
  const S = SKYFLARE;
  const rnd = mulberry32((seed * 2654435761 + 0x5f1a) >>> 0);
  const da = rnd() * Math.PI * 2;
  const vy = dy * S.speed;
  return {
    x0: x,
    y0: y,
    z0: z,
    vx: dx * S.speed,
    vy,
    vz: dz * S.speed,
    tOpen: Math.max(S.openMin, vy / S.grav),
    dvx: Math.cos(da) * S.drift,
    dvz: Math.sin(da) * S.drift,
    ph: rnd() * Math.PI * 2,
    // where it is (flareStep), and whether it has come down
    t: 0,
    x,
    y,
    z,
    landed: false,
  };
}

// Where flare f is t seconds after the shot if nothing is in its way -> out {x, y, z}
export function flarePos(f, t, out) {
  const S = SKYFLARE;
  const tb = Math.min(t, f.tOpen);
  let x = f.x0 + f.vx * tb;
  let y = f.y0 + f.vy * tb - 0.5 * S.grav * tb * tb;
  let z = f.z0 + f.vz * tb;
  if (t > f.tOpen) {
    // the chute takes it from the velocity it had when it opened to the drift, exponentially
    const u = t - f.tOpen;
    const k = S.catch * (1 - Math.exp(-u / S.catch));
    x += f.dvx * u + (f.vx - f.dvx) * k;
    y += -S.fall * u + (f.vy - S.grav * f.tOpen + S.fall) * k;
    z += f.dvz * u + (f.vz - f.dvz) * k;
    // ...and it swings round under it, more as the chute fills
    const a = f.ph + (u / S.swayT) * Math.PI * 2;
    const r = S.sway * (1 - Math.exp(-u / 2));
    x += Math.cos(a) * r;
    z += Math.sin(a) * r;
  }
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

// Moves flare f on to t seconds after the shot (f.x, f.y, f.z), stopping it where it comes down on the world: a
// collider or the terrain, or whatever is walked on under it (world.floorAt). Once down it lies there (f.landed).
// ray: scratch for raycastWorld
export function flareStep(f, t, world, ray) {
  if (f.landed || t <= f.t) {
    f.t = Math.max(f.t, t);
    return f;
  }
  flarePos(f, t, _p);
  const ox = f.x;
  const oy = f.y;
  const oz = f.z;
  let dx = _p.x - ox;
  let dy = _p.y - oy;
  let dz = _p.z - oz;
  const len = Math.hypot(dx, dy, dz);
  f.t = t;
  if (len < 1e-6) return f;
  dx /= len;
  dy /= len;
  dz /= len;
  raycastWorld(world, ox, oy, oz, dx, dy, dz, len, ray);
  let hit = ray.t;
  const n = Math.max(1, Math.ceil(len / FLOOR_STEP));
  for (let i = 1; i <= n; i++) {
    const s = (i / n) * len;
    if (hit >= 0 && s > hit) break;
    if (oy + dy * s < world.floorAt(ox + dx * s, oz + dz * s, oy)) {
      hit = s;
      break;
    }
  }
  if (hit < 0) {
    f.x = _p.x;
    f.y = _p.y;
    f.z = _p.z;
    return f;
  }
  // down: just short of what it struck, and on the floor under that (one that struck a wall drops at its foot)
  const back = Math.max(0, hit - 0.08);
  f.x = ox + dx * back;
  f.z = oz + dz * back;
  f.y = world.floorAt(f.x, f.z, oy + dy * back + 0.3) + 0.04;
  f.landed = true;
  return f;
}

// How bright it burns t seconds after the shot, 0..1: a star while it climbs, bursting full as the chute opens,
// sputtering out over the last SKYFLARE.fade seconds
export function flareGlow(f, t) {
  const S = SKYFLARE;
  if (t >= S.burn || t < 0) return 0;
  const lit = t < f.tOpen ? 0.45 : Math.min(1, 0.45 + (t - f.tOpen) / 0.3);
  return lit * Math.min(1, (S.burn - t) / S.fade);
}

// How far from it (m) a flare at height h over the ground under it lights things t seconds after the shot (0: out,
// or too far gone to pin anything). In the air: out to SKYFLARE.reach across the ground under it.
export function flareReach(f, t, h) {
  if (flareGlow(f, t) < 0.35) return 0;
  return f.landed ? SKYFLARE.groundReach : Math.hypot(Math.max(0, h), SKYFLARE.reach);
}
