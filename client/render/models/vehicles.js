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
    off: new THREE.MeshLambertMaterial({ color: 0xa8a89a, emissive: 0x1c1c18 }), // a lens with nothing lit behind it
    panel: new THREE.MeshBasicMaterial({ color: 0x1b2a25 }), // the clocks' panel, lit with the lamps
    wheel: new THREE.MeshLambertMaterial({ color: 0x2a2b30, emissive: 0x0c0d0f }), // a steering wheel's rim: never quite black
    glowTail: new THREE.MeshBasicMaterial({ color: 0x3a0603, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    glowBrake: new THREE.MeshBasicMaterial({ color: 0xa81808, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    glowHead: new THREE.MeshBasicMaterial({ color: 0x4a4636, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
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
// A pool of light on the road: a fan of triangles that fades to nothing at its rim (vertex colours, added to what is
// under it). rx, rz: its half-widths; it lies in its own XZ plane.
function poolGeo(key, rx, rz) {
  return geo(key, () => {
    const g = new THREE.BufferGeometry();
    const n = 14;
    const pos = [0, 0, 0], col = [1, 1, 1], idx = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * PI * 2;
      pos.push(Math.cos(a) * rx * 0.5, 0, Math.sin(a) * rz * 0.5, Math.cos(a) * rx, 0, Math.sin(a) * rz);
      col.push(0.45, 0.45, 0.45, 0, 0, 0);
    }
    for (let k = 0; k < n; k++) {
      const a = 1 + k * 2, b = 1 + ((k + 1) % n) * 2;
      idx.push(0, b, a, a, b, a + 1, b, b + 1, a + 1);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  });
}
const pool = (key, rx, rz, mat) => {
  if (!mat.vertexColors) mat.vertexColors = true;
  const m = lamp(poolGeo(key, rx, rz), mat);
  m.renderOrder = 3;
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

const MOPED = { wr: 0.27, ax: 0.6, head: [0, 0.86, -0.46], bar: 0.42 }; // (bar: how far up the fork's own axis the bars are) // wheel radius, half the wheelbase, the headstock
MOPED.rake = Math.atan2(MOPED.ax - -MOPED.head[2], MOPED.head[1] - MOPED.wr);
MOPED.fork = Math.hypot(MOPED.ax + MOPED.head[2], MOPED.head[1] - MOPED.wr);
const BIKE = { wr: 0.34, ax: 0.52, head: [0, 0.98, -0.36], bar: 0.42, bb: [0, 0.29, 0.06], crank: 0.165 };
BIKE.rake = Math.atan2(BIKE.ax + BIKE.head[2], BIKE.head[1] - BIKE.wr);
BIKE.fork = Math.hypot(BIKE.ax + BIKE.head[2], BIKE.head[1] - BIKE.wr);

function buildMoped(tint, burnt = false) {
  const col = burnt ? [0.05, 0.045, 0.04] : PAINTS[tint % PAINTS.length];
  const cream = burnt ? [0.07, 0.06, 0.05] : [0.62, 0.58, 0.47];
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
  body.cyl('steel', 0.075, 0.075, 0.05, 10, { p: [-0.115, 0.34, 0.3], r: X }); // the flywheel's cover
  body.cyl('chrome', 0.03, 0.03, 0.056, 8, { p: [-0.115, 0.34, 0.3], r: X });
  body.box('steel', 0.07, 0.06, 0.08, { p: [0.03, 0.46, 0.22] }); // the carburettor, and its air box
  body.cyl('flat', 0.04, 0.04, 0.09, 8, { p: [0.03, 0.47, 0.31], r: [PI / 2, 0, 0], c: BLACK });
  // the chain: two runs from the engine's sprocket to the wheel's, the big sprocket on the hub
  body.cyl('steel', 0.085, 0.085, 0.008, 12, { p: [-0.085, M.wr, M.ax], r: X });
  body.cyl('steel', 0.03, 0.03, 0.01, 8, { p: [-0.085, 0.33, 0.36], r: X });
  body.cylBetween('flat', [-0.085, 0.36, 0.36], [-0.085, M.wr + 0.085, M.ax], 0.007, 0.007, 4, { c: BLACK });
  body.cylBetween('flat', [-0.085, 0.3, 0.36], [-0.085, M.wr - 0.085, M.ax], 0.007, 0.007, 4, { c: BLACK });
  // the kick starter
  body.cylBetween('chrome', [0.11, 0.34, 0.34], [0.15, 0.45, 0.25], 0.008, 0.008, 5);
  body.cylBetween('chrome', [0.15, 0.45, 0.25], [0.15, 0.5, 0.24], 0.009, 0.009, 5);
  // the swing arm and the two shocks
  for (const sx of [-1, 1]) {
    body.cylBetween('steel', [sx * 0.085, 0.34, 0.3], [sx * 0.085, M.wr, M.ax], 0.016, 0.016, 6);
    body.cylBetween('chrome', [sx * 0.11, M.wr + 0.02, M.ax - 0.04], [sx * 0.11, 0.68, 0.5], 0.018, 0.022, 6);
  }
  // the exhaust, low on the right
  body.cylBetween('chrome', [0.1, 0.27, 0.16], [0.14, 0.24, 0.5], 0.016, 0.016, 6);
  body.cylBetween('chrome', [0.14, 0.24, 0.5], [0.15, 0.26, 0.58], 0.016, 0.044, 8);
  body.cylBetween('chrome', [0.15, 0.26, 0.58], [0.155, 0.28, 0.92], 0.044, 0.04, 10);
  body.cylBetween('chrome', [0.155, 0.28, 0.92], [0.157, 0.285, 0.99], 0.04, 0.014, 8);
  body.cylBetween('steel', [0.157, 0.285, 0.99], [0.158, 0.288, 1.04], 0.012, 0.012, 6);
  // the back mudguard over the wheel, the lamp bracket at its end
  for (let k = 0; k < 5; k++) {
    const a0 = -0.5 + k * 0.42, a1 = a0 + 0.42, R = M.wr + 0.05;
    body.beam('paint', [0, M.wr + Math.cos(a0) * R, M.ax + Math.sin(a0) * R], [0, M.wr + Math.cos(a1) * R, M.ax + Math.sin(a1) * R], 0.13, 0.012, { c: col });
  }
  body.box('flat', 0.09, 0.07, 0.035, { p: [0, 0.6, M.ax + 0.33], c: BLACK });
  body.box('flat', 0.15, 0.1, 0.006, { p: [0, 0.5, M.ax + 0.345], r: [0.25, 0, 0], c: [0.6, 0.58, 0.5] }); // the number plate under the lamp
  // the rack behind the seat
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.11, 0.8, 0.7], [sx * 0.11, 0.8, 1.02], 0.008, 0.008, 5);
  for (const z of [0.72, 0.86, 1.01]) body.cylBetween('steel', [-0.11, 0.8, z], [0.11, 0.8, z], 0.008, 0.008, 5);
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.11, 0.8, 0.98], [sx * 0.07, 0.6, 0.86], 0.007, 0.007, 5);
  // the side stand, folded up
  body.cylBetween('steel', [-0.1, 0.3, 0.12], [-0.17, 0.2, 0.42], 0.009, 0.009, 5);
  // footrests for whoever rides behind
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.09, 0.36, 0.34], [sx * 0.27, 0.36, 0.35], 0.011, 0.011, 5);
  const bodyParts = body.build();

  // what a broken one has off: the seat's base cover and the side panels (the tank and the battery tray show)
  const cover = new MeshBuilder(4201 + tint, { ao: false });
  // the tail: a pressed shell that swells over the tank and tapers to the lamp, a cream flash along each side, a
  // louvred cover over the battery
  cover.group({ p: [0, 0.585, 0.2], s: [1, 1.12, 1] }, () => {
    cover.lathe('paint', [[0.06, 0], [0.125, 0.05], [0.142, 0.2], [0.132, 0.38], [0.1, 0.56], [0.062, 0.7], [0.03, 0.74], [0, 0.745]], 12, { r: [PI / 2, 0, 0], c: col });
  });
  for (const sx of [-1, 1]) {
    cover.beam('paint', [sx * 0.139, 0.6, 0.28], [sx * 0.112, 0.6, 0.72], 0.085, 0.008, { c: cream });
    for (let k = 0; k < 3; k++) cover.box('flat', 0.006, 0.012, 0.09, { p: [sx * 0.147, 0.5 + k * 0.03, 0.34], c: BLACK });
  }
  const coverParts = cover.build();
  const inner = new MeshBuilder(4301, { ao: false });
  inner.cyl('rust', 0.085, 0.085, 0.3, 8, { p: [0, 0.59, 0.5], r: [PI / 2, 0, 0] }); // the tank
  inner.box('rust', 0.12, 0.1, 0.1, { p: [0, 0.57, 0.28] }); // the battery tray
  const innerParts = inner.build();
  // the seat: a long one for two
  const seat = new MeshBuilder(4401, { ao: false });
  const pad = [0.09, 0.07, 0.06];
  seat.box('flat', 0.25, 0.06, 0.33, { p: [0, 0.745, 0.285], c: SEAT });
  seat.box('flat', 0.15, 0.06, 0.11, { p: [0, 0.745, 0.065], c: SEAT }); // its nose: narrow between the thighs
  seat.cyl('flat', 0.03, 0.03, 0.15, 8, { p: [0, 0.745, 0.012], r: X, c: SEAT });
  seat.box('flat', 0.21, 0.022, 0.31, { p: [0, 0.784, 0.285], c: pad });
  seat.box('flat', 0.12, 0.022, 0.11, { p: [0, 0.784, 0.075], c: pad });
  seat.box('flat', 0.25, 0.085, 0.27, { p: [0, 0.758, 0.585], c: SEAT }); // behind: a step higher
  seat.box('flat', 0.21, 0.022, 0.23, { p: [0, 0.81, 0.585], c: pad });
  seat.cyl('flat', 0.043, 0.043, 0.25, 8, { p: [0, 0.758, 0.72], r: X, c: SEAT });
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
  const by = M.bar;
  f.cylBetween('chrome', [0, 0.03, 0], [0, by - 0.1, 0.03], 0.016, 0.016, 6);
  for (const sx of [-1, 1]) {
    // each side up from the clamp, out, and back to the grip
    f.cylBetween('chrome', [sx * 0.03, by - 0.1, 0.03], [sx * 0.14, by, 0.05], 0.011, 0.011, 6);
    f.cylBetween('chrome', [sx * 0.14, by, 0.05], [sx * 0.2, by, 0.05], 0.011, 0.011, 6);
    f.cylBetween('chrome', [sx * 0.2, by, 0.05], [sx * 0.24, by, 0.08], 0.011, 0.011, 6);
    f.cylBetween('flat', [sx * 0.235, by, 0.078], [sx * 0.36, by, 0.1], 0.0155, 0.0155, 8, { c: RUBBER });
    f.cylBetween('steel', [sx * 0.23, by + 0.005, 0.045], [sx * 0.34, by - 0.01, 0.05], 0.005, 0.004, 4);
  }
  f.box('chrome', 0.07, 0.03, 0.04, { p: [0, by - 0.1, 0.03] });
  // the mirror: a stalk off the left bar, its back a shell, its face toward the rider
  f.cylBetween('chrome', [-0.2, by, 0.05], [-0.25, by + 0.1, 0.045], 0.006, 0.006, 5);
  f.cylBetween('chrome', [-0.25, by + 0.1, 0.045], [-0.285, by + 0.17, 0.04], 0.006, 0.006, 5);
  f.cyl('flat', 0.05, 0.044, 0.016, 12, { p: [-0.29, by + 0.2, 0.034], r: [PI / 2, 0, 0], c: BLACK });
  f.cyl('chrome', 0.045, 0.045, 0.004, 12, { p: [-0.29, by + 0.2, 0.044], r: [PI / 2, 0, 0] });
  // the headlamp's shell and the clocks on top of it
  f.lathe('paint', [[0, 0.1], [0.05, 0.09], [0.085, 0.04], [0.09, -0.03], [0.085, -0.045], [0, -0.045]], 12, { p: [0, 0.07, -0.085], r: [PI / 2, 0, 0], c: col });
  f.torus('chrome', 0.085, 0.008, 4, 12, PI * 2, { p: [0, 0.07, -0.132] });
  f.lathe('chrome', [[0.092, -0.02], [0.1, -0.05], [0.094, -0.062]], 12, { p: [0, 0.07, -0.085], r: [PI / 2, 0, 0] }); // a peak round the lens
  // the clocks: up between the bars, on a bracket off the clamp
  f.cylBetween('steel', [0, by - 0.1, 0.03], [0, by - 0.03, -0.02], 0.008, 0.008, 5);
  f.cyl('flat', 0.062, 0.066, 0.045, 14, { p: [0, by - 0.015, -0.03], r: [-0.62, 0, 0], c: BLACK });
  f.cyl('flat', 0.036, 0.038, 0.035, 12, { p: [0.105, by - 0.02, -0.02], r: [-0.62, 0, 0], c: BLACK });
  const forkParts = f.build();

  const wb = new MeshBuilder(4601, { ao: false });
  spoked(wb, M.wr, 0.075, 8);
  const flatB = new MeshBuilder(4602, { ao: false });
  flatB.group({ p: [0, -0.04, 0], s: [1.25, 0.82, 1] }, () => spoked(flatB, M.wr, 0.075, 8));
  return { body: bodyParts, cover: coverParts, inner: innerParts, seat: seatParts, fork: forkParts, wheel: wb.build(), flat: flatB.build() };
}

function buildBike(tint, burnt = false) {
  const col = burnt ? [0.05, 0.045, 0.04] : PAINTS[(tint + 1) % PAINTS.length];
  const B = BIKE;
  const body = new MeshBuilder(4701 + tint, { ao: false });
  const bb = [0, 0.29, 0.06]; // the bottom bracket
  const st = [0, 0.84, 0.25]; // the top of the seat tube
  body.cylBetween('paint', B.head, [0, B.head[1] - 0.12, B.head[2] - 0.03], 0.02, 0.02, 6, { c: col });
  body.cylBetween('paint', [0, B.head[1] - 0.02, B.head[2]], [0, 0.8, 0.235], 0.016, 0.016, 6, { c: col }); // top tube
  body.cylBetween('paint', [0, B.head[1] - 0.1, B.head[2] - 0.02], bb, 0.019, 0.019, 6, { c: col }); // down tube
  body.cylBetween('paint', bb, st, 0.017, 0.017, 6, { c: col });
  for (const sx of [-1, 1]) {
    body.cylBetween('paint', [sx * 0.03, bb[1], bb[2]], [sx * 0.06, B.wr, B.ax], 0.01, 0.01, 5, { c: col }); // chain stays
    body.cylBetween('paint', [sx * 0.02, 0.78, 0.235], [sx * 0.06, B.wr, B.ax], 0.009, 0.009, 5, { c: col }); // seat stays
  }
  body.cylBetween('steel', st, [0, 0.86, 0.257], 0.012, 0.012, 6);
  // the saddle: a nose, a wide back, two springs under it
  body.box('flat', 0.028, 0.022, 0.13, { p: [0, 0.852, 0.205], c: SEAT });
  body.box('flat', 0.085, 0.024, 0.11, { p: [0, 0.853, 0.345], c: SEAT });
  for (const sx of [-1, 1]) body.cyl('chrome', 0.014, 0.014, 0.03, 6, { p: [sx * 0.05, 0.846, 0.35] });
  // the back mudguard and a rack
  for (let k = 0; k < 4; k++) {
    const a0 = -0.35 + k * 0.42, a1 = a0 + 0.42, R = B.wr + 0.03;
    body.beam('steel', [0, B.wr + Math.cos(a0) * R, B.ax + Math.sin(a0) * R], [0, B.wr + Math.cos(a1) * R, B.ax + Math.sin(a1) * R], 0.06, 0.006);
  }
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.07, 0.74, 0.3], [sx * 0.07, 0.74, 0.86], 0.006, 0.006, 4);
  for (const z of [0.32, 0.58, 0.85]) body.cylBetween('steel', [-0.07, 0.74, z], [0.07, 0.74, z], 0.006, 0.006, 4);
  for (const sx of [-1, 1]) body.cylBetween('steel', [sx * 0.07, 0.74, 0.8], [sx * 0.065, B.wr, B.ax], 0.005, 0.005, 4);
  // the chain's two runs, and the sprocket on the back hub
  body.cylBetween('flat', [0.05, 0.29 + 0.08, 0.06], [0.05, B.wr + 0.035, B.ax], 0.005, 0.005, 4, { c: BLACK });
  body.cylBetween('flat', [0.05, 0.29 - 0.08, 0.06], [0.05, B.wr - 0.035, B.ax], 0.005, 0.005, 4, { c: BLACK });
  body.cyl('steel', 0.036, 0.036, 0.006, 10, { p: [0.05, B.wr, B.ax], r: X });
  const bodyParts = body.build();
  // the cranks and pedals, about the bottom bracket
  const cr = new MeshBuilder(4801, { ao: false });
  cr.cyl('steel', 0.085, 0.085, 0.006, 12, { p: [0.05, 0, 0], r: X });
  for (const sx of [-1, 1]) {
    cr.cylBetween('steel', [sx * 0.06, 0, 0], [sx * 0.09, sx * B.crank, 0], 0.009, 0.009, 5);
    cr.cylBetween('steel', [sx * 0.09, sx * B.crank, 0], [sx * 0.185, sx * B.crank, 0], 0.005, 0.005, 4); // (the pedals are parts of their own: they stay level as the cranks go round)
  }
  const crankParts = cr.build();
  const pd = new MeshBuilder(4802, { ao: false });
  pd.box('flat', 0.085, 0.018, 0.075, { c: BLACK });
  const pedalParts = pd.build();
  const f = new MeshBuilder(4901 + tint, { ao: false });
  for (const sx of [-1, 1]) f.cylBetween('paint', [sx * 0.05, -0.12, 0], [sx * 0.05, -B.fork, 0], 0.011, 0.011, 5, { c: col });
  f.box('paint', 0.12, 0.025, 0.035, { p: [0, -0.125, 0], c: col });
  const by = B.bar;
  f.cylBetween('steel', [0, -0.12, 0], [0, by - 0.02, 0.0], 0.013, 0.013, 6);
  f.cylBetween('steel', [0, by - 0.02, 0], [0, by, -0.11], 0.012, 0.012, 6); // the stem forward
  f.cylBetween('chrome', [-0.18, by, -0.11], [0.18, by, -0.11], 0.011, 0.011, 6);
  for (const sx of [-1, 1]) {
    f.cylBetween('chrome', [sx * 0.18, by, -0.11], [sx * 0.21, by, -0.08], 0.011, 0.011, 6);
    f.cylBetween('flat', [sx * 0.205, by, -0.083], [sx * 0.33, by, -0.055], 0.0155, 0.0155, 8, { c: RUBBER });
    f.cylBetween('steel', [sx * 0.2, by + 0.012, -0.12], [sx * 0.31, by - 0.006, -0.105], 0.004, 0.004, 4); // the brake lever
  }
  for (let k = 0; k < 3; k++) {
    const a0 = -0.6 + k * 0.42, a1 = a0 + 0.42, R = B.wr + 0.03;
    f.beam('steel', [0, -B.fork + Math.cos(a0) * R, Math.sin(a0) * R], [0, -B.fork + Math.cos(a1) * R, Math.sin(a1) * R], 0.06, 0.006);
  }
  f.cyl('chrome', 0.028, 0.03, 0.03, 8, { p: [-0.12, by + 0.03, -0.11] }); // the bell
  const forkParts = f.build();
  const wb = new MeshBuilder(4902, { ao: false });
  spoked(wb, B.wr, 0.045, 12);
  const flatB = new MeshBuilder(4903, { ao: false });
  flatB.group({ p: [0, -0.035, 0], s: [1.2, 0.86, 1] }, () => spoked(flatB, B.wr, 0.045, 12));
  return { body: bodyParts, crank: crankParts, pedal: pedalParts, fork: forkParts, wheel: wb.build(), flat: flatB.build() };
}

// ---------------------------------------------------------------- the car
// The sedan of the roads (props.js `sedan`), whole: its bonnet shut (or up, as it is found), its wheels and its
// steering wheel apart, to turn. CAR_Z: the quest car's prop is this much shorter than the builder's sedan, and the
// team's car is that car.
const CAR_Z = 0.952;
const CAR = { wr: 0.32, wheels: [[-0.8, -1.4], [0.8, -1.4], [-0.8, 1.35], [0.8, 1.35]], steer: [-0.38, 0.97, -0.5], tilt: 0.5, R: 0.15 };
function buildCar(tint, variant) {
  const col = tint === 7 ? [0.34, 0.42, 0.52] : CAR_COLORS[tint % CAR_COLORS.length];
  const b = new MeshBuilder(5101 + tint * 7 + variant, { ao: false });
  b.push([0, 0, 0], [0, 0, 0], [1, 1, CAR_Z]);
  const burnt = variant === 2;
  sedan(b, makeRng(5101 * 31 + tint), {
    color: burnt ? [0.05, 0.045, 0.04] : col,
    noWheels: true,
    noSteer: true,
    slim: true, // (a car somebody sits in and looks out of: thin pillars)
    hoodOpen: variant === 1,
    burnt,
    glass: burnt ? ['gone', 'gone', 'gone', 'gone', 'gone', 'gone'] : tint === 7 ? ['ok', 'ok', 'ok', 'gone', 'gone', 'ok'] : ['ok', 'ok', 'gone', 'gone', 'gone', 'gone'], // (a car that is driven: its side windows wound down, to be seen in and shot out of. The quest car is as the island has it)
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
  sw.torus('flat', CAR.R, 0.011, 6, 18, PI * 2, { c: [0.1, 0.1, 0.11] });
  for (const a of [0.2, PI - 0.2, -PI / 2]) sw.cylBetween('flat', [0, 0, 0], [Math.cos(a) * CAR.R, Math.sin(a) * CAR.R, 0], 0.008, 0.007, 5, { c: [0.1, 0.1, 0.11] });
  sw.cyl('flat', 0.028, 0.032, 0.025, 10, { r: [PI / 2, 0, 0], c: [0.12, 0.12, 0.13] });
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
    this.feet = []; // per seat: [left, right] Object3Ds where the ball of each foot rests (a pedal, the footboard, the floor)
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
    this.live = new THREE.Group(); // everything of it but what a burnt-out one has left (setState)
    body.add(this.live);
    this.live.add((this.shell = shadows(partsToGroup(P.body, 'body'))));
    const foot = (x, y, z, parent = body) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    if (moped) {
      this.cover = shadows(partsToGroup(P.cover, 'cover'));
      this.inner = shadows(partsToGroup(P.inner, 'inner'));
      this.seat = shadows(partsToGroup(P.seat, 'seat'));
      this.live.add(this.cover, this.inner, this.seat);
      // the rider's feet on the footboard, the feet of whoever is behind on the rests
      this.feet.push([foot(-0.105, 0.322, -0.15), foot(0.105, 0.322, -0.15)], [foot(-0.245, 0.374, 0.35), foot(0.245, 0.374, 0.35)]);
    } else {
      this.crank = shadows(partsToGroup(P.crank, 'crank'));
      this.crank.position.set(D.bb[0], D.bb[1], D.bb[2]);
      this.live.add(this.crank);
      // the pedals: level whatever the cranks do (setWheels), a foot on each
      this.pedals = [-1, 1].map((sx) => {
        const m = shadows(partsToGroup(P.pedal, 'pedal'));
        m.userData.sx = sx;
        this.live.add(m);
        return m;
      });
      this.feet.push([foot(0, 0.012, -0.01, this.pedals[0]), foot(0, 0.012, -0.01, this.pedals[1])]);
    }
    // the fork: its frame's -Y runs from the headstock down to the axle; it turns about that
    const fork = (this.fork = new THREE.Group());
    fork.rotation.order = 'XYZ';
    fork.position.set(D.head[0], D.head[1], D.head[2]);
    fork.rotation.x = D.rake;
    fork.add(shadows(partsToGroup(P.fork, 'fork')));
    this.live.add(fork);
    const mk = (parts) => shadows(partsToGroup(parts, 'wheel'));
    const fw = new THREE.Group();
    fw.position.set(0, -D.fork, 0);
    this.fwOk = mk(P.wheel);
    this.fwFlat = mk(P.flat);
    fw.add(this.fwOk, this.fwFlat);
    fork.add(fw);
    const rw = mk(P.wheel);
    rw.position.set(0, D.wr, D.ax);
    this.live.add(rw);
    this.wheels.push(this.fwOk, rw);
    // the grips (the middle of each, on the bars)
    const gx = moped ? 0.298 : 0.268, gy = D.bar, gz = moped ? 0.089 : -0.069;
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
        this.live.add(m);
      }
      this.glows(0.5, 0.9, 1.5, 1.2, 2.6);
      // the speedometer's face and its needle, the fuel gauge beside it: tipped back toward the rider
      const dials = new THREE.Group();
      dials.position.set(0, D.bar - 0.015, -0.03);
      dials.rotation.x = -0.62;
      fork.add(dials);
      const face = lamp(geo('mface', () => new THREE.CircleGeometry(0.056, 18).rotateX(-PI / 2)), L.dial);
      face.position.y = 0.0235;
      const face2 = lamp(geo('mface2', () => new THREE.CircleGeometry(0.031, 14).rotateX(-PI / 2)), L.dial);
      face2.position.set(0.105, 0.0135, 0.008);
      dials.add(face, face2);
      // the marks round each face: every 20 km/h on the one, empty / half / full on the other
      const tick = geo('mtick', () => new THREE.BoxGeometry(0.003, 0.0015, 0.011));
      for (const [x, y, z, r, n, a0, a1] of [[0, 0.0245, 0, 0.047, 7, 2.1, -2.1], [0.105, 0.0145, 0.008, 0.025, 3, 1.2, -1.2]]) {
        for (let k = 0; k < n; k++) {
          const a = a0 + ((a1 - a0) * k) / (n - 1);
          const t = lamp(tick, L.panel);
          t.position.set(x - Math.sin(a) * r, y, z - Math.cos(a) * r);
          t.rotation.y = a;
          dials.add(t);
        }
      }
      const ng = geo('mneedle', () => new THREE.BoxGeometry(0.005, 0.002, 0.046).translate(0, 0, -0.02));
      for (const [x, y, z, sc] of [[0, 0.0262, 0, 1], [0.105, 0.0162, 0.008, 0.55]]) {
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
    this.live = new THREE.Group(); // (what a burnt-out one has lost: its wheels' tyres are flat with it, its lamps dead)
    this.body.add(this.live);
    const foot = (x, y, z) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z * CAR_Z);
      this.body.add(o);
      return o;
    };
    // the feet: under the scuttle in front (the driver's by the pedals), under the front seats behind
    for (const sx of [-1, 1]) this.feet.push([foot(sx * 0.38 - 0.11, 0.25, -0.7), foot(sx * 0.38 + 0.11, 0.25, -0.7)]);
    for (const sx of [-1, 1]) this.feet.push([foot(sx * 0.4 - 0.1, 0.25, 0.275), foot(sx * 0.4 + 0.1, 0.25, 0.275)]);
    CAR.wheels.forEach(([x, z], k) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, CAR.wr, z * CAR_Z);
      const w = shadows(partsToGroup(P.wheel, 'wheel'));
      pivot.add(w);
      if (k === 1) {
        this.fwFlat = shadows(partsToGroup(P.flat, 'wheel_flat'));
        pivot.add(this.fwFlat);
        this.fwOk = w;
      } else {
        // (every tyre of a burnt-out one is down)
        const fl = shadows(partsToGroup(P.flat, 'wheel_flat'));
        fl.visible = false;
        pivot.add(fl);
        (this.flats || (this.flats = [])).push([w, fl]);
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
    const rim = partsToGroup(P.steer, 'steering');
    rim.traverse((o) => o.isMesh && (o.material = L.wheel));
    sw.add(rim);
    this.body.add(sw);
    for (const [k, a] of [[0, 2.98], [1, 0.16]]) {
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
    this.glows(1.5, 2.3 * CAR_Z, 2.4, 2.0, 5.5);
    // hazard lamps: the four corners, blinking while a broken-down one's battery lasts (setHazard)
    this.hazard = new THREE.Group();
    const hz = geo('chazard', () => new THREE.PlaneGeometry(0.16, 0.11));
    for (const sx of [-1, 1]) {
      const a = lamp(hz, L.needle), c = lamp(hz, L.needle);
      a.position.set(sx * 0.82, 0.66, -2.332 * CAR_Z);
      a.rotation.y = PI;
      c.position.set(sx * 0.82, 0.68, 2.33 * CAR_Z);
      this.hazard.add(a, c);
    }
    this.hazard.visible = false;
    this.body.add(this.hazard);
    // the clocks in the binnacle behind the wheel: a lit face each, a needle each
    const dials = new THREE.Group();
    dials.position.set(-0.38, 1.0, -0.69 * CAR_Z);
    dials.rotation.x = 0.3;
    this.body.add(dials);
    // (their panel: dark by day, lit with the lamps - setLamps)
    this.panelOn = lamp(geo('cpanel', () => new THREE.PlaneGeometry(0.3, 0.1)), L.panel);
    this.panelOn.position.z = -0.001;
    this.panelOff = lamp(this.panelOn.geometry, getMaterial('dark'));
    this.panelOff.position.z = -0.001;
    dials.add(this.panelOn, this.panelOff);
    const face = geo('cface', () => new THREE.CircleGeometry(0.042, 16));
    const ng = geo('cneedle', () => new THREE.BoxGeometry(0.005, 0.036, 0.002).translate(0, 0.016, 0));
    const tick = geo('ctick', () => new THREE.BoxGeometry(0.003, 0.009, 0.001));
    for (const [x, sc, n, a0, a1] of [[-0.07, 1, 7, 2.1, -2.1], [0.07, 0.8, 3, 1.2, -1.2]]) {
      for (let k = 0; k < n; k++) {
        const a = a0 + ((a1 - a0) * k) / (n - 1);
        const t = lamp(tick, L.panel);
        t.position.set(x - Math.sin(a) * 0.035 * sc, Math.cos(a) * 0.035 * sc, 0.002);
        t.rotation.z = a;
        dials.add(t);
      }
    }
    for (const [x, sc] of [[-0.07, 1], [0.07, 0.8]]) {
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
    const down = state === VSTATE.DEAD;
    if (this.vk === VEH.CAR) {
      // as found and broken down: the bonnet up, a front tyre flat (and that corner down); burnt out: black, no glass,
      // on four flat tyres
      const v = wreck ? 2 : found || down ? 1 : 0;
      if (!this.bodies[v]) this.body.add((this.bodies[v] = this.mkBody(v)));
      this.bodies.forEach((b, k) => b && (b.visible = k === v));
      this.sw.visible = !wreck;
      for (const [w, fl] of this.flats) {
        fl.visible = wreck;
        w.visible = !wreck;
      }
      this.sag = wreck ? [0, -0.07, 0] : found || down ? [0.012, -0.012, -0.03] : [0, 0, 0]; // (pitch, drop, roll: VehicleClient.pose adds them)
    } else {
      // burnt out: what is left of it lies on its side, black
      if (wreck && !this.burnt) {
        const P = partsOf(`${this.vk}:burnt`, () => (this.vk === VEH.MOPED ? buildMoped(0, true) : buildBike(0, true)));
        const g = (this.burnt = new THREE.Group());
        g.add(shadows(partsToGroup(P.body, 'burnt')), shadows(partsToGroup(P.fork, 'burnt_fork')));
        const D = this.vk === VEH.MOPED ? MOPED : BIKE;
        const fk = g.children[1];
        fk.rotation.order = 'XYZ';
        fk.position.set(D.head[0], D.head[1], D.head[2]);
        fk.rotation.set(D.rake, 0.7, 0);
        for (const [y, z, par] of [[-D.fork, 0, fk], [D.wr, D.ax, g]]) {
          const w = shadows(partsToGroup(P.flat, 'burnt_wheel'));
          w.position.set(0, y, z);
          par.add(w);
        }
        g.rotation.z = 1.36;
        g.position.set(0.1, 0.16, 0);
        this.body.add(g);
      }
      if (this.burnt) this.burnt.visible = wreck;
      this.live.visible = !wreck;
      if (this.vk === VEH.MOPED) {
        this.cover.visible = !found && !down;
        this.inner.visible = true;
      }
      this.sag = [0, 0, 0];
    }
    if (this.fwFlat) {
      this.fwFlat.visible = found || wreck || down;
      this.fwOk.visible = !this.fwFlat.visible;
    }
    this.setHazard(false);
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
    if (this.panelOn) {
      this.panelOn.visible = !!h;
      this.panelOff.visible = !h;
    }
    if (this.glowHead) {
      this.glowHead.visible = !!h;
      this.glowBrake.visible = !!b;
      this.glowTail.visible = !!h && !b;
    }
  }

  // the light its lamps throw on the road, as pools laid on it: a wash ahead of the headlamp (the scene's own spot
  // lights the rest: VehicleClient.lampCands), red behind the tail lamp, brighter with the brake
  glows(tailW, tailZ, tailLen, headW, headLen) {
    const L = lampMats();
    const mk = (key, rx, rz, mat, z) => {
      const m = pool(key, rx, rz, mat);
      m.position.set(0, 0.035, z);
      m.visible = false;
      this.group.add(m); // (on the road, level: not leaning with the body)
      return m;
    };
    this.glowTail = mk(`gt${this.vk}`, tailW, tailLen * 0.5, L.glowTail, tailZ + tailLen * 0.45);
    this.glowBrake = mk(`gb${this.vk}`, tailW * 1.25, tailLen * 0.7, L.glowBrake, tailZ + tailLen * 0.6);
    this.glowHead = mk(`gh${this.vk}`, headW, headLen * 0.5, L.glowHead, -(tailZ + headLen * 0.55));
  }

  // a broken-down car's four corners blinking (VehicleClient.dress: on, off, on)
  setHazard(on) {
    if (this.hazard) this.hazard.visible = !!on;
  }

  // the throttle hand's turn of its grip (0..1)
  setThrottle(k) {
    if (this.vk === VEH.MOPED) this.grips[1].rotation.x = -0.55 * k;
  }

  // roll: metres rolled (the wheels); steer: rad, + to the right
  setWheels(roll, steer) {
    const a = -roll / this.wr;
    for (const w of this.wheels) w.rotation.x = a;
    if (this.fwFlat) this.fwFlat.rotation.x = 0;
    if (this.fork) this.fork.rotation.y = -steer;
    for (const p of this.front) p.rotation.y = -steer;
    if (this.sw) this.sw.rotation.z = -steer * 4.2; // (the wheel turns a few times what the tyres do)
    if (this.crank) {
      const c = (this.crank.rotation.x = a * 0.42);
      // (a pedal: at the end of its crank, level)
      for (const m of this.pedals) m.position.set(m.userData.sx * 0.14, BIKE.bb[1] + m.userData.sx * BIKE.crank * Math.cos(c), BIKE.bb[2] + m.userData.sx * BIKE.crank * Math.sin(c));
    }
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
    if (this.vk === VEH.CAR) pos.set(0, 0.72, -2.36);
    else pos.set(0, 0.07, -0.16);
    pos.applyMatrix4(m.matrixWorld);
    dir.set(0, this.vk === VEH.CAR ? -0.085 : -0.34, -1).transformDirection(m.matrixWorld);
  }
}

// which survivors' hands hold on where: the grip of each hand in the frame of grips[k] - the fingers' way and the
// palm's (render/models/weapons.js handQ). On bars the fist closes over the grip from above and behind; on a wheel's
// rim from the outside.
// How a survivor sits in each seat: [the thigh's angle forward of straight down, the knee's bend, how far the knees
// are apart, the trunk's lean forward] (characters.js: s.sitT / sitK / sitSplay). A moped's rider has their feet on its
// footboard and whoever rides behind has their knees round them; in a car the legs go out under the dash, and in the
// back the knees are up behind the front seats; on a bicycle the feet are down at the pedals.
// (the legs: solved onto the model's feet places - seatBody; [.., .., the knees apart, the trunk's lean forward,
// the toes down])
export const SEAT_POSE = {
  [VEH.MOPED]: [[1.5, 1.45, 0.3, 0.06, 0], [1.5, 1.45, 0.75, 0.04, 0.25]],
  [VEH.CAR]: [[1.5, 1.45, 0.32, -0.12, -0.25], [1.5, 1.45, 0.25, -0.12, -0.25], [1.5, 1.45, 0.25, -0.05, 0], [1.5, 1.45, 0.25, -0.05, 0]],
  [VEH.BIKE]: [[1.5, 1.45, 0.1, 0.2, 0.1]],
};
// where the ankle is from the ball of the foot, in the vehicle's frame: up, back
export const ANKLE = [0.11, 0.1];
// (the sitting pose every seat is measured from: thighs level, shins hanging)
export const SIT_T = 1.5, SIT_K = 1.45, SEAT_HIP = 0.42;

export const GRIP_HOLD = {
  [VEH.MOPED]: { finger: [0, -0.35, -1], palm: [0, -1, 0.3] },
  [VEH.BIKE]: { finger: [0, -0.35, -1], palm: [0, -1, 0.3] },
  [VEH.CAR]: { finger: [0, 0, -1], palm: [-1, 0, 0] },
};
