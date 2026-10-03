// The Tri-County Fair (ZONE.FAIR): a midway of stalls, a carousel and a Ferris wheel, and the generator that
// runs them. This file is what both sides have to agree on: where the fair's things stand (buildFair, called by
// world.js), where each seat of a ride is for a given reading of the ride clock (seatPos), and what the player
// simulation does with a survivor who is sitting in one (rideStep / rideCarry, called by playersim.js).
//
// The rides turn on one clock, counted in commands (CMD_RATE to a second) and only while the generator runs, so a
// wheel that stops keeps its gondolas where they were. A rider carries their own reading of it in the simulated
// state (`ride` the seat + 1, `rideT` the clock, `rideGo` whether it is turning): every command moves it on by one
// and puts the body where the seat is for it. That is all prediction needs: the client and the server run the same
// commands over the same numbers, so they agree on where the rider is to the last bit, and the server only has to
// speak when it changes one of the three (boarding, the generator starting or dying, a rider whose commands fell
// behind the wheel).
import { CMD_RATE, BTN } from './constants.js';
import { CONT } from './defs.js';
import { mulberry32 } from './rng.js';

const PI = Math.PI;
const TAU = PI * 2;

// The Ferris wheel stands across the back of the midway (its axle along the place's Z). hub: height of the axle,
// r: to the pivots the gondolas hang from, hang: pivot down to a gondola's floor, deck: the loading platform.
export const WHEEL = { x: 0, z: 21, hub: 10.3, r: 8, hang: 1.9, n: 8, period: 40, deck: 0.35, half: 0.85 };
// The carousel. r: to the horses, rim: the edge of its deck, sit: a rider's feet above the deck (the saddle is a
// seat's height over that), bob: how far a horse rises and falls, `bobs` times a turn.
export const CAROUSEL = { x: -17, z: 6, r: 3.0, n: 8, period: 8, deck: 0.3, rim: 4.4, top: 3.3, sit: 0.5, bob: 0.2, bobs: 3 };
export const RIDE_SEATS = WHEEL.n + CAROUSEL.n; // seats 0..7 are the wheel's gondolas, 8..15 the carousel's horses
// A gondola is boarded, and stepped out of, while its floor is no higher than this above the loading platform:
// the bottom eighth of the turn either side. Higher up the only way out is to jump.
export const BOARD_RISE = 0.9;
export const SEAT_PICK = { y: 0.75, r: 0.9 }; // [E] is offered on a seat when the view ray passes this near the point this far above its floor

// The generator in the shed. A portion of the Flamethrower Fuel a survivor carries runs it for `burn` seconds; the
// tank takes `tank` seconds' worth. While it runs the fair is a noise that carries `noise` metres, made again
// every `noiseEvery` seconds (a car alarm carries 140, a pipe bomb 170).
export const GEN = { portion: 25, burn: 150, tank: 600, hold: 1.5, noiseEvery: 4, pick: 0.9, tankPick: 0.7 };

const WT = WHEEL.period * CMD_RATE; // commands to a turn
const CT = CAROUSEL.period * CMD_RATE;

export const isWheelSeat = (seat) => seat < WHEEL.n;

// Where a rider's feet are in `seat` when the ride clock reads t (commands): writes out.x / y / z.
export function seatPos(fair, seat, t, out) {
  let lx;
  let ly;
  let lz;
  if (seat < WHEEL.n) {
    const a = (seat / WHEEL.n + (t % WT) / WT) * TAU; // 0: at the bottom
    lx = WHEEL.x + Math.sin(a) * WHEEL.r;
    ly = WHEEL.hub - Math.cos(a) * WHEEL.r - WHEEL.hang;
    lz = WHEEL.z;
  } else {
    const j = seat - WHEEL.n;
    const u = (t % CT) / CT;
    const a = (j / CAROUSEL.n + u) * TAU;
    lx = CAROUSEL.x + Math.sin(a) * CAROUSEL.r;
    ly = CAROUSEL.deck + CAROUSEL.sit + CAROUSEL.bob * Math.sin(u * TAU * CAROUSEL.bobs + j * PI);
    lz = CAROUSEL.z + Math.cos(a) * CAROUSEL.r;
  }
  out.x = fair.x + fair.c * lx + fair.s * lz;
  out.y = fair.y + ly;
  out.z = fair.z - fair.s * lx + fair.c * lz;
  return out;
}

// How far the floor of a seat is above where a survivor gets on and off it (the wheel's platform; a horse is
// always at the deck).
export function seatRise(fair, seat, t) {
  if (seat >= WHEEL.n) return 0;
  const a = (seat / WHEEL.n + (t % WT) / WT) * TAU;
  return WHEEL.hub - Math.cos(a) * WHEEL.r - WHEEL.hang - WHEEL.deck;
}
export const seatLow = (fair, seat, t, slack = 0) => seatRise(fair, seat, t) <= BOARD_RISE + slack;

const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };

// The start of a command for a survivor on a ride (s.ride). Returns true while the seat still has them, having
// moved their reading of the ride clock on; false once they are off it, as of this command:
//  - Space: they jump out, wherever the seat is, with the speed it was carrying them at;
//  - something else moved them (a blow that knocks a survivor off their feet, a roper's rope): a seated body has
//    no speed of its own and stands on its seat, so any speed or a body in the air is somebody else's doing;
//  - they have turned, or this valley has no fair.
export function rideStep(s, pressed, world, events) {
  const fair = world.fair;
  if (!fair || s.zombie || s.ride > RIDE_SEATS) {
    s.ride = 0;
    return false;
  }
  if (s.pulled || !s.onGround || s.vx !== 0 || s.vy !== 0 || s.vz !== 0) {
    s.ride = 0;
    s.onGround = 0;
    return false;
  }
  if (pressed & BTN.JUMP) {
    if (s.rideGo) {
      seatPos(fair, s.ride - 1, s.rideT, _a);
      seatPos(fair, s.ride - 1, s.rideT + 1, _b);
      s.vx = (_b.x - _a.x) * CMD_RATE;
      s.vy = (_b.y - _a.y) * CMD_RATE;
      s.vz = (_b.z - _a.z) * CMD_RATE;
    }
    s.ride = 0;
    s.onGround = 0;
    if (events) events.push({ type: 'jump' });
    return false;
  }
  if (s.rideGo) s.rideT++;
  return true;
}

// The end of that command: the seat has the body. It sits (the crouched height and eye), still, on its seat.
export function rideCarry(s, world) {
  seatPos(world.fair, s.ride - 1, s.rideT, s);
  s.vx = s.vy = s.vz = 0;
  s.onGround = 1;
  s.crouch = 1;
  s.sprinting = 0;
}

// ---------------------------------------------------------------- the place
// Builds the fair into the world: b is world.js's builder in the place's frame (front, and the road, at -Z).
// Returns what the rest of the game needs to know about it:
//   x, y, z, ry, c, s   the place's frame (seatPos)
//   gen, tank           where the generator and its fuel drum are aimed at for [E]
//   lamps               [{ x, y, z, r }] the light the fair throws while the generator runs: ground within r of
//                       one, with a clear line to it, is lit (it holds a Shade the way a torch does)
//   strings             [[x0, y0, z0, x1, y1, z1]] the strings of bulbs over the midway (drawn by the client)
export function buildFair(b, zone, seed, { door, win }) {
  const rng = mulberry32(seed ^ 0xfa12); // its own stream: nothing else in the valley moves for what stands here
  const sd = () => rng.int(0, 9999);
  const fair = { x: zone.x, y: zone.h, z: zone.z, ry: zone.ry, c: Math.cos(zone.ry), s: Math.sin(zone.ry), gen: null, tank: null, lamps: [], strings: [] };
  const at = (lx, ly, lz) => ({ x: b.wx(lx, lz), y: b.y0 + ly, z: b.wz(lx, lz) });
  const lamp = (lx, ly, lz, r) => fair.lamps.push({ ...at(lx, ly, lz), r });
  const string = (x0, z0, x1, z1, y = 4.25) => {
    const p = at(x0, y, z0);
    const q = at(x1, y, z1);
    fair.strings.push([p.x, p.y, p.z, q.x, q.y, q.z]);
  };

  // the entrance: an arch over the lane in from the road, the ticket booth beside it
  for (const sx of [-1, 1]) b.cyl(sx * 4.3, 0, -28, 0.22, 5.4, 'metal', { sides: 8 });
  b.box(0, 4.2, -28, 9.6, 1.15, 0.22, 'barn', { collide: false });
  b.box(0, 5.35, -28, 10, 0.14, 0.4, 'trim', { collide: false });
  b.room(8, -25.5, 3, 3, 2.6, 'clapboard', { w: [win(1.5, 1.4, 1.0, 2.0)], s: [door(1.5, 1.0)] }, { roof: 'flat', roofMat: 'tin' });
  b.cont(CONT.CABINET, 8.4, -26.4, { prop: 'cabinet', ry: PI, seed: sd() });
  b.partSpot(7.1, -24.8);
  for (let x = 6; x <= 24; x += 3) {
    b.prop('fence', -x - 1.5, -29.5, 0, { seed: sd() });
    if (x > 9) b.prop('fence', x + 1.5, -29.5, 0, { seed: sd() });
  }

  // the midway: poles down both sides of the lane with strings of bulbs between them and across it
  const POLES = [-22, -14, -6, 2, 10];
  POLES.forEach((z, i) => {
    for (const sx of [-1, 1]) {
      b.cyl(sx * 3.4, 0, z, 0.07, 4.4, 'metal', { sides: 6 });
      if (i) string(sx * 3.4, POLES[i - 1], sx * 3.4, z);
    }
    string(-3.4, z, 3.4, z);
  });
  string(-3.4, -22, -4.3, -28, 4.6);
  string(3.4, -22, 4.3, -28, 4.6);
  // a stall: three walls under an awning, a counter across most of the front (local -Z: the lane) and a way in
  // past the end of it
  const stall = (x, z, ry, mat, fill) => {
    const s = b.sub(x, z, ry);
    s.wall(-2, 1.5, 2, 1.5, 2.5, 0.15, mat);
    s.wall(-2, -1.3, -2, 1.5, 2.5, 0.15, mat);
    s.wall(2, 1.5, 2, -1.3, 2.5, 0.15, mat);
    s.box(-0.8, 0, -1.3, 2.4, 1.0, 0.45, 'planks'); // (the way in past its end is 1.5 m: narrower, a stall askew to the nav grid can be shut to the dead)
    s.box(0, 2.5, -0.5, 4.7, 0.1, 4.4, 'canvas', { collide: false });
    for (const sx of [-1, 1]) s.cyl(sx * 2.15, 0, -2.5, 0.05, 2.5, 'metal', { sides: 6 });
    s.roofSpan(0, -0.5, 2.35, 2.2, 2.5, 0.1);
    s.clear(0, 0, 4);
    fill(s);
  };
  // game stalls: prizes on the shelves, a row of rotten things to throw at on the counter
  const game = (s) => {
    s.cont(CONT.SHELF, 0.5, 1.15, { prop: 'shelf', ry: 0, seed: sd() });
    s.prop('crate_small', -1.4, 0.9, 0.3, { seed: sd() });
    for (const px of [-1.5, -0.8, -0.1]) s.prop('pumpkin', px, -1.3, rng.range(0, TAU), { ly: 1.0, nocollide: true, seed: sd() });
    s.loot(0, -1.3, 1.02);
  };
  // food stands: a fridge that has not run in a long time, what is left under the counter
  const fridge = (s) => {
    s.cont(CONT.FRIDGE, -1.3, 1.05, { prop: 'fridge', ry: 0, seed: sd() });
    s.prop('barrel', 1.4, 0.9, 0, { seed: sd() });
    s.loot(-0.9, -1.3, 1.02);
  };
  const pantry = (s) => {
    s.cont(CONT.CABINET, -0.9, 1.1, { prop: 'cabinet', ry: 0, seed: sd() });
    s.prop('crate_small', 1.3, 1.0, 0.5, { seed: sd() });
    s.prop('crate_small', 1.3, 1.0, 1.1, { ly: 0.6, seed: sd() });
    s.loot(-0.2, -1.3, 1.02);
  };
  stall(-8, -19, -PI / 2, 'barn', game);
  stall(-8, -12, -PI / 2, 'clapboard', fridge);
  stall(-8, -5, -PI / 2, 'barn', game);
  stall(8, -19, PI / 2, 'clapboard', pantry);
  stall(8, -12, PI / 2, 'barn', game);
  stall(8, -5, PI / 2, 'clapboard', fridge);
  lamp(0, 4, -24, 10);
  lamp(0, 4, -14, 11);
  lamp(0, 4, -4, 11);
  lamp(0, 4, 6, 11);

  // the carousel: its deck and the drum the works are in (the horses, the poles and the canopy turn: the client
  // draws those)
  const C = CAROUSEL;
  b.cyl(C.x, 0, C.z, C.rim, C.deck, 'planks', { sides: 24 });
  b.cyl(C.x, C.deck, C.z, 0.75, C.top - C.deck, 'barn', { sides: 12 });
  b.clear(C.x, C.z, C.rim + 2);
  lamp(C.x, 3, C.z, 11);

  // the Ferris wheel: the loading platform under it, and an A-frame either side of the wheel carrying the axle
  // (the wheel and its gondolas turn: the client draws those). Only the feet of the frames are solid.
  const W = WHEEL;
  b.box(W.x, 0, W.z, 9, W.deck, 3.4, 'planks');
  const foot = 5.6;
  const lean = Math.atan2(foot, W.hub - 0.4);
  const leg = Math.hypot(foot, W.hub - 0.4);
  for (const sz of [-1, 1]) {
    const z = W.z + sz * 1.35;
    for (const sx of [-1, 1]) {
      b.box(W.x + sx * foot, 0, z, 0.9, 0.4, 0.9, 'concrete');
      b.box(W.x + (sx * foot) / 2, (W.hub + 0.4) / 2 - leg / 2, z, 0.3, leg, 0.3, 'metal', { rz: sx * lean, collide: false });
    }
    b.box(W.x, 4.9, z, foot * (1 - 4.6 / (W.hub - 0.4)) * 2, 0.2, 0.2, 'metal', { collide: false });
  }
  b.cyl(W.x, W.hub - 1.6, W.z, 0.22, 3.2, 'metal', { rx: PI / 2, sides: 10 });
  b.clear(W.x, W.z, 9);
  lamp(W.x, 5, W.z, 14);

  // the generator shed, off to the side behind the stalls: the machine, the drum it is fed from
  b.room(17, 9, 5, 4.4, 2.8, 'planks', { w: [door(2.2, 1.3)], n: [win(2.5, 1.2)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete' });
  const gen = b.prop('generator', 18.2, 10.1, 0, { seed: 3 });
  fair.gen = { x: gen.x, y: gen.y + 0.75, z: gen.z };
  const drum = b.prop('barrel', 18.6, 7.9, 0, { seed: 1 });
  fair.tank = { x: drum.x, y: drum.y + 0.85, z: drum.z };
  b.box(18.45, 0.5, 9, 0.06, 0.06, 1.5, 'dark', { collide: false }); // (the fuel line between the two)
  b.cont(CONT.TOOLBOX, 15.5, 10.6, { prop: 'toolbox', ry: 0.6, nocollide: true, seed: sd() });
  b.partSpot(16, 7.7);
  b.loot(17, 8);
  lamp(17, 2.3, 9, 7);
  // (the cable from the shed to the midway)
  b.box(11.5, 0, 6.6, 6.2, 0.05, 0.1, 'dark', { ry: -0.42, collide: false });

  // what is left of the last evening it was open
  b.prop('picnic_table', 13.5, -3, 0.2, { seed: sd() });
  b.prop('picnic_table', 16, 1.5, -0.4, { seed: sd() });
  b.cont(CONT.DUFFEL, 14.6, -1.2, { prop: 'duffel_bag', ry: 0.5, nocollide: true, seed: sd() });
  b.cont(CONT.DUMPSTER, 22, -8, { prop: 'dumpster', ry: -PI / 2, seed: sd() });
  b.prop('cart', -4.6, 3.4, 0.5, { seed: sd() });
  b.prop('barrel', 4.4, 14, 0, { seed: sd() });
  b.prop('barrel', -5, 15.2, 0, { seed: sd() });
  b.prop('outhouse', 25, 14, -PI / 2, { seed: sd() });
  b.prop('outhouse', 25, 16.4, -PI / 2, { seed: sd() });
  b.prop('corpse', 1.2, -9, 0.7, { nocollide: true, seed: sd() });
  b.prop('corpse', -12.5, 9.5, 2.2, { nocollide: true, seed: sd() });
  b.prop('corpse', 3.6, 18.2, 1.3, { nocollide: true, seed: sd() });
  b.prop('bones', -20.5, -4, 0, { nocollide: true, seed: sd() });
  b.prop('pumpkin', -11.2, 2.4, 0.4, { nocollide: true, seed: sd() });
  // the cars of the people who came
  for (const [x, z, ry] of [[-14, -33, 1.45], [-21, -32.2, 1.7], [15, -33.2, 1.6]]) {
    const r = rng();
    if (rng.chance(0.75)) b.wreck(r < 0.75 ? 'car_wreck' : 'pickup_truck', x + rng.range(-0.4, 0.4), z, ry + rng.range(-0.15, 0.15), { trunk: rng.chance(0.5), seed: sd() });
  }
  b.loot(-2.6, 20.2, W.deck + 0.02);
  b.loot(-13.6, 9.6);
  b.loot(12.4, -2);
  b.loot(1.5, 12.5);
  return fair;
}
