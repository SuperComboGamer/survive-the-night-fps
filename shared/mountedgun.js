// The mounted gun: a heavy machine gun on a tripod, behind the sandbags of the Army Checkpoint when a run begins,
// covering Route 9. One to a map that has the place. Standing on its tripod it is fixed: a survivor at the grips
// mans it, and then their fire button is its trigger and it swivels with their view, inside its arc. A survivor can
// also lift it, tripod and all (hold [E]), carry it off at half pace with nothing else in their hands, and set it
// up somewhere else ([E]): the way they face is the way it covers. Switching weapons on the way drops it where
// they stand, on its side, to be lifted again. Carrying it is in the player simulation (s.hmg: the pace, the hands
// it takes, the switch that drops it); the rest both ends need is here: where it stands, who is at the grips,
// where the gun points for a view, which commands fire it, and where a carrier would set it up.
import { BTN } from './constants.js';
import { AMMO } from './defs.js';
import { eyeHeight } from './playersim.js';
import { groundAt, raycastWorld, deepWaterAt } from './collision.js';
import { qpos, dqpos, qangle16, dqangle16 } from './protocol.js';

// The weapon id its shots and kills carry on the wire (EVT.SHOT, the killfeed): a number among the items that no
// item has. It is not an item: it never goes in a backpack or a weapon slot, and it cannot be given.
export const MOUNTED_GUN = 16;

const DEG = Math.PI / 180;
// Its numbers, a first pass. As a weapon it reads like a row of WEAPONS (Combat.fire takes it as one): against the
// AK-47 (36 a round, 0.02 rad, 150 m, 70 m of noise) a round hits a little harder and goes through one body into
// the next, the cone is a third as wide, and it is heard half as far again as any rifle.
export const GUN = {
  name: 'Mounted Gun',
  damage: 42,
  pellets: 1,
  spread: 0.006,
  range: 200,
  headMul: 2.6,
  pierce: 2,
  noise: 110,
  every: 6, // commands between two rounds: 600 a minute
  mag: 250, // the belt
  ammo: AMMO.R762,
  feed: 50, // rounds a second into the belt from the gunner's 7.62 while they hold [R] / [E]
  arc: 70 * DEG, // it swivels this far either side of where the nest faces...
  pitchMin: -15 * DEG, // ...and this far down and up
  pitchMax: 25 * DEG,
  reach: 1.2, // the gunner stands within this of the grips
  pivotY: 1.18, // the pintle, above the ground the tripod stands on
  back: 0.62, // the grips are this far behind it
  barrel: 1.2, // the muzzle this far ahead of it
  dryWait: 15, // commands between two clicks of an empty gun
  lift: 1.5, // seconds of [E] held to lift it off the ground, tripod and all
  setOut: 0.92, // a carrier sets it up this far ahead of where they stand: their feet a step behind the grips...
  setMin: 0.5, // ...or as little as this, up against what is in front of them
  clear: 0.2, // its centre at least this far from anything solid in front
  pickUp: 2, // metres from a gun lying on its side that it can be lifted from
};

// What it is doing (the entity's mode): standing on its tripod, in a survivor's arms, or lying where it was dropped
export const GUN_STANDS = 0;
export const GUN_CARRIED = 1;
export const GUN_LYING = 2;

// A nest as the wire carries it: the pintle at 1/64 m and the facing at 1/65536 of a turn. Every nest the gun
// stands in goes through here on the server, and the client reads it back off the entity, so both ends judge the
// grips, the arc and the muzzle from identical numbers.
export function snapNest(n) {
  n.y = dqpos(qpos(n.y + GUN.pivotY)) - GUN.pivotY;
  n.x = dqpos(qpos(n.x));
  n.z = dqpos(qpos(n.z));
  n.ry = dqangle16(qangle16(n.ry));
  return n;
}

// Where the gun of this map stands when a run begins: { x, y, z, ry } of the tripod (ry: the way the nest faces, as
// a view yaw), or null on a map without the checkpoint. The nest is a prop of the place (world.js), so nothing else
// has to say. Once somebody has carried it off, where it stands is the entity's to say (snapNest).
const nests = new WeakMap();
export function gunNest(world) {
  let n = nests.get(world);
  if (n === undefined) {
    const p = world.props.find((q) => q.type === 'mg_tripod');
    n = p ? snapNest({ x: p.x, y: p.y, z: p.z, ry: p.ry }) : null;
    nests.set(world, n);
  }
  return n;
}

// Is a survivor standing at (x, y, z) at the grips? Within `reach` of them, and not in front of the pintle.
export function atGrips(nest, x, y, z, reach = GUN.reach) {
  const bx = Math.sin(nest.ry); // behind the gun
  const bz = Math.cos(nest.ry);
  const dx = x - nest.x;
  const dz = z - nest.z;
  if (dx * bx + dz * bz < -0.15 || Math.abs(y - nest.y) > 1) return false;
  return Math.hypot(dx - bx * GUN.back, dz - bz * GUN.back) <= reach;
}

// Where the gun points for a gunner looking along (yaw, pitch): their view, held inside the arc. -> out.yaw, out.pitch
export function gunAim(nest, yaw, pitch, out) {
  let d = (yaw - nest.ry) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  out.yaw = nest.ry + (d < -GUN.arc ? -GUN.arc : d > GUN.arc ? GUN.arc : d);
  out.pitch = pitch < GUN.pitchMin ? GUN.pitchMin : pitch > GUN.pitchMax ? GUN.pitchMax : pitch;
  return out;
}

// the muzzle of a gun pointing along (yaw, pitch) -> out.x, out.y, out.z
export function gunMuzzle(nest, yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = nest.x - Math.sin(yaw) * cp * GUN.barrel;
  out.y = nest.y + GUN.pivotY + Math.sin(pitch) * GUN.barrel;
  out.z = nest.z - Math.cos(yaw) * cp * GUN.barrel;
  return out;
}

export const GUN_FIRED = 1;
export const GUN_DRY = 2;

// One command of the gunner's at the gun. g: { belt, wait, held } - the gun itself on the server, and on the
// gunner's client their own picture of it: both run this on the same commands, so the client shows a round leaving
// on the command the server fires it on, without waiting to be told. The trigger is BTN.GUN (the gunner's client
// sends that in place of BTN.ATTACK, so the simulation leaves the weapon in their hands alone).
// Returns GUN_FIRED, GUN_DRY (the click of an empty gun, on a fresh pull) or 0.
export function stepGun(g, buttons) {
  const pull = buttons & BTN.GUN ? 1 : 0;
  const fresh = pull && !g.held;
  g.held = pull;
  if (g.wait > 0) g.wait--;
  if (!pull || g.wait > 0) return 0;
  if (g.belt > 0) {
    g.belt--;
    g.wait = GUN.every;
    return GUN_FIRED;
  }
  if (!fresh) return 0;
  g.wait = GUN.dryWait;
  return GUN_DRY;
}

// The round a command fires, as Combat.fire and the gunner's client take a shot: from the gunner's eye (s: their
// state after the command) along the gun, so it strikes what their crosshair is on wherever at the grips they stand.
export function gunShot(nest, s, cmd, out) {
  gunAim(nest, cmd.yaw, cmd.pitch, out);
  out.weapon = MOUNTED_GUN;
  out.def = GUN;
  out.seed = (cmd.seq * 7919 + 0x6d67) & 0xffff;
  out.spread = GUN.spread;
  out.recoilPitch = 0;
  out.x = s.x;
  out.y = s.y + eyeHeight(s);
  out.z = s.z;
  return out;
}

// Where a carrier standing as s is would set the gun up: a step ahead of them along their view, facing the way they
// look, its feet on the ground they stand on - or nearer, up against whatever stands in front of them (a barricade,
// sandbags: what a gun is set up behind). -> out { x, y, z, ry } (snapped), or null when there is no room: a wall
// or anything else solid right in front of them, ground that falls away or climbs, deep water.
const _ray = { t: -1, col: null, terrain: false };
export function setUpSpot(world, s, out) {
  const fx = -Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  let d = GUN.setOut;
  // (the tripod's centre stays a hand clear of anything hit from the waist or from the height of the gun)
  for (const h of [0.6, GUN.pivotY]) {
    raycastWorld(world, s.x, s.y + h, s.z, fx, 0, fz, GUN.setOut + GUN.clear, _ray);
    if (_ray.t >= 0) d = Math.min(d, _ray.t - GUN.clear);
  }
  if (d < GUN.setMin) return null;
  const x = s.x + fx * d;
  const z = s.z + fz * d;
  const y = groundAt(world, x, z, s.y + 0.1, 0.3);
  if (Math.abs(y - s.y) > 0.4 || deepWaterAt(world, x, z, y, 0.3)) return null;
  out.x = x;
  out.y = y;
  out.z = z;
  out.ry = s.yaw;
  return snapNest(out);
}

// Can a survivor standing at (x, y, z) lift the gun standing in `nest` (from its grips, or from beside it) or lying
// at it (anywhere within reach)?
export function canLift(nest, lying, x, y, z, slack = 0) {
  if (Math.abs(y - nest.y) > 1.2) return false;
  if (lying) return Math.hypot(x - nest.x, z - nest.z) <= GUN.pickUp + slack;
  return atGrips(nest, x, y, z, GUN.reach + slack) || Math.hypot(x - nest.x, z - nest.z) <= 1.1 + slack;
}
