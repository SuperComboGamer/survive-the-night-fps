// Mercy Clinic (ZONE.CLINIC): one building in three parts. At the front, reception and the pharmacy, with windows
// and daylight. Behind them a passage, and at the end of it the ward wing, its windows boarded over when the wards
// were sealed: the one place on the surface where it is dark at noon.
//
// The dark is the mine's rule (docs/ARCHITECTURE.md, "The mine"), cut down to what a building needs. A dark interior
// is a box with a mouth, the doorway the day comes in by; world.darkAt(x, y, z) says how dark it is at a point:
// 0 in daylight, rising over a few metres in from the mouth to 1. The server asks it where a Shade stands (no
// daylight pins it in there) and where the horde is at sunrise (the sun burns nothing in there); the client asks it
// where the eye is (the sky's light goes out as the eye goes in) and at every vertex of the lining (below).
//
// The shell of the wing, its walls and roof, is static world like any building. What is seen from inside is the
// lining (clinic.lining: floor, ceiling, the inner face of every wall, the partitions between the wards): boxes
// that are kept out of world.parts and drawn by client/render/clinic.js with the material of the mine's rock, which
// takes only as much of the day as reaches each vertex. So the passage falls away into black as seen from reception.
import { CONT } from './defs.js';
import { mulberry32, smoothstep } from './rng.js';

const PI = Math.PI;
const H = 3.4; // eaves of the front block and of the ward wing
const LINK_H = 2.8; // ...and of the passage between them, its flat roof under their eaves
const FLOOR = 0.12; // top of every floor in it
const WALL = 0.125; // half the thickness of an outer wall
const SKIN = 0.09; // the lining on the inside of an outer wall: thick enough to bury the sills of the boarded windows
const CEIL = 0.03; // ...and under a roof
// Every doorway in it is this wide. The dead find their way by a 1 m grid (server/nav.js), and the place is turned to
// face its road: through a narrower doorway in a wall that runs askew to the grid there is, one map in ten, no step
// from a cell on one side to a cell on the other, and the wards behind it are closed to the horde
const DOOR = 1.6;
// the day reaches FADE[0] m in from the mouth undimmed and is gone FADE[1] m from it (the passage is 6 m long)
const FADE = [1, 6.5];

// How dark it is at (x, y, z) among the dark interiors `darks`: 0 in daylight .. 1 where none of it gets.
// (measured on the flat from the mouth, so a wall is as dark at the top as at the bottom)
export function darkAt(darks, x, y, z) {
  let dark = 0;
  for (let i = 0; i < darks.length; i++) {
    const v = darks[i];
    if (y < v.y0 || y > v.y1) continue;
    const dx = x - v.x;
    const dz = z - v.z;
    if (Math.abs(v.c * dx - v.s * dz) > v.hx || Math.abs(v.s * dx + v.c * dz) > v.hz) continue;
    const k = smoothstep(v.near, v.far, Math.hypot(x - v.mx, z - v.mz));
    if (k > dark) dark = k;
  }
  return dark;
}

// b: world.js's Builder in the place's frame (front: -Z, the road). parts: the static world's parts, which the
// lining is taken back out of. darks: the world's dark interiors, which the passage and the wing are added to.
// Everything random in it comes from the clinic's own stream, and every prop is given its seed: building it draws
// nothing from the valley's.
// Returns the clinic: { x, y, z, ry, door, ward, home, dens, roam, lining, signs } (see the end)
export function buildClinic(b, { seed, parts, darks }) {
  const rng = mulberry32(seed ^ 0xc11a1c);
  const sd = () => rng.int(0, 9999);
  const door = (at, w = DOOR) => ({ at, w, y0: 0, y1: 2.2 });
  const win = (at, w = 1.6) => ({ at, w, y0: 0.95, y1: 2.15, glass: true });
  const prop = (type, lx, lz, ry = 0, o = {}) => b.prop(type, lx, lz, ry, { seed: sd(), ...o });
  const cont = (ctype, lx, lz, o) => b.cont(ctype, lx, lz, { seed: sd(), ...o });

  // ---------------------------------------------------------------- outside: car park, ambulance, sign
  b.box(0, -0.05, -14, 26, 0.1, 16, 'concrete', { collide: true });
  // the ambulance never left: backed up towards the door, its rear compartment still worth a look
  {
    const p = prop('ambulance', -4.6, -10.4, 0.22);
    b.contAt(CONT.TRUNK, p.x + Math.sin(p.ry) * 3.15, p.y + 0.9, p.z + Math.cos(p.ry) * 3.15, p.ry, b.zone);
  }
  b.wreck('car_wreck', 9.2, -15.5, 1.25, { seed: sd() });
  b.wreck('car_wreck', -9.6, -18.2, -0.35, { seed: sd(), trunk: false });
  b.wreck('pickup_truck', 10.4, -8.6, PI + 0.12, { seed: sd() });
  prop('streetlight', -12, -21, PI / 2);
  prop('streetlight', 12, -21, -PI / 2);
  prop('wheelchair', 1.6, -6.6, 2.4);
  prop('body_bag', 5.6, -6.2, 1.3, { nocollide: true });
  prop('body_bag', 6.5, -6.6, 1.5, { nocollide: true });
  prop('body_bag', 7.5, -6.1, 1.2, { nocollide: true });
  prop('corpse', -1.2, -8.2, 0.7, { nocollide: true });
  prop('barrel', -8.2, -5, 0);
  b.loot(0.8, -9.4);
  // the sign at the head of the car park: two posts and a board (its faces are drawn by the client: signs)
  const signs = [];
  {
    const [sx, sz] = [-7.6, -22.8];
    for (const px of [-1.05, 1.05]) b.cyl(sx + px, 0, sz, 0.06, 2.55, 'metal', { sides: 6 });
    b.box(sx, 1.2, sz, 2.5, 1.3, 0.08, 'sash', { collide: false });
    for (const side of [-1, 1]) signs.push({ x: b.wx(sx, sz + side * 0.045), y: b.y0 + 1.85, z: b.wz(sx, sz + side * 0.045), ry: b.ry + (side < 0 ? PI : 0), w: 2.4, h: 1.2, kind: 0 });
    b.clear(sx, sz, 2.5);
  }

  // ---------------------------------------------------------------- the front block: pharmacy | reception
  // (x -9..9, z -4..4; the pharmacy is the west end, behind a partition. Pitched roofs here and on the wing: a flat one
  // is a floor to whatever the server puts down from above, and the guards of the place would stand on it)
  b.room(0, 0, 18, 8, H, 'clapboard', { n: [win(2), win(5.5), win(10), door(13), win(16)], s: [door(3), door(11.5)], w: [win(4)], e: [win(4)] }, { roof: 'gableZ', roofH: 2, roofMat: 'shingles', floorMat: 'concrete' });
  b.wall(-1, -4 + WALL, -1, 4 - WALL, H, 0.2, 'clapboard', [door(4.875)]);
  // a ceiling under the roof (a gable is drawn from outside only: without one the sky shows in at both ends)
  b.box(0, H - 0.06, 0, 18 - WALL * 2, 0.06, 8 - WALL * 2, 'sash', { collide: false });
  // the name over the door
  signs.push({ x: b.wx(4, -4.14), y: b.y0 + 2.76, z: b.wz(4, -4.14), ry: b.ry + PI, w: 3.4, h: 0.5, kind: 1 });
  // reception: the desk, a row of chairs under the window, what was left where it fell
  b.box(2.6, 0, 1.3, 3.4, 1.05, 0.7, 'planks');
  b.box(0.65, 0, 2.3, 0.5, 1.05, 2.7, 'planks');
  b.loot(2.6, 1.3, 1.07);
  cont(CONT.CABINET, 2.4, 3.5, { prop: 'cabinet', ry: 0 });
  prop('chair', 2.6, 2.4, 0.4);
  for (const cz of [-2.6, -1.8, 2.2]) prop('chair', 8.3, cz, PI / 2);
  prop('chair', 6.4, -0.4, 2.2);
  prop('wheelchair', 7.6, 0.6, -0.9);
  prop('corpse', 4.6, -1.4, 2.4, { nocollide: true });
  b.loot(7.4, 2.9);
  // the pharmacy: a counter across it, the medicine cabinets behind
  b.box(-6.2, 0, -0.5, 5.35, 1.05, 0.6, 'planks');
  b.loot(-5.4, -0.5, 1.07);
  cont(CONT.MEDICINE, -8.3, 3.63, { prop: 'medicine_cabinet', ry: 0, h: 1.1 });
  cont(CONT.MEDICINE, -7.3, 3.63, { prop: 'medicine_cabinet', ry: 0, h: 1.1 });
  cont(CONT.MEDICINE, -8.63, 1.9, { prop: 'medicine_cabinet', ry: -PI / 2, h: 1.1 });
  cont(CONT.SHELF, -1.42, -2.3, { prop: 'shelf', ry: PI / 2 });
  cont(CONT.SHELF, -5.2, 3.58, { prop: 'shelf', ry: 0 });
  b.partSpot(-4.4, 1.6);
  b.loot(-3, -2.6);
  // the yard between the two blocks, open to the west: the pharmacy's back door gives onto it
  cont(CONT.DUMPSTER, -5, 9.1, { prop: 'dumpster', ry: 0 });
  prop('generator', 1.6, 9.2, 0.1);
  prop('barrel', 3.5, 5.2, 0);
  prop('pallet', -7.6, 5.4, 0.3);
  b.loot(-1.5, 7);

  // ---------------------------------------------------------------- the passage (x 4.5..7.5, z 4..10)
  b.wall(4.5, 4 + WALL, 4.5, 10 - WALL, LINK_H, WALL * 2, 'clapboard');
  b.wall(7.5, 4 + WALL, 7.5, 10 - WALL, LINK_H, WALL * 2, 'clapboard');
  b.box(6, LINK_H, 7, 3.6, 0.3, 5.75, 'concrete');
  b.roofSpan(6, 7, 1.8, 2.9, LINK_H, 0.3);
  b.clear(6, 7, 5);

  // ---------------------------------------------------------------- the ward wing (x -9..9, z 10..22)
  // its shell, every window boarded: a sheet behind the glass, planks nailed across outside and in
  const boarded = [[5, 22, 0, 1], [-5, 22, 0, 1], [-9, 19.5, 1, -1], [-9, 14, 1, -1], [9, 14.5, 1, 1], [9, 19.5, 1, 1]]; // [x, z, in a wall that runs along z, outward]
  // (x, z) of a point d metres out from the middle of the wall at one of them
  const off = ([wx, wz, turned, out], d) => (turned ? [wx + d * out, wz] : [wx, wz + d * out]);
  b.room(0, 16, 18, 12, H, 'clapboard', { n: [door(15)], s: [win(4, 1.4), win(14, 1.4)], w: [win(2.5, 1.4), win(8, 1.4)], e: [win(4.5, 1.4), win(9.5, 1.4)] }, { roof: 'gableZ', roofH: 2.4, roofMat: 'shingles', floor: false });
  for (const w of boarded) {
    const ry = w[2] ? PI / 2 : 0;
    const [fx, fz] = off(w, -0.06);
    b.box(fx, 0.95, fz, 1.4, 1.2, 0.07, 'planks', { ry });
    const [px, pz] = off(w, 0.185);
    for (let k = 0; k < 3; k++) b.box(px, 1.02 + k * 0.4, pz, 1.95 + rng.range(-0.1, 0.15), 0.19, 0.04, 'planks', { ry, rz: rng.range(-0.09, 0.09), collide: false });
  }

  // ---- the lining: what the dark is drawn on (see the top of the file)
  const lining = [];
  const take = (n0) => lining.push(...parts.splice(n0));
  // one box of it, as Builder.box takes it. kind: wall / floor / ceil / board
  const line = (kind, lx, ly, lz, sx, sy, sz, o) => {
    const n0 = parts.length;
    b.box(lx, ly, lz, sx, sy, sz, kind, o);
    take(n0);
  };
  // a run of it, as Builder.wall takes it, standing on the floor
  const run = (x0, z0, x1, z1, top, t, ops) => {
    const n0 = parts.length;
    b.wall(x0, z0, x1, z1, top - FLOOR, t, 'wall', ops, FLOOR);
    take(n0);
  };
  // the opening of a doorway in the skin over a wall that has one (not at floor level: the wall's own is the doorway)
  const hole = (at) => ({ at, w: DOOR, y0: 0.001, y1: 2.2 - FLOOR });
  const K = SKIN / 2;
  const top = H - CEIL;
  const linkTop = LINK_H - CEIL;
  // inner faces of the outer walls: the passage's sides, the wing's sides, front and back
  const [LW, LE, WW, WE, WF, WB] = [4.5 + WALL, 7.5 - WALL, -9 + WALL, 9 - WALL, 10 + WALL, 22 - WALL];
  // floors (the passage's runs on under both its doorways) and ceilings
  line('floor', 6, 0, (4 + WF) / 2, LE - LW, FLOOR, WF - 4);
  line('floor', 0, 0, 16, WE - WW, FLOOR, WB - WF);
  line('ceil', 6, linkTop, 7, LE - LW, CEIL, 6 - WALL * 2, { collide: false });
  line('ceil', 0, top, 16, WE - WW, CEIL, WB - WF, { collide: false });
  // the passage: both sides, and round the door at its far end
  run(LW + K, 4 + WALL, LW + K, 10 - WALL, linkTop, SKIN);
  run(LE - K, 4 + WALL, LE - K, 10 - WALL, linkTop, SKIN);
  run(LW, 10 - WALL - K, LE, 10 - WALL - K, linkTop, SKIN, [hole(6 - LW)]);
  for (const jx of [6 - DOOR / 2 + 0.01, 6 + DOOR / 2 - 0.01]) line('wall', jx, 0, 10, 0.02, 2.2, (WALL + SKIN) * 2, { collide: false });
  line('wall', 6, 2.18, 10, DOOR, 0.02, (WALL + SKIN) * 2, { collide: false });
  // the wing: the inside of its four walls
  run(WW, WF + K, WE, WF + K, top, SKIN, [hole(6 - WW)]);
  run(WW + K, WF, WW + K, WB, top, SKIN);
  run(WE - K, WF, WE - K, WB, top, SKIN);
  run(WW, WB - K, WE, WB - K, top, SKIN);
  // ...and what divides it: the hall along the front, ward B to the east, ward A to the west and the isolation
  // ward behind that. No doorway is in line with the passage: nothing in the wards is seen from the daylight
  const [IW, IE, IB] = [WW + SKIN, WE - SKIN, WB - SKIN];
  run(IW, 12.6, IE, 12.6, top, 0.2, [door(-5 - IW), door(2.5 - IW)]);
  run(-1, 12.7, -1, IB, top, 0.2);
  run(IW, 17.3, -1.1, 17.3, top, 0.2, [door(-3 - IW)]);
  // the boards over the windows, from inside
  for (const w of boarded) {
    const [px, pz] = off(w, -(WALL + SKIN + 0.018));
    for (let k = 0; k < 3; k++) line('board', px, 0.98 + k * 0.42, pz, 1.9 + rng.range(-0.1, 0.15), 0.2, 0.035, { ry: w[2] ? PI / 2 : 0, rz: rng.range(-0.08, 0.08), collide: false });
  }

  // ---- what is in the wards
  const bed = (lx, lz, ry) => prop('bed', lx, lz, ry);
  // the hall: nothing where the passage looks in
  prop('wheelchair', -7.6, 11.5, 1.9);
  prop('body_bag', -2.2, 11.9, PI / 2 + 0.1, { nocollide: true });
  // ward B: beds down both walls
  for (const bz of [13.9, 16.4, 18.9]) bed(7.75, bz, PI / 2);
  bed(0.15, 15.2, -PI / 2);
  bed(0.5, 18.9, -PI / 2 + 0.5);
  cont(CONT.MEDICINE, 4.2, 21.54, { prop: 'medicine_cabinet', ry: 0, h: 1.1 });
  cont(CONT.CABINET, 6.6, 21.49, { prop: 'cabinet', ry: 0 });
  prop('wheelchair', 2.3, 20.6, -0.6);
  prop('corpse', 4.4, 16.2, 0.9, { nocollide: true });
  prop('bones', 1.6, 21.2, 0, { nocollide: true });
  b.partSpot(8.2, 21.2, FLOOR + 0.02);
  b.loot(3.4, 17.6, FLOOR + 0.02);
  // ward A
  bed(-7.75, 13.9, -PI / 2);
  bed(-7.75, 16.1, -PI / 2);
  cont(CONT.LOCKER, -1.38, 14.3, { prop: 'locker', ry: PI / 2 });
  prop('body_bag', -5.6, 14, 0.3, { nocollide: true });
  prop('body_bag', -4.7, 14.3, 0.1, { nocollide: true });
  b.loot(-3.6, 15.6, FLOOR + 0.02);
  // the isolation ward, the deepest room: the drug locker against its back wall
  cont(CONT.DRUG_LOCKER, -6.6, 21.46, { prop: 'drug_locker', ry: 0, h: 0.8 });
  bed(-7.75, 19.2, -PI / 2);
  prop('chair', -2, 21, 2.6);
  prop('corpse', -3.4, 20.4, 2.2, { nocollide: true });
  prop('bones', -5, 18.3, 0, { nocollide: true });
  b.loot(-2.4, 18.6, FLOOR + 0.02);

  // ---------------------------------------------------------------- the dark, and who lives in it
  const mouth = [b.wx(6, 4), b.wz(6, 4)];
  // (the passage and the wing: two boxes that overlap in the wall between them)
  for (const [cx, cz, hx, hz] of [[6, 7.1, 1.5, 3.1], [0, 16, 9, 6]]) {
    darks.push({ x: b.wx(cx, cz), z: b.wz(cx, cz), c: b.c, s: b.s, hx, hz, y0: b.y0 - 0.5, y1: b.y0 + H, mx: mouth[0], mz: mouth[1], near: FADE[0], far: FADE[1] });
  }
  const at = (lx, lz, more) => ({ x: b.wx(lx, lz), y: b.y0 + FLOOR, z: b.wz(lx, lz), ...more });
  return {
    x: b.ox,
    y: b.y0 + FLOOR,
    z: b.oz,
    ry: b.ry,
    door: at(4, -6.5), // on the forecourt, in front of the door
    ward: at(4.6, 14.6), // in ward B
    home: at(-0.6, 11.35), // the middle of the hall: where a dweller that was led out comes back to
    // where the dead of the wards stand (kind 0 a walker, 1 a crawler, 2 a Shade): server/clinic.js
    dens: [at(5.2, 18.2, { kind: 0 }), at(2.6, 15.4, { kind: 1 }), at(-4.6, 15.2, { kind: 0 }), at(-4.4, 19.6, { kind: 2 })],
    // ...and the spots they shuffle between, each in sight of another through a doorway
    roam: [[-5, 11.35], [2.5, 11.35], [-0.6, 11.35], [2.5, 13.9], [5.2, 18.2], [2.6, 15.4], [5, 14.6], [3.2, 20], [-5, 13.9], [-4.6, 15.2], [-3, 16.2], [-3, 18.5], [-4.4, 19.6], [-6.4, 20.2]].map(([lx, lz]) => at(lx, lz)),
    lining, // its boxes: entries as in world.parts, with mat = wall / floor / ceil / board
    signs, // the lettered faces: { x, y, z (the middle), ry (the turn about Y of a face that looks along +Z), w, h, kind: 0 the board, 1 the strip over the door }
  };
}
