// The mounted gun (shared/mountedgun.js): a belt-fed heavy machine gun with spade grips, in four pieces.
//   buildNestLitter  what lies at the checkpoint's nest, a static prop ('mg_tripod' in models/props.js): ammo cans
//                    and spent brass, which stay when the gun is carried off
//   createGunStand   the tripod, which goes wherever the gun does (the gun is an entity)
//   createGunMount   the gun that swivels on it, as everybody else sees it (the world's materials)
//   createGunView    its rear end and the gunner's hands on the grips, for the gunner's own view (the viewmodel
//                    scene, which is lit apart from the world: its own two materials)
// All of it faces -Z with the pintle at the origin (the tripod: the ground under it).
import * as THREE from 'three';
import { MeshBuilder, partsToGroup } from '../materials.js';
import { GUN } from '../../../shared/mountedgun.js';

const PI = Math.PI;
// (linear colours, as MeshBuilder takes them)
const GUNMETAL = [0.04, 0.043, 0.045];
const WORN = [0.11, 0.115, 0.115];
const OLIVE = [0.1, 0.12, 0.065];
const BRASS = [0.5, 0.32, 0.07];
const GRIP = [0.12, 0.065, 0.03];
const GLOVE = [0.1, 0.075, 0.055]; // the survivors' hands, as the viewmodel has them
const SLEEVE = [0.15, 0.13, 0.095];
const VIEW_LIFT = 5; // the viewmodel scene's lights are a fraction of the world's: its metal is lifted by this
const Z = [PI / 2, 0, 0]; // a cylinder laid along the barrel

// an ammunition can (0.16 x 0.19 x 0.3), its base at y = 0. mat / steel: the materials of its paint and its fittings
// (the colours only count on the ones that take vertex colours). brass: with the lid off, the material of the belt in it
function ammoCan(b, mat, steel, p, ry = 0, brass = null) {
  b.group({ p, r: [0, ry, 0] }, () => {
    b.box(mat, 0.16, 0.17, 0.3, { p: [0, 0.085, 0], c: OLIVE });
    if (brass) b.box(brass, 0.12, 0.012, 0.26, { p: [0, 0.172, 0], c: BRASS });
    else b.box(mat, 0.17, 0.025, 0.31, { p: [0, 0.18, 0], c: OLIVE });
    b.box(steel, 0.02, 0.03, 0.12, { p: [0, 0.205, 0], c: WORN }); // handle
    b.box(steel, 0.03, 0.06, 0.012, { p: [0, 0.15, -0.156], c: WORN }); // latch
  });
}

// The stand: three legs splayed from a head that carries the pintle socket.
function buildGunTripod(b) {
  const top = GUN.pivotY - 0.13;
  const feet = [[0, -0.72], [0.56, 0.5], [-0.56, 0.5]];
  for (const [x, z] of feet) {
    b.cylBetween('steel', [x * 0.08, top - 0.04, z * 0.08], [x, 0.03, z], 0.026, 0.03, 6);
    b.box('olive', 0.16, 0.035, 0.16, { p: [x, 0.018, z], r: [0, Math.atan2(x, z), 0] }); // shoe
    b.cylBetween('steel', [x * 0.55, top * 0.5, z * 0.55], [0, top * 0.32, 0], 0.012, 0.012, 4); // brace to the column
  }
  b.cyl('olive', 0.045, 0.05, top * 0.74, 8, { p: [0, top * 0.63, 0] }); // column
  b.cyl('steel', 0.085, 0.07, 0.1, 8, { p: [0, top - 0.02, 0] }); // head
  b.cyl('steel', 0.036, 0.036, 0.09, 8, { p: [0, top + 0.07, 0] }); // socket
  b.cylBetween('steel', [0.09, top - 0.02, 0], [0.19, top - 0.02, 0], 0.012, 0.012, 4); // clamp lever
}

// Cans and spent brass at the feet of the stand at the checkpoint (the stand itself goes with the gun).
export function buildNestLitter(b, r) {
  ammoCan(b, 'olive', 'steel', [0.5, 0, -0.18], 0.35);
  ammoCan(b, 'olive', 'steel', [0.72, 0, 0.02], -0.2);
  ammoCan(b, 'olive', 'steel', [0.58, 0.19, -0.1], 0.6);
  // spent brass thrown out to the right
  for (let i = 0; i < 14; i++) {
    const x = 0.35 + r() * 0.75;
    const z = -0.5 + r() * 0.9;
    b.cyl('paint', 0.007, 0.007, 0.05, 4, { p: [x, 0.008, z], r: [PI / 2, r() * PI, 0], c: BRASS });
  }
}

// the gun from the back plate to the muzzle. metal / matte: the materials of its steel, and of its wooden handles
// and the brass of the belt. hi: the detail only the gunner is close enough to see
function gunBody(b, metal, matte, hi) {
  // receiver, top cover, back plate
  b.box(metal, 0.115, 0.15, 0.6, { p: [0, 0.1, 0.08], c: GUNMETAL });
  b.box(metal, 0.122, 0.028, 0.3, { p: [0, 0.187, -0.02], c: WORN });
  if (hi) b.box(metal, 0.05, 0.012, 0.1, { p: [0, 0.207, 0.06], c: GUNMETAL }); // cover latch
  b.box(metal, 0.13, 0.17, 0.03, { p: [0, 0.1, 0.39], c: GUNMETAL });
  b.box(metal, 0.02, 0.05, 0.02, { p: [0, 0.225, 0.3], c: GUNMETAL }); // rear sight
  b.box(metal, 0.05, 0.012, 0.03, { p: [0, 0.2, 0.3], c: GUNMETAL });
  b.box(metal, 0.02, 0.03, 0.09, { p: [0.068, 0.11, 0.2], c: WORN }); // charging handle
  // spade grips: two handles between a top and a bottom bar, the butterfly trigger between them
  for (const y of [0.035, 0.165]) {
    b.box(metal, 0.16, 0.022, 0.022, { p: [0, y, 0.5], c: GUNMETAL });
    b.box(metal, 0.022, 0.022, 0.1, { p: [0, y, 0.45], c: GUNMETAL });
  }
  for (const x of [-0.068, 0.068]) b.cyl(matte, 0.02, 0.02, 0.12, 8, { p: [x, 0.1, 0.5], c: GRIP });
  b.box(metal, 0.06, 0.035, 0.02, { p: [0, 0.1, 0.425], r: [0.3, 0, 0], c: WORN });
  // barrel support with its cooling holes, the barrel, the muzzle
  b.cyl(metal, 0.036, 0.036, 0.42, hi ? 12 : 8, { p: [0, 0.1, -0.43], r: Z, c: GUNMETAL });
  const rings = hi ? 6 : 3;
  for (let k = 0; k < rings; k++) {
    const z = -0.27 - (k * 0.3) / (rings - 1);
    for (const a of [0, PI / 2, PI, (3 * PI) / 2]) b.box('dark', 0.016, 0.004, 0.03, { p: [Math.sin(a) * 0.036, 0.1 + Math.cos(a) * 0.036, z], r: [0, 0, -a] });
  }
  b.cyl(metal, 0.02, 0.022, GUN.barrel - 0.64, 8, { p: [0, 0.1, -(GUN.barrel + 0.64) / 2], r: Z, c: WORN });
  b.cyl(metal, 0.028, 0.028, 0.07, 8, { p: [0, 0.1, -GUN.barrel + 0.02], r: Z, c: GUNMETAL });
  b.box(metal, 0.012, 0.045, 0.012, { p: [0, 0.155, -0.6], c: GUNMETAL }); // front sight
  // the belt: out of the can on the left, over the feed tray
  b.box(matte, 0.2, 0.012, 0.1, { p: [-0.11, 0.176, -0.02], r: [0, 0, 0.12], c: BRASS });
  b.box(matte, 0.012, 0.16, 0.1, { p: [-0.205, 0.09, -0.02], r: [0, 0, 0.08], c: BRASS });
}

// the cradle under it, with the can the belt comes out of. steel / paint / matte: the materials of the bare metal,
// the can's paint and the belt
function gunCradle(b, steel, paint, matte) {
  b.box(steel, 0.15, 0.04, 0.34, { p: [0, 0.0, 0.02], c: WORN });
  for (const x of [-0.07, 0.07]) b.box(steel, 0.012, 0.09, 0.12, { p: [x, 0.04, 0.02], c: WORN });
  b.cyl(steel, 0.03, 0.03, 0.1, 8, { p: [0, -0.06, 0], c: WORN }); // pintle
  b.box(steel, 0.2, 0.012, 0.2, { p: [-0.19, -0.005, -0.02], c: WORN }); // can tray
  ammoCan(b, paint, steel, [-0.21, 0.0, -0.02], 0, matte);
}

let standParts = null;
// The tripod, origin on the ground under the pintle, its front leg toward -Z.
export function createGunStand() {
  if (!standParts) {
    const b = new MeshBuilder(1603, { ao: false });
    buildGunTripod(b);
    standParts = b.build();
  }
  return partsToGroup(standParts, 'mounted_gun_stand');
}

let mountParts = null;
// The gun on its pintle, origin at the pintle. Turn it with rotation.y / .x (order YXZ).
export function createGunMount() {
  if (!mountParts) {
    const b = new MeshBuilder(1601, { ao: false });
    // (the matte painted-metal tile: the weathered 'paint' has a sky sheen that reads as bare primer on a gun)
    gunBody(b, 'aircraft', 'wood', false);
    gunCradle(b, 'steel', 'aircraft', 'wood');
    mountParts = b.build();
  }
  const g = partsToGroup(mountParts, 'mounted_gun');
  g.rotation.order = 'YXZ';
  return g;
}

// What the gunner sees of it: the same gun from behind and above, the eye over the back plate looking along the
// top cover, with their fists on the grips at the bottom of the view. A group for the viewmodel scene (the camera
// at its origin, looking down -Z); userData.muzzle is where the flash goes.
// (drawn a third larger than life, as viewmodels are: at its true size it is a thin thing a metre off)
const VIEW = [0, -0.42, -1.35]; // the pintle, from the eye
const VIEW_SCALE = 1.3;
export function createGunView() {
  const b = new MeshBuilder(1602, { ao: false });
  b.push(VIEW, [0, 0, 0], [VIEW_SCALE, VIEW_SCALE, VIEW_SCALE]);
  // (every piece in a bucket that takes vertex colours: the materials below go by them. 'paint': what is lifted)
  gunBody(b, 'paint', 'wood', true);
  gunCradle(b, 'paint', 'paint', 'wood');
  // fists round the grips (the knuckles a ridge across each), thumbs on the trigger, forearms coming up from below
  for (const sx of [-1, 1]) {
    b.box('wood', 0.056, 0.094, 0.06, { p: [sx * 0.07, 0.1, 0.507], c: GLOVE });
    b.box('wood', 0.06, 0.07, 0.02, { p: [sx * 0.07, 0.105, 0.475], c: GLOVE });
    b.box('wood', 0.026, 0.026, 0.07, { p: [sx * 0.036, 0.13, 0.452], r: [0, sx * 0.5, 0], c: GLOVE });
    b.cylBetween('wood', [sx * 0.08, 0.07, 0.54], [sx * 0.36, -0.16, 1.0], 0.03, 0.042, 7, { c: SLEEVE });
  }
  b.pop();
  const parts = b.build();
  const metal = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x30302c });
  metal.color.setScalar(VIEW_LIFT);
  const matte = new THREE.MeshLambertMaterial({ vertexColors: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x0b0a09 });
  const g = new THREE.Group();
  g.name = 'mounted_gun_view';
  for (const p of parts) g.add(new THREE.Mesh(p.geometry, p.name === 'wood' ? matte : p.name === 'dark' ? dark : metal));
  g.userData.muzzle = new THREE.Vector3(VIEW[0], VIEW[1] + 0.1 * VIEW_SCALE, VIEW[2] - GUN.barrel * VIEW_SCALE);
  return g;
}
