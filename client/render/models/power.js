// The survivor-built generator and floodlight, as parts of a damage stage (models/structures.js buildStage calls
// these with its MeshBuilder). Origin at ground centre, front = -Z, like every structure. What lights up and what
// moves is not in here: the lamp's lens, its glow and its beam are separate meshes (client/game/power.js).
import * as THREE from 'three';
import { STRUCT } from '../../../shared/defs.js';
import { GEN_RANGE, FLOOD_RANGE, FLOOD_HALF, FLOOD_PITCH, FLOOD_LENS_UP, FLOOD_LENS_FWD } from '../../../shared/power.js';

const PI = Math.PI;
const RED = [0.5, 0.15, 0.11];
const BLACK = [0.13, 0.13, 0.13];
const YELLOW = [0.72, 0.55, 0.1];

// where the exhaust leaves the generator, in its own frame (the smoke starts here)
export const GEN_EXHAUST = { x: 0.74, y: 0.5, z: 0.2 };
// the lamp head: the lens is a quad this size, FLOOD_LENS_FWD ahead of the mast at FLOOD_LENS_UP, tipped down FLOOD_PITCH
export const FLOOD_LENS = { w: 0.46, h: 0.3 };

/**
 * b: MeshBuilder, d: damage stage 0..2, tint(c): the stage's darkening, dr(): the stage's own random stream.
 * A petrol set knocked together from scrap: tube frame, engine, alternator, a tank on top, the exhaust out of one end.
 */
export function buildGenerator(b, d, tint, dr) {
  const lean = d === 2 ? 0.07 : 0;
  b.group({ r: [0, 0, lean] }, () => {
    // tube frame (a corner post goes when it is wrecked)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        if (d === 2 && sx > 0 && sz < 0) continue;
        b.cyl('steel', 0.022, 0.022, 0.82, 5, { p: [sx * 0.6, 0.47, sz * 0.35] });
      }
    for (const y of [0.07, 0.88]) {
      for (const sz of [-1, 1]) b.cyl('steel', 0.022, 0.022, 1.2, 5, { p: [0, y, sz * 0.35], r: [0, 0, PI / 2] });
      for (const sx of [-1, 1]) b.cyl('steel', 0.022, 0.022, 0.7, 5, { p: [sx * 0.6, y, 0], r: [PI / 2, 0, 0] });
    }
    // engine block with its cooling fins, the recoil starter on its face
    b.box('paint', 0.5, 0.44, 0.46, { p: [-0.24, 0.36, 0.02], c: tint(BLACK) });
    for (let k = 0; k < 5; k++) b.box('steel', 0.3, 0.012, 0.5, { p: [-0.24, 0.5 + k * 0.035, 0.02] });
    b.cyl('paint', 0.15, 0.15, 0.06, 10, { p: [-0.24, 0.36, -0.24], r: [PI / 2, 0, 0], c: tint([0.3, 0.3, 0.3]) });
    b.cylBetween('rope', [-0.24, 0.42, -0.28], [-0.1, 0.5, -0.34], 0.008, 0.008, 4);
    b.box('wood', 0.09, 0.03, 0.03, { p: [-0.08, 0.51, -0.35], r: [0, 0.3, 0.4], c: tint([0.6, 0.5, 0.38]) });
    // alternator
    b.cyl('paint', 0.19, 0.19, 0.44, 10, { p: [0.3, 0.33, 0], r: [0, 0, PI / 2], c: tint(RED) });
    b.cyl('steel', 0.2, 0.2, 0.05, 10, { p: [0.5, 0.33, 0], r: [0, 0, PI / 2] });
    // panel on the front: sockets and the switch
    b.box('paint', 0.3, 0.2, 0.03, { p: [0.3, 0.6, -0.33], c: tint(BLACK) });
    b.box('emissive_red', 0.035, 0.05, 0.02, { p: [0.2, 0.62, -0.35] });
    for (const x of [0.3, 0.38]) b.cyl('steel', 0.025, 0.025, 0.02, 6, { p: [x, 0.6, -0.35], r: [PI / 2, 0, 0] });
    // tank on top, dented and patched with tape as it is knocked about
    b.box('paint', 0.86, 0.2, 0.5, { p: [0, 0.76, 0], r: [0, 0, d ? -0.03 * d : 0], c: tint(RED) });
    b.cyl('chrome', 0.055, 0.055, 0.04, 8, { p: [-0.22, 0.88, 0.05] });
    b.box('cloth', 0.07, 0.006, 0.52, { p: [0.18, 0.865, 0], c: [0.55, 0.56, 0.58] });
    if (d > 0) b.box('cloth', 0.2, 0.21, 0.006, { p: [0.05, 0.76, -0.254], r: [0, 0, 0.3], c: [0.5, 0.51, 0.53] });
    // exhaust: a pipe off the engine into a muffler at the +X end
    b.cylBetween('rust', [-0.2, 0.42, 0.26], [0.5, 0.5, 0.2], 0.03, 0.03, 6);
    b.cyl('rust', 0.07, 0.07, 0.26, 8, { p: [0.6, 0.5, 0.2], r: [0, 0, PI / 2] });
    b.cyl('charred', 0.025, 0.025, 0.1, 6, { p: [GEN_EXHAUST.x - 0.04, GEN_EXHAUST.y, GEN_EXHAUST.z], r: [0, 0, PI / 2] });
    // the cable out to the lamps, coiled at the foot
    if (d < 2 || dr() < 0.5) b.torus('wire', 0.14, 0.014, 4, 10, PI * 2, { p: [0.36, 0.03, -0.5], r: [PI / 2, 0, 0] });
    b.cylBetween('wire', [0.34, 0.55, -0.35], [0.4, 0.04, -0.42], 0.01, 0.01, 4);
    // rubber feet
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('rubber', 0.04, 0.045, 0.05, 6, { p: [sx * 0.6, 0.025, sz * 0.35] });
  });
  if (d === 2) b.cylBetween('steel', [0.75, 0.03, -0.5], [0.8, 0.03, 0.25], 0.022, 0.022, 5); // the post that came off
}

/**
 * A work lamp on a tripod: three legs, a mast, a yoke and the lamp head tipped down the way the light falls
 * (FLOOD_PITCH), a battery pack taped to the mast and the cable down it. The head never comes off: a wrecked one
 * still shines until the stand is broken.
 */
export function buildFloodlight(b, d, tint, dr) {
  const hub = 0.95;
  const sag = d === 2 ? 0.06 : 0;
  // legs: one to the back, two to the front corners
  for (const [x, z] of [[0, 0.3], [-0.27, -0.2], [0.27, -0.2]]) {
    const bent = d > 0 && dr() < 0.3 * d;
    b.cylBetween('steel', [x * (bent ? 1.25 : 1), 0, z * (bent ? 1.25 : 1)], [x * 0.08, hub, z * 0.08], 0.014, 0.018, 5);
    b.cyl('rubber', 0.026, 0.03, 0.03, 5, { p: [x * (bent ? 1.25 : 1), 0.015, z * (bent ? 1.25 : 1)] });
    b.cylBetween('steel', [x * 0.55, hub * 0.45, z * 0.55], [0, hub * 0.55, 0], 0.008, 0.008, 4); // brace
  }
  b.cyl('paint', 0.045, 0.045, 0.1, 8, { p: [0, hub, 0], c: tint(BLACK) });
  b.group({ r: [0, 0, sag] }, () => {
    // mast, in two telescoped lengths
    b.cyl('steel', 0.022, 0.022, 0.6, 6, { p: [0, hub + 0.3, 0] });
    b.cyl('steel', 0.016, 0.016, 0.4, 6, { p: [0, hub + 0.78, 0] });
    b.cyl('paint', 0.03, 0.03, 0.05, 6, { p: [0, hub + 0.58, 0], c: tint(BLACK) });
    // the battery pack, taped on
    b.box('paint', 0.16, 0.2, 0.1, { p: [0, 1.3, 0.07], c: tint([0.16, 0.2, 0.17]) });
    for (const y of [1.25, 1.36]) b.box('cloth', 0.17, 0.035, 0.15, { p: [0, y, 0.045], c: [0.52, 0.53, 0.55] });
    // cable from the head down the mast and away
    b.tube('wire', [[0.04, FLOOD_LENS_UP - 0.12, -0.08], [0.06, 1.7, 0.03], [0.03, 1.4, 0.05], [0.05, 1.0, 0.04], [0.16, 0.5, 0.2], [0.3, 0.02, 0.42]], 0.008, 12, 4);
    // yoke: an arm off the top of the mast to the bar the head hangs in
    const y = FLOOD_LENS_UP;
    const yz = -FLOOD_LENS_FWD + 0.1;
    b.cylBetween('steel', [0, hub + 0.96, 0], [0, y - 0.2, yz], 0.016, 0.016, 5);
    b.cyl('steel', 0.012, 0.012, 0.56, 5, { p: [0, y - 0.2, yz], r: [0, 0, PI / 2] });
    for (const sx of [-1, 1]) b.box('steel', 0.012, 0.24, 0.035, { p: [sx * 0.276, y - 0.09, yz] });
    // the head: housing, visor, fins on the back. Its front face lies in the plane of the lens.
    b.group({ p: [0, y, -FLOOD_LENS_FWD], r: [FLOOD_PITCH, 0, 0] }, () => {
      const depth = 0.17;
      b.box('paint', FLOOD_LENS.w + 0.08, FLOOD_LENS.h + 0.08, depth, { p: [0, 0, depth / 2 + 0.012], c: tint(YELLOW) });
      // frame round the glass
      for (const sy of [-1, 1]) b.box('paint', FLOOD_LENS.w + 0.1, 0.03, 0.03, { p: [0, sy * (FLOOD_LENS.h / 2 + 0.025), 0.005], c: tint(BLACK) });
      for (const sx of [-1, 1]) b.box('paint', 0.03, FLOOD_LENS.h + 0.08, 0.03, { p: [sx * (FLOOD_LENS.w / 2 + 0.035), 0, 0.005], c: tint(BLACK) });
      b.box('paint', FLOOD_LENS.w + 0.1, 0.012, 0.12, { p: [0, FLOOD_LENS.h / 2 + 0.05, -0.04], r: [0.25, 0, 0], c: tint(BLACK) }); // visor
      for (let k = 0; k < 6; k++) b.box('steel', 0.012, FLOOD_LENS.h, 0.05, { p: [-0.2 + k * 0.08, 0, depth + 0.035] });
      b.cyl('steel', 0.016, 0.016, 0.1, 5, { p: [0, FLOOD_LENS.h / 2 + 0.07, depth * 0.6], r: [0, 0, PI / 2] }); // carry handle
    });
  });
}

// ------------------------------------------------------------------ placement guides
// Flat marks on the ground, drawn over everything: where a floodlight's light will fall, and how far a generator's
// power reaches. The build ghosts carry one each (createGhost), and every generator in view shows its ring while
// one of the two is being placed (client/game/power.js).
let guideMat = null;
let ringGeo = null;
let fanGeo = null;
function guide(geo) {
  guideMat ||= new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const m = new THREE.Mesh(geo, guideMat);
  m.position.y = 0.12;
  m.renderOrder = 9;
  return m;
}
/** the circle a generator feeds: GEN_RANGE round it */
export function powerReachRing() {
  ringGeo ||= new THREE.RingGeometry(GEN_RANGE - 0.14, GEN_RANGE + 0.14, 96).rotateX(-PI / 2);
  return guide(ringGeo);
}
/** the ground a floodlight lights, about: a fan FLOOD_RANGE long ahead of it (-Z) */
export function floodFan() {
  fanGeo ||= new THREE.RingGeometry(2, FLOOD_RANGE - 0.5, 20, 1, PI / 2 - FLOOD_HALF, FLOOD_HALF * 2).rotateX(-PI / 2);
  return guide(fanGeo);
}
/** what a build ghost of `type` shows on the ground, or null */
export function ghostGuide(type) {
  return type === STRUCT.GENERATOR ? powerReachRing() : type === STRUCT.FLOODLIGHT ? floodFan() : null;
}
