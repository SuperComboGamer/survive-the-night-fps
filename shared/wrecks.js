// Wrecks taken apart. A wreck that is hit keeps a short record of the blows it took - where, from which way, with
// what (EVT.WRECK) - beside how much salvage is left in it (Game.gather). The server holds the record and sends it
// to everybody, and to whoever joins later; each client works out the same car from it (client/render/wrecks.js:
// the dents, the glass, what hangs off and what lies beside it), so nobody has to be told which door is ajar. It is
// forgotten at dawn with the rest of what a day used up (EVT.REGROWN): the valley's wrecks are whole again, as its
// trees stand again.
import { COL } from './collision.js';
import { qpos, dqpos } from './protocol.js';
import { BLOW } from './surfaces.js';
import { planOf } from './props.js';

export const WRECK_SALVAGE = 5; // hits a wreck gives scrap for in a day (Game.gatherHit)
export const WRECK_HITS_MAX = 12; // blows a wreck remembers: later ones still rock it and spark, and leave it as it is
// a hit as it is kept and sent: [qx, qy, qz, yaw8, pitch8, bits] - where it landed (quantized as positions are), the
// way the blow went (the game's yaw, 0..255; pitch -127..127 for -90..90 degrees), and bits: the BLOW in the low
// three, HEAVY (the slow swing), TOOK (it took one of the wreck's WRECK_SALVAGE)
export const HITF = { BLOW: 7, HEAVY: 8, TOOK: 16 };
export const WRECKF = { REPLAY: 1 }; // EVT.WRECK flags: the whole of what is on record, for a client that was not there

// The alarm. Some wrecks still have a battery with a little life in it. A hard blow on one of those makes it chirp
// and blink - the warning: from then on every hard blow may set it off. A knife is too light to do either. Ringing,
// it calls the dead the way any noise does (Zombies.noise, every `pulse` seconds) until it runs down, or until a
// blow on the bonnet end kills the battery. One alarm a wreck a day.
export const WRECK_ALARM = {
  types: ['car_wreck', 'car_open', 'pickup_truck', 'van_wreck', 'box_truck', 'ambulance', 'camper'],
  live: 0.22, // of those wrecks, the share whose battery is alive (drawn at its first hard blow of the day)
  trip: 0.45, // a hard blow on one that has chirped sets it off this often
  ring: 18, // s it rings for
  pulse: 3, // s between the noises it makes
  noise: 85, // m each of them carries (NOISE.CAR_ALARM, a trunk's, is 140 and brings a pack of its own; this brings nothing new)
  bonnet: 0.3, // a blow this far (of the wreck's half length) or more towards its front end, while it rings, kills it
};
export const ALARM = { UNKNOWN: 0, DEAD: 1, LIVE: 2, WARNED: 3, RINGING: 4, SPENT: 5 };
// what EVT.WRECK_ALARM says
export const ALARM_SAY = { QUIET: 0, CHIRP: 1, RING: 2 };
// too light to wake it: a blade drawn across a panel
export const alarmBlow = (blow) => blow !== BLOW.SLASH && blow !== BLOW.SHOT;

/**
 * One blow on a wreck's alarm: its state after it, and what to tell the clients (an ALARM_SAY, or -1 for nothing).
 * front: -1 (its nose) .. 1 (its tail), where along the wreck it landed. rng: the game's.
 */
export function alarmStep(state, type, blow, front, rng) {
  if (state === ALARM.RINGING) return front <= -WRECK_ALARM.bonnet ? [ALARM.SPENT, ALARM_SAY.QUIET] : [state, -1];
  if (!alarmBlow(blow) || state === ALARM.DEAD || state === ALARM.SPENT) return [state, -1];
  if (state === ALARM.UNKNOWN) {
    if (!WRECK_ALARM.types.includes(type) || rng() >= WRECK_ALARM.live) return [ALARM.DEAD, -1];
    return [ALARM.WARNED, ALARM_SAY.CHIRP];
  }
  if (state === ALARM.LIVE) return [ALARM.WARNED, ALARM_SAY.CHIRP];
  return rng() < WRECK_ALARM.trip ? [ALARM.RINGING, ALARM_SAY.RING] : [state, -1];
}

// A wreck is several colliders now that they follow its model (shared/props.js), and it is still one thing to strip,
// to dent and to ring: every collider of it names the first of them (col.main, set in worldkit.js), and that one is
// what its record is kept under and what it is called on the wire. (A lorry is two units: tractor and trailer.)
export const wreckUnit = (col) => (col && col.main) || col;

// Half the length of a wreck, nose to tail, for saying where along it a blow landed (the alarm: alarmStep's `front`).
// Its plan's box, which is the one box it always had - not the box of it that happened to be struck.
export const wreckHalf = (prop, col) => Math.max(0.5, (planOf(prop.type)?.boxes?.[0]?.[5] ?? col.hz * 2) / 2);

// The wreck a collider is a solid of: the prop the world put down (worldkit.js tags its colliders), or null - a
// tree, a wall, a wreck the game draws for itself (the plane that is mended).
export const wreckOf = (col) => (col && col.flags & COL.SALVAGE && col.tag && typeof col.tag === 'object' && !col.tag.bare && !col.tag.live ? col.tag : null);

// Where along a wreck a point is, in the wreck's own frame: [x across, y above its base, z along (-: its nose)].
export function wreckLocal(prop, x, y, z, out = [0, 0, 0]) {
  const c = Math.cos(prop.ry);
  const s = Math.sin(prop.ry);
  const dx = x - prop.x;
  const dz = z - prop.z;
  out[0] = c * dx - s * dz;
  out[1] = y - prop.y;
  out[2] = s * dx + c * dz;
  return out;
}

// The salvage collider the server names by its quantized x, y0, z (as EVT.STRIPPED does), or null.
const _near = [];
export function wreckColAt(world, qx, qy, qz) {
  for (const c of world.staticGrid.query(dqpos(qx), dqpos(qz), 0.5, _near)) if (c.flags & COL.SALVAGE && qpos(c.x) === qx && qpos(c.y0) === qy && qpos(c.z) === qz) return wreckUnit(c);
  return null;
}
