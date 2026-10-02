// The buildable generator and the floodlights it feeds (STRUCT.GENERATOR, STRUCT.FLOODLIGHT): the numbers, what a
// structure's state byte means for the two, and where a floodlight's cone is. Used by the server's rule
// (server/power.js), the client's lights and prompts (client/game/power.js) and scripts/test-power.js.
// First guesses, all of them: nobody has played a night under these lights yet.

// ---------------------------------------------------------------- the generator
export const GEN_RANGE = 16; // a running generator feeds every floodlight within this (m)
export const GEN_POUR = 25; // units of Flamethrower Fuel one [E] pours in...
export const GEN_FUEL_UNIT = 2.4; // ...and the seconds one unit runs it: 25 units a minute
export const GEN_TANK = 600; // seconds of fuel the tank holds
export const GEN_LOW = 60; // the survivors nearby are told when this much is left (s)
// The price of the light: a running generator is a noise, raised again every GEN_HUM_EVERY seconds for as long as it
// runs. It carries further than an MP5 (35 m) and less far than a pistol (45 m), and at that level the dead amble
// over rather than run (NOISE_RUSH in constants.js).
export const GEN_HUM = 40;
export const GEN_HUM_EVERY = 4;
export const GEN_HOLD = 0.45; // [E] held this long is the switch; let go sooner and it pours fuel (s, client side)
export const GEN_TOLD = 45; // survivors this close are told it is running low / has run dry (m)

// A generator's state byte (SF.STATE): bit 0 the switch, bits 1-7 the fuel in GEN_STEP seconds, rounded up. It runs
// while the switch is on and there is fuel; switched off, the fuel stays in the tank.
export const GEN_STEP = 5;
export const genState = (on, fuel) => (on ? 1 : 0) | (Math.min(127, Math.ceil(Math.max(0, fuel) / GEN_STEP)) << 1);
export const genOn = (state) => (state & 1) === 1;
export const genFuel = (state) => (state >> 1) * GEN_STEP;
export const genRunning = (state) => (state & 1) === 1 && state > 1;
// what one [E] takes out of a backpack holding `have` units, for a tank with `fuel` seconds in it: whole units,
// and only those the tank has room for (none is spilt)
export const genPour = (have, fuel) => Math.max(0, Math.min(GEN_POUR, have, Math.floor((GEN_TANK - fuel) / GEN_FUEL_UNIT + 1e-6)));

// ---------------------------------------------------------------- the floodlight
// Its state byte is 1 while a running generator is in range and 0 otherwise. Powered, it throws a cone from its
// lens the way it was turned when it was built (rot8, the structure's yaw: its front is -Z like every model's).
export const FLOOD_RANGE = 24; // length of the cone (m)
export const FLOOD_HALF = 0.61; // its half-angle (rad): about 70 degrees across
export const FLOOD_PITCH = -0.16; // the lamp is tipped down this much (rad), so the middle of the cone meets level ground ~13 m out
export const FLOOD_LENS_UP = 2.05; // the lens, from the foot of the stand: above...
export const FLOOD_LENS_FWD = 0.3; // ...and ahead (clear of the stand's own collider, which a ray to a Shade must not start in)
const FLOOD_TAN = Math.tan(FLOOD_HALF);

// out = { x, y, z, dx, dy, dz }: the lens and the cone's axis of a floodlight standing at (x, y, z)
export function floodAim(x, y, z, rot8, out) {
  const yaw = (rot8 / 256) * Math.PI * 2;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const cp = Math.cos(FLOOD_PITCH);
  out.x = x + fx * FLOOD_LENS_FWD;
  out.y = y + FLOOD_LENS_UP;
  out.z = z + fz * FLOOD_LENS_FWD;
  out.dx = fx * cp;
  out.dy = Math.sin(FLOOD_PITCH);
  out.dz = fz * cp;
  return out;
}

// Is the point inside the cone of `aim` (from floodAim)? pad: the half-width of what stands there, as the
// flashlight's beam allows for the width of a body.
export function inFloodCone(aim, px, py, pz, pad = 0) {
  const dx = px - aim.x;
  const dy = py - aim.y;
  const dz = pz - aim.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > FLOOD_RANGE * FLOOD_RANGE) return false;
  const along = dx * aim.dx + dy * aim.dy + dz * aim.dz;
  return along > 0 && Math.sqrt(Math.max(0, d2 - along * along)) <= along * FLOOD_TAN + pad;
}
