// The places that lie about the mainland, out over the plain between the bridge, the city and the airfield
// (shared/mainland.js plans where each goes and which road reaches it; shared/defs.js names them and gives each a
// loot table of its own). Each entry of OUTLYING:
//   flat / clear / dirt   as a place of the island has them (layout.js PLACES): the levelled yard, the ground kept
//                         clear of trees, how trampled it is
//   raise                 built up on the ground it stands on (the radio mast wants a hill, and gets one)
//   road                  what reaches it: ROAD.ASPHALT, ROAD.DIRT or ROAD.TRAIL
//   inner                 the road runs on in to the middle of the place (its own street)
//   build(b, K)           builds it with a Builder in the place's frame: the road arrives at (0, -flat), the front
//                         of everything (-Z) is to it. K: { rng, door, win, gap, hole } (worldkit.js's openings; hole:
//                         a window with the glass gone), and `afloat(prop)` for what lies on the water
// Nothing here is drawn from a stream of its own: the mainland's rng is K.rng, and a place is built once per map.
import { ZONE, CONT } from './defs.js';
import { WATER_LEVEL } from './constants.js';
import { ROAD } from './layout.js';

const PI = Math.PI;

// a chain-link fence round a yard hx by hz, with a gateway `gate` wide in the middle of its front (and a boom across it)
function fenced(b, hx, hz, gate = 4, boom = true) {
  for (let x = -hx + 1.5; x < hx; x += 3) {
    if (Math.abs(x) > gate) b.prop('fence_chain', x, -hz, 0);
    b.prop('fence_chain', x, hz, 0);
  }
  for (let z = -hz + 1.5; z < hz; z += 3) {
    b.prop('fence_chain', -hx, z, PI / 2);
    b.prop('fence_chain', hx, z, PI / 2);
  }
  if (boom) b.prop('boom_gate', -0.4, -hz, 0);
}

// a house: two rooms, a bed, a kitchen corner. k: which of its variants (walls, what the kitchen keeps, what is outside)
export function house(b, hx, hz, front, k, K) {
  const { door, win, hole } = K;
  const s = b.sub(hx, hz, front);
  const w = (at, wd = 1.2) => (k % 3 === 1 ? hole(at, wd) : win(at, wd));
  s.room(0, 0, 10, 8, 3, k % 2 ? 'clapboard' : 'brick', { n: [door(5, 1.2), w(2, 1.4), w(8, 1.4)], s: [door(8, 1.1), win(3.4)], e: [w(4)], w: [win(4)] }, { roof: 'gableZ', roofH: 2.6, roofMat: 'shingles' });
  s.wall(-1, -4, -1, 4, 3, 0.18, 'clapboard', [door(5.4, 1.1)]);
  s.prop('bed', -4.3, -2.2, 0); // (clear of the back door)
  s.cont(k % 2 ? CONT.CABINET : CONT.FRIDGE, 4.2, 3.3, { prop: k % 2 ? 'cabinet' : 'fridge', ry: PI });
  s.prop('table', 2, -1.6, 0.1);
  s.loot(2, -1.6, 0.82);
  s.loot(-2.4, 2);
  if (k % 3 === 0) s.wreck(k % 2 ? 'car_burnt' : 'car_wreck', 7.6, -7.5, 0.1, { seed: k, trunk: k % 2 === 0 });
  if (k % 2 === 0) s.cont(CONT.DUMPSTER, -7.2, 2, { prop: 'dumpster', ry: PI / 2, seed: k });
  if (k % 4 === 1) s.prop('ivy', 5.2, 0.5, -PI / 2, { seed: k, nocollide: true }); // (up the east wall)
  if (k % 4 === 2) s.prop('barricade', -3, -4.85, 0, { seed: k }); // (across a window: the door is still a way in)
  return s;
}

// a street of houses: two rows of four, doors on the lane that runs down the middle (the place's own road)
function houses(b, K, zone) {
  for (let k = 0; k < 4; k++) {
    house(b, -33 + k * 22, -14, 0, k + zone, K); // (north of the lane, doors on it)
    house(b, -33 + k * 22, 14, PI, k + 4 + zone, K);
  }
  for (const [mx, mz] of [[-22, -5.2], [3.5, -5.2], [22, 5.2], [-12, 5.2]]) b.prop('mailbox', mx, mz, 0);
  b.prop('streetlight', -44, -4.6, PI / 2);
  b.prop('streetlight', 44, 4.6, -PI / 2);
  b.wreck('school_bus', 14, 1.6, PI / 2 + 0.2, { trunk: false });
  b.prop('pole_down', -24, 3, 0.2, { nocollide: true });
  b.prop('suitcases', -8, -3.4, 0.4, { nocollide: true });
  b.prop('litter', 30, -1, 1, { nocollide: true });
  b.prop('corpse', -6, 1, 1.4, { nocollide: true });
  b.loot(-30, 2);
  b.loot(34, -2);
}

// a mobile home: one long room, a step at its door. burnt: a shell
function trailer(b, cx, cz, flip, burnt, i, K) {
  const { door, win, gap } = K;
  const s = b.sub(cx, cz, flip ? PI : 0);
  const mat = burnt ? 'charred' : i % 3 === 0 ? 'tin' : i % 3 === 1 ? 'tin_rust' : 'clapboard';
  s.room(0, 0, 10, 3.6, 2.6, mat, { n: burnt ? [gap(2.4, 1.4, 2.2), gap(6, 2, 2.4)] : [door(2.4, 1.1), win(5.4, 1.5), win(8.3, 1.1)], s: [win(3), win(7)], w: [win(1.8, 0.8)] }, { roof: burnt ? undefined : 'flat', roofMat: 'tin', floorMat: 'planks' });
  s.box(0, 0, -1.95, 10, 0.12, 0.8, 'planks', { collide: false }); // step
  if (!burnt) {
    s.cont(i % 2 ? CONT.CABINET : CONT.FRIDGE, 4.1, 1.2, { prop: i % 2 ? 'cabinet' : 'fridge', ry: PI });
    s.prop('bed', -3.3, 0.7, PI / 2);
    s.loot(1, 0);
  } else {
    s.loot(0, 0);
    s.prop('bones', 2, 0.4, 0, { nocollide: true });
  }
  return s;
}

export const OUTLYING = {
  // CAMP HOLLIS: where the evacuees were held until there was nobody left to hold them. Rows of tents behind wire, a
  // prefab clinic at the back, the dead in bags beside it.
  [ZONE.QUARANTINE]: {
    flat: 40,
    clear: 44,
    dirt: 0.7,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { door, win } = K;
      fenced(b, 32, 30, 5);
      for (const sx of [-1, 1]) {
        b.prop('sandbags', sx * 6.6, -27.4, 0, { seed: sx + 1 });
        b.prop('razor_wire', sx * 10.4, -27.6, 0, { seed: sx + 1 });
      }
      for (const [tx, tz, k] of [[-22, -12, 0], [-11, -12, 1], [11, -12, 2], [22, -12, 3], [-22, 4, 4], [-11, 4, 5], [11, 4, 6], [22, 4, 7]]) {
        b.prop('military_tent', tx, tz, 0, { seed: k });
        if (k % 2) b.cont(CONT.DUFFEL, tx + 0.8, tz - 4.2, { prop: 'duffel_bag', ry: k, nocollide: true, seed: k });
        else b.loot(tx - 0.6, tz - 4.4);
        if (k % 3 === 0) b.prop('suitcases', tx + 2.6, tz - 4, k, { nocollide: true, seed: k });
      }
      // the clinic
      b.room(0, 20, 14, 7, 3, 'tin', { n: [door(7, 1.5), win(2.6, 1.6), win(11.4, 1.6)], w: [win(3.5)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete' });
      for (const dx of [-5.6, -4.4, -3.2]) b.cont(CONT.MEDICINE, dx, 23.09, { prop: 'medicine_cabinet', ry: PI, ly: 0.12, seed: dx | 0 });
      b.cont(CONT.CABINET, 0, 23.04, { prop: 'cabinet', ry: PI, ly: 0.12 });
      b.cont(CONT.LOCKER, 6.56, 21.6, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
      b.prop('bed', 3.6, 21.8, 0, { ly: 0.12 });
      b.prop('bed', -1.6, 18.4, PI / 2, { ly: 0.12 });
      b.prop('wheelchair', 4.6, 18.4, 2.4, { nocollide: true, ly: 0.12 });
      b.loot(1.6, 19, 0.14);
      for (let i = 0; i < 9; i++) b.prop('body_bag', -27 + (i % 5) * 1.3, 19 + Math.floor(i / 5) * 2.4, 0.1 * (i % 3), { nocollide: true, seed: i });
      b.box(24, 0, 22, 5, 0.06, 4, 'ash', { collide: false }); // the burn pit
      b.prop('barrel', 21, 24.6, 0);
      b.light(24, 0.6, 22, 'smoke');
      b.wreck('ambulance', 14, -23, PI / 2, { trunk: false });
      b.wreck('school_bus', -17, -23.4, PI / 2 + 0.06, { trunk: false });
      b.cont(CONT.AMMO_BOX, -27, -5, { prop: 'military_crate', ry: 0.3 });
      b.cont(CONT.CRATE, 27.5, -4, { prop: 'crate', ry: 0.2 });
      b.prop('generator', 27, 12, 0.2);
      b.prop('streetlight', -5.6, -10, PI / 2);
      b.prop('streetlight', 5.6, 8, -PI / 2);
      b.prop('litter', 2, -4, 0.3, { nocollide: true });
      b.prop('litter', -3, 10, 2, { nocollide: true, seed: 1 });
      b.prop('corpse', 1.5, -18, 0.6, { nocollide: true });
      b.prop('corpse', -2, 2, 2.2, { nocollide: true });
      b.loot(0, -20);
      b.loot(16.5, -6);
      b.loot(-16.5, 10);
    },
  },

  // THE ROUTE 9 CHECKPOINT: the army's last line between the bridge and the city. Route 9 runs through it (along the
  // place's Z): barriers set to stop a car, a queue of them that stopped.
  [ZONE.ROADBLOCK]: {
    flat: 26,
    clear: 28,
    dirt: 0.3,
    road: 0, // (it stands on the highway)
    build(b, K, z) {
      b.prop('jersey_barrier', -2, -5, 0);
      b.prop('jersey_barrier', 2.2, 3, 0);
      b.prop('jersey_barrier', -6, -5, 0, { seed: 2 });
      b.prop('jersey_barrier', 6.2, 3, 0, { seed: 3 });
      b.prop('boom_gate', 1.8, -11, 0);
      b.prop('military_tent', -12.5, -2, PI / 2);
      b.prop('military_tent', 13, 9, -PI / 2);
      b.cont(CONT.LOCKER, -9.7, 4.2, { prop: 'locker', ry: -PI / 2 });
      b.cont(CONT.LOCKER, 10.1, 2.4, { prop: 'locker', ry: PI / 2, seed: 1 });
      b.cont(CONT.AMMO_BOX, -9.5, -8, { prop: 'military_crate', ry: 0.2 });
      b.cont(CONT.AMMO_BOX, 10, 14.5, { prop: 'military_crate', ry: -0.3 });
      b.prop('military_crate', 10.3, 14.4, -0.3, { ly: 0.7 });
      b.cont(CONT.DUFFEL, -13, -9, { prop: 'duffel_bag', ry: 2.2, nocollide: true });
      for (let i = 0; i < 6; i++) {
        const a = PI * 0.25 + (i / 5) * PI * 0.5;
        b.prop('sandbags', -10 + Math.cos(a) * 4, 14 + Math.sin(a) * 4, -a + PI / 2);
      }
      b.prop('razor_wire', -8.6, -14, 0.1);
      b.prop('razor_wire', 9, -6.5, -0.1, { seed: 1 });
      b.prop('shipping_container', 17.5, -8, 0.1, { seed: 1 });
      b.prop('generator', -16, 7, 0.3);
      b.prop('streetlight', -5.5, 10, PI / 2);
      b.prop('streetlight', 5.5, -14, -PI / 2);
      b.prop('barrel', -7.5, 9, 0);
      b.light(-7.5, 1.0, 9, 'embers');
      b.prop('body_bag', 14.5, -1.4, 0.2, { nocollide: true });
      b.prop('body_bag', 15.6, -0.6, 0.3, { nocollide: true });
      // the queue, either way: the last cars out of the city, and the first back
      for (let i = 0; i < (z.queue ?? 4); i++) {
        b.wreck(i === 2 ? 'car_burnt' : 'car_wreck', -1.9 + (i % 2) * 0.4, -22 - i * 7.5, 0.05 * (i - 1.5), { trunk: i % 2 === 0 && i !== 2, ground: true });
        b.wreck(i === 1 ? 'pickup_truck' : 'car_wreck', 1.9 - (i % 2) * 0.4, 19 + i * 7.5, PI + 0.06 * (i - 1.5), { trunk: i % 2 === 1, ground: true });
      }
      b.loot(-8, -10);
      b.loot(8.5, 12);
    },
  },

  // CALDER SUBSTATION: four transformers under a gantry, the line in on a pylon, a switch room.
  [ZONE.SUBSTATION]: {
    flat: 26,
    clear: 30,
    dirt: 0.6,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win } = K;
      fenced(b, 19.5, 18, 4, false);
      for (const tx of [-9, -3, 3, 9]) b.prop('power_transformer', tx, 6, 0, { seed: tx });
      for (const px of [-12, 0, 12]) for (const pz of [2.6, 9.4]) b.box(px, 0, pz, 0.3, 6.4, 0.3, 'rust');
      for (const pz of [2.6, 9.4]) b.box(0, 6.4, pz, 24.6, 0.3, 0.3, 'rust', { collide: false });
      for (const px of [-12, 0, 12]) b.box(px, 6.4, 6, 0.3, 0.3, 7.1, 'rust', { collide: false });
      b.prop('radio_mast', 14.5, 13, 0);
      b.room(-11.5, -9, 7, 5.5, 3, 'concrete', { e: [door(2.75, 1.2)], n: [win(3.5, 1.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      b.cont(CONT.LOCKER, -14.56, -8, { prop: 'locker', ry: PI / 2, ly: 0.12 });
      b.cont(CONT.CABINET, -11.5, -6.71, { prop: 'cabinet', ry: PI, ly: 0.12 });
      b.cont(CONT.TOOLBOX, -9.6, -10.6, { prop: 'toolbox', ry: 0.6, nocollide: true, ly: 0.12 });
      b.cont(CONT.CRATE, 12, -10, { prop: 'crate', ry: 0.3 });
      b.prop('generator', 8, -13.5, 0.2);
      b.wreck('pickup_truck', 2.6, -12, 0.2);
      b.prop('pole_down', 4, -24, 0.4, { nocollide: true, ground: true });
      b.prop('corpse', -3, -4, 1.2, { nocollide: true });
      b.loot(-4, -8);
      b.loot(6, -2);
      b.loot(-15, 13);
    },
  },

  // CALDER WATERWORKS: a pump house under the town's water tower, two settling tanks.
  [ZONE.WATERWORKS]: {
    flat: 24,
    clear: 28,
    dirt: 0.4,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win, hole } = K;
      b.prop('water_tower', 11, 8, 0.2);
      b.room(-6, 6, 9, 7, 3.4, 'brick', { n: [door(4.5, 1.4), hole(1.6, 1.2)], e: [win(3.5)], s: [door(7.4, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      for (const px of [-8.4, -5.4]) b.box(px, 0.12, 7.6, 1.6, 1.2, 1, 'metal'); // the pumps
      b.cyl(-6.9, 0.9, 7.6, 0.16, 3, 'rust', { rz: PI / 2 });
      b.cont(CONT.TOOLBOX, -3.4, 4, { prop: 'toolbox', ry: 0.4, nocollide: true, ly: 0.12 });
      b.cont(CONT.SHELF, -8.2, 3.06, { prop: 'shelf', ry: 0, ly: 0.12 });
      b.cont(CONT.LOCKER, -2.06, 7, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
      b.loot(-5, 5, 0.14);
      for (const sx of [-1, 1]) {
        b.cyl(sx * 12, 0, -9, 4, 1.5, 'concrete', { sides: 16 });
        b.cyl(sx * 12, 1.5, -9, 3.6, 0.06, 'dark', { sides: 16, collide: false }); // what is left in it
      }
      b.cyl(0, 0.5, -9, 0.2, 16, 'rust', { rz: PI / 2 }); // the main between them, over the lane
      b.wreck('pickup_truck', 18, -1, 0.1);
      b.cont(CONT.CRATE, 4, 13.5, { prop: 'crate', ry: 0.2 });
      b.prop('barrel', 2.4, 12.6, 0);
      b.prop('ivy', -10.56, 6, PI / 2, { nocollide: true });
      b.prop('corpse', 3, -2, 0.3, { nocollide: true });
      b.loot(6, 2);
      b.loot(-14, -1);
    },
  },

  // LAKE MORROW MARINA: a pier out over the lake (the place's +Z), a boathouse, a tackle shed.
  [ZONE.MARINA]: {
    flat: 22,
    clear: 30,
    dirt: 0.2,
    road: ROAD.DIRT,
    shore: true,
    build(b, K, z) {
      const { door, win, gap } = K;
      const deckY = WATER_LEVEL + 1.1 - z.h; // (over the place's own level)
      for (let i = 0; i < 9; i++) {
        const len = i < 8 ? 4 : 2;
        b.box(0, deckY - 0.22, 9 + i * 4 + len / 2, 3, 0.22, len + 0.05, 'dockwood', { collide: true });
        b.cyl(-1.4, deckY - 3.5, 9.2 + i * 4, 0.14, 3.6, 'dockwood', { collide: false });
        b.cyl(1.4, deckY - 3.5, 9.2 + i * 4, 0.14, 3.6, 'dockwood', { collide: false });
      }
      b.box(0, deckY - 0.22, 45, 9, 0.22, 4, 'dockwood', { collide: true }); // the T at its end
      b.prop('dock_post', -4.2, 46.5, 0, { ly: deckY - 0.1 });
      b.prop('dock_post', 4.2, 46.5, 0, { ly: deckY - 0.1 });
      K.afloat(b.prop('boat', 3.4, 38, 0.15, { y: WATER_LEVEL - 0.15, nocollide: true }));
      K.afloat(b.prop('boat', -3.6, 30, -0.3, { y: WATER_LEVEL - 0.15, nocollide: true }));
      K.afloat(b.prop('boat', 3.5, 22, 0.1, { y: WATER_LEVEL - 0.15, nocollide: true, seed: 1 }));
      b.cont(CONT.CRATE, -0.6, 44.5, { prop: 'crate', ly: deckY, ry: 0.3 });
      b.prop('barrel', 3.2, 45.2, 0, { ly: deckY });
      b.loot(-3.5, 45.5, deckY + 0.02);
      b.room(-9, 6, 8, 10, 3.2, 'planks', { n: [door(4, 1.3)], s: [gap(4, 4, 2.8)], e: [win(5)], w: [win(5)] }, { roof: 'gable', roofH: 2.2, roofMat: 'tin' });
      b.cont(CONT.SHELF, -12.4, 6, { prop: 'shelf', ry: PI / 2 });
      b.prop('boat', -8, 7.5, 0.05, { ly: 0.12, nocollide: true });
      b.cont(CONT.TOOLBOX, -6, 2.5, { prop: 'crate_small', ry: 0.4, h: 0.62 });
      b.loot(-11.6, 3);
      b.room(9, -1, 5, 4.5, 2.6, 'clapboard', { n: [door(2.5, 1.2)], w: [win(2.2, 1)] }, { roof: 'flat', roofMat: 'tin' });
      b.cont(CONT.CABINET, 9.6, 0.5, { prop: 'cabinet', ry: PI });
      b.cont(CONT.LOCKER, 10.9, -1.4, { prop: 'locker', ry: -PI / 2 });
      b.prop('fuel_tank', 14, 9, 0.2);
      b.prop('barrel', 6.6, 5, 0);
      b.prop('pallet', 4.4, 2, 0.4);
      b.wreck('pickup_truck', 2, -12, 1.3);
      b.wreck('camper', -10, -12, 1.5, { zone: ZONE.MARINA });
      b.prop('dock_post', -2.5, 8.5, 0);
      b.prop('dock_post', 2.5, 8.5, 0);
      b.prop('picnic_table', 5.5, -6, 0.3);
      b.prop('corpse', -3, -4, 2, { nocollide: true });
      b.loot(3.5, -3);
      b.loot(5.5, -6, 0.82);
    },
  },

  // SUNSET ACRES: mobile homes along a dirt lane, one of them burnt out.
  [ZONE.TRAILERPARK]: {
    flat: 32,
    clear: 36,
    dirt: 0.6,
    road: ROAD.DIRT,
    inner: true,
    build(b, K) {
      trailer(b, -10, -16, false, false, 0, K);
      trailer(b, -10, -2, false, false, 1, K);
      trailer(b, -10, 12, false, true, 2, K);
      trailer(b, 10.5, -12, true, false, 3, K);
      trailer(b, 10.5, 2, true, false, 4, K);
      trailer(b, 10.5, 16, true, false, 5, K);
      b.wreck('school_bus', -22, 22, PI / 2 + 0.2, { trunk: false });
      b.cont(CONT.DUFFEL, -18.5, 19.2, { prop: 'duffel_bag', ry: 0.3, nocollide: true });
      b.wreck('car_wreck', -4.5, -23, 0.3);
      b.wreck('car_burnt', 5.4, 9, PI + 0.4, { seed: 1, trunk: false });
      b.wreck('pickup_truck', 21.5, -22, -0.5);
      b.cont(CONT.DUMPSTER, 21, -8, { prop: 'dumpster', ry: -PI / 2 });
      b.prop('tire_pile', -18, -8, 0);
      b.prop('barrel', 18, 22, 0);
      b.light(18, 1.0, 22, 'embers');
      b.prop('picnic_table', -18, 4, 0.5);
      b.prop('satellite_dish', 19, -1, 1.2);
      b.prop('barricade', 0.4, 24.5, 0.1);
      b.prop('litter', 0, -6, 0.5, { nocollide: true });
      b.prop('litter', 2, 14, 2.5, { nocollide: true, seed: 2 });
      b.prop('corpse', 3, 20, 1.8, { nocollide: true });
      b.loot(-18, 4, 0.82);
      b.loot(3.5, -8);
    },
  },

  // BENNY'S AUTO SALVAGE: rows of wrecks, some two high, a crusher, containers of parts.
  [ZONE.SALVAGE]: {
    flat: 32,
    clear: 36,
    dirt: 0.9,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win, gap, rng } = K;
      fenced(b, 24, 21, 4);
      b.prop('billboard', -11, -25.5, 0);
      b.room(-16, -13, 8, 6, 2.9, 'tin_rust', { e: [door(3, 1.2)], n: [win(4, 1.6)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'planks' });
      b.cont(CONT.LOCKER, -19.5, -12, { prop: 'locker', ry: -PI / 2 });
      b.cont(CONT.CABINET, -16.5, -10.45, { prop: 'cabinet', ry: 0 });
      b.prop('table', -15.5, -14.2, 0);
      b.loot(-15.5, -14.2, 0.82);
      b.room(15, -13, 7, 7, 3.4, 'tin', { w: [gap(3.5, 3.4, 2.9)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete' });
      b.cont(CONT.SHELF, 18.1, -13, { prop: 'shelf', ry: PI / 2 });
      b.cont(CONT.SHELF, 15, -9.9, { prop: 'shelf', ry: 0, seed: 1 });
      b.cont(CONT.TOOLBOX, 13, -15.6, { prop: 'toolbox', ry: 0.4, nocollide: true });
      b.prop('tire_pile', 17.5, -15.5, 0);
      for (const [rz, xs] of [[-1, [-19.5, -16, -12.5]], [7, [-19.5, -16, -12.5, -9]], [15, [-19.5, -16, -12.5]]]) {
        for (const x of xs) {
          const ry = (rng.chance(0.5) ? 0 : PI) + rng.range(-0.08, 0.08);
          const r = rng();
          const type = r < 0.55 ? 'car_wreck' : r < 0.8 ? 'car_burnt' : 'pickup_truck';
          b.wreck(type, x, rz, ry, { trunk: type === 'car_wreck' && rng.chance(0.5) });
          const up = rng.chance(0.45);
          const jx = rng.range(-0.15, 0.15);
          const jz = rng.range(-0.2, 0.2);
          const jr = rng.range(-0.12, 0.12);
          if (type !== 'pickup_truck' && up) b.prop('car_burnt', x + jx, rz + jz, ry + jr, { ly: type === 'car_wreck' ? 1.5 : 1.4 }); // (on the roof of the one under it)
        }
      }
      // the crusher, and what came out of it
      b.box(12, 0, 6, 4.2, 0.5, 6.5, 'rust');
      b.box(10.1, 0.5, 6, 0.4, 2.6, 6.5, 'rust');
      b.box(13.9, 0.5, 6, 0.4, 2.6, 6.5, 'rust');
      b.box(12, 3.1, 6, 4.2, 0.5, 6.5, 'metal');
      b.box(12, 0.5, 6, 1.7, 0.9, 2.4, 'rust');
      b.box(17.2, 0, 2.2, 1.7, 0.9, 2.4, 'rust', { ry: 0.1 });
      b.box(19.6, 0, 2, 1.7, 0.9, 2.4, 'tin_rust', { ry: 0.3 });
      b.prop('shipping_container', 20.4, 13.5, 0.03, { seed: 2 });
      b.cont(CONT.FREIGHT, 17.4, 15.6, { prop: 'crate', ry: 0.2 });
      b.wreck('dump_truck', -3, 16.5, 1.45, { trunk: false });
      b.wreck('tractor', 1.5, 3, 0.6, { trunk: false });
      b.cont(CONT.DUMPSTER, -6, -18.6, { prop: 'dumpster', ry: PI });
      b.cont(CONT.CRATE, -6.5, -4, { prop: 'crate', ry: 0.3 });
      for (const [tx, tz] of [[-21.6, 19], [8.5, -5], [1, 19]]) b.prop('tire_pile', tx, tz, 0);
      b.prop('barrel', 0.5, -3, 0);
      b.light(0.5, 1.0, -3, 'embers');
      b.prop('corpse', 2.5, -9, 0.9, { nocollide: true });
      b.loot(0, -7);
      b.loot(6, 11.5);
      b.loot(-5.5, 9.5);
    },
  },

  // GATEWAY PLAZA: one great shed of a store, looted to the walls and still the most there is in one place, and a
  // car park of the people who came for it.
  [ZONE.MALL]: {
    flat: 46,
    clear: 50,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { door, win, gap, hole, rng } = K;
      b.box(0, -0.05, -21, 56, 0.1, 32, 'concrete', { collide: true }); // the car park
      // the store: its front all glass once, two ways in at the back
      b.room(0, 14, 44, 26, 6.4, 'concrete', { n: [gap(22, 6, 3.2), hole(8, 7, 0.5, 3.4), win(36, 7, 0.5, 3.4)], s: [gap(8, 4, 3.6), door(38, 1.2)], e: [door(20, 1.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      b.box(0, 6.7, 0.7, 20, 2.2, 0.5, 'paint', { collide: false }); // what is left of the sign
      for (const px of [-11, 0, 11]) for (const pz of [8, 17]) b.box(px, 0.12, pz, 0.5, 6.28, 0.5, 'concrete');
      // the back of house, behind a wall: the stock room and the office
      b.wall(-22, 21.5, 22, 21.5, 6.4, 0.2, 'concrete', [door(10, 1.6), door(34, 1.2)]);
      b.wall(6, 21.5, 6, 27, 6.4, 0.2, 'concrete', [door(2.6, 1.2)]);
      // the aisles: five rows of shelving, half of it still holding something
      let k = 0;
      for (const ax of [-17, -8.5, 8.5, 17]) {
        for (const az of [6.5, 10.5, 14.5, 18.5]) {
          k++;
          if (k % 2) b.cont(CONT.SHELF, ax, az, { prop: 'shelf', ry: PI / 2, ly: 0.12, seed: k });
          else if (k % 5) b.prop('shelf', ax, az, PI / 2, { ly: 0.12, seed: k });
        }
      }
      for (const cx of [-14, -9, 9, 14]) b.box(cx, 0.12, 3.4, 0.8, 1.0, 2.2, 'planks'); // the checkouts
      b.loot(-14, 3.4, 1.14);
      b.loot(9, 3.4, 1.14);
      b.cont(CONT.FRIDGE, 21.45, 8, { prop: 'fridge', ry: -PI / 2, ly: 0.12 });
      b.cont(CONT.FRIDGE, 21.45, 10, { prop: 'fridge', ry: -PI / 2, ly: 0.12, seed: 1 });
      b.cont(CONT.MEDICINE, -21.59, 12, { prop: 'medicine_cabinet', ry: PI / 2, ly: 0.12 });
      b.cont(CONT.LOCKER, -21.56, 17, { prop: 'locker', ry: PI / 2, ly: 0.12 });
      for (const [sx, sz, r] of [[-3, 9, 0.4], [4, 15, 2], [-13, 13, 1.2], [13, 6, 2.6]]) b.prop('shopping_cart', sx, sz, r, { nocollide: true, ly: 0.12, seed: r | 0 });
      b.prop('barricade', -4.4, 1.95, 0.05, { ly: 0.12 });
      b.prop('litter', 2, 11, 0.4, { nocollide: true, ly: 0.12 });
      b.prop('litter', -6, 17, 2, { nocollide: true, ly: 0.12, seed: 1 });
      b.prop('corpse', 3, 5, 0.7, { nocollide: true, ly: 0.12 });
      b.loot(0, 12, 0.14);
      b.loot(-19, 19, 0.14);
      // the stock room
      for (const [cx, cz, sd] of [[-18, 25.4, 0], [-13, 25.2, 1], [-3, 25.4, 2]]) b.cont(CONT.FREIGHT, cx, cz, { prop: 'crate', ry: 0.1 * sd, ly: 0.12, seed: sd });
      b.prop('pallet', -8, 24, 0.3, { ly: 0.12 });
      b.loot(1, 24, 0.14);
      b.cont(CONT.LOCKER, 21.56, 25, { prop: 'locker', ry: -PI / 2, ly: 0.12, seed: 2 });
      b.cont(CONT.CABINET, 12, 26.54, { prop: 'cabinet', ry: PI, ly: 0.12 });
      b.prop('table', 15, 23.6, 0, { ly: 0.12 });
      b.loot(15, 23.6, 0.94);
      // the loading dock, and the car park
      b.wreck('semi_truck', -14, 37, 0.06, { trunk: false });
      b.cont(CONT.DUMPSTER, -4, 29.2, { prop: 'dumpster', ry: 0 });
      b.prop('pallet', 0.5, 29.6, 0.5);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 9; c++) {
          const here = rng.chance(0.5);
          const t = rng();
          const ry = (rng.chance(0.5) ? 0 : PI) + rng.range(-0.1, 0.1);
          const trunk = rng.chance(0.4);
          if (!here || (r === 0 && Math.abs(c - 4) < 2)) continue; // (the lane up to the doors)
          const type = t < 0.5 ? 'car_wreck' : t < 0.78 ? 'car_burnt' : 'pickup_truck';
          b.wreck(type, -24 + c * 6, -12 - r * 9, ry, { trunk: trunk && type !== 'car_burnt', ly: 0.05 });
        }
      }
      for (const [sx, sz, r] of [[-5, -8, 1], [6, -17, 2.2], [-15, -26, 0.3], [20, -7, 4]]) b.prop('shopping_cart', sx, sz, r, { nocollide: true, ly: 0.05, seed: sz | 0 });
      b.prop('fallen_sign', 9, -3.2, 0.2, { nocollide: true, ly: 0.05 });
      b.prop('streetlight', -27, -21, PI / 2, { ly: 0.05 });
      b.prop('streetlight', 27, -21, -PI / 2, { ly: 0.05 });
      b.prop('motel_sign', 30, -39.5, 0.2);
      b.prop('litter', -3, -14, 1, { nocollide: true, ly: 0.05, seed: 2 });
      b.prop('suitcases', 3, -5, 0.5, { nocollide: true, ly: 0.05 });
      b.prop('corpse', -2, -22, 2.4, { nocollide: true, ly: 0.05 });
      b.loot(9, -25.5, 0.07);
      b.loot(-21, -8, 0.07);
    },
  },

  // CALDER ELEMENTARY: a corridor, four classrooms, the buses that came for the children and never left.
  [ZONE.SCHOOL]: {
    flat: 36,
    clear: 40,
    dirt: 0.2,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { door, win, hole } = K;
      b.room(0, 10, 36, 12, 3.6, 'brick', { n: [door(18, 1.7), hole(4.5, 2.4), win(9, 2.4), win(27, 2.4), hole(31.5, 2.4)], s: [win(4.5, 2.4), hole(13.5, 2.4), win(22.5, 2.4), win(31.5, 2.4)], e: [door(9.5, 1.2)], w: [door(2.5, 1.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks' });
      b.wall(-18, 8.6, 18, 8.6, 3.6, 0.2, 'brick', [door(4.5, 1.2), door(13.5, 1.2), door(22.5, 1.2), door(31.5, 1.2)]);
      for (const wx of [-9, 0, 9]) b.wall(wx, 8.6, wx, 16, 3.6, 0.18, 'brick');
      // the classrooms
      for (let c = 0; c < 2; c++) {
        const cx = -13.5 + c * 9;
        for (let i = 0; i < 6; i++) b.prop('school_desk', cx - 2.6 + (i % 3) * 2.6, 11 + Math.floor(i / 3) * 2, i === 4 ? 1.2 : 0, { nocollide: true, ly: 0.12, seed: i === 4 ? 1 : 0 });
        b.cont(CONT.CABINET, cx + 2.4, 15.54, { prop: 'cabinet', ry: PI, ly: 0.12, seed: c });
        b.loot(cx - 3, 14.6, 0.14);
      }
      // the nurse's room, and the canteen
      b.cont(CONT.MEDICINE, 2.4, 15.59, { prop: 'medicine_cabinet', ry: PI, ly: 0.12 });
      b.prop('bed', 7.4, 12.6, 0, { ly: 0.12 });
      b.loot(3.4, 11, 0.14);
      b.cont(CONT.FRIDGE, 17.45, 14.6, { prop: 'fridge', ry: -PI / 2, ly: 0.12 });
      b.prop('table', 12.6, 13.6, 0, { ly: 0.12 });
      b.prop('table', 14.8, 11, 0.1, { ly: 0.12 });
      b.loot(12.6, 13.6, 0.94);
      // the corridor
      for (const lx of [-15.5, -14.4, 5.5, 6.6]) b.cont(CONT.LOCKER, lx, 4.44, { prop: 'locker', ry: 0, ly: 0.12, seed: lx | 0 });
      b.prop('barricade', -5, 6.6, 0.1, { ly: 0.12 });
      b.prop('litter', 9, 6.4, 0.3, { nocollide: true, ly: 0.12 });
      b.prop('corpse', -11, 6.4, 1.5, { nocollide: true, ly: 0.12 });
      b.loot(13, 6.4, 0.14);
      // out front
      b.wreck('school_bus', -11, -8, PI / 2 + 0.1, { trunk: false });
      b.wreck('school_bus', 8, -15, PI / 2 - 0.2, { trunk: false, seed: 1 });
      b.cyl(22, 0, -4, 0.06, 7.5, 'metal', { sides: 6 });
      b.prop('military_tent', -24, -10, PI / 2, { seed: 2 });
      b.cont(CONT.DUFFEL, -19.6, -10.6, { prop: 'duffel_bag', ry: 0.5, nocollide: true });
      for (let i = 0; i < 4; i++) b.prop('body_bag', 17 + i * 1.3, -12, 0.1 * i, { nocollide: true, seed: i });
      for (let i = 0; i < 6; i++) b.prop('fence', -16.5 + i * 3, 24, 0);
      b.prop('picnic_table', -8, 21, 0.2);
      b.prop('picnic_table', 6, 20.4, -0.3);
      b.cont(CONT.DUMPSTER, 22, 18, { prop: 'dumpster', ry: -PI / 2 });
      b.prop('suitcases', 2, -3, 1.2, { nocollide: true });
      b.prop('ivy', -18.19, 12, PI / 2, { nocollide: true });
      b.loot(-3, -5);
      b.loot(14, 22);
    },
  },

  // WKCL: a radio station in a hut under its mast, on the highest ground for a mile.
  [ZONE.MAST]: {
    flat: 20,
    clear: 24,
    dirt: 0.35,
    raise: 7,
    hill: true,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win } = K;
      b.prop('radio_mast', 7, 5, 0);
      b.prop('satellite_dish', -9, 7, 0.4);
      b.prop('satellite_dish', -10, -4, -0.3, { seed: 1 });
      b.room(0, 5, 6, 5, 2.8, 'concrete', { n: [door(3, 1.3), win(5, 0.9)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
      b.cont(CONT.LOCKER, 2.4, 6.9, { prop: 'locker', ry: PI });
      b.cont(CONT.CABINET, -2.1, 6.9, { prop: 'cabinet', ry: PI });
      b.cont(CONT.TOOLBOX, -0.6, 3.6, { prop: 'toolbox', ry: 0.2, nocollide: true });
      b.cont(CONT.AMMO_BOX, 10.5, -3, { prop: 'military_crate', ry: 0.2 });
      b.prop('sandbags', 10.4, -4.6, 0.1);
      b.prop('generator', 10.6, 9, 0.3);
      b.prop('fuel_tank', -4, 13, PI / 2);
      b.wreck('pickup_truck', -5, -12, 0.3);
      for (let i = 0; i < 5; i++) b.prop('fence_chain', -6 + i * 3, 16.5, 0);
      b.prop('lantern_post', 3.4, 1, 0);
      b.prop('bones', 6, -8, 0, { nocollide: true });
      b.loot(4, -4);
      b.loot(-7, 1);
    },
  },

  // THE STARLIGHT MOTOR INN: a row of rooms under one long roof, the office, a car park.
  [ZONE.MOTORINN]: {
    flat: 34,
    clear: 38,
    dirt: 0.2,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { door, win, hole } = K;
      b.box(-3, -0.05, -9, 46, 0.1, 17, 'concrete', { collide: true });
      const RW = 6;
      const n = 6;
      const x0 = -26;
      const zf = 4;
      const D = 8;
      const H = 3;
      const fops = [];
      const bops = [];
      for (let i = 0; i < n; i++) {
        fops.push(door(i * RW + 1.4, 1.3));
        fops.push(i % 2 ? hole(i * RW + 4.2, 1.5) : win(i * RW + 4.2, 1.5));
        bops.push(win((n - 1 - i) * RW + 3, 0.8, 1.6, 2.2));
      }
      b.wall(x0, zf, x0 + n * RW, zf, H, 0.25, 'clapboard', fops);
      b.wall(x0 + n * RW, zf + D, x0, zf + D, H, 0.25, 'clapboard', bops);
      b.wall(x0, zf + D, x0, zf, H, 0.25, 'clapboard', [win(4, 1.2)]);
      b.wall(x0 + n * RW, zf, x0 + n * RW, zf + D, H, 0.25, 'clapboard');
      for (let i = 1; i < n; i++) b.wall(x0 + i * RW, zf, x0 + i * RW, zf + D, H, 0.2, 'planks');
      b.box(x0 + (n * RW) / 2, 0, zf + D / 2, n * RW, 0.12, D, 'planks', { collide: true });
      b.box(x0 + (n * RW) / 2, H, zf + D / 2 - 1.8, n * RW + 0.8, 0.28, D + 4.2, 'tin', { collide: true });
      b.roofSpan(x0 + (n * RW) / 2, zf + D / 2 - 1.8, (n * RW) / 2 + 0.4, D / 2 + 2.1, H, 0.28);
      for (let i = 0; i <= n; i++) b.cyl(x0 + i * RW, 0, zf - 3.4, 0.1, H, 'trim', { sides: 6 });
      b.clear(x0 + (n * RW) / 2, zf + D / 2, 20);
      for (let i = 0; i < n; i++) {
        const cx = x0 + i * RW;
        b.prop('bed', cx + 3.8, zf + D - 1.3, PI, { ly: 0.12 });
        if (i % 2 === 0) b.cont(CONT.CABINET, cx + 1.2, zf + D - 0.47, { prop: 'cabinet', ry: 0, ly: 0.12, seed: i });
        else b.cont(CONT.FRIDGE, cx + 0.66, zf + D - 0.56, { prop: 'fridge', ry: 0, ly: 0.12, seed: i });
        if (i === 2 || i === 5) b.cont(CONT.DUFFEL, cx + 2.4, zf + 2.2, { prop: 'duffel_bag', ry: 1.2, nocollide: true, ly: 0.12 });
        b.loot(cx + 4.6, zf + 1.4, 0.14);
      }
      b.room(17, 2, 10, 9, 3.4, 'brick', { n: [door(2.4, 1.5), hole(6.6, 3, 0.9, 2.4)], e: [win(4.5)], s: [door(2, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks' });
      b.box(15, 0.12, 0.2, 4, 1.05, 0.7, 'planks', { collide: true }); // the desk
      b.cont(CONT.LOCKER, 21.56, 5.6, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
      b.cont(CONT.SHELF, 14, 6.06, { prop: 'shelf', ry: PI, ly: 0.12 });
      b.loot(15, 0.2, 1.19);
      b.prop('motel_sign', -20, -21, 0.3);
      b.cont(CONT.DUMPSTER, -12, 16.5, { prop: 'dumpster', ry: PI });
      b.wreck('car_wreck', -16, -8, 1.62, { ly: 0.05 });
      b.wreck('car_burnt', 2, -9, 1.5, { ly: 0.05, trunk: false });
      b.wreck('pickup_truck', -4, -14, 1.7, { trunk: false, ly: 0.05 });
      b.prop('suitcases', -9, -1, 0.4, { nocollide: true, ly: 0.05 });
      b.prop('corpse', -8, -3, 0.4, { nocollide: true, ly: 0.05 });
      b.prop('barrel', 23.5, -4, 0);
      b.prop('streetlight', -8, -18.5, PI);
      b.prop('streetlight', 12, -18.5, PI);
      b.loot(-10, -6, 0.07);
    },
  },

  // HILLSIDE CEMETERY: rows of stones, a chapel of rest, a family vault somebody pried open.
  [ZONE.GRAVEYARD]: {
    flat: 28,
    clear: 20,
    road: ROAD.TRAIL,
    build(b, K) {
      const { door, win, rng } = K;
      b.room(0, 13, 7, 9, 4, 'stone', { n: [door(3.5, 1.4)], e: [win(4.5, 1, 1.4, 3)], w: [win(4.5, 1, 1.4, 3)] }, { roof: 'gable', roofH: 3, roofMat: 'shingles' });
      b.prop('pew', -2.05, 10.8, 0); // (staggered: the way up to the altar is round the end of each)
      b.prop('pew', 2.05, 13.2, 0);
      b.prop('altar', 0, 16, 0);
      b.loot(0, 16, 1.02);
      b.cont(CONT.CABINET, -2.7, 16.9, { prop: 'cabinet', ry: PI });
      // the vault
      b.room(15, 12, 4.5, 5, 2.6, 'stone', { n: [door(2.25, 1.2)] }, { roof: 'flat', roofMat: 'stone', floorMat: 'stone' });
      b.box(15, 0.12, 13.2, 2.1, 0.7, 0.9, 'stone');
      b.cont(CONT.CASKET, 15, 13.2, { ly: 0.84, h: 0.1 });
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 13; c++) {
          const x = -18 + c * 3;
          const lean = rng.range(-0.15, 0.15);
          const cross = rng.chance(0.2);
          if (Math.abs(x) < 2.5) continue; // (the path up to the chapel)
          b.prop(cross ? 'grave_cross' : 'gravestone', x, -16 + r * 5, lean, { seed: r * 13 + c });
        }
      }
      for (const [gx, gz] of [[-9, -13.6], [12, -3.6], [-15, 1.4]]) b.box(gx, 0, gz, 0.9, 0.05, 2, 'earth', { collide: false }); // opened graves
      for (const [tx, tz] of [[-21, 8], [22, -6], [-8, 20], [9, 22], [21, 20]]) b.tree(tx, tz, 3 + (tx > 0 ? 1 : 0), 1.1);
      for (let i = 0; i < 7; i++) if (i !== 3) b.prop('fence', -9 + i * 3, -24, 0);
      b.prop('lantern_post', -2.6, 7, 0);
      b.prop('lantern_post', 2.6, 7, 0);
      b.cont(CONT.DUFFEL, 9, 6, { prop: 'duffel_bag', ry: 1, nocollide: true });
      b.prop('corpse', -5, 4, 0.5, { nocollide: true });
      b.prop('bones', 11.6, -2.6, 0, { nocollide: true });
      b.loot(-12, 9);
      b.loot(6, -9);
    },
  },

  // DUNMORE LOGGING CAMP: stacks of timber, a saw under a roof, the bunkhouse.
  [ZONE.LOGGING]: {
    flat: 30,
    clear: 34,
    dirt: 0.85,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win, gap } = K;
      b.shelter(0, 6, 9, 7, 3.6, 'tin_rust', 'planks');
      b.prop('saw_table', 0, 6, 0);
      b.cont(CONT.LOGPILE, -12, 14, { prop: 'log_pile', ry: 0.1 });
      b.cont(CONT.LOGPILE, 12, 15, { prop: 'log_pile', ry: -0.2, seed: 1 });
      b.cont(CONT.LOGPILE, -20, -10, { prop: 'log_pile', ry: 1.4, seed: 2 });
      b.prop('log_pile', 21, -2, 1.5, { seed: 3 });
      b.prop('log_pile', 3, 21, 0.05, { seed: 1 });
      b.room(-14, -4, 9, 6, 3, 'logwall', { e: [door(3, 1.2)], n: [win(2.5), win(6.5)], s: [win(4.5)] }, { roof: 'gable', roofH: 2.2, roofMat: 'shingles' });
      b.prop('bed', -17.3, -5.4, PI / 2);
      b.prop('bed', -17.3, -2.4, PI / 2);
      b.cont(CONT.LOCKER, -12, -1.46, { prop: 'locker', ry: PI });
      b.cont(CONT.CABINET, -14.4, -6.54, { prop: 'cabinet', ry: 0 });
      b.loot(-13, -4);
      b.room(14, -10, 6, 5, 2.8, 'planks', { w: [gap(2.5, 2.6, 2.4)] }, { roof: 'flat', roofMat: 'tin' });
      b.cont(CONT.TOOLBOX, 14, -8.6, { prop: 'toolbox', ry: 0.4, nocollide: true });
      b.cont(CONT.SHELF, 16.56, -10, { prop: 'shelf', ry: -PI / 2 });
      b.wreck('dump_truck', 7, -16, 0.3, { trunk: false });
      b.wreck('tractor', -6, 12, 2.2, { trunk: false });
      b.prop('fuel_tank', 22, 9, 0.1);
      b.prop('woodpile', -6, -11, 0.3);
      b.prop('campfire', -6, 2.6, 0, { nocollide: true, seed: 1 });
      b.prop('log_bench', -6, 0.7, PI / 2);
      b.prop('outhouse', -24, 4, PI / 2);
      b.prop('corpse', 3, -4, 1.4, { nocollide: true });
      b.loot(4, 1);
      b.loot(-2, -8);
    },
  },

  // FLIGHT 212: it came down a hundred metres short of the runway, and what two hundred people carried lies round it.
  [ZONE.CRASH]: {
    flat: 34,
    clear: 40,
    dirt: 0.5,
    road: ROAD.TRAIL,
    build(b, K) {
      const { rng } = K;
      b.wreck('airliner_wreck', 0, 2, 0.35, { trunk: false, seed: 0 });
      b.box(0, 0, 2, 26, 0.05, 30, 'ash', { collide: false, ry: 0.35 });
      b.box(2, 0, -22, 9, 0.05, 20, 'ash', { collide: false, ry: 0.3 }); // the furrow it ploughed coming in
      b.light(-2, 2.5, 6, 'fire');
      b.light(4, 3, -4, 'smoke');
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * PI * 2 + rng.range(-0.2, 0.2);
        const r = rng.range(20, 27);
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        const ry = rng.range(0, 6);
        if (i % 3 === 0) b.cont(CONT.DUFFEL, x, z, { prop: 'duffel_bag', ry, nocollide: true, seed: i });
        else if (i % 3 === 1) b.prop('suitcases', x, z, ry, { nocollide: true, seed: i });
        else b.prop('debris', x, z, ry, { nocollide: true, seed: i });
        if (i % 4 === 0) b.loot(x * 0.86, z * 0.86);
        if (i % 2) b.prop('body_bag', x * 1.12, z * 1.12, ry, { nocollide: true, seed: i });
      }
      b.prop('military_tent', -24, -19, 0.6);
      b.cont(CONT.AMMO_BOX, -19, -23.5, { prop: 'military_crate', ry: 0.2 });
      b.cont(CONT.CRATE, 23, -18, { prop: 'crate', ry: 0.4 });
      b.wreck('ambulance', 17, -25, 2.6, { trunk: false });
      b.prop('baggage_cart', -20, 20, 0.7);
    },
  },

  // WESTGATE: a street of houses between the city and the sea.
  [ZONE.WESTGATE]: {
    flat: 50,
    clear: 40,
    dirt: 0.15,
    road: ROAD.ASPHALT,
    inner: true,
    street: true,
    build: (b, K) => houses(b, K, 1),
  },

  // CALDER FREIGHT YARD: containers in rows, two and three high, half of them cut open.
  [ZONE.CONTAINERS]: {
    flat: 34,
    clear: 38,
    dirt: 0.8,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { door, win, rng } = K;
      fenced(b, 28, 24, 5);
      let k = 0;
      for (const rz of [-9, 0, 9, 18]) {
        for (let c = 0; c < 6; c++) {
          k++;
          const x = -22 + c * 3.2;
          const high = rng.int(0, 2);
          const skip = rng.chance(0.18);
          if (skip) continue;
          for (let h = 0; h <= high; h++) b.prop('shipping_container', x, rz, PI / 2 * 0 + (h ? 0.02 : 0), { ly: h * 2.6, seed: k + h });
        }
      }
      // the open ground east of the stacks: what was unloaded, and what it was unloaded with
      for (const [cx, cz, sd] of [[4, -6, 0], [6.4, 2, 1], [3.6, 10, 2], [8, 16.5, 3], [12.6, -12, 4]]) b.cont(CONT.FREIGHT, cx, cz, { prop: 'crate', ry: 0.2 * sd, seed: sd });
      b.prop('pallet', 9.6, 6, 0.4);
      b.prop('pallet', 6, -11, 1.2);
      b.wreck('semi_truck', 20, 6, 0.04, { trunk: false, seed: 1 });
      b.wreck('dump_truck', 12, 19, 1.5, { trunk: false });
      b.room(19, -16, 7, 5, 2.8, 'tin', { w: [door(2.5, 1.2)], n: [win(3.5, 1.4)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'planks' });
      b.cont(CONT.LOCKER, 22.06, -15, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
      b.cont(CONT.CABINET, 19, -13.96, { prop: 'cabinet', ry: PI, ly: 0.12 });
      b.cont(CONT.TOOLBOX, 17, -17.4, { prop: 'toolbox', ry: 0.3, nocollide: true, ly: 0.12 });
      b.prop('streetlight', 5, -21, PI);
      b.prop('barrel', 14.5, -5, 0);
      b.light(14.5, 1.0, -5, 'embers');
      b.prop('corpse', 9, -3, 1, { nocollide: true });
      b.loot(10, 11);
      b.loot(15, -9);
      b.loot(2, 21);
    },
  },

  // ---- the third pass: more of what lies about. Each of these is built with the city's kit as well (K.block,
  // K.groundRoom, K.signAt, K.extra, K.heap, K.weed: shared/mainland.js, "What the city is drawn from").

  // CALDER BOAT WORKS: on the river's far bank, across from the city (its +Z is the water): a boathouse, a slip
  // down into the river, hulls on the hard, one still afloat.
  [ZONE.BOATWORKS]: {
    flat: 20,
    clear: 22,
    dirt: 0.5,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win, gap, afloat } = K;
      K.groundRoom(b, -7, 2, 9, 12, 4.6, 'tin', { s: [gap(4.5, 5.4, 3.8)], n: [door(2, 1.2)], e: [win(6, 1.6)] }, { roof: 'gable', roofH: 2.4, roofMat: 'tin', floorMat: 'planks', plain: true });
      b.prop('boat', -7, 3, PI, { ly: 0.12, seed: 1 });
      b.cont(CONT.TOOLBOX, -10, -2.6, { prop: 'toolbox', ry: 0.4, nocollide: true, ly: 0.12 });
      b.cont(CONT.SHELF, -10.9, 5, { prop: 'shelf', ry: PI / 2, ly: 0.12 });
      b.loot(-4.6, -2, 0.14);
      // the slip: timbers down the bank into the water, a hull half way down them
      b.box(5, -0.6, 15, 3.4, 0.2, 13, 'dockwood', { rx: 0.12, collide: false });
      for (const dx of [-1.4, 1.4]) b.box(5 + dx, -0.5, 15, 0.2, 0.25, 13.4, 'rust', { rx: 0.12, collide: false });
      afloat(b.prop('boat', 5, 23.5, 0.1, { ground: true, nocollide: true, seed: 0 }));
      b.prop('boat', 9.4, -3, 1.3, { seed: 1 });
      b.prop('boat', 3, -8, -0.4, { seed: 0 });
      K.extra(b, 'van_wreck', -3, -13, 1.2);
      b.cont(CONT.CRATE, 12, 4, { prop: 'crate', ry: 0.3 });
      b.prop('barrel', 11.4, 6.2, 0);
      b.prop('barrel', 12.6, 6.6, 0, { seed: 1 });
      b.prop('tire_pile', -13, -9, 0);
      b.cont(CONT.DUFFEL, 0.6, -3.4, { prop: 'duffel_bag', ry: 1, nocollide: true });
      b.prop('skeleton', 7.4, 4, 2, { nocollide: true, seed: 2 });
      b.loot(8, -8);
      b.loot(-12, 8.6);
      for (const [x, z] of [[14, -6], [-14, 3], [1, 9], [10, 10]]) K.weed(b, x, z, 1.1);
      for (const dq of [-0.9, 0.9]) b.cyl(-2 + dq, 0, -17, 0.06, 2.6, 'rust', { sides: 6 });
      K.signAt(b, -2, 2.1, -17.07, 0, 2.2, 0.55, 'shop_hardware', { back: 0.05 });
    },
  },

  // THE CALDER DRIVE-IN: the screen, torn, on its frame; rows of cars that came to watch something; the booth.
  [ZONE.DRIVEIN_M]: {
    flat: 38,
    clear: 40,
    dirt: 0.55,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win, rng } = K;
      // the screen, at the back, facing the gate
      for (const px of [-9, -3, 3, 9]) {
        b.box(px, 0, 31, 0.4, 14, 0.4, 'rust');
        b.box(px, 0, 33.4, 0.3, 9, 0.3, 'rust', { rx: -0.26, collide: false });
      }
      b.box(-4, 5, 30.7, 12, 8.6, 0.16, 'clapboard', { collide: false });
      b.box(6.6, 7.4, 30.7, 6, 5.6, 0.16, 'clapboard', { collide: false });
      b.box(7.4, 3.4, 30.2, 5, 3.2, 0.1, 'clapboard', { rz: 0.4, rx: 0.3, collide: false }); // (a sheet of it hanging)
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 7; c++) {
          const here = rng.chance(0.56);
          const t = rng();
          const turn = rng.range(-0.12, 0.12);
          if (!here) continue;
          K.extra(b, t < 0.4 ? 'car_wreck' : t < 0.62 ? 'car_open' : t < 0.82 ? 'car_burnt' : 'pickup_truck', -19.5 + c * 6.5, 20 - r * 8.4, PI + turn);
        }
        for (let c = 0; c < 8; c++) b.cyl(-22.8 + c * 6.5, 0, 17.4 - r * 8.4, 0.05, 1.3, 'rust', { sides: 5 }); // the speaker posts
      }
      // the booth: projection upstairs, the counter under it
      const R = K.groundRoom(b, 0, -20, 9, 6, 3, 'brick', { s: [door(2, 1.2), win(6, 3, 1, 2.2)], n: [door(7, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true });
      void R;
      K.block(b, 0, -20, 5, 4, 3.3, 1, 2.8, 'walkup', 'brick', { wear: 0.9 });
      b.prop('checkout_counter', -1.4, -19.6, PI, { ly: 0.12 });
      b.loot(-1.4, -19.6, 1.1);
      b.cont(CONT.FRIDGE, -3.9, -21.6, { prop: 'fridge', ry: PI / 2, ly: 0.12 });
      b.cont(CONT.SHELF, 0, -22.6, { prop: 'shelf', ry: PI, ly: 0.12 });
      b.prop('stock_spill', 0.6, -21, 1, { nocollide: true, ly: 0.12 });
      b.cont(CONT.DUFFEL, 12, -14, { prop: 'duffel_bag', ry: 0.4, nocollide: true });
      b.cont(CONT.DUMPSTER, 7.4, -21, { prop: 'dumpster', ry: -PI / 2 });
      for (const [x, z] of [[-20, 8], [14, -2], [-6, 12], [22, 16], [-14, -12], [4, 2]]) b.prop(['skeleton', 'litter', 'corpse', 'suitcases', 'bones', 'litter'][((x + 20) / 7) | 0], x, z, x, { nocollide: true, seed: z & 1 });
      b.loot(-16, -2);
      b.loot(18, 6);
      b.loot(8, -14);
      // its board at the gate, what was showing
      for (const dq of [-2.2, 2.2]) b.cyl(-9 + dq, 0, -33, 0.09, 5.4, 'rust', { sides: 6 });
      K.signAt(b, -9, 4.4, -33.1, 0, 6, 1.5, 'marquee', { far: true, back: 0.12 });
      for (let k = 0; k < 14; k++) K.weed(b, rng.range(-28, 28), rng.range(-26, 26), rng.range(0.7, 1.3));
    },
  },

  // ENGINE COMPANY 9: a fire station out on the county road - two bays, a tender in one, the hose tower
  [ZONE.FIREHOUSE]: {
    flat: 24,
    clear: 26,
    dirt: 0.3,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { door, win, gap, hole } = K;
      const R = K.groundRoom(b, 0, 4, 18, 13, 5, 'brick', { n: [gap(4.6, 4.6, 4.2), gap(10.6, 4.6, 4.2), door(15.6, 1.2)], s: [door(15, 1.1), win(5, 2), win(10, 2)], w: [win(6.5, 1.6)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', plain: true });
      K.partition(b, R, 4.4, -2.5, 4.4, 10.5, 5, 'brick', [door(8, 1.3)]);
      K.block(b, 0, 4, 18, 13, 5.3, 1, 3, 'walkup', 'brick', { lost: 0, wear: 0.6 });
      K.block(b, 6.8, 8.3, 4, 4, 5.3 + 3, 3, 3, 'walkup', 'brick', { wear: 0.5, blank: 10 }); // the hose tower, on its roof
      b.wreck('fire_truck', -4.4, 4.6, 0.02, { ly: 0.12, trunk: false });
      b.wreck('fire_truck', 1.6, -12, 0.5, { trunk: false });
      for (const dz of [0, 1.1, 2.2]) b.cont(CONT.LOCKER, 8.56, 6 + dz * 1.0, { prop: 'locker', ry: -PI / 2, ly: 0.12, seed: dz | 0 });
      b.cont(CONT.CABINET, 6.4, 9.9, { prop: 'cabinet', ry: PI, ly: 0.12 });
      b.cont(CONT.MEDICINE, 5.2, -1.2, { prop: 'medicine_cabinet', ry: PI / 2, ly: 0.12 });
      b.prop('table', 6.8, 2, 0.1, { ly: 0.12 });
      b.loot(6.8, 2, 0.94);
      b.loot(-1.4, 8, 0.14);
      b.prop('tire_pile', -8, 9, 0, { ly: 0.12 });
      b.cont(CONT.DUMPSTER, -11.4, 2, { prop: 'dumpster', ry: PI / 2 });
      b.prop('generator', 11.2, -2.6, 0);
      K.extra(b, 'car_open', -9, -13, 2.2, { seed: 2 });
      b.prop('skeleton', -2, -6, 1, { nocollide: true, seed: 2 });
      b.prop('blood_pool', -3, -7, 0, { nocollide: true });
      b.loot(8, -10);
      K.signAt(b, -4.4, 5.6, -2.66, 0, 1.6, 1.6, 'redcross', { far: true });
      void hole;
    },
  },

  // HALVORSEN GRAIN: four bins and the leg that filled them, a scale house, a truck under the spout
  [ZONE.GRAIN]: {
    flat: 26,
    clear: 28,
    dirt: 0.6,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win } = K;
      for (const [x, z] of [[-9, 8], [-1.8, 8], [5.4, 8], [12.6, 8]]) {
        b.cyl(x, 0, z, 3.4, 13, 'tin_rust', { sides: 14 });
        b.cone(x, 13, z, 3.6, 2.4, 'tin', 14, { ry: 0 });
        K.signAt(b, x, 7, z - 3.46, 0, 1, 5, x & 1 ? 'rust_a' : 'rust_b', { grime: true, far: true });
      }
      // the leg: a shaft up past the bins, the spouts down from its head to each
      b.box(-14.6, 0, 8, 2.2, 19, 2.2, 'tin_rust');
      b.box(-14.6, 19, 8, 3, 2.4, 3, 'tin', { collide: false });
      for (const x of [-9, -1.8, 5.4, 12.6]) b.box((x - 14.6) / 2, 17.2, 8, Math.hypot(x + 14.6, 4) + 0.4, 0.4, 0.4, 'rust', { rz: -Math.atan2(4.6, x + 14.6), collide: false });
      b.box(0, 15.5, 8, 26, 0.3, 1.2, 'rust', { collide: false }); // the catwalk over them
      const R = K.groundRoom(b, 12, -9, 7, 5, 2.8, 'clapboard', { n: [door(2, 1.1), win(5, 1.4)], w: [win(2.5, 1.2)] }, { roof: 'flat', roofMat: 'tin' });
      void R;
      b.cont(CONT.CABINET, 14, -7.2, { prop: 'cabinet', ry: PI, ly: 0.12 });
      b.prop('table', 10.6, -8.4, 0, { ly: 0.12 });
      b.loot(10.6, -8.4, 0.94);
      b.wreck('dump_truck', -4, -3, 1.5, { trunk: false });
      b.wreck('pickup_truck', -15, -10, 0.3);
      b.cont(CONT.CRATE, 3, -12, { prop: 'crate', ry: 0.2 });
      b.cont(CONT.TOOLBOX, 0.6, 1.4, { prop: 'toolbox', ry: 0.5, nocollide: true });
      b.prop('pallet', 5.4, -11, 0.4);
      b.prop('hay_round', -19, 0, 0.3);
      b.prop('hay_round', -18, -3.4, 1);
      b.prop('corpse', 2, -4, 1, { nocollide: true });
      b.loot(-10, -6);
      b.loot(17, 2);
      for (const [x, z] of [[-20, 12], [18, 14], [0, -16], [-8, 14.6]]) K.weed(b, x, z, 1.2);
    },
  },

  // MILE 4 DINER: chrome and a sign on a pole, on the road in from the bridge
  [ZONE.DINER_M]: {
    flat: 18,
    clear: 20,
    dirt: 0.3,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { door, win, hole } = K;
      const R = K.groundRoom(b, 0, 4, 15, 8, 3.2, 'tin', { n: [door(7.5, 1.4), hole(2.6, 3, 0.9, 2.4), win(12.4, 3, 0.9, 2.4)], s: [door(13, 1.1)], e: [win(4, 2.4, 0.9, 2.4)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete', lino: true, tint: 4, sign: 'shop_diner' });
      void R;
      b.box(0, 0.12, 5.6, 9, 1.05, 0.7, 'planks'); // the counter
      b.box(0, 1.17, 5.6, 9.1, 0.05, 0.86, 'metal', { collide: false });
      b.loot(-3, 5.6, 1.24);
      for (const x of [-3.6, -2.2, -0.8, 0.6, 2, 3.4]) b.prop('chair', x, 4.6, PI + (x & 1 ? 0.3 : -0.2), { nocollide: true, ly: 0.12, seed: x & 3 });
      for (const x of [-5.6, -1.9, 1.9, 5.6]) b.prop('table', x, 1.4, 0, { ly: 0.12, seed: x & 1 });
      b.cont(CONT.FRIDGE, -6.9, 7.2, { prop: 'fridge', ry: PI / 2, ly: 0.12 });
      b.cont(CONT.CABINET, 3.4, 7.4, { prop: 'cabinet', ry: PI, ly: 0.12 });
      K.extra(b, 'stove', 0.6, 7.36, PI, { ly: 0.12 });
      b.loot(5.6, 1.4, 0.94);
      b.prop('stock_spill', -4, 2.8, 1, { nocollide: true, ly: 0.12 });
      b.prop('blood_pool', 2, 3, 0, { nocollide: true, ly: 0.12, seed: 1 });
      for (const lx of [-4, 3]) b.prop('ceiling_lamp', lx, 3.6, 0, { nocollide: true, ly: 3.2, seed: lx & 1 });
      K.extra(b, 'car_open', -5, -9, 0.3, { seed: 0 });
      K.extra(b, 'pickup_truck', 3, -10, -0.2);
      K.extra(b, 'box_truck', 12.6, -6, 0.1);
      b.cont(CONT.DUMPSTER, -10.4, 6, { prop: 'dumpster', ry: PI / 2 });
      b.prop('skeleton', 6, -4, 2, { nocollide: true });
      b.cyl(-11, 0, -12, 0.12, 6.2, 'rust', { sides: 6 });
      K.signAt(b, -11, 5.4, -12.14, 0.2, 3.6, 0.9, 'shop_diner', { far: true, back: 0.16, two: true });
      b.loot(-8, -4);
    },
  },

  // HONEST AL'S: a used-car lot. The cars are still for sale.
  [ZONE.CARLOT]: {
    flat: 24,
    clear: 26,
    dirt: 0.4,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { door, win, rng } = K;
      b.box(0, -0.05, 0, 40, 0.1, 34, 'concrete', { collide: true });
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 8; c++) {
          const here = rng.chance(0.7);
          const t = rng();
          const turn = rng.range(-0.08, 0.08);
          if (!here || (r === 2 && c > 5)) continue;
          K.extra(b, t < 0.5 ? 'car_wreck' : t < 0.75 ? 'car_open' : t < 0.9 ? 'pickup_truck' : 'car_burnt', -15.4 + c * 4.2, -9 + r * 8.4, turn, { ly: 0.05 });
        }
      }
      const R = K.groundRoom(b, 14, 12, 8, 6, 3, 'clapboard', { n: [door(2, 1.2), win(5.6, 3, 0.9, 2.3)], w: [win(3, 1.6)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete', lino: true });
      void R;
      K.extra(b, 'office_desk', 15.4, 13, PI, { ly: 0.12 });
      b.cont(CONT.CABINET, 12, 14.4, { prop: 'cabinet', ry: PI, ly: 0.12 });
      b.cont(CONT.STRONGBOX, 17.2, 14.2, { prop: 'strongbox', ry: -PI / 2, ly: 0.12 });
      b.loot(13, 11.4, 0.14);
      b.prop('paper_scatter', 14, 11.6, 1, { nocollide: true, ly: 0.12 });
      // bunting on its poles, what is left of it; the board on the road
      for (const px of [-19, -6.4, 6.4, 19]) b.cyl(px, 0, -15.6, 0.05, 4.4, 'rust', { sides: 5 });
      for (const [x0, x1] of [[-19, -6.4], [-6.4, 6.4]]) b.box((x0 + x1) / 2, 4.1, -15.6, x1 - x0, 0.03, 0.03, 'rust', { collide: false });
      for (const dq of [-2, 2]) b.cyl(12 + dq, 0, -15.6, 0.09, 6.2, 'rust', { sides: 6 });
      K.signAt(b, 12, 5, -15.72, 0, 5.4, 2.6, 'billboard_a', { far: true, back: 0.12 });
      b.prop('tire_pile', 18, 4, 0, { ly: 0.05 });
      b.cont(CONT.TOOLBOX, 9, 6, { prop: 'toolbox', ry: 0.6, nocollide: true, ly: 0.05 });
      b.prop('corpse', 4, 12, 2, { nocollide: true, ly: 0.05 });
      b.loot(-12, 13.5, 0.07);
      b.loot(2, -14, 0.07);
    },
  },

  // U-STORE CALDER: rows of lock-ups, half of them broken into
  [ZONE.STORAGE]: {
    flat: 30,
    clear: 32,
    dirt: 0.3,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { gap, door, win, rng } = K;
      fenced(b, 21, 19, 3.6);
      let n = 0;
      for (const z of [-9, 1.4, 11.8]) {
        // a row: six units behind roll-up doors, the open ones with what was kept in them
        const doors = [];
        for (let k = 0; k < 6; k++) if (rng.chance(0.62)) doors.push(gap(2.25 + k * 4.5, 2.7, 2.3));
        b.room(0, z, 27, 4.6, 2.8, 'tin', { n: doors }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete' });
        for (let k = 1; k < 6; k++) b.wall(-13.5 + k * 4.5, z - 2.3, -13.5 + k * 4.5, z + 2.3, 2.8, 0.12, 'tin');
        for (const d of doors) {
          const x = -13.5 + d.at;
          const what = n++ % 5;
          if (what === 0) b.cont(CONT.CRATE, x - 0.6, z + 1.2, { prop: 'crate', ry: 0.2, ly: 0.12 });
          else if (what === 1) b.cont(CONT.LOCKER, x + 1.0, z + 1.74, { prop: 'locker', ry: PI, ly: 0.12 });
          else if (what === 2) b.cont(CONT.CABINET, x - 0.9, z + 1.7, { prop: 'cabinet', ry: PI, ly: 0.12 });
          else if (what === 3) b.loot(x, z + 0.6, 0.14);
          else b.cont(CONT.DUFFEL, x + 0.4, z + 0.8, { prop: 'duffel_bag', ry: 1, nocollide: true, ly: 0.12 });
          b.prop(['suitcases', 'stock_spill', 'paper_scatter', 'litter'][n & 3], x + 0.2, z - 0.9, n, { nocollide: true, ly: 0.12, seed: n & 1 });
        }
      }
      const R = K.groundRoom(b, -15.5, -15, 6, 4.4, 2.8, 'brick', { e: [door(2.2, 1.1)], n: [win(3, 1.6)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true });
      void R;
      b.cont(CONT.STRONGBOX, -17.6, -14, { prop: 'strongbox', ry: PI / 2, ly: 0.12 });
      b.loot(-15, -15.6, 0.14);
      K.extra(b, 'box_truck', 12, -14.4, 1.5);
      K.extra(b, 'car_open', -6, -15.4, 1.7, { seed: 3 });
      b.prop('skeleton', 6, -4.6, 1, { nocollide: true, seed: 0 });
      b.prop('corpse', -6, 6.4, 2, { nocollide: true });
      b.loot(16, 16);
      void door;
      void win;
    },
  },

  // EVACUATION POINT BRAVO: where the buses were to take them from. The buses are still here.
  [ZONE.EVAC]: {
    flat: 38,
    clear: 40,
    dirt: 0.6,
    road: ROAD.ASPHALT,
    build(b, K) {
      const { rng } = K;
      fenced(b, 27, 25, 5);
      for (const [x, z, r, t] of [[-19, 6, 0.04, 'city_bus'], [-14.6, 7, -0.03, 'city_bus'], [-10.2, 5.4, 0.02, 'school_bus'], [-5.8, 6.6, 0.05, 'city_bus'], [18, -6, 1.3, 'school_bus']]) K.extra(b, t, x, z, r, { seed: x & 1 });
      for (const [x, z, sd] of [[8, 12, 0], [14.4, 13, 1], [20.6, 12.4, 0]]) {
        b.prop('triage_tent', x, z, 0.03 * sd, { seed: sd });
        b.prop('field_cot', x - 1.2, z - 1.4, 0, { seed: sd + 1 });
        b.prop('field_cot', x + 1.2, z + 1.2, PI, { seed: sd });
      }
      K.extra(b, 'army_truck', 4, -14, 1.4);
      K.extra(b, 'army_truck', 13, -17, 1.7, { seed: 1 });
      K.extra(b, 'sandbag_nest', -6, -21.4, 0);
      K.extra(b, 'sandbag_nest', 7, -21.4, 0, { seed: 1 });
      K.extra(b, 'floodlight_tower', -23, -20, 0.6);
      K.extra(b, 'floodlight_tower', 23, 20, 3.6);
      K.extra(b, 'checkpoint_sign', 2.6, -27.4, 0);
      b.cont(CONT.AMMO_BOX, -2.4, -18, { prop: 'military_crate', ry: 0.3 });
      b.cont(CONT.CRATE, 22, -2, { prop: 'crate', ry: 0.2 });
      b.cont(CONT.MEDICINE, 11.4, 18.6, { prop: 'medicine_cabinet', ry: PI });
      b.cont(CONT.DUFFEL, -12, -6, { prop: 'duffel_bag', ry: 0.6, nocollide: true });
      // what they were told to leave: a heap of it by the gate; and those who did not get on
      for (let k = 0; k < 16; k++) b.prop(['suitcases', 'suitcases', 'stroller', 'suitcases', 'litter', 'paper_scatter'][k % 6], rng.range(-8, 2), rng.range(-12, -4), rng.range(0, 6), { nocollide: true, seed: k & 1 });
      for (let i = 0; i < 9; i++) b.prop('body_bag', -22 + i * 1.3, -8, PI / 2 + 0.06 * i, { nocollide: true, seed: i });
      for (let k = 0; k < 9; k++) b.prop(['skeleton', 'corpse', 'blood_pool'][k % 3], rng.range(-22, 22), rng.range(-16, 20), rng.range(0, 6), { nocollide: true, seed: k });
      for (const dq of [-1.1, 1.1]) b.cyl(-9 + dq, 0, -26.4, 0.06, 3.2, 'rust', { sides: 6 });
      K.signAt(b, -9, 2.5, -26.48, 0, 2.6, 1.3, 'evac', { far: true, back: 0.05 });
      b.loot(0, 2);
      b.loot(16, 4);
      b.loot(-20, 16);
    },
  },

  // GREENACRE NURSERY: glasshouses with the glass out of them, what was grown in them grown through the roof
  [ZONE.NURSERY]: {
    flat: 24,
    clear: 26,
    dirt: 0.5,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win, rng } = K;
      for (const hx of [-12, 0, 12]) {
        // a glasshouse: hoops of steel, a few panes left in them, benches down both sides
        for (let z = -4; z <= 14; z += 3) {
          for (const sx of [-1, 1]) b.box(hx + sx * 4, 0, z, 0.08, 2.4, 0.08, 'rust', { collide: false });
          b.box(hx - 2, 2.4, z, 4.3, 0.08, 0.08, 'rust', { rz: 0.42, collide: false });
          b.box(hx + 2, 2.4, z, 4.3, 0.08, 0.08, 'rust', { rz: -0.42, collide: false });
          for (const sx of [-1, 1]) if (z < 14 && rng.chance(0.4)) b.box(hx + sx * 4, 0.9, z + 1.5, 2.9, 1.4, 0.04, 'glass', { ry: PI / 2, collide: false });
        }
        b.box(hx, 3.26, 5, 0.1, 0.1, 18.4, 'rust', { collide: false });
        for (const sx of [-1, 1]) b.box(hx + sx * 2.6, 0, 5, 1.2, 0.8, 16, 'planks');
        for (let k = 0; k < 6; k++) K.weed(b, hx + rng.range(-3.4, 3.4), rng.range(-3, 13), rng.range(0.9, 1.6));
        b.tree(hx + rng.range(-0.6, 0.6), rng.range(2, 9), 5, rng.range(0.5, 0.8));
      }
      const R = K.groundRoom(b, -14, -12, 9, 6, 3, 'clapboard', { n: [door(4.5, 1.3), win(1.8, 1.6), win(7.2, 1.6)], e: [door(3, 1.1)] }, { roof: 'gable', roofH: 2, roofMat: 'shingles', floorMat: 'planks' });
      void R;
      b.prop('checkout_counter', -15, -11, 0, { ly: 0.12 });
      b.loot(-15, -11, 1.1);
      b.cont(CONT.SHELF, -16, -9.4, { prop: 'shelf', ry: PI, ly: 0.12 });
      b.cont(CONT.TOOLBOX, -11, -13.6, { prop: 'toolbox', ry: 0.3, nocollide: true, ly: 0.12 });
      b.cont(CONT.CRATE, 4, -12, { prop: 'crate', ry: 0.3 });
      K.extra(b, 'pickup_truck', 10, -13, 1.3);
      b.prop('pallet', 0, -9.4, 0.2);
      b.prop('barrel', 2, -9.6, 0);
      b.prop('skeleton', -4, -5, 0, { nocollide: true, seed: 2 });
      b.loot(12, 12, 0.02);
      b.loot(0, 12.4, 0.02);
    },
  },

  // THE GUARD MOTOR POOL: the trucks they did not take, a carrier with its wheels off, the watch tower
  [ZONE.MOTORPOOL]: {
    flat: 35,
    clear: 37,
    dirt: 0.7,
    road: ROAD.ASPHALT,
    build(b, K) {
      fenced(b, 25, 23, 4.6);
      b.shelter(-10, 10, 18, 10, 4.6, 'tin', 'metal');
      K.extra(b, 'army_truck', -15, 10, 0.02);
      K.extra(b, 'apc_wreck', -8.6, 10.4, 0.04);
      b.cont(CONT.TOOLBOX, -4, 7, { prop: 'toolbox', ry: 0.4, nocollide: true });
      b.prop('tire_pile', -3.4, 13.4, 0);
      for (const [x, z, r, sd] of [[6, 14, 0.1, 1], [10.6, 13.4, -0.06, 0], [15.4, 14.2, 0.04, 1]]) K.extra(b, 'army_truck', x, z, r, { seed: sd });
      K.extra(b, 'apc_wreck', 16, -10, 1.2);
      b.prop('military_tent', -17, -10, PI / 2, { seed: 1 });
      b.prop('military_tent', -17, -16.6, PI / 2, { seed: 0 });
      b.prop('watchtower', 20.4, 18, 0);
      b.prop('fuel_tank', 4, -17.6, PI / 2);
      for (const [x, z, sd] of [[-6, -14, 0], [-3, -15, 1], [-8.4, -17.6, 2]]) b.cont(CONT.AMMO_BOX, x, z, { prop: 'military_crate', ry: 0.2 * sd, seed: sd });
      b.cont(CONT.LOCKER, -19.2, -4, { prop: 'locker', ry: PI / 2 });
      K.extra(b, 'sandbag_nest', -8, -20.4, 0);
      K.extra(b, 'sandbag_nest', 9, -20.4, 0, { seed: 1 });
      K.extra(b, 'concertina', 14, -25.4, 0.05);
      K.extra(b, 'floodlight_tower', 22, -19, 2.2);
      for (const [x, z] of [[0, -8], [8, 2], [-12, -2], [12, -2], [-2, 18]]) b.prop(['skeleton', 'corpse', 'blood_pool', 'body_bag', 'bones'][((x + 12) / 5) | 0], x, z, x, { nocollide: true, seed: z & 1 });
      b.prop('barrel', 0.6, 4, 0);
      b.light(0.6, 1, 4, 'embers');
      b.loot(-12, 4);
      b.loot(12, 6);
      b.loot(2, -12);
    },
  },

  // LANDING ZONE KILO: a pad the army poured in a field, and the last helicopter that came to it
  [ZONE.HELIPAD]: {
    flat: 22,
    clear: 26,
    dirt: 0.5,
    road: ROAD.DIRT,
    build(b, K) {
      b.box(0, -0.05, 4, 20, 0.1, 20, 'concrete', { collide: true });
      for (const [x, z, w, d] of [[-2.4, 4, 0.8, 7], [2.4, 4, 0.8, 7], [0, 4, 4.8, 0.8]]) b.box(x, 0.05, z, w, 0.02, d, 'trim', { collide: false });
      for (const [x, z, w, d] of [[0, -5.4, 19, 0.4], [0, 13.4, 19, 0.4], [-9.4, 4, 0.4, 19], [9.4, 4, 0.4, 19]]) b.box(x, 0.05, z, w, 0.02, d, 'trim', { collide: false });
      b.prop('heli_wreck', 1, 5, 0.6, { ly: 0.05 });
      b.prop('military_tent', -15, -4, PI / 2, { seed: 1 });
      K.extra(b, 'triage_tent', 15, -8, 0);
      K.extra(b, 'field_cot', 14, -9, 0, { seed: 1 });
      K.extra(b, 'field_cot', 16.2, -6.6, PI, { seed: 2 });
      K.extra(b, 'floodlight_tower', -12, 15, 0.6);
      K.extra(b, 'floodlight_tower', 12.6, 16, 2.6);
      K.extra(b, 'army_truck', -4, -14, 1.5);
      K.extra(b, 'sandbag_nest', 6, -17, 0);
      b.cont(CONT.AMMO_BOX, -13, 4, { prop: 'military_crate', ry: 0.3 });
      b.cont(CONT.AMMO_BOX, -12, 6.4, { prop: 'military_crate', ry: 1.1, seed: 1 });
      b.cont(CONT.MEDICINE, 13, -11.6, { prop: 'medicine_cabinet', ry: 0 });
      b.cont(CONT.DUFFEL, 5, -8, { prop: 'duffel_bag', ry: 0.4, nocollide: true });
      b.prop('windsock', -16, 14, 0.3);
      for (let i = 0; i < 6; i++) b.prop('body_bag', -8 + i * 1.3, -9.4, PI / 2 + 0.05 * i, { nocollide: true, seed: i });
      for (const [x, z] of [[4, -4], [-6, 0], [9, 9], [-3, 12]]) b.prop(['skeleton', 'blood_pool', 'corpse', 'suitcases'][((x + 6) / 4) | 0], x, z, x, { nocollide: true, ly: 0.05 });
      b.loot(-14, -9);
      b.loot(8, -12);
    },
  },

  // CALDER AGGREGATES: heaps of stone, the hopper they were loaded from, two trucks that never were
  [ZONE.AGGREGATES]: {
    flat: 28,
    clear: 30,
    dirt: 0.9,
    road: ROAD.DIRT,
    build(b, K) {
      const { door, win } = K;
      for (const [x, z, sd] of [[-14, 12, 0], [-4, 16, 1], [8, 14, 0], [17, 6, 1]]) b.prop('gravel_pile', x, z, sd, { seed: sd });
      // the hopper, on its legs, a belt up to it from the ground
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(-12 + sx * 2, 0, -6 + sz * 2, 0.4, 6, 0.4, 'rust');
      b.box(-12, 6, -6, 5, 3.4, 5, 'tin_rust', { collide: false });
      b.box(-12, 4.4, -6, 2, 1.6, 2, 'rust', { collide: false });
      b.box(-3.4, 4.2, -6, 15, 0.5, 1.2, 'rust', { rz: 0.5, collide: false });
      for (const dx of [-7.4, 0.6]) b.box(dx, 0, -6, 0.3, dx < 0 ? 5.4 : 1.4, 0.3, 'rust');
      const R = K.groundRoom(b, 12, -10, 8, 3.4, 2.6, 'tin', { n: [door(2, 1.1), win(5.6, 1.6)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'planks' });
      void R;
      K.extra(b, 'office_desk', 13.6, -9.6, PI, { ly: 0.12 });
      b.cont(CONT.LOCKER, 15.56, -10, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
      b.loot(10, -10, 0.14);
      b.wreck('dump_truck', -12, -6.2, 0.02, { trunk: false });
      b.wreck('dump_truck', 2, 4, 2.2, { trunk: false, seed: 1 });
      b.prop('fuel_tank', 20, -8, 0);
      b.cont(CONT.TOOLBOX, 4, -6, { prop: 'toolbox', ry: 0.2, nocollide: true });
      b.cont(CONT.CRATE, 18.6, -14, { prop: 'crate', ry: 0.4 });
      b.prop('tire_pile', -19, -12, 0);
      b.prop('corpse', 6, -2, 1, { nocollide: true });
      b.loot(-6, 6);
      b.loot(12, 2);
    },
  },
};

// EASTGATE is the city's old suburb (shared/mainland.js places it): the same street of houses
export const SUBURB = { build: (b, K) => houses(b, K, 0) };
