// The handcars on the railway: a flat car on four wheels with a see-saw pump lever, left on the line by the
// section gang beside the platform at Whitlock Depot and a little way off the Route 9 crossing (handcars). The
// stalled train cuts the main line in two and a car never gets past it, or into a tunnel beyond its mouth.
//
// One survivor rides a car. They get on with [E] (the server seats them, server/handcar.js) and then the car is
// part of their simulated state, as a seat of a ride at the fair is (fair.js): `cart` the car + 1, `cartS` where
// it is on the line (a point of rail.main, fractional: the points are a metre apart), `cartV` its speed along the
// line (m/s, + towards the higher points). Every command moves it on and puts the body on its deck, so the
// client's prediction and the server agree on where the rider is to the last bit and the server only speaks
// when it seats them. While nobody rides it the server rolls it on by itself until it stops.
//   W / S        work the lever: the car is driven towards where the rider looks along the line, or away from it.
//                Driven against the way it rolls, it brakes. The lever is geared to the wheels, so it goes up and
//                down as the car rolls, worked or not (leverAngle)
//   Shift        work it hard: faster, and it costs stamina as sprinting does
//   E / Space    off over the side the rider looks to, with the speed the car had
// While the lever is worked both hands are on it: the weapon in them does nothing (playersim.js).
import { BTN, STAMINA_DRAIN, STAMINA_REGEN_DELAY } from './constants.js';
import { RAIL } from './rail.js';
import { ROAD, DEPOT_TRACK } from './layout.js';

export const HANDCAR = {
  top: 10, // m/s the lever drives it at, worked steadily (a sprint is 7.5)...
  hardTop: 13, // ...and worked hard
  accel: 2.2, // m/s/s from a standstill
  hardAccel: 3.2,
  brake: 5, // m/s/s, the lever worked against the way it rolls
  roll: 0.3, // m/s/s of rolling resistance while nobody works it...
  drag: 0.003, // ...and per (m/s)^2 of air
  hold: 0.4, // a car standing still stays put on a grade that pulls it less than this (m/s/s): the line's steepest is 0.3
  bump: 1.2, // m/s: hitting the end of its stretch faster than this is a bang
  stroke: 4, // metres of line to a stroke of the lever, up and down
  swing: 0.3, // radians the lever rocks either way of level
  deck: 0.8, // the top of the deck over the top of the bed (the rails stand 0.25)
  half: 1.4, // half its length...
  halfW: 0.8, // ...and its width
  stand: 1.15, // the rider stands this far behind the middle (towards the lower points), the lever's handle in front
  beam: 0.75, // the lever, from its pivot to a handle
  pivot: 1.05, // the pivot over the deck
  hop: 3, // m/s: getting off, sideways...
  hopUp: 3.6, // ...and up
  pick: { y: 0.9, r: 1.4 }, // [E] is offered when the view ray passes this near the point this far over the deck
  minRun: 100, // a stretch of open line shorter than this has no car
};
const G = 9.8;
// the car stops this far short of the cave-in in a tunnel mouth (its far end into the bore)...
const INTO_BORE = 2.6 - HANDCAR.half;
// ...and of the end of the stalled train (the couplers stand out 0.55 beyond a car)
const OFF_TRAIN = 1.1 + HANDCAR.half;
// commands: what a command on a car did (cartStep)
export const CART_OFF = 0;
export const CART_RIDE = 1;
export const CART_PUMP = 2; // ...with the rider's hands on the lever
const HANDS = BTN.ATTACK | BTN.ALT | BTN.RELOAD;
export const LEVER_HANDS = HANDS;

// a point of the main line at f (a fractional index) -> out { x, y (the top of the bed), z, tx, tz (along the
// line, towards the higher points), len (of that metre), slope (rise per metre along it) }
export function linePoint(m, f, out) {
  const i = f <= 0 ? 0 : f >= m.n - 1 ? m.n - 2 : Math.floor(f);
  const u = f - i;
  const dx = m.x[i + 1] - m.x[i];
  const dz = m.z[i + 1] - m.z[i];
  const l = Math.hypot(dx, dz) || 1;
  out.x = m.x[i] + dx * u;
  out.y = m.y[i] + (m.y[i + 1] - m.y[i]) * u;
  out.z = m.z[i] + dz * u;
  out.tx = dx / l;
  out.tz = dz / l;
  out.len = l;
  out.slope = (m.y[i + 1] - m.y[i]) / l;
  return out;
}

// The handcars of a valley: [{ run, lo, hi, at }], in points of rail.main - the stretch of open line the car is
// on (run: which one, lo..hi: where the middle of a car can go on it) and where it stands when a game starts.
// Two at most, on stretches long enough to be worth the ride: beside the depot's platform, a little way off the
// Route 9 crossing (the breakdown is a short walk from it), and only failing those at the end of the train (the
// stretch beyond the train is mostly a short one into a tunnel). Two cars on one stretch run into each other
// (the server's business: server/handcar.js). [] on a map without a railway.
export const MAX_HANDCARS = 2;
const carsOf = new WeakMap();
export function handcars(world) {
  let cars = carsOf.get(world);
  if (cars) return cars;
  cars = [];
  carsOf.set(world, cars);
  const rail = world.rail;
  if (!rail) return cars;
  const consist = rail.train.cars;
  const train = consist.reduce((s, c) => s + (c.kind === 'loco' ? RAIL.LOCO : RAIL.CAR), 0) + RAIL.GAP * (consist.length - 1);
  const iT = rail.train.i;
  const runs = [
    [rail.portals[0].i - INTO_BORE, iT - train / 2 - OFF_TRAIN, 1], // (the end of it the train is at: +1 the high one)
    [iT + train / 2 + OFF_TRAIN, rail.portals[1].i + INTO_BORE, -1],
  ];
  // beside the platform at the depot, at its end away from where the siding leaves the main line
  let depot = -1;
  const d = rail.depot;
  if (d) {
    const lx = 10;
    const p = rail.near(d.x + Math.cos(d.ry) * lx + Math.sin(d.ry) * DEPOT_TRACK, d.z - Math.sin(d.ry) * lx + Math.cos(d.ry) * DEPOT_TRACK, 0);
    if (p.d < 2) depot = p.i;
  }
  // a little way off the Route 9 crossing, on whichever side of it has more line
  const hwy = rail.crossings.find((c) => c.kind === ROAD.ASPHALT);
  // every place a car could stand, best first: [run, at]
  const spots = [];
  runs.forEach(([lo, hi, end], run) => {
    if (hi - lo < HANDCAR.minRun) return;
    const inside = (i) => i >= lo + 6 && i <= hi - 6;
    if (depot >= 0 && inside(depot)) spots.push([run, depot, 0]);
    if (hwy && inside(hwy.i)) spots.push([run, hwy.i + (hwy.i - lo > hi - hwy.i ? -9 : 9), 1]);
    spots.push([run, end > 0 ? hi - 3 : lo + 3, 2]);
  });
  spots.sort((a, b) => a[2] - b[2]);
  const take = (sp) => {
    const [lo, hi] = runs[sp[0]];
    cars.push({ run: sp[0], lo, hi, at: Math.min(hi, Math.max(lo, sp[1])) });
  };
  for (const sp of spots) if (cars.length < MAX_HANDCARS && !cars.some((c) => c.run === sp[0] && Math.abs(c.at - sp[1]) < 40)) take(sp);
  return cars;
}

// The car moves on by dt: c = { s, v } (the line's points, m/s), run: its stretch (handcars). pump: -1 / 0 / 1,
// the way the lever drives it. hard: worked hard. -> true when it ran into the end of the stretch faster than
// HANDCAR.bump.
const _p = { x: 0, y: 0, z: 0, tx: 0, tz: 1, len: 1, slope: 0 };
export function rollCar(m, run, c, pump, hard, dt) {
  const H = HANDCAR;
  linePoint(m, c.s, _p);
  let v = c.v;
  const grade = -G * _p.slope;
  if (pump) {
    const along = v * pump;
    let a;
    if (along < -0.05) a = H.brake;
    else {
      const top = hard ? H.hardTop : H.top;
      const r = along / top;
      a = (hard ? H.hardAccel : H.accel) * Math.max(-1, 1 - r * r);
    }
    v += (a * pump + grade) * dt;
  } else if (v === 0 && Math.abs(grade) < H.hold) {
    // standing, and it stays standing
  } else {
    const slow = (H.roll + H.drag * v * v) * dt;
    v += grade * dt;
    v = v > slow ? v - slow : v < -slow ? v + slow : 0;
  }
  let s = c.s + (v * dt) / _p.len;
  let bump = false;
  if (s < run.lo || s > run.hi) {
    bump = Math.abs(v) > H.bump;
    s = s < run.lo ? run.lo : run.hi;
    v = 0;
  }
  c.s = s;
  c.v = v;
  return bump;
}

// The start of a command for a survivor on a car (s.cart). Returns CART_RIDE / CART_PUMP while the car still has
// them, having moved it on; CART_OFF once they are off it, as of this command:
//  - E or Space (the client sends [E] as Space): they hop off over the side they look to, with its speed;
//  - something else moved them (a blow that knocks a survivor off their feet, a roper's rope, a leaper's pin): a
//    body on the deck has no speed of its own, so any speed or a body in the air is somebody else's doing;
//  - they went down or turned, or this valley has no such car.
const _cart = { s: 0, v: 0 };
export function cartStep(s, b, pressed, world, events, dt) {
  const run = handcars(world)[s.cart - 1];
  if (!run || s.zombie || s.downed) {
    s.cart = 0;
    s.onGround = 0;
    return CART_OFF;
  }
  if (s.pulled || s.pinned || !s.onGround || s.vx !== 0 || s.vy !== 0 || s.vz !== 0) {
    s.cart = 0;
    s.onGround = 0;
    return CART_OFF;
  }
  const m = world.rail.main;
  linePoint(m, s.cartS, _p);
  const fx = -Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  if (pressed & BTN.JUMP) {
    // to the right of the line (as railway.js draws it: tz, -tx) or the left, as the view is
    const side = fx * _p.tz - fz * _p.tx >= 0 ? 1 : -1;
    s.vx = _p.tx * s.cartV + _p.tz * side * HANDCAR.hop;
    s.vz = _p.tz * s.cartV - _p.tx * side * HANDCAR.hop;
    s.vy = HANDCAR.hopUp;
    s.cart = 0;
    s.onGround = 0;
    if (events) events.push({ type: 'jump' });
    return CART_OFF;
  }
  // the lever: towards where they look along the line (W) or away from it (S); looking across the line, the way
  // it already rolls
  const keys = (b & BTN.FWD ? 1 : 0) - (b & BTN.BACK ? 1 : 0);
  const look = fx * _p.tx + fz * _p.tz;
  const way = look > 0.15 ? 1 : look < -0.15 ? -1 : s.cartV > 0.2 ? 1 : s.cartV < -0.2 ? -1 : 0;
  const pump = keys * way;
  let hard = false;
  if (pump && b & BTN.SPRINT && !s.exhausted && s.stamina > 0) {
    hard = true;
    s.stamina -= STAMINA_DRAIN * dt;
    s.staminaDelay = STAMINA_REGEN_DELAY;
    if (s.stamina <= 0) {
      s.stamina = 0;
      s.exhausted = 1;
      if (events) events.push({ type: 'exhausted' });
    }
  }
  _cart.s = s.cartS;
  _cart.v = s.cartV;
  if (rollCar(m, run, _cart, pump, hard, dt) && events) events.push({ type: 'cart_bump', v: Math.abs(s.cartV) });
  s.cartS = _cart.s;
  s.cartV = _cart.v;
  return keys ? CART_PUMP : CART_RIDE;
}

// The end of that command: the car has the body. It stands, still, on the deck behind the lever.
export function cartCarry(s, world) {
  linePoint(world.rail.main, s.cartS - HANDCAR.stand, _p);
  s.x = _p.x;
  s.y = _p.y + HANDCAR.deck;
  s.z = _p.z;
  s.vx = s.vy = s.vz = 0;
  s.onGround = 1;
  s.crouch = 0;
  s.sprinting = 0;
}

// Where a car at f is drawn and stood on: out { x, y (the deck), z, yaw (of the car's +Z: towards the higher
// points) } - on the chord between its axles, as a car of the train stands on the chord between its ends.
const _a = { x: 0, y: 0, z: 0, tx: 0, tz: 1, len: 1, slope: 0 };
const _b = { x: 0, y: 0, z: 0, tx: 0, tz: 1, len: 1, slope: 0 };
export function carFrame(m, f, out) {
  linePoint(m, f - 0.7, _a);
  linePoint(m, f + 0.7, _b);
  out.x = (_a.x + _b.x) / 2;
  out.y = (_a.y + _b.y) / 2 + HANDCAR.deck;
  out.z = (_a.z + _b.z) / 2;
  out.yaw = Math.atan2(_b.x - _a.x, _b.z - _a.z);
  out.pitch = Math.atan2(_b.y - _a.y, Math.hypot(_b.x - _a.x, _b.z - _a.z));
  return out;
}

// the lever of a car at f, radians: + its handle at the low end (the rider's) down. It is geared to the wheels.
export const leverAngle = (f) => HANDCAR.swing * Math.sin((f / HANDCAR.stroke) * Math.PI * 2);
