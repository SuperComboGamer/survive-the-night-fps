// A handcar of the section gang (shared/handcar.js): a plank deck on two wheelsets, the pump standard in the middle
// of it carrying the walking-beam lever, a handle bar across each end of the beam.
//   createHandcar      the car as everybody sees it (the world's materials). Its origin is the middle of the top of
//                      the deck, +Z along the line towards its higher points; userData.lever (turn it about X:
//                      leverAngle, + takes the -Z handle down) and userData.wheels (turn them about X with the
//                      distance rolled) are what moves. userData.near: the handle bar at the rider's end (the
//                      rider's own view has their hands on one of its own there instead)
//   createHandcarView  the rider's hands on the handle bar in front of them, for their own view while they work
//                      the lever (the viewmodel scene, lit apart from the world: its own material)
import * as THREE from 'three';
import { MeshBuilder, partsToGroup } from '../materials.js';
import { HANDCAR } from '../../../shared/handcar.js';
import { RAIL } from '../../../shared/rail.js';

const PI = Math.PI;
export const WHEEL_R = 0.3; // (the rails stand 0.25 over the bed: the axles are this much over them)
const AXLE_Y = 0.25 + WHEEL_R - HANDCAR.deck; // ...below the top of the deck
const AXLE_Z = 0.75;
// (linear colours, as MeshBuilder takes them)
const HANDLE = [0.16, 0.09, 0.045];
const PAINT = [0.22, 0.035, 0.025]; // the standard and the beam: railway red, long faded
const GLOVE = [0.1, 0.075, 0.055];
const SLEEVE = [0.15, 0.13, 0.095];
const X = [0, 0, PI / 2]; // a cylinder laid across the car
const VIEW_LIFT = 2; // the viewmodel scene's lights are a fraction of the world's: the hands are lifted by this

let parts = null;
function build() {
  const H = HANDCAR;
  // ---- the frame and the deck
  const body = new MeshBuilder(1701, { ao: false });
  body.box('planks', H.halfW * 2 - 0.04, 0.07, H.half * 2, { p: [0, -0.035, 0] });
  for (const sx of [-1, 1]) {
    body.box('rust', 0.1, 0.16, H.half * 2, { p: [sx * 0.62, -0.15, 0] }); // side sills
    for (const sz of [-1, 1]) {
      body.box('rust', 0.13, 0.16, 0.22, { p: [sx * 0.62, AXLE_Y + 0.02, sz * AXLE_Z] }); // axle boxes
      body.box('rust', 0.03, 0.12, 0.08, { p: [sx * 0.62, AXLE_Y - 0.1, sz * AXLE_Z] });
    }
  }
  for (const sz of [-1, 1]) body.box('rust', H.halfW * 2, 0.15, 0.12, { p: [0, -0.115, sz * (H.half - 0.06)] }); // headstocks
  // the pump standard: an A-frame either side of the beam up to the pivot, braced, its bearing across the top
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      body.cylBetween('paint', [sx * 0.17, 0, sz * 0.48], [sx * 0.17, H.pivot - 0.03, 0], 0.03, 0.036, 6, { c: PAINT });
      body.box('rust', 0.12, 0.03, 0.14, { p: [sx * 0.17, 0.015, sz * 0.48] }); // feet bolted to the deck
    }
    body.box('paint', 0.04, 0.05, 0.5, { p: [sx * 0.17, 0.42, 0], c: PAINT });
  }
  body.cyl('steel', 0.055, 0.055, 0.44, 10, { p: [0, H.pivot, 0], r: X });
  // the gearbox under the standard, down to the front axle
  body.box('rust', 0.26, 0.2, 0.62, { p: [0, -0.17, 0.32] });
  const bodyParts = body.build();

  // ---- the walking beam and its handle bars, about the pivot (the one at the rider's end, -Z, apart)
  const handle = (b, sz) => {
    b.box('steel', 0.1, 0.08, 0.08, { p: [0, 0, sz * H.beam] });
    b.cyl('wood', 0.028, 0.028, 1.0, 8, { p: [0, 0, sz * H.beam], r: X, c: HANDLE });
    for (const sx of [-1, 1]) b.cyl('steel', 0.034, 0.034, 0.04, 8, { p: [sx * 0.5, 0, sz * H.beam], r: X }); // end caps
  };
  const lever = new MeshBuilder(1702, { ao: false });
  lever.box('paint', 0.07, 0.1, H.beam * 2 + 0.1, { c: PAINT });
  handle(lever, 1);
  const leverParts = lever.build();
  const near = new MeshBuilder(1705, { ao: false });
  handle(near, -1);
  const nearParts = near.build();

  // ---- a wheelset: the axle, two spoked wheels on the rails with their flanges inside them
  const ws = new MeshBuilder(1703, { ao: false });
  ws.cyl('steel', 0.04, 0.04, RAIL.GAUGE + 0.2, 8, { r: X });
  const g = RAIL.GAUGE / 2;
  for (const sx of [-1, 1]) {
    ws.cyl('iron', WHEEL_R, WHEEL_R, 0.07, 18, { p: [sx * g, 0, 0], r: X });
    ws.cyl('iron', WHEEL_R + 0.03, WHEEL_R + 0.03, 0.02, 18, { p: [sx * (g - 0.045), 0, 0], r: X });
    ws.cyl('steel', 0.07, 0.07, 0.12, 8, { p: [sx * (g + 0.02), 0, 0], r: X });
    // the spokes stand proud of the web, so the wheel is seen to turn
    for (let k = 0; k < 3; k++) ws.box('rust', 0.02, WHEEL_R * 1.8, 0.045, { p: [sx * (g + 0.04), 0, 0], r: [(k * PI) / 3, 0, 0] });
  }
  const wheelParts = ws.build();
  parts = { body: bodyParts, lever: leverParts, near: nearParts, wheels: wheelParts };
  return parts;
}

export function createHandcar() {
  const P = parts || build();
  const g = partsToGroup(P.body, 'handcar');
  g.rotation.order = 'YXZ';
  const lever = partsToGroup(P.lever, 'handcar_lever');
  lever.position.set(0, HANDCAR.pivot, 0);
  g.add(lever);
  const near = partsToGroup(P.near, 'handcar_handle');
  lever.add(near);
  const wheels = [];
  for (const sz of [-1, 1]) {
    const w = partsToGroup(P.wheels, 'handcar_wheels');
    w.position.set(0, AXLE_Y, sz * AXLE_Z);
    g.add(w);
    wheels.push(w);
  }
  g.userData.lever = lever;
  g.userData.near = near;
  g.userData.wheels = wheels;
  return g;
}

// The handle bar under the rider's hands, the eye at the origin looking down -Z: their fists on it, the forearms
// coming up to it from below. Raise and lower it with the lever (client/game/handcar.js).
export function createHandcarView() {
  const b = new MeshBuilder(1704, { ao: false });
  b.cyl('wood', 0.026, 0.026, 0.72, 10, { r: X, c: HANDLE });
  for (const sx of [-1, 1]) b.cyl('wood', 0.032, 0.032, 0.035, 10, { p: [sx * 0.36, 0, 0], r: X, c: [0.12, 0.12, 0.12] }); // end caps
  b.box('wood', 0.09, 0.07, 0.07, { p: [0, 0, 0], c: [0.12, 0.12, 0.12] }); // (where it is fixed to the beam)
  for (const sx of [-1, 1]) {
    b.box('wood', 0.09, 0.07, 0.08, { p: [sx * 0.2, 0.012, 0.004], c: GLOVE });
    b.box('wood', 0.075, 0.03, 0.06, { p: [sx * 0.2, -0.03, -0.012], c: GLOVE });
    b.box('wood', 0.03, 0.03, 0.07, { p: [sx * 0.15, 0.025, 0.03], r: [0, sx * 0.4, 0], c: GLOVE }); // thumbs
    b.cylBetween('wood', [sx * 0.21, -0.02, 0.04], [sx * 0.34, -0.3, 0.42], 0.034, 0.046, 7, { c: SLEEVE });
  }
  const p = b.build();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.color.setScalar(VIEW_LIFT);
  const g = new THREE.Group();
  g.name = 'handcar_view';
  for (const q of p) g.add(new THREE.Mesh(q.geometry, mat));
  return g;
}
