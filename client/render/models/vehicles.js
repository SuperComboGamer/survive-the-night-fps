// The vehicles as everybody sees them (shared/vehicles.js): the moped, the car, the bicycle. Each is a VehicleModel:
//   group      the whole of it: put it where the vehicle stands, turn it by its yaw (its front is -Z)
//   body       what leans, pitches and rides on its springs (a child of group): the wheels are in it too
//   wheels     what turns with the distance rolled (spin: rotation.x); steer(a) turns the front ones (and the bars)
//   setState   as found (the bonnet up, a tyre flat, a panel off), running, broken down, burnt out
//   setLamps   the headlamp and the tail lamp, lit or not; the brake lamp
//   setDash    the needles: speed and fuel, 0..1
//   grips      [left, right]: where a driver's hands go (Object3Ds that turn with the bars or the wheel)
//   seats      [x, y (the hips), z] of each seat, in the body's frame (VEHICLES[kind].seats)
// Everything is built once per look and shared: a model is a few groups of the same geometries.
import * as THREE from 'three';
import { MeshBuilder, partsToGroup, getMaterial, makeRng } from '../materials.js';
import { VEH, VSTATE, VEHICLES } from '../../../shared/vehicles.js';
import { sedan, wheel, CAR_COLORS } from './props.js';

const PI = Math.PI;
const X = [0, 0, PI / 2]; // a cylinder laid across

// paints (linear), by tint. 7: the car the team crossed in (the quest car's own blue-grey)
export const PAINTS = [[0.5, 0.1, 0.07], [0.12, 0.2, 0.3], [0.42, 0.38, 0.2], [0.16, 0.26, 0.16], [0.5, 0.48, 0.44], [0.07, 0.07, 0.08], [0.45, 0.25, 0.08], [0.34, 0.42, 0.52]];
const BLACK = [0.035, 0.035, 0.038];
const SEAT = [0.07, 0.055, 0.045];
const RUBBER = [0.03, 0.03, 0.03];

// lamps: one material each, shared by every vehicle (what is lit is a mesh shown, never a material changed)
let _mats = null;
function lampMats() {
  if (_mats) return _mats;
  _mats = {
    head: new THREE.MeshBasicMaterial({ color: 0xfff1c4 }),
    tail: new THREE.MeshBasicMaterial({ color: 0xb01208 }),
    brake: new THREE.MeshBasicMaterial({ color: 0xff3018 }),
    dial: new THREE.MeshBasicMaterial({ color: 0xc9d2b8 }),
    needle: new THREE.MeshBasicMaterial({ color: 0xe8401c }),
    off: new THREE.MeshLambertMaterial({ color: 0x4a4a44 }),
  };
  for (const k in _mats) _mats[k].name = `veh_${k}`;
  return _mats;
}
const _geo = {};
const geo = (key, make) => _geo[key] || (_geo[key] = make());
const lamp = (g, mat) => {
  const m = new THREE.Mesh(g, mat);
  m.castShadow = false;
  return m;
};

// ---------------------------------------------------------------- two wheels
// A spoked wheel, its axle along X, of radius r and width w (a tyre, a rim, a hub, spokes that are seen to turn)
function spoked(b, r, w, n = 8) {
  const ri = r - Math.max(0.045, r * 0.2);
  const hw = w / 2;
  b.lathe('tire', [[ri, hw * 0.7], [r * 0.95, hw], [r, hw * 0.5], [r, -hw * 0.5], [r * 0.95, -hw], [ri, -hw * 0.7]], 14, { r: X });
  b.torus('chrome', ri, 0.012, 4, 14, PI * 2, { r: [0, PI / 2, 0] });
  b.cyl('steel', 0.035, 0.035, w * 1.3, 8, { r: X });
  for (let k = 0; k < n; k++) b.box('steel', 0.006, ri * 2, 0.006, { r: [(k * PI) / n, 0, 0] });
}

const MOPED = { wr: 0.27, ax: 0.6, head: [0, 0.86, -0.46] }; // wheel radius, half the wheelbase, the headstock
MOPED.rake = Math.atan2(MOPED.ax - -MOPED.head[2], MOPED.head[1] - MOPED.wr);
MOPED.fork = Math.hypot(MOPED.ax + MOPED.head[2], MOPED.head[1] - MOPED.wr);
const BIKE = { wr: 0.34, ax: 0.52, head: [0, 0.98, -0.36] };
BIKE.rake = Math.atan2(BIKE.ax + BIKE.head[2], BIKE.head[1] - BIKE.wr);
BIKE.fork = Math.hypot(BIKE.ax + BIKE.head[2], BIKE.head[1] - BIKE.wr);

function buildMoped(tint) {
  const col = PAINTS[tint % PAINTS.length];
  const M = MOPED;
  const body = new MeshBuilder(4101 + tint, { ao: false });
  // the pressed-steel backbone: headstock down to the floor, along under the feet, up to the seat and back to the tail
  body.cylBetween('paint', M.head, [0, 0.27, -0.3], 0.036, 0.04, 8, { c: col });
  body.cylBetween('paint', [0, 0.27, -0.3], [0, 0.26, 0.26], 0.036, 0.036, 8, { c: col });
  body.cylBetween('paint', [0, 0.26, 0.26], [0, 0.66, 0.34], 0.036, 0.036, 8, { c: col });
  body.cylBetween('steel', [0, 0.64, 0.3], [0, 0.72, 0.9], 0.02, 0.02, 6);
  // the leg shield, and the floorboard behind it
  body.box('paint', 0.42, 0.52, 0.03, { p: [0, 0.57, -0.395], r: [-0.2, 0, 0], c: col });
  for (const sx of [-1, 1]) body.box('paint', 0.03, 0.5, 0.1, { p: [sx * 0.205, 0.56, -0.36], r: [-0.2, 0, 0], c: col });
  body.box('flat', 0.36, 0.028, 0.5, { p: [0, 0.305, -0.06], c: BLACK });
  // the engine, laid flat under the frame, its barrel forward, the chain case back to the wheel
  body.box('steel', 0.2, 0.17, 0.26, { p: [0, 0.36, 0.33] });
  body.cyl('steel', 0.06, 0.06, 0.2, 8, { p: [0, 0.3, 0.18], r: [PI / 2, 0, 0] });
  for (let k = 0; k < 4; k++) body.box('steel', 0.15, 0.15, 0.008, { p: [0, 0.3, 0.1 + k * 0.035] }); // cooling fins
  body.box('flat', 0.04, 0.07, 0.5, { p: [-0.1, 0.3, 0.52], c: BLACK });
  // the swing arm and the two shocks
  for (const sx of [-1, 1]) {
    body.cylBetween('steel', [sx * 0.085, 0.34, 0.3], [sx * 0.085, M.wr, M.ax], 0.016, 0.016, 6);
    body.cylBetween('chrome', [sx * 0.11, M.wr + 0.02, M.ax - 0.04], [sx * 0.11, 0.68, 0.5], 0.018, 0.022, 6);
  }
  // the exhaust, low on the right
  body.cylBetween('chrome', [0.1, 0.27, 0.16], [0.14, 0.24, 0.5], 0.016, 0.016, 6);
  body.cylBetween('chrome', [0.14, 0.24, 0.5], [0.15, 0.27, 0.95], 0.04, 0.036, 8);
  // the back mudguard over the wheel, the lamp bracket at its end
  for (let k = 0; k < 5; k++) {
    const a0 = -0.5 + k * 0.42, a1 = a0 + 0.42, R = M.wr + 0.05;
    body.beam('paint', [0, M.wr + Math.cos(a0) * R, M.ax + Math.sin(a0) * R], [0, M.wr + Math.cos(a1) * R, M.ax + Math.sin(a1) * R], 0.13, 0.012, { c: col });
  }
  body.box('flat', 0.09, 0.07, 0.035, { p: [0, 0.6, M.ax + 0.33], c: BLACK });
  // the rack behind the seat
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.11, 0.8, 0.7], [sx * 0.11, 0.8, 1.02], 0.008, 0.008, 5);
  for (const z of [0.72, 0.86, 1.01]) body.cylBetween('steel', [-0.11, 0.8, z], [0.11, 0.8, z], 0.008, 0.008, 5);
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.11, 0.8, 0.98], [sx * 0.07, 0.6, 0.86], 0.007, 0.007, 5);
  // the side stand, folded up
  body.cylBetween('steel', [-0.1, 0.3, 0.12], [-0.17, 0.2, 0.42], 0.009, 0.009, 5);
  // footrests for whoever rides behind
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.09, 0.36, 0.42], [sx * 0.2, 0.36, 0.44], 0.011, 0.011, 5);
  const bodyParts = body.build();

  // what a broken one has off: the seat's base cover and the side panels (the tank and the battery tray show)
  const cover = new MeshBuilder(4201 + tint, { ao: false });
  for (const sx of [-1, 1]) cover.box('paint', 0.02, 0.2, 0.44, { p: [sx * 0.13, 0.58, 0.44], c: col });
  cover.box('paint', 0.24, 0.02, 0.44, { p: [0, 0.685, 0.44], c: col });
  const coverParts = cover.build();
  const inner = new MeshBuilder(4301, { ao: false });
  inner.cyl('rust', 0.085, 0.085, 0.3, 8, { p: [0, 0.59, 0.5], r: [PI / 2, 0, 0] }); // the tank
  inner.box('rust', 0.12, 0.1, 0.1, { p: [0, 0.57, 0.28] }); // the battery tray
  const innerParts = inner.build();
  // the seat: a long one for two
  const seat = new MeshBuilder(4401, { ao: false });
  seat.box('flat', 0.27, 0.085, 0.7, { p: [0, 0.737, 0.33], c: SEAT });
  seat.box('flat', 0.23, 0.02, 0.64, { p: [0, 0.786, 0.33], c: [0.09, 0.07, 0.06] });
  const seatParts = seat.build();

  // ---- what turns with the bars, about the headstock (its own frame: -Y runs down the fork to the axle)
  const f = new MeshBuilder(4501 + tint, { ao: false });
  for (const sx of [-1, 1]) {
    f.cylBetween('chrome', [sx * 0.075, 0.04, 0], [sx * 0.075, -M.fork * 0.55, 0], 0.016, 0.016, 6);
    f.cylBetween('steel', [sx * 0.075, -M.fork * 0.5, 0], [sx * 0.075, -M.fork, 0], 0.021, 0.021, 6);
  }
  f.box('steel', 0.19, 0.03, 0.06, { p: [0, 0.03, 0] });
  f.box('steel', 0.19, 0.03, 0.06, { p: [0, -0.2, 0] });
  // the front mudguard
  for (let k = 0; k < 4; k++) {
    const a0 = -0.95 + k * 0.45, a1 = a0 + 0.45, R = M.wr + 0.045;
    f.beam('paint', [0, -M.fork + Math.cos(a0) * R, Math.sin(a0) * R], [0, -M.fork + Math.cos(a1) * R, Math.sin(a1) * R], 0.12, 0.012, { c: col });
  }
  // the stem, the bars swept back, the grips, the levers, a mirror
  f.cylBetween('chrome', [0, 0.03, 0], [0, 0.17, 0.03], 0.016, 0.016, 6);
  f.cylBetween('chrome', [-0.2, 0.2, 0.05], [0.2, 0.2, 0.05], 0.011, 0.011, 6);
  for (const sx of [-1, 1]) {
    f.cylBetween('chrome', [sx * 0.2, 0.2, 0.05], [sx * 0.24, 0.2, 0.15], 0.011, 0.011, 6);
    f.cylBetween('flat', [sx * 0.235, 0.2, 0.14], [sx * 0.36, 0.2, 0.17], 0.0155, 0.0155, 8, { c: RUBBER });
    f.cylBetween('steel', [sx * 0.23, 0.205, 0.11], [sx * 0.34, 0.19, 0.115], 0.005, 0.004, 4);
  }
  f.cylBetween('steel', [-0.19, 0.2, 0.05], [-0.3, 0.34, 0.03], 0.004, 0.004, 4);
  f.cyl('chrome', 0.04, 0.04, 0.012, 10, { p: [-0.31, 0.37, 0.03], r: [PI / 2, 0, 0] });
  // the headlamp's shell and the clocks on top of it
  f.lathe('paint', [[0, 0.1], [0.05, 0.09], [0.085, 0.04], [0.09, -0.03], [0.085, -0.045], [0, -0.045]], 12, { p: [0, 0.07, -0.085], r: [PI / 2, 0, 0], c: col });
  f.torus('chrome', 0.085, 0.008, 4, 12, PI * 2, { p: [0, 0.07, -0.132] });
  f.cyl('flat', 0.05, 0.055, 0.045, 12, { p: [0, 0.2, -0.02], r: [-0.45, 0, 0], c: BLACK });
  f.cyl('flat', 0.026, 0.028, 0.035, 10, { p: [0.085, 0.19, -0.01], r: [-0.45, 0, 0], c: BLACK });
  const forkParts = f.build();

  const wb = new MeshBuilder(4601, { ao: false });
  spoked(wb, M.wr, 0.075, 8);
  const flatB = new MeshBuilder(4602, { ao: false });
  flatB.group({ p: [0, -0.04, 0], s: [1.25, 0.82, 1] }, () => spoked(flatB, M.wr, 0.075, 8));
  return { body: bodyParts, cover: coverParts, inner: innerParts, seat: seatParts, fork: forkParts, wheel: wb.build(), flat: flatB.build() };
}

function buildBike(tint) {
  const col = PAINTS[(tint + 1) % PAINTS.length];
  const B = BIKE;
  const body = new MeshBuilder(4701 + tint, { ao: false });
  const bb = [0, 0.29, 0.06]; // the bottom bracket
  const st = [0, 0.9, 0.2]; // the top of the seat tube
  body.cylBetween('paint', B.head, [0, B.head[1] - 0.12, B.head[2] - 0.03], 0.02, 0.02, 6, { c: col });
  body.cylBetween('paint', [0, B.head[1] - 0.02, B.head[2]], [0, 0.86, 0.18], 0.016, 0.016, 6, { c: col }); // top tube
  body.cylBetween('paint', [0, B.head[1] - 0.1, B.head[2] - 0.02], bb, 0.019, 0.019, 6, { c: col }); // down tube
  body.cylBetween('paint', bb, st, 0.017, 0.017, 6, { c: col });
  for (const sx of [-1, 1]) {
    body.cylBetween('paint', [sx * 0.03, bb[1], bb[2]], [sx * 0.06, B.wr, B.ax], 0.01, 0.01, 5, { c: col }); // chain stays
    body.cylBetween('paint', [sx * 0.02, 0.84, 0.18], [sx * 0.06, B.wr, B.ax], 0.009, 0.009, 5, { c: col }); // seat stays
  }
  body.cylBetween('steel', st, [0, 0.96, 0.21], 0.012, 0.012, 6);
  body.box('flat', 0.13, 0.03, 0.17, { p: [0, 0.972, 0.2], c: SEAT });
  // the back mudguard and a rack
  for (let k = 0; k < 4; k++) {
    const a0 = -0.35 + k * 0.42, a1 = a0 + 0.42, R = B.wr + 0.03;
    body.beam('steel', [0, B.wr + Math.cos(a0) * R, B.ax + Math.sin(a0) * R], [0, B.wr + Math.cos(a1) * R, B.ax + Math.sin(a1) * R], 0.06, 0.006);
  }
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.07, 0.74, 0.3], [sx * 0.07, 0.74, 0.86], 0.006, 0.006, 4);
  for (const z of [0.32, 0.58, 0.85]) body.cylBetween('steel', [-0.07, 0.74, z], [0.07, 0.74, z], 0.006, 0.006, 4);
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.07, 0.74, 0.8], [sx * 0.065, B.wr, B.ax], 0.005, 0.005, 4);
  body.box('flat', 0.012, 0.03, 0.5, { p: [0.05, 0.31, 0.3], c: BLACK }); // the chain
  const bodyParts = body.build();
  // the cranks and pedals, about the bottom bracket
  const cr = new MeshBuilder(4801, { ao: false });
  cr.cyl('steel', 0.085, 0.085, 0.006, 12, { p: [0.05, 0, 0], r: X });
  for (const sx of [-1, 1]) {
    cr.cylBetween('steel', [sx * 0.06, 0, 0], [sx * 0.075, sx * 0.165, 0], 0.009, 0.009, 5);
    cr.box('flat', 0.09, 0.02, 0.07, { p: [sx * 0.125, sx * 0.165, 0], c: BLACK });
  }
  const crankParts = cr.build();
  const f = new MeshBuilder(4901 + tint, { ao: false });
  for (const sx of [-1, 1]) f.cylBetween('paint', [sx * 0.05, -0.12, 0], [sx * 0.05, -B.fork, 0], 0.011, 0.011, 5, { c: col });
  f.box('paint', 0.12, 0.025, 0.035, { p: [0, -0.125, 0], c: col });
  f.cylBetween('steel', [0, -0.12, 0], [0, 0.24, 0.0], 0.013, 0.013, 6);
  f.cylBetween('steel', [0, 0.24, 0], [0, 0.26, -0.05], 0.012, 0.012, 6); // the stem forward
  f.cylBetween('chrome', [-0.2, 0.26, -0.05], [0.2, 0.26, -0.05], 0.011, 0.011, 6);
  for (const sx of [-1, 1]) {
    f.cylBetween('chrome', [sx * 0.2, 0.26, -0.05], [sx * 0.25, 0.26, 0.06], 0.011, 0.011, 6);
    f.cylBetween('flat', [sx * 0.248, 0.26, 0.055], [sx * 0.275, 0.26, 0.175], 0.0155, 0.0155, 8, { c: RUBBER });
  }
  for (let k = 0; k < 3; k++) {
    const a0 = -0.6 + k * 0.42, a1 = a0 + 0.42, R = B.wr + 0.03;
    f.beam('steel', [0, -B.fork + Math.cos(a0) * R, Math.sin(a0) * R], [0, -B.fork + Math.cos(a1) * R, Math.sin(a1) * R], 0.06, 0.006);
  }
  f.cyl('chrome', 0.028, 0.03, 0.03, 8, { p: [-0.12, 0.29, -0.05] }); // the bell
  const forkParts = f.build();
  const wb = new MeshBuilder(4902, { ao: false });
  spoked(wb, B.wr, 0.045, 12);
  const flatB = new MeshBuilder(4903, { ao: false });
  flatB.group({ p: [0, -0.035, 0], s: [1.2, 0.86, 1] }, () => spoked(flatB, B.wr, 0.045, 12));
  return { body: bodyParts, crank: crankParts, fork: forkParts, wheel: wb.build(), flat: flatB.build() };
}

// ---------------------------------------------------------------- the car
// The sedan of the roads (props.js `sedan`), whole: its bonnet shut (or up, as it is found), its wheels and its
// steering wheel apart, to turn. CAR_Z: the quest car's prop is this much shorter than the builder's sedan, and the
// team's car is that car.
const CAR_Z = 0.952;
const CAR = { wr: 0.32, wheels: [[-0.8, -1.4], [0.8, -1.4], [-0.8, 1.35], [0.8, 1.35]], steer: [-0.38, 1.0, -0.42], tilt: 0.42, R: 0.17 };
function buildCar(tint, variant) {
  const col = tint === 7 ? [0.34, 0.42, 0.52] : CAR_COLORS[tint % CAR_COLORS.length];
  const b = new MeshBuilder(5101 + tint * 7 + variant, { ao: false });
  b.push([0, 0, 0], [0, 0, 0], [1, 1, CAR_Z]);
  const burnt = variant === 2;
  sedan(b, makeRng(5101 * 31 + tint), {
    color: burnt ? [0.05, 0.045, 0.04] : col,
    noWheels: true,
    noSteer: true,
    hoodOpen: variant === 1,
    burnt,
    glass: burnt ? ['gone', 'gone', 'gone', 'gone', 'gone', 'gone'] : tint === 7 ? ['ok', 'ok', 'ok', 'gone', 'gone', 'ok'] : ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
    dirt: 0.5,
    cabin: -1,
    seats: tint,
  });
  b.pop();
  const wb = new MeshBuilder(5201, { ao: false });
  wheel(wb, CAR.wr, 0.2);
  const fb = new MeshBuilder(5202, { ao: false });
  wheel(fb, CAR.wr, 0.2, { flat: 0.3 });
  // the steering wheel, in its own frame: the rim round +Z (which the tilt lays back toward the driver)
  const sw = new MeshBuilder(5203, { ao: false });
  sw.torus('flat', CAR.R, CAR.R * 0.11, 5, 14, PI * 2, { c: [0.03, 0.03, 0.03] });
  sw.box('flat', CAR.R * 1.9, 0.03, 0.02, { c: [0.045, 0.045, 0.045] });
  sw.box('flat', 0.03, CAR.R * 0.95, 0.02, { p: [0, -CAR.R * 0.48, 0], c: [0.045, 0.045, 0.045] });
  sw.cyl('flat', 0.03, 0.03, 0.03, 8, { r: [PI / 2, 0, 0], c: [0.06, 0.06, 0.06] });
  const col2 = new MeshBuilder(5204, { ao: false });
  col2.cylBetween('flat', [CAR.steer[0], CAR.steer[1] - Math.cos(CAR.tilt) * 0.3, (CAR.steer[2] - Math.sin(CAR.tilt) * 0.3 - 0.06) * CAR_Z], [CAR.steer[0], CAR.steer[1] - 0.01, (CAR.steer[2] - 0.005) * CAR_Z], 0.022, 0.026, 6, { c: [0.06, 0.06, 0.06] });
  return { body: b.build(), wheel: wb.build(), flat: fb.build(), steer: sw.build(), column: col2.build() };
}

const cache = new Map();
const partsOf = (key, make) => {
  let p = cache.get(key);
  if (!p) cache.set(key, (p = make()));
  return p;
};
const shadows = (g) => {
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
};

export class VehicleModel {
  constructor(vk, tint = 0) {
    this.vk = vk;
    this.tint = tint;
    this.P = VEHICLES[vk];
    this.group = new THREE.Group();
    this.group.name = `vehicle_${vk}`;
    this.group.rotation.order = 'YXZ';
    this.body = new THREE.Group();
    this.body.rotation.order = 'YXZ';
    this.group.add(this.body);
    this.wheels = [];
    this.front = []; // the wheels' steering pivots (the car), or the fork
    this.grips = [new THREE.Object3D(), new THREE.Object3D()];
    this.state = -1;
    this.lit = -1;
    this.braking = -1;
    this.needles = [];
    this.wr = 0.3;
    const L = lampMats();
    if (vk === VEH.CAR) this.makeCar(L);
    else this.makeTwo(L, vk === VEH.MOPED);
    this.setState(VSTATE.OK);
    this.setLamps(false, false);
  }

  makeTwo(L, moped) {
    const D = moped ? MOPED : BIKE;
    const P = partsOf(`${this.vk}:${this.tint}`, () => (moped ? buildMoped(this.tint) : buildBike(this.tint)));
    this.wr = D.wr;
    const body = this.body;
    body.add(shadows(partsToGroup(P.body, 'body')));
    if (moped) {
      this.cover = shadows(partsToGroup(P.cover, 'cover'));
      this.inner = shadows(partsToGroup(P.inner, 'inner'));
      this.seat = shadows(partsToGroup(P.seat, 'seat'));
      body.add(this.cover, this.inner, this.seat);
    } else {
      this.crank = shadows(partsToGroup(P.crank, 'crank'));
      this.crank.position.set(0, 0.29, 0.06);
      body.add(this.crank);
    }
    // the fork: its frame's -Y runs from the headstock down to the axle; it turns about that
    const fork = (this.fork = new THREE.Group());
    fork.rotation.order = 'XYZ';
    fork.position.set(D.head[0], D.head[1], D.head[2]);
    fork.rotation.x = D.rake;
    fork.add(shadows(partsToGroup(P.fork, 'fork')));
    body.add(fork);
    const mk = (parts) => shadows(partsToGroup(parts, 'wheel'));
    const fw = new THREE.Group();
    fw.position.set(0, -D.fork, 0);
    this.fwOk = mk(P.wheel);
    this.fwFlat = mk(P.flat);
    fw.add(this.fwOk, this.fwFlat);
    fork.add(fw);
    const rw = mk(P.wheel);
    rw.position.set(0, D.wr, D.ax);
    body.add(rw);
    this.wheels.push(this.fwOk, rw);
    // the grips (the middle of each, on the bars)
    const gx = moped ? 0.298 : 0.262, gy = moped ? 0.2 : 0.26, gz = moped ? 0.155 : 0.115;
    this.grips[0].position.set(-gx, gy, gz);
    this.grips[1].position.set(gx, gy, gz);
    fork.add(this.grips[0], this.grips[1]);
    if (moped) {
      // lamps and clocks
      const lens = geo('mlens', () => new THREE.CircleGeometry(0.078, 14));
      this.headOn = lamp(lens, L.head);
      this.headOff = lamp(lens, L.off);
      for (const m of [this.headOn, this.headOff]) {
        m.position.set(0, 0.07, -0.134);
        m.rotation.y = PI;
        fork.add(m);
      }
      const tl = geo('mtail', () => new THREE.BoxGeometry(0.075, 0.05, 0.012));
      this.tailOn = lamp(tl, L.tail);
      this.brakeOn = lamp(tl, L.brake);
      this.tailOff = lamp(tl, getMaterial('taillight'));
      for (const m of [this.tailOn, this.brakeOn, this.tailOff]) {
        m.position.set(0, 0.6, MOPED.ax + 0.352);
        body.add(m);
      }
      // the speedometer's face and its needle, the fuel gauge beside it: tipped back toward the rider
      const dials = new THREE.Group();
      dials.position.set(0, 0.2, -0.02);
      dials.rotation.x = -0.45;
      fork.add(dials);
      const face = lamp(geo('mface', () => new THREE.CircleGeometry(0.044, 16).rotateX(-PI / 2)), L.dial);
      face.position.y = 0.0235;
      const face2 = lamp(geo('mface2', () => new THREE.CircleGeometry(0.022, 12).rotateX(-PI / 2)), L.dial);
      face2.position.set(0.085, 0.0085, 0.0055);
      dials.add(face, face2);
      const ng = geo('mneedle', () => new THREE.BoxGeometry(0.004, 0.002, 0.036).translate(0, 0, -0.016));
      for (const [x, y, z, sc] of [[0, 0.0255, 0, 1], [0.085, 0.0105, 0.0055, 0.5]]) {
        const n = lamp(ng, L.needle);
        n.position.set(x, y, z);
        n.scale.setScalar(sc);
        dials.add(n);
        this.needles.push(n);
      }
    }
  }

  makeCar(L) {
    const mk = (variant) => shadows(partsToGroup(partsOf(`car:${this.tint}:${variant}`, () => buildCar(this.tint, variant)).body, 'car'));
    const P = partsOf(`car:${this.tint}:0`, () => buildCar(this.tint, 0));
    this.wr = CAR.wr;
    this.bodies = [mk(0), null, null]; // running; as found (the bonnet up); burnt out - the last two made when wanted
    this.mkBody = mk;
    this.body.add(this.bodies[0]);
    CAR.wheels.forEach(([x, z], k) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, CAR.wr, z * CAR_Z);
      const w = shadows(partsToGroup(P.wheel, 'wheel'));
      pivot.add(w);
      if (k === 1) {
        this.fwFlat = shadows(partsToGroup(P.flat, 'wheel_flat'));
        pivot.add(this.fwFlat);
        this.fwOk = w;
      }
      this.body.add(pivot);
      this.wheels.push(w);
      if (k < 2) this.front.push(pivot);
    });
    // the steering wheel on its column, and the driver's hands' places on its rim (ten to two)
    this.body.add(partsToGroup(P.column, 'column'));
    const sw = (this.sw = new THREE.Group());
    sw.position.set(CAR.steer[0], CAR.steer[1], CAR.steer[2] * CAR_Z);
    sw.rotation.order = 'XYZ';
    sw.rotation.x = -CAR.tilt;
    sw.add(partsToGroup(P.steer, 'steering'));
    this.body.add(sw);
    for (const [k, a] of [[0, 2.35], [1, 0.79]]) {
      this.grips[k].position.set(Math.cos(a) * CAR.R, Math.sin(a) * CAR.R, 0);
      this.grips[k].rotation.z = a; // (its own +X runs out along the spoke: the fist closes on the rim across it)
      sw.add(this.grips[k]);
    }
    // lamps: two at the front, the tail lamps, the brake lamps over them
    const lens = geo('clens', () => new THREE.PlaneGeometry(0.36, 0.11));
    this.headOn = new THREE.Group();
    for (const sx of [-1, 1]) {
      const m = lamp(lens, L.head);
      m.position.set(sx * 0.72, 0.66, -2.33 * CAR_Z);
      m.rotation.y = PI;
      this.headOn.add(m);
    }
    const tl = geo('ctail', () => new THREE.PlaneGeometry(0.36, 0.14));
    this.tailOn = new THREE.Group();
    this.brakeOn = new THREE.Group();
    for (const sx of [-1, 1]) {
      for (const [grp, mat] of [[this.tailOn, L.tail], [this.brakeOn, L.brake]]) {
        const m = lamp(tl, mat);
        m.position.set(sx * 0.66, 0.68, 2.328 * CAR_Z);
        grp.add(m);
      }
    }
    this.body.add(this.headOn, this.tailOn, this.brakeOn);
    // the clocks in the binnacle behind the wheel: a lit face each, a needle each
    const dials = new THREE.Group();
    dials.position.set(-0.38, 1.008, -0.6 * CAR_Z);
    dials.rotation.x = 0.3;
    this.body.add(dials);
    const face = geo('cface', () => new THREE.CircleGeometry(0.036, 14));
    const ng = geo('cneedle', () => new THREE.BoxGeometry(0.004, 0.03, 0.002).translate(0, 0.013, 0));
    for (const [x, sc] of [[-0.06, 1], [0.06, 0.8]]) {
      const fm = lamp(face, L.dial);
      fm.position.set(x, 0, 0.001);
      fm.scale.setScalar(sc);
      const n = lamp(ng, L.needle);
      n.position.set(x, 0, 0.003);
      n.scale.setScalar(sc);
      dials.add(fm, n);
      this.needles.push(n);
    }
  }

  // as found (VSTATE.BROKEN), running, broken down, burnt out
  setState(state) {
    if (state === this.state) return;
    this.state = state;
    const found = state === VSTATE.BROKEN;
    const wreck = state === VSTATE.WRECK;
    if (this.vk === VEH.CAR) {
      const v = wreck ? 2 : found ? 1 : 0;
      if (!this.bodies[v]) this.body.add((this.bodies[v] = this.mkBody(v)));
      this.bodies.forEach((b, k) => b && (b.visible = k === v));
      this.sw.visible = !wreck;
    } else if (this.vk === VEH.MOPED) {
      this.cover.visible = !found && !wreck;
      this.seat.visible = !wreck;
      this.inner.visible = true;
    }
    if (this.fwFlat) {
      this.fwFlat.visible = found || wreck;
      this.fwOk.visible = !this.fwFlat.visible;
    }
    this.lit = -1;
    this.setLamps(false, false);
  }

  // head: the headlamp (and with it the tail lamp and the clocks); brake: the brake lamp
  setLamps(head, brake) {
    const dead = this.state === VSTATE.WRECK || this.state === VSTATE.BROKEN;
    const h = head && !dead ? 1 : 0;
    const b = brake && !dead ? 1 : 0;
    if (h === this.lit && b === this.braking) return;
    this.lit = h;
    this.braking = b;
    if (this.headOn) this.headOn.visible = !!h;
    if (this.headOff) this.headOff.visible = !h;
    if (this.brakeOn) this.brakeOn.visible = !!b;
    if (this.tailOn) this.tailOn.visible = !!h && !b;
    if (this.tailOff) this.tailOff.visible = !h && !b;
  }

  // roll: metres rolled (the wheels); steer: rad, + to the right
  setWheels(roll, steer) {
    const a = -roll / this.wr;
    for (const w of this.wheels) w.rotation.x = a;
    if (this.fwFlat) this.fwFlat.rotation.x = 0;
    if (this.fork) this.fork.rotation.y = -steer;
    for (const p of this.front) p.rotation.y = -steer;
    if (this.sw) this.sw.rotation.z = -steer * 4.2; // (the wheel turns a few times what the tyres do)
    if (this.crank) this.crank.rotation.x = a * 0.42;
  }

  // the needles: speed and fuel as shares of the dial
  setDash(speed, fuel) {
    const n = this.needles;
    if (!n.length) return;
    if (this.vk === VEH.CAR) {
      n[0].rotation.z = 2.1 - Math.min(1, speed) * 4.2;
      n[1].rotation.z = 1.2 - Math.min(1, fuel) * 2.4;
    } else {
      n[0].rotation.y = 2.1 - Math.min(1, speed) * 4.2;
      n[1].rotation.y = 1.2 - Math.min(1, fuel) * 2.4;
    }
  }

  // where the headlamp is and points, in the world: out.pos, out.dir (the model's matrices must be current)
  lampWorld(pos, dir) {
    const m = this.vk === VEH.CAR ? this.body : this.fork || this.body;
    m.updateWorldMatrix(true, false);
    if (this.vk === VEH.CAR) pos.set(0, 0.7, -2.3);
    else pos.set(0, 0.07, -0.16);
    pos.applyMatrix4(m.matrixWorld);
    dir.set(0, this.vk === VEH.CAR ? -0.06 : -0.3, -1).transformDirection(m.matrixWorld);
  }
}

// which survivors' hands hold on where: the grip of each hand in the frame of grips[k] - the fingers' way and the
// palm's (render/models/weapons.js handQ). On bars the fist closes over the grip from above and behind; on a wheel's
// rim from the outside.
// How a survivor sits in each seat: [the thigh's angle forward of straight down, the knee's bend, how far the knees
// are apart, the trunk's lean forward] (characters.js: s.sitT / sitK / sitSplay). A moped's rider has their feet on its
// footboard and whoever rides behind has their knees round them; in a car the legs go out under the dash, and in the
// back the knees are up behind the front seats; on a bicycle the feet are down at the pedals.
export const SEAT_POSE = {
  [VEH.MOPED]: [[1.35, 1.75, 0.1], [1.35, 1.75, 0.36]],
  [VEH.CAR]: [[1.62, 0.35, 0.1], [1.62, 0.35, 0.1], [2.1, 1.9, 0.12], [2.1, 1.9, 0.12]],
  [VEH.BIKE]: [[0.32, 0.3, 0.04]],
};
// (the sitting pose every seat is measured from: thighs level, shins hanging)
export const SIT_T = 1.5, SIT_K = 1.45, SEAT_HIP = 0.42;

export const GRIP_HOLD = {
  [VEH.MOPED]: { finger: [0, -0.35, -1], palm: [0, -1, 0.3] },
  [VEH.BIKE]: { finger: [0, -0.35, -1], palm: [0, -1, 0.3] },
  [VEH.CAR]: { finger: [0, 0, -1], palm: [-1, 0, 0] },
};
