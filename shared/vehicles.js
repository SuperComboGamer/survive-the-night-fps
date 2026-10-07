// Ground transport: the moped, the car and the bicycle. The rules both ends share.
//
// A vehicle is one entity (ENT.VEHICLE, server/vehicles.js). It is found broken, standing where somebody left it
// (vehicleSpots), and is fixed with what the valley has: scrap, tape, batteries, gun parts (FIX). Fixed, it wants
// fuel - the Fuel every generator and the flamethrower burn (AMMO.FUEL) - except the bicycle, which wants legs.
//
// Driving is part of the player simulation, as a handcar is (handcar.js): while a survivor drives, the vehicle is
// in their simulated state - `drive` its entity id, `driveK` its kind, `dyaw` where it points, `dsteer` its
// steering, `dfuel` what is in the tank, and the survivor's own x / y / z and vx / vz are the vehicle's (the middle
// of it on the ground, and how it moves over it). Every command steps it (stepVehicle) with the same numbers on
// the client and on the server, so the driver's prediction is the server's result and nothing is sent while they
// drive; the server only speaks when something it alone knows of touched the vehicle (the dead in its way, a blow).
// Nobody at the wheel, the server steps it with the same function until it stands.
//   W / S        throttle; brake, and from a standstill reverse
//   A / D        steer: less lock the faster it goes
//   Space        handbrake: the back wheels lock, and the tail comes round
//   Shift        (bicycle) stand on the pedals, on stamina
// Passengers are carried: `pass` (the entity id) and `passN` (the seat) in their state stop their feet, and the
// server puts them in the seat every tick. Their hands are free.
import { BTN, WATER_LEVEL, STAMINA_DRAIN, STAMINA_REGEN, STAMINA_REGEN_DELAY, STAMINA_MAX, STAMINA_UNLOCK, EYE_HEIGHT, GRID_STEP } from './constants.js';
import { ITEM } from './defs.js';
import { ColliderGrid, makeBox, pushCircle, footprintContains, COL } from './collision.js';
import { ROAD } from './layout.js';
import { mulberry32 } from './rng.js';

export const VEH = { MOPED: 1, CAR: 2, BIKE: 3 };
// what state one is in (two bits on the wire)
export const VSTATE = {
  BROKEN: 0, // as found: it wants its parts (FIX)
  OK: 1, // it runs
  DEAD: 2, // broken down (hp 0): it rolls, the engine is out, until it is patched up (REPAIR)
  WRECK: 3, // burnt out: lost for good
};

const G = 9.8;

// top: m/s on asphalt with the throttle open. accel: m/s/s from a standstill. brake: m/s/s. rev: m/s backwards.
// wb: wheelbase. lock / lockTop: the most the front wheel turns, standing and at top speed (rad). steerRate: rad/s.
// grip: the sideways pull the tyres hold on asphalt (m/s/s); hb: what is left of it with the back wheels locked.
// roll / drag: rolling resistance (m/s/s) and air ((m/s)^-1 s^-1, on v^2). coast: what the engine holds it back by
// with the throttle shut (m/s/s). off: how much worse soft ground is for it
// (rolling resistance x this off the road; offTop: how much of the ground's cut in top speed it feels). step: what it rides up onto (m); h: how tall it is (for what it fits
// under). wade: the water that stops it (m). circles: its body against the world, [z along it (- is ahead), radius]
// (they overlap: nothing thin gets in between two of them).
// half / halfW / tall: its box (the collider it is while it stands empty, and what the dead and survivors are kept
// out of). tank: Fuel units; burn: per second with the throttle open (idle: a twentieth of it). hp. seats: where
// each sits [x (+ right), y (the hips over the ground), z (- ahead)], the driver first; eye: the eyes over the hips
// (eyeZ: and behind them, leant back in a seat).
// noise: how far the engine carries to the dead at full revs / ticking over (constants.js NOISE). throwAt: a crash
// faster than this (m/s into the thing) throws the rider. shell: its riders are behind doors and glass.
export const VEHICLES = {
  [VEH.MOPED]: {
    name: 'Moped', top: 16.5, accel: 5.4, brake: 9.5, rev: 1.6, wb: 1.2, lock: 0.62, lockTop: 0.085, steerRate: 2.6, grip: 9, hb: 0.42, roll: 0.35, coast: 1.2, drag: 0.004, off: 1, offTop: 0.75,
    step: 0.3, h: 1.5, wade: 0.4, circles: [[-0.5, 0.33], [-0.03, 0.31], [0.44, 0.33]], half: 0.9, halfW: 0.3, tall: 1.05,
    tank: 60, burn: 0.5, hp: 300, seats: [[0, 0.86, 0.3], [0, 0.885, 0.62]], eye: 0.62, noise: 55, idle: 28, throwAt: 6.5, shell: false, two: true,
  },
  [VEH.CAR]: {
    name: 'Car', top: 25, accel: 4.4, brake: 10.5, rev: 6, wb: 2.62, lock: 0.6, lockTop: 0.06, steerRate: 2.1, grip: 9.5, hb: 0.32, hbSpin: 2.6, roll: 0.3, coast: 1.1, drag: 0.0028, off: 2.6, offTop: 1,
    step: 0.26, h: 1.45, wade: 0.55, circles: [[-1.32, 0.88], [0, 0.9], [1.32, 0.88]], half: 2.2, halfW: 0.9, tall: 1.4,
    tank: 150, burn: 1.6, hp: 900, seats: [[-0.38, 0.42, -0.15], [0.38, 0.42, -0.15], [-0.38, 0.415, 0.66], [0.38, 0.415, 0.66]], eye: 0.78, eyeZ: 0.1, noise: 85, idle: 42, throwAt: 0, shell: true, two: false,
  },
  [VEH.BIKE]: {
    name: 'Bicycle', top: 10.5, hardTop: 13.5, accel: 3.8, hardAccel: 4.6, brake: 7, rev: 1.2, wb: 1.05, lock: 0.7, lockTop: 0.12, steerRate: 3, grip: 7.5, hb: 0.5, roll: 0.22, coast: 0, drag: 0.005, off: 1.2, offTop: 0.45,
    step: 0.22, h: 1.6, wade: 0.35, circles: [[-0.44, 0.29], [-0.02, 0.27], [0.4, 0.29]], half: 0.85, halfW: 0.25, tall: 1.0,
    tank: 0, burn: 0, hp: 150, seats: [[0, 0.99, 0.3]], eye: 0.58, noise: 0, idle: 0, throwAt: 6, shell: false, two: true, pedal: true,
  },
};
export const VEH_NAMES = { [VEH.MOPED]: 'moped', [VEH.CAR]: 'car', [VEH.BIKE]: 'bicycle' };

// What a vehicle found broken wants before it runs: [item, count] slots, each put in whole (a bit per slot on the wire).
export const FIX = {
  [VEH.MOPED]: [[ITEM.SCRAP, 4], [ITEM.TAPE, 1], [ITEM.BATTERY, 1]],
  [VEH.CAR]: [[ITEM.SCRAP, 8], [ITEM.TAPE, 2], [ITEM.BATTERY, 2], [ITEM.GUNPARTS, 1]],
  [VEH.BIKE]: [[ITEM.SCRAP, 2], [ITEM.TAPE, 1]],
};
export const fixMask = (kind) => (1 << FIX[kind].length) - 1;
// patching one up (damaged, or broken down): this for REPAIR_HP of its health back
export const REPAIR = { [ITEM.SCRAP]: 2, [ITEM.TAPE]: 1 };
export const REPAIR_HP = 0.35;
export const FIX_TIME = 2.5; // s of [E] held per part fitted...
export const STARTER_TIME = 4; // ...to get one of the bridgehead's going (it wants no part: FIX_FREE)
export const FIX_FREE = 7; // the slot of a fix that takes nothing but the time
export const REPAIR_TIME = 3; // ...per patch...
export const FUEL_TIME = 1.2; // ...and per pour
export const FUEL_POUR = 20; // Fuel a pour takes out of the reserve
export const SIPHON_TIME = 4; // s of [E] held at a wreck's filler cap
export const VEH_PICK = 1.5; // [E] is offered when the view ray passes this near the middle of one (the car: its box)
export const ENTER_REACH = 3.6; // ...this close (server: + slack)
// a wreck that still has something in its tank (by its prop type): what a siphon draws from it, least and most
export const SIPHON = { car_wreck: [8, 22], pickup_truck: [12, 28], car_open: [8, 22], van_wreck: [12, 30], box_truck: [16, 34], ambulance: [12, 26], school_bus: [14, 30], city_bus: [14, 30], army_truck: [18, 40], tractor: [8, 18], dump_truck: [16, 36], semi_truck: [20, 40], fire_truck: [16, 36] };
export const SIPHON_CHANCE = 0.4; // of them have any
// what the tank of the wreck (a prop) at its spot holds: 0 for most. The same on both ends: nothing is on the wire
export function siphonOf(prop) {
  const r = SIPHON[prop?.type];
  if (!r) return 0;
  const h = hashXZ(prop.x, prop.z);
  if (h >= SIPHON_CHANCE) return 0;
  return Math.round(r[0] + (r[1] - r[0]) * (h / SIPHON_CHANCE));
}
function hashXZ(x, z) {
  let h = (Math.imul(Math.round(x * 16), 374761393) + Math.imul(Math.round(z * 16), 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// what the driver's buttons mean
export const HORN = BTN.HORN;
const HANDS = BTN.ATTACK | BTN.ALT | BTN.RELOAD;
export const DRIVE_HANDS = HANDS; // both hands on the bars or the wheel: nothing in them works

// ---------------------------------------------------------------- the ground under the wheels
// [grip, rolling resistance, share of the top speed]
const SURF_ROAD = [1, 1, 1];
const SURF_DIRT = [0.8, 1.7, 0.86];
const SURF_TRAIL = [0.72, 2.2, 0.76];
const SURF_GRASS = [0.6, 3.2, 0.66];
const SURF_MUD = [0.4, 5.5, 0.42];
export const SURF_KIND = { ROAD: 0, DIRT: 1, TRAIL: 2, GRASS: 3, MUD: 4 };
const SURFS = [SURF_ROAD, SURF_DIRT, SURF_TRAIL, SURF_GRASS, SURF_MUD];
// what kind of ground (x, z) is at height y: asphalt, a dirt road or a yard, a trail, grass, the mud by the water
export function surfaceKind(world, x, z, y) {
  if (y < WATER_LEVEL + 0.3 && world.heightAt(x, z) < WATER_LEVEL + 0.3) return SURF_KIND.MUD;
  const rw = world.runway; // (the airfield's strip is as good as any road)
  if (rw && Math.abs(x - rw.x) < rw.half && z > rw.z0 && z < rw.z1) return SURF_KIND.ROAD;
  const k = world.roadKindAt(x, z);
  if (k === ROAD.ASPHALT) return world.roadDistAt(x, z) < 6.5 ? SURF_KIND.ROAD : SURF_KIND.GRASS;
  if (k === ROAD.DIRT || k === ROAD.RAIL) return SURF_KIND.DIRT;
  if (k === ROAD.TRAIL) return SURF_KIND.TRAIL;
  return SURF_KIND.GRASS;
}

// ---------------------------------------------------------------- what a vehicle does not fit through
// The doorways of every building (world.openings), as low walls across them: a moped is no wider than a survivor, and
// would otherwise be ridden into a kitchen. And the vehicles that stand empty (their boxes: the server and each
// client put them in and take them out as they are parked and driven off). One more collider grid of the world, made
// the first time it is asked for, so that everything that walks, shoots and looks (world.colliderGrids) minds a
// parked car without knowing of it.
export const COL_VEHICLE = 128; // a collider that is a parked vehicle (its id: the entity's)
export const COL_DOORWAY = 256; // ...or the sill a vehicle stops at (nothing else does: NOBLOCK | NOBULLET)
const grids = new WeakMap();
export function vehicleGrid(world) {
  let g = grids.get(world);
  if (g) return g;
  g = { parked: new ColliderGrid(world.half + 20, 8), doors: new ColliderGrid(world.half + 20, 8) };
  grids.set(world, g);
  world.colliderGrids.push(g.parked);
  for (const o of world.openings || []) {
    const c = makeBox(o.x, o.z, (o.y || 0) - 0.5, (o.y || 0) + (o.h || 2.2), (o.w || 1.3) + 0.5, 0.5, o.ry || 0, COL.NOBLOCK | COL.NOBULLET | COL_DOORWAY);
    // (an opening without a height of its own stands on the ground there)
    if (!o.y) {
      const h = world.heightAt(o.x, o.z);
      c.y0 = h - 0.5;
      c.y1 = h + 3;
    }
    g.doors.add(c);
  }
  // a walked-into room of the city (world.city.rooms) is shut to them whatever its front is: its floor is a box
  for (const r of world.city?.rooms || []) {
    const c = makeBox(r.x, r.z, r.y - 1, r.y + (r.h || 3), r.w - 0.2, r.d - 0.2, r.ry || 0, COL.NOBLOCK | COL.NOBULLET | COL_DOORWAY);
    g.doors.add(c);
  }
  return g;
}

// the box a vehicle of this kind is while it stands empty at (x, y, z) facing yaw
export function parkedCollider(kind, id, x, y, z, yaw) {
  const P = VEHICLES[kind];
  return makeBox(x, z, y, y + P.tall, P.halfW * 2, P.half * 2, yaw, COL.STATIC | COL_VEHICLE, id);
}

// ---------------------------------------------------------------- the step
// v: { vk (its kind), id, x, y, z, vx, vz, yaw, steer, fuel, run (the engine can run: not broken down) }
// thr: -1 / 0 / 1 (S / W). turn: -1 / 0 / 1 (A / D). hb: the handbrake. hard: (bicycle) standing on the pedals.
// events (may be null): { type: 'veh_crash', v (m/s into it), col (what it hit, or null: the edge of the map, water) },
// { type: 'veh_skid' }. Returns the speed it struck something at this step (0: nothing).
const _q = [];
const _push = { x: 0, z: 0, nx: 0, nz: 0 };
// The ground under a wheel at (x, z) of a vehicle standing at height y: the terrain, or the top of what it rides up
// onto - no higher than its own step (collision.js groundAt is a survivor's, who steps higher than a wheel does: a
// kerb a car cannot mount is a wall to it, not a floor).
const _gq = [];
function wheelGround(world, x, z, y, step) {
  let h = world.floorAt ? world.floorAt(x, z, y) : world.heightAt(x, z);
  const grids = world.colliderGrids;
  for (let g = 0; g < grids.length; g++) {
    const list = grids[g].query(x, z, 0.25, _gq);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.flags & (COL.NOBLOCK | COL.TREE | COL_VEHICLE)) continue;
      if (c.y1 > h && c.y1 <= y + step + 0.02 && footprintContains(c, x, z, 0.25)) h = c.y1;
    }
  }
  return h;
}
// is any of v's circles (a little shrunk) in something solid, as it stands?
function inSolid(v, P, world, grid) {
  const fx = -Math.sin(v.yaw);
  const fz = -Math.cos(v.yaw);
  for (let ci = 0; ci < P.circles.length; ci++) {
    const px = v.x - fx * P.circles[ci][0];
    const pz = v.z - fz * P.circles[ci][0];
    const r = P.circles[ci][1] - 0.04;
    for (let gi = 0; gi < 4; gi++) {
      const cg = gi === 0 ? world.staticGrid : gi === 1 ? world.structGrid : gi === 2 ? grid.parked : grid.doors;
      const list = cg.query(px, pz, r + 0.1, _q);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if ((gi < 3 && c.flags & COL.NOBLOCK) || (gi === 2 && c.id === v.id) || c.y1 <= v.y + P.step || c.y0 >= v.y + P.h) continue;
        if (pushCircle(c, px, pz, r, _push)) return true;
      }
    }
  }
  return false;
}
export function stepVehicle(v, thr, turn, hb, hard, world, dt, events) {
  const P = VEHICLES[v.vk];
  const grid = vehicleGrid(world);
  const yaw0 = v.yaw;
  let sy = Math.sin(v.yaw);
  let cy = Math.cos(v.yaw);
  let vf = -v.vx * sy - v.vz * cy;
  const surf = SURFS[surfaceKind(world, v.x, v.z, v.y)];
  const wade = v.y < WATER_LEVEL && world.heightAt(v.x, v.z) < WATER_LEVEL ? WATER_LEVEL - v.y : 0;
  // ---- steering: less lock the faster it goes, and the wheel takes a moment to come round
  const sp = Math.abs(vf);
  const k = Math.min(1, sp / P.top);
  const lock = P.lock + (P.lockTop - P.lock) * Math.sqrt(k);
  const want = turn * lock;
  const ds = want - v.steer;
  const rate = P.steerRate * (turn === 0 || want * v.steer < 0 ? 1.8 : 1) * dt; // (it centres itself quicker than it is turned)
  v.steer += ds > rate ? rate : ds < -rate ? -rate : ds;
  // (a right turn takes the yaw down: forward is (-sin yaw, -cos yaw))
  // (the handbrake locks the back wheels: the tail lets go and comes round, faster than the front alone would turn it)
  // (by all of its speed, not only what is still along it: sliding sideways it keeps coming round)
  const vAll = hb && P.hbSpin ? Math.hypot(v.vx, v.vz) : 0;
  const spin = vAll > 3 ? (vf >= -0.5 ? 1 : -1) * vAll * P.hbSpin : vf;
  v.yaw -= (spin / P.wb) * Math.tan(v.steer) * dt;
  if (v.yaw > Math.PI) v.yaw -= Math.PI * 2;
  else if (v.yaw < -Math.PI) v.yaw += Math.PI * 2;
  sy = Math.sin(v.yaw);
  cy = Math.cos(v.yaw);
  const fx = -sy;
  const fz = -cy;
  // (to its right: (cos yaw, -sin yaw))
  vf = v.vx * fx + v.vz * fz;
  let vl = v.vx * cy - v.vz * sy;
  // ---- the tyres hold it sideways as far as the ground lets them; past that it slides
  const hold = P.grip * surf[0] * (hb ? P.hb : 1) * dt;
  if (vl > hold) {
    vl -= hold;
    if (events && vl > 2.2) events.push({ type: 'veh_skid' });
  } else if (vl < -hold) {
    vl += hold;
    if (events && vl < -2.2) events.push({ type: 'veh_skid' });
  } else vl = 0;
  // ---- along it: the engine (or the legs), the brakes, the hill, what the ground and the air take
  const engine = P.pedal ? true : v.run && v.fuel > 0;
  const off = 1 + (surf[1] - 1) * P.off * 0.4; // (soft ground: how much harder it rolls)
  let top = (hard && P.hardTop ? P.hardTop : P.top) * (1 - (1 - surf[2]) * P.offTop);
  if (wade > 0) top *= Math.max(0.15, 1 - wade / P.wade);
  let a = 0;
  let load = 0; // how hard the engine works, 0..1 (what it burns)
  if (thr > 0 && engine) {
    if (vf < -0.3) a = P.brake * 0.7;
    else {
      const r = vf / top;
      a = (hard && P.hardAccel ? P.hardAccel : P.accel) * (r < 1 ? 1 - r * r : (1 - r) * 3);
      load = 1;
    }
  } else if (thr < 0) {
    if (vf > 0.3) a = -P.brake;
    else if (engine) {
      const r = vf / -P.rev;
      a = -P.accel * 0.6 * (r < 1 ? 1 - r * r : (1 - r) * 3);
      load = 0.4;
    }
  }
  // (what the tyres can put down)
  const trac = P.grip * surf[0] * 1.15;
  if (a > trac) a = trac;
  else if (a < -trac) a = -trac;
  // the hill, by the ground under the two axles
  const hl = P.wb * 0.5;
  const gF = wheelGround(world, v.x + fx * hl, v.z + fz * hl, v.y, P.step);
  const gB = wheelGround(world, v.x - fx * hl, v.z - fz * hl, v.y, P.step);
  let slope = (gF - gB) / P.wb;
  if (slope > 0.7) slope = 0.7;
  else if (slope < -0.7) slope = -0.7;
  const grade = -G * slope * 0.85;
  const resist = P.roll * off + P.drag * vf * vf + wade * 9 + (hb ? P.brake * 0.75 : 0) + (thr === 0 ? P.coast : 0);
  if (vf === 0 && thr === 0 && Math.abs(grade) < resist + 1.2) {
    // standing, and it stays standing
  } else {
    vf += (a + grade) * dt;
    const slow = resist * dt;
    // (the brakes and the ground stop it: they do not send it backwards)
    if (thr === 0 || hb) vf = vf > slow ? vf - slow : vf < -slow ? vf + slow : 0;
    else vf -= vf > 0 ? Math.min(vf, slow) : Math.max(vf, -slow);
    if (thr === 0 && Math.abs(vf) < 0.12 && Math.abs(grade) < resist + 1.2) vf = 0;
  }
  if (!P.pedal && v.run && v.fuel > 0) {
    v.fuel -= P.burn * (0.05 + 0.95 * load * (0.35 + 0.65 * Math.min(1, Math.abs(vf) / top))) * dt;
    if (v.fuel < 0) v.fuel = 0;
  }
  v.vx = fx * vf + cy * vl;
  v.vz = fz * vf - sy * vl;
  // ---- move, and whatever is solid stops it
  const ox = v.x;
  const oz = v.z;
  const oyaw = yaw0;
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  let impact = 0;
  let struck = null;
  const lim = world.half - 5;
  let wedged = false;
  let turned = 0; // how far what it struck has turned it
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (let ci = 0; ci < P.circles.length; ci++) {
      const o = P.circles[ci][0];
      const r = P.circles[ci][1];
      // (z along it: - is ahead, so the point is the middle less the forward vector times -o)
      let px = v.x - fx * o;
      let pz = v.z - fz * o;
      for (let gi = 0; gi < 4; gi++) {
        const cg = gi === 0 ? world.staticGrid : gi === 1 ? world.structGrid : gi === 2 ? grid.parked : grid.doors;
        const list = cg.query(px, pz, r + 0.1, _q);
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (gi < 3 ? c.flags & COL.NOBLOCK : 0) continue;
          if (gi === 2 && c.id === v.id) continue; // (its own box, not yet taken out)
          if (c.y1 <= v.y + P.step || c.y0 >= v.y + P.h) continue;
          if (!pushCircle(c, px, pz, r, _push)) continue;
          const dx = _push.x - px;
          const dz = _push.z - pz;
          v.x += dx;
          v.z += dz;
          px = _push.x;
          pz = _push.z;
          moved = true;
          const vn = v.vx * _push.nx + v.vz * _push.nz;
          if (vn < 0) {
            if (-vn > impact) {
              impact = -vn;
              struck = c;
            }
            // (it keeps what it had along the wall, less what scraping it costs)
            v.vx = (v.vx - _push.nx * vn) * 0.94;
            v.vz = (v.vz - _push.nz * vn) * 0.94;
          }
          // pushed at one end, it comes round: the nose shoved to its right turns it right
          const side = dx * cy - dz * sy;
          turned += ((side * o) / (P.half * P.half)) * 0.6;
        }
      }
      // the edge of the map
      if (px < -lim || px > lim || pz < -lim || pz > lim) {
        const nx = px < -lim ? 1 : px > lim ? -1 : 0;
        const nz = pz < -lim ? 1 : pz > lim ? -1 : 0;
        v.x += nx ? nx * (Math.abs(px) - lim) : 0;
        v.z += nz ? nz * (Math.abs(pz) - lim) : 0;
        const vn = v.vx * nx + v.vz * nz;
        if (vn < 0) {
          if (-vn > impact) {
            impact = -vn;
            struck = null;
          }
          v.vx -= nx * vn;
          v.vz -= nz * vn;
        }
        moved = true;
      }
    }
    if (!moved) break;
    wedged = iter === 3;
  }
  // still in something after all that: it is between two things that each push it into the other, and stays where it
  // was, as it was. (Sliding along one thing into the corner of another settles in a pass or two and is let be.)
  if (wedged && inSolid(v, P, world, grid)) {
    const sp2 = Math.hypot(v.vx, v.vz);
    if (sp2 > impact) impact = sp2;
    v.x = ox;
    v.z = oz;
    v.yaw = oyaw;
    v.vx = v.vz = 0;
  } else if (turned !== 0) {
    // pushed at one end, it comes round - unless coming round would put the other end into something
    const y1 = v.yaw;
    v.yaw += turned > 0.2 ? 0.2 : turned < -0.2 ? -0.2 : turned;
    if (v.yaw > Math.PI) v.yaw -= Math.PI * 2;
    else if (v.yaw < -Math.PI) v.yaw += Math.PI * 2;
    if (inSolid(v, P, world, grid)) v.yaw = y1;
  }
  // water too deep for it, and the mouth of the mine: it does not go in
  let y = wheelGround(world, v.x, v.z, v.y, P.step);
  const deep = y < WATER_LEVEL - P.wade && world.heightAt(v.x, v.z) < WATER_LEVEL - P.wade;
  if (deep || (world.mine && world.mine.inHole(v.x, v.z))) {
    const sp2 = Math.hypot(v.vx, v.vz);
    if (sp2 > impact) {
      impact = sp2 * (deep ? 0.35 : 1);
      struck = null;
    }
    v.x = ox;
    v.z = oz;
    v.vx = v.vz = 0;
    y = wheelGround(world, v.x, v.z, v.y, P.step);
  }
  v.y = y;
  if (impact > 2.2 && events) events.push({ type: 'veh_crash', id: v.id, v: impact, col: struck });
  return impact;
}

// ---------------------------------------------------------------- in the player simulation
// The start of a command for a survivor at the wheel (s.drive). Returns true while the vehicle still has them,
// having moved it on with them; false once they are off it as of this command (thrown by a crash, pulled off, down).
// A 'veh_off' event says where it was left: { x, y, z, yaw, vx, vz, steer, fuel, id }.
const _v = { vk: 0, id: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, steer: 0, fuel: 0, run: true };
const PEDAL_COST = 0.6; // standing on the pedals costs this share of what a sprint does: a bicycle never tires its rider faster than running would
export const CROWD_SLOW = 3.2; // m/s: slower than this a vehicle pushes at the dead in its way (faster, it knocks them down)
// (what is left of its speed after a command with 1, 2, 3 or more of them on its nose: 0.75, 0.5, 0.3 a server tick)
const CROWD_KEEP = [1, Math.cbrt(0.75), Math.cbrt(0.5), Math.cbrt(0.3)];
export function driveStep(s, b, world, events, dt) {
  const P = VEHICLES[s.driveK];
  if (!P || s.zombie || s.downed || s.pulled || s.pinned) return leave(s, events, 0, 0);
  _v.vk = s.driveK;
  _v.id = s.drive;
  _v.x = s.x;
  _v.y = s.y;
  _v.z = s.z;
  _v.vx = s.vx;
  _v.vz = s.vz;
  _v.yaw = s.dyaw;
  _v.steer = s.dsteer;
  _v.fuel = s.dfuel;
  _v.run = !s.ddead;
  const thr = (b & BTN.FWD ? 1 : 0) - (b & BTN.BACK ? 1 : 0);
  const turn = (b & BTN.RIGHT ? 1 : 0) - (b & BTN.LEFT ? 1 : 0);
  let hard = false;
  if (P.pedal) {
    // standing on the pedals costs what sprinting does; easing along, the breath comes back
    if (thr > 0 && b & BTN.SPRINT && !s.exhausted && s.stamina > 0) {
      hard = true;
      s.stamina -= STAMINA_DRAIN * PEDAL_COST * dt;
      s.staminaDelay = STAMINA_REGEN_DELAY;
      if (s.stamina <= 0) {
        s.stamina = 0;
        s.exhausted = 1;
        if (events) events.push({ type: 'exhausted' });
      }
    }
  }
  if (!hard) {
    if (s.staminaDelay > 0) s.staminaDelay -= dt;
    else s.stamina = Math.min(STAMINA_MAX, s.stamina + STAMINA_REGEN * dt);
    if (s.exhausted && s.stamina >= STAMINA_UNLOCK) s.exhausted = 0;
  }
  const impact = stepVehicle(_v, thr, turn, !!(b & BTN.JUMP), hard, world, dt, events);
  // a crowd of the dead against its nose holds it (s.dhold: how many, by the server's count - Vehicles.strike): going
  // slowly it loses this share of its speed each command, in the driver's own prediction as on the server
  if (s.dhold && _v.vx * _v.vx + _v.vz * _v.vz < CROWD_SLOW * CROWD_SLOW) {
    const k = CROWD_KEEP[s.dhold > 3 ? 3 : s.dhold];
    _v.vx *= k;
    _v.vz *= k;
  }
  s.x = _v.x;
  s.y = _v.y;
  s.z = _v.z;
  s.vx = _v.vx;
  s.vz = _v.vz;
  s.vy = 0;
  s.dyaw = _v.yaw;
  s.dsteer = _v.steer;
  s.dfuel = _v.fuel;
  s.onGround = 1;
  s.crouch = 0;
  s.sprinting = 0;
  // on two wheels a hard enough crash throws the rider on over the bars
  if (P.throwAt && impact > P.throwAt) return leave(s, events, impact, 1);
  return true;
}
// off it, as of now. thrown: over the bars, with some of the speed it struck at
function leave(s, events, impact, thrown) {
  s.dhold = 0;
  if (events) events.push({ type: 'veh_off', id: s.drive, x: s.x, y: s.y, z: s.z, yaw: s.dyaw, vx: thrown ? 0 : s.vx, vz: thrown ? 0 : s.vz, steer: s.dsteer, fuel: s.dfuel, thrown, v: impact });
  if (thrown) {
    const k = Math.min(7, impact * 0.55);
    s.vx = -Math.sin(s.dyaw) * k;
    s.vz = -Math.cos(s.dyaw) * k;
    s.vy = 3.4;
    s.y += 0.5;
    s.stunT = 0.7;
  } else {
    s.vx = s.vz = 0;
  }
  s.drive = 0;
  s.driveK = 0;
  s.onGround = 0;
  return false;
}

// ---------------------------------------------------------------- seats
// Where seat k of a vehicle of this kind at (x, y, z) facing yaw is: out { x, y (the hips), z }
export function seatAt(kind, k, x, y, z, yaw, out) {
  const st = VEHICLES[kind].seats[k] || VEHICLES[kind].seats[0];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.x = x + st[0] * c + st[2] * s;
  out.y = y + st[1];
  out.z = z - st[0] * s + st[2] * c;
  return out;
}
// the feet a body in that seat is given (a standing body's eyes are EYE_HEIGHT over them): so that its eyes are the
// seat's, which is where its shots leave from
export const seatFeet = (kind, hipY) => hipY + VEHICLES[kind].eye - EYE_HEIGHT;

// ---------------------------------------------------------------- where they stand when a run begins
// Only the mainland has any (the island is walked: its one car is the quest's, and is not driven there). How many
// of each stand about it: [mopeds, cars, bicycles], besides the car the team crossed in (questCar) and the ones left
// near the bridgehead for a team too big for that car (starterSpots).
export const VEH_COUNT = [7, 5, 6];

// The broken vehicles of a world: [{ kind, x, y, z, yaw, tint }], the same for a seed on every build that makes the
// same world of it. Nothing of world generation knows of them: they are put where there is room - a moped and a
// bicycle against the wall of a building, a car beside a road at the edge of a place - clear of everything solid, of
// doorways, of what is searched and of the water.
const spotsOf = new WeakMap();
const _c = [];
// what stands near the bridgehead, in the order it is put out as the team grows: with the car the team crossed in
// (four seats) the first moped seats six, the car after it ten, and so on to sixteen and a spare
export const STARTERS = [VEH.MOPED, VEH.CAR, VEH.MOPED, VEH.CAR, VEH.BIKE, VEH.CAR];
export const STARTER_REACH = 95; // m from where the team is put down: none of them stands further off
export const vehicleSpots = (world) => plan(world).rest;
export const starterSpots = (world) => plan(world).starters;
function plan(world) {
  let res = spotsOf.get(world);
  if (res) return res;
  const out = [];
  res = { starters: [], rest: out };
  spotsOf.set(world, res);
  if (world.kind !== 2) return res; // (the island has none)
  let rng = mulberry32((world.seed ^ 0x57a47e4) >>> 0);
  const [nM, nC, nB] = VEH_COUNT;
  const start = world.start || world.car;
  const zones = world.zones.filter((z) => Math.hypot(z.x - start.x, z.z - start.z) > 30);
  const byNear = [...zones].sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z));
  // is the box of a vehicle of this kind free at (x, z) facing yaw, on ground it could stand on?
  const free = (kind, x, z, yaw, pad) => {
    const P = VEHICLES[kind];
    const lim = world.half - 14;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    const h = world.heightAt(x, z);
    if (h < WATER_LEVEL + 0.7) return false;
    if (world.mine && (world.mine.inHole(x, z) || world.mine.sdf(x, z) < 1)) return false;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (const d of [-P.half, P.half]) if (Math.abs(world.heightAt(x + fx * d, z + fz * d) - h) > 0.22 * (P.half / 0.9)) return false;
    if (Math.abs(world.heightAt(x + fz * 1, z - fx * 1) - world.heightAt(x - fz * 1, z + fx * 1)) > 0.3) return false;
    const box = makeBox(x, z, h - 1, h + 3, (P.halfW + pad) * 2, (P.half + pad) * 2, yaw);
    for (const c of world.staticGrid.query(x, z, box.r + 0.2, _c)) {
      if (c.flags & COL.NOBLOCK || c.y1 < h - 0.4 || c.y0 > h + 2.5) continue;
      if (boxesMeet(box, c)) return false;
    }
    for (const o of world.openings) if (Math.hypot(o.x - x, o.z - z) < P.half + 1.6) return false;
    for (const c of world.containers) if (Math.hypot(c.x - x, c.z - z) < P.half + 1) return false;
    for (const c of world.lootSpawns) if (Math.hypot(c.x - x, c.z - z) < P.halfW + 0.8) return false;
    for (const c of world.partSpots) if (Math.hypot(c.x - x, c.z - z) < P.half + 1) return false;
    for (const r of world.roofs) if (inRoof(r, x, z, 0.2)) return false;
    for (const s of out) if (Math.hypot(s.x - x, s.z - z) < 6) return false;
    return true;
  };
  // beside the wall of a building of the place: along one of its roof's sides, a little way out from it
  const byWall = (zone, kind) => {
    const P = VEHICLES[kind];
    const roofs = world.roofs.filter((r) => Math.hypot(r.x - zone.x, r.z - zone.z) < zone.flat + 6 && r.hx > 1.5 && r.hz > 1.5);
    for (let tries = 0; tries < 40 && roofs.length; tries++) {
      const r = roofs[Math.floor(rng() * roofs.length)];
      const side = Math.floor(rng() * 4);
      const along = (rng() - 0.5) * 2 * ((side < 2 ? r.hz : r.hx) - 0.6);
      const outBy = P.halfW + 0.75 + rng() * 0.25;
      const lx = side === 0 ? r.hx + outBy : side === 1 ? -r.hx - outBy : along;
      const lz = side === 2 ? r.hz + outBy : side === 3 ? -r.hz - outBy : along;
      const x = r.x + lx * r.c + lz * r.s;
      const z = r.z - lx * r.s + lz * r.c;
      // (lying along the wall, either way round)
      const yaw = Math.atan2(r.s, r.c) + (side < 2 ? 0 : Math.PI / 2) + (rng() < 0.5 ? Math.PI : 0);
      if (free(kind, x, z, yaw, 0.25)) return { x, z, yaw };
    }
    return null;
  };
  // beside a road at the place: off its edge, along it
  const byRoad = (zone, kind) => {
    for (let tries = 0; tries < 60; tries++) {
      const a = rng() * Math.PI * 2;
      const d = zone.flat * (0.35 + rng() * 0.85);
      const x = zone.x + Math.sin(a) * d;
      const z = zone.z + Math.cos(a) * d;
      const rd = world.roadDistAt(x, z);
      const kindAt = world.roadKindAt(x, z);
      if (!kindAt || kindAt === ROAD.RAIL || kindAt === ROAD.TRAIL || rd < 3.2 || rd > 7.5) continue;
      // along the road: the way its distance does not change
      const e = GRID_STEP;
      const gx = world.roadDistAt(x + e, z) - world.roadDistAt(x - e, z);
      const gz = world.roadDistAt(x, z + e) - world.roadDistAt(x, z - e);
      if (Math.hypot(gx, gz) < 0.2) continue;
      const yaw = Math.atan2(gz, -gx) + (rng() < 0.5 ? Math.PI : 0) + (rng() - 0.5) * 0.3;
      if (free(kind, x, z, yaw, 0.5)) return { x, z, yaw };
    }
    return null;
  };
  // anywhere in the open at the place
  const inYard = (zone, kind) => {
    for (let tries = 0; tries < 60; tries++) {
      const a = rng() * Math.PI * 2;
      const d = zone.flat * (0.2 + rng() * 0.8);
      const x = zone.x + Math.sin(a) * d;
      const z = zone.z + Math.cos(a) * d;
      const yaw = rng() * Math.PI * 2 - Math.PI;
      if (free(kind, x, z, yaw, 0.6)) return { x, z, yaw };
    }
    return null;
  };
  // ---- near the bridgehead, for a team the car it came in does not seat: guaranteed, whatever the seed. Beside
  // Route 9 where the team is put down, nearest first; failing a spot by the road, anywhere there is room
  for (let n = 0; n < STARTERS.length; n++) {
    const kind = STARTERS[n];
    let at = null;
    for (let tries = 0; tries < 400 && !at; tries++) {
      const reach = Math.min(STARTER_REACH, 22 + n * 9 + tries * 0.25);
      const a = rng() * Math.PI * 2;
      const d = 9 + rng() * (reach - 9);
      const x = start.x + Math.sin(a) * d;
      const z = start.z + Math.cos(a) * d;
      const rd = world.roadDistAt(x, z);
      if (tries < 300 && (rd < 4.2 || rd > 9)) continue; // (off the roadway, on its verge)
      if (rd < 4.2) continue;
      const e = GRID_STEP;
      const gx = world.roadDistAt(x + e, z) - world.roadDistAt(x - e, z);
      const gz = world.roadDistAt(x, z + e) - world.roadDistAt(x, z - e);
      const yaw = Math.hypot(gx, gz) > 0.2 ? Math.atan2(gz, -gx) + (rng() < 0.5 ? Math.PI : 0) : rng() * Math.PI * 2;
      if (free(kind, x, z, yaw, 0.5)) at = { x, z, yaw };
    }
    if (!at) continue;
    const s = { kind, x: at.x, y: world.heightAt(at.x, at.z), z: at.z, yaw: wrap(at.yaw), tint: n % 6, zone: 0, starter: n + 1 };
    res.starters.push(s);
    out.push(s); // (the rest keep clear of them)
  }
  const nStart = out.length;
  rng = mulberry32((world.seed ^ 0x7e41c1e) >>> 0);
  const used = new Map(); // zone -> how many stand there
  const put = (kind, pool, how) => {
    for (let tries = 0; tries < pool.length * 2; tries++) {
      const zone = pool[tries < pool.length ? tries : Math.floor(rng() * pool.length)];
      if ((used.get(zone) || 0) >= (zone.flat > 100 ? 6 : 1) && tries < pool.length) continue;
      let at = null;
      for (const fn of how) if ((at = fn(zone, kind))) break;
      if (!at) continue;
      used.set(zone, (used.get(zone) || 0) + 1);
      const y = world.heightAt(at.x, at.z);
      out.push({ kind, x: at.x, y, z: at.z, yaw: wrap(at.yaw), tint: Math.floor(rng() * 6), zone: zone.id });
      return true;
    }
    return false;
  };
  const shuffled = () => {
    const a = [...zones];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // the first bicycle and the first moped are a short walk from where the run begins; the rest are anywhere
  if (nB) put(VEH.BIKE, byNear.slice(0, 2), [byWall, inYard]);
  if (nM) put(VEH.MOPED, byNear.slice(0, 4), [byWall, inYard]);
  for (let i = 1; i < nM; i++) put(VEH.MOPED, shuffled(), [byWall, inYard]);
  for (let i = 0; i < nC; i++) put(VEH.CAR, shuffled(), [byRoad, inYard]);
  for (let i = 1; i < nB; i++) put(VEH.BIKE, shuffled(), [byWall, inYard]);
  out.splice(0, nStart);
  return res;
}
const wrap = (a) => {
  a %= Math.PI * 2;
  return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a;
};
function inRoof(r, x, z, pad) {
  const dx = x - r.x;
  const dz = z - r.z;
  const lx = dx * r.c - dz * r.s;
  const lz = dx * r.s + dz * r.c;
  return Math.abs(lx) < r.hx + pad && Math.abs(lz) < r.hz + pad;
}
// two colliders' footprints overlap (a box against a box or a cylinder: separating axes, the cylinder as its square)
function boxesMeet(a, b) {
  const ax = [[a.c, -a.s], [a.s, a.c]];
  const bx = b.type === 0 ? [[b.c, -b.s], [b.s, b.c]] : [[1, 0], [0, 1]];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const u of [...ax, ...bx]) {
    const ra = a.hx * Math.abs(ax[0][0] * u[0] + ax[0][1] * u[1]) + a.hz * Math.abs(ax[1][0] * u[0] + ax[1][1] * u[1]);
    const rb = b.hx * Math.abs(bx[0][0] * u[0] + bx[0][1] * u[1]) + b.hz * Math.abs(bx[1][0] * u[0] + bx[1][1] * u[1]);
    if (Math.abs(dx * u[0] + dz * u[1]) > ra + rb) return false;
  }
  return true;
}

// ---------------------------------------------------------------- the car the team crossed in
// On the mainland the quest car stands where the crossing left it (the `car` prop flagged live): there it is the
// team's car, a vehicle like any other. Its prop's collider is taken out of the world's static grid (both ends, as
// they make the world: after the world's fingerprint is taken), since the vehicle has a box of its own.
// -> { x, y, z, yaw } or null on a map without one.
const questOf = new WeakMap();
export function questCar(world) {
  if (questOf.has(world)) return questOf.get(world);
  let at = null;
  const prop = world.kind === 2 ? world.props.find((p) => p.type === 'car' && p.live) : null;
  if (prop) {
    at = { x: prop.x, y: prop.y, z: prop.z, yaw: wrap(prop.ry) };
    const seen = new Set();
    for (const c of world.staticGrid.query(prop.x, prop.z, 4, [])) {
      if (seen.has(c) || !(c.tag === prop || (c.tag && c.tag.type === 'car' && Math.hypot(c.x - prop.x, c.z - prop.z) < 3))) continue;
      seen.add(c);
    }
    for (const c of seen) world.staticGrid.remove(c);
    at.cols = seen.size;
  }
  questOf.set(world, at);
  return at;
}
export const QUEST_FUEL = 0.4; // what is left in its tank after the crossing (of a tank)
export const QUEST_HP = 0.7; // ...and of the car
